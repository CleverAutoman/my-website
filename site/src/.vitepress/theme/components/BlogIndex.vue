<script setup lang="ts">
import { withBase } from 'vitepress'
import Icon from './Icon.vue'
import { posts } from '../data'
</script>

<template>
  <div class="vp-raw blog-index">
    <a v-for="p in posts" :key="p.href" class="row" :href="withBase(p.href)">
      <div class="meta">
        <span class="tag">{{ p.tag }}</span>
        <span v-if="p.status" class="status"><span class="live" /> {{ p.status }}</span>
      </div>
      <h3>{{ p.title }}</h3>
      <p>{{ p.summary }}</p>
      <span class="arrow"><Icon name="arrow" :size="18" /></span>
    </a>
  </div>
</template>

<style scoped>
.blog-index {
  display: grid;
  gap: 14px;
  margin-top: 24px;
}
.row {
  position: relative;
  display: block;
  padding: 20px 52px 20px 22px;
  border: 1px solid var(--x-border);
  border-radius: 12px;
  background: var(--x-panel);
  color: inherit;
  text-decoration: none;
  transition: border-color 0.2s;
}
.row:hover {
  border-color: var(--vp-c-brand-1);
}
.meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}
.tag {
  color: var(--vp-c-brand-1);
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-2);
}
.live {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}
h3 {
  margin: 8px 0 6px;
  font-size: 18px;
  font-weight: 600;
}
p {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}
.arrow {
  position: absolute;
  right: 20px;
  top: 22px;
  color: var(--vp-c-text-3);
  transition: color 0.2s, transform 0.2s;
}
.row:hover .arrow {
  color: var(--vp-c-brand-1);
  transform: translateX(3px);
}
</style>
