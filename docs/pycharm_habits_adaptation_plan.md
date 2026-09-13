# PyCharm 习惯适配与运行体验改进计划（建议稿）

> 版本：v1.1 · 日期：2026-09-13 · 性质：**建议稿（非排期依据）**
> 修订记录：v1.1 —— §3-B 由「当前配置选择器」改定为「▶ 运行上次运行的目标（粘性运行目标）」，并同步 §0 / §1 / §4 / §5 / §6 / 附录 A。
> 关联文档：[`pycharm_run_research_report.md`](pycharm_run_research_report.md)（运行体系调研）、[`pycharm_feature_research_report.md`](pycharm_feature_research_report.md)（导航 / 调试 / 代码卫生）、[`python_ide_dev_plan_v2.md`](python_ide_dev_plan_v2.md)（现行开发计划）、[`python_ide_tech_plan_v3.md`](python_ide_tech_plan_v3.md)（现行技术方案）
> 生效边界：**是否立项、何时排期、验收口径以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准**；本文与开发计划冲突时以开发计划为准（架构铁律·文档约定）。

---

## 0. 一页结论

用户从 PyCharm 迁移到 OpenCharm，摩擦**不在"功能缺失"**——运行配置模型（P0-A ~ P2-Q）已基本落地（见 §2）。真正的摩擦有三点：

1. **键位半对齐**：半数默认键已是 PyCharm 同款，但 Run / Debug / 单步仍是 VS Code 风格（`Ctrl+F10` / `F5` / `F10` / `F11` / `Shift+F11`），肌肉记忆频繁踩空；
2. **▶ 不粘住"上次运行的目标"**：`runActive()` 恒取 `app.activeTab.path`（`runFlow.ts:349`），按钮显示的也是当前文件名（`runFlow.ts:260`）——**打开另一个文件，运行对象就悄悄变了**。PyCharm 的语义是"Run 部件 = 选中的运行配置"，运行过一次后即保持，切换文件不改变它（**本稿核心项，见 §3-B**）；
3. **Windows 上"停止"实为硬杀**：P1-J 的软杀序列在 Windows 是 no-op（`util.rs:131-134`），服务类程序无法优雅退出。

本稿给出 5 项改进（A–E）+ 1 份迁移使用指引（§4），全部不触碰架构第一原则（自研组件独立成包/进程，不侵入外壳与静态引擎内核）。

---

## 1. 背景与目标

- **背景**：用户反馈"运行按钮与当前打开的文件关联，与 PyCharm 不同"。经核查，这是 `python_ide_dev_plan_v2.md:80`、`python_ide_tech_plan_v3.md:97` 明确定下的**首版设计**（"以当前文件为运行单元、cwd 锚定文件目录"），并非缺陷。
- **目标**：把 PyCharm 用户的**上手摩擦**降到最低，核心是三处语义对齐：
  - **运行目标粘性化**：▶ 运行并显示**上次运行的目标**（文件或命名配置），切换文件不改变它（§3-B，**本稿最优先项**）；
  - **键位对齐**：提供 PyCharm 键位预设（§3-A）；
  - **停止语义对齐**：Windows 上让长驻服务可优雅退出（§3-D）。
- **与现行计划的关系**：B 项会把"以当前文件为默认运行单元"改为"以上次运行目标为默认运行单元"，**与 `python_ide_dev_plan_v2.md:80` 的首版语义存在冲突**，需在立项时同步修订该计划（见 §6）。
- **非目标**（与 `python_ide_tech_plan_v3.md` §1.2 一致）：远程解释器 / SSH / Dev Container、Docker、Jupyter、数据库工具、pytest 面板、插件市场、协作编辑、AI 助手、Scientific 模式。

---

## 2. 现状复核（纠正调研报告的过时结论）

> **重要**：`pycharm_run_research_report.md` 的 §2.3 / §3 / §4 / §5 把大量能力写成"❌ 未实现 / 🟡 部分"，但**这些能力在当前代码中已经落地**（git 工作树干净）。本稿以代码为准，**不重复提出已完成项**，仅对报告做漂移修正（§3-E）。

| 报告称"未实现" | 报告条目 | 代码实际状态 | 证据 |
|---|---|---|---|
| `Script` / `Module` 二选一（`python -m`） | R-2 / P0-C | ✅ 已实现 | `shell/src-tauri/src/run_env.rs:291-345`（含 `uv run python -m`） |
| 工作目录可配置（含 `${workspaceRoot}` 宏） | R-3 / P0-D | ✅ 已实现 | `run_env.rs:361-372` `resolve_run_cwd` |
| stdin 默认 `null`（`input()` 立即 EOF） | R-4 / P0-A | ✅ 已改 `interactive` | `env_cmds.rs:139-144` `default_stdin_mode` |
| `.env` 文件列表 | R-8 / P1-G | ✅ 已实现 | `env_cmds.rs:234-237`、`run_env.rs:208-236` |
| 命名持久化运行配置 | R-1 / P1-F | ✅ 已实现 | `env_cmds.rs:215-264` `RunProfile`、`runConfigPanel.ts` |
| 多实例 / 询问式冲突 | R-10 / P1-H | ✅ 已实现 | `lsp.rs:350-351`、`runFlow.ts:401-409` |
| 配置级解释器覆盖 | R-12 / P1-I | ✅ 已实现 | `RunProfile.interpreter`（`env_cmds.rs:241-243`） |
| Before launch / Compound | R-13/14 / P1-K | ✅ 已实现 | `runFlow.ts:165-191`、`runFlow.ts:614-656` |
| `Rerun automatically` | R-16 / P2-N | ✅ 已实现 | `RunProfile.auto_rerun`（`env_cmds.rs:256-259`） |
| `Run with Python console` | R-19 / P2-Q | ✅ 已实现 | `run_env.rs:339-341`（解释器前置 `-i`） |
| FastAPI 预设 | R-20 / P0-E | ✅ 已实现 | `runFlow.ts:662-717` |
| EOF 一键补救 | R-5 / P0-B | ✅ 已实现 | `runFlow.ts:68-69`、EOF 补救动作 |
| Stop 先软杀再强杀 | R-11 / P1-J | 🟡 **已实现，但 Windows 下为空操作** | `lsp.rs:717-733` + `util.rs:120-135` |

**结论**：报告 §3–§5 是"改进前"的快照，与实现后的代码已脱节。据此，本稿的机会点收敛为 §3 的 A–E 五项。

---

## 3. 改进项

### A. 键位预设（默认 / PyCharm / VS Code）

**问题**：`keybindings.ts` 的出厂默认已是"PyCharm 风格"（`keybindings.ts:1`），但只对齐了一半——Run / Debug / 单步仍是 VS Code 流；设置里只能**逐个改**，迁移用户需手动改 5~7 个键。

**证据**：

| 项 | PyCharm 默认 | OpenCharm 默认 | 是否一致 |
|---|---|---|---|
| 运行 | `Shift+F10` | `Ctrl+F10` | ❌ |
| 停止运行 | `Ctrl+F2` | `Ctrl+F2` | ✅ |
| 调试 / 继续 | `Shift+F9` | `F5` | ❌ |
| 单步跳过 | `F8` | `F10` | ❌ |
| 单步进入 | `F7` | `F11` | ❌ |
| 单步退出 | `Shift+F8` | `Shift+F11` | ❌ |
| 求值表达式 | `Alt+F8` | `Alt+F8` | ✅ |
| 运行到光标 | `Alt+F9` | `Alt+F9` | ✅ |
| 运行选区 / 行 | `Alt+Shift+E` | `Alt+Shift+E` | ✅ |
| 跳转定义 / Optimize Imports / 最近文件 / 转到文件 / 前进后退 | `Ctrl+B` / `Ctrl+Alt+O` / `Ctrl+E` / `Ctrl+Shift+N` / `Ctrl+Alt+←→` | 同左 | ✅ |

（来源：`keybindings.ts:62-108`）

**方案**：
- 设置 → 快捷键（`settingsPanel.ts:76` 的 `keybindings` 分区）顶部加"**预设方案**"下拉：`默认` / `PyCharm` / `VS Code`；选择后写入 `app.settings.keybindings` map。
- PyCharm 预设映射（仅覆盖上表 ❌ 项）：`run=Shift+F10`、`debug=Shift+F9`、`debug_step_over=F8`、`debug_step_into=F7`、`debug_step_out=Shift+F8`；其余保持出厂值。
- **不得修改 `KEYBINDING_META[].def`**（出厂默认），预设只改用户 map，避免影响存量用户与新装默认。
- 需处理冲突校验：现有 `validateKeybindingMap`（`settingsPanel.ts:347`）会在保存时报错，套用预设时应事先校验并提示。

**验收**：新用户一键套用 PyCharm 预设后，`Shift+F10` / `Shift+F9` / `F8` / `F7` / `Shift+F8` 全部生效；切回"默认"可复原。

**量级 / 风险**：小。注意"出厂默认值三处同步"的约定（`keybindings.ts:9`：`KEYBINDING_META.def` / `state.ts DEFAULT_SETTINGS` / Rust `default_keybindings`），预设功能**不应**触碰这三处。

---

### B. ▶ 运行「上次运行的目标」（粘性运行目标）★ 本稿最优先

**问题**：▶ 的运行对象恒为"当前文件"——`runActive()` 直接取 `app.activeTab.path`（`runFlow.ts:349`），部件显示的 `targetName` 也来自当前文件（`runFlow.ts:260`）。结果是**打开另一个文件，运行对象就悄悄变了**，显示的名字也随之变。

PyCharm 的语义是"**Run 部件 = 选中的运行配置**"：运行过一次后即保持，切换文件不改变它；要换目标须显式操作（右键 Run / gutter ▶ / 改选配置）。

**好消息：状态已具备，缺的是"▶ 不看它"。**

```59:65:shell/src/runFlow.ts
/** 上次运行的路径与通道（「停止并重新运行」用）...
 * P0-C：命名配置运行的路径存为 `profile:<name>`。 */
let lastRun: { path: string; channel: "output" | "terminal" } | null = null;
/** P0-C：最近一次按命名配置运行的名字（restartRun 重跑用） */
let lastProfile: string | null = null;
```

`lastRun` 已支持 `profile:<name>` 伪路径（写入：`runFlow.ts:578-579`；消费：`runFlow.ts:324-326`），目前**只被「停止并重新运行」使用**（`restartRun()`，`runFlow.ts:317-341`）——▶ 完全无视它。

**方案（三项决策已确认）**：

| 决策 | 结论 |
|---|---|
| ▶ 默认行为 | **直接改为粘性**（对齐 PyCharm）：有上次目标时 ▶ 恒跑该目标；**无目标时才回落当前文件**（首次运行 / 新工作区） |
| 哪些操作"重新指定"目标 | ① 右键 → 运行；② gutter ▶（`__main__` 行图标）；③ ▾ 菜单选命名配置 / 命令面板「运行当前文件」。**单纯切换文件不写入目标** |
| 目标失效（文件已删 / 配置已删） | **提示一次 + 提供「改跑当前文件」可点击动作**——不静默换跑（沿用 T11 纪律：绝不静默跑错文件），也不干等着 |

**改动点（3 处 + 1 配套）**：

| # | 位置 | 现状 | 改为 |
|---|---|---|---|
| 1 | `runActive()` `runFlow.ts:346-349` | 取 `activeTab.path` | 先解析"当前运行目标"（`lastRun` / `lastProfile`）；无目标时回落当前文件 |
| 2 | `targetName` `runFlow.ts:260` | 当前文件名 | 目标名 + 来源标识（如 `uvicorn`（配置）/ `main.py`（文件）） |
| 3 | `canRun` `runFlow.ts:242-244` | `hasWs && !!tab && isPy` | 有粘性目标时**不再要求打开 `.py`**——否则 `module=uvicorn` 这类配置在打开 `.md` 时会被灰掉 |
| 4 | 重指定入口 | 各入口直接调 `runActive()` | 入口 ①②③ 先写入 `lastRun` / `lastProfile` 再运行 |

**验收**：
- 跑过 `uvicorn` 配置后，切到任意文件（含非 `.py`），▶ 仍显示并运行 `uvicorn`；
- 右键某 `.py` → 运行后，▶ 目标切到该文件；
- 删掉上次运行的文件后按 ▶ → 给出提示 + 「改跑当前文件」动作，**不静默跑别的文件**；
- 新工作区首次按 ▶ → 回落当前文件（与现状一致）。

**量级 / 风险**：中。需在 `runState.ts` 的单一真值模型（`RunState` 判别联合）中显式引入"当前运行目标"，并与 `runActive` / `runProfile` / `restartRun` 三条路径协调，**禁止出现第二份真值**。

**行为变更提示**：改后"打开新文件想直接跑它"不再能靠 ▶（PyCharm 同样如此），需右键运行 / gutter ▶ / 命令面板。这是与 `python_ide_dev_plan_v2.md:80` 首版语义的**有意识偏离**，立项时需同步修订该计划（见 §6）。

---

### C. 运行 / 调试配置管理器

**问题**：命名配置的读写在后端已完整（`load_profiles` / `save_run_profile` / `delete_run_profile` / `load_profile_by_name`，`env_cmds.rs:333-462`），但前端只有两处入口——`run-config-modal` 内的下拉（`runConfigPanel.ts:73-87`）与 ▾ 菜单的平铺列表（`runWidget.ts:169-181`）。配置一多，管理成本急剧上升。

**方案**：独立"运行配置"管理器面板：
- 左列配置列表 + 搜索框；右侧复用现有字段表单（`runConfigPanel.ts` 的编辑器）；
- 支持**复制 / 重命名 / 删除 / 排序**；
- 支持 **导入 / 导出（JSON）**，便于跨工作区复用；
- Run ▾ 菜单改为只列"最近 / 常用"若干，完整列表进管理器。

**验收**：≥ 20 个配置下可搜索、可复制、可删除；导出再导入往返一致；重命名后 ▾ 菜单与所选配置同步。

**量级 / 风险**：中。改动集中在 `runConfigPanel.ts` + `runWidget.ts`；后端可复用现有命令，新增"重命名 / 排序"需注意配置名唯一性（已有 `unique_profile_name`，`env_cmds.rs:300-309`）。

---

### D. Windows 优雅停止

**问题**：P1-J 已实现"先软杀 → 3s 宽限 → 强杀"（`kill_with_grace`，`lsp.rs:717-733`），但 `soft_kill_pid` 在 **Windows 下是 no-op**（`util.rs:131-134`）。代码注释给了原因：

```120:135:shell/src-tauri/src/util.rs
pub(crate) fn soft_kill_pid(pid: u32) {
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .arg("-INT")
            ...
    }
    #[cfg(windows)]
    {
        let _ = pid; // 见函数注释：Windows 下无安全的跨控制台软杀手段
    }
}
```

→ Windows 用户点"停止"的实际序列 = **空转 3s + `taskkill /T /F`**（`util.rs:145-154`），uvicorn 等服务来不及关连接池 / 落日志。

**相关路径**（需一并评估）：

| 路径 | 停止实现 | 说明 |
|---|---|---|
| 输出面板 | `kill_with_grace`（`lsp.rs:717-733`） | 软杀在 Windows 为 no-op，宽限空转 |
| 运行终端（PTY） | `kill_session` → `child.kill()`（`terminal.rs:45-50`） | 仅杀直接子进程，不保证清进程树 |
| 调试 | `kill_pid_tree` → `taskkill /T /F`（`dap.rs:250-262`） | 硬杀 |

**方案（择一或组合）**：

- **D1（推荐，小–中）**：为"在终端中运行"的 PTY 会话来实现 Ctrl+C 注入（向 ConPTY 写 `\x03`），使服务类配置在终端路径下可优雅退出；同时**在 UI 明确标注**："输出面板运行的『停止』为强制终止，需要优雅退出请用『在终端中运行』"。成本低、与既有 PTY 能力（`terminal.rs:286-294`，真 TTY）天然契合。
- **D2（中–大）**：用 **Windows Job Object** 包装子进程（可携带 `CTRL_BREAK` 语义 / `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`），实现输出面板路径的可控中断。需评估与 `CREATE_NO_WINDOW`、进程树回收的交互，属平台级改造，建议单独立项。

**验收**：`uvicorn --reload` 在终端路径下 Ctrl+C 能打印 shutdown 日志后退出；输出面板路径停止不再"空转 3s"。

**量级 / 风险**：D1 小–中；D2 中–大（涉及 Windows 控制台 / 作业对象模型）。

---

### E. 调研报告漂移修正（文档）

**问题**：`docs/pycharm_run_research_report.md` 的 §2.3 / §3 / §4 / §5 与当前代码已严重脱节（见 §2 对照表），继续引用会导致**重复立项、重复投入**。

**方案**：在报告顶部加"**更新说明（2026-09-13 复核）**"节，或直接修订 §3 / §4 的现状列为"已实现"并标注代码位置；不改动其调研结论与 §6 差异化优势部分。

**验收**：报告结论与代码一致；后续引用不再出现"未实现"的误判。

**量级 / 风险**：小（纯文档）。

---

## 4. PyCharm → OpenCharm 迁移指引（使用，不含代码改动）

> 本节为**用户手册性质**：既服务本稿读者，也可独立作为"迁移指南"分发。

### 4.1 心智模型映射

| | PyCharm | OpenCharm（现状） |
|---|---|---|
| 运行单元 | **Run Configuration**：Run 部件 = 选中的配置，运行过一次后**保持粘性**，切换文件不改变 | 现状：默认 ▶ = 当前文件（切换文件即改变）；配置模型已存在，入口在 ▾ 菜单。B 项落地后改为粘性（见 §3-B） |
| 入口 | `Script path` / `Module name` 二选一 | 同样二选一（在命名配置里） |
| 工作目录 | 可配（`$PROJECT_DIR$` 宏） | 命名配置可配（支持 `${workspaceRoot}` 宏） |
| 临时配置 | 由 ▶ / 右键 Run 自动生成的临时配置 | ✅ 等价物 = 配置面板的「当前文件」视角（`env_cmds.rs:376-388`） |

**一句话**：OpenCharm **不缺配置模型**——把常用入口建成命名配置并运行一次，▶ 就会**粘住它**；要换目标就右键运行 / gutter ▶ / ▾ 选配置，而不是靠切换文件。

### 4.2 快捷键：现状与建议

出厂默认即"PyCharm 风格"，但只对齐一半（详见 §3-A 表）。迁移用户建议：

- 短期：在 设置 → 快捷键 手动把 `运行 / 调试 / 单步三件套` 改回 PyCharm 键位；
- 长期：等 §3-A 的**预设方案**落地后一键套用。

### 4.3 操作映射表

| 你想做的（PyCharm） | OpenCharm 怎么做 |
|---|---|
| `Shift+F10` 重跑"选中的配置" | ▶ 或 `Ctrl+F10`（B 项落地后 = **上一次运行的目标**；可改键，见 §3-A） |
| 跑"刚打开的这个文件" | 右键 → 运行 / gutter ▶ / 命令面板「运行当前文件」（**不是** ▶） |
| 选一个配置来跑 | **▾ 菜单的前几项**：「运行 <配置名>」（`runWidget.ts:169-181`） |
| Edit Configurations | ▾ → **运行配置…**（`runConfigPanel.ts`） |
| 开服务 / 热重载 | 命名配置 `module=uvicorn` + FastAPI 预设（`runFlow.ts:662-717`），或 **「在终端中运行」**（真 TTY） |
| 有 `input()` 的脚本 | ✅ 已默认交互模式（`env_cmds.rs:139-144`），无需改配置 |
| 只跑一段代码 | 选中 → `Alt+Shift+E`（`runSelection`，落到输出面板） |
| 看上次运行结果 | **运行历史**（`run_history`，默认 `Ctrl+Shift+R`） |
| 断点 | 行号区（gutter）点击；`__main__` 行会直接给 ▶ 图标（`runGutter.ts`） |
| traceback 跳转 | 输出面板点 `File "…", line N` 直接跳（**强于 PyCharm**） |

### 4.4 避雷清单（当前确切差异）

1. **Stop 在 Windows 是硬杀**（见 §3-D）——服务类建议用「在终端中运行」并以 `Ctrl+C` 退出。
2. **解释器默认是工作区级**单一值；配置里可覆盖（`RunProfile.interpreter`），但不像 PyCharm 那样每个配置随意切 venv。
3. **无"活标签页 / Pin / 重跑"**（报告 R-9 / P2-M 待办）；多配置并行靠 **「并行运行配置…」（Compound）**。
4. **cwd 默认锚定脚本所在目录**（而非项目根）——这是"只能跑单文件"观感的来源，命名配置里显式填 cwd 即可解决。
5. **▶ 会灰掉非 `.py` 文件**（`runFlow.ts:242-252`），属现状；B 项落地后，只要存在粘性目标（含 `module` 配置）即不再受此限制。

---

## 5. 建议落地顺序与验收

| 步骤 | 内容 | 量级 | 达成标志 |
|---|---|---|---|
| 1 | **E** 报告漂移修正 | 小 | 报告与代码一致，不再误判 |
| 2 | **A** 键位预设 | 小 | 一键切 PyCharm 键位 |
| 3 | **B** ▶ 运行"上次运行的目标"（粘性）★ | 中 | 切换文件不改变运行对象；无目标时回落当前文件；失效时提示 + 可点击补救 |
| 4 | **D1** Windows 终端优雅停止 | 小–中 | 服务可 Ctrl+C 优雅退出 |
| 5 | **C** 运行配置管理器 | 中 | 多配置可搜索 / 复制 / 导出 |
| 6 | **D2** Job Object 软杀（可选） | 中–大 | 输出面板路径也可软杀 |

> 全部不触碰架构第一原则；改动集中在 `keybindings.ts` / `settingsPanel.ts`（A）、`runFlow.ts` + `runState.ts`（B）、`runConfigPanel.ts` + `runWidget.ts`（C）、`util.rs` + `terminal.rs` + `lsp.rs`（D）。

---

## 6. 明确不做 / 待裁决

**不做（除非另行立项）**：远程解释器 / Docker / Jupyter（非目标）；报告 §5 的 P2 项——URL 识别可点（P2-L）、控制台细节（P2-O）、`Run anything`（P2-P）、`Interpreter options`——本稿不纳入。

**待裁决**：

1. **B 已定：改变 ▶ 默认语义（粘性运行目标）** → 需同步修订 `python_ide_dev_plan_v2.md:80` 的"以当前文件为运行单元"表述，二者不得长期冲突（架构铁律·文档约定：以开发计划为准）。
2. **PyCharm 预设中 `debug_stop` 如何处理**？PyCharm 用同一个 `Ctrl+F2` 停止运行 / 调试，而 OpenCharm 是 `stop`（`Ctrl+F2`）与 `debug_stop`（`Shift+F5`）两条命令。需决定：保持 `Shift+F5`，还是统一 `Ctrl+F2` 并由运行时态路由（`runWidgetState` 在调试中已把 ⏹ 路由到 `debug_stop`，`runFlow.ts:245-248`）。
3. **D 走 D1 还是 D2**？（建议先落 D1，D2 视收益另立。）

---

## 附录 A · 证据索引

| 主题 | 路径:行号 |
|---|---|
| ▶ 绑定当前文件 | `shell/src/runFlow.ts:346-349` |
| 上次运行目标 `lastRun` / `lastProfile` | `shell/src/runFlow.ts:59-65`（写入 `runFlow.ts:366,450,578-579`） |
| `restartRun` 已按 `lastRun` 重跑 | `shell/src/runFlow.ts:317-341` |
| 部件显示名取自当前文件 | `shell/src/runFlow.ts:260` |
| 可运行性判定 | `shell/src/runFlow.ts:240-268` |
| 运行前读配置 | `shell/src/runFlow.ts:122-125` |
| 后端 `run_script` | `shell/src-tauri/src/lsp.rs:316-389` |
| 按配置运行 `run_profile` | `shell/src-tauri/src/lsp.rs:566-609` |
| 软杀序列 | `shell/src-tauri/src/lsp.rs:696-733` |
| `soft_kill_pid`（Windows no-op） | `shell/src-tauri/src/util.rs:113-135` |
| 强杀进程树 | `shell/src-tauri/src/util.rs:137-161` |
| PTY 会话终止 | `shell/src-tauri/src/terminal.rs:43-50` |
| 调试进程树终止 | `shell/src-tauri/src/dap.rs:250-262` |
| `run` 命令装配（含 `-m`） | `shell/src-tauri/src/run_env.rs:291-345` |
| cwd 解析（含宏） | `shell/src-tauri/src/run_env.rs:361-372` |
| `RunProfile` 结构 | `shell/src-tauri/src/env_cmds.rs:215-264` |
| stdin 默认 interactive | `shell/src-tauri/src/env_cmds.rs:139-144` |
| 「当前文件」配置匹配 | `shell/src-tauri/src/env_cmds.rs:376-388` |
| 命名配置 CRUD | `shell/src-tauri/src/env_cmds.rs:333-462` |
| 键位出厂默认 | `shell/src/keybindings.ts:62-108` |
| 键位"三处同步"约定 | `shell/src/keybindings.ts:9` |
| 设置·快捷键分区 | `shell/src/settingsPanel.ts:76,193-214,346-347` |
| ▾ 菜单配置区 | `shell/src/runWidget.ts:156-205` |
| 配置面板（两种视角） | `shell/src/runConfigPanel.ts:1-5,72-121` |
| 运行状态单一真值 | `shell/src/runState.ts:26-88` |
| 报告"以当前文件为运行单元" | `docs/pycharm_run_research_report.md:13-16` |
