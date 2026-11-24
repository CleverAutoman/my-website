<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'

// 默认读取当前文章 frontmatter 里的 env，也可以通过 :env 直接传入
const props = defineProps<{ env?: Record<string, string | number> }>()
const { frontmatter } = useData()

const LABELS: Record<string, string> = {
  gpu: 'GPU',
  driver: 'Driver',
  cuda: 'CUDA',
  framework: 'Framework',
  model: 'Model',
  platform: 'Platform',
  cost: 'Cloud cost',
  date: 'Tested'
}

const rows = computed(() =>
  Object.entries(props.env ?? frontmatter.value.env ?? {})
    .filter(([, v]) => v !== '' && v != null)
    // YAML 会把不带引号的 2026-01-01 解析成 Date，序列化后变成 2026-01-01T00:00:00.000Z，这里转回 YYYY-MM-DD
    .map(([k, v]) => {
      const s = v instanceof Date ? v.toISOString() : String(v)
      const value = /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(s) ? s.slice(0, 10) : s
      return { key: k, label: LABELS[k] ?? k, value }
    })
)
</script>

<template>
  <div v-if="rows.length" class="vp-raw env-card">
    <div class="env-bar">
      <span class="dot" /><span class="dot" /><span class="dot" />
      <span class="env-title">test environment</span>
    </div>
    <dl class="env-grid">
      <div v-for="r in rows" :key="r.key" class="env-row" :class="{ cost: r.key === 'cost' }">
        <dt>{{ r.label }}</dt>
        <dd>{{ r.value }}</dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.env-card {
  margin: 20px 0 28px;
  border: 1px solid var(--x-border);
  border-radius: 10px;
  background: var(--x-panel);
  overflow: hidden;
  font-family: var(--vp-font-family-mono);
}
.env-bar {
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
.env-title {
  margin-left: 8px;
  font-size: 12px;
  color: var(--vp-c-text-3);
}
.env-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1px;
  margin: 0;
  background: var(--x-border);
}
.env-row {
  background: var(--x-panel);
  padding: 10px 14px;
  min-width: 0;
}
.env-row dt {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}
.env-row dd {
  margin: 2px 0 0;
  font-size: 13.5px;
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
}
.env-row.cost dd {
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
</style>
