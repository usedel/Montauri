# PyCharm 运行体系调研报告与 OpenCharm 改进建议

> 版本：v1.0 · 日期：2026-09-13 · 性质：调研报告（**非排期依据**）
> 调研对象：PyCharm（Community/Professional，2024.1+ 行为为准）的「运行」体系
> 调研方法：JetBrains 官方文档（pycharm/help，2026.2 Help）+ 本仓库 shell/ 源码逐项核对（证据见 §3）
> 结论用途：为 Phase 4「打磨期」的运行体验改进提供输入；**是否立项、何时排期以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准**
> 姊妹报告：[`pycharm_feature_research_report.md`](pycharm_feature_research_report.md)（导航 / 调试 / 代码卫生方向）。本报告**只聚焦「运行」**，不重复其结论。

---

## 0. 一页结论

用户反馈的两条症状（「有输入就报错，要手动设交互模式」「只能跑单文件，FastAPI 项目跑不起来」），根因不是运行链路的实现 bug，而是**运行模型比 PyCharm 少了两层抽象**：

1. **缺少「配置为中心」的执行单元**：我们以「当前文件」为运行单元，PyCharm 以 **Run/Debug Configuration** 为运行单元（可命名、可持久化、可复用、多标签并行）；
2. **缺少「项目级入口」的表达能力**：我们的运行命令只有一种形态 `<解释器> <脚本绝对路径>`，且工作目录**恒等于脚本所在目录**；PyCharm 的入口是 **`Script path` 或 `Module name`（= `python -m`）二选一**，工作目录可配置（支持 `$PROJECT_DIR$` 等宏）。

由此直接导致：

| 反馈 | 根因 | 证据 |
|---|---|---|
| 有输入的脚本报错、需手动改配置 | 运行配置 `stdin` **默认值为 `null`**，`input()` 立即收到 EOF；而 PyCharm 的 Run 控制台**默认可输入**，`Emulate terminal` 只是为 getpass/tqdm 这类真 TTY 需求准备的可选项 | `shell/src-tauri/src/env_cmds.rs:134`、`shell/src-tauri/src/lsp.rs:357-367`、`shell/index.html:438` |
| 只能跑单文件，FastAPI 不适用 | 运行命令无 `-m` 分支、`RunConfig` 无入口类型 / 工作目录字段、cwd 恒为脚本目录 → `uvicorn main:app` 无法表达（既缺 module 入口，也缺项目根 cwd） | `shell/src-tauri/src/run_env.rs:206-237`、`shell/src-tauri/src/env_cmds.rs:174-185`、`shell/src-tauri/src/lsp.rs:382`、`shell/src-tauri/src/terminal.rs:370` |

**改进主线**：把「运行单元」从**文件**升级为**配置**，先补 P0 五项（stdin 默认交互 / EOF 一键补救 / Module 入口 / 可配置 cwd / FastAPI 预设），即可闭环用户两条反馈；P1 再补齐配置模型（命名配置、`.env`、多实例询问、软杀）与运行窗口细节。

**已有差异优势必须保住**：运行前依赖预检、probe 运行时采样注入、traceback 点击跳转、选区运行、单脚本 cwd 锚定脚本目录——这些是 PyCharm 没有或我们更强的部分，不以对标之名删减。

---

## 1. 调研范围与方法

- **调研对象**：PyCharm 中与本项目功能范围（脚本运行 + 调试 + 终端）重叠或邻近的「运行」能力与交互细节。
- **明确排除**（与项目非目标对齐，见 `python_ide_tech_plan_v3.md` §1.2、`python_ide_dev_plan_v2.md` §1.1）：远程解释器 / SSH / Dev Container、Docker / Docker Compose 运行、Jupyter、数据库工具、插件市场、协作编辑、AI 助手、Scientific 模式；pytest 面板（计划明列「不做」）。
- **现状盘点**：对 `shell/src/*.ts`、`shell/src-tauri/src/*.rs` 逐项核对，证据在 §3 给出文件与行号；与 `tech-debt.md` 已登记项去重（TD-9 运行配置孤儿条目、TD-10 stdin 绝对路径在本报告中作为「顺带偿还」提及，不重复推荐）。
- **文档日期说明**：JetBrains 帮助页当前版本为 2026.2，文中「默认行为」以该版本文档为准。

---

## 2. PyCharm 运行体系（模型层）

### 2.1 一切运行都经配置，配置有生命周期

- 每次运行/调试都会**创建或复用**一个 Run/Debug Configuration：由快捷键、右键 Run、gutter ▶ 触发的运行会自动生成**临时配置**（默认上限 **5** 个，超出后最旧者被自动淘汰；上限可在 `Settings | Advanced Settings | Run/Debug` 调整）。
- 临时配置可「**Save Configuration**」升格为**永久配置**：可命名、可复制（`Ctrl+D`）、可按文件夹分组、可通过 `Store as project file` 落到 `.idea/runConfigurations` 并随 VCS 共享（默认关闭，否则存于 `.idea/workspace.xml`）。
- 配置图标区分状态：永久=不透明、临时=半透明、**红色叉号=配置有错误**。
- **同一份配置运行与调试共用**——这一点我们已对齐（`dap.rs::debug_start` 直读 `run_configs`，见 `pycharm_feature_research_report.md` §4 P1-9）。

### 2.2 入口二选一：`Script path` 或 `Module name`

这是 PyCharm 能跑「项目」而不只是「文件」的**根本机制**：

- `Script path`：执行一个 .py 文件；
- `Module name`：等价 `python -m <module>`，用于包入口、以及所有以模块/对象方式启动的框架：
  - FastAPI / Starlette：`uvicorn main:app`（Module name = `uvicorn`，Parameters = `main:app --reload`）
  - Flask：`flask run`；Django：`manage.py runserver`；`pytest`；`gunicorn` 等；
- 字段均支持**路径变量 / 宏**（`$PROJECT_DIR$`、`$FileDir$` 等，见 §2.3）。

对应的「运行上下文」也更多样：`if __name__ == '__main__'` 守卫行、测试函数、web 框架的应用对象声明处均可出现 gutter ▶；Project 视图中还能以「模块」为上下文运行。

### 2.3 默认值「默认就对」

| 项 | PyCharm 默认行为 | 与我们对比 |
|---|---|---|
| **工作目录** | 由 `Ctrl+Shift+F10` / 右键 Run **自动创建**的临时配置，默认 = **包含可执行脚本的目录**（官方明确，且可能不同于项目目录）；字段留空则回退到 PyCharm 安装目录的 `bin`；字段**可配置**，支持路径变量/宏 | ✅ 我们脚本路径 cwd=脚本目录，与之一致；❌ 但我们**不可配置**，Module 场景无法切到项目根 |
| **`PYTHONUNBUFFERED`** | **默认注入 = 1** | ✅ 已对齐（`run_env.rs:125`） |
| **PYTHONPATH** | 可选勾选「Add content roots / source roots to PYTHONPATH」 | 🟡 我们更激进：**总是**把工作区根塞进 PYTHONPATH 末段（`run_env.rs:144-147`，为对齐依赖预检） |
| **`.env` 文件** | `Paths to ".env" files`：有序列表，逐个加载 | ❌ 不支持 |
| **标准输入** | Run 控制台**默认可直接键入**（程序 `input()` 即从控制台取）；需要复现时用 `Redirect input from` 指定文本文件 | ❌ 我们默认 `null`（立即 EOF），交互需手动切换第三档 |
| **TTY 需求** | `Emulate terminal in output console`（新版 UI 又称 `Run with terminal` / `Use terminal`）勾选后启用终端仿真，覆盖 getpass、`print(..., end='\r')` 进度条、ANSI 颜色、光标控制 | ✅ 我们有「在终端中运行」（真 PTY）等价；🟡 但需手动选，且与 `stdin=file` 互斥（明确拒绝） |
| **多实例** | `Allow multiple instances` 默认**关**；已在跑时**弹窗提示「停止正在运行的实例并启动新实例」** | 🟡 我们单实例，但**硬报错**而非询问 |
| **Stop** | **先软杀**（发送等价 Ctrl+C / SIGINT，应用可捕获做优雅退出），随后按钮变为可**强制终止** | ❌ 我们直接 `taskkill /T /F` |
| **解释器** | **每个配置**可独立选择解释器 | 🟡 我们为工作区级唯一值 |
| **输出窗口** | 每配置一个标签页；可 Pin Tab、Split；Rerun `Ctrl+F5`；`Show console when a message is printed to stdout/stderr`；可 `Save console output to file` | 🟡 我们有输出面板 + 运行历史，但无「活标签页 / Pin / 重跑」 |
| **多解释器选项** | `Interpreter options`（传给解释器本身的命令行选项）、`Run with Python console`（跑完进入可交互控制台） | ❌ 均不支持 |

### 2.4 控制台（piped）与终端模拟（PTY）的分工

PyCharm 把两者明确分开，这点非常重要，**它决定了「stdin 默认值」的正确设计**：

- **默认（未勾选 Emulate terminal）**：进程 stdout/stderr 走管道，stdin 接控制台输入框。此时 `input()` **正常工作**（用户打字），但 `isatty() == false`，因此 `getpass` 回显异常、`\r` 进度条失效、ANSI 颜色可能被转义或丢失。
- **勾选 Emulate terminal**：为进程分配**伪终端**，`isatty() == true`，上述 TTY 依赖行为全部恢复；代价是输出被终端语义接管（自动换行、宽字符处理等与管道不同）。

对照我们：输出面板 = piped（我们默认 `stdin=null`，**比 PyCharm 还少一档**）；「在终端中运行」= PTY（等价 Emulate terminal）。

### 2.5 Run 工具窗口（每配置一标签）

- 每个运行配置的输出各占一个标签页，标签名 = 配置名；
- 可 `Pin Tab`（重跑不清空输出）、`Split and Move`，支持拖放分屏；
- 工具栏：Rerun（`Ctrl+F5`）／Rerun automatically（源码变更自动重启，类 autotest）／Stop（`Ctrl+F2`）／Close（`Ctrl+Shift+F4`）；
- 控制台工具栏：上下跳转堆栈（`Ctrl+Alt+↑/↓`）、软换行、`Scroll to the end`、Clear All、Print；
- 上下文菜单：`Copy URL`（**仅当输出中含 URL 时出现**）、`Compare with Clipboard`、`Clear All`。

### 2.6 FastAPI 的具体落地路径

- **Professional**：`File | New Project` 选 FastAPI 会自动安装 `fastapi` / `uvicorn`、生成 `main.py` 与 `test_main.http`，并**自动生成且选中**一个运行配置；跑起来后可在 Run 窗口**点链接在浏览器预览**；可通过 `Edit configurations` 追加 uvicorn 选项（官方示例：`--reload delay 10`）。
- **Community 等效做法**：Python 配置 → `Module name = uvicorn`、`Parameters = main:app --reload`、`Working directory = 项目根`。
- **Run anything**（`Ctrl+Ctrl`）：不建配置直接跑任意命令行（如 `uvicorn main:app --reload`），带历史与补全——「临时想跑一下」的逃生口。

### 2.7 启动前任务与并行

- `Before launch` 任务按序执行，含：`Run Another Configuration`（等待其结束后再启动当前配置）、`Launch Web Browser`（启动浏览器并给 URL）、`Run External tool`、`Run npm script`、`Compile TypeScript` 等；配合 `Compound run/debug configuration` 可**并行**启动多个配置（如 FastAPI + 定时任务 worker）。

---

## 3. OpenCharm 运行现状盘点（源码证据）

### 3.1 总体：两条并列路径 + 一套共用装配

| 路径 | 前端入口 | Rust 命令 | 输出落点 | 是否有 TTY |
|---|---|---|---|---|
| 输出面板（默认） | `runActive()` | `lsp::run_script` | 输出面板（`run-stdout/stderr/exit`） | ❌ piped |
| 运行终端 | `runActiveInTerminal()` | `terminal::run_in_terminal` | 专用「运行终端」tab | ✅ portable-pty（Windows ConPTY） |
| 运行选区 / 行 | `runSelection()` | 复用 `lsp::run_script` | 输出面板 | ❌，且**刻意不套运行配置** |

两条路径共用命令与环境装配 `shell/src-tauri/src/run_env.rs`（`resolve_run_command` / `build_run_env` / `assemble`），共享运行态（`shell/src/main.ts` 的 `running / runningPath / runChannel / lastRun`）。

### 3.2 命令形态：只有 `<解释器> <脚本>`，无 `-m`

```rust
// shell/src-tauri/src/run_env.rs:206-237
pub(crate) fn resolve_run_command(
    script_abs: &Path,
    file_name: &str,
    interpreter: Option<&str>,
) -> RunCommand {
    match interpreter {
        Some(interp) => RunCommand {
            program: interp.to_string(),
            args: vec![script_abs.to_string_lossy().to_string()],   // ← 唯一形态
            env: Vec::new(),
            is_uv: false,
        },
        None => { /* uv run <file_name> */ }
    }
}
```

全仓库无 `-m` / module 运行路径。

### 3.3 工作目录：恒为脚本所在目录，且不可配置

```rust
// shell/src-tauri/src/lsp.rs:381-385（PTY 路径同款，terminal.rs:370）
cmd
    .current_dir(&dir)        // dir = path.parent()
    .stdin(stdin_stdio)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
```

`RunConfig` 中**没有** cwd / module / 入口类型字段：

```rust
// shell/src-tauri/src/env_cmds.rs:174-185
pub struct RunConfig {
    pub args: String,          // 脚本参数（shell-words 拆分）
    pub env: Vec<EnvVar>,      // 自定义环境变量
    pub stdin: StdinConfig,    // null | file | interactive
}
```

### 3.4 stdin：默认 `null`，交互是靠手动切的第三档

```rust
// shell/src-tauri/src/env_cmds.rs:133-136
fn default_stdin_mode() -> String {
    "null".to_string()
}
```

```rust
// shell/src-tauri/src/lsp.rs:357-367
let stdin_mode = run_config.stdin.effective_mode();
let interactive = stdin_mode == "interactive";
let stdin_stdio = if stdin_mode == "file" {
    ... Stdio::from(f)
} else if interactive {
    Stdio::piped()
} else {
    Stdio::null()          // ← input() 立即 EOF
};
```

前端下拉的默认档也是「不接输入」（`shell/index.html:436-441`）。已有 `maybeHintEof`（`main.ts:1886-1899`）能在 EOFError 时给出归因提示，但**只是提示、不能一键补救**。

### 3.5 其余已知边界

| 项 | 现状 | 证据 |
|---|---|---|
| 解释器 | 工作区级唯一值（工作区配置 > `.venv` 自动检测 > `uv run` 兜底），运行配置内**无**该字段 | `env_cmds.rs:602-605` |
| `.env` 文件 | 不支持 | — |
| 多实例 | 单实例，冲突时**硬报错**（未运行态三态互斥：输出面板 / PTY / 调试） | `lsp.rs:310-324`、`terminal.rs:306-316` |
| 停止 | `taskkill /T /F` 直接强杀进程树 | `lsp.rs:534-545`、`util.rs:121+` |
| 运行历史 | 留存最近 20 次输出（可回看 / 可删），是「输出留档」而非「活标签页」 | `runHistory.ts:55-77` |
| URL 识别 | 无；输出中 URL 不可点 | — |
| Before launch | 无 | — |
| 依赖预检 | ✅ 运行前 `check_missing_imports`，缺失即弹确认 | `main.ts:1627-1644`、`env_cmds.rs:715-756` |
| traceback 跳转 | ✅ 输出面板正则 + xterm link provider | `output.ts:17`、`main.ts:2346-2361` |
| probe 采样注入 | ✅（输出面板路径；PTY 路径恒关） | `run_env.rs:167-177`、`terminal.rs:353` |

### 3.6 顺带发现的两处小缺陷

1. **文案与实际不符**：运行配置面板写着「此配置对「运行」与「调试」同时生效（同一份参数 / 环境变量 / **工作目录**）」（`shell/index.html:430`），但 `RunConfig` 并**无工作目录字段**——会让用户误以为 cwd 可配。
2. **`stdin=file` 与 PTY 互斥**已明确拒绝并给出出路（`terminal.rs:340-345`），属合理取舍；但在「默认交互」改动后需要在 UI 上更清晰地表达「三种 stdin 模式 × 两种运行路径」的可用矩阵。

---

## 4. 差距映射总表

> 现状证据来源：`shell/` 源码逐项核对（路径以 `shell/` 为根）。✅ 已实现 / 🟡 部分 / ❌ 未实现。

| # | PyCharm 功能 | 现状 | 证据 | 建议动作 | 量级 |
|---|---|---|---|---|---|
| R-1 | 运行配置为执行单元（临时→永久、命名、分组、共享） | 🟡 | 仅「按脚本路径为键」的轻量配置：`env_cmds.rs:196-255` | 升级为配置列表模型（P1-F） | 中 |
| R-2 | `Script path` / `Module name` 二选一 | ❌ | `run_env.rs:206-237` | 加 `entry{kind,target}`（P0-C） | 小 |
| R-3 | 工作目录可配置（含宏） | ❌ | `lsp.rs:382`、`terminal.rs:370` | 加 `cwd` + `${workspaceRoot}` 宏（P0-D） | 小 |
| R-4 | stdin 默认可在控制台输入 | ❌ | `env_cmds.rs:134`、`lsp.rs:365` | 默认改 `interactive`（P0-A） | 小 |
| R-5 | EOF / 交互失败可快速补救 | 🟡 | `main.ts:1886-1899`（仅提示） | 提示升级为可点击动作（P0-B） | 小 |
| R-6 | `Redirect input from`（文件重定向） | ✅ | `env_cmds.rs:141-171`、`lsp.rs:359-362` | 无需动作 | — |
| R-7 | `Emulate terminal`（真 TTY） | ✅ | `terminal.rs:298-387` | 无需动作；补 UI 提示 | — |
| R-8 | `.env` 文件列表 | ❌ | — | 支持有序 `.env` 注入（P1-G） | 小 |
| R-9 | 每配置一标签页 / Pin / Split / Rerun | 🟡 | `runHistory.ts`（留档非活标签） | 运行窗口升级（P2-M） | 中 |
| R-10 | `Allow multiple instances` + 询问式冲突 | 🟡 | `lsp.rs:310-324`（硬报错） | 改询问式 + 可选多实例（P1-H） | 小 |
| R-11 | Stop 先软杀（SIGINT）再强杀 | ❌ | `lsp.rs:539-543`、`util.rs:121+` | 先 Ctrl+C，超时再强杀（P1-J） | 小 |
| R-12 | 配置级解释器选择 | ❌ | `env_cmds.rs:602-605` | `RunConfig` 加可选解释器（P1-I） | 小 |
| R-13 | Before launch（Run Another Config / Launch Browser） | ❌ | — | 至少支持「开浏览器」与「跑另一配置」（P1-K） | 中 |
| R-14 | Compound 并行多配置 | ❌ | — | 随 R-13 一并（P1-K） | 中 |
| R-15 | 输出中 URL 可点 / `Copy URL` | ❌ | — | 输出识别 URL 并可点开（P2-L） | 小 |
| R-16 | `Rerun automatically`（变更自动重启） | ❌ | — | watch & rerun 开关（P2-N） | 中 |
| R-17 | 控制台细节（stdout 触发显示 / 存文件 / 软换行） | ❌ | — | 随输出面板迭代（P2-O） | 小 |
| R-18 | `Run anything`（`Ctrl+Ctrl`） | ❌ | — | 任意命令行入口（P2-P） | 中 |
| R-19 | `Run with Python console` | ❌ | — | 复用 `debugConsole.ts` 形态（P2-Q） | 中 |
| R-20 | FastAPI 专用预设 / 自动识别 | ❌ | — | 依赖探测 + 预设入口（P0-E） | 小 |
| R-21 | 运行前依赖预检 | ✅（**强于 PyCharm**） | `main.ts:1627-1644`、`env_cmds.rs:715-756` | 保持不变 | — |
| R-22 | traceback 点击跳转 | ✅ | `output.ts:17`、`main.ts:2346-2361`、`terminal.ts` link provider | 保持不变 | — |
| R-23 | probe 运行时采样注入 | ✅（差异化核心） | `run_env.rs:167-177` | 保持不变 | — |
| R-24 | 选区 / 行运行 | ✅ | `main.ts:1902-1974` | 保持不变 | — |

---

## 5. 推荐落地清单（供排期参考）

> 按「投入产出比」排序，全部不触碰架构第一原则（自研组件独立成包/进程、不侵入外壳内核）；改动集中在 `run_env.rs`（命令装配单一来源）+ `env_cmds.rs`（配置模型）+ 前端运行域，两条运行路径同步受益。验收沿用工程规范：bench 回归 + 内存红线不受影响。

### P0（建议尽快排期，直接闭环用户反馈）

**A. stdin 默认改为「交互式」**
- 把 `default_stdin_mode()`（`env_cmds.rs:133-136`）由 `null` 改为 `interactive`；`null` 保留为显式「不接输入」档。
- 对齐 PyCharm「控制台默认可输入」；输出面板下方的输入行（`main.ts:1847-1858`）成为常态。
- **风险与对策**：代码注释中的「坑 2：piped 无人写入会永久阻塞」——对策正是我们已有的 UI：输入行可见 + 「脚本正在等待输入…」状态（`updateRunStdinStatus`）+ `stopRun` 先 drop stdin 唤醒阻塞（`lsp.rs:536-538`）。这与 PyCharm 行为一致（程序等待输入是预期语义，不是缺陷）。
- **需同步**：`StdinConfig::effective_mode` 归一化与既有单测；调试路径（`stdin=file` 不支持），避免「默认档一改、老配置语义漂移」。
- 验收：新建脚本 `name = input("姓名: ")` 直接点 ▶ 可输入并跑通，无需改任何配置。

**B. EOFError 一键补救**
- 将 `maybeHintEof`（`main.ts:1886-1899`）从「纯提示」升级为「提示 + 可点击动作」：`以交互模式重跑` / `在终端中运行`。
- 验收：`stdin=null` 下脚本报 EOFError 时，点击提示即可重跑并成功输入。

**C. 新增入口类型：`Script` / `Module`**
- `RunConfig` 增 `entry: { kind: "script" | "module", target: String }`，默认 `{kind:"script"}` 兼容存量。
- 命令：`<解释器> -m <target>`（`uv` 分支 `uv run python -m <target>`），仍由 `resolve_run_command` 单点产出。
- 验收：配置 `module = uvicorn`、`params = main:app --reload` 可启动 FastAPI。

**D. 工作目录可配置**
- `RunConfig` 增 `cwd: String`，支持 `${workspaceRoot}` / `$PROJECT_DIR$` 宏与相对路径解析（相对基准 = 工作区根）；Module 入口**默认取工作区根**，Script 入口默认仍为脚本目录。
- 同步 `lsp.rs:382` 与 `terminal.rs:370` 两处；同时修正 `shell/index.html:430` 的失真文案（§3.6-1）。
- **依赖关系**：**没有 D，C 也跑不通**（`uvicorn main:app` 需在项目根导入 `main`）。C+D 应同一 PR 交付。

**E. FastAPI / 常用 runner 预设 + 自动识别**
- 探测：工作区依赖含 `fastapi` 且存在 `app = FastAPI()` 声明 → 运行菜单出现「运行 FastAPI (uvicorn --reload)」。
- 预设可覆盖 `uvicorn` / `flask` / `gunicorn` / `streamlit`（推荐命令 + 默认 cwd + 参数模板）。
- 验收：FastAPI 项目一键起服，输出中 URL 可点（依赖 P2-L）。

### P1（建议立项，单项 2~5 天量级）

| # | 改进 | 说明 |
|---|---|---|
| F | **命名持久化运行配置** | 由「按脚本路径为键」升级为「配置列表」：name / entry / target / params / cwd / env / `.env` / stdin / 解释器覆盖 / 允许多实例 / before launch。Run 部件直接列出；**顺带根治 TD-9**（孤儿条目随新模型自然消失） |
| G | **`.env` 文件支持** | `Paths to ".env" files` 有序注入，位置在「默认注入之后、用户显式 env 之前」。FastAPI / 爬虫刚需，成本极低 |
| H | **运行冲突改询问式 + 可选多实例** | 把 `已有脚本在运行` 硬报错改为确认弹窗「停止正在运行的实例并重跑？」，与 PyCharm 默认一致；服务器类配置可开 `允许多实例` |
| I | **配置级解释器覆盖** | `RunConfig` 增可选解释器；未设则沿用工作区级（现状） |
| J | **Stop 先软杀再强杀** | 先发送 Ctrl+C / SIGINT 让 uvicorn 等优雅退出（关连接池、落日志），超时未退再 `taskkill /T /F`。对长驻服务器尤其重要 |
| K | **Before launch（最小集）** | 支持 `Launch Web Browser`（给 URL）与 `Run Another Configuration`；Compound 并行多配置可随后 |

### P2（有价值，随迭代顺带）

| # | 改进 | 说明 |
|---|---|---|
| L | **输出 URL 识别并可点开** | 检测 `http://127.0.0.1:8000` 等渲染为可点链接（对齐 PyCharm `Copy URL`）；FastAPI 跑通的「正反馈」关键 |
| M | **每配置一个可 Pin/重跑的标签页** | 在 `runHistory.ts` 基础上补「活标签 + Pin + `Ctrl+F5` 重跑」 |
| N | **`Rerun automatically`（watch & rerun）** | 与 uvicorn `--reload` 形成完整开发内环 |
| O | **控制台细节** | `Show console when stdout/stderr`、`Save console output to file`、软换行、清空 |
| P | **`Run anything` 等价入口** | `Ctrl+Ctrl` 临时跑任意命令行，带历史；「不想建配置」的逃生口 |
| Q | **`Run with Python console` 等价物** | 跑完在同一控制台进入可交互 prompt（复用 `debugConsole.ts` 形态） |

### 远期（与差异化核心联动）

- **probe 驱动的「运行热点」视图**：采样底座已在（`run_env.rs:167-177` 注入），可在一次运行后直接呈现函数级耗时——这是 PyCharm 付费版 Profiler 的轻量对标物，且贴合我们的采样底座（`pycharm_feature_research_report.md` §4 远期候选的同一方向）。
- **覆盖率运行**：依赖外部 `coverage.py`，价值中等，缓议。

---

## 6. 应保留的差异优势（不以对标之名删减）

1. **运行前依赖预检**（`check_missing_imports` + 确认弹窗）——PyCharm 无此步，能提前拦下「补全可用但运行 ImportError」；
2. **probe 运行时采样自动注入**——三层补全/跳转的数据底座，是本项目核心差异化；
3. **traceback 点击跳转**（输出面板 + xterm 双路径）；
4. **选区 / 行运行**（`runSelection`）——草稿式一次执行；
5. **单脚本 cwd 锚定脚本目录**——与 PyCharm 临时配置默认行为一致，且更符合「自用脚本集」直觉；
6. **三态互斥**（运行 / 终端 / 调试）——避免输出面板与运行终端争抢 traceback 落点的设计是正确的，P1-H 改为询问式后应**保留**互斥语义。

---

## 7. 建议落地顺序

| 阶段 | 内容 | 预估 | 达成标志 |
|---|---|---|---|
| 第 1 步 | **P0-A + P0-B** | 1 天 | 「有输入就报错」彻底消失（默认可输入 + 一键补救） |
| 第 2 步 | **P0-C + P0-D**（同一 PR） | 2~3 天 | `python -m` 一切场景可跑；cwd 可控 |
| 第 3 步 | **P0-E + P2-L** | 1~2 天 | FastAPI 一键起服 + 点 URL 开浏览器 |
| 第 4 步 | **P1-F / G / H / J** | ~1 周 | 运行配置模型闭环（命名配置 + `.env` + 询问式多实例 + 软杀）；顺带偿还 TD-9 |
| 第 5 步 | **P1-I / K，P2-M~Q** | 随迭代 | 运行窗口与细节打磨 |

---

## 8. 明确**不建议**照搬（与项目非目标/成本红线对齐）

| 功能 | 不做的理由 |
|---|---|
| Docker / Docker Compose 运行配置 | 非目标明列（`python_ide_dev_plan_v2.md` §1.1；且 probe 注入与容器环境冲突） |
| 远程解释器 / SSH / Dev Container | 非目标明列 |
| 测试运行器 / pytest 面板（配置、树视图、单测 gutter） | 计划明列「不做 pytest 面板」 |
| Jupyter / Scientific 模式 / DataFrame 查看器 | 与「FastAPI + 爬虫 + 小脚本」画像偏离 |
| `Run with Coverage` / Profiler 全功能视图 | 依赖外部 `coverage.py`；profiler 走我们自己的 probe 路线（§5 远期），不照搬 PyCharm 形态 |
| `Edit Log Files Aliases`（日志文件标签页） | 与输出面板职责重叠，价值低 |
| 完整宏/路径变量体系（`$FileDir$` 等全集） | 只做 `${workspaceRoot}` / `$PROJECT_DIR$` 两个够用的宏，避免自建表达式引擎 |

---

## 9. 附：本报告的边界说明

1. 本报告为**调研输入**，不构成排期承诺；任何落项以 `python_ide_dev_plan_v2.md` 修订与产品负责人裁决为准。
2. 本报告**未修改任何代码**；§3.6 发现的两处小缺陷（面板文案失真、stdin 模式与运行路径的可用矩阵未表达）已记录在册，随 P0 改动一并处理。
3. 未新增 `tech-debt.md` 条目：本报告列举的均为**未立项的改进需求**，非遗留缺陷；与既有 TD-9（运行配置孤儿条目）、TD-10（stdin 路径可移植性）的关系已在 §5 P1-F 中说明（新配置模型天然覆盖 TD-9）。
4. PyCharm 行为依据：JetBrains 官方帮助文档 `pycharm/help`（Run/Debug Configurations、Python run/debug configuration、Run and rerun applications、Run tool window、FastAPI 等页，2026.2 Help）。OpenCharm 现状依据：2026-09-13 源码逐项核对（证据行号见 §3/§4）。
