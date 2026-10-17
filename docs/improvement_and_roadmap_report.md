# OpenCharm 现状评估 · 改进建议与未来功能规划

> 版本：**v1.5** · 日期：2026-10-12 · 状态：**现行（维护态清理版）**
> 性质：基于当前代码库与全部 `docs/` 文档的**现状评估 + 改进清单 + 未来功能候选池**，不是开发计划（不直接排期）。
> 与既有文档的关系：本文件是**全局视角的评估与选题**，落地时仍需回到各专项计划（`python_ide_dev_plan_v2.md` / 各 `*_dev_plan.md`）写 PR 级方案。冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
>
> **v1.5 清理（2026-10-12）：将已实现的内容从本文移除。** 删除范围：P0-0~P0-4、P1-3 / P1-4 / P1-5、P2-2 全部章节，候选池 A1~A5 与 B3~B6 全部条目，以及头部 v1.1~v1.4 的全部落地续记（⑩~㉖）。这些内容的**交付记录真源是 `docs/delivery-overview.md` §2 与各专项验收记录**——本文件不再承担交付账本职责。条目编号（P\* / A\* / B\*）**保留历史连续性**：外部文档与代码注释按编号引用本文件，被删条目在**附二存档索引**中各留一行指针（不含任何建议或方案内容）。
> 清理后本文件只剩四样东西：**未闭环的建议（§2）· 候选池剩余条目（§3）· 明确不做与口径纪律（§5 / §7）· 取数方法与禁则（§9）**。§1 是现状盘点——评估的基线，不是待办清单。
>
> **取数时点**：2026-10-06，git HEAD `bb32d77`（v1.2 基线 `ccf9da2` 之后 23 个提交）。§1.1 规模表维持该快照未重取；§1.4 门禁数字按 `delivery-overview.md` v1.20（2026-10-10）口径刷新。规模数字由 **`node tools/stats/repo-stats.mjs`** 产出（口径固化在脚本里，见 §9）。**引用本文数字前必须先核对 HEAD。**

> **口径纪律（跨章节有效，永久）**：
> ① 对外叙事里**"比 PyCharm 更准"不可写**（`CONTENT-SERIES.md:192`）；可写的只有"在自有样例集上 23/23"这类**自证**口径（§5 同）。
> ② trace 样本量未跨项目累计到 ≥1000 条函数观测前，`STALE_HITS_DIVISOR`（现为 2）与 trace 库保留窗口**只作建议值，不落代码**；已裁定改为日常 IDE 使用自然累积，不再专门采样。
> ③ 已交付工具的口径红线不随本文件清理而失效：热点视图的「未观测到运行」**不是死代码断言**、选择器测试**不等于爬虫实际结果**、观测签名**不含默认值**——真源在各专项验收记录。

---

## 0. 一页结论

**OpenCharm 当前处于 Phase 4 打磨期（维护态）**：定位「高性能 · 轻量 Python IDE」（`ADR-0010`，2026-10-05 起性能与体积升为一等目标）。最小闭环（补全 / 跳转 / Hover / 诊断 + 运行 + 调试）早已交付，此后陆续落地 Git 六迭代、SQLite 工具、多窗口、插件切片、国际化、UI 视觉六批、HTTP 请求工具、结构化运行日志，以及一批差异化功能：运行时热点视图、端点请求样例 / 一键 curl、trace 驱动的调用实参补全 / hover 观测签名 / 签名帮助、选择器测试器与响应→模型桥、内置 Profiler（默认关）、端点 CodeLens 反向跳转与 OpenAPI 面板内预览——**全部有验收记录与单测 / e2e 兜底**（记录见 `delivery-overview.md` §2）。

**本报告 P0 档已全部关闭**（预算回绿 · 门禁闭环与 CI 落点裁决 · Gate D 两格按规则关闭 · 三个产品缺陷修复 · 结构性债裁决并执行拆分），阶段二（深化期）已收口。按本报告自身的校验位口径：**清单里不再有"永远挂着"的项**——连续两版零进展的条目按"要么做、要么显式撤下"的二选一截止规则处理（该规则此后常驻，见 §9）。

仍未闭环的只剩四类，且都不消耗排期人力：

| # | 事项 | 性质 |
|---|---|---|
| 1 | **CI 无宿主**：本仓远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions，两份 workflow 是"将来推 GitHub 的预埋" | **待外部事件**：迁移后首次 push 的 run 记录即验（谁推谁验） |
| 2 | **trace 样本量未达复核门槛**：跨 3 个真实项目累计 497 条函数观测（门槛 ≥1000） | 已裁定**日常自然累积**，不再专门采样；`STALE_HITS_DIVISOR` 维持 2 |
| 3 | **TD-025 复审清单 6 条**（nightly 只告警 / 更新通道 / Inter 字体 / Watches localStorage / 插件沙箱 / HTTP 私网提示） | 待产品裁决，见 §8 与 `docs/tech-debt.md` |
| 4 | **候选池剩余条目**（A6 · B2 · C 类；**B1 已于 2026-10-17 交付 T1–T5 含真机验收**）与 P1 / P2 档建议 | 本报告 §2~§5 的主体，等待挑选 |

> 一句话：**门禁已在 PR 阶段可红、预算全绿、真机层有全绿基线；剩下的选择题不再是"补窟窿"，而是"要不要开新功能"。**

---

## 1. 现状盘点

### 1.1 工程规模（快照，HEAD `bb32d77`）

> 全部由 `node tools/stats/repo-stats.mjs` 产出（口径见 §9）。**本表是 2026-10-06 快照，未随后续交付重取**；此后的增量（命令 194 → 197、`env_cmds.rs` 拆分、A2 / A5③④ 等）记录在 `delivery-overview.md`。v1.1 曾用 `Get-Content .Count` 取行数，在 gb2312 代码页上系统性偏低 4.5%~13%，v1.2 已重取。

| 层 | 文件数 | 行数 | v1.2 → v1.3 | 备注 |
|---|---|---|---|---|
| 前端源码（`shell/src/**/*.ts`，不含测试） | 228 | **60,857** | 57,248 → 60,857（**+3,609**） | 顶层 `src/*.ts` 112 个 / 38,807 行（+6 文件 / +1,870 行）；增量主要来自 B4 HTTP（`httpRequest.ts` + `devtools/builtin/http.ts`）、B5 日志（`logView/logStore/logParse/editorInsert.ts`）、B6-3 TODO |
| 前端样式（`shell/src/**/*.css`） | 1 | **5,987** | 5,668 → 5,987（**+319**） | 即 `style.css`（设计系统本体）。⚠ v1.3 时点已破 `budgets.toml` 的 5,850 上限 → ✅ 2026-10-06 按主题拆出分文件后回绿（见 §1.2） |
| Rust 外壳（`shell/src-tauri/src/*.rs`） | 29 | **21,422** | 20,490 → 21,422（**+932**） | **194 个 `#[tauri::command]`**（快照值，现为 197）；新增 `http_cmds.rs`（B4，reqwest） |
| Rust 运行时智能（`intel/**/*.rs`，独立 workspace） | 13 | **3,953** | 3,766 → 3,953（+187） | 45 个 `#[test]`（快照值，现为 72） |
| Python 探针（`probe/**/*.py`，不含 tests） | 10 | **1,586** | 1,573 → 1,586（+13） | 零第三方依赖，81 个 pytest（快照值，现为 89） |
| 文档（`docs/*.md` + `adr/`） | 39 + 8 | — | ADR 0003–0010 | ADR +1（0010 性能轻量章程）；根目录另有 `CONTENT-SERIES.md`（连载发布建议，不在 `docs/`） |

**合计约 93.8K 行自研代码**（不含 `node_modules` / 打包产物 / 测试 / e2e / 文档）——23 个提交里 **+5.1K 行（+6.2%）**，增量几乎全部是 B4/B5 两个新功能。对一个单人项目而言，这已经是**需要认真对待维护成本**的量级；而定位变更后，它同时也是**需要认真对待体积与性能**的量级——这两点分别影响第 6 章的约束判断与选题取舍。

### 1.2 规模分布的三个结构性信号

| 信号 | 数据（HEAD `bb32d77` 快照） | 含义 |
|---|---|---|
| **巨型文件** | `env_cmds.rs` **4,945**（快照值）· `fs_cmds.rs` **3,882** · `git.ts` **3,204** · `main.ts` **2,094**（预算 **2,400**；2026-10-06 阶段二两刀共 −825 行）· `git_cmds.rs` **1,940** · 新文件 `menuItems.ts` **570**（上限 690）/ `debugEntry.ts` **171**（205）/ `windowKeys.ts` **147**（180）/ `sidebarViews.ts` **107**（130）/ `windowChrome.ts` **73**（90） · `lsp/client.ts` **1,774** · `db_cmds.rs` 1,537 · `fileTree.ts` 1,332 · `settingsPanel.ts` 1,154 · `live-templates/ui/manager.ts` 1,128 | ✅ **2026-10-07 已拆分执行**：`env_cmds.rs` 按业务域切四文件（`run_config` / `dep_health` / `dep_fix` + 瘦身本体），命令面 32 个与前端 invoke 字符串零变化；**冻结线（只减不增）与长期上限**写进 `env_cmds.rs` 文件头与 `ci/budgets.toml`。`main.ts` 第三刀外提仍是候选（余量已回健康区间）。另：前十门槛出现三个新面孔（`fileTree.ts` / `settingsPanel.ts` / `live-templates/ui/manager.ts`），说明"大文件"正在从历史遗留向新模块扩散 |
| **样式单点破线** | `style.css` 5,987（超 5,850 上限）→ ✅ **已按既定路径拆分（2026-10-06）**：**5,748**（B4 → `styles/http.css` 102 行、B5 → `styles/logView.css` 170 行，各设上限 125/205） | 拆分走的是 `budgets.toml:25` 写死的既定路径，未抬任何阈值；`audit_tokens.py` 同步加 `@import` 解析保证审计面不缩水（98 项全绿）。**教训归档**：预算第一次被真实触发到关闭用了半天——门禁的价值正在于此（先红、再逼出结构性动作、而不是静默突破） |
| **命令面膨胀** | **197** 个 Tauri 命令（快照值 194，A5③④ 后 +1、A2 复用既有命令不变）；Rust 侧命令面集中于 git / env / fs 三大域（env 拆四文件后命令数不变）；200 信号线余量已很薄（超限只告警） | 单一进程承载过多职责。插件化（轨 B / OEP）未启动前，Rust 侧会继续膨胀。**ADR-0010「默认轻量」条款应在此处先产生作用：新增命令面须先论证"能不能复用已有命令"** |

> 口径修正（保留自 v1.1）：v1.0 写「TD-007/TD-014 把 `main.ts` 从 3,169 降到 1,620」，`docs/tech-debt.md:57` 原文是 **~3,119 → ~1,196**（TD-014 另有后续轮次到 1,620）。引用时请回 `tech-debt.md` 原文，勿二次转述。

### 1.3 能力地图（已交付）

| 域 | 关键模块 | 状态 |
|---|---|---|
| 编辑器 | `main.ts` / `monaco.ts` / `splitEditor.ts` / `editorFind.ts` / `breadcrumbs.ts` / `bookmarks.ts` / `codeVision.ts` / `inlineValues.ts` | ✅ 多标签、分屏、面包屑、书签、引用计数、行内值 |
| 补全体系 | `lsp/client.ts` + `importAlias.ts` + `autoImport.ts` + `live-templates/` + `postfix.ts` + `completion/keywordCompletion.ts` + intel | ✅ **六段 sortText 契约**：`0NN` 模板/postfix < `0y` autoImport < `0z` importAlias < `1xx` intel 运行时 < `2xx` 静态引擎 < `3xx` 关键字兜底（python 除外） |
| 智能模板 | `live-templates/`（builtin / ui / manager） | ✅ 容器 × 位置 × 词法三维上下文（相位 A/B 已交付） |
| Python 语义 | `pydanticDiagnostics.ts` / `pydanticField.ts` / `ruffLint.ts` / `ruffHints.ts` / `format.ts` / `frameworks.ts` / `endpointView.ts` / `stdlib.ts` | ✅ 四桶诊断 + 自研 Pydantic 构造校验与改名传播 |
| 库特别支持 | `libRegex.ts` / `libFormat.ts` / `libJson.ts` / `libEval.ts` / `libInject.ts` / `dslLens.ts` | ✅ P0 四件套 + P1 五件套（re 三件套 / 格式串 / JSON / 求值桥 / 脚本参数表单） |
| 运行 | `runFlow.ts` / `runState.ts` / `runWidget.ts` / `runHistory.ts` / `runConfigPanel.ts` + Rust `run_env.rs` | ✅ M1–M4 全交付；探针开销按官方 harness 单形状实测在红线内（⚠ 跨形状口径 1.17x~2.48x，见 §6） |
| 调试 | `debugView.ts` / `debugGutter.ts` / `debugConsole.ts` / `debugWatches.ts` / `dap/` + Rust `dap.rs` | ✅ D1–D5 / Gate E；条件/日志断点齐全；**8 项人工验收清单已全部收口**（2026-10-03~06，含真安装包验收） |
| Git | `git.ts`（3,204）+ `gitGutter.ts` / `gitMerge.ts` / `gitStatusState.ts` / `cloneRepository.ts` + Rust `git_cmds.rs` | ✅ 迭代 0–6 全交付；仅 shelf/changelist 与完整凭据 UI 暂缓 |
| 终端 | `terminal.ts` / `termUi.ts` + Rust `terminal.rs`（portable-pty） | ✅ 多会话（背压已按真实 UTF-8 字节计） |
| 依赖健康 | `depHealth.ts` / `depHealthPanel.ts` / `envPanel.ts` / `toolchain.ts` | ✅ 扫描 + 修复 + 忽略清单（芯片内存已含孙进程） |
| 数据库 | `sqliteView.ts` / `sqliteTabs.ts` / `sqliteSql.ts` / `sqliteStore.ts` + Rust `db_cmds.rs` / `db_rows` | ✅ **B3 已交付 v1.4**（编辑器 Tab 化重设计）；真机 `db-real` **18/18 PASS**（2026-10-07）；真源 `docs/sqlite_tool_dev_plan.md` §17 |
| 插件 | `devtools/` + `extensions/` + Rust `plugin_cmds.rs` / `plugin_pkg.rs` | ✅ 工具切片 PR-1~4（490 测试）；v1 信任模型 = 同源 + facade；**v2 议题未启动**（见 P1-6） |
| 国际化 | `i18n/` | ✅ zh-CN / en-US 双语，20 批抽取，编译期对齐 |
| UI 视觉身份 | `theme/tokens.ts` + `style.css` + `tools/ui/audit_tokens.py` + `docs/adr/0005` | ✅ **六批全部落地**（批 1 / 2a / 2b / 3 / 4 / 5a / 5b / 5c）；Monaco 自定义主题 `opencharm-dark/light` + JetBrains Mono 随包；audit 98 项 0 FAIL 0 WARN；真机主题验收 32/32 PASS |
| HTTP 请求工具（B4） | `devtools/builtin/http.ts` / `httpRequest.ts` + Rust `http_cmds.rs`（reqwest） | ✅ devtools 面板驱动（发送 / 响应 / 变量 / 历史 / curl 导入 / 端点联动）；reqwest 真实链路有真机覆盖（`http-real.cjs` HR-1~HR-11）。真源 `docs/toolbox_dev_plan.md` §5.9–5.11 |
| 结构化运行日志（B5） | `logView.ts` / `logStore.ts` / `logParse.ts` / `editorInsert.ts` | ✅ 底部「运行日志」tab：多播采集 + 级别过滤 + 字段折叠/导出。真源 `docs/toolbox_dev_plan.md` §6.10–6.12 |
| TODO 增强（B6-3） | `todoView.ts` | ✅ 过滤 + 按文件分组 + 跳转 + 计数。**B6 整体已终止**——大纲与 Mermaid 取消（§7.7），状态"部分交付后终止" |
| 运行时智能 | `probe/` + `intel/` | ✅ P3-T01~T09 + **A1 热点视图 + A2 内置 Profiler（默认关）+ A3①+②+③ 实参补全 / hover 观测签名 / 签名帮助 + A4① 选择器测试 + A5①~④ 端点样例 / curl / 反向跳转 / OpenAPI 预览**；**P3-T10 两格已全部关闭**（2026-10-07：第一格 ❌ 按 v1.4 死线撤下 · 第二格 ✅ 3 项目 497 条收口） |
| devtools 工具箱 | `devtools/builtin/{http,selector}` + `httpRequest.ts` | ✅ B4 HTTP 请求 + A4① 选择器测试（前端浏览器 DOM 求值，常驻口径说明）+ A4③ 响应→模型桥 |
| 多窗口 | Rust `per_window.rs` / `window_mgr.rs` | ✅ 阶段 0/1/2 全部交付（`multi_window_dev_plan.md` v0.2；真机 `multi-window-real.cjs` 16/16 PASS）；#4~#6 依赖健康缓存经拍板暂缓 |

### 1.4 质量底座

| 项 | 现状（2026-10-10 口径，`delivery-overview.md` v1.20；规模类快照见 §1.1，仍锚 `bb32d77`） | 评价 |
|---|---|---|
| 前端单测 | **1291 用例 / 104 文件全绿** | 强 |
| Rust 单测 | **402 通过**（外壳 330 = 332 个 `#[test]` − 2 `#[ignore]`；intel 72 = 59 + 6 + 7）· probe **89** pytest | 强 |
| E2E（mock 层） | **73 个 spec（含 `_probe/`）/ 72 个（mock 层）** | 强 |
| E2E（真机层） | **11 个 `.cjs`**；**2026-10-07 起有全绿基线：7 套 / 112 项**（release-real 7 · db-real 18 · debug-real 14 · endpoints-real 4 · http-real 10 · multi-window-real 16 · new-project 4 · ui-real 39），全量约 7~8 分钟；**触发点已绑发布前验收**（`build-release.ps1 -Verify`，失败即非零退出） | **中→强**（编排 + 基线 + 触发点齐备；⏳ nightly 侧执行仍待宿主） |
| 专项门禁脚本 | `tools/ui/audit_tokens.py`（98 项，进 CI test job）+ `gate-tests.mjs unit\|e2e\|e2e-ui` + `ui-baseline.mjs` + `budget-check.mjs`（**已并入 `ci.yml` test job**，紧跟 `npm run build`，带 dist 新鲜度 STALE 判定；项数随交付增长、持续全 PASS） | 好实践 |
| 分歧台账 | `e2e_divergence_ledger.md` D-001~D-007，含避坑速查 6 条 | 好实践，但资产未自动化 |
| CI | **2 个 workflow**：`ci.yml`（`test` 4 矩阵 + `package-smoke`；push 分支 `[master, main]`，tags `v*`；含 `audit_tokens.py` 与 `budget-check.mjs`）+ `nightly.yml`（`e2e-real` / `bench` / `budget` 三 job，每日，全部 `continue-on-error`） | **配置强 / 证据无 / ⚠ 宿主错配**：远端只有 Gitee，Actions 不执行（§0 事项 1） |
| 版本锁定 | `ci/versions.toml`：tauri 2.11.5 / monaco 0.52.2 / pyrefly 1.3.1 / basedpyright 1.39.10 / ruff 0.16.1 / debugpy 1.8.21 / python 3.13.7 / uv 0.10.11 / rust 1.96.0 | 强 |

> **口径提示**：① `budget-check.mjs` 项数随交付增长（v1.2 时 10 项 → 2026-10 已 40+ 项），历史版本里出现的"十 / 十二 / …项"是各时点写下的历史值，**不再逐处改写**；引用现状以实测为准。② Rust 计数有两套口径：按 `#[test]` 属性数 vs 按通过数，非矛盾。③ E2E spec 计数必须写清是否含 `_probe/`（探针脚本、不是验收用例）。

### 1.5 已识别但未处理的存量债务

- **技术债登记**：待处理区 4 条——**TD-021②**（session.ts `restoring` 布尔非令牌，场景罕见，裁决不处理、维持登记）· **TD-022**（Monaco 浮层圆角无法跟随 `--radius-*`，P4 取舍）· **TD-024**（alpha 边框不满足 WCAG 1.4.11 的 3:1，P4 合规取舍）· **TD-025**（**「单人自用」论据失效复审清单，P2**，ADR-0010 连带登记，6 条待复审：nightly 只告警 / 更新通道与回滚 / Inter 字体不随包 / Watches 存 localStorage / 插件 v2 沙箱 / HTTP Client 私网提示）。TD-023 已关闭（实测前提不成立）。
- **验收遗留**：运行侧 M2 遗留（Logpoint 三路回归、退出孤儿进程人工核验）；probe 长驻覆盖体验观察转日常。
- **文档一致性**：功能域交付记录由 `delivery-overview.md` §2 统一跟踪（含已知文档不一致登记表）；本文件 §1.1 为快照、与后续交付存在时差，引用前按 §9 复核。

---

## 2. 改进建议

> 分 P1 / P2 两档（**P0 档已全部关闭并移出，编号与结局见附二存档索引**）。每档内按「收益 ÷ 成本」排序。
> 门禁纪律：P0 档的历史结论「报告本身要能被当回事」已由**二选一截止规则**承接（§9）——**新增任何建议都必须可验证、可关闭**，不接受"挂着不动"的第三种状态。

### P1-1 · 可观测性：从"有日志"到"能定位"

现状已有 `logging.rs`（落盘 + 级别 + 轮转 + 设置面板），缺的是**主动诊断能力**。建议补三件低成本的：

| 项 | 内容 | 价值 |
|---|---|---|
| 慢操作追踪 | 对 `invoke` 命令与 LSP 请求记耗时直方图，设阈值（如 >500ms）落 warn | 自用场景下"卡一下"最难复现，有数据就不用猜 |
| 会话诊断导出 | 一键打包：日志 + settings.json + 版本信息 + 最近 20 条错误 → zip | 出问题时不至于翻三个目录 |
| 关键路径埋点 | 冷启动各阶段耗时（窗口创建 / LSP 起 / 索引加载 / 首屏渲染）落日志 | 把"冷启动 <1.5s"从红线变成可归因的曲线 |

成本约 2~3 人日。
> 状态：**未开工**（v1.3 至今 0 进展）。它是阶段四"评估期"的前置——没有埋点，新功能的使用率评估只能降级为人工回忆式评审（见 §5）。

### P1-2 · 发布工程：自动更新与回滚

- 现状：一键打包（`build-release.ps1`）+ NSIS 出包已落地，且**发布前自动跑真机全量验收**（`-Verify`，见 §1.4）；但**没有更新通道**，也没有版本回滚（`shell/src-tauri/Cargo.toml` 无 updater 依赖）。
- **定位变更后的论据**：原"自用项目也要面对装错版本"是弱化版；定位转对外后，更新通道从"锦上添花"变成**分发可信度的基本项**（用户装完不会自动知道有新版，也不会知道装的是哪一版）。登记为 TD-025 第 2 条待复审。
- 建议：`tauri-plugin-updater` 或最简方案（发布时产出 `version.json`，应用启动时比对并提示）+ 安装包保留最近 2 版；设置面板加"检查更新"。
- 成本：约 1~2 人日（最简方案）。

### P1-6 · 插件 v2 议题启动（择一）

`plugin_system_design.md` §10 列出 5 个全局待决策点 + 9 个切片决策。v2 议题里**性价比最高的是"工作区级插件目录"**（加载器只是多一个扫描根，非破坏性扩展，且能让插件随仓共享）。硬沙箱（iframe/Worker）与 Python 工具桥**继续延后**——二者都会显著增加常驻开销与产物体积，与 ADR-0010「默认轻量 / 体积是卖点」直接冲突（TD-025 第 5 条）。
成本：工作区级目录约 1 人日。

---

### P2-1 · UI 视觉「批 6+」第二阶段（可选，非必需）

视觉六批已全部落地并通过真机验收（ADR-0005 + `ui_premium_dev_plan.md`）。本项仅登记后续可能方向，**不排期**：材质细节再深化、`opencharm-dark/light` 语法色与外壳的进一步同色、字体副档。若开，须沿用 `ui_premium_dev_plan.md` §6 的批次入口 + §4 门禁（`audit_tokens.py` 已进 CI + token 单测 + e2e computed-style 断言 + 截图比对），且**不得往 `main.ts` / `style.css` 堆逻辑**——两者均有预算上限，拆出的样式分文件也各有上限，静默增长会被 `budget-check.mjs` 拦。

### P2-3 · 跨仓库/跨机器设置同步

`settings.json` + 键位 + live templates + import 别名学习表导出/导入（storagePanel 已有迁移基建可复用）。多机开发时价值明显。
成本：约 2 人日。

### P2-4 · Web 侧能力（远程/WSL/SSH）

成本高、与 **Windows 单机 / 本地优先** 的定位契合度低（原表述"Windows 单机自用画像"中的"自用"已随 ADR-0010 废止，但**结论不变**——本地优先仍是对远程方案的否决理由）。建议**只登记不排期**，除非出现明确使用场景。

---

## 3. 未来功能候选池

> 说明：以下不是"要做的事"，是**选题池**。每条给出价值 / 成本 / 依赖 / 风险 / 与铁律的关系，供产品负责人按阶段挑选。**建议每个阶段只从 A/B 两类各挑 1~2 个。**
> **A1~A5 与 B3~B6 已全部移出**（已交付或已终止，见附二存档索引）；候选池现存条目如下。

### A 类 · 深化差异化（护城河）—— 建议优先

A 类全部复用已有的 probe trace 数据或外壳基建，**别人抄不走**。

| # | 功能 | 说明 | 成本 | 依赖 | 风险 |
|---|---|---|---|---|---|
| A6 | **trace 驱动的 lint** | 用运行时观测反哺静态诊断：形参从未收到某类型却按该类型使用、函数从未被调用、`exc_types` 显示有异常路径却无 try | 中-大（5d） | 诊断合并管线 | 与四桶诊断的冲突消解规则；误报控制是成败关键 |

### B 类 · 补齐 IDE 基本功

| # | 功能 | 说明 | 成本 | 备注 |
|---|---|---|---|---|
| B1 | **pytest 集成** ✅ **已交付 T1–T5（2026-10-17）** | 测试发现（`pytest --collect-only -q` 按需子进程）+ 侧栏测试树（结果状态合入）+ 绿箭头逐用例运行 / 调试 + 失败点击跳转 | 中（5~6d，扩大范围；最小闭环原估 3~4d） | 执行真源 `docs/pytest_dev_plan.md` v1.0 · 验收 `docs/pytest_acceptance_record.md` **v1.1**。裁决链已回写：`dev_plan_v2` §1.1 v2.2 · UX 报告 F-1 · 库支持研究 §8。**范围收敛记录**：本期按产品负责人裁决做到「发现 + 结果树 + 绿箭头」完整形态（超出 §8 原划的最小闭环）；独立结果面板 / 断言差异对比窗 / 覆盖率（F-3）/ watch / pytest 插件注入维持不做。**实测代价**：命令面 206 → **209/209**（计划估 207）· 产物 +**25** KB（6,012/6,050，计划估 +43）· index chunk 1,600/1,700 持平（testView 动态 import）。**真机 `pytest-real` 12 项检查 PASS**（uv 临时 venv；断点命中 / 无孤儿 / 取消全过），并抓出 5 个真 bug 已修；遗留：安装命令分支真机实测、大仓 collect 耗时基线 |
| B2 | **REPL / Scratch 执行** | 选中代码 → 发送到长驻 Python 进程执行（复用 `libEval` 求值桥 + 终端 PTY）；或轻量 cell 模式 | 小-中（2d） | 对"小脚本"画像高频；**本体走 `libEval` 求值桥**（选择器测试的前端 DOM 求值不走该桥，勿引为先例） |

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

## 4. 优先级矩阵（剩余建议汇总）

| 建议 | 价值 | 成本 | 依赖 | 优先级 |
|---|---|---|---|---|
| P1-1 可观测性三件套 | ★★★ | 中（2~3d） | — | ★★★（阶段四评估的前置） |
| B2 REPL / Scratch | ★★★ | 小（2d） | 求值桥（已就绪） | ★★★ |
| P1-2 自动更新 | ★★★ | 小（1~2d） | — | ★★★（TD-025 第 2 条） |
| P1-6 工作区级插件目录 | ★★★ | 小（~1d） | — | ★★★ |
| P2-3 设置同步 | ★★ | 中（~2d） | storagePanel 迁移基建 | ★★ |
| A6 trace 驱动 lint | ★★★ | 大（~5d） | 误报控制 | ★（排后） |
| B1 pytest 集成 | ★★★（**T1–T5 已交付**，2026-10-17） | 中（5~6d） | — | ★（收尾遗留：安装命令分支真机实测） |
| C 类 AI 三项 | ★★（**与现行定位冲突**） | 小-中 | 修订定位裁决 | ★（待裁决） |
| P2-1 UI 批 6+ 第二阶段 | ★★（可选） | 中 | 视觉六批已交付为前提 | ★（不排期） |
| P2-4 Web 侧能力 | — | 高 | — | 不排期 |
| D 类生态长线 | — | 大 | — | 不排期 |

**背景事项（不占优先级、不消耗人力）**：

| 事项 | 触发条件 |
|---|---|
| CI 首次跑通证据 | 迁移到 GitHub 后首次 push（谁推谁验）；`.github/workflows/` 是现成预埋 |
| trace 样本达复核门槛 | 日常 IDE 使用自然累积到跨项目 ≥1000 条函数观测，再复核 `STALE_HITS_DIVISOR` 与保留窗口 |
| TD-025 六条复审 | 对外分发拍板（`CONTENT-SERIES.md`）后逐条过 |

---

## 5. 路线图建议

> 按**主题泳道**而非时间盒排列；每阶段**只开 2 条泳道**。**阶段一（通电期）与阶段二（深化期）已收口**（记录见 `delivery-overview.md` §2 与附二存档索引）；以下是剩余路线。

### 剩余 · 画像与基本功（原阶段三）

| 泳道 | 内容 |
|---|---|
| 画像专项 | B2 REPL / Scratch（求值桥已就绪） |
| 工程侧 | P1-6 工作区级插件目录（~1 人日，非破坏性扩展）· `main.ts` 第三刀外提（候选：`init()` 余下的启动编排，余量已回健康区间）· `env_cmds.rs` 冻结线维持（只减不增，见 `ci/budgets.toml`） |

### 评估期（原阶段四）

回头看阶段二/三的真实使用率，决定：A6 / C 类是否修订裁决、P2-1 UI 批 6+ 是否开工、D 类是否启动。**B1（pytest）已于 2026-10-16 修订裁决并立项**（`docs/pytest_dev_plan.md`），不再属本评估范围。**依赖 P1-1 的埋点**——该条至今 0 进展，若开工前仍未做，评估将无数据可用，需降级为"人工回忆式评审"。**没有使用数据的功能等于没有交付。**

### 待外部事件（不占泳道）

| 事项 | 触发条件 |
|---|---|
| CI 首次跑通证据 | 迁移到 GitHub 后首次 push 的 Actions run 记录 |
| trace 样本达复核门槛 | 跨项目累计 ≥1000 条函数观测（日常自然累积） |
| TD-025 六条复审 | 对外分发拍板后逐条过 |

> **口径纪律（永久）**：对外叙事里"比 PyCharm 更准"是不可写的（`CONTENT-SERIES.md:192`），可写的只有"在我们的样例集上 23/23"这类**自证**口径。

---

## 6. 双约束：维护成本 + 性能与体积

> **⚠ 本章标题与论据在 2026-10-05 已过期**：原章名「单人项目最大的长期风险」以「单人自用」定位为论据。ADR-0010 废止该定位后，本章为**两条并列的长期约束**。历史论据的失效清单登记在 `docs/tech-debt.md` **TD-025**（6 条）——**读 v1.2 及更早的文档时须记住「论据过期 ≠ 结论错误」**。

**约束 A · 维护成本**：约 93.8K 行代码 + 40+ 篇文档 + 197 个命令的现实下，三条对策（每条对应上文一个可执行项）：

1. **降低"知道项目在哪"的成本**：`docs/delivery-overview.md`（新会话唯一入口，持续维护至 v1.20）是杠杆最高的一项——它同时服务未来的自己和任何接手的会话；
2. **降低"改坏不知道"的成本**：PR 门禁（tsc / vitest / e2e-ui / budget-check）+ 真机层（11 个脚本，已绑发布前验收 `build-release.ps1 -Verify`，2026-10-07 起有全绿基线）。⏳ 剩余：nightly 只告警不阻断且无通知渠道（TD-025 第 1 条）；CI 无宿主（待外部事件）；
3. **降低"升级不敢动"的成本**：`ci/versions.toml` 已锁定 9 类依赖；⏳ 「每月一次依赖升级演练」仍未固化为例行 job（原议挂 nightly，随宿主问题一并外置）。

**约束 B · 性能与体积（ADR-0010 新增，一等目标）**：

| 条款 | 现状 | 缺口 |
|---|---|---|
| 预算先行（`ci/budgets.toml`） | ✅ **全 PASS**（项数随交付增长；B4/B5/A1/A5①/A4 各自拆文件并设上限，intel crate 与 `http.ts` 也已纳入）；**已并入 `ci.yml` test job**，破预算在 PR 阶段即红；产物体积项带 dist 新鲜度 STALE 判定 | 已关闭 |
| 运行时开销红线（probe < 1.5x） | ⚠ **单一倍率不可比**：同代码跨负载形状实测 **1.17x~2.48x**（官方 harness 单次读数还有 ±0.1x 抖动）；归因：静音节流藏起近 1x、全局 PY_START 常驻 ≈0.39x、类型观测 ≈0.26x（`bench/reports/probe-overhead-caliber.md`） | **待裁决**：多形状矩阵口径 / 只锁单形状 / 启动 baseline 优化 / 显式 PR 抬阈值。**在此之前，任何落在默认采集路径上的新增开销都不可接受** |
| 冷启动 < 1.5s / 空闲内存 ≤ 600MB | ✅ **基线已落盘** `bench/reports/metrics-20261006-091652.md`：冷启动 **956 ms** / 内存 **339 MB**，双红线 PASS（run1 2619ms 为冷缓存首跑，run2/3 = 117/132ms） | CI 侧对照待外部事件；**对比后续实测应剔除冷缓存首跑** |

**两条约束的交汇点在于：新增功能是同时加重两者的唯一动作。** B6（Mermaid）是因约束 B 被否决的第一个清单内功能——新方向确实进入了决策；下一步要让它同样进入"默认不做"的默认态。

---

## 7. 明确不做（维持现有裁决）

按强度分三档：**不做**（明列裁决）· **推迟**（已裁决但可复议）· **登记不排期**（契合度低，出现明确场景再议）。

| 不做 | 强度 | 理由 |
|---|---|---|
| pytest 独立结果面板 / 断言差异对比窗 / 覆盖率 / watch | 不做（2026-10-16 分层裁决后维持的部分） | 测试运行器本体已立项（B1，`docs/pytest_dev_plan.md`）；面板形态与覆盖率（F-3）维持不做 |
| AI 能力 | 不做（dev_plan §1.1 明列） | 若要推翻须先修订定位裁决（见 C 类） |
| 插件市场 / 模板市场 | 不做 | 无收益，运营成本不成比例 |
| 协作编辑 | 不做 | 与单用户 Python IDE 定位无关 |
| 替换 Pyrefly 为第三方语言服务 | 不做 | 铁律：第三方只补充不替换 |
| 往代码区加装饰（圆角/阴影/渐变/毛玻璃） | 不做 | 视觉报告 §7：装饰占观感权重仅 4%，且在 IDE 语境有害 |
| 引入第三种色系（如"AI 紫"） | 不做 | 同上，色系越多越难看；单色相轴已由 ADR-0005 锁定 |
| 增加字号档位 | 不做 | UI-18 已从 12 档收敛到 6 档（再未新增），再加是倒退 |
| **Markdown 大纲 / Mermaid 图表预览** | **不做（2026-10-06 新裁决）** | B6 终止裁定（`toolbox_dev_plan.md` §7.7）：属锦上添花，且 Mermaid 是唯一引入新依赖（2~3 MB min）+ 唯一带未验证项（CSP 无 `unsafe-eval`）的一项，与 ADR-0010 体积条款直接冲突。**不得再排期，重启须另立议题** |
| **任何突破 `ci/budgets.toml` 的功能** | **不做（ADR-0010 通用否决依据）** | 「体积与内存是卖点不是技术细节」：突破预算的功能要么换做法，要么不立项，**不允许"先上线再优化"**。静默抬阈值同样被禁止——抬阈值必须显式 PR 并写清理由 |
| 破坏六段 sortText 契约的补全来源 | 不做 | 补全排序是用户体感核心，任何新来源必须明确钉段 |
| 远程 / WSL / SSH 开发 | 登记不排期 | 成本高，与 Windows 单机画像契合度低 |
| 多语言支持 | 推迟（已裁决推迟） | 会稀释 Python 专用定位 |
| 硬沙箱插件（iframe/Worker）/ Python 工具桥 | 推迟 | 成本高，且**增加常驻开销与产物体积**（与 ADR-0010 冲突）；工作区级插件目录已足够（TD-025 第 5 条） |

---

## 8. 待补充 / 本报告未覆盖

- ⏳ **probe/intel 样本量未达复核门槛**：跨 3 个真实项目累计 **497 条函数观测**（742 B/条；hits p50 2 / p99 121），距「≥1000 条」差一半。**已裁定不再专门采样**（本机采样源触顶），改为日常 IDE 使用自然累积；`STALE_HITS_DIVISOR` 维持 2。附带口径：**stale 在真实项目采样里恒为 0%**（采样期不编辑文件），降权的真实证据仍只有 2026-10-03 的合成实验（编辑后部分运行 → 30%）。hits 被静音截断在 200 的缺陷已于 2026-10-07 修复（静音只清 `PY_RETURN`、保留 `PY_START` 计 hits）。
- ⏳ **真机层的"告警没人看"问题**：nightly 只告警不阻断，护栏依赖人主动看 artifact。彻底解法是接通知渠道（Windows 通知 / 邮件），未做。原论据"自用项目没人盯 CI"已随 ADR-0010 废止，复审登记为 TD-025 第 1 条——若产品走向对外分发，它不再是"可选优化"而是分发可信度问题。
- ⏳ **soak 长跑**：`collect-metrics.ps1 -SoakMinutes 10` 至今 SKIP，建议随 nightly 首跑一起补。
- ⏳ **出包环境的两个易复发点**（已修但值得记住）：① VS Build Tools **必须管理员安装**，否则实例不入注册表、`vswhere` 查不到，cargo/cc 会静默回落 VS2015；② PowerShell 的 `$ErrorActionPreference="Stop"` 会把 cargo 的 stderr 进度行当致命错误（`build-release.ps1` 已用 `Invoke-Native` 兜住）。另：安装包 `/S` 静默安装在本机无效，验收需走"安装后程序 + CDP"。
- ⏳ **对外分发策划待拍板**：根目录 `CONTENT-SERIES.md`（v1.0 · 2026-10-04，《造 IDE 的 45 天》十篇连载，公众号 + 视频号）状态为"待你拍板"，**不在 `docs/` 下，未被任何交付文档引用**。若拍板对外发布，会连锁抬高 TD-025 第 1/2 条（告警通知 / 更新通道）与性能基线需求——**建议先给个结论，否则后续排期会在"自用"与"对外"两套标准之间反复横跳**。

---

## 9. 取数方法与复核触发条件

本报告是**快照文档**，且已三次证明会过期（v1.0 基线 20 个提交内 3 处失效结论 · v1.1 自己的数字就是错的 · v1.2 把"配置写好了"记成了"能力已交付"）。**取数口径从"文档里的命令"变成"仓库里的代码"**（`repo-stats.mjs` / `budget-check.mjs`），并且：**交付与否以证据文件是否存在为准，配置/清单就位 ≠ 已交付。**

| 动作 | 命令 |
|---|---|
| **本文所有规模数字（一次拿全）** | **`node tools/stats/repo-stats.mjs`**（`--no-write` 只打印） |
| 规模预算断言（超限非零退出） | `node shell/scripts/budget-check.mjs`（`--report` 只打印 / `--no-write` 不落盘） |
| **产物体积断言前必须先构建** | `cd shell && npm run build`（否则 `dist/` 陈旧 → 体积项可能误报 ±2 MB，见禁则 4） |
| 确认取数时点 | `git rev-parse --short HEAD`（§1.1 数字对应 **`bb32d77`**，§1.4 对应 2026-10-10 口径） |
| 性能红线实测（冷启动 / 内存） | `powershell -File bench\collect-metrics.ps1 -Runs 3`（基线 `bench/reports/metrics-20261006-091652.md`：956 ms / 339 MB；⚠ run1 为冷缓存首跑，对比看中位） |
| **确认 CI 宿主（跑本节任何 CI 命令之前）** | `git remote -v` —— **无 GitHub 远端则 GitHub Actions 不会执行**（本仓当前只有 Gitee，见取数禁则 5） |
| 门禁 | `node shell/scripts/gate-tests.mjs unit\|e2e\|e2e-ui`（**不要直接跑 `vitest`**，本机会被判为 watch 并杀进程） |
| token 门禁 | `python tools\ui\audit_tokens.py`（98 项检查，退出码非 0 即失败） |
| trace 库统计（Gate D 调参） | `python tools/intel/trace_stats.py`（只读；`--out <报告>`） |
| Gate D 人工对标工作单 | `set OC_GATE_D_WORKLIST=<路径>` + `cargo test -p opencharm-intel -- --nocapture runtime_completion_accuracy`（第一格已撤下，工作单转存档；换对照组时结论须改写为"对 X"） |
| 真机层（本机一键全量） | `powershell -File shell\e2e-real\run-real-all.ps1`（串行；`-Only` / `-Skip` / `-Strict`；发布前用 `-PreRelease -Strict`） |
| 真机层（单套件） | `cd shell && set "OC_JSON_OUT=<路径>" && node e2e-real\<name>.cjs` |

### ⚠ 取数禁则

1. **禁止用 `Get-Content $f`（不带 `-Encoding`）统计行数。** 本机 PS 5.1 的 ANSI 代码页是 **gb2312**；对**无 BOM 的 UTF-8 源文件**它会按 GBK 解码并**吞掉换行**——实测 `style.css` 报 5,410（真实 5,668，少 4.5%）、`main.ts` 报 2,503（真实 2,897，少 13%）。丢失比例随 CJK 密度而变、**逐文件不同**，所以这批数字"看起来合理但系统性偏低"，极难自查。
   正确写法任选其一（三者对同一文件必然同值）：`Get-Content -Encoding UTF8 $f` · `[System.IO.File]::ReadAllLines($abs)` · `node -e "..."`（按 `\r?\n` 切分）。
2. **禁止用 `Measure-Object -Line`。** 它不计空行（`style.css` 上给 5,145，比真实值少 523）。
3. **含中文的 `.ps1` 必须带 UTF-8 BOM。** 否则同样被 GBK 解码成乱码并**直接语法报错**（不是静默出错，是脚本跑不起来）。仓库既有约定：`bench/collect-metrics.ps1` 是唯一含中文的 `.ps1`，它就带 BOM。`budget-check.mjs` 已把这条做成门禁。
4. **跑产物体积断言前必须确认 `dist/` 是新的。** `budget-check.mjs` 的体积项数的是 `shell/dist/assets` 下 `.js + .css` 的字节和；`dist/` 陈旧时会把**已删除的依赖分包**继续算进去。实测：陈旧 dist 报 **7,065 KB（FAIL）**，`npm run build` 后 **4,988 KB（PASS）**——差额约 2.08 MB 全是**已被取消的 mermaid/katex 分包**。**这是与禁则 1 同类的"看起来合理但系统性错误"**：它不会报错，只会给出一个偏大的数字。修法已落地：脚本内置 dist 新鲜度校验，源码比 dist 新时判 **STALE**（不算 PASS、断言模式非零退出）。
5. **不要把"仓库里有 workflow"当作"CI 在跑"。** 判定 CI 是否成立必须**先确认宿主**：`git remote -v` 里有没有 GitHub 远端（Gitee / 自建 GitLab **不执行** `.github/workflows/`）。**顺序：先查宿主 → 再看配置 → 最后才谈证据。**
6. **不要把"配置/清单就位"记成"已交付"。** 判定交付以**证据文件是否存在**为准：CI 是否真的触发过 → 看 Actions run 与 `bench/reports/metrics-*.md` / `budget-*.md`；Gate D 是否推进 → 看工作单的 PyCharm 列是否被勾、降权常量是否被改；缺陷是否修 → 看代码行。
7. **i18n 的 `data/html_dict.json` 是"冻结快照"，禁止随手重跑 `extract_html.py`。** 该脚本会按当前 `index.html` 重建整份词条表，而 `index.html` 长期是超前于它的（词条已在 `manual_zh.json` 里登记过）——实测重跑产出 **18 条与 `manual_zh.json` 重复的 key + 21 条缺英文**，`gen_locales.py` 直接 `exit 1`。要改词条请**直接改 `html_dict.json` / `manual_zh.json`**。**同族的坑：`extract_html.py` / `gen_locales.py` 原先都以文本模式写文件**，在 Windows 上把产物整体 CRLF 化。**凡生成器写文件一律 `open(..., newline="")`。** 另：生成器不产出注释，手改生成文件的注释会在下次重生成时静默丢失——`gen_locales.py` 已加 `PINS_ZH` / `PINS_EN` 锚点登记，新增此类注释请登记进去而不是手改产物。

**治理规则（v1.5 起常驻，替代原 P0-4 的二选一截止）**：任何"连续两版零进展"的条目，按二选一截止处理——**要么排期做，要么显式撤下并接受现状**；不允许第三种状态（挂着不动）。本报告的 P0 档即按此规则全部关闭。

**复核触发条件**（满足任一即需重取数字并更新本文头部「取数时点」）：① HEAD 变动 ≥ 10 个提交；② 任一专项验收收口（debug / db / ui / run / toolbox）；③ 季度评审；④ 任何专项 `*_dev_plan.md` 状态从"未开工"转"已交付"；⑤ **定位 / 铁律 / 预算发生任何变更**（如 ADR-0010 这类会改变评判坐标系的事件，**优先级高于 ①~④**）。**重取一律走 `tools/stats/repo-stats.mjs` + `budget-check.mjs`，不要手敲命令。**

---

## 附：本报告引用的关键文档

| 文档 | 用途 |
|---|---|
| **`docs/adr/0010-performance-lightweight-charter.md`** | **定位真源**：性能与体积升为一等目标；数值维持现值不动、历史「自用」论据不逐个复审（→ TD-025）。本文 §0 / §6 / §7 的重排依据 |
| **`docs/delivery-overview.md`** v1.20 | **交付总览（新会话唯一入口）**：全部已交付功能域 × 交付日期 × 计划真源 × 验收记录 × 状态 + 文档地图 + 已知文档不一致登记。**本文件已删除条目的记录都在这里** |
| **`docs/toolbox_dev_plan.md`** v1.5 | 工具箱真源：§5.9–5.11 B4 HTTP 工具 · §6.10–6.12 B5 运行日志 · §7.7 B6 终止裁决 · A5③④ 留档 |
| `CONTENT-SERIES.md`（仓库根目录，不在 `docs/`） | 连载发布建议 v1.0（2026-10-04，公众号 + 视频号，十篇主线），状态「待拍板」。**拍板对外分发会连锁抬高 TD-025 第 1/2 条与性能基线需求** |
| `docs/python_ide_dev_plan_v2.md` §1.1 / §1.2.1 / §7 | 目标与不做清单（**pytest 已于 v2.2 修订为分层裁决**；AI 等仍不做）· §1.2.1「性能与轻量：一等目标」四条约束与现状基线 · Phase 4 状态表 |
| `docs/ui_premium_dev_plan.md` / `docs/ui_premium_design_report.md` v1.2 | P2-1 的执行真源与论证（§6 批次入口 / §4 门禁） |
| `docs/sqlite_tool_dev_plan.md` v1.5 | B3 唯一真源（§17 交互方案 / §17.7 真机验收 18/18） |
| `bench/reports/gate-d-runtime-completion.md` | Gate D 确定性口径 base 数值（23/23）与两格的定义 |
| `bench/reports/gate-d-ab-worklist.md` | ❌ **第一格已撤下转存档（2026-10-07）**（OpenCharm 列已填好，PyCharm 列 23 行仍全为 `☐`；将来换对照组可复用，但结论须改写为"对 X"） |
| `bench/reports/trace-stats-cumulative.md` + `bench/reports/trace-sample-threshold.md` | P0-2 第二格的当前样本（3 项目 / 497 条函数观测）与门槛口径 / 收口处置 |
| `docs/tech-debt.md` | 债务明细：待处理 TD-021② / TD-022 / TD-024 / **TD-025**（「自用」论据失效复审清单，6 条） |
| `docs/e2e_divergence_ledger.md` | 真机才暴露的集成缺陷台账（门禁价值的论据） |
| `docs/dx_features_backlog.md` | 已完成清单，避免重复立项 |
| `docs/pycharm_ux_review_and_proposal.md:393` | F-1 裁决沿革（2026-09-25 维持非目标 → **2026-10-16 重新裁决：做测试运行器**）；B1 的现行裁决入口 |
| `docs/python_library_support_research.md` §8 | B1 的边界依据沿革（原「不做测试发现/结果树」已于 2026-10-16 作废，改为分层口径） |
| `docs/plugin_system_design.md` §10 | P1-6 / D 类的待决策点 |
| `intel/README.md` | P3-T10 两格已关闭（第一格 ❌ 撤下 / 第二格 ✅ 已采收口）；「trace 库保留窗口」一行仍是建议值未落代码 |
| `docs/debug_acceptance_record.md` / `docs/run_acceptance_record.md` | 调试 / 运行人工验收清单（均已收口） |
| `ci/budgets.toml` + `shell/scripts/budget-check.mjs` | 预算真源与断言脚本（持续全 PASS；已并入 `ci.yml` test job） |
| `.github/workflows/ci.yml` / `nightly.yml` | 门禁配置证据——**⚠ 无宿主**：本仓远端只有 Gitee，Actions 不执行（§9 禁则 5） |

---

## 附二：存档索引 —— 已实现 / 已关闭条目（v1.5 清理时移出）

> **本表不是清单，不含任何建议或方案内容**，唯一用途是**解析历史引用**：外部文档与代码注释里按编号的引用（如 `§3 A4`、`§2 P1-4`、`§2 P0-2`、`续记 ㉓`）按本表解析到记录真源。这些条目的交付细节（范围裁决、实证调整、门禁数字）以真源文档为准。

| 编号 | 条目 | 结局 | 记录真源 |
|---|---|---|---|
| P0-0 | 预算回绿 + 产物体积 dist 新鲜度 | ✅ 已关闭（2026-10-06） | `ci/budgets.toml` + `shell/scripts/budget-check.mjs`；`delivery-overview.md` §4 |
| P0-1 | 质量门禁闭环（7 子项） | ✅ 配置全交付；CI 落点裁决"维持现状 + 文档标注"，宿主问题外置 | `.github/workflows/`；§0 事项 1 |
| P0-2 | Gate D 两格（PyCharm 对标 / 真实项目样本） | ✅ 第一格按 v1.4 死线撤下（2026-10-07）· 第二格收口改自然累积 | `delivery-overview.md` v1.14；README「已知边界」；`trace-sample-threshold.md` |
| P0-3 | D-6 / D-7 / D-8 三缺陷 + 验收尾账 | ✅ 全部修复并复核 | `delivery-overview.md` §2；`debug_acceptance_record.md` §5.2；`sqlite_tool_dev_plan.md` §17.8 |
| P0-4 | `env_cmds.rs` 拆分 | ✅ 裁决折中（冻结线 + 长期上限）并于 2026-10-07 拆四文件 | `ci/budgets.toml`；`delivery-overview.md` §1 |
| P1-3 | 性能与体积预算制度化 | ✅ 已落地（含并入 `ci.yml` test job） | `ci/budgets.toml` + `budget-check.mjs` |
| P1-4 | 真机 e2e 补齐关键路径 | ✅ 整项不立项；B4 HTTP 一刀已交付；全绿基线已出 | `delivery-overview.md` v1.15~v1.17；`shell/e2e-real/` |
| P1-5 | TD-021 五小项 | ✅ ①③④⑤ 已修；② 裁决不处理 | `delivery-overview.md` v1.10~v1.12；`docs/tech-debt.md` |
| P2-2 | 多窗口阶段 1/2 复核与收口 | ✅ 已关闭（2026-10-03） | `multi_window_dev_plan.md` v0.2 |
| A1 | 运行时热点视图 | ✅ 已交付（2026-10-06） | `delivery-overview.md` §2 第 24 行；`e2e/ux/06-runtime-hotspots.spec.ts` |
| A2 | 轻量内置 Profiler | ✅ 已交付并收口（2026-10-07） | `docs/profiler_acceptance_record.md`；`runtime_profiler_dev_plan.md` v0.7 |
| A3 | trace 驱动的签名补全与默认值提示 | ✅ ①+②+③ 已交付；④ 已覆盖不立项（pyrefly `callArgumentNames`） | `delivery-overview.md` §2 第 26 / 28 行 |
| A4 | 爬虫场景工具箱 | ✅ ①+③ 已交付；② 请求回放 / Python 引擎不立项 | `delivery-overview.md` §2 第 27 行；`toolbox_dev_plan.md` |
| A5 | FastAPI 路由面板增强 | ✅ ①~④ 全部交付（2026-10-06~07） | `delivery-overview.md` §2 第 25 / 30 行 |
| B3 | SQLite 工具 | ✅ 已交付 v1.4（真机 18/18） | `sqlite_tool_dev_plan.md` v1.5 §17 |
| B4 | HTTP Client | ✅ 已交付（devtools 面板形态，非 `.http` 文件） | `toolbox_dev_plan.md` §5.9–5.11 |
| B5 | 日志/输出结构化视图 | ✅ 已交付 | `toolbox_dev_plan.md` §6.10–6.12 |
| B6 | TODO/任务与文档工具 | ❌ 终止（保留 TODO 增强，取消大纲与 Mermaid） | `toolbox_dev_plan.md` §7.7 |
