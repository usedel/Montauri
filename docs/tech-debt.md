# 技术债登记

> 记录已识别但暂缓处理的技术债。每条含：起因、根因、建议方案、处理时机、涉及文件。
> 处理完成后请移除对应条目或移入「已归档」。

## 待处理

> 2026-08-28 全项目代码检查新增。按严重度排序，处理时机均为「可作为独立 PR，任一项前先跑对应测试矩阵」。

> 2026-09-09「运行体验对齐 PyCharm」（P0–P3 + stdin S1–S4）交付时新增。均为**可接受的小债**，非缺陷。
> 第 8 条（S3+S4 公共前置）已随 S3/S4 交付偿还，移入「已归档」；第 5 条已于 2026-09-10 随 CR-19 偿还并归档（此前在待处理区重复登记，2026-09-13 复核移除）。下方编号保持原样（TD-9~TD-12）。

> 2026-09-13 PyCharm 调研报告落地复核（`pycharm_feature_research_report.md`）发现。均为「已宣称交付、实际未达对标效果」的缺口，经裁决**暂缓处理**。

> 2026-09-15 运行功能迁移收尾 + UI 细节改进（`python_run_migration_plan.md`）引出。均为「一致性 / 体验」债，非缺陷，全局落地时作为独立 PR。

> 2026-10-03 UI 视觉「高级感」改造（`docs/ui_premium_dev_plan.md` 六批 + 修记 A）交付后复核新增 **TD-022 / TD-023 / TD-024**。均为**自觉取舍或非缺陷的观感项**，交付时已在开发计划 §8.1.2 声明，本次复核补登记（此前只写在计划里，未进本文件）。

> 2026-10-05 产品定位变更（「单人自用」→「高性能 · 轻量」，ADR-0010）新增 **TD-025**：全项目 60+ 处决策曾以「单人自用」为论据，定位变更后这些论据**原则上已过期**。本轮按裁决**不逐个复审**，仅登记清单；读这些文档时须记住「论据过期 ≠ 结论错误」，画像类裁决仍然成立。

### TD-025 历史「单人自用」论据的定位失效复审清单（P2，文档一致性；2026-10-05 定位变更登记）

- **起因**：产品定位由「单人自用 Python IDE」变更为「高性能 · 轻量 Python IDE」（ADR-0010，目标用户画像**不变**：FastAPI + 爬虫 + 小脚本）。历史文档大量以「自用 / 单人 / 没人在乎跨机一致性」作为取舍论据，这些论据在对外定位下不再自明。
- **本轮裁决**：**不逐个复审、不批量替换表述**（工作量多日且多数结论仍成立）；只登记清单，由后续独立 PR 逐项处理。**结论仍成立的画像类裁决明确不复审**（见下「不复审」）。
- **复审清单**（按建议处理顺序）：

| # | 条目 | 原论据（已过期） | 失效原因 / 复审要点 | 涉及文件 |
|---|---|---|---|---|
| 1 | nightly 的 e2e-real / bench / budget 三个 job **只告警不阻断** | 「单人自用项目没人盯 CI 告警，价值在出报告而非卡合并」 | 定位对外后，告警无人看 = 护栏形同虚设；需决定：接通知渠道（Windows 通知/邮件）还是升级为 PR 阻断（ADR-0010 决策 5 已把后者延后） | `.github/workflows/nightly.yml`、`docs/improvement_and_roadmap_report.md` P0-1 子项 2 |
| 2 | **更新通道 / 版本回滚**延后 | 「自用项目也要面对『我这版是不是装错了』」 | 对外分发后更新与回滚从「锦上添花」升为分发链路一环；至少要有 `version.json` 比对提示 + 设置面板「检查更新」 | `docs/improvement_and_roadmap_report.md`（更新通道段）、`shell/src-tauri/Cargo.toml`（无 updater 依赖） |
| 3 | UI 字体 **Inter 走系统栈**、只随包等宽字体 | 「单人自用定位，跨机一致性收益为零」 + CSP 阻碍 | 跨机一致性不再天然无用；需重估是否值得改 CSP（`font-src`）把 Inter 随包 | `docs/ui_premium_design_report.md` §5.3 / §7、`docs/ui_premium_dev_plan.md` §2、`shell/src-tauri/tauri.conf.json`（CSP） |
| 4 | Watches / 低频配置存 **localStorage** | 「低频个人配置、无跨设备诉求，避免为 20 条字符串扩后端」 | 同上；若做配置同步才需动，否则维持现状即可 | `docs/pycharm_ux_review_and_proposal.md` §16.5、`shell/src/debugWatches.ts` |
| 5 | 插件 v2 **硬沙箱**（iframe/Worker）延后 | 「成本高、收益对自用场景有限」 | 面向外部插件作者时，信任模型（现为同源 + facade）重要性上升；工作区级插件目录可先行 | `docs/plugin_system_design.md` §10、`docs/improvement_and_roadmap_report.md` P1-6 |
| 6 | HTTP Client（工具箱）对内网地址**不拦截只提示** `private_target` | 「自用工具不拦，知情即可」 | 模板/配置可分享后，SSRF 需重新裁决是「提示」还是「默认拦 + 显式放行」 | `docs/toolbox_dev_plan.md`（HTTP Client 章） |

- **不复审（结论仍成立，仅论据措辞过期）**：S1 画像类打分（`docs/python_library_support_research.md` 的「单人自用脚本 / 小项目」画像）、框架支持裁决（`docs/pycharm_framework_support_report.md` 的 FastAPI 第一 / Flask 第二 / Django 浅做）、pytest 面板 / Jupyter 不做（`docs/python_ide_dev_plan_v2.md` §1.1）——**用户画像未变**，这些裁决的依据是画像而非「自用」二字。
- **处理时机**：各自独立成 PR；建议顺序 1 → 2 → 3 → 4 → 5 → 6（1/2 影响分发可信度，优先级最高）。任一项复审结论若要推翻原裁决，须先写 ADR 再改代码。
- **涉及文件**：见上表；本条本身登记于 `docs/tech-debt.md`。

### TD-024 alpha 边框不满足 WCAG 1.4.11 非文本对比 3:1（P4，合规取舍；2026-10-03 UI 高级感批 5b 登记）

- **起因**：批 5b 把边框换成三档 alpha 叠色（`--border-hairline` / `--border-subtle` / `--border-strong`），实测对比 1.32~1.36:1，**低于** WCAG 1.4.11 要求的 3:1。
- **根因**：这是**存量事实**（旧值 1.29~1.51 同样不达标），不是本批引入的回归；且 alpha 边框在原理上不可能达到 3:1——要达标就得把边框做成接近实色，那正是「精致」要去掉的东西。聚焦态的识别由 `border-color: var(--accent)`（青绿 4.98:1）承担，语义准确。
- **建议方案**：维持现状并在 `ui_premium_dev_plan.md §7.7.4` 保留登记；若将来要对外做无障碍合规声明，需单独评估（可能要为「高对比」另出一套实色边框主题）。
- **处理时机**：有合规诉求时；否则长期挂账。
- **涉及文件**：`shell/src/style.css`（`--border-*` 三档）、`tools/ui/audit_tokens.py`（阶梯轴/对比度判定）。

### ~~TD-023 `runWidget` 忙碌态切图标类导致按钮宽度变化~~ —— ✅ **已关闭（2026-10-04 实测：前提不成立）**

- **起因**：批 5c 统一圆角档位时**推断**——运行控件的忙碌态通过切换 codicon 图标类实现（▶ `codicon-run` → ⟳ `codicon-loading`），推断「两个字形宽度不同」会让按钮横向抖动。
- **实测结论（2026-10-04，浏览器探针）**：**前提不成立**。在 `.menubar-icon` 上下文里逐个量 14 个 codicon 字形（`run` / `run-all` / `loading` / `sync` / `refresh` / `debug-stop` / `tools` / `gear` / `debug` / `play` / `circle-filled` / `triangle-right` / `dashboard` / `check`），`#btn-run-script` 的 `getBoundingClientRect().width` **恒为 28px**；图标元素本身在 16px 字号下也**恒为 16px**。即 **@vscode/codicons 0.0.46-24 的字形推进宽度是统一的 1em**，换字形不改变布局。
- **过程中曾按旧推断落过一版修复**（`.menubar-icon .codicon { width: 1em }` + 单测 + e2e 宽度断言），**已全部回退**：那两条门禁在「有/无修复」下都通过（假绿），留着只会让人误以为已被覆盖——与 `ui_premium_dev_plan.md §7.7.1`（批 5b 推翻"重点提升"前提）是同一类教训：**先验证前提再动手**。
- **不做的事**：不为已统一推进宽度的字体加定宽槽位（纯噪声）；若将来换图标集 / 自定义字形（非 1em 推进），再按本节方法重测一次即可。
- **涉及文件**：无（无代码改动）；证据与结论登记在 `docs/ui_premium_dev_plan.md §6.5` 与 §8.1.2。

### TD-022 Monaco 浮层圆角无法跟随外壳 `--radius-*`（P4，一致性；2026-10-03 UI 高级感批 5c 登记）

- **起因**：批 5c 把外壳圆角档位统一到 3/6/8/10/16px（`--radius-xs..xl`），但 Monaco 的**内置浮层**（补全框 / hover / 参数提示 / 右键菜单）由它自己的样式表绘制，**没有主题槽位**可以注入圆角，因此仍是出厂值（10px 左右，且不随外壳档位变化）。
- **根因**：Monaco 主题系统只暴露颜色槽位，几何属性（圆角 / 边框宽度）不在 `defineTheme` 的能力范围内；要改只能写 CSS 覆盖 `.monaco-editor .monaco-hover` 等内部选择器（属侵入第三方 DOM，与「不侵入内核」原则冲突）。
- **建议方案**：若一定要统一，按元素逐个写覆盖 CSS 并锁死 Monaco 版本（升级需回归）；当前裁决**不做**，接受这一处不一致——浮层与外壳圆角差 2~4px 在日常使用中不可辨。
- **处理时机**：有明确视觉投诉再说；升级 Monaco 时需重新评估。
- **涉及文件**：`shell/src/style.css`、`shell/src/monaco.ts`、`docs/ui_premium_dev_plan.md §7.8.4`。

### TD-021 推送前复核遗留的低优先项（P4，5 小项；2026-09-25 全量复核引出）

- **起因**：P0~P4 六个未推送提交推送前全量复核（子代理深审 + 人工求证）。两个中等问题（终端背压队列无上限、stop/exit 提示时序）与三个低级项（session 静默失败、异常断点失败不回滚、Watches 满额静默/无令牌、resourcePanel 死代码）已随当次修复提交偿还；以下 5 小项经裁决**暂缓**。
- **① terminal.ts 背压「字节预算」实为 UTF-16 字符数**（✅ 已修 2026-10-07，维护态首件）：修法取登记中的「改存 Uint8Array」分支——新增零依赖模块 `shell/src/terminalBackpressure.ts`（push 时 `TextEncoder` 一次编码，计数 / 切分 / 丢弃 / 限流全按真实 UTF-8 字节），`terminal.ts` 只留接线。登记原提的 `Buffer.byteLength` 不可行：shell 是浏览器环境，无 Node `Buffer`。xterm v5 `write(Uint8Array)` 自带增量 UTF-8 解码，字节边界切分不乱码。
- **② session.ts `restoring` 是布尔非令牌**（❌ 裁决不处理 2026-10-07，P1-5 收口）：恢复 A 进行中切到工作区 B，A 的 `finally restoring=false` 会提前解锁，B 半恢复状态可能被防抖快照写回。场景罕见。修法：改为计数器/令牌。**收口裁决：场景罕见且维护态只受理三类事项，不立项，维持登记备查。**
- **③ sessions.rs 快照超 40 tab 保头弃尾**（✅ 已修 2026-10-07）：`truncate(MAX_TABS)` 丢的是最近打开的 tab，与「恢复最近现场」直觉相反。改保尾（`tabs.split_off(len - MAX_TABS)`），并同步活动 tab 判定：active 指向已丢弃（最旧）tab 时清掉，回落「激活最后一个」。
- **④ proc_stats 只统计直接子进程**（✅ 已修 2026-10-07）：运行链存在中间层（cmd /c、shell 包装）时孙进程内存不计入合计，芯片口径偏小。改按 parent 邻接表 BFS 收集全部后代（纯函数 `collect_descendants`，visited 防环），再映射成 ProcInfo。
- **⑤ debugWatches.ts 顶层 `load()` 读 localStorage**（✅ 已修 2026-10-07）：顶层副作用（有 try/catch 兜底）已改惰性初始化——`watches` 先置空、`ensureWatchesLoaded()` 在首次 `render()`（面板接线唯一网关）时加载，import 即不再触碰存储。
- **处理时机**：各自独立成 PR，任一项先跑对应测试矩阵（terminal → perf/01；session → session/01；debug → debug specs + 真机）。
- **涉及文件**：`shell/src/terminal.ts`、`shell/src/session.ts`、`shell/src-tauri/src/sessions.rs`、`shell/src-tauri/src/proc_stats.rs`、`shell/src/debugWatches.ts`。

## 已归档

> 处理完成的历史条目，仅保留标题与结论摘要；编号对应原 TD 编号。完整实施细节见对应 commit 历史。
> 2026-09-10：代码审查整改计划（`code_review_remediation_plan.md`，CR-01~CR-30 共 30 项）已全部完成并删除，其中与本表重叠的条目见上；其遗留的可选优化项（第 13/14 条）已于 2026-09-13 全部偿还并归档。

| 编号 | 标题 | 完成日期 | 结论摘要 |
|---|---|---|---|
| TD-020 | 停止运行时探针摘要重复打印/重复落库（P3，观感/数据卫生） | 2026-09-28 | 根因坐实（Python 3.13 复现）：`argv[0]` 守卫拦不住 argv 相同的父子进程（uvicorn `--reload` fork / 子进程自重启），多进程各自触发 `atexit._finalize` → 重复打印 + 多 `runs` 行 + `hits` 翻倍。修复：后端 `run_env.rs::build_run_env` 注入每次运行唯一的 `OPENCHARM_PROBE_RUN_ID`（纯 std：纳秒时间戳 + pid + 单调序号）；探针 `autostart._finalize` 用 `os.open(O_CREAT\|O_EXCL)` 墓碑文件（键=run_id，mtime 惰性清理）保证同 run_id 只落库+打印一次，非法 run_id / OSError 保守放行。probe pytest 全绿（新增 `test_run_lock.py` 3 例 + `test_inject.py` 1 例）、shell `cargo test run_env` 20 例全绿 |
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