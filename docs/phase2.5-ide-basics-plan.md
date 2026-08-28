# Phase 2.5 · IDE 基础功能完善计划

> 日期：2026-08-21 · 状态：**待评审（本文档为开发依据）**
> 定位：Phase 2（probe）与 Phase 3（intel）之间的插队批次——补齐 IDE 日常可用性短板。
> 上游：`python_ide_tech_plan_v3.md`（架构原则不变：Tauri 外壳 + 独立组件 + 不侵入用户项目）。

## 1. 背景与范围

Phase 1/2 交付了「能写、能补全、能运行、能采集」的闭环，但作为日常 IDE 还缺三块基本能力：

1. **文件管理**：文件树只读——不能新建/删除/重命名，用户得切资源管理器；
2. **Python 环境管理**：运行按钮硬编码 `uv run`——无法选择解释器、无法创建环境、裸目录（无 pyproject.toml）行为不可控；
3. **编辑器基本功能**：符号大纲、标签管理、自动保存、设置面板等缺失。

**范围控制**：本批次只做「单人日常开发必需」项；终端（xterm.js）、Git 集成、全局搜索原计划留 Phase 4，现已均提前交付（见 §9 / §11）。

## 2. 现状盘点

| 能力 | 现状 | 缺口 |
|---|---|---|
| 文件树 | 浏览/展开/点击打开（`fs_cmds.rs::read_dir`） | 增/删/改名/复制全缺 |
| 标签页 | 打开/关闭/脏标记/Ctrl+S | 无右键菜单（关闭其他等）、无最近文件 |
| 编辑器 | Monaco + LSP 补全/hover/跳转/诊断 | 无大纲、无设置、无字体缩放 |
| 运行 | `uv run` + probe 注入（P2-T06） | 解释器不可选、环境不可创建 |
| LSP | pyrefly/basedpyright 切换 | `workspace/configuration` 一律回 null——引擎不知道用户选的 Python 环境，第三方库解析靠猜 |
| 输出面板 | 流式输出 + traceback 跳转 | — |

## 3. F1 文件管理

### 3.1 功能规格

| 操作 | 入口 | 行为 |
|---|---|---|
| 新建文件 | 树右键 / 工具栏 | 弹输入框（支持相对路径如 `pkg/mod.py` 自动建目录）；空文件创建后立即打开 |
| 新建文件夹 | 树右键 | 弹输入框（支持嵌套路径） |
| 重命名 | 树右键 / F2 | 弹输入框；**联动**：打开中的标签更新路径、LSP didClose+didOpen、诊断缓存迁移、Monaco model 重建 |
| 删除 | 树右键 / Del | 确认框（显示路径）；**移入系统回收站**（可恢复，不直接删）；打开中的标签先关闭 |
| 复制/粘贴 | 树右键 | 复制文件/文件夹到剪贴板（内部格式）；粘贴到目标目录（同名自动加后缀 ` - 副本`） |
| 在资源管理器中显示 | 树右键 | 打开父目录并选中该文件（`explorer /select`） |
| 复制路径 | 树右键 | 绝对路径进系统剪贴板 |

### 3.2 设计要点

- **回收站删除**：Rust 侧用 `trash` crate（跨平台，Windows 走 SHFileOperation）；**不用** `std::fs::remove_dir_all`——误删不可恢复，违背 IDE 底线；
- **重命名联动**是本模块最复杂的点，顺序：磁盘改名 → 关闭旧标签（不触发保存确认，内容已在磁盘）→ 以新路径重开（内容不变）→ LSP `didClose(旧)` + `didOpen(新)` → 诊断缓存 key 迁移 → 树刷新；
- 所有写操作后**局部刷新树**（只重建受影响目录节点，不整树重载）；
- 树节点右键菜单用自绘 div（不用原生 contextmenu 的默认行为），与现有树渲染风格一致。

### 3.3 Rust 命令（新增）

```
create_file(path) / create_dir(path)
rename_path(old, new)          // 文件或目录
trash_path(path)               // 回收站
copy_path(src, dst) / paste_path(src, dst_dir)
reveal_in_explorer(path)
copy_to_clipboard(text)        // tauri clipboard-manager 插件
```

## 4. F2 Python 环境管理

### 4.1 功能规格

**环境面板**（状态栏解释器点击 / 工具栏按钮打开）：

| 功能 | 行为 |
|---|---|
| 环境列表 | 扫描：① 工作区 `.venv`（标记「工作区」）；② `uv python list` 的系统 Python（标记版本+路径）；③ 手动添加的解释器路径 |
| 创建环境 | 选 Python 版本 → `uv venv .venv --python <ver>`（工作区内）；创建后自动选中 |
| 选择解释器 | 单选；存工作区配置；状态栏即时更新 |
| 包查看 | 选中环境后列出已装包（`uv pip list --python <解释器>`），显示包名+版本 |
| 包安装/卸载 | 输入框 `requests==2.31` 风格 → `uv pip install/uninstall --python <解释器>`；输出流式进输出面板 |

**运行联动**（改 `lsp.rs::run_script`）：

```
选中解释器 → 直接 <解释器> <file> 运行（不再经 uv run）
未选中     → 维持现状 uv run（项目有 pyproject.toml 时语义正确）
```

probe 注入（PYTHONPATH + AUTOSTART + SCRIPT）对两种方式同样生效，无需改动。

**LSP 联动**（改 `lsp/client.ts` 的 `workspace/configuration` 响应）：

- basedpyright：响应 `python.pythonPath = <选中解释器>`——引擎据此解析 site-packages，第三方库补全/诊断立即正确；
- pyrefly：Rust 实现，读 `PYREFLY_PYTHON_VERSION` 或初始化参数（查文档确认，T02 spike 项）；
- 未选解释器时维持回 null（引擎默认行为）。

### 4.2 设计要点

- **解释器选择存储**：`~/.opencharm/workspaces/<project-hash>.json`（复用 probe 的 hash 算法）——**不往用户项目里写文件**（不侵入原则；对比 VSCode 写 `.vscode/settings.json`）；
- **优先级**：工作区配置 > 工作区 `.venv` 自动检测（首次打开提示「检测到 .venv，是否使用？」）> 无（uv run 兜底）；
- `uv` 命令超时保护（创建环境/装包 60s 超时，进度流式输出）；
- 环境面板用模态对话框（与欢迎页同风格），不做常驻侧栏——使用频率低，不值得占布局。

### 4.3 Rust 命令（新增）

```
list_pythons()                          // uv python list 解析 + .venv 检测
create_venv(workspace_root, version)    // uv venv
get_interpreter(workspace_root) / set_interpreter(workspace_root, path)
list_packages(interpreter)              // uv pip list
pip_install(interpreter, spec) / pip_uninstall(interpreter, name)
```

## 5. F3 编辑器基本功能

### 5.1 已内置无需开发（Monaco standalone 自带，验收时确认可用即可）

查找替换（Ctrl+F/H）、注释切换（Ctrl+/）、撤销重做、跳转行（Ctrl+G）、多光标、括号匹配、自动缩进、代码折叠。

### 5.2 需开发

| 功能 | 规格 | 优先级 |
|---|---|---|
| **符号大纲** | LSP `textDocument/documentSymbol` → 侧栏树（类/函数/变量，点击跳转，随编辑防抖刷新 500ms） | 高 |
| **标签右键菜单** | 关闭 / 关闭其他 / 关闭右侧 / 关闭全部 / 复制路径 / 在资源管理器中显示 | 高 |
| **自动保存** | 设置项：关（默认）/ 1s 延迟 / 失焦时；自动保存同时发 didSave | 高 |
| **字体缩放** | Ctrl+滚轮（8-32px），状态栏显示，存全局配置 | 中 |
| **最近文件** | 工作区级最近打开 10 个，欢迎页 + 文件菜单入口 | 中 |
| **设置面板** | 模态：主题（vs-dark/vs）、字号、自动保存、探针开关（运行时是否注入）、LSP 引擎默认值；存 `~/.opencharm/settings.json` | 中 |
| **探针开关** | 设置项「运行时采集」默认开；关时 `run_script` 不注入环境变量（用户可全局关闭运行时层——技术方案 §7.2 承诺） | 高 |
| **命令面板** | Ctrl+Shift+P，聚合上述全部命令 | 低（可选） |

### 5.3 设计要点

- 大纲树与文件树同在侧栏，顶部加切换 tab（FILES / OUTLINE）；
- 设置读取链：`~/.opencharm/settings.json` → 前端内存 → Monaco/editor.updateOptions；
- 探针开关传给 Rust：`run_script(path, probe: bool)` 参数化。

## 6. 任务分解

| 编号 | 任务 | 内容 | 工作量估 |
|---|---|---|---|
| P25-T01 | 文件管理 Rust 命令 | §3.3 全部命令 + trash crate + 单测（重命名联动逻辑抽函数可测） | 2 天 |
| P25-T02 | 文件树 UI | 右键菜单 + 新建/重命名/删除/复制粘贴交互 + 局部刷新 | 2 天 |
| P25-T03 | 重命名联动 | 标签/LSP/诊断缓存/树 全链路更新 | 1 天 |
| P25-T04 | 环境管理 Rust 命令 | §4.3 全部 + 工作区配置存储 | 2 天 |
| P25-T05 | 环境面板 UI | 列表/创建/选择/包管理 + 状态栏解释器 | 2 天 |
| P25-T06 | 运行 + LSP 环境联动 | run_script 解释器分支 + workspace/configuration 响应 + pyrefly 传参 spike | 1.5 天 |
| P25-T07 | 符号大纲 | documentSymbol → 侧栏树 + 防抖刷新 | 1.5 天 |
| P25-T08 | 标签菜单 + 自动保存 + 字体缩放 | §5.2 高优先级三项 | 1 天 |
| P25-T09 | 设置面板 + 探针开关 + 最近文件 | §5.2 中优先级三项 | 1.5 天 |
| P25-T10 | 验收回归 | 手动清单过一遍 + probe 53 单测 + bench 开销回归（确认 run_script 改动无回退） | 0.5 天 |

**建议顺序**：T01→T02→T03（文件管理闭环）→ T04→T05→T06（环境闭环）→ T07→T08→T09（编辑器）→ T10。

总计约 15 个工作日。

## 7. 验收标准

1. **文件管理**：新建/重命名/删除（回收站可恢复）/复制粘贴全通；重命名打开中的文件后标签、补全、诊断均指向新路径；
2. **环境管理**：能创建 venv、选择解释器后运行按钮用该解释器、basedpyright 对第三方库的补全正确（bench 样例 `requests` 场景）、包安装卸载可用；
3. **编辑器**：大纲随编辑刷新、自动保存可配、探针开关生效（关后运行无 `[opencharm-probe]` 输出）；
4. **无回退**：probe 53 单测全绿、bench 开销 < 1.5x、Phase 1 验收项（补全/跳转/traceback 跳转）复测通过。

## 8. 风险与边界

| 风险 | 应对 |
|---|---|
| 重命名联动遗漏（诊断缓存/待同步集合等散落状态） | T03 单独任务 + 联动逻辑集中到一个 `renameOpenedFile()` 函数 |
| `uv pip` 对非 venv 解释器（系统 Python）的行为差异 | 环境面板对系统 Python 禁用卸载（只读展示），安装提示用 `--python` 指定 |
| trash crate 在 Windows 的回收站语义 | T01 首个验收点：删除后回收站可见可还原 |
| pyrefly 环境传参方式不明 | T06 内 spike，查 pyrefly 文档/源码；不行则记录已知限制（pyrefly 自身对 site-packages 的解析策略） |
| 裸目录（无 pyproject）uv run 行为 | 环境管理正是解法：引导用户创建 .venv 或选解释器 |

## 9. 明确不做（留 Phase 4）

- ~~集成终端（xterm.js）~~ —— 已提前交付（`terminal.rs` + `terminal.ts`，xterm.js + portable-pty 多会话）；
- ~~Git 集成~~ —— 已超出「状态装饰」范围交付：状态装饰（`git_status.rs`）、暂存/取消暂存/提交/单文件 diff、分支查看/切换/新建（`git_cmds.rs`）、文件树目录级变更标记、diff 着色；行内 diff 视图、远程操作（push/pull）留后续（见 tech-debt TD-002）；
- ~~全局搜索（跨文件 grep）~~ —— 已在 P25 期间补齐并升级为 ripgrep 生态引擎，见 §11；
- 多工作区/多窗口；
- 远程开发。

## 10. 与 Phase 3 的衔接

本批次完成后，Phase 3（opencharm-intel）启动条件更充分：

- 环境管理交付的「解释器选择」是 intel 引擎初始化的输入之一（trace 库按项目隔离，intel 按工作区加载）；
- 设置面板的「探针开关」为 Phase 3 的「运行时层全局开关」提供 UI 落点（技术方案 §7.2 承诺的确定性合并规则入口）；
- 符号大纲的 documentSymbol 通道可被 intel 复用（运行时类型 inlay hints 的定位基准）。

## 11. 追加交付：全局搜索（范围外补齐，已上线）

> §9 原将「全局搜索」列为留 Phase 4 项；实际已在 P25 期间随符号大纲（P25-T07）一并补齐，并于后续升级为 ripgrep 生态引擎。此处记录现状与行为约定。

### 11.1 实现概览

- 入口：侧栏 SEARCH tab（Ctrl+Shift+F）；后端命令 `fs_cmds.rs::search_workspace`，前端 `search.ts`。
- 交互：**回车确认搜索**（不做边输边搜——曾尝试防抖自动搜索，因并发搜索拖垮输入响应而回退）；**清空输入即清空结果**并使进行中的搜索作废；大小写开关；搜索中显示「搜索中…」；结果按文件分组、行级高亮，点击跳转定位；分批渲染（单批 500 条 +「加载更多」）；请求令牌丢弃过期结果，避免旧结果回填。
- 返回结构：`{ matches, files_scanned, files_skipped, files_skipped_binary, truncated }`；匹配上限 5000，超出截断并提示细化关键词；汇总行展示跳过细分（二进制 / 超大）。

### 11.2 搜索引擎（对齐 VS Code）

- 遍历：ripgrep 生态 `ignore` crate（`WalkBuilder`）——**.gitignore 感知 + 隐藏文件过滤**，另以 `SEARCH_IGNORED_DIRS` 名单兜底剪枝未入 gitignore 的噪声目录（`node_modules` 等）。
- 匹配：按 CPU 核数**多线程并行**（`std::thread::scope`），原子量共享扫描/跳过/匹配计数与截断标志。
- 大小写不敏感：纯 ASCII 关键词走字节级匹配（零逐行分配）；非 ASCII 回退整行 `to_lowercase`，保证 Unicode 正确。
- 约束：单文件 ≤ 2MB（超出跳过）；**二进制探测先读前 8KB 查 `\0`**，命中即跳过、不整读（数据类项目大量二进制文件时的性能关键），非 UTF-8 亦跳过，均计入 `files_skipped`（二进制数单列 `files_skipped_binary`）。

### 11.3 行为约定（相对早期白名单实现的差异）

1. **尊重 .gitignore**：被忽略的文件不参与搜索；
2. **跳过隐藏项**：`.` 开头文件/目录默认不搜；
3. **取消扩展名白名单**：搜索所有非隐藏、非 gitignore 的文本文件（早期仅 14 种白名单扩展名，已移除以对齐 VS Code）。
