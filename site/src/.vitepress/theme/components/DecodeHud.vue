<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vitepress'
import { canAnimate, decodeState as s, replayDecode, startDecode, stopDecode } from '../decoder'
import { buildTrace, markChunkLoaded, markHydrated, markRouteStart, traceState as tr } from '../trace'

const route = useRoute()
const router = useRouter()
const open = ref(false)
const tab = ref<'stats' | 'trace'>('stats')
const root = ref<HTMLElement | null>(null)

// 面板打开时，点击 HUD 以外的任何位置（或按 Esc）都收起
function onOutside(e: PointerEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
watch(open, (v) => {
  if (v) {
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('pointerdown', onOutside, true)
    document.removeEventListener('keydown', onKey)
  }
})

const fmt = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const total = computed(() => s.textTokens + s.imageTokens)
const imgPending = computed(() => s.images - s.imagesMeasured)

const raf2 = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
async function run() {
  await nextTick()
  await raf2()
  startDecode(document.querySelector<HTMLElement>('.VPContent'))
}

// decoding 结束后生成 trace
watch(
  () => s.phase,
  (p) => {
    if (p === 'done') buildTrace(route.path, { tStart: s.tStart, tFirst: s.tFirst, tEnd: s.tEnd })
  }
)

let prevBefore: typeof router.onBeforeRouteChange
let prevLoad: typeof router.onAfterPageLoad
let prevChange: typeof router.onAfterRouteChange
let failsafe: number | undefined
onMounted(() => {
  markHydrated()
  prevBefore = router.onBeforeRouteChange
  router.onBeforeRouteChange = async (to) => {
    const r = await prevBefore?.(to)
    markRouteStart()
    return r
  }
  // 新页面渲染前先把正文藏起来，避免内容闪一下再开始 decoding
  prevLoad = router.onAfterPageLoad
  router.onAfterPageLoad = async (href) => {
    await prevLoad?.(href)
    markChunkLoaded()
    stopDecode()
    if (!canAnimate()) return
    document.documentElement.classList.add('decode-pending')
    window.clearTimeout(failsafe)
    failsafe = window.setTimeout(() => document.documentElement.classList.remove('decode-pending'), 2000)
  }
  // 包括浏览器前进/后退在内，每次路由切换完成后重新 decoding
  prevChange = router.onAfterRouteChange
  router.onAfterRouteChange = async (href) => {
    await prevChange?.(href)
    run()
  }
  run()
})
onBeforeUnmount(() => {
  router.onBeforeRouteChange = prevBefore
  router.onAfterPageLoad = prevLoad
  router.onAfterRouteChange = prevChange
  window.clearTimeout(failsafe)
  stopDecode()
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onKey)
})

const pct = (v: number) => `${((v / tr.total) * 100).toFixed(2)}%`
</script>

<template>
  <div ref="root" class="decode-hud" :data-phase="s.phase">
    <div v-if="open" id="decode-panel" class="panel" role="dialog" aria-label="Decode statistics and page trace">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="tab === 'stats'" @click="tab = 'stats'">stats</button>
        <button type="button" role="tab" :aria-selected="tab === 'trace'" @click="tab = 'trace'">trace</button>
        <span class="p-path">{{ route.path }}</span>
      </div>

      <template v-if="tab === 'stats'">
        <dl>
          <dt>ttft</dt>
          <dd>{{ s.animated ? `${fmt(s.ttft)} ms` : '—' }}</dd>
          <dt>duration</dt>
          <dd>{{ s.duration != null ? `${fmt(s.duration, 2)} s` : '—' }}</dd>
          <dt>avg speed</dt>
          <dd>{{ s.avgTps != null ? `${fmt(s.avgTps)} tok/s` : '—' }}</dd>
        </dl>
        <dl>
          <dt>text</dt>
          <dd>
            <b>{{ fmt(s.textTokens) }}</b> tok <span class="note">decode</span>
          </dd>
          <dt>image</dt>
          <dd>
            <b>{{ fmt(s.imageTokens) }}</b> tok
            <span class="note"
              >prefill · {{ s.images }} img{{ s.images === 1 ? '' : 's' }}<template v-if="imgPending > 0"
                >, {{ imgPending }} loading</template
              ></span
            >
          </dd>
          <dt>total</dt>
          <dd class="total">
            <b>{{ fmt(total) }}</b> tok
          </dd>
        </dl>
        <p class="method">
          Estimates. Text: BPE-style heuristic (≈1 token per short word, per CJK character, per punctuation mark).
          Image: w × h / 750 after resizing to ≤1568px long edge.
        </p>
      </template>

      <template v-else>
        <p class="trace-head">
          {{ tr.mode === 'load' ? 'initial page load' : 'client-side navigation' }} ·
          <b>{{ fmt(tr.total) }} ms</b>
        </p>
        <ol v-if="tr.spans.length" class="spans">
          <li v-for="(sp, i) in tr.spans" :key="i" class="span" :data-kind="sp.kind">
            <span class="sp-name" :style="{ paddingLeft: `${sp.depth * 10}px` }" :title="sp.name">{{ sp.name }}</span>
            <span class="sp-track">
              <span
                class="sp-bar"
                :style="{ left: pct(sp.start - tr.t0), width: sp.kind === 'paint' ? '2px' : pct(Math.max(sp.end - sp.start, tr.total * 0.006)) }"
              />
            </span>
            <span class="sp-ms">{{ sp.kind === 'paint' ? `@${fmt(sp.start - tr.t0)}` : fmt(sp.end - sp.start) }}</span>
          </li>
        </ol>
        <p v-else class="method">Trace is ready once decoding finishes.</p>
        <p class="method">Real timings from the browser's Performance API (Navigation &amp; Resource Timing) plus marks around hydration and decoding. Durations in ms.</p>
      </template>

      <button type="button" class="replay" @click="replayDecode()">↻ replay decoding</button>
    </div>

    <button
      type="button"
      class="pill"
      :aria-expanded="open"
      aria-controls="decode-panel"
      :title="open ? 'Hide decode stats' : 'Show decode stats'"
      @click="open = !open"
    >
      <span class="dot" />
      <template v-if="s.phase === 'prefill'">prefill</template>
      <template v-else-if="s.phase === 'decode'">
        decoding <b>{{ fmt(s.decoded) }}</b>/{{ fmt(s.textTokens) }}
        <span v-if="s.ttft != null" class="dim extra">· ttft {{ fmt(s.ttft) }} ms</span>
        <span class="dim">· {{ fmt(s.tps) }} tok/s</span>
      </template>
      <template v-else-if="s.phase === 'done'">
        eos
        <!-- 默认只显示 eos + 总 token，hover 时再展开 ttft / tok/s -->
        <span v-if="s.animated && s.ttft != null" class="extra"><span class="dim">·</span> ttft <b>{{ fmt(s.ttft) }}</b> ms</span>
        <span v-if="s.avgTps != null" class="extra"><span class="dim">·</span> <b>{{ fmt(s.avgTps) }}</b> tok/s</span>
        <span class="dim">·</span> <b>{{ fmt(total) }}</b> tok
      </template>
      <template v-else>idle</template>
    </button>
  </div>
</template>

<style scoped>
.decode-hud {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
  pointer-events: none;
}
.decode-hud > * {
  pointer-events: auto;
}
.decode-hud[data-phase='prefill'] {
  --hud-c: var(--x-blue);
}
.decode-hud[data-phase='decode'] {
  --hud-c: var(--vp-c-brand-1);
}
.decode-hud[data-phase='done'],
.decode-hud[data-phase='idle'] {
  --hud-c: var(--vp-c-text-3);
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--x-border);
  background: color-mix(in srgb, var(--x-panel) 88%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 20px -8px var(--x-shadow);
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: border-color 0.2s;
}
.pill:hover {
  border-color: var(--x-border-hover);
}
.pill b {
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.dim {
  color: var(--vp-c-text-3);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--hud-c);
}
.decode-hud[data-phase='prefill'] .dot,
.decode-hud[data-phase='decode'] .dot {
  animation: throb 0.7s ease-in-out infinite alternate;
}
@keyframes throb {
  to {
    opacity: 0.3;
  }
}
.panel {
  width: min(340px, calc(100vw - 32px));
  max-height: calc(100vh - 72px);
  overflow-y: auto;
  padding: 10px 14px 12px;
  border-radius: 10px;
  border: 1px solid var(--x-border);
  background: var(--x-panel);
  box-shadow: 0 16px 40px -12px var(--x-shadow);
}
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.tabs button {
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--vp-c-text-3);
}
.tabs button[aria-selected='true'] {
  color: var(--vp-c-text-1);
  background: var(--x-panel-2);
  box-shadow: inset 0 0 0 1px var(--x-border);
}
.p-path {
  margin-left: auto;
  font-size: 11px;
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 45%;
}
dl {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 4px 10px;
  margin: 0;
  padding: 8px 0;
  border-top: 1px dashed var(--x-border);
}
dt {
  color: var(--vp-c-text-3);
}
dd {
  margin: 0;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}
dd b {
  font-weight: 600;
}
.total b {
  color: var(--vp-c-brand-1);
}
.note {
  color: var(--vp-c-text-3);
  margin-left: 4px;
}
dd .note {
  font-size: 11px;
}
div.note {
  margin-left: 0;
}
.method {
  margin: 4px 0 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--x-border);
  font-family: var(--vp-font-family-base);
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--vp-c-text-3);
}
.trace-head {
  margin: 0 0 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--x-border);
  color: var(--vp-c-text-2);
}
.trace-head b {
  color: var(--vp-c-text-1);
}
.spans {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
}
.span {
  display: grid;
  grid-template-columns: 112px 1fr 44px;
  align-items: center;
  gap: 8px;
  height: 20px;
  font-size: 11px;
}
.sp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vp-c-text-2);
}
.span[data-kind='root'] .sp-name {
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.sp-track {
  position: relative;
  height: 10px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--vp-c-text-3) 10%, transparent);
}
.sp-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: var(--sp-c);
}
.span[data-kind='root'] {
  --sp-c: var(--vp-c-text-3);
}
.span[data-kind='net'] {
  --sp-c: var(--x-blue);
}
.span[data-kind='asset'] {
  --sp-c: color-mix(in srgb, var(--x-blue) 55%, transparent);
}
.span[data-kind='app'] {
  --sp-c: var(--x-violet);
}
.span[data-kind='paint'] {
  --sp-c: var(--vp-c-text-1);
}
.span[data-kind='decode'] {
  --sp-c: var(--vp-c-brand-1);
}
.sp-ms {
  text-align: right;
  color: var(--vp-c-text-1);
  font-variant-numeric: tabular-nums;
}
.replay {
  width: 100%;
  padding: 6px 0;
  border-radius: 6px;
  border: 1px solid var(--x-border);
  color: var(--vp-c-text-2);
  transition: color 0.2s, border-color 0.2s;
}
.replay:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
@media (max-width: 640px) {
  .decode-hud {
    right: 12px;
    bottom: 12px;
  }
}
/* hover / 键盘聚焦时才显示的额外指标 */
.extra {
  display: none;
}
.pill:hover .extra,
.pill:focus-visible .extra {
  display: inline;
}
@media print {
  .decode-hud {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none !important;
  }
}
</style>
