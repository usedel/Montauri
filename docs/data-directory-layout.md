# 数据目录与绿色部署策略

## 目标

不自系统盘（Windows 通常为 C 盘）散落数据；程序与数据同盘，删除安装目录即可彻底卸载。适用于「安装到非系统盘」与「便携/绿色版」两种形态。

## 数据根目录决策（data_root）

统一入口 `shell/src-tauri/src/util.rs::data_root()`，进程内用 `OnceLock` 只探测一次，结果被 `opencharm_home()` / `webview_data_dir()` / `uv_cache_dir()` 复用。

决策顺序：

1. **`OPENCHARM_DATA_ROOT` 环境变量**（调试 / 便携自定义，最高优先级）；
2. **可执行文件所在目录**——满足其一即采用：
   - 同目录存在 `opencharm.portable` 标记文件（绿色版显式启用）；
   - 该目录可写（安装到非系统盘时自动成立）；
3. **回退用户主目录 `USERPROFILE`/`HOME`**——安装目录无写权限（如 `Program Files`）时自动回退，应用照常工作。

可写性探测：向候选目录写入临时空文件后删除（`dir_writable`）。

## `.opencharm` 子目录划分

所有数据落在 `<data_root>/.opencharm/` 下，按功能分层，不放根目录：

| 路径 | 用途 | 来源 |
|---|---|---|
| `config/settings.json` | 全局设置 | `settings.rs` |
| `config/templates.json` | Live Templates 用户层 | `fs_cmds.rs` |
| `config/recent-workspaces.json` | 最近工作区 | `fs_cmds.rs` |
| `config/probe.json` | probe 配置 | `probe/src/opencharm_probe/config.py` |
| `workspaces/<hash>.json` | 工作区解释器选择 | `env_cmds.rs` |
| `recent/<hash>.json` | 最近打开文件 | `file_ops.rs` |
| `traces/<hash>.db` | 运行时类型采样 SQLite 库 | `lsp.rs` / probe `store.py` |
| `envs/<名称>-<hash6>/` | 全局虚拟环境 | `env_cmds.rs` |
| `bin/` | 托管工具（引导安装的 uv / 静态引擎可执行文件） | `tool_paths.rs` |
| `tools/` | uv tool 安装的工具本体（pyrefly 等 venv，由 `UV_TOOL_DIR` 指定） | `toolchain.rs` |
| `runtime/` | 运行时组件（opencharm-intel、probe/src） | `tool_paths.rs` |
| `cache/uv/` | OpenCharm 引导安装 uv 的下载缓存 | `tool_paths.rs` |
| `webview/` | WebView2 用户数据（localStorage/Cookie/缓存） | `util.rs` + `lib.rs` |

工作区层配置仍写项目内部 `<workspace_root>/.opencharm/templates.json`，不进用户数据目录。

## probe 数据跟随

probe 是独立进程，默认 `Path.home()/.opencharm`。shell 在 `run_script` 注入
`OPENCHARM_PROBE_HOME=<data_root>/.opencharm`，使 trace 库与 shell 计算路径一致。
直接命令行运行 probe 时仍走其自身默认（独立包零配置可用）。

## uv 处理策略

- **用户已安装 uv**：不迁移、不注入、缓存位置不动。
- **OpenCharm 引导安装 uv**（`toolchain.rs`）：经 `UV_INSTALL_DIR` 装到
  `<data_root>/.opencharm/bin`；静态引擎用 `uv tool install` 并在环境变量
  `UV_TOOL_BIN_DIR=<data_root>/.opencharm/bin`、`UV_TOOL_DIR=<data_root>/.opencharm/tools`
  下安装（`uv tool install` 无 `--tool-dir` 参数，工具目录由这两个环境变量控制）；
  运行时仅当命中的 uv 位于托管目录时才注入 `UV_CACHE_DIR`（`tool_paths.rs::tool_command`）。

## 安装器默认目录（NSIS）

- `tauri.conf.json`：`installMode: currentUser`（免管理员）+ 自定义模板
  `nsis/installer.nsi`（基线取自 Tauri `tauri-v2.11.5` 官方模板）。
- 自定义模板在 `.onInit`：从 D 到 Z 探测首个存在且可写的非系统盘，默认
  `<盘>:\opencharm`；全部不可用则回退 `%LOCALAPPDATA%\OpenCharm`。

> 注意：模板随 Tauri 版本锁定，升级 Tauri 时需对照官方 `installer.nsi` 同步改动
> （当前差异仅 `.onInit` 默认目录分支与新增 `PickInstallDir` 函数）。

## 卸载清理

- 便携/绿色版（装到非系统盘）：删除安装目录即彻底清理（数据、uv、webview 全在其内）。
- 标准安装版回退到用户目录时：删除 `%USERPROFILE%\.opencharm\`（或自定义
  `OPENCHARM_DATA_ROOT` 所指目录）即净，无散落残留。