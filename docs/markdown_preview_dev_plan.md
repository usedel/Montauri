# Markdown 预览功能开发计划（v1.0）

> 状态：已实施
> 范围：shell/（Tauri 2 + Monaco 外壳），前端为主 + 一处 Rust 小命令
> 决策记录：面板形态 = 编辑区分栏（VS Code 风格）；P1 即含本地图片显示（asset 协议）

## 1. 背景与目标

项目开发中 markdown 文件（README / docs / 方案文档）非常常见。目标是在 Montauri 内提供
「编辑器左、预览右」的同屏实时预览，对齐 VS Code 体验：

- 活动 tab 为 `.md` 时可一键开关分栏预览（默认 `Ctrl+Shift+V`）；
- 编辑未保存内容也实时反映到预览（读 `model.getValue()`，~300ms 防抖）;
- 支持 GFM（表格 / 删除线 / 任务列表）、代码块高亮、本地相对路径图片；
- 文档间相对 `.md` 链接可点击跳转；外部链接走系统浏览器，WebView 不发生整页导航。

## 2. 现状约束（方案依据）

| # | 约束 | 影响 |
|---|------|------|
| 1 | 单 Monaco 编辑器 + 多 Tab 共享（`activateTab` 只做 `setModel`） | 预览不走编辑器体系，独立 DOM 面板 |
| 2 | 右侧 devtools 面板宽 260–560px 且工具互斥（同一时刻只挂载一个实例） | 不放 devtools，放 `#center` 内分栏 |
| 3 | CSP 严格：`img-src 'self' data: blob:`，且 `dangerousDisableAssetCspModification: true` | 本地图片须手动开 asset 协议并改 CSP |
| 4 | 快捷键三处同步锁：`keybindings.ts` META / `state.ts` DEFAULT_SETTINGS / Rust `default_keybindings`，有漂移锁测试 | 新命令三处齐改 |
| 5 | 工作区根由前端持有（`app.workspaceRoot`），Rust 命令按参数接收 | asset 目录授权做成动态命令，打开工作区时调用 |
| 6 | 前端零重型依赖惯例（仅 monaco / xterm / codicons） | 代码高亮复用 `monaco.editor.colorize`，不引 highlight.js |

## 3. 技术选型

| 项 | 选型 | 理由 |
|---|------|------|
| 解析器 | `marked`（~40KB，零依赖） | 开箱 GFM，比 markdown-it 少装插件 |
| 消毒 | `dompurify` | 必须。CSP 挡内联脚本，但 `javascript:` 链接、恶意属性仍需过滤 |
| 代码高亮 | `monaco.editor.colorize(code, lang, { theme })` | 零新增依赖，风格与编辑器天然一致 |
| 渲染位置 | 纯前端新域模块 `shell/src/markdownPreview.ts` | 对齐 devtools / live-templates 的域模块分层 |
| 图片 | Tauri asset 协议 + `convertFileSrc`，目录动态授权 | scope 收紧到当前工作区，不写死宽泛路径 |

## 4. 总体数据流

```
model.onDidChangeContent（~300ms 防抖，仅预览可见且为活动 tab 时）
        │
        ▼
marked.parse(model.getValue())
        │
        ▼
DOMPurify.sanitize(html)
        │
        ▼
img src 改写：相对路径 → 以 md 所在目录解析绝对路径 → convertFileSrc()
        │
        ▼
#md-preview.innerHTML ← 点击委托（相对 md 链接→openFile / http(s)→外部浏览器 / #锚点→面板内滚动）
        │
        ▼
遍历 pre code → monaco.editor.colorize 异步高亮（语言不识别则回退纯文本）

打开/切换工作区（含启动恢复） → invoke allow_asset_dir(workspaceRoot)
                              → Rust asset_protocol_scope().allow_directory(root, true)
```

## 5. 任务拆解

### T1 · 依赖与配置

- [x] `shell/package.json`：+ `marked`、`dompurify`（如需 `@types/dompurify` 一并加）
- [x] `shell/src-tauri/tauri.conf.json`：
  - `app.security.assetProtocol`: `{ "enable": true, "scope": [] }`（scope 留空，全走动态授权）
  - CSP `img-src` 追加 `asset: http://asset.localhost`
- [x] `shell/src-tauri`：新命令 `allow_asset_dir(path)` → `app.asset_protocol_scope().allow_directory(path, true)`；
      `lib.rs` invoke_handler 注册
- [x] `shell/src/main.ts`：打开 / 切换工作区（含启动恢复上次工作区）时调用 `allow_asset_dir`

### T2 · 面板骨架与布局

- [x] `shell/index.html`：`#center` 内加 `#editor` + `#md-splitter`（复用 `.splitter-col` 样式与
      `data-tip` 惯例）+ `#md-preview`（默认 `hidden`）
- [x] `shell/src/style.css`：预览排版样式（标题 / 表格 / 代码块 / 任务列表 / 图片 `max-width:100%`），
      全部使用现有 `--bg` / `--fg` / `--brand` token，深浅主题自动适配；`#md-preview` 独立滚动
- [x] `shell/src/layout.ts`：分栏宽度拖拽复用 `startDrag` 机制 + `localStorage` 持久化
      （对齐 `SIDEBAR_KEY` 先例，key 建议 `montauri.mdpreview_width`）

### T3 · 渲染核心 `shell/src/markdownPreview.ts`（新域模块）

- [x] `renderMarkdown(tab)`：marked（GFM 开）→ DOMPurify → 写入面板
- [x] 代码块高亮：解析后遍历 `pre code`，`monaco.editor.colorize` 异步填充；未识别语言回退纯文本
- [x] 图片改写：相对路径 → 绝对路径 → `convertFileSrc()`；`data:` 原样保留；
      不额外放开 http(s) 网络图源（受 CSP 限制）
- [x] 防抖：独立 ~300ms 定时器；仅预览可见且该 tab 为活动 tab 时渲染，隐藏时零开销
- [x] 点击委托（安全关键）：
  - 相对 `.md` / `.markdown` 链接 → 解析绝对路径走 `openFile()`
  - `http(s)` 链接 → Rust 打开系统默认浏览器（若无现成命令则补 `open_external`）
  - `#锚点` → 面板内 `scrollIntoView`
  - 其余导航一律 `preventDefault`（防 WebView 整页导航跑掉）

### T4 · 入口接线

- [x] `keybindings.ts` + `state.ts` + Rust `settings.rs`：新增 `markdown_preview`，默认
      `Ctrl+Shift+V`（三处同步，漂移锁测试自动覆盖）；语义 = 开关分栏预览
- [x] `main.ts`：
  - `activateTab` / `closeTabSilent`：按「活动 tab 是否 .md + 预览开关」刷新面板显隐；
        切到非 md 文件自动隐藏（开关状态保留，切回 md 再显示）
  - 内容变更钩子接入 T3 防抖渲染
  - `showTabContextMenu`：仿照 `isPy` 加 `isMd` 分支（「打开预览 / 关闭预览」）
- [x] `menu.ts`：「视图」菜单加「Markdown 预览」项
- [x] `fileTree.ts`：`.md` 文件右键加「打开预览」（打开文件 + 开启分栏）

### T5 · 测试 `shell/src/__tests__/markdownPreview.test.ts`

- [x] 消毒：`<script>`、`javascript:` 链接、`onerror` 属性被剥除
- [x] 图片改写：相对路径 → asset URL（越权路径由 Tauri scope 拦截，前端只验证改写逻辑）
- [x] 显隐：非 md tab 隐藏；md tab + 开关开启时显示
- [x] 防抖：连续输入只渲染一次（fake timers）
- [x] `keybindings.test.ts` 三处同步漂移锁自动生效（无需新写）

## 6. 明确不做（后续再议）

- 编辑 ↔ 预览滚动同步（P2）
- Mermaid / KaTeX（依赖较重，P3 按需）
- 导出 PDF（P3 按需；HTML 导出已实施）
- 「替换编辑器」纯预览模式（Typora 风格，P3 按需）

## 7. 验收口径

打开本仓库 `README.md` 或 `docs/` 下任一文档：

1. `Ctrl+Shift+V` 出现右侧分栏预览；再按一次收起；
2. 编辑左侧文字，~300ms 内右侧刷新（未保存也生效）；
3. 文档内相对路径截图正常显示（asset 协议）；
4. 点击相对 `.md` 链接跳转到对应 tab；
5. 点击外部 http(s) 链接走系统浏览器，WebView 自身不导航；
6. 切换深 / 浅主题，预览配色随 token 适配；
7. `npm run test` 全绿（含新增用例与键位漂移锁）。

## 8. 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-09-11 | 初版：分栏形态 + P1 含本地图片（asset 协议）经确认 |
| v1.1 | 2026-09-11 | 实施收尾：新增「方案A 右上角开关按钮 + 方案D 一次性引导」；导出为 HTML（原 P3，base64 内联图片 + 固定浅色主题 + 系统保存对话框） |
