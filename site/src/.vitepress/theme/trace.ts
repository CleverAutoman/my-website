import { reactive } from 'vue'

/**
 * 页面加载 trace：全部来自浏览器 Performance API 和我们自己打的时间点，没有任何编造的数字。
 * - 首次打开：Navigation Timing（DNS / TCP / TLS / TTFB / 下载 / 解析）+ 静态资源 + Vue 激活 + decoding
 * - 站内切换：路由开始 → 页面 chunk 加载 → 渲染 → decoding
 */

export type SpanKind = 'root' | 'net' | 'asset' | 'app' | 'paint' | 'decode'
export interface Span {
  name: string
  start: number
  end: number
  depth: number
  kind: SpanKind
}

export const traceState = reactive({
  mode: 'load' as 'load' | 'route',
  spans: [] as Span[],
  t0: 0,
  total: 0
})

const marks = {
  appInit: null as number | null,
  hydrated: null as number | null,
  routeStart: null as number | null,
  chunkLoaded: null as number | null
}
export const markAppInit = () => (marks.appInit ??= performance.now())
export const markHydrated = () => (marks.hydrated ??= performance.now())
export function markRouteStart() {
  marks.routeStart = performance.now()
  marks.chunkLoaded = null
}
export const markChunkLoaded = () => (marks.chunkLoaded = performance.now())

const short = (url: string) => {
  try {
    const p = new URL(url).pathname
    return p.slice(p.lastIndexOf('/') + 1).replace(/\.[\w-]{8}\./, '.')
  } catch {
    return url
  }
}

function assetSpans(from: number, depth: number, limit: number): Span[] {
  const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  return res
    .filter((r) => r.startTime >= from && /\.(js|css|woff2?)(\?|$)/.test(r.name) && location.origin === new URL(r.name).origin)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, limit)
    .sort((a, b) => a.startTime - b.startTime)
    .map((r) => ({ name: short(r.name), start: r.startTime, end: r.responseEnd, depth, kind: 'asset' as const }))
}

export function buildTrace(path: string, dec: { tStart: number | null; tFirst: number | null; tEnd: number | null }) {
  const spans: Span[] = []
  const decodeSpans = (depth: number) => {
    if (dec.tStart == null) return
    const first = dec.tFirst ?? dec.tEnd ?? dec.tStart
    spans.push({ name: 'prefill', start: dec.tStart, end: first, depth, kind: 'decode' })
    if (dec.tEnd != null) spans.push({ name: 'decode tokens', start: first, end: dec.tEnd, depth, kind: 'decode' })
  }

  if (marks.routeStart == null) {
    // 首次打开
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    const end = Math.max(dec.tEnd ?? 0, nav?.loadEventEnd ?? 0, marks.hydrated ?? 0)
    spans.push({ name: `GET ${path}`, start: 0, end, depth: 0, kind: 'root' })
    if (nav) {
      const add = (name: string, a: number, b: number, kind: SpanKind = 'net') => {
        if (b > a) spans.push({ name, start: a, end: b, depth: 1, kind })
      }
      add('dns', nav.domainLookupStart, nav.domainLookupEnd)
      add('tcp', nav.connectStart, nav.secureConnectionStart || nav.connectEnd)
      if (nav.secureConnectionStart) add('tls', nav.secureConnectionStart, nav.connectEnd)
      add('ttfb', nav.requestStart, nav.responseStart)
      add('download html', nav.responseStart, nav.responseEnd)
      add('parse html', nav.responseEnd, nav.domInteractive, 'app')
      const assets = assetSpans(0, 2, 4)
      if (assets.length) {
        spans.push({
          name: 'fetch assets',
          start: Math.min(...assets.map((a) => a.start)),
          end: Math.max(...assets.map((a) => a.end)),
          depth: 1,
          kind: 'net'
        })
        spans.push(...assets)
      }
    }
    if (fcp) spans.push({ name: 'first paint', start: fcp.startTime, end: fcp.startTime, depth: 1, kind: 'paint' })
    if (marks.appInit != null && marks.hydrated != null)
      spans.push({ name: 'hydrate (vue)', start: marks.appInit, end: marks.hydrated, depth: 1, kind: 'app' })
    decodeSpans(1)
    traceState.mode = 'load'
  } else {
    // 站内切换
    const t0 = marks.routeStart
    const end = Math.max(dec.tEnd ?? 0, marks.chunkLoaded ?? 0)
    spans.push({ name: `route ${path}`, start: t0, end, depth: 0, kind: 'root' })
    if (marks.chunkLoaded != null) {
      spans.push({ name: 'load page chunk', start: t0, end: marks.chunkLoaded, depth: 1, kind: 'net' })
      spans.push(...assetSpans(t0, 2, 2))
      if (dec.tStart != null) spans.push({ name: 'render', start: marks.chunkLoaded, end: dec.tStart, depth: 1, kind: 'app' })
    }
    decodeSpans(1)
    traceState.mode = 'route'
  }

  const t0 = spans[0]?.start ?? 0
  traceState.t0 = t0
  traceState.total = Math.max(1, ...spans.map((s) => s.end - t0))
  traceState.spans = spans
}
