# 数据目录与部署方案 v2（现行方案 · 已实施）

> 状态：**审核通过，已实施**（2026-08-29）。v1 文档已删除，本文件为数据目录与部署的现行方案。
>
> 修订记录：
> 1. 取消便携版——不做 `opencharm.portable` 标记与绿色 zip 形态。
> 2. uv / pyrefly 策略反转——跨项目可复用的用户工具不再沙箱托管，改为**检测 + 引导用户安装到用户自有位置**。
> 3. 不做迁移——无历史用户（当前仅自测），v2 布局全新落盘。
> 4. **保留单一数据根**（审核裁定）：单根统一管理、子目录粒度备份，v1 的 `.opencharm` 子目录划分不视为问题，
>    仅调整根的落位与解析规则。
> 5. **删除自定义 NSIS 模板**（审核裁定）——回归官方模板 + `installerHooks` 钩子。
> 6. **移除全局虚拟环境功能**（审核裁定）——环境一律建于项目内 `.venv`（项目环境隔离原则），
>    数据根取消 `envs/` 子目录。

---

## 1. v1 保留什么、改什么

**保留（审核裁定 / v1 做对的）：**

- **单一数据根 + 功能子目录划分**——统一管理、整根可备份、子目录可独立备份，不改；
- `config/`、`workspaces/`、`recent/`、`traces/`、`runtime/`、`webview/` 子目录名与内部结构**原样保留**（最小代码改动）；
- `OPENCHARM_DATA_ROOT` 环境变量覆盖；
- probe 独立进程、零配置可用，shell 仅通过环境变量与其对齐；
- 工作区层配置写项目内部 `<workspace_root>/.opencharm/`（项目内约定，与部署无关）。

**修改：**

| # | v1 现状 | 问题 | v2 改法 |
|---|---|---|---|
| 1 | exe 目录可写 ⇒ 数据写进安装目录（隐式便携） | 同一二进制放不同位置行为不同；与 Program Files 完整性机制、多用户、备份工具冲突 | 删除可写性推断与便携形态，根落位固定 |
| 2 | 默认根为用户主目录隐藏点目录 `~/.opencharm` | 不符合 Windows 惯例（VS Code / JetBrains 用 Known Folders），用户难发现 | 默认根改为 `%LOCALAPPDATA%\OpenCharm`，内部子目录不变 |
| 3 | uv / pyrefly 沙箱托管进 `<data>/bin`、`<data>/tools`，私设 `UV_CACHE_DIR` | 工具是用户级跨项目可复用资产：与用户已有 uv 重复、缓存无法共享去重、卸载连带删用户工具 | 检测 → 引导 → 使用，工具归用户自有位置（§4.2） |
| 4 | 无 logs 目录 | 故障排查缺第一现场 | 新增 `logs/` 子目录（轮转保留 14 天） |
| 5 | NSIS 从 D: 扫盘选默认安装目录 | 非常规；且自定义模板需随 Tauri 升级同步维护 | **删除自定义 NSIS 模板**，回归官方模板 |
| 6 | 标准安装版卸载后数据残留 | 卸载体验不闭环 | `installerHooks` 钩子卸载时询问删除数据根（§6） |

---

## 2. 设计原则

1. **显式优于隐式**：无便携模式，根解析只有两级——环境变量覆盖 > 平台默认，行为可预测。
2. **平台惯例优先（仅根的落位）**：Windows 用 Known Folders；Linux/macOS 按 XDG / Apple 惯例预留。
3. **单一数据根**：一个根统一管理所有数据，按功能分子目录；整根与子目录均可独立备份。
4. **工具所有权原则**：OpenCharm 是 IDE，不是包管理器。用户级可复用工具（uv、pyrefly）装在用户自有位置、
   用用户已有的配置与缓存；OpenCharm 只做「检测 → 引导 → 使用」，不托管安装、不重定向。
5. **组件边界不变**（架构铁律）：probe / intel 独立解析自身目录，shell 只通过环境变量与其对齐。
6. **全新落盘**：无历史用户，不做迁移。

---

## 3. 目录模型

### 3.1 数据根解析（两级决策）

| 优先级 | 条件 | 数据根 |
|---|---|---|
| 1 | 环境变量（仅开发/测试/高级用户，应用自身不写入） | `$OPENCHARM_DATA_ROOT` |
| 2 | 数据根指针文件存在（首启落位提示 / 迁移向导写入） | 指针内容所指目录 |
| 3 | 默认（Windows） | `%LOCALAPPDATA%\OpenCharm` |

指针文件位于平台标准配置目录（Windows `%APPDATA%\OpenCharm\data-root`、
Linux `~/.config/opencharm/data-root`、macOS `~/Library/Application Support/OpenCharm/data-root`），
内容 = 数据根绝对路径；仅几十字节，落系统盘无妨，跨平台无注册表依赖。

解析由 `util.rs` 的 `OnceLock` 一次性完成；`data_root()` 保留为唯一入口，
`opencharm_home()` 的 `.opencharm` 段去掉（根即 `OpenCharm` 目录）。
设置面板「存储」页常显当前数据根，提供首启落位提示与迁移向导（自动 `setx`，见 docs/disk-space-plan.md）。

**跨平台映射（预留，Windows 之外暂不实现）：**

| Windows | Linux (XDG) | macOS |
|---|---|---|
| `%LOCALAPPDATA%\OpenCharm` | `$XDG_DATA_HOME/opencharm` | `~/Library/Application Support/OpenCharm` |

### 3.2 子目录划分（v1 原样保留 + logs）

```
<data_root>/
  config/
    settings.json                     全局设置
    templates.json                    Live Templates 用户层
    recent-workspaces.json            最近工作区
    last-session.json                 上次会话终态（启动恢复依据：open=false 不恢复）
    probe.json                        probe 配置
  workspaces/<hash>.json              工作区解释器选择
  recent/<hash>.json                  最近打开文件
  traces/<hash>.db                    运行时类型采样 SQLite
  runtime/                            opencharm-intel、probe/src（随应用分发的组件）
  webview/                            WebView2 用户数据
  logs/                               ★ 新增：shell 日志，opencharm.log 大小轮转（1 MiB，保留 log_keep 份）
```

> 对比 v1 删除：`bin/`（托管 uv）、`tools/`（uv tool 目录）、`cache/uv/`（uv 缓存）——
> 见 §4.2，三者回归用户自有位置。

---

## 4. 组件衔接

### 4.1 probe（独立包，契约不变）

- 子目录结构与 probe 默认布局完全一致（`<home>/config/probe.json`），故 shell 注入仍是单个变量：
  `OPENCHARM_PROBE_HOME=<data_root>`；probe 单独命令行运行默认仍为 `~/.opencharm`，零配置可用，**不改**。
- `lsp.rs` trace db 路径仍为 `<data_root>/traces/<hash>.db`，与注入值天然一致，**不改**。

### 4.2 uv / pyrefly：检测 → 引导 → 使用（策略重写）

**原则：uv 与 pyrefly 是用户级跨项目工具，装在用户自有位置、共享用户已有缓存，OpenCharm 不托管、不重定向。**

**uv：**

1. **检测**：PATH 中找 `uv`；再探测官方默认安装位 `%USERPROFILE%\.local\bin\uv.exe`（winget / 官方脚本默认）。
2. **未安装 → 引导，不静默安装**：设置面板「Python → 工具链」显示引导卡片：
   - 展示官方安装命令（`winget install astral-sh.uv` 或官方 PowerShell 脚本），一键复制；
   - 「立即安装」按钮 = 执行**官方安装器且不带任何 `UV_INSTALL_DIR` 覆盖**，落官方默认位置，与其他项目共享；
   - 未检测到 uv 时，依赖 uv 的功能（pyrefly 安装、环境创建）UI 置灰并给引导入口，不降级静默自装。
3. **不注入 `UV_CACHE_DIR`**：使用 uv 默认缓存（`%LOCALAPPDATA%\uv\cache`），与其他项目共享去重；
   用户自己设置了 `UV_CACHE_DIR` 更不干预。

**pyrefly（静态引擎）：**

1. 前提：uv 已就绪（未就绪先走 uv 引导）。
2. 安装：`uv tool install pyrefly`，**不设 `UV_TOOL_DIR` / `UV_TOOL_BIN_DIR`**——
   工具落用户 uv 默认工具目录（Windows：`%APPDATA%\uv\tools`），入口脚本落 `%USERPROFILE%\.local\bin`，跨项目可用。
3. 运行定位：优先 PATH 上的 `pyrefly`；否则 `uv tool run pyrefly`（uvx）；都没有则 UI 引导安装。
4. 升级 `uv tool upgrade pyrefly`、卸载 `uv tool uninstall`——工具生命周期归用户。

**保留的注入（仅作用于 OpenCharm 自己拉起的子进程，不污染用户全局环境）：**

- `UV_DEFAULT_INDEX`：仍由设置项 `pypi_index` 控制（默认官方源，可切国内镜像）；
  用户已设置 `UV_DEFAULT_INDEX` / `UV_INDEX_URL` 时不覆盖。

### 4.3 WebView2 / logs

- WebView2 UserDataFolder → `<data_root>\webview`（仅根落位变化，路径拼法不变）。
- `util.rs` 新增 `logs_dir()`；`logging.rs` 落盘 `<data_root>\logs\opencharm.log`
  （沿用大小轮转：单文件 1 MiB，保留 `log_keep` 份）；
  设置面板增加「打开数据目录 / 打开日志目录」入口（`open_data_dir` / `open_log_dir` 命令）。

---

## 5. 历史数据处理

**不做迁移**——没有历史用户，当前仅自测。v2 布局直接全新落盘；旧测试残留（`~/.opencharm`、
`<exe_dir>\.opencharm`、旧 `OPENCHARM_DATA_ROOT` 所指目录）实施完成后手工删除即可。

---

## 6. 安装器与卸载（NSIS）：删自定义模板，回归官方

- **删除 `shell/src-tauri/nsis/installer.nsi`**，`tauri.conf.json` 去掉 `bundle.windows.nsis.template` 字段。
  自定义模板与官方模板的唯一差异是 `.onInit` 扫盘选盘 + `PickInstallDir`，v2 已不需要——随之消失的还有
  v1 文档标注的「升级 Tauri 需对照官方模板同步改动」维护负担。
- 保留现有配置 `installMode: currentUser`（官方模板原生支持）：per-user 免管理员安装、目录选择页、
  官方 per-user 默认目录（LOCALAPPDATA 下），全部开箱即得。**数据根永不进安装目录**，无需任何模板定制。
- 卸载清理：官方模板提供 `installerHooks`（`bundle.windows.nsis.installerHooks`），新增 `nsis/hooks.nsh`：
  - `NSIS_HOOK_POSTUNINSTALL` 复用卸载确认页自带「Delete the application data」复选框状态
    （模板 `un.ConfirmLeave` 写入全局变量 `$DeleteAppDataCheckboxState`，1=勾选），不再单独弹窗询问，
    消除「勾了复选框却仍被二次询问」的重复打扰；
  - 勾选 → 依次删除**默认数据根** `%LOCALAPPDATA%\OpenCharm`、**指针所指数据根**
    （读 `%APPDATA%\OpenCharm\data-root`，覆盖已迁移到其他盘的场景；含盘根防误删护栏）、
    **指针目录** `%APPDATA%\OpenCharm`；未勾选 → 全部保留。
  - **用户工具链（`%USERPROFILE%\.local\bin` 的 uv、`%APPDATA%\uv\tools` 的 pyrefly）一律不碰。**
- `build-release.ps1` / `.bat` 无需改动（仅调用 `tauri build`）。

---

## 7. 代码触点清单（实施时逐项核对）

得益于单根保留，多数模块路径拼法不变，改动集中在三块：根解析、工具链策略、安装器。

| 文件 | 改动 |
|---|---|
| `util.rs` | `data_root()` 改两级解析（env → `%LOCALAPPDATA%\OpenCharm`）；删 `dir_writable`、便携标记推断；删 `uv_cache_dir()`；新增 `logs_dir()` |
| `settings.rs` / `fs_cmds.rs` / `watcher.rs` / `file_ops.rs` / `env_cmds.rs` / `lsp.rs` / `lib.rs` | **无路径改动**（`opencharm_home()` 去掉 `.opencharm` 段后子路径拼法不变）；`env_cmds.rs` 依赖 uv 的命令前置检测 |
| `tool_paths.rs` | 删 `UV_CACHE_DIR`/`UV_TOOL_DIR` 注入与托管目录逻辑；保留 `UV_DEFAULT_INDEX` 注入；新增 uv/pyrefly 检测函数 |
| `toolchain.rs` | 重写：uv 引导安装（官方默认路径）+ `uv tool install pyrefly`（无目录覆盖）；删 `UV_INSTALL_DIR` 托管逻辑 |
| 前端设置面板 | 工具链引导卡片（uv 检测状态、安装/复制命令、pyrefly 安装/升级入口）；「打开数据/日志目录」 |
| `tauri.conf.json` | `bundle.windows.nsis` 删 `template` 字段，新增 `installerHooks: "nsis/hooks.nsh"` |
| `nsis/installer.nsi` | **删除**（不再维护自定义模板） |
| `nsis/hooks.nsh` | **新增**（~10 行）：POSTUNINSTALL 询问删除数据根 |
| data-directory-layout.md（v1） | 已删除，本文档为现行版本 |

## 8. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 无 uv 的用户多了「先装 uv」一步 | 引导卡片 + 一键官方安装（默认路径），一次性成本；换来工具归用户所有、缓存全局共享 |
| uv 默认缓存/工具仍在 C 盘（`%LOCALAPPDATA%\uv`） | uv 官方默认，用户可用自己的 `UV_CACHE_DIR`/`UV_TOOL_DIR` 自定义；OpenCharm 尊重而不代管 |
| pyrefly 依赖 uv，用户可能想用 pip 装的 pyrefly | 定位顺序 PATH 优先：用户自装的任何 pyrefly（pip/uvx 均可）都直接可用，uv 仅为推荐的安装通道 |
| 数据在 `%LOCALAPPDATA%`，C 盘紧张用户不可见 | 首启落位提示 + 设置 → 存储页迁移向导（`OPENCHARM_DATA_ROOT` 重定向）；大头的项目 venv 本就跟随各项目目录，数据根内无大体积项 |

---

## 9. 磁盘占用治理

系统盘占用的占用清单、清理边界与迁移流程见 **`docs/disk-space-plan.md`**（已实施）：
设置 → 「存储」分类提供占用可视化、可再生内容一键清理（trace 库 / WebView 缓存 / 轮转日志 / uv 缓存）、
首启数据落位提示与数据根迁移向导。
