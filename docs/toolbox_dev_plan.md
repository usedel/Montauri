# OpenCharm 工具箱开发计划（SQLite · HTTP Client · 结构化日志 · TODO/Markdown 增强）

> 版本：v1.4 · 日期：2026-10-05 · 状态：**实施中**（B3、PR-B6-3、**B4 三个 PR 全部交付**、**B5 三个 PR 全部交付（B5 闭环）**；PR-B6-1 / PR-B6-2 待实施）
> **v1.4 变更：B5 闭环**（§6.9 三项拍板；交付记录 §6.10 PR-B5-1 / §6.11 PR-B5-2 / §6.12 PR-B5-3）。
> **v1.3 变更：B5 开工**（§6.9「拍板结论」）。
> **v1.2 变更：B4 形态改版**（§5 整体重写）。原「`.http` 文件驱动」形态于 2026-10-05 由产品负责人否决并撤销已实现版本，改为「**devtools 内置工具 · 面板驱动**」：随时唤起、**不在项目目录落下任何文件**、不做 `.http` 文件、v1 不做 SSE。决策记录见 §3 决策 5 与 §5.8。
> 上游：`docs/improvement_and_roadmap_report.md` 第 3 章候选池 **B3 / B4 / B5 / B6**；本报告把四条选题落成 PR 级实施计划。
> 与既有文档的关系：本计划是**执行依据**，与 `python_ide_dev_plan_v2.md`（Phase 4 打磨期）不冲突；冲突时以后者为准并反馈修订。
> 事实底座：全部结论均于 2026-10-02 回代码核实（含 file:line）。`git` HEAD `44c85ea`，分支 `master`。
> 范围裁决：本报告**只做** B3/B4/B5/B6 四项；A 类差异化（运行时热点 / Profiler）与 C 类 AI 不在本计划内。

---

## 0. 一页结论

| 功能 | 一句话形态 | 选型结论 | 新依赖 | 量级 | PR 数 |
|---|---|---|---|---|---|
| **B6** TODO / Markdown 增强 | Markdown 预览支持 Mermaid + 文档大纲；TODO 视图按文件分组 + 过滤 + 跳转 | 纯前端，Mermaid **懒加载** | `mermaid`（前端，动态 import，首屏零成本） | **3~4 人日** | 3 |
| **B5** 结构化运行日志视图 | 底部新 tab「运行日志」：级别过滤 + JSON/loguru 行解析折叠 + 时间戳对齐 + 搜索 | 复用 `output.ts` 已有级别层；`termUi` 采集钩子改多播 | 无 | **4~5 人日** | 3 |
| **B4** HTTP Client | devtools 内置「HTTP 请求」工具：`Ctrl+Shift+T` 随时唤起 + 发送请求 + 响应面板 + 变量/环境 + 历史 + curl 粘贴导入（**零项目内文件**） | Rust **reqwest**（已定案）；载体 **devtools 内置工具**（已定案）；Python 桥不排期 | `reqwest`（Rust） | **4.5~6 人日** | 3 |
| **B3** SQLite 数据库工具 | 侧栏「数据库」视图：连接管理 + 对象树 + 数据网格 + SQL 编辑器（默认只读） | Rust **rusqlite bundled**（已定案）；py 桥为降级 | `rusqlite`（Rust，bundled） | **8~10 人日** | 4 |

> **B3 已实施**（2026-10-02）：PR-1 ~ PR-4 代码完成、测试全绿（`cargo test db_` 33 / `vitest` 994 / `e2e/db/` 22），**未提交**。实施记录与 e2e 抓到的两个真 bug 见 `docs/sqlite_tool_dev_plan.md` §9.1~§9.4。本节以下内容保留为原始计划，供回溯。
>
> **B6 实施中**（2026-10-05）：PR-B6-3 TODO 增强已交付并完成复核修正；PR-B6-2 Markdown 大纲、PR-B6-1 Mermaid 尚未开始，因此 **B6 整体未完成**。

**总量约 20~25 人日**（含测试与 e2e；B4 由 7~9 降为 4.5~6，见 §5.8）。建议推进顺序 **B6 → B5 → B4 → B3**：先做零新依赖、见效快的两项，把两个引入 Rust 依赖的重头戏放在后面（且各自第一个 PR 就是"加依赖 + 跑通 CI"，风险前置）。

选型的**拍板结论**（2026-10-05，详见第 3 章）：

1. **B3** —— **rusqlite（bundled）** 已定案（原生、可取消、快；Python 桥 + `sqlite3` 仅作无 bundled 编译环境时的降级路径，不实现）；
2. **B4 执行引擎** —— **reqwest** 已定案；Python 桥 + httpx **不排期**（面板驱动形态下"复用用户 venv"的价值大幅下降）；
3. **B3 默认只读** —— 已定案：数据库**默认以只读方式打开**，写语句需二次确认 + 显式开关（避免手滑 `UPDATE` 全表）；
4. **B4 交互形态** —— **devtools 内置工具（面板驱动）**已定案；**不做 `.http` 文件**（连导入/导出也不做）；**v1 不做 SSE 流式**（列为 v1.1 首位候选）。

---

## 1. 现状核实（代码证据）

### 1.1 侧栏视图与底部面板的注册机制

| 机制 | 落点 | 证据 |
|---|---|---|
| 侧栏视图注册表 | `views.ts:5` `SidebarViewId` 联合类型；`:7-17` `SidebarView { id, rootId, tabId, onShow?, onHide? }`；`:37` `registerSidebarView`；`:47` `setSidebarTab`（隐藏所有根 → 显示激活根 → 写 `localStorage "opencharm.sidebar_view"`） | 注册示例 `main.ts:2653`（files）、`:2667`（todo） |
| 新增侧栏视图要碰 5 处 | ① `views.ts:5` 加 id ② `index.html` Activity Bar 按钮（`:91` `tab-todo`）+ 面板根容器（`:161` `#view-todo`）③ `main.ts:2653-2696` 注册 + `:2699-2704` 点击绑定 ④ `style.css` 样式段 ⑤ i18n `activity.*` | — |
| 底部面板 tab | `termUi.ts:69` `BottomTab = "output"|"terminal"|"git"|"findUsages"|"problems"`（**5 个**，与旧文档"收窄为 3 个"不符，以代码为准） | `:71` 当前值；`:111-138` `setBottomTab` |
| 新增底部 tab 要碰 **4 处** | ① `termUi.ts:69` 枚举 ② `setBottomTab` 三张同步表：tab 按钮 `:114`、面板容器 `:125`、辅助元素 `:130` ③ `resetOutputChannelUi()` 复位表 `:764-781`（**漏改会导致关闭工作区后状态残留**，`:776` 有专门注释）④ `index.html:353-357` 按钮 + `:392-405` 容器 + `wireBottomPanel()`（`:805`）点击 | — |

### 1.2 B6 现状

| 项 | 现状 | 证据 |
|---|---|---|
| TODO 视图 | 已在侧栏注册表（`id:"todo"`）；`invoke("scan_todos",{root})` → Rust `fs_cmds::scan_todos`；支持按标签/文件分组、200ms 关键字过滤、折叠、命中/总数摘要与点击跳转 | `todoView.ts::filterTodos/groupTodosByFile/renderTodoPanel/setTodoViewHandlers`；e2e `todo/01-filter-group.spec.ts` |
| Markdown 预览 | **不在侧栏注册表**（编辑区右侧分栏）；管线 `marked`(GFM) → `DOMPurify.sanitize` → 图片 `convertFileSrc` 改写 → `monaco.editor.colorize` | `markdownPreview.ts:87 renderMarkdownToHtml`、`:47 sanitizeHtml`、`:65 rewriteImageSrcs`；DOM `#md-preview` / `#btn-md-preview` |
| Mermaid | **全仓零命中** | grep `mermaid` = 0 |
| 文档大纲 | **无** | — |
| 依赖 | `marked ^18.0.12`、`dompurify ^3.4.15`（已随包，Monaco 0.52.2 精确锁定） | `package.json:19-21` |

### 1.3 B5 现状（关键：输出流向）

> **重要事实**：运行 stdout **不走输出面板**，走终端 PTY；输出面板只收「元信息行」+ **调试**输出。

- 运行 stdout：`terminal.ts`（xterm + PTY，事件 `term-data` → `writeData`，含背压队列）；
- 输出面板：`runFlow.ts` 只写元信息（`appendOutputLine(outputEl, hint, "hint", ...)`，见 `:167/253/477/530/669/829`）；调试输出走 `debug-stdout` / `debug-stderr`（`:892-899`）；
- **旁路采集链已存在**：`runHistory.ts` 在 `termUi` 的 `term-data` 分发点挂钩 `runOnData`，剥离 ANSI 后按行入档（上限 20 次 / 单次 3000 行保留尾部）；
  → **B5 复用同一条旁路即可**，不必重新采集。
- **钩子是单槽位**：`termUi.ts:40 runOnData?: (text) => void`、`:569 s.runOnData = opts.onData`、`:887 s.runOnData?.(plain)`、`:315 s.runOnData = undefined`。
  → **必须先改造成多播**，否则 B5 会把 runHistory 的采集顶掉。
- **级别层已完整可复用**：`output.ts:101 OutputLogLevel`、`:109 LEVEL_RULES`（`[LEVEL]` / `LEVEL:` / `LEVEL:name:msg` / `- LEVEL -` 四种形态，大小写敏感）、`:139 detectLogLevel()`、`:148 setOutputLevelFilter`、`:118 levelCounts`；行数上限 `DEFAULT_MAX_OUTPUT_LINES = 5000`（`:213`）。
- 现有后处理管线：`util.ts:47 stripAnsi()`、`output.ts:17 TRACEBACK_RE` + `tracebackLink.ts`、`output.ts:23 URL_RE`。
- 缺口：JSON/loguru 行解析、字段折叠（**可参考** `devtools/jsonpath/tree.ts` 的树形渲染）、时间戳对齐。

### 1.4 B4 / B3 现状（Rust 侧）

| 项 | 现状 | 证据 |
|---|---|---|
| Rust 依赖 | `tauri 2`(protocol-asset)、dialog/clipboard 插件、serde/serde_json、trash、sha1、base64、portable-pty、notify-debouncer-mini、ignore、regex、shell-words、zip(deflate)、sysinfo 0.39.6 | `Cargo.toml:14-31` |
| **HTTP 能力** | **零**（2026-10-05 复核）：无 reqwest / 无 tauri-plugin-http；`shell/src` 零 `fetch(` 命中；`devtools/curl2python/{parse.ts,gen.ts}` 与 `python2curl.gen.ts` 是**纯字符串转换，不发请求**。注：B4 文件驱动形态曾实现一版后被撤销，`reqwest` / `http_cmds` / `httpClient` / `httpParser` **全仓零命中**，无残留 | §5.8 |
| **SQLite 能力** | **零**：无 rusqlite / sqlx | — |
| 异步运行时 | 无 tokio 直接依赖；用 `tauri::async_runtime`（`spawn` / `spawn_blocking`） | `lib_cmds.rs:173` |
| 命令范式 | `*_impl` 纯函数（可单测）+ `#[tauri::command]` 薄壳；错误统一 `Result<T, String>` / `.map_err(|e| e.to_string())`；`lib.rs:75` 单张 `generate_handler!` 列表按域分组 | 范例 `fs_cmds.rs:92-95` |
| 流式 + 可取消基建 | `git_cmds.rs:760-909`：`GIT_NET_OPS: PerWindow<HashMap<String, GitNetOp>>`、spawn + stderr 逐行线程 emit（`git-op-stdout`，payload `{op,data}`）+ 主线程 100ms 轮询 `cancel`/`try_wait` + 240s 兜底 + `kill_process_tree`；`git_cancel_op` 只置标志；`git_stop_net_ops_for_exit()` | 同族事件：`pip-stdout`、`term-data`、`debug-stdout`、`lsp-stderr` |
| 进程管理 | `util.rs:96/103 no_window()`、`:125 kill_process_tree`、`:150 _async`、`:202 kill_pid_tree`、`:227 kill_pty_tree`、`:109 unpoison()`；**无全局句柄表**，各域自建 `PerWindow<...>`，`lib.rs:305-319 RunEvent::Exit` 统一调 `*_for_exit()` | 新模块**必须照做** |
| Python 求值桥 | `lib_cmds.rs:171 py_eval(workspace_root, kind, args_json)`：kind 白名单 `SCRIPTS`(`:30-35`) → `resolve_interpreter`(`:75`) → `python -I -X utf8 -c`，args 走 stdin → `env_cmds::run_with_timeout_bytes`(`:394`)；超时 3s/5s/8s(`:38-42`)；错误码 `NoInterpreter/Timeout/BadKind/ScriptError` | 实测 126ms（缓存后 179ms）vs `uv run` 475ms |
| 持久化 | 工作区 config：`env_cmds.rs:85 workspace_config_path` = `opencharm_home()/workspaces/<project_hash>.json`；`load_config(root)`(`:90`，缺失/损坏返回 `{}`) + `save_config(root,&Value)`(`:100`)。同文件已有 `interpreter` / `run_configs` / `framework_hints` / `dep_ignored` / `import_aliases` | 新增 `db_connections` / `http_history` 直接走这对函数 |
| 全局设置 | `settings.rs:104 settings_path()` = `<data_root>/config/settings.json`；`Settings`(`:110`) `#[serde(default)]`，加字段 + 同步前端 `state.ts DEFAULT_SETTINGS` | 漂移锁 `__tests__/keybindings.test.ts:118` |
| 事件定向 | 统一 `app.emit_to(window_label, ...)`（`per_window.rs`，`WindowKey` = window label）。**新增事件必须带 wid** | 仅 `plugins-dir-changed` 用全局 emit |
| 安全守卫 | `git_cmds.rs:325 validate_repo_relative`（拒绝对/拒 `..`/canonicalize 后须 `starts_with(root)`）、`:1451 validate_clone_url`（scheme 白名单）、`:1471 validate_clone_target` | **无 SSRF 防护**，B4 需新写 |
| 编辑器扩展点 | `util.ts:60 languageOf(path)`（`:72-85` map，已有 `sql:"sql"`）；自定义语言先例 `monaco.ts:80-105`（json 的 `languages.register` + `setMonarchTokensProvider`）；Monaco 自带 `basic-languages/http` contribution | B3 的 SQL 编辑器照 `monaco.ts:80-105`；**B4 形态改版后不再需要 `.http` 语言注册**（§5.8） |
| 第二个 Monaco 实例先例 | `splitEditor.ts:49 app.monaco.editor.create($("split-editor-host"), {...})` | B3 SQL 编辑器照抄此形态 |

---

## 2. 通用纪律（四个功能都适用）

1. **架构铁律**：所有新能力走 `invoke` → Rust 命令（子进程/库），**不侵入** Pyrefly / Monaco / Tauri 源码；自研组件保持可独立移除。
2. **纯函数优先、可单测**：解析 / 分类 / 格式化 / 路径校验一律抽成无 DOM 无 `state` 依赖的纯函数，测试放 `shell/src/__tests__/<模块>.test.ts`（`// @vitest-environment happy-dom` 起头）；Rust 侧 `*_impl` + `#[cfg(test)] mod tests` 置于文件末尾。
3. **设置项三步接线**：`state.ts` `Settings` 接口 + `DEFAULT_SETTINGS` → `settingsPanel.ts` 元素声明（`lazyEl`）+ 回填（apply）+ 收集（save）→ `index.html` 控件；前端用 `!== false` 兼容旧配置；Rust `Settings::default` 同步。
4. **i18n 五步**：`locales/zh-CN/<域>.ts`（真源）→ `zh-CN/index.ts` 双处展开（`:30` `zhCN` + `:33` `zhDomains`）→ `en-US/<域>.ts` + `en-US/index.ts` → `core.ts` 静态骨架 key → 工具 `shell/tools/i18n/`（`scan_ts.py` → `apply_ts.py --map data/<ns>_map.json --ns <ns>` → `gen_domain.py`）。**zh-CN 是真源，`TKey = keyof typeof zhCN`，漏译在 tsc 阶段报错**。
5. **键位三处同步**：`keybindingDefaults.ts:9-99` 联合类型 + `:101+` `KEYBINDING_META` + Rust `default_keybindings`（漂移锁兜底）；`state.ts:121 defaultKeybindings()` 派生，无需手写。
6. **事件必须定向**：新增 Rust 事件取 `window.label()` 走 `emit_to`，禁全局 `emit`。
7. **退出清理**：新增持有资源的模块必须提供 `*_for_exit()` 并在 `lib.rs:305-319` `RunEvent::Exit` 注册。
8. **依赖纪律**：新增 Rust/npm 依赖须同步写入 `ci/versions.toml` 与锁文件（`Cargo.lock` 已纳入版本锁定；`package.json` 精确锁定照 Monaco 0.52.2 先例）；**禁 CDN**（Mermaid 必须本地打包）。
9. **样式纪律**：新增样式一律走 token，禁止裸色值 / 裸字号 / 裸圆角；不得往 `main.ts`（2,839 行）堆逻辑，交互落到功能域模块。
10. **E2E**：spec 放 `shell/e2e/<域>/NN-<主题>.spec.ts`（域目录已有 `git/ ux/ dx/ editor/ lsp/ libs/ p3/ p4/ session/ autosave/ perf/ debug/ plugins/`）；mock 桩加到 `shell/e2e/mocks/tauri-mock.js`（**必须纯 JS**，数组型返回 `[]` 而非 `null`，见 `:102` 注释）。
11. **门禁**：每次 PR 跑 `npx tsc --noEmit` + `npm run test`（vitest）+ `cargo test` + 对应 e2e；主干开发 + 短分支 PR，CI 全绿才可合并。

---

## 3. 选型决策（待产品负责人拍板）

### 决策 1 · B3 的 SQLite 引擎

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A · rusqlite（bundled）**（推荐） | `Cargo.toml` 加 `rusqlite = { version = "0.3x", features = ["bundled"] }`，新增 `db_cmds.rs` | 原生速度、可分页、**可取消**（`Connection::interrupt_handle()`）、无解释器依赖、可只读打开（`SQLITE_OPEN_READ_ONLY`） | 新依赖；bundled 需编译 SQLite C 源码（首次 +1~3 分钟）→ **需在 PR-1 先验证 CI（windows-latest, MSVC）能过**；安装包体积 +1~2 MB |
| B · Python 求值桥 + `sqlite3` | 复用 `lib_cmds.rs::py_eval`，kind 白名单加 `sqlite_query` | **零新依赖**；Python 标准库自带 sqlite3，用户环境必有 | 每次查询 spawn 进程（126ms 直连 / 475ms `uv run`）；**取消难**（只能杀进程）；结果 JSON 传输有上限；无法持有长事务 |

**推荐 A**：数据库工具是**交互式**的（浏览表、翻页、点字段），方案 B 的每次进程往返与不可取消会直接毁掉体验。方案 B 保留为"无 bundled 编译环境时的降级路径"，不实现。

### 决策 2 · B4 的请求执行方式（**已定案 A**，2026-10-05）

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A · reqwest**（推荐） | 加 `reqwest = { version = "0.12", default-features = false, features = ["json","stream","rustls-tls"] }`，新增 `http_cmds.rs` | 原生、可取消、可流式进度、超时可控、不依赖用户 venv、无需装 httpx | 新依赖（+2~4 MB，编译时间增加）；需自己处理代理 / 重定向 / 编码 |
| B · Python 求值桥 + httpx | `py_eval` kind 加 `http_send`，用工作区 `.venv` 的 httpx | 零新依赖；**复用用户自己的环境**（会话、证书、代理配置与真实脚本一致，对爬虫场景有真实价值） | 需解释器 + venv 内有 httpx；取消难；流式难；错误映射复杂 |
| C · 前端 `fetch` | WebView2 内 fetch | 零依赖 | CORS / 证书 / 代理 / 流式全部受限，且拿不到真实耗时与重定向链 —— **否决** |

**已定案 A（2026-10-05）**。方案 B 原本列为 v1.1 可选增强（"用项目 venv 发送"，对标 JetBrains 的 run-with-interpreter），随形态改版**一并取消排期**——面板驱动下"复用用户 venv 的会话/证书/代理"价值大幅下降，而 py_eval 的 3/5/8s 超时档位对 HTTP 请求天然不适配。v1 命令接口仍预留 `engine: "native" | "python"` 字段（仅 `native` 生效），避免日后破坏性变更（沿用插件系统 §9.10 的预留字段先例）。

### 决策 3 · B3 的写权限

**建议默认只读**：`db_open` 默认 `SQLITE_OPEN_READ_ONLY`；写语句（`INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/PRAGMA` 写入类）需：① 连接显式开启"可写"开关；② 执行前弹确认框显示语句；③ 结果提示影响行数。
理由：自用工具最怕手滑；只读打开还能避免锁库（SQLite 单写者限制）与 WAL 污染。

### 决策 4 · B6 的 Mermaid 打包

- **懒加载**：`markdownPreview.ts` 检测到 ```mermaid 代码块时才 `await import("mermaid")`，首屏零成本、无图文档完全不加载。
- 体积控制：mermaid 完整包较大（约 2~3 MB min），可接受（本地打包，不进首屏关键路径）。
- DOMPurify 需放行 `svg` 及其子元素、`class` / `style` 属性；渲染失败降级为「渲染失败」提示 + 保留源码代码块（对齐 `sanitizeHtml` 的既有兜底哲学）。

### 决策 5 · B4 的交互形态（**已定案**，2026-10-05）

> 背景：B4 的**文件驱动**形态（`.http` + `http-client.env.json` 落在项目目录、编辑器右键发送）已实现一版后被产品负责人否决并撤销。核心诉求是「**随时可以发 HTTP 请求，且不在当前项目目录下落文件**」——这是范式级变更，不是细节修正。

**5-1 · 载体选择**：

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A · devtools 内置工具**（**已定案**） | 在 `devtools/builtin/` 加一个 `http.ts`，走既有 manifest + `registerBuiltinPlugin` 路径 | `Ctrl+Shift+T` **随时唤起**（`keybindingDefaults.ts:159`）；框架完备（`kit.ts` UI 积木 / `host.storage` 持久化 / inline 模式）；**零新增入口接线**；未打开工作区也能用 | 面板高度有限（响应区需滚动/折叠）；**切走工具即 dispose**，在途请求必须取消、状态必须自行持久化 |
| B · 底部面板新 tab | `termUi.ts` 加第 6 个 tab | 空间大、可常驻、能与输出/终端并列 | 底部已有 5 个 tab，再挤；接线 4 处且 `resetOutputChannelUi()` 漏改会状态残留（§10 已登记） |
| C · 侧栏新视图 | `views.ts` 加第 8 个 | 与 database/todo 同构 | Activity Bar 已 7 项；侧栏窄，放不下请求 + 响应双栏 —— **否决** |
| D · 独立浮窗 + 全局快捷键 | 模态窗口 | 最像"随手一发" | 新窗口管理成本（`window_mgr.rs`）；与 devtools 面板职责重叠 |

**5-2 · `.http` 文件：不做**（含"导出为 `.http`" / "导入 `.http`" 两个动作一并取消）。理由：主形态既然不是文件驱动，保留导入导出只会重新引入"文件从哪来、存哪去"的问题，与诉求直接冲突。

**5-3 · SSE / 流式：v1 不做**。响应一律取完整结果（`reqwest` 的 `.text()`/`.bytes()`），不做增量渲染与 `text/event-stream` 解析。**列为 v1.1 首位候选**——若实测出现"拿它调 LLM 的 OpenAI 兼容接口"的场景，提前到 v1.1 第一个 PR。

---

## 4. B3 · SQLite 数据库工具（8~10 人日，4 个 PR）

### 4.1 交互形态

> **专项开发文档已产出**：`docs/sqlite_tool_dev_plan.md`（交互细节、数据契约、i18n 词条表、4 个 PR 排期与测试门禁）。本节保留总览，实施以专项文档为准。

侧栏新增 Activity Bar 项「数据库」（图标 `codicon-database`，已确认存在），面板结构：

```
┌ 连接： [下拉 ▾] [+] [🗑] [刷新]        ← 连接管理
├ 对象树（可折叠）
│   ▸ 表 (12)      → 展开列名 + 类型 + PK/NN
│   ▸ 视图 (2)
│   ▸ 索引 (5)
├ [SQL 编辑器]（Monaco 小实例，懒创建，Ctrl+Enter 执行）
├ 结果网格：列名 sticky、行号列、NULL 斜体、BLOB 显示 <blob 1.2 KB>
│   分页： [← 1/8 →] 每页 200 ▾   [导出 CSV] [取消]
└ 状态条：耗时 12ms · 200/1,543 行 · 只读模式
```

快捷操作（右键对象树节点）：查看前 100 行 / 查看表结构（DDL，来自 `sqlite_master.sql`）/ 复制表名 / 复制 `SELECT * FROM x`。

### 4.2 数据结构

```ts
// sqliteView.ts
export interface DbColumn { name: string; declType: string; pk: boolean; notNull: boolean; }
export interface DbObject { name: string; type: "table" | "view" | "index"; sql?: string; rowCount?: number; columns?: DbColumn[]; }
export interface DbQueryResult {
  columns: string[];
  rows: string[][];          // 一律字符串化（含 NULL → null），避免 JSON 类型歧义
  truncated: boolean;
  elapsedMs: number;
  affected: number | null;   // 写语句影响行数；读语句为 null
}
export interface DbConnection { id: string; path: string; name: string; writable: boolean; }
```

### 4.3 Rust 侧（`src/db_cmds.rs`，新增）

| 命令 | 签名 | 说明 |
|---|---|---|
| `db_open` | `(app, window, path, writable) -> Result<DbOpened, String>` | 路径校验 → `Connection::open_with_flags`（只读 / 读写）→ 生成 id（`<wid>:<序号>`）→ 存入 `DB_OPS`；返回 `{id, path, name, writable}` |
| `db_close` | `(id)` | 摘除并 drop |
| `db_list_objects` | `(id) -> Result<Vec<DbObject>, String>` | 查 `sqlite_master` + `PRAGMA table_info` + `PRAGMA index_list`；`COUNT(*)` 走 `spawn_blocking` |
| `db_query` | `(id, sql, limit, offset) -> Result<DbQueryResult, String>` | 见下 |
| `db_cancel` | `(id)` | 置 `Arc<AtomicBool>` + `InterruptHandle::interrupt()` |
| `db_ddl` | `(id, name) -> Result<String, String>` | 取 `sqlite_master.sql` |

**纯函数（单测目标）**：
- `validate_db_path(root: Option<&str>, path: &str) -> Result<PathBuf, String>`：非空、绝对路径、canonicalize、扩展名白名单 `.sqlite/.sqlite3/.db/.db3`、存在性；若提供 root 且文件位于工作区内则额外走 `starts_with(root)`（抄 `validate_repo_relative` 思路）；
- `classify_sql(sql: &str) -> SqlKind { Read, Write, Unknown }`：去注释/字符串后按首个有效关键字判定（读：`SELECT/WITH/PRAGMA(读)/EXPLAIN`；写：`INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/REPLACE`）；`Unknown` 按写处理（保守）；
- `truncate_rows(rows, limit) -> (rows, truncated)`。

**执行模型**（抄 `git_cmds.rs:760-909` 的形状，但换成库调用）：
```rust
static DB_OPS: LazyLock<PerWindow<HashMap<String, DbOp>>> = ...;
struct DbOp { conn: Arc<Mutex<Connection>>, interrupt: InterruptHandle, cancel: Arc<AtomicBool> }
```
`db_query` 流程：判 `SqlKind` → 只读模式下 `Write` 直接拒绝 → `spawn_blocking` 跑查询（逐行 `row.get::<_, String>()`，NULL → 占位）→ 主线程轮询 `cancel`（100ms）+ `interrupt()` → 结果裁剪到 `limit`（默认 200，硬上限 1000）→ 返回。
事件：暂不需要流式事件；若后续要"大查询进度"再补 `db-op-progress`。
**退出清理**：`db_stop_for_exit()` 遍历 `DB_OPS` 全部 close，`lib.rs:305-319` 注册。

### 4.4 前端

- 新增 `shell/src/sqliteView.ts`（视图主体，约 500~700 行）+ `shell/src/sqliteGrid.ts`（纯渲染/格式化，可单测）+ `shell/src/__tests__/sqliteView.test.ts`。
- 接线：`views.ts:5` 加 `"database"`；`index.html` Activity Bar 按钮 + `#view-database` 容器；`main.ts:2653` 区 `registerSidebarView({ id:"database", rootId:"view-database", tabId:"tab-database", onShow })` + 点击绑定；`style.css` 新段（网格 / 树 / 工具条）。
- SQL 编辑器：懒创建 Monaco 小实例（照 `splitEditor.ts:49`），语言 `sql`（`util.ts:72` 已有映射），`Ctrl+Enter` 执行、`Shift+Ctrl+Enter` 执行全部；**视图隐藏时不销毁、切工作区时 dispose**（避免 worker 泄漏）。
- 持久化：连接列表写工作区 config `db_connections`（`load_config`/`save_config`）；上次查询写 `db_sql_history`（上限 20）。
- 设置项（新增 2 个）：`db_default_page_size`（默认 200，可选 100/200/500/1000）、`db_warn_on_write`（默认 true，写语句二次确认）。
- i18n 新域 `database`。
- 命令面板：新增 2 条（"数据库：打开连接" / "数据库：新建查询"），`main.ts:1526-1570` 命令表注入。

### 4.5 PR 切分

| PR | 内容 | 涉及文件 | 量级 | 验收 |
|---|---|---|---|---|
| **PR-B3-1** | **加依赖 + 打通 CI**：`Cargo.toml` 加 rusqlite(bundled)、`db_cmds.rs` 骨架（open/close + `validate_db_path` 纯函数）、`lib.rs` mod + handler + Exit 清理 | `Cargo.toml`、`src/db_cmds.rs`、`src/lib.rs`、`ci/versions.toml` | 1 天 | **CI（windows-latest）能编过**；`cargo test` 新增 ≥5 例（路径校验正反、扩展名白名单、符号链接） |
| **PR-B3-2** | 查询内核：`list_objects` / `query` / `cancel` / `ddl` + `classify_sql` / `truncate_rows` 纯函数 + 取消与清理 | `src/db_cmds.rs` | 2 天 | `cargo test` 新增 ≥10 例（含 `classify_sql` 注释/字符串对抗样本、只读模式拒写、分页裁剪） |
| **PR-B3-3** | 前端骨架：侧栏视图注册 + 连接管理 + 对象树 + i18n + mock 桩 | `views.ts`、`index.html`、`main.ts`、`src/sqliteView.ts`、`style.css`、`i18n/`、`e2e/mocks/tauri-mock.js` | 2 天 | tsc 0 错、vitest 全绿、新增 `sqliteView.test.ts` ≥6 例 |
| **PR-B3-4** | SQL 编辑器 + 结果网格 + 分页 + 取消 + 导出 CSV + 右键快捷 + e2e | 同上 + `sqliteGrid.ts` | 2~3 天 | e2e 新域 `shell/e2e/db/01-basic.spec.ts` ≥6 条（mock 桩返回固定库）；真机手测：打开真实 .sqlite 文件浏览/翻页/只读拒写 |

### 4.6 已知边界与不做

- **不做**：其他数据库（Postgres/MySQL）、ER 图、数据编辑（单元格改写）、导入向导、查询计划可视化。
- 边界：BLOB 只显示大小不预览；大表 `COUNT(*)` 可能慢（异步 + 可取消即可）；加密库（SQLCipher）不支持；网络路径/WAL 库以只读打开可能读到旧快照（提示即可）。

---

## 5. B4 · HTTP Client（4.5~6 人日，3 个 PR）

> **形态已改版（2026-10-05，见 §3 决策 5）**：devtools **内置工具**、面板驱动、`Ctrl+Shift+T` 随时唤起；**不在工作区目录创建或写入任何文件**；**不做 `.http` 文件**；**v1 不做 SSE**。本节为 v2，整体取代 v1.1 的文件驱动方案。

### 5.1 交互形态

入口只有一个：`Ctrl+Shift+T` → picker 选「HTTP 请求」（`openDevToolsPanel()`，键位见 `keybindingDefaults.ts:159`）；另在 manifest 注册 **inline 模式**（`contributes.tools[].inline`），编辑器选中一段 curl 或 URL 时可就地发送。

面板布局（上请求 / 下响应，竖排以适配 devtools 面板高度）：

```
[GET ▾] [https://api.example.com/users?page=2      ] [发送] [取消]
 方法下拉  URL（支持 {{var}}）                        Ctrl+Enter
┌ 请求 ────────────────────────────────────────────────────────┐
│ 头 (2)  X-Token: {{token}}                          [+ 一行]  │
│ 体      {"name": "x"}                                         │
└──────────────────────────────────────────────────────────────┘
┌ 响应 ────────────────────────────────────────────────────────┐
│ 200 OK · 312 ms · 4.2 KB        [复制] [保存] [复制为 curl]     │
│ ├ Headers（表格，可折叠）                                      │
│ └ Body：JSON（折叠树）/ 文本 / 图片预览 / 二进制提示             │
└──────────────────────────────────────────────────────────────┘
历史（最近 20 次，点击回填） · 环境 [dev ▾] · [粘贴 curl 导入]
```

- **发送中**（细节见 §5.7.2）：顶部细进度条 + 发送按钮转圈禁用 + **上一次响应保留并灰显** + 状态行滚动显示「已用 1.2 s / 已收 128 KB」，右侧「取消」；
- **单块草稿 + 历史回填**，不做多标签草稿（列 v1.1）：面板高度有限，"随手改随手发"场景下多标签收益低于其布局成本；
- 响应保存：点「保存」→ 系统保存对话框，记住上次目录，**绝不默认项目根**；
- 变量：`{{var}}` 引用全局环境（`{"dev": {...}, "prod": {...}}`），环境切换下拉；
- **curl 导入**：URL 框粘进 curl 命令 → 自动拆成 method/URL/头/body（复用 `devtools/curl2python/parse.ts:139 parseCurl`，零新解析代码）；
- **端点视图联动**（PR-B4-3）：`endpointView.ts` 条目右键「在 HTTP 工具中打开」→ `lastServiceBaseUrl() + route` 预填（该视图已有 route 扫描与 base URL 记忆，后端零改动）。

### 5.2 数据落点（**"不落文件到项目目录"的执行依据**）

| 数据 | 落点 | 机制 |
|---|---|---|
| 请求草稿、发送历史、当前环境名 | **localStorage**，经 `host.storage`（`extensions/facade.ts:111-121`，按插件 id 命名空间隔离） | manifest 声明权限 `"storage"`；**零 Rust 命令**；物理落盘在 WebView2 用户数据目录 `opencharm_home()/webview`（`util.rs:85`），与项目目录无关 |
| 环境变量 / token | 同上，独立 key | 受 `http_save_tokens` 开关约束（默认开；关闭时敏感值**不落盘**，仅存活于本次会话） |
| 响应导出 | 用户显式点「保存」→ 系统保存对话框 | 走既有 `fs_cmds::write_file`，**不新增命令** |
| 未打开工作区时 | 同 localStorage，key 前缀 `global` | `host.workspaceRoot()` 返回 `null` 时的兜底（**必须实现**，否则"随时"在无项目时失效） |

- **按工作区隔离（v1 建议做）**：key 形如 `drafts:<hash(workspaceRoot)>`，无工作区用 `drafts:global`。hash 只需稳定，**不必与 Rust 的 `project_hash` 对齐**（前端自算即可，避免为对齐引入新 IPC）。
- **红线**：v1 不得在工作区目录下创建/写入任何文件（唯一例外是用户显式保存响应并自选路径）；不得引入 `http-client.env.json` 之类的工作区级配置文件。
- 备选（若日后要求跨设备/备份）：改走 Rust `load_config` / `save_config`（`env_cmds.rs:85-101`，`<data_root>/workspaces/<hash>.json`）+ 全局 `http_envs.json`，代价是新增 2~4 个薄命令。**v1 不采纳**。

### 5.3 Rust 侧（`src/http_cmds.rs`，新增）

| 命令 | 签名 | 说明 |
|---|---|---|
| `http_send` | `(app, window, req: HttpRequestJson, op_id: String) -> Result<HttpResponse, String>` | 见下 |
| `http_cancel` | `(op_id)` | 置 `Arc<AtomicBool>` |

**持久化命令一个都不新增**（数据全走 `host.storage`，见 §5.2）；响应保存复用 `fs_cmds::write_file`。

请求入参：`{ method, url, headers: [[k,v]], body: string|null, timeout_ms, follow_redirects, max_redirects }`
响应出参：`{ status, status_text, headers: [[k,v]], body: string, bytes, elapsed_ms, redirect_chain: string[], truncated, private_target }`

**执行模型**（照 `git_cmds.rs:760-909` 的形状）：
```rust
static HTTP_OPS: LazyLock<PerWindow<HashMap<String, Arc<AtomicBool>>>> = ...;
```
- `reqwest::Client::builder()` 全局 `LazyLock` 复用 + `rustls-tls` + 默认超时（30s，可配）+ 重定向策略（默认跟随上限 10）；
- body > 5 MB 截断并置 `truncated`（防止把几十 MB 塞进 IPC）；非 UTF-8 / 二进制响应体按 `Content-Type` 判定，二进制只回元信息；
- 下载进度事件 `http-op-progress`（payload `{op_id, received, total?}`），`emit_to(window.label(), ...)`；
- 取消：`spawn` 中轮询 `cancel` 标志（v1 可接受"取消不保证即时生效"）；**工具 dispose 时必须调 `http_cancel`**（见 §5.6 边界第 1 条）；
- **退出清理**：`http_stop_for_exit()`，`lib.rs:305-319` 注册。

**纯函数（单测目标）**：
- `validate_http_url(url) -> Result<Url, String>`：scheme 白名单 `http`/`https`（抄 `git_cmds.rs:1451 validate_clone_url` 形态）；拒空 host；**SSRF 提示**（对 `localhost` / `127.0.0.0/8` / `10./172.16-31./192.168.` / `.local` 不拦截，但在响应里带 `private_target: true` 供前端提示——自用工具不拦，知情即可）；
- `sanitize_header_name(name)`：拒绝含 `\r\n` / 空字节（防头注入）；剔除 `content-length` / `host` 等由客户端计算的头；
- `truncate_body(bytes, limit)`。

### 5.4 前端

#### 5.4.1 必须先补的架构缺口：facade 的 `net` 权限门控

**这是 PR-B4-1 不可跳过的一步。** 插件/内置工具拿不到 `invoke`（`extensions/facade.ts:3` 注释：facade 是唯一通道），而 `KNOWN_PERMISSIONS`（`manifest.ts:48`）为 `["clipboard","selection","fs:read","storage","monaco"]`，**没有网络权限**。若不补，内置工具只能绕过 facade 直接 import `@tauri-apps/api/core`，破坏"插件唯一通道"这条架构铁律（§2 纪律 1 同源），还给第三方插件开了口子。

1. `manifest.ts:48` `KNOWN_PERMISSIONS` 追加 `"net"`（同步 `KNOWN_PERMISSIONS` 相关单测）；
2. `facade.ts` 的 `BaseHost`（`:21-39`）追加受门控的网络能力，**写法照 `:111-121` 的 storage**：
   ```ts
   http: {
     send(req: HttpRequestJson): Promise<HttpResponse>;
     cancel(opId: string): Promise<void>;
   }
   ```
   内部 `requirePerm(perms, "net", "http.send")` 后 `invoke("http_send", ...)`；
3. 内置工具 manifest 声明 `permissions: ["storage", "net"]`（内置工具权限默认授予，见 `builtin/index.ts:9`）。

#### 5.4.2 工具实现

- 新增 `shell/src/devtools/builtin/http.ts`（工具主体，约 400~600 行）+ `devtools/builtin/httpRequest.ts`（纯函数：变量替换 / curl→请求 / 响应体分类 / 历史裁剪，可单测）。
- 注册：`builtin/index.ts` 加 `import * as http from "./http"` + `BUILTIN_TOOL_MODULES` 加 `"./http.ts"` + manifest 表加一项（`id: "http"`，`category` 建议「网络」，`icon` 取 codicon（**开工前确认图标名存在**），`inline: { label, handler }`）。
- UI 积木全部走 `kit.ts`（`body` / `row` / `toolbar` / `input` / `textarea` / `output` / `primaryButton` / `copyButton` / `errorSlot` / `flash` / `radioGroup`）。**kit 无 `select`**：方法下拉用原生 `<select>`，样式照 `style.css` 现有 `.todo-group-mode` 下拉先例（全 token）；头表格 kit 无对应积木，手写 DOM（同样走 token，过 `audit_tokens.py`）。
- **状态机与 loading**：`HttpUiState` + `render(s)` 单点驱动（§5.7.1）；按钮忙碌态走 `util.ts:319 setBusy`、转圈用 `util.ts:314 spinIcon()`、空态用 `util.ts:116 emptyState(icon, title, hint, true)`；**禁止自造 `btn.disabled` 与整面板遮罩**。devtools 现有工具全是同步计算，本工具是域内第一个异步 + 可取消的，所有异步细节一律照 §5.7 执行。
- 响应 JSON 折叠树：**参考** `devtools/jsonpath/tree.ts` 的形态（同域复用；不抽公共 `jsonTree.ts` —— 抽公共需同时改 devtools 与 http 两处，收益不成立）。
- i18n：走**既有 `devtools` 域**（`locales/zh-CN/devtools.ts`，新增 `devtools.http.*`），**不新建域**；zh-CN 真源 → en-US → `core.ts` 骨架 → `tools/i18n` 流程（§2 纪律 4）。
- 持久化：`host.storage.get/set`（key 见 §5.2）；上限：草稿 30、历史 20（**历史不存 body**）。
- 设置项（3 个）：`http_timeout_ms`（默认 30000）、`http_follow_redirects`（默认 true）、`http_save_tokens`（默认 true）；三步接线（§2 纪律 3）。
- 单测：`devtools/builtin/__tests__/http.test.ts`（`// @vitest-environment happy-dom` 起头）。
- e2e：新域 `shell/e2e/http/01-devtools.spec.ts`；`tauri-mock.js` 加 `http_send` 桩返回罐头响应，**全程离线、禁止真网络请求**。

### 5.5 PR 切分

| PR | 内容 | 涉及文件 | 量级 | 验收 |
|---|---|---|---|---|
| **PR-B4-1** | **加依赖 + 打通 CI**：`reqwest` + `http_cmds.rs`（send/cancel + `http-op-progress` 进度事件 + `validate_http_url` / `sanitize_header_name` / `truncate_body`）+ Exit 清理；**另补 facade `net` 权限门控**（`KNOWN_PERMISSIONS` + `BaseHost.http`） | `Cargo.toml`、`src/http_cmds.rs`、`src/lib.rs`、`ci/versions.toml`、`src/extensions/{manifest,facade}.ts` | 2 天 | **CI（windows-latest）编过**；`cargo test` ≥8 例（scheme 白名单、头注入、截断、私网标记）；vitest 新增 facade 权限用例 ≥3（无 net 声明 → 抛 `PermissionDeniedError`） |
| **PR-B4-2** | devtools 内置工具：请求编辑（方法/URL/头/体）+ 发送/取消 + 响应（状态/耗时/头表 + JSON 折叠树）+ i18n + mock 桩 + e2e | `devtools/builtin/http.ts`、`httpRequest.ts`、`__tests__/http.test.ts`、`builtin/index.ts`、`style.css`、`i18n/locales/{zh-CN,en-US}/devtools.ts`、`e2e/mocks/tauri-mock.js`、`e2e/http/01-devtools.spec.ts` | 2.5 天 | tsc 0 错、vitest 全绿、`http.test.ts` ≥8 例（含 `formatElapsed` / `formatBytes` / `classifyStatus` 边界 ≥6 例）；e2e ≥6 条 + **loading 态专项 ≥2 条**（`__E2E_HTTP_DELAY_MS__` 下断言：细进度条可见 / 发送按钮 disabled / 陈旧结果灰显 / 取消后回落 idle）；UI token 审计无新增裸值；**「减少动画」开启下转圈不转**（手工验一次，见 §5.7.2） |
| **PR-B4-3** | 变量/全局环境 + 历史（storage）+ curl 粘贴导入（复用 `parseCurl`）+ 响应保存 + 端点视图联动 + 真机冒烟 | `devtools/builtin/http.ts`、`httpRequest.ts`、`endpointView.ts`、`devtools/curl2python/parse.ts`（只读复用） | 1~1.5 天 | 新增用例 ≥4；真机手测：本地起 `python -m http.server` 发一次（**避免外网依赖**）+ 粘贴一段 curl 导入并成功发送 |

### 5.6 已知边界与不做

- **不做**：`.http` 文件（含"导出为 `.http`" / "导入 `.http`"，决策 5-2）、**SSE / 流式**（决策 5-3）、多标签草稿、Cookie 持久化 / 会话管理、请求脚本（pre-request JS）、GraphQL 专用面板、WebSocket、gRPC、认证向导（OAuth）。
- 边界：
  1. **工具切走即 dispose**：在途请求必须 `http_cancel` 并丢弃回包（否则响应回来要写已卸载 DOM）；切回时从 storage 恢复最后一次结果与草稿。
  2. 面板高度有限：响应区独立滚动，JSON 树默认折叠到第 2 层。
  3. token 明文落 localStorage：`http_save_tokens` 关闭时不持久化；首次使用给一次提示（不打断）。
  4. multipart 表单 v1 用原始 body 手写；证书校验不提供关闭开关；代理仅读系统环境变量（`HTTP_PROXY`/`HTTPS_PROXY`），不做 UI 配置。
  5. 大响应（> 5 MB）截断展示，头部提示"已截断"。
- **v1.1 候选（按序）**：① SSE / 流式渲染（决策 5-3 明确列为首位）；② 多标签草稿；③ Cookie 会话；④ 按工作区绑定改走 Rust config（§5.2 备选）。

### 5.7 交互细节与状态机

> devtools 现有 24 个内置工具**全是同步计算**（输入 → 即时产出），HTTP 工具是域内**第一个异步 + 可取消**的工具：loading / 竞态 / 取消这三件事**没有同域先例可抄**，本节把口径一次定死。下面每条都指向项目里已有的实现依据，照抄即可，不要新造一套。

#### 5.7.1 状态机（渲染的唯一真源）

```ts
type HttpPhase = "idle" | "sending" | "cancelling" | "ok" | "err";

interface HttpUiState {
  phase: HttpPhase;
  opId: number;                      // 本次发送令牌（单调自增）
  startedAt: number | null;          // 耗时计时起点
  lastResult: HttpResponse | null;   // 上一次结果（发送中保留并灰显）
  error: string | null;
}
```

**纪律**：所有 UI 变化由 `render(s: HttpUiState)` **单点驱动**（照 `endpointView::renderEndpointPanel` 的形态），**禁止在 invoke 的 then/catch 里零散改 DOM**——取消与竞态一进来就散架。

#### 5.7.2 loading 形态（沿用既有约定，不新造）

| 元素 | 做法 | 依据 |
|---|---|---|
| 进度指示 | **顶部 2px 细进度条**，不用 spinner、不用遮罩 | `style.css:5459` 注释（libEval §11.2「不要 spinner」）；可照 `.rx-progress` 写 |
| 陈旧结果 | 发送中**保留上一次响应并灰显**（不清空、不闪） | `.rx-eval-zone.is-stale`（opacity .55） |
| 发送按钮 | `setBusy(sendBtn, true, t("devtools.http.sending"))` | `util.ts:319`（CR-27 收敛的跨域范式：内联转圈 + 禁用 + 自动恢复原文案）。**不要自己写 `btn.disabled = ...`** |
| 取消按钮 | 常驻；仅 `sending` 时 enabled，`cancelling` 时 disabled 且文案改「取消中…」 | — |
| 耗时 | 状态行每 200ms 刷新「已用 1.2 s」；离开 `sending` 必须 `clearInterval` | 纯函数 `formatElapsed(ms)` |
| 字节进度 | `http-op-progress`：有 total 显示「1.2 / 4.0 MB」；**无 total 只显示已收字节，不显示百分比**（避免不确定的 100% 卡住） | 纯函数 `formatBytes(n)` |
| 减少动画 | 转圈用 `spinIcon()`（`util.ts:314`）；若照抄 `.rx-progress::after` 动画，**必须同时压 `html[data-reduce-motion]` 与 `@media (prefers-reduced-motion)` 两条通道** | `style.css:356/358` 已压 spin；`:5470` 注释记过一次「只压系统通道、漏压应用内开关」的返工 |

#### 5.7.3 取消与竞态（三条铁律）

1. **令牌**：每次发送 `opId = ++opToken`，回包先比对，`opId !== opToken` 直接丢弃（照 `endpointView.ts:124/135` 的 `epToken` 写法）；
2. **dispose 即作废**：工具 `dispose()` 调 `http_cancel(opId)` 并 `opToken++`，回包一律丢弃（对应 §5.6 边界第 1 条）；
3. **取消中间态**：`cancelling` 最多等 3s，超时强制回落 `idle`，状态行提示「已请求取消，请求可能仍在服务端执行」——**不弹错误**（v1 取消不保证即时生效）；`sending` 中再点「发送」直接忽略（按钮已 disabled），**不排队、不并发**。

#### 5.7.4 完成与失败

- **4xx / 5xx 不是错误态**：仍走 `ok`，只靠状态色区分（2xx 常规、3xx/4xx `degraded` 色、5xx `err` 色），文案带状态码前缀（照 `style.css` 的 `.rx-status--ok/err/degraded` 语义）。
- **err 三类**：网络不可达 / 超时 / 证书或 DNS → `kit.errorSlot()` 显示 `localizeBackendError(errMsg(e))`（照 `endpointView.ts:130`），并 `flashError(sendBtn, ...)`；**保留上一次响应（灰显）不清空**。
- ok 附加提示：`private_target` → warn 色一行「目标为内网 / 本机地址」；`truncated` → 「响应已截断（> 5 MB）」；204 / 空体 → 「无响应体」，**不渲染空白 JSON 树**。
- 纯函数（并入 `httpRequest.ts` 单测）：`formatElapsed(ms)`（0 / <1s / <60s / ≥60s 四档）、`formatBytes(n)`（0 / <1KB / <1MB / ≥1MB）、`classifyStatus(code) -> "ok" | "degraded" | "err"`。

#### 5.7.5 键盘与无障碍

- `Ctrl+Enter` 发送（请求编辑区内）；`Esc` 取消在途请求——**仅在 `sending` 阶段拦截**，其余情况放行给 devtools picker 的关闭逻辑（**开工前确认 picker 的 Esc 优先级**）。
- 响应区容器 `aria-busy`（`sending`/`cancelling` 为 `true`），状态行 `role="status"` + `aria-live="polite"`；状态**不得只靠颜色**区分（文案前缀 + 图标）。

#### 5.7.6 空态

- 从未发过请求：响应区 `emptyState("globe", t("devtools.http.emptyTitle"), t("devtools.http.emptyHint"), true)`（compact 先例见 `endpointView.ts:170`）。
- 无工作区：**功能照常可用**（HTTP 不依赖工作区），仅影响草稿 key 前缀（§5.2）。

#### 5.7.7 明确禁止

1. 禁止整面板 loading 遮罩（面板小，遮罩 ≈ 全屏闪白）；
2. 禁止发送中清空上一次响应；
3. 禁止用 `setTimeout` 假装进度（不真实反映网络状态）；
4. 禁止 sending 期间禁用 URL / 头 / 体的编辑（会挡住"改一个字重发"）——只禁用发送按钮与历史点击。

#### 5.7.8 i18n 与 mock 桩补充

- 新增 `devtools.http.*` 词条：`sending` / `cancelling` / `cancelHint` / `elapsed` / `received` / `privateTarget` / `truncated` / `noBody` / `emptyTitle` / `emptyHint` / `sendFailed` / `timeoutHint` / `ctrlEnterHint`。
- **mock 桩必须支持延迟**：`tauri-mock.js` 的 `http_send` 支持 `window.__E2E_HTTP_DELAY_MS__`（默认 0），否则 loading 态在 e2e 里根本抓不到（先例：`window.__E2E_TODO_SCAN__` 覆写）。

### 5.8 决策记录 · B4 形态改版（2026-10-05）

**发生了什么**：B4 的文件驱动形态（`.http` 语法高亮 + 发送请求 + `http-client.env.json` 环境文件）曾实现一版，产品负责人验收后否决并**整体撤销**（当前仓库 `reqwest` / `http_cmds` / `httpClient` / `httpParser` **全仓零命中**，撤销干净，可放心重来）。

**否决的三条理由**（即新形态必须满足的验收标准）：

1. **"随时发"与"先建文件"冲突** —— 每次试接口都要先建文件、起名、想放哪，这个摩擦就是不要的东西本身；
2. **项目目录落文件的三重代价** —— 进 git 状态（还得记得 `.gitignore`）、`http-client.env.json` 里的 token 有泄露面、新建文件会触发 `watcher.rs` 与索引；
3. **侧栏已 7 个视图**（`files/search/todo/endpoints/git/debug/database`），Activity Bar 再加项是纯负担。

**拍板结论**：载体 = devtools 内置工具（§3 决策 5-1 A）；`.http` 文件彻底不做（5-2）；v1 不做 SSE（5-3）。

**从撤销版本里保留下来的有效资产**（不必重新论证）：`reqwest` 选型与其取消/流式/超时模型；`validate_http_url` 的 scheme 白名单与 SSRF `private_target` 标记口径；`sanitize_header_name` 防头注入；5 MB 截断阈值；`http-op-progress` 事件与 `emit_to` 定向；e2e 强制 mock 桩。**丢掉的只有文件驱动那一层**（语言注册、`###` 分隔语义、工作区环境文件、编辑器右键入口）。

**量级变化**：7~9 人日 → **4.5~6 人日**；PR 数 4 → **3**（原 PR-B4-1 的 `.http` 语言注册与解析器整块删除，原 PR-B4-4 的 curl 互转缩为 PR-B4-3 内的一个子项）。

### 5.9 交付记录 · PR-B4-1（2026-10-05）

**范围**：Rust 请求内核 + facade `net` 权限门控。**无前端 UI**（工具 UI 在 PR-B4-2）。

| 文件 | 改动 |
|---|---|
| `shell/src-tauri/src/http_cmds.rs` | **新文件**（约 570 行）：`http_send` / `http_cancel` + `http-op-progress` 进度事件 + `http_stop_for_exit()`；纯函数 8 个（URL 校验 / 私网标记 / 头名 + 头值消毒 / 响应体截断 / 二进制判定 / 方法白名单 / 超时钳制 / 错误分类）；11 例单测 |
| `shell/src-tauri/Cargo.toml` | `reqwest = { version = "0.13", default-features = false, features = ["blocking", "rustls"] }` |
| `shell/src-tauri/src/lib.rs` | `mod http_cmds;` + handler 两命令 + `RunEvent::Exit` 注册 `http_stop_for_exit()` |
| `ci/versions.toml` | `[shell]` 加 `reqwest = "0.13.4"` |
| `shell/src/extensions/manifest.ts` | `KNOWN_PERMISSIONS` 追加 `"net"` |
| `shell/src/extensions/facade.ts` | `BaseHost` 新增 `http: HttpCapability`（`send` / `cancel`，**同步抛** `PermissionDeniedError`）+ `HttpRequestPayload` / `HttpResponsePayload` 类型 |
| `shell/src/extensions/__tests__/facade.test.ts` | 新增 3 例（未声明 → 抛；已声明 → 放行；`"net"` 已知而 `"nt"` 被 manifest 拒绝） |
| `shell/src-tauri/Cargo.lock` | +431 行（reqwest 及其 TLS / HTTP 栈） |

**门禁**：`cargo check` 零 error 零 warning · `cargo test http_` **11/11** · `npx tsc --noEmit` 零错 · `npm run test` **1103/1103（93 文件）**。

**实测踩坑（后续 PR 直接引用，不必重踩）**：

1. **reqwest 0.13 把 `rustls-tls` 改名成 `rustls`**（0.12 的名字会报 *does not have that feature*）；
2. **`rustls` 会拉入 `aws-lc-sys`（需 cmake）+ `ring` / `quinn` 等 30+ crate**，本机首次编译约 4 分钟。**降级路径**：构建环境无 cmake 时改 `features = ["blocking", "native-tls"]`（Windows 走 Schannel，零 C 编译；代价是 Linux 需 OpenSSL 开发库）；
3. **`PerWindow::lock()` 内部已 unpoison**（`per_window.rs:31`），调用侧**不要**再包 `unpoison(...)`（类型不匹配）；只有 `std::sync::Mutex::lock()` 才需要；
4. **`Url::parse("https:///path")` 的 host 是 `"path"`**（第三个斜杠后的段被当作域名）——测"空主机"要用 `https://` / `https:///`；
5. `MutexGuard` 临时值不得活到 struct 字面量末尾（E0597）：`redirect_chain` 必须先取成局部变量。

**执行模型落地说明**：最终选 **blocking 客户端 + `spawn_blocking`**（与 `db_cmds` / `git_cmds` 同构），而非 async + abort——后者在本项目的 `tauri::async_runtime` 下无法轮询取消标志（无 `tokio::select` 直接依赖）。代价是取消为协作式（下个分块边界生效），与 §5.7.3 已声明的 UI 口径一致。

**未做（属 PR-B4-2 / B4-3）**：devtools 工具 UI、变量与全局环境、历史、curl 粘贴导入、响应保存、端点视图联动、e2e 与 mock 桩。

### 5.10 交付记录 · PR-B4-2（2026-10-05）

**范围**：devtools 内置 HTTP 工具 UI（请求编辑 + 发送/取消 + 响应渲染 + loading 态）。变量/环境、历史、curl 导入、响应保存、端点联动仍属 PR-B4-3。

| 文件 | 改动 |
|---|---|
| `shell/src/devtools/builtin/http.ts` | **新文件**（约 470 行）：工具主体。状态机**单点驱动** `render()`；请求编辑（方法 `<select>` / URL / 头表增删 / 体）；发送与取消（3s 兜底回落）；响应渲染（状态行三档配色 / 头表折叠 / **递归 JSON 折叠树** / 图片预览 / 二进制提示 / 空体提示）；草稿经 `host.storage` 按工作区隔离；`Ctrl+Enter` 发送、`Esc` 仅在 sending 阶段拦截 |
| `shell/src/devtools/builtin/httpRequest.ts` | **新文件**：纯函数层——状态机转移 6 个（`beginSend` / `succeed` / `fail` / `cancelRequested` / `cancelSettled` / `resetHttpState`）+ 格式化 3 个 + 分类 4 个 + 草稿解析/序列化 |
| `shell/src/devtools/builtin/__tests__/httpRequest.test.ts` | **新文件**，23 例 |
| `shell/src/extensions/facade.ts` | 新增 `http.onProgress()`（Tauri event API 与 invoke 同理，插件拿不到）+ `HttpProgressPayload` |
| `shell/src/devtools/builtin/index.ts` | 工具注册（`BUILTIN_TOOL_MODULES` + manifest 两处）+ permissions 追加 `storage` / `net` |
| `shell/src/style.css` | HTTP 段：细进度条（**双通道压制** reduce-motion）、状态行、头表、JSON 树，全 token |
| `tools/ui/audit_tokens.py` | 白名单 2 条：`http-progress-slide`（循环装饰动画）、`.http-progress`（2px 高细条半宽圆角）——与 `.rx-progress` 同族同理 |
| `shell/tools/i18n/data/devtools_{zh,en}.json` | +32 条 `devtools.http.*`，经 `gen_domain.py` 重新生成两侧语言包（434 条对齐） |
| `shell/e2e/mocks/tauri-mock.js` | `http_send` / `http_cancel` 罐头桩；可覆写 `__E2E_HTTP__` / `__E2E_HTTP_DELAY_MS__`（慢响应期间自动推 `http-op-progress`）/ `__E2E_HTTP_FAIL__` / 记录 `__E2E_HTTP_LAST_REQ__` / `__E2E_HTTP_CANCELLED__` |
| `shell/e2e/http/01-devtools.spec.ts` | **新文件**，8 条（含 loading 专项 2 条：细进度条 + 按钮忙碌 + 旧响应灰显；进度文案） |
| `shell/playwright.config.ts` | **`launchOptions.args: ["--no-proxy-server"]`**（见踩坑 1，影响所有 e2e 域） |

**门禁**：`tsc --noEmit` 零错 · `npm run test` **1126/1126（94 文件）** · `e2e/http/` **8/8（57.7s）** · `e2e/todo/` 回归 **7/7** · UI token 审计全绿。

**踩坑（后续 PR 直接引用）**：

1. **e2e「跑不完」的根因是本机 MITM 代理**（本轮最大发现）：Windows 上 Chromium 走**系统代理**而非 `HTTP_PROXY` 环境变量（清 env 无效，报 `net::ERR_PROXY_CONNECTION_FAILED`），连 `localhost:5173` 都被丢给 http-divert-proxy 转发——实测单请求 0.19s（直连）→ 1.08s（代理），而 vite dev 首屏要拉数百个模块，**整轮从 ~1 分钟劣化到 9 分钟以上**。修法：`playwright.config.ts` 加 `--no-proxy-server`。
2. **`equip` 必须等到键位接线完成**：`#editor` 可见 ≠ init 完成（键位与内置工具注册在其后）。只等 `.menubar-item` 会抢在 init 前按 `Ctrl+Shift+T`，表现为 picker 打不开（照 `e2e/plugins/01-devtools-plugin.spec.ts` 的 `list_plugin_dirs` + menubar 双条件）。
3. **devtools 实例缓存**：切走的工具 DOM 仍在 `#devtools-body` 内（仅 root 被 hidden）→ 断言通用类（`.tool-error` / `.tool-textarea`）**必须限定 `.devtools-tool-root:not(.hidden)`**，否则 strict mode violation。
4. **JSON 树必须递归**渲染嵌套值，否则数组/对象在叶子里退化成 `[object Object]`（最经典的树渲染写法错误）。
5. 头表摘要要在 `input` 事件里同步——只在增删时同步会让「请求头（0）」在填完后仍是 0。
6. **错误文案必须由 `render()` 单点写入**：只在 catch 里更新 state 而不写 error 槽，会出现「状态行红了、错误槽空白」。

**与 §5.6 边界的偏差（登记）**：原写「切回时从 storage 恢复最后一次结果与草稿」，实际**只持久化草稿**——响应体最大 5 MB，localStorage 容量吃不消；切回显示空态，需重新发送。

### 5.11 交付记录 · PR-B4-3（2026-10-05）

**范围**：变量/全局环境、历史、curl 粘贴导入、响应复制与插入编辑器、端点视图联动。**B4 至此闭环**（剩余项见文末 v1.1 候选）。

| 文件 | 改动 |
|---|---|
| `devtools/builtin/httpRequest.ts` | +11 个纯函数：`resolveVariables` / `extractVarNames` / `parseVarLines` / `formatVarLines` / `parseEnvs` / `serializeEnvs` / `envVars` / `pushHistory` / `parseHistory` / `serializeHistory` / `curlToDraft`（复用 `parseCurl`，零新解析代码） |
| `devtools/builtin/__tests__/httpRequest.test.ts` | 23 → **41 例** |
| `devtools/builtin/http.ts` | 环境行（下拉 + 编辑变量）、变量区（`key=value` 编辑 + 非法行点名）、历史区（最近 20，点击回填 method+url）、curl 粘贴自动拆解、发送前变量替换（**缺失变量拦下不发**）、响应「复制 / 插入编辑器」、`setPendingHttpUrl` 预填入口 |
| `devtools/index.ts` | `openHttpTool(url)`（预填 + 打开工具） |
| `endpointView.ts` | 条目新增「在 HTTP 工具中打开」（`base + route` 预填；无 base 时提示先运行服务） |
| `style.css` | 环境下拉 / 历史行样式（全 token） |
| i18n | devtools **+22 条**、endpoints **+2 条**（均经 `gen_domain.py` 重新生成） |
| `e2e/http/01-devtools.spec.ts` | 8 → **12 条**（变量替换 / 缺失变量拦截 / curl 导入 / 历史回填） |
| `playwright.config.ts` | `--no-proxy-server`（PR-B4-2 起）+ `webServer.command` 改直接跑 vite + `gracefulShutdown` |
| `scripts/e2e-launch.mjs` + `package.json` | **新增 `npm run e2e`** 启动器（见踩坑 1） |

**门禁**：`tsc --noEmit` 零错 · `npm run test` **1144/1144（94 文件）** · `npm run e2e -- e2e/http/01-devtools.spec.ts` **12/12（88s，EXIT=0）** · `e2e/todo` 回归 **7/7（60s）** · UI token 审计全绿。

**踩坑（后续 PR 直接引用）**：

1. **`npm run e2e` 的由来**（本轮第二个大发现）：playwright 的 `webServer` 在 5173 无人监听时会自起 dev server，**关闭阶段在 Windows 上挂住** —— 用例 1 分钟跑完，进程再挂 5 分钟以上（`DEBUG=pw:webserver` 显示 `Terminating the WebServer` 之后不再前进，卡住时间还被算进 `N passed (3.2m)`）；`gracefulShutdown` 配置无效。根因：playwright 经 `cmd /c <command>` 起 server，关闭时只杀掉 cmd，vite 作为**孙进程**存活并持有 stdout 管道。**解法**：`scripts/e2e-launch.mjs` 先确保 5173 就绪再跑 playwright，命中 `reuseExistingServer` 复用路径 → 不进入「自起再关闭」，正常退出。
2. **探测本地端口用 TCP，不要用 HTTP**：本机 MITM 代理会把 localhost 的 HTTP 请求接走并返回 502（两个方向都会误判）。启动器用 `net.connect` **双栈**探测（`127.0.0.1` + `::1`）——vite 默认绑 `localhost`，Windows 上常只落在 `::1`，只探 IPv4 会假阴性。
3. **Node ≥ 18.20 拒绝在无 shell 时 spawn `.cmd`**（安全补丁）：启动器改用 `node node_modules/@playwright/test/cli.js`（与 `scripts/vitest-launch.mjs` 同一约定）。
4. **类名复用会让 e2e 断言集体 strict violation**：历史行的状态码最初复用了 `.http-code`，导致 8 条既有用例全红；改为 `.http-history-code`。

**未做（v1.1 候选，按序）**：① 响应保存到磁盘（需新增写权限 + save 对话框通道，v1 以「复制 / 插入编辑器」替代）；② SSE 流式；③ 多标签草稿；④ Cookie 会话。

**提交前复核修正（2026-10-05，独立复核 + 门禁复跑）**：

1. **瞬态提示纳入状态机**：`HttpUiState` 新增 `notice`；「发送前校验失败」与「curl 导入告警」原先直写 `errEl`（绕过 `render()`），会出现「状态行仍是 ok、错误槽却报错」且提示残留到下一次操作 —— 现全部经 `setNotice` + `render()` 单点写入。同时给 `renderResponse` 加**结果引用缓存**（`lastRendered`），避免 notice 变化时重建整棵 JSON 树。
2. **补齐 3 个设置项接线**（§5.4.2 要求，此前遗漏）：`http_timeout_ms`（档位 5/10/30/60/120 s）、`http_follow_redirects`、`http_save_tokens`；按「设置三步接线」落在 `state.ts` / `settingsPanel.ts` / `index.html`（新增**「设置 → HTTP 请求」分区**）/ Rust `Settings::default`。其中 **`http_save_tokens` 关闭时环境变量只存活本次会话**（§5.6 边界 3），并补上「首次使用只提示一次」。
3. **端点联动补在线投递**：`setPendingHttpUrl` 改为「有在线消费者则直接投递，否则挂起待下次 mount」，修掉「工具已挂载（devtools 实例缓存）时点端点不预填」的失效路径。
4. **订正取消语义注释**：点「取消」**不改变令牌**，故取消后 3 s 内到达的成功回包仍会照常显示（有意为之——结果有效，丢掉反而逼用户重发）；只有超时兜底的 `cancelSettled` 才作废令牌。原注释「已取消 → 丢弃」与实现不符。

门禁复跑：`tsc` 零错 · `npm run test` **1145/1145** · `cargo check` 通过 · `npm run e2e -- e2e/http/...` **12/12** · UI token 审计全绿。

---

## 6. B5 · 结构化运行日志视图（4~5 人日，3 个 PR）

### 6.1 交互形态

底部面板新增 tab「**运行日志**」（与 output/terminal/git 并列）：

```
[错误 3] [警告 12] [信息 148] [调试 0]   ← 级别 chips（复用 output.ts 级别层的行为）
[搜索/正则 ____] [字段: time,level,msg ▾] [自动滚动 ☐] [清空]
┌────────────────────────────────────────────────────────
│ 12:03:41.512  INFO   app.main        启动完成          ← 时间戳对齐（tabular-nums）
│ 12:03:41.880  ERROR  app.worker     ▸ {"msg":"连接失败","retry":3}   ← 可展开 JSON 字段
└────────────────────────────────────────────────────────
```

- 与「运行历史」的分工（**必须写进文档与 UI 提示**）：
  - **运行历史**（`Ctrl+Shift+R`）= 按次归档回看（20 次 × 3000 行）；
  - **运行日志** = **当前/最近一次运行的实时结构化视图**（保留最近 N 行，随新运行重置）。

### 6.2 数据来源（关键改动：单槽位 → 多播）

`termUi.ts:40 / :569 / :887 / :315` 的 `runOnData` 是**单槽位**，已被 `runHistory` 占用。改造：

```ts
// termUi.ts
type RunDataConsumer = (instanceId: string, text: string) => void;
const runDataConsumers = new Set<RunDataConsumer>();
export function addRunDataConsumer(fn: RunDataConsumer): () => void;   // 返回 dispose
// :887 处改为遍历 runDataConsumers（某个消费者抛错只 catch 该消费者，不影响其他）
```
> 注：现有回调签名只有 `(text)`；B5 需要 `instanceId` 做归属 → 顺带把 instanceId 带上（runHistory 侧同步改用带 id 的签名，或用闭包捕获——**建议传 id，便于未来扩展**）。

### 6.3 纯解析层

```ts
// logParse.ts（纯函数，零依赖）
export interface LogEntry {
  raw: string;
  ts: string | null;          // 原样保留的时间戳文本（对齐用，不做时区转换）
  level: OutputLogLevel | null;
  logger: string | null;      // `app.worker` 之类
  message: string;
  json: Record<string, unknown> | null;   // 行内嵌 JSON 对象
  extra: Record<string, unknown> | null;  // 除 time/level/msg 之外的字段
}
export function parseLogLine(line: string): LogEntry;
export function formatLogRow(e: LogEntry, fields: readonly string[]): string;
```

解析顺序（都要有对抗样本单测）：
1. 若整行是 JSON（或 `^\s*\{.*\}\s*$`）→ 取 `time|timestamp|ts` / `level|severity` / `logger|name` / `message|msg`，其余进 `extra`；
2. 否则尝试 loguru/标准 logging 前缀：`^(?<ts>[\d:\-\. T]+)\s*[|]?\s*(?<level>[A-Z]+)\s*[|]?\s*(?<logger>[\w\.]+)?\s*[:\-]\s*(?<msg>.*)$`；
3. 否则尝试 `<level>:<logger>:<msg>`（`output.ts` LEVEL_RULES 已覆盖的形态）；
4. 都不匹配 → `level = detectLogLevel(line)`（复用 `output.ts:139`），其余字段 null，**raw 原样展示**。

> 纪律：`parseLogLine` **绝不抛异常**，任何情况都要能退化成"原样一行"。

### 6.4 前端改动清单

| 文件 | 改动 |
|---|---|
| `termUi.ts` | `runOnData` → 多播 `addRunDataConsumer`（**PR-B5-1，必须最先做**）；`BottomTab` 枚举加 `"logs"`（`:69`）；三张同步表（`:114`/`:125`/`:130`）；`resetOutputChannelUi()` 复位表（`:764-781`） |
| `logView.ts`（新） | 视图主体：chips / 搜索 / 字段选择 / 自动滚动 / 清空 / 行渲染（约 400~500 行） |
| `logParse.ts`（新） | 纯解析层（可单测） |
| `output.ts` | 复用 `detectLogLevel` / `LEVEL_RULES`，**不改**（保持零 DOM 依赖可单测的现状） |
| `index.html` | 底部 tab 按钮（`:353-357` 区）+ 面板容器（`:392-405` 区） |
| `main.ts` | `addRunDataConsumer` 接线（init 首部，与既有 handler 注入同处） |
| `state.ts` / `settingsPanel.ts` / `index.html` | 设置项 `log_structured_enabled`（默认 true）、`log_max_lines`（默认 5000，沿用 `DEFAULT_MAX_OUTPUT_LINES`） |
| `style.css` | 日志网格样式（**时间戳列 `font-variant-numeric: tabular-nums`**） |
| `i18n/` | 新域 `logs` |
| `runHistory.ts` | 改用带 `instanceId` 的新回调签名（若有破坏则同步） |

### 6.5 PR 切分

| PR | 内容 | 量级 | 验收 |
|---|---|---|---|
| **PR-B5-1** | `termUi` 多播改造 + `logParse.ts` 纯解析 + 单测 | 1 天 | 多播后 **runHistory 采集不回归**（e2e `session/` 与 `autosave/` 域复跑）；`logParse.test.ts` ≥12 例（纯 JSON / loguru / 标准 logging / 无级别 / 含中文 / 嵌套 JSON / 空行 / 超长行 / 转义） |
| **PR-B5-2** | 底部 tab「运行日志」+ 渲染（级别 chips / 搜索 / JSON 展开）+ i18n | 1.5 天 | tsc 0 错、vitest 全绿；`logView.test.ts` ≥6 例 |
| **PR-B5-3** | 字段列选择 + 时间戳对齐 + 自动滚动 + 导出（保存为 .log / .json）+ e2e | 1.5~2 天 | e2e `shell/e2e/logs/01-structured.spec.ts` ≥6 条；真机手测：跑一个 loguru 脚本确认级别/字段/折叠正确 |

### 6.6 已知边界与不做

- **不做**：日志聚合/多实例合并视图、日志文件 tail（只接运行输出）、告警规则。
- 边界：多行日志（如异常堆栈）按行切分后会散开（v1 接受；可考虑把紧跟的非结构化行归入上一条 —— 列为 v1.1 备选）；超长行（> 5 KB）折叠为摘要；行数达上限保尾弃头。

### 6.7 交互细节与状态机（v1.1 细化，2026-10-05）

> 与 B4 同一取向：**先把口径定死再开工**。下面每条都指向核实过的代码位置。

#### 6.7.1 面板布局

```
[错误 3] [警告 12] [信息 148] [调试 0]              ← 级别 chips（多选过滤；默认全选=不过滤）
[搜索 ______] [Aa] [.*]  [字段 ▾]  [自动滚动 ☑] [清空] [复制全部]
┌───────────────────────────────────────────────────────────────┐
│ 12:03:41.512  INFO   app.main     启动完成                     │
│ 12:03:41.880  ERROR  app.worker  ▸ {"msg":"连接失败","retry":3}│  ← 行内 JSON 可展开
│ 12:03:42.101  INFO   app.main     就绪                         │
└───────────────────────────────────────────────────────────────┘
1,543 行 · 显示 148 · 已丢弃 12,000（超出上限）      ← 状态条（tabular-nums）
```

- **字段列可切换**（`字段 ▾` 多选：time / level / logger / message / extra）——关闭的列不占位；
- **时间戳列 `font-variant-numeric: tabular-nums`**（§6.1 已定）；
- 顶部**首次使用提示一行**（可关闭）：「运行历史 = 按次归档回看；运行日志 = 当前运行的实时视图」（§6.6 的职责混淆风险对策）。

#### 6.7.2 状态机

```ts
type LogPhase = "idle" | "live" | "ended";
```

| 转移 | 触发 | 行为 |
|---|---|---|
| `idle → live` | 新运行会话启动（`startRunRecord` 对应时机） | **清空视图**（含 chips 计数），绑定该实例 |
| `live → live` | 收到该实例的输出块 | 追加解析后的条目（批量渲染，见 6.7.3） |
| `live → ended` | `finishRunRecord`（code / stopped / canceled） | 保留内容，状态条追加「已结束（退出码 N）」 |
| `ended → live` | 再次运行 | 同 `idle → live`（清空重来） |
| 任意 → `idle` | 关闭工作区 / `resetRunHistory` 时机 | 清空 + 解绑 |

**实例归属**：v1 **只绑定最近一次 run 会话**（`termUi` 的 `activeTermId` 语义），不做多实例合并（§6.6 已声明不做）。切实例即清空重来——符合「当前运行的实时视图」定位。

#### 6.7.3 高频输出：必须批量渲染

终端输出常按块到达（一次几十~几百行）。**禁止逐行 append DOM**，改为：

- 解析后先入**内存数组**（上限 `log_max_lines`，默认 5000，超限保尾弃头并计数「已丢弃 N」）；
- 用 **`requestAnimationFrame` 合并渲染**（同一帧内的多块输出只渲染一次；无 rAF 时回落 100ms 定时器）；
- 单帧渲染行数上限（如 300 行）——超出则分帧续渲染，避免一次插入上万节点卡住主线程；
- 视图**隐藏时只入数组不渲染**（`onHide` 置脏标记），`onShow` 时整表重建一次。

#### 6.7.4 过滤与搜索（纯显示层，不改数据）

- **级别 chips**：多选，默认全选；点击切换；`Shift+点击` 只留该项（对齐终端惯例）。计数**由本视图自建**（不复用 `output.ts` 的 `levelCounts` 单例——那是输出面板的，共用会互相污染）；级别判定**复用** `output.ts::detectLogLevel`（§6.4 已定「不改 output.ts」）。
- **搜索**：关键字 / 正则（`.*` 切换）+ 大小写（`Aa`）；防抖 200ms；命中高亮；与级别过滤**叠加**（先级别后搜索）；无命中显示空态而非空白列表（对齐 todoView 的 `noMatch` 口径）。
- 过滤/搜索**不动数据**：只影响渲染集合，切回全选立即恢复。

#### 6.7.5 自动滚动（关键交互）

- 默认开；**用户手动上滚 → 自动关闭**（滚到底部 → 自动恢复）；
- 关闭期间新日志到达：状态条显示「↓ N 条新日志」（可点击跳到底部）；
- 判定用「距底部 < 8px」而非「scrollTop + clientHeight === scrollHeight」（浮点误差会失效）。

#### 6.7.6 行内 JSON 展开

- 整行 JSON（或 `msg` 字段是 JSON 字符串）→ 行尾 `▸` 展开为树；
- **抽公共 `src/jsonTree.ts`**：B4 已在 `http.ts` 内私有实现了一份（`jsonNode`），加上 `devtools/jsonpath/tree.ts`，这是第三处 —— 抽公共的收益此时成立（B4 §5.4.2 当时判断「不成立」是基于只有两处）；
- 展开状态**不持久化**（重渲染即收起），默认折叠。

#### 6.7.7 空态与导出

- 空态：`emptyState("output", t(...), t(...), true)` —— 「运行脚本后，日志会实时出现在这里」；
- 导出：v1 用**「复制全部」**（过滤后的可见行）+ **「插入编辑器」**（照 B4 口径）；保存到磁盘留 v1.1（与 B4 同一未做项，避免重复引入写权限通道）。

#### 6.7.8 设置项（2 个，三步接线）

`log_structured_enabled`（默认 true；关闭则 tab 不显示，回到纯终端行为）、`log_max_lines`（默认 5000）。照 §2 纪律 3 接线（`state.ts` / `settingsPanel.ts` / `index.html` / Rust `Settings::default`）；**新增「设置 → 运行日志」分区或并入「日志」分区**（开工时定）。

#### 6.7.9 明确禁止

1. 禁止逐行 append DOM（必须批量渲染，见 6.7.3）；
2. 禁止在 `live` 态清空视图（除新运行）；
3. 禁止把「运行日志」做成第二个「运行历史」（不提供按次回看、不做 Pin/删除）；
4. 禁止过滤/搜索时丢数据（纯显示层）；
5. 禁止改 `output.ts`（保持其零 DOM 可单测的现状，只复用纯函数）。

### 6.8 数据流改造落地细节（核实于 2026-10-05）

**现状**（file:line 已核实）：

| 事实 | 位置 |
|---|---|
| `runOnData?: (text: string) => void` —— **单槽位**，签名**不带 id** | `termUi.ts:40` |
| 由 runHistory 在每实例绑定时设置（**闭包捕获 instanceId**，故调用点不需要传 id） | `termUi.ts:569` |
| 调用点只传 `plain`（已 `stripAnsi`） | `termUi.ts:887` |
| 实例销毁时清空槽位 | `termUi.ts:315` |
| runHistory 已有**半行缓冲**（chunk 不以换行结尾时留到下一块） | `runHistory.ts:121-136` |
| 级别层完整可复用：`LEVEL_RULES`（四条形态，**大小写敏感仅大写**）、`detectLogLevel`、`setOutputLevelFilter`、`levelCounts` + 计数上浮 sink | `output.ts:109/139/148/118-135` |
| 输出行数上限常量 `DEFAULT_MAX_OUTPUT_LINES = 5000` | `output.ts:213` |
| 底部 tab 枚举 5 个；`setBottomTab` 三张同步表（tab 按钮 aria/active、面板显隐、辅助元素 `output-channels`/`output-levels`/`terminal-cmd`） | `termUi.ts:69` / `:111-140` |
| 复位表 `resetOutputChannelUi()`（**漏改会导致关闭工作区后状态残留**） | `termUi.ts:859+` |

**改造**（PR-B5-1，独立成 PR）：

```ts
// termUi.ts
type RunDataConsumer = (instanceId: string, text: string) => void;
const runDataConsumers = new Set<RunDataConsumer>();
export function addRunDataConsumer(fn: RunDataConsumer): () => void; // 返回 dispose
```

- `:887` 改为遍历 consumers，**每个 consumer 独立 `try/catch`**（一个抛错不影响其他）；
- runHistory 一并改走 `addRunDataConsumer`（不再用 `opts.onData` 闭包），**半行缓冲逻辑保留在 runHistory 内部**；
- `:569` / `:315` 的 `s.runOnData` 赋值与清空随之删除（consumer 自己按 id 过滤）；
- **回归门禁**：`e2e/session/` + `e2e/autosave/` + `e2e/p4/` 必须全绿（§10 已登记该风险）。

**行归属**：B5 只消费 `kind === "run"` 的会话输出（`termUi.ts:887` 的 `if (s.kind === "run")` 分支），交互 shell 输出不进运行日志。

### 6.9 决策记录 · 拍板结论（2026-10-05，已定案）

开工前三项拍板，**结论如下，实施时不再回头论证**：

| # | 议题 | 拍板 | 落地要求 |
|---|---|---|---|
| 1 | **多实例归属** | **只跟最近一次运行**（否决多实例合并视图） | v1 只绑定最近启动的 run 会话；新运行即清空重来。与 §6.6「不做多实例合并视图」一致，省 0.5~1 天 |
| 2 | **底部 tab 数量（6 个）** | **保持平铺 6 个**（否决图标化 / 溢出下拉） | `output / terminal / git / findUsages / problems / logs` 全平铺文字按钮；新 tab 位置在 problems 之后 |
| 3 | **`log_*` 设置分区** | **并入现有「日志」分区**（不新建分区） | 注意：该分区现有 `log_enabled` / `log_level` / `log_keep` / `log_level_colors` 属**应用日志文件**设置，与运行日志语义不同 → **加一行小标题分隔**（PR-B5-3 落地） |

> 原「待确认」三问已作废，保留结论即可。后续若有新议题，追加在此表下方。

### 6.10 交付记录 · PR-B5-1（2026-10-05）

**范围**：`termUi` 采集钩子单槽位 → 多播（§6.8 全部改造点）+ `logParse.ts` 纯解析层 + 单测。**无 UI**（视图在 PR-B5-2）。

| 文件 | 改动 |
|---|---|
| `shell/src/runDataBus.ts` | **新文件**（约 55 行）：多播总线。`addRunDataConsumer`（返回 dispose）/ `removeRunDataConsumer` / `emitRunData` / `runDataConsumerCount` / `resetRunDataBus`（单测复位）。**零依赖**（无 DOM / 无 Tauri → 可单测） |
| `shell/src/termUi.ts` | 删 `TermSessionUI.runOnData`（`:40`）、`RunTerminalOptions.onData`（`:523`）、`:569` 赋值、`:315` 清空；`:887` 改 `emitRunData(s.id, plain)`；import 新总线 |
| `shell/src/runFlow.ts` | 删 3 处 `onData: (text) => recordRunLines(...)`（`:467` / `:561` / `:822`）+ import 收敛 |
| `shell/src/main.ts` | import `addRunDataConsumer`（runDataBus）；在 `initRunHistory()` 后注册 `addRunDataConsumer(recordRunLines)` —— **接线放在胶水层**，避免 `runHistory → termUi` 的新依赖（termUi 依赖 DOM/Tauri，会让 `runHistory.test.ts` 拉进整条链） |
| `shell/src/logParse.ts` | **新文件**（约 220 行）：`LogEntry` / `parseLogLine` / `logFieldValue` / `formatLogRow` / `normalizeLogLevel` / `levelLabel` / `LOG_FIELDS`；6 条行规则表 + 整行 JSON 分支 + 退化分支 |
| `shell/src/__tests__/logParse.test.ts` | **新文件，21 例**（≥12 例要求）：纯 JSON / 字段别名 / 缺 message / 嵌套 JSON / JSON 数组 / 非法 JSON / loguru / logging 带 name / 无 name / `LEVEL:logger:msg` / `[LEVEL]` / uvicorn / 行内 JSON / 无级别 / 空行 / `\r` / 超长行 / fuzz / 归一化 / 格式化 |
| `shell/src/__tests__/runDataBus.test.ts` | **新文件，6 例**：多消费者 / 多实例归属 / dispose / **单消费者抛错不影响其他** / 空文本不广播 / 回调内注册不破坏遍历 |

**门禁**：`npx tsc --noEmit` 零错 · `npm test` **1172/1172（96 文件）** · `npm run e2e -- session` **2/2** · `autosave` **7/7** · `p4` **8/8**（§6.8 指定的回归域全绿）。

**实现决策与踩坑（后续 PR 直接引用）**：

1. **多播总线要独立成模块**：`termUi` 依赖 DOM + Tauri，`__tests__` 里没有任何测试 import 它（实测 grep 确认）。把 `emitRunData` 抽到 `runDataBus.ts`（照 B4 的 `httpRequest.ts` 纯函数层先例）后，多播才有单测；B5-2 的 `logView` 也可直接注册而不必反向依赖 termUi。
2. **接线位置在 `main.ts` 而不是 `runHistory.ts`**：`runHistory → termUi` 的 import 会让 `runHistory.test.ts` 拉进 `@tauri-apps/api/window` / xterm 整条链（风险高、收益零）。`main.ts` 是胶水层，同时 import 两侧，天然合适。
3. **时间戳正则不能写宽松字符类**：最初用 `[\d:\-., T]+` 当 ts 组，实测会把 ` - ` 一起吃进时间戳（`"2026-10-05 12:03:41,512 - "`），污染对齐列 → 改为显式形态 `TS = \d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{4}-\d{2}-\d{2}`。
4. **logger 捕获组必须以 `[\w]` 开头**：`([\w.\-]+)` 会把纯 `-`（`… - INFO - 就绪` 里的分隔）当成 logger，改为 `([\w][\w.\-]*)`。
5. **级别组必须过 `normalizeLogLevel` 校验**：规则表里 level 组匹配到认不出的词（如 `GET`）要视为**该形态不成立**并继续下一条规则，否则 `GET: /api` 之类会被误判成日志行。
6. **超长行不做 JSON.parse**：> 16 KB 直接走文本规则（视图层也会折叠为摘要，双重省）。
7. **JSON 行的 `message` 缺失时留空串**（不填 raw），由视图 `e.message || e.raw` 回退——保持解析层字段语义纯净。

**与 §6.3 的偏差（登记）**：`LogEntry.json` 类型从文档写的 `Record<string, unknown> | null` 放宽为 `LogJson = Record<string, unknown> | unknown[]`（整行是 JSON **数组**的场景要能展开，Python 侧批量日志确实会这么打）。

**未做（属 PR-B5-2 / B5-3）**：底部「运行日志」tab 与视图渲染、级别 chips、搜索/正则、字段列选择、自动滚动、JSON 展开树（含抽公共 `jsonTree.ts`）、i18n `logs` 域、两个设置项、e2e。

### 6.11 交付记录 · PR-B5-2（2026-10-05）

**范围**：底部 tab「运行日志」+ 视图渲染（级别 chips / 搜索 / JSON 展开）+ i18n `logs` 域。**无设置项、无导出、无自动滚动**（PR-B5-3）。

| 文件 | 改动 |
|---|---|
| `shell/src/logStore.ts` | **新文件**（约 170 行）：纯状态层——状态机 `idle/live/ended`、半行缓冲切行、上限保尾弃头 + `dropped` 计数、级别计数、`visibleEntries`（级别 → 搜索两级叠加）、`compileMatcher`（正则非法降级为不过滤） |
| `shell/src/logView.ts` | **新文件**（约 420 行）：视图主体。DOM 骨架（提示行 / chips / 搜索行 / 列表 / 状态条）；**批量渲染**（rAF 合并 + 单帧 300 行 + 增量游标 + 裁头检测重建）；行四列渲染 + 命中高亮 `mark.log-hit`；行内 JSON `▸` 懒展开；空态两态（无日志 / 过滤无命中）；状态条（总行·显示·已丢弃·相位·正则错误） |
| `shell/src/jsonTree.ts` | **新文件**：通用 JSON 折叠树（§6.7.6 要求的公共化）。默认折叠，`expandedDepth` 可控。**B4 的 `http.ts` 仍用其私有实现**（切换留 v1.1，本次不动已交付代码） |
| `shell/src/__tests__/logStore.test.ts` | **新文件，14 例**：状态机三态 / 只跟最近一次运行 / 半行缓冲 / 上限与计数递减 / 空行不入列 / 过滤与搜索叠加 / 正则与非法正则 |
| `shell/src/__tests__/logView.test.ts` | **新文件，14 例**（`happy-dom`）：骨架与空态、四列渲染、chips 计数与 Shift 只留该项、关键字高亮、正则模式、JSON 展开/收起、清空、**隐藏时只入数组**、状态条（已丢弃 / 退出码） |
| `shell/src/termUi.ts` | `BottomTab` 加 `"logs"`；三张同步表加 `tab-logs` / `#logs-panel` / `setLogPanelVisible()`；import logView |
| `shell/src/runHistory.ts` | 新增生命周期订阅 `addRunLifecycleListener`（`start` / `end`），在 `startRunRecord` / `finishRunRecord` 末尾广播（注入式，logView 不认识 runHistory） |
| `shell/src/main.ts` | `initLogView()` + 生命周期转发（`start → beginLogSession` / `end → endLogSession`）；工作区复位加 `resetLogView()` |
| `shell/index.html` | 底部 tab 按钮 `#tab-logs`（problems 之后，§6.9 决策 2 平铺）+ 面板 `#logs-panel` |
| `shell/src/style.css` | B5 段（约 110 行）：面板 / chips / 搜索行 / `.log-row` 四列网格（`--font-mono` + 时间戳 `tabular-nums`）/ 高亮 / JSON 树，全 token |
| `tools/i18n/data/logs_{zh,en}.json` | **新域 `logs`，25 条**（含 `logs.tab`）→ `gen_domain.py` 生成两侧域文件并在 `locales/{zh-CN,en-US}/index.ts` 注册 |

**门禁**：`npx tsc --noEmit` 零错 · `npm test` **1200/1200（98 文件）** · `npm run e2e -- session` **2/2** · `p4` **8/8** · `todo` **7/7** · UI token 审计 **全绿**。

**实现决策与踩坑（后续 PR 直接引用）**：

1. **视图必须拆「纯状态层 + DOM 层」**：`logStore.ts` 承担状态机/缓冲/上限/过滤，才有 14 例零 DOM 单测；照 B4 的 `httpRequest.ts` 先例。
2. **生命周期走注入式订阅，不要让 logView 依赖 runHistory/runFlow**：`runHistory` 广播 `start/end`，`main.ts` 转发。这样 logView 的测试只需 `beginLogSession/endLogSession` 两个入口。
3. **隐藏语义要贯彻到「强制刷新」入口**：`flushLogView()` 在面板不在前台时必须**只置脏标记**而不是照常渲染，否则「隐藏时只入数组」的保证会被这个后门绕过（实测踩到）。
4. **首次点击 JSON `▸` 容易写成切换**：新建的 `box.hidden` 默认 false，`box.hidden = !box.hidden` 会让它**一创建就是收起**。必须显式「首次 = 展开，之后 = 切换」。
5. **增量游标会被「裁头」打乱**：超上限丢头部后索引全部错位 → 渲染时比对 `state.dropped`，变化即整表重建（否则会出现重复行/漏行）。
6. **未分级行永远显示**（与 `output.ts::levelVisible` 同口径）：只选 error 时普通行仍在——这不是 bug，测试期望要按这个口径写。
7. **DOM 测试必须声明 `// @vitest-environment happy-dom`**：默认 node 环境没有 `document`（落地时第一个红灯就是这个）。
8. **圆角要过 token 门禁**：`border-radius: 2px` 被 `audit_tokens.py` 判违规，改 `var(--radius-xs)`（语义正好是「高亮片段」）。

**与 §6.7 的偏差（登记）**：① 首次使用提示**只做会话级**（关闭后本次会话不再出现），不引入持久化通道——跨会话记未做属 B5-3 与设置项一起接；② `jsonTree.ts` 已公共化但 B4 `http.ts` 未切换（避免动已交付的 e2e 覆盖代码）。

**未做（属 PR-B5-3）**：字段列选择（`字段 ▾`）、时间戳对齐列宽优化、自动滚动（含「↓ N 条新日志」）、导出（复制全部 / 插入编辑器）、`log_structured_enabled` + `log_max_lines` 两个设置项、`e2e/logs/01-structured.spec.ts`。

### 6.12 交付记录 · PR-B5-3（2026-10-05）

**范围**：字段列选择、自动滚动、「↓ N 条新日志」、导出（复制全部 / 插入编辑器）、两个设置项、e2e。**B5 至此闭环**（剩余项见文末 v1.1 候选）。

| 文件 | 改动 |
|---|---|
| `shell/src/logView.ts` | 字段列多选（`字段 ▾` 走 `showMenu`，至少留一列；列数变体类 `log-row--cN`）；自动滚动（`FOLLOW_BOTTOM_EPSILON_PX = 8` + scroll 监听 + 暂停计数 + `scrollToBottom`）；「↓ N 条新日志」按钮；导出两键（复制全部 → `copy_to_clipboard`；插入编辑器 → 注入通道）+ 1.2s 文本反馈；`setLogViewHandlers` / `applyLogSettings` / `toggleLogField` / `isAtBottom` 导出 |
| `shell/src/termUi.ts` | **补 `#tab-logs` 的点击绑定**（`wireBottomPanel` 是硬编码 id 列表，漏一处则点击无反应——见踩坑 1） |
| `shell/src/state.ts` | `Settings` 加 `log_structured_enabled`（默认 true）/ `log_max_lines`（默认 5000）+ `DEFAULT_SETTINGS` |
| `shell/src/settingsPanel.ts` | 三步接线（声明 / 回填 / 收集，行数钳 100~100000）；保存后 `applyLogSettings()`，关掉时若停在 logs tab 则切回「输出」 |
| `shell/index.html` | 「日志」分区内新增**「运行日志」小标题组**（与「应用日志文件」设置分隔，§6.9 决策 3）+ 开关 + 行数上限（含 desc） |
| `shell/src-tauri/src/settings.rs` | `log_structured_enabled` / `log_max_lines` 两字段 + `Settings::default` 同步 |
| `shell/src/main.ts` | `setLogViewHandlers({ insertToEditor })`（有选区替换、否则插到文末）+ 启动时 `applyLogSettings()` |
| `shell/src/style.css` | 列数变体 5 条、`.log-extra`、`.logs-autoscroll`、`.logs-new-btn`、`.logs-status` 改 flex、`.logs-flash--error` |
| `tools/i18n/data/logs_{zh,en}.json` | +17 条（字段名 / 自动滚动 / 新日志 / 导出反馈）→ 42 条 |
| `tools/i18n/data/settings_{zh,en}.json` | +4 条（运行日志分区）→ 58 条 |
| `shell/src/__tests__/logView.test.ts` | 14 → **21 例**（字段列切换与「至少留一列」、自动滚动与「新日志」提示、复制/插入编辑器、`log_max_lines` 生效与非法值回落、开关隐藏 tab、超长行折叠） |
| `shell/src/__tests__/logStore.test.ts` | 14 → **15 例**（追加 `endSession` 按传入上限裁剪） |
| `shell/src/editorInsert.ts` | **新文件**：外壳级「插入编辑器」（有选区替换、否则插文末）；`devtools/host.ts` 的同名能力属插件通道，此处供底部面板域复用 |
| `shell/e2e/logs/01-structured.spec.ts` | **新文件，9 条**：tab 与空态 / 四列渲染 / chips 计数与过滤 / 搜索与正则 / 字段列 / JSON 展开 / 自动滚动与新日志提示 / 导出 / 设置项隐藏 tab |

**e2e 数据注入方式（重要）**：mock 不实现 PTY，故用页面内 `import("/src/logView.ts")` 直接调用视图**公共入口**（`beginLogSession` / `ingestLogText` / `endLogSession` / `flushLogView`）灌数据——照 `e2e/dx/*` 里 `import("/src/state.ts")` 的既有范式，**不新增测试后门**。`term-data → runDataBus → logView` 的链路由单测覆盖。

**门禁**：`npx tsc --noEmit` 零错 · `cargo check` 通过 · `npm test` **1208/1208（98 文件）** · `npm run e2e -- logs` **9/9** · `session` / `autosave` / `p4` / `todo` / `db` 回归全绿 · UI token 审计 **全绿**。

**提交前复核修正（2026-10-05，独立复核 + 门禁复跑）**：

1. **`endSession` 冲刷半行时未用设置的 `maxLines`**（真 bug）：用户把上限调小后，收尾行会绕过裁剪越界 → 签名加 `maxLines` 参数，`logView` 传入；补单测。
2. **`updateChips` 每块输出都写 DOM**：违反 §6.7.3「高频输出必须批量」→ 移进渲染帧，只随帧更新一次。
3. **`rebuild()` 不检查 `visible`**：隐藏时也会渲染，与「隐藏时只入数组」自相矛盾 → 隐藏时只置脏标记。
4. **删掉 `beginLogSession` 里无效的 `filter = { ...filter }`**（浅拷贝自己，无任何效果）；顺手写明「不重置搜索/字段」的意图。
5. **超长行折叠补齐**（§6.6 声明过但未实现）：单元格 > 5 KB 只渲染前 5 KB + `…` 并打 `.log-cell--truncated`；补单测。
6. **删掉未使用的 `row.dataset.raw`**：每行 DOM 多存一份原文（超长行场景是纯浪费）。
7. **`main.ts` 内联的 20 行「插入编辑器」抽成 `editorInsert.ts`**：规范要求 main 只做接线。

**手工验收反馈修复（2026-10-05，用户实测）**：

- **提示条「知道了」点了没反应（真 bug）**：`.logs-hint { display: flex }` 是作者样式，会盖掉 `hidden` 属性
  的 UA `display: none` → 点了等于没点。**同类隐患一并修掉**：视图内三处显隐（提示条 / 行内 JSON 展开框 /
  「↓ N 条新日志」按钮）统一改用全局 `.hidden` 类（带 `!important`），不再用 `hidden` 属性。
  > 规则沉淀：**凡是自己写了 `display` 的元素，禁用 `hidden` 属性做显隐**；本仓库统一走 `.hidden` 类。
- **提示文案补上入口键位**：原文案只说「运行历史 = 按次归档回看」，用户找不到入口 → 改为
  「运行历史（{key}）= …」，`{key}` 取 `bindingLabel("run_history")`（键位单一来源，随用户自定义变化）。
- 回归防护：单测 +1（提示可关闭 + 占位符已注入）、`e2e/logs` +1（第 10 条：点「知道了」后提示消失）。

**界面样式自查（2026-10-05，e2e 环境真实渲染 + 截图 + 坐标断言）**：

用临时 spec 在 mock 环境真实渲染日志面板（深色/浅色、空态/多格式/搜索/字段列/新日志提示/超长行），
逐张比对后发现并修掉两处：

1. **列跨行不对齐（真问题）**：每行是**独立**的 grid 容器，`auto` 列按**该行自身内容**算宽度，
   `tabular-nums` 只能保证数字等宽、做不到跨行对齐 → 时间戳/级别/logger 起点逐行漂移（浅色/深色同）。
   修：给三列设宽度下限（ts `23ch`、level `5ch`、logger `min 12ch` + `max 24ch` + 省略号）。
   实测 8 行四列 left 坐标**完全一致**（含无时间戳 / 无级别 / 无 logger 的行）。
2. **超长行截断后仍占满整屏**：5 KB 截断后仍够渲染 8 行 → 补 `-webkit-line-clamp: 3` 做视觉折叠。

回归防护：`e2e/logs` 10 → **11 条**（新增「列跨行对齐」坐标断言——这是**唯一**能自动验证对齐的方式，
截图肉眼看不出 1px 级偏差）。

**复核确认无问题的点（留证）**：`.hidden` 带 `!important`（`#logs-panel { display: flex }` 不会盖过它）；`termUi → logView → menu/util` 无环（`logView` 不反向 import termUi/settingsPanel）；设置保存顺序正确（`app.settings` 先整体赋值、再 `applyLogSettings()`）；e2e mock 无需补字段（`log_max_lines ?? 5000` 与 `!== false` 已兜底）。

**踩坑（后续 PR 直接引用）**：

1. **`wireBottomPanel` 是硬编码 id 列表**：加 tab 只改 `BottomTab` 枚举与同步表还不够，**必须同时加 `$("tab-xxx").addEventListener("click", …)`**——漏了则 tab 点不动（本轮 e2e 抓到的第一个真 bug）。
2. **面板容器不要整体覆盖 `className`**：`host.className = "logs-panel"` 会把 termUi 用来控制显隐的 `hidden` 类抹掉 → 初始化后面板在**所有 tab 下都可见**（e2e 抓到的第二个真 bug）。要用 `classList.add`。
3. **e2e 里 `import("/src/logView.ts")` 与页面实例是同一个**（同 URL → 同模块），所以「模块状态」与「DOM」一致；但**点击 tab 若抢在 init 完成前**会被后续初始化重置，症状是 `visible=false` 而面板看起来可见（因为 bug 2）。诊断手段：把 `visible` / `wired` / `renderedUpTo` 放进 `logViewSnapshot()`。
4. **行内 JSON 展开要求 `msg` 整体是 JSON**：`重试中 {"retry":3}` 这类"中文 + JSON 尾巴"不展开（`tryParseEmbeddedJson` 只认首字符 `{`/`[`）——写样本时别踩。
5. **字段列是用户偏好，`resetLogView` 有意不重置**：单测里必须显式复位，否则用例间互相污染（本轮踩到）。
6. **DOM 单测里调 `showMenu` 需先建 `#ctx-menu`**：menu.ts 会给 document 挂关闭监听，缺容器会让**后续任何点击**都抛「缺少元素 #ctx-menu」。
7. **`vi.mock` 的工厂函数签名要与 `vi.fn` 一致**，否则 `tsc` 报 `Expected 0 arguments`（`noUnusedParameters` + 严格签名）。
8. **正则样本别用 `^ERROR`**：日志行首是时间戳，锚点应打在分隔符上（`\| ERROR`）。

**与 §6.7 的偏差（登记）**：① 首次使用提示仍是会话级（未接持久化，与 B5-2 同）；② 「时间戳对齐」靠 `tabular-nums` + 网格列实现，未做按最长时间戳动态定宽（视觉上已对齐，动态定宽留 v1.1）；③ 导出仍不做「保存到磁盘」（与 B4 同口径，§6.7.7 已声明留 v1.1）。

---

## 7. B6 · TODO / Markdown 增强（3~4 人日，3 个 PR）

### 7.1 Markdown：Mermaid（PR-B6-1）

- 依赖：`npm i mermaid`（**本地打包，禁 CDN**；版本以 npm 解析为准，写入 `package.json` 与 `ci/versions.toml`）。
- **懒加载**：`markdownPreview.ts` 在 `renderMarkdownToHtml` 之后的 post-process 阶段检测 ```mermaid 块，**仅在存在时** `await import("mermaid")`；无图文档零成本。
- 安全：`sanitizeHtml`（`:47`）需在 DOMPurify 白名单放行 `svg` 及子元素与 `class`/`style`；mermaid 渲染产物**再过一次 sanitize**（对齐既有"先净化再插入"哲学）。
- 失败降级：渲染抛错 → 显示「图表渲染失败」+ 保留源码代码块（不静默、不白屏）。
- 主题同步：mermaid 初始化时传外壳当前主题（深/浅），随主题切换重渲染（复用 `onLocaleChange` 同款重建模式）。
- 单测：抽纯函数 `extractMermaidBlocks(md)` / `mermaidSvgAllowed(html)` 放 `__tests__/markdownMermaid.test.ts`。

### 7.2 Markdown：文档大纲（PR-B6-2）

- 纯函数 `extractOutline(md): OutlineItem[]`（`#`~`######`，**跳过代码块内**的 `#` —— 这是必须的对坑样本；标题文本去 Markdown 行内标记）。
- UI：`#md-preview` 面板顶部/侧边小目录（可折叠），点击滚动到对应标题（给渲染后的标题元素加 `id`，用 `scrollIntoView`）；预览滚动时高亮当前标题（v1.1 可选）。
- 与 TODO 视图无关，独立开关 `md_outline`（默认开）。

### 7.3 TODO 视图增强（PR-B6-3）

实施前基线：仅按 tag 分组（TODO/FIXME/HACK/BUG/XXX），无过滤、无文件分组、无搜索。
新增：
1. **关键字过滤**（输入框，防抖 200ms，匹配 tag 与文本）；
2. **按文件分组**折叠，与现有 tag 分组可切换（下拉：按标签 / 按文件）；
3. **点击跳转**：条目点击 → 打开文件并定位行（走既有 `setTodoViewHandlers` 注入的 handler 范式，确认现有是否已支持跳转，未支持则补）；
4. 计数徽标：过滤后仍显示总数与命中数。
- 纯函数：抽 `filterTodos(matches, query)` / `groupTodosByFile(matches)` 放 `__tests__/todoView.test.ts`（**新文件**）。
- 注意：Rust `fs_cmds::scan_todos` 是否返回文件路径与行号？**开工前先核实**；若只返回文本则需扩返回结构（后端 + mock 同步）。
  → **2026-10-04 已核实**：`fs_cmds.rs:1110` 的 `TodoMatch` 已含 `path` / `line` / `tag` / `message` / `text`，
  **后端零改动**；点击跳转也已由 `todoView.ts::setTodoViewHandlers` + `openFile(path, line)` 接好，只差补齐 1/2/4。

### 7.4 PR 切分

| PR | 内容 | 涉及文件 | 量级 | 验收 |
|---|---|---|---|---|
| **PR-B6-1** | Mermaid 支持（懒加载 + 白名单 + 主题同步 + 失败降级） | `package.json`、`markdownPreview.ts`、`__tests__/markdownMermaid.test.ts`、`ci/versions.toml` | 1.5 天 | tsc 0 错、vitest 全绿、≥6 例；真机：含 mermaid 的 md 能渲染、语法错误降级、无图文档不加载 mermaid（Network 面板验证） |
| **PR-B6-2** | Markdown 文档大纲 | `markdownPreview.ts`（+ `mdOutline.ts`）、`index.html`、`style.css`、`i18n/` | 1 天 | ≥6 例（含代码块内 `#` 对抗样本）；真机点击跳转 |
| **PR-B6-3** | TODO 视图：过滤 + 按文件分组 + 跳转 + 计数 | `todoView.ts`、`style.css`、`i18n/`、`e2e/mocks/tauri-mock.js`、`__tests__/todoView.test.ts` | 1~1.5 天 | ≥8 例；e2e 新 `todo/` 域 ≥4 条 |

> **PR-B6-3 已交付**（2026-10-04，实测量级 ≈0.5 天）：后端未动（`scan_todos` 已够用），详见 §7.6。

### 7.5 已知边界与不做

- **不做**：Markdown 导出 PDF/HTML、双向编辑（预览侧编辑）、图表类型扩展（只支持 mermaid 原生）、TODO 的自定义 tag 配置（沿用硬编码五类，除非顺手加设置项）。
- 边界：mermaid 首图渲染有一次性开销（懒加载 + 首次初始化），大图建议提示；大纲只取 1~6 级标题，Setext 式标题（`===`/`---`）v1 不支持（登记）。

### 7.6 交付记录 · PR-B6-3（2026-10-04）

**形态调整（与 §7.3 原稿的两处偏差，均已在本文档同步）**：

1. 「按文件分组」实现为**文件 → 条目**两级，而非原稿的「tag → 文件 → 条目」三级。侧栏宽度下三级嵌套层级过深、可用性反而下降；文件模式下丢失的标记维度改为在**条目前补徽标**补回。
2. 组头**可点击折叠**（原稿只在「按文件分组」下提折叠，实际两种模式都做了；折叠键带模式前缀 `tag:` / `file:`，切模式时清空）。

**改动清单**：

| 文件 | 改动 |
|---|---|
| `shell/src/todoView.ts` | 新增纯函数 `filterTodos` / `groupTodosByTag` / `groupTodosByFile` / `groupTodos`（原 tag 分组逻辑从渲染函数里提出，变成可单测的纯函数）；新增过滤框（输入框 + 清空按钮 + 分组模式下拉，200ms 防抖，Esc 清空）、组头折叠、命中/总数摘要；复核后补齐语言切换重建、清空按钮状态、折叠后的焦点与滚动恢复 |
| `shell/src/__tests__/todoView.test.ts` | **新文件**，19 例：过滤（空查询 / 空白 / 标记 / 说明 / 路径 / 整行回退 / 无命中 / 不改入参）、tag 分组（TAG_ORDER / 未登记标记后置 / 组内保序）、file 分组（首次出现顺序 / 文件名 vs 全路径 / 总数守恒）、`groupTodos` 模式分派 |
| `shell/src/style.css` | `.todo-filter-box` / `#todo-filter` / `.todo-group-mode` / `.todo-group-chev` / `.todo-group-name`（全 token，无裸色值 / 裸字号 / 裸间距 / 裸圆角） |
| `shell/src/i18n/locales/{zh-CN,en-US}/editor.ts`、`shell/tools/i18n/data/editor_{zh,en,map}.json` | 新增 10 条 `editor.todo.*`（filterPlaceholder / filterAria / clearFilter / groupBy / groupByTag / groupByFile / noMatch / noMatchHint / summaryFiltered / toggleGroup），由数据真源重新生成语言包 |
| `shell/e2e/mocks/tauri-mock.js` | 新增 `scan_todos` 桩（固定三条命中，可用 `window.__E2E_TODO_SCAN__` 覆写） |
| `shell/e2e/todo/01-filter-group.spec.ts` | **新域新文件**，7 条：默认 tag 分组 / 过滤、计数、按钮及 Esc 清空 / 无命中空态 / 切 file 分组 / 键盘折叠与焦点恢复 / 运行时语言切换 / 点击条目打开文件 |

**复核修正（2026-10-05）**：修复清空按钮未隐藏、运行时切换语言后动态文案滞留、折叠重渲染丢失焦点/滚动位置三项问题；补齐 i18n `data/editor_{zh,en,map}.json` 真源并由 `gen_domain.py` 重生成语言包。门禁：`npm run build` 通过；前端全量 93 文件 / 1100 用例通过；`e2e/todo/` 7/7 通过；UI token 审计 98/98。`cargo test` 为 290 通过 / 1 个存量 Windows CRLF 失败 / 2 ignored，本 PR 无 Rust 改动。

> 当前完成范围仅为 **PR-B6-3**；PR-B6-2（Markdown 大纲）与 PR-B6-1（Mermaid）仍待实施，B6 整体不得标记完成。

**代码里挖出、原稿未记载的事实**（后续 PR 可直接引用）：

- `fs_cmds.rs:1110` `TodoMatch` 已含 `path` / `line` / `tag` / `message` / `text` → **后端零改动**；
- `todoView.ts` 跳转 handler（`setTodoViewHandlers` + `openFile(path, line)`）**已在位**；
- **`marked` 18.0.12 不给标题生成 `id`**（实测 `marked.parse('# x')` → `<h1>x</h1>`）→ PR-B6-2 必须自己 post-process 补 id；
  - 连带现存 bug：`markdownPreview.ts` 的 `#anchor` 点击委托目前**命中不到任何元素**（页面无带 id 的节点），补 id 后该功能才真正生效；
- **大纲应从渲染后的 HTML 提取**（`querySelectorAll("h1..h6")`）而非正则扫 md 源——代码块内的 `#` 已被 marked 塞进 `<code>`，原稿 §7.2 列为「必须的对坑样本」可直接规避；
- CSP（`tauri.conf.json:15`）`script-src 'self' 'wasm-unsafe-eval'`**无 `unsafe-eval`** → PR-B6-1 的 mermaid 需先做真机 spike；
- `exportActiveMarkdown`（`markdownPreview.ts`）走另一条 marked → sanitize 管线，PR-B6-1 不处理它则**导出 HTML 里图表是空代码块**；
- `schedulePreviewRender` 300ms 防抖会重复触发渲染，mermaid 必须按源码文本做缓存 key；
- `markdownPreview.test.ts` 把 DOMPurify mock 成 identity（happy-dom 不完整）→ mermaid 的消毒行为**单测验不了**，真机验收不可省。

---

## 8. 排期总表与依赖

| 序 | PR | 依赖 | 量级 | 累计 |
|---|---|---|---|---|
| 1 | PR-B6-3 TODO 增强 | `scan_todos` 返回结构已核实 | 1~1.5 d | 1~1.5 d |
| 2 | PR-B6-2 Markdown 大纲 | — | 1 d | 2~2.5 d |
| 3 | PR-B6-1 Mermaid | — | 1.5 d | 3.5~4 d |
| 4 | PR-B5-1 多播 + 解析 | —（**可与 B6 并行**） | 1 d | 5 d |
| 5 | PR-B5-2 运行日志 tab | 4 | 1.5 d | 6.5 d |
| 6 | PR-B5-3 字段/导出/e2e | 5 | 1.5~2 d | 8.5 d |
| 7 | PR-B4-1 reqwest + http_cmds + facade `net` 门控 | **依赖风险（CI 编译）** | 2 d | 10.5 d |
| 8 | PR-B4-2 devtools 内置工具（发送 + 响应） | 7 | 2.5 d | 13 d |
| 9 | PR-B4-3 变量/历史 + curl 导入 + 端点联动 | 8 | 1~1.5 d | 14~14.5 d |
| 10 | PR-B3-1 rusqlite + CI | **依赖风险（CI 编译）** | 1 d | 15~15.5 d |
| 11 | PR-B3-2 查询内核 | 10 | 2 d | 17~17.5 d |
| 12 | PR-B3-3 前端骨架 | 11 | 2 d | 19~19.5 d |
| 13 | PR-B3-4 编辑器/网格/e2e | 12 | 2~3 d | 21~22.5 d |

> **B4 由 4 个 PR 缩为 3 个**（2026-10-05 形态改版）：原 PR-B4-1（`.http` 语言注册 + `httpParser.ts`）整块删除，原 PR-B4-4（curl 互转）缩为 PR-B4-3 的子项；总量 7~9 d → 4.5~6 d。

**关键路径风险**：PR-B4-2 与 PR-B3-1 都引入新的 Rust 原生依赖，**必须各自单独成 PR 并先验证 CI（windows-latest + MSVC）能编过**；若 bundled 编译在 CI 上不过，B3 需回退到决策 1 的方案 B（Python 桥），量级会变的更细碎但不必推倒重来（前端视图层不变）。

**并行建议**：B6 与 B5 无冲突可并行；B4/B3 因都要动 `Cargo.toml` 与 `lib.rs`，**串行更安全**。

**B6 内部顺序修订（2026-10-04，已同步到上表）**：初版把 PR-B6-1（Mermaid）排在最先，与第 0 章「先做零新依赖、见效快的两项」自相矛盾——Mermaid 是 B6 里**唯一引入新依赖**且**唯一有未验证项**（严格 CSP 下能否跑通）的一项。最终顺序为 **B6-3 → B6-2 → B6-1**：

| 新序 | PR | 理由 |
|---|---|---|
| 1 | PR-B6-3 TODO 增强 | 零依赖，后端已够用（§7.6），≈0.5 d 见效 |
| 2 | PR-B6-2 Markdown 大纲 | 零依赖，纯函数可单测，顺带修 `#anchor` 跳转现存 bug |
| 3 | PR-B6-1 Mermaid | **第一件事是 30 分钟真机 spike**（CSP + DOMPurify 白名单 + 体积）；不过即砍，前两项不受影响 |

---

## 9. 通用验收门禁（每个 PR 都要跑）

| 层 | 命令 / 标准 |
|---|---|
| 类型 | `npx tsc --noEmit` 零错误 |
| 前端单测 | `npm run test`（vitest）全绿 + 新增用例覆盖新纯函数 |
| Rust 单测 | `cargo test`（src-tauri）全绿；新增 `*_impl` 纯函数必须有用例 |
| E2E（mock） | **一律用 `npm run e2e -- <域/文件>`**（启动器见 §5.11 踩坑 1；直接 `npx playwright test` 在 Windows 上会在用例跑完后挂住数分钟）。对应域 spec 全绿；新 Tauri 命令必须在 `tauri-mock.js` 加桩（**e2e 全程离线，禁止真网络请求 / 真数据库文件**） |
| 真机冒烟 | 新功能首次落地需一次真机手测（B3 开真实 .sqlite；B4 对本地 `python -m http.server` 发一次；B5 跑一个 loguru 脚本；B6 开含 mermaid 的 md） |
| i18n | zh-CN 真源 + en-US 编译期对齐（`TKey`）；新域过 `tools/i18n` 流程 |
| 样式 | 无裸色值 / 裸字号 / 裸圆角；深/浅双主题抽查 |
| 文档 | README 索引或 `delivery-overview` 同步（见评估报告 P0-5） |

---

## 10. 风险登记

| 风险 | 概率 | 影响 | 应对 | 触发点 |
|---|---|---|---|---|
| rusqlite(bundled) 在 CI/本机编译失败或过慢 | 中 | 高 | PR-B3-1 只做"加依赖 + 空壳 + 跑 CI"；失败则切方案 B（Python 桥 + sqlite3），前端层不变 | PR-B3-1 |
| reqwest 编译体积 / 时间膨胀 | 中 | 中 | `default-features = false` 只开必要 feature。**已实测（§5.9）**：`rustls` 拉入 `aws-lc-sys`（**需 cmake**）+ ring / quinn 等 30+ crate（Cargo.lock +431 行），本机首次编译 ≈4 min；构建环境无 cmake 时的降级路径是 `native-tls` | PR-B4-1（已实测） |
| `termUi` 多播改造破坏 runHistory 采集 | 中 | 高 | PR-B5-1 单独成 PR，跑 `session/` + `autosave/` + `p4/` 域回归；消费者异常隔离 | PR-B5-1 |
| 底部 tab 新增漏改 `resetOutputChannelUi()`（`:764-781`） | 中 | 中 | 对照第 1.1 节"4 处"清单逐项勾；关闭工作区后检查状态残留 | PR-B5-2 |
| 内置工具绕过 facade 直接 `invoke` 发请求（`net` 权限未登记） | 中 | 高 | **PR-B4-1 必须先把 `"net"` 加进 `KNOWN_PERMISSIONS` 并给 `BaseHost.http` 做门控**，否则破坏"facade 是插件唯一通道"这条铁律并给第三方插件开口子 | PR-B4-1 |
| devtools 工具 dispose 后在途请求回包写入已卸载 DOM | 中 | 中 | `dispose()` 调 `http_cancel` + 请求令牌校验（旧 op 的回包直接丢弃）；单测覆盖 | PR-B4-2 |
| devtools 面板高度不足以放请求 + 响应双区 | 中 | 低 | 响应区独立滚动 + JSON 树默认折叠到第 2 层；开工前先量一次面板可用高度 | PR-B4-2 |
| token 明文落 localStorage | 低 | 中 | `http_save_tokens` 开关（可关）+ 首次使用一次性提示；敏感值可选择只存内存 | PR-B4-3 |
| localStorage 丢草稿（清 WebView 缓存 / 换数据根） | 低 | 低 | 文档写明为已知行为；需要持久化保证时切 §5.2 备选（Rust config） | PR-B4-2 |
| loading 动画漏压「减少动画」双通道 | 中 | 低 | 转圈一律用 `spinIcon()`（已双通道压制）；若照抄 `.rx-progress::after`，**必须同时压 `html[data-reduce-motion]` 与 `@media (prefers-reduced-motion)`**（`style.css:5470` 记过一次返工） | PR-B4-2 |
| `Esc` 取消与 devtools picker 关闭抢键 | 中 | 低 | 仅在 `sending` 阶段拦截 `Esc`，其余放行；开工前确认 picker 的 Esc 优先级 | PR-B4-2 |
| mock 桩无延迟 → loading 态在 e2e 里抓不到 | 中 | 中 | `tauri-mock.js` 的 `http_send` 支持 `window.__E2E_HTTP_DELAY_MS__`（§5.7.8） | PR-B4-2 |
| mermaid 体积拖累首屏 | 低 | 中 | 严格懒加载；无 mermaid 块不 import（Network 面板验证） | PR-B6-1 |
| DOMPurify 白名单放行 svg 带来 XSS 面 | 中 | 高 | mermaid 产物再过一次 sanitize；只放行必要标签/属性；预览内容来源为本地文件 | PR-B6-1 |
| 日志解析误判（普通句子被当日志级别） | 中 | 低 | 沿用 `LEVEL_RULES` 的大小写敏感口径；解析失败永远退化为原样行 | PR-B5-1 |
| 运行日志与运行历史职责混淆 | 中 | 中 | 文档与 UI 提示写清分工（实时视图 vs 按次归档） | PR-B5-2 |
| B4 e2e 真发网络请求导致不稳定 | 中 | 中 | **强制** mock 桩；真机冒烟只对本地 http server 手动执行 | PR-B4-2 |
| 新增设置项漏同步 Rust `Settings::default` | 低 | 中 | 前端 `!== false` 兼容 + 漂移锁思路；改 `state.ts` 必改 Rust | 各 PR |

---

## 11. 落地前置工作清单（新会话开工序）

按顺序执行，避免踩已登记的坑：

1. ~~拍板第 3 章的 3 个决策~~ → **第 3 章 5 个决策已于 2026-10-05 全部拍板**（B3 引擎 / B4 执行方式 / B3 默认只读 / B6 Mermaid 打包 / **B4 交互形态**），实施时直接按结论执行，不再回头论证；
2. `git status` 确认工作区干净（当前有未提交的视觉改造改动，先收口）；
3. B6 按修订顺序继续 **PR-B6-2**（PR-B6-3 已交付；PR-B6-1 最后做并先跑真机 CSP spike）；
4. ~~B5 开工前重读 `termUi.ts:40/315/569/887` 与 `runHistory.ts:118` 的采集链，确认多播改造点~~
   → **2026-10-05 已核实并完成改造**（PR-B5-1，见 §6.10）；注意行号已因删字段位移，后续 PR 以符号名为准；
5. B4 开工前确认四件事（形态改版后的新前置，原「`basic-languages/http` 是否导出」一条已作废）：
   ① `extensions/facade.ts:111-121` 的 `storage` 门控写法即为 `http` 的模板，照抄加进 `BaseHost` 并在 `manifest.ts:48` 登记 `"net"`；
   ② 内置工具 manifest 的 `icon` codicon 名是否存在（照 `endpointView.ts` 的 `codicon()` 用法核实）；
   ③ devtools 面板可用高度是否够放请求 + 响应双区（不够则响应区改为可折叠）；
   ④ `builtin/index.ts` 的内置工具注册路径（manifest + `BUILTIN_TOOL_MODULES` 两处都要加，漏一处则不出现在 picker）；
6. B3 开工前确认 `splitEditor.ts:49` 的第二实例创建/销毁范式，以及 `views.ts` 注册是否需要 `onHide` 做 dispose；
7. ~~B6-3 开工前确认 `fs_cmds::scan_todos` 的返回结构是否含文件路径与行号（决定要不要扩后端）~~
   → **2026-10-04 已核实：含，后端零改动**（见 §7.6）；
8. 每个 PR 结束跑第 9 章门禁，并把交付记录回填本文档（照 `git_clone_dev_plan.md` §12「交付记录」的写法）。

---

## 附录 A · 代码位置速查

| 用途 | 位置 |
|---|---|
| 侧栏视图注册 | `shell/src/views.ts:5/7-17/37/47`；注册点 `main.ts:2653-2704` |
| 底部 tab | `shell/src/termUi.ts:69`（枚举）/`:114/:125/:130`（同步表）/`:764-781`（复位表）/`:805 wireBottomPanel`；`index.html:353-357`、`:392-405` |
| 运行采集链 | **B5 §6.8 起为多播**：`runDataBus.ts`（`addRunDataConsumer` / `emitRunData`）；分发点 = `termUi.ts::wireTerminalEvents` 的 `kind === "run"` 分支；消费方 `runHistory.ts::recordRunLines`（接线在 `main.ts`，`initRunHistory()` 之后） |
| 输出级别层 | `shell/src/output.ts:101 OutputLogLevel`、`:109 LEVEL_RULES`、`:139 detectLogLevel`、`:148 setOutputLevelFilter`、`:213 MAX_OUTPUT_LINES`、`:298 appendOutputLine` |
| 设置三步接线 | `state.ts:43-118`（接口）/`:128-191`（默认）；`settingsPanel.ts:93`（声明）/`:630`（回填）/`:770`（收集） |
| i18n | `shell/src/i18n/locales/zh-CN/index.ts:30,33`；工具 `shell/tools/i18n/` |
| 键位三处 | `keybindingDefaults.ts:9-99`、`:101+`；`settings.rs::default_keybindings`；漂移锁 `__tests__/keybindings.test.ts:118` |
| Rust 命令范式 | `fs_cmds.rs:92-95`；`lib.rs:75`（handler 列表）、`:305-319`（Exit 清理） |
| 流式/取消基建 | `git_cmds.rs:760-909`；`util.rs:96/103 no_window`、`:125/:150 kill_process_tree`、`:202 kill_pid_tree` |
| 安全守卫 | `git_cmds.rs:325 validate_repo_relative`、`:1451 validate_clone_url`、`:1471 validate_clone_target` |
| 持久化 | `env_cmds.rs:85/90/100`（workspace config）；`settings.rs:104/110` |
| 求值桥 | `lib_cmds.rs:171 py_eval`、`:30-35 SCRIPTS`、`:394 run_with_timeout_bytes` |
| 编辑器扩展点 | `util.ts:60/72-85 languageOf`；`monaco.ts:80-105`（自定义语言先例）；`splitEditor.ts:49`（第二实例） |
| JSON 树形参考 | `shell/src/devtools/jsonpath/tree.ts` |
| curl 解析 | `shell/src/devtools/curl2python/{parse.ts,gen.ts}`、`python2curl.gen.ts`；`parse.ts:139 parseCurl`（B4 的 curl 导入直接复用） |
| devtools 框架 | `shell/src/devtools/registry.ts`（`registerDevTool`）、`kit.ts`（UI 积木：`body/row/toolbar/input/textarea/output/primaryButton/copyButton/errorSlot/flash/radioGroup`，**无 select**）、`panel.ts`、`index.ts`（`openDevToolsPanel`） |
| 内置工具注册 | `shell/src/devtools/builtin/index.ts`（`BUILTIN_TOOL_MODULES` + manifest 表，**两处都要加**）；范例 `builtin/curl2python.ts`（`mount(host: PanelHost)` 返回 `{ dispose }`） |
| 插件 host 能力 | `shell/src/extensions/facade.ts:21-39 BaseHost`（含 `storage` 命名空间隔离，`:111-121`）、`:42-46 PanelHost`、`manifest.ts:48 KNOWN_PERMISSIONS`（`clipboard/selection/fs:read/storage/monaco`，**B4 需追加 `net`**）、`:24-30 contributes.tools[].inline` |
| 端点视图联动 | `shell/src/endpointView.ts`（route 扫描）、`frameworks.ts fullEndpointUrl`、`termUi.ts lastServiceBaseUrl` |
| 数据落盘位置 | `util.rs:22 data_root()`、`:79 opencharm_home()`、`:85 webview_data_dir()`（localStorage 落点）；`settings.rs:104 settings_path()`；`env_cmds.rs:85-101` workspace config |
| e2e | `shell/e2e/<域>/NN-*.spec.ts`；mock `shell/e2e/mocks/tauri-mock.js:57 staticHandlers`、`:68 get_settings`、`:102`（数组返回 `[]`） |
