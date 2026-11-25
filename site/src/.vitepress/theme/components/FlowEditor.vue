<script setup lang="ts">
// 流程图画布：拖动节点、从节点边上的圆点拖出连线、双击改属性、Ctrl+滚轮缩放、拖空白处平移。
// 嵌在写作编辑器的正文里（MdEditor 的 FlowCanvasWidget），直接改传进来的 data，外面监听后写回文档。
// 几何和画法与页面共用 blocks/flow.ts。
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import {
  GRID, SHAPES, TEXT_SIZES, TONES, bends, edgeGeometry, fitSize, flowBounds, newId, nodeClass, shapePath, textLines,
  type FlowData, type FlowEdge, type FlowNode, type Shape, type TextSize, type Tone
} from '../blocks/flow'

/** compact：嵌在正文里，不要右侧面板，滚轮留给页面滚动（按住 Ctrl 才缩放） */
const props = defineProps<{ data: FlowData; compact?: boolean }>()
const d = props.data

const svg = ref<SVGSVGElement>()
const root = ref<HTMLDivElement>()
const textInput = ref<HTMLTextAreaElement>()
const labelInput = ref<HTMLInputElement>()

const view = reactive({ x: 40, y: 40, k: 1 })
type Sel = { node: string } | { edge: number } | null
const sel = ref<Sel>(null)
const hover = ref<string | null>(null)
const selNode = computed(() => (sel.value && 'node' in sel.value ? d.nodes.find((n) => n.id === (sel.value as any).node) ?? null : null))
const selEdge = computed(() => (sel.value && 'edge' in sel.value ? d.edges[sel.value.edge] ?? null : null))

/* ---------- 量字：用浏览器真实字体算节点宽度 ---------- */
let ctx: CanvasRenderingContext2D | null = null
let fontFamily = ''
function measure(s: string, px = 14) {
  if (!ctx) {
    ctx = document.createElement('canvas').getContext('2d')
    fontFamily = getComputedStyle(document.body).getPropertyValue('--vp-font-family-base') || 'sans-serif'
  }
  if (!ctx) return s.length * px * 0.6
  ctx.font = `${px}px ${fontFamily}`
  return ctx.measureText(s).width
}
/** 按文字重算大小。手动调过大小（lock）或分组：只在放不下时变大，不缩回去 */
function refit(n: FlowNode) {
  const { w, h } = fitSize(n.text, n.shape, measure, n.size)
  if (n.lock || n.shape === 'group') {
    n.w = Math.max(n.w, w)
    n.h = Math.max(n.h, h)
    return
  }
  // 保持中心不动
  n.x = Math.round((n.x + (n.w - w) / 2) / GRID) * GRID
  n.y = Math.round((n.y + (n.h - h) / 2) / GRID) * GRID
  n.w = w
  n.h = h
}

/* ---------- 渲染用的派生数据 ---------- */
const byId = computed(() => new Map(d.nodes.map((n) => [n.id, n])))
// 分组画在最底层（连线下面），其余节点画在连线上面
const groupNodes = computed(() => d.nodes.filter((n) => n.shape === 'group'))
const plainNodes = computed(() => d.nodes.filter((n) => n.shape !== 'group'))
const edgeViews = computed(() => {
  const b = bends(d)
  return d.edges.map((e, i) => {
    const a = byId.value.get(e.from)
    const z = byId.value.get(e.to)
    if (!a || !z) return null
    const g = edgeGeometry(a, z, b[i])
    return { e, i, ...g, lw: e.label ? measure(e.label) * 0.86 + 12 : 0 }
  })
})
const handles = (n: FlowNode) => [
  { x: n.w / 2, y: 0 },
  { x: n.w, y: n.h / 2 },
  { x: n.w / 2, y: n.h },
  { x: 0, y: n.h / 2 }
]

/* ---------- 坐标 ---------- */
function toGraph(e: { clientX: number; clientY: number }) {
  const r = svg.value!.getBoundingClientRect()
  return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }
}
const snap = (v: number) => Math.round(v / GRID) * GRID
/** 指针下的节点：先找普通节点（上层），都不是再看分组 */
function nodeAt(p: { x: number; y: number }) {
  const inside = (n: FlowNode) => p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h
  const list = plainNodes.value
  for (let i = list.length - 1; i >= 0; i--) if (inside(list[i])) return list[i]
  const gs = groupNodes.value
  for (let i = gs.length - 1; i >= 0; i--) if (inside(gs[i])) return gs[i]
  return null
}
/** 完全落在分组框里的节点（拖分组时一起移动） */
function membersOf(g: FlowNode) {
  return d.nodes.filter((n) => n !== g && n.x >= g.x && n.y >= g.y && n.x + n.w <= g.x + g.w && n.y + n.h <= g.y + g.h)
}

/* ---------- 指针交互 ---------- */
type Drag =
  | { kind: 'node'; id: string; dx: number; dy: number; moved: boolean; members: { n: FlowNode; ox: number; oy: number }[]; ox: number; oy: number }
  | { kind: 'resize'; id: string }
  | { kind: 'link'; from: string; x: number; y: number }
  | { kind: 'pan'; sx: number; sy: number }
const drag = ref<Drag | null>(null)

function capture(e: PointerEvent) {
  svg.value?.setPointerCapture(e.pointerId)
  root.value?.focus({ preventScroll: true })
}
function onNodeDown(e: PointerEvent, n: FlowNode) {
  if (e.button !== 0) return
  pop.value = null
  sel.value = { node: n.id }
  const p = toGraph(e)
  const members = n.shape === 'group' ? membersOf(n).map((m) => ({ n: m, ox: m.x, oy: m.y })) : []
  drag.value = { kind: 'node', id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false, members, ox: n.x, oy: n.y }
  capture(e)
}
function onResizeDown(e: PointerEvent, n: FlowNode) {
  if (e.button !== 0) return
  pop.value = null
  sel.value = { node: n.id }
  drag.value = { kind: 'resize', id: n.id }
  capture(e)
}
function onHandleDown(e: PointerEvent, n: FlowNode) {
  if (e.button !== 0) return
  pop.value = null
  const p = toGraph(e)
  drag.value = { kind: 'link', from: n.id, x: p.x, y: p.y }
  capture(e)
}
function onEdgeDown(e: PointerEvent, i: number) {
  if (e.button !== 0) return
  pop.value = null
  sel.value = { edge: i }
  root.value?.focus({ preventScroll: true })
}
function onBgDown(e: PointerEvent) {
  if (e.button !== 0 && e.button !== 1) return
  pop.value = null
  sel.value = null
  drag.value = { kind: 'pan', sx: e.clientX - view.x, sy: e.clientY - view.y }
  capture(e)
}
function onMove(e: PointerEvent) {
  const g = drag.value
  if (!g) {
    hover.value = nodeAt(toGraph(e))?.id ?? null
    return
  }
  if (g.kind === 'pan') {
    view.x = e.clientX - g.sx
    view.y = e.clientY - g.sy
    return
  }
  const p = toGraph(e)
  if (g.kind === 'node') {
    const n = byId.value.get(g.id)
    if (!n) return
    const x = snap(p.x - g.dx)
    const y = snap(p.y - g.dy)
    if (x === n.x && y === n.y) return
    // 真的拖动了才把节点放到最上层（按下时就挪 DOM 会让浏览器把双击发给画布）
    if (!g.moved) {
      const i = d.nodes.indexOf(n)
      if (i !== d.nodes.length - 1) d.nodes.push(...d.nodes.splice(i, 1))
    }
    n.x = x
    n.y = y
    for (const m of g.members) {
      m.n.x = m.ox + x - g.ox
      m.n.y = m.oy + y - g.oy
    }
    g.moved = true
  } else if (g.kind === 'resize') {
    const n = byId.value.get(g.id)
    if (!n) return
    const min = fitSize(n.text, n.shape, measure, n.size)
    // 文字放得下就行；没有文字的块可以缩到 20
    n.w = Math.max(n.text.trim() ? Math.min(min.w, 60) : 20, snap(p.x - n.x))
    n.h = Math.max(n.text.trim() ? Math.min(min.h, 30) : 20, snap(p.y - n.y))
    n.lock = true
  } else {
    g.x = p.x
    g.y = p.y
    hover.value = nodeAt(p)?.id ?? null
  }
}
function onUp(e: PointerEvent) {
  const g = drag.value
  drag.value = null
  if (svg.value?.hasPointerCapture(e.pointerId)) svg.value.releasePointerCapture(e.pointerId)
  if (g?.kind !== 'link') return
  const target = nodeAt(toGraph(e))
  if (!target || target.id === g.from) return
  const i = d.edges.findIndex((x) => x.from === g.from && x.to === target.id)
  if (i >= 0) sel.value = { edge: i }
  else {
    d.edges.push({ from: g.from, to: target.id })
    sel.value = { edge: d.edges.length - 1 }
  }
}
function onWheel(e: WheelEvent) {
  if (props.compact && !e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const r = svg.value!.getBoundingClientRect()
  const px = e.clientX - r.left
  const py = e.clientY - r.top
  const k = Math.min(2.5, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0015)))
  view.x = px - ((px - view.x) * k) / view.k
  view.y = py - ((py - view.y) * k) / view.k
  view.k = k
}

/* ---------- 编辑操作 ---------- */
function addNode(shape: Shape, at?: { x: number; y: number }) {
  const r = svg.value?.getBoundingClientRect()
  const c = at ?? (r ? toGraph({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }) : { x: 0, y: 0 })
  const text = shape === 'diamond' ? '判断?' : shape === 'text' ? '文字' : shape === 'group' ? '分组' : '节点'
  let { w, h } = fitSize(text, shape, measure)
  if (shape === 'group') [w, h] = [360, 200]
  const n: FlowNode = { id: newId(d), text, shape, w, h, x: snap(c.x - w / 2), y: snap(c.y - h / 2), ...(shape === 'group' ? { lock: true } : {}) }
  // 从当前选中的节点自动连过来，连续加节点时省事（文字标注和分组不连）
  const from = selNode.value?.shape === 'group' ? null : selNode.value
  d.nodes.push(n)
  if (from && !at && shape !== 'group' && shape !== 'text') {
    n.x = snap(from.x + from.w + 60)
    n.y = snap(from.y + (from.h - h) / 2)
    // 右边被占了就往下挪，直到不和别的节点重叠
    const hit = () => d.nodes.some((o) => o !== n && n.x < o.x + o.w + 20 && o.x < n.x + n.w + 20 && n.y < o.y + o.h + 20 && o.y < n.y + n.h + 20)
    for (let i = 0; i < 50 && hit(); i++) n.y += GRID * 4
    d.edges.push({ from: from.id, to: n.id })
  }
  sel.value = { node: n.id }
  editText()
}
function onBgDbl(e: MouseEvent) {
  if (e.target !== svg.value && !(e.target as Element).classList.contains('fe-bg')) return
  const p = toGraph(e)
  // 双击落在节点上（事件被发到了画布）时按编辑节点处理，不新建
  const hit = nodeAt(p)
  if (hit) {
    sel.value = { node: hit.id }
    editText()
    return
  }
  addNode('rect', p)
}
/* ---------- 双击弹出的属性浮层：就地改文字、形状、颜色（连线改标签、虚线） ---------- */
const pop = ref<'node' | 'edge' | null>(null)
const stage = ref<HTMLDivElement>()
const popEl = ref<HTMLDivElement>()
const popText = ref<HTMLTextAreaElement>()
const popLabel = ref<HTMLInputElement>()
const popStyle = computed(() => {
  let x = 0
  let top = 0
  let above = 0
  if (pop.value === 'node' && selNode.value) {
    const n = selNode.value
    x = view.x + (n.x + n.w / 2) * view.k
    top = view.y + (n.y + n.h) * view.k + 10
    above = view.y + n.y * view.k - 10
  } else if (pop.value === 'edge' && selEdge.value) {
    const v = edgeViews.value.find((x) => x?.e === selEdge.value)
    if (!v) return { display: 'none' }
    x = view.x + v.mid.x * view.k
    top = view.y + v.mid.y * view.k + 16
    above = view.y + v.mid.y * view.k - 16
  } else return { display: 'none' }
  // 下面放不下就放到上面；左右不出画布
  const W = stage.value?.clientWidth ?? 800
  const H = stage.value?.clientHeight ?? 600
  const ph = popEl.value?.offsetHeight ?? 200
  const pw = popEl.value?.offsetWidth ?? 270
  const left = Math.min(Math.max(x - pw / 2, 8), Math.max(8, W - pw - 8))
  const y = top + ph > H - 8 && above - ph > 8 ? above - ph : Math.min(top, Math.max(8, H - ph - 8))
  return { left: `${left}px`, top: `${y}px` }
})
function closePop() {
  pop.value = null
  root.value?.focus({ preventScroll: true })
}
function onPopKey(e: KeyboardEvent) {
  if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) {
    e.preventDefault()
    e.stopPropagation()
    closePop()
  }
}
function editText() {
  if (!selNode.value) return
  pop.value = 'node'
  nextTick(() => {
    popText.value?.focus()
    popText.value?.select()
  })
}
function editLabel() {
  if (!selEdge.value) return
  pop.value = 'edge'
  nextTick(() => popLabel.value?.focus())
}
function setText(n: FlowNode, text: string) {
  n.text = text
  refit(n)
}
function setShape(n: FlowNode, shape: Shape) {
  const wasGroup = n.shape === 'group'
  n.shape = shape
  if (shape === 'group') {
    n.lock = true
    n.w = Math.max(n.w, 360)
    n.h = Math.max(n.h, 200)
  } else if (wasGroup) {
    delete n.lock
  }
  refit(n)
}
function setSize(n: FlowNode, size: TextSize) {
  if (size === 'md') delete n.size
  else n.size = size
  refit(n)
}
function setFill(n: FlowNode, v: boolean) {
  if (v) n.fill = true
  else delete n.fill
}
function setTone(n: FlowNode, tone: Tone) {
  if (tone === 'default') delete n.tone
  else n.tone = tone
}
function removeSelected() {
  if (selNode.value) {
    const id = selNode.value.id
    d.nodes.splice(d.nodes.indexOf(selNode.value), 1)
    for (let i = d.edges.length - 1; i >= 0; i--) if (d.edges[i].from === id || d.edges[i].to === id) d.edges.splice(i, 1)
  } else if (selEdge.value) d.edges.splice(d.edges.indexOf(selEdge.value), 1)
  sel.value = null
  pop.value = null
}
function duplicate() {
  const n = selNode.value
  if (!n) return
  // 复制到右边紧挨着（连续 Ctrl+D 就是一排同样大小的块）；分组复制到下面
  const c: FlowNode = { ...n, id: newId(d) }
  const overlap = () =>
    d.nodes.some((o) => o !== n && o.shape !== 'group' && c.x < o.x + o.w && o.x < c.x + c.w && c.y < o.y + o.h && o.y < c.y + c.h)
  if (n.shape === 'group') c.y = n.y + n.h + 20
  else {
    c.x = n.x + n.w
    for (let i = 0; i < 100 && overlap(); i++) c.x += n.w
  }
  d.nodes.push(c)
  sel.value = { node: c.id }
}
function reverse(e: FlowEdge) {
  ;[e.from, e.to] = [e.to, e.from]
}
function setLabel(e: FlowEdge, v: string) {
  if (v) e.label = v
  else delete e.label
}
function setDashed(e: FlowEdge, v: boolean) {
  if (v) e.dashed = true
  else delete e.dashed
}

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t.closest('input, textarea, select')) return
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (sel.value) removeSelected()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    duplicate()
  } else if (e.ctrlKey || e.metaKey || e.altKey) {
    return // Ctrl+Enter 保存等交给外面的对话框
  } else if (e.key === 'Enter' && sel.value) {
    selNode.value ? editText() : editLabel()
  } else if (e.key === 'Escape' && sel.value) {
    sel.value = null
  } else if (selNode.value && e.key.startsWith('Arrow')) {
    const step = e.shiftKey ? GRID * 5 : GRID
    if (e.key === 'ArrowLeft') selNode.value.x -= step
    if (e.key === 'ArrowRight') selNode.value.x += step
    if (e.key === 'ArrowUp') selNode.value.y -= step
    if (e.key === 'ArrowDown') selNode.value.y += step
  } else return
  e.preventDefault()
  e.stopPropagation()
}

/** 缩放到正好装下整张图 */
function fit() {
  const r = svg.value?.getBoundingClientRect()
  if (!r || !r.width) return
  const b = flowBounds(d, 40)
  const k = Math.min(1.2, r.width / b.w, r.height / b.h)
  view.k = k
  view.x = (r.width - b.w * k) / 2 - b.x * k
  view.y = (r.height - b.h * k) / 2 - b.y * k
}
onMounted(() => {
  // 手写 / 导入的节点宽度是估算的，按真实字体重算一遍
  for (const n of d.nodes) {
    const s = fitSize(n.text, n.shape, measure, n.size)
    if (s.w > n.w || s.h > n.h) refit(n)
  }
  nextTick(fit)
})
defineExpose({ fit })
</script>

<template>
  <div ref="root" class="fe" tabindex="0" @keydown="onKey">
    <div class="fe-tools">
      <span class="fe-group">
        <button v-for="s in SHAPES" :key="s.shape" type="button" :title="`添加${s.label}（选中节点时自动连过去）`" @click="addNode(s.shape)">
          <svg width="22" height="14" viewBox="-2 -2 26 18" :class="`ico-${s.shape}`">
            <text v-if="s.shape === 'text'" x="11" y="8" text-anchor="middle" dominant-baseline="central">T</text>
            <path v-else :d="shapePath({ w: 22, h: 14, shape: s.shape })" />
          </svg>
          {{ s.label }}
        </button>
      </span>
      <span class="fe-group">
        <button type="button" title="适应画布" @click="fit">适应</button>
        <span class="fe-zoom">{{ Math.round(view.k * 100) }}%</span>
      </span>
      <span class="fe-hint">拖节点移动 · 拖右下角改大小 · 拖边上圆点连线 · 双击改属性 · 双击空白处加节点 · Ctrl+D 往右复制 · Delete 删除 · {{ compact ? 'Ctrl+滚轮缩放' : '滚轮缩放' }}</span>
    </div>
    <div class="fe-main">
      <div ref="stage" class="fe-stage">
        <svg
          ref="svg"
          class="fe-canvas"
          :class="{ panning: drag?.kind === 'pan', linking: drag?.kind === 'link' }"
          @pointerdown="onBgDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @dblclick="onBgDbl"
          @wheel="onWheel"
        >
          <defs>
            <pattern id="fe-grid" :width="GRID * view.k" :height="GRID * view.k" patternUnits="userSpaceOnUse" :x="view.x" :y="view.y">
              <circle :cx="0.5" :cy="0.5" r="0.7" class="fe-dot" />
            </pattern>
            <marker id="fe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path class="flow-arrow" d="M0,0 L10,5 L0,10 z" />
            </marker>
            <marker id="fe-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path class="fe-arrow-sel" d="M0,0 L10,5 L0,10 z" />
            </marker>
          </defs>
          <rect class="fe-bg" width="100%" height="100%" fill="url(#fe-grid)" />
          <g :transform="`translate(${view.x},${view.y}) scale(${view.k})`">
            <!-- 分组：只有边框和左上角组名能点（框里的空白照常平移、双击加节点），拖动时框里的节点一起走 -->
            <g
              v-for="n in groupNodes"
              :key="n.id"
              :class="[nodeClass(n), 'fe-node', { sel: selNode === n, hover: hover === n.id }]"
              :transform="`translate(${n.x},${n.y})`"
              @dblclick.stop="editText"
            >
              <path :d="shapePath(n)" />
              <path class="fe-group-hit" :d="shapePath(n)" @pointerdown.stop="onNodeDown($event, n)" />
              <rect class="fe-group-tab" :width="Math.min(n.w, measure(n.text, 14) + 32)" height="36" @pointerdown.stop="onNodeDown($event, n)" />
              <text text-anchor="start" dominant-baseline="central">
                <tspan v-for="(l, i) in textLines(n)" :key="i" :x="l.x" :y="l.y" :font-size="l.px">{{ l.t }}</tspan>
              </text>
              <rect v-if="selNode === n" class="fe-resize" :x="n.w - 6" :y="n.h - 6" width="12" height="12" @pointerdown.stop="onResizeDown($event, n)" />
            </g>
            <template v-for="v in edgeViews" :key="v ? `${v.e.from}-${v.e.to}-${v.i}` : Math.random()">
              <g
                v-if="v"
                class="flow-edge fe-edge"
                :class="{ dashed: v.e.dashed, sel: selEdge === v.e }"
                @pointerdown.stop="onEdgeDown($event, v.i)"
                @dblclick.stop="editLabel"
              >
                <path class="fe-hit" :d="v.d" />
                <path :d="v.d" :marker-end="`url(#${selEdge === v.e ? 'fe-arrow-sel' : 'fe-arrow'})`" />
                <g v-if="v.e.label" class="flow-label">
                  <rect :x="v.mid.x - v.lw / 2" :y="v.mid.y - 10" :width="v.lw" height="20" rx="4" />
                  <text :x="v.mid.x" :y="v.mid.y" text-anchor="middle" dominant-baseline="central">{{ v.e.label }}</text>
                </g>
              </g>
            </template>
            <g
              v-for="n in plainNodes"
              :key="n.id"
              :class="[nodeClass(n), 'fe-node', { sel: selNode === n, hover: hover === n.id }]"
              :transform="`translate(${n.x},${n.y})`"
              @pointerdown.stop="onNodeDown($event, n)"
              @dblclick.stop="editText"
            >
              <rect class="fe-hit-rect" :width="n.w" :height="n.h" />
              <path v-if="n.shape !== 'text'" :d="shapePath(n)" />
              <text text-anchor="middle" dominant-baseline="central">
                <tspan v-for="(l, i) in textLines(n)" :key="i" :x="l.x" :y="l.y" :font-size="l.px" :class="{ sub: l.sub }">{{ l.t }}</tspan>
              </text>
              <circle
                v-for="(h, i) in handles(n)"
                :key="i"
                class="fe-handle"
                :cx="h.x"
                :cy="h.y"
                r="5"
                @pointerdown.stop="onHandleDown($event, n)"
              />
              <rect v-if="selNode === n" class="fe-resize" :x="n.w - 6" :y="n.h - 6" width="12" height="12" @pointerdown.stop="onResizeDown($event, n)" />
            </g>
            <line
              v-if="drag?.kind === 'link' && byId.get(drag.from)"
              class="fe-temp"
              :x1="byId.get(drag.from)!.x + byId.get(drag.from)!.w / 2"
              :y1="byId.get(drag.from)!.y + byId.get(drag.from)!.h / 2"
              :x2="drag.x"
              :y2="drag.y"
              marker-end="url(#fe-arrow-sel)"
            />
          </g>
        </svg>
        <!-- 双击节点 / 连线弹出的属性浮层 -->
        <div v-if="pop && (selNode || selEdge)" ref="popEl" class="fe-pop" :style="popStyle" @pointerdown.stop @dblclick.stop @keydown="onPopKey">
          <template v-if="pop === 'node' && selNode">
            <textarea
              ref="popText"
              rows="2"
              :value="selNode.text"
              placeholder="文字。Shift+Enter 换行，第二行起是副标题"
              @input="setText(selNode, ($event.target as HTMLTextAreaElement).value)"
            />
            <div class="fe-pop-row">
              <span class="k">形状</span>
              <button
                v-for="s in SHAPES"
                :key="s.shape"
                type="button"
                class="fe-pop-shape"
                :class="{ on: selNode.shape === s.shape }"
                :title="s.label"
                @click="setShape(selNode, s.shape)"
              >
                <svg width="26" height="18" viewBox="-2 -2 30 22" :class="`ico-${s.shape}`">
                  <text v-if="s.shape === 'text'" x="13" y="9" text-anchor="middle" dominant-baseline="central">T</text>
                  <path v-else :d="shapePath({ w: 26, h: 18, shape: s.shape })" />
                </svg>
              </button>
            </div>
            <div class="fe-pop-row">
              <span class="k">颜色</span>
              <button
                v-for="c in TONES"
                :key="c.tone"
                type="button"
                class="fe-pop-tone"
                :class="{ on: (selNode.tone ?? 'default') === c.tone }"
                :title="c.label"
                @click="setTone(selNode, c.tone)"
              >
                <svg width="18" height="18" viewBox="0 0 18 18"><g :class="`flow-node tone-${c.tone}`"><path :d="shapePath({ w: 16, h: 16, shape: 'rect' })" transform="translate(1,1)" /></g></svg>
              </button>
            </div>
            <div class="fe-pop-row">
              <span class="k">字号</span>
              <button
                v-for="t in TEXT_SIZES"
                :key="t.size"
                type="button"
                class="fe-pop-btn small"
                :class="{ on: (selNode.size ?? 'md') === t.size }"
                @click="setSize(selNode, t.size)"
              >{{ t.label }}</button>
              <label v-if="selNode.shape !== 'text' && selNode.shape !== 'group'" class="fe-pop-check right">
                <input type="checkbox" :checked="!!selNode.fill" @change="setFill(selNode, ($event.target as HTMLInputElement).checked)" /> 实心
              </label>
            </div>
            <div class="fe-pop-row end">
              <button type="button" class="fe-pop-btn" @click="duplicate">复制</button>
              <button type="button" class="fe-pop-btn danger" @click="removeSelected">删除</button>
              <button type="button" class="fe-pop-btn" @click="closePop">完成</button>
            </div>
          </template>
          <template v-else-if="pop === 'edge' && selEdge">
            <input
              ref="popLabel"
              :value="selEdge.label ?? ''"
              placeholder="连线标签，例如：是 / 否"
              @input="setLabel(selEdge, ($event.target as HTMLInputElement).value)"
            />
            <div class="fe-pop-row">
              <label class="fe-pop-check"><input type="checkbox" :checked="!!selEdge.dashed" @change="setDashed(selEdge, ($event.target as HTMLInputElement).checked)" /> 虚线</label>
              <button type="button" class="fe-pop-btn" @click="reverse(selEdge)">反向</button>
            </div>
            <div class="fe-pop-row end">
              <button type="button" class="fe-pop-btn danger" @click="removeSelected">删除</button>
              <button type="button" class="fe-pop-btn" @click="closePop">完成</button>
            </div>
          </template>
        </div>
      </div>

      <aside v-if="!compact" class="fe-panel">
        <template v-if="selNode">
          <h4>节点</h4>
          <label>文字
            <textarea
              ref="textInput"
              rows="3"
              :value="selNode.text"
              placeholder="可以换行"
              @input="setText(selNode, ($event.target as HTMLTextAreaElement).value)"
              @keydown.esc.stop="root?.focus()"
            />
          </label>
          <div class="fe-field">形状
            <span class="fe-chips">
              <button v-for="s in SHAPES" :key="s.shape" type="button" :class="{ on: selNode.shape === s.shape }" @click="setShape(selNode, s.shape)">{{ s.label }}</button>
            </span>
          </div>
          <div class="fe-field">颜色
            <span class="fe-chips">
              <button
                v-for="c in TONES"
                :key="c.tone"
                type="button"
                class="tone"
                :class="[`tone-${c.tone}`, { on: (selNode.tone ?? 'default') === c.tone }]"
                @click="setTone(selNode, c.tone)"
              >{{ c.label }}</button>
            </span>
          </div>
          <div class="fe-row">
            <button type="button" @click="duplicate">复制节点</button>
            <button type="button" class="danger" @click="removeSelected">删除节点</button>
          </div>
        </template>
        <template v-else-if="selEdge">
          <h4>连线</h4>
          <label>标签
            <input
              ref="labelInput"
              :value="selEdge.label ?? ''"
              placeholder="例如：是 / 否"
              @input="setLabel(selEdge, ($event.target as HTMLInputElement).value)"
              @keydown.esc.stop="root?.focus()"
            />
          </label>
          <label class="fe-check"><input type="checkbox" :checked="!!selEdge.dashed" @change="setDashed(selEdge, ($event.target as HTMLInputElement).checked)" /> 虚线</label>
          <div class="fe-row">
            <button type="button" @click="reverse(selEdge)">反向</button>
            <button type="button" class="danger" @click="removeSelected">删除连线</button>
          </div>
        </template>
        <template v-else>
          <h4>流程图</h4>
          <p>{{ d.nodes.length }} 个节点 · {{ d.edges.length }} 条连线</p>
          <ul>
            <li>上面的按钮加节点；选中一个节点再加，会自动连过去</li>
            <li>鼠标移到节点上，拖它边上的圆点到另一个节点就是连线</li>
            <li>双击节点改文字、形状、颜色；双击连线改标签、虚线</li>
            <li>滚轮缩放，拖空白处平移</li>
          </ul>
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.fe {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  outline: none;
}
.fe-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 0 0 8px;
  font-size: 12.5px;
}
.fe-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.fe-tools button,
.fe-panel button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}
.fe-tools button:hover,
.fe-panel button:hover {
  border-color: var(--vp-c-brand-1);
}
.fe-tools svg path {
  fill: none;
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
}
.fe-zoom {
  min-width: 40px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
}
.fe-hint {
  margin-left: auto;
  color: var(--vp-c-text-3);
}
.fe-main {
  flex: 1;
  min-height: 0;
  display: flex;
  border: 1px solid var(--x-border);
  border-radius: 8px;
  overflow: hidden;
}
.fe-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}
.fe-canvas {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-base);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.fe-canvas.panning {
  cursor: grabbing;
}
.fe-canvas.linking {
  cursor: crosshair;
}
.fe-dot {
  fill: var(--vp-c-text-3);
  opacity: 0.35;
}
.fe-node {
  cursor: move;
}
.fe-node.sel path {
  stroke-width: 2.5;
  filter: drop-shadow(0 0 4px var(--vp-c-brand-soft));
}
.fe-canvas.linking .fe-node.hover path {
  stroke-width: 3;
}
.fe-handle {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
  opacity: 0;
  cursor: crosshair;
}
.fe-node.hover .fe-handle,
.fe-node.sel .fe-handle {
  opacity: 1;
}
.fe-edge {
  cursor: pointer;
}
.fe-edge .fe-hit {
  stroke: transparent;
  stroke-width: 12;
}
.fe-edge.sel path:not(.fe-hit) {
  stroke: var(--vp-c-brand-1);
  stroke-width: 2.2;
}
.fe-arrow-sel {
  fill: var(--vp-c-brand-1);
}
.fe-temp {
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.fe-panel {
  width: 230px;
  flex: none;
  padding: 12px;
  border-left: 1px solid var(--x-border);
  background: var(--vp-c-bg);
  font-size: 13px;
  color: var(--vp-c-text-2);
  overflow: auto;
}
.fe-panel h4 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--vp-c-text-1);
}
.fe-panel p {
  margin: 0 0 8px;
}
.fe-panel ul {
  margin: 0;
  padding-left: 16px;
  line-height: 1.7;
  color: var(--vp-c-text-3);
}
.fe-panel label,
.fe-field {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
}
.fe-panel textarea,
.fe-panel input:not([type]) {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
  resize: vertical;
}
.fe-panel textarea:focus,
.fe-panel input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}
.fe-check {
  display: flex !important;
  align-items: center;
  gap: 6px !important;
}
.fe-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.fe-chips button {
  padding: 2px 8px;
}
.fe-chips button.on {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.fe-row {
  display: flex;
  gap: 6px;
}
.fe-panel button.danger:hover {
  border-color: var(--x-err);
  color: var(--x-err);
}
.fe-pop {
  position: absolute;
  z-index: 3;
  width: 272px;
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--x-border);
  border-radius: 10px;
  background: var(--vp-c-bg);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}
.fe-pop textarea,
.fe-pop > input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 14px;
  resize: vertical;
}
.fe-pop textarea:focus,
.fe-pop > input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}
.fe-pop-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.fe-pop-row.end {
  justify-content: flex-end;
}
.fe-pop-row .k {
  width: 34px;
  flex: none;
}
.fe-pop-shape,
.fe-pop-tone {
  display: grid;
  place-items: center;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.fe-pop-shape:hover,
.fe-pop-tone:hover {
  border-color: var(--x-border);
}
.fe-pop-shape.on,
.fe-pop-tone.on {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.fe-pop-shape path {
  fill: none;
  stroke: var(--vp-c-text-2);
  stroke-width: 1.5;
}
.fe-pop-shape.on path {
  stroke: var(--vp-c-brand-1);
}
.fe-pop-btn {
  padding: 3px 10px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
}
.fe-pop-btn:hover {
  border-color: var(--vp-c-brand-1);
}
.fe-pop-btn.danger:hover {
  border-color: var(--x-err);
  color: var(--x-err);
}
.fe-hit-rect {
  fill: transparent;
}
.fe-node.shape-text.sel .fe-hit-rect,
.fe-node.shape-text.hover .fe-hit-rect {
  stroke: var(--vp-c-brand-1);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.fe-group-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 12;
  pointer-events: stroke;
  cursor: move;
}
.fe-group-tab {
  fill: transparent;
  cursor: move;
}
.fe-node.shape-group.sel > path:first-child {
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.8;
}
.fe-resize {
  fill: var(--vp-c-bg);
  stroke: var(--vp-c-brand-1);
  stroke-width: 1.5;
  cursor: nwse-resize;
}
.ico-group path {
  stroke-dasharray: 3 2;
}
.ico-text text,
.fe-tools .ico-text text {
  fill: var(--vp-c-brand-1);
  font-size: 13px;
  font-weight: 700;
}
.fe-pop-shape.on .ico-text text {
  fill: var(--vp-c-brand-1);
}
.fe-pop-btn.small {
  padding: 1px 9px;
}
.fe-pop-btn.on {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}
.fe-pop-check.right {
  margin-left: auto;
  margin-right: 0;
}
.fe-pop-check {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-right: auto;
  cursor: pointer;
}
</style>
