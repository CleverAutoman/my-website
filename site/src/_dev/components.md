---
title: 组件演示
env:
  gpu: RTX 4090 24GB（示例）
  driver: 550.xx
  cuda: '12.4'
  framework: vLLM 0.x
  model: Qwen2.5-7B-Instruct-AWQ
  platform: AutoDL
  cost: ¥4.2
  date: 2026-11-18
---

<script setup>
import throughput from './sample-throughput.json'
import latency from './sample-latency.json'
</script>

# 组件演示（仅本地 dev 可见）

这个页面在 `_dev/` 下，`npm run build` 时会被排除，不会发布。下面的数据全部是**示例数据，不是实测结果**，只用来看组件效果。

## EnvCard：测试环境卡片

在 frontmatter 里写 `env`，正文放一个 `<EnvCard />`：

<EnvCard />

```md
---
env:
  gpu: RTX 4090 24GB
  driver: 550.xx
  cuda: '12.4'
  framework: vLLM 0.x
  model: Qwen2.5-7B-Instruct-AWQ
  platform: AutoDL
  cost: ¥4.2
  date: 2026-11-18
---

<EnvCard />
```

支持的键：`gpu` `driver` `cuda` `framework` `model` `platform` `cost` `date`，其他键会原样显示键名。

## BenchChart：折线图（吞吐 vs 并发）

<BenchChart :data="throughput" />

## BenchChart：分组柱状图（延迟分位数）

<BenchChart :data="latency" />

```md
<script setup>
import throughput from './data/throughput.json'
</script>

<BenchChart :data="throughput" />
```

JSON 格式：

```json
{
  "title": "图表标题",
  "kind": "line",
  "x": { "label": "并发数", "values": [1, 2, 4, 8] },
  "y": { "label": "输出吞吐", "unit": "tok/s" },
  "series": [
    { "name": "RTX 4090", "values": [40, 78, 150, 280] }
  ],
  "note": "数据说明（可选）"
}
```

- `kind` 是 `line`（默认）或 `bar`
- 最多 4 条 series，颜色按顺序固定，图例可以点击隐藏某条
- 缺失的数据点写 `null`
- 右上角的 Table 按钮可以切换成数据表

## 块：代码 / 流程图 / 思维导图

写作编辑器里三种块都原地编辑，不弹窗：鼠标移到段落左边点 ＋ 新建；代码和导图大纲直接在正文里改（导图下方实时预览），流程图的画布就嵌在正文里；开头那行（```lang title=…）右边有复制、删除。底栏「块视图」关掉可以直接改源码。源文件里都是普通的围栏代码块，`title="…"` 会显示成图注（格式见 `theme/blocks/fence.ts`）。

### 流程图（```flow）

```flow title="一个请求的路径"
{
  "nodes": [
    {"id":"req","text":"请求进来","shape":"round","x":0,"y":20,"w":110,"h":40},
    {"id":"hit","text":"有缓存?","shape":"diamond","x":160,"y":0,"w":120,"h":80},
    {"id":"ret","text":"直接返回","shape":"rect","x":350,"y":-40,"w":100,"h":40},
    {"id":"gpu","text":"调度到 GPU","shape":"rect","tone":"brand","x":350,"y":80,"w":110,"h":40},
    {"id":"tok","text":"生成 token","shape":"round","tone":"green","x":520,"y":20,"w":120,"h":40}
  ],
  "edges": [
    {"from":"req","to":"hit"},
    {"from":"hit","to":"ret","label":"是"},
    {"from":"hit","to":"gpu","label":"否"},
    {"from":"gpu","to":"tok"},
    {"from":"ret","to":"tok","dashed":true}
  ]
}
```

分组、文字标注、实心色块、副标题、调大小（LSM-tree 的层级结构）：

```flow title="LSM-tree：内存和磁盘上的层级"
{
  "nodes": [
    {"id":"mem","text":"内存","shape":"group","x":0,"y":0,"w":740,"h":120,"lock":true},
    {"id":"mt","text":"MemTable\n可写，有序结构","shape":"rect","tone":"violet","fill":true,"size":"lg","x":20,"y":30,"w":220,"h":70,"lock":true},
    {"id":"imm","text":"Immutable MemTable\n只读，等待刷盘","shape":"rect","tone":"violet","fill":true,"size":"lg","x":275,"y":30,"w":260,"h":70,"lock":true},
    {"id":"disk","text":"磁盘","shape":"group","x":0,"y":140,"w":740,"h":310,"lock":true},
    {"id":"l0","text":"L0","shape":"text","size":"lg","x":50,"y":195},
    {"id":"s0_0","text":"SST","shape":"rect","tone":"brand","fill":true,"x":160,"y":190,"w":90,"h":40,"lock":true},
    {"id":"s0_1","text":"SST","shape":"rect","tone":"brand","fill":true,"x":260,"y":190,"w":90,"h":40,"lock":true},
    {"id":"s0_2","text":"SST","shape":"rect","tone":"brand","fill":true,"x":360,"y":190,"w":90,"h":40,"lock":true},
    {"id":"l1","text":"L1","shape":"text","size":"lg","x":50,"y":255},
    {"id":"s1_0","text":"","shape":"rect","tone":"green","fill":true,"x":160,"y":250,"w":60,"h":40,"lock":true},
    {"id":"s1_1","text":"","shape":"rect","tone":"green","fill":true,"x":220,"y":250,"w":60,"h":40,"lock":true},
    {"id":"s1_2","text":"","shape":"rect","tone":"green","fill":true,"x":280,"y":250,"w":60,"h":40,"lock":true},
    {"id":"l2","text":"L2","shape":"text","size":"lg","x":50,"y":315},
    {"id":"s2_0","text":"","shape":"rect","tone":"green","fill":true,"x":160,"y":310,"w":60,"h":40,"lock":true},
    {"id":"s2_1","text":"","shape":"rect","tone":"green","fill":true,"x":220,"y":310,"w":60,"h":40,"lock":true},
    {"id":"s2_2","text":"","shape":"rect","tone":"green","fill":true,"x":280,"y":310,"w":60,"h":40,"lock":true},
    {"id":"s2_3","text":"","shape":"rect","tone":"green","fill":true,"x":340,"y":310,"w":60,"h":40,"lock":true},
    {"id":"s2_4","text":"","shape":"rect","tone":"green","fill":true,"x":400,"y":310,"w":60,"h":40,"lock":true},
    {"id":"s2_5","text":"","shape":"rect","tone":"green","fill":true,"x":460,"y":310,"w":60,"h":40,"lock":true},
    {"id":"l3","text":"L3","shape":"text","size":"lg","x":50,"y":375},
    {"id":"s3_0","text":"","shape":"rect","tone":"green","fill":true,"x":160,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_1","text":"","shape":"rect","tone":"green","fill":true,"x":220,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_2","text":"","shape":"rect","tone":"green","fill":true,"x":280,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_3","text":"","shape":"rect","tone":"green","fill":true,"x":340,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_4","text":"","shape":"rect","tone":"green","fill":true,"x":400,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_5","text":"","shape":"rect","tone":"green","fill":true,"x":460,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_6","text":"","shape":"rect","tone":"green","fill":true,"x":520,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_7","text":"","shape":"rect","tone":"green","fill":true,"x":580,"y":370,"w":60,"h":40,"lock":true},
    {"id":"s3_8","text":"","shape":"rect","tone":"green","fill":true,"x":640,"y":370,"w":60,"h":40,"lock":true},
    {"id":"n0","text":"key 范围可重叠","shape":"text","x":470,"y":198},
    {"id":"n1","text":"层内有序、互不重叠","shape":"text","x":360,"y":258},
    {"id":"n2","text":"约为上一层 10 倍","shape":"text","x":530,"y":318},
    {"id":"n3","text":"左侧箭头 = compaction：和下一层合并，写回下一层","shape":"text","x":160,"y":420}
  ],
  "edges": [
    {"from":"mt","to":"imm"},
    {"from":"imm","to":"s0_2"},
    {"from":"l0","to":"l1"},
    {"from":"l1","to":"l2"},
    {"from":"l2","to":"l3"}
  ]
}
```

- 画布嵌在正文里：拖动节点、拖右下角改大小、从节点边上的圆点拖出连线；双击节点弹出属性浮层改文字、形状（方框 / 圆角 / 判断 / 圆 / 文字 / 分组）、颜色、实心、字号，双击连线改标签和虚线；Ctrl+D 往右紧挨着复制一份（一排同样的块）；Ctrl+滚轮缩放
- 文字第二行起显示成副标题；分组是虚线框，拖分组时框里的节点一起走；改动实时写回文档，Ctrl+Z 撤销
- 存的是节点坐标和连线的 JSON，构建时直接输出静态 SVG，页面不加载任何库
- 正文里已有的 ```mermaid 块，开头那行会多一个「转成流程图」按钮（支持常见的 flowchart 写法，自动排版）

### 思维导图（```mindmap）

```mindmap title="写博客" height=360
# 写博客
## 兴趣
- 学点新东西
- 避免脑子锈掉
## 工作
- 积累系统功底
- 锻炼写作能力
## 规划
- DDIA 存储与检索
- DDIA 分布式
```

- 标题级别和列表缩进就是导图层级；节点里可以用粗体、行内代码、链接（站内链接写 `/blog/xx`）
- `height=` 是高度（px），默认 420；点节点折叠 / 展开，滚轮不缩放

### 代码块

```bash title="启动 dev server" {2}
cd site
npm run dev
```

- 语言、`title`、VitePress 自己的参数（`{2}` 高亮行、`:line-numbers`）都写在开头那行，直接改

### 高亮块（::: tip）

::: tip 提示
青绿色。适合补充说明、小技巧。
:::

::: info
中性灰。
:::

::: warning 注意
黄色。
:::

::: danger 警告
红色。
:::

::: details 点开看详情
折叠内容。
:::

- 写法：`::: 类型 标题` 开头、`:::` 结尾，标题可省略
- 编辑器里左侧 ＋ 菜单「高亮块」一栏选类型，或底栏「＋ 高亮块」（tip）
