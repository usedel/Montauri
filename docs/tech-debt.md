# 技术债登记

> 记录已识别但暂缓处理的技术债。每条含：起因、根因、建议方案、处理时机、涉及文件。
> 处理完成后请移除对应条目或移入「已归档」。

## 待处理

> 2026-08-28 全项目代码检查新增。按严重度排序，处理时机均为「可作为独立 PR，任一项前先跑对应测试矩阵」。

> 2026-09-09「运行体验对齐 PyCharm」（P0–P3 + stdin S1–S4）交付时新增。均为**可接受的小债**，非缺陷。
> 第 8 条（S3+S4 公共前置）已随 S3/S4 交付偿还，移入「已归档」；第 5 条已于 2026-09-10 随 CR-19 偿还并归档（此前在待处理区重复登记，2026-09-13 复核移除）。下方编号保持原样（TD-9~TD-12）。

> 2026-09-13 PyCharm 调研报告落地复核（`pycharm_feature_research_report.md`）发现。均为「已宣称交付、实际未达对标效果」的缺口，经裁决**暂缓处理**。

> 2026-09-15 运行功能迁移收尾 + UI 细节改进（`python_run_migration_plan.md`）引出。均为「一致性 / 体验」债，非缺陷，全局落地时作为独立 PR。

> 2026-10-03 UI 视觉「高级感」改造（`docs/ui_premium_dev_plan.md` 六批 + 修记 A）交付后复核新增 **TD-022 / TD-023 / TD-024**。均为**自觉取舍或非缺陷的观感项**，交付时已在开发计划 §8.1.2 声明，本次复核补登记（此前只写在计划里，未进本文件）。

> 2026-10-05 产品定位变更（「单人自用」→「高性能 · 轻量」，ADR-0010）新增 **TD-025**：全项目 60+ 处决策曾以「单人自用」为论据，定位变更后这些论据**原则上已过期**。本轮按裁决**不逐个复审**，仅登记清单；读这些文档时须记住「论据过期 ≠ 结论错误」，画像类裁决仍然成立。

> 2026-10-08 全项目代码审查（TS 前端 / Rust 外壳 / probe / intel 四模块深审 + 主线逐项复核）：P0×2 + P1×11 当日修复（4 个本地提交，见 TD-027 头部）；P2 登记为 **TD-027**。

> 2026-10-09 复核：TD-027 A 组 **A2/A3/A4/A7/A8 已随提交 `0c881b2` 修复**（表格内 ✅ 标记，并录已归档区）；A1/A5/A6/A9 仍在，位置列按当前代码校准（10-09 各批致行号漂移）。C5/C6 随命令层拆分批迁至 pydantic_cmds.rs。预警区刷新：git_cmds.rs 已解决、命令面 200/200 整顶格、main.ts 2372/2400 新增逼近项、TODO 句经核实撤销。

> 2026-10-09 第一梯队清偿：**A1/A5/A6/A9 当日四提交修复**（`5514baf`/`b4b439a`/`4ab4277`/`5eb36d2`，均已录已归档区）——**A 组 9 条全部清零**。门禁：cargo test 340 / vitest 1342 / e2e-ui 66 / lsp·lt 针对性 14 / budget 全 PASS（顺手清拆分批遗留 2 处 unused import）。

> 2026-10-09 第二梯队清偿：**B2/B4/B5/B6/B7/B8 六提交修复**（`b1bd5b3`/`1db26ce`/`c23dd66`/`43a30f5`/`93ad46f`/`3f92077`，均已录已归档区）——B 组余 B1/B3/B9/B10（B1 留 intel 批次；B3 需配迁移逻辑独立 PR；B9/B10 无实锤待观察）。D12 的 config.py 部分已随 B4 顺手清。门禁：cargo test 340 / probe pytest 109（新增 20 用例）。intel trace.rs 经核实**无** B8 同款手拼 URI 问题（Rust 走 OpenFlags 路径直开），无需登记。

> 2026-10-09 D 组卫生批清偿：**D1~D17 共 16 条全部清偿**（probe 域 `6349b4d` / intel 域 `17f531b` / shell-ts 域 `670af2d` / shell-rust 域 `1e7a7d6`，按域四提交 + 本 docs 提交）——**TD-027 至此 42/42 全部处置完毕**（A9 + B6 + C7 留置 + D16 清偿 + 5 项已随 P1）。C 组 7 条留置绑定 bench 节奏；B1/B3/B9/B10 留置见上。门禁：probe pytest 114 / intel cargo test 85（含准确率红线 + bench_load 1318ms PASS）/ shell cargo test 340 / vitest 1342 / e2e editor·lsp 12/12 / budget 全 PASS（client.ts 1850/1850 顶格未越线）。

> 2026-10-10 全量复核（四域并行深审 + 主线探针实证）：**发现并修复 D8 首版引入的 P0 回归**——`comment_at` 取整行首个 `#` 不感知字符串，`s = "a#b"; jmespath.search("data.dff", …)` 的字符串内 `#` 把同行后续调用吞成注释（诊断静默丢失）。改为字符串感知边界（引号走 scan_string_end 跳过、字符串外 `#` 才截断），删两处错误防御（反斜杠特判的 Python 语义不成立 + min/max 钳制为不可达死分支），附 2 回归测试（`bd9eda0`）。另修 P2 三项：runner ⚠ 告警 ASCII 化（UnicodeEncodeError 会逃逸 except OSError，复现 B5 要防的异常替换）/ check --timeout 钳制值与提示同步 / termUi 重跑同 id 前 dropServiceTail（`361030a`）。其余 12 项全部通过。**复核遗留 P2×5 登记为 TD-028**。门禁：probe 114 / intel 87 / tsc 0 错 / vitest 1342。

> 2026-10-10 补全延迟批 P1 清偿：**C2 + C3 两项性能债当日修复**（intel 域，详见 C 组表格 ✅ 标记）。C2 = `by_last_segment` 排序数组二分化（未命中前缀 ~1000x）；C3 = `call_frame_at` 外提 `call_context.rs` + 64 KB 有界窗口（1 MB 文档 849µs，O(文档) → O(窗口)）。门禁：intel cargo test 92 全绿（含 1 个 --ignored 性能哨兵）+ bench_load 826ms/2s PASS + budget 全 PASS（completion.rs 1,950 → 1,800 拆分即降阈值，call_context.rs 367/450 新登记）。C 组余 C1/C4/C5/C6 + C7 留置。

> 2026-10-15 inlay「重复显示 / 跨轮累积 / 悬停闪现」三症状治理收口：前两项根治
>（merge (行,文) 去重 + 复活同文守卫 + heal v3 清 vendor 缓存 + refire 干净轮），
> 第三项**悬停闪现仅缓解未根治**，且总开关 `inlay_type_hints` 默认关（用户裁决）后
> 不可见——**开启开关时可能偶发复现**。登记 **TD-029**。

### TD-030 2026-10-16 monaco 0.57 Edit Context 迁移（升级时显式关闭，待评估启用）

- **背景**：monaco-editor 0.53 引入、**0.57 起默认启用** Edit Context API（VS Code 主线输入管线）：焦点元素从 `.monaco-editor textarea.inputarea` 变为 `div.native-edit-context`，textarea 降级为 `ime-text-area`（tabindex=-1 / aria-hidden / readonly，仅 IME 用）。
- **现状**：升级 0.52.2→0.57.0 时经 `buildEditorOptions` 注入 `editContext: false` 显式关闭（主/分屏/db 编辑器统一覆盖）——19 处 e2e 焦点断言与 browserKeys 焦点判定基于旧 textarea 管线，升级纪律=行为面最小化。
- **启用前须评估**：① e2e 16 个文件的 `.monaco-editor textarea` toBeFocused 断言改 `.native-edit-context`；② `browserKeys.ts` 的 `closest(".monaco-editor")` 焦点判定复核；③ 中文 IME 输入实测（Edit Context 的 IME 组合窗口行为与 textarea 不同）；④ 收益评估（VS Code 迁移动机：更精准的 IME/无障碍/虚拟键盘支持）。
- **触发条件**：monaco 后续版本若移除 `editContext: false` 开关（强制迁移），或 IME 相关 bug 排查需要。

### TD-029 2026-10-15 inlay 悬停闪现重复残影（vendor 视图镜像失步）—— **2026-10-16 已根治（patch-package）**

- **状态**：✅ 已根治。四层修复全落地，真机终验（用户精确路径：行尾回车 → Ctrl+S → 悬停，两轮逐帧采样）恒单份、无累积：
  1. hover 抑制区间判定（`isOnInlayHint`，锚邻跳变列全命中）；
  2. heal v4：超标装饰直接删除（渲染轮 sweep 对插行位移的 stranded 装饰扫不到）；
  3. heal v5：删除时同步清控制器 `_decorationsMetadata` 死项（悬停 link-gesture 以死项 item 为源复活装饰 = 闪现计步器）；
  4. **vendor patch**（`patches/monaco-editor+0.52.2.patch`，postinstall 自动应用）：`_getInlineHintsForRange` 按 item 身份去重（Set），死项/换代项是不同对象同 anchor → Set 不折叠 → link-gesture 进入与移开两次重渲染各叠一套 = 最终残留的闪现一档。补丁新增 `_getInlineHintsForRangePatched` 按 **anchor(行,列)+label** 去重。
- **升级无效实证**（2026-10-16）：0.57.0 的 `_installLinkGesture`/`_updateHintsDecorators`/`_getInlineHintsForRange` 与 0.52.2 逐行相同（npm pack 比对），上游 issue 区无对应报告——升级 monaco-editor 不解决，本地 patch 是唯一路径。
- **遗留**：升级 monaco-editor 时须重跑 `npx patch-package monaco-editor` 重新生成补丁（函数若已被上游改名/重构，patch 会应用失败并阻断 install——这是有意的失败响铃）。

- **起因**：用户实案三连（编辑后同行多份类型提示 / 次数越多越多 / 悬停提示闪现 N 份重复）。前两者已根治并有单测+e2e 钉住；本条为残留的第三项。
- **根因（真机 CDP 插桩实锤）**：Monaco **view 层 injected-text 镜像与模型装饰失步**——闪现瞬间模型装饰恒单份、DOM 瞬现 N 份（N 随编辑轮次增长），滚动等强制重绘即恢复单份；且 monaco OSS 对注入文本零处理：hover 部件不感知 injected-text（照常触发代码 hover，弹窗内容与提示重复 = 另一种"闪现"），inlay 控制器也没有 VS Code 的 hint tooltip 拦截能力。历史放大器两个（均已排除）：带外 `deltaDecorations` 删除会给 view 留残影；heal 旧版 inlayHints toggle 会取消在途轮，致 vendor `_inlayHintsCache` 污染永不被覆盖（fast-restore 反复回填双份）。
- **已落缓解**：① **悬停闪现已修复（2026-10-16，逐帧取证）**：根因 = hover 弹窗（ContentWidget）显示/隐藏触发 view 行重渲染的中间态帧（该行注入文本瞬现双份、下一帧恢复）；而弹窗本可避免——悬停注入文本的映射列在锚列邻跳变（实测 13/15/16 @ 锚 15），首版精确锚列抑制漏配。修复 = 抑制判定改**区间**（`isOnInlayHint`：`: ` 类锚左（标识符本体）不放宽，`-> `/参数名锚左（括号）放宽 2 列，右侧锚+label 长+1）→ 悬停提示全程无弹窗 → 无生命周期 → 无中间态。② heal v3：按行期望总额检出泄漏 → 清 vendor `_inlayHintsCache` 条目 + refire 干净轮（废除 toggle 与带外删除，re-arm 冷却 1.6s）；③ `inlay_type_hints` 总开关默认关（用户裁决）。
- **残余观察**：hover 弹窗在**代码本体**（非注入文本）上的显示/隐藏理论上仍会触发同样的行重渲染中间态，但无注入文本行不受影响；且这是 monaco 悬停机制的固有中间帧，无功能影响，不追。
- **建议方案**（按代价升序）：(a) 若后续再出现类似瞬态：视图一致性自检（DOM 份数 vs 模型装饰数，不一致滚动重绘）；(b) patch-package 修 vendor `inlayHintsController` / view injected-text 同步路径（治本，需跟 monaco 版本升级维护补丁）；(c) 升级 monaco-editor 并跟踪上游 inlay injected-text 相关 issue。
- **处理时机**：独立 PR；动手前跑 e2e dx/10 + 真机 CDP 采样（附着脚本方法：connectOverCDP → import vite deps monaco → 模型装饰/`_decorationsMetadata`/freeze 缓存/DOM 四方比对；历史脚本见 git 提交说明）。
- **涉及文件**：`shell/src/lsp/inlayHeal.ts`、`shell/src/lsp/inlayMerge.ts`、`shell/src/lsp/inlayFreeze.ts`、`shell/src/lsp/client.ts`、`node_modules/monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsController.js`。

### TD-029 文件监听（notify）增强批遗留项（2026-10-18，外部改动检测交付后登记）

- **起因**：`docs/fs_watch_dev_plan.md` v1.0 交付（外部改动检测 T1–T8），计划 §11 的后续候选中四项有**明确触发条件**，此处登记防丢。真源在计划文档 §11/§12，本条目只做索引。
- **① W2 监听范围瘦身（P2，性能）**：现在对工作区根一次性 `Recursive`，`.venv` / `node_modules` / `__pycache__` 的事件照样进 Rust 回调再被 `should_ignore` 丢弃。notify 8 无原生 exclude，正解是按顶层目录分别 `watch`（跳过忽略目录）。前置：须配 `bench/large_repo` 回归（章程「运行时开销红线」同类要求）。
- **② W3 监听健康度（P2）**：`watch_start` 失败只 `console.warn`；网络盘 / OneDrive 同步目录上 `ReadDirectoryChangesW` 缓冲区溢出丢事件，无溢出后重订阅。前置：需新增状态栏 UI 面。注意与本批的 `unreadable` 分支不同——那条治「读盘失败」，这条治「事件根本没来」。
- **③ W4 两套 watcher 合并（P3，整洁）**：`plugin_cmds.rs:250` 的 `PLUGIN_WATCHER` 与 `watcher.rs` 各有一套 debouncer + 各自的忽略/转发逻辑。
- **④ 既有 A-mock 不忠实（P2，工程）**：`e2e/helpers.ts:1160` 的 `emitFsChanged` 推的是**文件绝对路径**，而 Rust `watcher.rs` 对文件变更推的是**父目录** → mock 层 `write_file` 后 `isDirExpanded(filePath)` 恒 false、文件树不刷新，而真机刷新（mock 比真机弱）。本批刻意不修（会打到既有 git/ux 用例期望），修它须先盘点所有依赖「bridge 改盘不刷新树」的用例。
- **⑤ 批量冲突面板缺失（P3）**：git checkout 一次改多个已打开文件时逐个弹面板（现有 800ms 单飞 + 串行兜底）。
- **⑥ UX-6 存量回归（P2，与本批无关但同日发现）**：`e2e/ux/01-ux-batch.spec.ts` UX-6「文件树展开状态跨会话持久化」在 `page.reload()` 后深层目录 15s 内不出现；已 stash 对照实证为存量（原始代码同样失败）。
- **处理时机**：①随性能批、②按网络盘用户实案、③搭车任一批次、④⑤⑥各自独立小项。
- **涉及文件**：`shell/src-tauri/src/watcher.rs`、`shell/src-tauri/src/plugin_cmds.rs`、`shell/e2e/helpers.ts`、`shell/e2e/ux/01-ux-batch.spec.ts`、`docs/fs_watch_dev_plan.md`、`docs/fs_watch_acceptance_record.md`。

### TD-028 2026-10-10 全量复核遗留项（P2×5，均为窄触发或记录性）

- **起因**：TD-027 三批清偿后的全量代码复核（上方复核记录）。已修项见 `bd9eda0`/`361030a`；以下为裁决**留置**的窄触发/记录性项。
- **① B8 UNC 路径**：`store.py::load_summary` 的 `as_uri()` 在 db_dir 为 UNC 网络盘（`\\server\share`）时产出 `file://server/...`，而 SQLite URI 只接受空/localhost authority → 报错；save 端普通 connect 可用，形成「可写不可读」不对称。修法：UNC 检测回落普通 connect + `PRAGMA query_only=ON`。触发面：`OPENCHARM_PROBE_HOME` 指向网络盘。
- **② D11 残余**：`_cmd_show` 的 startswith 无路径边界分隔符（`f:\proj` 前缀误匹配 `f:\project\app.py`）且 dirname 计算两次。观感项，修法一行。
- **③ B4 overrides 路径不校验**：`load_config(**overrides)` 只护手写 JSON，代码传参不校验（IDE/测试可抓，docstring 未声明取舍）。
- **④ B4 定长 tuple 标注**：`_matches` 对 `tuple[int, str]` 只校验首元素；当前无 tuple 字段，未来陷阱，登记备查。
- **⑤ D4 记录修正**：原文「functions/by_location/by_file 有真实调用方保留」不精确——`functions()` 有 src 调用（type_infer.rs:335），`by_location` 仅 examples、`by_file`/`by_qualname` 仅 tests。按 ParsedShape::keys 同标准可再删三个，下批卫生顺手处理。
- **处理时机**：随下个卫生批顺手清；①② 各约 5-10 行 + 测试。
- **涉及文件**：`probe/src/opencharm_probe/store.py`、`probe/src/opencharm_probe/cli.py`、`probe/src/opencharm_probe/config.py`、`intel/crates/opencharm-intel-index/src/trace.rs`。

### TD-027 2026-10-08 全项目代码审查批次（P2×42，其中 1 项已随 P1 修复；intel 杂项 1 项拆为 3 个卫生点）

- **起因**：全项目代码审查（四个并行深审：shell/src TS、shell/src-tauri Rust、probe Python、intel Rust，逐行通读；全部 P0/P1 经主线读码复核实证）。
- **已修复（当日 4 提交，未推送）**：`587d8a4` intel P0 退避死锁 + P1 didOpen 守卫/参数前跳钳制；`93c7648` probe P1 perf 帧偏移（`_monitored_frame` 按 code 搜帧）+ RAISE 回调 type_label 兜底；`05c5ce1` shell-rust P1 dap 杀树顺序×4 + strip_noise 字节等长（中文 SQL）；`8601264` shell-ts P0 diff→db 遮挡 + P1×5（model 复用/rename 防线、分屏 didChange 管线、logs 复位、activateConnection 令牌、lazyEl×5）。新增回归测试 6 条；git_cmds.rs:1864 unused var 顺手修复；probe「perf 模式测试缺 args 断言」已随帧偏移修复补上（`test_perf_mode_records_arg_observations`）。
- **处理原则**：按 A 行为正确性 → B 健壮性 → C 性能（随 bench 节奏）→ D 规范卫生排序；每项独立成 PR，动前跑对应测试矩阵（C 组改 intel 热路径必须跑准确率红线 + 性能基线）。

**A. 行为正确性（用户可感知，优先）—— 2026-10-09 全部清偿，9/9 归档**

| # | 条目 | 位置 | 要点 |
|---|---|---|---|
| ~~A1~~ | ~~db_cancel 取消检查死代码~~ | ~~db_cmds.rs:650-654~~ | ✅ 已修（`5514baf`）：删不可达分支与 DbOp.cancel 字段，interrupt 句柄即取消单一真值（cancel_interrupts_running_query 仍绿锁定语义） |
| ~~A2~~ | ~~git_apply_hunk 固定 patch 路径竞态~~ | ~~git_cmds.rs:517-525~~ | ✅ 已修（`0c881b2`）：patch 文件名加 nanos+pid+seq 唯一后缀，无论成败清理（git_cmds.rs:519-560） |
| ~~A3~~ | ~~调试快捷键硬编码 threadId=1~~ | ~~windowKeys.ts:79-84~~ | ✅ 已修（`0c881b2`）：F5/F10/F11/Shift+F11 改 `currentThreadId()`（debugView.ts:81-83 单一真源），menuItems.ts 步进项同步 |
| ~~A4~~ | ~~reopenConnection 顶掉活动连接~~ | ~~sqliteStore.ts:225-238~~ | ✅ 已修（`0c881b2`）：重开后重拉连接列表 + activeId 命中即 refreshTree（sqliteStore.ts:239-256）；conn_id 按归一化路径派生、同路径 id 稳定，无需迁移 |
| ~~A5~~ | ~~serviceTail 跨实例共享~~ | ~~termUi.ts:699-752~~ | ✅ 已修（`b4b439a`）：改 Map 按运行实例 id 分桶；命中即弃 / closeTerminal / term-exit / disposeTerminal 四路径清理 |
| ~~A6~~ | ~~模板热重载目录判定过宽~~ | ~~main.ts:754-760~~ | ✅ 已修（`4ab4277`）：收紧为 `/.opencharm`、`/.opencharm/config`、`/opencharm/config` 三前缀；取舍：DATA_ROOT 重定向非默认路径时用户层外部编辑热重载失效 |
| ~~A7~~ | ~~scope 搜索掩码大小写失配~~ | ~~search.ts:68 + searchFilters.ts:88-91~~ | ✅ 已修（`0c881b2`）：searchFilters.ts:90-95 正则加 `i` 标志；附回归测试 searchFilters.test.ts:91-102（`*.Py` 正反用例） |
| ~~A8~~ | ~~`__init__` 回退全名精确匹配~~ | ~~intel completion.rs:305-310~~ | ✅ 已修（`0c881b2`）：resolve_callee 改取 callee 末段做段边界后缀匹配 + (非 stale, hits) 裁决（completion.rs:315-346）；附正负回归测试 |
| ~~A9~~ | ~~didOpen languageId 恒 "python"~~ | ~~lsp/client.ts:480-489~~ | ✅ 已修（`5eb36d2`）：改 `model.getLanguageId()`（Monaco 注册 id 与 LSP languageId 同源）；didOpenText 保留 "python"（rename 只作用 .py） |

**B. 健壮性（触发面窄但后果重）**

| # | 条目 | 位置 | 要点 |
|---|---|---|---|
| B1 | type_label::parse 递归无深度上限 | intel type_label.rs:43-99 | 损坏库的数千层嵌套 type_label 可爆栈 abort 常驻进程（shape 侧有 serde_json 128 层保护，此处无对等防线）；加深度计数即可 |
| ~~B2~~ | ~~pick_folder/pick_file 阻塞 recv~~ | ~~fs_cmds.rs:205-224~~ | ✅ 已修（`b1bd5b3`）：recv 移入 spawn_blocking，对话框挂起期间不再占 tokio worker；接口零变化 |
| B3 | conn_id 依赖 DefaultHasher | db_cmds.rs:163-167 | std 不保证跨 Rust 版本稳定，工具链升级后 db_connections.json 旧条目全部失配追加重复；换 project_hash 同款 sha1（**须配旧条目迁移**，独立 PR） |
| ~~B4~~ | ~~load_config 不校验值类型~~ | ~~probe config.py:70-73~~ | ✅ 已修（`1db26ce`）：get_type_hints 驱动的 _matches 运行时校验，类型不符告警保默认；顺手清 D12 config.py 部分；附 9 用例 |
| ~~B5~~ | ~~os.chdir(old_dir) 可抛异常~~ | ~~probe runner.py:67~~ | ✅ 已修（`c23dd66`）：finally 里 chdir 单独 try/except 降级告警，原始异常必传播；附删除 cwd 场景用例 |
| ~~B6~~ | ~~_cmd_check 无 timeout~~ | ~~probe cli.py:181-183~~ | ✅ 已修（`43a30f5`）：--timeout（默认 60s）+ TimeoutExpired 捕获 → 退出码 2；附超时用例 |
| ~~B7~~ | ~~autostart 摘要无编码兜底~~ | ~~probe autostart.py:110-115~~ | ✅ 已修（`93ad46f`）：_print_safe per-print 降级（UnicodeEncodeError → replace 重打、流关闭静默），不动全局 stdio；附 GBK 流模拟 5 用例。实测 ✓ U+2713 不在 GBK 映射——摘要行在 GBK 控制台必然触发原 bug |
| ~~B8~~ | ~~load_summary URI 未百分号编码~~ | ~~probe store.py:331~~ | ✅ 已修（`3f92077`）：as_uri() 标准编码 + "?mode=ro"；附 `#`/`%` 目录往返用例。intel trace.rs 经核实无同款问题 |
| B9 | 同步命令做磁盘 IO/进程创建 | terminal.rs:327/161、lsp.rs:45、db_cmds.rs:493/926 | 与 debug_start/db_query 的 async+spawn_blocking 范式不一致；无卡死实锤但违反「阻塞统一 async」纪律 |
| B10 | 只读打开 WAL 库的崩溃恢复未覆盖 | intel trace.rs:146-160 | probe 崩溃留未 checkpoint 的 -wal 时 RO 打开可能失败（busy_timeout 不覆盖恢复）；正常流程（probe 正常退出 checkpoint）不受影响 |

**C. 性能（随 bench 回归节奏，改热路径必须跑基线）**

| # | 条目 | 位置 | 要点 |
|---|---|---|---|
| C1 | intel 索引 6 张 HashMap 字符串克隆 | trace.rs:123-243 | qualname/filename/segment 重复克隆 3-5 份，10 万函数估数十 MB 额外开销（ADR-0010 张力）；可 String 驻留或 Arc 共享 |
| ~~C2~~ | ~~顶级符号补全线性扫全键~~ | ~~trace.rs:407-415~~ | ✅ 已修（2026-10-10，补全延迟批 P1）：`by_last_segment` HashMap → 排序数组，前缀查询 `partition_point` 二分下界 + 命中区段扫描，精确查询同容器二分；新增 `examples/bench_prefix.rs` 对照——10 万函数下未命中前缀 **4.8ms → 0.2-6.5µs（~1000x）**，命中 1.1 万前缀 4.8ms → 0.4ms；`by_last_segment_prefix_sorted_array_semantics` 钉语义；bench_load 826ms/2s PASS（排序开销不破加载红线） |
| ~~C3~~ | ~~call_frame_at 全文扫描~~ | ~~intel completion.rs:355-379~~ | ✅ 已修（2026-10-10，补全延迟批 P1）：扫描群外提 `call_context.rs`（completion.rs 1,943 → 1,729，预算 1,950 → 1,800 拆分即降阈值；新文件 412/450）+ **64 KB 有界窗口**（发生截断时起点前进到窗口内首个行首，保证状态机从完整行开头起步），O(文档) → O(64KB)；A3①/A3③/diagnostics/hover 四方 import 统一指向新模块；性能哨兵 `call_frame_bounded_scan_does_not_scale_with_document`（--ignored，1 MB 文档 < 2ms，实测 ~1ms）。**首版窗口起点 bug 被复核抓出**：`rfind('\n')` 定位到当前行行首，>64KB 文档下窗口缩成当前行，混合场景（光标行含已闭合调用 + 光标处于跨行外层调用实参内）外层帧丢失——改为截断点后**第一个**行首（`find`）+ UTF-8 字符边界对齐，`call_frame_at_multiline_call_in_large_document` 回归钉子（实证：首版逻辑下该测试必 FAIL） |
| C4 | 诊断无服务端防抖 | intel server.rs + type_infer.rs:18-26 | 每次键入全文重扫 + `lines().collect()` 每调用重新分配整篇行表 |
| C5 | model_inherits_from O(N×全仓) | pydantic_cmds.rs:936+ | 每个候选子类触发 `pyd_collect_models` 整仓重扫；外层已收集的 models 清单应作参数传入（原 fs_cmds.rs:2406-2430，随拆分批迁入） |
| C6 | scan_pydantic_issues O(行×模型数) | pydantic_cmds.rs:626+ | 每行对全部模型做 substring 扫描；可按行含 `(` 粗筛或建前缀索引（原 fs_cmds.rs:2102-2135，随拆分批迁入） |
| C7 | sink 多线程计数竞态 | probe sink.py:54-77 | get+set 非原子丢频次精度（类型集合不受影响，func_id 已有双检锁） |

**D. 规范/卫生 —— 2026-10-09 卫生批全部清偿（16/16，D12 config.py 部分随 B4）**

| # | 条目 | 位置 | 要点 |
|---|---|---|---|
| ~~D1~~ | ~~splitEditor 硬编码中文文案~~ | splitEditor.ts:67-71,127 | ✅ 已修（`670af2d`）：三处文案走 `ide.split.*` 词条；过程中 gen_domain 全量重写删掉手工登记的 ide.ws.*（T6b 批），按流程补进数据源恢复 |
| ~~D2~~ | ~~wireGotoTriggers 丢弃监听器句柄~~ | lsp/client.ts:931-943 | ✅ 已修（`670af2d`）：onMouseDown 句柄返回并入 lspProviders store；F12 走 addCommand 无解绑 API（规范已知限制）随实例兜底 |
| ~~D3~~ | ~~intel SCHEMA 与 store.py 漂移~~ | trace.rs:16-58 | ✅ 已修（`17f531b`）：SCHEMA 补 `runs.instance` + `functions.perf_*` 5 列，头注释恢复为事实 |
| ~~D4~~ | ~~intel 死代码/API 面膨胀~~ | trace.rs 多处 | ✅ 已修（`17f531b`）：删 Function::loc / get / qualnames / qualnames_by_prefix（全仓搜证零调用）；functions / by_location / by_file 有真实调用方保留 |
| ~~D5~~ | ~~`#[allow(dead_code)]` 失效残留~~ | intel server.rs:51-52 | ✅ 已修（`17f531b`）：删属性（client 三处在用）；顺手清 type_infer.rs 的 ParsedShape::keys（CR-27 后零调用——存量） |
| ~~D6~~ | ~~「库不存在」误用 InvalidParameterName~~ | intel trace.rs:150-153 | ✅ 已修（`17f531b`）：TraceError::Missing(PathBuf) variant + Display 分支 |
| ~~D7~~ | ~~symbol_candidates 双重去重~~ | intel completion.rs:591,607-611 | ✅ 已修（`17f531b`）：删内部 by_label 去重（dedup_sort_truncate 统一处理）；准确率红线 + bench_load 1318ms/2s PASS |
| ~~D8~~ | ~~诊断行扫描无注释/转义感知~~ | intel diagnostics.rs:41-81 | ✅ 已修（`17f531b`）：scan_line 重写——`#` 注释截断 + 引号跳过复用 scan_string_end（pub(crate) 化，转义口径统一）；附 3 正反测试 |
| ~~D9~~ | ~~Monitor.__init__ 改写共享 cfg~~ | probe monitor.py:106 | ✅ 已修（`6349b4d`）：perf 抬开写 dataclasses.replace 局部副本；test_monitor 断言同步（内部副本抬开 + 调用方不变） |
| ~~D10~~ | ~~_perf_frames 类型标注错误~~ | probe monitor.py:99 | ✅ 已修（`6349b4d`）：`list[list[types.CodeType | int]]` |
| ~~D11~~ | ~~_cmd_show 路径归一不对称~~ | probe cli.py:74-77 | ✅ 已修（`6349b4d`）：startswith 两侧同走 normcase |
| ~~D12~~ | ~~函数内 import / `__import__`~~ | probe store.py:184 / config.py:68 | ✅ 已修（`6349b4d`）：store.py 的 import sys 提顶部（config.py 部分已随 B4 先清） |
| ~~D13~~ | ~~_cmd_inject / _cmd_clean 无 CLI 层单测~~ | probe cli.py:101-123 | ✅ 已修（`6349b4d`）：test_cli_dispatch.py 5 用例（inject 无命令/非 .py 警告、clean 有库无库、show 无库） |
| ~~D14~~ | ~~_elem_shape 键上限语义不一致~~ | probe compact.py:147 vs 207 | ✅ 注释化归档（`6349b4d`）：登记为有意取舍（顶层超限防指纹爆炸放弃 / 元素合并超限截断保留），统一任一方向都改变 trace 库内容 |
| ~~D15~~ | ~~run lock 去重子进程不 stop 监控~~ | probe autostart.py:104-106 | ✅ 已修（`6349b4d`）：被去重子进程 return 前补 mon.stop()（幂等），全局 RAISE 不再空转到进程死 |
| ~~D16~~ | ~~dap attach spawn 失败路径泄漏~~ | dap.rs:612-614 | ✅ 已修（`1e7a7d6`）：take 失败 Err 路径 kill_process_tree_async(child)（与 assemble 段对称，实际不可达纯防御） |
| ~~D17~~ | ~~updateSyncCount 无请求令牌~~ | git.ts:182-197 | ✅ 已修（`670af2d`）：syncCountToken 令牌（searchToken 范式），在途旧响应不再覆盖状态栏 |

**预警（非缺陷，预算纪律提醒；2026-10-09 复核刷新·第一梯队后）**：`hotspotsView.ts` 350/350 顶格、`lsp/client.ts` 1848/1850（余 2 行）、`main.ts` 2374/2400（余 26 行）、intel `server.rs` 647/700、intel `completion.rs` 1948/1950（新录入：A8 修复后逼近）、**命令面 200/200 整顶格**——下一批功能交付前应先安排拆分窗口（各条目在 budgets.toml 已注明拆分路径）。~~git_cmds.rs 1940/1950~~ 已随 10-09 命令层拆分批解决（现 1603/1900）。~~TODO 标记清理~~ 撤销：经核实 endpointView.ts（8 处）/hotspotsView.ts（5 处）全是复用 todo 分组样式的 CSS 类名与模块引用，quickFix.ts（3 处）是快捷修复有意插入用户代码的 `# TODO` 桩注释——均非开发遗留标记，无需清理。

- **处理时机**：A/B/D 组已于 2026-10-09 全部清偿（见各表 ✅ 标记与已归档区）；**C 组 7 条留置**，绑定 bench 回归节奏（改 intel 热路径须跑准确率红线 + 性能基线）；B1 留 intel 批次、B3 需配迁移逻辑独立 PR、B9/B10 无实锤待观察。任一项前先跑对应测试矩阵（shell → cargo test + vitest；probe → uv run pytest；intel → cargo test）。
- **涉及文件**：见上表各列。

### TD-025 历史「单人自用」论据的定位失效复审清单（P2，文档一致性；2026-10-05 定位变更登记）

- **起因**：产品定位由「单人自用 Python IDE」变更为「高性能 · 轻量 Python IDE」（ADR-0010，目标用户画像**不变**：FastAPI + 爬虫 + 小脚本）。历史文档大量以「自用 / 单人 / 没人在乎跨机一致性」作为取舍论据，这些论据在对外定位下不再自明。
- **本轮裁决**：**不逐个复审、不批量替换表述**（工作量多日且多数结论仍成立）；只登记清单，由后续独立 PR 逐项处理。**结论仍成立的画像类裁决明确不复审**（见下「不复审」）。
- **复审清单**（按建议处理顺序）：

| # | 条目 | 原论据（已过期） | 失效原因 / 复审要点 | 涉及文件 |
|---|---|---|---|---|
| 1 | nightly 的 e2e-real / bench / budget 三个 job **只告警不阻断** | 「单人自用项目没人盯 CI 告警，价值在出报告而非卡合并」 | 定位对外后，告警无人看 = 护栏形同虚设；需决定：接通知渠道（Windows 通知/邮件）还是升级为 PR 阻断（ADR-0010 决策 5 已把后者延后） | `.github/workflows/nightly.yml`、`docs/improvement_and_roadmap_report.md` §6 约束 A |
| 2 | **更新通道 / 版本回滚**延后 | 「自用项目也要面对『我这版是不是装错了』」 | 对外分发后更新与回滚从「锦上添花」升为分发链路一环；至少要有 `version.json` 比对提示 + 设置面板「检查更新」 | `docs/improvement_and_roadmap_report.md` §2 P1-2、`shell/src-tauri/Cargo.toml`（无 updater 依赖） |
| 3 | UI 字体 **Inter 走系统栈**、只随包等宽字体 | 「单人自用定位，跨机一致性收益为零」 + CSP 阻碍 | 跨机一致性不再天然无用；需重估是否值得改 CSP（`font-src`）把 Inter 随包 | `docs/ui_premium_design_report.md` §5.3 / §7、`docs/ui_premium_dev_plan.md` §2、`shell/src-tauri/tauri.conf.json`（CSP） |
| 4 | Watches / 低频配置存 **localStorage** | 「低频个人配置、无跨设备诉求，避免为 20 条字符串扩后端」 | 同上；若做配置同步才需动，否则维持现状即可 | `docs/pycharm_ux_review_and_proposal.md` §16.5、`shell/src/debugWatches.ts` |
| 5 | 插件 v2 **硬沙箱**（iframe/Worker）延后 | 「成本高、收益对自用场景有限」 | 面向外部插件作者时，信任模型（现为同源 + facade）重要性上升；工作区级插件目录可先行 | `docs/plugin_system_design.md` §10、`docs/improvement_and_roadmap_report.md` P1-6 |
| 6 | HTTP Client（工具箱）对内网地址**不拦截只提示** `private_target` | 「自用工具不拦，知情即可」 | 模板/配置可分享后，SSRF 需重新裁决是「提示」还是「默认拦 + 显式放行」 | `docs/toolbox_dev_plan.md`（HTTP Client 章） |

- **不复审（结论仍成立，仅论据措辞过期）**：S1 画像类打分（`docs/python_library_support_research.md` 的「单人自用脚本 / 小项目」画像）、框架支持裁决（`docs/pycharm_framework_support_report.md` 的 FastAPI 第一 / Flask 第二 / Django 浅做）、pytest 面板 / Jupyter 不做（`docs/python_ide_dev_plan_v2.md` §1.1）——**用户画像未变**，这些裁决的依据是画像而非「自用」二字。
- **处理时机**：各自独立成 PR；建议顺序 1 → 2 → 3 → 4 → 5 → 6（1/2 影响分发可信度，优先级最高）。任一项复审结论若要推翻原裁决，须先写 ADR 再改代码。
- **涉及文件**：见上表；本条本身登记于 `docs/tech-debt.md`。

### TD-024 alpha 边框不满足 WCAG 1.4.11 非文本对比 3:1（P4，合规取舍；2026-10-03 UI 高级感批 5b 登记）

- **起因**：批 5b 把边框换成三档 alpha 叠色（`--border-hairline` / `--border-subtle` / `--border-strong`），实测对比 1.32~1.36:1，**低于** WCAG 1.4.11 要求的 3:1。
- **根因**：这是**存量事实**（旧值 1.29~1.51 同样不达标），不是本批引入的回归；且 alpha 边框在原理上不可能达到 3:1——要达标就得把边框做成接近实色，那正是「精致」要去掉的东西。聚焦态的识别由 `border-color: var(--accent)`（青绿 4.98:1）承担，语义准确。
- **建议方案**：维持现状并在 `ui_premium_dev_plan.md §7.7.4` 保留登记；若将来要对外做无障碍合规声明，需单独评估（可能要为「高对比」另出一套实色边框主题）。
- **处理时机**：有合规诉求时；否则长期挂账。
- **涉及文件**：`shell/src/style.css`（`--border-*` 三档）、`tools/ui/audit_tokens.py`（阶梯轴/对比度判定）。

### ~~TD-023 `runWidget` 忙碌态切图标类导致按钮宽度变化~~ —— ✅ **已关闭（2026-10-04 实测：前提不成立）**

- **起因**：批 5c 统一圆角档位时**推断**——运行控件的忙碌态通过切换 codicon 图标类实现（▶ `codicon-run` → ⟳ `codicon-loading`），推断「两个字形宽度不同」会让按钮横向抖动。
- **实测结论（2026-10-04，浏览器探针）**：**前提不成立**。在 `.menubar-icon` 上下文里逐个量 14 个 codicon 字形（`run` / `run-all` / `loading` / `sync` / `refresh` / `debug-stop` / `tools` / `gear` / `debug` / `play` / `circle-filled` / `triangle-right` / `dashboard` / `check`），`#btn-run-script` 的 `getBoundingClientRect().width` **恒为 28px**；图标元素本身在 16px 字号下也**恒为 16px**。即 **@vscode/codicons 0.0.46-24 的字形推进宽度是统一的 1em**，换字形不改变布局。
- **过程中曾按旧推断落过一版修复**（`.menubar-icon .codicon { width: 1em }` + 单测 + e2e 宽度断言），**已全部回退**：那两条门禁在「有/无修复」下都通过（假绿），留着只会让人误以为已被覆盖——与 `ui_premium_dev_plan.md §7.7.1`（批 5b 推翻"重点提升"前提）是同一类教训：**先验证前提再动手**。
- **不做的事**：不为已统一推进宽度的字体加定宽槽位（纯噪声）；若将来换图标集 / 自定义字形（非 1em 推进），再按本节方法重测一次即可。
- **涉及文件**：无（无代码改动）；证据与结论登记在 `docs/ui_premium_dev_plan.md §6.5` 与 §8.1.2。

### TD-022 Monaco 浮层圆角无法跟随外壳 `--radius-*`（P4，一致性；2026-10-03 UI 高级感批 5c 登记）

- **起因**：批 5c 把外壳圆角档位统一到 3/6/8/10/16px（`--radius-xs..xl`），但 Monaco 的**内置浮层**（补全框 / hover / 参数提示 / 右键菜单）由它自己的样式表绘制，**没有主题槽位**可以注入圆角，因此仍是出厂值（10px 左右，且不随外壳档位变化）。
- **根因**：Monaco 主题系统只暴露颜色槽位，几何属性（圆角 / 边框宽度）不在 `defineTheme` 的能力范围内；要改只能写 CSS 覆盖 `.monaco-editor .monaco-hover` 等内部选择器（属侵入第三方 DOM，与「不侵入内核」原则冲突）。
- **建议方案**：若一定要统一，按元素逐个写覆盖 CSS 并锁死 Monaco 版本（升级需回归）；当前裁决**不做**，接受这一处不一致——浮层与外壳圆角差 2~4px 在日常使用中不可辨。
- **处理时机**：有明确视觉投诉再说；升级 Monaco 时需重新评估。
- **涉及文件**：`shell/src/style.css`、`shell/src/monaco.ts`、`docs/ui_premium_dev_plan.md §7.8.4`。

### TD-026 分屏聚焦时 per-editor 弹层/跳转类动作仍锚定主编辑器（P3，架构课题；2026-10-08 live-templates 改进批登记）

- **起因**：live-templates 改进批给 `initLiveTemplates` 补了 `attachEditor()`（分屏实例的 Tab 展开 / docstring per-editor 注册已随批修复），但 **palette（Ctrl+J）与 surround（Ctrl+Alt+T）** 仍只读主编辑器的光标与选区——分屏聚焦时触发，插入目标仍是主编辑器。
- **根因（系统性，非 live-templates 独有）**：app 级动作（`app.editor`）统一锚定主编辑器实例，没有「焦点编辑器」抽象。同病：`menuItems.ts` 的 `goto_definition`、`format_document` 等编辑器类命令在分屏聚焦时也作用于主编辑器。splitEditor.ts 是懒创建的第二实例，各域无法静态引用。
- **建议方案**：引入 `getActiveEditor(): IStandaloneCodeEditor`（焦点在分屏时返回分屏实例；可由 splitEditor 暴露 `isFocused()` + main 装配），各编辑器类命令改读该方法。涉及 ~10 处调用点与 e2e 回归，收益是分屏体验完整。
- **处理时机**：分屏功能有实际使用反馈时；当前分屏属 P4 演示级功能，优先级让位。
- **涉及文件**：`shell/src/live-templates/index.ts`（attachEditor 已修部分）、`shell/src/splitEditor.ts`、`shell/src/menuItems.ts`、`shell/src/state.ts`。

### TD-021 推送前复核遗留的低优先项（P4，5 小项；2026-09-25 全量复核引出）

- **起因**：P0~P4 六个未推送提交推送前全量复核（子代理深审 + 人工求证）。两个中等问题（终端背压队列无上限、stop/exit 提示时序）与三个低级项（session 静默失败、异常断点失败不回滚、Watches 满额静默/无令牌、resourcePanel 死代码）已随当次修复提交偿还；以下 5 小项经裁决**暂缓**。
- **① terminal.ts 背压「字节预算」实为 UTF-16 字符数**（✅ 已修 2026-10-07，维护态首件）：修法取登记中的「改存 Uint8Array」分支——新增零依赖模块 `shell/src/terminalBackpressure.ts`（push 时 `TextEncoder` 一次编码，计数 / 切分 / 丢弃 / 限流全按真实 UTF-8 字节），`terminal.ts` 只留接线。登记原提的 `Buffer.byteLength` 不可行：shell 是浏览器环境，无 Node `Buffer`。xterm v5 `write(Uint8Array)` 自带增量 UTF-8 解码，字节边界切分不乱码。
- **② session.ts `restoring` 是布尔非令牌**（❌ 裁决不处理 2026-10-07，P1-5 收口）：恢复 A 进行中切到工作区 B，A 的 `finally restoring=false` 会提前解锁，B 半恢复状态可能被防抖快照写回。场景罕见。修法：改为计数器/令牌。**收口裁决：场景罕见且维护态只受理三类事项，不立项，维持登记备查。**
- **③ sessions.rs 快照超 40 tab 保头弃尾**（✅ 已修 2026-10-07）：`truncate(MAX_TABS)` 丢的是最近打开的 tab，与「恢复最近现场」直觉相反。改保尾（`tabs.split_off(len - MAX_TABS)`），并同步活动 tab 判定：active 指向已丢弃（最旧）tab 时清掉，回落「激活最后一个」。
- **④ proc_stats 只统计直接子进程**（✅ 已修 2026-10-07）：运行链存在中间层（cmd /c、shell 包装）时孙进程内存不计入合计，芯片口径偏小。改按 parent 邻接表 BFS 收集全部后代（纯函数 `collect_descendants`，visited 防环），再映射成 ProcInfo。
- **⑤ debugWatches.ts 顶层 `load()` 读 localStorage**（✅ 已修 2026-10-07）：顶层副作用（有 try/catch 兜底）已改惰性初始化——`watches` 先置空、`ensureWatchesLoaded()` 在首次 `render()`（面板接线唯一网关）时加载，import 即不再触碰存储。
- **处理时机**：各自独立成 PR，任一项先跑对应测试矩阵（terminal → perf/01；session → session/01；debug → debug specs + 真机）。
- **涉及文件**：`shell/src/terminal.ts`、`shell/src/session.ts`、`shell/src-tauri/src/sessions.rs`、`shell/src-tauri/src/proc_stats.rs`、`shell/src/debugWatches.ts`。

## 已归档

> 处理完成的历史条目，仅保留标题与结论摘要；编号对应原 TD 编号。完整实施细节见对应 commit 历史。
> 2026-09-10：代码审查整改计划（`code_review_remediation_plan.md`，CR-01~CR-30 共 30 项）已全部完成并删除，其中与本表重叠的条目见上；其遗留的可选优化项（第 13/14 条）已于 2026-09-13 全部偿还并归档。

| 编号 | 标题 | 完成日期 | 结论摘要 |
|---|---|---|---|
| TD-027-D（probe） | D 组卫生批 probe 域七项（D9/D10/D11/D12/D13/D14/D15） | 2026-10-09 | 提交 `6349b4d`：D9 perf 抬开写 dataclasses.replace 局部副本（断言同步：内部副本抬开 + 调用方 cfg 不变）；D10 标注修 `list[list[CodeType\|int]]`；D11 normcase 两侧对齐；D12 store.py import 提顶；D13 新增 test_cli_dispatch.py 5 用例（CLI 分发层首个覆盖）；D14 注释化登记有意取舍；D15 被去重子进程 return 前 mon.stop()（RAISE 不再空转）。probe pytest 114 全绿 |
| TD-027-D（intel） | D 组卫生批 intel 域六项（D3/D4/D5/D6/D7/D8） | 2026-10-09 | 提交 `17f531b`：D3 SCHEMA 对齐 store.py（instance + perf_* 5 列）；D4 删四项零调用 API（loc/get/qualnames/qualnames_by_prefix，保留有调用方的 functions/by_location/by_file）；D5 删失效 allow 属性 + 顺手清存量 ParsedShape::keys；D6 TraceError::Missing(PathBuf)；D7 删 symbol_candidates 内部去重（dedup_sort_truncate 统一）；D8 scan_line 注释/转义感知重写（复用 scan_string_end，附 3 测试）。intel cargo test 85/85（含准确率红线）+ bench_load 1318ms/2s PASS |
| TD-027-D（shell-ts） | D 组卫生批 shell-ts 域三项（D1/D2/D17） | 2026-10-09 | 提交 `670af2d`：D1 splitEditor 三文案走 ide.split.*（**过程中 gen_domain 全量重写删掉手工登记的 ide.ws.***（T6b 批）——按流程补进数据源恢复，教训：跑 gen_domain 前必须核对目标域语言包有无数据源外词条）；D2 wireGotoTriggers 返回 onMouseDown 句柄入 lspProviders；D17 updateSyncCount 请求令牌。tsc 0 错 / vitest 1342 / e2e editor·lsp 12/12 / budget 全 PASS |
| TD-027-D（shell-rust） | D 组卫生批 shell-rust 域一项（D16） | 2026-10-09 | 提交 `1e7a7d6`：dap attach 的 take 失败 Err 路径补 kill_process_tree_async(child)（与 assemble 段防孤儿对称；实际不可达纯防御）。cargo test 340 全绿 |
| TD-027-B2 | pick_folder/pick_file 阻塞 recv（B 组） | 2026-10-09 | 提交 `b1bd5b3`：rx.recv() 移入 tauri::async_runtime::spawn_blocking——对话框挂起期间阻塞 blocking 线程池而非 tokio worker；接口签名与返回值零变化。cargo check 通过 |
| TD-027-B4 | load_config 不校验值类型（B 组） | 2026-10-09 | 提交 `1db26ce`：新增 `_matches`（get_type_hints 驱动，覆盖 int/bool/str/list[X]/X\|None，bool/int 互斥防 0/1 当开关），类型不符告警保默认值；顺手清 D12 的 config.py 部分（`__import__("sys")` 提顶部）；test_config.py 9 用例 |
| TD-027-B5 | os.chdir(old_dir) 可抛异常（B 组） | 2026-10-09 | 提交 `c23dd66`：runner finally 的 chdir 单独 try/except OSError 降级告警（进程停留当前目录），脚本原始异常必传播；test_e2e 新增删除 cwd 场景用例（启动 cwd 与脚本目录分离——Windows 不可删进程当前目录，首版测试踩坑） |
| TD-027-B6 | _cmd_check 无 timeout（B 组） | 2026-10-09 | 提交 `43a30f5`：check 子命令新增 --timeout（默认 60s），subprocess.run timeout + TimeoutExpired → 明确提示 + 退出码 2；test_check 新增 sleep 脚本超时用例 |
| TD-027-B7 | autostart 摘要无编码兜底（B 组） | 2026-10-09 | 提交 `93ad46f`：`_print_safe` per-print 降级——UnicodeEncodeError 按 stream 编码 replace 重打、流关闭（ValueError）静默；不改用户进程全局 stdio（侵入红线）。实测发现 ✓（U+2713）不在 GBK 映射，摘要行在 GBK 控制台必然触发原 bug，且 except 里再 print 会二次炸 atexit。test_autostart_print.py 5 用例（GBK 流模拟） |
| TD-027-B8 | load_summary URI 未百分号编码（B 组） | 2026-10-09 | 提交 `3f92077`：`f"file:{path}?mode=ro"` 改 `path.resolve().as_uri() + "?mode=ro"` 标准百分号编码（`#` 截断 / `%` 转义修复）；load_summary_json 复用同路径一并修复；intel trace.rs 经核实走 OpenFlags 路径直开、无同款问题。test_store 新增 `#`/`%` 目录 save→load 往返用例 |
| TD-027-A1 | db_cancel 取消检查死代码（A 组） | 2026-10-09 | 提交 `5514baf`：删「store(false) 后紧跟 load」的不可达分支与 DbOp.cancel 字段——interrupt 句柄即取消单一真值（db_cancel → interrupt() → SQLite 安全点 interrupted → map_sql_err 映射 DbCancelled:）；AtomicBool import 下移测试模块；顺手清拆分批遗留 2 处 unused import（fs_cmds/pydantic_cmds）。cargo test 340 全绿零警告 |
| TD-027-A5 | serviceTail 跨实例共享（A 组） | 2026-10-09 | 提交 `b4b439a`：模块级单变量缓冲改 `Map<实例id, string>` 分桶，多项目并行运行的就绪行缓冲互不污染；命中即弃 / closeTerminal / term-exit 自然退出 / disposeTerminal 工作区复位四路径清理（上限 512 字符/实例）。vitest 1342 全绿 |
| TD-027-A6 | 模板热重载目录判定过宽（A 组） | 2026-10-09 | 提交 `4ab4277`：`endsWith("/config")` 收紧为 `/.opencharm`、`/.opencharm/config`、`/opencharm/config` 三前缀，工作区任意 xxx/config 变更不再触发 registry 全量 rebuild。取舍：OPENCHARM_DATA_ROOT 重定向非默认路径时用户层外部编辑热重载失效（面板内保存不受影响）。lt/01 e2e 5 条全绿 |
| TD-027-A9 | didOpen languageId 恒 "python"（A 组） | 2026-10-09 | 提交 `5eb36d2`：改 `model.getLanguageId()`（Monaco 注册 id 与 LSP languageId 同源约定，零新依赖），md/json/yaml 不再全发 python；didOpenText 保留 "python"（rename 只作用 .py）。lsp/03 e2e 9 条全绿；client.ts 1848/1850 |
| TD-027-A2 | git_apply_hunk 固定 patch 路径竞态（A 组） | 2026-10-09 | 提交 `0c881b2`：patch 文件名加 nanos+pid+单调序号唯一后缀（`.opencharm-hunk-{…}.patch`），写入后无论成败清理，快速连点互踩消除（git_cmds.rs:519-560，代码内留 `TD-027 A2` 标记） |
| TD-027-A3 | 调试快捷键硬编码 threadId=1（A 组） | 2026-10-09 | 提交 `0c881b2`：F5/F10/F11/Shift+F11 改经 `currentThreadId()` 读 debugView 的 stopped 事件维护值（单一真源），menuItems.ts 菜单步进项同步改用同源（windowKeys.ts:78-87） |
| TD-027-A4 | reopenConnection 顶掉活动连接（A 组） | 2026-10-09 | 提交 `0c881b2`：重开后重拉连接列表，activeId 命中新连接即 refreshTree 完成状态迁移；conn_id 按归一化路径哈希派生、同路径 id 天然稳定无需迁移（sqliteStore.ts:239-256） |
| TD-027-A7 | scope 搜索掩码大小写失配（A 组） | 2026-10-09 | 提交 `0c881b2`：掩码正则加 `i` 标志（searchFilters.ts:90-95），`*.Py` 等大写掩码不再静默 0 结果；附回归测试 `searchFilters.test.ts`（`*.Py` 正反向用例） |
| TD-027-A8 | intel `__init__` 回退全名精确匹配（A 组） | 2026-10-09 | 提交 `0c881b2`：resolve_callee 改取 callee 末段做**段边界后缀匹配**（防 `Foo.__init__` 误中 `MyFoo.__init__`）+ (非 stale, hits) 双键裁决（completion.rs:315-346）；`mymod.Scraper(` 构造补全恢复命中，附正负回归测试 |
| TD-020 | 停止运行时探针摘要重复打印/重复落库（P3，观感/数据卫生） | 2026-09-28 | 根因坐实（Python 3.13 复现）：`argv[0]` 守卫拦不住 argv 相同的父子进程（uvicorn `--reload` fork / 子进程自重启），多进程各自触发 `atexit._finalize` → 重复打印 + 多 `runs` 行 + `hits` 翻倍。修复：后端 `run_env.rs::build_run_env` 注入每次运行唯一的 `OPENCHARM_PROBE_RUN_ID`（纯 std：纳秒时间戳 + pid + 单调序号）；探针 `autostart._finalize` 用 `os.open(O_CREAT\|O_EXCL)` 墓碑文件（键=run_id，mtime 惰性清理）保证同 run_id 只落库+打印一次，非法 run_id / OSError 保守放行。probe pytest 全绿（新增 `test_run_lock.py` 3 例 + `test_inject.py` 1 例）、shell `cargo test run_env` 20 例全绿。**取舍面（2026-10-08 TD-027/D15 补注）**：去重语义 = 首个进程胜出，同 run_id 后续进程的观测**整段丢弃**——子进程做不同工作的场景（如 worker 进程）观测丢失；且被去重的子进程不 stop 监控（全局 RAISE 持续派发到进程死，无正确性影响） |
| 12 | pyproject.toml 两条生成路径包名归一化（P4，观感） | 2026-09-15 | 收敛：`fs_cmds.rs` 新增 `normalize_project_name`（字符串行扫描，定位 `[project].name` 改写为 `sanitize_pkg_name` 结果，不引入 TOML 依赖）+ `is_name_field` 防误配同前缀键；`ensure_pyproject` uv 生成后调用；`test_normalize_project_name` 覆盖大小写/空格与 `[tool.uv]` 段不误改 |
| 17 | 全项目输入框未统一 autocomplete="off"（P4，一致性） | 2026-09-15 | `index.html` 10 处 `type=text` 输入框补 `autocomplete="off"`（tree-filter/search/env-pkg/new-project-*/settings-*/lt-search/storage-migrate-path/palette-search）；动态输入补 `settingsPanel.ts` 键位行 / `git.ts` 新分支 / `fileTree.ts` 内联重命名 / `manager.ts` 两处 text input |
| 18 | 模态点遮罩关闭不一致（P4，一致性/数据安全） | 2026-09-15 | 含可编辑内容的模态统一「点遮罩不关闭 + Esc 关闭」：`dialog.ts::openPrompt`、`settingsPanel.ts`、`newProject.ts` 三处去遮罩关闭、补 document 级 keydown（open 挂/close 移除，对齐 runConfigPanel 范式）；其余选择/确认框点遮罩=取消语义保留 |
| 19 | 操作结果反馈散用输出面板（P4，一致性） | 2026-09-15 | 消除静默失败：`settingsPanel`（intel 开关/打开日志/数据目录）、`envPanel`（设置解释器×3）、`git`（空分支名校验）、`storagePanel`（首启标记/打开目录/选目录）共 10 处 `console.*` 静默改为 `toastFail`；`saveSettingsPanel` 成功补 `toast`；输出面板保留作命令级审计 |
| 6 | 前端鲁棒性与设置单点（P3） | 2026-09-15 | ① URI 编解码跨平台 + 异常兜底：`client.ts` `fileUriToPath` 加 decodeURIComponent try/catch + 盘符检测定反斜杠、`pathToFileUri` 先转义 `%`/`#`/`?`；② 设置默认值收敛：新增零依赖 `keybindingDefaults.ts` 单一来源，`keybindings.ts` 与 `state.ts::DEFAULT_SETTINGS` 改为派生（`defaultKeybindings()`），前端两处不再手写 |
| 9 | 运行配置孤儿条目（P3，存储卫生） | 2026-09-15 | 新增 `sweep_run_configs` 命令 + `sweep_run_configs_impl`（键对应文件不存在即移除）；`set_run_config` 保存时顺带清扫，`main.ts::openWorkspace` 打开工作区时调用一次；lib.rs 注册 |
| 11 | interpreter_version 未缓存（P3，性能） | 2026-09-15 | `env_cmds.rs` 加 `VERSION_CACHE`（`LazyLock<Mutex<HashMap<String,String>>>`，路径为键），`interpreter_version` 命中缓存直接返回、空串不缓存；换解释器自然失效 |
| 16 | E4 Docstring 自动生成缺口（P3，对标缺口） | 2026-09-15 | 新增 `docstring.ts`：`registerDocstringTrigger` 监听 python `"""`+Enter，`enclosingSignature`（单行 def/class 签名，过滤 self/cls、去注解/默认值/变参、顶层逗号分割）+ `buildDocstring`（Args/Returns 或 Attributes），接入 `index.ts`；`docstring.test.ts` 7 例全绿 |
| 4 | 跨包项目哈希大小写不一致（P2，正确性） | 2026-09-15 | 两端大小写归一：`store.py::project_hash` 加 `os.path.normcase`、`file_ops.rs::project_hash` Windows 下 `to_lowercase()`（strip_verbatim_prefix 之后）；`test_store.py` 增 `test_project_hash_case_insensitive`（test_store 5 例全绿）、`file_ops.rs` 增大小写变体断言（cargo test project_hash 2 例全绿） |
| 7 | CI 自动化缺失（P1，工程） | 2026-09-15 | 新增 `.github/workflows/ci.yml`：test job（windows-latest）跑 4 矩阵（前端 vitest+tsc / probe pytest / intel cargo test / shell cargo test），package-smoke job（打包 NSIS + bench 红线，workflow_dispatch 手动）；`bench/collect-metrics.ps1` 末尾把冷启动/内存红线纳入非零退出断言 |
| 15 | 位置轴块头冒号误判续行（P2，正确性） | 2026-09-15 | `scope.ts` 从 `CONT_SUFFIX_RE` 移除 `:`，新增 `isBlockHeaderColon`（单行块头 + 跨行签名 `):`/`]:`）区分块头/续行冒号；`scope.test.ts` 增 4 例（块头后首行 / 跨行签名 / 空行 / 字典值冒号）并同步修订稿 §1.1/§8.2；vitest 11 例全绿 |
| 10 | stdin 重定向文件存绝对路径（P3，可移植性） | 2026-09-15 | 随 v3.4 运行迁移删除 stdin 配置体系（`StdinConfig` / `run_script` 删净），该债连同功能一并消除 |
| 1 | intel 补全/跳转/hover/type_infer 全量线性扫描（P2，性能） | 2026-09-10 | 已并入 CR-17 实施：索引层预建 `by_last_segment` / `by_second_last_segment` / `by_type_label` 倒排，7 处消费端全量扫描改索引查询 + shape 解析请求级缓存；intel `cargo test` 44 例全绿（含准确率红线） |
| 2 | intel server.rs 锁 poison 与 async 持锁（P2） | 2026-09-10 | 已并入 CR-18 实施：改 `parking_lot::RwLock`（无中毒）+ `Arc` 快照锁外重计算 + 补全/hover/definition/inlay/诊断全部 `spawn_blocking` |
| 5 | probe 打包/注入健壮性（P2） | 2026-09-10 | 已并入 CR-19 实施：hatch `force-include` 打包 `sitecustomize.py`（wheel 验证）；`mon.start()` 纳入 try/finally 恢复现场；argv[0] 守卫 `normcase` 归一化；probe `pytest` 63 例全绿 |
| 3 | intel did_change 依赖全量同步契约（P2） | 2026-09-09 | 已并入 CR-02 实施：`ServerCapabilities` 显式声明 `TextDocumentSyncKind::FULL`，intel `cargo test` 全绿 |
| 14 | main.ts 运行态收敛为 RunState 与按域拆分（P3，质量） | 2026-09-13 | ① 运行态 6 变量（running/runningPath/runChannel/runningStdinMode/runningStdinEofHinted/selectionRunMeta）+ runningProfile 收敛为 `runState.ts` 的 `RunState` 判别联合（零依赖 + accessors，整组置位/整组作废，杜绝半复位态）；② 按域拆出 `runFlow.ts`（运行核心 ~1030 行）/ `envPanel.ts`（621）/ `runConfigPanel.ts`（351）/ `menuBar.ts`（286）/ `newProject.ts`（223）/ `tracebackLink.ts`（37），main.ts 由 ~3169 降至 1620 行；解环用 handler 注入（`setRunFlowHandlers` / `initEnvPanel{restartEngine}` / `wireNewProject` / `wireMenuBar(getMenuItems)` / `setTracebackOpenFile`），顺带解除 TD-13 的 `git.ts → main.ts` 边。基线：tsc 0 错、vitest 287 passed（新增 `runState` 13 例） |
| 13 | 前端剩余循环 import 边（P3，架构，源自 CR-25 余量） | 2026-09-13 | 沿 handler 注入先例解尽剩余两条边：`fileTree.ts`（`openFile` / `renderTabs` / `closeTabSilent` / `insertHeaderTemplate`）与 `settingsPanel.ts`（`startLsp`）改经 `setFileTreeHandlers` / `setSettingsPanelHandlers` 注入，`shell/src` 下已无 `from "./main"` 反向 import（fileTree 的 `Tab` 类型改从零依赖 `state.ts` 取）；接线统一置于 main `init` 首部（与 TD-14 注入同处）。基线：tsc 0 错、vitest 287 passed |
| 8 | 终端与运行按钮的环境注入不一致（S3+S4 公共前置） | 2026-09-09 | 抽 `run_env.rs` 单一装配来源（`build_run_env` / `assemble` / `resolve_run_command`），`cargo test` 72 例全绿；两条运行路径 env 逐项同源 |
| TD-009 | 全项目代码检查与修复（P0/P1 项，共 11 项） | 2026-08-28 | probe/intel/shell 修复全绿；含 Cargo.lock 纳入版本锁定 |
| TD-008 | 确认弹窗统一为自绘风格 | 2026-08-28 | 新增 `dialog.ts`，替换 8 处 confirm + 1 处 alert |
| TD-007 | main.ts 功能域级拆分（文件树/Git/终端/设置面板） | 2026-08-25 | 抽 `state.ts` + 4 域模块，main.ts 由 ~3119 降至 ~1196 行 |
| TD-006 | 上帝文件 main.ts 拆分（第一步）+ LSP/终端补单测 | 2026-08-25 | 抽 10 个纯函数到 `util.ts` + 7 个单测 |
| TD-005 | panic unwrap 与进程收尾收敛 | 2026-08-25 | 新增 `unpoison` + kill 后 `wait` 收尾 |
| TD-004 | intel 能力声明与索引加载修正 | 2026-08-25 | 删除未实现的 references 声明 + 索引 `spawn_blocking` 加载 + tokio 精简 |
| TD-003 | Rust 侧重复实现收敛（opencharm_home / no_window） | 2026-08-25 | 抽 `util.rs` 统一实现，四处改 import 复用 |
| TD-002 | Git 集成增强（行内 diff / 远程 / 状态刷新性能） | 2026-08-25 | 新增 9 个命令 + diff 视图 + 增量刷新 |
| TD-001 | 侧栏视图独立化（视图注册表 + Activity Bar） | 2026-08-25 | 视图注册表 + Activity Bar + OUTLINE 并入文件视图 |