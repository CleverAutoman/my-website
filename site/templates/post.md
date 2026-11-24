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

## 要解决的问题

## 最小可运行示例

## 关键参数

## 实测数据

<!-- <BenchChart :data="throughput" /> -->

## 踩坑记录

## 原理浅析

## 延伸阅读
