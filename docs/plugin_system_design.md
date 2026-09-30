# OpenCharm 插件系统设计方案（v0.2）

> 状态：方向稿 + **工具插件垂直切片详细设计**（第九节，**已实现**，见 `docs/devtools_plugin_acceptance_record.md`）。
> 本文先确定**进程模型 / 扩展点边界 / 激活与权限模型 / 迁移路线**的方向；
> 第九节把「开发工具（devtools）」作为 Web Extension 轨的**首个垂直切片**落到可实施粒度
> （manifest / 模块契约 / API facade / 加载 / 信任模型 / 菜单分类）。
> 其余扩展点（commands / views / providers）的协议字段、API 签名、沙箱技术选型等细节见文末「待决策点」，待工具切片验证后增量展开。
> 与 `python_ide_tech_plan_v3.md` / `python_ide_dev_plan_v2.md` 不冲突时以本文为准；冲突时以计划为准并反馈修订。
>
> 变更记录：v0.2（2026-09-20）新增第九节工具插件切片；扩展点清单补 `tools`；迁移表与路线同步。
> **实现状态（2026-09-20）**：切片 v1 全量落地（PR-1 面板交互 / PR-2 插件加载内核 / PR-3 内置 9 工具插件化 / PR-4 文档收尾）。
> 面向作者的实操文档见 `docs/devtools_plugin_guide.md`；可运行样例 `examples/devtools-plugin-sample/`；
> 交付核对与测试明细见 `docs/devtools_plugin_acceptance_record.md`。

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
| **工具** | **`tools`** | **A** | **开发小工具（面板 UI + 就地变换）；首个落地的垂直切片，详见第九节** |
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
| `devtools`（开发工具） | **已选定为首个垂直切片**：内置工具改写为「内置插件」，第三方工具经 manifest 加载 | 详细设计见第九节 |
| `live-templates` | 可拆为内置 Web Extension，验证扩展点 | 工具切片跑通后的第二个试点 |
| `dap`（debugpy） | 走 `debuggers` 扩展点 | 内置 debugpy 作为默认 debugger 插件 |

> 铁律要求 `probe` / `intel` 不依赖外壳内部 API —— OEP 必须是稳定公开协议，不泄漏外壳内部类型。这与「插件化」方向天然一致。

---

## 八、分阶段路线（方向）

- **P0 模型验证**：定义 OEP 协议骨架 + manifest schema；把 `intel` 接入 OEP（不改其实现，只换通信壳），证明进程插件模型可行。
- **P1 工具插件切片（首个垂直落地，详见第九节）**：把 `devtools` 改写为 Web Extension——内置工具迁为「内置插件」，开放 `contributes.tools` 第三方加载，跑通 manifest → 发现 → 加载 → API facade → 生命周期闭环。
- **P2 第三方开放**：`opencharm.*` API 稳定化、权限模型落地、本地安装 `.ocx` 包、插件清单 / 启停页。
- **P3 生态**：市场 / 分发、签名、版本兼容矩阵、自动更新。

---

## 九、工具插件垂直切片（首个落地详细设计）

> 本节把第二节「轨 A — Web Extension」在 **`contributes.tools` 这一个扩展点**上落到可实施粒度。
> 选择「开发工具」作为首个切片的原因：面足够小（只有 `mount` + 少数 Host 方法）、用户价值直接、
> 且能把 manifest → 发现 → 加载 → API facade → 权限 → 生命周期整条链路跑通，
> 为后续 commands / views / providers 扩展点提供经过验证的机制与范例。

### 9.1 定位与范围

- **切片只做一件事**：让「开发小工具」既能内置、也能由用户/第三方以插件形式编写并加载。
- **不在本切片内**：通用命令注册、侧栏/底部视图贡献、Monaco provider、主题、状态栏项——这些扩展点复用本切片验证过的加载/facade 机制，后续增量开放。
- **与现有 `shell/src/devtools/` 的关系**：现有 registry / panel / host 是切片的**内核前身**；切片落地后，内置工具改写为「内置插件」，registry 不再区分内置与第三方（见 9.7、9.11）。

> **可独立执行起跑线（避免高估工作量）**：落地只碰本第九节 + 第五节的 manifest 子集。**不碰**轨 B / OEP / `manager.rs` / 进程托管 / `commands` / `views` / `monaco.provider` 等其余扩展点——那些留待切片跑通后复用本切片的加载/facade 机制增量开放。

### 9.2 Manifest 规范（`contributes.tools`）

复用第五节的 `opencharm.plugin.json`，工具插件只需填 `contributes.tools`：

```jsonc
{
  "schemaVersion": 1,                  // manifest 格式版本；破坏性变更靠升版本兼容，v1 固定 1
  "id": "com.example.my-tools",        // 反向域名，全局唯一
  "name": "My Dev Tools",
  "version": "1.0.0",
  "engines": { "opencharm": ">=0.5.0" }, // 版本兼容闸门，不兼容则跳过加载并提示（v1 仅支持 >=X.Y.Z 形式）
  "contributes": {
    "tools": [
      {
        "id": "jwt-decoder",            // 插件内唯一；全局键 = <plugin-id>.<tool-id>
        "title": "JWT 解码",
        "description": "解码 JWT 查看 header/payload",
        "category": "编码",              // 见 9.8 分类约定
        "icon": "key",                   // codicon 名
        "entry": "./tools/jwt.js",       // ES module 入口（相对 manifest 路径；必须单文件、禁插件内相对 import，见 9.15）
        "inline": {                      // 可选：就地变换模式
          "label": "解码 JWT 选区",      // 命令面板/右键显示名
          "handler": "decodeSelection"   // entry 模块导出的函数名
        }
      }
    ]
  },
  "permissions": ["clipboard", "selection"] // 最小授予，见 9.4
}
```

字段约束：
- `schemaVersion` 固定 1；`id` / `title` / `category` / `entry` 必填；`inline` 与 `mount` 导出至少实现其一。
- `engines.opencharm` v1 仅支持 `>=X.Y.Z` 一种范围形式（不引库、不手写完整 semver）；不满足则跳过加载并提示。
- `entry` **必须单文件、禁止插件内相对 import**——热重载 cache-bust 只作用入口 URL，单文件约定消除多文件依赖一致性问题（见 9.15）。
- `permissions` 缺省 = 仅通用默认能力（`toast`）；`clipboard` / `selection` / `fs:read` / `storage` / `monaco` 须显式声明，未声明则 facade 拒绝。

### 9.3 工具模块契约（插件作者写什么）

一个工具 = 一个 ES module，按 manifest 约定导出函数。**只通过入参 `host` 与外壳交互，禁止 import 外壳内部模块**（API facade 硬约束，见 9.4）。`mount` 与 `inline.handler` 收到**不同类型的 host**（见 9.4）：

```js
// tools/jwt.js
/** 面板模式：挂载 UI 到 host.root，返回清理句柄（可省略表示无需清理）。
 *  host 类型 = PanelHost（有 root / kit） */
export function mount(host) {
  const input = host.kit.textarea({ placeholder: "粘贴 JWT…" });
  const out   = host.kit.output({ readOnly: true });
  const btn   = host.kit.primaryButton("解码", "play", () => out.set(decode(input.value)));
  host.root.append(input, host.kit.toolbar(btn), out.el);
  return { dispose() { /* 释放监听/定时器 */ } };
}

/** 就地变换模式（对应 manifest.inline.handler）：选中 → 变换 → 原地替换。
 *  host 类型 = InlineHost（无 root / kit，只有选区 / 剪贴板 / toast / storage） */
export function decodeSelection(text, host) {
  return decode(text);   // 返回替换文本；抛错则外壳 toast 提示并保留原文
}
```

- `mount(host)` / `inline.handler(text, host)` 至少导出一个。
- `mount` 的 host 含 `kit` 与 `root`；`inline.handler` 的 host **不含** `root`/`kit`——inline 触发时可能从未 mount，不得假设能操作 DOM。
- 框架提供 `kit` UI 积木（textarea / output / toolbar / button / copy / paste / clear / error），插件不手写 DOM 样板。
- 内置工具与第三方工具遵循**完全相同**的契约（dogfooding，见 9.7）。

### 9.4 API Facade（`host` = 稳定插件 API 面）

现有 `ToolHost`（`shell/src/devtools/host.ts`）升级为插件 API 面，按 `permissions` 门控。facade 是插件与外壳之间的**唯一通道**：插件拿不到 `state.ts` / `main.ts` / Tauri `invoke` 的引用。

**host 按模式分两种类型**（拍板，决策点 #①）——`mount` 收 `PanelHost`，`inline.handler` 收 `InlineHost`；后者可能从未 mount，不含任何 DOM/UI 能力：

```ts
/** 两模式共有的通用能力 */
interface BaseHost {
  toast(msg: string, kind: "info" | "ok" | "error", action?: { label: string; run: () => void }): void; // 默认
  copyToClipboard(text: string): Promise<boolean>;   // clipboard
  readClipboard(): Promise<string | null>;           // clipboard
  getSelectedText(): string | null;                  // selection
  replaceSelection(text: string): boolean;           // selection
  insertToEditor(text: string): boolean;             // selection
  storage: { get(key: string): string | null; set(key: string, v: string): void; clear(): void; }; // storage
  workspaceRoot(): string | null;                    // fs:read
  readFile(rel: string): Promise<string>;            // fs:read
}

/** 面板模式：BaseHost + UI 能力 */
interface PanelHost extends BaseHost {
  root: HTMLElement;                 // 默认（面板挂载容器）
  kit: ToolKit;                      // 默认（UI 积木，见 9.12）
  monaco?: MonacoModule;             // monaco 权限（默认不授予；kit.output 已封装只读 Monaco 用法）
}

/** 就地变换模式：仅 BaseHost，无 root / kit / monaco */
type InlineHost = BaseHost;
```

| 能力 | 方法 | 所属 | 权限 |
|---|---|---|---|
| 通知 | `toast` | 通用 | 默认 |
| 剪贴板 | `copyToClipboard` / `readClipboard` | 通用 | `clipboard` |
| 编辑器选区 | `getSelectedText` / `replaceSelection` / `insertToEditor` | 通用 | `selection` |
| 持久化 | `storage.get/set/clear` | 通用 | `storage` |
| 工作区文件 | `workspaceRoot` / `readFile` | 通用 | `fs:read` |
| UI 容器 | `root` | 仅面板 | 默认 |
| UI 积木 | `kit.*` | 仅面板 | 默认 |
| Monaco | `monaco`（裸 API） | 仅面板 | `monaco`（显式，默认不给） |

- 未声明权限 → facade 抛 `PermissionDeniedError` 并记日志（对应第五节「权限网关统一校验、违规拒绝并上报」）。
- `monaco` 默认**不授予**：只读预览统一走 `kit.output`；第三方需裸 Monaco 才显式声明 `monaco` 权限（v1 无内置工具需要）。
- `storage` 强制命名空间隔离 `opencharm.plugin.<id>.`，插件停用/卸载时由外壳清理该前缀。
- facade 方法签名一旦进入稳定期即受 `engines` 版本约束；破坏性变更须升 `schemaVersion` 或主版本。

### 9.5 发现与加载

**v1 仅扫全局目录**（已拍板，决策点 #7）：

```
~/.opencharm/extensions/<plugin-id>/opencharm.plugin.json     ← 全局（用户自装）
```

> 工作区级 `<workspace>/.opencharm/extensions`（团队共享、可入仓）**v1 不做**，以简化首版。
> 由于加载器只是「多一个扫描根」，日后追加工作区级是**非破坏性扩展**——manifest 格式、facade、registry 均不变。

加载流程：
1. 启动扫描全局目录 + 文件监听。**文件监听不依赖细粒度「单文件变更」事件**（Windows 下原子写 / 目录删除事件语义不可靠）：目录级变化 → 去抖（约 500ms）→ 全量 diff（manifest + 各 entry 的 mtime/内容 hash）→ 重载受影响插件；设置页另提供「重新扫描」手动兜底（见 9.14）。
2. 解析并校验 manifest（`schemaVersion` + `engines.opencharm >=X.Y.Z` 兼容）→ 不兼容/非法跳过并上报。
3. JS 入口经 Tauri `fs` 读取 → `Blob` → `URL.createObjectURL` → 动态 `import()`（应用外目录 `~/.opencharm` 不适用 asset 协议，fs+blob 更稳）。
4. 调用模块导出，包装成 `DevTool` 注册进 registry → 菜单 / picker / 命令面板自动刷新。
5. 设置页新增「插件」tab：列表、启停、重载、查看声明权限与运行日志。

生命周期：`activate`（首次 mount / 命中激活事件）→ `deactivate`（面板关闭或停用，调用 `dispose`）。懒激活：未打开的工具不 mount（对应第四节激活模型）。

### 9.6 信任模型（v1 / v2 分步）

对应原待决策点 #1（沙箱选型）。工具切片采取**分步**策略，避免 v1 被沙箱选型卡死：

- **v1（本切片）：同源动态 import + API facade，不做硬沙箱。**
  信任模型对齐 VS Code——「你安装你信任的插件」。facade 限制插件*通过外壳*能做什么（权限门控），但不阻止其读 DOM / 发 fetch。工具面小、用户自装、可一键停用，风险可控，且能快速交付、快速迭代 API。
- **v2（开放第三方分发/市场时）：iframe sandbox 或 Worker 隔离 + postMessage 桥。**
  此时落地方向稿的硬沙箱；`host` facade 换成跨 realm 代理，**插件作者无感**（API 签名不变）。

> 该分步的前提是 9.4 的 facade 边界足够干净——插件从不持有外壳内部引用，因此 v1→v2 只是把「同 realm facade」换成「跨 realm facade」，不触及插件代码。

> **对铁律的显式偏离声明（重要）**：v1「同源 import」意味着插件代码运行于主 WebView **同一 realm**，技术上可访问 `window` / DOM / `localStorage` / `fetch`，**不满足架构第一原则中「独立进程或独立包」的字面要求**，也不是第二节轨 A 所称的「Extension Host sandbox」。因此 **v1 是铁律的「受信任过渡态」**：仅面向**用户自行安装的受信任代码**，以「API facade + 权限门控」软约束其通过外壳的能力，而不阻止其直接读取页面；「隔离」由 v2 的 iframe/Worker 沙箱回填。任何面向第三方分发的形态**不得**停留在 v1 状态。

### 9.7 内置工具即插件（dogfooding）

- 内置工具全部改写为**内置插件**：放 `shell/src/devtools/builtin/<tool>/`，各带 manifest，构建时打包，启动时走与第三方**完全相同**的加载流程。
- 收益：① 插件 API 被内置工具天天使用，不会设计跑偏；② 给第三方作者现成范例；③ registry / 菜单 / picker 不区分来源，一套代码。
- 内置插件默认授予其声明的权限，无需用户确认（随应用分发，已在信任边界内）。

**v1 内置工具清单（已拍板，共 9 个，覆盖 6 个预置 category）**：

| 工具 | category | 模式 | 来源 | 备注 |
|---|---|---|---|---|
| Base64 编码/解码 | 编码 | 面板 + inline | v1 新增 | inline：编码/解码选区 |
| URL 编码/解码 | 编码 | 面板 + inline | v1 新增 | inline：encode/decode 选区 |
| MD5 | 哈希 | 面板 + inline | v1 新增 | inline：选区 → MD5 |
| SHA-256 | 哈希 | 面板 + inline | v1 新增 | 与 MD5 共用 hash 工具函数 |
| JSON 美化/压缩 | 格式化 | 面板 | v1 新增 | 可编辑 Monaco 输入 + 只读输出（验证 kit 富 UI） |
| cURL 转 Python | 转换 | 面板 | 现有迁移 | 已存在，迁为内置插件 |
| 时间戳转换 | 转换 | 面板 + inline | v1 新增 | inline：选区时间戳 → 可读时间 |
| UUID 生成 | 生成 | 面板（插入） | v1 新增 | 纯输出型，验证非 inline 工具形态 |
| JSONPath 提取器 | 提取 | 面板 | 现有迁移 | 已存在，迁为内置插件 |

> v1.1 备选（不进 v1）：**正则测试**（已由库支持 PR-2 以真实 `re` 引擎交付）、进制转换、HTML 实体、Unicode ⇄ 中文、大小写转换、字数统计、排序去重、颜色转换、文本 Diff、密码生成、Lorem ipsum。
> **v1.1 首批落地（2026-09-30）**：上述清单除正则测试（另行交付）与 Lorem ipsum 外的 **9 个工具**已全部内置（`builtin/textfns.ts` 纯函数库 + 各工具模块），4 个提供 inline 入口。
> 预置 category 中「文本」「其他」v1 暂未被内置工具使用，留给第三方与 v1.1。

### 9.8 菜单分类与入口一致性

**菜单结构**（`menuBar.ts` 的 `MenuEntry.submenu` 已支持 flyout + 键盘 →/← 导航，渲染层零改动，仅改 `getMenuItems("tools")` 的组装）：

```
工具(T)
├─ 编码 ▸     ├─ Base64 编码/解码   └─ URL 编码/解码
├─ 哈希 ▸     ├─ MD5               └─ SHA-256
├─ 格式化 ▸   └─ JSON 美化/压缩
├─ 转换 ▸     ├─ cURL 转 Python     └─ 时间戳转换
├─ 生成 ▸     └─ UUID 生成
├─ 提取 ▸     └─ JSONPath 提取器
└─ 插件管理…  （打开设置页「插件」tab）
```

**category 约定（半开放）**：框架预置有序集 `编码 / 哈希 / 格式化 / 转换 / 生成 / 提取 / 文本 / 其他`；插件声明预置值则按预置顺序排，声明自定义字符串则追加在「其他」之前（字母序）。内置工具菜单稳定可预期，第三方又有自由度。

**三处同源**：同一 `category` 同时驱动 ① 菜单子菜单分组 ② 面板工具选择器（picker）分组 ③ 命令面板 `工具: <title>` 前缀。插件改 category，三处自动跟随。

### 9.9 面板交互改进（与切片同期落地）

工具数量增长后，现有「顶部平铺 tab + 切换即销毁」（`panel.ts:18-56`）不可持续，随切片一并改进：

- **Tab → 工具选择器（picker）**：面板 header 只显示当前工具（图标 + 名称 + ▾），点击弹出搜索式 picker（复用 `quickOpen.ts` 的 `fuzzyScore` + 按 category 分组 + 最近使用置顶）。工具再多也不溢出。
- **实例缓存（带 LRU 上限）**：`Map<toolId, { instance, rootEl }>`，切换时 hide/show 而非 destroy/create，保住输入状态（小工具高频「同一段文本试完 base64 试 md5」场景）。**缓存设上限（常驻 ≤5），超出按 LRU dispose 最久未用实例**；面板关闭则全部 dispose + 清缓存。
- **就地变换入口**：选中文本 → 命令面板搜 `<inline.label>` 或编辑器右键「变换选区 ▸」→ 原地替换 → toast 带「撤销」。无需打开面板，零上下文切换（对齐 JetBrains Encode/Decode 手感）。`Ctrl+Shift+T` 专用于开面板 picker、不触发 inline，避免歧义；上下文感知变体（有选区时 picker 过滤为 inline 工具）**已落地（v1.1，2026-09-30）**：有选区时 picker 进入 inline 模式——只列选区变换工具（提示条说明语义），选中**直接执行变换**（不开面板）；搜索词把 inline 工具滤没时回退全量工具（行为随渲染态定死，回退项走面板模式）。手动入口（header 点击）恒 normal 模式。
- **命令面板注册**：`buildQuickOpenActions()` 遍历 registry，命名统一为「工具: \<title\>」（面板工具）与「工具: \<inline.label\>」（inline 工具），前缀一致、可被 `工具:` 一搜即达。

### 9.10 Python 作者展望（不阻塞 v1）

OpenCharm 是 Python IDE，长期应支持「用 Python 写工具」。对应原方向稿「Python-to-Web 桥」的留白：

- **v1 只支持 JS/TS**（WebView 原生，零额外运行时）。
- **v2 对纯函数型工具**（text→text，如 md5/进制转换）提供 Python 桥：候选 Pyodide（WebView 内跑纯计算）或走轨 B Process Extension（OEP，spawn 用户 Python 脚本）。UI 型工具仍用 JS。
- **兼容策略**：v1 **不预留 `runtime` 字段**（避免模糊；加在哪层、默认值均未定），改由 manifest 顶层 `schemaVersion` 承担未来破坏性变更——引入 Python 桥时升 `schemaVersion`，旧插件按旧 schema 继续解析。

### 9.11 迁移映射（现有 devtools 代码 → 切片）

| 现有 | 切片后 | 说明 |
|---|---|---|
| `devtools/types.ts` `DevTool` | 扩展为插件 manifest 的运行时投影 | 增 `inline` / 权限声明 / 单文件 `entry` |
| `devtools/registry.ts` | 保留，新增「按 manifest 注册」路径 | 内置与第三方同一入口 |
| `devtools/host.ts` `ToolHost` | 升级为 9.4 API facade | 拆 `PanelHost` / `InlineHost`；补 `readClipboard` / `getSelectedText` / `replaceSelection` / `kit` / `storage` / 权限门控（`monaco` 收为显式权限） |
| `devtools/panel.ts` | 改 picker + 实例缓存（9.9） | tab 渲染逻辑移除 |
| `devtools/curl2python` `jsonpath` | 迁为 `devtools/builtin/<tool>/` 内置插件（9.7） | 用 `kit` 重写，消灭样板 |
| `main.ts` `getMenuItems("tools")` | 改为按 category 分组 + submenu（9.8） | 渲染层零改动 |
| （无） | 新增 `extensions/` 加载器 + 设置页「插件」tab（9.5） | 扫描 / 校验 / import / 热重载 / 启停 |

### 9.12 ToolKit API 签名（`devtools/kit.ts`）

```ts
export interface ToolKit {
  /* 布局 */
  body(): HTMLElement;                                        // .tool-body 根（flex column + gap）
  row(...els: (HTMLElement | "spacer")[]): HTMLElement;       // 横向；"spacer" → flex:1 撑开
  toolbar(...items: (HTMLElement | "spacer")[]): HTMLElement; // .tool-toolbar

  /* 输入（自动 autocomplete=off + spellcheck=false，对齐输入框规范） */
  textarea(opts?: TextareaOpts): HTMLTextAreaElement;         // .tool-textarea
  input(opts?: InputOpts): HTMLInputElement;

  /* 输出：Monaco 封装，自动跟随用户字号/字体族/减少动画设置（UI-29/UI-11） */
  output(opts?: OutputOpts): ToolOutput;                      // readOnly 默认 true；false → 可编辑（JSON 美化输入区）

  /* 按钮（一律走 .btn 体系，flash 反馈依赖之） */
  button(label: string, icon?: string, onClick?: (ev: MouseEvent) => void): HTMLButtonElement;
  primaryButton(label: string, icon?: string, onClick?: (ev: MouseEvent) => void): HTMLButtonElement;
  iconButton(icon: string, tip: string, onClick?: (ev: MouseEvent) => void): HTMLButtonElement;
  copyButton(getText: () => string): HTMLButtonElement;        // → host.copyToClipboard + flash；无 clipboard 权限 → flash「无权限」
  pasteButton(setText: (t: string) => void): HTMLButtonElement;// → host.readClipboard + setText
  clearButton(...targets: ClearTarget[]): HTMLButtonElement;

  /* 反馈 */
  errorSlot(): HTMLElement;                                   // .tool-error（min-height 占位）
  flash(btn: HTMLButtonElement, kind: "ok" | "error", text: string): void; // 复用 feedback.ts
}

export interface TextareaOpts { placeholder?: string; mono?: boolean /*默认 true*/; rows?: number; flex?: boolean /*默认 false：true 纵向撑满剩余空间*/; onInput?: (v: string) => void; }
export interface InputOpts { placeholder?: string; type?: "text" | "number"; readOnly?: boolean; onInput?: (v: string) => void; onEnter?: (v: string) => void; }
export interface OutputOpts { language?: string /* "json"|"python"|"plaintext"… */; readOnly?: boolean /*默认 true*/; placeholder?: string /*初始提示文本*/; }
export interface ToolOutput { el: HTMLElement; get(): string; set(text: string): void; clear(): void; dispose(): void; }
export type ClearTarget = HTMLTextAreaElement | HTMLInputElement | ToolOutput;

/** 绑定 host 构造 kit（copy/paste/output 依赖 host 能力与权限） */
export function createToolKit(host: ToolHost): ToolKit;
```

kit 统一兜底（工具不再各自处理）：输入框 `autocomplete=off`/`spellcheck=false`；Monaco 读 `app.settings` 与 `motionDisabled()` 并在 `dispose` 释放；copy/paste 内置 flash 与权限校验；按钮默认标准档 `.btn`（紧凑档由调用方加 `.btn--sm`）。

### 9.13 面板 picker UI 规格

**Header（常驻）**：`[icon] <当前工具标题> [▾]   [⤢] [✕]`
- `[▾]`/标题 → 开 picker；`[⤢]` 弹出独立浮窗（v1 占位禁用）；`[✕]` 关面板。
- 无可用工具（全停用/加载失败）→ 标题区「无可用工具」+ 仅 `[✕]`。

**Picker 浮层**（绝对定位于 `#right-panel` 内、header 下方，宽=面板宽，max-height=70% 面板高）：

```
┌──────────────────────────────┐
│ 🔍 搜索工具…                  │ ← .picker-search（autofocus, autocomplete=off）
├──────────────────────────────┤
│ 最近使用                      │ ← sticky group header
│  {} JSON 美化        格式化    │ ← .picker-item（右灰字 = category）
│  🔑 Base64           编码     │
├──────────────────────────────┤
│ 编码                          │
│  🔑 Base64 编码/解码          │
│  🔗 URL 编码/解码             │
├──────────────────────────────┤
│ 哈希                          │
│  🔒 MD5   🔒 SHA-256          │
│ …（按预置 category 序）        │
└──────────────────────────────┘
```

- 分组顺序：`最近使用`（跨 category 去重，≤5 条）→ 预置 category 序 → 自定义 category（字母序）→ `其他`。
- 搜索：复用 `quickOpen.ts::fuzzyScore`，匹配 `title + description + category`；query 空 → 全量分组；无命中 → `emptyState("无匹配工具")`。
- 键盘：`↑↓` 漫游（跳过 group header）、`Enter` 激活、`Esc` 关闭、输入即过滤；焦点恒在搜索框（同 quickOpen 焦点模型）。
- 选中 → `activateTool(id)` + 关 picker + 写 recent；点击 picker 外（面板 body 区）→ 关闭。
- 显示：item 右侧灰字 = category；`description` 作第二行副文本（过长截断），工具多后可辨识（对齐「title + description」的识别需求）。
- recent 持久化：`localStorage["opencharm.devtools.recent"]`（tool id 数组，最近在前，截断 5）；渲染时**过滤已注销的 tool id**（插件热重载/停用后产生），避免僵尸条目。

**DOM 结构**：
```
#right-panel
  #devtools-header  → #devtools-current([icon]+标题+[▾]) · .spacer · #devtools-popout(⤢,禁用) · #devtools-close(✕)
  #devtools-picker (hidden) → .picker-search + .picker-list
  #devtools-body → 缓存的各 tool rootEl 并存，非激活者 hidden
```

**实例缓存**：`activateTool` 命中缓存 → show 已有 rootEl（不重 mount）；未命中 → 新建 rootEl + `mount` + 入缓存；面板关闭 → 全部 `dispose` + 清缓存。

### 9.14 设置页「插件」tab 规格

接入：`SettingsCategory` 增 `"plugins"`；index.html 设置 nav 增 `.settings-nav-item[data-cat=plugins]`；`switchCategory` 增分支（对齐 live-templates「进入分类才渲染」模式）；入口 `openSettingsPanel("plugins")`（菜单「插件管理…」与 picker 空态按钮均调它）。

**布局**：
```
┌─ 设置 · 插件 ──────────────────────────────────────┐
│ 目录: ~/.opencharm/extensions   [打开目录] [重新扫描] │
├────────────────────────────────────────────────────┤
│ ▸ {} 内置工具            内置 · 10 工具 · 已启用     │ ← 行（点击展开）
│ ▸ 🔑 My Dev Tools 1.0.0  全局 · 2 工具 · 已启用      │
│ ▸ ⚠ Broken Plugin        全局 · 加载失败            │ ← 错误态红字
├────────────────────────────────────────────────────┤
│ (展开) My Dev Tools  v1.0.0  com.example.my-tools    │
│  来源 全局 · 引擎 >=0.5.0 · 状态 已启用               │
│  权限 clipboard, selection                           │
│  工具 JWT 解码 · Base64                              │
│  [重载] [停用] [查看日志]                             │
│  日志（环形，最近 50 条）                             │
│  ┌──────────────────────────────────────────────┐  │
│  │ 12:01:03 激活 jwt-decoder                     │  │
│  │ 12:05:02 权限拒绝: readFile (未声明 fs:read)   │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

**数据模型**：
```ts
interface PluginRecord {
  id: string; name: string; version: string;
  source: "builtin" | "global";
  dir: string;                        // 绝对路径（内置 = 打包内虚拟路径）
  manifest: PluginManifest;
  status: "active" | "disabled" | "error";
  error?: string;                     // status=error 的原因
  toolIds: string[];
  logs: { t: number; msg: string }[]; // 环形缓冲 50
}
```

**行为**：
- 停用/启用 → 写 `localStorage["opencharm.plugins.disabled"]`（id 数组）；停用即注销其工具 + dispose 存活实例 + 刷新菜单/picker；启用即重新 import + 注册。
- 重载 = 热重载（revoke URL → re-import → 重注册）；打开目录 = Tauri reveal（内置行禁用）；重新扫描 = 重跑发现流程。
- 错误态行红字 + 摘要，展开看完整错误与日志，提供「重试」。
- 日志环形缓冲仅内存（重启后运行时日志丢失，`error` 字段保留但缓冲清空）；跨重启诊断落盘 `<data_root>/logs/plugins/<id>.log`（**已落地 v1.1，2026-09-30**：Rust `append_plugin_log` 旁路追加写——id 白名单收口防逃逸、换行剥离防注入、64KB 上限滚动截断保尾部；前端 fire-and-forget，失败静默不反噬主流程）。

### 9.15 加载 / 热重载 / 激活时序

**冷启动发现**：
```
boot → loader.init()
  ├─ 注册内置插件（打包内清单，source=builtin）
  ├─ readDir(~/.opencharm/extensions) → [pluginDir…]
  ├─ for each pluginDir:
  │   ├─ read opencharm.plugin.json
  │   ├─ validateManifest ──✗→ record.status=error(原因); continue
  │   ├─ checkEngines(>=X.Y.Z) ──✗→ status=error; continue
  │   ├─ id ∈ disabled? → status=disabled; continue（不 import）
  │   ├─ for each tool in contributes.tools:
  │   │     read entry → Blob → objectURL → import(url) ──✗→ status=error; continue
  │   │     wrap exports(mount / inline.handler) → DevTool → registerDevTool()
  │   └─ status=active
  ├─ refresh 菜单(分类子菜单) / picker / 命令面板
  └─ fs.watch(~/.opencharm/extensions, recursive) → onChange
```

**热重载（去抖 + 全量 diff，不依赖细粒度单文件事件）**：
```
onDirChange → 去抖 500ms → 全量 diff（manifest + 各 entry 的 mtime/内容 hash）
  ├─ 插件目录删除:
  │    unregister 全部 + dispose + revoke URLs + 删 record + refresh
  │    面板正打开其工具 → 回退 picker
  ├─ manifest 变更:
  │    unregister 全部 tools（dispose 存活实例）→ re-validate
  │      ok: 重新 import 各 entry + register ; fail: status=error + toast
  │    refresh UI
  └─ 某 entry 内容变更（tool 为单文件，重载 entry == 重载该 tool）:
       affected = 该 entry 对应的 tool
       面板缓存有存活实例 → dispose + 移除 rootEl; unregister(t)
       revoke 旧 objectURL → re-read → Blob → objectURL(?v=Date.now())  ← cache-bust
       import ──✗→ status=error + toast「重载失败」; 面板正打开该工具 → 回退 picker
       re-register → refresh UI → toast「已重载 <title>」
```

**打开工具（懒激活）**：
```
openDevTools(toolId)（菜单 / picker / 命令面板 / Ctrl+Shift+T）
  └─ panel.activateTool(toolId)
       ├─ 缓存命中 → 显示缓存 rootEl（其余 hidden）; 不重 mount
       └─ 缓存未命中 →
            rootEl = div; bodyEl.append(rootEl); 其余 hidden
            host = createPanelHost(tool, rootEl)   ← PanelHost，按 manifest.permissions 门控
            try { instance = tool.mount(host) ?? null }
            catch(e) { rootEl ← 错误卡片(信息 + 重试 + 停用该插件); instance = null }
            cache.set(toolId, { instance, rootEl })
       └─ panelEl.classList.remove("hidden")
```

**inline 变换**：
```
选中文本 → 命令面板「<inline.label>」/ 编辑器右键「变换选区 ▸ <label>」
  └─ runInline(toolId)
       host = createInlineHost(tool)   ← InlineHost（无 root/kit，仅选区/剪贴板/toast/storage + 权限门控）
       text = host.getSelectedText()
       无选区 → toast「请先选中文本」; abort
       try { result = await tool.inline.handler(text, host) }
       catch(e) → toast 报错(含 e.message); 保留原文; abort
       snapshot = text
       host.replaceSelection(result)
       toast(`已应用 ${label}`, { action: { label: "撤销", run: () => host.replaceSelection(snapshot) } })
```

### 9.16 开发者体验（DX · P0 已实现，2026-09-20）

目标：把「决定写插件 → 看到自己的插件跑起来」压缩到 **10 秒正反馈**。

| 能力 | 入口 | 说明 |
|---|---|---|
| **脚手架** | 设置 → 插件 →「新建插件…」 | 对话框收 id/名称 → Rust `scaffold_plugin` 落盘「注释即教程」模板（面板 + inline + host.log 全演示）→ 主动重扫加载 → toast 引导下一步。不覆盖已有目录（幂等保护） |
| **host.log** | 插件代码 `host.log(msg)` | 默认权限。release 版 WebView 无控制台，这是插件作者**唯一**调试输出通道——写入该插件记录的日志环形缓冲（设置页日志面板**常驻展示**，空态提示用法） |
| **真实路径** | 设置 → 插件 顶部 | `get_plugins_dir` 显示绝对路径 + 「复制路径」（修掉写死 `~/.opencharm/extensions` 的错误提示——Windows 实际在 `%LOCALAPPDATA%`） |
| **内置指南** | 设置 → 插件 →「作者指南」 | `devtools_plugin_guide.md` 经 vite `?raw` 打包进应用 → 落盘数据根 `docs/` → `openFile`（.md 自动开应用自己的 Markdown 预览）。离线可用，零新基建 |

**设计取舍**：
- `host.log` 而非捕获 `console`：console 是全局的，v1 无沙箱下按插件归属拦截不可靠；显式 API 干净且为 v2 跨 realm 沙箱预留。
- 脚手架落在设置页（插件管理心智所在），不进欢迎页/帮助菜单。
- 指南用 Markdown 预览打开：「自己的 IDE 渲染自己的文档」本身即引导。

P1（已实现，2026-09-20）：
- **类型提示**：`opencharm-plugin.d.ts`（ToolHost/ToolKit/ToolInstance 全量 JSDoc）随脚手架落盘；
  entry 模板首行 `// @ts-check`——VS Code 打开即有补全与检查（tsc strict checkJs 验证三模板零错误）；
  Rust `include_str!` 编译期内嵌，运行时零资源依赖。
- **三模板选择**：面板工具 / 选区变换（inline）/ 空白——脚手架对话框单表单（id+名称+模板单选），
  模板 manifest 按需生成（blank 不声明 inline 占位禁用）。
- **inline 调试台**：inline-only 工具（无 mount 导出）面板打开时自动获得调试台
  （输入→运行→结果/错误就地显示）——与 runInline 同一 handler 语义，无需选编辑器文本。

P2（已实现，2026-09-20）：
- **zip 导出**：插件行「导出」→ `plugin:dialog|save` 选位置 → Rust `export_plugin`
  （zip crate 纯 Rust deflate，Windows 资源管理器可直接解压；跳过隐藏文件/node_modules 噪声）；
  文件名建议 `<id>-<version>.zip`。
- **zip 导入**：「导入插件…」→ `plugin:dialog|open` 选 zip → Rust `import_plugin`：
  解包临时目录 → 结构校验（单顶层=插件 id / manifest.id 一致 / **Zip Slip 防逃逸**
  （enclosed_name）/ 单文件 ≤10MB）→ 全部通过才落盘 extensions/（同名拒绝覆盖）→ 前端重扫。
  zip 编解码与安全校验由 Rust 单测覆盖（5 项）；E2E 验证 UI 全链路（导出→删源→导入→工具恢复）。
- v2 的 `.ocx` 市场在此之上演进（签名 / 元数据清单 / 版本升级覆盖策略）。

长线：Python 工具桥（§9.10）——OpenCharm 的用户是 Python 开发者，Python 模板才是最大的引导杠杆。

---

## 十、待决策点

### 10.1 全局（原方向稿遗留，工具切片不阻塞）

1. **Web Extension 沙箱技术选型**：iframe sandbox vs Web Worker vs 同源受限加载？——工具切片 v1 取「同源 + facade」，v2 再定硬沙箱（见 9.6），此点**对切片降级为 v2 议题**。
2. **是否引入 JS runtime**：Tauri 无内置 Node。工具切片 v1 纯浏览器 API + facade 已够用，**暂不引入**；若第三方需 npm 生态再议。
3. **OEP 是否复用 LSP 协议超集**：轨 B 议题，与工具切片（轨 A）无关，维持「自研薄协议 + LSP/DAP 子通道」倾向。
4. **静态引擎边界**：第三方语言服务只补充不替换 Pyrefly，维持原倾向。
5. **Python 进程插件的解释器来源**：轨 B 议题；与 9.10 的 Python 工具桥相关，待 v2 一并定。

### 10.2 工具切片专属（2026-09-20 已拍板）

6. **v1 信任模型** → **同源 import + API facade**：不做硬沙箱，靠 facade + 权限门控约束，对齐 VS Code「装你信任的插件」信任模型；v2 再上 iframe 沙箱，届时 facade 换跨 realm 代理、插件作者无感。见 9.6。
7. **插件目录范围** → **v1 仅全局 `~/.opencharm/extensions`**：简化首版；工作区级（团队共享、可入仓）延后，因加载器只是「多一个扫描根」，日后追加为非破坏性扩展。见 9.5。
8. **内置工具改写时机** → **v1 即迁为内置插件**：内置与第三方走完全相同的 manifest + 加载流程，dogfooding 保证 API 不跑偏并给第三方现成范例。见 9.7。
9. **Python 工具桥** → **v1 仅在 manifest 预留 `runtime: "js" | "python"` 字段**（仅 `js` 生效），避免日后破坏性变更；Python 桥（Pyodide 或轨 B 子进程）v2 再做。见 9.10。
10. **category 取值** → **半开放**：预置有序集 `编码 / 哈希 / 格式化 / 转换 / 生成 / 提取 / 文本 / 其他`，插件可声明预置值（按预置序）或自定义字符串（追加在「其他」前，字母序）。见 9.8。

（评審后追加，2026-09-20 已拍板）

11. **正则测试工具** → **v1 放弃，列 v1.1 备选**：工作量最大且被 Python/JS 正则语义分歧卡住（JS `RegExp` 会误导 Python 用户）；富 UI 验证改由 JSON 美化 + JSONPath 承担。见 9.7。
12. **inline host 设计** → **拆 `PanelHost` / `InlineHost` 两型**：inline 触发可能从未 mount，`InlineHost` 不含 root/kit/monaco。见 9.3 / 9.4 / 9.15。
13. **host.monaco 暴露** → **收窄为显式 `monaco` 权限**：默认不授予，只读预览走 `kit.output`。见 9.4。
14. **热重载粒度** → **v1 约定 tool = 单文件 entry、禁插件内相对 import**（cache-bust 只作用入口 URL）；文件监听改「去抖 + 全量 diff」。见 9.2 / 9.5 / 9.15。
