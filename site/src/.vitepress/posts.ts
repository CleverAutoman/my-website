import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 文章目录扫描：侧边栏、草稿排除、编辑器的文章列表都从这里读，新增文章不用再手改 config
export const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export interface PostMeta {
  /** 相对 src 的路径，如 blog/ai-infra/00-wsl2-sglang-env.md */
  file: string
  title: string
  sidebar?: string
  /** 目录的 index.md 可写 group，作为侧边栏分组名 */
  group?: string
  date?: string
  draft: boolean
}

/** 只读 frontmatter 顶层的 key: value，够侧边栏和列表用；完整解析交给 VitePress */
export function readFrontmatter(src: string): Record<string, string> {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export function readPost(file: string): PostMeta {
  const src = fs.readFileSync(path.join(srcDir, file), 'utf8')
  const fm = readFrontmatter(src)
  const h1 = src.match(/^#\s+(.+)$/m)?.[1]
  return {
    file,
    title: fm.title || h1 || path.basename(file, '.md'),
    sidebar: fm.sidebar || undefined,
    group: fm.group || undefined,
    date: fm.date || undefined,
    draft: fm.draft === 'true'
  }
}

/** blog/ 下所有 .md（含子目录），按路径排序 */
export function listPosts(): PostMeta[] {
  const out: PostMeta[] = []
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(srcDir, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'data') walk(r)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(readPost(r))
    }
  }
  walk('blog')
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

/** 系列目录（blog/ 下的子目录），编辑器新建文章时可选 */
export function listSeries(): string[] {
  return fs
    .readdirSync(path.join(srcDir, 'blog'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'data')
    .map((e) => e.name)
    .sort()
}

/**
 * 某个目录生成侧边栏条目：文件名排序，文字取 frontmatter 的 sidebar，没有就用「编号 · 标题」。
 * dir 为空表示 blog/ 根目录
 */
export function seriesSidebar(dir: string, { includeDrafts }: { includeDrafts: boolean }) {
  const parent = dir ? `blog/${dir}` : 'blog'
  const list = listPosts().filter((p) => path.posix.dirname(p.file) === parent && path.posix.basename(p.file) !== 'index.md')
  // 根目录的文章没有编号，按日期排
  if (!dir) list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.file.localeCompare(b.file))
  return list
    .filter((p) => includeDrafts || !p.draft)
    .map((p) => {
      const num = path.basename(p.file).match(/^(\d+)-/)?.[1]
      const text = p.sidebar || (num ? `${num} · ${p.title}` : p.title)
      return { text: p.draft ? `${text}（草稿）` : text, link: '/' + p.file.replace(/\.md$/, '') }
    })
}

/**
 * /blog/ 的整个侧边栏：每个子目录一组，blog/ 根目录下的文章一组（rootGroup），没有文章的组不显示。
 * 子目录的分组名和概览链接文字取它 index.md 的 group / sidebar，
 * 没写就拆标题「分组名 · 概览名」，再没有就用目录名和「概览」
 */
export function blogSidebar({ includeDrafts, rootGroup }: { includeDrafts: boolean; rootGroup: string }) {
  const groups: { text: string; items: { text: string; link: string }[] }[] = []
  for (const dir of listSeries()) {
    const indexFile = `blog/${dir}/index.md`
    const index = fs.existsSync(path.join(srcDir, indexFile)) ? readPost(indexFile) : null
    const [head, tail] = (index?.title ?? '').split(/\s+·\s+/)
    const items = seriesSidebar(dir, { includeDrafts })
    if (index && (includeDrafts || !index.draft)) {
      const text = index.sidebar || tail || '概览'
      items.unshift({ text: index.draft ? `${text}（草稿）` : text, link: `/blog/${dir}/` })
    }
    if (items.length) groups.push({ text: index?.group || (tail ? head : '') || dir, items })
  }
  const root = seriesSidebar('', { includeDrafts })
  if (root.length) groups.push({ text: rootGroup, items: root })
  return groups
}

/** frontmatter 写了 draft: true 的文章，build 时排除 */
export function draftFiles(): string[] {
  return listPosts()
    .filter((p) => p.draft)
    .map((p) => p.file)
}
