# A2 内置 Profiler —— 开销门槛实验报告

> 版本：**v1.0** · 日期：2026-10-06 · HEAD `8eb2b89` · 状态：**完成（立项前的形式检查）**
> 取数脚本：`bench/profiler-overhead/overhead_lab.py`（口径固化在脚本里）
> 复现：`cd bench/profiler-overhead && D:\py\python.exe -X utf8 overhead_lab.py --rounds 2000 --reps 7`
> 原始数据：`bench/reports/a2-overhead-lab.json`（schema `opencharm-a2-overhead-lab/2`）

本报告只回答一个问题：**A2（内置 Profiler）能不能做、以什么形态做。** 结论先行：

| 结论 | 依据 |
|---|---|
| ✅ **能做**，但要作**默认关的独立模式** | 真实 Profiler 形态 **2.53~2.68x**，远超 Gate C 的 1.5x，不可能进默认路径 |
| ✅ 推荐形态：**抬开静音上限 + per-call 精确计时，保留类型观测** | V2p = **2.68x**；作为对比 V2f（顺带关掉类型观测）2.53x 只省 6%，不值得丢数据 |
| ✅ 相对优势成立且可写：比 cProfile 便宜近一半 | 同负载 **cProfile 4.80x**，我们 2.68x 还额外产出类型/结构/异常观测 |
| ⛔ 三条路线被数据否决 | 见 §4：降采样计时 / 进程内栈采样 / 沿用默认参数加计时 |
| ⚠️ 顺带查出：**Gate C 当前在红线边上抖动** | 官方 harness 连跑两次：**1.53x FAIL / 1.44x PASS**；本实验 V0 **1.58x** |

---

## 1. 为什么先做实验而不是先写代码

ADR-0010 把「运行时开销 < 1.5x」列为一等目标，且现有规范写死「改采集路径必须 bench 回归」。A2 是**唯一**要动 probe 采集热路径的功能，因此它的第一道门槛是预算，不是实现。

同时，`docs/improvement_and_roadmap_report.md` 记的 1.35x 余量只有 **0.15x**——按可见余量推算，任何 per-call 计时都不可能塞进去。**但实测给出的图景完全不同**（见 §5）：现有口径本身就在 1.44~1.58x 之间抖，"余量"这个概念已经失效。

## 2. 口径（本实验最重要的一件事，踩过一次坑）

**官方 `bench/sample/unannotated_scraper/bench_probe.ps1` 的口径 = 脚本内部 `main()` 的计时**，不含 uv/解释器启动。第一版实验把 `Monitor` 构造与 `start()` 也算进计时窗口，得到 V0 = **3.05x**，与官方的 ~1.5x 差出一倍——**差异全部来自一次性装配成本**，混进去会得出"越短的脚本越吃亏"的失真结论。

第二版改为：**`Monitor` 构造 / `start()` / `stop()` 全部在计时窗口外，只计时 `workload.run(rounds)`** → V0 = **1.58x**，与官方 1.53x/1.44x 同量级，口径自此对齐。

> **取数禁则（建议并入报告 §9）**：探针开销的倍率必须**只计工作负载内的时间**（Monitor 构造 / `start()` / `stop()` 一律置于窗口外），一次性装配成本作为常量另行列出。

负载：`workload.run(2000)` = 3 个极短函数 × 2000 轮（dict 构造 / 循环+字符串 / 闭包工厂），与 Gate C 同源。**这是最坏情形**：函数体越短，回调成本的相对占比越大；在此达标的方案在真实场景下必然达标。

统计：每个变体先 warm-up 1 次，再跑 `--reps 7`，报 **min**（近似无干扰净值，与官方 best-of-3 同思路）与 median。

## 3. 实测（rounds=2000, reps=7, Python 3.13.7）

| 变体 | min(ms) | ratio | 计时样本 / 应采 6000 | 说明 |
|---|---|---|---|---|
| plain | 36.3 | 1.00x | — | 分母 |
| **V0 probe（现状）** | 57.3 | **1.58x** | — | 基线，与官方 1.44~1.53x 同量级 |
| V1 wrapper only | 57.5 | 1.58x | — | **多一层 Python 帧的成本 ≈ 0** |
| V2 timing（默认参数） | 61.9 | 1.70x | **602** | ⛔ 静音把样本砍到 1/10 |
| **V2f timing-full** | 91.9 | **2.53x** | 6002 | 真 Profiler 形态：取消静音 + 关类型观测 |
| **V2p timing-full+args** | 97.5 | **2.68x** | 6002 | 同上但保留类型观测（**推荐**） |
| V3 sampled 1/16 | 88.2 | 2.43x | 377 | 省 4% 成本，丢 94% 样本 → 否决 |
| V4 stack 1ms only | 36.9 | 1.01x | **1 个样本** | ⛔ 进程内栈采样，见 §4.2 |
| V5 probe+stack 1ms | 58.7 | 1.62x | 4 个样本 | 又贵又没数据 → 否决 |
| **V6 cProfile（参照）** | 174.4 | **4.80x** | — | 我们声称要"对标"的对象本身的代价 |

诊断列（最后一次运行的状态）：V2/V2f/V2p 的 `armed/muted/funcs/window/active` = `3/3/6/True/0` → 默认参数下 3 个函数**全部静音**（各超 200 次调用）；V2f/V2p 为 `6/0/6` → 无静音。发现窗口全程开启（项目 `run()` 帧使 `_active > 0`），与官方 inject 场景一致。

## 4. 三条被数据否决的路线

### 4.1 ⛔ 「沿用默认参数顺手加计时」= 假 Profiler

V2 的样本只有 **602 / 6000**。`max_calls_per_func=200` 会让每函数在 200 次调用后静音——对**类型观测**这是无害降采样（分布早已饱和），对 **Profiler 是致命失真**：样本只覆盖**每个函数的前 200 次调用**，均值/总和/P99 全部不可信，还 biases 掉预热效应。

> **结论**：Profiler 模式必须抬开这个上限。这不是调参偏好，是正确性前提。

### 4.2 ⛔ 进程内栈采样（py-spy 式）

V4 在 36ms 的 CPU 负载里只拿到 **1 个样本**（V5 叠加到现有 probe 上也只有 4 个）。原因不是采样频率写错了：**被测线程持续持有 GIL，采样线程几乎排不上调度**。`threading.Event.wait(1ms)` 的名义 1000Hz，实测落到 ~28Hz 量级。

py-spy 能做到 100Hz 有效采样，是因为它**从另一个进程读内存**，不需要 GIL——我们作为进程内探针做不到。

> **结论**：in-process 栈采样对短脚本（IDE 场景的绝大多数）统计学上无效。**不得**把它当作 Profiler 的轻量替代；也不得对外宣称支持火焰图/多线程 self-time。

### 4.3 ⛔ 降采样计时（每 N 次才计时一次）

V3（1/16）比 V2f 省 4% 成本，却只有 377 个样本。原因是**计时的主要成本不在 `perf_counter`，而在回调本身的派发与沉降**（V1 证明多一帧几乎免费，说明成本结构是"回调调度 + 分类 + sink"，不是我们新加的活）。

> **结论**：既然计时的边际成本低到 16 倍降采样只省 4%，就**没有理由做统计估计**——全量计时既精确又便宜（同一 judge：V2p 是全 V2f +6%）。

## 5. ⚠️ 顺带查出：Gate C 正在红线边上抖动

官方 harness 同一台机器连跑两次：

| 次序 | plain | probed | ratio | 判定 |
|---|---|---|---|---|
| 第 1 次 | 45.0 ms | 69.0 ms | **1.53x** | **FAIL** |
| 第 2 次 | 41.0 ms | 59.0 ms | 1.44x | PASS |

本实验对齐口径的 V0 为 **1.58x**。三者同量级但**跨越 1.5x 红线**。

- `git log` 显示 probe 采集路径自 `b38cfee`（窗口回溯开销收敛）以来**再无改动**，可排除代码回归；
- 因此更像是「1.35x 这个历史数字本身测在高位 quiet 的机器上」，而现在**余量已归零**；
- 影响：任何落在**默认路径**上的新增开销都不可接受；这也是 A2 必须做成"默认关"的硬理由。

**是否要先优化 baseline 再动 A2，属独立议题**（见 `docs/runtime_profiler_dev_plan.md` §7 待裁决 ②）。

## 6. 另一条必须写的口径红线

V2p 实测：**2000 轮工作负载，各函数 inclusive 耗时之和 = 138.2 ms，而同一负载在探针下的实际运行时间是 97.5 ms**——两者量级相近但都远高于无探针的 36.3 ms。

原因不是计时写错了：`sys.monitoring` 一旦开启，解释器会**去优化（关掉自适应特化）**，函数体本身就慢了约 1.5~2 倍。这是**所有 tracer 的共同物理限制**（cProfile 4.80x 同理）。

> **对外口径（建议写入 plan 与 UI 文案）**：
> Profiler 给出的耗时是**含探针开销的相对值**，用于**给热点排序**，**不等于**无探针时的真实耗时。禁止表述为"精确耗时"/"所见即所得"；可写的是"低于同场景 cProfile 的开销"与"用于找出最慢的 N 个函数"。

## 7. 下一步

裁决与 PR 拆分见 **`docs/runtime_profiler_dev_plan.md`**（v0.1）。本实验脚本保留为**回归资产**：任何后续 PR 只要改动采集热路径，都要重跑并更新本报告的数字。

## 8. ✅ PR-A2-P1 落地盖印（2026-10-07，同一脚本出数）

**交付**：`perf_mode` 进 `monitor.py`（两套回调组，`start()` 二选一注册——§3.2 形态裁决落地）+ `OPENCHARM_PROBE_PERF=1` 环境变量开关 + sink 聚合 `fid → [calls, total_ns, max_ns]`。默认路径采集逻辑逐字未变。

**落地与实验装置的一处差异（实证驱动）**：**PY_UNWIND 不能作局部事件**（3.13.7 `set_local_events` 拒收，`local_events_probe.py`）——异常退出的配对清理改为**全局 PY_UNWIND + `_perf_stacks.get` 过滤**（库代码 unwind 只付一次 dict 查表，异常路径非热路径）。配对语义实证：`raise_semantics_probe.py` / `unwind_semantics_probe.py`（内部捕获不触发 UNWIND、传播出帧才触发、生成器耗尽走 PY_RETURN）。

**同机两次全量（rounds=2000, reps=7）**：

| 变体 | run1 | run2 | 判定 |
|---|---|---|---|
| V0 probe（默认路径，未变） | 1.77x | 1.67x | 本会话机器偏热（med/min 偏离大）；与改动无关——见下行 HEAD 对照 |
| **V2n native perf-mode** | **2.87x** | **2.81x** | ✅ 进 [2.4, 2.9]；与实验装置 V2p（同场 2.85x/2.87x）同量级 |
| V6 cProfile（参照） | 5.23x | 5.10x | V2n ≤ cProfile，余量 ~44% ✅（§3.3 红线） |

样本完整度：V2n **timed = closed = 6003/6003**（无静音截断、计时栈零残留），对照 V2（默认参数）603/6003 的假样本。

**默认路径 HEAD 对照（官方 harness，同会话）**：HEAD（stash 后）**1.55x FAIL** → 改动后 **1.64x FAIL**。两读数都在本机历史抖动带（1.27~1.64x）内，且 lab V0（跑的就是未变的默认路径代码）同场 1.67~1.77x——**差异是机器热度，不是代码回归**。结论：**默认路径与 HEAD 持平 ✅**。

**probe 单测**：86/86（新增 5 例：默认零影响 / 抬静音逐次计时 / UNWIND 配对 / 递归 LIFO / env 开关）。

## 9. ✅ PR-A2-P2 落地盖印（exclusive(self) time，2026-10-07，同一脚本出数）

**裁决流程（先测后做）**：新增实验变体 **V2p-self**（child_ns 帧栈结构，与落地形态逐字一致——self 回调组调用原版回调）。**实验：V2p-self 2.95x ≤ V6 cProfile 5.10x，余量 ~42% → 达标，保留并落地**（PR 规格：不达标才砍）。

**落地**：monitor.py 的 per-code 栈 `_perf_stacks: dict[code, list[t0]]` 升级为**单帧栈** `_perf_frames: list[[code, t0_ns, child_ns]]`——返回时把 dt 累计进父帧 child_ns，样本行扩展为 **[calls, total_ns, max_ns, excl_total_ns, excl_max_ns]**。**无新配置项**：perf 模式天然同时产出 inclusive + exclusive（2.68x→~3.0x，仍远低于 cProfile）。PY_UNWIND 弹帧并累计父 child_ns、不记样本（与 P1 同语义）。

**同机两次全量（rounds=2000, reps=7）**：

| 变体 | 实验 run | 落地后 run | 判定 |
|---|---|---|---|
| V2p-self excl.time（实验装置） | 2.95x | 3.18x | ✅ ≤ cProfile |
| **V2n native perf-mode（落地后 = 帧栈版）** | — | **3.02x** | ✅ 含 exclusive 仍 ≤ cProfile 5.45x，余量 ~42% |
| V6 cProfile（参照） | 5.10x | 5.45x | 红线参照 |

样本完整度：两次均 **timed = closed = 6003/6003**、帧栈零残留（`residue=0`）——帧栈配对无泄漏。

**probe 单测**：87/87（新增 exclusive 减法用例：parent 调 child(sleep 10ms)，child excl>5ms、parent excl<5ms、parent incl ≥ child incl + parent excl，无负值/反转）。
