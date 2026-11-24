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
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
}

/** 某个系列目录生成侧边栏条目：文件名排序，文字取 frontmatter 的 sidebar，没有就用「编号 · 标题」 */
export function seriesSidebar(dir: string, { includeDrafts }: { includeDrafts: boolean }) {
  return listPosts()
    .filter((p) => path.posix.dirname(p.file) === `blog/${dir}` && !p.file.endsWith('/index.md'))
    .filter((p) => includeDrafts || !p.draft)
    .map((p) => {
      const num = path.basename(p.file).match(/^(\d+)-/)?.[1]
      const text = p.sidebar || (num ? `${num} · ${p.title}` : p.title)
      return { text: p.draft ? `${text}（草稿）` : text, link: '/' + p.file.replace(/\.md$/, '') }
    })
}

/** frontmatter 写了 draft: true 的文章，build 时排除 */
export function draftFiles(): string[] {
  return listPosts()
    .filter((p) => p.draft)
    .map((p) => p.file)
}
