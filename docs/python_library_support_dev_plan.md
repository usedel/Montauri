# Python 库特别支持 · 开发计划

> 版本：v1.0 · 日期：2026-09-27 · 状态：待开工
> 上游：`docs/python_library_support_research.md` v1.2（调研 + 已裁决）
> 本文档面向实施，是 PR 切分与验收的依据；与上游调研冲突时**以上游已裁决项为准**并反馈修订。
> 排期依据：`python_ide_dev_plan_v2.md`；通用 DX 纪律复用 `dx_features_backlog.md` §6。

---

## 0. 已定案前提（动手前不再讨论）

| 编号 | 定案 | 来源 |
|---|---|---|
| **D-1** | P0 全量 4 项：求值桥 → re 三件套 → 格式串 → 参数表单（约 5–7 工作日） | 裁决 |
| **D-2** | CodeLens 两条并存 + 上限 20 + 开关，引用 lens 不让位 | 裁决 |
| **D-3** | 参数表单**内嵌运行配置面板**，不新增侧栏视图 | 裁决 |
| **D-4** | 求值桥**仅内置受控脚本表**（`kind` 白名单，不开放任意代码执行） | 裁决 |
| **P1** | 求值桥：默认 `python -I -c`（126ms）；无解释器时 `uv python find`（125ms）**按工作区缓存**后直连（179ms），比每次 `uv run`（475ms）省 60%；防抖 200ms；直连超时 3s，`uv python find` 首次 8s + 进度提示 | 探针实测 |
| **P2** | pyrefly 1.3.1 对字符串内 DSL **零支持**（诊断 0 / 串内补全 0 / hover 仅 `Literal['…']`）→ L1 全部自研，且不会与引擎打架 | 探针实测 |
| **P6** | 测试文本用**只读 Monaco**：面板内第二个实例边际创建 ~8ms，500 处高亮首次 8ms / 增量 3.9ms（span 覆盖层 10.7ms 且能力更弱） | 探针实测 |
| — | 交互形态冻结：`python_library_support_research.md` §11，实现阶段只做填空题 | 裁决 |

> 锚点说明：下文 `文件:行号` 取自 2026-09-27 代码，**动手前以最新代码为准**。

---

## 1. PR 切分总览

| PR | 内容 | 量级 | 依赖 | 交付后可感知 |
|---|---|---|---|---|
| **PR-1** | Python 求值桥（`py_eval` + 受控脚本表 + 解释器缓存 + 前端 helper + mock） | 1 天 | — | 无 UI（基建） |
| **PR-2** | re 三件套（识别 / 诊断 / hover 解释 / 测试面板 / lens+右键+键位入口） | 2 天 | PR-1 | 写正则当场验证 |
| **PR-3** | 格式串工具（strftime / 格式规范 / logging）+ hover 预览 | 1.5 天 | PR-1、PR-2 的 hover 挂法 | 不查文档写格式串 |
| **PR-4** | 脚本参数表单（argparse / click）+ 回填运行配置 | 2 天 | PR-1 | 自用脚本不再手敲参数 |

第二批（P1，本文档只给要点，每项独立 PR）：输出面板日志级别着色（0.5 天）· JSON→Pydantic 生成（1 天）· JSON 字面量注入（1 天）· 注入规则表框架化（0.5 天）。

---

## 2. 通用纪律（四个 PR 都适用）

1. **设置项四步接线**：`state.ts` 的 `Settings` 接口 + `DEFAULT_SETTINGS`（`:104` 区）→ `index.html` 控件 → `settingsPanel.ts` 回填（`:485`）与保存（`:569`）→ Rust `settings.rs`（`:101-213`）struct + `Default` 同步。旧配置一律 `!== false` 兜底。
2. **键位三处同步**：`keybindingDefaults.ts`（单一来源）→ Rust `settings.rs::default_keybindings` → `keybindings.test.ts` 漂移锁（现 55 项，加一条要同步两处条目数断言）。
3. **诊断新桶**：`opencharm-libs`，与 `opencharm-lsp` / `opencharm-intel`（`lsp/client.ts:1523`）/ `opencharm-ruff`（`ruffLint.ts:29`）并列；**只用 warning / error 两级**。
4. **写回编辑器**：一律 `executeEdits` / `pushEditOperations`，**禁止 `model.setValue()` 整文替换**（`dx_features_backlog.md` PR-C 教训：只有保存动作才用整文写入）。
5. **求值统一走 helper**：`shell/src/libEval.ts::evalKind`，自带 200ms 防抖 + LRU(100) + stale 标志 + `Ctrl+Enter` 强制求值 + 四态错误码。禁止各面板自己写 `invoke`。
6. **无障碍**：多选语义用 `aria-pressed`（flags、日志级别过滤），互斥语义用 `kit.radioGroup`（格式串三模式）；图标按钮 `data-tip` + `aria-label`（UI-09）。
7. **面板窄屏 360px**：`flex-wrap` + 表格横向滚动（缺陷 #19 教训）。
8. **主干开发 + 短分支 PR，CI 全绿才可合并**；新增 provider / 监听器返回值入 `DisposableStore`。

---

## 3. PR-1 · Python 求值桥（1 天）

### 3.1 Rust 侧

**新增 `shell/src-tauri/src/lib_cmds.rs`**：

```rust
#[tauri::command]
pub async fn py_eval(
    workspace_root: String,
    kind: String,       // 白名单：regex_test / format_preview / ast_argparse
    args_json: String,  // 结构化入参（JSON 字符串）
) -> Result<String, String>   // stdout 单行 JSON
```

| 要素 | 实现 |
|---|---|
| **脚本来源** | `include_str!("../scripts/<kind>.py")` 编译进二进制——**不走 bundle resources**，避免打包遗漏（R-3）。脚本表 `const SCRIPTS: &[(&str, &str)]` 常量数组 |
| **kind 白名单** | 未命中 → `Err("BadKind: ...")`，**绝不拼字符串到命令行** |
| **解释器** | `env_cmds::get_interpreter(workspace_root)`（`env_cmds.rs:733`）；`None` → 查缓存 → 无则 `uv python find`（cwd = workspace_root，超时 8s）→ 写入 `static INTERPRETER_CACHE: Mutex<HashMap<String, String>>`（key = 工作区根，换工作区/换解释器失效） |
| **启动参数** | `Command::new(interp).arg("-I").arg("-c").arg(SCRIPT).arg(args_json).current_dir(workspace_root)`；`OPENCHARM_*` 环境变量沿用 `check_missing_imports_impl`（`env_cmds.rs:898-901`）先例 |
| **执行与超时** | `run_with_timeout`（`env_cmds.rs:391`）——**当前是私有 `fn`，需改 `pub(crate)`**（R-4）。直连 3s；`uv python find` 8s；`ast_argparse` 5s |
| **输出协议** | stdout 单行 JSON `{"ok":true,"data":…}` / `{"ok":false,"error":"…"}`；stderr 并入 error；非 0 退出一律失败 |
| **错误码** | `NoInterpreter` / `Timeout` / `BadKind` / `ScriptError`（前端按码分流到 §11.2 的四态文案） |

**`lib.rs`**：`generate_handler!`（`:72-285`）加一行 `lib_cmds::py_eval`。

**脚本**（`shell/src-tauri/scripts/`）：`regex_test.py`（match/findall/finditer+span+group/sub）、`format_preview.py`（strftime / format spec / logging）、`ast_argparse.py`（`ast` 解析 `add_argument` / `click.option` / `typer.Option`，**不 import 用户模块**）。共性：只读、无网络、无写文件；单行 JSON 输出。

**单测**（impl 级 `#[test]`，照 `fs_cmds.rs:1830` 模式）：kind 白名单拒绝未知 kind · 脚本表非空且可解析 · JSON 协议解析 · 超时分支 · 无解释器返回 `NoInterpreter`。

### 3.2 前端侧

**新增 `shell/src/libEval.ts`**：`evalKind<T>(kind, args, opts)` + `createEvalController`（防抖 200ms / LRU 100 / `stale` 标志 / `force()` 供 `Ctrl+Enter`） + `EvalState` 类型（`idle | pending | ok | err | timeout | noInterpreter`）。**纯 TS，无 DOM 依赖**（可单测）。

**e2e mock**：`e2e/mocks/tauri.ts` 加 `py_eval`（对齐既有 `plugin:*` 命令族 mock 先例），覆盖 ok / err / timeout / noInterpreter 四态（这是探针 P4 的产物）。

### 3.3 验收

- `cargo test` 全绿（含新增用例）；`npx tsc --noEmit` 全绿；`libEval` vitest 用例（防抖/LRU/stale/强制求值）全绿。
- 手工：用 `invoke("py_eval", {kind:"regex_test", …})` 在浏览器控制台验证四态返回（无 UI 也能验）。

---

## 4. PR-2 · re 三件套（2 天）

### 4.1 纯函数层（新增 `shell/src/libRegex.ts`，可单测）

| 函数 | 职责 |
|---|---|
| `scanRegexLiterals(text)` | 识别 `re.<api>(<字面量>, …)` 的第一个字符串实参（api 白名单：compile/match/search/fullmatch/findall/finditer/sub/subn/split）+ 同文件简单赋值的 `pattern = r"…"`。**纯文本/词法扫描，零子进程**，对齐 `fs_cmds::scan_endpoints` 先例；带 MAX 上限 |
| `parseFlags(callText)` | `flags=re.I\|re.M` 与 `re.IGNORECASE` 两种写法 + 关键字/位置参数 |
| `explainPattern(pattern, flags)` | 逐 token 人话解释（分组/命名组/量词/字符类/锚点/转义），**离线可用**（描述性，不含匹配结果） |
| `staticDiagnostics(pattern, isRaw)` | 纯静态检查：括号闭合、`[z-a]` 区间倒置、重复命名组、非 raw 串的 `\d`/`\b` 转义丢失（warning） |

**单测**：识别器 8 类形态（raw/非 raw、三引号、关键字 flags、位置 flags、跨行、注释行、非 re 调用的对照组）；flags 解析 6 种写法；静态诊断 4 类命中 + 不误报（合法模式零诊断）。

### 4.2 编辑器侧（L1）

- **高亮**：`monaco.editor.createDecorationsCollection`，只改前景色与下划线样式，**不改字体/背景**（避免与主题语法着色打架）。
- **诊断**：`setModelMarkers(model, "opencharm-libs", …)`，仅 warning/error。
- **hover**：⚠️ **风险 R-1**——Monaco 多 hover provider 是否合并未经验证。开工第一步先实测：不合并则改为在 `lsp/client.ts:714` 的现有 hover 合并管线里追加自研段（推荐后者，与 intel 合并同源，避免双 provider 打架）。
- **入口**：新建 `shell/src/dslLens.ts`（**不动 `codeVision.ts` 的引用逻辑**），注册 CodeLens；顺序 `[工具][引用]` 需实测 provider 注册顺序是否决定显示顺序（R-2）；单文件上限 20；`libs_editor_lens` 开关。右键 `editor.addAction`（`findUsages.ts:287` 为样板）；命令面板 `buildQuickOpenActions`（`main.ts:1339`）；键位 `open_regex_tester`（`Ctrl+Alt+R`，**先核对现有 55 项键位表冲突**，PR-A 先例）+ 漂移锁三处。

### 4.3 面板侧（L2）

新增 `shell/src/devtools/builtin/regex.ts` + `builtin/index.ts`（`:21` 模块表 + `:46` manifest）各一行，category 用预置值 **`文本`**（预置集：编码/哈希/格式化/转换/生成/提取/文本/其他）。

面板结构按研究文档 §11.3 线框：模式输入（+ 非 raw 提示条）· flags（`aria-pressed` 5 开关）· **只读 Monaco**（P6 定案，用 `host.monaco`）· 匹配表（上限 500，点击定位 `revealRange`+`setSelection`）· 匹配/替换二视图（`radioGroup`）· 三动作（复制为 Python 代码 / 插入编辑器 / 替换字面量，`sourceDirty` 时第三项置灰）。

**六态**按 §11.3.3 实现，文案模板照 §11.9。

**e2e**：`e2e/libs/01-regex.spec.ts` —— lens 入口带入当前正则 · 输入测试串断言匹配表与高亮 · 非法模式显示 `re.error` 原文 · 超时/无解释器两态（mock 切换）· `sourceDirty` 后置灰 · 切走再切回输入不丢 · 360px 下 flags 换行不被裁切。

### 4.4 已知边界

多行/拼接/变量引用的模式不识别；`re.X` 下离线高亮与真实语义有偏差（真值以面板为准）；单文件 lens 上限 20 之外的位置只有右键入口。

---

## 5. PR-3 · 格式串工具（1.5 天）

- **纯函数** `shell/src/libFormat.ts`：三类码表（strftime / 数字格式规范 / logging `%(…)s`）+ 分段解释 + 未知码判定。单测：码表覆盖、分段解释、`{:q}` / `%Q` 判定、边界（`{}`、`{!r}`、`{0!s:>10}`）。
- **面板** `devtools/builtin/format.ts`：三模式 `radioGroup` + 速查 chips（按频率排序，点击插入光标处）+ 可编辑示例值 + 等宽结果区（复制按钮就近，缺陷 #20 教训）+ 逐段解释（点击段 → 模式框内选中）。求值用 `format_preview` kind。
- **hover**：与 PR-2 同一挂法（R-1 结论复用），显示「示例输出」+ 分段说明。
- **诊断**：未知格式码 warning（hover 给常见码提示，**不臆测意图**）。
- **降级**：无解释器 → 速查表照常、预览置灰并提示（**不做 JS 近似**，口径统一）。
- **设置** `libs_format`（默认开）。
- **e2e**：三模式切换 · chips 插入 · 预览结果 · hover 示例输出 · 未知码诊断 · 降级置灰。

---

## 6. PR-4 · 脚本参数表单（2 天）

- **Rust/脚本**：新增 kind `ast_argparse`——`shell/src-tauri/scripts/ast_argparse.py` 用 `ast` 解析 `add_argument` / `click.option` / `typer.Option` 的**字面量参数**，产出 `{name, flag, type, default, help, required, choices}`。无 import、无副作用。
- **纯函数** `shell/src/scriptArgs.ts`：解析结果 → 表单模型 → 命令行拼装；反向：命令行 → 尽力回填，冲突时返回 `inconsistent` 标志（**绝不静默覆盖用户输入**）。
- **UI**：内嵌 `runConfigPanel.ts` 的脚本配置区（`fillEditor` `:121` / `run-config-args` 元素 `:32` 上方，index.html 加容器）。类型→控件映射照 §11.5；`required` 校验；三态（无参数 / 成功 / 解析失败退化为纯输入框，**都不阻止运行**）。
- **内省（默认关）**：独立 kind + `openConfirm`（`dialog.ts:162`）+ `data-tip`「将执行脚本顶层代码」+ 独立子进程 5s 超时。
- **入口**：编辑器 lens「⚙ N 个参数」→ 打开运行配置面板并聚焦参数区（D-3，**不新增侧栏视图**）。
- **设置** `libs_argparse`（默认开）。
- **e2e**：解析出 3 个参数 → 表单渲染（下拉/勾选/文本框）→ 拼出命令行 → 保存到运行配置 → 手工改命令行后标注不一致 → 无参数脚本的空态。

---

## 7. 第二批（P1）要点

| 项 | 要点 | 量级 |
|---|---|---|
| 输出面板日志级别 | `output.ts`：`renderLineContent`（`:85`）加级别识别（前缀规则表）+ 左侧色条；顶部过滤 chips（多选 `aria-pressed`，复用 `channelVisible`/`refilterOutputChannel`（`:237`）的既有过滤思路）；默认只着色不过滤；错误行复用既有 traceback 跳转 | 0.5 天 |
| JSON → Pydantic / dataclass / TypedDict | 纯前端 DevTool，零求值；类型推断规则（bool/int/float/str/list/dict/嵌套）+ 可选 dataclass / TypedDict 输出 | 1 天 |
| JSON 字面量注入 | 高亮 + 折叠 + 诊断；右键三项「格式化/压缩/JSONPath 提取」——后两项只是给既有 `jsonfmt`/`jsonpath` 补编辑器入口 | 1 天 |
| 注入规则表框架化 | 把 PR-2/3 + JSON 的识别规则收敛成一张规则表 + 统一 dispatcher（回头重构，放在 4 个 PR 之后） | 0.5 天 |

---

## 8. 验收基线（每 PR 通用）

```
cd shell && npx tsc --noEmit        # 类型
cd shell && npm run test            # vitest（纯函数用例）
cd shell/src-tauri && cargo test    # Rust（涉及 Rust 时）
cd shell && npx playwright test e2e/<域>/…   # 相关 e2e
```

- 涉及**键位**或**设置**的改动跑**全量 e2e 回归**（PR-G 先例：全局影响面）。
- 涉及诊断桶的改动确认不干扰 lsp / intel / ruff 三桶。
- `welcomeShortcuts.ts` 与菜单项按需同步。

---

## 9. 风险登记（动手前先看，实现中回填结论）

| # | 风险 | 处置 |
|---|---|---|
| **R-1** | **Monaco 多 hover provider 是否合并**未验证（影响 PR-2/PR-3 的 hover 挂法） | PR-2 开工第一步实测；不合并则改走 `lsp/client.ts:714` 现有合并管线追加 |
| **R-2** | CodeLens 显示顺序是否由 provider 注册顺序决定（`[工具][引用]` 需要确定性） | PR-2 实测；不可控则在 dslLens 内按"本行是否已有引用 lens"降级（只出工具 lens 时另议，需回改文档） |
| **R-3** | Python 脚本打包遗漏（release 找不到文件） | 采用 `include_str!` 编译进二进制，不走 bundle resources |
| **R-4** | `run_with_timeout`（`env_cmds.rs:391`）为私有 `fn` | 改 `pub(crate) fn`，或在 `lib_cmds` 内复用同名逻辑（**优先改可见性，禁止复制一份**） |
| **R-5** | 面板内第二个 Monaco 实例的**内存**开销未测出（P6 中 `performance.memory` 被量化） | 探针 P7：PR-2 实现期在真实面板复测，决定面板 LRU 缓存上限（现为 5）是否下调 |
| **R-6** | 大文件（>2000 行）decorations 性能未知 | 探针 P5：PR-2 实现期用 bench 项目实测，超预算则加"可见区域才扫描"的闸门 |
| **R-7** | `-I` 隔离模式下 `sys.path` 变化 | 受控脚本只用标准库（re / datetime / ast / json），不 import 用户模块 → 无影响；`ast_argparse` 走 `ast.parse` 读源码文本，同样安全 |
| **R-8** | click/typer 的静态解析覆盖率低 | v1 只承诺 argparse 完整 + click 基础；解析失败一律降级为纯命令行输入框（不阻断运行） |
