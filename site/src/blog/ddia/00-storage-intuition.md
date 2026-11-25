---
title: What is the size/speed of each I/O operation
description: 从 L1 缓存测到机械盘，算出一台机器每一层存储的阈值，再用这些数决定数据放哪层、内存配多少、fsync 怎么摊，给 DDIA 里"WAL 要 fsync""LSM 把随机写变顺序写"配上数量级
date: 2026-11-24
env:
  cpu: Intel i7-10875H · 8 核 · L1d 32 KiB / L2 256 KiB / L3 16 MiB
  memory: 32 GB DDR4-3200
  os: Windows 11（10.0.26200）· WSL2 内核 6.6.87.2
  nvme: WD PC SN730 512GB · NVMe · NTFS
  hdd: Seagate ST1000LM049 1TB · 2.5 寸 SATA · NTFS
  wsl: WSL2 ext4（ext4.vhdx，放在另一块 SN730 上）
  tool: C++17（g++ 15.2 -O2，WSL2 Ubuntu 26.04）· 自写 iolab · 单线程 QD1；原生 NVMe / HDD 列用 Go 1.20.5 版
  cost: ¥0
  date: 2026-11-24
---

<script setup>
import memStair from './data/io-mem-staircase.json'
import hierarchy from './data/io-hierarchy.json'
import tlb from './data/io-tlb.json'
import groupCommit from './data/io-group-commit.json'
import seqRand from './data/io-seq-rand.json'
</script>

<p class="post-eyebrow">// ddia</p>

# What is the size/speed of each I/O operation

<EnvCard />

::: tip TL;DR
- **每往下一层慢约 10 倍。** L1 1.3 ns → L2 4.5 ns → L3 11 ns → DRAM 约 100 ns → 命中 page cache 的 4 KiB 读 1 µs → NVMe 100 µs → 机械盘 17 ms（p50，本机实测）。[层级总览](#levels)
- **阈值 = 这一层装得下的范围。** 本机随机访问的数据不超过 32 KiB 在 L1，256 KiB 在 L2，2 MiB 以内稳定在 L3（名义 16 MiB，要和其他核、其他进程共用），再往上是 DRAM。访问涉及的 4 KiB 页超过 1536 个（6 MiB）时 TLB 装不下，每次访问再多 6 ns 以上。超过可用内存就要读盘；脏页超过可用内存的 20%，`write()` 会被卡住。[怎么算](#thresholds)
- **平均延迟按命中率加权，p99 看未命中率。** 机械盘上哪怕 1% 未命中，平均延迟也会涨 170 倍；未命中超过 1%，p99 就约等于盘的延迟。所以内存按"热数据全部装下"来配。[怎么算](#hit-rate)
- **`write()` 只写到内存，`fsync()` 才落盘。** write 要 2–7 µs；fsync 在 NVMe 上 0.4 ms，虚拟机里 2.2 ms，机械盘上 29 ms，单线程每秒最多分别约 2400、460、35 次持久化提交。[写入](#disk-write)
- **fsync 的成本几乎是固定的。** 一次 fsync 带 1 条还是 256 条记录，耗时差不多，吞吐差 250 倍，这就是 group commit。ext4 上覆盖已分配的区域比追加快 3 倍，所以 WAL 要预分配。[group commit](#group-commit)
- **顺序 vs 随机：** 机械盘上差 57 倍，NVMe 上只差 1.7 倍。随机访问的范围到几百 MiB 以上时用大页（1 GiB 时快 1.8 倍）。[选哪一层](#choose)
:::

## 发现了什么问题

DDIA 第 3 章（存储与检索）和第 7 章（事务里的持久性）反复出现这几句话：

- 写入先追加到 WAL，**fsync 之后**才算提交
- LSM-tree 把随机写变成顺序写，所以写吞吐高
- group commit 把多个事务的 fsync 合并成一次

书里给的是定性结论。真要判断一个设计划不划算，得知道量级：一次 fsync 是 1 µs、100 µs 还是 10 ms？顺序和随机差 2 倍还是 200 倍？拿到一台机器，热数据多大时还能留在内存里？

### 要回答的问题

拆开来，是这几个问题：

1. 从 L1 缓存到机械盘，每一层读一次要多久（p50 / p99）？每一层的**阈值**是多少，也就是随机访问的数据超过多大就掉到下一层？
2. 拿到一台机器，怎么算出这些阈值，再决定数据放在哪一层、内存配多少？
3. `write()` 和 `fsync()` 分别停在哪一层？fsync 这么贵，group commit 能省多少？
4. 盘上顺序和随机差多少？追加写和覆盖写，fsync 成本一样吗？

### 和直觉不一样的地方

测的过程中又冒出来几个和直觉不一样的现象，后面都会展开：

- L3 名义 16 MiB，单线程 4 MiB 就开始变慢，而且换成大页也一样，不是 TLB 的问题（[CPU 缓存](#cpu-cache)）
- 命中 page cache 的读比直接访问 DRAM 慢 10 倍（[page cache](#page-cache)）
- 机械盘的 write-through 写只要 0.63 ms，物理上不可能，是盘的写缓存在骗人（[写入](#disk-write)）
- 同型号的 SSD，放进虚拟机后 fsync 贵了 5 倍（[写入](#disk-write)）

### 测试环境

一台笔记本上的三种存储：

| 标签 | 是什么 |
| --- | --- |
| **NVMe** | WD SN730 NVMe SSD，Windows 原生 NTFS |
| **HDD** | Seagate ST1000LM049，2.5 寸 SATA 机械盘，NTFS |
| **WSL2** | WSL2 里的 ext4，底下是 Hyper-V 虚拟盘（vhdx 文件放在另一块 SN730 上），相当于一台虚拟机 |

测试程序是一个 600 行左右的 C++17 程序，只在 Linux（WSL2）里跑。Windows 原生的 NVMe 和机械盘这边没有 C++ 编译环境，用的是逻辑相同的 Go 版，下文凡是这两列的数字都来自 Go 版。

### 测法

#### 测试程序

代码在 `ddia-lab/io-intuition/cpp/iolab.cpp`，单文件，只依赖 POSIX 和 Linux 的系统调用（`fsync`、`fdatasync`、`O_DIRECT`、`O_DSYNC`、`mmap`、`madvise`、`memfd_create`）。核心就是下面这种循环：

```cpp
for (int i = 0; i < n; i++) {
  int64_t s = now_ns();                  // clock_gettime(CLOCK_MONOTONIC)
  pwrite(fd, buf, 4096, off_t(i) * 4096); // 拷进 page cache 就返回
  fsync(fd);                              // 等数据和元数据落盘
  lats.push_back(now_ns() - s);
}
```

跑法（在 WSL2 或任何 Linux 上）：

```bash
cd ddia-lab/io-intuition/cpp
g++ -O2 -std=c++17 -Wall -Wextra -o iolab iolab.cpp
./iolab --label wsl --out ../results/cpp-wsl-mem.jsonl mem         # CPU 缓存和内存，和盘无关
./iolab --dir ~/iotest --out ../results/cpp-wsl-ext4.jsonl ladder  # 也可以换成 group / rw / prealloc
./run.sh                                                           # 或者一次跑完全部
node ../make-charts.mjs                                            # 从结果生成文章里的图表数据
```

`--dir` 决定测试文件放在哪个文件系统上，也就是测的是哪块盘。Windows 原生的 Go 版在上一级目录（`go build -o iolab.exe .`，参数相同，用单横线）。

| 子命令 | 测什么 |
| --- | --- |
| `mem` | 随机指针追逐，工作集 8 KiB 到 1 GiB，测 L1 / L2 / L3 / DRAM 的访问延迟 |
| `tlb-alias` | 同一块 16 KiB 物理内存映射到 N 个虚拟页，只让 TLB 一个变量在变（仅 Linux） |
| `tlb` | 每页放一个指针节点，对比 4 KiB 页和 2 MiB 透明大页（大页仅 Linux） |
| `ladder` | 4 KiB：memcpy / write 进 page cache / write + fsync / O_DSYNC / O_DIRECT + O_DSYNC |
| `group` | 128 B 一条日志记录，每次 fsync 攒 1 到 4096 条 |
| `rw` | 2 GiB 文件上的 4K 顺序/随机读写（绕过缓存）、1M 顺序读、命中 page cache 的随机读 |
| `prealloc` | 追加写 + fsync，对比覆盖已分配区域 + fsync；Linux 上再加 fdatasync |

每个结果输出一行 JSON（p50 / p99 / 均值 / IOPS / MB/s），下面的图表都从这些 JSON 来。

#### 测试参数

- 块大小 4 KiB（数据库页、文件系统块的常见大小），group commit 每条记录 128 B
- **单线程，队列深度 1（QD1）**：任何时刻只有一个 I/O 在飞。所以这里的 IOPS 是"1 / 单次延迟"，不是 SSD 规格表上 QD32 的几十万 IOPS
- `rw` 用 2 GiB 文件，每项跑 5 秒；带 fsync 的单项各做 500 次
- 计时：C++ 版用 `clock_gettime(CLOCK_MONOTONIC)`，走 vDSO 不进内核，读一次约 22 ns，实测最小分辨率 100 ns；Windows 上的 Go 版用 QueryPerformanceCounter，分辨率也是 100 ns

#### 工具本身的坑

- **先测时钟。** Windows 上 Go 1.20 的 `time.Now` 精度只有约 0.5 ms，计时精度自检直接卡住（每次要等时钟跳一格，一百万次就是几百秒），拿它测几微秒的 write，结果全是 0 或 0.5 ms。Go 版改成直接调 `QueryPerformanceCounter`。
- **防止编译器把测量循环删掉。** `-O2` 下，结果没人用的循环可以被整个删除，比如往 `dst` 里 `memcpy` 两百万次却从不读 `dst`，测出来接近 0 不是因为快，而是代码根本没跑。办法是用 `asm volatile("" : : "r,m"(v) : "memory")` 告诉编译器"这个值被用了、内存被改了"。
- **（Go 版）用 `f.Fd()` 做 mmap 时，要让 `*os.File` 一直活着。** `os.File` 被 GC 回收时会自动关掉 fd，测试跑到一半 mmap 就报 `bad file descriptor`。加 `defer f.Close()` 或 `runtime.KeepAlive(f)`。C++ 版直接拿 `memfd_create` 返回的 fd，没有这个问题。
- **（Go 版）别在 Windows PowerShell 5.1 里用 `Get-Content | Set-Content` 改 UTF-8 源文件。** 它按系统代码页（GBK）读文件，中文注释直接乱码，还会吞掉换行，Go 编译器报 `expected 'package'`。

## 怎么解决这些问题

按存储层级从上往下走：先列出全部层级和每层的阈值怎么算，再一层层给实测数据、坑和用法。最后是盘，分写入、group commit、顺序与随机、追加写四节。

### 层级总览 {#levels}

#### 有哪些层

一份数据从 CPU 往外，依次可能放在这些地方（括号里是本机的容量）：

| 层级 | 本机容量 | 谁在管 | 断电后 |
| --- | --- | --- | --- |
| 寄存器 | 每核 16 个通用寄存器 | 编译器 | 丢 |
| L1d 缓存 | 32 KiB / 核 | CPU 硬件 | 丢 |
| L2 缓存 | 256 KiB / 核 | CPU 硬件 | 丢 |
| L3 缓存 | 16 MiB，8 核共享 | CPU 硬件 | 丢 |
| DRAM 内存 | 32 GB（DDR4-3200） | 操作系统、应用 | 丢 |
| page cache | DRAM 里的空闲部分 | 操作系统内核 | 丢 |
| NVMe SSD | 512 GB | 文件系统、盘的固件 | fsync 之后保留 |
| 机械盘 | 1 TB | 文件系统、盘的固件 | fsync 之后保留 |

page cache 物理上就是 DRAM，单独列一层是因为应用要通过系统调用才能访问它，代价完全不同。寄存器的访问藏在每条指令里，没法单独计时，下面从 L1 开始。

#### 每层读一次要多久

每层选一个代表点，读一次的延迟：

<BenchChart :data="hierarchy" :height="340" />

| 层级 | 测的是什么 | p50 | p99 | 相对 L1 |
| --- | --- | ---: | ---: | ---: |
| L1 | 工作集 16 KiB，读 8 字节 | 1.3 ns | 1.8 ns | 1× |
| L2 | 工作集 128 KiB | 4.5 ns | 12.0 ns | 3.4× |
| L3 | 工作集 512 KiB | 10.6 ns | 23.5 ns | 8× |
| DRAM | 工作集 64 MiB | 101 ns | 235 ns | 77× |
| page cache | 4 KiB `pread`，命中缓存 | 1.0 µs | 4.1 µs | 760× |
| WSL2 虚拟盘 | 4 KiB `pread`，O_DIRECT | 183 µs | 314 µs | 14 万× |
| NVMe SSD（原生，Go 版） | 4 KiB 读，绕过缓存 | 103 µs | 169 µs | 7.8 万× |
| 机械盘（原生，Go 版） | 4 KiB 读，绕过缓存 | 16.9 ms | 58.3 ms | 1 280 万× |

换个比例感受：如果一次 L1 访问是 1 秒，那么 L2 是 3.4 秒，L3 是 8 秒，DRAM 是 1 分多钟，从 page cache 读 4 KiB 要 13 分钟，从 NVMe 读要 **22 小时**，从机械盘读要 **5 个月**。

- **每往下一层，大约慢一个数量级**，而容量大两三个数量级。DDIA 里的各种存储引擎，本质上都在想办法让热数据留在更上面的层里。
- **SSD 和内存之间是最大的断崖**：DRAM 到 NVMe 差 1000 倍，NVMe 到机械盘又差 160 倍。B-tree 的一次查找如果要走 3 到 4 层页，每层都没命中缓存，在机械盘上就是 50 到 70 ms。虚拟盘又比原生 NVMe 慢 1.8 倍。
- **p99 和 p50 的距离也随层级拉大。** L1 的 p99 只比 p50 高 33%，page cache 高 4 倍，机械盘高 3.4 倍且绝对值到了 58 ms。层级越低，越要关心尾延迟。

### 每层的阈值怎么算 {#thresholds}

阈值就是"随机访问的数据超过多大，就掉到下一层"。

#### 从系统里读出规格

大部分规格能直接从 Linux 里读出来，再套公式。`ddia-lab/io-intuition/thresholds.sh` 把这些都打印出来，本机 WSL2 里的输出：

```
$ ./thresholds.sh
== CPU 缓存 ==
L1 Data          32K   共享它的逻辑 CPU: 0-1
L2 Unified      256K   共享它的逻辑 CPU: 0-1
L3 Unified    16384K   共享它的逻辑 CPU: 0-15

== 页大小 ==
基础页 4 KiB，大页 2.0 MiB，透明大页: always [madvise] never

== TLB 覆盖范围 = 条目数 × 页大小 ==
一级数据 TLB 64 条: 256 KiB
二级 TLB 1536 条:     6.0 MiB（基础页） / 3.0 GiB（大页）

== 内存 ==
总内存 15.5 GiB，当前可用 14.7 GiB：热数据超过可用内存，就会有一部分读要去盘上
脏页超过约 1.5 GiB（10%）：内核开始后台回写
脏页超过约 2.9 GiB（20%）：write() 被迫等回写，延迟从微秒级掉到盘的速度
```

数据来源：缓存大小读 `/sys/devices/system/cpu/cpu0/cache/index*/size`，页大小读 `getconf PAGESIZE` 和 `/proc/meminfo` 里的 `Hugepagesize`，内存读 `MemAvailable`，脏页阈值读 `sysctl vm.dirty_ratio` 和 `vm.dirty_background_ratio`。TLB 条目数 sysfs 里没有，脚本默认按这一代 Intel 核心的规格（64 / 1536），换了 CPU 要用环境变量覆盖，或者直接跑 `iolab tlb-alias` 测。WSL2 默认只分到宿主机一半的内存，所以这里是 15.5 GiB，不是 32 GB。

#### 阈值表

对照后面各层的实测，整理成一张表：

| 阈值 | 怎么算 | 本机 | 超过之后（实测） |
| --- | --- | ---: | --- |
| L1 | L1d 大小 | 32 KiB | 1.3 ns → 3 ns |
| L2 | L2 大小；一级 TLB 覆盖 64 × 4 KiB 也正好是这个数 | 256 KiB | → 10 ns 左右 |
| L3（实际可用） | 没有公式，比名义值小得多：要和其他核、其他进程共用。只能实测；多个核同时跑时，保守按 L3 ÷ 活跃核数估 | 名义 16 MiB，单线程实测 2 MiB 以内稳定 | 4 MiB 跳到约 70 ns，换成大页也一样 |
| 二级 TLB | 条目数 × 页大小（数的是不同的页，不是字节） | 6 MiB（4 KiB 页）/ 3 GiB（2 MiB 页） | 每次访问多 6 ns 以上；1 GiB 范围随机访问时，4 KiB 页比大页慢 1.8 倍 |
| 内存 | MemAvailable 减去进程自己要用的 | Windows 原生约 32 GB，WSL2 里 14.7 GiB | 4 KiB 读从 1 µs（page cache）掉到 100 µs（NVMe）或 17 ms（机械盘） |
| 脏页 | `dirty_ratio` × 可用内存 | 约 2.9 GiB | `write()` 从微秒级变成按盘的写速度 |

下面一层层看这些数是怎么测出来的，以及该怎么用。

### CPU 缓存：L1 / L2 / L3 {#cpu-cache}

#### 怎么测：随机指针追逐

申请一块大小为 W 的数组，每条 cache line（64 字节）开头存"下一跳"的下标，所有 line 串成一个随机顺序的环。每次读的地址都取决于上一次读出的值，CPU 没法并行发起访问，硬件预取器也猜不到下一跳，测到的就是一次访问的真实延迟。W 小于 32 KiB 时数据全在 L1，超过 16 MiB 后基本都要去 DRAM 取。

```cpp
// 用 mmap 申请，madvise 决定用 4 KiB 页还是 2 MiB 透明大页（必须在第一次写之前）
Region reg(ws, huge);                    // mmap + madvise(MADV_NOHUGEPAGE / MADV_HUGEPAGE)
int64_t* a = reg.a;
auto perm = sattolo(n, 1);               // 只有一个环的随机排列
for (size_t i = 0; i < n; i++) a[i * 8] = perm[i] * 8;   // 每条 cache line 开头存下一跳

int64_t p = 0;
while (now_ns() - t0 < 2e9) {
  int64_t s = now_ns();
  for (int j = 0; j < 4096; j++) p = a[p];  // 每次读都依赖上一次的结果
  lats.push_back(now_ns() - s);             // 记录 4096 次访问的总耗时
}
```

一次 L1 访问只有 1 ns 左右，而读一次时钟就要 22 ns，所以每个样本连续追 4096 次再取平均，p50 / p99 是这些样本的分位数。因为每个样本已经平均过，这里的 p99 比单次访问的尾延迟要平滑。每个工作集测两遍：一遍用 4 KiB 页，一遍用 2 MiB 大页，用来区分"数据在哪层缓存"和"地址翻译"这两个因素。

#### 结果：四段台阶

<BenchChart :data="memStair" :height="320" />

台阶很清楚：32 KiB 以内约 1.3 ns（L1），64 到 256 KiB 约 3 到 7 ns（L2），512 KiB 到 2 MiB 约 11 到 14 ns（L3），4 MiB 起跳到 70 ns 以上，16 到 64 MiB 约 90 到 100 ns（DRAM）。

#### L3 实际只有约 2 MiB 能用

L3 名义 16 MiB，单线程实际只稳定用到 2 MiB 左右。换成 2 MiB 大页后，4 MiB 处的跳变还在（69 ns 对 74 ns），说明这不是地址翻译的问题，而是 L3 本身就没那么多能用。最可能的原因是 L3 由 8 个核和其他进程共用（测试时桌面、浏览器、开发服务器都在跑），而且它的替换策略不是理想的 LRU。

::: warning 坑：别急着把台阶归因到 TLB
这篇的上一版写的是"L3 还没装满、4 MiB 起就变慢，是因为 TLB 装不下"。C++ 版加了 2 MiB 大页的对照组：大页下 TLB 覆盖 3 GiB，4 MiB 处照样跳到 69 ns，原来的解释是错的。一个解释站不站得住，要用一个只改变这一个因素的对照实验来检验。
:::

#### 怎么用：热结构压在几 MiB 以内

每个请求都要碰的小结构，比如哈希表的桶、B-tree 的上层节点、布隆过滤器，尽量压在几 MiB 以内，让它们留在 L2 / L3。布局紧凑，按 64 字节对齐，避免多个核写同一条 cache line。多个核同时跑时，每个核能分到的 L3 更少，按 L3 ÷ 活跃核数保守估。

### TLB 与大页 {#tlb}

上面的台阶里混着两件事：数据在哪一级缓存，以及地址翻译。程序用的是虚拟地址，每次访问内存，CPU 都要先把它翻译成物理地址。翻译结果缓存在 **TLB**（Translation Lookaside Buffer）里。TLB 很小，装不下时就要查页表，x86-64 的页表有 4 级。

#### 怎么单独测 TLB

为了单独测 TLB，用了一个小技巧：把**同一块 16 KiB 物理内存反复映射到 N 个不同的虚拟页**上，每一步随机读一个新的虚拟页。不管 N 多大，被读的数据都只有这 16 KiB，一直在 L1 里，变的只有"要翻译多少个不同的页"。

```cpp
int fd = memfd_create("iolab-tlb", 0);   // 一个 16 KiB 的匿名文件
ftruncate(fd, 16 << 10);
// 先占一段 N 页的虚拟地址，再用 MAP_FIXED 把同一个文件一段段铺上去
char* base = (char*)mmap(nullptr, n * 4096, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
for (size_t off = 0; off < n * 4096; off += 16 << 10)
  mmap(base + off, 16 << 10, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_FIXED | MAP_POPULATE, fd, 0);

static volatile int64_t g_zero = 0;
const int64_t mask = g_zero;             // 运行时是 0，但编译器不知道
// 地址 = 随机的页顺序 next[pos] + (上次读出的值 & 0)
// 每次读都要等上一次读完，又不需要在共享的物理页里存不同的指针
v = arr[next[pos] + (v & mask)];
```

`mask` 要从 `volatile` 全局变量里读出来：如果编译器知道它是 0，就会把 `v & mask` 化简掉，地址不再依赖上一次读出的值，CPU 就能同时发出好几个读，测到的是吞吐，不是延迟。

#### 结果：两个台阶

<BenchChart :data="tlb" :height="300" />

| 页数 | 地址范围 | p50 | p99 | 发生了什么 |
| ---: | ---: | ---: | ---: | --- |
| 8 – 64 | ≤ 256 KiB | 2.0 – 2.4 ns | 4.6 – 9.5 ns | 一级 TLB 全部命中 |
| 72 – 80 | 288 – 320 KiB | 3.6 – 4.6 ns | 9.6 – 10.5 ns | 超过一级 TLB 的 64 个条目，去二级 TLB 找 |
| 96 – 1408 | 384 KiB – 5.5 MiB | 4.6 – 4.7 ns | 11 – 14 ns | 二级 TLB 命中 |
| 1536 | 6 MiB | 5.7 ns | 17 ns | 二级 TLB 刚好装满 |
| 1664 – 4096 | 6.5 – 16 MiB | 10.9 – 12.5 ns | 23 – 28 ns | 超过二级 TLB 的 1536 个条目，每次都查页表 |
| 16384 – 131072 | 64 – 512 MiB | 16 – 31 ns | 34 – 64 ns | 页表本身也装不进 cache，查表越来越慢 |

基线 2.1 ns 比 L1 的 1.3 ns 高，是因为每一步还要取下一个页号、做一次加法，看增量就好：一级 TLB 未命中，每次访问多约 2.5 ns；二级也未命中，再多 6 ns 以上，是原来的 5 倍。

#### 阈值 = 条目数 × 页大小

两个台阶正好对应这一代 Intel 核心公布的 TLB 规格：一级数据 TLB 64 个条目，二级 TLB 1536 个条目。**阈值 = 条目数 × 页大小**：64 × 4 KiB = 256 KiB，1536 × 4 KiB = 6 MiB。Go 版测出来的台阶位置和这里完全一样，只是高度略有不同，说明这是硬件的性质，和语言无关。

注意这个阈值说的是**访问涉及多少个不同的页**，不是数据有多少字节。上一节图里 4 MiB 处的跳变不是它造成的：那里换成大页也照样跳。

::: warning 坑：测 TLB 时，数据量会悄悄跟着变
第一版每个页里放一个真实的指针节点：页数越多，数据也越多。而且节点在页内的偏移设计得不好，页数少时所有节点都落在每页的第 0 条 cache line，挤进同一个 L1 组。结果连 2 MiB 大页也在 8 MiB 处出现了台阶，可大页下 8 MiB 只占 4 个 TLB 条目，不可能是 TLB 的问题。改成把同一块物理内存映射到很多虚拟页之后，才只剩 TLB 一个变量。
:::

#### 大页把阈值往后推

2 MiB 的页，一个 TLB 条目管的范围是 4 KiB 页的 512 倍。下面是用透明大页（`madvise(MADV_HUGEPAGE)`）的对比，用 `/proc/self/smaps_rollup` 里的 `AnonHugePages` 确认大页确实生效了：

| 访问范围 | 数据布局 | 4 KiB 页 p50 / p99 | 2 MiB 大页 p50 / p99 |
| ---: | --- | ---: | ---: |
| 128 MiB | 每页只放一个节点 | 132 / 280 ns | 88 / 193 ns |
| 1 GiB | 每页只放一个节点 | 297 / 627 ns | 143 / 270 ns |
| 1 GiB | 节点紧挨着放（`mem` 测试） | 278 / 513 ns | 153 / 341 ns |

两种布局在 1 GiB 时都快了 1.8 到 2 倍。

#### 换一台机器会怎样

这些数字**不是所有机器都一样**：

- **阈值随 CPU 变。** 较新的 Intel 核心和 AMD Zen 2 / Zen 3 的二级 TLB 约 2048 个条目（对应 8 MiB），Zen 4 约 3072 个（12 MiB），具体以厂商手册为准。
- **页大小随系统变。** 有些 ARM64 Linux 发行版用 64 KiB 的基础页，Apple M 系列的 macOS 用 16 KiB；THP 设成 `always` 时，大块内存会自动用上 2 MiB 页。
- **台阶高度会变，位置不变。** 同一个物理核上的两个超线程共享 TLB；虚拟机里查页表要走 guest 和 host 两层，所以更贵。同样的布局、同样用 Go 版测，2048 页时 WSL2 是 22 ns，Windows 原生是 12.8 ns。
- **只对随机访问有意义。** 顺序扫描时，一次 TLB 未命中摊到一整页的 64 条 cache line 上，基本感觉不到。

在别的机器上，可以直接跑 `./iolab tlb-alias` 测出自己的阈值。

#### 怎么用：几百 MiB 以上用大页

随机访问的范围到几百 MiB 以上，或者每个页只碰一两次时，用大页：`madvise(MADV_HUGEPAGE)` 或 hugetlbfs。PostgreSQL 的 `huge_pages`、JVM 的 `-XX:+UseLargePages`、DPDK 都要用大页，原因就在这里：buffer pool 动辄几十 GB，随机访问时用 4 KiB 页几乎每次都会 TLB 未命中。

### DRAM：内存配多少 {#dram}

#### 延迟：约 100 ns，虚拟机里更贵

工作集超过 L3 之后，随机访问一次约 100 ns（16 到 64 MiB 时 90 到 100 ns）。再往上到几百 MiB，TLB 未命中叠加进来，4 KiB 页下 256 MiB 是 144 ns，1 GiB 是 278 ns。

- **虚拟机让这一段更贵。** 同样 256 MiB，Windows 原生（Go 版）是 96 ns。WSL2 是 Hyper-V 虚拟机，查一次页表要先走 guest 的页表，再走 host 的页表。
- **DRAM 段的数字不太稳定。** 同一台机器前一次跑，256 MiB 测出 243 ns，这一次 144 ns。这一段看量级就好，别抠具体数值。

#### 怎么用：内存按热数据来配

> 需要的内存 ≥ 热数据 + 索引和元数据 + 写缓冲 + 进程本身 + 余量

- **热数据**：按访问分布来估，比如"90% 的请求落在哪些 key 上"，再乘以每条记录的大小。不要按总数据量算。
- **索引和元数据**：B-tree 的上层节点、LSM 的布隆过滤器和索引块。这些每个请求都要访问，最好全部常驻内存。
- **写缓冲**：RocksDB 的 memtable、page cache 里的脏页。它们只能削峰：写入速度持续高于盘的写速度时，脏页很快涨到阈值（本机约 2.9 GiB），`write()` 就会被卡住。
- **余量**：经验上留 20–30%。有些操作会临时翻倍，比如 Redis 做快照时 `fork`，写时复制最坏要再占一份内存。

#### 挑内存硬件

- **先买容量，再看频率。** DDR4 到 DDR5 主要提升的是带宽，随机访问延迟一直在 80–100 ns 左右。对存储类的负载，热数据装不装得下，决定的是 100 ns 还是 100 µs，差 1000 倍。
- **数据库服务器用 ECC 内存。** 内存位翻转会悄悄改坏数据，而且校验和发现不了"写进去之前就已经错了"的数据。ECC 能纠正单比特错误。
- **多路服务器注意 NUMA。** 访问另一颗 CPU 上的内存更慢，可以用 `numactl` 或 `mbind` 把进程和内存绑在同一个节点。本机只有一颗 CPU，测不出这一项。

### page cache：系统调用的代价和命中率 {#page-cache}

#### 读：比直接访问 DRAM 慢 10 倍

测法是 4 KiB 随机 `pread`：在 2 GiB 文件里随机挑 4 KiB 对齐的位置读，每次单独计时，测之前先把文件完整读一遍。

**命中 page cache 的读要 1.0 µs（p99 4.1 µs），比直接访问 DRAM 慢 10 倍。** 数据在同一块内存里，差距全在系统调用：进出内核、查找页、拷贝 4 KiB。这就是为什么数据库要在用户态再做一层 buffer pool，而不是每次都 `read()`。Windows 原生上这一步要 5.4 µs，系统调用路径本身就比 Linux 慢 5 倍。

#### 写：脏页阈值

`write()` 进 page cache 要 1.8 µs（WSL2）到 6.6 µs（NVMe 上的 NTFS）。这些脏页不会一直待在内存里：超过可用内存的 10%（本机约 1.5 GiB）内核开始后台回写，超过 20%（约 2.9 GiB）新的 `write()` 就要等回写，延迟掉到盘的速度。

::: warning 坑：读测试很容易测成内存
刚写完的 2 GiB 文件还在 page cache 里，普通读出来就是 5 µs，看起来像"超快的盘"。测盘必须用 `O_DIRECT` / `FILE_FLAG_NO_BUFFERING` 绕过缓存，缓冲区地址、长度、偏移都要按 4 KiB 对齐，否则调用直接报 `EINVAL`。C++ 里用 `posix_memalign(&p, 4096, n)` 分配；Go 的 `make([]byte)` 不保证对齐，要多分配 4 KiB 再手动找对齐的起点。
:::

#### 命中率怎么换算成延迟 {#hit-rate}

一次访问的平均延迟，就是各层延迟按命中比例加权：

> 平均延迟 = Σ（落在这一层的比例 × 这一层的延迟）

以 4 KiB 随机读为例，page cache 命中用 Linux 上测的 1.0 µs，未命中就去盘上读（用层级总览里的 p50）：

| page cache 命中率 | 盘是 NVMe（103 µs） | 盘是机械盘（16.9 ms） |
| ---: | ---: | ---: |
| 100% | 1.0 µs | 1.0 µs |
| 99% | 2.0 µs | 170 µs |
| 90% | 11 µs | 1.7 ms |

- **盘越慢，越要求热数据全部在内存里。** 机械盘上未命中一次的代价是命中的 17000 倍，1% 未命中就让平均延迟涨 170 倍；NVMe 上翻一倍，90% 的命中率是 11 µs，也还能接受。
- **p99 看的是未命中率，不是平均值。** 只要未命中超过 1%，第 99 百分位的请求就一定落在盘上，p99 约等于盘的延迟：NVMe 100–170 µs，机械盘 17–58 ms。想控制 p99，要么让未命中率低于 1%，要么换更快的盘。

#### 用 page cache 还是自建 buffer pool

page cache 是双刃剑。命中只要 1 到 5 µs，所以 Kafka 之类的系统直接依赖 OS 缓存；但它也让"写成功"和"已持久化"分离，所以 InnoDB 通常配成 O_DIRECT，自己管 buffer pool，PostgreSQL 则走 page cache 再加 fsync。

### 盘：写入要等到哪一层 {#disk-write}

#### 几种"写完了"

几种"写完了"的程度，以及在两个系统上分别怎么调用：

| 手段 | Linux | Windows | 返回时数据在哪 |
| --- | --- | --- | --- |
| 普通写 | `write(2)` | `WriteFile` | page cache（内核内存），断电会丢 |
| fsync | `fsync(2)` | `FlushFileBuffers` | 文件数据和元数据都落盘，并要求盘清空易失写缓存 |
| fdatasync | `fdatasync(2)` | 无 | 同上，但跳过 mtime 这类读回数据时用不到的元数据 |
| 同步写 | `O_DSYNC` | `FILE_FLAG_WRITE_THROUGH` | 每次 write 都等落盘，通常靠 FUA（Force Unit Access）实现 |
| 直接 I/O | `O_DIRECT` | `FILE_FLAG_NO_BUFFERING` | 绕过 page cache；缓冲区地址、长度、偏移都要按扇区对齐 |

#### 一次写入经过的层

一次 `write()` + `fsync()` 要经过这几层：

```flow title="一次写入经过的层"
{
  "nodes": [
    {"id":"app","text":"应用内存\n用户态 buffer","shape":"rect","x":0,"y":0,"w":260,"h":60,"lock":true},
    {"id":"pc","text":"Page Cache\n内核内存里的脏页","shape":"rect","tone":"violet","fill":true,"x":0,"y":110,"w":260,"h":60,"lock":true},
    {"id":"fs","text":"文件系统日志与元数据\next4 jbd2 · NTFS $LogFile","shape":"rect","tone":"blue","fill":true,"x":0,"y":220,"w":260,"h":60,"lock":true},
    {"id":"dc","text":"盘内写缓存\n易失 DRAM","shape":"rect","tone":"brand","fill":true,"x":0,"y":330,"w":260,"h":60,"lock":true},
    {"id":"media","text":"介质\nNAND 闪存 / 盘片","shape":"rect","tone":"green","fill":true,"x":0,"y":440,"w":260,"h":60,"lock":true},
    {"id":"n1","text":"write() 拷到这里就返回：2–7 µs","shape":"text","x":300,"y":128},
    {"id":"n2","text":"fsync() 刷脏页、提交日志，再发 FLUSH","shape":"text","x":300,"y":238},
    {"id":"n3","text":"O_DSYNC 走 FUA：单次写直达介质（理论上）","shape":"text","x":300,"y":348},
    {"id":"n4","text":"断电后只有这一层的数据还在","shape":"text","x":300,"y":446},
    {"id":"n5","text":"fsync 走完全程：NVMe 0.4 ms · WSL2 2.2 ms · HDD 29 ms","shape":"text","x":300,"y":474}
  ],
  "edges": [
    {"from":"app","to":"pc","label":"write"},
    {"from":"pc","to":"fs","label":"fsync"},
    {"from":"fs","to":"dc"},
    {"from":"dc","to":"media","label":"FLUSH / FUA"}
  ]
}
```

fsync 要做三件事：把这个文件的脏页写下去；把相关元数据通过文件系统日志提交；最后给盘发一个 FLUSH，让盘把易失写缓存里的东西写到介质。每一步都要等盘回应，所以 fsync 等于好几次设备往返，再加一次整盘缓存刷新。

#### 实测：write 和 fsync 差多少

| 4 KiB 写，p50 / p99 | NVMe（Go 版） | 机械盘（Go 版） | WSL2（C++ 版） |
| --- | ---: | ---: | ---: |
| write 进 page cache | 6.6 / 31 µs | 5.9 / 66 µs | 1.8 / 41 µs |
| write + O_DSYNC | 123 / 261 µs | 0.63 / 2.1 ms ⚠ | 2.02 / 3.74 ms |
| write + O_DIRECT + O_DSYNC | 102 / 224 µs | 0.63 / 2.4 ms ⚠ | 2.02 / 4.93 ms |
| **write + fsync** | **405 / 595 µs** | **28.9 / 404 ms** | **2.16 / 25.7 ms** |

⚠ 机械盘上 O_DSYNC 的数字被盘内写缓存吸收了，不是真的落到盘片，见下面的坑。WSL2 的 fsync p99 有 25.7 ms，500 次里有几次很慢的，Go 版上一次测是 3.0 ms，虚拟盘的尾延迟不太稳定。

- **`write()` 返回只说明数据进了内核内存。** 只要几微秒，和 fsync 差 60 倍（NVMe）到 5000 倍（HDD）。没有 fsync 的"写入成功"，进程崩溃不会丢（数据在内核里），机器断电会丢。
- **fsync 决定了单线程持久化提交的上限。** NVMe 上一次 0.4 ms，每秒最多约 2400 次；机械盘一次 29 ms，每秒最多约 35 次。如果数据库每个事务都单独 fsync，这就是机械盘上的 TPS 上限。
- **虚拟化让 fsync 贵了 5 倍多。** WSL2 和原生 NVMe 用的是同型号的盘，fsync 却从 0.4 ms 涨到 2.2 ms：guest 里的 ext4 先提交日志，虚拟盘把 flush 转给 Hyper-V，宿主机再写 vhdx 文件并刷盘。在虚拟机或云盘上跑数据库，付的就是这一层的钱。WSL2 里 O_DSYNC 和 fsync 几乎一样慢，因为每个同步写在宿主机上都变成了一次完整的 flush。
- **尾延迟同样随层级放大。** 机械盘 fsync 的 p99 到了 404 ms，是 p50 的 14 倍；一个每次提交都 fsync 的服务，每 100 个请求就有一个要等将近半秒。

::: warning 坑：write-through 不等于真的落盘
HDD 上 `FILE_FLAG_WRITE_THROUGH` 的 4K 写只要 0.63 ms，比 fsync 快 45 倍。这在物理上不可能：每次 4K 写都是同一磁道上的下一个位置，真的写到盘片就得等盘片再转一圈（8 ms 以上）。合理的解释是这次写停在了盘内的 DRAM 写缓存里，FUA 要么没发下去，要么盘没理会。`FlushFileBuffers` 发的是整盘 flush，测出来的 29 ms 才符合物理。教训：**用物理极限检查测量结果**，延迟低于一次机械动作的"持久化"写，就不是持久化。DDIA 第 7 章说完美的持久性不存在，原因之一就是盘的固件可能会骗你。
:::

#### 怎么用：持久要等到哪一层

"持久"取决于你等到哪一层。write 返回、fsync 返回、副本确认，是三种不同强度的承诺。很多系统（比如 Kafka 默认配置）根本不对每条消息 fsync，而是靠多副本来保证不丢，这是用网络往返换磁盘往返。要每次都 fsync，就用下面的 group commit 把它摊薄。

### 盘：group commit {#group-commit}

#### 实测：fsync 的成本几乎是固定的

<BenchChart :data="groupCommit" :height="320" />

同一组数据，换成"每次 fsync 本身花多久"：

| 每次 fsync 攒的记录数 | 1 | 16 | 256 | 1024 | 4096 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 本批数据量 | 128 B | 2 KiB | 32 KiB | 128 KiB | 512 KiB |
| NVMe 每次耗时 p50 | 0.43 ms | 0.41 ms | 0.43 ms | 0.49 ms | 0.81 ms |
| NVMe 记录/秒 | 2.2 千 | 3.6 万 | 55 万 | 196 万 | 406 万 |
| HDD 每次耗时 p50 | 29 ms | 29 ms | 22 ms | 34 ms | 43 ms |
| HDD 记录/秒 | 23 | 415 | 9.4 千 | 2.3 万 | 5.3 万 |
| WSL2 每次耗时 p50 | 1.6 ms | 1.9 ms | 2.0 ms | 2.4 ms | 3.0 ms |
| WSL2 记录/秒 | 596 | 8.1 千 | 12 万 | 41 万 | 130 万 |

NVMe 和 HDD 两行是 Windows 原生的 Go 版，WSL2 两行是 C++ 版。

从 1 条攒到 256 条，每次 fsync 的耗时几乎不变，吞吐却涨了约 250 倍。直到一批达到几百 KiB，写数据本身的带宽才开始拖慢 fsync。

这就是 group commit 的全部道理：**fsync 的代价主要是"往返一次盘"，和这次带了多少字节关系不大**，所以把很多事务的日志攒在一起刷一次。

#### 实际系统怎么做



- PostgreSQL 的 `commit_delay` / `commit_siblings`：提交前稍等一下，让并发事务的 WAL 搭同一次 flush
- MySQL InnoDB 的 binlog group commit
- RocksDB 的 write group：并发写入中选一个 leader，把大家的 WriteBatch 合成一次 WAL write + fsync

代价是延迟：攒批意味着单个事务要等别人。吞吐和延迟的取舍在这里第一次出现，后面讲复制、分区时会一再遇到。

::: warning 坑：别每条记录调一次 write()
第一版每条记录单独调一次 `write()`。Windows 上一次 `WriteFile` 要 6 µs 左右，攒 1024 条就多了 6 ms 的系统调用开销，NVMe 上 batch=1024 只测出 18 万条/秒。改成像真实 WAL 那样先在用户态拼成一块再写一次，变成 196 万条/秒，差 11 倍。系统调用本身也是微秒级的成本，WAL 实现都会在用户态先攒 buffer。
:::

#### 怎么用：按吞吐倒推攒批大小

按"每秒要持久化多少条"倒推每次 fsync 要攒多少条：NVMe 上一次 fsync 0.4 ms，要 10 万条/秒就得每次攒 40 条以上；机械盘上一次 29 ms，理论上要攒 2900 条，但一批几百 KiB 时 fsync 本身也涨到 40 ms 左右，实测每次攒 4096 条也只有 5.3 万条/秒，单条提交的延迟还跟着到 40 ms 以上。

### 盘：顺序 vs 随机 {#seq-rand}

#### 实测：机械盘差 57 倍，SSD 差 1.7 倍

<BenchChart :data="seqRand" :height="320" />

| QD1，4 KiB，绕过缓存 | NVMe（Go 版） | HDD（Go 版） | WSL2（C++ 版） |
| --- | ---: | ---: | ---: |
| 顺序读 | 15.1 千 IOPS（p50 60 µs） | 3.1 千（146 µs） | 7.0 千（134 µs） |
| 随机读 | 9.1 千（103 µs） | **55（16.9 ms）** | 5.2 千（183 µs） |
| 随机读比顺序读慢 | 1.7 倍 | **57 倍** | 1.4 倍 |
| 1 MiB 顺序读 | 2.19 GB/s | p50 每块 8.3 ms ≈ 120 MB/s | 1.52 GB/s |
| 4K 顺序写 + O_DSYNC | 18.4 千 | 3.6 千 ⚠ | 1.47 千 |
| 4K 随机写 + O_DSYNC | 18.7 千 | 558 ⚠ | 1.52 千 |

#### 机械盘和 SSD 为什么差这么多

- **机械盘上，随机读一次 17 ms**，基本就是磁头寻道加上等盘片转到位（转一圈 8 到 11 ms）。顺序读 4K 只要 146 µs，因为盘内的预读缓存已经把后面的扇区读进来了。按带宽算差距更大：随机 4K 只有 0.2 MB/s，顺序 1M 约 120 MB/s，差 500 倍以上。DDIA 第 3 章说 log-structured 的设计"在磁盘上把随机写变成顺序写"，指的就是这个差距。
- **NVMe 上随机读只比顺序读慢 1.7 倍**，没有寻道这回事。所以在 SSD 上，LSM 和 B-tree 的取舍主要不在"顺序还是随机"，而在写放大、SSD 内部的垃圾回收和总写入带宽。这个 5 秒的小测试测不出 GC 的影响，写满盘、长时间压测才看得到。
- **NVMe 上 4K 随机写 + O_DSYNC 只要约 50 µs，比 fsync 的 405 µs 便宜 8 倍。** 单个 FUA 写很快，fsync 贵在它要走完文件系统日志，再让整块盘清一次写缓存。
- QD1 下 NVMe 只有 9 千随机读 IOPS，规格表上的几十万 IOPS 要几十个并发请求才能达到。真实数据库会用多线程或 io_uring 并发发 I/O，IOPS 能涨上去，单次延迟不会变。

#### 怎么用：机械盘只做顺序，SSD 重在并发

机械盘只做大块顺序读写（本机约 120 MB/s），不放随机访问的数据。NVMe 上不必为了"顺序"牺牲太多设计，读写尽量成批、并发发出去更重要。

### 盘：追加写 vs 覆盖已分配的区域 {#append}

#### 实测：ext4 上覆盖快 3 倍

| 4 KiB + 同步，p50 | NVMe（NTFS，Go 版） | HDD（NTFS，Go 版） | WSL2（ext4，C++ 版） |
| --- | ---: | ---: | ---: |
| 追加 + fsync | 409 µs | 28.8 ms | 1.97 ms |
| 覆盖已分配区域 + fsync | 412 µs | 37.5 ms | **0.65 ms** |
| 追加 + fdatasync | 无 | 无 | 1.77 ms |
| 覆盖已分配区域 + fdatasync | 无 | 无 | **0.60 ms** |

#### 为什么追加更慢

ext4 上，覆盖已经分配好的块比追加快 3 倍。追加会改文件长度和 extent 映射，这些元数据必须通过 jbd2 日志提交，一次 fsync 变成"写数据 + 写日志 + 写提交块 + flush"；覆盖已分配的块只需要写数据再 flush。fdatasync 在追加时也帮不上忙，因为文件长度是读回数据必需的元数据，照样要提交。

NTFS 上两者没有差别：`FlushFileBuffers` 每次都会刷 NTFS 自己的日志。HDD 那一列的覆盖写反而更慢，但 p99 到了几百毫秒，抖动太大，不要从中读出结论。

::: warning 坑：预分配要真的写过
`prealloc` 测试没用 `fallocate`：ext4 上 fallocate 出来的是 unwritten extent，第一次写入时还要把它转成已写状态，又是一次元数据修改。这里是先写满零并 fsync，再测覆盖写。
:::

#### 怎么用：预分配并复用日志文件

日志文件预分配并复用，让每次 fsync 不必带上元数据日志。PostgreSQL 的 WAL 是固定 16 MB 的段文件，用完回收改名重用；RocksDB 有 `recycle_log_file_num`。

## 结论

### 选哪一层 {#choose}

| 数据 | 放在哪 | 怎么做 |
| --- | --- | --- |
| 每个请求都要碰的小结构：哈希表的桶、B-tree 上层节点、布隆过滤器 | L2 / L3（几 MiB 以内） | 布局紧凑，按 64 字节对齐，避免多个核写同一条 cache line |
| 几 MiB 到几十 GiB，随机访问 | DRAM | 访问范围到几百 MiB 以上，或者每个页只碰一两次时，用大页（本机 1 GiB 时快 1.8 倍） |
| 比内存稍大，读多写少 | page cache 或自建 buffer pool | 按命中率算平均延迟和 p99 够不够 |
| 远大于内存 | NVMe | 读写尽量成批、顺序（LSM、批量 compaction），用 io_uring 提高并发 |
| 冷数据、归档、顺序扫描 | 机械盘 | 只做大块顺序读写（本机约 120 MB/s），不放随机访问的数据 |
| 必须不丢 | fsync 之后的盘 | 用 group commit 摊薄 fsync，预分配 WAL 段，或者靠多副本 |

### 拿到一台新机器怎么做

顺序是：跑 `thresholds.sh` 和 `iolab tlb-alias` 得到阈值 → 估热数据有多大、落在哪一层 → 用命中率算平均延迟和 p99 → 按"热数据全部装下"配内存 → 持久化路径按 fsync 的固定成本决定攒批大小。

### 值得记住的量级

本机实测，QD1，4 KiB：

| 操作 | 量级 |
| --- | --- |
| L1 / L2 / L3 缓存访问 | 约 1.3 / 4.5 / 11 ns |
| TLB 未命中、查页表 | 每次多约 6–30 ns（访问的 4 KiB 页超过 1536 个时） |
| DRAM 随机访问 | 约 100 ns |
| 系统调用 write 进 page cache / 命中 cache 的读 | 1–7 µs |
| NVMe 随机读、单次 FUA 写 | 50–100 µs |
| NVMe fsync | 约 0.4 ms |
| 虚拟机里的 fsync | 约 2 ms |
| 机械盘随机读 | 约 17 ms |
| 机械盘 fsync | 约 30 ms |

### 放回 DDIA 的语境

- **"持久"取决于你等到哪一层。** write 返回、fsync 返回、副本确认，是三种不同强度的承诺。
- **WAL + group commit**：日志顺序追加，fsync 的固定成本靠攒批摊薄。
- **LSM vs B-tree**：在机械盘上，顺序和随机差两到三个数量级，LSM 把随机写变成顺序写的收益巨大；在 SSD 上差距只有一两倍，取舍转向写放大和 SSD 寿命。
- **预分配日志段**：避免每次 fsync 都带上元数据日志。
- **buffer pool vs page cache**：page cache 命中也要 1 µs，比 DRAM 慢 10 倍，而且"写成功"不等于"已持久化"。自己管缓存的引擎（InnoDB 配 O_DIRECT）和依赖 OS 缓存的系统（Kafka、PostgreSQL）是在这里做了不同的取舍。

## 延伸阅读

- DDIA 第 3 章"存储与检索"（LSM-tree、B-tree、WAL），第 7 章"事务"里关于持久性的部分
- [PostgreSQL's fsync() surprise](https://lwn.net/Articles/752063/)（LWN）：2018 年的 "fsyncgate"，fsync 报错之后再调一次并不安全
- [Files are hard](https://danluu.com/file-consistency/)（Dan Luu）：文件系统一致性和崩溃恢复有多难做对
- [PostgreSQL 文档：WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html)：`commit_delay`、`wal_sync_method` 等参数
- [RocksDB Wiki：Write Ahead Log](https://github.com/facebook/rocksdb/wiki/Write-Ahead-Log-(WAL))
- [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832)：和本文的实测数字对照着看
