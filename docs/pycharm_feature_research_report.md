# PyCharm 功能调研报告与 Montauri 借鉴建议

> 版本：v1.1 · 日期：2026-09-13 · 性质：调研报告（非排期依据）；§4 附 P0/P1/P2 落地记录，§0/§3 已同步为实际交付状态
> 调研方法：JetBrains 官方文档（pycharm/help）+ 使用者实践汇总 + 本仓库功能盘点（shell/ 源码逐项核对）。
> 结论用途：为 Phase 4「打磨期」的功能取舍提供输入；**是否立项、何时排期仍以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准**。

---

## 0. 一页结论

PyCharm 的领先之处并非单点技术（我们的三层补全/运行时采样在无注解场景反而有差异化），而是**几十个「顺手的小细节」和「默认就对」的交互**。经与 shell/ 现状逐项比对，最大的可借鉴缺口集中在四类：

1. **导航类缺口**（影响最日常）：无 Search Everywhere / Go to File / 最近文件 UI / 后退前进 / 面包屑；
2. **调试类缺口**（闭环已通但缺肌肉）：无 Evaluate Expression / Debug Console、无条件断点、无 logpoint；
3. **代码卫生类**：无 Optimize Imports、无 TODO 识别；
4. **容错类**：无本地历史（Local History），误删/误存无法挽回（有 Git 但脚本场景常不建仓库）。

> **落地状态（2026-09-13）**：四类缺口基本闭环——P0 四项 + P1 五项 + P2 四项共 13 项，其中 **12 项已交付**；P2-13 的 **Docstring 生成部分交付**（仅落地 live template，缺 `"""`+Enter 自动生成，且因位置轴把块头 `:` 判为续行，模板在块体首行触发不到——见 `tech-debt.md` TD-15/TD-16）。§3 差距表已同步。另余两项远期候选：probe 驱动的脚本热点视图、覆盖率运行（Phase 5+ 评估）。
>
> **落地状态补充（2026-09-15）**：TD-15/TD-16 已偿还并归档，Docstring 生成由「部分交付」转为「已交付」——`"""`+Enter 自动生成骨架（`shell/src/live-templates/docstring.ts`）+ 块体首行语句位缺陷修复（`scope.ts`）。至此 13 项全部闭环。

以上各项均在现有架构（Monaco contrib + LSP/DAP 桥 + Rust 命令）内低成本落地，无一违反「自研组件独立成包/进程」第一原则。

---

## 1. 调研范围与方法

- **调研对象**：PyCharm（Community/Professional，2024.1+ 行为为准）中与本项目功能范围（补全/跳转/Hover/诊断 + 运行 + 调试 + 编辑器基本功）重叠或邻近的功能与细节。
- **明确排除**（与项目非目标对齐，见 tech plan v3 §1.2）：远程解释器/SSH 开发、Jupyter、数据库工具、插件市场、协作编辑、Web 框架脚手架、AI 助手。
- **现状盘点**：对 `shell/src/*.ts`、`shell/src-tauri/src/*.rs` 逐项核对（证据见 §3 表格），并与 `tech-debt.md` 已登记项去重（如 TD-9/10 已涉及运行配置存储卫生，本报告不重复推荐）。

---

## 2. PyCharm 值得借鉴的功能与细节（按价值归类）

### 2.1 导航与检索（PyCharm 用户黏性最强的部分）

| # | 功能 | PyCharm 行为细节 | 对 Montauri 的价值 |
|---|---|---|---|
| N1 | **Search Everywhere**（Double Shift） | 一个入口混搜：文件、类/符号、动作（菜单命令）、设置项、甚至 IDE 操作；支持 `:line` 后缀、camelCase 模糊匹配 | 我们已有文本搜索（Ctrl+Shift+F）+ 大纲（documentSymbol）+ 完整键位注册表（`keybindings.ts` META），**只缺一个统一弹窗把它们串起来**，是「投入小、体感提升最大」的一项 |
| N2 | **Recent Files / Recent Locations**（Ctrl+E / Ctrl+Shift+E） | 弹窗列出最近打开文件与最近光标停留位置；与 Git 修改状态联动打标 | 后端 `file_ops.rs` 已有 `add_recent`/`get_recent`，**前端从未消费**（仅最近工作区列表）——属于「半成品收尾」 |
| N3 | **Go to File / Go to Line**（Ctrl+Shift+N / Ctrl+G） | 文件名模糊匹配；行号支持 `行:列` | 纯 UI 件，无协议依赖 |
| N4 | **导航历史（后退/前进）**（Ctrl+Alt+Left/Right） | 跳转定义后可原路返回；跨文件跳转链路可回溯 | 跳转定义（F12/Ctrl+B）已实现，但**跳过去回不来**是当前跳转体验最明显的短板 |
| N5 | **Breadcrumbs 面包屑** | 底部常驻「模块 → 类 → 函数」层级链，可点击在层级间跳转 | 数据源已有（documentSymbol 已在 outline 使用），做一个底部条即可；对长文件（爬虫/脚本常见）定位体感好 |
| N6 | **书签 + 助记书签**（F11） | 行级书签列表 + 11 个助记书签 | 低成本；对「自用脚本集」场景有真实需求（标记待办行/可疑行） |

### 2.2 调试（PyCharm 调试体验的行业标杆项）

| # | 功能 | PyCharm 行为细节 | 对 Montauri 的价值 |
|---|---|---|---|
| D1 | **Evaluate Expression / Debug Console**（Alt+F8） | 断点处对任意表达式求值，结果可读可写；Debug Console 可在断点上下文中执行多行代码并补全 | **DAP 协议的 `evaluate` request 是现成的**，debugpy 完整支持；我们的 DAP 桥（`dap/client.ts` + `src-tauri/dap.rs`）最小闭环已交付，补 `evaluate` 是协议桥内 1~2 天量级的工作，却是调试「最小闭环 → 可用」的关键一步（`runGutter.ts` 注释中「需要 eval harness」的顾虑仅针对运行态，不适用于调试态） |
| D2 | **条件断点 / 命中断点** | 右键断点设 condition / hit count，不满足条件不断下 | DAP `setBreakpoints` 原生支持 `condition`/`hitCondition` 字段，我们当前只传 `{line}`（`dap/client.ts`），**加字段即可**；爬虫循环场景（第 N 次迭代才断）刚需 |
| D3 | **Logpoint（不打断记录）** | 断点不打停，只往控制台打印一行表达式求值结果 | 同样是 DAP `logMessage` 原生字段；与 D2 同一个右键菜单 |
| D4 | **行内变量值（Inline Values）** | 调试暂停时，每行行尾直接显示该行变量的当前值 | Monaco 自带 `InlineValuesProvider` 注册点；DAP 侧 debugpy 支持按帧 evaluate 获取值。可与本项目已有的运行时 inlay hints（intel 类型标注）形成视觉统一 |
| D5 | **Set Value / 修改变量** | 调试中直接改写变量值继续跑 | DAP `setVariable`；小成本，调试补一句即可 |
| D6 | **Run to Cursor / Smart Step Into** | Ctrl+R 直接跑到光标行；智能步进可选择进入哪个调用 | `runToCursor` = setBreakpoints 临时断点组合；DAP 原生有 `stepInTargets`。属调试打磨项 |
| D7 | **带覆盖率运行** | Run with Coverage，行级命中高亮 | 需 coverage.py 依赖；价值有但优先级低（见 §4） |
| D8 | ** Profiler / line_profiler 集成** | 函数级耗时与逐行耗时视图 | **可与我们的差异化核心联动**：probe（PEP 669 采样）已在采集运行时数据，未来可低成本做出「脚本热点视图」——这是 PyCharm 付费版都没有的、贴合我们采样底座的自然延伸（Phase 5+ 候选，本期不动） |

### 2.3 编辑器与代码卫生

| # | 功能 | PyCharm 行为细节 | 对 Montauri 的价值 |
|---|---|---|---|
| E1 | **Optimize Imports**（Ctrl+Alt+O） | 一键移除未使用导入 + 按规则排序；可配置保存时自动执行 | **零新依赖**：`ruff check --fix --select I,F401 --stdin`（或 `ruff check --select I001,F401`）走现有 format 管线（`fs_cmds.rs::format_python` 同款 stdin 模式）；ruff 的 isort 兼容规则就是 PyCharm 对标物 |
| E2 | **TODO 工具窗** | 扫描 `TODO/FIXME/XXX` 注释，按模式分类列出，点击跳转 | 复用 `search_workspace` 的 `ignore` crate 走查（.gitignore 感知已就绪），纯正则扫描；自用脚本仓库「哪里留了坑」一目了然 |
| E3 | **Intention Actions 体系**（Alt+Enter） | 不只是错误修复：转 dict/comprehension 互转、字符串 f-string 化、if-TS 化等「没坏但可更好」的改写 | 我们的 codeAction（灯泡 + Ctrl+.）只接 LSP 诊断驱动修复；独立意图动作体系建议**不立项**（成本高、pyrefly/ruff 无此能力），但可借道 ruff lint 规则（见 E5）白捡一批改写建议 |
| E4 | **Docstring 自动生成** | 输入 `"""` 回车或 Alt+Insert 按函数签名生成 docstring 骨架 | 天然是 **live template 的一个上下文轴特例**——我们模板体系已支持容器×位置×词法三维上下文（相位 A 已交付），加 2~3 个内置 docstring 模板即可，无需新系统 |
| E5 | **实时 lint（PEP8 级）** | 诊断内联显示命名/风格问题 | 架构上诊断已按引擎 owner 分桶缓存（pyrefly/intel 两桶，`lsp/client.ts::handleDiagnostics`），**加第三桶 ruff**（`ruff server` LSP 或离线 `ruff check`）无需动桥；成本低、收益直观 |
| E6 | **Scratch 文件** | Ctrl+Alt+Shift+Insert 建不入库草稿，可直接运行/调试 | 贴合「小脚本」用户画像（临时试一段代码不污染工作区）；实现：固定草稿目录 + 免 Git/watcher 的普通运行路径 |
| E7 | **本地历史（Local History）** | 每次保存/外部修改自动快照，可在无 Git 环境下 diff 与回滚；带标签 | **自用 IDE 最强兜底**：目标用户大量小脚本常不在 Git 仓库内。实现思路：保存时快照至 `~/.montauri/history/<project_hash>/`（复用 project_hash），前端做「历史列表 + diff 预览」（diff 编辑器已有：`git.ts::ensureDiffEditor`） |
| E8 | **快速文档弹窗**（Ctrl+Q） | 独立于 hover 的可滚动、可检索文档浮层 | hover 已有；优先级低，Monaco 的 hover 已经可承载，不单独立项 |
| E9 | **参数提示 / 折叠 / 多光标 / 注释切换** | —— | ✅ 已实现（`monaco.ts` contrib + 键位），无需动作 |

### 2.4 运行体系细节

| # | 功能 | PyCharm 行为细节 | 对 Montauri 的价值 |
|---|---|---|---|
| R1 | **命名运行/调试配置** | 配置可命名、可复制、可存参数/env/cwd，Run 下拉一键切换；调试复用同一配置 | 我们已有按脚本的运行配置（`env_cmds.rs::run_configs`，含 stdin 配置），**缺「调试复用同一配置」与命名模板**；建议调试启动时直接继承该脚本运行配置，零学习成本 |
| R2 | **Rerun 失败即重跑 / 自动滚动 / 首错误收起** | 输出面板交互细节 | 低成本打磨项，随输出面板迭代顺带做 |
| R3 | **运行历史** | Run 窗口保留历史标签页可回看 | 我们 transcript 已是流式行（`output.ts`），按次留存标签即可；优先级中低 |

### 2.5 明确**不建议**照搬（与项目非目标/成本红线对齐）

| 功能 | 不做的理由 |
|---|---|
| 意图动作全体系（Alt+Enter 全家桶） | pyrefly/basedpyright/ruff 均不提供改写引擎；自建改写引擎 = 自研类型引擎级成本（违反非目标） |
| Scientific/Dataframe/Numpy Viewer | 与「FastAPI+爬虫+小脚本」画像偏离；科学模式 2024.1 起也只是默认开启既有功能，非刚需 |
| 远程解释器 / SSH / Dev Container | 非目标明列；架构上 probe 注入也与远程环境冲突 |
| 全功能重构（Change Signature 等） | LSP 桥协议子集只声明了必要能力；rename 已有，extract 级重构依赖引擎端能力，暂无来源 |

---

## 3. 差距映射总表（PyCharm 功能 × Montauri 现状 × 建议）

> 现状证据来源：shell/ 源码逐项核对（文件相对路径以 `shell/` 为根）。✅ 已实现 / 🟡 部分 / ❌ 未实现。

| PyCharm 功能 | 现状 | 证据 | 建议动作 | 量级 |
|---|---|---|---|---|
| Search Everywhere | ✅ | `src/quickOpen.ts`（文件 + documentSymbol 符号 + 键位动作混搜）；后端 `fs_cmds::list_workspace_files` | 已交付（§4 P1-5） | 中 |
| Go to File / Line | ✅ | `src/quickOpen.ts`（Ctrl+Shift+N / Ctrl+G，支持 `行:列` 与 `:行号` 后缀） | 已交付（§4 P1-5） | 小 |
| Recent Files | ✅ | 后端 `file_ops.rs` `get_recent/add_recent`；前端 `src/recentFiles.ts`（Ctrl+E 弹窗） | 已交付（§4 P0-3） | 小 |
| 后退/前进导航历史 | ✅ | `src/navHistory.ts`（位置栈 + 游标模型，Ctrl+Alt+←/→） | 已交付（§4 P1-8） | 中 |
| Breadcrumbs | ✅ | `src/breadcrumbs.ts`（`symbolChainAt` 纯函数 + 顶部「文件 › 类 › 函数」链接） | 已交付（§4 P2-10） | 中 |
| 书签 | ✅ | `file_ops.rs` 书签三命令 + `src/bookmarks.ts`（Ctrl+F11 / Ctrl+Shift+F11） | 已交付（§4 P2-13） | 小 |
| TODO 识别 | ✅ | `fs_cmds::scan_todos`（复用 `search_workspace` 的 ignore 走查）+ `src/todoView.ts` | 已交付（§4 P0-4） | 小 |
| Optimize Imports | ✅ | `fs_cmds::optimize_imports`（ruff `I,F401` stdin 管线）+ 保存时可选自动执行 | 已交付（§4 P0-2） | 小 |
| ruff 实时 lint | ✅ | `fs_cmds::ruff_lint` + `src/ruffLint.ts`（owner `montauri-ruff`，第三诊断桶） | 已交付（离线扫描路线，§4 P2-12） | 中 |
| 本地历史 | ✅ | `src-tauri/src/history.rs`（快照/列/读/回滚/清空）+ `src/localHistory.ts`（Ctrl+Shift+H） | 已交付（§4 P1-7） | 中 |
| Scratch 文件 | ✅ | `fs_cmds::create_scratch`（草稿落 `<data_root>/scratches/`，不入库） | 已交付（§4 P2-13） | 小 |
| Docstring 生成 | ✅ | `src/live-templates/builtin.ts` 的 `doc` / `docf` / `docc`（含 `allowInStrings`）+ `src/live-templates/docstring.ts` 的 `"""`+Enter 自动生成（Args/Returns/Attributes 骨架） | 已交付（§4 P2-13；块体首行触发缺陷随 TD-15 修复） | 小 |
| Evaluate / Debug Console | ✅ | `dap/client.ts::dapEvaluate` + `src/debugConsole.ts`（Alt+F8） | 已交付（§4 P1-6） | 中 |
| 条件断点 / hitCondition | ✅ | `dap/client.ts::BreakpointSpec`（字段透传）+ `debugGutter.ts` 断点右键菜单 | 已交付（§4 P0-1） | 小 |
| Logpoint | ✅ | 同上（`logMessage` 透传，菱形 glyph；输出经调试控制台承接） | 已交付（§4 P0-1） | 小 |
| 行内变量值 | ✅ | `src/inlineValues.ts`（Monaco 注饰实现，复用 `variables` 请求，零额外 DAP 开销） | 已交付（§4 P2-11） | 中 |
| Set Value | ✅ | `dapSetVariable` + 变量面板点值即改 | 已交付（§4 P2-11） | 小 |
| Run to Cursor | ✅ | `debugView.ts::runToCursor`（Alt+F9，临时断点 + 命中后自动撤） | 已交付（§4 P2-11） | 小 |
| 调试复用运行配置 | ✅ | `dap.rs::debug_start/debug_attach_debuggee` 直读 `read_run_config`；`run_config_key` 单测锁口径 | 已交付（后端本已生效，本次补可发现性，§4 P1-9） | 小 |
| 运行历史 | ✅ | `src/runHistory.ts`（留存 20 次，可回看可删，Ctrl+Shift+R） | 已交付（§4 P2-13） | 中 |
| 覆盖率运行 | ❌ | 无 | 依赖 coverage.py；**缓议**（Phase 5+） | 大 |
| 结构视图/参数提示/inlay/折叠/多光标/Surround/快速修复/注释 | ✅ | `main.ts` outline、`monaco.ts` contribs、`lsp/client.ts` providers、`live-templates/surround.ts`、`keybindings.ts` | 无需动作 | — |
| 补全三层合并 / postfix / live template | ✅（且强于 PyCharm 可配置性） | `lsp/client.ts` 排序契约、`live-templates/*` | 无需动作；继续相位 B（上下文轴导入/UI） | — |
| 运行 + traceback 跳转（含终端内） | ✅ | `output.ts`、`terminal.ts` link provider、`runGutter.ts`/`runWidget.ts` | 无需动作 | — |
| Git 全家桶 / 全局搜索 / 终端 | ✅ | `git.ts`、`search.ts`、`terminal.ts`、`git_status.rs` 等 | 无需动作 | — |
| 格式化 + 保存自动格式化 | ✅ | `fs_cmds.rs::format_python`、`main.ts` | 无需动作 | — |

---

## 4. 推荐落地清单（供排期参考）

> 按「投入产出比」排序，全部不触碰架构第一原则（自研组件独立成包/进程、不侵入外壳内核）。验收沿用工程规范：bench 回归 + 内存红线不受影响。

### P0（建议尽快排期，单项 ≤ 1~2 天量级）

1. **条件断点 + Logpoint**：DAP 协议原生字段透传（TS `dap/client.ts` + Rust `dap.rs`），断点 gutter 右键菜单。爬虫调试刚需，投入最小的调试体验跃升。
2. **Optimize Imports**：ruff `I,F401` fix 走既有 stdin 管线，加键位 + 可选保存触发（与保存自动格式化同模式）。
3. **Recent Files（Ctrl+E）**：纯前端弹窗，消费已存在的 `get_recent` 数据。
4. **TODO 识别**：复用 `search_workspace` 走查，正则 + 结果列表跳转。

### P1（建议立项，单项 2~5 天量级）

5. **Search Everywhere / Quick Open**：统一弹窗（文件 + documentSymbol 符号 + 键位动作混搜），Double Shift / Ctrl+Shift+N / Ctrl+G 入口；为后续所有「命令面板类」交互打底。
6. **Evaluate Expression / Debug Console**：DAP `evaluate` + 断点上下文求值；这是调试从「能看」到「能问」的分水岭，也是对标 PyCharm 调试体验的关键项。
7. **本地历史（Local History）**：保存快照到 `~/.montauri/history/`，diff 预览 + 回滚（diff 编辑器复用 `git.ts`）。
8. **后退/前进导航历史**：跳转闭环的另一半，跳转定义频次越高此项越痛。
9. **调试复用运行配置**：调试启动继承 run_configs（顺带偿还 tech-debt TD-9/10 的存储卫生时一并考虑）。

#### P0 落地记录（2026-09-13）

| # | 落地情况 | 主要改动 |
|---|---|---|
| 1 | ✅ 已交付 | `dap/client.ts` 新增 `BreakpointSpec`（condition / hitCondition / logMessage），`dapSetBreakpoints` 只透传非空字段；`debugGutter.ts` 断点表由 `Set<line>` 升级为 `Map<line, spec>`（空 spec = 普通断点，旧调用方语义不变），gutter 右键菜单可选「条件 / 命中次数 / 日志（不断下）」并渲染菱形 + 问号 glyph。Rust 侧 `dap_send_request` 本就原样透传 params，无需改动。回归见 `shell/src/__tests__/breakpoints.test.ts` |
| 2 | ✅ 已交付 | 后端 `fs_cmds::optimize_imports`（`ruff check --fix --select I,F401`，stdin 管线，与格式化同款）；键位 `Ctrl+Alt+O` + 设置项「保存时自动整理导入」（`optimize_imports_on_save`，默认关） |
| 3 | ✅ 已交付 | 新增 `shell/src/recentFiles.ts`（Ctrl+E 弹窗：过滤输入 + ↑↓ 漫游，焦点留在输入框）；消费**既有**的 `file_ops::get_recent`，收回「前端只写不读」的半截功能，未新增持久化 |
| 4 | ✅ 已交付 | 后端 `fs_cmds::scan_todos`（复用 `search_workspace` 的 `ignore` 走查，.gitignore 感知）；`HACK/BUG/XXX` 全大写匹配防误报；前端 `shell/src/todoView.ts` 分组列表 + 点击跳转 |

新增 2 个键位 id（`optimize_imports` / `recent_files`），三处同步已更新（`keybindings.ts` META / `state.ts` DEFAULT_SETTINGS / Rust `default_keybindings`），
`settings.rs` 键位数漂移锁 17 → 19。

#### P1 落地记录（2026-09-13）

| # | 落地情况 | 主要改动 |
|---|---|---|
| 5 | ✅ 已交付 | 新增 `shell/src/quickOpen.ts`（文件 + 符号 + 命令混搜，`:行号` 后缀、模糊打分、双击 Shift / `Ctrl+Shift+N` / `Ctrl+G` 三入口）；后端新增 `list_workspace_files`（复用全局搜索的 `ignore` 走查）。命令数据源由 `main.ts` 注入，键位提示跟随用户改键 |
| 6 | ✅ 已交付 | `dap/client.ts` 补 `dapEvaluate` / `dapSetVariable`；新增 `shell/src/debugConsole.ts`（控制台 + 输入历史 + `Alt+F8` 求值）。**顺带修掉一个 P0 遗留**：`output` 事件原先被 debugView 的空回调吃掉，导致 Logpoint 输出全不可见，现由调试控制台承接 |
| 7 | ✅ 已交付 | 新增 `shell/src-tauri/src/history.rs`（保存前快照，存 `<data_root>/history/<project_hash>/<file_hash>/`，内容原样存文本、同内容去重、单文件上限 100 版、id 白名单防路径穿越）；前端 `shell/src/localHistory.ts`（列表 + Monaco diff 预览 + 回滚，回滚前先留「回滚前」快照）+ `Ctrl+Shift+H` |
| 8 | ✅ 已交付 | 新增 `shell/src/navHistory.ts`（位置栈 + 游标模型，`Ctrl+Alt+←/→`；`applying` 抑制标志防止回退自身入栈） |
| 9 | ✅ 已交付（后端本已生效） | 核对确认 `dap.rs::debug_start` / `debug_attach_debuggee` 早已直读 `read_run_config` 并经 `build_run_env` 应用参数/env；本次补齐的是**可发现性**：运行配置面板明示「对运行与调试同时生效」及 stdin=file 在调试下不支持，调试启动回显「复用运行配置：…」，并加 `run_config_key` 单测锁口径（防静默丢失配置） |

键位三处同步已更新（`keybindings.ts` META / `state.ts` DEFAULT_SETTINGS / Rust `default_keybindings`），
新增 6 个键位 id；`settings.rs` 的键位数漂移锁 19 → 25；`parseKeyToken` 补 `Left/Right/Up/Down`
方位键短名（KeyboardEvent.code 只有 `Arrow*` 形态）。

#### P2 落地记录（2026-09-13）

| # | 落地情况 | 主要改动 |
|---|---|---|
| 10 | ✅ 已交付 | 新增 `shell/src/breadcrumbs.ts` + 编辑区顶部 `#breadcrumbs`（文件 › 类 › 函数，点击跳转）；符号链计算抽成纯函数 `symbolChainAt` 并带单测；刷新时机为切 tab / 光标移动 / 文档变更（250ms 防抖） |
| 11 | ✅ 已交付 | ①行内变量值：`shell/src/inlineValues.ts`——Monaco 0.52 standalone **未暴露** `registerInlineValuesProvider`（那是 VS Code 侧 API），故改用与 inlay hints 同款的注入文本装饰实现，复用已有 `variables` 请求，零额外 DAP 开销；②Set Value：变量面板点值即改（DAP `setVariable`，需要「容器引用 + 名字」，故变量面板保存了 locals scope 的引用）；③Run to Cursor：Alt+F9，临时断点 + 继续，命中后自动撤掉（不误删用户既有断点） |
| 12 | ✅ 已交付（离线扫描路线） | 后端新增 `fs_cmds::ruff_lint`（`ruff check --output-format json --select E,W,F`，stdin 管线，与格式化/Optimize Imports 同款）；前端 `shell/src/ruffLint.ts` 以 `montauri-ruff` 为 owner 下发 marker，与 `montauri-lsp` / `montauri-intel` 三桶并存。**未选 ruff server LSP**：不引入第二个语言服务器进程，代价是「停手 800ms 才刷」而非逐字符 |
| 13 | ✅ 已交付 | ①Scratch：`fs_cmds::create_scratch`，草稿落在 `<data_root>/scratches/`（不在工作区里，不入库），编号跨扩展名共享；②书签：`file_ops::get_bookmarks/toggle_bookmark/clear_bookmarks` + `shell/src/bookmarks.ts`（gutter 星标装饰 + 列表弹窗，Ctrl+F11 / Ctrl+Shift+F11）；③运行历史：`shell/src/runHistory.ts`，挂钩 run-stdout/stderr/exit 复用已还原的整行，留存 20 次、可回看可删（Ctrl+Shift+R）；④Docstring 模板：新增 `doc` / `docc`，并修正既有 `docf`——它缺 `allowInStrings`，而 docstring 本身就在字符串里（`tabExpand.ts` 默认禁止字符串内展开），等于一直用不上 |

新增 5 个键位 id（`debug_run_to_cursor` / `bookmark_toggle` / `bookmark_list` / `scratch_new` / `run_history`），
三处同步已更新，`settings.rs` 漂移锁 25 → 30；`NAMED_KEYS` 补 `Insert`。

> 附注（2026-09-13 复核）：第 13 项 ④ 的 docstring 模板存在触发缺口——位置轴把块头 `:`
> 判为续行（`scope.ts::CONT_SUFFIX_RE`），导致 `doc`/`docf`/`docc` 在「def/class/if 体首行」
> 被判为 `expression` 而过滤掉；且未实现 PyCharm 的 `"""`+Enter 自动生成。故本项对应能力
> 回标 🟡，已登记 `tech-debt.md` TD-15/TD-16，暂缓处理。
> ——已于 2026-09-15 偿还（TD-15 移除 `:` 续行误判 + TD-16 `"""`+Enter 自动生成），本项回标 ✅。

### P2（有价值，随迭代顺带）

10. **Breadcrumbs**（documentSymbol 底部条）
11. **行内变量值 / Set Value / Run to Cursor**（调试打磨组）
12. **ruff 实时 lint 第三桶**（诊断分桶架构已就绪）
13. **Scratch 文件 / 书签 / 运行历史 / Docstring 内置模板**

### 远期候选（与差异化核心联动，Phase 5+ 评估）

14. **probe 驱动的脚本热点视图**（对标/超越 PyCharm Profiler）：采样底座已在，属「别人抄不了我们」的方向。
15. **覆盖率运行**：依赖外部 coverage.py，价值中等，缓议。

---

## 5. 结语

本次调研的核心判断：**PyCharm 的体验优势在「导航闭环 + 调试肌肉 + 容错兜底」三类细节，而非补全算法本身**。我们已完成的最小闭环（补全/跳转/运行/调试）底座正确，缺口多为「协议字段已就绪、只差 UI/透传」的低垂果实（P0/P1 共 9 项预估总投入约 3~4 周单人量级）。建议从 P0 四项起步，先让调试与代码卫生补齐到「自用不回头找 PyCharm」的水平。

> 复盘（2026-09-13）：P0/P1/P2 共 13 项中 12 项已交付、1 项（Docstring 生成）部分交付，上述「低垂果实」基本采摘完毕。未达对标效果的部分（Docstring 自动生成 / 位置轴块体首行缺陷）已登记 `tech-debt.md` TD-15/TD-16 暂缓。后续若继续对标，方向应转向 §4 的远期候选（probe 热点视图 / 覆盖率运行），而非继续补 UI 细节。
>
> 复盘补充（2026-09-15）：上述缺口已闭环——TD-15（位置轴块体首行缺陷）与 TD-16（Docstring 自动生成）均已偿还并归档（`tech-debt.md`）。E4 由「部分交付」转为「已交付」：`"""`+Enter 按函数签名生成 Args/Returns/Attributes 骨架（`shell/src/live-templates/docstring.ts`，含单测），块体首行语句位模板触发缺陷同步修复（`scope.ts`）。

> 附：本报告基于的 PyCharm 行为以 JetBrains 官方文档（help.jetbrains.com/pycharm，2024.1+）与公开实践汇总为准；Montauri 现状以 2026-09-13 源码与测试复核为准。
