<script setup lang="ts">
// 替换 VitePress 自带的 VPDocOutlineItem（config.mts 里用 alias 换掉）：
// 有子标题的项前面加一个三角箭头，点箭头或标题都能展开/收起；滚动到某一节时自动展开它所在的分支。
import { inject, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import { useRoute } from 'vitepress'

interface MenuItem {
  title: string
  link: string
  children?: MenuItem[]
}

const props = defineProps<{
  headers: MenuItem[]
  root?: boolean
  depth?: number
}>()

const KEY = 'outline-open'
const isTop = props.depth === undefined
const open: Set<string> = isTop ? reactive(new Set<string>()) : inject<Set<string>>(KEY)!
if (isTop) provide(KEY, open)

function toggle(link: string) {
  if (open.has(link)) open.delete(link)
  else open.add(link)
  nextTick(syncMarker)
}

// 点标题：跳到这一节；有子标题的同时展开/收起
function onClick({ target: el }: Event, link: string, hasChildren: boolean) {
  if (hasChildren) toggle(link)
  const id = (el as HTMLAnchorElement).href!.split('#')[1]
  const heading = document.getElementById(decodeURIComponent(id))
  heading?.focus({ preventScroll: true })
}

/* ---- 只在最外层实例里做：跟随当前小节自动展开，并修正左侧高亮条的位置 ---- */
const el = ref<HTMLElement>()
let observer: MutationObserver | undefined
let lastActive: Element | null = null

// VitePress 的高亮条按 activeLink.offsetTop + 39 定位；当前项被收起时它的 offsetTop 是 0，
// 这里改成指向最近一个还看得见的祖先项。
function syncMarker() {
  const ul = el.value
  const marker = ul?.closest('.VPDocAsideOutline')?.querySelector<HTMLElement>('.outline-marker')
  const active = ul?.querySelector<HTMLElement>('.outline-link.active')
  if (!marker || !active) return
  let target: HTMLElement | null = active
  while (target && target.offsetParent === null) {
    const li: HTMLElement | null | undefined = target.closest('li')?.parentElement?.closest('li')
    target = li ? li.querySelector<HTMLElement>(':scope > .outline-row > .outline-link') : null
  }
  if (!target) return
  const top = target.offsetTop + 39 + 'px'
  if (marker.style.top !== top) marker.style.top = top
}

function onActiveChange() {
  const active = el.value?.querySelector('.outline-link.active') ?? null
  if (active && active !== lastActive) {
    // 当前小节换了：把它的所有祖先展开
    for (let li = active.closest('li')?.parentElement?.closest('li'); li; li = li.parentElement?.closest('li')) {
      const link = li.querySelector(':scope > .outline-row > .outline-link')?.getAttribute('href')
      if (link) open.add(link)
    }
  }
  lastActive = active
  nextTick(syncMarker)
}

if (isTop) {
  const route = useRoute()
  watch(
    () => route.path,
    () => {
      open.clear()
      lastActive = null
    }
  )
  onMounted(() => {
    if (!el.value) return
    observer = new MutationObserver(onActiveChange)
    observer.observe(el.value, { subtree: true, attributes: true, attributeFilter: ['class'] })
  })
  onBeforeUnmount(() => observer?.disconnect())
}
</script>

<template>
  <ul ref="el" class="VPDocOutlineItem" :class="root ? 'root' : 'nested'">
    <li v-for="{ children, link, title } in headers" :key="link">
      <div class="outline-row">
        <button
          v-if="children?.length"
          class="caret"
          :class="{ open: open.has(link) }"
          type="button"
          :aria-expanded="open.has(link)"
          :aria-label="(open.has(link) ? '收起 ' : '展开 ') + title"
          @click="toggle(link)"
        >
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
            <path d="M5 3l6 5-6 5z" fill="currentColor" />
          </svg>
        </button>
        <span v-else class="caret-spacer" />
        <a class="outline-link" :href="link" @click="onClick($event, link, !!children?.length)" :title="title">{{ title }}</a>
      </div>
      <OutlineItem v-if="children?.length" v-show="open.has(link)" :headers="children" :depth="(depth ?? 0) + 1" />
    </li>
  </ul>
</template>

<style scoped>
.root {
  position: relative;
  z-index: 1;
}

.nested {
  padding-right: 0;
  padding-left: 12px;
}

.outline-row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.caret,
.caret-spacer {
  flex: none;
  width: 16px;
  height: 32px;
}

.caret {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-left: -4px;
  margin-right: 2px;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: color 0.25s;
}

.caret-spacer {
  margin-left: -4px;
  margin-right: 2px;
}

.caret svg {
  transition: transform 0.2s;
}

.caret.open svg {
  transform: rotate(90deg);
}

.caret:hover {
  color: var(--vp-c-text-1);
}

.caret:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
  border-radius: 4px;
}

.outline-link {
  display: block;
  flex: 1;
  min-width: 0;
  line-height: 32px;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.5s;
}

.outline-link:hover,
.outline-link.active {
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}
</style>
