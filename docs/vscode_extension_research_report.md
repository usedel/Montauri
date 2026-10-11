# VS Code Python 插件调研报告与 OpenCharm 借鉴建议

> 版本：**v1.0** · 日期：**2026-10-10** · 性质：**调研报告（非排期依据）**
> 调研方法：VS Code Marketplace 榜单 + 中英文社区榜单交叉（4 篇 2026 年榜单，见 §7）+ **本仓库 `shell/` 源码逐项核对**（证据见 §3，均为 file:line 级）。
> 结论用途：为 Phase 4「打磨期」的功能取舍提供输入。**是否立项、何时排期仍以 `docs/python_ide_dev_plan_v2.md` 及产品负责人裁决为准**（与 `docs/pycharm_feature_research_report.md` 同性质）。
> ⚠ **口径纪律（本报告不得被越界引用）**：本报告只做**能力覆盖对照**，不做质量优劣对比。**禁止**据此写出「OpenCharm 比 VS Code / Pylance 更好 / 更准」类表述——横向对标纪律见 `README.md`「已知边界」与 `docs/improvement_and_roadmap_report.md` §5「口径纪律」（可写口径只有自证：自有样例集 **23/23**）。

---

## 0. 一页结论

**VS Code Python 插件榜前 10 名，OpenCharm 已有 9 项等价物**（逐项源码核对，§3.1）。真正的能力空白只有 4 项，且全部满足「小、零新依赖、与画像（FastAPI + 爬虫 + 小脚本）相关」——**不需要动 `ci/budgets.toml` 预算即可落地**：

| 序 | 借鉴项 | 对标插件 | 缺口性质 | 成本量级 |
|---|---|---|---|---|
| 1 | **行内诊断文案** | Error Lens | 全仓无相关代码 | 小（复用 `deltaDecorations` 基建） |
| 2 | **Scratch / 单元格执行** | Jupyter 的 cell 执行 | 候选池 **B2** 已列（★★★） | 小-中（复用 `libEval` + PTY） |
| 3 | **字符串字面量路径补全** | Path Intellisense | 补全六源中**无路径源** | 小-中（须钉 sortText 段位） |
| 4 | **CSV 数据查看器** | Rainbow CSV / SQLite Viewer | 只有 CSV **导出**，无查看 | 中（可复用 SQLite Grid 组件） |
| — | Git 提交图（低优先） | Git Graph | 功能面已覆盖，仅缺可视化 | 小 |

**另有 5 项明确不学**（§5）：AI 三件（IntelliCode / Copilot / Sourcery）、Test Explorer、Remote-SSH / WSL、Mermaid——全部与既有裁决或 ADR-0010 冲突。

**战略结论**：Python 开发者的刚需是**收敛**的，不需要插件生态来补齐。榜单前 10 名覆盖率约 90% 这一事实，正面支撑「不做插件市场」的定位裁决（`improvement_and_roadmap_report.md` §7）——**但「装一堆扩展」这个模式本身不要学**：VS Code 的强项是生态，OpenCharm 的强项是零配置开箱 + 单色相轴视觉 + 体积预算，把生态当卖点是与 ADR-0010 直接对撞的路。

---

## 1. 调研范围与方法

- **调研对象**：VS Code 中 **Python 开发者实际高频安装**的扩展（按安装量档位 + 4 篇 2026 年榜单交叉）。
- **明确排除**（与项目非目标对齐，`dev_plan_v2` §1.1 + `improvement_and_roadmap_report.md` §7）：AI 助手类、测试运行器类、远程/容器开发类、多语言类、协作编辑类。
- **现状盘点方法**：对 `shell/src/*.ts` 与 `shell/src-tauri/src/*.rs` 逐项核对，证据写入 §3 表格；并与 `docs/tech-debt.md`、`improvement_and_roadmap_report.md` §3 候选池去重（避免把「已在候选池」当成「新发现」）。
- **已知方法局限**：Marketplace 安装量只作**档位**判断（平台不提供可复核的精确时序数据，本报告不引用具体数字）；社区榜单存在互相抄录，故只取**四篇交叉一致**的项入榜。

---

## 2. 榜单：Python 开发者最常用的 VS Code 插件

### 2.1 分档（按普及度）

| 档 | 插件 | 定位 |
|---|---|---|
| **必备**（几乎人人装） | Python（`ms-python.python`）· Pylance · Python Debugger · Jupyter | 官方四件套；解释器选择 / 运行 / 调试 / IntelliSense / Notebook |
| **高频** | **Ruff** · Black Formatter · GitLens · **Error Lens** · autoDocstring · Pylint / Flake8 / mypy / isort | Ruff 正在**统一取代**后四个 linter + Black（Rust 实现，快 10~100x） |
| **画像相关**（FastAPI + 爬虫） | REST Client / Thunder Client · SQLite Viewer / SQLTools · Rainbow CSV · Jupyter 变量浏览器 / Data Wrangler | 请求调试、库表查看、抓取结果速览 |
| **边缘**（单点提效） | Indent Rainbow · Sort Lines · Dash（离线文档）· Path Intellisense · Git Graph · Better Comments · Todo Tree · Code Spell Checker | 多数可被编辑器原生能力或既有功能覆盖 |
| **已淘汰**（不要照抄） | Kite（2022 停止）· Jedi Language Server · YAPF Formatter · Anaconda 扩展 · Visual Studio IntelliCode（已被 Copilot 取代） | 榜单里仍会出现，但已无维护或已被官方替换 |

### 2.2 榜单内的三个更替信号（对产品判断有价值）

1. **「多个 linter 扩展」时代结束**：Flake8 / Pylint / mypy / isort / Black 五个扩展正被 **Ruff 一个**吸收。⇒ 语言工具链正在从「装 N 个扩展」收敛为「装 1 个二进制」——这对「**内置而非扩展**」的产品形态是**顺风**，不是逆风。
2. **原生能力持续吞掉扩展**：Bracket Pair Colorizer 已被编辑器原生集成（现已 archive）；Indent Rainbow 的功能在多数主题里已被缩进参考线覆盖。⇒ 装饰类扩展**不值得做**（与视觉报告 §7「往代码区加装饰不做」同向）。
3. **AI 扩展在 2026 年成为「桌面标配」但并非 Python 专属**：Copilot / Claude Code / Codeium 与 Python 无关，属通用层。⇒ 本项目的「不做 AI」是**定位选择**而非能力缺失，但对外叙事需预期用户会问（§5）。

---

## 3. 逐项对照（OpenCharm 现状，附源码证据）

### 3.1 已有等价物（9 项，无需借鉴）

| # | 插件 | OpenCharm 等价物 | 源码证据 |
|---|---|---|---|
| 1 | Pylance | pyrefly（静态）+ intel（运行时）双引擎 | 补全四层合并 / 跳转 / hover / 诊断 / inlay hint / 签名帮助（`shell/src/lsp/client.ts` · `intel/`） |
| 2 | Python（扩展本体） | 解释器与环境选择 + 运行 + traceback 点击跳转 | 环境面板 · 统一 PTY（`shell/src-tauri/src/terminal.rs`）· `run_env.rs` |
| 3 | Python Debugger | **已超出「最小闭环」**：条件断点 / 命中次数 / Logpoint / 变量 / 调试控制台求值 / Watches | `shell/src/debugGutter.ts:309`（右键断点菜单）· `debugWatches.ts` · `debugConsole.ts:156`（Logpoint 走 DAP output 事件） |
| 4 | Ruff | 格式化 + 导入整理，**且缺席有引导安装**（会话内提示一次 + 「安装 ruff」动作） | `shell/src/format.ts:1-3`（`ruff format --stdin` / `check --fix I,F401`，独立子进程不占 LSP 桥 stdin） |
| 5 | GitLens | Git 迭代 0–6：远程 / worktree / rebase / cherry-pick / stash / log / blame / **远端克隆** | `docs/git_improvement_report.md` · `git_clone_dev_plan.md` |
| 6 | SQLite Viewer | B3 SQLite 工具 v1.4（编辑器 Tab 化） | `docs/sqlite_tool_dev_plan.md` · `shell/src/sqliteTabs.ts` |
| 7 | REST Client | B4 HTTP 工具（devtools 面板驱动：发送 / 响应 / 变量 / 历史 / curl 导入 / 端点联动） | `docs/toolbox_dev_plan.md` §5.9–5.11 · `shell/src/devtools/builtin/http.ts` |
| 8 | autoDocstring | `"""` + Enter 按签名生成 Args / Returns（def）或 Attributes（class）骨架 | `shell/src/live-templates/docstring.ts` |
| 9 | Indent Rainbow / Bracket Pair | 设置面板可开关的括号着色 + 缩进参考线 | `shell/src/settingsPanel.ts:478`（`bracketPairColorization`）· `:746`（`indent_guides`） |

> **额外覆盖**（榜单外但常与上列同装）：TODO 增强（`e2e/todo/` 7 条）、依赖健康扫描/修复（`dep_health_dev_plan.md`）、Markdown 预览、多窗口、i18n 双语——均非本报告借鉴对象。

### 3.2 真空白（4 项 + 1 低优先）

| # | 插件 | 核对结论 | 证据 |
|---|---|---|---|
| 1 | **Error Lens** | 全仓**无**相关实现（诊断只进 Problems 面板 / 编辑器波浪线，无行尾文案） | `grep -rni "errorlens" shell/src/` 零命中 |
| 2 | **Jupyter 的 cell / Scratch 执行** | 无 Notebook / cell 模型；已有 `libEval` 求值桥 + PTY 但未接「选中即跑」 | 候选池 B2（`improvement_and_roadmap_report.md` §3 B 类，★★★） |
| 3 | **Path Intellisense（字符串路径补全）** | 补全注册源共 6 处，**无路径源**：LSP / keyword / autoImport / importAlias / liveTemplate / wordBased | `lsp/client.ts:678` · `completion/keywordCompletion.ts:76` · `autoImport.ts:272` · `importAlias.ts:204` · `live-templates/completion.ts:35` · `completion/wordBasedSuggestions.ts` |
| 4 | **Rainbow CSV / CSV 查看器** | CSV 只做**导出**（SQLite 结果 → UTF-8 BOM CSV）与整行复制，**无独立 CSV 打开/查看视图** | `shell/src/sqliteTabs.ts:609`（导出表）· `:923`（导出查询结果）· `sqliteGrid.ts:111` |
| 5 | Git Graph（低优先） | Git **功能面**已覆盖（log / blame / history），仅缺提交图可视化 | 同 §3.1 第 5 行 |

---

## 4. 借鉴建议（按性价比排序）

> 每项给出：价值 / 缺口 / 落点 / 成本 / **纪律与风险** / **不做的条件**。成本为量级估计（人日），非承诺。

### 借鉴-1 · 行内诊断文案（对标 Error Lens）— **性价比最高**

- **价值**：pyrefly 严格模式下诊断数量大，去 Problems 面板逐条点开是当前最主要的摩擦点。行内文案把「哪一行、错什么」压进视线范围。
- **落点**：Monaco `deltaDecorations` / `afterContentClassName` 基建**已存在**（`inlineValues.ts` 行内值、`debugGutter.ts` 断点 glyph 同款机制），无需新依赖。
- **成本**：小（约 0.5~1d，含设置项 + i18n 三步流程 + 单测）。
- **⚠ 纪律与风险（必须前置约束，否则会变成噪音墙）**：
  1. **只显示 `error` / `warning`**，不显示 info / hint（Error Lens 官方也建议如此）；
  2. **只在光标所在行 ± 邻近行显示**（或仅在当前可见行显示）——全量行尾文案 + 严格模式 = 视觉污染，与视觉报告 §7「装饰有害」同一判断；
  3. 文案长度截断，不换行、不撑行高（避免破坏 `ui-baseline` 截图基线）；
  4. 必须是**设置项且默认关**（沿用「性能模式」同款默认关纪律）。
- **不做的条件**：若第 2 条约束在真机上仍造成明显噪音（需真机截图评估），则不做——**宁可没有，不要噪音**。

### 借鉴-2 · Scratch / 单元格执行（对标 Jupyter 的 cell 执行）

- **价值**：对「小脚本」画像是**真高频**（改一行看一行输出）。这是候选池 **B2** 已有条目，本报告只做**证据补充**：榜单侧对应的是 Jupyter 的 cell 执行，而非整个 Notebook 形态。
- **落点**：复用 `libEval` 求值桥（**注意**：A4 选择器测试器明确**不走**该桥，勿引为先例）+ 终端 PTY 长驻进程。
- **成本**：小-中（约 2d）。
- **⚠ 纪律与风险**：① 长驻进程与 ADR-0010「按需加载优先于常驻」直接相关——**必须按需起、可显式关闭、空闲即回收**；② 不做 Notebook 文件格式（`.ipynb` 会引入体积与新的持久化契约，属体积红线区）。
- **不做的条件**：若必须引入常驻进程且无法按需回收 → 不做。

### 借鉴-3 · 字符串字面量路径补全（对标 Path Intellisense）

- **价值**：爬虫 / 小脚本场景 `open()` / `Path()` / `pd.read_csv()` / `glob()` 写路径是高频动作，目前只能手打。
- **落点**：新增一个补全源（`shell/src/completion/` 下新增模块 + 注册），**必须复用既有四层合并机制**。
- **成本**：小-中（约 1~2d）。
- **⚠ 纪律与风险（本项风险最高）**：
  1. **sortText 段位**：补全四层合并的段位顺序是固定契约（模板 `0xx` → intel `1xx` → 静态 `2xx` → 关键字 `3xx`）。新来源**必须明确钉段**，不得插队（`improvement_and_roadmap_report.md` §7「破坏六段 sortText 契约的补全来源 不做」）；
  2. **触发条件收紧**：只在**字符串字面量内**、且上下文可判定为路径参数时触发，否则会在任何字符串里弹出文件列表（噪音）；
  3. 大目录（`node_modules` 级）必须有条目上限与忽略规则，避免补全变慢。
- **不做的条件**：若无法把触发条件收紧到「不产生误弹」，则不做。

### 借鉴-4 · CSV 数据查看器（对标 Rainbow CSV / SQLite Viewer）

- **价值**：爬虫抓下来的第一站通常是 CSV；现状只有「导出 CSV」，没有「打开 CSV 看一眼」。
- **落点**：**复用 SQLite Grid 组件**（`shell/src/sqliteGrid.ts` 已有虚拟化表格 + 列筛选 + 复制整行），只需补一个 CSV 解析 + 只读数据源适配层。
- **成本**：中（约 2~3d）。
- **⚠ 纪律与风险**：① CSV 解析**不得引入第三方依赖**（零依赖实现，处理引号转义 / BOM / 换行符；参考 `sqliteGrid.ts:114` 既有 `csvCell` 的反向逻辑）；② 大文件必须有行数上限与懒加载（同 SQLite 的 `HARD_MAX_ROWS` 口径）；③ 编码探测不做过度承诺（UTF-8 / BOM 优先，其余显式提示而非猜测）。
- **不做的条件**：若必须引入 CSV 解析依赖 → 不做（体积红线）。

### 借鉴-5 · Git 提交图（对标 Git Graph）— 低优先

- **价值**：仅可视化增益。Git **功能面**（log / blame / history / rebase / cherry-pick / stash）已全部交付。
- **成本**：小（渲染提交图 + 分支泳道）。
- **⚠ 纪律与风险**：属「锦上添花」，与 B6（Mermaid）终止的判据同类。**建议不排期**，除非出现明确使用场景。
- **不做的条件**：默认不做。

---

## 5. 明确不学（与既有裁决或 ADR-0010 冲突）

| 不学 | 强度 | 依据 |
|---|---|---|
| IntelliCode / Copilot / Sourcery / Codeium 等 AI 能力 | **不做** | `dev_plan_v2` §1.1 明列「明确不做 AI」；`improvement_and_roadmap_report.md` §7 |
| Python Test Explorer / 测试运行器 | **不做** | 三处一致裁决：`dev_plan_v2` §1.1 · UX 报告 **F-1（2026-09-25 已裁决）** · 库支持研究 §8「不复议」 |
| Remote-SSH / WSL / Dev Containers | **登记不排期** | 成本高，与 Windows 单机画像契合度低 |
| Mermaid / Markdown 大纲 | **不做** | B6 终止裁定（唯一引入新依赖 + 未验证项，与 ADR-0010 体积条款冲突，**不得再排期**） |
| 「装 N 个扩展」这一模式本身（插件市场 / 生态补齐） | **不做** | 插件市场裁决不做；**且本报告 §2.2 给出反向证据：Python 工具链正在收敛为「1 个二进制」，「内置而非扩展」是顺风** |

**另需预期的一条对外问答**：榜单里 AI 扩展已成桌面标配，用户会问「你们为什么没有」。建议对外统一口径为**定位选择**（轻量 / 零配置 / 不引入常驻与体积），而非能力缺失——**不得**写成「AI 没用」这类价值判断（与 `CONTENT-SERIES.md` 的对外写作纪律同向）。

---

## 6. 与既有裁决 / 候选池的交叉（去重声明）

- 借鉴-2 **等同候选池 B2**（REPL / Scratch），本报告不新增条目，只补榜单侧证据；
- 借鉴-1 / 3 / 4 为**候选池未列**的新增选题，建议由产品负责人决定是否并入 `improvement_and_roadmap_report.md` §3 候选池（**本报告不改动该文件**）；
- §3.1 的 9 项等价物中，**A3④ / A4② / A4-Py** 三项已按既有覆盖关闭不立项（2026-10-07 收口），与本报告结论一致，不重复推荐；
- 本报告**不引入**任何与 `ci/budgets.toml` 冲突的方案；§4 各项的「不做的条件」均以预算与噪音为否决依据。

---

## 7. 取数与复核

**榜单来源（4 篇交叉，2026 年）**：

| 来源 | 用途 |
|---|---|
| VS Code Marketplace（`ms-python.python` / `ms-python.vscode-pylance` 等条目页） | 档位判断（不引用具体安装量数字） |
| `itsourcecode.com`《Best VS Code Extensions for Python Developers (2026 Ranked)》（2026-07-30） | 12 项排名 + 「最小起步五件套」+ 已淘汰清单 |
| `towardsthecloud.com`《10 Best VS Code Extensions for Python Developers》（2026-03-26） | 交叉核对 |
| 腾讯云开发者社区《VS Code python 插件榜 top 10》（2026-04-16） | 中文侧交叉核对（补充 Sort Lines / Dash / IntelliCode） |

**源码证据复核命令**（本报告 §3 全部结论可复现）：

```bash
cd shell
grep -rni "errorlens" src/                                   # 借鉴-1：应零命中
grep -rn  "registerCompletionItemProvider" src/ --include=*.ts # 借鉴-3：应为 5 处，且无路径源
grep -rn  "docstring" src/live-templates/                     # §3.1 第 8 行
sed -n '1,10p' src/format.ts                                  # §3.1 第 4 行（ruff provider）
grep -rn  "csv" src/sqliteTabs.ts src/sqliteGrid.ts           # 借鉴-4：仅导出，无查看
```

**复核触发条件**：① VS Code Python 扩展出现**结构性变化**（如官方测试 API / Notebook 协议 / Ruff 被官方收编）；② 候选池 §3 有 ≥2 项被立项或终止；③ 季度评审。

---

## 附：本报告引用的关键文档

`docs/python_ide_dev_plan_v2.md` §1.1（不做清单）· `docs/improvement_and_roadmap_report.md` §3（候选池）/ §7（明确不做）· `docs/adr/0010-performance-lightweight-charter.md`（体积与轻量章程）· `docs/pycharm_feature_research_report.md`（同性质调研报告的体例来源）· `README.md`「已知边界」（横向对标口径纪律）
