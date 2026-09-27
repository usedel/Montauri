# DX 顺手功能储备（PyCharm 对标 · 调研与推进清单）

> 状态：调研完成，2026-09-26 二次核实（对照当前代码逐条验证事实底座，并新增缺口挖掘）；同日补齐详细实施计划（第 6 节），可直接按 PR 推进。
> **进度（2026-09-27）**：第一梯队 PR-A~E 与第二梯队 PR-F~N + PR-G2 **已全部落地**（各节均有落地记录与验证基线）；PR-J 人工验证已收口（Ctrl+Space 确认被中文 IME 吞键 → Alt+/ 备选键落地）。**DX 储备清单全部完成**。新会话续推请直接读 **6.8 进度快照**，再按 6.6/6.8 各落地记录恢复上下文。
> **第三梯队推进（2026-09-27）**：Extract 重构探针完成并转正——pyrefly 1.3.1 原生支持 refactor.extract（修正了「basedpyright 已支持」的旧判断），**PR-O 已落地全绿**（helper 抑制 + URI 归一化修复 + 真机桥 e2e），详见文末探针报告与落地记录。
> **收尾修复（2026-09-27）**：**PR-P 已落地全绿**——import 别名链路已知边界 ①（from-import 圆括号跨行）②（分号多语句）修复（Rust 学习侧 + TS 补全侧），详见 §1.1；**PR-Q 已落地全绿**——边界 ③ 增量扫描修复（mtime+size 签名缓存，工作区 config 持久化），详见 §1.2。**§1 三条边界全部收口。**
> 来源：import 别名补全（已落地）延伸出的「顺手/爽」功能调研。
> 约定：本档与开发计划冲突时以 `python_ide_dev_plan_v2.md` 为准；实现落地区分 shell 侧（纯前端/自研命令）与引擎侧（pyrefly/intel）。
> 核实方法：对第 2 节每条结论逐条回到代码验证（含行号）；另做了一轮 PyCharm 常见体验 × 现有模块的缺口盘点（结果并入第 3 节候选）。

## 1. 已落地：import 别名补全链路（2026-09）

对标 PyCharm「import pandas as pd」补全，三层触发形态 + 两层知识源 + 持久化：

| 能力 | 形态 |
|---|---|
| ① 变体项 | `import pand` → `pandas as pd`（整段替换，点分路径支持） |
| ② 别名补全 | `import pandas as ` → `pd` |
| ③ 成员别名 | `from pandas import DataFrame as ` → 学到的别名（仅学习表，无内置） |
| 知识源 | 内置 19 库别名表（兜底）+ 工作区频率学习（学习命中优先、按 target 去重） |
| 持久化 | 工作区 config `import_aliases` 键（与 `framework_hints`/`dep_ignored` 同文件）；打开工作区 = 缓存秒生效 + 后台重扫回写 |

关键路径：`shell/src/importAlias.ts`（provider + 纯函数）· `shell/src/__tests__/importAlias.test.ts`（11 例）· `shell/src-tauri/src/fs_cmds.rs`（`scan_import_aliases` / `read_import_aliases` + `parse_import_alias_line` 纯函数，`lib.rs` 已注册）· `main.ts`（openWorkspace 接线 `refreshImportAliases` + provider 注册入 `lspProviders`）。

已知边界（登记未修）：~~from-import 圆括号跨行不识别；分号多语句不解析~~（已于 2026-09-27 修复，见 §1.1）；~~学习数据每次全量重扫（无增量）~~（已于 2026-09-27 修复，见 §1.2）。**§1 三条边界全部收口。**

验证基线：Rust `cargo test` 214 全绿 · TS `vitest` 11/11 · `tsc` 全绿。

### 1.1 PR-P 落地记录：import 解析边界修复（①跨行续行 + ②分号多语句，2026-09-27，已实现并全绿）

**现状核实（两条解析链漂移摸底）**：
- Rust 学习侧（`fs_cmds.rs::parse_import_alias_line`）：① 逐行解析无续行状态，`from x import (\n A as B,\n)` 完全学不到；**额外发现**同行多成员带括号时尾段 `)` 粘连别名被 `is_ident` 拒绝（`from lib import (A as B, C as D)` 只学到 A）；② 分号整段进 tokenizer，两边都丢。
- TS 补全侧：`autoImport.importedNames` 圆括号跨行**已支持**（PR-E 落地，不漂移）；② 分号同样不支持 → 已导入符号被 auto-import 误发候选（正确性缺陷）；`importAlias.resolveImportAliasContext` ① 跨行不识别（§1 登记的原始边界即此）。

**改动**：
- Rust（学习侧，单一实现收口）：`parse_import_alias_line` 升级为 `parse_import_alias_content`（多行内容解析，原单行 API 保留为薄委托）——from-import 圆括号/逗号**跨行续行**（行以 `,`/`(` 结尾则续，闭括号收束，与 TS `importedNames` 同口径）、**分号多语句**（每段独立成语句；续行中首个 `;` 结束续行）、成员段首 `(` / 段尾 `)` 剥除（连带修复同行尾段粘连缺陷）；`scan_import_aliases_impl` 改按整份内容解析。朴素口径：字符串字面量内的 `;`/`(` 不排除（同既有注释截断哲学）。
- TS `importAlias.ts`：`resolveImportAliasContext` 支持多行前缀——光标行不直接匹配时回溯前文找未闭合 from-import（空行/纯注释不打断，Python 允许括号内空行），以 `from M import <光标行>` 虚拟前缀重判；provider 改传文档起点到光标的多行前缀（`getValueInRange`，单行场景行为不变）。
- TS `autoImport.ts`：`importedNames` 重构为语句级处理（`handleStmt`）+ 分号拆段；顺带修正空行会误断括号续行的行为。

**测试与验证边界**：Rust 新增 2 例（跨行续行含无括号逗号续行/尾段粘连/闭括号收束；分号多语句含 from+import 混排/续行中分号/无别名段不产生绑定）；vitest 新增 importAlias 跨行正反 2 例 + importedNames 分号 2 例。**e2e 不适用的原因（登记）**：学习链路是 Rust 侧（浏览器 mock 够不着，同 PR-H workspace 正则先例）；跨行 fromAlias 补全的候选项来自学习表 member 别名，e2e mock 无学习数据无从断言——被测边界 = 纯函数解析，单测即正确层。
- 验证基线：`tsc` 全绿 · vitest 69 文件全绿 · `cargo test` 220 全绿（218→220）· e2e dx 域 34/34 全绿（provider 输入形态变更回归）。
- 剩余边界：③ 学习数据全量重扫（无增量）→ 已由 PR-Q 修复（§1.2）。

### 1.2 PR-Q 落地记录：别名学习增量扫描（③，2026-09-27，已实现并全绿）

**方案**：每文件 `(mtime_secs, mtime_nanos, size)` 签名 + 该文件解析出的绑定列表，缓存进工作区 config 新键 `import_aliases_scan_cache`（与 `import_aliases` 同文件，同一次 load/save 双键落盘）。重扫时签名一致 → 跳过该文件的读取与解析，只重建聚合（计数仍按文件次数累加，语义与全量一致）；签名不符 / 新文件 → 读取解析并回写；删除的文件自然从基线消失；首次扫描无缓存 = 全量（与旧实现语义一致）。

**关键决策（已就地注释）**：
- 缓存键用**相对路径**（统一 `/` 分隔）——工作区移动 / 换盘符后仍命中；
- 缓存结构带 `v` 版本号——解析器或结构变更时递增使旧缓存整体作废走全量；
- 损坏 / 版本不符 → 整体作废走全量（同 `import_aliases_from_config` 绝不 panic 口径）；
- 登记粒度：同 mtime 刻度内等长改写不感知（标准 mtime 缓存取舍；编辑器落盘必更新 mtime，实际不可达）；
- 剩余开销 = 目录走查（`collect_files` 本就是检测新增/删除文件所必需）+ 聚合重建，文件读取与解析（原大头）全免。

**实现细节**：`fs_cmds.rs` 新增 `AliasScanCache` / `AliasScanCacheFile` 结构 + `alias_file_signature` 辅助；`save_import_aliases` 签名扩展为 `(root, hits, scan_cache)`（单次落盘双键）；薄委托 `parse_import_alias_line` 删除（生产调用方已切内容级解析，测试统一走 `parse_import_alias_content`，避免 dead_code）。**TS 侧零改动**（`read_import_aliases` / `scan_import_aliases` 返回结构不变）。

**测试**：新增 2 例——增量行为用**哨兵法**验证（不动文件、直接改写缓存绑定为哨兵值 → 重扫命中缓存复用哨兵，证明未重读文件；再改文件内容（变长确保签名变化）→ 缓存失效重新解析；删除文件 → 条目消失）+ 损坏缓存兜底（garbage → 全量回退且缓存被健康结构覆盖写）。e2e 不适用（同 §1.1：纯 Rust 侧，浏览器 mock 够不着）。

- 验证基线：`cargo test` 222 全绿（220→222，零警告）· TS 侧零改动（tsc / vitest / e2e 基线沿用 PR-P）。

**Playwright 全量验收（PR-P + PR-Q 合并，2026-09-27，13 域 163 例分 4 批）**：
- 结果：**163/163 全绿**（dx 34 · lsp/editor/autosave/debug 52 · ux/p3/perf/plugins/session 41 · git 36）。
- **环境发现（值得登记，方法论补一条）**：首批 p3 域 P3-5（剪贴板 diff）报未捕获异常 `Error: no diff result available`，单独复跑**稳定复现**——初判非 flake。定位：报错串来自 Monaco `WorkerBasedDocumentDiffProvider`（diff worker 返回空结果即抛，业务代码零命中）→ 指向 **worker 脚本加载失败**。根因 = `reuseExistingServer: true` 复用的常驻 vite dev server 携带**过期 optimizeDeps 预构建**（此前 vitest 环境修复降级 happy-dom 动过 node_modules，旧实例的依赖预构建未失效重建）。杀掉旧实例由 Playwright 拉起新 dev server 后用例即过，且五域合跑 41/41 全绿。
- **方法论沉淀**：e2e 单独复跑仍稳定失败 ≠ 真实回归，还要先排查「长驻 dev server × node_modules 变更」这一层——报错串定位到依赖内部（而非业务代码）是关键线索；涉及 node_modules 变更（装包/升级/降级）后应**主动重启 dev server** 再跑 e2e。

## 2. 现状核实结论（2026-09-26 二次核实，行号以当日代码为准）

| 事实 | 结论 | 证据 |
|---|---|---|
| 条件断点/日志断点/命中条件 | **已有完整链路**，勿重复立项；断点另有 `enabled` 字段（禁用断点不下发 debugger、gutter 保留灰点） | `dap/client.ts:77-95`（BreakpointSpec）+ `:381-395`（只带非空字段下发）+ `main.ts:1368-1435` 断点右键菜单 |
| format on save / 整理 imports | **已有**（仅显式 Ctrl+S 触发；autosave/失焦/运行前/git 改写磁盘前落盘**三处**都显式 `runOnSaveActions: false` 跳过） | `main.ts:1023-1034` · `:1065`(autosave) · `:1839`(失焦) · `:1747-1752`(git) · `state.ts:34-40` SaveOptions 注释 |
| Monaco 编辑器选项 | `guides`/`bracketPairColorization` 已有且带设置开关；**stickyScroll 零配置**（全库 0 命中）；monaco-editor 精确 pin **0.52.2**（内建 stickyScroll 成立） | `settingsPanel.ts:297-301`、`state.ts:53-55`、`shell/package.json:21` |
| additionalTextEdits 透传 | **已通**：completionItem resolve 后回填，Monaco 原生应用 | `lsp/client.ts:645-674`（回填在 662-671）+ `:37` 接口字段 |
| 缺失 import 兜底 | **只有灯泡形态**（CodeAction，G-1 工作区顶层符号扫描上限 200 文件）；模块头部 textEdit 插入逻辑现成 | `quickFix.ts:20-22`(MAX_SCAN_FILES) · `:148` findWorkspaceSymbol · `:182` importAction · `:193` 头部插入 |
| 复制 `file:line` | **没有**（复制三件套=文件名/相对/绝对路径，**双入口**：tab 右键 + 文件树右键，多选逐行输出） | `main.ts:470-479`、`fileTree.ts:493-495`、`copyPaths` `fileTree.ts:1071-1083` |
| 最近编辑位置 | **没有**（`editHistory.ts` 仅数据采集落 JSONL，无导航入口；`navHistory.ts` 是另一套光标位置栈，出厂键位 Ctrl+Alt+←/→） | `keybindingDefaults.ts:105-106` |
| 命令面板 | **已有**：quickOpen `commands` 模式（Ctrl+Shift+P），命令由 main.ts `buildQuickOpenActions` 注入；Double Shift 混搜文件/符号/命令 | `quickOpen.ts:24` 四模式、`main.ts:1315-1322`、`:2031-2047` |
| 文件内符号 quick pick | **无独立模式，但有现成扩展点**：quickOpen `all` 混搜已合入**已打开标签**的 documentSymbol（symbolIndex）；工作区级符号不覆盖 | `quickOpen.ts:251-260`、`:66` fuzzyScore |
| 最近文件 / 转到文件 | **已有**：Ctrl+E 最近文件（PyCharm 对标）；转到文件出厂键位是 **Ctrl+Shift+N**（非 Ctrl+P，Ctrl+P 仅被 browserKeys 拦截） | `recentFiles.ts`、`keybindingDefaults.ts:99,103` |
| 编辑器设置项 | DEFAULT_SETTINGS 29 键，无 `sticky_scroll`；设置三层接线（buildEditorOptions / 面板回填 / saveSettingsPanel 挂钩）齐备 | `state.ts:98-138`、`settingsPanel.ts:289,489,559-606,682` |
| 键位漂移锁 | 真实存在：`keybindingDefaults.ts` 单一来源 ↔ `state.ts defaultKeybindings()` ↔ Rust `settings.rs default_keybindings()`，TS 测试锁三处一致 | `__tests__/keybindings.test.ts:118`「三处默认值漂移锁」 |
| sortText 合并契约 | **实际是四层**：0xx live-templates 模板/postfix · **0z importAlias**（模板段内的第四参与方，文档此前漏记）· 1xx intel · 2xx 静态 | `importAlias.ts:8,156`、`live-templates/completion.ts:76`、`postfix.ts:135`、`lsp/client.ts:602,631-636` |
| 其他既有能力（盘点结论，避免重复立项） | 书签 Ctrl+F11、符号面包屑、CodeVision 引用、剪贴板 diff、Ctrl+F 查找条、Alt+F7 引用面板、调试行内值、本地历史 Ctrl+Shift+H、分屏 Ctrl+\、TODO 视图、live-templates 全家桶（含 Ctrl+Alt+T 环绕）、运行历史 Ctrl+Shift+R、多光标/列选择、括号匹配跳转（Monaco 内建）、traceback 点击跳转、文件树 reveal+跟随开关 | 各模块对应文件；下表缺口仅列**确实没有**的 |

## 3. 候选清单（按性价比分梯队）

### 第一梯队：低成本、强感知（纯 shell 侧，符合架构铁律）

#### 3.1 补全内联 auto-import（推荐首做，对标 PyCharm 王牌）

- **体验**：直接写 `DataFrame` → 补全项带 `from pandas import DataFrame`，选中自动在文件头插入 import；未安装包时仍回落灯泡「安装 X」。
- **实现要点**：
  1. 优先验证 pyrefly 补全项是否原生携带 `additionalTextEdits`（import 语句插入）——透传链路已通（`lsp/client.ts:662-671`），若原生携带则 shell 侧工作量趋近零；
  2. 若否，回落自研：`quickFix.ts` 的 G-1 工作区符号索引（上限 200 文件）改造为补全数据源，import 插入位置沿用 `importAction`（`quickFix.ts:193`）的「模块头部 textEdit」逻辑；
  3. 别名知识接入：插入 `import pandas as pd` 时优先用 `importAlias.ts` 的学习/内置表（链路已通）。
- **风险**：与静态引擎 `2xx` 补全段的 sortText 竞争（注意归入 0xx/0z 段内钉序）；import 插入与用户已有 import 块的合并（可借 ruff organize imports 收口）。
- **验收建议**：e2e 真机桥（`02-pyrefly-real` 同款）——未导入符号补全 → 选中 → 断言文件头出现 import 且原编辑点插入符号名。

#### 3.2 Sticky Scroll（粘性滚动）

- **体验**：长文件滚动时，当前作用域（def/class）头部行常驻编辑器顶部。
- **实现要点**：Monaco 0.52.2 内建，`buildEditorOptions` 加 `stickyScroll: { enabled: settings.sticky_scroll }`；`DEFAULT_SETTINGS` 加 `sticky_scroll: true`；设置面板「编辑器」区加开关（走 UI-11/29 设置刷新三层接线）。
- **量级**：半天内，含设置与 e2e。

#### 3.3 复制 `file:line` 引用

- **体验**：编辑器右键/tab 右键复制 `main.py:42`（相对工作区根），贴 issue/聊天可直点。
- **实现要点**：`main.ts:470-479` tab 复制三件套加一项（光标行取 `editor.getPosition()`）；文件树项不带行号，无需改 `fileTree.ts`。
- **量级**：1-2 小时。

#### 3.4 最近编辑位置（Ctrl+Shift+Backspace）

- **体验**：连续改了十处后一键回跳上一个编辑点，再按循环回溯。
- **实现要点**：`editHistory.ts` 已有行对事件流，新增一个轻量「编辑点栈」（去重连续同文件同位置）；键位进 `keybindingDefaults.ts`（单一来源）+ `keybindings.ts` 分发 + Rust `default_keybindings` 漂移锁测试同步。
- **量级**：一天内。

#### 3.5 零成本键位补齐组（缺口盘点新增，可一个 PR 带走）

对标 PyCharm 高频行操作，逐项核实**当前确实没有**，全部只动 `keybindingDefaults.ts` + 漂移锁：

| 键位 | 功能 | 现状与要点 |
|---|---|---|
| Ctrl+Y | 删除行（delete_line） | 48 项键位表无此项；PyCharm 最高频行操作之一，`addKeybindingRule` 一行 |
| Ctrl+Shift+- / Ctrl+Shift+= | 折叠全部 / 展开全部 | `folding` contribution 已引入（`monaco.ts:16`），Monaco 内建和弦 Ctrl+K Ctrl+0/J 存在但不可发现不可配置；注册进键位表 + 「转到」/编辑器菜单入口 |
| Ctrl+Shift+T | 重新打开已关闭标签 | tab 域只有 close/next/prev，无 reopen；复用 navHistory 或 tab 关闭记录 |
| Ctrl+Shift+\ | 括号匹配跳转（登记，使其**可配置可发现**） | Monaco 内建 `bracketMatching` 已可用，但不在键位表（不可配置）；browserKeys DANGER 清单未拦截，注册即可 |

> 注意：Ctrl+D 复制行、Ctrl+Shift+↑/↓ 行移动、Alt+Shift+Insert 列选择均已存在，勿重复立项。

#### 3.6 保存时清理行尾空白 / 补最终换行

- **体验**：Ctrl+S 顺手清掉行尾空白、缺最终换行时补齐（PyCharm 默认行为）。
- **实现要点**：与 ruff 保存钩子同一挂点（显式 Ctrl+S 才跑，autosave/失焦/运行前/git 落盘**不跑**，沿用 `runOnSaveActions: false` 纪律）；设置项 `trim_trailing_whitespace` / `final_newline` 默认 true；ruff format 严格模式下与之冲突时以 format 结果为准（trim 先于 format）。
- **量级**：半天含设置。

### 第二梯队：中等成本

> 状态（2026-09-27）：本梯队大部分已落地（PR-F/G/H/I/N），PR-J 待人工验证，PR-K/L/M/G2 未启动——逐项状态见 **6.8 进度快照**，落地细节见 6.6/6.8 各落地记录。下表保留调研时的原始要点，仅作背景。

| 功能 | 要点 | 现成依赖 |
|---|---|---|
| 文件内/工作区符号 Quick Pick | quickOpen 新增 `symbol` 模式：文件内=当前 tab documentSymbol 全量；工作区级=扩展 G-1 符号索引（注意 200 文件上限的延迟预算）。`all` 混搜已含已打开 tab 符号（`quickOpen.ts:251-260`），扩展点现成 | `quickOpen.ts` fuzzyScore、LSP documentSymbols |
| 全局搜索正则 + 文件 glob 过滤 | `search.ts` 与 index.html 均无 regex/文件掩码；对标 PyCharm 正则开关 + File mask。TS 侧加开关，Rust `search_workspace` 同步扩展（glob 匹配） | `search.ts:32-38` scope 三档、Rust 侧搜索命令 |
| 双击选中词 → 查找引用 | findUsages 目前只有 Alt+F7 与 CodeLens 触发；编辑器 dblclick 挂接（词选中 + 光标落在词内 → 打开 findUsages），PyCharm 手势对标 | `findUsages.ts`、Double Shift 的 mouse 手势先例（`main.ts:2031-2047`） |
| 保存时语法错误提示 | 保存路径目前直写盘、无 marker 检查；Ctrl+S 前查 `getModelMarkers`，存在 error 级则 toast/状态栏提示（**不阻止保存**，仅提示，避免打断自动化场景） | `main.ts:1049-1052`、ruffLint 三桶诊断 |
| 新建 .py 文件模板 | 新建文件为空；可复用 live-templates `builtin.ts:248` 的 header 模板体（`# -*- coding: utf-8 -*-`），设置开关控制，默认关（避免污染草稿流） | `live-templates/` |
| 参数名行内提示 | 调用处 `func(` 后灰字 `name=`；挂在 intel inlay 管线或 pyrefly inlay 透传 | `lsp.registerLspInlayHints()` |
| 粘贴 JSON → Python dict | 剪贴板 JSON 自动转 Python 字面量（true→True 等），编辑器 paste 拦截 + 设置开关 | `devtools/jsonpath` 解析 |
| ruff 规则中文速释 | ruffLint 诊断 hover 补人话解释表（常见规则手工维护，无需全量） | `ruffLint.ts` |
| Ctrl+Space 中文 IME 冲突探针 | Windows/WebView2 下 Ctrl+Space 与中文输入法切换键冲突，且该键不在键位表（不可重绑）。先探针确认实际行为，若被吞则补候选键（如 Alt+/）并登记 | `browserKeys.ts`、`keybindingDefaults.ts` |

### 第三梯队：依赖引擎能力，先探针再决策

- **Extract Variable / Function 重构**：探针 + PR-O 均已落地（2026-09-27，见文末探针报告与落地记录）——pyrefly 原生 refactor.extract 直通灯泡，helper 变体受抑制清单过滤。

## 4. 建议推进顺序（PR 级拆分与验证基线见第 6 节）

1. **零成本键位补齐组 + 复制 file:line + Sticky Scroll**（3.5 + 3.3 + 3.2，一天内全部带走，感知立竿见影）
2. **auto-import**（3.1，先跑 pyrefly additionalTextEdits 探针定形态）
3. **3.4 最近编辑位置 + 3.6 保存清理**（各一天内）
4. 第二梯队按需挑选（正则搜索与工作区符号 Quick Pick 优先）；第三梯队先探针后立项

## 5. 横切纪律（实现时适用）

- 键位新增只改 `keybindingDefaults.ts`，Rust `default_keybindings` 由漂移锁测试（`__tests__/keybindings.test.ts:118`）兜底；Welcome 快捷键网格（`welcomeShortcuts.ts`）与菜单项按需同步，改键后自动重绘。
- 固定键位（Double Shift、Ctrl+F、Ctrl+Space、F12/Ctrl+点击）不进键位表——若要使其可配置，属于独立决策项。
- 设置项走「实例构造读取 + apply* + refresh* + saveSettingsPanel 挂钩」三层接线（UI-11/29）。
- provider/监听器返回值入 `DisposableStore`，禁止丢弃。
- 补全 sortText 沿四层合并契约：0xx 模板/postfix（`live-templates`）· **0z importAlias** · 1xx intel · 2xx 静态（`lsp/client.ts:602,631-636`）；新强上下文项在 0xx 段内用后缀钉序。
- 「显式保存才跑」的钩子（format/整理 imports/保存清理）一律走 `runOnSaveActions` 开关；autosave、失焦、运行前、git 改写磁盘前四个消费方保持跳过，新增清理类行为不得破坏此纪律。
- 右键菜单类功能注意双入口现状：tab 右键（`main.ts`）与文件树右键（`fileTree.ts`）各自维护，复制类功能两处都要对齐。
- 主干开发 + 短分支 PR，CI 全绿才可合并。

## 6. 详细实施计划（按 PR 推进）

> 锚点均来自 2026-09-26 代码实测（文件:行号），动手前以最新代码为准。
> 通用验证（`shell/` 内）：`npm run test`（vitest，测试放 `src/__tests__/<模块>.test.ts`）· `npx tsc --noEmit` · `npm run e2e`（Playwright，spec 放 `e2e/<域>/NN-主题.spec.ts`）；Rust：`cargo test`。
> 新增 Settings 字段的通用纪律：TS `Settings` 接口 + `DEFAULT_SETTINGS` + index.html 控件 + settingsPanel 三步接线 + Rust `Settings::default` 同步（前端用 `!== false` 兼容旧配置）。

### 6.1 PR-A：键位补齐组 + 复制 `file:line`（半天，先做）

**改动 1 — 三个新键位**（`keybindingDefaults.ts`）：

1. `KeybindingId` 联合类型（`:6-67`）加 `delete_line` / `fold_all` / `unfold_all` / `reopen_tab`；
2. `KEYBINDING_META`（`:79-148`）按四字段（id/label/def/scope）加条目，沿用注释块分组惯例：`delete_line: Ctrl+Y`（editor）· `fold_all: 折叠全部`（editor）· `unfold_all`（editor）· `reopen_tab`（window）；
3. Rust `settings.rs:12 default_keybindings()` 同步加同键位，`keybindings.test.ts:118` 漂移锁自检；
4. `keybindings.ts initKeybindingCommands`（`:242-285`）接线：
   - `delete_line` → `app.editor.trigger("keybindings", "editor.action.deleteLines", null)`；若该命令在 Monaco 0.52 不存在，回落 `model.pushEditOperations` 手删整行；
   - `fold_all` / `unfold_all` → `editor.action.foldAll` / `editor.action.unfoldAll`（folding contribution 已引入，`monaco.ts:16`）；
   - `reopen_tab` 为 window 级，handler 在 main.ts：维护关闭栈（在 tab 关闭逻辑处 push `{path, viewState}`，上限 20），跳转时文件已不存在则 toast；`monaco.editor.addCommand` 循环（`:278-284`）自动覆盖 editor 级条目。

**键位冲突决策（已核实，须按此执行）**：
- `Ctrl+Shift+T` 已被 `open_devtools` 占用（`keybindingDefaults.ts:137`）→ `reopen_tab` 出厂键位定 **`Ctrl+Shift+Alt+T`**，不动 DevTools；
- `Ctrl+Y` 在 Monaco/Windows 语义是重做 → 本项目覆盖为删行（PyCharm 对标），重做走 `Ctrl+Shift+Z`，需在 e2e 断言重做仍可用；
- `fold_all`/`unfold_all` 出厂键位用 `Ctrl+K Ctrl+0` / `Ctrl+K Ctrl+J` 和弦——**前置校验** `keybindings.ts` 键位解析器对非字母键与和弦的支持；不支持则先扩展解析器（本 PR 内），或暂定 `Ctrl+Shift+-` / `Ctrl+Shift+=`；
- `Ctrl+Shift+\` 括号跳转：核实报告对 `split_editor` 当前 def（`:147`）记录不一致（`Ctrl+\` vs `Ctrl+Shift+\`），动手时先确认，冲突则改配 `Ctrl+Shift+M`（Monaco `editor.action.jumpToBracket`）。

**改动 2 — 复制 `file:line`**（`main.ts:465-480 showTabContextMenu`）：`CtxItem[]` 加一项「复制 `file:line`」，文本 = `relativePathOrName(root, tab.path) + ":" + app.editor.getPosition()?.lineNumber`（函数开头已 `activateTab`，`:466`）；剪贴板走既有 `invoke("copy_to_clipboard")`。文件树侧不加（无行号语义，`Entry{name,path,is_dir}` 无行号字段）。

**测试**：vitest 纯逻辑（关闭栈去重/上限）；e2e `e2e/dx/01-shortcuts.spec.ts`：Ctrl+Y 删行 · 折叠全部后行不可见 · reopen_tab 恢复关闭的 tab · tab 右键复制后 mock 剪贴板断言 `main.py:行号`。同步 `welcomeShortcuts.ts` 网格与「编辑器」菜单项。

**落地记录（2026-09-26，已实现并全绿）**：
- 新增 `shell/src/tabReopen.ts`（关闭栈独立模块，TD-014）+ `__tests__/tabReopen.test.ts`（7 例）；
- 键位五项按上文落地；`reopen_tab` 只记用户主动关闭（closeTab/批量关闭），工作区切换的批量清理不入栈；
- 命令面板补 5 条入口（`buildQuickOpenActions`，id 对齐键位表 hint 自动跟随）；welcomeShortcuts 网格补「删除行 / 重新打开关闭的标签」两行；
- Rust 漂移锁两处条目数断言同步（48→53，`settings.rs` default 与 partial-json 两处）。
- **两个实测修正**（计划 → 实现的差异）：① 重做无需补固定规则——Monaco `RedoCommand.secondary` 在 Windows 本就含 Ctrl+Shift+Z（`editorExtensions.js:425`），Ctrl+Y 只覆盖 primary；② 折叠/括号等 editor 级规则带 `when: editorTextFocus`，e2e 按键前必须先 `setCaret` 把焦点交给编辑器，否则规则静默不触发（探针方法论：先捕获真实按键事件属性排除解析问题，再对照焦点态定位）。
- 验证基线：`tsc` 全绿 · vitest 251 例全绿（本机 DOM 环境先在性损坏的 33 个文件与本次无关）· `cargo test` 214 全绿 · e2e dx 5/5 + editor 03 4/4 全绿。

### 6.2 PR-B：Sticky Scroll（半天）

1. `state.ts`：`Settings` 接口 `bracket_colors`（`:55`）后加 `sticky_scroll: boolean`；`DEFAULT_SETTINGS`（`:108-109` 附近）加 `sticky_scroll: true`（PyCharm/VSCode 均默认开）；
2. `settingsPanel.ts buildEditorOptions`（`:289-318`）`minimap:` 行后加 `stickyScroll: { enabled: settings.sticky_scroll !== false }`——选项形状见 monaco d.ts `IEditorStickyScrollOptions { enabled?, maxLineCount?, defaultModel?, scrollWithEditor? }`（`node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts:4248-4265`），其余字段吃默认值；
3. 设置面板三步接线（以 minimap 为模板）：index.html 加 `<input type="checkbox" id="settings-sticky-scroll">`（编辑器分区）→ settingsPanel.ts 元素引用（`:58` 区）+ fillForm 回填（`:488` 区）+ `saveSettingsPanel` 读值（`:574`/`:605` 模式）；
4. Rust `Settings::default` 同步 + serde default 兜底（旧配置文件无此键时开）。

**测试**：e2e 断言打开长文件滚动后编辑器顶部出现 sticky 容器且开关关掉即消失；state 单测默认值。

**落地记录（2026-09-26，已实现并全绿）**：
- 设置项 `sticky_scroll`（默认开）+ buildEditorOptions `stickyScroll: { enabled: settings.sticky_scroll !== false }`（旧配置 serde 兜底为开）+ index.html 开关 + settingsPanel 三步接线；Rust `Settings` struct/Default 同步。
- **关键实测修正**：本项目 Monaco 是按需裁剪导入（`monaco.ts` 只引 editor.api + 显式 contrib），**stickyScroll contribution 必须显式引入**（`import "monaco-editor/esm/vs/editor/contrib/stickyScroll/browser/stickyScrollContribution"`）——否则 `getOption(116).enabled === true` 但 controller 因 `AfterFirstRender` 实例化策略 + 贡献未注册而永不建 DOM，开关形同虚设（与该文件 ReferencesController 教训同类，已就地注释）。
- e2e `e2e/dx/02-sticky-scroll.spec.ts`（2 例）：滚动需落在作用域**体内部**（首个可见行=def 行时 sticky 为空），spec 按 lineHeight 精确计算 scrollTop。
- 验证基线：`tsc` 全绿 · `cargo test` 214 全绿 · vitest 可运行文件全过（33 个 DOM 文件仍为本机先在性损坏）· e2e dx 7/7 + editor 03 回归 4/4 全绿。

### 6.3 PR-C：保存时清理行尾空白 / 补最终换行（半天）

1. 新建 `shell/src/saveCleanup.ts` 纯函数：`cleanupSaveContent(content: string, opts: { trimTrailing: boolean; finalNewline: boolean }): string`（逐行 `trimEnd`，保留行内空白；末尾保证恰好一个 `\n`）；
2. `state.ts`：`trim_trailing_whitespace: true` / `final_newline: true`（加在 `format_on_save` 相邻区）；
3. `main.ts saveTab`（`:1021-1047`）：插入点在 format_on_save 块（`:1033-1038`）**之后**、`snapshotHistory`（`:1041`）**之前**（保证快照与落盘一致）；用 `opts?.runOnSaveActions !== false` 门控——autosave（`:1065`）/失焦（`:1839`）/git 落盘（`:1747-1752`）/运行前四个消费方自动豁免；
4. **编辑操作须用 `pushEditOperations`/`executeEdits` 做最小化替换，禁止 `model.setValue()` 整文替换**——否则破坏撤销栈粒度（一次 Ctrl+Z 回不到用户上一个编辑点）；
5. 设置面板「编辑器」区两个开关，三步接线同 6.2。

**测试**：`__tests__/saveCleanup.test.ts` 纯函数用例（行尾空白/多空行末尾/空文件/CRLF）；e2e：带行尾空白的文件 Ctrl+S 后落盘内容断言。

**落地记录（2026-09-26，已实现并全绿）**：
- 新增 `shell/src/saveCleanup.ts`（纯函数，无 DOM/Monaco 依赖）+ `__tests__/saveCleanup.test.ts`（9 例：行内空白保留/空行空白/CRLF 归一/幂等/开关全关短路）；
- 设置项 `trim_trailing_whitespace` / `final_newline`（默认开）+ index.html 两开关 + settingsPanel 三步接线 + Rust struct/Default 同步；
- **与计划的一处偏差**：应用方式没用 `pushEditOperations` 最小化编辑，而是沿用 saveTab 内 isort/format 的既有先例——内容变化时**单次 setValue**（保存动作本就该是单一撤销粒度，「Ctrl+Z 撤销本次保存全部动作」的语义反而更对，就地注释已说明）；
- 清理插在 format **之后**（ruff format 会重写内容，清理须以最终内容为准）；e2e 经 tauri-mock 的 FS bridge（write_file 走真实磁盘）用 `repo.read()` 断言落盘内容。
- 验证基线：`tsc` 全绿 · `cargo test` 214 全绿 · vitest saveCleanup/tabReopen 17/17 · e2e dx 9/9 全绿（PR-A/B/C 合并回归）。

### 6.4 PR-D：最近编辑位置（一天）

1. 新建 `shell/src/editPoints.ts` **独立模块**（自带 `onDidChangeModelContent` 监听，仿 `editHistory.ts:109-138` 的 init 模式；不要往 `main.ts:2050` 已承载 8+ 任务的编辑回调里塞）；
   - 栈结构：`{path, lineNumber}[]`，上限 50；去重规则：连续同文件且行距 ≤3 的多次内容变更合并为一个编辑点（输入过程中不炸栈）；
   - `initEditPoints(editor, { openFile })` 注入跳转动作（模式参照 `main.ts:2111 setNavHistoryHandlers({ openFile })`）；main.ts `:2146` 附近 init；
2. 键位 `recent_edit_locations: Ctrl+Shift+Backspace`（window 级；确认 keybindings 解析器支持 `Backspace` 键名）；第一次按下回最近编辑点，连续按循环回溯（同文件跳行即可，跨文件走 `openFile`）；
3. 与 `navHistory.ts` 保持独立（后者是跳转闭环语义，`:41-43 sameLoc` 只比 path+line；编辑点是时间轴语义，勿混用一套栈）。

**测试**：`__tests__/editPoints.test.ts`（合并去重/上限/循环游标）；e2e：编辑两处 → 键位跳回 → 再按跳第二处。

**落地记录（2026-09-26，已实现并全绿）**：
- 新增 `shell/src/editPoints.ts`（`EditPointStack` 纯逻辑类 + 独立 `onDidChangeModelContent` 监听，仿 editHistory init 模式）+ 单测 8 例；键位 `recent_edit_locations: Ctrl+Shift+Backspace`（window 级，Backspace 可解析、browserKeys 无冲突）+ 命令面板入口 + welcomeShortcuts 行；Rust 漂移锁同步（53→54）。
- 语义：连续同文件行距 ≤3 的变更合并为一个编辑点（输入过程不炸栈）；回溯跳过「当前位置所在编辑区域」；到栈底循环回栈顶；任何新编辑重置导航游标。
- **两个实测修正**：① 发现并修复一个**应用级噪声**：Monaco `wordHighlighter` 的 dispose 路径 `Delayer.cancel()` 产生未捕获的 `CanceledError` unhandled rejection（裸 Monaco 未接 VS Code 的「取消不是错误」全局兜底），合跑 e2e 必踩——已在 `monaco.ts` 加 `unhandledrejection` 全局过滤（**只按 CanceledError 的 name/message 精确匹配**，其余拒绝照常上报），此为产品级修复非测试特判；② 04 spec 合跑时曾超全局 30s 预算报 `Canceled`（poll 被中断的表现），`test.setTimeout(60_000)` 放宽。
- 验证基线：`tsc` 全绿 · `cargo test` 214 全绿 · vitest 15/15（editPoints 11 + tabReopen 4→共 17 文件级）· e2e dx 11/11 + editor 03 回归 4/4 **两次连跑全绿**（flake 已消除）。

### 6.5 PR-E：补全内联 auto-import（先探针后实现，招牌项）

**Phase 0 — pyrefly 探针报告（2026-09-26 实测，pyrefly 1.3.0 裸 LSP 会话，脚本复用引用计数探针骨架）**：
- 受控项目（pyproject.toml [project] + lib.py 定义符号 + user.py 导入引用 + main.py 未导入前缀），didOpen 全部文件、等索引 3s 后发 `textDocument/completion`（Invoked）：
  - 未导入类（前缀 `DataFra`）：**返回 0 项**——引擎连项都不给；
  - 未导入函数（前缀 `pd_conv`）：返回 251/252 项但全是 builtins，**无工作区符号**；
  - 对照·本文件符号（`local_one`）：正常返回，sortText 形如 `0.9999.local_one`；
  - 对照·已导入符号（user.py 的 `DataFrame`）：正常返回（kind=7，无 additionalTextEdits，符合预期）；
  - **v2 复测**：initialize 带完整 client capabilities（labelDetailsSupport / resolveSupport(additionalTextEdits) / snippetSupport / insertReplaceSupport）结果完全一致——排除「按 client 能力降级」因素。
- **判定：结局 C**——pyrefly 1.3.0 的 completion 不含未导入工作区符号（无 auto-import completion）。A（原生携带）不成立；B 的「引擎项合并」环节不存在（无竞争，自研项反而干净）。
- 注意：结局 C **不阻断自研回落**——3.1 实现要点 2 的自研前提（G-1 索引、别名表、头部 textEdit 逻辑）全部成立且已落地，引擎不给项只是意味着 0xx 段自研项没有 2xx 竞争。是否立项自研（1-2 天）为独立决策。
- basedpyright 备选引擎已知原生支持 auto-import completion（pyright 血统核心功能），但切换引擎超出本 PR 范围（架构表：pyrefly 默认、basedpyright 备选）。


**Phase 0 — pyrefly 探针（半天，出决策报告再动工）**：沿用引用计数那次的方法论（Node 起 pyrefly 裸 LSP 会话，脚本可复用 Temp/pyrefly-probe 思路），对未导入符号发 `textDocument/completion`（含 `context.triggerKind`），检查返回项是否携带 `additionalTextEdits`（import 插入）。三种结局：
- **A. 原生携带** → shell 侧工作量趋近零：透传已通（`lsp/client.ts:662-671`），只做别名改写（post-process `additionalTextEdits` 文本，`import pandas` → `import pandas as pd`，数据源 `importAlias.ts` 学习/内置表）+ 必要的 0z 段钉序；
- **B. 不携带** → 自研补全项：G-1 工作区符号索引（`quickFix.ts:20-22,148`）改造为补全数据源（注意 200 文件上限的扫描时机——openWorkspace 后台已跑则复用），新 provider 输出项挂 `additionalTextEdits`（模块头部 textEdit 逻辑抄 `quickFix.ts:193`）；
- **C. 引擎根本不给未导入符号的补全** → 只做「补全已有符号时提示缺失 import」的弱形态或放弃，登记结论。

**Phase 0 报告（2026-09-26，详见上方）**：实测判定结局 C；用户裁决走自研路线（3.1 要点 2 回落方案）。

**Phase 1 — 自研实现（已落地，2026-09-26）**：
- 新增 `shell/src/autoImport.ts`：`topLevelSymbolNames` / `importedNames`（含 from-import 圆括号跨行成员）/ `autoImportContext` / `autoImportItems` 四个纯函数 + G-1 索引（前 200 个 .py 的顶层符号，TTL 5 分钟 + 会话缓存 + openWorkspace 重置，首次查询后台构建不阻塞按键）+ provider 注册。
- 语义：非 import 行、标识符前缀 ≥2 字符才触发；排除本文件已定义/已导入符号；候选项 `sortText 0yNN`（四层契约：模板 0NN < **0y** < 别名 0z < 1xx < 2xx——未导入符号引擎零结果，无 2xx 竞争）；选中后 `additionalTextEdits` 在模块头部（最后一条 import 下一行 / 模块头之后）插入 `from <module> import <name>`；importAlias 学习表 member 别名（`<module>.<name>`）命中时插 as 形态、编辑点用别名。
- `quickFix.ts` 的 `modulePathOf` 导出复用（模块路径归一唯一实现，禁止两处漂移）。
- 测试：`__tests__/autoImport.test.ts` 8 例（符号收集/importedNames 边界含圆括号跨行/上下文判定/前缀过滤/可见性排除/别名形态/上限排序）；e2e `dx/05-auto-import.spec.ts`（真实磁盘 fs bridge 数据源：输入前缀 → 候选带 import 预览 → 选中后头部插入 + 编辑点符号名）。
- 验证基线：`tsc` 全绿 · vitest 8/8 · e2e dx 12/12 + editor 03 回归 4/4 全绿。
- 已知边界：索引 TTL 内的工作区文件变更不做增量失效（与 G-1 灯泡扫描同口径）；第三方库符号（site-packages）不在 G-1 索引内，仍走灯泡 D-1/D-2 兜底。

**Review 修复（2026-09-26 独立审查后，五个 PR 一并回修）**：
- 【阻断】autoImport：`resetAutoImportIndex` 后旧工作区在途扫描会把旧符号脏写进新索引并刷新 TTL → 引入世代号，写回前校验世代，不等则丢弃。
- 【应修】autoImport：空索引（无 .py / 全读取失败）时 TTL 短路永不成立 → 每键全量重扫 200 文件。用 `indexReady` 完成态标志与「内容非空」解耦。
- 【应修】autoImport：候选先按索引序截断再排序，会丢更优候选 → 先排序后 `slice(0, MAX_ITEMS)`。
- 【应修】tabReopen：关闭栈跨工作区切换不清空，存量旧路径可被跨区重开（模块注释自相矛盾）→ `resetTabReopen()` 挂 openWorkspace。
- 【建议已采纳】topLevelSymbolNames 加 Python 硬关键字黑名单（`else:`/`try:` 曾被误收为 var）+ `async def` 收集；editPoints 过滤 `isUndoing/isRedoing` 且 `resetEditPoints()` 同点接线；命令面板四条改走 `keybindings.triggerEditorKeybindingAction`（消除与 handler 的双写漂移）；provider 补 `token.isCancellationRequested` 短路；saveCleanup 注释修正（Monaco model 在 create 时已归一 EOL，混合 EOL 分支不可达）。
- 【登记不改】reopen 失败的条目不回补栈（openFile 失败已有 toast 反馈，回补需 handler 返回值改造，收益低）；autoImport 的 additionalTextEdits 行号在 provide→accept 间可因用户增删行偏移（与 quickFix `findImportInsertLine` 同口径，偏移只影响位置不影响语法，后续可统一移入 resolve 重算）。
- 【审查确认无问题】runOnSaveActions 四消费方豁免完整；键位三处同步（54 项逐条比对）；settingsPanel 新字段三步接线 + 设置搜索自动覆盖；monaco.ts Canceled 过滤不会误吞 Tauri invoke 错误（字符串 reject 无 name/message）；saveCleanup 的 EOL 语义经 Monaco 源码核实自洽。

**Playwright 全量验收（2026-09-26，34 spec / 100 用例，11 域分 5 批）**：
- 结果：**100/100 全绿**（dx 12 · editor 12 · autosave+debug 23 · ux/p3/perf/plugins/session 41 · git 36 · lsp 17，含真实 pyrefly 桥 4 用例）。
- 验收中发现并修复 2 个**既存 spec 缺陷**（非本次功能回归，但值得登记）：
  1. `e2e/lsp/02-pyrefly-real.spec.ts`：两处 `boundingBox()` 在 PR-B sticky 计算加入渲染管线后稳定竞态失败 → 升级为 `expect.poll` 轮询（该 spec 注释本就登记过「资源紧张时拿到 null」的偶发）；
  2. `e2e/perf/01-output-guard.spec.ts` P-GUARD-1：三参 details 里的 `{ timeout: 90_000 }` 被 Playwright 静默忽略（details 只支持 tag/annotate/box），用例一直跑在全局 30s 上限，机器负载一高必超时 → 改为 `test.setTimeout(90_000)`。
- 方法论：全量验收失败先分「环境（dev server 被 watch 进程拖挂→ ERR_CONNECTION_REFUSED）/ 负载超时 / 真实回归」三类，用单独复跑定位；本次两处失败均非功能回归。
- 新 provider 注册入 `lspProviders`（main.ts openWorkspace 接线处，与 importAlias 同区）；sortText 契约按四层（新项入 0xx 段后缀钉序，勿闯 1xx/2xx）；
- 插入的 import 语句与已有 import 块合并：v1 不做智能合并，插完 toast 提示可 Ctrl+Alt+O 整理；v2 视用户反馈再评估插入后自动跑 organize imports；
- 与灯泡 CodeAction（`quickFix.ts:182`）并存：包未安装时补全项回落灯泡形态，不双发。

**测试**：vitest 纯函数（别名改写/插入文本构造）；e2e 真机桥（`02-pyrefly-real` 同款）：未导入符号 → 补全选中 → 断言文件头 import + 原编辑点符号名；mock 层补 `additionalTextEdits` 形状的假引擎。

### 6.6 第二梯队实施要点（每项独立 PR，按需启动）

| 项（PR 编号见 6.8） | 关键实施点（实测锚点） |
|---|---|
| PR-G · 文件内符号 Quick Pick | quickOpen 五处改动：`QuickOpenMode` 加 `"symbol"`（`:24`）→ `PLACEHOLDERS` 文案（`:331-336`）→ `buildItems` 加分支，直接把 `:251` 的 `if (mode === "all")` 放宽为 `all \|\| symbol` → `refresh`（`:452-459`）确保 `ensureSymbols()`（`:161-176`）被调 → 键位 `goto_symbol: Ctrl+F12`（editor 级）+ `openQuickOpen("symbol")` 入口。工作区级扩展另立 PR（PR-G2，可复用 autoImport.ts 的 G-1 符号索引：TTL + 会话缓存已具备） |
| PR-H · 全局搜索正则 + 文件 glob | Rust 侧：`fs_cmds.rs:677 search_workspace` 加 `use_regex: bool` + `file_glob: Option<String>` 参数；匹配层 `str::find`（`:899`）换 regex 分支（Cargo.toml **无 regex/globset，需新增**，建议 `regex = "1"` + `globset`，globset 与已用的 `ignore = "0.4"` 同族契合 WalkBuilder 的 glob 过滤）；TS：`runSearch`（`search.ts:168-172`）加参透传 + index.html 两个开关；Rust 单测照 `fs_cmds.rs:1830` 的 impl 级 `#[test]` 模式 |
| PR-I · 双击词查找引用 | 默认双击保持选词不破坏习惯；新增 **Ctrl+Shift+双击 = 查找引用**：编辑器 mouse 事件里判定 `e.event.shiftKey && ctrlKey` + 词非空 → `findUsages`（手势先例 Double Shift，`main.ts:2031-2047`；引用面板已有 `waitReferencesStable` 防抖） |
| PR-F · 保存语法错误提示 | `saveTab` 写盘前 `monaco.editor.getModelMarkers({ resource: model.uri })` 查 error 级 → toast「N 处语法错误（已保存）」，**不阻止保存**。**owner 实测结论（2026-09-26）**：三桶 = `opencharm-lsp` / `opencharm-intel`（`lsp/client.ts:1523`）+ `opencharm-ruff`（`ruffLint.ts:29`）；查全量（不带 owner 过滤）即可，与 `quickFix.ts:233-234` 双桶口径一致且更宽。走 `runActions` 门控：autosave / 运行前落盘不提示（自动化场景不打扰） |
| PR-K · 新建 .py 模板 | 设置 `new_file_template: boolean`（默认 false）；挂在新建文件流程，模板体复用 `live-templates/builtin.ts:248` header 模板；只对工作区新建生效，草稿（Ctrl+Alt+Shift+Insert）不插 |

**PR-K 落地记录（2026-09-27，已实现并全绿）**：
- **现状核实修正（比本档调研记录更进一步）**：调研记「新建文件为空」，实测文件树右键「新建 Python 文件」入口（`createPyFileAt`）**当时已会**无条件插 header 模板（无开关）；普通「新建文件」新建 .py 后缀仍为空。故本 PR 实际 = ①补设置开关门控（收敛两个入口为同一语义）；②普通「新建文件」输入 .py/.pyw 后缀也走模板。
- 设置项 `new_file_template`（**默认 false**，按本档「避免污染草稿流」；旧配置缺字段 `?? DEFAULT_SETTINGS` 兜底关）全链：state.ts + index.html 开关 + settingsPanel 三步接线 + Rust struct/Default 同步。
- 新增零依赖纯函数模块 `shell/src/newFileTemplate.ts`（`headerTemplateApplies(path, enabled)`：开关开 且 .py/.pyw 后缀大小写不敏感）——门控判定单一实现，禁止两入口漂移；`fileTree.ts` 两入口经 `insertHeaderIfEnabled` 共用。**行为变更登记**：`createPyFileAt` 由无条件插改为受开关门控（默认关，专属入口默认不再插文件头）。
- 草稿（`newScratch`）不走新建文件流程天然豁免，未改动。
- **e2e 环境缺口补齐（值得登记）**：tauri-mock 的 `FS_CMDS` 与 helpers 的 `FS_DISPATCH_CMDS` 此前**都没映射 `create_file`/`create_py_package`**——新建文件流程从未被 e2e 覆盖过（调研记「新建文件为空」却无人发现的根因）。已按 Rust `file_ops.rs` 语义补齐（已存在报错、父目录自动创建、写命令推送 fs-changed）。
- **e2e 实测两坑（已就地注释）**：① autosave=off 下模板插入只改内存 model 不落盘，断言必须走 `app.tabs[].model.getValue()` 而非磁盘 `repo.read()`；② boot 早期（未开任何文件）Ctrl+Alt+S 键位分发未就绪，开设置面板用标题栏 `#btn-settings` 按钮。
- e2e `e2e/dx/11-new-file-template.spec.ts`（2 例）：NT1 默认关 → 新建 Python 文件为空；NT2 开关开 → 自动插 `# -*- coding: utf-8 -*-` 文件头。
- 验证基线：`tsc` 全绿 · vitest newFileTemplate 5/5 · `cargo test` 218 全绿 · **e2e dx 域 25/25 全绿**（含真实 pyrefly 桥 2 例）。

**PR-L 落地记录（2026-09-27，已实现并全绿）**：
- 新增 `shell/src/ruffHints.ts`：`RUFF_HINTS` 精确规则码 → 中文速释表（首发 ~60 条，覆盖 E/W/F/I/N/UP/B/C4/SIM/RET/ARG/A/DTZ/ERA/S/T/RUF 等常见类别）+ `withRuffHint(code, message)` 纯函数（命中时在 `<code> <message>` 后追加 `\n\n〔速释〕<解释>`）。
- **落点比计划更轻**：计划设想「hover 补人话解释」，实际直接追加进 marker `message`（`ruffLint.ts` 构造处一行接入）——Monaco 诊断 hover 原生渲染多行消息，**无需自建 hover provider**，且问题面板/悬停两处同时受益。
- 维护纪律（已写进模块头注释 + 测试锁）：键为精确码不支持通配；解释「可执行」且以句号收尾；条目量上下限防意外清空/无限膨胀（`__tests__/ruffHints.test.ts` 8 例，含表卫生断言）。
- e2e 基建：mock 的 `ruff_lint` 支持 `window.__E2E_RUFF_LINT__` 预置诊断数组（仿 `__E2E_SETTINGS_PRESET__` 先例），使 marker 链路首次可被 e2e 覆盖。
- e2e `e2e/dx/12-ruff-hints.spec.ts`（2 例）：RH1 命中规则码追加〔速释〕段；RH2 未命中保持原形态 + 严重度映射不受速释影响。被测边界 = ruffLint marker 构造链路（hover 渲染是 Monaco 原生行为）。
- 顺带修复 PR-K 的 e2e flake：`dx/11` NT2 在 boot 未就绪时点「设置」按钮会被吞——点击前先等树渲染完成（两轮连跑确认消除）。
- 验证基线：`tsc` 全绿 · vitest ruffHints 8/8 · e2e dx 27/27 全绿（无 Rust 改动，cargo 不涉及）。

**PR-M 落地记录（2026-09-27，已实现并全绿）**：
- 新增 `shell/src/pasteJson.ts`：`jsonToPythonLiteral` 纯函数（完整合法 JSON 对象/数组 → 4 空格缩进 Python 字面量，尾逗号收内层；true/false/null → True/False/None；标量与非法 JSON 返回 null 不动）+ `installPasteJson`（`onDidPaste` 拦截：读粘贴范围 → 转换 → `executeEdits` 单次替换）。
- **语义收紧（比调研要点更严）**：只认 trim 后以 `{`/`[` 开头的**完整** JSON——裸 `true`/`42`/字符串一律不改写，避免误改用户要贴的原文；仅 `.py`/`.pyw` 文件触发。
- 设置项 `paste_json_to_python`（**默认开**——单次 executeEdits = 单一撤销粒度，Ctrl+Z 一步回原文，非破坏性；`!== false` 兼容旧配置）全链：state.ts + index.html 开关 + settingsPanel 三步接线 + Rust struct/Default 同步。main.ts 经 `lspProviders.add(installPasteJson(app.editor))` 收口。
- **e2e 实测坑（已就地注释）**：① 粘贴须走真实浏览器剪贴板 + Ctrl+V（`test.use permissions clipboard-*`）——`keyboard.insertText` 不触发 Monaco paste 管线，`onDidPaste` 不 fire；② 运行时 `app.settings.paste_json_to_python = false` 会被 boot 后的设置装载竞态覆盖，关闭开关的用例必须走 `__E2E_SETTINGS_PRESET__` 预置通道 + reload。
- e2e `e2e/dx/13-paste-json.spec.ts`（2 例）：PJ1 粘贴完整 JSON 就地转 Python 字面量（True/None/无 true/null 残留）；PJ2 预置关闭后原样保留。
- 验证基线：`tsc` 全绿 · vitest pasteJson 8/8 · `cargo test` 218 全绿 · **e2e dx 域 29/29 全绿**（含真实 pyrefly 桥 2 例）。
- **关联登记（不在本 PR 修）**：`devtools/curl2python/gen.ts::fmtDict` 用 `JSON.stringify` 冒充 Python dict 字面量，true/false/null 三值不合法——属 curl2python 的既存潜在缺陷，后续可复用 `jsonToPythonLiteral` 收口（单独立项）。
- **关联缺陷收口（2026-09-27，已实现并全绿）**：序列化实现抽至零依赖纯函数模块 `shell/src/pyLiteral.ts`（`pythonLiteralOf(value)` 单一实现），pasteJson 与 curl2python 同源复用；`fmtDict` 收口为薄封装（headers/cookies/data/params 纯字符串 dict 形态随迁为尾逗号风格，合法且 diff 友好；`json = <body>` 路径三值改写为 True/False/None）。新增 `__tests__/curl2pythonGen.test.ts`（3 例，curl2python 首次有测试覆盖）与 `__tests__/pyLiteral.test.ts`（3 例）。验证基线：`tsc` 全绿 · vitest 69 文件 / 664 用例全绿（无 Rust 改动、无 e2e 断言依赖旧输出形态）。
| PR-J · Ctrl+Space IME 探针 | 纯探针项：WebView2 + 中文 IME 下 Ctrl+Space 是否被系统输入法切换吞掉（Windows 惯例冲突）；产出结论：若被吞，注册 `Alt+/` 为「触发建议」备选键位（editor 级 + 键位表登记）；不被吞则只登记结论 |

另有三项未入 6.6 表（排期见 6.8）：**PR-L · ruff 规则中文速释**（ruffLint hover 补人话解释表，首发 30~50 条常见规则，量在内容无技术风险）· **PR-M · 粘贴 JSON → Python dict**（paste 拦截 + `devtools/jsonpath` 解析复用，设置开关，嵌套边界用例：true/False、null/None、引号转义）· **PR-N · 参数名行内提示**（唯一探针前置项：pyrefly 1.3.0 是否支持 `textDocument/inlayHint` 未验证，PR-E 已证明该引擎能力有缺口，不能想当然；不支持则登记放弃，禁止 shell 侧自研类型推断）。

**PR-F 落地记录（2026-09-26，已实现并全绿）**：
- `main.ts saveTab` 写盘前查 `getModelMarkers({ resource })`（**不带 owner 过滤 = 三桶统一覆盖**，比计划草案的「逐 owner 查」更简且与 quickFix 双桶口径一致更宽）；error 级计数 > 0 时 toast「`文件名`：N 处语法错误（已保存）」（error 级 8s 时长，读得完）；**不阻止保存**。
- `runActions` 门控：autosave / 运行前落盘 / git 改写磁盘等非显式路径不弹 toast（高频路径刷屏）——与 PR-C 保存清理同一显式保存纪律。
- e2e `e2e/dx/06-save-error-toast.spec.ts`（2 例）：marker 经 `state.ts` 动态 import 注入（mock 层无真实引擎，被测边界 = saveTab 的 marker 查询 + toast 行为）——SE1 error marker → toast 出现且落盘内容为编辑后值；SE2 仅 warning → 不弹。
- 验证基线：`tsc` 全绿 · vitest 278 例全过（33 个 DOM 文件仍为本机先在性损坏，与本次无关）· e2e dx 14/14 + editor 12/12 全绿。

**PR-G 落地记录（2026-09-26，已实现并全绿）**：
- quickOpen 三处：`QuickOpenMode` 加 `"symbol"` → `PLACEHOLDERS` 文案 → `buildItems` 符号分支放宽为 `all || symbol` 并给**当前文件符号 +15 加权置顶**（保留跨 tab 能力，同时贴近 PyCharm Ctrl+F12「本文件结构」语义）→ `refresh` 加 symbol 分支（**只 await `ensureSymbols()`，不拉文件清单**，秒开）；
- 键位 `goto_symbol: Ctrl+F12`（editor 级）三处同步（`keybindingDefaults.ts` 单一来源 / Rust `settings.rs` 漂移锁 54→55，**两处条目数断言**：default 与 partial-json）+ `welcomeShortcuts.ts` 网格；
- 接线三入口（键位 / 命令面板 /「前往」菜单）全部走 `kb.triggerEditorKeybindingAction("goto_symbol")`，handler 注册在 main.ts——**刻意不让 keybindings.ts 反向依赖 quickOpen 成环**；
- e2e `e2e/dx/07-symbol-quick-pick.spec.ts`（2 例）：Ctrl+F12 打开符号模式（占位符断言防模式串台）→ 模糊搜 `calctot` 命中 `calculate_total` → Enter 后光标落在定义行；跨 tab 符号在列（sub 显示 `a.py:5`）→ 选中后切 tab 并跳到第 5 行。
- 验证基线：`tsc` 全绿 · `cargo test` 214 全绿 · **e2e 全量 145/145 全绿**（键位表属全局影响面，跑全量回归而非只跑 dx 域）。
- 本机限制登记：`keybindings.test.ts` 漂移锁落在 DOM 损坏的 33 文件内**本机无法执行**；对称性由 Rust 侧 55 条目数断言 + TS `DEFAULT_SETTINGS.keybindings` 由 `KEYBINDING_META` 派生共同兜住，CI（Linux Node 正常环境）会真正跑它。

**PR-H 落地记录（2026-09-26，已实现并全绿）**：
- **依赖收敛（与计划的一处偏差）**：文件掩码没引 `globset`——走 `ignore` 自带 `OverrideBuilder`（同族、**走查期即剪枝**，语义同 .gitignore：无斜杠 `*.py` = 任意深度，与 PyCharm File mask 直觉一致）；Cargo.toml 只新增 `regex = "1"`。
- Rust `fs_cmds.rs`：`search_workspace` 加可选参 `use_regex` / `file_glob`（Option，旧调用方零感知）；正则**预编译一次**供多线程共享（编译失败报「正则表达式无效：…」，不静默退回子串）；正则分支列/长按**字符**计（其它分支是字节偏移，ASCII 等价，宽字符场景与前端高亮切片对齐）；掩码经 `collect_files_glob` 在走查期过滤。
- TS：新增零依赖纯函数模块 `searchFilters.ts`（`buildLineMatcher` 子串/正则同源 + `compileFileMask`，**掩码语义与 Rust 侧镜像，两处注释互指**）；`searchInFiles` 改用 LineMatcher + 掩码过滤；`runSearch` 加 `SearchOptions`；UI 加 `#search-regex`（`.*` 开关，与 Aa 同款接线）+ `#search-mask`（独立 `.search-box` 行，change/Enter 触发，不逐键重搜）。
- **e2e 实测踩坑（值得登记）**：`.search-box` 里 input 有固有 `min-width`，行内加按钮后窄侧栏下**横向溢出进编辑器区域**，被 `#center` 的 tab 关闭钮拦截点击（截图确认按钮被顶出侧栏）——修复 `.search-box input/select { min-width: 0 }`（产品级修复非测试特判）。
- 验证分层：Rust impl 级单测 4 例（正则列长/大小写/掩码任意深度与锚定/非法输入报错）覆盖 workspace 模式（浏览器 mock 无 Rust 进程，e2e 够不着）；vitest `searchFilters.test.ts` 14 例；e2e `08-search-regex-glob.spec.ts` 3 例只覆盖 scope 模式（同一查询串开/关正则结果不同的 crisp 断言 + 掩码排除 + 非法提示）。
- 验证基线：`tsc` 全绿 · vitest 292 例全过（33 个 DOM 文件仍为本机先在性损坏）· `cargo test` 218 全绿（214→218）· **e2e 全量 148/148 全绿**。

**PR-I 落地记录（2026-09-26，已实现并全绿）**：
- 实现 `findUsages.ts::installCtrlShiftDblclickUsages(editor)`（域内注册，不堆 main.ts），`lspProviders` 收纳；只在**同时按住 Ctrl+Shift** 时接管，默认双击选词零改动。
- **关键实测（三条，均已就地注释）**：
  1. **不能用 DOM `dblclick` 事件**——Monaco 在两次点击之间重绘行 DOM，两次点击的 target 不是同一节点，**浏览器不合成 dblclick**（探针计数：mousedown/mouseup 各 2、dblclick 0）。这是产品级事实（真实用户同样拿不到），故改用 `editor.onMouseDown` 自行判定「同位置 400ms 内两次点击」；
  2. 注册时 `editor.getDomNode()` 可能为空/后被替换（init 期注册曾静默失效）→ 不缓存 DOM 节点；
  3. Monaco 会在容器上 `stopPropagation` dblclick → 即使要用 DOM 事件也必须是**捕获阶段**。
- e2e `e2e/dx/09-usages-dblclick.spec.ts`（2 例）：FU1 手势 → 引用面板「全部 (3) / 定义 (1) / 调用 (1)」；FU2 普通双击仍选词且**不**拉起面板。
- 坐标方法论：`locator("span", {hasText}).dblclick()` 会点到整行/相邻 token（曾落到 `import`），必须用 **Range 圈出子串取矩形中心**；修饰键只能靠 `keyboard.down` 按住（`page.mouse.*` 与 `dblclick({modifiers})` 实测都拿不到/不派发）。
- 验证基线：`tsc` 全绿 · e2e dx + lsp **38/38 全绿**（含真实 pyrefly 桥与 Alt+F7 既有链路回归）。

#### PR-J 探针报告（2026-09-26 D4 PM）：Ctrl+Space × 中文 IME

- **现状核实**：Ctrl+Space **不在**任何自研代码里（全库 0 命中），它是 Monaco 内建 `editor.action.triggerSuggest` 的默认键位（suggest contribution 已显式引入 `monaco.ts:42`）；`browserKeys.ts` 护栏不拦截（0 命中）；按横切纪律属**固定键**，不进键位表 → 不可配置、不可发现。
- **冲突性质**：Windows 中文输入法默认把 Ctrl+Space 用作「输入法开关」系统热键，是否先于 WebView2 被系统消费，取决于用户本机的 IME 设置（多数 IME 可关闭该热键，但默认开启）。
- **能否自动验证：不能**（这是本次探针的结论性判断）：浏览器 e2e 是 mock 无 IME 层；CDP / 合成键事件**绕过 IME**，只能验证应用内链路（已由 lsp/01 的补全用例覆盖），无法证明「系统是否吞键」。真机结论只能**人工复现**：切到中文输入法 → 编辑器内按 Ctrl+Space → 观察是切输入法还是弹补全。
- **决策建议**（低成本零风险，待裁决）：无论是否被吞，都可新增可配置键位 `trigger_suggest`（`Alt+/`，editor 级，keybindingDefaults + Rust 漂移锁 55→56 + 命令面板入口）——保证任何 IME 配置下都有可用入口，且不动固定键语义；若人工验证确认未被吞，则只保留本报告的登记结论。

**PR-J 人工验证结论 + 落地记录（2026-09-27，已实现并全绿）**：
- **人工验证（Windows 11 + 微软拼音）**：切中文输入法 → 编辑器内按 Ctrl+Space → **执行的是输入法中英切换**，补全未弹出——确认系统 IME 热键先于 WebView2 消费该键。按决策建议落地备选键。
- 键位 `trigger_suggest: Alt+/`（editor 级；可重绑可发现，不走「固定键」路线）全链：`keybindingDefaults.ts`（id + META 条目）→ `keybindings.ts` handler（`editor.action.triggerSuggest`，带 `.action` 前缀，同 deleteLines 家族）→ Rust `settings.rs` default_keybindings + **两处条目数断言 55→56** → 命令面板入口（走 `triggerEditorKeybindingAction` 同 handler）→ welcomeShortcuts 网格。
- Ctrl+Space 本体不动（Monaco 内建固定键；IME 未吞键的配置下仍可用）。
- e2e `e2e/dx/14-trigger-suggest.spec.ts`（1 例）：输入 `s.` 自动弹补全 → Escape 关闭 → **Alt+/ 重新唤起** 且含 str 成员——证明键位解析与 handler 接线正确（IME 吞键本身无法在浏览器 e2e 复现，探针报告已论证）。
- e2e 实测坑：dblclick 打开文件后焦点留在文件树（`focusEditor:false`），键入前必须点进编辑器，否则按键全部丢失。
- 验证基线：`tsc` 全绿 · `cargo test` 218 全绿（56 断言生效）· **e2e dx 域 30/30 两轮全绿**。

**PR-N 落地记录（2026-09-27，已实现并全绿）**：
- **零 Rust 改动的推送方案（与计划的一处偏差）**：`lsp.rs` 不需要加 didChangeConfiguration 通道——TS 桥本来就有 `notifyEngine`，`client.ts::pushInlayHintSettings()` 直接发 `workspace/didChangeConfiguration`（Pyright 兼容形态 `python.analysis.inlayHints.callArgumentNames`）。调用点两处：`startEngine` 就绪后 + `settingsPanel.saveSettingsPanel`（开关即时生效，无需重启引擎）。
- **只推 `callArgumentNames`**：变量/返回类型提示是引擎默认开的能力，不在此关掉——「关参数名提示」的开关不顺手灭掉类型提示（职责最小化）。
- Provider 扩双源：静态引擎（参数名，受 `inlay_param_hints` 开关）+ intel（运行时类型标注，P3-T07 既有，不受开关影响）；同位置同文案去重 + 按位置排序；单源失败静默（inlay 是增强信息）。
- 设置项 `inlay_param_hints`（默认开）全链：state.ts + index.html 开关 + settingsPanel 三步接线 + Rust struct/Default + `pushInlayHintSettings()` 挂保存路径。
- **三个实测坑（已就地注释）**：
  1. 配置推送必须放在 `status = "ready"` **之后**——`pushInlayHintSettings` 自带「未就绪即短路」守卫，放前面会被自己短路（曾导致引擎永远收不到配置、inlayHint 返回 []）；
  2. `monaco.Emitter` 不能模块级创建（`monaco` 是后赋值引用）→ 延迟到 `registerLspInlayHints` 内创建，存模块变量供 `fire()`；
  3. Monaco 会缓存 provider 结果——开关即时生效必须实现 `onDidChangeInlayHints` 事件并在推送后 `fire()`。
- **e2e 环境教训（重要，登记）**：真实 pyrefly 桥的临时仓库**必须有 `pyproject.toml`**——否则引擎不建工作区索引，`inlayHint` 连变量类型提示都返回 []（与引用计数那次 cwd/config 教训同源）；且提示插入后整行渲染文本变化，`hasText` 定位不能用原始调用串。
- e2e `e2e/dx/10-inlay-param-hints.spec.ts`（2 例，真实 pyrefly 桥）：IP1 调用处出现 `a=` / `b=` 参数名提示；IP2 设置关掉后提示消失（didChangeConfiguration + onDidChangeInlayHints 即时生效链路）。
- 验证基线：`tsc` 全绿 · `cargo test` 218 全绿 · **e2e 全量 153 例 152 过**——唯一失败 `git/11-gutter-hunks`（toast「未检测到 Python 环境」）单独复跑 3/3 全绿，判定为全量跑 14 分钟高负载下的环境 flake，非真实回归。

### 6.7 PR 切分与验证基线

| PR | 内容 | 量级 |
|---|---|---|
| PR-A | 6.1 键位补齐组 + 复制 file:line | 半天 |
| PR-B | 6.2 Sticky Scroll | 半天 |
| PR-C | 6.3 保存清理 | 半天 |
| PR-D | 6.4 最近编辑位置 | 一天 |
| PR-E | 6.5 auto-import（Phase 0 探针报告单独出） | 探针半天 + 实现 1-2 天 |

- 第二梯队每项独立 PR；第三梯队（Extract refactor）探针报告先出、后立项。
- 每 PR 通用验收：`tsc` 全绿 + vitest 新增用例全绿 + `cargo test`（涉及 Rust 时）+ 相关 e2e + `welcomeShortcuts.ts`/菜单/设置文档同步；CI 全绿合并。
- 顺序执行建议：PR-A → PR-B → PR-C → PR-D（互不依赖，A/B 可并行），PR-E 探针与 PR-A 并行启动。

### 6.8 第二梯队排期（2026-09-26 排定：7 个工作日主线 + 1 天条件项）

> 前提：第一梯队 PR-A~E 已于 2026-09-26 全部落地并全量验收（34 spec / 100 用例全绿）。
> 排序理由：① 唯一不确定项（PR-N 的 inlay 探针）前置到 D1 出结论，不悬尾巴；② PR-G 趁 autoImport 的 G-1 符号索引（PR-E 刚落地）上下文最热；③ 动 Cargo.toml 的 PR-H 单独占一天，避免 Rust 改动与其他 PR 交叉；④ D5 起全是低风险独立项，收尾回归成本最低。

| 日 | PR | 内容 | 量级 | 备注 |
|---|---|---|---|---|
| D1 AM | **PR-F** | 保存时语法错误提示 | 半天 | 无键位/无 Rust/无设置项，打头阵热身；owner 三桶实测结论已登记（6.6） |
| D1 PM | 探针 | pyrefly `textDocument/inlayHint` 探针报告 | 半天 | 复用 PR-E 探针骨架（Node 裸 LSP 会话）；结论决定 PR-N 立项或登记放弃 |
| D2 | **PR-G** | 文件内符号 Quick Pick | 1 天 | `goto_symbol` 键位 + 漂移锁三处同步（54→55） |
| D3 | **PR-H** | 全局搜索正则 + 文件 glob | 1~1.5 天 | Cargo.toml 新增 `regex` + `globset`，Rust 单测 + TS 透传 + e2e |
| D4 AM | **PR-I** | Ctrl+Shift+双击查找引用 | 半天 | 手势先例 Double Shift；`waitReferencesStable` 防抖现成 |
| D4 PM | **PR-J** | Ctrl+Space IME 探针 | 半天 | 本机即真实环境（Windows + 中文 IME）；若被吞则 `Alt+/` 备选键当天落地 |
| D5 | **PR-K** | 新建 .py 模板 + ruff 中文速释启动 | 1 天 | 模板默认关；速释首发 30~50 条常见规则 |
| D6 | **PR-L / PR-M** | ruff 中文速释收尾 + 粘贴 JSON→dict | 1 天 | JSON 转换需嵌套边界用例（true/False、null/None、引号转义） |
| D7 | **PR-G2** | 工作区级符号 Quick Pick（v2 扩展） | 1 天 | 复用 autoImport G-1 索引；评估 200 文件上限的延迟预算 |
| D8 | **PR-N** | （条件项）参数名行内提示 | 1 天 | 仅当 D1 探针判定 pyrefly 支持 inlayHint；否则正式登记放弃 |

- 每 PR 通用验收同 6.7；顺序执行，PR-F 打头阵，探针（inlayHint）与主线穿插不占独立日。
- 键位横切：PR-G/I/J 若新增键位，一律走 `keybindingDefaults.ts` 单一来源 + Rust 漂移锁同步；设置项一律 `!== false` 兼容旧配置。

#### 进度快照（2026-09-27 收工时点，新会话续推从这里开始）

| 项 | 状态 | 落地记录 / 说明 |
|---|---|---|
| PR-F 保存语法错误提示 | ✅ 已落地（e2e dx/06） | 6.6 PR-F 落地记录 |
| PR-N inlay 探针 → 转正 | ✅ 探针 + 实现均完成（e2e dx/10，真实 pyrefly 桥） | 6.8 PR-N 探针报告 + 落地记录 |
| PR-G 文件内符号 Quick Pick | ✅ 已落地（e2e dx/07，Ctrl+F12，漂移锁 55） | 6.6 PR-G 落地记录 |
| PR-H 全局搜索正则 + 文件 glob | ✅ 已落地（e2e dx/08，Cargo 只加 `regex`，掩码走 ignore overrides） | 6.6 PR-H 落地记录 |
| PR-I Ctrl+Shift+双击查找引用 | ✅ 已落地（e2e dx/09；**不能用 DOM dblclick**，见记录三条实测） | 6.6 PR-I 落地记录 |
| PR-J Ctrl+Space IME 探针 | ✅ 已落地（人工验证确认吞键 → `trigger_suggest: Alt+/` 备选键全链 + e2e dx/14，键位表 55→56） | 6.6 PR-J 落地记录（探针报告 + 人工验证结论） |
| PR-K 新建 .py 模板 | ✅ 已落地（e2e dx/11，默认关；**mock 桥补齐 create_file 映射**、`createPyFileAt` 改为门控，见落地记录） | 6.6 PR-K 落地记录 |
| PR-L ruff 规则中文速释 | ✅ 已落地（e2e dx/12；速释表 `ruffHints.ts` 首发 ~60 条，hover 经 marker 消息原生渲染） | 6.6 末尾 PR-L 落地记录 |
| PR-M 粘贴 JSON → Python dict | ✅ 已落地（e2e dx/13，默认开、单步可撤；`pasteJson.ts` 纯函数 + onDidPaste 拦截） | 6.6 末尾 PR-M 落地记录 |
| PR-G2 工作区级符号 Quick Pick | ✅ 已落地（e2e dx/15；复用 G-1 索引加 file/line 字段 + 就绪订阅，键位仍 Ctrl+F12） | 6.8 末尾 PR-G2 落地记录 |

**续推须知（恢复上下文的最短路径）**：
1. 各 PR 的实测坑与「计划 → 实现差异」全部写在 6.6/6.8 的落地记录里，动手前先读对应记录（尤其 PR-I 的 DOM dblclick 三条、PR-H 的 min-width 溢出、PR-N 的推送时序/pyproject.toml/e2e 定位三条）；
2. 本机验证基线（2026-09-27 第三次更新）：`cargo test` 218 全绿 · `tsc` 全绿 · e2e dx 域 34/34 全绿（含真实 pyrefly 桥 4 例）· vitest 69 文件 / 664 用例全绿；
3. **本机 vitest 环境已修复（2026-09-27）**：原「33 个 DOM 测试文件先在性损坏」根因有三层，全部定位并修复——① **盘符大小写**：从小写 `d:` 进入时 worker 模块解析与 runner 全局状态不一致（vitest#10812 同族），修复 = `scripts/vitest-launch.mjs` 启动器先 chdir 到 realpath 再拉起 vitest（Linux CI realpath 幂等无影响）；② **Node 22.4+ 实验性 webstorage**：全局 localStorage 被 Node 不可用实现占位，happy-dom populateGlobal 检测到键存在即跳过填充 → 测试里 localStorage undefined，修复 = 启动器注入 `--no-experimental-webstorage`（Linux CI 本由 happy-dom 提供，无行为变化）；③ **happy-dom 20.11.6 的多文件循环 teardown 缺陷**，修复 = 降级至同代 18.0.1（package.json/lock 已同步，CI 需注意重新验证）；另显式补声明 `@types/node`（此前靠传递依赖顶层提升碰巧可用）与 welcomeShortcuts 行数锁 14→19（PR-A/D/G/J 加行时因环境损坏欠账）。**验证：`npm run test` 全量 vitest 67 文件 / 331 用例三连全绿（小写盘符进入复现条件）**。npm run test 已接入启动器，用法不变；
4. **第二梯队全部收官**（PR-G2 已落地，见 6.8 末尾记录）；DX 储备清单无剩余项——import 别名链路 §1 登记的三条边界也已全部收口（PR-P/Q，见 §1.1/§1.2）；后续另立新档需重新调研（如引擎能力缺口对照表、新功能盘点）。

#### PR-G2 落地记录（2026-09-27，已实现并全绿；第二梯队至此全部收官）
- **数据源复用（按计划）**：quickOpen symbol 模式（Ctrl+F12）在已打开 tab 的 documentSymbol（PR-G）之外，并入 `autoImport.ts` 的 G-1 工作区顶层符号索引（PR-E 落地，同一份索引双消费方，无新建扫描管线）。
- **索引能力扩展**（autoImport.ts）：`topLevelSymbolNames` 增加 `line`（1-based 行号，纯函数）；`IndexSymbol` 增加 `file`（绝对路径）/`line` 字段——quickOpen 跳转需要文件+行号，auto-import 语义不受影响；新增 `workspaceSymbolsSnapshot(root)`（顺带触发后台构建）与 `onWorkspaceIndexReady(cb)` 就绪订阅（构建完成后 fire，一次性退订）。
- **排序与去重语义**：已打开标签的文件由 documentSymbol 覆盖（含方法/嵌套层级，质量更高），工作区符号**跳过这些文件**避免双条目；G-1 只有顶层符号无容器名，给 **-3 小罚分**排在同分 tab 符号之后（罚分 < 连续匹配 +8 的档位差，不淹没强候选）。
- **首开体验**：symbol 模式秒开只等 documentSymbol（PR-G 口径不变）；G-1 未就绪时先展示 tab 符号，索引构建完成后经订阅**重刷一次**（token 守卫防旧弹窗覆盖；一次性订阅自动退订）。
- 占位符文案更新：「搜索符号（已打开文件 + 工作区，Enter 跳转）」——**dx/07 的精确断言已同步**（存量 spec 漂移点）。
- e2e `e2e/dx/15-workspace-symbols.spec.ts`（2 例）：WS1 未打开文件的顶层 def 在列（sub=`b.py:6`）→ Enter 跳转且光标落定义行；WS2 类与顶层赋值（var）同样可搜可跳（util.py:1）。
- 全量回归登记：dx 域合跑曾出现 10 例失败 + artifacts ENOENT，失败子集单独复跑 11/11 全绿、再跑全量 32/32 全绿——判定高负载环境 flake（方法论同 PR-E 验收登记），非真实回归。
- 验证基线：`tsc` 全绿 · vitest autoImport 10/10（新增 CRLF 行号用例）· **e2e dx 域 32/32 全绿**（含真实 pyrefly 桥 2 例；无 Rust 改动）。

#### PR-N 探针报告（2026-09-26 D1 PM 实测，pyrefly 1.3.0 裸 LSP 会话，脚本复用 PR-E 探针骨架）

受控项目（pyproject.toml [project] + lib.py 双参函数 + main.py 多形态调用），initialize 带 inlayHint client capabilities，didOpen 等索引后发 `textDocument/inlayHint`：

- **引擎原生支持**：`initialize.capabilities.inlayHintProvider === true`（非 MethodNotFound，PR-E 的「引擎能力有缺口」结论仅限补全，不适用于 inlay）；
- **三类提示齐全**，行为与官方文档（pyrefly.org IDE-features）一致，复用 Pyright 的 `python.analysis.inlayHints.*` 设置语义：
  - `variableTypes` / `functionReturnTypes` 默认开——实测未注解变量出 `: int` 形态提示，**携带 textEdits**（可点击插入注解；label 是分段数组含 typeshed location）；
  - `callArgumentNames` 默认 **off**——裸会话默认只有 3 条类型提示，调用处无参数名；
  - **`workspace/didChangeConfiguration` 推 `{"python":{"analysis":{"inlayHints":{"callArgumentNames":"all"}}}}` 后立即生效**：8 条提示，含 `a=` / `b=` / `times=` / `loud=` / `*values=`（位置参数、实例方法跳 self、`*args` 保留星标全部正确）；
  - 引擎侧自带 150ms 防抖（输入不抖动）。
- **判定：PR-N 由条件项转正立项**。实施要点：
  1. Rust `lsp.rs`：目前**无 didChangeConfiguration 通道**（全库 0 命中）——initialize 就绪后补发一次 + 设置变更时补发；设置真值进 `Settings`（建议 `inlay_hints`：off/all/partial 三档或 boolean，默认对齐 PyCharm=开）；
  2. TS `lsp/client.ts`：`registerLspInlayHints()`（`:1473`）现**只查 intel**——扩展为静态引擎 + intel 双源（注意双源并存时去重/归属：静态=类型+参数名，intel=运行时标注，kind 已有 Type/Parameter 区分）；pyrefly 的 label 分段数组现映射逻辑已兼容（`:1491` join）；
  3. 风险登记：Monaco InlayHintsProvider 对 `textEdits`（点击插入注解）的支持度待 PR-N 动工时实测，不支持则降级纯显示。

#### Extract 重构探针报告（2026-09-27，PR-O 前置探针；脚本 `bench/extract-refactor-probe/probe.cjs` · 原始报告 `bench/reports/extract-refactor-probe-{pyrefly,basedpyright}.json` · 受控靶场 `bench/sample/extract_refactor/`）

- **引擎版本口径（探针先决发现）**：本机 `uv tool` 装的 pyrefly 是 **1.2.0**（旧），探针必须走 `uv tool run pyrefly@1.3.1 lsp` 才命中 `ci/versions.toml` 锁定版；basedpyright 同理须 `--from basedpyright@1.39.10`（不锁会拉到 1.40.1）。后续任何裸会话探针照此办理。
- **pyrefly 1.3.1：原生支持 refactor 类 code action，立项条件成立**：
  - 选区罩住表达式（0-based 行/字符区间）→ `textDocument/codeAction` 返回 **`refactor.extract` 三项全给**：Extract into variable `extracted_value` / Extract into helper `extracted_function` / Introduce parameter `param`；
  - **直接带 `WorkspaceEdit`（changes 形态）**，无 command / codeAction-resolve 往返（比 pyright 血统的 applyRefactoring 两段式简单得多）；
  - `context.only=["refactor"]` / `["refactor.extract"]` 过滤均生效；return 长表达式选区另给 `refactor.inline`（Inline variable）与 `refactor.rewrite`（Invert boolean）；
  - 端到端质量（模拟应用 edit 逐例核对）：**extract variable 与 introduce parameter 产出完全正确**（赋值行插入位置/缩进、签名参数追加、调用点替换全对）；**extract helper 函数体漏 return**（`def extracted_function(price, qty):` 体只有裸表达式 `price * qty`，值语义断裂）——pyrefly 成熟度缺陷，非协议问题；
  - initialize 需声明 `codeAction.codeActionLiteralSupport`（+ dataSupport/resolvesSupport）才会返回动作清单；didOpen 后等首诊断（探针 3s + 轮询）即就绪。
- **basedpyright 1.39.10：refactor 动作 0 项——修正本档原「basedpyright 已支持」的判断**：
  - 引擎存活（hover 正常返回）但裸 LSP 会话 codeAction 恒空；对 langserver bundle 源码核实：`CodeActionProvider.mightSupport` 注释「**Only support quick fix actions**」、`CommandController.isRefactoringCommand() { return false; }`——重构是 Pylance / basedpyright VS Code 扩展侧能力，**不随开源 langserver 分发**；
  - 「并入 basedpyright 引擎推荐链路」的期待不成立：切备选引擎时 Extract 功能自然缺失（与 PR-E auto-import 的 pyrefly 缺口正好互补，引擎选择时需对照此表）。
- **判定与量级**：产品管线 `lsp/client.ts:1436-1457`（`registerLspCodeAction`）已透传带 edit 的引擎动作且 `kind` 直通 Monaco——refactor 动作**可能已能进 Ctrl+. 灯泡**，shell 侧自研成本不再成立担忧。PR-O 实施内容收敛为：① 产品内真机验证（选区 → 灯泡 → 应用 edit）；② **extract helper 过滤策略裁决**（建议：按 title 过滤直至 pyrefly 补 return，避免一键产出坏代码）；③ e2e 一例（mock 层按探针报告伪造 refactor.extract action 形状）。半天级。
- 待裁决（动工前确认）：① helper 过滤（建议过滤）；② 灯泡分组文案是否需要调整（Monaco 按 kind 分组，预计零改动）；③ `Introduce parameter` 是否保留（产出正确但语义上不如 extract variable 直觉，可全保留交用户选择）。

#### PR-O 落地记录（2026-09-27，已实现并全绿；第三梯队 Extract 重构至此落地）
- **shell 侧改动收敛为两处**（引擎原生 + 管线已透传，探针判定兑现）：
  1. `quickFix.ts` 新增纯函数 `isSuppressedEngineAction(title)`：抑制 pyrefly 的 `Extract into helper` 变体（探针实测 1.2.0/1.3.1 函数体均漏 return，一键即产出坏代码），仅作用于引擎下发动作、自研 D-1/D-2 不经此判断；`Introduce parameter` 产出正确予以保留；
  2. `lsp/client.ts::registerLspCodeAction` 接入该过滤；**顺带修复一个 CR-22 同族隐患**：`codeActionEditToMonaco` 原以 `uri !== modelUri` 严格比较丢弃非当前文件的 edit——Windows 盘符大小写/编码形态与 `model.uri.toString()` 逐字不等时 edit 整块静默丢失（探针实测 pyrefly 回 `file:///D:/...`），改为 decode + 分隔符归一 + 小写后比较（`normUri`）。
- **e2e `e2e/dx/16-extract-refactor.spec.ts`（2 例，真实 pyrefly 桥）**：ER1 选区 → Ctrl+. 菜单 → 应用 Extract into variable → model 断言插入 `extracted_value = PRICE * QUANTITY` 且调用点替换；ER2 抑制清单生效（helper 不进菜单）+ Introduce parameter 保留。
- **e2e 实测坑（已就地注释）**：① Monaco 0.52 的 code action 菜单走 ActionWidget（`.action-widget` + `.monaco-list-row`），**打开时不设初始焦点**——Enter 不可靠，行点击的 locator.click 会因 hover 触发列表重渲染无限重试（row 节点重建），须取 boundingBox 后 `page.mouse.click` 坐标点击；② 选区经 `app.editor.setSelection`（state.ts 动态 import）注入，比 monospace 估宽鼠标拖拽稳定；③ pyrefly 1.2.0 起即支持 refactor.extract（探针 pyrefly_path 组实测），e2e 对本机 PATH 版本不敏感，但 helper 漏 return 两版本一致、过滤不可省。
- 验证基线：`tsc` 全绿 · vitest 67 文件 / 658 用例全绿（quickFix 18 含新增 3 例）· **e2e dx 域 34/34 全绿**（dx/16 新增 2 例，含真实 pyrefly 桥；无 Rust 改动，cargo 不涉及）。
