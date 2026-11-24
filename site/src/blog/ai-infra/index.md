---
title: AI Infra 实战笔记 · 系列路线图
description: 低成本 AI Infra 实战：沿着 SGLang 的架构一层层拆开推理服务，每篇都附可复现的实测数据和云上花费。
---

<p class="post-eyebrow">// series · 中文</p>

# 系列路线图

本系列以 **SGLang** 为主线，按它的架构来组织：一个请求从 HTTP 进来，经过调度、显存管理、模型执行，再扩展到多卡和多实例。每一层对应几篇文章，每篇都对准代码里的一个具体组件。

编号就是阅读顺序：先跑起来、看清全貌，再沿着请求的路径往下走，最后走出单个实例。

- 🖥️ 本地：RTX 2070 8GB + WSL2，跑通流程、读源码、调试脚本
- ☁️ 云上：按小时租 GPU，出正式 benchmark。4090 起步，测多卡和 Hopper 特性时才上 A100 / H 系列

<ArchMap :done="[0]" />

## 为什么从 SGLang 开始

- RadixAttention、调度器、结构化输出、投机解码、PD 分离、Router 都在同一个代码库里，一条主线能从头讲到尾
- 代码以 Python 为主，调度逻辑集中在 Scheduler 里，读得动，「原理浅析」可以直接贴源码
- 微调也接得上：verl 等 RL 框架用 SGLang 做 rollout 引擎，最后做 GRPO 时，前面的调优经验能直接用

vLLM 不单独开线，放在「生态与对比」里。等读者理解了 SGLang 的每一层，再做同条件横评。

## 贯穿全系列的约定

- 性能文章一律用 `python -m sglang.bench_serving`，数据集固定为 `random`、`sharegpt`、`generated-shared-prefix` 三种，参数写进文章，后文好对比
- 模型档位固定：本地用 1.5B 级 FP16 小模型，云上用 8B 级稠密模型，MoE 文章换 30B-A3B 级
- 每篇在 EnvCard 里写 SGLang 版本和 commit，不同版本的结论不混用
- 2070 的硬限制照实写：Turing（sm75）不支持 BF16、FP8、FA3，部分量化 kernel 要求 sm80+。本地跑不了的特性写明原因，再到云上补测

## 前置：跑起来，看清全貌 {#layer-pre}

先把环境搭好、模型跑起来、学会怎么量，再用一篇把整个架构过一遍，后面每一篇都会回到这张图上。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 0 | [从零开始：在 8GB 显卡上搭环境、跑模型、做压测](./00-wsl2-sglang-env)（WSL2 + Docker、Turing 上的 `--dtype half`、bench_serving 与 TTFT / TPOT / ITL） | 🖥️ 本地 | 草稿 |
| 1 | 架构总览：一个请求经过哪些进程（TokenizerManager → Scheduler → ModelRunner → Detokenizer），各层之间怎么传数据 | 🖥️ 本地 | 计划中 |

## 调度层：Scheduler {#layer-scheduler}

决定每一步哪些请求进 batch、做 prefill 还是 decode。吞吐和延迟的取舍大多在这里。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 2 | 调度循环：continuous batching、chunked prefill 与调度策略（lpm / fcfs） | ☁️ 云上 | 计划中 |
| 3 | CPU 开销与 overlap scheduler：GPU 为什么会等 CPU | 🖥️ 本地 + ☁️ 云上 | 计划中 |
| 4 | 结构化输出：grammar backend 怎么接进调度和采样，xgrammar 的开销有多大 | 🖥️ 本地 | 计划中 |

## 显存与 KV 缓存层 {#layer-memory}

KV Cache 怎么分配、怎么复用、放不下时去哪。决定了能同时服务多少请求。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 5 | 显存账本：权重、KV Cache 内存池、CUDA Graph 各占多少，`--mem-fraction-static` 到底在切什么 | 🖥️ 本地 | 计划中 |
| 6 | RadixAttention：多轮对话、共享 system prompt、few-shot 下的前缀命中率实测 | ☁️ 云上 | 计划中 |
| 7 | HiCache：GPU 放不下的 KV Cache 溢出到内存，8GB 显卡上收益有多大 | 🖥️ 本地 + ☁️ 云上 | 计划中 |

## 执行层：ModelRunner {#layer-exec}

真正在 GPU 上跑前向的地方：kernel 选择、图捕获、量化、投机解码都在这一层。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 8 | Attention backend 与 CUDA Graph：FlashInfer / Triton / FA3 的取舍 | 🖥️ 本地 + ☁️ 云上 | 计划中 |
| 9 | 量化：FP8 / AWQ / GPTQ / KV Cache FP8，各自对显卡架构的要求 | 🖥️ 本地 + ☁️ 云上 | 计划中 |
| 10 | 投机解码：EAGLE 系列参数怎么调，接受率随 batch size 怎么变 | ☁️ 云上 | 计划中 |
| 11 | Multi-LoRA 服务：一个 SGLang 实例挂多个适配器 | 🖥️ 本地 + ☁️ 云上 | 计划中 |

## 并行层：一个实例跨多卡 {#layer-parallel}

模型或流量超出单卡时，怎么切分权重、请求和专家。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 12 | 稠密模型多卡：TP 与 DP 的配置与扩展性 | ☁️ 云上 | 计划中 |
| 13 | MoE 多卡：DP Attention 与 EP | ☁️ 云上 | 计划中 |

## 集群与运维层：走出单个实例 {#layer-cluster}

多个实例怎么分流量、拆阶段、上 K8s，以及怎么看清线上在发生什么。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 14 | 可观测性：`--enable-metrics` + Prometheus + Grafana 看板 | 🖥️ 本地 | 计划中 |
| 15 | 多副本与 Router：cache-aware 负载均衡 vs 轮询 | ☁️ 云上 | 计划中 |
| 16 | PD 分离：prefill 和 decode 拆到不同实例 | ☁️ 云上 | 计划中 |
| 17 | K8s 部署 SGLang 与自动扩缩容 | 🖥️ 本地 + ☁️ 云上 | 计划中 |

## 生态与对比 {#layer-eco}

SGLang 之外：和 vLLM 横评，以及微调、RL 怎么接回 SGLang。

| # | 主题 | 环境 | 状态 |
|---|---|---|---|
| 18 | SGLang vs vLLM 横评：同模型、同硬件、同压测脚本 | ☁️ 云上 | 计划中 |
| 19 | LoRA / QLoRA 微调 → SGLang 部署闭环（Unsloth / LLaMA-Factory） | 🖥️ 本地 | 计划中 |
| 20 | 小规模 GRPO：verl + SGLang rollout | ☁️ 云上 | 计划中 |

::: tip 写作约定
每篇遵循同一结构：要解决的问题 → 最小可运行示例 → 关键参数 → 实测数据 → 踩坑记录 → 原理浅析，文末附环境版本与云上花费。
:::
