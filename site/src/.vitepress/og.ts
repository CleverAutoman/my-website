/**
 * 构建期生成：每个页面的分享卡片（1200×630 PNG）和 RSS feed。
 * 只在 `vitepress build` 时由 config.mts 的 buildEnd 调用，不会进入浏览器端代码。
 *
 * 字体：用构建机器上的系统字体渲染（Windows 下是 Consolas + Microsoft YaHei，能覆盖中英文）。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

export interface PageInfo {
  relativePath: string
  title: string
  description: string
  frontmatter: Record<string, any>
}

export const ogSlug = (relativePath: string) =>
  relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1index').replace(/\//g, '-') || 'index'

export const pageUrl = (siteUrl: string, relativePath: string) =>
  siteUrl + relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 粗略估算文字宽度（单位：em），用来换行：中日韩字符算 1，其余按 0.56 */
const charW = (c: string) => (/[⺀-鿿가-힯＀-￯]/.test(c) ? 1 : c === ' ' ? 0.3 : 0.56)

function wrap(text: string, maxEm: number, maxLines: number) {
  const tokens = text.match(/[⺀-鿿가-힯＀-￯]|[^\s⺀-鿿가-힯＀-￯]+|\s+/g) ?? []
  const lines: string[] = []
  let cur = ''
  let w = 0
  for (const t of tokens) {
    const tw = [...t].reduce((a, c) => a + charW(c), 0)
    if (w + tw > maxEm && cur.trim()) {
      lines.push(cur.trim())
      cur = ''
      w = 0
      if (/^\s+$/.test(t)) continue
    }
    cur += t
    w += tw
  }
  if (cur.trim()) lines.push(cur.trim())
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = kept[maxLines - 1].replace(/.{0,2}$/, '') + '…'
    return kept
  }
  return lines
}

function eyebrowOf(p: PageInfo) {
  if (p.frontmatter.ogEyebrow) return String(p.frontmatter.ogEyebrow)
  if (p.relativePath === 'index.md') return 'software engineer · ai infra'
  if (p.relativePath.startsWith('blog/ai-infra/')) return 'AI Infra 实战笔记'
  if (p.relativePath === 'blog/index.md') return 'writing'
  if (p.relativePath.startsWith('blog/')) return 'design doc · systems'
  return 'chenguang.liu'
}

function chipsOf(p: PageInfo): string[] {
  const env = p.frontmatter.env
  if (env) return [env.gpu, env.framework, env.cost && `cost ${env.cost}`].filter(Boolean).map(String)
  if (p.relativePath === 'index.md') return ['multi-agent', 'LLM evaluation', 'distributed systems']
  return []
}

function cardSvg(p: PageInfo, siteLabel: string) {
  const MONO = "Consolas, 'JetBrains Mono', 'Microsoft YaHei', monospace"
  const SANS = "'Microsoft YaHei', 'Segoe UI', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
  const titleLines = wrap(p.title, 1040 / 64, 2)
  const descLines = wrap(p.description, 1040 / 28, 2)
  const titleY = 250
  const descY = titleY + (titleLines.length - 1) * 80 + 44
  // 右下角站点标识：右对齐，按估算宽度把 logo 放在文字左边
  const labelW = [...siteLabel].reduce((a, ch) => a + charW(ch), 0) * 20
  const logoX = 1120 - labelW - 62
  const chips = chipsOf(p)
  let cx = 80
  const chipSvg = chips
    .map((c) => {
      const w = [...c].reduce((a, ch) => a + charW(ch), 0) * 20 + 32
      const g = `<rect x="${cx}" y="500" width="${w}" height="44" rx="8" fill="#121921" stroke="#2a3440"/>
<text x="${cx + 16}" y="529" font-family="${MONO}" font-size="20" fill="#c9d1d9">${esc(c)}</text>`
      cx += w + 12
      return g
    })
    .join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <radialGradient id="glow" cx="85%" cy="0%" r="70%">
    <stop offset="0" stop-color="#f5a524" stop-opacity="0.22"/>
    <stop offset="1" stop-color="#f5a524" stop-opacity="0"/>
  </radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M40 0H0V40" fill="none" stroke="#94a3b8" stroke-opacity="0.07"/>
  </pattern>
</defs>
<rect width="1200" height="630" fill="#0b0f14"/>
<rect width="1200" height="630" fill="url(#grid)"/>
<rect width="1200" height="630" fill="url(#glow)"/>
<rect x="40" y="40" width="1120" height="550" rx="18" fill="#0f141b" fill-opacity="0.85" stroke="#1f2933" stroke-width="2"/>
<path d="M40 58a18 18 0 0 1 18-18h1084a18 18 0 0 1 18 18v42H40z" fill="#121921"/>
<line x1="40" y1="100" x2="1160" y2="100" stroke="#1f2933" stroke-width="2"/>
<circle cx="76" cy="70" r="8" fill="#2a3440"/><circle cx="102" cy="70" r="8" fill="#2a3440"/><circle cx="128" cy="70" r="8" fill="#2a3440"/>
<text x="156" y="77" font-family="${MONO}" font-size="20" fill="#6b7785">~/${esc(p.relativePath)}</text>
<text x="80" y="168" font-family="${MONO}" font-size="24" fill="#f5a524">// ${esc(eyebrowOf(p))}</text>
${titleLines
  .map((l, i) => `<text x="80" y="${titleY + i * 80}" font-family="${SANS}" font-size="64" font-weight="700" fill="#e6edf3">${esc(l)}</text>`)
  .join('\n')}
${descLines
  .map((l, i) => `<text x="80" y="${descY + 28 + i * 42}" font-family="${SANS}" font-size="28" fill="#9aa5b1">${esc(l)}</text>`)
  .join('\n')}
${chipSvg}
<g transform="translate(${logoX} 498)">
  <rect width="48" height="48" rx="10" fill="#0b0f14" stroke="#2a3440"/>
  <g fill="none" stroke="#f5a524" stroke-width="3" stroke-linecap="round" transform="translate(4 4) scale(1.25)">
    <rect x="9" y="9" width="14" height="14" rx="2"/>
    <path d="M13 5v4M19 5v4M13 23v4M19 23v4M5 13h4M5 19h4M23 13h4M23 19h4"/>
  </g>
  <text x="${1120 - logoX}" y="32" text-anchor="end" font-family="${MONO}" font-size="20" fill="#c9d1d9">${esc(siteLabel)}</text>
</g>
</svg>`
}

export async function writeOgImages(outDir: string, pages: PageInfo[], siteLabel: string) {
  const dir = join(outDir, 'og')
  await mkdir(dir, { recursive: true })
  for (const p of pages) {
    const svg = cardSvg(p, siteLabel)
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
      font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei' }
    })
      .render()
      .asPng()
    await writeFile(join(dir, `${ogSlug(p.relativePath)}.png`), png)
  }
}

export async function writeRss(outDir: string, pages: PageInfo[], siteUrl: string, title: string, description: string) {
  const posts = pages
    .filter((p) => p.relativePath.startsWith('blog/') && !p.relativePath.endsWith('index.md') && p.frontmatter.date)
    .sort((a, b) => +new Date(b.frontmatter.date) - +new Date(a.frontmatter.date))
  const items = posts
    .map((p) => {
      const url = pageUrl(siteUrl, p.relativePath)
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(p.frontmatter.date).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
    </item>`
    })
    .join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(title)}</title>
    <link>${siteUrl}blog/</link>
    <atom:link href="${siteUrl}feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`
  await writeFile(join(outDir, 'feed.xml'), xml)
  return posts.length
}
