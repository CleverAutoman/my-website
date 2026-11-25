# 网站源码

个人主页和博客是同一个 [VitePress](https://vitepress.dev/) 站点，线上地址：https://cleverautoman.github.io/my-website/

GitHub Pages 从 main 分支的 `/docs` 发布。`npm run build` 会把整站输出到仓库根目录的 `docs/`（每次构建会清空重建），**构建后要把 `docs/` 一起提交**，线上才会更新。

## 本地开发

```bash
cd site
npm install --registry=https://registry.npmjs.org   # 国内镜像缺包时用官方源
npm run dev      # 开发预览：http://localhost:5173/my-website/
npm run build    # 构建到 ../docs
npm run preview  # 预览构建产物（重新 build 后要重启 preview）
```

## Git 约定

clone 之后先启用仓库自带的钩子（每个 clone 一次）：

```bash
git config core.hooksPath .githooks
```

- `.githooks/pre-commit`：拦截草稿。暂存区里有 `draft: true` 的文章，或草稿在 `src/public/assets/blog/<文件名>/` 下的图片时，拒绝提交。编辑器的「发布」本来就会跳过草稿，钩子主要防手动 `git commit`；确实要提交用 `--no-verify`
- `.gitattributes`：统一 LF 换行，图片、PDF、字体按二进制处理
- `.gitignore`：忽略 `node_modules/`、VitePress 缓存、`.env*`、系统生成的文件
- 「发布」只提交 `site/src` 和 `docs`。`package.json`、`templates/`、README 这类文件要手动提交

## 目录结构

```
site/
  src/.vitepress/config.mts              站点配置（base、导航、侧边栏、搜索）
  src/.vitepress/posts.ts                扫描文章：自动侧边栏、草稿排除
  src/.vitepress/editor.ts               本地写作接口（只在 dev 时挂载）
  src/.vitepress/diagrams.ts             块的页面渲染：```flow → 静态 SVG，```mindmap → 导图占位，代码块的 title 图注
  src/.vitepress/theme/blocks/           块的格式（fence.ts）和流程图模型 / 画法（flow.ts），页面和编辑器共用
  src/.vitepress/theme/data.ts           内容数据：个人信息、技术栈、经历、项目、文章列表
  src/.vitepress/theme/style.css         全站配色与字体（深色 / 浅色）
  src/.vitepress/theme/components/       首页 HomePage、博客索引 BlogIndex、EnvCard、BenchChart、图标
  src/_dev/                              组件演示页和写作编辑器（只在 npm run dev 时可见，不会发布）
  src/index.md                           首页（渲染 HomePage 组件）
  src/blog/index.md                      博客索引
  src/blog/ai-infra/                     AI Infra 实战笔记系列
  src/blog/os-project.md, db-engine.md   项目设计文档
  src/public/                            静态资源：assets/（图片、简历）、favicon、旧链接跳转页
  templates/post.md                      文章模板（不参与构建）
```

## 常见改动

- **改首页文字、经历、项目**：编辑 `theme/data.ts`，首页标题段落在 `components/HomePage.vue` 的 Hero 部分
- **网页写作（推荐）**：`npm run dev` 后打开 http://localhost:5173/my-website/_dev/editor
  - 左边写 Markdown，右边两种预览：「实时渲染」边写边渲染（用站点同一套 markdown 配置，代码高亮、::: 容器都一样，Vue 组件显示为占位，EnvCard 显示成表格），「页面预览」是保存后的真实页面
  - 编辑区是 CodeMirror 6：标题按级别放大、粗斜体直接显示、代码块和 frontmatter 有底色、::: 容器高亮、图片下面显示缩略图；`#`、`**` 等标记保留但弱化，源码不会被改写
  - Ctrl+S 保存，Ctrl+B / I / E 粗体、斜体、行内代码，Ctrl+F 查找，Ctrl+Z 撤销；可勾选自动保存
  - 「＋ 新文章」按 `templates/post.md` 生成文件，默认是草稿。目录可选 `blog/` 根目录、已有子目录或新建目录，编号按目录自动递增（可留空）
  - 「移动…」给已有文章换目录或改文件名：文章里的相对引用（`./data/xx.json` 等）按新位置重算，改了文件名时图片目录 `public/assets/blog/<文件名>/` 跟着改名，站内指向旧网址的链接（其他文章、`theme/data.ts`、`public/` 里的跳转页）一起改成新网址，搬空的目录会删掉。已发布的文章换网址后站外旧链接会 404
  - 工具栏「草稿 / 公开」切换：改 frontmatter 的 `draft: true` 并保存，侧边栏随之更新。设为公开后点「发布…」才上线；已上线的文章转回草稿，下次发布时页面下线，仓库里保留它上线时的版本
  - 粘贴或拖入图片会存到 `src/public/assets/blog/<文件名>/` 并插入引用
  - 「发布…」= `vitepress build` → `git add/commit -- site/src docs` → `git push origin HEAD`，日志实时显示。只提交这两个目录；草稿不构建，源文件和图片也不提交
  - 接口代码在 `.vitepress/editor.ts`，只挂在 dev server 上，build 产物里没有编辑器
- **新增 AI Infra 文章（手动）**：
  1. 复制 `templates/post.md` 到 `src/blog/ai-infra/`，例如 `01-wsl2-cuda-setup.md`
  2. 侧边栏按 `blog/` 下的目录和文件自动生成（`.vitepress/posts.ts` 的 `blogSidebar`）：每个子目录一组，按文件名排序，文字是「编号 · 标题」，想用短标题就在 frontmatter 写 `sidebar: 01 · 短标题`；分组名和概览链接取子目录 `index.md` 的 `group` / `sidebar`，没写就把标题「分组名 · 概览名」拆开用；`blog/` 根目录的文章归到「Systems Design Docs」组，按日期排
  3. 更新 `src/blog/ai-infra/index.md` 路线图里的状态
  4. `npm run build`，提交 `site/` 和 `docs/`
- **草稿**：frontmatter 写 `draft: true`，本地 dev 里能看（侧边栏标「草稿」），build 时排除
- **块：代码 / 流程图 / 思维导图**：源文件里都是围栏代码块，`title="…"` 显示成图注。
  - 编辑器里原地编辑，不弹窗：鼠标移到段落左边点 ＋（或底栏「＋ 代码块 / 流程图 / 思维导图」）新建；代码和导图大纲就在正文里改，导图下方实时预览；开头那行（```lang title=…）右边有复制、删除。底栏「块视图」关掉后全部显示成源码
  - 流程图（```flow）：画布嵌在正文里（`FlowEditor.vue`），改动 250ms 后写回文档，Ctrl+Z 能撤销。拖动节点、拖右下角改大小、从节点边上的圆点拖出连线；双击节点改文字、形状（方框 / 圆角 / 判断 / 圆 / 文字标注 / 虚线分组）、颜色、实心、字号，双击连线改标签、虚线；文字第二行起是副标题；拖分组时框里的节点一起走；Ctrl+D 往右紧挨着复制（一排同样的块）；Ctrl+滚轮缩放。存的是节点坐标和连线的 JSON，构建时直接输出静态 SVG，页面不加载任何库（`theme/blocks/flow.ts`）。画布按正文宽度（约 700px）摆，页面上会按栏宽缩放
  - 思维导图（```mindmap）：标题和列表层级就是导图层级，`height=` 设高度；markmap 在浏览器端按需加载（`theme/diagrams.ts`）
  - 正文里旧的 ```mermaid 块按普通代码显示，编辑器里的块上有「转成流程图」按钮
  - 流程图编辑器里双击节点弹出属性浮层，就地改文字、形状、颜色；双击连线改标签、虚线
- **高亮块**：VitePress 的 `::: tip 标题 … :::` 容器（tip / info / warning / danger / details）。左侧 ＋ 菜单的「高亮块」一栏或底栏「＋ 高亮块」插入，占位文字已选中，直接输入；编辑区里整段按类型上色，内容直接在正文里写
  - 示例见 dev 下的 `/my-website/_dev/components`
- **文章组件**：frontmatter 写 `env`，正文放 `<EnvCard />` 显示测试环境卡片；实测数据存成 JSON，在文章的 `<script setup>` 里 import 后用 `<BenchChart :data="..." />` 画图。用法和 JSON 格式见 dev 下的 `/my-website/_dev/components`
- **技术栈联动**：`data.ts` 里给经历、项目、文章加 `layer: 'L1' | 'L2' | 'L3'`，首页技术栈层下会自动列出对应条目
- **页脚构建信息**：构建时自动读取 `git describe --dirty`。因为先构建再提交，显示的是构建时的上一个 commit，有未提交改动时带 `-dirty`
- **全站 decoding 效果**：`theme/decoder.ts` 驱动，每个页面正文像 LLM 生成一样逐 token 出现，右下角的统计面板显示 TTFT、速度和 token 数（文本 + 图片）。token 数是估算：文本按 BPE 风格规则，图片按 w×h/750。不想参与 decoding 和计数的元素加 `data-decode-skip`。开启「减少动态效果」的访客不播放动画，只显示统计
- **trace 面板**：右下角面板的 trace 页签用浏览器 Performance API 画加载瀑布图（`theme/trace.ts`）
- **404 页**：`theme/components/NotFound.vue`
- **分享卡片 + RSS**：`npm run build` 时自动为每个页面生成 `docs/og/*.png`（1200×630）并写入 og/twitter meta，同时生成 `docs/feed.xml`（收录 `blog/` 下带 `date` 的文章）。代码在 `.vitepress/og.ts`，用构建机器的系统字体渲染（Windows 下是 Consolas + 微软雅黑）
- **评论（giscus）**：配置在 `theme/giscus.ts`。需要先在仓库开启 Discussions、安装 giscus app，再把 giscus.app 给出的 category 和 categoryId 填进去；没填时评论区不显示。单篇文章不想要评论，在 frontmatter 写 `comments: false`
- **改配色**：`theme/style.css` 顶部的变量。浅色是暖白纸面 + 墨色文字（和琥珀色品牌同色温），深色是深蓝黑底；两套都定义了品牌色、背景层次、文字、高亮块（tip 青绿 / warning 黄 / danger 红）和流程图节点颜色（`--x-tone-*`）。只在 `:root` 里改浅色时，深色那份要在 `.dark` 里显式写回，否则会被浅色值盖掉
