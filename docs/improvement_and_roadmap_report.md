# OpenCharm 现状评估 · 改进建议与未来功能规划

> 版本：**v1.1** · 日期：2026-10-03 · 状态：**待评审**
> 性质：基于当前代码库与全部 `docs/` 文档的**现状评估 + 改进清单 + 未来功能候选池**，不是开发计划（不直接排期）。
> 与既有文档的关系：本文件是**全局视角的评估与选题**，落地时仍需回到各专项计划（`python_ide_dev_plan_v2.md` / 各 `*_dev_plan.md`）写 PR 级方案。冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
> **取数时点**：2026-10-03，git HEAD `964ea7e`（`master`，工作区 clean）。所有数字均为该时点仓库实测，取数命令见 §9。**引用本文数字前必须先核对 HEAD**——v1.0（基线 `44c85ea`）发布后 20 个提交内，UI 视觉六批、SQLite 工具、Python 语法修复等已交付，v1.0 的 §0 缺口 3 与 P0-3 整条因此失效。
>
> **v1.1 修订（相对 v1.0）**：① §0 缺口 3 与 P0-3 重写（视觉六批已交付，身份问题从 P0 降为 P2 可选）；② 全文数字刷新至 `964ea7e`；③ P0 重排（质量门禁提为 P0-1，新增「CI 主干分支错配」子项）；④ Gate D 表述纠偏（确定性口径已 PASS，只剩两格 PENDING）；⑤ B3 改为已交付退出候选池；⑥ B1 / C 类补「与 `dev_plan_v2` §1.1 裁决冲突」标注；⑦ 补三条治理项（ADR 欠账 / onboarding 双源冲突 / 状态戳滞后）；⑧ §5 阶段一收敛到 2 条泳道（消除与「只开 2~3 条」的自相矛盾）；⑨ 新增 §9 取数方法与复核触发条件。
> **v1.1 落地续记（同日）**：评审后立即执行了 P0-1 子项 1 与 P0-4 的文档部分——① `ci.yml` 的 `on.push.branches` 由 `[main]` 对齐为 `[master, main]`（主干零触发已修，前端门禁 92 文件 / 1070 用例全绿验证无副作用）；② 新建 `docs/delivery-overview.md`（20 功能域总表 + 文档地图 + 不一致登记 + 门禁命令 + 上手路径）；③ README 索引补齐 12 篇并修正 4 处状态戳（含 `python_ide_dev_plan_v2.md` §7 回填）；④ 补记 ADR-0006~0009，清空「待记录（候选）」；⑤ **产品负责人裁定「多窗口 / 新手引导已完成交付」后，完成最后 3 条文档回填**——`multi_window_dev_plan.md` v0.2（阶段 0/1/2 全交付 + 16/16 真机 + DoD 对账）、`onboarding_dev_plan.md` v1.3（S1/S2/S4 已交付 + e2e OG-1..OG-9）、`onboarding_guide.md` 补 v1.0 版本头。**`delivery-overview.md` §4 的 9 条文档不一致已全部关闭。** **唯一改动代码的产物是 `ci.yml` 那一行。**

---

## 0. 一页结论

**OpenCharm 已经从"做一个 IDE"走到了"做一个什么样的 IDE"，而"什么样"这一问在 2026-10-03 有了答案。**

功能广度上，它已经超过了绝大多数自用项目的合理预期：编辑增强、Git（六迭代）、调试（DAP/debugpy）、运行（PTY + 多实例）、终端、依赖健康、库特别支持、SQLite 工具、插件切片、国际化、UI 视觉身份，全部有验收记录与 E2E 兜底。工程底座（192 个 Tauri 命令、1070 个前端用例、333 个 Rust 测试、版本锁定 + CI）在单人项目里属于头部水平。**UI 视觉六批（ADR-0005 单色相轴 → 五档表面阶梯 → 随包等宽字体 → Monaco 自定义主题 → 边框/曲线/圆角/材质）已全部落地并通过真机验收，"像没贴牌的 VS Code"这个诊断在批 4 之后已不成立。**

正因为"广"和"身份"都已到位，继续往清单里加功能的边际收益正在快速衰减，而两条更根本的缺口仍未闭合：

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| 1 | **门禁只覆盖了一半**：主干触发已修，但真机层仍是手动 | ✅ 已修：`ci.yml` 的 `on.push.branches` 原为 `[main]` 而主干是 `master`（`origin/HEAD → origin/master`）→ 推送主干零触发，2026-10-03 已对齐为 `[master, main]`。**仍缺**：`shell/e2e-real/` 9 个真机脚本不进 CI · `package-smoke` 仅 `workflow_dispatch` · 无 `schedule` nightly · 性能红线（冷启动 1.5s / 内存 600MB）无定期回归 | 分歧台账 D-001/D-005/D-007 的根因（LSP cwd 缺失、uv 兜底不支持调试、watcher 就绪时序）都是**真机才暴露**的集成缺陷；mock 层保不住真机，没自动化就靠人记得跑 |
| 2 | **差异化核心缺最后一格证据** | Gate D 确定性口径**已 PASS**（`bench/reports/gate-d-runtime-completion.md`：23/23 = 100%，红线 ≥85%），剩两格 PENDING：「≥ PyCharm 同场景人工横向」+「真实项目 trace 端到端」（`intel/README.md:47` P3-T10）；trace 新鲜度降权参数仍是"拍脑袋值"（`dev_plan_v2` §7 ⚠️） | 项目立身之本（运行时智能）目前只有"能用"的证据，没有"更好"的横向证据与数据驱动的降权参数；探针数据陈旧时体验会静默退化 |

据此，本报告的建议优先级排序是：**先把门禁补完整（P0-1，主干触发已修，余 nightly + 真机入 CI）→ 再兑现差异化证据（P0-2）→ 收口验收（P0-3）→ 最后才谈新功能（P1/P2 及以后）**。

> 一句话给未来半年：**少做功能，多做证据；少堆清单，多守门禁。**

---

## 1. 现状盘点

### 1.1 工程规模（实测，HEAD `964ea7e`）

| 层 | 文件数 | 行数 | 备注 |
|---|---|---|---|
| 前端源码（`shell/src/**/*.ts`，不含测试） | 218 | **53,950** | 其中顶层 `src/*.ts` 106 个 / 34,386 行 |
| 前端样式（`shell/src/style.css`） | 1 | **5,410** | token 化彻底（`font-size` 全走变量）；**注意：这是唯一逆势增长的文件，见 §1.2** |
| Rust 外壳（`shell/src-tauri/src/*.rs`） | 28 | **18,647** | **192 个 `#[tauri::command]`** |
| Rust 运行时智能（`intel/**/*.rs`，独立 workspace） | 13 | **3,481** | 44 个 `#[test]` |
| Python 探针（`probe/src/**/*.py`） | 10 | **1,403** | 零第三方依赖，81 个 pytest |
| 文档（`docs/*.md` + `adr/`） | 38 + 4 | — | README 索引收录 26 篇 |

**合计约 83K 行自研代码**（不含 `node_modules` / 打包产物）。对一个单人项目而言，这已经是**需要认真对待维护成本**的量级——这一点直接影响第 6 章的选题判断。

### 1.2 规模分布的三个结构性信号

| 信号 | 数据（HEAD `964ea7e`） | 含义 |
|---|---|---|
| **巨型文件（趋势已逆转）** | `git.ts` 3,019 · `main.ts` 2,503 · `lsp/client.ts` 1,653 · `env_cmds.rs` 4,484 · `fs_cmds.rs` 3,558 · `git_cmds.rs` 1,720 | 对比 v1.0 基线：`main.ts` 2,839→**2,503**、`git.ts` 3,204→**3,019**、`client.ts` 1,774→**1,653**、`fs_cmds.rs` 3,882→**3,558**。**UI 视觉六批顺带把逻辑拆去了域模块，"功能增长又把 `main.ts` 顶回去"这个 v1.0 判断已不成立**；剩余待拆的是 `env_cmds.rs`（4,484 行） |
| **样式单点逆势增长** | `style.css` 5,050→**5,410**（+360） | 视觉六批全部落在这里。它已是事实上的设计系统，且**已出现无门槛增长**——建议设体积阈值（见 P1-3） |
| **命令面膨胀** | 192 个 Tauri 命令；`git_cmds` 47 + `env_cmds` 32 + `fs_cmds` 28 = 107，占 **56%** | 单一进程承载过多职责。插件化（轨 B / OEP）未启动前，Rust 侧会继续膨胀；`env_cmds.rs` 拆分（P0-4）应与该数字挂钩 |

> 口径修正：v1.0 写「TD-007/TD-014 把 `main.ts` 从 3,169 降到 1,620」，`docs/tech-debt.md:57` 原文是 **~3,119 → ~1,196**（TD-014 另有后续轮次到 1,620）。引用时请回 `tech-debt.md` 原文，勿二次转述。

### 1.3 能力地图（已交付）

| 域 | 关键模块 | 状态 |
|---|---|---|
| 编辑器 | `main.ts` / `monaco.ts` / `splitEditor.ts` / `editorFind.ts` / `breadcrumbs.ts` / `bookmarks.ts` / `codeVision.ts` / `inlineValues.ts` | ✅ 多标签、分屏、面包屑、书签、引用计数、行内值 |
| 补全体系 | `lsp/client.ts`（1,653）+ `importAlias.ts` + `autoImport.ts` + `live-templates/` + `postfix.ts` + `completion/keywordCompletion.ts` + intel | ✅ **六段 sortText 契约**：`0NN` 模板/postfix < `0y` autoImport < `0z` importAlias < `1xx` intel 运行时 < `2xx` 静态引擎 < `3xx` 关键字兜底（python 除外） |
| 智能模板 | `live-templates/`（builtin / ui / manager） | ✅ 容器 × 位置 × 词法三维上下文（相位 A/B 已交付） |
| Python 语义 | `pydanticDiagnostics.ts` / `pydanticField.ts` / `ruffLint.ts` / `ruffHints.ts` / `format.ts` / `frameworks.ts` / `endpointView.ts` / `stdlib.ts` | ✅ 四桶诊断 + 自研 Pydantic 构造校验与改名传播 |
| 库特别支持 | `libRegex.ts` / `libFormat.ts` / `libJson.ts` / `libEval.ts` / `libInject.ts` / `dslLens.ts` | ✅ P0 四件套 + P1 五件套（re 三件套 / 格式串 / JSON / 求值桥 / 脚本参数表单） |
| 运行 | `runFlow.ts` / `runState.ts` / `runWidget.ts` / `runHistory.ts` / `runConfigPanel.ts` + Rust `run_env.rs` | ✅ M1–M4 全交付；探针开销实测 1.35x < 1.5x 红线 |
| 调试 | `debugView.ts` / `debugGutter.ts` / `debugConsole.ts` / `debugWatches.ts` / `dap/` + Rust `dap.rs` | ✅ D1–D5 / Gate E；条件/日志断点齐全；**8 项人工验收清单待办**（P0-3） |
| Git | `git.ts`（3,019）+ `gitGutter.ts` / `gitMerge.ts` / `gitStatusState.ts` / `cloneRepository.ts` + Rust `git_cmds.rs`（47 命令） | ✅ 迭代 0–6 全交付；仅 shelf/changelist 与完整凭据 UI 暂缓 |
| 终端 | `terminal.ts` / `termUi.ts` + Rust `terminal.rs`（portable-pty） | ✅ 多会话 |
| 依赖健康 | `depHealth.ts` / `depHealthPanel.ts` / `envPanel.ts` / `toolchain.ts` | ✅ 扫描 + 修复 + 忽略清单 |
| 数据库 | `sqliteView.ts` / `sqliteTabs.ts` / `sqliteSql.ts` / `sqliteStore.ts` + Rust `db_cmds.rs` / `db_rows` | ✅ **B3 已交付 v1.4**（编辑器 Tab 化重设计，门禁全绿：tsc 0 / vitest 994 / e2e db 30/30 / cargo 286）；⏳ v1.4 真机手测待做（§10.3 的 13/13 是 v1.0 侧栏态验收）；真源 `docs/sqlite_tool_dev_plan.md` §17 |
| 插件 | `devtools/` + `extensions/` + Rust `plugin_cmds.rs` / `plugin_pkg.rs` | ✅ 工具切片 PR-1~4（490 测试）；v1 信任模型 = 同源 + facade；**v2 议题未启动** |
| 国际化 | `i18n/` | ✅ zh-CN / en-US 双语，20 批抽取，编译期对齐 |
| UI 视觉身份 | `theme/tokens.ts` + `style.css` + `tools/ui/audit_tokens.py` + `docs/adr/0005` | ✅ **六批全部落地**（批 1 / 2a / 2b / 3 / 4 / 5a / 5b / 5c）；Monaco 自定义主题 `opencharm-dark/light` + JetBrains Mono 随包；audit 98 项 0 FAIL 0 WARN；真机主题验收 32/32 PASS |
| 运行时智能 | `probe/` + `intel/` | ✅ P3-T01~T09 交付；**P3-T10 人工横向对标挂起**（P0-2） |
| 多窗口 | Rust `per_window.rs` / `window_mgr.rs` | ✅ 阶段 0/1/2 全部交付（`multi_window_dev_plan.md` v0.2；真机 `multi-window-real.cjs` 16/16 PASS）；#4~#6 依赖健康缓存经拍板暂缓 |

### 1.4 质量底座

| 项 | 现状（HEAD `964ea7e`） | 评价 |
|---|---|---|
| 前端单测 | 92 个 `*.test.ts`；最近门禁基线 **1070 用例全绿**（`ui_premium_dev_plan.md` §1） | 强 |
| Rust 单测 | `src-tauri` **289** 个 `#[test]` + intel 44 | 强 |
| Python 单测 | probe **81** 个 pytest | 强 |
| E2E（mock 层） | `shell/e2e/` **65 个 spec**（9,215 行），分 15 个功能域目录（`http/` 目前为空占位，B4 未开工） | 强 |
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

### P0-1 · 质量门禁闭环：主干触发已修，余 nightly + 真机入 CI

- **子项 1（✅ 已修 2026-10-03）**：`ci.yml` 的 `on.push.branches` 原为 `[main]`，而本仓主干是 `master`（`origin/HEAD → origin/master`）——**推送到主干不触发任何 CI**，`test` job 只在 PR 与手动 dispatch 跑。已对齐为 `[master, main]` 并在文件头注明来由（保留 `main` 以防分支改名）。**这是全文投入产出比最高的一条：1 行，零逻辑风险。**
- **问题（子项 2，仍未做）**：9 个真机脚本全靠手跑；`package-smoke` 手动 dispatch；无 `schedule`；性能红线无定期验证。分歧台账 D-001/D-005/D-007 的根因（LSP cwd 缺失、uv 兜底不支持调试、watcher 就绪时序）都是**真机才暴露**的集成缺陷。
- **建议动作**：
  1. ~~`ci.yml` 的 push 分支改为 `master`~~ ✅ 已完成；
  2. 新增 `nightly`（`schedule` 触发）：跑 `e2e-real/` 全量 + `bench/collect-metrics.ps1` 红线断言；失败只告警（自用项目告警足够）。**建议同时新增 workflow 文件而非塞进 `ci.yml`**，避免真机长跑阻塞 PR 门禁；
  3. 为 `real-env.cjs` 补 `--json` 汇总输出，便于 CI 断言与历史对比；
  4. `package-smoke` 从"仅手动"升级为"打 tag 时自动跑"；
  5. **不要**把 e2e-real 放进每次提交的门禁（真机慢且不稳），保持"高频 mock + 低频真机"双层策略（台账已有此约定）。
- **成本**：余约 2 人日（子项 1 已完成）。
- **验收**：master push 自动触发 `test`（✅ 已有配置，**待推送后确认首次触发**）；nightly 能跑出真机汇总；一次 tag 打包自动触发 smoke。

### P0-2 · 兑现差异化核心：补齐 Gate D 的两格 PENDING + trace 新鲜度调参

- **问题（纠偏 v1.1）**：v1.0 写"核心指标一直未做"**过重**。实际 `bench/reports/gate-d-runtime-completion.md` 已给出确定性口径 base 数值：**23/23 = 100%**，≥85% 红线 **PASS**，覆盖无注解代码四类形态（dict 字段 / 自定义实例属性 / 商品字典 / 列表元素），判定口径为"期望 label 出现在 top-5"。**真正缺的只有两格**：
  1. **≥ PyCharm 同场景人工横向**（`intel/README.md:47` P3-T10 至今挂起；PyCharm 无 CLI 导出补全准确率，只能人工复核）；
  2. **真实项目端到端数据**（当前评测是 deterministic seed，需 probe 采集真实项目 trace 后复核）。
  另：`dev_plan_v2` §7「基于真实使用数据调整降权/清理策略」仍 ⚠️ 未做，intel 降权系数与 `probe clean` 保留窗口是"拍脑袋值"。
- **为什么是 P0**：这是项目**唯一不可被 VS Code + Copilot 复制的能力**，也是 `probe`/`intel` 两个独立包存在的唯一理由。
- **建议动作**（成本比 v1.0 估的低，因为载体已存在）：
  1. **复用现成载体**：`bench/sample/unannotated_scraper/` + 现有 23 个评测点 + top-5 判定口径已经写好在 `gate-d-runtime-completion.md`，只需在 PyCharm 中打开同一样例逐点人工复核，产出 `bench/reports/gate-d-ab.md`（**不必另立协议**）；
  2. 在**一个真实项目**上跑 probe 采集，复核端到端口径（这一步同时为第 3 项供数）；
  3. 基于真实 trace 库反推降权参数：统计 `stale` 占比、`hits` 长尾分布、trace 库体积增长曲线，把 intel 降权系数与保留窗口改成"有据值"；
  4. 结论回写 `intel/README.md` 与 `dev_plan_v2` §7，把 ⚠️/PENDING 改成 ✅ 或明确记 ❌。
- **成本**：约 **1.5~3 人日**（v1.0 估 3~5 人日，因对标载体已存在而下调）。
- **验收**：`gate-d-ab.md` + 降权参数有据 + 三处文档状态一致。

### P0-3 · 收口人工验收清单 + 修 onboarding 双源冲突

- **问题 A（验收尾账）**：调试 8 项人工清单（断点串位、三态互斥、进程树残留、改键生效、**真安装包验收**）与运行 M2 遗留项自 D5 验收后一直挂着；`README.md:113` 也写明"部分 UI 交互项待人工抽查"。多数项已由 e2e 覆盖，真正剩「进程树人工抽查」+「真安装包验收」两项，后者需出包（小时级）。
- **问题 B（onboarding 双源）**：✅ **已消解**（2026-10-03，`onboarding_dev_plan.md` v1.3）——PR-S1/S2/S4 早已交付（`welcomeGuide.ts` 三步卡 + 功能巡礼 + force-show + 指南三入口，e2e OG-1..OG-9），计划状态回填完毕。**剩余可选缺口**：PR-S2 的欢迎页巡礼条目策展扩充、PR-S4 的两处小修是否补做——按需，不影响交付完整性。
- **建议动作**：
  1. 用一次真机会话（真机 CDP 基建已存在：`shell/e2e-real/run-*.bat` + `lib/real-env.cjs`）把调试剩余 2 项 + 运行 2 项跑完，回写验收记录（半天）；
  2. ~~裁定 onboarding 状态~~ ✅ 已完成；
  3. PR-S3（pip→uv hint）、PR-S5（键盘提示）保持未开工/不排期（§7 已登记为推迟档）。
- **成本**：A 约 0.5 人日；B 约 3~4 人日（若只做状态裁定 + PR-S4，约 1 人日）。
- **判断依据**：在"再加 10 个功能"和"让已有 100 个功能被找到"之间，后者边际收益明显更高——尤其对单人自用场景，用户就是产品负责人本人。

### P0-4 · 偿还结构性债（拆分 + 交付总览）

- **问题**：`env_cmds.rs` 4,484 行（Rust 侧最大单文件，32 个命令）；`git.ts` 3,019 / `main.ts` 2,503（趋势已逆转，优先级可降）；`dev_plan_v2` §7 与 README 索引滞后于现实。
- **建议动作**：
  1. `env_cmds.rs` 按职责切三块（解释器管理 / 包操作 / 版本探测），Rust 侧测试已按文件聚合，拆分后测试随迁；
  2. `main.ts` **不再安排整轮拆分**（六批 UI 已顺带降到 2,503），仅在新功能落地时顺带外提；`git.ts` 保持观察；
  3. ~~建 `docs/delivery-overview.md`（交付总览）~~ ✅ **已交付**（2026-10-03，见 §1.5 末条与该文档本身）；README 索引 ✅ **已补齐 39 篇**。**剩余动作**：`python_ide_dev_plan_v2.md` §7 状态表 ✅ **已回填**（进度戳 2026-10-03 + 13 行功能域）；仍待收口的是 `onboarding_dev_plan.md` 与 `multi_window_dev_plan.md` 两条状态裁定。
- **成本**：约 2~3 人日（比 v1.0 的 3~5 人日下调，因 `main.ts` 目标已由 UI 批顺带达成大半）。
- **验收**：`env_cmds.rs` < 2,500 行且 cargo test 全绿；README 索引覆盖全部 `docs/*.md`；`delivery-overview.md` 与实际情况一致。

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

### P1-3 · 性能与体积预算制度化

- 现状：冷启动 <1.5s / 内存 ≤600MB 只在手动 smoke 时验证；`style.css` 已逆势增长到 5,410 行且无任何门槛。
- 建议：① CI 增加 bundle 体积、`style.css` 行数与首屏资源数的阈值断言（**给唯一逆势增长的文件装个刹车**）；② `bench/collect-metrics.ps1` 的红线断言纳入 nightly（与 P0-1 共用）。
- 成本：约 1 人日（搭在 P0-1 上边际成本很低）。

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
| P0-1 CI 主干触发 + nightly + bench 入 CI | ★★★★★ | 极小 / 中 | — | ★★★★★ |
| P0-2 Gate D 两格 PENDING + trace 调参 | ★★★★★ | 中（载体已存在） | 人工操作 | ★★★★★ |
| P0-3 验收尾账 + onboarding 双源裁定 | ★★★★ | 中小 | — | ★★★★☆ |
| P0-4 `env_cmds.rs` 拆分 + 交付总览文档 | ★★★★ | 中 | — | ★★★★☆ |
| A1 运行时热点 / 死代码视图 | ★★★★ | 中 | intel 索引（先核 inlineValues 重叠） | ★★★★☆ |
| A3 trace 驱动签名提示 | ★★★ | 小 | arg_types | ★★★★ |
| P1-1 可观测性三件套 | ★★★ | 中 | — | ★★★ |
| B2 REPL / Scratch | ★★★ | 小 | 求值桥 | ★★★ |
| A5 FastAPI 面板增强 | ★★★ | 中 | endpointView | ★★★ |
| P1-2 自动更新 | ★★★ | 小 | — | ★★★ |
| P1-3 体积/性能预算断言 | ★★★ | 极小 | 搭 P0-1 | ★★★ |
| A4 爬虫工具箱 | ★★★★（画像匹配） | 中 | 求值桥 | ★★★ |
| P1-5 TD-021 五小项 | ★★ | 小 | — | ★★ |
| A2 内置 Profiler | ★★★★ | 大 | 开销预算重定 | ★★（排后） |
| C 类 AI 三项 | ★★（**与 §1.1 冲突**） | 小-中 | 修订定位裁决 | ★（待裁决） |
| B1 pytest 集成 | ★★★（**与 §1.1 冲突**） | 中 | 修订 F-1 裁决 | ★（待裁决） |
| A6 trace 驱动 lint | ★★★ | 大 | 误报控制 | ★（排后） |
| P2-1 UI 批 6+ 第二阶段 | ★★（可选） | 中 | 视觉六批已交付为前提 | ★（不排期） |
| D 类生态长线 | — | 大 | — | 不排期 |
| ~~B3 SQLite 工具~~ | — | — | — | ✅ **已交付 v1.4** |

---

## 5. 路线图建议

> 按**主题泳道**而非时间盒排列；每阶段**只开 2 条泳道**（单人维护 83K 行的现实约束）。v1.0 阶段一铺了 4 条，与"只开 2~3 条"自相矛盾，v1.1 已收敛。

### 阶段一 · 收口期（约 3~5 周，2 条泳道）

| 泳道 | 内容 |
|---|---|
| 门禁 | P0-1 全部（① `ci.yml` push 分支对齐 `master` ② nightly ③ `--json` 汇总 ④ tag 触发 smoke）+ P1-3 体积断言 |
| 差异化 | P0-2 全部（Gate D 横向对标 + 真实项目端到端 + 降权参数有据） |

**阶段门**：master push 自动跑 `test`；nightly 出真机汇总；Gate D 两格 PENDING 收敛为 ✅ 或明确 ❌ + 后续动作。

### 阶段二 · 深化期（约 6~10 周，2 条泳道）

| 泳道 | 内容 |
|---|---|
| 差异化 | A1 运行时热点 + A3 签名提示（共用 intel 数据层） |
| 基本功 | P0-3 验收尾账 + onboarding 剩余 PR-S2/S4 + P0-4 `env_cmds.rs` 拆分与交付总览文档 |

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

`dev_plan_v2` §9 风险登记册已列「自用项目长期维护负担 — 自研组件全部独立成包/进程」。83K 行代码 + 38 篇文档 + 192 个命令的现实下，这条风险的量级已经变了。补充三条具体对策（每条都对应上文一个可执行项）：

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

- probe/intel 的**实际运行数据**（trace 库体积、`hits` 分布、`stale` 占比）——需真实使用后才能给调参建议，P0-2 执行一次后回填；
- `shell/e2e-real/` 各脚本的**当前通过状态**（需手跑一次确认；`db-real` / `ui-real` 有近期 PASS 记录，其余需重跑）；
- **SQLite v1.4（编辑器 Tab 化）的真机手测**——`sqlite_tool_dev_plan.md` §17.7 两项待做：① 新链路真机（双击开表 / 排序三态 / 筛选 / 导出 / 多 Tab 独立）② 深浅双主题截图存档。⚠️ 注意 `e2e-real/db-real.cjs` 现为 **v1.0 侧栏态 S10.x 用例**，不含 Tab 链路覆盖，**不能拿它的 13/13 PASS 充当 v1.4 的真机验收**；
- 多窗口阶段 1/2 的真实完成度（文档与代码不一致，需复核）；
- 打包产物的实际体积与冷启动/内存的**最新实测值**（`bench/reports/` 有 `engine-perf-comparison.md` 等 13 份，但无近期冷启动/内存红线报告）。

---

## 9. 取数方法与复核触发条件（v1.1 新增）

本报告是**快照文档**，v1.0 基线 `44c85ea` 在 20 个提交内即出现 3 处失效结论（§0 缺口 3 / P0-3 / B3）。为避免复现，约定：

| 动作 | 命令 |
|---|---|
| 确认取数时点 | `git rev-parse --short HEAD`（本文数字对应 `964ea7e`） |
| 前端规模 | `Get-ChildItem -Recurse shell\src -Filter *.ts` 排除 `__tests__` 后按 `(Get-Content f).Count` 累加（**勿用 `Measure-Object -Line`，它不计空行**） |
| 命令面 | `Select-String -Path shell\src-tauri\src\*.rs -Pattern '#\[tauri::command\]' -AllMatches` |
| Rust 测试数 | 同上，pattern `#\[test\]` |
| probe 用例数 | `Select-String -Path probe\**\*.py -Pattern '^def test_'` |
| e2e spec / 真机脚本 | `dir /b /s shell\e2e\*.spec.ts`、`dir /b shell\e2e-real\*.cjs` |
| 文档数 / ADR 数 | `dir /b docs\*.md`、`dir /b docs\adr\*.md` |
| 门禁 | `shell\scripts\gate-tests.mjs unit\|e2e\|e2e-ui`（**不要直接跑 `vitest`**，本机会被判为 watch 并杀进程） |
| token 门禁 | `tools\ui\audit_tokens.py`（98 项检查，退出码非 0 即失败） |
| 真机层 | `shell\e2e-real\run-*.bat`（CDP 9223 + 隔离数据根） |

**复核触发条件**（满足任一即需重取数字并更新本文头部「取数时点」）：① HEAD 变动 ≥ 10 个提交；② 任一专项验收收口（debug / db / ui / run）；③ 季度评审；④ 任何专项 `*_dev_plan.md` 状态从"未开工"转"已交付"。

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
