# OpenCharm 交付总览（Delivery Overview）

> 版本：**v1.6** · 日期：2026-10-06 · 状态：**现行** · 取数依据：A3③ 提交 `49f8ca6`（`master`）
> **v1.6 修订（2026-10-06，同日稍后）**：① §2 补录 **A3③ intel 签名帮助（`textDocument/signatureHelp`，第 28 行）**；② §1 数字刷新：Rust **379 → 391**（外壳 319 不变 + **intel 60 → 72**，A3③ 新增 12 例签名帮助单测）· 预算 **三十一项 → 三十三项**（新增 `intel/…/signature.rs` / `intel/…/server.rs` 两个上限）· 前端用例 1271/101 **不变**（A3③ 为 intel + provider 路由改动，未新增前端单测）· 命令 196 **不变** · 产物 5,032 KB **不变** · e2e `e2e/lsp` 由 17 → **18** 条（签名帮助此前零覆盖，本轮补 1 例）；③ §4 新登记第 18 条（**A4 新增的 `.sel-item:focus-visible` 用了裸 box-shadow** → `audit_tokens.py` 第 87 项 FAIL，已改 outline 同口径并复跑 0 FAIL；同时**纠正 A4 门禁记录里「98 项 0 FAIL」与实测不符**的一条）；④ §1「下一步」改为 A3③ 已交付、**A2 / A3④ / A4② / A4-Py** 为下一候选；⑤ **A4 轮次那例外壳 `cargo test` 环境故障（`stdin_utf8_roundtrip_with_real_python`，Windows `os error 231`）本轮复跑未再出现**（319 passed / 0 failed），印证「会话沙箱环境问题」的判定。
> **v1.5 修订（2026-10-06，同日稍后）**：① §2 补录 **A4 爬虫工具箱 ①+③（选择器测试器 + HTTP 响应→模型桥，第 27 行）**；② §1 数字刷新：前端 **1240/100 → 1271/101**（A4 新增 `selectorCore.test.ts` **31 例**）· 预算 **二十七项 → 三十一项**（新增 `selectorCore.ts` / `selector.ts` / `styles/selector.css` 三个上限，并**首次纳入 `http.ts`**）· 产物 5,013 → **5,032 KB** · e2e spec **70 → 71**（含 `_probe/`，不含则 70）· Rust **379 不变**（A4 为纯前端交付，无 Rust 改动）· 命令 196 **不变**；③ §4 无新增（A4 未发现文档不一致）；④ §1「下一步」改为 A4 已交付、**A3③④ / A4② / A2** 为下一候选。
> **v1.4 修订（2026-10-06，同日稍后）**：① §2 补录 **A3 调用实参补全 + hover 观测签名（第 26 行）**；② §1 数字刷新：Rust **364 → 379**（外壳 319 不变 + **intel 45 → 60**）· 预算 **二十五项 → 二十七项**（首次纳入 intel crate 两个文件：`completion.rs` / `hover.rs`）· 前端用例 1240/100 **不变**（A3 是 Rust 侧功能，未新增前端测试）· 命令 196 **不变** · 产物 5,013 KB **不变**；③ §4 新登记第 17 条（`trace.rs` 的 `ORDER BY fid` 在 fid 相同时不保序，会打乱参数位顺序——A3① 依赖该顺序，已修）；④ §1「下一步」改为 A3 已交付、A4 / A3③④ 为下一候选。
> **v1.3 修订（2026-10-06，同日稍后）**：① §2 补录 **A5① 端点请求样例**（第 25 行）；② §1 数字刷新：命令 **195 → 196** · 用例 **1223/99 → 1240/100** · Rust **355 → 364**（外壳 319 + intel 45）· 预算 **二十项 → 二十五项**（新增 4 个上限 + **首次纳入 `endpointView.ts`**）· `style.css` 5,749 → **5,750** · 产物 4,999 → **5,013 KB**；③ §4 新登记第 15 / 16 条（`openHttpTool` 传裸工具 id、http 面板两个 textarea 同类名，均已修）；④ §1「下一步」改为 A5① 已交付、A3 / A4 为下一候选。
> **v1.2 修订（2026-10-06，同日稍后）**：① §2 补录 **A1 运行时热点视图**（阶段二差异化泳道首件，v1.1 之后唯一新增功能域）；② §1 数字刷新：命令 **194 → 195** · 用例 **1215/98 → 1223/99** · 预算 **十七项 → 二十项**（新增 `hotspotsView.ts` / `styles/hotspots.css` / `intel_cmds.rs` 三个上限）· `main.ts` 2,094 → **2,099** · 产物 4,990 → **4,999 KB** · e2e spec 69 → **70**；③ §4 新登记第 14 条（i18n 生成链的字体默认值漂移 + CRLF 污染，已修）；④ §5 补"`budget-check` 断言前必须先 `npm run build`"的既有纪律。
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
| 规模 | 约 93.8K 行自研代码 · **196** 个 Tauri 命令 · 39 篇 `docs/*.md` + 8 篇 ADR |
| 质量底座 | 前端 **1271 用例 / 101 文件** · Rust **391 测试通过**（外壳 319 通过 = 321 个 `#[test]` − 2 `#[ignore]`；intel **72** = 59 + 6 + 7）· probe 81 pytest · e2e **71 spec（含 `_probe/`）/ 70（mock 层）** + 10 个真机脚本（**手动**） |
| 预算 / 性能 | **`ci/budgets.toml` 三十三项全 PASS**（= 30 项文件行数上限 + 命令数 + 产物体积 + `.ps1` 编码卫生；`style.css` 5,751/5,850 · `main.ts` **2,099/2,400**（阶段二两刀共 −825 行）· 产物 5,032/5,120 KB · 命令 196/200）；性能基线已落盘 `bench/reports/metrics-20261006-091652.md`（冷启动 956 ms · 内存 339 MB） |
| 版本锁定 | `ci/versions.toml` 锁 9 类依赖 |
| 尚未闭环 | ① **CI 无宿主（已裁决维持现状）**：远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions → 两份 workflow 是「将来推 GitHub 的预埋」，**首次跑通证据外置到迁移时验**（§4 第 13 条）② **Gate D 第一格 ⛔ 外部阻塞**：PyCharm 人工对标 23 点——**本机已无 PyCharm（2026-10-06 确认）**，死线 v1.4，届时未做则撤下并在 README 声明"未做横向对比"（**在此之前对外不得写"比 PyCharm 更准"**）；第二格 ✅ 已取得真实项目样本 277 条 / 覆盖率 79% ③ **SQLite v1.4 Tab 化真机手测 + 双主题截图**（§17.7）④ 依赖升级回归无自动化 ⑤ 真机 e2e 不进自动调度（10 个脚本手动，`nightly.yml` 已编排但同 ① 无宿主） |
| 下一步 | 见 `docs/improvement_and_roadmap_report.md` **v1.3**（P0-0 / P0-3 已关闭 · P0-1 已裁决为"维持现状" · P0-4 已裁决为冻结线 · **P0-2 第一格外部阻塞 / 第二格已采**）→ **阶段一收口，阶段二进行中**：差异化泳道 **A1 · A5①（请求样例 + 一键 curl）· A3①+②（调用实参补全 + hover 观测签名）· A4①+③（选择器测试器 + 响应→模型桥）· A3③（intel 签名帮助）均已交付**，下一候选 **A2**（内置 Profiler，★4 但需重定开销预算 + 新增默认关的"性能模式"开关）· 次选 **A3④**（调用处参数名 inlay hint，★1，做前先看是否已被 pyrefly 的 `callArgumentNames` 覆盖）· **A4②**（请求回放）· **A4-Py**（选择器 Python 引擎口径校验）——均已降级登记；基本功泳道 `main.ts` 外提两刀已完成（余量 301 行），第三刀为候选 |

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
| 24 | **运行时热点视图（A1）** | **2026-10-06** | `improvement_and_roadmap_report.md` **v1.3** §A 类 A1（**无独立专项计划**：方案即报告该行 + 本文件 §2） | `intel_cmds` 6/6 · `hotspotsView.test.ts` 8/8 · `e2e/ux/06-runtime-hotspots.spec.ts` 8/8（HS-1~HS-8） | ✅ 第 8 个侧栏视图：probe trace 库 × 项目 `def` 差集 → 「已观测（按 hits 降序，带 stale / 异常徽章）」+「未观测到运行」。⚠ **口径**：下半区**不是**死代码断言（可能原因含未覆盖 / 分支未走 / 采样遗漏 / 进程外调用），文案已显式否认并由 e2e HS-4 钉住 |
| 25 | **端点请求样例（A5①）** | **2026-10-06** | `improvement_and_roadmap_report.md` **v1.3** §A 类 A5（范围裁决见 §续记 ⑬：只做 ①请求样例 + ②一键 curl） | `ep_sample_cmds` 9/9 · `epSample.test.ts` 17/17 · `e2e/ux/02-frameworks.spec.ts` EP-S1~S5 | ✅ 端点行第 3 个动作（`beaker`）→ 行内展开：参数表（path / query / header / cookie / body / skip 分类）/ 请求体 JSON（Pydantic 模型展开，`alias` 生效）/ cURL（复制 + 送进 B4 HTTP 工具，预填方法 / 请求体）。⚠ **口径**：静态推断，**识别不到就明说**——Flask 的 query / body 来自 `request` 对象故不推断、未识别类型填 `null` 不猜值、依赖注入与框架对象跳过并给原因。③反向跳转 / ④OpenAPI 预览本轮未做 |
| 26 | **A3 调用实参补全 + hover 观测签名** | **2026-10-06** | `intel/README.md`（新增 **P3-T11** 节，方案即该节 + 本行）· `improvement_and_roadmap_report.md` §A 类 A3（范围裁决见续记 ⑭：只做 ①+②） | intel crate **47 单测**（新增 14：参数补全 10 + hover 4）· `opencharm-intel-index` 7（新增 1：参数位顺序）· e2e **全量 340/340**（shell `client.ts` 触发字符改动无回归） | ✅ **① 调用实参补全**：`foo(|` / `foo(a, |` → `arg_types` 参数位观测给出参数名候选（insertText `name=`，detail 带观测类型 ×证据数）；已写 keyword 排除、位置参数按参数位顺序前跳、类构造回落 `Cls.__init__`。**② hover 观测签名**：函数 hover 增「签名（观测）」行 + 每条参数观测附 shape 派生的常见键 / 常见属性。⚠ **口径**：probe **绝不 repr 值本身**，故只能展示结构（键 / 属性名），**不存在"实际见过的字面取值"**——文案写「常见键 / 常见属性」而非「常见值」。③签名弹窗 / ④调用处 inlay hint 本轮未做 |
| 27 | **A4 爬虫工具箱 ①+③（选择器测试器 + HTTP 响应→模型桥）** | **2026-10-06** | `improvement_and_roadmap_report.md` **v1.3** §A 类 A4（**无独立专项计划**：范围裁决见续记 ⑮，只做 ①+③） | `selectorCore.test.ts` **31/31** · `e2e/tools/01-selector.spec.ts` **10/10**（SEL-1~SEL-10） | ✅ 新 devtools 内置工具「选择器测试」（`selectorCore.ts` 零 app 依赖求值层 + `selector.ts` 面板）+ HTTP 响应工具栏两座桥。**① 选择器测试器**：输入 HTML（粘贴 / 从编辑器导入 / 接收 HTTP 响应）+ CSS/XPath 自动判别 → 命中列表（标签 / id / class / 命中下标 / 路径 / 文本摘要）+ 结构预览（DOMPurify 消毒后注入，可点选）。**③ 响应→模型桥**：B4 HTTP 响应一键送进已有 `json2model`（本体早已交付，本轮只补桥）。⚠ **口径**：① 求值在**前端浏览器 DOM**（`DOMParser` + `querySelectorAll` / `document.evaluate`），**不走 `libEval` 求值桥**——与 lxml / bs4 有解析口径差异，面板**常驻一行口径说明**（`devtools.sel.engineNote`，由 e2e SEL-9 钉住不得删）；② 结构预览**不是页面渲染效果**（CSP 无 `frame-src` 不能嵌 iframe，`<style>` 已剥防重排 IDE）。② 请求回放 / Python 侧引擎本轮未做 |
| 28 | **A3③ intel 签名帮助（`textDocument/signatureHelp`）** | **2026-10-06** | `intel/README.md`（新增 **P3-T12** 节，方案即该节 + 本行）· `improvement_and_roadmap_report.md` §A 类 A3（范围见续记 ⑯） | intel crate **59 单测**（新增 12：签名帮助）· `opencharm-intel-index` 7 不变 · e2e `e2e/lsp` **18/18**（新增 1 例，钉住**回落静态引擎**这条路径） | ✅ `(` / `,` 触发 → 弹出该函数的**观测签名**（`parse_page(url: str, timeout: int, retries: int)`）并高亮**当前参数位**。**关键实现选择：与 A3① 共用一份上下文解析**——`call_frame_at` / `written_args` / `resolve_callee` / `param_observations` 从 `completion.rs` 提为 `pub(crate)` 复用，`signature.rs` 只做「合成签名 + 算当前参数位 + 出说明」⇒ **弹窗高亮的参数位与补全首推的候选必然一致**。只给一条签名（与 A3① 同口径取唯一实现，Python 无重载）；参数填满时钳到末位。shell 侧 `provideSignatureHelp` 由「只问静态」改为**intel 优先、回落 static**。⚠ **口径**：签名**不含默认值**（trace 不记），说明文本已显式声明（单测 `signature_doc_states_no_defaults` 钉住）；参数说明仍只给「常见键 / 常见属性」，shape 与「证据最高的类型」取自同一条观测。⚠ **已知边界**：与补全 / hover 共享 `engineStatus === "ready"` 门控（既有设计，非本项引入），静态引擎未就绪时整条 intel 链路不出结果；intel 分支在浏览器 mock e2e 下触达不到，已如实标注 |

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
| 11 | 用例基线仍写 **1070**（v1.2 数字），实测 **1215 / 98 文件** | `delivery-overview.md` §1 | ✅ 2026-10-06 已修（1214 → 1215 为 D-8 补的单测；后续 A1 再 +8 例 → 1223/99、A5① 再 +17 例 → **1240 / 100 文件**；`improvement_and_roadmap_report.md` §1.4 已同批刷新为 **100 / 1240**） |
| 12 | 产物体积实测仍写 **4,918 KB**（v1.1 基线），重新构建后为 **4,989 KB**；且该指标受 `dist/` 新鲜度影响 | `ci/budgets.toml:64` · `python_ide_dev_plan_v2.md` §1.2.1 | ✅ 2026-10-06 已修（budgets.toml 注释改 4,989 并加"陈旧 dist 会虚报"提示；`dev_plan_v2` §1.2.1 已同步）。**注**：该值随后续交付继续漂移（A1 → 4,999 · A5① → **5,013 KB**），`dev_plan_v2` §1.2.1 已同批更新为 5,013 |
| 13 | **CI 宿主错配**：远端只有 `gitee.com/usedel/opencharm`，**Gitee 不执行 GitHub Actions** → `.github/workflows/ci.yml` / `nightly.yml` 无论怎么改都不会跑，与「配置已交付」的记账相矛盾 | `.github/workflows/` · `improvement_and_roadmap_report.md` §2 P0-1 子项 7 | ✅ **已裁决（2026-10-06）：维持现状 + 文档标注**——.github/workflows/ 定位为「将来推 GitHub 的预埋」（配置零改动即可生效）。**余项转为外置触发条件：迁移到 GitHub 后首次 push 的 Actions run 记录（谁推谁验）**；在此之前缺口保持开启但不再消耗人力 |
| 14 | **i18n 生成链三处静默污染**（A1 顺带发现）：① `extract_html.py` / `gen_locales.py` 文本模式写文件 → Windows 上产物整体 CRLF 化（前者因此让「已标记」检测失效、全文件标记被重复插一遍）；② `gen_locales.py` 不产出注释 → 手改生成文件的 UI-31 / UI-32 注释每次重生成都静默丢失；③ `data/html_dict.json` 与 `data/en_2.json` 的字体预设默认值停留在批 3 之前，与 `index.html` / `state.ts` 真值不符且每次重生成把错值写回 `core.ts` | `shell/tools/i18n/{extract_html,gen_locales,common}.py` · `data/{html_dict,en_2}.json` · `src/i18n/locales/*/core.ts` | ✅ 2026-10-06 已修（`newline=""` 按 LF 落盘 · 新增 `PINS_ZH`/`PINS_EN` 锚点登记 · 按真值修正两份数据）。**附纪律：`html_dict.json` 是冻结快照，不可随意重跑 `extract_html.py`**（会产生 18 条重复 key + 21 条缺英文，`gen_locales.py` 直接 exit 1），已写入 `improvement_and_roadmap_report.md` §9 取数禁则 |
| 15 | **`openHttpTool` 传裸工具 id**（A5① 顺带发现）：内置工具的全局 id 是 `<pluginId>.<toolId>`（`dslLens.ts` / `jsonLiteral.ts` 都写全 id），而 `devtools/index.ts` 调的是 `openDevTools("http")` → `getDevTool` 返回 undefined → 静默回落到「最近使用」工具。**表现为「B4 PR-B4-3 的『端点 → HTTP 工具』联动从来没打开过 HTTP 工具」**，此前无 e2e 覆盖 | `shell/src/devtools/index.ts:28` | ✅ 2026-10-06 已修（改 `HTTP_TOOL_ID = "opencharm.builtin.http"` 并加注释说明回落陷阱）；由 e2e EP-S2 钉住 |
| 16 | **http 面板两个 textarea 同类名**（A5① 顺带发现）：请求体与「环境变量」都用 `kit.textarea` → 各 1 个 `.tool-textarea`，e2e 选择器不唯一 | `shell/src/devtools/builtin/http.ts` | ✅ 2026-10-06 已修（请求体补 `.http-body` 专用类，同 `.http-url` 既有约定） |
| 17 | **`arg_types` 加载顺序不确定**（A3① 顺带发现）：`trace.rs::load_args` 用 `ORDER BY fid`，而 SQLite 排序**不保证稳定**——同一函数的多条 `arg_types` 行会被打乱。probe 侧 `monitor._record_args` 按 `co_varnames`（**声明顺序**）逐参数位写入，故插入序 = 声明序，是该顺序的唯一依据；A3① 的「位置参数前跳」正依赖它。**实测确已乱序**（`url, timeout, retries` 读成 `retries` 打头） | `intel/crates/opencharm-intel-index/src/trace.rs::load_args` | ✅ 2026-10-06 已修（`ORDER BY fid` → `ORDER BY fid, rowid`，零额外代价：arg_types 无 fid 索引，排序本就发生）；由 `trace_test.rs::arg_observation_order_is_insertion_order` 钉住 |

| 18 | **A4 交付的 `.sel-item:focus-visible` 用了裸 box-shadow**（A3③ 轮次跑 `audit_tokens.py` 时检出）：`box-shadow: inset 0 0 0 1px var(--focus-ring)` 不引用任何阴影 token → 违反「阴影一律走 `--elev-*` / `--shadow`」纪律，审计第 87 项 **FAIL**。⚠ **A4 门禁记录写的「98 项 0 FAIL」与实测不符**——该 FAIL 在 A4 提交后即存在于 HEAD，本轮才被检出 | `shell/src/styles/selector.css:78` | ✅ 2026-10-06 已修（改 `outline: 1px solid var(--focus-ring); outline-offset: -1px`，与 `.todo-item` / `.db-tree-item` / `.db-conn-node` 同口径；**顺带更契合场景**——命中列表在滚动容器内，外扩环会被 `overflow` 裁掉）。复跑 `audit_tokens.py` 98 项 **0 FAIL** |

> **2026-10-06 收口**：10~12 三条已关闭；**第 13 条是本表唯一未闭环项，且它决定了 §0 缺口 1 能不能关**；第 14 条为 A1 交付时顺带发现的 i18n 生成链缺陷，第 15 / 16 条为 A5① 交付时顺带发现的两处静默失效，第 17 条为 A3① 交付时顺带发现的索引层顺序缺陷，**均已修并沉淀成取数禁则 / 注释 / 单测**。**A4 交付（同日）当时判定无新增，但第 18 条说明它其实漏掉了一处**——A4 唯一"意外发现"（CSS `.item` 按类列表匹配、XPath `@class='item'` 是精确串匹配，故 `class="item promo"` 前者命中后者不命中）属**领域事实**而非文档债务，已写进 e2e SEL-4 作现场证据。**教训：新 CSS 落地后必须复跑 `audit_tokens.py` 取实测值，不能沿用"本轮无新增 CSS 变更"的推论**（第 18 条正是 A4 新增 CSS 引入的）。新增不一致请就地登记在此表，**发现即登记，登记即修**。

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
| intel | 联调前必须 `cd intel && cargo build -p opencharm-intel`（**build 而非 test**——`cargo test` 只构建测试 harness，不刷新 shell 调用的 `.exe`）；单测 `cd intel && cargo test`（60 例 = 47 + 6 + 7） |
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
