# OpenCharm

为「FastAPI + 爬虫 + 小脚本」开发者定制的单人自用 Python IDE。

- **外壳**：**Tauri 2 + Monaco**（2026-08-20 裁决，取代原 Zed 方案）
- **静态语义**：Pyrefly（默认）/ basedpyright（备选），第一天实现可切换
- **差异化核心**：运行时类型采样（PEP 669 `sys.monitoring`）+ 自研运行时智能 LSP（`opencharm-intel`）
- **调试**：debugpy（随应用打包分发，版本锁 `ci/versions.toml`）+ 自研轻量 DAP 桥（stdio adapter 模式，见 ADR-0004）
- **功能范围**：补全 / 跳转 / Hover / 诊断 + 脚本运行与 traceback 点击跳转 + 调试（断点 / 单步 / 调用栈 / 变量，最小闭环）

## 文档索引

| 文档 | 说明 |
|---|---|
| [`docs/python_ide_tech_plan_v3.md`](docs/python_ide_tech_plan_v3.md) | **技术方案 v3（现行）**：Tauri+Monaco 外壳架构 |
| [`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) | **开发计划 v2（现行）**：Phase 重排与当前进度 |
| [`docs/python_debug_dev_plan.md`](docs/python_debug_dev_plan.md) | **调试功能开发计划 v1.3（已实施）**：DAP / debugpy 集成，D1–D5 |
| [`docs/debug_acceptance_record.md`](docs/debug_acceptance_record.md) | 调试功能验收记录（D1–D5 / Gate E） |
| [`docs/python_run_dev_plan.md`](docs/python_run_dev_plan.md) | **运行功能交互设计 v3.4（现行，已实施）**：脚本/项目运行 + 统一 PTY 控制台 |
| [`docs/run_acceptance_record.md`](docs/run_acceptance_record.md) | 运行功能验收记录（M1–M4 / §19 风险闭环） |
| [`docs/python_run_migration_plan.md`](docs/python_run_migration_plan.md) | 运行迁移实施计划（M1–M4 已全部完成） |
| [`docs/data-directory-layout-v2.md`](docs/data-directory-layout-v2.md) | 数据目录与部署方案（现行，已实施） |
| [`docs/disk-space-plan.md`](docs/disk-space-plan.md) | 系统盘占用治理方案（已实施） |
| [`docs/tech-debt.md`](docs/tech-debt.md) | 技术债登记（待处理 + 已归档） |
| [`docs/ui_design_improvement_plan.md`](docs/ui_design_improvement_plan.md) | **界面设计改进计划 v2.1（已全部完成：30/30 项 + 2 条清单外遗留，共十批）**：UI 缺陷、设计系统一致性、ARIA 无障碍与响应式打磨；§7 有逐批进度记录与人工抽查清单 |
| [`docs/markdown_preview_dev_plan.md`](docs/markdown_preview_dev_plan.md) | Markdown 预览开发计划 v1.0（已实施）：编辑区分栏实时预览 + GFM / 图片 / 链接 |
| [`docs/live_templates上下文轴修订稿.md`](docs/live_templates上下文轴修订稿.md) | Live Templates 上下文位置轴修订稿 v1.1（相位 A 已实现）：容器 × 位置 × 词法三维 |
| [`docs/pycharm_feature_research_report.md`](docs/pycharm_feature_research_report.md) | PyCharm 功能调研报告 v1.1（调研，非排期依据） |
| [`docs/plugin_system_design.md`](docs/plugin_system_design.md) | 插件系统设计方案 v0.2（方向稿 + 工具切片详细设计，**切片已实现**） |
| [`docs/devtools_plugin_guide.md`](docs/devtools_plugin_guide.md) | 开发工具插件作者指南 v1（manifest / host API / kit 积木 / 热重载） |
| [`docs/devtools_plugin_acceptance_record.md`](docs/devtools_plugin_acceptance_record.md) | 工具插件切片验收记录（PR-1~4 / 490 测试 / 决策落地核对） |
| [`docs/edit_prediction_research_plan.md`](docs/edit_prediction_research_plan.md) | 低延迟编辑预测研究方案 v0.1（探索中） |
| [`docs/dep_health_dev_plan.md`](docs/dep_health_dev_plan.md) | 依赖健康开发计划（已实施）：依赖风格/扫描/修复 + 忽略清单 |
| [`docs/git_improvement_report.md`](docs/git_improvement_report.md) | Git 集成交付报告：远程/worktree/rebase/cherry-pick/stash/log/blame 等增强 |
| [`docs/menubar_improvement_plan.md`](docs/menubar_improvement_plan.md) | 菜单栏改进计划 |
| [`docs/i18n.md`](docs/i18n.md) | **国际化实施说明（zh-CN / en-US 双语，已交付）**：扁平 key 语言包、20 批动态文案抽取、三步新增文案流程与踩坑记录 |
| [`docs/adr/`](docs/adr/) | 技术决策记录（ADR） |

> 技术方案与开发计划冲突时，以开发计划为准并反馈修订。

## 仓库结构

```
open-charm/
├── shell/                   # ✅ Tauri 2 + Monaco 外壳（Phase 1 交付，验收达标）
├── bench/                   # ✅ 基准项目集 + 指标采集脚本
├── ci/                      # ✅ 版本锁定基线
├── docs/                    # 方案、开发计划、ADR、技术债登记
├── probe/                   # ✅ opencharm-probe（Phase 2 交付，Gate C 达标）
├── intel/                   # ✅ opencharm-intel（Phase 3 已基本交付，见 intel/README.md）
└── tools/                   # 构建辅助脚本（fetch-debugpy.ps1 拉取打包 debugpy；edit_history_stats.py 统计编辑历史）
```

## 架构第一原则

- `probe` 与 `intel` 是**完全独立的进程/包**，不依赖外壳内部 API。
- 一切自研组件都是独立进程或独立包，不侵入外壳与静态引擎内核。
- 主干开发 + 短分支 PR；CI 全绿才可合并。

## 打包发布

全新 Windows 系统开箱即用依赖「随包分发 + 首次启动引导」，已落地（Phase 4 第 1~4 步）：

- **外部命令解析**：`uv` / `pyrefly` / `ruff` / `git` 统一经 `shell/src-tauri/src/tool_paths.rs` 定位（环境变量 → `~/.opencharm/bin` / `~/.local/bin` → 系统 PATH）；
- **自研组件随包分发**：`opencharm-intel` 与 `probe/src` 经 `tauri.conf.json` 的 `bundle.resources` 打进安装包；运行时分别由 `lsp.rs::locate_intel_binary` 与 `run_env.rs::locate_probe_src` 查找（环境变量 → `<data_root>/runtime` → Tauri 资源目录 → dev 仓库布局）；
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

- **落盘位置**：`~/.opencharm/logs/opencharm.log`（固定用户主目录，release / 打包后仍可稳定定位）。
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

- **Pydantic 构造校验**：默认引擎 pyrefly 不对 `BaseModel` 子类的构造调用做静态红线；OpenCharm 以自研第四桶诊断（`opencharm-pydantic`）补齐**类型错 / 缺失必填 / 未知字段**三类检查（设置 → Pydantic 构造校验，默认开）。检查为轻量文本解析（非完整类型系统）：跨文件继承链不合并、多行构造调用跳过、复杂表达式跳过；alias 字段按别名放行。实测与上游跟踪见 [`bench/reports/pydantic-engine-probe.md`](bench/reports/pydantic-engine-probe.md)。
- **Pydantic 字段重命名**：pyrefly 对此类字段 references=0（只改声明处）；OpenCharm 已自研**改名传播补充**——rename 时扫描 `Model(field=` 构造调用点并入编辑集（引擎结果优先去重，扫描 2s 超时自动降级）。basedpyright 引擎下两者均由引擎自身覆盖，自研层自动旁路。计划与实施记录见 [`docs/pyrefly_pydantic_support_plan.md`](docs/pyrefly_pydantic_support_plan.md)。

## 当前状态

- 项目阶段：**Phase 1 / Phase 2 / Phase 3（opencharm-intel）均已交付**；当前进入 **Phase 4（持续打磨）**，进度见 `docs/python_ide_dev_plan_v2.md` §7。
- **调试功能（DAP / debugpy 最小闭环）已交付**：D1–D5 / Gate E 见 [`docs/debug_acceptance_record.md`](docs/debug_acceptance_record.md)；协议层与打包均已验证，部分 UI 交互项待人工抽查（清单见验收记录 §五）。
- **运行功能迁移（M1–M4）已交付**：脚本/项目两种运行 + 统一 PTY 运行控制台 + 多实例并行 + 运行历史按实例归属；交互口径 [`docs/python_run_dev_plan.md`](docs/python_run_dev_plan.md) v3.4、验收记录 [`docs/run_acceptance_record.md`](docs/run_acceptance_record.md)。
- **界面设计改进计划已收官**（十批，30/30 项 + 2 条遗留）：按钮体系 / scale token / Tooltip 双轨收敛 / ARIA 语义（tree·tabs·dialog·tooltip·menu）/ 浅色主题对比度达标 / 响应式下限 / 字号字体族全局跟随设置；沉淀的硬规则已固化到 `.codebuddy/rules/typescript-code-style`，逐批可见变化的人工抽查清单见计划文档 §7。
- **国际化（zh-CN / en-US 双语）已交付**：index.html 静态骨架、Rust 错误提示与全部功能域动态文案均已纳管（20 批抽取，en/zh 词条编译期对齐 + 单测兜底）；设置 → 外观 → 语言即时切换，实施与新增文案流程见 [`docs/i18n.md`](docs/i18n.md)。
- 现行方案：[`docs/python_ide_tech_plan_v3.md`](docs/python_ide_tech_plan_v3.md) · 现行计划：[`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) · 技术债登记：[`docs/tech-debt.md`](docs/tech-debt.md)。