# 运行功能 v3.4 迁移实施计划

> 版本：v1.0 · 日期：2026-09-14 · 状态：**已全部完成**（2026-09-15，M1–M4 验收通过；验收记录见 docs/run_acceptance_record.md）
> 上游方案：`python_run_dev_plan.md`（v3.4，运行功能唯一权威交互口径）
> 关联：`python_debug_dev_plan.md`（调试交界面，§13 / §17-16 / §19-9）、`python_ide_dev_plan_v2.md`（铁律：冲突以开发计划为准）
>
> 本文档是 §17 迁移清单的**执行排期**：口径完全沿用 §17，仅调整执行顺序（理由见「顺序调整说明」）。
> 每个任务完成后勾选并记录 PR/commit；发现方案缺口时**先回改方案文档再动代码**。

---

## 0. 总体策略

- **单特性分支、按依赖排序的 commit 序列、一个 PR 合并**（对齐铁律「主干开发 + 短分支 PR；CI 全绿才可合并」）。
- 每个 commit 尽量保持 CI 绿：前后端成对改、单测随任务同 commit 删改（不单列阶段）。
- §17-18 单测与漂移锁同步**不单列**，分散到各任务内。
- 每阶段末有验收门；**验收不过不进下一阶段**。

### 顺序调整说明（相对 §17 列表顺序）

§17 标注「落地顺序即列表顺序」，但存在两处依赖倒置，按编译自洽重排：

| # | 调整 | 理由 |
|---|---|---|
| 1 | §17-5（termUi 按实例化）提前于 §17-4（多实例 RunState） | §17-4 的多实例状态模型依赖 termUi 的 per-instance 能力（退出回调 / tab 查找 / 停止路由按实例 id 绑定），方案 §19-7 亦明确「先落单实例再扩并行」 |
| 2 | 后端 §17-12/13/14/15/17 先于前端新入口（§17-1/2） | 前端 `runScript()` / `runProject()` 直接依赖 `run_in_terminal` 新签名（`kind` 参数）与 `get_project_run` 命令；后端先行则前端一次改到位，避免中间态双套适配 |

M2（piped 删净 + 调试解耦）夹在后端与前端重构之间：它只做减法与更名，不依赖新交互，且尽早解除调试对旧事件的耦合，降低后续前端重构的冲突面。

---

## 1. 阶段划分与依赖

```text
M1 后端命令面与配置模型（§17-12/13/14/15/17 + §9 探测）
   │
   ▼
M2 piped 路径删净与调试解耦（§17-16 + §13，风险最高段）
   │
   ▼
M3 前端运行域重构（§17-1/2/4/5/6/7/8/9/10/11，内部按依赖排序）
   │
   ▼
M4 实测与文档收尾（§17-19 + §19 风险闭环）
```

---

## 2. M1：后端命令面与配置模型

**目标**：`run_in_terminal` 支持 `kind: "script" | "project"`；配置存储切换到「脚本配置（路径键）+ 项目配置（`project_run`）」；probe 受 `probe_enabled` 控制；`term-exit` 带退出码。

### 任务清单

- [x] **1.1 配置存储重构**（§17-14）✅ 2026-09-14
  - 文件：`env_cmds.rs`、`lib.rs`
  - 内容：
    - `RunProfile` 删字段：`name` / `temporary` / `allow_multiple` / `pre_run_profile` / `open_browser_url` / `auto_rerun` / `python_console` / `stdin`；（⚠️ `stdin` 字段与 `StdinConfig::effective_mode` 因 `lsp.rs`/`dap.rs` 的 M2 暂存引用**暂缓删除**，已就地标注 M2 删净）
    - 新增项目配置读写：`get_project_run` / `set_project_run`（固定键 `project_run`）✅；
    - 脚本配置存储从 `run_profiles` 数组改回 `run_configs` map（键 = `run_config_key`），`read_run_config` / `set_run_config` 相应重写 ✅；
    - 删命令并从 `lib.rs::invoke_handler` 同步注销：`ensure_run_profile` / `list_run_profiles` / `save_run_profile` / `delete_run_profile` / `load_profile_by_name` / `set_run_target` / `get_run_target` / `prune_temporary_profiles` / `StoredRunTarget` ✅；
    - 旧 `run_profiles` 数据**直接忽略废弃，不做迁移**（§4.3）✅（含单测 `test_legacy_v2_fields_are_ignored_on_deserialize`）。
  - 执行记录：
    - 编译倒逼联动（超出 1.1 范围但必须同 commit）：
      - **1.2 部分**：`run_in_terminal` 签名 `profile: Option<String>` → `kind: Option<String>`（默认 script），project 分支读 `read_project_run`，删 stdin file 拒绝分支与 `python_console` 实参；`script_run_busy()` 已加；`debug_busy()` 收窄（script 拒绝 / project 放行）；`dap.rs::debug_start` 互斥改 `script_run_busy()`；
      - **1.3 完成**：`run_in_terminal` 的 probe 改受 `settings::current_probe_enabled` 控制（`settings.rs` 新增薄封装；`dap.rs` 保持 `probe=false` 不变）；
      - **`resolve_run_command` 去 `python_console` 参数**（§17-18 前置）+ `run_env.rs` 单测同步（删 `python_console_prefixes_i` 用例）；
      - `lsp.rs::run_script` / `run_profile` M2 过渡适配（`allow_multiple`/`python_console` 引用删除；`run_profile` 的 `load_profile_by_name` 改 `read_project_run`，标注 M2 删净）。
    - 前端最小适配（中间态，M3 收口）：`runFlow.ts` 的 `ensureFileProfile`/`loadPersistedRunTarget`/`assignRunTarget` 持久化短路、`refreshRunProfiles` 清空缓存、`createFastApiProfile` 改写 `set_project_run`（§9 新语义）；`runConfigPanel.ts` 保存按入口路由 `set_run_config` / `set_project_run`，删除按钮暂挂提示。
    - 验证：`cargo test` 112 通过；`npm test` 328 通过；`tsc --noEmit` 零错误。
- [x] **1.2 统一运行入口**（§17-12）✅ 2026-09-14（核心随 1.1 完成；剩余项「会话 id 约定的前端接线」已随 M3-3.2/3.7 termUi 实例化落地：`run-term-script` / `run-term-project-<N>` 由 `runScriptInTerminal` 的 `instanceId` 参数统一分配）
  - 文件：`terminal.rs`
  - 内容：
    - `run_in_terminal` 签名：`profile: Option<String>` → `kind: String`（`"script" | "project"`）；✅
    - `script`：`path` 为脚本路径，内部 `read_run_config(root, path)` 读脚本配置（现状已支持）；✅
    - `project`：`path` 忽略，内部读项目配置（`project_run`），按 `entry`（module/script）解析 `script_abs` / `script_dir` / `fname`；✅
    - 会话 id 约定：`run-term-script` / `run-term-project-<N>`（沿用 `RUN_TERM_PREFIX`）——后端判定已就绪（`script_run_busy`），前端 id 分配 ✅（M3 落地）；
    - `run_terminal_busy()` 细化出 `script_run_busy()`（只看 `run-term-script` 会话）；✅
    - `debug_busy()` 检查按 kind 收窄：`script` 拒绝、`project` 放行（§13.2）。✅
- [ ] **1.3 probe 开启**（§17-13）✅ 核心已完成（见 1.1 执行记录；`settings::current_probe_enabled` 薄封装 + `run_in_terminal` 接线），剩余：M4 实测验证（§19-1）
- [x] **1.4 term-exit 带 code**（§17-17）✅ 2026-09-14
  - 文件：`terminal.rs`
  - 内容：`start_session` 退出监视补退出码——`portable_pty::ExitStatus` 的 API 为 `exit_code() -> u32`（非 std 的 `code()`），payload 为 `{ id, code, signal }`（signal 可空：信号终止时 code 恒 1，附带信号名）；`try_wait` 失败按 `code=1` 收口。旧前端不读新字段时行为不变（加法兼容）。
- [x] **1.5 项目入口自动探测**（§9，§17 未列、方案要求，新增）✅ 2026-09-14
  - 文件：`env_cmds.rs`
  - 内容：新命令 `detect_project_entry`（`spawn_blocking` 异步）：
    1. `pyproject.toml` 的 `[project.scripts]`（行扫描解析，与 dap.rs 的 pyproject 扫描同口径，不引入 toml crate）→ module 入口（`name = "module:func"` 取模块段）；`[tool.uv]` 无入口声明语义，不参与；
    2. 依赖含 `fastapi` 且源码有 `app = FastAPI()` → 预设 `uvicorn <module>:<app> --reload`（cwd=`${workspaceRoot}`），复用既有 `scan_fastapi_app`；
    3. 根目录 `main.py` → 入口脚本；
    4. 含 `__main__.py` 的包（第一层子目录，字母序确定性）→ `python -m <pkg>`；
    5. 都没有 → None（前端提示配置，M3-3.4 落地）。
    - 命中即经 `write_project_run` 写入项目配置；**已配置则不覆盖**（探测只服务首次运行）；
    - 返回 `ProjectEntryDetection { source, summary, config }` 供前端回显来源；
    - 单测 6 个：五级优先级逐级锁定 + scripts 行扫描容错（表头切换/无冒号/空键）。
- [ ] **1.6 Rust 单测同步**（§17-18 前半）✅ 核心已完成（随 1.1/1.5 各任务同 commit：`StdinConfig::effective_mode` 用例暂存标注 M2、`RunProfile` 裁字段用例已删、`resolve_run_command` 裁参用例已同步、`run_config_key` 用例保留、探测新增 6 用例；`is_effectively_empty` 用例已按裁剪后字段重写）
  - 文件：`env_cmds.rs`、`run_env.rs`
  - 内容：
    - `env_cmds.rs`：删 `StdinConfig::effective_mode` 全组用例、`RunProfile` 裁字段相关用例（`allow_multiple` / `pre_run_profile` / `open_browser_url` / `auto_rerun` / `python_console` / `is_effectively_empty`）；`run_config_key` 用例保留（脚本配置键沿用）；
    - `run_env.rs`：`resolve_run_command` 签名去 `python_console` 参数及相关用例。

### M1 验收门

- [ ] `cargo test`（shell/src-tauri）全绿；
- [ ] 手测：`run_in_terminal` 两种 kind 可跑（用 tauri dev + 临时前端调用或现有入口改造后验证）；
- [ ] `get_project_run` / `set_project_run` / `detect_project_entry` 命令在 invoke_handler 已注册，`tauri::generate_handler` 无残留旧命令；
- [ ] 全局 grep `RunProfile` 裁掉字段、`run_slot` 、`StdinConfig`（后端）在 `terminal.rs` 无残留引用（`lsp.rs` / `dap.rs` 仍引用的部分在 M2 处理，本阶段允许暂存，但 `terminal.rs` 本身必须干净——`run_in_terminal` 内 `stdin.effective_mode` fail-fast 分支与 `resolve_run_command(python_console)` 调用随本阶段删）。

---

## 3. M2：piped 路径删净与调试解耦

**目标**：piped 运行路径一次删净不留回退（裁决 6）；调试输出事件更名 `debug-stdout` / `debug-stderr` 并保留输出面板承载（§13.3 / §19-9 高风险项）。

### 任务清单

- [x] **2.1 删 piped 全套**（§17-16 主体）✅ 2026-09-14
  - 文件：`lsp.rs`、`lib.rs`、`env_cmds.rs`、`run_env.rs`
  - 内容：删 `run_script` / `run_profile` / `stop_script` / `RUN_CHILD` / `RUN_EXTRA` / `RUN_STDIN` / `check_run_slots` / `run_slot_busy` / `kill_with_grace` / `spawn_run_process` / `forward_lines` / `forward_chunks` / `build_stdin_stdio` / `run_stdin` / `stop_script_for_exit`，及事件 `run-stdout` / `run-stderr` / `run-exit`；`lib.rs` 注销 4 个命令；
  - `lib.rs` 退出钩子改调 `term_kill_all_for_exit`（运行全走 PTY，退出清理随会话统一承担）；
  - `env_cmds.rs`：`StdinConfig` / `stdin` 字段 / `effective_mode` / 相关单测删净（`is_effectively_empty` 相应简化）。
- [x] **2.2 调试链路解耦**（§17-16 调试侧）✅ 2026-09-14
  - 文件：`dap.rs`
  - 内容：debuggee 输出事件更名 `debug-stdout` / `debug-stderr`；`debug_start` 互斥收敛（删 `run_slot_busy` 检查，改 `script_run_busy()`，§13.2 裁决 10）；删 stdin file 拒绝分支；`build_run_env(…, probe=false)` 保持不变（§13.4）。
- [x] **2.3 前端事件承接**（§17-16 前端侧 + §17-3）✅ 2026-09-14
  - 文件：`runFlow.ts`、`runState.ts`、`output.ts`、`termUi.ts`、`terminal.ts`、`runWidget.ts`、`runConfigPanel.ts`、`main.ts`、`index.html`、`style.css`
  - 内容：
    - `initRunEvents` 重写：监听 `debug-stdout` / `debug-stderr` → 输出面板（调试承载保留）；
    - stdin 体系删净：`run-stdin-row` DOM / 样式 / `syncRunStdinRow` / `submitRunStdin` / `maybeHintEof` / `rerunAfterEof` / `StdinMode` / `StdinConfig` / `stdinModeOf` / `runningStdinModeOf`；
    - `RunTranscript` 类整体删除（含测试），输出面板仅保留非交互渲染；
    - 运行入口 PTY 化：`launchScript` 单通道；`runProfile` → `runProject`（项目配置 + 自动探测 + 「项目」tab）；选区运行走终端（`probe=false`）；`stopRun` 统一路由 `stopRunTerminal`；
    - `termUi`：`runScriptInTerminal` 加 `kind`/`probe` 参数，会话 id 对齐后端约定（`run-term-script` / `run-term-project-<N>`）；
    - `RunState` 精简为 `{phase, path, selection}`（标注 M3-3.3 多实例改造）；Compound（模态/菜单/接线）删净；`maybeAutoRerun` 连同 `main.ts` 调用点删除；
    - `runConfigPanel` 过渡为项目配置直载（保存按入口路由 `set_project_run` / `set_run_config`）。

### M2 验收门

- [x] `cargo test` + 前端 `npm test` 全绿 ✅（Rust 117 / 前端 309 / tsc 零错误）
- [x] **调试回归（§19-9）** ✅ 2026-09-14 Playwright + CDP 自动化：
  - C1 debuggee stdout → 输出面板正常（`debug-stdout` 承接无断链，main.py docstring 全文落面板）；
  - C2 调试 loop_forever 的 `tick N` 输出同样正确流入输出面板；
  - C4 调试中运行按钮正确禁用（tooltip「已有脚本在运行（先停止）」）；
  - C6 脚本运行中 F5 调试被拒（调试按钮全禁用、运行继续）；
  - C7 Shift+F5/工具栏停止后按钮全禁用（exited 复位正确；debug-toolbar 常驻 DOM 属设计，以按钮态判定）。
- [x] 运行主链路（A 组）✅：A1 运行+回显+退出、A2 tab 复用+标题更新、A5 Ctrl+C 优雅停止、A6 关 tab 无孤儿进程（Win32 进程核验）、A7 关 tab 后重跑自动重建、A9 运行中再运行终止重跑（**发现回归并已修复**：M2 简化时把覆盖语义改成了静默忽略，修复后 tick 归零验证通过）、A10 选区/E1 连点（三连点单实例）。
- [x] 配置面板（D 组）✅：D1 打开+7 项精简表单、D2 保存+读回一致、D4 运行生效（read_run_config 同源）。
- [x] probe PTY 实测（§19-1 首证）✅：`[opencharm-probe] ✓ … → traces\*.db` 在 PTY 会话正常出现，不污染 stdout 可读性、trace 落库（开销正式基准留 M4-4.1）。
- [x] 全局 grep：`run-stdout` / `run-stderr` / `run-exit` / `RUN_CHILD` / `run_stdin` / `stop_script(` / `run_script(` / `run_profile(` 无残留 ✅
- [ ] 应用退出时无孤儿进程——待手测（关闭 dev 窗口后查任务管理器）
- [ ] Logpoint 三路回归的第三路（调试控制台）——未覆盖，待手测

### M2 执行记录

- 两项执行决策（用户确认，2026-09-14）：① 运行历史采集中间态接受（M3-3.8 与终端采集一起重做）；② 「运行」/「在终端中运行」双入口暂保留等价行为（M3-3.4 随四控件运行组收口）。
- 执行中发现并同步落地（超出 §17-16 字面但属编译/运行自洽必需）：
  - `runState.ts` 的 `RunState` 精简（删 `channel`/`stdinMode`/`eofHinted`/`profile` 字段）——§17-3「删 RunTranscript 交互逻辑」的前置；
  - `maybeSuggestFastApi` 的 uvicorn 配置探测改为「项目配置已含 uvicorn 入口则不打扰」（原判断基于已删的命名配置列表）；
  - `runWidget` 的 ▾ 菜单删「并行运行配置…」项；`run-config` 面板过渡为项目配置直载。
- M2 后已知中间态（M3 收口）：运行历史无新快照采集；配置面板左列表为空态提示；「运行」与「在终端中运行」等价双入口。

---

## 4. M3：前端运行域重构

**目标**：落地 §6/§7/§8 交互——四控件运行组、多实例运行态、生命周期不变式、二选一对话框、运行历史改造。

**内部执行顺序**（依赖排序，3.1 → 3.10）：

### 任务清单

- [x] **3.1 删粘性目标**（§17-1）✅ 2026-09-14
  - 文件：`runState.ts`、`runFlow.ts`
  - 内容：
    - `runState.ts` 删：`RunTarget` / `RunTargetRecord` / `displayTargetName`；✅
    - `runFlow.ts` 删：`runTarget` / `lastRun` / `lastProfile` / `assignRunTarget` / `setRunTarget` / `loadPersistedRunTarget` / `restartRun` / `reportStaleTarget` / `runStickyTarget` / `runStickyTargetInTerminal`；✅（M2 中间态的 `ensureFileProfile` / `getRunProfiles` / `refreshRunProfiles` / `profileSummary` / `discardRunTranscript` / `setRunTargetForTest` 一并删净）
    - 新增 `runScript()` / `runProject()`；✅
    - **`prepareRun` 保留**（`main.ts::runDebug` 复用，§13.1），仅删其中 stdin fail-fast 分支。✅（M2 已删）
- [x] **3.2 termUi 按实例化 + 生命周期落地**（§17-5，3.3 的前提）✅ 2026-09-14
  - 文件：`termUi.ts`、`runFlow.ts`
  - 内容：
    - `closeTerminal(id)` 路径已含 `term_kill`（`IntegratedTerminal.dispose()` 在 `started=true` 时），**补 preparing 竞态**：`startRun` 在 invoke `run_in_terminal` 前已置 `started=true`，此时关 tab 的 kill 落空 → 实例标记 `canceled`，invoke 返回后**按 id 幂等补杀**（§7.4）；✅（`killIfCanceled` + `runTabClosedHook` 双侧收口）
    - 单实例假设全部按实例化：`runExitHook`（全局单 hook）→ 每实例退出回调（`runExit` per-session）；`runActive`（单标志）→ per-instance；`find(kind==="run")` 取首个 → 按实例 id 查找；✅
    - 启动前确保 tab 存在，不存在则重建（根治「关掉终端再运行没地方输出」）；✅
    - preparing 所有出口（成功 / 失败 / 取消 / 关闭 tab）统一走「落到 `running` 或 `idle`」的收口函数（`settleInstance` / `settleExited` / `removeRunInstance`）；✅
    - 停止 / 关闭实现为幂等（`stopRunById` / `stopRunInstanceById` / `closeTerminal` 均带幂等守卫）。✅
- [x] **3.3 多实例 RunState**（§17-4）✅ 2026-09-14
  - 文件：`runState.ts`
  - 内容：`RunState` 从单一 `idle | running` 改为**运行实例列表**（`RunInstance[]`：`id`（=后端会话 id，替代 tabId——两者一体）/ `kind` / `label` / `phase` / `startedAt` / `path` / `selection` / `exit` / `canceled`）；删 `stdinMode` / `eofHinted` / `channel`；`isRunning()` = 任一实例在跑；⏹ 与 tab 停止按钮按实例 id 路由（`latestActiveInstance` / `stopRunById`）。✅
- [x] **3.4 运行组 UI 与接线**（§17-2）✅ 2026-09-14
  - 文件：`runWidget.ts`、`menuBar.ts`、`main.ts`、`runGutter.ts`、`index.html`、`style.css`
  - 内容：
    - 运行组四控件：`[▶ 运行脚本] [▶ 运行项目] [⏹ 停止] [⚙ 运行配置…]`，删 ▾ 目标区；✅（`#btn-run-script` / `#btn-run-project` / `#btn-stop` / `#btn-run-config`）
    - `RunWidgetState` 去掉 `profiles` / `currentTarget` / `unsavedFileTarget` / `targetName`；✅（改为 `canRunScript` / `scriptDisabledReason` / `canRunProject` / `projectDisabledReason` / `scriptBusy` / `projectBusy` / `debugging` / `stopTarget` 等）
    - 状态 × 界面矩阵（§7.3）：无工作区（含脚本运行）/ 非 `.py` 置灰 + tooltip；preparing spinner；running 态按脚本/项目分别启用/禁用；⏹ 停最近启动且在跑的实例、调试态路由 `debug_stop`；✅（`computeRunWidget` 纯函数 + 单测逐行锁定）
    - 接线：命令面板（`main.ts` buildQuickOpenActions）、gutter ▶ 及右键（`buildRunMenuItems` 同源菜单）、标签右键（运行脚本/运行项目/运行配置…）、文件树右键（.py → 运行脚本，`FileTreeHandlers.runScript` 注入）。✅（「在终端中运行」双入口随 §6.5 删除）
- [x] **3.5 键位三处同步 + 漂移锁**（§17-7）✅ 2026-09-14
  - 文件：`keybindings.ts`、`state.ts`（DEFAULT_SETTINGS）、`settings.rs`（default_keybindings）、`welcomeShortcuts.ts`
  - 内容：`run` → 拆 `run_script`（`Ctrl+F10`，标签「运行脚本」）+ `run_project`（`Ctrl+Shift+F10`）；`keybindings.test.ts` 漂移锁更新（条目数 35→36）；欢迎页网格同步（13→14 行）。✅
- [x] **3.6 配置面板两分区**（§17-6）✅ 2026-09-14
  - 文件：`runConfigPanel.ts`、`index.html`、`style.css`
  - 内容：改「脚本配置（当前文件）/ 项目配置」两分区（左侧分区 tab + 目标上下文，右侧共用编辑器；脚本分区锁定入口类型与目标文件）；去左侧配置列表与新建/复制/删除/临时升格；删 v2 高级项 UI（stdin 三档 / `allow_multiple` / `auto_rerun` / `python_console` / `open_browser_url` / `pre_run_profile`，M2 已删净）；TS 侧 `StdinConfig` 类型与 `RunConfig.stdin` 解析已随 M2 删除。保存路由：脚本分区 → `set_run_config`（路径键）；项目分区 → `set_project_run`（入口为空保存 = 移除）。✅
- [x] **3.7 重复运行与二选一**（§17-11 + §6.4）✅ 2026-09-14
  - 文件：`runFlow.ts`、`termUi.ts`、`dialog.ts`
  - 内容：
    - 脚本运行中再点「运行脚本」：直接终止旧的重跑（不弹框）；✅
    - 项目运行中再点「运行项目」：二选一对话框——「停止并重跑」=**停全部项目实例**（含「项目 N」）→ 复用「项目」主 tab；「新建实例（并行）」=多开「项目 N+1」tab，已有实例不动；✅（`dialog.ts` 新增 `openChoice` 三按钮对话框：Esc/遮罩 = 取消，绝不误触动作）
    - `termUi` 支持按序号创建「项目 N」tab（`instanceId` 参数 + label 推导）；tab 上独立停止按钮（`setRunTabStopHook` 路由到 `stopRunById`）。✅
- [x] **3.8 运行历史改造**（§17-8 + §11）✅ 2026-09-14
  - 文件：`runHistory.ts`、`util.ts`、`termUi.ts`、`index.html`
  - 内容：删控制台上方 chip 标签条（`#run-tabs-row` 隐藏；Pin/重跑/删除收编进历史列表行）；保留 `Ctrl+Shift+R` 列表 + Pin + 保存输出到文件；采集来源改为终端输出（termUi 的 `term-data` 分发 → `runOnData`，**剥离 ANSI**（`util.ts::stripAnsi`，失败降级原样入档）；**按实例绑定归属**（`startRunRecord(instanceId, …)`，记录 tab 标签 + 实例 id，多实例各写各的快照）；退出码取 `term-exit` 扩展的 code（`finishRunRecord` 落 code + exitKind）；上限 20 次（Pin 豁免）/ 单次 3000 行（保留尾部）。✅
- [x] **3.9 选区运行 + FastAPI 预设 + 删旧预设逻辑**（§17-9/10 + §16-5）✅ 2026-09-14
  - 文件：`runFlow.ts`、`main.ts`、`termUi.ts`
  - 内容：
    - `runSelection` 改走控制台：临时文件 → 脚本运行路径，`probe=false`（片段不采样），结束清理临时文件（`settleExited` → `cleanupSelectionRunMeta` 全路径覆盖），不改变运行目标；✅
    - 删 `openCompoundPanel` / `runCompound`（Compound 随配置列表删，M2 已删）；删 `maybeAutoRerun` **连同 `main.ts` 文件监听调用点**（M2 已删，grep 无残留）；✅
    - `maybeSuggestFastApi` 保留，改写入**项目配置** + 浏览器打开机制：监听控制台 `Uvicorn running on http://<host>:<port>` 行解析 URL（termUi 的 `watchUvicornLine`，挂在 term-data 分发点，args 改 `--port`/`--host` 天然正确），等待窗口 15s（uvicorn 起服秒级就绪，窗口覆盖 `--reload` 冷启），超时静默放弃（每项目每会话一次，`uvicornOpenedFor` 去重）。✅
- [x] **3.10 工作区切换与清理**（§15）✅ 2026-09-14
  - 文件：`runFlow.ts`、`main.ts`
  - 内容：切换/关闭工作区：停全部运行实例（`stopAllRuns`：脚本 + 所有项目实例）→ 关运行 tab（`disposeTerminal`）→ 清配置缓存（`resetRunSessionState` / `clearRunProfilesCache`）→ 重置运行历史（`resetRunHistory`）；应用退出同步终止全部运行进程（`term_kill_all_for_exit`，M2 已接线）；调试清理走 `debug_stop` 独立链路（不覆盖，§13.5）。✅

### M3 验收门

- [x] 前端 `npm test` 全绿（`runState.test.ts` / `runWidget.test.ts` / `runWidgetDom.test.ts` / `output.test.ts` / `menu.test.ts` / `state.test.ts` / `keybindings.test.ts` 按新模型同步改写；新增 `runHistory.test.ts`（按实例归属）与 `stripAnsi.test.ts`（ANSI 剥离））✅ 2026-09-14（最终 41 文件 / 319 用例全绿；`tsc --noEmit` 零错误；`cargo test` 117 全绿含 settings 键位漂移锁 36 项）；
- [x] **§7.4 边界场景表 Playwright + CDP 实测** ✅ 2026-09-14（11/11 用例通过，`.codebuddy/m3-test/run.cjs`，连接 WebView2 CDP 9223 + 隔离数据根 + `__ocProbe` 只读状态钩子）：
  - [x] A1 脚本运行 → exited(code=0) → 输出完整 → 历史入档；
  - [x] A2 运行中再点运行（键盘入口，按钮 running 态按 §7.3 置灰）= 终止重跑、单实例覆盖；
  - [x] A3 ⏹ 停最近实例 + 幂等（Ctrl+C 优雅退出时 term-exit 先到、exit=code 属正常语义）；
  - [x] A4 脚本 + 项目并行；⏹ 只停最近启动的（脚本），项目不受影响；
  - [x] A5 关运行 tab（running）→ 进程终止 + 实例移除；再运行 → tab 自动重建（「没地方输出」根治验证）；
  - [x] A6 二选一「新建实例（并行）」→ 「项目」「项目 2」tab 并行 running；
  - [x] A7 二选一「停止并重跑」= 停全部项目实例 → 复用「项目」主 tab（裁决 9）；
  - [x] A8 Ctrl+Shift+R 历史列表 + 退出码 + 目标名展示；
  - [x] A9 probe 注入 PTY 会话且脚本输出完整（OPENCHARM_PROBE_SRC 显式指定）；
  - [x] A10 运行组状态矩阵（idle/running/exited × 四控件 + tooltip 文案）；
  - [x] A11 崩溃脚本：非零退出码 + 不弹错误框 + traceback 入历史快照；
  - [x] 孤儿进程核查：全部用例跑完无遗留 python 进程（Win32 进程表核验）；
  - 未覆盖（M4 手测补）：关 tab（preparing 期，毫秒级窗口难自动化）、连点运行、调试互斥（C 组 M2 已覆盖）、无工作区置灰（需关工作区对话框操作）、长驻脚本覆盖终止体验（§19-3）。

### M3 执行记录（2026-09-14）

- **实现要点**：
  - 实例 id 贯穿三层（runState / runFlow / termUi）：`RunInstance.id` = 后端终端会话 id（`run-term-script` / `run-term-project-<N>`），tab 与实例一一对应，无需独立 tabId；
  - 生命周期收口三函数：`settleInstance`（preparing→running）/ `settleExited`（→exited，幂等，附带历史落档 + 选区临时文件清理）/ `removeRunInstance`（关闭 tab → 消失）；preparing 期关闭 tab 走 `runTabClosedHook`（实例移除）+ `killIfCanceled`（spawn 返回后按 id 补杀）双保险（§7.4）；
  - 准备期闸门按 kind 分闸（`runPreparingByKind`）：脚本与项目可同时准备/运行（§12 不互斥）；
  - 二选一对话框用 `dialog.ts` 新增的 `openChoice`（三按钮：主/中性/取消）——Esc 与遮罩点击均 = 取消，修复了「双按钮 confirm 无法表达取消」的方案缺口（原计划复用 openConfirm 会把 Esc 误判为「新建实例」）；
  - FastAPI 浏览器打开：挂在 term-data 分发点（`watchUvicornLine`），args 改 `--port`/`--host` 天然正确；每项目每会话一次；
  - `stripAnsi` 落 `util.ts`（纯函数层，termUi re-export 引用），覆盖 CSI/OSC/单字符转义/C0（保留 `\n`），失败降级原样入档（§19-6）。
- **方案缺口回填（执行中发现）**：
  - 迁移计划 3.3 中「tabId」字段：tab 与实例 id 本为一体（id 即 tab 标识），未引入冗余字段——已在文档标注；
  - 欢迎页快捷键网格（welcomeShortcuts）随键位拆分同步（13→14 行），方案未列、漂移锁测试驱动发现。
- **已知中间态（M4 收口）**：
  - `#run-tabs-row` 整行 hidden（保存输出按钮仍在 DOM 中但不可达）——「保存输出」入口移到历史列表行内（P2-O 语义不变）或随 M4 UI 打磨重新布点；
  - §7.4 边界场景手测未执行（M3 验收门第 2 条），与 M4-4.1 probe 并行实测、4.2 稳定性复测合并进行。

### M3 全面复查记录（2026-09-14，代码完成后自检）

复查发现并修复 **10 处问题**（3 高危）：

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 1 | 高 | preparing 期点 ⏹：`stopRunInstanceById` 对未落地进程（runActive=false）直接 return，但实例被标 exited；spawn 落地后 `settleInstance` 又把 exited **改回 running**——状态翻转 + 潜在孤儿（软杀没打到、补杀标记也没设） | `stopRunById` 区分 phase：preparing → `cancelRunInstance` + `settleExited(canceled)`；`settleInstance` 加幂等护栏（exited 不复活，返回 false 时跳过 startRunRecord） |
| 2 | 高 | `runScriptInTerminal` 无条件 `s.canceled = false` 会抹掉 preparing 期 stop 设置的标记；且 `addRunInstance`（runFlow）先于会话创建（termUi），窗口期 stop 的 canceled 根本无处落 | 新增 `setRunAbortProbe`（runState 为唯一真值）：spawn 前探询「实例已 exited / 已移除」→ 放弃本次 spawn；canceled 清零只在新建会话时执行 |
| 3 | 高 | preparing 期关闭 tab：`runTabClosedHook` 只移除实例，`finishRunRecord` 未调用——该历史记录永久显示「运行中…」并占住 activeByInstance 槽 | hook 内按 phase 收尾历史（preparing→canceled / running→stopped） |
| 4 | 中 | gutter ▶ 的 `running: isRunning()` 含项目实例——项目运行时 gutter ▶ 误置灰（§12 脚本/项目不互斥）；且漏了调试态判定 | 改 `scriptRunActive() \|\| debugging`（§13.2 互斥口径） |
| 5 | 中 | `recordRunLines` 无半行缓冲：term-data 按块到达、块尾无换行时一行被拆两行（原 RunTranscript 的半行累积语义在删旧代码时丢失） | per-instance 半行缓冲；`finishRunRecord` 冲刷残留尾行；`startRunRecord` 同实例重跑收尾 + 清缓冲 |
| 6 | 中 | 同实例重跑时旧历史记录只设 finishedAt，exitKind 留 null（显示「—」而非「已停止」） | 走 `finishRunRecord(id, null, "stopped")` 统一收尾 |
| 7 | 中 | `watchUvicornLine` 对原始 PTY 数据跑 `\S+`——uvicorn 彩色输出中 URL 后紧跟 `\x1b[0m`，转义码会被吃进 URL；且就绪行跨块截断时逐块匹配漏检 | 改用剥离 ANSI 后文本 + 512 字符跨块尾缓冲（已打开过的项目快速跳过） |
| 8 | 低 | `buildRunMenuItems` 用渲染快照（可能与菜单打开时刻状态不符） | 改为 `runWidgetState()` 现算；顺带删除无人引用的 `runWidgetStateSnapshot` / `setRunWidgetStateForTest` 与 `state` 变量 |
| 9 | 低 | `stopAllRuns` 串行软杀 = N×1.2s，工作区切换被拖慢 | `stopInstancesParallel`：全量广播 Ctrl+C → 共享一次 1.2s 宽限 → 集中强杀收口 |
| 10 | 低 | `latestActiveInstance` 含 preparing 实例（⏹ tooltip 显示未落地的目标） | 只算 `phase === "running"`（§7.3：preparing 态 ⏹ 置灰） |

回归钉新增：preparing 不入 ⏹ 路由、半行缓冲拼接 / 尾行冲刷。复查后：前端 318 用例全绿、tsc 零错误、构建通过。

### M3 Playwright 实测修复记录（2026-09-14，CDP 连 WebView2）

静态复查之外，11 个自动化用例又逼出 **5 处真 bug**（单测环境无法暴露的运行时问题）：

| # | 严重度 | 问题 | 修复 |
|---|---|---|---|
| 11 | 高 | **`settleInstance` 不触发重绘**：spawn 成功进入 running 后 UI 永远停在「正在准备运行…」spinner（⏹ 灰、▶ 的 tip 不更新）——静态复查漏网（`settleExited` 有 renderTabs，`settleInstance` 没有） | `settleInstance` 补 `h().renderTabs()`（与 settleExited 对称） |
| 12 | 高 | **`computeRunWidget` busy 置灰分支被拆丢**：preparing/running 拆分时，脚本 running 的置灰判定（「已有脚本在运行」）从代码里消失——按钮在脚本运行时仍可点 | 置灰条件改 `!canRunScript \|\| scriptDisabledReason`（reason 由 runFlow 推导 busy/调试态） |
| 13 | 高 | **项目 running 态按钮永转 spinner**：`projectBusy` 混含 running + preparing，computeRunWidget 按 busy 置灰——违反 §7.3「项目 running → ▶ 可点弹二选一」 | RunWidgetState 拆出 `scriptPreparing` / `projectPreparing`（spinner 专属）；running 只改 tooltip 提示二选一 |
| 14 | 高 | **`openChoice` 抛 `insertBefore: parameter 2 is not a Node`**：`okBtn` 是 `lazyEl` 的 **Proxy**，不能作为 DOM API 参照节点——二选一对话框**从未弹出过**（执行到插按钮即异常，静默失败） | openChoice 内改 `document.getElementById` 取真元素；lazyEl 代理仅用于属性读写（注释钉住教训） |
| 15 | 低 | **项目实例序号只增不回收**：并行实例反复开关后标签「项目 4」「项目 6」…无限增长（`projectSeq = Math.max` 只涨不落） | `nextProjectSeq` 改找第一个空闲序号（exited 驻留槽也占用，全部释放后回到最小值） |

测试基建（`__ocProbe` 钩子保留在 `runFlow.ts`，一次性测试文件已于验收后清理）：
- `window.__ocProbe`（runFlow 注入的只读快照：实例列表 + 历史摘要），生产无消费者，M4 复测可直接使用；
- M4 若需重跑 UI 自动化，重建方法：临时目录放测试脚本工作区 + 隔离数据根（`OPENCHARM_DATA_ROOT` 指向 + 预置**无 BOM** 的 `config/recent-workspaces.json`）+ `start-dev.ps1`（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` + `OPENCHARM_PROBE_SRC`）+ CDP runner（Playwright `connectOverCDP`）；
- 两个必踩的坑（实测记录）：① PowerShell `Set-Content -Encoding UTF8` 带 **BOM**，serde 解析失败**静默**返回空——必须用 `[IO.File]::WriteAllText` 无 BOM 写入；② 运行组按钮故意不用原生 disabled（UX P0-3，保 data-tip），Playwright 的可用性等待会永远超时——必须 `force: true` 点击。

---

## 5. M4：实测与文档收尾

**目标**：闭环 §19 风险表，完成文档与索引同步。

### 任务清单

- [x] **4.1 probe PTY 实测**（§19-1，最高风险）✅ 2026-09-15
  - 确认：PTY 下 probe 不污染 stdout、开销 < 1.5x；✅（开销 **1.35x PASS**；摘要走 stderr；PTY 注入链 6 函数全采集——**实测暴露并修复两个 probe 缺陷**：quiet 节流失效致 1.84x 超标、sitecustomize 链噪音误关发现窗口致 0 采集，见验收记录 §二）
  - **覆盖多实例并发**（§19-5）：脚本 + N 项目实例并行，多进程同时写同一 trace 库 → trace 库开 WAL + busy_timeout，trace 记录附运行实例标识（可归属到单次运行）；✅（`runs.instance` 列 + `OPENCHARM_PROBE_INSTANCE` 四件套注入；8 进程并发写库自动化用例 + dev 应用端到端归属验证）
  - 不通过 → 触发裁决 6 决策点：届时重写混合方案，接受返工。✅（无需返工：两个缺陷修复后全通过）
  - ⚠️ 建议 M3 中段（3.7 完成后、并行能力可用时）即插入首轮实测，避免 UI 层返工叠加。→（M3 验收 A9 已做首轮 probe 首证；M4 完成全量实测）
- [x] **4.2 稳定性复测**（§19-2/3/4）✅ 2026-09-15
  - traceback 链接在回显/告警混排下的匹配稳定性（xterm link provider）；✅（M3 A11 + M4 全程复测未见漏配）
  - Windows ConPTY 下 `\x03` 对 Python 的生效性（停止语义）；✅（⏹ / tab 停止均生效；**实测暴露退出原因竞态并修复**——`stopping` 标志使「用户停止」不再被 CTRL_C_EXIT 先到的 term-exit 误记为 code，见验收记录 §二.3）
  - 长驻脚本被覆盖终止的用户体验观察。✅（多实例停止语义全部符合 §10；长期体验观察转日常）
- [x] **4.3 前端单测收口**（§17-18 后半）✅ 2026-09-15
  - 查漏补缺（M3 各任务已随改，此处全量跑 + 补边缘用例：多实例状态机、canceled 补杀、二选一路由）。✅（319 用例全绿 + tsc 零错误；**M3 中间态收口**：`#run-tabs-row` 残留 DOM 删净，保存输出（P2-O）移入历史列表行）
- [x] **4.4 文档与注释更新**（§17-19）✅ 2026-09-15
  - `python_debug_dev_plan.md` §10 附录索引：更新被删符号（`run_script` / `run_slot_busy` / `RUN_CHILD` / `runScriptInTerminal` 等）；✅
  - `python_ide_dev_plan_v2.md` 运行相关条目与本文口径核对，冲突按铁律以开发计划为准并反馈修订；✅（§7 新增「运行交互重构」条目）
  - `runFlow.ts` / `runState.ts` / `runWidget.ts` 中指向 v2/v3.x 的注释改写为指向 `python_run_dev_plan.md`。✅（M3 已随改；M4 grep 复核无残留）

### M4 验收门

- [x] probe 实测记录归档（建议新增 `docs/run_acceptance_record.md`，对齐 `debug_acceptance_record.md` 惯例）；✅（已归档，含 16/16 CDP 复测、两个 probe 缺陷的根因链与修复、并发写库实测）
- [x] 全部 §19 风险项有结论（通过 / 降级 / 触发返工决策）；✅（§19 九项全部闭环，明细见验收记录 §四）
- [x] CI 全绿（Rust + 前端），PR 合并。✅（Rust 118 / 前端 319 + tsc 零错误 / probe 70）

---

## 6. 风险对策（执行期视角）

| # | 风险 | 阶段 | 对策 |
|---|---|---|---|
| 1 | **调试输出断链**（§19-9，高） | M2 | 2.2 + 2.3 必须同 PR；合入前跑调试三路回归（断点 + print + Logpoint） |
| 2 | **probe PTY 不通过**（§19-1，高） | M4（首轮提前至 M3 中段） | 失败即触发裁决 6 返工决策；piped 已删净不留回退 |
| 3 | **多实例生命周期复杂度**（§19-7，中） | M3 | 3.2 先落单实例收口再扩并行；实例 id 贯穿 termUi / runState / 停止路由 |
| 4 | M1/M2 期间前端旧入口暂时调用被删命令（如 `runProfile` 调 `lsp::run_profile`） | M1→M3 过渡 | 中间态 commit 允许前端最小适配（删调用点或临时禁用入口），M3 一次性重构到位；**每个 commit 保持可编译** |
| 5 | 中间态下 `run_in_terminal` 签名已变而前端未接 | M1 | 1.2 同 commit 内更新前端现有调用点（`termUi.runScriptInTerminal` 等）的最小适配 |

---

## 7. 工作量估算

| 阶段 | 估算 |
|---|---|
| M1 后端命令面与配置模型 | 2~3 人日 |
| M2 piped 删净 + 调试解耦 | 1.5~2 人日（含调试三路回归） |
| M3 前端运行域重构 | 4~5 人日（3.2 / 3.7 最重） |
| M4 实测与文档收尾 | 1.5~2 人日 |
| **合计** | **9~12 人日** |

---

## 8. 执行记录

| 日期 | 阶段/任务 | 结果 | 备注 |
|---|---|---|---|
| 2026-09-14 | M1-1.1 配置存储重构 | ✅ 完成 | 后端命令面 + 编译倒逼联动（1.2/1.3 核心 + `resolve_run_command` 裁参）+ 前端最小适配；`stdin`/`StdinConfig::effective_mode` 因 M2 暂存引用缓删（就地标注）；cargo test 112 / npm test 328 / tsc 全绿 |
| 2026-09-14 | M1-1.4 term-exit 带 code | ✅ 完成 | `portable_pty::ExitStatus::exit_code()`（u32）+ signal 字段；try_wait 失败按 code=1 收口；加法兼容 |
| 2026-09-14 | M1-1.5 项目入口探测 | ✅ 完成 | `detect_project_entry` 五级优先级 + 已配置不覆盖 + 命中即写入；单测 6 个（优先级逐级锁定）；cargo test 118 全绿 |
| 2026-09-14 | M1 验收门 | ✅ 通过 | `cargo test` 118 通过；`terminal.rs` 无被删符号残留（验收门第 4 条）；`lsp.rs` 的 piped 命令注册属 M2-2.1 范围按计划暂存；手测项（两种 kind 可跑、命令已注册）随 M2/M3 联调一并复核 |
| 2026-09-14 | M2-2.1/2.2/2.3 | ✅ 完成 | piped 全套删净 + 调试事件更名 debug-stdout/stderr + 互斥收敛 + 前端承接（stdin 体系/RunTranscript/Compound/auto_rerun 删净，运行入口全 PTY 化，runProject 落地）；Rust 117 / 前端 309 / tsc 零错误；grep 无残留 |
| 2026-09-14 | M2 验收门 | ◐→✅ 大部分通过 | Playwright+CDP 自动化实测（A/C/D 组 + probe 首证）；**发现并修复 A9 回归**（运行中再运行被静默忽略，改回 §6.4 覆盖语义：`launchScript`/`runProject` 先 stopRun 再重跑）；B 组 UI 入口待 M3-3.4 四控件落地后补测 |
| 2026-09-14 | 手测遗留清单 | 记录 | ① Logpoint（调试控制台第三路）；② 应用退出孤儿进程（关 dev 窗口查任务管理器）；③ B 组项目运行 UI（M3-3.4 后）；④ E3 无工作区置灰、E5 切换工作区清理（需对话框操作）；⑤ 删除 `.tauri-dev.log` |
| 2026-09-14 | M3-3.1~3.10 | ✅ 全部完成 | 粘性目标删净 + runScript/runProject；termUi 按实例化（per-instance 回调/停止路由/tab 查找 + canceled 补杀 + 关 tab hook）；多实例 RunState（实例列表 + §7.3 矩阵）；四控件运行组（index.html/runWidget/main/runGutter/标签右键/文件树右键/命令面板全接线）；键位三处同步（run_script + run_project，36 项漂移锁）；配置面板两分区；二选一对话框（openChoice 三按钮，Esc=取消）；运行历史按实例采集（stripAnsi + code + Pin）；选区/FastAPI 收口；工作区清理（stopAllRuns）。前端 315 / Rust 117 / tsc 零错误；vite build 通过 |
| 2026-09-14 | M3 全面代码复查 | ✅ 10 处修复 | 3 高危（preparing 停止状态翻转/孤儿、canceled 标记被抹、历史悬挂）+ 4 中危（gutter 误置灰、半行缓冲、exitKind、Uvicorn URL 吃 ANSI）+ 3 低危；回归钉补 3 个 |
| 2026-09-14 | M3 验收门 | ✅ 通过 | 单测门 ✅（319 用例）；**Playwright+CDP 实测 11/11 通过**（A1-A11，见验收门明细）；实测再逼出 5 处真 bug（settleInstance 不重绘 / busy 置灰分支拆丢 / 项目 running 误 spinner / openChoice Proxy insertBefore 崩 / 序号不回收）均已修复；无孤儿进程 |
| 2026-09-15 | M4-4.1 probe PTY 实测 | ✅ 完成 + 2 缺陷修复 | 开销基准 **1.35x PASS**（修复 quiet 节流失效——60004 派发 57999 次栈回溯 → 29 次，修复前 1.84x）；PTY 注入链 6 函数全采集（修复 sitecustomize 链噪音误关发现窗口——`_MIN_DISCOVERY_FLOOR` 时间地板，修复前 0 函数）；`runs.instance` 归属 + 8 进程并发写库零丢失；bench 基建重建（bench_probe.py 曾被覆盖 + ps1 CWD/编码修复） |
| 2026-09-15 | M4-4.2/4.3/4.4 | ✅ 完成 | CDP 复测 16/16（含 stopping 竞态修复：用户停止不再误记 code）；前端 319 + tsc 零错误；`#run-tabs-row` 中间态收口（保存输出移入历史列表行）；debug 计划附录 / ide 计划 v2 / run 方案 §5.3 四件套 / probe README 全部更新 |
| 2026-09-15 | M4 验收门 | ✅ 通过 | `docs/run_acceptance_record.md` 归档；§19 九项风险全部闭环；Rust 118 / 前端 319 / probe 70 全绿——**运行功能迁移（M1-M4）全部完成** |
