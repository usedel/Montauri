# 微交互差距调研与落地（PyCharm / VSCode 对标 · 微交互批）

> 版本：v1.1 · 日期：2026-10-09 · 性质：调研报告 + 第一/第二梯队落地记录
> v1.1（2026-10-09 下午）：**第二梯队 T4 + T6 已落地**（§3.6/§3.7），T5（外部文件拖入）
> 仍登记备查；验证基线更新：vitest 108 文件/1332 用例、e2e-ui 66/66、微交互 spec 7/7。
> 背景：以文件树装饰批（gitignore 灰显 + 错误/警告着色，commit `41eabcf`）为契机，
> 系统对照 PyCharm 与 VSCode 的**微交互层**（既有调研未覆盖的细颗粒度）找差距。
> 与既有文档的关系：`pycharm_feature_research_report.md`（功能级，P0-P2 已全交付）与
> `dx_features_backlog.md`（DX 储备，PR-A~Q 已全收官）覆盖大颗粒；本档聚焦两者都没碰的
> 「状态可视传达 + 输入手势」微交互。冲突时以 `python_ide_dev_plan_v2.md` 为准。

## 1. 调研结论：六项差距清单（全部经代码核实）

### 第一梯队：与文件树装饰同构的「状态可视传达」（已全部落地，见 §3）

| # | PyCharm/VSCode 行为 | 落地前现状（代码证据） | 落地裁决 |
|---|---|---|---|
| T1 | **树侧「运行中」指示**：脚本运行时树中条目带进行中状态（VSCode task 运行态） | `renderTabs` 有 `.tab-running`（`runningPathsOf()` 数据源），但 `renderTreeItem` 从不消费——切到树视图运行感丢失 | ✅ 已落地（§3.1） |
| T2 | **状态栏 Ln, Col 光标位置 + 选中计数**（点击跳行） | `#statusbar` 无行号列号（index.html:443-465 逐项核实）；选区统计全库 0 命中 | ✅ 已落地（§3.2） |
| T3 | **Ctrl+滚轮缩放 + Ctrl+0 复位** | **主体已存在**（P25-T08 交付自研 wheel 监听）——但调研发现三个子缺口：无 Ctrl+0 复位；分屏编辑器不同步；8/32 魔法数两处漂移。另发现**存量 bug**：wheel 监听挂 `getDomNode()` 冒泡阶段，合成事件路径下被 Monaco 内层 `stopPropagation` 拦截（§3.3） | ✅ 已落地（§3.3） |

### 第二梯队：交互能力扩展（T4/T6 已落地，见 §3.6/§3.7；T5 登记备查）

| # | 行为 | 现状（落地前代码证据） | 状态 |
|---|---|---|---|
| T4 | tab 拖拽排序 | `renderTabs` 的 tab 元素无 `draggable`（main.ts 核实）；树有 DnD 但 tabbar 完全没有 | ✅ 已落地（§3.6） |
| T5 | 外部文件拖入窗口打开 | 全局无 drop 处理；Tauri 2 `onDragDropEvent`（WebView2 通道）整链路缺失 | 登记备查（估约半天） |
| T6 | 空白字符渲染切换（`renderWhitespace`）+ 括号对参考线（`guides.bracketPairs`） | `renderWhitespace` 全库 0 命中；`buildEditorOptions` 的 guides 只配了 indentation 没配 bracketPairs | ✅ 已落地（§3.7）

### 明确不借鉴（对照铁律与既有裁决）

| 项 | 不做的理由 |
|---|---|
| 剪贴板环（Ctrl+Shift+V） | 需自维护剪贴板历史，价值中等，登记不排期 |
| 编辑器内文本拖放（`dragAndDrop: true`） | 一行配置但场景少（拖动文本），顺手项 |
| sticky 预览 tab（VSCode italic 预览态） | 无预览 tab 概念；md 预览是独立 tab 体系，引入破坏现有语义 |
| 平滑滚动 | 已显式关闭（`settingsPanel.ts` motion 裁决），不动 |

### 调研方法论备注（本次踩的坑，值得记）

**T3 的假阴性教训**：初判「Ctrl+滚轮缩放缺失」是按 Monaco 选项名 `mouseWheelZoom`
全库搜索得出的——但实现走的是**自研 wheel 监听**（P25-T08），不含该选项名。功能存在
性核实不能只按「标准选项/标准 API 名」搜，还要按行为入口（wheel / 字号 / status-font）
搜。同日还发现反向教训：**该自研监听在合成事件路径下从未生效过**（冒泡被 Monaco 内层
拦截）——「实现存在」≠「链路可达」，e2e 才是可达性的真源。

## 2. 与维护态的关系

v1.4 报告（`improvement_and_roadmap_report.md`）定义的维护态边界：「运行侧只受理开销
回归 / 工具箱侧只受理缺陷修复与打磨」。本批全部落在**编辑器/树/状态栏基本功侧**：
- T1 是既有装饰体系（文件树装饰批）的补全——纯视觉投影，零新数据源；
- T2/T3 是纯 UI 件（新模块 + 既有设置项刷新），零新进程零常驻轮询；
- 不碰运行链路（runState 只读消费）。

## 3. 第一梯队落地记录（2026-10-09，门禁全绿）

### 3.1 T1：树侧运行中指示

- **数据源**：`runState.ts::runningPathsOf()`（与 tab 的 `.tab-running` 同源同语义）——
  `runState` 是零依赖纯状态层，fileTree 直接 import 无环。
- **渲染**：`renderTreeItem` 尾部加 `.tree-running` class（`runningPathsOf().has(path)`）；
  轻量刷新函数 `refreshTreeRunningClasses()` 与既有 `refreshTreeHealthClasses` 同构
  （只换 class 不重建 DOM）。
- **刷新时机**：`main.ts::renderTabs` 尾部——runFlow 的全部运行态迁移（preparing→running
  →exited、失败清理）都调 `h().renderTabs()`，它是运行态变化点的天然汇聚处；树不可见时
  刷新空 DOM 无开销。
- **CSS**：`.tree-item.tree-running::after` 用 codicon loading 字形（`\eb19`）+ 就地
  `oc-spin` 动画（伪元素挂不了 `codicon-modifier-spin` 类）；`data-reduce-motion` 与
  `prefers-reduced-motion` 双通道压制（静止圆弧仍表「加载中」，UI-11 同款取舍）。
- **与 git badge 同位**：`margin-left: auto` 右对齐——运行中的文件不会有 M/A/D badge
  （运行不改文件），无视觉冲突；与错误/警告着色可并存（转圈不覆盖颜色）。

### 3.2 T2：状态栏光标位置芯片

- **新模块** `shell/src/cursorStatus.ts`（照 engineChip.ts 独立模块范式）：
  - `cursorStatusText(pos, sel)` 纯函数——单测锁语义：无选区只显示位置；单行选区显示
    字符数；多行选区显示行跨度 + 字符数（VSCode 同款格式）；
  - `refreshCursorStatus()`——非文件 tab（diff/db/md）隐藏；主光标口径（多光标不聚合）；
  - `wireCursorStatus()`——`onDidChangeCursorPosition` + `onDidChangeCursorSelection`
    双事件驱动；点击 = `openQuickOpen("line")`（与 Ctrl+G goto_line 同入口）。
- **接线**：`main.ts` 编辑器创建后 wire 一次；`activateTab` 文件分支刷新（与
  `renderProblemsChip` 同款时机——切 tab 即时按新 viewState 刷新，不等事件）。
- **DOM**：`index.html` 状态栏 `#status-file` 后加 `#status-cursor`（role=button，
  tabindex=0，Enter/Space 可激活——UI-16 纪律）。
- **i18n**：`status.cursor.position/selected/selectedLines/aria` 中英四词条。

**实现中抓到的 bug（已修，登记）**：初版判定 `tab.kind !== "file"` → 普通文件 tab 的
`kind` 是 **undefined**（可选字段，不显式设置）→ 恒 hidden。正确口径：`tab?.kind ?? "file"`
兜底（与 activateTab 的 `kind === "diff"` 判定同源——那类判定天然对 undefined 安全，
反向判定（`!== "file"`）则必须兜底）。e2e 探针定位（芯片 hidden + 无 console 错误 →
逐步收窄到分支条件）。

### 3.3 T3：Ctrl+滚轮缩放补齐 + 存量 bug 修复

- **存量 bug（探针三连实测定位）**：P25-T08 的 wheel 监听挂 `app.editor.getDomNode()`
  **冒泡阶段**——Monaco 的 wheelHandler 在内层节点（overflow-guard 层）`stopPropagation`，
  合成事件路径下监听收不到（探针：capture 哨兵命中、冒泡业务监听不触发）。真机真实滚轮
  是否受影响未单独验证（真实事件的 target 层级可能不同），但挂点加固是双保险：
  **改挂 `#editor` 外层容器 + `capture: true`**——事件必经之路，与内层结构解耦。
- **三个子项补齐**：
  1. **Ctrl+0 复位**（window 级 keydown，Digit0/Numpad0，preventDefault 吞掉浏览器页面
     缩放复位；字号回到 `DEFAULT_SETTINGS.font_size`）；
  2. **分屏同步**：wheel 与 Ctrl+0 都补 `splitEditor.refreshSplitEditorOptions()`
     （此前只有主编辑器，分屏字体脱节）；
  3. **范围常量收敛**：`FONT_SIZE_MIN/MAX` + `clampFontSize` 导出，main.ts 的 wheel 与
     Ctrl+0 同源引用（消除 8/32 魔法数两处漂移）。
- **刻意不进键位表**：Ctrl+0 与 Ctrl+滚轮同族（轻量输入手势，直接生效 + 存盘语义），
  不做可配置键位——与 wheel 同等地位，避免键位表膨胀。

### 3.4 验证基线

- `tsc` 0 错；
- vitest **107 文件 / 1326 用例全绿**（新增 `cursorStatus.test.ts` 5 例）；
- e2e 新 spec `e2e/ux/08-microinteractions.spec.ts` **4/4**（T2-1 芯片随移动/选区更新、
  T2-2 点击跳行弹窗、T3-1 滚轮缩放读数联动、T3-2 Ctrl+0 复位）；
- e2e-ui 门禁 **66/66**（含新 spec；ux/editor/git/debug/p3/session 等域无存量回归）；
- 预算：本批涉及文件全 PASS——`main.ts` 2363/2400、`style.css` 5828/5850、
  `git.ts` 3220/3300。
- **存量超限登记（与本批无关）**：`fs_cmds.rs` 4062/4000、`git_cmds.rs` 1954/1950 为
  其他提交累积的既有 FAIL（本批未触碰两文件），按铁律须显式 PR 处理，不静默抬阈值。

### 3.5 e2e 探针方法论沉淀（本次三连探针的通用套路）

1. **链路断裂定位顺序**：DOM 存在性 → console 错误捕获 → 焦点状态检查 → 事件哨兵
   （capture 层挂计数器）→ 挂点层级对照。本次 T2（kind 兜底）与 T3（capture + 外层
   容器）都是这个顺序走出来的；
2. **合成事件的 capture 陷阱**：`dispatchEvent` 的事件 target 即派发节点——若业务监听
   在更外层且非 capture，内层 stopPropagation 会吞掉；探针哨兵要与业务监听**同节点同
   阶段**才能证明「事件能到该层」，否则证明的是另一件事；
3. **焦点交接**：树 dblclick 后焦点留在树（`focusEditor:false` 语义），键盘驱动用例
   必须先 `mouse.click` 进编辑器（探针验证 `activeElement` 为 Monaco textarea 才算
   交接完成）。

### 3.6 T4：tab 拖拽排序（2026-10-09 下午落地）

- **实现形态**：独立模块 `shell/src/tabDragSort.ts`（从 main.ts 外提——见下方「预算
  红线事件」）：`wireTabDnD(el, path)` 挂单 tab 的 dragstart/dragover/dragleave/drop；
  `wireTabDragEnd(tabbar)` 挂 dragend（拖出 tabbar 松手 = 取消）；`moveTabTo` 纯函数
  （splice 保 app.tabs 引用稳定，按 path 重找插入位防 splice 位移）。
- **插入位语义**：dragover 按目标 tab 左右半区给 `.drop-before` / `.drop-after`
  （CSS `box-shadow` 竖线指示，accent 交互色）。
- **持久化**：排序后 `scheduleSessionSave()`——session 快照按 `app.tabs` 顺序遍历，
  顺序天然进快照，重开工作区保持。
- **焦点语义**：拖拽只改顺序不切激活 tab（VSCode 同款）。
- **handlers 注入**：`setTabDragHandlers({ onMoved })`——main 注入 renderTabs +
  scheduleSessionSave，模块不反向 import main（fileTree::setFileTreeHandlers 范式）。
- **单测**：`__tests__/tabDragSort.test.ts` 6 例（前/后插入、跨格移动、相邻幂等、
  自身短路、未知路径竞态兜底）。
- **⚠ 预算红线事件（值得记）**：内联版先落 main.ts，`budget-check.mjs` 报
  **2428/2400 FAIL**——本批触发「新功能突破预算当场拆分」的第一次实践（没有静默抬
  阈值，直接外提独立模块回到 2371/2400 PASS）。外提本身也是更正确的架构动作
  （TS 规范：main.ts 不堆逻辑）。
- **e2e**：`ux/08` T4 用例（三 tab 拖 main.py 到末位，`mouse.down/move(steps:5)/up`
  真实 DnD 序列）。

### 3.7 T6：括号对参考线 + 空白字符渲染切换（2026-10-09 下午落地）

**T6a 括号对参考线**（设置项，默认开）：
- `buildEditorOptions` 的 `guides` 补 `bracketPairs` / `bracketPairsHorizontal`
  （Monaco 出厂默认 false——此前从未配置即无参考线，这是被调研抓出的隐性缺失）；
- 设置项 `bracket_pair_guides` 全链三步接线（index.html 开关 + settingsPanel 回填/
  读值/搜索关键字 + Rust `Settings` struct/Default 同步，struct 级 `#[serde(default)]`
  兜底旧配置）；
- i18n：`settings.editor.sectionEditorLabel22`（**坑**：Label14/15 已被占用且不在连续
  序列——新增设置词条前必须先搜占用）；`settings.kw.bracketPairGuides` 搜索关键字。

**T6b 空白字符渲染切换**（视图级开关，会话态）：
- 独立模块 `shell/src/whitespaceToggle.ts`：`editor.addAction` 进 Monaco 右键菜单
  （`contextMenuGroupId: "2_view"`），切换 `renderWhitespace: "all" | "selection"`
  （关闭时选区内仍显示——VSCode 出厂默认语义，零噪音）；
- **刻意不进 Settings**：PyCharm 同款是视图级开关而非持久设置，重启回默认；低频视图
  工具不占设置面板；
- toast 反馈切换结果（Monaco action 无勾选态，轻提示补可感知性）；toast 走动态
  import 防依赖链进单测。

**存量 spec 适配（E-BASIC-4）**：`.core-guide` 是 Monaco 缩进线与括号对线**共用的
CSS 类**——bracketPairs 默认开后，「关缩进线 → 0 条参考线」的旧断言不再成立。spec
适配：断言 0 前把两开关同关；重开只开缩进线（顺带验证独立开关语义）。

### 3.8 验证基线（v1.1 更新）

- `tsc` 0 错；`cargo test settings` 3/3（serde roundtrip 含新字段）；
- vitest **108 文件 / 1332 用例全绿**（新增 tabDragSort 6 例）；
- e2e：微交互 spec **7/7**（T2×2 + T3×2 + T4 + T6a + T6b）；editor 03 **4/4**
  （E-BASIC-4 双开关口径适配后）；e2e-ui 门禁 **66/66**；
- 预算：`main.ts` **2371/2400 PASS**（外提后）；`style.css` 5831/5850 PASS；
- **环境方法论补一条**：e2e 大批量失败且报 `page.goto waiting for "load"` / 「编辑器
  尚未初始化」时，先查 dev server 是否为**复用的陈旧实例**（依赖图过期，PR-P/Q 验收
  登记过的同款）——`npm run e2e:clean` 后重跑即可分辨环境问题与真回归。
