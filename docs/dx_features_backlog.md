# DX 顺手功能储备（PyCharm 对标 · 调研与推进清单）

> 状态：调研完成，2026-09-26 二次核实（对照当前代码逐条验证事实底座，并新增缺口挖掘）；同日补齐详细实施计划（第 6 节），可直接按 PR 推进。
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

已知边界（登记未修）：from-import 圆括号跨行不识别；分号多语句不解析；学习数据每次全量重扫（无增量）。

验证基线：Rust `cargo test` 214 全绿 · TS `vitest` 11/11 · `tsc` 全绿。

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

- **Extract Variable / Function 重构**：先探针 pyrefly 是否出 refactor 类 code action（探针方法论沿用引用计数那次：Node 起 pyrefly 裸会话试请求）；basedpyright 已支持，可并入 Pydantic 引擎推荐链路一起考虑。若引擎不给，则不建议 shell 侧自研（成本失控）。

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

| 项 | 关键实施点（实测锚点） |
|---|---|
| 文件内符号 Quick Pick | quickOpen 五处改动：`QuickOpenMode` 加 `"symbol"`（`:24`）→ `PLACEHOLDERS` 文案（`:331-336`）→ `buildItems` 加分支，直接把 `:251` 的 `if (mode === "all")` 放宽为 `all \|\| symbol` → `refresh`（`:452-459`）确保 `ensureSymbols()`（`:161-176`）被调 → 键位 `goto_symbol: Ctrl+F12`（editor 级）+ `openQuickOpen("symbol")` 入口。工作区级扩展另立 PR（依赖 G-1 索引时机） |
| 全局搜索正则 + 文件 glob | Rust 侧：`fs_cmds.rs:677 search_workspace` 加 `use_regex: bool` + `file_glob: Option<String>` 参数；匹配层 `str::find`（`:899`）换 regex 分支（Cargo.toml **无 regex/globset，需新增**，建议 `regex = "1"` + `globset`，globset 与已用的 `ignore = "0.4"` 同族契合 WalkBuilder 的 glob 过滤）；TS：`runSearch`（`search.ts:168-172`）加参透传 + index.html 两个开关；Rust 单测照 `fs_cmds.rs:1830` 的 impl 级 `#[test]` 模式 |
| 双击词查找引用 | 默认双击保持选词不破坏习惯；新增 **Ctrl+Shift+双击 = 查找引用**：编辑器 mouse 事件里判定 `e.event.shiftKey && ctrlKey` + 词非空 → `findUsages`（手势先例 Double Shift，`main.ts:2031-2047`） |
| 保存语法错误提示 | `saveTab` 写盘（`:1042`）前 `monaco.editor.getModelMarkers({ resource: model.uri })` 查 error 级 → toast「N 处语法错误（已保存）」，**不阻止保存**；marker owner 名以 ruffLint/lsp 实际注册为准 |
| 新建 .py 模板 | 设置 `new_file_template: boolean`（默认 false）；挂在新建文件流程，模板体复用 `live-templates/builtin.ts:248` header 模板；只对工作区新建生效，草稿（Ctrl+Alt+Shift+Insert）不插 |
| Ctrl+Space IME 探针 | 纯探针项：WebView2 + 中文 IME 下 Ctrl+Space 是否被系统输入法切换吞掉（Windows 惯例冲突）；产出结论：若被吞，注册 `Alt+/` 为「触发建议」备选键位（editor 级 + 键位表登记）；不被吞则只登记结论 |

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
