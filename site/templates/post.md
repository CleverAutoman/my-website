---
title: 文章标题
description: 一句话说明这篇解决什么问题
date: 2026-01-01
env:
  gpu: RTX 4090 24GB
  driver: 550.xx
  cuda: '12.4'
  framework: vLLM 0.x.x
  model: Qwen2.5-7B-Instruct
  platform: AutoDL
  cost: ¥0
  date: 2026-01-01
---

<!--
使用方法：复制到 src/blog/ai-infra/ 下并重命名（如 01-wsl2-cuda-setup.md），
侧边栏会按文件名自动生成。更方便的是在 dev 下打开 /my-website/_dev/editor 用「新文章」创建。
组件效果和 JSON 格式见本地 dev 下的 /_dev/components 页面。
-->

<script setup>
// 实测数据放在同目录的 data/ 下，例如：
// import throughput from './data/xx-throughput.json'
</script>

<p class="post-eyebrow">// ai infra · 第 N 篇</p>

# 文章标题

<EnvCard />

::: tip TL;DR
- 结论先行：三到六条，每条带一个关键数字
:::

## 发现了什么问题

<!-- 遇到的现象或书里的结论，拆成几个要回答的具体问题；测试环境和测法也放这里 -->

## 怎么解决这些问题

<!-- 按问题或层级分小节：每节给实测数据、阈值怎么算、怎么用；踩过的坑放进对应的小节 -->

<!-- <BenchChart :data="throughput" /> -->

## 结论

<!-- 决策表、量级表，以及放回原来语境里的含义 -->

## 延伸阅读
