# 技术债登记

> 记录已识别但暂缓处理的技术债。每条含：起因、根因、建议方案、处理时机、涉及文件。
> 处理完成后请移除对应条目或移入「已归档」。

## 待处理

> 2026-08-28 全项目代码检查新增。按严重度排序，处理时机均为「可作为独立 PR，任一项前先跑对应测试矩阵」。

### 4. 跨包项目哈希大小写不一致（P2，正确性）
- **根因**：`project_hash` 两处（`file_ops.rs` / `store.py`）只 `normpath` 未 `normcase`；Windows 同目录大小写不同会产生两个 trace 库，intel 读不到 probe 写的数据。
- **建议**：Windows 下统一 `to_lowercase()` 归一后再哈希；加跨进程约束测试。
- **涉及**：`shell/src-tauri/src/file_ops.rs`、`probe/src/opencharm_probe/store.py`

### 6. 前端鲁棒性与设置单点（P3）
- **根因**：`client.ts` `fileUriToPath`/`pathToFileUri` 仅 Windows 语义，`decodeURIComponent` 非法 `%` 未捕获；settings 默认值三处同步（Rust `default_keybindings` / `state.ts` `DEFAULT_SETTINGS` / `keybindings.ts` `META`）依赖测试锁易漂移。
- **建议**：URI 编解码做跨平台 + 异常兜底；设置默认值收敛为单一来源。
- **涉及**：`shell/src/lsp/client.ts`、`shell/src/state.ts`、`shell/src/keybindings.ts`、`shell/src-tauri/src/settings.rs`

### 7. CI 自动化缺失（P1，工程）
- **根因**：README 自述「升级回归 CI 自动化待建」，`build-release.ps1` 为手动脚本，「CI 全绿才可合并」未落地。
- **建议**：接入一次性 CI 跑 4 个测试矩阵（前端 vitest / LSP 桥 cargo test / probe pytest / intel cargo test）+ bench 回归 + 打包烟测；把内存/冷启动红线纳入断言。
- **涉及**：新增 CI 配置、`ci/`、`bench/`

> 2026-09-09「运行体验对齐 PyCharm」（P0–P3 + stdin S1–S4）交付时新增。均为**可接受的小债**，非缺陷。
> 第 8 条（S3+S4 公共前置）已随 S3/S4 交付偿还，移入「已归档」；第 5 条已于 2026-09-10 随 CR-19 偿还并归档（此前在待处理区重复登记，2026-09-13 复核移除）。下方编号保持原样（TD-9~TD-12）。

### 9. 运行配置孤儿条目（P3，存储卫生）
- **根因**：`run_configs` 以「相对工作区根、正斜杠规范化」的脚本路径为键；脚本重命名/移动/删除后旧键残留，无清理机制，配置文件只增不减。
- **建议**：打开工作区或保存配置时做一次存在性清扫（键对应文件不存在即移除）；或提供设置面板「清理无效运行配置」入口（可复用 `storage-uv-prune` 的交互样式）。
- **涉及**：`shell/src-tauri/src/env_cmds.rs`（`run_config_key` / `set_run_config`）

### 10. stdin 重定向文件存绝对路径（P3，可移植性）
- **根因**：`StdinConfig.path` 存绝对路径，工作区搬迁或换机即失效（表现为运行前 fail fast 报「标准输入文件无法打开」，可诊断但需手工重设）。
- **建议**：改为「优先按工作区相对路径解析，回退绝对路径」；保存时若文件在工作区根下则存相对路径。与第 9 条可合并为一次运行配置存储格式演进（需保留 `#[serde(default)]` 兼容存量）。
- **涉及**：`shell/src-tauri/src/env_cmds.rs`（`StdinConfig`）、`shell/src-tauri/src/lsp.rs`（`run_script` 打开文件处）

### 11. `interpreter_version` 未缓存（P3，性能）
- **根因**：`refreshInterpreterStatus` 每次都 spawn 一次 `<path> --version`（5s 超时）以渲染状态栏「来源 + 版本」；开工作区、换解释器、创建项目均会触发。非热路径，但属重复子进程。
- **建议**：按解释器路径做进程内缓存（`HashMap<String, String>`），解释器变更时失效；或并入 `list_pythons` 已有的 `version_of` 结果复用。
- **涉及**：`shell/src-tauri/src/env_cmds.rs`（`interpreter_version` / `version_of`）、`shell/src/main.ts`（`refreshInterpreterStatus`）

### 12. `pyproject.toml` 两条生成路径的包名归一化可能不同（P4，观感）
- **根因**：方案 A（`uv init --bare`）的 `[project].name` 取**目录名**并按 uv 自身规则归一化；方案 B（模板回退）走 `sanitize_pkg_name`。常规命名下二者一致，含特殊字符（空格/非 ASCII/首尾分隔符）时可能有差异。
- **建议**：低优先。若要收敛，可在 uv 生成后校验并按 `sanitize_pkg_name` 结果改写 `name`；或接受差异并在文档记录（当前状态）。
- **涉及**：`shell/src-tauri/src/fs_cmds.rs`（`ensure_pyproject` / `sanitize_pkg_name`）

> 2026-09-10 代码审查整改（CR-01~CR-30，原 `code_review_remediation_plan.md` 已完成并删除）遗留的可选优化项。

### 13. 前端剩余循环 import 边（P3，架构，源自 CR-25 余量）
- **现状**：CR-25 已完成 git 状态下沉（新建零依赖 `gitStatusState.ts`，切断 fileTree↔git 状态耦合）；TD-14 已把 `gotoFromLink` 迁至零业务依赖的 `tracebackLink.ts`（openFile 注入），**`git.ts → main.ts` 边随之解除**；剩余 `fileTree.ts → main.ts`（`openFile` / `renderTabs` / `closeTabSilent` / `insertHeaderTemplate`）、`settingsPanel.ts → main.ts`（`startLsp`）为**运行时函数引用**（无初始化期 TDZ 风险，当前可安全运行）。
- **建议**：后续按 `terminal.ts::setTerminalLinkHandler` 的 handler 注入先例逐边解环；不紧急。
- **涉及**：`shell/src/{fileTree,settingsPanel,main}.ts`

> 2026-09-13 PyCharm 调研报告落地复核（`pycharm_feature_research_report.md`）发现。均为「已宣称交付、实际未达对标效果」的缺口，经裁决**暂缓处理**。

### 15. 位置轴把块头冒号误判为续行，块体首行的语句位模板全部失效（P2，正确性）

- **根因**：`scope.ts::classifyPosition` 的续行启发把 `:` 列入 `CONT_SUFFIX_RE`（见 `docs/live_templates上下文轴修订稿.md` §8.2），而 `def f(...):` / `class X:` / `if ...:` 等块头正以 `:` 结尾 → 其后首行被判为 `expression`。于是 `doc`/`docf`/`docc` 以及**所有** `positions:["statement"]` 模板（`def`/`class`/`if`/`for`/`while`/`try`/`with`/`main`/`ifmain`…）在「任何块头后的第一个语句行」被 `findByAbbreviation`（Tab 路径）与 `templatesForContext`（补全弹窗路径）双双过滤掉，从第二行起才恢复。
- **复现**：临时单测对 `["def bar(self, x):", "    docf"]`、`["class Foo:", "    docc"]`、`["if x:", "    main"]` 及块体首行空行断言 `statement`，4/4 实得 `expression`（验证后已删除临时文件）。
- **建议**：区分「块头 `:`」与「续行 `:`」——识别 `(async )?def`/`class`/`if`/`elif`/`else`/`for`/`while`/`try`/`except`/`finally`/`with`/`match`/`case`（含多行签名的 `):`）为块头而非续行；最小改法是直接从 `CONT_SUFFIX_RE` 移除 `:`（代价：`d = {` 换行后 `'a':` 这种「冒号后换行的值」会误判为语句位，极罕见）。需补 `scope.test.ts` 用例并同步修订上下文轴修订稿 §1.1 / §8.2。
- **处理时机**：下次触碰 live templates 位置轴时独立 PR；改前先跑 `shell` vitest（含 `live-templates/__tests__/*`）。
- **涉及**：`shell/src/live-templates/scope.ts`、`shell/src/live-templates/__tests__/scope.test.ts`、`docs/live_templates上下文轴修订稿.md`

### 16. E4 Docstring 自动生成仅落地为 live template，缺 `"""`+Enter 自动生成（P3，对标缺口）

- **现状**：`builtin.doc` / `docf` / `docc` 三个模板已内置（`allowInStrings` 已修正），但需用户主动键入缩写 + Tab，或从补全弹窗选取；PyCharm 的「输入 `"""` 回车即按函数签名生成 Args/Returns 骨架」未实现，也无 Alt+Insert 类入口。故 `pycharm_feature_research_report.md` §3 原标 ✅ 属过誉。
- **建议**：监听 python 语言的 `"""` + Enter（onType / 命令入口），取 `documentSymbol` 或函数签名生成参数骨架，模板体可复用 `docf`；与第 15 条一并做更合适（否则模板仍触发不到）。
- **处理时机**：作为独立特性排期（需产品裁决是否对标 PyCharm 触发方式），非顺手可还。
- **涉及**：`shell/src/live-templates/builtin.ts`、`shell/src/live-templates/index.ts`、`shell/src/main.ts`

## 已归档

> 处理完成的历史条目，仅保留标题与结论摘要；编号对应原 TD 编号。完整实施细节见对应 commit 历史。
> 2026-09-10：代码审查整改计划（`code_review_remediation_plan.md`，CR-01~CR-30 共 30 项）已全部完成并删除，其中与本表重叠的条目见上；剩余可选项已登记为第 13/14 条。

| 编号 | 标题 | 完成日期 | 结论摘要 |
|---|---|---|---|
| 1 | intel 补全/跳转/hover/type_infer 全量线性扫描（P2，性能） | 2026-09-10 | 已并入 CR-17 实施：索引层预建 `by_last_segment` / `by_second_last_segment` / `by_type_label` 倒排，7 处消费端全量扫描改索引查询 + shape 解析请求级缓存；intel `cargo test` 44 例全绿（含准确率红线） |
| 2 | intel server.rs 锁 poison 与 async 持锁（P2） | 2026-09-10 | 已并入 CR-18 实施：改 `parking_lot::RwLock`（无中毒）+ `Arc` 快照锁外重计算 + 补全/hover/definition/inlay/诊断全部 `spawn_blocking` |
| 5 | probe 打包/注入健壮性（P2） | 2026-09-10 | 已并入 CR-19 实施：hatch `force-include` 打包 `sitecustomize.py`（wheel 验证）；`mon.start()` 纳入 try/finally 恢复现场；argv[0] 守卫 `normcase` 归一化；probe `pytest` 63 例全绿 |
| 3 | intel did_change 依赖全量同步契约（P2） | 2026-09-09 | 已并入 CR-02 实施：`ServerCapabilities` 显式声明 `TextDocumentSyncKind::FULL`，intel `cargo test` 全绿 |
| 14 | main.ts 运行态收敛为 RunState 与按域拆分（P3，质量） | 2026-09-13 | ① 运行态 6 变量（running/runningPath/runChannel/runningStdinMode/runningStdinEofHinted/selectionRunMeta）+ runningProfile 收敛为 `runState.ts` 的 `RunState` 判别联合（零依赖 + accessors，整组置位/整组作废，杜绝半复位态）；② 按域拆出 `runFlow.ts`（运行核心 ~1030 行）/ `envPanel.ts`（621）/ `runConfigPanel.ts`（351）/ `menuBar.ts`（286）/ `newProject.ts`（223）/ `tracebackLink.ts`（37），main.ts 由 ~3169 降至 1620 行；解环用 handler 注入（`setRunFlowHandlers` / `initEnvPanel{restartEngine}` / `wireNewProject` / `wireMenuBar(getMenuItems)` / `setTracebackOpenFile`），顺带解除 TD-13 的 `git.ts → main.ts` 边。基线：tsc 0 错、vitest 287 passed（新增 `runState` 13 例） |
| 8 | 终端与运行按钮的环境注入不一致（S3+S4 公共前置） | 2026-09-09 | 抽 `run_env.rs` 单一装配来源（`build_run_env` / `assemble` / `resolve_run_command`），`cargo test` 72 例全绿；两条运行路径 env 逐项同源 |
| TD-009 | 全项目代码检查与修复（P0/P1 项，共 11 项） | 2026-08-28 | probe/intel/shell 修复全绿；含 Cargo.lock 纳入版本锁定 |
| TD-008 | 确认弹窗统一为自绘风格 | 2026-08-28 | 新增 `dialog.ts`，替换 8 处 confirm + 1 处 alert |
| TD-007 | main.ts 功能域级拆分（文件树/Git/终端/设置面板） | 2026-08-25 | 抽 `state.ts` + 4 域模块，main.ts 由 ~3119 降至 ~1196 行 |
| TD-006 | 上帝文件 main.ts 拆分（第一步）+ LSP/终端补单测 | 2026-08-25 | 抽 10 个纯函数到 `util.ts` + 7 个单测 |
| TD-005 | panic unwrap 与进程收尾收敛 | 2026-08-25 | 新增 `unpoison` + kill 后 `wait` 收尾 |
| TD-004 | intel 能力声明与索引加载修正 | 2026-08-25 | 删除未实现的 references 声明 + 索引 `spawn_blocking` 加载 + tokio 精简 |
| TD-003 | Rust 侧重复实现收敛（opencharm_home / no_window） | 2026-08-25 | 抽 `util.rs` 统一实现，四处改 import 复用 |
| TD-002 | Git 集成增强（行内 diff / 远程 / 状态刷新性能） | 2026-08-25 | 新增 9 个命令 + diff 视图 + 增量刷新 |
| TD-001 | 侧栏视图独立化（视图注册表 + Activity Bar） | 2026-08-25 | 视图注册表 + Activity Bar + OUTLINE 并入文件视图 |