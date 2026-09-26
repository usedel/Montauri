# DX 顺手功能储备（PyCharm 对标 · 调研与推进清单）

> 状态：调研完成，待排期推进。
> 来源：import 别名补全（已落地）延伸出的「顺手/爽」功能调研；2026-09-26。
> 约定：本档与开发计划冲突时以 `python_ide_dev_plan_v2.md` 为准；实现落地区分 shell 侧（纯前端/自研命令）与引擎侧（pyrefly/intel）。

## 1. 已落地：import 别名补全链路（2026-09）

对标 PyCharm「import pandas as pd」补全，三层触发形态 + 两层知识源 + 持久化：

| 能力 | 形态 |
|---|---|
| ① 变体项 | `import pand` → `pandas as pd`（整段替换，点分路径支持） |
| ② 别名补全 | `import pandas as ` → `pd` |
| ③ 成员别名 | `from pandas import DataFrame as ` → 学到的别名（仅学习表，无内置） |
| 知识源 | 内置 19 库别名表（兜底）+ 工作区频率学习（学习命中优先、按 target 去重） |
| 持久化 | 工作区 config `import_aliases` 键（与 `framework_hints`/`dep_ignored` 同文件）；打开工作区 = 缓存秒生效 + 后台重扫回写 |

关键路径：`shell/src/importAlias.ts`（provider + 纯函数）· `shell/src/__tests__/importAlias.test.ts`（11 例）· `shell/src-tauri/src/fs_cmds.rs`（`scan_import_aliases` / `read_import_aliases` + `parse_import_alias_line` 纯函数）· `main.ts`（openWorkspace 接线 `refreshImportAliases` + provider 注册入 `lspProviders`）。

已知边界（登记未修）：from-import 圆括号跨行不识别；分号多语句不解析；学习数据每次全量重扫（无增量）。

验证基线：Rust `cargo test` 214 全绿 · TS `vitest` 11/11 · `tsc` 全绿。

## 2. 现状核实结论（推进前的事实底座，2026-09-26 核实）

| 事实 | 结论 | 证据 |
|---|---|---|
| 条件断点/日志断点/命中条件 | **已有完整链路**，勿重复立项 | `dap/client.ts:71-95,378-391`（condition/hitCondition/logMessage 全传）+ `main.ts:1385-1435` 右键菜单 |
| format on save / 整理 imports | **已有**（仅显式 Ctrl+S 触发；autosave/失焦/运行前落盘刻意跳过） | `main.ts:1021-1037`、`format.ts` |
| Monaco 编辑器选项 | `guides`/`bracketPairColorization` 已有且带设置开关；**stickyScroll 零配置** | `settingsPanel.ts:297-301`、`state.ts:53-55` |
| additionalTextEdits 透传 | **已通**：completionItem/resolve 后回填，Monaco 原生应用 | `lsp/client.ts:37,662-665` |
| 缺失 import 兜底 | **只有灯泡形态**（CodeAction，扫描工作区顶层符号上限 200 文件）；无补全内联插入 | `quickFix.ts:182-222`（G-1 符号索引可复用） |
| 复制 `file:line` | **没有**（复制三件套只有文件名/相对/绝对路径） | `main.ts:474-477`、`fileTree.ts:489-495` |
| 最近编辑位置 | **没有**（`editHistory.ts` 是数据源，无导航入口；`navHistory.ts` 是光标位置栈，语义不同） | — |
| 文件内符号 quick pick | **没有**（outline 已消费 documentSymbol，数据源现成） | — |
| 编辑器设置项 | font/tab/word_wrap/minimap/indent_guides/bracket_colors/autosave/format_on_save 等；**无 stickyScroll** | `state.ts:98-138` |

## 3. 候选清单（按性价比分梯队）

### 第一梯队：低成本、强感知（纯 shell 侧，符合架构铁律）

#### 3.1 补全内联 auto-import（推荐首做，对标 PyCharm 王牌）

- **体验**：直接写 `DataFrame` → 补全项带 `from pandas import DataFrame`，选中自动在文件头插入 import；未安装包时仍回落灯泡「安装 X」。
- **实现要点**：
  1. 优先验证 pyrefly 补全项是否原生携带 `additionalTextEdits`（import 语句插入）——若是，shell 侧只需透传排序（已透传，工作量趋近零）；
  2. 若否，回落自研：`quickFix.ts` 的 G-1 工作区符号索引（上限 200 文件）改造为补全数据源，import 插入位置沿用 `importAction` 的「模块头部 textEdit」逻辑；
  3. 别名知识接入：插入 `import pandas as pd` 时优先用 `importAlias.ts` 的学习/内置表（链路已通）。
- **风险**：与静态引擎 `2xx` 补全段的 sortText 竞争；import 插入与用户已有 import 块的合并（可借 ruff organize imports 收口）。
- **验收建议**：e2e 真机桥（`02-pyrefly-real` 同款）——未导入符号补全 → 选中 → 断言文件头出现 import 且原编辑点插入符号名。

#### 3.2 Sticky Scroll（粘性滚动）

- **体验**：长文件滚动时，当前作用域（def/class）头部行常驻编辑器顶部。
- **实现要点**：Monaco 0.52 内建，`buildEditorOptions` 加 `stickyScroll: { enabled: settings.sticky_scroll }`；`DEFAULT_SETTINGS` 加 `sticky_scroll: true`；设置面板「编辑器」区加开关（走 UI-11/29 设置刷新三层接线）。
- **量级**：半天内，含设置与 e2e。

#### 3.3 复制 `file:line` 引用

- **体验**：编辑器右键/文件树右键复制 `main.py:42`（相对工作区根），贴 issue/聊天可直点。
- **实现要点**：`main.ts:474-477` 复制三件套加一项（光标行取 `editor.getPosition()`）；文件树项不带行号，只加编辑器右键即可。
- **量级**：1-2 小时。

#### 3.4 最近编辑位置（Ctrl+Shift+Backspace）

- **体验**：连续改了十处后一键回跳上一个编辑点，再按循环回溯。
- **实现要点**：`editHistory.ts` 已有行对事件流，新增一个轻量「编辑点栈」（去重连续同文件同位置）；键位进 `keybindingDefaults.ts`（单一来源）+ `keybindings.ts` 分发 + Rust `default_keybindings` 漂移锁测试同步。
- **量级**：一天内。

### 第二梯队：中等成本

| 功能 | 要点 | 现成依赖 |
|---|---|---|
| 文件内符号 Quick Pick（Ctrl+F12） | outline 同源（documentSymbol）+ quickOpen 弹层复用 | `quickOpen.ts` fuzzyScore、LSP documentSymbols |
| 参数名行内提示 | 调用处 `func(` 后灰字 `name=`；挂在 intel inlay 管线或 pyrefly inlay 透传 | `lsp.registerLspInlayHints()` |
| 粘贴 JSON → Python dict | 剪贴板 JSON 自动转 Python 字面量（true→True 等），编辑器 paste 拦截 + 设置开关 | `devtools/jsonpath` 解析 |
| ruff 规则中文速释 | ruffLint 诊断 hover 补人话解释表（常见规则手工维护，无需全量） | `ruffLint.ts` |

### 第三梯队：依赖引擎能力，先探针再决策

- **Extract Variable / Function 重构**：先探针 pyrefly 是否出 refactor 类 code action（探针方法论沿用引用计数那次：Node 起 pyrefly 裸会话试请求）；basedpyright 已支持，可并入 Pydantic 引擎推荐链路一起考虑。若引擎不给，则不建议 shell 侧自研（成本失控）。

## 4. 建议推进顺序

1. **auto-import**（3.1，先跑 pyrefly additionalTextEdits 探针定形态）
2. **低成本三件套**（3.2 + 3.3 + 3.4，可一个 PR 带走，半天到一天）
3. 第二梯队按需挑选；第三梯队先探针后立项

## 5. 横切纪律（实现时适用）

- 键位新增只改 `keybindingDefaults.ts`，Rust `default_keybindings` 由漂移锁测试兜底。
- 设置项走「实例构造读取 + apply* + refresh* + saveSettingsPanel 挂钩」三层接线（UI-11/29）。
- provider/监听器返回值入 `DisposableStore`，禁止丢弃。
- 补全 sortText 沿三层合并契约（0xx 模板 / 1xx intel / 2xx 静态），新强上下文项在 0xx 段内用后缀钉序。
- 主干开发 + 短分支 PR，CI 全绿才可合并。
