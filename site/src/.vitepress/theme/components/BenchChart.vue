<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 文章里的 benchmark 图表。用法：在文章的 script setup 块里
 *   import tput from './data/throughput.json'
 * 然后正文写 <BenchChart :data="tput" />，完整示例见本地 dev 的 /_dev/components 页面。
 *
 * kind: 'line'（默认，比如吞吐-并发曲线）或 'bar'（分组柱状图，比如 p50/p90/p99 延迟）。
 * 最多 4 条 series，颜色按顺序固定分配，隐藏某条不会让其他系列换色。
 */
interface BenchSeries {
  name: string
  values: (number | null)[]
}
interface BenchData {
  title?: string
  kind?: 'line' | 'bar'
  x: { label: string; values: (string | number)[] }
  y: { label: string; unit?: string }
  series: BenchSeries[]
  note?: string
}

const props = defineProps<{ data: BenchData; height?: number }>()

const MAX_SERIES = 4
const series = computed(() => props.data.series.slice(0, MAX_SERIES))
const kind = computed(() => props.data.kind ?? 'line')
const xs = computed(() => props.data.x.values)
const unit = computed(() => props.data.y.unit ?? '')

const hidden = ref<number[]>([])
const visible = computed(() => series.value.map((_, i) => i).filter((i) => !hidden.value.includes(i)))
function toggle(i: number) {
  if (hidden.value.includes(i)) hidden.value = hidden.value.filter((h) => h !== i)
  else if (visible.value.length > 1) hidden.value = [...hidden.value, i]
}
const showTable = ref(false)

/* ---------- 尺寸 ---------- */
const root = ref<HTMLElement>()
const width = ref(640)
let ro: ResizeObserver | undefined
onMounted(() => {
  if (props.data.series.length > MAX_SERIES)
    console.warn(`[BenchChart] 最多 ${MAX_SERIES} 条 series，多出的已忽略：`, props.data.title)
  if (!root.value) return
  width.value = root.value.clientWidth
  ro = new ResizeObserver(([e]) => (width.value = Math.round(e.contentRect.width)))
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const H = computed(() => props.height ?? 300)
const narrow = computed(() => width.value < 520)

/* ---------- 刻度 ---------- */
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}
const allValues = computed(() =>
  series.value.flatMap((s) => s.values.filter((v): v is number => typeof v === 'number'))
)
// 纵轴用全部系列的最大值，切换显示时刻度不跳
const ticks = computed(() => {
  const max = Math.max(...allValues.value, 0)
  if (max <= 0) return [0, 1]
  const step = niceStep(max / 4)
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) out.push(+v.toFixed(6))
  return out
})
const yMax = computed(() => ticks.value[ticks.value.length - 1])

const fmt = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 2 : 1 })
const fmtTick = (v: number) =>
  yMax.value >= 10000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : v.toLocaleString('en-US')

/* ---------- 布局 ---------- */
const endLabelW = 104
const yAt = (v: number) => m.value.t + innerH.value - (v / yMax.value) * innerH.value
const innerH = computed(() => H.value - 14 - 40)

// 线图末端直接标注；末端点太挤时不硬挪位置，只保留图例
const endLabelsOk = computed(() => {
  if (kind.value !== 'line' || narrow.value) return false
  const last = xs.value.length - 1
  const ys = visible.value
    .map((i) => series.value[i].values[last])
    .filter((v): v is number => typeof v === 'number')
    .map((v) => (v / (yMax.value || 1)) * innerH.value)
    .sort((a, b) => a - b)
  return ys.every((y, k) => k === 0 || y - ys[k - 1] >= 14)
})
const m = computed(() => ({ l: 52, r: endLabelsOk.value ? endLabelW : 16, t: 14, b: 40 }))
const innerW = computed(() => Math.max(40, width.value - m.value.l - m.value.r))

const n = computed(() => xs.value.length)
const xLine = (i: number) => m.value.l + (n.value === 1 ? innerW.value / 2 : (i * innerW.value) / (n.value - 1))

const paths = computed(() =>
  series.value.map((s) => {
    let d = ''
    let pen = false
    s.values.forEach((v, i) => {
      if (typeof v !== 'number') {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${xLine(i).toFixed(1)},${yAt(v).toFixed(1)}`
      pen = true
    })
    return d
  })
)

// 分组柱状图
const band = computed(() => innerW.value / Math.max(1, n.value))
const barW = computed(() => {
  const k = visible.value.length
  return Math.max(4, Math.min(24, (band.value * 0.72 - (k - 1) * 2) / k))
})
const groupW = computed(() => visible.value.length * barW.value + (visible.value.length - 1) * 2)
const barX = (i: number, slot: number) => m.value.l + band.value * i + (band.value - groupW.value) / 2 + slot * (barW.value + 2)
function barPath(x: number, v: number) {
  const y = yAt(v)
  const h = m.value.t + innerH.value - y
  const w = barW.value
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`
}
const xLabelAt = (i: number) => (kind.value === 'line' ? xLine(i) : m.value.l + band.value * (i + 0.5))
// x 轴标签太密时隔一个显示
const xLabelEvery = computed(() => Math.max(1, Math.ceil((n.value * 44) / innerW.value)))

/* ---------- 悬停 / 键盘 ---------- */
const hoverIdx = ref<number | null>(null)
const hoverBar = ref<{ i: number; s: number } | null>(null)

function onMove(e: PointerEvent) {
  if (kind.value !== 'line') return
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  const x = e.clientX - rect.left
  const step = n.value > 1 ? innerW.value / (n.value - 1) : 1
  hoverIdx.value = Math.min(n.value - 1, Math.max(0, Math.round((x - m.value.l) / step)))
}
function onLeave() {
  hoverIdx.value = null
  hoverBar.value = null
}
function onKey(e: KeyboardEvent) {
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!dir) return
  e.preventDefault()
  if (kind.value === 'line') {
    hoverIdx.value = Math.min(n.value - 1, Math.max(0, (hoverIdx.value ?? (dir > 0 ? -1 : n.value)) + dir))
  } else {
    const flat = xs.value.flatMap((_, i) => visible.value.map((s) => ({ i, s })))
    const cur = hoverBar.value ? flat.findIndex((b) => b.i === hoverBar.value!.i && b.s === hoverBar.value!.s) : -1
    hoverBar.value = flat[Math.min(flat.length - 1, Math.max(0, cur + dir))]
  }
}

const tooltip = computed(() => {
  if (kind.value === 'line' && hoverIdx.value != null) {
    const i = hoverIdx.value
    return {
      x: xLine(i),
      head: `${props.data.x.label} ${xs.value[i]}`,
      rows: visible.value
        .map((s) => ({ s, name: series.value[s].name, v: series.value[s].values[i] }))
        .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
    }
  }
  if (kind.value === 'bar' && hoverBar.value) {
    const { i, s } = hoverBar.value
    const slot = visible.value.indexOf(s)
    return {
      x: barX(i, slot) + barW.value / 2,
      head: `${props.data.x.label} ${xs.value[i]}`,
      rows: [{ s, name: series.value[s].name, v: series.value[s].values[i] }]
    }
  }
  return null
})
const tipLeft = computed(() => (tooltip.value ? tooltip.value.x > width.value * 0.6 : false))

const ariaLabel = computed(
  () =>
    `${props.data.title ?? 'Benchmark chart'}: ${props.data.y.label} by ${props.data.x.label}, ` +
    series.value.map((s) => s.name).join(', ') +
    '. Use the Table button for exact values.'
)
</script>

<template>
  <figure ref="root" class="vp-raw bench" :class="kind">
    <figcaption v-if="data.title" class="b-title">{{ data.title }}</figcaption>
    <p class="b-sub">{{ data.y.label }} · by {{ data.x.label }}</p>

    <div class="b-controls">
      <div class="legend" role="group" aria-label="Series">
        <button
          v-for="(s, i) in series"
          :key="s.name"
          type="button"
          class="lg"
          :class="{ off: hidden.includes(i) }"
          :style="{ '--c': `var(--s${i + 1})` }"
          :aria-pressed="!hidden.includes(i)"
          @click="toggle(i)"
        >
          <span class="key" :class="kind" />{{ s.name }}
        </button>
      </div>
      <button type="button" class="tbl-btn" :aria-pressed="showTable" @click="showTable = !showTable">
        {{ showTable ? 'Chart' : 'Table' }}
      </button>
    </div>

    <div v-show="!showTable" class="plot">
      <svg
        :width="width"
        :height="H"
        :viewBox="`0 0 ${width} ${H}`"
        role="img"
        :aria-label="ariaLabel"
        tabindex="0"
        @pointermove="onMove"
        @pointerleave="onLeave"
        @keydown="onKey"
        @blur="onLeave"
      >
        <!-- 网格与刻度 -->
        <g class="grid">
          <template v-for="t in ticks" :key="t">
            <line :x1="m.l" :x2="width - m.r" :y1="yAt(t)" :y2="yAt(t)" :class="{ base: t === 0 }" />
            <text :x="m.l - 10" :y="yAt(t)" dy="0.32em" text-anchor="end">{{ fmtTick(t) }}</text>
          </template>
        </g>
        <g class="xaxis">
          <template v-for="(xv, i) in xs" :key="i">
            <text v-if="i % xLabelEvery === 0" :x="xLabelAt(i)" :y="m.t + innerH + 20" text-anchor="middle">
              {{ xv }}
            </text>
          </template>
          <text class="axis-name" :x="m.l + innerW / 2" :y="H - 2" text-anchor="middle">{{ data.x.label }}</text>
        </g>

        <!-- 折线 -->
        <template v-if="kind === 'line'">
          <line
            v-if="hoverIdx != null"
            class="crosshair"
            :x1="xLine(hoverIdx)"
            :x2="xLine(hoverIdx)"
            :y1="m.t"
            :y2="m.t + innerH"
          />
          <g v-for="s in visible" :key="s" :style="{ '--c': `var(--s${s + 1})` }">
            <path class="line" :d="paths[s]" />
            <template v-for="(v, i) in series[s].values" :key="i">
              <circle
                v-if="typeof v === 'number'"
                class="pt"
                :cx="xLine(i)"
                :cy="yAt(v)"
                :r="hoverIdx === i ? 5.5 : 4"
              />
            </template>
            <template v-if="endLabelsOk && typeof series[s].values[n - 1] === 'number'">
              <text class="end-label" :x="xLine(n - 1) + 12" :y="yAt(series[s].values[n - 1] as number)" dy="0.32em">
                {{ series[s].name }}
              </text>
            </template>
          </g>
        </template>

        <!-- 分组柱状图 -->
        <template v-else>
          <template v-for="(_, i) in xs" :key="i">
            <g v-for="(s, slot) in visible" :key="s" :style="{ '--c': `var(--s${s + 1})` }">
              <path
                v-if="typeof series[s].values[i] === 'number'"
                class="bar"
                :class="{ hot: hoverBar && hoverBar.i === i && hoverBar.s === s }"
                :d="barPath(barX(i, slot), series[s].values[i] as number)"
              />
              <rect
                class="hit"
                :x="barX(i, slot) - 1"
                :y="m.t"
                :width="barW + 2"
                :height="innerH"
                @pointerenter="hoverBar = { i, s }"
              />
            </g>
          </template>
        </template>
      </svg>

      <div
        v-if="tooltip"
        class="tip"
        :class="{ left: tipLeft }"
        :style="{ left: `${tooltip.x}px` }"
        role="status"
        aria-live="polite"
      >
        <div class="tip-head">{{ tooltip.head }}</div>
        <div v-for="r in tooltip.rows" :key="r.s" class="tip-row" :style="{ '--c': `var(--s${r.s + 1})` }">
          <span class="key line" />
          <b>{{ fmt(r.v) }}</b><span class="tip-unit">{{ unit }}</span>
          <span class="tip-name">{{ r.name }}</span>
        </div>
      </div>
    </div>

    <div v-if="showTable" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ data.x.label }}</th>
            <th v-for="s in series" :key="s.name">{{ s.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(xv, i) in xs" :key="i">
            <td>{{ xv }}</td>
            <td v-for="s in series" :key="s.name">{{ fmt(s.values[i]) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="unit" class="b-note">Unit: {{ unit }}</p>
    </div>

    <p v-if="data.note" class="b-note">{{ data.note }}</p>
  </figure>
</template>

<style scoped>
/* 分类色板：已用 dataviz 校验器对站点面板色 #ffffff / #0f141b 验证（相邻色 CVD ΔE ≥ 8） */
.bench {
  --s1: #2a78d6;
  --s2: #eb6834;
  --s3: #1baf7a;
  --s4: #eda100;
  margin: 24px 0;
  padding: 18px 18px 14px;
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
  position: relative;
}
:global(.dark) .bench {
  --s1: #3987e5;
  --s2: #d95926;
  --s3: #199e70;
  --s4: #c98500;
}
.b-title {
  font-weight: 600;
  font-size: 16px;
  color: var(--vp-c-text-1);
}
.b-sub {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.b-controls {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 12px 0 6px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}
.lg,
.tbl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid var(--x-border);
  font-size: 13px;
  color: var(--vp-c-text-1);
  background: transparent;
  transition: opacity 0.2s, border-color 0.2s;
}
.lg:hover,
.tbl-btn:hover {
  border-color: var(--x-border-hover);
}
.lg.off {
  opacity: 0.45;
}
.lg.off .key {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--c);
}
.tbl-btn {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
  flex-shrink: 0;
}
.key {
  display: inline-block;
  background: var(--c);
  flex-shrink: 0;
}
.key.line {
  width: 14px;
  height: 2px;
  border-radius: 1px;
}
.key.bar {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}
.plot {
  position: relative;
}
svg {
  display: block;
  overflow: visible;
  outline: none;
  touch-action: pan-y;
}
svg:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 4px;
  border-radius: 4px;
}
.grid line {
  stroke: var(--vp-c-divider);
  stroke-width: 1;
}
.grid line.base {
  stroke: var(--x-border-hover);
}
text {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  fill: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}
.axis-name {
  font-family: var(--vp-font-family-base);
  fill: var(--vp-c-text-2);
}
.crosshair {
  stroke: var(--x-border-hover);
  stroke-width: 1;
}
.line {
  fill: none;
  stroke: var(--c);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.pt {
  fill: var(--c);
  stroke: var(--x-panel);
  stroke-width: 2;
  transition: r 0.12s;
}
.end-label {
  font-family: var(--vp-font-family-base);
  font-size: 12px;
  fill: var(--vp-c-text-1);
}
.bar {
  fill: var(--c);
  transition: opacity 0.15s;
}
.bar.hot {
  opacity: 0.8;
}
.hit {
  fill: transparent;
}
.tip {
  position: absolute;
  top: 6px;
  transform: translateX(12px);
  min-width: 150px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--x-border);
  background: var(--vp-c-bg-elv);
  box-shadow: 0 8px 24px -8px var(--x-shadow);
  pointer-events: none;
  font-size: 12.5px;
  z-index: 2;
}
.tip.left {
  transform: translateX(calc(-100% - 12px));
}
.tip-head {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-text-3);
  margin-bottom: 4px;
}
.tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.7;
  white-space: nowrap;
}
.tip-row b {
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}
.tip-unit {
  color: var(--vp-c-text-2);
  font-size: 11.5px;
}
.tip-name {
  color: var(--vp-c-text-2);
  margin-left: 6px;
}
.table-wrap {
  overflow-x: auto;
  margin-top: 6px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  text-align: right;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
th:first-child,
td:first-child {
  text-align: left;
}
th {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
}
.b-note {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--vp-c-text-3);
}
@media (prefers-reduced-motion: reduce) {
  .pt,
  .bar,
  .lg {
    transition: none;
  }
}
</style>
