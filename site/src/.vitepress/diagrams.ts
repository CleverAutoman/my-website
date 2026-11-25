import type { MarkdownRenderer } from 'vitepress'
import { Transformer } from 'markmap-lib/no-plugins'
import type { INode } from 'markmap-common'
import { parseInfo } from './theme/blocks/fence'
import { flowToSvg, parseFlow } from './theme/blocks/flow'

/**
 * 「块」的页面渲染：围栏代码块按语言分三种（格式见 theme/blocks/fence.ts），都可以带 title="…" 作为图注。
 *
 *   ```flow      流程图：正文是节点和连线的 JSON（写作编辑器里拖动编辑），构建时直接输出静态 SVG
 *   ```mindmap   思维导图：标题 / 列表大纲，构建时用 markmap-lib 转成树，浏览器端由 theme/diagrams.ts 画
 *   ```ts 等     普通代码：交给 VitePress 原来的代码块渲染，有 title 时外面包一层图注
 *
 * 没跑 JS 时（RSS、搜索索引）导图显示成大纲，流程图本来就是静态 SVG。
 */

const transformer = new Transformer([])

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type Node = Pick<INode, 'content' | 'children'>

/** 站内绝对链接（/blog/xx）补上 base，和正文里的链接行为一致 */
function withBaseLinks(node: Node, base: string) {
  node.content = node.content.replace(/(href|src)="\/(?!\/)/g, `$1="${base}`)
  node.children?.forEach((c) => withBaseLinks(c, base))
}
const strip = (node: Node): Node => ({ content: node.content, children: (node.children ?? []).map(strip) })
function outline(node: Node): string {
  const kids = node.children?.length ? `<ul>${node.children.map((c) => `<li>${outline(c)}</li>`).join('')}</ul>` : ''
  return `<span>${node.content}</span>${kids}`
}

/** 外层 figure：v-pre 让正文里的 {{ }} 原样输出（页面会被当成 Vue 模板编译） */
function figure(kind: string, inner: string, title?: string, style = '') {
  const cap = title ? `<figcaption>${escHtml(title)}</figcaption>` : ''
  return `<figure class="md-block md-block-${kind}" v-pre data-decode-skip${style}>${inner}${cap}</figure>\n`
}

let flowSeq = 0

export function diagramsPlugin(md: MarkdownRenderer, { base }: { base: string }) {
  const fence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const { lang, meta, rest } = parseInfo(token.info)

    if (lang === 'mindmap' || lang === 'markmap') {
      const root = strip(transformer.transform(token.content).root)
      withBaseLinks(root, base)
      const h = Number(meta.height)
      const style = h ? ` style="--mindmap-h:${Math.min(Math.max(h, 160), 1600)}px"` : ''
      const inner =
        `<div class="mindmap" data-map="${escAttr(JSON.stringify(root))}">` +
        `<ul class="mindmap-fallback"><li>${outline(root)}</li></ul></div>`
      return figure('mindmap', inner, meta.title, style)
    }

    if (lang === 'flow') {
      try {
        return figure('flow', flowToSvg(parseFlow(token.content), String(++flowSeq)), meta.title)
      } catch (e: any) {
        return figure('flow', `<pre class="md-block-error">${escHtml(e.message)}</pre>`, meta.title)
      }
    }

    // 普通代码：去掉我们的元数据再交给 VitePress（{1,3}、:line-numbers 等参数保留）
    if (meta.title === undefined && meta.height === undefined) return fence(tokens, idx, options, env, self)
    const info = token.info
    token.info = [lang, rest].filter(Boolean).join(' ')
    const html = fence(tokens, idx, options, env, self)
    token.info = info
    return figure('code', html, meta.title)
  }
}
