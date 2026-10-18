# OpenCharm pytest 测试运行器开发计划

> 版本：v1.0 · 日期：2026-10-16 · 状态：**T1–T5 已交付并验收（2026-10-17）**
> 验收记录：`docs/pytest_acceptance_record.md` **v1.1**（门禁 + 真机数字真源；含真机抓出的 5 个 bug）
> 进度：T1（Rust 命令 + kind="test" 运行分支）✅ · T2（第 9 侧栏视图 + 缓存/失效）✅ · T3（绿箭头 + 运行/结果合入 + 重跑失败）✅ · T4（调试此测试）✅ · T5（真机 pytest-real **12 项检查 PASS**）✅
> 上游裁决：`python_ide_dev_plan_v2.md` **v2.2 §1.1**（2026-10-16 产品负责人裁决：「不做 pytest 面板」修订为分层口径）
> 关联真源：`python_run_dev_plan.md` v3.4（运行链路复用）· `python_debug_dev_plan.md` v1.3（调试入口复用）· `dep_health_dev_plan.md` v1.7（pytest 缺失信号复用）· `improvement_and_roadmap_report.md` B1（候选 → 立项）
> 约束：`ci/budgets.toml`（命令面 / bundle / 文件行数）+ `docs/adr/0010-performance-lightweight-charter.md`（性能与体积一等目标）

---

## 1. 目标与范围

### 1.1 本期交付（M1）

| 能力 | 形态 | 实现路线 |
|---|---|---|
| 测试发现 | 侧栏测试树的数据源 | `pytest --collect-only -q` **按需子进程**（用例级非静态，理由见 §3.2）；文件级骨架走静态遍历先行渲染（§3.2 两段式） |
| 侧栏测试树 | 第 9 个侧栏视图（`tests`） | 文件 → 类 → 用例（含 parametrize id）；行 hover ▶ 运行；状态图标 + 文件/类向上汇总；三态（空 / 收集错误 / pytest 未安装） |
| 绿箭头逐用例 | 编辑器 glyph margin ▶ | `def test_*` / `class Test*` 行；点击运行；让位断点与 run gutter；右键「运行 / 调试此测试」 |
| 运行测试 | 复用统一运行控制台 | `run_in_terminal` 新增 `kind="test"` 分支（**零新命令**，见 §3.5） |
| 结果状态合入 | junitxml → 树状态 | 通过 / 失败 / 错误 / 跳过 / xfail + 耗时；失败行 tooltip + 点击跳转 file:line |
| 重跑失败 | 树视图头部动作 | 一次调用传多个 node id（junitxml 自然覆盖全部） |
| 调试此测试 | gutter / 树入口 | `dap.rs` 加 `test_node` 可选参数（module 链路已通，见 §3.7） |

### 1.2 明确不做（维持，登记防反复）

| 不做 | 理由 |
|---|---|
| 独立结果面板 + 断言差异对比窗 | 面板形态是当年否决的主体；本期结果收敛进侧栏树，差异窗推 M2 |
| 覆盖率运行 | roadmap F-3 缓议，依赖 coverage.py |
| watch 模式 | 需第三方插件（pytest-watch / pytest-xdist），违背零新增依赖 |
| 向用户进程注入 pytest 插件 | 违背「不侵入」气质（conftest 注入会污染用户项目） |
| 每项目 pytest 参数 UI（`-x` / `--tb=short` / `-m`） | M1 固定参数；UI 与工作区配置存储一起推 M2（§1.3） |
| unittest 专属路径 | pytest 可跑 unittest，连带覆盖，不造第二套 |
| 快捷键（如 Ctrl+Shift+F10） | 入口走 gutter 菜单 + 树；键位是单一来源（`keybindingDefaults.ts`），加键位连带测试面，推 M2 |

### 1.3 M2 候选（登记不排期）

每项目 pytest 参数 UI（工作区配置 `test` 键）· 结果面板 + 断言差异对比窗 · 绿箭头细化到 parametrize 单例 · 树行「仅运行失败」过滤器 · 快捷键 · 树与发现的按文件懒展开（大仓优化）· 后台 collect 全局进度芯片（statusOp 范式，§3.10）· 虚拟滚动（超大树，§3.10）。

---

## 2. 现状盘点（可复用基建）

| 能力 | 现状（代码位置） | 本方案用法 |
|---|---|---|
| PTY 运行 + 多实例 | `terminal.rs::run_in_terminal`（`kind` 参数自由字符串，`terminal.rs:327`） | 加 `kind="test"` 分支；实例 / tab / 停止 / traceback 全继承 |
| 运行环境装配 | `run_env.rs`（PYTHONPATH / probe / env 单一来源） | 测试运行同链路，probe 采集自然覆盖测试执行（intel 净收益） |
| 调试 module 链路 | `dap.rs:578-601`（`python -m debugpy --connect … -m <module> [args…]` 已实测） | 调试此测试只需入口 + 一个可选参数（§3.7） |
| 文件级变更事件 | `watcher.rs:164` `dep-fs-changed`（.py / 声明文件分类，已防抖） | 测试树缓存失效触发器，不新增监听 |
| 运行完成事件 | `termUi.ts` `term-exit`（按实例 id）+ `addRunDataConsumer` 多播 | 运行结束 → 读 junitxml → 合入状态的钩子 |
| 运行前 import 预检 | `runFlow.ts:148-167` `missingForFile` / `check_missing_imports` | 测试运行继承同一条预检：pytest 缺失 → 确认框 + 安装出口（§3.9 防线 ②） |
| 子进程取消基建 | `uv_cancel.rs`（长任务取消模式）+ `util::kill_process_tree`（铁律） | collect 子进程取消 / 超时杀树 |
| glyph margin 协调 | `runGutter.ts`（`__main__` ▶）+ `debugGutter.ts:37`（注入式让位 `isRunGutterLine`） | 绿箭头第三方占用，照注入式让位办理（§3.4） |
| 侧栏视图注册 | `views.ts::registerSidebarView` + `sidebarViews.ts`（8 视图先例） | 第 9 个视图照旧登记；**动态 import** 保护首屏 chunk（§3.3） |
| pytest 缺失信号 | `dep_health` E1/E2（已声明未安装）+ `dep_fix` install/sync 动作 + ModuleNotFoundError toast 出口 | 安装引导的**编排**全部委托 depHealth（E1 → install；E2 → sync 建议），测试视图只触发与展示（§3.9） |
| 任意路径读文件 | `fs_cmds.rs::read_file`（10MB 守卫） | 树行点击跳转前的按需静态扫描（§3.3） |

**真空白只有三件**：一键入口、结构化结果、失败定位——其余全部是接线。

---

## 3. 总体设计

### 3.0 数据流

```
打开测试视图 ─┬─► pytest_action(scan) ──► 工作区遍历（collect_files + 忽略目录，百毫秒级）
             │                                    │
             │                                    ▼
             │                        文件级骨架先行渲染（不依赖 collect，首帧立即可见）
             │                                    │
             │                        同时 ──────┤
             │                                    ▼
             └─► pytest_action(collect) ──spawn──► python -m pytest --collect-only -q
                                                          │ 按工作区缓存；.py 变更 → dep-fs-changed → 失效
                                                          ▼
                                             collect 落地 → 用例子节点增强骨架（parametrize / 动态 / 收集错误）
                                                          │
   绿箭头（testGutter.ts，编辑器静态扫描，免发现依赖）─────┤── 运行 / 调试此测试
                                                          ▼
                               run_in_terminal(kind="test") ──► PTY: python -m pytest -q <node_id>
                                                          │         --junit-xml=<data_root>/test-results/<session-id>.xml
                                                          ▼
                                          term-exit ──► pytest_action(result, session_id) ──► 手写 junitxml 解析
                                                          ▼
                                        状态合入树（applyResults）+ 失败跳转 file:line
```

### 3.1 新增命令面（唯一新增）

```rust
#[tauri::command]
pub async fn pytest_action(
    app: AppHandle,
    action: String,              // "scan" | "collect" | "cancel" | "result"
    workspace_root: String,
    session_id: Option<String>,  // result 用
) -> Result<Value, String>
```

四动作合一的复用式单命令（`scratch_cmds.rs` 「一个命令承载 run/stop/status」先例）；**运行不占命令面**（走 `run_in_terminal`）。命令数 206 → 207，`budgets.toml` 显式修订（§4）。

| action | 语义 | 返回 |
|---|---|---|
| `scan` | 工作区遍历取测试文件名（复用 `search_cmds.rs::collect_files` + `SEARCH_IGNORED_DIRS`），**无子进程** | `{ files: string[] }`（相对工作区根、正斜杠，保序） |
| `collect` | spawn `pytest --collect-only -q`（cwd=工作区根），60s 超时 | `{ ok, nodes: string[], missing_module: string\|null, error_tail: string, duration_ms }` |
| `cancel` | kill 进行中的 collect 进程树（uv_cancel 模式） | `{ cancelled: bool }` |
| `result` | 读 `<data_root>/test-results/<session_id>.xml` 并解析 | `{ cases: [{ node_id, status, duration_ms, message, file, line }] }` |

### 3.2 测试发现（collect）

**用例级发现为什么不用静态扫描**：parametrize 的 `test_foo[a-b]`、`pytest_generate_tests` 动态生成、插件收集的用例，静态扫不可能扫全；误报漏报直接毁掉树的可信度。`--collect-only -q` 输出是逐行 node id（`tests/test_api.py::TestUser::test_create[1-2]`），格式自 pytest 3.x 起稳定，VS Code 亦同此路线。**但文件级骨架用静态遍历**（见下 bullet）——文件名单漏不掉（默认命名模式 + collect 对自定义 `python_files` 的补齐），先用它兑现首帧，再用 collect 增强。

- **两段式数据流（scan → collect 增强）**：打开视图先 `pytest_action(scan)`（纯 Rust 工作区遍历，**无子进程**，百毫秒级）→ 文件级骨架**先行渲染**（不依赖 collect，兑现 §3.10 首帧要求，60s 病态 collect 也不再阻塞界面）；collect 后台并行跑，落地后用例子节点增强骨架（parametrize / 动态用例 / 自定义 `python_files` 收集到的非常规命名文件 / 收集错误）。scan 与 collect 共用同一份缓存（§3.8）；
- **venv / 三方包目录剪枝（2026-10-18 修订，用户现场 smbter）**：`SEARCH_IGNORED_DIRS` 自本批起含 `venv` / `env` / `virtualenv` / `site-packages` / `dist-packages`。原名单只有 `.venv`，无点命名的 venv 逃过 `hidden` 规则，且**工作区非 git 仓库时 `.gitignore` 因 ignore crate `require_git` 默认 true 而不生效**——venv 内三方包自带的 `test_*.py`（smbter 现场 48 个）被收进测试树。剪枝后 venv 的 1437 个 `.py` 不再进遍历，scan 同步更快；
- **零用例骨架行剔除（2026-10-18 修订）**：`buildTestTree(files, nodes, pruneEmptyFiles=true)` 仅在 collect 成功路径置 true——pytest 真没收到的文件（剪枝名单漏网点 / 文件存在但 pytest 未收集）不得在收集成功后长期占位。collect 失败 / 取消 / 未安装时保持骨架语义（树仍可见）。自定义 `python_files` 的追加文件自带 case，不受影响；
- **按需执行**：仅「打开测试视图且无缓存」或「缓存被失效且视图可见」时 spawn；无常驻、无轮询；
- **可取消 + 超时**：60s 超时即 `util::kill_process_tree`（铁律：杀子进程必须杀树）；视图提供取消按钮；
- **解析口径**（Rust 单测钉死）：node id 行 = 含 `.py` 且 `.py` 后为行尾或 `::`（排除 `tests/test_x.py:12: PytestUnknownMarkWarning` 之类告警行、`N tests collected` 摘要行）；退出码非 0 → `error_tail` 带输出尾部 40 行供视图展示；退出码 0 但解析出 0 节点且原始输出非空 → `ok=false` + `error_tail`（防插件改写收集输出时静默空树）；
- **pytest 缺失**：stderr 命中 `No module named pytest` → `missing_module="pytest"`，视图走安装引导（复用 dep 信号，不预检弹窗；依赖解决全貌见 §3.9）；
- **解释器解析**：提取 `run_env.rs::resolve_run_interpreter`（配置级 > 工作区配置 > .venv 检测 > uv 兜底）——这将是第三处复刻（`terminal.rs:390` / `dap.rs:548` 已有两份），借机收敛到 `run_env.rs`（其章程本就是「运行环境装配单一来源」）；uv 兜底时 collect 命令为 `uv run pytest --collect-only -q`。

### 3.3 侧栏测试树（第 9 个视图）

- **登记**：`views.ts` 的 `SidebarViewId` 加 `"tests"` + `registerSidebarView` + `index.html` 加 `#tab-tests`（活动栏按钮，codicon beaker 类）与 `#view-tests` 根（照 `tab-runtime` 先例）+ `sidebarViews.ts` 接线（+约 6 行，116/130 余量内；该文件已警告逼近上限，本次只加不改结构）；
- **懒加载**：`onShow: () => void import("./testView").then(m => m.refreshTests())`——与现有 8 视图的静态 import **刻意不同**，把约 43KB 新代码挡在 index 首屏 chunk 外（`index_chunk_kb` 1,700 红线；Vite 自动分包）；
- **树构建**：Rust 只回扁平列表（scan 回文件名保序；collect 回 node id 保收集序），树形构建在前端纯函数 `testTreeCore.ts::buildTestTree`（vitest 可直测）——骨架阶段 `buildTestTree(files)` 仅文件行（子节点待 collect 填充），collect 落地后 `buildTestTree(nodes)` 全量重建但**保留展开态与状态**（§3.10）；
- **树行交互**：hover 显示 ▶（运行该节点）；文件行点击 → `read_file` + `scanTestDefs` 定位 def 行后打开（懒解析行号，collect 输出不含行号；扫不中回落行 1）；行状态图标（codicon check / error / circle-slash / loading）；
- **汇总**：文件与类节点取子孙最差状态 + 失败计数；
- **三态**：空（收集成功无节点）/ 收集错误（`error_tail` 原文 + 重试按钮）/ pytest 未安装（`missing_module` → 安装引导；引导的**命令编排委托 depHealth**（E1 未声明 → `dep_fix` install；E2 已声明未装 → sync 建议，前端按 style+组名组装），测试视图不自己算命令，§3.9）；
- **stale**：缓存失效后视图可见则防抖 500ms 自动重收，不可见则头部显示「有变更」chip + 手动刷新按钮。

### 3.4 绿箭头（testGutter.ts）

- **数据源**：编辑器模型静态扫描 `testTreeCore.ts::scanTestDefs(text)`——识别 `def test_*` 与 `class Test*` 行，按缩进维护类栈，就地拼 node id（`relPath::Class::test`， parametrize 不展开，箭头跑整个函数）；
- **免发现依赖**：不等 collect，切 tab / 输入即出箭头；正则漏检只是没有图标，菜单照常（`runGutter.ts` 文件头同款口径）；
- **glyph margin 三方协调**（断点 > 测试箭头 > run gutter）：注入 `hasBreakpointAt(line)`（来自 debugGutter 断点表）与 `isRunGutterLine(line)`（runGutter 已导出），被占用行不画箭头；点击判定同样先过这两道守卫，杜绝一次点击既运行又设断点；
- **只在测试文件名显示**（`isTestFileName`：`test_*.py` / `*_test.py`）；
- **右键菜单**：「运行此测试」/「调试此测试」，与树行菜单同源数据（`menuItems.ts` 加数据源，机制复用 `menu.ts`）。

### 3.5 运行（kind="test"）

`terminal.rs::run_in_terminal` 的 `kind` 加 `"test"` 分支：

- 合成入口 `RunEntry { kind: "module", target: "pytest" }`（**不读写用户运行配置**）；
- `cwd = 工作区根`（rootdir / conftest 语义正确；node id 相对工作区根）；
- args = `[<node_id>, "-q", "--junit-xml=<data_root>/test-results/<session-id>.xml]`（M1 固定参数，§1.2）；
- 解释器 / venv / probe 注入 / 多实例 tab / 停止按钮 / traceback 跳转**全链路继承**——这是命令面零增长的根据；
- junitxml 落 `<data_root>/test-results/`（按需建目录）；**机会性清理**：每次测试运行启动时删除 24h 前的残留 xml（piggyback 在运行路径，不起定时器——「默认轻量」纪律）；
- 前端：`runState.ts` 的 `RunKind` 加 `"test"`，单例实例 `run-term-test`（独立「测试」tab，label「测试 · <node>」；与脚本 / 项目实例各自独立，互不排斥；调试互斥沿用现有 `debug_busy` 检查——kind != "project" 即拒绝）；
- **预检继承**：`runTestNode(s)` 与 `runScript` 走同一条运行前 import 预检（`runFlow.ts:148-167`）——测试文件顶 `import pytest` 缺失时弹出用户已熟悉的确认框（含安装出口），lazy 缺失仅输出面板提示；语义与跑脚本完全一致，不新造预检；
- 「重跑失败」= `runTestNodes(ids: string[])`，args 为多个 node id，一次调用。

### 3.6 结果（junitxml 契约）

- **路径是后端内部契约**：写入方 = kind="test" 分支，读取方 = `pytest_action(result, session_id)`；前端不碰 data_root、不碰 XML；
- **手写解析**（Cargo.toml 无 XML crate，不引新依赖）：`testsuite/testcase` 的 `classname` / `name` / `file` / `line` / `time` + `failure` / `error` / `skipped` 子元素；约 120 行 + 单测；
- **node_id 重建**：`<file>::<classname 点分转 ::>::<name>`；`<skipped type="pytest.xfail">` 记 xfail（呈现归 skip 档）；`file` / `line` 属性需 **pytest ≥ 6**，老版本降级为「按 classname+name 匹配 + 静态扫描行号」；
- **合入**：`testTreeCore.ts::applyResults(tree, cases)` 按 node_id 匹配（纯函数，单测覆盖匹配 / 汇总 / 幂等）；
- **时机**：`term-exit`（该实例 id）→ `result` → 合入 → 视图刷新；进程被 kill（无 xml）→ 状态留 unknown + toast 说明，不报错刷屏；
- **失败呈现**：行 `title` tooltip 显示 message；点击行跳转 file:line（xml 有则用，无则 `scanTestDefs` 兜底）。断言差异对比窗不做（§1.2）。

### 3.7 调试此测试

- **后端小改**（纠正早期「零改动」判断）：`debug_start` / `debug_attach_debuggee` 各加 `test_node: Option<String>`——为 Some 时合成 `module=pytest` + `args=[test_node]` + `cwd=工作区根`，绕过按文件的运行配置读取（`dap.rs:543-546`）；约 30 行；
- **入口**：绿箭头右键 / 树行右键「调试此测试」→ `debugEntry.ts` 加 `debugTest(nodeId)` 路径（复用现有三态互斥与 PTY 管道模式——调试期 stdout 走输出面板，`input()` 交互暂不支持，与脚本调试同口径）；
- debugpy 自带副本零变更（随包分发既有机制）。

### 3.8 缓存与失效

- 缓存：模块级 `Map<workspaceRoot, { files, tree, collectedAt, stale }>`（scan 的 files 与 collect 的 nodes 共用一份缓存记录；只读数据，跨窗口可共享；每窗口各自持有一份引用即可，不引入全局单例锁）；
- 失效：订阅既有 `dep-fs-changed`（任何 .py 变更即失效整棵树——粗粒度但正确；conftest.py 是 .py 天然覆盖）；声明文件变更（pyproject / requirements）同样失效（环境变化可能改变收集）；
- 重收：视图可见 → 防抖 500ms 自动；不可见 → stale chip；
- 手动刷新：视图头部刷新按钮（强制重收）。

### 3.9 pytest 依赖解决（四层防线）

**定位：pytest 不随包分发，它是用户项目的测试框架**（与 debugpy 捆随包的本质区别：debugpy 是 IDE 自带能力、版本由 `ci/versions.toml` 锁；pytest 的版本与插件集由项目 pyproject 定——用我们的副本跑用户的测试会因版本 / 插件错配（conftest、pytest-asyncio、entry points 发现）产生误导性结果，且 +1.5~2MB 体积纯为用户少装一个 dev 依赖买单，违背体积章程）。OpenCharm 只做「检测 + 引导」，安装动作全部委托既有 dep 编排，**只响应用户显式动作**（R5），不预检弹窗、不静默安装。

| 防线 | 信号来源 | 现状 | 本方案落点 |
|---|---|---|---|
| ① 静态扫描 | dep_health E1/E2 | **已有**：pytest 在 extras/dev 组声明未装 → E2「已声明未安装」小节汇总（v1.7 口径）；完全未声明 → E1 按模块聚合 | 测试视图安装引导消费这份 diff，不自己算 |
| ② 运行前预检 | `runFlow.ts:148-167` | **已有**：按文件查缺失 import，确认框 + 安装出口；lazy 仅提示 | `runTestNode(s)` 继承同一条预检（§3.5），体验与跑脚本一致 |
| ③ 运行时报错 | term-data ModuleNotFoundError + collect stderr | **已有**（v1.6 ③：toast +「安装」双出口，会话去重） | collect `missing_module`（§3.2）→ 视图三态；运行路径走既有 toast 出口 |
| ④ 结果层降级 | junitxml 缺 `file`/`line`（pytest < 6） | — | classname+name 匹配 + 静态扫描行号（§3.6） |

**安装出口的命令链路**（`dep_fix.rs:956-964` `plan_dep_fix`，action × style 构建，全部复用）：

- pytest **已声明未装** → `sync`：pyproject → `uv sync`（前端按 style+组名组装 `uv sync --extra dev` 类建议，v1.7 既有约定）；requirements → `uv pip install -r <file>`；
- pytest **未声明** → `install`：pyproject → `uv add --dev pytest`；bare → `uv pip install --python <解释器> pytest`；
- 互斥已有：`DEP_FIX_BUSY`（uv.lock 文件锁，防并发 `uv add` 撞锁）。

**两个边角**：① **uv run 兜底**——未选解释器时 collect / 运行走 `uv run pytest`，uv 默认同步 dev 组（extras 需显式 `--extra`），声明在 dev 组的 pytest 多数场景会被自动同步，「缺 pytest」未必发生；发生即入防线 ③。② **probe 兼容**——probe 走 `sys.monitoring`（无 import hook），与 pytest 的 assert 重写正交不冲突；测试在采集下慢约 1.35x，随全局探针开关（用户可控）。

**裸项目边角**（小脚本画像：散落 `test_x.py` 无 pyproject）：dep style = bare → `uv pip install --python <解释器> pytest`；无解释器时沿用既有「未选择解释器且未找到 uv」报错文案，不新造。

### 3.10 UI 与交互：耗时操作不卡死纪律

> 立项前提（产品负责人 2026-10-16）：pytest 是本项目耗时操作最密集的功能（collect 子进程秒级～分钟级、树可达千级节点），**任何路径不得卡死界面**。以下逐项锁定并发 / 取消 / 渲染 / 反馈范式，全部复用既有先例，不新造机制。

**耗时操作清单与冻结向量**：

| 操作 | 时长量级 | 冻结向量 | 对策（范式出处） |
|---|---|---|---|
| `scan` 文件骨架 | 大仓 100ms~1s | 首帧延迟（不卡界面，但等得久） | 复用 `collect_files` 忽略目录 + 缓存；先行渲染不依赖 collect（§3.2） |
| collect 子进程 | 0.5s～60s+（**超时保险值，非典型**；典型 FastAPI 项目 0.5~3s） | 连点双 spawn / 切视图无反馈 / 千节点渲染卡主线程 / 切工作区留孤儿 python | CR-07 同步闸门 + 后端单飞 + 请求令牌 + 分帧渲染 + 退出钩子杀树；**骨架已先行，collect 转后台增强** |
| 树渲染 | 1000+ 节点一次性 DOM = 数百 ms | 主线程长任务 | logView 分帧续渲染 + 默认折叠 |
| 绿箭头扫描 | 大文件 10~20ms/次 | 逐 keystroke 触发 | 防抖 200ms + 指纹短路（inlineDiagnostics） |
| 运行 / 调试测试 | 秒级～长跑 | 无新风险 | 继承 runScript / debug 既有闸门 |
| result 读取 + 解析 | junitxml 可达数 MB | Rust 同步解析占线程 | `spawn_blocking` + 只切状态类不重建 DOM |
| 失效自动重收 | 每次保存 .py | collect 抖动 + 树被反复抽换 | 1s 防抖合并 + 单飞 + 保留展开态 |

**逐项决策**：

- **collect 并发与取消**：① 前端 CR-07 式同步闸门——检查 + 置位之间无 `await`，收集中按钮置灰，连点第二次直接忽略（`runFlow.ts:71` `beginRunPreparing` 同款）；② 后端单飞——`pytest_cmds.rs` 持 `COLLECT_BUSY`（按 workspace_root 判重），双窗口 / 双提交不可能双 spawn（`dep_fix.rs` `DEP_FIX_BUSY` 同款）；③ 取消——视图内取消按钮 → `pytest_action(cancel)` → `util::kill_process_tree`（铁律）；**collect 子进程进全局注册表**（它不是 PTY 会话，退出钩子不管就会孤儿），应用退出钩子统一杀树（`lsp.rs` / `dap.rs` drain 先例）；④ 60s 超时同路杀树。
- **进度反馈位置（M1 不放状态栏）**：statusOp 文件头的判据成立——长操作进度不能只活在可能关掉的面板里；但本功能取折中：**切走视图不取消、只作废前端等待（令牌++），collect 后台跑完静默入缓存，回视图即新树**。进度 / 取消只需存在于视图内，M1 不新增常驻状态栏模块（`statusOp.ts` 146/185 余量也吃不起分叉）。代价（已知取舍）：后台 collect 无全局可见进度；大仓场景若日后证明需要，按 statusOp 范式补芯片——登记 M2。
- **大树渲染**：① **首帧来自 scan 骨架**（文件级行，不依赖 collect，§3.2；大仓遍历亦仅百毫秒级），初始态折叠到文件级；② 展开文件时子节点分帧续渲染——>300 行/帧走 rAF 分帧（logView `MAX_ROWS_PER_FRAME` + `scheduleFrame` 同款，测试环境回落 setTimeout）；③ collect 落地后全量重建但保留展开态；跑完失败后**自动展开有失败的文件**（节点数被结果收敛）；④ 不做虚拟滚动（预算），登记 M2。
- **绿箭头**：`onDidChangeModelContent` → 防抖 200ms → 内容指纹与上次相同则短路（`inlineDiagnostics.ts` 指纹先例）→ `scanTestDefs` → `setDecorations`；仅在测试文件名 + 有工作区时武装，切 tab 重算。
- **运行继承**：`runTestNode(s)` 复用 `beginRunPreparing("test")` 闸门与 §3.9 预检；运行中树行 ▶ 与「重跑失败」置灰（`menuItems.ts` `scriptDisabledReason` 同款理由串）；后端同 id 会话槽复用（`terminal.rs:346` `kill_session` 已有）。
- **结果合入不重建 DOM**：`testView` 持 `Map<nodeId, 行元素>`；`applyResults` 后只切 class 与计数文本、每帧一次（logView chips 同款纪律）；文件 / 类汇总行同路更新。
- **失效重收**：`dep-fs-changed` → **立即打 stale chip**（用户立刻知道树旧了）→ 1s 防抖合并多次变更 → 单飞（已在收集中则跳过，stale 保留）→ 完成后替换树数据但**保留各文件展开态**（`Map<relPath, expanded>`）。
- **切工作区 / 关窗**：令牌作废 + 取消在途 collect（不留孤儿 python；缓存按 root 键天然隔离，无需清理）。
- **防连点汇总**：collect 按钮（同步闸门）· 树行 ▶ 与重跑失败（运行中置灰）· 刷新（收集中即取消）· 安装引导（`DEP_FIX_BUSY` 互斥已有）。

**行数代价**：分帧调度 + 进度 / 取消态 + stale chip + 展开态保留 + 行元素 Map ≈ **+80~100 行**——`testView` 520 → **600**、`testRun` 300 → **340**、`testTreeCore` 300 不变（分帧计划 `chunkPlan` 纯函数化直测）；bundle +约 3KB（43KB 总量仍在 63KB 余量内）。

---

## 4. 命令面与预算变更（显式 PR 事项）

| 项 | 现值 | 变更 | 理由 |
|---|---|---|---|
| `max_tauri_commands` | 206 | **207** | 产品负责人 2026-10-16 裁决扩大范围；新增为复用式单命令 `pytest_action`（四动作合一），运行 / 调试均不占命令面 |
| `pytest_cmds_rs_max_lines` | — | **650**（预估 ~530） | 新文件，scan/collect/cancel/result + junitxml 手写解析 + 单测 |
| `test_view_ts_max_lines` | — | **600**（预估 ~500；§3.10 交互态 +80） | 侧栏测试视图 |
| `test_tree_core_ts_max_lines` | — | **300**（预估 ~230） | 纯函数层（树构建 / 静态扫描 / 状态合入 / 分帧计划 chunkPlan） |
| `test_gutter_ts_max_lines` | — | **200**（预估 ~160） | 绿箭头 |
| `test_run_ts_max_lines` | — | **340**（预估 ~270；§3.10 缓存失效编排 +40） | 运行 / 结果接线 |
| `styles_testtree_css_max_lines` | — | **200**（预估 ~150） | 树样式新文件（不再往 style.css 堆） |
| bundle 总量 | 5,987 / 6,050 KB | **+约 43**（60KB 余量内，剩约 20KB；含 §3.10 交互态 +3） | 若实测超限：按章程要么拆（结果面板外提 / 按需 chunk）要么显式抬并写清理由——本次范围扩张即理由 |
| index 首屏 chunk | 约 1.62 / 1.70 MB | **持平** | testView 动态 import；冷启动红线不让步 |
| `sidebarViews.ts` | 116 / 130 | +约 6 | 只加登记，不改结构 |
| `main.ts` | 2,099 / 2,410 | +约 30 | 仅接线（setTestRunHandlers 类注入），不入逻辑 |

## 5. 文件落点

**新增**：

| 文件 | 层 | 职责 |
|---|---|---|
| `shell/src-tauri/src/pytest_cmds.rs` | Rust | `pytest_action`（scan / collect / cancel / result）+ junitxml 解析 + 单测 |
| `shell/src/testTreeCore.ts` | 前端纯函数 | `buildTestTree` / `scanTestDefs` / `applyResults` / `collectFailedIds` / `isTestFileName` / `buildNodeId`——零 app 依赖，vitest 直测（selectorCore 先例） |
| `shell/src/testView.ts` | 前端接线 | 侧栏视图渲染 / collect 触发与进度取消态 / 树交互（分帧渲染 + 展开态保留 + 行元素 Map）/ 三态 / stale chip |
| `shell/src/testGutter.ts` | 前端接线 | 绿箭头装饰与点击派发（防抖 + 指纹短路，runGutter 范式） |
| `shell/src/testRun.ts` | 前端接线 | `runTestNode(s)` / 结果读取与合入 / 重跑失败 / 缓存与失效订阅（1s 防抖合并）/ 令牌与切窗收尾 |
| `shell/src/styles/testTree.css` | 样式 | 树行 / 状态图标 / 三态（经 style.css 顶部 @import 内联，audit_tokens 覆盖） |

**改动**：`terminal.rs`（+约 60，kind="test" 分支）· `dap.rs`（+约 30，test_node 参数）· `run_env.rs`（提取 `resolve_run_interpreter`，三处共用）· `runState.ts`（RunKind + "test"）· `runFlow.ts` / `termUi.ts`（实例与 label 分支）· `menuItems.ts`（菜单数据源）· `views.ts` / `sidebarViews.ts` / `index.html`（视图登记）· `lib.rs`（命令注册）· `main.ts`（接线注入）· i18n 语言包（zh / en 约 60 键）· `ci/budgets.toml`（§4）。

## 6. i18n

新增文案走 `docs/i18n.md` 三步流程（映射 → `shell/tools/i18n/apply_ts.py` → 合并 zh 词条）；`test.*` 命名空间；命令面板 / 菜单快照类文案若引入须在 `onLocaleChange` 重建（本计划不新增命令面板条目，仅菜单与视图内文案）。

## 7. 测试策略

| 层 | 覆盖 |
|---|---|
| Rust 单测 | scan 过滤（忽略目录 / 文件名模式 / 保序 / 大仓性能哨兵）；collect 输出解析（正常 / 告警行 / 收集错误 / parametrize / 插件改写输出的 0 节点防护 / **`missing_module` 识别**）；junitxml 解析（failure / error / skipped / xfail / 缺 file 属性降级）；node_id 重建；kind="test" 命令构造（program / args / cwd 断言）；test_node 合成 |
| vitest | `testTreeCore`：树构建（顺序 / 嵌套 / parametrize）/ `scanTestDefs`（缩进类栈 / 同名消歧）/ `applyResults`（匹配 / 汇总 / 幂等）/ `collectFailedIds` / `isTestFileName` / **分帧计划 `chunkPlan`（帧大小与边界）** |
| mock e2e | 小型 pytest fixture 项目（`tests/test_api.py` + conftest + pyproject 声明 pytest）+ **2000 节点大 fixture**；`pytest_action` 在 invoke 边界 mock；树 DOM 断言；**pytest 缺失三态（missing_module）DOM 断言**；**大 fixture 首帧与展开的计时断言（§10 第 12 项）**；**连点 collect 只发一次 invoke**；绿箭头点击 → `run_in_terminal` 以 kind="test" 调用 |
| 真机 e2e | 新增 `pytest-real`（CDP + 隔离数据根）：真实 collect → 树；运行单用例 → 状态；失败 → 跳转；调试此测试 → 断点命中；取消 collect → 无孤儿进程；**collect 进行中编辑器输入不卡**。**依赖机器可用 pytest 环境**（uv 临时环境或系统 Python），不可用按既有 skip 口径跳过并在报告记录 |
| 门禁 | `cargo check` + `cargo test` · `npm test` · `npm run build` 后 `budget-check.mjs` · `npm run e2e` · audit_tokens · i18n 编译期对齐 |

## 8. 风险与已知边界

1. **collect 会导入测试模块**（可能有副作用）——pytest 发现机制固有（VS Code 同理）；缓解 = 按需 + 可取消 + 60s 超时，不常驻；
2. **大仓 collect 慢**（数秒~数十秒）——缓存 + 失效按需 + 取消；large_repo（88 文件）量级应秒级，真实巨型仓接受慢但可有界；
3. **junitxml `file`/`line` 需 pytest ≥ 6**——降级路径已定（classname+name 匹配 + 静态扫描行号）；
4. **glyph margin 三方协调**——注入式守卫 + 断点优先；同一次点击双动作由守卫杜绝；
5. **bundle 余量被吃掉约 68%**（63KB → 剩约 20KB，含 §3.10 交互态）——**下一个显著增量功能要么按需拆 chunk、要么显式 PR 抬阈值**，这是本次范围扩张的直接后果；
6. **收集输出格式漂移**（插件改写 `--collect-only -q`）——0 节点且退出码 0 时展示原文 + 警告，不静默空树；
7. **绿箭头静态扫描漏检**（奇异写法）——漏检仅无图标，菜单 / 树入口照常（runGutter 同款口径）；
8. **调试期无 stdin 交互**——管道模式既有口径（`input()` 场景用运行而非调试）。

## 9. 里程碑与闸门

| 里程碑 | 交付 | 闸门 |
|---|---|---|
| T1 | 裁决文档回写（dev_plan_v2 v2.2 · UX F-1 · 库支持 §8 · roadmap B1 · ADR-0010 注记）+ `pytest_action`(scan/collect/cancel) + `kind="test"` 运行分支 + `resolve_run_interpreter` 提取 + budgets.toml 修订 PR | 能收集（含取消 / 超时杀树无孤儿）；scan 骨架可用；能跑测试文件与单用例；traceback 可跳 |
| T2 | 第 9 侧栏视图 + scan 骨架先行 + 树渲染（动态 import）+ 缓存 / 失效 / 刷新 + 三态 + §3.10 交互态 | scan 骨架首帧 ≤ 300ms 可见（不依赖 collect）；空 / 收集错误 / pytest 未安装三态正确；.py 变更 stale chip + 防抖重收 + 展开态保留；collect 落地后增强不丢展开态 |
| T3 | 绿箭头 + `runTestNode` 接线 + 重跑失败 + `result` 解析与状态合入 + 失败跳转 + §3.10 不卡死纪律落地 | 失败点击 ≤ 2 跳定位；重跑失败一次调用；状态合入不重建 DOM；2000 节点 fixture 渲染与展开不卡（§10 第 12 项） |
| T4 | 调试此测试（dap `test_node` + 入口） | 单用例断点命中；三态互斥不破 |
| T5 | Rust / vitest / mock e2e / 真机 pytest-real + i18n + `docs/pytest_acceptance_record.md` + delivery-overview 回写 | Gate F（§10）全绿 |

估时 5~6 天（roadmap B1 原估 3~4d 对应最小闭环；增量 = 发现 + 树 + 绿箭头）。

## 10. 验收清单（Gate F）

1. 打开测试视图自动收集，树正确（文件 / 类 / 用例 / parametrize，保收集序）；
2. 三个入口（树行 ▶ / 绿箭头 / gutter 菜单）运行单用例，结果状态合入，失败点击跳转；
3. 重跑失败一次调用跑完；
4. 调试此测试断点命中，停止后三态复位；
5. pytest 未安装：四层防线各自生效（§3.9）——E1/E2 静态信号可见、运行前预检确认框、collect `missing_module` 三态、toast 安装出口；安装命令按 style 分支正确（pyproject → `uv add --dev pytest`；bare → `uv pip install`；已声明 → sync 建议）；
6. .py 变更 → 缓存失效 → 自动 / 手动重收；
7. collect 可取消（按钮 + 60s 超时），杀树无孤儿进程；
8. 预算：命令 207 · bundle ≤ 6,050 KB · index chunk ≤ 1,700 KB · 新增文件不破各自行数上限；
9. 门禁全绿（cargo / vitest / tsc / budget-check / e2e mock / audit_tokens / i18n 对齐）；
10. 真机 `pytest-real` 通过（或按 skip 口径留证）；
11. 文档：`docs/pytest_acceptance_record.md` + delivery-overview / roadmap 状态回写。
12. 不卡死（§3.10）：2000 节点 fixture——scan 首帧 ≤ 300ms 可见文件骨架（不依赖 collect）、展开单文件分帧不阻塞、跑完失败自动展开失败文件；collect 进行中编辑器可正常输入；连点 collect 不双 spawn；切走视图 collect 后台完成静默入缓存；切工作区 / 关窗无孤儿 python 进程。

## 11. 开工前必读

- `ci/budgets.toml` 顶部纪律：阈值只允许显式 PR 抬升，脚本绝不自动抬；
- Rust 规范红线：杀子进程必须 `util::kill_process_tree`（collect 取消 / 超时）；阻塞命令 async + `spawn_blocking`；退出监视按实例 seq 锁定；
- TS 规范红线：`main.ts` 不堆逻辑（走 handlers 注入）；路径比较走 `samePath` / `normalizePath`；disposable 入 `DisposableStore`；删样式类前搜 TS 侧选择器钩子；
- 运行域不变式：`python_run_dev_plan.md` §7.1（实例与 tab 同生共死）/ §7.5（preparing 收口硬规则）；
- i18n 三步流程（`docs/i18n.md`）；
- 断言体积前必须 `cd shell && npm run build`（陈旧 dist 会虚报）；
- probe 开销红线：测试运行经同一 `build_run_env`，采集路径未变，无需 bench 回归；若未来改采集路径必须 bench。
