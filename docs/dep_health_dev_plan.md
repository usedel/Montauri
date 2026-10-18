# Montauri 依赖健康机制开发计划（Dep Health / 三层一致性维护）

> 版本：v1.7 · 日期：2026-09-16 · 状态：**M1 已交付**（§7 M1 含提交号与验证数据）· **M2 已交付**（§7 M2 含提交号）· **M3 已交付**（§7 M3 含提交号与验证数据）· **M4 已交付**（§7 M4 含验证数据）
> **v1.7 修订（2026-09-16，fika-admin 实测反馈「E1 pytest ×5 提示过多」）**：E1 语义收窄为「未声明的缺失」——已写入声明全集（extras/groups）的 missing 模块分流到 E2 分组新小节「已声明未安装（代码引用）」汇总呈现（A）；E1 面板按模块聚合展示（B）；预检 `missingForFile` 同步剔除已声明缺失。详见 §11 v1.7。
> **v1.6 修订（2026-09-16，M4 实施反馈）**：① 惰性导入定案「纯输出面板 hint」形态（预检框不碰，会话去重）；② 增量缓存升级为「完整增量」——resolution 按解释器缓存（full 扫描作废）+ dep_scan 增设 scope 参数（full/code/declaration 三档信号分流）+ 环境快照进程级缓存（code 范围复用）；③ traceback `ModuleNotFoundError` → toast +「安装」双出口（term-data 分发点 + 输出面板 stderr 行，会话去重）；④ dist 歧义定案「安装时弹 openChoice 候选选择」（探针输出多候选数组，契约增 `distCandidates` 字段，字段只增不删）；⑤ uv workspace 评估结论：bench 集无需求案例，暂不实施；⑥ 性能红线验收以新增 `sample/large_repo/`（88 文件 × 4 层深目录）回放为准（880ms ≤ 2s 达标；E5 首轮联网冷缓存开销已记录）。详见 §11 v1.6。
> **v1.5 修订（2026-09-16，M3 实施反馈）**：① 三视图口径以 §6.1 为准（按断边/按文件/已忽略），§3.2 概述行「包列表升级」修订（不实施迁移重构，包列表分区保持原样 + §6.2 uv 建议常驻行）；② 忽略清单**后端统一过滤**（dep_scan 计算后返回前），E2/E3 键 PEP 503 归一存储、过滤两侧归一防御；③ 灯泡 E3/E4 触发形态定案「**光标行匹配 diff**」——E3 漂移包被 import 时与 E4 是同一事实，收敛为同一 declare 动作；④ `dep_fix` 单命令 + action 枚举（install/sync/declare/lock/migrate），前端 fixInFlight + 后端 AtomicBool 双互斥；⑤ 原 env-pyproject-banner 退役并入四级横幅优先级 2；env-modal 对齐 runConfigPanel 范式（点遮罩不关 + Esc）；⑥ toast 扩展可选动作按钮（「查看」入口）。详见 §11。
> **v1.4 修订（2026-09-16，M2 实施反馈）**：失效矩阵落地——① `fs-changed` 只发父目录不够用，新增**文件级** `dep-fs-changed` 事件（相对路径 + py/declaration 分类，不动原契约）；② §5.5 的 L1 真值判定新增轻量后端命令 `dep_env_snapshot(workspace_root)`（复用 `scan_list_packages`，解释器解析与 `dep_scan` 同源）；③ 终端完成摘要嗅探落 `termUi` 的 term-data 分发点（shell+run 会话，跨块缓冲）；④ site-packages 例外按 `RECORD`/`*.dist-info` 过滤（滤 .pyc 噪声）；⑤ 环境信号有差异 → 重算 diff + `restartEngine`（反馈 3/4 红线消失）；⑥ envDrift toast 随 M3 面板落（M2 静默）。详见 §11。
> **v1.3 修订（2026-09-16，M1 实施反馈）**：style 判定序改为 **external 优先**（poetry/pdm 项目必有 pyproject.toml，字面序会误判致 §9.1 验收不成立）；E2 收窄为「同步范围」、E3 排除清单扩展、E4 missing 不进、E5 判定口径经 uv 0.10.11 实测定案。详见 §11。
> **v1.2 修订（2026-09-16，二次评审核实）**：修正 E5 语义（`lockOutOfDate` 不依赖解释器）、拆分 `dep_style` / `dep_scan` 二命令、明确 style 判定唯一序、DepDiff 增 `requirementsUninstalled` 字段。详见 §11。
> **v1.1 修订（2026-09-16，评审反馈）**：① 补耗时交互设计（§4.5 时机×耗时×交互矩阵、§4.7 打开工作区时序编排、§5.6 L3 修复交互规范）；② 补包管理器边界（§4.2.1 画像与边界提示、DepDiff 增 `external` style、终端嗅探覆盖 pip），防「用户用其它工具 → 认为编辑器有 bug」。详见 §11。
> 归属：环境管理域（`envPanel.ts` / `env_cmds.rs`）的能力升级，不新建独立包
> 上游：`docs/python_ide_tech_plan_v3.md` §5（环境管理）· `docs/python_ide_dev_plan_v2.md` Phase 4（工具链引导）
> 本文档面向实施者，是依赖健康机制的排期与执行依据；与 `dev_plan_v2.md` 冲突时，以本计划为准并反馈修订。

---

## 1. 背景与问题定义

### 1.1 用户反馈（症状）

1. 老项目（requirements.txt + venv）用 Montauri 创建 .env 后没装依赖；自行 `uv pip install -r requirements.txt` 装上后，pyproject.toml 没有同步；
2. 不在 requirements.txt 里的依赖没有检测到，运行时报 ImportError；
3. 终端手动 `uv pip install` 后，编辑器红线不消失、pyrefly 诊断不更新；
4. 期望「一套完整的依赖检测和修复机制」。

### 1.2 根因（机制缺失）

依赖问题在本架构中没有 owner：pyrefly 管静态语义、uv 管环境操作、运行预检管单文件即时检查，但「三层事实是否一致」无组件负责。现有四个功能（灯泡装包、运行前预检、`pip_install` 分流、包列表）各自为政地检测，互不失效、互不级联。

### 1.3 本计划不做什么

- 不做后台静默修复（所有收敛动作需用户确认）；
- 不做 conda/pipenv/poetry/pdm 的深度适配（仅 uv，符合架构选型）；但检测到外部管理器时**显式提示能力边界**（§4.2.1），不沉默给出不完整结果——用户用其它工具装包后编辑器毫无表示，会被误判为 bug；
- 不为依赖管理新建独立包（编排耦合 Tauri 进程管理，放 `shell/src-tauri` dep 域 + TS 域模块，遵守最小闭环）；
- 不做用户终端命令拦截/重写（尊重用户操作，只做检测与建议）。

---

## 2. 模型：三层事实与断边

一个 Python 项目运行所需的全部依赖事实只有三层：

```
代码层      工作区所有 .py 文件实际 import 的模块集     （"我在用什么"）
声明层      pyproject.toml / requirements.txt / uv.lock（"我声明了什么"）
环境层      .venv site-packages 实际内容               （"我装了什么"）
```

所有可感知的依赖故障都是某条有向边的断裂：

| # | 断边 | 症状 | PyCharm 对标 |
|---|---|---|---|
| E1 | 代码 ⊄ 环境 | 红波浪线、ModuleNotFoundError、运行前预检报警 | unresolved reference + quick-fix 安装 |
| E2 | 声明 ⊄ 环境 | 老项目装了 .venv 没装依赖（反馈 1）、`uv run` 隐式回滚裸装包 | requirements 检查 + 通知栏 "Install requirements" |
| E3 | 环境 ⊄ 声明 | 终端 `uv pip install` 后 pyproject 不同步（反馈 2） | （无 uv.lock 管理，我们做得更完整） |
| E4 | 代码 ⊄ 声明 | 用了未写入 pyproject 的依赖 | quick-fix「加入环境并更新 .toml」 |
| E5 | 声明内部（pyproject ↔ uv.lock） | uv add / uv sync 语义分叉 | （PyCharm 未覆盖） |

**设计原则**：定义唯一的 diff 计算（`DepDiff`），让所有症状成为这个 diff 的投影；检测层不重复造轮子，修复层每条断边对应一个收敛动作。

### 2.1 PyCharm 调研要点（2026-09-16，官方文档）

| PyCharm 机制 | 我们的取舍 |
|---|---|
| 打开项目即检测未满足依赖（Unsatisfied package requirements inspection） | **采纳**：体检挂工作区打开时（M1），而非等运行报错 |
| 编辑器顶部通知栏 + Install requirements 一键安装 | **采纳**：健康横幅（M3），但落环境面板而非编辑器顶栏（我们无多通知栏框架） |
| quick-fix 同时装包 + 更新声明文件 | **采纳**：灯泡数据源切到 DepDiff（M3） |
| requirements.txt 中显示已装版本 + 补全 | 缓议（P4+，非闭环必需） |
| uv.lock 一致性管理 | PyCharm 未做，我们通过 E5 检测补齐 |
| 包管理器选择（pip/conda） | 不做，统一 uv |
| inspections 忽略列表 | **采纳**：忽略清单按工作区持久化（M4） |

---

## 3. 总体架构

### 3.1 数据流

```
┌─失效信号───┐   ┌──────────────┐   ┌─────────────┐   ┌──────────────┐
│ 代码层变化  │──▶│              │   │             │   │              │
│ 声明层变化  │──▶│  防抖重算     │──▶│ DepDiff 真值 │──▶│ 三个 UI 投影  │
│ 环境层变化  │──▶│  dep_scan    │   │ （快照+缓存） │   │ + 修复矩阵    │
└────────────┘   └──────────────┘   └─────────────┘   └──────────────┘
                        │                                      │
                        ▼                                      ▼
               diff 变化才级联（重算不算级联）            修复动作统一收尾协议：
                                                    重算 diff → restartEngine → toast
```

### 3.2 模块划分（对齐现有分层）

| 模块 | 层 | 职责 | 对标现有 |
|---|---|---|---|
| `env_cmds.rs::dep 域` | Rust | `dep_style`（L0 同步 style 判定）、`dep_scan`（L1+L2 全量 diff 计算）、`dep_fix`（修复执行）、声明层/环境层探针脚本 | `check_missing_imports` 的推广 |
| `src/depHealth.ts` | TS | diff 状态管理、失效矩阵接线、修复动作编排 | `envPanel.ts` 的域模块模式 |
| `src/depHealthPanel.ts` | TS | 健康面板 UI（三视图：按断边分组 / 按文件分组 / 已忽略——v1.5 修订，原「包列表升级」不实施：包列表分区保持原样，仅加 §6.2 uv 建议常驻行） | 环境面板模式 |
| 灯泡/预检/traceback | TS | 消费 diff，不再自检 | `installMissingPackage` 改造 |

### 3.3 DepDiff 契约（v1，前端消费的最小集）

```ts
interface DepDiff {
  /** external = 检测到 poetry/pipenv/pdm/conda 等外部管理器（声明层不解析，E2~E5 禁用，仅 E1 可算，见 §4.2.1） */
  style: "pyproject" | "requirements" | "bare" | "external";
  /** style=external 时的管理器名（poetry/pipenv/pdm/conda），其余为 null */
  externalManager: string | null;
  /** E1 代码 ⊄ 环境：缺失模块清单（dist 名经 packages_distributions 归一） */
  missingInEnv:   Array<{ module: string; dist: string | null; file: string; line: number; lazy: boolean }>;
  /** E2 声明 ⊄ 环境：声明了但环境缺（requirements 项目含「整个 requirements 未安装」） */
  declaredMissing: Array<{ dist: string; spec: string }>;
  /** E3 环境 ⊄ 声明：装了但没声明（uv pip 裸装漂移） */
  envDrift:       Array<{ dist: string; version: string }>;
  /** E4 代码 ⊄ 声明：import 了但没写进 pyproject（pyproject 项目） */
  undeclared:     Array<{ module: string; dist: string | null; file: string; line: number }>;
  /** E5 pyproject ↔ uv.lock 不一致 */
  lockOutOfDate: boolean;
  /** style=requirements 且整个 requirements 文件未安装（E2 特例，横幅优先级 3 直接消费） */
  requirementsUninstalled: boolean;
  /** 元信息 */
  interpreter: string | null;   // null = uv run 兜底（E4/E5 可算；E1/E2/E3 环境侧置空，见字段语义）
  requirementsFile: string | null; // style=requirements 时命中
  scannedAt: number;
}
```

> 契约演进规则：字段只增不删；消费方必须容忍未知字段（向前兼容）。
>
> `dep_style`（同步命令，零子进程）返回上述契约的轻量子集 `{ style, externalManager, requirementsFile }`，供打开工作区 t0 时刻立即出 bare/external 横幅（§4.7）；`dep_scan`（全量）内部复用其结果填 `style`，杜绝两端 style 判定逻辑漂移。

---

## 字段语义细化（评审补充，v1.0 内定案）

- `missingInEnv` / `undeclared` 的 `dist`：经 `packages_distributions()` 反查出的**发行版名**；`null` = 反查不到（此时修复动作降级为「按模块名安装」并提示可能装错包）。`packages_distributions()` 依赖各包安装时写入的 `top_level.txt`，老包/纯 wheel 常无此文件，故 `dist=null` 是**正常占比而非罕见兜底**，该降级路径须作一级交互设计（非备用分支）。
- `lazy: true`：import 位于函数/方法体内（惰性导入），仅提示不阻塞运行预检（M4 精度项）。
- `declaredMissing` 的 `spec`：保留 requirements / pyproject 原始版本约束串（如 `>=1.0,<2`），修复时原样交给 `uv add -r` / `uv sync`。
- `requirementsUninstalled`：style=requirements 且整个 requirements 文件未被安装（E2 特例），供横幅优先级 3 直接消费；pyproject 项目恒为 false。
- `envDrift` **排除** Montauri 与工具链自装的开发工具（pyrefly / ruff / debugpy）——它们不属于项目依赖漂移。
- `interpreter = null`（uv run 兜底）时：`missingInEnv` / `envDrift` / `declaredMissing`（E1/E2/E3，需环境内容对比）置为空；`lockOutOfDate`（E5，仅 `pyproject.toml` ↔ `uv.lock` 文件比对，不依赖解释器）**照常计算**；`undeclared`（E4）与 `style` 有效——UI 须显式呈现「未选择解释器，环境侧检测不可用」，但 E5 过期提示（§5.4）在兜底路径仍可用。

---

## 4. 检测设计

### 4.1 代码层探针（已有资产的推广）

现有 `MISSING_IMPORT_SCRIPT`（`env_cmds.rs:794`）从单文件推广为全工作区：

- 输入：工作区根 + 目标解释器；
- 遍历 `*.py`（复用 `watcher.rs` 的 `WATCH_IGNORED` 清单，剔除 .venv/.git 等）；
- AST 收集**全部** import（含函数体内，标 `lazy`），`find_spec` 探测可解析性；**行为变更**：现有 `MISSING_IMPORT_SCRIPT`（`env_cmds.rs:794`）对 `FunctionDef/AsyncFunctionDef/Lambda` 子树执行 `continue`（整棵跳过函数体），新探针须改为进入函数体收集并标 `lazy`，否则 `missingInEnv[].lazy` 恒为空；
- 模块 → 发行版名：探针内一次性 `importlib.metadata.packages_distributions()` 建全表反查，**替换 `envPanel.ts:476` 的 7 项硬编码 `PACKAGE_ALIASES`**（仅保留探针跑不起来时的降级表）；
- 输出：JSON（结构对齐 `DepDiff` 的代码层字段）。

**增量缓存**（M4）：按文件 mtime 缓存 AST 结果，未变文件不重扫。全量扫描仅在工作区打开 / 手动刷新 / 环境变化时发生。

**性能红线**：全量扫描必须 ≤ 2s（bench 集回放验证）；探针超时（10s）降级为「仅当前打开文件」快路径。

### 4.2 声明层解析

判定顺序固定（取首个命中，无歧义）：**external → pyproject → requirements → bare**（v1.3 修订，理由见 §11）。

| style 判定 | 依据 |
|---|---|
| `external` | 存在 `poetry.lock` / `Pipfile` / `pdm.lock` / `environment.yml`（**先于 pyproject / requirements 判定**：poetry/pdm 项目必带 pyproject.toml，锁文件是「谁拥有声明层」的强信号；附带 requirements.txt 也按 external 处理，避免双重声明打架。代价：uv 迁移后残留旧锁文件的项目被判 external——边界横幅正好提示清理锁文件完成迁移） |
| `pyproject` | 根目录存在 `pyproject.toml`（读 `[project] dependencies` / `[tool.uv]`；uv workspace 暂不解析成员，M4 评估） |
| `requirements` | 无外部管理器锁文件且无 pyproject，且存在 `requirements*.txt`（多文件时全部纳入声明集；主文件 = requirements.txt 优先，否则字母序首个） |
| `bare` | 以上皆无（现有 `has_pyproject` 横幅已是此逻辑的 UI 投影） |

- E5 检测：`uv lock --check`（uv ≥ 0.4.x 支持；**0.10.11 实测口径**：最新 exit=0；过期 exit=1 且输出含 "needs to be updated"——仅认此文案为过期，其余非零（网络/索引/版本问题）降级为不检测，不阻断）。仅当 `pyproject.toml` 与 `uv.lock` **均已存在**才检查（无 lock 文件 = 用户未采用 lock 工作流，不报过期）。**前置校验**：`ci/versions.toml` 锁定 uv = 0.10.11 ≥ 0.4.x ✅（M1 已核对）。

#### 4.2.1 包管理器画像与边界提示（防「误判 bug」，v1.1）

**pip 全兼容声明**：pip 装包写的是同一个 site-packages，`uv pip list` 照样可见——E1（缺失检测）、E3（漂移检测）、终端嗅探（正则覆盖 pip 完成标志）、引擎重启级联对 pip **完全生效**。pip 用户唯一可感知的差异是「pip 不写声明文件」，而这正是 E3 会报出并给出 `uv add` 收敛动作的**正常行为，不是 bug**。此兼容性须写进用户可见文案（横幅 / 面板 tooltip：「pip 安装的包同样被检测；建议统一用 uv 管理依赖」）。

**外部管理器（poetry / pipenv / pdm / conda）**：锁文件格式我们不解析，声明侧对比（E2/E4/E5）与漂移收敛（E3）**主动禁用**而非给出错误结果；健康面板顶部显示边界横幅：

> 「Montauri 以 uv 管理依赖（一致性检测 / 一键修复）。检测到 poetry.lock——本项目的声明层检测已降级，仅环境可用性（缺失 import）生效。建议迁移到 uv。」

**动机**：用户在终端 `poetry add x` 后，若编辑器无任何表示（红线依旧、诊断不刷新），会被当成我们的 bug。显式声明「这类项目我们只管环境不管声明」，把沉默的失效变成有解释的边界。

**嗅探范围刻意收敛**：终端完成摘要只嗅探 uv 与 pip；poetry/pdm 输出格式不稳定且项目本身不支持，不装懂。

**conda 识别限制**：conda 检测仅靠根目录 `environment.yml` 存在性，实际多数 conda 项目不在项目根放此文件（靠 `conda activate`），此类项目会 fallthrough 到 `bare`——属已知边界而非识别 bug，不深度适配（§1.3）。

### 4.3 环境层快照

- `uv pip list --format=freeze`（复用 `list_packages_impl`）。
- 快照对比：`env-changed` 触发后先 `uv pip list` 对比，**变了才级联**（防抖 + 真值对比，误报不重启引擎）。

### 4.4 失效矩阵（机制灵魂）

| 层 | 失效信号 | 实现落点 |
|---|---|--- dep |
|---|---|---|
| 代码层 | 文件 watcher 的 `.py` 事件（增量：只重扫该文件） | `watcher.rs` 已转发 `fs-changed`，`depHealth.ts` 消费 |
| 声明层 | `pyproject.toml` / `requirements*.txt` / `uv.lock` 文件事件 | 同上（现有事件已覆盖，补消费者） |
| 环境层 | ① site-packages 目录监听（`.venv` 例外放行）② 终端完成摘要嗅探（触发器） | `watcher.rs` 加 site-packages 例外；`terminal.ts` 输出流正则 |

**终端完成摘要嗅探**（仅触发器，非真值）：匹配 **uv 与 pip** 的稳定完成标志（uv：`Installed N packages` / `Uninstalled N packages`；pip：`Successfully installed` / `Successfully uninstalled`），命中防抖 2s 后触发重算。覆盖 pip 是刻意的：pip 与 uv 写同一个 site-packages，用户用 pip 装包同样必须被感知（§4.2.1）。正则误报的代价 = 一次多余快照对比，不直接重启引擎。

**site-packages 监听**：现有 `WATCH_IGNORED` 剔除 `.venv` 后对整个 venv 的写事件太密（.pyc 生成等），改为**仅监听 `site-packages` 目录层**的 `RECORD` / `*.dist-info` 变化（notify 的 path filter，防抖 2s）。`.venv` 其余部分维持忽略。

### 4.5 检测时机 × 耗时 × 交互矩阵（v1.1 重写）

先定义耗时级（决定交互形态的唯一依据）：

| 级 | 操作 | 典型耗时 | 特征 |
|---|---|---|---|
| L0 | 纯文件解析（style 判定 / 声明层解析 / 外部管理器检测） | < 50ms | 无子进程，可任意频繁 |
| L1 | 环境快照（`uv pip list`） | 0.3~1s | 1 个本地子进程 |
| L2 | 代码层探针（AST + find_spec） | 单文件 <100ms / 全量 ≤2s | 1 个解释器子进程（红线 2s） |
| L3 | 修复动作（uv add / sync / install） | 3s~60s+ | **联网、不可中断窗口**，交互单独规范（§5.6） |

| 时机 | 动作 | 级 | 交互 |
|---|---|---|---|
| 工作区打开 | style 判定 + 声明层解析 | L0 | 静默；bare/external 立即出横幅（不依赖后续层级） |
| 工作区打开（编排见 §4.7） | L1 快照 → L2 全量探针 | L1→L2 | 状态栏体检图标（转圈，完成即消；点击打开健康面板）；**绝不弹窗**，结果异常才横幅/toast |
| .py 变更/保存 | 增量重扫该文件 + 差量合并 | L2 | 完全静默 |
| pyproject / requirements*.txt / uv.lock 变更 | 声明层重解析；pyproject 变更追加 L1 | L0(+L1) | 静默；diff 变化才更新面板数据 |
| 环境变化信号（嗅探 / site-packages） | L1 快照对比，**有差异才** L2 重算 | L1(→L2) | §5.5 序列：静默 → envDrift 非空 toast 一次（带「查看」） |
| 运行前（`prepareRun`） | 读快照（<30s 新鲜）或单文件探针 | L0 / L2 快路径 | 仅异常时弹确认（现状保留）；预检本身无新 UI |
| 手动刷新（面板） | L0+L1+L2 全量 | L2 | 面板内行内转圈 + 刷新按钮禁用（对齐 `renderPkgLoading` 先例）；不遮罩、不阻塞面板其他分区 |
| 修复动作（确认后） | `dep_fix` | L3 | §5.6 |

**通用红线**：L1/L2 一律后台异步 + 结果驱动 UI（无进度对话框、无模态等待）；任何检测不得阻塞运行/保存/补全主链路——检测是顾问，让路于用户正在做的事。

### 4.6 引擎失效级联（修 bug 顺带落协议）

**规则：任何引起环境层事实变化的操作完成后，必须重启静态引擎并刷新诊断。**

现有三处违反（M1 一并修复）：

| 位置 | 现状 | 修复 |
|---|---|---|
| `envPanel.ts:393` `installPackage` | 装完只刷包列表 | 补 `restartEngine()` |
| `envPanel.ts:240` `selectInterpreter` | 切解释器不重启 | 补 `restartEngine()` |
| `envPanel.ts:457` `upgradePackages` | 升级完不重启 | 补 `restartEngine()` |

> 依据：pyrefly 经 `initializationOptions.pythonPath` 绑定解释器（`client.ts:320`），环境变化后诊断 stale；重启是当前最可靠手段（§8 R3）。

### 4.7 打开工作区时序编排（v1.1，防弹窗叠加）

现状：打开工作区已有一串既有流程——恢复 tabs、startLsp、venv 检测确认（`maybePromptVenv`）、工具链引导弹窗（`maybePromptToolchain`）。体检是**后台数据采集**，优先级低于一切阻塞决策，且绝不与之叠加。

```
t0    openWorkspace 既有流程照常（startLsp / venv 提示 / 工具链引导）
t0    L0 同步先行：`dep_style` 同步命令做 style 判定（bare/external 横幅此刻即可出，零子进程）
t0+1.5s  若无弹窗在前台 → 启动 L1 → L2（串行；有弹窗则推迟到其关闭，轮询间隔 500ms）
t0+~4s    diff 就绪：E 组异常 → 横幅/toast（按 §6.2 规则）；正常 → 仅状态栏图标熄灭
```

规则：

1. **弹窗优先**：任何 openConfirm 在前台时体检排队等待（用户决策优先于数据采集）；
2. **会话去重**：横幅/toast 按工作区+状态哈希去重（`venvPrompted` 模式推广为 Set，同一状态一会话只提示一次）；
3. **结果落地**：体检完成写输出面板一行摘要（M1 起），异常项归健康面板；
4. 切换工作区时在途体检结果按 `pkgToken` 同款令牌丢弃（防旧工作区数据污染新面板）。
5. **横幅分阶段**：bare/external 横幅与 E 组横幅为 M3 形态；M1 阶段 §4.7 仅落地 L0 判定 + 输出面板「依赖体检」摘要行，不弹横幅（见 §7 M1「无横幅无弹窗」）。

---

## 5. 修复设计

### 5.1 动作矩阵（每条断边一个收敛动作）

| 断边 | 动作 | 命令 | 幂等 |
|---|---|---|---|
| E1 代码 ⊄ 环境 | 装缺失包 | style=pyproject → `uv add <dists>`；requirements/bare → `uv pip install <dists>` | ✅ |
| E2 声明 ⊄ 环境 | 同步环境 | pyproject → `uv sync`；requirements → `uv pip install -r <file>` | ✅¹ |
| E3 环境 ⊄ 声明 | 声明漂移收敛 | `uv add <dists>`（把裸装包写入声明） | ✅ |
| E4 代码 ⊄ 声明 | 补声明 | `uv add <dists>` | ✅ |
| E5 lock 过期 | 刷新锁 | `uv lock` | ✅ |
| style=requirements 迁移 | 一次性 | `uv add -r requirements.txt`（只读它、写 pyproject；不改原文件，可回退） | ✅ |

> ¹ `uv sync` 会按 lock **移除环境中未声明的包**（即 §5.4 所述「隐式同步」坑），确认弹窗须明示影响面，不可仅以「幂等」一带而过。

### 5.2 统一收尾协议（硬规则）

所有修复动作完成后，按序执行且全部必达：

1. **重算 diff**（验证收敛效果，更新快照）；
2. **`restartEngine()`**（刷新诊断）；
3. **toast 反馈**（成功 `toast(msg, "success")` / 失败 `toastFail(action, e)`；详细日志走输出面板 `appendOutputLine`）。

> 对齐既有反馈技术债决议（memory ID 61552154）：即时结果统一 toast，输出面板保留作详细记录。

### 5.3 确认策略

- **默认确认**：所有修复动作执行前弹 `openConfirm`（环境是用户资产，编辑器是顾问不是管家）；
- **批量预览**：健康面板的「一键修复」先列出将执行的命令清单（含 `uv add` 将写入的包列表），确认后逐条执行、失败即停；
- **忽略**：面板行级「忽略此包」→ 写入工作区忽略清单（`<data_root>/workspaces/<hash>.json` 扩展字段，复用解释器配置存储先例）；忽略项在 diff 计算后过滤，手动刷新时可视。

### 5.4 运行前预检升级（消费 diff）

`prepareRun`（`runFlow.ts:103`）的检查改为：

- 有 diff 快照且新鲜（< 30s）→ 直接用 `missingInEnv` 中该文件的条目（避免运行前再 spawn 探针）；
- 快照过期/缺失 → 保留现有 `check_missing_imports` 单文件快路径；
- `uv run` 兜底路径新增：`lockOutOfDate` 或 E2 严重（声明依赖大量缺失）时提示「uv run 将按 lock 隐式同步环境，可能移除您手动安装的包」——这是反馈场景里最反直觉的坑，必须显性化。

---

## 5.5 环境变化信号的自愈边界（评审定案）

环境变化信号（终端嗅探 / site-packages 监听）触发后的**固定收敛序列**，不询问、不装包：

1. `uv pip list` 快照对比（真值判定）；
2. 有差异 → 重算 diff → 若 `envDrift` 非空，**toast 提示**「检测到环境与声明不一致（N 个包未声明）」+ 「查看」按钮打开健康面板；
3. 无差异 → 仅静默更新内部快照。

> 边界：环境侧被动感知**永远不自动执行任何写操作**（装/卸/声明写入），写操作只源于用户在面板/灯泡/预检的显式动作。嗅探正则误报的代价封顶为一次快照对比 + 一次 toast。

### 5.6 L3 修复动作交互规范（v1.1）

L3 = 联网 + 秒级到分钟级 + uv 进程不可中断，交互单独定规范：

1. **确认前置**：`openConfirm` 列出将执行的命令与影响包清单（§5.3），文案注明「需联网，耗时取决于网络」；
2. **进度可见**：确认后自动展开底部输出面板（对齐工具链引导先例 `$("bottom").classList.remove("collapsed")`），uv 输出经 `pip-stdout/pip-stderr` 事件流式滚动——**这是唯一的进度指示，不做进度条**（uv 无机器可读进度协议，假进度条是谎言）；
3. **防重入**：触发按钮 `setBusy`（装中…），面板内同类动作按钮同步禁用；**后端会话互斥锁**（同一时刻仅一个 `dep_fix` 在跑）——uv 自身对 lock 有文件锁，并发 `uv add` 必然报错，提前挡住而不是让用户看到 uv 的报错；
4. **取消语义**：不提供取消按钮（uv 进程中途 kill 会留半态环境）；文案如实告知「安装完成后按钮自动恢复」；
5. **失败处理**：失败即停（批量动作不继续后续命令）+ `toastFail` + 输出面板保留 exit code 全文；半态环境由下一次 diff 重算如实呈现（不掩盖）；
6. **完成收尾**：统一收尾协议三步（重算 → restartEngine → toast）在 L3 结束后原子执行——用户看到 toast 时诊断已刷新。

---

## 6. UI 设计

### 6.1 健康面板（环境面板升级）

形态：环境面板（`#env-modal`）内新增「依赖健康」分区（v1 不做独立侧栏，对齐「最小闭环」）。

三个视图（tab 切换，默认「按断边」）：

1. **按断边**（默认）：E1~E5 分组列表，每组一行摘要 + 展开明细（模块/包/文件:行），行级动作按钮（修复 / 忽略）+ 组级「全部修复」；
2. **按文件**：`missingInEnv` / `undeclared` 按文件聚合（点文件名跳转 `gotoFromLink`）；
3. **已忽略**：忽略清单管理（移除即恢复检测）。

顶部常驻：`style` 徽章（pyproject / requirements / bare / **external**）+ 解释器 + 上次扫描时间 + 刷新按钮。

**external 徽章交互**：hover tooltip 显示边界说明（§4.2.1 横幅文案）；点击展开「为什么只显示部分检测 + 迁移到 uv 的建议」。bare 徽章同理链接到「生成 pyproject.toml」（复用现有 `env-pyproject-banner` 横幅动作）。

### 6.2 健康横幅（反馈 1/2 的直接解）

触发条件与优先级（同一时刻最多一条，高优先级胜出）：

| 优先级 | 触发 | 文案要点 | 主按钮 |
|---|---|---|---|
| 1 | `style=external` | 「检测到 poetry.lock——Montauri 以 uv 管理依赖，声明层检测已降级（仅缺失 import 生效）」 | 「了解迁移」 |
| 2 | `style=bare` | 「无 pyproject.toml / requirements.txt，建议用 uv 声明依赖（可生成最小 pyproject）」 | 「生成 pyproject.toml」（复用 `init_pyproject`） |
| 3 | E2 非空（含 `requirementsUninstalled` 表达的「整个 requirements 未安装」） | 「N 个已声明依赖未安装」 | 「安装缺失依赖」/「同步环境」/「迁移到 pyproject」 |
| 4 | `envDrift` 非空 | 「检测到 N 个包已安装但未声明（pip 安装不写入声明属正常现象）」 | 「查看」/「写入 pyproject」 |

**uv 建议的持续存在感**（评审关注点 ②）：不只靠横幅——状态栏解释器芯片的 tooltip、健康面板顶部常驻一行小字「Montauri 使用 uv 管理依赖 · pip 安装同样可检测（但不写入声明）」、`pip_install` 走非 uv add 分支时的输出面板提示（现有「仅安装到解释器环境（不记录依赖）」文案升级为「建议改用 uv add 或在终端使用 uv pip install，保持声明同步」）。让用户在任何入口都能看到「我们在用 uv」这一事实。

位置：环境面板顶部（非编辑器顶栏，无多通知栏框架）。同会话内同状态去重（复用 `venvPrompted` 模式）。

### 6.3 灯泡升级（M3）

`buildInstallActions`（`client.ts:1002`）数据源从「当前文件 markers」升级为 diff：

- E1 → 「安装 X」保留；E4 → 新增「安装并加入 pyproject」；E3 → 新增「将 X 加入 pyproject」；
- 诊断 → 包名解析改用 diff 的 dist 归一结果（不再依赖 marker 消息正则 + 硬编码别名）。

### 6.4 运行时兜底（M4）

traceback 出口（`tracebackLink.ts`）识别 `ModuleNotFoundError: No module named 'X'` → toast + 「安装 X」按钮（复用修复矩阵 E1 动作 + 收尾协议）。

### 6.5 反馈技术债对齐

- 所有即时反馈走 toast（不新增 `appendOutputLine`-only 分支）；
- 新增 `<input>` 一律 `autocomplete="off"`（memory ID 67600367）；
- 健康面板含包列表操作（卸载确认等），模态交互规则对齐 runConfigPanel 范式（点遮罩不关闭 + Esc）。

---

## 7. 分阶段任务

### M1 —— diff 骨架 + 协议落地（修 bug 顺带）

**状态**：✅ **已交付**（2026-09-16，main 三笔提交 `f9d6a56`(PR1) / `89429ac`(PR2) / `a5605bf`(PR3)）。
验证：`cargo test` 146/146（dep 域 44 项 + bench harness ignored）· `tsc` 0 错 · `depHealth.test.ts` 13/13 · bench 摸底全链路 637~927ms < 2s 红线。落地口径修订与实施决策见 §11 v1.3 ①~⑬。

**范围**：`DepDiff` 契约 + `dep_style` / `dep_scan` 命令（分别 L0 同步判定 / L1+L2 全量计算）+ 统一收尾协议三处 bug 修复 + 工作区打开体检（结果暂只进输出面板日志，无 UI）。

- [x] `env_cmds.rs`：`dep_style(workspace_root) -> DepStyle`（纯 fs 文件存在性检查，同步/零子进程，返回 `style` / `externalManager` / `requirementsFile`）——判定序按 v1.3 ① 改为 **external 优先**
- [x] `env_cmds.rs`：`dep_scan(workspace_root) -> DepDiff`（spawn_blocking + 探针 10s 超时红线，内部复用 `detect_style` 填 `style`）；探针脚本（代码层全量 + packages_distributions 反查 + Rust 侧别名表兜底 + <3.10 显式降级 v1.3 ⑬）；声明层解析（pyproject 五段 + requirements 多文件，E2 同步范围/E3 排除清单 v1.3 ②③）；**外部管理器检测（lock 文件存在性 → style=external）**；环境层快照对比（dep 域宽容 freeze 解析，`name @ url` editable 归一）；**mtime 增量缓存骨架（只缓存 AST、解析每次重算）+ 2s 红线 bench 摸底已随 M1 落地**（`cargo test bench_dep_scan -- --ignored --nocapture`）
- [x] `envPanel.ts`：`installPackage` / `selectInterpreter` / `upgradePackages` 补 `restartEngine()` ——审计扩展至 **5 处**（+`createVenv`/`uninstallPackages`，v1.3 ⑩），统一收敛为 `afterEnvChanged()`（作废 diff 快照 + 重启引擎，v1.3 ⑫；灯泡 `installMissingPackage` 一并接入）
- [x] 工作区打开时后台体检（按 §4.7 编排：L0 先行、弹窗 500ms 排队轮询、令牌丢弃；结果进输出面板「依赖体检」摘要行，无横幅无弹窗）——**落点微调**：编排在 `depHealth.ts::runOpenWorkspaceCheck`（新域模块，M2 复用），`main.ts::openWorkspace` 以 void 接线，非 envPanel.ts 承载
- [x] `runFlow.ts`：`prepareRun` 接 diff 快照（新鲜**且解释器匹配**则复用 E1 条目并过滤 lazy v1.3 ⑪⑫，过期/不匹配走单文件快路径）；uv run 兜底新增隐式同步风险提示行（§5.4，会话去重）
- [x] 测试：探针集成测试（stdlib/local/site/missing 分类、惰性导入标 lazy、相对导入跳过）+ `dep_scan` 端到端 ×4（bare/pyproject/external/requirements，含 interpreter=null 契约行为）+ 打开编排（弹窗在场排队、令牌丢弃、失败降级留 L0 事实行）+ 纯函数单测（E1~E5 计算/归一化/声明解析/别名兜底）
  - ⚠️ 「协议回归（装包后诊断刷新）」**未自动化**（依赖真实引擎 + uv 环境）：代码已落地（`afterEnvChanged`），归 §9.1「基线：环境面板装包/切解释器」手工验收项，M3 收尾协议测试一并补

### M2 —— 失效矩阵

**状态**：✅ **已交付**（2026-09-16，main 三笔提交 `67aecb8`(实现) / `c11a696`(文档) / `ca869ad`(自查修复)）。验证：`tsc` 0 错 · `vitest depHealth.test.ts` 25/25（M1 13 + M2 12）· `cargo test watcher::` 4/4 · `cargo test dep_` 6 passed/1 ignored（bench）。落地口径见 §11 v1.4 ①~⑥。

**范围**：三层失效信号接线 + 重算级联。

- [x] `depHealth.ts`：失效信号消费——域模块与 diff 状态管理（快照/新鲜度/解释器匹配/令牌丢弃/复位）已随 M1-PR2 落地（`89429ac`）；M2 补 `handleDepFsChanged`（消费新 `dep-fs-changed` 文件级事件，.py/声明文件防抖 1s 全量重算——per-file 增量留 M4）+ `scheduleEnvCheck`/`handleEnvSignal`（§5.5 序列）+ `sniffTerminalOutput` + `wireDepHealthEvents` + `initDepHealth`（注入 restartEngine）
- [x] 终端完成摘要嗅探：落 `termUi.ts` 的 term-data 分发点（**非 terminal.ts**——分发在此，同 `watchUvicornLine` 先例）；uv（`Installed/Uninstalled N packages`）+ pip（`Successfully installed/uninstalled`）正则 + 跨块尾缓冲；命中 → `scheduleEnvCheck`（防抖 2s）；命令 echo 不含完成短语天然不误触发
- [x] `watcher.rs`：site-packages 例外监听——`is_site_packages_signal`（含 `site-packages` 组件且其下有 `*.dist-info` 或文件名 `RECORD`，滤 `.pyc`/包内 `.py` 噪声）→ `dep-env-changed` 事件；`.venv` 其余维持忽略。另新增 `dep-fs-changed` 事件（`classify_dep_file`：py/declaration/other，other 不发）
- [x] 级联规则：环境信号 → `dep_env_snapshot` L1 快照对比真值判定（`sameSnapshot` 顺序无关）→ **有差异才** `runDepScan`（L2）+ `restartEngine`（§4.6/反馈 3-4）；无差异静默更新基线；代码/声明层信号 → 防抖全量重算（不重启引擎，pyrefly 自感知 .py）；打开工作区体检后 `captureEnvBaseline` 建基线（防首次信号误判有差异）
- [x] 后端：新增 `dep_env_snapshot(workspace_root) -> Vec<PackageInfo>`（async + spawn_blocking，解释器解析与 `dep_scan` 同源 `get_interpreter`，无解释器返回空）
- [x] 测试：防抖合并/去重（命令 echo 不触发）/ 跨块截断命中 / 快照有差异级联·无差异不级联·失败不级联 / fs 分类触发（py·declaration 触发、other 不触发）/ site-packages 误报（.pyc 不触发，Rust 侧）

### M3 —— 健康面板 + 横幅 + 灯泡升级

**状态**：✅ **已交付**（2026-09-16，main 三笔提交 `3aa4b36`(PR1 Rust) / `c5d7caa`(PR2 面板) / `d0572d3`(PR3 灯泡+收尾)）。
验证：`cargo test` 163/163 + 1 ignored（bench；dep 域新增 17 项：plan_dep_fix 动作矩阵 / 忽略归一化·容错·过滤）· `tsc` 0 错 · `vitest` 405/405（45 文件；depHealth 45 项 = M1 13 + M2 12 + M3 20，depHealthPanel 新文件 20 项）。落地口径修订与实施决策见 §11 v1.5 ①~⑨。

**范围**：UI 投影与修复矩阵。

- [x] `depHealthPanel.ts`：三视图 + 行级动作 + 忽略管理（存储复用 workspaces/<hash>.json 的 `dep_ignored` 字段）——三视图按 §6.1 口径（按断边/按文件/已忽略，v1.5 ①）；忽略**后端统一过滤**（v1.5 ②）；external 时 E2~E5 显示「已降级」而非空列表（§9.1）；interpreter=null 显式呈现「环境侧检测不可用」（§3.3）
- [x] 健康横幅四级优先级（含 external/bare 边界横幅，原 env-pyproject-banner 退役并入优先级 2，v1.5 ⑤）+ `pip_install` 非 uv add 分支文案升级（§6.2，随 PR1 落地）+ uv 建议持续存在感三处（解释器芯片 tooltip / 面板常驻小字行 / pip 分支文案）+ 状态栏体检图标（§4.5：转圈→完成即消/异常驻留，点击开面板）
- [x] 灯泡：diff 数据源 + E4「安装并加入 pyproject」新动作（`DECLARE_PACKAGE_COMMAND`）+ E3 收敛口径（v1.5 ③）+ `PACKAGE_ALIASES` 硬编码退役（Rust `DIST_ALIAS_FALLBACK` 唯一兜底）；marker 路径保留为兜底并按模块去重
- [x] 修复动作矩阵全部落地（`dep_fix` 单命令 + action 枚举 install/sync/declare/lock/migrate，v1.5 ④）+ 统一收尾协议（重算 diff → 刷新环境基线 → restartEngine → toast，失败路径也重算如实呈现半态）+ §5.6 L3 交互（前后端双互斥 / .dep-fix-btn 统一禁用 + setBusy / pip-stdout·pip-stderr 流式输出 / 失败即停 / uv sync 破坏性警示走 danger 确认）+ envPanel `afterEnvChanged` 升级完整协议、五处环境操作补成功/失败 toast（v1.5 ⑧）
- [x] requirements 迁移引导（`uv add -r`，只读原文件；缺 pyproject 时后端先幂等生成最小模板；横幅优先级 3 + 面板「迁移建议」行双入口）
- [x] 测试：三视图渲染（五组/降级/按文件聚合/忽略清单）· 横幅四级优先级 · 确认与忽略流（拒绝不执行/dep_ignore_add·remove + 重扫）· 收尾协议完整性（dep_fix → dep_scan → dep_env_snapshot → restartEngine 顺序锁）· runDepFix 失败即停/异常兜底/防重入 · depActionsForLine / groupFixPlan 纯函数 · toast 会话去重
  - ⚠️ 「协议回归（真实引擎装包后诊断刷新）」仍属 §9.1 手工验收项（自动化锁定的是收尾**调用顺序**，真实 pyrefly + uv 环境不进 vitest）

### M4 —— 精度与体验

**状态**：✅ **已交付**（2026-09-16，main 三笔提交 `8d0b010`(PR1 Rust) / `05e3aa4`(PR2 TS) / `492f884`(PR3 bench+文档)）。
验证：`cargo test` 169/169（168 passed + 1 ignored bench；dep 域新增 5 项：多候选透传 / 候选兜底 / scope 路由 / resolution 缓存失效与代次守卫 / 环境快照缓存）· `tsc` 0 错 · `vitest` 414/414（45 文件；depHealth 45→54：scope 分流 / lazy 提示 / traceback 检测 / 候选选择 / 批量候选告知）· bench 红线回放 `large_repo` 880ms ≤ 2s。落地口径定案见 §11 v1.6；交付后复核修复 4 项（缓存键 / 代次竞态 / 批量候选告知 / shell 会话覆盖）见 §11 v1.6 ⑦。

- [x] 惰性导入降级策略（lazy 条目不阻塞运行预检）——定案「纯输出面板 hint」：`prepareRun` 有新鲜快照时输出一行「N 个惰性导入未安装（不阻塞运行）：a L3、b L20」（`lazyHintLine`/`lazyMissingForFile`，会话去重）；预检确认框不碰（v1.6 ①）
- [x] 全项目扫描增量缓存（mtime + AST 缓存）——升级为「完整增量」：resolution 按探针解释器进程级缓存（full 扫描前作废，环境变化正确性优先）+ `dep_scan` 增设 `scope` 参数（`full`/`code`/`declaration`）+ 环境快照缓存（code 范围复用，跳过 uv pip list）；前端 `handleDepFsChanged` 按 .py/声明/混合分流 scope（v1.6 ②）
- [x] traceback ModuleNotFoundError → 一键安装（§6.4）——`handleTracebackLine`（term-data 分发点按行喂入 + 输出面板 stderr 行经 `setOutputTracebackHandler` 注入）→ toast error +「安装」按钮 → `installMissingPackage`（复用 E1 install + §5.2 收尾协议 + M4-4 候选选择）；会话去重 + resetDepHealth 清空（v1.6 ③）
- [x] 忽略清单 UI 完整化 + dist 名歧义处理——忽略清单 M3 已完整交付（三视图/行级忽略/恢复/后端过滤）；dist 歧义定案「安装时弹候选选择」：探针输出 `distCandidates` 多候选数组（契约字段只增不删），行级/灯泡安装时 len>1 弹 `resolveDistForInstall`（openChoice 双候选快捷位，>2 列出全部+手动安装提示，取消=不执行）（v1.6 ④）
- [x] uv workspace（monorepo）成员解析评估——评估结论：bench 集与已知用户场景无 workspace 需求案例，暂不实施（根 pyproject 只读维持 M1 口径；出现真实需求案例再立项，v1.6 ⑤）
- [x] 性能红线验收：全量扫描 ≤ 2s（bench 集回放）——新增 `sample/large_repo/`（88 文件 × 4 层深目录，惰性/相对/重复 import 全形态 + uv.lock）：release 回放 **880ms ≤ 2s 达标**；已知边界：E5 `uv lock --check` 首轮联网冷缓存可致单次 3s+（errors 样例实测 3243ms，warm 回落 823ms），属 §10 风险 1 已知特性非红线违例（v1.6 ⑥）

---

## 8. 关键决策记录（评审预置）

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| R1 | 检测真值唯一化 | 所有依赖检测收敛到 `dep_scan` 一处 | 现有四处散检测（灯泡/预检/pip_install 分流/包列表）是漂移之源 |
| R2 | 环境变化感知通道 | 终端嗅探（触发器）+ site-packages 监听（兜底），真值以 `uv pip list` 对比为准 | 单通道不可靠（外部终端装包嗅探不到；watcher 全 venv 太密）；双通道互补且误报代价封顶 |
| R3 | 引擎刷新方式 | `restartEngine()`（杀旧拉新），不做 didChangeWatchedFiles 转发 | pyrefly 绑定解释器且对环境变化无感知协议；重启 ~500ms 可接受；LSP 桥加注册转发成本高收益低 |
| R4 | requirements 项目策略 | 迁移引导而非原地维护 | 不替用户改 requirements.txt（可回退）；pyproject 是统一终态（uv 语义完整） |
| R4.1 | 迁移后原 requirements.txt | **保留不动**（不删除、不改写） | 用户资产；可能被 CI/其他工具链引用 |
| R5 | 修复触发方式 | 全部显式确认，无静默写 | 环境是用户资产；对齐「编辑器是顾问不是管家」 |
| R6 | 模块归属 | `shell/src-tauri` dep 域 + TS `depHealth.ts`，不建独立包 | 编排耦合 Tauri 进程管理（spawn/事件/超时），独立包违反最小闭环 |
| R7 | dist 归一 | `packages_distributions()` 全量反查 | 7 项硬编码覆盖不了 cv2/sklearn 之外的长尾；探针跑在目标解释器里天然准确 |
| R8 | 快照新鲜度 | 30s 内复用 | 运行预检复用与重算的成本折中 |
| R9 | ignore 存储 | `<data_root>/workspaces/<hash>.json` 扩展字段 | 复用解释器配置存储先例（`env_cmds.rs:77`），不侵入用户项目 |
| R10 | pip 兼容口径 | **全兼容**：E1/E3/嗅探/引擎级联对 pip 生效；pip 不写声明是 E3 的正常输入而非 bug | pip 与 uv 写同一 site-packages；刻意覆盖 pip 嗅探，用户用 pip 装包必须被感知 |
| R11 | 外部管理器（poetry/pipenv/pdm/conda） | **显式降级**：style=external，E2~E5 禁用（不给错误结果），仅 E1 环境可用性生效 + 边界横幅 + uv 迁移建议 | 锁文件不解析；沉默的失效会被用户误判为 bug，显式边界比假装支持诚实 |
| R12 | 检测耗时红线 | L0 <50ms / L1 <1s / L2 ≤2s（探针 10s 超时降级）；L1/L2 后台异步无模态，L3 单独交互规范（§5.6） | 检测是顾问不是路障；uv 无进度协议，不做假进度条 |
| R13 | 体检与既有弹窗的关系 | 体检永远排队（弹窗优先，500ms 轮询重试）；横幅/toast 会话去重 | 打开工作区已有 venv 确认 + 工具链引导两串弹窗，体检再叠加即弹窗风暴 |

---

## 9. 验收标准

### 9.1 功能验收（对照用户反馈场景）

| 场景 | 预期 |
|---|---|
| 反馈 1：requirements 老项目 + 新建 .venv | 打开工作区 → 横幅「检测到 requirements.txt 未安装」→ 一键安装/迁移 → 运行成功 |
| 反馈 2：`uv pip install -r` 后 pyproject 不同步 | 健康面板 E3 分组显示漂移包 → 「写入 pyproject」→ `uv add` 后 diff 清零 |
| 反馈 3：不在 requirements 里的依赖 | 体检 E1 分组列出（含文件:行）→ 安装 → 运行不再 ImportError |
| 反馈 4：终端装包编辑器不感知 | 终端 `uv pip install` **或 `pip install`** 完成 → 2s 内 diff 重算 → 红线随 restartEngine 消失 |
| 基线：环境面板装包/切解释器 | 诊断立即刷新（协议回归） |
| 基线：uv run 兜底 + lock 过期 | 运行前显式提示隐式同步风险 |
| 边界：poetry 项目 | 打开即出边界横幅（非沉默）；E1 仍可用；E2~E5 显示「已降级」而非空列表 |
| 边界：pip 用户心智 | 面板/tooltip 可见「pip 安装可检测但不写声明」说明；pip 装包触发 E3 提示而非无反应 |
| 交互：打开工作区弹窗叠加 | venv 确认 + 工具链引导在场时体检排队，无第三弹窗；体检全程仅状态栏图标 |
| 交互：L3 修复耗时 | 确认后输出面板流式滚动；按钮 busy + 后端互斥；失败即停 + toastFail；完成 toast 时诊断已刷新 |

### 9.2 工程验收

- `tsc` 0 错误；`vitest` 全绿（新增测试随 M1~M4 交付）；
- `cargo test`（env_cmds dep 域）全绿；
- 全量扫描 ≤ 2s（bench 集回放）；探针超时降级路径可用；
- 误报控制：命令 echo / .pyc 写入不触发级联（M2 测试项）；
- 反馈技术债对齐检查（toast / autocomplete / modal 范式）。

---

## 10. 风险与开放问题

| # | 风险/问题 | 应对 |
|---|---|---|
| 1 | `uv lock --check` 需要网络（索引校验） | 失败降级为不检测 E5，不阻断；M4 评估 `--offline` |
| 2 | `packages_distributions()` 在部分解释器（<3.10 目标环境）不可用 | 探针内 try/except 降级到内置别名表（保留现有 7 项作 fallback） |
| 3 | site-packages 监听在 Windows 的 inode 事件语义 | M2 spike：实测 dist-info 写入时序，必要时放宽到目录级事件 |
| 3.1 | 探针进程存活期间用户删除/切换解释器 | 探针 spawn 前快照解释器路径，完成后核对不一致则丢弃结果（防 stale 写入） |
| 4 | uv workspace（monorepo）声明集跨成员 | M1 明确不支持（只读根 pyproject），M4 评估 |
| 5 | 巨型仓库全量扫描性能 | mtime 增量缓存 + ≤2s 红线 + 超时降级单文件 |
| 6 | 检测与 pyrefly 诊断打架（双真值） | 边界：diff 只服务修复动作，不往编辑器塞第二套诊断（渲染权在静态引擎） |

---

## 11. 实施反馈修订记录

（预留：实施 spike / 验收反馈驱动的修订，对齐 debug plan v1.1~v1.3 的修订惯例）

- **v1.1（2026-09-16，评审反馈）**：① 耗时交互：§4.5 重写为时机×耗时（L0~L3）×交互矩阵（红线：L1/L2 后台异步无模态、检测让路主链路），新增 §4.7 打开工作区时序编排（弹窗优先 / 会话去重 / 令牌丢弃，防与 venv 确认 + 工具链引导叠加成弹窗风暴），新增 §5.6 L3 修复交互规范（流式输出即进度、后端互斥锁、失败即停、不做假进度条）；② uv 主推边界：DepDiff 增 `external` style + `externalManager`，新增 §4.2.1 包管理器画像（pip 全兼容且嗅探覆盖 pip / poetry 等显式降级 + 边界横幅），§6.2 横幅改四级优先级 + uv 建议持续存在感（状态栏 tooltip / 面板常驻行 / pip 分支文案升级），决策 R10~R13，验收增 4 条边界/交互场景。
- **v1.2（2026-09-16，二次评审核实）**：① 修正 E5 语义矛盾——`lockOutOfDate` 不依赖解释器，`interpreter=null` 时**照常计算**（仅 E1/E2/E3 环境侧置空），§5.4 兜底路径提示由此可用；② 拆分命令——新增 `dep_style`（同步零子进程）与 `dep_scan`（异步全量），消除「L0 先行」与「单命令 dep_scan」的架构冲突；③ 明确 style 判定唯一序 `pyproject → external → requirements → bare`；④ DepDiff 增 `requirementsUninstalled` 字段；⑤ 补 `packages_distributions` 覆盖率降级、E2 `uv sync` 破坏性脚注、E5 前置 ci 校验、探针行为变更说明、增量缓存 M1 提前、conda 识别边界。
- **v1.3（2026-09-16，M1 实施反馈，PR1 落地时定案）**：
  ① **style 判定序改为 `external → pyproject → requirements → bare`**：poetry/pdm 项目必有 pyproject.toml，v1.2 字面序会将其判为 pyproject（`[project] dependencies` 解析为空 → 全部已装包被误报 E3 漂移，§9.1「poetry 项目出边界横幅」验收不成立）。锁文件是「谁拥有声明层」的强信号，与 §4.2.1「附带 requirements.txt 也按 external」同理推广；代价（uv 迁移残留锁文件被误判）由边界横幅自然提示清理。
  ② **E2 收窄为「同步范围」**：只查 uv sync / pip install -r 默认会装的声明（`[project].dependencies` + `[tool.uv].dev-dependencies` + `[dependency-groups].dev`；requirements 项目 = 全部行）；extras 与非 dev groups 是 opt-in 安装，缺了不报 E2，但进 E3/E4 的「已声明排除全集」。`requirementsUninstalled` 口径 = 声明集与环境快照**零交集**（部分安装由 E2 逐条表达）。
  ③ **E3 排除清单扩展**：pyrefly/ruff/debugpy（工具链自装，原计划已有）之外补 pip/setuptools/wheel/uv（Python 环境基础设施包——`python -m venv` 老环境常自带，报漂移纯属噪声）；E3/E4 均排除**项目自身**（uv sync 把项目本体 editable 装进 venv，`name @ file+…` 形态经归一化按名排除）。
  ④ **E4 口径**：仅 resolution=site（三方已装）的 import 进 E4；missing 模块不进（已归 E1，装完若仍未声明自然浮出 E4——避免把拼错的模块名误报成未声明依赖）。dist 反查链：`packages_distributions()` → 内置别名表（原 envPanel PACKAGE_ALIASES 7 项迁入 Rust，M3 前端表退役）→ null。
  ⑤ **E5 口径（uv 0.10.11 实测）**：仅当 pyproject.toml 与 uv.lock 均已存在才检查；exit≠0 且输出含 "needs to be updated" 才判过期，其余非零（网络/索引/版本）降级为不检测。ci 前置校验通过（uv 0.10.11 ≥ 0.4.x）。
  ⑥ **探针形态（实施决策）**：内联 Rust const（沿用 MISSING_IMPORT_SCRIPT 先例，零打包改动）；payload 经临时文件走 argv（复用 run_with_timeout 的并发读 + 超时杀树，规避 stdin 管道死锁）；输出 ensure_ascii 缺省 True（Windows 管道 locale 编码下中文路径安全）；相对导入（level>0）视为一方代码跳过；解析落点四分类 stdlib/local/site/missing 由「origin/搜索路径是否在工作区根下」判定。
  ⑦ **interpreter=null 兜底路径的 E4 精度边界**：探针借用系统 python 跑（AST/local/stdlib 分类不依赖目标环境），site 分类以借用环境近似「像三方」——借用环境缺包的 import 落 missing（兜底路径 E1 置空故不可见），属 §3.3「环境侧检测不可用」的契约行为，UI 须显式呈现（M3）。
  ⑧ **M1 拆分三个子 PR**：PR1 = Rust 检测层（dep_style/dep_scan/探针/声明解析/mtime 缓存骨架/44 项测试/bench 摸底 harness，已落地：bench 样例全链路 637~927ms < 2s 红线）；PR2 = restartEngine 修复 + depHealth.ts + 打开工作区体检（输出面板摘要）；PR3 = prepareRun 接 diff 快照 + uv run 兜底提示。
  ⑨ **已知边界（M1 记录）**：pyproject `dynamic = ["dependencies"]`（setuptools 动态声明）不解析——声明集偏空会致 E3 过报；requirements 行延续反斜杠（`foo \`）不支持；uv workspace 成员不解析（原计划已有，M4 评估）。
  ⑩ **§4.6 审计扩展**：按「任何引起环境层事实变化的操作完成后必须重启静态引擎」总规则复核，违反点实为 **5 处**而非 3 处——`createVenv`（解释器从无到有）与 `uninstallPackages`（卸包后诊断应新增 missing-import）一并修复，M1 全部落地。
  ⑪ **预检 lazy 口径（M1 基线）**：`prepareRun` 消费快照的 E1 条目时**过滤 lazy**——保持旧 `MISSING_IMPORT_SCRIPT`（函数体整棵跳过）的行为基线不回退；「lazy 仅提示不阻塞」的完整降级策略仍按 M4 落地。uv run 兜底的隐式同步风险为**输出面板提示行**（非确认框，§4.5「预检本身无新 UI」），按工作区+状态会话去重，E2 严重阈值取 5（`E2_SEVERE_COUNT`，M3 面板落地时可再校准）。
  ⑫ **快照可信度边界（PR2/PR3 自查修复）**：`prepareRun` 复用快照须满足「新鲜（<30s）**且快照 interpreter == 当前解释器**」（`freshDiffForInterpreter`）——否则切换解释器后（尤其从 uv run 兜底切到实体解释器）复用环境侧为空的旧快照会**漏报**。同时环境层事实变化的 **6 处**操作（面板装/卸/升级/建 venv/切解释器 + 灯泡装包）统一走 `afterEnvChanged()`：作废 diff 快照（防 30s 窗口内复用装包前的缺失清单**误报**）+ 重启引擎；「变化即重算」由 M2 失效矩阵接管，M1 作废后 prepareRun 自动回退单文件快路径（= 改造前行为，无回退风险）。已知代价：作废会连带丢弃在途的打开工作区体检（其结果已不可信，属正确语义）。
  ⑬ **探针版本下限显式化（PR1 自查修复）**：目标解释器 <3.10 时探针**显式 SystemExit**（Rust 降级为空代码层 + warn 日志）——原 `getattr(sys,"stdlib_module_names",frozenset())` 空集兜底在 3.8/3.9 下会把 os/sys 经 find_spec 分类为 site，**E4 误报标准库为未声明依赖**（错误结果比降级更糟）；显式退出与既有 `check_missing_imports` 对 <3.10 的隐性下限（AttributeError → 预检跳过）口径一致（风险 #2 的落地形态）。
- **v1.4（2026-09-16，M2 实施反馈，失效矩阵落地时定案）**：
  ① **fs 失效信号改走文件级新事件**：现有 `fs-changed` 只发变更文件的**父目录**（服务树/git 增量刷新），无法区分 `.py` 与 `pyproject.toml`/`requirements*.txt`/`uv.lock`——§4.4「声明层文件事件现有已覆盖」在文件粒度上不成立。落地：`watcher.rs` 额外 emit `dep-fs-changed`（`Vec<DepFileEvent{path,kind}>`，`classify_dep_file` 分 py/declaration/other，other 不发减噪），**不动 `fs-changed` 契约**（tree/git 消费者与测试零改动）；`depHealth.handleDepFsChanged` 消费，防抖 1s 全量 `dep_scan`（per-file 增量重扫是 M4，M2 先全量+防抖合并）。
  ② **§5.5 L1 真值判定新增轻量命令**：`dep_env_snapshot(workspace_root) -> Vec<PackageInfo>`（async + spawn_blocking，复用 `scan_list_packages`；解释器解析与 `dep_scan` 同源 `get_interpreter`，保证对比同一环境；无解释器返回空）。前端 `handleEnvSignal` 先调此命令拿快照，`sameSnapshot`（顺序无关 name==version 集合相等）与基线对比——**有差异才** L2 `dep_scan` + `restartEngine`，误报代价封顶为一次快照对比（对齐 §4.4/R2）。打开工作区体检后 `captureEnvBaseline` 建基线，防首次环境信号因无基线被误判有差异而多重启一次。
  ③ **终端嗅探落点修正**：计划写 `terminal.ts`，实际 term-data 分发在 `termUi.ts`（同 `watchUvicornLine`/运行历史采集先例）——`sniffTerminalOutput` 挂此，shell 会话（用户手敲 `uv pip install`）与 run 会话均嗅探（正则特异，脚本极少误触发）；uv `Installed/Uninstalled N packages` + pip `Successfully installed/uninstalled`，跨块尾缓冲（256 字符）防完成行被 PTY 分块截断；命令 echo 不含完成短语天然不触发（§9.2 误报控制，已测）。
  ④ **site-packages 例外过滤口径**：`.venv` 整棵在 `WATCH_IGNORED`，故 `is_site_packages_signal` 必须**先于** `should_ignore` 判定（否则 site-packages 事件永不可见）；判据 = 含 `site-packages` 组件且其后有 `*.dist-info` 组件或文件名 `RECORD`——装/卸包必写 dist-info，而 `.pyc`（`__pycache__` 下）与包内普通 `.py` 不含 dist-info，天然滤除（风险 #3 的主形态；Windows inode 语义若漏报，M2 spike 放宽到目录级事件的预案仍在）。
  ⑤ **环境信号级联含 restartEngine**：§5.5 序列原文只列「快照对比 → 重算 diff → toast」，但反馈 3/4（终端装包后红线不消失）的解**必须**重启引擎——按 §4.6 硬规则「环境层事实变化后必须重启静态引擎」，`handleEnvSignal` 判定快照有差异后 `runDepScan` + `restartEngine`（`initDepHealth` 注入 `startLsp`，解环同 envPanel 先例）。代码/声明层信号**不**重启（编辑 .py 不改环境事实，pyrefly 经 LSP 自感知）。
  ⑥ **toast 归属 M3**：§5.5 步骤 2 的 envDrift toast +「查看」按钮依赖健康面板（M3 才有落点），M2 环境信号有差异时**静默**重算 + 重启，toast 随 M3 面板一起落（对齐 §7 M2 范围仅列接线与级联）。
  ⑦ **已知代价（M2 记录）**：面板装包（`afterEnvChanged` 已 restartEngine）后 site-packages 监听会再触发一次 `handleEnvSignal`——此时 diff 快照刚被 `resetDepHealth` 清空，重算属**有益**（重建快照），但 `restartEngine` 会冗余执行一次（~500ms，幂等无害，2s 防抖已合并突发）。外部终端（编辑器外）装包 site-packages 监听不到、嗅探也覆盖不到——属 R2 已知边界，非 M2 缺陷。M3 补充：`runDepFix` 收尾协议已内置 `refreshEnvBaseline`（修复完成即刷新基线），面板路径的这次冗余级联已被吸收，仅纯手动终端装包仍走完整 §5.5 序列。
- **v1.5（2026-09-16，M3 实施反馈，健康面板/横幅/灯泡落地时定案）**：
  ① **三视图口径以 §6.1 为准**：§3.2 概述行「包列表升级」与 §6.1「已忽略」矛盾，经复核定案按 §6.1（按断边/按文件/已忽略）——「已忽略」是 §5.3 行级忽略机制的唯一 UI 归宿（M3 任务清单同口径），且「包列表升级」全文无配套细节设计、搬移重构与最小闭环相悖；现有包列表分区**保持原样**，仅按 §6.2 在健康分区加「Montauri 使用 uv 管理依赖 · pip 安装同样可检测（但不写入声明）」常驻小字行。§3.2 已同步修订。
  ② **忽略清单后端统一过滤**：`dep_scan` 计算 diff 后、返回前按 `dep_ignored` 过滤（E1/E4 模块名大小写敏感精确匹配；E2/E3 dist 键 PEP 503 归一存储、过滤时两侧归一防御手改配置）——prepareRun/灯泡/面板所有消费者拿到同一份已过滤真值，单一口径；「已忽略」视图经 `dep_ignore_list` 单独读清单展示（不受过滤影响）。存储复用 `workspaces/<hash>.json`（R9），新增 `dep_ignore_list/add/remove` 三同步命令；E5 是项目级布尔无行级忽略语义，不参与。
  ③ **灯泡 E3/E4 触发形态（用户定案）**：E3/E4 的包 import 可正常解析、无红色 marker，传统「诊断 marker 触发」不成立——落地为**光标行匹配 diff**（`depActionsForLine` 纯函数：解析光标行 import 语句取顶层模块，按当前文件匹配 missingInEnv/undeclared；Monaco 光标移动时自动询问 provider，灯泡可亮）。E3 漂移包**被本文件 import 时与 E4 是同一事实**（装了+未声明+有光标锚点），收敛为同一 declare 动作（`uv add`），不重复出两个同效动作；纯未被 import 的漂移包由面板 E3 行级「写入 pyproject」提供。marker 路径保留为兜底（引擎诊断先于 diff 快照到达的窗口期），与 diff 动作按模块去重。前端 `PACKAGE_ALIASES` 7 项硬编码退役（Rust `DIST_ALIAS_FALLBACK` 为唯一兜底，M1 已迁入）。
  ④ **dep_fix 形态**：单命令 + action 枚举（`install`/`sync`/`declare`/`lock`/`migrate`），action × style → uv 参数由 `plan_dep_fix` **纯函数单点构建**（测试与执行共用，10 项单测锁矩阵）；前端 `fixInFlight` 标志（触发期 `.dep-fix-btn` 全禁用）+ 后端 `AtomicBool` 会话互斥**双保险**（并发第二次直接明确报错，不等 uv 的 lock 文件锁报错）；流式输出复用 `pip-stdout`/`pip-stderr` 事件（§5.6-2 明定，前端输出面板零新监听）。install 对 external 项目按 bare 同路径（`uv pip install --python`，只动环境侧不写声明——external 声明层归外部管理器，R11）；declare 仅 pyproject（其余 style 明确报错引导先迁移）；`uv sync` 确认弹窗走 danger 语义并明示「将按 lock 移除未声明包」（§5.1 脚注 1）；migrate 的 style 判定在 ensure pyproject **之前**（先生成 pyproject 会翻转 style 丢失 requirements_file），缺 pyproject 时复用 `init_pyproject_impl` 幂等生成最小模板（R4.1 原文件只读不删）。
  ⑤ **横幅与模态范式**：原 `env-pyproject-banner`（bare 引导）退役并入四级健康横幅优先级 2（动作仍是 `init_pyproject`，消除同语义双横幅）；横幅为面板内常驻状态投影（不做会话去重——去重适用于 toast 触达），toast 按「工作区+状态哈希」会话去重（§4.7 规则 2，`notifyDedup` Set 随 `resetDepHealth` 清空）。env-modal 对齐 runConfigPanel 范式：**点遮罩不关闭 + Esc 关闭**（§6.5/memory 67600367，面板含装包输入等可编辑内容）。style 徽章交互落地（external → 迁移指引 alert；bare → 生成 pyproject）。
  ⑥ **toast 扩展动作按钮**：`toast(message, kind, opts?)` 新增可选 `actionLabel`/`onAction`（点击即收起并执行）——承载「查看」入口（打开工作区体检异常 toast / envDrift toast，v1.4 ⑥ 随本批落地），向后兼容零改动既有调用点。
  ⑦ **收尾协议实施形态**：`runDepFix` 内 `settleAfterFix` = 重算 diff → `refreshEnvBaseline`（防 site-packages 信号再冗余级联，见 v1.4 ⑦）→ `restartEngine` → toast（成功）；**失败路径同样重算**（半态环境如实呈现，§5.6-5）但只 `toastFail` 不发成功 toast。批量 = 多 plan 一次确认、逐条执行、首条非零 exit 即停。`envPanel.afterEnvChanged` 同步升级为「作废 → 重算 → 重启」（原 M1 形态只作废+重启），五处环境操作（装/卸/升级/建 venv/灯泡装包降级路径）补成功/失败 toast（memory 61552154 对齐）。
  ⑧ **状态栏体检图标**：新增 `#dep-health-status`（解释器芯片左侧）——打开工作区体检启动即转圈（`onScanStart`），完成正常即消、异常驻留警示色 + 计数 tooltip，点击/键盘打开环境面板（`onScanComplete` 钩子经 main 注入 `depHealthPanel.handleScanComplete`，depHealth 不反向依赖 UI 模块）。手动刷新/M2 级联重算同样驱动图标（每次扫描完成广播）。
  ⑨ **已知边界（M3 记录）**：a) E2 行级「安装」以 `dist+spec` 走 install 动作（pyproject 项目即 `uv add "flask>=3"`——会写声明，与组级 `uv sync` 语义略异，属用户显式选择的可接受行为）；b) 修复按钮禁用选择器 `.dep-fix-btn` 是文档级约定（横幅+面板统一挂载）；c)「协议回归（真实引擎装包后诊断刷新）」自动化锁定的是收尾**调用顺序**（vitest 断言 dep_fix→dep_scan→dep_env_snapshot→restartEngine），真实 pyrefly+uv 环境回归仍归 §9.1 手工验收；d) E2_SEVERE_COUNT=5 未再校准（面板落地后无反馈驱动，维持 M1 值）。
- **v1.6（2026-09-16，M4 实施反馈，精度与体验落地时定案）**：
  ① **惰性导入形态（用户定案）**：四个候选（预检框附注/纯输出面板/现状达标等）中选「纯输出面板提示」——预检框不碰（lazy 本就不该出现在阻塞路径），`prepareRun` 在有新鲜 diff 快照时经 `lazyMissingForFile`+`lazyHintLine` 输出一行 hint（「N 个惰性导入未安装（不阻塞运行，执行到对应代码时才会失败）：a L3、b L20」），按「工作区+文件+内容」会话去重；快路径（无快照回退 check_missing_imports）不提示——旧单文件探针本就跳过函数体，无 lazy 数据可提示。
  ② **增量缓存升级「完整增量」（用户定案）**：三层缓存各司其职——AST mtime 缓存（M1）管文件级重扫；**resolution 缓存**（模块 → find_spec/packages_distributions 结果）按探针解释器为键进程级缓存，探针只解析「新增模块」，**full 扫描前作废**（环境装/卸包后 missing/site 分类会过期，正确性优先于缓存命中）；**环境快照缓存**（最近一次成功 `uv pip list`）供 code 范围复用（E2/E3 不因 .py 编辑而重跑子进程）。`dep_scan` 契约增可选 `scope` 参数（缺省 full，消费方容忍未知值）：`.py` 信号 → code（L0+L2）；声明文件信号 → declaration（L0+L1，代码层经 `reuse_code_layer` 零探针重组——任一缓存缺失/文件又变则整体放弃复用返回 None，保守降级）；混合突发/首扫（无快照）→ full。前端 `handleDepFsChanged` 分流，M2 的「防抖全量」语义升级为「防抖 + 分流」。E5（uv lock --check）仅 full 跑。
  ③ **traceback 出口形态**：两出口都挂——run 会话的 term-data 分发点（按行喂 `handleTracebackLine`，与 sniffTerminalOutput/watchUvicornLine 同点）+ 输出面板 stderr 行（`output.ts` 经 `setOutputTracebackHandler` 注入，同 `setOutputUrlHandler` 先例防循环依赖）；toast error（8s 长驻）+「安装」动作按钮（toast 扩展已有），点击 → `installMissingPackage`（main 注入 `setDepInstallHandler`）。正则只认 `No module named 'X'`（引号包裹、可含点取顶层）；会话去重（同模块只提示一次，防脚本重跑 toast 风暴），`resetDepHealth` 清空。已知边界：终端跨块截断可能漏检一行（罕见），漏检不误报、不重复打扰。
  ④ **dist 歧义（用户定案）**：探针 `packages_distributions` 反查保留**全部候选**（`distCandidates` 数组，不再只取 `v[0]`；首候选镜像进旧 `dist` 字段保持兼容），契约字段只增不删（§3.3）。交互：行级「安装」/「加入 pyproject」与灯泡 `installMissingPackage` 在 len>1 时先弹 `resolveDistForInstall`——openChoice 双候选快捷位（ok=首候选默认/neutral=次候选/cancel=放弃），>2 候选列出全部但只提供前两个按钮位（其余提示手动安装，openChoice 形态上限）；单候选/null 沿旧路径（null 走 NULL_DIST_WARNING 按模块名安装）。E1/E4 面板行内同步展示「候选发行版：A / B（安装时选择）」详情。别名表兜底（DIST_ALIAS_FALLBACK）结果也进候选集。
  ⑤ **uv workspace 评估结论**：不实施。bench 集三个既有样例 + large_repo 均为单包项目，无 `[tool.uv.workspace]` 需求案例；真实 monorepo 用户出现前不预建复杂度（维持 M1「只读根 pyproject」口径，§10 风险 4 记录在案）。
  ⑥ **性能红线验收口径（用户定案：扩充 bench 集后回放）**：新增 `bench/sample/large_repo/`（生成器 `bench/gen_large_repo.py`——88 个 .py、4 层深目录 × 6 包、惰性导入/相对导入/重复位点/未声明三方全形态 + uv.lock）。release 回放实测：large_repo **880ms**、errors 823ms、fastapi_annotated 638ms、unannotated_scraper 667ms，全部 ≤ 2s **达标**。已知边界：errors 样例首轮 3243ms 为 E5 `uv lock --check` 的 uv 索引冷缓存联网开销（warm 后 823ms）——非红线违例，§10 风险 1 的实测佐证（「失败降级不阻断」已落地，联网慢不阻断 diff 返回）。
  ⑦ **交付后复核修复（2026-09-16，M4 代码复查）**：
    a) **resolution 缓存键缺陷**：探针把工作区根插入 `sys.path[0]`（local 分类依赖 root），原实现只按解释器作键——切工作区 A→B 后 B 复用 A 的解析结果（A 的本地包在 B 中误判 local 而非 missing）。修复：缓存键改**解释器+工作区根**复合键；环境快照缓存同步增补（切工作区后 code 范围不复用旧工作区包列表）。
    b) **缓存代次竞态**：full 扫描作废 resolution 缓存的瞬间，在途 code 扫描完成并回写**作废前**的旧环境解析结果——脏数据存活到下次 full。修复：缓存引入 `generation` 代次（作废时 ++），回写时代次不匹配即丢弃。
    c) **批量修复的多候选静默**：组级「全部修复」对多候选模块直接取首候选执行，用户无感知（与 §11 v1.6 ④「安装时弹候选选择」定案相悖）。修复：无法逐个弹选择器（openChoice 单实例模态）的批量路径，在确认弹窗 warning 中明示「将安装首个候选；如需另选请用行级安装」。
    d) **traceback 检测出口不一致**：`handleTracebackLine` 原只挂 run 会话——用户在 shell 终端手敲 `uv run main.py` 的报错不触发（而 sniffTerminalOutput/watchUvicornLine 均覆盖 shell+run）。修复：两类会话统一按行喂入。
    e) 文档勘误：cargo 新增测试数为 5 项非 6 项（163+5=168 passed + 1 ignored = 169）。
  ⑧ **用户实测 bug 修复（2026-09-16，handsome 项目 cbond/cb_daily.py 反馈「field_map/settings 缺失」误报）**：
    a) **脚本式布局的同目录导入误报 E1**：`cbond/cb_daily.py` 裸导入同目录 `field_map`/`settings`（无 `__init__.py` 的脚本式结构）——Python 运行语义是「**脚本所在目录**进 sys.path[0]」，而全量探针只插工作区根 → 同目录模块判 missing（E1 误报）。单文件预检脚本（MISSING_IMPORT_SCRIPT）一直是对的（`sys.path.insert(0, dirname(path))`），M1 推广为全量探针时丢了这个语义。修复：`_classify` 增按「import 位点所属文件目录」解析（`search_dirs` 多目录逐一尝试，优先级 local > site > missing——任一目录解析为一方代码即 local）；Rust 侧 payload 增 `module_dirs`（缓存复用模块的位点目录映射，AST 缓存导出）。
    b) **venv 内 site-packages 误判 local（E1 漏报）**：venv 建在工作区内（`.venv` 惯例）时，三方包 origin 以根为前缀 → 被旧「origin 在根下 = local」口径吞掉（实测 requests/jmespath 判 local）。修复：`_is_local_path` 排除 `.venv*`/`venv`/`site-packages`/`dist-packages` 路径组件（不用裸 `env`——误伤同名本地目录）。
    c) 已知边界（记录）：同名模块跨目录只有一边存在时取「最优可得」结果（local > site > missing）——比旧口径（只按根解析，两边都 missing）严格更优；pyrefly 对脚本式裸导入的红线是静态引擎自身解析行为（根目录起解析），不归 dep 域管（§10 风险 6：诊断渲染权在静态引擎）。锁定测试：`probe_resolves_sibling_imports_by_script_dir`。
  ⑨ **fika-admin 实测修复（2026-09-16，第二个真实项目验收）**：uv sync 装的环境 E3 报 63 项「漂移」、E4 报 5 项 starlette「未声明」——全部是 uv.lock 锁定闭包内的**传递依赖**（pydantic-core/starlette/typing-extensions/aliyun-* 链），按 lock 合法存在。根因：§2 三层模型定义「声明层 = pyproject / requirements / uv.lock」，但 M1 实现的 E3/E4 排除集只读 pyproject——任何 `uv sync` 装的环境都必然大量过报。修复：`parse_uv_lock_names`（uv.lock `[[package]]` 段 name 行扫描，失败降级空集回退旧行为）并入 `declared.all`（**不进 core**——E2 同步范围仍按 pyproject 声明，lock 是「结果」不是「要求」：lock 里有而 core 没装的包不报 E2）。修复后 fika-admin 复验：E3 0 / E4 0 / E2 0 / E5 false（uv lock --check 真值）；E1 保持 6 项（pytest ×5 为 dev extras 未装的真实缺失——按 §4.2 E1 口径如实反映「跑 tests 会 ImportError」；backend lazy 为插件目录动态 sys.path 的已知边界，lazy 标记已限「仅提示」）。锁定测试：`uv_lock_closure_excluded_from_drift_and_undeclared`（含 [manifest] 段不计入、E2 不受 lock 并入影响的语义锁定）。
- **v1.7（2026-09-16，fika-admin 实测反馈：E1 的 pytest ×5 提示过多，用户定案「做 A+B」）**：
  ① **E1 语义收窄（方案 A：声明全集感知）**：E1 的本意（反馈 3）是抓「拼错模块名 / 未声明的裸用」；模块已写入 pyproject（含 extras / dependency-groups / dev）却未装时，用户「知道需要它，只是没装这个组」——把它留在 E1 逐文件报是语义错位（5 个文件 = 5 行几乎一样的报警）。定案：E1 计算时，missing 模块经「dist 反查 → 别名表 → 模块名」归一化后命中 `declared.all` → **不进 E1**，改由 E2 分组下的新小节「已声明未安装（代码引用）」一条汇总呈现（模块名 + 受影响文件数 + 安装命令建议）。
  ② **匹配链口径**：模块名 → dist 反查（packages_distributions 只覆盖已装包，未装时为 null）→ `DIST_ALIAS_FALLBACK` 别名表 → 模块名本身，全部候选逐一归一化比对声明全集——`pytest`（模块名==包名）与 `yaml`→pyyaml（别名）都能命中；`dotenv`→python-dotenv 这类反查不到且别名表没有的声明缺失仍进 E1（已知边界：宁可多报一条真实缺失，不漏）。
  ③ **E2 新小节只呈现不改计数口径**：`declaredMissing`（core 同步范围）语义不变；新小节是 E2 分组内的展示形态（标题区分「同步范围缺失」与「代码引用的已声明缺失」），`uv sync --extra dev` 类建议由前端按 style+组名组装。requirements 项目同样适用（声明行全在 `declared.all`）。
  ④ **E1 同模块聚合展示（方案 B）**：面板 E1 视图按 module 聚合（「pytest（5 个文件）」展开看明细 file:line）；`missingInEnv` 契约保持 (module,file) 粒度不变（运行预检 `missingForFile` 按文件消费，聚合是纯呈现层）。
  ⑤ **预检口径**：`missingForFile` 须同时剔除「进 E2 小节的已声明缺失」与既有 lazy——已声明的缺失交给 E2 小节呈现，预检不二次打扰（M4-1 lazy「仅提示」语义不变，`lazyMissingForFile` 同样剔除已声明项）。
  ⑥ **忽略清单**：E2 小节条目沿用 edge="e2" 的 dist 归一化忽略（模块名作 key 存储，`dep_ignore` 契约不变）。
