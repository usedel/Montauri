# Gate C 验收报告（Phase 2 · 运行时采样期）

> 日期：2026-08-21 · 评审人：产品负责人（签署待补）· 状态：**指标全部达标，待正式签署**

## 1. 验收标准与实测结果

| # | Gate C 标准 | 实测结果 | 判定 |
|---|---|---|---|
| 1 | 探针开销 < 1.5x（bench 全项目实测） | **1.00x**（2026-08-21，bench `unannotated_scraper`，2000 轮 × 3 函数，best of 3；本轮回归 0.94x） | ✅ |
| 2 | trace 数据正确率抽检 ≥ 98% | **100.0%**（`opencharm-probe check`，8 项抽检全命中；53 单测全绿） | ✅ |
| 3 | 采集对用户无感（运行方式不变） | shell 运行按钮一键运行即采集（P2-T06）；摘要仅 stderr 一行，`OPENCHARM_PROBE_QUIET=1` 可关；未设 `AUTOSTART` 时探针零介入（单测覆盖） | ✅ |
| 4 | trace 库在重复运行下稳定（不膨胀、不损坏） | 跨运行 upsert 累加（单测覆盖）；陈旧标记 + clean 命令（P2-T07）防膨胀 | ✅ |

## 2. Phase 2 任务交付清单

| 任务 | 状态 | 交付物 |
|---|---|---|
| P2-T01 probe 包骨架 | ✅ | `probe/` uv 管理，零第三方依赖，CLI + 配置加载 |
| P2-T02 PEP 669 采集核心 | ✅ | 发现窗口 + 局部事件 + 静音降采样；异常路径完整记录 |
| P2-T03 类型紧凑表示 | ✅ | 模块+类名 / 容器结构指纹 / shape_fingerprint |
| P2-T04 完整采样限流 | ✅ | 模块白/黑名单（glob，黑名单优先）+ `max_call_depth`（超限只计 hits） |
| P2-T05 SQLite trace 库 | ✅ | `~/.opencharm/traces/<project-hash>.db`，跨运行累加 |
| P2-T06 shell 运行按钮集成 | ✅ | `lsp.rs` `run_script` 注入探针环境；探针缺席不拖垮脚本；摘要中性色透传 |
| P2-T07 trace 库管理 | ✅ | 陈旧标记（mtime 检测，自动迁移旧库）+ `clean` 命令（--days/--stale/--all-runs） |
| P2-T08 开销与正确性基准 | ✅ | `bench_probe.ps1` 开销基准 + `check` 命令（期望文件比对，--uv 支持目标 venv） |
| P2-T09 Gate C 评审 | 本报告 | 指标全部达标，待签署 |

## 3. 关键实测数据

### 3.1 开销（Gate C 指标 1）

```
=== plain (best of 3) ===   plain best: 33.0 ms
=== probed (best of 3) ===  probed best: 31.0 ms
=== overhead ratio: 0.94x (Gate C limit 1.5x) ===  PASS
```

历史记录：初版 2.42x → 发现窗口（时间制）4.97x → 自适应关窗 + 双局部事件 + 静音全清 **1.00x**。本轮（P2-T04/T07/T08 后）回归 0.94x——限流改动未引入回退（测量噪声范围内）。

### 3.2 正确率抽检（Gate C 指标 2）

```
$ opencharm-probe check bench_probe.py --uv
[opencharm-probe] 抽检 8 项 · 命中 8 · 正确率 100.0%（阈值 98.0%）
```

抽检项覆盖：参数类型（str）、返回类型（`dict[str, str|list]` 容器指纹、`Callable`）、闭包/装饰器（`register.<locals>.deco`）、动态分发（`make_fetcher` 工厂）。期望文件：`bench/sample/unannotated_scraper/probe_expect.json`。

### 3.3 单测

53 项全绿（compact / monitor / store / store_manage / e2e / inject / check），覆盖：闭包、装饰器、生成器、异常路径、varargs/kwargs、默认参数、静音降采样、白/黑名单、深度限流、陈旧标记、旧库迁移、clean、check 闭环。

## 4. 已知限制（不阻塞 Gate C）

- 同进程 `run` 模式下目标脚本依赖需在 probe venv 可用（文档已注明用 `inject`/`check --uv`）；
- `PYTHONPATH` 注入会遮蔽目标 venv 自身的 sitecustomize（显式运行场景可接受）；
- 类方法/闭包 qualname 带 `<locals>` 段（Phase 3 消费时处理）；
- 陈旧标记基于文件 mtime（秒级精度，编辑后未运行的场景由下次运行兜底）。

## 5. 结论

Phase 2 全部任务（P2-T01~T08）交付完成，Gate C 四项验收标准实测达标。**建议通过 Gate C 评审，进入 Phase 3（混合智能期）。**

---

签署：产品负责人 ____________ 日期：____________
