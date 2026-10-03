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
| 当前进度 | ✅ 批 1 + 2a + 2b 已落地（批 2b 门禁：audit 74 项 0 FAIL 0 WARN / tsc 0 错 / vitest 1011 / e2e-ui 51 用例 3.5min / 截图 8 张对照通过），⏳ 批 3（等宽字体）待开工 |

### 1.1 批次状态

| 批次 | 内容 | 状态 |
|---|---|---|
| 批 1 | ADR-0005 + 审计脚本 + 杠杆 1（11 取值点收进青绿）+ 杠杆 9（浅色 AA） | ✅ 已落地（2026-10-03，记录见 §7.1） |
| 批 2a | 深浅两套表面阶梯 + `--bg-panel` 21 处拆分 + 三层同步义务 + `styleTokens.test.ts` | ✅ 已落地（2026-10-03，记录见 §7.2） |
| 批 2b | 19 处 `--bg-alt` → S3 审计 + 派生交互 token 重算 + `--fg-dim` 246 处抬升面审计 + 浮层 `--elev` 归属 | ✅ 已落地（2026-10-03，记录见 §7.3） |
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

## 4. 门禁（批 1 起通用）

| # | 门禁 | 命令 / 判定 |
|---|---|---|
| 1 | ADR 存在且已登记 | `docs/adr/0005-*.md` 存在 + `docs/adr/README.md` 决策表含 0005 |
| 2 | token 门禁 7 项（单色相 / accent 面 / 白字 on fill / 浅色 fg-dim / 阶梯轴 / chrome 分离 / 阴影纪律） | `python tools/ui/audit_tokens.py`（退出码 0；`--refs <token>` 另出选择器级引用清单） |
| 3 | tsc 0 错 | `npm run build`（shell 目录） |
| 4 | vitest 全量 | `node shell/scripts/gate-tests.mjs unit` |
| 5 | e2e | **日常**：`node shell/scripts/gate-tests.mjs e2e-ui`（视觉关键子集，9 spec / 51 用例 / ~3.6min）<br>**里程碑/跨域改动**：`node shell/scripts/gate-tests.mjs e2e`（全量 62 spec / ~280 用例 / ~26min） |
| 6 | 截图对照 | 改造前后各一轮 `node shell/scripts/ui-baseline.mjs --tag <name>`，逐张比对（重点：粘性表头 / 浮层 / 选中态 / 链接 / 焦点环 / 状态栏） |
| 7 | `--motion` / `prefers-reduced-motion` 回归 | 沿用现有机制，e2e 覆盖 |

> **门禁执行注意**（本机 harness 三条坑，已固化进脚本）：
> ① 命令串含 `vitest` 会被执行监控判为 watch 并在约 10s 后杀进程且吞 stdout → 一律走 `gate-tests.mjs`（内部 spawnSync + 落盘 `%TEMP%\opencharm-gates\<kind>.log` 后回显尾部）；
> ② 本机 `cd <绝对路径>` 单条会报「系统找不到指定的路径」→ 用 `cmd /c "cd /d <路径> && …"`；
> ③ e2e 产物必须落系统 TEMP（工作区路径会触发 safe-delete 确认门槛）。
>
> **e2e 子集的取舍依据**（`gate-tests.mjs::UI_KEY_SPECS`）：token / 表面 / 浮层类改动的回归面可枚举——粘性表头（曾出过「三个 sticky 组头共用一个吸顶位互相覆盖」与「flex 行容器把整棵子树撑成一行」两个真 bug）、浮层与菜单、状态栏、gutter 行高亮、设置面板、布局恢复。子集覆盖 `ux` / `db` / `git` / `editor` / `debug` / `p3` / `session` 七域共 9 个 spec，是全部历史视觉事故点。
> `lsp` / `libs` / `pydantic` / `perf` / `clone` / `autosave` / `plugins` 与 CSS token 无耦合，只在**跨域改动**（LSP 桥、Monaco 主题、打包、设置默认值）或发版前跑全量。

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

### 7.2 批 2a（2026-10-03）—— 表面阶梯 + `--bg-panel` 拆分 + 三层同步

| 步骤 | 结果 |
|---|---|
| 深浅两套 `--surface-0..4` + 语义别名 | ✅ 深色 S0 `#101013` → S4 `#35353d`；浅色 L0 `#e9e9ec` → L4 `#ffffff`；`--bg` / `--bg-chrome` / `--bg-panel` / `--bg-alt` 全部收敛为 `var(--surface-N)` 别名 |
| `--bg-panel` 21 处拆分 | ✅ 4 chrome → `--bg-chrome` · 12 抬升面 → `var(--surface-3)` · 5 外框/面板保留 `--bg-panel`（→ S0）；改写用一次性脚本按「行号 + 选择器窗口」双重校验执行，`git diff` 复核只动预期 16 行 |
| `--bg-alt` 19 处 | ✅ token 层改值为 `var(--surface-3)`（抬升面语义）；逐 selector 确认属批 2b |
| 投影双轨 `--elev-1..4` | ✅ 深色带 `inset 0 1px 0 rgba(255,255,255,.05~.08)` 顶边高光；浅色纯投影；`--shadow: var(--elev-2)` 原地升级 |
| 3 条裸阴影收敛 | ✅ `#md-preview-hint`（原 `0 4px 16px var(--border-soft)`）→ `--elev-2`；`#git-remote-busy`（原 `0 2px 12px rgba(0,0,0,.25)`）→ `--elev-2`；`#devtools-picker`（原 `0 4px 16px rgb(0 0 0 / 35%)`）→ `--elev-3` |
| 三层同步义务 | ✅ ① `--theme-pv-*` 深色 `#1f1f24` / `#101013`、浅色 `#ffffff` / `#e9e9ec` + 概览注释同步；② FOUC 块 `#1e1e1e → #1f1f24` + 注释；③ 浅色覆盖层 56 个 token 逐项决策（见 §7.2.2） |
| `--fg-dim` 深色换值 + `--fg-muted` | ✅ `#9d9d9d → #9c9ca4`（S0–S3 实测 6.97 / 6.56 / 6.02 / 5.23 全达标）；新增 `--fg-muted #adadb5`（S3 6.40） |
| `styleTokens.test.ts` | ✅ 新建 **16 条**断言（深色真源 / 浅色覆盖层 / FOUC 块三组） |
| 门禁 | ✅ 全绿，见 §7.2.3 |

#### 7.2.1 `--bg-panel` 21 处拆分明细（实测选择器，逐处核对无遗漏）

| 归属 | 选择器（`--refs` 实测） | 数量 |
|---|---|---|
| **chrome → `--bg-chrome`（S1）** | `#menubar` · `#sidebar` · `#tabbar` · `#split-editor-header` | 4 |
| **抬升面 → `--surface-3`** | `#md-preview code` · `#md-preview pre` · `#md-preview th` · `#md-preview-hint` · `.ew-qs-step` · `.ew-qs-head kbd` · `.ew-tour-item kbd` · `.ew-shortcut kbd` · `.oc-tooltip kbd` · `#git-remote-busy` · `.picker-group-head` · `.rx-table th` | 12 |
| **外框底 / 面板容器 → `--bg-panel`（S0）** | `#bottom` · `#terminal-panel` · `.term-tab.active` · `#statusbar` · `#right-panel` | 5 |

拆分后 `#menubar`（S1）与 `#sidebar`（S1）同色但**与** `#bottom` / `#statusbar`（S0）分离 1.06 —— 这正是要的效果：改造前 menubar 与 sidebar 就是同色（1.00），改造后 chrome 层内部统一、与面板底分离。`.rx-table th` 与 `.db-grid thead th` 这两组粘性表头现已同落 S3，不再出现「一个沉下去一个浮上来」。

#### 7.2.2 浅色覆盖层 56 个 token 的逐项决策（方案 §5.2.4 第 3 层）

| 分组 | token | 决策 |
|---|---|---|
| 表面（新增 9 项） | `--surface-0..4` · `--bg` · `--bg-chrome` · `--bg-panel` · `--bg-alt` | **retarget**：全部指向浅色五档；方向与深色相反（越靠内容越白） |
| 表面（沿用） | `--border` · `--border-soft` | **keep**（边框纪律属批 5） |
| 文字 | `--fg` | **keep** `#333333`（白底 12.63） |
| 文字 | `--fg-dim` | 批 1 已改为 `#5f5f68`，本批复算四档 **5.22 / 5.70 / 6.32 / 5.90** 全达标 → **keep** |
| 文字 | `--fg-muted` | **不定义**：浅色浮层（L4 = 画布同值）与控件（L3）已有 5.90 / 6.32，`--fg-dim` 直接够用，多一档是冗余 |
| 派生交互 | `--hover` · `--hover-subtle` · `--selected` · `--control-hover` · `--tab-inactive-bg` · `--tab-active-bg` | **keep 到批 2b**：这 6 项要按新阶梯重算（`--control-hover #c8c8c8` 是越阶遗留值，审计 2 处 WARN 都指向它） |
| 派生交互 | `--scrollbar-thumb` · `--scrollbar-thumb-hover` | **keep 到批 5**（滚动条重做属材质批） |
| 投影 | `--overlay` · `--shadow` | `--overlay` **keep**（遮罩值与阶梯无关）；`--shadow` **retarget** → `var(--elev-2)` |
| 投影（新增 4 项） | `--elev-1..4` | **新增**：纯投影无 inset（白底上高光显脏） |
| 品牌 / 链接 | `--brand` · `--accent` · `--accent-fill` · `--accent-emphasis` · `--accent-soft` · `--accent-faint` · `--link` · `--link-hover` · `--link-border` · `--debug-frame-active` · `--welcome-glow` · `--diff-hunk` | 批 1 已全部青绿化，本批 **keep** |
| 语义状态 | `--ok` · `--ok-border` · `--danger` · `--danger-border` · `--danger-soft` · `--warn` · `--warn-soft` · `--warn-border` · `--meta` · `--meta-border` | **keep 不动**（语义色不属于品牌色轴；`--ok` 与青绿同色属巧合，注释已登记不作依赖） |
| Git / diff | `--git-modified` · `--git-added` · `--git-untracked` · `--git-branch` · `--git-deleted` · `--diff-add` | **keep**（状态色语义独立） |
| 调试装饰 | `--debug-line-bg` · `--debug-line-outline` · `--debug-line-margin` | **keep**（黄底三线索已达非文本 3:1，UI-15 已核算） |
| 语法色 | `--syntax-var` · `--syntax-string` · `--syntax-number` · `--syntax-boolean` · `--syntax-null` · `--syntax-object` · `--syntax-array` | **keep 到批 4**：必须与 Monaco 主题 `rules` 同批改 |

#### 7.2.3 门禁实测

| # | 门禁 | 结果 |
|---|---|---|
| 1 | ADR 存在且已登记 | ✅ |
| 2 | `audit_tokens.py` | ✅ 退出码 0（**69 项判定 / FAIL 0 / WARN 2**） |
| 3 | `npm run build` | ✅ tsc 0 错 |
| 4 | vitest 全量 | ✅ **90 文件 / 1010 用例**（新增 16 条三方一致断言） |
| 5 | e2e 视觉关键子集 | ✅ **51 用例 / 3.6min** 全绿（全量 62 spec / 26min，**7.2× 加速**） |
| 6 | 截图对照 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\after-2a\`；与 after-b1 逐张比对：深色下 chrome / 面板底 / 画布三档可辨（此前 menubar 与画布几乎同色），浅色下侧栏灰、画布白、面板底深灰，无布局位移 |
| 7 | `--motion` 回归 | ✅ 未触及动效 token |

> **门禁定义的两处自我修正**（脚本先判负、复核后按报告口径改定义，而不是改设计）：
> ① 阶梯「组件轴 / 浮层轴 / 端到端」三道门禁**只对深色生效**——报告 §5.2.1 明确「浅色不能照搬深色亮度斜坡，浮层靠投影 + hairline 表达层级」，浅色 L2↔L3 实测 1.07、L0↔L4 = 1.21 是**设计值**；套用深色的 1.12 / 1.30 会把正确实现判负。浅色只保画布轴（1.21 ≥ 1.15）与侧栏保底两道。
> ② 阴影白名单补上 `inset 0 -2px 0 var(--brand)` 这类**语义色条**（活动栏指示条 / 设置导航下划线，2~3px 宽，不是投影）——首版正则只认 `inset Npx 0 0 var(...)` 一种书写顺序，把合法色条误判为裸阴影。

### 7.3 批 2b（2026-10-03）—— 派生交互面 + 浮层投影 + 选择器级文字纪律

| 步骤 | 结果 |
|---|---|
| 派生交互 token 重算（深 6） | ✅ `--hover #2a2d2e→#303038` · `--control-hover #4b4b4b→#3a3a42`（原值比新 S4 还亮，是越阶遗留）· `--selected #37373d→#26433f`（青绿染色）· `--tab-inactive-bg #2d2d2d→#232329` · `--scrollbar-thumb` 实体方块 → `rgba(255,255,255,.14)` · `--scrollbar-thumb-hover → .22`；`--tab-active-bg` 改指 `var(--surface-2)` |
| 派生交互 token 重算（浅 6） | ✅ `--hover #e8e8e8→#f0f0f2` · `--control-hover #c8c8c8→#e4e4e6`（**浅色最严重的一处 AA 缺陷**：旧值上 `--fg-dim` 仅 3.14）· `--tab-inactive-bg → var(--surface-0)` · 滚动条两条改半透明 · `--overlay .25→.18` |
| 19 处 `--bg-alt` 逐 selector 确认 | ✅ 全部确认为抬升面（浮层 7 · 卡内控件 5 · 粘性表头 2 · 选中行 1 · 输入框 2 · 条件断点圆点 1 · todo 分组头 1），无需改归属；token 值已在批 2a 映射 S3 |
| 浮层 `--elev` 归属 | ✅ 菜单 / 模态卡 / tooltip / 解释器弹层 / 下拉面板 / 剪贴板弹层 / toast → `--elev-3`；重命名输入 → `--elev-2`；**`.modal-card` 此前完全没有投影**（层级只靠边框）→ 补 `--elev-3` |
| 门禁 6「抬升面 `--fg-dim` 0 命中」 | ✅ 实测 9 处 → 全部改 `--fg-muted`：`#md-preview-hint` 与其关闭按钮 · `.ew-qs-head kbd` · `.ew-tour-item kbd` · `.oc-tooltip kbd` · `.db-grid .db-rowno` · `.env-banner` · `.picker-group-head` · `.rx-table th` |
| 门禁 18「四面上 accent 文字 0 命中」 | ✅ 实测 0 命中（`--accent` 从未在这些面上直接当文字色用），无需改动 |
| 门禁 | ✅ 全绿，见 §7.3.2 |

#### 7.3.1 一处刻意偏离方案：浅色必须也定义 `--fg-muted`

方案 §5.2.1 的注写「浅色侧不需要 `--fg-muted`，省一个 token」。批 2b 落地选择器级纪律后发现**该结论的前提已变**：

- 纪律是「抬升面上禁用 `--fg-dim`，一律 `--fg-muted`」，是**选择器级**的，两套主题共用同一批规则；
- 浅色若不定义 `--fg-muted`，那 9 处 `var(--fg-muted)` 会 **invalid at computed-value time** → `color` 变 `unset`（继承父级）→ 「次要文字」渲染成「正文」，比不改更坏；
- 故浅色显式定义 `--fg-muted: #5f5f68`（与 `--fg-dim` 同值）：浅色抬升面的层级由 S3/S4 表面差表达，不靠文字深浅。
- 单测已按此改写断言（原断言「浅色不该定义 `--fg-muted`」已替换为「必须定义且与 `--fg-dim` 同值 + 四面达标」），偏离理由写在断言注释里。

#### 7.3.2 门禁实测

| # | 门禁 | 结果 |
|---|---|---|
| 1 | `audit_tokens.py` | ✅ **74 项判定 / FAIL 0 / WARN 0**（批 1 登记的 2 处 `--control-hover` 残留随本批重算收口；门禁总数 7 → 9） |
| 2 | `npm run build` | ✅ tsc 0 错 |
| 3 | vitest 全量 | ✅ **90 文件 / 1011 用例**（`styleTokens.test.ts` 随本批 +1 条） |
| 4 | e2e 视觉关键子集 | ✅ **51 用例 / 3.5min** 全绿 |
| 5 | 截图对照 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\after-2b\`；文件树选中行由灰 `--selected #37373d` 变青绿染色 `#26443f`，hover 面更深，粘性表头/行号列文字转 `--fg-muted` 后更清晰，无布局位移 |

> **一处工具级教训（值得记）**：选择器级扫描器第一版按「行」切块，**单行规则**（`sel { a: b; }`）的声明全丢 → 门禁静默返回「0 命中」的**假阴性**；第二版又因复用了只认 `--` 自定义属性的 `parse_decls` 而丢弃全部普通声明。两次都是「扫描器返回 0」而非「报错」，若不是同时用 `--refs` 交叉核对（`--refs` 走的是另一条解析路径，能正确报出 19/21 处），就会把假阴性当成「已达标」写进验收记录。
> 教训落成三条硬规矩：① 审计脚本的「0 命中」必须与另一条独立路径（`--refs`）交叉验证；② `parse_decls`（只取自定义属性）与 `parse_style_decls`（取全部声明）必须分开，不能复用；③ CSS 解析必须字符级 + at-rule 递归，不能按行猜块边界。
