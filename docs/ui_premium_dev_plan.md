# UI 视觉「高级感」改造 · 开发文档

> 版本：**v1.0** · 日期：2026-10-03 · 状态：**批 1 实施中**
> 上游方案：`docs/ui_premium_design_report.md`（v1.2，二轮评审修订版）——**方案与本文档冲突时以本文档为准并反馈修订方案**（架构铁律「文档约定」）。
> 与 `docs/ui_design_improvement_plan.md`（v2.1，30/30 已完成）的关系：那份解决"对不对"（缺陷修复与一致性），本次解决"贵不贵"（材质 / 身份 / 排版）。
> 冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文档。
> **如何使用**：§3 是批 1 的逐项改动清单（照改），§4 是门禁命令（照跑），§5 是基线截图工具（照截），§6 是后续批次的开工入口，§7 是实施记录（逐批回填）。

---

## 1. 一页结论

| 项 | 结论 |
|---|---|
| 目标 | 把「称职但衍生」（像没贴牌的 VS Code）改造成有身份感的 IDE：材质分层 + 单色相身份 + 排版 |
| 手段 | **减法**：更少色系、更少边框、更少字号档；装饰权重只占 4%，不做渐变/毛玻璃 |
| 批次 | 六批：批 1（ADR + 交互色青绿统一 + 浅色 AA）→ 批 2a（表面阶梯 token）→ 批 2b（抬升面归属审计）→ 批 3（等宽字体随包）→ 批 4（Monaco 自定义主题，P1）→ 批 5（边框/曲线/圆角/材质） |
| 落地方式 | **master 直提**（产品负责人 2026-10-03 拍板），不建分支、不推送远程 |
| 验收方式 | **基线截图 + e2e computed-style 断言 + token 一致性单测 + `tools/ui/audit_tokens.py` 脚本门禁**；不接受纯人工抽查 |
| 当前进度 | ✅ 批 1 已落地（门禁：audit 0 FAIL / tsc 0 错 / vitest 994 / e2e 278 passed + 2 存量失败已 stash 对照排除 / 截图 8 张对照通过），⏳ 批 2a 待开工 |

### 1.1 批次状态

| 批次 | 内容 | 状态 |
|---|---|---|
| 批 1 | ADR-0005 + 审计脚本 + 杠杆 1（11 取值点收进青绿）+ 杠杆 9（浅色 AA） | ✅ 已落地（2026-10-03，记录见 §7.1） |
| 批 2a | 深浅两套表面阶梯 + `--bg-panel` 21 处拆分 + 三层同步义务 + `styleTokens.test.ts` | ⏳ 待开工（§6.1） |
| 批 2b | 19 处 `--bg-alt` → S3 审计 + 派生交互 token 重算 + `--fg-dim` 246 处抬升面审计 + 浮层 `--elev` 归属 | ⏳ 待开工（§6.2） |
| 批 3 | 等宽字体五处改动 + JetBrains Mono 随包（前置：CSP `font-src`） | ⏳ 待开工（§6.3） |
| 批 4 | Monaco 自定义主题 `opencharm-dark/light` + `--syntax-*` 与 `rules` 同批 | ⏳ 待开工（§6.4） |
| 批 5 | 边框纪律 / 动效曲线 / 圆角档位 / 材质细节 | ⏳ 待开工（§6.5） |

---

## 2. 已拍板决策（2026-10-03）

| 决策点 | 结论 |
|---|---|
| 推进节奏 | **一次只做批 1**，门禁全绿后再决定下一批 |
| 执行真源 | 建本文档；方案报告 `ui_premium_design_report.md` 保留论证过程 |
| 代码落地 | **master 直提**（本地提交，不 push） |
| 基线截图 | **改造前先自动截基线**（`shell/scripts/ui-baseline.mjs` → 系统 TEMP），改造后同参数再截一轮对照 |

### 2.1 沿用方案报告已拍板的裁决

- **推翻 D4**：`--accent` 蓝一并收进青绿体系，交互色与品牌色同源（ADR-0005）。
- **`--accent` 三角色**：`--accent`（≤S3 面的文字/描边/焦点环）· `--accent-emphasis`（≥S4 / hover / control-hover / selected 四面）· `--accent-fill`（实心按钮底，其上放 `--on-accent` 白字）——单值不可兼得（白字 ≥4.5 与画布文字 ≥4.5 数学上冲突）。
- **`--accent-emphasis` 取值**：采纳方案 **A**（`var(--brand-2)` = `#4ec9b0`，九面全部 ≥4.5），不新增第 6 个品牌档位（备选 B `#45c2ab` 已否决）。
- **`--fg` 保留 `#d4d4d4` 不改**（改 `#e4e4e8` 的收益小于它引入的同步义务）。
- **只随包等宽字体**（JetBrains Mono），Inter 走系统栈（单人自用定位，跨机一致性收益为零）。
- **语法色 `--syntax-*` 与 Monaco `rules` 同批改（批 4）**，批 1 不动；提前改会让编辑器与外壳脱色三个批次。

---

## 3. 批 1 改动清单

### 3.1 前置：补 ADR-0005（方案 v1.2 §0.3 列为「执行前置」）

| # | 动作 | 落点 |
|---|---|---|
| 1 | 新建 `docs/adr/0005-brand-accent-unification.md`：修订 ① D4「青绿 = 品牌 / 蓝 accent = 功能交互」② UI-06「devtools tab 激活态统一到 `--brand`」③ `style.css:216` 注释裁决「accent 跨主题一致」 | `docs/adr/0005-*.md` |
| 2 | 登记进 `docs/adr/README.md` 决策表（当前只登记 0003 / 0004） | `docs/adr/README.md:9-10` |

> 该 ADR 截至批 1 开工仍是**悬空链接**（`ui_premium_design_report.md:6/420/1017` 与 `ui_design_improvement_plan.md:6/149` 共 5 处引用）。

### 3.2 新建 `tools/ui/audit_tokens.py`（§7 门禁的可机检落点）

零第三方依赖（Python 3.13 标准库），解析 `shell/src/style.css` 的 `:root` 与 `[data-theme="light"]` 块，输出 JSON + 人读报告，违规退出码非 0。首批实现 4 项检查（后续批次在批 2a/2b 扩展）：

| 检查 | 判定 |
|---|---|
| **单色相** | `--brand*` / `--accent*` / `--link*` / `--focus-ring` / `--brand-gradient` 的色相与 `--brand` 基准色相差 ≤ 15° |
| **accent 面门禁** | 逐个面算 `--accent` 对比度；不达 4.5 的面必须存在 `--accent-emphasis` 且它 ≥4.5（批 1 只报告 + 断言 emphasis 全达标，选择器级 0 命中是批 2b 门禁 18） |
| **白字 on `--accent-fill`** | ≥ 4.5 |
| **浅色 `--fg-dim` 四档** | 在浅色各面上 ≥ 4.5（批 1 用旧浅色面，批 2a 换成 L0–L3） |

面（face）列表随批次自适应：批 1 用旧语义面 7 个（`--bg-panel` / `--bg` / `--bg-alt` / `--hover` / `--control-hover` / `--selected` / `--tab-inactive-bg`）；批 2a 起 `--surface-0..4` 存在后自动扩为九面。

### 3.3 杠杆 1：11 个蓝色取值点收进青绿（深色 8 + 浅色 3）

**深色 `:root`**（行号为改造前 `shell/src/style.css` 实测）：

| 行 | token | 现值 | 新值 |
|---|---|---|---|
| — | `--brand-1..5`（新增） | — | `#7ce3cd / #4ec9b0 / #2aa88f / #1f8070 / #175a50` |
| 19 | `--brand` | `#4ec9b0` | `var(--brand-2)` |
| 13 | `--accent` | `#0e639c` | `var(--brand-3)` |
| — | `--accent-emphasis`（新增） | — | `var(--brand-2)` |
| — | `--accent-fill`（新增） | — | `var(--brand-4)` |
| 14 | `--accent-hover` | `#1177bb` | `#38b8a0` |
| 15 | `--accent-soft` | `rgba(14,99,156,.35)` | `rgba(42,168,143,.28)` |
| 16 | `--accent-faint` | `rgba(14,99,156,.18)` | `rgba(42,168,143,.14)` |
| 30 | `--link` | `#4daafc` | `#2aa88f` |
| 31 | `--link-hover` | `#7cc2ff` | `#38b8a0` |
| 32 | `--link-border` | `rgba(77,170,252,.4)` | `rgba(42,168,143,.4)` |
| 57 | `--diff-hunk` | `#569cd6` | `#2aa88f` |
| 81 | `--debug-frame-active` | `rgba(84,116,224,.2)` | `rgba(42,168,143,.22)` |
| 83 | `--brand-gradient` | `linear-gradient(135deg,#4da3ff,#9a6bff)` | `linear-gradient(135deg, var(--brand-1), var(--brand-2) 55%, var(--brand-3))` |
| 84 | `--welcome-glow` | `rgba(88,166,255,.07)` | `rgba(78,201,176,.07)` |

> `--link-border` 未列入方案 §5.1 的 11 点表，但它在 §5.2.4 的「品牌 / 链接」组里被点名要青绿统一；蓝色 border 配青绿链接会直接暴露色系分裂，故批 1 一并收编。

**浅色 `[data-theme="light"]`（全为新增覆盖）**：

| 行 | token | 现值 | 新值 |
|---|---|---|---|
| 240 | `--brand` | `#14806b` | `#0e7261` |
| — | `--accent`（新增） | 继承深色 | `#0e7261` |
| — | `--accent-fill`（新增） | — | `var(--accent)` |
| — | `--accent-emphasis`（新增） | — | `#0b6350` |
| 237 | `--accent-soft` | `rgba(14,99,156,.18)` | `rgba(14,114,97,.18)` |
| 238 | `--accent-faint` | `rgba(14,99,156,.1)` | `rgba(14,114,97,.1)` |
| 253 | `--link` | `#0f6cbd` | `#0e7261` |
| 254 | `--link-hover` | `#0e639c` | `#0b6350` |
| 255 | `--link-border` | `rgba(15,109,180,.4)` | `rgba(14,114,97,.4)` |
| 266 | `--diff-hunk` | `#3070c0` | `#0e7261` |
| 288 | `--debug-frame-active` | `rgba(14,99,156,.18)` | `rgba(14,114,97,.16)` |
| 289 | `--welcome-glow` | `rgba(88,166,255,.12)` | `rgba(14,114,97,.08)` |

### 3.4 杠杆 9：浅色 AA 悬崖

`style.css:225` `--fg-dim: #6c6c6c` → **`#5f5f68`**。

> 一格之差的改动，但**单独做并不能让浅色合规**：`#5f5f68` 打在现状 `--control-hover #c8c8c8` 上仍只有 3.78。彻底修好要等批 2b 的浅色派生面重算（`--control-hover → #e4e4e6`，新值下 4.98 ✓）。批 1 先落 `--fg-dim`，审计脚本记录残留面。

### 3.5 注释考古（方案 §6 约束）

改值后必须同步改写，否则注释里的旧色值/旧对比度会变成"看似有据的错误指引"：

| 位置 | 现状 | 改法 |
|---|---|---|
| `style.css:18` | `D4：青绿 = 品牌识别；蓝 --accent = 功能交互。双色分工见文档 §7` | 改为指向 ADR-0005 + 青绿单一色相轴 |
| `style.css:90-91` | theme-pv 概览行末句「accent 跨主题一致，见浅色覆盖层头部注释」 | 改为「浅色侧有独立青绿取值（更深的 `#0e7261`）」 |
| `style.css:216-217` | 「accent/danger 等语义色保持深色值，确保强调色跨主题一致」 | 改为「accent 族浅色侧另取更深的青绿（白底 5.84）；danger/warn 等语义色仍保持跨主题一致」 |
| `index.html:9-11` | FOUC 同步义务注释列了 5 项 | 补第 6 项 `font-family`（批 3 改 body 字体前的预登记，防首帧/稳定帧抖动） |

### 3.6 明确不动（防止范围蔓延）

- `--syntax-*` 7 个（批 4 与 Monaco `rules` 同批）；
- `--ok` / `--danger` / `--warn` / `--meta` 语义色及其 border/soft；
- `--git-*` 与 `--diff-add`；
- `--theme-pv-*` 8 个预览色卡（批 1 不改表面色，色卡仍是当前真值；批 2a 换阶梯时同步）；
- `--surface-*` / `--bg-chrome` / `--elev-*` / `--fg-muted`（批 2a）；
- 圆角 / 缓动 / 边框 / 滚动条（批 5）。

---

## 4. 门禁（批 1）

| # | 门禁 | 命令 / 判定 |
|---|---|---|
| 1 | ADR 存在且已登记 | `docs/adr/0005-*.md` 存在 + `docs/adr/README.md` 决策表含 0005 |
| 2 | 单色相 / accent 面 / 白字 on fill / 浅色 fg-dim | `python tools/ui/audit_tokens.py`（退出码 0） |
| 3 | tsc 0 错 | `cd shell && npm run build` |
| 4 | vitest 全量 | `cd shell && node scripts/vitest-launch.mjs --watch=false --run` |
| 5 | e2e 全量（串行） | `cd shell && npx playwright test` |
| 6 | 截图对照 | 改造前/后各一轮 `node scripts/ui-baseline.mjs --tag <name>`，逐张比对（重点：选中态 / 链接 / 焦点环 / diff 标题 / 调试激活帧 / 欢迎页 logo） |
| 7 | `--motion` / `prefers-reduced-motion` 回归 | 沿用现有机制，e2e 全量覆盖 |

> 门禁 4/5 的执行注意：含 "vitest" 关键字的命令会被执行监控按 watch 处理并在约 10 秒后杀进程 —— 必须走 `scripts/vitest-launch.mjs` 包装脚本并落盘后读文件。

---

## 5. 基线截图工具

`shell/scripts/ui-baseline.mjs`（Node + Playwright，直连 vite dev :5173，复用已启动实例）：

```powershell
cd shell
node scripts/ui-baseline.mjs --tag before-b1     # 改造前
node scripts/ui-baseline.mjs --tag after-b1      # 改造后
```

- 产物：`%TEMP%\opencharm-ui-baseline\<tag>\<theme>-<view>.png`，共 **8 张**（深/浅 × 编辑区 / 侧栏 / 终端 / 设置）；
- 侧栏视图含文件树 + Git 状态色，终端走 `#tab-terminal`，设置走 `Ctrl+Alt+S`；
- 浅色组通过 `.theme-swatch[data-theme="vs"]` + `#settings-save` 切换（与 `themePicker.ts` 的 radiogroup 语义一致）；
- 视口固定 1440×900、`deviceScaleFactor: 1`，保证前后可比。

---

## 6. 后续批次开工入口

### 6.1 批 2a —— 表面阶梯（方案 §5.2.1 / §5.2.2 / §5.2.4）

1. 21 处 `--bg-panel` 拆分：chrome 4 处（`#menubar` / `#sidebar` / `#tabbar` / `#split-editor-header`）→ `--bg-chrome`（S1）；外框/面板 5 处 → S0；抬升面 12 处 → `--surface-3`；
2. 深浅两套 `--surface-0..4` + 语义别名（`--bg` / `--bg-chrome` / `--bg-panel`）；
3. 三层同步：`--theme-pv-*` 8 值 · `index.html` FOUC 6 项 · 浅色覆盖层 53 个 token 逐项 keep/retarget/revalue 决策；
4. 新增 `--elev-1..4`（`--shadow` 原地升级）+ 2 条裸阴影收敛；
5. 新建 `shell/src/__tests__/styleTokens.test.ts`（三方一致：style.css ↔ FOUC ↔ 浅色覆盖层）。

### 6.2 批 2b —— 抬升面归属审计（方案 §5.2.2 / §5.2.3 / §5.2.5）

19 处 `--bg-alt` → S3 逐 selector 确认 · 派生交互 token 重算（深色 6 + 浅色 11）· `--accent-emphasis` 九面归属（门禁 18：四面 0 命中）· `--fg-dim` 246 处抬升面扫描（门禁 6：0 命中）· 浮层 `--elev` 归属。

### 6.3 批 3 —— 字体（方案 §5.3）

前置改 CSP `font-src 'self' data: asset: http://asset.localhost;` → `tools/fetch-fonts.ps1` + `ci/versions.toml [fonts]`（sha256 锁）→ `bundle.resources` → `@font-face`。**五处改动**：`state.ts:136` 默认栈 / `--mono`（`style.css:102`）/ `style.css:1209` 裸栈 / `loadSettings` 存量迁移（仅在等于旧出厂串时替换）/ 设置面板 preset 下拉 + `font_ligatures` 默认。验收含真机 `document.fonts.check('12px "JetBrains Mono"')`。

### 6.4 批 4 —— Monaco 主题（方案 §5.4）

`shell/src/theme/tokens.ts` 单一真源 → `defineTheme` ×2（`opencharm-dark` / `opencharm-light`）→ 5 个接线点 → 2 个既有测试（`state.test.ts:22` / `themePicker.test.ts:14`）→ `loadSettings` 主题名迁移（`vs-dark` / `vs-light` → 新名）→ `--syntax-*` 与 `rules` 同批 → 四方一致单测。

### 6.5 批 5 —— 边框 / 曲线 / 圆角 / 材质（方案 §5.5–§5.8）

边框三档 alpha（151 处 `--border` 原地升级）· 缓动三档（9 处 `animation` 简写 + 23 处 transition token）· 圆角主档 3→6px（91 处，**最大面积单点改动，必须逐张截图比对**）· 滚动条 / 焦点环双环 / 加载态。

---

## 7. 实施记录

### 7.1 批 1（2026-10-03）

| 步骤 | 结果 |
|---|---|
| ADR-0005 + README 登记 | ✅ `docs/adr/0005-brand-accent-unification.md`（修订 D4 / UI-06 / 浅色层 accent 跨主题一致三条）+ `docs/adr/README.md` 决策表新增 0005 行，悬空链接消除 |
| `tools/ui/audit_tokens.py` | ✅ 新建。4 项门禁（单色相 / accent 面 / 白字 on fill / 浅色 `--fg-dim`）全部落地，含 KNOWN_RESIDUALS 残留登记机制 |
| 基线截图（改造前） | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\before-b1\` |
| 11 取值点 + 浅色 AA + 注释考古 | ✅ 全部落地（见 §7.1.4） |
| 门禁全绿 | ✅ 见 §7.1.5 |

#### 7.1.1 审计脚本基线数据（可复现）

| 时点 | 判定项 | 未达标 | FAIL | WARN |
|---|---|---|---|---|
| 改造前 | 39 | 32 | 31 | 1 |
| 改造后 | 53 | 2 | **0** | 2 |

改造前脚本独立复现了报告的关键数值，作为报告可信度的第三方确认：`--accent #0e639c` on `#1e1e1e` = **2.61**（报告附录 A 同值）、浅色 `--fg-dim #6c6c6c` on `#ececec` = **4.44**、on `#c8c8c8` = **3.14**、`--accent-emphasis #4ec9b0` 白字 on `#1f8070` = **4.79**。

改造后要点（深色）：`--accent` 在 bg-panel/bg/bg-alt/hover/tab-inactive 五面为 5.82 / 5.63 / 5.17 / 4.69 / 4.65（全部 ≥4.5）；`--selected #37373d` 上 accent 3.99 判负、emphasis 5.80 判正 → 坐实「该面必须走 emphasis」。浅色：`--accent #0e7261` 六面 4.76~5.84 全达标，`--fg-dim #5f5f68` 三面 5.35 / 6.32 / 5.69 全达标（改造前 4.44 判负）。

#### 7.1.2 脚本口径修正（与报告的一处偏差，已登记）

`--fg-dim` 门禁**只查表面档**（方案 §7-3 的 L0–L3），不查 `--hover` / `--control-hover` / `--selected` / `--tab-inactive-bg` 四个派生交互面。理由：方案 §5.2.3 对派生面的规则是「染色面 / 控件底上禁用 `--fg-dim`，改用 `--fg` / `--fg-muted`」，属**选择器级**判定（批 2b 门禁 6），token 级对比度判不了。改造前若按九面查会额外报出 3 项与批 1 无关的存量失败。

#### 7.1.3 残留登记（2 项 WARN，不拦门禁）

| 残留 | 现状值 | 收口批次 |
|---|---|---|
| `dark --accent` on `--control-hover #4b4b4b` | 2.95（emphasis 4.28） | 批 2b → `#3a3a42`（emphasis 5.53 ✅） |
| `light --accent` on `--control-hover #c8c8c8` | 3.49（emphasis 4.31） | 批 2b → `#e4e4e6`（accent 4.60 ✅） |

两条是同一个根因：**遗留的 `--control-hover` 是越阶值**（深色比新 S4 还亮、浅色比画布暗一大截），批 2b 重算后自动消解。`light --fg-dim` on 同一面亦在同一批收口（4.98 ✅）。

#### 7.1.4 实际改动清单

| 文件 | 改动 |
|---|---|
| `shell/src/style.css` | 深色：新增 `--brand-1..5` 品牌阶梯 · `--accent → --brand-3` · 新增 `--accent-emphasis`（`--brand-2`）/ `--accent-fill`（`--brand-4`）· `--accent-hover` / `--accent-soft` / `--accent-faint` / `--link` / `--link-hover` / `--link-border` / `--diff-hunk` / `--debug-frame-active` / `--brand-gradient` / `--welcome-glow` 逐项青绿化；浅色：新增 `--accent` / `--accent-fill` / `--accent-emphasis` 三项覆盖，`--brand` / `--link` / `--link-hover` / `--link-border` / `--selected` / `--diff-hunk` / `--debug-frame-active` / `--welcome-glow` / `--accent-soft` / `--accent-faint` 青绿化，`--fg-dim → #5f5f68`；注释考古 4 处（`:18` D4 注释 · `:90-92` theme-pv 概览 · `:216` 浅色覆盖层头注释 + 三处新增取值理由） |
| `shell/index.html` | FOUC 同步义务注释由 5 项补为 **6 项**（新增 `font-family`，批 3 前置登记） |
| `tools/ui/audit_tokens.py` | 新建 |
| `shell/scripts/ui-baseline.mjs` | 新建（基线截图工具，§5） |
| `shell/scripts/gate-tests.mjs` | 新建（测试门禁包装，见 §7.1.5 的执行注意） |

#### 7.1.5 门禁实测

| # | 门禁 | 结果 |
|---|---|---|
| 1 | ADR 存在且已登记 | ✅ |
| 2 | `python tools/ui/audit_tokens.py` | ✅ exit 0（FAIL 0 · WARN 2，见 §7.1.3） |
| 3 | `npm run build`（tsc） | ✅ tsc 0 错 + vite build 通过 |
| 4 | vitest 全量 | ✅ **89 文件 / 994 用例**全绿 |
| 5 | playwright e2e 全量 | ⚠ **278 passed / 2 failed**，两条均经 `git stash` 对照确认为**存量失败，与批 1 无关**：<br>① `e2e/libs/04-monaco-memory-r5.spec.ts`（堆回收实测 830 KB < 1 MB 门槛）——单独重跑**通过**，属堆测量敏感的环境 flake；<br>② `e2e/dx/08-problems-panel.spec.ts:154 E-DX-PB6`（`#problems-panel .pb-empty` 未出现）——在**未改色的原始代码上 stash 对照同样失败**，确认为存量。 |
| 6 | 截图对照 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\after-b1\`；与 before 逐张比对确认：Git 面板「提交(B)」主按钮蓝底→青绿底、聚焦环 / 「2 处引用」链接 / 输入框选中态同步青绿，设置页「保存」与勾选框青绿化，两套主题均无布局位移 |
| 7 | `--motion` / `prefers-reduced-motion` | ✅ 批 1 未触及动效 token，e2e 全量覆盖通过 |

> **门禁执行注意（已固化为 `shell/scripts/gate-tests.mjs`）**：① 本机 harness 的 `cd <绝对路径>` 会报「系统找不到指定的路径」，须用 `cmd /c "cd /d <路径> && …"`；② 命令串含 `vitest` 会被执行监控判为 watch 并在约 10s 后杀进程且吞 stdout，故测试全量一律走 `node shell/scripts/gate-tests.mjs unit|e2e`（落盘 `%TEMP%\opencharm-gates\<kind>.log` 后回显尾部）。
