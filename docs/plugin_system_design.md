# OpenCharm 插件系统设计方案（v0.1 方向稿）

> 状态：方向稿。本文先确定**进程模型 / 扩展点边界 / 激活与权限模型 / 迁移路线**的方向，
> 具体协议字段、API 签名、沙箱技术选型等细节见文末「待决策点」，待讨论后另出详细设计。
> 与 `python_ide_tech_plan_v3.md` / `python_ide_dev_plan_v2.md` 不冲突时以本文为准；冲突时以计划为准并反馈修订。

---

## 一、设计目标与铁律对齐

1. **承袭架构第一原则**：插件是**独立进程或独立包**，不侵入外壳（Tauri + Monaco）与静态引擎（Pyrefly）内核。外壳只暴露**稳定的扩展点 API**，插件通过协议与之通信——不得直接引用 `shell/src` 内部模块或 `state.ts` 私有状态。
2. **Python 优先**：OpenCharm 是 Python IDE。能力型插件应允许用 Python 编写（呼应 `probe` 本身就是 Python 包）；UI 型插件用 TypeScript（与 Monaco/WebView 生态一致）。
3. **安全可控**：插件代码与用户项目代码、外壳进程三者隔离；权限（文件 / 网络 / 子进程 / 剪贴板 / 环境变量）显式声明、最小授予。
4. **最小内核 + 内置即插件**：鼓励把外壳内置功能瘦身为「内置插件」，为第三方让出扩展点；但**核心可用性不依赖插件加载成功**——插件机制失效时内置静态引擎 / 编辑 / 运行 / 调试仍可用。
5. **渐进式**：先用现有 `intel` / `probe` 重构为「一等公民插件」验证模型，再开放第三方。

---

## 二、进程模型：双轨

### 轨 A — Web Extension（UI 型）

- **运行位置**：WebView 内的 Extension Host sandbox（受控环境，与主 UI 同源但隔离）。
- **语言**：TypeScript / JavaScript。
- **适合**：命令、菜单、快捷键、命令面板、侧栏 / 底部 / 右栏视图、Monaco provider（completion / hover / definition / diagnostic / format）、主题、图标、状态栏项。
- **通信**：通过 host 暴露的 `opencharm.*` API facade 调用外壳能力；**不得直接 `invoke` Tauri 命令**，须经 host 转发并受权限网关校验。
- **与铁律的关系**：sandbox 内运行、不持有外壳内部引用，仍属「不侵入内核」——边界由 API facade + 权限层强制。

> 后续可探索 Python-to-Web 桥（PyScript/Pyodide）让 Python 也能写 UI 插件，v0.1 不做。

### 轨 B — Process Extension（能力型）

- **运行位置**：独立操作系统进程（任意语言可执行 / Python 包 / WASM 模块）。
- **适合**：语言服务（LSP）、调试适配器（DAP）、运行时采样、代码分析、外部工具桥接。
- **通信**：**OpenCharm Extension Protocol（OEP）** —— 基于 JSON-RPC 2.0 over stdio，与 LSP / DAP 同族。复用 `intel` / `probe` 已验证的进程托管模型（spawn + 生命周期 + 心跳 + 日志采集 + 崩溃重启）。
- **这正是 `intel` / `probe` 今天的形态** —— 它们就是第一批「一等公民」进程插件。

> 决策点（仅方向）：是否需要「混合插件」——一个包同时含 UI 与进程两部分？建议 v0.1 先分轨，后续用 manifest 的 `contributes` 聚合对外呈现为单一插件。

---

## 三、扩展点清单（首批）

| 域 | 扩展点 | 轨 | 说明 |
|---|---|---|---|
| 命令 | `commands` | A | 注册命令、供菜单 / 快捷键 / 命令面板绑定 |
| 编辑器 | `monaco.provider` | A | completion / hover / definition / diagnostic / format / signature |
| 视图 | `views` | A | 侧栏视图容器、底部面板 tab、右栏面板 |
| 主题 | `themes` / `icons` | A | 配色方案、图标集 |
| 状态栏 | `statusbar.items` | A | 状态栏自定义项 |
| 语言服务 | `languageServer` | B | 声明 LSP 进程入口 + 启动条件（onLanguage） |
| 调试 | `debuggers` | B | DAP 入口 + launch 配置 schema |
| 运行 | `runProviders` | A/B | 运行配置提供者（解释器选择、环境、prelaunch） |
| 文件 | `fileExplorer` / `watchers` | A | 资源管理器右键贡献、文件监听回调 |
| 工作区 | `workspace` | A | 语言注册、文件关联 |

---

## 四、激活模型（Activation Events）

懒激活——未命中的插件不加载、不 spawn 进程：

- `onStartup`（受控，默认不开，需用户授权）
- `onLanguage:<lang>`
- `onCommand:<id>`
- `onView:<id>`
- `onWorkspaceContains:<glob>`
- `onDebugResolve:<type>`
- `onLanguageServer:<lang>`

---

## 五、Manifest 与权限

每个插件包根目录 `opencharm.plugin.json`：

- `id` `version` `engines`（OpenCharm 版本约束，借鉴 `engines.vscode` 避免 API 破坏性变更击穿插件）
- `main`（轨 A 入口）/ `runtime` + `entry`（轨 B：解释器或可执行路径）
- `contributes`：commands / views / providers / themes / debuggers / ...
- `activationEvents`
- `permissions`：`fs:read` `fs:write` `net` `process.spawn` `clipboard` `env` `workspace:diagnostics` ...

权限粒度细到目录 glob 与能力类别，外壳侧权限网关统一校验、违规拒绝并上报日志。

---

## 六、外壳侧 Extension Host 架构（落点）

新增域 `shell/src/extensions/`：

- `host.ts` —— Web Extension host：加载、沙箱化、API facade 注册
- `registry.ts` —— manifest 注册表、激活事件分发
- `api.ts` —— 暴露给插件的 `opencharm.*` 命名空间（commands / editor / views / lsp / statusbar / ...）
- `protocol.ts` —— OEP 协议编解码（轨 B）
- `manager.rs`（src-tauri）—— 进程插件进程托管（spawn / kill / 日志 / 健康检查），复用 intel 托管经验
- **权限网关**：所有外壳能力调用经此层校验

---

## 七、与现有组件的关系（关键迁移）

| 现有组件 | 迁移后 | 备注 |
|---|---|---|
| `intel`（运行时 LSP） | 第一批一等公民进程插件，走 OEP，manifest 声明 `languageServer` | 不改实现，只换通信外壳 |
| `probe`（运行时采样） | 进程插件，走 OEP，manifest 声明 `runProviders` / 运行时贡献 | 同上 |
| 静态引擎 Pyrefly | **不插件化** | 铁律：不侵入静态引擎内核；但允许第三方语言服务插件并存（只补充不替换，见决策点） |
| `devtools` / `live-templates` | 可拆为内置 Web Extension，验证扩展点 | 先各取一个试点 |
| `dap`（debugpy） | 走 `debuggers` 扩展点 | 内置 debugpy 作为默认 debugger 插件 |

> 铁律要求 `probe` / `intel` 不依赖外壳内部 API —— OEP 必须是稳定公开协议，不泄漏外壳内部类型。这与「插件化」方向天然一致。

---

## 八、分阶段路线（方向）

- **P0 模型验证**：定义 OEP 协议骨架 + manifest schema；把 `intel` 接入 OEP（不改其实现，只换通信壳），证明进程插件模型可行。
- **P1 内置 Web Extension 化**：把 1~2 个现有 UI 模块（候选：`devtools` 或 `live-templates`）改写为 Web Extension，跑通 Extension Host + 扩展点闭环。
- **P2 第三方开放**：`opencharm.*` API 稳定化、权限模型落地、本地安装 `.ocx` 包、插件清单 / 启停页。
- **P3 生态**：市场 / 分发、签名、版本兼容矩阵、自动更新。

---

## 九、待决策点（请先拍板方向，细节后续展开）

1. **Web Extension 沙箱技术选型**：iframe sandbox vs Web Worker vs 同源受限加载？影响能力上限与安全边界。
2. **是否引入 JS runtime**：Tauri 无内置 Node。若 Web Extension 需 npm 生态，是否打包一个受限 runtime；否则纯浏览器 API 能力是否够用？
3. **OEP 是否复用 LSP 协议超集**：减少自研，但 LSP 偏文档语义，难覆盖命令 / 视图 / 状态栏。倾向「自研薄协议 + LSP/DAP 子通道」。
4. **静态引擎边界**：第三方语言服务插件能否「替换」而非「补充」Pyrefly？倾向只补充，Pyrefly 恒为内置默认。
5. **Python 进程插件的解释器来源**：复用用户工作区解释器（有沙箱风险）还是独立 bundled 解释器？影响安全与一致性。
