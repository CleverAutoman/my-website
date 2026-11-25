<script setup lang="ts">
// 写作编辑器的编辑区：CodeMirror 6 + Markdown 语法渲染（标题字号、粗斜体、代码块、引用、图片缩略图），
// 源码一个字符都不改，所有标记仍然可见可编辑，只是弱化显示。只被 PostEditor 引用，不进生产包。
import { createApp, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder, Decoration, WidgetType, ViewPlugin, type DecorationSet } from '@codemirror/view'
import { EditorState, EditorSelection, Compartment, StateField, type Extension, type Range } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { BLOCK_KINDS, CALLOUTS, CALLOUT_PLACEHOLDER, MINDMAP_TEMPLATE, calloutText, formatFence, parseFence, type Block, type BlockKind, type CalloutType } from '../blocks/fence'

// 高亮块（VitePress 容器）认识的类型；其他名字按 info 上色
const CALLOUT_TYPES = new Set(['info', 'tip', 'warning', 'danger', 'details', 'note', 'important', 'caution'])
const CALLOUT_COLORS: Record<string, { accent: string; bg: string }> = {
  ...Object.fromEntries(CALLOUTS.map((c) => [c.type, c])),
  note: { accent: 'var(--vp-c-text-2)', bg: 'var(--vp-custom-block-note-bg)' },
  important: { accent: 'var(--vp-c-important-1)', bg: 'var(--vp-custom-block-important-bg)' },
  caution: { accent: 'var(--vp-c-danger-1)', bg: 'var(--vp-custom-block-caution-bg)' }
}
import { emptyFlow, fromMermaid, parseFlow, stringifyFlow, type FlowData } from '../blocks/flow'
import FlowEditor from './FlowEditor.vue'

const props = defineProps<{
  modelValue: string
  /** 换文件时变化：整篇替换并清空撤销历史 */
  docKey: string
  disabled?: boolean
  placeholder?: string
  /** 把 markdown 里的图片地址转成浏览器能取到的地址 */
  resolveImage?: (src: string) => string | null
  /** 围栏代码块显示成「块」（false 时显示源码） */
  blocks?: boolean
  /** 块里思维导图的预览（要调服务端渲染，由外面提供） */
  blockPreview?: (block: Block, el: HTMLElement) => void
}>()
const emit = defineEmits<{
  'update:modelValue': [string]
  save: []
  images: [File[]]
  scroll: [number]
  caret: []
}>()

const host = ref<HTMLDivElement>()
let view: EditorView | undefined
const editable = new Compartment()
const blockMode = new Compartment()

/* ---------- 语法高亮：把 markdown 标记渲染成接近成文的样子 ---------- */
const mono = 'var(--vp-font-family-mono)'
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.7em', fontWeight: '700', lineHeight: '1.4' },
  { tag: t.heading2, fontSize: '1.4em', fontWeight: '700', lineHeight: '1.45' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '650' },
  { tag: [t.heading4, t.heading5, t.heading6], fontSize: '1.05em', fontWeight: '650' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--vp-c-text-2)' },
  { tag: t.link, color: 'var(--vp-c-brand-1)' },
  { tag: t.url, color: 'var(--vp-c-text-3)', fontSize: '0.92em' },
  { tag: t.monospace, fontFamily: mono, fontSize: '0.88em', color: 'var(--vp-c-brand-1)', background: 'var(--x-panel-2)', borderRadius: '4px', padding: '1px 3px' },
  { tag: t.quote, color: 'var(--vp-c-text-2)' },
  // #、**、`、>、- 这些标记弱化显示
  { tag: [t.processingInstruction, t.contentSeparator], color: 'var(--vp-c-text-3)', fontWeight: '400', fontStyle: 'normal' },
  { tag: [t.comment, t.meta], color: 'var(--vp-c-text-3)' },
  // HTML / Vue 组件标签
  { tag: [t.tagName, t.angleBracket], color: 'var(--x-violet)', fontFamily: mono, fontSize: '0.92em' },
  { tag: t.attributeName, color: 'var(--x-blue)', fontFamily: mono, fontSize: '0.92em' },
  { tag: t.attributeValue, color: 'var(--vp-c-text-2)', fontFamily: mono, fontSize: '0.92em' },
  // frontmatter（YAML）和代码块里的各种语言
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--vp-c-brand-1)' },
  { tag: t.keyword, color: 'var(--x-violet)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--x-blue)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--vp-c-brand-1)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--vp-c-text-1)', fontWeight: '600' },
  { tag: [t.typeName, t.className], color: 'var(--x-blue)' },
  { tag: [t.operator, t.punctuation], color: 'var(--vp-c-text-2)' },
  { tag: t.invalid, color: 'var(--x-err)' }
])

/* ---------- 整行装饰：frontmatter、代码块、引用、::: 容器；图片下方显示缩略图 ---------- */
class ImageWidget extends WidgetType {
  constructor(readonly src: string) {
    super()
  }
  eq(other: ImageWidget) {
    return other.src === this.src
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-md-img'
    const img = document.createElement('img')
    img.src = this.src
    img.alt = ''
    img.onerror = () => wrap.classList.add('broken')
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

const lineDeco = (cls: string) => Decoration.line({ class: cls })
const IMG_RE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc
  const out: Range<Decoration>[] = []
  const skip = new Set<number>() // 代码块和 frontmatter 里的行不再识别容器和图片
  const block = (from: number, to: number, cls: string) => {
    const a = doc.lineAt(from).number
    const b = doc.lineAt(to).number
    for (let i = a; i <= b; i++) {
      const edge = (i === a ? ' first' : '') + (i === b ? ' last' : '')
      out.push(lineDeco(cls + edge).range(doc.line(i).from))
      if (cls !== 'cm-md-quote') skip.add(i)
    }
  }

  if (doc.lines > 1 && doc.line(1).text.trim() === '---') {
    for (let i = 2; i <= doc.lines; i++) {
      if (doc.line(i).text.trim() === '---') {
        block(0, doc.line(i).from, 'cm-md-fm')
        break
      }
    }
  }
  // 块视图：开头那行（```lang title=…）做成块的标题栏；流程图的正文被画布替换，只给开头那行加样式
  const boxes = state.field(boxField, false) ? findBoxes(state) : []
  const flows = new Set(boxes.filter((b) => b.block.kind === 'flow').map((b) => b.from))
  const heads = new Set(boxes.map((b) => b.from))
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode') {
        const head = doc.lineAt(node.from)
        if (flows.has(head.from)) {
          out.push(lineDeco('cm-md-code first last cm-block-head flow').range(head.from))
          for (let i = head.number; i <= doc.lineAt(node.to).number; i++) skip.add(i)
          return false
        }
        if (heads.has(head.from)) out.push(lineDeco('cm-block-head').range(head.from))
      }
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        block(node.from, node.to, 'cm-md-code')
        return false
      }
      if (node.name === 'Blockquote') block(node.from, node.to, 'cm-md-quote')
    }
  })
  // 高亮块（::: tip … :::）：整段按类型上色，和页面上的样子对应；没闭合时只标开头那行
  const open: { line: number; type: string }[] = []
  for (let i = 1; i <= doc.lines; i++) {
    if (skip.has(i)) continue
    const text = doc.line(i).text
    const m = text.match(/^\s*:::+\s*([A-Za-z-]+)/)
    if (m) open.push({ line: i, type: CALLOUT_TYPES.has(m[1]) ? m[1] : 'info' })
    else if (/^\s*:::+\s*$/.test(text) && open.length) {
      const o = open.pop()!
      for (let j = o.line; j <= i; j++) {
        const edge = j === o.line ? ' head' : j === i ? ' tail' : ''
        out.push(lineDeco(`cm-callout cm-callout-${o.type}${edge}`).range(doc.line(j).from))
      }
    }
  }
  for (const o of open) out.push(lineDeco(`cm-callout cm-callout-${o.type} head tail`).range(doc.line(o.line).from))

  for (let i = 1; i <= doc.lines; i++) {
    if (skip.has(i)) continue
    const line = doc.line(i)
    if (!line.text.includes('![') || !props.resolveImage) continue
    for (const m of line.text.matchAll(IMG_RE)) {
      const src = props.resolveImage(m[1])
      if (src) out.push(Decoration.widget({ widget: new ImageWidget(src), block: true, side: 1 }).range(line.to))
    }
  }
  return Decoration.set(out, true)
}

// 图片是块级 widget，只能放在 StateField 里；语法树解析到新位置时也要重算
const decorations = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, tr) {
    if (tr.docChanged || tr.reconfigured || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildDecorations(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

/* ---------- 块（原地编辑）：顶格、闭合的围栏代码块 ----------
 * 代码、思维导图：源码就在原地编辑（代码样式），开头那行右边有复制 / 删除，导图下方实时预览。
 * 流程图：正文的 JSON 换成能直接操作的画布（拖动、连线、双击改属性），改动实时写回文档；
 * 开头那行（```flow title="…"）照常编辑。底栏关掉「块视图」就全部显示成源码。 */
interface BoxRange {
  from: number
  to: number
  source: string
  block: Block
  /** 开头那行的行尾 */
  headTo: number
  /** 正文第一行的行首；正文为空时等于 closeFrom */
  bodyFrom: number
  /** 结尾 ``` 那行的行首 */
  closeFrom: number
}

function findBoxes(state: EditorState): BoxRange[] {
  const out: BoxRange[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return
      const first = state.doc.lineAt(node.from)
      const last = state.doc.lineAt(node.to)
      // 有缩进的（列表、引用里的）和没闭合的保持普通源码
      if (first.from === node.from && first.number < last.number) {
        const source = state.sliceDoc(first.from, last.to)
        const block = parseFence(source)
        if (block) out.push({ from: first.from, to: last.to, source, block, headTo: first.to, bodyFrom: first.to + 1, closeFrom: last.from })
      }
      return false
    }
  })
  return out
}
const boxAt = (state: EditorState, pos: number) => findBoxes(state).find((b) => pos >= b.from && pos <= b.to) ?? null

const el = (tag: string, cls = '', text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
function flash(btn: HTMLElement, text: string) {
  const old = btn.textContent
  btn.textContent = text
  setTimeout(() => (btn.textContent = old), 1200)
}

/** 开头那行右边的操作：复制、删除（Mermaid 代码块多一个「转成流程图」） */
class BlockActionsWidget extends WidgetType {
  constructor(readonly kind: BlockKind, readonly lang: string) {
    super()
  }
  eq(o: BlockActionsWidget) {
    return o.kind === this.kind && o.lang === this.lang
  }
  toDOM(v: EditorView) {
    const wrap = el('span', 'cm-block-acts')
    if (this.kind !== 'code') wrap.append(el('span', 'cm-block-kind', BLOCK_KINDS.find((k) => k.kind === this.kind)!.label))
    const btn = (label: string, act: string, title = '') => {
      const b = el('button', '', label) as HTMLButtonElement
      b.type = 'button'
      b.dataset.act = act
      b.title = title
      wrap.append(b)
    }
    if (this.kind === 'code' && this.lang === 'mermaid') btn('转成流程图', 'mermaid', '把 Mermaid 流程图转成可拖动编辑的流程图')
    btn('复制', 'copy', '复制整个块的源码，粘贴到任意位置就是一个新块')
    btn('删除', 'delete', '删除整个块')
    wrap.addEventListener('mousedown', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('button')
      if (!target) return
      e.preventDefault()
      const b = boxAt(v.state, v.posAtDOM(wrap))
      if (b) blockAction(v, target.dataset.act!, b, target)
    })
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

function blockAction(v: EditorView, act: string, b: BoxRange, btn: HTMLElement) {
  if (act === 'copy') {
    navigator.clipboard.writeText(b.source + '\n').then(
      () => flash(btn, '已复制'),
      () => {
        v.dispatch({ selection: { anchor: b.from, head: b.to } })
        flash(btn, '按 Ctrl+C')
      }
    )
  } else if (act === 'delete') {
    const doc = v.state.doc
    let end = b.to
    if (doc.sliceString(end, end + 1) === '\n') end++
    // 前后都是空行时顺手去掉一个，不留两行空白
    if (b.from > 0 && doc.sliceString(b.from - 1, b.from) === '\n' && doc.sliceString(end, end + 1) === '\n') end++
    v.dispatch({ changes: { from: b.from, to: end }, selection: { anchor: b.from } })
    v.focus()
  } else if (act === 'mermaid') {
    try {
      const data = fromMermaid(b.block.body)
      const text = formatFence({ kind: 'flow', lang: 'flow', meta: b.block.meta, rest: '', body: stringifyFlow(data) })
      v.dispatch({ changes: { from: b.from, to: b.to, insert: text } })
    } catch (e: any) {
      alert(e.message)
    }
  }
}

/** 思维导图：结尾 ``` 下面实时预览（渲染走 dev server，由外面提供） */
class MindmapPreviewWidget extends WidgetType {
  constructor(readonly block: Block) {
    super()
  }
  eq(o: MindmapPreviewWidget) {
    return o.block.body === this.block.body && o.block.meta.height === this.block.meta.height
  }
  get estimatedHeight() {
    return 280
  }
  private render(dom: HTMLElement) {
    const h = Math.min(Number(this.block.meta.height) || 260, 360)
    dom.style.setProperty('--mindmap-h', `${h}px`)
    props.blockPreview?.(this.block, dom)
  }
  toDOM() {
    const dom = el('div', 'cm-mm-preview vp-doc')
    this.render(dom)
    return dom
  }
  // 改大纲时复用同一个 DOM 重画，不闪
  updateDOM(dom: HTMLElement) {
    this.render(dom)
    return true
  }
  ignoreEvent() {
    return true
  }
}

/** 流程图：正文换成画布，画布上的改动 250ms 后写回文档（一次改动 = 一步撤销） */
const canvases = new WeakMap<HTMLElement, { set(body: string): void; destroy(): void }>()
class FlowCanvasWidget extends WidgetType {
  constructor(readonly body: string) {
    super()
  }
  eq(o: FlowCanvasWidget) {
    return o.body === this.body
  }
  get estimatedHeight() {
    return 440
  }
  toDOM(v: EditorView) {
    const dom = el('div', 'cm-flow')
    mountFlow(dom, v, this.body)
    return dom
  }
  // 画布自己写回的内容不重建画布；撤销、改源码等外部改动同步进画布
  updateDOM(dom: HTMLElement) {
    const c = canvases.get(dom)
    if (!c) return false
    c.set(this.body)
    return true
  }
  destroy(dom: HTMLElement) {
    canvases.get(dom)?.destroy()
  }
  ignoreEvent() {
    return true
  }
}

function mountFlow(dom: HTMLElement, v: EditorView, body: string) {
  let data: FlowData
  try {
    data = reactive(parseFlow(body))
  } catch (e: any) {
    dom.classList.add('broken')
    dom.append(el('div', 'cm-flow-err', `${e.message}（关掉底栏的「块视图」可以直接改 JSON）`))
    return
  }
  let last = body
  let applying = true // 挂载时画布会按真实字体修正节点大小，这些不算用户改动
  let timer: ReturnType<typeof setTimeout> | undefined
  const write = () => {
    const text = stringifyFlow(data)
    if (text === last || !dom.isConnected) return
    const b = boxAt(v.state, v.posAtDOM(dom))
    if (!b || b.block.kind !== 'flow') return
    last = text
    v.dispatch({
      changes: b.bodyFrom < b.closeFrom ? { from: b.bodyFrom, to: b.closeFrom - 1, insert: text } : { from: b.closeFrom, insert: text + '\n' }
    })
  }
  const stop = watch(
    data,
    () => {
      if (applying) return
      clearTimeout(timer)
      timer = setTimeout(write, 250)
    },
    { deep: true, flush: 'sync' }
  )
  const app = createApp(FlowEditor, { data, compact: true })
  app.mount(dom)
  applying = false
  canvases.set(dom, {
    set(nb) {
      if (nb === last) return
      try {
        const nd = parseFlow(nb)
        applying = true
        data.nodes.splice(0, data.nodes.length, ...nd.nodes)
        data.edges.splice(0, data.edges.length, ...nd.edges)
        last = nb
      } catch {
        // 源码暂时不是合法 JSON（正在改）：画布保持原样
      } finally {
        applying = false
      }
    },
    destroy() {
      clearTimeout(timer)
      stop()
      app.unmount()
    }
  })
}

function buildBoxes(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const b of findBoxes(state)) {
    out.push(Decoration.widget({ widget: new BlockActionsWidget(b.block.kind, b.block.lang), side: 1 }).range(b.headTo))
    if (b.block.kind === 'flow') {
      out.push(Decoration.replace({ widget: new FlowCanvasWidget(b.block.body), block: true }).range(b.bodyFrom, b.to))
    } else if (b.block.kind === 'mindmap' && props.blockPreview) {
      out.push(Decoration.widget({ widget: new MindmapPreviewWidget(b.block), block: true, side: 1 }).range(b.to))
    }
  }
  return Decoration.set(out, true)
}

const boxField: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create: buildBoxes,
  update(value, tr) {
    if (tr.docChanged || tr.reconfigured || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildBoxes(tr.state)
    return value
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))]
})

/** 在 pos（默认光标）处插入一个新块，原地开始编辑 */
function insertKind(kind: BlockKind, atPos?: number) {
  if (kind === 'flow') insertBlockText('```flow\n' + stringifyFlow(emptyFlow()) + '\n```', undefined, atPos)
  else if (kind === 'mindmap') insertBlockText('```mindmap\n' + MINDMAP_TEMPLATE + '\n```', '中心主题', atPos)
  else insertBlockText('```ts\n// 代码\n```', '// 代码', atPos)
}

/* ---------- 左侧 ＋ 号（借鉴飞书）：鼠标移到哪一段，左边出现 ＋，点开菜单新建块 ---------- */
const plusHandle = ViewPlugin.fromClass(
  class {
    btn: HTMLButtonElement
    menu: HTMLDivElement | null = null
    pos = -1
    constructor(readonly v: EditorView) {
      this.btn = el('button', 'cm-plus', '+') as HTMLButtonElement
      this.btn.type = 'button'
      this.btn.title = '在这里插入代码块、流程图、思维导图'
      this.btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.menu ? this.closeMenu() : this.openMenu()
      })
      v.dom.appendChild(this.btn)
      v.dom.addEventListener('mousemove', this.onMove)
      v.dom.addEventListener('mouseleave', this.onLeave)
      v.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    }
    onMove = (e: MouseEvent) => {
      if (this.menu || !this.v.state.facet(EditorView.editable)) return
      if (this.btn.contains(e.target as Node)) return
      const c = this.v.contentDOM.getBoundingClientRect()
      if (e.clientY < c.top || e.clientY > c.bottom) return this.hide()
      const block = this.v.lineBlockAtHeight(e.clientY - this.v.documentTop)
      this.pos = block.from
      const er = this.v.dom.getBoundingClientRect()
      const top = this.v.documentTop + block.top - er.top + Math.min(block.height, 30) / 2 - 11
      if (top < -4 || top > er.height - 16) return this.hide()
      this.btn.style.top = `${top}px`
      this.btn.style.left = `${c.left - er.left + 8}px`
      this.btn.classList.add('show')
    }
    onLeave = (e: MouseEvent) => {
      if (!this.menu && !this.v.dom.contains(e.relatedTarget as Node)) this.hide()
    }
    onScroll = () => {
      if (!this.menu) this.hide()
    }
    onOutside = (e: MouseEvent) => {
      if (this.menu && !this.menu.contains(e.target as Node) && e.target !== this.btn) this.closeMenu()
    }
    onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.closeMenu()
    }
    hide() {
      this.btn.classList.remove('show')
    }
    openMenu() {
      const menu = el('div', 'cm-plus-menu') as HTMLDivElement
      menu.append(el('div', 'cm-plus-title', '插入块'))
      for (const k of BLOCK_KINDS) {
        const item = el('button', 'cm-plus-item') as HTMLButtonElement
        item.type = 'button'
        item.append(el('span', 'icon', k.icon), el('span', '', k.label))
        item.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const pos = this.pos
          this.closeMenu()
          insertKind(k.kind, pos)
        })
        menu.append(item)
      }
      // 高亮块直接插进正文（不是框），选中占位文字，接着打字就行
      menu.append(el('div', 'cm-plus-title', '高亮块'))
      const row = el('div', 'cm-plus-callouts')
      for (const c of CALLOUTS) {
        const item = el('button', `cm-plus-callout cm-callout-${c.type}`) as HTMLButtonElement
        item.type = 'button'
        item.title = `::: ${c.type}`
        item.append(el('span', 'dot'), el('span', '', c.label))
        item.addEventListener('mousedown', (e) => {
          e.preventDefault()
          const pos = this.pos
          this.closeMenu()
          insertCallout(c.type, pos)
        })
        row.append(item)
      }
      menu.append(row)
      // fixed 定位：编辑区很矮时也不会被裁掉；下面放不下就往上弹
      this.v.dom.appendChild(menu)
      const b = this.btn.getBoundingClientRect()
      const h = menu.offsetHeight
      menu.style.position = 'fixed'
      menu.style.left = `${b.left}px`
      menu.style.top = `${b.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, b.top - 4 - h) : b.bottom + 4}px`
      this.menu = menu
      this.btn.classList.add('open')
      document.addEventListener('mousedown', this.onOutside, true)
      document.addEventListener('keydown', this.onKey, true)
    }
    closeMenu() {
      this.menu?.remove()
      this.menu = null
      this.btn.classList.remove('open')
      this.hide()
      document.removeEventListener('mousedown', this.onOutside, true)
      document.removeEventListener('keydown', this.onKey, true)
    }
    update(u: { docChanged: boolean }) {
      if (u.docChanged && !this.menu) this.hide()
    }
    destroy() {
      this.closeMenu()
      this.btn.remove()
      this.v.dom.removeEventListener('mousemove', this.onMove)
      this.v.dom.removeEventListener('mouseleave', this.onLeave)
      this.v.scrollDOM.removeEventListener('scroll', this.onScroll)
    }
  }
)

/* ---------- 编辑命令 ---------- */
function wrapSelection(v: EditorView, mark: string) {
  v.dispatch(
    v.state.changeByRange((r) => {
      const text = v.state.sliceDoc(r.from, r.to)
      // 已经包着同样的标记就去掉，否则加上
      if (text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2) {
        const inner = text.slice(mark.length, text.length - mark.length)
        return { changes: { from: r.from, to: r.to, insert: inner }, range: EditorSelectionRange(r.from, r.from + inner.length) }
      }
      return {
        changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }],
        range: EditorSelectionRange(r.from + mark.length, r.to + mark.length)
      }
    })
  )
  return true
}
const EditorSelectionRange = (a: number, b: number) => EditorSelection.range(a, b)

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--vp-c-bg)', color: 'var(--vp-c-text-1)', fontSize: '15px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--vp-font-family-base)', lineHeight: '1.8', overflow: 'auto' },
  '.cm-content': { padding: '18px 0 40vh', caretColor: 'var(--vp-c-brand-1)' },
  '.cm-line': { padding: '0 28px 0 44px', maxWidth: '876px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--vp-c-brand-1)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, ::selection':
    { backgroundColor: 'var(--vp-c-brand-soft) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--vp-c-default-soft)' },
  '.cm-placeholder': { color: 'var(--vp-c-text-3)' },
  '.cm-panels': { backgroundColor: 'var(--x-panel)', color: 'var(--vp-c-text-1)', borderColor: 'var(--x-border)' },
  '.cm-panels input, .cm-panels button': { color: 'inherit' },
  '.cm-searchMatch': { backgroundColor: 'var(--vp-c-brand-soft)', outline: '1px solid var(--vp-c-brand-1)' },

  // 整块的行：frontmatter、代码块、引用、容器
  '.cm-md-fm, .cm-md-code': { fontFamily: mono, fontSize: '13px', lineHeight: '1.65', backgroundColor: 'var(--x-panel-2)' },
  '.cm-md-fm': { color: 'var(--vp-c-text-2)' },
  '.cm-md-fm.first, .cm-md-code.first': { borderTopLeftRadius: '8px', borderTopRightRadius: '8px', paddingTop: '4px' },
  '.cm-md-fm.last, .cm-md-code.last': { borderBottomLeftRadius: '8px', borderBottomRightRadius: '8px', paddingBottom: '4px' },
  '.cm-md-quote': { borderLeft: '3px solid var(--x-border-hover)', paddingLeft: '41px !important', color: 'var(--vp-c-text-2)' },
  // 高亮块：整段底色 + 左边色条，开头那行（::: tip 标题）做成标签样式
  '.cm-callout': { borderLeft: '3px solid transparent', paddingLeft: '41px !important' },
  '.cm-callout.head': { borderTopRightRadius: '8px', paddingTop: '4px !important', fontFamily: mono, fontSize: '12.5px', fontWeight: '600' },
  '.cm-callout.tail': { borderBottomRightRadius: '8px', paddingBottom: '4px !important', fontFamily: mono, fontSize: '12.5px', color: 'var(--vp-c-text-3)' },
  ...Object.fromEntries(
    Object.entries(CALLOUT_COLORS).flatMap(([type, c]) => [
      [`.cm-callout-${type}`, { backgroundColor: c.bg, borderLeftColor: c.accent }],
      [`.cm-callout-${type}.head`, { color: c.accent }]
    ])
  ),
  '.cm-md-img': { padding: '4px 28px 10px 44px' },

  // 块：开头那行是标题栏，右边是操作按钮；流程图画布、导图预览接在下面
  '.cm-block-head': { color: 'var(--vp-c-brand-1) !important', fontWeight: '600' },
  '.cm-block-head.flow': { borderBottomLeftRadius: '0 !important', borderBottomRightRadius: '0 !important', paddingBottom: '0 !important' },
  '.cm-block-acts': { float: 'right', display: 'inline-flex', gap: '2px', alignItems: 'center', opacity: '0.45', fontFamily: 'var(--vp-font-family-base)', fontWeight: '400' },
  '.cm-line:hover .cm-block-acts': { opacity: '1' },
  '.cm-block-kind': { marginRight: '6px', fontSize: '12px', color: 'var(--vp-c-text-3)' },
  '.cm-block-acts button': {
    padding: '0 7px',
    border: '1px solid transparent',
    borderRadius: '5px',
    background: 'none',
    color: 'var(--vp-c-text-2)',
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '1.6',
    cursor: 'pointer'
  },
  '.cm-block-acts button:hover': { borderColor: 'var(--x-border)', color: 'var(--vp-c-brand-1)', background: 'var(--vp-c-bg)' },
  '.cm-block-acts button[data-act=delete]:hover': { color: 'var(--x-err)' },
  '.cm-flow': {
    margin: '0 28px 8px 44px',
    maxWidth: '804px',
    height: '440px',
    padding: '8px',
    border: '1px solid var(--x-border)',
    borderTop: '0',
    borderRadius: '0 0 8px 8px',
    background: 'var(--x-panel-2)',
    lineHeight: '1.5',
    fontSize: '13px'
  },
  '.cm-flow.broken': { height: 'auto' },
  '.cm-flow-err': { color: 'var(--x-err)', fontSize: '12.5px' },
  '.cm-mm-preview': {
    margin: '4px 28px 8px 44px',
    maxWidth: '804px',
    border: '1px dashed var(--x-border)',
    borderRadius: '8px',
    overflow: 'hidden',
    lineHeight: '1.5'
  },

  // 左侧 ＋
  '.cm-plus': {
    position: 'absolute',
    zIndex: '5',
    width: '22px',
    height: '22px',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    border: '1px solid var(--x-border)',
    borderRadius: '6px',
    background: 'var(--vp-c-bg)',
    color: 'var(--vp-c-text-3)',
    fontSize: '16px',
    lineHeight: '1',
    cursor: 'pointer'
  },
  '.cm-plus.show, .cm-plus.open': { display: 'flex' },
  '.cm-plus:hover, .cm-plus.open': { color: 'var(--vp-c-brand-1)', borderColor: 'var(--vp-c-brand-1)' },
  '.cm-plus-menu': {
    position: 'absolute',
    zIndex: '6',
    minWidth: '236px',
    padding: '4px',
    border: '1px solid var(--x-border)',
    borderRadius: '8px',
    background: 'var(--vp-c-bg)',
    boxShadow: '0 8px 24px rgba(0,0,0,.25)'
  },
  '.cm-plus-title': { padding: '4px 8px', fontSize: '12px', color: 'var(--vp-c-text-3)' },
  '.cm-plus-item': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '6px 8px',
    border: '0',
    borderRadius: '6px',
    background: 'none',
    color: 'var(--vp-c-text-1)',
    font: 'inherit',
    fontSize: '13.5px',
    textAlign: 'left',
    cursor: 'pointer'
  },
  '.cm-plus-item:hover': { background: 'var(--vp-c-brand-soft)', color: 'var(--vp-c-brand-1)' },
  '.cm-plus-item .icon': { width: '22px', textAlign: 'center', fontFamily: mono, color: 'var(--vp-c-brand-1)' },
  '.cm-plus-callouts': { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', padding: '0 4px 4px' },
  '.cm-plus-callout': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 8px',
    border: '0',
    borderLeft: '3px solid',
    borderRadius: '4px',
    color: 'var(--vp-c-text-1)',
    font: 'inherit',
    fontSize: '12.5px',
    cursor: 'pointer'
  },
  '.cm-plus-callout:hover': { filter: 'brightness(1.08)', outline: '1px solid var(--x-border-hover)' },
  '.cm-plus-callout .dot': { display: 'none' },
  '.cm-md-img img': { display: 'block', maxWidth: 'min(100%, 520px)', maxHeight: '200px', borderRadius: '6px', border: '1px solid var(--x-border)' },
  '.cm-md-img.broken': { display: 'none' }
})

function extensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    cmPlaceholder(props.placeholder ?? ''),
    yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
    syntaxHighlighting(highlight),
    blockMode.of(props.blocks ? boxField : []),
    decorations,
    plusHandle,
    theme,
    editable.of([EditorView.editable.of(!props.disabled), EditorState.readOnly.of(!!props.disabled)]),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (emit('save'), true) },
      { key: 'Mod-b', run: (v) => wrapSelection(v, '**') },
      { key: 'Mod-i', run: (v) => wrapSelection(v, '*') },
      { key: 'Mod-e', run: (v) => wrapSelection(v, '`') },
      indentWithTab,
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) emit('update:modelValue', u.state.doc.toString())
      if (u.selectionSet) emit('caret')
    }),
    EditorView.domEventHandlers({
      paste(ev) {
        const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        ev.preventDefault()
        emit('images', files)
        return true
      },
      drop(ev, v) {
        const files = [...(ev.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        ev.preventDefault()
        // 光标移到放下的位置，图片引用插在那里
        const pos = v.posAtCoords({ x: ev.clientX, y: ev.clientY })
        if (pos != null) v.dispatch({ selection: { anchor: pos } })
        emit('images', files)
        return true
      }
    })
  ]
}

function freshState(doc: string) {
  return EditorState.create({ doc, extensions: extensions() })
}

function onScroll() {
  const s = view?.scrollDOM
  if (s) emit('scroll', s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight))
}

onMounted(() => {
  view = new EditorView({ state: freshState(props.modelValue), parent: host.value! })
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => {
  view?.scrollDOM.removeEventListener('scroll', onScroll)
  view?.destroy()
})

// 换文件：新建 state（撤销历史不跨文件）；同一文件被外部改了内容（比如恢复未保存内容）：整篇替换
watch(
  () => [props.docKey, props.modelValue] as const,
  ([key], [oldKey]) => {
    if (!view) return
    if (key !== oldKey) {
      view.setState(freshState(props.modelValue))
      return
    }
    const cur = view.state.doc.toString()
    if (cur !== props.modelValue) view.dispatch({ changes: { from: 0, to: cur.length, insert: props.modelValue } })
  }
)
watch(
  () => props.disabled,
  (d) => view?.dispatch({ effects: editable.reconfigure([EditorView.editable.of(!d), EditorState.readOnly.of(!!d)]) })
)
watch(
  () => props.blocks,
  (b) => view?.dispatch({ effects: blockMode.reconfigure(b ? boxField : []) })
)

/**
 * 插入一整块：at（默认光标）所在行有内容就放到下一段，前后留空行；
 * select 是块里要选中的文字，插入后直接输入就能替换
 */
/** 插入高亮块（::: tip … :::），选中里面的占位文字 */
function insertCallout(type: CalloutType, atPos?: number) {
  insertBlockText(calloutText(type), CALLOUT_PLACEHOLDER, atPos)
}

function insertBlockText(text: string, select?: string, atPos?: number) {
  if (!view) return
  const { doc, selection } = view.state
  // 光标在 frontmatter 里（比如刚打开文件）时，插到 frontmatter 后面
  const fmLen = doc.toString().match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/)?.[0].length ?? 0
  let pos = Math.max(Math.min(atPos ?? selection.main.head, doc.length), fmLen)
  // 光标在代码块里时，插到这个代码块后面，不要拆开它
  for (let n: { name: string; to: number; parent: any } | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock') {
      pos = n.to
      break
    }
  }
  const line = doc.lineAt(pos)
  const busy = line.text.trim() !== ''
  const at = busy ? line.to : line.from
  const prevBusy = !busy && line.number > 1 && doc.line(line.number - 1).text.trim() !== ''
  const nextBusy = line.number < doc.lines && doc.line(line.number + 1).text.trim() !== ''
  const before = busy ? '\n\n' : prevBusy ? '\n' : ''
  // 插入点后面本来就有一个换行：下一行有字时再补一个空行，在文末时补个结尾换行
  const after = nextBusy ? '\n' : busy && line.number === doc.lines ? '\n' : ''
  const insert = before + text + after
  const i = select ? text.indexOf(select) : -1
  const start = at + before.length + Math.max(i, 0)
  view.dispatch({
    changes: { from: at, to: busy ? at : line.to, insert },
    // 没指定要选中的文字时选中整块（显示成块时就是选中这个框）
    selection: i >= 0 ? { anchor: start, head: start + select!.length } : { anchor: at + before.length, head: at + before.length + text.length },
    scrollIntoView: true
  })
  view.focus()
}

defineExpose({
  /** 在光标处插入文字（上传图片后插入引用） */
  insert(text: string) {
    if (!view) return
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
  },
  insertBlock: insertBlockText,
  insertCallout,
  insertKind,
  /** 用新源码替换一个块；文档在这期间被改过（expect 对不上）时返回 false */
  replaceRange(from: number, to: number, text: string, expect: string): boolean {
    if (!view || view.state.sliceDoc(from, to) !== expect) return false
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from, head: from + text.length }, scrollIntoView: true })
    view.focus()
    return true
  },
  focus: () => view?.focus(),
  getCursor: () => ({ sel: view?.state.selection.main.head ?? 0, scroll: view?.scrollDOM.scrollTop ?? 0 }),
  setCursor(sel: number, scroll: number) {
    if (!view) return
    view.dispatch({ selection: { anchor: Math.min(sel, view.state.doc.length) } })
    requestAnimationFrame(() => view && (view.scrollDOM.scrollTop = scroll))
  }
})
</script>

<template>
  <div ref="host" class="md-editor" />
</template>

<style scoped>
.md-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.md-editor :deep(.cm-editor) {
  height: 100%;
}
</style>
