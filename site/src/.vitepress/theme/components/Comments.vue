<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useData, useRoute } from 'vitepress'
import { giscusConfig as g } from '../giscus'

const route = useRoute()
const { isDark, frontmatter } = useData()
const box = ref<HTMLElement>()

// 只在文章页显示：/blog/ 下、不是索引页、frontmatter 没写 comments: false
const enabled = computed(
  () =>
    !!g.categoryId &&
    route.path.includes('/blog/') &&
    !route.path.endsWith('/') &&
    frontmatter.value.comments !== false
)
const theme = computed(() => (isDark.value ? 'transparent_dark' : 'light'))
const lang = computed(() => (route.path.includes('/blog/ai-infra/') ? 'zh-CN' : 'en'))

function mount() {
  if (!enabled.value || !box.value) return
  box.value.innerHTML = ''
  const s = document.createElement('script')
  s.src = 'https://giscus.app/client.js'
  s.async = true
  s.crossOrigin = 'anonymous'
  const attrs: Record<string, string> = {
    'data-repo': g.repo,
    'data-repo-id': g.repoId,
    'data-category': g.category,
    'data-category-id': g.categoryId,
    'data-mapping': 'pathname',
    'data-strict': '1',
    'data-reactions-enabled': '1',
    'data-emit-metadata': '0',
    'data-input-position': 'top',
    'data-theme': theme.value,
    'data-lang': lang.value,
    'data-loading': 'lazy'
  }
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v)
  box.value.appendChild(s)
}

onMounted(mount)
watch(() => route.path, () => requestAnimationFrame(mount))
// 切换深浅色时通知 giscus iframe 换主题，不重新加载
watch(theme, (t) => {
  const iframe = box.value?.querySelector<HTMLIFrameElement>('iframe.giscus-frame')
  iframe?.contentWindow?.postMessage({ giscus: { setConfig: { theme: t } } }, 'https://giscus.app')
})
</script>

<template>
  <section v-if="enabled" class="comments" data-decode-skip aria-label="Comments">
    <p class="c-label">// comments</p>
    <div ref="box" />
  </section>
</template>

<style scoped>
.comments {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
}
.c-label {
  margin: 0 0 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-brand-1);
}
</style>
