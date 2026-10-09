# 单文件打开 + Markdown 预览模式 开发计划

版本：v1.0（2026-10-08）
状态：已立项，待实现
前置评估：本轮对话勘察（workspaceRoot 依赖面量化：TS 侧约 50 文件 400+ 引用、Rust 侧 13 文件 200+ 引用、32 处「无工作区即拦截」守卫）

## 0. 背景与目标

用户需求：有时想直接打开一个 `.py` 或 `.md` 文件，而 OpenCharm 目前只能打开目录（工作区）。

### 方案裁决（2026-10-08）

评估了三条路径：

| 方案 | 内容 | 裁决 |
|---|---|---|
| A | 真·单文件模式（`workspaceRoot` 保持 null） | **否决**：32 处守卫全走降级分支，无 LSP / 运行 / git / 会话恢复；要完整就得逐个裁决守卫语义（1-2 周起），且「打开 py 却不能补全运行」伤产品定位 |
| B | 选文件 → 父目录即工作区 | **采纳**（入口层） |
| C | 向上探测最小项目根 | **采纳**（B 的增强，默认路径） |

核心事实（勘察依据）：`main.ts::doOpenFile` 不校验文件是否在工作区内；`fs_cmds::pick_file` 已存在（stdin 重定向在用）；md 预览的图片渲染依赖 `allow_asset_dir`（工作区打开时授权）——**B/C 天然把 md 全链路接上，方案 A 恰好会裂图**。

### 关联裁决

- **LSP 策略**：纯 md / 无 py 工作区**跳过 pyrefly spawn**（ADR-0010「按需加载优先于常驻」；现状手动开纯 md 目录也会空转，本次顺手收掉）。基于文件树数据判定，watcher 发现新 .py 时后补启动。
- **md 打开方式**：单击预览、双击编辑（VSCode preview-tab 同款意图分流）；设置项 `markdown_open_mode`（preview / edit / split，默认 preview）；预览 tab 与现有分栏预览共存。

## 1. 总体设计

### 1.1 打开单文件流程（批 1）

```
入口（工具栏「打开文件」按钮 / 文件菜单 / 欢迎页快捷卡）
  → invoke pick_file
  → invoke find_project_root(filePath)          [新增 Rust 命令]
      py:  向上找 pyproject.toml / setup.py / .venv / venv（深度上限 4）
      md:  向上找 .git（笔记仓库以仓库为上下文；pyproject 对 md 无意义）
      都没找到 → 回退文件所在目录
      探测到 root == 文件所在目录的祖先 → openWorkspace(root) 后定位文件
  → openFile(path)（现有链路，零改动）
```

要点：

- `openWorkspace` 全链路原样复用（LSP / 运行 / 调试 / git / 会话 / watcher / 断点 / 书签），**这是方案 B 零架构风险的来源**。
- recents 登记探测到的工作区根（语义 = 「打开过这个文件所属的项目」）。
- 特例：探测根 == 当前工作区 → 只 `openFile`，不走 teardown（避免重开动画）。
- 探测在 Rust 侧做（纯 fs 检查，无 IO 竞态面）；深度上限 4 层防「home 目录被 git init 过」把整个用户目录当工作区。

### 1.2 md 感知 LSP 策略（批 1）

`startLsp` 前置判定（`main.ts`，基于 `refreshTree` 已拿到的文件树数据）：

- 文件树含 `.py` / `.pyw` → 照常启动。
- 无 py → 不 spawn 静态引擎，状态栏显示原因（i18n 词条）；intel 同样跳过（trace 库按 project_hash 键，无 py 项目无意义）。
- watcher 事件发现新增 `.py` 且 LSP 未启动 → 后补启动（用户把纯 md 仓库逐步变成代码仓库时不死锁）。

### 1.3 md 预览模式（批 2）

**Tab kind 扩展**（照 db-tab 范式，`sqlite_tool_dev_plan.md` §17）：

```
Tab.kind: "file" | "diff" | "db" | "md"
path 前缀: mdpreview:<绝对路径>
```

| 维度 | 设计 |
|---|---|
| 宿主 | `#editor-row` 浮层（与 diff/db 同位、互斥 dismiss，v1.4 三向互斥已踩过坑） |
| 渲染 | 复用 `markdownPreview.ts` 纯函数（renderMarkdownToHtml / sanitize / 锚点 / 图片改写） |
| 激活 | `activateTab` 分支：主编辑器 `setModel(null)` + 呈现预览宿主 + 重读重渲染（外部修改可见，照 db tab 激活重拉先例） |
| 生命周期 | 无编辑 → 无 dirty / autosave / didOpen / pendingChanges；session 快照**不入**（照 diff tab 先例，重启回编辑模式） |
| 分栏互斥 | 预览 tab 激活时 `updatePreviewVisibility` 排除预览 tab 自身，分栏自动隐藏 |
| 编辑入口 | ① 预览工具栏「编辑源码」按钮（原地 tab 转换）② 双击文件树条目 ③ 命令面板 |
| 提升语义 | 单击开预览（斜体标题示意临时态）→ 双击「提升」为编辑 tab（预览 tab 关闭，编辑 tab 接管） |

**设置项**：`markdown_open_mode`：`"preview" | "edit" | "split"`，默认 `"preview"`。

- TS `state.ts::Settings` + `DEFAULT_SETTINGS` 与 Rust `settings.rs::Settings::default` 同步（项目惯例四处同步义务）。
- `"split"` = 现有分栏行为（打开 md 后自动 `setPreviewOpen(true)`）。

## 2. 分批交付

| 批 | 内容 | 估时 |
|---|---|---|
| **批 1** | Rust `find_project_root`（分语言标记 + 深度上限）+ TS 入口接线（工具栏按钮 / 文件菜单 / 欢迎页快捷卡）+ LSP 无 py 跳过 + watcher 后补启动 | 2 天 |
| **批 2** | Tab kind "md" 预览 tab 全链路 + 设置项 `markdown_open_mode` + 文件树单击/双击 + 预览工具栏编辑按钮 | 2 天 |
| **批 3** | e2e（浏览器层：打开文件入口 / 探测回退 / 预览交互 / 设置切换）+ 验收记录 `docs/open_file_acceptance_record.md` | 1 天 |

每批交付门禁：`cargo check`（Rust 改动）+ `npm run build`（tsc 0 错）+ 相关域 vitest + e2e 子集（`shell/scripts/gate-tests.mjs e2e-ui` 或相关 spec）。

## 3. 风险与对策

| 风险 | 对策 |
|---|---|
| 宿主互斥矩阵 4 维（preview/diff/db/分栏）易漏 dismiss | 互斥收敛单一函数 + e2e 三向切换用例（v1.4 db/diff 互斥漏 dismiss 出过 P0） |
| 单击预览双击编辑的时序（单击先开预览、双击需提升） | 采用 VSCode 同款「单击即预览 + 双击提升」模型，单击**不加延迟**（预览展示快、双击自然覆盖）；e2e 验证双击后预览 tab 消失 |
| C 探测把大目录当工作区（如 home 有 .git） | 深度上限 4 + 标记文件须为目录直接子项 |
| recents 语义漂移（登记的是项目根而非用户点的目录） | 可接受（语义 = 打开过该文件所属项目）；验收时确认 UI 提示路径显示的是探测根 |
| 无 py 工作区的既有 e2e 假设（部分用例隐含「开目录必有 LSP」） | 批 1 门禁跑 `e2e-ui` 全子集，失败用 stash 对照法判存量/新增 |
| watcher 后补启动与 wsSwitching 互斥交叉 | 后补启动走 `startLsp` 同一入口，复用 wsSwitching 互斥 |

## 4. 明确不做（边界）

- 文件拖拽进窗口（Tauri `disable_drag_drop_handler`，独立产品决策）。
- NSIS 文件关联（右键「用 OpenCharm 打开」/ 双击 .py 打开 IDE；动安装包，独立立项）。
- 非 py/md 文件类型的语义支持（txt 等照常以编辑模式打开，无预览）。
- 预览 tab 的会话恢复（diff tab 同款边界）。
