---
title: Operating System Project
date: 2026-01-15
description: Extending a basic OS skeleton with user programs, thread scheduling, synchronization, and a file system redesign.
---

<p class="post-eyebrow">// design doc · systems</p>

# Operating System Project

<p class="post-lede">Extending a basic OS skeleton with user programs, thread scheduling, synchronization, and a file system redesign.</p>

<div class="readouts">
  <div><b>3.76×</b><span>file system speedup vs FAT</span></div>
  <div><b>1,488</b><span>user threads in one stress run</span></div>
  <div><b>~5×</b><span>throughput with buffer cache</span></div>
</div>

[Source on GitHub](https://github.com/CleverAutoman/os-systems-project)

## Overview

This project extends a basic OS skeleton with three major subsystems: **user programs (processes & syscalls)**, **thread scheduling and synchronization**, and a **file system redesign** featuring an FFS-style layout and a Clock/Second-Chance buffer cache.

The primary focus is **correctness under concurrency**, **robust resource cleanup**, and **measurable performance improvements**, validated through stress tests and microbenchmarks.

## Features

### 1. User Programs (Processes & Syscalls)

#### Argument Passing

- Implemented user stack setup with System V–style `argc/argv` layout.
- Ensured **16-byte stack alignment** to satisfy calling convention requirements.

#### Multi-process Syscalls

- Implemented `exec`, `wait`, `fork`, and `exit`, including parent–child synchronization.
- Passed process-tree stress tests:
  - **fork_tree**: reached `depth=3, fanout=4`, creating **84 child processes** in a single run; **148 total processes** across all test cases, with correct exit-status propagation.
  - **multi-oom-mt** (resource exhaustion + crash recovery): achieved **34 recursive exec depth** consistently across **10 repetitions**, correctly terminating crashed children and reclaiming all kernel resources.

#### File-related Syscalls

- Implemented file syscalls including `create`, `remove`, `tell`, `open`, `read`, `write`, and `close`.
- Designed an **O(1) bitmap-based file descriptor table** to efficiently locate free slots for new descriptors.

### 2. Threading, Scheduling & Synchronization

#### Scheduling Policy

- Implemented **strict priority scheduling**.
- Added **priority donation**, including chained donation, to prevent priority inversion under lock contention.

#### Synchronization Primitives

- Implemented core primitives:
  - `semaphore`
  - `lock`
  - `condition variable (condvar)`
- Ensured correctness under preemption and priority-aware scheduling.

#### User Threads (pthread-like API)

- Implemented user thread syscalls including `pthread_create`, `pthread_join`, and `pthread_exit`.
- Adopted a **one-to-one threading model** instead of green threads to avoid process-wide blocking during I/O.
- Passed recursive multithreaded stress test (**search-arr**):
  - Each search spawns **31 threads** (binary recursion over 16 elements).
  - **48 searches**, creating **1,488 threads** total, validating per-thread user stacks, join semantics, and shared address-space behavior.

### 3. File System

Replaced the original list-based FAT design with an **FFS-style indexed allocation** scheme and added a **buffer cache** using the **Second-Chance Clock** eviction algorithm.

#### Fast File System (FFS-style)

- Implemented indexed allocation using direct, indirect, and doubly indirect blocks, replacing list-based FAT traversal.
- Supports files up to approximately **8 MB** (512-byte blocks).
- Added **lazy allocation and lazy loading** for sparse file growth to reduce unnecessary disk I/O.

#### Performance Evaluation (FFS vs FAT)

| Workload | Microbenchmark | FAT (ticks) | FFS (ticks) | Improvement | Speedup |
|---|---|---:|---:|---:|---:|
| Sequential create + sequential read | `100B file × 200 loops` | 2183 | 980 | 55.1% | **2.23×** |
| Sequential create + sequential read | `50B file × 400 loops` | 7736 | 3040 | 60.7% | **2.54×** |
| Sequential create + random directory read | `100B file × 200 loops` | 3364 | 963 | 71.4% | **3.49×** |
| Sequential create + random directory read | `50B file × 400 loops` | 7472 | 1988 | 73.4% | **3.76×** |

The random directory read workload stresses directory locality.

::: tip Key findings
1. **FFS consistently outperforms FAT across both sequential and random workloads**, achieving speedups ranging from **2.23× to 3.76×**.
2. **Small-file access benefits most from FFS-style indexed allocation**, indicating more efficient handling of small-file metadata.
3. **Random access over small files yields the largest overall speedup**, highlighting improved directory locality and metadata organization.
:::

#### Buffer Cache (Second-Chance Clock)

- Implemented a block buffer cache with **Second-Chance Clock** replacement.
- Concurrency design:
  - A **global lock** protects cache-wide metadata.
  - **Per-entry locks** protect individual cache blocks.
  - A `busy` flag is used to avoid holding the global lock while waiting, reducing contention under concurrent access.
- Used a handle-based interface to enable **kernel-level zero-copy–style access** and reduce unnecessary memory copying.

##### Performance Evaluation (Buffer Cache)

Under a repeated small I/O and metadata-heavy workload (`100B accesses × 200 loops`), enabling the buffer cache significantly reduced disk I/O by serving most requests directly from memory.

| Configuration | Time (ticks) | Result |
|---|---:|---|
| Cache OFF | ~983 | baseline |
| Cache ON (global lock) | ~188 | **~80–82% latency reduction**, **~5× throughput** |
| Cache ON (per-entry lock + `busy` condvar) | ~203 | slightly slower in single-threaded runs |

::: tip Key findings
- The global-lock buffer cache achieves the best performance under Pintos' **single-threaded** execution model.
- The per-entry lock design is more scalable for concurrent workloads, but its extra locking and condition-variable overhead provides no benefit in the single-threaded case.
- Therefore, the **global-lock design** was chosen as the final implementation for optimal performance and simplicity.
:::

## Validation & Stress Tests

- Process & syscalls: `fork_tree`, `multi-oom-mt`
- User threads: `search-arr`
- Additional correctness tests from the basic test suite

## Key Design Decisions

- Prioritized correctness and deterministic behavior, especially for:
  - `wait` semantics
  - crash handling
  - resource cleanup paths
- Designed for robustness under failure:
  - syscall failures do not panic the kernel
  - abnormal process termination does not leak kernel resources
- Integrated priority-aware scheduling and donation across all synchronization primitives.

## Challenges & Lessons Learned

- Kernel subsystems require well-defined invariants before implementation (process/thread lifecycles, ownership, and cleanup).
- Incremental development significantly reduces debugging complexity in OS projects.
- Fine-grained commits and continuous testing are critical for maintaining kernel stability.
