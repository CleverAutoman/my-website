// 流程图的数据模型和画法。存成 ```flow 代码块里的 JSON（节点带坐标，编辑器里拖动摆放），
// 页面上构建时直接输出静态 SVG（flowToSvg），浏览器不需要任何库。编辑器（FlowEditor.vue）用同一套几何函数。
// 纯函数，不碰 DOM：服务端渲染和浏览器共用。

/**
 * 形状：rect / round / diamond / circle 是普通节点；
 * text 是没有边框的文字标注（层名、旁注）；group 是虚线分组框，文字是左上角的组名，画在最底层
 */
export type Shape = 'rect' | 'round' | 'diamond' | 'circle' | 'text' | 'group'
export type Tone = 'default' | 'brand' | 'blue' | 'green' | 'violet' | 'muted'
export type TextSize = 'sm' | 'md' | 'lg'

export interface FlowNode {
  id: string
  /** 左上角坐标 */
  x: number
  y: number
  w: number
  h: number
  /** 第一行是标题，后面的行按副标题显示（小一号、淡一点） */
  text: string
  shape: Shape
  tone?: Tone
  /** 实心：用颜色填满（默认是浅色底） */
  fill?: boolean
  size?: TextSize
  /** 手动调过大小：改文字时只会变大，不会缩回自动尺寸 */
  lock?: boolean
}
export interface FlowEdge {
  from: string
  to: string
  label?: string
  dashed?: boolean
}
export interface FlowData {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export const SHAPES: { shape: Shape; label: string }[] = [
  { shape: 'rect', label: '方框' },
  { shape: 'round', label: '圆角' },
  { shape: 'diamond', label: '判断' },
  { shape: 'circle', label: '圆' },
  { shape: 'text', label: '文字' },
  { shape: 'group', label: '分组' }
]
export const TEXT_SIZES: { size: TextSize; label: string; px: number }[] = [
  { size: 'sm', label: '小', px: 12 },
  { size: 'md', label: '中', px: 14 },
  { size: 'lg', label: '大', px: 18 }
]
export const fontPx = (size?: TextSize) => TEXT_SIZES.find((s) => s.size === (size ?? 'md'))!.px
const subPx = (px: number) => Math.round(px * 0.86)
const lineH = (px: number) => Math.round(px * 1.45)
export const TONES: { tone: Tone; label: string }[] = [
  { tone: 'default', label: '默认' },
  { tone: 'brand', label: '橙' },
  { tone: 'blue', label: '蓝' },
  { tone: 'green', label: '绿' },
  { tone: 'violet', label: '紫' },
  { tone: 'muted', label: '灰' }
]

export const LINE_H = 20
export const FONT_SIZE = 14
export const GRID = 10

/* ---------- 尺寸 ---------- */

/** 没有浏览器量字时的估算宽度（服务端、手写的 JSON） */
export function estimateWidth(text: string, size = FONT_SIZE) {
  let w = 0
  for (const ch of text) {
    if (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch)) w += size
    else if (ch === ' ') w += size * 0.3
    else if (/[A-Z0-9]/.test(ch)) w += size * 0.62
    else w += size * 0.52
  }
  return w
}

/** 按文字算节点大小；判断（菱形）和圆要留出更多空间。measure(文字, 字号px) 返回宽度 */
export function fitSize(
  text: string,
  shape: Shape,
  measure: (s: string, px: number) => number = estimateWidth,
  size?: TextSize
) {
  const px = fontPx(size)
  const lines = (text || '').split('\n')
  const tw = Math.max(...lines.map((l, i) => measure(l || ' ', i ? subPx(px) : px)))
  const th = lines.reduce((s, _l, i) => s + lineH(i ? subPx(px) : px), 0)
  const r = (n: number) => Math.ceil(n / GRID) * GRID
  if (shape === 'text') return { w: r(Math.max(20, tw + 8)), h: r(Math.max(20, th + 4)) }
  if (shape === 'group') return { w: r(Math.max(240, tw + 60)), h: 160 }
  let w = Math.max(88, tw + 32)
  let h = Math.max(40, th + 20)
  if (shape === 'diamond') {
    w = Math.max(110, tw * 1.5 + 40)
    h = Math.max(64, th * 1.6 + 30)
  } else if (shape === 'circle') {
    w = h = Math.max(64, Math.max(tw, th) + 34)
  } else if (shape === 'round') {
    w += 12
  }
  return { w: r(w), h: r(h) }
}

/* ---------- 形状 ---------- */

/** 节点外框路径，原点是节点左上角 */
export function shapePath(n: Pick<FlowNode, 'w' | 'h' | 'shape'>): string {
  const { w, h } = n
  switch (n.shape) {
    case 'diamond':
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`
    case 'circle':
      return `M0,${h / 2} A${w / 2},${h / 2} 0 1,0 ${w},${h / 2} A${w / 2},${h / 2} 0 1,0 0,${h / 2} Z`
    case 'text':
      return ''
    default: {
      const r = Math.min(n.shape === 'round' ? h / 2 : n.shape === 'group' ? 12 : 6, w / 2, h / 2)
      return `M${r},0 H${w - r} A${r},${r} 0 0,1 ${w},${r} V${h - r} A${r},${r} 0 0,1 ${w - r},${h} H${r} A${r},${r} 0 0,1 0,${h - r} V${r} A${r},${r} 0 0,1 ${r},0 Z`
    }
  }
}

/**
 * 文字每一行的位置（相对节点左上角，dominant-baseline: central）。
 * 第一行是标题，其余是副标题（小一号）；分组的文字是左上角的组名
 */
export function textLines(n: Pick<FlowNode, 'text' | 'w' | 'h' | 'shape' | 'size'>) {
  const px = fontPx(n.size)
  if (n.shape === 'group') return [{ t: (n.text || '').replace(/\n/g, ' '), x: 16, y: 22, px, sub: false }]
  const lines = (n.text || '').split('\n')
  const hs = lines.map((_l, i) => lineH(i ? subPx(px) : px))
  let y = n.h / 2 - hs.reduce((a, b) => a + b, 0) / 2
  return lines.map((t, i) => {
    const mid = y + hs[i] / 2
    y += hs[i]
    return { t, x: n.w / 2, y: mid, px: i ? subPx(px) : px, sub: i > 0 }
  })
}

/** 节点的 class：形状、颜色、实心（页面和编辑器共用，样式在 style.css） */
export const nodeClass = (n: Pick<FlowNode, 'shape' | 'tone' | 'fill'>) =>
  `flow-node shape-${n.shape} tone-${n.tone ?? 'default'}${n.fill && n.shape !== 'text' && n.shape !== 'group' ? ' fill' : ''}`

/* ---------- 连线 ---------- */

const center = (n: FlowNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 })

/** 从节点中心朝 (tx, ty) 方向，落在外框上的点 */
function border(n: FlowNode, tx: number, ty: number) {
  const c = center(n)
  const dx = tx - c.x
  const dy = ty - c.y
  if (!dx && !dy) return c
  const a = n.w / 2
  const b = n.h / 2
  let t: number
  if (n.shape === 'diamond') t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
  else if (n.shape === 'circle') t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
  else t = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

/**
 * 一条连线的路径。两个节点之间有来回两条线时各自往一侧弯（bend），不重叠。
 * 返回路径和标签位置
 */
export function edgeGeometry(a: FlowNode, b: FlowNode, bend = 0) {
  const ca = center(a)
  const cb = center(b)
  const mx = (ca.x + cb.x) / 2
  const my = (ca.y + cb.y) / 2
  const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1
  // 垂直方向偏移出控制点
  const cx = mx + (-(cb.y - ca.y) / len) * bend
  const cy = my + ((cb.x - ca.x) / len) * bend
  const s = border(a, bend ? cx : cb.x, bend ? cy : cb.y)
  const e = border(b, bend ? cx : ca.x, bend ? cy : ca.y)
  const f = (v: number) => Math.round(v * 10) / 10
  if (!bend) return { d: `M${f(s.x)},${f(s.y)} L${f(e.x)},${f(e.y)}`, mid: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } }
  return {
    d: `M${f(s.x)},${f(s.y)} Q${f(cx)},${f(cy)} ${f(e.x)},${f(e.y)}`,
    mid: { x: 0.25 * s.x + 0.5 * cx + 0.25 * e.x, y: 0.25 * s.y + 0.5 * cy + 0.25 * e.y }
  }
}

/** 每条线的弯曲量：有反向线时弯开 */
export function bends(data: FlowData) {
  const key = (e: FlowEdge) => `${e.from}\u0000${e.to}`
  const set = new Set(data.edges.map(key))
  return data.edges.map((e) => (set.has(`${e.to}\u0000${e.from}`) ? 26 : 0))
}

/* ---------- 序列化 ---------- */

let idSeq = 0
export function newId(data: FlowData) {
  const used = new Set(data.nodes.map((n) => n.id))
  let id: string
  do id = 'n' + (++idSeq).toString(36)
  while (used.has(id))
  return id
}

/** 读 ```flow 的正文，容错：缺字段补默认值，坏掉的连线丢掉 */
export function parseFlow(body: string): FlowData {
  let raw: any
  try {
    raw = body.trim() ? JSON.parse(body) : {}
  } catch (e: any) {
    throw new Error(`流程图 JSON 解析失败：${e.message}`)
  }
  const nodes: FlowNode[] = (Array.isArray(raw.nodes) ? raw.nodes : []).map((n: any, i: number) => {
    const shape: Shape = SHAPES.some((s) => s.shape === n.shape) ? n.shape : 'rect'
    const text = String(n.text ?? '')
    const textSize: TextSize | undefined = TEXT_SIZES.some((t) => t.size === n.size) && n.size !== 'md' ? n.size : undefined
    const size = fitSize(text, shape, undefined, textSize)
    return {
      id: String(n.id ?? `n${i}`),
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
      w: Number(n.w) || size.w,
      h: Number(n.h) || size.h,
      text,
      shape,
      ...(TONES.some((t) => t.tone === n.tone) && n.tone !== 'default' ? { tone: n.tone } : {}),
      ...(n.fill ? { fill: true } : {}),
      ...(textSize ? { size: textSize } : {}),
      ...(n.lock ? { lock: true } : {})
    }
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges: FlowEdge[] = (Array.isArray(raw.edges) ? raw.edges : [])
    .filter((e: any) => ids.has(String(e.from)) && ids.has(String(e.to)) && e.from !== e.to)
    .map((e: any) => ({
      from: String(e.from),
      to: String(e.to),
      ...(e.label ? { label: String(e.label) } : {}),
      ...(e.dashed ? { dashed: true } : {})
    }))
  return { nodes, edges }
}

/** 写回 JSON：一行一个节点 / 连线，diff 好读 */
export function stringifyFlow(data: FlowData): string {
  const node = (n: FlowNode) =>
    JSON.stringify({
      id: n.id,
      text: n.text,
      shape: n.shape,
      ...(n.tone && n.tone !== 'default' ? { tone: n.tone } : {}),
      ...(n.fill ? { fill: true } : {}),
      ...(n.size && n.size !== 'md' ? { size: n.size } : {}),
      x: Math.round(n.x),
      y: Math.round(n.y),
      w: Math.round(n.w),
      h: Math.round(n.h),
      ...(n.lock ? { lock: true } : {})
    })
  const edge = (e: FlowEdge) => JSON.stringify(e)
  const list = (items: string[]) => (items.length ? `[\n    ${items.join(',\n    ')}\n  ]` : '[]')
  return `{\n  "nodes": ${list(data.nodes.map(node))},\n  "edges": ${list(data.edges.map(edge))}\n}`
}

export function emptyFlow(): FlowData {
  const a = { id: 'start', text: '开始', shape: 'round' as Shape, x: 0, y: 0 }
  const b = { id: 'step', text: '处理', shape: 'rect' as Shape, x: 200, y: 0 }
  const nodes = [a, b].map((n) => ({ ...n, ...fitSize(n.text, n.shape) }))
  nodes[1].y = nodes[0].y + (nodes[0].h - nodes[1].h) / 2
  return { nodes, edges: [{ from: 'start', to: 'step' }] }
}

/* ---------- 静态 SVG（页面、编辑器里的块预览） ---------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function flowBounds(data: FlowData, pad = 16) {
  if (!data.nodes.length) return { x: 0, y: 0, w: 200, h: 80 }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const n of data.nodes) {
    x1 = Math.min(x1, n.x)
    y1 = Math.min(y1, n.y)
    x2 = Math.max(x2, n.x + n.w)
    y2 = Math.max(y2, n.y + n.h)
  }
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 }
}

export function flowToSvg(data: FlowData, uid: string): string {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const b = flowBounds(data)
  const marker = `flow-arrow-${uid}`
  const bendList = bends(data)
  const edges = data.edges
    .map((e, i) => {
      const a = byId.get(e.from)
      const z = byId.get(e.to)
      if (!a || !z) return ''
      const g = edgeGeometry(a, z, bendList[i])
      let label = ''
      if (e.label) {
        const lw = estimateWidth(e.label, 12) + 10
        label =
          `<g class="flow-label"><rect x="${g.mid.x - lw / 2}" y="${g.mid.y - 10}" width="${lw}" height="20" rx="4"/>` +
          `<text x="${g.mid.x}" y="${g.mid.y}" text-anchor="middle" dominant-baseline="central">${esc(e.label)}</text></g>`
      }
      return `<g class="flow-edge${e.dashed ? ' dashed' : ''}"><path d="${g.d}" marker-end="url(#${marker})"/>${label}</g>`
    })
    .join('')
  const node = (n: FlowNode) => {
    const anchor = n.shape === 'group' ? 'start' : 'middle'
    const text = textLines(n)
      .map((l) => `<tspan x="${l.x}" y="${l.y}" font-size="${l.px}"${l.sub ? ' class="sub"' : ''}>${esc(l.t)}</tspan>`)
      .join('')
    const path = shapePath(n)
    return (
      `<g class="${nodeClass(n)}" transform="translate(${n.x},${n.y})">` +
      (path ? `<path d="${path}"/>` : '') +
      `<text text-anchor="${anchor}" dominant-baseline="central">${text}</text></g>`
    )
  }
  const groups = data.nodes.filter((n) => n.shape === 'group').map(node).join('')
  const nodes = data.nodes.filter((n) => n.shape !== 'group').map(node).join('')
  return (
    `<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="${b.w}" height="${b.h}" role="img" aria-label="流程图">` +
    `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">` +
    `<path class="flow-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>${groups}${edges}${nodes}</svg>`
  )
}

/* ---------- 从 Mermaid 流程图导入（只认常见写法），自动分层排版 ---------- */

export function fromMermaid(src: string): FlowData {
  const lines = src.split(/\n|;/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'))
  const head = lines[0]?.match(/^(?:flowchart|graph)\s*(LR|RL|TD|TB|BT)?/i)
  if (!head) throw new Error('只支持 Mermaid 的 flowchart / graph')
  const dir = (head[1] ?? 'TD').toUpperCase()
  const nodes = new Map<string, { text: string; shape: Shape }>()
  const edges: FlowEdge[] = []
  const NODE = /^([A-Za-z0-9_一-鿿]+)\s*(\(\[(.*?)\]\)|\(\((.*?)\)\)|\[(.*?)\]|\{(.*?)\}|\((.*?)\))?/
  const EDGE = /^(-->\|([^|]*)\||--\s*([^->][^>]*?)\s*-->|-\.\s*([^.]+?)\s*\.->|-\.->|==>|-->|---)/
  const strip = (s: string) => s.replace(/^"|"$/g, '').trim()
  const take = (m: RegExpMatchArray) => {
    const id = m[1]
    const [, , , round, circle, rect, diamond, paren] = m
    const shape: Shape | null = round != null ? 'round' : circle != null ? 'circle' : rect != null ? 'rect' : diamond != null ? 'diamond' : paren != null ? 'round' : null
    const text = round ?? circle ?? rect ?? diamond ?? paren
    const prev = nodes.get(id)
    if (!prev) nodes.set(id, { text: strip(text ?? id), shape: shape ?? 'rect' })
    else if (shape) nodes.set(id, { text: strip(text!), shape })
    return id
  }
  for (const line of lines.slice(1)) {
    if (/^(subgraph|end|style|classDef|class|click|linkStyle)\b/.test(line)) continue
    let rest = line
    let m = rest.match(NODE)
    if (!m) continue
    let from = take(m)
    rest = rest.slice(m[0].length).trim()
    while (rest) {
      const em = rest.match(EDGE)
      if (!em) break
      rest = rest.slice(em[0].length).trim()
      const nm = rest.match(NODE)
      if (!nm) break
      const to = take(nm)
      rest = rest.slice(nm[0].length).trim()
      const label = (em[2] ?? em[3] ?? em[4] ?? '').trim()
      if (from !== to) edges.push({ from, to, ...(label ? { label: strip(label) } : {}), ...(em[0].includes('.') ? { dashed: true } : {}) })
      from = to
    }
  }
  // 分层：先用 DFS 找出回边（环）忽略掉，剩下的按最长路径分层
  const ids = [...nodes.keys()]
  const out1 = new Map(ids.map((id) => [id, [] as FlowEdge[]]))
  for (const e of edges) out1.get(e.from)!.push(e)
  const back = new Set<FlowEdge>()
  const state = new Map<string, 1 | 2>()
  const dfs = (id: string) => {
    state.set(id, 1)
    for (const e of out1.get(id)!) {
      const s = state.get(e.to)
      if (s === 1) back.add(e)
      else if (!s) dfs(e.to)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (!state.get(id)) dfs(id)
  const dag = edges.filter((e) => !back.has(e))
  const rank = new Map(ids.map((id) => [id, 0]))
  for (let i = 0; i < ids.length; i++) {
    let changed = false
    for (const e of dag) {
      if (rank.get(e.to)! < rank.get(e.from)! + 1) {
        rank.set(e.to, rank.get(e.from)! + 1)
        changed = true
      }
    }
    if (!changed) break
  }
  const layers: string[][] = []
  for (const id of ids) (layers[rank.get(id)!] ??= []).push(id)
  const out: FlowNode[] = []
  const horizontal = dir === 'LR' || dir === 'RL'
  layers.forEach((layer, li) => {
    layer.forEach((id, i) => {
      const n = nodes.get(id)!
      const size = fitSize(n.text, n.shape)
      const along = li * (horizontal ? 200 : 110)
      const across = (i - (layer.length - 1) / 2) * (horizontal ? 100 : 190)
      const cx = horizontal ? along : across
      const cy = horizontal ? across : along
      out.push({ id, text: n.text, shape: n.shape, ...size, x: Math.round((cx - size.w / 2) / GRID) * GRID, y: Math.round((cy - size.h / 2) / GRID) * GRID })
    })
  })
  if (dir === 'RL' || dir === 'BT') for (const n of out) horizontal ? (n.x = -n.x - n.w) : (n.y = -n.y - n.h)
  return { nodes: out, edges }
}
