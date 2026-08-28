# OpenCharm Live Templates 重构方案 v1

> 版本：v1.0 · 日期：2026-08-24 · 状态：已交付（M1-M4 全部落地，实现注记见 §15-§18）
> 上游文档：`docs/live_templates调研报告2.md`（功能调研）、`python_ide_tech_plan_v3.md` §2.4、`python_ide_dev_plan_v2.md` §7（Phase 4 边角修复）
> 范围：shell 层（前端 TS + 少量 Tauri 命令），不涉及 probe / intel / LSP 桥协议变更
> 📌 修订：本文档 §5.1 / §6 / §9 / §10 / §5.4 已被 `docs/live_templates上下文轴修订稿.md`（v1.1 · 2026-08-25）修订，冲突处以版本号更高者为准。

## 0. 关键决策速览

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| D1 | 交互主路径 | PyCharm 式「缩写 + Tab 直接展开」为主，补全弹窗为辅 | 调研报告 §1：极简闭环是 Live Templates 优秀的根本；现状只有弹窗一条路径 |
| D2 | 模板体语法 | 编写层用 PyCharm 风格 `$VAR$` / `$END$` / `$SELECTION$`，运行时**编译为 Monaco snippet** | 命名变量天然支持「每变量挂表达式 / 多处出现镜像 / skipIfDefined」；Monaco SnippetController 免费提供 Tab/Shift+Tab 占位符跳转与 `$0` 终点，零重实现 |
| D3 | 表达式引擎 | 自研纯 TS 函数集（PyCharm 子集），不做 `groovyScript` 等价物 | 单人自用，函数集可扩展即够；动态脚本带来 CSP/维护成本，YAGNI |
| D4 | 上下文判定 | LSP `documentSymbol` 缓存为主，缩进启发式兜底 | `lsp/client.ts` 已有 `documentSymbols()`（P25-T07 大纲复用）；比现状缩进正则可靠 |
| D5 | 模板来源 | 三层：内置 → 用户全局 → 工作区级 | 对齐 PyCharm 的 IDE 级 / 项目级组织；工作区级便于按项目定制 |
| D6 | 补全三层合并契约 | 模板层仍占 `sortText 0xx` 段，标注 `⟳`；`1xx`/`2xx` 不动 | 开发计划 v2 §6 的确定性合并契约不可破坏 |
| D7 | 环绕 / 后缀 | 做，但后置到 M3 | 调研报告 §10.1 三范式互补；但先把插入范式闭环做扎实 |
| D8 | 上下文模型 | 三维：容器（module/class/function）× 位置（statement/expression/name）× 词法；模板声明「适用环境谓词」 | 对齐 PyCharm ContextType；v1.0 缺位置轴致 `main` 撞函数名（见上下文轴修订稿 §1） |

## 1. 背景：现状与痛点

### 1.1 现状盘点

现有实现分布于：

- `shell/src/templates.ts` — 6 个内置模板（label + VSCode snippet 语法 body）+ 三上下文优先级表 + 用户配置浅合并；
- `shell/src/smartTemplates.ts` — 补全 provider：缩进启发式上下文判定（`detectContext`）+ 按上下文优先级出模板项（`sortText 0xx` + preselect）+ 成员访问上下文排除（P1-BUG-002）+ ⚡ 强制全显；
- `shell/src-tauri/src/fs_cmds.rs::read_templates_config` — 读 `~/.opencharm/templates.json`；
- `main.ts::loadTemplatesConfig` — 打开工作区时加载合并、重注册 provider。

### 1.2 痛点清单（重构动因）

| # | 痛点 | 证据 |
|---|---|---|
| P1 | 无「缩写 + Tab」直接展开，必须等弹窗、选模板 | 只有 `registerCompletionItemProvider` 一条路径 |
| P2 | 无缩写概念，label 是描述句（如 "if __name__ == '__main__'"），键入过滤效率低 | `DEFAULT_TEMPLATES` |
| P3 | 无变量/表达式引擎：不能自动填文件名、日期、类名，无 skipIfDefined 零交互展开 | body 仅静态占位符 |
| P4 | 上下文判定为缩进启发式：装饰器行、多行表达式续行、空行后、字符串内均可能误判 | `detectContext` 仅看缩进 + `class `/`def ` 正则 |
| P5 | 模板与 LSP 补全混居同一弹窗且模板常驻顶部，干扰正常补全；靠排除 `.` 上下文打补丁 | `sortText 0xx` + preselect；P1-BUG-002 |
| P6 | 配置靠手编 JSON，无 UI、无热重载（仅打开工作区时加载）、无启用/禁用、无描述字段 | `loadTemplatesConfig` 时机；schema 无 enabled 字段 |
| P7 | 无环绕模板、无后缀补全 | — |
| P8 | 内置模板仅 6 个，覆盖面窄 | `DEFAULT_TEMPLATES` |

## 2. 目标与非目标

**目标**（按优先级）：

1. 复刻 PyCharm 核心闭环：缩写 → Tab 展开 → Tab/Shift+Tab 变量跳转 → `$END$` 结束，全程 ≤ 两次按键插入结构；
2. 表达式引擎：变量可挂表达式自动求值（文件名/日期/类名/大小写转换等），支持默认值与 skipIfDefined，实现「零交互展开」；
3. 上下文系统：语言 + 语法位置（module/class/function）+ 词法环境（字符串/注释）三维作用域，判定可靠；
4. 三层模板来源（内置/用户/工作区）+ 图形化管理 + 热重载 + 导入导出；
5. 环绕模板（Ctrl+Alt+T）与后缀补全（`.if` / `.for` 等）。

**非目标**（明确不做，留待后评估）：

- `groovyScript()` 等价动态脚本（扩展点 = 新增引擎函数；单人场景函数集足够）；
- Django 等框架专有函数；
- 云同步 / 多机同步（导入导出文件即共享手段）；
- 后缀补全的类型门控（如 `.for` 仅对可迭代对象出现）——待 opencharm-intel 成熟后经 LSP 桥评估接入，不违反架构铁律（模板引擎只消费桥暴露的数据）；
- `complete()` 在占位符自动弹补全（Monaco 无逐占位符钩子，v1 降级为空占位符）。

## 3. 总体架构

全部落在 shell 层；引擎模块为**纯 TS、零依赖、不 import Monaco**（可单测），仅胶水层接触 Monaco API。符合工程规范「不侵入原则」（不改 Monaco 源码，只用公开 API；Monaco 已锁 0.52.2）。

```
shell/src/live-templates/
├── schema.ts        # 模板数据模型（Schema v2）+ 校验 + v1 迁移
├── registry.ts      # 三层来源合并（内置/用户/工作区）→ 生效模板集（按 scope 索引）
├── scope.ts         # 上下文解析：documentSymbol 缓存 + 缩进兜底 + token 类型（字符串/注释）
├── engine/          # 表达式引擎（纯函数）
│   ├── functions.ts # 函数集：字符串变换/文件/代码/时间/剪贴板/...
│   └── eval.ts      # 表达式解析与求值（字符串常量、变量引用、函数调用、concat）
├── compiler.ts      # $VAR$ 模板体 → Monaco snippet（变量编号/求值注入/转义）
├── triggers/
│   ├── tabExpand.ts     # Tab 直接展开（缩写匹配 + 冲突处理）
│   ├── completion.ts    # 补全弹窗路径（重构现 smartTemplates provider）
│   ├── surround.ts      # Ctrl+Alt+T 环绕
│   ├── postfix.ts       # 后缀补全 provider
│   └── palette.ts       # Ctrl+J 模板面板（quick pick）
└── ui/
    └── manager.ts       # 模板管理面板（列表/编辑/启停/导入导出）
```

数据流：

```
存储层(三层 JSON) → registry(合并/启停) ──┐
                                          ├→ [Tab 展开 | 补全 | 环绕 | 后缀 | 面板]
scope.ts(上下文) + engine(表达式求值)      │        ↓
                              compiler(编译 Monaco snippet)
                                          ↓
                          editor.action.insertSnippet / CompletionItem(InsertAsSnippet)
                                          ↓
                          Monaco SnippetController（Tab 跳转 / 镜像 / $0 终点）
```

## 4. 交互设计

### 4.1 核心闭环（与 PyCharm 对齐）

1. 键入缩写（如 `try`）→ 按 `Tab` → 立即展开，**不经过弹窗**；
2. 展开后进入 Monaco snippet 会话：`Tab` 跳下一变量、`Shift+Tab` 回跳、`Esc` 取消；
3. 表达式已求值的变量按 skipIfDefined 语义决定「直接填好跳过」或「作为带默认值的占位符停留」；
4. 最终停在 `$END$`（编译为 `$0`）。

弹窗路径保留为辅助：键入时模板仍出现在补全列表（缩写作为 filterText），供不记得缩写的场景；⚡ 强制全显保留。

### 4.2 键位表

| 键 | 行为 | 说明 |
|---|---|---|
| `Tab` | 无弹窗时：缩写直接展开；snippet 会话中：下一占位符（Monaco 内置） | when 子句分流，见 §9.1 |
| `Shift+Tab` | snippet 会话中上一占位符（Monaco 内置） | — |
| `Esc` | 退出 snippet 会话（Monaco 内置） | — |
| `Ctrl+Alt+T` | 环绕模板选择（有选区时） | 与 PyCharm 一致 |
| `Ctrl+J` | 模板面板：当前上下文全部可用模板 quick pick | 与 PyCharm Insert Live Template 一致 |
| ⚡ 工具栏按钮 | 强制全显（保留现状） | — |

### 4.3 三范式

| 范式 | 触发 | 语义 | 期次 |
|---|---|---|---|
| 插入（Live Template） | 缩写 + Tab / 补全弹窗 / Ctrl+J | 在光标处插入片段 | M1 |
| 环绕（Surround） | 选中 + Ctrl+Alt+T / 选中 + 缩写 + Tab | `$SELECTION$` 承载选区 | M3 |
| 后缀（Postfix） | `表达式.后缀` + Tab/Enter | 转换已有表达式 | M3 |

## 5. 模板数据模型与存储

### 5.1 Schema v2

```jsonc
{
  "version": 2,
  "templates": [
    {
      "id": "builtin.try",              // 内置模板带 builtin. 前缀；用户模板为自取 slug
      "abbreviation": "try",
      "description": "try / except 块",
      "body": "try:\n    $BODY$\nexcept $EXC$ as $E$:\n    $END$",
      "scopes": ["python:module", "python:class", "python:function"],
      "kind": "normal",                 // normal | surround | postfix
      "enabled": true,
      "variables": [
        // 按数组顺序分配占位符编号；未列出的变量 = 无表达式占位符
        { "name": "EXC", "expression": "enum(\"Exception\", \"ValueError\", \"KeyError\")", "defaultValue": "Exception", "skipIfDefined": false },
        { "name": "E",   "expression": "", "defaultValue": "e", "skipIfDefined": false }
        // BODY 未列出 → 普通占位符（展开后第一个停留点）
      ]
    }
  ],
  "ordering": {
    // 各 scope 内补全排序（对应 v1 的 priority）；未列出的模板按 id 序排后
    "python:module": ["main", "def", "class", "for", "try", "with"]
  }
}
```

字段语义：

- `abbreviation`：缩写，同 scope 内唯一（跨 scope 可重名，对齐调研报告 §3）；字符集 `[A-Za-z0-9._-]`；
- `body`：`$VAR$` 语法；`$$` = 字面 `$`；`$END$` = 终点；`$SELECTION$` 仅 surround；postfix 模板另有 `$EXPR$` 承载被转换表达式；
- `scopes`：见 §6.1；
- `variables[].expression`：字符串常量（双引号）、其他变量名、函数调用及其组合（§7）；
- `variables[].skipIfDefined`：表达式求值成功时跳过用户输入（直接注入字面文本）；
- `kind: postfix` 时额外字段 `"postfixKey": "if"`（`.` 后的键）与可选 `"topmost": false`（v1 固定 false，不做「最顶层表达式」）。

### 5.2 三层来源与合并

| 层 | 位置 | 用途 |
|---|---|---|
| 内置 | 编译进前端（`builtin.ts`） | 随版本演进的模板库 |
| 用户全局 | `~/.opencharm/templates.json` | 个人模板与对内置的覆盖/禁用 |
| 工作区 | `<workspace>/.opencharm/templates.json` | 项目级模板，随仓库走 |

合并规则：

1. 以 `abbreviation + scopes` 为键；工作区 > 用户 > 内置；
2. 禁用内置：上层放同键条目 `{"enabled": false}`（墓碑）；
3. `ordering` 三层深合并，窄层优先；
4. Schema 校验失败的条目跳过并在状态栏/输出面板告警（不整体失败）。

Rust 侧新增命令（`fs_cmds.rs`）：`write_templates_config { scope: "user" | "workspace", content }`；读取复用现有 `read_templates_config`（user）+ 通用 `read_file`（workspace 路径）。

### 5.3 v1 配置迁移

首次加载到 v1 格式（无 `version` 字段）时自动迁移：

- `templates.{key}.label` → `description`；`key` → `abbreviation`；
- body 已是 VSCode snippet 语法（`${1:name}` / `$0`）→ 反向编译为 `$VAR$` 语法（`${n:ph}` → `$PH$` + variables 条目；`$0` → `$END$`）；
- `priority` → `ordering`（`module` → `python:module` 等）；
- 迁移结果写回用户文件，原文件备份为 `templates.json.v1.bak`。

### 5.4 导入导出

- 导出：生效模板集（或勾选子集）→ Schema v2 JSON 文件（Tauri 保存对话框）；导入：校验 + 与现有条目按键去重（询问覆盖/跳过）；
- **PyCharm XML 导入**（M4）：解析 PyCharm 导出的 `<template name value><variable expression defaultValue alwaysStopAt>` XML（WebView2 `DOMParser` 即可），expression 按 §7 函数对照表尽力翻译，不支持的函数降级为 `defaultValue` 并标记待人工确认。这是用户从 PyCharm 迁移存量模板的直接通道。

## 6. 作用域 / 上下文系统

> 📌 本节已被 `docs/live_templates上下文轴修订稿.md`（v1.1）修订：新增「位置轴」（statement/expression/name）与 Schema `positions` 字段、位置判定器 PositionClassifier。冲突处以修订稿为准。

### 6.1 Scope 定义

格式 `<语言>:<语法位置>`，v1 集合：

| scope | 含义 |
|---|---|
| `python:module` | 模块顶层 |
| `python:class` | class 体内（方法位置） |
| `python:function` | def 体内（含方法体） |
| `python:expression` | 表达式上下文（仅后缀模板使用） |

附加词法维度（不进 scope 字符串，模板可选开关）：`allowInStrings` / `allowInComments`，默认 false（即字符串/注释内不展开，除非模板显式允许——注释模板如文件头可开启）。

### 6.2 检测策略

1. **语法位置**：优先用 LSP `documentSymbol` 缓存（`lsp/client.ts::documentSymbols` 已存在，P25-T07 大纲同源数据）：找包含当前 position 的最内层 Class/Function/Method 符号 → `class` / `function`，否则 `module`。缓存按 model 版本号失效，补全/展开触发时惰性刷新（非每次按键）。
2. **兜底**：LSP 未启动 / 请求失败 / 超时（>100ms 用缓存或兜底）→ 现有缩进启发式（保留 `detectContext` 作为 fallback）。
3. **字符串/注释**：`ITextModel.getTokenTypeAtPosition`（不可用时回退 `getLineTokens` / `monaco.editor.tokenize`）。

## 7. 变量与表达式引擎

### 7.1 变量模型

对齐调研报告 §4.3：每变量 = `expression` + `defaultValue` + `skipIfDefined`。展开时：

```
表达式求值成功 ──┬─ skipIfDefined=true  → 注入字面文本（不产生占位符，跳转直接跳过）
                └─ skipIfDefined=false → 占位符，默认值 = 求值结果（可再编辑）
求值失败/无表达式 → 占位符，默认值 = defaultValue（可为空）
```

同名变量多处出现 → 同一占位符编号（Monaco 自动镜像同步编辑）。

### 7.2 函数集（v1 子集）

语法：字符串常量双引号、函数调用、变量引用、`concat(...)`。

| 分类 | v1 实现 | 说明 |
|---|---|---|
| 字符串变换 | `camelCase` `snakeCase` `capitalize` `decapitalize` `upper` `lower` `kebabCase` `firstWord` `spacesToUnderscores` `underscoresToCamelCase` | 调研报告 §5.1 子集；`capitalizeAndUnderscore` 等可用 concat/变换组合覆盖 |
| 文件上下文 | `fileName()` `fileNameWithoutExtension()` `filePath()` `fileRelativePath()` | 来自当前 model URI + workspaceRoot |
| 代码上下文 | `className()` `methodName()` | 来自 §6.2 documentSymbol 缓存（光标所在最内层符号） |
| 时间 | `date([fmt])` `time([fmt])` | 格式 token 子集：`yyyy MM dd HH mm ss EEE` |
| 用户/环境 | `user()` `clipboard()` `lineNumber()` | clipboard 走已装的 tauri-plugin-clipboard-manager |
| 组合/枚举 | `concat(...)` `enum("a","b",...)` | `enum` 编译为 Monaco choice `${n\|a,b\|}` |
| 补全联动 | `complete()` | v1 降级为空占位符（Monaco 无逐占位符触发钩子），文档注明 |

不实现：`expectedType` / `typeOfVariable` / `variableOfType`（依赖类型推断，待 intel 接入后评估）、Django 系列、`groovyScript`、`regularExpression`（v2 视需要再加，引擎是纯函数注册表，增量成本低）。

### 7.3 求值与容错

- 引擎为纯函数注册表 `Map<string, (args, ctx) => string | null>`，`ctx` = { model, position, workspaceRoot, symbols, clipboard }；
- 任何函数失败返回 `null` → 走 defaultValue 路径（对齐调研报告 §10.2「任何上下文都能展开」）；
- 表达式解析失败（括号不匹配等）→ 管理面板编辑态即时红字提示，运行期按无表达式处理。

## 8. 编译到 Monaco snippet

`compiler.ts` 将 `$VAR$` 模板体编译为 Monaco snippet 字符串：

| 源 | 目标 | 备注 |
|---|---|---|
| `$END$` | `$0` | 终点 |
| `$SELECTION$` | `${TM_SELECTED_TEXT}` | surround 专用 |
| `$VAR$`（skip 且求值成功） | 求值结果字面量（转义后） | 无占位符 |
| `$VAR$`（占位符） | `${n:默认值}` | n 按 variables 数组序/首现序分配 |
| `enum(...)` 求值成功 | `${n\|a,b,c\|}` | choice 语法 |
| `$$` | `\$` | 字面美元符 |
| 注入文本中的 `\` `$` `}` | `\\` `\$` `\}` | 转义规则 |

步骤：词法扫描（`$...$` token）→ 变量编号分配 → 逐变量求值决策 → 替换与转义 → 输出。编译器与引擎均为纯函数，单测覆盖（CI 已要求 shell 前端单测，开发计划 §8.2）。

## 9. 触发路径详设

### 9.1 Tab 直接展开（核心新增）

`editor.addCommand(monaco.KeyCode.Tab, handler, when)`：

- **when 子句**：`!suggestWidgetVisible && !inSnippetMode && !renameInputVisible && !quickFixWidgetVisible && !editorTabMovesFocus`（弹窗展开、占位符跳转、重命名等场景全部让位给 Monaco 默认行为）；
- **handler 流程**：
  1. 中文输入法组合期（compositionstart/end 门控，S1-T06 经验）→ 放行默认 Tab；
  2. 取光标前缩写词（`getWordUntilPosition`，字符集按 §5.1）；为空 → 默认 Tab（缩进）；
  3. 字符串/注释内且模板未开 `allowInStrings/Comments` → 默认 Tab；
  4. 在生效模板集中按「缩写 + 当前 scope」匹配；未命中 → 默认 Tab（`editor.trigger('keyboard', 'tab')`）；
  5. 命中：`setSelection` 覆盖缩写 → `editor.trigger('live-templates', 'editor.action.insertSnippet', { snippet: 编译结果 })`，进入 snippet 会话；
- 匹配为 O(模板数) 内存查表，无性能顾虑；
- **验收要点**：缩进、选区缩进、snippet 跳转、弹窗接受四类原生 Tab 行为零回归。

### 9.2 补全弹窗路径（重构现有 provider）

- 保留 `sortText 0xx` 段与 `⟳` 标注（三层合并契约，开发计划 §6）；标注升级为 `⟳ <abbr> · <scope>`；
- `filterText = abbreviation`（现状是 label，键入过滤效率低）；`label = abbreviation`，`detail = description`；
- **`.` 上下文分流**（根治 P1-BUG-002 的补丁式排除）：成员访问位置不再简单返回空，而是改由后缀模板接管（§9.4）——普通模板与后缀模板天然分域；
- insertText 在 provide 时编译（表达式此刻求值；补全弹窗生命周期短，时间类函数误差可忽略）；
- ⚡ 强制全显逻辑保留。

### 9.3 环绕（M3）

1. 有选区时按 `Ctrl+Alt+T` → quick pick 列出 `kind: surround` 且 scope 匹配的模板（含缩写与描述）；
2. 选中后编译（`$SELECTION$` → `${TM_SELECTED_TEXT}`），`editor.action.insertSnippet` 替换选区；
3. 选区缩进处理：归一化选区相对缩进后叠加模板基底缩进（v1 简单实现，多行选区整体平移）；
4. 有选区时「缩写 + Tab」同样触发环绕（匹配 surround 模板，对齐 PyCharm）。

### 9.4 后缀补全（M3）

- provider 触发字符 `.`（现 provider 已注册）；`.` 后位置 → 仅出后缀项，出普通模板；
- **表达式提取**：从 `.` 前位置向左启发式扫描（标识符、属性链、配对的 `[]`/`()`、字符串引号）得到表达式文本与起点列；item `range` 覆盖「表达式起点 → 光标」，接受后整体替换为「转换后的 snippet（`$EXPR$` 已代入表达式文本并转义）」；
- v1 不做类型门控（所有后缀模板对任意表达式可用）与「最顶层表达式」选项；展开键 = Monaco 补全接受键（Tab/Enter）；
- 内置后缀集：`if` `else` `for` `try` `not` `print` `len` `return` `str` `int`（对齐调研报告 §7.5 常用项的 Python 化）。

### 9.5 模板面板（M4）

`Ctrl+J`：当前上下文全部可用模板 quick pick（模糊搜索缩写/描述），选中即插入——不记得缩写时的兜底，也是模板库的浏览入口。

## 10. 管理 UI 与热重载

- 独立模态面板（复用现有 `settings-modal` 模式，`main.ts` P25-T09 经验），入口：菜单栏 + 命令；
- 功能：按 scope 分组列表（启用开关/缩写/描述）；编辑表单（缩写、描述、scope 多选、kind、body 编辑区、变量表：名称/表达式/默认值/skipIfDefined）；表达式语法即时校验红字；新增/删除/复制；导入/导出按钮；
- 保存 → 写用户层（或工作区层，面板内切换）→ 重建 registry 与 provider（复用现有 dispose/重注册模式）；
- **热重载**：复用现有文件监听（`startFileWatcher`）监听两层配置文件，外部编辑（手编 JSON）即时生效——保留「直接改 JSON」这一程序员友好通道。

## 11. 内置模板库规划

从 6 个扩充至 ~18 个（对齐 PyCharm Python 内置覆盖面，调研报告 §9）：

- 结构：`main` `def` `class` `dataclass` `for` `while` `if` `ife`(if/else) `try` `with` `lambda`；
- 常用语句：`print`（p）、`super`（`super().__init__`）、`prop`（property 三件套）、`iter`（`__iter__`/`__next__`）、`repr`、`init`；
- 注释/文档：`docf`（函数 docstring，`allowInComments` 关、字符串内开）、`header`（文件头，演示 `date()`/`user()`/`fileName()`）；
- 环绕：`q`（引号）、`try`、`if`、`with`；
- 后缀：见 §9.4。

每个内置模板同时是表达式引擎的示范（`header` 用 date/user，`docf` 用 methodName 等）。

## 12. 分期实施计划

归属 Phase 4「边角修复」（开发计划 v2 §7，产品负责人日常使用反馈驱动），不挤占 Gate 关键路径。

| 期 | 内容 | 交付物 / 验收 | 估时 |
|---|---|---|---|
| M1 核心闭环 | Schema v2 + v1 迁移；表达式引擎 + 编译器（纯 TS + 单测）；Tab 直接展开；补全路径重构（缩写化 + `.` 分流占位）；内置库扩充 | 「缩写→Tab→跳转→结束」闭环可用；四类原生 Tab 零回归；v1 配置自动迁移 | 1.5 周 |
| M2 上下文与管理 | documentSymbol 上下文检测 + 兜底；管理面板；热重载；导入/导出（JSON） | 装饰器/多行表达式场景上下文判定正确；面板增删改即时生效 | 1 周 |
| M3 环绕 + 后缀 | Ctrl+Alt+T 环绕；后缀补全（表达式提取 + 内置后缀集） | 三范式齐备；选区环绕缩进正确 | 1 周 |
| M4 打磨 | Ctrl+J 面板；PyCharm XML 导入；内置库补齐；`regularExpression()` 等按需增量 | 存量 PyCharm 模板可迁入 | 0.5 周 |

每期独立可验收、可发布（主干开发 + 短分支 PR，CI 全绿合并）。

## 13. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| Tab 键位与 Monaco 原生行为冲突（缩进/snippet 跳转/弹窗接受） | 中 | 高 | when 子句分流 + 未命中放行默认 `tab` 命令；M1 验收含四类原生行为回归清单 |
| 中文输入法组合期误触发展开 | 中 | 高 | composition 事件门控；S1-T06 已有 IME 专项经验 |
| `editor.action.insertSnippet` / token 类型 API 属半内部接口，上游升级变动 | 低 | 中 | Monaco 已锁 0.52.2（`ci/versions.toml`）；升级回归 CI 覆盖模板闭环 |
| documentSymbol 请求延迟拖累展开 | 低 | 低 | 缓存 + 版本失效；>100ms 即用缓存/缩进兜底，展开永不阻塞 |
| v1 配置迁移损坏用户数据 | 低 | 低 | 开发期无真实用户（产品负责人确认）：仅内存迁移、不回写不备份；迁移失败忽略用户文件 |
| 后缀表达式启发式提取错误（复杂表达式截断） | 中 | 低 | v1 明确支持边界（标识符/属性链/配对括号/字符串）；越界场景退化为不转换并提示 |

## 14. 验收标准（产品负责人实测）

1. **闭环手感**：空行键入 `try` + Tab，≤ 2 次按键展开 try/except 并在变量间 Tab 跳转，`Esc` 可取消——全程与 PyCharm 体感一致；
2. **零交互展开**：`header` 模板展开即自动填好日期/用户名/文件名（skipIfDefined 生效），无任何停留；
3. **上下文正确**：装饰器行、多行函数签名续行、空行后、类体内方法位置，模板可用集与排序均正确；
4. **零回归**：普通缩进、snippet 占位符跳转、补全弹窗 Tab/Enter 接受、重命名框内 Tab 全部正常；中文输入法组合期无误触发；
5. **三层与热重载**：工作区级模板覆盖用户级；手编 JSON 保存后无需重启即生效；
6. **管理面板**：新增一个带表达式变量的模板 → 保存 → 立即可用，全程不碰 JSON；
7. **迁移**：现有 `~/.opencharm/templates.json` 自动迁移且原行为等价；
8. **三范式**（M3 后）：选中代码 Ctrl+Alt+T 环绕成功；`expr.if` + Tab 转换为 `if expr:`；
9. **性能与契约**：模板层仍居 `0xx` 段、`⟳` 标注可见；补全响应无感知劣化（输入停止 200ms 节流契约不变）。

## 15. M1 实现注记（2026-08-24，落地时的方案细化）

实现落在 `shell/src/live-templates/`（纯引擎模块零 Monaco 依赖，vitest 单测 33 项全绿），与本方案正文的偏差/细化如下：

1. **新增 `tabExpand` 字段**：关键字类缩写（`def`/`class`/`if`/`for`/`while`/`try`/`with`/`lambda`）的内置模板 `tabExpand: false`——仅走补全弹窗，不做裸 Tab 展开，避免与正常编码（键入关键字后按 Tab 缩进）冲突；非冲突缩写（`main`/`dataclass`/`print`/`super`/`init`/`prop`/`iter`/`repr`/`docf`/`header`/`ife`）支持缩写+Tab。用户可在配置中逐模板改判。
2. **缩写扫描字符集收窄为 `[A-Za-z0-9_-]`**（§5.1 的 `.` 仅保留在 Schema 校验层）：`.` 场景让位成员访问与 M3 后缀补全；缩写前紧邻 `.` 时不展开。
3. **snippet 注入机制**：Monaco 0.52.2 ESM 未注册 `editor.action.insertSnippet` 命令，改用公开 API `editor.getContribution("snippetController2").insert(snippet)`（贡献 ID 为多年稳定常量；已验证其按当前选区替换插入并进入占位符会话）。动态键位权重 1000 > 内置 Tab 规则（100/130），when 子句不匹配时正确回落原生行为。
4. **v1 迁移仅内存态**：不回写、不备份（开发期无真实用户，产品负责人裁决）；迁移失败则忽略用户文件。
5. **⚡ 强制全显**：工具栏按钮在 Phase 2.5 重建时已移除，`setForceShowAll` 保留为 API，入口随 M2 管理 UI 恢复。
6. **剪贴板**：`clipboard()` 经 Tauri IPC 直连 `plugin:clipboard-manager|read_text`（capabilities 已加 `clipboard-manager:allow-read-text`），2s 缓存；仅模板表达式实际引用时才预取。

## 16. M2 实现注记（2026-08-24）

实现位于 `shell/src/live-templates/`（新增 `symbols.ts` / `ui/manager.ts`），单测 43 项全绿。要点与细化：

1. **符号上下文（§6.2）**：`SymbolIndex` 采用 stale-while-revalidate——查询永不阻塞，返回缓存（可能过期）并触发 300ms 防抖后台刷新；缓存版本用「响应到达时的 model 版本」近似关联 LSP 文档状态，版本错位由下次查询自愈。符号解析（最内层 function/class 包含判定）失败或符号集为空时回落 M1 启发式。
2. **管理面板（§10）**：查看菜单「Live Templates」打开；目标层可选（用户全局/工作区）。约定——文件内条目以 **abbreviation 为唯一键**；面板生成的墓碑条目 `body: "-"`（区分「禁用占位」与「真实模板」，启用墓碑 = 移除条目回落下层）；「恢复内置」= 移除本层同缩写条目。
3. **热重载（§10）**：Rust watcher 在监听工作区之外附加监听 `~/.opencharm`（NonRecursive，目录不存在则跳过）；前端以「变更目录以 `.opencharm` 结尾」判定并 reload，同时覆盖用户层与工作区层。面板保存走 `saveFile` 直接重建 registry（保存即生效，不依赖监听回环）。
4. **导入/导出（§5.4）**：导出 = 目标层文件原样导出；导入兼容 Schema v2 与 v1（经迁移器），按 abbreviation 冲突覆盖，非法条目跳过并计数提示。PyCharm XML 导入仍按计划留在 M4。
5. **Rust 新增**：`write_templates_config(scope, workspace_root?, content)`（自动 `create_dir_all`）；watcher 附加监听；`lsp/client.ts` 导出 `modelPath()` 供符号索引取 model→路径。

## 17. M3 实现注记（2026-08-24）

三范式齐备（插入 / 环绕 / 后缀），单测 65 项全绿。要点与细化：

1. **Registry 键升级为 `scope + kind + abbreviation`**：同缩写可跨范式共存（内置 `try` 同时存在插入/环绕/后缀三个版本，互不干扰）；`templatesForScope`/`findByAbbreviation` 仅对插入模板生效，`findSurround` / `findPostfixByPrefix` 为 M3 新查询面。
2. **编译器 `literals` 字面注入**：统一承载后缀 `$EXPR$` 与环绕 `$SELECTION$` 的调用方预解析文本（转义后注入，不产生占位符、不参与求值编号）。
3. **后缀补全（§9.4）**：`.` 上下文由后缀模板接管（P1-BUG-002 的排除逻辑升级为分流）；v1 仅在已键入键前缀时提供（空词让位成员补全）；表达式提取为向左启发式（标识符/属性链/配对 `()`/`[]`/字符串），已知局限：括号内嵌字符串中的括号、三引号。补全项 range 覆盖「表达式起点 → 光标」，接受即整体转换；`0xx` 段契约不变。
4. **环绕（§9.3）**：`Ctrl+Alt+T` 打开选择器（数字键 1-9 直选、Esc 关闭）；选区缩进处理分两路——选区从行首开始 → 扣最小缩进归一后按「起点行缩进 + 模板前缀」重排后续行；选区从行中开始 → 保留原有绝对缩进。**取舍说明**：§9.3 第 4 条「有选区时缩写+Tab 环绕」未实现——Monaco 中输入会先替换选区，原始选区不可恢复，PyCharm 该路径依赖其内部选区记忆，v1 以 Ctrl+Alt+T 为唯一环绕入口。
5. **管理面板 kind 适配**：条目身份 = `kind:abbreviation`；类型选择（插入/环绕/后缀）+ 后缀键字段；环绕体必须含 `$SELECTION$`、后缀必须有合法后缀键（表单与 Schema 双层校验）；墓碑 id 含 kind。

## 18. M4 实现注记（2026-08-24）

打磨期收尾，单测 73 项全绿。至此 M1-M4 全部交付，调研报告 §104 三层能力 + 表达式引擎双层架构落地完毕。

1. **模板面板（§9.5）**：`Ctrl+J` quick pick 当前 scope 全部插入模板，缩写/描述过滤，方向键/Enter/鼠标选择，光标处插入（与缩写展开共用编译管线）。
2. **PyCharm XML 导入（§5.4）**：面板「导入」按内容自动分流（`<` 开头 → XML，否则 JSON）；`<template>`/`<variable>` 属性映射——`alwaysStopAt=false` ⇔ skipIfDefined、defaultValue 去引号、context 统一映射三个 python scope；表达式经 AST 重映射翻译（`lowercaseAndDash→kebabCase`、`completeSmart/classNameComplete→complete`，同名函数直通），不支持的函数（`groovyScript`/`expectedType`/Django 系列等）整条降级为 defaultValue，降级清单写控制台 + 状态栏计数。
3. **引擎增量**：`regularExpression(String, Pattern, Replacement)`（全局替换，`$1` 组引用，非法模式 → 失败回落默认值）。
4. **内置库补齐**：async 三件套 `adef` / `afor` / `awith`（tabExpand 开启）；§11 清单全部覆盖。
5. **测试设施**：新增 `happy-dom`（devDep，仅 XML 导入测试用 `@vitest-environment happy-dom`）。

---

> 📌 与调研报告的对齐说明：本方案覆盖调研结论 §104 要求的三层能力——Live Templates 插入（M1）、Surround 环绕（M3）、Postfix 转换（M3），以及「预定义函数 + （不做的动态脚本 → 以可扩展函数集替代）」的表达式引擎双层架构；`$END$` / `$SELECTION$` / skipIfDefined / 默认值四个精妙设计（§10.2）全部保留并映射到 Monaco snippet 机制。
