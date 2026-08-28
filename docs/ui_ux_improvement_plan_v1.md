# UI/UX 设计改进计划 v1

> 日期：2026-08-26 · 状态：**待评审（本文档为开发依据）**
> 定位：外壳视觉与交互体验的系统性改进批次，不改变功能范围与架构铁律（`probe` / `intel` 独立、不侵入内核）。
> 上游：`python_ide_dev_plan_v2.md`；涉及文件均在 `shell/` 前端范围内（`index.html` / `src/*.ts` / `src/style.css`）。

## 1. 背景与目标

Phase 1–3 交付了完整的「写、补全、运行、调试跳转」闭环，界面为 VS Code 深色风格克隆，信息架构成熟、IDE 交互细节基本齐全。但从产品设计角度存在四类系统性问题：

1. **主题系统残缺**：浅色主题只作用于 Monaco，外壳无对应变量，出现"浅色编辑器 + 深色外壳"撕裂；
2. **设计语言不统一**：emoji / Unicode 字符 / 文本徽标三种图标风格混排；色值硬编码散落；字号梯度细碎（11/11.5/12/12.5/13/14 六档并存）；
3. **空间不可调**：侧栏固定 280px、底部面板固定 220px，无拖拽分隔条；
4. **动效缺失 + 可访问性短板**：面板/模态瞬间显隐；按钮普遍无 `:focus-visible`。

**目标**：在不引入 UI 框架（维持 Vanilla TS + 单 CSS 文件）的前提下，收敛设计语言、补齐 IDE 基础交互、建立品牌识别度。

**非目标**：不重写布局架构、不引入 CSS 预处理器 / Tailwind、不改变 Monaco / xterm 内核配置方式。

## 2. 现状盘点

### 2.1 做得好的（保持）

| 项 | 说明 |
|---|---|
| 信息架构 | Activity Bar + 侧栏 + 底部面板 + 状态栏，VS Code 式成熟布局（`views.ts` 视图注册表结构性防遗漏） |
| 设计 token 基础 | `:root` 已定义 `--bg / --fg / --accent / --ok` 等 14 个变量（`style.css` L1-16） |
| IDE 交互细节 | 自绘右键菜单、菜单快捷键提示、拖拽反馈、脏标记、traceback 点击跳转、Ctrl+滚轮缩放 |
| 欢迎页 | 径向渐变光晕 + 渐变 logo + 最近工作区 + kbd 快捷键网格，完成度较高 |
| 状态栏信息架构 | 路径 / 分支 / 字号 / 解释器 / LSP 状态，信息齐全 |

### 2.2 问题清单

| # | 问题 | 位置 | 严重度 |
|---|---|---|---|
| P-01 | Light 主题只影响 Monaco，外壳 CSS 无 light 变量覆盖 | 设置面板 `theme` → `main.ts` L1155 | 高（缺陷级） |
| P-02 | 按钮普遍无 `:focus-visible`，键盘用户无焦点反馈 | `style.css` 全局 | 高（可访问性） |
| P-03 | 侧栏 / 底部面板无拖拽调宽 / 调高 | `#sidebar` 280px / `#bottom` 220px 固定 | 高（IDE 基础能力） |
| P-04 | 图标为 emoji + Unicode + 文本徽标混排，跨平台渲染不一致、无展开/折叠态 | `util.ts fileIcon()` / `index.html` | 高（视觉） |
| P-05 | 硬编码色值散落：`#2a2d2e`（hover，10+ 处）、`#37373d`（selected）、`#4b4b4b`、`#e5484d` 等 | `style.css` 全文 | 中 |
| P-06 | 面板 / 模态瞬间显隐（`.hidden { display:none }`），无过渡动画 | 全局 | 中 |
| P-07 | 字号梯度细碎：11 / 11.5 / 12 / 12.5 / 13 / 14 / 18 / 24 | `style.css` 全文 | 中 |
| P-08 | 标签页无文件类型图标，扫描效率低 | `main.ts renderTabs()` | 中 |
| P-09 | 状态栏整条 `--accent` 蓝底，视觉重量过大；信息无分组 | `#statusbar` | 低 |
| P-10 | Activity Bar 激活态仅背景色区分，识别性弱 | `#activity-bar` | 低 |
| P-11 | Tooltip 全用原生 `title`（延迟高、样式不可控） | 全局工具条按钮 | 低 |
| P-12 | 品牌识别度弱：仅欢迎页渐变 🐍，无正式 logo | 欢迎页 / 标题栏 | 低 |
| P-13 | 双强调色并存：`--accent` 蓝（按钮/状态栏）与 `--ok` 青绿（标签顶边/激活线） | token 定义 | 低 |
| P-14 | 代码字体默认空串（Monaco 内置）、设置面板为纯文本框无候选；等宽字体栈硬编码多处 | `settingsPanel.ts` / `style.css` | 低 |

## 3. 设计原则

1. **快而克制**：IDE 动效一律 ≤150ms，提供「减少动画」开关；宁可无动画不要慢动画。
2. **单一主色**：确立青绿 `#4ec9b0`（现 `--ok`）为品牌主强调色，贯穿激活态（标签顶边、底部 tab 激活线、分支名、Activity Bar 指示条）；蓝色降为链接 / 信息色。状态栏由整条蓝底改中性深色。
3. **单色图标优先**：统一 16×16 网格、1.5px 线宽单色 SVG；文件类型允许例外彩色。
4. **token 收敛**：一切色值走语义变量，为多主题铺路；禁止新增裸色值。
5. **可访问性底线**：所有可交互元素具备 `:focus-visible`；对比度不低于 WCAG AA。

## 4. 设计规范

### 4.1 色彩 token（在现有 `:root` 基础上扩充）

```
新增语义变量：
--hover:        #2a2d2e   （列表/按钮悬停底）
--selected:     #37373d   （选中底）
--danger-bg:    #e5484d   （危险按钮底）
--danger-hover: #d13a3f
--focus-ring:   var(--accent)
--scrollbar:    #4a4a4a / hover #5a5a5a

Light 主题（[data-theme="light"] 覆盖层）：
--bg #ffffff / --bg-alt #f3f3f3 / --bg-panel #ececec / --border #d4d4d4
--fg #333 / --fg-dim #6c6c6c / --hover #e8e8e8 / --selected #d6ebff
--tab-inactive-bg #ececec / --tab-active-bg #ffffff
（accent / ok / danger 语义色保持不变，仅调底与文字对比）
```

### 4.2 字号体系（4 档）

| 档位 | 尺寸 | 用途 |
|---|---|---|
| caption | 11px | 状态栏、面板标题、小按钮、徽标 |
| body-sm | 12.5px | 标签、菜单项、树节点、输出面板 |
| body | 13px | 全局基准、输入框、模态正文 |
| title | 15px / 18px / 24px | 模态标题 / Activity Bar 图标槽 / 欢迎页标题 |

废除 11.5px、12px、14px（模态标题并入 15px）三档。行高：UI 文本统一 1.4–1.5。

### 4.3 字体栈

```
UI：  "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif
代码：Consolas, "Cascadia Code", "JetBrains Mono", monospace
      （DEFAULT_SETTINGS.font_family 默认值 + 设置面板下拉候选 + 自定义输入）
```

### 4.4 图标规范

- **方案**：引入 [Codicons](https://github.com/microsoft/vscode-codicons)（MIT 协议，VS Code 官方图标字体，npm 包 `@vscode/codicons`），经 Vite 打包引入，不新增运行时依赖；
- **替换映射**：

| 位置 | 现状 | 替换为 |
|---|---|---|
| Activity Bar | 📁 🔍 ⎇ | `files` `search` `source-control` |
| 设置 / 窗口按钮 | ⚙ ─ □ ❐ ✕ | `gear` `chrome-minimize` `chrome-maximize` `chrome-close`（SVG 或 codicon） |
| 文件树工具条 | ⊟ 👁 ⟳ | `collapse-all` `eye` `refresh` |
| 文件夹 | 📁（无状态区分） | `folder` / `folder-opened` 两态 |
| 标签关闭 / 脏标记 | × / ● | `close` / `circle-filled`（保留黄点色） |
| 运行 / 停止 | ▶ / ■ | `play` `stop`（保留运行中红色态） |
| 状态栏解释器 | 🐍 | 品牌蛇形 SVG（见 4.6） |
| Git 面板 | ⎇ ⇣ ⇡ | `git-branch` `arrow-down` `arrow-up` |
| 大纲符号 | C/ƒ/v/c/p/M 单字符 | `symbol-class` `symbol-method` `symbol-variable` `symbol-property` `symbol-module` 等 |

- **文件类型图标**：`util.ts fileIcon()` 保留文本徽标方案（JS/TS/{} 等辨识度可接受），但统一为等宽 16px 槽 + 固定字号；`.py` 换品牌蛇形单色图标；目录展开/折叠用 `folder` / `folder-opened`；
- **emoji 清零**：完成后全界面不保留任何 emoji（欢迎页 logo 除外，后续由品牌 SVG 替代）。

### 4.5 动效规范

| 场景 | 动效 |
|---|---|
| 模态打开/关闭 | 120ms `opacity + scale(0.98→1)` ease-out；遮罩 120ms 淡入 |
| 侧栏视图切换 | 100ms 淡入 |
| 底部面板折叠/展开 | 150ms 高度过渡 ease-out |
| 右键菜单 / 下拉菜单 | 80ms 淡入 |
| Tooltip | 300ms 延迟出现，即时消失 |
| `prefers-reduced-motion` / 设置项「减少动画」 | 全部动效降级为 0ms |

### 4.6 品牌

- **双标识解耦**（品牌 ≠ 语言图标，二者不共用路径）：
  - **品牌标（产品标识）= Charm Snake**：S 形蛇 + 四角「charm」星，24 网格 `currentColor` 单色可缩放；蛇承 Python 意象、星点名 "Charm"，独特可注册，刻意区别于 Python 官方 logo（规避商标）。三处品牌触点：标题栏 15px（`OpenCharm` 字样左侧）、欢迎页 24px 渐变底白标（`#4da3ff → #9a6bff`）、设置头部 16px。属静态应用 chrome，内联于 `index.html`；
  - **语言图标 = 官方 Python logo 精确轮廓（去眼版）**：24 网格实心填充 `currentColor`，`util.ts::SNAKE_BODY` / `SNAKE_SVG`，用于 `.py` 文件图标与状态栏解释器。
- 品牌标归 `index.html`（与 `OpenCharm` 字样同级），语言图标归 `util.ts` 图标体系。

## 5. 分批实施计划

> 每批独立可验收、可合并（主干开发 + CI 全绿）。批次间有依赖的已标注。

### D1 · 缺陷修复与 token 收敛（P0）

**范围**：P-01、P-02、P-05、P-07

| 任务 | 要点 |
|---|---|
| Light 主题补全 | `style.css` 增加 `[data-theme="light"]` 变量覆盖层；`main.ts` 应用设置时同步 `document.documentElement.dataset.theme`；Monaco 主题与外壳联动 |
| focus-visible | 全局按钮 / 标签 / 菜单项 / Activity Bar 项补 `:focus-visible { outline: 1px solid var(--focus-ring); outline-offset: 2px }` |
| 色值收敛 | `#2a2d2e` / `#37373d` / `#4b4b4b` / `#e5484d` 等全部替换为 4.1 新增语义变量 |
| 字号整理 | 按 4.2 四档归并，废除 11.5 / 12 / 14 档 |

**验收**：浅色主题下全界面无色彩撕裂；Tab 键可遍历所有可交互元素且焦点可见；`style.css` 中裸色值仅剩 token 定义与 git 徽章/diff 语法色（登记豁免清单）。

### D2 · 空间与图标（P1）

**范围**：P-03、P-04、P-08、P-10

| 任务 | 要点 |
|---|---|
| 侧栏拖拽调宽 | `#sidebar` 右缘 4px 热区（`col-resize`），拖拽改宽，范围 180–480px，尺寸持久化到 settings |
| 底部面板拖拽调高 | `#bottom` 顶缘同法，范围 120–60% 视口高，持久化 |
| Codicons 接入 | `npm i @vscode/codicons`，按 4.4 映射表替换 Activity Bar / 工具条 / 窗口按钮 / 标签按钮 / 大纲符号 / Git 面板字符 |
| 文件夹两态 | 展开/收起切换 `folder` / `folder-opened` |
| 标签页文件图标 | `renderTabs()` 接入 `fileIcon()`，图标在文件名左侧 |
| Activity Bar 激活态 | 左侧 2px 青绿指示条 + 图标提亮 |

**验收**：两处拖拽顺滑无抖动、尺寸重启后保持；全界面无 emoji（欢迎页除外）；标签页带文件图标。

### D3 · 动效与状态栏改版（P2）

**范围**：P-06、P-09、P-11、P-14；依赖 D1（token）

| 任务 | 要点 |
|---|---|
| 模态 / 面板 / 菜单动效 | 按 4.5 规范实现；`.hidden` 改为 `display` + 过渡类双阶段（先播动画后隐藏）；支持「减少动画」设置项与 `prefers-reduced-motion` |
| 状态栏改版 | 整条蓝底 → 中性深色底（`--bg-panel` + 上边框）；左右分区 + 细分隔符；LSP 状态加彩色状态点（● 灰未启动 / 黄启动中 / 绿就绪 / 红错误） |
| 自绘 Tooltip | 通用组件：300ms 延迟、深色浮层、支持快捷键副文本；先覆盖工具条与状态栏项，原生 `title` 保留给树节点等低频场景 |
| 代码字体体验 | `DEFAULT_SETTINGS.font_family` 默认改为 4.3 代码字体栈；设置面板字体项改下拉候选（Consolas / Cascadia Code / JetBrains Mono / 自定义…）+ 实时预览 |

**验收**：所有动效 ≤150ms 且可一键关闭；状态栏无大面积蓝底；tooltip 样式统一。

### D4 · 品牌与精致度（P3）

**范围**：P-12、P-13 及组件细节

| 任务 | 要点 |
|---|---|
| 品牌蛇形 SVG logo | 单色 + 渐变两版；替换欢迎页 🐍、标题栏、状态栏解释器图标 |
| 主色统一 | 青绿升格为 `--accent` 体系的一部分：按钮主色评估（蓝→青绿或保持蓝但降饱和），以评审结论为准；登记最终双色分工到本文档 |
| 组件细节 | 标签关闭按钮仅 hover/脏态显示（设置项可选）；设置面板导航激活态改左侧指示条；文件树行高提至 22px、当前行高亮；右键菜单加边缘 flip 检测 |
| 空状态设计 | 搜索无结果 / 无 Git 变更 / 空文件夹等场景统一空状态插图与文案 |

**验收**：三处品牌触点落地；组件细节逐项对照本表勾选。

## 6. 风险与约束

| 风险 | 对策 |
|---|---|
| Codicons 字体打包增大体积（约 80KB woff2） | 可接受；如需裁剪后续用 icon font 子集化工具 |
| 动效双阶段隐藏改造面广（`.hidden` 全局使用） | 封装 `showEl/hideEl` 工具函数统一改造，逐批替换 |
| Light 主题变量遗漏导致局部撕裂 | D1 验收时逐界面截图走查（欢迎页 / 文件树 / 设置 / 终端 / 模态） |
| 主色调整影响面大 | 放在 D4，先出对比截图评审再动 |
| 与 `python_ide_dev_plan_v2.md` 后续批次冲突 | 本计划仅动 `shell/` 前端样式与交互层，不触碰 LSP / probe / intel 接线 |

## 7. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-26 | v1 初稿：现状盘点 14 项问题，D1–D4 分批计划 |
| 2026-08-26 | **D1 完成**（P-01/P-02/P-05/P-07），`tsc && vite build` + vitest 98 例全绿 |
| 2026-08-26 | **D2 完成**（P-03/P-04/P-08/P-10），`tsc && vite build` + vitest 98 例全绿 |
| 2026-08-26 | **D3 完成**（P-06/P-09/P-11/P-14），前端 98 例 + cargo 35 例全绿 |
| 2026-08-26 | **D4 完成**（P-12/P-13 + 组件细节 + 空状态），`tsc && vite build` + vitest 98 例全绿；**D1–D4 全部交付** |
| 2026-08-26 | **品牌重构**：品牌标与语言图标解耦——品牌位定稿 Charm Snake（S 蛇 + charm 星，`index.html` 三触点），`.py`/状态栏换官方 Python logo 精确轮廓（去眼版，`util.ts::SNAKE_BODY`，16→24 网格）；移除死代码 `brandSnakeSvg()` |

### D4 落地明细

1. **品牌蛇形 logo（P-12）**：D4 原定稿为描边 S 形蛇，后经品牌重构定稿为**双标识解耦**——品牌标 = Charm Snake（S 形蛇 + 四角 charm 星，24 网格 `currentColor`），三处品牌触点：标题栏 15px（`OpenCharm` 字样左侧）、欢迎页渐变底白色 24px、设置面板头部 16px，内联于 `index.html`；语言图标 = 官方 Python logo 精确轮廓（去眼版，24 网格实心填充），`util.ts::SNAKE_BODY` / `SNAKE_SVG`，用于 `.py` 文件图标与状态栏解释器。原共享路径函数 `brandSnakeSvg()`（死代码）已移除。欢迎页 📂/＋ 同步换 codicon——**全界面 emoji 清零完成**（仅剩代码注释）。
2. **主色分工（P-13 评审结论）**：**青绿 = 品牌识别，蓝 = 功能交互**。新增 `--brand` token（深色 `#4ec9b0` / 浅色 `#14806b`），品牌位切换：标题栏字样、标签页顶边、底部面板激活线、终端激活标签、Activity Bar 指示条、分支名；`--accent` 蓝保留于按钮 / 焦点 / 菜单 / 选中态。理由：青绿填充底配白字对比度仅约 2:1 不达标，且蓝色交互符合 VS Code 用户心智；`--ok` 继续承担语义「成功」（LSP 就绪点 / 运行钮 / 已暂存）。
3. **组件细节**：
   - 标签关闭按钮默认隐藏，悬停或活动（非脏）标签显示；脏标签悬停时关闭钮取代脏点（VS Code 行为，100ms 淡入）。**简化说明**：未做「可选设置项」，直接采用默认行为；
   - 设置面板导航激活态：整块蓝底 → 左侧品牌指示条 + 选中底 + 加粗；
   - 文件树行高 ~18px → 22px（`min-height`，扩大点击热区）；
   - 右键菜单边缘处理经核查已具备（`renderCtxMenu` 视口夹紧 + `positionSubmenu` 右缘 flip / 下缘夹取），无需改动。
4. **空状态统一**：新增 `util.ts::emptyState()`（codicon + 标题 + 可选说明 + compact 变体）与 `.empty-state` 样式；接入 7 处：搜索无匹配、不是 Git 仓库、无更改、未打开工作区、无提交历史、读取历史失败、大纲无符号。

**验收对照**：三处品牌触点落地 ✓；组件细节逐项勾选 ✓；全界面无 emoji ✓。

### D3 落地明细

1. **动效系统（P-06）**：新增 `anim.ts`（`showEl` / `hideEl` 两阶段隐藏，WeakMap 定时器防开关竞态）；CSS 侧 `--motion` 全局倍率（`html[data-reduce-motion]` 与 `prefers-reduced-motion` 置 0）。时长：模态 120ms 入场（opacity + scale 0.98）+ 100ms 出场、菜单 80ms、侧栏视图 100ms、欢迎页覆盖层 120ms、面板尺寸 150ms（拖拽期经 `.resizing` 关闭过渡防跟手延迟）。接入模态：设置 / 环境 / 新建项目 / 删除确认 / 模板面板 / 环绕选择器。
2. **「减少动画」设置项**：外观分类新增开关，勾选即时生效，`localStorage` 持久化（同 D2 布局尺寸的存储策略，不动 Settings 结构）。
3. **状态栏改版（P-09）**：整条 accent 蓝底 → `--bg-panel` 中性底 + 上边框，24px 高；左右分区 + `--border-soft` 细分隔符；文件路径限宽 42% 省略号；LSP 状态点（灰未启动 / 黄启动中 / 绿就绪 / 红错误，`main.ts` 引擎状态回调渲染）。
4. **自绘 Tooltip（P-11）**：新增 `tooltip.ts`（document 级委托，300ms 延迟，下方居中 + 底边翻转 + 水平夹紧，`kbd` 快捷键副文本，按下/失焦即隐）。工具条 / Activity Bar / 状态栏解释器由原生 `title` 迁移到 `data-tip`；搜索按钮 tooltip 快捷键经 `kb.bindingLabel` 跟随自定义键位。
5. **代码字体体验（P-14）**：默认字体栈改 `Consolas, "Cascadia Code", "JetBrains Mono", monospace`（TS `DEFAULT_SETTINGS` + Rust `Settings::default` 双侧同步，两侧漂移锁测试均加断言）；设置面板字体族改下拉候选（默认栈 / Consolas / Cascadia Code / JetBrains Mono / Fira Code / 自定义…）+ 自定义输入框 + 编辑器实时预览；等宽栈收敛为 `--mono` token（style.css 5 处 + 终端）。

**设计决策记录**：
- 状态栏改版后 `--on-accent-dim` token 不再使用，已移除；分支金色 `--git-branch` 由 accent 底改为中性底，浅色主题补覆盖 `#946c00`。
- 模态出场动画仅 100ms 且 `pointer-events: none`，保证关闭反馈即时不拖沓（方案 §3「快而克制」）。

### D2 落地明细

1. **拖拽分隔条（P-03）**：新增 `layout.ts`——侧栏右缘 / 底部面板顶缘各 6px 热区，拖拽调宽（180–480px）/ 调高（120px–60% 视口），双击重置默认；尺寸持久化到 **localStorage**（`opencharm.sidebar_width` / `opencharm.bottom_height`）。
2. **Codicons 接入（P-04）**：`npm i @vscode/codicons`，`main.ts` 先于 `style.css` 引入 codicon.css（保证同特异性下本项目尺寸规则生效）；新增 `util.ts::codicon()` 元素工厂。替换覆盖：Activity Bar / 窗口控制 / 设置 / 树工具条 / 大纲折叠箭头 / Git 分支条与工具栏 / 底部面板收起箭头 / 模态关闭钮 / 终端标签关闭与新建 / 标签页运行停止关闭脏标记 / 大纲符号 / SCM 暂存条目 / 模板面板增删按钮。
3. **文件图标（P-04/P-08）**：`fileIcon()` 重构为三态规格（codicon / SVG / 文本徽标）+ `renderFileIcon()` 统一 16px 槽位渲染；接入文件树、标签页、SCM 条目；文件夹展开/收起两态（`folder` / `folder-opened`），twisty 箭头换 codicon chevron 两态；`.py` 启用蛇形单色 SVG（D2 占位稿，后定为官方 Python 轮廓语言图标）。
4. **Activity Bar 指示条（P-10）**：激活项左侧 2px 青绿（`--ok`）圆角指示条。

**设计决策与偏差记录**：
- **布局尺寸存 localStorage 而非全局 Settings**：布局属视图状态（类 VS Code workspace state），避免为 UI 尺寸改动 Rust `Settings` 结构与前后端漂移锁（`state.test.ts`），符合 §6「仅动前端样式与交互层」约束。
- **codicon 字体实际 149KB**（§6 风险表预估约 80KB）：为全量字体未子集化，可接受；如需瘦身后续做子集化。
- **蛇形图标演进**：D2 占位单色稿（S 形笔画 + 头点）→ 最终定为官方 Python logo 精确轮廓（去眼版，`util.ts::SNAKE_SVG`，`.py` 文件图标与状态栏）；品牌位另立 Charm Snake 标（见 §4.6）。

**豁免清单追加**：
- 欢迎页 🐍 / 📂 / ＋（D4 品牌批次统一替换）；
- Monaco 补全弹窗 detail 文本中的 `⟳`（`completion.ts` / `postfix.ts`，Monaco suggest 部件纯文本渲染，不受外壳 DOM/图标体系管辖）；
- 代码注释中的符号字符（非界面渲染内容）。

### D1 落地明细

1. **Light 主题补全（P-01）**：`style.css` 新增 `[data-theme="light"]` 覆盖层（约 40 个 token Override）；`settingsPanel.ts` 新增 `applyShellTheme()`，在 `loadSettings()` 与设置保存时同步 `html[data-theme]`；`main.ts` 启动时显式 `monaco.editor.setTheme()`；终端配色随主题（`terminal.ts::xtermTheme()` + `applyTheme()`，保存设置时经 `termUi.ts::refreshTerminalThemes()` 重套）；`index.html` 首屏兜底样式补浅色分支。
2. **focus-visible（P-02）**：按钮与列表项类控件统一 `outline: 1px solid var(--focus-ring); outline-offset: 2px`；输入控件沿用既有 border-color 焦点表达。
3. **色值收敛（P-05）**：`style.css` 新增约 30 个语义 token（`--hover / --selected / --control-hover / --danger-bg / --accent-soft / --border-soft / --overlay / --shadow / --git-* / --diff-*` 等），全文件裸色值清零（仅剩 `:root` 与 light 覆盖层定义）。Git/diff 色原计划豁免，实际一并 token 化。
4. **字号归并（P-07）**：11.5px → 11px（7 处，设置提示文案升 12.5px）；12px → 12.5px（29 处）；10.5px → 11px；模态标题 14px → 15px。

**豁免清单**（验收约定外的裸值/尺寸，登记在册）：
- `index.html` 首屏 FOUC 兜底内联样式（正式 CSS 注入前的防闪烁层，深浅各一组硬编码值）；
- 图标字形字号（10/12/14/16/18px，如 `.twisty` / `.tree-item .icon` / `.menubar-icon` / `.win-btn`）属图标规格，不计入文本字号档位；
- 终端深浅配色定义于 `terminal.ts::xtermTheme()`（xterm 实例配置，非 CSS 管辖）。

**设计决策记录**：浅色主题下 `--accent`（#0e639c）/`--danger-bg` 等填充色保持深色值不变，仅覆盖表面/文字/弱色语义项，确保强调色跨主题一致。
