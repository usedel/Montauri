# PyCharm 口碑调研与 OpenCharm 改进建议

> 版本：v1.0 · 日期：2026-09-25 · 性质：调研报告 + 改进建议（**非排期依据**）
> 上游文档：`docs/pycharm_feature_research_report.md`（v1.1，功能清单视角，P0/P1/P2 共 13 项已闭环）
> 本文定位：上一篇回答的是「PyCharm 有哪些功能我们没有」，本文回答的是另一半——**「用户真正爱/恨 PyCharm 的哪些细节，其中哪些是设计原则层面的经验」**。功能清单已基本采摘完毕，剩下的价值在「品味与纪律」。
> 排期依据仍以 `docs/python_ide_dev_plan_v2.md`（v2.0）为准并需产品负责人裁决；本文 §6/§7 的建议仅为候选池。

> **裁决与执行记录（2026-09-25，产品负责人）**：
> 1. **P0 / P1 / P2 三批已全部交付并验收**（A-1/A-2/A-3/A-5/C-1/C-2/C-6/B-1/B-2/B-3/B-6/B-7/B-8，共 13 项，详见 §10–§15 与 §14 批次总结）。
> 2. **F-1（pytest 相关）维持非目标**——严格遵守 dev plan v2 §1.1，不做任何测试运行器相关能力（含 gutter 入口）。
> 3. 后续开发按 §14「剩余候选池」推进（建议顺序见 §16.5）；**新会话开工前必读 §16 交接指南**。

---

## 0. 一页结论

PyCharm 的口碑呈现一个**高度对称的结构**：

> **人们爱它的，和人们恨它的，是同一件事的两面——「它什么都做了，所以又重又复杂」。**

- **好评集中在「确定性能力」**：可视化调试器、重构（尤其 Shift+F6 重命名）、深层类型推断、Local History、Git 集成、导航闭环、batteries-included 的「开箱即用」。这些能力的共性是：**用户不需要配置、不需要装插件、不需要思考，它就在那儿且是对的**。
- **差评集中在「代价」**：内存/CPU/风扇（"resource pigs"、"space heater"）、需要每隔几天重启一次、索引慢且索引期间几乎不可用、大版本升级回归、海量输出时 UI 冻结、功能与设置过多导致新手不知所措、静态分析反被专用 LSP（pyrefly/ty）超过、AI 与订阅策略混乱。

对 OpenCharm 的战略含义只有两句：

1. **「轻」是我们唯一无法被抄袭、且 PyCharm 结构性无法修复的护城河**——它是 JVM + 全量索引架构的必然代价，不是调参能解决的。所以我们要做的不是"更轻"（已经轻了），而是**让"轻"可证明、可感知、可持续**（§6-A）。
2. **「默认就对」是 PyCharm 好评的真正来源，而不是功能数量**。我们已经把功能清单补齐到 13/13，但**「默认就对」还差 6 个具体缺口**（§5 表中 🟡/❌ 项），这些缺口全是小成本、高体感的：智能选区、移动行、分屏、输出护栏、会话恢复、诊断可配置。

---

## 1. 调研方法与来源

| 来源 | 性质 | 用法 |
|---|---|---|
| Hacker News 评论（Algolia API，`created_at_i > 2024-01`，PyCharm 相关 40 条样本） | 真实开发者自发评价，含大量 2026 年新评论 | 好评/差评的**原声引用**（§2/§3 标注日期与作者） |
| JetBrains 官方支持社区 / YouTrack（如 `Pycharm 2025.3 - badly broken`、PY-80871 性能 issue） | 一手故障反馈 | 差评的**症状细节** |
| 中文技术社区（CSDN/知乎/Baidu 文库大量「PyCharm 卡顿/内存/索引调优」文章） | 中文用户痛点分布 | **侧面证据**：某类问题如果形成了"调优攻略"产业，说明它是普遍性痛点而非个例 |
| JetBrains 官方文档（Productivity Guide、Local History 等） | 功能行为事实 | 好评项的**行为细节**校正 |
| 本仓库现状盘点（2026-09-25，`shell/src`、`shell/src-tauri/src` 逐项核对，共 33 项） | 一手现状 | §5 差距表与 §6 建议的落点 |

**方法局限（如实声明）**：
1. HN 样本偏向资深/CLI 取向开发者，对 PyCharm 的负面评价天然偏多；本文已用「好评原声」做对称取样，不做量化统计，只提取**反复出现的具体细节**。
2. 「调优攻略文章多」只能证明痛点普遍，不能证明根因；根因判断基于架构推理（JVM 堆 + 全量索引 + Swing 渲染），属合理推断而非官方结论。
3. Reddit 来源本次未能抓取（反爬），未纳入结论。

---

## 2. 广受好评的细节（值得学）

> 每条结构：**行为细节 → 为什么好 → 社区原声 → 对 OpenCharm 的启示**

### 2.1 调试器：PyCharm 的「killer feature」

| # | 细节 | 为什么好 |
|---|---|---|
| D-1 | **可视化调试器整体**（断点/步进/栈/变量/求值/Watches 一体化） | 长期订阅用户公认的"留住我的那一个功能" |
| D-2 | **变量面板递归展开 + 行内值（inline values）** | 不用打开面板就知道这一行的值，减少视线跳转；"incredibly powerful" |
| D-3 | **条件断点 / 命中次数 / Logpoint** | 循环里第 N 次才断下，是脚本/爬虫调试的刚需 |
| D-4 | **Evaluate Expression / Debug Console** | 从"能看"到"能问"的分水岭 |
| D-5 | **Watches（持久化监视表达式）** | 跨断点、跨帧一直盯着几个关键表达式，比反复手输 evaluate 高一个量级 |
| D-6 | **异常断点（Exception Breakpoint）** | 不设断点也能停在异常抛出处，排查"偶发崩溃"的第一手段 |
| D-7 | **只步进我的代码（Step into my code）** | 不误入 site-packages，Python 这种重库语言里的必需项 |

**社区原声**：
- b33j0r（2026-06-11）："I have had a jetbrains subscription since pycharm came out, and the **killer feature was always the visual debugger**."
- noir_lord（2015-06-26，关于行内变量值）："That is incredibly powerful (PyCharm has it as well)."

**对我们的启示**：我们的调试「最小闭环」已通，且条件断点/Logpoint/Evaluate/行内值/Set Value/Run to Cursor 均已交付（见 v1.1 报告 §4）。**剩下的差距恰好是 D-5/D-6/D-7 三项 + hover 求值 + 线程切换**，且全部是 DAP 协议字段级工作（§6-B）。其中 **Watches 与异常断点是"有和没有"的体感断层**，优先级最高。

### 2.2 重构与代码智能

| # | 细节 | 为什么好 |
|---|---|---|
| R-1 | **Shift+F6 重命名**（含预览与"在注释/字符串中一并改"选项） | 最高频重构；社区称"离开一个编辑器时最想念的就是它"，并且"写第一遍时不用费心想名字" |
| R-2 | **深层类型推断**（多重继承/复杂类层次的推断能力） | 在类型检查器横向评测中被认为仍是最强的一档 |
| R-3 | **Alt+Enter 意图动作**（自动补 import、就地创建函数/变量、改写成更好形式） | "没坏但可更好"的建议，是 PyCharm 的"聪明感"主要来源 |
| R-4 | **未使用/未解析符号的即时 inspection** | 静态卫生即时可见 |

**社区原声**：
- mhitza（2026-05-29）："**Shift-F6 (rename refactor) is my goto, and what I miss most in a code editor**. It also takes away the mental tax burden of thinking up good names for things."
- insane_dreamer（2026-06-08）："PyCharm's built-in type checker is **far and away the best** that I've used with **proper type inference through multiple class inheritance hoops**."
- darkwi11ow（2026-09-22，反面）："vscode with **pyrefly LSP is miles better than Pycharm today**."

**对我们的启示**：PyCharm 在**静态**推断上仍被公认最强（R-2），但在**纯静态分析**上已被专用 LSP 反超（见 §3-F）。我们的差异化是**运行时补静态**（intel），这恰好命中两者之间的空档——**凡是"静态推不出来但跑过的代码"，我们应当比 PyCharm 更准**。这条要作为补全准确率对标的宣传口径与验收方式（§8）。
R-1/R-4 我们已有（rename widget + ghost 预览 + ruff 第三诊断桶）；**R-3 我们只有"引擎给的 code action"，缺自研的 add-import 与 create-from-usage**（§6-D）。

### 2.3 容错：Local History

**行为细节**：不依赖 Git，自动在每次保存/外部修改时快照，可查看任意文件/目录的历史、diff、回滚，还能打标签。

**社区原声**：insane_dreamer（2026-08-06）："JetBrains PyCharm has a similar 'local history' feature that solves this very real and existing problem and **has saved my ass more than once** when accidentally overwriting changes before committing or fubar'ing a git reset."

**对我们的启示**：我们**已交付**本地历史（`history.rs` + `localHistory.ts`，Ctrl+Shift+H）。但要检查两点「学到了吗」：
1. PyCharm 的 Local History **不只是文件级**，还能对目录/选中区域看历史——我们的实现是文件级；
2. PyCharm 的价值在于**"无 Git 也无忧"**，而我们的目标用户画像（自用小脚本，常不在 Git 仓库）完全吻合，属于**押对了的赌注**，应把它做得更可发现（菜单 + 命令面板 + 文件树右键都应有入口）。→ §6-E-3

### 2.4 Git 集成（被"用过很多 Git 工具"的用户评为最佳）

**社区原声**：insane_dreamer（2026-07-21，自称用过很多 Git 工具）："**IMO pycharm's internal implementation is still the best**"，具体举了三点：
1. **任意分支 diff 任意分支**（lazygit 只能对"推断出的主分支"diff）；
2. **查看单个文件的 git 历史**（含这些提交在哪些分支上），并可钻取进提交；
3. **在 GitHub/GitLab 打开提交**（分享给同事的最短路径）；
4. 另一个细节：**只暂存单个文件时，提交信息自动预填该文件名**，且可编辑（Zed 也会插入但不允许编辑）。

**对我们的启示**：我们的 Git 集成已覆盖状态/暂存/提交/diff/分支/合并（`git.ts`、`gitMerge.ts`）。**缺的是"文件级历史"与"提交信息预填文件名"**——两者都是几十行代码、但每天都用的细节。→ §6-E-4

### 2.5 导航闭环

Search Everywhere（Double Shift）、Go to File/Line、Recent Files/Locations、后退/前进、Find Usages、Breadcrumbs——这一组在 v1.1 报告里被判定为"PyCharm 用户黏性最强的部分"，且我们**已全部交付**。

值得加学的一个细节：**PyCharm 的 Find in Files 支持「scope 意识」**（本次文件/整个项目/模块/自定义 scope），且搜索结果可折叠、可"下一个出现处"连续跳转。我们的全局搜索（`search.ts`）已有，建议补 **scope 快捷切换**（当前文件 / 打开的标签 / 整个工作区）与结果分组折叠。→ §6-C-6

### 2.6 编辑器微交互（"顺手"的主要来源）

| 细节 | 说明 | 我们现状 |
|---|---|---|
| **Extend/Shrink Selection**（Ctrl+W） | 语法感知逐步扩大选区：词 → 表达式 → 语句 → 块 → 函数 | ❌ 未实现 |
| **Move Line/Statement Up/Down** | 整行/整语句上下移动，自动修正缩进 | ❌ 未实现（仅复制行 ✅） |
| **Duplicate / Delete Line** | | 🟡 复制行 ✅，删除行靠内核默认 |
| **Column/Box Selection** | 矩形选区 | ❌（多光标 ✅，列选择 contrib 未引入） |
| **Split Editor** | 同一文件垂直/水平拆分，独立滚动 | ❌ 未实现 |
| **Compare with Clipboard** | 当前文件/选区与剪贴板 diff | ❌ 未实现 |
| **Region 折叠 / 缩进参考线 / 括号彩色化** | 长脚本可读性 | 🟡 折叠内核可用但未配置，无 guides/彩色括号 |
| **Folding/参数提示/多光标/Surround** | | ✅ |

**对我们的启示**：这一组是**"每天都用几十次、缺了就说不清哪里别扭"**的典型。Monaco 侧基本都有现成 contrib 或内核 action，**成本极低、体感极高**。→ §6-C

### 2.7 「可发现性」本身就是功能

**社区原声**：DrewADesign（2026-07-30，从配置精良的 neovim 迁到 JetBrains）："the **discoverability of functionality was waaaaay better** … with a few single-click-install plugins … it did everything I needed **within 5 minutes on any machine I sat down at**."

**PyCharm 的对应设计**：Productivity Guide（统计你用了哪些功能、省了多少时间，并推荐你还没用过的功能）、Search Everywhere 里能搜到设置项与动作、键位提示出现在菜单与补全里。

**对我们的启示**：我们已经有命令面板（`quickOpen.ts`，文件/符号/命令混搜 + 键位提示）、欢迎页快捷键（`welcomeShortcuts.ts`）、菜单栏。**缺的三处**：设置面板搜索（§6-E-1）、引擎/忙碌状态可见（§6-E-2）、以及"你还没用过但很有用"的主动推荐（可选，对标 Productivity Guide）。

---

## 3. 广受批评的点（值得反思/防守）

> 每条结构：**症状 → 架构根因 → 社区原声 → 对 OpenCharm 的反思**

### 3.1 资源占用：内存、CPU、风扇、需要定期重启

**症状**：长时间运行后逐渐变慢，滚动与输入掉帧，需每隔几天重启；风扇狂转；平板/轻薄本上不可用；升级大版本后即使加大堆内存仍冻结。

**根因（推断）**：JVM 堆 + 常驻全量索引 + Swing 渲染 + 插件叠加；属于架构性代价，用户侧只能"调优"（调 Xmx、排目录、禁插件），无法根治——这正说明它是结构性的。

**社区原声**：
- the__alchemist（2026-09-22）："**I <3 JB IDEs for their functionality, but resource pigs they are.**"；"They will bring a 9950x with nothing else running to a crawl."
- zipy124（2026-07-24）："I **frequently have to restart PyCharm every few days**, as it slows so bad that it cannot scroll or type smoothly. This is on a very powerful macbook pro."
- the__alchemist（2026-08-05）："I have Zed on my tablet as IntelliJ (PyCharm/RustRover) **turn it into a space heater**."
- JetBrains 官方社区（2025-12）：升级 2025.3 后 "extremely slow and freezes my entire Mac"，内存上限从 2GB 提到 8GB 仍冻结。
- 中文侧：CSDN/知乎上存在大量「PyCharm 卡顿优化」「内存设置」「索引优化」攻略，构成一条完整的"民间调优产业"。

**反思（这是本文最重要的一条）**：
我们的架构（Tauri 2 + WebView2 + 独立进程 LSP/intel/debugpy/probe）**结构性更轻**，但"轻"目前只是**事实**，不是**资产**。要做三件事把它变成资产：
1. **可观测**：让用户看见每个子进程吃了多少（§6-A-1）；
2. **可证明**：把冷启动/内存/长跑内存增长纳入 CI 红线（§6-A-4）；
3. **可持续**：明确禁止任何"无界增长"的数据结构（§6-G 红线）。

### 3.2 索引：慢、期间不可用、需要手工排除

**症状**：打开大项目后长时间"Indexing…"，期间补全/跳转/查找不可用或返回不完整结果；需手动把 `venv`、`node_modules`、数据目录标为 Excluded。

**反思**：我们**没有全量索引**（pyrefly lazy 索引 + intel 增量），这是优势，但有两个衍生风险必须防：
1. **"结果不完整但不说"** 比"正在索引"更糟——PyCharm 挨骂的是"慢但可见"，而静默不完整会导向"跳转不准"的信任崩塌。我们已经有过真实教训（`lsp_start` 未设 cwd 导致 references 只覆盖已打开文件，见 ID 36849619 记忆）。→ **必须有"结果可能不完整"的显式提示**（§6-E-2）。
2. 目录走查（`search_workspace`、文件清单）已有上限保护（20000/2000/5000 命中），**保持并写进红线**（§6-G-2）。

### 3.3 大输出/长输出导致 UI 冻结

**症状**：终端里大量输出时应用卡死；滚动/输入无响应。

**社区原声**：affenape（2026-07-23，谈 JetBrains 系）："the built-in terminal is **totally unusable because it craps out and freezes the app whenever there's a large output**."

**反思（我们当前的真实风险）**：2026-09-25 盘点确认——`output.ts::appendOutputLine` **无限追加 DOM 行且强制自动滚动**，无行数上限、无截断；`terminal.ts::writeData` **直接 write，无背压**。也就是说：**我们正在重复 PyCharm 最受批评的那条**，只是因为目前用户还没跑过狂打印的长任务而尚未暴露。
→ 建议列为 **P0 防御性修复**（§6-A-2/§6-A-3）。这是本次调研中**唯一一条"我们已经踩在坑边"的发现**，优先级应高于所有新功能。

### 3.4 升级回归

**症状**：大版本升级后明显变慢/冻结/功能失效；新版 UI/键位/设置的破坏性变更。

**反思**：我们已有版本锁定（`ci/versions.toml`）+ 升级需 PR + bench 回归（工程规范 §8.1/§8.5）。建议补两条：
1. **用户配置迁移保护**：升级不得清空用户键位/设置/断点，迁移失败要可见报错而非静默重置（§6-G-4）；
2. **升级前后冒烟清单固定化**（已有 e2e 真机脚本 `e2e-real/debug-real.cjs`，可扩展为通用 smoke 清单）。

### 3.5 复杂度反噬：功能太多、设置像迷宫、新手不知所措

**症状**：新手面对 PyCharm 感到无所适从；设置项数量巨大，找不到开关；inspection 有时"悄悄失效"而用户不知道。

**社区原声**：godsonj64（2026-07-15）："Navigating through professional coding tools like PyCharm was **challenging for me** when I first encountered it."

**反思**：我们每新增一个设置项/键位，都在消耗"可发现性预算"。建议立规矩：
- **每个新设置项必须同时满足**：有默认值（保守）、有搜索关键词、在设置面板中归属明确分组；
- **每个新键位必须三处同步**（`keybindings.ts` META / `state.ts` DEFAULT_SETTINGS / Rust `default_keybindings`）+ 漂移锁计数（现行规范，保持）；
- **禁止"静默失效"**：任何能力不可用时给可见反馈（我们已在 TD-19 中把 10 处 `console.*` 改成 toast，这个纪律要扩展到新增代码）。

### 3.6 静态分析被专用 LSP 反超

**症状**：用户认为 VS Code + pyrefly/ty 的分析"更好"；PyCharm 专业版的价值在被侵蚀。

**社区原声**：
- darkwi11ow（2026-09-22）："vscode with pyrefly LSP is **miles better than Pycharm today**."
- aitchnyu（2026-08-09）："I let my Pycharm sub lapse since I switched to VSCode. Its **lighter and better at some static analysis**."

**反思**：我们**已经站在对的一边**（pyrefly 为默认引擎，第一天可切换 basedpyright）。但要注意：**引擎本身不再是壁垒**——任何人都能装 pyrefly。真正的壁垒是 **静态 + 运行时的混合**（intel），因此：
- 对标的不是"静态分析比 PyCharm 强"，而是"**无注解但跑过的代码，补全准确率 ≥ PyCharm**"（dev plan v2 §1.2 已列为验收指标，保持）；
- 保持引擎可切换（ADR-0003）与"引擎无关"的桥接层，是抵御上游变动的正确姿势。

### 3.7 商业与产品策略争议

**症状**：订阅涨价与 AI 捆绑、AI 产品线过多且定位混乱（Air / Junie / Copilot ACP / Claude 集成）、专业版与社区版功能分割争议、DataSpell 日落、 Claude Code 集成只是"终端里塞个 TUI"被批评为偷懒。

**社区原声**：
- the__alchemist（2026-09-22）："I am **very confused by their diaspora of AI offerings**!"
- bedstefar（2026-06-02）："it's a bit of a **cop-out** that the Claude Code integration in PyCharm is just the TUI inside a terminal emulator inside my IDE."
- BewareTheYiga（2026-05-28）："It always felt like 'PyCharm, but for notebooks' without a clear reason for existing as a separate product."

**反思**：我们的非目标里已明确排除 AI 能力与插件市场（dev plan v2 §1.1），这是**正确的防守**。建议把它升级为一条显式红线：**"不做半吊子集成"**——要么深度集成，要么不做；把"终端里塞个 TUI"这类方案明确排除（§6-G-5）。

### 3.8 其他次要批评

| 项 | 症状 | 我们的相关性 |
|---|---|---|
| 远程/WSL/容器体验差 | 风扇狂转、内存失控、输入延迟 | 非目标，不跟 |
| Linux 字体渲染差 | 需换字体缓解 | WebView2/Windows 为主，风险低；但字体与 DPI 仍需自测 |
| 内置表格 viewer 渲染差 | duckdb 场景渲染错乱 | 非目标（无数据科学模式） |
| Bug 多（"you're used to annoying bugs"） | 长期存在的小毛病 | 我们的对策是「e2e 双层测试基建」（mock + CDP 真机）保持并扩展 |
| 项目解释器/venv 配置易错 | 新手环境搭建门槛 | 我们已有 `toolchain.rs` 环境引导 + `envPanel`，属押对方向 |

---

## 4. 关键洞察

把 §2 与 §3 叠起来看，可以得到三条可执行的判断：

1. **好评的本质是"默认就对"，不是"功能齐全"。** 用户夸的是"打开就能用、猜的都对"（Local History、visual debugger、rename、Search Everywhere）。→ 我们补齐功能后，下一步的边际收益在**默认值质量**与**可发现性**，而不是继续加功能。

2. **差评的本质是"代价不可控"，且是架构性的。** PyCharm 无法通过调参解决内存与索引问题。→ 我们的"轻"是**结构性优势**，但必须**可观测、可证明、可持续**，否则它只是一个暂时未被自己破坏的偶然状态。

3. **我们已经踩在一条 PyCharm 的坑边（无界输出），其余差评项多为"尚未发生但方向正确"。** → 因此本次建议的优先级排序不是按"功能价值"，而是 **先防守（A 组）→ 再补齐调试肌肉（B 组）→ 再补编辑器基本功（C 组）→ 最后才是智能与候选（D/E/F 组）**。

---

## 5. 差距核对表（2026-09-25 仓库盘点）

> 证据来自对 `shell/src`、`shell/src-tauri/src` 的逐项核对。✅ 已实现 / 🟡 部分 / ❌ 未实现。

| # | 能力 | 现状 | 证据（文件:符号） | 建议 |
|---|---|---|---|---|
| 1 | 语法感知选区扩展 | ✅ | `monaco.ts` 引入 smartSelect contrib + `smart_select_expand/shrink` 键位（Ctrl+W / Ctrl+Shift+W） | 已交付（§11） |
| 2 | 行上移/下移 | ✅ | `monaco.ts` 引入 linesOperations contrib + `move_line_up/down`（Ctrl+Shift+↑/↓） | 已交付（§11） |
| 3 | 复制行 | ✅ | `keybindingDefaults.ts::duplicate_line`（Ctrl+D） | — |
| 4 | 列（矩形）选择 | ❌ | `monaco.ts:28` 仅引入 multicursor | §6-C-3 |
| 5 | 编辑器分屏 | ❌ | 仅 `layout.ts::restoreLayout`、`markdownPreview` 面板分栏 | §6-C-4 |
| 6 | 与剪贴板对比 | ❌ | 仅 `devtools/host.ts::readClipboardText` | §6-C-5 |
| 7 | 折叠 / 缩进参考线 / 括号彩色化 | ✅ | `buildEditorOptions` 补 `guides.indentation` + `bracketPairColorization`（默认开，可在设置里关）；**region 注释折叠未做**——需覆写 python 的 languageConfiguration，会覆盖既有缩进规则，风险大于收益 | 部分交付（§11） |
| 8 | 会话恢复（tab/光标/未保存） | ✅ | `sessions.rs` + `session.ts`：重开工作区恢复标签/光标/草稿（含脏标记），落 `<data_root>/sessions/<hash>.json` | 已交付（§12） |
| 9 | 缺失 import 自动修复 | 🟡 | `lsp/client.ts::registerLspCodeAction`（依赖引擎给） | §6-D-1 |
| 10 | 就地创建符号（create from usage） | ❌ | 未找到 | §6-D-2 |
| 11 | 重命名 | 🟡 | `renameWidget.ts` ghost 预览 ✅ + `findUsages.ts` ✅；无跨文件 diff 预览 | §6-D-3（低优先） |
| 12 | 诊断严重度配置 / `# noqa` 抑制 | ❌ | `ruffLint.ts:87` 硬编码 Warning；`lsp/client.ts:1500` 仅映射引擎 severity | §6-D-4 |
| 13 | 补全模糊匹配 | 🟡 | 排序分层 ✅（`2xx` 静态 / `1xx` intel）；模糊交给 Monaco `filterText` | §6-D-5（低优先） |
| 14 | 设置面板搜索 | ❌ | 未找到 | §6-E-1 |
| 15 | 改键 UI + 冲突检测 | ✅ | `settingsPanel.ts::renderKeybindingRows` + `keybindings.ts::validateKeybindingMap` | — |
| 16 | 文件树过滤 | ✅ | `fileTree.ts::applyTreeFilter` | — |
| 17 | 文件树跟随编辑器 | ❌ | 未找到 | §6-E-3 |
| 18 | 命令面板 | ✅ | `quickOpen.ts::buildItems`（文件/符号/命令/行号，`actionHint` 键位，`MAX_ITEMS=60`） | — |
| 19 | 引擎/索引状态可见性 | 🟡 | `engineChip.ts::renderEngineChip`（仅引擎名+切换）；`main.ts:1767 onEngineStatus`（off/starting/ready/error）；**无忙碌/进度** | §6-E-2 |
| 20 | 大文件/大目录保护 | ✅ | `fs_cmds.rs`：`MAX_FILE_SIZE` 2MB、`MAX_MATCHES` 5000、`MAX_TODOS` 2000、文件清单 20000、目录清单 2000 | 保持（§6-G-2） |
| 21 | Watches 监视表达式 | ✅ | `debugWatches.ts`：持久化列表（localStorage，上限 20）+ 暂停/切帧自动求值（context="watch"） | 已交付（§15） |
| 22 | 异常断点 | ✅ | `setExceptionFilters`（uncaught 默认开 / raised 可选），运行中即时下发；面板常驻开关 | 已交付（§15） |
| 23 | justMyCode 开关 | ✅ | 设置项 `debug_just_my_code`（默认开，四处同步），attach 读取；改动需重启会话 | 已交付（§15） |
| 24 | 智能步进 stepInTargets | ❌ | 未找到（v1.1 报告列为 D6 待办） | §6-B-4 |
| 25 | 线程切换 | 🟡 | `dapThreads`（client.ts:311）已封装但**无调用方**；`debugView.ts:433` 固定 `threadId ?? 1` | 候选（P2 未排） |
| 26 | 帧切换 | ✅ | `debugView.ts::renderStack` → `activeFrameId` → `refreshVariables` | — |
| 27 | 断点持久化/列表/删除 | ✅ | + `enabled` 启禁（`setBreakpointEnabled`，禁用不下发 debugger；面板勾选 + 右键菜单 + gutter 灰点） | 已交付（§15） |
| 28 | 变量树懒加载 | ✅ | + 值截断 200 字符（全文挂 title）+ 展开深度上限 5 层（G-1） | 已交付（§15） |
| 29 | hover 求值 | ✅ | `registerLspHover` 暂停态并入 `dapEvaluate(context:"hover")` 运行时值（帧经 `setActiveFrameId` 镜像） | 已交付（§15） |
| 30 | 输出行数上限/截断/滚动锁 | ✅ | 环形缓冲 + 条件跟随已交付（2026-09-25，见 §10） | 已交付 |
| 31 | 终端输出背压 | ✅ | rAF 合并 + 单帧字节预算已交付（2026-09-25，见 §10） | 已交付 |
| 32 | 测试运行器集成 | ❌ | 未找到（且 dev plan v2 §1.1 列为"明确不做"） | §6-F-1（需裁决） |
| 33 | 应用级资源面板 | ✅ | `proc_stats.rs`（sysinfo）+ `resourcePanel.ts`：状态栏 MEM 芯片 + 进程明细面板（外壳 + 子进程，M1 只观测） | 已交付（§13） |
| 34 | 停止/进程清理 | ✅ | `runFlow.ts::stopRunById`（Ctrl+C → 1.2s → `term_kill`）；`dap.rs::kill_pid_tree` | 保持 |
| 35 | LSP 超时/降级兜底 | ✅ | `lsp/client.ts:106` `REQUEST_TIMEOUT_MS=15s` / `INITIALIZE_TIMEOUT_MS=60s`；`startingQueues` 入队 | 保持 |
| 36 | probe 开销红线 | ✅ | `probe/README.md:151-164`：<1.5x（实测 1.35x）；`max_calls_per_func=200` 等限流 | 保持 |

---

## 6. 改进建议

> 分组原则：**A 先防守（避免变成自己批评过的样子）→ B/C 补齐"默认就对"的肌肉 → D/E 质量与可发现性 → F 战略候选 → G 反模式红线（约束所有组）**。
> 量级为单人日估算；所有前端改动沿用现有范式（键位三处同步 + 漂移锁、toast 反馈、零依赖优先）。
> **是否立项、何时排期以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准。**

### A 组 · 把"轻"变成可证明的资产（防守，建议最高优先）

#### A-1 资源可观测面板（`resourcePanel.ts` + Rust `proc_stats.rs`） · 2~3 天

**目标**：让用户（也就是我们自己）随时能回答"现在是谁在吃内存"，把 PyCharm 最大的差评项变成我们的可视化优势。

**做法**：
- Rust 新增命令 `proc_stats`，返回：外壳自身 RSS/CPU + 子进程清单（pyrefly/basedpyright、intel、debugpy、被运行脚本、probe）各自的 PID/RSS/CPU/存活时长。
  - 跨平台实现取舍：首选 `sysinfo` crate（跨平台、零unsafe）；若坚持最少依赖，Windows 用 `tasklist /FO CSV /NH /FI "PID eq N"` 解析、Unix 用 `ps -o rss=,pcpu= -p N`。**注意**：probe 的"零第三方依赖"铁律只约束 `probe/` 包，Rust 外壳侧加依赖走工程规范 §8.1 版本锁定即可。
- 前端 `resourcePanel.ts`：状态栏芯片显示总内存（如 `MEM 380 MB`），点击展开面板，按进程列表 + 一键"重启 LSP 引擎"/"结束该进程"。
- 采样频率：默认 5s，面板打开时才采样，关闭即停（避免自身成为开销来源）。

**验收**：面板数值与任务管理器/活动监视器对同一 PID 的 RSS 误差 < 15%；闲置 10 分钟采样开销不可测（CPU < 0.5%）。

#### A-2 输出面板护栏（P0，修 `output.ts`） · 0.5 天 · ✅ 已交付（2026-09-25，见 §10）

**目标**：消除"狂打印长任务 → DOM 无界膨胀 → 卡死"这条我们已经踩在坑边的隐患（§3.3）。

**做法**：
- `appendOutputLine` 增加环形缓冲：默认上限 `MAX_OUTPUT_LINES = 5000`（可在设置里调），超限时从头部移除并在顶部维持一行提示"已省略前 N 行"。
- 自动滚动改为**条件自动滚动**：用户手动上滚时暂停跟随并显示"回到底部"浮标；回到接近底部时恢复跟随。
- 追加写入按帧合并（rAF 批处理），避免高频事件逐行触发布局。

**验收**：脚本连续打印 20 万行，输出面板 DOM 节点数稳定在上限附近，界面可交互（输入无卡顿），内存无持续增长；回归 `docs/run_acceptance_record.md` 相关用例。

#### A-3 终端输出背压（P0，修 `terminal.ts`） · 0.5~1 天 · ✅ 已交付（2026-09-25，见 §10）

**做法**：`writeData` 改为 rAF 合并写入 + 单帧写入字节上限（如 256 KB/帧，超出部分排队到下一帧并提示"输出已被限流"）；xterm scrollback 设置显式上限（如 5000 行）。

**验收**：`for i in range(10**7): print(i)` 场景下界面不冻结，可 Ctrl+C 停止（对齐 `runFlow.ts::stopRunById` 已有清理逻辑）。

#### A-4 性能红线入 CI 并保持 · 0.5 天

- `bench/collect-metrics.ps1` 已有冷启动/内存红线断言；补齐三项：**长跑内存增长**（连续运行 10 分钟 + 打印 10 万行后的内存增量 ≤ 阈值）、**大文件打开**（2MB 文件打开耗时）、**输出洪峰**（A-2/A-3 的回归）。
- 与 dev plan v2 §1.2 对齐：冷启动 < 1.5s、合计内存 ≤ 600MB、probe 开销 < 1.5x。

#### A-5 会话恢复（`sessionRestore.ts`） · 1~2 天

**目标**：关闭/重启工作区后恢复 tab、光标位置、未保存草稿（断点已持久化）。这是"默认就对"的典型。

**做法**：切 tab/移动光标/文档变更时防抖写入 `<data_root>/sessions/<project_hash>.json`（复用 `file_ops::project_hash`）；未保存内容存草稿（复用 Local History 的存储约定，不污染工作区）；启动时按 `autoOpenRecentWorkspace` 之后恢复。

**验收**：打开 5 个文件 + 未保存编辑 → 退出 → 重启，全部恢复且未保存内容不丢；磁盘文件损坏时静默跳过并 toast。

### B 组 · 调试补齐最后一块肌肉

> 前提：DAP 桥（`dap/client.ts` + `dap.rs`）与 debugpy 随包分发已稳定（验收记录 `docs/debug_acceptance_record.md`）。

| # | 项 | 量级 | 做法要点 | 涉及文件 |
|---|---|---|---|---|
| B-1 | **Watches 监视表达式** | 1.5 天 | 持久化表达式列表（随工作区存，复用断点存储范式）；每次 `stopped` 事件与帧切换时批量 `dapEvaluate`（并发但限流，失败保留上一次值并置灰）；支持右键删除/编辑 | 新增 `watches.ts`；`debugView.ts` 挂面板；`dap/client.ts` 复用 `dapEvaluate` |
| B-2 | **异常断点** | 1 天 | 初始化时读取 `exceptionFilters`（debugpy 提供 raised/uncaught）；UI 为两个开关（抛出即停 / 未捕获才停）；发 `setExceptionBreakpoints` | `dap/client.ts` 新增 `dapSetExceptionBreakpoints`；`debugView.ts` 工具栏 |
| B-3 | **只步进我的代码 开关** | 0.5 天 | 把 `dap/client.ts:253` 硬编码的 `justMyCode: true` 提升为运行/调试配置字段（默认开，与现状一致），在调试工具条提供一键切换（切换需重启会话，需提示） | `dap/client.ts`；`runConfigPanel.ts` |
| B-4 | **智能步进 stepInTargets** | 1.5 天 | `stepInTargets` 请求取当前行的可进入目标，弹出候选列表供选择 | `dap/client.ts`；`debugView.ts` |
| B-5 | **线程切换** | 0.5 天 | `dapThreads` 已有封装但无调用方；加线程下拉，切换后刷新栈与变量 | `debugView.ts` |
| B-6 | **断点启禁 + 面板增强** | 0.5 天 | 断点表已是 `Map<line, spec>`，加 `enabled` 位；断点持久化一并存 enabled；面板支持勾选 | `debugGutter.ts`；`debugView.ts::renderBreakpoints` |
| B-7 | **变量值截断 + 展开深度上限** | 0.5 天 | `renderVarRow` 值渲染截断（默认 200 字符，点击展开完整值放模态）；展开深度上限 5 层，超出显示"继续展开"按钮（防止巨型对象递归拖死） | `debugView.ts` |
| B-8 | **hover 求值** | 1 天 | 调试暂停时注册 Monaco hover provider，选中/悬停标识符 → `dapEvaluate(context:"hover")`（形参已存在，只是没调用方）；与静态 hover 合并（调试态优先运行时值） | `monaco.ts` / `lsp/client.ts` hover 合并；`dap/client.ts` |

**验收（B 组统一）**：扩展 `shell/e2e-real/debug-real.cjs`（R-REAL-1..8 现有真机脚本），新增用例：Watches 跨断点保持、异常断点命中未捕获异常、justMyCode 关闭后可步进进 site-packages、线程切换后变量刷新。mock 层（`shell/e2e/debug/01-functional.spec.ts`）同步补罐头数据——**注意 ID 25672754 记录的教训**：mock 罐头数据曾掩盖真实 debugpy 行为差异，新增用例必须以真机为准。

### C 组 · 编辑器基本功（低成本高体感）

| # | 项 | 量级 | 做法要点 |
|---|---|---|---|
| C-1 | **智能选区扩展/收缩**（Ctrl+W / Ctrl+Shift+W） | 1 天 | `monaco.ts` 引入 smartSelect contrib；若 standalone 未暴露，退化为自研"按缩进/括号/引号层级扩展"的最小实现（纯函数 + 单测，复用 `util.ts` 范式） |
| C-2 | **行/语句上移下移**（Ctrl+Shift+↑/↓） | 0.5 天 | Monaco 内核 action（`editor.action.moveLinesUpAction` 等）挂载 + 键位三处同步 |
| C-3 | **列（矩形）选择** | 0.5 天 | `monaco.ts` 引入 columnSelection contrib + 键位（Alt+拖拽 / Alt+Shift+Insert 切换模式） |
| C-4 | **编辑器分屏** | 2~3 天 | 同一 model 创建第二个 editor 实例共享 model，独立 viewState；左右/上下可切；`layout.ts` 管理分栏尺寸持久化 |
| C-5 | **与剪贴板对比** | 0.5 天 | 复用 `git.ts::ensureDiffEditor` 的 diff 编辑器：把剪贴板文本作为"另一侧"喂进去（当前选区 vs 剪贴板 / 整个文件 vs 剪贴板两种模式） |
| C-6 | **可读性配置：缩进参考线 / 括号彩色化 / region 折叠** | 0.5 天 | `settingsPanel.ts::buildEditorOptions` 补 `guides`、`bracketPairColorization`；新增设置项（带搜索关键词） |

**键位同步提醒**（沿用 v1.1 报告 §4 的纪律）：新增键位必须同步 `keybindings.ts` META、`state.ts` DEFAULT_SETTINGS（现由 `keybindingDefaults.ts` 派生）、Rust `default_keybindings`，并更新 `settings.rs` 的漂移锁计数（当前 30）。

### D 组 · 代码智能与卫生

| # | 项 | 量级 | 做法要点 |
|---|---|---|---|
| D-1 | **缺失 import 自动修复（自研兜底）** | 1.5 天 | 当诊断指向未定义名字、且工作区内存在同名顶层符号（复用 intel 索引或 `list_workspace_files` + 轻量解析）时，提供 code action「导入 X」并插入规范位置（文件头部 import 区，按 isort 规则，可复用 `optimize_imports` 的 ruff 管线做后续排序） |
| D-2 | **就地创建符号（create from usage）** | 1.5 天 | 对未解析名字提供「创建函数/变量/类」：按调用形态推断签名（参数个数 → *args 占位），插入到当前作用域末尾或文件末尾；纯前端 + 单测 |
| D-3 | 重命名跨文件引用预览 | 1 天 | `renameWidget.ts` 当前明确"不做 diff 预览"；可加"引用列表 + 影响文件数"摘要即可（**低优先**） |
| D-4 | **诊断严重度配置与 `# noqa` 抑制** | 1.5 天 | 设置项：ruff 规则级别映射（E/W/F 分别映射到 Hint/Info/Warning/Error）；编辑器右键"忽略此规则"→ 在行尾追加 `# noqa: <code>`；`ruffLint.ts` 解析 ruff JSON 的 `code` 字段做分类 |
| D-5 | 补全模糊匹配增强 | 1 天 | 现由 Monaco `filterText` 决定；可注入 `filterText`（缩写/camelCase）提升命中（**低优先**，需先确认 pyrefly/intel 返回的 item 是否允许覆写 filterText） |

### E 组 · 可发现性与"默认就对"

| # | 项 | 量级 | 做法要点 |
|---|---|---|---|
| E-1 | **设置面板搜索/过滤** | 0.5 天 | 顶部输入框 + 按标题/关键词/分组过滤，空结果给"是否要找键位？"跳转；与 `quickOpen` 的 `fuzzyScore` 复用 |
| E-2 | **引擎忙碌/进度可见 + "结果可能不完整"提示** | 1 天 | `engineChip.ts` 增加 busy 态（首次打开大项目/首次 references 期间）；对可能受索引影响的操作（references/rename/findUsages）在结果面板顶部显示"工作区索引可能尚未完成，结果可能不完整"——**直接对应 §3.2 的教训** |
| E-3 | **文件树跟随编辑器 + Local History 入口下沉** | 0.5 天 | 文件树加"滚动到当前文件"按钮/键位；文件树右键菜单加「本地历史」（复用 `localHistory.ts`，把已交付能力变得可发现） |
| E-4 | **Git：文件历史 + 提交信息预填文件名** | 1.5 天 | 文件树/编辑器右键「文件历史」→ 提交列表 + 所在分支 + 钻取（`git.ts` 已有 log/diff 能力）；仅暂存单文件时提交框预填文件名且可编辑（对应 §2.4 细节） |
| E-5 | 全局搜索 scope 切换（当前文件 / 打开的标签 / 整个工作区） | 0.5 天 | `search.ts` 加 scope 下拉 + 结果分组折叠 |

### F 组 · 战略候选（需产品负责人裁决）

| # | 项 | 说明 |
|---|---|---|
| F-1 | ~~最小 pytest 集成（candidate）~~ | **已裁决（2026-09-25）：维持非目标**。严格遵守 dev plan v2 §1.1，不做任何测试运行器相关能力（含 gutter 单测入口、测试发现、结果树）。本条仅保留作记录：PyCharm 的测试运行器（绿箭头跑单个测试、结构化结果树、失败点击跳转）确为高频好评项，若未来画像变化需重新裁决 |
| F-2 | probe 驱动的脚本热点视图 | v1.1 报告远期候选 14，与差异化核心联动；保持 Phase 5+ 评估 |
| F-3 | 覆盖率运行 | v1.1 报告远期候选 15，依赖 coverage.py；缓议 |

### G 组 · 反模式红线（约束以上所有组）

> 这些是从 PyCharm 的批评里提炼的"我们绝不能做的事"，建议写入工程规范 §8。

| # | 红线 | 对应批评 |
|---|---|---|
| G-1 | **禁止无界增长的数据结构**：输出、终端 scrollback、变量树展开、诊断列表、历史条目必须有显式上限并在触顶时可见提示 | §3.1 / §3.3 |
| G-2 | **保持目录走查与文件读取上限**（`MAX_FILE_SIZE` 2MB / `MAX_MATCHES` 5000 / 清单 20000·2000），任何放宽需 PR 说明理由 | §3.2 |
| G-3 | **禁止静默失败**：任何能力不可用/降级必须可见（toast/状态芯片/结果面板提示），禁止 `console.*` 了事（沿用 TD-19 纪律） | §3.5 |
| G-4 | **升级不得清空用户数据**：键位、设置、断点、会话、Local History 的迁移必须向后兼容；失败要报错而非静默重置 | §3.4 |
| G-5 | **禁止"半吊子集成"**：要么深度集成，要么不做；不允许"在终端里塞个 TUI 就算集成了"这类方案 | §3.7 |
| G-6 | **主线程禁止重活**：所有解析/扫描/索引查询走 `spawn_blocking` 或防抖（沿用 TD-1/TD-2 的做法），新增代码同检 | §3.1 |
| G-7 | **每个新设置项/键位必须付"可发现性税"**：默认值保守 + 搜索关键词 + 分组明确 + 三处同步 + 漂移锁 | §3.5 |

---

## 7. 建议排期（供裁决）

| 批次 | 内容 | 预估 | 理由 |
|---|---|---|---|
| **P0（立即）** | A-2 输出护栏、A-3 终端背压 | 1~1.5 天 | 唯一"已踩在坑边"的项；且是纯防御，不影响任何功能 |
| **P1（下一批）** | A-1 资源面板、A-5 会话恢复、C-1 智能选区、C-2 移动行、C-6 可读性配置 | 5~7 天 | 「轻可证明」+「默认就对」的最小组合 |
| **P2** | B-1 Watches、B-2 异常断点、B-3 justMyCode 开关、B-8 hover 求值、B-6 断点启禁、B-7 变量截断 | 5~6 天 | 调试从"能用"到"好用"的最后一块 |
| **P3** | E-1 设置搜索、E-2 忙碌/完整性提示、E-3 文件树跟随与历史入口、C-3 列选择、C-5 剪贴板对比、E-4 Git 文件历史 | 4.5 天 | 可发现性与细节 |
| **P4** | C-4 分屏、D-1 add import、D-2 create from usage、D-4 诊断可配置、A-4 红线入 CI | 6~7 天 | 智能与质量 |
| **候选** | B-4 智能步进、B-5 线程切换、D-3/D-5、E-5、F-1 | — | 视使用反馈决定 |

> 排期与 `python_ide_dev_plan_v2.md` §7（Phase 4 打磨期）冲突时以计划为准；上表仅为候选池的优先级排序。

---

## 8. 验收：如何证明"在这些细节上不比 PyCharm 差"

沿用工程规范 §8.4（每阶段验收报告存 `docs/`）：

1. **调试对标**：新增真机 e2e 用例（§6-B），与 PyCharm 同场景人工对照（断点→步进→Watches→异常断点→hover 求值），记录"能否完成"而非"是否更快"。
2. **资源对标（我们的优势项，必须量化）**：同一工作区下，OpenCharm 与 PyCharm 的冷启动、打开后 5 分钟内存、10 分钟长跑后内存增量做成对比表存 `bench/reports/`。**这是唯一能写进 README 的硬指标。**
3. **稳定性对标**：连续运行 10 万行打印任务不冻结（A-2/A-3 回归）——对应 PyCharm 被批评的"大输出卡死"。
4. **细节清单自检**：§6 C 组每项补一个 vitest 纯函数单测（沿用 `util.ts` / `navHistory.ts` 的单测范式）。

---

## 9. 附录：社区原声索引（HN，按时间倒序）

| 日期 | 作者 | 摘要 | 归类 |
|---|---|---|---|
| 2026-09-23 | bredren | JetBrains 与 VS Code 竞争中 PyCharm 一度"starved for resources" | 批评·战略 |
| 2026-09-22 | the__alchemist | "I <3 JB IDEs for their functionality, but **resource pigs** they are"；9950x 也能被拖垮 | 批评·资源 |
| 2026-09-22 | darkwi11ow | "vscode with **pyrefly LSP is miles better than Pycharm** today" | 批评·静态分析 |
| 2026-09-06 | lo0dot0 | PyCharm 表格 viewer 渲染不如 Excel | 批评·次要 |
| 2026-08-09 | aitchnyu | 转投 VS Code："lighter and better at some static analysis"，订阅未续 | 批评·资源/分析 |
| 2026-08-06 | insane_dreamer | Local History "**saved my ass** more than once"（覆盖/git reset 后） | 好评·容错 |
| 2026-08-05 | the__alchemist | IntelliJ(PyCharm/RustRover) 把平板"turn it into a space heater"；但承认其 introspection/refactoring 仍高一档 | 批评·资源 / 好评·智能 |
| 2026-07-30 | DrewADesign | 从精调 neovim 迁到 JetBrains：**discoverability** 好太多，5 分钟在任何机器上可用 | 好评·可发现性 |
| 2026-07-24 | zipy124 | "**restart PyCharm every few days**, slows so bad it cannot scroll or type smoothly"（高配 MBP） | 批评·资源 |
| 2026-07-23 | affenape | PyCharm "always great to use"，但因资源需求转向 VS Code；内置终端大输出冻结应用 | 批评·资源/输出 |
| 2026-07-21 | insane_dreamer | Git：任意分支互 diff、文件历史含分支、提交信息预填文件名——"**still the best**" | 好评·Git |
| 2026-07-15 | godsonj64 | 新手觉得 PyCharm 这类专业工具"challenging" | 批评·复杂度 |
| 2026-07-02 | gwerbin | "if you're a Jetbrains user you're used to annoying bugs" | 批评·质量 |
| 2026-06-11 | b33j0r | 自 PyCharm 发布起订阅至今，**killer feature 一直是可视化调试器** | 好评·调试 |
| 2026-06-08 | insane_dreamer | PyCharm 内置类型检查"far and away the best"，多重继承推断强 | 好评·智能 |
| 2026-06-02 | bedstefar | Claude Code 集成只是终端里的 TUI，"a bit of a cop-out" | 批评·集成 |
| 2026-05-29 | mhitza | "**Shift-F6 is my goto, and what I miss most in a code editor**" | 好评·重构 |
| 2026-05-28 | BewareTheYiga | DataSpell 定位不清（"PyCharm, but for notebooks"） | 批评·战略 |
| 2025-12（官方社区） | 多位用户 | 升级 2025.3 后冻结，内存从 2GB 提到 8GB 仍无效 | 批评·升级回归 |

> 说明：以上为 Hacker News 公开评论与 JetBrains 官方支持社区帖子的摘录，仅用于归纳口碑倾向，不代表量化统计。

---

## 10. P0 落地记录（2026-09-25）

> 产品负责人裁决：先做 P0 两项（A-2 / A-3），其余各组维持候选池。

### A-2 输出面板护栏 — `shell/src/output.ts`

| 改动 | 说明 |
|---|---|
| 环形缓冲 | `DEFAULT_MAX_OUTPUT_LINES = 5000`；超限时从**头部**丢弃最旧行，顶部显示「已省略前 N 行（输出上限 5000 行）」。上限经 `setMaxOutputLines(n)` 可调（**下限 100**，更小取值回落出厂默认，防误设自伤），为将来接设置项预留 |
| 提示行不入账 | 提示行 `.out-omitted` 永远位于容器首位，不计入行数配额、不参与 channel 过滤（`refilterOutputChannel` 跳过它） |
| 条件滚动跟随 | 距底 ≤ 24px 视为「贴底」；用户上滚即**暂停**自动跟随，回到底部自动恢复。此前是「无条件 `scrollTop = scrollHeight`」，用户一翻就被拽走 |
| 复位 | `clearOutput` 同时复位省略计数、提示行与跟随状态 |
| 样式 | `style.css` 新增 `.out-omitted`（`--fg-dim` / `--border` / `--space-1`，无裸值） |

### A-3 终端输出背压 — `shell/src/terminal.ts`

| 改动 | 说明 |
|---|---|
| 按帧合并 | `writeData` 入队，`requestAnimationFrame` 合并为一帧一次 `term.write`；同一帧内多次 data 只渲染一次 |
| 单帧预算 | `MAX_WRITE_BYTES_PER_FRAME = 256 KB`，超出部分顺延下一帧——**削峰不丢数据** |
| 限流提示 | 积压 ≥ 1 MB 时写入一次黄色提示「输出过快，已限流显示（数据未丢，仍在接收）」，队列清空才允许再次提示（防刷屏） |
| 时序保证 | `markStopped` / `handleExit` 先 `flushPending()` 再写提示行，保证「进程输出 → 退出提示」顺序正确 |
| 队列回收 | `startRun` 的 `term.reset()` 与 `dispose` 调用 `dropPendingWrites()`，旧队列不再渲染 |
| 未动 | xterm `scrollback` 本就是 5000 |

### 测试与验证

- 新增用例 `shell/src/__tests__/output.test.ts` → 「输出护栏」3 例：上限丢弃与省略计数、`clearOutput` 复位、上滚暂停/回底恢复。
- `npx tsc --noEmit` **0 错**。
- `npx vitest run`：**21 文件 / 203 用例全绿**；另有 32 个 DOM 测试文件报 "No test suite found / failed to find the runner"——本机 happy-dom 环境**先在性**故障（已用对照文件确认与本次改动无关，见记忆 ID 25672754）。新增的 output 用例正处于这 32 个文件之中。
- 因上述环境故障，新增 3 例**另用等价临时脚本**（node 环境手动注入 happy-dom 的 `document`/`Event`）验证：**3/3 通过**，脚本已删除。待 DOM 环境修复后正式用例即可直接运行。

### 踩坑记录

1. **`isConnected` 在游离容器下恒为 false**：容器未挂进 document 时，提示行的存活判定失效 → 每次 trim 都新建一个提示行，省略计数虚高（实测 3 被记成 5）。改用 `row.parentNode === container` 判定后修正。真实运行（容器在 DOM 中）不会触发，但单测与离屏场景会。
2. **上限下限静默回落**：`setMaxOutputLines(5)` 会被下限 100 挡回落 5000，测试因此一度「以为护栏没生效」。单测改用 100 / 103 组合。

### Playwright 验收（2026-09-25，真实 Chromium）

新增 `shell/e2e/perf/01-output-guard.spec.ts`（3 条，**全绿**）：

| 用例 | 验证内容 | 实测 |
|---|---|---|
| P-GUARD-1 | 输出面板环形缓冲 | 追加 5200 行 → DOM 稳定在 **5000 行** + 顶部「已省略前 200 行」；再追加 100 行 → 行数仍 5000、省略计数**只增 100**、节点总数**零增长** |
| P-GUARD-2 | 条件滚动跟随 | 默认贴底（gap ≤ 24px）；上滚后追加新行 **scrollTop 保持 0（未被拽回底部）**；回到底部后恢复跟随 |
| P-GUARD-3 | 终端洪峰背压 | 2.3MB 洪峰：入队瞬间积压 **601 块 / 2.46MB**（未同帧一次写完），1.5s 后**队列归零**（削峰不丢数据），期间最大帧间隔 **43ms**（主线程持续出帧），洪峰结束的收尾提示**留在缓冲区** |

回归：`npx tsc --noEmit` 0 错；`e2e/debug` 13 条全绿（输出面板是调试输出承载方，无回归）。

**对照实验的诚实结论**：原先设想「直通写入会冻结主线程、入队后不冻结」的对照**不成立**——实测 xterm 直通 2.3MB 的同步耗时仅 ~1ms、最大帧间隔 24ms（xterm 自带渲染节流）。也就是说在本量级下 A-3 的收益**不是防卡顿**，而是：
1. 单帧写入量封顶（256KB/帧），避免单帧解析+渲染的长任务随数据量线性变长；
2. 积压超 1MB 时**可见**地告知用户「数据没丢，只是限流显示」。

### 验收中发现并修掉的一个真实缺陷

限流提示原本写在**洪峰中途**（队列里 push 一行），实测会被后续输出冲出 xterm 的 5000 行 scrollback —— 用户根本看不到（P-GUARD-3 首轮即因此失败）。改为：**洪峰结束（队列排空）时补写一行收尾提示**（此时没有后续输出，留得住）。

### 仍建议的真机冒烟

以上为 mock + 真实浏览器的**前端层**验收。真机（CDP，见记忆 ID 25672754 的 `e2e-real` 基建）建议补一条：跑 `for i in range(200000): print(i)`，确认可 Ctrl+C 停止、进程清理干净（`runFlow::stopRunById` 路径）。

---

## 11. P1 落地记录（2026-09-25）：编辑器基本功 C-1 / C-2 / C-6

### C-1 智能选区扩展/收缩

- `monaco.ts` 引入 `contrib/smartSelect`（此前未引入 → `editor.action.smartSelect.expand` 命令不可达）。
- 新增 editor 级键位 `smart_select_expand`（Ctrl+W）/ `smart_select_shrink`（Ctrl+Shift+W），PyCharm 同款。
- **Ctrl+W 是浏览器危险键**（关窗口），`browserKeys.ts` 原逻辑在 Monaco 内也 `stopPropagation` → 键位永远触发不到。新增 `CLAIMED_IN_MONACO`：编辑器内**仍 `preventDefault`（浏览器永不执行关闭动作），但放行事件继续传播**给 Monaco；编辑器外仍彻底吞掉。

### C-2 行/选区上下移动

- `monaco.ts` 引入 `contrib/linesOperations`（此前未引入 → `moveLinesUp/DownAction` 不可达）。
- 新增 editor 级键位 `move_line_up` / `move_line_down`（Ctrl+Shift+↑/↓），Monaco 自动修正缩进。

### C-6 可读性配置

- 新增两个设置项（默认**开**——PyCharm 出厂即有缩进参考线，「默认就对」）：
  - `indent_guides`（缩进参考线，含当前层级高亮）→ `guides.indentation` + `highlightActiveIndentation`
  - `bracket_colors`（括号彩色化）→ `bracketPairColorization.enabled`
- 四处同步：`state.ts`（类型 + 默认值）、`settingsPanel.ts`（元素 / `buildEditorOptions` / 填充 / 收集）、`index.html`（两行设置行）、Rust `settings.rs`（字段 + Default）。旧配置缺字段时用 `!== false` 兜底为开。
- **region 注释折叠未做**：需为 python 覆写 languageConfiguration 的 folding markers，会覆盖既有缩进规则，风险大于收益。

### 落地中修掉的两个既有缺陷

1. **Monaco 方位键键位静默失效（真 bug）**：Monaco 的 `KeyCode` 枚举名是 `UpArrow/DownArrow/LeftArrow/RightArrow`，而解析层产出的是 `ArrowDown`（`KeyboardEvent.code` 口径），`toMonacoKeybinding` 查表得 `undefined` → 规则被跳过、键位看着没反应。此前方位键只用于 window 级（不经该函数）所以一直没暴露；C-2 一动就撞上。已在 `keybindings.ts` 加 `MONACO_KEY_ALIASES` 别名表。
2. **lsp e2e 跳转定义用例时序脆弱**：未等 `.view-line` 渲染就绪就取 `boundingBox()`，全量跑（资源紧张）时偶发 null。已补 `toBeVisible` 等待（Hover 用例本就有，跳转用例漏了）。

### 验收

| 项 | 结果 |
|---|---|
| 新增 `e2e/editor/03-editor-basics.spec.ts` | **4/4 绿**：E-BASIC-1 智能选区逐级扩大/缩小、E-BASIC-2 移动行交换与复原、E-BASIC-3 Ctrl+W 放行契约（编辑器内 `prevented=true` + `bubbled=true`；编辑器外 `bubbled=false`）、E-BASIC-4 缩进参考线设置里关掉再打开（真实点设置面板，非内部调用） |
| 回归 | `e2e/editor` 8/8、`e2e/debug` 13/13、`e2e/lsp` 4/4 全绿 |
| 全量 e2e | 87 passed / 1 failed —— 失败项为 `lsp/02-pyrefly-real` 跳转定义（上述时序偶发，已加固；单独重跑 4/4 绿） |
| 单测 / 类型 | `tsc --noEmit` 0 错；`vitest run` 205 passed（+2 新增 `isClaimedInMonaco` 用例）；`cargo test settings` 3 passed（漂移锁 40 → 44） |

### P1 剩余

- **A-1 资源可观测面板**（外壳 + 子进程内存/CPU）

---

## 12. P1 落地记录（2026-09-25）：A-5 会话恢复

> 重开工作区后恢复：打开的标签（顺序）、上次活动标签、光标位置、**未保存草稿（含脏标记）**。对标 PyCharm「关掉项目再打开一切还在」。

### 实现

| 层 | 内容 |
|---|---|
| Rust `shell/src-tauri/src/sessions.rs` | `get_session` / `save_session` 两命令；落 `<data_root>/sessions/<project_hash>.json`（与断点/书签同口径，覆盖式）；路径一律**工作区相对路径**；`valid_rel` 拒绝绝对路径/盘符/`..`（防越权）；`MAX_TABS=40` 上限（G-1 红线）；坏文件回落空快照不阻断启动；单测 3 例 |
| 前端 `shell/src/session.ts` | `snapshot` / `saveSessionNow`（防抖 800ms）/ `restoreSession`；草稿单文件上限 512KB（超出放弃草稿、保留标签，G-1）；恢复走 handler 注入（`openFile` / `activateTabByPath` / `renderTabs`），不反向 import main；`restoring` 标志屏蔽恢复过程中的自触发 |
| 接线 `main.ts` | 注入 handler；`openWorkspace` 末尾 `await restoreSession()`；`teardownCurrent` 关标签**前**先同步落一次快照；切工作区 `cancelPendingSessionSave()`（防旧 root 覆盖新文件）；编辑/切标签/移动光标三处挂 `scheduleSessionSave()` |
| 交互文案 | 关闭工作区的确认从「继续将丢失」改为「将以草稿形式保留，重开工作区自动恢复」——不再暗示数据会没 |

### 验收过程中挖出的一个先在性真 bug（重要）

**每个 E2E 用例的 `init` 都在带病运行**：`pw.log` 里反复出现的
`init 失败 TypeError: Cannot read properties of null (reading 'find') at autoOpenRecentWorkspace`
根因是 mock 缺 `list_pythons` → 返回 null → `maybePromptVenv` 里 `pythons.find()` 抛 TypeError → **`openWorkspace` 在 venv 探测处中断**，其后所有步骤（含本次新加的 `restoreSession`）静默不执行。

用分步 DOM 标记（`data-a5=start→root-set→tree→lsp→venv→watch→done`）定位到中断点后两头修复：
1. `envPanel.ts::maybePromptVenv` 补 `Array.isArray(pythons)` 空值防御（G-3「禁止静默失败」的防御面）；
2. tauri-mock 的 `ARRAY_CMDS` 补 `list_pythons`。

修复的连带收益：**所有 e2e 用例的启动不再带病**（init 失败日志消失），启动耗时明显下降（S-1 从 30s+ 到 7.3s）；顺带暴露并修复 D-EXP-7 的定位器歧义（环境检查 info toast 与错误 toast 并存后裸 `.toast` 触发 strict violation，改为按文案过滤）。

### 验收

| 项 | 结果 |
|---|---|
| 新增 `e2e/session/01-restore.spec.ts` | **2/2 绿**：S-1 重启后恢复 2 个标签、未保存编辑还在且仍标脏、激活 a.py、光标落回第 3 行（走 `page.reload()` 真实启动链路）；S-2 无快照干净启动 |
| 全量回归 | **e2e 90/90 全绿**（此前 87 passed / 1 failed）；`tsc` 0 错；`vitest` 205 passed；`cargo test` **188 passed / 0 failed**（含 sessions 3 例） |

### 设计取舍备忘

- 快照是**覆盖式单文件**（当前现场），与本地历史（逐版本、可回退）职责分离，不合并；
- 草稿恢复后 `dirty=true`，关闭标签仍走既有确认流程，不会静默丢弃；
- `restoring` 期间所有快照写入被抑制——否则半恢复状态会被写回去。

---

## 13. P1 落地记录（2026-09-25）：A-1 资源可观测面板

> 「轻」是 OpenCharm 唯一无法被抄袭的护城河（§4 洞察 2），但必须**可感知**——状态栏常驻 MEM 芯片 + 进程明细面板，让用户随时回答「现在是谁在吃内存」。这正是 PyCharm 用户想要而拿不到的东西。

### 实现

| 层 | 内容 |
|---|---|
| Rust `shell/src-tauri/src/proc_stats.rs` | `proc_stats` 命令：`sysinfo`（0.39.6，已锁 `ci/versions.toml`）枚举进程，返回外壳自身 + **直接子进程**（`parent == self`，天然覆盖 pyrefly/basedpyright、intel、debugpy、被运行脚本、uv，无需白名单）；子进程按内存降序；内存 0.1MB / CPU 0.1% 精度。`Mutex<Option<System>>` 复用实例（sysinfo 的 CPU 百分比靠两次 refresh 差值，换实例即归零）；单测 2 例（含真实调用一次） |
| 前端 `shell/src/resourcePanel.ts` | 状态栏 `#status-mem` 芯片（显示合计 MB；**首次采样成功才显示**——采样失败隐藏芯片，不显示坏数据）；点击打开明细模态（trapFocus / Esc 关闭，对齐模态规范）；**采样纪律：芯片 30s 一次，明细 2s 且仅面板打开时进行，关闭即停**——可观测本身不能成为新的资源负担；「重启 LSP 引擎」经 handler 注入走 main 的 `startLsp` 真实链路 |
| UI | `index.html` 状态栏芯片 + `#resource-modal`（复用 `.modal-card` / `.env-header` 既有骨架）；`style.css` 表格样式全部走 token |
| mock | `proc_stats` 固定样本（外壳 + pyrefly + python，供面板 e2e） |

### 验收

| 项 | 结果 |
|---|---|
| 新增 `e2e/perf/02-resource-panel.spec.ts` | **3/3 绿**：R-1 芯片显示合计（MEM 327 MB）；R-2 明细表含外壳与子进程、按内存降序、CPU 无基线显示「—」而非 0%；R-3 重启 LSP 可用、Esc 关闭、不崩 |
| 全量回归 | **e2e 93/93 全绿**；`cargo test` **190 passed / 0 failed**（+2 proc_stats）；`tsc` 0 错 |
| 版本锁定 | `sysinfo = "0.39.6"` 已登记 `ci/versions.toml` |

### 设计取舍备忘

- **M1 不做 kill**：结束任意进程是高危操作且价值低（子进程由运行/LSP 生命周期管理，已有完整清理链路），观测 + 重启 LSP 已覆盖「排查谁在吃内存」的主诉求；
- CPU 百分比语义：sysinfo 相对上次 refresh 的滑动值，首次为 0 → 前端显示「—」，面板 2s 采样后即有意义；
- 引擎切换（pyrefly ↔ basedpyright）的子进程自动进出列表，靠父子关系而非硬编码名称。

---

## 14. 批次总结（截至 2026-09-25）

| 批次 | 内容 | 状态 |
|---|---|---|
| P0 | A-2 输出护栏、A-3 终端背压 | ✅ §10（Playwright 3 条） |
| P1 | C-1 智能选区、C-2 移动行、C-6 可读性配置 | ✅ §11（e2e 4 条） |
| P1 | A-5 会话恢复 | ✅ §12（e2e 2 条） |
| P1 | A-1 资源可观测面板 | ✅ §13（e2e 3 条） |
| P2 | B-1 Watches、B-2 异常断点、B-3 justMyCode、B-6 断点启禁、B-7 变量护栏、B-8 hover 求值 | ✅ §15（e2e 3 条） |
| P3 | E-1 设置搜索、E-2 引擎忙碌态、E-3 文件树定位+本地历史入口、E-4 Git 文件历史+提交框预填、E-5 搜索 scope+分组折叠、C-5 与剪贴板对比 | ✅ §17（e2e 5 条） |
| P4 | C-3 列选择、D-4 诊断严重度映射+# noqa、D-1 缺失 import 兜底、D-2 就地创建符号、A-4 红线入 CI 补项（C-4 分屏留待单独批次） | ✅ §18（e2e +1 条 / vitest +16 用例） |
| P4·续 | C-4 编辑器分屏（钉住式同 model 双实例 + 键位/右键/命令入口 + 宽度持久化） | ✅ §19（e2e +3 条 / vitest +2 用例） |
| P4·续 | D-3 rename 跨文件确认摘要（影响文件数 + 各文件命中数；单文件保持零摩擦） | ✅ §20（e2e +1 条 / vitest +4 用例） |

**P0 / P1 / P2 / P3 / P4（含分屏）全部交付并验收（25 个功能项）。**

**连带修复的先在性缺陷**（均为验收过程发现）：
1. 输出/终端无界增长（迟早会撞上的坑）；
2. 限流提示会被洪峰冲出 scrollback（用户永远看不到）；
3. Monaco 方位键 KeyCode 枚举名不匹配 → editor 级方位键位静默失效；
4. **mock 缺 `list_pythons` → 每个 e2e 用例 init 都在带病运行**（`maybePromptVenv` 空值炸掉 openWorkspace 后半段，会话恢复等新能力全部不可达）；
5. lsp e2e 跳转定义用例未等渲染取 boundingBox 的时序脆弱。

**剩余候选池**（未排期）：P4 智能与质量组（§6-D：D-1 缺失 import 修复、D-2 就地创建符号、D-3 rename 跨文件预览、D-5 补全模糊、D-4 诊断可配置）、编辑器余项（C-3 列选择、C-4 分屏）、A-4 红线入 CI 补项（长跑内存 / 大文件打开 / 输出洪峰）、调试候选（B-4 智能步进、B-5 线程切换）、F 组战略候选。是否立项以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准。

---

## 15. P2 落地记录（2026-09-25）：调试补齐六项（§6-B）

> 调试是 PyCharm 公认的 killer feature（§2.1）。本次把调试从「能用」推到「好用」：B-1 Watches、B-2 异常断点、B-3 justMyCode 开关、B-6 断点启禁、B-7 变量截断/深度上限、B-8 hover 求值。

### 实现

| 项 | 内容 |
|---|---|
| **B-1 Watches** | 新增 `shell/src/debugWatches.ts`：持久化表达式列表（localStorage，上限 20，G-1）；每次暂停/切帧自动以 `context="watch"`（无副作用语义）串行求值，失败显示「无法求值」而非静默；面板挂调用栈与变量之间，DOM 由 debugWatches 自建、debugView 经 `initWatchesPanel(host, getFrameId)` 注入（不反向 import，防环）。**刻意不复用 debugConsole 的 evaluate**——那是 repl（有副作用） |
| **B-2 异常断点** | `dap/client.ts`：`getExceptionFilters` / `setExceptionFilters`（uncaught 默认开、raised 可选；用户选择跨会话保留）；`startDebug` 在 `configurationDone` 前下发 `setExceptionBreakpoints`，运行/暂停中改动即时下发；UI 为断点面板顶部常驻开关（不依赖普通断点存在） |
| **B-3 justMyCode** | 设置项 `debug_just_my_code`（默认开 = 保持既有行为），四处同步（state / settingsPanel / index.html / Rust Settings+测试）；attach 从设置读取；改动需重启会话（面板 hint 明示） |
| **B-6 断点启禁** | `BreakpointSpec.enabled`（缺省=启用，旧快照兼容）；`setBreakpointEnabled`——禁用的断点**保留在表里**（条件/日志属性不丢）但**不下发 debugger**，gutter 灰点（`.gutter-breakpoint-disabled`）、面板勾选框、右键菜单「禁用/启用断点」三处入口；Rust `PersistedBreakpoint.enabled` 缺省 true（旧快照不变行为） |
| **B-7 变量护栏** | 值截断 200 字符（完整值挂 title）；展开深度上限 5 层（到顶显示提示行，不再发请求）——G-1「任何展开必须有界」 |
| **B-8 hover 求值** | `registerLspHover` 暂停态（`dap.currentPhase()==="stopped"`）把光标处标识符的运行时值并入 hover（`context="hover"`，DAP 语义无副作用；值截 300 字符）；帧上下文经 `dap.setActiveFrameId` 镜像提供——lsp/client 不能 import debugView（成环），dap 是两者共同下游 |

### 验收

| 项 | 结果 |
|---|---|
| 新增 `e2e/debug/03-p2-debug.spec.ts` | **3/3 绿**：P2-1 添加监视 → 暂停态求值（mock 罐头 `<expr> ⇒ <value>`）→ 单步后保留 → 删除；P2-2 uncaught 默认开、raised 即时切换且会话存活；P2-3 面板取消勾选 → gutter 灰点、红点清零，重新勾选恢复 |
| 全量回归 | e2e **95 passed / 1 failed**（D-FUNC-1 gutter 像素点击偶发——已知问题，单独重跑 6/6 绿）；`cargo test` **190/0**；`vitest` 205 passed；`tsc` 0 错 |

### 设计取舍备忘

- Watches 存 localStorage 而非 Rust 落盘：低频个人配置、无跨设备诉求，避免为 20 条字符串扩后端；将来迁移时结构不变；
- B-7 不做「继续展开」按钮：到上限后停在提示行已满足「有界」，交互成本更低；
- B-8 不做求值缓存：hover 本身有停顿触发与频率限制，缓存失效语义（帧切换/变量变化）复杂度不值；
- B-4 智能步进、B-5 线程切换为候选项，未排期（多线程脚本场景出现后再做，§6-B）。

### 真机补充验收建议

mock 罐头的 evaluate/variables 都是静态值，以下两点需真机（CDP）确认：①真实 debugpy 的 `setExceptionBreakpoints` filters 名（raised/uncaught）与预期一致；②Watches 对真实 Python 表达式（方法调用、推导式）的求值耗时与失败呈现。

---

## 16. 新会话交接指南

> 本文件是 P0/P1/P2 的**唯一事实来源**：进度、落点文件、设计取舍、踩坑都在这里。新会话从这里继续。

### 16.1 阅读顺序

1. §0 一页结论 + §4 关键洞察（**为什么**这么做——「轻是护城河」「默认就对」）；
2. §6 建议清单 + §7 排期（**做什么**：每项含做法 / 涉及文件 / 量级）；
3. §10–§15 落地记录（**已怎么做**：落点文件、设计取舍、踩坑）；
4. §5 差距核对表（现状真值，✅/🟡/❌ 已随交付逐项更新，做新项前先查它）。

### 16.2 当前进度

- **已交付**：P0~P4 全部（含 C-4 分屏，§17/§18/§19）+ D-3 rename 引用预览（§20），共 26 项；
- **测试基线**：e2e 106 条（Playwright，覆盖 perf / session / editor / debug / lsp / git / plugins / p3 各组）；`cargo test` 190；`vitest` 546（55 文件）；`tsc --noEmit` 0 错；
- **未交付**：见 §14「剩余候选池」（B-4/B-5 等多线程场景、D-5、F 组）。

### 16.3 工程纪律（每次改动必查；细则以 `.codebuddy/rules/typescript-code-style/RULE.mdc` 为准）

1. **新增键位三处同步**：`keybindingDefaults.ts`（KeybindingId + META）→ Rust `settings.rs::default_keybindings` + **漂移锁计数**（当前 44，漏改会红）→ `browserKeys.ts` 检查是否浏览器危险键（危险键须走 `CLAIMED_IN_MONACO` 放行，参照 Ctrl+W）；
2. **新增设置项四处同步**：`state.ts`（接口 + DEFAULT）→ `settingsPanel.ts`（元素 / 填充 / 收集 / buildEditorOptions）→ `index.html`（settings-row）→ Rust `Settings` + Default + 测试；旧配置缺字段用 `!== false` 兜底为开；
3. **Monaco contrib 按需引入**：新命令先查 `monaco.ts` 是否已 import 对应 contrib（教训：smartSelect / linesOperations 未引入时命令**静默不可达**）；
4. 方位键的 Monaco 枚举是 `UpArrow/DownArrow/…`，`keybindings.ts::MONACO_KEY_ALIASES` 已兜底，勿删；
5. **G 组红线**（§6-G）：无界增长禁令（输出/队列/持久化一律带上限）、静默失败禁令（降级要可见）、升级不清空用户数据、禁止半吊子集成；
6. 顶层禁止解析 DOM（用 `state.ts::lazyEl`）；域模块不反向 import `main.ts`（handler 注入）；`src-tauri` 新命令记得 `lib.rs` 的 `mod` 列表 + `invoke_handler` 两处注册。

### 16.4 测试命令与已知问题

| 命令 | 说明 |
|---|---|
| `cd shell && npx tsc --noEmit` | 类型检查，必须 0 错 |
| `cd shell && npx vitest run` | 21 文件 / 205 用例通过；**32 个 DOM 测试文件因本机 happy-dom 环境先在性损坏无法运行**（"No test suite found"，与任何改动无关，已用对照验证）——新 DOM 用例照写，等环境修复后自动生效 |
| `cd shell && npx playwright test` | **主验收手段**（真实 Chromium，全量 ~7 分钟）；webServer 自动起 vite dev（5173，已有实例则复用） |
| `cd shell/src-tauri && cargo test` | Rust 全量（190） |

已知偶发与坑：
- `e2e/debug/01 D-FUNC-1` 用真实像素点击 gutter，headless 下偶发落点漂移 → 单独重跑即可（记忆 ID 25672754）；
- mock（`e2e/mocks/tauri-mock.js`）三个坑：①静态表调用形如 `h()` **不传 args**——新增需要参数的命令要在 `invokeMock` 里单独加分支（`proc_stats`/`save_session` 均如此）；②`addInitScript` 每次导航都会重跑，需要跨 reload 的状态放 sessionStorage（会话快照 mock 即此做法）；③DAP 请求有 `dapRespond(id, {})` 兜底不会挂，但需要罐头数据的新请求要显式加分支；
- 新增 Rust 依赖必须登记 `ci/versions.toml`（本次新增 `sysinfo = "0.39.6"`）。

### 16.5 下一步建议（按 §7 排期，量级为单人日）

- **P3**：E-1 设置搜索（0.5）→ E-2 引擎忙碌/结果完整性提示（1）→ E-3 文件树跟随 + 本地历史入口（0.5）→ E-5 搜索 scope（0.5）→ C-5 与剪贴板对比（0.5）→ E-4 Git 文件历史 + 提交信息预填（1.5）；
- **P4**：A-4 红线入 CI 补项（长跑内存 / 大文件打开 / 输出洪峰）→ C-3 列选择（0.5）→ D-1 缺失 import 修复（1.5）→ D-2 就地创建符号（1.5）→ D-4 诊断可配置（1.5）→ C-4 分屏（2~3）；
- **每完成一批的固定动作**：更新 §5 表状态 → 追加落地记录节 → 在 §14 表加行 → 四件套回归（tsc / vitest / cargo / playwright）→ git commit（**禁止 push**）。

---

## 17. P3 落地记录（2026-09-25）：可发现性与细节批次（§6-E / §6-C-5）

> P3 的主题是「可发现性」：能力已交付但入口藏得深，用户感知为零等于不存在。本次六项：E-1 设置搜索、E-2 引擎忙碌态、E-3 文件树定位 + 本地历史入口、E-4 Git 文件历史 + 提交框预填、E-5 搜索 scope + 分组折叠、C-5 与剪贴板对比。

### 实现

| 项 | 内容 |
|---|---|
| **E-1 设置搜索**（`settingsPanel.ts` + `index.html`） | 搜索框跨分类过滤：匹配行 = 行文本 + 集中关键词表 `SETTINGS_ROW_KEYWORDS`（G-7「可发现性税」：控件 id → 英文/别名关键词，单一出处防逐行 `data-kw` 漂移）+ `data-kw`；行命中用 quickOpen 的 `fuzzyScore`（与 Search Everywhere 同一手感）；分类无命中整节隐藏（命中行仍归属其分类标题，可定位）；模板/插件两个动态内容页整体隐藏（非表单行，搜索无意义）；无匹配出空态 +「查找快捷键」按钮直接跳快捷键分类（顺手解决「设置里改键找不到」）；切分类/关面板/空态跳转一律退出搜索态。**恢复路径刻意不走 `switchCategory`**（它对插件/模板页有渲染副作用，恢复显隐触发重渲染会与 `openSettingsPanel` 的 `switchCategory("plugins")` 并发双渲染插件列表——e2e plugins spec 抓出后已修：恢复只做纯显隐还原 + `searchActive` 单次守卫） |
| **E-2 引擎忙碌态**（`engineChip.ts` + `style.css`） | `setEngineBusy(true)`：`starting` / 引用稳定采样期间 chip 显示「引擎启动中/索引中…」+ `.busy`（`--warn` 色光标 progress），保存设置时浮现「结果可能不完整」1.5s（PyCharm 索引提示意识）；终态恢复。零新命令、纯前端状态展示 |
| **E-3 文件树定位**（`fileTree.ts` + `index.html`） | 工具栏「定位到当前文件」按钮（`codicon-go-to-file`）：`revealInTree(path)` 逐级 `ensureDirExpanded` 展开父目录 → 走 `selectEntry` 单选路径（UI-16 aria-selected 单一写入点）→ `scrollIntoView(nearest)`；节点未渲染时先展开父目录再 `reloadDir` 局部刷新（覆盖根节点折叠态/顶层文件/新建未刷新文件）；右键菜单「本地历史」下沉（`Ctrl+Shift+H` 已有但不可发现——文件级历史对任意文件有意义） |
| **E-4 Git 文件历史 + 提交框预填**（`git_cmds.rs` / `git.ts` / `fileTree.ts`） | Rust `git_log_file`（`git log --follow --date=short --pretty=format:%H\x1f…`，`--follow` 跟随重命名；单文件历史不画 graph 无信息量；输出形状复用 `GitCommit`）；前端 `showFileHistory(relPath)` 渲染进 Git 详情视图（与 blame 同容器，hash 可点进 `git show` 提交详情）；文件树右键「Git 文件历史」对仓库内任何文件可用（含当前无改动的已跟踪文件）；提交框预填：`renderGitPanel` 中仅暂存单文件且框为空时填文件名（可编辑，框非空永不覆盖），暂存数不再是 1 且框内仍是自动预填值时自动清掉 |
| **E-5 搜索 scope + 分组折叠**（`search.ts` / `main.ts` / `index.html` / `style.css`） | 搜索框加 scope 下拉（整个工作区 / 打开的标签 / 当前文件）：scope 模式走 TS 侧 `searchInFiles`（`read_file` 逐文件行扫描，匹配上限 5000 对齐后端 `MAX_MATCHES`，G-1 有界；diff 视图 tab 的 path 是仓库相对路径不可读，自动排除）；工作区模式照旧走 Rust 全仓搜索，返回结构零变化、渲染链路全复用；文件分组头可点击折叠/展开（UI-16 disclosure 语义：role=button + Enter/Space + aria-expanded 同源）；mock 侧 `e2e/helpers.ts` git bridge 补 `git_log_file` |
| **C-5 与剪贴板对比**（`clipboardDiff.ts` 新域 + `index.html` + `style.css`） | 编辑器右键「与剪贴板对比」（`addAction`，有选区比选区、无选区比整个文件）+ 文件树右键（整个文件）；Monaco diff 模态独立懒创建（**刻意不复用 git.ts diff 宿主**：三态基准/冲突开关/hunk 状态机与仓库语义深度耦合，剪贴板 diff 只需两侧文本只读展示）；关闭/换内容时先 `setModel` 解绑再 dispose 旧 model（Monaco 0.52 契约：`TextModel got disposed before DiffEditorWidget model got reset`——实测两次踩坑：重置必须 `setModel(null)` 而非 `{original:null,modified:null}`，换内容必须先挂新再释旧）；剪贴板空/读失败、文件读失败均有可见 toast（G-3） |

**范围说明**：§7 排期表 P3 批次中的「C-3 列选择」未列入本批（§16.5 的操作清单已不含它）——Monaco 原生已提供列选择（Alt+Shift+方向键/拖拽），无需开发；§16.5 清单为本批的唯一口径。

### 验收

| 项 | 结果 |
|---|---|
| 新增 `e2e/p3/01-discoverability.spec.ts` | **5/5 绿**：P3-1 设置搜索（关键词过滤跨分类 + 空态跳转快捷键分类 + 输入重置）；P3-2 搜索 scope=当前文件（分组头全部 main.py）+ 文件组折叠/展开；P3-3 文件树定位（折叠根目录后重新展开 + `.active` 选中）；P3-4 Git 文件历史（右键 → 详情视图真实提交 → hash 点进提交详情）；P3-5 剪贴板对比模态（mock 预置 `__E2E_CLIPBOARD__` 哨兵文本 → diff original 侧可见 → Esc 关闭） |
| 全量回归 | **e2e 101/101 全绿**（mock + debug + lsp + git + p3 五套）；`tsc` 0 错；`cargo test` **190 passed / 0 failed**（含 git_log_file 编译）；`vitest` **53 文件 516 用例全绿**（此前的 DOM 环境 "No test suite found" 故障已不复现） |

### 连带修复的先在性缺陷

1. **breakpointPersist 两条过期断言**（B-6 起 payload 恒含 `enabled`，测试未同步）——非本批引入，顺带修正；
2. **revealInTree 顶层文件定位失效**（工作区直接子文件 `parts.slice(0,-1)` 为空不触发父目录展开，e2e P3-3 抓出）——补 `ensureDirExpanded(parentDirOf(path))` 兜底；
3. **设置搜索恢复态双渲染**（见 E-1 行内说明，plugins spec 4 例 strict violation 抓出）——`switchCategory` 恢复改为纯显隐还原。

### 设计取舍备忘

- 搜索 scope 的「打开的标签」模式**同步读盘而非读 model**：diff tab 占位模型/多 tab 同文件等边界下「磁盘内容」语义更可预测；缓存一致性由既有 watcher 体系保证；
- 文件历史不进 SCM 历史 tab 复用 `renderCommitItem`：单文件列表不需要 graph 车道与右键全家桶，详情视图轻量行 + hash 跳转已覆盖「这个文件谁改的、为什么」的主诉求；
- 引擎忙碌态不挂 spinner 动画（`--reduce-motion` 联动成本 > 信息价值），色变 + 文案即可。

### 下一步建议（P4，量级为单人日）

- **P4**：A-4 红线入 CI 补项（长跑内存 / 大文件打开 / 输出洪峰）→ C-3 列选择（0.5）→ D-1 缺失 import 修复（1.5）→ D-2 就地创建符号（1.5）→ D-4 诊断可配置（1.5）→ C-4 分屏（2~3）；
- **每完成一批的固定动作**：更新 §5 表状态 → 追加落地记录节 → 在 §14 表加行 → 四件套回归（tsc / vitest / cargo / playwright）→ git commit（**禁止 push**）。

---

## 18. P4 落地记录（2026-09-25）：智能与质量批次（§6-C-3 / §6-D / §6-A-4，除 C-4）

> P4 的主题是「智能与质量」：把诊断从「只能看」变成「能处理」，把「轻」的资产用红线钉死。本次五项：C-3 列选择、D-4 诊断严重度映射 + `# noqa` 抑制、D-1 缺失 import 自研兜底、D-2 就地创建符号、A-4 红线入 CI 补项。**C-4 分屏（2~3 天）留待单独批次**（触及 tab/布局架构，不宜与本批叠加）。

### 实现

| 项 | 内容 |
|---|---|
| **C-3 列选择**（`keybindings.ts` / `keybindingDefaults.ts` / `settings.rs`） | 键位 `Alt+Shift+Insert`「切换列选择模式」：Monaco 0.52 中列选择是**核心 editor option**（`columnSelection`，无独立 contrib/命令），handler 切换 option + toast 可见反馈（G-3：模式切换必须可见，否则用户忘记开过会把矩形选中当 bug）。键位三处同步 + 漂移锁 44→45（settings.rs 两处断言）。Alt+Shift+Insert 非浏览器危险键（Insert 不在 browserKeys 护栏清单） |
| **D-4 诊断严重度映射 + `# noqa`**（`ruffLint.ts` / `settingsPanel.ts` / `index.html` / `state.ts` / `settings.rs` / `main.ts`） | 设置项 `ruff_severity_e/w/f`（hint/info/warning/error，默认全 warning = 维持既有行为），Python 设置区三个下拉，保存后立即重查当前文件；`lintActiveFile` 按规则码首字母（E/W/F）映射到 MarkerSeverity，其余类别回落 warning，非法存储值 `normalizeSeverity` 归一（G-3 防静默失效）；编辑器右键「忽略此规则（行尾添加 # noqa）」：定位光标处 ruff 诊断（`getModelMarkers` 按 owner 过滤）→ `buildNoqaLine` 纯函数构造/扩展/判重 → 行尾写入并立即重查（波浪线即时消失） |
| **D-1 + D-2 自研快速修复**（新域 `quickFix.ts`） | `registerCodeActionProvider("python")`（Ctrl+. / 灯泡）：从两桶（opencharm-lsp / opencharm-ruff）诊断文案提取未定义名字（`extractUndefinedName` 覆盖 pyrefly / basedpyright / ruff F821 句式）；本文件已有顶层定义则不出主意（作用域/拼写问题对症的是人）。**D-1**：工作区同名顶层符号扫描（`list_workspace_files` 过滤 .py 取前 200 个 + `read_file` 逐个 `scanTopLevelSymbol` 轻量解析；`modulePathOf` 走 `relativePathRaw` 归一（CR-28）；命中 ≤3 个来源 → 「从 pkg.mod 导入 X」，插入行由 `findImportInsertLine` 定位（shebang/编码注释/模块 docstring 之后、最后一条顶层 import 之下），当前文件自身定义跳过）。**D-2**：工作区也没有 → 「创建函数（`inferCallArity` 按调用形态数实参，含字符串/注释/嵌套括号处理；`*` 展开传参 → `*args, **kwargs`）/ 创建类 / 创建变量」，stub 追加文件末尾。G-1：扫描文件数与来源缓存（上限 50，工作区切换失效）均有界 |
| **A-4 红线入 CI 补项**（`bench/collect-metrics.ps1` / `e2e/perf/03-large-file.spec.ts`） | bench 脚本加 `-SoakMinutes` 参数：长跑内存采样（暖机 60s 取基线，每 30s 一采），**暖机后增量 ≤ 150 MB** 红线纳入报告与退出码断言（CI 门禁复用）；「大文件打开」新增 e2e `perf/03`（2MB / ≈17 万行 .py 打开耗时 < 5000ms + 打开后可定位可交互）；「输出洪峰」红线由既有 `perf/01-output-guard`（环形缓冲 + 背压）钉住——三项分别落在最合适的载体，脚本不重复驱动 UI |

### 验收

| 项 | 结果 |
|---|---|
| 新增 `src/__tests__/quickFix.test.ts` | **16/16 绿**：诊断文案提取（7 句式 + 反例）、顶层定义解析（缩进/注解/注释边界）、插入点定位（shebang+docstring / 单行 docstring / import 区 / 无头部）、实参推断（零参/多参/嵌套/展开/未闭合 → null）、stub 文案、noqa 行构造（追加/扩展/判重/裸 noqa）、严重度归一 |
| 新增 `e2e/perf/03-large-file.spec.ts` | **1/1 绿**：2MB 文件打开（model 行数到位 + 耗时红线）与打开后可用性 |
| 全量回归 | **e2e 102/102 全绿**；`tsc` 0 错；`cargo test` **190 passed**（漂移锁 45 断言验证通过）；`vitest` **54 文件 532 用例全绿** |

### 连带修复（单测抓出的真 bug）

1. **inferCallArity 字符串内逗号误计**（`run('x,y', [1,2], helper)` 计成 4 参）——补字符串字面量/转义/行注释扫描后 16 例全绿。

### 设计取舍备忘

- **C-4 分屏单独成批**：同 model 双 editor 实例、独立 viewState、layout 持久化与 tab 架构耦合，风险高于本批五项之和，不与已 102 条全绿的大 diff 叠加；
- D-1 扫描上限 200 文件是「兜底」而非「全量索引」：命中即修复，未命中则走 D-2 创建——自研路径的定位是引擎缺位时的 80 分答案；
- 严重度映射按规则码**首字母**分类（E/W/F）而非逐规则配置：三个下拉已覆盖高频诉求，逐规则 UI 的配置成本与可发现性税不成比例（G-7）。

### 下一步建议

- **C-4 分屏**（2~3，单独批次）：同 model 第二 editor 实例 + 独立 viewState + `layout.ts` 分栏持久化 + sessions 快照兼容；
- 其余候选（D-3 rename 跨文件预览、D-5 补全模糊、B-4/B-5、F 组）见 §14「剩余候选池」；
- **每完成一批的固定动作**：更新 §5 表状态 → 追加落地记录节 → 在 §14 表加行 → 四件套回归（tsc / vitest / cargo / playwright）→ git commit（**禁止 push**）。

---

## 19. P4·续 落地记录（2026-09-25）：C-4 编辑器分屏

> §18 遗留的最后一个 P4 项。语义为**钉住式分屏**：打开时把活动 tab 的 model 装进第二个 Monaco 实例（同 model 共享 → 两侧编辑实时同显；cursor/滚动/选区独立），主编辑器随后自由切 tab，分屏保持钉住。

### 实现

| 层 | 内容 |
|---|---|
| 新域 `splitEditor.ts` | 实例懒创建常驻复用（G-1：不随开随弃）；`openSplit`（幂等，diff tab/无标签给可见提示）/`closeSplit`/`toggleSplit`/`setDiffActive`（diff 占满编辑区时同步隐藏，open 态保留）/`onModelDisposed`（钉住的 model 在 tab 关闭时 dispose → **先于 dispose 同步收起**，避免渲染已释放内容）/`resetSplitEditor`（工作区切换兜底）；快照不含分屏态（重开工作区分屏收起，预期行为）。`buildOptions` 由 main 注入（防 settingsPanel ⇄ splitEditor 成环）；settingsPanel 保存路径调 `refreshSplitEditorOptions` 同源生效 |
| 入口 | 键位 `Ctrl+\`「向右分屏」（三处同步 + 漂移锁 45→46；键串用符号字面 `Ctrl+\`——`parseKeyToken` 不认 "Backslash" 名，同 "/" 先例）；编辑器右键「向右分屏」（addAction）；命令面板 `split_editor`（hint 自动跟随改键） |
| 布局 `index.html` / `style.css` / `layout.ts` | `#split-editor-panel`（`--split-w` 默认 50%）+ `#split-splitter` 并排 flex 分隔条（与 md-preview 同范式，不复用 .splitter 的 absolute 定位）；拖拽写自定义属性 + localStorage `opencharm-split-w`（开屏时恢复）、双击重置、宽度上限随 editor-row 动态收口 |
| 已知边界 | 分屏面板内暂无 ▶/断点/git gutter 装饰与行内书签（这些装饰系统绑定主编辑器实例）；编辑、诊断波浪线、补全、hover 等随共享 model 天然可用 |

### 验收

| 项 | 结果 |
|---|---|
| 新增 `e2e/editor/04-split-editor.spec.ts` | **3/3 绿**：P-SPLIT-1 开分屏（共享 model 同显编辑 + 标签头文件名）；P-SPLIT-2 钉住（切 tab 分屏不动 + 关被钉住 tab 自动收起）；P-SPLIT-3 关闭按钮收起 + 实例复用重开 |
| `src/__tests__/layout.test.ts` 扩充 | **14/14 绿**（+2）：分屏拖拽写 `--split-w` 并持久化、下限 240、双击重置回落 50% |
| 全量回归 | **e2e 105/105 全绿**；`tsc` 0 错；`cargo test` **190 passed**（漂移锁 46）；`vitest` **54 文件 534 用例全绿** |

### 连带踩坑（实现期实测）

1. **Monaco 容器不能传 lazyEl Proxy**——automaticLayout 把容器直接喂给 `ResizeObserver.observe()`，Proxy 不是真实 Element 被原生 API 拒绝（`parameter 1 is not of type 'Element'`）。host 改为运行时 `$` 解析真实元素；lazyEl 仅用于 classList/textContent 级访问；
2. **键位串须走 `parseKeyToken` 词表**："Ctrl+Backslash" 解析为 null（符号键用字面 `Ctrl+\`，同 "/" 的先例）——e2e 首跑即暴露。

### 设计取舍备忘

- **钉住式而非跟随式**：分屏跟随主编辑器换 model 会让「对照两个文件」失效；钉住 + 关 tab 自动收起是最小正确语义，后续按需加「分屏内打开…」入口；
- 上下分屏暂不做：编辑区高度受底部面板/大纲挤压，纵向空间本就紧张；键位/命令扩展成本低，留待需求出现。

### 下一步建议

- P0~P4 推荐清单至此**全部落地**；剩余候选（D-3/D-5、B-4/B-5、F 组）见 §14「剩余候选池」；
- **每完成一批的固定动作**：更新 §5 表状态 → 追加落地记录节 → 在 §14 表加行 → 四件套回归（tsc / vitest / cargo / playwright）→ git commit（**禁止 push**）。

---

## 20. D-3 落地记录（2026-09-25）：rename 跨文件确认摘要

> 候选池立项（产品负责人 2026-09-25 裁决）。重命名确认前展示「影响文件数 + 各文件命中数」摘要——影响面可见再落盘；与 pyrefly cwd 工作区索引修复（引用覆盖全工作区）形成闭环。

### 实现

| 项 | 内容 |
|---|---|
| 摘要确认（`renameWidget.ts`） | `confirmRename` 在拿到 LSP rename 编辑集后：**仅跨文件改动**弹确认（`openConfirm`，标题含新旧名，正文 = 「将修改 N 个文件共 M 处」+ 按命中数降序的「文件 × 处数」明细 + 索引未稳定警示）；**当前文件内改动保持 Enter 即应用**（零摩擦，不破坏既有旅程）。取消 → 不落盘收起 widget |
| 纯函数 `summarizeRenameTargets` | 明细 = `relativePathOrName`（工作区内相对路径，越界回落文件名）+ 命中数；文件数超过 10 折叠为「…以及其他 X 个文件」（G-1 有界） |
| 顺带修正 | `engineChip.ts` 顶层 `$("status-engine")` 改 `lazyEl`（CR-26 规则对齐：顶层禁止解析 DOM；同时让 renameWidget 依赖链可被单测导入） |

### 裁决口径

- 原用户决策「不做 diff 预览模态」**不变**——本项只加摘要确认（文件 × 命中数），不做逐处 diff；
- 单文件改名不加确认（高频路径零摩擦）；跨文件（有真实风险的操作）才多一步。

### 验收

| 项 | 结果 |
|---|---|
| 新增 `src/__tests__/renamePreview.test.ts` | **4/4 绿**：降序明细 + total、无根回落文件名、超限折叠、单文件自洽 |
| `e2e/lsp/03` 更新 | **9/9 绿**：跨文件用例升级（Enter → 摘要含「2 个文件共 3 处 / main.py × 2 / lib.py × 1」→ 落盘 + toast）+ 新增取消不落盘用例 |
| 全量回归 | **e2e 106/106 全绿**；`tsc` 0 错；`cargo test` 190 passed；`vitest` **55 文件 546 用例全绿** |
