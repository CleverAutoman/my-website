<script setup lang="ts">
// 写作编辑器的编辑区：CodeMirror 6 + Markdown 语法渲染（标题字号、粗斜体、代码块、引用、图片缩略图），
// 源码一个字符都不改，所有标记仍然可见可编辑，只是弱化显示。只被 PostEditor 引用，不进生产包。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap, drawSelection, placeholder as cmPlaceholder, Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { EditorState, EditorSelection, Compartment, StateField, type Extension, type Range } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'

const props = defineProps<{
  modelValue: string
  /** 换文件时变化：整篇替换并清空撤销历史 */
  docKey: string
  disabled?: boolean
  placeholder?: string
  /** 把 markdown 里的图片地址转成浏览器能取到的地址 */
  resolveImage?: (src: string) => string | null
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
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        block(node.from, node.to, 'cm-md-code')
        return false
      }
      if (node.name === 'Blockquote') block(node.from, node.to, 'cm-md-quote')
    }
  })
  for (let i = 1; i <= doc.lines; i++) {
    if (skip.has(i)) continue
    const line = doc.line(i)
    if (/^\s*:::/.test(line.text)) out.push(lineDeco('cm-md-container').range(line.from))
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
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return buildDecorations(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

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
  '.cm-line': { padding: '0 28px', maxWidth: '860px' },
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
  '.cm-md-quote': { borderLeft: '3px solid var(--x-border-hover)', paddingLeft: '25px !important', color: 'var(--vp-c-text-2)' },
  '.cm-md-container': { fontFamily: mono, fontSize: '13px', color: 'var(--vp-c-brand-1)', backgroundColor: 'var(--vp-c-brand-soft)' },
  '.cm-md-img': { padding: '4px 28px 10px' },
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
    decorations,
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

defineExpose({
  /** 在光标处插入文字（上传图片后插入引用） */
  insert(text: string) {
    if (!view) return
    view.dispatch(view.state.replaceSelection(text))
    view.focus()
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
