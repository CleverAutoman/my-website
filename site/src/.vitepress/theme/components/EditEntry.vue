<script setup lang="ts">
// 文章页右上角的「编辑」入口：只在本地 dev 挂载（theme/index.ts），跳到 /_dev/editor 打开这篇。
// 编辑器只能改 blog/ 下的 .md（.vitepress/editor.ts 的 POST_RE），其他页面不显示。
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

const { page } = useData()
const file = computed(() => page.value.relativePath)
const show = computed(() => /^blog\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(file.value))
const href = computed(() => withBase(`/_dev/editor?file=${encodeURIComponent(file.value)}`))
</script>

<template>
  <!-- data-decode-skip：不参与正文的逐字生成效果，也不计入 token 统计 -->
  <div v-if="show" class="edit-entry" data-decode-skip>
    <a :href="href" class="edit-btn" title="在本地编辑器里打开这篇（只在 dev 显示）">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z M13.5 6.5l4 4"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      编辑这篇
    </a>
  </div>
</template>

<style scoped>
.edit-entry {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.2s, border-color 0.2s, background-color 0.2s;
}

.edit-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-brand-soft);
}

.edit-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
