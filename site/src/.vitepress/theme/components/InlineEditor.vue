<script setup lang="ts">
// 文章页里的原地编辑（只在本地 dev，由 EditEntry 按需加载）：
// 正文换成同样排版的所见即所得编辑区——Markdown 标记只在光标所在行显示，表格、图表、环境卡片直接画出来；
// 停顿 1 秒自动保存，dev server 热更新背后的页面；点「完成」回到页面。接口和完整编辑器（/_dev/editor）共用 .vitepress/editor.ts。
import { computed, getCurrentInstance, h, nextTick, onBeforeUnmount, onMounted, ref, render, watch, type VNode } from 'vue'
import { withBase } from 'vitepress'
import MdEditor from './MdEditor.vue'
import BenchChart from './BenchChart.vue'
import EnvCard from './EnvCard.vue'

const props = defineProps<{
  file: string
  /** 进入编辑时视口顶部附近的标题：编辑区打开后滚到同一处 */
  start?: { text: string; top: number }
}>()
const emit = defineEmits<{ close: [heading: string | null] }>()

const API = '/__editor/api/'
async function api<T = any>(route: string, body?: unknown): Promise<T> {
  const r = await fetch(
    API + route,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json', 'x-editor': '1' }, body: JSON.stringify(body) }
  )
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status })
  return data
}

const ed = ref<InstanceType<typeof MdEditor>>()
const loaded = ref(false)
const content = ref('')
const saved = ref('')
const mtime = ref(0)
const saving = ref(false)
const status = ref('')
const statusErr = ref(false)
/** 自动保存不重启 dev server；期间标题 / 草稿状态变了，等「完成」时再让侧边栏更新 */
const sidebarStale = ref(false)
const dirty = computed(() => content.value !== saved.value)

function say(msg: string, err = false) {
  status.value = msg
  statusErr.value = err
}

/* ---------- 标题文字 ↔ 源码位置 ---------- */
const norm = (s: string) =>
  s
    .replace(/​/g, '')
    .replace(/\{#[^}]*\}/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, '')
const HEAD_RE = /^(#{1,6})\s+(.*?)\s*$/

function headingPos(text: string): number | null {
  const want = norm(text)
  let pos = 0
  for (const l of content.value.split('\n')) {
    const m = l.match(HEAD_RE)
    if (m && norm(m[2]) === want) return pos
    pos += l.length + 1
  }
  return null
}
/** 光标所在位置往上最近的一个标题 */
function headingBefore(pos: number): string | null {
  let at = 0
  let last: string | null = null
  for (const l of content.value.split('\n')) {
    if (at > pos) break
    const m = l.match(HEAD_RE)
    if (m) last = m[2]
    at += l.length + 1
  }
  return last
}

/* ---------- 读取 / 保存 ---------- */
async function load() {
  try {
    const d = await api<{ content: string; mtime: number }>(`post?file=${encodeURIComponent(props.file)}`)
    content.value = saved.value = d.content
    mtime.value = d.mtime
    loaded.value = true
    say('编辑中 · 停顿 1 秒自动保存')
    await nextTick()
    const found = props.start ? headingPos(props.start.text) : null
    // 第一个标题之前是 frontmatter / script，光标默认放到第一个标题上
    const pos = found ?? headingPos(content.value.match(/^#{1,6}\s+(.*)$/m)?.[1] ?? '') ?? 0
    alignTo(pos, found != null ? props.start!.top : 120)
  } catch (e: any) {
    say(`读取失败：${e.message}`, true)
  }
}

/**
 * 把 pos 那一行放到离视口顶 top 的位置。编辑区刚出现时，上面还没画出来的行只是估算高度，
 * 画出来（表格、图表）之后位置会漂，所以头一秒多对齐几次；用户一滚动 / 打字就停。
 */
function alignTo(pos: number, top: number) {
  let stopped = false
  const stop = () => (stopped = true)
  const evs = ['wheel', 'keydown', 'mousedown', 'touchstart'] as const
  for (const e of evs) window.addEventListener(e, stop, { once: true, capture: true })
  const run = () => !stopped && ed.value?.reveal(pos, top)
  run()
  for (const ms of [50, 150, 350, 700, 1200]) setTimeout(run, ms)
  setTimeout(() => evs.forEach((e) => window.removeEventListener(e, stop, { capture: true })), 1300)
}

async function save({ manual = false, force = false } = {}): Promise<boolean> {
  if (!loaded.value || saving.value) return false
  if (!dirty.value && !(manual && sidebarStale.value)) return true
  saving.value = true
  const text = content.value
  try {
    const d = await api<{ mtime: number; restarting: boolean; sidebarChanged: boolean }>('save', {
      file: props.file,
      content: text,
      baseMtime: mtime.value,
      force,
      reload: manual,
      forceReload: manual && sidebarStale.value
    })
    saved.value = text
    mtime.value = d.mtime
    sidebarStale.value = !manual && (sidebarStale.value || d.sidebarChanged)
    const at = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    say(d.restarting ? '侧边栏更新中，页面会自动刷新…' : `已保存 ${at}`)
    return true
  } catch (e: any) {
    if (e.status === 409 && !force && confirm(`${e.message}。\n\n确定用这里的内容覆盖吗？`)) {
      saving.value = false
      return save({ manual, force: true })
    }
    say(`保存失败：${e.message}`, true)
    return false
  } finally {
    saving.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(content, () => {
  if (!loaded.value) return
  clearTimeout(timer)
  if (dirty.value) {
    say('未保存')
    timer = setTimeout(() => save(), 1000)
  }
})

async function done() {
  clearTimeout(timer)
  if (!(await save({ manual: true }))) return
  emit('close', headingBefore(ed.value?.getCursor().sel ?? 0))
}

/* ---------- 图片：地址解析、粘贴上传 ---------- */
function resolvePath(src: string) {
  const parts = props.file.split('/').slice(0, -1)
  for (const seg of src.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return '/' + parts.join('/')
}
function resolveImage(src: string): string | null {
  if (/^https?:\/\//.test(src)) return src
  return withBase(src.startsWith('/') ? src : resolvePath(src))
}
async function uploadImages(files: File[]) {
  for (const f of files) {
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')
    const name = /\.[a-z0-9]+$/i.test(f.name) && f.name !== 'image.png' ? f.name : `paste-${Date.now()}.${ext}`
    say(`上传 ${name}…`)
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result).split(',')[1] ?? '')
      r.onerror = () => rej(r.error)
      r.readAsDataURL(f)
    })
    try {
      const d = await api<{ url: string }>('upload', { file: props.file, name, data })
      ed.value?.insert(`![${name.replace(/\.[^.]+$/, '')}](${d.url})`)
    } catch (e: any) {
      say(`上传失败：${e.message}`, true)
    }
  }
}

/* ---------- 正文里的组件：BenchChart、EnvCard 直接画出来 ---------- */
// 挂在站点同一个 app 上下文里（EnvCard 要用 useData）
const appContext = getCurrentInstance()!.appContext
function mountVNode(el: HTMLElement, vnode: VNode) {
  vnode.appContext = appContext
  el.textContent = ''
  render(vnode, el)
}
const jsonCache = new Map<string, Promise<any>>()
const fetchJson = (url: string) => {
  if (!jsonCache.has(url)) jsonCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))))
  return jsonCache.get(url)!
}
/** frontmatter 里 env: 下面一层的 key: value（EnvCard 用） */
function parseEnv(doc: string) {
  const fm = doc.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  const env: Record<string, string> = {}
  let inEnv = false
  for (const l of fm.split(/\r?\n/)) {
    if (/^env:\s*$/.test(l)) inEnv = true
    else if (inEnv && /^\s+\S/.test(l)) {
      const m = l.match(/^\s+([\w-]+):\s*(.*)$/)
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
    } else if (inEnv) inEnv = false
  }
  return env
}
function mountComponent(tag: string, attrs: Record<string, string>, el: HTMLElement, doc: string) {
  if (tag === 'EnvCard') {
    mountVNode(el, h(EnvCard, { env: parseEnv(doc) }))
    return () => render(null, el)
  }
  if (tag === 'BenchChart') {
    const name = attrs[':data']
    const src = name && doc.match(new RegExp(`import\\s+${name}\\s+from\\s+['"]([^'"]+\\.json)['"]`))?.[1]
    if (!src) return null
    const height = Number(attrs[':height'] ?? attrs.height) || undefined
    let alive = true
    el.textContent = '加载图表…'
    // 先占住图表的高度（标题、图例 + 画布），加载完不再把下面的内容往下推
    el.style.minHeight = `${(height ?? 300) + 130}px`
    fetchJson(withBase(resolvePath(src)))
      .then((data) => alive && mountVNode(el, h(BenchChart, { data, height })))
      .catch((e) => alive && (el.textContent = `图表数据读取失败：${src}（${e.message}）`))
    return () => {
      alive = false
      render(null, el)
    }
  }
  return null
}

/* ---------- 进入 / 离开：页面正文藏起来，编辑区占它的位置 ---------- */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => {
  document.documentElement.classList.add('inline-editing')
  window.addEventListener('beforeunload', onBeforeUnload)
  load()
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('inline-editing')
  window.removeEventListener('beforeunload', onBeforeUnload)
  clearTimeout(timer)
  // 被路由切换之类的卸载时，没保存的改动顺手存掉
  if (dirty.value) save()
})
</script>

<template>
  <div class="inline-editor">
    <div class="ie-bar">
      <span class="ie-dot" :class="{ dirty, err: statusErr }" />
      <span class="ie-status" :class="{ err: statusErr }">{{ status || '读取中…' }}</span>
      <span class="ie-tip">Markdown 标记只在光标所在行显示 · Ctrl+S 保存</span>
      <a class="ie-btn ghost" :href="withBase(`/_dev/editor?file=${encodeURIComponent(file)}`)" title="左右对照的完整编辑器（新建、移动、发布）">完整编辑器</a>
      <button class="ie-btn primary" type="button" :disabled="saving" @click="done">完成</button>
    </div>
    <MdEditor
      v-if="loaded"
      ref="ed"
      v-model="content"
      :doc-key="file"
      inline
      live
      blocks
      :mount-component="mountComponent"
      :resolve-image="resolveImage"
      @save="save({ manual: true })"
      @images="uploadImages"
    />
  </div>
</template>

<style scoped>
.inline-editor {
  position: relative;
}

.ie-bar {
  position: sticky;
  top: calc(var(--vp-nav-height) + 8px);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 -12px 24px;
  padding: 6px 8px 6px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vp-c-bg) 88%, transparent);
  backdrop-filter: blur(8px);
  font-size: 13px;
  line-height: 20px;
}

.ie-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vp-c-green-2, #3dd68c);
}
.ie-dot.dirty {
  background: var(--vp-c-yellow-2, #e2c08d);
}
.ie-dot.err {
  background: var(--vp-c-danger-1);
}

.ie-status {
  color: var(--vp-c-text-1);
  white-space: nowrap;
}
.ie-status.err {
  color: var(--vp-c-danger-1);
}

.ie-tip {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vp-c-text-3);
}

.ie-btn {
  flex: none;
  padding: 3px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background-color 0.2s;
}
.ie-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
.ie-btn.primary {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
}
.ie-btn.primary:hover {
  background: var(--vp-c-brand-2);
  color: var(--vp-c-white);
}
.ie-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.ie-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>

<style>
/* 编辑时页面正文藏起来（编辑区在 doc-before 插槽里，不在 main 里） */
html.inline-editing .VPDoc main.main > .vp-doc {
  display: none;
}
</style>
