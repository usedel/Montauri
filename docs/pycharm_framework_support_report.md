# PyCharm 对 Python 框架的支持调研报告

> 版本：v1.2 · 日期：2026-09-30 · 性质：调研报告（非排期依据）
> 调研对象：PyCharm 2026.2 Help（官方文档）+ JetBrains 官方博客 + 本仓库现状核对
> 覆盖：Django / Flask / FastAPI 三大主线，DRF、Pydantic 等生态层，以及 Pyramid / web2py / GAE / Sanic / Tornado 等"非主线"框架的存废状态
> **v1.1 变更**：按产品裁决重排优先级——**FastAPI 第一（做深）、Flask 第二（做中）、Django 第三（做浅）**；§0 新增裁决条目，§8 重写为三档路线图 + FastAPI 深化清单（§8.3）
> **v1.2 变更（2026-09-30）**：§8.3 新增 **F9（新建 FastAPI 项目模板）** 条目 + 完整实施计划（PR-R，1.5~2 天）——对齐 PyCharm「专属项目类型」能力（§3.3：装 fastapi+uvicorn、生成 main.py、可直接跑），下游探针表/端点视图/运行配置链路已全部就绪，只缺创建入口。
> 结论用途：为 Montauri「是否做框架支持、做到什么程度」提供输入；**是否立项、何时排期仍以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准**（tech plan v3 §1.2 已明确"❌ 复刻 PyCharm 全部功能"为非目标）

---

## 0. 一页结论

1. **PyCharm 的框架支持是"三档"结构，不是均匀分布**：Django ≫ Flask > FastAPI。Django 拿到 17 项专属能力（ORM 语义、模板调试、模型依赖图、Django Structure 工具窗口等），FastAPI 只有 4 项（项目类型 / 编码辅助 / 运行配置 / Endpoints），且**没有**任何 FastAPI 专属的语义理解（依赖注入、Pydantic 请求体、路由层级都是"通用 Python 补全 + Endpoints 列表"在兜）。
2. **授权边界清晰**：Django / Flask / FastAPI 的框架集成**全部是 Pro（订阅）能力**，社区版（2025.1 后为"统一版免费核心"）没有。2025.1 起 PyCharm 合并为单一产品：核心功能（含 Jupyter）免费，Pro 订阅解锁高级特性，并提供 1 个月免费 Pro 试用。
3. **真正拉开差距的不是"框架知识"，而是三件公共基建**：① Endpoints 工具窗口（三框架共用）；② HTTP Client（`.http` 文件 + 从端点一键生成请求）；③ OpenAPI 规范插件（把外部 Swagger 的 URL 也接进补全）。这三者把"写后端"和"调后端"合成一个闭环——这是 PyCharm Web 体验的护城河。
4. **生态层补位**：Pydantic 已**内置**为一等公民（BaseModel 字段补全/类型检查/缺失必填检查/改名传播，v1+v2 双支持），这实际上承担了 FastAPI 的大部分"智能感"；DRF 无独立插件，靠 Django 插件 + Endpoints 覆盖。
5. **小众框架全面退场**：Pyramid 官方明确"not bundled"；web2py、Google App Engine 在当前帮助文档已检索不到独立页面（GAE 文档只存在于 2023.3 及更早版本存档）；Sanic / Tornado / aiohttp / Falcon / Bottle / Litestar 等**均无官方专属集成**（仅为通用 Python 支持）。
6. **对 Montauri 的直接启示**：我们已有的框架探测（`detect_fastapi`，P1 已泛化为 `detect_framework` 三框架探针表）+ 一键运行预设 + 依赖健康，恰好落在 PyCharm"投入产出比最高"的那一档（**静态约定识别 → 自动生成运行/调试配置**）。Python 侧的"深度框架语义"成本极高且非本项目目标用户（自用脚本/小项目）的高频诉求，建议不立项；可低成本扩展的是**框架探针表**（Django / Flask / FastAPI 三条规则）与**服务 URL 自动打开**（已有）。
7. **优先级裁决（2026-09-26）：FastAPI 第一、Flask 第二、Django 浅做**。数据依据（一手，PSF + JetBrains 第八次 Python 开发者调查，2025-08 发布，3 万+ 受访）：**FastAPI 使用率 29% → 38%**（相对增长约 30%，年度最大赢家），Django / Flask 约 35% / 34%（二手报道口径，见 §9）；Python Web 开发占比在 45→43→42 连年下滑后回升至 **46%**。三条支撑"FastAPI 优先"的判断：① 与我们的技术栈**同构**（类型注解驱动 → 静态引擎 pyrefly 直接吃得到；Pydantic 模型；ASGI）；② 用户画像重合——调查显示 **50% 受访者编程经验不足 2 年**，且"把 ML 模型用 FastAPI 包成 API"是明确趋势，与本项目"自用脚本 / 小项目 / 轻量服务"定位吻合；③ PyCharm 给 FastAPI 的正是**最细的运行/调试配置**（Uvicorn / Hypercorn / Dev mode 三选一），是我们已经踩中的那一档，继续往下做是顺势加长板。
8. **据此重排的投入分配**：FastAPI 做到「**端点可见 + 端点可调**」（对标 PyCharm 的 Endpoints + HTTP Client 两件套，按我们架构裁剪为「静态扫描侧栏 + 复用系统浏览器」，不引入 HTTP Client / OpenAPI 引擎）；Flask 只做"**复用 FastAPI 的同一套扫描与 UI，加一条路由规则**"；Django **冻结在「探测 + 运行配置」层**，明确不做 ORM / 模板 / 结构窗口。

---

## 1. 调研方法与来源

- 官方文档（PyCharm 2026.2 Help，逐页抓取原文条目）：
  - Django：`django-support.html`、`django-structure-tool-window.html`、`building-apis-with-django-rest-framework.html`
  - Flask：`flask.html`
  - FastAPI：`fastapi-project.html`、`fast-api.html`（Run/Debug Configuration）
  - 公共基建：`endpoints-tool-window.html`、`pydantic-support.html`
  - 边缘：`pyramid.html`
- 官方博客：`PyCharm 2025.1: Unified PyCharm...`（授权模型变更）；`The State of Python 2025`（PSF + JetBrains 第八次年度调查，框架使用率与生态趋势）
- 本仓库现状核对：`shell/src-tauri/src/env_cmds.rs`（`detect_framework` / `set_framework_hint_disabled`）、`shell/src/frameworks.ts`、`shell/src/runFlow.ts`、`shell/src/termUi.ts`

> 标注约定：✅ 官方明确支持 · ⚠️ 部分/间接支持 · ❌ 不支持或已移除 · 🔍 推断（文档未直接表述，由页面缺失/归档情况推断）

---

## 2. 授权边界：谁才能用上框架支持

| 版本形态 | Django | Flask | FastAPI | Endpoints / HTTP Client | 说明 |
|---|---|---|---|---|---|
| PyCharm Pro（订阅） | ✅ | ✅ | ✅ | ✅ | 官方文档多处直接写 "PyCharm Pro provides…"、"The Django plugin is available only in PyCharm Pro" |
| 旧 Community Edition / 2025.1 后"统一版免费核心" | ❌ | ❌ | ❌ | ❌ | 2025.1 起合并为单一产品：核心功能（含 Jupyter）免费，高级特性需 Pro 订阅，附 1 个月免费 Pro 试用 |

要点：
- 框架能力以**插件**为单位交付（Django plugin、Endpoints plugin 等），默认随 Pro 捆绑并启用，用户可在 Plugins 中禁用——这解释了为什么 PyCharm 能为每个框架做"深度但可选"的集成而不拖累基础体验。
- 这是产品分层策略，不是技术限制：框架集成需要持续的语义维护成本，JetBrains 用它作为 Pro 的核心卖点之一。

---

## 3. 三大框架能力对比

### 3.1 Django —— 支持深度远超其他框架

官方文档 `Django support` 原文列出的能力清单（17 项）：

| # | 能力 | 说明 |
|---|---|---|
| 1 | Dedicated project type | 新建项目向导直接选 Django，自动建 venv/uv/conda、装 Django、可填 app 名 |
| 2 | manage.py 任务执行 | `Ctrl+Alt+R` 打开 manage.py 控制台，直接执行 `makemigrations` / `migrate` / `createsuperuser` 等 |
| 3 | Django 模板支持 | 语法与错误高亮、补全、**block 名补全**、自定义 tag/filter 的解析与补全、tag/filter 快速文档 |
| 4 | 从使用处创建模板 | 视图里写了个不存在的模板名，可直接生成该文件 |
| 5 | **调试 Django 模板** | 模板内也能下断点调试（这是唯一一个"模板可调试"的框架） |
| 6 | 模板 live templates | Django 模板专有代码片段 |
| 7 | Django server 运行/调试配置 | 专用配置类型 |
| 8 | 视图 ↔ 模板互跳 | 双向导航 |
| 9 | **Django ORM 代码洞察** | 模型字段/查询集的语义级补全与解析 |
| 10 | 关键文件内补全与解析 | views.py、urls.py、Models、Meta model options、settings.py 配置常量 |
| 11 | 基于类的视图 | 提供 intention action 把函数式通用视图**转换**为类视图 |
| 12 | **模型依赖图** | 为 Django models 生成依赖关系图（UML 式） |
| 13 | Endpoints 工具窗口 | 与 DRF 联动 |
| 14 | **模板实时预览** | Live preview of Django templates |
| 15 | **Django Structure 工具窗口** | 见下方展开 |
| 16 | Django Logical Structure | 逻辑结构视图 |
| 17 | **Django 专属 AI Actions** | 框架语境下的 AI 动作 |

配置面（`Python | Django` 设置页）：
- `Enable Django support`（开关，空项目默认关、Django 项目默认开）
- `Django project root`、`Settings`（任意匹配 `*settings*.py` 的文件，或指向包并把配置放 `__init__.py`——支持拆分成多模块）
- `Do not use Django test runner`（可改用 Integrated Tools 中指定的其他 test runner）
- `Manage script`（manage.py 路径）、环境变量、用于 VCS 追踪的 `Folder pattern to track file`（glob 支持；被标记为 Resources 且非模板目录会被跳过）

**Django Structure 工具窗口**（`django-structure-tool-window.html`）细节：
- 列出 Models / Admin classes / Views 三类组件，可按类型或按 App 分组，双击直达声明处；Settings 双击打开配置文件
- 按 App 分组时可用：新建 App、Make Migrations / Migrate（自动把 app 名填进终端）
- 模型：新建 Model、一键 `@admin.register` 注册到 admin、**未使用的 model admin 类会置灰**提示、从 admin 类跳到模型、重构、Find Usages
- 视图：新建 View（可选视图类型）、重构、Find Usages；**前提是该视图已在 urls.py 中被引用**才会出现

**DRF（Django REST framework）**：无独立插件页面，能力由 Django 插件 + Endpoints + HTTP Client + Database 工具窗口组合提供。官方教程（要求 PyCharm ≥ 2023.3）完整走通：ModelSerializer → 泛型类视图 → Endpoints 里 Submit Request → 响应落盘 → 权限/认证调试。换句话说，**DRF 的"端点视图"是复用 Django Endpoints 通道的**。

### 3.2 Flask —— 中等深度，靠 CLI + 模板 + 端点

官方 `Flask support` 原文列表（9 项）：

| # | 能力 | 说明 |
|---|---|---|
| 1 | Dedicated project type | 专属项目类型 |
| 2 | 内置 Flask debugger 支持 | 识别并支持 Flask 自带调试器 |
| 3 | Flask CLI | 命令行界面集成 |
| 4 | Jinja2 **与 Django** 模板支持 | 一个 IDE 同时支持两种模板语言 |
| 5 | Flask live templates 组 | 快速生成路由存根（route stub） |
| 6 | 视图 ↔ 模板导航 | —— |
| 7 | 代码补全与解析 | —— |
| 8 | Python 控制台变身为 Flask console | 启用 Flask 后控制台自带应用上下文 |
| 9 | Endpoints 工具窗口 | 与 Django/FastAPI 共用同一窗口 |

配置面：`Languages & Frameworks | Flask` 可关闭集成——关闭后**忽略 Flask 路由**且**不再自动生成 Flask 运行/调试配置**。这是典型的"识别即打扰"权衡开关。

### 3.3 FastAPI —— 宽而浅：4 项能力 + 极好的运行/调试配置

官方 `FastAPI` 页面明确：**PyCharm Pro 提供 4 项** —— 专属项目类型、编码辅助（Coding assistance）、运行/调试配置、Endpoints 工具窗口。

**项目模板**：新建 FastAPI 项目 → 自动装 `fastapi` + `uvicorn`，生成 `main.py` 与 `test_main.http`（可直接跑 GET 测试）。

**运行/调试配置**（`fast-api.html`，是三框架里最细的）：

| 配置项 | 内容 |
|---|---|
| Application file / name | 应用文件与实例名（留空时自动检测 `app = FastAPI()`） |
| Run using | **Uvicorn** / **Hypercorn** / **Dev mode**（服务器开发模式） |
| Run options | 透传服务器参数（示例 `--reload delay 10`） |
| Debug just my code | 只关注用户代码，跳过外部库 |
| Environment variables | 默认预置 `PYTHONUNBUFFERED=1`，支持从文本文件批量粘贴 |
| 解释器 / Interpreter options / Working directory | 常规 |
| Add content roots / source roots to PYTHONPATH | 常规 |
| Before Launch | 可挂 Launch Web Browser、Run Another Configuration、npm script、Compile TypeScript 等 |
| Logs | 日志文件别名、保存控制台输出、输出时自动激活控制台 |
| Store as project file | 默认存 `.idea/workspace.xml`；开启后存 `.idea/runConfigurations` 以便团队共享 |

**编码辅助的真实边界**（值得注意，常被高估）：
- 官方文档只描述了：inspections（+ Problems 工具窗口）、上下文感知补全、**端点名补全**（Python 文件、HTTP Client、其他项目文件里都能补全端点名）、HTTP Client 的 live templates、**端点重命名重构**（Shift+F6，全项目生效）
- **没有**任何关于 `Depends` 依赖注入、请求体/响应模型、路由层级的专属语义说明。也就是说 FastAPI 的"聪明"主要来自：通用 Python 类型推断 + **内置 Pydantic 支持** + Endpoints 列表

**端点管理**：Endpoints 工具窗口双击跳转；详情面板含 文档 / 生成的 HTTP 请求 / **生成的 OpenAPI 规范** / 客户端代码示例；行首 gutter 图标可 Find Usages、跑请求、查看下级端点、向上一级、复制 URL；`Open in Editor` 会把请求写进临时 scratch 文件。

> **反直觉之处（决定了我们的优先级）**：PyCharm 对 FastAPI 的**语义深度最浅**（4 项、无 DI、无请求体语义），却给了它**最细的运行/调试配置**。而框架使用率已经反超（FastAPI 38% > Django 35% ≈ Flask 34%，见 §0-7）。也就是说：**PyCharm 的投入分布是历史包袱**（Django 支持自 2010 年前后累积），不是当下需求排序。我们作为新工具**不应复刻它的投入曲线**——把资源压在 FastAPI 的"端点可见 + 端点可调"上（§8.3），正是它做得最浅、而增长最快的地方。

### 3.4 横向对比总表

| 能力 | Django | Flask | FastAPI |
|---|---|---|---|
| 专属项目类型 | ✅ | ✅ | ✅（装 fastapi+uvicorn，生成 main.py / test_main.http） |
| 专属运行/调试配置 | ✅（Django server） | ✅（自动生成，可抑制） | ✅✅（Uvicorn/Hypercorn/Dev mode，配置最细） |
| CLI / 管理命令集成 | ✅ manage.py（Ctrl+Alt+R） | ✅ Flask CLI | ⚠️ 仅服务器参数透传 |
| 模板语言支持 | ✅✅ Django Template（高亮/补全/block 名/自定义 tag/文档） | ✅ Jinja2 + Django Template | ❌（无模板概念） |
| 模板调试 / 实时预览 | ✅✅ 可下断点 + Live preview | ❌ | ❌ |
| 视图 ↔ 模板导航 | ✅ | ✅ | ❌ |
| ORM / 数据层语义 | ✅✅ Django ORM 洞察 + 模型依赖图 | ❌ | ❌ |
| 关键文件内补全/解析 | ✅ views/urls/models/Meta/settings | ✅ 通用补全与解析 | ✅ 通用补全与解析 |
| Live templates | ✅ 模板专用 | ✅ 路由存根 | ⚠️ HTTP Client 专用 |
| 控制台 | ✅（manage.py console） | ✅（Python console 变 Flask console） | ❌ |
| Endpoints 工具窗口 | ✅（含 DRF） | ✅ | ✅ |
| 从端点生成 OpenAPI / HTTP 请求 | ✅ | ✅ | ✅（OpenAPI 由框架天然产出，体验最好） |
| 框架专属结构/导航窗口 | ✅✅ Django Structure + Logical Structure | ❌ | ❌ |
| 框架专属 AI Actions | ✅ | ❌ | ❌ |
| 集成开关 | ✅ `Python | Django` | ✅ `Languages & Frameworks | Flask` | 🔍 依赖 Endpoints 插件开关 |

---

## 4. 公共基建：真正撑起"Web 开发体验"的三件套

### 4.1 Endpoints 工具窗口（三框架共用）

- 覆盖：Django（含 DRF）/ FastAPI / Flask；按 **application / type / framework** 三维过滤
- 导航：右键 Jump to source、F4、双击；或 `Navigate | Endpoint`（`Ctrl+Shift+\`）搜索
- 显示控制：Compact List Items、Group by Application、**Show From Libraries**、**Show From Tests**；deprecated 端点加删除线
- 详情面板四页：**生成的 HTTP 请求**（Django URL 参数用 `{{ }}` 包裹）→ 服务在跑时可 `Submit Request` 或 `Open in Editor`；**生成的 OpenAPI 规范**（可单独文件预览）；**HTTP 方法的文档**；**客户端代码示例**（可选框架/语言，可存为 scratch 文件）
- OpenAPI Specifications 插件：可挂外部 OpenAPI/SwaggerHub 规范，端点以黄底标出，**并把规范里的 URL 加进代码补全**

> 判断：这是 PyCharm 三框架支持的"统一收口层"。框架侧只需产出"端点声明"，UI/调试/请求生成全部复用——**任何想做框架支持的 IDE 都应该先做这一层，而不是先做框架语义**。

### 4.2 HTTP Client（`.http` 文件）

- Endpoints → `Open in Editor` → 临时 scratch 文件 → gutter 图标直接发请求；`.http` 文件可单条或批量执行（Services 工具窗口里看每条状态）
- FastAPI 项目模板直接送 `test_main.http`，等于"新建即可调"

### 4.3 数据库工具（Pro）

Django/DRF 场景下 `db.sqlite3` 首次打开即被注册为数据源，Database 工具窗口可直接浏览表数据——把"模型 → 迁移 → 表 → 接口返回"串成一条线。这是框架体验的隐形加分项，但也是纯 Pro 能力。

---

## 5. 生态层：被内置支持的"非框架"库

### 5.1 Pydantic（**内置**，一等公民）

官方 `pydantic-support.html`：基于同一套类型引擎，覆盖 `BaseModel` 及子类、`pydantic.dataclasses.dataclass`、泛型模型、`Field`、字段/模型校验器、`ConfigDict`，**v1 与 v2 双认**。具体能力：

- 实例化时把声明字段当作 `__init__` 关键字参数补全（含 `Annotated` 默认值）
- 传值类型检查（对照注解）
- **缺失必填字段**的 inspection
- 关键字参数 ↔ 字段声明双向跳转（跨子类/基类）
- 字段改名：同步 `__init__` 调用处 + 向子类/基类传播；反向亦可
- `Field(alias=...)`、`populate_by_name` / `validate_by_name` / `validate_by_alias`：不误报 unexpected argument
- `@field_validator` / `@model_validator` / `@validator` / `@root_validator` 被识别为校验器，首个参数正确定型并抑制误报

> 这是**理解 FastAPI 体验的关键**：FastAPI 本身没有深度语义，但 Pydantic 有——用户感知到的"FastAPI 很智能"八成来自这里。

### 5.2 其他生态

| 库 / 领域 | 状态 | 说明 |
|---|---|---|
| Django REST framework | ⚠️ 间接 | 无独立集成页，靠 Django 插件 + Endpoints + HTTP Client 覆盖 |
| Pydantic | ✅ 内置 | 见 5.1 |
| SQLAlchemy | 🔍 无专属 | 未检索到独立集成页；仅通用 Python 代码洞察 |
| Celery | 🔍 无专属 | 同上 |
| 前端栈（JS/TS/React/Vue/Angular）+ HTML/CSS | ✅ Pro | 与框架支持同属 Pro 卖点，但非 Python 框架范畴 |
| Jupyter / 科学计算（Matplotlib、NumPy、pandas、PyTorch、Hugging Face） | ✅（核心免费） | 2025.1 后 Jupyter 归入免费核心 |

---

## 6. 不支持 / 已退场的框架

| 框架 | 状态 | 证据 |
|---|---|---|
| **Pyramid** | ❌ 未捆绑 | `pyramid.html` 原文："Support for Pyramid development is **not bundled** with PyCharm."，并指向"早期版本文档" |
| **web2py** | ❌ 已淡出 | 当前 2026.2 Help 无独立页面；仅旧版营销文案提及（🔍 推断已移除） |
| **Google App Engine** | ❌ 已淡出 | 官方页面仅存于 **2023.3 及更早**版本存档；当前 Help 无此页（🔍 推断已移除） |
| Sanic / Tornado / aiohttp / Falcon / Bottle / Litestar / Django-Ninja / Starlette | 🔍 无专属集成 | 当前 Help 未检索到任何专属支持页；只能享受通用 Python 支持（Starlette 仅随 FastAPI 间接运行，无语义） |

> 结论：JetBrains 的策略是**收敛到三个主流框架做深**，其余一律放弃。连曾经官方支持的 Pyramid / GAE 都被放弃——说明"框架集成"的维护成本高于其长尾收益，这是很明确的行业信号。

---

## 7. 支撑机制：PyCharm 为什么能做得到

把现象抽象成可迁移的架构结论：

1. **框架开关是项目级显式配置**（`Python | Django`、`Languages & Frameworks | Flask`），而不是"自动猜"。猜错了代价高（误报路由、误生成配置），所以官方宁可让用户勾一下——并且**提供关闭开关**以抑制打扰。
2. **框架能力与 SDK/解释器强绑定**：官方文档把"Django 与对应 Python 解释器已正确安装"列为前提；Django Structure 页面明确"未配置解释器/依赖时结构可能显示错误"。即框架语义依赖**真实可导入的框架源码**。
3. **一个"收口 UI"吃掉三框架**：Endpoints + HTTP Client + OpenAPI 插件。框架侧只需实现"端点声明采集"。
4. **深度语义只给最主流框架**：ORM 洞察、模型依赖图、模板调试、结构窗口——这些是 Django 独占，本质是因为 Django 的约定足够强（settings / models / admin / urls 都有固定形态），值得写规则。
5. **库级支持下沉到类型引擎**：Pydantic 不是"FastAPI 插件"，而是类型引擎上的一层——可复用于任何用 Pydantic 的项目。
6. **重构闭环**：端点重命名走标准 Rename（Shift+F6），说明端点被建模成了**可导航的符号**，而非字符串。

---

## 8. 对 Montauri 的启示

### 8.1 现状核对

| 现有能力 | 位置 | 对应 PyCharm 的哪一档 |
|---|---|---|
| `detect_framework`（探针表：Django `manage.py` / FastAPI `X = FastAPI(` / Flask `X = Flask(` → 返回统一 `FrameworkPreset`；工作区级 `framework_hints` 可逐框架关闭） | `shell/src-tauri/src/env_cmds.rs` | 静态约定识别 |
| 一键生成框架运行预设（Django `manage.py runserver` / FastAPI `-m uvicorn …` / Flask `-m flask --app … run`，cwd 均为工作区根）+ 服务 URL 自动打开（`Uvicorn running on` / `Starting development server at` / `* Running on`） | `shell/src/runFlow.ts` + `shell/src/termUi.ts` | 运行/调试配置（PyCharm 最细的一档） |
| 依赖健康：traceback `ModuleNotFoundError: No module named 'fastapi'` → 一键安装 | `depHealth` | PyCharm 没有的对等能力（我们更强） |

判断：**我们已经踩在"投入产出比最高"的那一档上**——静态约定识别 → 自动生成运行配置 → 自动打开服务 URL。这正是 PyCharm 花最多篇幅写的东西（FastAPI Run/Debug Configuration 是三框架里最细的），而我们用不到百分之一的代码量覆盖了。

### 8.2 路线图（按 2026-09-26 裁决重排：FastAPI 深 / Flask 中 / Django 浅）

> **已交付（2026-09-26）**：三框架探针表（`detect_framework`：Django `manage.py` → `manage.py runserver`；FastAPI `X = FastAPI(` → `-m uvicorn <module>:<var> --reload`；Flask `X = Flask(` → `-m flask --app <module>:<var> run`）+ 工作区级关闭开关（`set_framework_hint_disabled`，存 workspace config 的 `framework_hints`）+ 提示去重改「工作区 + 框架」粒度；服务 URL 自动打开从「仅 Uvicorn 就绪行」扩展到 Django dev server（`Starting development server at …`）与 Flask/Werkzeug（`* Running on …`）。

| 档位 | 目标 | 范围 | 级别 |
|---|---|---|---|
| **第一档 · FastAPI（做深）** | 「地基先验证 + 端点可见 + 端点可调」 | F0 Pydantic 引擎验证（先做）/ F1 端点列表侧栏 / F2 端点一键直达浏览器 / F3 运行配置增强（服务器与端口）/ F4 打开 `/docs` 与 `/openapi.json` | **P1（建议做）**，详见 §8.3 |
| **第二档 · Flask（做中）** | 复用 FastAPI 的同一套扫描与 UI，只加规则 | L1 端点规则（`@app.route` / Blueprint 前缀）/ L2 运行配置 `--debug` 与端口 / L3（可选）视图 ↔ 模板跳转 | **P2**，详见 §8.4 |
| **第三档 · Django（做浅）** | 冻结在探测 + 运行配置层 | D1 保持现状（manage.py 探测 + runserver 预设）/ D2（可选）常用 manage.py 子命令一键插入 | 已交付 / D2 为 **P3 可选**，详见 §8.5 |
| **不做** | —— | FastAPI 依赖注入与请求体语义、端点重命名重构、Jinja2 / Django Template 语言服务、Django ORM / 模型依赖图 / Structure 工具窗口 / 模板调试 | 见 §8.3 F5–F6、§8.4 L4、§8.5 D3 |
| **差异化候选（Phase 5+）** | probe 驱动的端点命中热度 / 请求耗时 | PyCharm 完全不具备（其 Profiler 不按端点聚合）；与我们 PEP 669 采样底座天然契合 | probe / intel |

**投入分配建议**：FastAPI : Flask : Django ≈ **6 : 3 : 1**。理由不是"用户投票数"（35% vs 38% 差距很小），而是**单位投入的可复用性**——FastAPI 的端点扫描器 + 侧栏 + 运行配置增强，Flask 只需加一条正则即可继承 80%（`@app.route` 与 `@app.get` 形态几乎一致）；Django 的每一项专属能力（ORM / 模板 / admin / settings）都是**独立且与前两者零复用**的深水区，所以浅做。

### 8.3 FastAPI 深化清单（第一档，重点）

> **落地状态（2026-09-26，第一档 F0–F4 全部交付 + 验收）**：F0 ✅（裁决 B 已实施，见下）· **F1 + F2 + F4 ✅**——Rust `fs_cmds::scan_endpoints`（静态路由扫描 + 前缀合并，`@app.get` / `@router.get` / `@app.route` / `APIRouter(prefix=)` / `include_router` / `register_blueprint` / Blueprint `url_prefix`，纯文本逐行解析零子进程，`MAX_ENDPOINTS=2000`）+ 侧栏「端点」工具窗（`endpointView.ts`，按方法分组、点击跳转声明、行内浏览器打开 / 复制 URL，`termUi::lastServiceBaseUrl` 提供服务 base）+ 工具条 `/docs` 与 `/openapi.json` 固定入口；Flask L1 规则同批顺带交付。**F3 ✅**——FastAPI 预设按依赖声明选服务器（uvicorn → hypercorn，皆无 → uvicorn 缺省 + 提示缺失），Flask 预设带 `run --debug`（Werkzeug 调试器 + reloader，对标 PyCharm「内置 Flask debugger」）；termUi 就绪行正则放宽覆盖 Hypercorn（无星号前缀的 `Running on …`）。**F3 裁剪说明**：`--host/--port` 不做便捷字段（配置面板 args 已可编辑，加字段属重复表达）；PyCharm 的 "Dev mode" 选项不设（uvicorn 的 `--reload` 即开发模式）。已知边界：多行装饰器（path 换行）、多级 include_router 嵌套合并不支持（静态逐行正则级，只合并一层 include）。
>
> **E2E 验收（2026-09-26，`shell/e2e/ux/02-frameworks.spec.ts`，6/6 绿）**：FW-1 Pydantic 提示 + 一键切换 basedpyright（chip 变化）· FW-2 FastAPI 提示 + 一键生成 project_run（形状断言）· FW-3 工作区级关闭开关 reload 持久 · FW-4 端点分组 + 跳转 · FW-5 打开/复制 URL（无 base 提示 + 注入 base 落点）· FW-6 /docs 与 /openapi.json。mock 面扩展在 `e2e/mocks/tauri-mock.js`（detect_framework / detect_pydantic_stack / scan_endpoints / set_framework_hint_disabled / project_run，hints 持久 sessionStorage；open_external / copy_to_clipboard 记录落点），服务 base 经 `termUi` 的 `__OC_E2E_SERVICE__` 钩子注入。basedpyright 的真实候选观感不在浏览器 mock 范围（由 `bench/reports/pydantic-engine-probe.md` 实测覆盖）。
>
> **顺带修复 A（2026-09-26）**：E-BASIC-3（Ctrl+W 放行契约）既有失败——`browserKeys.ts::installBrowserKeyGuard` 对 Monaco 内已认领的智能选区键（`CLAIMED_IN_MONACO`：Ctrl+W / Ctrl+Shift+W）在 window 键位未认领时**既不吞也不 preventDefault**，与设计注释「仍然 preventDefault 阻断浏览器动作、只放行事件传播」不符，实际会让 WebView2 直接执行关闭窗口（引入点 5e6542f）。修复：认领分支改为 `windowClaimed || isClaimedInMonaco(...)`；修复后 E-BASIC-1（智能选区）与 E-BASIC-3 同绿，e2e 全量 129/129。
>
> **真机复现与修复 B（2026-09-26，`shell/e2e-real/endpoints-real.cjs`）**：用户实测报告「打开一个外部 FastAPI 项目工作区，端点侧栏点击各端点均报『打开文件失败』」。**根因**：`scan_endpoints` 返回相对工作区根的 `file`，而 `openFile` → Rust `read_file` 直接 `fs` 读、只认绝对路径（`todoView` 未踩坑是因 `scan_todos` 契约本就是绝对路径）；浏览器 mock 桥的 fs read_file 对相对路径 join 仓库根兜底，**复现不了**——需真机层（真实 Rust read_file）。真机脚本驱动 tauri dev + CDP 打开该 FastAPI 项目工作区：复现 12 端点全报「系统找不到指定的路径 (os error 3)」→ 修复（`scan_endpoints` 的 `file` 改为**绝对路径**，对齐 scan_todos 契约）→ 真机复验 4/4 PASS（点击端点成功打开 api.py）。教训：**跨层路径契约（相对 vs 绝对）必须在真机层验收**，mock 桥的兜底会掩盖契约缺口。
>
> **测试复盘（同日）**：原单测按实现的相对形状写断言，把错误契约钉死了；e2e mock 桥的兜底又测不出缺口——两层都没守在正确的位置。补齐：① Rust 新增**消费者契约测试** `endpoints_files_readable_by_openfile_consumer`（对扫描结果的每个 file 直接走 fs 读取，改回相对路径即红；已做反向验证——临时改回相对实现，测试确实失败）；② flask/edges 单测补 file 绝对断言；③ e2e mock 样本 file 改为绝对路径，对齐 Rust 真实形状。重跑：Rust 208 ✅、02 spec 6/6 ✅、e2e 全量 129 + 1 个无关 LSP flake（单独重跑 4/4）✅。

对标对象 = PyCharm 给 FastAPI 的 4 项能力 + 公共三件套（见 §3.3 / §4）。裁剪原则：**只取"静态可判定"与"复用已有通道"的部分**，不引入 HTTP Client 引擎、不解析框架源码。

| # | 能力 | PyCharm 对应 | 我们的做法 | 成本 | 级别 |
|---|---|---|---|---|---|
| **F0** | **验证 Pydantic 在当前静态引擎上的效果**：`BaseModel` 字段补全 / 传值类型检查 / 缺失必填报错 / 跨子类改名 | Pydantic 内置支持（§5.1） | FastAPI 的"智能感"八成来自 Pydantic 而非框架本身（PyCharm 亦如此，§5.1）。我们默认引擎 pyrefly、备选 basedpyright（架构上首日可切换）——**先跑一组受控用例确认开箱效果**，不达标再决策「切引擎 / 补一层」。成本 = 一次验证；价值 = 决定后续所有 FastAPI 体验的地基 | **低** | **✅ 已验证（2026-09-26）**，结论见下 |
| **F1** | **端点列表侧栏**：扫 `@app.get/post/put/patch/delete/api_route/websocket` 与 `@router.<method>`，解析 `APIRouter(prefix=, tags=)` 与 `include_router(..., prefix=)` 合并前缀 → 侧栏按方法分组列出，点击跳转到声明行 | Endpoints 工具窗口 | **照 TODO 工具窗先例做**（`fs_cmds::scan_todos` + `todoView.ts`）：Rust 新增扫描命令（`.gitignore` 感知已就绪于 `search_workspace`、限深限数、纯文本/正则，零子进程），侧栏挂 `views.ts` 注册表 | 中 | **P1** |
| **F2** | **端点一键直达浏览器**：服务在跑时，点端点项 → 用系统浏览器打开 `<base><path>`；未跑则提示先运行 | HTTP Client 的 `Submit Request` | 复用**已有两条通道**：`termUi` 就绪行解析出的 base URL（可提升为模块级 `lastServiceBaseUrl()`）+ `file_ops::open_external`。零新进程、零新依赖；代价是只能发 GET（POST/带 body 用浏览器打不了） | **低** | **P1**（与 F1 同批） |
| **F3** | **运行配置增强**：服务器可选 `uvicorn` / `hypercorn`（对齐 PyCharm `Run using` 三选一；调查显示 uvicorn / Hypercorn / Granian 正在取代 uWSGI 与 Gunicorn）、`--reload` 默认、`--host/--port` 便捷字段 | FastAPI Run/Debug Configuration（PyCharm 最细的一档） | 预设生成时给 args 模板 + 配置面板字段（`runConfigPanel.ts` 已有）；app 变量自动检测已完成 | 低 | **P1** |
| **F4** | **打开 `/docs` 与 `/openapi.json`**：端点侧栏给两个固定入口（FastAPI 自带 Swagger UI） | Endpoints 详情面板的 OpenAPI 页 + HTTP Client | 同样复用 `open_external`，**零新依赖**。IDE 内渲染 OpenAPI 留作 P3：需新增 HTTP 客户端依赖（当前 `Cargo.toml` 无 reqwest/ureq 等），且 FastAPI 默认不配 CORS，前端 fetch 会被拦——**先走浏览器，性价比最高** | 低（浏览器版） | **P1（浏览器版）** |
| **F5** | 端点重命名（Shift+F6，全项目路径字符串同步） | Rename 重构（端点被建模为符号） | **不做**：端点路径是字符串字面量，需把端点建为可导航符号；函数改名已由 LSP rename 覆盖，收益与成本不成比例 | 高 | 不做 |
| **F6** | `Depends` 依赖注入 / 请求体-响应模型语义 | **PyCharm 也没有**（见 §3.3：官方未列任何 DI 语义） | **不做**：靠静态引擎类型推断 + Pydantic 自然兜底（与 PyCharm 同策略）；即便要做也应下沉为类型引擎能力，而非 IDE 层 | 高 | 不做 |
| **F7** | 依赖前置检查（缺 fastapi / uvicorn / hypercorn 提示） | 无对应 | 已有雏形：`FrameworkPreset.missing`（提示行里提示 `uv add uvicorn`）；可顺带覆盖 hypercorn | 低 | P2 |
| **F8** | probe 驱动的端点命中热度 / 请求耗时 | PyCharm 无（Profiler 不按端点聚合） | 差异化，Phase 5+ 评估 | 高 | 候选 |
| **F9** | **新建 FastAPI 项目**：向导选「FastAPI 服务」类型 → 生成 `app = FastAPI()` 模板 main.py + pyproject 写入 fastapi/uvicorn 依赖 + 开箱即可一键运行 | 专属项目类型（§3.3：装 fastapi+uvicorn，生成 main.py / test_main.http） | 下游全链路已就绪（F1 端点扫描、F3 uvicorn 预设、探针表提示），只缺创建入口。实施计划见 §8.3.1（PR-R） | 中（1.5~2 天） | **P1（已立项，PR-R）** |

**F0 实测结论（2026-09-26，详见 `bench/reports/pydantic-engine-probe.md`）**

| 能力 | pyrefly 1.3.0（当前默认） | basedpyright 1.40.1 | PyCharm |
|---|---|---|---|
| 字段补全 / hover | ✅ | ✅（候选噪声大，127 条） | ✅ |
| 传值类型检查 | ❌ 零诊断 | ✅ | ✅ |
| 缺失必填报错 | ❌ 零诊断 | ✅ | ✅ |
| 字段改名传播到调用处 | ❌ references=0，**只改声明处（静默漏改）** | ✅ 覆盖 3 处调用 | ✅（含跨子类/基类） |
| alias / ConfigDict 不误报 | 静默（不校验也不误报） | ⚠️ 双向误报 | ✅ |
| validator 不误报 | ✅ | ✅ | ✅ |

**根因不是"不认 Pydantic"**：标准库 `@dataclass` 对照组在 pyrefly 上同样零诊断 → 缺的是整块「`__init__` 构造参数校验 + 字段↔调用处引用关系」（PEP 681 `dataclass_transform` 语义链）。

**裁决：B + C（B 已落地，2026-09-26）**——工作区依赖含 `pydantic` / `fastapi` 时**提示推荐**切换 basedpyright（Rust `detect_pydantic_stack` + 前端 `pydanticEngineHint.ts`，每工作区每会话一次、仅 pyrefly 时提示；关闭开关 = `framework_hints["pydantic_engine"]`，切换走 `engineChip::switchEngineTo` 同一套语义）；C 仍开放（跟踪 pyrefly 进展，达标回切）。**注意第 4 项是"重命名静默漏改"而非"少一个提示"，风险等级高于其他项。**落地细节（含 alias 误报不可单独规避的连坐实验）见 `bench/reports/pydantic-engine-probe.md` §4.1。

#### 8.3.1 F9 实施计划：新建 FastAPI 项目（PR-R，2026-09-30 立项，量级 1.5~2 天，单 PR）

> **落地状态（2026-09-30 同日交付 + 验收）**：F9 ✅。交互裁决（用户确认）：下拉文案「Python 脚本」/「FastAPI 服务」（简洁版）；预览行追加「（FastAPI 服务 入口 main.py + fastapi / uvicorn 依赖）」；依赖安装失败 toastFail + 成功静默（流式输出即完成信号）；低版本（<3.10）警示不做（登记为边缘态）；e2e 增 NP-3（下游零接线 hint 验收）。实施：Rust `create_project` 加 `project_type`（`inject_project_deps` 行扫描注入——空 `dependencies = []` 替换 / 已有非空键保留 / 无键段末插入，实测 uv 0.10.11 `init --bare` 产物即空数组形态）；前端 `projectTypeMeta` 纯函数 + 第 4 阶段 `pip_install`（uv add）best-effort 安装；e2e mock 双侧补 `create_project`（真实磁盘）+ `pip_install`（exit 0）+ `equipPage(startEmpty)`（启动停欢迎页——有工作区时 `#ew-actions` 隐藏）。验收：cargo 246/246 · tsc 零错误 · vitest 885/885（新增 `newProjectType.test.ts` 4 用例）· e2e ux+dx 84/84（新增 `ux/03-new-project-fastapi.spec.ts` NP-1/2/3）。
>
> **真机修复 A（2026-09-30，用户实测报告）**：创建 FastAPI 项目时依赖安装报 `invalid type: null, expected a string`——前端 F9 调 `pip_install` 传 `interpreter: null`，而 Rust 签名是 `interpreter: String`（非 Option），Tauri 反序列化直接报类型错。**浏览器 e2e 复现不了**：mock 对 `pip_install` 静态返回 0，不校验参数类型契约（与 §8.3 修复 B「mock 兜底掩盖路径契约缺口」同源，这次是参数类型契约的翻版）。修复：`pip_install` 的 `interpreter` 改 `Option<String>`——`uv add` 分支本就不用解释器，`uv pip install` 分支对 None 提前报可读错误；对既有调用方（都传字符串）零破坏。补真机层防复发：新增 `shell/e2e-real/new-project-fastapi-real.cjs`（NP-REAL-1..4，CDP 驱动 tauri dev + 真实 uv：面板 → 创建落盘 → 安装无类型错 → uv.lock 生成），修复后 4/4 PASS。真机脚本两处时序坑（已写入脚本注释）：① `dismissBlockingModals` 不得按序全点按钮——storage-onboarding 的「自定义位置…」会拉起原生目录框阻塞 UI，只点 `.btn--primary`；② `#ew-new-project` 监听器在 init 尾部才挂，CDP 连上即点会落空——须「点击 → 验证面板打开 → 重试」循环（mock e2e 因 invoke 全同步 init 极快，掩盖此差异）。

**方案一句话**：新建项目面板加「项目类型」下拉（脚本 / FastAPI），Rust `create_project` 按 `project_type` 切换 main.py 模板 + 把 `fastapi`/`uvicorn` 写进 pyproject dependencies；创建后复用 `pip_install`（uv add）装依赖（best-effort）；下游零接线——`detect_framework` 探针自动命中 → 既有「一键生成配置并运行」提示接管。

```
面板选 FastAPI → create_project(projectType)
  ├─ main.py = FastAPI 模板（app = FastAPI() + 2 条示例路由）
  ├─ pyproject dependencies += ["fastapi", "uvicorn"]   ← 两条生成路径都要注入
  └─ openWorkspace 后：pip_install("fastapi uvicorn")（uv add，幂等，失败不阻断）
                          ↓ 零新接线
       detect_fastapi_preset 命中（deps 含 fastapi + 源码 app = FastAPI(）
                          ↓
       「生成『FastAPI』配置并运行」hint → uvicorn main:app --reload
```

**Rust 侧（`fs_cmds.rs`，半天）**：

1. 命令参数（`create_project` / `create_project_impl`）：加 `project_type: Option<String>`（`"script"` | `"fastapi"`，`None`/空 = script，旧调用零感知）。`CreateProjectResult` 不动。
2. FastAPI main.py 模板（替换现有硬编码的 `def main()` 模板）：

   ```python
   from fastapi import FastAPI

   app = FastAPI()


   @app.get("/")
   def root() -> str:
       return "Hello from Montauri FastAPI!"


   @app.get("/items/{item_id}")
   def read_item(item_id: int, q: str | None = None) -> dict:
       return {"item_id": item_id, "q": q}
   ```

   模板设计依据：① `app = FastAPI()` 命中 `scan_app_decl`；② 两条路由让端点视图开箱有内容（`{item_id}` 顺带演示路径参数保留）；③ 注解驱动契合 pyrefly；④ `str | None` 需 3.10+，默认 `requires-python >= 3.12` 已满足。
3. dependencies 注入（**两条生成路径都要**）：
   - 方案 B（`write_min_pyproject`）：加 `deps: &[&str]` 参数拼进 `dependencies = [...]`；现有两处调用方（create_project + `env_cmds.rs::init_pyproject`）传空切片保持行为。
   - 方案 A（`uv init --bare` 成功后）：行扫描插入 `dependencies = [...]`——复刻 `normalize_project_name` 的字符串扫描先例（不引 TOML 依赖）：在 `[project]` 段内、下一个 `[` 段之前插行；已存在 `dependencies` 键则跳过。`pyproject_note` 相应更新（如「…并写入 fastapi / uvicorn 依赖」）。

**前端（`newProject.ts` + `index.html`，半天）**：

1. `index.html`（环境行之前）加「项目类型」select：`#new-project-type`，`script`（默认）/ `fastapi`（FastAPI 服务）；
2. `newProject.ts`：
   - 新纯函数 `projectTypeMeta(type)` → `{ label, deps: string[] }`（供 preview 文案 + 安装 spec 共用，单一实现防漂移）；
   - `createProject()` invoke 加 `projectType`；
   - preview 增强：选 fastapi 时追加「（FastAPI 入口 + fastapi/uvicorn 依赖）」；
   - 安装步骤：环境配置 try 块之后、`closeNewProjectPanel()` 之前，fastapi 时调既有 `pip_install`（spec = `"fastapi uvicorn"`）——有 pyproject 自动走 `uv add` 分支，输出经 pip-stdout 流式；按钮 busy 态「安装依赖…」；**失败不阻断**：catch 后 `appendOutputLine` stderr「依赖安装失败（声明已写入 pyproject.toml，不阻断）：…，可稍后运行项目由 uv 自动同步」。
   - 打开面板时 reset `#new-project-type` 为 script（同 venv 复位口径）。

**e2e 基建（mock 缺口补齐，半天）**：

- 现状缺口：`create_project` 在 mock 双侧均未映射（`tauri-mock.js` FS_CMDS 与 `helpers.ts` FS_DISPATCH_CMDS 均无）——新建项目面板从未被 e2e 覆盖（与 PR-K 新建文件同款缺口）。
- 补法：`helpers.ts` `dispatchFs` 加 `case "create_project"`（真实磁盘：建目录 + 按类型写模板 + 写最小 pyproject + 返回 `CreateProjectResult` 形状）+ FS_DISPATCH_CMDS 白名单。模板内容与 Rust 粗粒度同步（断言只锁 `FastAPI(` / `fastapi`，注释互指防漂移细节）。
- 新 spec `e2e/ux/03-new-project-fastapi.spec.ts`（放 ux 域，与 02-frameworks 同族）：
  - NP-1：默认「脚本」类型创建 → main.py 为 `def main()` 模板（回归）；
  - NP-2：选 FastAPI 创建（**parent 填 repo.root**，绕开 dispatchFs 的越权 guard）→ 工作区切换成功 → main.py 打开且含 `app = FastAPI(` → 磁盘 pyproject 含 `"fastapi"`（`repo.read()` 断言）→ busy 态复位。

**测试与验收基线**：

| 层 | 用例 |
|---|---|
| Rust 单测（`fs_cmds.rs` impl 级） | ① fastapi：main.py 含 `app = FastAPI(`、pyproject 含 `"fastapi"`（**路径无关断言**——CI 有无 uv 走 A/B 均过）；② dependencies 行扫描插入：无键插入 / 已有键跳过 / `[project]` 后跟 `[tool.uv]` 段的插位；③ 既有 3 个 create_project 测试零改动（script 默认回归） |
| vitest | `projectTypeMeta` 纯函数（label/deps/未知值回退 script） |
| e2e | NP-1/NP-2 + ux 域回归 |
| 通用 | `tsc` 全绿 · `cargo test` · `npm run test` · e2e ux + dx 域回归 |

**关键设计决策（已定，实施勿摇摆）**：

1. **依赖写入模板阶段、安装 best-effort**：「创建永不因 uv 缺席/联网失败而失败」是既有铁律——声明先落盘（永不失败），`uv add` 是增强步骤，失败只提示。声明已在，运行时 uv run 兜底自动同步，闭环不破。
2. **用 `pip_install` 而非新命令**：它已带「有 pyproject → uv add + 流式 + cwd」全套语义，零 Rust 新增。`uv add` 对已声明依赖幂等（顺带补版本下界，可接受）。
3. **不做 test_main.http**：HTTP Client 明确非目标（§0-6 裁决），端点视图 + 复制 URL 已覆盖「可调」。
4. **Flask/Django 模板不进本 PR**：Flask 复用同套扫描但优先级次之（§8.4）；数据结构（`projectTypeMeta`）已预留扩展位，后续一个 option + 一个模板的边际成本，单独立项。
5. **系统解释器 + uv add 建 .venv 的边缘**：用户明确选 system 后 uv add 可能创建 .venv，运行预检会提示——可接受的边缘态，不在本 PR 纠结（登记）。

**风险与登记**：

- 行扫描插入与 uv 未来版本产物变化：断言用 contains，`dependencies` 已存在时跳过，天然幂等；
- e2e 切工作区后 LSP 重启（mock 下 lsp 命令返回 null，安全）；`#status-git` 断言等 boot 稳定（ux/02 同款 20s 预算）；
- 耗时命令一律子进程 + 明确超时，勿串行拉起多个耗时进程。


### 8.4 Flask 支持边界（第二档）

| # | 能力 | 说明 | 级别 |
|---|---|---|---|
| **L1** | 端点列表：**复用 F1 的扫描器，只加一条规则**（`@app.route("/x", methods=[...])` / `@bp.route` + `Blueprint(prefix=)` + `register_blueprint(prefix=)`） | F1 落地后近乎零成本；UI 与交互完全共用 | **P2**（随 F1 之后） |
| **L2** | 运行配置增强：`--debug`（Werkzeug debugger + reloader，对齐 PyCharm"支持内置 Flask debugger"）、`--port`；`--app <module>:<var>` 自动检测已完成 | 预设 args 模板，成本低 | **P2** |
| **L3** | 视图 ↔ 模板跳转（扫 `render_template("x.html")` → 跳到 `templates/x.html`） | 可选：复用 F1 的扫描与跳转通道；**只做跳转，不做 Jinja2 语言服务** | P3 可选 |
| **L4** | Jinja2 模板语言服务（高亮 / tag 补全 / 变量解析） | **不做**：需独立语言服务进程，成本显著；对标 PyCharm 也是 Pro 的模板引擎能力，非我们目标用户的痛点 | 不做 |

### 8.5 Django 支持边界（第三档，浅做）

**做（已交付 / 可选）**

| # | 能力 | 状态 |
|---|---|---|
| **D1** | `manage.py` 探测 → 生成 `manage.py runserver` 项目运行配置 + 服务 URL 自动打开 + 工作区级可关闭 | ✅ **已交付**，到此为止（冻结） |
| **D2** | 常用 manage.py 子命令一键插入终端（`makemigrations` / `migrate` / `createsuperuser` / `runserver`） | P3 可选；机制已存在（`termUi::runTerminalCommand` 高频命令插入），只是加一条命令表 |

**明确不做（D3）**

| 能力 | 不做的理由 |
|---|---|
| Django ORM 语义洞察 / 模型依赖图 | 需可导入的真实 Django 源码 + 版本适配的持续维护（§8.6） |
| Django Structure / Logical Structure 工具窗口 | 与我们的侧栏体系零复用；依赖 models / admin / urls 的深层解析 |
| 模板调试 / 实时预览 / Django Template 语言服务 | 需模板语言服务 + 调试器对模板帧的支持，成本量级不同 |
| `settings.py` 解析 / admin 注册检查 / 未注册模型提示 | 每加一条即绑定一个 Django 内部约定，长期维护成本高 |
| DRF（序列化器 / 视图集 / 权限）专属语义 | 无 DRF 用户画像支撑；端点层若要覆盖，走 F1 扫描器加规则即可（`@api_view` / `router.register`） |

### 8.6 一条需要记住的原则

PyCharm 的经验（含 Pyramid / GAE 被放弃）说明：**框架集成的长期成本在"跟随框架版本演进"，不在"首次实现"**。若将来要做，优先选择"约定稳定、不依赖框架内部 API"的静态识别路径，避免解析框架源码结构——这与本项目"自研组件独立成包/进程、不侵入静态引擎内核"的第一原则一致。

---

## 9. 参考来源

| 主题 | 链接 |
|---|---|
| Django 支持（总览，2026-02-04） | https://www.jetbrains.com/help/pycharm/django-support.html |
| Django 设置页 | https://www.jetbrains.com/help/pycharm/django.html |
| Django Structure 工具窗口（2024-10-11） | https://www.jetbrains.com/help/pycharm/django-structure-tool-window.html |
| 用 DRF 构建 API（2025-02-10） | https://www.jetbrains.com/help/pycharm/building-apis-with-django-rest-framework.html |
| Flask 支持（2025-03-26） | https://www.jetbrains.com/help/pycharm/flask.html |
| FastAPI（项目/编码辅助/端点，2025-09-11） | https://www.jetbrains.com/help/pycharm/fastapi-project.html |
| FastAPI 运行/调试配置（2026-03-04） | https://www.jetbrains.com/help/pycharm/fast-api.html |
| Endpoints 工具窗口（2026-08-17） | https://www.jetbrains.com/help/pycharm/endpoints-tool-window.html |
| Pydantic 支持（2026-07-28） | https://www.jetbrains.com/help/pycharm/pydantic-support.html |
| Pyramid（未捆绑，2025-09-16） | https://www.jetbrains.com/help/pycharm/pyramid.html |
| PyCharm 2025.1 统一版公告 | https://blog.jetbrains.com/pycharm/2025/04/pycharm-2025-1/ |
| Google App Engine（仅 2023.3 存档） | https://www.jetbrains.com/help/pycharm/2023.3/google-app-engine.html |
| **The State of Python 2025（一手：FastAPI 29%→38%、Web 占比 46%、uvicorn/Hypercorn/Granian 取代 uWSGI/Gunicorn、50% 受访者编程经验 <2 年）** | https://blog.jetbrains.com/pycharm/2025/08/the-state-of-python-2025/ |
| 框架使用率 38% / 35% / 34%（**二手转述**，官方博客只明确给出 FastAPI 29%→38%；此三数待一手核实） | https://www.besthub.dev/articles/what-the-2025-psf-jetbrains-python-survey-reveals-about-python-s-growing-popularity-3f2895d593cb · http://phpxs.com/post/13627/ |

**本仓库核对点**：`shell/src-tauri/src/env_cmds.rs`（`detect_framework` / `set_framework_hint_disabled` / `scan_app_decl` / `py_module_target`）、`shell/src/frameworks.ts`（提示文案 + 已配置判定，纯函数）、`shell/src/runFlow.ts`（框架预设提示与一键生成）、`shell/src/termUi.ts`（`watchServiceUrlLine` 服务就绪行自动打开）、`shell/src/__tests__/depHealth.test.ts`。
