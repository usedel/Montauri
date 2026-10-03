# OpenCharm 现状评估 · 改进建议与未来功能规划

> 版本：**v1.2** · 日期：2026-10-03 · 状态：**待评审**
> 性质：基于当前代码库与全部 `docs/` 文档的**现状评估 + 改进清单 + 未来功能候选池**，不是开发计划（不直接排期）。
> 与既有文档的关系：本文件是**全局视角的评估与选题**，落地时仍需回到各专项计划（`python_ide_dev_plan_v2.md` / 各 `*_dev_plan.md`）写 PR 级方案。冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
> **取数时点**：2026-10-03，git HEAD `ccf9da2`。所有数字由 **`node tools/stats/repo-stats.mjs`** 产出（口径固化在脚本里，见 §9）。**引用本文数字前必须先核对 HEAD**。
>
> **v1.2 修订（2026-10-03，纠正 v1.1 的一处系统性取数错误）**：
> v1.1 的规模数字取自 PowerShell `Get-Content $f | .Count`。在本机（PS 5.1，ANSI 代码页 **gb2312**）上，对**无 BOM 的 UTF-8 源文件**该写法会按 GBK 解码并**吞掉换行**——`style.css` 报 5,410 而真实 5,668（少 4.5%），`main.ts` 报 2,503 而真实 2,897（少 13%）。丢失比例随文件 CJK 密度而变、**逐文件不同**，因此这批数字是"看起来合理但系统性偏低"的。
> 连带被推翻的结论（详见 §1.2）：**「巨型文件趋势已逆转」「UI 六批顺带把逻辑拆去了域模块」不成立**——`git.ts` / `lsp/client.ts` / `env_cmds.rs` / `fs_cmds.rs` / `git_cmds.rs` 在 `44c85ea → HEAD` 之间**一行未变**，`main.ts` 是 **+58**（不是 −336）。
> 本版全部行数改由 `tools/stats/repo-stats.mjs` 重取，并新增两个防复发机制：取数脚本固化为代码 + 预算门禁（`ci/budgets.toml` / `shell/scripts/budget-check.mjs`）。
>
> **v1.1 修订（相对 v1.0）**：① §0 缺口 3 与 P0-3 重写（视觉六批已交付，身份问题从 P0 降为 P2 可选）；② 全文数字刷新；③ P0 重排（质量门禁提为 P0-1，新增「CI 主干分支错配」子项）；④ Gate D 表述纠偏（确定性口径已 PASS，只剩两格 PENDING）；⑤ B3 改为已交付退出候选池；⑥ B1 / C 类补「与 `dev_plan_v2` §1.1 裁决冲突」标注；⑦ 补三条治理项（ADR 欠账 / onboarding 双源冲突 / 状态戳滞后）；⑧ §5 阶段一收敛到 2 条泳道；⑨ 新增 §9 取数方法与复核触发条件。
> **v1.1 落地续记（同日）**：评审后立即执行了 P0-1 子项 1 与 P0-4 的文档部分——① `ci.yml` 的 `on.push.branches` 由 `[main]` 对齐为 `[master, main]`；② 新建 `docs/delivery-overview.md`；③ README 索引补齐 12 篇并修正 4 处状态戳（含 `python_ide_dev_plan_v2.md` §7 回填）；④ 补记 ADR-0006~0009，清空「待记录（候选）」；⑤ 完成最后 3 条文档回填（`multi_window_dev_plan.md` v0.2 / `onboarding_dev_plan.md` v1.3 / `onboarding_guide.md` v1.0）。**`delivery-overview.md` §4 的 9 条文档不一致已全部关闭。**
>
> **v1.2 落地续记（同日，遗留项收口）**：P0-1 三个子项全部完成——② 新增 `.github/workflows/nightly.yml`（真机全量 + bench 红线 + 预算门禁，`schedule` 每日，**失败只告警不阻断**）；③ `real-env.cjs` 新增 `OC_JSON_OUT` JSON 汇总（预检失败/运行中断也会落盘，区分"环境没起来"与"断言回归"）；④ `package-smoke` 增加 `v*` tag 触发。P1-3 落地：`ci/budgets.toml` + `budget-check.mjs`（含 `.ps1` 编码卫生检查）。P0-2 第 3 项取得**首个实测依据**（见 §2 P0-2）。

---

## 0. 一页结论

**OpenCharm 已经从"做一个 IDE"走到了"做一个什么样的 IDE"，而"什么样"这一问在 2026-10-03 有了答案。**

功能广度上，它已经超过了绝大多数自用项目的合理预期：编辑增强、Git（六迭代）、调试（DAP/debugpy）、运行（PTY + 多实例）、终端、依赖健康、库特别支持、SQLite 工具、插件切片、国际化、UI 视觉身份，全部有验收记录与 E2E 兜底。工程底座（192 个 Tauri 命令、1070 个前端用例、333 个 Rust 测试、版本锁定 + CI）在单人项目里属于头部水平。**UI 视觉六批（ADR-0005 单色相轴 → 五档表面阶梯 → 随包等宽字体 → Monaco 自定义主题 → 边框/曲线/圆角/材质）已全部落地并通过真机验收，"像没贴牌的 VS Code"这个诊断在批 4 之后已不成立。**

正因为"广"和"身份"都已到位，继续往清单里加功能的边际收益正在快速衰减，而两条更根本的缺口仍未闭合：

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| 1 | **门禁已闭环（真机层仍只告警）** | ✅ `ci.yml` 的 `on.push.branches` 原为 `[main]` 而主干是 `master` → 推送主干零触发，2026-10-03 已对齐为 `[master, main]`。✅ 新增 `nightly.yml`（`schedule` 每日）：9 个真机脚本串行 + `bench` 红线 + 预算门禁，**失败只告警不阻断**。✅ `real-env.cjs` 的 `OC_JSON_OUT` JSON 汇总（预检失败/中断也落盘，区分"环境没起来"与"断言回归"）。✅ `package-smoke` 增 `v*` tag 触发。⏳ **仍缺**：真机层**不阻断**主门禁（有意设计，双层策略）；性能红线只到 nightly 周期 | 分歧台账 D-001/D-005/D-007 的根因（LSP cwd 缺失、uv 兜底不支持调试、watcher 就绪时序）都是**真机才暴露**的集成缺陷。现在有自动化汇总，但**没人盯告警**——自用项目的真实护栏仍靠人看 artifact |
| 2 | **差异化核心缺最后一格证据** | Gate D 确定性口径**已 PASS**（`bench/reports/gate-d-runtime-completion.md`：23/23 = 100%，红线 ≥85%），剩两格 PENDING：「≥ PyCharm 同场景人工横向」+「真实项目 trace 端到端」（`intel/README.md:47` P3-T10）；trace 新鲜度降权参数仍是"拍脑袋值"（`dev_plan_v2` §7 ⚠️） | 项目立身之本（运行时智能）目前只有"能用"的证据，没有"更好"的横向证据与数据驱动的降权参数；探针数据陈旧时体验会静默退化 |

据此，本报告的建议优先级排序是：**P0-1 门禁已闭环（余"盯告警"这个人）→ P0-2 只差真人在 PyCharm 点 23 下 + 真实项目采一次数 → P0-3 验收尾账 → P0-4 结构性债（`env_cmds.rs` 要砍 49%）→ 最后才谈新功能（P1/P2 及以后）**。

> 一句话给未来半年：**少做功能，多做证据；少堆清单，多守门禁。**

---

## 1. 现状盘点

### 1.1 工程规模（实测，HEAD `ccf9da2`）

> 全部由 `node tools/stats/repo-stats.mjs` 产出（口径见 §9）。**v1.1 曾用 `Get-Content .Count` 取行数，在 gb2312 代码页上系统性偏低 4.5%~13%，本表已重取。**

| 层 | 文件数 | 行数 | 备注 |
|---|---|---|---|
| 前端源码（`shell/src/**/*.ts`，不含测试） | 218 | **57,248** | 其中顶层 `src/*.ts` 106 个 / 36,937 行 |
| 前端样式（`shell/src/**/*.css`） | 1 | **5,668** | 即 `style.css`（设计系统本体），0.2 MB |
| Rust 外壳（`shell/src-tauri/src/*.rs`） | 28 | **20,490** | **192 个 `#[tauri::command]`** |
| Rust 运行时智能（`intel/**/*.rs`，独立 workspace） | 13 | **3,766** | 44 个 `#[test]` |
| Python 探针（`probe/**/*.py`，不含 tests） | 10 | **1,573** | 零第三方依赖，81 个 pytest |
| 文档（`docs/*.md` + `adr/`） | 39 + 7 | — | ADR 为 0003–0009（另 `adr/README.md` 为索引）；README 索引收录 26 篇 |

**合计约 88.7K 行自研代码**（不含 `node_modules` / 打包产物 / 测试 / e2e / 文档）。对一个单人项目而言，这已经是**需要认真对待维护成本**的量级——这一点直接影响第 6 章的选题判断。

### 1.2 规模分布的三个结构性信号

| 信号 | 数据（HEAD `ccf9da2`） | 含义 |
|---|---|---|
| **巨型文件（趋势未逆转）** | `env_cmds.rs` **4,937** · `fs_cmds.rs` **3,882** · `git.ts` **3,204** · `main.ts` **2,897** · `git_cmds.rs` 1,882 · `lsp/client.ts` **1,774** · `db_cmds.rs` 1,537 | ⚠ **纠正 v1.1**：v1.1 依据错误行数称"UI 六批顺带把逻辑拆去了域模块、趋势已逆转"。按 `44c85ea → HEAD` 逐文件核对：`git.ts` / `lsp/client.ts` / `env_cmds.rs` / `fs_cmds.rs` / `git_cmds.rs` **一行未变**（0），`main.ts` **+58**（2,839 → 2,897）。**UI 视觉六批一行巨型文件都没拆。** 真实故事是另一回事：`tech-debt.md` 记的 TD-014 拆分成果（`main.ts` ~3,119 → ~1,196）早已被后续功能吃回（+1,701），**"拆分已见效"在 20 个提交前就已失效** |
| **样式单点逆势增长** | `style.css` 5,050 → **5,668**（**+618**） | 视觉六批全部落在这里，**且它是巨型文件之外唯一显著增长的文件**。此前无任何门槛——v1.2 已加 `ci/budgets.toml`（上限 5,850，超限即门禁失败） |
| **命令面膨胀** | 192 个 Tauri 命令；`git_cmds` 47 + `env_cmds` 32 + `fs_cmds` 28 = 107，占 **56%** | 单一进程承载过多职责。插件化（轨 B / OEP）未启动前，Rust 侧会继续膨胀；已设 200 为信号线（超限只告警，见 `budgets.toml` 的 `commands_warn_only`） |

> 口径修正（保留自 v1.1）：v1.0 写「TD-007/TD-014 把 `main.ts` 从 3,169 降到 1,620」，`docs/tech-debt.md:57` 原文是 **~3,119 → ~1,196**（TD-014 另有后续轮次到 1,620）。引用时请回 `tech-debt.md` 原文，勿二次转述。

### 1.3 能力地图（已交付）

| 域 | 关键模块 | 状态 |
|---|---|---|
| 编辑器 | `main.ts` / `monaco.ts` / `splitEditor.ts` / `editorFind.ts` / `breadcrumbs.ts` / `bookmarks.ts` / `codeVision.ts` / `inlineValues.ts` | ✅ 多标签、分屏、面包屑、书签、引用计数、行内值 |
| 补全体系 | `lsp/client.ts`（1,774）+ `importAlias.ts` + `autoImport.ts` + `live-templates/` + `postfix.ts` + `completion/keywordCompletion.ts` + intel | ✅ **六段 sortText 契约**：`0NN` 模板/postfix < `0y` autoImport < `0z` importAlias < `1xx` intel 运行时 < `2xx` 静态引擎 < `3xx` 关键字兜底（python 除外） |
| 智能模板 | `live-templates/`（builtin / ui / manager） | ✅ 容器 × 位置 × 词法三维上下文（相位 A/B 已交付） |
| Python 语义 | `pydanticDiagnostics.ts` / `pydanticField.ts` / `ruffLint.ts` / `ruffHints.ts` / `format.ts` / `frameworks.ts` / `endpointView.ts` / `stdlib.ts` | ✅ 四桶诊断 + 自研 Pydantic 构造校验与改名传播 |
| 库特别支持 | `libRegex.ts` / `libFormat.ts` / `libJson.ts` / `libEval.ts` / `libInject.ts` / `dslLens.ts` | ✅ P0 四件套 + P1 五件套（re 三件套 / 格式串 / JSON / 求值桥 / 脚本参数表单） |
| 运行 | `runFlow.ts` / `runState.ts` / `runWidget.ts` / `runHistory.ts` / `runConfigPanel.ts` + Rust `run_env.rs` | ✅ M1–M4 全交付；探针开销实测 1.35x < 1.5x 红线 |
| 调试 | `debugView.ts` / `debugGutter.ts` / `debugConsole.ts` / `debugWatches.ts` / `dap/` + Rust `dap.rs` | ✅ D1–D5 / Gate E；条件/日志断点齐全；**8 项人工验收清单待办**（P0-3） |
| Git | `git.ts`（3,204）+ `gitGutter.ts` / `gitMerge.ts` / `gitStatusState.ts` / `cloneRepository.ts` + Rust `git_cmds.rs`（47 命令） | ✅ 迭代 0–6 全交付；仅 shelf/changelist 与完整凭据 UI 暂缓 |
| 终端 | `terminal.ts` / `termUi.ts` + Rust `terminal.rs`（portable-pty） | ✅ 多会话 |
| 依赖健康 | `depHealth.ts` / `depHealthPanel.ts` / `envPanel.ts` / `toolchain.ts` | ✅ 扫描 + 修复 + 忽略清单 |
| 数据库 | `sqliteView.ts` / `sqliteTabs.ts` / `sqliteSql.ts` / `sqliteStore.ts` + Rust `db_cmds.rs` / `db_rows` | ✅ **B3 已交付 v1.4**（编辑器 Tab 化重设计，门禁全绿：tsc 0 / vitest 994 / e2e db 30/30 / cargo 286）；⏳ v1.4 真机手测待做（§10.3 的 13/13 是 v1.0 侧栏态验收）；真源 `docs/sqlite_tool_dev_plan.md` §17 |
| 插件 | `devtools/` + `extensions/` + Rust `plugin_cmds.rs` / `plugin_pkg.rs` | ✅ 工具切片 PR-1~4（490 测试）；v1 信任模型 = 同源 + facade；**v2 议题未启动** |
| 国际化 | `i18n/` | ✅ zh-CN / en-US 双语，20 批抽取，编译期对齐 |
| UI 视觉身份 | `theme/tokens.ts` + `style.css` + `tools/ui/audit_tokens.py` + `docs/adr/0005` | ✅ **六批全部落地**（批 1 / 2a / 2b / 3 / 4 / 5a / 5b / 5c）；Monaco 自定义主题 `opencharm-dark/light` + JetBrains Mono 随包；audit 98 项 0 FAIL 0 WARN；真机主题验收 32/32 PASS |
| 运行时智能 | `probe/` + `intel/` | ✅ P3-T01~T09 交付；**P3-T10 人工横向对标挂起**（P0-2） |
| 多窗口 | Rust `per_window.rs` / `window_mgr.rs` | ✅ 阶段 0/1/2 全部交付（`multi_window_dev_plan.md` v0.2；真机 `multi-window-real.cjs` 16/16 PASS）；#4~#6 依赖健康缓存经拍板暂缓 |

### 1.4 质量底座

| 项 | 现状（HEAD `ccf9da2`） | 评价 |
|---|---|---|
| 前端单测 | 92 个 `*.test.ts`；最近门禁基线 **1070 用例全绿**（`ui_premium_dev_plan.md` §1） | 强 |
| Rust 单测 | `src-tauri` **289** 个 `#[test]` + intel 44 | 强 |
| Python 单测 | probe **81** 个 pytest | 强 |
| E2E（mock 层） | `shell/e2e/` **65 个 spec**（9,648 行），分 15 个功能域目录（`http/` 目前为空占位，B4 未开工） | 强 |
| E2E（真机层） | `shell/e2e-real/` **9 个 `.cjs`**（含 `db-real` / `ui-real`），手动执行，**不进 CI** | **弱** |
| 专项门禁脚本 | `tools/ui/audit_tokens.py`（98 项）+ `shell/scripts/gate-tests.mjs unit\|e2e\|e2e-ui` + `shell/scripts/ui-baseline.mjs` | 好实践（本机 vitest 被判 watch 的绕行方案） |
| 分歧台账 | `e2e_divergence_ledger.md` D-001~D-007，含避坑速查 6 条 | 好实践，但资产未自动化 |
| CI | 单 workflow 两 job：`test`（4 矩阵）+ `package-smoke`（仅 `workflow_dispatch`）；**`on.push.branches: [main]` 与主干 `master` 不匹配 → push 零触发；无 `schedule`** | **中偏弱**（详见 §0 缺口 1） |
| 版本锁定 | `ci/versions.toml`：tauri 2.11.5 / monaco 0.52.2 / pyrefly 1.3.1 / basedpyright 1.39.10 / ruff 0.16.1 / debugpy 1.8.21 / python 3.13.7 / uv 0.10.11 / rust 1.96.0 | 强 |

### 1.5 已识别但未处理的存量债务

- **技术债登记**：待处理区仅剩 1 组（TD-021，5 个 P4 小项：终端背压 UTF-8 口径、session 恢复令牌、tab 快照保头弃尾、进程树孙进程统计、Watches 顶层副作用）。历史已归档 20+ 条——**债务治理是有效的**。
- **验收遗留**：调试 8 项人工清单（`debug_acceptance_record.md` §五）；运行侧 M2 遗留（Logpoint 三路回归、退出孤儿进程人工核验）；probe 长驻覆盖体验观察转日常。
- **计划文档与现实脱节**：`python_ide_dev_plan_v2.md` §7 状态表进度戳仍写「2026-08-24」，**未记录** Git 六迭代、远端克隆、SQLite 工具、多窗口、插件切片、库支持、依赖健康、Pydantic、i18n、UI 视觉六批等交付。
- **README 索引缺 12 篇** → ✅ **2026-10-03 已补齐**（连同新建的 `delivery-overview.md`，索引现覆盖全部 39 篇 `docs/*.md`）：`dx_features_backlog.md` / `e2e_divergence_ledger.md` / `git_clone_dev_plan.md` / `multi_window_dev_plan.md` / `onboarding_dev_plan.md` / `onboarding_guide.md` / `pycharm_framework_support_report.md` / `pycharm_ux_review_and_proposal.md` / `pyrefly_pydantic_support_plan.md` / `python_library_support_dev_plan.md` / `python_library_support_research.md` / `ui_premium_dev_plan.md`。
- **状态戳滞后** → ✅ **已修 5 处**：`README.md` 索引行的 `ui_premium_design_report` 改为 v1.2（方向已批准）并指向执行真源；`ui_premium_dev_plan.md:3` 改为「六批全部落地」；`sqlite_tool_dev_plan.md` 升 v1.5（**并校正一处归属错误**：13/13 真机属 v1.0 侧栏态，v1.4 Tab 化真机待做，见该文档 v1.5 修订说明）；`python_ide_dev_plan_v2.md:114` §7 进度戳回填至 2026-10-03 并补 13 行缺失功能域；`onboarding_guide.md` 补 v1.0 版本头。
- **ADR 欠账** → ✅ **已清**（2026-10-03）：补记 ADR-0006 双静态引擎 · 0007 intel 独立 LSP · 0008 PEP 669 采样 · 0009 补全合并策略（均标「已定案（补记）」，注明决策自 2026-08-20~21 生效）；`docs/adr/README.md`「待记录（候选）」清空。
- **onboarding 双源冲突** → ✅ **已消解**（2026-10-03）：`onboarding_dev_plan.md` 升 v1.3，按 PR 粒度回填真实状态——**PR-S1 / S2 / S4 已交付**（`welcomeGuide.ts` + `main.ts` 三处注入 + e2e `04-onboarding.spec.ts` OG-1..OG-9），S3（可选 P2）未开工、S5 登记不排期；`onboarding_guide.md` 补 v1.0 版本头 + `?raw` 打包机制说明。
- **多窗口状态滞后** → ✅ **已回填**（2026-10-03）：`multi_window_dev_plan.md` 升 v0.2——阶段 0/1/2 **全部交付**（2026-09-28 实施 / 09-30 入库 `14164e4`），真机 `multi-window-real.cjs` **16/16 PASS**；阶段 0 清单勾选依据为代码实测（后端 7 文件 22 处 `emit_to` + 前端 8 文件窗口级 `listen`，与 §3.1/§3.2 表逐项对应）；DoD 四条逐项对账关闭（第 3 条以 v0.2 修订替代独立验收记录文件）。
- **✅ 已交付（本轮）**：`docs/delivery-overview.md` 交付总览已建立——20 个功能域 × 交付日期 × 计划真源 × 验收记录 × 状态，含文档地图（按角色读）、**已知文档不一致登记表**（本文 §1.5 各条已并入该表统一跟踪）、门禁与取数命令、新会话 15 分钟上手路径。
- ~~未提交改动~~：v1.0 记录的 `README.md` / `shell/index.html` / `shell/src/style.css` 未提交改动**已全部入库**（收口于 `964ea7e` 等 20 个提交，工作区 clean）。本项从本版本移除。

---

## 2. 改进建议

> 分 P0 / P1 / P2 三档。每档内按「收益 ÷ 成本」排序。**P0 不是"最紧急的 bug"，而是"不补会持续失血的结构性缺口"**。

### P0-1 · 质量门禁闭环：✅ 全部完成（2026-10-03）

- **子项 1（✅）主干触发**：`ci.yml` 的 `on.push.branches` 原为 `[main]`，而本仓主干是 `master`（`origin/HEAD → origin/master`）——**推送到主干不触发任何 CI**。已对齐为 `[master, main]` 并在文件头注明来由。**全文投入产出比最高的一条：1 行，零逻辑风险。**
- **子项 2（✅）nightly**：新增 `.github/workflows/nightly.yml`——`schedule` 每日 03:17 UTC + 手动触发，三个 job：
  1. `e2e-real`：9 个真机脚本**串行**逐个跑（共用 5173/9223 端口，并发必撞），每套出 JSON 汇总，最后合成 `SUMMARY.md` 上传 artifact；
  2. `bench`：`build-release.ps1` + `collect-metrics.ps1 -Runs 3`（冷启动/内存红线）；
  3. `budget`：`npm run build` 后跑 `budget-check.mjs`（P1-3）。
  **全部 `continue-on-error: true`——只告警不阻断**（单人自用项目没人盯 CI 告警，价值在"出报告"而非"卡合并"）。真机层**刻意不进 `ci.yml`**：慢且不稳，混进 PR 门禁会被偶发失败淹没，护栏反而被绕过（台账原有「高频 mock + 低频真机」约定，本文件是它的自动化落点）。
- **子项 3（✅）JSON 汇总**：`real-env.cjs` 新增 `OC_JSON_OUT`（schema `opencharm-e2e-real-summary/1`），落盘 `{suite, at, ok, total, failed, error, durationMs, headCommit, cases[]}`。**预检失败与运行中断也会落盘**（`error` 字段 + `ok:false`），使 CI 能区分"环境没起来"与"断言回归"；`0 项 + 无 error` 判 `false`，避免空跑被误当通过。
- **子项 4（✅）tag 触发**：`package-smoke` 的 `if` 由 `event_name == 'workflow_dispatch'` 放宽为 `|| startsWith(github.ref,'refs/tags/v')`，`on.push.tags` 加 `v*`。发布前门禁不再全靠人记得手动点。
- **本机入口**：`shell/e2e-real/run-real-all.ps1`（一键全量跑批 + 合并汇总，套件清单与 nightly 一致；默认跳过 probe 压测三支；`-Strict` 才非零退出）。串行与端口约束在脚本里预检，占用即停。
- **验收状态**：✅ 配置齐备。**待观察**：master push 首次触发、nightly 首次出汇总、首次 tag 触发 smoke——三者都需 GitHub Actions 实际跑过才能确认。
- **成本**：实际约 1 人日（v1.0 估 2 人日）。

### P0-2 · 兑现差异化核心：Gate D 两格 PENDING（工具已就绪，余纯人工）

- **问题（纠偏 v1.2 补充）**：确定性口径 base 数值已 PASS——`bench/reports/gate-d-runtime-completion.md`：**23/23 = 100%**，≥85% 红线 PASS，覆盖无注解代码四类形态，判定口径"期望 label 出现在 top-5"。**真正缺的只有两格**：
  1. **≥ PyCharm 同场景人工横向**（`intel/README.md:47` P3-T10 至今挂起；PyCharm 无 CLI 导出补全准确率，只能人工复核）；
  2. **真实项目端到端数据**（当前评测是 deterministic seed）。
- **⚠ v1.2 发现的评测覆盖空洞**：`bench_seed()`（`completion.rs:780`）插入的 6 个函数**全部 `stale=0`**，所以 23 个评测点对**降权策略零覆盖**——100% 这个分数**既不能证明也不能反驳降权行为是否合理**。已补 `stale_candidates_rank_below_fresh_ones` 单测钉住该行为（33/33 通过）。
- **✅ 第 3 项已取得首个实测依据**（2026-10-03）：
  - 新增 **`tools/intel/trace_stats.py`**（只读分析器）：读真实 trace 库（SQLite），统计 `stale` 占比 / `hits` 长尾 / 体积增长，按透明规则给出降权系数、类型推断策略、保留窗口的建议值与依据；无库时输出"参数至今无数据支撑"的结论。
  - 本机此前**根本没有 `traces/*.db`**（任何数据根下都没有）——这就是"拍脑袋值"长期存在的根本原因。用 IDE 同款注入 env（`run_env.rs:274-289` 的四件套）跑 `tools/ui/audit_tokens.py` 真实代码，产出 **56 函数 / 177 类型观测 / 56 KB**。
  - **stale 实验**（可复现）：构造 2 文件 × 2 函数，全量跑一次 → 改其中 1 个文件的 mtime → 只跑另一半，**stale 占比 30.0%（3/10）**。即在"改一个文件、只跑相关代码"这一常见编辑流下，**约 1/3 的运行时观测立刻变 stale**。按 `trace_stats.py` 的规则，30% 落在"建议降到 0.25"档。
  - **但没有直接改系数**：`completion.rs` 的 `f.hits / 2` 已从裸字面量提成具名常量 `STALE_HITS_DIVISOR`（值不变），并把上述实测写进注释。理由：唯一样本只有 10 条函数、来源是合成实验，不足以支撑改交互体感。**待真实项目跑出 ≥1000 条观测后用同一脚本复核再定值**——这条从"拍脑袋"变成了"有据 + 待复核"。
- **建议动作**：
  1. ~~人工对标工作单~~ ✅ **已自动生成** `bench/reports/gate-d-ab-worklist.md`：设 `OC_GATE_D_WORKLIST=<路径>` 后跑 `cargo test -p opencharm-intel -- --nocapture runtime_completion_accuracy` 即导出——**OpenCharm 侧 23 点的实际排名已由测试填好**，人只需在 PyCharm 同一样例上勾"是否在 top-5"。避免了让人重新拼 23 个光标位置（既慢又必然与 cases 数组漂移）；
  2. 在**一个真实项目**上跑 probe 采集，用 `trace_stats.py` 复核端到端口径与降权参数（这一步同时为第 3 项供真实样本）；
  3. 结论回写 `intel/README.md` 与 `dev_plan_v2` §7，把 ⚠️/PENDING 改成 ✅ 或明确记 ❌。
- **成本**：余约 **0.5~1.5 人日**（工作单与工具已就绪，只剩真人在 PyCharm 里点 23 下 + 真实项目采一次数）。v1.0 估 3~5 人日。
- **验收**：`gate-d-ab.md`（= 工作单填完 PyCharm 列）+ 降权参数在 ≥1000 条真实观测上复核 + 三处文档状态一致。

### P0-3 · 收口人工验收清单 + 修 onboarding 双源冲突

- **问题 A（验收尾账）**：✅ **已全部收口**（2026-10-03）——调试 8 项人工清单中 #1~#4/#6 由 e2e 覆盖，**#5（三态互斥）、#7（改键生效）本轮已自动化**（`debug-real.cjs` 新增 R-REAL-9/10/11/12，实测 **12/12 PASS**），**#8（真安装包验收）已完成**（出包链路修复 → 8.63 MB 安装包 → 安装至 `D:\OpenCharm` → `release-real.cjs` **7/7 PASS**）。SQLite v1.4 真机手测与双主题截图**已完成**（`db-real.cjs` 按 v1.4 重写，**18/18 PASS**）。**遗留仅 3 个产品缺陷待修**（D-6/D-7/D-8，见下）。
- **本轮新发现的产品缺陷（待修）**：**D-6**（SQLite 单元格详情面板无关闭按钮，中）· **D-7**（调试中运行菜单项未置灰，中）· **D-8**（改键后调试工具栏 tooltip 滞后，低）。证据与修法建议见 `debug_acceptance_record.md` §5.2 与 `sqlite_tool_dev_plan.md` §17.8。
- **问题 B（onboarding 双源）**：✅ **已消解**（2026-10-03，`onboarding_dev_plan.md` v1.3）——PR-S1/S2/S4 早已交付（`welcomeGuide.ts` 三步卡 + 功能巡礼 + force-show + 指南三入口，e2e OG-1..OG-9），计划状态回填完毕。**剩余可选缺口**：PR-S2 的欢迎页巡礼条目策展扩充、PR-S4 的两处小修是否补做——按需，不影响交付完整性。
- **建议动作**：
  1. 修 **D-6**（加关闭按钮或绑 `Esc`）——三项里唯一影响日常使用的；
  2. 修 **D-7**（`main.ts:1789` 的 `disabled` 补 `|| s.debugging`）——一行，消除按钮/菜单反馈不一致；
  3. 修 **D-8**（`settingsPanel.ts` 保存后追加刷新调试工具栏）——低优先级，可搭车下次设置面板改动；
  4. ~~出包阻塞~~ ✅ 已解决（VS Build Tools 2022 + `tools/msvc-env.ps1`；出包 → 安装 → `release-real.cjs` 7/7）。
- **成本**：修 3 个缺陷约 0.5 人日（D-6 优先）。
- **判断依据**：在"再加 10 个功能"和"让已有 100 个功能被找到"之间，后者边际收益明显更高——尤其对单人自用场景，用户就是产品负责人本人。

### P0-4 · 偿还结构性债（拆分 + 交付总览）

- **问题（v1.2 重估）**：`env_cmds.rs` **4,937** 行（Rust 侧最大单文件，32 个命令）；`fs_cmds.rs` 3,882 / `git.ts` 3,204 / `main.ts` 2,897。⚠ **v1.1 说"`main.ts` 趋势已逆转、六批 UI 已顺带降到 2,503"是错的**（见 §1.2 纠正）——`main.ts` 现在是 2,897，比 UI 改造前的 2,839 还多 58 行，**且 20 个提交里这些文件一行都没被拆**。`tech-debt.md` 记的 TD-014 拆分成果（~1,196）早已被功能增长吃回。
- **建议动作**：
  1. `env_cmds.rs` 按职责切三块（解释器管理 / 包操作 / 版本探测），Rust 侧测试已按文件聚合，拆分后测试随迁。**注意真实目标是从 4,937 砍到 <2,500，即 -49%**（v1.1 按错误行数以为只是 4,484→2,500，工作量被低估）；
  2. `main.ts` **仍需安排拆分**（v1.1 曾判"不必拆"是基于错误数字）：至少把新功能外提，净增长受 `budgets.toml` 的 3,000 上限约束；`git.ts` 保持观察（3,204，20 提交零变化）；
  3. ~~建 `docs/delivery-overview.md`（交付总览）~~ ✅ **已交付**；README 索引 ✅ 补齐 39 篇；`python_ide_dev_plan_v2.md` §7 状态表 ✅ 已回填；`onboarding_dev_plan.md` 与 `multi_window_dev_plan.md` ✅ 均已回填（v1.3 / v0.2）。
- **成本**：约 **3~4 人日**（比 v1.1 的 2~3 人日上调——`env_cmds.rs` 实际要砍 2,437 行而非 2,000 行，且 `main.ts` 重新进入待拆名单）。
- **验收**：`env_cmds.rs` < 2,500 行且 cargo test 全绿；`budget-check.mjs` 绿灯；`delivery-overview.md` 与实际一致。

---

### P1-1 · 可观测性：从"有日志"到"能定位"

现状已有 `logging.rs`（落盘 + 级别 + 轮转 + 设置面板），缺的是**主动诊断能力**。建议补三件低成本的：

| 项 | 内容 | 价值 |
|---|---|---|
| 慢操作追踪 | 对 `invoke` 命令与 LSP 请求记耗时直方图，设阈值（如 >500ms）落 warn | 自用场景下"卡一下"最难复现，有数据就不用猜 |
| 会话诊断导出 | 一键打包：日志 + settings.json + 版本信息 + 最近 20 条错误 → zip | 出问题时不至于翻三个目录 |
| 关键路径埋点 | 冷启动各阶段耗时（窗口创建 / LSP 起 / 索引加载 / 首屏渲染）落日志 | 把"冷启动 <1.5s"从红线变成可归因的曲线 |

成本约 2~3 人日。

### P1-2 · 发布工程：自动更新与回滚

- 现状：一键打包（`build-release.ps1`）+ NSIS 出包已落地，但**没有更新通道**，也没有版本回滚（`shell/src-tauri/Cargo.toml` 无 updater 依赖）。自用项目也要面对"我这版是不是装错了"。
- 建议：`tauri-plugin-updater` 或最简方案（发布时产出 `version.json`，应用启动时比对并提示）+ 安装包保留最近 2 版；设置面板加"检查更新"。
- 成本：约 1~2 人日（最简方案）。

### P1-3 · 性能与体积预算制度化：✅ 已落地（2026-10-03）

- 现状（v1.2 重述）：冷启动 <1.5s / 内存 ≤600MB 此前只在手动 smoke 时验证；`style.css` 已从 5,050 涨到 **5,668**（+618）且无任何门槛。
- ✅ **已交付**：
  1. **`ci/budgets.toml`**——阈值全部显式外置，纪律是"**只允许显式 PR 修改，脚本绝不自动抬阈值**"；抬高预算 = 承认一次架构退让，必须在 PR 写清理由。含 7 个超长文件的行数上限 + 命令数信号线（200，**只告警不阻断**，见 `[policy] commands_warn_only`）+ 产物体积上限（5,120 KB，实测 4,918 KB）。
  2. **`shell/scripts/budget-check.mjs`**——断言脚本，超限非零退出；`--report` 只打印不失败，`--no-write` 不落盘；报告落 `bench/reports/budget-<date>.md`。
  3. **`tools/stats/repo-stats.mjs`**——取数口径固化为**代码**（这是 v1.2 纠正 v1.1 那处系统性错误的关键：口径写进文档还会再犯，写进脚本才不会）。
  4. **`.ps1` 编码卫生检查**（并入 `budget-check.mjs`）——含中文的 `.ps1` 必须带 UTF-8 BOM。理由：本机 PS 5.1 的 ANSI 代码页是 gb2312，无 BOM 的中文 `.ps1` 会被 GBK 解码成乱码并**直接语法报错**（实测 `run-real-all.ps1` 初版即因此跑不起来）。仓库既有约定正是如此（`bench/collect-metrics.ps1` 是唯一含中文的 `.ps1`，它就带 BOM）。这条把本轮踩到的坑也变成了门禁。
  5. `bench/collect-metrics.ps1` 的红线断言已纳入 nightly（`bench` job，`-Runs 3`）。
- **验收状态**：✅ 本机全绿（9 项 + 编码卫生，共 10 项 PASS）。**待观察**：nightly 的 `budget` job 首次跑通。
- 成本：实际约 0.5 人日。

### P1-4 · 补齐真机 e2e 覆盖的关键路径

现有 9 个 `.cjs` 已覆盖 debug / db / endpoints / multi-window / new-project / ui / probe 三支。按功能域继续补齐：**LSP 真引擎（pyrefly 裸会话）、运行真 `uv run`、终端真 PTY、插件真加载**。优先补**跨进程链路**类（最容易出集成缺陷），纯前端交互交给 mock 层。
成本：每域约 0.5~1 人日。

### P1-5 · 偿还 TD-021 五小项

5 个 P4 项，其中 **① 终端背压 UTF-8 口径**（CJK 下阈值放宽 3 倍）与 **③ tab 快照保头弃尾**（丢最近打开的 tab）在中文 Windows 自用场景下有实际体感，建议优先。其余三项按"顺手"原则处理。
成本：合计约 1~2 人日。

### P1-6 · 插件 v2 议题启动（择一）

`plugin_system_design.md` §10 列出 5 个全局待决策点 + 9 个切片决策。v2 议题里**性价比最高的是"工作区级插件目录"**（加载器只是多一个扫描根，非破坏性扩展，且能让插件随仓共享）。硬沙箱（iframe/Worker）与 Python 工具桥成本高、收益对自用场景有限，建议继续延后。
成本：工作区级目录约 1 人日。

---

### P2-1 · UI 视觉「批 6+」第二阶段（可选，非必需）

v1.0 的 P0-3（视觉改造）在 `964ea7e` 已**全部交付**（六批 + ADR-0005 + 真机 32/32）。本项仅登记后续可能方向，**不排期**：材质细节再深化、`opencharm-dark/light` 语法色与外壳的进一步同色、字体副档（如无衬线 UI 字体随包，v1.0 已裁决不做）。若开，须沿用 `ui_premium_dev_plan.md` §6 的批次入口 + §4 门禁（`audit_tokens.py` + token 单测 + e2e computed-style 断言 + 截图比对），且**不得往 `main.ts`（2,503 行）堆逻辑**。

### P2-2 · 多窗口阶段 1/2 复核与收口

先复核 `per_window.rs` 落地后阶段 1/2 的真实状态，把 `multi_window_dev_plan.md` 的状态栏与实施记录回填，再决定是否继续投。文档与代码不一致本身就是维护负担来源。

### P2-3 · 跨仓库/跨机器设置同步

`settings.json` + 键位 + live templates + import 别名学习表导出/导入（storagePanel 已有迁移基建可复用）。多机开发时价值明显。
成本：约 2 人日。

### P2-4 · Web 侧能力（远程/WSL/SSH）

成本高、与"Windows 单机自用"画像契合度低，建议**只登记不排期**，除非出现明确使用场景。

---

## 3. 未来功能候选池

> 说明：以下不是"要做的事"，是**选题池**。每条给出价值 / 成本 / 依赖 / 风险 / 与铁律的关系，供产品负责人按阶段挑选。**建议每个阶段只从 A/B 两类各挑 1~2 个。**

### A 类 · 深化差异化（护城河）—— 建议优先

A 类全部复用已有的 probe trace 数据或外壳基建，**别人抄不走**。

| # | 功能 | 说明 | 成本 | 依赖 | 风险 |
|---|---|---|---|---|---|
| A1 | **运行时热点视图** | 侧栏新视图：按 `hits` 排序列出真实跑过的函数，标注"从未运行"的可疑函数（死代码候选）+ 异常观测 `exc_types` 标记 | 中（2~3d） | intel 索引已有 `hits` / `exc_types` | ① 需定义"从未运行"的置信口径（受采样与覆盖范围影响），避免误报成噪音；② **开工前先核对与已交付 `inlineValues.ts`（行内值，同为 trace 驱动）的基建重叠面**，避免两套 trace→UI 通道 |
| A2 | **轻量内置 Profiler** | probe 已挂 `sys.monitoring`，扩展采集调用耗时 → IDE 内函数级耗时视图 + Top-N 慢函数 + 点击跳转。对标 cProfile + snakeviz，但**零用户操作** | 中-大（5~8d） | PEP 669 事件扩展；开销预算需重新定（现红线 1.5x 是类型采样口径） | 开销上升；需新增"性能模式"开关，默认关 |
| A3 | **trace 驱动的签名补全与默认值提示** | `arg_types` 已按参数位累加观测 → 调用处补全参数名、hover 显示"实际见过的类型与常见值" | 小-中（2d） | intel `arg_types` | 与静态补全排序竞争（沿用 `1xx` 段钉序即可） |
| A4 | **爬虫场景工具箱**（画像强绑定） | 选择器测试面板（输入 HTML + CSS/XPath → 实时结果，复用 `libEval` 求值桥）、请求回放、响应结构 → Pydantic model 生成 | 中（3~5d） | `libEval` / `endpointView` / 运行历史 | 面窄但精准——用户画像是「FastAPI + 爬虫 + 小脚本」，这是**只有 OpenCharm 会做**的功能 |
| A5 | **FastAPI 路由面板增强** | 已有 `endpointView.ts`；扩展 OpenAPI/Schema 预览、路由 ↔ handler 双向跳转、一键生成 curl（反向已有 `curl2python`）与请求样例 | 中（3d） | `frameworks.ts` / `endpointView.ts` | 需决定是静态解析还是运行时导入（运行时更准但需装依赖） |
| A6 | **trace 驱动的 lint** | 用运行时观测反哺静态诊断：形参从未收到某类型却按该类型使用、函数从未被调用、`exc_types` 显示有异常路径却无 try | 中-大（5d） | 诊断合并管线 | 与四桶诊断的冲突消解规则；误报控制是成败关键 |

### B 类 · 补齐 IDE 基本功

| # | 功能 | 说明 | 成本 | 备注 |
|---|---|---|---|---|
| B1 | **pytest 集成** ⚠️ **与现行裁决冲突，需先动裁决** | `pytest -q` / `--json` 结果解析 → 树形结果面板 + 失败点击跳转 + 重跑单测 | 中（3~4d） | **现行裁决不止 README**：`python_ide_dev_plan_v2.md:18`「明确不做 pytest 面板」· `pycharm_ux_review_and_proposal.md:393` F-1 **已于 2026-09-25 裁决「维持非目标」** · `python_library_support_research.md:325`「不复议」。**按文档约定铁律，动它必须先修订 `dev_plan_v2` §1.1**，本条不能按"候选"直接进阶段二。若裁决变更，建议边界照 `python_library_support_research.md` §8 划法：**不做测试发现/结果树**，只做"运行当前测试文件 → 摘要 + 失败行跳转"最小闭环 |
| B2 | **REPL / Scratch 执行** | 选中代码 → 发送到长驻 Python 进程执行（复用 `libEval` 求值桥 + 终端 PTY）；或轻量 cell 模式 | 小-中（2d） | 与 A4 共享求值桥基建；对"小脚本"画像高频 |
| B4 | **HTTP Client**（`.http` 文件） | 类 REST Client：写请求 → 发送 → 历史 + 变量；与 A5/A4 天然协同 | 中-大（7~9d，含 reqwest） | 已有 `curl2python` 与求值桥可复用。已有 PR 级计划：`docs/toolbox_dev_plan.md` §5 |
| B5 | **日志/输出结构化视图** | 运行输出里结构化日志（JSON/loguru）的级别过滤、字段折叠、时间戳对齐 | 小-中（4~5d） | 复用 `output.ts` 已有级别层；需把 `termUi` 采集钩子改多播。已有 PR 级计划：`docs/toolbox_dev_plan.md` §6 |
| B6 | **TODO/任务与文档工具** | 已有 `todoView.ts` / `markdownPreview.ts`；可扩 Mermaid/图表预览、文档大纲 | 小（3~4d） | 低风险。已有 PR 级计划：`docs/toolbox_dev_plan.md` §7 |

> **B3（SQLite 工具）已退出候选池**：v1.0 曾列为"已实施待收尾"，实际已交付 **v1.4**（编辑器 Tab 化重设计，§17 为真源；v1.2 宽屏态已被取代拆除），门禁全绿；⏳ 收尾只剩真机手测（详见 `docs/sqlite_tool_dev_plan.md` v1.5 与 §17.7）。

### C 类 · AI 能力（与现行定位冲突，需产品裁决）

项目定位长期写「明确不做 AI」（`python_ide_dev_plan_v2.md:18`）。若要推翻该定位并做，**建议只做不抢戏的三件小事**，且必须可一键关闭：

| 功能 | 说明 | 成本 |
|---|---|---|
| Traceback 解释器 | 运行失败时，在 traceback 面板旁给一句"人话解释 + 可能原因"（可走云端免密钥 LLM 或本地小模型） | 小（1~2d，不含接入） |
| 提交信息生成 | 现有是规则式 Conventional Commits（Git 迭代 5 已落地）；可作为**增强**提供 AI 版，规则版保留为默认 | 小 |
| 选中代码解释 / 重构建议 | 右键菜单入口，走同一套 AI 通道 | 中 |

**风险与纪律**：AI 是"装饰过载"和"身份稀释"的高发区——视觉报告 §7 明确反对引入"AI 紫"作为第三种色系。若立项，须遵守：① **先修订 `dev_plan_v2` §1.1 的"明确不做 AI"**；② 独立模块 + 全局开关，默认关；③ 不进补全主链路（避免与六段 sortText 契约打架）；④ 不引入新色系。

### D 类 · 生态与平台（长线）

- 插件 v2：硬沙箱（iframe/Worker）+ 跨 realm facade、Python 工具桥（Pyodide / 轨 B 子进程）、`.ocx` 安装包格式；
- 插件市场 / 模板分享（当前明确不做，维持）；
- OEP（OpenCharm Extension Protocol）复用 LSP 超集的决策点；
- 多语言支持（现为 Python 专用，铁律未禁止但会稀释定位）。

---

## 4. 优先级矩阵（全部建议汇总）

| 建议 | 价值 | 成本 | 依赖 | 优先级 |
|---|---|---|---|---|
| P0-2 Gate D 两格 PENDING + trace 调参 | ★★★★★ | 中（载体与工具已就绪） | 人工操作 | ★★★★★ |
| P0-3 验收尾账 + onboarding 双源裁定 | ★★★★ | 中小 | — | ✅ **已交付**（真机阻塞项除外，见下） |
| P0-4 `env_cmds.rs` 拆分（−49%） + `main.ts` 外提 | ★★★★ | 中 | — | ★★★★☆ |
| A1 运行时热点 / 死代码视图 | ★★★★ | 中 | intel 索引（先核 inlineValues 重叠） | ★★★★☆ |
| A3 trace 驱动签名提示 | ★★★ | 小 | arg_types | ★★★★ |
| P1-1 可观测性三件套 | ★★★ | 中 | — | ★★★ |
| B2 REPL / Scratch | ★★★ | 小 | 求值桥 | ★★★ |
| A5 FastAPI 面板增强 | ★★★ | 中 | endpointView | ★★★ |
| P1-2 自动更新 | ★★★ | 小 | — | ★★★ |
| A4 爬虫工具箱 | ★★★★（画像匹配） | 中 | 求值桥 | ★★★ |
| P1-5 TD-021 五小项 | ★★ | 小 | — | ★★ |
| A2 内置 Profiler | ★★★★ | 大 | 开销预算重定 | ★★（排后） |
| C 类 AI 三项 | ★★（**与 §1.1 冲突**） | 小-中 | 修订定位裁决 | ★（待裁决） |
| B1 pytest 集成 | ★★★（**与 §1.1 冲突**） | 中 | 修订 F-1 裁决 | ★（待裁决） |
| A6 trace 驱动 lint | ★★★ | 大 | 误报控制 | ★（排后） |
| P2-1 UI 批 6+ 第二阶段 | ★★（可选） | 中 | 视觉六批已交付为前提 | ★（不排期） |
| D 类生态长线 | — | 大 | — | 不排期 |
| ~~P0-1 CI 主干触发 + nightly + bench 入 CI~~ | ★★★★★ | 极小 / 中 | — | ✅ **已交付**（待首跑观察） |
| ~~P1-3 体积/性能预算断言~~ | ★★★ | 极小 | 搭 P0-1 | ✅ **已交付** |
| ~~B3 SQLite 工具~~ | — | — | — | ✅ **已交付 v1.4** |

---

## 5. 路线图建议

> 按**主题泳道**而非时间盒排列；每阶段**只开 2 条泳道**（单人维护 88.7K 行的现实约束）。v1.0 阶段一铺了 4 条，与"只开 2~3 条"自自相矛盾，v1.1 已收敛。

### 阶段一 · 收口期（**门禁泳道已交付**，余人工；约 0.5~1.5 人日）

| 泳道 | 内容 |
|---|---|
| 门禁 | ✅ **已交付**：`ci.yml` push 分支对齐 `master` + `nightly.yml`（真机全量 + bench 红线 + 预算） + `OC_JSON_OUT` 汇总 + `v*` tag 触发 smoke + `budgets.toml`/`budget-check.mjs`/`repo-stats.mjs` + `.ps1` 编码卫生门禁。⏳ 余：真机层告警的**通知渠道**（人看 artifact） |
| 差异化 | ⏳ **工具已就绪，只剩人工**：在 PyCharm 里按 `bench/reports/gate-d-ab-worklist.md` 勾 23 点（OpenCharm 列已自动填好）→ 产出 `gate-d-ab.md`；在真实项目采一次 trace 用 `trace_stats.py` 复核降权参数 |

**阶段门**：master push 自动跑 `test`（✅ 配置已对齐，**待首次实际触发确认**）；nightly 出真机汇总（⏳ 待首跑）；Gate D 两格 PENDING 收敛为 ✅ 或明确 ❌（⏳ 待人工）。

### 阶段二 · 深化期（约 6~10 周，2 条泳道）

| 泳道 | 内容 |
|---|---|
| 差异化 | A1 运行时热点 + A3 签名提示（共用 intel 数据层） |
| 基本功 | P0-3 验收尾账 + onboarding 剩余 PR-S2/S4 + P0-4 `env_cmds.rs` 拆分（−49%）与 `main.ts` 外提 |

**阶段门**：热点视图对"死代码"的误报率可接受；`env_cmds.rs` < 2,500 行；`delivery-overview.md` 与实际一致；onboarding 双源已裁定。

### 阶段三 · 画像期（约 10~18 周，2 条泳道）

| 泳道 | 内容 |
|---|---|
| 画像专项 | A4 爬虫工具箱 或 A5 FastAPI 增强（建议先做与当季实际工作最相关的那个） |
| 可选 / 债务 | B4 HTTP Client（与 A4/A5 共享基建）+ P1-4 真机覆盖补全 + P1-6 工作区级插件目录 |

### 阶段四 · 评估期（18 周后）

回头看阶段二/三的真实使用率（可用 P1-1 的埋点数据），决定：A2 Profiler 是否立项、B1/C 类是否值得修订裁决、P2-1 UI 批 6+ 是否开工、D 类是否启动。**没有使用数据的功能等于没有交付**——这一点应在阶段二就靠埋点准备好。

---

## 6. 维护成本：单人项目最大的长期风险

`dev_plan_v2` §9 风险登记册已列「自用项目长期维护负担 — 自研组件全部独立成包/进程」。83K 行代码 + 38 篇文档 + 192 个命令的现实下，这条风险的量级已经变了。**（v1.2 校正：应为 88.7K 行 + 39 篇文档）**补充三条具体对策（每条都对应上文一个可执行项）：

1. **降低"知道项目在哪"的成本**：`docs/delivery-overview.md`（P0-4）是杠杆最高的一项——它同时服务未来的自己和任何接手的会话。
2. **降低"改坏不知道"的成本**：nightly 真机 + bench 红线（P0-1）。单人项目没有 code review 的第二双眼睛，自动化门禁是唯一替代。**而当前 master push 零触发，等于这双眼睛还没睁**——修它只需 1 行。
3. **降低"升级不敢动"的成本**：`ci/versions.toml` 已锁定 9 类依赖，但「升级回归 CI 自动化」在 §7 仍标 ⚠️。建议把"每月一次依赖升级演练"固化成 nightly 的一个可选 job（装新版本 → 跑 bench → 出对比报告，不自动合入），把升级从"事件"变成"例行公事"。

---

## 7. 明确不做（维持现有裁决）

按强度分三档：**不做**（明列裁决）· **推迟**（已裁决但可复议）· **登记不排期**（契合度低，出现明确场景再议）。

| 不做 | 强度 | 理由 |
|---|---|---|
| pytest 面板 / 测试运行器 | 不做（三处一致：dev_plan §1.1 · UX 报告 F-1 已裁决 2026-09-25 · 库支持研究 §8） | 维持现状；若要推翻须先修订 §1.1（见 B1） |
| AI 能力 | 不做（dev_plan §1.1 明列） | 若要推翻须先修订定位裁决（见 C 类） |
| 插件市场 / 模板市场 | 不做 | 自用场景无收益，运营成本不成比例 |
| 协作编辑 | 不做 | 与单人自用定位无关 |
| 替换 Pyrefly 为第三方语言服务 | 不做 | 铁律：第三方只补充不替换 |
| 往代码区加装饰（圆角/阴影/渐变/毛玻璃） | 不做 | 视觉报告 §7：装饰占观感权重仅 4%，且在 IDE 语境有害 |
| 引入第三种色系（如"AI 紫"） | 不做 | 同上，色系越多越难看；单色相轴已由 ADR-0005 锁定 |
| 增加字号档位 | 不做 | UI-18 已从 12 档收敛到 6 档（再未新增），再加是倒退 |
| 破坏六段 sortText 契约的补全来源 | 不做 | 补全排序是用户体感核心，任何新来源必须明确钉段 |
| 远程 / WSL / SSH 开发 | 登记不排期 | 成本高，与 Windows 单机画像契合度低 |
| 多语言支持 | 推迟（已裁决推迟） | 会稀释 Python 专用定位 |
| 硬沙箱插件（iframe/Worker）/ Python 工具桥 | 推迟 | 成本高，自用场景收益有限；工作区级插件目录已足够 |

---

## 8. 待补充 / 本报告未覆盖

- ✅ **已补**：probe/intel 的实际运行数据——`tools/intel/trace_stats.py` 已落地并产出首个实测（56 函数 / 177 观测；stale 实验 30%）。**仍缺真实项目的大样本**（≥1000 条观测）才能定降权系数。
- ✅ **已补**（2026-10-03）：`shell/e2e-real/` 真机状态——`db-real.cjs` **按 v1.4 契约整体重写并实测 18/18 PASS**（旧 S10.x 侧栏态用例引用的 id 已被 v1.4 重设计整体移除，旧脚本在 v1.4 下根本跑不过，这是"真机待办"长期挂起的隐藏副作用）；`debug-real.cjs` **扩到 12/12 PASS**（新增 R-REAL-9/10 三态互斥、R-REAL-11/12 改键生效）。详见 `sqlite_tool_dev_plan.md` §17.8 与 `debug_acceptance_record.md` §五。
- ✅ **已补**（2026-10-03）：**真安装包验收（调试 §五 第 8 项）** —— 阻塞已解决（VS Build Tools 2022 + `tools/msvc-env.ps1` 进程级环境装配），打出安装包 8.63 MB 并安装至 `D:\OpenCharm`，四项自研组件随包落地；`e2e-real/release-real.cjs` 对**安装后的程序**实测 **7/7 PASS**（含 debugpy 随包可用、运行脚本真实输出）。详见 `debug_acceptance_record.md` §5.1 与 `bench/reports/release-build-blocker.md`。
- ⏳ **产品缺陷待修（本轮真机新发现）**：**D-6** 单元格详情面板无关闭按钮、打开后无法关闭（`sqliteTabs.ts:383-397`，中）；**D-7** 调试中「运行脚本」菜单项未置灰（`main.ts:1789` 漏 `debugging`，中）；**D-8** 改键后调试工具栏 tooltip 键位副文本不刷新（`settingsPanel.ts:924-927` 刷新清单缺调试工具栏，低）。D-6 建议优先（可用性）。
- ⏳ **出包环境的两个易复发点**（已修但值得记住）：① VS Build Tools **必须管理员安装**，否则实例不入注册表、`vswhere` 查不到，cargo/cc 会静默回落 VS2015；② PowerShell 的 `$ErrorActionPreference="Stop"` 会把 cargo 的 stderr 进度行当致命错误（`build-release.ps1` 已用 `Invoke-Native` 兜住）。另：安装包 `/S` 静默安装在本机无效，验收需走"安装后程序 + CDP"。
- ✅ **已补**：多窗口阶段 1/2 的真实完成度——`multi_window_dev_plan.md` v0.2 已按代码实测回填（后端 7 文件 22 处 `emit_to` + 前端 8 文件窗口级 `listen`）。
- ⏳ 打包产物的实际体积与冷启动/内存的**最新实测值**（`bench/collect-metrics.ps1 -Runs 3` 已在 nightly `bench` job 里，但本机未跑；`bench/reports/` 有 `engine-perf-comparison.md` 等 13 份历史报告，无近期红线报告）。**产物体积已由 `budget-check.mjs` 覆盖**（4,918 KB / 上限 5,120 KB）。
- ⏳ **真机层的"告警没人看"问题**：nightly 只告警不阻断，对自用项目而言护栏仍依赖人主动看 artifact。彻底解法是接通知渠道（Windows 通知 / 邮件），本轮未做。

---

## 9. 取数方法与复核触发条件（v1.2 重写）

本报告是**快照文档**，且已两次证明会过期：v1.0 基线 `44c85ea` 在 20 个提交内出现 3 处失效结论（§0 缺口 3 / P0-3 / B3）；**v1.1 更糟——它自己的数字就是错的**（用了在 gb2312 代码页上丢行的 `Get-Content .Count`）。

**因此 v1.2 的核心改动是：取数口径从"文档里的命令"变成"仓库里的代码"。**

| 动作 | 命令 |
|---|---|
| **本文所有规模数字（一次拿全）** | **`node tools/stats/repo-stats.mjs`**（`--no-write` 只打印） |
| 规模预算断言（超限非零退出） | `node shell/scripts/budget-check.mjs`（`--report` 只打印 / `--no-write` 不落盘） |
| 确认取数时点 | `git rev-parse --short HEAD`（本文数字对应 `ccf9da2`） |
| 门禁 | `node shell/scripts/gate-tests.mjs unit\|e2e\|e2e-ui`（**不要直接跑 `vitest`**，本机会被判为 watch 并杀进程） |
| token 门禁 | `python tools\ui\audit_tokens.py`（98 项检查，退出码非 0 即失败） |
| trace 库统计（Gate D 调参） | `python tools/intel/trace_stats.py`（只读；`--out <报告>`） |
| Gate D 人工对标工作单 | `set OC_GATE_D_WORKLIST=<路径>` + `cargo test -p opencharm-intel -- --nocapture runtime_completion_accuracy` |
| 真机层（本机一键全量） | `powershell -File shell\e2e-real\run-real-all.ps1`（串行；`-Only` / `-Skip` / `-Strict`） |
| 真机层（单套件） | `cd shell && set "OC_JSON_OUT=<路径>" && node e2e-real\<name>.cjs` |

### ⚠ 取数禁则（三条都是本轮踩过的坑）

1. **禁止用 `Get-Content $f`（不带 `-Encoding`）统计行数。** 本机 PS 5.1 的 ANSI 代码页是 **gb2312**；对**无 BOM 的 UTF-8 源文件**它会按 GBK 解码并**吞掉换行**——实测 `style.css` 报 5,410（真实 5,668，少 4.5%）、`main.ts` 报 2,503（真实 2,897，少 13%）。丢失比例随 CJK 密度而变、**逐文件不同**，所以这批数字"看起来合理但系统性偏低"，极难自查。
   正确写法任选其一（三者对同一文件必然同值）：`Get-Content -Encoding UTF8 $f` · `[System.IO.File]::ReadAllLines($abs)` · `node -e "..."`（按 `\r?\n` 切分）。
2. **禁止用 `Measure-Object -Line`。** 它不计空行（`style.css` 上给 5,145，比真实值少 523）。
3. **含中文的 `.ps1` 必须带 UTF-8 BOM。** 否则同样被 GBK 解码成乱码并**直接语法报错**（不是静默出错，是脚本跑不起来）。仓库既有约定：`bench/collect-metrics.ps1` 是唯一含中文的 `.ps1`，它就带 BOM。`budget-check.mjs` 已把这条做成门禁。

**复核触发条件**（满足任一即需重取数字并更新本文头部「取数时点」）：① HEAD 变动 ≥ 10 个提交；② 任一专项验收收口（debug / db / ui / run）；③ 季度评审；④ 任何专项 `*_dev_plan.md` 状态从"未开工"转"已交付"。**重取一律走 `tools/stats/repo-stats.mjs`，不要手敲命令。**

---

## 附：本报告引用的关键文档

| 文档 | 用途 |
|---|---|
| **`docs/delivery-overview.md`** | **交付总览（新会话入口，2026-10-03 建）**：20 个功能域 × 交付日期 × 计划真源 × 验收记录 × 状态 + 文档地图 + 已知文档不一致登记 |
| `docs/python_ide_dev_plan_v2.md` §1.1 / §7 | 目标与不做清单（pytest / AI 裁决来源）· Phase 4 状态表（**待回填**） |
| `docs/ui_premium_dev_plan.md` | **UI 视觉六批执行真源**（v1.0，六批已落地，§6 批次入口 / §7 实施记录 / §8 方案偏差登记） |
| `docs/ui_premium_design_report.md` v1.2 | 视觉方案论证过程（**方向已批准**；README 索引与 `ui_premium_dev_plan.md:3` 状态戳本轮已同步为"六批已落地"） |
| `docs/adr/0005-brand-accent-unification.md` | 品牌/交互色统一到青绿单色相轴（已定案 2026-10-03） |
| `docs/adr/0006-dual-static-engine-switchable.md` | 双静态引擎并存 + 首日引擎无关抽象层（补记，决策自 2026-08-20 生效） |
| `docs/adr/0007-intel-as-independent-lsp.md` | 运行时智能独立成 LSP、不修改 Pyrefly 内核（补记） |
| `docs/adr/0008-pep669-sys-monitoring-sampling.md` | PEP 669 `sys.monitoring` 采样选型（补记） |
| `docs/adr/0009-lsp-result-merge-sorttext.md` | 补全合并策略：固定段位 + `⟳ runtime` 标注 + 运行时优先（补记，段位表述真源） |
| `docs/sqlite_tool_dev_plan.md` v1.5 | B3 唯一真源（§17 交互方案 / §9 逐 PR 实施记录 / §10.3 v1.0 侧栏态真机 13/13 / §17.7 v1.4 真机待办） |
| `bench/reports/gate-d-runtime-completion.md` | Gate D 确定性口径 base 数值（23/23）与两格 PENDING 的定义 |
| `docs/tech-debt.md` | P1-5 债务明细（待处理仅 TD-021 五小项） |
| `docs/e2e_divergence_ledger.md` | P0-1 的论据（真机才暴露的缺陷） |
| `docs/onboarding_dev_plan.md` / `docs/onboarding_guide.md` | P0-3 方案来源与**双源冲突实例** |
| `docs/dx_features_backlog.md` | 已完成清单，避免重复立项 |
| `docs/git_improvement_report.md` | 迭代 0–6 交付事实 |
| `docs/pycharm_ux_review_and_proposal.md:393` | B1 的现行裁决（F-1 维持非目标，2026-09-25） |
| `docs/python_library_support_research.md` §8 | B1 复议时的边界依据（不做测试发现/结果树） |
| `docs/plugin_system_design.md` §10 | P1-6 / D 类的待决策点 |
| `intel/README.md:47` | P0-2 的挂起项（P3-T10） |
| `docs/debug_acceptance_record.md` §五 / `docs/run_acceptance_record.md` §四 | P0-3 的人工验收清单 |
| `.github/workflows/ci.yml` | P0-1 子项 1 的证据（`on.push.branches: [main]` vs 主干 `master`） |
