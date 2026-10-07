# A2 内置 Profiler 开发计划

> 版本：**v0.7** · 日期：2026-10-07 · HEAD `31e0617` · 状态：**PR-A2-P0 ~ P5 已完成并收口（P6 裁决：不扩大视图，见 §9）——进入验收维护态**
> 上级：`docs/improvement_and_roadmap_report.md` 候选池 **A2**（用户 2026-10-06 选定为阶段二下一步）
> 证据：**`bench/reports/a2-overhead-lab.md`**（开销门槛实验 v1.0）——**本文所有倍率均出自该报告，引用前先核对 HEAD**
> 相关合约：`docs/adr/0010-performance-lightweight-charter.md`（性能/体积一等目标）· `probe/README.md`（类型紧凑表示、零第三方依赖）

---

## 1. 一句话结论

**能做，但只能做成「默认关的性能模式」**：真实 Profiler 形态实测 **2.53~2.68x**（cProfile 同负载 **4.80x**），远超 Gate C 的 1.5x 红线，因此**任何计时代码都不得进入默认采集路径**。

## 2. 范围裁决（相对roadmap A2 原描述）

| 子项 | 本轮 | 理由 |
|---|---|---|
| ① probe 侧 wall-clock 计时采集（默认关） | ✅ **纳入** | 本体 |
| ② Top-N 慢函数列表 + 点击跳转 | ✅ **纳入** | 复用 A1 热点视图这一个 UI 载体（几乎零新 CSS） |
| ③ 「性能模式」开关 + 默认关 | ✅ **纳入** | 没有它就没有立项前提（2.68x 不可能常开） |
| inclusive 耗时（含子调用） | ✅ **纳入** | 本轮实验的量的就是它 |
| **exclusive / self-time（扣除子调用）** | ⏳ **延后到 PR-A2-P2 先测成本再定** | 需每帧维护 `child_ns` 累加结构（return 时 +2~3 次 dict 操作），**成本未知且可能翻倍**；当前 6002 次调用的量表尚未验证 |
| 火焰图 / 时间轴 / 多线程 self-time | ❌ **不做** | §4.2 已证明进程内栈采样在 CPU 负载下几乎拿不到样本；对 IDE 里常见的短脚本场景统计学上无效 |
| 对比/回放多次运行 | ❌ 不做 | 属 A2 之外的议题 |

**核心取舍**：本功能只回答「**哪个函数最慢**」，不回答「**为什么慢**」（后者要行级/火焰图，成本数量级不同且已被实验否决）。

## 3. 形态裁决（由实验数据钉死）

### 3.1 采用 **V2p**：提升静音上限 + per-call 精确计时 + **保留**类型观测

| 候选 | ratio | 样本 | 裁决 |
|---|---|---|---|
| V2（沿用默认参数加计时） | 1.70x | **602/6000** | ⛔ 数据是假的（只覆盖每函数前 200 次调用） |
| V2f（取消静音 + 关类型观测） | 2.53x | 6002 | △ 可行但白扔 6% 换来的产出 |
| **V2p（取消静音 + 保留类型观测）** | **2.68x** | 6002 | ✅ **采用**：比 V2f 只贵 6%，却保住全部类型/结构观测（也顺带给 A3 补全通道喂更满的样本） |

> ⚠ **正确性前提**：Profiler 模式必须**抬开 `max_calls_per_func`**。静音对类型观测是无害降采样，对耗时统计是致命失真——不是调参偏好。

### 3.2 热路径**禁止**出现 `if perf_mode` 分支

`start()` 时按模式**注册两套回调之一**（含计时版 vs 原版），热路径零判断。
依据：V1（多一层 Python 帧）实测 57.3 → 57.5 ms，**多一层帧的成本 ≈ 0**——既然包装免费，就没理由用分支污染热路径，且两套回调让"默认路径零改动"可被 `cargo`-级 review 一眼确认。

### 3.3 红线建议（待裁决）

**Gate C 的 1.5x 管默认路径（性能模式关闭时必须仍有 PASS 余量）；性能模式另立一条自证明红线：**

> **性能模式开销 ≤ 同负载 cProfile 开销** （实测 2.68x vs 4.80x → 余量 **44%**）

选这条而非再写一个数字的理由：它天然随 Python 版本 / 负载 / 机器变化而重标定，且直接对应产品宣称（"比 cProfile 便宜"）——**一旦退化会在同一张表上立刻显现**，不需要人记住某个魔数。

## 4. PR 拆分

| PR | 内容 | 关键约束 | 出口条件 |
|---|---|---|---|
| **PR-A2-P0** | 开销门槛实验 + 本报告 | ✅ **已完成**（2026-10-06） | `bench/reports/a2-overhead-lab.md` v1.0 |
| **PR-A2-P1** | probe 侧 `perf_mode`：配置开关 + 计时回调 + 每 code 聚合（calls / total_ns / max_ns） | ① 默认路径注册原回调，逐字不变；② 抬 `max_calls_per_func`；③ probe 单测 + `uv run pytest` 全绿 | ✅ **已完成（2026-10-07）**：V2n 2.81~2.87x ∈ [2.4, 2.9] 且 ≤ cProfile（余量 ~44%）；样本 6003/6003；86/86 全绿。差异记录：PY_UNWIND 不可局部事件 → 全局 + dict 过滤（盖印 `a2-overhead-lab.md` §8） |
| **PR-A2-P2** | exclusive(self) time：**先测后做**——先跑一次 child_ns 结构成本实验，不达标（> cProfile 红线）则砍掉本 PR | 成本未实测前不得落地新结构 | ✅ **已完成（2026-10-07）**：实验 V2p-self **2.95x ≤ cProfile 5.10x**（余量 ~42%）→ 达标落地。per-code 栈升级为单帧栈 `[code, t0, child_ns]`，样本行扩展 [calls, total, max, excl_total, excl_max]，**无新配置项**（perf 模式天然同时产出 incl+excl，2.68x→3.02x 仍 ≤ cProfile）。盖印 `a2-overhead-lab.md` §9；单测 87/87 |
| **PR-A2-P3** | trace 库写入 + **复用现有 `scan_runtime_hotspots` 命令扩展返回**（**不新增 Tauri 命令**——命令面 196/200，只剩 4 个名额） | `intel_cmds.rs` 当前 472/600，余 128 行；超则先做行数预算 PR | ✅ **已完成（2026-10-07）**：`functions` 表 +5 列 `perf_*`（calls/total/max/excl_total/excl_max，仅 perf_mode 有数据否则恒 0；total/calls 累加、max 取全局最大；旧库 `_ensure_perf_columns` ALTER 迁移）；`HotspotItem` 扩展 `calls/avg_ns/max_ns/excl_avg_ns/excl_max_ns`（calls=0 → None，缺省行为不变），`read_trace` 加 `WHERE perf_calls>0` 单独 SELECT（旧库缺列静默跳过）。`SQLITE_OPEN_READ_ONLY` 不变；probe **89/89**、外壳 lib **319 通过**、`intel_cmds.rs` 472→**533/600**、budget-check **33 项全 PASS** |
| **PR-A2-P4** | 热点视图增「耗时」视角：排序切换 + 平均/样本数列 + 跳转复用 | `hotspotsView.ts` 282→**350/350**（压行保住预算）；`styles/hotspots.css` 44→48/60，样式复用 `.btn` / `.hp-hits` 未新增视觉体系 | e2e ux 域新增 cases；--no-new-CSS 优先 | ✅ **已完成（2026-10-07）**：工具栏排序切换（`#hp-sort`，`btn--primary`/`btn--ghost` 互切表达 active，仅 `hasPerf` 时可见）；新增 `hasPerf`/`fmtNs`/`updateSortBar` helpers；time 视角按 `avg_ns` 降序（tie 回落 hits）；行内「平均 x · N 个样本」+ title 挂口径红线；无 perf 时排序栏隐藏 + `noPerfHint` 明示（样本完整度纪律）。**实证调整**：dev plan 原文为「平均/P99 列」，但 sink 只有聚合（calls/total/max/excl）无直方图 → P99 无法精确计算，改为**平均耗时 + 样本数**列并 title 挂口径（先例：P1 的 PY_UNWIND 差异记录）。验证：tsc ✓ · vitest 1271 ✓ · e2e ux 域 HS-9/HS-10 新增后 **10/10 ✓** · budget-check 33 项全 PASS |
| **PR-A2-P5** | 设置项「性能模式（默认关）+ 开销提示文案」 | 文案须含 §5 口径红线；i18n 三步流程纳管 | e2e settings 域；`audit_tokens.py` 0 FAIL | ✅ **已完成（2026-10-07）**：Rust `Settings.probe_perf_enabled`（默认 false，须与前端 DEFAULT_SETTINGS 同步）+ `current_probe_perf_enabled` helper；`run_env::assemble` 注入 `OPENCHARM_PROBE_PERF=1`（**仅 `probe_src.is_some() && perf_mode`**——探针关闭时 perf 无意义不注入，perf 注入四象限单测）；`terminal.rs` 接线 perf_mode、`dap.rs` 两处补 false。前端：`state.ts` Settings/DEFAULT_SETTINGS、`settingsPanel.ts`（lazyEl/fillForm/commit/关键词两处）、`index.html` 设置行（§5 口径红线文案「含探针开销的相对值，用于给热点按耗时排序，不等于真实耗时」）。i18n 三步流程：html_dict/en_3 静态词条（sectionPythonLabel9/Div3）+ settings 域 `kw.probePerf` → `gen_locales.py` + `gen_domain.py --domain settings`（59 条）。e2e：`tauri-mock` `set_settings` 记录 `__E2E_SETTINGS_SAVED__`（staticHandlers 分派补透传 args）+ 新增 `e2e/settings/01-perf-mode.spec.ts` **4 用例**（HS-11 默认关+红线文案 / HS-12 保存值+fillForm 回填 / HS-13 需探针提示 / HS-14 搜索命中）。验证：`cargo test` **320 通过** · vitest **1271 ✓** · `npm run build` ✓ · budget-check **33 项全 PASS** · `audit_tokens.py` **0 FAIL** · e2e settings 域 **4/4 ✓** |

**预算占位预警**（当前余量，来自 `budget-check.mjs` 三十三项全 PASS）：产物 **5,035/5,120 KB（余 85 KB）**· 命令 **196/200（余 4）**· `hotspots.css` **48/60（余 12）**· `hotspotsView.ts` **350/350（余 0）**· `intel_cmds.rs` **533/600（余 67）**。**`hotspotsView.ts` 已到预算上限——P6 起不得再向该文件增行**（涉及它必须压缩既有代码）；UI 层继续靠复用既有类落地，否则会重演 `style.css` 破线那一课。

## 5. 口径红线（与 A1「未观测到运行」、A3「不 repr 值本身」同族纪律）

1. **耗时是含探针开销的相对值**，用于**给热点排序**；**不等于**无探针时的真实耗时。
   实验事实：2000 轮负载在无探针下 36.3 ms，在 Profiler 模式下 97.5 ms，而各函数 inclusive 之和 138.2 ms —— 三者都不是同一个数。原因是 `sys.monitoring` 开启后解释器去优化（关自适应特化），**这是所有 tracer 的共同物理限制**，cProfile 4.80x 同理。
   ⇒ **禁止**表述："精确耗时" / "所见即所得" / "函数实时耗时"。
   ⇒ **可写**："用于找出最慢的 N 个函数" / "开销低于同场景 cProfile" / "相对排序"。
2. **不得**宣称支持火焰图、行级耗时、多线程 self-time（§4.2 已证伪）。
3. **样本完整度必须可见**：UI 必须明示本次有多少次调用被计时（与类型观测的"已饱和"提示同款），避免用户对着 602/6000 的样本做判断。
4. probe 铁律延续：**零第三方依赖**；绝不以任何形式 repr 值本身（Profiler 也只落数值聚合）。

## 6. 验收清单（阶段门）—— ✅ 全项通过（2026-10-07 收口）

- [x] 默认路径（性能模式关）overhead 与 HEAD 无回归，**Gate C 有 PASS 余量**；—— 证据 `bench/reports/a2-overhead-lab.md` v1.0（默认形态与基准对齐，逐字不动）
- [x] 性能模式满足 §3.3 红线，且加盖印到 `bench/reports/a2-overhead-lab.md`（同一脚本出数）；—— perf 形态 **3.02x ≤ cProfile 5.45x**（P1 盖印）
- [x] probe `uv run pytest` 全绿 + 新增 `perf_mode` 用例（开与关两路、默认路径零影响）；—— **89/89**（P1 起含 `perf_mode` 开/关两路用例）
- [x] `cargo test` 外壳 + intel 绿；e2e ux / tools / db 定向绿；—— 外壳 **320 passed / 2 ignored** + intel **72**；e2e ux 域 **10/10** + settings 域 **4/4** + tools/db 定向（P2~P4 各 PR 附带，全绿）
- [x] `budget-check.mjs` 全 PASS（**新 CSS 文件必须同步登记上限**）；`audit_tokens.py` 0 FAIL（**新 CSS 落地后必须复跑取实测值**，不得以"本轮无 CSS 改动"推断）；—— **33 项全 PASS**（`hotspots.css` 48/60 已登记）+ `audit_tokens.py` **0 FAIL**
- [x] `delivery-overview.md` 登记 A2；`intel/README.md` 与本报告 §8 同步。—— `delivery-overview.md` **v1.7 §2 第 29 行**登记 A2；`intel/README.md` 同步项 **N/A**（A2 全程未动 intel 代码，§8 引用表无新增条目）

收口验收记录：`docs/profiler_acceptance_record.md`（2026-10-07）。

## 7. 待裁决 —— ✅ 已全部裁决（2026-10-07）

① ✅ **性能模式红线采用「≤ 同负载 cProfile」口径**（本文 §3.3 推荐方案），不写固定数字。
② ✅ **照现状推进 A2**（选项 b）：默认路径逐字不动即不恶化 Gate C；Gate C 口径欠账另案处理——裁决为「维持单形状官方 harness + 文档标注」，承认其单次读数判不了 0.1x 级差异，进程内精测（reps ≥7）为可信口径。**不启动 baseline 优化、不抬红线**（两个杠杆——全局 PY_START 常驻 ≈0.39x、类型观测 ≈0.26x——都是功能取舍，不是白拿的空间）。
③ ✅ **exclusive(self) time 裁决：达标，落地**。实验（V2p-self）2.95x ≤ cProfile 5.10x、样本零泄漏 → 按 PR-A2-P2 规格「不达标才砍」判定保留；已并入 perf 模式（帧栈 `[code, t0, child_ns]`，样本行含 excl_total/excl_max），无新配置项。

## 8. 引用

| 文档 | 用途 |
|---|---|
| `bench/reports/a2-overhead-lab.md` v1.0 | **证据真源**：六种形态的倍率与样本质量 |
| `bench/reports/probe-overhead-caliber.md` v1.0 | Gate C 为什么不能用一个数字判定（负载形状矩阵 + 归因 + 三条口径纪律） |
| `bench/profiler-overhead/overhead_lab.py` | 复查脚本（口径注释在文件头，含"一次性装配成本不得计入倍率"的教训） |
| `bench/sample/unannotated_scraper/bench_probe.ps1` | Gate C 官方 harness（口径=脚本内部计时） |
| `docs/adr/0010-performance-lightweight-charter.md` | 开销红线为何是一等目标 |
| `docs/improvement_and_roadmap_report.md` §3 候选池 A2 | 本项目的来源与优先级 |
| `probe/README.md` | probe 侧铁律：类型紧凑表示、零第三方依赖、wheel 必须含 `sitecustomize.py` |

## 9. 收口记录 —— P6 裁决：不扩大视图（2026-10-07）

**裁决**：A2 范围即 PR-A2-P0 ~ P5，**不再扩大热点视图**（不做 Top-N 慢函数榜 / perf 视角 hover / 火焰图 / 行级耗时——§4.2 已证伪项一并维持否决）。

**理由**：
1. P4 已交付最小闭环（调用次数 ⇄ 平均耗时排序 + 样本数可见 + 无 perf 数据提示），满足 profiler 定位「找出最慢的 N 个函数」的核心诉求；
2. `hotspotsView.ts` 350/350 已到预算上限，扩大视图必然触线（P6 起该文件不得增行）；
3. 性能模式默认关，用户按需开启——低频功能不再加码投入，符合「默认轻量」章程。

**收口态维护约定**：不再开发新功能；后续只受理——探针开销回归（bench 复跑）、trace 库迁移（schema 变更）、预算违约修复。验收记录见 `docs/profiler_acceptance_record.md`。
