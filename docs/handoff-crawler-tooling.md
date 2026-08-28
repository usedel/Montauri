# OpenCharm 交接文档：爬虫开发体验增强（模板分组 + 运行时数据智能 + 选区运行）

> 日期：2026-08-26 · 状态：**已交付，真机验证待补**
> **本文档是「爬虫开发体验」这条线的唯一入口**：覆盖 4 块连续增量，附完整改动清单、验证结果、生效方式、边界与下一步候选。
> 上游：`python_ide_tech_plan_v3.md`（技术方案）、`python_ide_dev_plan_v2.md`（开发计划）、`handoff-tauri-monaco.md`（外壳交接）。
> 贯穿全程的架构约束（不可违反）：`probe` 与 `intel` 是独立进程/包，不依赖外壳内部 API；所有自研组件不侵入静态引擎内核。

## 1. 一句话背景

围绕**爬虫工程师**的高频工作流，做了一组连贯增强：① 爬虫专用的可配置 live template 库及其**分组**管理体系；② 运行时数据智能的**链式/JSON/dict 下标补全**与 **jmespath 补全 + 诊断**；③ 修掉 probe/intel 两个影响运行时智能落地的关键 bug；④ **选区运行**（迭代加速）。

## 2. 交付清单（按模块）

### 2.1 爬虫 Live Template 库（C 组）

- `shell/src/live-templates/builtin.ts` 新增 **14 条爬虫模板**，分组 `group: "爬虫"`，分 5 类：
  - 请求：`reqget` / `reqpost` / `reqsess`（requests+Retry 适配器）/ `hget`（httpx 异步）
  - 解析：`bs4` / `lxml` / `css` / `jsonld`
  - 翻页：`page`（抓空即停循环）
  - 反爬：`ua`（UA 池）/ `proxy` / `rsleep`（随机延时）
  - 落地：`csvw` / `jsonw`
- `BUILTIN_ORDERING` 的 module/function 追加爬虫组（`main`/`for` 仍各自 preselect）。

### 2.2 模板分组体系

- 数据层：`schema.ts` 增加 `TemplateDef.group?: string`（可选、向后兼容）；解析时 trim。
- 语义：**分组即明文名称**（`"爬虫"`）。曾有一版 id→标签映射（`crawler→爬虫` + `groupLabel()`），因「用户自建分组」需明文而**简化为明文**，映射与 `groupLabel()` 已删除。
- 呈现：补全弹窗 `detail` 加 `[分组]` 标签；模板面板（Ctrl+J）与管理面板列表加 accent 色分组徽章；`registry.rs` `EffectiveEntry` 透出 `group`。
- 管理面板（`shell/src/live-templates/ui/manager.ts`）：
  - **分组筛选**下拉（全部分组 / 各命名分组 / 未分组），签名缓存避免搜索击键重绘。
  - **批量启用/禁用**（作用于「搜索 × 分组」筛选结果），单次保存；墓碑（tombstone）**携带 group**，保证整组禁用后仍可被分组筛选命中、可整组恢复。
  - **分组新建**：模板编辑器「分组」字段输入新名即建组（datalist 候选）；**重命名**：工具栏「重命名」内联改名，`renameGroup` 批量改写该组下所有模板（内置模板生成「仅改分组」覆盖）。
  - 分组字段用**自绘下拉**替换原生 `<datalist>`——WebView2 原生下拉是浅色弹层，无法用 CSS 主题化（用户实测发现的白色提示框）。

### 2.3 A 组 · 运行时数据智能

**核心修正 + 增量**（Phase 3 已交付符号/点属性补全、hover、跳转、inlay；本次补齐 dict/链式/jmespath 场景并修语义）：
- **dict 下标访问补全**：`data["` / `data.get("` 补真实 key（此前 dict 键被放在点访问里，语义错误）；**点访问排除 dict**（`data.` 不再补键）。
- **触发字符**：Monaco provider 与 intel 均加 `"` `'` `[`（配合 `quickSuggestions.strings:false`）。
- **hover**：dict 字段按 `["title"]` 下标形式展示。
- **链式补全（多层 + list 索引，≤5 层）**：
  - probe `compact.py`：shape 递归化（`_MAX_SHAPE_DEPTH=5`，dict→`{"t","k"}`，list→`{"t","e"}`，顶层 list 也记录 `{"e":…}`），元素键合并。
  - intel `type_infer.rs`：`ShapeNode`（Dict/List/Scalar）+ `Access`（Key/Index）+ `MAX_CHAIN=5` + `chain_keys(type, chain)` 沿链解析。
  - `completion.rs`：`subscript_ctx_at`/`parse_receiver` 逆向解析 `data["a"]["b"][0]["` 任意组合。
- **jmespath 补全（阶段 1）**：识别一行式 `jmespath.search("path", var)` / `.compile("path", var)`，复用 `chain_keys` 补路径段（`.field` / `[0]` / `[-1]` / `[*]`）。
- **jmespath 诊断（阶段 2）**：
  - `diagnostics.rs`（新）：扫描所有 jmespath 调用，`validate_chain` 校验——字段不存在（带共享前缀拼写建议）、对对象用下标、对数组用字段访问等。
  - `server.rs`：`did_open`/`did_change` 生成并 `publish_diagnostics`（`source="opencharm-intel"`）。
  - **前端双引擎诊断并存**：诊断按引擎分 Monaco owner（`opencharm-lsp` / `opencharm-intel`），`client.ts` 消息 loop 透传 engine、`handleDiagnostics`/`applyCachedDiagnostics` 按 owner 分桶。

**两个关键 bug 修复**（运行时智能落地的前置）：
- **probe 发现窗口漏采**（`monitor.py`）：原 2s 发现窗口 +「重开依赖已 armed 函数」导致「顶部慢 `import requests` 后、模块末尾才调用的业务函数」被漏采（demo.py 曾只有 `<module>` 无 `main`/`get_quotes`）。改为**活跃调用计数**（`_active`：项目函数进入 +1、返回 -1；`_active>0` 时窗口不关），并新增回归测试。
- **intel 索引不刷新**（`server.rs`）：索引原本懒加载一次且永不重载。改为**按 trace 库 mtime 判断**，运行脚本后下次请求自动重载。

### 2.4 B 组 · 选区运行

- 快捷键 `run_selection`（**Alt+Shift+E**），三处同步：`keybindings.ts` / `state.ts` / `settings.rs`（Rust `default_keybindings` + 测试 len）。
- `main.ts` `runSelection()`：**有选区跑选区，无选区跑光标行**；写入**源文件同目录** `__opencharm_selection__.py`（保证相对导入/资源一致）；`run_script` 以 **probe=false**（不污染项目 trace 库）；输出走现有面板。
- **traceback 行号映射**：`gotoFromLink` 把临时文件 traceback 映射回源文件选区起始行+偏移。

## 3. 验证结果

| 目标 | 命令 | 结果 |
|---|---|---|
| probe | `cd probe && uv run pytest -q` | **59 项全绿** |
| intel | `cd intel && cargo test --workspace` | **28 + 6 + 3 全绿** |
| 前端 | `cd shell && npx vitest run` | **12 文件 / 102 项全绿** |
| 前端类型 | `cd shell && npx tsc --noEmit` | exit 0 |

## 4. 生效方式（真机验证步骤）

1. **关闭 OpenCharm**（释放 `opencharm-intel.exe` 锁）→ `cd intel && cargo build -p opencharm-intel`（本次改了 intel 的 completion/type_infer/diagnostics/server）。
2. 重启 OpenCharm（前端改动随 `npm run tauri dev` 热重载或 build；`settings.rs` 改动需重编译 shell 后端）。
3. 进入项目**运行一次脚本**沉淀 trace（probe 是 Python，改动即时生效；新 shape 递归结构随本次运行写入）。
4. 验证点：`quotes["data"]["diff"][0]["` 补 `code`；`jmespath.search("data.dff", …)` 出现波浪线 + 建议 `diff`；选中代码 `Alt+Shift+E` 运行；管理面板按「爬虫」分组筛选/批量启停/重命名。

## 5. 边界与已知限制（MVP）

- **单段/一行式约束**：下标/jmespath 补全与诊断都依赖「数据变量紧跟」的一行式调用；`expr = jmespath.compile("…")` 隔行 `.search(data)` 不支持。
- **点链 receiver 不支持**：`resp.json()["`、`a.b["` 仍无法推断（`resp.json()` 是 requests 第三方方法，probe 只采项目内函数）。要支持需「赋值级/方法调用级采样」或「点链 receiver 解析」，成本高，未做。
- **jmespath 高级语法**：过滤 `[?…]`、多选、函数 `length()`、管道 `|`、`foo.*` 遇到即停止（已解析段仍可用）。
- **诊断精度**：range 指向整段路径字符串（非精确到错误字段）；severity 统一 **Warning**（运行时采样可能不完整，避免误报 Error）。
- **shape 上限**：递归深度 5 层、`max_keys=16`、list 元素取首个出现结构合并；深度达限降级为类型标签。
- **选区运行孤立执行**：选中代码不能引用原文件函数体内局部变量（写临时文件独立运行）；需自包含或连定义一起选中。真正的「引用上下文」需持久 REPL 会话（未做）。

## 6. 下一步候选（按优先级）

1. **jmespath 诊断精确 range** + 支持 `compile("…").search()` 跨行形态（低中成本，延续阶段 2）。
2. **访问路径一键复制**（A 组清单遗留）：hover 里点字段复制 `quotes["data"]` 完整路径（纯前端 UX，低成本）。
3. **持久 REPL 会话**（B 组第二项）：解决选区/逐行运行引用上文定义的问题（中高成本）。
4. **赋值级/方法调用级采样**：让 `resp.json()` 这类写法直接可补全（高成本，PEP 669 无赋值事件，需字节码插桩或静动结合）。

## 7. 关键文件索引

| 区域 | 文件 |
|---|---|
| 爬虫模板 + 分组数据 | `shell/src/live-templates/builtin.ts`、`schema.ts`、`registry.ts` |
| 分组/筛选/批量/改名 UI | `shell/src/live-templates/ui/manager.ts`、`index.html`、`src/style.css` |
| dict/链式/jmespath 补全 | `intel/crates/opencharm-intel/src/completion.rs`、`type_infer.rs` |
| jmespath 诊断 | `intel/crates/opencharm-intel/src/diagnostics.rs`、`server.rs` |
| probe shape/窗口修复 | `probe/src/opencharm_probe/compact.py`、`monitor.py` |
| 选区运行 | `shell/src/main.ts`、`keybindings.ts`、`state.ts`、`src-tauri/src/settings.rs` |