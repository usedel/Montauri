# OpenCharm 工具箱开发计划（SQLite · HTTP Client · 结构化日志 · TODO/Markdown 增强）

> 版本：v1.0 · 日期：2026-10-02 · 状态：**待评审**（方案定稿，未开工）
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
| **B4** HTTP Client | `.http` 文件：语法高亮 + 发送请求 + 响应面板 + 变量/环境 + 历史 + curl 互转 | Rust **reqwest**（推荐）；Python 桥为可选增强 | `reqwest`（Rust） | **7~9 人日** | 4 |
| **B3** SQLite 数据库工具 | 侧栏「数据库」视图：连接管理 + 对象树 + 数据网格 + SQL 编辑器（默认只读） | Rust **rusqlite bundled**（已定案）；py 桥为降级 | `rusqlite`（Rust，bundled） | **8~10 人日** | 4 |

> **B3 已实施**（2026-10-02）：PR-1 ~ PR-4 代码完成、测试全绿（`cargo test db_` 33 / `vitest` 994 / `e2e/db/` 22），**未提交**。实施记录与 e2e 抓到的两个真 bug 见 `docs/sqlite_tool_dev_plan.md` §9.1~§9.4。本节以下内容保留为原始计划，供回溯。

**总量约 22~28 人日**（含测试与 e2e）。建议推进顺序 **B6 → B5 → B4 → B3**：先做零新依赖、见效快的两项，把两个引入 Rust 依赖的重头戏放在后面（且各自第一个 PR 就是"加依赖 + 跑通 CI"，风险前置）。

三个需要产品负责人**拍板**的选型（详见第 3 章）：

1. **B3** rusqlite（原生、可取消、快）vs Python 求值桥 + `sqlite3`（零新依赖、需解释器、不可取消）——**推荐 rusqlite**；
2. **B4** reqwest（原生、可取消、流式）vs Python 桥 + httpx（复用用户 venv、零新依赖）——**推荐 reqwest**，Python 桥作为 v1.1 可选增强；
3. **B3 默认只读**：建议数据库**默认以只读方式打开**，写语句需二次确认 + 显式开关（避免手滑 `UPDATE` 全表）。

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
| TODO 视图 | 已在侧栏注册表（`id:"todo"`）；`invoke("scan_todos",{root})` → Rust `fs_cmds::scan_todos`；**按 tag 分组**（TODO/FIXME/HACK/BUG/XXX），无文件分组、无过滤、无关键字搜索 | `todoView.ts:150-173`（`groups` 按 `m.tag`）、`:41 setTodoViewHandlers`、`:79 refreshTodos`、`:116 renderTodoPanel`；DOM `#todo-toolbar` / `#todo-summary` / `#todo-refresh` / `#todo-results` |
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
| **HTTP 能力** | **零**：无 reqwest / 无 tauri-plugin-http；`shell/src` 零 `fetch(` 命中；`devtools/curl2python/{parse.ts,gen.ts}` 与 `python2curl.gen.ts` 是**纯字符串转换，不发请求** | — |
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
| 编辑器扩展点 | `util.ts:60 languageOf(path)`（`:72-85` map，已有 `sql:"sql"`）；自定义语言先例 `monaco.ts:80-105`（json 的 `languages.register` + `setMonarchTokensProvider`）；Monaco 自带 `basic-languages/http` contribution | `.http` 两种做法二选一 |
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

### 决策 2 · B4 的请求执行方式

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A · reqwest**（推荐） | 加 `reqwest = { version = "0.12", default-features = false, features = ["json","stream","rustls-tls"] }`，新增 `http_cmds.rs` | 原生、可取消、可流式进度、超时可控、不依赖用户 venv、无需装 httpx | 新依赖（+2~4 MB，编译时间增加）；需自己处理代理 / 重定向 / 编码 |
| B · Python 求值桥 + httpx | `py_eval` kind 加 `http_send`，用工作区 `.venv` 的 httpx | 零新依赖；**复用用户自己的环境**（会话、证书、代理配置与真实脚本一致，对爬虫场景有真实价值） | 需解释器 + venv 内有 httpx；取消难；流式难；错误映射复杂 |
| C · 前端 `fetch` | WebView2 内 fetch | 零依赖 | CORS / 证书 / 代理 / 流式全部受限，且拿不到真实耗时与重定向链 —— **否决** |

**推荐 A**；**B 作为 v1.1 可选增强**（"用项目 venv 发送"，对标 JetBrains 的 run-with-interpreter）。v1 命令接口预留 `engine: "native" | "python"` 字段（仅 `native` 生效），避免日后破坏性变更（沿用插件系统 §9.10 的预留字段先例）。

### 决策 3 · B3 的写权限

**建议默认只读**：`db_open` 默认 `SQLITE_OPEN_READ_ONLY`；写语句（`INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/PRAGMA` 写入类）需：① 连接显式开启"可写"开关；② 执行前弹确认框显示语句；③ 结果提示影响行数。
理由：自用工具最怕手滑；只读打开还能避免锁库（SQLite 单写者限制）与 WAL 污染。

### 决策 4 · B6 的 Mermaid 打包

- **懒加载**：`markdownPreview.ts` 检测到 ```mermaid 代码块时才 `await import("mermaid")`，首屏零成本、无图文档完全不加载。
- 体积控制：mermaid 完整包较大（约 2~3 MB min），可接受（本地打包，不进首屏关键路径）。
- DOMPurify 需放行 `svg` 及其子元素、`class` / `style` 属性；渲染失败降级为「渲染失败」提示 + 保留源码代码块（对齐 `sanitizeHtml` 的既有兜底哲学）。

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

## 5. B4 · HTTP Client（7~9 人日，4 个 PR）

### 5.1 交互形态

`.http` 文件在编辑器打开（语法高亮），工具栏/右键/键位三入口发送请求：

```
GET https://api.example.com/users?page=2        ← 请求行（高亮 method/URL）
X-Token: {{token}}                              ← 头（支持变量）
Content-Type: application/json

{"name": "x"}                                   ← body（可多行）
###                                             ← 请求分隔
POST {{base}}/items
...
```

响应区（编辑器下方分栏或底部新面板，建议**编辑器下方分栏**，复用 `markdownPreview` 的分栏布局先例）：

```
状态 200 OK · 312 ms · 4.2 KB            [复制] [保存响应] [复制为 curl]
├ Headers（表格，可折叠）
├ Body：JSON（折叠树 + 搜索）/ 文本 / 图片预览 / 二进制提示
└ 历史（最近 20 次，点击回填）
```

变量：`@name = value` 文件内定义 + `###` 之外；环境文件 `http-client.env.json`（`{"dev": {...}, "prod": {...}}`），环境切换下拉；`{{var}}` 替换。

### 5.2 纯解析层（可单测，最重要的一块）

```ts
// httpParser.ts（纯函数，零依赖）
export interface HttpBlock {
  method: string; url: string; version?: string;
  headers: { name: string; value: string }[];
  body: string;
  name?: string;                 // `# @name=xxx` 注释
  startLine: number; endLine: number;
}
export function splitHttpBlocks(text: string): HttpBlock[];
export function blockAtLine(blocks: HttpBlock[], line: number): HttpBlock | null;
export function resolveVariables(text: string, vars: Record<string,string>): { text: string; missing: string[] };
export function parseEnvJson(text: string): { envs: Record<string, Record<string,string>>; error?: string };
export function requestToCurl(req: ResolvedRequest): string;   // 复用 devtools/curl2python 的思路（反向）
```

解析规则（与 JetBrains / REST Client 对齐）：`###` 分隔；请求行 = 首个非空非 `#` 行；头到空行结束；空行后到下一个 `###`/EOF 为 body（**保留原样，含换行**）；`#` / `//` 行是注释（body 内的 `#` 不算注释）；`@name = value` 为文件内变量。

### 5.3 Rust 侧（`src/http_cmds.rs`，新增）

| 命令 | 签名 | 说明 |
|---|---|---|
| `http_send` | `(app, window, req: HttpRequestJson, op_id: String) -> Result<HttpResponse, String>` | 见下 |
| `http_cancel` | `(op_id)` | 置 `Arc<AtomicBool>` |
| `http_save_response` | `(path, content)` | 走既有 `fs_cmds::write_file` 即可（**不新增命令**） |

请求入参：`{ method, url, headers: [[k,v]], body: string|null, timeout_ms, follow_redirects, max_redirects }`
响应出参：`{ status, status_text, headers: [[k,v]], body: string, bytes, elapsed_ms, redirect_chain: string[], truncated }`

**执行模型**：
```rust
static HTTP_OPS: LazyLock<PerWindow<HashMap<String, Arc<AtomicBool>>>> = ...;
```
- `reqwest::Client::builder()` 每次构建（或全局 LazyLock 复用）+ `rustls-tls` + 默认超时（30s，可配）+ 重定向策略（默认跟随上限 10）；
- body > 5 MB 截断并置 `truncated`（防止把几十 MB 塞进 IPC）；非 UTF-8 / 二进制响应体按 `Content-Type` 判定，二进制只回元信息；
- 下载进度事件 `http-op-progress`（payload `{op_id, received, total?}`），`emit_to(window.label(), ...)`；
- 取消：`spawn` 中轮询 `cancel`，或直接用 `reqwest` 的 `RequestBuilder` + 外部 `CancellationToken` 简化实现（v1 可接受"取消不保证即时生效"）；
- **退出清理**：`http_stop_for_exit()`，`lib.rs` 注册。

**纯函数（单测目标）**：
- `validate_http_url(url) -> Result<Url, String>`：scheme 白名单 `http`/`https`（抄 `git_cmds.rs:1451 validate_clone_url` 形态）；拒空 host；**SSRF 提示**（对 `localhost` / `127.0.0.0/8` / `10./172.16-31./192.168.` / `.local` 不拦截，但在响应里带 `private_target: true` 供前端提示——自用工具不拦，知情即可）；
- `sanitize_header_name(name)`：拒绝含 `\r\n` / 空字节（防头注入）；剔除 `content-length` / `host` 等由客户端计算的头；
- `truncate_body(bytes, limit)`。

### 5.4 前端

- 新增 `shell/src/httpClient.ts`（视图 + 发送，约 600~800 行）、`shell/src/httpParser.ts`（纯解析，可单测）、`shell/src/__tests__/httpParser.test.ts`。
- 语言注册：方案 a）`monaco.ts` import `basic-languages/http` contribution（Monaco 自带，最省）；方案 b）照 `monaco.ts:80-105` 手写 Monarch。**推荐 a**，b 作为 a 不可用时 fallback；同时 `util.ts:72` map 加 `http: "http"`（若 a 未自动关联扩展名）。
- 入口：命令面板 2 条（发送请求 / 新建 .http 文件）、编辑器右键「发送请求」、键位 `send_http_request`（建议 `Ctrl+Alt+Enter`，走三处同步 + 漂移锁）；`.http` 文件模板（新建时给一个示例骨架，设置开关默认关——沿用 live-templates header 的"默认关"纪律）。
- 响应渲染：JSON 折叠树**参考** `devtools/jsonpath/tree.ts` 的形态（不直接依赖 devtools 域，复制思路到 `httpJsonTree.ts` 或抽公共 `jsonTree.ts` 到 `src/`——**建议抽公共**，两处共用）。
- 持久化：历史写工作区 config `http_history`（上限 20，含 method/url/status/elapsed/时间，**不存 body**）；环境文件 `http-client.env.json` 放工作区根（`.gitignore` 友好，含 token 时提示）。
- 设置项：`http_timeout_ms`（默认 30000）、`http_follow_redirects`（默认 true）。
- i18n 新域 `http`；mock 桩：`tauri-mock.js` 加 `http_send` 返回罐头响应（**不得真发网络请求**，e2e 必须离线可跑）。

### 5.5 PR 切分

| PR | 内容 | 涉及文件 | 量级 | 验收 |
|---|---|---|---|---|
| **PR-B4-1** | `.http` 语言注册 + `httpParser.ts` 纯解析层 | `monaco.ts`（或 basic-languages）、`util.ts`、`src/httpParser.ts`、`__tests__/httpParser.test.ts` | 1.5 天 | vitest ≥15 例（分隔/注释/变量/多行 body/边界：空文件、只有分隔符、CRLF） |
| **PR-B4-2** | **加依赖 + 打通 CI**：`reqwest` + `http_cmds.rs`（send/cancel + `validate_http_url` / `sanitize_header_name` / `truncate_body`）+ Exit 清理 | `Cargo.toml`、`src/http_cmds.rs`、`src/lib.rs`、`ci/versions.toml` | 2 天 | **CI 编过**；`cargo test` ≥8 例（scheme 白名单、头注入、截断、私网标记） |
| **PR-B4-3** | 前端：发送 + 响应面板（状态/头/体 + JSON 树）+ 变量/环境 + 历史 + i18n + mock | `src/httpClient.ts`、`jsonTree.ts`、`index.html`、`main.ts`、`style.css`、`i18n/`、`e2e/mocks/tauri-mock.js` | 2.5 天 | tsc 0 错、vitest 全绿、`httpClient.test.ts` ≥8 例；e2e `shell/e2e/http/01-send.spec.ts` ≥6 条（mock 桩） |
| **PR-B4-4** | curl 互转（请求↔curl，复用 `devtools/curl2python` 解析）+ 保存响应 + 真机冒烟 | `src/httpClient.ts`、`devtools/curl2python/` | 1~1.5 天 | 新增用例 ≥4；真机手测：对 `https://httpbin.org/get` 之类发一次（或本地起 `python -m http.server` 避免外网依赖） |

### 5.6 已知边界与不做

- **不做**：Cookie 持久化 / 会话管理、请求脚本（pre-request JS）、GraphQL 专用面板、WebSocket、gRPC、认证向导（OAuth）。
- 边界：SSE/流式响应 v1 只看最终结果（流式展示留 v1.1）；multipart 表单 v1 用原始 body 手写；证书校验不提供关闭开关；代理仅读系统环境变量（`HTTP_PROXY`/`HTTPS_PROXY`），不做 UI 配置。

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

现状：按 tag 分组（TODO/FIXME/HACK/BUG/XXX），无过滤、无文件分组、无搜索。
新增：
1. **关键字过滤**（输入框，防抖 200ms，匹配 tag 与文本）；
2. **按文件分组**折叠（二级：tag → 文件 → 条目），与现有 tag 分组可切换（下拉：按标签 / 按文件）；
3. **点击跳转**：条目点击 → 打开文件并定位行（走既有 `setTodoViewHandlers` 注入的 handler 范式，确认现有是否已支持跳转，未支持则补）；
4. 计数徽标：过滤后仍显示总数与命中数。
- 纯函数：抽 `filterTodos(matches, query)` / `groupTodosByFile(matches)` 放 `__tests__/todoView.test.ts`（**新文件**）。
- 注意：Rust `fs_cmds::scan_todos` 是否返回文件路径与行号？**开工前先核实**；若只返回文本则需扩返回结构（后端 + mock 同步）。

### 7.4 PR 切分

| PR | 内容 | 涉及文件 | 量级 | 验收 |
|---|---|---|---|---|
| **PR-B6-1** | Mermaid 支持（懒加载 + 白名单 + 主题同步 + 失败降级） | `package.json`、`markdownPreview.ts`、`__tests__/markdownMermaid.test.ts`、`ci/versions.toml` | 1.5 天 | tsc 0 错、vitest 全绿、≥6 例；真机：含 mermaid 的 md 能渲染、语法错误降级、无图文档不加载 mermaid（Network 面板验证） |
| **PR-B6-2** | Markdown 文档大纲 | `markdownPreview.ts`（+ `mdOutline.ts`）、`index.html`、`style.css`、`i18n/` | 1 天 | ≥6 例（含代码块内 `#` 对抗样本）；真机点击跳转 |
| **PR-B6-3** | TODO 视图：过滤 + 按文件分组 + 跳转 + 计数 | `todoView.ts`、（可能）`fs_cmds.rs`、`tauri-mock.js`、`__tests__/todoView.test.ts` | 1~1.5 天 | ≥8 例；e2e `shell/e2e/ux/` 或新 `todo/` 域 ≥4 条 |

### 7.5 已知边界与不做

- **不做**：Markdown 导出 PDF/HTML、双向编辑（预览侧编辑）、图表类型扩展（只支持 mermaid 原生）、TODO 的自定义 tag 配置（沿用硬编码五类，除非顺手加设置项）。
- 边界：mermaid 首图渲染有一次性开销（懒加载 + 首次初始化），大图建议提示；大纲只取 1~6 级标题，Setext 式标题（`===`/`---`）v1 不支持（登记）。

---

## 8. 排期总表与依赖

| 序 | PR | 依赖 | 量级 | 累计 |
|---|---|---|---|---|
| 1 | PR-B6-1 Mermaid | — | 1.5 d | 1.5 d |
| 2 | PR-B6-2 Markdown 大纲 | — | 1 d | 2.5 d |
| 3 | PR-B6-3 TODO 增强 | 需先核实 `scan_todos` 返回结构 | 1~1.5 d | 4 d |
| 4 | PR-B5-1 多播 + 解析 | —（**可与 B6 并行**） | 1 d | 5 d |
| 5 | PR-B5-2 运行日志 tab | 4 | 1.5 d | 6.5 d |
| 6 | PR-B5-3 字段/导出/e2e | 5 | 1.5~2 d | 8.5 d |
| 7 | PR-B4-1 .http 语言 + 解析 | — | 1.5 d | 10 d |
| 8 | PR-B4-2 reqwest + http_cmds | **依赖风险（CI 编译）** | 2 d | 12 d |
| 9 | PR-B4-3 前端发送 + 响应 | 7, 8 | 2.5 d | 14.5 d |
| 10 | PR-B4-4 curl 互转 + 冒烟 | 9 | 1~1.5 d | 16 d |
| 11 | PR-B3-1 rusqlite + CI | **依赖风险（CI 编译）** | 1 d | 17 d |
| 12 | PR-B3-2 查询内核 | 11 | 2 d | 19 d |
| 13 | PR-B3-3 前端骨架 | 12 | 2 d | 21 d |
| 14 | PR-B3-4 编辑器/网格/e2e | 13 | 2~3 d | 24 d |

**关键路径风险**：PR-B4-2 与 PR-B3-1 都引入新的 Rust 原生依赖，**必须各自单独成 PR 并先验证 CI（windows-latest + MSVC）能编过**；若 bundled 编译在 CI 上不过，B3 需回退到决策 1 的方案 B（Python 桥），量级会变的更细碎但不必推倒重来（前端视图层不变）。

**并行建议**：B6 与 B5 无冲突可并行；B4/B3 因都要动 `Cargo.toml` 与 `lib.rs`，**串行更安全**。

---

## 9. 通用验收门禁（每个 PR 都要跑）

| 层 | 命令 / 标准 |
|---|---|
| 类型 | `npx tsc --noEmit` 零错误 |
| 前端单测 | `npm run test`（vitest）全绿 + 新增用例覆盖新纯函数 |
| Rust 单测 | `cargo test`（src-tauri）全绿；新增 `*_impl` 纯函数必须有用例 |
| E2E（mock） | 对应域 spec 全绿；新 Tauri 命令必须在 `tauri-mock.js` 加桩（**e2e 全程离线，禁止真网络请求 / 真数据库文件**） |
| 真机冒烟 | 新功能首次落地需一次真机手测（B3 开真实 .sqlite；B4 对本地 `python -m http.server` 发一次；B5 跑一个 loguru 脚本；B6 开含 mermaid 的 md） |
| i18n | zh-CN 真源 + en-US 编译期对齐（`TKey`）；新域过 `tools/i18n` 流程 |
| 样式 | 无裸色值 / 裸字号 / 裸圆角；深/浅双主题抽查 |
| 文档 | README 索引或 `delivery-overview` 同步（见评估报告 P0-5） |

---

## 10. 风险登记

| 风险 | 概率 | 影响 | 应对 | 触发点 |
|---|---|---|---|---|
| rusqlite(bundled) 在 CI/本机编译失败或过慢 | 中 | 高 | PR-B3-1 只做"加依赖 + 空壳 + 跑 CI"；失败则切方案 B（Python 桥 + sqlite3），前端层不变 | PR-B3-1 |
| reqwest 编译体积 / 时间膨胀 | 低 | 中 | `default-features = false` 只开必要 feature；记录构建耗时与包体积变化 | PR-B4-2 |
| `termUi` 多播改造破坏 runHistory 采集 | 中 | 高 | PR-B5-1 单独成 PR，跑 `session/` + `autosave/` + `p4/` 域回归；消费者异常隔离 | PR-B5-1 |
| 底部 tab 新增漏改 `resetOutputChannelUi()`（`:764-781`） | 中 | 中 | 对照第 1.1 节"4 处"清单逐项勾；关闭工作区后检查状态残留 | PR-B5-2 |
| `.http` 语言注册选错方案（contribution 无导出） | 低 | 低 | 方案 a 不行立即回退方案 b（Monarch 手写，有 json 先例） | PR-B4-1 |
| mermaid 体积拖累首屏 | 低 | 中 | 严格懒加载；无 mermaid 块不 import（Network 面板验证） | PR-B6-1 |
| DOMPurify 白名单放行 svg 带来 XSS 面 | 中 | 高 | mermaid 产物再过一次 sanitize；只放行必要标签/属性；预览内容来源为本地文件 | PR-B6-1 |
| 日志解析误判（普通句子被当日志级别） | 中 | 低 | 沿用 `LEVEL_RULES` 的大小写敏感口径；解析失败永远退化为原样行 | PR-B5-1 |
| 运行日志与运行历史职责混淆 | 中 | 中 | 文档与 UI 提示写清分工（实时视图 vs 按次归档） | PR-B5-2 |
| B4 e2e 真发网络请求导致不稳定 | 中 | 中 | **强制** mock 桩；真机冒烟只对本地 http server 手动执行 | PR-B4-3 |
| 新增设置项漏同步 Rust `Settings::default` | 低 | 中 | 前端 `!== false` 兼容 + 漂移锁思路；改 `state.ts` 必改 Rust | 各 PR |

---

## 11. 落地前置工作清单（新会话开工序）

按顺序执行，避免踩已登记的坑：

1. **拍板第 3 章的 3 个决策**（B3 引擎 / B4 执行方式 / B3 默认只读）；
2. `git status` 确认工作区干净（当前有未提交的视觉改造改动，先收口）；
3. 从 **PR-B6-1** 开始（最快见效、零 Rust 依赖）；
4. B5 开工前重读 `termUi.ts:40/315/569/887` 与 `runHistory.ts:118` 的采集链，确认多播改造点；
5. B4 开工前确认 `monaco-editor@0.52.2` 是否导出 `basic-languages/http` contribution（决定方案 a / b）；
6. B3 开工前确认 `splitEditor.ts:49` 的第二实例创建/销毁范式，以及 `views.ts` 注册是否需要 `onHide` 做 dispose；
7. B6-3 开工前确认 `fs_cmds::scan_todos` 的返回结构是否含文件路径与行号（决定要不要扩后端）；
8. 每个 PR 结束跑第 9 章门禁，并把交付记录回填本文档（照 `git_clone_dev_plan.md` §12「交付记录」的写法）。

---

## 附录 A · 代码位置速查

| 用途 | 位置 |
|---|---|
| 侧栏视图注册 | `shell/src/views.ts:5/7-17/37/47`；注册点 `main.ts:2653-2704` |
| 底部 tab | `shell/src/termUi.ts:69`（枚举）/`:114/:125/:130`（同步表）/`:764-781`（复位表）/`:805 wireBottomPanel`；`index.html:353-357`、`:392-405` |
| 运行采集链 | `termUi.ts:40 runOnData`、`:569`、`:887`、`:315`；`runHistory.ts:118` |
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
| curl 解析 | `shell/src/devtools/curl2python/{parse.ts,gen.ts}`、`python2curl.gen.ts` |
| e2e | `shell/e2e/<域>/NN-*.spec.ts`；mock `shell/e2e/mocks/tauri-mock.js:57 staticHandlers`、`:68 get_settings`、`:102`（数组返回 `[]`） |
