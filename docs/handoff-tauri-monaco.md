# OpenCharm 交接文档：外壳切换（Zed → Tauri+Monaco）

> 日期：2026-08-20 · 状态：**已完成交接**（2026-08-20 新会话产出技术方案 v3 / 开发计划 v2 / ADR-0003 / `shell/` 工程骨架，见文末「交接结果」）
> **本文档是新会话的唯一入口**：只读本文 + `docs/adr/0002-*.md` 即可完整接续。
> 上游文档：`python_ide_tech_plan_v2.md`（技术方案）、`python_ide_dev_plan.md`（开发计划，Phase 0/1 部分已因换壳过时，需出 v2）。

## 1. 一句话背景

OpenCharm 是单人自用的 Python IDE，差异化核心是**运行时类型采样（PEP 669）+ 自研运行时智能 LSP（opencharm-intel）**，目标是在无注解/动态代码的补全与跳转上超越 PyCharm。外壳原选 Zed（ADR-0001），Phase 0 验证中发现「PyCharm 级智能 live template」是产品负责人的一票否决必须项，而 Zed 结构性做不到（实测 + 上游 issue 证实），经双 spike 对称验证后，**裁决换用 Tauri 2 + Monaco**。

## 2. 决策链（时间线）

| 日期 | 事件 | 产物 |
|---|---|---|
| 08-19 | 定案 Zed 渐进式外壳 | ADR-0001 |
| 08-19 | 环境搭建 + preset/v0 + bench 样例 venv（3.13.7） | `docs/phase0-env.md`、`preset/v0/` |
| 08-20 | Phase 0 真实使用：补全/跳转可用但 live template 不智能、无运行按钮、文件树在右、快捷键冲突 | `docs/gap-list.md` G-001~G-003 |
| 08-20 | **Zed spike**：自写 stdio LSP 挂载验证 → `sortText`/`preselect` 均被 Zed 忽略；上游 issue #61349 证实为刻意设计、无修复计划 | `bench/spike-lsp/`、ADR-0002 |
| 08-20 | **Tauri+Monaco spike**：智能模板补全 / 符号补全 / 跳转（跨文件）/ 文件树 / 运行按钮全部实测通过；内存 ~420 MB（用户可接受） | `bench/spike-tauri-monaco/` |
| 08-20 | **产品负责人裁决：换壳（选 A）** | 本文档 |

## 3. 已验证的事实（不要再验证）

### Zed 侧（不可行证据）
- Zed 客户端补全排序用自身 fuzzy 分，LSP `sortText` 仅作平局 tiebreaker；`preselect` 也被忽略。
- 上游：zed-industries/zed issue **#61349**（2026-07，Open，severity S3，无修复计划）；同类问题自 2022（#5810）未解决。
- Zed 扩展 API（zed_extension_api 0.7.0）**没有** completion provider / snippet 注入能力，只有 `label_for_completion`。
- 结论：智能 live template 在 Zed 上只能靠深度 fork 改 `crates/editor`，违反薄 fork 纪律，排除。

### Tauri+Monaco 侧（可行证据，`bench/spike-tauri-monaco/`）
- 上下文感知模板补全：`sortText` 排序 ✅、`preselect` 预选 ✅、模块/类/函数上下文切换 ✅。
- 符号补全（跨文件 def/class）✅；跳转定义 F12 / Ctrl+点击（同文件 + 跨文件）✅。
- 左侧文件树 ✅；运行按钮（`uv run` 当前文件、cwd 锚定文件目录）✅。
- 内存（debug、Monaco CDN 全量）：主进程 ~39 MB + WebView2 六子进程 ~380 MB ≈ **420 MB**（Zed ~150 MB，约 2.8x）。产品负责人已表态可接受。
- spike 的补全/跳转由轻量符号索引（正则扫 def/class）驱动，仅证明壳可承载；生产接真正的 LSP。

## 4. 不变的部分（架构第一原则依然成立）

- **probe 与 intel 是完全独立的进程/包，不依赖外壳**。换壳不影响：
  - Phase 2（opencharm-probe，PEP 669 采样 + SQLite trace 库）计划不变；
  - Phase 3（opencharm-intel，Rust LSP）计划不变，只是挂载对象从「Zed 多 LSP」变成「monaco-languageclient」。
- 验收指标中语言智能部分不变：有注解补全 ≥95%、跳转 ≥95%、无注解（运行过）补全 ≥85% 且 ≥PyCharm、探针开销 <1.5x。
- 明确不做：AI 能力、pytest 面板、插件市场、协作编辑。

## 5. 需要重新设计的部分（新会话的主战场）

原开发计划 Phase 0/1 是 Zed 中心的（preset、Zed 扩展、traceback 链接验证），**大部分作废或需重做**。新会话要产出《技术方案 v3 / 开发计划 v2》，核心议题：

1. **外壳架构**：Tauri 2 + Monaco 的正式工程结构（前端框架选型：vanilla/React/Vue/Svelte；打包器：Vite；Monaco 本地化打包 + worker 配置，去掉 CDN 依赖）。
2. **LSP 接入**：`monaco-languageclient` + pyrefly（默认）/ basedpyright（备选）+ ruff + 未来的 opencharm-intel；多 LSP 合并策略（运行时优先 + `⟳ runtime` 来源标注）在 Monaco 侧的实现方式。
3. **编辑器基本功重建**（原 Zed 免费提供、现在要自己做）：文件树（多层/递归）、多标签页、终端（xterm.js？）、搜索、Git 状态、主题、PyCharm 键位、中文输入法兼容。
4. **运行与 traceback 跳转**：task 系统（`uv run`、cwd 锚定）、终端输出中 `File "…", line N` 的正则识别与点击跳转（原 P1-T03 验收的 5 类错误，材料在 `bench/sample/errors/`，可直接复用）。
5. **调试**：debugpy 集成（DAP）是否做、何时做（原方案靠 Zed 内置，现在需自建或推迟）。
6. **性能预算修订**：原红线「冷启动 <300 ms、内存 <400 MB」是 Zed 基线；Tauri+Monaco 实测 ~420 MB，需产品负责人重定预算（建议内存红线调至 ≤500-600 MB，冷启动重新实测）。
7. **智能 live template 正式化**：把 spike 的上下文模板做成可配置体系（用户可加模板），这是换壳的直接动因，优先级最高。
8. **排期重排**：外壳重建插在 Phase 1 位置（原 4-11 周），Phase 2/3 顺延；Gate 闸门机制保留。

## 6. 环境与资产清单（可直接复用）

> **注意**：应产品负责人要求，`bench/`、`preset/`、`probe/`、`intel/`、`ci/` 等实现目录已于 2026-08-20 清理，仓库仅保留 `docs/`。spike 的**核心实现代码已沉淀**到 [`spike-implementation-reference.md`](spike-implementation-reference.md)，重新实现时以该文档为起点。

| 资产 | 位置 | 说明 |
|---|---|---|
| **Spike 实现参考（核心代码 + 踩坑）** | `docs/spike-implementation-reference.md` | Tauri 命令 / 上下文补全 / 跳转 / 配置要点 / 实测指标，重新实现的起点 |
| 差距清单 | `docs/gap-list.md` | G-001~G-004，Gate A 支撑证据 |
| ADR | `docs/adr/` | 0001（已取代）/ 0002（定案） |

关键版本号（重新锁定时参考）：pyrefly 1.2.0 · ruff 0.16.1 · uv 0.10.11 · Rust 1.96.0 · Tauri 2.11.5 · Monaco 0.52.2 · WebView2 151.0。

本机环境：Windows · Python 3.13.7（`D:\py3\3.13.7`，uv 管理；系统默认 3.11.9 不可用）· uv 0.10.11 · Rust 1.96.0（x86_64-pc-windows-msvc）· Node 22.12 / npm 10.9.2 · WebView2 151.0 · pyrefly 1.2.0 · ruff 0.16.1。

## 7. 新会话建议的第一步

1. 读本文档 + `docs/adr/0002-*.md` + `docs/spike-implementation-reference.md`；
2. 与产品负责人对齐第 5 节的 8 个议题（尤其 1/2/6）；
3. 产出《技术方案 v3》骨架（外壳架构 + LSP 接入 + 性能预算修订）；
4. 依据 `spike-implementation-reference.md` 重建正式外壳工程（建议置于仓库顶层，如 `shell/`）；
5. 更新 `python_ide_dev_plan.md` → v2（Phase 重排）。

## 8. 遗留待办（换壳前已存在、仍然有效）

- basedpyright 未安装（备选引擎，Phase 1 需要）。
- traceback 点击跳转 5 类错误未在 Zed 上验证完（换壳后改在 Monaco 终端验证，材料可复用）。
- Windows 稳定性专项（渲染/输入法/内存）未做——换壳后对象变成 WebView2，仍需验证（中文输入法在 Monaco 里的表现要早测）。

## 9. 交接结果（2026-08-20 新会话）

| 交付物 | 位置 | 说明 |
|---|---|---|
| 技术方案 v3 | `docs/python_ide_tech_plan_v3.md` | 外壳架构（Vanilla TS + Vite + Tauri 2 + Monaco 0.52.2 本地打包）、LSP 桥、补全三层合并、内存红线 ≤600 MB |
| 开发计划 v2 | `docs/python_ide_dev_plan_v2.md` | Phase 1 外壳重建期（S1-T01~T08，8 周）；Phase 2/3 顺延不变 |
| ADR-0003 | `docs/adr/0003-lsp-bridge-custom.md` | 自研轻量 LSP 桥（弃 monaco-languageclient：版本强耦合 + vscode 服务层过重 + 补全合并控制点深） |
| Shell 工程 | `shell/` | 骨架 + 核心功能已实现，`npm run build` + `cargo build` 全绿 |

产品负责人四项裁决（2026-08-20）：Vanilla TS + Vite · 内存 ≤600 MB · Phase 1 最小闭环 · 调试推迟 Phase 3 后。

`shell/` 已实现：多标签 + 递归文件树 + 可配置智能模板（`~/.opencharm/templates.json`）+ LSP 桥（pyrefly/basedpyright 可切）+ 运行按钮（流式输出）+ traceback 点击跳转 + 工作区记忆。待办：真机验证（`npm run tauri dev`）、5 类错误跳转验收（S1-T05）、中文输入法早测（S1-T06）、bench 重建（S1-T07）。

## 10. 已知踩坑（外壳）

### 打包后语法高亮全失效，dev 正常（Tauri CSP 收紧导致，2026-08-28）

- **现象**：`npm run tauri dev` 下正常；打包安装后打开项目，Monaco 代码语法高亮全部失效（所有 token 渲染成默认前景色，关键字/注释/字符串颜色丢失），但编辑器 UI、文本、补全、跳转均正常。
- **根因**：Tauri 2 编译期会自动「收紧」CSP——解析前端资源后把 `style-src` 中的 `'unsafe-inline'` 替换为 nonce/hash 来源。Monaco 的语法高亮颜色是**运行时动态注入**的 `<style class="monaco-colors">`（含 `.mtk{N}` token 颜色与 `--vscode-*` 变量），拿不到编译期生成的 nonce，被 WebView2 拒绝，浏览器不解析该张样式表。
- **诊断特征**（打包后抓取日志）：
  - `style.monaco-colors` 元素 `.sheet === null`，且不出现在 `document.styleSheets` 里；
  - `.mtk7 { color:#608b4e }` 等规则文本本身正常，但整张 `.monaco-colors` 未生效；
  - `getComputedStyle(editor).getPropertyValue('--vscode-editor-foreground')` 为空，所有 token 去重后只剩 1 种颜色（默认前景色）；
  - 把 `csp` 置 `null` 后恢复正常，反向印证。
- **解决**：在 `shell/src-tauri/tauri.conf.json` 的 `app.security` 新增 `"dangerousDisableAssetCspModification": true`，禁用 Tauri 的 CSP 注入。备选：`["style-src"]` 仅放开 style-src 指令（安全影响更小）。本项目采用方案 B（`true`）。
- **教训**：Monaco 的 token 颜色不是打包出的静态 CSS，而是运行时内联注入；凡涉及「运行时动态内联 style/script」又启用了 Tauri CSP 的场景，都要禁用对应的 Tauri CSP 注入指令，否则收紧后动态资源会被拦截。
