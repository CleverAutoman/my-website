<script setup lang="ts">
// 文章页右上角的「编辑这篇」：只在本地 dev 挂载（theme/index.ts）。
// 点了就在当前页原地编辑（InlineEditor：所见即所得，不用跳页、不用左右对照），「完成」回到页面。
// 编辑器只能改 blog/ 下的 .md（.vitepress/editor.ts 的 POST_RE），其他页面不显示。
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { useData } from 'vitepress'

// CodeMirror 比较大，点了「编辑」才加载
const InlineEditor = defineAsyncComponent(() => import('./InlineEditor.vue'))

const { page } = useData()
const file = computed(() => page.value.relativePath)
const show = computed(() => /^blog\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(file.value))

const editing = ref(false)
const start = ref<{ text: string; top: number }>()

const pageHeadings = () =>
  [...document.querySelectorAll<HTMLElement>('.VPDoc main.main > .vp-doc :is(h1, h2, h3, h4, h5, h6)')]
const headingText = (el: HTMLElement) => (el.textContent ?? '').replace(/​/g, '').trim()

function startEdit() {
  // 记下屏幕上第一个能看到的标题和它离视口顶的距离，编辑区打开后把同一个标题放到同一高度；
  // 屏幕上没有标题时，用视口上方最近的那个
  const nav = 64
  const heads = pageHeadings()
  const visible = heads.find((el) => {
    const top = el.getBoundingClientRect().top
    return top >= nav + 40 && top < window.innerHeight - 80
  })
  const above = heads.filter((el) => el.getBoundingClientRect().top < nav + 40).pop()
  const pick = visible ?? above
  start.value = pick ? { text: headingText(pick), top: Math.max(nav + 56, pick.getBoundingClientRect().top) } : undefined
  editing.value = true
}

async function stopEdit(heading: string | null) {
  editing.value = false
  if (!heading) return
  // 回到页面时停在编辑时光标所在的那一节
  await nextTick()
  const want = heading.replace(/\{#[^}]*\}/g, '').replace(/[*_`]/g, '').replace(/\s+/g, '')
  const el = pageHeadings().find((e) => headingText(e).replace(/\s+/g, '') === want)
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96 })
}

// 换了页面就退出编辑（InlineEditor 卸载时会把没保存的改动存掉）
watch(file, () => (editing.value = false))
</script>

<template>
  <!-- data-decode-skip：不参与正文的逐字生成效果，也不计入 token 统计 -->
  <div v-if="show" class="edit-entry" :class="{ editing }" data-decode-skip>
    <InlineEditor v-if="editing" :file="file" :start="start" @close="stopEdit" />
    <button v-else type="button" class="edit-btn" title="在这一页直接编辑（只在本地 dev 显示）" @click="startEdit">
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
    </button>
  </div>
</template>

<style scoped>
.edit-entry {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.edit-entry.editing {
  display: block;
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
  cursor: pointer;
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
