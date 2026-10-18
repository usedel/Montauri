# Montauri 界面设计改进计划

> 版本：v2.1 · 日期：2026-09-11 · 状态：**全部完成（30/30 + 遗留 2 项）**——第一至十批已交付：P0 缺陷 5 项、一致性小改动 7 项、UI-08 按钮体系 + UI-18 scale token、UI-09/11/12、UI-15/17、UI-16 ARIA 语义、UI-19/21/22/27 视觉层次与信息密度、UI-23/24/25/26 响应式边缘情况与细节打磨、UI-29 字号/字体族接入用户设置 + UI-30 菜单 ARIA 与键盘导航（第九批）；第八批登记的两条清单外存量缺口（表单 label 无 for/id 关联、`#bottom` 分隔条内联 height 压过折叠态）已在第十批一并修掉。见 §7 进度记录。
> 来源：基于 `shell/src`（`index.html` / `style.css` / `main.ts` / `layout.ts` / `debugView.ts` / `settingsPanel.ts` / `termUi.ts` / `search.ts` / `dialog.ts` / `util.ts` / `engineChip.ts` / `runWidget.ts` / `fileTree.ts` / `tooltip.ts` / `anim.ts`）的全量 UI 代码审阅。
> 本文档是后续 UI 改进排期与验收的唯一依据；与 `python_ide_dev_plan_v2.md` 冲突时以开发计划为准并反馈修订本文档。
> ⚠ **后续修订（2026-10-02）**：本文档确立的 D4「青绿 = 品牌识别 / 蓝 `--accent` = 功能交互」双色分工已被 [ADR-0005](adr/0005-brand-accent-unification.md) 推翻（青绿成为唯一色相轴）。本文档的**已完成状态与 UI-01–UI-30 验收结论不受影响**，仅"品牌/交互色分工"这一条口径以 ADR-0005 为准；后续视觉改造见 `docs/ui_premium_design_report.md`（**v1.3**，六批已全部落地，实施记录见 `docs/ui_premium_dev_plan.md` v1.2）。
> 涉及范围仅限 `shell/`（Tauri 2 + Monaco 外壳前端），不触及 `probe/`、`intel/` 的架构第一原则（独立进程/包，不依赖外壳内部 API）。

## 1. 背景与目标

外壳 UI 已经过 D1-D4 多轮设计迭代，具备：设计 token 化（`style.css` 顶部语义变量）、双主题（深/浅，`[data-theme="light"]` 覆盖层）、动效系统（`--motion` 倍率 + `prefers-reduced-motion`）、Activity Bar + 单根视图切换（TD-001）、自绘 tooltip / 消息框（TD-008）等基础。

本轮审阅在此基础上识别出 **28 项**具体可验证的缺陷与一致性问题（实施过程中又发现 2 项，追加为 UI-29 / UI-30，故现共 **30 项**），目标是：

1. 修复明确的功能性/无障碍缺陷（P0）；
2. 收敛设计系统层面的不一致（P1），把散落的样式模式抽象成可复用体系；
3. 补齐浅色主题适配与 ARIA 语义（P2）；
4. 优化视觉层次与信息密度（P3）；
5. 处理窄窗口/边缘情况（P4）；
6. 细节打磨（P5）。

**约束**：所有改动须遵守 `style.css` 既有规则——"一切色值走语义变量，新增样式禁止引入裸色值"；`main.ts` 现约 2811 行（TD-014 登记为待拆分技术债；v1.0 审阅时为 2777 行，五批改动净增约 34 行，全部是属性替换与说明性注释，**未新增任何逻辑**，符合本约束），本轮改动**不得**继续往 `main.ts` 堆逻辑，涉及新交互的应优先落到对应功能域模块（参照 TD-007 的域拆分模式）。

> 遵守情况：新增的 `focusTrap.ts`（第一批）是独立模块；UI-09 的 tooltip 判定规则沉淀在 `tooltip.ts` 头部；
> UI-11 的终端动效钩子落在 `terminal.ts` / `termUi.ts`；UI-12 的空态复用 `util.ts::emptyState`；
> UI-15 / UI-17 全部在 `style.css` 的 token 层。前五批均未向 `main.ts` 引入新函数或新状态；
> 第六批（UI-16）在 `main.ts` 的改动全部是**既有函数的就地扩展**（`renderTabs` 补 tabs 语义、
> outline-header / search-case 既有接线补键盘与 aria 同步），未新增功能域函数、未新增模块级状态。
> 第七批（UI-19/21/22/27）主体在 `style.css` 与 `index.html`；UI-22 的拖拽交互落在既有布局域 `layout.ts`
> （复用 `startDrag`/持久化，未碰 `main.ts`）；`main.ts` 仅解释器芯片一处就地扩展（既有 click 接线旁补 keydown 激活），
> 未新增功能域函数、未新增模块级状态。
> 第八批（UI-23/24/25/26）新增两个独立模块 `welcomeShortcuts.ts`（UI-25 欢迎页快捷键渲染）与
> `themePicker.ts`（UI-26 主题预览色卡）；UI-23 的动态拖拽上限落在既有 `layout.ts`；UI-24 全在 `style.css` +
> `settingsPanel.ts` 内既有的接线函数。`main.ts` 只有 3 行接线（1 行 import、init 首个 await 前与
> `updateEditorOverlay` 各调一次 `renderWelcomeShortcuts()`），未新增功能域函数、未新增模块级状态。
> 第九批（UI-29/30）新增独立模块 `menuKeys.ts`（两套菜单渲染器共享的 APG 键盘导航）；UI-29 全部是
> 既有模块的就地扩展（`terminal.ts` / `termUi.ts` / `settingsPanel.ts` / 两个 devtools）；UI-30 在 `menu.ts`
> 与 `main.ts` 菜单栏渲染器（该渲染器按 menu.ts 头部分工说明**本就刻意留在 main.ts**）的既有函数内就地补
> ARIA 属性与接线，`main.ts` 未新增功能域函数，唯一新增模块级状态是 `submenuResolvers`（WeakMap，
> 键盘 → 键展开子菜单时取解析器用，随元素销毁自动回收）。
> 第十批（两条清单外遗留）未触碰 `main.ts`：label 关联全在 `index.html` / `settingsPanel.ts` / `manager.ts`，
> `--bottom-h` 改造全在 `style.css` / `layout.ts`。

## 2. 优先级定义

| 级别 | 含义 | 处理时机 |
|---|---|---|
| P0 | 明确缺陷/Bug，影响功能正确性或基本可用性 | 立即，可合并为一个独立 PR |
| P1 | 设计系统一致性问题，影响整体"精致感"与可维护性 | 第二批，建议按子主题（颜色语义/按钮体系/Tooltip/焦点/动效/空状态/文案）分多个小 PR |
| P2 | 可访问性与主题适配缺口 | 第三批 |
| P3 | 视觉层次与信息密度优化 | 第四批 |
| P4 | 响应式与边缘情况 | 第五批 |
| P5 | 细节打磨 | 可并入任意批次顺带处理 |

## 3. 任务总览

| 编号 | 优先级 | 标题 | 涉及文件 | 工作量 |
|---|---|---|---|---|
| UI-01 | P0 | 最大化按钮图标被 JS 覆盖为 Unicode 字符 | `shell/index.html`、`shell/src/main.ts` | 极小 |
| UI-02 | P0 | `surround-modal` 缺少关闭按钮 | `shell/index.html`、`shell/src/live-templates/ui/*` | 小 |
| UI-03 | P0 | 设置面板 label 列固定宽度 + nowrap 导致长标签溢出 | `shell/src/style.css`、`shell/index.html` | 小 |
| UI-04 | P0 | 欢迎页 flex 居中 + overflow 导致顶部内容滚不到 | `shell/src/style.css` | 小 |
| UI-05 | P0 | 模态框缺少焦点陷阱（focus trap） | `shell/src/dialog.ts`、`shell/src/settingsPanel.ts`、`shell/src/main.ts` | 中 |
| UI-06 | P1 | devtools tab 激活态用 `--accent`，与全局 `--brand` 激活态语义不一致 | `shell/src/style.css` | 极小 |
| UI-07 | P1 | JSONPath 选中行用实心 `--accent`，与其它列表选中态（soft/faint）不一致 | `shell/src/style.css` | 极小 |
| UI-08 | P1 | 按钮样式碎片化（10+ 套并列变体），需收敛为统一 Button 体系 **【已完成：`.btn` 25 条规则 + 58/87 个 button 纳入体系，29 个特定组件按裁决排除，见 §7】** | `shell/src/style.css`、多处 `.ts`/`index.html` | 大 |
| UI-09 | P1 | Tooltip 双轨制：原生 `title` 与自绘 `data-tip` 长期并存 **【已完成：确立五条判定规则并沉淀到 `tooltip.ts` 头部；因发现「禁用控件收不到鼠标事件」这一硬约束，可禁用按钮按规则保留原生 `title`，见 §7】** | `shell/index.html`、`shell/src/*.ts`、`shell/src/tooltip.ts` | 中 |
| UI-10 | P1 | `.tree-item:focus` 用 `:focus` 而非 `:focus-visible`，鼠标点击也显示焦点框 | `shell/src/style.css` | 极小 |
| UI-11 | P1 | 动效系统只覆盖结构性动画，大量微交互 transition 未走 `--motion` **【已完成：CSS 8 处硬编码时长清零；范围外扩到 `--motion` 管不到的三处——vendored codicon 旋转、Monaco 光标闪烁、xterm 光标闪烁，见 §7】** | `shell/src/style.css`、`settingsPanel.ts`、`terminal.ts`、`termUi.ts`、`git.ts`、`devtools/*` | 中 |
| UI-12 | P1 | 空状态组件 `emptyState()` 未推广到调试面板/终端面板；`.env-empty` 被跨域复用 **【已完成：调试侧栏 3 处 + 终端兜底空态；`.env-empty`→`.hint-text`、`.debug-empty` 删除，见 §7】** | `shell/src/debugView.ts`、`shell/src/termUi.ts`、`shell/src/search.ts`、`shell/src/main.ts`、`shell/src/style.css` | 中 |
| UI-13 | P1 | 分组标题中英文混用 + `text-transform: uppercase` 对中文无效 | `shell/src/style.css`、`shell/src/debugView.ts`、`shell/index.html` | 小 |
| UI-14 | P1 | Git 工具栏按钮文案中英混排 | `shell/index.html` | 极小 |
| UI-15 | P2 | 浅色主题下调试面板/JSONPath 语法色未适配，对比度存疑；`--warning` 变量名笔误 **【已完成：新增 12 个 token（7 语法色 + 5 调试装饰色），浅色取值全部经 WCAG 相对亮度公式核算；裸色值清零；另发现并修掉浅色 `--warn` 自身不达标，见 §7】** | `shell/src/style.css` | 中 |
| UI-16 | P2 | 自定义 tree/tab/dialog/tooltip 缺少 ARIA 语义 **【已完成：四类模式全部补齐（tree 1 组 / tabs 6 组 tablist / dialog 8 个模态 / tooltip 关联生命周期），第四批登记的三项待办全部落地，见 §7】** | `shell/src/fileTree.ts`、`shell/src/main.ts`、`shell/src/dialog.ts`、`shell/src/tooltip.ts`、`shell/index.html` | 大 |
| UI-17 | P2 | 10px 字号用于多个信息密度较高的场景 **【已完成：删除 `--text-2xs` 过渡档，6 处用点全部提到 `--text-xs`（11px），逐一核实无溢出风险；style.css 158 处 font-size 现全部走 token，见 §7】** | `shell/src/style.css`、`shell/index.html` | 小 |
| UI-18 | P2 | 字号/间距/圆角缺乏系统化 scale token **【已完成，见 §7】** | `shell/src/style.css` | 中-大 |
| UI-19 | P3 | 标题栏（menubar）承载异质功能过多，缺乏视觉分区 **【已完成：菜单区│动作区、设置区│窗口控制区各加 1px×16px 细分隔线 `.menubar-sep`；动作区│右侧系统区由既有 `.spacer` 弹性间距分隔（不在弹性空隙放孤立实线），见 §7】** | `shell/index.html`、`shell/src/style.css` | 小 |
| UI-20 | P3 | 右键菜单 hover 用实心饱和蓝，比其它列表 hover 重 | `shell/src/style.css` | 极小 |
| UI-21 | P3 | 状态栏窄窗口下溢出风险，无响应式处理 **【已完成：`#statusbar` 加 `overflow:hidden` 兜底 + 各项 `min-width:0` 弹性截断 + `#status-git`/`#status-lsp` 补 `max-width`+ellipsis；新增 style.css 首条 `@media (max-width:900px)` 隐藏字号芯片，见 §7】** | `shell/src/style.css`、`shell/index.html` | 小 |
| UI-22 | P3 | 文件树与大纲高度分配硬编码 40%，不可拖拽调整 **【已完成：`#view-files` 内插 `#outline-splitter`（复用 `.splitter-row` + `layout.ts::startDrag`/持久化）；高度写自定义属性 `--outline-h`/`--outline-max` 而非内联 `height`（保折叠态 `.collapsed{height:auto}` 可覆盖），默认逐字保持改动前「内容高+上限40%」，双击重置、刷新保持，见 §7】** | `shell/src/style.css`、`shell/src/layout.ts`、`shell/index.html` | 中 |
| UI-23 | P4 | 无最小窗口宽度约束，三栏布局可能把编辑器挤没 **【已完成：计划前提有误——Tauri 侧 `min_inner_size(800,600)` 原已存在（在 `lib.rs` 手动建窗处，不在 `tauri.conf.json`）；真正的缺陷是两侧面板 `flex:none` + `#center{min-width:0}`，800px 窗口下默认宽度就能把编辑区压到 160px、面板拖到最大能压到 0。现补三栏宽度下限体系 + 拖拽上限动态收口，见 §7】** | `shell/src-tauri/src/lib.rs`（窗口在此手动构建）、`shell/src/style.css`、`shell/src/layout.ts` | 小 |
| UI-24 | P4 | 设置面板在极窄窗口下导航列固定 170px，内容区局促 **【已完成：新增 `@media (max-width:720px)` 把竖排导航转为横向滚动 tab 条（断点值按「表单区 ≥420px」反推，非拍脑袋），`aria-orientation` 随排布方向同步，见 §7】** | `shell/src/style.css`、`shell/src/settingsPanel.ts` | 小 |
| UI-25 | P5 | 欢迎页快捷键网格硬编码，不跟随用户自定义键位 **【已完成：新增 `welcomeShortcuts.ts` 动态渲染 + `keybindings.ts::bindingChord` 分段工具；init 首个 await 前先画一次防首屏露空，见 §7】** | `shell/index.html`、`shell/src/welcomeShortcuts.ts`（新增）、`shell/src/keybindings.ts`、`shell/src/main.ts`、`shell/src/settingsPanel.ts` | 小 |
| UI-26 | P5 | 主题选择下拉没有视觉预览色卡 **【已完成：原生 `<select>` 换自绘 radiogroup（深/浅各一张迷你预览卡），色值登记为 8 个 `--theme-pv-*` token（固定不随主题变），新增 `themePicker.ts`，见 §7】** | `shell/index.html`、`shell/src/themePicker.ts`（新增）、`shell/src/settingsPanel.ts`、`shell/src/style.css` | 小 |
| UI-27 | P5 | 运行组/调试按钮与窗口控制按钮之间缺少视觉呼吸感 **【已完成：与 UI-19 合并——动作区│右侧系统区由 `.spacer` 弹性间距分隔，设置│窗口控制加 `.menubar-sep`，见 §7】** | `shell/src/style.css`、`shell/index.html` | 极小 |
| UI-28 | P5 | `.debug-var-row` 硬编码字体栈，未走 `--mono` token | `shell/src/style.css` | 极小 |
| UI-29 | P2 | **（第五批新增）** 终端与 devtools 预览器硬编码字号/字体族，不跟随用户设置 **【已完成：终端构造时读设置 + `applyFontPreference()`/`refreshTerminalFonts()` 运行时刷新（含 refit + PTY resize）；两个 devtools 预览器沿用「挂载时读一次」既定裁决，见 §7 第九批】** | `shell/src/terminal.ts`、`shell/src/devtools/jsonpath/index.ts`、`shell/src/devtools/curl2python/index.ts` | 小 |
| UI-30 | P2 | **（第六批新增）** 弹出菜单缺 ARIA 语义与键盘导航：`#ctx-menu` / `#menu-dropdown` / `#menu-submenu` 无 `role="menu"`/`"menuitem"`，菜单项无 ↑↓/Home/End 导航 **【已完成：三个容器 role=menu、菜单项 menuitem/menuitemradio/separator + tabindex=-1、↑↓/Home/End/Enter/Space/Tab 键盘导航（共享新模块 `menuKeys.ts`）、打开即聚焦首项、关闭按条件归还焦点、触发元素 aria-expanded 全程跟踪（含第七批留下的状态栏芯片），见 §7 第九批】** | `shell/src/menu.ts`、`shell/src/menuKeys.ts`（新增）、`shell/src/main.ts`（菜单栏渲染器）、`shell/index.html` | 中 |

> UI-29 详情见 §7 第五批记录末尾。要点：`terminal.ts:43` 硬编码 `fontSize: 13` 与一份与 `--mono`
> 重复维护的字体栈，用户在设置里改字号/字体后终端完全不跟随（主编辑器与 diff 编辑器则正确跟随）；
> 两个 devtools 只读预览器硬编码 `fontSize: 12`。实现时可复用第四批为 UI-11 建立的
> `applyMotionPreference()` / `refreshTerminalMotion()` 同款模式，处理已存在 xterm 实例的运行时刷新。

## 4. 详细任务说明

### P0

#### UI-01 · 最大化按钮图标被 JS 覆盖为 Unicode 字符

- **现状/证据**：`shell/index.html:49-51` 三个窗口按钮初始均用 codicon（`codicon-chrome-minimize`/`codicon-chrome-maximize`/`codicon-chrome-close`）。但 `shell/src/main.ts:2466-2470` 的 `syncMaxIcon()` 用 `winMaxBtn.textContent = max ? "❐" : "□"` 直接覆盖了 `#win-max` 的全部内容（含 `<i class="codicon">` 节点）。
- **影响**：① 图标风格与最小化/关闭按钮不统一；② `aria-hidden="true"` 被抹掉，屏幕阅读器会读出字符名；③ 依赖 `"Segoe UI Symbol"` 字体，跨机器字形可能不一致。
- **建议方案**：改为切换 `<i>` 元素的 `className`（`codicon-chrome-maximize` ↔ `codicon-chrome-restore`），不要动 `textContent`；`title` 仍可命令式更新。
- **涉及文件**：`shell/src/main.ts`（`syncMaxIcon`）。
- **验收标准**：最大化/还原切换时，图标始终是 codicon 字体图标，DOM 中 `<i aria-hidden="true">` 节点不丢失。

#### UI-02 · `surround-modal` 缺少关闭按钮

- **现状/证据**：`shell/index.html:635-643`，`env-header` 里只有标题和 `spacer`，没有 `env-close` 按钮，而 `env-modal`/`new-project-modal`/`run-config-modal`/`settings-modal` 都有。
- **影响**：鼠标用户没有显式退出出口，只能靠 Esc 或选中某项关闭，与其它模态交互契约不一致。
- **建议方案**：补一个 `<button id="surround-close" class="env-close">`，事件绑定到已有的关闭逻辑（`live-templates/ui/manager.ts` 或对应模块的 closePanel）；或在列表末尾追加一个"取消"项。
- **涉及文件**：`shell/index.html`、`shell/src/live-templates/ui/*`（找到 surround-modal 的现有开关逻辑接线点）。
- **验收标准**：点击关闭按钮可关闭模态，行为与 Esc 一致。

#### UI-03 · 设置面板 label 列固定宽度 + nowrap 导致长标签溢出

- **现状/证据**：`shell/src/style.css:1709-1718`，`.settings-row label` 用 `width: var(--settings-label-w)`（固定 160px）而非 `max-width`，且 `white-space: nowrap`、无 `overflow: hidden`。`shell/index.html` 中"同时输出到终端（stdout）"等中英混排长标签实测宽度略超 160px。
- **影响**：文字溢出到右侧控件（checkbox）区域，造成视觉重叠。
- **建议方案**：改用 `min-width: var(--settings-label-w); flex: none;`（允许内容撑开但不缩小），或对已知超长标签行改用 `.settings-row-col`（label 在上、控件在下）变体，与"环境变量"行一致。
- **涉及文件**：`shell/src/style.css`、`shell/index.html`（日志分区）。
- **验收标准**：所有设置行在 100%/125%/150% DPI 缩放下标签均不与控件重叠。

#### UI-04 · 欢迎页 flex 居中 + overflow 导致顶部内容滚不到

- **现状/证据**：`shell/src/style.css:697-710`，`#editor-overlay { display:flex; overflow:auto; padding:56px 28px 64px; }` + `.ew-card { margin:auto; }`。这是已知的 flexbox 居中溢出 bug：内容高度超过容器时，溢出部分在顶部/底部各占一半，但滚动只能到达底部一半，顶部品牌区被锁死在可视区外。
- **影响**：窗口高度较矮时（如半屏），欢迎页 Logo/标题不可见且无法滚动到。
- **建议方案**：`#editor-overlay` 改用 `align-items: safe center`，或在 `.ew-card` 外包一层 `min-height: 100%` 的 flex 容器用 `margin-block: auto` 居中，避免负向溢出被裁切。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：把窗口高度压到欢迎页内容高度以下，向上滚动能完整看到品牌区（Logo+标题+副标题）。

#### UI-05 · 模态框缺少焦点陷阱（focus trap）

- **现状/证据**：`shell/src/dialog.ts:84-86` 仅在打开时 `focus()` 到确定/取消按钮，未拦截 Tab 键循环。`settings-modal`/`env-modal`/`new-project-modal`/`run-config-modal` 同样没有 focus trap 逻辑（`shell/src/settingsPanel.ts`、`shell/src/main.ts` 中各自的 open/close 函数只做 `showEl`/`hideEl` + 单次 `focus()`）。
- **影响**：Tab 可以跳出模态聚焦到背后元素，键盘操作连贯性和无障碍性缺失。
- **建议方案**：抽一个通用的 `trapFocus(modalEl)` 工具函数（可放 `shell/src/anim.ts` 同级的新文件如 `shell/src/focusTrap.ts`，避免加重 `main.ts`），在所有 `.modal` 的 `showEl` 后启用、`hideEl` 前解除：监听 `keydown`，Tab 到达 `.modal-card` 内第一个/最后一个可聚焦元素时循环到另一端。
- **涉及文件**：新增 `shell/src/focusTrap.ts`；`shell/src/dialog.ts`、`shell/src/settingsPanel.ts`、`shell/src/main.ts`（各模态开关点）、`shell/src/storagePanel.ts`（`#storage-onboarding-modal`）。
- **验收标准**：任意模态打开后连续按 Tab，焦点始终在模态内部循环，不会跑到背后的编辑器/侧栏。

### P1

#### UI-06 · devtools tab 激活态颜色语义不一致

- **现状/证据**：`shell/src/style.css:18-19` 注释明确"品牌青绿=品牌识别；蓝 --accent=功能交互"。编辑器标签（`.tab.active`，:505）、底部面板标签（`.bottom-tab.active`，:867）、终端标签（`.term-tab.active`，:898-902）、Activity Bar（`.activity-item.active::before`，:1391-1401）、设置导航（`.settings-nav-item.active`，:1694-1700）全部用 `--brand`。唯独 `.devtools-tab.active`（:2211-2212）用 `--accent`。
- **影响**：同为"标签页激活态"却用两套颜色语言，右侧面板看起来像"另一个体系"。
- **建议方案**：统一改为 `--brand`；若确有"devtools 属于功能交互区"的设计意图，需在 `style.css` 顶部注释里补充说明，否则按遗漏处理。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：右侧面板 tab 激活态颜色与底部面板/编辑器 tab 一致。

> ⚠ **后续修订（2026-10-02）**：本条依据的「青绿 = 品牌识别 / 蓝 `--accent` = 功能交互」双色分工，已被 [ADR-0005](adr/0005-brand-accent-unification.md) **推翻**——青绿成为唯一色相轴，`--accent` 亦取青绿。原文与本条记录保留作为历史，**执行口径以 ADR-0005 为准**。实测该分工长期处于失衡状态：`--brand` 24 处对 `--accent` 82 处（另 `--on-accent` 13 / `--accent-soft` 15 / `--accent-faint` 4 / `--accent-hover` 4），即"功能交互"实际由蓝色承担，本条只把 1 处拉向品牌色而未触及大头。

#### UI-07 · JSONPath 选中行背景色强度不一致

- **现状/证据**：`.env-item.selected`（:1299，`--accent-soft`）、`.lt-row.selected`（:1888，`--accent-faint`）、`.palette-item.selected`（:2103，`--accent-soft`）、`.tree-item.active`（:384，`--selected`）均为柔和/半透明背景；`.jp-row.selected`（:2354）用实心 `--accent` + `--on-accent` 文字。
- **影响**：视觉重量远超其它列表选中态，在小面板里过于突兀。
- **建议方案**：降级为 `--accent-soft` 或 `--accent-faint`，文字色相应调整为 `--fg`（不再需要 `--on-accent`）。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：JSONPath 树选中行视觉重量与包列表/模板列表选中行一致。

#### UI-08 · 按钮样式碎片化，需收敛为统一 Button 体系

- **现状/证据**：`shell/src/style.css` 中至少 10+ 套并列、hover 行为/圆角/字号/内边距各异的按钮样式：`.modal-actions button`、`.env-row button`、`.env-mini-btn`、`.settings-row button`、`.lt-toolbar button`、`.lt-mini-btn`、`.lt-editor-actions button`、`.tool-toolbar button`、`.jp-pathbox button`、`#output-header button`、`#git-toolbar button`、`.ghost-btn`、`.storage-del`、`.debug-toolbar-btn`、`.menubar-icon`、`.win-btn`、`.scm-item .scm-action`、`.term-tab-close`/`.term-tab-stop`/`.term-tab-add`、`.ew-recent-clear`/`.ew-recent-remove`、`.git-branch-new button`、`#git-branch-btn`、`#git-diff-header .ghost-btn`、`#btn-tree-refresh`/`#btn-tree-collapse`/`#btn-tree-hidden`、`.search-box .ghost-btn`。字号散落 11/11.5/12/12.5/13px 五种；hover 反馈不统一（有的只变 border-color，有的直接变实心 accent 背景）。`button.flash-ok`/`.flash-error`（:2266-2276）需要 `!important` 才能覆盖所有变体，是特异性冲突已失控的直接证据。
- **影响**：可维护性差，新增按钮无法复用既有样式，只能再复制一份；状态覆盖需要 `!important`。
- **建议方案**：抽象 `.btn` 基类 + 变体修饰符（`.btn--primary` / `.btn--danger` / `.btn--ghost` / `.btn--icon`）+ 尺寸修饰符（`.btn--sm` / `.btn--md`），把现有十几套按钮逐一迁移到该体系；`flash-ok`/`flash-error` 改为 `.btn.is-ok`/`.is-error` 状态类，靠体系内的层叠顺序自然覆盖，去掉 `!important`。此项工作量大，建议单独拆一个子任务批次，逐组件迁移（先迁移低频面板如 devtools/storage，验证无误后再迁移高频的 modal/settings/git）。
- **涉及文件**：`shell/src/style.css`；`shell/index.html` 与所有生成按钮的 `.ts` 文件（`main.ts`、`settingsPanel.ts`、`debugView.ts`、`fileTree.ts`、`git.ts`、`termUi.ts`、`storagePanel.ts`、`live-templates/ui/*`、`devtools/*`）。
- **验收标准**：`style.css` 中不再有 `button.flash-ok { ... !important }` 这类需要 `!important` 覆盖的状态样式；新增按钮只需组合 `.btn` + 变体类，无需写新的一次性选择器。

#### UI-09 · Tooltip 双轨制：原生 `title` 与自绘 `data-tip` 并存

- **现状/证据**：`shell/src/tooltip.ts:1-5` 注释已承认这是未完成迁移（"接入 data-tip 的元素应移除原生 title 避免双重提示；树节点等低频场景保留原生 title"）。但实际大量高频交互元素仍用原生 `title`：`#win-min`/`#win-max`/`#win-close`（`shell/index.html:49-51`）、`#git-toolbar button`（:101-106）、`#git-branch-btn`（:98）、`#git-branch-current`（:97）、`.debug-toolbar-btn`（`shell/src/debugView.ts:48-56` 的 `toolbarButton` 用 `btn.title = tip`）、`.term-tab-close`/`.term-tab-add`（`shell/src/termUi.ts:279,291`）、`.env-pkg-line .pkg-actions button`（`shell/src/main.ts:883,889`）、`.scm-item .scm-action`、`.ew-recent-item`（`shell/src/main.ts:292`，整行 title=路径）、`.outline-item`（`shell/src/main.ts:1173`）等。
- **影响**：同一应用里两种 tooltip 体验（自绘版 300ms 延迟+深色卡片+支持 kbd 副文本；原生版延迟约 1s+系统默认样式+纯文本），菜单栏图标与 Git 工具栏按钮之间"手感"不一致。
- **建议方案**：制定迁移规则——所有**图标按钮/工具栏按钮**统一用 `data-tip`（去掉 `title`）；原生 `title` 只保留给"文本已被截断、需要看全文"的场景（如路径、长文件名、`.ew-recent-item` 整行路径、`.outline-item` 的 `name:line`）。逐文件替换 `title=` 为 `data-tip=`，并检查 `tooltip.ts` 的委托逻辑是否覆盖新元素（`mouseover` 委托已是 document 级，理论上无需额外接线，但要确认元素不是 `pointer-events: none`）。
- **涉及文件**：`shell/index.html`、`shell/src/main.ts`、`shell/src/debugView.ts`、`shell/src/termUi.ts`、`shell/src/fileTree.ts`、`shell/src/git.ts`。
- **验收标准**：应用内不再有"图标按钮用原生 title"的情况；`data-tip` 与残留 `title` 不会同时出现在同一元素上（避免双重提示）。

#### UI-10 · `.tree-item:focus` 用 `:focus` 而非 `:focus-visible`

- **现状/证据**：`shell/src/style.css:168-193` 全局焦点样式统一用 `:focus-visible`（键盘导航才显示），注释明确"按钮与列表项类控件统一 outline"。但 `.tree-item:focus`（:385）用了裸 `:focus`，且 `outline-offset` 是 `-1px`（全局规则是 `2px`）。
- **影响**：鼠标单击文件树任意节点都会立刻显示焦点框，与点击其它按钮/列表项的行为不一致，产生不必要的视觉噪音。
- **建议方案**：改为 `.tree-item:focus-visible`，`outline-offset` 统一为 `2px`（或确认 `-1px` 是刻意贴合树节点密集排布的设计，若是则在全局注释里说明例外原因）。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：鼠标点击文件树节点不再显示焦点框，键盘 Tab/方向键导航到该节点时才显示。

#### UI-11 · 动效系统未覆盖全部 transition

- **现状/证据**：`shell/src/style.css:66-99` 定义了 `--motion` 全局倍率与 `prefers-reduced-motion` 联动，模态/面板拖拽等结构性动画正确使用了 `calc(Xs * var(--motion))`。但大量微交互 transition 是硬编码时长：`#btn-toggle-output .codicon`（:205，`0.15s`）、`.jp-value-toggle .codicon`/`.jp-toggle .codicon`（:2334,2357，`0.12s`）、`.splitter`（:227，`0.12s`）、`.ew-actions button`（:738）、`.lt-row`（:1884）、`.lt-toolbar button`/`select`/`input`（:1810,1824,1945）、`.lt-mini-btn`（:2018）、`.lt-editor-actions button`（:2041）、`.tab .close`（:688，已用 `--motion`，是正例）等。
- **影响**：开启"减少动画"设置或系统 `prefers-reduced-motion` 的用户，仍会看到这些微交互动画，动效系统的覆盖不完整。
- **建议方案**：全量排查 `transition:` 声明，把硬编码时长替换为 `calc(Xs * var(--motion))`；或抽出 `--transition-fast: calc(0.12s * var(--motion)) ease`、`--transition-base: calc(0.15s * var(--motion)) ease` 两个 token 统一引用，减少重复书写。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：开启"减少动画"后，应用内所有 transition（含 hover 变色、图标旋转）均即时完成，无残留动画。

#### UI-12 · 空状态组件未推广到调试面板/终端面板；`.env-empty` 被跨域复用

- **现状/证据**：`shell/src/util.ts:97-112` 已封装统一空状态组件 `emptyState(icon, title, desc?, compact?)`，搜索面板（`shell/src/search.ts:123-126`）、大纲（`shell/src/main.ts:1201`）已正确使用。但：
  - 调试侧栏调用栈/变量/断点空态是裸文本 `.debug-empty`（`shell/src/debugView.ts:140-145,178-184,193-198`），无图标；
  - 终端面板无任何会话时完全空白，`renderTerminalViews`（`shell/src/termUi.ts:299-304`）只切换已有 view 显隐，没有兜底空态；
  - 搜索面板的"搜索中…"/"输入关键词后回车搜索"提示复用了语义不符的 `.env-empty` 类名（`shell/src/search.ts:192-197`）。
- **影响**：空状态视觉语言不统一；`.env-empty` 类名跨域复用是命名泄漏，后续维护者容易误改。
- **建议方案**：① 调试面板三处空态改用 `emptyState()`（配 `debug-alt`/`debug-breakpoint` 等图标）；② 终端无会话时渲染"点击 + 新建终端"空态卡片（同样走 `emptyState()`）；③ 把 `.env-empty` 抽成中性的 `.hint-text`（或直接用 `emptyState(..., compact=true)`），`search.ts` 的 `appendHint` 改用新类名，`.env-empty` 保留仅用于环境面板或一并替换。
- **涉及文件**：`shell/src/debugView.ts`、`shell/src/termUi.ts`、`shell/src/search.ts`、`shell/src/util.ts`、`shell/src/style.css`。
- **验收标准**：调试侧栏、终端面板、搜索面板的空/加载状态视觉风格与文件树大纲一致（图标+标题+说明）。

#### UI-13 · 分组标题中英文混用 + `text-transform: uppercase` 对中文无效

- **现状/证据**：`#tree-header`（`shell/src/style.css:339-347`，对应 HTML 文本 `FILES`）与 `#outline-title`（`OUTLINE`）是英文全大写+字间距的"标签"风格。`.debug-section-header`（:588-596）同样写了 `text-transform: uppercase`，但实际文本是中文"调用栈"/"变量"/"断点"（`shell/src/debugView.ts:75-99`），uppercase 对中文完全无效。`.ew-section-title`（:752-759，文本"最近的工作区"/"快捷键"）、`.bottom-tab`（:856-867，文本"输出"/"终端"/"差异"）、`.env-section-title`（:1262，文本"解释器"/"已安装包"）也是中文，但没有 uppercase（因为无效）。
- **影响**：同为"分组标题"角色，英文标题有"大写+字间距"的强标签感，中文标题只有字间距，两种文字体系下视觉气质不一致；`text-transform: uppercase` 对中文是死代码。
- **建议方案**：统一设计语言，二选一：
  - 方案 A（推荐）：全部改中文，去掉对中文无效的 `text-transform: uppercase`，保留 `letter-spacing` 作为唯一的"标签感"手段；`FILES`→`文件`、`OUTLINE`→`大纲`。
  - 方案 B：明确定义两套 header 变体类（`.section-header--label` 用于英文短标签，`.section-header--title` 用于中文标题），分别设定字间距/字重，不再共用一条规则硬套。
- **涉及文件**：`shell/src/style.css`、`shell/index.html`、`shell/src/debugView.ts`。
- **验收标准**：所有分组标题在视觉重量、字间距、大小写风格上遵循同一套规则，不再有对中文无效的 `text-transform`。

#### UI-14 · Git 工具栏按钮文案中英混排

- **现状/证据**：`shell/index.html:100-107`，同一工具栏内 Fetch/Pull/Push/Stash/Unstash 是英文，"历史"是中文，而所有 `title`（tooltip）又都是中文。
- **影响**：没有清晰的本地化规则，视觉上割裂。
- **建议方案**：制定统一策略并全量执行——要么全部中文（抓取/拉取/推送/暂存/弹出暂存/历史），要么保留 Git 通用术语英文但"历史"也改成 History。建议倾向前者（与 tooltip 语言一致）。
- **涉及文件**：`shell/index.html`。
- **验收标准**：Git 工具栏六个按钮文案语言统一。

### P2

#### UI-15 · 浅色主题下调试面板/JSONPath 语法色未适配；`--warning` 变量名笔误

- **现状/证据**：`shell/src/style.css:1-2` 立规矩"新增样式禁止引入裸色值"，但以下位置违反且未被 `[data-theme="light"]`（:103-146）覆盖：
  - `.debug-var-name { color: #9cdcfe; }`（:638-641）
  - `.jp-key`/`.jp-value.jp-string`/`.jp-number`/`.jp-boolean`/`.jp-null`/`.jp-badge.jp-object`/`.jp-array`（:2358-2367）全部硬编码深色系语法色
  - `.gutter-breakpoint::after { color: #e51400; }`（:539-543）、`.debug-current-line`（:546-549）、`.debug-current-line-margin { border-left: 3px solid #f5c518; }`（:550-552）、`.debug-bp-dot { background: #e51400; }`（:655-661）、`.debug-stack-frame.active { background: rgba(84,116,224,0.2); }`（:622-624）
  - `.env-pkg-line .pkg-outdated { color: var(--warning, #e2b93d); }`（:1346）——token 里定义的是 `--warn` 不是 `--warning`，这行实际上永远走硬编码兜底色，浅色主题覆盖层改的是 `--warn`，对它无效（明显笔误）。
- **影响**：切到浅色主题后，为深色背景设计的浅色文字（`#9cdcfe` 浅蓝、`#b5cea8` 浅绿、`#ce9178` 浅橙等）在白/浅灰背景上对比度骤降，大概率不满足 WCAG AA 4.5:1；`.pkg-outdated` 的黄色在浅色主题下同样不会跟着变。
- **建议方案**：① 把调试/JSONPath 用到的语法色登记为新 token（如 `--syntax-key`、`--syntax-string`、`--syntax-number`、`--syntax-boolean`、`--syntax-null`、`--debug-breakpoint`、`--debug-current-line`），在 `::root` 给深色值、`[data-theme="light"]` 给对应浅色主题值（参考现有 `--diff-hunk`/`--diff-add` 的双主题处理方式，:56-57,143-144）；② 修正 `--warning` 笔误为 `--warn`。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：浅色主题下调试变量名、JSONPath 键值、断点红点、当前行高亮、包过时标记均有足够对比度（可用浏览器 DevTools 对比度检测工具抽查，目标 ≥ 4.5:1）。

#### UI-16 · 自定义 tree/tab/dialog/tooltip 缺少 ARIA 语义

- **现状/证据**：
  - 文件树节点是普通 `div` + `tabIndex={-1}`，无 `role="tree"`/`role="treeitem"`/`aria-expanded`（`shell/src/fileTree.ts:74-81`）；
  - 编辑器标签页（`.tab`）、Activity Bar 按钮（`.activity-item`）、底部面板标签（`.bottom-tab`）无 `role="tablist"`/`role="tab"`/`aria-selected`/`aria-current`（`shell/index.html:57-62,178-183`、`shell/src/main.ts:1341-1383`）；
  - 自绘 tooltip（`.oc-tooltip`）无 `role="tooltip"`，未通过 `aria-describedby` 关联触发元素（`shell/src/tooltip.ts:10-43`）；
  - 模态框（`.modal`）无 `role="dialog"`/`aria-modal="true"`（`shell/index.html:237-643`、`shell/src/dialog.ts`）。
- **影响**：屏幕阅读器用户无法感知这些自绘组件的结构与状态。
- **建议方案**：按 WAI-ARIA Authoring Practices 补齐四类模式：
  - tree：容器 `role="tree"`，节点 `role="treeitem"` + `aria-expanded`（目录）/`aria-selected`；
  - tabs：容器 `role="tablist"`，标签 `role="tab"` + `aria-selected` + `aria-controls`，面板 `role="tabpanel"`；
  - dialog：`.modal-card` 加 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`（指向标题元素）；
  - tooltip：`.oc-tooltip` 加 `role="tooltip"` + `id`，触发元素加 `aria-describedby` 指向该 id（需在 `tooltip.ts` 的 `showTipFor` 里动态设置/清除）。
- **涉及文件**：`shell/src/fileTree.ts`、`shell/src/main.ts`、`shell/src/dialog.ts`、`shell/src/tooltip.ts`、`shell/src/settingsPanel.ts`、`shell/index.html`。
- **验收标准**：用浏览器无障碍审查工具（或 NVDA/VoiceOver 抽查）确认 tree/tablist/dialog/tooltip 四类角色和状态可被正确朗读。

#### UI-17 · 10px 字号用于多个信息密度较高的场景

- **现状/证据**：`.git-badge`（`shell/src/style.css:400-407`）、`.lt-badge`（:1891-1900）、`.jp-badge`（:2365）、`.surround-num`（:2066-2077）、`.oc-tooltip kbd`（:1126-1135）均为 `font-size: 10px`。
- **影响**：100%/125% DPI 普通显示器上接近可读性下限，尤其 Git 状态徽标（M/A/D/U）需要快速扫读。
- **建议方案**：统一提到 11px 作为全局最小字号下限；同步检查是否有其它未列出的 10px 用法。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：`style.css` 中不再出现 `font-size: 10px`（或经确认仅保留在纯装饰、非信息承载的场景并注释说明）。

#### UI-18 · 字号/间距/圆角缺乏系统化 scale token

- **现状/证据**：字号散落 10/11/11.5/12/12.5/13/14/15/16/18/24/26px 共 12 种；间距散落 1-28px 近 20 种；圆角散落 2/3/4/5/6/10px 共 6 种。11.5px、12.5px 这类半像素字号在 Windows 分数 DPI（125%/150%）下容易触发次像素渲染导致发虚。
- **影响**：缺乏系统约束，新增样式容易继续引入散值；半像素字号在分数 DPI 下渲染质量不稳定。
- **建议方案**：在 `::root` 建立三套 scale token（命名与现有色值 token 风格一致）：
  ```
  --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-md: 14px;
  --text-lg: 16px; --text-xl: 20px; --text-2xl: 24px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 3px; --radius-md: 5px; --radius-lg: 8px;
  ```
  把现有散值就近归档（11.5px→`--text-xs`，12.5px→`--text-sm` 或视情况保留一档 `--text-sm-plus: 12.5px` 过渡，最终目标是消除半像素档位）；新增样式强制走 token，规则写进 `style.css` 顶部注释（与现有"禁止裸色值"规则并列）。此项工作量大，建议与 UI-08（按钮体系收敛）合并推进，避免重复改动同一批规则。
- **涉及文件**：`shell/src/style.css`（全量）。
- **验收标准**：`style.css` 顶部注释新增"字号/间距/圆角走 scale token"规则；抽查 10 处新增/修改样式确认无裸数值。

### P3

#### UI-19 · 标题栏承载异质功能过多，缺乏视觉分区

- **现状/证据**：`shell/index.html:30-53`，34px 高的 `#menubar` 内塞了品牌 Logo+标题、4 个下拉菜单（文件/编辑/视图/工具）、运行组（3 按钮）、调试按钮、设置按钮、窗口控制（3 按钮），中间只靠一个 `.spacer` 分隔左右，四个功能 zones 之间没有视觉分组。
- **影响**：扫视时容易糊成一片，功能边界不清晰。
- **建议方案**：在"工具菜单"与"运行组"之间、"运行组+调试"与"设置按钮"之间加细分隔线（1px `var(--border-soft)`，高度约 16px 居中）或 4-6px 额外间距，让菜单区/动作区/设置区/窗口控制区有清晰视觉边界。
- **涉及文件**：`shell/index.html`、`shell/src/style.css`。
- **验收标准**：标题栏四个功能 zones 之间有可感知的视觉分隔（间距梯度或分隔线）。

#### UI-20 · 右键菜单 hover 用实心饱和蓝，比其它列表 hover 重

- **现状/证据**：`.ctx-menu-item:hover { background: var(--accent); color: var(--on-accent); }`（`shell/src/style.css:1160`），对比 `.tree-item:hover`（:383，`--hover`）、`.scm-item:hover`（:1465，`--hover`）等柔和 hover。`.ctx-menu-item.danger:hover`（:1161，实心红）是合理的破坏性操作强提示，应保留。
- **影响**：普通菜单项 hover 直接跳到实心品牌蓝+白字，视觉冲击强于应用内其它任何列表 hover，长菜单快速扫视时偏"闪"。
- **建议方案**：普通项 hover 降到 `--accent-soft` 或 `--hover`，把实心 `--accent` 留给真正的"选中/激活"态（与 UI-06/07 的逻辑一致：hover 应轻量，selected/active 才用重色）；`.danger:hover` 保持实心红不变。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：右键菜单/下拉菜单普通项 hover 视觉重量与文件树、SCM 列表 hover 接近；danger 项 hover 仍为实心红。

#### UI-21 · 状态栏窄窗口下溢出风险，无响应式处理

- **现状/证据**：`shell/src/style.css:1076-1086`，`#status-file { max-width: 42% }`、`#status-interpreter { max-width: 120px }`、`#status-engine { max-width: 110px }`，但 `#status-git`、`#status-font`、`#status-lsp` 无 max-width/overflow 处理，全部 `white-space: nowrap`（:1066-1072）。整个 `style.css` 无一条 `@media` 查询。
- **影响**：窗口拖窄（如同时展开左侧栏 280px + 右侧面板 360px）时，状态栏各项固定 max-width 之和可能超过可用宽度，`#status-lsp` 被挤出可视区或换行破坏 24px 固定高度。
- **建议方案**：① `#statusbar` 加 `overflow: hidden`；② `#status-git`/`#status-lsp` 补 `overflow: hidden; text-overflow: ellipsis; max-width`；③ 增加一条窄宽度媒体查询（如 `@media (max-width: 900px)`）隐藏次要项（`#status-font`）。
- **涉及文件**：`shell/src/style.css`、`shell/index.html`（如需调整结构）。
- **验收标准**：把窗口宽度压到 ~700px（左右面板均展开），状态栏不换行、不溢出，次要信息按预期隐藏或截断。

#### UI-22 · 文件树与大纲高度分配硬编码 40%，不可拖拽调整

- **现状/证据**：`#outline-section { max-height: 40%; }`（`shell/src/style.css:1564-1571`），文件树 `#tree { flex: 1 }`（:370）占剩余空间，两者之间没有拖拽分隔条；而侧栏整体宽度、底部面板高度、右侧面板宽度都已经做了拖拽调整（`shell/src/layout.ts`）。
- **影响**：符号多的大文件大纲区不够用；无符号文件浪费这 40% 空间。
- **建议方案**：给文件树/大纲之间加一个 `.splitter-row` 热区，复用 `layout.ts` 已有的 `startDrag`/持久化机制（新增一个 `OUTLINE_KEY`，记录大纲区高度而非百分比，设最小/最大值）。
- **涉及文件**：`shell/src/style.css`、`shell/src/layout.ts`、`shell/index.html`（`#view-files` 内插入分隔条元素）。
- **验收标准**：文件树与大纲之间可拖拽调整高度，双击重置为默认比例，刷新后保持上次调整值。

### P4

#### UI-23 · 无最小窗口宽度约束，三栏布局可能把编辑器挤没

- **现状/证据**：`shell/src/layout.ts:11-18` 侧栏最小 180px、右侧面板最小 260px；`#center { flex: 1; min-width: 0 }`（`shell/src/style.css:479`）理论上可被压缩到接近 0。无 Tauri 层面的 `min_width` 约束（需核对 `shell/src-tauri/tauri.conf.json`）。
- **影响**：窗口整体拖窄到 ~500px 且左右面板均展开时，编辑器区域被挤压到几乎不可用，无任何提示或自动收起机制。
- **建议方案**：① 在 Tauri 窗口配置里设置合理的 `minWidth`（如 640 或 720）；② 或在 `#center` 宽度低于阈值时自动临时收起右侧面板/侧栏并给出一次性提示。方案①实现成本更低，优先。
- **涉及文件**：`shell/src-tauri/tauri.conf.json`（或等价窗口配置）、`shell/src/layout.ts`（若选方案②）。
- **验收标准**：窗口无法被拖到编辑器区域不可用的宽度。

#### UI-24 · 设置面板在极窄窗口下导航列固定 170px，内容区局促

- **现状/证据**：`.settings-card { width: 820px; max-width: 94vw; }`（`shell/src/style.css:1669`）已有 viewport 兜底，但 `.settings-nav { width: 170px; flex: none; }`（:1673-1681）固定，窗口宽度 ~500px 时内容区仅剩 ~280px，表单控件局促，无断点让导航折叠。
- **影响**：极窄窗口下设置面板可用性下降（虽属边缘情况，桌面 IDE 窗口很少这么窄，但既然 UI-23 要加 minWidth 约束，此项可一并验证）。
- **建议方案**：窄宽度媒体查询下把 `.settings-nav` 改为横向滚动的 tab 条或折叠成 `<select>`。
- **涉及文件**：`shell/src/style.css`、`shell/src/settingsPanel.ts`（若改为 select 需调整渲染逻辑）。
- **验收标准**：窗口宽度压到 minWidth 时，设置面板导航仍可正常切换分类，表单控件不被裁切。

### P5

#### UI-25 · 欢迎页快捷键网格硬编码，不跟随用户自定义键位

- **现状/证据**：`shell/index.html:150-160` 是静态 HTML；而 `shell/src/keybindings.ts`/`state.ts` 有完整可配置键位系统，运行组 tooltip 已经在用 `kb.bindingLabel()`（`shell/src/runWidget.ts:84,93`、`shell/src/main.ts:2453`）。
- **影响**：用户在设置里改键位后，欢迎页仍显示出厂默认值，信息不一致。
- **建议方案**：把 `.ew-shortcuts` 网格改为 JS 动态渲染（`shell/src/main.ts` 的 `updateEditorOverlay`/`renderEditorWelcomeRecents` 附近增加一个 `renderWelcomeShortcuts()`），复用 `kb.bindingLabel()`，把 `Ctrl+S` 等拆成 `<kbd>` 分段渲染的逻辑封装成工具函数（可参考 `tooltip.ts` 里 kbd 的用法）。
- **涉及文件**：`shell/index.html`、`shell/src/main.ts`、`shell/src/keybindings.ts`（若需要新增"把键位串拆分为 kbd 分段"的工具函数）。
- **验收标准**：在设置里修改任一快捷键后重新打开欢迎页，显示的键位同步更新。

#### UI-26 · 主题选择下拉没有视觉预览色卡

- **现状/证据**：`shell/index.html:402-408`，纯文字 `Dark`/`Light` 选项。
- **建议方案**：在选项文字前加一个小圆形色卡（深灰/白），可用 `::before` 伪元素或内联 `<span>` 实现；原生 `<select>` 的 `<option>` 内不支持复杂 HTML，若要用色卡需改为自绘下拉（可复用 `menu.ts` 的 `showMenu`）或退而求其次只在标签文字上做文章（如"Dark（深色）"）。
- **涉及文件**：`shell/index.html`、`shell/src/settingsPanel.ts`。
- **验收标准**：主题选择控件能直观预览两种主题的基调色。

#### UI-27 · 运行组/调试按钮与窗口控制按钮之间缺少视觉呼吸感

- **现状/证据**：`#run-group { gap: 2px; margin-left: 6px; }`（`shell/src/style.css:289`），`#btn-debug` 紧贴运行组，与后续 `.spacer`/`#btn-settings`/`#win-controls` 之间无额外分隔。
- **建议方案**：与 UI-19 合并处理，在运行组+调试按钮这一"动作区"整体与右侧"设置+窗口控制区"之间加 6-8px margin 或 1px 分隔线。
- **涉及文件**：`shell/src/style.css`、`shell/index.html`。
- **验收标准**：同 UI-19。

#### UI-28 · `.debug-var-row` 硬编码字体栈，未走 `--mono` token

- **现状/证据**：`.debug-var-row { font-family: Consolas, "Cascadia Code", monospace; }`（`shell/src/style.css:630-637`），而全局已定义 `--mono: Consolas, "Cascadia Code", "JetBrains Mono", monospace;`（:63，多了 JetBrains Mono 兜底）。
- **影响**：用户系统若只有 JetBrains Mono 没有前两者，调试变量区渲染会和其它 mono 区域（输出面板、搜索结果、终端）不一致。
- **建议方案**：改为 `font-family: var(--mono);`。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：调试变量区字体栈与全局 `--mono` 一致。

## 5. 推进建议（批次划分）

| 批次 | 内容 | 说明 |
|---|---|---|
| 第一批 ✅ | UI-01 ~ UI-05（P0 全部） | 明确缺陷，可合并为一个独立 PR，工作量小-中，建议优先落地 |
| 第二批 ✅ | UI-06、UI-07、UI-10、UI-13、UI-14、UI-20、UI-28 | P1/P3/P5 中"极小/小"工作量的一致性修复，可合并为一个"设计系统一致性"PR |
| 第三批 ✅ | UI-08 + UI-18 | 按钮体系收敛 + 字号/间距/圆角 scale token，两者高度关联，建议合并为一个大 PR，分子组件逐步迁移 |
| 第四批 ✅ | UI-09、UI-11、UI-12 | Tooltip 迁移、动效系统补全、空状态推广，均为中等工作量的独立子主题 |
| 第五批 ✅ | UI-15、UI-17 | 浅色主题语法色适配 + 最小字号提到 11px，均为 `style.css` 内 token 层改动，可合并一个 PR |
| 第六批 ✅ | UI-16 | ARIA 语义。**从原第五批拆出单独排期**：工作量最大且横跨 tree/tablist/dialog/tooltip 四类模式。第四批已为其铺垫（图标按钮 `aria-label`、调试工具栏 `aria-disabled`、`#btn-tree-hidden` 的 `aria-pressed` 均已就位），待办清单见 §7 第四批末尾 |
| 第七批 ✅ | UI-19、UI-21、UI-22、UI-27 | 视觉层次与信息密度优化（另顺带处理第六批登记的「状态栏芯片语义」：`#status-engine`/`#status-interpreter` 补 role/aria-haspopup/tabindex/键盘激活） |
| 第八批 ✅ | UI-23、UI-24、UI-25、UI-26 | 响应式边缘情况与细节打磨（UI-25 的同类缺陷——调试工具栏硬编码快捷键——已在第四批顺带修掉） |
| 第九批 ✅ | UI-29、UI-30 | 字号/字体族接入用户设置 + 菜单 ARIA 与键盘导航（含第七批留给 UI-30 的状态栏芯片 `aria-expanded`）。至此 30 项全部完结 |
| 第十批 ✅ | 两条清单外遗留 | 表单 label ↔ 控件关联（for/id + 双控件行 aria-label）+ `#bottom` 拖拽改写 `--bottom-h`（与 UI-22 同一方案）。本计划全部收官 |

每批完成后：① 跑一遍前端已有测试（`shell/src/__tests__/`，vitest）确保无回归；② 人工过一遍深/浅两套主题下的视觉效果；③ 涉及交互逻辑变更的（如 UI-05 focus trap、UI-22 拖拽分隔条）需手动验证键盘/鼠标两条路径。

## 6. 附录：建议新增的设计 token 清单

> **⚠️ 本附录为立项时的估算值，已被 §7「第三批」的实际落地结果取代**（实际值基于全量审计数据推导，
> 与本附录有三处实质差异：① 间距改用 2px 网格而非 4px 网格，因 6/8/10/4px 才是最高频值；
> ② 字号无 20px 档、增设 10px 过渡档；③ 圆角为 5 档 2/3/4/6/10 而非 3 档 3/5/8）。
> **以 `shell/src/style.css` 的 `:root` 实际定义为准**，本附录仅作立项背景保留。

以下 token 名为建议值，落地时可按实际需要调整命名，但须遵守 `style.css` 顶部"新增色值先登记 token"的规则：

```
/* 语法色（UI-15）：深色主题为现有硬编码值，浅色主题需重新取值保证对比度 */
--syntax-key: #9cdcfe;
--syntax-string: #ce9178;
--syntax-number: #b5cea8;
--syntax-boolean: #569cd6;
--syntax-null: #808080;
--debug-breakpoint: #e51400;
--debug-current-line-bg: rgba(245, 197, 24, 0.18);
--debug-current-line-border: #f5c518;
--debug-frame-active: rgba(84, 116, 224, 0.2);

/* 字号 scale（UI-18） */
--text-xs: 11px;
--text-sm: 12px;
--text-base: 13px;
--text-md: 14px;
--text-lg: 16px;
--text-xl: 20px;
--text-2xl: 24px;

/* 间距 scale（UI-18） */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;

/* 圆角 scale（UI-18） */
--radius-sm: 3px;
--radius-md: 5px;
--radius-lg: 8px;

/* 动效 token（UI-11，可选，减少重复书写 calc） */
--transition-fast: calc(0.12s * var(--motion)) ease;
--transition-base: calc(0.15s * var(--motion)) ease;
```

## 7. 进度记录

### 2026-09-11 · 第一批（P0：UI-01 ~ UI-05）已完成

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| UI-01 | 已修复 | `main.ts` 的 `syncMaxIcon` 改为切换 `<i>` 元素的 `codicon-chrome-maximize`/`codicon-chrome-restore` 类名，不再用 `textContent` 覆盖为 Unicode 字符 |
| UI-02 | 已修复 | `index.html` 的 `#surround-modal` 头部补 `#surround-close` 按钮；`surround.ts` 的 `openSurroundPicker` 内用 `onclick` 赋值接线到已有的 `close()` 闭包 |
| UI-03 | 已修复 | `style.css` 的 `.settings-row label, .settings-label-gap` 由 `width` 改为 `min-width`，短标签仍对齐 160px 基线，长标签可撑开不溢出 |
| UI-04 | 已修复 | `style.css` 的 `#editor-overlay` 用 `justify-content: center` + `align-items: safe center` 取代 `.ew-card` 的 `margin: auto`，规避 flex 居中+overflow 的顶部内容不可滚动问题 |
| UI-05 | 已修复 | 新增 `shell/src/focusTrap.ts`（支持模态叠加的陷阱栈）；接入 `dialog.ts`（confirm/alert）、`settingsPanel.ts`（设置面板）、`main.ts`（环境面板/新建项目/运行配置）、`storagePanel.ts`（首启落位提示）、`surround.ts`、`palette.ts` 共 8 处模态 |

验证：`npm run build`（tsc + vite build）通过，无类型错误；`npm test`（vitest）20 个测试文件、155 项测试全部通过，无回归。

### 2026-09-11 · 第二批（P1/P3/P5 一致性小改动：UI-06、UI-07、UI-10、UI-13、UI-14、UI-20、UI-28）已完成

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| UI-06 | 已修复 | `style.css` 的 `.devtools-tab.active` 由 `--accent` 改为 `--brand`，与 `.tab`/`.bottom-tab`/`.term-tab`/`.activity-item`/`.settings-nav-item` 的激活态颜色语义统一 |
| UI-07 | 已修复 | `style.css` 的 `.jp-row.selected` 由实心 `--accent`+`--on-accent` 降级为 `--accent-soft`+`--fg`，与 `.env-item.selected`/`.palette-item.selected` 一致 |
| UI-10 | 已修复 | `style.css` 的 `.tree-item:focus` 改为 `.tree-item:focus-visible`，`outline` 用 `--focus-ring`、`outline-offset` 统一为 `2px`（与全局键盘焦点规则一致） |
| UI-13 | 已修复（采用方案 A：统一中文） | `style.css` 去掉 `.debug-section-header`/`.ew-section-title`/`.git-section-title` 三处对中文无效的 `text-transform: uppercase`（保留 `letter-spacing`）；`index.html` 的 `#tree-header-text` "FILES"→"文件"、`#outline-title` "OUTLINE"→"大纲"；`main.ts` 的 `closeWorkspace` 里同步改为 "文件" |
| UI-14 | 已修复 | `index.html` 的 Git 工具栏六个按钮文案统一中文：Fetch→抓取、Pull→拉取、Push→推送、Stash→暂存、Unstash→弹出暂存、历史（原本已是中文，不变）；确认 `git.ts` 未动态改写这些按钮的 `textContent`，改动安全 |
| UI-20 | 已修复 | `style.css` 的 `.ctx-menu-item:hover` 由实心 `--accent`+`--on-accent` 降为 `--hover`（不再覆盖文字色，继承基础规则的 `--fg`）；`.ctx-menu-item.danger:hover` 保留实心 `--danger`，并显式补 `color: var(--on-accent)`（原来靠继承通用 hover 规则得到白字，通用规则改后需显式声明，否则红底灰字对比度不足） |
| UI-28 | 已修复 | `style.css` 的 `.debug-var-row` 字体栈由硬编码 `Consolas, "Cascadia Code", monospace` 改为 `var(--mono)`，与输出面板/搜索/终端等宽区域一致 |

验证：`npm run build`（tsc + vite build）通过，无类型错误；`npm test`（vitest）20 个测试文件、155 项测试全部通过，无回归。

### 2026-09-11 · 第三批（UI-08 + UI-18）已完成

本批开工前做了全量审计，发现实际复杂度高于计划预估，两项关键裁决已由产品负责人确认：
**① 12.5px（63 处，全项目最高频字号）就近归到 12px**（而非 13px，避免定宽 nowrap 容器溢出截断）；
**② 图标按钮的固定尺寸属"特定组件"，不纳入 `.btn` 体系**（`.win-btn` 46px 是 Windows 窗口控制标准热区、`.activity-item` 36×36、`.debug-toolbar-btn` 28×28、`.scm-action` 16×16 受列表行高约束、`.term-tab-close`/`.term-tab-stop` 14×14、`.ew-recent-clear`/`.ew-recent-remove` 为 hover 才显现的行内删除）。

#### UI-18 · scale token（已完成）

审计口径：font-size 181 处 / 12 种取值；间距 353 处 px 值 / 20 种取值；border-radius 83 处 / 7 种取值。

| 类别 | 落地结果 |
|---|---|
| 字号 | 7 档：`--text-2xs:10`（过渡档，UI-17 提到 11px 后删除）/ `--text-xs:11` / `--text-sm:12` / `--text-base:13` / `--text-md:14` / `--text-lg:16` / `--text-xl:24`。归档：11.5→11、**12.5→12**、18→16、26→24；15px 两处按语义分流——`.env-title`（模态标题）→16px 保住标题层级，`.debug-toolbar-btn`（图标字形）→14px |
| 间距 | 2px 网格 12 档（`--space-1:2` … `--space-12:32`）。取 2px 而非 4px 网格的依据：6px(62)/8px(66)/10px(49)/4px(48) 为最高频值，4px 网格无法容纳。奇数值就近向上归档：1→2、3→4、5→6、7→8、9→10；另 18→20、22→24、26→28 |
| 圆角 | 5 档：`--radius-xs:2` / `--radius-sm:3`（主档，51 处）/ `--radius-md:4` / `--radius-lg:6` / `--radius-xl:10`；5px（7 处，均为卡片/内嵌面板类容器）归入 6px |
| 过渡 | 附带定义 `--transition-fast` / `--transition-base`（已内置 `--motion` 倍率），供 UI-11 收敛其余硬编码 transition 时直接引用 |

**刻意保留的裸值例外**（已在 `style.css` token 注释中登记）：
- `.activity-item.active::before` 的 `border-radius: 1px`——2px 宽指示条的半宽圆角，与元素自身尺寸成比例的光学值；
- `#editor-overlay` 的 `padding: 56px … 64px`——欢迎页一次性版式留白，非组件间距。

**迁移方式与安全性**：606 处替换由一次性脚本完成（脚本已删除，不入库）。脚本设了三道防线，缺一不可：① 按 `/* */` 切分，**只处理代码、跳过注释**（新写的 token 注释里含 `margin:auto`、`12.5px` 等字样，无脑替换会改成乱码）；② 跳过自定义属性声明行，避免 `--space-1: var(--space-1)` 自我引用；③ 只动 `font-size` / `border-radius` / `padding*` / `margin*` / `gap`，不碰 `width`/`height`/`inset`/`letter-spacing`/`outline-offset`/`border-*-width`/`vertical-align`（组件尺寸与光学微调不属于间距 scale）。未登记进映射表的值一律原样保留、交人工按语义处理，脚本不猜测。

迁移后校验：**裸 font-size 残留 0 处**；`border-radius` 仅剩 1px 例外、间距仅剩 56/64px 例外；`#sidebar width:280px`、`#bottom height:220px`、`.settings-card width/height`、`.splitter-col width:6px`、`.tree-item min-height:22px` 等组件尺寸均未被误改。

#### UI-08 · 通用按钮体系（体系已建立，组件迁移进行中）

已在 `style.css` 落地 `.btn` 四轴体系：

- **变体**：默认（次要）/ `--primary` / `--danger`（实心）/ `--danger-outline`（描边，破坏性动作处于次要位置时用）/ `--ghost` / `--icon`
- **尺寸**：`--sm`（紧凑工具栏与行内）/ 默认 md（表单与对话框）/ `--lg`（欢迎页 CTA）
- **状态**：`:disabled` / `.active`（切换类常驻高亮）/ `.busy`（`util.ts::setBusy`）/ `.flash-ok` / `.flash-error`（`devtools/feedback.ts`）
- **焦点**：`.btn:focus-visible` 已并入全局键盘焦点规则

两处对计划的偏离，均有实测依据：
1. **尺寸做 3 档而非 2 档**：欢迎页 CTA（`.ew-actions button`，8px 16px / 13px）明显大于表单按钮档（5px 12px / 12.5px），压到 md 会让落地页主操作失去应有的视觉重量，故保留 `--lg` 专供该场景。
2. **状态类沿用现有名称**（`.busy` / `.active` / `.flash-ok` / `.flash-error`），未改成 `.is-*`——这样 `util.ts::setBusy` 与 `devtools/feedback.ts` 的状态逻辑零改动，迁移面只剩"给按钮加类名"，风险显著更低。

**`!important` 已消除**：`button.flash-ok { … !important }` 是原体系特异性失控的直接证据（一个通用状态类要压过十几套并列的按域按钮选择器）。收敛后 `.btn.flash-ok` 特异性 (0,2,0) 天然覆盖 `.btn--primary` 的 (0,1,0)，靠源序即可，无需 `!important`。全文件现仅剩 2 处 `!important`，均属合理：`.hidden`（全局隐藏工具类）、`.inline-input-row`（需覆盖 `.tree-item` 内边距）。

**已迁移的组件组**（按计划"先低频面板验证"）：
- devtools：`.tool-toolbar button`（含 `.primary`/`.active`/`:disabled`/`:active` 下沉）与 `.jp-pathbox button` 两套按域规则整体删除，改由 `.btn` / `.btn--primary` / `.btn--sm` / `.btn.active` 承载；`curl2python` 与 `jsonpath` 两个面板共 9 个按钮加类名，图标与文字的间距改由 `.btn` 的 `gap` 提供（去掉前导空格）。`.jp-value-toggle` 是无边框的 disclosure 折叠控件，语义上不是按钮，保持独立样式不纳入体系。
- storage：`.storage-del` 视觉规则删除，改为 `.btn .btn--sm .btn--danger-outline`（原 hover 正是 danger-outline 语义：描边红 + 红字 + `--danger-soft` 底）。**JS 事件钩子同步改造**：`usageEl` 的点击委托由 `.closest(".storage-del")` 改为 `.closest("[data-trace]")`，不再拿样式类名当钩子；`storagePanel.test.ts`（CR-04 注入回归测试）的定位选择器同步更新，断言意图不变。

**其余四组已全部迁移完成**（同批内按"先低频后高频"顺序推进，每组各自跑一次 build + test）：

| 组 | 删除的旧按域规则 | 迁移到 |
|---|---|---|
| 1 live-templates | `.lt-toolbar button`（含 `.primary`/`:disabled`/`:disabled:hover`）、`.lt-mini-btn`（含 `:hover`/`.codicon`）、`.lt-editor-actions button`（含 `.primary`/`.danger`/`:disabled`/`.danger:disabled`） | `.btn` / `.btn--primary` / `.btn--sm` / `.btn--danger-outline`；含 `manager.ts` 动态创建的变量表小按钮、编辑器四个操作按钮、分组内联重命名的确定/取消 |
| 2 模态与表单 | `.modal-actions button`（含 `.primary`/`.danger`）、`.env-row button`、`.env-mini-btn`、`.settings-row button`（含 `.primary`）、`.env-row button.busy`/`.env-mini-btn.busy`、`.env-banner .env-mini-btn` | `.btn` / `.btn--primary` / `.btn--sm` / `.btn--danger` / `.btn.busy`；覆盖 11 个模态操作按钮 + 环境面板 5 个 + 设置/存储页 12 个 |
| 3 Git | `#git-toolbar button`、`#git-commit-btn`（外观部分）、`#git-branch-btn`、`.git-branch-new button`、`#git-diff-header .ghost-btn`，以及 3 条 `…​ .codicon` 图标尺寸覆盖 | `.btn--sm`（工具栏 6 个）/ `.btn--primary`（提交、新建分支）/ `.btn--sm .btn--icon`（分支切换、diff 关闭）/ `.btn--sm`（Blame） |
| 4 其余 | `#btn-tree-refresh/collapse/hidden`（含 `.active`）、`.env-close`、`.search-box .ghost-btn`（含 `.active`）、`.ew-actions button`（含 `.primary`/`:not(.primary)`/`.icon`）、`#output-header button`，以及 2 条 `.codicon` 覆盖 | `.btn--ghost .btn--icon`（树头部 3 个 + 6 个模态关闭按钮）/ `.btn--sm`（Aa 开关、清空输出）/ `.btn--sm .btn--icon`（折叠箭头）/ `.btn--lg`（欢迎页两个 CTA） |

**迁移完整性已双向校验**（剥离注释后按真实选择器比对）：
- index.html 中 87 个 `<button>`，**58 个已纳入 `.btn` 体系**，剩余 29 个全部是刻意排除的特定组件（`.menubar-item`×4、`.menubar-icon`×5、`.win-btn`×3、`.activity-item`×4、`.bottom-tab`×3、`.settings-nav-item`×9、`.ew-recent-clear`×1）；
- 16 类被排除组件的样式规则**全部保留未误删**（`.scm-action`、`.debug-toolbar-btn`、`.pkg-actions button`、`.jp-value-toggle`、`.git-history-back`、`.ew-recent-remove`、`.term-tab-*` 等）；
- 30 条应删的旧按域选择器**已清除 29 条**，唯一保留的 `#git-commit-btn { align-self: flex-end; }` 是纯布局职责（提交按钮在 commit box 里靠右），非外观规则；
- `.btn` 体系共 25 条规则，覆盖基类 / 尺寸（sm·md·lg）/ 尺寸档图标字形 / 变体（primary·danger·danger-outline·ghost·icon）/ 状态（disabled·active·busy·flash-ok·flash-error）/ focus-visible。

**迁移中顺带修正的 4 个既有缺陷**（都不在计划条目内，是收敛过程中暴露出来的）：
1. `.lt-mini-btn` 把 danger hover 写死在基类上，导致「+ 添加变量」按钮悬停也泛红——语义错误。迁移后按用途分流：添加=中性档、删除=`--danger-outline`。
2. `.env-row button:hover` 直接变实心 accent 蓝底白字，跳变强度远超其它按钮（正是 §4 UI-08 记录的"hover 反馈不统一"的具体实例）。收敛后统一走 `.btn` 的轻量 hover。
3. `.ew-actions button .icon { font-size: 14px }` 是**误导性死规则**——它作用于外层 `<span class="icon">`，而内部 `<i class="codicon">` 有自己的 16px 基础规则，所以欢迎页图标实际渲染是 16px 而非 14px。删除后由 `.btn .codicon` 真正给到 14px。
4. `.search-box .ghost-btn` / `#git-diff-header .ghost-btn` 的 `ghost` 命名有歧义：它们其实是**有边框**的次要按钮，与新体系里 `.btn--ghost`（无边框透明）语义相反。迁移后这两个上下文不再使用该歧义类名。

> **迁移铁律**（本批最重要的经验，后续如再引入组件体系务必遵守）：旧按域选择器的特异性普遍**高于** `.btn`——`.tool-toolbar button` 是 (0,1,1)、`#git-toolbar button` 是 (1,0,1)、`#git-commit-btn` 是 (1,0,0)，全都压过 `.btn` 的 (0,1,0)。**只加类名不删旧规则，新体系会被静默压过且看不出错**。每组迁移必须"加类名 + 删旧规则"成对完成，并在删完后用剥离注释的选择器比对做双向校验（防漏删、也防误删被排除组件的规则）。
>
> 另一条同类陷阱：旧规则常同时充当 **JS 选择器钩子**。本批遇到两处——`usageEl` 的点击委托用 `.closest(".storage-del")`、`wireGitUI` 用 `.closest(".git-branch-new button")`。前者已改为 `[data-trace]` 属性钩子（并同步更新 CR-04 注入回归测试的定位选择器）；后者匹配的是标签名而非类名，迁移天然不受影响。**删任何类名前必须先搜一遍 TS 侧是否拿它当钩子。**

#### 本批需人工抽查的可见变化

**A. token 归档带来的字号/间距变化**（深/浅两套主题下各过一遍）：
- **活动栏图标 18px→16px**（`.activity-item .codicon`）：按钮热区仍为 36×36 不变，仅字形变小，是本次最显眼的一处；
- 次要 UI 文字 12.5px→12px（标签页 / 菜单 / 表单控件 / 列表项，共 63 处）；
- 空状态图标 26px→24px；模态标题 15px→16px（略微更突出）；
- 控件内边距奇数值向上归档（如按钮 5px→6px、1px→2px），密集区域行高会略增 1-2px。

**B. 按钮体系收敛带来的变化**（按影响面从大到小）：
- **树头部「显示隐藏文件」开关的「开」态**：原为「品牌青绿图标 + 透明底」，现统一为 `.btn.active`（实心 accent 底 + 白图标）。这是本批最需要确认的一处——目的是让全应用只保留一种开关「开」态表达（与 Aa 大小写开关、JSONPath/curl2python 的模式切换一致），但确实改变了原有较轻的观感；
- **模态关闭按钮（6 处）**：图标 16px→14px，且因 `.btn` 带 1px 透明边框而各边大 1px；静态色仍为 `--fg-dim`、hover 提亮 + 浅底（已把这套观感内建进 `.btn--ghost` 变体，故按域规则可整条删除）；
- **输出面板「清空」/「折叠」按钮的 hover**：原只提亮文字色（不变底色），现统一为「描边加深 + 浅底」；
- **环境面板行内按钮的 hover**：原直接变实心蓝底白字（跳变过强），现统一为轻量 hover——这是一处**改善**；
- **Git 工具栏 6 个按钮**：原 2px 8px / 11px 与 `.btn--sm` 逐项吻合，视觉零变化；提交按钮由「无边框 accent 底」变为「accent 底 + accent 边框」（视觉等价）、内边距 4px 14px→6px 12px（略高略窄）；
- **欢迎页两个 CTA**：8px 16px / 13px / gap 8px 与 `.btn--lg` 逐项吻合，唯一差异是圆角 6px→4px；图标 16px→14px（原 14px 规则本就是死规则，见上文缺陷 3）；
- **变量表「+ 添加变量」按钮**：悬停不再泛红（缺陷 1 修正）。

验证：`npm run build`（tsc + vite build）通过；`npm test`（vitest）20 个测试文件、155 项测试全部通过（含更新选择器后的 CR-04 注入回归测试）；每组迁移后各跑一次，共 5 次全绿。临时脚本（`_migrate_tokens.py` / `_scan_btn.py` / `_verify_css.py`）与 `style.css.bak` 备份均已删除，工作树无残留。

**第三批完结**：UI-18 ✅ 全部完成；UI-08 ✅ 全部完成（体系建立 + 6 组组件迁移 + 完整性双向校验）。

### 2026-09-11 · 第四批（UI-09 + UI-11 + UI-12）已完成

#### UI-09 · Tooltip 双轨制收敛

迁移过程中发现一条**计划里没预料到的硬约束**，它直接决定了方案形态，故先记录：

> **Chromium 不向 `disabled` 的表单控件派发鼠标事件**（事件落到父元素），而自绘 tooltip 靠
> `document` 级 `mouseover` 委托命中 `[data-tip]` —— 因此 `data-tip` 在禁用按钮上会**静默失效**，
> 且功能上看不出任何异常，只有提示悄悄消失。原生 `title` 由渲染层命中测试驱动，禁用态仍显示。

这条约束影响面很大：`git.ts:155` 在无暂存内容时禁用提交按钮、`jsonpath` 的复制按钮**默认就是
disabled**、`manager.ts` 的批量启用/禁用/重命名/删除/重置、`util.ts::setBusy` 的临时禁用……
而「禁用原因」恰恰是最需要提示的信息（如 `delBtn.title = "内置模板不可删除，只能禁用"`）。
若强行全量迁移，等于把全应用价值最高的一批 tooltip 弄丢。

因此确立**五条判定规则**（已完整写入 `shell/src/tooltip.ts` 头部注释，作为后续维护的单一依据）：

| # | 规则 | 处理 |
|---|---|---|
| 1 | 不会被禁用的交互控件（图标按钮 / 工具栏按钮 / 可点击行与热区） | → `data-tip`；图标按钮**必须同时补 `aria-label`** |
| 2 | 带 `disabled`（含动态禁用）的控件 | 保留原生 `title`（已逐一登记例外清单） |
| 3 | 表单控件 `<select>` / `<input>` | 保留原生 `title`（已有可见 label，自绘浮层反而盖住下拉区） |
| 4 | 纯截断披露（路径 / 长文件名 / `名称:行号` / 变量值 / 提交详情） | 保留原生 `title` |
| 5 | **嵌套约束**：祖先保留 `title` 时，后代禁止用 `data-tip` | 父子必须同轨，否则悬停子级时两个提示同时出现 |

规则 1 里的 `aria-label` 是**必需的，不是可选优化**：`codicon()` 产出的 `<i>` 统一带
`aria-hidden="true"`，图标按钮的可访问名称此前 100% 依赖 `title`（全库 `aria-label` 出现次数为 **0**）。
只删 `title` 不补 `aria-label`，屏幕阅读器会读到「未命名按钮」——那是一次实打实的无障碍回归。

**规则 5 是迁移中最容易踩的坑**，实际命中两处，均已把父元素一并迁移：
- `.term-tab`（`title=termTitle(s)`）与其内部 `.term-tab-stop` / `.term-tab-close`；
- `.ew-recent-item`（`title=路径`）与其内部「×」删除按钮。

反例（按规则 4 保留父级 `title`，故子级也保留）：`.tree-item` 与其内部 git 状态徽标。

**实际改动**：index.html 22 处、TS 侧 9 个文件共 15 处迁移；保留原生 `title` 11 处（index.html）
+ 23 处（TS），全部属于规则 2/3/4/5 且有注释说明。

**规则 2 的例外中的例外**：调试工具栏 6 个按钮既是图标按钮、又在「未调试」时全部禁用——
恰好落在两条规则的冲突点上，且那是新用户最依赖提示的场景。故对这一处**改造禁用机制**而非妥协：
`disabled` 属性 → `.is-disabled` 类 + `aria-disabled`，点击守卫移入回调内。收益有三：
① `data-tip` 可用；② 按钮保留在 tab 序列内（`disabled` 会把元素移出焦点序列，等于对键盘用户完全隐藏），
读屏能听到「已禁用」；③ 提示的快捷键改读键位系统（`bindingLabel`），不再硬编码 `(F5)`——
用户改键后提示不会失真（与 UI-25 同类缺陷，此处顺带修掉）。

**顺带修掉 3 个既有缺陷**：
1. **双重提示 bug**：`#btn-tree-hidden` 在 index.html 有静态 `data-tip`，`fileTree.ts` 又动态设
   `title`，两个 tooltip 同时弹出。已统一为只写 `data-tip`。
2. **状态失同步 bug**：`resetTreeState()` 把 `showHiddenFiles` 复位为 `false`，却不清按钮的
   `.active` 类与提示文案 → 关闭工作区后按钮残留高亮，**下次点击时视觉与真实状态相反**。
   已抽出 `syncHiddenFilesBtn()` 作为 `.active` / `data-tip` / `aria-label` / `aria-pressed` 的单一写入点，
   两处调用共用。
3. **死代码**：`main.ts` 的 `ind.title = "正在运行"` 永不生效——`.tab .tab-running` 带
   `pointer-events: none`，浏览器命中测试落不到它身上（改 `data-tip` 同样无效）。已删除并注明。

#### UI-11 · 动效系统补全

CSS 侧：扫描出 **8 处**未走倍率的硬编码时长，全部归档到 token（`0.12s`/`0.13s`/`0.1s` → `--transition-fast`，
`0.15s` → `--transition-base`；差异 ≤20ms 不可感知）。复扫结果：**硬编码 0 处，正确走倍率/token 21 处**。

但只做 CSS 并不满足验收标准（「应用内所有动效」）。`--motion` 是 CSS 变量，**管不到三类自绘动画**，
逐一补齐：

| 遗漏点 | 原状 | 处理 |
|---|---|---|
| vendored codicon 旋转 | `util.ts::spinIcon()` 无条件加 `.codicon-modifier-spin`，其 animation 时长硬编码在第三方 CSS 里 | 加**一条全局 CSS** 压制（同时覆盖设置项与系统 `prefers-reduced-motion`），一处生效于全部调用点，无需各调用方自行判断 |
| Monaco 光标闪烁 | `cursorBlinking` 从未配置，恒为默认 `blink` | 在 `buildEditorOptions()` 内按 `motionDisabled()` 决定——该函数是创建与设置变更的**唯一共用入口**，一处即全覆盖 |
| xterm 光标闪烁 | `terminal.ts` 硬编码 `cursorBlink: true` | 构造时读开关 + 新增 `applyMotionPreference()`（照既有 `applyTheme()` 模式），`termUi.ts` 加 `refreshTerminalMotion()` 遍历已存在实例 |

另覆盖 diff 编辑器（不走 `buildEditorOptions`，改为每次 `ensureDiffEditor()` 重设，中途改开关下次打开即生效）
与右侧两个只读查看器（随工具挂载新建，创建时读一次即可）。

**两个实现陷阱，均已规避**：
1. **可逆性**：Monaco `updateOptions` 是合并语义，未列出的项不会复位到默认值。若只在开启时写
   `cursorBlinking: "solid"`，**关掉开关后光标会一直不闪、直到重启才恢复**。故必须双向显式赋值
   （`motionDisabled() ? "solid" : "blink"`）。
2. **「恢复默认」路径不触发 change**：`resetToDefaults()` 直接给 `.checked` 赋值，不会派发 `change`
   事件，故即时生效的那个监听器不会被调用。保存路径因此也必须挂一次 `refreshTerminalMotion()`。

此外，开关的即时生效监听器里**只单独写 `cursorBlinking`**，不调 `buildEditorOptions(app.settings)`——
后者读的是「已保存」的 settings，在用户还没点保存时套用，会把表单里正在调整的字号/字体先视觉回退掉。

JS 侧另核查了 3 个定时器，确认均为**功能性延时而非动效**，不应受开关影响：
`feedback.ts` 的 `FLASH_MS=1200`（反馈文案阅读时长）、`termUi.ts` 的 `600ms`（等 shell 就绪）、
`main.ts` 的 `250ms`（子菜单悬停意图）。`anim.ts::hideEl` 的 100ms 两阶段隐藏**原本就已**用
`motionDisabled()` 短路，无需改动。

#### UI-12 · 空状态组件推广

- **调试侧栏 3 处**改用 `emptyState(..., compact=true)`（侧栏窄，用紧凑档）：调用栈、变量、断点。
  顺带修掉两处文案缺陷：① `phase==="stopped"` 但无栈帧时，原先塞的是 `textContent=""` 的空 div，
  用户看到彻底空白、无从判断异常还是正常；② 变量面板原先同样是空 div。现均给出明确说明。
  断点空态把原先挤在一行括号里的「标题 + 操作指引」拆成两层，更易扫读。
- **终端面板兜底空态**：此前 `renderTerminalViews()` 只切换已有 view 的显隐，关掉最后一个终端后
  `#terminal-views` 彻底空白。现渲染 `emptyState("terminal", "尚无终端", 引导文案)`，有会话后自动移除。
  已核实渲染时机：`setBottomTab("terminal")` 会自动 `ensureAnyTerminal()` 建终端，故**首次切换不会闪现空态**；
  空态真正生效于「关掉最后一个终端」这条路径（`closeTerminal` → `renderTerminalViews`，且不再自动新建）。
  样式用 `justify-content: safe center`——底部面板可拖到 120px，普通 `center` 在溢出时会把内容向两端
  各推出一半、顶部那半滚动不到（与 UI-04 欢迎页同一类陷阱），`safe` 在放不下时自动退化为 `start`。
- **`.env-empty` → `.hint-text`**：该类名带 `env` 业务前缀却被搜索面板借用（命名泄漏，改环境面板样式
  会误伤搜索面板）。更名为中性类名，样式不变，5 处引用全部更新；CSS 处注明与 `.empty-state` 的分工
  （一行次要提示 vs 图标+标题+说明的完整空态）。
- **`.debug-empty` 删除**：三处空态迁走后该规则成为死代码，已删并留注释说明去向。

#### 测试与验证

新增 `shell/src/__tests__/debugView.test.ts`（9 项），固化本批最容易被后人「顺手简化」破坏的不变量：
禁用态必须用 `.is-disabled` + `aria-disabled`（`expect(b.disabled).toBe(false)`）、
图标按钮必须有 `aria-label`、`data-tip` 与 `title` 不得共存、快捷键须读键位系统而非硬编码、
置灰时点击不触发动作（用注入的 spy handler 断言 `stopCalls === 0`）、三处空态走 `.empty-state.compact`。

**做了变异验证**：临时把 `.is-disabled` 改回 `el.disabled = !enabled`，测试**精准失败 2 项**
（均在「禁用态」块内，含点击守卫——守卫失效后 `stopCalls` 变 1），确认测试非空洞后已还原。

验证：`npm run build`（tsc + vite build）通过；`npm test` **21 个测试文件、164 项测试全部通过**
（原 155 + 新增 9）；`read_lints` 对全部改动文件返回 0 诊断。UI-09 另做了两项自动化核验：
① 按元素标签名归类全部残留 `.title=`，确认只剩规则 2/3/4 类别；② 全库扫描「同一元素同时带
`data-tip` 与 `title`」，结果为 0（脚本报出的 2 处疑似经作用域核验确认为不同函数中的同名变量，属误报）。
临时脚本（`_verify_tip.py` / `_verify_scope.py` / `_scan_motion.py`）均已删除。

#### 需人工抽查的可见变化

- **调试工具栏提示外观改变**（本批最显眼）：原生 title（约 1s 延迟、系统样式）→ 自绘深色卡片
  （300ms 延迟），且快捷键从正文 `(F5)` 变为独立的 `kbd` 副文本样式；
- **调试侧栏三个面板的空态**：从一行灰字变为「图标 + 加粗标题 + 说明」的卡片式空态，视觉重量明显增加；
- **关掉最后一个终端后**：终端面板从一片空白变为居中引导卡片；
- **树头部「显示隐藏文件」按钮**：提示文案由静态的「显示/隐藏隐藏文件」改为随状态变化的
  「显示 dot 文件」/「隐藏 dot 文件」（与改动前 JS 动态设置的文案一致，只是初始态现在也对齐了）；
- **开启「减少动画」后**：加载转圈图标不再旋转（静止为圆弧字形，语义不丢）、编辑器与终端光标不再闪烁；
- Git 工具栏、窗口控制、状态栏分支、拖拽热区、欢迎页最近工作区等处的 tooltip 统一为自绘风格。

**第四批完结**：UI-09 ✅、UI-11 ✅、UI-12 ✅ 全部完成。

**本批为 UI-16 登记的待办**（迁移中发现但未纳入本批范围）：
- 存量 `data-tip` 图标按钮仍缺 `aria-label`：Activity Bar 4 项、menubar-icon 5 项（含运行组 3 + 调试 + 设置）。
  本批只补齐了「因迁移而失去 title」的按钮与树头部同组 3 按钮（只补 1/3 会让同组不一致）；
- 可点击的 `<span>`/`<div>` 缺 `role` 与键盘可达性：`.term-tab-close` / `.term-tab-stop` / `.debug-bp-del`。
  这些元素上 `aria-label` 不会被读屏暴露（role=generic），且本就无 `tabindex`、键盘不可达，
  故本批只统一了视觉轨，已在代码注释中就地标注归属 UI-16；
- 自定义 tree / tablist / dialog 的完整 ARIA 模式（`role="tree"`、`aria-expanded`、`aria-selected`、
  `role="dialog"` + `aria-modal`、tooltip 的 `role="tooltip"` + `aria-describedby`）仍全部缺失。

### 2026-09-11 · 第五批（UI-15 + UI-17）已完成

#### UI-15 · 浅色主题语法色适配

验收标准要求 ≥4.5:1，故**没有凭观感挑色值**，而是按 WCAG 2.x 相对亮度公式逐项核算
（脚本用后即删）。核算口径取保守值：浅色主题按最暗的浅底 `#ececec`（`--bg-panel`）算——
深色文字落在越暗的底上对比越低，它达标则 `#ffffff` / `#f3f3f3` 必然达标。

**新增 12 个 token**，深色值沿用 VS Code Dark+、浅色值取 Light+ 的对应 token 色，
使调试变量面板 / JSONPath 查看器的着色与 Monaco 编辑器内的 Python 高亮同源同一体系：

| token | 深色 | 浅色 | 浅色对比度 |
|---|---|---|---|
| `--syntax-var` | `#9cdcfe` | `#001080` | 12.83:1 |
| `--syntax-string` | `#ce9178` | `#a31515` | 6.64:1 |
| `--syntax-number` | `#b5cea8` | `#0a6e46` | 5.34:1 ⚠ |
| `--syntax-boolean` | `#569cd6` | `#0000ff` | 7.27:1 |
| `--syntax-null` | `#808080` | `#666666` | 4.86:1 ⚠ |
| `--syntax-object` | `#e8c07d` | `#795e26` | 5.16:1 |
| `--syntax-array` | `#d19a66` | `#9a4d00` | 5.17:1 |
| `--debug-breakpoint` | `#e51400` | *（两主题共用）* | 深底 3.52 / 浅底 4.01:1 |
| `--debug-line-bg` | `rgba(245,197,24,.18)` | `rgba(245,200,30,.45)` | 其上正文 10.14:1 |
| `--debug-line-outline` | `rgba(245,197,24,.5)` | `rgba(163,123,0,.85)` | 3.08:1（图形） |
| `--debug-line-margin` | `#f5c518` | `#a37b00` | 3.90:1（图形） |
| `--debug-frame-active` | `rgba(84,116,224,.2)` | `rgba(14,99,156,.18)` | 可辨识 1.31:1 |

⚠ = **偏离 Light+ 原值**，因其不达标：number 的 Light+ 原值 `#098658` 仅 3.90:1、
null 原硬编码 `#808080` 仅 3.95:1，均加深后达标。

改动前浅色主题的实际表现（同一批色值直接落在白底）：`1.49 / 2.64 / 1.70 / 2.95 / 3.95 / 1.71 / 2.46:1`
——**七项无一满足 AA**，其中 `.debug-var-name` 的 1.49:1 最严重。

**三处按图形对象（WCAG 1.4.11，需 ≥3:1）而非文字标准处理**：断点圆点与 gutter 图标、
当前行描边、gutter 左侧指示条。其中 `--debug-line-margin` 原值 `#f5c518` 在白底仅 **1.63:1**，
作为图形指示严重不足，已加深到 3.90:1。断点红 `#e51400` 经核算两主题均 ≥3:1
（深底 3.52 / 浅底 4.01），故**不随主题变化**——与 VS Code 一致，断点红是跨主题稳定的身份色，
少一组需要维护的覆盖值。

**一处物理上限，已记录推理而非硬凑数字**：黄色高亮底在白底上的可辨识度天花板约 1.25:1
（黄色本身亮度高，深色主题的 1.52:1 无法在浅色下对等复现，VS Code 浅色主题同样如此）。
当前执行行是「底色 + 描边 + gutter 指示条」三重线索，3:1 的非文本对比由后两者承担
（3.08:1 / 3.90:1），底色只负责区域感，其上正文对比仍有 10.14:1。

**核算过程中发现 3 个计划外的既有缺陷，一并修掉**：

1. **浅色主题 `--warn` 自身就不达标**（`#8a6d00` → 面板底 4.16:1）。这意味着**光修 `--warning`
   笔误是不够的**：只会把 `.pkg-outdated` 从 1.58:1 的灾难换成 4.16:1 的「差一点」。
   进一步核算 `.search-hit`（`--warn` 文字叠在 `--warn-soft` 底色上）发现合成后仅 **3.57:1**——
   即浅色主题下的搜索命中词**今天就是不合格的**，与本批任务无关的存量缺陷。
   已将浅色 `--warn` 加深到 `#6f5800`（面板底 5.79:1、叠 `--warn-soft` 4.96:1，两处均达标）。
   受益面：`.search-hit`、`.git-commit-item .hash`、`.lt-kind-surround`、`.storage-badge-part`、
   `.pkg-outdated` 及两个状态点。`--warn-soft` / `--warn-border` 是填充与描边（非文字），保持原值。
2. **`var(--accent, #4a9eff)` 的兜底值是过期的**——`--accent` 实际是 `#0e639c`，兜底值与之根本不符。
   这类「死兜底」比裸色值更危险：一旦哪天真被用上，颜色会是错的。已删除
   （同批还清掉 `.debug-stack-frame:hover` 的 `var(--hover, rgba(128,128,128,.15))`）。
3. **`.lt-group-drop` 的硬编码阴影是全部浮层里唯一的离群值**（`.ctx-menu` / `.oc-tooltip` 等均走
   `--shadow`）。收归 token 后三重收益：合规、与其它浮层同一海拔、随主题变淡
   （浅色下 0.35 的黑色投影过重，`--shadow` 浅色值是 0.18）。

`--warning` → `--warn` 笔误已修正。**验证**：剥离注释后扫描全文件，
token 定义之外的裸色值 **0 处**（改动前 12 处）。

#### UI-17 · 最小字号提到 11px

UI-18 已为此铺好路（`--text-2xs` 的注释当时就写着「UI-17 统一提到 11px 后删除本档」）。
本批删除该过渡档，6 处用点全部改指 `--text-xs`（11px）。

因字号上调会使宽度增加约 10%，**逐一核实了 6 处的溢出风险**，全部安全：

| 用点 | 吸收增量的机制 |
|---|---|
| `.git-badge`（M/A/D/U/R/C） | `.tree-item .name` 带 `overflow:hidden` + ellipsis |
| `.env-item .badge`（工作区/手动/系统） | `.env-item .path` 同上 |
| `.lt-badge`（模板类型） | `.lt-row .lt-desc` 为 `flex:1` + ellipsis |
| `.jp-badge`（JSON 类型） | `.jp-row .jp-value` 为 `flex:1` + ellipsis |
| `.oc-tooltip kbd`（快捷键） | 浮层 `nowrap`，宽度由内容撑开，自适应 |
| `#outline-toggle`（折叠箭头） | 图标字形，不占文本宽度 |

另核实 `.lt-badge` / `.git-badge` 的高度由 `line-height`（16px）与 `padding` 决定而非字号，
故纵向排布不受影响。

**验证**：style.css 全部 **158 处 `font-size` 现已 100% 走 token**（唯一非 token 值是 `inherit`，
不是尺寸），最小档确为 11px。分布：xs(11px) 45 处 · sm(12px) 79 · base(13px) 17 · md(14px) 9 ·
lg(16px) 6 · xl(24px) 2。

**附带**：`index.html` 的防 FOUC 首屏兜底样式块含裸值 `13px` / `#1e1e1e` / `#d4d4d4`，
这是**合理且必要的例外**——该块必须在 `style.css` 之前生效，那时 `:root` 里的 token 还不存在，
无法用 `var()`。但它与 token 存在**隐式同步义务**，改 token 时会静默 diverge，已就地补注释登记
对应关系（`#1e1e1e`=`--bg`、`#d4d4d4`=`--fg`、`13px`=`--text-base`、浅色 `#ffffff`/`#333333`）。

#### 本批发现但未纳入范围的存量问题（建议另立条目）

编辑器/终端字号未接入用户设置，与 UI 字号体系脱节：

- `terminal.ts:43` 硬编码 `fontSize: 13` 与 `fontFamily: 'Consolas, "Cascadia Code", "JetBrains Mono", monospace'`
  ——**完全忽略 `settings.font_size` 与 `settings.font_family`**，用户在设置里改字号/字体后终端不跟随；
  且该字体栈与 `--mono` token 重复维护（UI-28 只统一了 CSS 侧，JS 侧这处漏网）；
- `devtools/jsonpath/index.ts:141` 与 `devtools/curl2python/index.ts:77` 硬编码 `fontSize: 12`，
  同样不跟随用户设置（二者是只读预览器，影响较小）。

对照：主编辑器与 diff 编辑器都正确走 `settings.font_size`。建议合并为一个新条目
（如 UI-29「编辑器/终端字号与字体族接入用户设置」），涉及 `terminal.ts`、两个 devtools 工具、
以及主题/字体变更时对已存在 xterm 实例的运行时刷新（可复用本批为 UI-11 建立的
`applyMotionPreference()` / `refreshTerminalMotion()` 同款模式）。

#### 验证

`npm run build`（tsc + vite build）通过；`npm test` 21 个测试文件、164 项测试全部通过；
`read_lints` 对 `style.css` 与 `index.html` 返回 0 诊断。
临时核算脚本（`_contrast.py` / `_contrast2.py` / `_contrast3.py`）均已删除，工作树无残留。

本批为纯 token 层改动，不涉及结构或交互逻辑，故未新增测试；对比度结论以核算数据形式
写入 CSS 注释（每个 token 后标注实测比值），后续若调整取值可直接复核。

**第五批完结**：UI-15 ✅、UI-17 ✅ 全部完成。

**需人工抽查的可见变化**（**仅在浅色主题下**，深色主题零变化）：
- JSONPath 查看器的键/字符串/数字/布尔/null/类型徽标全部换色（原为深色系，在白底上几乎看不清）；
- 调试侧栏变量名由浅蓝 `#9cdcfe` 变为深蓝 `#001080`；
- 断点相关的黄色装饰（当前行底/描边/gutter 指示条）明显加深，尤其在白底上；
- 搜索命中词、提交历史 hash、模板类型徽标、包「有新版」标记的琥珀色统一加深；
- 分组下拉的投影变淡。

深色主题下唯一变化是 6 处徽标/角标由 10px 变 11px（UI-17）。

**待推进**：第六批（UI-16 ARIA 语义，工作量最大——第四批已铺垫：图标按钮 `aria-label`、
调试工具栏 `aria-disabled`、`#btn-tree-hidden` 的 `aria-pressed` 均已就位，待办清单见第四批记录末尾）；
第七批（UI-19、UI-21、UI-22、UI-27 视觉层次与信息密度）；
第八批（UI-23 ~ UI-26 响应式边缘情况与细节打磨）。
另建议新增 UI-29（编辑器/终端字号与字体族接入用户设置，见上文）。

### 2026-09-11 · 第六批（UI-16 ARIA 语义）已完成

四类模式（tree / tabs / dialog / tooltip）全部补齐，第四批登记的三项待办全部落地。
本批**纯语义层改动，视觉零变化**；交互层新增了键盘可达性（见文末抽查清单）。

#### tree（`fileTree.ts` + `index.html`）

- `#tree` 容器 `role="tree"` + `aria-multiselectable="true"`（Ctrl/Shift 多选是既有能力）+
  `aria-labelledby` 指向「文件」标题；
- 节点 `role="treeitem"` + `aria-selected`；目录加 `aria-expanded`，与 twisty 箭头/文件夹图标
  **同源切换**（`toggleDir` / `collapseAll` / 局部刷新三条路径都过同一写入点）；
- 选中态抽出 `setTreeItemSelected()` 单一写入点——`.active` 类（视觉）与 `aria-selected`（读屏）
  一次写入，Ctrl 单选切换 / Shift 范围选 / 普通单选三条分支共用（第四批 `syncHiddenFilesBtn` 同款教训：
  散落两写必然漂移）；
- `.tree-children` 子级容器 `role="group"`；借用 `.tree-item` 类名的非树节点
  （内联重命名输入行、空目录占位）标 `role="presentation"`，避免读屏把它们误当 treeitem。

#### tabs（6 组 tablist）

**原生 button 组**（Activity Bar / 底部面板 / devtools / 设置导航）：容器 `role="tablist"`
（竖排者加 `aria-orientation="vertical"`）+ `aria-label`；按钮 `role="tab"` + `aria-selected` +
`aria-controls`；面板 `role="tabpanel"` + `aria-labelledby`。`aria-selected` 一律在**既有单一写入点**
与 `.active` 类同源切换：`views.ts::setSidebarTab`、`termUi.ts::setBottomTab`、
`devtools/panel.ts::activateTool`、`settingsPanel.ts::switchCategory`，未新增任何切换路径。

**div 组**（编辑器 `renderTabs`、终端 `renderTerminalTabs`）：除 role/aria-selected 外，补齐了
tablist 模式要求的键盘交互——漫游 tabindex（激活项 0、其余 -1）+ Enter/Space 激活 + ←→ 环绕移动。
两个实现要点：
1. **重绘焦点恢复**：两处渲染都是 `textContent=""` 全量重建，正在聚焦的 tab 元素会被销毁、
   焦点掉回 body。渲染前记录焦点（编辑器按 `data-path`、终端按 `data-term-id`），渲染后找回；
   原焦点 tab 已被关闭时落到激活项（与鼠标行为一致）。
2. **可访问名称收敛**：`.term-tab` 的名称若从内容计算，会把子级关闭按钮的 aria-label 混入
   （「终端 1 · pwsh 关闭终端」），故显式 `aria-label=会话标题`；编辑器 tab 的
   「已修改 / 运行中」状态并入 aria-label（承接 UI-09 对 `.tab-running` 死代码的遗留说明），
   转圈图标本体 `aria-hidden`。

编辑器 tablist **不设 `aria-controls`**：所有 tab 共享同一个 Monaco 面板，逐 tab 声明独立
tabpanel 与事实不符（不如实声明好过错误声明，已在 index.html 注释说明）；devtools 同理
（tab 共同指向 `#devtools-body`）。

#### dialog（8 个模态）

- 全部 `.modal-card` 补 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
  （各模态标题 span 补了 id：`env-modal-title` / `new-project-title` / `run-config-title` /
  `settings-title` / `surround-title` / `storage-ob-title`）；
- `#palette-modal` 无标题行（placeholder 不是名称来源）→ `aria-label="插入模板"`；
- confirm/alert 的标题可省略 → `dialog.ts::openModal` 按有无标题**动态切换**
  `aria-labelledby` ↔ `aria-label`（取消息首行，60 字截断），避免无名对话框读屏只报「对话框」；
- `#confirm-modal` / `#storage-onboarding-modal` 加 `aria-describedby` 指向正文/说明。

#### tooltip（`tooltip.ts`）

浮层 `role="tooltip"` + 固定 id；显示期间给触发元素挂 `aria-describedby`（WAI-ARIA APG：
tooltip 必须由被描述元素引用才可被读屏播报），隐藏时解除。两个细节：
1. **不吞既有描述**：元素原有的 `aria-describedby`（如表单校验提示）保存后**追加**、
   隐藏时**还原**，而非粗暴 set/remove；
2. 三条隐藏路径（切换目标 / mousedown / window blur）全部经过 `detachDescribedBy()`，无泄漏。

#### 第四批待办三项的落地

1. **存量 data-tip 图标按钮补 aria-label**：Activity Bar 4 项 + menubar-icon 5 项
   （运行组 ▶/⏹/▾ + 调试 + 设置），index.html 静态补齐；
2. **可点击 span/div 补 role=button + tabindex=0 + Enter/Space 激活**：
   `.term-tab-close` / `.term-tab-stop` / `.term-tab-add`（termUi 抽出 `makeSpanButton()` 统一实现）、
   `.debug-bp-del`（aria-label 带 `文件:行号` 定位，避免多个「删除断点」无法区分）；
   **同类未点名的一并处理**：编辑器 tab `.close`、`.debug-bp-label`、`.debug-stack-frame`、
   `#outline-header`（disclosure 语义：role=button + `aria-expanded` 与 `.collapsed` 类同源）；
3. **开关按钮补 aria-pressed**：`#search-case`（main.ts 与 `.active` 同源）、
   jsonpath 的 JSONPath/Python 模式对（初始态原直接 `classList.add("active")` 绕过 `setMode`，
   会漏掉 aria-pressed，已改走 `setMode("jsonpath")`）。

#### 附带修正

- **焦点样式覆盖**：本批新增可聚焦元素 8 类全部纳入 `style.css` 的全局 `:focus-visible` 规则
  （D1 P-02 预留的选择器列表，`.tab`/`.term-tab` 早已在列——「规则先行就位，接入即生效」兑现）；
  其中小尺寸元素（tab 关闭钮 / 停止钮 / 断点删除钮）用 `outline-offset:-1px` 内描边，
  避免 2px 外描边溢出挤占相邻热区；
- 焦点规则头部注释同步更新（「div 列表项当前多无 tabindex」的表述已过时）。

#### 测试与验证

新增 `tooltip.test.ts`（4 项：role/id、显示挂关联、隐藏解除、**既有 aria-describedby 追加-还原**、
目标切换迁移）与 `views.test.ts`（3 项：aria-selected 与 .active 同源、面板显隐联动、互斥语义）；
`debugView.test.ts` 扩展 2 项（bp-del 的 role/aria-label/tabindex + **Enter 真删断点**、
bp-label 键盘可达）。

**做了变异验证**：临时删除 `views.ts` 的 `aria-selected` 同步行 → `views.test.ts` **精准失败 3/3**，
确认非空洞后已还原。

验证：`npm run build`（tsc + vite build）通过；`npm test` **23 个测试文件、173 项测试全部通过**
（原 164 + 新增 9）；`read_lints` 对全部改动文件返回 0 诊断。

#### 需人工抽查的可见变化（视觉零变化，交互有新增）

- **Tab 键序列变化**（本批最需适应的一点）：编辑器/终端 tab 条现在可聚焦（漫游 tabindex：
  只有激活 tab 是 tab stop），tab 内的关闭/停止按钮、调用栈帧、断点行的定位标签与删除钮、
  大纲折叠头都成为 tab stop——tab 总数比之前多；
- **←→ 方向键**可在编辑器 tab、终端 tab 之间环绕移动（Enter/Space 激活）；
- 读屏聚焦编辑器 tab 时播报「文件名，已修改，运行中」；聚焦终端 tab 只报会话标题
  （子按钮名称不再混入）。

#### 本批发现但未纳入范围的存量缺口（建议另立条目或并入后续批次）

- **菜单语义**：`#ctx-menu` / `#menu-dropdown` / `#menu-submenu` 无 `role="menu"`/`"menuitem"`，
  菜单项无键盘导航（↑↓/Home/End）。不在 UI-16 的四类模式清单内，且涉及 `menu.ts` 与
  main.ts 菜单栏两套渲染器，工作量独立，已登记为 **UI-30**（见 §3 任务总览）；
- **状态栏芯片**：`#status-engine`（有 tabindex=0 但无 role）与 `#status-interpreter`
  （可点击 span，无 tabindex/role）——点击分别弹菜单/模态，宜补 `role="button"` +
  `aria-haspopup`，改动极小，建议并入第七批顺带处理；
- 其余 div 列表项（`.scm-item` / `.env-item` / `.outline-item` / `.palette-item` 等）
  仍无键盘可达性，焦点规则已预留，接入时即生效。

**第六批完结**：UI-16 ✅ 全部完成。

**待推进**：第七批（UI-19、UI-21、UI-22、UI-27 视觉层次与信息密度，建议顺带处理状态栏芯片语义）；
第八批（UI-23 ~ UI-26 响应式边缘情况与细节打磨）；UI-29（编辑器/终端字号与字体族接入用户设置）；
UI-30（菜单 ARIA 与键盘导航，本批新登记）。

### 2026-09-11 · 第七批（UI-19 + UI-21 + UI-22 + UI-27 + 状态栏芯片语义）已完成

本批以 CSS/结构层改动为主，唯一的新增交互逻辑是 UI-22 拖拽分隔条（落在 `layout.ts`，未向 `main.ts` 堆逻辑，符合约束）。
另顺带处理第六批登记的「状态栏芯片语义」缺口。

#### UI-19 / UI-27 · 标题栏功能分区

标题栏四个功能 zones（菜单区 / 动作区 / 设置区 / 窗口控制区）此前只靠一个 `.spacer` 分左右，相邻 zone 间无边界。落地：

- 新增可复用 `.menubar-sep`（1px × 16px 垂直居中，`--border-soft`，两侧 `--space-2` 间距，`aria-hidden`），
  在**两处相邻边界**插入：「工具菜单│运行组」「设置│窗口控制」；
- **动作区│右侧系统区之间不放实线**：该处是 `.spacer`（`flex:1`）弹性空隙，宽度随窗口变化，
  在弹性空隙里放孤立分隔线会随窗口宽度漂移、观感割裂。故这一边界由 spacer 的弹性间距承担（本就是「左右两半」的自然分界），
  实线只加在元素相邻、间距固定的两处；
- `#run-group` / `#win-controls` 原各自的 `margin-left: --space-3` **删除**——分隔职责移交 `.menubar-sep`，
  否则「sep 两侧 8px + 原 margin 12px」叠加会使分区间距过宽（≈33px）。删除后 zone 间距由 sep 统一提供（≈21px）。

> 拖窗区无回归：`main.ts` 的 menubar `mousedown` 拖窗守卫排除 `button/select/input/#win-controls`，
> `.menubar-sep` 是装饰性 `<span>`，落在可拖拽空白区内（与拖标题栏空白处行为一致），不影响任何交互元素。

#### UI-21 · 状态栏窄窗口响应式

`style.css` 此前**无一条 `@media`**，状态栏各项固定 `max-width` 之和在窄窗口下会溢出。落地：

- `#statusbar` 加 `overflow: hidden`——最终兜底，超出裁剪，绝不换行/撑破 24px 固定高度；
- `#statusbar > span` 加 `min-width: 0`——这是关键：`white-space: nowrap` 文本的 `min-content` 等于整串宽度，
  flex 项默认收缩不到 `min-content` 以下，不加 `min-width:0` 则 `overflow`/`text-overflow` 无从生效、仍会顶破容器；
- `#status-git`（分支名可长）、`#status-lsp`（异常时是「LSP 启动失败: …」长串）此前**无 max-width**，补齐 `max-width`+`overflow`+`ellipsis`
  （`#status-file`/`#status-interpreter`/`#status-engine` 原本已有）；
- 新增 `@media (max-width: 900px) { #status-font { display: none } }`——字号芯片（「字号 N」）是状态栏信息价值最低、
  且完全静态的一项，窄窗口下优先隐藏让位；其余项靠 `min-width:0`+`overflow` 弹性截断。

收缩优先级天然合理：`.spacer`（`flex:1`，basis 0）先塌缩到 0，再由各芯片按 `flex-shrink` 比例收缩，
其中 `#status-file`（basis 最大，≤42%）绝对收缩量最大、最先截断，右侧身份芯片（解释器/引擎/LSP）保留更完整。

#### UI-22 · 文件树 / 大纲可拖拽分隔条

`#view-files` 内、`#tree` 与 `#outline-section` 之间插入 `#outline-splitter`（复用既有 `.splitter splitter-row` 样式与
`layout.ts::startDrag`/localStorage 持久化机制，新增 `OUTLINE_KEY`）。**两个关键设计决策**：

1. **默认态逐字保持改动前行为**：计划把「符号多不够用」与「无符号浪费 40% 空间」并列为待修问题。
   若简单改成固定 `height: 40%`，只解决前者、却把后者坐实（无符号文件也强占 40% 空白）。
   故默认仍为 `height: auto` + `max-height: 40%`（内容高、上限 40%，与改动前**逐字一致**）；
   仅在**用户拖拽后**转为固定 px 高并解除 40% 封顶（`--outline-max: none`），从而「符号多可拖大、符号少不占空」两个问题都解。
   双击清除内联覆盖 → 回落默认（"重置为默认比例"）。
2. **写自定义属性 `--outline-h`/`--outline-max`，而非内联 `height`/`max-height`**：`#outline-section` 有折叠态
   （`.collapsed` 时 `#outline{display:none}`，应收起到 header 高）。内联样式特异性最高，若拖拽写内联 `height`，
   会压过样式表的 `.collapsed { height: auto }`——**拖过一次后就再也折叠不上**（且要拖过才暴露的静默回归）。
   改用内联自定义属性后，`height`/`max-height` 声明仍来自样式表，`.collapsed`（特异性 1,1,0 > 基础规则 1,0,0）可正常覆盖，
   折叠始终生效；展开时 `height: var(--outline-h, auto)` 又自动恢复上次拖拽高度。

拖拽数学：`#outline-section` 是 `#view-files` 最后一个子元素，其**底边锚定在视图底部、不随高度变化**（`#tree{flex:1}` 吸收差值），
故「高度 = 固定底边 − 鼠标 Y」，`mousedown` 时捕获一次底边即可。上限按 `viewFiles.clientHeight × 0.6` 动态 clamp（保证文件树 ≥40%），下限 60px。
折叠态下拖动先 `remove("collapsed")` 再调整（同底部面板分隔条）。`restoreLayout` 启动恢复时对存量值按 `window.innerHeight` 兜底裁剪。

> 与既有 `#bottom` 分隔条的一处差异（更优）：`#bottom` 拖拽写内联 `height`，其 `.collapsed{height:28px}` 在拖过后同样会被内联值压过
> （既有潜在缺陷，不在本批范围）；`#outline-section` 用自定义属性规避了该问题。

#### 状态栏芯片语义（第六批登记，本批顺带）

- `#status-engine`（原已有 `tabindex=0` + Enter/Space 键盘激活，弹引擎菜单）：补 `role="button"` + `aria-haspopup="menu"`；
- `#status-interpreter`（原为可点击 span，无 tabindex/role，弹环境面板模态）：补 `role="button"` + `aria-haspopup="dialog"` + `tabindex="0"`，
  `main.ts` 就地补 Enter/Space 键盘激活（对齐 `engineChip.ts` 既有模式，未新增功能域函数），CSS 补 `#status-interpreter:focus-visible` 入全局键盘焦点规则；
- `aria-expanded`（菜单/弹窗开合态）需跟踪浮层生命周期，属菜单语义范畴，**归 UI-30 统一处理**，本批不单独引入（避免与 UI-30 重复改动 `menu.ts`）。

#### 测试与验证

新增 `shell/src/__tests__/layout.test.ts`（5 项），固化 UI-22 最易被后人「顺手简化」破坏的不变量：
拖拽写 `--outline-h`/`--outline-max` **而非内联 `height`**（`expect(outline.style.height).toBe("")`）、
clamp 上下限、双击清除回落默认、折叠态拖动先展开、`restoreLayout` 恢复。

**做了变异验证**：临时把拖拽改成写内联 `outlineSection.style.height`（正是最可能被误改的方向），
测试**精准失败 3 项**（所有断言 `--outline-h` 值的用例），确认非空洞后已还原。

验证：`npm run build`（tsc + vite build）通过，无类型错误；`npm test`（vitest）**24 个测试文件、178 项测试全部通过**
（原 173 + 新增 5）；`read_lints` 对全部改动文件（`index.html`/`style.css`/`layout.ts`/`main.ts`/`layout.test.ts`）返回 0 诊断。
本批未向 `main.ts` 新增函数或模块级状态（仅解释器芯片键盘激活一处就地扩展）。

#### 需人工抽查的可见变化

- **标题栏**：「工具」菜单与运行组之间、「设置」与窗口控制按钮之间各多一条 16px 高的细竖线；
  运行组、窗口控制与相邻元素的间距略变（原 12px margin 换成 sep 两侧 8px，净间距≈21px）；
- **文件树 / 大纲**：两者之间可上下拖拽调整高度（悬停显示 `--accent-soft` 热区、拖动显示 `--accent`），双击重置；
  **默认外观与改动前一致**（未拖拽时仍是内容高、上限 40%），拖动过后刷新保持；
- **状态栏**：窗口拖窄到 ≤900px 时「字号 N」芯片消失；更窄时文件路径/分支/LSP 文本截断而非换行或溢出；
- **状态栏芯片**（读屏/键盘）：解释器、引擎芯片现为可聚焦按钮，Tab 可达、Enter/Space 可激活，读屏报「按钮，有弹出菜单/对话框」。

**第七批完结**：UI-19 ✅、UI-21 ✅、UI-22 ✅、UI-27 ✅ 全部完成（+ 状态栏芯片语义）。

### 2026-09-11 · 第八批（UI-23 + UI-24 + UI-25 + UI-26）已完成

#### UI-23 · 三栏布局的宽度下限（计划前提有误，先纠偏）

计划写「无 Tauri 层面的 min_width 约束（需核对 tauri.conf.json）」——核对结果：`tauri.conf.json` 的 `app.windows` 是**空数组**，
本项目窗口在 `lib.rs::run()` 里用 `WebviewWindowBuilder` 手动构建，那里**早就有** `.min_inner_size(800.0, 600.0)`。
故本项不是「加约束」，而是「补上约束覆盖不到的那半边」：

窗口下限 800 并不足以保住编辑区。`#sidebar` / `#right-panel` 原先都是 `flex: none`（不可收缩），`#center` 是 `flex:1` + `min-width:0`，
于是**默认宽度**（侧栏 280 + 右面板 360）在 800px 窗口下就把编辑区压到 160px；两侧都拖到上限（480+560=1040）时编辑区被压到 **0**——
正是计划描述的「编辑器被挤没」，而它发生在窗口下限**之内**，`min_inner_size` 拦不住。

落地（方案①的补强，纯 CSS 下限 + 拖拽上限收口，不引入方案②「自动收起面板 + 一次性提示」那套额外状态）：

| 位置 | 改动 | 效果 |
|---|---|---|
| `#sidebar` | `flex:none` → `flex:0 1 auto` + `min-width:180px`（= `SIDEBAR_MIN`） | 空间不足时按比例让位，不再无限挤压编辑区 |
| `#right-panel` | 同上，`min-width:260px`（= `RIGHT_MIN`） | 同上 |
| `#center` | `min-width:0` → `240px` | 编辑区硬下限；三者下限之和 680 < 800，任何面板组合都不溢出 |
| `layout.ts::dragMax()` | 上限 = min(硬上限, 窗口宽 − 编辑区下限 − 对面面板实际宽)，mousedown 时算一次 | 见下 |

- **拖拽上限为什么要动态收口**（计划里没有这一步，是补上 flex 收缩后暴露的手感问题）：面板可收缩后，写进 `style.width`
  的值在窄窗口下会被 flex 吃掉——若仍按 `SIDEBAR_MAX=480` 这种「窗口够宽时才成立」的常量夹取，就会出现
  **「鼠标在动、分隔条不跟」的粘滞手感**（设 480、实渲染 258）。收口后设进去的宽度就是当下真能渲染出来的宽度；
  对面面板收起时（`display:none`）rect 宽为 0，上限自然退回硬上限；可用空间不足自身下限时守住下限（不写出比 `min-width` 更小的值）。
- **编辑区下限只有一份真值**：`centerMin()` 在 mousedown 时读 `getComputedStyle(#center).minWidth`（不在 mousemove 里读，
  避免每帧触发样式重算），读不到才回落同值常量——TS 侧不另立一个会与 CSS 漂移的常量。
- `lib.rs` 的 `min_inner_size` 处补注释登记取值依据（680 下限之和 + 余量）与两条**调整禁区**：下调前须核对那组下限；
  上调到 900 以上会让第七批 UI-21 的 `@media (max-width:900px)` 在打包应用内永不触发。
  （即第七批末尾提示的「协调取值」，核对结论：800 < 900，该断点在 800–900 区间内确实可达，无需改动。）
- 配套：欢迎页快捷键网格加**容器查询**（`#editor-overlay` 设 `container-type:inline-size`，≤560px 降单列）。
  用容器查询而非视口媒体查询，因为决定可用宽度的是**编辑区**宽度而不是窗口宽度——同样 1000px 的窗口，
  收起双面板时两列更好、展开双面板时单列更好。容器声明放在 `#editor-overlay` 而非 `#center`，避免给承载 Monaco 的元素套 containment。

#### UI-24 · 设置面板窄窗口

- 断点值 720px 是推导出来的，不是拍的：卡片宽 = `min(820px, 94vw)`，表单区宽 = 94vw − 40(卡片内边距) − 190(导航含 padding-right)
  − 28(内容区 padding-left) = 0.94vw − 258；要保住 ≥420px（label 160 + gap 28 + 控件 ~200）即需 vw ≥ 721。
- 窄窗口下 `.settings-layout` 转竖排、`.settings-nav` 转横向滚动 tab 条（分类一个不少，`overflow-x:auto`，
  品牌指示条从左侧 2px 换到底部 2px），`.settings-content` 拿回整幅宽度。
  **未动 `.lt-body`**（模板页双栏）：该断点下内容区仍有 ~651px，300px 列表 + ~340px 编辑器可用，改堆叠反而损失高度。
- **`aria-orientation` 必须跟着排布方向改**：`settingsPanel.ts::syncNavOrientation()` 用 `matchMedia` 监听同一断点，
  竖排 `vertical` / 横排 `horizontal`。读屏播报的方向键语义（↑↓ vs ←→）与视觉排布不符会直接误导键盘用户，
  这类缺陷「视觉对了就看不出」，故显式处理。断点常量在 TS 与 CSS 各一份，两处均注释指向对方。
- **诚实记录**：窗口下限是 800px，故本断点在打包应用内当前**不会触发**（800px 时表单区还有 ~534px，够用）。
  它是为 dev 模式的浏览器窗口（可任意收窄）与「将来下调窗口下限」兜底——不把可用性寄托在窗口约束上。
  与 UI-21 的 900px 断点不同：那条落在 800–900 的可调区间内、确实会触发。

#### UI-25 · 欢迎页快捷键跟随键位系统

- 新增 `welcomeShortcuts.ts`（不往 `main.ts` 堆逻辑：main.ts 只有 3 行接线）。条目分两类，**勿误以为是漏改**：
  - `kb`：键位系统有条目的动作（保存 / 全局搜索 / 运行 / 跳转定义）→ 读 `bindingLabel()`，改键即跟随；
  - `fixed`：Monaco 内建、不在键位系统内的动作（查找引用 `Shift+F12` / 格式化文档 `Shift+Alt+F`）→ 只能固定。
    哪天把它们纳入键位系统，字段从 `fixed` 换成 `kb` 即可，渲染逻辑无需改动。
- **唯一可见变化**：「跳转到定义」由恒显 `F12` 改为显示用户配置的键（出厂 `Ctrl+B`）。依据是 `KEYBINDING_META` 里该条目的
  label 本就写着「跳转定义（F12 / Ctrl+点击固定保留）」——F12 是 Monaco 固定保留键，故把它设为该条目的 `fallback`：
  用户解绑 Ctrl+B 后显示回落 F12（此时 F12 仍然可用），而不是报「未绑定」。
- **解绑且无兜底 → 显示「未绑定」占位**（`.ew-kbd-none`），既不渲染空 kbd 框、也不整行删除：整行消失会让用户以为功能没了，
  空框则是渲染缺陷（同第四批「`data-tip-key` 为空串必须 delete 属性」的同款陷阱）。
- `keybindings.ts::bindingChord()` 负责把 `"Ctrl+Shift+F"` 拆成 `["Ctrl","Shift","F"]`：修饰键归一大小写（control→Ctrl）、
  末位单字符主键转大写（用户写 `ctrl+s` 也显示 `S`）、功能键与符号原样保留；**非法串整串作一段返回**（不猜拆法也不丢信息）、
  空串返回 `[]`。与 tooltip 的 `data-tip-key` 分工不同：那里整串一个 kbd 框（浮层空间紧张），这里每段一个框。
- **首屏不露空**（实现要点）：渲染点放在 `init()` 的**首个 await（Monaco 动态包）之前**。覆盖层是静态 HTML、首帧即可见，
  而设置加载与 LSP 启动都在其后；若只在 `updateEditorOverlay()` 里渲染，启动的头一两秒会露出「只有标题、没有内容」的快捷键区。
  此刻画的是 `DEFAULT_SETTINGS` 的出厂键位，`loadSettings()` 完成后由 `updateEditorOverlay()` 刷成真实值（多数用户二者相同）。
  另在 `saveSettingsPanel()` 里补一次——与既有 `repaintRunWidget()` 同理由：保存路径不经 `updateEditorOverlay`。
- CSS 侧给 `.ew-shortcut kbd` 补 `flex:none`：键位分段不参与收缩，宁可让后面的说明文字截断（`.label` 本就有 ellipsis），也不把 kbd 压变形。

#### UI-26 · 主题预览色卡

- 计划给了三条路（自绘下拉 / 复用 `menu.ts` / 退化为文字「Dark（深色）」）。选**自绘单选组（两张迷你预览卡）**：
  菜单式下拉一次只能看到展开后的列表，而验收标准要「直观预览**两种**主题的基调色」——并排两张卡才同时可见、
  且当前选中项一目了然；退化为纯文字则根本没有色卡，等于没做。
- 每张卡是 96×60 的迷你窗口示意（左侧栏条 + 三条正文色带，首条用强调色）。**色值登记为 8 个 `--theme-pv-*` token**，
  取值与两套主题的实际 token 逐项对齐（深色 = `--bg #1e1e1e` / `--bg-panel #1b1b1b` / `--fg #d4d4d4` / `--border #3c3c3c`；
  浅色 = `#ffffff` / `#ececec` / `#333333` / `#d4d4d4`），不是凭观感挑的。
  **这组 token 刻意不进 `[data-theme="light"]` 覆盖层**——它们描绘的是「各套主题自身」的基调，随当前主题翻转就失去预览意义
  （这是「禁止裸色值」规则下第一组「必须固定、不随主题变」的 token，理由已写在 `:root` 注释里）。
  强调色带直接用 `var(--accent)`：accent 跨主题一致（见浅色覆盖层头部注释），无需再登记一份。
- 语义与键盘走 WAI-ARIA radiogroup：`role=radio` + `aria-checked` + 漫游 tabindex（组内只占一个 tab stop），
  ←→↑↓ 移动即选中（radio 语义）、Home/End 跳首尾；Space/Enter 由 `<button>` 原生激活，无需另接。
  容器的 `role=radiogroup` + `aria-labelledby` 静态写在 index.html（与 `settings-nav` 的 `role=tablist` 同一处理方式），
  指向行内 label——`.settings-row` 的 label 普遍没有 for/id 关联，此处按 `aria-labelledby` 显式关联，不牵动其余行
  （那是另一条独立的存量缺口，见文末）。
- **值真源 = DOM 的 `aria-checked`**，不另设模块级变量：`getSelectedTheme()` / `setSelectedTheme()` 都只读写这一处，
  `settingsPanel.ts` 的 `fillForm` / `saveSettingsPanel` 各改一行（原 `settingsThemeEl.value`），`#settings-theme` 这个 select 已删除。
  这是第四批 `syncHiddenFilesBtn`、第六批 `setTreeItemSelected` 的同款教训——散落两写必然漂移。
  未知值（手改配置写了 `"hc-black"`）回落深色，不留「无选中项」的悬空态。
- **切换只改表单值、不即时套用主题**（与原 select 一致，点「保存」才 `setTheme`）：若改成即时预览，「取消」就无法回退，
  与设置面板其余控件的语义不一致。勾选图标常驻 DOM、只切 `visibility`（而非条件渲染节点），故选中态变化时两张卡等宽不跳动。

#### 测试与验证

新增 `welcomeShortcuts.test.ts`（8 项）与 `themePicker.test.ts`（8 项）；`keybindings.test.ts` 扩 4 项（`bindingChord`）、
`layout.test.ts` 扩 4 项（UI-23 拖拽上限）：

- **UI-25** 钉的是「静态副本」类缺陷：改 `app.settings.keybindings` 后重绘必须跟随（这类缺陷不报错、不崩溃，只是悄悄给出错误信息）；
  另钉解绑占位、F12 兜底、Monaco 内建项不受改键影响、重绘幂等、每行都有 label。
  测试里换键位表用**整表赋值**而非就地改：`app.settings.keybindings` 与 `DEFAULT_SETTINGS.keybindings` 是同一对象引用
  （`{...DEFAULT_SETTINGS}` 是浅拷贝），就地改会污染出厂默认值、连带弄坏 `keybindings.test.ts` 的「三处默认值漂移锁」。
- **UI-26** 钉 radiogroup 不变量：任意时刻恰好一项 `aria-checked=true`、漫游 tabindex 同源切换、`getSelectedTheme` 读 DOM 而非缓存、
  点击不碰 `html[data-theme]`（不即时套用）、方向键移动即选中并移动焦点、未知值回落、重复接线不重复渲染。
- **UI-23** 钉「写进 style 的宽度必须是当下真能渲染出来的宽度」：窄窗口收口、对面面板收起时退回硬上限、
  可用空间不足时守住自身下限、持久化的也是收口后的真值。
- **UI-24** 是纯 CSS + 一处 `aria-orientation` 同步，未新增测试（断点值的推导已写进 CSS 注释，便于复核）。

验证：`npm run build`（tsc + vite build）通过，无类型错误；`npm test`（vitest）**26 个测试文件、202 项测试全部通过**
（原 178 + 新增 24）；`read_lints` 对全部改动文件返回 0 诊断。另核验打包产物 CSS 确实包含新增的
`container-type:inline-size` / `@container` / `max-width:720px` / `min-width:240px` / `.theme-swatch` / `.ew-kbd-none`
（防「源文件改了但被构建链静默丢弃」）。本批无临时脚本，工作树无残留。

#### 需人工抽查的可见变化

- **设置 → 外观 → 主题**（本批最显眼）：下拉框换成并排两张迷你预览卡（深色 / 浅色），选中卡有 accent 描边 + 浅底 + 勾选图标；
  Tab 进入组内只停一站，←→↑↓ 切换、Home/End 跳首尾；仍是「点保存才生效」；
- **欢迎页快捷键**：出厂键位下与改动前**逐字一致**，唯一差异是「跳转到定义」由 `F12` 变为 `Ctrl+B`（= 当前配置值；解绑后回落 F12）；
  在设置里改任一快捷键并保存，重开欢迎页即同步；把某项清空保存则显示「未绑定」；
- **窗口拖到最窄（800px）且左右面板均展开**：编辑区不再被压到 0/160px，而是两侧面板按比例让位、编辑区守住 240px；
  此时拖侧栏分隔条会在「窗口宽 − 240 − 对面面板宽」处停住（不再出现鼠标动而分隔条不动）；窗口拉宽后各自恢复设定值；
- **编辑区被挤窄到 ≤560px 时**，欢迎页快捷键网格由两列变一列；
- 深 / 浅两套主题下都过一遍上述几处（预览卡的色值是固定的，两套主题下应看起来一样）。

**第八批完结**：UI-23 ✅、UI-24 ✅、UI-25 ✅、UI-26 ✅ 全部完成。

#### 本批发现但未纳入范围的存量缺口

- **表单 label 与控件无 `for`/`id` 关联**：`index.html` 里 36 个 `<label>`（对应 38 个 `.settings-row`）**没有一个**带 `for`，
  读屏聚焦控件时报不出对应标签（设置面板、环境面板、新建项目、运行配置等模态均如此）。
  本批只给主题行按 `aria-labelledby` 关联（radiogroup 必须有可访问名称，属新增控件的必要部分），其余未动——
  批量补 `for`/`id` 是一条独立的无障碍条目，建议另立 UI-31 或与 UI-30 一并排期；
- **`#bottom` 分隔条拖拽写内联 `height`**（第七批已记录、本批复核确认仍存在）：内联样式特异性最高，会压过样式表的
  `#bottom.collapsed { height: 28px }`——`layout.ts` 在拖拽与 `restoreLayout` 两处写内联高度，且无任何路径清除它，
  故**拖过（或恢复过）底部面板高度之后就再也收不到 28px**。`#outline-section` 已用自定义属性 `--outline-h` 规避了同一陷阱
  （见第七批 UI-22 决策 2），两者宜统一到同一写法。

**待推进**（30 项中剩余 2 项）：

- **UI-29**（编辑器/终端字号与字体族接入用户设置）：`terminal.ts` 硬编码 `fontSize:13` 与一份与 `--mono` 重复维护的字体栈、
  两个 devtools 只读预览器硬编码 `fontSize:12`；可复用第四批为 UI-11 建立的 `applyMotionPreference()` /
  `refreshTerminalMotion()` 同款模式处理已存在实例的运行时刷新；
- **UI-30**（菜单 ARIA 与键盘导航）：`#ctx-menu` / `#menu-dropdown` / `#menu-submenu` 补 `role=menu`/`menuitem` + ↑↓/Home/End，
  含第七批留下的 `aria-expanded`（状态栏芯片的菜单/弹窗开合态）。

### 2026-09-11 · 第九批（UI-29 + UI-30）已完成 —— 30 项全部完结

#### UI-29 · 终端 / devtools 预览器字号与字体族接入用户设置

**终端（`terminal.ts` + `termUi.ts` + `settingsPanel.ts`）**：

- 构造时的 `fontSize: 13` 与硬编码字体栈改读 `app.settings.font_size` / `font_family`
  （新增 `termFontSize()` / `termFontFamily()` 两个取值函数：字号非法值（手改配置写坏成 NaN/0）与
  字体族空串均回落 `DEFAULT_SETTINGS`——xterm 拿到非法 fontSize 会渲染异常，必须兜底）；
  那份与 `--mono` 重复维护的字体栈就此消失（UI-28 只统一了 CSS 侧，这是 JS 侧最后一处）；
- 运行时刷新完全照第四批 UI-11 的既定模式：实例级 `applyFontPreference()`（照 `applyMotionPreference()`）+
  域级 `refreshTerminalFonts()`（照 `refreshTerminalMotion()`）+ `saveSettingsPanel()` 保存路径接线一处。
  **与 UI-11 的一处必要差异**：改字号会改变字符度量 → cols/rows 随之变化，`applyFontPreference()` 内部
  必须跟一次 `syncSize()`（refit + `term_resize` 同步 PTY），否则后端仍按旧列宽折行、终端输出错位——
  光标闪烁没有这个问题，字体有；
- 终端面板收起（容器 0 尺寸）时 `syncSize()` 既有守卫直接返回，展开时 `ResizeObserver` 会补 fit + resize，无需额外处理。

**两个 devtools 只读预览器（jsonpath / curl2python）**：硬编码 `fontSize: 12` 改读
`app.settings.font_size`，并补 `fontFamily`（空串不覆盖 Monaco 默认，与 `buildEditorOptions` 同一守卫写法）。
**沿用第四批 UI-11 的既定裁决**——「实例随工具挂载新建、卸载即销毁，创建时读一次即可，无需运行时接线」：
切换工具或收起再展开右侧面板即重新挂载、自然拿到新值。若工具在设置保存时恰好保持挂载会短暂保留旧字号，
这与 UI-11 时光标闪烁开关的取舍一致（为只读预览器引入 `ToolInstance` 级刷新钩子的收益不抵复杂度）。

#### UI-30 · 弹出菜单 ARIA 语义与键盘导航

**新增共享模块 `menuKeys.ts`**：应用里有两套**刻意不合并**的菜单渲染器（`menu.ts` 的扁平即时弹出 vs
`main.ts` 菜单栏的 flyout 级联，分工见 menu.ts 头部注释），但键盘导航语义对两套完全一致，
故抽 `menuItemsOf()` / `moveMenuFocus()` / `wireMenuKeyNav()` 共享，避免同一套规则写两遍后各自漂移。
导航规则（APG menu 模式）：↑↓ 环绕漫游（**跳过禁用项与分隔符**——与鼠标「点了没反应 + 置灰」语义一致，取 VS Code 同款处理）、
Home/End 跳首末、Enter/Space 复用既有 click 回调激活（单一动作入口，与 termUi::makeSpanButton 同一做法）、
Tab 退出菜单不激活任何项。所有被处理的按键都 `stopPropagation`——菜单栏的 Esc 需要「先关子菜单」的级联语义，
冒泡到 window 级监听器会把整个下拉一并关掉。

**`menu.ts`（#ctx-menu）**：

- 菜单项 `role=menuitem` + `tabindex=-1`（程序可聚焦、不占 tab 序列）；分隔符 `role=separator`；
  禁用项 `aria-disabled=true`；**`checked` 显式传入（含 false）即为单选组成员** → `role=menuitemradio` +
  `aria-checked`——引擎切换 / shell 选择的调用方都传布尔值，若只标 true 项会让同组语义残缺；
- 打开即把焦点移入首项（APG）；**焦点归还带条件**：仅当焦点尚未离开（仍在菜单内或掉到 body——如 Esc 关闭）
  才还给打开时的 `activeElement`；用户点击别处关闭菜单时焦点已在点击目标上，**不抢回**
  （无条件归还会出现「点编辑器关菜单后焦点被拽回旧位置」的回归）；
- **触发元素 `aria-expanded` 跟踪**：anchor 是带 `aria-haspopup` 的元素则打开置 true、关闭复位 false
  （坐标 anchor 如树右键/行槽右键无触发元素，自然跳过）。「上一个菜单未走 hideMenu 就被顶掉」
  （anchor 点击 stopPropagation，document 关闭监听收不到）时先复位旧 anchor，避免残留 true；
- **键盘导航惰性接线**：`wireMenuKeyNav(ctxMenuEl,…)` 不能放模块顶层——那会在 **import 期**解析
  `lazyEl(#ctx-menu)`，`runWidget.test` / `runGutter.test` 这类间接 import 且未建该元素的测试环境会直接抛
  「缺少元素」（CR-26 惰性 Proxy 只保护到首次属性访问，接线本身就是访问）。改为首次 `showMenu` 时接一次。

**`main.ts` 菜单栏渲染器（#menu-dropdown / #menu-submenu）**：

- 三个容器 `role=menu` 静态写在 index.html；下拉/子菜单项 `role=menuitem` + `tabindex=-1`、分隔符 `role=separator`；
- 子菜单父项 `aria-haspopup=menu` + `aria-expanded` 与 `.open` 类**同源切换**（openSubmenu/hideSubmenu 单一写入点）；
  新增模块级 `submenuResolvers`（WeakMap：父项元素 → 子项解析器）供键盘 → 键展开取用——
  此前解析器只存在于渲染期的 click 闭包里，键盘路径拿不到；
- Esc 级联语义：子菜单开着先关子菜单、焦点回父项；否则关整个下拉、焦点按与 menu.ts 相同的条件归还菜单按钮
  （菜单按钮 `aria-expanded` 同步复位，含「直接点另一个菜单按钮切换」路径）；← 在子菜单内折叠回父项、
  → 在下拉内展开子菜单**并把焦点移入**（`openSubmenu` 加 `focusFirst` 参数：键盘展开移焦点，
  鼠标悬停/点击展开不抢焦点）；
- **第七批留下的状态栏芯片 `aria-expanded` 落地**：`#status-engine`（menu）由 menu.ts 的触发元素跟踪自动切换；
  `#status-interpreter`（dialog）在 `openEnvPanel`/`closeEnvPanel` 与模态显隐同源切换（已核实环境面板
  所有关闭路径——关闭按钮、遮罩点击——都经过 `closeEnvPanel`，无旁路）。index.html 两芯片与
  `#btn-run-menu`、4 个菜单按钮补静态 `aria-haspopup`/`aria-expanded=false`；termUi「＋」按钮
  （弹 shell 选择菜单）同样补齐，开合态由 menu.ts 跟踪。

**CSS 零改动**：`.ctx-menu-item:focus-visible` 早在 D1 P-02 的全局键盘焦点规则里预留（第六批曾兑现过一次
「规则先行就位，接入即生效」），本批键盘漫游的焦点环直接生效。

#### 测试与验证

`menu.test.ts` 扩 7 项，钉住最易被「顺手简化」的不变量：role/tabindex/aria-disabled 映射、
checked=false 也是 menuitemradio（防「只标 true 项」的组语义残缺）、打开即聚焦首项、
↑↓ 跳过禁用项与分隔符并环绕、Home/End、Enter 激活且关闭、**Tab 只关不激活**、
anchor 的 aria-expanded 开合同步、Escape 关闭后焦点归还触发元素。

**做了变异验证**：临时注释掉 showMenu 末尾的 `moveMenuFocus(…, "first")`，测试**精准失败 3 项**
（全部是聚焦断言：首项聚焦、漫游起点、Escape 归还前置条件），确认非空洞后已还原。

验证：`npm run build`（tsc + vite build）通过，无类型错误；`npm test`（vitest）**26 个测试文件、209 项测试全部通过**
（原 202 + 新增 7）；`read_lints` 对全部改动文件返回 0 诊断。本批无临时脚本，工作树无残留。
`main.ts` 未新增功能域函数；UI-30 属既有菜单栏渲染器（本就刻意留在 main.ts）的就地扩展，符合 §1 约束。

#### 需人工抽查的可见变化

- **终端与两个 devtools 预览器**：默认字号从 13/12 变为跟随设置（出厂 14）；在设置里改字号/字体保存后，
  **已打开的终端立即**跟随并重排（宽字符折行位置变化属预期）；devtools 预览器在切换工具/重开面板后跟随；
- **所有弹出菜单打开即获得键盘焦点**（本批最需适应的一点）：右键菜单、引擎/ shell 选择、运行 ▾ 下拉、
  菜单栏下拉打开后直接 ↑↓ 选择、Enter 执行、Esc/Tab 退出；菜单项上出现 1px 焦点环；
- **菜单栏下拉的键盘级联**：「文件 → 最近的工作区」聚焦后按 → 展开子菜单并移入焦点，← 或 Esc 收回；
- **读屏**：菜单容器报「菜单」，项报「菜单项/菜单单选钮（已选中/未选中）」，分隔符跳过；
  菜单按钮与状态栏两芯片报「已展开/已折叠」；
- 点击菜单外区域关闭菜单后，焦点留在点击处（不被拽回）；Esc 关闭则回到触发按钮。

**第九批完结**：UI-29 ✅、UI-30 ✅。**至此 30 项全部完结，本计划收官。**

### 2026-09-11 · 第十批（两条清单外遗留）已完成

第九批登记的两条存量缺口（原建议另立 UI-31/UI-32）改动面核实后都不大，随本批一并修掉。

#### 遗留 1 · 表单 label ↔ 控件关联（for/id）

全量口径：index.html 36 个 `<label>` + TS 动态生成的 3 类行（快捷键分区、模板编辑器字段行、类型行）。

- **29 个静态 label 补 `for`**（新建项目 5 + 运行配置 3 + 设置面板 21）；控件本就全有 id，纯加属性、零结构改动；
- **双控件行**（字体族、PyPI 镜像源：预设下拉 + 自定义输入）：`for` 只能指一个，取阅读顺序在前的预设下拉；
  自定义输入框另补 `aria-label`（「自定义字体栈」/「自定义包源地址」），保证两个控件聚焦时读屏都报得出名称；
- **TS 动态行**：`settingsPanel.ts::renderKeybindingRows` 补 `label.htmlFor = input.id`；
  `manager.ts` 的类型行补 `kindLabel.htmlFor`；`fieldRow()` 通用地关联——control 自身有 id 直接关联，
  是包装容器（如「分组」行的 input+自绘下拉 wrapper）则下探首个带 id 的表单控件，找不到目标不设 for；
  「作用域」的组标题本就是 `<span>`（非 label）、「Tab 展开」是 label 包裹 checkbox（隐式关联天然成立），均无需改；
- **7 个刻意不带 for 的例外**（已就地注释登记）：主题行（radiogroup 是 div、非 labelable 元素，
  `aria-labelledby` 是唯一正确方式，UI-26 原注释里「label 普遍没有 for/id 关联」的过时表述一并修正）；
  数据目录/日志目录/数据根目录/磁盘占用/可再生清理/uv 缓存 6 行的「控件」是按钮或纯文本——
  button 虽属 labelable 元素，但按钮自身文本已是完整可访问名称，关联后读屏反而把 label 文本拼进名称/描述造成冗余。

**验证**：剥离后全文件扫描，无 for 的 label 恰为上述 7 处例外、无漏网。

#### 遗留 2 · `#bottom` 分隔条内联 height 压过折叠态

与 UI-22 大纲区同款陷阱、同款修法（决策 2 的自定义属性方案）：

- `style.css`：`#bottom { height: 220px }` → `height: var(--bottom-h, 220px)`；`.collapsed{height:28px}`
  特异性 (1,1,0) > 基础规则 (1,0,0)，无论 `--bottom-h` 是否已设都能收回 28px（注释登记与 BOTTOM_MIN 的隐式同步义务）；
- `layout.ts`：拖拽 / `restoreLayout` 两处改写 `setProperty("--bottom-h", …)`；双击重置改为 `removeProperty`
  → 回落 CSS 默认（与大纲双击同一语义，默认高真值只留 CSS 一份）；`BOTTOM_DEF` 常量删除（避免与 CSS 兜底值漂移）；
- 顺带修正既有小缺陷：原双击重置写死 220px 内联值——**双击后内联 height 依旧存在**，折叠缺陷只是被
  「恰好等于默认值」掩盖，本次一并消除。

#### 测试与验证

`layout.test.ts` 扩 3 项，钉住「拖拽/双击/restoreLayout 三条路径都写 `--bottom-h`、绝不写内联 height」不变量。
**做了变异验证**：临时把拖拽改回写 `bottom.style.height` → **精准失败 2 项**（两条拖拽路径；restoreLayout
未被变异、正确通过），确认非空洞后已还原。

验证：`npm run build`（tsc + vite build）通过，无类型错误；`npm test`（vitest）**26 个测试文件、212 项测试全部通过**
（原 209 + 新增 3）；`read_lints` 对全部改动文件返回 0 诊断。本批无临时脚本，工作树无残留。

#### 需人工抽查的可见变化

- **视觉零变化**；行为差异只有一条：拖过底部面板高度后，「折叠输出面板」按钮 / 视图菜单的收起动作
  现在能正常收到 28px（此前拖过就收不起）；双击分隔条重置后同样可正常折叠；
- **读屏**：设置/新建项目/运行配置/快捷键/模板编辑器的表单控件聚焦时能报出对应中文标签；
  点击标签文字可聚焦/切换对应控件（label for 的原生行为，鼠标用户的小便利）。

**第十批完结**：两条清单外遗留 ✅。**本计划所有已知条目全部收官，无待推进项。**
