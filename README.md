# Montauri

面向「FastAPI + 爬虫 + 小脚本」开发者的**高性能 · 轻量 Python IDE**。

- **一等目标**：性能与体积与功能正确性同权，任何功能不得突破 `ci/budgets.toml` 预算（章程见 [`docs/adr/0010-performance-lightweight-charter.md`](docs/adr/0010-performance-lightweight-charter.md)）
- **外壳**：**Tauri 2 + Monaco**（2026-08-20 裁决，取代原 Zed 方案）
- **静态语义**：Pyrefly（默认）/ basedpyright（备选），第一天实现可切换
- **差异化核心**：运行时类型采样（PEP 669 `sys.monitoring`）+ 自研运行时智能 LSP（`montauri-intel`）
- **调试**：debugpy（随应用打包分发，版本锁 `ci/versions.toml`）+ 自研轻量 DAP 桥（stdio adapter 模式，见 ADR-0004）
- **功能范围**：补全 / 跳转 / Hover / 诊断 + 脚本运行与 traceback 点击跳转 + 调试（断点 / 单步 / 调用栈 / 变量，最小闭环）

## 快速开始（用户）

**系统要求**：Windows 10 / 11（x64），WebView2 Runtime（Win11 内置，Win10 可装官方运行时）；macOS / Linux 暂不支持。

**三个选择，任选其一：**

| 方式 | 适合谁 | 说明 |
|---|---|---|
| ① 下载安装包 | 绝大多数用户 | Releases 页面获取 NSIS 安装包（`x64-setup.exe`），下一步下一步装完即用；当前账户安装、自动建开始菜单项（首批发布物随开源上线，暂无时用方式②） |
| ② 自行打包 | 想要最新 master 的用户 | 仓库根执行 `powershell -File .\build-release.ps1 -SkipNpmInstall`，产物在 `shell/src-tauri/target/release/bundle/nsis/` |
| ③ 从源码开发运行 | 想参与贡献 | 见 [CONTRIBUTING.md](CONTRIBUTING.md) |

**首次启动**：应用会自动检测 `uv` / `pyrefly` 等外部工具，缺失时弹出「环境引导」，一键装到用户目录（不动系统）；装完即可获得完整的静态语义能力。运行脚本前建议先在设置面板确认工作区使用的 Python 解释器（或 venv）。

**三分钟上手**（新建项目 → 装依赖 → 运行 → 调试实战）：

- 打开一个含 `pyproject.toml` 或 `.py` 的目录，欢迎页与侧栏文件树会引导完成基础操作；
- 运行：编辑器右上角 ▶ 或运行菜单（脚本 / 项目两种模式，输出进统一 PTY 控制台，traceback 的 `File "...", line N` **可点击跳转**）；
- 调试：断点 / 单步 / 调用栈 / 变量（debugpy 已随包分发，零额外安装）；
- 测试：侧栏「测试」视图自动发现 pytest 用例，绿箭头逐用例运行/调试，失败一键跳转；
- 更多细节见 [`docs/onboarding_guide.md`](docs/onboarding_guide.md)。

**数据与日志**：应用数据在 `%USERPROFILE%\.montauri\`（`MONTAURI_DATA_ROOT` 可重定向），日志目录同上 `logs\`，设置面板 →「日志」可调级别并一键打开目录。

## 文档索引

| 文档 | 说明 |
|---|---|
| [`docs/delivery-overview.md`](docs/delivery-overview.md) | **交付总览（现行入口）**：20 个功能域 × 交付日期 × 计划真源 × 验收记录 × 状态、文档地图（按角色读）、已知文档不一致登记、门禁与复核命令、新会话上手路径 |
| [`docs/python_ide_tech_plan_v3.md`](docs/python_ide_tech_plan_v3.md) | **技术方案 v3（现行）**：Tauri+Monaco 外壳架构 |
| [`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) | **开发计划 v2（现行）**：Phase 重排与当前进度 |
| [`docs/runtime_profiler_dev_plan.md`](docs/runtime_profiler_dev_plan.md) | **内置 Profiler（A2）开发计划 v0.1（待裁决后开工）**：默认关的「性能模式」形态、PR 拆分 P1–P5、预算占位与口径红线；**立项前的开销门槛实验数据见 `bench/reports/a2-overhead-lab.md`** |
| [`docs/python_debug_dev_plan.md`](docs/python_debug_dev_plan.md) | **调试功能开发计划 v1.3（已实施）**：DAP / debugpy 集成，D1–D5 |
| [`docs/debug_acceptance_record.md`](docs/debug_acceptance_record.md) | 调试功能验收记录（D1–D5 / Gate E） |
| [`docs/python_run_dev_plan.md`](docs/python_run_dev_plan.md) | **运行功能交互设计 v3.4（现行，已实施）**：脚本/项目运行 + 统一 PTY 控制台 |
| [`docs/run_acceptance_record.md`](docs/run_acceptance_record.md) | 运行功能验收记录（M1–M4 / §19 风险闭环） |
| [`docs/python_run_migration_plan.md`](docs/python_run_migration_plan.md) | 运行迁移实施计划（M1–M4 已全部完成） |
| [`docs/data-directory-layout-v2.md`](docs/data-directory-layout-v2.md) | 数据目录与部署方案（现行，已实施） |
| [`docs/disk-space-plan.md`](docs/disk-space-plan.md) | 系统盘占用治理方案（已实施） |
| [`docs/tech-debt.md`](docs/tech-debt.md) | 技术债登记（待处理 + 已归档） |
| [`docs/ui_design_improvement_plan.md`](docs/ui_design_improvement_plan.md) | **界面设计改进计划 v2.1（已全部完成：30/30 项 + 2 条清单外遗留，共十批）**：UI 缺陷、设计系统一致性、ARIA 无障碍与响应式打磨；§7 有逐批进度记录与人工抽查清单 |
| [`docs/ui_premium_design_report.md`](docs/ui_premium_design_report.md) | 视觉「高级感」诊断与改造方案 v1.2（方向已批准）：品牌色系统一、五档表面阶梯与真实层级、字体替换、Monaco 主题同步；含实算对比度数据与六批落地路线图。**执行真源见 [`docs/ui_premium_dev_plan.md`](docs/ui_premium_dev_plan.md)** |
| [`docs/ui_premium_dev_plan.md`](docs/ui_premium_dev_plan.md) | **UI 视觉「高级感」改造执行计划 v1.0（六批全部落地）**：批 1 ADR-0005 单色相轴 / 2a 表面五档阶梯 / 2b 抬升面归属 / 3 JetBrains Mono 随包 / 4 Monaco 自定义主题 / 5 边框·曲线·圆角·材质；§4 门禁 · §6 批次入口 · §7 逐批实施记录 · §8 方案与实际的 8 处偏差登记 |
| [`docs/markdown_preview_dev_plan.md`](docs/markdown_preview_dev_plan.md) | Markdown 预览开发计划 v1.0（已实施）：编辑区分栏实时预览 + GFM / 图片 / 链接 |
| [`docs/live_templates上下文轴修订稿.md`](docs/live_templates上下文轴修订稿.md) | Live Templates 上下文位置轴修订稿 v1.1（相位 A 已实现）：容器 × 位置 × 词法三维 |
| [`docs/pycharm_feature_research_report.md`](docs/pycharm_feature_research_report.md) | PyCharm 功能调研报告 v1.1（调研，非排期依据） |
| [`docs/arg_var_fusion_dev_plan.md`](docs/arg_var_fusion_dev_plan.md) | **实参位变量补全 · 运行前融合层开发计划 v1.0（FUSION-1，已实施）**：下拉候选 + ghost text 灰字 + hover 类型匹配三层 tier 排序；探针实证链（pyrefly 空前缀双断路 / Monaco inline-suggest 双池语义）与保守边界见 §0/§7 |
| [`docs/vscode_extension_research_report.md`](docs/vscode_extension_research_report.md) | **VS Code Python 插件调研报告 v1.0（调研，非排期依据）**：榜单前 10 名逐项源码核对（9 项已有等价物）、4 项真空白借鉴建议（Error Lens 行内诊断 / Scratch 执行 / 路径补全 / CSV 查看器）、5 项明确不学 |
| [`docs/plugin_system_design.md`](docs/plugin_system_design.md) | 插件系统设计方案 v0.2（方向稿 + 工具切片详细设计，**切片已实现**） |
| [`docs/devtools_plugin_guide.md`](docs/devtools_plugin_guide.md) | 开发工具插件作者指南 v1（manifest / host API / kit 积木 / 热重载） |
| [`docs/devtools_plugin_acceptance_record.md`](docs/devtools_plugin_acceptance_record.md) | 工具插件切片验收记录（PR-1~4 / 490 测试 / 决策落地核对） |
| [`docs/edit_prediction_research_plan.md`](docs/edit_prediction_research_plan.md) | 低延迟编辑预测研究方案 v0.1（探索中） |
| [`docs/dep_health_dev_plan.md`](docs/dep_health_dev_plan.md) | 依赖健康开发计划（已实施）：依赖风格/扫描/修复 + 忽略清单 |
| [`docs/git_improvement_report.md`](docs/git_improvement_report.md) | Git 集成交付报告：远程/worktree/rebase/cherry-pick/stash/log/blame 等增强 |
| [`docs/menubar_improvement_plan.md`](docs/menubar_improvement_plan.md) | 菜单栏改进计划 v1.4（**全部完成 6/16**）：菜单栏结构与命令面板收官；§6 留有可复审的排期与验收依据 |
| [`docs/sqlite_tool_dev_plan.md`](docs/sqlite_tool_dev_plan.md) | **SQLite 数据库工具开发文档 v1.6（B3 唯一真源，已交付）**：v1.0 PR-1~4（侧栏四段视图 / rusqlite bundled / 默认只读 / Rust↔TS 数据契约 / 逐 PR 实施记录 §9.1~§9.4）+ 迭代 3 编辑器 Tab 化重设计（方案见 §17）；**§17.8 v1.4 真机验收 18/18 PASS + 双主题截图** |
| [`docs/toolbox_dev_plan.md`](docs/toolbox_dev_plan.md) | **工具箱开发计划 v1.0（待评审）**：HTTP Client / 结构化运行日志 / TODO 与 Markdown 增强（**SQLite 章已于 2026-10-02 迁出至 `sqlite_tool_dev_plan.md`**，此处仅留指向） |
| [`docs/improvement_and_roadmap_report.md`](docs/improvement_and_roadmap_report.md) | **现状评估 · 改进建议与未来功能规划 v1.5（维护态清理版）**：规模与质量底座、未闭环建议（P1-1 可观测性 / P1-2 更新通道 / P1-6 插件 v2 等）、候选池剩余条目（A6 / B1 / B2 / C 类）与路线图；§7 明确不做清单；§9 含**取数禁则**。**P0 档与 A1~A5 / B3~B6 已全部关闭并移出**（记录见 [`delivery-overview.md`](docs/delivery-overview.md)） |
| [`docs/onboarding_guide.md`](docs/onboarding_guide.md) | **新手指南（面向用户）**：三分钟上手（新建项目 / 依赖 / 运行 / 调试入口） |
| [`docs/onboarding_dev_plan.md`](docs/onboarding_dev_plan.md) | 新手引导 + uv 速查卡开发计划 v1.3（PR-S1/S2/S4 已交付；PR-S3 推迟 · PR-S5 不排期） |
| [`docs/multi_window_dev_plan.md`](docs/multi_window_dev_plan.md) | 多窗口开发计划 v0.1（阶段 0/1/2 方案；⚠️ 阶段 0 代码已落地，状态栏未回填） |
| [`docs/git_clone_dev_plan.md`](docs/git_clone_dev_plan.md) | Git 远端克隆开发计划 v1.0（已实施 2026-10-01，Git 迭代 6 · P3-1） |
| [`docs/python_library_support_dev_plan.md`](docs/python_library_support_dev_plan.md) | 库特别支持开发计划 v1.3（已实施）：P0 四件套 + P1 五件套（re 三件套 / 格式串 / JSON / 求值桥 / 脚本参数表单），v1.3 收口互斥性（10 项） |
| [`docs/python_library_support_research.md`](docs/python_library_support_research.md) | 库特别支持调研报告 v1.5（**非排期依据**）：逐库价值/成本矩阵、`re` 三件套论证；§8 的 pytest「不复议」已于 2026-10-16 作废（裁决变更记录见该行） |
| [`docs/pyrefly_pydantic_support_plan.md`](docs/pyrefly_pydantic_support_plan.md) | pyrefly Pydantic 支持完善计划 v0.2：撤销 basedpyright 推荐 + 自研改名传播补充（references=0 场景） |
| [`docs/pycharm_ux_review_and_proposal.md`](docs/pycharm_ux_review_and_proposal.md) | PyCharm UX 对标与改进提案 v1.0（**非排期依据**）：§10 裁决表；**F-1 pytest 裁决沿革**（2026-09-25 维持非目标 → 2026-10-16 重新裁决：做测试运行器） |
| [`docs/pytest_dev_plan.md`](docs/pytest_dev_plan.md) | **pytest 测试运行器开发计划 v1.0（2026-10-16 立项，T1–T5 计划中）**：测试发现（`--collect-only -q` 按需子进程）+ 侧栏测试树 + 绿箭头逐用例运行/调试 + junitxml 结果状态合入；裁决真源 `dev_plan_v2` v2.2 §1.1 |
| [`docs/pycharm_framework_support_report.md`](docs/pycharm_framework_support_report.md) | PyCharm 框架支持调研报告 v1.2（**非排期依据**） |
| [`docs/dx_features_backlog.md`](docs/dx_features_backlog.md) | DX 顺手功能储备（**已全部收官**）：第一/第二梯队落地记录，§6.8 进度快照 |
| [`docs/e2e_divergence_ledger.md`](docs/e2e_divergence_ledger.md) | e2e 分歧台账（mock ↔ CDP 真机）：D-001~D-007 根因与避坑速查；真机覆盖的论据来源 |
| [`docs/i18n.md`](docs/i18n.md) | **国际化实施说明（zh-CN / en-US 双语，已交付）**：扁平 key 语言包、20 批动态文案抽取、三步新增文案流程与踩坑记录 |
| [`docs/adr/`](docs/adr/) | 技术决策记录（ADR）：0003 自研 LSP 桥 · 0004 DAP + debugpy 随包 · 0005 品牌/交互色统一 · **0010 性能与轻量章程（一等目标）** |

> 技术方案与开发计划冲突时，以开发计划为准并反馈修订。

## 仓库结构

```
Montauri/
├── shell/                   # ✅ Tauri 2 + Monaco 外壳（Phase 1 交付，验收达标）
├── bench/                   # ✅ 基准项目集 + 指标采集脚本
├── ci/                      # ✅ 版本锁定基线
├── docs/                    # 方案、开发计划、ADR、技术债登记
├── probe/                   # ✅ montauri-probe（Phase 2 交付，Gate C 达标）
├── intel/                   # ✅ montauri-intel（Phase 3 已基本交付，见 intel/README.md）
└── tools/                   # 构建辅助脚本（fetch-debugpy.ps1 拉取打包 debugpy；edit_history_stats.py 统计编辑历史）
```

## 架构第一原则

- `probe` 与 `intel` 是**完全独立的进程/包**，不依赖外壳内部 API。
- 一切自研组件都是独立进程或独立包，不侵入外壳与静态引擎内核。
- 主干开发 + 短分支 PR；CI 全绿才可合并。

## 打包发布

全新 Windows 系统开箱即用依赖「随包分发 + 首次启动引导」，已落地（Phase 4 第 1~4 步）：

- **外部命令解析**：`uv` / `pyrefly` / `ruff` / `git` 统一经 `shell/src-tauri/src/tool_paths.rs` 定位（环境变量 → `~/.montauri/bin` / `~/.local/bin` → 系统 PATH）；
- **自研组件随包分发**：`montauri-intel` 与 `probe/src` 经 `tauri.conf.json` 的 `bundle.resources` 打进安装包；运行时分别由 `lsp.rs::locate_intel_binary` 与 `run_env.rs::locate_probe_src` 查找（环境变量 → `<data_root>/runtime` → Tauri 资源目录 → dev 仓库布局）；
- **调试器随包分发**：`debugpy`（锁定版本 + 五个 sha256，见 `ci/versions.toml [debugger]`）经 `tools/fetch-debugpy.ps1` 拉取合并到 `vendor/debugpy/`（`.gitignore` 不入库），再经 `bundle.resources` 打进安装包，运行时按 `dap.rs::locate_debugpy_dir` 四级查找（同上）；零安装、零网络、切换 venv 无感（见 ADR-0004）；
- **首次启动环境引导**：`shell/src-tauri/src/toolchain.rs` 提供探测与一键安装；缺失 `uv` / `pyrefly`（或 `basedpyright`）时，前端弹「环境引导」确认框，安装进度经 `toolchain-stdout/stderr` 流式展示，工具装到用户目录（不影响系统）。

一键打包（在项目根执行）：

```powershell
# PowerShell 版本
powershell -File .\build-release.ps1
# 或 cmd 版本（功能等价，均支持 -SkipNpmInstall 跳过 npm install）
.\build-release.bat
```

安装包输出：`shell/src-tauri/target/release/bundle/nsis/`；工具链版本见 `ci/versions.toml`。

## 日志

统一日志工具（`shell/src-tauri/src/logging.rs`，设置面板「日志」分类可配置）：

- **落盘位置**：`~/.montauri/logs/montauri.log`（固定用户主目录，release / 打包后仍可稳定定位）。
- **级别过滤**：`error` / `warn` / `info` / `debug`，按设置阈值过滤（默认 `info`）。
- **大小轮转**：单文件超 1 MiB 自动切成 `.1` / `.2` …，保留 `log_keep` 份（默认 3）。
- **stdout 双写**：受 `log_stdout` 开关控制（dev 终端可见；release 无控制台可关）。
- **防黑盒**：关闭「启用日志」后，`error` 级仍会落盘。

配置项（`settings.json` → 设置面板 → 日志）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `log_enabled` | `true` | 总开关（关闭后仅 error 落盘） |
| `log_level` | `"info"` | 阈值：`error` / `warn` / `info` / `debug` |
| `log_keep` | `3` | 轮转保留份数（1-10） |
| `log_stdout` | `false` | 是否同时输出 stdout |

排查线上问题：设置面板 → 日志分类 → 调高级别到 `debug`，或点「打开日志目录」直接定位日志文件。

## 已知边界

- **Pydantic 构造校验**：默认引擎 pyrefly 不对 `BaseModel` 子类的构造调用做静态红线；Montauri 以自研第四桶诊断（`montauri-pydantic`）补齐**类型错 / 缺失必填 / 未知字段**三类检查（设置 → Pydantic 构造校验，默认开）。检查为轻量文本解析（非完整类型系统）：跨文件继承链不合并、多行构造调用跳过、复杂表达式跳过；alias 字段按别名放行。实测与上游跟踪见 `bench/reports/pydantic-engine-probe.md`。
- **Pydantic 字段重命名**：pyrefly 对此类字段 references=0（只改声明处）；Montauri 已自研**改名传播补充**——rename 时扫描 `Model(field=` 构造调用点并入编辑集（引擎结果优先去重，扫描 2s 超时自动降级）。basedpyright 引擎下两者均由引擎自身覆盖，自研层自动旁路。计划与实施记录见 [`docs/pyrefly_pydantic_support_plan.md`](docs/pyrefly_pydantic_support_plan.md)。
- **运行时补全（intel）只有自证数据，未与 PyCharm 做过横向对比**：自测口径下 **23/23 = 100%**（期望 label 出现在 top-5，见 `bench/reports/gate-d-runtime-completion.md`）。原计划的「PyCharm 同场景人工横向对标（23 点）」**已于 2026-10-07 撤下**——本机无 PyCharm，按二选一截止规则执行（v1.4 死线到期撤项；撤项与收口记录见 [`docs/delivery-overview.md`](docs/delivery-overview.md) v1.14）；工作单 `bench/reports/gate-d-ab-worklist.md` 保留归档，供将来换对照组（如 VS Code + Pylance）时复用。**⇒ 本项目没有"比 PyCharm 更准"的证据，任何对比表述都必须限定为"在自有样例集上"。** 相关降权参数（`STALE_HITS_DIVISOR = 2`）仍是**建议值**：真实项目样本已跨 3 个项目累计 **497 条函数观测**（见 `bench/reports/trace-stats-cumulative.md`），未达「跨 ≥2~3 个项目累计 ≥1000 条」的复核门槛，故未落值；门槛口径与收口处置（不再专门采样，改为日常 IDE 使用自然累积）见 `bench/reports/trace-sample-threshold.md`。

## 当前状态

- 项目阶段：**Phase 1 / Phase 2 / Phase 3（montauri-intel）均已交付**；当前进入 **Phase 4（持续打磨）**，进度见 `docs/python_ide_dev_plan_v2.md` §7。
- **调试功能（DAP / debugpy 最小闭环）已交付**：D1–D5 / Gate E 见 [`docs/debug_acceptance_record.md`](docs/debug_acceptance_record.md)；真机 CDP 验收 **12/12 PASS**（含三态互斥与改键生效）；**真安装包验收已完成**（出包 → 安装 → 对安装后的程序实测 **7/7 PASS**，见 `e2e-real/release-real.cjs`）。
- **运行功能迁移（M1–M4）已交付**：脚本/项目两种运行 + 统一 PTY 运行控制台 + 多实例并行 + 运行历史按实例归属；交互口径 [`docs/python_run_dev_plan.md`](docs/python_run_dev_plan.md) v3.4、验收记录 [`docs/run_acceptance_record.md`](docs/run_acceptance_record.md)。
- **界面设计改进计划已收官**（十批，30/30 项 + 2 条遗留）：按钮体系 / scale token / Tooltip 双轨收敛 / ARIA 语义（tree·tabs·dialog·tooltip·menu）/ 浅色主题对比度达标 / 响应式下限 / 字号字体族全局跟随设置；沉淀的硬规则已固化到 `.codebuddy/rules/typescript-code-style`，逐批可见变化的人工抽查清单见计划文档 §7。
- **国际化（zh-CN / en-US 双语）已交付**：index.html 静态骨架、Rust 错误提示与全部功能域动态文案均已纳管（20 批抽取，en/zh 词条编译期对齐 + 单测兜底）；设置 → 外观 → 语言即时切换，实施与新增文案流程见 [`docs/i18n.md`](docs/i18n.md)。
- 现行方案：[`docs/python_ide_tech_plan_v3.md`](docs/python_ide_tech_plan_v3.md) · 现行计划：[`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) · 技术债登记：[`docs/tech-debt.md`](docs/tech-debt.md)。

## 参与贡献

欢迎 Issue / PR / 文档改进 / 使用反馈：

- 贡献指南（环境准备 / 测试分层 / 门禁纪律 / PR 规矩）：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 行为准则：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- 安全漏洞请**私密**报告（勿开发布 Issue）：[`SECURITY.md`](SECURITY.md)
- 架构铁律与分语言代码规范：[`AGENTS.md`](AGENTS.md) · [`.codebuddy/rules/`](.codebuddy/rules/)

## License

本项目以 [MIT License](LICENSE) 开源。随包分发的 [JetBrains Mono](shell/public/fonts/OFL.txt) 字体遵循 SIL OFL 1.1。