# OpenCharm 运行功能交互设计

> 版本：v3.3 · 日期：2026-09-14 · 状态：现行方案（运行功能唯一权威交互口径）
> 取代：v2.0（配置列表 + 粘性目标 + 输出面板输入框模型，已偏离产品预期）；v3.2 基础上新增 **§7 生命周期、状态机与界面交互**（根治「关掉终端再重跑没地方输出」一类状态/会话不同步问题）。
> 上游：`python_ide_tech_plan_v3.md`、`python_ide_dev_plan_v2.md`；调试见 `python_debug_dev_plan.md`。
> 约定：本文与开发计划冲突时以开发计划为准（架构铁律·文档约定）。

---

## 0. 一页结论

运行功能收敛为**两种运行 + 一个统一控制台**：

| 运行类型 | 运行对象 | 默认等价命令 | 学习来源 |
|---|---|---|---|
| **运行脚本** | 当前打开的 `.py` 文件 | `<解释器> <file> <args>` | VS Code 的「Run Python File」 |
| **运行项目** | 项目入口（模块名 或 入口脚本） | `<解释器> -m <module> <args>` 或 `<解释器> <入口> <args>` | PyCharm 的 `Module name` / 运行配置 |

两种运行**各自可配置**，共用**同一个基于 xterm/PTY 的统一运行控制台**：输出与输入同屏、无独立输入框、traceback 可点击跳转、**probe 运行时采样注入**（差异化核心，必须保留，见 §5.4）。

**tab 分配**：按「运行实例」而非「运行类型」——同一目标重复运行复用其 tab（先停旧的），需要并行时多开一个 tab（§6.3）。

**生命周期铁律**：**运行实例与其 tab 同生共死**——实例存在 ⇒ tab 存在；tab 被关闭 ⇒ 实例必须终止并复位（§7.1）。这条不变式根治「关掉终端再运行没地方输出」。

---

## 1. 核心心智模型

```
┌──────────────────────────────────────────────────────────────┐
│  菜单栏运行组：[ ▶ 运行脚本 ] [ ▶ 运行项目 ] [ ⏹ 停止 ] [ ⚙ 配置 ]  │
└──────────────────────────────────────────────────────────────┘
              │                              │
    ┌─────────┴──────────┐        ┌──────────┴───────────┐
    │ 脚本配置（每文件）   │        │ 项目配置（每项目）     │
    │ args/cwd/env/env_files │    │ entry/args/cwd/env/... │
    └─────────┬──────────┘        └──────────┬───────────┘
              └──────────────┬───────────────┘
                             ▼
        ┌────────────────────────────────────────────┐
        │         统一运行控制台（xterm / PTY）        │
        │  ┌────────────────┐  ┌──────────────────┐  │
        │  │「运行」tab      │  │「项目」/「项目 2」│  │
        │  │ 脚本（复用）    │  │ 项目（复用·并行） │  │
        │  └────────────────┘  └──────────────────┘  │
        │  输出+输入同屏 · traceback 可点 · probe 注入  │
        └────────────────────────────────────────────┘
```

四条原则：

1. **两种运行，各司其职**：脚本运行是「随手跑这个文件」；项目运行是「把整个项目跑起来」。
2. **都落在同一个控制台**：输出/输入/停止都在控制台内，没有第二套界面。
3. **tab 按「运行实例」分配**（对齐 VS Code / PyCharm 的共同点，见 §6.3）：同一目标重复运行 → 复用该目标的 tab（先停旧的）；要并行 → 多开一个 tab。**不按运行类型固化 tab 数量。**
4. **差异化不丢**：probe 采样、traceback 跳转、运行前依赖预检、项目入口自动探测——相对 PyCharm/VS Code 的特色，保留。

---

## 2. 运行类型一：运行脚本

- **对象**：当前活动标签页的 `.py` / `.pyw` 文件。
- **命令**：`<解释器> <文件绝对路径> <args>`；未选解释器时 `uv run <文件名> <args>`。
- **默认 cwd**：脚本所在目录（单脚本直觉）。
- **触发**：菜单栏 `▶ 运行脚本`、`Ctrl+F10`、gutter ▶（`__main__` 行）、标签/文件树右键 →「运行脚本」、命令面板。
- **语义**：**总是跑「当前文件」**，不粘上一次、不随历史漂移——切换文件，▶ 就换成新文件（VS Code 同款直觉）。

---

## 3. 运行类型二：运行项目

- **对象**：项目入口（二选一）：
  - **模块名**（`Module name`）：`python -m <module>`，用于 FastAPI（`uvicorn`）、Django、包入口；
  - **入口脚本**（`Script path`）：`python <入口脚本>`，用于「主程序就是某个脚本」的项目。
- **默认 cwd**：项目根（`${workspaceRoot}`）。
- **触发**：菜单栏 `▶ 运行项目`、`Ctrl+Shift+F10`、命令面板。
- **入口来源**：首次运行项目时自动探测（§9）→ 命中即**写入项目配置**（用户可改）；探测不到则提示先配置。
- **例子**：
  - FastAPI：`module=uvicorn`、`args=main:app --reload`、`cwd=${workspaceRoot}`
  - Django：`script=manage.py`、`args=runserver`
  - 普通包：`module=myapp`（有 `__main__.py`）

---

## 4. 配置模型

### 4.1 两种配置

| 配置 | 粒度 | 存储键 | 缺省行为 |
|---|---|---|---|
| **脚本配置** | 每文件一份（可选） | 脚本相对工作区根路径（正斜杠，沿用 `run_config_key`） | 无配置 → 默认 `python <file>` |
| **项目配置** | 每项目一份 | 工作区配置固定键 `project_run` | 无配置 → 自动探测（§9），探测不到提示配置 |

### 4.2 字段

| 字段 | 脚本配置 | 项目配置 | 说明 |
|---|---|---|---|
| `entry` | —（恒为文件本身） | `module` \| `script` + 目标 | 项目入口二选一 |
| `args` | ✅ | ✅ | 参数，shell-words 拆分（支持引号/转义） |
| `cwd` | ✅（默认脚本目录） | ✅（默认项目根） | 支持 `${workspaceRoot}` / `$PROJECT_DIR$` 宏 |
| `env` | ✅ | ✅ | 自定义环境变量 |
| `env_files` | ✅ | ✅ | 有序 `.env` 文件列表（相对工作区根） |
| `interpreter` | ✅ | ✅ | 覆盖工作区解释器；空 = 沿用（工作区配置 > `.venv` 检测 > `uv run` 兜底） |

> 相较 v2 删除：`stdin`（三档，输入天然来自控制台）、`allow_multiple`（并行走运行时选择，§6.4）、`name`（脚本以路径为键）、`temporary`、`pre_run_profile`、`auto_rerun`、`python_console`（§18 裁决 3）；`open_browser_url` 折叠进 FastAPI 预设默认（§9），不做通用字段。

### 4.3 旧数据迁移（`run_profiles` → 新模型）

现有工作区配置存的是 `run_profiles` 数组。迁移规则（读取时一次性转换，写回新格式）：

| 旧条目 | 处置 |
|---|---|
| `entry.kind == "script"` | 天然即「每文件脚本配置」→ 按 `entry.target`（相对路径）为键**保留** |
| `entry.kind == "module"` 的**第一份** | 转为**项目配置**（`project_run`） |
| 其余 module 条目 | 丢弃（v3 项目配置只有一份） |
| `name` / `temporary` | 丢弃（v3 无命名/临时概念） |
| 其它已删字段（`stdin`/`allow_multiple`/…） | 丢弃；`.catch` 兼容，读不到即缺省 |

> 迁移失败绝不阻断运行——读不到就按缺省（脚本=默认命令，项目=触发探测）。

---

## 5. 运行装配规则（命令 / cwd / 环境变量 / probe）

**这是两条运行路径的唯一装配口径**，改动前必读（现状固化在 `run_env.rs::assemble`，有多项单测锁定顺序）。

### 5.1 命令解析（`resolve_run_command`）

```text
script  → <解释器> <脚本绝对路径> <args>      或  uv run <文件名> <args>
module  → <解释器> -m <模块> <args>           或  uv run python -m <模块> <args>
```

### 5.2 工作目录（`resolve_run_cwd`）

| 配置 | 脚本运行 | 项目运行 |
|---|---|---|
| 空 | 脚本所在目录 | 工作区根 |
| 显式 | 宏展开（`${workspaceRoot}` / `$PROJECT_DIR$`）；相对路径以工作区根为基准；绝对路径原样 |

### 5.3 环境变量注入顺序（**顺序即优先级**，后写覆盖先写）

```text
① 默认注入      PYTHONIOENCODING=utf-8 · PYTHONUTF8=1 · PYTHONUNBUFFERED=1
② PYTHONPATH 四段合并（分隔符 Windows `;` / Unix `:`）
   ① 用户配置 PYTHONPATH → ② .env 的 PYTHONPATH → ③ 继承的 PYTHONPATH → ④ 工作区根 → ⑤ probe src
③ .env 文件键值（有序，靠前文件优先；注入在默认值之后、用户 env 之前）
④ 用户自定义 env（覆盖 ①②③）
⑤ probe 三件套（仅 probe 开启时）
   OPENCHARM_PROBE_AUTOSTART=1 · OPENCHARM_PROBE_SCRIPT · OPENCHARM_PROBE_HOME
```

> ④ 工作区根进 PYTHONPATH 是为了对齐依赖预检（`check_missing_imports` 也把 root 塞进 `sys.path`），消除「预检通过但运行 ModuleNotFoundError」的双标。
> ⑤ probe src 置末：保证用户同名模块优先命中，不被探针遮蔽。

### 5.4 probe 采样（**差异化核心，必须在运行路径开启**）

- probe 通过 **PYTHONPATH 注入 `probe/src`（含 `sitecustomize.py`）+ 三个环境变量**启用，采集结果落**独立 SQLite trace 库**，不写 stdout —— 因此**与 PTY 正交**，控制台运行同样可采集。
- ⚠️ **现状 `run_in_terminal` 硬编码 `probe=false`**。v3 后所有运行都走 PTY，**若不开 probe，运行时采样（→ 运行时补全/跳转）整条差异化链路就断了**，故必须开启（受全局 `probe_enabled` 开关控制）。
- 首版需实测确认（§19）：PTY 下 probe 不污染 stdout、开销仍 < 1.5x。

---

## 6. 统一运行控制台

### 6.1 为什么是终端控制台（xterm / PTY）

| 诉求 | 终端控制台 | 旧 DOM 输出面板 + 输入框 |
|---|---|---|
| 输出与输入同屏 | ✅ 提示符后原地打字回车，无独立输入框 | ❌ 输入框与输出分离，割裂 |
| `input()` 体验 | ✅ PyCharm「Emulate terminal」效果 | ❌ 需额外输入行 + 「等待输入…」状态 |
| `getpass` / `tqdm` / 彩色 / `\r` 进度条 | ✅ 真 TTY 全可用 | ❌ 管道下全退化 |
| `Ctrl+C` 优雅退出 | ✅ 写 `\x03` | ❌ 无 |
| traceback 点击跳转 | ✅ xterm link provider | ✅ 正则 |
| probe 采样 | ✅ 见 §5.4 | ✅ |

### 6.2 控制台行为

- **回显行**写在输出之前，运行前明确「这次用哪套环境跑」：
  - 脚本：`> [venv] python main.py --flag`
  - 项目：`> [venv] python -m uvicorn main:app --reload  (cwd: <项目根>)`
- **输入**：程序 `input()` 时提示符直接显示在控制台，光标跟随，原地输入 + 回车，输入以区分色回显（xterm 处理）——**无任何独立输入框**。
- **traceback**：`File "...", line N` 渲染为可点链接，点击跳转（xterm link provider）。
- **非致命告警**（如参数 shell-words 解析失败）写入控制台，不中断运行。

### 6.3 Tab 语义与生命周期

**核心原则：tab 按「运行实例」分配，不按「运行类型」固化**（对齐 VS Code / PyCharm 共同点）。

| Tab | 归属 | 复用规则 | 结束后 |
|---|---|---|---|
| 「运行」tab | 脚本运行 | **唯一**，重复运行复用（覆盖输出） | 保留，供阅读与点 traceback |
| 「项目」tab | 项目运行 | 默认**复用**（先停旧的）；选「新建实例」时多开「项目 2」「项目 3」… | 保留，长驻服务持续输出 |

- **脚本与项目可同时进行**（各占自己的 tab）。
- **同目标的多个项目实例也可并行**（「项目」/「项目 2」/…），各自独立输出与停止。
- **多实例不加配置项**：不引入 `allow_multiple` 开关；并行的口子是运行时的「新建实例（并行）」选择（§6.4）——把 PyCharm 的配置开关降级为**运行时选择**，普通用户零配置负担（§18 裁决 2）。
- **脚本运行不提供并行实例**：脚本是「随手跑」，目标随切换文件变化，每实例一 tab 会 tab 爆炸；确需并行就开普通终端手敲（终端能力已覆盖）。

### 6.4 重复运行行为

| 场景 | 行为 |
|---|---|
| 脚本运行中再点「运行脚本」 | **直接终止上一次并重跑**（复用 tab = 覆盖语义），不弹框 |
| 项目运行中再点「运行项目」 | **弹二选一**：「**停止并重跑**」/「**新建实例（并行）**」——默认复用，需要并行（如两个端口的 uvicorn）时选后者，多开一个「项目 N」tab |
| 已停止后再点 | 直接重跑（脚本覆盖「运行」tab，项目复用「项目」tab） |

### 6.5 被移除的旧机制

- `run-stdin-row` / `run-stdin-input`（独立输入框）——删除。
- `RunTranscript` 的「半行累积 + 等待输入状态」——删除（PTY 天然处理提示符）。
- `run_stdin` 命令、`StdinConfig` 三档模式——删除。
- 「在终端中运行」独立入口——取消（运行本就落在终端控制台）。
- 控制台上方的运行 chip 标签条——删除（与「运行 tab 复用」重复，减法；历史走 §11 列表）。

---

## 7. 生命周期、状态机与界面交互

> 本章是「不出现奇怪问题」的总纲：定义运行实例的完整生命周期、每个状态下界面长什么样，以及全部边界场景的处置。

### 7.1 两个维度与核心不变式

运行功能的状态由**两个维度**组成，必须分开表达、同步维护：

| 维度 | 取值 | 含义 |
|---|---|---|
| **运行实例状态**（业务） | `idle` / `preparing` / `running` / `exited`（含 stopped） | 进程与准备流程的进展 |
| **tab 状态**（UI 会话） | `attached`（有承载 tab） / `detached`（tab 已关闭） | 输出落点是否存在 |

> #### 🔒 核心不变式（必须始终成立）
>
> **运行实例存在 ⇒ 其 tab 存在；tab 被关闭 ⇒ 该实例必须被终止并复位。**
>
> 违反它的两个后果，正是历史 bug 的来源：
> - tab 被关但进程还在跑 → 孤儿进程 + 下次运行冲突；
> - 实例在跑但 tab 没了 → 输出没有落点（「关掉终端再点重新运行，就没地方输出」）。
>
> 落地要求：**启动实例前必须确保 tab 存在（无则重建）**；**关闭 tab 必须先终止进程**。

### 7.2 状态机

```
   [idle] ──启动──▶ [preparing] ──spawn 成功──▶ [running] ──进程退出──▶ [exited]
                        │                          │                       │
              失败/取消/预检中止                  用户停止                    │
                        │                          ▼                       │
                        └──────────▶ [idle] ◀── [stopped]                  │
                                                                           │
                                        再运行（无 tab 则重建） ─────────────┘

   正交事件（任意状态都可能发生）：
     · 关闭运行 tab      → running/stopped：先终止进程再移除 tab（不变式）
     · 切换/关闭工作区   → 全部实例终止 + 清 tab + 复位
     · 应用退出         → 同步终止全部进程
```

### 7.3 状态 × 界面矩阵

| 状态 | ▶ 运行脚本 | ▶ 运行项目 | ⏹ 停止 | 运行 tab | 菜单启动类 |
|---|---|---|---|---|---|
| **idle** | 可用「运行 <文件名>」 | 可用「运行项目（<入口>）」 | 置灰「没有正在运行」 | 保留上次输出可回看 | 全部可用 |
| **preparing** | 置灰 + spinner「正在准备运行…」 | 置灰 + spinner | 置灰 | 创建中 / 复用中 | 启动类禁用 |
| **running（脚本）** | 置灰「已有脚本在运行」 | **可用**（可并行跑项目） | 可用「停止运行」 | 「运行」tab 活跃 + 停止按钮 | 停止可用、启动禁用 |
| **running（项目）** | 可用 | 置灰 or 触发二选一（§6.4） | 可用 | 「项目」tab 活跃 | 同上 |
| **running（多实例）** | 可用 | 二选一 | 可用（停**最近启动**的） | 各 tab 独立活跃 | 各 tab 独立停止 |
| **exited / stopped** | 恢复可用 | 恢复可用 | 置灰 | tab 保留，标题带退出码 | 恢复全部 |

### 7.4 边界场景处置表

按生命周期阶段枚举。**「状态变化」列即不变式的执行结果**。

#### 启动前

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 未打开工作区 | 不进 `preparing` | 按钮置灰，tooltip「未打开工作区」 |
| 当前文件非 `.py`/`.pyw` | 不进 `preparing` | 「运行脚本」置灰，tooltip「当前文件不是 Python 文件」 |
| 项目未配置入口且探测不到 | `preparing` → `idle` | 提示「请先配置项目入口」并打开配置面板（**不静默失败**） |
| 依赖预检缺失，用户点「取消」 | `preparing` → `idle` | 中止，按钮恢复可用，**绝不卡在 preparing** |
| 自动保存失败 | `preparing` → `idle` | 提示并中止（绝不跑磁盘旧内容） |
| 连点运行 | 闸门拦截（不重复进入） | ▶ 显示 spinner，重复点击无效 |
| 调试进行中 | 拒绝启动 | 提示「调试进行中，请先停止调试」 |
| 解释器失效 / spawn 失败 | `preparing` → `idle` | 控制台写错误原因，按钮恢复，**不留僵尸运行态** |

#### 运行中

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 进程崩溃 / 非零退出 | `running` → `exited` | tab 保留输出 + 退出码，按钮恢复；**不弹错误框**（输出即为证据） |
| **用户关闭运行 tab（进程在跑）** | `running` → `stopped`，**先终止进程再移除 tab** | tab 消失，运行态复位，按钮恢复。**不留孤儿进程** |
| 用户关闭运行 tab（已结束） | `exited` → `idle`（仅清 tab） | tab 消失，无副作用 |
| 切换 / 关闭工作区 | 全部实例 → `stopped` | 终止所有进程 + 清 tab + 清历史 |
| 应用退出 | 全部终止 | 同步 kill 进程树 |
| 面板折叠 / resize | 状态不变 | 不影响运行；展开时 fit |
| 目标文件被删后**再次运行** | `preparing` 阶段失败 → `idle` | 提示「文件不存在」，不进 `running`（已在跑的不受影响） |

#### 停止

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 正常停止 | `running` → `stopped` | Ctrl+C → 强杀；tab 保留，按钮恢复 |
| 停止已结束的实例 | **幂等无操作** | 不报错、不改状态 |
| 多实例时点 ⏹ | 停**最近启动**的那个 | tooltip 显示停的是哪个；其余 tab 不受影响 |
| 停止后立刻再运行 | `stopped` → `preparing` | 正常重跑（复用 tab） |

#### 再运行 / 结束后

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 再运行，tab **存在** | `exited` → `preparing` → `running` | 复用该 tab，先终止旧进程再重跑 |
| **再运行，tab 已被关闭** | `idle` → `preparing` → **自动重建 tab** → `running` | **必须重建 tab**——根治「没地方输出」 |
| 脚本运行中再运行脚本 | `running` → `stopped` → `running` | 直接终止旧的重跑（不弹框） |
| 项目运行中再运行项目 | 二选一（§6.4） | 「停止并重跑」/「新建实例（并行）」 |

#### 其它

| 场景 | 处理 |
|---|---|
| 输出超长 | 历史采集上限 3000 行（保留尾部）；控制台由 xterm 滚动缓冲承载 |
| 运行中回看历史 | 实时输出继续写入 tab，历史列表不受影响 |
| 运行中修改配置 | 本次运行不受影响，下次生效 |
| 端口被占用（服务类） | 进程自行报错，输出进控制台；IDE 不介入 |

### 7.5 防「奇怪问题」的三条硬规则

1. **实例与 tab 同生共死**（§7.1 不变式）：启动前确保有 tab（无则建）；关闭 tab 前先终止进程。
2. **准备期必定复位**：`preparing` 的所有出口（成功 / 失败 / 取消）都必须落到确定态（`running` 或 `idle`），**绝不卡住**。
3. **停止与关闭幂等**：对已结束 / 已停止的实例再调用停止或关闭 = 无操作，不报错、不改状态。

---

## 8. 工具栏、菜单与快捷键

```
[ ▶ 运行脚本 ]  [ ▶ 运行项目 ]  [ ⏹ 停止 ]  [ ⚙ 运行配置… ]
```

| 控件 | 行为 | tooltip |
|---|---|---|
| `▶ 运行脚本` | 运行当前文件（状态见 §7.3） | `运行 <文件名>` |
| `▶ 运行项目` | 运行项目入口（运行中则弹二选一，§6.4） | `运行项目（<入口>）` / 未配置时 `运行项目（未配置入口）` |
| `⏹ 停止` | 停止**最近启动且仍在运行**的实例；调试中路由到停止调试 | `停止运行（<目标>）` |
| `⚙ 运行配置…` | 打开配置面板，**内含两个分区**：「脚本配置（当前文件）」与「项目配置」 | — |

### 快捷键

| 动作 | 键位 | 说明 |
|---|---|---|
| 运行脚本 | `Ctrl+F10` | 保留现状 |
| 运行项目 | `Ctrl+Shift+F10` | 新增动作 |
| 停止 | `Ctrl+F2` | 保留现状 |
| 运行选区 / 行 | `Alt+Shift+E` | 保留 |

### 其它入口

| 入口 | 动作 |
|---|---|
| gutter ▶（`__main__` 行） | 运行脚本（该文件） |
| gutter ▶ 右键 | 「运行脚本 / 运行项目 / 运行配置…」 |
| 标签右键（`.py`） | 运行脚本 / 运行项目 / 运行配置… |
| 文件树右键（`.py`） | 运行脚本（可选，顺带补上） |
| 命令面板 | 「运行脚本」「运行项目」「停止运行」「运行配置…」 |

---

## 9. 项目入口自动探测（特色）

首次运行项目时按优先级探测，命中即**写入项目配置**（用户可后续修改），不命中则提示显式配置：

1. `pyproject.toml` 的 `[project.scripts]` / `[tool.uv]` 入口声明；
2. 依赖声明含 `fastapi` 且源码有 `app = FastAPI()` → 预设 `uvicorn <module>:<app> --reload`，**起服务后自动用系统浏览器打开服务 URL**（正反馈；每项目每会话提示一次）；
3. 根目录存在 `main.py` → 入口脚本 `main.py`；
4. 存在含 `__main__.py` 的包 → `python -m <pkg>`；
5. 都没有 → 提示「请先配置项目入口」。

---

## 10. 停止语义

| 场景 | 行为 |
|---|---|
| 脚本 / 项目运行（控制台内） | 先向 PTY 写 `\x03`（Ctrl+C，长驻服务优雅退出）→ 1.2s 宽限 → `term_kill` 强杀 |
| 各运行 tab | tab 上有独立停止按钮，可分别停止（并行的「项目」「项目 2」各自独立） |
| ⏹（工具栏） | 停止最近启动且仍在运行的实例；都停了则置灰 |
| **关闭运行 tab** | **等价于「停止 + 关闭」**：先终止进程再移除 tab（§7.1 不变式） |

> 脚本运行、项目各实例各自独立停止，互不影响。停止/关闭均幂等（§7.5）。

---

## 11. 运行历史与留档

脚本 tab 复用意味着**每次运行覆盖上一次输出**，因此历史必须靠快照采集：

- **采集**：输出在写入控制台的同时，按行采集进运行历史（**需剥离 ANSI 转义序列**，否则快照里是乱码）。
- **记录内容**：目标（脚本路径 或 项目标记）、启动时间、退出码、行数、时长。
- **上限**：20 次（Pin 豁免淘汰）/ 单次 3000 行（超限保留尾部，报错总在最后）。
- **`Ctrl+Shift+R`** 打开运行历史列表：回看快照、Pin（豁免淘汰）、**保存输出到文件**（对标 PyCharm Save console output to file）、删除。
- 退出码：PTY 会话退出时需带出 code（现状 `term-exit` 事件不带 code，需扩展，见 §17）。

---

## 12. 运行态与互斥

v3 已无「输出面板运行 vs 运行终端」双通道，互斥语义重新表述（生命周期状态见 §7）：

| 关系 | 规则 |
|---|---|
| 运行（脚本 tab）↔ 运行（项目 tab） | **不互斥**，可同时进行 |
| 项目实例 ↔ 项目实例（并行） | **不互斥**（「项目」/「项目 2」可并行） |
| 运行 ↔ 调试 | **互斥**：调试中拒绝运行；运行中拒绝启动调试 |
| 运行 ↔ 普通 shell 终端 tab | **不互斥**（shell 会话随便开） |
| 脚本运行中再次运行脚本 | 终止旧的重跑（§6.4） |
| 项目运行中再次运行项目 | 二选一：停止并重跑 / 新建实例（§6.4） |

> 因此运行态模型须支持**多个并发运行实例**（脚本 + N 个项目实例），见 §17 第 4 条。

---

## 13. 与调试的关系

- 调试复用**脚本配置**（调试当前文件，同键 `read_run_config` 读取）；项目配置与调试无关（调试不调试「项目入口」）。
- 运行 ↔ 调试互斥（§12）。
- 运行组 `⏹` 在调试态下路由到停止调试。

---

## 14. 前置校验与边界

| 场景 | 行为 |
|---|---|
| 未打开工作区 | 运行按钮置灰，tooltip 提示「未打开工作区」 |
| 当前文件非 `.py`/`.pyw` | 「运行脚本」置灰，tooltip「当前文件不是 Python 文件」 |
| 运行前自动保存 | 保存**本次运行目标所在的 tab**（不是活动 tab，避免跑到磁盘旧内容） |
| 依赖预检（脚本运行 / 项目 script 入口） | `check_missing_imports` 缺失 → **弹确认框**「以下导入未找到…仍要运行？」（强提醒，保留）；无解释器时跳过预检 |
| 依赖预检（项目 module 入口） | **不做**（依赖即模块自身，交给运行时暴露） |
| `.env` 文件缺失 | 仅告警写入控制台，不中断运行 |
| 参数解析失败（shell-words） | 忽略参数 + 告警，不中断运行 |

> 完整生命周期边界见 §7.4。

---

## 15. 工作区切换与清理

切换 / 关闭工作区时：停止运行中的全部实例（脚本 + 所有项目实例）→ 关闭运行 tab → 清空配置缓存 → 重置运行历史。应用退出时同步终止全部运行进程。

---

## 16. 差异化保留（不以对标之名删减）

1. **probe 运行时采样注入**（§5.4）——三层补全/跳转的数据底座，运行路径必须开启。
2. **traceback 点击跳转**——控制台内可点。
3. **运行前依赖预检**（§14）——提前拦「补全可用但运行 ImportError」。
4. **项目入口自动探测**（§9）——PyCharm 专业版才有的一键起服务，我们做轻量探测。
5. **选区 / 行运行**——写临时文件后按「运行脚本」方式在控制台执行，结束后清理临时文件；`probe=false`（片段不采样）；不改变运行目标。
6. **运行时选择并行**（§6.4）——PyCharm 需要勾配置开关的能力，我们降级为一次点击，零配置负担。

---

## 17. 迁移清单（细化到文件 / 命令）

> 落地顺序即下列顺序，除标注「新增」外均为减法/改造。

### 前端

1. **删粘性目标**：`runState.ts` 移除 `RunTarget` / `RunTargetRecord` / `displayTargetName`；`runFlow.ts` 移除 `runTarget` / `lastRun` / `lastProfile` / `assignRunTarget` / `setRunTarget` / `loadPersistedRunTarget` / `restartRun` / `reportStaleTarget` / `runStickyTarget` / `runStickyTargetInTerminal`；新增 `runScript()` / `runProject()`。
2. **删配置列表下拉**：`runWidget.ts` 的 ▾ 目标区 → 换成「运行脚本 / 运行项目 / 停止 / 配置」；`RunWidgetState` 去掉 `profiles` / `currentTarget` / `unsavedFileTarget` / `targetName`。
3. **删输入框与 stdin**：移除 `run-stdin-row` / `run-stdin-input` / `run-stdin-status`（`index.html` + `runFlow.ts` 的 `syncRunStdinRow` / `submitRunStdin` / `updateRunStdinStatus`）；`output.ts` 的 `RunTranscript` 交互逻辑；`runFlow.ts` 的 `maybeHintEof` / `rerunAfterEof` 相关的 stdin 模式分支。
4. **运行态改为多实例**（新增，易遗漏）：`runState.ts` 的 `RunState` 从「单一 `idle | running`」改为**运行实例列表**，每个实例含 `kind: "script" | "project"` / `tabId` / `label`（「运行」/「项目」/「项目 2」）/ `phase`（`preparing`/`running`/`exited`）/ `startedAt`；去掉 `stdinMode` / `eofHinted`。`isRunning()` 语义改为「任一实例在跑」；`⏹` 与 tab 停止按钮**按实例 id 路由**。
5. **生命周期与不变式落地**（新增，对应 §7）：
   - `termUi.closeTerminal(id)`：运行 tab 被关时**先 `term_kill` 终止进程**再 `dispose`——核查 `IntegratedTerminal.dispose()` 是否已 kill，未 kill 则补；随后移除实例并复位运行态（杜绝孤儿进程 + 状态残留）。
   - `runScriptInTerminal` / 项目运行：**启动前确保 tab 存在，不存在则重建**（根治「关掉终端再运行没地方输出」）。
   - `preparing` 的所有出口（成功 / 失败 / 取消）统一走「落到 `running` 或 `idle`」的收口函数。
   - 停止 / 关闭实现为幂等（对已结束实例无操作）。
6. **配置面板**：`runConfigPanel.ts` 改为「脚本配置 / 项目配置」两个分区（去掉左侧配置列表、新建/复制/删除/临时升格）。
7. **键位**：`keybindings.ts` 的 `run` → 拆为 `run_script`（`Ctrl+F10`）+ `run_project`（`Ctrl+Shift+F10`）；标签「运行当前文件」改为「运行脚本」。
8. **运行历史**：`runHistory.ts` 去掉控制台上方 chip 标签条；保留 `Ctrl+Shift+R` 列表 + Pin + 保存输出；采集来源改为终端输出（剥离 ANSI）。
9. **选区运行**：`runFlow.ts::runSelection` 改为走控制台（临时文件 → 脚本运行路径）。
10. **删 FastAPI 之外的旧预设逻辑**：`openCompoundPanel` / `runCompound`（Compound 随配置列表一起删）；`maybeAutoRerun`（`auto_rerun` 已删）；`maybeSuggestFastApi` 保留但改为写入**项目配置**并打开浏览器。
11. **并行二选一对话框**：项目运行中再点「运行项目」→ 两按钮（停止并重跑 / 新建实例）；`termUi` 支持按序号创建「项目 N」tab。

### 后端

12. **统一运行入口**：`terminal.rs::run_in_terminal` 的 `profile: Option<String>`（命名配置名）→ 改为 `kind: "script" | "project"`：
    - `script`：`path` 为脚本路径，内部 `read_run_config(root, path)` 读**脚本配置**（现状已支持）；
    - `project`：`path` 忽略，内部读取**项目配置**（`project_run`），按 `entry`（module/script）解析 `script_abs` / `script_dir` / `fname`。
13. **probe 开启**：`terminal.rs::run_in_terminal` 的 `probe=false` 改为受 `probe_enabled` 控制（§5.4 必开）。
14. **配置存储**：`env_cmds.rs`
    - 新增「项目配置」读写：`get_project_run` / `set_project_run`（固定键 `project_run`）；
    - `load_profiles` 加旧 `run_profiles` 迁移（§4.3）；
    - `RunProfile` 删除 `name` / `temporary` / `allow_multiple` / `pre_run_profile` / `open_browser_url` / `auto_rerun` / `python_console` / `stdin`；
    - 删除 `ensure_run_profile` / `list_run_profiles` / `save_run_profile` / `delete_run_profile` / `load_profile_by_name` / `set_run_target` / `get_run_target` / `prune_temporary_profiles`。
15. **删 stdin 相关**：`env_cmds.rs` 的 `StdinConfig` / `effective_mode` / `default_stdin_mode`；`lsp.rs` 的 `build_stdin_stdio` / `run_stdin` / `RUN_STDIN`；`run_env.rs` 的 `python_console` 分支。
16. **删 piped 运行路径**：`lsp.rs` 的 `run_script` / `run_profile` / `RUN_CHILD` / `RUN_EXTRA` / `check_run_slots` / `kill_with_grace` / `spawn_run_process` / `forward_lines` / `forward_chunks` 及对应事件（`run-stdout` / `run-stderr` / `run-exit`）随 DOM 输出面板的运行角色一并下线（保留 `stop_script_for_exit` 的退出清理语义，改为调 `term_kill_all_for_exit`）。
17. **`term-exit` 带 code**：`terminal.rs::start_session` 的退出监视补 `status.code()`，供运行历史记录退出码。
18. **文档引用**：`runFlow.ts` / `runState.ts` / `runWidget.ts` 中指向 v2/v3.x 的注释随迁移改写为指向本文。

---

## 18. 裁决记录（2026-09-14）

| # | 事项 | 裁决 |
|---|---|---|
| 1 | 快捷键 | 保留现状：运行脚本 `Ctrl+F10`；运行项目新增 `Ctrl+Shift+F10` |
| 2 | 项目多实例 | **不加 `allow_multiple` 配置开关**；并行的口子是运行时选择「新建实例（并行）」（§6.4），按需多开「项目 N」tab |
| 3 | v2 高级项 | **四项全砍**（已确认）：`open_browser_url` 折叠进 FastAPI 预设默认；`auto_rerun` / `pre_run_profile` / `python_console` 删除 |
| 4 | 运行 tab | 脚本复用唯一「运行」tab；项目默认复用「项目」tab，选「新建实例」时可并行多开。原则：**tab 按运行实例分配，不按运行类型固化** |
| 5 | 生命周期 | 采纳 §7：**实例与 tab 同生共死**的不变式 + 三条硬规则，根治状态/会话不同步类 bug |

### v2 高级项处置（#3 已确认）

| 项 | 处置 | 理由 |
|---|---|---|
| `open_browser_url` | 砍通用字段，**保留体验**：折叠进 FastAPI 预设默认（§9） | 价值只在 web 服务场景，通用字段徒增脚本用户负担 |
| `auto_rerun` | 砍 | 框架自带 reload（uvicorn `--reload` / Django `runserver --reload`）；纯脚本手动重跑够用，且与文件监听/防抖耦合、易误触发 |
| `pre_run_profile` | 砍 | 依赖被砍掉的「命名配置列表」体系，v3 已无宿主 |
| `python_console` | 砍 | 运行 tab 是交互终端，需要时手敲 `python -i <file>` 即可 |

---

## 19. 风险与待验证

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 1 | **PTY 下 probe 未实测**（现状硬编码关闭） | 高：不开则差异化核心断裂 | 首版开启并实测：确认 probe 不写 stdout、开销 < 1.5x；不通过则回退为「piped 运行 + 控制台输入」混合方案 |
| 2 | PTY 输出流下 traceback 链接匹配稳定性 | 中 | xterm link provider 已用于运行终端，需在新回显/告警混排下复测 |
| 3 | 脚本 tab 复用时，长驻脚本（等输入）被新运行终止 | 中 | §6.4「直接终止重跑」；观察是否需改为提示 |
| 4 | Windows ConPTY 下 `\x03` 对 Python 的生效性 | 中 | 现状「在终端中运行」已用同机制，复用即可 |
| 5 | 旧 `run_profiles` 迁移丢配置 | 低 | §4.3 规则；迁移失败按缺省，绝不阻断运行 |
| 6 | 剥离 ANSI 的历史快照采集 | 低 | 采集层去转义；失败降级为原样入档 |
| 7 | 多实例运行态改造（§17-4）比单一 running 复杂 | 中 | 实例列表集中管理，`isRunning()` 与停止路由统一走实例 id；先落单实例再扩并行 |
| 8 | **关闭 tab 未杀进程**（`dispose()` 可能只销毁 xterm） | 高：孤儿进程 + 状态残留（历史 bug 根因） | §17-5：关闭运行 tab 前显式 `term_kill`；实现时核查 `IntegratedTerminal.dispose()` |

---

## 20. 明确不做

- Docker / 远程解释器 / SSH / Dev Container（非目标）。
- pytest 面板、Jupyter / Scientific 模式。
- `Run with Coverage`、完整路径变量/宏体系（仅 `${workspaceRoot}` / `$PROJECT_DIR$`）。
- `Run anything`（`Ctrl+Ctrl`）——与集成终端职责重叠，缓议。
- Compound（并行运行多个**不同**配置）——随配置列表一起删除。同一项目入口的并行实例用 §6.4 的「新建实例（并行）」，不属于 Compound。
- 脚本运行的并行实例（§6.3）：脚本目标随切换文件变化，做并行会 tab 爆炸；需要就开普通终端手敲。
