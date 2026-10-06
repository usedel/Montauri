# OpenCharm 现状评估 · 改进建议与未来功能规划

> 版本：**v1.3** · 日期：2026-10-06 · 状态：**待评审**
> 性质：基于当前代码库与全部 `docs/` 文档的**现状评估 + 改进清单 + 未来功能候选池**，不是开发计划（不直接排期）。
> 与既有文档的关系：本文件是**全局视角的评估与选题**，落地时仍需回到各专项计划（`python_ide_dev_plan_v2.md` / 各 `*_dev_plan.md`）写 PR 级方案。冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
> **取数时点**：2026-10-06，git HEAD `bb32d77`（v1.2 基线 `ccf9da2` 之后 **23 个提交**）。所有数字由 **`node tools/stats/repo-stats.mjs`** 产出（口径固化在脚本里，见 §9）。**引用本文数字前必须先核对 HEAD**。
> **v1.3 第二轮补记（同日稍后）**：本轮收口时 HEAD 已到 `f33e5be`（`bb32d77` 之后 **5 个提交**，均为 D-6 / D-7 / D-8 修复与文档，**未触发 §9 的 ≥10 提交重取条件**）。§1.1 的规模表未全量重取；但**预算口径的数字已按 `budget-check.mjs` 实测刷新**（`main.ts` 2,914 → **2,919**、命令数 **194**、`style.css` **5,748**、产物 **4,989 KB**），引用这几项时以本行数字为准。
>
> **v1.3 修订（2026-10-06，定位变更 + 债务反查）**：本版不是数字刷新，**三个结论层面被推翻**：
> ① **产品定位已变**：2026-10-05 `ADR-0010` 废止「单人自用」定位，转向「高性能 · 轻量 Python IDE」，**性能与体积升为一等目标**。本文 §6 整章（「单人项目最大的长期风险」）以及 §0 缺口 1 里「自用项目没人盯 CI」的论据**当场过期**——已登记 `docs/tech-debt.md` **TD-025** 复审清单（6 条，含 nightly 只告警 / 更新通道 / Inter 字体 / Watches localStorage / 插件沙箱 / HTTP 私网提示）。
> ② **预算首次真实破线**：`style.css` **5,987 / 5,850 超限**（`budget-check.mjs` 唯一 FAIL）。在「体积是卖点」的新定位下，这不再是"要不要拆"的判断题，而是**必须显式 PR 表态**的硬约束。同时发现**产物体积项是假警报源**——`dist/` 陈旧时会把已取消的 mermaid/katex（约 2.09 MB）算进去（实测 7,065 KB），重新构建后 **4,988 / 5,120 PASS**（详见 §2 P0-0 与 §9 禁则 4）。
> ③ **v1.2 的建议基本没被执行**：v1.2 结论是「少做功能，多做证据；少堆清单，多守门禁」。**v1.2 入库（`f12c5c3`）之后的 19 个提交里**，**新功能 3 个（B4 HTTP 工具 / B5 运行日志 / B6-3 TODO 增强）**，而 P0-4 拆分 **0 行**、Gate D 两格人工 **0 格**、D-6/D-7/D-8 三个缺陷 **0 个被修**、CI/nightly **仍无首次跑通证据**。唯一例外是 **B6 被主动终止**（取消大纲与 Mermaid），这是**新方向第一次产生真实约束力**的正面证据（理由直接引用 ADR-0010 体积条款）。本次修订把这条自我观察写进 §0 与 §5，作为「报告是否被当回事」的校验位。
> ④ 候选池结算：**B4 ✅ 已交付**（形态改版：devtools 面板驱动，非原议的 `.http` 文件）· **B5 ✅ 已交付** · **B6 ❌ 终止**（保留 TODO 增强）。原「阶段三 · 画像期」的两个候选已提前完成，阶段三需重排。
>
> **v1.3 落地续记（同日，阶段一 4 件小事已完成 2 件）**：
> ① **D-7 已修 + 真机复核通过**（`main.ts::buildRunMenuItems`）：不再在菜单里重写一遍置灰条件，改为**直接复用 `computeRunWidget(s).runScript.disabled`**——与工具栏按钮共用同一判定式，从根上消除"按钮置灰、菜单可点"的二次分叉（只补 `|| s.debugging` 也能修好，但根因不除、下次还会漂移）。
> 　**复核结果：`e2e-real/debug-real.cjs` 14/14 PASS**。`R-REAL-10` 读到 `aria-disabled=true` / `.disabled=true` / `tip="调试进行中，请先停止调试"`，与工具栏 tip **逐字一致**，点击无新 toast 且仍停在断点；新增**正对照 `R-REAL-13`**：停止调试后同一菜单项恢复可点，证明 10 不是恒真。
> 　**顺带修掉真机脚本自身的三处缺陷**（都会造成假失败/假通过，nightly 会踩）：
> 　· **新增 `R-REAL-0` 护栏**——上一轮残留的 WebView2 孤儿进程会继续占着同一 CDP 端口，`connectOverCDP` 连到**旧会话**：端口预检通过、CDP 也连得上、文件树里同样有 `script.py`，但断点 map 的路径落在**上一轮的临时目录**，于是后续断言以极具误导性的方式连环失败（断点 map 有 6/9 而红点 0 个、真 debugpy 命不中断点）。护栏断言文件树 `data-path` 落在本轮临时工作区内，不匹配即 fail fast 并给出清理提示。
> 　· **`R-REAL-7` 竞态**——变量行是异步渲染（DAP `variables` 回包后才建行），单次 `count()` 会与渲染竞态（实测 `rows=0` 而同一时刻 `innerText` 已是 `a 11 b 22`）。改为轮询等行出现。
> 　· **`R-REAL-9/10` 的 toast 断言**——原写法是「toast 数量相等」，但 toast 会自动消失，上一步遗留的 toast 到期会让计数从 1 掉到 0，被误判成"新弹了一个"（实测 `toast 1→0` 让 R-REAL-10 假失败）。改为按 **toast 文本集合**判新增。
> ② **产物体积项已加 dist 新鲜度校验**：`budget-check.mjs` 新增 `newestSourceMtime()`（只看 `index.html` / 配置 / `shell/src` 下非测试源码），源码比 dist 新时判 **STALE**——不算 PASS 且断言模式非零退出，提示先 `npm run build`。实测验证：改 `main.ts` 后即报 `STALE 4988 / 5120`，`npm run build` 后恢复 `PASS`。**P0-0 尚未关闭**：`style.css` 仍 5,987 / 5,850 FAIL。
> ③ **P0-0 已关闭**：`style.css` 按 `budgets.toml` 既定路径拆出主题分文件——B4 HTTP → `styles/http.css`（102 行）、B5 运行日志 → `styles/logView.css`（170 行），`style.css` **5,987 → 5,748**（拆分 + D-6 新增 21 行），预算回到绿灯；两个分文件各设上限（125 / 205）防止静默增长在新文件重演。**配套：`audit_tokens.py` 新增 `@import` 解析**（`CssSource` + 行号映射，`--refs` 可换算回源文件）——**拆分不得缩小审计面**，否则与抬阈值同罪。
> ④ **D-6 已修**（`sqliteTabs.ts`）：详情面板头部加 × + `Esc` 双通道关闭（Esc 监听模块级只注册一次，弹层打开时归弹层）；`e2e/db` **30/30**（含新增回归断言：按钮关 / Esc 关 / 菜单优先）。
> ⑤ **性能基线首次落盘**：`bench/reports/metrics-20261006-091652.md`（release 重建后，`-Runs 3`）——冷启动 **956 ms**（红线 <1500）、内存 **339 MB**（主 23 + WebView2 315，红线 ≤600），双红线 PASS。⚠ run1 2619 ms 是首跑冷缓存（run2/3 = 117/132 ms），后续对比应看中位/剔除首跑。
> ⑥ **D-8 已修**（`debugView.refreshToolbarTips()` 进 settingsPanel 保存清单 + 单测钉住可逆）——**P0-3 三个缺陷全部关闭**（D-8 真机断言待下次跑 debug-real 转口径）。
> 门禁复核：`tsc` 零错 · 单测 **98 文件 / 1215** · `budget-check.mjs` **十二项全 PASS** · `audit_tokens.py` **98 项 0 FAIL** · 真机 `debug-real.cjs` **14/14** · e2e db **30/30** · e2e http+logs+todo **30/30**。
>
> **v1.3 落地续记 · 第二轮（同日稍后，P0 续推 3 件）**：
> ⑦ **P0-1 子项 5 已完成**：`budget-check.mjs` 并入 `ci.yml` 的 `test` job——**紧跟 `npm run build` 之后**（产物体积项带 dist 新鲜度校验，未构建/陈旧构建会判 STALE 并 FAIL），`--no-write`（报告落盘与归档仍由 nightly 的 `budget` job 负责）。本机验证：`npm run build` 重建后十二项全 PASS（产物 4,989/5,120 · 命令 194/200 · `style.css` 5,748/5,850）。**"破预算"从此在 PR 阶段就红，而不是等 nightly 出一份没人看的 artifact。**
> ⑧ **§1.5 的三条文档不一致已修**：`delivery-overview.md` 升 **v1.1**（§2 补录 B4/B5 两行含交付 commit 与门禁数字 · 用例基线 1070 → **1215** · §4 新登记 4 条）；`ci/budgets.toml` 的产物体积基线 4,918 → **4,989 KB** 并写明"随 `dist/` 新鲜度漂移"；`dev_plan_v2` §1.2.1 同步（并把"门禁策略本轮不改"更新为"规模/体积已进 PR 门禁、性能红线仍只告警"）。
> ⑨ **⚠ P0-1 的根子问题本轮被查出（本版最重要的一条）**：本仓远端**只有** `gitee.com/usedel/opencharm`，**Gitee 不执行 GitHub Actions**。即 `.github/workflows/ci.yml` 与 `nightly.yml` 这两份"已交付"的配置，**跑在一个没有宿主的仓库里**——v1.2 把"配置写好了"记成 ✅、v1.3 又把它降档为"零跑通证据"，其实都还没摸到根因：**连"能跑"的前提都不存在**。因此 v1.3 阶段一第 3 项写的收口动作"push 一次 master 看 Actions 是否真的触发"**在现宿主下永远得不到证据**。已登记 `delivery-overview.md` §4 第 13 条**待裁决**（三种落点：① 加 GitHub 远端/镜像让 Actions 真跑；② 改写为 Gitee Go `.gitee/workflows/`；③ 明确"CI 不在本仓跑"，改用本机一键门禁落证据）。**裁决之前，§0 缺口 1 不能关闭。**
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

**OpenCharm 已经从"做一个 IDE"走到了"做一个什么样的 IDE"。这个问题在 2026-10-03 有了一个答案（视觉身份），在 2026-10-05 又被改了一次——"高性能 · 轻量"，且这次改的是定位本身（`ADR-0010`）。**

功能广度上它仍在扩张：编辑增强、Git（六迭代）、调试（DAP/debugpy）、运行（PTY + 多实例）、终端、依赖健康、库特别支持、SQLite 工具、插件切片、国际化、UI 视觉身份，**以及 v1.2 之后新增的 HTTP 请求工具（B4）与结构化运行日志视图（B5）**，全部有验收记录与 E2E 兜底。工程底座（**194 个 Tauri 命令、1214 个前端用例 / 98 文件、351 个 Rust 测试、版本锁定 + 2 个 workflow**）持续走强。**UI 视觉六批已全部落地并通过真机验收，"像没贴牌的 VS Code"这个诊断在批 4 之后已不成立。**

但 2026-10-05 的定位变更改变了评判坐标系：过去"够用就行"的地方（体积、告警是否有人看、性能是否实测）现在都是**一等目标**。按新坐标系重排，缺口从 v1.2 的两条变成三条：

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| ~~**0**~~ | ~~**预算已破线，且性能红线至今无实测落盘**~~ ✅ **已关闭（2026-10-06 本轮）** | `style.css` 按主题拆出 `styles/http.css` / `styles/logView.css`，回到 **5,748 / 5,850**，预算十二项全 PASS；`budget-check.mjs` 加 dist 新鲜度 STALE 判定；性能基线首次落盘 `bench/reports/metrics-20261006-091652.md`（冷启动 956 ms / 内存 339 MB，双红线 PASS） | ~~唯一处于失败态的硬约束~~ **已消除**。遗留：CI 侧尚未跑过 budget/bench（→ 缺口 1） |
| 1 | **门禁配置齐备，但零跑通证据——根因是 CI 没有宿主**（v1.2 记"待观察"，v1.3 记"零证据"，**2026-10-06 第二轮查出真根因**） | ✅ `ci.yml` push 分支已对齐 `[master, main]`、`audit_tokens.py` 已进 test job、**`budget-check.mjs` 已并入 test job（子项 5）**、`nightly.yml` 三 job 齐备、`OC_JSON_OUT` 汇总、`v*` tag 触发。✅ 性能基线已落盘 `bench/reports/metrics-20261006-091652.md`。⏳ **本仓远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions** —— 两份 workflow 无论怎么改都不会跑，"push 一次 master 看 Actions 触发"这条收口动作**在现宿主下永远拿不到证据**。⏳ 「只告警不阻断」在新定位下论据过期，已进 TD-025 复审清单第 1 条 | 分歧台账 D-001/D-005/D-007 的根因都是**真机才暴露**的集成缺陷。护栏的硬件装好了，但**从没接上电源——连插座都不在这栋楼里**：v1.2 把"配置交付"记成"能力交付"，v1.3 降档为"零证据"，直到本轮才查到"没有宿主"。✅ **已裁决（2026-10-06）：维持现状 + 文档标注**——`.github/workflows/` 定位为"将来推 GitHub 的预埋"。**缺口 1 由此从"待办"降级为"待外部事件"（迁移到 GitHub 后首次 push 的 run 记录），保持开启但不再消耗人力** |
| 2 | **差异化核心缺最后一格证据**（第一格仍零进展；**第二格 2026-10-06 取得真实项目样本**） | Gate D 确定性口径**已 PASS**（23/23 = 100%，红线 ≥85%）；① **PyCharm 人工横向仍 PENDING**（`gate-d-ab-worklist.md` 23 行**全为 `☐`**）；② ~~真实项目 trace 仅 56 条~~ → **已在 `metawake/backend`（73 py / 350 def）上跑通采集：277 条函数观测、覆盖率 79%、hits p50 2 vs p99 56、606 B/条**，但距 ≥1000 门槛仍差 3.6 倍且**单项目已近饱和**（→ 需跨项目累计）。`STALE_HITS_DIVISOR` 仍为 **2**（`completion.rs:32`） | 项目立身之本（运行时智能）现有"能用"的证据 + **首个真实分布**，但**还没有"比 PyCharm 更好"的横向证据**；降权参数仍是"建议值"而非落值 |

**v1.3 的自我校验位（务必先读这一条）**：v1.2 的结论是「**少做功能，多做证据；少堆清单，多守门禁**」。v1.2 入库之后的 19 个提交实际做了什么？**新功能 3 个（B4 / B5 / B6-3）**，而 `env_cmds.rs` 拆分 **0 行**（仍 4,937）、Gate D 两格人工 **0 格**、D-6/D-7/D-8 三个缺陷 **0 个被修**、CI/nightly **0 条跑通证据**、P1-1 可观测性 **0**。唯一践行新方向的是 **B6 主动终止**（取消 Mermaid，理由直接引 ADR-0010 体积条款）。**结论：报告本身没有被当作排期依据。** 因此 v1.3 不再新增候选条目，只做三件事——把「守门禁」落到**能在 CI 里红的那一项**（P0-0）、把 P0 项压到**一小时内能完成的粒度**、并把 §5 阶段一改成"只做 4 件小事"。

据此，本报告的建议优先级排序是：**P0-0 让预算回到绿灯（并给产物体积项加 dist 新鲜度保障）→ P0-1 建性能基线 + 把预算门禁放进主门禁 + **裁决 CI 落点** → P0-3 修 D-7/D-6/D-8 → P0-2 只差真人在 PyCharm 点 23 下 + 真实项目采一次数 → P0-4 `env_cmds.rs` 拆分（−49%，已挂两版，须先二选一裁决）→ 最后才谈新功能。**

> **第二轮进度（2026-10-06 稍后，三个决定已拍板）**：P0-0 ✅ 已关闭 · P0-3 ✅ 已关闭 · **P0-1 七个子项全部完成**（CI 落点裁决为"维持现状 + 文档标注"，缺口 1 降级为**待外部事件**：迁移到 GitHub 时验）· **P0-4 已裁决为"折中：先冻结再择机拆"**（冻结线 + 上限改长期已落地）· **P0-2 第二格取得真实项目样本**（`metawake/backend` 277 条 / 覆盖率 79%），第一格仍是纯人工（PyCharm 点 23 下）。
> **也就是说：P0 里"需要写代码"的活已经全部做完；剩下的只有两件事——① 真人在 PyCharm 里点 23 下（P0-2 第一格）；② 再采 1~2 个真实项目把样本量累计到 ≥1000（P0-2 第二格的收尾）。** 这两件都不可自动化替代，但都不阻塞阶段二开工。

> 一句话给未来半年：**先把门禁通上电，再谈"高性能 · 轻量"这四个字值多少。**

---

## 1. 现状盘点

### 1.1 工程规模（实测，HEAD `bb32d77`）

> 全部由 `node tools/stats/repo-stats.mjs` 产出（口径见 §9）。**v1.1 曾用 `Get-Content .Count` 取行数，在 gb2312 代码页上系统性偏低 4.5%~13%，v1.2 已重取；本表为 v1.3 第二次重取。**

| 层 | 文件数 | 行数 | v1.2 → v1.3 | 备注 |
|---|---|---|---|---|
| 前端源码（`shell/src/**/*.ts`，不含测试） | 228 | **60,857** | 57,248 → 60,857（**+3,609**） | 顶层 `src/*.ts` 112 个 / 38,807 行（+6 文件 / +1,870 行）；增量主要来自 B4 HTTP（`httpRequest.ts` + `devtools/builtin/http.ts`）、B5 日志（`logView/logStore/logParse/editorInsert.ts`）、B6-3 TODO |
| 前端样式（`shell/src/**/*.css`） | 1 | **5,987** | 5,668 → 5,987（**+319**） | 即 `style.css`（设计系统本体），0.2 MB。**⚠ 已破 `budgets.toml` 的 5,850 上限——当前唯一 FAIL 项** |
| Rust 外壳（`shell/src-tauri/src/*.rs`） | 29 | **21,422** | 20,490 → 21,422（**+932**） | **194 个 `#[tauri::command]`**；新增 `http_cmds.rs`（B4，reqwest） |
| Rust 运行时智能（`intel/**/*.rs`，独立 workspace） | 13 | **3,953** | 3,766 → 3,953（+187） | 45 个 `#[test]` |
| Python 探针（`probe/**/*.py`，不含 tests） | 10 | **1,586** | 1,573 → 1,586（+13） | 零第三方依赖，81 个 pytest |
| 文档（`docs/*.md` + `adr/`） | 39 + 8 | — | ADR 0003–0010 | ADR +1（0010 性能轻量章程）；`docs/*.md` 仍 39；根目录另有 `CONTENT-SERIES.md`（连载发布建议，不在 `docs/`） |

**合计约 93.8K 行自研代码**（不含 `node_modules` / 打包产物 / 测试 / e2e / 文档）——23 个提交里 **+5.1K 行（+6.2%）**，增量几乎全部是 B4/B5 两个新功能。对一个单人项目而言，这已经是**需要认真对待维护成本**的量级；而定位变更后，它同时也是**需要认真对待体积与性能**的量级——这两点分别影响第 6 章的选题判断与 §2 的 P0-0。

### 1.2 规模分布的三个结构性信号

| 信号 | 数据（HEAD `bb32d77`） | 含义 |
|---|---|---|
| **巨型文件（P0-4 两版零进展）** | `env_cmds.rs` **4,945**（预算 5,050 = 长期上限 + 冻结线）· `fs_cmds.rs` **3,882** · `git.ts` **3,204** · `main.ts` **2,919**（预算 3,000）· `git_cmds.rs` **1,940** · `lsp/client.ts` **1,774** · `db_cmds.rs` 1,537 · `fileTree.ts` 1,332 · `settingsPanel.ts` 1,154 · `live-templates/ui/manager.ts` 1,128 | ⚠ **v1.3 复核**：`env_cmds.rs` / `fs_cmds.rs` / `git.ts` / `lsp/client.ts` 在 `ccf9da2 → bb32d77` 之间**仍是一行未变**；`main.ts` +17、`git_cmds.rs` +58。**P0-4 在 v1.2 与 v1.3 两版里连续被记为"待拆"，实际动作为零**——这类连续挂账项应改判为"要么拆，要么从清单里撤掉并接受它"，否则清单本身失去可信度。另：前十门槛出现三个新面孔（`fileTree.ts` / `settingsPanel.ts` / `live-templates/ui/manager.ts`），说明"大文件"正在从历史遗留向新模块扩散 |
| ~~**样式单点破线**~~ ✅ **已按既定路径拆分（2026-10-06）** | ~~`style.css` 5,987（超 5,850 上限）~~ → **5,748**（B4 → `styles/http.css` 102 行、B5 → `styles/logView.css` 170 行，各设上限 125/205） | 拆分走的是 `budgets.toml:25` 写死的既定路径，未抬任何阈值；`audit_tokens.py` 同步加 `@import` 解析保证审计面不缩水（98 项全绿）。**教训归档**：预算第一次被真实触发到关闭用了半天——门禁的价值正在于此（先红、再逼出结构性动作、而不是静默突破） |
| **命令面膨胀** | 194 个 Tauri 命令（+2）；`git_cmds` 47 + `env_cmds` 32 + `fs_cmds` 28 = 107，仍占 **55%**；新增 `http_cmds.rs` | 单一进程承载过多职责。插件化（轨 B / OEP）未启动前，Rust 侧会继续膨胀；200 信号线尚有 6 个余量（超限只告警）。**ADR-0010「默认轻量」条款应在此处先产生作用：新增命令面须先论证"能不能复用已有命令"** |

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
| **HTTP 请求工具（B4）** | `devtools/builtin/http.ts` / `httpRequest.ts` + Rust `http_cmds.rs`（reqwest） | ✅ **v1.2 之后新交付**（2026-10-05，3 个 PR 闭环）。⚠ **形态与原候选不同**：原议是 `.http` 文件语言，落地改为 **devtools 面板驱动**（发送 / 响应 / 变量 / 历史 / curl 导入 / 端点联动）；原 `.http` 语言注册整块取消。真源 `docs/toolbox_dev_plan.md` §5.9–5.11（门禁 1145/1145 + e2e 12/12） |
| **结构化运行日志（B5）** | `logView.ts` / `logStore.ts` / `logParse.ts` / `editorInsert.ts` | ✅ **v1.2 之后新交付**（底部「运行日志」tab：多播采集 + 级别过滤 + 字段折叠/导出）。真源 `docs/toolbox_dev_plan.md` §6.10–6.12（门禁 1208/1208 + e2e 9/9） |
| **TODO 增强（B6-3）** | `todoView.ts` | ✅ 2026-10-04 交付（过滤 + 按文件分组 + 跳转 + 计数，19 例单测 + `e2e/todo/` 7 条）。**B6 整体已终止**——大纲与 Mermaid 取消（§7.7），状态"部分交付后终止" |
| 运行时智能 | `probe/` + `intel/` | ✅ P3-T01~T09 交付；**P3-T10 人工横向对标仍挂起**（P0-2，`intel/README.md:47/58/59` 三处均仍 ⏳） |
| 多窗口 | Rust `per_window.rs` / `window_mgr.rs` | ✅ 阶段 0/1/2 全部交付（`multi_window_dev_plan.md` v0.2；真机 `multi-window-real.cjs` 16/16 PASS）；#4~#6 依赖健康缓存经拍板暂缓 |

### 1.4 质量底座

| 项 | 现状（HEAD `bb32d77`） | 评价 |
|---|---|---|
| 前端单测 | **98 个 `*.test.ts` / 1215 用例全绿**（D-8 补 1 例后，2026-10-06 门禁）；v1.2 写的 1070 已过时 ✅ **`delivery-overview.md` 2026-10-06 已同步为 1215**（§1.5 第 ② 条关闭） | 强 |
| Rust 单测 | `src-tauri` **306** 个 `#[test]` + intel **45** = 351 | 强 |
| Python 单测 | probe **81** 个 pytest | 强 |
| E2E（mock 层） | `shell/e2e/` **69 个 spec**（10,602 行）；`http/` 已不再是空占位（B4 落地，`01-devtools.spec.ts` 12 条），新增 `logs/`（11 条）与 `todo/`（7 条） | 强 |
| E2E（真机层） | `shell/e2e-real/` **10 个 `.cjs`**（`db/debug/endpoints/multi-window/new-project-fastapi/ui/release` + probe 三支），手动执行；**`nightly.yml` 已编排 9 套串行，但无跑通证据** | **中**（编排有了，证据缺） |
| 专项门禁脚本 | `tools/ui/audit_tokens.py`（98 项，**2026-10-04 起进 CI test job**）+ `gate-tests.mjs unit\|e2e\|e2e-ui` + `ui-baseline.mjs` + `budget-check.mjs`（9 项 + `.ps1` 编码卫生） | 好实践；**唯一缺环是 `budget-check.mjs` 不在 `ci.yml` 里**（只在 nightly，且 nightly 无跑通记录） |
| 分歧台账 | `e2e_divergence_ledger.md` D-001~D-007，含避坑速查 6 条 | 好实践，但资产未自动化 |
| CI | **2 个 workflow**：`ci.yml`（`test` 4 矩阵 + `package-smoke`；push 分支已对齐 `[master, main]`，tags `v*`；含 `audit_tokens.py` **与 `budget-check.mjs`**）+ `nightly.yml`（`e2e-real` / `bench` / `budget` 三 job，`schedule` 每日 03:17 UTC，全部 `continue-on-error`） | **配置强 / 证据无 / ⚠ 宿主错配**：① `bench/reports/` 已有 `metrics-*.md`（本机跑的基线），但无 `budget-*.md`（CI 产物）；② **本仓远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions** —— 两份 workflow 不会被调度，与"配置已交付"的记账直接冲突（详见 §0 缺口 1 与 §2 P0-1 子项 7） |
| 版本锁定 | `ci/versions.toml`：tauri 2.11.5 / monaco 0.52.2 / pyrefly 1.3.1 / basedpyright 1.39.10 / ruff 0.16.1 / debugpy 1.8.21 / python 3.13.7 / uv 0.10.11 / rust 1.96.0 | 强 |

### 1.5 已识别但未处理的存量债务

- **技术债登记**（v1.3 复核）：待处理区由 1 组增到 **4 条**——TD-021（P4 五小项，仍未动）· **TD-022**（Monaco 浮层圆角无法跟随 `--radius-*`，P4 取舍）· **TD-024**（alpha 边框不满足 WCAG 1.4.11 的 3:1，P4 合规取舍）· **TD-025**（**「单人自用」论据失效复审清单，P2**，ADR-0010 连带登记，6 条待复审：nightly 只告警 / 更新通道与回滚 / Inter 字体不随包 / Watches 存 localStorage / 插件 v2 沙箱 / HTTP Client 私网提示）。TD-023 已关闭（实测前提不成立）。**债务治理仍有效，但 TD-025 是本轮新增的、唯一带「方向变更」性质的一条。**
- **验收遗留**：调试 8 项人工清单（`debug_acceptance_record.md` §五）；运行侧 M2 遗留（Logpoint 三路回归、退出孤儿进程人工核验）；probe 长驻覆盖体验观察转日常。
- **计划文档与现实脱节**：`python_ide_dev_plan_v2.md` §7 状态表进度戳仍写「2026-08-24」，**未记录** Git 六迭代、远端克隆、SQLite 工具、多窗口、插件切片、库支持、依赖健康、Pydantic、i18n、UI 视觉六批等交付。
- **README 索引缺 12 篇** → ✅ **2026-10-03 已补齐**（连同新建的 `delivery-overview.md`，索引现覆盖全部 39 篇 `docs/*.md`）：`dx_features_backlog.md` / `e2e_divergence_ledger.md` / `git_clone_dev_plan.md` / `multi_window_dev_plan.md` / `onboarding_dev_plan.md` / `onboarding_guide.md` / `pycharm_framework_support_report.md` / `pycharm_ux_review_and_proposal.md` / `pyrefly_pydantic_support_plan.md` / `python_library_support_dev_plan.md` / `python_library_support_research.md` / `ui_premium_dev_plan.md`。
- **状态戳滞后** → ✅ **已修 5 处**：`README.md` 索引行的 `ui_premium_design_report` 改为 v1.2（方向已批准）并指向执行真源；`ui_premium_dev_plan.md:3` 改为「六批全部落地」；`sqlite_tool_dev_plan.md` 升 v1.5（**并校正一处归属错误**：13/13 真机属 v1.0 侧栏态，v1.4 Tab 化真机待做，见该文档 v1.5 修订说明）；`python_ide_dev_plan_v2.md:114` §7 进度戳回填至 2026-10-03 并补 13 行缺失功能域；`onboarding_guide.md` 补 v1.0 版本头。
- **ADR 欠账** → ✅ **已清**（2026-10-03）：补记 ADR-0006 双静态引擎 · 0007 intel 独立 LSP · 0008 PEP 669 采样 · 0009 补全合并策略（均标「已定案（补记）」，注明决策自 2026-08-20~21 生效）；`docs/adr/README.md`「待记录（候选）」清空。
- **onboarding 双源冲突** → ✅ **已消解**（2026-10-03）：`onboarding_dev_plan.md` 升 v1.3，按 PR 粒度回填真实状态——**PR-S1 / S2 / S4 已交付**（`welcomeGuide.ts` + `main.ts` 三处注入 + e2e `04-onboarding.spec.ts` OG-1..OG-9），S3（可选 P2）未开工、S5 登记不排期；`onboarding_guide.md` 补 v1.0 版本头 + `?raw` 打包机制说明。
- **多窗口状态滞后** → ✅ **已回填**（2026-10-03）：`multi_window_dev_plan.md` 升 v0.2——阶段 0/1/2 **全部交付**（2026-09-28 实施 / 09-30 入库 `14164e4`），真机 `multi-window-real.cjs` **16/16 PASS**；阶段 0 清单勾选依据为代码实测（后端 7 文件 22 处 `emit_to` + 前端 8 文件窗口级 `listen`，与 §3.1/§3.2 表逐项对应）；DoD 四条逐项对账关闭（第 3 条以 v0.2 修订替代独立验收记录文件）。
- **✅ 已交付（v1.2 轮）**：`docs/delivery-overview.md` 交付总览已建立——功能域 × 交付日期 × 计划真源 × 验收记录 × 状态，含文档地图（按角色读）、**已知文档不一致登记表**（本文 §1.5 各条已并入该表统一跟踪）、门禁与取数命令、新会话 15 分钟上手路径。§4 的 9 条不一致**全部已关闭**。
- **✅ v1.3 新发现的文档不一致（3 条）已全部修完（2026-10-06 第二轮）**：① **`delivery-overview.md` §2 补录 B4 HTTP 工具与 B5 运行日志**（新增第 22 / 23 行，含交付 commit `2e5634b` / `d497d2f` 与门禁数字；文档升 **v1.1**）；② **用例基线 1070 → 1215**（`delivery-overview.md` §1 与本文 §1.4 同步）；③ **产物体积实测 4,918 → 4,989 KB**（`ci/budgets.toml:64` 注释 + `dev_plan_v2` §1.2.1 同步，并写明"该数字随 `dist/` 新鲜度漂移，引用前先 `npm run build`"）。
- **⚠ v1.3 第二轮新登记的文档不一致（1 条，`delivery-overview.md` §4 第 13 条，待裁决）**：**CI 宿主错配** —— 本仓远端只有 Gitee，而 `.github/workflows/` 是 GitHub Actions 的载体；文档里"CI 配置已交付 / 待观察触发"的记账与"没有宿主"的事实冲突。落点三选一见 §2 P0-1 子项 7。**这是本轮唯一新增的未闭环文档债。**
- ~~未提交改动~~：v1.0 记录的 `README.md` / `shell/index.html` / `shell/src/style.css` 未提交改动**已全部入库**（收口于 `964ea7e` 等 20 个提交，工作区 clean）。本项从本版本移除。

---

## 2. 改进建议

> 分 P0 / P1 / P2 三档。每档内按「收益 ÷ 成本」排序。**P0 不是"最紧急的 bug"，而是"不补会持续失血的结构性缺口"**。
> **v1.3 新增 P0-0 并置顶**：定位变更（ADR-0010）后，"预算处于 FAIL 态"本身就是一等目标上的失败，优先级高于一切新功能与债务拆分。

### P0-0 · 让预算回到绿灯，并给产物体积项加"dist 新鲜度"保障 —— ✅ 已关闭（2026-10-06 本轮）

- ~~**事实（本机实测，HEAD `bb32d77`）**~~：~~`budget-check.mjs` 十项里 **1 项 FAIL**：`style.css` 5,987 / 5,850（超 137 行）~~ → **当前十二项全 PASS**（`style.css` 5,748/5,850 · `styles/http.css` 102/125 · `styles/logView.css` 170/205 · 产物 4,989/5,120 · 命令 194/200 · 其余同前）。
- **⚠ 顺带查出一个假警报机制（方法论级）**：首次跑 `budget-check.mjs` 时产物体积报 **7,065 / 5,120 FAIL**，看起来像 B4/B5 把体积撑爆了；实际原因是 **`shell/dist/` 是 2026-10-05 的陈旧产物**，里面还留着**已被取消的 mermaid/katex 分包**（约 2.09 MB：`cynefin` 654 KB + `wardleyDiagram` 640 KB + `katex` 261 KB + 其余 diagram 分包）。`npm run build` 重新构建后降到 **4,988 KB / PASS**，且 dist 里已无任何 mermaid/katex 分包（源码侧亦已无引用）。
  **结论：产物体积这项指标会随 `dist/` 陈旧度漂移 ±2 MB，若不处理，它会像 v1.1 的行数口径一样变成"看起来合理但系统性错误"的数字。**
- **建议动作**（按性价比排序）：
  1. ✅ **已完成（2026-10-06）**：`budget-check.mjs` 加 dist 新鲜度校验——新增 `newestSourceMtime()`（`shell/index.html` / `package.json` / `vite.config.ts` / `tsconfig.json` + `shell/src` 下**非测试**源码，排除 `__tests__` 与 `*.test.ts`），源码比 dist 新时判 **STALE**（不算 PASS、断言模式非零退出）。实测：改 `main.ts` 后即报 `STALE 4988 / 5120`，`npm run build` 后恢复 `PASS`。
  2. ✅ **已完成（2026-10-06）**：`style.css` 按主题拆出分文件（`budgets.toml:25` 写死的既定路径）——B4 HTTP → `styles/http.css`（102 行）、B5 运行日志 → `styles/logView.css`（170 行），`style.css` **5,987 → 5,748**；两个分文件各设上限（125 / 205）。**只整块搬移不改声明值**：拆出的选择器均为 `.http-*` / `.log-*` 命名空间（唯一例外 `.out-chip.log-chip` 特异性 0,2,0 高于 `.out-chip` 本体），经 `style.css` 顶部 `@import` 内联，层叠结果不变（e2e http+logs+todo 30/30 为证）。
  3. ~~若确有理由不拆：走显式 PR 抬阈值~~ **未触发**（拆分后回到绿灯，未动任何阈值）。
- **配套（关键，防"拆分 = 静默缩小审计面"）**：`tools/ui/audit_tokens.py` 新增 `CssSource` / `load_css_source()`——解析 `style.css` 的本地 `@import` 并内联进审计源（含行号映射，`--refs` 换算回源文件并标注归属文件）。验证：拆分前后均 **98 项 0 FAIL**；`--refs accent-faint` 能列出 `styles/logView.css` 的引用点。**纪律：今后任何样式拆分，门禁脚本必须同步覆盖新文件。**
- **成本**：合计约 0.4 人日（脚本 0.2 + 拆分与验证 0.2）。
- **验收**：✅ `budget-check.mjs` 十二项全 PASS · `audit_tokens.py` 98 项全绿 · 单测 1214 · e2e 60/60（db 30 + http/logs/todo 30）。

### P0-1 · 质量门禁闭环：⏳ 配置齐备，零跑通证据（v1.3 由"✅ 全部完成"降档）

- **子项 1（✅）主干触发**：`ci.yml` 的 `on.push.branches` 原为 `[main]`，而本仓主干是 `master`（`origin/HEAD → origin/master`）——**推送到主干不触发任何 CI**。已对齐为 `[master, main]` 并在文件头注明来由。**全文投入产出比最高的一条：1 行，零逻辑风险。**
- **子项 2（✅）nightly**：新增 `.github/workflows/nightly.yml`——`schedule` 每日 03:17 UTC + 手动触发，三个 job：
  1. `e2e-real`：9 个真机脚本**串行**逐个跑（共用 5173/9223 端口，并发必撞），每套出 JSON 汇总，最后合成 `SUMMARY.md` 上传 artifact；
  2. `bench`：`build-release.ps1` + `collect-metrics.ps1 -Runs 3`（冷启动/内存红线）；
  3. `budget`：`npm run build` 后跑 `budget-check.mjs`（P1-3）。
  **全部 `continue-on-error: true`——只告警不阻断**。真机层**刻意不进 `ci.yml`**：慢且不稳，混进 PR 门禁会被偶发失败淹没，护栏反而被绕过（台账原有「高频 mock + 低频真机」约定，本文件是它的自动化落点）。
  **⚠ v1.3：本条的原始理由（"单人自用项目没人盯 CI 告警"）已随 ADR-0010 废止**，是否升级为阻断**登记为 TD-025 第 1 条待复审**。真机层慢且不稳这一条理由**仍成立**，故本轮维持只告警；但"没人盯"不再是理由——**告警要接通知渠道，否则等于没有告警**。
- **子项 3（✅）JSON 汇总**：`real-env.cjs` 新增 `OC_JSON_OUT`（schema `opencharm-e2e-real-summary/1`），落盘 `{suite, at, ok, total, failed, error, durationMs, headCommit, cases[]}`。**预检失败与运行中断也会落盘**（`error` 字段 + `ok:false`），使 CI 能区分"环境没起来"与"断言回归"；`0 项 + 无 error` 判 `false`，避免空跑被误当通过。
- **子项 4（✅）tag 触发**：`package-smoke` 的 `if` 由 `event_name == 'workflow_dispatch'` 放宽为 `|| startsWith(github.ref,'refs/tags/v')`，`on.push.tags` 加 `v*`。发布前门禁不再全靠人记得手动点。
- **本机入口**：`shell/e2e-real/run-real-all.ps1`（一键全量跑批 + 合并汇总，套件清单与 nightly 一致；默认跳过 probe 压测三支；`-Strict` 才非零退出）。串行与端口约束在脚本里预检，占用即停。
- **v1.3 复核（3 天后，零进展）**：`bench/reports/` 现有 16 个文件，**无任何 `metrics-*.md` / `budget-*.md` / `stats-*.md`**（CI 与 nightly 的产物名见 `nightly.yml:179/217-218`）。即 **master push 首次触发 / nightly 首次出汇总 / 首次 tag 触发 smoke 三者至今无一条落盘证据**。v1.2 把"配置写好了"记为 ✅，这是**把配置交付当成了能力交付**——本版改判为 ⏳。
- **新增子项 5（v1.3）** → ✅ **已完成（2026-10-06 第二轮）**：`budget-check.mjs` 并入 `ci.yml` 的 `test` job，位置**紧跟 `npm run build`**（产物体积项带 dist 新鲜度校验，未构建/陈旧构建会判 STALE 并 FAIL，故顺序不可调换），加 `--no-write`（落盘与归档交给 nightly）。本机验证：重建 dist 后十二项全 PASS。**效果：破预算在 PR 阶段即红**；这也是 ADR-0010「预算先行」第一次在**主门禁**里拥有否决权。
- **新增子项 6（v1.3）** → ✅ **已完成**：`bench/reports/metrics-20261006-091652.md` 已落盘（冷启动 956 ms / 内存 339 MB）。⚠ 该基线是**本机**数据，CI 侧仍无对照（→ 子项 7）。
- **新增子项 7（v1.3 第二轮，本轮查出的根子问题）** → ✅ **已裁决（2026-10-06，产品负责人选「维持现状，只在文档标注」）**：**CI 没有宿主。** 本仓 `git remote -v` 只有 `https://gitee.com/usedel/opencharm.git` 一个远端，**Gitee 不执行 GitHub Actions**——`ci.yml` / `nightly.yml` 写得再对也不会被调度。这让子项 1~6 里"配置已交付"的部分**全部悬空**：护栏装好了，插座不在。
  **裁决与落点**：① 不加 GitHub 远端、不改写 Gitee Go、也不新增本机一键门禁脚本；② `.github/workflows/` 明确定位为**"将来推 GitHub 的预埋"**（与 2026-10-05 同口径：对外发布时主仓推 GitHub，配置零改动即可生效）；③ 本条与 `delivery-overview.md` §4 第 13 条**保持登记为 ⏳ 未闭环**（标注型关闭，非能力型关闭）。
  **由此改写 P0-1 的剩余验收**：不再是"push 一次看 Actions 触发"（该动作在现宿主下语义不成立），而是**"迁移到 GitHub 后首次 push 的 Actions run 记录"**——触发条件外置，谁推谁验。**在迁移发生之前，§0 缺口 1 保持开启，但不再消耗人力**：它是"等待一个外部事件"，不是"等一个决定"。
- **验收状态（v1.3 第二轮）**：子项 1~6 全部 ✅；⏳ **子项 7 待裁决**（这是 §0 缺口 1 的唯一未决项，且它决定了缺口 1 能不能关）。
- **成本**：已投约 1.1 人日（子项 5 约 10 分钟）；**余量取决于裁决**：① 约 0.2 人日（加远端 + 推一次验证）· ② 约 0.5~1 人日（重写 workflow + 调 Gitee Go）· ③ 约 0.1 人日（改文档口径 + 本机跑一次落证据）。

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
- **v1.3 复核（零进展，逐项对账）**：① `bench/reports/gate-d-ab-worklist.md` 工作单仍在，OpenCharm 侧 23 点排名已自动填好，但 **PyCharm 列 23 行全为 `☐`**、小结空白；② ~~`bench/reports/trace-stats.md`（2026-10-03）仍是 **1 库 / 1 次运行 / 56 条函数观测 / stale 0%**~~ → **2026-10-06 已被真实项目样本取代（见下）**；③ `STALE_HITS_DIVISOR` **仍为 2**（`intel/crates/opencharm-intel/src/completion.rs:32`），具名常量已提、钉值单测已加，值未动；④ `intel/README.md:47 / :58 / :59` 三处状态戳**均仍为 ⏳**（`27e097c` 只补了现状表，未推进任何一格）。
- **✅ 第二格取得真实项目样本（2026-10-06 第二轮，本轮最实的一格进展）**：在**真实项目 `metawake/backend`（FastAPI + SQLAlchemy，73 个 py / 350 个 def）**上跑通了完整采集链路——
  - **怎么跑的**：probe 的 `project_root` 取自「被运行脚本所在目录」，故在 `backend/` 根**临时放**一个 runner（只负责拉起 pytest，**跑完即删**，未留下任何文件），挂 IDE 同款注入 env（`OPENCHARM_PROBE_AUTOSTART=1` + `PYTHONPATH=probe/src`）跑其 13 条测试；`pytest` / `httpx` 装在系统临时目录（`D:\tmp\oc-pytest`）而**未污染项目的 `.venv`**（它们是项目声明的 dev / 主依赖，只是当时没装）；trace 落在隔离的 `OPENCHARM_PROBE_HOME`，**未动真实数据根**。
  - **结果**：**277 条函数观测 / 176 参数类型 / 277 返回类型 / 7 异常类型 / 164 KB**，13 条测试全绿（83~85 s），连跑 2 次（+1 次失败预演）用于看 hits 累积。
  - **覆盖率**：**277 / 350 = 79%** —— 即"跑一遍测试"这一最常见的真实动作，能覆盖该项目**近八成**的函数定义。这本身是 A1（运行时热点视图）的正面证据。
  - **hits 长尾首次有真实形状**：均值 4.3 / **p50 = 2** / p90 = 4 / **p99 = 56** / max 60 —— 中位数与 p99 差 **28 倍**，说明"按 hits 排热点"在真实代码上确实能分出冷热（此前只有 56 条、hits max 200 的合成样本，无法判断是不是噪声）。
  - **每条观测 606 B**（此前 56 条样本测出 1,024 B）→ 保留窗口建议由 8,192 条改为 **13,836 条 / 8 MB**（同一脚本、同一规则，只是样本变了）。**这是"换样本就换结论"的活证据：参数是数据的函数，不是信念。**
  - **stale 仍为 0%**：因为两次运行之间**没有编辑任何文件**（真实项目不能为了造数去改 mtime）。降权因此在本次样本里不触发——**与 2026-10-03 的合成实验（编辑后部分运行 → stale 30%）并不矛盾**，两者覆盖了不同的编辑流。**`STALE_HITS_DIVISOR` 维持 2 不改**，理由从"样本不足"升级为"两个样本分别覆盖'不编辑'与'编辑后部分运行'两种流，前者降权不触发（无害），后者 30% 落 0.25 档（有益）——但改值需要 ≥1000 条的真实样本支撑，现仍不足"。
  - **⚠ 门槛未达**：277 条距自定的 **≥1000 条**仍差 3.6 倍；且**单项目已近饱和**（79%），意味着"跑到 1000"必须**跨多个项目累计**。**建议把门槛口径改成「跨 ≥2~3 个真实项目累计 ≥1000 条」**，并明确：在此之前 `STALE_HITS_DIVISOR` 与保留窗口都只作"建议值"，不落代码。
- **建议动作**：
  1. ~~人工对标工作单~~ ✅ **已自动生成** `bench/reports/gate-d-ab-worklist.md`：设 `OC_GATE_D_WORKLIST=<路径>` 后跑 `cargo test -p opencharm-intel -- --nocapture runtime_completion_accuracy` 即导出——**OpenCharm 侧 23 点的实际排名已由测试填好**，人只需在 PyCharm 同一样例上勾"是否在 top-5"。避免了让人重新拼 23 个光标位置（既慢又必然与 cases 数组漂移）；
  2. ~~在**一个真实项目**上跑 probe 采集~~ ✅ **已完成一次**（`metawake/backend`：277 条 / 覆盖率 79% / hits p50 2 vs p99 56 / 606 B 每条）；**下一步是累计样本量**——再采 1~2 个真实项目（建议 `cb_watcher/backend`，或你日常用 IDE 跑脚本时自然累积），达到跨项目 ≥1000 条后复核降权参数并考虑落值；
  3. 结论回写 `intel/README.md` 与 `dev_plan_v2` §7，把 ⚠️/PENDING 改成 ✅ 或明确记 ❌。
- **成本**：第二格已花约 **0.3 人日**（含装隔离依赖、跑两遍、清理）；余约 **0.5~1 人日**（真人 PyCharm 点 23 下 + 再采 1~2 个真实项目）。v1.0 估 3~5 人日。
- **验收**：`gate-d-ab.md`（= 工作单填完 PyCharm 列）+ 降权参数在**跨项目 ≥1000 条**真实观测上复核 + 三处文档状态一致。
- **可复现命令**（下次采另一个项目时照抄，改三处路径即可）：`uv pip install --target D:\tmp\oc-pytest pytest httpx --python 3.13` → 在**项目根**放一个只做 `pytest.main([...])` 的 runner → `PYTHONPATH="D:\tmp\oc-pytest;<repo>\probe\src;<项目根>" OPENCHARM_PROBE_AUTOSTART=1 OPENCHARM_PROBE_SCRIPT=<runner 绝对路径> OPENCHARM_PROBE_HOME=D:\tmp\oc-trace-home <项目 venv python> <runner>` → `python tools/intel/trace_stats.py <db> --out bench/reports/trace-stats.md`。**两个纪律**：① runner 必须放在项目根（`project_root` 由脚本所在目录决定，放错目录就只采到那个子目录）；② 用隔离的 `OPENCHARM_PROBE_HOME`，别污染 IDE 的真实数据根。

### P0-3 · 收口人工验收清单 + 修 onboarding 双源冲突

- **问题 A（验收尾账）**：✅ **已全部收口**（2026-10-03）——调试 8 项人工清单中 #1~#4/#6 由 e2e 覆盖，**#5（三态互斥）、#7（改键生效）本轮已自动化**（`debug-real.cjs` 新增 R-REAL-9/10/11/12，实测 **12/12 PASS**），**#8（真安装包验收）已完成**（出包链路修复 → 8.63 MB 安装包 → 安装至 `D:\OpenCharm` → `release-real.cjs` **7/7 PASS**）。SQLite v1.4 真机手测与双主题截图**已完成**（`db-real.cjs` 按 v1.4 重写，**18/18 PASS**）。**遗留仅 3 个产品缺陷待修**（D-6/D-7/D-8，见下）。
- **本轮新发现的产品缺陷（待修）**：**D-6**（SQLite 单元格详情面板无关闭按钮，中）· **D-7**（调试中运行菜单项未置灰，中）· **D-8**（改键后调试工具栏 tooltip 滞后，低）。证据与修法建议见 `debug_acceptance_record.md` §5.2 与 `sqlite_tool_dev_plan.md` §17.8。
- **问题 B（onboarding 双源）**：✅ **已消解**（2026-10-03，`onboarding_dev_plan.md` v1.3）——PR-S1/S2/S4 早已交付（`welcomeGuide.ts` 三步卡 + 功能巡礼 + force-show + 指南三入口，e2e OG-1..OG-9），计划状态回填完毕。**剩余可选缺口**：PR-S2 的欢迎页巡礼条目策展扩充、PR-S4 的两处小修是否补做——按需，不影响交付完整性。
- **⚠ v1.3 复核：D-6 / D-7 / D-8 三个缺陷全部未修**（逐条代码核对）：
  - **D-6 未修**：`sqliteTabs.ts:383-397` `showCellDetail()` 仍只 `append(head, body, copy)`，唯一按钮是「复制值」，面板无关闭路径。`sqlite_tool_dev_plan.md:1570` 仍登记为待修。
  - ~~**D-7 未修**~~ ✅ **已修 + 真机复核通过（2026-10-06）**：`main.ts::buildRunMenuItems` 不再自己写置灰条件，改为**复用 `computeRunWidget(s).runScript.disabled`**（与工具栏按钮同一判定式）。选择"复用"而非"补 `|| s.debugging`"的理由：原缺陷的根因是**同一判定在两处各写一遍**，只补一个条件下次还会漂移。**复核**：`e2e-real/debug-real.cjs` **14/14 PASS**——`R-REAL-10` 读到 `aria-disabled=true` / `.disabled=true` / `tip="调试进行中，请先停止调试"` 且与工具栏 tip 逐字一致、点击无新 toast、仍停在断点；正对照 `R-REAL-13`（停止调试后恢复可点）证明非恒真。
  - **D-6 未修**：`sqliteTabs.ts:383-397` `showCellDetail()` 仍只 `append(head, body, copy)`，唯一按钮是「复制值」，面板无关闭路径。`sqlite_tool_dev_plan.md:1570` 仍登记为待修。
  - **D-8 未修**：`settingsPanel.ts:959-964` 保存后刷新清单（applyEditorKeybindings / refreshSplitEditorOptions / refreshDbSqlOptions / repaintRunWidget / renderWelcomeShortcuts）**仍无 debugView**，settingsPanel 也未 import debugView；`debugView.ts:103-111` 的 `data-tip-key` 只在 renderToolbar/renderDebugView 时更新。
  - **本条是"报告没被执行"最直接的实例**：v1.2 把三条写成"建议动作 1/2/3"并估 0.5 人日，其中 **D-7 只需一行**，19 个提交里没有一个碰它——直到本版把它拆出来单独做。**教训已写进 §5：粗粒度人日估算会让一组小修被整体延后。**
- **建议动作**：
  1. ~~修 **D-7**~~ ✅ **已修并真机复核通过**（14/14，见上）；
  2. ~~修 **D-6**~~ ✅ **已修（2026-10-06）**：详情面板头部加 × + `Esc` 双通道关闭（Esc 监听模块级只注册一次，弹层打开时归弹层不顺手带走面板）；`e2e/db` **30/30**，DB-D-6 用例扩为回归钉（按钮关 / Esc 关 / 菜单优先）；
  3. ~~修 **D-8**~~ ✅ **已修（2026-10-06，最后一个）**：`debugView.ts` 新增 `refreshToolbarTips()`（按 `TOOLBAR_TIPS` 清单就地重写 data-tip / data-tip-key / aria-label，未初始化安全 no-op），`settingsPanel.ts` 保存清单在 `repaintRunWidget()` 后调用；新增单测钉住（改键 → refresh → `data-tip-key=F6` 且可逆）。**P0-3 三项全部关闭**（D-8 的真机 R-REAL-11 tooltip 断言待下次跑 debug-real 时转为 PASS 口径）。
  4. ~~出包阻塞~~ ✅ 已解决（VS Build Tools 2022 + `tools/msvc-env.ps1`；出包 → 安装 → `release-real.cjs` 7/7）。
- **成本**：~~D-7 + D-6 合计约 0.5 人日~~ ✅ 已花（D-7 约 15 分钟 + D-6 约 0.3 人日）；**余 D-8 约 10 分钟**（一行级）。
- **判断依据**（v1.3 修正论据）：在"再加 10 个功能"和"让已有 100 个功能被找到"之间，后者边际收益明显更高。~~尤其对单人自用场景，用户就是产品负责人本人~~——**该论据已随 ADR-0010 废止**。新论据更硬：**在"高性能 · 轻量"定位下，任何一个新功能都要同时付体积与维护成本，而修一个已知缺陷只减不增。**

### P0-4 · 偿还结构性债（拆分）—— ✅ **已裁决（2026-10-06）：折中路线「先冻结，再择机拆」**

- **问题（v1.3 重估）**：`env_cmds.rs` **4,945** 行（Rust 侧最大单文件，32 个命令；2026-10-06 起带冻结线注释 8 行）；`fs_cmds.rs` 3,882 / `git.ts` 3,204 / `main.ts` **2,919** / `git_cmds.rs` 1,940。
- **⚠ v1.3 新增判断**：`env_cmds.rs` / `fs_cmds.rs` / `git.ts` / `lsp/client.ts` 在 `ccf9da2 → bb32d77`（23 个提交）之间**仍是一行未变**；`main.ts` +17、`git_cmds.rs` +58。加上 v1.2 已确认的 `44c85ea → ccf9da2`（20 个提交）同样零变化——**这条建议已在两版报告里被写下、在 43 个提交里被执行 0 次**。
  **这不是"还没轮到"，而是"它被反复写进清单却从没排上"**：要么本轮真正排期，要么**显式裁决为"接受现状、从清单撤下"**并把 `budgets.toml` 的 `env_cmds_rs_max_lines` 从"拆分前防涨"的临时值改成长期值。第三种状态（挂着不动）只会持续消耗清单的可信度——这正是 §0 自我校验位要暴露的问题。
- **✅ 裁决（2026-10-06，产品负责人选定「折中：先冻结再择机拆」）**——三选一里的中间路线，落点有三条，**全部已生效**：
  1. **冻结线**：新增的 Python 环境类命令**一律落新文件**（如 `env_cmds_pkg.rs`），`env_cmds.rs` **只减不增**——纪律写在 `env_cmds.rs` 文件头（改的人第一眼就能看见）与 `ci/budgets.toml` 注释里。**记账**：为写这条纪律，本轮给 `env_cmds.rs` 新增 **8 行纯注释**（4,937 → 4,945），命令数不变；这是"只减不增"的唯一例外，且在此显式记账，不让它成为日后"注释也算涨"的口子；
  2. **上限改长期**：`env_cmds_rs_max_lines = 5050` 由"拆分前的临时值"改为**长期值**，不再预期它下降（理由同时写进 `budgets.toml`：它是 Rust 侧文件，不进前端产物、不影响冷启动，与 ADR-0010 的两个一等目标无关）；
  3. **拆分保持候选，排到阶段二、不设死线**：按解释器管理 / 包操作 / 版本探测切三块、目标 < 2,500（−49%）的工作量与风险不变，但不作为"必办"挂账。
  **为什么不选另外两条**："真拆"要 3~4 人日且当前无可复用的痛点驱动；"接受现状"省事但等于放弃任何约束——冻结线是**唯一当下就生效、且不会再次失信**的选项：它把"拆或不拆"的二选一，换成了一条不需要排期也能执行的规则。
- **建议动作**：
  1. ~~`env_cmds.rs` 按职责切三块~~ → **降级为阶段二候选**（见上，裁决已定；本轮不再作为 P0 待办挂账）；
  2. `main.ts` **仍需安排拆分**（v1.1 曾判"不必拆"是基于错误数字）：现在 **2,919**（D-8 +5），距 `budgets.toml` 的 3,000 上限只剩 **81 行**余量——**B4/B5 已各往里加过胶水，再进一个功能就会撞线**。至少把新功能外提；`git.ts` 保持观察（3,204，43 提交零变化）；
  3. ~~**新增（v1.3）**：给"连续两版挂账"的项设一个**二选一截止**~~ ✅ **已执行**：本轮就是对 `env_cmds.rs` 执行这条规则的结果（裁决 + 冻结线 + 上限改长期，三处落点均已完成）。**这条规则今后继续适用于任何"连续两版挂账"的项**——包括 P0-2 第一格（PyCharm 人工对标）若下一版仍为零进展，同样应走"要么做、要么显式撤下"。
  4. ~~建 `docs/delivery-overview.md`（交付总览）~~ ✅ **已交付**；README 索引 ✅ 补齐 39 篇；`python_ide_dev_plan_v2.md` §7 状态表 ✅ 已回填；`onboarding_dev_plan.md` 与 `multi_window_dev_plan.md` ✅ 均已回填（v1.3 / v0.2）。
- **成本**：本轮裁决的落地成本 **约 0.1 人日**（改 `budgets.toml` 注释 + `env_cmds.rs` 文件头纪律 + 报告口径）；真拆仍是 **3~4 人日**（保留为阶段二候选，不设死线）。
- **验收**：✅ **已按"折中"路线关闭**——① 冻结线已写进 `env_cmds.rs` 文件头；② `budgets.toml` 已改为长期上限并附理由；③ 拆分已降级为阶段二候选。**校验方式（下次复核时看这个）**：`env_cmds.rs` 的行数**不再增长**（若涨了，说明冻结线没被当回事，应升级回"必拆"）。

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

- 现状：一键打包（`build-release.ps1`）+ NSIS 出包已落地，但**没有更新通道**，也没有版本回滚（`shell/src-tauri/Cargo.toml` 无 updater 依赖）。~~自用项目也要面对"我这版是不是装错了"~~
- **⚠ v1.3 优先级上调**：原论据（"自用项目也要面对…"）是**弱化版**——定位转对外后，更新通道从"锦上添花"变成**分发可信度的基本项**（用户装完不会自动知道有新版，也不会知道装的是哪一版）。**登记为 TD-025 第 2 条待复审**；若 `CONTENT-SERIES.md` 的连载发布拍板，本项应提前到阶段二。
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
- **v1.3 复核**：
  1. **门禁本体仍在生效**——本机 `budget-check.mjs` 十项里 **9 PASS / 1 FAIL**（`style.css` 5,987/5,850），说明它确实在拦东西（→ 升级为 **P0-0**）。
  2. **⚠ 发现产物体积项会误报**：`dist/` 陈旧时报 7,065 KB（FAIL），重新构建后 4,988 KB（PASS）。修法见 P0-0 动作 1。**这是 v1.2 交付的脚本里唯一一处口径缺陷，性质与 v1.1 的行数口径错误同类。**
  3. **⏳ 它不在 `ci.yml` 主门禁里**（只在 nightly 的 `budget` job，而 nightly 无跑通证据）。在「体积是一等目标」下建议并入 `ci.yml`（P0-1 子项 5）。
- **验收状态（v1.3）**：✅ 机制已落地并已真实触发一次失败；⏳ 待补 dist 新鲜度校验、并入主门禁。
- 成本：实际约 0.5 人日；**余量约 0.2 人日**（P0-0 动作 1）。

### P1-4 · 补齐真机 e2e 覆盖的关键路径

现有 **10 个 `.cjs`** 已覆盖 debug / db / endpoints / multi-window / new-project / ui / release / probe 三支（nightly 编排其中 9 套串行）。按功能域继续补齐：**LSP 真引擎（pyrefly 裸会话）、运行真 `uv run`、终端真 PTY、插件真加载**。优先补**跨进程链路**类（最容易出集成缺陷），纯前端交互交给 mock 层。
成本：每域约 0.5~1 人日。**v1.3 备注**：B4 HTTP 工具（跨进程 reqwest）目前**只有 mock 层 e2e**，是本项里性价比最高的下一个目标。

### P1-5 · 偿还 TD-021 五小项

5 个 P4 项，其中 **① 终端背压 UTF-8 口径**（CJK 下阈值放宽 3 倍）与 **③ tab 快照保头弃尾**（丢最近打开的 tab）在中文 Windows 自用场景下有实际体感，建议优先。其余三项按"顺手"原则处理。
成本：合计约 1~2 人日。

### P1-6 · 插件 v2 议题启动（择一）

`plugin_system_design.md` §10 列出 5 个全局待决策点 + 9 个切片决策。v2 议题里**性价比最高的是"工作区级插件目录"**（加载器只是多一个扫描根，非破坏性扩展，且能让插件随仓共享）。硬沙箱（iframe/Worker）与 Python 工具桥成本高、~~收益对自用场景有限~~**（原"自用"论据已废止，改判为：二者都会显著增加常驻开销与产物体积，与 ADR-0010「默认轻量 / 体积是卖点」直接冲突——这是比原论据更硬的否决理由）**，建议继续延后。登记为 TD-025 第 5 条待复审。
成本：工作区级目录约 1 人日。

---

### P2-1 · UI 视觉「批 6+」第二阶段（可选，非必需）

v1.0 的 P0-3（视觉改造）在 `964ea7e` 已**全部交付**（六批 + ADR-0005 + 真机 32/32）；v1.2 后另有两处主题修复（修记 A 滚动条变红 / 修记 B 行号色死映射）。本项仅登记后续可能方向，**不排期**：材质细节再深化、`opencharm-dark/light` 语法色与外壳的进一步同色、字体副档（如无衬线 UI 字体随包，v1.0 已裁决不做）。若开，须沿用 `ui_premium_dev_plan.md` §6 的批次入口 + §4 门禁（`audit_tokens.py` **现已进 CI** + token 单测 + e2e computed-style 断言 + 截图比对），且**不得往 `main.ts`（现在 2,919 行，余量仅 81 行）堆逻辑**——**更不得往 `style.css` 堆**，它已在 5,748 / 5,850（P0-0 拆分后回到绿灯），但拆出的 `styles/http.css`（102/125）与 `styles/logView.css`（170/205）各有上限，静默增长在新文件里同样会被拦。

### ~~P2-2 · 多窗口阶段 1/2 复核与收口~~ ✅ 已关闭（2026-10-03）

`multi_window_dev_plan.md` 已升 v0.2，阶段 0/1/2 状态栏与实施记录按代码实测回填完毕（后端 7 文件 22 处 `emit_to` + 前端 8 文件窗口级 `listen`），真机 `multi-window-real.cjs` 16/16 PASS，DoD 四条逐项对账关闭。本项从清单移除；#4~#6（依赖健康缓存）经拍板暂缓，仍在 `multi_window_dev_plan.md` 里跟踪。

### P2-3 · 跨仓库/跨机器设置同步

`settings.json` + 键位 + live templates + import 别名学习表导出/导入（storagePanel 已有迁移基建可复用）。多机开发时价值明显。
成本：约 2 人日。

### P2-4 · Web 侧能力（远程/WSL/SSH）

成本高、与 **Windows 单机 / 本地优先** 的定位契合度低（原表述"Windows 单机自用画像"中的"自用"已随 ADR-0010 废止，但**结论不变**——本地优先仍是对远程方案的否决理由）。建议**只登记不排期**，除非出现明确使用场景。

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
| ~~B4~~ | ~~**HTTP Client**（`.http` 文件）~~ | ✅ **已交付**（2026-10-05，`2e5634b`，3 个 PR 闭环）。**落地形态与原议不同**：不是 `.http` 文件语言，而是 **devtools 面板驱动**（内核 `http_cmds.rs` reqwest + 发送/响应 + 变量/历史 + curl 导入 + 端点联动）；原 `.http` 语言注册整块取消，总量 7~9d → 4.5~6d。真源 `docs/toolbox_dev_plan.md` §5.9–5.11 | 已花 4.5~6d | 门禁 1145/1145 + `e2e/http/` 12 条 |
| ~~B5~~ | ~~**日志/输出结构化视图**~~ | ✅ **已交付**（底部「运行日志」tab，3 个 PR 闭环：多播采集 + 级别过滤 + 字段折叠/导出）。真源 `docs/toolbox_dev_plan.md` §6.10–6.12 | 已花 4~5d | 门禁 1208/1208 + `e2e/logs/` 11 条（后续另有 2 个视觉修复） |
| ~~B6~~ | ~~**TODO/任务与文档工具**~~ | ❌ **终止**（2026-10-06 裁决，`toolbox_dev_plan.md` §7.7）。**PR-B6-3 TODO 增强保留**（过滤 + 分组 + 跳转 + 计数，19 例单测 + `e2e/todo/` 7 条）；**Markdown 大纲与 Mermaid 取消**。状态"部分交付后终止，不得再排期" | 已花 0.5d | **终止理由直接引用 ADR-0010**：Mermaid 是唯一引入新依赖（约 2~3 MB min）且唯一带未验证项（CSP 无 `unsafe-eval` / DOMPurify 白名单 / 体积）的一项，"与性能与体积是一等目标直接冲突"。**这是定位变更后第一次真的砍掉一个已在清单里的功能——新方向有约束力，此为正面证据** |

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
| **P0-0 预算回到绿灯** | ★★★★★（**定位变更后是硬约束**） | 0.4d | — | ✅ **已关闭** |
| 　其中：产物体积加 dist 新鲜度校验 | ★★★ | 0.2d | — | ✅ **已完成**（STALE 判定） |
| 　其中：`style.css` 拆出 B4/B5 样式分文件 + audit @import 解析 | ★★★★★ | 0.2d | — | ✅ **已完成** |
| **P0-1 子项 7：裁决 CI 落点**（Gitee 不跑 Actions，护栏无宿主） | ★★★★★ | 0.1~1d（视落点） | **需产品负责人裁决**：GitHub 镜像 / Gitee Go / 不在本仓跑 | ★★★★★（**缺口 1 的唯一未决项**） |
| 　其中：子项 5 预算门禁并入 `ci.yml`（✅ 已完成）+ 子项 6 性能基线（✅ 已落盘） | ★★★★★ | 极小 | — | ✅ **已关闭** |
| ~~**P0-3 D-6/D-7/D-8**~~ | ★★★★ | 0.5d | — | ✅ **全部关闭**（D-7 真机 14/14 · D-6 e2e 回归钉 · D-8 单测钉） |
| P0-2 Gate D 两格 PENDING + trace 调参 | ★★★★★ | 中（载体与工具已就绪） | **纯人工操作** | ★★★★（**连续两版零进展，降级观察**） |
| ~~P0-4 `env_cmds.rs` 二选一裁决~~ | ★★★★ | ~~中~~ 0.1d（本轮） | — | ✅ **已裁决（折中：冻结线 + 上限改长期 + 拆分降级为阶段二候选）**；`main.ts` 外提仍是硬需求（余量 81 行） |
| 　P0-1 子项 7 CI 落点裁决 | ★★★★★ | 0（本轮只做标注） | — | ✅ **已裁决（维持现状）**：`.github/workflows/` 定位为"将来推 GitHub 的预埋"，P0-1 余项转为"迁移后首次触发验证" |
| ~~P0-3 验收尾账 + onboarding 双源裁定~~ | ★★★★ | 中小 | — | ✅ **已交付**（**余 D-6/D-8 两个缺陷；D-7 已于 2026-10-06 修**） |
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
| ~~P0-1 CI 主干触发 + nightly + bench 入 CI~~ | ★★★★★ | 极小 / 中 | — | ⏳ **配置已交付（含预算门禁入主门禁），但宿主错配 → 零跑通证据**（见 P0-1 子项 7） |
| ~~P1-3 体积/性能预算断言~~ | ★★★ | 极小 | 搭 P0-1 | ✅ **已交付**；**十二项全 PASS**（`style.css` 5,748/5,850）；**已并入 `ci.yml` test job** |
| ~~B3 SQLite 工具~~ | — | — | — | ✅ **已交付 v1.4** |
| ~~B4 HTTP 请求工具~~ | — | — | — | ✅ **已交付**（devtools 面板形态，非 `.http` 文件） |
| ~~B5 结构化运行日志~~ | — | — | — | ✅ **已交付** |
| ~~B6 TODO/文档工具~~ | — | — | — | ❌ **终止**（保留 TODO 增强，取消大纲与 Mermaid） |

---

## 5. 路线图建议

> 按**主题泳道**而非时间盒排列；每阶段**只开 2 条泳道**（单人维护 **93.8K 行**的现实约束）。v1.0 阶段一铺了 4 条，与"只开 2~3 条"自自相矛盾，v1.1 已收敛。
>
> **⚠ v1.3 对本章的方法论修正**：v1.1/v1.2 的阶段一都是"清单式"（列 N 条建议动作 + 估人日），结果 19 个提交里一条没做。**本版阶段一改成"4 件可在 1 小时内各自完成的具体动作"**，且**不设人日估算**——估算越粗，越容易被整体延后（P0-3 的 0.5 人日就是这么把三个缺陷一起拖住的）。

### 阶段一 · 通电期（4 件小事，无新增功能）

| # | 动作 | 预计耗时 | 关闭条件 |
|---|---|---|---|
| 1 | 修 **D-7**：`main.ts::buildRunMenuItems` 改为复用 `computeRunWidget(s).runScript.disabled`（真源 `runFlow.ts:302`） | ✅ **已完成 + 真机复核 14/14** | 调试进行中，运行脚本菜单项与按钮一致置灰（已由 `R-REAL-10` + 正对照 `R-REAL-13` 证明） |
| 2 | ~~**P0-0**：`style.css` 拆出 B4/B5 样式分文件~~ | ✅ **已完成**（5,987 → 5,748 + 两个分文件；预算十二项全绿；audit_tokens 加 @import 解析） | 十二项全绿 |
| 3 | **P0-1**：~~跑一次 `collect-metrics.ps1`~~ ✅ 已完成（956ms / 339MB）；~~push 一次 master 看 Actions 触发~~ → ⛔ **作废**（本仓远端只有 Gitee，Actions 不会被调度）；✅ **CI 落点已裁决为「维持现状 + 文档标注」**（`.github/workflows/` = 将来推 GitHub 的预埋）；✅ 顺带完成子项 5：预算门禁并入 `ci.yml` | ✅ 已裁决（0 额外成本） | ⏳ **外置**：迁移到 GitHub 后首次 push 的 Actions run 记录（**触发条件外置，谁推谁验**；在此之前缺口 1 保持开启但不消耗人力） |
| 4 | **P0-2 第一格**：在 PyCharm 里按 `gate-d-ab-worklist.md` 勾 23 点 → 产出 `gate-d-ab.md` | ~1 小时 | 工作单 PyCharm 列填满；`intel/README.md:47` 状态改为 ✅ 或 ❌ |
| — | ✅ **附带已完成**：`budget-check.mjs` 加 dist 新鲜度校验（STALE 判定），消除产物体积的假警报 | ✅ 已完成 | 陈旧 dist 报 STALE 而非虚高数字 |
| — | ✅ **附带已完成**：**P0-2 第二格**——真实项目 trace 采集跑通（`metawake/backend`：277 条 / 覆盖率 79% / 606 B 每条） | ✅ 已完成（约 0.3 人日） | `bench/reports/trace-stats.md` 换成真实项目样本；保留窗口建议 8,192 → 13,836 条；`STALE_HITS_DIVISOR` 维持 2（样本未达 1000） |
| — | ⏳ **附带待办**：再采 1~2 个真实项目，把跨项目样本累计到 **≥1000 条**后复核降权参数 | ~0.3 人日/项目 | 累计 ≥1000 条；在此之前降权系数只作"建议值" |

**阶段门**：~~`budget-check.mjs` 十项全绿~~ ✅（**十二项全绿，且已并入 `ci.yml` 主门禁**）· ~~`bench/reports/metrics-*.md` 存在~~ ✅ · ~~D-7 已修并复核~~ ✅（D-6 / D-8 亦已修）· ~~CI 落点裁决~~ ✅ **已裁决（维持现状 + 文档标注）** · ⏳ **Gate D 第一格**（PyCharm 点 23 下）——**这是阶段一唯一未完成的动作，且是纯人工**。
**§0 缺口 0 已关闭；缺口 1 从"待办"降级为"待外部事件"（推 GitHub 时验）；缺口 2 从"零数据"变为"有真实样本但样本量不足"。**
**阶段一的 4 件小事：3 件已完、第 4 件（PyCharm 人工对标）是唯一剩余，且它不需要写代码。**

### 阶段二 · 深化期（约 6~10 周，2 条泳道）

| 泳道 | 内容 |
|---|---|
| 差异化 | A1 运行时热点 + A3 签名提示（共用 intel 数据层）；**前置**：P0-2 第二格（真实项目采一次 trace，≥1000 条观测） |
| 基本功 | ~~D-6 / D-8 两个残留缺陷~~ ✅ 已修 · **`main.ts` 外提（余量仅 81 行，B4/B5 已加过胶水，再进一个功能就撞线）** + `env_cmds.rs` 真拆（−49%，**阶段二候选、不设死线**；本轮的冻结线已在生效，行数不再增长即可） |

**阶段门**：热点视图对"死代码"的误报率可接受；~~`env_cmds.rs` 状态**明确**~~ ✅ 已明确（**长期上限 + 冻结线**，见 P0-4 裁决）；✅ `delivery-overview.md` 已补录 B4/B5 并升 v1.1；✅ 用例基线已刷新为 1215。**`main.ts` 外提成为本阶段唯一的结构性必办项。**

### 阶段三 · 画像期（约 10~18 周，2 条泳道）

> **v1.3 重排**：候选池里的 **B4 / B5 已在阶段一之前被提前交付**，B6 已终止。B 类只剩 B2（REPL）与仍与裁决冲突的 B1（pytest）。因此本阶段的一条泳道改由 A 类画像专项独占，另一条给工程侧。

| 泳道 | 内容 |
|---|---|
| 画像专项 | A4 爬虫工具箱 或 A5 FastAPI 增强（建议先做与当季实际工作最相关的那个）。**B4 HTTP 工具已交付，A4/A5 现在有了现成基建可复用，成本比 v1.2 估的低** |
| 可选 / 债务 | B2 REPL / Scratch + P1-4 真机覆盖补全（LSP 真引擎 / 运行真 `uv run` / 终端真 PTY / 插件真加载）+ P1-6 工作区级插件目录 |

### 阶段四 · 评估期（18 周后）

回头看阶段二/三的真实使用率（**依赖 P1-1 的埋点——该条在 v1.2 之后仍是 0 进展，若阶段二结束仍未做，阶段四的评估将无数据可用，需降级为"人工回忆式评审"**），决定：A2 Profiler 是否立项、B1/C 类是否值得修订裁决、P2-1 UI 批 6+ 是否开工、D 类是否启动。**没有使用数据的功能等于没有交付**——这一点应在阶段二就靠埋点准备好。

> **另需回头评估的一项**：TD-025「自用论据失效复审清单」6 条（nightly 只告警 / 更新通道 / Inter 字体 / Watches localStorage / 插件沙箱 / HTTP 私网提示）。若产品走向对外分发（根目录 `CONTENT-SERIES.md` 的连载发布策划一旦拍板），**第 1、2 条（告警与更新通道）的优先级应提前到阶段二**——对外用户不会去看 GitHub artifact。

---

## 6. 双约束：维护成本 + 性能与体积（v1.3 重写）

> **⚠ 本章标题与论据在 2026-10-05 已过期**：原章名「单人项目最大的长期风险」以「单人自用」定位为论据。ADR-0010 废止该定位后，本章重写为**两条并列的长期约束**。历史论据的失效清单登记在 `docs/tech-debt.md` **TD-025**（6 条），本轮按裁决不逐个复审——**读 v1.2 及更早的文档时须记住「论据过期 ≠ 结论错误」**。

**约束 A · 维护成本**：`dev_plan_v2` §9 风险登记册已列「长期维护负担 — 自研组件全部独立成包/进程」。**93.8K 行代码 + 39 篇文档 + 194 个命令**（v1.3 实测）的现实下，这条风险的量级继续上升。三条对策（每条对应上文一个可执行项）：

1. **降低"知道项目在哪"的成本**：`docs/delivery-overview.md` 是杠杆最高的一项——它同时服务未来的自己和任何接手的会话。**v1.3 现状：版本头仍 v1.0（2026-10-03），§2 表未收录 B4/B5，用例基线仍写 1070**（见 §1.5 三条不一致）。
2. **降低"改坏不知道"的成本**：nightly 真机 + bench 红线 + `budget-check.mjs`（P0-1）。**v1.3 现状：配置齐备但零跑通证据**——第二双眼睛装好了，还没通上电。这是本章唯一"几乎零成本就能闭合"的一项。
3. **降低"升级不敢动"的成本**：`ci/versions.toml` 已锁定 9 类依赖，但「升级回归 CI 自动化」仍标 ⚠️。建议把"每月一次依赖升级演练"固化成 nightly 的一个可选 job（装新版本 → 跑 bench → 出对比报告，不自动合入），把升级从"事件"变成"例行公事"。

**约束 B · 性能与体积（ADR-0010 新增，一等目标）**：这是 v1.2 完全没覆盖的维度。三条对应条款里，**当前状态最差的是"没有基线"**：

| 条款 | 现状 | 缺口 |
|---|---|---|
| 预算先行（`ci/budgets.toml`） | ✅ **十二项全 PASS**（style.css 5,748/5,850，B4/B5 已拆分文件并各设上限） | 已关闭（2026-10-06）；⚠ 产物体积项依赖 dist 新鲜度，STALE 判定已加 |
| 运行时开销红线（probe < 1.5x，当前 1.35x） | 有历史实测，改采集路径的 bench 回归义务已写进规范 | 保持即可；**A2 Profiler 若立项须重定口径** |
| 冷启动 < 1.5s / 空闲内存 ≤ 600MB | ✅ **首个基线已落盘** `bench/reports/metrics-20261006-091652.md`：冷启动 956 ms / 内存 339 MB，双红线 PASS（run1 2619ms 为冷缓存首跑，run2/3 = 117/132ms） | 本机基线有了；⏳ CI/nightly 尚未跑过（→ 缺口 1）。**对比后续实测时应剔除冷缓存首跑** |

**两条约束的交汇点在于：新增功能是同时加重两者的唯一动作。** 23 个提交里 +5.1K 行、+319 行 CSS、+2 个命令，换来 B4/B5 两个功能与 B6 的一次终止——**B6 是第一次因为约束 B 而否决功能**，说明新方向确实进入了决策。下一步要让它同样进入"默认不做"的默认态。

---

## 7. 明确不做（维持现有裁决）

按强度分三档：**不做**（明列裁决）· **推迟**（已裁决但可复议）· **登记不排期**（契合度低，出现明确场景再议）。

| 不做 | 强度 | 理由 |
|---|---|---|
| pytest 面板 / 测试运行器 | 不做（三处一致：dev_plan §1.1 · UX 报告 F-1 已裁决 2026-09-25 · 库支持研究 §8） | 维持现状；若要推翻须先修订 §1.1（见 B1） |
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
| 硬沙箱插件（iframe/Worker）/ Python 工具桥 | 推迟 | 成本高，且**增加常驻开销与产物体积**（与 ADR-0010 冲突）；工作区级插件目录已足够。原"自用场景收益有限"论据已废止，结论不变（TD-025 第 5 条） |

---

## 8. 待补充 / 本报告未覆盖

- ⏳ **probe/intel 的实际运行数据**——`tools/intel/trace_stats.py` 已落地。首个样本（2026-10-03，合成/单文件）56 函数 / 177 观测；**2026-10-06 第二轮取得真实项目样本**：`metawake/backend` 跑其 13 条测试 → **277 函数观测 / 176 参数类型 / 277 返回类型 / 7 异常 / 164 KB**，**覆盖率 79%（277/350 def）**，hits 均值 4.3 / p50 2 / p99 56 / max 60，**606 B/条**（据此把保留窗口建议从 8,192 改为 13,836 条）。**⚠ 仍 ⏳ 的理由变了**：不再是"没有真实数据"，而是"**真实数据已有但样本量不足**"——277 条距 ≥1000 差 3.6 倍，且单项目已近饱和，须**跨 ≥2~3 个真实项目累计**。`STALE_HITS_DIVISOR` 仍为 2，`intel/README.md` 三处状态戳仍 ⏳。**降权系数是"有两个真实/合成样本支撑的建议值"，不是"已定"。**
- ✅ **已补**（2026-10-03）：`shell/e2e-real/` 真机状态——`db-real.cjs` **按 v1.4 契约整体重写并实测 18/18 PASS**（旧 S10.x 侧栏态用例引用的 id 已被 v1.4 重设计整体移除，旧脚本在 v1.4 下根本跑不过，这是"真机待办"长期挂起的隐藏副作用）；`debug-real.cjs` **扩到 12/12 PASS**（新增 R-REAL-9/10 三态互斥、R-REAL-11/12 改键生效）。详见 `sqlite_tool_dev_plan.md` §17.8 与 `debug_acceptance_record.md` §五。
- ✅ **已补**（2026-10-03）：**真安装包验收（调试 §五 第 8 项）** —— 阻塞已解决（VS Build Tools 2022 + `tools/msvc-env.ps1` 进程级环境装配），打出安装包 8.63 MB 并安装至 `D:\OpenCharm`，四项自研组件随包落地；`e2e-real/release-real.cjs` 对**安装后的程序**实测 **7/7 PASS**（含 debugpy 随包可用、运行脚本真实输出）。详见 `debug_acceptance_record.md` §5.1 与 `bench/reports/release-build-blocker.md`。
- ✅ **产品缺陷 D-6 / D-7 / D-8 全部修复（2026-10-06，v1.3 复核时三个均未修）**：**D-7** 菜单复用 `computeRunWidget`（真机 14/14，`R-REAL-10` + 正对照 `R-REAL-13`）；**D-6** 详情面板 × + Esc 双通道（`e2e/db` 30/30 含回归钉：菜单优先语义也钉住了）；**D-8** `debugView.refreshToolbarTips()` 进 settingsPanel 保存清单（单测钉住改键/还原可逆）。详见 `debug_acceptance_record.md` §5.2（三条均已关闭）。
- ⏳ **出包环境的两个易复发点**（已修但值得记住）：① VS Build Tools **必须管理员安装**，否则实例不入注册表、`vswhere` 查不到，cargo/cc 会静默回落 VS2015；② PowerShell 的 `$ErrorActionPreference="Stop"` 会把 cargo 的 stderr 进度行当致命错误（`build-release.ps1` 已用 `Invoke-Native` 兜住）。另：安装包 `/S` 静默安装在本机无效，验收需走"安装后程序 + CDP"。
- ✅ **已补**：多窗口阶段 1/2 的真实完成度——`multi_window_dev_plan.md` v0.2 已按代码实测回填（后端 7 文件 22 处 `emit_to` + 前端 8 文件窗口级 `listen`）。
- ✅ **打包产物的实际体积与冷启动/内存的实测值**（2026-10-06 本轮补齐）：产物体积 **4,989 KB / 上限 5,120 KB PASS**（此前 7,065 KB 是 `dist/` 陈旧产物混入已取消的 mermaid/katex 所致，`budget-check.mjs` 已加 STALE 判定）；**首个性能基线** `bench/reports/metrics-20261006-091652.md`（release 重建 + `-Runs 3`）：冷启动 **956 ms**（<1500 PASS）· 内存 **339 MB**（≤600 PASS）。⚠ run1 2619 ms 为冷缓存首跑（run2/3 = 117/132 ms），后续对比应剔除。⏳ 仍缺：CI/nightly 侧跑通（→ 缺口 1）；soak 长跑（-SoakMinutes 10，本轮 SKIP，建议随 nightly 首跑一起补）。
- ⏳ **真机层的"告警没人看"问题**：nightly 只告警不阻断，护栏依赖人主动看 artifact。彻底解法是接通知渠道（Windows 通知 / 邮件），本轮未做。**v1.3 补充：这条的原论据是"自用项目没人盯 CI"，该论据已被 ADR-0010 废止，复审登记为 TD-025 第 1 条**——若产品走向对外分发，它不再是"可选优化"而是分发可信度问题。
- ⏳ **对外分发策划待拍板**：根目录 `CONTENT-SERIES.md`（v1.0 · 2026-10-04，《造 IDE 的 45 天》十篇连载，公众号 + 视频号）状态为"待你拍板"，**不在 `docs/` 下，未被任何交付文档引用**。若拍板对外发布，会连锁抬高 TD-025 第 1/2 条（告警通知 / 更新通道）与本条之上的性能基线需求——**建议在阶段一就先给个结论，否则后续排期会在"自用"与"对外"两套标准之间反复横跳。**

---

## 9. 取数方法与复核触发条件（v1.2 建立，v1.3 增补）

本报告是**快照文档**，且已**三次**证明会过期：v1.0 基线 `44c85ea` 在 20 个提交内出现 3 处失效结论（§0 缺口 3 / P0-3 / B3）；**v1.1 更糟——它自己的数字就是错的**（用了在 gb2312 代码页上丢行的 `Get-Content .Count`）；**v1.2 则把"配置写好了"记成了"能力已交付"**——CI/nightly 至今零跑通证据，P0-3 的三个缺陷一个没修。

**因此 v1.2 的核心改动是：取数口径从"文档里的命令"变成"仓库里的代码"。v1.3 再补一条纪律（见禁则 5）：不要把"配置/清单就位"记成"已交付"，交付与否以证据文件是否存在为准。**

| 动作 | 命令 |
|---|---|
| **本文所有规模数字（一次拿全）** | **`node tools/stats/repo-stats.mjs`**（`--no-write` 只打印） |
| 规模预算断言（超限非零退出） | `node shell/scripts/budget-check.mjs`（`--report` 只打印 / `--no-write` 不落盘） |
| **产物体积断言前必须先构建** | `cd shell && npm run build`（否则 `dist/` 陈旧 → 体积项可能误报 ±2 MB，见禁则 4） |
| 确认取数时点 | `git rev-parse --short HEAD`（本文数字对应 **`bb32d77`**） |
| 性能红线实测（冷启动 / 内存） | `powershell -File bench\collect-metrics.ps1 -Runs 3`（✅ **2026-10-06 首次落盘** `bench/reports/metrics-20261006-091652.md`：956 ms / 339 MB；⚠ run1 为冷缓存首跑，对比看中位） |
| **确认 CI 宿主（跑本节任何 CI 命令之前）** | `git remote -v` —— **无 GitHub 远端则 GitHub Actions 不会执行**（本仓当前只有 Gitee，见取数禁则 5） |
| 门禁 | `node shell/scripts/gate-tests.mjs unit\|e2e\|e2e-ui`（**不要直接跑 `vitest`**，本机会被判为 watch 并杀进程） |
| token 门禁 | `python tools\ui\audit_tokens.py`（98 项检查，退出码非 0 即失败） |
| trace 库统计（Gate D 调参） | `python tools/intel/trace_stats.py`（只读；`--out <报告>`） |
| Gate D 人工对标工作单 | `set OC_GATE_D_WORKLIST=<路径>` + `cargo test -p opencharm-intel -- --nocapture runtime_completion_accuracy` |
| 真机层（本机一键全量） | `powershell -File shell\e2e-real\run-real-all.ps1`（串行；`-Only` / `-Skip` / `-Strict`） |
| 真机层（单套件） | `cd shell && set "OC_JSON_OUT=<路径>" && node e2e-real\<name>.cjs` |

### ⚠ 取数禁则（前三条是 v1.2 踩过的坑，后两条是 v1.3 新增）

1. **禁止用 `Get-Content $f`（不带 `-Encoding`）统计行数。** 本机 PS 5.1 的 ANSI 代码页是 **gb2312**；对**无 BOM 的 UTF-8 源文件**它会按 GBK 解码并**吞掉换行**——实测 `style.css` 报 5,410（真实 5,668，少 4.5%）、`main.ts` 报 2,503（真实 2,897，少 13%）。丢失比例随 CJK 密度而变、**逐文件不同**，所以这批数字"看起来合理但系统性偏低"，极难自查。
   正确写法任选其一（三者对同一文件必然同值）：`Get-Content -Encoding UTF8 $f` · `[System.IO.File]::ReadAllLines($abs)` · `node -e "..."`（按 `\r?\n` 切分）。
2. **禁止用 `Measure-Object -Line`。** 它不计空行（`style.css` 上给 5,145，比真实值少 523）。
3. **含中文的 `.ps1` 必须带 UTF-8 BOM。** 否则同样被 GBK 解码成乱码并**直接语法报错**（不是静默出错，是脚本跑不起来）。仓库既有约定：`bench/collect-metrics.ps1` 是唯一含中文的 `.ps1`，它就带 BOM。`budget-check.mjs` 已把这条做成门禁。
4. **【v1.3 新增】跑产物体积断言前必须确认 `dist/` 是新的。** `budget-check.mjs` 的体积项数的是 `shell/dist/assets` 下 `.js + .css` 的字节和；`dist/` 陈旧时会把**已删除的依赖分包**继续算进去。实测：陈旧 dist 报 **7,065 KB（FAIL）**，`npm run build` 后 **4,988 KB（PASS）**——差额约 2.08 MB 全是**已被取消的 mermaid/katex 分包**（`cynefin` 654 KB + `wardleyDiagram` 640 KB + `katex` 261 KB + 其余 diagram 分包）。**这是与禁则 1 同类的"看起来合理但系统性错误"**：它不会报错，只会给出一个偏大的数字。修法见 P0-0 动作 1（给脚本加 dist 新鲜度校验）。
5. **【v1.3 第二轮新增】不要把"仓库里有 workflow"当作"CI 在跑"。** 判定 CI 是否成立必须**先确认宿主**：`git remote -v` 里有没有 GitHub 远端（Gitee / 自建 GitLab **不执行** `.github/workflows/`）。本仓 2026-10-06 查出只有 `gitee.com/usedel/opencharm`——此前两版报告里"CI 配置已交付 / 待观察首次触发"的记账全部建立在一个不存在的执行前提上。**顺序：先查宿主 → 再看配置 → 最后才谈证据。**
6. **【v1.3 新增】不要把"配置/清单就位"记成"已交付"。** 判定交付以**证据文件是否存在**为准：CI 是否真的触发过 → 看 Actions run 与 `bench/reports/metrics-*.md` / `budget-*.md`；Gate D 是否推进 → 看 `gate-d-ab-worklist.md` 的 PyCharm 列是否被勾、降权常量是否被改；缺陷是否修 → 看代码行。**v1.2 就是因为把前两者记成 ✅，才在 19 个提交后发现三项零进展。**

**复核触发条件**（满足任一即需重取数字并更新本文头部「取数时点」）：① HEAD 变动 ≥ 10 个提交；② 任一专项验收收口（debug / db / ui / run / toolbox）；③ 季度评审；④ 任何专项 `*_dev_plan.md` 状态从"未开工"转"已交付"；⑤ **【v1.3 新增】定位 / 铁律 / 预算发生任何变更**（如 ADR-0010 这类会改变评判坐标系的事件，**优先级高于 ①~④**）。**重取一律走 `tools/stats/repo-stats.mjs` + `budget-check.mjs`，不要手敲命令。**

**v1.3 自查：本报告自身的"建议执行率"**（下次复核时先算这个数）
基线 `ccf9da2` → `bb32d77` 共 23 个提交，v1.2 的 P0 建议执行情况：

| 建议 | 是否被执行 | 证据 |
|---|---|---|
| P0-4 `env_cmds.rs` 拆分 | ❌ 0 | 4,937 行未变（**该窗口内**） |
| P0-4 二选一裁决（v1.3 第二轮补做） | ✅ 1 | 2026-10-06 裁决为**折中**：冻结线写进 `env_cmds.rs` 文件头、`budgets.toml` 上限改长期值、拆分降级为阶段二候选（不设死线） |
| P0-2 Gate D 两格人工 | ⚠ 半格（第一格 ❌ / 第二格 ✅） | 第一格：工作单 23 行仍全 `☐`（纯人工，未做）；**第二格：`trace-stats.md` 已换成真实项目样本 277 条（覆盖率 79%，606 B/条）**；`STALE_HITS_DIVISOR` 仍 2（样本未达 1000，不改） |
| P0-3 修 D-6 / D-7 / D-8 | ✅ 3/3 | **D-7 真机复核通过**（14/14）· **D-6** × + Esc 双通道（e2e/db 30/30 含回归钉）· **D-8** `refreshToolbarTips()`（单测钉住可逆） |
| P0-0 产物体积口径 + 预算回绿 | ✅ 2 | dist 新鲜度 STALE 判定；style.css 按主题拆分（5,987 → 5,748）+ audit_tokens 加 @import 解析 |
| P0-1 性能基线 | ✅ 1（本版新增后即补） | `bench/reports/metrics-20261006-091652.md` 首个基线（冷启动 956ms / 内存 339MB）；CI 触发验证仍缺 |
| P0-1 拿到 CI/nightly 跑通证据 | ❌ 0（**本轮定性：不是"没跑"，是"没有宿主"**） | `bench/reports/` 无 `budget-*.md`（CI 产物）；根因为远端只有 Gitee → Actions 不执行。已改为待裁决（P0-1 子项 7） |
| P0-1 子项 5 预算门禁并入 `ci.yml` | ✅ 1（本版第二轮新增后即补） | `ci.yml` test job 已加"体积与规模预算断言"步骤，本机重建 dist 后十二项全 PASS |
| P1-1 可观测性三件套 | ❌ 0 | 无埋点模块 |
| 非建议项（新功能 B4/B5/B6-3） | ✅ 3 | 均已交付（B6 后终止） |
| 唯一践行"守门禁"的项 | ✅ 1 | **B6 因体积条款被终止**（ADR-0010） |

---

## 附：本报告引用的关键文档

| 文档 | 用途 |
|---|---|
| **`docs/adr/0010-performance-lightweight-charter.md`** | **【v1.3 新增，定位真源】** 定位转「高性能 · 轻量」，性能与体积升为一等目标；数值维持现值不动、门禁策略本轮不改、历史「自用」论据不逐个复审（→ TD-025）。**本文 §0 / §6 / §7 的重排依据** |
| **`docs/toolbox_dev_plan.md`** v1.5 | **【v1.3 新增】** B3/B4/B5/B6 真源：§5.9–5.11 B4 HTTP 工具 · §6.10–6.12 B5 运行日志 · §7.7 **B6 终止裁决（Mermaid 因体积条款被砍）** |
| `CONTENT-SERIES.md`（仓库根目录，不在 `docs/`） | **【v1.3 新增】** 连载发布建议 v1.0（2026-10-04，公众号 + 视频号，十篇主线），状态「待拍板」。**拍板对外分发会连锁抬高 TD-025 第 1/2 条与性能基线需求** |
| **`docs/delivery-overview.md`** | **交付总览（新会话入口，2026-10-03 建）**：21 个功能域 × 交付日期 × 计划真源 × 验收记录 × 状态 + 文档地图 + 已知文档不一致登记（9 条全关）。⚠ **版本头仍 v1.0，未收录 B4/B5，用例基线仍写 1070**（见 §1.5） |
| `docs/python_ide_dev_plan_v2.md` §1.1 / §1.2.1 / §7 | 目标与不做清单（pytest / AI 裁决来源）· **v2.1 新增 §1.2.1「性能与轻量：一等目标」四条约束与现状基线** · Phase 4 状态表（**待回填**） |
| `docs/ui_premium_dev_plan.md` | **UI 视觉六批执行真源**（v1.0，六批已落地，§6 批次入口 / §7 实施记录 / §8 方案偏差登记） |
| `docs/ui_premium_design_report.md` v1.2 | 视觉方案论证过程（**方向已批准**；README 索引与 `ui_premium_dev_plan.md:3` 状态戳本轮已同步为"六批已落地"） |
| `docs/adr/0005-brand-accent-unification.md` | 品牌/交互色统一到青绿单色相轴（已定案 2026-10-03） |
| `docs/adr/0006-dual-static-engine-switchable.md` | 双静态引擎并存 + 首日引擎无关抽象层（补记，决策自 2026-08-20 生效） |
| `docs/adr/0007-intel-as-independent-lsp.md` | 运行时智能独立成 LSP、不修改 Pyrefly 内核（补记） |
| `docs/adr/0008-pep669-sys-monitoring-sampling.md` | PEP 669 `sys.monitoring` 采样选型（补记） |
| `docs/adr/0009-lsp-result-merge-sorttext.md` | 补全合并策略：固定段位 + `⟳ runtime` 标注 + 运行时优先（补记，段位表述真源） |
| `docs/sqlite_tool_dev_plan.md` v1.5 | B3 唯一真源（§17 交互方案 / §9 逐 PR 实施记录 / §10.3 v1.0 侧栏态真机 13/13 / §17.7 v1.4 真机待办） |
| `bench/reports/gate-d-runtime-completion.md` | Gate D 确定性口径 base 数值（23/23）与两格 PENDING 的定义 |
| `bench/reports/gate-d-ab-worklist.md` | P0-2 第一格的载体（OpenCharm 列已自动填好，**PyCharm 列 23 行仍全为 `☐`**） |
| `bench/reports/trace-stats.md` | P0-2 第二格的**当前样本**（2026-10-06 重取：真实项目 `metawake/backend`，1 库 / 3 次运行 / **277 条函数观测**，覆盖率 79%；门槛为**跨项目累计 ≥1000**） |
| `docs/tech-debt.md` | 债务明细：**待处理 4 条** TD-021 / TD-022 / TD-024 / **TD-025**（「自用」论据失效复审清单，6 条） |
| `docs/e2e_divergence_ledger.md` | P0-1 的论据（真机才暴露的缺陷） |
| `docs/onboarding_dev_plan.md` / `docs/onboarding_guide.md` | P0-3 方案来源与**双源冲突实例** |
| `docs/dx_features_backlog.md` | 已完成清单，避免重复立项 |
| `docs/git_improvement_report.md` | 迭代 0–6 交付事实 |
| `docs/pycharm_ux_review_and_proposal.md:393` | B1 的现行裁决（F-1 维持非目标，2026-09-25） |
| `docs/python_library_support_research.md` §8 | B1 复议时的边界依据（不做测试发现/结果树） |
| `docs/plugin_system_design.md` §10 | P1-6 / D 类的待决策点 |
| `intel/README.md:47` / `:58` / `:59` | P0-2 的挂起项（P3-T10）——**三处状态戳仍均为 ⏳** |
| `docs/debug_acceptance_record.md` §五 / `docs/run_acceptance_record.md` §四 | P0-3 的人工验收清单 |
| `ci/budgets.toml` + `shell/scripts/budget-check.mjs` | P0-0 的预算真源与断言脚本（**当前十二项全 PASS**；已并入 `ci.yml` test job） |
| `.github/workflows/ci.yml` / `nightly.yml` | P0-1 的配置证据（分支已对齐 `[master, main]`、`audit_tokens.py` 与 `budget-check.mjs` 均在 test job、nightly 三 job）——**⚠ 无宿主**：本仓远端只有 Gitee，Actions 不执行（详见 §9 取数禁则 5） |
