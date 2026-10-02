# OpenCharm 现状评估 · 改进建议与未来功能规划

> 版本：v1.0 · 日期：2026-10-02 · 状态：**待评审**
> 性质：基于当前代码库与全部 `docs/` 文档的**现状评估 + 改进清单 + 未来功能候选池**，不是开发计划（不直接排期）。
> 与既有文档的关系：本文件是**全局视角的评估与选题**，落地时仍需回到各专项计划（`python_ide_dev_plan_v2.md` / 各 `*_dev_plan.md`）写 PR 级方案。冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
> 评估方法：代码规模与结构统计（`shell/`、`intel/`、`probe/`）+ 34 篇 `docs/*.md` 与 3 篇 ADR 的交付状态交叉核对 + 验收记录遗留项汇总。**所有数字均为当日仓库实测**（`git` HEAD `44c85ea`，分支 `master`，存在未提交改动）。

---

## 0. 一页结论

**OpenCharm 已经从"做一个 IDE"走到了"做一个什么样的 IDE"。**

功能广度上，它已经超过了绝大多数自用项目的合理预期：编辑增强、Git（六迭代）、调试（DAP/debugpy）、运行（PTY + 多实例）、终端、依赖健康、库特别支持、插件切片、国际化、多窗口、库/框架支持一应俱全，且几乎每一项都有验收记录与 E2E 用例兜底。工程底座的扎实程度（183 个 Tauri 命令、约 950 个前端用例、252 个 Rust 测试、版本锁定 + CI）在单人项目里属于头部水平。

但正因为"广"已经做到位，继续往清单里加功能的边际收益正在快速衰减，而三条更根本的缺口被掩盖了：

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| 1 | **差异化核心没有最终证据** | Gate D 的核心指标「运行过的无注解代码补全 ≥85% 且 ≥PyCharm」人工对标**一直未做**（`intel/README.md` P3-T10 挂起）；trace 新鲜度调参（dev plan §7）同样未做 | 项目立身之本（运行时智能）目前只有"能用"，没有"更好"的证据；一旦探针数据陈旧，体验会静默退化 |
| 2 | **质量门禁未闭环** | `e2e-real/` 7 个真机脚本**全部手动执行、不进 CI**；`package-smoke`（打包 + bench 红线）仅 `workflow_dispatch` 手动触发；性能红线（冷启动 1.5s / 内存 600MB）无定期回归 | E2E 分歧台账（D-001~D-007）里 3 条是"前端真 bug"，说明 mock 层保不住真机；没有自动化就靠人记得跑 |
| 3 | **产品身份未立起来** | `ui_premium_design_report.md`（昨日产出，待评审）：品牌双色系、表面分层端到端 1.12:1（人眼阈值 1.15）、编辑器跑 stock `vs-dark` 主题 | "称职但衍生"——像没贴牌的 VS Code。功能越全，身份缺失越刺眼 |

据此，本报告的建议优先级排序是：**先兑现差异化与门禁（P0），再立身份（P0/P1），最后才谈新功能（P1/P2 及以后）**。

> 一句话给未来半年：**少做功能，多做证据；少堆清单，多做身份。**

---

## 1. 现状盘点

### 1.1 工程规模（实测）

| 层 | 文件数 | 行数 | 备注 |
|---|---|---|---|
| 前端源码（`shell/src/**/*.ts`，不含测试） | 209 | **53,992** | 其中顶层 `src/*.ts` 100 个 / 34,135 行 |
| 前端样式（`shell/src/style.css`） | 1 | **5,050** | token 化彻底（158 处 `font-size` 全走变量） |
| Rust 外壳（`shell/src-tauri/src/*.rs`） | 27 | **18,910** | 183 个 `#[tauri::command]` |
| Rust 运行时智能（`intel/crates/**/*.rs`） | — | **3,754** | 独立 workspace，44 个 `#[test]` |
| Python 探针（`probe/src/**/*.py`） | — | **1,573** | 零第三方依赖，81 个 pytest |
| 文档（`docs/*.md` + `adr/`） | 34 + 3 | — | README 索引仅收录 22 篇 |

**合计约 84K 行自研代码**（不含 `node_modules` / 打包产物）。对一个单人项目而言，这已经是**需要认真对待维护成本**的量级——这一点直接影响后文第 5 章的选题判断。

### 1.2 规模分布的三个结构性信号

| 信号 | 数据 | 含义 |
|---|---|---|
| **巨型文件** | `git.ts` 3,204 · `main.ts` 2,839 · `lsp/client.ts` 1,774 · `fileTree.ts` 1,332；`env_cmds.rs` 4,936 · `fs_cmds.rs` 3,882 · `git_cmds.rs` 1,881 | 拆分工作做过两轮（TD-007/TD-014 把 `main.ts` 从 3,169 降到 1,620），但功能增长又把 `main.ts` 顶回 2,839。拆分是**持续动作**，不是一次性工程 |
| **命令面膨胀** | 183 个 Tauri 命令，`git_cmds` 47 + `env_cmds` 32 + `fs_cmds` 28 占 58% | 单一进程承载过多职责；插件化（轨 B / OEP）未启动前，Rust 侧会继续膨胀 |
| **样式单点** | `style.css` 5,050 行 | 已是事实上的设计系统；任何 token 级改动（如视觉改造批 2）都是高波及面操作，必须有单测 + 截图比对兜底 |

### 1.3 能力地图（已交付）

| 域 | 关键模块 | 状态 |
|---|---|---|
| 编辑器 | `main.ts` / `monaco.ts` / `splitEditor.ts` / `editorFind.ts` / `breadcrumbs.ts` / `bookmarks.ts` / `codeVision.ts` / `inlineValues.ts` | ✅ 多标签、分屏、面包屑、书签、引用计数、行内值 |
| 补全体系 | `lsp/client.ts`（1,774）+ `importAlias.ts` + `autoImport.ts` + `live-templates/` + `postfix.ts` + intel | ✅ **四层 sortText 契约**：`0xx` 模板/postfix · `0z` importAlias · `1xx` intel 运行时 · `2xx` 静态 |
| 智能模板 | `live-templates/`（builtin / ui / manager 1,128 行） | ✅ 容器 × 位置 × 词法三维上下文（相位 A/B 已交付） |
| Python 语义 | `pydanticDiagnostics.ts` / `pydanticField.ts` / `ruffLint.ts` / `ruffHints.ts` / `format.ts` / `frameworks.ts` / `endpointView.ts` / `stdlib.ts` | ✅ 四桶诊断 + 自研 Pydantic 构造校验与改名传播 |
| 库特别支持 | `libRegex.ts` / `libFormat.ts` / `libJson.ts` / `libEval.ts` / `libInject.ts` / `dslLens.ts` | ✅ P0 四件套 + P1 五件套（re 三件套 / 格式串 / JSON / 求值桥 / 脚本参数表单） |
| 运行 | `runFlow.ts` / `runState.ts` / `runWidget.ts` / `runHistory.ts` / `runConfigPanel.ts` + Rust `run_env.rs` | ✅ M1–M4 全交付；探针开销实测 1.35x < 1.5x 红线 |
| 调试 | `debugView.ts` / `debugGutter.ts` / `debugConsole.ts` / `debugWatches.ts` / `dap/` + Rust `dap.rs` | ✅ D1–D5 / Gate E；条件/日志断点齐全；**8 项人工验收清单待办** |
| Git | `git.ts`（3,204）+ `gitGutter.ts` / `gitMerge.ts` / `gitStatusState.ts` / `cloneRepository.ts` + Rust `git_cmds.rs`（47 命令） | ✅ 迭代 0–6 全交付；仅 shelf/changelist 与完整凭据 UI 暂缓 |
| 终端 | `terminal.ts` / `termUi.ts` + Rust `terminal.rs`（portable-pty） | ✅ 多会话 |
| 依赖健康 | `depHealth.ts` / `depHealthPanel.ts` / `envPanel.ts` / `toolchain.ts` | ✅ 扫描 + 修复 + 忽略清单 |
| 插件 | `devtools/` + `extensions/` + Rust `plugin_cmds.rs` / `plugin_pkg.rs` | ✅ 工具切片 PR-1~4（490 测试）；v1 信任模型 = 同源 + facade；**v2 议题未启动** |
| 国际化 | `i18n/` | ✅ zh-CN / en-US 双语，20 批抽取，编译期对齐 |
| 运行时智能 | `probe/` + `intel/` | ✅ P3-T01~T09 交付；**P3-T10 人工对标挂起** |
| 多窗口 | Rust `per_window.rs` / `window_mgr.rs` | ⚠️ 阶段 0 已落地；文档状态栏仍写「阶段 0/1/2 均未开工」，需复核回填 |

### 1.4 质量底座

| 项 | 现状 | 评价 |
|---|---|---|
| 前端单测 | 88 个 `*.test.ts`；最近门禁基线 **941 用例全绿**（迭代 6 交付时）/ 929（i18n 收尾时） | 强 |
| Rust 单测 | `src-tauri` 252 个 `#[test]`（`env_cmds` 79 / `fs_cmds` 49 / `run_env` 20 / `dap` 10 …）+ intel 44 | 强 |
| Python 单测 | probe 81 个 pytest | 强 |
| E2E（mock 层） | `shell/e2e/` **59 个 spec**，按 13 个功能域分组 | 强 |
| E2E（真机层） | `shell/e2e-real/` **7 个 `.cjs`**，手动执行，**不进 CI** | **弱** |
| 分歧台账 | `e2e_divergence_ledger.md` D-001~D-007，含避坑速查 6 条 | 好实践，但资产未自动化 |
| CI | 单 workflow 两 job：`test`（4 矩阵）+ `package-smoke`（**仅手动 dispatch**） | 中 |
| 版本锁定 | `ci/versions.toml`：tauri 2.11.5 / monaco 0.52.2 / pyrefly 1.3.1 / basedpyright 1.39.10 / ruff 0.16.1 / debugpy 1.8.21 / python 3.13.7 / uv 0.10.11 / rust 1.96.0 | 强 |

### 1.5 已识别但未处理的存量债务

- **技术债登记**：待处理区仅剩 1 组（TD-021，5 个 P4 小项：终端背压 UTF-8 口径、session 恢复令牌、tab 快照保头弃尾、进程树孙进程统计、Watches 顶层副作用）。历史已归档 20+ 条——**债务治理是有效的**。
- **验收遗留**：调试 8 项人工清单（§五）；运行侧 M2 遗留（Logpoint 三路回归、退出孤儿进程人工核验）；probe 长驻覆盖体验观察转日常。
- **计划文档与现实脱节**：`python_ide_dev_plan_v2.md` §7 状态表**未记录** Git 六迭代、远端克隆、多窗口、插件切片、库支持、依赖健康、Pydantic、i18n 等过去五周的交付；README 索引未收录 `dx_features_backlog.md`、`git_improvement_report.md`、`git_clone_dev_plan.md`、`multi_window_dev_plan.md`、`onboarding_dev_plan.md`、`python_library_support_*.md`、`e2e_divergence_ledger.md`、`menubar_improvement_plan.md`、`pycharm_ux_review_and_proposal.md` 等 12 篇。
- **未提交改动**：`README.md` / `shell/index.html` / `shell/src/style.css` 已修改、`docs/ui_premium_design_report.md` 新增但均未提交——**视觉改造已开工但未落库**，建议先收口成一个可回滚的提交再开新战线。

---

## 2. 改进建议

> 分 P0 / P1 / P2 三档。每档内按「收益 ÷ 成本」排序。**P0 不是"最紧急的 bug"，而是"不补会持续失血的结构性缺口"**。

### P0-1 · 兑现差异化核心：Gate D 人工对标 + trace 新鲜度调参

- **问题**：`intel/README.md` P3-T10「PyCharm 同场景人工对标**待复核**」从 Phase 3 收尾挂到现在；`dev_plan_v2` §7「基于真实使用数据调整降权/清理策略」标注 ⚠️ 未做。核心指标（无注解代码补全 ≥85% 且 ≥ PyCharm）没有最终证据，且没有真实数据驱动的降权参数。
- **为什么是 P0**：这是项目**唯一不可被 VS Code + Copilot 复制的能力**。功能清单上的东西别人都有，这条没有别人就没有。它未兑现，等于 OpenCharm 目前只是"一个不错的 Python IDE"。
- **建议动作**：
  1. 定一个**最小可复现对标协议**（固定 5~8 个无注解样例：爬虫解析函数、FastAPI handler、字典管道、动态属性、循环累积），同一台机器先后跑 OpenCharm（intel 开 / 关）与 PyCharm，记录 Top-5 命中率与首选项命中率，产出 `bench/reports/gate-d-ab.md`；
  2. 基于真实 trace 库反推降权参数：统计 `stale` 占比、hits 长尾分布、trace 库体积增长曲线，把 `intel` 降权系数与 `probe clean` 的保留窗口从"拍脑袋值"改成"有据值"；
  3. 把结论回写 `intel/README.md` 与 `dev_plan_v2` §7，把 ⚠️ 改成 ✅ 或明确记 ❌。
- **成本**：约 3~5 人日（含 PyCharm 侧人工操作）。
- **验收**：有对标报告 + 降权参数有依据 + 文档状态一致。

### P0-2 · 质量门禁自动化：e2e-real 进 CI + bench 红线定期回归

- **问题**：7 个真机脚本全靠手跑；`package-smoke` 手动 dispatch；性能红线无定期验证。分歧台账中 D-001/D-005/D-007 的根因（LSP cwd 缺失、uv 兜底不支持调试、watcher 就绪时序）都是**真机才暴露**的集成缺陷。
- **建议动作**：
  1. 新增 `nightly` workflow（或 `workflow_dispatch` + 每周定时）：跑 `e2e-real/` 全量 + `bench/collect-metrics.ps1` 红线断言；失败自动开 issue 或只告警（自用项目告警足够）；
  2. 为 `real-env.cjs` 补一个 `--json` 汇总输出，便于 CI 断言与历史对比；
  3. 把 `package-smoke` 从"仅手动"升级为"打 tag 时自动跑"；
  4. **不要**把 e2e-real 放进每次提交的门禁（真机慢且不稳），保持"高频 mock + 低频真机"的双层策略（台账已有此约定）。
- **成本**：约 2 人日。
- **验收**：真机脚本可在 CI 上一键跑出通过/失败汇总；一次 tag 打包自动触发 smoke。

### P0-3 · 落地产品身份（视觉改造批 1 + 批 2）

- **问题**：`ui_premium_design_report.md` 已诊断出三个致命点（品牌双色系 RGB 距离 87.7 / 表面分层端到端 1.12:1 低于人眼阈值 / Monaco 跑 stock `vs-dark`），报告待评审、未落地。
- **建议动作**：按报告 §5 路线图，**批 1 + 批 2 合并为一个 PR**（约 55% 的总收益，改动集中在 token 层），批 3（字体 + Monaco 主题 + 随包分发）单独 PR 并做回归，批 4 拆小 PR。
- **关键纪律**（沿用 UI 计划既有约束）：禁止裸色值/裸字号/裸圆角；`theme/tokens.ts` 单一来源 + `themeTokenSync.test.ts` 钉死 CSS 与 Monaco 主题一致性；**不得**往 `main.ts`（2,839 行）堆逻辑。
- **成本**：批 1+2 约 2~3 人日；批 3 约 3~5 人日（含字体随包与打包验证）。
- **验收**：报告 §6 的 9 条清单（脚本实算对比度 + grep 计数 + 双主题四视图截图比对）。
- **注意**：当前工作区已有未提交的 `style.css` / `index.html` 改动，请先确认这批改动属于视觉改造的哪一段，避免与报告方案冲突或重复劳动。

### P0-4 · 收口人工验收清单 + 补上功能可发现性

- **问题 A**：调试 8 项人工清单（断点串位、三态互斥、进程树残留、改键生效、真安装包验收）与运行 M2 遗留项自 D5 验收后一直挂着。`README` 也写明"部分 UI 交互项待人工抽查"。
- **问题 B**：`onboarding_dev_plan.md` 状态是「**已立项未开工**」（3.5~4 人日）。而项目的真实矛盾恰恰是 onboarding 报告 §1.1 描述的"**功能密度与发现性的剪刀差**"——功能已经很多，但用户自己都找不到。
- **建议动作**：
  1. 用一次真机会话把调试 8 项 + 运行 2 项跑完，把结果回写验收记录（半天）；
  2. 启动 onboarding PR-S1（新手指南文档）+ PR-S2（欢迎页快速开始 / 功能巡礼 / force-show）+ PR-S4（空状态补缺口）；S3（pip→uv hint）、S5（键盘提示）按需。
- **成本**：A 约 0.5 人日；B 约 3~4 人日。
- **判断依据**：在"再加 10 个功能"和"让已有 100 个功能被找到"之间，后者的边际收益明显更高——尤其对单人自用场景，用户就是产品负责人本人。

### P0-5 · 偿还结构性债（拆分 + 文档回填）

- **问题**：`main.ts` 2,839 行 / `git.ts` 3,204 行 / `env_cmds.rs` 4,936 行；`dev_plan_v2` §7 状态表与 README 索引均严重滞后于现实。
- **建议动作**：
  1. `main.ts` 第三轮拆分：目标 <2,000 行，继续用既有的 **handler 注入**范式（TD-013/014 已验证有效，零循环 import）；
  2. `env_cmds.rs` 按职责切（解释器管理 / 包操作 / 版本探测），`fs_cmds.rs` 同理；Rust 侧测试已按文件聚合，拆分后测试随迁即可；
  3. 建一份 `docs/delivery-overview.md`（交付总览）：一张表列出「功能域 · 交付日期 · 计划文档 · 验收记录 · 当前状态」，并把 README 索引补齐 **34 篇**文档。**这份文档同时是新人/新会话的入口**——现在要搞清楚项目做到哪一步，得读 34 篇 md，这个成本每周都在付。
- **成本**：约 3~5 人日，可拆成多个小 PR。
- **验收**：`main.ts` < 2,000 行且 tsc/vitest 全绿；README 索引覆盖全部 `docs/*.md`；`delivery-overview.md` 与实际情况一致。

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

- 现状：一键打包（`build-release.ps1`）+ NSIS 出包已落地，但**没有更新通道**，也没有版本回滚。自用项目也要面对"我这版是不是装错了"。
- 建议：`tauri-plugin-updater` 或最简方案（发布时产出 `version.json`，应用启动时比对并提示）+ 安装包保留最近 2 版；设置面板加"检查更新"。
- 成本：约 1~2 人日（最简方案）。

### P1-3 · 性能预算制度化

- 现状：冷启动 <1.5s / 内存 ≤600MB 只在手动 smoke 时验证；`style.css` 5,050 行与前端 60K 行代码没有任何体积门槛。
- 建议：CI 增加 bundle 体积与首屏资源数的阈值断言；`bench/collect-metrics.ps1` 的红线断言纳入 nightly（与 P0-2 共用）。
- 成本：约 1 人日（搭在 P0-2 上边际成本很低）。

### P1-4 · 补齐真机 e2e 覆盖的关键路径

按功能域补齐 `e2e-real/`：LSP 真引擎（pyrefly 裸会话）、运行真 `uv run`、终端真 PTY、插件真加载、多窗口真双窗（已有）。优先补**跨进程链路**类（最容易出集成缺陷），纯前端交互交给 mock 层。
成本：每域约 0.5~1 人日。

### P1-5 · 偿还 TD-021 五小项

5 个 P4 项，其中 **①终端背压 UTF-8 口径**（CJK 下阈值放宽 3 倍）与 **③ tab 快照保头弃尾**（丢最近打开的 tab）在中文 Windows 自用场景下有实际体感，建议优先。其余三项按"顺手"原则处理。
成本：合计约 1~2 人日。

### P1-6 · 插件 v2 议题启动（择一）

`plugin_system_design.md` §10 列出 5 个全局待决策点 + 9 个切片决策。v2 议题里**性价比最高的是"工作区级插件目录"**（加载器只是多一个扫描根，非破坏性扩展，且能让插件随仓共享）。硬沙箱（iframe/Worker）与 Python 工具桥成本高、收益对自用场景有限，建议继续延后。
成本：工作区级目录约 1 人日。

---

### P2-1 · 多窗口阶段 1/2 复核与收口
先复核 `per_window.rs` 落地后阶段 1/2 的真实状态，把 `multi_window_dev_plan.md` 的状态栏与实施记录回填，再决定是否继续投。文档与代码不一致本身就是维护负担来源。

### P2-2 · 跨仓库/跨机器设置同步
`settings.json` + 键位 + live templates + import 别名学习表导出/导入（storagePanel 已有迁移基建可复用）。多机开发时价值明显。
成本：约 2 人日。

### P2-3 · Web 侧能力（远程/WSL/SSH）
成本高、与"Windows 单机自用"画像契合度低，建议**只登记不排期**，除非出现明确使用场景。

---

## 3. 未来功能候选池

> 说明：以下不是"要做的事"，是**选题池**。每条给出价值 / 成本 / 依赖 / 风险 / 与铁律的关系，供产品负责人按阶段挑选。**建议每个阶段只从 A/B 两类各挑 1~2 个。**

### A 类 · 深化差异化（护城河）—— 建议优先

A 类全部复用已有的 probe trace 数据或外壳基建，**别人抄不走**。

| # | 功能 | 说明 | 成本 | 依赖 | 风险 |
|---|---|---|---|---|---|
| A1 | **运行时热点视图** | 侧栏新视图：按 `hits` 排序列出真实跑过的函数，标注"从未运行"的可疑函数（死代码候选）+ 异常观测 `exc_types` 标记（"这里抛过 ValueError"） | 中（2~3d） | intel 索引已有 `hits` / `exc_types` | 需定义"从未运行"的置信口径（受采样与覆盖范围影响），避免误报成噪音 |
| A2 | **轻量内置 Profiler** | probe 已挂 `sys.monitoring`，扩展采集调用耗时 → IDE 内函数级耗时视图 + Top-N 慢函数 + 点击跳转。对标 cProfile + snakeviz，但**零用户操作** | 中-大（5~8d） | PEP 669 事件扩展；开销预算需重新定（现红线 1.5x 是类型采样口径） | 开销上升；需新增"性能模式"开关，默认关 |
| A3 | **trace 驱动的签名补全与默认值提示** | `arg_types` 已按参数位累加观测 → 调用处补全参数名、hover 显示"实际见过的类型与常见值" | 小-中（2d） | intel `arg_types` | 与静态补全排序竞争（沿用 `1xx` 段钉序即可） |
| A4 | **爬虫场景工具箱**（画像强绑定） | 选择器测试面板（输入 HTML + CSS/XPath → 实时结果，复用 `libEval` 求值桥）、请求回放（从运行历史提取 request 重放）、响应结构 → Pydantic model 生成 | 中（3~5d） | `libEval` / `endpointView` / 运行历史 | 面窄但精准——用户画像是「FastAPI + 爬虫 + 小脚本」，这是**只有 OpenCharm 会做**的功能 |
| A5 | **FastAPI 路由面板增强** | 已有 `endpointView.ts`；扩展 OpenAPI/Schema 预览、路由 ↔ handler 双向跳转、一键生成 curl（反向已有 `curl2python`）与请求样例 | 中（3d） | `frameworks.ts` / `endpointView.ts` | 需决定是静态解析还是运行时导入（运行时更准但需装依赖） |
| A6 | **trace 驱动的 lint** | 用运行时观测反哺静态诊断：形参从未收到某类型却按该类型使用、函数从未被调用（不可达）、`exc_types` 显示有异常路径却无 try | 中-大（5d） | 诊断合并管线 | 与四桶诊断的冲突消解规则；误报控制是成败关键 |

### B 类 · 补齐 IDE 基本功

| # | 功能 | 说明 | 成本 | 备注 |
|---|---|---|---|---|
| B1 | **pytest 集成** | `pytest -q` / `--json` 结果解析 → 树形结果面板 + 失败点击跳转 + 重跑单测 + 覆盖率着色（覆盖率可用 coverage.py） | 中（3~4d） | README 目前写「明确不做 pytest 面板」。**建议重新评估**：自用 Python 开发者没有测试面板是真痛点，且比同等成本的"锦上添花"功能实用得多 |
| B2 | **REPL / Scratch 执行** | 选中代码 → 发送到长驻 Python 进程执行（复用 `libEval` 求值桥 + 终端 PTY）；或轻量 cell 模式 | 小-中（2d） | 与 A4 共享求值桥基建；对"小脚本"画像高频 |
| B3 | **数据库/SQL 工具** | SQLite 优先（零配置）：连接管理 + 表浏览 + 查询编辑 + 结果网格 | 中-大（8~10d，含 rusqlite） | 爬虫/小脚本场景常伴 SQLite；若要支持 Postgres/MySQL 成本翻番，建议只做 SQLite。**已有 PR 级计划：`docs/toolbox_dev_plan.md` §4** |
| B4 | **HTTP Client**（`.http` 文件） | 类 REST Client：写请求 → 发送 → 历史 + 变量；与 A5/A4 天然协同 | 中-大（7~9d，含 reqwest） | 已有 `curl2python` 与求值桥，可复用。**已有 PR 级计划：`docs/toolbox_dev_plan.md` §5** |
| B5 | **日志/输出结构化视图** | 运行输出里结构化日志（JSON/loguru）的级别过滤、字段折叠、时间戳对齐 | 小-中（4~5d） | 复用 `output.ts` 已有级别层；需把 `termUi` 采集钩子改多播。**已有 PR 级计划：`docs/toolbox_dev_plan.md` §6** |
| B6 | **TODO/任务与文档工具** | 已有 `todoView.ts` / `markdownPreview.ts`；可扩 Mermaid/图表预览、文档大纲 | 小（3~4d） | 低风险。**已有 PR 级计划：`docs/toolbox_dev_plan.md` §7** |

### C 类 · AI 能力（需产品裁决）

项目定位长期写「明确不做 AI」。如果要做，**建议只做不抢戏的三件小事**，且必须可一键关闭：

| 功能 | 说明 | 成本 |
|---|---|---|
| Traceback 解释器 | 运行失败时，在 traceback 面板旁给一句"人话解释 + 可能原因"（可走云端免密钥 LLM 或本地小模型） | 小（1~2d，不含接入） |
| 提交信息生成 | 现有是规则式 Conventional Commits（Git 迭代 5 已落地）；可作为**增强**提供 AI 版，规则版保留为默认 | 小 |
| 选中代码解释 / 重构建议 | 右键菜单入口，走同一套 AI 通道 | 中 |

**风险与纪律**：AI 是"装饰过载"和"身份稀释"的高发区——视觉报告 §7 明确反对引入"AI 紫"作为第三种色系。若立项，须遵守：① 独立模块 + 全局开关，默认关；② 不进补全主链路（避免与四层 sortText 契约打架）；③ 不引入新色系。

### D 类 · 生态与平台（长线）

- 插件 v2：硬沙箱（iframe/Worker）+ 跨 realm facade、Python 工具桥（Pyodide / 轨 B 子进程）、`.ocx` 安装包格式；
- 插件市场 / 模板分享（当前明确不做，维持）；
- OEP（OpenCharm Extension Protocol）复用 LSP 超集的决策点；
- 多语言支持（现为 Python 专用，铁律未禁止但会稀释定位）。

---

## 4. 优先级矩阵（全部建议汇总）

| 建议 | 价值 | 成本 | 依赖 | 优先级 |
|---|---|---|---|---|
| P0-1 Gate D 对标 + trace 调参 | ★★★★★ | 中 | 人工操作 | ★★★★★ |
| P0-3 视觉身份批 1+2 | ★★★★★ | 小 | 报告评审通过 | ★★★★★ |
| P0-4 验收清单收口 + onboarding | ★★★★ | 中 | — | ★★★★★ |
| P0-2 真机 e2e + bench 入 CI | ★★★★ | 中 | — | ★★★★☆ |
| P0-5 main.ts 拆分 + 交付总览文档 | ★★★★ | 中 | — | ★★★★☆ |
| A1 运行时热点 / 死代码视图 | ★★★★ | 中 | intel 索引 | ★★★★☆ |
| B1 pytest 集成（重新评估） | ★★★★ | 中 | — | ★★★★☆ |
| A3 trace 驱动签名提示 | ★★★ | 小 | arg_types | ★★★★ |
| P1-1 可观测性三件套 | ★★★ | 中 | — | ★★★ |
| A4 爬虫工具箱 | ★★★★（画像匹配） | 中 | 求值桥 | ★★★ |
| B2 REPL / Scratch | ★★★ | 小 | 求值桥 | ★★★ |
| A5 FastAPI 面板增强 | ★★★ | 中 | endpointView | ★★★ |
| P1-2 自动更新 | ★★★ | 小 | — | ★★★ |
| P1-5 TD-021 五小项 | ★★ | 小 | — | ★★ |
| A2 内置 Profiler | ★★★★ | 大 | 开销预算重定 | ★★（排后） |
| B3 SQLite 工具 | ★★★ | 大 | — | ★★（排后） |
| C 类 AI 三项 | ★★（待裁决） | 小-中 | 接入通道 | ★（待裁决） |
| A6 trace 驱动 lint | ★★★ | 大 | 误报控制 | ★（排后） |
| D 类生态长线 | — | 大 | — | 不排期 |

---

## 5. 路线图建议

> 按**主题泳道**而非时间盒排列；每个阶段建议只开 2~3 条泳道，避免战线过宽（单人维护 84K 行的现实约束）。

### 阶段一 · 收口期（约 4~6 周）

| 泳道 | 内容 |
|---|---|
| 差异化兑现 | P0-1（Gate D 对标 + trace 调参） |
| 身份 | P0-3（视觉批 1+2 → 批 3，含 Monaco 主题与字体随包） |
| 质量门禁 | P0-2（真机 e2e + bench 入 nightly） |
| 债务 | 提交当前未提交的视觉改造改动；P0-5 的交付总览文档部分 |

**阶段门**：Gate D 有结论（✅ 或明确 ❌ + 后续动作）；视觉批 1~3 全绿并通过截图比对；nightly 能跑出真机汇总。

### 阶段二 · 深化期（约 6~12 周）

| 泳道 | 内容 |
|---|---|
| 差异化 | A1 运行时热点 + A3 签名提示（共用 intel 数据层） |
| 基本功 | B1 pytest 集成（若裁决通过）+ B2 REPL |
| 工程 | P0-5 `main.ts` 拆分、P1-1 可观测性、P1-2 自动更新 |

**阶段门**：pytest 面板在真实项目上可用；热点视图对"死代码"的误报率可接受；`main.ts` < 2,000 行。

### 阶段三 · 画像期（约 12~20 周）

| 泳道 | 内容 |
|---|---|
| 画像专项 | A4 爬虫工具箱 或 A5 FastAPI 增强（建议先做与当季实际工作最相关的那个） |
| 可选 | B3 SQLite 工具、B4 HTTP Client（与 A4/A5 共享基建，可联动） |
| 债务 | P1-4 真机覆盖补全、P1-6 工作区级插件目录 |

### 阶段四 · 评估期（20 周后）

回头看阶段二/三的真实使用率（可用 P1-1 的埋点数据），决定：A2 Profiler 是否立项、C 类 AI 是否立项、D 类是否启动。**没有使用数据的功能等于没有交付**——这一点应在阶段二就靠埋点准备好。

---

## 6. 维护成本：单人项目最大的长期风险

`dev_plan_v2` §9 风险登记册已列「自用项目长期维护负担 — 自研组件全部独立成包/进程」。84K 行代码 + 34 篇文档 + 183 个命令的现实下，这条风险的量级已经变了。补充三条具体对策建议：

1. **降低"知道项目在哪"的成本**：`docs/delivery-overview.md`（P0-5）是杠杆最高的一项——它同时服务未来的自己和任何接手的会话。
2. **降低"改坏不知道"的成本**：nightly 真机 + bench 红线（P0-2）。单人项目没有 code review 的第二双眼睛，自动化门禁是唯一替代。
3. **降低"升级不敢动"的成本**：`ci/versions.toml` 已锁定 9 类依赖，但「升级回归 CI 自动化」在 §7 仍标 ⚠️。建议把"每月一次依赖升级演练"固化成 nightly 的一个可选 job（装新版本 → 跑 bench → 出对比报告，不自动合入），把升级从"事件"变成"例行公事"。

---

## 7. 明确不做（维持现有裁决）

| 不做 | 理由 |
|---|---|
| 插件市场 / 模板市场 | 自用场景无收益，运营成本不成比例 |
| 协作编辑 | 与单人自用定位无关 |
| 远程 / WSL / SSH 开发 | 成本高，与 Windows 单机画像契合度低（登记不排期） |
| 替换 Pyrefly 为第三方语言服务 | 铁律：第三方只补充不替换 |
| 往代码区加装饰（圆角/阴影/渐变/毛玻璃） | 视觉报告 §7：装饰占观感权重仅 4%，且在 IDE 语境有害 |
| 引入第三种色系（如"AI 紫"） | 同上，色系越多越难看 |
| 增加字号档位 | UI-18 已从 12 档收敛到 6 档，再加是倒退 |
| 破坏四层 sortText 契约的补全来源 | 补全排序是用户体感的核心，任何新来源必须明确钉段 |

---

## 8. 待补充 / 本报告未覆盖

- probe/intel 的**实际运行数据**（trace 库体积、hits 分布、stale 占比）——需要真实使用后才能给出调参建议，P0-1 执行一次后回填；
- `shell/e2e-real/` 各脚本的当前通过状态（需手跑一次确认）；
- 多窗口阶段 1/2 的真实完成度（文档与代码不一致，需复核）；
- 打包产物的实际体积与冷启动/内存的**最新实测值**（`bench/reports/` 中未见到近期红线报告）。

---

## 附：本报告引用的关键文档

| 文档 | 用途 |
|---|---|
| `docs/python_ide_dev_plan_v2.md` §7 | Phase 4 状态表（本报告指出其滞后） |
| `docs/ui_premium_design_report.md` | P0-3 的方案来源与验收清单 |
| `docs/tech-debt.md` | P1-5 的债务明细 |
| `docs/e2e_divergence_ledger.md` | P0-2 的论据（真机才暴露的缺陷） |
| `docs/onboarding_dev_plan.md` | P0-4 的方案来源 |
| `docs/dx_features_backlog.md` | 已完成清单，避免重复立项 |
| `docs/git_improvement_report.md` §9 | 迭代 0–6 交付事实 |
| `docs/plugin_system_design.md` §10 | P1-6 / D 类的待决策点 |
| `intel/README.md` | P0-1 的挂起项 |
| `docs/debug_acceptance_record.md` §五 / `docs/run_acceptance_record.md` §四 | P0-4 的人工验收清单 |
