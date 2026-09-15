# OpenCharm 运行功能交互设计

> 版本：v3.4 · 日期：2026-09-14 · 状态：现行方案（运行功能唯一权威交互口径）· **已实施**（2026-09-15，迁移计划 M1–M4 全部完成）
> 取代：v2.0（配置列表 + 粘性目标 + 输出面板输入框模型，已偏离产品预期）；v3.3 → v3.4 为评审修订：修复内部矛盾（迁移口径三处打架、§7.3 矩阵自相矛盾、§5.3 PYTHONPATH 例外、stopped 状态并入 exited、tab 分配原则措辞），补齐遗漏（preparing×关闭 tab 竞态、termUi 按实例化、probe 多实例并发、历史归属、FastAPI 开浏览器机制、**§13 与调试的关联全面扩充**、**§17 关联遗漏**：键位三处同步与漂移锁、`lib.rs` 命令注销、`stop_script`/`run_stdin` 删除、调试事件前端承接、`maybeAutoRerun` 调用点、TS 侧类型与面板高级项、单测同步、跨文档索引），并落实 §18 裁决 6-10。
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

**tab 分配**：脚本为全局唯一「运行」tab（任何文件的运行都复用它，覆盖语义）；项目默认复用「项目」tab，需要并行时多开「项目 N」，并行实例数不设上限（§6.3）。

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
3. **tab 分配**（对齐 VS Code / PyCharm 的共同点，见 §6.3）：脚本为全局唯一「运行」tab，跨文件复用（覆盖语义）；项目默认复用「项目」tab，要并行 → 多开「项目 N」。
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

### 4.3 旧数据迁移
由于没有用户，不做迁移：现有工作区配置的 `run_profiles` 数组**直接忽略废弃**（不读取、不转换、不回写）；新模型独立存键（脚本配置 = 相对路径键，项目配置 = `project_run` 固定键）。读不到配置绝不阻断运行——脚本走默认命令、项目走自动探测（§9）。


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
② PYTHONPATH 五段合并（分隔符 Windows `;` / Unix `:`；合并越靠前 = sys.path 越靠前 = 优先级越高）
   (a) 用户配置 PYTHONPATH → (b) .env 的 PYTHONPATH → (c) 继承的 PYTHONPATH → (d) 工作区根 → (e) probe src
③ .env 文件键值（有序，靠前文件优先；注入在默认值之后、用户 env 之前）
④ 用户自定义 env（覆盖 ①③；**PYTHONPATH 例外**，见下）
⑤ probe 四件套（仅 probe 开启时）
   OPENCHARM_PROBE_AUTOSTART=1 · OPENCHARM_PROBE_SCRIPT · OPENCHARM_PROBE_HOME ·
   OPENCHARM_PROBE_INSTANCE（= 运行会话 id：`run-term-script` / `run-term-project-<N>`，
   §19-5 多实例 trace 归属——runs 表 instance 列可把每次落库归属到单次运行；调试与
   选区运行 probe=false，不注入）
```

> **PYTHONPATH 例外**：用户 env 里配置的 PYTHONPATH **不走 ④ 的整体覆盖**，而是单独抽出参与 ② 的合并，且最终 env 中 PYTHONPATH **只注入一次**（单测锁定恰好出现一次）——否则 (b)~(e) 四段会被用户的值整体抹掉。
> (d) 工作区根进 PYTHONPATH 是为了对齐依赖预检（`check_missing_imports` 也把 root 塞进 `sys.path`），消除「预检通过但运行 ModuleNotFoundError」的双标。
> (e) probe src 置末：保证用户同名模块优先命中，不被探针遮蔽。

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

**核心原则：脚本 tab 全局唯一（覆盖语义）；项目 tab 按「运行实例」分配**（对齐 VS Code / PyCharm 共同点）。

| Tab | 归属 | 复用规则 | 结束后 |
|---|---|---|---|
| 「运行」tab | 脚本运行 | **全局唯一**，任何文件的运行都复用（覆盖输出） | 保留，供阅读与点 traceback |
| 「项目」tab | 项目运行 | 默认**复用**（先停旧的）；选「新建实例」时多开「项目 2」「项目 3」… | 保留，长驻服务持续输出 |

- **脚本与项目可同时进行**（各占自己的 tab）。
- **同目标的多个项目实例也可并行**（「项目」/「项目 2」/…），各自独立输出与停止。
- **并行实例数不设上限**（对齐 PyCharm；tab 数量本身即自然约束，§18 裁决 8）。
- **多实例不加配置项**：不引入 `allow_multiple` 开关；并行的口子是运行时的「新建实例（并行）」选择（§6.4）——把 PyCharm 的配置开关降级为**运行时选择**，普通用户零配置负担（§18 裁决 2）。
- **脚本运行不提供并行实例**：脚本是「随手跑」，目标随切换文件变化，每实例一 tab 会 tab 爆炸；确需并行就开普通终端手敲（终端能力已覆盖）。

### 6.4 重复运行行为

| 场景 | 行为 |
|---|---|
| 脚本运行中再点「运行脚本」 | **直接终止上一次并重跑**（复用 tab = 覆盖语义），不弹框 |
| 项目运行中再点「运行项目」 | **弹二选一**：「**停止并重跑**」/「**新建实例（并行）**」。停止并重跑 = **停掉全部项目实例**（含「项目 N」），新运行落「项目」主 tab——项目回到单实例状态（§18 裁决 9）；新建实例 = 多开一个「项目 N+1」tab，已有实例不动 |
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
| **运行实例状态**（业务） | `idle` / `preparing` / `running` / `exited`（唯一「已结束驻留态」，附退出原因：code / stopped / canceled） | 进程与准备流程的进展 |
| **tab 状态**（UI 会话） | `attached`（有承载 tab） / `detached`（tab 已关闭） | 输出落点是否存在。`detached` 只允许是**瞬时态**：不变式要求立即终止进程并复位实例，不允许任何实例驻留在 detached |

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
   [idle] ──启动──▶ [preparing] ──spawn 成功──▶ [running] ──进程退出 / 用户停止──▶ [exited]
                        │                                                        │
              失败 / 取消 / 预检中止 / preparing 期关闭 tab                          │
                        │                                                        │
                        └────────────▶ [idle] ◀────── 关闭 tab（仅清 tab）──────────┘
                                          ▲
                                          └────── 再运行（复用 / 重建 tab）──────────┘

   exited 是唯一「已结束驻留态」（附退出原因 code / stopped / canceled），不再单设 stopped 状态；
   tab 保留供回看，关闭 tab 后 exited → idle。

   正交事件（任意状态都可能发生）：
     · 关闭运行 tab      → running：先终止进程再移除 tab（不变式）；
                          preparing：标记 canceled，spawn 落地后按 id 幂等补杀（§7.4）；
                          exited：仅清 tab
     · 切换/关闭工作区   → 全部实例终止 + 清 tab + 复位
     · 应用退出         → 同步终止全部进程
```

### 7.3 状态 × 界面矩阵

| 状态 | ▶ 运行脚本 | ▶ 运行项目 | ⏹ 停止 | 运行 tab | 菜单启动类 |
|---|---|---|---|---|---|
| **idle** | 可用「运行 <文件名>」 | 可用「运行项目（<入口>）」 | 置灰「没有正在运行」 | 保留上次输出可回看 | 全部可用 |
| **preparing** | 置灰 + spinner「正在准备运行…」 | 置灰 + spinner | 置灰 | 创建中 / 复用中 | 启动类禁用 |
| **running（脚本）** | 置灰「已有脚本在运行」 | **可用**（可并行跑项目） | 可用「停止运行」 | 「运行」tab 活跃 + 停止按钮 | 停止可用；「运行项目」可用、「运行脚本」禁用 |
| **running（项目）** | 可用 | 触发二选一（§6.4） | 可用 | 「项目」tab 活跃 | 停止可用；「运行脚本」可用、「运行项目」弹二选一 |
| **running（多实例）** | 可用 | 二选一 | 可用（停**最近启动**的） | 各 tab 独立活跃 | 各 tab 独立停止 |
| **exited**（含手动停止） | 恢复可用 | 恢复可用 | 置灰 | tab 保留，标题带退出码/原因 | 恢复全部 |

### 7.4 边界场景处置表

按生命周期阶段枚举。**「状态变化」列即不变式的执行结果**。

#### 启动前

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 未打开工作区 | 不进 `preparing` | 按钮置灰，tooltip「未打开工作区」。**脚本运行也一律禁用**（与 VS Code 不同）——有意取舍：装配强依赖工作区（配置键、PYTHONPATH 工作区根段、依赖预检、probe HOME），为无工作区另做降级装配口径不值（§18 裁决 7） |
| 当前文件非 `.py`/`.pyw` | 不进 `preparing` | 「运行脚本」置灰，tooltip「当前文件不是 Python 文件」 |
| 项目未配置入口且探测不到 | `preparing` → `idle` | 提示「请先配置项目入口」并打开配置面板（**不静默失败**） |
| 依赖预检缺失，用户点「取消」 | `preparing` → `idle` | 中止，按钮恢复可用，**绝不卡在 preparing** |
| 自动保存失败 | `preparing` → `idle` | 提示并中止（绝不跑磁盘旧内容） |
| 连点运行 | 闸门拦截（不重复进入） | ▶ 显示 spinner，重复点击无效 |
| 调试进行中 | 「运行脚本」拒绝启动；「运行项目」**允许**（裁决 10：互斥收窄至脚本运行，§13.2） | 脚本运行提示「调试进行中，请先停止调试」；项目运行正常 |
| 解释器失效 / spawn 失败 | `preparing` → `idle` | 控制台写错误原因，按钮恢复，**不留僵尸运行态** |

#### 运行中

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 进程崩溃 / 非零退出 | `running` → `exited` | tab 保留输出 + 退出码，按钮恢复；**不弹错误框**（输出即为证据） |
| **用户关闭运行 tab（进程在跑）** | **先终止进程 → 移除实例**（复位 `idle`） | tab 消失，运行态复位，按钮恢复。**不留孤儿进程** |
| **用户关闭运行 tab（preparing 期）** | 实例标记 `canceled`；spawn 请求未发出则按失败收口，已发出则**落地后按 id 立即幂等补杀** → 复位 `idle` | tab 消失。竞态窗口（`run_in_terminal` invoke 已发出、后端 TERMS 尚未登记，此时 `term_kill` 会落空）必须用「spawn 返回后补杀」兜住，**不留孤儿** |
| 用户关闭运行 tab（已结束） | `exited` → `idle`（仅清 tab） | tab 消失，无副作用 |
| 切换 / 关闭工作区 | 全部实例终止并移除（复位 `idle`） | 终止所有进程 + 清 tab + 清历史 |
| 应用退出 | 全部终止 | 同步 kill 进程树 |
| 面板折叠 / resize | 状态不变 | 不影响运行；展开时 fit |
| 目标文件被删后**再次运行** | `preparing` 阶段失败 → `idle` | 提示「文件不存在」，不进 `running`（已在跑的不受影响） |

#### 停止

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 正常停止 | `running` → `exited`（原因=stopped） | Ctrl+C → 强杀；tab 保留，标题带停止标记，按钮恢复 |
| 停止已结束的实例 | **幂等无操作** | 不报错、不改状态 |
| 多实例时点 ⏹ | 停**最近启动**的那个（只停一个） | tooltip 显示停的是哪个；其余 tab 不受影响。注意与二选一「停止并重跑」区分——后者停**全部**项目实例（§6.4、§18 裁决 9） |
| 停止后立刻再运行 | `exited` → `preparing` | 正常重跑（复用 tab） |

#### 再运行 / 结束后

| 场景 | 状态变化 | 界面表现 |
|---|---|---|
| 再运行，tab **存在** | `exited` → `preparing` → `running` | 复用该 tab（exited 态旧进程已退出，无需再杀；running 态则先终止旧的） |
| **再运行，tab 已被关闭** | `idle` → `preparing` → **自动重建 tab** → `running` | **必须重建 tab**——根治「没地方输出」 |
| 脚本运行中再运行脚本 | `running` → 终止旧的 → `preparing` → `running` | 直接终止旧的重跑（不弹框） |
| 项目运行中再运行项目 | 二选一（§6.4） | 「停止并重跑」= **停全部项目实例** → 复用主 tab；「新建实例（并行）」= 多开「项目 N+1」 |

#### 其它

| 场景 | 处理 |
|---|---|
| 输出超长 | 历史采集上限 3000 行（保留尾部）；控制台由 xterm 滚动缓冲承载 |
| 运行中回看历史 | 实时输出继续写入 tab，历史列表不受影响 |
| 运行中修改配置 | 本次运行不受影响，下次生效 |
| 端口被占用（服务类） | 进程自行报错，输出进控制台；IDE 不介入 |
| 脚本文件被删后的配置残留 | 脚本配置按路径键存储，文件删除后**配置保留不清理**（文件可能经 git 恢复）；再次运行该文件在 `preparing` 阶段失败提示（见运行中表） |

### 7.5 防「奇怪问题」的三条硬规则

1. **实例与 tab 同生共死**（§7.1 不变式）：启动前确保有 tab（无则建）；关闭 tab 前先终止进程。
2. **准备期必定复位**：`preparing` 的所有出口（成功 / 失败 / 取消 / 关闭 tab）都必须落到确定态（`running` 或 `idle`），**绝不卡住**；preparing 期关闭 tab 走 canceled 标记 + spawn 落地后按 id 幂等补杀（§7.4）。
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
2. 依赖声明含 `fastapi` 且源码有 `app = FastAPI()` → 预设 `uvicorn <module>:<app> --reload`，**起服务后自动用系统浏览器打开服务 URL**（正反馈；每项目每会话提示一次）。打开机制：**监听控制台输出中的 `Uvicorn running on http://<host>:<port>` 行解析实际 URL**（args 改 `--port`/`--host` 时天然正确），等待窗口 15s，超时静默放弃（不报错、不重试）；
3. 根目录存在 `main.py` → 入口脚本 `main.py`；
4. 存在含 `__main__.py` 的包 → `python -m <pkg>`；
5. 都没有 → 提示「请先配置项目入口」。

---

## 10. 停止语义

| 场景 | 行为 |
|---|---|
| 脚本 / 项目运行（控制台内） | 先向 PTY 写 `\x03`（Ctrl+C，长驻服务优雅退出）→ 1.2s 宽限 → `term_kill` 强杀 |
| 各运行 tab | tab 上有独立停止按钮，可分别停止（并行的「项目」「项目 2」各自独立） |
| ⏹（工具栏） | 停止**最近启动**且仍在运行的实例（只停一个）；都停了则置灰 |
| 二选一「停止并重跑」（§6.4） | 停**全部**项目实例（含「项目 N」）→ 复用「项目」主 tab 重跑（§18 裁决 9） |
| **关闭运行 tab** | **等价于「停止 + 关闭」**：先终止进程再移除 tab（§7.1 不变式） |

> 脚本运行、项目各实例各自独立停止，互不影响。停止/关闭均幂等（§7.5）。

---

## 11. 运行历史与留档

脚本 tab 复用意味着**每次运行覆盖上一次输出**，因此历史必须靠快照采集：

- **采集**：输出在写入控制台的同时，按行采集进运行历史（**需剥离 ANSI 转义序列**，否则快照里是乱码）。
- **记录内容**：目标（脚本路径 或 项目标记）、**实例标识**（tab 标签 + 启动序号；多实例并行时输出采集按实例绑定归属，采集 hook 必须 per-instance，见 §17-5）、启动时间、退出码/原因、行数、时长。
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
| 脚本运行 ↔ 调试 | **互斥**：调试中拒绝脚本运行；脚本运行中拒绝启动调试（§13.2、裁决 10） |
| 项目实例 ↔ 调试 | **不互斥**，可并存：长驻服务跑着也能调试（§13.2） |
| 运行 ↔ 普通 shell 终端 tab | **不互斥**（shell 会话随便开） |
| 脚本运行中再次运行脚本 | 终止旧的重跑（§6.4） |
| 项目运行中再次运行项目 | 二选一：停止并重跑（**停全部项目实例**）/ 新建实例并行（§6.4） |

> 因此运行态模型须支持**多个并发运行实例**（脚本 + N 个项目实例），见 §17 第 4 条。

---

## 13. 与调试的关系

> 调试自身方案见 `python_debug_dev_plan.md`（v1.3，stdio adapter 架构，已实施）。本节只约定两功能的交界面，运行迁移（§17）不得破坏其中任何一条。

### 13.1 配置与启动链路

- 调试**复用脚本配置**（调试当前文件，同键 `read_run_config` 读取）；项目配置与调试无关（调试不调试「项目入口」）。
- `runDebug()`（`main.ts`）复用 `prepareRun`（自动保存 / 依赖预检 / 读运行配置）——§17-1 大删 `runFlow` 时 **`prepareRun` 必须保留**且对调试可用（其中 stdin 相关的 fail-fast 分支随 §17-15 一并删除）。
- `RunConfig` 字段裁剪（§17-14/15：删 `stdin` / `python_console` 等）后，`dap.rs` 中两处 `read_run_config` + `build_run_env` 调用是**编译依赖点**，须同步适配。

### 13.2 互斥与并存（§18 裁决 10：收窄）

| 关系 | 规则 |
|---|---|
| 调试 ↔ 脚本运行 | **互斥**：调试中拒绝脚本运行；脚本运行中拒绝启动调试（同为当前文件、同一 `prepareRun` 链路，并行必混淆） |
| 调试 ↔ 项目实例 | **可并存**：长驻服务（uvicorn 等）跑着也能调试脚本——对齐 PyCharm / VS Code；二者是不同进程，probe 只在项目实例进程开启，与 debugpy 无接触 |

- **后端区分手段**：运行会话 id 约定 `run-term-script` / `run-term-project-<N>`（§17-12）——`dap.rs::debug_start` 的互斥检查只看**脚本运行会话**是否存在；`run_in_terminal` 的 `debug_busy()` 检查按 kind 收窄（`script` 拒绝、`project` 放行）。
- 旧 `lsp::run_slot_busy()` 随 piped 路径删除失去宿主（§17-16），`dap.rs::debug_start` 与 `run_in_terminal` 中对它的检查**一并收敛**（三态互斥 → 「脚本运行 / 项目运行 / 调试」按上表的新矩阵）。
- 运行组 `⏹` 在调试态下路由到 `debug_stop`（§8，已实现）。

### 13.3 输出通道与界面落点

- 调试态 debuggee 走**管道模式**（调试计划 v1.3 实测 ConPTY 下 pydevd 不建连），stdout/stderr 现状**复用 `run-stdout` / `run-stderr` 事件 → 输出面板**（`dap.rs`）。§17-16 删除这两个运行事件时，调试通道**必须更名为独立事件 `debug-stdout` / `debug-stderr` 并保留输出面板的调试承载角色**——否则调试输出直接断链（§19-9）。
- 因此**输出面板不随运行角色整体下线**：运行角色删除（无输入框、无 RunTranscript 交互），调试输出承载保留；§17-3 删 `RunTranscript` 交互逻辑时保留非交互的输出渲染路径。
- 调试会话**不占运行 tab**：§7 的 tab 不变式与生命周期状态机**不适用于调试**（调试无终端 tab，`debug-exited` 事件独立复位调试态）。
- **调试输出不进运行历史**（§11 采集只挂在运行 tab 上，输出面板不参与）。
- DAP `output` 事件（Logpoint / evaluate 回显）走调试控制台（`debugConsole.ts`），与 debuggee stdout（输出面板）分路，互不重复。

### 13.4 probe

- **调试态 probe 恒 false**（调试计划 §3.2）：debugpy 的 trace 注入与 probe（PEP 669 `sys.monitoring`）采样不能在同一进程可靠共存。§17-13 把运行路径的 `probe=false` 改为受 `probe_enabled` 控制时，**不得波及调试链路**（`dap.rs` 的 `build_run_env(…, probe=false)` 保持不变）。

### 13.5 工作区切换 / 应用退出

- 切换 / 关闭工作区、应用退出时，运行实例按 §15 清理；**调试会话须同时 `debug_stop`**（调试计划 §8 坑 7 已有约定，运行侧清理不覆盖调试，两条链路各自收口）。

---

## 14. 前置校验与边界

| 场景 | 行为 |
|---|---|
| 未打开工作区 | 运行按钮置灰（**含脚本运行**），tooltip 提示「未打开工作区」；取舍理由见 §7.4（装配强依赖工作区） |
| 当前文件非 `.py`/`.pyw` | 「运行脚本」置灰，tooltip「当前文件不是 Python 文件」 |
| 运行前自动保存 | 保存**本次运行目标所在的 tab**（不是活动 tab，避免跑到磁盘旧内容） |
| 依赖预检（脚本运行 / 项目 script 入口） | `check_missing_imports` 缺失 → **弹确认框**「以下导入未找到…仍要运行？」（强提醒，保留）；无解释器时跳过预检 |
| 依赖预检（项目 module 入口） | **不做**（依赖即模块自身，交给运行时暴露） |
| `.env` 文件缺失 | 仅告警写入控制台，不中断运行 |
| 参数解析失败（shell-words） | 忽略参数 + 告警，不中断运行 |

> 完整生命周期边界见 §7.4。

---

## 15. 工作区切换与清理

切换 / 关闭工作区时：停止运行中的全部实例（脚本 + 所有项目实例）→ 关闭运行 tab → 清空配置缓存 → 重置运行历史。应用退出时同步终止全部运行进程。调试会话的清理走 `debug_stop` 独立链路（§13.5，调试计划 §8 坑 7），运行侧清理不覆盖调试。

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

1. **删粘性目标**：`runState.ts` 移除 `RunTarget` / `RunTargetRecord` / `displayTargetName`；`runFlow.ts` 移除 `runTarget` / `lastRun` / `lastProfile` / `assignRunTarget` / `setRunTarget` / `loadPersistedRunTarget` / `restartRun` / `reportStaleTarget` / `runStickyTarget` / `runStickyTargetInTerminal`；新增 `runScript()` / `runProject()`。**`prepareRun` 保留**（`main.ts::runDebug` 复用，§13.1），仅删其中 stdin fail-fast 分支。
2. **删配置列表下拉**：`runWidget.ts` 的 ▾ 目标区 → 换成「运行脚本 / 运行项目 / 停止 / 配置」；`RunWidgetState` 去掉 `profiles` / `currentTarget` / `unsavedFileTarget` / `targetName`。菜单栏运行组（`menuBar.ts`，§1 示意图）、命令面板接线（`main.ts`）、gutter ▶ 及其右键菜单（`runGutter.ts`，§8）随本条同步改造。
3. **删输入框与 stdin**：移除 `run-stdin-row` / `run-stdin-input` / `run-stdin-status`（`index.html` + `runFlow.ts` 的 `syncRunStdinRow` / `submitRunStdin` / `updateRunStdinStatus`）；`output.ts` 的 `RunTranscript` 交互逻辑（**保留非交互输出渲染**——输出面板继续承载调试输出，§13.3）；`runFlow.ts` 的 `maybeHintEof` / `rerunAfterEof` 相关的 stdin 模式分支；`style.css` 中 run-stdin 与运行 chip 标签条相关样式一并清理。
4. **运行态改为多实例**（新增，易遗漏）：`runState.ts` 的 `RunState` 从「单一 `idle | running`」改为**运行实例列表**，每个实例含 `kind: "script" | "project"` / `tabId` / `label`（「运行」/「项目」/「项目 2」）/ `phase`（`preparing`/`running`/`exited`）/ `startedAt`；去掉 `stdinMode` / `eofHinted`。`isRunning()` 语义改为「任一实例在跑」；`⏹` 与 tab 停止按钮**按实例 id 路由**。
5. **生命周期与不变式落地 + termUi 按实例化**（新增，对应 §7；是第 4 条多实例 RunState 能落地的前提）：
   - `termUi.closeTerminal(id)`：运行 tab 被关时**先 `term_kill` 终止进程**再 `dispose`——已核实 `IntegratedTerminal.dispose()` 在 `started=true` 时含 `term_kill`，且 `closeTerminal` 已触发运行态复位；剩余缺口是 **preparing 竞态**：`startRun` 在 invoke `run_in_terminal` 前已置 `started=true`，此时关 tab 的 kill 会打到后端 TERMS 尚未登记的 id 而落空。落地：实例标记 `canceled`，invoke 返回后按 id 幂等补杀（§7.4）。
   - **termUi 单实例假设全部按实例化**：现状 `runExitHook` 是全局单 hook、`runActive` 是单标志、`find(kind==="run")` 取首个运行 tab——多实例下退出回调、停止路由、`runActive`、tab 查找必须按实例 id 绑定（每个运行 tab 各自挂自己的实例）。
   - `runScriptInTerminal` / 项目运行：**启动前确保 tab 存在，不存在则重建**（根治「关掉终端再运行没地方输出」）。
   - `preparing` 的所有出口（成功 / 失败 / 取消 / 关闭 tab）统一走「落到 `running` 或 `idle`」的收口函数。
   - 停止 / 关闭实现为幂等（对已结束实例无操作）。
6. **配置面板与 TS 侧类型**：`runConfigPanel.ts` 改为「脚本配置 / 项目配置」两个分区（去掉左侧配置列表、新建/复制/删除/临时升格），同时删除面板中 v2 高级项 UI（stdin 三档 / `allow_multiple` / `auto_rerun` / `python_console` / `open_browser_url` / `pre_run_profile`）；`runState.ts` 的 `StdinConfig` 类型与 `RunConfig.stdin` 字段解析同步删除。
7. **键位（三处同步 + 漂移锁）**：`run` → 拆为 `run_script`（`Ctrl+F10`）+ `run_project`（`Ctrl+Shift+F10`）；标签「运行当前文件」改为「运行脚本」。必须同步三处：`keybindings.ts` KEYBINDING_META、`state.ts` DEFAULT_SETTINGS.keybindings、Rust `settings.rs::default_keybindings`——`keybindings.test.ts` 有漂移锁单测，一并更新。
8. **运行历史**：`runHistory.ts` 去掉控制台上方 chip 标签条；保留 `Ctrl+Shift+R` 列表 + Pin + 保存输出；采集来源改为终端输出（剥离 ANSI），**按实例绑定归属**（多实例并行时各写各的快照，记录实例标识，§11）。
9. **选区运行**：`runFlow.ts::runSelection` 改为走控制台（临时文件 → 脚本运行路径）。
10. **删 FastAPI 之外的旧预设逻辑**：`openCompoundPanel` / `runCompound`（Compound 随配置列表一起删）；`maybeAutoRerun`（`auto_rerun` 已删）——**连同 `main.ts` 文件监听回调中的调用点一并删除**；`maybeSuggestFastApi` 保留但改为写入**项目配置**并打开浏览器（机制见 §9）。
11. **并行二选一对话框**：项目运行中再点「运行项目」→ 两按钮（停止并重跑 / 新建实例）；`termUi` 支持按序号创建「项目 N」tab。

### 后端

12. **统一运行入口**：`terminal.rs::run_in_terminal` 的 `profile: Option<String>`（命名配置名）→ 改为 `kind: "script" | "project"`：
    - `script`：`path` 为脚本路径，内部 `read_run_config(root, path)` 读**脚本配置**（现状已支持）；
    - `project`：`path` 忽略，内部读取**项目配置**（`project_run`），按 `entry`（module/script）解析 `script_abs` / `script_dir` / `fname`。
    - **会话 id 约定**：`run-term-script` / `run-term-project-<N>`（沿用 `RUN_TERM_PREFIX`）——多实例并行的槽位区分，且供调试互斥收窄判定「是否存在脚本运行会话」（§13.2）；`run_terminal_busy()` 相应细化出 `script_run_busy()`。
    - `debug_busy()` 检查按 kind 收窄：`script` 拒绝、`project` 放行（§13.2、裁决 10）。
13. **probe 开启**：`terminal.rs::run_in_terminal` 的 `probe=false` 改为受 `probe_enabled` 控制（§5.4 必开）。
14. **配置存储**：`env_cmds.rs`
    - 新增「项目配置」读写：`get_project_run` / `set_project_run`（固定键 `project_run`）；
    - 旧 `run_profiles` 数据**直接忽略废弃，不做迁移**（§4.3）；
    - `RunProfile` 删除 `name` / `temporary` / `allow_multiple` / `pre_run_profile` / `open_browser_url` / `auto_rerun` / `python_console` / `stdin`；
    - 删除 `ensure_run_profile` / `list_run_profiles` / `save_run_profile` / `delete_run_profile` / `load_profile_by_name` / `set_run_target` / `get_run_target` / `prune_temporary_profiles`，并从 `lib.rs` 的 `invoke_handler` 注册表**同步注销**。
15. **删 stdin 相关**：`env_cmds.rs` 的 `StdinConfig` / `effective_mode` / `default_stdin_mode`；`lsp.rs` 的 `build_stdin_stdio` / `run_stdin` / `RUN_STDIN`；`run_env.rs` 的 `python_console` 分支。
16. **删 piped 运行路径（一次删净，不留回退）**：`lsp.rs` 的 `run_script` / `run_profile` / `stop_script` / `RUN_CHILD` / `RUN_EXTRA` / `check_run_slots` / `run_slot_busy` / `kill_with_grace` / `spawn_run_process` / `forward_lines` / `forward_chunks`（stdin 相关见第 15 条）及对应事件（`run-stdout` / `run-stderr` / `run-exit`）随 DOM 输出面板的运行角色一并下线，并从 `lib.rs` 的 `invoke_handler` 注册表**同步注销**（保留 `stop_script_for_exit` 的退出清理语义，改为调 `term_kill_all_for_exit`）。probe PTY 实测不通过时**届时重写混合方案**，接受返工（§18 裁决 6、§19-1）。**调试链路同步解耦（§13，易漏）**：
    - `dap.rs` debuggee 输出转发当前复用 `run-stdout` / `run-stderr` 事件——**更名为 `debug-stdout` / `debug-stderr`**；前端承接方（`main.ts::initRunEvents` 的事件监听与 `output.ts` 的输出面板写入）**同步改名接线**，输出面板保留调试承载角色（否则调试输出断链，§19-9）；
    - `dap.rs::debug_start` 的三态互斥检查收敛：删除 `run_slot_busy()` 检查（宿主已删），`run_terminal_busy()` 检查改为只看脚本运行会话（`script_run_busy()`，§17-12）；
    - `dap.rs` 对 `RunConfig` 被删字段（`stdin` / `python_console` 等）的引用随 §17-14/15 适配（编译依赖点，§13.1）。
17. **`term-exit` 带 code**：`terminal.rs::start_session` 的退出监视补 `status.code()`，供运行历史记录退出码。
18. **单测与漂移锁同步**（易漏，CI 全绿是合并闸门）：
    - Rust：`run_env.rs` 的 `resolve_run_command` 签名去掉 `python_console` 参数及相关用例；`env_cmds.rs` 的 `RunProfile` 字段用例（`allow_multiple` / `pre_run_profile` / `open_browser_url` / `auto_rerun` / `python_console` / `is_effectively_empty`）与 `StdinConfig::effective_mode` 全组用例删除；`run_config_key` 用例保留（脚本配置键沿用）。
    - 前端：`keybindings.test.ts` 漂移锁（`run` → `run_script` + `run_project` 三处同步，§17-7）；`state.test.ts` 的 DEFAULT_SETTINGS 相关断言；`runState.test.ts`（stdin / RunTarget 用例删除，多实例 RunState 新用例）；`runWidget.test.ts` / `runWidgetDom.test.ts`（配置列表下拉 / 目标区删除，新四按钮组）；`output.test.ts`（RunTranscript 交互用例删除，保留调试输出渲染用例）；`menu.test.ts`（运行菜单项更名与新增「运行项目」）。
19. **文档与注释引用**：`runFlow.ts` / `runState.ts` / `runWidget.ts` 中指向 v2/v3.x 的注释随迁移改写为指向本文；`python_debug_dev_plan.md` §10 附录索引引用了将被删除的符号（`run_script` / `run_slot_busy` / `RUN_CHILD` / `runScriptInTerminal` 等），迁移完成后同步更新该索引（或在运行口径上以本文为准加注）；`python_ide_dev_plan_v2.md` 中运行相关条目与本文口径核对，冲突时按铁律以开发计划为准并反馈修订。

---

## 18. 裁决记录（2026-09-14）

| # | 事项 | 裁决 |
|---|---|---|
| 1 | 快捷键 | 保留现状：运行脚本 `Ctrl+F10`；运行项目新增 `Ctrl+Shift+F10` |
| 2 | 项目多实例 | **不加 `allow_multiple` 配置开关**；并行的口子是运行时选择「新建实例（并行）」（§6.4），按需多开「项目 N」tab |
| 3 | v2 高级项 | **四项全砍**（已确认）：`open_browser_url` 折叠进 FastAPI 预设默认；`auto_rerun` / `pre_run_profile` / `python_console` 删除 |
| 4 | 运行 tab | 脚本复用唯一「运行」tab；项目默认复用「项目」tab，选「新建实例」时可并行多开。（原表述「tab 按运行实例分配，不按运行类型固化」v3.4 修正：**脚本 tab 全局唯一，仅项目 tab 按实例分配**，见 §6.3） |
| 5 | 生命周期 | 采纳 §7：**实例与 tab 同生共死**的不变式 + 三条硬规则，根治状态/会话不同步类 bug |
| 6 | piped 回退（v3.4） | **立即删净，放弃回退**：§17-16 一次删净 piped 路径；probe PTY 实测不通过时届时重写混合方案（接受返工成本） |
| 7 | 无工作区运行（v3.4） | **一律禁用**（含脚本运行，与 VS Code 不同）：装配强依赖工作区（配置键、PYTHONPATH 工作区根段、依赖预检、probe HOME），降级装配口径不值 |
| 8 | 并行实例上限（v3.4） | **不设上限**：对齐 PyCharm；tab 数量本身即自然约束 |
| 9 | 「停止并重跑」语义（v3.4） | **停全部项目实例**（含「项目 N」）→ 复用「项目」主 tab 重跑——项目回到单实例状态，语义最干净；与 ⏹（只停最近一个，§10）明确区分 |
| 10 | 运行↔调试互斥范围（v3.4 复核） | **收窄为「调试 ↔ 脚本运行」互斥**：项目实例（长驻服务）可与调试并存（对齐 PyCharm / VS Code）；后端按会话 id 前缀区分脚本 / 项目运行会话（§13.2、§17-12） |

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
| 1 | **PTY 下 probe 未实测**（现状硬编码关闭） | 高：不开则差异化核心断裂 | 首版开启并实测：确认 probe 不写 stdout、开销 < 1.5x；**不通过则届时重写混合方案**（piped 已删净不留回退，接受返工，§18 裁决 6） |
| 2 | PTY 输出流下 traceback 链接匹配稳定性 | 中 | xterm link provider 已用于运行终端，需在新回显/告警混排下复测 |
| 3 | 脚本 tab 复用时，长驻脚本（等输入）被新运行终止 | 中 | §6.4「直接终止重跑」；观察是否需改为提示 |
| 4 | Windows ConPTY 下 `\x03` 对 Python 的生效性 | 中 | 现状「在终端中运行」已用同机制，复用即可 |
| 5 | **probe 多实例并发**：脚本 + N 个项目实例并行时多进程同时 autostart probe，写同一 SQLite trace 库 | 中：写冲突 / trace 归属混乱，影响运行时补全链路 | ✅ 已落地：trace 库 WAL + busy_timeout（store._set_pragmas，Phase 2 已设）；运行实例标识经 `OPENCHARM_PROBE_INSTANCE` 注入 → `runs.instance` 列（§5.3 ⑤，M4-4.1）；并行场景实测通过（见 `docs/run_acceptance_record.md`） |
| 6 | 剥离 ANSI 的历史快照采集 | 低 | 采集层去转义；失败降级为原样入档 |
| 7 | 多实例运行态改造（§17-4/§17-5）比单一 running 复杂——`termUi` 的 `runExitHook` / `runActive` / tab 查找均为单实例假设 | 中 | 实例列表集中管理，`isRunning()`、停止路由、退出回调统一走实例 id；先落单实例再扩并行 |
| 8 | 关闭 tab 未杀进程 | **已核实降级**：`IntegratedTerminal.dispose()` 在 `started=true` 时已含 `term_kill`，`closeTerminal` 已复位运行态 | 剩余缺口是 preparing 竞态（kill 打到未登记 id 落空），按 §17-5 的 canceled + spawn 后补杀方案处理 |
| 9 | **调试输出断链**：输出面板角色切换（运行角色下线、调试承载保留）时，§17-3/§17-16 误删调试渲染路径或漏改 `debug-stdout` / `debug-stderr` 事件更名 | 高：debuggee stdout 无处显示（调试管道模式无终端 tab，输出面板是唯一落点） | 按 §13.3/§17-16 执行更名与保留；迁移后**回归验证调试输出**（断点 + print + Logpoint 三路） |

---

## 20. 明确不做

- Docker / 远程解释器 / SSH / Dev Container（非目标）。
- 无工作区运行（含脚本运行）——装配强依赖工作区，按钮一律置灰（§18 裁决 7、§7.4）。
- pytest 面板、Jupyter / Scientific 模式。
- `Run with Coverage`、完整路径变量/宏体系（仅 `${workspaceRoot}` / `$PROJECT_DIR$`）。
- `Run anything`（`Ctrl+Ctrl`）——与集成终端职责重叠，缓议。
- Compound（并行运行多个**不同**配置）——随配置列表一起删除。同一项目入口的并行实例用 §6.4 的「新建实例（并行）」，不属于 Compound。
- 脚本运行的并行实例（§6.3）：脚本目标随切换文件变化，做并行会 tab 爆炸；需要就开普通终端手敲。
