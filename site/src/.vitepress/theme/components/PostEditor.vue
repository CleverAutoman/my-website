<script setup lang="ts">
// 本地写作编辑器：只在 dev 注册（theme/index.ts），页面在 /_dev/editor，接口在 .vitepress/editor.ts
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import MdEditor from './MdEditor.vue'

interface PostMeta { file: string; title: string; date?: string; draft: boolean }
interface Series { name: string; next: string }
interface Plan {
  branch: string
  identity: string | null
  identityHint: string
  sourceChanges: string[]
  sourceChangeCount: number
  docsChangeCount: number
  unpushed: number
}

const API = '/__editor/api/'
const LS_AUTOSAVE = 'editor:autosave'
const lsKey = (f: string) => `editor:buffer:${f}`

const posts = ref<PostMeta[]>([])
const series = ref<Series[]>([])
const file = ref('')
const content = ref('')
const saved = ref('')
const baseMtime = ref(0)
const status = ref('')
const statusErr = ref(false)
const saving = ref(false)
const sidebarStale = ref(false)
const autoSave = ref(false)
const previewNonce = ref(0)
const ed = ref<InstanceType<typeof MdEditor>>()

const dirty = computed(() => file.value !== '' && content.value !== saved.value)
const current = computed(() => posts.value.find((p) => p.file === file.value))
const previewUrl = computed(() =>
  file.value ? withBase('/' + file.value.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')) + `?_=${previewNonce.value}` : ''
)
const groups = computed(() => {
  const m = new Map<string, PostMeta[]>()
  for (const p of posts.value) {
    const dir = p.file.split('/').slice(0, -1).join('/')
    if (!m.has(dir)) m.set(dir, [])
    m.get(dir)!.push(p)
  }
  return [...m.entries()]
})
const stats = computed(() => {
  const body = content.value.replace(/^---[\s\S]*?\n---/, '')
  const cjk = (body.match(/[一-鿿]/g) ?? []).length
  const words = (body.replace(/[一-鿿]/g, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length
  return `${cjk + words} 字 · ${content.value.split('\n').length} 行`
})

function say(msg: string, err = false) {
  status.value = msg
  statusErr.value = err
}

async function api<T = any>(route: string, body?: unknown): Promise<T> {
  const r = await fetch(API + route, body === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-editor': '1' },
    body: JSON.stringify(body)
  })
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
  if (!r.ok) throw Object.assign(new Error(data.error ?? `HTTP ${r.status}`), { status: r.status })
  return data
}

async function loadList() {
  const d = await api<{ posts: PostMeta[]; series: Series[] }>('posts')
  posts.value = d.posts
  series.value = d.series
}

async function open(f: string) {
  if (dirty.value && !confirm(`${file.value} 有未保存的改动，确定切换？`)) return
  const d = await api<{ content: string; mtime: number }>(`post?file=${encodeURIComponent(f)}`)
  file.value = f
  saved.value = d.content
  baseMtime.value = d.mtime
  content.value = d.content
  sidebarStale.value = false
  // 服务器重启（新建文章、改标题后）会让页面整页刷新；这里把刷新前没保存的内容和光标找回来
  try {
    const b = JSON.parse(localStorage.getItem(lsKey(f)) ?? 'null')
    if (b && b.base === d.content && b.content !== d.content) {
      content.value = b.content
      say('已恢复上次未保存的内容')
    }
    if (b) nextTick(() => ed.value?.setCursor(b.sel ?? 0, b.scroll ?? 0))
  } catch {}
  const u = new URL(location.href)
  u.searchParams.set('file', f)
  history.replaceState(history.state, '', u)
  try { localStorage.setItem('editor:last', f) } catch {}
}

async function save({ manual = true, force = false } = {}) {
  if (!file.value || saving.value) return
  if (!dirty.value && !(manual && sidebarStale.value)) return
  saving.value = true
  const text = content.value
  try {
    // 自动保存不重启服务器（否则边打标题边整页刷新），侧边栏等手动保存时再更新
    const d = await api<{ mtime: number; restarting: boolean; sidebarChanged: boolean }>('save', {
      file: file.value, content: text, baseMtime: baseMtime.value, force,
      reload: manual, forceReload: manual && sidebarStale.value
    })
    saved.value = text
    baseMtime.value = d.mtime
    backup()
    const at = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    say(d.restarting ? '侧边栏更新中，页面会自动刷新…' : `${manual ? '保存' : '自动保存'}于 ${at}`)
    sidebarStale.value = !manual && (sidebarStale.value || d.sidebarChanged)
  } catch (e: any) {
    if (e.status === 409 && !force && confirm(`${e.message}。\n\n确定用编辑器里的内容覆盖吗？`)) {
      saving.value = false
      return save({ manual, force: true })
    }
    say(`保存失败：${e.message}`, true)
  } finally {
    saving.value = false
  }
}

function backup() {
  if (!file.value) return
  try {
    localStorage.setItem(lsKey(file.value), JSON.stringify({
      base: saved.value,
      content: content.value,
      ...(ed.value?.getCursor() ?? { sel: 0, scroll: 0 })
    }))
  } catch {}
}

/* ---------- 实时渲染：未保存的内容也能看，用站点同一套 markdown 配置在 dev server 上渲染 ---------- */
const LS_MODE = 'editor:preview'
const previewMode = ref<'live' | 'page'>('live')
const liveHtml = ref('')
const liveTitle = ref('')
const liveDesc = ref('')
const liveErr = ref('')
const liveEl = ref<HTMLDivElement>()
let renderTimer: ReturnType<typeof setTimeout> | undefined
let renderSeq = 0
async function renderLive() {
  if (!file.value || previewMode.value !== 'live') return
  const seq = ++renderSeq
  try {
    const d = await api<{ html: string; frontmatter: Record<string, any>; title: string }>('render', {
      file: file.value, content: content.value
    })
    if (seq !== renderSeq) return // 只保留最后一次请求的结果
    liveHtml.value = d.html
    liveTitle.value = d.frontmatter.title ?? ''
    liveDesc.value = d.frontmatter.description ?? ''
    liveErr.value = ''
  } catch (e: any) {
    if (seq === renderSeq) liveErr.value = e.message
  }
}
watch([content, file, previewMode], () => {
  clearTimeout(renderTimer)
  renderTimer = setTimeout(renderLive, liveHtml.value ? 200 : 0)
})
watch(previewMode, (v) => { try { localStorage.setItem(LS_MODE, v) } catch {} })

/** 编辑区滚动时，按比例同步渲染区 */
function onEditorScroll(ratio: number) {
  backup()
  const b = liveEl.value
  if (b) b.scrollTop = ratio * (b.scrollHeight - b.clientHeight)
}

/** 编辑区里图片缩略图的地址：/assets/... 加 base，相对路径按文章所在目录解析 */
function resolveImage(src: string): string | null {
  if (/^https?:\/\//.test(src)) return src
  if (src.startsWith('/')) return withBase(src)
  if (!file.value) return null
  const parts = file.value.split('/').slice(0, -1)
  for (const seg of src.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return withBase('/' + parts.join('/'))
}

let autoTimer: ReturnType<typeof setTimeout> | undefined
watch(content, () => {
  backup()
  clearTimeout(autoTimer)
  if (autoSave.value && dirty.value) autoTimer = setTimeout(() => save({ manual: false }), 1500)
})
watch(autoSave, (v) => { try { localStorage.setItem(LS_AUTOSAVE, v ? '1' : '0') } catch {} })

/* ---------- 粘贴 / 拖入图片：上传后在光标处插入引用 ---------- */
const insert = (text: string) => ed.value?.insert(text)

async function uploadImages(files: File[]) {
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
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
      const d = await api<{ url: string }>('upload', { file: file.value, name, data })
      insert(`![${name.replace(/\.[^.]+$/, '')}](${d.url})`)
      say(`已上传 ${d.url}`)
    } catch (e: any) {
      say(`上传失败：${e.message}`, true)
    }
  }
}
/* ---------- 新建文章 ---------- */
const showNew = ref(false)
const nf = ref({ series: '', num: '', slug: '', title: '', description: '' })
const nfError = ref('')
function openNew() {
  const s = series.value.find((x) => x.name === 'ai-infra') ?? series.value[0]
  nf.value = { series: s?.name ?? '', num: s?.next ?? '', slug: '', title: '', description: '' }
  nfError.value = ''
  showNew.value = true
}
watch(() => nf.value.series, (name) => {
  nf.value.num = series.value.find((x) => x.name === name)?.next ?? ''
})
const nfFile = computed(() => {
  const slug = [nf.value.num, nf.value.slug].filter(Boolean).join('-')
  return slug ? `blog/${nf.value.series}/${slug}.md` : ''
})
async function createPost() {
  nfError.value = ''
  try {
    const slug = [nf.value.num, nf.value.slug.trim()].filter(Boolean).join('-')
    const d = await api<{ file: string }>('new', { ...nf.value, slug })
    showNew.value = false
    if (dirty.value) await save()
    // 服务器马上会重启并刷新这个页面，先把要打开的文件写进地址栏
    const u = new URL(location.href)
    u.searchParams.set('file', d.file)
    history.replaceState(history.state, '', u)
    say('已创建，服务器重启中…')
    await loadList()
    saved.value = content.value // 避免切换时提示未保存
    await open(d.file)
  } catch (e: any) {
    nfError.value = e.message
  }
}

/* ---------- 发布 ---------- */
const showPub = ref(false)
const plan = ref<Plan | null>(null)
const pubMsg = ref('')
const pubLog = ref('')
const pubState = ref<'idle' | 'running' | 'ok' | 'fail'>('idle')
const logEl = ref<HTMLPreElement>()
async function openPublish() {
  if (dirty.value) await save()
  showPub.value = true
  plan.value = null
  pubLog.value = ''
  pubState.value = 'idle'
  pubMsg.value = current.value ? `blog: ${current.value.title}` : 'blog: update'
  try {
    plan.value = await api<Plan>('publish')
  } catch (e: any) {
    pubLog.value = `检查失败：${e.message}`
  }
}
async function runPublish() {
  pubState.value = 'running'
  pubLog.value = ''
  try {
    const r = await fetch(API + 'publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-editor': '1' },
      body: JSON.stringify({ message: pubMsg.value })
    })
    if (!r.ok || !r.body) {
      const d = await r.json().catch(() => ({}))
      throw new Error(d.error ?? `HTTP ${r.status}`)
    }
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      pubLog.value += dec.decode(value, { stream: true })
      nextTick(() => logEl.value && (logEl.value.scrollTop = logEl.value.scrollHeight))
    }
    const m = pubLog.value.match(/__RESULT__ (ok|fail)\s*$/)
    pubLog.value = pubLog.value.replace(/\n?__RESULT__ \w+\s*$/, '')
    pubState.value = m?.[1] === 'ok' ? 'ok' : 'fail'
  } catch (e: any) {
    pubLog.value += `\n${e.message}`
    pubState.value = 'fail'
  }
}

function onBeforeUnload(ev: BeforeUnloadEvent) {
  if (dirty.value) ev.preventDefault()
}

onMounted(async () => {
  try { autoSave.value = localStorage.getItem(LS_AUTOSAVE) === '1' } catch {}
  try { if (localStorage.getItem(LS_MODE) === 'page') previewMode.value = 'page' } catch {}
  window.addEventListener('beforeunload', onBeforeUnload)
  try {
    await loadList()
    let last = ''
    try { last = localStorage.getItem('editor:last') ?? '' } catch {}
    const want = new URL(location.href).searchParams.get('file') || last
    const f = posts.value.find((p) => p.file === want)?.file ?? posts.value.find((p) => p.file.startsWith('blog/ai-infra/0'))?.file
    if (f) await open(f)
  } catch (e: any) {
    say(`接口不可用：${e.message}（编辑器只在 npm run dev 下可用）`, true)
  }
})
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <div class="vp-raw editor" data-decode-skip>
    <header class="bar">
      <select class="file" :value="file" @change="open(($event.target as HTMLSelectElement).value)">
        <option v-if="!file" value="" disabled>选择文章…</option>
        <optgroup v-for="[dir, list] in groups" :key="dir" :label="dir + '/'">
          <option v-for="p in list" :key="p.file" :value="p.file">
            {{ p.file.split('/').pop() }} — {{ p.title }}{{ p.draft ? '（草稿）' : '' }}
          </option>
        </optgroup>
      </select>
      <button class="btn" @click="openNew">＋ 新文章</button>
      <span class="spacer" />
      <span class="state" :class="{ dirty, err: statusErr }">
        <template v-if="dirty">● 未保存</template>
        <template v-else-if="file">已保存</template>
        <span v-if="status" class="msg"> · {{ status }}</span>
        <span v-if="sidebarStale" class="msg"> · 标题 / 草稿状态改了，按 Ctrl+S 更新侧边栏</span>
      </span>
      <label class="auto"><input v-model="autoSave" type="checkbox" /> 自动保存</label>
      <button class="btn" :disabled="!file || saving" @click="save()">保存 <kbd>Ctrl S</kbd></button>
      <button class="btn brand" :disabled="!file" @click="openPublish">发布…</button>
    </header>

    <div class="panes">
      <section class="pane src">
        <MdEditor
          ref="ed"
          v-model="content"
          :doc-key="file"
          :disabled="!file"
          :resolve-image="resolveImage"
          placeholder="Markdown…  粘贴或拖入图片会自动上传到 public/assets/blog/"
          @save="save()"
          @images="uploadImages"
          @scroll="onEditorScroll"
          @caret="backup"
        />
        <footer class="foot">
          <span>{{ file || '—' }}</span>
          <span>{{ stats }}</span>
          <span class="hint">Ctrl B 粗体 · Ctrl I 斜体 · Ctrl E 行内代码 · Ctrl F 查找 · 粘贴图片上传 · frontmatter 写 draft: true 不发布</span>
        </footer>
      </section>
      <section class="pane preview">
        <div class="ptitle">
          <span class="seg">
            <button :class="{ on: previewMode === 'live' }" @click="previewMode = 'live'">实时渲染</button>
            <button :class="{ on: previewMode === 'page' }" @click="previewMode = 'page'">页面预览</button>
          </span>
          <span class="phint">{{ previewMode === 'live' ? '边写边渲染，组件显示为占位' : '真实页面，保存后更新' }}</span>
          <span class="spacer" />
          <span v-if="previewMode === 'live' && liveErr" class="perr">渲染失败：{{ liveErr }}</span>
          <a v-if="file" :href="previewUrl" target="_blank" rel="noreferrer">新标签打开 ↗</a>
          <button v-if="previewMode === 'page'" class="link" @click="previewNonce++">刷新</button>
        </div>
        <div v-if="previewMode === 'live'" ref="liveEl" class="live" data-decode-skip>
          <div class="live-inner">
            <div v-if="liveTitle || liveDesc" class="live-meta">
              <span>title</span><b>{{ liveTitle || '—' }}</b>
              <span>description</span><em>{{ liveDesc || '—' }}</em>
            </div>
            <div class="vp-doc" v-html="liveHtml" />
          </div>
        </div>
        <iframe v-else-if="file" :key="previewNonce" :src="previewUrl" title="预览" />
      </section>
    </div>

    <!-- 新建文章 -->
    <div v-if="showNew" class="modal" @click.self="showNew = false">
      <form class="dialog" @submit.prevent="createPost">
        <h3>新文章</h3>
        <label>系列目录
          <select v-model="nf.series">
            <option v-for="s in series" :key="s.name" :value="s.name">blog/{{ s.name }}/</option>
          </select>
        </label>
        <label>文件名
          <span class="row">
            <input v-model="nf.num" class="num" placeholder="01" />
            <span>-</span>
            <input v-model="nf.slug" placeholder="architecture-overview" required pattern="[a-z0-9][a-z0-9\-]*" />
          </span>
          <small>小写字母、数字和 -，会成为网址：{{ nfFile || '…' }}</small>
        </label>
        <label>标题 <input v-model="nf.title" required placeholder="架构总览：一个请求经过哪些进程" /></label>
        <label>一句话简介 <input v-model="nf.description" placeholder="用于列表、分享卡片和 RSS" /></label>
        <p class="note">从 templates/post.md 生成，默认带 <code>draft: true</code>：本地能看，发布时不上线。写完删掉这一行再发布。</p>
        <p v-if="nfError" class="error">{{ nfError }}</p>
        <div class="actions">
          <button type="button" class="btn" @click="showNew = false">取消</button>
          <button type="submit" class="btn brand">创建</button>
        </div>
      </form>
    </div>

    <!-- 发布 -->
    <div v-if="showPub" class="modal" @click.self="pubState !== 'running' && (showPub = false)">
      <div class="dialog wide">
        <h3>发布到 GitHub Pages</h3>
        <p class="note">
          会依次执行：<code>vitepress build</code> → <code>git add/commit -- site/src docs</code> → <code>git push origin HEAD</code>。
          只提交 <code>site/src</code> 和 <code>docs</code>，其他目录的改动不受影响。草稿（draft: true）不构建、源文件和图片也不提交，只留在本地。
        </p>
        <template v-if="plan">
          <ul class="checks">
            <li :class="{ bad: plan.branch !== 'main' }">
              分支：<code>{{ plan.branch }}</code>
              <template v-if="plan.branch !== 'main'">（Pages 从 main 发布，推到这个分支不会更新线上）</template>
            </li>
            <li :class="{ bad: !plan.identity }">
              提交身份：<template v-if="plan.identity">{{ plan.identity }}</template>
              <template v-else>{{ plan.identityHint }}</template>
            </li>
            <li>
              源码改动 {{ plan.sourceChangeCount }} 项，docs/ 现有改动 {{ plan.docsChangeCount }} 项（构建后会重新生成）
              <template v-if="plan.unpushed">，另有 {{ plan.unpushed }} 个本地 commit 未推送，会一起推上去</template>
            </li>
          </ul>
          <details v-if="plan.sourceChanges.length" class="changes">
            <summary>查看源码改动</summary>
            <pre>{{ plan.sourceChanges.join('\n') }}</pre>
          </details>
          <label>Commit message <input v-model="pubMsg" :disabled="pubState === 'running'" /></label>
        </template>
        <pre v-if="pubLog" ref="logEl" class="log">{{ pubLog }}</pre>
        <p v-if="pubState === 'ok'" class="ok">发布完成，线上 1～2 分钟后更新。</p>
        <p v-if="pubState === 'fail'" class="error">发布失败，看上面的日志。已经成功的步骤（比如 commit）不会回滚。</p>
        <div class="actions">
          <button class="btn" :disabled="pubState === 'running'" @click="showPub = false">{{ pubState === 'ok' ? '关闭' : '取消' }}</button>
          <button
            v-if="pubState !== 'ok'"
            class="btn brand"
            :disabled="!plan || !plan.identity || !pubMsg.trim() || pubState === 'running'"
            @click="runPublish"
          >
            {{ pubState === 'running' ? '发布中…' : pubState === 'fail' ? '重试' : '构建并推送' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  position: fixed;
  inset: var(--vp-nav-height) 0 0 0;
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
  z-index: 10;
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--x-border);
  background: var(--x-panel);
}
.spacer { flex: 1; }
.file {
  max-width: min(460px, 100%);
  padding: 5px 8px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: inherit;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}
.btn {
  padding: 5px 12px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover:not(:disabled) { border-color: var(--vp-c-brand-1); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.brand {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: var(--x-on-brand);
  font-weight: 600;
}
.btn.brand:hover:not(:disabled) { background: var(--vp-c-brand-2); }
kbd {
  margin-left: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  opacity: 0.6;
}
.state { font-size: 12.5px; color: var(--vp-c-text-2); font-family: var(--vp-font-family-mono); }
.state.dirty { color: var(--vp-c-brand-1); }
.state.err .msg { color: var(--x-err); }
.auto { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: var(--vp-c-text-2); cursor: pointer; }

.panes {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 0;
}
.pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.src { border-right: 1px solid var(--x-border); }
.foot, .ptitle {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 5px 12px;
  border-top: 1px solid var(--x-border);
  background: var(--x-panel);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
}
.foot .hint { margin-left: auto; overflow: hidden; text-overflow: ellipsis; color: var(--vp-c-text-3); }
.ptitle { border-top: 0; border-bottom: 1px solid var(--x-border); }
.ptitle a, .link {
  color: var(--vp-c-brand-1);
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-decoration: none;
}
iframe { flex: 1; width: 100%; border: 0; background: var(--vp-c-bg); }

.seg { display: inline-flex; border: 1px solid var(--x-border); border-radius: 6px; overflow: hidden; }
.seg button {
  padding: 2px 10px;
  border: 0;
  background: transparent;
  color: var(--vp-c-text-2);
  font: inherit;
  cursor: pointer;
}
.seg button.on { background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); }
.phint { color: var(--vp-c-text-3); overflow: hidden; text-overflow: ellipsis; }
.perr { color: var(--x-err); overflow: hidden; text-overflow: ellipsis; }

.live { flex: 1; overflow: auto; background: var(--vp-c-bg); }
.live-inner { max-width: 760px; margin: 0 auto; padding: 24px 28px 80px; }
.live-meta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin-bottom: 20px;
  padding: 10px 14px;
  border: 1px dashed var(--x-border);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--vp-c-text-2);
}
.live-meta span { font-family: var(--vp-font-family-mono); color: var(--vp-c-text-3); }
.live-meta b { font-weight: 600; color: var(--vp-c-text-1); }
.live :deep(.md-comp) {
  margin: 16px 0;
  padding: 10px 14px;
  border: 1px dashed var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--x-panel);
}
.live :deep(.md-comp-name) { font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--vp-c-brand-1); }
.live :deep(.md-env) { display: table; width: 100%; margin: 8px 0 0; font-size: 13px; }
.live :deep(.md-env th) { width: 110px; text-align: left; font-family: var(--vp-font-family-mono); }

.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
}
.dialog {
  display: grid;
  gap: 12px;
  width: min(520px, 100%);
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 20px 22px;
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
  box-shadow: 0 20px 60px var(--x-shadow);
}
.dialog.wide { width: min(760px, 100%); }
.dialog h3 { margin: 0; font-size: 17px; }
.dialog label { display: grid; gap: 4px; font-size: 13px; color: var(--vp-c-text-2); }
.dialog input, .dialog select {
  padding: 6px 9px;
  border: 1px solid var(--x-border);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
}
.dialog input:focus, .dialog select:focus { outline: none; border-color: var(--vp-c-brand-1); }
.row { display: flex; align-items: center; gap: 6px; }
.row input:last-child { flex: 1; }
.num { width: 56px; font-family: var(--vp-font-family-mono); }
small { color: var(--vp-c-text-3); font-family: var(--vp-font-family-mono); font-size: 11.5px; }
.note { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--vp-c-text-2); }
code { font-family: var(--vp-font-family-mono); font-size: 0.92em; color: var(--vp-c-brand-1); }
.checks { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.8; }
.checks .bad { color: var(--x-err); }
.changes summary { cursor: pointer; font-size: 13px; color: var(--vp-c-text-2); }
.changes pre, .log {
  margin: 6px 0 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--x-border);
  border-radius: 8px;
  background: var(--vp-c-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}
.log { max-height: 320px; }
.error { margin: 0; color: var(--x-err); font-size: 13px; }
.ok { margin: 0; color: var(--vp-c-brand-1); font-size: 13px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 860px) {
  .panes { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  .src { border-right: 0; border-bottom: 1px solid var(--x-border); }
  .foot .hint { display: none; }
}
</style>
