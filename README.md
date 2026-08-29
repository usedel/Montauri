# OpenCharm

为「FastAPI + 爬虫 + 小脚本」开发者定制的单人自用 Python IDE。

- **外壳**：**Tauri 2 + Monaco**（2026-08-20 裁决，取代原 Zed 方案，见 ADR-0002）
- **静态语义**：Pyrefly（默认）/ basedpyright（备选），第一天实现可切换
- **差异化核心**：运行时类型采样（PEP 669 `sys.monitoring`）+ 自研运行时智能 LSP（`opencharm-intel`）
- **功能范围**：补全 / 跳转 / Hover / 诊断 + 脚本运行与 traceback 点击跳转

## 文档索引

| 文档 | 说明 |
|---|---|
| [`docs/handoff-phase2-probe.md`](docs/handoff-phase2-probe.md) | **Phase 2 交接文档（新会话入口）** |
| [`docs/phase1-acceptance.md`](docs/phase1-acceptance.md) | Phase 1 验收实测记录（全部达标） |
| [`docs/handoff-tauri-monaco.md`](docs/handoff-tauri-monaco.md) | 外壳切换交接文档（换壳背景与裁决链） |
| [`docs/python_ide_tech_plan_v3.md`](docs/python_ide_tech_plan_v3.md) | **技术方案 v3（现行）**：Tauri+Monaco 外壳架构 |
| [`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md) | **开发计划 v2（现行）**：Phase 重排 |
| [`docs/adr/`](docs/adr/) | 技术决策记录（ADR） |
| [`docs/spike-implementation-reference.md`](docs/spike-implementation-reference.md) | Spike 实现参考（已验证代码与踩坑） |

> 技术方案与开发计划冲突时，以开发计划为准并反馈修订。

## 仓库结构

```
open-charm/
├── shell/                   # ✅ Tauri 2 + Monaco 外壳（Phase 1 交付，验收达标）
├── bench/                   # ✅ 基准项目集 + 指标采集脚本
├── ci/                      # ✅ 版本锁定基线
├── docs/                    # 方案、交接文档、ADR、验收记录
├── probe/                   # ✅ opencharm-probe（Phase 2 交付，Gate C 达标）
└── intel/                   # ✅ opencharm-intel（Phase 3 已基本交付，见 intel/README.md）
```

## 架构第一原则

- `probe` 与 `intel` 是**完全独立的进程/包**，不依赖外壳内部 API。
- 一切自研组件都是独立进程或独立包，不侵入外壳与静态引擎内核。
- 主干开发 + 短分支 PR；CI 全绿才可合并。

## 打包发布

全新 Windows 系统开箱即用依赖「随包分发 + 首次启动引导」，已落地（Phase 4 第 1~4 步）：

- **外部命令解析**：`uv` / `pyrefly` / `ruff` / `git` 统一经 `shell/src-tauri/src/tool_paths.rs` 定位（环境变量 → `~/.opencharm/bin` / `~/.local/bin` → 系统 PATH）；
- **自研组件随包分发**：`opencharm-intel` 与 `probe/src` 经 `tauri.conf.json` 的 `bundle.resources` 打进安装包，运行时按 `lsp.rs` 的 `locate_*` 查找（环境变量 → `~/.opencharm/runtime` → Tauri 资源目录 → dev 仓库布局）；
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

## 当前状态

- 项目阶段：**Phase 1 / Phase 2 / Phase 2.5 均已交付，Phase 3（opencharm-intel）已基本交付（P3-T01~T10 完成，仅 PyCharm 同场景人工对标待复核）**；当前进入 **Phase 4（持续打磨）**，进度见 `docs/python_ide_dev_plan_v2.md` §7。
- 新会话入口：[`docs/handoff-phase2-probe.md`](docs/handoff-phase2-probe.md)。
- 现行方案：[`docs/python_ide_tech_plan_v3.md`](docs/python_ide_tech_plan_v3.md) · 现行计划：[`docs/python_ide_dev_plan_v2.md`](docs/python_ide_dev_plan_v2.md)。