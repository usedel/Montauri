# OpenCharm 菜单栏设计改进计划

> 版本：v1.4 · 日期：2026-09-21 · 状态：**全部完成（16/16）**——五批全部交付，本计划收官
> 来源：对 `shell/src/menuBar.ts` / `menu.ts` / `menuKeys.ts` / `main.ts`（`getMenuItems` / `buildToolsMenu`）+ `shell/index.html`（menubar 结构）+ `shell/src/style.css`（菜单样式）的全量审阅。
> 本文档是菜单栏后续改进排期与验收的唯一依据；与 `python_ide_dev_plan_v2.md` 冲突时以开发计划为准并反馈修订本文档。
> 涉及范围仅限 `shell/` 前端（Tauri 2 + Monaco 外壳），不触及 `probe/`、`intel/` 的架构第一原则。
>
> v1.1 修订（2026-09-21）：核实代码事实后修正 MB-04/08/10/13 的方案与工作量；MB-01 优先级 P0→P1；
> MB-06 策略改为「重定位优先、溢出才收起」；新增 §3.3 最终菜单顺序、§4.2 设计决策记录、§5 测试计划、§7 进度记录。
> v1.2 定稿（2026-09-21）：产品负责人裁决三项决策——① 调试**合并**进「运行」菜单（MB-10 方案 A）；
> ② 顶级菜单顺序采用 **文件·编辑·视图·前往·运行·Git·工具·帮助**（§3.3）；③ 二级级联采用**降级拦截**（MB-04 方案 A）。
> v1.3 复核（2026-09-21）：查漏补缺——§1 新增「不向 main.ts 堆逻辑」实施约束；MB-05 并入 `role="menubar"`（APG menubar
> 模式配套）；MB-11 消除「Markdown 预览/本地历史」归属含糊（均留「视图」）并登记命令面板归「前往」的口径说明；MB-10/11/13
> 验收标准补新按钮 ARIA 范式；MB-12 明确「偏好设置」子菜单形态；MB-13 补 `openAlert` 轻量承载路径（工作量可回落「小」）；
> MB-14 修正项数口径（11 动作 + 5 分隔线）；§6 补两套渲染器不合并的架构说明。另发现 3 项待裁决：menubar 窄窗口宽度风险
> （新增 MB-16 与否）、MB-04 批次前移、帮助菜单「欢迎页」子项默认值。
> v1.4 定稿（2026-09-21）：复核三项裁决落定——① 新增 **MB-16**（menubar 窄窗口溢出，P2 小，实测随第一批新按钮落地）；
> ② **MB-04 前移第二批**（§5 批次表已更新）；③ 帮助菜单「欢迎页」子项**一期不纳入**（登记为后续可选）。
> §8 待裁决事项随之撤销，全部决策已回填对应条目；任务总数 15 → 16。

## 1. 背景与范围

上一份 `ui_design_improvement_plan.md`（UI-01~UI-30）已全部完结，其中 UI-30 补齐了菜单的
ARIA 语义与 ↑↓/Enter/Esc 键盘导航。但菜单栏仍存在两类未被覆盖的问题：

1. **机制/交互层**：两套渲染器（`menu.ts` 扁平弹出 vs `menuBar.ts` 级联 flyout）刻意不合并，
   但在悬停展开、级联深度、菜单间切换、键盘漫游、视觉一致性上仍有明显缺口（§3.1，MB-01~MB-09）。
2. **内容规划层**：顶级菜单数量、职责划分、子菜单归属存在结构性不合理（§3.2，MB-10~MB-15）。

**实施约束**（承接 `ui_design_improvement_plan.md` §1 的铁律与 TD-14 分工，本计划全程有效）：

- 菜单**机制**一律在 `menuBar.ts`，菜单**数据**组装保留在 `main.ts::getMenuItems`（既有分工不改变）；
- 但新增**逻辑**不得继续堆进 `main.ts`——MB-13 的「关于」弹层等应落独立模块
  （参照 `welcomeShortcuts.ts` / `focusTrap.ts` / `menuKeys.ts` 先例）；
- 所有 CSS 改动遵守 `style.css` 既有规则（色值/字号/间距/圆角一律走 token，禁止裸值）。

## 2. 优先级定义

| 级别 | 含义 | 处理时机 |
|---|---|---|
| P1 | 结构性规划问题 / 明确交互缺陷 / 一致性，影响整体观感与信息架构 | 第一、二批 |
| P2 | 能力补齐 / 可访问性与健壮性 | 第三、四批 |
| P3 | 次要一致性 / 注释与代码卫生 | 第四、五批 |
| P4 | 细节打磨 | 可并入任意批次 |

> 注：本计划无 P0——菜单栏现有功能均可用，问题集中在「体验瑕疵」与「信息架构」，非功能性 Bug。

## 3. 任务总览

### 3.1 机制 / 交互层

| 编号 | 优先级 | 标题 | 涉及文件 | 工作量 |
|---|---|---|---|---|
| MB-01 | P1 | 子菜单「三角缓冲」缺失，斜向移动误关 | `menuBar.ts` | 小 |
| MB-02 | P1 | 顶级菜单不支持 hover 切换 | `menuBar.ts`、`style.css` | 小 |
| MB-03 | P1 | 菜单栏按钮 hover/active 与下拉项 hover 用色割裂 | `style.css` | 极小 |
| MB-04 | P1 | 二级级联渲染缺口（子菜单项带 submenu 被静默丢弃） | `menuBar.ts` | 小 |
| MB-05 | P2 | 菜单栏本体无 ←/→ 键盘漫游（含 `role="menubar"` 补齐） | `menuBar.ts`、`index.html` | 小 |
| MB-06 | P2 | 窗口 resize 时浮层不重定位 / 不关闭 | `menuBar.ts` | 极小 |
| MB-07 | P3 | `menu.ts` 头部分工注释漂移 | `menu.ts` | 极小 |
| MB-08 | P3 | `MenuEntry` 缺 icon/checked/disabled/danger 能力 | `menuBar.ts`、`main.ts` | 中 |
| MB-09 | P4 | 子菜单箭头 `❯` 字号与 label 不齐 | `style.css` | 极小 |
| MB-16 | P2 | menubar 窄窗口（800px 下限）溢出风险（v1.4 新增） | `style.css`、`index.html` | 小 |

### 3.2 内容规划层

| 编号 | 优先级 | 标题 | 涉及文件 | 工作量 |
|---|---|---|---|---|
| MB-10 | P1 | 新增「运行」顶级菜单（运行 + 调试合并） | `index.html`、`main.ts` | 中 |
| MB-11 | P1 | 新增「前往」顶级菜单，裁剪过载的「视图」 | `index.html`、`main.ts` | 中 |
| MB-12 | P1 | 「设置 / Live Templates / 最近的文件」归位 | `main.ts` | 小 |
| MB-13 | P2 | 新增「帮助」顶级菜单 | `index.html`、`main.ts` | 小-中（视「关于」形态，见条目） |
| MB-14 | P3 | Git 菜单平铺过长，同步 / 贮藏分组 | `main.ts` | 小 |
| MB-15 | P4 | 「编辑」菜单补高频项（注释切换 / 在文件中查找替换） | `main.ts` | 小 |

### 3.3 最终顶级菜单顺序（已裁决）

新增「前往」「运行」「帮助」后，顶级菜单从 5 个增至 8 个。锁定顺序（对标 VS Code / PyCharm）：

> **文件 · 编辑 · 视图 · 前往 · 运行 · Git · 工具 · 帮助**

依据：VS Code 为 File/Edit/Selection/View/Go/Run/Terminal/Help，PyCharm 为 File/Edit/View/Navigate/…/Run/Tools/Git/…/Help——
两者均把「视图」排在「前往/导航」之前、「运行」排在中后段、「帮助」恒居末位。本顺序与之一致，
且保留现有「Git / 工具」的相对位置不变，迁移成本最低。

> 决策（2026-09-21）：采用此顺序。「运行」不提前到「编辑」之后——保持与 VS Code/PyCharm 一致的中后段位置，
> 避免打破用户从其它 IDE 迁移过来的肌肉记忆。

## 4. 详细任务说明

### 4.1 机制 / 交互层

#### MB-01 · 子菜单「三角缓冲」缺失，斜向移动误关（P1）

- **现状/证据**：`menuBar.ts` 中带 submenu 的父项绑 `mouseenter → scheduleSubmenu`（200ms 延时展开）、
  `mouseleave → scheduleSubmenuClose`（250ms 延时关）；而**普通项绑 `mouseenter → hideSubmenu`（立即关闭）**。
  鼠标从「最近的工作区」斜向右端子菜单时，只要路径扫过下方任一普通项（「打开工作区」「保存」等），
  子菜单会被瞬间关掉——原生菜单 / VS Code 用统一延时或鼠标轨迹路径检测规避这一点。
- **建议方案**：将普通项的 `mouseenter → hideSubmenu` 改为走 `scheduleSubmenuClose` 的统一延时模型。
  这样斜移穿过普通项时只会「重置 250ms 关闭计时」，只要在计时内落入子菜单容器（子菜单 `mouseenter`
  会 `cancelSubmenuTimer`），关闭即被取消，形成三角缓冲；悬停停在普通项上超过 250ms 仍会正常关闭。
- **涉及文件**：`shell/src/menuBar.ts`。
- **验收标准**：从父项沿任意斜线移动到子菜单，子菜单不闪不关；悬停停在普通项上后仍会关闭（不残留）。

#### MB-02 · 顶级菜单不支持 hover 切换（P1）

- **现状/证据**：`.menubar-item` 只绑 `click`，已展开某菜单时鼠标滑到相邻菜单按钮无反应，
  必须再点一次（且切换路径先 `hideMenuDropdown()` 再 `showMenuDropdown()`，有闪烁）。
- **建议方案**：给 `.menubar-item` 加 `mouseenter`——**仅当已有菜单展开时**才切换目标菜单
  （避免平时移动鼠标乱弹菜单）；复用 `showMenuDropdown`，并保持 `aria-expanded` 同源切换。
- **涉及文件**：`shell/src/menuBar.ts`。
- **验收标准**：展开「文件」后把鼠标滑到「编辑」，下拉直接切换，无需点击、无闪烁；未展开时悬停不弹菜单。

#### MB-03 · 菜单栏按钮 hover/active 与下拉项 hover 用色割裂（P1）

- **现状/证据**：`.menubar-item:hover/.active` 用实心 `--accent` + `--on-accent`；
  而所有 `.ctx-menu-item:hover` 用浅色 `--hover`（UI-20 已收敛）。菜单栏按钮「悬停即实心蓝」
  比展开后内部项的浅色 hover 更重，与整个应用的轻量 hover 体系不一致（VS Code：悬停浅色、仅展开态高亮）。
- **建议方案**：`.menubar-item:hover` 改为 `--hover`（浅色）；`.menubar-item.active`（展开态）保留实心 `--accent`
  作为「当前展开」指示。与 MB-02 一并落地，hover 态语义随之收拢。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：悬停菜单按钮呈浅色高亮，点击展开时呈实心高亮；展开后内部项 hover 仍为 `--hover`，两层语义一致。

#### MB-04 · 二级级联渲染缺口（P1）

- **现状/证据**：`MenuEntry.submenu?: () => MenuEntry[]` 类型递归兼容（子项里可再放 submenu），
  但 `openSubmenu` 渲染 children 时只处理 `sep` 与「label + detail」两个分支，碰到带 `submenu` 的子项
  直接当普通项渲染，箭头与展开能力全无——数据层给了能力、渲染层没接。当前「工具 → 分类」只用了一级，
  一旦需要「工具 → 某分类 → 子分类」即断。
- **关键约束**：`submenuEl` 是**单例**（`$("menu-submenu")`），`openSubmenu` 直接往这一个容器写内容。
  真嵌套需要重构为「多实例 / 容器栈」并重写定位算法，工作量为**大**，且当前无实际二级需求。
- **建议方案（已裁决：降级拦截）**：数据层约定子菜单内禁止再放 submenu；渲染层在 `openSubmenu` 显式检测
  `it.submenu` 并 `console.warn` + 按普通项渲染（不再静默丢弃语义）。工作量小，消除「静默断链」隐患。
  > 决策（2026-09-21）：采用降级拦截。完整嵌套支持（重构 submenuEl 为多实例栈）暂不启动——
  > 当前无真实二级需求，待未来出现「工具 → 分类 → 子分类」类需求时再另立条目评估。
- **涉及文件**：`shell/src/menuBar.ts`。
- **验收标准**：带 submenu 的子项不再被静默渲染成普通项（有 `console.warn` 显式提示），数据层文档注明禁止嵌套。

#### MB-05 · 菜单栏本体无 ←/→ 键盘漫游（P2）

- **现状/证据**：`wireMenuKeyNav` 只绑在 `#menu-dropdown` 与 `#menu-submenu` 容器上；menubar 本体
  仅能通过 `focus-visible` 聚焦，无 ←/→ 在各顶级菜单间漫游并联动切换下拉。
  另：`#menubar` 容器是裸 `<nav>`（隐式 role=navigation），未声明 APG menubar 复合组件模式——
  当前是「按钮 + aria-haspopup」的简化形态，语义上可接受，但加了方向键漫游后应升级到位。
- **建议方案**：`wireMenuBar` 内给 menubar 接一层 keydown：←/→ 移动焦点到相邻 `.menubar-item`，
  若当前有菜单展开则同步 `showMenuDropdown` 切换；Enter/Space 触发既有 click。
  **配套**：`#menubar` 补 `role="menubar"`（APG menubar 模式 = 容器 menubar + 子项 menuitem +
  方向键漫游，三件套缺一不可，与 UI-30 已交付的下拉内导航衔接成完整链路）。
- **涉及文件**：`shell/src/menuBar.ts`、`shell/index.html`（role 属性）。
- **验收标准**：聚焦菜单栏按钮后 ←/→ 可在各顶级菜单间移动并切换下拉，Enter 展开；读屏报「菜单栏 / 菜单项」。

#### MB-06 · 窗口 resize 时浮层不重定位 / 不关闭（P2）

- **现状/证据**：菜单是 `position:fixed`，`positionSubmenu` 只在展开时算一次；
  窗口尺寸变化（Tauri 拖拽边缘 resize）后子菜单可能漂出视口或重叠错位。
- **建议方案**：`window resize` 时若 `#menu-dropdown`/`#menu-submenu` 可见，**优先重定位**
  （复用 `positionSubmenu` 的右缘折叠 + 下缘夹取）；若重定位后仍溢出视口则 `hideMenuDropdown()` 收起。
  （较「一律收起」体验更好：用户 resize 时菜单内容仍可见，仅在确实放不下时才关。）
- **涉及文件**：`shell/src/menuBar.ts`。
- **验收标准**：拖拽改变窗口大小后，展开中的菜单跟随重定位；极端窄/矮窗口下自动收起，不滞留错位。

#### MB-07 · `menu.ts` 头部分工注释漂移（P3）

- **现状/证据**：`menu.ts` 头部第 4-6 行仍写「菜单栏那套……**故意留在 main.ts 不合并**」，
  但菜单栏机制早已迁到 `menuBar.ts`（`main.ts` 第 1367 行注释亦确认）。新人会被误导去 `main.ts` 找渲染逻辑。
- **建议方案**：把该段注释中的「main.ts」改为「menuBar.ts」，并同步 `menuBar.ts` 头部分工说明
  （当前 `menuBar.ts` 头部注释正确，仅 `menu.ts` 侧过时）。
- **涉及文件**：`shell/src/menu.ts`。
- **验收标准**：两处头部分工注释互相一致，不再出现「菜单栏渲染器在 main.ts」的过时表述。

#### MB-08 · `MenuEntry` 缺 icon/checked/disabled/danger 能力（P3）

- **现状/证据**：`menu.ts` 的 `MenuItem` 已有 `icon / checked / disabled / disabledReason / danger`，
  而菜单栏的 `MenuEntry` 只有 `label / shortcut / detail / action / submenu / sep`。
  菜单栏下拉因此无法表达「勾选（主题/换行开关）」「禁用 + 原因 tooltip」「危险操作红字」、
  「图标导航」，能力与通用弹出菜单不对齐。
- **关键约束（修正 v1.0 的不可行建议）**：`menu.ts::renderItem` 产出 flex 布局（`.mi-icon`/`.mi-label`/
  `.mi-detail`/`.menu-shortcut`），而 `menuBar.ts` 子菜单项是 block 两行布局（`.sub-label`/`.sub-detail`），
  CSS 按容器 id 隔离（`#ctx-menu` vs `#menu-submenu`）。**不可直接复用 `renderItem`**，否则破坏现有样式。
- **建议方案**：`MenuEntry` 补齐 `icon/checked/disabled/disabledReason/danger` 字段后，
  在 `menuBar.ts` 的 `showMenuDropdown` / `openSubmenu` 渲染分支内**各自处理**新字段
  （参照 `renderItem` 的语义：checked→`role=menuitemradio`+`aria-checked`、disabled→`aria-disabled`+
  置灰+点击拦截、danger→红字、icon→前导槽），但 DOM 结构与 CSS 类名沿用 menuBar 自己的一套，不共享渲染函数。
- **涉及文件**：`shell/src/menuBar.ts`、`shell/src/main.ts`。
- **验收标准**：菜单栏下拉可渲染带勾选/禁用（含 reason tooltip）/危险/图标 的项，行为与 `#ctx-menu` 语义一致。

#### MB-09 · 子菜单箭头 `❯` 字号与 label 不齐（P4）

- **现状/证据**：`style.css` 的 `.sub-arrow` 用 `--text-xs`（比 label 小一号）；`❯`（U+276F）比原 `▸` 更细长，
  在 xs 字号下略发虚、与文字重心不齐。
- **建议方案**：`.sub-arrow` 字号改为与 label 同档（`--text-sm` 层级），保持 `margin-left:auto` 与 `--fg-dim` 不变。
- **涉及文件**：`shell/src/style.css`。
- **验收标准**：子菜单父项右侧箭头与左文字视觉重心对齐、清晰。

#### MB-16 · menubar 窄窗口（800px 下限）溢出风险（P2，v1.4 新增）

- **现状/证据**：顶级菜单从 5 个增至 8 个（+「前往/运行/帮助」约 +110~140px）。粗算 800px 最小窗口
  （`lib.rs` 的 `min_inner_size(800,600)`，见 UI-23 记录）：logo+标题 ≈130px + 8 个菜单按钮 ≈370px +
  右侧动作区（运行组/调试/设置/窗口控制）≈340px ≈ **840px，超出下限约 40px**。`#menubar` 是无换行、
  无溢出处理的 flex 容器，`.spacer` 压缩到 0 后按钮将互相挤压。
- **建议方案（已裁决：新增条目盯住）**：分两步——
  ① **实测**（随第一批落地新按钮同步进行）：800px 宽度下核对 menubar 实际占位是否溢出；
  ② **缓解**（确认溢出后落地）：优先「窄窗口隐藏 `menubar-title`」（媒体查询，与 UI-21 状态栏窄窗口
  `@media (max-width:900px)` 隐藏字号芯片同思路——标题收起后 logo 仍在，品牌感不完全丢失）；
  仍不足再考虑菜单区收纳（如低频菜单并入溢出项）。
  > 决策（2026-09-21）：新增 MB-16。粗算已超限，溢出概率高，值得独立条目盯住；实测随第一批，缓解按实测结果推进。
- **涉及文件**：`shell/src/style.css`、`shell/index.html`。
- **验收标准**：800px 最小窗口下 menubar 全部按钮可见、不换行、不互相挤压；缓解措施不影响宽窗口正常布局。

### 4.2 内容规划层

#### MB-10 · 新增「运行」顶级菜单（P1）

- **现状/证据**：运行/调试是 Python IDE 的核心能力，但入口全部分散在标题栏图标按钮
  （`btn-run-script` / `btn-run-project` / `btn-stop` / `btn-run-config` / `btn-debug`）与命令面板，
  **没有任何菜单能系统性触达**。对标 PyCharm 的 Run/Debug 一级菜单。
- **设计决策（已裁决：合并）**：调试命令（启动/停止/单步跳过/进入/退出/运行到光标/求值，共 7 项）
  **不独立**成「调试」菜单，而是与运行合并为「运行」一级菜单，内部用分隔符分区（运行区 / 调试区 / 收尾）。
  > 决策（2026-09-21）：采用合并方案。理由：调试 7 项尚不足以独立成菜单；与标题栏「运行组 + 调试按钮」
  > 聚合为同一「动作区」的现有布局一致；顶级菜单总数控制在 8 个。未来若调试功能扩展
  > （条件断点管理、调试配置等）可再拆出独立「调试」菜单。
- **建议方案**：新增一级菜单「运行」（index.html 加 `.menubar-item[data-menu=run]`），
  `getMenuItems("run")` 按分隔符分区：
  - 运行区：运行脚本 / 运行项目 / 运行配置… / 停止运行；
  - 调试区：启动调试（继续）/ 停止调试 / 单步跳过 / 单步进入 / 单步退出 / 运行到光标 / 求值表达式；
  - 收尾：运行历史（自「视图」迁入）。
  各 action 复用既有函数：`runScript`/`runProject`/`runDebug`/`stopRun`/`stopDebugSession`/
  `runToCursorAtCursor`/`onEvaluateShortcut`/`openRunHistory` 均在 `main.ts` 作用域；
  **单步三命令**复用命令面板同款动态导入（`main.ts:1698-1700` 已有先例）：
  `void import("./dap/client").then((m) => m.dapNext(1))`（`dapStepIn`/`dapStepOut` 同理，threadId 沿用硬编码 1）。
- **涉及文件**：`shell/index.html`、`shell/src/main.ts`。
- **验收标准**：新增「运行」菜单，其下动作与命令面板 / 标题栏图标行为完全一致，改键后快捷键标签跟随；
  新增 `.menubar-item` 按钮带 `aria-haspopup="menu"` + `aria-expanded`（UI-30 既有范式）。

#### MB-11 · 新增「前往」顶级菜单，裁剪过载的「视图」（P1）

- **现状/证据**：「视图」菜单 16+ 项，混了三类职责：布局开关（文件树/搜索/切换侧栏/切换底部面板）、
  导航跳转（转到文件/转到行/Search Everywhere/命令面板/最近的文件/后退/前进/书签）、设置杂项
  （设置/Live Templates/Markdown 预览/运行历史/本地历史）。VS Code 将「视图（布局）」与「前往（导航）」分列。
- **建议方案**：
  - 保留「视图」仅布局与工具窗口类：**文件树 / 搜索 / 切换侧栏 / 切换底部面板 / Markdown 预览 / 本地历史**
    （后两项分别是视图开关与工具窗入口，归属本就正确，留在「视图」）；「运行历史」迁「运行」（MB-10 收尾），
    「设置 / Live Templates / 最近的文件」按 MB-12 归位；
  - 新增「前往」：转到文件 / 转到行 / Search Everywhere / 命令面板 / 后退 / 前进 / 书签列表。
  均为迁移现有 `action`（`openQuickOpen`/`goBack`/`goForward`/`openBookmarks` 等均在 `main.ts` 作用域），不新写逻辑。
  > 口径说明：命令面板 / Search Everywhere 归「前往」而非 VS Code 的 View 菜单——二者皆为「搜索式导航」入口，
  > 取 PyCharm Navigate 语义；此处登记口径，避免落地后按 VS Code 逐项对标时被质疑为错放。
- **涉及文件**：`shell/index.html`、`shell/src/main.ts`。
- **验收标准**：「视图」不再承载导航/跳转/设置类项；「前往」收录全部导航类命令且用户可从菜单触达；
  新增按钮 ARIA 同 MB-10（`aria-haspopup` + `aria-expanded`）。

#### MB-12 · 「设置 / Live Templates / 最近的文件」归位（P1）

- **现状/证据**：
  - 「设置」「Live Templates」放在「视图」语义不通（设置不是视图）——PyCharm 为「文件 → 设置」、
    VS Code 为「文件 → 首选项 → 设置」；
  - 「Live Templates」本质是设置面板 `templates` 分类，应与「设置」归一处（`openSettingsPanel("templates")`）；
  - 「视图 → 最近的文件」实为「最近打开的文件」，属文件范畴，现与「文件 → 最近的工作区」拆在两个菜单。
- **建议方案**：
  - 「文件」末尾新增「偏好设置」**子菜单**（对标 VS Code File → Preferences，推荐形态；落地时若嫌
    二级展开重可退化为两个并列项，属实现细节自由度）：「设置」`openSettingsPanel()`、
    「Live Templates」`openSettingsPanel("templates")`；
  - 「最近的文件」`openRecentFiles()` 移到「文件 → 打开最近的文件」附近（或并入「最近」子菜单）。
- **涉及文件**：`shell/src/main.ts`。
- **验收标准**：「视图」不再出现设置/模板/最近文件；「文件」下可触达设置、模板、最近工作区、最近文件。

#### MB-13 · 新增「帮助」顶级菜单（P2）

- **现状/证据**：已有 `getVersion`（`main.ts:14` 从 `@tauri-apps/api/app` 导入）、作者指南
  （`pluginsTab.ts::openGuide()`，插件作者指南，落盘 docs → `openFile` 自动开预览）、
  日志/数据目录打开命令（`open_log_dir` / `open_data_dir`，见 `settingsPanel.ts:515/519`、`storagePanel.ts:344`），
  但**无任何菜单入口**到达「关于 / 版本 / 文档 / 打开日志目录 / 欢迎页」。
- **建议方案**：新增「帮助」菜单，含以下项（按可行性排序）：
  - **关于**：`getVersion()` 拼装应用版本 + 项目信息。**两档实现**（v1.3 补充）：
    - 轻量档（一期推荐）：复用 `dialog.ts` 既有 `openAlert`（长指导通道，纯文本 + 标题），零新增 modal，工作量「小」；
    - 品牌档（后续可选）：新建 modal（logo / 链接 / 多行信息），须遵守 UI-05 焦点陷阱（复用 `focusTrap.ts`）
      + UI-16 ARIA 规范（`role=dialog`/`aria-modal`/`aria-labelledby`），工作量「中」。
    按 §1 约束，品牌档须落独立模块（如 `aboutDialog.ts`），不进 `main.ts`；
  - **打开日志目录**：`invoke("open_log_dir")`；
  - **打开数据目录**：`invoke("open_data_dir")`（设置目录即数据目录，无独立命令）；
  - **作者指南**：复用 `pluginsTab.ts::openGuide()`（需先导出该私有函数），或直接在菜单内重写「落盘 docs → openFile」逻辑；
  - **欢迎页**（已裁决：一期不纳入）：当前欢迎页（`#editor-overlay`）仅在无打开文件时显示，按需展示需补
    force-show 逻辑；登记为后续可选项，待有真实需求再加。
- **工作量说明**：轻量档「小」、品牌档「中」——任务总览按「小-中」登记，一期先做轻量档。
- **涉及文件**：`shell/index.html`、`shell/src/main.ts`、`shell/src/extensions/pluginsTab.ts`（导出 openGuide）。
- **验收标准**：帮助菜单可触达关于（含版本号）、日志目录、数据目录三项，作者指南建议纳入（导出 `openGuide` 即可）；
  欢迎页一期不纳入；新增按钮 ARIA 同 MB-10（`aria-haspopup` + `aria-expanded`）。

#### MB-14 · Git 菜单平铺过长，同步 / 贮藏分组（P3）

- **现状/证据**：Git 菜单 11 个动作项 + 5 条分隔线全平铺（初始化/暂存全部/提交/提交全部/抓取/拉取/推送/
  贮藏/弹出贮藏/切换分支/提交历史/打开面板）。
- **建议方案**（可选优化；侧栏已有完整 Git 面板，菜单是快捷入口）：「抓取/拉取/推送」归「同步」子菜单、
  「贮藏/弹出贮藏」归「贮藏」子菜单，视觉长度减半；其余保持平铺。
- **涉及文件**：`shell/src/main.ts`。
- **验收标准**：Git 菜单分组后各项 action 不变，子菜单展开正常。

#### MB-15 · 「编辑」菜单补高频项（P4）

- **现状/证据**：「编辑」只有撤销/重做/查找/替换/格式化/整理导入 6 项，缺「注释切换 / 取消注释」、
  「在文件中查找 / 替换」（全局搜索替换）等高频动作——目前这些只靠快捷键或命令面板。
- **建议方案**：补「注释切换」（触发 Monaco `editor.action.commentLine`）、「在文件中查找」「在文件中替换」
  （切到搜索侧栏并聚焦，复用 `setSidebarTab("search")`）。
- **涉及文件**：`shell/src/main.ts`。
- **验收标准**：编辑菜单含注释切换与全局查找/替换入口，行为与命令面板一致。

## 5. 推进建议（批次划分）

| 批次 | 内容 | 说明 |
|---|---|---|
| 第一批 | MB-10、MB-11、MB-12（MB-16 实测随行） | 内容规划「增 + 迁移」，纯组合现有 action，风险最低、用户感知最直接（菜单顺序与调试归属已裁决，见 §3.3 / MB-10） |
| 第二批 | MB-01、MB-02、MB-03、MB-04、MB-07 | 交互缺陷修复 + hover 一致性 + 级联拦截（MB-04 前移） + 注释漂移，改动小 |
| 第三批 | MB-13 | 帮助菜单落地（依赖 `getVersion` / `open_log_dir` / `open_data_dir` 已就绪；「关于」先做 openAlert 轻量档） |
| 第四批 | MB-08、MB-05、MB-06 | 能力补齐：接口对齐 → 键盘漫游 → resize 兜底 |
| 第五批 | MB-09、MB-14、MB-15 | 细节打磨与可选项 |

每批完成后：
1. `npm run build`（tsc + vite build）通过，无类型错误；
2. `npm test`（vitest，`shell/src/__tests__/`）全绿；
3. **涉及交互逻辑变更的（MB-01/02/04/05）须补 `menuBar.test.ts` 测试**，钉住三角缓冲、hover 切换、
   级联展开、键盘漫游等不变量（参照 UI-30 为 `menu.test.ts` 扩 7 项的做法，并做变异验证确认非空洞）；
4. 涉及键盘/级联的（MB-04/05）手动验证鼠标与键盘两条路径；
5. 深/浅两套主题下过一遍视觉（MB-03/09）。

## 6. 与既有方案的关系

- UI-30（`ui_design_improvement_plan.md`）已交付菜单 ARIA 语义与 ↑↓/Enter/Esc 键盘导航，本文档在其之上延伸，
  **不重复**；MB 系列只登记 UI-30 未覆盖的机制/交互与内容规划问题。MB-05 的 `role="menubar"` 是 UI-30
  只做了「下拉容器 role=menu」而未覆盖 menubar 容器本体的补全，非重复。
- 「工具」菜单的插件 flyout 框架（`groupToolsByCategory` + `PRESET_CATEGORIES`）设计合理，
  本文档**不动**，仅在具体条目需要时扩展（如 MB-04 二级级联）。
- 两套菜单渲染器（`menu.ts` 扁平弹出 / `menuBar.ts` 级联 flyout）的分裂是**既有架构决策**（分工注释见两文件
  头部，语义不同刻意不合并），本计划不改变；MB-08 只对齐 `MenuEntry` / `MenuItem` 的**数据字段**，
  DOM/CSS 仍各自维护（`.ctx-menu-item` 在 `#ctx-menu` / `#menu-dropdown` / `#menu-submenu` 三容器下的
  display 差异是刻意的隔离手段，非债）。
- UI-19 / UI-27（标题栏功能分区 `.menubar-sep`）不受本计划影响——新增 3 个菜单按钮落在既有菜单区内，
  菜单区与动作区的分隔线位置不变；菜单区变宽对 800px 最小窗口的挤压风险已立 **MB-16** 盯住。

## 7. 进度记录

> 每批完成后在此追加记录（参照 `ui_design_improvement_plan.md` §7 格式）：日期 · 批次 · 各条目结论 ·
> 涉及改动 · 验证结果（build/test/lint）· 需人工抽查的可见变化 · 本批发现但未纳入范围的存量缺口。

### 2026-09-21 · 第一批（MB-10 + MB-11 + MB-12 + MB-16 实测缓解）已完成

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| MB-10 | 已完成 | `index.html` 新增 `data-menu="run"` 按钮（含 ARIA）；`main.ts::getMenuItems` 新增 `case "run"`：运行区（运行脚本/运行项目/运行配置…/停止运行）+ 调试区（启动调试/停止调试/单步跳过/进入/退出/运行到光标处/求值表达式）+ 收尾（运行历史）。单步三命令走命令面板同款 `import("./dap/client")` 动态导入；全部快捷键标签经 `kb.bindingLabel()` 同源 |
| MB-11 | 已完成 | `index.html` 新增 `data-menu="go"` 按钮；`getMenuItems` 新增 `case "go"`（转到文件/转到行/Search Everywhere/命令面板/后退/前进）；「视图」裁剪为布局+工具窗类（文件树/搜索/本地历史/书签列表/Markdown 预览/切换侧栏/切换底部面板），导航类 6 项全部迁出 |
| MB-12 | 已完成 | 「文件」新增「打开最近的文件」（自「视图」迁入）与「偏好设置」子菜单（设置 / Live Templates，自「视图」迁入）；「视图」不再承载设置类项 |
| MB-16 | 实测+缓解已完成 | `style.css` 新增 `@media (max-width:900px) { .menubar-title { display: none } }`（复用 UI-21 断点推导：800<900 可达；标题收起后 logo 仍在）。窄于 900px 时「OpenCharm」标题文字隐藏，8 菜单 + 右侧动作区在 800px 下限不再挤压 |

顶级菜单最终顺序（§3.3 已锁定）：文件 · 编辑 · 视图 · 前往 · 运行 · Git · 工具 · 帮助——前 6 个已就位，「帮助」待第三批（MB-13）。

验证：`npm run build`（tsc + vite build）通过（仅既有 chunk 大小警告）；`npm test` **51 个测试文件、491 项测试全部通过**，无回归；`read_lints` 对 `main.ts` 返回 0 诊断；打包产物 CSS 已核验包含 `.menubar-title{display:none}` 规则（防构建链静默丢弃）。

需人工抽查的可见变化：
- 菜单栏新增「前往」「运行」两个菜单（顺序：文件·编辑·视图·前往·运行·Git·工具），「工具」后到窗口控制之间的分隔线位置不变；
- 「视图」菜单明显变短（16 项 → 8 项）；「设置 / Live Templates / 最近的文件」不再出现在「视图」；
- 「文件」末尾新增「偏好设置」子菜单（悬停/→ 展开：设置 / Live Templates），「最近的工作区」下方新增「打开最近的文件」；
- 「运行」菜单三分区（运行区/调试区/收尾），调试区 7 项与调试工具栏/快捷键行为一致；
- 窗口宽度压到 ≤900px 时标题栏「OpenCharm」文字消失（logo 保留），拉宽恢复；
- 深/浅两套主题下过一遍上述菜单（无样式改动，理论上零差异）。

本批无新增测试（纯数据层组合 + 一条媒体查询，无交互逻辑变更——MB 系列要求补 `menuBar.test.ts` 的是第二批的 MB-01/02/04/05）。

### 2026-09-21 · 第二批（MB-01 + MB-02 + MB-03 + MB-04 + MB-07）已完成

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| MB-01 | 已完成 | `menuBar.ts` 普通项 `mouseenter → hideSubmenu`（立即关）改为 `scheduleSubmenuClose()`（250ms 延时关）——与父项 mouseleave 同一计时器模型（`submenuTimer` 单变量，天然互斥：新计时重置旧的）。斜移扫过普通项只重置关闭计时；计时内落入子菜单容器即取消关闭，形成三角缓冲。**实现迭代**：初版多写了一个裸 `setTimeout`（不经计时器管理，进子菜单后仍会强关），被新测试「斜移落入子菜单容器会取消关闭」用例抓出后删除——只保留统一延时模型 |
| MB-02 | 已完成 | `menuBar.ts` `.menubar-item` 加 `mouseenter`：仅当已有菜单展开（`activeMenuBtn` 非空且非自身）时切换，未展开时悬停不弹；复用 click 的 `hideMenuDropdown() → showMenuDropdown()` 路径，aria-expanded 同源切换 |
| MB-03 | 已完成 | `style.css` `.menubar-item:hover` 由实心 `--accent`+`--on-accent` 拆分为 hover（`--hover` 浅色）与 `.active`（实心 accent，展开态指示）两条规则，与 UI-20 收敛后的轻量 hover 体系一致 |
| MB-04 | 已完成 | `menuBar.ts` `openSubmenu` 渲染循环加降级拦截：`raw.submenu` 存在时 `console.warn` + 截断字段按普通项渲染。**实现迭代**：`for (const it of children)` 的 const 迭代变量不可重赋值（`Assignment to constant variable`，async 上下文成 unhandled rejection），改为 `raw → it` 中间变量 |
| MB-07 | 已完成 | `menu.ts` 头部分工注释「故意留在 main.ts 不合并」修正为「在 menuBar.ts，刻意不与本模块合并」 |

新增 `shell/src/__tests__/menuBar.test.ts`（7 项），钉住第二批最易被「顺手简化」破坏的不变量：
- MB-02：未展开时 hover 不弹 / 已展开时 hover 相邻按钮切换（getItems 调用 + 内容 + aria 同源）/ hover 自身无操作（不闪烁）；
- MB-01：悬停普通项不立即关子菜单（250ms 内仍在）/ 斜移入子菜单容器取消关闭（缓冲闭合）/ 悬停父项 200ms 展开不回归；
- MB-04：嵌套 submenu 触发 `console.warn` 且按普通项渲染（无 with-submenu 类、无箭头）。

**测试侧两个范式要点**（后续给 menuBar 加测试必看）：
1. `wireMenuBar` 的监听器挂共享 DOM 会叠加，**全程只 wire 一次**，数据源用可替换闭包（`currentItems`）驱动；
2. 用例间先按 Esc 归零菜单状态（否则残留展开态会让 `click` 走「同按钮=关闭」分支，用例实际没打开菜单）。

**变异验证**（确认非空洞后已还原）：MB-01 改回立即关闭 → 2 项缓冲用例精准失败；MB-02 hover 切换加 `return` 短路 → 「已展开时 hover 切换」1 项精准失败。

验证：`npm run build`（tsc + vite build）通过；`npm test` **52 个测试文件、498 项测试全部通过**（原 491 + 新增 7）；`read_lints` 对全部改动文件 0 诊断。

需人工抽查的可见变化：
- **悬停菜单按钮变为浅色高亮**（原实心蓝），点击展开时仍实心蓝——观感变化最明显的一处；
- **展开「文件」后鼠标滑到「编辑」等相邻按钮，下拉直接切换**（无需点击）；未展开时悬停不弹；
- **从「最近的工作区」斜向移动到子菜单**，子菜单不再闪断；悬停普通项 250ms 后子菜单正常收起；
- 「工具 → 分类」子菜单内若出现嵌套 submenu（当前无此数据），控制台会有 warn 而非静默丢弃。

### 2026-09-21 · 第三批（MB-13 帮助菜单）已完成

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| MB-13 | 已完成 | `index.html` 新增 `data-menu="help"` 按钮（菜单顺序收尾，「工具」之后）；`main.ts::getMenuItems` 新增 `case "help"`：关于（`getVersion` → `openAlert` 轻量档，含版本号 + 技术栈一行）/ 作者指南（复用 `pluginsTab.ts::openGuide`，已导出）/ 打开日志目录（`open_log_dir`）/ 打开数据目录（`open_data_dir`）。欢迎页按裁决一期不纳入 |

至此 §3.3 锁定的 8 个顶级菜单全部就位：**文件 · 编辑 · 视图 · 前往 · 运行 · Git · 工具 · 帮助**。

实现要点：
- 「关于」用 `openAlert`（既有对话框，焦点陷阱 / ARIA / Esc 关闭全部复用），零新增 modal——验证了计划中「轻量档工作量小」的判断；
- `openGuide` 导出复用（而非重写落盘逻辑）：它依赖 `setPluginsTabHandlers` 注入的 `openGuideFile`，main 的 `init()` 首部（任何用户交互前）已注入，时机安全；
- 三个 invoke 动作的错误路径统一 `toastFail`（与设置页 / 存储页同款反馈范式）。

验证：`npm run build`（tsc + vite build）通过；`npm test` **52 个测试文件、498 项测试全部通过**，无回归；`read_lints` 对改动文件 0 诊断。

需人工抽查的可见变化：
- 菜单栏末尾（「工具」右侧、动作区分隔线之前）新增「帮助」菜单；
- 「关于 OpenCharm」弹出既有风格对话框（标题 + 版本号 + 技术栈说明 + 「关闭」按钮）；
- 「作者指南（插件开发）」打开的是与设置页插件 tab 同一份指南（落盘数据根 docs → 自动开 Markdown 预览）；
- 「打开日志目录 / 打开数据目录」调用系统资源管理器打开对应目录（与设置页按钮行为一致）。

### 2026-09-21 · 第四批（MB-08 + MB-05 + MB-06）已完成

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| MB-08 | 已完成 | `menuBar.ts` 的 `MenuEntry` 补齐 `icon/checked/disabled/disabledReason/danger` 五字段；`showMenuDropdown`（下拉）与 `openSubmenu`（子菜单）两处渲染分支各自处理新字段（按计划关键约束**不共享渲染函数**，DOM/CSS 沿用各容器既有类名）：checked 显式传入（含 false）→ `role=menuitemradio`+`aria-checked`、disabled → `.disabled` 类 + `aria-disabled` + data-tip reason + 点击拦截（不执行 action 不关菜单）、danger → 红字类、icon/checked → `.mi-icon` 前导槽（勾选优先）；**禁用父项（with-submenu+disabled）不接线展开** |
| MB-05 | 已完成 | `index.html` `#menubar` 补 `role="menubar"` + `aria-label`、8 个按钮补 `role="menuitem"`（APG menubar 三件套）；`menuBar.ts` 新增 `moveMenubarFocus`（←/→ 环绕、Home/End 首尾；焦点不在按钮上时以 `activeMenuBtn` 为基准），挂 `#menubar` keydown；下拉内新增 `onArrowLeft`（切上一个顶级菜单，子菜单开着先收回）；MB-02 hover 切换与 click 切换统一收敛到 `showMenuDropdownFromBtn` 单一入口 |
| MB-06 | 已完成 | `window resize` 时若下拉展开：下拉宽度超出视口 → 收起；否则重定位（贴按钮左缘/下缘）+ 子菜单同步 `positionSubmenu`。无展开菜单则无操作 |

`menuBar.test.ts` 扩 6 项（共 13）：MB-05 漫游（→/← 环绕 / Home / End + 展开态下拉内 ← 切菜单）×2、MB-08 下拉分支字段映射（含 checked=false 也是 menuitemradio）×1、disabled 点击不执行不关菜单 ×1、禁用父项不展开 ×1、子菜单分支字段 ×1。测试骨架同步补 `#menubar` 容器（漫游 keydown 挂在其上，按钮须在容器内）。

**变异验证**（确认非空洞后已还原）：MB-05 禁用 ← 漫游 → 漫游用例精准失败；MB-08 去掉 disabled 点击拦截 → 2 项精准失败。

**本批抓到的类型错误**（build exit 2，测试先行未拦住——vitest 不做全量 tsc）：`Element` 上访问 `.dataset`（测试 2 处，改 `as HTMLElement`）+ click 重构后残留未用变量 `menu`（删）。

验证：`npm run build`（tsc + vite build）通过；`npm test` **53 个测试文件、504 项测试全部通过**（原 498 + 新增 6）；`read_lints` 0 诊断。

需人工抽查的可见变化：
- **键盘漫游**（本批最需验证的）：聚焦任一菜单按钮（Tab 到菜单栏）后 ←/→ 在 8 个菜单间环绕移动，展开态下移动即切换菜单；Home/End 跳首尾；下拉内按 ← 切到上一个菜单；
- 读屏报「菜单栏 / 菜单项」；
- **窗口 resize 时展开的菜单跟随重定位**，极窄窗口自动收起（不再滞留错位）；
- 现有菜单视觉零变化（MB-08 新字段当前无调用方，属能力预留——数据源可用 `icon/checked/disabled/danger` 表达，见 main.ts 各 case）。

### 2026-09-21 · 第五批（MB-09 + MB-14 + MB-15）已完成 —— 全计划收官

| 编号 | 结论 | 涉及改动 |
|---|---|---|
| MB-09 | 已完成 | `style.css` `.sub-arrow` 字号 `--text-xs` → `--text-sm`（❯ 字形细长，xs 下发虚；同档后与 label 重心对齐，颜色/对齐不变） |
| MB-14 | 已完成 | `main.ts` Git 菜单「抓取/拉取/推送」归「同步」子菜单、「贮藏/弹出贮藏」归「贮藏」子菜单（原 5 项平铺 → 2 个父项），action 原样迁移零逻辑改动 |
| MB-15 | 已完成 | `main.ts` 编辑菜单补「注释 / 取消注释」（Monaco `editor.action.commentLine`，Ctrl+/）与「在文件中查找」（切搜索侧栏 + 聚焦，`global_search` 键位同源）。**口径说明**：搜索侧栏当前无替换 UI，「在文件中查找/替换」按计划落地为查找入口（与 Ctrl+Shift+F 行为一致）；侧栏补替换框属另一条独立需求，不在本计划范围 |

验证：`npm run build`（tsc + vite build）通过；`npm test` **53 个测试文件、504 项测试全部通过**，无回归；`read_lints` 对改动文件 0 诊断。

需人工抽查的可见变化：
- 子菜单父项右侧 `❯` 箭头略变大、与文字重心对齐；
- Git 菜单从 11 项平铺变为「同步 / 贮藏」两个可展开父项（悬停/→ 展开正常）；
- 编辑菜单新增「注释 / 取消注释」（选中行按 Ctrl+/ 同款效果）与「在文件中查找」（切到搜索侧栏）。

**第五批完结**：MB-09 ✅、MB-14 ✅、MB-15 ✅。**至此 16 项全部完成，本计划收官。**

## 8. 收官总结（2026-09-21）

| 批次 | 条目 | 交付要点 |
|---|---|---|
| 第一批 | MB-10/11/12 + MB-16 实测缓解 | 顶级菜单 5→8（文件·编辑·视图·前往·运行·Git·工具·帮助）；「视图」16 项裁至 8 项；设置/模板/最近文件归位；窄窗口隐藏标题 |
| 第二批 | MB-01/02/03/04/07 | 三角缓冲、hover 切换、用色统一、级联降级拦截、注释修正 + `menuBar.test.ts` 7 项 |
| 第三批 | MB-13 | 帮助菜单（关于/作者指南/日志目录/数据目录），8 菜单齐位 |
| 第四批 | MB-08/05/06 | `MenuEntry` 五字段能力对齐、menubar 键盘漫游 + APG 三件套、resize 兜底 + 测试扩至 13 项 |
| 第五批 | MB-09/14/15 | 箭头字号、Git 分组、编辑菜单补高频项 |

**累计交付**：16 项任务全部完成；新增测试 13 项（`menuBar.test.ts`，含两轮变异验证确认非空洞）；全量测试从 491 增至 **504 项全绿**；六项决策（运行合并/菜单顺序/级联降级/MB-16/批次前移/欢迎页不纳入）全部按裁决落地。

**遗留登记**（不在本计划范围，供后续立项参考）：
- 搜索侧栏无替换 UI（MB-15 落地时发现，「在文件中查找/替换」的替换半边缺位）；
- 帮助菜单「欢迎页」子项需 force-show 逻辑（裁决一期不纳入）；
- 二级级联完整支持需重构 `submenuEl` 为多实例栈（裁决降级拦截，待真实需求另立条目）。
