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
