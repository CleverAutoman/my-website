import { defineAsyncComponent, h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import { onContentUpdated, type Theme } from 'vitepress'
import { renderDiagrams } from './diagrams'
import HomePage from './components/HomePage.vue'
import BlogIndex from './components/BlogIndex.vue'
import EnvCard from './components/EnvCard.vue'
import ArchMap from './components/ArchMap.vue'
import BenchChart from './components/BenchChart.vue'
import DecodeHud from './components/DecodeHud.vue'
import NotFound from './components/NotFound.vue'
import Comments from './components/Comments.vue'
import { markAppInit } from './trace'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // 右下角 decoding 统计 / trace 面板，同时驱动全站 decoding 效果
      'layout-bottom': () => h(DecodeHud),
      'not-found': () => h(NotFound),
      'doc-after': () => h(Comments)
    }),
  setup() {
    // 正文里的思维导图、流程图：每次页面内容渲染完画出来
    onContentUpdated(() => renderDiagrams())
  },
  enhanceApp({ app }) {
    if (typeof window !== 'undefined') markAppInit()
    app.component('HomePage', HomePage)
    app.component('BlogIndex', BlogIndex)
    app.component('EnvCard', EnvCard)
    app.component('ArchMap', ArchMap)
    app.component('BenchChart', BenchChart)
    // 写作编辑器只在本地 dev 注册（页面在 _dev/editor.md），build 时整段被摇掉
    if (import.meta.env.DEV) app.component('PostEditor', defineAsyncComponent(() => import('./components/PostEditor.vue')))
  }
} satisfies Theme
