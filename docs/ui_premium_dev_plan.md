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
| 当前进度 | ✅ 批 1 + 2a + 2b + 3 + 4 + 5a + 5b 已落地（批 5b 门禁：audit **90 项** 0 FAIL 0 WARN / tsc 0 错 / vitest 92 文件 1064 用例 / e2e-ui 53 passed + 8 failed 存量 / 截图 8 张），⏳ 批 5c（圆角 3→6px，141 处）待开工 |

### 1.1 批次状态

| 批次 | 内容 | 状态 |
|---|---|---|
| 批 1 | ADR-0005 + 审计脚本 + 杠杆 1（11 取值点收进青绿）+ 杠杆 9（浅色 AA） | ✅ 已落地（2026-10-03，记录见 §7.1） |
| 批 2a | 深浅两套表面阶梯 + `--bg-panel` 21 处拆分 + 三层同步义务 + `styleTokens.test.ts` | ✅ 已落地（2026-10-03，记录见 §7.2） |
| 批 2b | 19 处 `--bg-alt` → S3 审计 + 派生交互 token 重算 + `--fg-dim` 246 处抬升面审计 + 浮层 `--elev` 归属 | ✅ 已落地（2026-10-03，记录见 §7.3） |
| 批 3 | 等宽字体五处改动 + JetBrains Mono 随包（**落地路径已修订为 `public/fonts/` 入库**，见 §7.4.1） | ✅ 已落地（2026-10-03，记录见 §7.4） |
| 批 4 | Monaco 自定义主题 `opencharm-dark/light` + `--syntax-*` 与 `rules` 同批 | ✅ 已落地（2026-10-03，记录见 §7.5） |
| 批 5 | 边框三档 alpha（**只换值 + 重点提升**，§6.5）· 圆角档位 3→6px（**最大面积单点改动**，§6.5） | ⏳ 5a ✅（§7.6）· 5b ✅（§7.7）· 5c ⏳ 待开工 |

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

### 6.3 批 3 —— 字体（方案 §5.3）✅ 已落地

**原路径（已否决，见 §7.4.1）**：改 CSP `font-src` + `vendor/fonts/` + `bundle.resources` + `@font-face` —— 在 `@font-face` 场景下走不通（资源目录不由前端协议服务 / `assetProtocol.scope` 为空 / dev 下 404 断掉门禁链）。

**实际路径**：`ci/versions.toml [fonts]`（version + tarball + 5 个 sha256 锁）→ `tools/fetch-fonts.ps1`（幂等，`-Force` 重拉；依赖 `tar.exe`）→ `shell/public/fonts/`（**入库**，75.4 KB，含 `OFL.txt`）→ `style.css` 4 条 `@font-face`（`/fonts/…` 绝对路径）→ **CSP 零改动**。

**五处改动**：`state.ts` `DEFAULT_FONT_FAMILY` / `settings.rs Settings::default` / `style.css --mono` / `index.html` 字体族 preset 首选项 / `loadSettings::migrateLegacyFontSettings`（仅在等于旧出厂串时替换）；外加 `font_ligatures` 出厂 `true`（前后端 + 两处测试同步）、`ensureEditorFontLoaded()`（建编辑器前等字体，带 1.5s 超时）、6 处 `--font-mono` 收口、`--font-ui` token 坐实。验收由 `ui-baseline.mjs --probe-fonts` + `e2e/editor/10-font-family.spec.ts` + `fontStack.test.ts`（四方一致 15 条）承担。

### 6.4 批 4 —— Monaco 主题（方案 §5.4）✅ 已落地

`shell/src/theme/tokens.ts` 单一真源 → `defineTheme` ×2（`opencharm-dark` / `opencharm-light`）→ 接线点 → 既有测试（`state.test.ts` / `themePicker.test.ts`）→ `loadSettings` 主题名迁移（`vs-dark` / `vs` → 新名）→ `--syntax-*` 与 `rules` 同批 → 四方一致单测。

**落地时修订三处**（详见 §7.5）：① 色值真源仍是 `style.css`，`tokens.ts` **零色值**只有映射表（拍板）；② 存量浅色名是 `"vs"` 而非方案写的 `"vs-light"`，迁移表补第三个串；③ 接线点由 5 处增至 **7 处**（方案漏了 `applyShellTheme` 与 `terminal.ts` 两处 `=== "vs"` 判定）。

### 6.5 批 5 —— 边框 / 曲线 / 圆角 / 材质（方案 §5.5–§5.8）

**拆三批**（2026-10-03 拍板，理由：四个杠杆的视觉影响叠加后截图无法区分回归来源，且任一杠杆出问题需能单独回滚）：

| 子批 | 内容 | 状态 |
|---|---|---|
| **5a** | 缓动曲线分级（`--ease-*` 三档 + 4 个时长档，14 处收口）· 焦点环双环（4 处外扩改双环 + `--focus-gap`）· 进度条 reduce-motion 双通道补齐 · 滚动条 10→8px | ✅ 已落地（2026-10-03，记录见 §7.6） |
| **5b** | 边框三档 alpha：**只换值 + 重点提升**（拍板）→ **落地时调研推翻了「重点提升」的前提**：`--border-strong` 定义但不使用，浮层 4 容器改 hairline（见 §7.7.1） | ✅ 已落地（2026-10-03，记录见 §7.7） |
| **5c** | 圆角档位：`--radius-sm` 3→6px（md 8 / lg 10 / xl 16），**最大面积单点改动，逐张截图比对** | ⏳ 待开工 |

> **5a 明确不做的两条**（附理由，避免后人当漏做）：
> ① **加载态**（方案 §5.8「加 `stroke-linecap: round` 的旋转弧」）——codicon 是**字体图标**不是 SVG，`stroke-linecap` 对它无效；其「避免文字跳动」的真实成因是 `runWidget.ts:157-168` 在忙碌时把图标类从 `codicon-run`（▶）换成 `codicon-loading`（⟳），两个字形宽度不同导致按钮宽度变化。修它需改 `runWidget` 的尺寸稳定化，与本批收益不成比例，登记为技术债。
> ② **换图标集**（方案 §5.8 中长期项）——工作量大且会破坏「外壳与 Monaco 都用 codicon」的观感一致性评估基线，方案本身也判定为「短期接受」。

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

### 7.4 批 3（2026-10-03）—— 随包等宽字体（JetBrains Mono）

#### 7.4.1 落地路径修订：方案 §5.3-3b 的 `bundle.resources` 路线在 `@font-face` 上走不通

方案原文要求「改 CSP `font-src` → `vendor/fonts/` + `bundle.resources` 入包 → `@font-face` 引用」。逐字核实 `tauri.conf.json` 与 `dap.rs:78-114` 后判定该路线不可行，已改走 `shell/public/fonts/` 入库：

| # | 方案原文路线的硬伤 | 证据 |
|---|---|---|
| 1 | `bundle.resources` 的文件在**安装目录资源根**，由 Rust 走文件系统路径读取（`resource_candidates` 四级查找全是路径拼接），**前端协议不服务该目录** → prod 下 `/fonts/x.woff2` 直接 404 | `dap.rs:95-103`（debugpy 同款机制能 work 的原因就在这里：它不经 URL） |
| 2 | 改走 asset 协议需同时改 `assetProtocol.scope`（当前 `[]` = **全禁**，只改 CSP 无效），且 asset URL 形如 `asset://localhost/C:/Users/<user>/AppData/.../fonts/x.woff2` —— **安装路径含用户名，CSS 里写不出来**，只能运行时 `convertFileSrc` 拼装，与「字体栈单一真源」直接冲突 | `tauri.conf.json:16`（`"scope": []`） |
| 3 | `bundle.resources` 对 `vite dev` 不可见 → dev 下恒 404，而**单测 / e2e / 基线截图门禁链全部跑在 dev 上**，方案等于把门禁链打断 | `playwright.config.ts:26-31`（`reuseExistingServer`，跑 dev） |
| 4 | CSP 那一步其实**不需要**：`public/` 下字体与前端 bundle 同源，`font-src 'self' data:` 已足够 | — |

改走 `public/` 后：dev 与 prod 同为 `'self'` 相对 URL、CSP 零改动、门禁链完整。仍保留 `tools/fetch-fonts.ps1` + `ci/versions.toml [fonts]` sha256 锁——为的是**升级受控与可复现**（换版本必过锁值比对），不是防仓库膨胀（4 个子集共 75 KB，vs debugpy 20 MB，「不入库」的理由不成立）。

#### 7.4.2 上游取源变更：GitHub Release CDN 不可达，改走 npm 官方镜像

`JetBrainsMono-2.304.zip`（github.com/…/releases/download）直连 **0 字节 + `curl (56) Recv failure: Connection was reset`**（`api.github.com` 可通，Release CDN 不可通）。改用 JetBrains 官方 npm 分发镜像 `@fontsource/jetbrains-mono@5.3.0`（对应上游 JetBrains Mono v2.304），4 个 woff2 子集 + `OFL.txt` 经 `tar` 解包（PS 5.1 的 `System.IO.Compression` 无 tar reader，故脚本依赖 Windows 10 1803+ 自带的 `tar.exe`）。

取的 4 个子集（`latin-400-normal` / `latin-400-italic` / `latin-700-normal` / `latin-ext-400-normal`，共 75.4 KB）：**真斜体**（Monaco 默认注释是 italic，合成斜体在等宽字体上明显歪）、**真粗体**（合成粗体几乎不可读）、拉丁扩展（欧洲语言注释）。不含 CJK —— 中文注释回退系统字体，这是等宽栈的正常行为。

#### 7.4.3 方案未覆盖的时序问题：Monaco 建编辑器前必须等字体（否则网格错位）

Monaco 用 canvas `measureText` 测字符宽度并缓存（`CharConfig`），字体异步到位后实测宽度与缓存不符 → **网格与光标列整体错位**，且 0.52 **不会自动重测**。`font-display: swap` 下浏览器先画回退字体再交换，不等就是这个窗口。故在 `init()` 的 `loadSettings()` 与 `editor.create()` 之间插入 `await ensureEditorFontLoaded()`（`settingsPanel.ts`，函数内含 1.5s 超时兜底——字体是渐进增强，任何情况下都不该拦住编辑器创建）。实测本地 4 个 woff2 共 75 KB，`document.fonts.load` 约 8ms。

#### 7.4.4 顺带收口两处既有缺陷（方案未提）

| # | 缺陷 | 处置 |
|---|---|---|
| 1 | **`--font-mono` 从未定义**：6 处 `var(--font-mono, monospace)` 静默回落到浏览器默认 `monospace`（等宽但不是设计字体），其中 `.clone-progress-text` 是 `var(--font-mono)` **无 fallback** → 自定义属性未定义时**整条 font-family 失效**（不是回落 monospace），克隆进度文本一直没拿到等宽字体 | 6 处全部收口到 `var(--mono)`（含无 fallback 那处） |
| 2 | **`--font-ui` 从未存在**：body 与 FOUC 块各写一份裸栈，而 FOUC 块注释把它列为第 6 项同步项（悬空引用） | 新增 `--font-ui` token 并让 body 走它；FOUC 块值**未变**（UI 字体刻意不随包），注释改为说明「已核对、值未变」 |

另：方案 §5.3-3c 的 `tabular-nums` 列为「新增」，实测项目**已贯彻 8 处**（`.db-num` / `.storage-size` / `.history-time` / `.oc-cv-row-loc` 等），本批不重复加；3c 的 `font-optical-sizing` 未加（Segoe UI 非可变字体，该声明无意义，与方案已删 cv05/ss03 同理）。

#### 7.4.5 连字范围刻意收窄（偏离方案，已登记）

方案 §5.3-3c 写 `.mono, [class*="-mono"], pre, code` 全局生效。本批**只开在 `#md-preview code` / `#md-preview pre`**，理由：① 项目**无 `.mono` 类**（该选择器无对象）；② 输出面板 / 终端 / 搜索命中的等宽文本是**日志与命令输出**，连字把 `->` `=>` 变形会妨碍逐字比对。Monaco 侧由 `settings.font_ligatures` 控制（批 3 起**出厂 true**，拍板决定）。

#### 7.4.6 存量迁移

`settings.json` 的 `font_family` 已固化为旧出厂串，**不迁移则随包字体对老用户 100% 无效**（`--mono` 只管外壳，编辑器走 `settings.font_family`）。新增 `state.ts::migrateLegacyFontSettings`：**仅当等于旧出厂串时替换**，用户自定义值一律保留；只改内存不落盘（下次点「保存」自然写回，每次启动重跑幂等）。放在 `state.ts` 而非 `settingsPanel.ts` —— 纯数据规则，不该让它的单测拖入面板的整条 Tauri 依赖链。

#### 7.4.7 门禁实测

| # | 门禁 | 结果 |
|---|---|---|
| 1 | `audit_tokens.py` | ✅ **74 项判定 / FAIL 0 / WARN 0**（字体改动不涉色值门禁） |
| 2 | `npm run build`（tsc） | ✅ 0 错 |
| 3 | vitest 全量 | ✅ **91 文件 / 1026 用例**（新增 `fontStack.test.ts` **15 条**：四方字面一致 / @font-face 4 条 face 与 woff2 存在 / OFL 随包 / 迁移 5 条 / body 走 token / 无旧裸栈残留） |
| 4 | `cargo test settings::` | ✅ **3 passed**（`test_defaults` 与「旧配置缺字段回落」两处断言同步改） |
| 5 | e2e 视觉关键子集 | ✅ **53 用例 / 3.7min** 全绿（新增 `e2e/editor/10-font-family.spec.ts` 2 条，已登记进 `UI_KEY_SPECS`） |
| 6 | 截图对照 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\after-b3\`；`->` / `=>` 已合成为单符（连字可见），`0` 带斜杠、`l` 带尾钩（JetBrains Mono 字形），无布局位移 |
| 7 | **字体实测**（方案 §5.3-3b 第 5 步「这一步不做等于没做」） | ✅ 由 `ui-baseline.mjs --probe-fonts` 固化为脚本门禁：4 个 woff2 全 **200 / font/woff2**（3–6ms）· `document.fonts.load` **8ms resolve** · `document.fonts.check('14px "JetBrains Mono"')` **true** · `--mono` token 与外壳 computed 一致 · e2e 侧 `.view-lines` 的 computed `font-family` **含 JetBrains Mono**（Monaco 不读 CSS，这是「编辑器真用上了」的唯一权威证据） |

#### 7.4.8 工具级教训两则（值得记）

> **其一：e2e 报「编辑器尚未初始化」不等于编辑器没创建。** 本批首次跑 e2e-ui 出现 8 项失败（E-BASIC-1..4 / S-1 / S-2 / UX-1 / UX-9），错误统一是 `app.editor` 抛「尚未初始化」。逐层排查（`initStep` 打点 → `editor.create` 返回值 → 模块实例比对）才定位到：那 8 个用例用 `await import("/src/state.ts")` 取 `app`，而**长时间运行的 vite dev 在我改动 `state.ts` 后重建了模块图**，页面拿到的是**另一份模块实例**（其 `_editor` 恒为 null）；`editor.create` 实际早已返回正常对象。杀掉 vite 进程后 e2e-ui 立刻 **51/51 全绿**。教训：① 诊断「实例未初始化」类问题必须先证伪「同一模块实例」这个前提（比对 `app.workspaceRoot` / `app.tabs` 这类被 init 填过的字段最快）；② e2e 断言应用内部状态时，**读 DOM 比读模块实例稳**（本批新增的字体 e2e 因此全部走 computed style）；③ 长时间运行的 vite dev 是 e2e 的隐性依赖源，**e2e 报出成片的编辑器类失败时，第一动作是重启 vite**。

> **其二：`ui-baseline.mjs` 的探针模式不宜对「编辑器就绪」设门禁。** 该脚本的 `makeBridge` 只实现「UI 渲染必需」通道（没有 `lsp`），`init()` 会停在 `await startLsp()`，编辑器根本没到创建那一步——**与字体无关**。故 `--probe-fonts` 的门禁只覆盖字体项（可达性 / MIME / `fonts.check` / token），编辑器就绪降为提示；Monaco 侧证据由 e2e（编辑器就绪后可用）与截图承担。附带的 monaco 预热逻辑保留（冷启动时它确实要几十秒）。

### 7.5 批 4（2026-10-03）—— Monaco 自定义主题

改造前编辑器跑 Monaco 出厂 `vs-dark` / `vs`，与外壳 token 系统不同源——占屏 60–70% 的颜色全部来自出厂主题，是「拼装感」的最大来源。

#### 7.5.1 真源形态修订：CSS 仍是唯一真源，`tokens.ts` 零色值

方案 §5.4 写「`theme/tokens.ts` 是 CSS 与 Monaco 的**单一真源**」。但批 2a/2b 已把外壳 token 落在 `style.css`，并配了三层同步义务（`styleTokens.test.ts` 的断言、`index.html` 的 FOUC 内联兜底块、`index.html` 头部的同步项清单）。若再把色值抄一份进 TS，就出现**第二套真值**：改 style.css 不动 Monaco、改 TS 不动外壳，两套漂移后**任何静态门禁都发现不了**（两边的值都是合法颜色，`audit_tokens.py` 与单测都无从报警）。

**拍板落地**：`shell/src/theme/tokens.ts` 只声明「Monaco 槽位 → CSS 变量」的映射表，色值在 `defineTheme` 时经 `getComputedStyle` 现读。由此得到一个额外收益：**深浅两套共用同一份映射**，差异全落在 CSS 的 `[data-theme="light"]` 覆盖层里——切主题只需切 `data-theme` 后重新注册，映射表永不重复。

#### 7.5.2 方案与实际不符的三处

| # | 方案原文 | 实际 | 处置 |
|---|---|---|---|
| 1 | 迁移 `vs-dark` / `vs-light` | 存量浅色值是 **`"vs"`**（`themePicker` 候选 / `applyShellTheme` / `terminal.ts` 三处都是它；`vs-light` 从未在本仓库出现） | 迁移表覆盖 `vs-dark` / `vs` / `vs-light` **三个串**。照抄方案会漏掉唯一那个真实存量值 |
| 2 | 接线点 **5 处** | **7 处** | 方案把 `applyShellTheme` 归为「值域不变、无需改」，但它硬编码了 `theme === "vs"` 判定 data-theme；`terminal.ts:18` 同样。主题改名后这两处漏改 → 外壳浅色 / 终端深色的「半深半浅」界面，**不报任何错** |
| 3 | `monaco.ts` 动作 =「遍历 `editorTheme` 调 `defineTheme`」 | 因真源形态修订，变为「读 CSS 变量 → 重注册 → `setTheme`」 | 由此引入**顺序约束**，见 §7.5.3 |

#### 7.5.3 本批引入的新约束：注册顺序不可调换（方案未提）

Monaco 主题的色值是**注册那一刻从 CSS 变量读到的快照**。故凡「先切 `data-theme` 再上编辑器」的路径都必须**重新注册**：

- `settingsPanel` 保存路径原本是 `setTheme(theme)` 在前、`applyShellTheme(theme)` 在后。批 4 必须调换，否则编辑器会拿到**上一套主题的表面色**——症状是「切到浅色后编辑器背景仍是深灰」，且因为 token 色也恰好错成深色值，contrast 检查也发现不了。
- `markdownPreview` 导出 HTML 需要临时切浅色再 colorize。恢复路径收在 `monaco.ts::withEditorTheme` 内部（`finally` 里 **data-theme 与 Monaco 主题成对恢复**——只恢复其一会让下一次注册读到错的快照）。

#### 7.5.4 新增 token 1 个：`--editor-line-highlight`

`editor.lineHighlightBackground` 需要**实色**（Monaco 直接拿它当背景填），而 `--indent-guide` 是半透明白（叠在画布上才成型）——套过去等于没画。取值锚定批 2a 阶梯：深 `#242429`（落在 S2 `#1f1f24` 与 S3 `#2a2a30` 之间，vs 画布 **1.13**，与 VS Code 原生当前行几乎同强度）；浅 `#f0f0f2`（白底 1.138）。刻意**不用** `--hover`（1.25）：整行底色比悬停行还重，层级反了。

#### 7.5.5 语法色：var 转青绿、boolean 转紫（拍板）

7 个 `--syntax-*` 里唯二偏蓝的两项与 Monaco `rules` 同批改，其余 5 个（string 橙 / number 绿 / null 灰 / object 黄 / array 橙）**本就不偏蓝，未动**——多色相是 token 区分度的功能需求，不连坐。

| token | 旧值 | 新值（深 / 浅） | 对比度 |
|---|---|---|---|
| `--syntax-var` | `#9cdcfe` 浅蓝 / `#001080` 深蓝 | `#7ce3cd` 青绿（= `--brand-1`）/ `#0e7261`（= 浅色 `--accent`） | S2 **10.77** / 白底 **5.84** ✅ |
| `--syntax-boolean` | `#569cd6` 蓝 / `#0000ff` 纯蓝 | `#c586c0` 紫（= `--meta`）/ `#a0519f`（= 浅色 `--meta`） | S2 **5.92** / 白底 **5.03** ✅ |

> **语义扩展（Monarch 限制，必须知悉）**：本项目 Python 高亮走 Monarch，词法层把 `True`/`False`/`None` 与 `def`/`class`/`if`/`return` **统统归进 `keyword`**，无法再按语义细分（VS Code 靠 TextMate 的 `constant.language` 区分，而 basic-languages 不走那条路）。故 `--syntax-boolean` 的实际覆盖面是「关键字与常量」。染紫是一体色主题的通行做法（One Dark Pro 等），且与青绿的 `identifier` 色相分离，区分度不减。JSON 面板的 `.jp-value.jp-boolean`（手写 Monarch，`true`/`false` 单独成 token）仍只染布尔值，不受影响。

#### 7.5.6 门禁

| # | 门禁 | 结果 |
|---|---|---|
| 1 | `tools/ui/audit_tokens.py` | ✅ 74 项判定 · FAIL 0 · WARN 0 |
| 2 | `npm run build`（tsc） | ✅ 0 错 |
| 3 | vitest 全量 | ✅ **92 文件 / 1051 用例**（新增 `themeTokens.test.ts` 25 条） |
| 4 | `cargo test settings` | ✅ 3 passed（默认主题 3 处断言同步） |
| 5 | e2e `editor/11-monaco-theme.spec.ts` | ✅ **6/6**（表面 / gutter / 当前行 / 边框透明 / 选区 / 语法色 / 存量迁移） |
| 6 | e2e-ui 视觉子集 | ✅ 51 passed；8 failed **经 stash 对照确认为存量**（见 §7.5.7 其三） |
| 7 | 基线截图 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\batch4\`（深浅编辑区青绿 identifier + 紫 keyword 区分清晰，当前行高亮与缩进线可见） |

`themeTokens.test.ts` 的门禁项：迁移映射与幂等 / 未知值兜底 / 前后端出厂名一致（含跨语言断言 `settings.rs`）/ **接线点完整性**（7 个文件里不得残留 `"vs"` / `"vs-dark"` 字面量）/ **色值真源单一性**（映射表内联 hex 仅限 `lineHighlightBorder`）/ **映射引用的 CSS 变量在 `:root` 与浅色覆盖层下都存在**（防 `var()` 在 computed-value time 失效后颜色 unset 继承）/ 7 个语法色取值。

#### 7.5.7 工具级教训三则

> **其一：期望值自己算错时，会把「通过」读成「失败」。** e2e 首跑 `editor.background` 期望 `rgb(31,31,24)` 实收 `rgb(31,31,36)`——`#1f1f24` 的第三字节 `0x24` 是**十进制 36** 而非 24，我按十六进制直觉写下了 24。**这次「失败」恰恰是主题生效的证据**。教训：实测值与期望值不符时，先怀疑期望值，再怀疑实现；十六进制↔十进制互转的错误**不会**被任何类型检查或门禁拦住。

> **其二：Monaco 主题槽位只能在带前缀的选择器上断言。** `currentLineHighlight.js` 的 `registerThemingParticipant` 只生成 `.monaco-editor .view-overlays .current-line { background-color: … }` 与 `.margin-view-overlays .current-line-margin {…}`。用无前缀的 `.monaco-editor .current-line` 会命中 **gutter 侧**那个元素，读到 `transparent`，误判成「主题没生效」。另：当前行高亮只在编辑器**有焦点**时渲染（`_shouldRenderInContent` 判 `focused`），断言前必须先点一下编辑器。正确写法见 `11-monaco-theme.spec.ts::T-B4-1`。

> **其三：e2e-ui 那 8 条「编辑器尚未初始化」与本批无关——stash 对照是唯一可靠判据。** 本批首跑 e2e-ui 得 51 passed / 8 failed（E-BASIC-1..4 / S-1 / S-2 / UX-1 / UX-9），错误与 §7.4.8 记录的现象完全一致。`git stash push -- <15 个改动文件>` 后在**原始代码**上重跑同样 3 个 spec，**同样 8 条失败、同样症状**（含 UX-9 的 `toBeFocused` 失败）→ 判定为存量/环境（vite 模块图），非本批回归。教训：§7.4.8 说的「先重启 vite」是**止血**手段，而「是否回归」只能由 stash 对照回答；两者结论一致时也要以对照为准，因为重启 vite 顺带会掩盖真实回归。

### 7.6 批 5a（2026-10-03）—— 动效曲线分级 + 焦点环双环

杠杆 6（曲线）与杠杆 8（材质细节）。开工前实测发现方案里的数字有几处已被前批做掉：滚动条早已是半透明 + 圆角（批 2b 顺手改的），故 5a 只剩宽度 10→8px；曲线 27 处里**真待改仅 14 处**（其余已走 token）。

#### 7.6.1 三个 token 层

| 层 | token | 取值 | 为什么 |
|---|---|---|---|
| 曲线 | `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | decelerate：快速启动、缓慢落位，「有惯性」的来源 |
| 曲线 | `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | standard：位移 / 形变 |
| 曲线 | `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | accelerate：出场 / 收起 |
| 时长 | `--transition-fast` | 0.12s · dec | 悬停、淡入、小位移 |
| 时长 | `--transition-base` | 0.15s · dec | 面板宽度、进度条填充 |
| 时长 | `--transition-slow` | 0.24s · standard | **唯一**结构性动画（模态卡片入场），是方案 §3「≤150ms」的唯一例外 |
| 时长 | `--transition-exit` | 0.1s · acc | **方案未列的第四档**，为让 4 处出场动画也不必内联 `calc()` |

曲线从内建 `ease` 换成三档可分辨的曲线，是本批最本质的变化：此前全部是 `ease`，而「入场减速 / 出场加速」恰恰是动效感知质量的主要来源，只靠时长区分不出来。

#### 7.6.2 焦点环：双环 + 一个必须显式排除的陷阱

方案 §5.8 给的是 `box-shadow: 0 0 0 2px var(--surface-2), 0 0 0 4px var(--accent)`。落地两处偏离：

① **`--focus-gap` 不用表面档**。同一个焦点环会落在 S0–S4 五档表面上（侧栏 S1、画布 S2、浮层 S3），用 `--surface-2` 只对其余四档成立。新增 `--focus-gap`：深色 `rgba(0,0,0,.55)`（比画布更深的暗环）、浅色 `rgba(0,0,0,.14)`（淡影——浅色画布纯白，隔离带只能是影子）。

② **`outline` 写 `2px solid transparent` 而非 `none`**。Windows 强制高亮模式（HCM / `forced-colors`）下浏览器靠 `outline` 绘制系统焦点框，写 `none` 会让该模式用户彻底失去焦点指示 —— 这是可访问性回归，不是视觉细节。

**陷阱（4 个小尺寸元素）**：`.term-tab-close` / `.term-tab-stop` / `.tab .close` / `.debug-bp-del` 原本用 `outline-offset: -1px` 内描边（16px 的关闭钮外扩 4px 会盖住相邻 tab）。它们**必须从双环名单里移出**并在自身规则里写 `box-shadow: none` —— 因为 **`box-shadow` 不受 `outline-offset` 影响**，「先在组里给 box-shadow、再靠后一条规则改 `offset:-1px`」是**无效**的，会画出内缩双环（外扩的环照旧画在元素外侧）。这条已钉进单测。

#### 7.6.3 门禁脚本新增两项判定

`tools/ui/audit_tokens.py` 从 74 项扩到 **76 项**：

| # | 判定 | 实现要点 |
|---|---|---|
| 20 | `transition`/`animation` 的时间函数全部走 `--ease-*` | **不能直接 grep `ease`**（会命中 `var(--ease-out)` 自身）→ 先剥 `var(--ease-…)` 再找裸关键字；只扫简写，`@keyframes` 内部实测无时间函数 |
| 21 | 有限时长动效均挂 `var(--motion)` | 方案 §7-16 的**成因检查**（此前只有行为要求、无成因门禁）。白名单只有 `rx-progress-slide` 一个循环装饰动画，且要求其双通道压制就位 |

门禁 21 上线**当场抓到 2 处真实缺陷**：`.interp-trigger-caret` 的 `transition: transform 0.12s` 与 `.clone-progress-fill` 的 `transition: width 0.2s` —— 两处都既未挂 `--motion`（reduce-motion 下照动）也未走缓动 token，已修。

#### 7.6.4 顺带修掉一处可访问性不一致

`.rx-progress::after`（进度条循环动画）原本**只有 `@media (prefers-reduced-motion)` 一条压制通道**，漏了应用内「减少动画」开关那条（`html[data-reduce-motion]`，见 `applyReduceMotion`）—— 用户在设置里关掉动效后进度条仍会无限循环。已按 `.codicon-modifier-spin` 的双通道范式补齐。

> ⚠ 顺带记一条**不能怎么做**：该动画**不能**靠「时长 × `var(--motion)`」压制 —— `motion=0` 会让 `duration` 变成 0，`infinite` 循环将高频闪成一团糊。正确做法只有 `animation: none`。门禁 21 的白名单机制正是为此存在（豁免 motion 挂载，但要求双通道压制就位）。

#### 7.6.5 门禁实测

| # | 门禁 | 结果 |
|---|---|---|
| 1 | `tools/ui/audit_tokens.py` | ✅ **76 项**判定 · FAIL 0 · WARN 0 |
| 2 | `npm run build`（tsc） | ✅ 0 错 |
| 3 | vitest 全量 | ✅ **92 文件 / 1060 用例**（`styleTokens.test.ts` +10：曲线三档、时长档挂 motion、双环结构、内缩组关双环） |
| 4 | e2e `editor/12-motion-focus.spec.ts` | ✅ **2/2**：`--motion` 归零实测 + 焦点环双环 computed |
| 5 | e2e-ui 视觉子集 | ✅ 51 passed；8 failed **经 stash 对照确认为存量**（同 §7.5.7 其三） |
| 6 | 基线截图 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\batch5a\` |

**新增 e2e 的价值**（单测与门禁脚本都覆盖不到）：`--transition-base` 写的是 `calc(0.15s * var(--motion))`，单测只能断言「字符串里有 `var(--motion)`」，无法证明浏览器真的算出 `0s`；焦点环「两层 spread 是否真叠成两圈」同理要读 computed。方案 §7-16「reduce-motion 下全部动效为 0」此前**只有代码审查、没有实测**，现由 T-B5A-1 承担。

焦点环 e2e 有一处设计取舍：Tab 顺序取决于 UI 状态（menubar / 活动栏 / 工具栏各有多少可聚焦项），故**不指定元素** —— 逐个 Tab 直到撞上带焦点环的控件（认 `--accent` 色值），任何一个都行。初版写死「Tab 到 `.tree-item`」在 40 次内没走到，改成自适应后稳定通过。同理 T-B5A-1 读 `#sidebar`（恒存）而非 `.tab .close`（要先打开文件才存在）——**e2e 选元素要挑「状态无关」的，否则断言会随 UI 状态漂移**。

#### 7.6.6 门禁自身做了注入自检

把 `.tree-item:focus-visible` 的双环改回单环 → 单测如期变红（报 `outline 必须是 transparent`），确认新断言不是假绿。

### 7.7 批 5b（2026-10-03）—— 边框三档 alpha

杠杆 5。拍板策略是「只换值 + 重点提升」，落地前先做了一次**场景分布调研**（150 处 `var(--border)` / 149 个选择器 + 24 处 `--border-soft`），结论改变了执行方式。

#### 7.7.1 方案有个前提不成立：`strong` 档当前无使用场景

方案 §5.5 建议把「模态、浮层、聚焦控件、active 标签」提到 `--border-strong`。实算后发现**前提不成立**：

| | S2 画布 | S3 抬升面 |
|---|---|---|
| 旧实色 `#3c3c3c` | 1.51 | **1.29** |
| 新 subtle `.10` | 1.36 | **1.36** |

alpha 叠色把「同一色值在两个面上表现不一致」抹平了 —— 这正是 §5.5 的核心收益。**推论**：控件边框在 S3 上反而比旧实色**更**明显（1.29 → 1.36），根本不需要再提到 strong 档。逐个 selector 分配三档的前提是「不同表面需要不同强度」，而 alpha 已经自动做到了。

故本批实际动作只有两项（+ 1 项诚实登记）：

| 动作 | 范围 | 理由 |
|---|---|---|
| `--border` → `var(--border-subtle)` | **1 处定义，150 处引用零改动** | alpha 收益只需改 token 值 |
| `--border-soft` → `var(--border-hairline)` | 1 处定义，24 处零改动 | 调研发现这 24 处**几乎全是细分隔线**（menubar 分隔、状态栏 span 分隔、表格行、`dep-group`、存储分隔线）—— 语义本就是 hairline，不是「soft 的 border」 |
| 浮层容器 → `--border-hairline` | 4 处 | 方案 §5.5 配套明确要求 |
| `--border-strong` | **定义但不使用** | 见 §7.7.1，登记为「预留给将来边框本身即强调信号的场景」 |

#### 7.7.2 浮层只有 4 个容器该改，不是调研初判的 7 个

调研用的正则把「选择器名含 modal/palette/tooltip」都算成浮层，落点 7 个。逐个读规则后按**语义**重新划分：

- **改 hairline（4 个容器）**：`.oc-tooltip` / `.ctx-menu` / `.modal-card` / `.interp-popover`
  （`.interp-popover` 解释器弹层**不在调研正则里**——名字不含那些关键词，是改 `.ctx-menu` 时发现同一条规则体命中两处才暴露的；已补进门禁名单）
- **保持 subtle（3 个）**：`.oc-tooltip kbd` / `.modal-card input` / `.palette-card input` —— 它们是浮层**内部的控件**不是浮层容器，且 kbd 紧贴浮层背景、改 hairline 会太淡。

理由：浮层已由 `--elev-3` 投影表达「浮起」，边框若还用常规档会在投影之外再加一道硬边，读起来「厚一圈」。单测同时钉住「hairline 必须与 `--elev-*` 投影并存」——没有投影时「边框退居辅助」的前提不成立。

#### 7.7.3 门禁 76 → 90 项

| # | 判定 | 要点 |
|---|---|---|
| 22 | 三档 alpha 齐备 + 兼容别名指向正确 | ① 三档两套主题都要定义（缺一 → 引用它的规则颜色 unset 并**继承父级**）；② `--border` 必须指向 subtle、`--border-soft` 必须指向 hairline —— 这两个是 174 处的兼容入口，**指错等于静默把 174 处改到另一档**；③ 值必须是 `rgba(…, a)`，实色是本批要消灭的对象，门禁守住「不许退回实色」 |
| 23 | 浮层容器边框必须 hairline | 选择器级判定（token 计数判不了），名单含 `.interp-popover` |

#### 7.7.4 一处自觉登记的合规事实

新边框在两套主题下都是 **1.32~1.36:1**，**不满足** WCAG 1.4.11 非文本对比 3:1。这不是本批引入的：旧实色是 1.29~1.51，同样不达标。alpha 边框**在原理上不可能达到 3:1**（要 3:1 就得接近实色），这是「精致」与「合规」的自觉取舍。输入框的识别由**聚焦态**承担（`border-color: var(--accent)`，青绿 4.98:1），符合 1.4.11「组件可用其他方式识别」的豁免条件。

#### 7.7.5 门禁实测

| # | 门禁 | 结果 |
|---|---|---|
| 1 | `tools/ui/audit_tokens.py` | ✅ **90 项**判定 · FAIL 0 · WARN 0 |
| 2 | `npm run build`（tsc） | ✅ 0 错 |
| 3 | vitest 全量 | ✅ **92 文件 / 1064 用例**（`styleTokens.test.ts` +4） |
| 4 | e2e-ui 视觉子集 | ✅ 53 passed；8 failed 同存量（§7.5.7 其三） |
| 5 | 基线截图 | ✅ 8 张 → `%TEMP%\opencharm-ui-baseline\batch5b\`（边框更融入，面板边界/输入框/状态栏分隔线仍清晰） |

**注入自检**：把 `.modal-card` 边框改回 `var(--border)` → 单测如期变红。

> **一条工具级教训**：单测里定位规则体**必须行首匹配**（`indexOf("\n" + sel + " {")`）。初版用 `indexOf(sel + " {")`，`.modal:not(.hidden) .modal-card { animation: … }` 这类**子选择器**的结尾也是 `.modal-card {`，于是命中了它并读到 animation 块 —— 报出的信息是「`.modal-card` 边框应为 hairline: expected '.modal-card { animation: oc-modal-in …'」，看起来像规则不存在。CSS 里凡是「选择器组以 X 结尾」的场景都有这个陷阱。


