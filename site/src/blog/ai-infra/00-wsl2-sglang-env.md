---
title: 从零开始：在 8GB 显卡上搭环境、跑模型、做压测
description: 一台装着 RTX 2070 的 Windows 电脑：从驱动到容器搭好 SGLang 环境，在 8GB 显存上跑起第一个模型，再学会用 bench_serving 量出 TTFT、TPOT 和吞吐
date: 2026-11-17
sidebar: 00 · 从零开始：环境、跑模型、压测
env:
  gpu: RTX 2070 8GB（sm75）
  driver: 616.56（支持 CUDA 13.4）
  cuda: 13.0（镜像自带，PyTorch 2.14.1+cu130）
  framework: SGLang 0.5.23（297e54f，Docker 镜像）
  model: 待定（环境部分不加载模型）
  platform: 本地 · Windows 11 + WSL 2.5.9 + Docker Desktop 28.3
  cost: ¥0
  date: 2026-11-17
---

<p class="post-eyebrow">// ai infra · 第 0 篇</p>

# 从零开始：在 8GB 显卡上搭环境、跑模型、做压测

<EnvCard />

::: warning 草稿
这篇分三部分，目前只完成了第一部分：

1. 搭环境：Windows + WSL2 + Docker，把 SGLang 镜像跑起来（已完成，就是下面的内容）
2. 跑模型：在 8GB 的 2070 上启动第一个模型，处理 Turing 不支持 BF16 等问题（待写）
3. 做压测：用 bench_serving 量出 TTFT / TPOT / ITL 和吞吐，后面所有文章都按这套方法测（待写）
:::

## 要解决的问题

SGLang 只支持 Linux。它依赖的 sgl-kernel、FlashInfer 和 PyTorch 都绑定了 CUDA 13，在 Windows 上直接 pip 安装走不通。可行的路线只有一条：

```
Windows NVIDIA 驱动 → WSL2 虚拟机 → Docker（nvidia runtime）→ SGLang 官方镜像
```

第一部分的终点：在容器里 `torch.cuda.is_available()` 返回 True，`sglang.check_env` 能正常输出。加载模型、启动服务是第二部分的事。

这条链路有四层，哪层都可能出问题，所以下面每一步先验证上一层，没问题再往下走。

## 最小可运行示例

### 1. Windows 驱动：要支持 CUDA 13

SGLang 从 v0.5.20 起只发布 CUDA 13 镜像，最后一个 CUDA 12 镜像是 `v0.5.19-cu129`。所以宿主机驱动必须支持 CUDA 13。在 PowerShell 里看右上角的 `CUDA UMD Version`：

```powershell
nvidia-smi
```

```
| NVIDIA-SMI 616.56                 KMD Version: 616.56        CUDA UMD Version: 13.4     |
|   0  NVIDIA GeForce RTX 2070      WDDM  |   00000000:01:00.0  On |                  N/A |
| N/A   60C    P0             52W /  115W |    1123MiB /   8192MiB |     51%      Default |
```

这里显示的是驱动**支持的最高** CUDA 版本，不代表装了 CUDA Toolkit。Windows 上不需要装 Toolkit，CUDA 运行时由镜像自带。

注意这一行里的 `1123MiB`：这张卡同时在给桌面出图，空闲时就已经被 Windows 占掉 1 GB 左右，实际能给 SGLang 用的不到 8 GB。第 5 篇算显存账时会用到这个数。

### 2. WSL2：版本和发行版

```powershell
wsl --update
wsl -l -v
wsl --version
```

```
  NAME              STATE           VERSION
* docker-desktop    Running         2
  Ubuntu            Stopped         2

WSL 版本: 2.5.9.0
内核版本: 6.6.87.2-1
```

`VERSION` 必须是 2。WSL1 没有 GPU 支持。

进入 Ubuntu，确认 GPU 能看到：

```bash
nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap --format=csv
ls /usr/lib/wsl/lib | head
```

```
name, driver_version, memory.total [MiB], compute_cap
NVIDIA GeForce RTX 2070, 616.56, 8192 MiB, 7.5
libcuda.so
libcuda.so.1
libcuda.so.1.1
libcudadebugger.so.1
libd3d12.so
libd3d12core.so
libdxcore.so
libnvcuvid.so
...
```

`compute_cap 7.5` 就是 sm75，后面会反复用到。`/usr/lib/wsl/lib` 里的 `libcuda.so` 由 Windows 驱动提供，**不要在 WSL 里再装 Linux 版 NVIDIA 驱动**，原因见「原理浅析」。

### 3. Docker Desktop：GPU 能进容器

Docker Desktop 使用 WSL2 后端时，已经自带 NVIDIA Container Toolkit。先确认 runtime 里有 `nvidia`：

```powershell
docker info --format '{{json .Runtimes}}'   # 输出里应该有 "nvidia"
```

用一个很小的镜像验证 GPU 透传。这一步不需要 CUDA 镜像，`nvidia-smi` 是 runtime 挂进容器的：

```powershell
docker run --rm --gpus all ubuntu:24.04 nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap --format=csv
```

```
name, driver_version, memory.total [MiB], compute_cap
NVIDIA GeForce RTX 2070, 616.56, 8192 MiB, 7.5
```

想在 Ubuntu 发行版里直接用 `docker`，还要在 Docker Desktop 里打开集成：Settings → Resources → WSL integration → 勾选 Ubuntu。没打开时会这样报错：

```
The command 'docker' could not be found in this WSL 2 distro.
```

### 4. 拉取 SGLang 镜像

用固定版本号，不用 `latest`：`latest` 会随新版本移动，同一条命令过一个月可能拉到完全不同的东西，文章里的数据也就没法复现。

```bash
docker pull lmsysorg/sglang:v0.5.23
```

这个镜像有 70 层，压缩后 16.1 GB，**落到磁盘上要占 56 GB**：

```
$ docker images lmsysorg/sglang
lmsysorg/sglang:v0.5.23   a1a088657c61   56.4GB
```

拉之前先看「踩坑记录」第 6 条，确认磁盘放得下。

在我这台机器上，`docker pull` 每次都在几秒内报 `EOF` 失败，原因和绕过方法见第 8 条。

### 5. 启动容器并验证

权重缓存放在 WSL 的 ext4 文件系统里（`~/hf-cache`），不要放在 `/mnt/d` 下，原因见「踩坑记录」。以下命令在 Ubuntu 里执行：

```bash
mkdir -p ~/hf-cache
docker run -it --rm --gpus all \
  --ipc=host \
  -p 30000:30000 \
  -v ~/hf-cache:/root/.cache/huggingface \
  -e HF_ENDPOINT=https://hf-mirror.com \
  --name sglang \
  lmsysorg/sglang:v0.5.23 bash
```

进入容器后：

```bash
sglang version
python3 -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0))"
python3 -m sglang.check_env
```

```
sglang version: 0.5.23
git revision: 297e54f

2.14.1+cu130 13.0 True NVIDIA GeForce RTX 2070 (7, 5)

Python: 3.12.16
CUDA available: True
GPU 0: NVIDIA GeForce RTX 2070
GPU 0 Compute Capability: 7.5
NVCC: Cuda compilation tools, release 13.0, V13.0.88
CUDA Driver Version: 616.56
PyTorch: 2.14.1+cu130
sglang: 0.5.23
sglang-kernel: 0.4.10
flashinfer_python: 0.7.2
triton: 3.8.0
transformers: 5.19.0
xgrammar: 0.2.7
Hypervisor vendor:: Microsoft
...
```

（`check_env` 的输出有删减，只留了后面几篇会用到的版本。）

输出里要看这四项：

- 镜像里是 CUDA 13.0，宿主驱动支持到 13.4，向下兼容，没问题
- `Compute Capability: 7.5`：容器里看到的就是 2070 本身，虚拟化层没改它
- FlashInfer、sgl-kernel、Triton 都在，第二部分切换 attention backend 时要用
- `Hypervisor vendor: Microsoft`：确实跑在 WSL2 虚拟机里

四项都对，环境就搭好了。

## 关键参数

| 参数 | 作用 | 本机取值 |
|---|---|---|
| `--gpus all` | 把 GPU 交给容器，由 nvidia runtime 处理 | 必加 |
| `--ipc=host` | 容器共用宿主的 IPC 命名空间和 `/dev/shm`，SGLang 多进程之间靠它传数据 | 必加 |
| `--shm-size` | 只在不用 `--ipc=host` 时生效。官方文档写的是 32g，本机实测加了 `--ipc=host` 后这个参数被忽略 | 不加 |
| `-v ~/hf-cache:/root/.cache/huggingface` | 权重缓存挂到宿主，容器删了不用重新下载 | ext4 路径 |
| `-p 30000:30000` | SGLang 默认端口，WSL2 会自动转发到 Windows 的 localhost | 默认 |
| `-e HF_ENDPOINT` | Hugging Face 镜像站，国内网络用 | 按需 |
| `-e SGLANG_USE_MODELSCOPE=true` | 改从 ModelScope 下载权重，可以替代上一条 | 按需 |
| 镜像 tag | 固定到具体版本 | `v0.5.23` |

## 实测数据

这一篇不跑模型，记录的是后面会用到的环境基线：

| 项目 | 实测值 | 说明 |
|---|---|---|
| 容器默认 `/dev/shm` | 64 MB | 不加 `--ipc=host` 时的大小，SGLang 多进程很容易不够用 |
| `--ipc=host` 后的 `/dev/shm` | 7.8 GB | 等于 WSL 虚拟机内存的一半，同时加的 `--shm-size 32g` 没有生效 |
| WSL 虚拟机内存 | 15 GB / 宿主 31.8 GB | 没写 `.wslconfig` 时默认给宿主的一半 |
| WSL 可用 CPU | 16 核 | |
| 桌面空闲时显存占用 | 1123 MiB / 8192 MiB | Windows 桌面和后台程序占用 |
| 镜像大小 | 压缩 16.1 GB / 磁盘 56.4 GB | 70 层；Docker 数据盘 `docker_data.vhdx` 从 15.4 GB 涨到 71.2 GB |
| 获取镜像耗时 | 33.5 分钟 | `docker pull` 失败，改用 skopeo 拉取并导入，时间包含导入 Docker，见第 8 条 |
| 宿主直连 CDN 下载速度 | 约 39 MB/s | IPv4，单个 105 MB 的层，用 curl 测 |

## 踩坑记录

**1. 在 WSL 里装了 Linux 版 NVIDIA 驱动。** WSL 的 `libcuda.so` 来自 Windows 驱动，装 Linux 驱动会覆盖它，GPU 反而用不了。NVIDIA 的说法很明确：WSL 里只装 Windows 驱动。需要 CUDA Toolkit 时，选 WSL-Ubuntu 专用的安装包（不带驱动）。用 Docker 的话连 Toolkit 都不用装。

**2. 驱动太旧，CUDA 13 镜像起不来。** 宿主驱动要支持 CUDA 13，看 `nvidia-smi` 右上角就知道。老驱动可以先退回 `v0.5.19-cu129` 镜像，但它不再更新了，还是建议升级驱动。

**3. `/dev/shm` 只有 64 MB。** Docker 的默认值，见上表。加 `--ipc=host` 解决。

**4. Ubuntu 里找不到 `docker`。** Docker Desktop 默认只集成 `docker-desktop` 这个发行版，要在 Settings → Resources → WSL integration 里手动勾选 Ubuntu。

**5. 权重放在 `/mnt/d`，加载很慢。** `/mnt/*` 是通过文件共享协议访问的 Windows 磁盘，读大文件比 WSL 自己的 ext4 慢很多。权重缓存放在 `~/` 下面。

<!-- TODO: 实测同一个模型从 /mnt/d 和 ~/hf-cache 加载的耗时，放到第二部分 -->

**6. C 盘被镜像撑满。** Docker Desktop 的数据都在一个 `.vhdx` 虚拟磁盘里，默认放在 C 盘（`%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx`）。

镜像压缩后才 16 GB，为什么要占 56 GB？因为新版 Docker Desktop 默认使用 containerd 镜像存储（`docker info` 里能看到 `driver-type: io.containerd.snapshotter.v1`），它会同时保留压缩的层和解压后的文件系统。我这台机器拉镜像前 C 盘只剩 58 GB，直接拉基本会被占满。

解决办法：在 Settings → Resources → Advanced → Disk image location 里换到大盘，Apply & restart 后 Docker 会自己把数据搬过去。我把它移到了 D 盘，已有的镜像都还在，C 盘腾出了 15 GB。WSL 发行版的 `.vhdx` 也可以迁移，用 `wsl --manage <发行版> --move <路径>`。

**7. 用了 `latest` tag。** 结果没法复现，见第 4 步。

**8. `docker pull` 几秒就报 `EOF`。** 症状是这样的，重试多少次都一样：

```
failed to copy: httpReadSeeker: failed open: failed to do request:
Get "https://production.cloudfront.docker.com/registry-v2/.../data?...": EOF
```

`registry-1.docker.io` 能连上，镜像清单也能拿到，但从 CDN（`production.cloudfront.docker.com`）下载层时连接被断开。我按下面的顺序排查：

1. 先排除宿主网络：在 Windows 上用 curl 直接下载同一个层，IPv4 能跑到约 39 MB/s，没问题
2. 再看 Docker 的代理日志：`docker pull` 由 Docker Desktop 在 Windows 侧的 HTTP 代理（`http.docker.internal:3128`）转发出去，日志在 `%LOCALAPPDATA%\Docker\log\host\httpproxy.log`。大部分 CDN 连接在 100 ms 左右、只传了 272 字节就断了，说明在 TLS 握手阶段就失败了
3. 然后分开测 IPv4 和 IPv6：

```bash
for mode in -6 -4; do
  for i in $(seq 12); do
    curl $mode -s -o /dev/null --max-time 10 https://production.cloudfront.docker.com/; echo -n "$? "
  done; echo " <- $mode"
done
```

| 协议 | 成功 | 失败 | 失败时的 curl 退出码 |
|---|---|---|---|
| IPv6（`-6`） | 7 / 12 | 5 / 12 | 35（TLS 握手失败） |
| IPv4（`-4`） | 12 / 12 | 0 / 12 | — |

用镜像的配置文件（64 KB）再测一次：IPv6 5 次失败 3 次，IPv4 5 次全部成功。

4. 最后查到原因：Windows 默认优先用 IPv6。`netsh interface ipv6 show prefixpolicies` 里 `::/0` 的优先级是 40，高于 IPv4（`::ffff:0:0/96`）的 35，所以 Docker 的代理先走 IPv6。TLS 握手失败又不会触发回退到 IPv4，于是镜像配置文件（第一个要下的东西）几乎每次都下载失败，整个 pull 直接中止。

反过来，**容器里**的 DNS 只返回 IPv4 地址，在容器里下载同一个文件 8 次全部成功。所以我的绕过方法是在容器里用 skopeo 拉镜像，再通过 Docker socket 直接导入：

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ubuntu:24.04 bash -c '
    apt-get -qq update && apt-get -qq install -y ca-certificates skopeo
    skopeo copy --retry-times 5 --override-os linux --override-arch amd64 \
      docker://docker.io/lmsysorg/sglang:v0.5.23 \
      docker-daemon:lmsysorg/sglang:v0.5.23'
```

注意要一起装 `ca-certificates`：skopeo 不依赖它，裸 `ubuntu` 镜像里没有 CA 证书，不装会报 `x509: certificate signed by unknown authority`。skopeo 会校验每一层的 digest，导入后的镜像配置 digest（`f3a303d4…`）和 Docker Hub 上的一致。

另一个思路是让 Windows 优先使用 IPv4，从源头上避开有问题的 IPv6 线路（需要管理员权限，改回去把 45 换成 35 即可）。这个方法我本机还没试过，仅供参考：

```powershell
netsh interface ipv6 set prefixpolicy prefix=::ffff:0:0/96 precedence=45 label=4
```

这个问题取决于本地网络的 IPv6 线路，未必每个人都会遇到。但排查思路是通用的：`docker pull` 出问题时，分别测宿主直连、Docker 代理日志、容器内这三条路径，看是哪一段出的问题。

## 原理浅析

### GPU 是怎么进到 WSL 和容器里的

WSL2 是一台轻量虚拟机，但 GPU 并没有直通给它，而是走 GPU 半虚拟化（GPU-PV）：

1. Windows 上的 NVIDIA 驱动照常管理 GPU
2. WSL2 内核里有一个 `dxgkrnl` 驱动，对外暴露 `/dev/dxg` 设备，把 Linux 侧的调用转发给 Windows 的图形内核
3. `libcuda.so` 是 Windows 驱动随附的 Linux 用户态库，CUDA 程序调用它，它再通过 `/dev/dxg` 和 Windows 驱动通信。在 WSL 发行版里，它出现在 `/usr/lib/wsl/lib`
4. 容器里的程序也一样，由 nvidia runtime 把这些东西挂进容器

在容器里看一下挂载，能看清楚它们分别从哪来（输出有删减）：

```bash
docker run --rm --gpus all ubuntu:24.04 bash -c "ls -la /dev/dxg; mount | grep -E 'dxg|libcuda'"
```

```
crw-rw-rw- 1 root root 10, 125 Nov 18 02:14 /dev/dxg
none on /usr/lib/x86_64-linux-gnu/libcuda.so.1 type overlay (ro,...)
none on /dev/dxg type devtmpfs (ro,...)
drivers on /usr/lib/wsl/drivers/nvmii.inf_amd64_f1ea8be696d056d0/libcuda.so.1.1 type 9p (ro,...,aname=drivers,...)
```

- `/dev/dxg` 就是第 2 步里的半虚拟化设备
- 程序加载的 `libcuda.so.1` 在标准路径 `/usr/lib/x86_64-linux-gnu` 下，是一个只读的 overlay 挂载
- 真正的驱动文件挂在 `/usr/lib/wsl/drivers/nvmii.inf_amd64_<hash>/` 下，文件系统类型是 `9p`，`aname=drivers` 表示它来自 Windows 的驱动仓库。`nvmii.inf` 正是 Windows 驱动包的名字

所以整条链路上只有一份「真正的」驱动，就是 Windows 那份，Linux 这边只是以只读方式挂进来用。这也解释了第 1 条坑：在 WSL 里装 Linux 驱动，就等于用一个不认识 `/dev/dxg` 的库替换了能用的那个。

在容器里跑 `nvidia-smi`，会看到 `NVIDIA-SMI 615.65.06` 和 `KMD Version: 616.56` 两个不同的版本号。KMD 是 Windows 的内核态驱动，前者是 WSL 侧用户态组件的版本号。

### sm75 意味着什么

`compute_cap 7.5` 决定了这张卡在 SGLang 里能用哪些功能：

- 能用：FP16 推理；FlashInfer（默认 attention backend，要求 sm75 及以上，2070 刚好够）；Triton backend
- 不能用：BF16（硬件不支持，而很多模型默认是 BF16，第二部分要用 `--dtype half` 处理）；FP8（要 sm89 及以上）；FlashAttention 3（要 Hopper）
- FlashInfer 在 sm75 上出问题时，官方文档建议换成 `--attention-backend triton --sampling-backend pytorch`

这些限制在第二部分会一个个碰到。

## 延伸阅读

- [NVIDIA：CUDA on WSL User Guide](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)
- [SGLang：安装文档（Docker 部分）](https://github.com/sgl-project/sglang/blob/main/docs/docs/get-started/install.mdx)
- [Docker Desktop：GPU support](https://docs.docker.com/desktop/features/gpu/)
- [SGLang 镜像 tag 列表](https://hub.docker.com/r/lmsysorg/sglang/tags)
