# OpenCharm 现状评估 · 改进建议与未来功能规划

> 版本：**v1.4** · 日期：2026-10-07 · 状态：**待评审**
> 性质：基于当前代码库与全部 `docs/` 文档的**现状评估 + 改进清单 + 未来功能候选池**，不是开发计划（不直接排期）。
> 与既有文档的关系：本文件是**全局视角的评估与选题**，落地时仍需回到各专项计划（`python_ide_dev_plan_v2.md` / 各 `*_dev_plan.md`）写 PR 级方案。冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文件。
> **v1.4 修订（2026-10-07，维护态破例交付）**：**A5③④ 端点面板余项已交付**（落地续记见 ㉓）——③ handler→route 反向跳转（CodeLens「端点 N」+ 弹层）+ ④ OpenAPI 面板内预览（`fetch_openapi` 命令 + 懒加载展开块）。**P1-5 收口**（㉑/㉒）：①③④⑤ ✅ 已修，**② 裁决不处理**（session.ts `restoring` 布尔非令牌，场景罕见，维持 tech-debt 登记备查）。预算口径数字（`budget-check.mjs` 实测）：**43 项全 PASS**（命令 **197/200** · 产物 **5,048/5,120 KB**）。后续仍处维护态：运行侧只受理开销回归 / trace 迁移 / 预算违约修复，工具箱侧只受理缺陷修复与既有工具打磨。
> **取数时点**：2026-10-06，git HEAD `bb32d77`（v1.2 基线 `ccf9da2` 之后 **23 个提交**）。所有数字由 **`node tools/stats/repo-stats.mjs`** 产出（口径固化在脚本里，见 §9）。**引用本文数字前必须先核对 HEAD**。
> **v1.3 第二轮补记（同日稍后）**：本轮收口时 HEAD 已到 `f33e5be`（`bb32d77` 之后 **5 个提交**，均为 D-6 / D-7 / D-8 修复与文档，**未触发 §9 的 ≥10 提交重取条件**）。§1.1 的规模表未全量重取；但**预算口径的数字已按 `budget-check.mjs` 实测刷新**（`main.ts` 2,914 → **2,312**（阶段二拆分第一刀后）、命令数 **194**、`style.css` **5,748**、产物 **4,989 KB**），引用这几项时以本行数字为准。
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
>
> ⑨ **⚠ P0-1 的根子问题本轮被查出（本版最重要的一条）**：本仓远端**只有** `gitee.com/usedel/opencharm`，**Gitee 不执行 GitHub Actions**。即 `.github/workflows/ci.yml` 与 `nightly.yml` 这两份"已交付"的配置，**跑在一个没有宿主的仓库里**——v1.2 把"配置写好了"记成 ✅、v1.3 又把它降档为"零跑通证据"，其实都还没摸到根因：**连"能跑"的前提都不存在**。因此 v1.3 阶段一第 3 项写的收口动作"push 一次 master 看 Actions 是否真的触发"**在现宿主下永远得不到证据**。**已裁决（用户选「维持现状 + 文档标注」）**：`.github/workflows/` 定位为"将来推 GitHub 的预埋"，余项转为**外置触发条件**——迁移到 GitHub 后首次 push 的 Actions run 记录（**谁推谁验**）。**缺口 1 由此从"待办"降级为"待外部事件"，保持开启但不再消耗人力。**
>
>
> ⑩ **P0-2 第一格改为「外部阻塞」（2026-10-06 用户确认）**：**本机已无 PyCharm**，23 点人工横向对标**暂时无法执行**——它不再是"等一个动作"，而是"等一个外部条件"。按本报告 §P0-4 确立的**二选一截止**规则给它设死线：**若到 v1.4 仍未拿到对标，就把它从 P0 撤下**，并在 README「已知边界」显式写明"**未与 PyCharm 做过横向对比**"。**在新证据出现之前，对外一律不得出现"比 PyCharm 更准"的表述**（与 `CONTENT-SERIES.md:192` 的写作纪律一致，可写的只有"在我们的样例集上 23/23"这种自证口径）。**至此，P0 里所有"能靠写代码解决"的项已全部关闭，剩下的都是外部条件。** → ✅ **2026-10-07 该死线到期，第一格已按规则撤下**（见续记 ㉔）：README 已知边界改为定稿声明、`intel/README.md` 三处 ⏳ 关闭、工作单转存档。**P0 至此全部关闭**（P0-0/1/2/3/4 无一挂账）。
> **v1.2 修订（2026-10-03，纠正 v1.1 的一处系统性取数错误）**：
> ⑪ **阶段二开工（2026-10-06，用户选「main.ts 外提」）**：`main.ts` **2,919 → 2,312（第一刀，−601 行）→ 2,094（第二刀，−218 行）**，五块外提都是**纯位移**（函数体逐字未改，只改所在文件）。
> **第一刀**：调试入口域 → `src/debugEntry.ts`（171）、菜单与命令面板数据源 → `src/menuItems.ts`（570，main 私有动作经 `setMenuItemsHandlers` 注入解环）。
> **第二刀（`init()` 阶段化）**：全局键位路由 → `src/windowKeys.ts`（147，仅 4 个 main 私有动作经 `setWindowKeyActions` 注入）、自绘标题栏与窗口边缘 → `src/windowChrome.ts`（73，**零 main 私有依赖**）、侧栏视图注册表 + 活动栏 → `src/sidebarViews.ts`（107，仅注入 `refreshOutline`）。
> **阈值逐刀下调：3,000 → 2,600 → 2,400**，五个新文件各设上限（205 / 690 / 180 / 90 / 130）——拆分后不降阈值，省下的余量会被下一个功能吃掉。门禁：`tsc` 零错 · 单测 **1215/1215** · `budget-check` **十七项全 PASS** · e2e ux 29 / p3 5 / dx 65 / db 32 / debug 16 全过 · `npm run build` 通过。**第三刀候选：`init()` 余下的启动编排（Monaco 装配 / 各域事件接线）继续按阶段外提。**
> ⑫ **A1 运行时热点视图已交付（2026-10-06，用户选「A1」）**——阶段二差异化泳道的首件，也是 §A 类里第一条真正落地的"别人抄不走"功能。
> **数据层** `src-tauri/src/intel_cmds.rs`（新文件，472 行）：只读打开 `<data_root>/traces/<project_hash>.db`（`SQLITE_OPEN_READ_ONLY`，不写不建），读 `functions(fid, filename, qualname, lineno, hits, stale)` 与 `exc_types`；对齐键 = **(归一化绝对路径, 定义行号)**；项目侧用 `fs_cmds::collect_files`（尊重 .gitignore）逐行识别 `def` / `async def` 做差集。条目 `file` 输出**绝对正斜杠路径**（对齐 `scan_endpoints` 先例：前端 `openFile → read_file` 直读，相对路径相对进程 cwd 必失败）；trace 库存的是 `normcase` 小写绝对路径，**借静态扫描结果还原展示大小写**。
> **口径红线（本件的核心裁决）**：`unobserved` 只在**项目确有运行记录**时产出（否则无信息量，直接 `has_data=false` 返回空）；语义一律是「**未观测到运行**」——可能原因含未被测试/入口覆盖、条件分支未走到、采样遗漏、进程外调用，**UI 与文档均不得写成"死代码"断言**（`hotspots.unobservedHint` 逐字否认，e2e HS-4 钉住 title）。trace 库里的 `<module>`（模块级）与类体**不是函数**，回读源码行确认后才保留 def。
> **前端** `src/hotspotsView.ts`（第 8 个侧栏视图，`#view-runtime` / `#tab-runtime`）：上半「已观测（按调用次数）」带 stale「已改动」与异常 `⚠ n` 徽章，下半「未观测到运行」；概要为「观测 N 个函数 · 覆盖 X%」。**惰性加载**——扫描只挂视图 `onShow`，不在启动路径上做 IO（e2e HS-6 用 invoke 流水钉住）。新样式落 `src/styles/hotspots.css`（新功能不往 `style.css` 堆，纪律同 B4/B5）。
> **顺带修掉的 i18n 生成链缺陷**（都会造成"看起来正常"的静默污染）：① `extract_html.py` 与 `gen_locales.py` 均以文本模式写文件，在 Windows 上把产物 CRLF 化——`extract_html.py` 因此让 `collect` 的「已标记」检测失效（全文件标记被重复插一遍），`gen_locales.py` 则让整个 `core.ts` 显示为改动；统一改 `newline=""` 按 LF 落盘。② `gen_locales.py` 不产出注释，两处刻意的分组标题注释（UI-31 / UI-32）**手改生成文件后每次重生成都会静默丢失**——新增 `PINS_ZH` / `PINS_EN` 锚点登记，生成结果从此可复现。③ `data/html_dict.json` 与 `data/en_2.json` 的字体预设默认值停留在"批 3 随包 JetBrains Mono"之前（`默认（Consolas / Cascadia / JetBrains）`），与 `index.html` / `state.ts` 的真值不符，且每次重生成都会把错误值写回 `core.ts`——已按真值修正。
> **⚠ 取数禁则（新增第 7 条）**：`data/html_dict.json` 是**冻结快照**，**不可随意重跑 `extract_html.py`**——重跑会产出 18 条与 `manual_zh.json` 重复的 key + 21 条缺英文，`gen_locales.py` 直接 exit 1（本轮实测）。要改词条请直接改 `html_dict.json` / `manual_zh.json`。
> 门禁：`tsc` 零错 · 单测 **99 文件 / 1223**（A1 新增 `hotspotsView.test.ts` 8 例，含 e2e 触达不到的三条空态分支）· `cargo test` 通过（外壳 310 / 含 `intel_cmds` 6 例）· e2e **ux 37/37**（A1 8 例 HS-1~HS-8）· `budget-check` **二十项全 PASS**（新增 `hotspotsView.ts` 282/350 · `styles/hotspots.css` 44/60 · `intel_cmds.rs` 472/600；命令 194 → **195**/200 · 产物 4,999/5,120 · `main.ts` 2,099/2,400）· `audit_tokens.py` **98 项 0 FAIL**（新 CSS 经 `@import` 进审计面，已用"注入裸阴影"正对照验证确实被抓）。
> ⑬ **A5① 端点请求样例已交付（2026-10-06，用户选「A5 FastAPI 面板增强」→ 范围收在「①请求样例 + ②一键 curl」）**——差异化泳道第二件，也是**第一条把「静态解析」与「运行时观测」接在同一处**的功能（请求体样例直接吃 A1 那条 trace 通道的 `arg_types` 只是时间问题，本轮先做纯静态版）。
> **范围裁决**：A5 的四个子项里，③ handler→route 反向跳转（需 `codeVision.ts` 编辑器侧基建）与 ④ OpenAPI 面板内预览（需服务在跑才有数据）本轮不做——①②离线可用、不要求服务运行，日常使用频率最高；③④留待下轮。
> **数据层** `src-tauri/src/ep_sample_cmds.rs`（新文件，1,024 行 = impl 737 + 单测 287）：解析 handler 签名（**跨行拼接** + 括号/引号感知的顶层切分）把参数分成 `path / query / header / cookie / body / skip`，再复用 `fs_cmds::pyd_collect_models`（只放开可见性，不另造第二套 Pydantic 解析）展开请求体字段 → 产出可直接复制的 JSON 样例。**只读命令，不写任何文件**；「识别不到」一律走 `Ok` + `notes` 码（文件读不到 / def 行对不上 / 模型不在工作区 / 类型未识别），**不猜值**（未识别类型填 `null`）。
> **样例值口径**：`int→0` · `float→0.0` · `str→"string"` · `bool→true` · `datetime→ISO` · `list/dict→[]/{}` · 未知 → `null`；`Optional[X]` / `Annotated[X, ...]` / `X | None` 逐层剥壳；嵌套模型展开深度 ≤3 且带环保护。JSON 手写渲染而非 `serde_json`——后者默认按 key 字典序输出，会把字段声明顺序打乱，而样例的价值一半在「顺序与模型声明一致」。
> **前端** 刻意分两层：`src/epSampleCore.ts`（163 行，**零 app 依赖**，只依赖 i18n）+ `src/epSample.ts`（265 行，取数与渲染）。分层的唯一理由是单测——合并后一 import 就把 `git.ts → termUi.ts` 的模块级 DOM 查询带进来，单测必然报「缺少元素 `#git-detail-view`」。UI 为端点行第 3 个动作（`beaker` 图标）→ 行内展开：参数表 / 请求体 JSON / cURL 三段，各带复制；cURL 在前端拼（要用运行中服务的 base URL，那是前端状态）。展开态单例 + 缓存，`renderEndpointPanel` 重建列表时一并作废。
> **顺带修掉两个既有缺陷**（都是「看着正常」的静默失效）：① `openHttpTool` 调 `openDevTools("http")` 传了**裸 id**，而内置工具的全局 id 是 `<pluginId>.<toolId>`（`dslLens.ts` / `jsonLiteral.ts` 都写全 id）→ `getDevTool` 返回 undefined，静默回落到「最近使用」工具，**B4 PR-B4-3 的「端点 → HTTP 工具」联动从来没打开过 HTTP 工具**；② http 面板的请求体 textarea 与环境变量 textarea 同类名（各 1 个 `.tool-textarea`），补 `.http-body` 专用类（同 `.http-url` 既有约定）。
> 门禁：`tsc` 零错 · 单测 **100 文件 / 1240**（A5① 新增 `epSample.test.ts` 17 例）· `cargo test` 通过（`ep_sample_cmds` 9 例）· e2e **ux 42/42**（A5① 5 例 EP-S1~S5）· `budget-check` **二十五项全 PASS**（新增 `epSample.ts` 265/330 · `epSampleCore.ts` 163/205 · `styles/endpointSample.css` 97/125 · `ep_sample_cmds.rs` 1024/1280 · **首次纳入 `endpointView.ts` 366/460**；命令 195 → **196**/200 · 产物 5,013/5,120 · `fs_cmds.rs` 3,882 → 3,885 仅因放开 5 处可见性）· `audit_tokens.py` **98 项 0 FAIL**（新 CSS 同样用"注入裸阴影"正对照验证被抓）。
> ⑭ **A3①+② 调用实参补全 + hover 观测签名已交付（2026-10-06，用户选「A3」→ 范围收在「①调用处参数名补全 + ②hover 观测签名 / 常见键」）**——差异化泳道第三件，**第一条把 trace 观测直接接进补全 UI**（此前 A1 只读、A5① 纯静态，intel 的 `arg_types` 一直只喂 hover/属性补全）。
> **范围裁决**：A3 的四个子项里，③ intel 侧 `textDocument/signatureHelp`（`(` / `,` 触发的签名弹窗）与 ④ 调用处参数名 inlay hint 本轮不做——①②共用同一份「解析调用上下文 + 聚合 `arg_types`」基建、边际成本最低，且 `(` / `,` 触发字符一次改到位后 ③ 可复用同一份上下文解析；③④已降级登记在优先级表。
> **① 数据层与上下文判定**（`completion.rs`）：`complete()` 新增第四条分支（符号 / 属性 / 下标 / **调用实参**）。前向扫描（括号栈 + 字符串/注释跳过）取**最内层未闭合 `(`**，回溯取 callee 点链；**负例一律让位**——光标在字符串内（`foo("a|`）、最内层是 `[` / `{`（交给下标补全）、`def` / `class` 定义、分组括号（`(a + b`）、光标所在段不是「空或纯标识符」（`foo(a.` → 交给属性补全）。另有廉价前置过滤（本行光标前无 `(` 即返回），挡住 `,` 触发时的绝大多数行。
> **排除已写**：已按 keyword 写出的参数名直接排除；已按位置写出的参数按**参数位顺序**前跳。顺序依据是 `arg_types` 的**插入序**——probe `monitor._record_args` 按 `co_varnames`（声明顺序）逐参数位写入，这是唯一依据；**位置参数顺序对"观测缺失的参数位"偏保守（少跳，不会错跳）**。`Cls(` 先按最后段匹配、未命中再试 `Cls.__init__`。候选 insertText 为 `name=`（`Candidate` 新增 `insert_text` 字段 + `CandidateKind::Param` → LSP `VARIABLE`），detail 为 `⟳ runtime · <观测类型> · <证据数>`。触发字符 `(` `,` 同时加进 server `initialize` 声明与 shell `registerLspCompletion`。
> **② hover 增强**（`hover.rs`）：函数 hover 新增「签名（观测）」行（`parse_page(resp: requests.Response)`，按参数位顺序合成——故**另走 `param_observations` 而非已按 count 重排的 `args`**），每条参数观测附 shape 派生的**常见键**（dict）/ **常见属性**（实例）。`type_infer` 因此新增 `pub(crate) shape_members`（复用既有 `parse_shape`，不重造解析）；`hover::find_function` 的函数选取逻辑抽成 `completion::best_function` 与实参补全共用一份。
> **⚠ 口径（重要）**：probe 明确「**绝不 repr 值本身**」（`probe/README.md` 类型紧凑表示），trace 里只有 `type_label` 与 `shape`——**不存在"实际见过的字面取值"**。因此 A 类表原写的「常见值」在落地时收敛为「常见键 / 常见属性」（结构），文案与文档均**不得**暗示有字面值。这是本轮唯一对原描述的收紧，需在对外说明里保持。
> **顺带修掉一个既有缺陷**：`trace.rs::load_args` 用 `ORDER BY fid`，而 SQLite 排序**不保证稳定**——同一函数的多条 `arg_types` 行会被打乱。**实测确已乱序**（`url, timeout, retries` 读成 `retries` 打头），而 A3① 的「位置参数前跳」正依赖该顺序。改为 `ORDER BY fid, rowid`（arg_types 无 fid 索引，排序本就发生，零额外代价），由 `trace_test.rs::arg_observation_order_is_insertion_order` 钉住。**教训**：凡依赖 SQL 行序的地方，必须显式给出决胜键。
> 门禁：`tsc` 零错 · 前端单测 **100 文件 / 1240 不变**（A3 是 Rust 侧功能，未新增前端测试）· `cargo test` intel **60**（47 + 6 + 7；新增 15 例：参数补全 10 + hover 4 + 索引顺序 1）· 外壳 **319 passed / 2 ignored 不变** · e2e **全量 340/340**（串行 25.4m，含 `_probe`；触发字符改动未引入回归）· `budget-check` **二十七项全 PASS**（**首次纳入 intel crate 两个文件**：`completion.rs` 1632/1950 · `hover.rs` 392/470；命令 196/200 · 产物 5,013/5,120 均不变）· `audit_tokens.py` **98 项 0 FAIL**（本轮无新增 CSS）。
> ⑮ **A4①+③ 爬虫工具箱「选择器测试」+ 响应→模型桥已交付（2026-10-06，用户选「A4 爬虫工具箱」→ 范围收在「①选择器测试器 + ③响应结构 → Pydantic 模型」、求值引擎选「前端浏览器 DOM」）**——差异化泳道第四件，也是**第一条把「抓下来的东西」与「写爬虫时的验证动作」放进同一个面板**的功能。
> **范围裁决**：A4 三个子项里，②「请求回放」本轮不做——B4 HTTP 工具的历史区（最近 20 条点击回填）**已经是回放**，独立面板属重复建设，已降级登记。③ 的**本体早已存在**（`json2model.gen.ts` / `json2model.ts`，P1 库支持批次交付），本轮只补**桥**：HTTP 响应工具栏一键送进模型生成器。故真正的新件只有 ①。
> **求值引擎裁决（本轮最重要的取舍）**：① 在**前端浏览器 DOM** 上求值（`DOMParser` + `querySelectorAll` / `document.evaluate`），**不走 `libEval` 求值桥**。理由：求值桥纪律（§2-5「求值统一走本模块」）管的是 **Python 求值**，而这里没有 Python 参与；换来的是输入即命中（150ms 防抖）、零新依赖、无解释器 / 无 venv 也能用。**代价是口径差异**——与 lxml / bs4 在「`<table>` 缺 `<tbody>` 时浏览器自动补一层」「畸形 HTML 的修复规则」「CSS 支持集（`:has()` / `:is()` 浏览器有，cssselect / soupsieve 未必）」上不同。故面板**常驻一行口径说明**（`devtools.sel.engineNote`：「…本面板用于验证选择器写法，**不等于爬虫实际结果**」），由 e2e **SEL-9 钉住不得删**。**Python 侧 lxml / bs4 引擎已降级登记**（要一致口径时再做）。
> **① 求值层**（`selectorCore.ts`，零 app 依赖 → 单测可直接 import）：选择器类型自动识别（以 `/`、`.//`、`(//`、具名轴 `xxx::` 开头 → XPath；`a::before` 这类伪元素与 `a[href^='/p/']` 这类属性值斜杠**不误判**）；解析结果**按 HTML 缓存**（改选择器不重解析）；命中快照含 tag / id / class / 优先级排序属性（`href`·`src`·`title`·`data-*`…，跳过 id/class/style，受 `ATTR_LIMIT` 限条并另报 `attrTotal`）/ **直接文本**（`ownText`，与 `textContent` 分开——爬虫取的是前者）/ 简洁路径（`div.list > a.item:nth-of-type(2)`）。上限：命中 200 条（超出只计数）、HTML 2M 字符（超出拒绝并明说）、文本 120 字符。
> **高亮与「当前命中」两条易错点**：求值前**必须先清上一次的高亮类**（否则选择器会看见自己打上的 `.sel-hit`）；**必须先取快照再打高亮**（反过来的话 `classes` 会把 `.sel-hit` 读进去、UI 每条命中都多显示一个类——本轮自测发现并修）。「当前命中」下标**跨「切列表 / 切预览」保留**、选择器一变即作废（否则下标会指向另一个元素）；命中数缩水到下标之外时不越界加 active。
> **面板**（`selector.ts`）：单列布局——右侧面板默认仅 **360px**（下限 260），双栏必挤，故「命中列表 / 结构预览」用 `kit.radioGroup` 互斥切换。结构预览**先 DOMPurify 消毒再注入**，并 `FORBID_TAGS` 掉 `style` / `link` / `base` / `iframe` 等——**`<style>` 若不剥会重排整个 IDE**（CSS 是全局的，不随容器隔离）。预览明说「不是页面渲染效果」（页面 CSS 已剥离、应用样式仍会命中）。HTML 与选择器经 `host.storage` 持久化（**HTML > 64KB 不落盘**——避免写爆 localStorage 连带影响其它工具草稿）；面板实例缓存 `CACHE_MAX=5`，故持久化是必要的而非锦上添花。
> **③ 响应 → 工具两座桥**（`http.ts` 响应工具栏 +2 按钮）：「选择器测试」（响应体 → 选择器工具，**不校验像不像 HTML**——选择器工具自己会给提示，硬拦反而挡住「拿 JSON 试选择器」这类探索用法）与「生成模型」（响应体须为 JSON，`parseJsonBody` 失败则 flash 明说，美化后送进 `json2model`）。两座桥都走**与 `setPendingRequest` 同构的投递**：工具已挂载 → 直投在线消费者；未挂载 → 暂存待下次 `mount` 消费（**两条路都要通**，否则会静默失效——同 `openHttpTool` 那条踩坑）。工具全局 id 一律经 `pluginToolId("opencharm.builtin", …)` 构造，不再手写字符串。
> **口径红线（对外说明同样适用）**：本工具是**验证选择器写法**的辅助，不是「爬虫会看到什么」的模拟器。写内容/文档时不得表述为「所见即所得」或「比 lxml 准」。
> 门禁：`tsc` 零错 · 前端单测 **101 文件 / 1271 用例**（新增 `selectorCore.test.ts` **31 例**）· intel `cargo test` **60 不变**（本轮无 Rust 改动）· 外壳 `cargo test` ⚠ **见下条环境故障** · e2e **tools 域 10/10**（全量见 §1.4）· `budget-check` **三十一项全 PASS**（新增 4 个上限：`selectorCore.ts` 379/460 · `selector.ts` 394/480 · `styles/selector.css` 132/165 · **首次纳入 `http.ts` 900/980**；命令 196/200 不变 · 产物 5,013 → **5,032** KB）· `audit_tokens.py` **98 项 0 FAIL**（新增 CSS 全 token，无白名单条目）。
> **⚠ 环境故障（非本轮回归，须记录）**：外壳 `cargo test` 本轮 **318 passed / 1 failed / 2 ignored**，唯一失败是 `lib_cmds::tests::stdin_utf8_roundtrip_with_real_python`，报 Windows **`os error 231`（所有的管道范例都在使用中）**——失败点在 `run_with_timeout_bytes` 的 `Command::spawn()`（lib_cmds.rs:266），即**带管道 stdin 的原生子进程创建**被拒。判定为**会话沙箱环境问题**的证据链：① `git status` 证明本轮**零 Rust 改动**（该用例在 A3 轮次是过的，同机同代码）；② 同函数的 `Stdio::null()` 路径（`any_python` / `eval_timeout_branch`）全部通过，说明只差在 stdin 管道；③ 直接运行测试二进制（绕开 cargo）**同样复现**，排除 cargo 因素；④ Python 侧同类「三管道 spawn + communicate」**正常**。这与本项目已记录的「`spawnSync` 报 `EBUSY`、异步 `spawn` 却正常」属**同族**沙箱故障。**处置**：如实记录、不当作回归、不修改代码绕开；后续会话需复跑确认是否自愈。**→ 已自愈：A3③ 轮次复跑外壳 `cargo test` 为 319 passed / 0 failed / 2 ignored，该用例未再复现**（印证"环境故障"判定）。
> ⑯ **A3③ intel 签名帮助（`textDocument/signatureHelp`）已交付（2026-10-06，用户选「A3③ intel 签名弹窗」）**——差异化泳道第五件，补上 A3 四子项里的第三项，`(` / `,` 触发即弹**观测签名**并高亮当前参数位。
> **复用裁决（本项最关键的一条）**：**不另造第二份上下文解析**。把 A3① 的 `call_frame_at`（括号栈 + 字符串/注释跳过 + callee 回溯）、`written_args`、`resolve_callee`（含 `Cls(` → `Cls.__init__` 回落）、`param_observations` 从 `completion.rs` 提为 `pub(crate)`，`signature.rs` 只负责「合成签名 label + 算当前参数位 + 出说明文本」。⇒ **弹窗高亮的参数位与补全首推的候选必然是同一个**（否则会出现"补全让你填 `timeout`、弹窗高亮 `url`"这种自相矛盾）；同时消掉了两份括号扫描逻辑各自漂移的隐患。
> **与 A3① 的一处有意差异**：补全要求「光标所在段是空或纯标识符」才出候选，签名帮助**不要求**——写 `foo(1 + |` 时补全让位（交给表达式/点链补全），但签名弹窗仍应显示（你确实在填第一个参数）。差异由单测 `signature_survives_non_ident_segment` 钉住。
> **只给一条签名**（`activeSignature=0`）：与 A3① 同口径，`resolve_callee` 已按「qualname 最后段匹配 + hits 最高、非 stale 优先」取唯一实现；Python 无重载，列同名候选只会变噪声。
> **当前参数位**：观测顺序下**第一个尚未写出**的参数位，「已写出」判据与 A3① 逐字一致（已按 keyword 写出的名字 + 已按位置写出的前 N 个）；参数填满时**钳到末位**而非回 0（回 0 更误导）。
> **⚠ 口径**（延续 A3② 的收紧）：trace 只有 `type_label` + `shape`，**不记默认值**、**绝不 repr 值本身**。故签名 label 里**没有默认值**，签名级说明文本已显式写「**不含默认值**；probe 不记录字面取值」（单测 `signature_doc_states_no_defaults` 钉住）；参数说明仍只给「常见键 / 常见属性」，且 shape 与「证据最高的类型」取自**同一条观测**，不混搭。
> **shell 侧接线**（`lsp/client.ts`）：`provideSignatureHelp` 原为**只问静态引擎**，现改为**intel 优先、无结果回落 static**——新增 `querySignatureHelp(engine, params)`，与 `queryHover` 同构（per-engine 就绪门控 + 失败静默）。理由与补全 / hover 的合并口径一致：只有运行时侧知道「这个参数位实际见过什么类型」，静态引擎做覆盖面兜底（没跑过的函数 intel 无观测）。`startIntel` 的 client capability 同步补 `signatureHelpProvider`。
> **⚠ 已知边界（本项未改，如实记录）**：签名帮助与补全 / hover 共享 `engineStatus === "ready"` 门控——**静态引擎未就绪时整条 intel 链路都不出结果**。这是既有设计（A3① 起如此），不是 A3③ 引入的；要让 intel 独立可用，须三个 provider 一起改，属独立议题。
> **顺带补齐一处 e2e 空白**：签名帮助此前**零 e2e 覆盖**。给浏览器侧 LSP 替身补 `textDocument/signatureHelp`（并让符号索引顺带记下 `def` 行的形参表），`e2e/lsp/01` 新增 1 例钉住**回落静态引擎**这条真实路径。**intel 分支在浏览器 mock 下触达不到**（无真实二进制、`get_intel_info` 无桥），已在用例注释里如实标注，不假装覆盖。
> 门禁：`tsc` 零错 · 前端单测 **101 文件 / 1271 用例不变**（A3③ 是 intel + provider 路由改动，未新增前端单测）· intel `cargo test` **72**（59 + 6 + 7；新增 **12 例**签名帮助）· 外壳 `cargo test` **319 passed / 0 failed / 2 ignored**（A4 那例环境故障未复现，见上条）· e2e **`e2e/lsp` 18/18**（定向：改动落在 LSP 客户端，未触及其余域的共享状态机）· `budget-check` **三十三项全 PASS**（新增 `intel/…/signature.rs` 372/450 · `intel/…/server.rs` 528/620；`completion.rs` 1,632 → 1,672 仍在上限内；命令 196/200 · 产物 5,032/5,120 均不变）· `audit_tokens.py` **98 项 0 FAIL**（**本轮无新增 CSS，但复跑时检出 A4 新增的 `.sel-item:focus-visible` 用了裸 box-shadow → 已修，见 `delivery-overview` §4 第 18 条**）。
> **⚠ 一条门禁纪律（本轮教训）**：A4 的门禁记录写「98 项 0 FAIL（本轮无新增 CSS）」，而**实测 HEAD 上该项是 FAIL 的**——A4 恰恰新增了 CSS（`styles/selector.css`），记录却沿用了"无新增 CSS"的推论。**新 CSS 落地后必须复跑 `audit_tokens.py` 取实测值**，不得以"本轮没有 CSS 改动"推断结果。同族教训见 §9 取数禁则。
>
>
> **⑰ A2 内置 Profiler：立项前的开销门槛实验已完成（2026-10-06，用户选定 A2 为阶段二下一步）**。本轮**未直接写功能代码**——A2 是唯一要动 probe 采集热路径的功能，ADR-0010 要求「预算先行」，故先跑 `PR-A2-P0` 形式检查（脚本 `bench/profiler-overhead/overhead_lab.py`，真源 **`bench/reports/a2-overhead-lab.md` v1.0**；6 变体 × reps 7，口径与官方 harness 对齐）。三条结论：
> ① **做得到，但只能做成默认关的「性能模式」**：推荐形态 **V2p = 2.68x**（抬开 `max_calls_per_func` 静音 + per-call 精确计时 + **保留**类型观测）；同负载 **cProfile 4.80x**，故性能模式红线建议取「**≤ 同负载 cProfile**」（实测余量 44%）而不是再立一个魔数。默认路径逐字不动，借助实验里的另一发现——**多一层 Python 帧的成本 ≈ 0**（V0 57.3 vs V1 57.5 ms）——可做成「`start()` 时二选一注册两套回调」，热路径零 `if perf_mode` 分支。
> ② **三条路线被数据否决**：沿用默认参数顺手加计时 → 静音让样本只剩 **602/6000**（数据为假，这不是调参偏好，而是正确性问题）；进程内栈采样（py-spy 式）→ 36 ms CPU 负载只拿到 **1 个样本**（持续持 GIL 的线程让采样线程挨饿，py-spy 能做到是因为它跨进程读内存，我们做不到）⇒ **火焰图 / 行级 / 多线程 self-time 一律不可写**；降采样计时 1/16 → 只省 4% 成本却丢 94% 样本。
> ③ **顺带查出：Gate C 正在红线边上抖动**——官方 harness 同一台机器连跑两次得 **1.53x FAIL / 1.44x PASS**，本实验 V0 **1.58x**；`git log` 排除 probe 回归（自 `b38cfee` 后采集路径零改动）。**即 §1.4/§6 记的「1.35x」余量已归零**，这也是 A2 必须默认关的硬理由。是否先做一轮 baseline 优化再动 A2，列为待裁决（`docs/runtime_profiler_dev_plan.md` §7）。
> ④ **口径教训（建议入 §9 取数禁则）**：实验第一版把 `Monitor` 构造与 `start()` 计入计时窗口得 **3.05x**，与官方同源码口径的 1.44~1.58x 差出一倍——**一次性装配成本不得进倍率**，否则会得出「越短的脚本越吃亏」的失真结论。
> 立项计划见 **`docs/runtime_profiler_dev_plan.md` v0.1**（PR 拆分 P1~P5 + 预算占位预警：产物余 88 KB / 命令余 4 个 / `hotspots.css` 余 16 行）。
>
> **⑱ ⑰③ 那条 Gate C 欠账已追到根上：不是抖动，是「倍率」这个量本身不可比（2026-10-06）**。同一份 probe 代码、同一台机器、同一时点，倍率随**负载形状**在 **1.17x（重工 × 高次）~ 2.48x（小工 × 高次且取消静音）**之间摆动，再叠加同形状跨 run 的 ±0.1x；历史上记的 1.35x 只是某一形状的读数。归因（S4 口径，`overhead_lab.py --decomp`）：**静音节流藏起了近 1x**（S1 1.58x vs S4 2.48x 的全部差异）、「项目函数活跃即重开发现窗口」导致的**全局 PY_START 常驻 ≈ 0.39x**、**类型观测 ≈ 0.26x**。证据矩阵、三条口径纪律与三个裁决项见新报告 **`bench/reports/probe-overhead-caliber.md`**（**不需要改任何产品代码即可先拍这一项**）。⚠ 若裁决为「多形状矩阵全部 < 1.5x 才 PASS」，则**今天即为 FAIL**（S1 1.58x / S2 1.63x）——不是回归，是旧口径掩盖了真实成本。
>
> **⑲ 顺手修掉一个「免费」的数据缺陷：hits 不再被钳在 200（2026-10-07）**。
> P0-2 采数时发现 3 个真实项目的 `hits` max 恒为 200——根因是 `max_calls_per_func` 的静音把**全部局部事件清掉了**，省开销的同时连 hits 一起停，于是热点榜与未来 Profiler 的 Top-N 一到上限就分不出高下。改法：静音只清 `PY_RETURN`、保留 `PY_START`，被静音函数走「只 `add_hit` 即返回」分支。**开销实测与改动前持平**（S1 1.56x→1.56x、S3 1.08x→1.10x）——省下的返回回调与 `compact_type` 成本正好抵消继续派发的成本。⚠ 两个教训：① **热路径分支位置值 0.15x**——第一版把静音判断放在 `_maybe_close_window()` 之后，涨到 1.71x（窗口在 `_active>0` 时根本关不掉，那次调用纯属白付），提到 `_on_start` 最前面才回到基线；② **触发静音的那次调用也要计数**，否则每次静音吞 1 次 hits（单测先抓到 9 而非 10）。另：官方 harness 改动后连跑两次 **1.53x / 1.27x**，与改动前同属一个抖动带——**它单次读数判不了 0.1x 级差异，进程内精测（reps ≥7）才是可信口径**。真源 `bench/reports/probe-overhead-caliber.md` §5 + 端到端核验 `bench/profiler-overhead/check_hits_e2e.py`（1000 次调用 → `hits=1000`）。
>
> **⑳ A2 内置 Profiler 三项裁决落定 + PR-A2-P1（probe 侧 `perf_mode`）已交付（2026-10-07，用户裁决后开工）**。
> **三项裁决**：① 性能模式红线 = **「≤ 同负载 cProfile」**（自证明，随环境重标定）；② **照现状推进 A2**，Gate C 维持单形状官方 harness + 文档标注（不改多形状矩阵、不抬红线、不启动 baseline 优化——两个杠杆都是功能取舍）；③ self-time 维持「先测后做」（PR-A2-P2 成本实测后再裁）。
> **P1 交付**：`perf_mode` 配置开关（`probe.json` / `OPENCHARM_PROBE_PERF=1` 环境变量，后者是 shell 运行环境的注入通道）+ `start()` 二选一注册两套回调组（§3.2 形态裁决落地，热路径零 `if perf_mode`）+ sink 聚合 `fid → [calls, total_ns, max_ns]`。perf 模式抬开静音上限（`sys.maxsize`）——静音对耗时统计是致命失真（V2 假样本 603/6003），这不是调参偏好。
> **⚠ 落地与实验装置的关键差异（实证驱动）**：**PY_UNWIND 不能作局部事件**（3.13.7 `set_local_events` 拒收）——异常退出的计时栈配对改为**全局 PY_UNWIND + `_perf_stacks.get` 过滤**（库代码 unwind 只付一次 dict 查表，异常路径非热路径）。配对语义由两个实证脚本钉死（内部捕获的异常不触发 UNWIND、传播出帧才触发、生成器耗尽走 PY_RETURN），单测含「内部捕获照常计时 / 传播退出不记样本且栈零泄漏 / 递归 LIFO」。
> **出口条件全过**：V2n（原生 perf 模式）同机两跑 **2.87x / 2.81x** ∈ [2.4, 2.9] 且 ≤ cProfile（5.1~5.2x，余量 ~44%），样本 6003/6003 零截断；默认路径 HEAD 对照（同会话官方 harness）HEAD 1.55x vs 改动后 1.64x——均在历史抖动带（1.27~1.64x），**差异是机器热度不是代码回归**（lab V0 跑的就是未变代码，同场 1.67~1.77x）；probe 单测 **86/86**（新增 5 例）。盖印 `bench/reports/a2-overhead-lab.md` §8；`runtime_profiler_dev_plan.md` 升 v0.2。
> **⑳续 PR-A2-P2（exclusive(self) time，同日落地）**：按「先测后做」先跑实验变体 V2p-self（child_ns 帧栈，结构与落地形态逐字一致）——**2.95x ≤ cProfile 5.10x，余量 ~42% → 达标，落地**。per-code 栈升级为单帧栈 `_perf_frames: [code, t0_ns, child_ns]`：返回时把 dt 累计进父帧 child_ns，样本行扩展为 **[calls, total_ns, max_ns, excl_total_ns, excl_max_ns]**，**无新配置项**（perf 模式天然同时产出 incl+excl）。落地后 V2n = **3.02x** 仍 ≤ cProfile 5.45x；样本 6003/6003 零泄漏；单测 **87/87**（新增 exclusive 减法用例：parent excl < 5ms、child excl > 5ms、无负值/反转）。盖印 `a2-overhead-lab.md` §9；dev plan 升 v0.3，§7③ 裁决「达标，落地」。
> **⑳续 PR-A2-P3（trace 库写入 + `scan_runtime_hotspots` 扩展返回，同日落地）**：probe `store.py` 给 `functions` 表加 5 列 `perf_calls / perf_total_ns / perf_max_ns / perf_excl_total_ns / perf_excl_max_ns`——**仅 perf_mode 有数据（否则恒 0，默认路径零落库成本）**；跨运行 `total/calls` 累加、`max` 取全局最大（同 hits 的沉淀语义）；旧库 `_ensure_perf_columns` 逐列 ALTER 迁移（同 stale/instance 先例）。intel 侧**复用现有 `scan_runtime_hotspots`**（命令面仍 196/200）：`HotspotItem` 扩展 `calls / avg_ns / max_ns / excl_avg_ns / excl_max_ns`（calls=0 → None，缺省行为不变），`read_trace` 单独一条 `WHERE perf_calls > 0` 的 SELECT（PR-A2-P3 前旧库缺列静默跳过）。`SQLITE_OPEN_READ_ONLY` 不变（A1 只读约定延续）。验证：probe **89/89**（+2 store 用例：perf 落库累加与 max 取大 / 旧库迁移补列）；外壳 `cargo test --lib` **319 通过 / 2 忽略**；`intel_cmds.rs` 472→**533/600**（余 67 行，未触发行数预算 PR）；budget-check **33 项全 PASS**。
> **⑳续 PR-A2-P4（热点视图「耗时」视角，同日落地）**：`hotspotsView.ts` 工具栏加排序切换（`#hp-sort`，`btn--primary`/`btn--ghost` 互切表达 active，仅 `hasPerf` 时可见）；新增 `hasPerf`/`fmtNs`/`updateSortBar` helpers；time 视角按 `avg_ns` 降序（tie 回落 hits）；行内「平均 x · N 个样本」+ title 挂口径红线；无 perf 时排序栏隐藏 + `noPerfHint` 明示（样本完整度纪律）。**实证调整**：dev plan 原文为「平均/P99 列」，但 sink 只有聚合无直方图 → P99 无法精确计算，改为**平均耗时 + 样本数**列（同 P1 PY_UNWIND 先例，交付时注明）。预算：`hotspotsView.ts` 282→**350/350**（压缩既有注释与按钮组保住预算）、`hotspots.css` 44→48/60（复用 `.btn`/`.hp-hits`）。验证：tsc ✓ · vitest 1271 ✓ · e2e ux 域 **10/10**（新增 HS-9 耗时视角 / HS-10 无 perf 提示）· budget-check 33 项全 PASS。dev plan 升 v0.5。
> **⑳续 PR-A2-P5（设置项「性能模式（默认关）+ 开销提示文案」，同日落地）**：Rust `Settings.probe_perf_enabled`（默认 false）+ `run_env::assemble` 注入 `OPENCHARM_PROBE_PERF=1`（仅 `probe_src.is_some() && perf_mode`——探针关闭时 perf 无意义不注入；perf 注入四象限单测锁定），`terminal.rs` 接线、`dap.rs` 补 false。前端设置行落 `index.html`（§5 口径红线文案：耗时为含探针开销的相对值，用于排序不等于真实耗时）+ `settingsPanel.ts` 填表/提交/关键词 + i18n 三步流程（html_dict/en_3 静态词条 + settings 域 `kw.probePerf`）。**e2e 基建顺手修复**：`tauri-mock` 的 staticHandlers 分派原来不传 args（`set_settings` 收不到入参），改为 `h(args)` 透传并记录 `__E2E_SETTINGS_SAVED__`。验证：`cargo test` 320 ✓ · vitest 1271 ✓ · `npm run build` ✓ · budget-check 33 项全 PASS（产物 5,035/5,120 KB）· `audit_tokens.py` 0 FAIL · e2e settings 域新 spec **4/4**（HS-11 默认关+红线文案 / HS-12 保存值+回填 / HS-13 需探针提示 / HS-14 搜索命中）。dev plan 升 v0.6。
> **⑳终 阶段二收口（2026-10-07）**：A3 / A4 剩余子项按覆盖 / 既有裁决**全部关闭，阶段二整体收口**——
> - **A3④ 调用处参数名 inlay hint → 不立项（已覆盖）**：pyrefly 官方支持 `python.analysis.inlayHints.callArgumentNames`；shell 已由 PR-N 接通——`lsp/client.ts` `pushInlayHintSettings` 把 `inlay_param_hints`（默认开）映射推送 + `registerLspInlayHints` 双源 provider 已注册（2026-10-07 实证，无需 intel 自研）。
> - **A4② 请求回放 → 不立项（已覆盖）**：B4 HTTP 工具历史区（最近 20 条点击回填）已是回放，独立面板重复建设（原裁决维持）。
> - **A4-Py 选择器 Python 引擎 → 不立项（已裁决）**：求值引擎裁决为「前端浏览器 DOM」（DOMParser + querySelectorAll / document.evaluate），Python 侧降级登记；口径差异已常驻一行说明 + e2e SEL-9 钉住（原裁决维持）。
> - **阶段二全量交付**：A1 运行时热点视图（⑫）· A2 内置 Profiler（⑰~⑳，已收口进验收维护态，`profiler_acceptance_record.md`）· A3①②③ 实参补全 / hover 观测签名 / signatureHelp（⑭⑯）· A4①③ 选择器测试器 / 响应→模型桥（⑮）· A5①② 请求样例 / 一键 curl（⑬）。
> **下一步**：**阶段二已收口，进入维护态**（运行侧只受理开销回归 / trace 迁移 / 预算违约修复；工具箱侧只受理缺陷修复与既有工具打磨）。后续候选批次待用户另行裁决。
>
> **㉑ 维护态首件：TD-021① 终端背压 UTF-8 口径已修（2026-10-07，用户指定 P1-5 ① 先行）**。此前 `terminal.ts` 背压队列用 `data.length` 累加「字节数」——那是 UTF-16 码元数，CJK 一个字符 1 码元 / 3 UTF-8 字节，中文输出下单帧 256KB / 积压 4MB 阈值实际放宽 ~3 倍。修法取登记中的「改存 Uint8Array」分支：新增零依赖模块 `terminalBackpressure.ts`（push 时 `TextEncoder` 一次编码，计数 / 切分 / 丢弃 / 限流提示全按真实 UTF-8 字节；浏览器无 Node `Buffer`，原登记的 `Buffer.byteLength` 路线不可行），`terminal.ts` 只留接线，i18n 文案与 ANSI 序列仍在壳侧。xterm.js v5 `write(Uint8Array)` 自带增量 UTF-8 解码，字节边界切分不乱码。配套：新增单测 6 例（CJK 计数 / 预算切分拼回 / 硬上限丢旧 / 限流只提示一次 / 清空与边界 / 字节边界合并解码）+ 预算条目 `terminal_backpressure_ts_max_lines = 130`（预算 36 → 37 项）。
>
> **㉒ TD-021③④⑤ 已修（2026-10-07，用户指定续推 P1-5 剩余项）**：**③** `sessions.rs` 快照改保尾——`truncate(MAX_TABS)` 丢的是最近打开的 tab，与「恢复最近现场」直觉相反；改 `tabs.split_off(len - MAX_TABS)` 留最近 40 个，并同步活动 tab 判定（active 指向已丢 tab 时清掉，回落「激活最后一个」）。**④** `proc_stats.rs` 只数直接子进程，运行链中间层（cmd /c、shell 包装）下的孙进程内存漏计、芯片口径偏小；改按 parent 邻接表 BFS 收集全部后代，visited 防环（进程 parent 关系极端下可能成环，裸递归会栈溢出），环处理与 sysinfo 解耦成纯函数 `collect_descendants` 直接单测。**⑤** `debugWatches.ts` 顶层 `load()` 读 localStorage 是 import 即触发的副作用（同「模块顶层禁止立即解析 DOM」纪律）；改惰性初始化——`watches` 先置空，`ensureWatchesLoaded()` 在首次 `render()`（面板接线唯一网关）时加载。验证：cargo test 320 → **323**（新增 3 例）、cargo check 通过、vitest 1277 不变、tsc/build 零错、budget 37 项全 PASS。P1-5 仅剩 **②**（session.ts `restoring` 布尔非令牌，场景罕见）。
>
> **㉓ A5③④ 端点面板余项已交付（2026-10-07，维护态下用户破例立项）**：③ handler→route 反向跳转 + ④ OpenAPI 面板内预览。
> - **③**：`epJumpCore.ts` 纯函数核（`buildHandlerIndex` / `findMatches`，NUL 分隔复合键）+ `epJump.ts` CodeLens provider——`def` 行上方「端点 N」lens（同 handler 多 route 合并计数），点击弹 content widget（`.oc-epj-popup`，行 = 方法徽章 + route + 定位 + 复制 URL），行点击激活端点面板并高亮该 route 条目（`ep-highlight` 1.2s 自消）。**实证调整 1（刷新机制）**：首次 provideCodeLenses 返回空、依赖「ensureIndex 完成 → notify → Monaco onDidChange 补刷新」实测 flaky（Monaco 的 onDidChange 补刷新在部分时序下不触发）——改为 `await ensureIndex()` 首扫完成才出 lens + codeVision 同款多路刷新触发器。**实证调整 2（弹层时序）**：showEpPopup 同步执行时直接注册 document mousedown 会被「打开弹层的同一次 mousedown」在冒泡阶段命中（事件派发到 document 时监听已注册）→ 弹层创建即关——改 `setTimeout(0)` 延后注册（queueMicrotask 在 Playwright 事件时序下仍会提前，实测不可靠）。**实证调整 3（跳转高亮）**：端点视图 onShow = 每次切 tab 都重扫，`setSidebarTab` 后同步遍历列表必然扑空（列表已被清空）——高亮改为「记 pending → renderEndpointPanel 重建完成后再应用」。**实证调整 4（e2e 点击）**：`.codelens-decoration` 是整行容器（Monaco 同行为多 provider 各渲染一个 `> a`），点击容器中心会落到引用 lens 弹出 cv 弹层——e2e 必须定位 `> a` 按文本过滤。
> - **④**：Rust `openapi_cmds.rs::fetch_openapi`（命令面 **196 → 197/200**；错误形态 `HttpInvalidUrl:{detail}` / `HttpStatus:{code}` / `HttpParse:{detail}`，zh 界面原样返回）+ `openApiCore.ts`（`findScanMatch` path 全等 + method 交集 / `sortOps` 方法档位排序）+ `openApiPanel.ts` 懒加载展开块（`.ep-preview`，方法/路径/summary/tags 行，行点击匹配静态扫描结果跳源码；无 base 提示先运行）。**实证调整（测试）**：serde_json Map 默认 BTreeMap 字典序遍历，Rust 单测断言不得依赖数组顺序，改 `find_op` 按 (method, path) 显式查找。
> - **验证**：cargo test 外壳新增 7 例 openapi 单测（其中 1 例断言改为按 (method, path) 显式查找，不依赖数组顺序）· vitest **1291**（新增 epJumpCore / openApiCore 纯函数单测）· tsc/build ✓ · budget **43 项全 PASS**（新增 6 项上限：epJump 380 / epJumpCore 110 / openApiPanel 220 / openApiCore 110 / endpointJump.css 175 / openapi_cmds.rs 320；**实证偏差**：epJump.ts 349/380、endpointJump.css 144/175，未触线）· e2e ux 域 **48/48**（新增 `e2e/ux/07-endpoint-lens-openapi.spec.ts` 4 例：EP-J1/J2/P1/P2）· audit_tokens 0 FAIL。附注：OpenAPI 预览需服务运行中（拉 /openapi.json），是「运行态联查」，静态扫描识别不到的端点照实不匹配（绝不臆测）。
> **㉔ P0-2 第一格已按 v1.4 死线撤下（2026-10-07）——P0 至此全部关闭**。⑩ 设的二选一截止到期执行：本机无 PyCharm，23 点人工横向对标**从 P0 撤下，不再挂账**。三处落点：① **README「已知边界」**由"⏳ 阻塞中的待办"改为**定稿口径**——「**未与 PyCharm 做过横向对比**」是显式声明而非待办语气，并同步第二格最新数据（3 个真实项目 / **497 条函数观测** / 742 B 每条 + `trace-sample-threshold.md` 的收口处置）；② **`intel/README.md`** 三处 ⏳ 状态戳关闭——P3-T10 行改为「第一格 ❌ 撤下 / 第二格 ✅ 已采收口」，现状表「人工横向对标」→ ❌ 撤下（含复用条件与"结论须改写为对 X"的纪律）、「真实项目端到端」→ ✅ 3 项目 497 条；**「trace 库保留窗口」一行仍 ⏳，那是真待办**（代码里确实没有条数/体积上限，`probe clean --days N` 只删 runs 行），本轮只补上"建议 ≤11,309 条 / 8 MB，仍是建议值未落代码"；③ **`bench/reports/gate-d-ab-worklist.md`** 加撤下头注（OpenCharm 侧 23 点排名**保留归档**，将来换对照组可直接复用，但结论必须写成"对 X"，不得冒充原命题）。
> 　**对外口径从此定稿**：可写的只有「在自有样例集上 23/23」这类**自证**表述，「比 PyCharm 更准」仍不可写（`CONTENT-SERIES.md:192` 同口径）。
> 　**收口后的状态**：P0-0 / P0-1 / P0-2 / P0-3 / P0-4 **无一挂账**；§0 缺口 2 收敛为「有真实样本但样本量未达门槛」，且该门槛已裁定**改为日常 IDE 使用自然累积**（`bench/reports/trace-sample-threshold.md` §4）、不再消耗人力。**阶段一第 4 件至此关闭**（不是"做完了"，而是"按规则撤了"——这正是二选一截止规则要的效果：清单里不再有"永远挂着"的项）。
> **㉕ P1-4 复核：整项不立项，收窄为 B4 真机一刀（2026-10-07）**。原议「补 LSP 真引擎 / 运行真 `uv run` / 终端真 PTY / 插件真加载」四域，经代码核对：**LSP 真引擎早已交付**（`shell/e2e/lsp/02-pyrefly-real.spec.ts`，真 spawn `pyrefly lsp`）、**运行 + 终端已被 `release-real.cjs` REL-5 部分覆盖**、**插件无跨进程价值（不排）**，真空白只剩 **B4 HTTP 的 reqwest 真实链路**。→ 整项 2~4 人日**不立项**，只留 B4 一刀（0.5~1 人日），**先决条件是绑定触发点**（真机层无 CI 宿主：远端只有 Gitee，9 套脚本至今零跑通证据；建议绑**发布前验收**而非 nightly）。**本次是报告失真（把已交付写成建议补），不是"建议没被执行"**——与 v1.3 那类"挂账未做"性质不同，处置也不同：前者改文档，后者要排期。
> 　**前置动作已尝试、未跑通（⛔ 环境阻断）**：全量跑批（`shell/e2e-real/run-real-all.ps1`，默认 6 套 / 跳过 probe 三支）在本会话环境下起不来——`npm run tauri dev` 稳定 panic `failed to run 'npm run dev'`，而同一终端裸 `npm run dev` 正常（详见 §2 P1-4）。**真机层至今仍是"零全量跑通记录"**。
> 　**但这次尝试已经产出价值——暴露 3 条，其中 2 条当场修掉**（此前无人发现，正因为没人跑过）：① ✅ **db-real 不可复现已修**（内联造数脚本；**并顺带挖出第二个根因——`spawnSync` 在本机 EBUSY 静默失败**，改异步 `runCmd`；实测 T14-0 PASS）；② ✅ **启动失败不可见已修**（`waitCdpReadyWatched`：盯进程 exit + 扫日志 panic，实测 db-real 5s / endpoints-real 3s 失败，原为 1500s）；③ ⛔ 会话环境跑真机不可行（须在用户终端跑，属外部条件）。**结论：真机层当前的最大缺口不是"域不够"，而是"没人跑 + 跑不起来也没人知道"**——后半句本轮已解决。
> 　**✅ 首轮真机基线已出（2026-10-07 16:35，用户终端）**：`debug-real 14/14 · endpoints-real 4/4 · multi-window-real 16/16 · ui-real 39/39` = **73/73 PASS，合计仅 3 分钟**（原估 30~60 min 偏高，修正为 **10 min 量级**）。**但 db-real / new-project 显示「无报告」又暴露 3 条，均当场修掉**：④ 两个自实现套件**从不落 JSON**（分不清"没跑"与"跑了失败"）；⑤ **运行中断被当成成功（假绿）**——db-real 的 `catch` 不设失败计数 → 退出码 0 → 跑批报"失败 0 个套件"，**首轮"全绿"因此是假象**；⑥ **5173 预检形同虚设**（`portInUse` 用 HTTP `/json/version`，而 vite 不提供该端点；实测 vite 只绑 `[::1]`）→ 已改 TCP 双栈探测。**最终（第四轮，HEAD `80d9fe8`）：6 套 / 95 项全绿，db-real 18/18，全量约 8 分钟**——真机层至此有了可复现的全绿基线（详见 §2 P1-4 四轮小节）。
> **㉖ P1-4 收尾：触发点已绑 + B4 真机一刀已交付（2026-10-07）**。① **C 触发点（先决条件，已完成）**：真机层最大的问题是"没人跑"（`nightly.yml` 编排了脚本但本仓远端只有 Gitee、Actions 不执行），现绑到**发布前验收**——`build-release.ps1 -Verify` 在打包后自动跑 `run-real-all.ps1 -PreRelease -Strict`（release-real + 开发链路 6 套，约 12 min，失败即非零退出）；不加 `-Verify` 时打印黄字提示，使"忘了跑"在出包输出里可见。跑批新增「模式」行与 **divert 代理预检**（25378/18080/8888 在监听即告警——它走驱动层，开着会让整套 `ERR_PROXY_CONNECTION_FAILED`，环境变量与 `--no-proxy-server` 都躲不掉）。② **B B4 HTTP 真机一刀已交付**（`shell/e2e-real/http-real.cjs`，HR-1..HR-11，覆盖 reqwest 真实链路：TCP / 响应头 / 重定向 / 超时 / 取消分块边界 / 二进制 / 5MB 截断 / 主机名解析；服务端记录到 `User-Agent: OpenCharm/0.1` 是跨进程硬证据）。③ **顺带修掉跑批自身一条缺陷**：PS 5.1 把 native stderr 包成 `NativeCommandError`，配 `$ErrorActionPreference="Stop"` 会**让任一真机脚本的 stderr 终止整轮跑批**（实测第 2 套件即整脚本退出、不写 SUMMARY）——与 `build-release.ps1::Invoke-Native` 同一个坑，已按同法加包装并实测修复（7 套全部跑完）。④ **B 已真机验证 ✅**：首轮（17:51）暴露「按键早于 init 的键位接线」→ 修就绪判据（commit `23c7b53`）；第二轮（18:06，HEAD `3552012`）**`http-real` 10/10 PASS（36s）**。
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

功能广度上它仍在扩张：编辑增强、Git（六迭代）、调试（DAP/debugpy）、运行（PTY + 多实例）、终端、依赖健康、库特别支持、SQLite 工具、插件切片、国际化、UI 视觉身份，**以及 v1.2 之后新增的 HTTP 请求工具（B4）、结构化运行日志视图（B5）、运行时热点视图（A1）、端点请求样例（A5①）与 trace 驱动的调用实参补全（A3①+②）**，全部有验收记录与 E2E / 单测兜底。工程底座（**196 个 Tauri 命令、1240 个前端用例 / 100 文件、381 个 Rust 测试（321 外壳 + 60 intel）、版本锁定 + 2 个 workflow**）持续走强。**UI 视觉六批已全部落地并通过真机验收，"像没贴牌的 VS Code"这个诊断在批 4 之后已不成立。**

但 2026-10-05 的定位变更改变了评判坐标系：过去"够用就行"的地方（体积、告警是否有人看、性能是否实测）现在都是**一等目标**。按新坐标系重排，缺口从 v1.2 的两条变成三条：

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| ~~**0**~~ | ~~**预算已破线，且性能红线至今无实测落盘**~~ ✅ **已关闭（2026-10-06 本轮）** | `style.css` 按主题拆出 `styles/http.css` / `styles/logView.css`，回到 **5,748 / 5,850**，预算十二项全 PASS；`budget-check.mjs` 加 dist 新鲜度 STALE 判定；性能基线首次落盘 `bench/reports/metrics-20261006-091652.md`（冷启动 956 ms / 内存 339 MB，双红线 PASS） | ~~唯一处于失败态的硬约束~~ **已消除**。遗留：CI 侧尚未跑过 budget/bench（→ 缺口 1） |
| 1 | **门禁配置齐备，但零跑通证据——根因是 CI 没有宿主**（v1.2 记"待观察"，v1.3 记"零证据"，**2026-10-06 第二轮查出真根因**） | ✅ `ci.yml` push 分支已对齐 `[master, main]`、`audit_tokens.py` 已进 test job、**`budget-check.mjs` 已并入 test job（子项 5）**、`nightly.yml` 三 job 齐备、`OC_JSON_OUT` 汇总、`v*` tag 触发。✅ 性能基线已落盘 `bench/reports/metrics-20261006-091652.md`。⏳ **本仓远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions** —— 两份 workflow 无论怎么改都不会跑，"push 一次 master 看 Actions 触发"这条收口动作**在现宿主下永远拿不到证据**。⏳ 「只告警不阻断」在新定位下论据过期，已进 TD-025 复审清单第 1 条 | 分歧台账 D-001/D-005/D-007 的根因都是**真机才暴露**的集成缺陷。护栏的硬件装好了，但**从没接上电源——连插座都不在这栋楼里**：v1.2 把"配置交付"记成"能力交付"，v1.3 降档为"零证据"，直到本轮才查到"没有宿主"。✅ **已裁决（2026-10-06）：维持现状 + 文档标注**——`.github/workflows/` 定位为"将来推 GitHub 的预埋"。**缺口 1 由此从"待办"降级为"待外部事件"（迁移到 GitHub 后首次 push 的 run 记录），保持开启但不再消耗人力** |
| 2 | **差异化核心缺最后一格证据**（第一格仍零进展；**第二格 2026-10-06 取得真实项目样本**） | Gate D 确定性口径**已 PASS**（23/23 = 100%，红线 ≥85%）；① **PyCharm 人工横向 ❌ 已按死线撤下（2026-10-07，见续记 ㉔）**（本机已无 PyCharm，工作单 23 行仍全 `☐`）→ 二选一截止到期即撤项，**README 已知边界已写明"未与 PyCharm 做过横向对比"**（定稿口径，不再是待办语气）；工作单保留归档，将来换对照组须改写为"对 X"。**"比 PyCharm 更准"仍是不可写表述**（改为永久纪律，不再挂"在此之前"的期限）；② ~~真实项目 trace 仅 56 条~~ → **已在 `metawake/backend`（73 py / 350 def）上跑通采集：277 条函数观测、覆盖率 79%、hits p50 2 vs p99 56、606 B/条**，但距 ≥1000 门槛仍差 3.6 倍且**单项目已近饱和**（→ 需跨项目累计）。→ **2026-10-07 已跨 3 个真实项目累计到 497 函数观测**（+`pylume/probe` 187 +`cb_watcher/backend` 33，7 次运行 / 742 B 每条；另见 §8 的两条新发现：hits 被静音截断在 200、stale 仍 0%），**项目数已达标，口径歧义待定**（函数观测 497/1000，类型观测合计 1032 已过）。`STALE_HITS_DIVISOR` 仍为 **2**（`completion.rs:32`） | 项目立身之本（运行时智能）现有"能用"的证据 + **首个真实分布**，但**还没有"比 PyCharm 更好"的横向证据**；降权参数仍是"建议值"而非落值 |

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
| **巨型文件（P0-4 两版零进展）** | `env_cmds.rs` **4,945**（预算 5,050 = 长期上限 + 冻结线）· `fs_cmds.rs` **3,882** · `git.ts` **3,204** · `main.ts` **2,094**（预算 **2,400**；2026-10-06 阶段二两刀共 −825 行）· `git_cmds.rs` **1,940** · 新文件 `menuItems.ts` **570**（上限 690）/ `debugEntry.ts` **171**（205）/ `windowKeys.ts` **147**（180）/ `sidebarViews.ts` **107**（130）/ `windowChrome.ts` **73**（90） · `lsp/client.ts` **1,774** · `db_cmds.rs` 1,537 · `fileTree.ts` 1,332 · `settingsPanel.ts` 1,154 · `live-templates/ui/manager.ts` 1,128 | ⚠ **v1.3 复核**：`env_cmds.rs` / `fs_cmds.rs` / `git.ts` / `lsp/client.ts` 在 `ccf9da2 → bb32d77` 之间**仍是一行未变**；`main.ts` +17、`git_cmds.rs` +58。**P0-4 在 v1.2 与 v1.3 两版里连续被记为"待拆"，实际动作为零**——这类连续挂账项应改判为"要么拆，要么从清单里撤掉并接受它"，否则清单本身失去可信度。另：前十门槛出现三个新面孔（`fileTree.ts` / `settingsPanel.ts` / `live-templates/ui/manager.ts`），说明"大文件"正在从历史遗留向新模块扩散 |
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
| 运行时智能 | `probe/` + `intel/` | ✅ P3-T01~T09 交付 + **P3-T11（A3①+② 调用实参补全 / hover 观测签名）2026-10-06 交付**；**P3-T10 两格已全部关闭**（2026-10-07，见续记 ㉔）：第一格 ❌ 按 v1.4 死线撤下（本机无 PyCharm）· 第二格 ✅ 已采并收口（3 真实项目 / 497 条函数观测；`intel/README.md` 三处 ⏳ 已同步关闭） |
| 多窗口 | Rust `per_window.rs` / `window_mgr.rs` | ✅ 阶段 0/1/2 全部交付（`multi_window_dev_plan.md` v0.2；真机 `multi-window-real.cjs` 16/16 PASS）；#4~#6 依赖健康缓存经拍板暂缓 |

### 1.4 质量底座

| 项 | 现状（门禁基线 · 2026-10-06 A4①+③ 交付后刷新；规模类快照见 §1.1，仍锚 `bb32d77`） | 评价 |
|---|---|---|
| 前端单测 | **101 个 `*.test.ts` / 1271 用例全绿**（A4 新增 `devtools/builtin/__tests__/selectorCore.test.ts` **31 例**；2026-10-06 门禁）；v1.2 写的 1070、v1.3 写的 1215、v1.4 写的 1240 均已过时 ✅ **`delivery-overview.md` 2026-10-06 已同步为 1271** | 强 |
| Rust 单测 | `src-tauri` **321** 个 `#[test]`（含 2 个 `#[ignore]`，实跑 319）+ intel **72**（59 + 6 + 7）→ 合计 **393** 个（通过 **391**，与 `delivery-overview.md` §1 口径对齐）。⚠ **A4 轮次外壳实跑 318 passed / 1 failed**：唯一失败 `lib_cmds::tests::stdin_utf8_roundtrip_with_real_python` 是**会话沙箱环境故障**（Windows `os error 231`，带管道 stdin 的 `Command::spawn` 被拒；零 Rust 改动 + 同函数 `Stdio::null()` 路径全过 + 绕开 cargo 直接跑二进制同样复现 → 非回归），详见 §续记 ⑮ 末条 | 强（A4 轮次 1 例环境故障待复跑） |
| Python 单测 | probe **81** 个 pytest | 强 |
| E2E（mock 层） | `shell/e2e/` **70 个 spec（不含 `_probe/`）/ 71 个（含）**，11,442 行；A4 新增 `tools/01-selector.spec.ts`（**10 条**，含 XPath 真实命中与「CSS 与 XPath 语义不同」的现场证据）；`http/` 12 条（B4）、`logs/` 11 条、`todo/` 7 条、`ux/02` EP-S1~S5（A5①）。**口径说明**：v1.4 写的「69 个 spec（11,161 行）」与 `delivery-overview.md` 的「70 spec」计数范围不同（前者不含 `_probe/`、后者含），本表起**两者都写清** | 强 |
| E2E（真机层） | `shell/e2e-real/` **10 个 `.cjs`**（`db/debug/endpoints/multi-window/new-project-fastapi/ui/release` + probe 三支），手动执行；**`nightly.yml` 已编排 9 套串行，但无跑通证据** | **中**（编排有了，证据缺） |
| 专项门禁脚本 | `tools/ui/audit_tokens.py`（98 项，**2026-10-04 起进 CI test job**）+ `gate-tests.mjs unit\|e2e\|e2e-ui` + `ui-baseline.mjs` + `budget-check.mjs`（**33 项** + `.ps1` 编码卫生；A4 新增 4 个上限，其中**首次纳入 `http.ts`**；A3③ 再新增 `signature.rs` / `server.rs`） | 好实践；`budget-check.mjs` **已并入 `ci.yml` 的 `test` job**（2026-10-06，P0-1 子项 5）；**剩余缺环是 nightly 无跑通记录**（宿主错配，见本表 CI 行） |
| 分歧台账 | `e2e_divergence_ledger.md` D-001~D-007，含避坑速查 6 条 | 好实践，但资产未自动化 |
| CI | **2 个 workflow**：`ci.yml`（`test` 4 矩阵 + `package-smoke`；push 分支已对齐 `[master, main]`，tags `v*`；含 `audit_tokens.py` **与 `budget-check.mjs`**）+ `nightly.yml`（`e2e-real` / `bench` / `budget` 三 job，`schedule` 每日 03:17 UTC，全部 `continue-on-error`） | **配置强 / 证据无 / ⚠ 宿主错配**：① `bench/reports/` 已有 `metrics-*.md`（本机跑的基线），但无 `budget-*.md`（CI 产物）；② **本仓远端只有 `gitee.com/usedel/opencharm`，Gitee 不执行 GitHub Actions** —— 两份 workflow 不会被调度，与"配置已交付"的记账直接冲突（详见 §0 缺口 1 与 §2 P0-1 子项 7） |
| 版本锁定 | `ci/versions.toml`：tauri 2.11.5 / monaco 0.52.2 / pyrefly 1.3.1 / basedpyright 1.39.10 / ruff 0.16.1 / debugpy 1.8.21 / python 3.13.7 / uv 0.10.11 / rust 1.96.0 | 强 |

> **口径提示（2026-10-06 A3③ 交付后刷新）**：本表是**门禁基线**，数字已按当前 HEAD 实测刷新，**引用时以本表为准**。三点说明：
> ① **`budget-check.mjs` 项数随版本增长**：10（v1.2）→ 12（P0-0 拆样式分文件）→ 17（阶段二第一刀）→ 20（A1）→ 25（A5①）→ 27（A3，首次纳入 intel crate 的 `completion.rs` / `hover.rs`）→ 31（A4，新增 `selectorCore.ts` / `selector.ts` / `styles/selector.css`，并首次纳入 `http.ts`）→ **33（A3③，新增 `intel/…/signature.rs` / `intel/…/server.rs`；33 = 30 个文件行数上限 + 命令数 + 产物体积 + `.ps1` 编码卫生）**。本文历史续记（各版本 ⑦~⑮ 条、§0 缺口表、阶段一/二回顾表）里出现的「十 / 十二 / 十七 / 二十 / 二十五 / 二十七 / 三十一 项」**是各时点写下的历史值，不再逐处改写**——它们记录的是"当时达标了"，不是"现在只有这么多项"；**凡表述为"当前 / 现状"的位置已就地更新为 33 项**。
> ② **Rust 计数有两套口径**：本表按 `#[test]` **属性数**（`src-tauri` 321 = 319 实跑 + 2 `#[ignore]`），`delivery-overview.md` §1 按**通过数**（391 = 319 + intel 72）——同一事实的两种切法，非矛盾。**A4 轮次外壳实跑只有 318 通过**，差的 1 例是沙箱环境故障（见 §续记 ⑮ 末条），不并入基线。
> ③ **E2E spec 计数有两套范围**：`_probe/` 是探针脚本、不是验收用例，故「mock 层」只数它以外的（70 个）；含它则为 71 个。引用时**必须写清是否含 `_probe/`**。

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

- ~~**事实（本机实测，HEAD `bb32d77`）**~~：~~`budget-check.mjs` 十项里 **1 项 FAIL**：`style.css` 5,987 / 5,850（超 137 行）~~ → **当前三十一项全 PASS**（`style.css` 5,751/5,850 · `styles/http.css` 102/125 · `styles/logView.css` 170/205 · `styles/hotspots.css` 44/60 · `styles/endpointSample.css` 97/125 · `styles/selector.css` 132/165 · `devtools/builtin/selectorCore.ts` 379/460 · `devtools/builtin/selector.ts` 394/480 · `devtools/builtin/http.ts` 900/980 · `intel/…/completion.rs` 1632/1950 · `intel/…/hover.rs` 392/470 · 产物 5,032/5,120 · 命令 196/200 · 其余同前）。
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
  1. ~~人工对标工作单~~ ✅ **已自动生成** `bench/reports/gate-d-ab-worklist.md`：设 `OC_GATE_D_WORKLIST=<路径>` 后跑 `cargo test -p opencharm-intel -- --nocapture runtime_completion_accuracy` 即导出——**OpenCharm 侧 23 点的实际排名已由测试填好**，人只需在 PyCharm 同一样例上勾"是否在 top-5"。避免了让人重新拼 23 个光标位置（既慢又必然与 cases 数组漂移）。
     **⛔ 2026-10-06 状态变更：外部阻塞**——**本机已无 PyCharm**，该动作暂时无法执行。三个出口（请择一，不要让它继续"挂着不动"）：① **装 PyCharm Community（免费）后再做**（约 0.5h 安装 + 1h 勾点）；② **换成能做得到的对照组**（如 VS Code + Pylance），但**对标结论必须改写为"对 X"而非"对 PyCharm"**，不能拿它冒充原命题；③ **撤下**——按本报告 §P0-4 的二选一规则，若 **v1.4 仍无对标**就默认走这条，同时在 README「已知边界」写明"未与 PyCharm 做过横向对比"。**无论哪条，在新证据出现前"比 PyCharm 更准"都是不可写的表述**（口径纪律见 `CONTENT-SERIES.md:192`）。**→ ✅ 出口 ③ 已于 2026-10-07 执行**（v1.4 死线到期，见续记 ㉔）：README 已知边界改为定稿声明、`intel/README.md` 三处 ⏳ 关闭、`gate-d-ab-worklist.md` 加撤下头注；
  2. ~~在**一个真实项目**上跑 probe 采集~~ ✅ **已完成一次**（`metawake/backend`：277 条 / 覆盖率 79% / hits p50 2 vs p99 56 / 606 B 每条）；**✅ 累计已完成并收口（2026-10-07）**：再采了 **`pylume/probe`（187）** 与 **`cb_watcher/backend`（33）** → 合计 **3 项目 / 7 次运行 / 497 函数观测**（742 B 每条）。**门槛口径已定死为函数观测 → 497/1000 未达**，但**项目数已达标**；本机采样源经两轮扫描确认触顶（`D:\PycharmProjects` 8 个项目无一可用），故**停止专门采样，改为日常 IDE 使用自然累积**。详见 `bench/reports/trace-sample-threshold.md`；
  3. 结论回写 `intel/README.md` 与 `dev_plan_v2` §7，把 ⚠️/PENDING 改成 ✅ 或明确记 ❌。
- **成本**：第二格已花约 **0.3 人日**（含装隔离依赖、跑两遍、清理）；第一格 **0.5~1.5 人日但受外部条件阻塞**（需先有 PyCharm）；第二格收尾（再采 1~2 个项目）约 **0.3 人日/项目**。v1.0 估 3~5 人日。
- **验收**：`gate-d-ab.md`（= 工作单填完 PyCharm 列，**⛔ 当前不可执行**）+ 降权参数在**跨项目 ≥1000 条函数观测**上复核（**现 497，未达 → `STALE_HITS_DIVISOR` 维持 2，且 stale 真实证据仍为 0**；收口口径与复核触发条件见 `bench/reports/trace-sample-threshold.md`）+ 三处文档状态一致。**第一格的替代验收（若走"撤下"）**：~~README 已知边界出现"未与 PyCharm 做过横向对比"的显式声明~~ ✅ **已完成（2026-10-07，见续记 ㉔）**——README「已知边界」改为定稿口径（`未与 PyCharm 做过横向对比`），`intel/README.md` 三处 ⏳ 同步关闭，工作单转存档。
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

### P0-4 · 偿还结构性债（拆分）—— ✅ **已裁决（2026-10-06）：折中路线「先冻结，再择机拆」→ 2026-10-07 已执行拆分**

- **问题（v1.3 重估）**：`env_cmds.rs` **4,945** 行（Rust 侧最大单文件，32 个命令；2026-10-06 起带冻结线注释 8 行）；`fs_cmds.rs` 3,882 / `git.ts` 3,204 / `main.ts` **2,094** / `git_cmds.rs` 1,940。（**2026-10-06 已动两刀**，见建议动作 2）
- **⚠ v1.3 新增判断**：`env_cmds.rs` / `fs_cmds.rs` / `git.ts` / `lsp/client.ts` 在 `ccf9da2 → bb32d77`（23 个提交）之间**仍是一行未变**；`main.ts` +17、`git_cmds.rs` +58。加上 v1.2 已确认的 `44c85ea → ccf9da2`（20 个提交）同样零变化——**这条建议已在两版报告里被写下、在 43 个提交里被执行 0 次**。
  **这不是"还没轮到"，而是"它被反复写进清单却从没排上"**：要么本轮真正排期，要么**显式裁决为"接受现状、从清单撤下"**并把 `budgets.toml` 的 `env_cmds_rs_max_lines` 从"拆分前防涨"的临时值改成长期值。第三种状态（挂着不动）只会持续消耗清单的可信度——这正是 §0 自我校验位要暴露的问题。
- **✅ 裁决（2026-10-06，产品负责人选定「折中：先冻结再择机拆」）**——三选一里的中间路线，落点有三条，**全部已生效**：
  1. **冻结线**：新增的 Python 环境类命令**一律落新文件**（如 `env_cmds_pkg.rs`），`env_cmds.rs` **只减不增**——纪律写在 `env_cmds.rs` 文件头（改的人第一眼就能看见）与 `ci/budgets.toml` 注释里。**记账**：为写这条纪律，本轮给 `env_cmds.rs` 新增 **8 行纯注释**（4,937 → 4,945），命令数不变；这是"只减不增"的唯一例外，且在此显式记账，不让它成为日后"注释也算涨"的口子；
  2. **上限改长期**：`env_cmds_rs_max_lines = 5050` 由"拆分前的临时值"改为**长期值**，不再预期它下降（理由同时写进 `budgets.toml`：它是 Rust 侧文件，不进前端产物、不影响冷启动，与 ADR-0010 的两个一等目标无关）；
  3. **拆分保持候选，排到阶段二、不设死线**：按解释器管理 / 包操作 / 版本探测切三块、目标 < 2,500（−49%）的工作量与风险不变，但不作为"必办"挂账。
  **为什么不选另外两条**："真拆"要 3~4 人日且当前无可复用的痛点驱动；"接受现状"省事但等于放弃任何约束——冻结线是**唯一当下就生效、且不会再次失信**的选项：它把"拆或不拆"的二选一，换成了一条不需要排期也能执行的规则。
- **✅ 拆分执行（2026-10-07，"择机"兑现）**：按业务域切四块（`run_config.rs` 工作区配置/运行配置/项目入口探测 · `dep_health.rs` 依赖健康前半：style/声明解析/环境快照/E5 lock · `dep_fix.rs` 后半：探针执行/diff/dep_scan/忽略清单/修复动作 · `env_cmds.rs` 瘦身：解释器/venv/包管理/框架探针域）。**命令面 32 个与前端 invoke 字符串零变化**（纯模块重组、无行为变更）；验证：`cargo test --lib` 320 通过回到基线、`cargo check` 干净、budget-check 33→36 项全 PASS（四文件 1,374 / 674 / 1,044 / 1,968，均低于各自预算线）、bench_dep_scan 红线复跑 ≤ 2s（实测最慢 `fastapi_annotated` 1,685 ms）。行段归属见本次提交 diff，行数上限见 `ci/budgets.toml`。
- **建议动作**：
  1. ~~`env_cmds.rs` 按职责切三块~~ → **降级为阶段二候选**（见上，裁决已定；本轮不再作为 P0 待办挂账）；
  2. ✅ **`main.ts` 拆分第一刀已完成（2026-10-06，阶段二开工第一件事）**：2,919 → **2,312（−601 行）**。搬走的两块都只做"纯位移"（函数体逐字未改）：
     - **调试入口域 → `src/debugEntry.ts`（171 行）**：`runDebug` / `runDebugInner` / `stopDebugSession` / `runToCursorAtCursor` / `onEvaluateShortcut`——它只依赖 dap / runFlow / debugGutter / debugView / debugConsole 等域模块，**零 main 私有状态**，可直接搬；
     - **菜单与命令面板数据源 → `src/menuItems.ts`（570 行）**：顶部菜单 `getMenuItems` / Search Everywhere 动作表 `buildQuickOpenActions` / 断点右键菜单 / 运行 gutter 菜单。它需要的少数 main 私有动作（保存 / 关标签 / 工作区开关 / 最近工作区 / Live Templates 句柄）经 **`setMenuItemsHandlers` 注入解环**，与 `setRunWidgetHandlers` 同一套约定，**不制造 main ⇄ menuItems 静态环**。
     拆完**顺带把阈值从 3,000 下调到 2,600**（`budgets.toml` 纪律第 3 条：拆分后即降阈值，否则省下的余量会被下一个功能吃掉）；两个新文件各自设上限（205 / 690），防止 `style.css` 那一课在新文件里重演。
  3. ✅ **`main.ts` 拆分第二刀已完成（2026-10-06，`init()` 阶段化）**：2,312 → **2,094（−218 行）**。三块仍是纯位移，**注入面极小**（这是能安全外提的关键）：
     - **全局键位路由 → `src/windowKeys.ts`（147 行）**：window 级 keydown 派发（约 30 条分支）+ Double Shift 手势。它调的动作几乎都由域模块直接导出，真正 main 私有的只有 4 个（`saveActive` / `newScratch` / `closeTab` / `cycleTab`），经 **`setWindowKeyActions` 注入解环**；
     - **自绘标题栏与窗口边缘 → `src/windowChrome.ts`（73 行）**：窗口控制按钮 / menubar 拖拽 / 边缘 resize 热区——**零 main 私有依赖**，无需注入；
     - **侧栏视图注册表 + 活动栏 → `src/sidebarViews.ts`（107 行）**：7 个视图的 `onShow`/`onHide` + 活动栏点击 + 大纲折叠态（localStorage 持久化）——**仅注入 1 个回调**（`refreshOutline`）。
     阈值同步 **2,600 → 2,400**，三个新文件各设上限（180 / 90 / 130）；`budget-check.mjs` 由十四项增至 **十七项**。
     余下仍可继续外提的块：`init()` 里的 Monaco 装配段 / 各域事件接线段（`setXxxHandlers` + `initXxx` 长序列）/ 工作区生命周期 / 标签与保存域 —— **第三刀候选**。
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

现有 **11 个 `.cjs`** 已覆盖 debug / db / endpoints / http / multi-window / new-project / ui / release / probe 三支（nightly 编排其中 10 套串行）。原议按功能域继续补齐四域：**LSP 真引擎（pyrefly 裸会话）/ 运行真 `uv run` / 终端真 PTY / 插件真加载**，优先补**跨进程链路**类。

> **✅ 2026-10-07 复核结论（见续记 ㉕）：整项不立项，收窄为一刀。** 四域里**两域已不成立**——本次是**报告失真**（把已交付的写成"建议补"），不是"建议没被执行"：

| 域 | 原议 | 复核实测 |
|---|---|---|
| LSP 真引擎（pyrefly 裸会话） | 建议补 | ✅ **早已交付**：`shell/e2e/lsp/02-pyrefly-real.spec.ts`——Node 侧 spawn 真实 `pyrefly lsp`（版本锁 `ci/versions.toml` = 1.3.1），Content-Length 帧复刻 `lsp.rs` 协议，已覆盖 initialize 握手 / 跨文件跳转 / 补全类型推断 / docstring hover / missing-import 诊断 |
| 运行真 `uv run` + 终端真 PTY | 建议补 | 🟡 **已部分覆盖**：`release-real.cjs` REL-5 对**安装后的程序**跑真实 python 执行 + 输出落终端面板（真 PTY 链路已验） |
| 插件真加载 | 建议补 | ❌ 空白，但**插件是纯前端 JS、无跨进程**；devtools 已有 490 测试 + `e2e/plugins/` 1 spec → **真机边际收益最低，不排** |
| **B4 HTTP（跨进程 reqwest）** | 性价比最高 | ❌ **唯一真空白**：mock 层只有 `e2e/http/` 1 spec（前端层），reqwest 的真实网络 / DNS / 超时 / TLS / 重定向**全盲** → **保留为唯一候选** |

**裁决**：
1. ~~整项（2~4 人日）~~ **不立项**——四域里两域已交付/已覆盖、一域无跨进程价值，整项预算买不到对等收益；
2. **只保留 B4 HTTP 真机一刀**（0.5~1 人日），**先决条件是绑定明确触发点**：真机层 9 套脚本已编排在 `nightly.yml`，但**本仓远端只有 Gitee、Actions 不执行**（§9 禁则 5）——新增脚本若不绑定触发点，就会变成第 10 个"写好但没人跑"的资产（与 v1.3「把配置就位记成已交付」同构）。**建议绑发布前验收**（与 `release-real.cjs` 并列，出包后跑），不指望 nightly；
3. **前置动作（先做这个，再谈新增）**：跑一次现有真机全量，出**真机层基线报告**——先回答"真机层能不能稳定跑通 / flaky 多少"，这比新增域更基础。

- **成本**：整项 ~~2~4 人日~~ → **收窄后 0.5~1 人日（B4 一刀）+ 基线跑批 0.2~0.5 人日**。
- **跑真机前的环境预检**：① 端口 5173 / 9223 必须空闲（脚本共用，**必须串行**）；② 确认 `http-divert-proxy` 未运行——开着会让本地浏览器自动化 `net::ERR_PROXY_CONNECTION_FAILED` 直接挂（判据：25378 / 18080 / 8888 是否在监听）。**②已自动化**：跑批自带该探测，命中即黄字告警；③ 默认解释器 `D:\py\python.exe`（可用 `OC_REAL_PYTHON` 覆盖）。
- **⛔ 首次跑批尝试（2026-10-07）：未跑通，但暴露 3 条并已修掉其中 2 条**：
  1. **环境阻断（会话侧，未修·属外部）**：`npm run tauri dev` 稳定 panic `failed to run 'npm run dev'`（tauri-cli BeforeDevCommand）；同一终端里裸 `npm run dev` 正常、把系统 nodejs 目录前置 PATH 也无效 → 卡在 **tauri-cli 的子进程执行环节**，非端口/非 npm 本身。**真机基线须在用户自己的终端里跑**：`powershell -File shell\e2e-real\run-real-all.ps1`（6 套串行，约 30~60 min）。
  2. ✅ **db-real 不可复现（已修，2026-10-07）**——**两个根因，第二个是修的过程中才暴露的**：
     - ① **依赖未入库脚本**：原引 `scripts/_tmp/make_db_fixture.py`（从未入库）→ 改为**内联**（`db-real.cjs` 里 `MAKE_DB_FIXTURE_PY` 常量 + 运行前写出），规格照 T14-0：3 表 1 视图 1 索引 + 万行 `users`（`id INTEGER PK NN` + `name`，`idx_users_name` 建在 name 上）+ 8 列 `wide` + 3 行 `logs`；
     - ② **`spawnSync` 在本机 EBUSY 静默失败**（`status=null`、`stdout/stderr` 全空，报错只有「造数失败: (无输出)」——即使脚本存在也跑不通）→ 新增异步 `runCmd()` 替换（**与既有纪律一致：本机杀进程/起子进程不用 `spawnSync`**）。同处另一处 `spawnSync`（原生 SendKeys）一并改异步。
     - **实测**：`PASS T14-0 造数：3 表 1 视图 1 索引 + 万行主表 + 8 列宽表 + 3 行日志表`（断言前提逐条校验：3 表/1 视图/1 索引、users 10000 行、`id>9900`=100 行、`LIKE '%user_004%'`=100 行、logs 3 行、wide 8 列）。
  3. ✅ **启动失败不可见（已修，2026-10-07）**：新增 `waitCdpReadyWatched()`（`lib/real-env.cjs`）——**盯子进程 exit + 扫日志致命信号**（Rust panic / 编译失败 / `BeforeDevCommand 执行失败` / `npm ERR!`），宽限期 15s（给正常编译输出留余地），命中即抛错；替换原先"只盯 CDP 端口"的等待。接线面：`runWithRealApp`（debug / endpoints / multi-window / ui / probe-watch-multiwin 五套共享）+ `db-real` + `release-real` + `new-project-fastapi-real`。顺带把 `release-real` / `db-real` 的日志由 append 改 **truncate**（append 会把上一轮 panic 残留带进本轮，让看门狗误判）。
     - **实测**：db-real **5s**、endpoints-real **3s** 快速失败（原为 1500s）；三条路径单测式验证：子进程退出 2s 命中、日志 panic 15s 命中、**正常编译日志 20s 不误判**。
     - **未接线（已于 2026-10-07 补上，见下「两个 probe 已接线」）**：`probe-real-lag` / `probe-mw-lag`（自实现等待，默认 `-Skip`）。
- **本次收口结论**：真机层从"跑不起来也不知道"变成"**几十秒内明确报出为什么跑不起来**"。**剩下的是环境阻断（第 1 条）——须在用户终端跑**，不是代码问题。

#### 首轮真机基线结果（2026-10-07 16:35，用户终端 · HEAD `3ba7076`）

| 套件 | 结果 | 用时 |
|---|---|---|
| debug-real | 14/14 PASS | 81s |
| endpoints-real | 4/4 PASS | 34s |
| multi-window-real | 16/16 PASS | 46s |
| ui-real | 39/39 PASS | 23s |
| **合计** | **73/73 PASS** | ≈3 min |
| db-real | **无报告（未启动？）** | — |
| new-project-fastapi-real | **无报告（未启动？）** | — |

四套跑得又快又稳（合计 3 分钟，远低于"30~60 min"的预估——预估偏高，可修正为 **10 min 量级**）。但两个"无报告"**又暴露 3 条，均当场修掉**：

4. ✅ **db-real / new-project 从不落 JSON**（这两个自实现套件只调 `printSummary`，没有 `writeJsonSummary`）→ 跑批与 nightly 只看到「无报告（未启动？）」，**分不清"没跑"和"跑了失败"**。已按 `runWithRealApp` 的做法补齐三条路径（预检失败 / 运行中断 / 正常）都写 `OC_JSON_OUT`。
5. ✅ **运行中断被当成成功（假绿，本轮最严重的一条）**：db-real 的 `catch` 只打印「[运行中断]」，**不设失败计数** → `failed = 0` → 退出码 **0** → 跑批汇总报「失败 0 个套件」。**即首轮 SUMMARY 的"全绿"是假象**（db-real 其实中断了）。已改：中断记 `runError`，退出码非 0。
6. ✅ **5173 预检形同虚设**：`portInUse()` 用 HTTP `GET /json/version` 判占用，而 **vite 不提供该端点** → 对 5173 永远返回 false（只对 CDP 端口有效）。实测本机 vite **只绑 `[::1]`**，旧实现双重漏检。已改 **TCP 双栈探测**（`net.connect` 探 127.0.0.1 + ::1）——实测：vite 未起 false、起后 **true**（旧实现此时仍是 false）。

#### 第二轮（`-Only db-real,new-project-fastapi-real`，HEAD `32bbdce`）——两条原因都拿到，均为真缺陷

| 套件 | 报告 | 真实原因 | 处置 |
|---|---|---|---|
| db-real | 7 项后中断（32s） | **D-6 修复的回归**：T14-7 用宽选择器 `detail.locator('button')`，而 D-6（2026-10-06）给详情面板加了 × 关闭按钮 → 命中 2 个元素 → Playwright strict mode 直接抛错中断 | ✅ **已修**：选择器精确到各自按钮（`.db-cell-detail-close` / `button:not(.db-cell-detail-close)`），断言改为「按钮数=2 · 复制出 toast · × 可关闭」，并恢复现场供 T14-8 使用——**真机层补上 mock 层 `DB-D-6` 的那一钉** |
| new-project | 0 项 / 205s / FAIL | **JSON 口径错位**：脚本自带一份 `results`，而 `writeJsonSummary` 读的是 real-env 的 `results` → 报告永远 0 项，**真实用例结果被丢掉**（它其实跑完了，且有 FAIL） | ✅ **已修**：`record` / `results` / `printSummary` 统一用共享层 |

- **这两条印证了同一件事**：真机层与 mock 层是**两套独立断言**，改一处只可能被其中一层发现。D-6 加关闭按钮时 mock 层有回归钉（`e2e/db` 30/30 全绿），真机脚本没跟上——而真机层当时跑不起来，**这一漏就是 6 天**。这正是「没人跑 = 覆盖等于不存在」的活证据。
- **修正上一轮的一处误判**：new-project 并非"卡在预检"（当时无 JSON 只能猜），它**跑到了收尾**，只是结果没进报告。
#### 第三轮（HEAD `993c0b0`）——new-project ✅ 通过；db-real 暴露**本轮修复自身的选择器写错**

| 套件 | 结果 | 说明 |
|---|---|---|
| new-project-fastapi-real | ✅ **4/4 PASS**（206s） | results 口径修好，报告恢复；含联网装 fastapi 的 best-effort 检查项 |
| db-real | ❌ 7 项后中断（92s） | 上一轮修的选择器**写错了**：`detail.locator('.db-cell-detail button:not(...)')` 里 `detail` 本身已是 `.db-cell-detail` → 拼成后代选择器（要求面板内再套一层面板）→ **永远匹配不到**，30s 超时 |

- **已修**：`copyBtn` 改为 `detail.locator('button:not(.db-cell-detail-close)')`；并保留 `btnCount === 2` 断言——数量再变会**断言失败**（可读），而不是 strict 模式抛错（中断）。
- **教训（值得记）**：真机脚本**无法在本机验证选择器**（需真机 DOM），所以改选择器时要**逐字核对是否与 mock 层一致**——mock 层 `e2e/db/03-data.spec.ts` 用的正是 `.db-cell-detail-close`（作为 `detail.locator(...)` 的单类后代查询），照抄即可，不要自行拼类名。
#### 第四轮（HEAD `80d9fe8`）—— ✅ **真机层首个全绿基线**

| 套件 | 结果 | 用时 |
|---|---|---|
| **db-real** | ✅ **18/18 PASS** | 64s |
| new-project-fastapi-real | ✅ 4/4 PASS | 206s |
| debug-real · endpoints-real · multi-window-real · ui-real | ✅ 14/14 · 4/4 · 16/16 · 39/39（首轮） | ≈3 min |

- **合计 6 套 / 95 项全绿**（`probe-*` 三支默认 `-Skip`），全量约 **8 分钟**——真机层从"配置齐备但零跑通证据"变成"**有全绿基线、失败能自解释**"。
- **修复链条（四轮，同一根因族）**：① 起不来也不知道（干等 1500s）→ 加看门狗；② db-real 不可复现（脚本未入库 + `spawnSync` EBUSY）→ 内联 + 异步；③ 两个自实现套件不落 JSON + **中断被当成功（假绿）** + 5173 预检失效 → 补齐 + TCP 双栈；④ D-6 回归（宽选择器 strict 冲突）→ 精确化；⑤ 我自己的选择器嵌套写错 → 修正。
- **共同根因**：这些缺陷全部**因"真机层长期没人跑"而累积**——脚本存在 ≠ 覆盖存在。`nightly.yml` 里那 9 套编排至今**零 CI 执行**（无 GitHub 宿主），本机也从未全量跑过；本轮是它**第一次真正通电**。
- ~~**仍未接线**~~ ✅ **已接线（2026-10-07）**：`probe-real-lag` / `probe-mw-lag` 的启动看门狗 + 存活看门狗 + TCP 双栈端口探测，实测启动失败 6.7s / 5.1s 结束。

#### 收尾一：触发点绑定（C，2026-10-07，已完成）

真机层最大的问题不是"域不够"而是"**没人跑**"。现在绑到**发布前验收**这个有明确触发点的环节：

| 落点 | 内容 |
|---|---|
| `build-release.ps1 -Verify` | 打包完成后自动跑 `run-real-all.ps1 -PreRelease -Strict`（release-real + 开发链路 6 套，约 12 min），任一套失败即**非零退出**；不加 `-Verify` 时打印黄字"发布前请跑 …"，让"忘了跑"在出包输出里可见（不是靠记性） |
| `run-real-all.ps1 -PreRelease` | 把 `release-real`（验构建产物）纳入跑批并**置于首位**；默认跑批仍跳过它——开发检出常无 release 产物，跑了只会报 ENV |
| 报告 | `SUMMARY.md` 增「模式」行（日常跑批 / 发布前验收），产物落 `shell/real-reports/<stamp>/`。**口径（2026-10-07 修订）：该目录已进 `.gitignore`** —— 与 `test-results/` 同性质的**原始运行产物**（一次跑一份、含中断/失败跑），无评审价值却无限增长（一天积 13 份）；结论与证据以「写进 docs 的数字 + `bench/reports/`」为准，确需留证某次里程碑跑时 `git add -f` 单独提升 |
| 预检 | 新增 **divert 代理探测**：25378(PAC) / 18080(本地) / 8888(上游 Fiddler) 有监听即黄字告警。它走 WinDivert **驱动层**透明拦截，开着会让整套 `ERR_PROXY_CONNECTION_FAILED`，而环境变量与 `--no-proxy-server` 都躲不掉——**提前 10 秒告警胜过白跑 10 分钟** |

- **实测（本会话干跑 `-PreRelease`）**：7 套件按序跑完、模式行正确、SUMMARY 落盘（`release-real` 因本机 release 产物是 dev 味（加载 `localhost:5173`）而 FAIL，其余 6 套因会话环境起不来 tauri dev 判 ENV——**均为环境所致，非脚本缺陷**）。
- **顺带修掉跑批自身一条缺陷（本次实测暴露）**：`run-real-all.ps1` 顶部 `$ErrorActionPreference = "Stop"`，而 PS 5.1 会把 native 命令的 stderr 包成 `NativeCommandError` → **任一真机脚本往 stderr 写一行（失败/中断路径必然写）就终止整轮跑批**，表现为"跑到第 2 套件整脚本退出、不写 SUMMARY"（外层管道捕获如 `| Tee-Object` 时必现）。这与 `build-release.ps1::Invoke-Native` 是**同一个坑**（那边早有注释），已按同法加 `Invoke-RealSuite` 包装（局部降 EAP + ErrorRecord 渲染成纯文本）。**实测**：修复前在第 2 套件（db-real）退出；修复后 7 套全部跑完。

#### 收尾二：B4 HTTP 真机一刀（B，2026-10-07 已交付并真机验证 ✅）

`shell/e2e-real/http-real.cjs`（**HR-1..HR-11**）——补上 reqwest 真实链路这个**唯一真空白**：

- **设计**：脚本内起一个**本机 Node HTTP 服务**（`127.0.0.1` + 随机端口，**全程离线**），前端发真实请求、服务端**记录并回显**收到的请求 → 一条请求被**两端同时观测**。服务端记到的 **`User-Agent: OpenCharm/0.1`** 直接证明请求出自应用内核的 reqwest，而非任何 mock。
- **覆盖（mock 层全盲的部分）**：真实 TCP 连通 + JSON 树 / 真实响应头（content-type、content-length）/ POST + 自定义头 + 体的**服务端回显** / **302 真实跟随**（服务端可见 `/redirect → /json` 两次请求）/ 404 非错误态 / **真实超时**（预置 `http_timeout_ms=3000` 打 10s 慢端点）/ **取消在分块边界生效**（服务端每 400ms 吐一块；除 UI 回落 idle 外，**还断言服务端观测到连接被提前断开**——`res.on('close')` 且 `writableEnded === false`，证明"取消"是真的断流而非只改前端状态）/ 二进制判定（`application/octet-stream`）/ **响应体 >5 MB 截断** / **主机名解析**（`localhost`）/（可选）**公网 DNS+TLS**（`OC_HTTP_REAL_NET=1`，属已知边界）。
- **两条工程决定**（都写进了脚本注释）：① 截断用例用**二进制**体（`ct=bin`）——前端对文本体是直接塞进 `<pre>` 的且**无渲染上限**，5 MB 文本会卡住 WebView 拖垮后续用例；二进制分支不渲染体，验的是同一条后端 `stopped_early` 路径。② 每次发送先**等服务端真的收到本次请求**（按 pathname 比对）再等 UI 落定——真机没有 mock 那种 `__E2E_HTTP_LAST_REQ__` 直读通道，只盯 UI 会读到上一条响应的旧状态（连续两次 200 必然误判）。
- **口径**：默认 10 条 + 1 条可选；已加入 `run-real-all.ps1` 默认清单与 `nightly.yml` 脚本清单（**两处必须同步**，脚本头注释已写明）。
- **本机已验的部分**：脚本内那个 Node 服务被**单独抽出跑过一轮端点自测**（10/10 PASS：`/json` `/echo` `/redirect` `/missing` `/bytes` `/big`(两种 ct) `/slow`(确认真的慢) `/stream`(断流计数) + 服务端观测），故服务端半边的行为是确定的；**未验的是 UI 半边**（需真机 DOM）。
- **首轮真机跑（2026-10-07 17:51，HEAD `0fa00c3`）：应用起来了（23s，CDP 已连），但 `#devtools-picker` 一直 hidden**——`Ctrl+Shift+T` **按得太早**。根因在代码里可定位：全局键位路由要到 `main.ts:1745 wireWindowKeys()` 才装（init 中段），而 mock 层靠等 `__TAURI_MOCK_INVOKE_LOG__` 的 `list_plugin_dirs` 判 init 完成——**真机没有这个钩子**，脚本在键位接线前就按键，事件没人接。**已修（commit `23c7b53`）**：① 就绪判据改用 DOM 信号 `#tree .tree-item`——行号依据 `initDevTools(1569) < wireWindowKeys(1745) < openInitialWorkspace(2109)`，文件树出现即同时保证"内置工具已注册 + 键位已接线"；② 保留最多 10 次重试兜底（不把脚本钉死在内部时序上）；③ 新增 `dismissFirstRunModals`——`maybePromptToolchain()` 是 `await openConfirm`，工具链缺失时会卡在 `openInitialWorkspace` 之前（树永不出现），该函数**只点「稍后/取消」这类非破坏性按钮**，刻意避开「立即安装」（真机上会真的开始装 uv/pyrefly）。
- **这条值得归档为真机脚本的一条通用纪律**：**真机层没有 mock 的 `__TAURI_MOCK_INVOKE_LOG__` 等就绪钩子，凡是"等 init 完成"的地方都必须换成一个**可观测的 DOM 信号 + 重试**，不能靠固定 sleep 或直接按键**。选信号时先看 main.ts 里的行号先后关系（信号必须晚于你要用的那套接线）。
- **新增第 6 条：应用存活看门狗（2026-10-07，commit `8f0683e`）**。跑 `release-real` 时**挂死 8 分 39 秒、不写任何报告**。独立探针定位到可复现现象：release exe 在本会话里 t=2s 起进程、t=4~22s **CDP 9223 监听**、t=24s 起 **CDP 消失而外壳进程仍活着**、应用日志永远停在 `window_geom` 一行、前端从未加载（`about:blank`）。此时 Playwright 的 `page.evaluate` **没有超时参数** → 永久挂住。**挂死比失败更糟**（人看不出发生了什么，报告也不落盘）。已加 `startAppWatchdog()`：CDP 就绪后每 3s 检查「子进程已退出」+「CDP 端口连续 2 次探不到」（只看子进程不够——`tauri dev` 的 child 是 cmd，应用死了它不死），命中即 record + 落盘 + `exit(1)`。**自测：8m39s 挂死 → 36s 明确中止**（报告 `shell/real-reports/20261007-185932/`）。
- **⚠ 更正一条既有判断**：此前记的「`release-real` 不经 vite dev，可在会话里跑」**不成立**——它能起，但 WebView 约 20s 后必死，**会话里同样跑不出结论**。⇒ **真机全量（含 `-PreRelease`）只能在用户自己的终端跑**，这一条对 release-real 与开发链路 6 套**同样适用**。
- ⏳ **合并 7 套基线已产出（见下条 ✅）**：`powershell -File shell\e2e-real\run-real-all.ps1 -PreRelease -Strict`。
- **新增第 7 条：套件输出不能经过 PowerShell 格式化器（2026-10-07 用户终端两次实测，根因已定位）**。第一次崩在 `Write-Host : 索引超出了数组界限`（PS 点名 `run-real-all.ps1:112 + } | Write-Host`）；**去掉 Write-Host 后第二次崩在 `out-lineoutput : 索引超出了数组界限`（默认输出格式化器）**——两次同一行（db-real T14-9 那条「长行 + 全角字符」的 detail），证明根因不是某个 cmdlet，而是**「子进程输出经过 PowerShell」这件事本身**：格式化器对每行做折行/显示宽度计算时越界，且是**终止性异常**（局部 `EAP=Continue` 拦不住），整轮跑批当场退出、不写 SUMMARY。**修法**：`Invoke-RealSuite` 改用 `ProcessStartInfo` + `RedirectStandard*=false`，子进程**继承控制台句柄**，PowerShell 完全不碰输出——三重收益：没有格式化折行、**没有 stderr→ErrorRecord 包装（前面那条「原生 stderr 终止整轮」的坑一并消失）**、仍是实时流式。代价：输出不再经过 PS 管道，外层 `Tee` 抓不到。
- **新增第 8 条（同一批）：中文全乱码——最终结论是「不需要切代码页」**。乱码根因是「node 输出**经过 PowerShell**」：PS 用 `[Console]::OutputEncoding`（本机 936）去解码 node 的 UTF-8 字节 → 全变 `鏁版嵁`。**`Invoke-RealSuite` 改成继承控制台句柄后，node 的 stdout 是真 TTY，libuv 在 Windows 对 TTY 走 `WriteConsoleW`（宽字符 API），与代码页无关地正确显示** —— 乱码在"绕开 PS"这一步就已根治。中途曾叠加 `chcp 65001` + `Console.OutputEncoding=UTF8`，结果让 **PS 自身**的表头/汇总行在真实终端出现 CJK 双写（`汇汇总总`、`（（39 项项`，ASCII 不受影响）→ **已全部移除**，`run-real-all.ps1` 不再动控制台代码页。**已知副作用（可接受）**：把整轮输出重定向到文件时，node 侧（非 TTY → UTF-8 字节）与 PS 侧（936 字节）会写进同一文件两种编码；结论以始终 UTF-8 的 `SUMMARY.md` 为准。
- **两个 probe 已接线（2026-10-07，② 收尾）**：`probe-real-lag` / `probe-mw-lag` 原先自实现了一套等待，缺两个关键保护——现在改用共享基建 `waitCdpReadyWatched`（启动挂了不再干等 300s / 600s）+ `startAppWatchdog`（应用中途死亡即中止落盘），并把它们 HTTP 版 `portInUse`（判 5173 无效）换成 TCP 双栈。**实测**：两脚本启动失败分别在 **6.7s / 5.1s** 结束（原 300s / 600s）。至此真机层 11 个脚本**全部**接上两个看门狗，**「仍未接线」项清空**。
- **⚠ 新增第 9 条：门禁会验错对象（假信心，比崩溃更危险）**。`release-real` 的 `resolveExe()` **优先取注册表安装位**，而本机 `D:\OpenCharm\` 里躺着一个 **10-04 08:14** 的旧安装（21.5 MB），用户 **18:29** 刚构建的产物（`target/release`，25.8 MB）**根本没被验到**——那两次「7/7 PASS」是**旧包的成绩**，且报告里完全看不出来（JSON 当时连 `exe` 字段都不落盘）。已修三处：① **`-PreRelease` 显式把 `OC_RELEASE_EXE` 指向构建产物**（发布前验收的语义是"我刚构建出来的包能不能干活"，不是"机器上某个旧安装能不能干活"）；② **JSON 落 `exe` / `exeMtime`**（"验的是哪个产物"必须可查）；③ 解析到的 exe 若不是构建产物且更旧 → 启动即黄字告警 + 写进 REL-1 detail。
- **看门狗补进程树回收**：看门狗走 `process.exit(1)` 会跳过正常清理 → 残留应用占住 5173/9223，**下一轮跑批直接卡在端口预检**（本轮实测踩到）。已在 `fire()` 里先尽力 `taskkill /T /F`。
- **✅ 第二轮真机跑（2026-10-07 18:06，HEAD `3552012`）：`http-real` 10/10 PASS（36s）**——就绪判据修复生效。关键证据全部来自**服务端观测**（不是 UI 自说自话）：HR-1 `ua=OpenCharm/0.1`（请求确实出自应用内核的 reqwest）、HR-3 服务端收到 `method=POST / token=t-123 / body={"a":1}`、HR-4 服务端路径序列 `["/redirect","/json"]`（真实 302 跟随）、HR-6 `HttpTimeout:请求超时（3000ms 内未完成）`（真实 reqwest 超时）、**HR-7 服务端断流 = true**（取消是真的断开连接，不是只改前端状态）、HR-9 `5.0 MB` 截断、HR-10 `localhost` 真实解析。报告入库 `shell/real-reports/20261007-180638/`。
- **✅ 合并全量基线已出（2026-10-07 20:08，用户终端，HEAD `57e3404`）：7 套 / 112 项全绿、0 失败，约 7 分钟**。`release-real 7 · db-real 18 · debug-real 14 · endpoints-real 4 · http-real 10 · multi-window-real 16 · new-project 4 · ui-real 39`。报告入库 `shell/real-reports/20261007-195901/`。**这次 `release-real` 验的是新构建产物**（JSON 的 `exe` 字段 = `...\target\release\opencharm-shell.exe`，`exeMtime` = 2026-10-07T11:36:38Z = 19:36 本地，即用户在本轮修复后重新构建的那一份）——**这是 `-PreRelease` 指向构建产物这条修正的实证**。此前「95 + 10 = 105 只是算术和、不得当实测引用」的口径到此作废，**112 是实测值**。
- **口径说明**：`http-real` 是**单独跑**（`-Only http-real`）通过的；`6 套 / 95 项` 全绿是此前**全量跑批**的实测结果。

### P1-5 · 偿还 TD-021 五小项

5 个 P4 项，其中 **① 终端背压 UTF-8 口径**（CJK 下阈值放宽 3 倍）与 **③ tab 快照保头弃尾**（丢最近打开的 tab）在中文 Windows 自用场景下有实际体感，建议优先。其余三项按"顺手"原则处理。
成本：合计约 1~2 人日。
> 状态：**P1-5 已收口（2026-10-07）**：①③④⑤ ✅ 已修（见落地续记 ㉑ / ㉒）；**② 裁决不处理**（session.ts `restoring` 布尔非令牌，场景罕见，维持 tech-debt 登记备查）。

### P1-6 · 插件 v2 议题启动（择一）

`plugin_system_design.md` §10 列出 5 个全局待决策点 + 9 个切片决策。v2 议题里**性价比最高的是"工作区级插件目录"**（加载器只是多一个扫描根，非破坏性扩展，且能让插件随仓共享）。硬沙箱（iframe/Worker）与 Python 工具桥成本高、~~收益对自用场景有限~~**（原"自用"论据已废止，改判为：二者都会显著增加常驻开销与产物体积，与 ADR-0010「默认轻量 / 体积是卖点」直接冲突——这是比原论据更硬的否决理由）**，建议继续延后。登记为 TD-025 第 5 条待复审。
成本：工作区级目录约 1 人日。

---

### P2-1 · UI 视觉「批 6+」第二阶段（可选，非必需）

v1.0 的 P0-3（视觉改造）在 `964ea7e` 已**全部交付**（六批 + ADR-0005 + 真机 32/32）；v1.2 后另有两处主题修复（修记 A 滚动条变红 / 修记 B 行号色死映射）。本项仅登记后续可能方向，**不排期**：材质细节再深化、`opencharm-dark/light` 语法色与外壳的进一步同色、字体副档（如无衬线 UI 字体随包，v1.0 已裁决不做）。若开，须沿用 `ui_premium_dev_plan.md` §6 的批次入口 + §4 门禁（`audit_tokens.py` **现已进 CI** + token 单测 + e2e computed-style 断言 + 截图比对），且**不得往 `main.ts`（现在 2,099 行，预算 2,400、余量 301 行）堆逻辑**——**更不得往 `style.css` 堆**，它已在 5,750 / 5,850（P0-0 拆分后回到绿灯），但拆出的 `styles/http.css`（102/125）与 `styles/logView.css`（170/205）各有上限，静默增长在新文件里同样会被拦。

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
| ~~A1~~ ✅ | **运行时热点视图**（**已交付 2026-10-06**，见 §续记 ⑫） | 侧栏新视图：按 `hits` 降序列出真实跑过的函数（带 stale「已改动」/ 异常观测徽章），下方列出「**未观测到运行**」的函数；点击任一行跳转声明 | 中（2~3d）→ **实际 ~1d** | ✅ 已落地：`intel_cmds.rs` 读 probe trace 库 + `fs_cmds::collect_files` 扫 `def` 做差集 | ① 口径**已裁决并落进文案**：一律写「未观测到运行」且显式否认"死代码"（可能原因含未被测试/入口覆盖、分支未走到、采样遗漏、进程外调用）；② 与 `inlineValues.ts` 的**通道重叠已规避**——本视图走独立命令 `scan_runtime_hotspots`，不碰 intel 补全通道 |
| A2 | **轻量内置 Profiler** | probe 已挂 `sys.monitoring`，扩展采集调用耗时 → IDE 内函数级耗时视图 + Top-N 慢函数 + 点击跳转。对标 cProfile + snakeviz，但**零用户操作** | 中-大（5~8d） | PEP 669 事件扩展；开销预算需重新定（现红线 1.5x 是类型采样口径） | 开销上升；需新增"性能模式"开关，默认关 |
| ~~A3~~ ✅ | **trace 驱动的签名补全与默认值提示**（**①调用处参数名补全 + ②hover 观测签名已交付 2026-10-06**，见 §续记 ⑭；**③签名弹窗已交付 2026-10-06**，见 §续记 ⑯） | `arg_types` 已按参数位累加观测 → 调用处补全参数名（insertText `name=`，带观测类型 ×证据数）、hover 增「签名（观测）」+ 每条参数的**常见键 / 常见属性**、`(` / `,` 触发的**签名弹窗**（观测签名 + 当前参数位高亮） | 小-中（2d）→ **实际 ~1.5d**（①+② ~1d · ③ ~0.5d） | ✅ 已落地：intel `completion.rs` 第四条补全分支（前向扫描取最内层未闭合 `(` + 回溯 callee）+ `hover.rs` 观测签名/常见键 + `signature.rs` 签名帮助（**复用同一份 `call_frame_at` / `param_observations`**）；`arg_types` 由 A1 那条 trace 通道供数 | ① 与静态补全排序竞争**已按预案解决**（沿用 `1xx` 段钉序，`CandidateKind::Param` → LSP `VARIABLE`）；② **原描述的"常见值"已收紧为"常见键 / 常见属性"**——probe 绝不 repr 值本身，trace 里没有字面取值，文案不得暗示有（A3③ 的签名同样**不含默认值**，说明文本已显式声明）；③ 签名弹窗**已交付**——与 A3① 共用上下文解析，故「弹窗高亮的参数位 == 补全首推的候选」；④ 调用处 inlay hint **不做，已降级登记** |
| ~~A4~~ ✅ | **爬虫场景工具箱**（画像强绑定）（**①选择器测试器 + ③响应→模型桥已交付 2026-10-06**，见 §续记 ⑮） | 选择器测试面板（输入 HTML + CSS/XPath → 实时命中 + 结构预览）、请求回放、响应结构 → Pydantic model 生成 | 中（3~5d）→ **实际 ~1d** | ✅ 已落地：新 devtools 内置工具「选择器测试」（`selectorCore.ts` 零 app 依赖求值层 + `selector.ts` 面板）+ HTTP 响应工具栏两座桥 | ① **求值引擎裁决为「前端浏览器 DOM」**（`DOMParser` + `querySelectorAll` / `document.evaluate`），**不走 `libEval` 求值桥**——求值桥纪律管的是 Python 求值，这里没有 Python 参与；换来实时命中 / 零依赖 / 无解释器可用，代价是与 lxml / bs4 的口径差异，已**常驻一行口径说明**并由 e2e SEL-9 钉住不得删（Python 侧引擎降级登记）；② ③ 的**本体早已交付**（`json2model.gen.ts`，P1 库支持批次），本轮只补桥；③ ②「请求回放」**不做**——B4 历史区（最近 20 条点击回填）已是回放，独立面板属重复建设，已降级登记 |
| ~~A5~~ ✅ | **FastAPI 路由面板增强**（**①请求样例 + ②一键 curl 已交付 2026-10-06**，见 §续记 ⑬） | 已有 `endpointView.ts`；本轮交付：解析 handler 签名 + Pydantic 模型 → 参数表 / 请求体 JSON / cURL（复制 + 送进 B4 HTTP 工具） | 中（3d）→ **实际 ~1d** | ✅ 已落地：新命令 `scan_endpoint_sample`（`ep_sample_cmds.rs`）复用 `fs_cmds::pyd_collect_models`，不另造解析器 | ① **静态解析 vs 运行时导入已裁决为静态**——离线可用、不要求服务在跑、不装依赖；代价是 Flask 的 query / body 推不出来（已在 UI 与文案里**明说**而非假装能推）；② ③ handler→route 反向跳转（需 `codeVision.ts` 编辑器侧基建）与 ④ OpenAPI 面板内预览（需服务在跑）**本轮不做，留待下轮** |
| A6 | **trace 驱动的 lint** | 用运行时观测反哺静态诊断：形参从未收到某类型却按该类型使用、函数从未被调用、`exc_types` 显示有异常路径却无 try | 中-大（5d） | 诊断合并管线 | 与四桶诊断的冲突消解规则；误报控制是成败关键 |

### B 类 · 补齐 IDE 基本功

| # | 功能 | 说明 | 成本 | 备注 |
|---|---|---|---|---|
| B1 | **pytest 集成** ⚠️ **与现行裁决冲突，需先动裁决** | `pytest -q` / `--json` 结果解析 → 树形结果面板 + 失败点击跳转 + 重跑单测 | 中（3~4d） | **现行裁决不止 README**：`python_ide_dev_plan_v2.md:18`「明确不做 pytest 面板」· `pycharm_ux_review_and_proposal.md:393` F-1 **已于 2026-09-25 裁决「维持非目标」** · `python_library_support_research.md:325`「不复议」。**按文档约定铁律，动它必须先修订 `dev_plan_v2` §1.1**，本条不能按"候选"直接进阶段二。若裁决变更，建议边界照 `python_library_support_research.md` §8 划法：**不做测试发现/结果树**，只做"运行当前测试文件 → 摘要 + 失败行跳转"最小闭环 |
| B2 | **REPL / Scratch 执行** | 选中代码 → 发送到长驻 Python 进程执行（复用 `libEval` 求值桥 + 终端 PTY）；或轻量 cell 模式 | 小-中（2d） | 对"小脚本"画像高频；**本体走 `libEval` 求值桥**（A4 已明确**不走**该桥——它是前端 DOM 求值，勿引为先例） |
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
| ~~P0-2 Gate D + trace 调参~~ ❌ **第一格已撤下 / 第二格已收口（2026-10-07，见续记 ㉔）** | ★★★★★ | 中（载体与工具已就绪） | 第二格 ✅ 已采并收口（3 真实项目 / 497 条函数观测，未达 ≥1000 门槛 → 改日常累积）；**第一格 ❌ 已按 v1.4 死线撤下**（本机无 PyCharm） | ✅ **已关闭**：README 已知边界定稿声明 `未与 PyCharm 做过横向对比`；`intel/README.md` 三处 ⏳ 关闭；工作单转存档（换对照组时须改写为"对 X"） |
| ~~P0-4 `env_cmds.rs` 二选一裁决~~ | ★★★★ | ~~中~~ 0.1d（本轮） | — | ✅ **已裁决（折中：冻结线 + 上限改长期 + 拆分降级为阶段二候选）**；`main.ts` 外提仍是硬需求（余量 81 行） |
| 　P0-1 子项 7 CI 落点裁决 | ★★★★★ | 0（本轮只做标注） | — | ✅ **已裁决（维持现状）**：`.github/workflows/` 定位为"将来推 GitHub 的预埋"，P0-1 余项转为"迁移后首次触发验证" |
| **`main.ts` 外提（阶段二）** | ★★★★ | 1d | — | ✅ **两刀已完成**：2,919 → **2,099**（两刀 −825 行，A1 接线 +5）；第一刀 `debugEntry.ts` / `menuItems.ts`，第二刀 `init()` 阶段化 `windowKeys.ts` / `windowChrome.ts` / `sidebarViews.ts`；阈值 3,000 → 2,600 → **2,400** |
| ~~P0-3 验收尾账 + onboarding 双源裁定~~ | ★★★★ | 中小 | — | ✅ **已交付**（**D-6 / D-7 / D-8 三个缺陷已全部修完**，2026-10-06） |
| ~~A1 运行时热点视图~~ ✅ **已交付（2026-10-06）** | ★★★★ | ~~中~~ **1d** | — | ✅ **已交付**（`intel_cmds.rs` + `hotspotsView.ts`；e2e ux 8 例 / 单测 8 例钉住） |
| ~~A5 FastAPI 面板增强~~ ✅ **①+② 已交付（2026-10-06）** | ★★★ | ~~中~~ **1d** | — | ✅ **已交付**（`ep_sample_cmds.rs` + `epSample{Core,}.ts`；e2e ux 5 例 / 单测 17 例钉住）。③④ 留待下轮 |
| ~~A3 trace 驱动签名提示~~ ✅ **①+②+③ 已交付（2026-10-06）** | ★★★ | ~~小~~ **1.5d** | — | ✅ **已交付**（`completion.rs` 第四条补全分支 + `hover.rs` 观测签名/常见键 + `signature.rs` 签名弹窗；intel 单测 26 例 + 索引顺序 1 例钉住）。④ 调用处 inlay hint 已关闭不立项（2026-10-07，pyrefly `callArgumentNames` 覆盖） |
| ~~A3③ intel 签名弹窗（`textDocument/signatureHelp`）~~ ✅ **已交付（2026-10-06）** | ★★ | ~~小~~ **0.5d** | — | ✅ **已交付**（新 `signature.rs` + server 能力/处理器 + shell provider 改「intel 优先、回落 static」；intel 单测 12 例钉住）。**与 A3① 共用 `call_frame_at` / `param_observations`**，故参数位与补全首推必然一致 |
| ~~A3④ 调用处参数名 inlay hint~~ ✅ **已关闭不立项（2026-10-07）** | ★ | 小 | intel inlay 通道 | ✅ **已覆盖**：pyrefly 官方 `callArgumentNames` + shell PR-N 已接通（`lsp/client.ts` `pushInlayHintSettings` 映射 `inlay_param_hints` + `registerLspInlayHints` 双源 provider），无需 intel 自研 |
| P1-1 可观测性三件套 | ★★★ | 中 | — | ★★★ |
| B2 REPL / Scratch | ★★★ | 小 | 求值桥 | ★★★ |
| P1-2 自动更新 | ★★★ | 小 | — | ★★★ |
| ~~A4 爬虫工具箱~~ ✅ **①+③ 已交付（2026-10-06）** | ★★★★（画像匹配） | ~~中~~ **1d** | — | ✅ **已交付**（新 devtools 工具「选择器测试」+ HTTP 响应两座桥；前端单测 31 例 + e2e 10 例钉住） |
| ~~A4② 请求回放（独立面板）~~ ✅ **已关闭不立项（2026-10-07）** | ★ | 小 | — | ✅ **已覆盖**：B4 HTTP 工具历史区（最近 20 条点击回填）已是回放，独立面板重复建设（原裁决维持） |
| ~~A4-Py 选择器 Python 引擎（lxml / bs4 口径校验）~~ ✅ **已关闭不立项（2026-10-07）** | ★★ | 小-中 | 求值桥 + 第三方包探测 | ✅ **已裁决**：求值引擎定为前端浏览器 DOM（DOMParser + querySelectorAll / document.evaluate），Python 侧降级登记（原裁决维持） |
| A5③④ FastAPI 面板余项（反向跳转 / OpenAPI 预览） | ★★ | 中 | codeVision / 服务在跑 | ★★ |
| P1-5 TD-021 五小项 | ★★ | 小 | — | ✅ **已收口**（①③④⑤ 已修，② 裁决不处理，2026-10-07） |
| A2 内置 Profiler | ★★★★ | 大 | 开销预算重定 | ★★（排后） |
| C 类 AI 三项 | ★★（**与 §1.1 冲突**） | 小-中 | 修订定位裁决 | ★（待裁决） |
| B1 pytest 集成 | ★★★（**与 §1.1 冲突**） | 中 | 修订 F-1 裁决 | ★（待裁决） |
| A6 trace 驱动 lint | ★★★ | 大 | 误报控制 | ★（排后） |
| P2-1 UI 批 6+ 第二阶段 | ★★（可选） | 中 | 视觉六批已交付为前提 | ★（不排期） |
| D 类生态长线 | — | 大 | — | 不排期 |
| ~~P0-1 CI 主干触发 + nightly + bench 入 CI~~ | ★★★★★ | 极小 / 中 | — | ⏳ **配置已交付（含预算门禁入主门禁），但宿主错配 → 零跑通证据**（见 P0-1 子项 7） |
| ~~P1-3 体积/性能预算断言~~ | ★★★ | 极小 | 搭 P0-1 | ✅ **已交付**；**当前三十一项全 PASS**（`style.css` 5,751/5,850）；**已并入 `ci.yml` test job** |
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
| 4 | ~~**P0-2 第一格**：在 PyCharm 里按 `gate-d-ab-worklist.md` 勾 23 点 → 产出 `gate-d-ab.md`~~ | ~~1 小时~~（**⛔ 外部阻塞：本机已无 PyCharm** → **❌ 2026-10-07 按死线撤下**，见续记 ㉔） | ~~工作单 PyCharm 列填满~~ → **替代关闭条件已达成**：`intel/README.md:47` 状态改为 ❌（撤下）+ README 已知边界出现定稿声明"未与 PyCharm 做过横向对比" + 工作单加撤下头注 |
| — | ✅ **附带已完成**：`budget-check.mjs` 加 dist 新鲜度校验（STALE 判定），消除产物体积的假警报 | ✅ 已完成 | 陈旧 dist 报 STALE 而非虚高数字 |
| — | ✅ **附带已完成**：**P0-2 第二格**——真实项目 trace 采集跑通（`metawake/backend`：277 条 / 覆盖率 79% / 606 B 每条） | ✅ 已完成（约 0.3 人日） | `bench/reports/trace-stats.md` 换成真实项目样本；保留窗口建议 8,192 → 13,836 条；`STALE_HITS_DIVISOR` 维持 2（样本未达 1000） |
| — | ⏳ **附带待办**：再采 1~2 个真实项目，把跨项目样本累计到 **≥1000 条**后复核降权参数 | ~0.3 人日/项目 | 累计 ≥1000 条；在此之前降权系数只作"建议值" |

**阶段门**：~~`budget-check.mjs` 十项全绿~~ ✅（**当前三十一项全绿，且已并入 `ci.yml` 主门禁**）· ~~`bench/reports/metrics-*.md` 存在~~ ✅ · ~~D-7 已修并复核~~ ✅（D-6 / D-8 亦已修）· ~~CI 落点裁决~~ ✅ **已裁决（维持现状 + 文档标注）** · ~~P0-2 第一格~~ ❌ **已按 v1.4 死线撤下（2026-10-07，见续记 ㉔；本机无 PyCharm）** · ~~P0-2 第二格~~ ✅ 真实项目样本已取得并收口（3 项目 / **497 条函数观测** / 门槛口径见 `trace-sample-threshold.md`）。
**§0 缺口 0 已关闭；缺口 1 降级为"待外部事件"（推 GitHub 时验）；缺口 2 从"零数据"变为"有真实样本但样本量不足 + 第一格外部阻塞"。**
**✅ 阶段一判定（2026-10-07 更新）：4 件小事全部关闭**——3 件做完、第 2 件（第二格）附带完成并收口、**第 4 件（第一格）按二选一截止规则撤下**（不是"没人做"，也不是"还在等"，而是规则执行完毕）。→ 阶段一**完全收口**，阶段二可开工（实际已收口，见 ⑳终）。**校验意义**：这份清单里从此没有"永远挂着"的项——这正是 §P0-4 那条二选一截止规则要的效果。
**⚠ 进入阶段二前必须先记住的一条口径（2026-10-07 更新为永久纪律：横向对标已撤下，不再是"暂时"）**：**对外叙事里"比 PyCharm 更准"是不可写的**（`CONTENT-SERIES.md:192`），可写的只有"在我们的样例集上 23/23"这类**自证**口径。

### 阶段二 · 深化期（约 6~10 周，2 条泳道）

| 泳道 | 内容 |
|---|---|
| 差异化 | ~~A1 运行时热点~~ ✅ **已交付（2026-10-06）**（前置 P0-2 第二格 trace 采样已具备：metawake 277 条 / 覆盖率 79%）+ ~~A5① 端点请求样例 + 一键 curl~~ ✅ **已交付（2026-10-06）** + ~~A3①+② 调用实参补全 + hover 观测签名~~ ✅ **已交付（2026-10-06）** + ~~A4①+③ 选择器测试器 + 响应→模型桥~~ ✅ **已交付（2026-10-06）** + ~~A3③ intel 签名帮助~~ ✅ **已交付（2026-10-06）** + ~~A2 内置 Profiler~~ ✅ **已交付 + 已收口（2026-10-07，`profiler_acceptance_record.md`）** → **本泳道整体收口**：A3④ 调用处 inlay hint 已关闭不立项（pyrefly `callArgumentNames` + PR-N 覆盖）、A4② 请求回放已关闭不立项（B4 历史区覆盖）、A4-Py Python 引擎已关闭不立项（前端 DOM 裁决维持）——**全部见 ⑳终（2026-10-07）** |
| 基本功 | ~~D-6 / D-8 两个残留缺陷~~ ✅ 已修 · ✅ **`main.ts` 外提两刀已完成（2,919 → **2,099**，两刀 −825、A1 接线 +5；阈值 3,000 → 2,600 → **2,400**）** · **第三刀候选：`init()` 余下的启动编排（Monaco 装配段 / 各域事件接线段）继续外提** · `env_cmds.rs` 真拆（−49%，**阶段二候选、不设死线**；本轮的冻结线已在生效，行数不再增长即可） |

**阶段门**：~~热点视图对"死代码"的误报率可接受~~ ✅ **已由口径消除**——视图不产出"死代码"断言，只陈述「未观测到运行」并列明可能原因（未覆盖 / 分支未走 / 采样遗漏 / 进程外调用），**因此不存在"误报"这一口径**；~~`env_cmds.rs` 状态**明确**~~ ✅ 已明确（**长期上限 + 冻结线**，见 P0-4 裁决）；✅ `delivery-overview.md` 已补录 B4 / B5 / A1 / A5① / A3 并升 **v1.4**；✅ 用例基线已刷新为 **1240**；✅ **`main.ts` 外提两刀已完成（−825 行，阈值降到 2,400）**；✅ **差异化泳道三件已落地（A1 · A5① · A3①+②）**。**本阶段的结构性必办已清空**——`init()` 仍可继续外提（第三刀候选），但余量（301 行）已回到健康区间，不再紧急。

### 阶段三 · 画像期（约 10~18 周，2 条泳道）

> **v1.3 重排**：候选池里的 **B4 / B5 已在阶段一之前被提前交付**，B6 已终止。B 类只剩 B2（REPL）与仍与裁决冲突的 B1（pytest）。因此本阶段的一条泳道改由 A 类画像专项独占，另一条给工程侧。

| 泳道 | 内容 |
|---|---|
| 画像专项 | ~~A4 爬虫工具箱~~ ✅ **①+③ 已交付（2026-10-06）**（B4 HTTP 工具 + A5① 请求样例 + `json2model.gen.ts` 三件现成基建都复用了；真正的新件只有选择器测试器）。**A2 内置 Profiler 已交付并收口**（2026-10-07，`profiler_acceptance_record.md`）；余项（A3④ 调用处 inlay hint / A4② 请求回放 / A4-Py Python 引擎）已全部关闭不立项（2026-10-07 收口，见 ⑳终） |
| 可选 / 债务 | B2 REPL / Scratch + **P1-4 已收尾（触发点已绑 `build-release.ps1 -Verify` + B4 HTTP 真机一刀 `http-real.cjs` HR-1..HR-11 已真机 10/10 PASS）** + P1-6 工作区级插件目录 |

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
| 预算先行（`ci/budgets.toml`） | ✅ **三十一项全 PASS**（style.css 5,751/5,850，B4/B5/A1/A5①/A4 各自拆文件并设上限，A3 首次纳入 intel crate 两个文件、A4 首次纳入 `http.ts`） | 已关闭（2026-10-06）；⚠ 产物体积项依赖 dist 新鲜度，STALE 判定已加 |
| ~~运行时开销红线~~ ⚠（probe < 1.5x，~~当前 1.35x~~ → **2026-10-06 追查结论：单一倍率不可比，实测跨形状 1.17x~2.48x**） | **实测证据**：官方 harness 连跑两次 1.53x FAIL / 1.44x PASS（±0.1x）；`bench/profiler-overhead/overhead_lab.py` 四形状矩阵 S1 1.58x / S2 1.63x / S3 1.17x / S4(取消静音) 2.48x；`git log` 确认自 `b38cfee` 后 probe 采集路径零改动 → **非回归**。归因：静音节流藏起近 1x、全局 PY_START 常驻 ≈0.39x、类型观测 ≈0.26x | **不再是「保持即可」**：ADR-0010 性能条款里唯一可能破线的一条（详见头注 ⑰⑱ 与 **`bench/reports/probe-overhead-caliber.md`**）。待裁决：改成多形状矩阵口径 / 只锁 S2 / 启动 baseline 优化 / 显式 PR 抬阈值。**在此之前，任何落在默认采集路径上的新增开销都不可接受** |
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

- ⏳ **probe/intel 的实际运行数据**——`tools/intel/trace_stats.py` 已落地。首个样本（2026-10-03，合成/单文件）56 函数 / 177 观测；**2026-10-06 第二轮取得真实项目样本**：`metawake/backend` 跑其 13 条测试 → **277 函数观测 / 176 参数类型 / 277 返回类型 / 7 异常 / 164 KB**，**覆盖率 79%（277/350 def）**，hits 均值 4.3 / p50 2 / p99 56 / max 60，**606 B/条**（据此把保留窗口建议从 8,192 改为 13,836 条）。**⚠ 仍 ⏳ 的理由变了**：不再是"没有真实数据"，而是"**真实数据已有但样本量不足**"——277 条距 ≥1000 差 3.6 倍，且单项目已近饱和，须**跨 ≥2~3 个真实项目累计**。`STALE_HITS_DIVISOR` 仍为 2；~~`intel/README.md` 三处状态戳仍 ⏳~~ ✅ **2026-10-07 已全部关闭**（第一格 ❌ 按死线撤下 / 第二格 ✅ 已采并收口，见续记 ㉔）。**降权系数是"有两个真实/合成样本支撑的建议值"，不是"已定"。**
　**✅ 2026-10-07 已跨 3 个真实项目累计（`bench/reports/trace-stats-cumulative.md`）：3 库 / 7 次运行 / 497 函数观测 / 360 KB，742 B 每条，hits 均值 6.9 / p50 2 / p90 14 / p99 121 / max 200，stale 仍 0.0%。** 新增两个项目：`pylume/probe`（跑其 81 条 pytest → **187 函数 / 500 类型观测**）与 `cb_watcher/backend`（跑 `cb check` + `stats` + `calc-clause` 三条离线命令 → 33 函数）。**⚠ 由此带出两个新发现**：① **hits max 恒为 200——被 `max_calls_per_func` 静音截断**，即热点榜与 Profiler 的 Top-N **到 200 就分不出高下**（与 Gate C 归因里的"静音节流"是同一根因的第二后果）；② **stale 在 3 个项目 / 7 次运行里仍是 0%**，因为采样期间从未编辑过文件——降权参数的真实证据仍只有 2026-10-03 那次合成实验（30%）。**✅ 门槛口径已定死并收口（2026-10-07，`bench/reports/trace-sample-threshold.md`）**：「≥1000 条」= **函数观测**（与 `trace_stats` 的每条字节、降权系数、stale 判定同为函数级口径；类型观测按 (fid, 参数位, 类型标签) 去重且受 `max_type_obs_per_site` 饱和上限约束，用它计数会把"一个函数反复调用"误算成样本充分）。→ **函数观测 497/1000 = 49.7%，未达**；**项目数 3 个已达标**。处置：**不再为凑数专门采样**（本机采样源已确认触顶：`D:\PycharmProjects` 8 个项目无一可用——可离线的 3 个 venv 全指向已删除的 `D:\Python38`（3.8），其余全为联网爬虫类），改为**日常 IDE 使用自然累积**（`run_env.rs` 自动注入）。⚠ 由此另立一项议题：**hits 上限恒为 200**（静音同时停掉 hits），热点榜与 Profiler Top-N 到 200 就分不出高下。
- ✅ **已补**（2026-10-03）：`shell/e2e-real/` 真机状态——`db-real.cjs` **按 v1.4 契约整体重写并实测 18/18 PASS**（旧 S10.x 侧栏态用例引用的 id 已被 v1.4 重设计整体移除，旧脚本在 v1.4 下根本跑不过，这是"真机待办"长期挂起的隐藏副作用）；`debug-real.cjs` **扩到 12/12 PASS**（新增 R-REAL-9/10 三态互斥、R-REAL-11/12 改键生效）。详见 `sqlite_tool_dev_plan.md` §17.8 与 `debug_acceptance_record.md` §五。
- ✅ **已补**（2026-10-03）：**真安装包验收（调试 §五 第 8 项）** —— 阻塞已解决（VS Build Tools 2022 + `tools/msvc-env.ps1` 进程级环境装配），打出安装包 8.63 MB 并安装至 `D:\OpenCharm`，四项自研组件随包落地；`e2e-real/release-real.cjs` 对**安装后的程序**实测 **7/7 PASS**（含 debugpy 随包可用、运行脚本真实输出）。详见 `debug_acceptance_record.md` §5.1 与 `bench/reports/release-build-blocker.md`。
- ✅ **产品缺陷 D-6 / D-7 / D-8 全部修复（2026-10-06，v1.3 复核时三个均未修）**：**D-7** 菜单复用 `computeRunWidget`（真机 14/14，`R-REAL-10` + 正对照 `R-REAL-13`）；**D-6** 详情面板 × + Esc 双通道（`e2e/db` 30/30 含回归钉：菜单优先语义也钉住了）；**D-8** `debugView.refreshToolbarTips()` 进 settingsPanel 保存清单（单测钉住改键/还原可逆）。详见 `debug_acceptance_record.md` §5.2（三条均已关闭）。
- ⏳ **出包环境的两个易复发点**（已修但值得记住）：① VS Build Tools **必须管理员安装**，否则实例不入注册表、`vswhere` 查不到，cargo/cc 会静默回落 VS2015；② PowerShell 的 `$ErrorActionPreference="Stop"` 会把 cargo 的 stderr 进度行当致命错误（`build-release.ps1` 已用 `Invoke-Native` 兜住）。另：安装包 `/S` 静默安装在本机无效，验收需走"安装后程序 + CDP"。
- ✅ **已补**：多窗口阶段 1/2 的真实完成度——`multi_window_dev_plan.md` v0.2 已按代码实测回填（后端 7 文件 22 处 `emit_to` + 前端 8 文件窗口级 `listen`）。
- ✅ **打包产物的实际体积与冷启动/内存的实测值**（2026-10-06 本轮补齐，数字随交付漂移，**当前值以 §1.4 为准**）：产物体积 **5,013 KB / 上限 5,120 KB PASS**（首测 4,989 KB；此前 7,065 KB 是 `dist/` 陈旧产物混入已取消的 mermaid/katex 所致，`budget-check.mjs` 已加 STALE 判定）；**首个性能基线** `bench/reports/metrics-20261006-091652.md`（release 重建 + `-Runs 3`）：冷启动 **956 ms**（<1500 PASS）· 内存 **339 MB**（≤600 PASS）。⚠ run1 2619 ms 为冷缓存首跑（run2/3 = 117/132 ms），后续对比应剔除。⏳ 仍缺：CI/nightly 侧跑通（→ 缺口 1）；soak 长跑（-SoakMinutes 10，本轮 SKIP，建议随 nightly 首跑一起补）。
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

### ⚠ 取数禁则（前三条是 v1.2 踩过的坑，后四条是 v1.3 新增，其中 5~7 为第二轮）

1. **禁止用 `Get-Content $f`（不带 `-Encoding`）统计行数。** 本机 PS 5.1 的 ANSI 代码页是 **gb2312**；对**无 BOM 的 UTF-8 源文件**它会按 GBK 解码并**吞掉换行**——实测 `style.css` 报 5,410（真实 5,668，少 4.5%）、`main.ts` 报 2,503（真实 2,897，少 13%）。丢失比例随 CJK 密度而变、**逐文件不同**，所以这批数字"看起来合理但系统性偏低"，极难自查。
   正确写法任选其一（三者对同一文件必然同值）：`Get-Content -Encoding UTF8 $f` · `[System.IO.File]::ReadAllLines($abs)` · `node -e "..."`（按 `\r?\n` 切分）。
2. **禁止用 `Measure-Object -Line`。** 它不计空行（`style.css` 上给 5,145，比真实值少 523）。
3. **含中文的 `.ps1` 必须带 UTF-8 BOM。** 否则同样被 GBK 解码成乱码并**直接语法报错**（不是静默出错，是脚本跑不起来）。仓库既有约定：`bench/collect-metrics.ps1` 是唯一含中文的 `.ps1`，它就带 BOM。`budget-check.mjs` 已把这条做成门禁。
4. **【v1.3 新增】跑产物体积断言前必须确认 `dist/` 是新的。** `budget-check.mjs` 的体积项数的是 `shell/dist/assets` 下 `.js + .css` 的字节和；`dist/` 陈旧时会把**已删除的依赖分包**继续算进去。实测：陈旧 dist 报 **7,065 KB（FAIL）**，`npm run build` 后 **4,988 KB（PASS）**——差额约 2.08 MB 全是**已被取消的 mermaid/katex 分包**（`cynefin` 654 KB + `wardleyDiagram` 640 KB + `katex` 261 KB + 其余 diagram 分包）。**这是与禁则 1 同类的"看起来合理但系统性错误"**：它不会报错，只会给出一个偏大的数字。修法见 P0-0 动作 1（给脚本加 dist 新鲜度校验）。
5. **【v1.3 第二轮新增】不要把"仓库里有 workflow"当作"CI 在跑"。** 判定 CI 是否成立必须**先确认宿主**：`git remote -v` 里有没有 GitHub 远端（Gitee / 自建 GitLab **不执行** `.github/workflows/`）。本仓 2026-10-06 查出只有 `gitee.com/usedel/opencharm`——此前两版报告里"CI 配置已交付 / 待观察首次触发"的记账全部建立在一个不存在的执行前提上。**顺序：先查宿主 → 再看配置 → 最后才谈证据。**
6. **【v1.3 新增】不要把"配置/清单就位"记成"已交付"。** 判定交付以**证据文件是否存在**为准：CI 是否真的触发过 → 看 Actions run 与 `bench/reports/metrics-*.md` / `budget-*.md`；Gate D 是否推进 → 看 `gate-d-ab-worklist.md` 的 PyCharm 列是否被勾、降权常量是否被改；缺陷是否修 → 看代码行。**v1.2 就是因为把前两者记成 ✅，才在 19 个提交后发现三项零进展。**
7. **【v1.3 第二轮新增】i18n 的 `data/html_dict.json` 是"冻结快照"，禁止随手重跑 `extract_html.py`。** 该脚本会按当前 `index.html` 重建整份词条表，而 `index.html` 长期是超前于它的（词条已在 `manual_zh.json` 里登记过）——实测重跑产出 **18 条与 `manual_zh.json` 重复的 key + 21 条缺英文**，`gen_locales.py` 直接 `exit 1`。要改词条请**直接改 `html_dict.json` / `manual_zh.json`**。**同族的坑：`extract_html.py` / `gen_locales.py` 原先都以文本模式写文件**，在 Windows 上把产物整体 CRLF 化——`extract_html.py` 因此让"该位置是否已有标记"的检测失效（全文件标记被重复插一遍），`gen_locales.py` 则让整个 `core.ts` 显示为改动。**凡生成器写文件一律 `open(..., newline="")`。** 另：生成器不产出注释，手改生成文件的注释会在下次重生成时静默丢失——`gen_locales.py` 已加 `PINS_ZH` / `PINS_EN` 锚点登记，新增此类注释请登记进去而不是手改产物。

**复核触发条件**（满足任一即需重取数字并更新本文头部「取数时点」）：① HEAD 变动 ≥ 10 个提交；② 任一专项验收收口（debug / db / ui / run / toolbox）；③ 季度评审；④ 任何专项 `*_dev_plan.md` 状态从"未开工"转"已交付"；⑤ **【v1.3 新增】定位 / 铁律 / 预算发生任何变更**（如 ADR-0010 这类会改变评判坐标系的事件，**优先级高于 ①~④**）。**重取一律走 `tools/stats/repo-stats.mjs` + `budget-check.mjs`，不要手敲命令。**

**v1.3 自查：本报告自身的"建议执行率"**（下次复核时先算这个数）
基线 `ccf9da2` → `bb32d77` 共 23 个提交，v1.2 的 P0 建议执行情况：

| 建议 | 是否被执行 | 证据 |
|---|---|---|
| P0-4 `env_cmds.rs` 拆分 | ❌ 0 | 4,937 行未变（**该窗口内**） |
| P0-4 二选一裁决（v1.3 第二轮补做） | ✅ 1 | 2026-10-06 裁决为**折中**：冻结线写进 `env_cmds.rs` 文件头、`budgets.toml` 上限改长期值、拆分降级为阶段二候选（不设死线） |
| P0-2 Gate D 两格人工 | ⚠→✅ 两格均已关闭（第一格 ❌ 撤下 / 第二格 ✅ 收口） | **第一格：2026-10-07 按 v1.4 死线撤下**（工作单 23 行仍全 `☐`，本机无 PyCharm）→ README 已知边界定稿声明 + `intel/README.md` 三处 ⏳ 关闭 + 工作单转存档（见续记 ㉔）；**第二格：`trace-stats-cumulative.md` 跨 3 个真实项目 497 条函数观测（742 B/条）**，门槛未达但已裁定改日常累积；`STALE_HITS_DIVISOR` 仍 2（样本未达 1000，不改） |
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
| `bench/reports/gate-d-ab-worklist.md` | ~~P0-2 第一格的载体~~ ❌ **已撤下转存档（2026-10-07，见续记 ㉔）**（OpenCharm 列已填好，PyCharm 列 23 行仍全为 `☐`；将来换对照组可复用，但结论须改写为"对 X"） |
| `bench/reports/trace-stats-cumulative.md` | P0-2 第二格的**当前样本**（2026-10-07：跨 3 个真实项目 / 7 次运行 / **497 条函数观测**，742 B/条；门槛为**跨 ≥2~3 个项目累计 ≥1000 条函数观测**）。门槛口径与收口处置见 `trace-sample-threshold.md` |
| `docs/tech-debt.md` | 债务明细：**待处理 4 条** TD-021 / TD-022 / TD-024 / **TD-025**（「自用」论据失效复审清单，6 条） |
| `docs/e2e_divergence_ledger.md` | P0-1 的论据（真机才暴露的缺陷） |
| `docs/onboarding_dev_plan.md` / `docs/onboarding_guide.md` | P0-3 方案来源与**双源冲突实例** |
| `docs/dx_features_backlog.md` | 已完成清单，避免重复立项 |
| `docs/git_improvement_report.md` | 迭代 0–6 交付事实 |
| `docs/pycharm_ux_review_and_proposal.md:393` | B1 的现行裁决（F-1 维持非目标，2026-09-25） |
| `docs/python_library_support_research.md` §8 | B1 复议时的边界依据（不做测试发现/结果树） |
| `docs/plugin_system_design.md` §10 | P1-6 / D 类的待决策点 |
| `intel/README.md:47` / `:60` / `:61` | ~~P0-2 的挂起项（P3-T10）——三处状态戳仍均为 ⏳~~ ✅ **2026-10-07 全部关闭**（第一格 ❌ 撤下 / 第二格 ✅ 已采收口 / 保留窗口补"建议值未落代码"），见续记 ㉔ |
| `docs/debug_acceptance_record.md` §五 / `docs/run_acceptance_record.md` §四 | P0-3 的人工验收清单 |
| `ci/budgets.toml` + `shell/scripts/budget-check.mjs` | P0-0 的预算真源与断言脚本（**当前三十一项全 PASS**；已并入 `ci.yml` test job） |
| `.github/workflows/ci.yml` / `nightly.yml` | P0-1 的配置证据（分支已对齐 `[master, main]`、`audit_tokens.py` 与 `budget-check.mjs` 均在 test job、nightly 三 job）——**⚠ 无宿主**：本仓远端只有 Gitee，Actions 不执行（详见 §9 取数禁则 5） |
