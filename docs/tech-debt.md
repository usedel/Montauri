# 技术债登记

> 记录已识别但暂缓处理的技术债。每条含：起因、根因、建议方案、处理时机、涉及文件。
> 处理完成后请移除对应条目或移入「已归档」。

## 待处理

> 2026-08-28 全项目代码检查新增。按严重度排序，处理时机均为「可作为独立 PR，任一项前先跑对应测试矩阵」。

### 1. intel 补全/跳转/hover/type_infer 全量线性扫描（P2，性能）
- **根因**：`completion.rs` / `type_infer.rs` / `definition.rs` / `hover.rs` 反复 `functions().iter().filter()`，且每 qualname `split('.')` 分配；10 万函数规模每次交互 O(n)。
- **建议**：为 qualname 末段 / 类型标签建反向索引（HashMap<&str, Vec<fid>>），文件名/qualname 做字符串驻留；`ensure_index_loaded` 加 in-flight 去重防并发重复加载。
- **涉及**：`intel/crates/opencharm-intel/src/{completion,definition,hover,type_infer,server}.rs`、`opencharm-intel-index/src/trace.rs`

### 2. intel server.rs 锁 poison 与 async 持锁（P2）
- **根因**：`server.rs` 16 处 `RwLock.lock().unwrap()`，一处 panic 则连锁；且 async 上下文直接持同步锁。
- **建议**：改 `unpoison` 模式；持锁临界区尽量不跨 `await`。
- **涉及**：`intel/crates/opencharm-intel/src/server.rs`

### 3. intel did_change 依赖全量同步契约（P2）
- **根因**：`did_change` 只取最后一个 `contentChange` 全量替换文本；作为独立 LSP 收到增量事件会永久损坏文档。
- **建议**：`textDocumentSync` 显式声明全量（`TextDocumentSyncKind::FULL`）或实现增量 range 合并。
- **涉及**：`intel/crates/opencharm-intel/src/server.rs`

### 4. 跨包项目哈希大小写不一致（P2，正确性）
- **根因**：`project_hash` 两处（`file_ops.rs` / `store.py`）只 `normpath` 未 `normcase`；Windows 同目录大小写不同会产生两个 trace 库，intel 读不到 probe 写的数据。
- **建议**：Windows 下统一 `to_lowercase()` 归一后再哈希；加跨进程约束测试。
- **涉及**：`shell/src-tauri/src/file_ops.rs`、`probe/src/opencharm_probe/store.py`

### 5. probe 打包/注入健壮性（P2）
- **根因**：wheel 只打包 `src/opencharm_probe`，漏 `sitecustomize.py` → pip 安装后 inject/check 失效；`runner.py` `mon.start()` 失败不恢复 `sys.argv`/`cwd`/`sys.path`；`autostart.py` argv[0] 守卫大小写敏感。
- **建议**：hatch 打包纳入顶层 `sitecustomize.py`；`run_with_probe` 把状态恢复包进 `try/finally`；argv 比对用 `os.path.normcase`。
- **涉及**：`probe/pyproject.toml`、`probe/src/opencharm_probe/{runner,autostart}.py`

### 6. 前端鲁棒性与设置单点（P3）
- **根因**：`client.ts` `fileUriToPath`/`pathToFileUri` 仅 Windows 语义，`decodeURIComponent` 非法 `%` 未捕获；settings 默认值三处同步（Rust `default_keybindings` / `state.ts` `DEFAULT_SETTINGS` / `keybindings.ts` `META`）依赖测试锁易漂移。
- **建议**：URI 编解码做跨平台 + 异常兜底；设置默认值收敛为单一来源。
- **涉及**：`shell/src/lsp/client.ts`、`shell/src/state.ts`、`shell/src/keybindings.ts`、`shell/src-tauri/src/settings.rs`

### 7. CI 自动化缺失（P1，工程）
- **根因**：README 自述「升级回归 CI 自动化待建」，`build-release.ps1` 为手动脚本，「CI 全绿才可合并」未落地。
- **建议**：接入一次性 CI 跑 4 个测试矩阵（前端 vitest / LSP 桥 cargo test / probe pytest / intel cargo test）+ bench 回归 + 打包烟测；把内存/冷启动红线纳入断言。
- **涉及**：新增 CI 配置、`ci/`、`bench/`

## 已归档

### TD-009 全项目代码检查与修复（P0/P1 项）—— 2026-08-28 完成

全面检查 probe / intel / shell 后落地以下修复（验证：probe 61 例、intel 38 例、shell/src-tauri 45 例全绿；`cargo check` 无告警）：

1. **probe `monitor._active` 计数泄漏（P0）**：异常退出（`RAISE` 沿传播链每帧触发、无法在回调区分销毁/继续）、静音清局部事件、未耗尽生成器都会让 `_active` 只增不减 → 发现窗口永不关闭、全局 `PY_START` 常开。修复：`_maybe_close_window` 达关窗决策点时用新增 `_sync_active()` 从调用栈重算校准；日常派发保持 O(1) 不做回溯。回归测试 `test_active_reconcile_after_exception_leak`。
2. **probe `_elem_shape` 大容器无采样上限（P0）**：新增 `_MAX_SHAPE_ELEMS = 64`，超大 list-of-dict 不全量遍历。回归测试 `test_shape_elem_sample_cap`。
3. **intel tuple type_label 契约（P1）**：`Tuple(Vec)` 按 `,` 切分与 probe 实际 `|` 联合分隔不符 → 改 `Tuple(Box<TypeLabel>)`，与 list/set/frozenset 同语义。
4. **intel shape `{"e":...}` 歧义（P1）**：顶层 list 与「仅有 `e` 键的 dict」序列化同形；`parse_shape` 增加 `type_label` 提示，序列类型解读为 list、dict 类型解读为单键 dict。回归测试 `shape_e_key_disambiguated_by_type_label`。
5. **probe SQLite（P2）**：新增 `_set_pragmas`（WAL + `busy_timeout` + `synchronous=NORMAL`，只读连接仅 busy_timeout）；`save()` 用 `RETURNING fid` 省 N 次 SELECT；`_mark_stale` 批量 UPDATE；`load_summary` 用主查询 fid 走主键索引去 N+1 三级间接。
6. **shell 安全（P1）**：`tauri.conf.json` 补严格 CSP；删除误提交的根目录 `json` 残留文件。
7. **进程树终止（P2）**：新增 `util::kill_process_tree`（Windows `taskkill /T /F`），替换 `lsp_start`/`lsp_stop`/`stop_script`/`run_with_timeout`/`run_uv_streaming` 的裸 `child.kill()`，`uv run`/shell 孙进程不再孤儿。
8. **LSP 线程生命周期（P2）**：`LspInstance` 增加单调 `seq`，退出监视线程按 seq 锁定监视对象，同名重启后旧线程立即退出，消除重复 `lsp-exit` 与线程累积。
9. **git 网络超时（P2）**：新增 `exec_git_timeout`（120s，spawn+轮询+超时杀树），`git_push`/`git_pull`/`git_fetch` 改走带超时路径，不再无限占用 `spawn_blocking` 线程池。
10. **DRY/unwrap 收尾（P3，补完 TD-003/005 遗漏）**：`git_cmds`/`git_status`/`fs_cmds` 删除本地 `no_window` 改 import `util`；`fs_cmds` 内联 `opencharm_home` 六处收敛；`fs_cmds`/`env_cmds` 剩余 `serde_json::to_string(...).unwrap()` 改 `map_err`；`terminal`/`watcher` `lock().unwrap()` 改 `unpoison`。
11. **Cargo.lock 纳入版本锁定**：从根 `.gitignore` 与 `intel/.gitignore` 移除 `Cargo.lock`，可复现构建。

### 涉及文件
- `probe/src/opencharm_probe/{monitor,compact,store}.py`、`probe/tests/{test_monitor,test_compact}.py`
- `intel/crates/opencharm-intel-index/src/type_label.rs`、`intel/crates/opencharm-intel/src/type_infer.rs`
- `shell/src-tauri/src/{util,lsp,env_cmds,git_cmds,git_status,fs_cmds,terminal,watcher}.rs`、`shell/src-tauri/tauri.conf.json`
- `.gitignore`、`intel/.gitignore`、规则文件（rust/python code-style）

### TD-008 确认弹窗统一为自绘风格 —— 2026-08-28 完成

按建议方案落地：新增统一自绘消息框组件，替换全部浏览器/系统原生消息对话框（`window.confirm` / `window.alert` 与 `@tauri-apps/plugin-dialog` 的 `confirm`）：

1. **统一组件**：新增 `shell/src/dialog.ts`，复用 `#confirm-modal`（遮罩 + `showEl`/`hideEl` 两阶段动画 + 品牌按钮），暴露 `openConfirm` / `openAlert`；`kind` 控制确定按钮 `danger`/`primary` 样式，`title` 缺省时隐藏标题行（兼容删除场景无标题）。
2. **替换 8 处确认**：`main.ts` 内 4 处裸 `window.confirm`（`teardownCurrent`/`closeTabsQuiet`/`closeTab`/`maybePromptVenv`）与 4 处 plugin-dialog `confirmDialog`（卸载/升级/安装包、运行前依赖预检）全部改用 `openConfirm`；破坏性操作 → `danger`，安装/设置 → `primary`。
3. **替换 1 处 alert**：`settingsPanel.ts` 快捷键校验错误由 `alert` 改 `openAlert`。
4. **同步函数异步化**：`closeTab`/`closeTabsQuiet`/`closeOthersExcept`/`closeTabsRightOf`/`closeAllTabs` 转 `async`；调用方（标签右键菜单、标签关闭按钮）改 `void` 调用。
5. **死元素清理**：删除 `index.html` 中从未接线的 `#prompt-modal`，同步移除 `fileTree.ts` `anyModalOpen` 中的 `"prompt-modal"` 引用。
6. **规范固化**：前端规范新增「消息对话框约定」，禁止使用任何浏览器/系统原生消息框。

`tsc --noEmit` / vitest（117 例）/ `vite build` 全绿。

### 涉及文件
- `shell/src/dialog.ts`（新增）
- `shell/src/main.ts` / `fileTree.ts` / `settingsPanel.ts`
- `shell/index.html`
- `.codebuddy/rules/typescript-code-style/RULE.mdc`

### TD-007 main.ts 功能域级拆分（文件树 / Git / 终端 / 设置面板）—— 2026-08-25 完成

按建议方案落地：先抽 AppState 上下文对象收敛共享状态，再按「文件树 → Git → 终端 → 设置面板」顺序逐域迁出，`tsc --noEmit` / vitest（73 例）/ `vite build` 全绿：

1. **AppState 上下文对象**：新增 `shell/src/state.ts`，收敛跨域共享状态（`monaco` / `editor` / `workspaceRoot` / `tabs` / `activeTab` / `pendingChanges` / `settings`）与 `$` / `$btn`、跨域 DOM 引用；域内私有状态（树选中集、Git 状态缓存、终端会话等）留在各域模块。
2. **文件树域** `fileTree.ts`：树渲染 / 展开折叠 / 多选 / 右键菜单 / 文件操作 / 过滤 / 键盘导航 / 输入模态；`wireFileTree()` 接管工具栏与过滤接线，`resetTreeState()` / `isDirExpanded()` / `isTreeEmpty()` 供 main 复位与查询。
3. **Git 域** `git.ts`：状态缓存 / SCM 面板 / 暂存提交 / diff 视图 / 远程与 stash / 历史与 blame / 分支面板；`wireGitUI()` 接管 SCM 事件接线，`resetGitState()` 供关闭工作区复位，`isGitRepoActive()` / `gitStatusOf()` / `isGitDirtyDir()` 供文件树装饰读取。
4. **终端域** `termUi.ts`：多会话终端 + 底部面板标签切换（输出 / 终端 / 差异）；`wireBottomPanel()` / `wireTerminalEvents()` / `disposeTerminal()` / `openTerminalAt()`。
5. **设置面板域** `settingsPanel.ts`：设置加载/保存 + 面板 UI + intel 开关；`wireSettingsPanel()`。
6. **main.ts 由约 3119 行降至约 1196 行**：仅保留工作区生命周期、标签/编辑器、运行、LSP 接线、环境面板、搜索/大纲、菜单栏、新建项目、文件监听胶水与 init。

### 涉及文件
- `shell/src/state.ts` / `fileTree.ts` / `git.ts` / `termUi.ts` / `settingsPanel.ts`（均新增）
- `shell/src/main.ts`

### TD-001 侧栏视图独立化（视图注册表 + 单根容器 / Activity Bar）—— 2026-08-25 完成

步骤 1（治本）与步骤 2（Activity Bar）+ 附带考虑（OUTLINE 并入文件视图）已全部落地：

1. **视图注册表 + 单根容器**：`shell/src/views.ts` 提供 `registerSidebarView` / `setSidebarTab` / `activeView`，切换遍历注册表「隐藏所有根、只显示激活根」，并支持 `onShow/onHide` 钩子（搜索视图显示聚焦输入框、隐藏时经 `cancelSearch()` 作废在途请求）。
2. **Activity Bar**：侧栏由横向 `#sidebar-tabs` 改为竖排图标栏（资源管理器 / 搜索 / 源代码管理）+ 单一视图容器 `#view-container`，对齐 VSCode 交互。
3. **OUTLINE 并入文件视图**：大纲由独立视图改为文件视图底部可折叠区块（`#outline-section` + `#outline-header`），顶级入口只留 文件 / 搜索 / Git；大纲刷新改随文件视图激活、文件切换与编辑防抖触发。

### 涉及文件
- `shell/src/views.ts`（`SidebarViewId` 移除 outline）
- `shell/index.html`（Activity Bar + `#view-container` + OUTLINE 并入 `#view-files`）
- `shell/src/style.css`（Activity Bar / 视图容器 / outline 区块样式）
- `shell/src/main.ts`（注册表 / Activity Bar 事件 / 大纲折叠 / 刷新判定）

### TD-002 Git 集成增强（行内 diff / 远程操作 / 状态刷新性能）—— 2026-08-25 完成

三项待办已全部落地：

1. **行内 diff 视图**：新增 `git_diff_versions`（返回 HEAD / Index / 工作区左右对照内容），前端底部新增「差异」tab，用 Monaco `createDiffEditor` 实现只读 side-by-side 左右对照；SCM 条目点击由输出面板改为打开 diff 视图。
2. **远程操作 + stash / log / blame**：新增 `git_push` / `git_pull` / `git_fetch` / `git_stash_push` / `git_stash_pop` / `git_stash_list` / `git_log` / `git_blame` / `git_show` 命令；SCM 面板顶部新增工具栏（Fetch / Pull / Push / Stash / 历史），历史面板展示最近提交并可点开提交详情（`git show`），diff 视图提供逐行 Blame 入口（输出面板表格展示）。
3. **性能优化**：`git_status` 后端支持可选 `paths` 子集查询；前端文件监听 `handleFsChanged` 将变更目录转相对路径做增量刷新，仅重查受影响目录，避免大仓库全量 `git status`。

### 涉及文件
- `shell/src-tauri/src/git_cmds.rs`（新增 9 个命令 + `parse_blame`）
- `shell/src-tauri/src/git_status.rs`（`git_status` 增量 paths 参数）
- `shell/src-tauri/src/lib.rs`（命令注册）
- `shell/src/main.ts`（diff 视图 / SCM 工具栏 / 历史与 Blame / 增量刷新）
- `shell/index.html`（差异 tab / diff 面板 / SCM 工具栏 / 历史容器）
- `shell/src/style.css`（diff 面板 / 工具栏 / 历史样式）

### TD-003 Rust 侧重复实现收敛（opencharm_home / no_window）—— 2026-08-25 完成

`opencharm_home()`（`~/.opencharm` 用户目录定位）与 `no_window()`（Windows `CREATE_NO_WINDOW` 无窗口子进程）在 `file_ops` / `env_cmds` / `lsp` / `settings` 四处各写一份，DRY 违背、改一处漏三处。

- 新增 `shell/src-tauri/src/util.rs` 统一实现并暴露 `opencharm_home()` / `no_window()`；四处改为 import 复用。

### 涉及文件
- `shell/src-tauri/src/util.rs`（新增）
- `shell/src-tauri/src/file_ops.rs` / `env_cmds.rs` / `lsp.rs` / `settings.rs` / `lib.rs`

### TD-004 intel 能力声明与索引加载修正 —— 2026-08-25 完成

1. `server.rs` 声明 `references_provider = true` 但 `Backend` 未实现 references（客户端调用永远返回空）→ 删除声明，诚实声明能力；
2. `ensure_index_loaded` 在 async 上下文同步打开 SQLite（阻塞 tokio 事件循环）→ 改 `async fn` + `tokio::task::spawn_blocking` 加载；
3. `tokio = { features = ["full"] }` 引入过重依赖 → 精简为 `rt-multi-thread` / `macros` / `io-std`。

### 涉及文件
- `intel/crates/opencharm-intel/src/server.rs`
- `intel/crates/opencharm-intel/Cargo.toml`

### TD-005 panic unwrap 与进程收尾收敛 —— 2026-08-25 完成

1. `file_ops::add_recent` 的 `serde_json::to_string(...).unwrap()` 失败即 panic → 改 `map_err` 返回错误；
2. `LSP` / `RUN_CHILD` 跨线程锁 `.lock().unwrap()` 污染后连锁 panic → 新增 `util::unpoison`（`unwrap_or_else(|p| p.into_inner())`）统一替换；
3. `lsp_start` / `lsp_stop` / `stop_script` 杀旧进程未 `wait`（zombie）→ 各处 kill 后补 `wait` 收尾。

### 涉及文件
- `shell/src-tauri/src/util.rs` / `file_ops.rs` / `lsp.rs`

### TD-006 上帝文件 main.ts 拆分（第一步）+ LSP/终端补单测 —— 2026-08-25 完成

`main.ts` 曾达 3236 行约 150 函数，文件树 / Git / 终端 / 设置 / 菜单全部堆砌；前端核心逻辑（除 live-templates 外）零单测；`lsp.rs` 帧解析、`terminal.rs` shell/venv 检测无单测。

- **拆分第一步**：抽 `basename` / `languageOf` / `fileIcon` / `joinPath` / `parentDirOf` / `relativePath` / `gitStatusLabel` / `gitBadgeClass` / `gitLineClass` / `symbolIcon` 共 10 个无状态纯函数到 `shell/src/util.ts`（`main.ts` 降至约 3119 行）。
- **补单测**：`read_frame` 帧解析 3 例 + `shell_candidates` / `venv_root_of` 4 例，共 7 个。
- **剩余**：功能域级拆分（文件树 / Git / 终端 / 设置面板）见 TD-007。

### 涉及文件
- `shell/src/util.ts`（新增）
- `shell/src/main.ts`、`shell/src-tauri/src/lsp.rs` / `terminal.rs`
