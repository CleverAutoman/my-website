<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, withBase } from 'vitepress'

const route = useRoute()
const path = computed(() => route.path || '/')
const links = [
  { label: 'Home', href: '/' },
  { label: 'Blog', href: '/blog/' },
  { label: 'AI Infra 实战笔记', href: '/blog/ai-infra/' },
  { label: 'Projects', href: '/#projects' }
]
</script>

<template>
  <div class="nf">
    <div class="term">
      <div class="bar">
        <span class="dot" /><span class="dot" /><span class="dot" />
        <span class="title">python serve.py — 404</span>
      </div>
      <pre class="out"><span class="cmd">$ curl -sI {{ path }}</span>
<span class="dim">HTTP/1.1</span> <span class="err">404 Not Found</span>

<span class="dim">Traceback (most recent call last):</span>
<span class="dim">  File "router.py", line 404, in resolve</span>
<span class="dim">    page = kv_cache.allocate(path)</span>
<span class="err">torch.cuda.OutOfMemoryError</span>: CUDA out of memory. Tried to allocate 1 page for
'<span class="hl">{{ path }}</span>' but it does not exist in the route table. 0 B reserved,
0 B allocated. If this link used to work, the page may have moved.</pre>
    </div>
    <p class="hint">Try one of these instead:</p>
    <nav class="links" aria-label="Suggested pages">
      <a v-for="l in links" :key="l.href" :href="withBase(l.href)">{{ l.label }} →</a>
    </nav>
  </div>
</template>

<style scoped>
.nf {
  max-width: 760px;
  margin: 0 auto;
  padding: 72px 24px 96px;
}
.term {
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
  overflow: hidden;
  box-shadow: 0 24px 60px -24px var(--x-shadow);
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--x-border);
  background: var(--x-panel-2);
  font-family: var(--vp-font-family-mono);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--x-border);
}
.title {
  margin-left: 10px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.out {
  margin: 0;
  padding: 20px 22px;
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--vp-c-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.cmd {
  color: var(--vp-c-text-2);
}
.dim {
  color: var(--vp-c-text-3);
}
.err {
  color: var(--x-err);
  font-weight: 600;
}
.hl {
  color: var(--vp-c-brand-1);
}
.hint {
  margin: 28px 0 10px;
  color: var(--vp-c-text-2);
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.links a {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--x-border);
  background: var(--x-panel);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: border-color 0.2s, color 0.2s;
}
.links a:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}
@media (max-width: 640px) {
  .nf {
    padding: 40px 16px 72px;
  }
  .out {
    font-size: 12.5px;
    padding: 16px;
  }
}
</style>
