# 参与贡献 Montauri

首先感谢你愿意为 Montauri 出一份力。本文件写清**怎么把环境跑起来、门禁有哪些、PR 怎么发**；动代码前请先读 [`AGENTS.md`](AGENTS.md)（架构铁律 + 分语言代码规范），那是比本文件更硬的上位约束。

> 当前定位：面向「FastAPI + 爬虫 + 小脚本」开发者的高性能 · 轻量 Python IDE，**仅支持 Windows 10/11（x64）**（Tauri 2 + ConPTY + WebView2；probe 与 CI 均假定 Windows 路径）。

## 一、环境准备

工具链版本锁在 [`ci/versions.toml`](ci/versions.toml)，升级任何组件必须 PR + bench 回归全绿：

| 工具 | 版本 | 说明 |
|---|---|---|
| Python | 3.13.7 | uv 管理（`uv python install 3.13`） |
| uv | 0.10.11 | 包与环境管理 |
| Rust | 1.96.0 | `x86_64-pc-windows-msvc`（需 MSVC Build Tools） |
| Node.js | 22.12.0 | 前端（含 npm 10.9.2） |
| WebView2 Runtime | Evergreen | Win11 内置；Win10 装官方运行时 |

```powershell
git clone <repo-url>
cd Montauri

# 前端依赖
cd shell && npm install && cd ..

# Python 探针（零第三方运行时依赖；dev 仅 pytest）
cd probe && uv sync && cd ..

# 运行时 LSP（联调 shell 前必须 build，cargo test 不刷新 shell 调用的 exe）
cd intel && cargo build -p montauri-intel && cd ..
```

调试器 `debugpy` 随包分发，**不入库**：首次本地出包/跑 CI 前先执行 `tools/fetch-debugpy.ps1`（按 `ci/versions.toml` 的 sha256 锁定拉取到 `vendor/debugpy/`）。

## 二、目录职责（改动前先找对位置）

| 目录 | 内容 | 规范 |
|---|---|---|
| `shell/` | Tauri 2 + Monaco 外壳（前端 Vanilla TS + Vite；后端 Rust） | [TS 规范](.codebuddy/rules/typescript-code-style/RULE.mdc) · [Rust 规范](.codebuddy/rules/rust-code-style/RULE.mdc) |
| `probe/` | montauri-probe：PEP 669 `sys.monitoring` 运行时采样（独立 Python 包，零第三方依赖） | [Python 规范](.codebuddy/rules/python-code-style/RULE.mdc) |
| `intel/` | montauri-intel：消费 trace 库的运行时智能 LSP（独立 Rust 进程） | 独立 workspace，勿侵入 |
| `bench/` | 基准项目集 + 指标采集脚本 | 红线数据只增不改 |
| `ci/` | 版本锁定基线（versions.toml）+ 预算（budgets.toml） | 阈值调整必须显式 PR 写理由 |
| `docs/` | 方案 / 开发计划 / ADR / 验收记录 | 入口见 [delivery-overview.md](docs/delivery-overview.md) |
| `tools/` | 构建辅助脚本（fetch-debugpy.ps1 / audit_tokens.py） | — |

**架构第一原则**：`probe` 与 `intel` 是完全独立的进程/包，一切自研组件都不侵入外壳与静态引擎内核。补全四层合并的 sortText 段位（模板 `0xx` → intel `1xx` → 静态 `2xx` → 关键字 `3xx`）不可打乱。

## 三、测试分层（提交前按改动面跑）

| 层 | 命令 | 何时必跑 |
|---|---|---|
| 前端单测 | `cd shell && npm test` | 任何 `shell/src` 改动 |
| Rust 单测 | `cd shell/src-tauri && cargo test` | 任何 Rust 改动（**改完必须 `cargo check`/`cargo test` 通过再交付**） |
| probe 单测 | `cd probe && uv run pytest` | 任何 probe 改动（改 `monitor` 必跑 `test_monitor` 回归） |
| intel 单测 | `cd intel && cargo test` | 任何 intel 改动 |
| 浏览器 e2e | `cd shell && npm run e2e` | 涉及前端交互的改动（串行 workers=1） |
| 真机 e2e | `powershell -File shell/e2e-real/run-real-all.ps1` | 涉及 DAP / LSP 桥 / PTY / 真实 Rust 逻辑的改动（约 8 min，本机跑批） |

## 四、门禁纪律（红线，不接受「先合再修」）

1. **预算不可静默抬高**：`ci/budgets.toml` 的巨型文件行数、`#[tauri::command]` 数量、产物体积均为预算，`shell/scripts/budget-check.mjs` 超限即 FAIL；调整阈值必须显式 PR 写清理由（章程见 [ADR-0010](docs/adr/0010-performance-lightweight-charter.md)）。
2. **改 `shell/src` 后**：先 `npm run build` 再跑 `node shell/scripts/budget-check.mjs`（产物体积项带 dist 新鲜度校验）。
3. **UI 视觉**：色值/字号/间距走语义 token，`python tools/ui/audit_tokens.py` 门禁必须过。
4. **runtime 开销红线**：probe 采样开销 < 1.5x（当前 1.35x），改采集路径必须 bench 回归。
5. 杀子进程必须 `util::kill_process_tree`；DAP 保持 stdio adapter 模式，禁止退回 TCP `--listen`；`\\?\` verbatim 路径必须剥前缀——细节见 Rust 规范红线。

## 五、PR 规矩

- **短分支 PR，一个 PR 一件事**；主干开发（master）。
- Commit 用约定式前缀：`feat(shell|probe|intel|docs|ci):` / `fix(...):` / `chore(...):`，正文写清"为什么"。
- PR 前自查（模板会自动带出）：CI 全绿、涉及面单测补齐、预算门禁 PASS、文档同步（`docs/` 或验收记录）。
- 新功能先查 [`docs/dx_features_backlog.md`](docs/dx_features_backlog.md) 与 [`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) 的排期口径，避免重复建设；重大设计决策先写 ADR（`docs/adr/`）。
- 临时脚本/产物请放 `scripts/_tmp/`（已 gitignore），不要散落在仓库各处。

## 六、文档入口

| 想了解 | 去看 |
|---|---|
| 整体交付与文档地图 | [`docs/delivery-overview.md`](docs/delivery-overview.md) |
| 当前排期与不做清单 | [`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) |
| 技术债登记 | [`docs/tech-debt.md`](docs/tech-debt.md) |
| 新手上手（用户向） | [`docs/onboarding_guide.md`](docs/onboarding_guide.md) |

再次感谢——无论是代码、文档、Issue 还是使用反馈。
