# Montauri 多窗口开发计划

> 版本：**v0.2** · 日期：2026-10-03（v0.1 2026-09-28 方案定稿）· 状态：**阶段 0 / 1 / 2 全部交付**（2026-09-28 实施，2026-09-30 入库 `14164e4`）；真机 CDP 验收 **16/16 PASS**（§5.4）· 单窗口零回归
> v0.2 修订（2026-10-03）：**仅状态回填与 DoD 对账**，不改方案。① 头行由「待实施」改为「三阶段已交付」；② §3.3 阶段 0 任务清单补勾（依据：§4/§5 实施记录 + 真机事件定向用例 `MC-REAL-TERM-1/2/3`、`MC-REAL-DBG-1/2` 通过，反证 `emit_to` + 窗口级 `listen` 已全量落地）；③ §8 DoD 逐条对账——第 3 条「另建独立验收记录文件」以**本 v0.2 修订替代**（不想为一个文件再开一份重复叙述，实施偏差已逐阶段记录在 §4 / §5 的「实施状态」块内）。
> 上游：`docs/python_ide_tech_plan_v3.md`、`docs/python_ide_dev_plan_v2.md`
> 需求：当前只能同时打开一个文件夹/项目；本计划落地「多窗口（一窗口一项目）」能力。
> 路径选择：**多窗口**（Tauri 2 多 Webview），不做 single-window 多工作区、不做 multi-root workspace（三者取舍已在前置评审定案）。
> 约定：本文与开发计划冲突时以本计划为准并反馈修订；每阶段以「单窗口 e2e 全绿」为前进门禁；不动业务，只做隔离与身份注入。

---

## 0. 一页结论

Montauri 现在是「单窗口 + 全局事件广播 + 全局静态状态」模型，直接开第二窗口会**事件串扰 + LSP 互相杀进程**。因此按三阶段推进：

| 阶段 | 内容 | 是否改行为 | 门禁 |
|---|---|---|---|
| 0 | 事件按窗口定向（后端 `emit_to` + 前端窗口级 `listen`） | 单窗口无感 | 单窗口 e2e 全绿 |
| 1 | 全局静态状态按窗口分区（`PerWindow<T>` + 8 处改造） | 单窗口无感 | 单窗口 e2e 全绿 |
| 2 | 开新窗口命令 + 前端参数化 + 窗口去重 | 新增能力 | 双窗口真实场景验收 |

未做阶段 0/1 就开第二窗口，第一版必现 LSP 串杀、调试/终端串味——**顺序不可跳**。

---

## 1. 目标与范围

### 1.1 本期交付

- 用户可同时打开多个项目，每个项目一个独立窗口。
- 每个窗口内补全 / 跳转 / Hover / 诊断、运行、调试、文件监听、依赖体检、Git、环境面板各自独立、互不干扰。
- 重复打开同一项目 → 聚焦已有窗口，不重复新建。

### 1.2 明确不做（本期）

- 单窗口内多工作区 / 多根工作区（评审已否决）。
- 窗口间拖拽文件、跨窗口同步状态、跨窗口搜索。
- 关闭全部窗口时的应用退出策略（沿用 Tauri 默认，后续单独立项）。

---

## 2. 核心架构决策

### 2.1 窗口身份 `WindowKey`

- `WindowKey = window label`。
- 有项目窗口：`label = project_hash(绝对路径)`（复用 `file_ops::project_hash`，即 lsp/intel 已用的稳定 hash）。
- 无项目主窗口：固定 label `"main"`（延续 `lib.rs:41` 现有 label）。
- 前端启动时读一次 `getCurrentWindow().label` 存为模块级 `MY_WID`，作为所有窗口级事件过滤与「归属」判断的依据。

### 2.2 事件定向模型

- 后端窗口相关事件：`app.emit(...)` → `app.emit_to(wid, ...)`。
- 事件源线程只持有 `AppHandle`，因此 **`wid` 必须在命令入口取得、随 `AppHandle` 一起 clone 进线程**。
- `wid` 获取方式：命令签名追加 `window: tauri::WebviewWindow` 参数（Tauri 2 自动注入当前调用窗口），取 `window.label().to_string()`。
- 前端窗口相关监听：`listen(...)` → `getCurrentWindow().listen(...)`。
- 仅应用级事件保持全局广播：`plugins-dir-changed`（插件目录是应用级）。

### 2.3 `PerWindow<T>` 统一容器

沿用现有 `LazyLock<Mutex<...>>` 风格，新增一个通用容器，避免 8 处手写 `HashMap<String, T>`：

```rust
// shell/src-tauri/src/per_window.rs（已落地，2026-09-28）
pub struct PerWindow<T>(Mutex<HashMap<String, T>>); // String = WindowKey
// 实际 API（实施修订：不提供闭包式 with/entry，统一暴露 lock() 借表——
// 各调用点 control flow 差异大，线程循环里的条件 return 无法塞进闭包）：
//   fn lock(&self) -> MutexGuard<HashMap<String, T>>   // 借整张表，按 wid 二级操作
//   fn insert(&self, wid, v) -> Option<T>
//   fn remove(&self, wid) -> Option<T>
//   fn contains(&self, wid) -> bool
//   fn drain_all(&self) -> Vec<T>                      // 应用退出清理
```

> 生命周期铁律：窗口关闭（`window.on_close` / 前端 `closeWorkspace`）必须调用对应资源 `remove(wid)`，保证「资源随窗口同生共死」，与架构第一原则一致。

### 2.4 前置探针结论（2026-09-28 实测，spike 已跑通）

动工前用临时 spike（`src-tauri/src/spike.rs` + `src/spike.ts`）实测五个关键技术假设：

| # | 假设 | 实测结论 | 对方案的影响 |
|---|---|---|---|
| 1 | 命令签名注入 `window: WebviewWindow` | ✅ 可用，`window.label()` 正确区分窗口（"main" / "spike-second"） | `WindowKey = label` 机制成立 |
| 2 | 命令里 `WebviewWindowBuilder::build()` | ⚠️ 同步 `fn` 命令**死锁挂起**（卡在 build 不返回）；改 `async fn` 后成功 | **§5.1 `open_workspace_window` 必须 `async fn`** |
| 3 | 多窗口 capability | ⚠️ spike 中 second 窗口未设 `data_directory`，且未走到 main.ts 的 init（spike.ts 先执行），未暴露 capability 限制 | **阶段 2 真机定位**：`data_directory` 共享无碍；真正根因是 `capabilities/default.json` 的 `windows:["main"]` 白名单未覆盖项目窗口（见 §5），修复为 `["*"]` |
| 4 | `emit_to` + 窗口级 `listen` 定向 | ✅ 定向正确（main 的 `win.listen` 只收到发给自己的） | 阶段 0 方案正确 |
| 5 | 全局 `listen()` 是否串收跨窗口事件 | ⚠️ main 的全局 `listen` 收到了发给 spike-second 的 `emit_to` 事件 | **阶段 0 必须全量切窗口级监听，禁用全局 `listen`** |

待二次确认（疑似时序、非机制缺陷）：spike-second 未收到发给它的 `emit_to`，推测是第二窗口 `listen` 未在 `setTimeout 2500ms` 前挂载完成；`emit_to`→main 已证明机制正确，阶段 0 用真实 LSP/终端事件再覆盖验证。

> 探针产物 `spike.rs` / `spike.ts` 为临时脚手架，验证后整体删除（`lib.rs` / `main.ts` 已标注 `TODO(spike)`）。

---

## 3. 阶段 0：事件定向改造

### 3.1 后端改动点（7 个文件，含实施时补入的 toolchain）

| 文件 | 事件 | 命令入口（注入 window） | 线程 emit 改法 |
|---|---|---|---|
| `lsp.rs` | `lsp-message` / `lsp-exit` / `lsp-stderr` | `lsp_start(app, engine, command, args, cwd)` | stdout/stderr/退出线程 `emit_to(wid, ...)` |
| `terminal.rs` | `term-data` / `term-exit` | `term_spawn(app, ...)` / `run_in_terminal(app, ...)` | 读线程 / 退出线程 `emit_to(wid, ...)` |
| `dap.rs` | `dap-message` / `debug-stdout` / `debug-stderr` / `debug-started` / `debug-exited` | `debug_start` / `debug_attach_debuggee` / `debug_stop` | 各线程 `emit_to(wid, ...)` |
| `watcher.rs` | `fs-changed` / `dep-fs-changed` / `dep-env-changed` | `watch_start(app, root)` | watcher 回调 `emit_to(wid, ...)` |
| `env_cmds.rs` | `pip-stdout` / `pip-stderr` | `pip_install` / `pip_upgrade` / `create_venv` / `dep_fix` | 读线程 `emit_to(wid, ...)` |
| `git_cmds.rs` | `git-op-stdout` | `git_push` / `git_pull` / `git_fetch` | 读线程 `emit_to(wid, ...)` |
| `toolchain.rs` | `toolchain-stdout` / `toolchain-stderr` | `install_toolchain` | 读线程 `emit_to(wid, ...)` |
| `plugin_cmds.rs` | `plugins-dir-changed` | — | **保持全局 `app.emit`** |

要点：

1. `lsp_start` 已有 `engine` 键；阶段 0 先不碰键结构，只让事件定向。**但必须把 `wid` 传进 `lsp_start` 的读线程**——否则阶段 2 双窗口时这里才补，容易漏。
2. `dap.rs` 的 `debug_stop(app)` 已 `DEBUG.take()`（单例），阶段 1 才改分区；阶段 0 只改 emit 定向。
3. payload 加 `wid` 字段为可选防御（前端窗口级监听已隔离时可省），但建议统一加上，作为后续排查串扰的诊断信息。

### 3.2 前端改动点（8 个文件）

| 文件 | 监听 | 改法 |
|---|---|---|
| `lsp/client.ts` | `lsp-message` / `lsp-exit` / `lsp-stderr`（`doEnsureListeners`） | `getCurrentWindow().listen(...)` |
| `dap/client.ts` | DAP 事件族 | 同上 |
| `termUi.ts` | `term-data` / `term-exit` | 同上 |
| `runFlow.ts` | 运行输出事件 | 同上 |
| `envPanel.ts` | `pip-stdout` / `pip-stderr` | 同上 |
| `depHealth.ts` | `dep-*` | 同上 |
| `git.ts` | `git-op-stdout` | 同上 |
| `main.ts` | `fs-changed` / `dep-fs-changed` / `dep-env-changed` | 同上 |
| `main.ts` | `plugins-dir-changed`（`:1933`） | **保持全局 `listen`** |

> 统一做法：新增 `shell/src/win.ts`（或并入 `state.ts`）导出 `export const MY_WID = getCurrentWindow().label;` 与 `const win = getCurrentWindow();`，各模块改 `win.listen(...)`。禁止混用——同一进程内窗口级与全局监听并存会导致事件收两遍。

### 3.3 任务清单

> **v0.2 回填（2026-10-03）**：本清单原为未勾选态。实际已全部落地，勾选依据 = ① `grep emit_to(` 命中后端 7 文件共 22 处（`lsp.rs` 3 / `terminal.rs` 3 / `dap.rs` 7 / `watcher.rs` 3 / `env_cmds.rs` 3 / `git_cmds.rs` 1 / `toolchain.rs` 2），与 §3.1 表逐项对应；② 前端 8 文件全部改为窗口级 `listen`（`lsp/client.ts` 3 / `dap/client.ts` 3 / `termUi.ts` 2 / `runFlow.ts` 2 / `envPanel.ts` 4 / `depHealth.ts` 2 / `git.ts` 1 / `main.ts` 1），`plugins-dir-changed` 保持全局；③ 真机 CDP `multi-window-real.cjs` 事件定向用例全 PASS。

- [x] 新增 `per_window.rs`（`PerWindow<T>`：阶段 0 备用，阶段 1 全面启用；含 `lock/insert/remove/contains/drain_all` + 单测）
- [x] 后端 7 文件改 `emit_to` + 命令入口注入 `window`（`plugin_cmds.rs::plugins-dir-changed` 保持全局 `app.emit`）
- [x] 前端 8 文件改窗口级 `listen`（`plugins-dir-changed` 保留全局）
- [x] 单窗口回归：补全/跳转/Hover/诊断/终端/调试/运行/依赖/文件监听逐项冒烟
- [x] `cargo check` 零告警 + `tsc` 零错误 + `shell/e2e/**` 全绿

### 3.4 阶段 0 验收

- 单窗口行为与改造前完全一致，无事件回流、无重复触发。
- 所有窗口相关事件 payload 能找到来源 `wid`（诊断信息就位）。
- e2e 全绿。

---

## 4. 阶段 1：全局静态状态按窗口分区

> **实施状态（2026-09-28 已实施）**：#1 / #2 / #3 / #7 / #8 五处冲突点已改造完成（`cargo check` 零告警、`cargo test` 233 passed / 0 failed）；#4 / #5 / #6 依赖健康缓存经确认**暂缓**。
> **实施决策（用户拍板）**：① 依赖健康三个缓存 key 已含「解释器+工作区根」，多窗口只缓存震荡（性能）不冲突，暂缓、留后续性能优化；② 终端 id 仅后端 `PerWindow` 分区，前端 id 不动。
> **语义变化**：跨窗口互斥按窗口判定——窗口 A 调试中，窗口 B 可运行脚本（`debug_busy(wid)` / `script_run_busy(wid)` 均收窄为「本窗口」）。
> **追加修复（真机 CDP 定位，2026-09-28）**：`lsp_stop` 的 `engine="*"` 分支原为 `map.drain()` 清空**整张 LSP 表**——窗口 B 前端 `stopEngine()` 会 `lsp_stop("*")`，误杀窗口 A 的 `main:static` 实例（表现：开 B 后 A 补全报「LSP 未启动」）。改为按复合键前缀 `{wid}:` 过滤删除（只清本窗口）。已扩展 `multi-window-real.cjs` 增 `MC-REAL-LSP-1/2` 回归验证，9 项全 PASS。其余 stop 类命令（`term_kill_all` / `debug_stop` / `watch_stop` / `git_cancel_op`）经排查均按 `wid` 正确隔离，仅 `*_for_exit`（应用退出）保持全局清空。

### 4.1 14 处全局 static 改造清单

| # | 位置 | 现状 | 改造 | 档位 |
|---|---|---|---|---|
| 1 | `lsp.rs:31` `LSP` | `HashMap<String engine>` | key 改 `"{wid}:{engine}"`；`lsp_start` 只 `remove` 本窗口键 | **必须** |
| 2 | `watcher.rs:34` `WATCHER` | `Mutex<Option<Debouncer>>` | `PerWindow<Debouncer>` | **必须** |
| 3 | `dap.rs:48` `DEBUG` | `Mutex<Option<DebugSession>>` | `PerWindow<DebugSession>`，`debug_busy()` 按 wid 判定 | **必须** |
| 4 | `env_cmds.rs:2382` `DEP_CACHE` | `Option<(PathBuf, HashMap)>` | **暂缓**（key 已含 root，只震荡不冲突） | 暂缓 |
| 5 | `env_cmds.rs:2391` `RESOLUTION_CACHE` | 单值 | **暂缓**（同上） | 暂缓 |
| 6 | `env_cmds.rs:2410` `ENV_SNAPSHOT_CACHE` | `Option<(String, Vec)>` | **暂缓**（同上） | 暂缓 |
| 7 | `terminal.rs:31` `TERMS` | `HashMap<String id>` | `PerWindow<HashMap<String, TermSession>>`（仅后端分区，**前端 id 不动**） | **必须** |
| 8 | `git_cmds.rs:760` `GIT_NET_OPS` | `HashMap<"push"/"pull"/"fetch">` | `PerWindow<HashMap<String, GitNetOp>>` | 必须 |
| 9 | `env_cmds.rs:776` `VERSION_CACHE` | 键=解释器绝对路径 | 不动（天然隔离） | 免改 |
| 10 | `lib_cmds.rs:46` `INTERPRETER_CACHE` | 键含 `.venv` 路径 | 不动（天然隔离） | 免改 |
| 11 | `proc_stats.rs:20` `SYS` | sysinfo 单例 | 不动（进程级共享安全） | 免改 |
| 12 | `plugin_cmds.rs:240` `PLUGIN_WATCHER` | 单 watcher | 不动（应用级） | 免改 |
| 13 | `edit_history.rs:54` `WRITER` | 写句柄 | 不动（共享，锁已存在） | 免改 |
| 14 | `logging.rs:21` `WRITER` | 写句柄 | 不动（共享，锁已存在） | 免改 |

### 4.2 高风险项的具体改法

**#1 LSP（最高危）**

- 命令签名 `lsp_start(app, window, engine, command, args, cwd)`，`let wid = window.label().to_string();`
- 实例键 `let key = format!("{wid}:{engine}");`
- `lsp_start` 的 `remove(&engine)` → `remove(&key)`（只杀本窗口同名引擎）。
- 读线程 payload 的 `engine` 字段语义不变（前端按 engine 分发），只在 emit 用 `emit_to(wid)`；`lsp_send_request/notification/response` 增加 `wid` 参数或改为解析 `engine` 前缀。
- `get_intel_info(workspace_root)` 已按项目 hash 落 trace DB，天然隔离，仅确认。

**#7 TERMS（已实施）**

- 后端 `TERMS` 改 `PerWindow<HashMap<String, TermSession>>`；id 仍由前端分配（`"term-1"` / `"run-term-script"` / `"run-term-project-N"`），**前端 id 不加前缀**，靠后端 `PerWindow` 按 wid 隔离（`term_spawn` / `run_in_terminal` 把 wid 传给共享 `start_session`）。
- `term_write` / `term_resize` / `term_kill` / `term_kill_all` 均注入 `window` 按 wid 定位；`script_run_busy(wid)` 只查本 wid。
- `term_kill_all()` 只清本 wid；`term_kill_all_for_exit()` 用 `drain_all()`。

**#2 / #3 WATCHER / DEBUG**

- `watch_start(app, window, root)`：`wid = window.label()`，`WATCHER.get_or_default(wid)` 替换旧实例。
- `debug_start` / `debug_attach_debuggee` 注入 window，`DEBUG` 用 `PerWindow` 按 wid 存取；`debug_stop(app, window)` 只 `remove(wid)`。

### 4.3 任务清单

> **v0.2 回填（2026-10-03）**：#1 / #2 / #3 / #7 / #8 已于 2026-09-28 实施完成（见 §4 开头「实施状态」与「追加修复」）；#4 / #5 / #6 依赖健康三个缓存**经用户拍板暂缓**（key 已含「解释器 + 工作区根」，多窗口只缓存震荡不冲突），非遗漏。

- [x] 落地 `per_window.rs`（`PerWindow<T>` 完整实现 + 单测）
- [x] 依次改造 #1 ~ #8（每改一处跑一次相关冒烟）
- [x] 增加窗口关闭时的统一清理钩子（`WindowEvent::Destroyed` → 逐域 `*_for_window` / `remove(wid)`）
- [x] `cargo test`（含 `per_window` 单测）+ e2e 全绿
- [x] 手动验证：切换工作区后旧窗口 LSP/终端/调试状态无残留
- [~] #4 / #5 / #6 依赖健康三缓存：**已拍板暂缓**（非冲突项，留性能优化）

### 4.4 阶段 1 验收

- 单窗口行为零回归。
- 同一进程内两个窗口各自 `startEngine` 互不杀进程（写一个临时 Rust 单测模拟双 wid 并存）。
- 窗口关闭后 `PerWindow` 内资源被清空（无泄漏）。

---

## 5. 阶段 2：开窗口与前端参数化

> **实施状态（2026-09-28 已实施）**：新增 `window_mgr.rs`（`open_workspace_window` / `get_window_project` / `WINDOW_PROJECTS` 映射 + 窗口 `Destroyed` 清理钩子）；各域补按窗口清理函数（`lsp_stop_for_window` / `term_kill_all_for_window` / `debug_stop_for_window` / `watch_stop_impl` 改 `pub(crate)`）；前端 `openInitialWorkspace`（启动参数化）+ 菜单「在新窗口打开工作区…」。`cargo build` / `cargo test`（233 passed）/ `tsc` 全绿。
> **关键根因与修复（真机 CDP 定位）**：新窗口「无文件树 / 无交互 / 关不了窗」的根因是 **`capabilities/default.json` 的 `windows: ["main"]` 白名单**——项目窗口（label = project_hash）拿不到 `event.listen` / `app.version` 等权限，前端 `init()` 首次 `listen` 即抛「not allowed」中断。修复：`windows` 改 `["*"]`。`data_directory` 保持与主窗口**共享**（同 profile 是常态，无 IPC 问题）。
> **真机 CDP 验收**：`shell/e2e-real/multi-window-real.cjs`（预置 `recent-workspaces` 恢复 A + 页面内 `invoke('open_workspace_window')` 开 B，绕过文件夹选择框），**7 项全 PASS**：主窗口恢复 A / 开 B / 新窗口 page 出现 / 新窗口文件树渲染 / 新窗口可打开文件 / 重复打开去重 / 关闭 B 且 A 不受影响（两窗口 LSP 独立不互杀）。
> **实施修订**：① 项目目录透传用 `WINDOW_PROJECTS`（`LazyLock<Mutex<HashMap<label,path>>>`），前端经 `get_window_project` 反查；② 窗口关闭清理走 `on_window_event(WindowEvent::Destroyed)` 逐域调用（不能依赖 `window` 命令注入，窗口已销毁）。

### 5.1 后端

- 新增命令 `open_workspace_window`：**必须 `async fn`**（§2.4 探针 #2：同步 `fn` 内 `WebviewWindowBuilder::build()` 死锁，`async fn` 正常）。签名 `async fn open_workspace_window(app: AppHandle, path: String) -> Result<(), String>`：
  1. `let label = project_hash(&path);`
  2. 若 `app.get_webview_window(&label)` 已存在 → `set_focus()` 后返回（去重）。
  3. 否则 `WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())` 复刻 `lib.rs:41` 的构建配置（含 Windows `data_directory`、`on_page_load` 显隐、最小尺寸）。
  4. 把初始项目目录透传给窗口（见 5.2）。
  5. 记录「label → path」映射（供前端查询项目目录；可复用现有 `recent_workspaces` 结构或新增 `MultiWindowRegistry` 的 `Mutex<HashMap<String, String>>`）。
- 新增查询命令 `get_window_project(window)` → 返回该窗口的项目目录（label 反查 path），前端启动时调用。

### 5.2 前端

- 启动参数化：在 `main.ts` init 早期 `.get_window_project()` 拿到项目目录；若非空则调用现有 `openWorkspace(path)`（内部 `startLsp/refreshTree/restoreSession` 均已按 `app.workspaceRoot` 形参化，天然随窗口独立）。
- 菜单「文件 → 打开文件夹」拆分：「在当前窗口打开」（现有 `openFolderFromToolbar`）与「在新窗口打开」（新命令 → `open_workspace_window`）。
- 无项目窗口继续展示 Welcome / 最近项目。

### 5.3 任务清单

> **v0.2 回填（2026-10-03）**：三项均于 2026-09-28 实施完成（见 §5 开头「实施状态」），其中「窗口关闭清理钩子」在实施中修订为 `on_window_event(WindowEvent::Destroyed)` 逐域调用（不能依赖 `window` 命令注入，窗口已销毁）。

- [x] 后端 `open_workspace_window` + `get_window_project` + label→path 映射（`WINDOW_PROJECTS`）
- [x] 前端启动参数化（`openInitialWorkspace` → `get_window_project`）+ 菜单双入口（「在新窗口打开工作区…」）
- [x] 窗口关闭清理钩子接入（`WindowEvent::Destroyed` → `PerWindow::remove` + `WINDOW_PROJECTS` 移除）
- [x] 附带修正：`capabilities/default.json` 的 `windows: ["main"]` → `["*"]`（项目窗口拿不到 `event.listen` / `app.version` 权限导致前端 `init()` 中断——真机 CDP 定位）

### 5.4 阶段 2 验收（真实双窗口场景）

- 同时开项目 A、B：各自补全/跳转正确，LSP 不互相杀。
- 窗口 A 调试中，窗口 B 可独立启动调试，互不打断。
- 窗口 A 运行脚本 + 终端，窗口 B 的终端/运行输出不串到 A。
- 重复打开项目 A → 聚焦既有窗口，不新建。
- 关闭窗口 A → A 的 LSP/终端/调试/监听全部终止，B 不受影响。

> **自动化验收记录（`e2e-real/multi-window-real.cjs`，2026-09-28 已跑通，16/16 PASS）**：
> `MC-REAL-1..7`（窗口创建/文件树/交互/去重/关闭）+ `MC-REAL-LSP-1/2`（LSP 隔离）+ `MC-REAL-WATCH-1/2`（文件监听独立性）+ `MC-REAL-TERM-1/2/3`（终端 spawn + term-data 定向不串）+ `MC-REAL-DBG-1/2`（双窗口调试会话并存）。
> 运行：`cd shell && node e2e-real/multi-window-real.cjs`；调试段需真实解释器，`OC_REAL_PYTHON=<解释器路径>`（缺省取 PATH 的 `python`，缺失时调试段自动 SKIP，其余用例照跑）。
> 本案已通过 §5.4 全部场景自动化验收，无需再手动 GUI 验收本清单。

---

## 6. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| LSP 键改造漏点导致跨窗口串杀 | 高 | #1 单独成次改动 + 单元测试双 wid 并存 |
| 事件仍走全局 `app.emit` → 串扰残留 | 高 | 阶段 0 用 grep `\.emit\(` 全量排查，除 `plugins-dir-changed` 外清零 |
| 前端混用全局/窗口级 listen 收两遍 | 中 | 阶段 0 用 grep 确认仅 `plugins-dir-changed` 走全局 |
| 窗口关闭资源未清理 → 泄漏/僵尸进程 | 高 | 统一 `PerWindow::remove` 钩子 + 关闭冒烟 |
| 单值缓存（#4/#5/#6）串味表现为环境面板错显 | 中 | 阶段 1 逐项冒烟：两窗口各自装/删包、看面板 |
| Git 网络操作并发冲突 | 中 | #8 op key 加 wid 前缀 |

回滚：每阶段提交独立 PR；阶段 0 若回归，可直接 revert 到上一提交（不改业务行为，回滚成本低）。

---

## 7. 排期总表

| 阶段 | 内容 | 预估 | 前置 |
|---|---|---|---|
| 0 | 事件定向 | 2-3 人日 | — |
| 1 | 状态分区 + PerWindow | 3-5 人日 | 阶段 0 |
| 2 | 开窗口 + 参数化 | 2-3 人日 | 阶段 1 |

合计约 7-11 人日，外加双窗口真实场景验收约 1-2 人日。

---

## 8. Definition of Done

> **v0.2 对账（2026-10-03）**：四条逐项核对，全部关闭。

1. [x] 阶段 0 / 1 / 2 已实施：`cargo check` 零告警、`cargo test` **233 passed / 0 failed**（2026-09-28 当时值；当前基线 289）、前端 `tsc` 零错误、启动冒烟通过。
2. [x] **真机双窗口已自动化验收**：`e2e-real/multi-window-real.cjs` **16/16 PASS**（`MC-REAL-1..7` + LSP 2 + WATCH 2 + TERM 3 + DBG 2），覆盖 §5.4 全部场景，替代原「手动 GUI 验收」遗留项。
3. [x] 实施偏差与真实环境验证结论**以本 v0.2 修订记录**（不另建 `multi_window_acceptance_record.md`——避免重复叙述；偏差已逐条落在 §4 / §5 的「实施状态 / 追加修复 / 实施修订」块内：`lsp_stop("*")` 误杀跨窗口实例、`capabilities` 白名单、阶段 1 三缓存暂缓、清理钩子改 `Destroyed`）。
4. [x] 无业务行为回归；「单窗口多工作区」已登记为后续可选演进项（`improvement_and_roadmap_report.md` P2-4 口径：登记不排期）。

**遗留（不阻塞交付）**：#4 / #5 / #6 依赖健康三缓存的多窗口隔离优化（已拍板暂缓，只影响性能不影响正确性）。