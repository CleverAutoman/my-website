import { reactive } from 'vue'

/**
 * 全站 "decoding" 效果：页面正文像 LLM 生成一样逐 token 出现，并统计 token 数。
 *
 * 实现要点：
 * - 不改动 Vue 管理的 DOM。用 CSS Custom Highlight API 把「光标之后」的文字设成透明，
 *   光标每帧往前推进；图片在光标经过时淡入（只加 data 属性）。
 * - 文本 token：按 BPE 风格估算（英文短词 1 个 token，长词按 ~4.5 字符切分；
 *   每个汉字 1 个 token；数字每 3 位 1 个；标点各 1 个）。是估算，不是真实 tokenizer。
 * - 图片 token：按 Claude 视觉模型的估算公式 w×h/750（长边超过 1568px 或超过约 1.15MP 时先等比缩小）。
 *   图片在多模态模型里属于输入，所以记在 prefill，不计入 decode 速度。
 * - 浏览器不支持 Highlight API 或开启「减少动态效果」时，不做动画，只统计。
 */

export type Phase = 'idle' | 'prefill' | 'decode' | 'done'

/** 节奏抖动：token 吐出快慢有起伏、光标轻微抖动，看起来更像真实的生成 */
const T = 0.7

export const decodeState = reactive({
  phase: 'idle' as Phase,
  /** performance.now() 时间点，给 trace 瀑布图用 */
  tStart: null as number | null,
  tFirst: null as number | null,
  tEnd: null as number | null,
  animated: false,
  ttft: null as number | null,
  tps: null as number | null,
  avgTps: null as number | null,
  duration: null as number | null,
  decoded: 0,
  textTokens: 0,
  imageTokens: 0,
  images: 0,
  imagesMeasured: 0
})

const HL_NAME = 'decode-pending'
const SKIP_SELECTOR = 'script, style, svg, noscript, template, .aside, .sr-only, .visually-hidden, [data-decode-skip]'

interface TextTok {
  node: Text
  end: number
}
interface ImgMark {
  el: HTMLImageElement
  at: number
}
/** 需要随光标出现的元素：图片和有背景 / 边框 / 阴影的装饰块；at = 光标走到第几个 token 时出现 */
interface BlockMark {
  el: Element
  at: number
  /** data-decode：整块淡入；data-decode-mark：只藏列表符号和 ::before/::after 里的文字 */
  attr: 'data-decode' | 'data-decode-mark'
}

/** ::before / ::after 里有可见文字（比如 '// '、'›'），高亮 API 管不到，要单独藏 */
function hasPseudoText(el: Element) {
  for (const p of ['::before', '::after']) {
    const c = getComputedStyle(el, p).content
    if (c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''") return true
  }
  return false
}

const TRANSPARENT_BG = /^(transparent|rgba\(\d+,\s*\d+,\s*\d+,\s*0\))$/
function isDecorated(cs: CSSStyleDeclaration) {
  if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true
  if (!TRANSPARENT_BG.test(cs.backgroundColor)) return true
  return (
    (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') ||
    (parseFloat(cs.borderRightWidth) > 0 && cs.borderRightStyle !== 'none') ||
    (parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none') ||
    (parseFloat(cs.borderLeftWidth) > 0 && cs.borderLeftStyle !== 'none')
  )
}

/* ---------- token 估算 ---------- */
const TOKEN_RE =
  /\s*(?:[A-Za-z]+|\d{1,3}|[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]|[^\sA-Za-z\d])/g

/** 返回一段文本里每个 token 的结束位置 */
export function tokenEnds(text: string): number[] {
  const ends: number[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index!
    const piece = m[0]
    const core = piece.trimStart()
    const lead = piece.length - core.length
    if (/^[A-Za-z]+$/.test(core) && core.length > 6) {
      const n = Math.ceil(core.length / 4.5)
      for (let k = 1; k <= n; k++) ends.push(start + lead + Math.round((core.length * k) / n))
    } else {
      ends.push(start + piece.length)
    }
  }
  return ends
}

export function imageTokens(w: number, h: number) {
  if (!w || !h) return 0
  let s = Math.min(1, 1568 / Math.max(w, h))
  s = Math.min(s, Math.sqrt(1_150_000 / (w * h)))
  return Math.ceil((Math.round(w * s) * Math.round(h * s)) / 750)
}

/* ---------- 收集正文 ---------- */
// 被跳过但仍然可见的元素（目录、图表、实时指标、评论等）：decoding 时要绕开它们，保持可见
const VISIBLE_SKIP = '.aside, svg, [data-decode-skip]'

function collect(root: HTMLElement) {
  const toks: TextTok[] = []
  const imgs: ImgMark[] = []
  const gaps: { el: Element; at: number }[] = []
  const blocks: BlockMark[] = []
  /** 标题 id -> 标题开始时的 token 位置，给右侧目录用 */
  const heads = new Map<string, number>()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT
      const el = n as HTMLElement
      if (el.matches(SKIP_SELECTOR)) {
        // 纯图标 svg 里没有文字，不需要绕开；图表 svg 有坐标文字，要保持可见
        if (el.matches(VISIBLE_SKIP) && (el.tagName.toLowerCase() !== 'svg' || el.querySelector('text')))
          gaps.push({ el, at: toks.length })
        return NodeFilter.FILTER_REJECT
      }
      // 只看 display：收集时正文可能整体处于 visibility:hidden（decode-pending），不能据此跳过
      const cs = getComputedStyle(el)
      if (cs.display === 'none') return NodeFilter.FILTER_REJECT
      const at = toks.length
      if (el.tagName === 'IMG' || isDecorated(cs)) blocks.push({ el, at, attr: 'data-decode' })
      else if ((cs.display === 'list-item' && cs.listStyleType !== 'none') || hasPseudoText(el))
        blocks.push({ el, at, attr: 'data-decode-mark' })
      if (el.id && /^H[1-6]$/.test(el.tagName)) heads.set(el.id, at)
      return NodeFilter.FILTER_ACCEPT
    }
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text
      if (!t.data.trim()) continue
      for (const end of tokenEnds(t.data)) toks.push({ node: t, end })
    } else if ((n as Element).tagName === 'IMG') {
      imgs.push({ el: n as HTMLImageElement, at: toks.length })
    }
  }
  // 右侧目录（On this page）：每一项在正文里对应的标题开始生成时出现
  const links = root.querySelectorAll<HTMLAnchorElement>('.VPDocAsideOutline .outline-link')
  let first = Infinity
  for (const a of links) {
    let id = ''
    try {
      id = decodeURIComponent(a.hash.slice(1))
    } catch {
      id = a.hash.slice(1)
    }
    const at = heads.get(id) ?? 0
    first = Math.min(first, at)
    blocks.push({ el: a, at, attr: 'data-decode' })
  }
  const title = root.querySelector('.VPDocAsideOutline .outline-title')
  if (title && links.length) blocks.push({ el: title, at: first, attr: 'data-decode' })
  blocks.sort((x, y) => x.at - y.at)
  return { toks, imgs, gaps, blocks }
}

function measureImages(imgs: ImgMark[], runId: number) {
  for (const { el } of imgs) {
    const src = el.currentSrc || el.src
    const done = (w: number, h: number) => {
      if (runId !== currentRun) return
      decodeState.imageTokens += imageTokens(w, h)
      decodeState.imagesMeasured++
    }
    if (el.complete && el.naturalWidth) done(el.naturalWidth, el.naturalHeight)
    else {
      // 懒加载的图片还没下载，单独拉一次拿到尺寸
      const probe = new Image()
      probe.onload = () => done(probe.naturalWidth, probe.naturalHeight)
      probe.onerror = () => done(0, 0)
      probe.src = src
    }
  }
}

/* ---------- 动画 ---------- */
let currentRun = 0
let raf = 0
let caret: HTMLDivElement | null = null
let lastRoot: HTMLElement | null = null

export const hasHighlightApi = () =>
  typeof window !== 'undefined' && 'highlights' in CSS && typeof (window as any).Highlight === 'function'

export const canAnimate = () =>
  hasHighlightApi() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

function ensureCaret() {
  if (caret) return caret
  caret = document.createElement('div')
  caret.className = 'decode-caret'
  caret.setAttribute('aria-hidden', 'true')
  document.body.appendChild(caret)
  return caret
}

/** 先切到 shown 播放淡入，动画结束后去掉属性，不影响元素原本的 transition（比如 hover） */
function reveal({ el, attr }: BlockMark) {
  if (el.getAttribute(attr) !== 'pending') return
  el.setAttribute(attr, 'shown')
  window.setTimeout(() => {
    if (el.getAttribute(attr) === 'shown') el.removeAttribute(attr)
  }, 450)
}
let lastBlocks: BlockMark[] = []

function finish(blocks: BlockMark[]) {
  ;(CSS as any).highlights?.delete(HL_NAME)
  for (const b of blocks) reveal(b)
  if (caret) caret.style.opacity = '0'
  document.documentElement.classList.remove('decode-pending')
}

/** 前若干个 token 以人眼可见的速度流出，之后加速，长文章整体控制在 2 秒左右 */
function tokensAt(t: number, n: number) {
  const warm = Math.min(n, 36)
  const warmRate = 40
  const tw = warm / warmRate
  if (t < tw) return Math.floor(t * warmRate)
  const rem = n - warm
  const d = Math.min(1.6, Math.max(0.25, rem / 1200))
  const u = (t - tw) / d
  return u >= 1 ? n : warm + Math.floor(rem * u * u)
}

export function stopDecode() {
  currentRun++
  cancelAnimationFrame(raf)
}

export function startDecode(root: HTMLElement | null, animate = canAnimate()) {
  stopDecode()
  const runId = currentRun
  if (!root) {
    document.documentElement.classList.remove('decode-pending')
    return
  }
  lastRoot = root

  // 上一次（可能被打断的）decoding 留下的属性先清掉
  for (const { el, attr } of lastBlocks) el.removeAttribute(attr)
  const { toks, imgs, gaps, blocks } = collect(root)
  lastBlocks = blocks
  const tStart = performance.now()
  Object.assign(decodeState, {
    phase: 'prefill',
    animated: animate,
    tStart,
    tFirst: null,
    tEnd: null,
    ttft: null,
    tps: null,
    avgTps: null,
    duration: null,
    decoded: 0,
    textTokens: toks.length,
    imageTokens: 0,
    images: imgs.length,
    imagesMeasured: 0
  })
  measureImages(imgs, runId)

  if (!animate || toks.length === 0) {
    finish(blocks)
    Object.assign(decodeState, { phase: 'done', decoded: toks.length, tEnd: performance.now() })
    return
  }

  // 光标之后的文字全部透明（绕开 gaps 里的元素），图片和装饰块先隐藏
  const hl = new (window as any).Highlight()
  const setPending = (node: Node, offset: number, k: number) => {
    hl.clear()
    let cur = new Range()
    cur.setStart(node, offset)
    for (const g of gaps) {
      if (g.at < k || !g.el.isConnected) continue
      cur.setEndBefore(g.el)
      hl.add(cur)
      cur = new Range()
      cur.setStartAfter(g.el)
    }
    cur.setEnd(root, root.childNodes.length)
    hl.add(cur)
  }
  setPending(root, 0, 0)
  ;(CSS as any).highlights.set(HL_NAME, hl)
  for (const { el, attr } of blocks) el.setAttribute(attr, 'pending')
  document.documentElement.classList.remove('decode-pending')

  const c = ensureCaret()
  const caretRange = new Range()
  const t0 = tStart
  const prefillMs = 200 + (Math.random() - 0.5) * 220 * Math.min(1, T)
  let tFirst = 0
  let blockIdx = 0
  const samples: [number, number][] = []
  // 虚拟时钟：温度越高，每帧推进的速度随机起伏越大（可能停顿、也可能突然一大段）
  let vt = 0
  let lastNow = 0
  let noise = 0

  const frame = () => {
    if (runId !== currentRun) return
    const now = performance.now()
    const t = now - t0
    if (t < prefillMs) {
      raf = requestAnimationFrame(frame)
      return
    }
    if (!tFirst) {
      tFirst = now
      lastNow = now
      decodeState.tFirst = now
      decodeState.ttft = Math.round(t)
      decodeState.phase = 'decode'
    }
    noise = Math.max(-1, Math.min(1, noise * 0.82 + (Math.random() * 2 - 1) * 0.55))
    vt += ((now - lastNow) / 1000) * Math.max(0, 1 + noise * T * 1.3)
    lastNow = now
    const target = Math.max(decodeState.decoded + (Math.random() > T * 0.4 ? 1 : 0), tokensAt(vt, toks.length))
    const k = Math.max(1, Math.min(toks.length, target))
    const tok = toks[k - 1]
    if (!tok.node.isConnected) {
      // 页面内容被重新渲染了（比如切换了显示），直接结束
      finish(blocks)
      Object.assign(decodeState, { phase: 'done', decoded: toks.length, tEnd: now })
      return
    }
    decodeState.decoded = k
    try {
      setPending(tok.node, tok.end, k)
    } catch {
      /* 节点已变化，忽略这一帧 */
    }
    while (blockIdx < blocks.length && blocks[blockIdx].at <= k) reveal(blocks[blockIdx++])

    // 瞬时速度：最近 300ms 的 token 数
    samples.push([now, k])
    while (samples.length > 2 && now - samples[0][0] > 300) samples.shift()
    const [ts, ks] = samples[0]
    if (now > ts) decodeState.tps = ((k - ks) / (now - ts)) * 1000

    // 光标跟随
    caretRange.setStart(tok.node, tok.end)
    caretRange.collapse(true)
    const r = caretRange.getClientRects()[0]
    if (r && r.bottom > 0 && r.top < innerHeight) {
      const jx = (Math.random() - 0.5) * T * 3
      const jy = (Math.random() - 0.5) * T * 2
      c.style.opacity = '1'
      c.style.transform = `translate(${Math.round(r.right + 1 + jx)}px, ${Math.round(r.top + jy)}px)`
      c.style.height = `${Math.round(r.height)}px`
    } else {
      c.style.opacity = '0'
    }

    if (k >= toks.length) {
      finish(blocks)
      const dur = (now - t0) / 1000
      Object.assign(decodeState, {
        phase: 'done',
        tEnd: now,
        duration: dur,
        avgTps: toks.length / Math.max(0.001, (now - tFirst) / 1000),
        tps: null
      })
      return
    }
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
}

/** 手动重放：用户主动点击，所以即使开了「减少动态效果」也播放 */
export function replayDecode() {
  if (lastRoot?.isConnected) startDecode(lastRoot, hasHighlightApi())
}
