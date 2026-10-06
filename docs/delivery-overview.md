# OpenCharm 交付总览（Delivery Overview）

> 版本：**v1.1** · 日期：2026-10-06 · 状态：**现行** · 取数时点：git HEAD `f33e5be`（`master`）
> **v1.1 修订（2026-10-06）**：① §2 补录 **B4 HTTP 请求工具**与 **B5 结构化运行日志**两个 v1.0 之后交付的功能域（原只在 §3.5 提了一句）；② §1 用例基线 1070 → **1215 / 98 文件**（滞后两版，随 `improvement_and_roadmap_report.md` §1.5 第 ② 条一并修）；③ §4 新登记 4 条不一致（产物体积基线 4,918 → 4,989 KB · 用例基线 · B4/B5 未收录 · **CI 宿主错配**）并标注处置状态；④ §5 补体积/规模预算门禁命令。
> **这份文档的定位**：新会话 / 新人 / 任何接手者的**唯一入口**。回答两个问题：①项目做到哪一步了？②要改某个功能域，该读哪份文档？
> 冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
> **30 秒读法**：直接看 §2 表的状态列 → 改哪块就跳 §3 找真源 → 交付数字别信文档、跑 §5 的脚本。

---

## 1. 一页速览

| 项 | 现状 |
|---|---|
| 定位 | **高性能 · 轻量 Python IDE**（FastAPI + 爬虫 + 小脚本；2026-10-05 定位变更，ADR-0010；性能与体积为一等目标） |
| 阶段 | **Phase 4 · 打磨期**（Phase 1/2/3 均已交付：外壳 / 语义引擎 / 运行时智能） |
| 规模 | 约 93.8K 行自研代码 · **194** 个 Tauri 命令 · 39 篇 `docs/*.md` + 8 篇 ADR |
| 质量底座 | 前端 **1215 用例 / 98 文件** · Rust 351 测试（外壳 306 + intel 45）· probe 81 pytest · e2e 69 spec（mock 层）+ 10 个真机脚本（**手动**） |
| 预算 / 性能 | **`ci/budgets.toml` 十七项全 PASS**（`style.css` 5,748/5,850 · `main.ts` **2,094/2,400**（阶段二两刀共 −825 行）· 五个外提新文件各带上限 · 产物 4,990/5,120 KB · 命令 194/200）；性能基线已落盘 `bench/reports/metrics-20261006-091652.md`（冷启动 956 ms · 内存 339 MB） |
| 版本锁定 | `ci/versions.toml` 锁 9 类依赖 |
| 尚未闭环 | ① **CI 无宿主（已裁决维持现状）**：远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions → 两份 workflow 是「将来推 GitHub 的预埋」，**首次跑通证据外置到迁移时验**（§4 第 13 条）② **Gate D 第一格 ⛔ 外部阻塞**：PyCharm 人工对标 23 点——**本机已无 PyCharm（2026-10-06 确认）**，死线 v1.4，届时未做则撤下并在 README 声明"未做横向对比"（**在此之前对外不得写"比 PyCharm 更准"**）；第二格 ✅ 已取得真实项目样本 277 条 / 覆盖率 79% ③ **SQLite v1.4 Tab 化真机手测 + 双主题截图**（§17.7）④ 依赖升级回归无自动化 ⑤ 真机 e2e 不进自动调度（10 个脚本手动，`nightly.yml` 已编排但同 ① 无宿主） |
| 下一步 | 见 `docs/improvement_and_roadmap_report.md` **v1.3**（P0-0 / P0-3 已关闭 · P0-1 已裁决为"维持现状" · P0-4 已裁决为冻结线 · **P0-2 第一格外部阻塞 / 第二格已采**）→ **阶段一收口，阶段二进行中（`main.ts` 外提两刀已完成）**：基本功泳道 `main.ts` 外提（余量 81 行）；差异化泳道 A1/A3 待 trace 累计到跨项目 ≥1000 条 |

---

## 2. 交付总览表

> 「交付日期」取该功能域**最后一批提交入库**的日期；无提交记录的取文档落款日期。

| # | 功能域 | 交付日期 | 计划 / 方案文档（真源） | 验收记录 | 状态 |
|---|---|---|---|---|---|
| 1 | 外壳与编辑器基础（多标签 / 分屏 / 面包屑 / 书签 / 引用计数 / 行内值） | 2026-08-20 起 | `python_ide_tech_plan_v3.md` · `python_ide_dev_plan_v2.md` | — | ✅ |
| 2 | UI 缺陷与设计系统一致性（UI-01~30） | 2026-09-11 | `ui_design_improvement_plan.md` v2.1（30/30） | 同文档 §7 | ✅ |
| 3 | **UI 视觉身份六批**（单色相轴 / 表面阶梯 / 字体 / Monaco 主题 / 材质） | **2026-10-03** | `ui_premium_dev_plan.md` v1.0（执行真源）· `ui_premium_design_report.md` v1.2（论证）· ADR-0005 | 真机 CDP 主题验收 32/32（`ae62b73`）· `tools/ui/audit_tokens.py` 98 项 | ✅ 六批全落地 |
| 4 | 菜单栏 | 2026-09-21 | `menubar_improvement_plan.md` v1.4 | 同文档 | ✅ 6/16 |
| 5 | 国际化（zh-CN / en-US） | 2026-10-01 | `i18n.md` | 编译期词条对齐单测 | ✅ 20 批抽取 |
| 6 | 依赖健康（扫描 / 修复 / 忽略清单） | 2026-09-16 | `dep_health_dev_plan.md` v1.7（M1–M4） | 同文档（M1–M4 验收数据） | ✅ |
| 7 | 库特别支持（re 三件套 / 格式串 / JSON / 求值桥 / 参数表单） | 2026-09-28 | `python_library_support_dev_plan.md` v1.3 | — | ✅ P0 四件套 + P1 五件套 |
| 8 | Pydantic 支持与改名传播 | 2026-09-28 | `pyrefly_pydantic_support_plan.md` v0.2 | — | ✅ |
| 9 | DX 顺手功能储备 | 2026-09-27 | `dx_features_backlog.md` | 同文档 §6.8 进度快照 | ✅ 全部收官 |
| 10 | Markdown 预览 | 2026-09 | `markdown_preview_dev_plan.md` v1.0 | — | ✅ |
| 11 | 运行（M1–M4：脚本 / 项目 / 统一 PTY / 多实例 / 历史） | 2026-09-15 | `python_run_dev_plan.md` v3.4（交互真源）· `python_run_migration_plan.md` v1.0 | `run_acceptance_record.md` | ✅（2 项人工遗留） |
| 12 | 调试（D1–D5：断点 / 单步 / 栈 / 变量） | 2026-09-10 | `python_debug_dev_plan.md` v1.3 | `debug_acceptance_record.md`（含 §五 人工清单 8 项） | ✅（8 项人工遗留） |
| 13 | Git（迭代 0–6：远程 / worktree / rebase / cherry-pick / stash / log / blame / **远端克隆**） | 2026-10-01 | `git_improvement_report.md` · `git_clone_dev_plan.md` v1.0 | — | ✅（shelf / changelist 暂缓） |
| 14 | 终端（多会话 PTY，统一运行出口） | 2026-08 起 | `python_run_dev_plan.md`（PTY 单一来源 `terminal.rs`） | `run_acceptance_record.md` | ✅ |
| 15 | **SQLite 数据库工具（B3）** | **2026-10-02** | `sqlite_tool_dev_plan.md` v1.5（**唯一真源**，方案见 §17） | §10.3 v1.0 侧栏态真机 13/13 · §15 复核 · §17.7 v1.4 真机**待做** | ✅ v1.4 编辑器 Tab 化（门禁全绿）· ⏳ 真机手测待做 |
| 16 | 插件（devtools 工具切片 PR-1~4） | 2026-09-20 | `plugin_system_design.md` v0.2 §9 · `devtools_plugin_guide.md` v1 | `devtools_plugin_acceptance_record.md`（490 测试） | ✅ v1 信任模型；v2 未启动 |
| 17 | **运行时智能**（PEP 669 采样 + intel LSP） | 2026-09-10（索引整改） | `intel/README.md`（P3-T01~T10）· tech plan v3 第三节 | `bench/reports/gate-d-runtime-completion.md`（23/23 = 100%，**自证口径**）· `bench/reports/trace-stats.md`（真实项目样本 277 条 / 覆盖率 79%） | ⚠️ **P3-T10 人工横向对标 ⛔ 外部阻塞**（本机无 PyCharm；死线 v1.4 → 撤下并改在 README 声明"未做横向对比"） |
| 18 | 数据目录 v2 与系统盘治理 | 2026-08-29 | `data-directory-layout-v2.md` · `disk-space-plan.md` | — | ✅ |
| 19 | 多窗口 | 2026-09-28 实施 / 2026-09-30 入库 | `multi_window_dev_plan.md` **v0.2** | `e2e-real/multi-window-real.cjs` 16/16 PASS | ✅ 阶段 0/1/2 全交付（#4~#6 依赖健康缓存经拍板暂缓） |
| 20 | 新手引导 | 2026-09-30 入库 | `onboarding_dev_plan.md` **v1.3** · `onboarding_guide.md` v1.0 | `e2e/ux/04-onboarding.spec.ts` OG-1..OG-9 | ✅ PR-S1/S2/S4 已交付；S3（可选 P2）未开工 · S5 登记不排期 |
| 21 | **TODO / Markdown 增强（B6）** | 2026-10-05 | `toolbox_dev_plan.md` **v1.5** §7 | TODO 单测 19/19 · `e2e/todo/` 7/7 | ⛔ **部分交付后终止**（2026-10-06）：仅 PR-B6-3 TODO 增强交付并保留；PR-B6-2 大纲 / PR-B6-1 Mermaid 取消 |
| 22 | **HTTP 请求工具（B4）** | **2026-10-05**（`2e5634b`） | `toolbox_dev_plan.md` **v1.5** §5.9–5.11 | 门禁 1145/1145 · `e2e/http/` 12/12 | ✅ devtools **面板驱动**（发送 / 响应 / 变量 / 历史 / curl 导入 / 端点联动）。⚠ 形态与原候选不同：原议的 `.http` 文件语言整块取消 |
| 23 | **结构化运行日志（B5）** | **2026-10-05**（`d497d2f`） | `toolbox_dev_plan.md` **v1.5** §6.10–6.12 | 门禁 1208/1208 · `e2e/logs/` 11/11 | ✅ 底部「运行日志」tab（多播采集 + 级别过滤 + 字段折叠 / 导出 + JSON 展开） |

---

## 3. 文档地图（按角色读，别按文件名顺序读）

### 3.1 现行真源（改架构前必读）

| 文档 | 作用 |
|---|---|
| `python_ide_tech_plan_v3.md` v3.0 | 技术方案：外壳架构 / 内存红线 / Phase 1 范围 / 调试时机 |
| `python_ide_dev_plan_v2.md` v2.0 | 开发计划：Phase 重排 + **§1.1 目标与不做清单**（pytest / AI 等裁决来源）+ §7 状态表（**2026-10-03 已回填**） |
| `docs/adr/` | 架构决策：0003 自研 LSP 桥 · 0004 DAP+debugpy · 0005 品牌/交互色统一 · **0006 双静态引擎 · 0007 intel 独立 LSP · 0008 PEP 669 采样 · 0009 补全合并策略（0006~0009 为 2026-10-03 补记，决策自 2026-08-20~21 生效）** |
| `AGENTS.md` | 跨 agent 规则索引（技术栈铁律 + 三语言规范红线 + 常用命令） |

### 3.2 专项执行真源（改该功能域就读它）

| 功能域 | 文档 |
|---|---|
| 运行 | `python_run_dev_plan.md` v3.4 |
| 调试 | `python_debug_dev_plan.md` v1.3 |
| SQLite 工具 | `sqlite_tool_dev_plan.md` v1.4（**v2.0 宽屏态已被 §17 取代并拆除**） |
| UI 视觉 | `ui_premium_dev_plan.md` v1.0（§6 批次入口 · §7 实施记录 · §8 方案偏差登记） |
| 库支持 | `python_library_support_dev_plan.md` v1.3 |
| Git 克隆 | `git_clone_dev_plan.md` v1.0 |
| 菜单栏 | `menubar_improvement_plan.md` v1.4 |
| 依赖健康 | `dep_health_dev_plan.md` v1.7 |

### 3.3 验收记录（判断"真的做完没有"看这里）

`debug_acceptance_record.md` · `run_acceptance_record.md` · `devtools_plugin_acceptance_record.md` · `bench/reports/`（Gate D / 引擎性能 / 库支持探针 / Pydantic 探针）· `e2e_divergence_ledger.md`（mock ↔ 真机分歧台账）

### 3.4 调研报告（**非排期依据**）

`pycharm_feature_research_report.md` v1.1 · `pycharm_ux_review_and_proposal.md` v1.0（含 F-1 pytest 裁决）· `pycharm_framework_support_report.md` v1.2 · `python_library_support_research.md` v1.5 · `edit_prediction_research_plan.md` v0.1（探索中）· `git_improvement_report.md`

### 3.5 计划（待开工 / 部分开工）

`onboarding_dev_plan.md` v1.3 · `multi_window_dev_plan.md` v0.2 · `toolbox_dev_plan.md` **v1.5**（**已闭环，待整体移出本节**：B3 / B4 / B5 三功能全交付；**B6 已终止**——只保留 PR-B6-3，PR-B6-1/2 取消）

### 3.6 治理与账本

`tech-debt.md`（待处理 4 条：TD-021 五小项 · TD-022 · TD-024 · **TD-025「自用」论据失效复审清单 6 条** + 已归档 20 余条）· `improvement_and_roadmap_report.md` **v1.3**（全局评估 + P0/P1/P2 + 候选池 + 路线图 + §9 取数禁则）· `i18n.md`（新增文案三步流程）

### 3.7 专项说明

`data-directory-layout-v2.md` · `disk-space-plan.md` · `live_templates上下文轴修订稿.md` v1.1 · `markdown_preview_dev_plan.md` v1.0 · `devtools_plugin_guide.md` v1

---

## 4. 已知文档不一致登记

> 维护原则：**发现即登记，登记即修**。本表是"文档债务"的唯一清单，修完更新状态。

| # | 不一致 | 涉及文件 | 状态 |
|---|---|---|---|
| 1 | README 索引缺 12 篇 + `ui_premium_design_report` 仍标「v1.0（待评审）」（实际 v1.2 已批准） | `README.md` | ✅ 2026-10-03 已修（索引现覆盖 39 篇） |
| 2 | 状态戳「批 1 实施中」与正文「六批全部落地」冲突 | `ui_premium_dev_plan.md:3` | ✅ 2026-10-03 已修 |
| 3 | 状态戳「待真机手测」与 §10.3 / §15「真机 13/13 PASS」冲突 | `sqlite_tool_dev_plan.md` | ✅ 2026-10-03 已修（升 v1.5，并**校正归属**：13/13 属 v1.0 侧栏态，v1.4 真机待做） |
| 4 | §7 状态表进度戳停在 2026-08-24，未记录 Git 六迭代 / SQLite / UI 六批 / i18n 等交付 | `python_ide_dev_plan_v2.md:114` | ✅ 2026-10-03 已回填（13 行功能域补齐） |
| 5 | 「待记录（候选）」4 条实为已落地决策（双静态引擎 / intel 独立 LSP / PEP 669 选型 / 补全合并策略） | `docs/adr/README.md` | ✅ 2026-10-03 已补记 ADR-0006~0009 |
| 6 | CI `on.push.branches: [main]` 与主干 `master` 不匹配 → 推送主干零触发（非文档不一致，但属同类"事实与配置脱节"） | `.github/workflows/ci.yml:17` | ✅ 2026-10-03 已对齐为 `[master, main]`（**待推送后确认首次触发**） |
| 7 | `onboarding_guide.md` 已交付 vs 计划「已立项未开工」 | `onboarding_dev_plan.md` | ✅ 2026-10-03 已回填（v1.3：PR-S1/S2/S4 已交付 + e2e OG-1..OG-9） |
| 8 | `per_window.rs` 已落地 vs 计划「阶段 0/1/2 均未开工」 | `multi_window_dev_plan.md` | ✅ 2026-10-03 已回填（v0.2：三阶段全交付 + 真机 16/16 + DoD 对账） |
| 9 | `onboarding_guide.md` 缺版本头（无版本/日期/状态行） | `onboarding_guide.md:1` | ✅ 2026-10-03 已补（v1.0 · 随 PR-S1 交付 · ?raw 打包机制说明） |
| 10 | §2 功能域表**未收录 B4 HTTP 工具与 B5 运行日志**（两者 2026-10-05 已交付，只在 §3.5 文字里提过一句） | `delivery-overview.md` §2 | ✅ 2026-10-06 已补（新增第 22 / 23 行，含交付 commit 与门禁数字） |
| 11 | 用例基线仍写 **1070**（v1.2 数字），实测 **1215 / 98 文件** | `delivery-overview.md` §1 | ✅ 2026-10-06 已修（1214 → 1215 为 D-8 补的单测；`improvement_and_roadmap_report.md` §1.4 仍写 1214，**同批待修**） |
| 12 | 产物体积实测仍写 **4,918 KB**（v1.1 基线），重新构建后为 **4,989 KB**；且该指标受 `dist/` 新鲜度影响 | `ci/budgets.toml:64` · `python_ide_dev_plan_v2.md` §1.2.1 | ✅ 2026-10-06 已修（budgets.toml 注释改 4,989 并加"陈旧 dist 会虚报"提示）· ⏳ `dev_plan_v2` §1.2.1 待同步 |
| 13 | **CI 宿主错配**：远端只有 `gitee.com/usedel/opencharm`，**Gitee 不执行 GitHub Actions** → `.github/workflows/ci.yml` / `nightly.yml` 无论怎么改都不会跑，与「配置已交付」的记账相矛盾 | `.github/workflows/` · `improvement_and_roadmap_report.md` §2 P0-1 子项 7 | ✅ **已裁决（2026-10-06）：维持现状 + 文档标注**——.github/workflows/ 定位为「将来推 GitHub 的预埋」（配置零改动即可生效）。**余项转为外置触发条件：迁移到 GitHub 后首次 push 的 Actions run 记录（谁推谁验）**；在此之前缺口保持开启但不再消耗人力 |

> **2026-10-06 收口**：10~12 三条已关闭；**第 13 条是本表唯一未闭环项，且它决定了 §0 缺口 1 能不能关**。新增不一致请就地登记在此表，**发现即登记，登记即修**。

---

## 5. 门禁与数字复核（**别信文档里的数字，跑脚本**）

| 目的 | 命令 / 位置 |
|---|---|
| 前端单测 | `shell\scripts\gate-tests.mjs unit`（**不要直接跑 `vitest`** —— 本机会被判为 watch 并杀进程） |
| E2E（mock 层） | `shell\scripts\gate-tests.mjs e2e` / `e2e-ui`（9 spec 快档） |
| 真机层 | `shell\e2e-real\run-*.bat`（CDP 9223 + 隔离数据根） |
| UI token 门禁 | `tools\ui\audit_tokens.py`（98 项检查，退出码非 0 即失败） |
| UI 基线截图 | `shell\scripts\ui-baseline.mjs --tag X` → 系统 TEMP |
| Rust | `cd shell\src-tauri && cargo test`（改 `src-tauri` 后必须 `cargo check` 通过再交付） |
| probe | `cd probe && uv sync && uv run pytest`（零第三方依赖） |
| intel | `cd intel && cargo build -p opencharm-intel`（联调前必须 build 而非 test） |
| 依赖扫描性能红线 | `cd shell\src-tauri && cargo test --release bench_dep_scan -- --ignored --nocapture`（≤ 2s） |
| **体积 / 规模预算断言**（超限非零退出） | `node shell/scripts/budget-check.mjs`（`--report` 只打印 / `--no-write` 不落盘）。**断言前必须先 `cd shell && npm run build`** —— 陈旧 `dist/` 会残留已删分包而虚报（曾虚报约 2.08 MB），脚本会判 **STALE** 并失败 |
| 规模 / 命令数 / 文档数取数 | `node tools/stats/repo-stats.mjs`（`--no-write` 只打印）；口径见 `docs/improvement_and_roadmap_report.md` §9 **取数禁则** |

**复核触发条件**：HEAD 变动 ≥ 10 提交 · 任一专项验收收口 · 季度评审 · 任一计划状态从"未开工"转"已交付"。

---

## 6. 新会话上手路径（约 15 分钟）

1. 读仓库根 `AGENTS.md`（技术栈铁律 + 三语言红线 + 常用命令）；
2. 读本文件 §1 速览 + §2 表，知道项目做到哪一步；
3. 按你要改的域读 §3 对应真源（**先读专项计划再动代码**，计划里有 file:line 级落点）；
4. 动代码前查 §3.4 调研报告里该功能是否已被裁决"不做"（避免违反 `dev_plan_v2` §1.1）；
5. 交付前跑 §5 对应门禁 + 更新本文件 §2 状态列与 §4 不一致登记。
