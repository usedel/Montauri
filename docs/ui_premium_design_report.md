# OpenCharm 视觉「高级感」诊断与改造方案

> 版本：**v1.2（二轮评审修订版）** · 日期：2026-10-02 · 状态：**方向已批准，按 §6 六批实施**
> 审阅对象：`shell/`（Tauri 2 + Monaco 外壳前端）——`index.html`、`src/style.css`（实测 **5394 行 / 214 KB**）、`src/*.ts`、`src-tauri/`
> 与既有文档的关系：本文件是**方向性设计评估**，与 `docs/ui_design_improvement_plan.md`（v2.1，30/30 已完成的**缺陷修复与一致性**计划）互补而非替代。那份计划解决"对不对"，本文档解决"贵不贵"。
> **本文档推翻 D4「青绿 = 品牌识别 / 蓝 `--accent` = 功能交互」既有裁决**，配套 ADR：[`docs/adr/0005-brand-accent-unification.md`](adr/0005-brand-accent-unification.md)。
> ⚠ **v1.2 修订**：该 ADR 截至本次修订**尚未创建**（`docs/adr/` 现有 0003 / 0004 / README），而 `docs/ui_design_improvement_plan.md:6` 与 `:149` 已先行以既成语气引用它 —— 形成"裁决已被推翻、依据文件还没写"的倒置。**批 1 第一步必须先补 ADR，再改色。**
> 冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文档。

---

## 0. 评审修订记录

### 0.1 v1.0 → v1.1（首轮评审）

v1.0 提交评审后，对全部数值做了独立复算，并核对了既有裁决与派生依赖。**结论：方向正确，数值可信，但归因有一处硬错误、方案有 3 处会咬人的具体缺陷、验收方式与本项目既有教训冲突。** 四项拍板与据此产生的 9 处修改：

| # | 评审发现 | 处置 | 落地位置 |
|---|---|---|---|
| 1 | **归因错误**：v1.0 称"青绿承担全部功能语义"，实测真正承载功能色的是 `--accent`（**82 处**，是 `--brand` 24 处的 3.4 倍），v1.0 把它当"第三支色系"脚注 | 推翻 v1.0 的归因。杠杆 1 从"改 logo 渐变"扩为"**交互色也收进青绿体系**"，附 ADR-0005 | §0.3 · §5.1 |
| 2 | **`--bg-alt` 语义被翻转**：v1.0 把 `--bg-alt` 映射到 `S1`（比画布更暗），但它现状比画布**更亮**，19 处全是抬升面（`.modal-card`、菜单、卡片、`.db-grid` 粘性表头与行号、active 行） | 抬升面专用档位，禁止语义别名映射；单列 §5.2.2 迁移清单 | §5.2.2 · 批 2b |
| 3 | **漏了 5 个派生交互 token**：`--hover`(33) `--control-hover`(8) `--selected`(3) `--tab-inactive-bg` `--scrollbar-thumb` 不在新阶梯里，`--control-hover #4b4b4b` 比新 S4 还亮 | 全部重算并给值；`--selected` 改青绿染色 | §5.2.3 |
| 4 | **漏了 8 个预览色 token + FOUC 块**：`--theme-pv-*` 是刻意钉死的色卡、`index.html:12-30` 内联兜底块有硬性同步义务 | 列入批 2a 必做项与验收门禁 | §5.2.4 · §7 |
| 5 | **`--fg-dim` 246 处**，v1.0 当"一格改动" | 新增 `--fg-muted` + **选择器级审计**（非 token 数），列入批 2b | §5.2.5 |
| 6 | **浅色阶梯整段缺失**：v1.0 只给深色五档 | 补浅色四值 + 浮层靠投影的说明（浅色不做亮度斜坡） | §5.2.1 |
| 7 | **字体随包分发有 CSP 硬阻碍**：`tauri.conf.json` 的 `font-src 'self' data:`，而 resources 走 asset 协议（`img-src` 才显式列了 `asset: http://asset.localhost`），且 `dangerousDisableAssetCspModification: true` 关掉了自动放宽 | CSP 修改列为**前置条件**；且按"单人自用"定位**只随包等宽字体**，Inter 走系统栈 | §5.3 |
| 8 | **优先级错配**：Monaco 主题风险最高（5 个接线点 + 2 个既有测试会红 + 持久化迁移），却排 P0 | 降为 **P1 独立批**；批 2 拆 2a/2b 两个短 PR（对齐"短分支 PR"铁律） | §6 |
| 9 | **验收"人工抽查"与本项目教训冲突**（曾两次"e2e 全绿但视觉崩"，结论是树类布局必须有 boundingBox 断言） | 改为基线截图 + e2e computed-style 断言 + token 一致性单测 | §7 |

**已复算无误的部分（保留）**：12 个现状对比度数值中有 **10 个**逐条零误差复现（另 2 处偏差见 §0.2 的订正表）；新阶梯端到端 1.56 复现；§8「明确不要做的事」全文保留并继续增补；§4 判断框架与权重表保留。

**已修正的数据口径**：v1.0 的部分数字继承自 `ui_design_improvement_plan.md` §7 的历史记录（"158 处 font-size"）或为估算，实际重跑结果见 §2.2——**"font-size 全部走变量"现在不成立**（10 处裸值），"工程底座 A 级"这句应下调为"token 化彻底但有 10 处历史裸值"。

### 0.2 v1.1 → v1.2（第二轮评审）

第二轮做了三件事：① 对附录 A 与正文的**全部数值**独立复算（共 70 项，含 3 个 RGB 欧氏距离）；② 对 9 个 token 计数、裸值纪律、全部精确行引用逐条回读源码；③ 反向扫描"文档没写、但实施时必须改"的执行面。

**先看复核通过的部分**——这些是本方案的地基，v1.1 完全可信：

| 复核项 | 结果 |
|---|---|
| token 计数 | `--accent` 82 · `--on-accent` 13 · `--accent-soft` 15 · `--accent-faint` 4 · `--accent-hover` 4 · `--brand` 24 · `--fg-dim` 246 · `--border` 151 · `--hover` 33 · `--bg-alt` 19 · `--radius-sm` 91 · `--control-hover` 8 · `--selected` 3 · `--focus-ring` 8 · `--link` 6 · `--tab-inactive-bg` 1 · `--scrollbar-thumb` **1**（v1.1 记 2）—— **逐条精确命中** |
| 裸值纪律 | `font-size` 347 / 337 / 10、`box-shadow` 18 条 / 7 条 inset / 2 条裸 —— **与 §2.2 完全一致** |
| 精确行引用 | `state.ts:133`、`themePicker.ts:32`、`settingsPanel.ts:869`、`main.ts:2083`、`state.test.ts:22`、`themePicker.test.ts:14`、`style.css:93-100` —— **全部命中** |
| CSP 论断 | `font-src 'self' data:` 精确成立、`dangerousDisableAssetCspModification: true` 存在、`img-src` 确实显式列了 `asset:` —— 完全属实 |
| 对比度 / 距离 | 70 项实算，**67 项落在 ±0.03 容差内** |

**数值订正 2 处**（其余全部对齐）：

| 位置 | v1.1 值 | 二轮实算 | 处置 |
|---|---|---|---|
| 附录 A · `边框 #3c3c3c / 面板底 #1b1b1b` | 1.49 | **1.561** | 已订正，结论方向不变 |
| §5.1「单值不可兼得」证明表 · 白字 on `#4ec9b0` | 1.7 ✗ | **2.038** ✗ | 已订正；仍远低于 4.5，拆 `--accent` / `--accent-fill` 的结论不受影响 |

**据此产生的新增修订 13 处**（P0 三项 · P1 六项 · P2 四项）：

| # | 评审发现 | 处置 | 落地位置 |
|---|---|---|---|
| 10 | **P0 · 杠杆 3「改一行 CSS」不成立**：Monaco 编辑器字体由 `state.ts:136 font_family` 经 `buildEditorOptions`（`settingsPanel.ts:394-431`）注入，有 **4 个注入点**（`main.ts:2093 / 2104 / 2521`、`settingsPanel.ts:880`）；CSS `--mono` 到不了编辑器，另 `style.css:1209` 有一处裸栈。且**存量 `settings.json` 的 `font_family` 已固化旧栈**——这与批 4 的 `vs-dark → opencharm-dark` 迁移完全同构，批 3 却完全漏了 | 3a 从"1 行"扩为**五处改动 + 默认值迁移**；`font_ligatures` 默认 `false`（`state.ts:137`）导致连字不生效，一并处理 | §5.3 · §7-13 |
| 11 | **P0 · `--bg-panel` 21 处从未审计**：其中 `#menubar`(490) `#sidebar`(623) `#tabbar`(769) `#split-editor-header`(1160) 若随 `--bg-panel → S0`，会让 menubar 与 sidebar **同色（对比 1.00）**，比现状 1.033 **更糟**，反向违反本批"拉开差距"的目标；且 §5.2.1 自注 S1 = 侧栏 | 新增选择器级归属表，拆出 `--bg-chrome`（→ S1）；成本从"≈20 行"上修为"21 处审计 + 1 个新别名" | §5.2.1 · §5.2.2 |
| 12 | **P0 · `--accent` / `--link` 作为文字色有 4 个面跌破 4.5**：`S4 4.11` · `--hover 4.42` · `--control-hover 3.81` · `--selected 3.63`。§5.1 只核了 S2 / S3 就宣布"11 个 token 全部达标"，而 S4 的定义恰是 hover / 浮层强调面 | 新增**九面门禁**与 `--accent-emphasis` | §5.1 · §7-2 |
| 13 | **P1 · 浅色覆盖层 53 个 token 的同步清单缺位**：`[data-theme="light"]`（`style.css:218-290`）实定义 53 个，含 `--bg-alt / --hover / --selected / --control-hover / --tab-inactive-bg / --tab-active-bg / --scrollbar-thumb / --overlay / --indent-guide`，而 §5.2.3 派生表**只给深色值**；且浅色侧仍有 3 个蓝色 token（`--selected #d6ebff`、`--link #0f6cbd`、`--diff-hunk #3070c0`）从未列入 | §5.2.3 补浅色列；蓝色系 token 从 11 个扩为 **14 个**；§5.2.4 扩为三层同步义务 | §5.1 · §5.2.3 · §5.2.4 |
| 14 | **P1 · ADR 要修订的裁决漏了第三条**：`style.css:216` 注释写明"accent/danger 等语义色保持深色值，确保强调色跨主题一致"，§5.1 新增 light `--accent: #0e7261` 正在推翻它 | ADR-0005 修订范围补为 D4 + UI-06 + 本条 | §5.1 · 附录 C |
| 15 | **P1 · FOUC 块漏了第 6 个同步项**：`index.html:19` 写死 `font-family`，而 §5.3-3c 正要改 body 字体 → 首帧与稳定帧不一致会产生可见抖动 | 同步项从 5 个改为 6 个 | §5.2.4 · §7-8 |
| 16 | **P1 · §5.6 落点错 + §3.6 的"全部"不成立**：`@keyframes oc-modal-in/out`（192-199）内部**没有任何缓动关键字**，缓动写在 9 处 `animation` 简写里；`transition` 实测 23/27 走 token（`none` ×2、`transform 0.12s`、`width 0.2s`） | 提示改指 `animation` 简写；"全部收口"下修为 23/27；验收 11 改写为可执行判定式 | §3.6 · §5.6 · §7-11 |
| 17 | **P1 · `markdownPreview.ts:315` 归因偏差**：它在 `buildExportHtml()` 内、靠 `finally` 恢复 `origTheme`，并非"预览着色永远用 stock 主题" | 结论仍需改（批 4 后应切 `opencharm-light`），但理由改写，并注明必须保住 `finally` 恢复路径 | §5.4 |
| 18 | **P1 · 批 2a 的"四方一致"门禁时序上不可执行**：`theme/tokens.ts` 要到批 4 才建（`shell/src/theme/` 当前不存在），§7-5 却从批 2a 起要求四方对齐 | 明确"批 2a 三方一致，批 4 补第四方" | §7-5 |
| 19 | **P2 · 新发现 3 处浅色 AA 缺陷**（§3.8 只找到 `--fg-dim` / 面板底 4.44 一处）：旧 `--fg-dim #6c6c6c` 在 `--control-hover #c8c8c8` 上仅 **3.14**、在 `--selected #d6ebff` 上 **4.30**、在 `--tab-inactive-bg #ececec` 上 **4.44** | 并入 §5.9 与浅色派生表一并治理 | §3.8 · §5.2.3 · §5.9 |
| 20 | **P2 · `--fg` 的取值从未定义**：附录 A 用 `#e4e4e8` 算正文对比，但 §5 全文没有任何一处说要把 `--fg` 从 `#d4d4d4` 改掉（若保持原值，新画布下为 **11.07**，附录那三行不成立） | 显式定义 `--fg`，二选一后回填 | §5.1 · 附录 A |
| 21 | **P2 · CSS 注释里的"论证性数据"会在改值后变成错误信息**：`style.css` L243 / L936 / L1042 / L2436 内嵌旧色值与旧对比度，L90-91 概览行、L269 口径说明同理；项目既有文化（UI-17）要求注释登记取值理由 | §6 约束增加"注释考古"一条 | §6 约束 |
| 22 | **P2 · §5.2.1 别名自述有误**：注释写"只映射这三个"却只列两个 | 一并订正 | §5.2.1 |

### 0.3 决策摘要（2026-10-02 拍板）

| 决策点 | 结论 |
|---|---|
| **执行前置（v1.2 新增）** | 批 1 第一步先创建 ADR-0005 并登记到 `docs/adr/README.md`，再动 `.css`；当前它是悬空链接，已有 3 篇文档在引用 |
| 品牌色归属 | **推翻 D4**：`--accent` 蓝一并收进青绿体系，交互色与品牌色同源；写 ADR-0005 修订既有裁决（**修订范围追加第三条：浅色层"accent 跨主题一致"**） |
| 字体方案 | **只随包等宽字体**（JetBrains Mono，约 +1 MB）；Inter 走系统栈；须先修 CSP `font-src`。**v1.2 修正：改动点是 `state.ts` 默认值 + `--mono` + `style.css:1209` + `loadSettings` 迁移 + 面板 preset 五处，不是一行 CSS** |
| 表面阶梯 | **v1.2 修正**：先按 §5.2.2 把 `--bg-panel` 拆成 chrome / panel 两个语义别名，再套新阶梯 |
| 落地拆分 | 批 1 → 批 2a → 批 2b → 批 3 → 批 4（Monaco，P1）→ 批 5 |
| 验收方式 | 基线截图 + e2e computed-style 断言 + token 一致性单测，**不接受纯人工抽查** |

---

## 1. 一句话结论

**OpenCharm 现在看起来"称职但衍生"——像一个没有贴牌的 VS Code。**

这不是能力问题，是**身份问题**。代码质量很高：token 化彻底（347 处 `font-size` 中 337 处走变量）、双主题对比度逐条按 WCAG 公式核算过、ARIA 语义四类模式齐全。工程底座是 A 级的。

但"高级感"不来自工程正确，来自**克制的差异化**。当前三个致命点：

| # | 症状 | 数据（实测） |
|---|---|---|
| 1 | **交互色仍是 VS Code 原厂蓝** | `var(--accent)` **82 处**（+ `--on-accent` 13 / `--accent-soft` 15 / `--accent-faint` 4 / `--accent-hover` 4 = 交互色家族共 118 处），承担选中态、焦点环、主按钮、链接、diff 标题、调试帧激活的全部功能语义；品牌青绿只有 24 处 |
| 2 | 品牌色精神分裂 | logo 渐变蓝紫 `#4da3ff→#9a6bff` 与功能态青绿 `#4ec9b0` RGB 距离 **87.7**；欢迎页光晕又是第三支蓝 |
| 3 | 表面层级形同不存在 | 编辑区/侧栏/面板三档表面端到端对比 **1.12:1**（人眼阈值约 1.15），层级全靠 1px 实线边框硬撑 |
| 4 | 编辑器跑出厂主题 | `state.ts:133` 直接用 stock `vs-dark` / `vs-light`，**全仓 0 处 `defineTheme`**；占屏 60–70% 的区域与外壳 token 系统不同源 |

> ⚠️ v1.0 把第 1 条写成"logo 是紫蓝所以品牌分裂"，方向反了：**logo 只占 2 处**，真正的紫蓝遗留是 `index.html:38` 之外的一切交互色。这四条修好，观感提升约等于其余所有改动之和。

---

## 2. 诊断方法与数据口径

### 2.1 复算方式

对 `shell/src/style.css` 全量 token 审计（正则扫描 + `style.css:3-176` 顶部 token 块逐项对照）+ WCAG 相对亮度公式实算（非目测），并对 `index.html` 骨架、`main.ts` / `monaco.ts` / `state.ts` / `themePicker.ts` / `settingsPanel.ts` / `markdownPreview.ts` 的主题接线点交叉核对。

**本报告所有对比度数值均为实算结果，可复现。**

### 2.2 审计口径（v1.1 修正）

| 指标 | v1.0 写的 | **实测** | 差异说明 |
|---|---|---|---|
| `style.css` 规模 | 202 KB / 约 5100 行 | **214 KB / 5394 行** | v1.0 陈旧 |
| `font-size` | 158 处，全部走变量 | **347 处声明，337 处走 token（97.1%），10 处裸值** | v1.0 的"158"抄自 `ui_design_improvement_plan.md` §7 UI-17 验收记录；10 处裸值 = 5 px（14/12/12/11/13）+ 5 em（1.6/1.4/1.2/0.92/0.9，em 相对值属合理例外） |
| `var(--brand)` | 19 处 | **24 处** | 结论方向不变 |
| `var(--brand-gradient)` | 2 处 | 2 处使用 + 1 处定义 | ✅ |
| `var(--radius-sm)` | 51 处主档 | **91 处** | 3→6px 是 91 处主档翻倍，密度风险高于 v1.0 预估 |
| `box-shadow` | 19 处 / 6 处 inset | **18 条声明 / 7 条 inset**，另有 **2 条裸阴影** | 说明"禁止裸色值"纪律在阴影上从未真正落地，批 2a 顺手收敛 |
| `var(--border)` | 未统计 | **151 处** | 边框纪律的影响面 |
| `var(--fg-dim)` | 未统计 | **246 处** | `--fg-muted` 审计的工作量基数 |
| `var(--hover)` | 未统计 | **33 处** | 派生 token 重算基数 |

> **流程改进**：本报告的统计应固化为 `tools/ui/audit_tokens.py`（扫描 + WCAG 复算 + 输出 JSON），在 §7 验收里作为门禁调用。v1.0 声称"全量审计"却混入历史记录，本节列出的每一项都应可一键重跑。
>
> **v1.2 复核结论**：本表每一行都已由第二轮独立复算/回读源码验证 —— token 计数与裸值纪律**逐条精确命中**，仅对比度有 2 处偏差（见 §0.2）。这张表的可信度不再是"作者自述"，可作为批 1 的基线使用。

---

## 3. 现状体检

### 3.1 交互色：VS Code 蓝才是真正的主交互色（严重）

```css
:root {
  --accent: #0e639c;                 /* VS Code 蓝 · 82 处 */
  --accent-hover: #1177bb;           /* 4 处 */
  --accent-soft: rgba(14, 99, 156, 0.35);   /* 15 处 */
  --accent-faint: rgba(14, 99, 156, 0.18);  /* 4 处 */
  --on-accent: #ffffff;              /* 13 处 */
  --focus-ring: var(--accent);       /* 8 处 */
  --link: #4daafc;                   /* 6 处 */
  --diff-hunk: #569cd6;
  --brand: #4ec9b0;                  /* 青绿 · 24 处 */
  --brand-gradient: linear-gradient(135deg, #4da3ff, #9a6bff);
  --welcome-glow: rgba(88, 166, 255, 0.07);
}
```

**诊断**：这不是"logo 和产品不通气"，是**整个交互层是 VS Code 原厂蓝**。用户看到的是：蓝的选中/焦点/链接 + 蓝紫的欢迎页 logo + 青绿的活动标签/运行按钮/Git 分支。三个色系、两种语言。

顺带澄清两处常被误读的事实：
- **menubar 常驻 logo 已经是单色青绿**（`index.html:38`，`stroke="currentColor"` 随 `--brand`），"logo 是紫蓝"只对欢迎页 `.ew-logo` 的 2 处渐变成立；
- 旧计划 UI-06 曾把 `.devtools-tab.active` 从 `--accent` 改成 `--brand`，理由是"同为标签激活态应统一"——**这条裁决方向恰好与本方案相反**（它把功能色拉向品牌色，但只改了 1 处，没改 82 处），故 ADR-0005 需同时修订 UI-06 的语义。

### 3.2 表面分层：三档表面端到端仅 1.12:1（严重）

| Token | 值 | 亮度序 |
|---|---|---|
| `--bg-panel` | `#1b1b1b` | 27 |
| `--bg` | `#1e1e1e` | 30 |
| `--bg-alt` | `#252526` | 37 |

实算相邻对比：

```
bg #1e1e1e  vs bg-alt #252526  : 1.09
bg #1e1e1e  vs bg-panel #1b1b1b : 1.03   ← 几乎不可辨
panel #1b1b1b vs bg-alt #252526 : 1.12   ← 端到端
```

人眼在深色下分辨相邻面块的阈值约 **1.15:1**（经验值，无出处，见 §7 说明）。也就是说：**当前三档表面，用户基本看不出区别。**

两个次生问题：

1. **层级方向反直觉**：`--bg-panel`（面板）比 `--bg`（编辑区）**更暗**。常规做法是"越靠内容核心越亮，越靠外框越暗"（Linear、Zed、Notion 均如此）。现在是框架比画布亮，内容反而浮不出来。
2. **边框被迫承担全部层级职责**：`--border: #3c3c3c` 在 `--bg` 上对比 **1.51:1**，且 **151 处**几乎每个区块都用实心 1px 描边。这是 2015 年 flat design 的做法——**用线框替代材质**。

### 3.3 字体：操作系统默认值（中等偏重）

```css
html, body {
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
}
--mono: Consolas, "Cascadia Code", "JetBrains Mono", monospace;
```

- **UI 字体**：Segoe UI + 微软雅黑 = Windows 系统默认组合，零品牌识别、零差异化。
- **等宽字体**：**Consolas 打头**。Consolas 是 2007 年随 Vista 发布的字体，字面窄、x-height 小、无编程连字。后面挂的 Cascadia Code / JetBrains Mono 只在用户本机装了才生效——绝大多数机器只会命中 Consolas。

对 IDE 而言，**等宽字体是 ROI 最高的一项**：用户 80% 的注视时间落在等宽文本上。当前栈里排第一的恰恰是最老的那个。

### 3.4 编辑器主题未同步（严重）

```ts
// src/state.ts:133
theme: "vs-dark",
```

`themePicker.ts:24/32` 的主题列表也是 `vs-dark` / `vs-light` 原值。**全仓 0 处 `defineTheme`。**

后果：外壳辛苦建立的一整套 token（表面阶梯、品牌色、语法色）在占屏面积最大的编辑器里**完全失效**。这是"拼装感"的最大来源。

**连带依赖（v1.0 未列）**：`--syntax-*` 7 个 token 的注释明确"与 Monaco 内的 Python 高亮同源"，`markdownPreview.ts:315` 还硬编码 `setTheme("vs")` 做着色。改主题时必须同批处理这 3 处 + 2 个断言 `"vs-dark"` 字面量的既有测试（见 §5.4）。

### 3.5 阴影：只有一档（中等）

```css
--shadow: 0 4px 16px rgba(0, 0, 0, 0.5);   /* 深色 */
--shadow: 0 4px 16px rgba(0, 0, 0, 0.18);  /* 浅色 */
```

18 条 `box-shadow` 声明中 7 条是 `inset` 色条（日志级别、Git 分支指示），**真正的投影只有一档、没有层级**，另有 2 条裸阴影值从未纳管。

而深色 UI 的核心难题恰恰是：**纯黑投影在深色底上几乎不可见**——`rgba(0,0,0,.5)` 落在 `#1e1e1e` 上，视觉增量极小。

业界通行解法是**双轨**：投影 + 顶边高光 `inset 0 1px 0 rgba(255,255,255,.06)`。高光才是深色下"这块浮起来了"的真正信号源。当前完全没有这一层。

### 3.6 动效：有开关，无曲线（轻）

```css
--transition-fast: calc(0.12s * var(--motion)) ease;
--transition-base: calc(0.15s * var(--motion)) ease;
```

`--motion` 倍率 + `prefers-reduced-motion` 接入是好的（无障碍 A 级），27 处 `transition` 中 **23 处**已收口到这两个 token（UI-11 成果；**v1.2 订正**：并非"全部"，余 4 处为 `transition: none`（`214` / `1192`）、`transform 0.12s`（`2493`）、`width 0.2s`（`3634`），均属可接受例外但需登记）。但这 23 处**全部用 `ease`**——没有缓动曲线分级。

`ease`（`cubic-bezier(0.25,0.1,0.25,1)`）是"对称减速再加速"，观感偏机械。高级动效的关键是**非对称曲线**：入场用 decelerate，出场用 accelerate。

对 IDE 而言时长 ≤150ms 的判断是对的（不能拖慢操作节奏），**该改的是曲线，不是时长**。

### 3.7 圆角：3px 主档（轻）

```css
--radius-sm: 3px;   /* 91 处，绝对主档（v1.0 误记 51） */
--radius-md: 4px;   /* 30 处 */
--radius-lg: 6px;   /* 10 处 */
```

3px 偏"工具感/紧凑"，偏 VS Code 和老派桌面软件。当代高端软件（Linear、Raycast、Arc）的控件主档普遍在 **6–8px**。

但**91 处主档 ×2 是全文件最大面积的单点改动**，密度风险必须靠基线截图验证，不能靠推理（§7）。

### 3.8 浅色主题：站在 AA 悬崖边（轻，但是真实缺陷）

```
--fg-dim #6c6c6c  /  --bg-panel #ececec  : 4.44:1
```

AA 要求是 **4.5:1**。**差 0.06。** 状态栏、次要说明、时间戳等大量使用 `--fg-dim` 的内容在浅色主题下**技术上不合规**。

历史遗留：深色侧 `--fg-dim #9d9d9d` / `#1b1b1b` = 6.35:1 很宽裕，浅色侧覆盖时取值偏浅了。

**v1.2 补充：这面悬崖不止一格，是四处。** 二轮复算把 `--fg-dim` 在浅色每个交互面上的取值都跑了一遍：

| 浅色交互面 | 现值 | `--fg-dim #6c6c6c` 实算 | 判定 |
|---|---|---|---|
| `--bg-panel` / `--tab-inactive-bg` | `#ececec` | 4.44 | ✗ 差 0.06 |
| `--selected` | `#d6ebff`（**蓝**） | 4.30 | ✗ |
| `--control-hover` | `#c8c8c8` | **3.14** | ✗✗ 最严重，远不止"擦边" |
| `--bg-alt` | `#f3f3f3` | 4.73 | ✓ |

即 §5.9 那"一格改动"（`--fg-dim → #5f5f68`）**单独做并不能让浅色合规**——新 `#5f5f68` 打在现状 `--control-hover #c8c8c8` 上仍只有 3.78。必须**同时**重算派生交互面（§5.2.3 浅色列给出的 `--control-hover: #e4e4e6`，在新 `--fg-dim` 下为 4.98 ✓）。这也再次说明浅色侧不能只改 `:root`。

---

## 4. 判断框架：高级感到底来自哪

在给方案之前先统一标尺。"高级感"不是玄学，它由六个可验证的来源构成，按对观感的**贡献权重**排序：

| 权重 | 来源 | 通俗解释 | OpenCharm 现状 |
|---|---|---|---|
| **35%** | **材质（Material）** | 表面分层、投影、边框质感。界面看起来是"一层层叠起来的实物"还是"用线框画的表格" | ★☆☆☆☆ 分层失效 |
| **25%** | **身份（Identity）** | 品牌色是否单一且贯穿、字体是否有辨识度、图标是否自成体系 | ★★☆☆☆ 交互色仍是原厂蓝 |
| **20%** | **排版（Typography）** | 字体选择、字号节奏、字重层次、对齐 | ★★☆☆☆ 系统默认字体 |
| **10%** | **动效（Motion）** | 缓动曲线、时长分级、状态转换的连贯性 | ★★★☆☆ 有开关无曲线 |
| **6%** | **几何（Geometry）** | 圆角档位、间距节奏、对齐网格 | ★★★☆☆ 档位过密 |
| **4%** | **装饰（Ornament）** | 渐变、光晕、纹理、插画 | ★★☆☆☆ 只有欢迎页 |

**关键洞察：装饰只占 4%。** 绝大多数"让它看起来高级"的第一直觉——加渐变、加毛玻璃、加发光——恰好是最无效的那一档，而且在 IDE 里**有害**（干扰代码阅读）。

高级感 = **材质 + 身份 + 排版**，且三者都靠**减法**实现：更少的色系、更少的边框、更少的字号档、更少的动效时长档。

---

## 5. 改造方案

### 5.1 P0 · 杠杆 1：统一品牌色与交互色（推翻 D4，最高性价比）

**动作**：青绿作为**唯一色相轴**，同时承载品牌与交互；把 `--brand-gradient` 与 **11 个蓝色取值点**（深色 8 + 浅色 3）全部拉回同色系。

理由与 v1.0 相反：真正的主交互色是 `--accent`（82 处），"改 2 处比改 19 处便宜"这个论证方向不成立——**但"收敛到单色系"这个结论更成立**，且改的是 token 定义而非 82 处调用点，成本仍是常数级。

> ⚠ v1.2 修正口径：原写"11 个蓝色系 token"但表内只列了 8 项。实为**深色 8 个 token + 浅色 3 个取值点**（浅色层的 `--selected` / `--link` / `--diff-hunk` 也是蓝的，且原方案完全没把它们算进去，见下方表格后三行）。

```css
:root {
  /* 品牌阶梯：单一色相（青绿 ~165°），明度分级。括号内为「自身色 / S2 画布」的对比度 */
  --brand-1: #7ce3cd;   /* 高亮/悬停      10.73 */
  --brand-2: #4ec9b0;   /* 主色           8.05 */
  --brand-3: #2aa88f;   /* 交互色         5.55 */
  --brand-4: #1f8070;   /* 实心填充底     3.42 */
  --brand-5: #175a50;   /* 极深底色       2.04 */

  --brand: var(--brand-2);              /* 兼容存量 24 处 */

  /* ⚠ 双角色约束（v1.0 遗漏，详见下方「单值不可兼得」的证明）：
     accent 既是「描边/图标/文字/焦点环」（需 ≥4.5:1 on 画布），
     又是「实心按钮/选中点的底」（其上放 13 处 --on-accent 白字，需白字 ≥4.5:1）。
     单值不可兼得，故拆两个角色。 */
  --accent:       var(--brand-3);       /* 5.55 on S2 · 4.82 on S3 —— 只允许用于 ≤S3 面 */
  --accent-emphasis: var(--brand-2);    /* v1.2 新增：九面全部 ≥4.5，用于 ≥S4 面（见下方门禁） */
  --accent-fill:  var(--brand-4);       /* 白字 4.79 ✅ */
  --accent-hover: #38b8a0;              /* 6.67 on S2 */
  --accent-soft:  rgba(42, 168, 143, 0.28);
  --accent-faint: rgba(42, 168, 143, 0.14);
  --on-accent:    #ffffff;
  --focus-ring:   var(--accent);

  --link:        #2aa88f;               /* 5.55 ✅ */
  --link-hover:  #38b8a0;
  --diff-hunk:   #2aa88f;

  --brand-gradient: linear-gradient(135deg, var(--brand-1), var(--brand-2) 55%, var(--brand-3));
  --welcome-glow:   rgba(78, 201, 176, 0.07);   /* 蓝 (88,166,255) → 青绿 */
}
```

**「单值不可兼得」的实测证明**（这是 v1.0 完全没考虑的一处硬约束）：

| 候选 | 白字 on 它 | 它 on S2 画布 | 结论 |
|---|---|---|---|
| `#2aa88f` | **2.96 ✗** | 5.55 ✅ | 只能当交互色，不能当填充底 |
| `#1f8070` | 4.79 ✅ | **3.42 ✗** | 只能当填充底，不能当画布文字色 |
| `#4ec9b0`（现 brand） | **2.04 ✗**（v1.2 订正，v1.1 记 1.7） | 8.05 ✅ | 同上，且更极端 |

**所以必须拆 `--accent` / `--accent-fill` 两个角色**，13 处 `--on-accent` 白字才合规。（订正后的 2.04 仍远低于 4.5，结论方向不变。）

#### ⚠ 另一半：`--accent` 的文字角色必须过「九面门禁」（v1.2 新增，P0）

上一张表只解决了**填充底**。另一半更容易漏：`--accent` / `--link` 还大量用作**文字与图标色**（链接、diff 标题、强调文本、聚焦图标）。原方案只核了 `on S2` / `on S3` 就宣布"11 个 token 全部实算达标"，但把新阶梯的**全部表面 + 5 个派生交互面**一起枚举是这个结果：

| 落点面 | 值 | `--accent #2aa88f` 作为文字 | 判定 |
|---|---|---|---|
| S0 | `#101013` | 6.42 | ✓ |
| S1 | `#17171b` | 6.04 | ✓ |
| S2 画布 | `#1f1f24` | 5.55 | ✓ |
| S3 | `#2a2a30` | 4.82 | ✓ |
| **S4（hover / 浮层强调）** | `#35353d` | **4.11** | **✗** |
| **`--hover`** | `#303038` | **4.42** | **✗** |
| **`--control-hover`** | `#3a3a42` | **3.81** | **✗** |
| **`--selected`** | `#26433f` | **3.63** | **✗** |
| `--tab-inactive-bg` | `#232329` | 5.28 | ✓ |

这不是理论风险：S4 的定义就是 hover 面，`accent` 与 hover 态天然同框（菜单项 hover 的强调文字、hover 行里的链接、选中行内的链接）。82 处引用里必然命中。

**处置（二选一，推荐 A）**：

- **A（推荐，不新增档位）**：新增 `--accent-emphasis: var(--brand-2)`（`#4ec9b0`）。九面实测 `9.32 / 8.77 / 8.05 / 7.00 / 5.96 / 6.42 / 5.53 / 5.27 / 7.67` —— **全部 ≥ 4.5**。规则：**凡落在 S4 / `--hover` / `--control-hover` / `--selected` 四个面上的 accent 类文字与图标，一律用 `--accent-emphasis`。**
- **B（更内敛）**：`#45c2ab` —— 最暗的达标值（四个问题面的最低分 4.88），观感比 brand-2 收敛，代价是引入第 6 个品牌档位。

三角色分工最终形态：`--accent` 管 **≤ S3** 面 · `--accent-emphasis` 管 **≥ S4** 面 · `--accent-fill` 管**实心按钮底**（其上放 `--on-accent` 白字）。

#### `--fg` 取值决策（v1.2 显式定义，P2）

附录 A 原本用 `#e4e4e8` 算正文对比，但正文全文没有一处说要改 `--fg`。二轮把它当成一个待拍板项算清楚了：

| 方案 | S0 | S1 | S2 | S3 | S4 | 牵动面 |
|---|---|---|---|---|---|---|
| **保留 `#d4d4d4`（采纳）** | 12.81 | 12.06 | **11.07** | 9.62 | 8.20 | 无（现状即合格） |
| 改 `#e4e4e8` | 14.98 | 14.10 | 12.94 | 11.25 | 9.58 | FOUC 块、`--theme-pv-dark-fg`、`style.css` 6 处字面量 |

画布从 `#1e1e1e` 换到 `#1f1f24` 后正文只掉 0.18（11.25 → 11.07），**远高于 AAA**。改 `--fg` 的收益小于它引入的同步义务，按本文档的减法原则 **保留 `#d4d4d4`**，附录 A 已按此回填。

**需重新取值的蓝色取值点：深色 8 个 + 浅色 3 个 = 11**（全部实算达标）：

| token | 主题 | 现值 | 新值 | 依据 |
|---|---|---|---|---|
| `--accent` | 深 | `#0e639c` | `--brand-3` | on S2 5.55 / on S3 4.82 |
| `--accent-hover` | 深 | `#1177bb` | `#38b8a0` | on S2 6.67 |
| `--accent-soft` | 深 | `rgba(14,99,156,.35)` | `rgba(42,168,143,.28)` | 选中态底，深浅同源 |
| `--accent-faint` | 深 | `rgba(14,99,156,.18)` | `rgba(42,168,143,.14)` | 同上 |
| `--link` / `--link-hover` | 深 | `#4daafc` / `#7cc2ff` | `#2aa88f` / `#38b8a0` | 6 处链接 |
| `--diff-hunk` | 深 | `#569cd6` | `#2aa88f` | diff hunk 行号 |
| `--debug-frame-active` | 深 | `rgba(84,116,224,.2)` | `rgba(42,168,143,.22)` | 调用栈激活帧 |
| `--welcome-glow` | 深 | `rgba(88,166,255,.07)` | `rgba(78,201,176,.07)` | 欢迎页光晕 |
| **`--selected`** | **浅** | **`#d6ebff`** | `#d3efeb` | **v1.2 新增**：浅色选中态也是蓝的，且 `--fg-dim` 在其上只有 4.30 |
| **`--link` / `--link-hover`** | **浅** | **`#0f6cbd` / `#0e639c`** | `#0e7261` / `#0b6350` | **v1.2 新增**：link-hover 白底 7.20，浅色七面最低 5.67 ✓ |
| **`--diff-hunk`** | **浅** | **`#3070c0`** | `#0e7261` | **v1.2 新增** |

**浅色主题同步**（青绿在白底需更深，见实测）：

```css
[data-theme="light"] {
  /* ⚠ v1.2：以下全部是「新增覆盖」。现状 light 层（style.css:218-290）并未定义 --accent，
     :216 的注释还明写「accent/danger 等语义色保持深色值，确保强调色跨主题一致」。
     本块正在推翻那条裁决 —— 故 ADR-0005 的修订范围必须追加第三条（见附录 C）。 */
  --brand:          #0e7261;   /* 白底 5.84 · L0 4.82 · L1 5.26 · 白字 5.84 → 一值两用 */
  --accent:         #0e7261;   /* 同上 */
  --accent-fill:    var(--accent);   /* 显式声明，避免落到 :root 的 #1f8070 */
  --accent-emphasis:#0b6350;   /* 浅色七面最低 5.67（--control-hover #e4e4e6 上） */
  --link:           #0e7261;
  --link-hover:     #0b6350;   /* 白底 7.20 · L0 5.95 · ctl-hover 5.67 —— 七面全达标 */
  --selected:       #d3efeb;   /* 替掉蓝色 #d6ebff：正文 10.42 · --fg-dim 5.21 */
  --diff-hunk:      #0e7261;   /* 替掉蓝色 #3070c0 */
  --debug-frame-active: rgba(14, 114, 97, 0.16);
  --welcome-glow:      rgba(14, 114, 97, 0.08);
}
```

浅色下 `--accent` 一值即可兼两用（白底 5.84 / 白字 5.84），故 `--accent-fill` 只需在 `:root` 定义、浅色覆盖层指向 `--accent` 即可。

**⚠ 明确排除在批 1 之外**：`--syntax-var #9cdcfe` / `--syntax-boolean #569cd6`（浅色 `#001080` / `#0000ff`）虽偏蓝，但它们是**代码调色板**，必须与 Monaco 主题规则同批改（批 4）。若在批 1 先改，编辑器会与外壳**脱色三个批次**。

**收益**：整个交互层与品牌同源，"贴牌"感消失。改动量 ≈ token 定义 15 行 + 单测。

**配套 ADR**：`docs/adr/0005-brand-accent-unification.md`（修订 D4 与 UI-06 的语义裁决）。

---

### 5.2 P0 · 杠杆 2：重建表面阶梯 + 真实层级（最大视觉收益）

#### 5.2.1 深色五档 + 浅色四值

```css
:root {
  /* 深色：S0 最深（外框/状态栏/面板底）→ S4 最亮（浮层/hover） */
  --surface-0: #101013;   /* 窗口底 / 状态栏 / 底部面板底 */
  --surface-1: #17171b;   /* 侧栏 / 活动栏 */
  --surface-2: #1f1f24;   /* 编辑区 / 主内容画布  ← 内容面 */
  --surface-3: #2a2a30;   /* 抬升面：卡片 / 菜单 / 模态 / 粘性表头 / 控件 */
  --surface-4: #35353d;   /* hover / 浮层强调 */

  /* 语义别名。⚠ v1.2：--bg-panel **不得整体映射**（它承载 21 处混合语义，见 5.2.2），
     必须先拆出 chrome 部分，故此处三行是按「拆分后」的形态写的。--bg-alt 禁止映射。 */
  --bg:         var(--surface-2);   /* 编辑区 / 画布 */
  --bg-chrome:  var(--surface-1);   /* 新增：menubar / tabbar / sidebar / split-header */
  --bg-panel:   var(--surface-0);   /* 拆分后仅剩：底部面板 / 终端 */
}

[data-theme="light"] {
  /* 浅色：方向相反——越靠内容越白，越靠外框越灰；浮层不做亮度斜坡，靠投影抬升 */
  --surface-0: #e9e9ec;   /* 面板底 / 外框      L0→L1 1.09 */
  --surface-1: #f3f3f4;   /* 侧栏              L1→L2 1.11 */
  --surface-2: #ffffff;   /* 编辑区画布        L0→L2 1.21 */
  --surface-3: #f7f7f8;   /* 控件内底          vs 画布 1.07 */
  --surface-4: #ffffff;   /* 浮层 = 画布同值，靠 --elev 投影 + hairline 抬升 */

  --bg:         var(--surface-2);
  --bg-chrome:  var(--surface-1);
  --bg-panel:   var(--surface-0);
}
```

**深色实算**：

```
S0→S1 1.06 · S1→S2 1.09 · S2→S3 1.15 · S3→S4 1.17
S0→S2（外框 vs 画布，用户真正能感知的那一刀）: 1.16  ✅ ≥1.15
S0→S4 端到端: 1.56（现状 1.12）
```

**浅色实算**：

```
L0→L1 1.09 · L1→L2 1.11 · L0→L2 1.21
正文 #333333：L0 10.43 / L1 11.39 / L2 12.63
--fg-dim #5f5f68：L0 5.22 / L1 5.70 / L2 6.32 / L3 5.90   ← 四档全部 ≥4.5
```

> **浅色侧不需要 `--fg-muted`**：浮层（L4）与控件（L3）已有 5.90 / 6.32，`--fg-dim` 直接够用。省一个 token。
>
> **浅色不能照搬深色的亮度斜坡**：浮层若比画布更亮，在白底上无处可"更亮"，只能靠投影 + hairline 表达层级。这是浅色 IDE 的标准做法（VS Code / Zed 浅色皆如此），不是妥协。

#### 5.2.2 选择器级归属：`--bg-alt`（19 处）与 `--bg-panel`（21 处）

v1.0 写 `--bg-alt: var(--surface-1)`。但 `--bg-alt` 现状 `#252526` **比 `--bg` 更亮**，它的语义是**抬升面**——19 处引用全是抬升面：

| 位置 | 选择器 | 语义 | 映射到 |
|---|---|---|---|
| L2046 | `.modal-card` | 模态卡 | S3 |
| L1932 / L3709 | `z-index: 400` 菜单 | 右键菜单 / 分支菜单 | S3 |
| L2363 | `.db-grid thead th` | **粘性列表头** | S3 |
| L2364 | `.db-grid .db-rowno` | **粘性行号列** | S3 |
| L2254 | `.db-conn-node.active` | 选中行 | S3 |
| L1080 | `.debug-bp-dot-condition` | 条件断点圆点 | S3 |
| L2125/2234/2322/2504/3764/3806/3830/3884/4937/4980/5355/1978 | 输入框 / 卡片 / 内嵌面板 / 滚动容器 | 抬升面 | S3 |

**若映射到 S1（`#17171b`，比画布更暗）**：粘性表头与行号列会比画布**沉下去**、模态卡比编辑区**更暗**——与杠杆 2 的目的（抬升面浮起来）**正好相反**，且会重演本项目已踩过的"sticky 表头吸顶互覆盖"类布局事故（那次是三个组头共用一个 `position:sticky;top:0`）。

**动作**：`--bg-alt` 的 19 处**保留 token 名但改值**为 `var(--surface-3)`，并逐个 selector 确认它确实在 S3 面上（批 2b 审计）。这是"旧 token 名 → 新档位"的唯一合法映射，因为它本就代表抬升面。

---

**同级别的另一半：`--bg-panel` 21 处（v1.2 新增 · P0）**

v1.1 给 `--bg-alt` 做了逐个 selector 的清单，却对规模相当（**21 处**）、语义更杂的 `--bg-panel` 只写了"只映射 `--bg` / `--bg-panel` 两个别名，成本 ≈20 行"。把它逐个读出来是这样的（行号均为 `style.css` 实测，21 处全量无遗漏）：

| 分组 | 选择器（行号） | 数量 | 归属 |
|---|---|---|---|
| **窗口框架 chrome** | `#menubar`(490) · `#sidebar`(623) · `#tabbar`(769) · `#split-editor-header`(1160) | 4 | **S1**（§5.2.1 自注「侧栏 / 活动栏」就是 S1） |
| **外框底 / 面板容器** | `#bottom`(1588) · `#statusbar`(1855) · `#terminal-panel`(1635) · `.term-tab.active`(1660) · `#right-panel`(4434) | 5 | **S0** |
| **抬升面** | `#md-preview code`(1210) · `#md-preview pre`(1216) · `#md-preview th`(1234) · `#md-preview-hint`(1275) · `.ew-qs-step`(1453) · `.ew-qs-head kbd`(1472) · `.ew-tour-item kbd`(1528) · `.ew-shortcut kbd`(1552) · `.oc-tooltip kbd`(1945) · `#git-remote-busy`(4317) · `.picker-group-head`(4518) · `.rx-table th`(5140) | 12 | **S3** |

**若跳过拆分、直接把 `--bg-panel` 绑到 S0**：`#menubar` 与 `#sidebar` 将同色，两者对比 **1.00** ——而现状两者同为 `#1b1b1b`、对画布尚有 1.033。**这一步会让 chrome 层的可见度比今天更差，与杠杆 2 的目的正好相反。** 连带地，`#tabbar` 与 `#sidebar` 的边界只能退回靠 1px 边框硬撑，正是 §3.2 批评过的"用线框替代材质"。

**更要命的是第二组粘性表头**：`.rx-table th`(5140) 是 `position: sticky; top: 0` + `background: var(--bg-panel)` + `color: var(--fg-dim)` 的三件套——与本节上半部分点名的 `.db-grid thead th` **完全同型**。它若落到 S0，粘性表头会比画布沉下去，同时还违背 §5.2.5「抬升面上禁用 `--fg-dim`」的配套规则。等于把 §5.2.2 上半部分已经识别出来的这一类事故，换个地方再犯一次。

**动作**：批 2a 第一步按上表把 4 处 chrome 改为 `--bg-chrome`（→ S1）、12 处抬升面改为 `var(--surface-3)`；**拆分完成后** `--bg-panel` 才只剩"外框底 / 面板容器"语义，此时才能安全地映射到 S0。

> 纪律与 §8 的「不要在批 2a 之前迁移 `--bg-alt`」同源：**任何一个缝合了多种语义的旧 token，都必须走「先拆散 → 再映射」两步，不能直接改值。** 批 2a 的成本估算由此从"≈20 行"上修为"21 处审计 + 1 个新别名"。

#### 5.2.3 派生交互 token 必须重算（v1.0 遗漏；v1.2 补浅色列）

新阶梯落地后，这些旧值会脱离阶梯——`--control-hover #4b4b4b` 甚至比新 S4（`#35353d`）**还亮**，悬停态会"跳出"阶梯，材质感反而更乱。

**深色**：

| token | 引用数 | 现值 | 新值 | 实算依据 |
|---|---|---|---|---|
| `--hover` | 33 | `#2a2d2e` | `#303038` | vs 画布 1.25；`--fg-dim` 4.80 ✅（取 S3 `#2a2a30` 会与卡片同值，hover 不可见） |
| `--control-hover` | 8 | `#4b4b4b` | `#3a3a42` | vs 画布 1.46；正文 8.89 ✅ **规则：控件底上文字用 `--fg`，不用 `--fg-dim`（4.13 ✗）** |
| `--selected` | 3 | `#37373d` | `#26433f` | 青绿染色，vs 画布 1.53；正文 8.46 ✅ **`--fg-dim` 3.94 ✗ → 染色面禁用 `--fg-dim`** |
| `--tab-inactive-bg` | 1 | `#2d2d2d` | `#232329` | 1.05；`--fg-dim` 5.73 ✅（标签页底本就应与画布近，靠 `--brand` 顶部条区分激活） |
| `--scrollbar-thumb` | **1**（v1.2 订正，原记 2） | `#4a4a4a` | `rgba(255,255,255,.14)` | hover 提到 `.22` |
| `--hover-subtle` | — | `rgba(255,255,255,.04)` | 不变 | — |

**v1.2 新增：浅色侧的同一张表（P1）**

v1.1 只给了深色一列，而 `[data-theme="light"]`（`style.css:218-290`，共 53 个定义）里这些 token **几乎全部有自己的取值**。只改 `:root` 会让浅色留在"深色已换、浅色未换"的中间态——这正是 §5.2 自己警告过的过渡态，只是发生在**主题轴**而不是批次轴上。

| token | light 现值 | 浅色新值 | 实算依据（画布 `#ffffff`，`--fg-dim #5f5f68`，`--fg #333333`） |
|---|---|---|---|
| `--hover` | `#e8e8e8` | `#f0f0f2` | vs 画布 1.138；`--fg-dim` 5.55 ✅ · `--accent` 5.13 ✅ |
| `--control-hover` | `#c8c8c8` | `#e4e4e6` | vs 画布 1.270。**现值上 `--fg-dim` 只有 3.14（旧 `#6c6c6c` 更差）**，新值 4.98 ✅ · `--fg` 9.95 ✅ · `--accent` 4.60 ✅ |
| `--selected` | `#d6ebff`（**蓝**） | `#d3efeb` | vs 画布 1.213；`--fg` 10.42 ✅ · `--fg-dim` 5.21 ✅（现值上 `--fg-dim` 4.30 ✗） |
| `--tab-inactive-bg` | `#ececec` | `#e9e9ec`（= L0） | vs 画布 1.212；`--fg-dim` 5.22 ✅ |
| `--tab-active-bg` | `#ffffff` | 不变（= 画布） | 靠 `--brand` 顶部条区分激活，无需亮度差 |
| `--scrollbar-thumb` | `#c1c1c1` | `rgba(0,0,0,.18)` | hover `.32` |
| `--overlay` | `rgba(0,0,0,.25)` | `rgba(0,0,0,.18)` | **v1.2 补列**：随浮层改走 `--elev-3` + hairline，遮罩不必这么重 |
| `--bg-panel` | `#ececec` | `#e9e9ec`（= L0） | 与 §5.2.1 的 `--bg-panel → S0` 同源（浅色方向相反，靠灰不用暗） |
| `--bg-alt` | `#f3f3f3` | `#f7f7f8`（= L3） | 与深色侧「`--bg-alt → S3`」同一步，两侧必须同批 |
| `--shadow` | `0 4px 16px rgba(0,0,0,.18)` | `var(--elev-2)` | 见 §5.2.6 浅色侧 |
| `--indent-guide` | `rgba(0,0,0,.08)` | 不变 | — |

`--fg-dim` 在浅色新五面上的取值：`L0 5.22 / L1 5.70 / L2 6.32 / L3 5.90 / hover 5.55` —— 全部 ≥ 4.5，所以**浅色侧不需要 `--fg-muted`**（这是 v1.1 已经判对的，v1.2 保留）。

#### 5.2.4 三层同步义务：预览色卡 + FOUC 块 + 浅色覆盖层（v1.0 遗漏前两层，v1.2 补第三层）

改色时必须同 PR 处理，否则会**静默 diverge**（不报错、不测试红，只是慢慢地与新调色板脱节）：

**第 1 层 · `--theme-pv-*` 8 个**（`style.css:93-100`）：主题设置面板的迷你预览色卡，注释明确"取值与两套主题的实际 token 逐项对齐"，且**刻意不进浅色覆盖层**（覆盖掉就失去预览意义）。换色后必须同步为新的 S0 / S2 / `--fg` / `--border`，否则色卡会展示旧调色板。

**第 2 层 · `index.html:12-30` 的 FOUC 内联兜底块**（共 **6 项**，v1.2 由 5 项订正）：`:17 #1e1e1e = --bg` · `:18 #d4d4d4 = --fg` · `:19 font-family = --font-ui` · `:20 13px = --text-base` · `:23 #ffffff / #333333 = 浅色 --bg / --fg`。该块的注释自己就写了"改动下列任一 token 时须回来同步"。**v1.2 补的第 6 项是 `font-family`** —— §5.3-3c 正要改 body 字体，漏了它首帧与稳定帧会不一致，产生可见抖动。

**第 3 层 · `[data-theme="light"]` 覆盖层的 53 个 token（v1.2 新增 · P1）**

这是除前两层外最容易被整块忘掉的地方：`style.css:218-290` 实定义了 **53 个** token，它们全部在 `:root` 有同名定义。只要改了 `:root` 的阶梯，这里每个都面临"沿用旧值 / 重取值"的决策，不做就是**浅深不同步的中间态**（§5.2.3 已给了交互类的新值，以下是全局核查表）：

| 分组 | token | 处置 |
|---|---|---|
| 表面 / 文本 | `--bg` · `--bg-alt` · `--bg-panel` · `--border` · `--border-soft` · `--fg` · `--fg-dim` | 逐个重取（见 §5.2.1 / §5.2.3） |
| 派生交互 | `--hover` · `--hover-subtle` · `--selected` · `--control-hover` · `--shadow` · `--overlay` | 逐个重取（见 §5.2.3 / §5.2.6） |
| 标签 / 滚动 | `--tab-active-bg` · `--tab-inactive-bg` · `--scrollbar-thumb` · **`--scrollbar-thumb-hover`** | 逐个重取 |
| 品牌 / 链接 | `--brand` · `--accent-soft` · `--accent-faint` · `--link` · `--link-hover` · **`--link-border`** · `--welcome-glow` | 青绿统一（见 §5.1） |
| 语义状态 | `--ok` · `--ok-border` · `--danger` · `--danger-border` · `--danger-soft` · `--warn` · `--warn-soft` · `--warn-border` · `--meta` · **`--meta-border`** | **保持不动**（语义色不属于品牌色轴），但需在审计表里显式登记"决定不改" |
| Git / diff | `--git-modified` · `--git-added` · `--git-untracked` · `--git-branch` · `--git-deleted` · `--diff-hunk` · `--diff-add` | 仅 `--diff-hunk` 改青绿，其余保持 |
| 调试视图 | `--debug-line-bg` · `--debug-line-outline` · `--debug-line-margin` · `--debug-frame-active` | 仅 `--debug-frame-active` 改青绿 |
| 语法色 | `--syntax-var` · `--syntax-string` · `--syntax-number` · `--syntax-boolean` · `--syntax-null` · `--syntax-object` · `--syntax-array` | **留到批 4**，与 Monaco `rules` 同批（§5.1 已排除） |

> 加粗的三项（`--scrollbar-thumb-hover` / `--link-border` / `--meta-border`）此前从未出现在任何一版方案里。它们的存在说明：**"我已经想全了"这件事不能靠推理，只能靠把列表读出来**——这也正是 §2.2 要求把统计固化成 `tools/ui/audit_tokens.py` 的原因。

#### 5.2.5 `--fg-muted`：新 token + 选择器级审计

| token | 深色值 | S3 上 | S4 上 | S0 上 |
|---|---|---|---|---|
| `--fg-dim` | `#9c9ca4` | 5.23 ✅ | **4.46 ✗** | 6.97 |
| `--fg-muted`（新增） | `#adadb5` | 6.40 ✅ | 5.45 ✅ | — |

**配套规则**：**S3/S4 等抬升面上不使用 `--fg-dim`，一律用 `--fg-muted`。**

⚠️ `--fg-dim` 有 **246 处**引用。这条规则是**选择器级审计**（哪些规则的背景落在 S3/S4），不是加一个 token 就完事。批 2b 交付：`tools/ui/audit_tokens.py` 增加"抬升面 `--fg-dim` 扫描"，验收要求 **0 命中**。

#### 5.2.6 投影双轨化（深色 UI 的关键手法）

```css
:root {
  /* 深色下「投影 + 顶边高光」双轨：高光才是"浮起来"的真正信号 */
  --elev-1: 0 1px 2px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.05);
  --elev-2: 0 4px 12px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  --elev-3: 0 12px 32px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07);
  --elev-4: 0 24px 64px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.08);

  --shadow: var(--elev-2);   /* 兼容存量：原地升级 */
}
[data-theme="light"] {
  --elev-1: 0 1px 2px rgba(0,0,0,.06);
  --elev-2: 0 4px 12px rgba(0,0,0,.10);
  --elev-3: 0 12px 32px rgba(0,0,0,.14);
  --elev-4: 0 24px 64px rgba(0,0,0,.18);
}
```

浅色侧去掉 `inset` 高光（白底上无意义，反而脏），只保留投影并降低不透明度。

**浮层归属**（批 2b 交付）：菜单/模态卡/调色板/tooltip/右键菜单 = `--elev-3` + `--border-hairline`；下拉/hover 浮层 = `--elev-2`。

**收益**：这是本次改造中**唯一能让用户说不出哪里变了、但就是觉得不一样**的一项。

---

### 5.3 P0 · 杠杆 3：等宽字体（最高 ROI，但**不是 1 行**）

**3a. 改动点是五处，不是一行（v1.2 修正 · P0）**

> ⚠ v1.1 把这一项写成"最高 ROI、1 行改动、风险为零"。**方向是对的，执行模型是错的**：Monaco 编辑器的字体根本不读 CSS，而编辑器恰恰是占屏 60–70% 的区域。

字体来自 `settings.font_family`，经 `buildEditorOptions` 注入 Monaco：

```ts
// shell/src/state.ts:136 —— 出厂默认就把 Consolas 钉在第一位
font_family: 'Consolas, "Cascadia Code", "JetBrains Mono", monospace',

// shell/src/settingsPanel.ts:417-418 —— buildEditorOptions 内
const family = settings.font_family.trim();
if (family) opts.fontFamily = family;
```

`buildEditorOptions` 共 **4 个注入点**：`main.ts:2093`（主编辑器）· `main.ts:2104`（分屏编辑器）· `main.ts:2521`（db tab）· `settingsPanel.ts:880`（设置变更 `updateOptions`）。而 `--mono`（`style.css:102`）只覆盖非编辑器区域。

所以完整清单是**五处**：

| # | 位置 | 动作 |
|---|---|---|
| 1 | `state.ts:136` | 默认字体栈改为 JetBrains Mono 打头 |
| 2 | `style.css:102` | `--mono` 同步为新默认栈（保持与 1 同序） |
| 3 | `style.css:1209` | Markdown 预览的**裸字体栈**同步（此前从未纳管） |
| 4 | `loadSettings` | **存量 `settings.json` 迁移**（详见下） |
| 5 | 设置面板 `--font-ui` preset 下拉（`settings-font-family-preset`） | 首选项同步；并处理 `font_ligatures` 默认 `false` |

**第 4 项是本次评审新增的必做项**，它漏得很隐蔽：已存在用户的 `settings.json` 里 `font_family` 已固化为旧栈，**不做迁移的话随包字体对这些用户 100% 无效**（抽象层级上，这与批 4「`vs-dark` → `opencharm-dark` 主题名迁移」是**完全同构**的问题；那一处在 §5.4 被识别到了，这一处没有）。

迁移策略与批 4 对齐：**仅在 `font_family` 等于旧出厂默认串时替换为新串；用户自定义值一律保留、绝不覆盖。**

**第 5 项的连字**：`state.ts:137 font_ligatures: false`。Monaco 的编程连字由 `fontLigatures`（`settingsPanel.ts:397`）控制，不是 CSS 的 `font-feature-settings`。3c 那段 CSS 只对外壳等宽文本生效——**想让代码区有连字，必须默认打开 `font_ligatures`，或明确接受"默认值不开、改特效也在 DFT"**。

**3a-bis. 字体栈本身（这才是原来那 1 行）**

```css
--mono: "JetBrains Mono", "Cascadia Code", "SF Mono", "Consolas", monospace;
```

**3b. JetBrains Mono 随包分发（决策：只随包等宽字体）**

Inter 走系统栈（`--font-ui: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif`）——OpenCharm 是**单人自用** IDE，跨机器字体一致性的收益为零，不值得为它改 CSP + 增 300 KB。等宽字体不同：它是**代码**字体，命中 80% 注视时间，且 Consolas 兜底体验确实明显差一档，故随包。

> **v1.2 的 CSP 前置条件不变**（该判断已由二轮回读 `tauri.conf.json` 逐字核实），但本项的改动面请以 3a 的五处清单为准，不要按"改一行 CSS"排期。

**⚠ 前置条件（v1.0 判错的地方）**：`shell/src-tauri/tauri.conf.json` 当前 CSP 为

```
font-src 'self' data:
```

而 bundle resources 在 Windows 上走 asset 协议（现有 `img-src` 才显式列了 `asset: http://asset.localhost`），且 `dangerousDisableAssetCspModification: true` 关掉了 Tauri 的自动放宽。**直接把字体塞进 `bundle.resources` 并用相对路径 `@font-face` 引用，极可能被 CSP 静默拦截**（不加载、无报错、回落 Consolas）。

落地顺序必须是：
1. 先改 CSP：`font-src 'self' data: asset: http://asset.localhost;`
2. 新增 `tools/fetch-fonts.ps1`，按 `ci/versions.toml` 新增 `[fonts]` 段锁 JetBrains Mono 版本 + **sha256**，下载 zip 并抽取所需 woff2（变量字体 Regular 一份即可，**不加粗体合成**——代码字体伪粗体很难看，需要粗体时另取 Bold 文件）；
3. `tauri.conf.json` `bundle.resources` 增加 `"../../vendor/fonts/": "fonts/"`（`vendor/` 不入库，与 debugpy 同一套机制）；
4. `@font-face` 引用 `fonts/JetBrainsMono-Regular.woff2`，`font-display: swap`；
5. **实测**：安装后清 WebView2 缓存或换机器启动，确认 Network 面板字体请求 200 且 `document.fonts.check('12px "JetBrains Mono"')` 为 true。**这一步不做等于没做**——CSP 失败是静默的。

许可证：JetBrains Mono 为 SIL OFL 1.1，随包时须把 `OFL.txt` 一并放入 `vendor/fonts/`。

**3c. 排版细节（成本极低，质感提升明显）**

```css
body {
  font-family: var(--font-ui);
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
}
/* 等宽区启用编程连字 */
.mono, [class*="-mono"], pre, code {
  font-family: var(--mono);
  font-variant-ligatures: contextual;
  font-feature-settings: "liga" 1, "calt" 1;
}
/* 数字对齐场景（行号、计时、统计） */
.tabular { font-variant-numeric: tabular-nums; }
```

> v1.0 建议的 `font-feature-settings: "cv05" 1, "ss03" 1` 依赖 Inter 才有意义，**本决策下 Inter 不随包，故删掉**（Segoe UI 无这些字形，留着是无意义声明）。

`tabular-nums` 对行号、运行耗时、依赖版本号这类需要纵向对齐的数字是**立竿见影**的整洁度提升。

**v1.2 实测基线**（改前现状，便于批 3 验收前后对照）：`style.css` 中 `-webkit-font-smoothing` **0 处**、`font-optical-sizing` **0 处**、`font-variant-ligatures` **0 处**、`font-feature-settings` **0 处**、`tabular-nums` **已有 8 处**（2366 / 4744 / 4809 / 4901 / 4905 / 5017 等）；`font-family` 声明 52 处，其中 32 处走 token、**20 处裸**（绝大多数是合理的 `font-family: inherit`，另有 4 处 `"codicon"` 图标字体与 1 处 `Segoe UI Symbol`）。批 3 落完后应满足：除 `inherit` 与 `codicon` 外无裸字体栈。

---

### 5.4 P1 · 杠杆 4：Monaco 自定义主题（v1.0 排 P0，现降级独立批）

风险最高的一批：涉及 5 个接线点、2 个既有测试、用户持久化设置迁移、语法色同批改。因此从 P0 降为 **P1 独立批**（批 4），排在本批之前必须先做批 1–3 并确认无回归。

```ts
// src/theme/tokens.ts —— CSS 与 Monaco 主题的单一真源
export const editorTheme = {
  dark: {
    name: "opencharm-dark",
    surface: { s2: "#1f1f24", s3: "#2a2a30", s4: "#35353d" },
    colors: {
      "editor.background": "#1f1f24",              // = --surface-2
      "editorGutter.background": "#1f1f24",
      "sideBar.background": "#17171b",              // = --surface-1
      "editor.lineHighlightBackground": "#242429",
      "editor.lineHighlightBorder": "#00000000",    // 去掉 VS Code 那条边框线
      "editor.selectionBackground": "#26433f",      // = --selected 青绿染色
      "editorIndentGuide.background1": "#2a2a30",    // = --surface-3
      "editorWidget.background": "#2a2a30",         // 悬浮建议框
      "editorHoverWidget.background": "#2a2a30",
      "editorSuggestWidget.background": "#2a2a30",
      "scrollbarSlider.background": "#35353d80",
      "focusBorder": "#2aa88f"                      // = --accent
    },
    rules: [ /* Python token 色：与 --syntax-* 同步 */ ]
  },
  light: { /* 同结构，取浅色五档 */ }
} as const;
```

**接线点清单（5 处，缺一即主题不同步）**：

| # | 位置 | 现状 | 动作 |
|---|---|---|---|
| 1 | `src/monaco.ts` | 0 处 `defineTheme` | 遍历 `editorTheme` 调 `defineTheme`（`base: "vs-dark"` / `"vs"`，`inherit: true`） |
| 2 | `src/state.ts:133` | `theme: "vs-dark"` | 默认改 `opencharm-dark` |
| 3 | `src/themePicker.ts:24/32` | 候选项 + `FALLBACK_THEME` | 改新名；`FALLBACK_THEME` 同步 |
| 4 | `src/settingsPanel.ts:869` · `src/main.ts:2083` | 两处 `setTheme(app.settings.theme)` | 值域不变，**无需改**，但要进回归清单 |
| 5 | `src/markdownPreview.ts:315`（在 `buildExportHtml()` 内） | 导出 HTML 时硬编码 `setTheme("vs")`，并在 `finally` 里用 `setTheme(origTheme)` 恢复 | **v1.2 修正归因**：这不是"预览着色永远用 stock 主题"——它是导出自包含 HTML 时的一次临时切换，且恢复路径是健全的。**真实问题**是：批 4 引入 `opencharm-light` 后这里仍写死 `"vs"`，导出文件的语法高亮会与用户在编辑器里看到的**不是同一套配色**。改为切到当前主题的浅色变体即可。**⚠ 改动必须保住 `finally` 恢复路径**——`setTheme` 是全局副作用，一旦泄漏会静默污染用户会话着色 |

**必须同步处理的 4 项连带**：

1. **两个既有测试会直接变红**：`__tests__/state.test.ts:22`（`expect(DEFAULT_SETTINGS.theme).toBe("vs-dark")`）、`__tests__/themePicker.test.ts:14`（`const DARK = "vs-dark"`）。批 4 第一步就改它们。
2. **持久化设置迁移**：用户 `settings.json` 里存的是 `"vs-dark"`。Monaco 对未知主题名会回落默认主题（不报错），所以最坏情况是"用户升级后编辑器变回 stock 主题且无提示"。须在 `loadSettings` 加映射：`vs-dark → opencharm-dark`、`vs-light → opencharm-light`，并单测覆盖。
3. **`--syntax-*` 语法色与 Monaco `rules` 同批改**（§5.1 已明确排除在批 1 之外）。`--syntax-var #9cdcfe` / `--syntax-boolean #569cd6` 及其浅色 `#001080` / `#0000ff` 都要青绿化，与 `rules` 一一对应。
4. **视图区一致性回归**：编辑器主题一换，行高亮/当前行边框/缩进参考线/选区颜色全变，既有 e2e 中若有颜色或几何断言（如 `debugGutter` 行高亮、view zone 位置）需整批回归。

**收益**：消除"拼装感"的最大来源。编辑器与外壳终于是一套材质。

---

### 5.5 P1 · 杠杆 5：边框纪律

```css
:root {
  --border-hairline: rgba(255,255,255,0.06);  /* 极细：列表分隔、行内分隔 */
  --border-subtle:   rgba(255,255,255,0.10);  /* 常规：面板边界 */
  --border-strong:   rgba(255,255,255,0.16);  /* 强调：模态、聚焦控件 */
  --border:          var(--border-subtle);    /* 兼容存量 151 处 */
}
[data-theme="light"] {
  --border-hairline: rgba(0,0,0,0.08);
  --border-subtle:   rgba(0,0,0,0.12);
  --border-strong:   rgba(0,0,0,0.18);
}
```

alpha 叠色的好处：边框颜色自动跟随所在表面，**跨 S0–S4 五档表面都正确**，不需要为每层单独定义。实色 `#3c3c3c` 做不到这点。

实算（白底等效色 stand-in）：深色 `.06/.10/.16` 在 S2 上约 1.23 / 1.41 / 1.75，在 S0 上约 1.16 / 1.29 / 1.60；浅色 `.12/.18` 在白底约 1.32 / 1.53。

**配套**：浮层类（`.ctx-menu` / `.oc-tooltip` / `.modal-card` / `.palette`）统一改为 `--elev-3` + `--border-hairline`，去掉当前的实体描边。

---

### 5.6 P1 · 杠杆 6：动效曲线分级

```css
:root {
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* decelerate：入场/展开 */
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);    /* standard：位移/形变 */
  --ease-in:     cubic-bezier(0.4, 0, 1, 1);      /* accelerate：出场/收起 */

  --transition-fast: calc(0.12s * var(--motion)) var(--ease-out);
  --transition-base: calc(0.15s * var(--motion)) var(--ease-out);
  --transition-slow: calc(0.24s * var(--motion)) var(--ease-in-out);  /* 仅面板/模态 */
}
```

`--ease-out: cubic-bezier(0.16,1,0.3,1)` 是"快速启动、缓慢落位"——物体有惯性的感觉就来自这条曲线。

**保留现有 ≤150ms 上限**（IDE 不能为观感牺牲操作节奏），只有面板展开/模态这类结构性动画放宽到 240ms。

**v1.2 修正落点**：v1.1 写"`@keyframes oc-modal-in/out`（`style.css:192-208`）里的 `ease` 也要一并替换"——实测 `@keyframes`（**192-199**）内部**没有任何缓动关键字**，200-208 是使用它们的规则。真正的缓动写在 **9 处 `animation` 简写**里：`202 / 203 / 204 / 205 / 206 / 207 / 208 / 1942 / 5362`，值为 CSS 内置 `ease-out` / `ease-in`。**要替换的是这些，不是 keyframes。** 另有 `5156` 的 `rx-progress-slide 1.1s ease-in-out infinite` —意图性的无限进度动画，建议保留 `ease-in-out` 或改挂 `--ease-in-out`，不要换成非对称曲线。

---

### 5.7 P1 · 杠杆 7：几何档位拉开

```css
--radius-xs: 3px;    /* 徽标、行内高亮      （原 2px） */
--radius-sm: 6px;    /* 控件主档：按钮/输入  （原 3px，91 处 ×2） */
--radius-md: 8px;    /* 卡片、内嵌面板      （原 4px） */
--radius-lg: 10px;   /* 模态、卡片容器      （原 6px） */
--radius-xl: 16px;   /* 品牌装饰            （原 10px） */
```

主档 3px → 6px 是可见变化，但仍属"紧凑"范畴，不破坏 IDE 的信息密度。

**⚠ 91 处主档是全文件最大面积的单点改动**，必须配基线截图逐张比对（§7），重点看：文件树 / 大纲的密集列表、`.lt-row` 模板列表、设置项、标签页。

**取舍说明**：不要照搬消费级 App 的 12–16px 大圆角。IDE 的侧栏条目、标签页、菜单项都是高密度小尺寸元素，过大圆角会让密集列表显得松垮。6px 是"现代"与"紧凑"的平衡点。

---

### 5.8 P2 · 杠杆 8：材质细节

| 项 | 现状 | 改法 |
|---|---|---|
| **滚动条** | `#4a4a4a` 实心方块，常显 | 宽 8px、圆角 4px、`rgba(255,255,255,.10)` 半透明；**hover 容器时才显**；hover 加深到 `.22` |
| **焦点环** | `outline: 2px solid var(--accent)`（实心） | 双环带 offset：`box-shadow: 0 0 0 2px var(--surface-2), 0 0 0 4px var(--accent)`。焦点环脱离背景后不再"糊"在元素上，是高端 UI 的标志性细节 |
| **图标** | codicon（VS Code 图标字体） | 短期接受——换图标集工作量大，而且**换图标集会破坏"无贴牌"叙事的一致性评估基线**（外壳与 Monaco 都用 codicon 时观感是统一的）。中期：统一视觉权重（codicon 混有实心/描边两种风格）。长期：自绘或 Lucide / Tabler 统一 stroke 2 / 24px 网格 |
| **加载态** | codicon spin | 加 `stroke-linecap: round` 的旋转弧 + 淡入，避免文字跳动；注意 `html[data-reduce-motion]` 下已压制的 `codicon-modifier-spin` 不要复活 |
| **空状态** | 已有 `emptyState()` 统一 | 保持；可补一处极淡的品牌色径向渐变作底，与 `--welcome-glow` 同源 |

---

### 5.9 P2 · 杠杆 9：修掉浅色主题的 AA 悬崖

```css
[data-theme="light"] {
  --fg-dim: #5f5f68;   /* 原 #6c6c6c：在 #ececec 上 4.44:1 → 5.35:1 */
}
```

一格之差的改动，把浅色主题从"技术上不合规"拉回达标。**且它在新阶梯上依然达标**：L0 5.22 / L1 5.70 / L2 6.32 / L3 5.90，四档全部 ≥4.5（§5.2.1 实算）。

---

## 6. 落地路线图

按"**收益 ÷ 成本**"排序，六个批次，每批独立可验收、可回滚。**每个批次一个短分支 PR**（对齐工作区铁律"主干开发 + 短分支 PR"）。

| 批次 | 内容 | 涉及文件 | 预估 | 观感收益 | 门禁 |
|---|---|---|---|---|---|
| **批 1** | **先落地 ADR-0005**（现存悬空链接）→ 杠杆 1（交互色收进青绿，11 个取值点）+ 杠杆 9（浅色 AA） | `docs/adr/0005-*.md`、`docs/adr/README.md`、`style.css`（token 层）、`tools/ui/audit_tokens.py`（新建） | 极小（≈20 行 + ADR） | ★★★★☆ | ADR 入 `adr/README.md` 决策表 + tsc + vitest + e2e（git/statusbar/工具 radio/搜索命中）+ 截图 |
| **批 2a** | 杠杆 2 的 token 换值：深浅两套阶梯 + **先把 `--bg-panel` 21 处拆成 chrome/panel/抬升面（v1.2 新增）** + 语义别名（`--bg` / `--bg-chrome` / `--bg-panel`）+ `--accent-emphasis` + `--fg-muted` + `--elev-1..4` + 三层同步义务（8 个 `--theme-pv-*` + FOUC **6 项** + **浅色覆盖层 53 token 决策**）+ 2 条裸阴影收敛 | `style.css`、`index.html` | **中偏大**（原估"中"低估了 bg-panel 拆分与浅色清单） | ★★★★★ | 批 1 门禁 + `styleTokens.test.ts` 新建 + e2e computed-style |
| **批 2b** | 抬升面归属审计：19 处 `--bg-alt` → S3 + **21 处 `--bg-panel` 拆分落实** + 派生交互 token 重算（深色 6 项 + **浅色 11 项**）+ **`--accent-emphasis` 九面归属** + `--fg-dim` 246 处抬升面选择器审计 + 浮层 `--elev` 归属 | `style.css`、`.ts`（若涉及浮层结构） | 中-大 | ★★★☆☆（补完批 2a 的语义正确性） | 批 2a 门禁 + 抬升面 `--fg-dim` 扫描 0 命中 + **S4/selected/control-hover 面上 accent 文字扫描 0 命中** |
| **批 3** | 杠杆 3 的**五处改动**（`state.ts` 默认值 / `--mono` / `style.css:1209` / **`loadSettings` 存量迁移** / preset 下拉）+ 3b 随包（**前置：先改 CSP `font-src`**，再 `tools/fetch-fonts.ps1` + `ci/versions.toml [fonts]`） | `tauri.conf.json`、`state.ts`、`loadSettings`、`settingsPanel.ts`、`style.css`、`ci/versions.toml`、`tools/fetch-fonts.ps1`（新建） | 中 | ★★★★☆ | 批 2 门禁 + **存量 `font_family` 迁移单测（对齐批 4 的主题名迁移范式）** + 打包实测 `document.fonts.check()` 为 true |
| **批 4** | 杠杆 4：Monaco 自定义主题（**P1 独立**）——`theme/tokens.ts` 单一真源 + `defineTheme` ×2 + 5 个接线点 + 2 个既有测试 + `settings.json` 主题名迁移 + `--syntax-*` 与 `rules` 同批 | `monaco.ts`、`theme/tokens.ts`（新建）、`state.ts`、`themePicker.ts`、`markdownPreview.ts`、`style.css`、2 个测试 | 中-大 | ★★★★★ | 批 3 门禁 + **e2e 全量**（编辑器主题影响面最大）+ 四方一致单测 |
| **批 5** | 杠杆 5/6/7/8（边框 151 处、曲线 27 处、圆角 91 处、材质细节） | `style.css` + 少量 `.ts` | 中 | ★★★☆☆ | 全量 + **基线截图逐张比对**（圆角是最大面积改动） |

**批 2 拆 a/b 的原因**：2a 结束时，5 个派生交互 token 处于"旧值 + 新阶梯"的过渡态（例如 `--control-hover #4b4b4b` 比新 S4 还亮）。这个中间态**只允许存在一个 PR**，不允许跨 PR 累积——否则 2b 的审计基线不干净。

**约束**（沿用 `ui_design_improvement_plan.md` 的既有纪律）：
- 新增样式禁止裸色值 / 裸字号 / 裸圆角 / **裸阴影** / **裸缓动**，一律走 token；改 `style.css` 时同步 token 注释（该文件既有做法是每个 token 都在注释里登记语义与理由）；
- **注释考古（v1.2 新增）**：`style.css` 里有一批"论证性注释"内嵌了旧色值与旧对比度数字 —— `L90-91`（深浅概览行）、`L243`（`#8a6d00` 在 `#ececec` 上 4.16:1）、`L269`（"按最暗的浅底 `#ececec` 算"）、`L936`（`#f5c518` 白底 1.63:1）、`L1042`（`#9cdcfe` 白底 1.49:1）、`L2436`（`#4a9eff`）。它们记录了"当初为何取这个值"，**改值后必须一并改写，否则会变成看似有据的错误指引**；
- 不得向 `main.ts`（实测 **157 KB**）堆逻辑，交互改动落到对应功能域模块；
- 每批改动后跑既有全量测试，并补 token 一致性断言。

---

## 7. 验收清单（可机检，不接受纯人工抽查）

> **为什么不用"截图人工抽查"**：本项目曾两次"e2e 全绿但视觉崩"（`.db-tree-group` 三个 sticky 组头共用一个吸顶位互相覆盖；`.db-conn-node` 把整棵子树 append 进 flex 行容器导致行高被撑成整棵树、图标垂直居中到列表中部）。当时的结论是**树类布局必须有 boundingBox 断言**。一份通篇讲观感的方案，最后一道验收不能交给最不可复现的手段。
>
> **关于 1.15 阈值**：`1.15:1` 是经验值，**没有出处**。它在本方案里只作"设计目标"不作"CI 硬门禁"；门禁按**用途分两档**（见下），真实阈值待基线截图盲测校准后写回本节。

| # | 验收项 | 判定方式 | 批次 |
|---|---|---|---|
| 1 | 单色相成立：`--brand*` / `--accent*` / `--link` / `--focus-ring` / `--brand-gradient` 全部落在青绿色相轴（Hue 差 ≤ 15°） | `audit_tokens.py` 脚本 | 批 1 |
| 2 | **`--accent` 三角色 + 九面门禁（v1.2 扩展）**：① `--accent` 作为文字 / 图标色，需在 **9 个面**（S0–S4 + `--hover` / `--control-hover` / `--selected` / `--tab-inactive-bg`）上全部 ≥ 4.5 —— 实测其中 4 个面不达标；② 故 S4 / hover / control-hover / selected 四面上的 accent 文字必须走 **`--accent-emphasis`**（九面 ≥ 4.5）；③ 白字 on `--accent-fill` ≥ 4.5 | 脚本枚举 9 面 × 2 角色 × 2 主题 | 批 1 / 批 2b |
| 3 | 浅色 `--fg-dim` 四档（L0–L3）全部 ≥ 4.5 | 脚本枚举 | 批 1 |
| 4 | 阶梯对比度**按轴分档**达标：画布轴 `S0↔S2 ≥ 1.15`（实测 1.16）、组件轴 `S2↔S3 ≥ 1.12`（1.15）且 `S3↔S4 ≥ 1.12`（1.17）、`S0↔S1 ≥ 1.05` 保底（1.06，不设更高门禁——外框↔侧栏的弱差异由 menubar 分隔线与内容密度承担） | 脚本枚举深浅两套 | 批 2a |
| 5 | **一致性单测** `styleTokens.test.ts`：批 2a 起先做**三方**对齐（`style.css` ↔ `index.html` FOUC 块 ↔ **`[data-theme="light"]` 覆盖层**）；`theme/tokens.ts` 在 **批 4** 建成后扩为**四方**（加 Monaco 主题）。**v1.2 修正时序**：原要求从批 2a 起四方一致，而 `theme/tokens.ts` 要到批 4 才存在，门禁无法执行 | 新建单测（范本参照 `gutterGlyphSize.test.ts`） | 批 2a（三方）→ 批 4（四方） |
| 6 | 抬升面（S3/S4）上 `--fg-dim` 引用 **0 命中** | `audit_tokens.py` 选择器级扫描 | 批 2b |
| 7 | 派生交互 token 全部在阶梯内：`--control-hover ≤ S4` | 脚本 | 批 2b |
| 8 | **三层同步义务逐项对齐**：`--theme-pv-*` 8 值 · FOUC 块 **6 项**（含 `font-family`）· **浅色覆盖层 53 个 token 每个都有显式 keep / retarget / revalue 决策记录**（§5.2.4 第 3 层） | 脚本 + 单测 + PR 清单勾选 | 批 2a |
| 9 | e2e computed-style 断言：右键菜单 / 模态卡 / tooltip / 调色板背景落在 S3–S4；输入框底落在 S3；`.db-grid thead th` 与 **`.rx-table th`（第二组粘性表头）** 背景 ≠ 画布底色（防粘性表头"沉下去"） | e2e `getComputedStyle` | 批 2b |
| 10 | Monaco 主题名非 `vs-dark`/`vs-light`；`settings.json` 中旧主题名经 `loadSettings` 映射后生效；`markdownPreview` 预览用当前主题 | 核验 + 新增迁移单测 | 批 4 |
| 11 | 缓动全部走 `--ease-*`：所有 `transition` / **`animation`** 的时间函数必须是 `var(--ease-*)`。例外白名单：`transition: none`、`rx-progress-slide` 的无限循环装饰动画 | 脚本：**非 token** 缓动出现数为 0。**v1.2 修正判定式**：不能直接 grep `ease`（会命中 `var(--ease-out)`），需排除 `var(--ease-` 前缀后再匹配 `ease`(`-out` / `-in` / `-in-out`) 或 `linear`；且要查 `animation` 简写而非 `@keyframes`（keyframes 内实测无缓动关键字） | 批 5 |
| 12 | 全文件 `box-shadow` 走 `--elev-*` / `--shadow`，裸阴影为 0 | grep 计数为 0 | 批 2a |
| 13 | 随包字体**双验证**：① `document.fonts.check('12px "JetBrains Mono"')` 为 true 且 CSP 无字体请求被拒；② **存量 `settings.json`（旧 `font_family` 串）经 `loadSettings` 迁移后生效，且用户自定义值不被覆盖**（v1.2 新增，对齐批 4 的主题名迁移范式） | 安装包真机实测 + 迁移单测 | 批 3 |
| 14 | **基线截图**：改造前存 4 组（深/浅 × 编辑区/侧栏/终端/设置），每批改造后逐张比对 | 人工过图，但**有可比对的基线**（不再是无基线抽查） | 全程 |
| 15 | 门禁命令全绿：`npm run build`（tsc 0 错）· `node scripts/vitest-launch.mjs --watch=false --run`（全量）· `npx playwright test`（全量串行） | 逐批执行 | 全程 |
| 16 | `prefers-reduced-motion` 下全部动效仍为 0 | 沿用现有 `--motion` 机制，回归验证 | 全程 |
| **17** | **`--bg-panel` 拆分彻底（v1.2 新增 · P0）**：21 处无一仍承担混合语义；chrome 四处解析到 **S1**、`#bottom`/`#statusbar`/`#terminal-panel` 解析到 **S0**、12 处抬升面解析到 **S3**；且 **`#menubar` 与 `#sidebar` 的解析背景不得相等**（防 1.00 碰撞把 chrome 层糊成一片） | e2e `getComputedStyle` 取四元素背景色两两比对 | 批 2a / 批 2b |
| **18** | **accent 面约束扫描（v1.2 新增 · P0）**：落在 S4 / `--hover` / `--control-hover` / `--selected` 四个面上、且把 `--accent`（非 emphasis）用作**文字色或图标色**的选择器数为 **0** | `audit_tokens.py` 选择器级扫描 | 批 2b |
| **19** | **ADR 与实现一致（v1.2 新增）**：ADR-0005 已存在于 `docs/adr/` 且登记进 `README.md` 决策表，修订范围含 D4 + UI-06 + 浅色层"accent 跨主题一致"三条；`style.css:18` / `:216` 的注释已同步 | 文件存在性 + 脚本 grep 注释 | 批 1 |

---

## 8. 明确不要做的事

最后一条很重要。**在 IDE 语境下，以下"高级感套路"是有害的**：

| ✗ 不要 | 原因 |
|---|---|
| 给代码区加圆角 / 阴影 / 渐变 | 代码阅读需要零干扰背景；装饰会与语法高亮争夺注意力 |
| 毛玻璃 / backdrop-blur 滥用 | 拖拽时掉帧，且代码滚动时背景模糊会晃动，长时间使用疲劳 |
| 大面积渐变背景 | 装饰占观感权重仅 4%，却最容易显得廉价。渐变只用于 logo 与欢迎页这类**无代码**区域 |
| 图标加粗描边 / 实心色块图标 | 高密度界面里会让工具栏变成一堵色墙 |
| 动效超过 200ms（结构性动画除外） | IDE 的操作节奏优先于观感，慢动效会让人"等界面" |
| 增加字号档位 | 现有 6 档已精简过一次（UI-18 从 12 档收敛），再加是倒退 |
| 引入第三种色系（如"AI 紫"） | 品牌统一后青绿是唯一色相轴；语法色是独立的**代码调色板**，不计入品牌色系 |

**v1.1 增补 4 条（都是本轮评审踩到的坑）**：

| ✗ 不要 | 原因 |
|---|---|
| 不要把"相邻表面 ≥ 1.10"当硬门禁 | 会把"外框↔侧栏"这种**刻意**的弱差异判死。S0↔S1 实测 1.06 是设计选择（外框与侧栏靠 menubar 分隔线与内容密度区分），强行提到 1.15 会让侧栏与面板糊成一片 |
| 不要在批 2a 之前迁移 `--bg-alt` | 它是 19 处抬升面的唯一载体，阶梯换值期间必须保持原值，否则 2b 的审计基线不干净 |
| 不要让 `--accent` 一值两用 | 白字 on 填充底（需 ≥4.5）与该色作为画布文字（需 ≥4.5）**数学上不可兼得**（§5.1 表），必须拆 `--accent` / `--accent-fill` |
| 不要把语法色青绿化与交互色统一混在同一批 | `--syntax-*` 必须与 Monaco 主题 `rules` 同批改；提前改会让编辑器与外壳**脱色三个批次** |

**v1.2 增补 4 条（第二轮评审踩到的坑）**：

| ✗ 不要 | 原因 |
|---|---|
| 不要把**缝合了多种语义**的旧 token 直接改值 | `--bg-panel` 就是典型：21 处里同时含 chrome / 面板底 / 抬升面，直接映射到 S0 会让 `#menubar` 与 `#sidebar` **同色（1.00）**，比改之前（1.033）更糟。纪律是**先拆散、再映射**（§5.2.2） |
| 不要把对比度表只算到"画布 + 卡片"两档 | `--accent` 在 S4 / `--hover` / `--control-hover` / `--selected` 四个面上会跌到 3.63–4.42。只核 S2 / S3 会得出"全部达标"的错误结论（§5.1 九面门禁） |
| 不要把 Monaco 的任何外观项当成"改 CSS 就行" | 字体走 `settings.font_family` → `buildEditorOptions` 的 4 个注入点，主题走 `setTheme`，两者都不是 CSS。外观类改动先问一句"编辑器自己是怎么拿到这个值的" |
| 不要用 `grep ease` 当门禁 | 会命中 `var(--ease-out)` 造成假阳性；而缓动实际写在 `animation` 简写里，`@keyframes` 内部一个都没有（§7-11） |

**克制本身就是高级感。** OpenCharm 已经有一套工程上很扎实的 token 系统——需要做的不是往里加东西，是**把已有系统的分层拉开、把打架的色系统一、把缺失的编辑器环节补上**。

---

## 附录 A：关键数据速查（全部实测，可复现）

```
深色主题 · 现状
  正文 #d4d4d4 / 编辑区 #1e1e1e   : 11.25
  次要 #9d9d9d / 面板底 #1b1b1b   :  6.35
  边框 #3c3c3c / 编辑区 #1e1e1e   :  1.51   （非文本）
  表面端到端 #1b1b1b → #252526    :  1.12   ← 失效
  边框 #3c3c3c / 面板底 #1b1b1b   :  1.561  ← v1.2 订正（v1.1 记 1.49）
  menubar / sidebar 同源 #1b1b1b  :  1.00   ← v1.2 追加：两者现状就已同色，对画布 1.033

浅色主题 · 现状
  正文 #333333 / #ffffff          : 12.63
  次要 #6c6c6c / 面板底 #ececec   :  4.44   ← 未达 AA 4.5
  边框 #d4d4d4 / #ffffff          :  1.48
  v1.2 追加的浅色 AA 缺陷：
    #6c6c6c / --tab-inactive-bg #ececec : 4.44 ✗
    #6c6c6c / --selected #d6ebff        : 4.30 ✗
    #6c6c6c / --control-hover #c8c8c8   : 3.14 ✗  ← 远比"擦边"严重
    #6c6c6c / --bg-alt #f3f3f3          : 4.73 ✓

色系（现状）
  交互色 #0e639c / #1e1e1e       :  2.61   ← 交互色比品牌色暗得多，蓝到几乎沉进底
  品牌 #4ec9b0 / #1e1e1e          :  8.18
  gradient 蓝 #4da3ff / #1e1e1e  :  6.35
  gradient 紫 #9a6bff / #1e1e1e  :  4.70
  青绿 ↔ 交互蓝 RGB 欧氏距离      : 122.1   ← 两个色系
  青绿 ↔ gradient 紫 欧氏距离    : 144.4
  青绿 ↔ gradient 蓝 欧氏距离    :  87.7

深色 · 新阶梯
  S0 #101013 → S1 #17171b        :  1.06   （保底 ≥1.05，不设更高门禁）
  S1 → S2 #1f1f24                :  1.09
  S2 → S3 #2a2a30                :  1.15   （组件轴 ≥1.12 ✅）
  S3 → S4 #35353d                :  1.17   （组件轴 ≥1.12 ✅）
  S0 → S2（画布轴）               :  1.16   （≥1.15 ✅）
  S0 → S4 端到端                 :  1.56   （现状 1.12）
  正文 --fg #d4d4d4（v1.2 决策：保留不改）：
       S0 12.81 / S1 12.06 / S2 11.07 / S3 9.62 / S4 8.20   ← 全部远高于 AAA
       └ 对照「改 #e4e4e8」方案：14.98 / 14.10 / 12.94 / 11.25 / 9.58（收益低于它引入的同
         步义务，故不采纳；v1.1 的附录三行即按 #e4e4e8 算的，现已回填为 #d4d4d4。见 §5.1）
  --fg-dim  #9c9ca4：S2 6.02 / S3 5.23 / S4 4.46 ✗
  --fg-muted #adadb5：S3 6.40 / S4 5.45 ✅ · hover 5.87 · control-hover 5.06 · selected 4.81 ✅
  --accent #2aa88f 九面（v1.2 新增 —— 关键是它作为「文字/图标色」而非底色）：
       S0 6.42 ✅ · S1 6.04 ✅ · S2 5.55 ✅ · S3 4.82 ✅ · S4 4.11 ✗
       hover #303038 4.42 ✗ · control-hover #3a3a42 3.81 ✗ · selected #26433f 3.63 ✗ · tab-inactive 5.28 ✅
  --accent-emphasis 候选九面：
       #4ec9b0（= --brand-2，采纳）：9.32 / 8.77 / 8.05 / 7.00 / 5.96 / 6.42 / 5.53 / 5.27 / 7.67   全 ✅
       #45c2ab（更内敛备选）：S4 5.53 · hover 5.95 · control-hover 5.13 · selected 4.88              全 ✅
  品牌阶梯 on S2：#7ce3cd 10.73 · #4ec9b0 8.05 · #2aa88f 5.55 · #1f8070 3.42 · #175a50 2.04
  accent 家族 on S2：#4ec9b0 8.05 · #38b8a0 6.67 · #2aa88f 5.55
  白字 on：#2aa88f 2.96 ✗ · #1f8070 4.79 ✅ · #175a50 8.03 ✅   ← 双角色约束的证明
  派生：--hover #303038 (1.25, fg-dim 4.80) · --control-hover #3a3a42 (1.46, 正文 8.89)
        --selected #26433f (1.53, 正文 8.46, fg-dim 3.94 ✗) · --tab-inactive #232329 (1.05, 5.73)

浅色 · 新阶梯
  L0 #e9e9ec → L1 #f3f3f4        :  1.09
  L1 → L2 #ffffff                :  1.11
  L0 → L2（画布轴）               :  1.21
  控件 L3 #f7f7f8 vs 画布         :  1.07
  正文 #333333：L0 10.43 / L1 11.39 / L2 12.63
  --fg-dim #5f5f68：L0 5.22 / L1 5.70 / L2 6.32 / L3 5.90   ← 四档全达标，浅色不需 --fg-muted
  青绿候选：#0e7261 白底 5.84 · L0 4.82 · L1 5.26 · 白字 5.84   ← 一值两用
  --selected #d3efeb：正文 10.42 · --fg-dim 5.21
  v1.2 新增 · 浅色派生面（详见 §5.2.3）：
    --hover         #f0f0f2  vs 画布 1.138 · fg-dim 5.55 ✅ · accent 5.13 ✅
    --control-hover #e4e4e6  vs 画布 1.270 · fg-dim 4.98 ✅ · accent 4.60 ✅
                             └ 现值 #c8c8c8 上 fg-dim 仅 3.14 ✗（旧 #6c6c6c 更差）
    --selected      #d3efeb  vs 画布 1.213 · 正文 10.42 · fg-dim 5.21 ✅（替掉蓝色 #d6ebff）
    --tab-inactive  #e9e9ec  vs 画布 1.212 · fg-dim 5.22 ✅
    --link-hover    #0b6350  白底 7.20 · L0 5.95 · control-hover 5.67   ← 浅色七面全达标
```

## 附录 B：参考对象

分层与克制：**Linear**（表面阶梯 + 单一强调色的教科书）、**Zed**（近单色、发丝级边框）
深色材质：**Raycast**（投影 + 顶边高光双轨）
IDE 内敛度：**Sublime Text**（零装饰、靠排版与材质取胜）
反面教材：各类"AI IDE"的紫色渐变 + 毛玻璃（装饰过载，久用疲劳）

## 附录 C：配套文档

| 文档 | 作用 | 状态 |
|---|---|---|
| `docs/adr/0005-brand-accent-unification.md` | 修订三条既有裁决：① D4「青绿 = 品牌 / 蓝 accent = 功能交互」② UI-06「devtools tab 激活态应统一到 `--brand`」③ **`style.css:216` 注释裁决「accent/danger 保持深色值以确保跨主题一致」**（v1.2 追加：§5.1 新增 light `--accent: #0e7261` 正在推翻它） | **尚未创建（悬空链接）** —— 批 1 第一步必须补，且要同步登记进 `docs/adr/README.md` 决策表（当前只登记 0003 / 0004） |
| `tools/ui/audit_tokens.py` | token 审计 + WCAG 复算 + 抬升面扫描 + **九面 / 浅色派生枚举**（§7 门禁） | 批 1 新建 |
| `shell/src/theme/tokens.ts` | CSS ↔ Monaco 主题单一真源 | 批 4 新建（`shell/src/theme/` 当前不存在） |
| `shell/src/__tests__/styleTokens.test.ts` | **批 2a：三方一致**（style.css ↔ FOUC 块 ↔ 浅色覆盖层）+ 对比度门禁；**批 4 扩为四方**（加 Monaco） | 批 2a 新建，批 4 扩展 |
| `tools/fetch-fonts.ps1` + `ci/versions.toml [fonts]` | JetBrains Mono 按 sha256 锁定拉取（`ci/versions.toml` 现有 `[shell]`/`[engines]`/`[toolchain]`/`[debugger]`/`[notes]`，无 `[fonts]`） | 批 3 新建 |
| `state.ts:136` + `loadSettings` 迁移（v1.2 新增） | 编辑器字体默认值与存量 `settings.json` 迁移 | 批 3 —— 与批 4 的主题名迁移同范式 |
| `docs/ui_design_improvement_plan.md` §7 | 既有 D4 / UI-06 裁决原文（被 ADR-0005 修订） | 已完成，保留原文并加指向（注意：该文档 `:6` / `:149` 已先行引用 ADR-0005，补 ADR 前属悬空链接） |
