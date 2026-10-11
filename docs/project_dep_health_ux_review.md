# 创建项目 · 依赖健康 · 长耗时交互 —— 体验审查与改进工作单

- **版本**：v1.1（2026-10-11，逐条核对修订，见文末「修订记录」）
- **范围**：新建项目（本地创建 / 远端克隆入口）· 依赖健康（面板 / 横幅 / 状态栏 / 灯泡 / 运行时兜底）· 环境与依赖类**长耗时操作**的交互
- **方法**：只读代码审查（未改代码、未跑测试）。逐条问题均带代码证据（`文件:行`）。**v1.1 已逐条复核全部引用与事实陈述**
- **真源**：`docs/dep_health_dev_plan.md`（M1~M4 全交付 + v1.1~v1.7 修订）· `docs/onboarding_dev_plan.md` v1.2 · `docs/git_clone_dev_plan.md`
- **状态**：裁决完成（2026-10-11，Q1~Q5 全部落定，见 §4）。P0 共 7 项，其中 L-4 为正确性缺陷，优先修

---

## 0. 结论摘要

| 档 | 数量 | 性质 |
|---|---|---|
| P0 | **7** | 3 项正确性/防重入缺陷（C-1 / C-2 / L-4）+ 4 项长耗时交互不可用（C-3 / L-1 / L-2 / L-3） |
| P1 | 13 | 反馈不可见、入口不稳定、状态误报 |
| P2 | **14** | 反馈形态、信息架构、术语与打磨 |
| P3 | 1 | 重绘后视点丢失（D-11） |

合计 **35** 项（C 14 + D 11 + L 10）。

一句话：**机制层（依赖健康 diff / 失效矩阵 / 修复矩阵）已经足够好，问题集中在「长耗时过程的可观测性」与「入口 / 状态表达」两层**。新建项目与创建环境两条路径都**绕开了项目里已经存在的好范本**——`cloneRepository.ts` 早就做了「面板内进度区 + 流式进度行 + 取消按钮」，而 `create_venv` / `pip_install` / `dep_fix` 只有「输出面板滚文本 + 按钮转圈 + 不可取消」。

---

## 1. 创建项目（C）

### 1.1 现状

入口三处：欢迎页 `#ew-new-project`（`index.html:320`）、文件菜单、`newProject.ts::openNewProjectPanel`。面板两个 tab：本地创建（名称 / 位置 / 项目类型 / 初始化 Git / Python 环境 / Python 版本 / 预览行）、从远端克隆（`cloneRepository.ts`）。

一次「创建」实际串行做四件事（`newProject.ts:191-297`）：

1. `create_project` —— 建目录 + `main.py` + `pyproject.toml`（uv init --bare 优先，失败回落最小模板）+ 可选 `git init` + `.gitignore`（`fs_cmds.rs:842-898`）
2. `openWorkspace` → `openFile(main.py)`
3. 按环境类型配置解释器：`create_venv`（**可能联网下载 Python**）/ `pick_default_system_interpreter` / 不设置
4. 非 script 类型再走 `pip_install`（有 pyproject 时后端自动转 `uv add`）装依赖

### 1.2 问题清单

| 编号 | 级别 | 现象 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| C-1 | **P0** | 创建项目绕过环境变化级联：只 `invoke("set_interpreter")`，未调 `afterEnvChanged()` | `newProject.ts:232-261` vs `envPanel.ts:101-106`；`main.ts:375` 的 `startLsp` 在 venv 存在之前就跑了 | 新建 `.venv` 并选中后**静态引擎不重启**，补全/诊断仍按旧解释器（uv run 兜底）；diff 快照未作废（靠 `freshDiffForInterpreter` 解释器不匹配兜底，漏报被防住但白跑一次单文件探针） | `wireNewProject` 增注入 `restartEngine`，收尾统一走 `afterEnvChanged()`（与 envPanel 五处同口径） |
| C-2 | **P0** | 创建按钮 busy 但输入框不锁，Enter 无防重入 | `newProject.ts:323-328`（keydown 直接调 `createProject()`）；`util.ts:328` 只 disable 按钮 | 第二次触发真走一遍 `create_project` → 后端「目标已存在」→ **用户在一次成功的创建过程中看到「创建失败：目标已存在」** | 模块级 `creating` 守卫；busy 期间同时 disable name/location；或 Enter 判 busy |
| C-3 | **P0** | 模态覆盖整个创建过程，输出面板（设计上的唯一进度指示）被压暗且不可交互 | `newProject.ts:294` 才 `closeNewProjectPanel()`；`style.css:2384-2387`（`inset:0`）、`175`/`459`（`--overlay` 浅 0.45 / 暗 0.18） | ③建 venv（可下载 Python）+ ④装依赖期间用户只能看按钮文案变三次，无法滚动/复制/判断卡住 | ①`openWorkspace` 后即关面板，③④交给环境/输出面板承载；或②把阶段清单搬进面板（见 §3.4 M2） |
| C-4 | P1 | 新建项目路径**不展开输出面板** | `newProject.ts` 全文无 `$("bottom")` 操作；对比 `envPanel.ts:715`（createVenv 展开）与 `depHealth.ts:906`（runDepFix 展开） | 与 C-3 叠加 → 进度**完全不可见** | 在 `createProject` 进入 ③ 前展开 `#bottom`（与既有先例一致） |
| C-5 | P1 | 缺「将要下载 Python」的提示行 | `envPanel.ts:717` append `env.versions.downloadHint`；`newProject.ts:234` 只有命令 echo | 选了「（需下载）」版本后用户不知道要等几分钟 | 复用 `env.versions.downloadHint` 文案，同一判定（`version` 非空且未安装） |
| C-6 | P1 | 错误反馈与路径预览共用弱化样式 | `style.css:4164-4172`（`--fg-dim`）；写入点 `newProject.ts:195`/`215` | 「创建失败：…」「请填写名称和位置」在视觉上与「将创建于 …」同级，不构成警示 | 预览行拆双态：`.new-project-preview`（提示）与 `.new-project-error`（`--danger` + 图标） |
| C-7 | P1 | `list_python_versions` 失败静默 | `newProject.ts:168-170`（仅 `console.error`）；`envPanel.ts:480-482` 同 | 下拉只剩「（默认版本）」，用户不知道版本列表没加载出来 | 失败时下拉占位改「版本列表加载失败 · 点击重试」 |
| C-8 | P1 | 无输入预检：名称非法 / 目录已存在只在点击后由后端报错 | `fs_cmds.rs:849-859` | 一次往返 + 弱化样式呈现（见 C-6） | 前端做同规则字符校验；目录已存在走轻量存在性检查（注意命令面预算，优先复用现有命令） |
| C-9 | P1 | 成功收尾无汇总、无下一步 CTA | `newProject.ts:294-296` | 面板直接关闭，用户不确定「做了什么、接下来做什么」 | 成功 toast 汇总（路径 / venv / 依赖数）+ FastAPI 项目给「运行 main.py」动作按钮 |
| C-10 | P2 | `[project].name` 归一化静默 | `fs_cmds.rs:797`（`let _ = normalize_project_name`） | 「My Project」→ 目录名与包名不一致，用户无感知 | `pyproject_note` 追加一行说明（已有回显通道，零新 UI） |
| C-11 | P2 | 模板只有 script / FastAPI | `newProject.ts:67-70`、`fs_cmds.rs:837-840` | 目标画像含「爬虫」，无对应起点 | 加「爬虫（requests + bs4）」模板或「空项目」；模板元数据已有 `PROJECT_TYPES` 单一来源，扩展成本低 |
| C-12 | P2 | 「新建项目」无键位 | `keybindingDefaults.ts` 有 `new_file`(181) / `scratch_new`(171)，无 `new_project` | 键位体系不对称；`welcomeGuide.ts:64` 注释自己写明「新建项目无键位列」 | 增 `new_project` 键位（建议 `Ctrl+Alt+Shift+N`），三步卡自动显示 |
| C-13 | P2 | 三步卡 `action` 是死字段 | 定义 `welcomeGuide.ts:67`；`buildQuickstart`(72-91) 从不赋值；`renderQuickstartCards`(96-122) 从不渲染按钮 | 卡①「新建项目」既无直达按钮也无键位，纯文本 | 二选一：给卡① 赋 `action` 并在渲染处补按钮，或删除 `action` 字段（不留死代码） |
| C-14 | P2 | 「系统解释器」不可用时 `openAlert` 与创建面板并存 | `newProject.ts:246-256`（`void openAlert`，未 await）vs 同文件 `46-50` 的 Esc 守卫（`.modal:not(.hidden)` > 1 即拒绝关闭） | 短暂双层模态，Esc 行为与用户预期不符 | `await` 弹窗后再 `closeNewProjectPanel()`；或先关面板再弹 |

> 克隆 tab（`cloneRepository.ts`）本轮**未发现**同级问题：URL 校验、主分支预览、取消（`git_cancel_op`）、目录冲突自动子目录、错误本地化都有。它反过来是本轮改进的**范本**（见 §3）。

---

## 2. 依赖健康（D）

### 2.1 现状（已交付的机制层）

`dep_scan` 单一真值 → `DepDiff`（E1~E5 五条断边）→ 三视图面板（按断边 / 按文件 / 已忽略）+ 四级横幅 + 状态栏体检图标 + 灯泡动作 + traceback 一键安装。失效矩阵：`.py`/声明文件信号分流扫描、终端嗅探 + site-packages 监听做环境信号、快照真值对比、`afterEnvChanged` 统一收尾。**机制层无需返工**，以下均为表达层与入口层问题。

### 2.2 问题清单

| 编号 | 级别 | 现象 | 证据 | 影响 | 建议 |
|---|---|---|---|---|---|
| D-1 | P1 | **健康时图标隐藏**：`setHealthStatus` 对 `idle`/`ok` 都加 `hidden` | `depHealthPanel.ts:169-180` | 「一切正常」时反而**没有任何入口**；想主动体检必须先开「Python 环境」再展开明细 | 图标改为常驻（健康态用中性色 + tooltip「依赖一致，点击查看」），或至少加菜单项 / 命令面板条目 |
| D-2 | P1 | 横幅只覆盖 4 类（external / bare / E2 / envDrift） | `depHealthPanel.ts:246-297` | **E1（最常见：import 了没装）/ E4 / E5 无横幅**，只落到状态栏小图标 | 补 E1/E4 横幅档位（E1 用「N 个模块缺失，运行会 ImportError」口径）；或统一改为「面板内顶部摘要行」承载全部断边 |
| D-3 | P1 | **「假绿」**：未选解释器时 E1/E2/E3 置空，若 E4/E5 也无问题则 `issueCount=0` → 图标熄灭 | `depHealth.ts:577-586`、`depHealthPanel.ts:169-180`；说明文案仅在展开后的组内注释 `dep.ts:127` | 没有解释器的项目看起来「依赖全好」，实际环境侧根本没检测 | `interpreter === null` 时状态栏给独立形态（灰底感叹号 + 「环境侧检测不可用」），不并入 ok |
| D-4 | P1 | 无菜单项、无命令面板条目 | 入口仅 `main.ts:2283`（toast/图标）与面板内分区 | 键盘用户没有直达路径；「依赖健康」不可被搜索到 | 命令面板注册 `dep_health_panel`（`quickOpen` 注册表已有单一来源机制，零新增清单） |
| D-5 | P2 | 术语门槛：主视图按「E1~E5 断边」组织，标题含 `⊄` | `dep.ts:75-79` | 目标用户（FastAPI / 爬虫 / 小脚本）不看设计文档；「断边」是内部词汇 | 标题平化（如「代码里 import 了但没装的包」），`E1` 降为副标签；或在分组头补一行人话说明 |
| D-6 | P2 | 信息架构：解释器切换（低频）+ 包管理（高频）+ 依赖健康（问题驱动）同处一个「Python 环境」模态，健康区刻意沉底 | `index.html:506-584` | 用户找「包一致性问题」不会想到点「Python 环境」 | 短期：分区标题改为可点跳转的锚点语义；长期：健康明细可独立成面板（与 `#right-panel` 工具区同构） |
| D-7 | P2 | `uv sync` 危险确认只说「会移除未声明包」，不列具体包 | `dep.ts:144`（`dep.plan.syncRemoves`） | 用户无法评估影响面，只能盲选 | 用已算出的 `envDrift` 列表在确认弹窗中列出将被移除的包名（数据已在 `diff` 里，零新增计算） |
| D-8 | P2 | 无跨断边批量修复；大集合无筛选 | `depHealthPanel.ts:440-448`（仅组级）、`56`（仅 >15 自动折叠） | E3 93 项这类场景只能逐组处理；找不到特定包 | 明细区加筛选框（复用 `env-pkg-filter` 的轻量过滤范式）；评估「修复所有可修项」 |
| D-9 | P2 | 忽略 key 口径混用（E1/E4 用模块名，E2/E3 用 dist 名），「已忽略」视图直接显示原始 key | `depHealthPanel.ts:682-687` | 清单里 `yaml` 与 `pyyaml` 混排，用户不易理解 | 展示时统一附「（模块名）/（发行版名）」后缀；或统一存 dist 归一 |
| D-10 | P2 | 无「本次变化」提示，只有「上次扫描 {time}」 | `depHealthPanel.ts:341` | 修复后重扫，用户不知道哪几项被解决了 | 快照对比后给一行「本次新增 N / 已解决 M」 |
| D-11 | P3 | 修复后 `renderDepHealth()` 全量重绘，滚动位置重置（`groupOpen` 保留） | `depHealthPanel.ts:760-770` | 大列表下操作后视点丢失 | 重绘后恢复 `scrollTop` |

### 2.3 测试覆盖缺口（v1.1 核对新增）

| 现象 | 证据 | 影响 |
|---|---|---|
| 环境面板与依赖健康面板在 **mock e2e 层零覆盖** | `shell/e2e/` 下**无任何 spec** 引用 `env-modal` / `dep-health` / `env-pkg`（对照：新建项目侧有 `e2e/ux/03-new-project-fastapi.spec.ts`，克隆侧有 `e2e/git/23-clone.spec.ts`） | §5 批 2 的入口 / 状态栏改动**没有现成 e2e 兜底**；新增 spec 应作为批 2 的一部分，否则只能靠单测 + 真机手工 |
| 依赖健康只有单测（`depHealth.test.ts` / `depHealthPanel.test.ts`）+ 真机 `ui-real` 间接覆盖 | 同上 | 面板改动缺少端到端回归钉子 |

---

## 3. 长耗时交互（L）——本轮重点

### 3.1 长耗时操作清单（超时口径来自代码常量）

| 操作 | 命令 | 超时 | 进度呈现 | 可取消 | 后端互斥 | 面板阻塞 |
|---|---|---|---|---|---|---|
| 新建项目 · 落盘 | `create_project` | — | 无 | 否 | 无 | **模态遮罩** |
| 新建项目 · 建 venv | `create_venv` | **600s** | 输出面板（**未展开**，C-4） | 否 | 无 | **模态遮罩** |
| 新建项目 · 装依赖 | `pip_install` | **120s** | 输出面板（未展开） | 否 | 无 | **模态遮罩** |
| 环境面板 · 创建/重建 venv | `create_venv` | 600s | 输出面板（已展开）+ trigger 文案「创建中…」 | 否 | 无 | 面板模态 |
| 环境面板 · 安装包 | `pip_install` | 120s | 输出面板（流式）+ 按钮 busy | 否 | 无 | — |
| 环境面板 · 卸载 | `pip_uninstall` | 120s | **无流式**（`run_uv_output` 一次性返回，仅按钮 busy「卸载中…」） | 否 | 无 | — |
| 环境面板 · 升级 | `pip_upgrade` | 120s | 输出面板（流式）+ 按钮 busy | 否 | 无 | — |
| 依赖健康 · 修复 | `dep_fix` | 120s | 输出面板（已展开）+ `.dep-fix-btn` 禁用 | 否 | **`DEP_FIX_BUSY`**（`dep_fix.rs:953`） | 无（确认框后即放行） |
| 从远端克隆 | `git_clone` | — | **面板内进度区（文本 + 进度条）+ 最近 200 行** | **是**（`git_cancel_op`） | — | 面板模态 |
| 工具链安装 | `toolchain.rs` 的安装命令 | — | 输出面板（`toolchain-stdout/stderr`） | 否 | — | — |

常量证据：`env_cmds.rs:27`（`UV_TIMEOUT=120s`）、`env_cmds.rs:30`（`UV_VENV_TIMEOUT=600s`）；`create_venv` 用 600s（`:474`），`pip_install`（`:725`）、`pip_upgrade`（`:783`）、`dep_fix`（`dep_fix.rs:1090`）都用 120s；`pip_uninstall` 走 `run_uv_output`（`:736-744`，内部 `run_with_timeout(UV_TIMEOUT)`）。

> v1.1 核对修正：卸载与升级的进度形态**不同**——升级走 `run_uv_streaming`（`:774-783`），卸载走 `run_uv_output`（`:736-744`，非流式），故拆为两行并新增 L-10。

### 3.2 「下载 Python」为什么体验差（用户点名场景）

以新建项目选「3.12.x（需下载）」为例，用户实际经历：

1. 点「创建」→ 面板不关，按钮变「创建中…」（`newProject.ts:203`）
2. 落盘 + 打开工作区 + 打开 `main.py`（这一步没有提示，界面在模态后面变化）
3. `uv venv --python 3.12` → **uv 开始下载 CPython（数十 MB）**，最长可等 10 分钟（600s）
4. 全程**唯一反馈**：输出面板里 uv 的文本行——而这个面板 (a) 没被展开（C-4），(b) 被模态压暗不可交互（C-3）

四个叠加缺陷：

- **L-1（P0）没有可判读的进度**。没有「已下载 / 总大小 / 百分比 / 预估剩余」。`stream_lines`（`env_cmds.rs:194-215`）把 `\r` 统一转成 `\n` 逐行推送（代码注释自己说明是为适配进度条），前端监听器逐行 `appendOutputLine`、无合并无节流（`envPanel.ts:1129-1134`）。于是只有两种结局：uv 在非 TTY 下退化成少量一次性行（**看不到进度**），或 `\r` 刷屏（**淹没有用输出**，还要靠 `output.ts:213` 的 5000 行环形缓冲兜底）。**两条路都无法回答「在下载还是卡住了」。**
- **L-2（P0）超时预算与耗时错配**。`create_venv` 给了 600s，但紧随其后的 `pip_install`（新建 FastAPI 项目 = `uv add fastapi uvicorn`，首次联网 + 解析 + 下载）只有 **120s** → 国内网络下很容易被 kill，错误文案是「命令执行超时（120s）」（`env_cmds.rs:241`），用户看到的是「依赖安装失败」。`dep_fix` 的 `uv sync` 装整套 lock 闭包（真实项目曾 63 项）同样是 120s。**超时按命令定值，而非按动作定值，是这批问题的共同根因。**
  补充（v1.1 核实）：PyPI 侧**已有**缓解路径——设置面板「Python → PyPI 镜像源」（`settings.rs:198-199` 的 `pypi_index` → `tool_paths.rs:26-33` 的 `inject_pypi_mirror` 注入 `UV_DEFAULT_INDEX`）；但 (a) 用户未必知道该开，(b) Python 安装包下载无对应能力（见 §4.1 Q3）。
- **L-3（P0）没有取消**。`dep_health_dev_plan.md` §5.6-4 明确裁决「不提供取消按钮」，理由是「uv 进程中途 kill 会留半态环境」。但这条裁决**对 `create_venv` 不成立**：`uv venv --clear` 本来就是「清空重建」，中途取消的代价只是没有 `.venv` 或一个半成品目录，远小于让用户干等 10 分钟。而且项目里**已有现成范本**：克隆流程的取消（`cloneRepository.ts:521-525` → `git_cancel_op`，按钮文案切「取消中…」，取消走 info 级提示不报失败）。**已裁决：对 `create_venv` / `pip_install` / `dep_fix` 三个都提供取消（见 §4.1 Q1）。**
- **L-4（P0，正确性）切换工作区不取消在途操作，且会把结果写进新工作区**。`envPanel.createVenv` 在 `await create_venv` **之后**才读 `app.workspaceRoot` 去 `set_interpreter`（`envPanel.ts:723` 与 `:727` 两次读取模块级变量）。若用户在下载期间切到别的工作区：`resetWorkspaceUiState`（`main.ts:272`）→ `resetEnvPanelState` → `closeEnvPanel`（`envPanel.ts:191`）只关了面板，**后台 uv 进程照跑**；完成后 `set_interpreter` 会把**旧工作区的 .venv 路径写进新工作区的配置**。对照：`newProject.ts` 全程用捕获的 `result.path`，无此问题。
  → 修法：`createVenv` 起手捕获 `const root = app.workspaceRoot` 并全程用它；await 后校验 `root === app.workspaceRoot`，不等则丢弃结果并 toast「已切换工作区，创建结果未应用」；配合 L-3 的取消能力，在 `resetEnvPanelState` 里取消在途操作。

### 3.3 其余长耗时交互问题

| 编号 | 级别 | 现象 | 证据 | 建议 |
|---|---|---|---|---|
| L-5 | P1 | **无全局忙态**：状态栏没有任何「正在创建环境 / 正在安装」的持续指示（只有依赖体检图标）；env 域**无互斥**——`create_venv` 与 `pip_install` 可并发（`env_cmds.rs` 无 `AtomicBool`，只有 `dep_fix.rs:953` 有） | `depHealthPanel.ts:165-180`；`env_cmds.rs` 全文 | 状态栏加一枚可取消的「进行中」芯片（同时解决 L-3 的入口问题）；env 域加与 `DEP_FIX_BUSY` 同款的会话互斥 |
| L-6 | P1 | 进度只在输出面板，且**依赖调用点自觉展开**（新建项目就漏了） | `envPanel.ts:715`、`depHealth.ts:906` 各自手动展开；`newProject.ts` 无 | 把「展开 + 记录命令」收进一个 `beginLongOp()` 辅助（单一来源），新增调用点不会漏 |
| L-7 | P1 | 超时文案无引导：`命令执行超时（600s）` | `env_cmds.rs:241` | 文案补「（网络较慢时可能超时，可在终端手动执行：`uv venv --python 3.12`）」，把兜底路径交给用户 |
| L-8 | P2 | 环境面板创建 venv 时，包输入框 / 卸载按钮未随操作禁用 | `envPanel.ts:719-721` 只禁用 `interpTriggerEl` | 长操作期间统一禁用 env 域写操作（与 `.dep-fix-btn` 同思路） |
| L-9 | P2 | 进度行无节流/合并，`\r` 刷屏时靠 5000 行环形缓冲兜底 | `output.ts:213`、`envPanel.ts:1129-1134` | `\r` 型进度做「末行原地更新」（不新增 DOM 行），或按 100ms 合并 |
| L-10 | P2 | **卸载无流式**：`pip_uninstall` 走 `run_uv_output` 一次性返回（非 `run_uv_streaming`），卸载过程零进度 | `env_cmds.rs:736-744` vs `:774-783`；前端 `envPanel.ts:788` 拿到结果才 append | 改走 `run_uv_streaming`（与 `pip_install` / `pip_upgrade` 对齐），否则卸载大包（如 torch）时只有按钮文案在动 |

### 3.4 改进方案分层

**M1 —— 最小改（纯前端，当天可落地，零 Rust 改动）**

1. C-3 + C-4：`createProject` 在 ③ 之前展开 `#bottom`，`openWorkspace` 完成后即关面板（③④的进度交给输出面板）
2. C-5：补 `env.versions.downloadHint` 提示行（复用现有文案与判定）
3. C-2：`creating` 守卫 + busy 期间 disable 输入框
4. C-1：注入 `restartEngine`，收尾走 `afterEnvChanged()`
5. C-6 / C-9：预览行拆双态；成功 toast 汇总
6. D-1 + D-4：状态栏图标常驻（健康态中性色）+ 命令面板注册 `dep_health_panel`
7. L-4（前端侧）：`createVenv` 全程用捕获的 `root`，await 后校验工作区未变

**M2 —— 进度与取消（需 Rust 改动，建议独立 PR）**

1. **统一长操作通道**：`beginLongOp(label)` —— 展开输出面板 + 状态栏「进行中」芯片 + 禁用 env 域写操作（L-5/L-6/L-8）
2. **可取消**（Q1 已裁决「三个都提供」）：`create_venv` / `pip_install` / `dep_fix` 复用 `kill_process_tree`（`util.rs`，已有）+ 一个 `cancel_op` 命令（`git_cancel_op` 先例），前端按钮文案切「取消中…」，取消走 info 级提示（L-3）
3. **可判读的进度**：面板内进度区（**照抄 `cloneRepository` 的 progressWrap / progressText / progressFill 三件套**），把「已下载 X / Y」「已装 N 个包」这类可解析行映射到进度条；解析不到就只显示最近一行 + 转圈（不做假进度条——与 dep plan §5.6-2 一致）（L-1）
4. **超时按动作分级**（Q2 已裁决）：`pip_install` / `dep_fix` 提到与 `create_venv` 同量级，并让超时文案带兜底命令（L-2/L-7）
5. **切工作区取消在途操作**：`resetEnvPanelState` 调 `cancel_op`（L-4 后端侧）
6. **卸载流式化**（L-10）：`pip_uninstall` 改走 `run_uv_streaming`

**M3 —— 结构性（需裁决）**

1. D-2/D-3：横幅与状态栏状态机重做（覆盖全部断边；`interpreter=null` 独立形态）
2. D-5/D-6：术语平化 + 健康明细独立面板
3. D-7/D-8/D-10：确认弹窗列包名、明细筛选、变化摘要

---

## 4. 裁决记录

### 4.1 已裁决（2026-10-11，以可点选卡片收集）

| # | 问题 | 结论 | 落地影响 |
|---|---|---|---|
| Q1 | 长耗时操作是否提供取消 | **三个都提供**（`create_venv` / `pip_install` / `dep_fix`） | 需改 `dep_health_dev_plan.md` §5.6-4 原裁决；复用 `util::kill_process_tree` + `git_cancel_op` 先例；取消后走收尾协议如实呈现半态 → 批 3 |
| Q2 | uv 超时预算 | **按动作分级**：装包 / 修复抬到与 `create_venv` 同量级（600s），或按「首次联网 / 含 `--python`」分级；超时文案附可手动执行的兜底命令 | 改 `env_cmds.rs` 常量与 `:241` 文案 → 批 3 |
| Q4 | 依赖健康入口形态 | **两者都做**：状态栏图标常驻（健康态中性色 + tooltip）+ 菜单项 + 命令面板条目 | D-1 / D-4 一次解决 → 批 2 |
| Q3 | Python 安装包下载镜像 | **加设置项**（放既有「设置 → Python」区，紧随 PyPI 镜像源；留空 = 官方源；在 uv 命令装配处 `tool_paths.rs` 同源注入） | 变量名已核实：`UV_PYTHON_INSTALL_MIRROR`，值为 URL 或 `file://` 目录 → 批 3 |
| — | 落地顺序 | **从批 1（创建项目 P0，纯前端）开始** | 见 §5 |

> Q3 核实结论（2026-10-11）：**PyPI 侧已有能力**——`settings.rs:198-199` 的 `pypi_index`（设置面板「Python → PyPI 镜像源」）经 `tool_paths.rs:26-33` 的 `inject_pypi_mirror` 注入 `UV_DEFAULT_INDEX`（并尊重用户已设的 `UV_DEFAULT_INDEX` / `UV_INDEX_URL`）。**缺口只在 Python 安装包**：全仓无 `UV_PYTHON_INSTALL_MIRROR`，`tool_paths.rs:115` 明确不注入 uv 相关目录变量。故本项不是「加镜像支持」，而是「把已有镜像思路补到 Python 安装这一路」。

### 4.2 仍开放

| # | 问题 | 状态 |
|---|---|---|
| Q5 | C-3 的关面板时机（打开工作区后即关 / 面板内阶段清单 / 两者结合） | 批 1 内**默认按「打开工作区后即关、③④转输出面板」实施**；若要改为面板内阶段清单请提前说明 |

---

## 5. 建议批次

| 批次 | 内容 | 改动面 | 验收 |
|---|---|---|---|
| 批 1 | C-1 / C-2 / C-3 / C-4 / C-5 / C-6 / C-9 + L-4 前端侧 | 纯前端（`newProject.ts` / `envPanel.ts` / `style.css`） | tsc 0 错 · `newProjectType` 单测 · mock e2e `ux/03-new-project-fastapi` + `ux/04-onboarding` · 真机 `new-project-fastapi-real` |
| 批 2 | D-1 / D-4 / D-11 + L-6 / L-8 | 纯前端 | `depHealthPanel` 单测 · **新增 mock e2e spec 覆盖 `env-modal` + 状态栏图标（当前零覆盖，见 §2.3）** · 真机 `ui-real` |
| 批 3 | L-1 / L-2 / L-3 / L-5 / L-7 / L-10 + Q3 Python 镜像设置项 | Rust `env_cmds.rs` / `dep_fix.rs` / `tool_paths.rs` / `settings.rs` + 设置面板 + 前端 | `cargo test` env/dep 域 · 真机 `new-project-fastapi-real`（联网路径）+ `ui-real` |
| 批 4 | D-2 / D-3 / D-5 / D-7 / D-8 / D-10 | 前端为主 | `depHealthPanel` 单测 + 手工验收 |
| 批 5 | C-10~C-14 · D-6 / D-9 · L-9 | 打磨 | 视优先级排期 |

> 测试纪律提醒（项目既有约定）：e2e **只跑相关域**，不跑全量；真机跑批只能在用户自己的 PowerShell 终端执行；改动 `shell/src-tauri` 后必须先 `cargo check` 通过再交付。
> v1.1 补充：批 1 / 批 2 的改动**没有现成 mock e2e 兜底**（新建项目侧有 `ux/03-new-project-fastapi`，环境面板与依赖健康面板零覆盖），因此批 2 把「新增 spec」计入范围；批 1 依赖单测 + 真机。

---

## 6. 逐条验收口径（可直接转测试）

| 编号 | 验收方式 | 判据 |
|---|---|---|
| C-1 | 单测 + 真机：新建 FastAPI 项目 | 创建 venv 并选中后 `startLsp` 被**再次**调用；引擎解释器 == 新建 `.venv` 路径 |
| C-2 | 单测/e2e：创建中在名称框按 Enter | 只发起一次 `create_project`；无「目标已存在」提示 |
| C-3 | e2e：点击创建 | ③ 开始时 `#bottom` 已展开且无模态遮挡；或面板在 ③ 前已关闭 |
| C-4 | 单测/e2e：`createProject` 进入 ③ | `#bottom` 的 `collapsed` 类被移除 |
| C-5 | 单测：选未安装版本创建 | 输出面板含 `env.versions.downloadHint` 文案 |
| C-6 | 单测：后端返回错误 | 预览行元素带 error 类（非 `.new-project-preview` 弱化态） |
| C-9 | e2e：创建成功 | 出现汇总 toast；FastAPI 项目出现「运行 main.py」动作 |
| L-1 | 真机：选未安装版本 | 面板内进度区可见「下载中 / 已下载」类信息；无进度信息时至少显示转圈 + 当前行 |
| L-2 | 单测/真机：冷缓存装 fastapi | 不再因 120s 超时失败；超时文案含兜底命令 |
| L-3 | 真机：下载中点取消 | 进程树被终止（无孤儿 uv）；按钮回到可用态；toast 为 info 级「已取消」 |
| L-4 | 单测：`createVenv` await 期间切工作区 | 不调用 `set_interpreter`，或调用后配置未被污染 |
| L-5 | e2e：长操作进行中 | 状态栏出现「进行中」芯片；env 域写操作按钮禁用 |
| L-10 | 单测/真机：卸载包 | 卸载过程中输出面板有流式行（与安装同形态） |
| D-1 | 单测：扫描结果 0 问题 | 状态栏图标**可见**且为中性态 |
| D-3 | 单测：`interpreter === null` | 状态栏为独立警示形态，不显示 ok |
| D-4 | e2e：命令面板搜索「依赖」 | 命中**新增 id** `dep_health_panel` 并可打开面板 |
| 覆盖 | 批 2 前置 | 新增 mock e2e spec 覆盖 `env-modal` + `dep-health-status`（当前零覆盖） |

---

## 附录：证据索引

- 创建项目：`shell/src/newProject.ts`（全）· `shell/src-tauri/src/fs_cmds.rs:812-898` · `shell/index.html:618-674` · `shell/src/style.css:3999-4172`
- 欢迎/引导：`shell/src/welcomeGuide.ts`（全）· `shell/index.html:304-357` · `shell/src/keybindingDefaults.ts`
- 依赖健康：`shell/src/depHealth.ts`（全）· `shell/src/depHealthPanel.ts`（全）· `shell/src/i18n/locales/zh-CN/dep.ts` · `docs/dep_health_dev_plan.md`
- 长耗时：`shell/src-tauri/src/env_cmds.rs:180-256`（流式/超时）`:447-482`（create_venv）`:696-783`（pip_*）· `shell/src-tauri/src/dep_fix.rs:951-1090` · `shell/src/output.ts:204-321`（输出护栏）· `shell/src/cloneRepository.ts:440-528`（**范本**）
- 镜像：`shell/src-tauri/src/settings.rs:198-199` · `shell/src-tauri/src/tool_paths.rs:26-33`（PyPI 注入）`:115`（不注入 uv 目录变量）
- 环境面板：`shell/src/envPanel.ts:95-106`（afterEnvChanged）`:455-545`（venv 创建/版本弹窗）`:710-805`（创建/装/卸/升级）`:1126-1142`（流式事件）
- 测试：`shell/e2e/ux/03-new-project-fastapi.spec.ts`（mock，覆盖创建面板）· `shell/e2e/git/23-clone.spec.ts` · `shell/e2e-real/new-project-fastapi-real.cjs` · `shell/e2e-real/ui-real.cjs` · `shell/src/__tests__/newProjectType.test.ts` / `depHealth.test.ts` / `depHealthPanel.test.ts` / `welcomeGuide.test.ts`

---

## 修订记录

- **v1.1（2026-10-11，逐条核对）**：复核全部 `文件:行` 引用与事实陈述，修正与补充如下——
  1. **计数修正**：P0 实为 **7 项**（原写 6，漏计 L-2）；L 拆出 L-10 后共 **10 项**，全文问题总数 **35**（C 14 + D 11 + L 10），按档为 P0 7 / P1 13 / P2 14 / P3 1（D-11）；
  2. **引用修正**：`welcomeGuide.ts:66` → `:67`（`action` 字段）；`settings.rs:198` → `:198-199`（`pypi_index` 字段在 199）；`tool_paths.rs:25-30` → `:26-33`（`inject_pypi_mirror` 函数体）；
  3. **事实修正**：§3.1 原把「卸载 / 升级」并作一行且都标为流式——核对后**卸载走 `run_uv_output`（非流式）**、升级走 `run_uv_streaming`，故拆行并新增 **L-10**；
  4. **精度修正**：D-3「假绿」补条件——`interpreter=null` 时 E1/E2/E3 置空但 **E4/E5 照常计算**（`dep_fix.rs:1869-1896` 测试 `dep_scan_pyproject_no_interpreter_computes_e4_only` 锁定），故「`issueCount=0`」成立的前提是 E4/E5 也干净；
  5. **新增 §2.3 测试覆盖缺口**：环境面板 / 依赖健康面板在 mock e2e 层零覆盖（已核实 `shell/e2e/` 下无任何 spec 引用 `env-modal` / `dep-health` / `env-pkg`）；
  6. **验收口径修正**：批 1 / 2 / 3 的 e2e 引用改为真实存在的套件（原「`new-project` 域」「`env` 相关域」为悬空引用；`endpoints-real` 与 uv 联网无关，改为 `new-project-fastapi-real`）。
