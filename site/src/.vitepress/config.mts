import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig, type HeadConfig } from 'vitepress'
import type { PageInfo } from './og'
import { editorPlugin } from './editor'
import { diagramsPlugin } from './diagrams'
import { blogSidebar, draftFiles } from './posts'

// GitHub Pages 从 main 分支的 /docs 发布，站点地址 https://cleverautoman.github.io/my-website/
const base = '/my-website/'
const repoUrl = 'https://github.com/CleverAutoman/my-website'
const isBuild = process.argv.includes('build')
const siteUrl = `https://cleverautoman.github.io${base}`
const siteDescription =
  'Software engineer building AI infrastructure: multi-agent orchestration, LLM evaluation, and the distributed systems underneath.'

// 分享卡片和 RSS 用到的页面信息，构建时由 transformPageData 收集
const pages = new Map<string, PageInfo>()
const ogSlug = (rel: string) => rel.replace(/\.md$/, '').replace(/\//g, '-')
const urlOf = (rel: string) => siteUrl + rel.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
const rssIcon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>'

// 构建信息：构建时所在的 commit（工作区有未提交改动时带 -dirty 后缀），显示在页脚
function git(args: string) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}
const describe = git('describe --always --dirty --abbrev=7')
const fullHash = git('rev-parse HEAD')
const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ')
const buildInfo = describe
  ? `<span class="build">built from <a href="${repoUrl}/commit/${fullHash}" target="_blank" rel="noreferrer">${describe}</a> · ${buildDate} UTC</span>`
  : ''

export default defineConfig({
  base,
  outDir: '../../docs',
  // _dev/ 是只在本地 dev 时可见的组件演示页和写作编辑器，不会发布；frontmatter 写了 draft: true 的文章也不发布
  srcExclude: isBuild ? ['_dev/**', ...draftFiles()] : [],

  // 本地写作接口（/my-website/_dev/editor），只在 dev 时生效
  vite: {
    plugins: [editorPlugin()],
    resolve: {
      alias: [
        // 右侧 On this page：换成带展开/收起三角的版本
        {
          find: /^.*\/VPDocOutlineItem\.vue$/,
          replacement: fileURLToPath(new URL('./theme/components/OutlineItem.vue', import.meta.url))
        }
      ]
    }
  },
  lang: 'en-US',
  title: 'Chenguang Liu',
  titleTemplate: ':title · Chenguang Liu',
  description: siteDescription,
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',

  head: [
    // decoding 效果：首次绘制前就把正文藏起来，JS 开始逐 token 显示时再放出；3 秒兜底，JS 出错也不会一直空白
    [
      'script',
      {},
      `;(function(){try{var d=document.documentElement;if(!(window.CSS&&CSS.highlights&&window.Highlight)||matchMedia('(prefers-reduced-motion: reduce)').matches)return;d.classList.add('decode-pending');setTimeout(function(){d.classList.remove('decode-pending')},3000)}catch(e){}})()`
    ],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Chenguang Liu · Blog', href: `${siteUrl}feed.xml` }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap'
      }
    ]
  ],

  markdown: {
    lineNumbers: true,
    // ```mindmap 思维导图和 ```mermaid / ```flowchart 流程图（diagrams.ts），浏览器端由 theme/diagrams.ts 画图
    config: (md) => diagramsPlugin(md, { base })
  },

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'chenguang.liu',

    nav: [
      { text: 'Home', link: '/' },
      { text: 'Projects', link: '/#projects' },
      { text: 'Blog', link: '/blog/', activeMatch: '^/blog/' },
      { text: 'Resume', link: '/assets/resume.pdf' }
    ],

    // 博客侧边栏按 blog/ 下的目录和文件自动生成（见 posts.ts）：每个子目录一组，根目录的文章归到 rootGroup。
    // 新增、移动文章都不用改这里
    sidebar: {
      '/blog/': [
        {
          text: 'Blog',
          items: [{ text: 'All posts', link: '/blog/' }]
        },
        ...blogSidebar({ includeDrafts: !isBuild, rootGroup: 'Systems Design Docs' })
      ]
    },

    // 'deep' = h2–h6，右侧 On this page 显示所有标题层级
    outline: { level: 'deep' },

    search: { provider: 'local' },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/CleverAutoman' },
      { icon: 'linkedin', link: 'https://www.linkedin.com/in/chenguang-liu-a69a94269/' },
      { icon: 'x', link: 'https://x.com/CleverAutoman' },
      { icon: { svg: rssIcon }, link: `${siteUrl}feed.xml`, ariaLabel: 'RSS feed' }
    ],

    footer: {
      message: ['Built with VitePress', buildInfo].filter(Boolean).join(' · '),
      copyright: '© 2026 Chenguang Liu'
    }
  },

  /* ---------- 分享卡片（Open Graph）和 RSS，只在 build 时生效 ---------- */
  transformPageData(pageData) {
    if (!isBuild || pageData.isNotFound) return
    pages.set(pageData.relativePath, {
      relativePath: pageData.relativePath,
      title: pageData.frontmatter.title || pageData.title || 'Chenguang Liu',
      description: pageData.frontmatter.description || pageData.description || siteDescription,
      frontmatter: pageData.frontmatter
    })
  },
  transformHead({ pageData }) {
    if (pageData.isNotFound) return
    const title = pageData.frontmatter.title || pageData.title || 'Chenguang Liu'
    const desc = pageData.frontmatter.description || pageData.description || siteDescription
    const image = `${siteUrl}og/${ogSlug(pageData.relativePath)}.png`
    const isPost = pageData.relativePath.startsWith('blog/') && !pageData.relativePath.endsWith('index.md')
    const meta = (property: string, content: string): HeadConfig => ['meta', { property, content }]
    const named = (name: string, content: string): HeadConfig => ['meta', { name, content }]
    return [
      meta('og:type', isPost ? 'article' : 'website'),
      meta('og:site_name', 'Chenguang Liu'),
      meta('og:title', title),
      meta('og:description', desc),
      meta('og:url', urlOf(pageData.relativePath)),
      meta('og:image', image),
      meta('og:image:width', '1200'),
      meta('og:image:height', '630'),
      named('twitter:card', 'summary_large_image'),
      named('twitter:title', title),
      named('twitter:description', desc),
      named('twitter:image', image)
    ]
  },
  async buildEnd(siteConfig) {
    const { writeOgImages, writeRss } = await import('./og')
    const list = [...pages.values()]
    await writeOgImages(siteConfig.outDir, list, 'cleverautoman.github.io/my-website')
    const n = await writeRss(siteConfig.outDir, list, siteUrl, 'Chenguang Liu · Blog', siteDescription)
    console.log(`  og images: ${list.length} · rss items: ${n}`)
  }
})
