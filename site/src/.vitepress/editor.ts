import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import { createMarkdownRenderer, type MarkdownRenderer, type SiteConfig } from 'vitepress'
import { srcDir, draftFiles, listPosts, listSeries, readPost } from './posts'

/**
 * 本地写作接口：只在 `npm run dev` 时挂到 dev server 上，build 产物里没有。
 * 编辑页在 /my-website/_dev/editor，所有接口在 /__editor/api/ 下：
 *   GET  posts    文章列表 + 系列目录
 *   GET  post     读一篇（?file=blog/xx.md）
 *   POST save     保存 { file, content, create? }
 *   POST new      按模板新建 { series, slug, title, description }
 *   POST render   用站点同一套 markdown 配置渲染未保存的内容 { file, content } → { html, frontmatter }
 *   POST upload   上传图片 { file, name, data(base64) } → public/assets/blog/<slug>/
 *   GET  publish  发布前检查：分支、提交身份、待提交改动
 *   POST publish  build → git add/commit（只含 site/src 和 docs）→ git push，日志流式返回
 */

const siteDir = path.resolve(srcDir, '..')
const repoDir = path.resolve(siteDir, '..')
const configFile = path.join(srcDir, '.vitepress', 'config.mts')
const templateFile = path.join(siteDir, 'templates', 'post.md')
const PUBLISH_PATHS = ['site/src', 'docs']
const API = '/__editor/api/'

const POST_RE = /^blog\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function checkPost(file: unknown): string {
  if (typeof file !== 'string' || !POST_RE.test(file) || file.split('/').includes('..'))
    throw new HttpError(400, `非法路径：${String(file)}（只能是 blog/ 下的 .md）`)
  return file
}

function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new HttpError(413, '请求体太大'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new HttpError(400, 'JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/** 跑一个命令，输出逐行写给 onData，返回退出码 */
function run(cmd: string, args: string[], cwd: string, onData?: (s: string) => void): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0' }, windowsHide: true })
    let out = ''
    const take = (b: Buffer) => {
      const s = b.toString('utf8')
      out += s
      onData?.(s)
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    p.on('error', (e) => {
      onData?.(String(e) + '\n')
      resolve({ code: -1, out: out + String(e) })
    })
    p.on('close', (code) => resolve({ code: code ?? -1, out }))
  })
}
const git = (args: string[], onData?: (s: string) => void) => run('git', args, repoDir, onData)

/** 侧边栏在 config 加载时生成；新文章、改标题或草稿状态后重写一下 config，触发 VitePress 重启 */
function reloadSidebar() {
  fs.writeFileSync(configFile, fs.readFileSync(configFile))
}

function newPostContent(series: string, slug: string, title: string, description: string) {
  const today = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD，本地时区
  const num = slug.match(/^(\d+)-/)?.[1]
  const tpl = fs.readFileSync(templateFile, 'utf8')
  return tpl
    .replace(/^title: .*$/m, `title: ${title}`)
    .replace(/^description: .*$/m, `description: ${description || '一句话说明这篇解决什么问题'}`)
    .replace(/^date: .*$/m, `date: ${today}\ndraft: true`)
    .replace(/^  date: .*$/m, `  date: ${today}`)
    .replace(/<!--\s*\n使用方法[\s\S]*?-->\n\n/, '')
    .replace(/^# 文章标题$/m, `# ${title}`)
    .replace('// ai infra · 第 N 篇', series === 'ai-infra' && num ? `// ai infra · 第 ${Number(num)} 篇` : `// ${series}`)
}

async function publishPlan() {
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
  const ident = await git(['var', 'GIT_AUTHOR_IDENT'])
  const name = ident.out.match(/^(.*?) </)?.[1] ?? ''
  const email = ident.out.match(/<(.*?)>/)?.[1] ?? ''
  const identityOk = ident.code === 0 && !!email && !/your name/i.test(name)
  const status = (await git(['status', '--porcelain', '--', ...PUBLISH_PATHS])).out.split('\n').filter(Boolean)
  // porcelain 行是「XY 路径」或「XY 原路径 -> 新路径」，按新路径分到 docs/ 或源码
  const isDocs = (l: string) => l.slice(3).split(' -> ').pop()!.replace(/^"/, '').startsWith('docs/')
  const src = status.filter((l) => !isDocs(l))
  const ahead = await git(['rev-list', '--count', '@{u}..HEAD'])
  return {
    branch,
    identity: identityOk ? name : null,
    identityHint: identityOk
      ? ''
      : `git 提交身份没配好（当前 name="${name || '空'}"，email ${email ? '已设置' : '为空'}）。先在终端运行：git config --global user.name "你的名字"，git config --global user.email "你的邮箱"`,
    sourceChanges: src.slice(0, 200),
    sourceChangeCount: src.length,
    docsChangeCount: status.length - src.length,
    unpushed: ahead.code === 0 ? Number(ahead.out.trim()) : 0
  }
}

let publishing = false

/* ---------- 实时渲染：和站点同一套 markdown-it 配置（容器、代码高亮、行号、锚点） ---------- */
let mdPromise: Promise<MarkdownRenderer> | undefined
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function envCardHtml(env: unknown) {
  if (!env || typeof env !== 'object') return ''
  const rows = Object.entries(env as Record<string, unknown>)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => {
      const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
      return `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(s)}</td></tr>`
    })
  return rows.length ? `<table class="md-env">${rows.join('')}</table>` : ''
}

async function renderMarkdown(server: ViteDevServer, file: string, content: string) {
  const sc = (server.config as unknown as { vitepress: SiteConfig }).vitepress
  mdPromise ??= createMarkdownRenderer(sc.srcDir, sc.markdown, sc.site.base, sc.logger)
  const md = await mdPromise
  // frontmatter、<script setup> 由 mdit-vue 插件从 env 里取走，不会出现在 html 里
  const env: Record<string, any> = { path: path.join(srcDir, file), relativePath: file, cleanUrls: sc.cleanUrls }
  let html = md.render(content, env)
  const frontmatter = env.frontmatter ?? {}
  // Vue 组件在这里没法真正挂载：EnvCard 用 frontmatter.env 画一张表，其他组件显示成占位块
  html = html
    .replace(/<\/([A-Z][A-Za-z0-9]*)>/g, '')
    .replace(/<([A-Z][A-Za-z0-9]*)\b([^>]*?)\/?>/g, (_, name: string, attrs: string) => {
      const inner = name === 'EnvCard' ? envCardHtml(frontmatter.env) : ''
      return `<div class="md-comp"><span class="md-comp-name">&lt;${name}${escapeHtml(attrs.replace(/\s+/g, ' ').trimEnd())} /&gt;</span>${inner}</div>`
    })
    // public/ 下的绝对路径要加上 base 才能在 dev server 上取到
    .replace(/(<img\b[^>]*?\ssrc=")\/(?!\/)/g, `$1${sc.site.base}`)
  return { html, frontmatter, title: env.title ?? '' }
}


async function publish(message: string, res: ServerResponse) {
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff'
  })
  const log = (s: string) => res.write(s)
  const step = (s: string) => log(`\n$ ${s}\n`)
  const done = (ok: boolean) => {
    log(`\n__RESULT__ ${ok ? 'ok' : 'fail'}\n`)
    res.end()
  }

  const vitepressBin = path.join(
    path.dirname(createRequire(import.meta.url).resolve('vitepress/package.json')),
    'bin',
    'vitepress.js'
  )
  step('vitepress build src')
  const build = await run(process.execPath, [vitepressBin, 'build', 'src'], siteDir, log)
  if (build.code !== 0) return done(false)

  step(`git add -A -- ${PUBLISH_PATHS.join(' ')}`)
  if ((await git(['add', '-A', '--', ...PUBLISH_PATHS], log)).code !== 0) return done(false)

  // 仓库是公开的：草稿的 .md 和它的图片目录也不提交，只留在本地
  const draftPaths = draftFiles()
    .flatMap((f) => [`site/src/${f}`, `site/src/public/assets/blog/${path.basename(f, '.md')}`])
    .filter((p) => fs.existsSync(path.join(repoDir, p)))
  if (draftPaths.length) {
    step(`git reset -- ${draftPaths.join(' ')}   # 草稿不提交`)
    if ((await git(['reset', '-q', '--', ...draftPaths], log)).code !== 0) return done(false)
  }

  const staged = await git(['diff', '--cached', '--quiet', '--', ...PUBLISH_PATHS])
  if (staged.code === 0) {
    log('没有需要提交的改动，跳过 commit\n')
  } else {
    step(`git commit -m "${message}" -- ${PUBLISH_PATHS.join(' ')}`)
    // 带路径的 commit 只提交这两个目录，暂存区里别的改动（比如 README）不会被带上
    if ((await git(['commit', '-m', message, '--', ...PUBLISH_PATHS], log)).code !== 0) return done(false)
  }

  step('git push origin HEAD')
  const push = await git(['push', 'origin', 'HEAD'], log)
  if (push.code !== 0) return done(false)
  log('\n已推送。GitHub Pages 一般 1～2 分钟后更新：https://cleverautoman.github.io/my-website/\n')
  done(true)
}

async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, 'http://localhost')
  const route = url.pathname.slice(API.length)
  const method = req.method ?? 'GET'

  // 只接受同源请求：别的网页（包括其他端口的 localhost 页面）不能借浏览器调这些接口
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'cross-origin request rejected')
  if (method !== 'GET' && req.headers['x-editor'] !== '1') throw new HttpError(403, 'missing x-editor header')

  if (method === 'GET' && route === 'posts') {
    const posts = listPosts()
    const series = listSeries().map((name) => {
      const nums = posts
        .filter((p) => p.file.startsWith(`blog/${name}/`))
        .map((p) => Number(path.basename(p.file).match(/^(\d+)-/)?.[1] ?? -1))
      return { name, next: String(Math.max(-1, ...nums) + 1).padStart(2, '0') }
    })
    return sendJson(res, 200, { posts, series })
  }

  if (method === 'GET' && route === 'post') {
    const file = checkPost(url.searchParams.get('file'))
    const abs = path.join(srcDir, file)
    if (!fs.existsSync(abs)) throw new HttpError(404, `${file} 不存在`)
    return sendJson(res, 200, { file, content: fs.readFileSync(abs, 'utf8'), mtime: fs.statSync(abs).mtimeMs })
  }

  if (method === 'POST' && route === 'save') {
    const body = await readBody(req)
    const file = checkPost(body.file)
    if (typeof body.content !== 'string') throw new HttpError(400, 'content 必须是字符串')
    const abs = path.join(srcDir, file)
    const existed = fs.existsSync(abs)
    if (body.create && existed) throw new HttpError(409, `${file} 已存在`)
    if (!existed && !body.create) throw new HttpError(404, `${file} 不存在`)
    // 乐观锁：文件在别处（比如编辑器外）被改过就拒绝覆盖，前端提示后可以强制保存
    if (existed && body.baseMtime && !body.force && fs.statSync(abs).mtimeMs > body.baseMtime + 1)
      throw new HttpError(409, '文件在编辑器外被修改过，强制保存会覆盖那些改动')
    const before = existed ? readPost(file) : null
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body.content, 'utf8')
    const after = readPost(file)
    const sidebarChanged =
      !before || before.title !== after.title || before.sidebar !== after.sidebar || before.draft !== after.draft
    // 自动保存传 reload: false，不重启；之前自动保存攒下的标题改动由手动保存的 forceReload 补上
    const restarting = body.reload !== false && (sidebarChanged || !!body.forceReload)
    if (restarting) setTimeout(reloadSidebar, 300)
    return sendJson(res, 200, { file, mtime: fs.statSync(abs).mtimeMs, restarting, sidebarChanged })
  }

  if (method === 'POST' && route === 'new') {
    const body = await readBody(req)
    const series = String(body.series ?? '')
    const slug = String(body.slug ?? '')
    const title = String(body.title ?? '').trim()
    if (!listSeries().includes(series)) throw new HttpError(400, `没有系列目录 blog/${series}`)
    if (!SLUG_RE.test(slug)) throw new HttpError(400, '文件名只能用小写字母、数字和 -，例如 01-architecture')
    if (!title || /[\r\n]/.test(title)) throw new HttpError(400, '标题不能为空，也不能换行')
    const file = `blog/${series}/${slug}.md`
    const abs = path.join(srcDir, file)
    if (fs.existsSync(abs)) throw new HttpError(409, `${file} 已存在`)
    const desc = String(body.description ?? '').replace(/[\r\n]+/g, ' ').trim()
    fs.writeFileSync(abs, newPostContent(series, slug, title, desc), 'utf8')
    setTimeout(reloadSidebar, 300)
    return sendJson(res, 200, { file, restarting: true })
  }

  if (method === 'POST' && route === 'upload') {
    const body = await readBody(req)
    const file = checkPost(body.file)
    const m = String(body.name ?? '').match(/^(.*?)(\.(png|jpe?g|gif|webp|svg|avif))$/i)
    if (!m) throw new HttpError(400, '只支持 png / jpg / gif / webp / svg / avif')
    const base = m[1].replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image'
    const ext = m[2].toLowerCase()
    const dirRel = `assets/blog/${path.basename(file, '.md')}`
    const dir = path.join(srcDir, 'public', dirRel)
    fs.mkdirSync(dir, { recursive: true })
    let name = base + ext
    for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}${ext}`
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(body.data ?? ''), 'base64'))
    return sendJson(res, 200, { url: `/${dirRel}/${name}` })
  }

  if (method === 'POST' && route === 'render') {
    const body = await readBody(req)
    const file = checkPost(body.file)
    if (typeof body.content !== 'string') throw new HttpError(400, 'content 必须是字符串')
    return sendJson(res, 200, await renderMarkdown(server, file, body.content))
  }

  if (method === 'GET' && route === 'publish') return sendJson(res, 200, await publishPlan())

  if (method === 'POST' && route === 'publish') {
    const body = await readBody(req)
    const message = String(body.message ?? '').trim()
    if (!message) throw new HttpError(400, 'commit message 不能为空')
    if (publishing) throw new HttpError(409, '正在发布中')
    publishing = true
    try {
      await publish(message, res)
    } finally {
      publishing = false
    }
    return
  }

  throw new HttpError(404, `no route ${method} ${route}`)
}

export function editorPlugin(): Plugin {
  return {
    name: 'blog-editor-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(API)) return next()
        handle(server, req, res).catch((e: unknown) => {
          const status = e instanceof HttpError ? e.status : 500
          if (!(e instanceof HttpError)) server.config.logger.error(String((e as Error)?.stack ?? e))
          if (res.headersSent) res.end(`\n${String((e as Error)?.message ?? e)}\n__RESULT__ fail\n`)
          else sendJson(res, status, { error: String((e as Error)?.message ?? e) })
        })
      })
    }
  }
}
