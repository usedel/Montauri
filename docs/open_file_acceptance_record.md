# 单文件打开 + Markdown 预览模式 验收记录

日期：2026-10-08（2026-10-09 修订：补欢迎页遮挡修复；2026-10-10 修订：启动恢复终态 + argv 启动文件）
计划真源：`docs/open_file_dev_plan.md`（v1.0）

## 交付范围

| 项 | 内容 |
|---|---|
| 批 1 Rust | `fs_cmds::find_project_root`（py 向上探测 pyproject.toml/setup.py/.venv/venv，md 找 .git，深度上限 4，未命中回退文件目录；7 单测）+ `workspace_has_python`（`*.py` 掩码走查首个命中早退，async + spawn_blocking） |
| 批 1 TS | `openFileEntry.ts` 域（pick_file → 探测 → openWorkspace → openFile，handlers 注入解环）；入口三处：欢迎页按钮（`#ew-open-file`）、文件菜单「打开文件…」、命令面板同款 |
| 批 1 LSP | `startLsp` 前置 `shouldStartStaticEngine`：无 py 工作区跳过静态引擎 spawn，状态栏 `LSP: 无 Python 文件（已跳过）`；watcher 发现新增 .py 后补启动（`lspSkippedForNoPy` 带 root 校验防跨工作区误触发） |
| 批 2 设置 | `markdown_open_mode`（preview/edit/split，默认 preview）：TS `state.ts` + Rust `settings.rs` 同步（默认值 + 旧配置回落双断言）、设置面板「编辑器 → Markdown」组下拉、搜索 haystack 两处 |
| 批 2 预览 Tab | `mdPreviewTab.ts` 域：kind="md"、`mdpreview:` 前缀、`#md-preview-tab-panel` 宿主（照 db-tab 范式，与 diff/db 三方互斥 dismiss）、激活重读重渲染（外部修改可见）、渲染层复用 `markdownPreview` 纯函数 + `highlightCodeBlocks`（导出复用）；main 的 activateTab/closeTabSilent/renderTabs/closeTab 四处加分支 |
| 批 2 交互 | md 文件树单击 = 预览、双击 = 提升编辑（`closePreviewTabIfExists` + `mdMode:"edit"`）；预览工具栏「编辑源码」按钮（`promoteToEdit`）；`OpenFileOptions.mdMode` 选项 |
| 批 2 样式 | `#md-preview-tab-panel` 宿主 + 工具栏 + `.md-preview-tab-body`（排版规则经 `:is(#md-preview, .md-preview-tab-body)` 与分栏预览共用同一组，零复制） |
| 批 3 e2e | `e2e/p4/01-open-file.spec.ts` 7 用例；tauri-mock 补 `__E2E_OPENFILE__` 控制面（find_project_root / workspace_has_python / pick_file 三通道） |

## 验收结果（2026-10-08）

| 门禁 | 结果 |
|---|---|
| `cargo check` | 通过 |
| `cargo test find_project_root` | 7/7 |
| `cargo test settings` | 3/3（markdown_open_mode 默认值 + 回落断言） |
| `npm run build`（tsc + vite） | 通过 |
| 全量 vitest | 105 文件 / 1313 用例全绿 |
| e2e-ui 视觉关键子集 | 66/66（4.6m） |
| 新 spec `p4/01-open-file.spec.ts` | 10/10（OF-1 欢迎页入口 / OF-2 单击预览 / OF-3 双击提升 / OF-4 编辑源码 / OF-5 LSP 跳过 + OF-5b 对照 / OF-6 设置分流 / OF-7 欢迎页遮挡回归 / OF-8 编辑切预览入口 / OF-9 右上角三按钮） |

## 验收结果（2026-10-10 增补：启动恢复终态 + argv 启动文件）

| 门禁 | 结果 |
|---|---|
| `cargo check` / `cargo test fs_cmds` | 通过 / 18/18 |
| `npm run build`（tsc + vite） | 通过 |
| 全量 vitest | 109 文件 / 1342 用例全绿 |
| e2e-ui 视觉关键子集 | 66/66（4.7m） |
| 新 spec `p4/02-startup-restore.spec.ts` | 6/6（SR-1 关闭工作区写 open=false / SR-2 终态 false 不恢复 / SR-3 终态 true 恢复+刷新 / SR-4 无终态回落 recents / SR-5 用户主动打开写终态 / SR-6 argv 双击文件优先） |
| 既有 spec `p4/01-open-file.spec.ts` 回归 | 10/10 |
| 预算门禁 | 全 PASS（main.ts 2371/2400；startupRestore.ts 87/130 新登记；命令面 203/205 显式调整） |

## 过程发现并修复的问题

1. **Rust `detect_project_root_impl` 回退值 bug（单测抓出）**：循环 `pop` 已把 `dir` 弹到根，未命中标记时回退用了弹完的 `dir`（返回盘根而非文件目录）——修复为记住进入循环前的父目录作回退值。3 个用例先红后绿，验证了「纯逻辑内核 + 注入 dir_exists」的可测性设计。
2. **promoteToEdit 死循环（e2e OF-4 抓出）**：「编辑源码」按钮的 `openFile` 未带 `mdMode:"edit"`，在 `markdown_open_mode=preview` 设置下又被分流回预览 Tab（预览关了又开）。修复：main 注入 handler 时绑定 `mdMode:"edit"`。教训：**凡「显式意图」入口调 openFile 都必须带 mdMode 覆盖，不能依赖设置默认值**。
3. **force 欢迎页被宿主浮层遮挡（用户真机反馈，2026-10-09 修复）**：md 预览激活时「帮助→欢迎页」不显示。根因是**层级冲突**：`#editor-overlay`（z-index:5）低于 diff/db/md 三种宿主浮层（均 z-index:20），force 态 overlay 显示了却被整个盖住。**该 bug 并非 md 预览独有——db Tab / diff Tab 激活时同样遮挡（存量问题，此前无入口暴露）**。修复：`updateEditorOverlay` 里 force 态给 overlay 加 `.forced` 类（z-index:30），解除时移除；`#ew-force-close` 关闭或任一动作按钮点击后经 `updateEditorOverlay` 自然还原。回归用例 OF-7 覆盖「预览激活 → force 欢迎页可见 → 关闭还原预览」全链路。
4. **编辑 tab 无切回预览的入口（用户反馈，2026-10-09 补齐）**：md 处于编辑 tab 时，文件树单击命中「已有编辑 tab → 激活」守卫、右键「打开预览」/Ctrl+Shift+V 开的是分栏预览——没有纯预览 Tab 入口。补两处：tab 右键「切换到预览模式」+ 命令面板同款命令。语义：**开预览 Tab 并激活，编辑 Tab 保留后台（dirty 草稿不丢，点回即编辑）**。同时 `presentMdPreviewTab` 内容来源升级：有同名编辑 tab 时取**内存 model 值**（含未保存草稿，对齐 VSCode「预览缓冲区」语义，samePath 归一比较），否则读磁盘。回归用例 OF-8。
5. **命名体系统一「分栏预览 / 预览模式」+ 右上角三按钮（用户裁决，2026-10-09）**：原「打开 Markdown 预览」按钮实为分栏，文案误导。全量改名（zh+en 双语 11 词条）：分栏预览（按钮 tooltip/tab 右键/文件树右键/命令面板/视图菜单/引导条）+ 预览模式（纯预览 Tab，与 tab 右键/命令面板/新按钮同词）。右上角升级为三按钮：`分栏预览`(split-horizontal) / `预览模式`(open-preview) / `导出 HTML`(download)，编辑态显示、预览 Tab 激活时隐藏。连带影响：「新手指南」在默认 preview 模式下直接开预览 Tab（阅读场景体验更好），OG-1 用例断言已更新。回归用例 OF-9；快捷键按裁决暂不加（观察使用频率）。
6. **启动恢复终态 + argv 启动文件（用户报告双 bug，2026-10-10 修复）**：
   - bug 1「关闭所有工作区后退出，重启仍自动恢复最后一次工作区」：根因是启动恢复盲取 `recents[0]`——`recent-workspaces.json` 是「历史列表」不是「上次终态」。修复：新增 `<data_root>/config/last-session.json`（`{open: bool, workspace?: string}`），`openWorkspace` 末尾记 `(true, root)`、`closeWorkspace` 末尾记 `(false, null)`；启动读终态决策（`open=false` → 欢迎页；文件不存在 → 回落 recents，旧版本行为向后兼容；目录已删 → Rust 侧置 `open=false`）。
   - bug 2「双击关联 md 文件却打开上次工作区」：根因是 `lib.rs` 从不读 argv——双击传入的文件路径被丢弃，启动径直走恢复路径。修复：新增 `get_startup_file`（argv 第一个「存在的文件」路径，`is_file` 判定天然滤过 flag 参数），启动优先级 = **项目窗口（get_window_project，窗口级信号）> argv 双击文件（进程级信号）> 恢复最近**。argv 必须排在项目窗口之后：`open_workspace_window` 新开的项目窗口与主窗口同进程，argv 优先会劫持新窗口；主窗口 label="main" 不在 WINDOW_PROJECTS 映射里，天然落到 argv 分支。argv 文件走 `openSingleFile`（探测根 → openWorkspace → 定位文件，与欢迎页「打开文件」按钮同链路）。
   - 落点：Rust `fs_cmds.rs` 三命令（`get/set_last_session` + `get_startup_file`）；TS 新模块 `startupRestore.ts`（87 行，决策与编排；动作经 handlers 注入解环）；`main.ts` 只留两个 `setLastSession` 调用点。
   - 已知边界（未做，独立决策）：单实例（second instance 转发 argv 给已开进程）与 NSIS 文件关联注册——当前双击会新起进程；文件关联本身是用户手动配置的（计划 §4 明确不做），本次只保证「关联后双击能正确打开该文件」。

## 交付增补（2026-10-10 下午：单实例 + 启动路由，方案 A）

用户裁决后追加的两个场景（「有打开的工作区时开新实例可以，但工作区已打开/文件在其内时不得重复开实例」）：

| 项 | 内容 |
|---|---|
| 依赖 | `tauri-plugin-single-instance =2.4.1`（**精确钉版**：2.5.x 要求 tauri ^2.12，与锁定基线 2.11.5 冲突；已登记 ci/versions.toml） |
| Rust 路由 | `window_mgr::route_second_instance`：argv 提取（`extract_startup_file` 共享纯函数，**排除 exe 自身**）→ 查 `WINDOW_PROJECTS`（含主窗口上报条目）按**路径前缀包含**（`is_under`：小写+`/`归一，`D:\project-x` 不误命中 `D:\proj`）找文件所属窗口 → 命中：`set_focus` + `emit_to` 定向 `startup-file`；未命中：`find_project_root` 探测 → `open_workspace_window`（同进程新窗口，去重内建）+ pending 槽透传初始文件（开窗失败清槽防泄漏） |
| Rust 命令 | `report_main_workspace`（**label="main" 守卫**：项目窗口的 openWorkspace 也走 main.ts 上报调用，不守卫会污染主窗口条目）+ `take_startup_file`（take 即清） |
| 前端 | `startupRestore.ts`：`wireStartupFileEvent` 监听 `startup-file`（命中已开工作区 → 直接 openFile 不走探测链）；`openInitialWorkspace` 优先级 = 项目窗口 > argv > pending > 恢复最近，**项目窗口分支链式下落**（路由开的新项目窗口既命中 get_window_project 又有 pending 文件，两步都要走） |
| 真机验收 | `shell/e2e-real/single-instance-real.cjs`（CDP 9231，第二实例 spawn 裸 dev exe 不带 CDP env）：**8/8 PASS**——SI-1 无参拦截退出 / SI-2 命中工作区聚焦+开文件不新窗（用户场景 2）/ SI-3 外部文件路由开新项目窗口+pending 打开（用户场景 1 的兜底路径） |

**真机抓出的三个 bug（浏览器层测不到，均已修）**：
1. **argv 含 exe 自身路径**（插件转发完整 argv）：`extract_startup_file` 未排除 argv[0] → 路由把 exe 当启动文件 → 按 exe 所在仓库开窗（SI-2c 开了多余窗口、SI-3b 被污染）。修复：`same_file::is_same_file` 排除 current_exe。
2. **`win.emit` 是广播**：多窗口下所有窗口都会打开该文件，违反项目「禁全局 emit」纪律。修复：`app.emit_to(&label, ...)` 定向。
3. **pending 被项目窗口分支挡住**：路由开的新项目窗口 `get_window_project` 命中后 return，pending 文件永远取不到（SI-3c tab 空）。修复：项目窗口分支不 return，链式下落到 pending 查询。

**提交前深审抓出的两个 bug（子代理复核 + 主线验证，均已修）**：
4. **last-session 多窗口污染（P0）**：`set_last_session` 无窗口守卫——项目窗口的 openWorkspace/closeWorkspace 同样写 `last-session.json`（主窗口开 A、项目窗口开 B → 终态变 B，重启后主窗口恢复错工作区；项目窗口里「关闭工作区」→ 终态 open=false，主窗口开着 A 重启后不恢复）。修复：Rust 侧命令注入 `window` 参数加 label="main" 守卫（与 report_main_workspace 对称——该守卫的存在本身就是这个不对称缺陷的证据）。
5. **startup-file 事件早于 listen 注册丢失**：项目窗口从 build 到前端 init 注册 listen 有 1-3s 窗口期，期间第二实例转发的 emit 无声丢失（用户「双击 A → 立刻双击同项目 B」，B 不打开且无提示）。修复：**双通道投递**——命中分支同时写 pending 槽（备份），前端 listen 回调先清槽防重复，`openInitialWorkspace` 末尾的 take 兜底补投递（listen 注册前积压的经此通道到达）。

**遗留边界**：dev 与安装版共用 identifier 互斥（同时跑两个调试版会互拦）；第二实例的 argv 多文件只取第一个。均为独立决策，未纳入本批。

## 设计要点（复核快照）

- **方案 B+C 零架构侵入**：单文件打开完全复用 `openWorkspace` 全链路（LSP/运行/调试/git/会话/watcher），未动 32 处「无工作区守卫」中的任何一处；md 预览图片依赖的 `allow_asset_dir` 授权随工作区打开自然生效（方案 A 会裂图的根本原因已规避）。
- **预览 Tab 与 diff/db 同范式**：`mdpreview:` 虚拟路径前缀使 session 快照（只收 kind="file"）/ run gutter / quickopen 按路径工作的逻辑天然不误伤；三方宿主互斥在 activateTab 的 dismiss 链收口。
- **分栏预览与预览 Tab 共存**：`updatePreviewVisibility` 排除 kind="md"（预览套预览防线）；CSS 排版 `:is()` 组合选择器，分栏与 Tab 共用一套 30+ 条规则。
- **LSP 跳过保守取向**：探测失败 = 照常启动（宁可空转不丢功能）；watcher 后补启动只对「本工作区曾被跳过」生效。

## 遗留与边界（计划 §4 维持）

- 文件拖拽进窗口、NSIS 文件关联：独立产品决策，未纳入。（2026-10-10 补：argv 启动文件 + 单实例路由已交付——用户手动配置关联后双击可正确打开且不重复开实例；NSIS 关联注册本身仍未做。）
- 预览 Tab 不入会话快照（重启回编辑模式，diff tab 同款边界）。
- 非py/md 文件（txt 等）照常编辑模式打开，无预览。
