# 技术债登记

> 记录已识别但暂缓处理的技术债。每条含：起因、根因、建议方案、处理时机、涉及文件。
> 处理完成后请移除对应条目或移入「已归档」。

## 待处理

> 2026-08-28 全项目代码检查新增。按严重度排序，处理时机均为「可作为独立 PR，任一项前先跑对应测试矩阵」。

> 2026-09-09「运行体验对齐 PyCharm」（P0–P3 + stdin S1–S4）交付时新增。均为**可接受的小债**，非缺陷。
> 第 8 条（S3+S4 公共前置）已随 S3/S4 交付偿还，移入「已归档」；第 5 条已于 2026-09-10 随 CR-19 偿还并归档（此前在待处理区重复登记，2026-09-13 复核移除）。下方编号保持原样（TD-9~TD-12）。

> 2026-09-13 PyCharm 调研报告落地复核（`pycharm_feature_research_report.md`）发现。均为「已宣称交付、实际未达对标效果」的缺口，经裁决**暂缓处理**。

> 2026-09-15 运行功能迁移收尾 + UI 细节改进（`python_run_migration_plan.md`）引出。均为「一致性 / 体验」债，非缺陷，全局落地时作为独立 PR。

### TD-021 推送前复核遗留的低优先项（P4，5 小项；2026-09-25 全量复核引出）

- **起因**：P0~P4 六个未推送提交推送前全量复核（子代理深审 + 人工求证）。两个中等问题（终端背压队列无上限、stop/exit 提示时序）与三个低级项（session 静默失败、异常断点失败不回滚、Watches 满额静默/无令牌、resourcePanel 死代码）已随当次修复提交偿还；以下 5 小项经裁决**暂缓**。
- **① terminal.ts 背压「字节预算」实为 UTF-16 字符数**：`pendingBytes += data.length`，CJK 输出下真实 UTF-8 字节约为 3 倍，256KB/4MB 阈值在中文场景放宽 ~3 倍。无功能错误，仅削峰粒度。修法：`Buffer.byteLength(data, "utf8")` 口径（需逐块缓存字节长度或改存 Uint8Array）。
- **② session.ts `restoring` 是布尔非令牌**：恢复 A 进行中切到工作区 B，A 的 `finally restoring=false` 会提前解锁，B 半恢复状态可能被防抖快照写回。场景罕见。修法：改为计数器/令牌。
- **③ sessions.rs 快照超 40 tab 保头弃尾**：`truncate(MAX_TABS)` 丢的是最近打开的 tab，与「恢复最近现场」直觉相反。修法：保尾（`tabs.slice(-MAX_TABS)`）并同步活动 tab 判定。
- **④ proc_stats 只统计直接子进程**：运行链存在中间层（cmd /c、shell 包装）时孙进程内存不计入合计，芯片口径偏小。修法：递归遍历进程树（注意 sysinfo 环处理）。
- **⑤ debugWatches.ts 顶层 `load()` 读 localStorage**：顶层副作用（有 try/catch 兜底）。修法：改惰性初始化。
- **处理时机**：各自独立成 PR，任一项先跑对应测试矩阵（terminal → perf/01；session → session/01；debug → debug specs + 真机）。
- **涉及文件**：`shell/src/terminal.ts`、`shell/src/session.ts`、`shell/src-tauri/src/sessions.rs`、`shell/src-tauri/src/proc_stats.rs`、`shell/src/debugWatches.ts`。

### TD-020 停止运行时 `[opencharm-probe]` 摘要日志重复打印（P3，观感/数据卫生）

- **起因**：停止运行（脚本/项目）时，终端里的 `[opencharm-probe] ✓ …` 摘要日志偶发重复打印。
- **根因（初步定位，待 Python 3.12+ 环境复现确认）**：探针经 `sitecustomize` + `atexit._finalize` 在进程退出时打印一次摘要；运行注入的 `OPENCHARM_PROBE_*` 环境变量会被子进程继承，若同一次运行下存在多个通过 `argv[0]` 守卫的进程（如 uvicorn `--reload` 在 POSIX 用 `fork`、子进程 argv 与父进程相同；或脚本内部以相同 argv 的 `subprocess` 重启自身），多个进程各自触发 `_finalize` → 重复打印/重复落库。现有 `argv[0]` 守卫仅能拦截 `multiprocessing spawn`（Windows，sitecustomize 期 argv[0]='-c'，2026-09-15 已用最小实验验证），拦不住 argv 相同的父子进程。
- **建议方案**：后端 `run_in_terminal` 注入「每次运行唯一」的 `OPENCHARM_PROBE_RUN_ID`（父子共享、不同次运行不同）；探针 `autostart._finalize` 用纯标准库跨进程原子锁（`os.open(O_CREAT|O_EXCL)` 墓碑文件）保证同一 run_id 只落库+打印一次；锁文件按 mtime 惰性清理。
- **处理时机**：可作为独立 PR；需先在有 Python 3.12+ 的运行环境复现确认根因后落地。
- **涉及文件**：`shell/src-tauri/src/run_env.rs`（或 `terminal.rs`）、`probe/src/opencharm_probe/autostart.py`。

## 已归档

> 处理完成的历史条目，仅保留标题与结论摘要；编号对应原 TD 编号。完整实施细节见对应 commit 历史。
> 2026-09-10：代码审查整改计划（`code_review_remediation_plan.md`，CR-01~CR-30 共 30 项）已全部完成并删除，其中与本表重叠的条目见上；其遗留的可选优化项（第 13/14 条）已于 2026-09-13 全部偿还并归档。

| 编号 | 标题 | 完成日期 | 结论摘要 |
|---|---|---|---|
| 12 | pyproject.toml 两条生成路径包名归一化（P4，观感） | 2026-09-15 | 收敛：`fs_cmds.rs` 新增 `normalize_project_name`（字符串行扫描，定位 `[project].name` 改写为 `sanitize_pkg_name` 结果，不引入 TOML 依赖）+ `is_name_field` 防误配同前缀键；`ensure_pyproject` uv 生成后调用；`test_normalize_project_name` 覆盖大小写/空格与 `[tool.uv]` 段不误改 |
| 17 | 全项目输入框未统一 autocomplete="off"（P4，一致性） | 2026-09-15 | `index.html` 10 处 `type=text` 输入框补 `autocomplete="off"`（tree-filter/search/env-pkg/new-project-*/settings-*/lt-search/storage-migrate-path/palette-search）；动态输入补 `settingsPanel.ts` 键位行 / `git.ts` 新分支 / `fileTree.ts` 内联重命名 / `manager.ts` 两处 text input |
| 18 | 模态点遮罩关闭不一致（P4，一致性/数据安全） | 2026-09-15 | 含可编辑内容的模态统一「点遮罩不关闭 + Esc 关闭」：`dialog.ts::openPrompt`、`settingsPanel.ts`、`newProject.ts` 三处去遮罩关闭、补 document 级 keydown（open 挂/close 移除，对齐 runConfigPanel 范式）；其余选择/确认框点遮罩=取消语义保留 |
| 19 | 操作结果反馈散用输出面板（P4，一致性） | 2026-09-15 | 消除静默失败：`settingsPanel`（intel 开关/打开日志/数据目录）、`envPanel`（设置解释器×3）、`git`（空分支名校验）、`storagePanel`（首启标记/打开目录/选目录）共 10 处 `console.*` 静默改为 `toastFail`；`saveSettingsPanel` 成功补 `toast`；输出面板保留作命令级审计 |
| 6 | 前端鲁棒性与设置单点（P3） | 2026-09-15 | ① URI 编解码跨平台 + 异常兜底：`client.ts` `fileUriToPath` 加 decodeURIComponent try/catch + 盘符检测定反斜杠、`pathToFileUri` 先转义 `%`/`#`/`?`；② 设置默认值收敛：新增零依赖 `keybindingDefaults.ts` 单一来源，`keybindings.ts` 与 `state.ts::DEFAULT_SETTINGS` 改为派生（`defaultKeybindings()`），前端两处不再手写 |
| 9 | 运行配置孤儿条目（P3，存储卫生） | 2026-09-15 | 新增 `sweep_run_configs` 命令 + `sweep_run_configs_impl`（键对应文件不存在即移除）；`set_run_config` 保存时顺带清扫，`main.ts::openWorkspace` 打开工作区时调用一次；lib.rs 注册 |
| 11 | interpreter_version 未缓存（P3，性能） | 2026-09-15 | `env_cmds.rs` 加 `VERSION_CACHE`（`LazyLock<Mutex<HashMap<String,String>>>`，路径为键），`interpreter_version` 命中缓存直接返回、空串不缓存；换解释器自然失效 |
| 16 | E4 Docstring 自动生成缺口（P3，对标缺口） | 2026-09-15 | 新增 `docstring.ts`：`registerDocstringTrigger` 监听 python `"""`+Enter，`enclosingSignature`（单行 def/class 签名，过滤 self/cls、去注解/默认值/变参、顶层逗号分割）+ `buildDocstring`（Args/Returns 或 Attributes），接入 `index.ts`；`docstring.test.ts` 7 例全绿 |
| 4 | 跨包项目哈希大小写不一致（P2，正确性） | 2026-09-15 | 两端大小写归一：`store.py::project_hash` 加 `os.path.normcase`、`file_ops.rs::project_hash` Windows 下 `to_lowercase()`（strip_verbatim_prefix 之后）；`test_store.py` 增 `test_project_hash_case_insensitive`（test_store 5 例全绿）、`file_ops.rs` 增大小写变体断言（cargo test project_hash 2 例全绿） |
| 7 | CI 自动化缺失（P1，工程） | 2026-09-15 | 新增 `.github/workflows/ci.yml`：test job（windows-latest）跑 4 矩阵（前端 vitest+tsc / probe pytest / intel cargo test / shell cargo test），package-smoke job（打包 NSIS + bench 红线，workflow_dispatch 手动）；`bench/collect-metrics.ps1` 末尾把冷启动/内存红线纳入非零退出断言 |
| 15 | 位置轴块头冒号误判续行（P2，正确性） | 2026-09-15 | `scope.ts` 从 `CONT_SUFFIX_RE` 移除 `:`，新增 `isBlockHeaderColon`（单行块头 + 跨行签名 `):`/`]:`）区分块头/续行冒号；`scope.test.ts` 增 4 例（块头后首行 / 跨行签名 / 空行 / 字典值冒号）并同步修订稿 §1.1/§8.2；vitest 11 例全绿 |
| 10 | stdin 重定向文件存绝对路径（P3，可移植性） | 2026-09-15 | 随 v3.4 运行迁移删除 stdin 配置体系（`StdinConfig` / `run_script` 删净），该债连同功能一并消除 |
| 1 | intel 补全/跳转/hover/type_infer 全量线性扫描（P2，性能） | 2026-09-10 | 已并入 CR-17 实施：索引层预建 `by_last_segment` / `by_second_last_segment` / `by_type_label` 倒排，7 处消费端全量扫描改索引查询 + shape 解析请求级缓存；intel `cargo test` 44 例全绿（含准确率红线） |
| 2 | intel server.rs 锁 poison 与 async 持锁（P2） | 2026-09-10 | 已并入 CR-18 实施：改 `parking_lot::RwLock`（无中毒）+ `Arc` 快照锁外重计算 + 补全/hover/definition/inlay/诊断全部 `spawn_blocking` |
| 5 | probe 打包/注入健壮性（P2） | 2026-09-10 | 已并入 CR-19 实施：hatch `force-include` 打包 `sitecustomize.py`（wheel 验证）；`mon.start()` 纳入 try/finally 恢复现场；argv[0] 守卫 `normcase` 归一化；probe `pytest` 63 例全绿 |
| 3 | intel did_change 依赖全量同步契约（P2） | 2026-09-09 | 已并入 CR-02 实施：`ServerCapabilities` 显式声明 `TextDocumentSyncKind::FULL`，intel `cargo test` 全绿 |
| 14 | main.ts 运行态收敛为 RunState 与按域拆分（P3，质量） | 2026-09-13 | ① 运行态 6 变量（running/runningPath/runChannel/runningStdinMode/runningStdinEofHinted/selectionRunMeta）+ runningProfile 收敛为 `runState.ts` 的 `RunState` 判别联合（零依赖 + accessors，整组置位/整组作废，杜绝半复位态）；② 按域拆出 `runFlow.ts`（运行核心 ~1030 行）/ `envPanel.ts`（621）/ `runConfigPanel.ts`（351）/ `menuBar.ts`（286）/ `newProject.ts`（223）/ `tracebackLink.ts`（37），main.ts 由 ~3169 降至 1620 行；解环用 handler 注入（`setRunFlowHandlers` / `initEnvPanel{restartEngine}` / `wireNewProject` / `wireMenuBar(getMenuItems)` / `setTracebackOpenFile`），顺带解除 TD-13 的 `git.ts → main.ts` 边。基线：tsc 0 错、vitest 287 passed（新增 `runState` 13 例） |
| 13 | 前端剩余循环 import 边（P3，架构，源自 CR-25 余量） | 2026-09-13 | 沿 handler 注入先例解尽剩余两条边：`fileTree.ts`（`openFile` / `renderTabs` / `closeTabSilent` / `insertHeaderTemplate`）与 `settingsPanel.ts`（`startLsp`）改经 `setFileTreeHandlers` / `setSettingsPanelHandlers` 注入，`shell/src` 下已无 `from "./main"` 反向 import（fileTree 的 `Tab` 类型改从零依赖 `state.ts` 取）；接线统一置于 main `init` 首部（与 TD-14 注入同处）。基线：tsc 0 错、vitest 287 passed |
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