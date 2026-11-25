// 所见即所得（实时预览）：Markdown 标记只在光标所在的行显示，其他行直接显示成排版后的样子。
// 源码一个字符都不改，只是用装饰把标记藏起来、把表格 / 组件 / HTML 换成渲染结果；
// 光标移进去（点一下）就变回源码。只在本地写作时用（MdEditor 的 live 模式），不进生产包。
import { EditorState, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

export interface LivePreviewOptions {
  /**
   * 把正文里的 Vue 组件（<BenchChart :data="x" />、<EnvCard />）画进 el。
   * doc 是整篇源码（组件要用的 import、frontmatter 从这里取）。返回卸载函数；不认识的组件返回 null，显示成占位条。
   */
  mount?: (tag: string, attrs: Record<string, string>, el: HTMLElement, doc: string) => (() => void) | null
}

/* ---------- 行内 Markdown → HTML（表格单元格用），只认常见的几种 ---------- */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
export function inlineMd(src: string): string {
  const codes: string[] = []
  let s = src.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
  s = esc(s)
    .replace(/\\([\\`*_{}\[\]()#+\-.!|~])/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, '<a>$1</a>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`)
}

const splitRow = (line: string) => {
  const cells = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/)
  return cells.map((c) => c.trim())
}

/* ---------- 块级 widget ---------- */
abstract class BlockWidget extends WidgetType {
  constructor(readonly key: string) {
    super()
  }
  eq(other: WidgetType) {
    return other instanceof BlockWidget && other.constructor === this.constructor && other.key === this.key
  }
  // 让编辑器处理点击：点到 widget 上，光标落在这一块里，块就变回源码
  ignoreEvent() {
    return false
  }
}

class TableWidget extends BlockWidget {
  toDOM() {
    const lines = this.key.split('\n')
    const align = splitRow(lines[1] ?? '').map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''))
    const row = (line: string, tag: 'th' | 'td') =>
      `<tr>${splitRow(line)
        .map((c, i) => `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${inlineMd(c)}</${tag}>`)
        .join('')}</tr>`
    const wrap = document.createElement('div')
    wrap.className = 'vp-doc lp-block lp-table'
    wrap.innerHTML = `<table><thead>${row(lines[0], 'th')}</thead><tbody>${lines.slice(2).map((l) => row(l, 'td')).join('')}</tbody></table>`
    return wrap
  }
}

class HtmlWidget extends BlockWidget {
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'vp-doc lp-block lp-html'
    wrap.innerHTML = this.key
    return wrap
  }
}

class ChipWidget extends BlockWidget {
  constructor(key: string, readonly label: string, readonly hint: string) {
    super(key)
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'lp-chip'
    const b = document.createElement('span')
    b.className = 'lp-chip-label'
    b.textContent = this.label
    const h = document.createElement('span')
    h.className = 'lp-chip-hint'
    h.textContent = this.hint
    wrap.append(b, h)
    return wrap
  }
}

const unmounts = new WeakMap<HTMLElement, () => void>()
class ComponentWidget extends BlockWidget {
  constructor(key: string, readonly tag: string, readonly attrs: Record<string, string>, readonly doc: string, readonly opts: LivePreviewOptions) {
    super(key)
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'vp-doc lp-block lp-comp'
    const off = this.opts.mount?.(this.tag, this.attrs, wrap, this.doc) ?? null
    if (off) unmounts.set(wrap, off)
    else {
      wrap.className = 'lp-chip'
      wrap.textContent = `<${this.tag} />`
    }
    return wrap
  }
  destroy(dom: HTMLElement) {
    unmounts.get(dom)?.()
  }
}

/* ---------- 行内 widget ---------- */
class TextWidget extends WidgetType {
  constructor(readonly text: string, readonly cls: string) {
    super()
  }
  eq(o: TextWidget) {
    return o.text === this.text && o.cls === this.cls
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = this.cls
    s.textContent = this.text
    return s
  }
}
class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'lp-hr'
    return s
  }
}

const hide = Decoration.replace({})
const CALLOUT_TITLES: Record<string, string> = { tip: 'TIP', info: 'INFO', warning: 'WARNING', danger: 'DANGER', details: 'Details', note: 'NOTE', important: 'IMPORTANT', caution: 'CAUTION' }
const FM_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const COMP_RE = /^\s*<([A-Z][A-Za-z0-9]*)\b([^>]*?)\/?>\s*(?:<\/\1>\s*)?$/

function parseAttrs(s: string) {
  const out: Record<string, string> = {}
  for (const m of s.matchAll(/([:@]?[\w-]+)(?:\s*=\s*"([^"]*)")?/g)) out[m[1]] = m[2] ?? ''
  return out
}

function build(state: EditorState, opts: LivePreviewOptions): DecorationSet {
  const doc = state.doc
  const text = doc.toString()
  const out: Range<Decoration>[] = []
  // 光标 / 选区碰到的行：这些行显示源码
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    for (let i = doc.lineAt(r.from).number; i <= doc.lineAt(r.to).number; i++) active.add(i)
  }
  const touches = (from: number, to: number) => {
    for (let i = doc.lineAt(from).number; i <= doc.lineAt(to).number; i++) if (active.has(i)) return true
    return false
  }
  /** 整几行换成一个块 widget（光标不在里面时） */
  const block = (from: number, to: number, widget: WidgetType) => {
    const a = doc.lineAt(from)
    const b = doc.lineAt(to)
    out.push(Decoration.replace({ widget, block: true }).range(a.from, b.to))
  }
  const covered: [number, number][] = []
  const inCovered = (pos: number) => covered.some(([a, b]) => pos >= a && pos <= b)

  // frontmatter：折成一条
  const fm = text.match(FM_RE)
  const fmEnd = fm ? fm[0].replace(/\r?\n$/, '').length : 0
  if (fm) {
    covered.push([0, fmEnd])
    if (!touches(0, fmEnd)) {
      const title = fm[0].match(/^title:\s*(.+)$/m)?.[1] ?? ''
      block(0, fmEnd, new ChipWidget(fm[0], 'frontmatter', title ? `title: ${title} · 点击编辑` : '点击编辑'))
    }
  }
  const scriptSrc = text.match(/<script\b[^>]*>[\s\S]*?<\/script>/)?.[0] ?? ''

  syntaxTree(state).iterate({
    enter(node) {
      if (node.to <= fmEnd) return node.name === 'Document' ? undefined : false
      const name = node.name
      // 代码块交给块视图（boxField）；行内的东西在这里面都不处理
      if (name === 'FencedCode' || name === 'CodeBlock' || name === 'FrontMatter') return false

      if (name === 'Table') {
        covered.push([node.from, node.to])
        if (!touches(node.from, node.to)) {
          const a = doc.lineAt(node.from)
          const b = doc.lineAt(node.to)
          block(node.from, node.to, new TableWidget(state.sliceDoc(a.from, b.to)))
        }
        return false
      }

      // <EnvCard /> 这种自闭合的组件标签，Markdown 解析器认不出是 HTML 块，会当成一段普通文字
      if (name === 'Paragraph') {
        const src = state.sliceDoc(node.from, node.to).trim()
        const m = !src.includes('\n') ? src.match(COMP_RE) : null
        if (m) {
          covered.push([node.from, node.to])
          if (!touches(node.from, node.to)) {
            const ctx = m[1] === 'EnvCard' ? (fm?.[0] ?? '') : scriptSrc
            block(node.from, node.to, new ComponentWidget(src + '\u0000' + ctx, m[1], parseAttrs(m[2]), text, opts))
          }
          return false
        }
      }

      if (name === 'HTMLBlock' || name === 'CommentBlock') {
        const src = state.sliceDoc(node.from, node.to).replace(/\s+$/, '')
        covered.push([node.from, node.to])
        if (touches(node.from, node.to)) return false
        if (name === 'CommentBlock' || /^<!--/.test(src)) block(node.from, node.to, new ChipWidget(src, '注释', '点击编辑'))
        else if (/^<script\b/.test(src)) block(node.from, node.to, new ChipWidget(src, '<script setup>', `${(src.match(/^import /gm) ?? []).length} 个 import · 点击编辑`))
        else if (/^<style\b/.test(src)) block(node.from, node.to, new ChipWidget(src, '<style>', '点击编辑'))
        else {
          const m = src.match(COMP_RE)
          if (m) {
            const ctx = m[1] === 'EnvCard' ? (fm?.[0] ?? '') : scriptSrc
            block(node.from, node.to, new ComponentWidget(src + '\u0000' + ctx, m[1], parseAttrs(m[2]), text, opts))
          } else if (!/^<[A-Z]/.test(src)) block(node.from, node.to, new HtmlWidget(src))
        }
        return false
      }

      const line = doc.lineAt(node.from)
      const isActive = active.has(line.number)

      const h = name.match(/^ATXHeading(\d)$/)
      if (h) {
        out.push(Decoration.line({ class: `lp-h lp-h${h[1]}` }).range(line.from))
        if (!isActive) {
          // 自定义锚点 {#id} 也藏起来
          const anchor = line.text.match(/\s*\{#[^}]*\}\s*$/)
          if (anchor) out.push(hide.range(line.to - anchor[0].length, line.to))
        }
      }
      if (isActive) return

      switch (name) {
        case 'HeaderMark': {
          // 标题开头的 ## 连同后面的空格
          const next = state.sliceDoc(node.to, node.to + 1)
          if (node.from === line.from || /^\s*$/.test(state.sliceDoc(line.from, node.from)))
            out.push(hide.range(node.from, next === ' ' ? node.to + 1 : node.to))
          break
        }
        case 'EmphasisMark':
        case 'StrikethroughMark':
        case 'LinkMark':
        case 'URL':
        case 'LinkTitle':
          if (node.to > node.from) out.push(hide.range(node.from, node.to))
          break
        case 'CodeMark':
          // 行内代码两边的反引号（代码块已经在上面跳过了）
          out.push(hide.range(node.from, node.to))
          break
        case 'Escape':
          out.push(hide.range(node.from, node.from + 1))
          break
        case 'QuoteMark': {
          const next = state.sliceDoc(node.to, node.to + 1)
          out.push(hide.range(node.from, next === ' ' ? node.to + 1 : node.to))
          break
        }
        case 'ListMark': {
          const mark = state.sliceDoc(node.from, node.to)
          if (/^[-*+]$/.test(mark)) out.push(Decoration.replace({ widget: new TextWidget('•', 'lp-bullet') }).range(node.from, node.to))
          break
        }
        case 'HorizontalRule':
          out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
          return false
        case 'Image':
          // 图片源码整个藏起来，下面的缩略图（MdEditor 的 ImageWidget）保留
          out.push(hide.range(node.from, node.to))
          return false
        case 'Link':
          // [文字](#anchor)：文字按链接样式显示
          if (state.sliceDoc(node.from, node.from + 1) === '[') {
            const close = state.sliceDoc(node.from, node.to).indexOf(']')
            if (close > 1) out.push(Decoration.mark({ class: 'lp-link' }).range(node.from + 1, node.from + close))
          }
          break
      }
    }
  })

  // 高亮块：开头 ::: tip 标题 → 只留标题（没写标题时显示 TIP 这类默认标题），结尾 ::: 藏起来
  for (let i = 1; i <= doc.lines; i++) {
    const l = doc.line(i)
    if (active.has(i) || inCovered(l.from)) continue
    const m = l.text.match(/^(\s*:::+\s*([A-Za-z-]+)\s*)(.*)$/)
    if (m) {
      if (m[3].trim()) out.push(hide.range(l.from, l.from + m[1].length))
      else out.push(Decoration.replace({ widget: new TextWidget(CALLOUT_TITLES[m[2]] ?? m[2].toUpperCase(), 'lp-callout-title') }).range(l.from, l.to))
    } else if (/^\s*:::+\s*$/.test(l.text)) out.push(hide.range(l.from, l.to))
  }
  return Decoration.set(out, true)
}

export function livePreview(opts: LivePreviewOptions = {}): Extension {
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, opts),
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.reconfigured || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return build(tr.state, opts)
      return value
    },
    provide: (f) => EditorView.decorations.from(f)
  })
  return [field, liveTheme]
}

const liveTheme = EditorView.theme({
  '.lp-block': { padding: '2px 0', cursor: 'text' },
  '.lp-block > :first-child': { marginTop: '0 !important' },
  '.lp-block > :last-child': { marginBottom: '0 !important' },
  '.lp-table table': { margin: '8px 0' },
  '.lp-comp': { padding: '4px 0' },
  '.lp-chip': {
    display: 'flex',
    gap: '10px',
    alignItems: 'baseline',
    margin: '2px 0',
    padding: '2px 10px',
    border: '1px dashed var(--x-border, var(--vp-c-divider))',
    borderRadius: '6px',
    fontSize: '12.5px',
    lineHeight: '22px',
    color: 'var(--vp-c-text-3)',
    cursor: 'text'
  },
  '.lp-chip-label': { fontFamily: 'var(--vp-font-family-mono)', color: 'var(--vp-c-text-2)' },
  '.lp-chip-hint': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.lp-bullet': { display: 'inline-block', width: '1ch', color: 'var(--vp-c-text-2)' },
  '.lp-hr': { display: 'inline-block', width: '100%', height: '1px', verticalAlign: 'middle', background: 'var(--vp-c-divider)' },
  '.lp-link': { color: 'var(--vp-c-brand-1)', textDecoration: 'underline', textUnderlineOffset: '2px' },
  '.lp-callout-title': { fontWeight: '600' }
})
