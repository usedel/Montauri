# OpenCharm 视觉「高级感」诊断与改造方案

> 版本：v1.0 · 日期：2026-10-02 · 状态：**待评审**
> 审阅对象：`shell/`（Tauri 2 + Monaco 外壳前端）——`index.html`、`src/style.css`（202 KB / 约 5100 行）、`src/*.ts`、`src-tauri/`
> 与既有文档的关系：本文件是**方向性设计评估**，与 `docs/ui_design_improvement_plan.md`（v2.1，30/30 已完成的**缺陷修复与一致性**计划）互补而非替代。那份计划解决的是"对不对"，本文档解决的是"贵不贵"。
> 冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文档。

---

## 0. 一句话结论

**OpenCharm 现在看起来"称职但衍生"——像一个没有贴牌的 VS Code。**

这不是能力问题，是**身份问题**。代码质量很高：token 化彻底（158 处 `font-size` 全部走变量）、双主题对比度逐条按 WCAG 公式核算过、ARIA 语义四类模式齐全。工程底座是 A 级的。

但"高级感"不来自工程正确，来自**克制的差异化**。当前三个致命点：

| # | 症状 | 数据 |
|---|---|---|
| 1 | 品牌色精神分裂 | 功能态用青绿 `#4ec9b0`，logo 用蓝紫 `#4da3ff→#9a6bff`，RGB 距离 **87.7**，两个毫不相干的色系 |
| 2 | 表面层级形同不存在 | 编辑区/侧栏/面板三档表面端到端对比 **1.12:1**（人眼阈值约 1.15），层级全靠 1px 实线边框硬撑 |
| 3 | 编辑器跑出厂主题 | `state.ts` 直接用 stock `vs-dark` / `vs-light`；占屏 60–70% 的区域与外壳 token 系统**不同源** |

这三条修好，观感提升约等于其余所有改动之和。

---

## 1. 诊断方法

对 `shell/src/style.css` 做全量 token 审计 + 对比度实算（WCAG 相对亮度公式，非目测），并对 `index.html` 骨架、`main.ts` / `monaco.ts` / `state.ts` 关键接线做交叉核对。

本报告所有对比度数值均为实算结果，可复现。

---

## 2. 现状体检

### 2.1 品牌身份：双色系并行（严重）

```css
:root {
  --brand: #4ec9b0;                                    /* 青绿：功能态 */
  --brand-gradient: linear-gradient(135deg, #4da3ff, #9a6bff);  /* 蓝紫：logo */
  --welcome-glow: rgba(88, 166, 255, 0.07);            /* 蓝：欢迎页光晕 */
}
```

实际用量：

- `var(--brand)` —— **19 处**，承担全部功能语义：活动标签顶部条、运行按钮、底部面板激活态、设置导航激活、Git 当前分支、终端运行标记…
- `var(--brand-gradient)` —— **仅 2 处**（`.ew-logo` 欢迎页 logo，及另一处品牌块）

**诊断**：logo 是蓝紫的，产品"说话"是青绿的。用户看 logo 记住蓝紫，用产品记住青绿，两个记忆点互相稀释。这是"没有品牌"最典型的形态——不是没设计 logo，是 logo 和产品不通气。

顺带一提，`--welcome-glow` 的蓝（88,166,255）与 `--accent`（VS Code 蓝 `#0e639c`）又是第三支色系。

### 2.2 表面分层：三档表面端到端仅 1.12:1（严重）

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

人眼在深色下分辨相邻面块的阈值约 **1.15:1**。也就是说：**当前三档表面，用户基本看不出区别。**

两个次生问题：

1. **层级方向反直觉**：`--bg-panel`（面板）比 `--bg`（编辑区）**更暗**。常规做法是"越靠内容核心越亮，越靠外框越暗"（Linear、Zed、Notion 均如此）。现在是框架比画布亮，内容反而浮不出来。
2. **边框被迫承担全部层级职责**：`--border: #3c3c3c` 在 `--bg` 上对比 **1.51:1**，且几乎每个区块都用实心 1px 描边。这是 2015 年 flat design 的做法——**用线框替代材质**。

### 2.3 字体：操作系统默认值（中等偏重）

```css
html, body {
  font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
}
--mono: Consolas, "Cascadia Code", "JetBrains Mono", monospace;
```

- **UI 字体**：Segoe UI + 微软雅黑 = Windows 系统默认组合，零品牌识别、零差异化。任何一台 Win11 上的未美化 Win32 程序都长这样。
- **等宽字体**：**Consolas 打头**。Consolas 是 2007 年随 Vista 发布的字体，字面窄、x-height 小、无编程连字。后面挂的 Cascadia Code / JetBrains Mono 只在用户本机装了才生效——实际上绝大多数机器只会命中 Consolas。

对 IDE 而言，**等宽字体是 ROI 最高的一项**：用户 80% 的注视时间落在等宽文本上。当前栈里排第一的恰恰是最老的那个。

### 2.4 编辑器主题未同步（严重）

```ts
// src/state.ts:129
theme: "vs-dark",
```

`src/themePicker.ts` 的主题列表也是 `vs-dark` / `vs-light` 原值。**Monaco 用的是出厂主题，没有 `defineTheme` 自定义。**

后果：外壳辛苦建立的一整套 token（表面阶梯、品牌色、语法色）在占屏面积最大的编辑器里**完全失效**——编辑器内的背景、选中色、行高亮、缩进参考线全部是 VS Code 原厂值，和旁边的侧栏、终端、面板不是一套材质。这是"拼装感"的最大来源。

### 2.5 阴影：只有一档（中等）

```css
--shadow: 0 4px 16px rgba(0, 0, 0, 0.5);   /* 深色 */
--shadow: 0 4px 16px rgba(0, 0, 0, 0.18);  /* 浅色 */
```

全文件 19 处 `box-shadow`，其中 6 处是 `inset` 色条（日志级别、Git 分支指示），**真正的投影只有一档、没有层级**。而深色 UI 的核心难题恰恰是：**纯黑投影在深色底上几乎不可见**——`rgba(0,0,0,.5)` 落在 `#1e1e1e` 上，视觉增量极小。

业界通行解法是**双轨**：投影 + 顶边高光 `inset 0 1px 0 rgba(255,255,255,.06)`。高光才是深色下"这块浮起来了"的真正信号源。当前完全没有这一层。

### 2.6 动效：有开关，无曲线（轻）

```css
--transition-fast: calc(0.12s * var(--motion)) ease;
--transition-base: calc(0.15s * var(--motion)) ease;
```

`--motion` 倍率 + `prefers-reduced-motion` 接入是好的（无障碍 A 级）。但**全部用 `ease`**——没有缓动曲线分级。

`ease`（cubic-bezier(0.25,0.1,0.25,1)）是"对称减速再加速"，观感偏机械。高级动效的关键是**非对称曲线**：入场用 decelerate（快速启动、缓慢落位），出场用 accelerate。`ease` 两头软，缺少"物体有质量"的暗示。

对 IDE 而言时长 ≤150ms 的判断是对的（不能拖慢操作节奏），**该改的是曲线，不是时长**。

### 2.7 圆角：3px 主档（轻）

```css
--radius-sm: 3px;   /* 51 处，绝对主档 */
--radius-md: 4px;
--radius-lg: 6px;   /* 卡片/模态 */
```

3px 在 2026 年的语境里偏"工具感/紧凑"，偏 VS Code 和老派桌面软件。当代高端软件（Linear、Raycast、Arc）的控件主档普遍在 **6–8px**。

注意这不是绝对值问题——IDE 需要信息密度，不能照搬消费级 App 的大圆角。但 **3px 与 6px 之间差 2 倍**，档位间距过小，层级拉不开。

### 2.8 浅色主题：站在 AA 悬崖边（轻，但是真实缺陷）

```
--fg-dim #6c6c6c  /  --bg-panel #ececec  : 4.44:1
```

AA 要求是 **4.5:1**。**差 0.06。** 状态栏、次要说明、时间戳等大量使用 `--fg-dim` 的内容在浅色主题下**技术上不合规**。

这是历史遗留：深色侧 `--fg-dim #9d9d9d` / `#1b1b1b` = 6.35:1 很宽裕，浅色侧覆盖时取值偏浅了。

---

## 3. 判断框架：高级感到底来自哪

在给方案之前先统一标尺。"高级感"不是玄学，它由六个可验证的来源构成，按对观感的**贡献权重**排序：

| 权重 | 来源 | 通俗解释 | OpenCharm 现状 |
|---|---|---|---|
| **35%** | **材质（Material）** | 表面分层、投影、边框质感。界面看起来是"一层层叠起来的实物"还是"用线框画的表格" | ★☆☆☆☆ 分层失效 |
| **25%** | **身份（Identity）** | 品牌色是否单一且贯穿、字体是否有辨识度、图标是否自成体系 | ★★☆☆☆ 双色系打架 |
| **20%** | **排版（Typography）** | 字体选择、字号节奏、字重层次、对齐 | ★★☆☆☆ 系统默认字体 |
| **10%** | **动效（Motion）** | 缓动曲线、时长分级、状态转换的连贯性 | ★★★☆☆ 有开关无曲线 |
| **6%** | 几何（Geometry） | 圆角档位、间距节奏、对齐网格 | ★★★☆☆ 档位过密 |
| **4%** | 装饰（Ornament） | 渐变、光晕、纹理、插画 | ★★☆☆☆ 只有欢迎页 |

**关键洞察：装饰只占 4%。** 绝大多数"让它看起来高级"的第一直觉——加渐变、加毛玻璃、加发光——恰好是最无效的那一档，而且在 IDE 里**有害**（干扰代码阅读）。

高级感 = **材质 + 身份 + 排版**，且三者都靠**减法**实现：更少的色系、更少的边框、更少的字号档、更少的动效时长档。

---

## 4. 改造方案

### P0 · 杠杆 1：统一品牌色系（最高性价比）

**动作**：以青绿为唯一主轴，建 5 级品牌阶梯；把 gradient 拉回同色系。

理由：青绿已用于 19 处功能态，**改 gradient（2 处）比改 brand（19 处）便宜一个数量级**。保留青绿，让 logo 去迁就产品。

```css
:root {
  /* 品牌阶梯：单一色相（青绿 ~165°），明度分级 */
  --brand-1: #7ce3cd;   /* 高亮/悬停      / S2 对比 10.86 */
  --brand-2: #4ec9b0;   /* 主色（功能态）  / S2 对比  8.15 */
  --brand-3: #2aa88f;   /* 按下/深底强调   / S2 对比  5.61 */
  --brand-4: #1f8070;   /* 边框/描边       / S2 对比  3.47 */
  --brand-5: #175a50;   /* 极深底色        / S2 对比  2.07 */

  --brand: var(--brand-2);              /* 兼容存量 19 处引用 */

  /* logo 渐变回归青绿同色系：与功能态同源 */
  --brand-gradient: linear-gradient(135deg, var(--brand-1), var(--brand-2) 55%, var(--brand-3));
  --welcome-glow: rgba(78, 201, 176, 0.07);   /* 蓝 (88,166,255) → 青绿 */
}
```

`[data-theme="light"]` 侧同步：现有 `--brand: #14806b` 保留为主色，补 `light` 阶梯（`--brand-3` 方向的深青绿），gradient 用 `var(--brand-3) → var(--brand-4)` 方向以免白底上过浅。

**收益**：logo 与产品首次通气；欢迎页从"另一个产品的启动页"变成 OpenCharm 的启动页。改动量 ≈ 6 行。

---

### P0 · 杠杆 2：重建表面阶梯 + 真实层级（最大视觉收益）

**动作**：三档表面扩为五档，端到端对比从 **1.12 → 1.56**；层级方向纠正为"越靠内容越亮"。

```css
:root {
  /* 表面阶梯：S0 最深（外框/面板底）→ S4 最亮（浮层/hover） */
  --surface-0: #101013;   /* 窗口底 / 状态栏 / 面板底 */
  --surface-1: #17171b;   /* 侧栏 / 活动栏 */
  --surface-2: #1f1f24;   /* 编辑区 / 主内容画布  ← 最亮的内容面 */
  --surface-3: #2a2a30;   /* 输入控件 / 卡片 / 次级容器 */
  --surface-4: #35353d;   /* hover / 浮层（菜单、模态、tooltip） */

  /* 语义别名，兼容存量 */
  --bg:        var(--surface-2);
  --bg-panel:  var(--surface-0);
  --bg-alt:    var(--surface-1);
}
```

实算校验（全部达标）：

```
S0 #101013 → S1 #17171b : 1.06
S1 #17171b → S2 #1f1f24 : 1.09
S2 #1f1f24 → S3 #2a2a30 : 1.15
S3 #2a2a30 → S4 #35353d : 1.17
端到端 S0 → S4          : 1.56   （现状 1.12）
```

文字对比（同步调整后）：

```
正文 #e4e4e8 / S2 编辑区 : 12.94
正文 #e4e4e8 / S1 侧栏   : 14.10
次要 #9c9ca4 / S0 最深   :  6.97
```

> ⚠️ **配套规则**：次要色 `--fg-dim #9c9ca4` 落在 S4 `#35353d` 上只有 **4.46:1**（不达 AA）。
> 因此须新增一档 `--fg-muted: #adadb5`，规定 **S3/S4 等抬升面上不使用 `--fg-dim`，一律用 `--fg-muted`**。这是建分层后必然出现的连带项，必须一起做。

**投影双轨化**（深色 UI 的关键手法）：

```css
:root {
  /* 深色下「投影 + 顶边高光」双轨：高光才是"浮起来"的真正信号 */
  --elev-1: 0 1px 2px rgba(0,0,0,.40), inset 0 1px 0 rgba(255,255,255,.05);
  --elev-2: 0 4px 12px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  --elev-3: 0 12px 32px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.07);
  --elev-4: 0 24px 64px rgba(0,0,0,.62), inset 0 1px 0 rgba(255,255,255,.08);

  --shadow: var(--elev-2);   /* 兼容存量：19 处引用原地升级 */
}
```

浅色主题侧：去掉 `inset` 高光（白底上无意义，反而脏），只保留投影并降低不透明度。

**收益**：这是本次改造中**唯一能让用户说不出哪里变了、但就是觉得不一样**的一项。

---

### P0 · 杠杆 3：字体替换

**3a. 等宽字体（最高 ROI）**

```css
--mono: "JetBrains Mono", "Cascadia Code", "SF Mono", "Consolas", monospace;
```

把 JetBrains Mono 提到首位，Consolas 降为最后兜底。若希望更强差异化，可考虑 `Monaspace`（GitHub，免费，五档字宽可变）或 `Berkeley Mono`（商业授权）。

**若要彻底摆脱"用户本机有没有装"的不确定性**：把字体文件随包分发（`tauri.conf.json` 的 `bundle.resources`，与 debugpy / intel 同一套机制，见 README §打包发布），CSS 侧 `@font-face` 引用。这是唯一能保证 100% 机器一致的做法，代价是安装包 +2~5 MB。

**3b. UI 字体**

```css
--font-ui: "Inter", "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
```

同样建议随包分发 Inter（Variable 版约 300 KB subset）。Inter 的 x-height 大、字面宽，在 11–13px 的小字号下可读性显著优于 Segoe UI —— 对本项目的 `--text-xs: 11px` / `--text-sm: 12px` 主战场尤其关键。

**3c. 排版细节（成本极低，质感提升明显）**

```css
body {
  font-family: var(--font-ui);
  font-feature-settings: "cv05" 1, "ss03" 1;   /* 单引号/数字字形优化 */
  font-optical-sizing: auto;
  -webkit-font-smoothing: antialiased;
}
/* 等宽区启用编程连字 + 表格数字（对齐用） */
.mono, [class*="-mono"], pre, code {
  font-family: var(--mono);
  font-variant-ligatures: contextual;
  font-feature-settings: "liga" 1, "calt" 1;
}
/* 数字对齐场景（行号、计时、统计） */
.tabular { font-variant-numeric: tabular-nums; }
```

`tabular-nums` 对行号、运行耗时、依赖版本号这类需要纵向对齐的数字是**立竿见影**的整洁度提升。

---

### P0 · 杠杆 4：Monaco 自定义主题

**动作**：`src/monaco.ts` 增加 `defineTheme`，两套主题全部引用外壳 token 值。

```ts
monaco.editor.defineTheme("opencharm-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [ /* 语法色：复用 --syntax-* token 的深色值 */ ],
  colors: {
    "editor.background":                "#1f1f24",  // = --surface-2
    "editorGutter.background":           "#1f1f24",
    "sideBar.background":                "#17171b",  // = --surface-1
    "editor.lineHighlightBackground":    "#242429",
    "editor.selectionBackground":        "#2a4a5a",
    "editorIndentGuide.background1":     "#2a2a30",
    "editorWidget.background":           "#2a2a30",  // = --surface-3（悬浮建议框）
    "editorHoverWidget.background":      "#2a2a30",
    "editorSuggestWidget.background":    "#2a2a30",
    "editor.lineHighlightBorder":        "#00000000", // 去掉 VS Code 那条边框线
    "scrollbarSlider.background":        "#35353d80",
    "focusBorder":                       "#4ec9b0",   // 改用品牌色，而非 VS Code 蓝
  },
});
```

然后 `state.ts::DEFAULT_SETTINGS.theme` 与 `themePicker.ts` 的候选项换为 `opencharm-dark` / `opencharm-light`。

**要点**：把 token 值以常量表形式单列（如 `src/theme/tokens.ts`），CSS 与 Monaco 主题**同一份来源**，避免两边漂移。可在 `__tests__/` 加一条一致性断言（参照现有 `gutterGlyphSize.test.ts` 的做法）。

**收益**：消除"拼装感"的最大来源。编辑器与外壳终于是一套材质。

---

### P1 · 杠杆 5：边框纪律

**动作**：三档边框，hairline 用 alpha 叠色而非实色；浮层从"实线描边"改为"投影 + hairline"。

```css
:root {
  --border-hairline: rgba(255,255,255,0.06);  /* 极细：列表分隔、行内分隔  */
  --border-subtle:   rgba(255,255,255,0.10);  /* 常规：面板边界             */
  --border-strong:   rgba(255,255,255,0.16);  /* 强调：模态、聚焦控件       */
  --border:          var(--border-subtle);    /* 兼容存量 */
}
```

alpha 叠色的好处：边框颜色自动跟随所在表面，**跨 S0–S4 五档表面都正确**，不需要为每层单独定义。实色 `#3c3c3c` 做不到这点。

浅色侧换成 `rgba(0,0,0,0.08 / 0.12 / 0.18)`。

**配套**：浮层类（`.ctx-menu` / `.oc-tooltip` / `.modal-card` / `.palette`）统一改为 `--elev-3` + `--border-hairline`，去掉当前的实体描边。

---

### P1 · 杠杆 6：动效曲线分级

**动作**：保留 `--motion` 无障碍开关，把 `ease` 换成三条非对称曲线。

```css
:root {
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);   /* decelerate：入场/展开  */
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);    /* standard：位移/形变    */
  --ease-in:     cubic-bezier(0.4, 0, 1, 1);      /* accelerate：出场/收起  */

  --transition-fast: calc(0.12s * var(--motion)) var(--ease-out);
  --transition-base: calc(0.15s * var(--motion)) var(--ease-out);
  --transition-slow: calc(0.24s * var(--motion)) var(--ease-in-out);  /* 仅面板/模态 */
}
```

`--ease-out: cubic-bezier(0.16,1,0.3,1)` 是"快速启动、缓慢落位"——物体有惯性的感觉就来自这条曲线。`ease` 做不到。

**保留现有 ≤150ms 上限**（IDE 不能为观感牺牲操作节奏），只有面板展开/模态这类结构性动画放宽到 240ms。

---

### P1 · 杠杆 7：几何档位拉开

```css
--radius-xs: 3px;    /* 徽标、行内高亮      （原 2px） */
--radius-sm: 6px;    /* 控件主档：按钮/输入  （原 3px，×2） */
--radius-md: 8px;    /* 卡片、内嵌面板      （原 4px） */
--radius-lg: 10px;   /* 模态、卡片容器      （原 6px） */
--radius-xl: 16px;   /* 品牌装饰            （原 10px） */
```

主档 3px → 6px 是可见变化，但仍属"紧凑"范畴，不破坏 IDE 的信息密度。

**取舍说明**：不要照搬消费级 App 的 12–16px 大圆角。IDE 的侧栏条目、标签页、菜单项都是高密度小尺寸元素，过大圆角会让密集列表显得松垮。6px 是"现代"与"紧凑"的平衡点。

---

### P2 · 杠杆 8：材质细节

| 项 | 现状 | 改法 |
|---|---|---|
| **滚动条** | `#4a4a4a` 实心方块，常显 | 宽 8px、圆角 4px、`rgba(255,255,255,.10)` 半透明；**hover 容器时才显**（`scrollbar-color` + `::-webkit-scrollbar-thumb`）；hover 加深到 `.18` |
| **焦点环** | `outline: 2px solid var(--accent)`（VS Code 蓝实心） | 双环带 offset：`box-shadow: 0 0 0 2px var(--surface-2), 0 0 0 4px var(--brand-2)`。焦点环脱离背景后不再"糊"在元素上，是高端 UI 的标志性细节 |
| **图标** | codicon（VS Code 图标字体） | 短期接受——换图标集工作量大。中期：至少统一视觉权重（codicon 混有实心/描边两种风格）。长期：自绘或用 Lucide / Tabler 统一 stroke 2 / 24px 网格 |
| **加载态** | codicon spin | 加 `stroke-linecap: round` 的旋转弧 + 淡入，避免文字跳动 |
| **空状态** | 已有 `emptyState()` 统一 | 保持；可补一处极淡的品牌色径向渐变作底，与 `--welcome-glow` 同源 |

---

### P2 · 杠杆 9：修掉浅色主题的 AA 悬崖

```css
[data-theme="light"] {
  --fg-dim: #5f5f68;   /* 原 #6c6c6c：在 #ececec 上 4.44:1 → #5f5f68 达 5.4:1 */
}
```

一格之差的改动，把浅色主题从"技术上不合规"拉回达标。

---

## 5. 落地路线图

按"**收益 ÷ 成本**"排序，建议分四批，每批独立可验收、可回滚。

| 批次 | 内容 | 涉及文件 | 预估 | 观感收益 |
|---|---|---|---|---|
| **批 1** | 杠杆 1（品牌统一）+ 杠杆 9（浅色 AA） | `style.css` | 极小（≈10 行） | ★★★☆☆ |
| **批 2** | 杠杆 2（表面阶梯 + 双轨投影 + `--fg-muted`） | `style.css` 为主的 token 层 | 中 | ★★★★★ |
| **批 3** | 杠杆 3（字体）+ 杠杆 4（Monaco 主题） | `style.css`、`monaco.ts`、`state.ts`、`themePicker.ts`、`tauri.conf.json`（字体随包） | 中-大 | ★★★★★ |
| **批 4** | 杠杆 5/6/7/8（边框、曲线、圆角、细节） | `style.css` + 少量 `.ts` | 中 | ★★★☆☆ |

**建议**：批 1 + 批 2 合并为一个 PR（改动集中在 token 层，风险可控，收益占总量约 55%），批 3 单独一个 PR（涉及 Monaco 与打包，需回归测试），批 4 按子主题拆小 PR。

**约束**（沿用 `ui_design_improvement_plan.md` 的既有纪律）：
- 新增样式禁止裸色值 / 裸字号 / 裸圆角，一律走 token；
- 不得向 `main.ts`（已 157 KB）堆逻辑，交互改动落到对应功能域模块；
- 每批改动后跑既有测试（`shell/src/__tests__/`），并补 token 一致性断言。

---

## 6. 验收清单

| # | 验收项 | 判定方式 |
|---|---|---|
| 1 | 全文件无 `var(--brand-gradient)` 之外的第三支色系 | grep 确认欢迎页/logo 与功能态同色相 |
| 2 | 相邻表面阶梯对比 ≥ 1.05，端到端 ≥ 1.50 | 脚本实算 |
| 3 | `--fg-dim` 在所有可能承载面上 ≥ 4.5:1（深/浅双主题） | 脚本枚举所有表面 × 文字色组合 |
| 4 | Monaco 主题名非 `vs-dark` / `vs-light` | `state.ts` + `themePicker.ts` 核验 |
| 5 | Monaco 主题色值与 CSS token 同源，有单测钉死一致性 | 新增 `__tests__/themeTokenSync.test.ts` |
| 6 | 全文件 `transition` 无裸 `ease` | grep 计数为 0 |
| 7 | 全文件 `box-shadow` 走 `--elev-*` token | grep 裸阴影为 0 |
| 8 | 截图比对：深/浅双主题 × 编辑区/侧栏/终端/设置 四视图 | 人工抽查 |
| 9 | `prefers-reduced-motion` 下全部动效仍为 0 | 沿用现有 `--motion` 机制，回归验证 |

---

## 7. 明确不要做的事

最后一条很重要。**在 IDE 语境下，以下"高级感套路"是有害的**：

| ✗ 不要 | 原因 |
|---|---|
| 给代码区加圆角 / 阴影 / 渐变 | 代码阅读需要零干扰背景；装饰会与语法高亮争夺注意力 |
| 毛玻璃 / backdrop-blur 滥用 | 拖拽时掉帧，且代码滚动时背景模糊会晃动，长时间使用疲劳 |
| 大面积渐变背景 | 装饰占观感权重仅 4%，却最容易显得廉价。渐变只用于 logo 与欢迎页这类**无代码**区域 |
| 图标加粗描边 / 实心色块图标 | 高密度界面里会让工具栏变成一堵色墙 |
| 动效超过 200ms | IDE 的操作节奏优先于观感，慢动效会让人"等界面" |
| 增加字号档位 | 现有 6 档已精简过一次（UI-18 从 12 档收敛），再加是倒退 |
| 引入第三种色系（如"AI 紫"） | 本项目已有青绿（品牌）+ 蓝（accent）两支，足够。色系越多越难看 |

**克制本身就是高级感。** OpenCharm 已经有一套工程上很扎实的 token 系统——需要做的不是往里加东西，是**把已有系统的分层拉开、把打架的色系统一、把缺失的编辑器环节补上**。

---

## 附录 A：关键数据速查

```
深色主题
  正文 #d4d4d4 / 编辑区 #1e1e1e   : 11.25
  次要 #9d9d9d / 面板底 #1b1b1b   :  6.35
  边框 #3c3c3c / 编辑区 #1e1e1e   :  1.51   （非文本）
  表面端到端 #1b1b1b → #252526    :  1.12   ← 失效

浅色主题
  正文 #333333 / #ffffff          : 12.63
  次要 #6c6c6c / 面板底 #ececec   :  4.44   ← 未达 AA 4.5
  边框 #d4d4d4 / #ffffff          :  1.48

品牌色
  --brand 青绿 #4ec9b0 / #1e1e1e  :  8.18
  gradient 蓝 #4da3ff / #1e1e1e   :  6.35
  gradient 紫 #9a6bff / #1e1e1e   :  4.70
  青绿 ↔ 蓝 RGB 欧氏距离          : 87.67   ← 两个色系
```

## 附录 B：参考对象

分层与克制：**Linear**（表面阶梯 + 单一强调色的教科书）、**Zed**（近单色、发丝级边框）
深色材质：**Raycast**（投影 + 顶边高光双轨）
IDE 内敛度：**Sublime Text**（零装饰、靠排版与材质取胜）
反面教材：各类"AI IDE"的紫色渐变 + 毛玻璃（装饰过载，久用疲劳）
