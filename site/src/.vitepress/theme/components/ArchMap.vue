<script setup lang="ts">
// SGLang 架构分层图：路线图页面顶部用。
// 每一层点击后跳到页面里对应的章节（章节标题要写 {#layer-xxx} 自定义锚点）。
// done 传入已经写完 / 有草稿的文章编号，对应编号会高亮。
const props = withDefaults(defineProps<{ done?: number[] }>(), { done: () => [] })

interface Layer {
  id: string
  name: string
  en: string
  parts: string[]
  posts: number[]
}

const cluster: Layer = {
  id: 'layer-cluster',
  name: '集群与运维层',
  en: 'cluster',
  parts: ['Router', 'PD 分离', 'Kubernetes', 'Prometheus 指标'],
  posts: [14, 15, 16, 17]
}

const instance: Layer[] = [
  {
    // 入口层没有单独的文章，由架构总览（#01）讲
    id: 'layer-pre',
    name: '入口层',
    en: 'entry',
    parts: ['HTTP Server', 'OpenAI API', 'TokenizerManager', 'DetokenizerManager'],
    posts: [1]
  },
  {
    id: 'layer-scheduler',
    name: '调度层',
    en: 'scheduler',
    parts: ['Scheduler', 'continuous batching', 'chunked prefill', 'overlap', 'grammar'],
    posts: [2, 3, 4]
  },
  {
    id: 'layer-memory',
    name: '显存与 KV 缓存层',
    en: 'memory',
    parts: ['ReqToTokenPool', 'TokenToKVPool', 'RadixCache', 'HiCache'],
    posts: [5, 6, 7]
  },
  {
    id: 'layer-exec',
    name: '执行层',
    en: 'model runner',
    parts: ['ModelRunner', 'attention backend', 'CUDA Graph', '量化 kernel', '投机解码', 'LoRA'],
    posts: [8, 9, 10, 11]
  },
  {
    id: 'layer-parallel',
    name: '并行层',
    en: 'parallel',
    parts: ['TP', 'DP', 'DP Attention', 'EP'],
    posts: [12, 13]
  }
]

const base: Layer = {
  id: 'layer-pre',
  name: '环境与硬件',
  en: 'platform',
  parts: ['驱动', 'WSL2', '容器', 'GPU 架构（sm75 / sm89 / sm90）'],
  posts: [0]
}

const side: Layer[] = [
  { id: 'layer-eco', name: '生态与对比', en: 'ecosystem', parts: ['vLLM', '微调', 'RL rollout'], posts: [18, 19, 20] }
]

const isDone = (n: number) => props.done.includes(n)
const pad = (n: number) => String(n).padStart(2, '0')
</script>

<template>
  <figure class="vp-raw arch-map" aria-label="SGLang 架构分层与对应文章">
    <div class="arch-bar">
      <span class="dot" /><span class="dot" /><span class="dot" />
      <span class="arch-title">sglang · request path</span>
    </div>

    <div class="arch-body">
      <div class="arch-flow">client ── HTTP / OpenAI API ──▼</div>

      <a :href="`#${cluster.id}`" class="layer layer-outer">
        <div class="layer-head">
          <span class="layer-name">{{ cluster.name }}</span>
          <span class="layer-en">{{ cluster.en }}</span>
        </div>
        <div class="layer-parts">
          <code v-for="p in cluster.parts" :key="p">{{ p }}</code>
        </div>
        <div class="layer-posts">
          <span v-for="n in cluster.posts" :key="n" class="post" :class="{ done: isDone(n) }">#{{ pad(n) }}</span>
        </div>
      </a>

      <div class="instance">
        <div class="instance-label">单个 SGLang 实例</div>
        <a v-for="l in instance" :key="l.id" :href="`#${l.id}`" class="layer">
          <div class="layer-head">
            <span class="layer-name">{{ l.name }}</span>
            <span class="layer-en">{{ l.en }}</span>
          </div>
          <div class="layer-parts">
            <code v-for="p in l.parts" :key="p">{{ p }}</code>
          </div>
          <div class="layer-posts">
            <span v-for="n in l.posts" :key="n" class="post" :class="{ done: isDone(n) }">#{{ pad(n) }}</span>
          </div>
        </a>
      </div>

      <a :href="`#${base.id}`" class="layer layer-base">
        <div class="layer-head">
          <span class="layer-name">{{ base.name }}</span>
          <span class="layer-en">{{ base.en }}</span>
        </div>
        <div class="layer-parts">
          <code v-for="p in base.parts" :key="p">{{ p }}</code>
        </div>
        <div class="layer-posts">
          <span v-for="n in base.posts" :key="n" class="post" :class="{ done: isDone(n) }">#{{ pad(n) }}</span>
        </div>
      </a>

      <div class="arch-side">
        <a v-for="s in side" :key="s.name" :href="`#${s.id}`" class="side-item">
          <span class="layer-name">{{ s.name }}</span>
          <span class="side-parts">{{ s.parts.join(' · ') }}</span>
          <span class="layer-posts">
            <span v-for="n in s.posts" :key="n" class="post" :class="{ done: isDone(n) }">#{{ pad(n) }}</span>
          </span>
        </a>
      </div>
    </div>

    <figcaption class="arch-legend">
      <span><span class="post done">#00</span> 已有文章或草稿</span>
      <span><span class="post">#02</span> 计划中</span>
      <span>点击一层，跳到对应章节</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.arch-map {
  container-type: inline-size;
  margin: 20px 0 32px;
  border: 1px solid var(--x-border);
  border-radius: 10px;
  background: var(--x-panel);
  overflow: hidden;
  font-family: var(--vp-font-family-mono);
}
.arch-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--x-border);
  background: var(--x-panel-2);
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--x-border);
}
.arch-title {
  margin-left: 8px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.arch-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}
.arch-flow {
  font-size: 12px;
  color: var(--vp-c-text-3);
  padding-left: 2px;
}

/* 一层 = 名称 | 组件 | 文章编号 */
.layer {
  display: grid;
  grid-template-columns: 9.5rem 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--x-border);
  border-radius: 8px;
  background: var(--x-panel-2);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s, background-color 0.15s;
}
.layer:hover,
.side-item:hover {
  border-color: var(--vp-c-brand-1);
}
.layer:focus-visible,
.side-item:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.layer-outer {
  border-style: dashed;
}
.layer-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.layer-name {
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.layer-en {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}
.layer-parts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.layer-parts code {
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--x-border);
  background: var(--x-panel);
  color: var(--vp-c-text-2);
  white-space: nowrap;
}
.layer-posts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}
.post {
  font-size: 12px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--x-border);
  color: var(--vp-c-text-3);
  white-space: nowrap;
}
.post.done {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

/* 单个实例：把五层框在一起，表示它们在同一个进程组里 */
.instance {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 26px 10px 10px;
  border: 1px solid var(--vp-c-brand-soft);
  border-left: 3px solid var(--vp-c-brand-1);
  border-radius: 8px;
}
.instance-label {
  position: absolute;
  top: 6px;
  left: 12px;
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--vp-c-brand-1);
}

.arch-side {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 4px;
}
.side-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 8px 12px;
  border: 1px dashed var(--x-border);
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  transition: border-color 0.15s;
}
.side-parts {
  flex: 1;
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.arch-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 8px 14px;
  border-top: 1px solid var(--x-border);
  font-size: 12px;
  color: var(--vp-c-text-3);
}

/* 按组件自身宽度切换布局：正文区窄时（手机、开了侧栏的平板），名称和编号一行，组件另起一行 */
@container (max-width: 620px) {
  .arch-body {
    padding: 10px;
  }
  .layer {
    grid-template-columns: 1fr auto;
    gap: 8px 10px;
  }
  .layer-head {
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
  }
  .layer-parts {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .layer-posts {
    grid-column: 2;
    grid-row: 1;
  }
  .arch-side {
    grid-template-columns: 1fr;
  }
}

/* 手机宽度：去掉英文副标题，保证层名不折行 */
@container (max-width: 420px) {
  .layer-en {
    display: none;
  }
  .layer-name {
    white-space: nowrap;
  }
}
</style>
