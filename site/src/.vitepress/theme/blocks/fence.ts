// 「块」= markdown 里的一个围栏代码块。代码、流程图、思维导图都存成代码块，源文件仍是纯 markdown：
//
//   ```ts title="启动脚本" {2}          代码：语言 + 元数据 + VitePress 自己的参数（{2} 高亮行、:line-numbers）
//   ```flow title="请求路径"            流程图：正文是节点和连线的 JSON（flow.ts）
//   ```mindmap title="大纲" height=420  思维导图：正文是标题 / 列表大纲
//
// 元数据只认 META_KEYS 里的 key=value，其余参数原样保留。服务端渲染（.vitepress/diagrams.ts）和编辑器共用这里。

export type BlockKind = 'code' | 'flow' | 'mindmap'

export const BLOCK_KINDS: { kind: BlockKind; label: string; icon: string }[] = [
  { kind: 'code', label: '代码块', icon: '</>' },
  { kind: 'flow', label: '流程图', icon: '◇' },
  { kind: 'mindmap', label: '思维导图', icon: '✣' }
]

export const META_KEYS = ['title', 'height'] as const
export type BlockMeta = Partial<Record<(typeof META_KEYS)[number], string>>

export interface Block {
  kind: BlockKind
  /** 代码块的语言；流程图是 flow，导图是 mindmap */
  lang: string
  meta: BlockMeta
  /** 不认识的参数，原样写回（如 {1,3} :line-numbers） */
  rest: string
  body: string
}

export function kindOf(lang: string): BlockKind {
  if (lang === 'flow') return 'flow'
  if (lang === 'mindmap' || lang === 'markmap') return 'mindmap'
  return 'code'
}

const META_RE = new RegExp(`(?:^|\\s)(${META_KEYS.join('|')})=(?:"([^"]*)"|(\\S+))`, 'g')

export function parseInfo(info: string): { lang: string; meta: BlockMeta; rest: string } {
  const s = info.trim()
  const lang = s.match(/^[^\s{]*/)![0]
  const meta: BlockMeta = {}
  const rest = s
    .slice(lang.length)
    .replace(META_RE, (_m, k: keyof BlockMeta, q?: string, bare?: string) => {
      meta[k] = q ?? bare ?? ''
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
  return { lang, meta, rest }
}

export function formatInfo(lang: string, meta: BlockMeta, rest = ''): string {
  const parts = [lang]
  for (const k of META_KEYS) {
    const v = meta[k]?.replace(/"/g, '＂').replace(/[\r\n]+/g, ' ').trim()
    if (v) parts.push(/^[\w.-]+$/.test(v) && k !== 'title' ? `${k}=${v}` : `${k}="${v}"`)
  }
  if (rest.trim()) parts.push(rest.trim())
  return parts.join(' ')
}

const OPEN_RE = /^(`{3,}|~{3,})(.*)$/

/** 整段围栏源码 → Block；不是完整（闭合、无缩进）的围栏时返回 null */
export function parseFence(source: string): Block | null {
  const lines = source.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
  if (lines.length < 2) return null
  const open = lines[0].match(OPEN_RE)
  if (!open) return null
  const close = lines[lines.length - 1].trim()
  if (close[0] !== open[1][0] || close.length < open[1].length || !/^(`+|~+)$/.test(close)) return null
  const { lang, meta, rest } = parseInfo(open[2])
  return { kind: kindOf(lang), lang, meta, rest, body: lines.slice(1, -1).join('\n') }
}

/** Block → 围栏源码（不带结尾换行）；正文里有 ``` 时自动加长围栏 */
export function formatFence(b: Block): string {
  const longest = Math.max(2, ...[...b.body.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const lang = b.kind === 'flow' ? 'flow' : b.kind === 'mindmap' ? 'mindmap' : b.lang
  return `${fence}${formatInfo(lang, b.meta, b.rest)}\n${b.body.replace(/\n+$/, '')}\n${fence}`
}

/**
 * 高亮块：VitePress 的自定义容器（::: tip 标题 … :::），正文直接在编辑区里写，不做成框。
 * accent / bg 是编辑区和菜单里用的颜色，和页面上 VitePress 的样式对应
 */
export const CALLOUTS = [
  { type: 'tip', label: '提示', accent: 'var(--vp-c-tip-1)', bg: 'var(--vp-custom-block-tip-bg)' },
  { type: 'info', label: '信息', accent: 'var(--vp-c-text-2)', bg: 'var(--vp-custom-block-info-bg)' },
  { type: 'warning', label: '注意', accent: 'var(--vp-c-warning-1)', bg: 'var(--vp-custom-block-warning-bg)' },
  { type: 'danger', label: '警告', accent: 'var(--vp-c-danger-1)', bg: 'var(--vp-custom-block-danger-bg)' },
  { type: 'details', label: '折叠', accent: 'var(--vp-c-text-3)', bg: 'var(--vp-custom-block-details-bg)' }
] as const
export type CalloutType = (typeof CALLOUTS)[number]['type']
export const CALLOUT_PLACEHOLDER = '在这里写内容'
export const calloutText = (type: CalloutType) => `::: ${type}\n${CALLOUT_PLACEHOLDER}\n:::`

export const MINDMAP_TEMPLATE = ['# 中心主题', '## 分支一', '- 要点', '- 要点', '  - 细节', '## 分支二', '- 要点'].join('\n')
