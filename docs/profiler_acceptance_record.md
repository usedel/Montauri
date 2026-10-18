# A2 内置 Profiler 验收记录（PR-A2-P0 ~ P5，收口）

> 日期：2026-10-07（收口当日）· 依据：`docs/runtime_profiler_dev_plan.md` **v0.7**（真源，含 §9 收口裁决）
> 环境：Windows · Rust（外壳 320 passed/2 ignored）· Node/vitest（1271/1271）· Python 3.13.7（probe 89/89）
> 口径：耗时为**含探针开销的相对值**，仅用于排序，不等于真实耗时（§5 红线，全链路显式标注）

## 一、交付物清单

| PR | 层 | 交付物 | 说明 |
|---|---|---|---|
| P0 | bench | `bench/profiler-overhead/overhead_lab.py` + `bench/reports/a2-overhead-lab.md` v1.0 | 开销门槛实验：**perf 3.02x ≤ cProfile 5.45x**；默认路径逐字不动（零回归） |
| P1 | probe | `probe/src/montauri_probe/` `perf_mode`（`MONTAURI_PROBE_PERF=1` 开关 + 计时回调 + 聚合）| 默认零介入；开/关两路单测 |
| P2 | probe | exclusive(self) time（帧栈 `[code, t0, child_ns]`，样本含 excl_total/excl_max）| 单帧栈算法，无新配置项；2.95x ≤ cProfile 5.10x |
| P3 | probe/shell/intel | trace 库 `functions` 表 +5 列 `perf_*`（旧库 ALTER 迁移）；`scan_runtime_hotspots` 扩展（调用次数 / 平均耗时 / 样本数）| 命令面 196 不变；intel 72 测试通过 |
| P4 | shell | 热点视图耗时视角：`#hp-sort` 排序切换（调用次数 ⇄ 平均耗时）、平均耗时 × N 样本、`noPerfHint` | `hotspotsView.ts` 350/350（已满）+ `hotspots.css` 48/60 |
| P5 | shell/前端/i18n | 设置项「性能模式（默认关）+ 开销提示文案」：Rust `Settings.probe_perf_enabled` + `run_env` 注入 `MONTAURI_PROBE_PERF=1`（仅探针开启时）+ 设置行（§5 红线文案）+ i18n 三步流程 | e2e settings 域 4/4；产物 5,035/5,120 KB |

## 二、与计划的实施偏差（反馈修订项）

1. **P4 口径调整**：计划的「平均耗时 / P99 列」改为「**平均耗时 + 样本数**」——sink 只有聚合无直方图，P99 无法准确计算（遵循 §5 样本完整度 + P1 `PY_UNWIND` 先例）。P99 不作为本轮交付项，且收口裁决不再扩大视图。
2. **P5 注入门控**：`MONTAURI_PROBE_PERF=1` 仅在 `probe_src.is_some() && perf_mode` 时注入——探针关闭时 perf 无意义（四象限单测钉住）。
3. **e2e 基建修复**（P5 顺手）：`tauri-mock` 的 staticHandlers 分派原不传 args（`set_settings` 收不到入参），改为 `h(args)` 透传并记录 `__E2E_SETTINGS_SAVED__`。

## 三、验证结果

| 门 | 结果 |
|---|---|
| probe `uv run pytest` | **89/89** |
| 外壳 `cargo test` | **320 passed / 2 ignored**（含 perf 注入四象限单测） |
| intel `cargo test` | **72**（59 + 6 + 7） |
| 前端 vitest | **1271/1271**（i18n 全表扫描通过） |
| e2e | ux 域 **10/10**（HS-9/HS-10）+ settings 域 **4/4**（HS-11~14）+ tools/db 定向绿 |
| `npm run build` | ✓（tsc + vite build） |
| `budget-check.mjs` | **33 项全 PASS**（产物 5,035/5,120 KB · 命令 196/200 · hotspotsView.ts 350/350） |
| `audit_tokens.py` | **0 FAIL** |
| 开销红线 | perf 3.02x / excl 2.95x ≤ 同负载 cProfile（5.45x / 5.10x），§3.3 达标 |

## 四、口径与边界（用户须知）

- **耗时是含探针开销的相对值**，仅用于热点排序；不等于无探针时的真实耗时（设置行 desc + 视图行内 title 双挂）。
- **不宣称**：火焰图、行级耗时、多线程 self-time（§4.2 已证伪）；P99 直方图（无 histograms，P4 裁决）。
- **样本完整度可见**：视图明示「平均 × N 样本」；无 perf 数据时出 `noPerfHint`。
- **性能模式默认关**；探针关闭时 perf 开关无效果。

## 五、收口态维护约定（P6 裁决：不扩大视图）

不再开发新功能；后续只受理——探针开销回归（bench 复跑）、trace 库迁移（schema 变更）、预算违约修复。`hotspotsView.ts` 已到预算上限，**不得再增行**。
