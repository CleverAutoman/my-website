// 浏览器端画思维导图：.mindmap[data-map]（由 .vitepress/diagrams.ts 在 markdown 渲染时生成）用 markmap-view 画成 SVG。
// markmap-view（含 d3）按需加载，页面里没有导图就不下载。正文页面、编辑器的实时渲染和块预览共用。
// 流程图（```flow）构建时就是静态 SVG，不需要在这里处理。
import type { Markmap } from 'markmap-view'

export async function renderDiagrams(root: ParentNode = document) {
  await renderMindmaps(root)
}

/* ---------------- 思维导图 ---------------- */

type View = { mm: Markmap; ro: ResizeObserver; svg: SVGSVGElement; key: string }
const views = new Map<HTMLElement, View>()
let lib: Promise<typeof import('markmap-view')> | undefined

// 分支配色：品牌橙打头，其余取中等明度的颜色，暖白和深色两种背景上的线和圆点都看得清
const COLORS = ['#d97706', '#0284c7', '#7c3aed', '#059669', '#db2777', '#ca8a04', '#e11d48', '#0d9488']

function observe(el: HTMLElement, mm: Markmap) {
  let t: ReturnType<typeof setTimeout> | undefined
  const ro = new ResizeObserver(() => {
    clearTimeout(t)
    t = setTimeout(() => mm.fit(), 120)
  })
  ro.observe(el)
  return ro
}

export async function renderMindmaps(root: ParentNode = document) {
  const els = [...root.querySelectorAll<HTMLElement>('.mindmap[data-map]:not([data-rendered])')]

  // 已经不在页面上的导图：编辑器实时渲染每次都整块替换 HTML，内容没变的导图直接把旧 SVG 搬过去，
  // 不重画（不闪、折叠状态也保留）；剩下的销毁
  const stale = new Map<string, View>()
  for (const [el, v] of views) {
    if (el.isConnected) continue
    views.delete(el)
    v.ro.disconnect()
    if (stale.has(v.key)) v.mm.destroy()
    else stale.set(v.key, v)
  }
  for (const el of els) {
    const v = stale.get(el.dataset.map!)
    if (!v) continue
    stale.delete(v.key)
    el.dataset.rendered = '1'
    el.prepend(v.svg)
    views.set(el, { ...v, ro: observe(el, v.mm) })
  }
  for (const v of stale.values()) v.mm.destroy()

  if (!els.some((el) => !el.dataset.rendered)) return
  const { Markmap, deriveOptions } = await (lib ??= import('markmap-view'))
  const options = deriveOptions({
    color: COLORS,
    colorFreezeLevel: 2, // 同一个一级分支下的节点同色
    maxWidth: 280,
    initialExpandLevel: -1,
    maxInitialScale: 1, // 小导图不要放大成巨字
    fitRatio: 0.92,
    duration: 300,
    // 正文里滚轮要用来翻页：不接管滚轮缩放，也不拖拽平移；点节点折叠 / 展开后自动重新适配
    zoom: false,
    pan: false
  })
  for (const el of els) {
    if (!el.isConnected || el.dataset.rendered) continue
    let data
    try {
      data = JSON.parse(el.dataset.map!)
    } catch {
      continue
    }
    el.dataset.rendered = '1'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.classList.add('mindmap-svg')
    el.prepend(svg)
    const mm = Markmap.create(svg, { ...options, autoFit: true }, data)
    views.set(el, { mm, ro: observe(el, mm), svg, key: el.dataset.map! })
  }
}
