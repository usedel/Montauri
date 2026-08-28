# OpenCharm 交接文档：Phase 2 完成 → Phase 3（opencharm-probe）

> 日期：2026-08-21 · 状态：**Phase 2 全部任务（P2-T01~T08）完成，Gate C 指标全部达标（见 `docs/gate-c-acceptance.md`，待签署）**
> **本文档是新会话的唯一入口**：只读本文即可完整接续，无需翻阅历史会话。
> 上游文档：`python_ide_tech_plan_v3.md`（现行技术方案）、`python_ide_dev_plan_v2.md`（现行开发计划）、`adr/0002`（换壳裁决）、`adr/0003`（LSP 桥）。

## 1. 一句话现状

opencharm-probe **Phase 2 全部交付**：PEP 669 采集（开销 **1.00x**，红线 1.5x）、类型紧凑表示、SQLite trace 库（跨运行累加 + 陈旧标记 + clean）、CLI 五命令（run/show/inject/clean/check）+ shell 运行按钮集成（P2-T06）。53 个单测全绿，bench 开销 0.94x、正确率抽检 100%。**Gate C 指标全部达标（`docs/gate-c-acceptance.md`），下一步：签署评审 → Phase 3（opencharm-intel）。**

## 2. Phase 2 验收状态（2026-08-21）

| 任务 | 结果 |
|---|---|
| P2-T01 probe 包骨架 | ✅ `probe/` uv 管理，零第三方依赖，CLI + 配置加载 |
| P2-T02 PEP 669 采集核心 | ✅ 发现窗口 + 局部事件 + 静音降采样；异常路径完整记录 |
| P2-T03 类型紧凑表示 | ✅ 模块+类名 / 容器结构指纹 / shape_fingerprint |
| P2-T05 SQLite trace 库 | ✅ `~/.opencharm/traces/<project-hash>.db`，跨运行累加 |
| P2-T04 完整采样限流 | ✅ 模块白/黑名单（glob，黑名单优先）+ `max_call_depth`（超限只计 hits） |
| P2-T06 shell 运行按钮集成 | ✅ `lsp.rs` 注入探针环境；探针缺席不拖垮脚本；摘要中性色透传 |
| P2-T07 trace 库管理 | ✅ 陈旧标记（mtime 检测 + 旧库自动迁移）+ `clean` 命令 |
| P2-T08 开销与正确性基准 | ✅ `bench_probe.ps1` + `check` 命令（100.0% 抽检正确率） |
| Gate C：探针开销 < 1.5x | ✅ **1.00x**（本轮回归 0.94x） |
| Gate C：trace 正确率抽检 ≥ 98% | ✅ **100.0%**（check 命令，8 项全命中）+ 53 单测全绿 |

## 3. 仓库现状

```
open-charm/
├── shell/                    # ✅ Tauri 2 + Monaco 外壳（Phase 1 交付，可用）
├── probe/                    # ✅ opencharm-probe（Phase 2 第一批交付）
│   ├── src/opencharm_probe/
│   │   ├── cli.py            # run / show / inject 三命令
│   │   ├── monitor.py        # PEP 669 采集核心（发现窗口策略）
│   │   ├── compact.py        # 类型紧凑表示 + shape_fingerprint
│   │   ├── sink.py           # 内存聚合（运行期零 I/O）
│   │   ├── store.py          # SQLite trace 库（upsert 累加）
│   │   ├── runner.py         # 同进程运行编排
│   │   ├── autostart.py      # 注入模式引导（atexit 落库）
│   │   └── config.py         # 配置加载（文件/环境变量/CLI）
│   ├── src/sitecustomize.py  # 注入入口（顶层模块，PYTHONPATH 生效）
│   ├── tests/                # 34 个单测（compact/monitor/store/e2e/inject）
│   └── README.md             # 架构/语义备忘/已知限制/Gate C 状态
├── bench/
│   ├── sample/unannotated_scraper/
│   │   ├── bench_probe.py    # 开销基准脚本（2000 轮 × 3 函数）
│   │   └── bench_probe.ps1   # 基准驱动（plain vs probed，输出开销比）
│   └── ...
├── ci/versions.toml          # ✅ 版本锁定基线
└── docs/                     # 方案/计划/ADR/验收记录
```

## 4. 关键技术资产（新会话必读，避免重复踩坑）

### 4.1 PEP 669 实测语义（Python 3.13.7，全部实测确认）

1. **tool id 范围 0-5**（不是 PEP 文档暗示的 6+），回退链 5→0；
2. `PY_START` 回调内 `sys._getframe(1)` 即被监控函数帧，`f_locals` 已含实参+默认值；
3. 回调返回 `MISSING` 对**全局**事件无效（不能禁用），只能回调内快速返回；
4. 全局+局部同开为 **OR 语义**（单次触发）——局部事件可安全替代全局；
5. `RAISE` 沿异常传播链每帧触发一次；C 层异常（KeyError 等）也触发；生成器耗尽的 StopIteration 不触发；
6. 生成器：`PY_START` 首次 resume 触发一次，`PY_RETURN` 在 StopIteration 触发。

### 4.2 开销优化路径（2.42x → 1.00x 的三步）

| 步骤 | 开销 | 关键改动 |
|---|---|---|
| 初版（全局事件常开） | 2.42x | 每次调用都派发回调 + realpath 分类 |
| 发现窗口（时间制） | 4.97x | 短脚本全程在窗口内，反而更差 |
| **自适应关窗 + 双局部事件 + 静音全清** | **1.00x** | 见下 |

最终策略：
- 全局 `PY_START` 仅发现窗口内开启（上限 2s，**连续 2000 次派发无新函数即提前关窗**，每 5s 重开 0.5s）；
- 项目内函数 arm 局部 `PY_START | PY_RETURN`（窗口外库代码零派发）；
- 每函数调用超限（默认 200）→ 静音并**清空全部局部事件**（此后零派发）；
- 每参数位/返回位类型观测上限 100 次（边际价值递减）；
- `RAISE` 常开（异常路径 trace 最有价值，开销可忽略）。

### 4.3 其他实测坑

- **SQLite NULL 主键陷阱**：唯一约束对 NULL 不生效（NULL != NULL），`shape` 列必须存空串而非 NULL，否则 upsert 失效产生重复行；
- **sitecustomize 必须是 sys.path 顶层模块**：放包内不会被自动导入；`inject` 命令把 `probe/src/` 加进 `PYTHONPATH`（含包 + 顶层 sitecustomize.py）；
- **sitecustomize 执行时 `sys.argv` 已就绪**：用 `argv[0]` 守卫区分主脚本进程与 multiprocessing spawn 子进程；
- **`uv run` 透传 PYTHONPATH**（实测确认）——shell 集成时环境变量注入方案可行；
- **项目根内的 `.venv` 必须排除**：否则 site-packages 全被采进来（239 函数 → 5 函数的教训）；目录级分类缓存（同目录文件分类结果一致）；
- **Windows 子进程测试**：`subprocess.run` 必须显式 `encoding="utf-8"`（默认 GBK 解码崩溃）；PowerShell 5.1 把 stderr 当错误，基准脚本用 `OPENCHARM_PROBE_QUIET=1` 抑制探针摘要。

### 4.4 环境基线（`ci/versions.toml`，不变）

Windows · Python 3.13.7（uv 管理）· uv 0.10.11 · Rust 1.96.0 · Node 22.12 · Tauri 2.11.5 · Monaco 0.52.2 · pyrefly 1.2.0 · basedpyright 1.39.10 · ruff 0.16.1。

## 5. Phase 2 后续任务

全部完成（见 §2）。Gate C 验收报告：`docs/gate-c-acceptance.md`（指标全部达标，待产品负责人签署）。

**下一步：Phase 3（opencharm-intel，混合智能期）**——P3-T01 intel 骨架（Rust + tower-lsp）→ P3-T02 trace 索引层（读 SQLite，10 万条 < 2s）→ P3-T03~T05 补全/跳转/hover provider。详见开发计划 §7。

**bench 材料**：`bench/sample/unannotated_scraper/bench_probe.ps1` 一键复测开销；`opencharm-probe check bench_probe.py --uv` 正确率抽检；`opencharm-probe show` 查看 trace。

## 6. 新会话建议流程

1. 读本文档 + `probe/README.md`（架构与语义备忘都在里面）；
2. Gate C 签署（材料已齐：`docs/gate-c-acceptance.md`）；
3. Phase 3 启动：P3-T01 intel 骨架（Rust cargo workspace + tower-lsp，stdio）；
4. 回归材料：`uv run pytest`（probe）+ `bench_probe.ps1`（开销）+ `check --uv`（正确率）。

## 7. 遗留待办（低优先级，不阻塞）

- basedpyright 补全项缺 `insertText`/`detail`（需 `completionItem/resolve` 二段式）——当前 label 插入可用；
- ruff LSP 接入（保存时格式化）——Phase 1 后置项；
- 集成终端（xterm.js）/ Git 状态 / 全局搜索——Phase 4；
- Gate B 正式评审记录（验收数据已齐，待产品负责人签署）；
- probe：`run` 模式下目标脚本依赖需在 probe venv 可用（文档已注明用 `inject`）。
