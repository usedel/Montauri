# OpenCharm Git 功能对标与交互改进报告（v2 · 深度版）

> **调研对象**：VS Code（官方文档 2026-09）、JetBrains PyCharm 2026.2（官方文档）
> **核验基准**：OpenCharm `shell/src` + `shell/src-tauri/src`（2026-09-18 实读代码）
> **方法**：竞品官方文档逐项抓取 + OpenCharm 代码逐条核验（每个缺陷结论均带 `file:line` 证据）
> **一句话结论**：OpenCharm 的 git **后端能力其实覆盖了主流操作的 60%+**，被吐槽「功能不全」的根因是**交互入口严重偏科**——几乎所有能力都挤在侧栏 SCM 面板 + 二级「更多操作」菜单里，而竞品赖以建立「Git 很强」心智的**编辑器内反馈、命令面板/快捷键、状态栏、上下文菜单、可视化历史**这 5 个交互面，OpenCharm 基本是空白。

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [核心判断：5 个交互面缺位](#2-核心判断5-个交互面缺位)
3. [OpenCharm 现状盘点（代码核验版）](#3-opencharm-现状盘点代码核验版)
4. [竞品深度对标](#4-竞品深度对标)
5. [三方细粒度功能矩阵](#5-三方细粒度功能矩阵)
6. [差距归因：为什么「全」被感知成「不全」](#6-差距归因为什么全被感知成不全)
7. [分级改进方案（含 UX 规格 + 落地位置 + 成本）](#7-分级改进方案)
8. [交互细节审查（微交互层，v2 新增）](#8-交互细节审查微交互层)
9. [优先级矩阵与排期](#9-优先级矩阵与排期)
10. [风险与依赖](#10-风险与依赖)
11. [质量保障与验收流程（v2.1 新增）](#11-质量保障与验收流程)
12. [附录 A：代码位置速查](#附录-a代码位置速查)
13. [附录 B：参考资料](#附录-b参考资料)

---

## 1. 执行摘要

| 维度 | 结论 |
|---|---|
| 后端能力 | stage/unstage/discard/commit/amend、分支增删切、stash、fetch/pull/push、双路 diff、冲突解决（含块级合并 current/incoming/both）、blame、扁平历史 —— **核心提交链路齐全** |
| 致命短板 | ① 暂存只到**整文件**（无 hunk/行级）② diff **只读**不能编辑 ③ 历史**无图谱** ④ **零编辑器内 git 反馈**（无 gutter 装饰/行内 blame）⑤ **无命令面板/快捷键/菜单栏/右键**可达 ⑥ 远程**裸命令**（无 remote 选择/进度/凭据）⑦ 无 merge/rebase/cherry-pick/revert/reset/tag/remote 管理 |
| 交互细节（v2 深查） | 另发现 **3 个交互级 bug**（Ctrl+Enter 绕过禁用态空提交、commitAll 空消息错误链不闭环、冲突残留正则误伤 `=======`）+ 10 项反馈/状态缺口（无忙碌态、分支切换无保护、无远程分支列表等）+ 8 项可用性缺口（无「打开文件」入口、无忽略空白等）——详见第 8 章 |
| 用户感知 | 「找不到 = 没有」「粒度粗 = 不专业」「编辑器里看不到 git = 没集成」「关键时刻报错莫名其妙 = 不可靠」 |
| 改进杠杆 | **迭代 0 先修 3 个交互 bug（2 天）** → P0 可见性修复（成本低、直接扭转口碑）→ P1 补「粒度 + 高级工作流」→ P2 对齐「远程/凭据/图谱/shelf」 |
| 流程规则（v2.1） | **每轮开发完成后必须 Code Review（11.1 清单）；全部迭代完成后用 Playwright 做 E2E 验收（11.2 十条用户旅程）**。E2E 基建在迭代 2 前搭好，用例随功能迭代增量编写 |

---

## 2. 核心判断：5 个交互面缺位

VS Code 与 PyCharm 都把 git 能力**冗余铺陈在 5 个交互面**上——同一个操作（如 stage）在多个面都能触达，用户无论习惯哪种路径都能找到。OpenCharm 几乎只做了其中 1.5 个面。

| 交互面 | VS Code | PyCharm | OpenCharm 现状 |
|---|---|---|---|
| **① 编辑器内**（gutter 装饰、行内 blame、内联 diff 弹出、gutter 直接 stage/commit） | ✅ 绿/蓝/红 gutter + 点击弹内联 diff 可 stage/revert；行内 blame 装饰 + hover | ✅ gutter 变更标记（蓝/绿）可勾选行、点标记直接 Commit this change / Stage；Annotate 行内 blame | ❌ **完全空白**（仅文件树有 badge，编辑器内零反馈） |
| **② SCM/Commit 面板** | ✅ Changes/Staged 两区 + 拖放 + 树/列表 + Graph + Timeline | ✅ Commit 窗口（changelist）+ Log + Shelf + Stash 标签 | ⚠️ 有变更列表 + 提交框 + 分支条 + stash 面板 + 扁平历史；**无图谱、无 changelist、无 Timeline** |
| **③ 状态栏** | ✅ 分支名可点击切换 + ↑↓ 同步计数 + Publish/Sync 按钮 + blame 项 | ✅ VCS widget（分支切换、cherry-pick/rebase 状态、Abort/Continue） | ⚠️ 仅显示分支名文本，**不可点击、无计数、无操作** |
| **④ 命令面板 + 快捷键** | ✅ 所有 git 操作可 `Ctrl+Shift+P` 直达 + 完整快捷键 | ✅ Alt+0/Alt+9/Ctrl+K/Ctrl+Shift+K/Ctrl+D… 全套 | ❌ **仅 `git_panel` 一条命令，零 git 快捷键** |
| **⑤ 上下文菜单**（文件树/编辑器 tab/历史条目/分支右键） | ✅ 文件、提交、分支均有丰富右键 | ✅ Log 提交右键 = cherry-pick/revert/reset/tag/branch/rebase… | ⚠️ 仅 SCM 面板内右键；**文件树右键、编辑器 tab 右键、历史条目右键均无 git** |

> **这就是「功能全却像不全」的结构性原因**：能力被锁在面 ②，而用户的心智入口在面 ①③④⑤。

---

## 3. OpenCharm 现状盘点（代码核验版）

### 3.1 架构与调用链

- 前端 `shell/src/git.ts` → Tauri `invoke` → Rust `shell/src-tauri/src/git_cmds.rs` / `git_status.rs`
- Rust 用 `spawn_blocking` + `Command` 起本地 git 子进程；网络操作走 `exec_git_timeout`
- git 二进制定位 `shell/src-tauri/src/tool_paths.rs:21`（`OPENCHARM_GIT_BIN` 覆盖 → 否则 PATH）
- 状态缓存下沉零依赖模块 `shell/src/gitStatusState.ts`（供文件树装饰只读消费，避免循环依赖）

### 3.2 已支持能力（带证据）

| 能力 | 命令 | UI 入口 | 代码位置 |
|---|---|---|---|
| 状态读取（porcelain -z + 分支） | `git_status` | 侧栏视图/文件树刷新/fs 防抖 | `git.ts:71`、`git_status.rs:39` |
| 暂存/取消暂存（**整文件**） | `git_stage`/`git_unstage` | SCM `+`/`−` + 右键 | `git.ts:279/293`、`git_cmds.rs:113/131` |
| 丢弃/删除未跟踪 | `git_discard`/`git_clean` | hover「丢弃」+ 右键 | `git.ts:307/329`、`git_cmds.rs:149/169` |
| 提交/提交全部/Amend | `git_commit(amend)` | 提交框按钮 + 下拉 | `git.ts:422/451`、`git_cmds.rs:224` |
| fetch/pull/push | `git_fetch`/`git_pull`/`git_push` | 「更多操作」菜单 | `git.ts:685 gitRemoteOp`、`git_cmds.rs:451/462/473` |
| stash 增/弹/列/丢弃 | `git_stash_*` | 「更多操作」菜单 | `git.ts:702/717/738/812`、`git_cmds.rs:486-535` |
| 分支列表/切换/新建并切换 | `git_branches`/`git_checkout`/`git_create_branch` | 侧栏分支条 | `git.ts:966/1057/1071`、`git_cmds.rs:265/294/310` |
| 历史（扁平）/详情/blame | `git_log`/`git_show`/`git_blame` | 「更多操作」→ 底部 Git 标签 | `git.ts:918/867/880`、`git_cmds.rs:558/588/616` |
| 双路 diff | `git_diff_versions` | 点 SCM 变更项 | `git.ts:489`、`git_cmds.rs:386` |
| 冲突解决（current/incoming/标记已解决/块级合并） | `git_accept_*`/`git_stage` | 冲突项按钮/右键/diff 工具栏 | `git.ts:351/363/386/576/620`、`gitMerge.ts` |
| 文件树 git badge | — | 文件树装饰 | `fileTree.ts:150-169`、`gitStatusState.ts` |
| 本地历史（独立于 git） | `history_snapshot` | Local History 面板 | `localHistory.ts` |

### 3.3 已核验的关键缺陷（每条带 file:line 证据）

| # | 缺陷 | 证据 |
|---|---|---|
| D1 | **diff 编辑器只读**，无法在 diff 内编辑解决冲突 | `git.ts:472 readOnly: true` |
| D2 | **stash message 恒为空**，无用户输入、无 stash diff | `git.ts:706 invoke("git_stash_push", {message: ""})` |
| D3 | **远程操作裸命令**：无 remote/branch 参数，仅传 `{root}` | `git.ts:690 invoke("git_"+op, {root})`、`gitRemoteOp:685` |
| D4 | **网络操作 120s 硬超时 + `stdin(null)`**：HTTPS 交互式凭据必然失败、无进度、无取消 | `git_cmds.rs:41-99`（`Stdio::null()`、`GIT_NETWORK_TIMEOUT`、`kill_process_tree`） |
| D5 | **历史无图谱**：`git log` 仅 `-n --date=short --pretty=format`，无 `--graph/--all/--decorate` | `git_cmds.rs:558-584` |
| D6 | **提交详情/blame 是纯文本 dump**，不可点击 hash/作者跳转 | `git_cmds.rs:588 git_show`（raw `git show`）；`git_blame` 虽返回结构化 `GitBlameLine{line,short_hash,author,time,summary}`，但前端 `showBlame` 渲染为文本行 |
| D7 | **状态栏分支不可点击、无同步计数** | `git.ts:122-130 updateGitStatusBar`（仅 `codicon("git-branch")+branch`，无 click、无 ahead/behind） |
| D8 | **零 git 快捷键** | `keybindingDefaults.ts` 搜 `git` = 0 命中 |
| D9 | **命令面板仅 1 条 git 命令** | `main.ts:1089 { id:"git_panel", label:"Git 面板" }`（唯一） |
| D10 | **菜单栏无 Git 菜单** | `main.ts:1280 getMenuItems` 仅 file/edit/view/tools；index.html:39-42 |
| D11 | **文件树/编辑器 tab 右键无 git 项** | `fileTree.ts:466 renderCtxMenu` 为通用菜单构建器，调用点未注入 git 项 |
| D12 | **无 merge/rebase/cherry-pick/revert/reset/tag/remote/submodule 命令** | `git_cmds.rs` 搜 `fn git_(merge\|rebase\|cherry\|tag\|reset\|revert)` 仅命中 stash |
| D13 | **SCM 空态无 init 按钮**（仅新建项目向导内部 `fs_cmds.rs:224 git_init_at`） | `git.ts:163-165` 空态文案「初始化仓库后启用」但无按钮 |
| D14 | **冗余死代码**：`git_cmds.rs:243 git_diff` 已注册但前端弃用（改用 `git_diff_versions`） | `git_cmds.rs:243` |

---

## 4. 竞品深度对标

### 4.1 VS Code 能力全景（官方文档实抓）

**暂存与提交**
- 文件级：Changes/Staged Changes 两区，`+`/`−`/拖放/树形或列表视图
- **Hunk 级**：diff 编辑器每个变更块 gutter 有 Stage 按钮
- **行级**：选行 → `Stage Selected Ranges` / gutter Stage 按钮 / `Git: Stage Selected Ranges`
- diff 布局：Inline / Side-by-side / Auto（默认 900px 阈值），可折叠未变更区、上下处导航

**编辑器内反馈**
- gutter 装饰：绿=新增、蓝=修改、红三角=删除；**点击弹内联 diff 预览，可直接 stage/revert**
- 行内 blame 装饰 + 状态栏 blame；hover 显示提交信息/作者/时间/co-author/AI attribution；模板可定制
- 相关设置：`scm.diffDecorations*`、`git.blame.*`

**合并冲突**
- 内联 CodeLens：Accept Current / Incoming / Both / Compare Changes
- **3-way Merge Editor**：Incoming / Current / Result 三面板，checkbox + CodeLens（含 Combination of both、Ignore），Result 可手动编辑，Complete Merge 收尾；可切垂直布局、显示 base view

**历史三层**
- **Source Control Graph**：仓库级 DAG，incoming/outgoing 高亮，提交右键（Checkout / Cherry-pick / 加入聊天上下文），与分支/远程/merge-base 比较，工具栏 Fetch/Pull/Push/Sync，多文件 diff，二进制文件处理
- **Timeline**：单文件历史（git 提交 + 本地保存），可过滤来源
- **Git Blame**：行级注解（见上）

**分支 / Worktree**
- 切换（状态栏点击 / `Git: Checkout to`，含本地/远程/最近分支）、创建（可选源分支 + 随机名）、重命名、删除（本地 + 远程）、合并、发布分支
- **Worktree**：创建/打开/切换/自动检测/比较/迁移变更（`git.worktreeIncludeFiles`、`git.detectWorktrees`）

**Stash**
- `Git: Stash` / `Stash (Include Untracked)` / `Stash Staged`（需 Git 2.35+）；可输入说明
- `View Stash`、`Apply/Pop Stash…`（按名选择）、`Apply/Pop Latest`、`Drop Stash…` / `Drop All Stashes…`

**远程 / 仓库**
- Clone（GitHub 认证后选仓库 / 其他输 URL）
- Add/Remove Remote、Push to（选远端）、Pull from、**Pull (Rebase)**、Fetch (Prune)、Fetch From All Remotes
- **Sync** = pull+push，状态栏显示 `↑2 ↓1`
- **Publish to GitHub**（建仓库 + 配 remote + push 一步）
- **多仓库 Repositories 视图**（monorepo 自动检测、单/多仓库选择模式）
- 凭据：推荐配置 credential helper
- 设置：`git.autofetch`/`git.autofetchPeriod`/`git.pruneOnFetch`/`git.confirmSync`/`git.showActionButton`…

### 4.2 PyCharm 能力全景（官方文档实抓）

**Commit 工具窗口（Alt+0）**
- changelist 分组、勾选文件/整 changelist 提交、`Ctrl+K` 提交 / `Ctrl+Alt+K` 提交并推送
- Amend、Reword、最近提交消息下拉、提交模板（`commit.template`）
- **提交前检查**：Reformat / Optimize imports / Analyze code / Check TODO / Run tests / Sign-off / Author 覆盖 / Update copyright / Clear Jupyter outputs / Check malicious deps；Git hooks 执行（可关）
- **提交文件的一部分**：diff 里勾选 chunk；**hover gutter 勾选单行**；`Split Chunks and Include Selected Lines`；`Move to Another Changelist`
- **从编辑器 gutter 直接提交**：点变更标记 → 写消息 → `Commit this change`（含 Amend）
- **Staging area 模式**（changelist 的替代）：`Compare HEAD, Staged and Local Versions` 打开**三向 Diff Viewer**，中间面板是**可编辑**的功能完整编辑器，逐行/逐 chunk stage

**Diff Viewer**
- 颜色：绿=Added、蓝=Modified、灰=Deleted
- 导航：Prev/Next Difference（`Shift+F7`/`F7`）、Compare Prev/Next File（`Alt+←/→`）、Jump to Source（`F4`）、Collapse Unchanged Fragments
- 布局：Side-by-side / Unified 切换
- **可编辑**：side-by-side 右侧、unified 下侧可改（仅本地版本、非只读文件）
- 忽略空白：None / Trim / Ignore / Ignore+空行；高亮粒度：Words / Lines / Split changes / Characters / None
- 合并动作：Apply All Non-Conflicting / Apply from Left/Right / Resolve Simple Conflicts / Annotate / **Switch to Three-Side Viewer** / Undo-Redo merge / Compare with Clipboard

**Log 标签页（Alt+9）**
- **提交图谱**：分支标签、当前分支浅蓝高亮、我的提交粗体、多仓库彩色条纹、父子跳转、拓扑排序、Show First Parent / No Merges、折叠/展开线性分支、长边显示
- 筛选：Branch / User / Date / Paths / Search（正则 + 大小写）；`Ctrl+L` 聚焦；`Go to Hash/Branch/Tag`（`Ctrl+F`）
- 比较：Compare with Local / Show Repository at Revision / Checkout Revision / Create Patch；分支级 Compare with Current / Show Diff with Working Tree；文件级 Show Diff（`Ctrl+D`）/ Compare Before with Local / Show Changes to Parents
- **提交右键菜单（历史管理全家桶）**：Cherry-pick、Revert Commit、Undo Commit、Reset Current Branch to Here、New Branch、New Tag、Edit Commit Message、Fixup、Squash Into、Drop Commits、Squash Commits、**Interactively Rebase from Here**、Push All up to Here、Add Commits to Remote Branch、Rebase onto Selected、Copy Revision Number、View in browser、Go to Child/Parent Commit

**分支间应用变更**
- **Merge**：`Git|Merge` 对话框，选项 `--no-ff/--ff-only/--squash/-m/--no-commit/--no-verify/--allow-unrelated-histories`；**Smart merge**（自动 stash→merge→unstash）；Abort（VCS widget）
- **Rebase**：`Git|Rebase`，`--onto`（new/old base）、`--rebase-merges/--keep-empty/--root/--update-refs/--autosquash`、可 rebase 其他分支
- **交互式 Rebase**：Log 右键 `Interactively Rebase from Here` → 对话框 Pick / Stop to Edit / Reword / Squash / Fixup / Drop + 上下调序 + 图谱预览 + Start Rebasing；Continue/Abort
- **Cherry-pick**：状态栏显示 cherry-pick 态，Abort/Continue；Apply separate changes（选文件 cherry-pick 进 changelist）；Apply separate files（`Get from Branch`）；Non-Picked Commits 高亮

**Shelf / Stash**
- **Shelf**：shelve 单文件或整 changelist（不能 shelve 未版本化文件）、命名、shelf diff、部分 shelve、unshelve 到指定 changelist、Import Patches、Restore 已 unshelve、自动 shelve base revision（供 3-way merge）、自定义 shelf 位置
- **Stash**：message、Keep index、Apply/Pop、Unstash as new branch、Reinstate Index、Drop/Clear；可与 Shelf 合并到一个标签

**Push**
- `Ctrl+Shift+K`；Push 对话框：多仓库、选目标 remote/branch、预览变更、**Push tags（All / Current Branch）**、**Force push（`--force-with-lease`）**、Push All up to Here
- **Push Rejected 对话框**：Rebase / Merge / 自动更新；Protected branches 设置

### 4.3 关键洞察

- **PyCharm 的「杀手锏」是 Commit 窗口的 chunk/行级勾选 + gutter 直接提交 + 三向可编辑 staging diff**——把「部分提交」做到极致，这正是 OpenCharm 最缺的（D1 + 无 hunk）。
- **VS Code 的「杀手锏」是编辑器 gutter 内联 diff + Source Control Graph + 命令面板全覆盖**——把「git 在场感」和「键盘可达」做到极致，这正是 OpenCharm 面 ①④ 的空白。
- 两家都把 **cherry-pick/revert/reset/rebase/tag** 挂在**历史条目右键**上——OpenCharm 历史是扁平文本且无右键，等于这些操作「无家可归」。

---

## 5. 三方细粒度功能矩阵

> ✅ 完整 · ⚠️ 部分/弱 · ❌ 缺失

| 能力 | VS Code | PyCharm | OpenCharm |
|---|---|---|---|
| 文件级 stage/unstage | ✅ | ✅ | ✅ |
| **Hunk 级 stage** | ✅ gutter 按钮 | ✅ diff 勾选 chunk | ❌ |
| **行级 stage** | ✅ Stage Selected Ranges | ✅ gutter 勾选行 / Split Chunks | ❌ |
| 丢弃整文件 | ✅ | ✅ | ✅ |
| 丢弃 hunk/行 | ✅ gutter Revert | ✅ | ❌ |
| **diff 内可编辑** | ⚠️（主要 stage/revert） | ✅ 右/下侧可改 | ❌ readOnly |
| 三向 diff（HEAD/Staged/Local） | ⚠️ merge editor 三面板 | ✅ Compare HEAD/Staged/Local | ❌ |
| Inline / Side-by-side 切换 | ✅（+Auto） | ✅ | ⚠️ 仅 side-by-side + 端内布局切换 |
| 折叠未变更 / 上下处导航 | ✅ | ✅ | ✅ |
| 忽略空白 / 高亮粒度 | ✅ 设置 | ✅ Words/Lines/Chars | ❌ |
| **编辑器 gutter 装饰** | ✅ 绿/蓝/红 + 弹 diff | ✅ 蓝/绿标记可勾选 | ❌ |
| **行内 blame 装饰** | ✅ + hover + 模板 | ✅ Annotate（跳 Log/隐藏版本/检测移动） | ❌（仅文本 dump） |
| 冲突 CodeLens（current/incoming/both） | ✅ | ✅ | ⚠️ 块级按钮（非 CodeLens） |
| 3-way Merge Editor | ✅ | ✅ 三栏 | ⚠️ 块级合并，result 编辑弱 |
| **提交图谱（DAG）** | ✅ Source Control Graph | ✅ Log 图谱（拓扑/折叠/条纹） | ❌ 扁平 50 条 |
| incoming/outgoing 高亮 | ✅ | ✅ | ❌ |
| 文件历史（Timeline/History） | ✅ | ✅ 文件/目录/选区历史 | ❌（仅独立 localHistory） |
| 历史筛选（分支/用户/日期/路径/搜索） | ⚠️ Graph 工具栏 | ✅ 全套 | ❌ |
| Go to Hash/Branch/Tag | ⚠️ | ✅ Ctrl+F | ❌ |
| 比较两提交 / Compare with Local | ✅ | ✅ | ❌ |
| Show Repository at Revision | ⚠️ | ✅ | ❌ |
| **cherry-pick** | ✅ Graph 右键 | ✅ Log 工具栏/右键 + 状态栏态 | ❌ |
| **revert** | ✅ | ✅ Revert Commit | ❌ |
| **reset（soft/mixed/hard）UI** | ✅ | ✅ Reset Current Branch to Here | ❌（仅内部 unstage 用） |
| **merge（发起）** | ✅ Merge Branch | ✅ Merge 对话框 + 选项 + Smart merge | ❌ |
| **rebase / 交互式 rebase** | ⚠️ Pull(Rebase) | ✅ 完整交互式 rebase | ❌ |
| **tag 创建/浏览/检出** | ⚠️ 命令 | ✅ New Tag + Go to Tag | ❌ |
| stash message | ✅ | ✅ | ❌（恒空 D2） |
| stash diff / 部分 stash | ✅ View Stash | ✅ stash diff | ❌ |
| **Shelf（shelve/unshelve）** | ❌（用 stash） | ✅ 完整 | ❌ |
| changelist | ❌ | ✅ | ❌ |
| remote 管理（add/remove/rename/upstream） | ✅ | ✅ Manage Remotes | ❌ |
| push 选远端/分支 / force-with-lease | ✅ Push to | ✅ Push 对话框 | ❌ 裸命令 D3 |
| pull rebase / fetch prune | ✅ | ✅ | ❌ |
| Sync（pull+push）+ 状态栏 ↑↓ | ✅ | ✅ | ❌ |
| Publish to GitHub / 发布分支 | ✅ | ⚠️ | ❌ |
| 多仓库视图 | ✅ Repositories | ✅ 多 root | ❌ |
| **凭据管理 / GIT_ASKPASS** | ✅ helper | ✅ | ❌ stdin(null) D4 |
| 远程进度 / 取消 | ✅ | ✅ | ❌ 120s 杀 D4 |
| Worktree | ✅ | ⚠️ | ❌ |
| 子模块 | ⚠️ | ✅ | ❌ |
| 提交前检查（format/analyze/TODO/tests/hooks） | ⚠️ 扩展 | ✅ 全套 | ❌ |
| AI 提交信息 | ✅ sparkle | ✅ | ❌ |
| **命令面板 git 命令** | ✅ 全套 | ✅ Actions | ❌ 仅 git_panel D9 |
| **git 快捷键** | ✅ | ✅ 全套 | ❌ D8 |
| **菜单栏 Git 菜单** | ✅ | ✅ | ❌ D10 |
| **文件树/编辑器右键 git** | ✅ | ✅ | ❌ D11 |
| **状态栏分支可点击** | ✅ | ✅ VCS widget | ❌ D7 |
| git init 前端入口 | ✅ | ✅ | ❌ D13 |

---

## 6. 差距归因：为什么「全」被感知成「不全」

把 D1–D14 映射到用户心理，得到 6 条「感知杀手」：

1. **入口单一且下沉（D9/D10/D11/D8）**：pull/push/stash/history/blame 全在「更多操作」二级菜单；命令面板搜 `git` 只有 1 条；菜单栏无 Git；编辑器/文件树右键无 git；零快捷键。用户按肌肉记忆（`Ctrl+Shift+P`、菜单栏、右键）全部落空 → 判定「没有」。

2. **粒度只在文件层（无 hunk/行 + D1）**：主流 IDE 的 SCM 内核体验是「diff 里逐块/逐行点 + 号」。OpenCharm 只能整文件，diff 还只读 → 判定「不专业、残缺」。

3. **编辑器零 git 反馈（无 gutter/无行内 blame）**：常年看不到「git 在场」信号 → 潜意识里 git 是「藏起来的角落」。

4. **历史无图、blame 无锚（D5/D6）**：扁平文本日志 + 文本 dump blame，看不出分支关系、点不动 hash → 对多数用户这是「Git 强不强」的直接观感指标。

5. **状态栏是死的（D7）**：分支名不可点、无 ↑↓ 计数。竞品都让状态栏承担「同步状态」心智。

6. **远程/凭据黑洞（D3/D4）**：push/pull 无远端选择、无进度、无取消、120s 一刀切、HTTPS 需密码时静默失败 → 任何一次远程失败都被归因为「Git 不可用」。

---

## 7. 分级改进方案

> 优先级：**P0 感知修复（快赢）→ P1 能力补全（高价值）→ P2 深度对齐**。
> 每项含：现状 / 目标 / 交互规格 / 落地位置 / 成本（前端 FE / 后端 BE / 全栈 FS）。

### 7.1 P0 — 可见性 / 可达性（成本低、直接扭转口碑）

#### P0-1 命令面板补齐 git 命令 · 成本 FE
- **现状**：仅 `git_panel`（`main.ts:1089`）。
- **目标**：stage/unstage/commit/push/pull/fetch/stash(pop/list)/checkout/log/blame/diff 全部可 `Ctrl+Shift+P` 模糊搜索直达。
- **规格**：在 quickOpen 动作注册处批量加 `{id:"git_*", label:"Git: …", run:…}`，复用 `git.ts` 现有函数；标签用「Git: 」前缀便于过滤。
- **落地**：`shell/src/main.ts` 命令注册区（`registerQuickOpenActions` 注入点）。

#### P0-2 菜单栏增加「Git」菜单 · 成本 FE
- **现状**：`getMenuItems` 仅 file/edit/view/tools（`main.ts:1280`）。
- **目标**：一级「Git」菜单：提交 / 推·拉·抓取 / 贮藏 / 分支 / 历史 / 初始化仓库；与命令面板同源。
- **落地**：`main.ts:1280 getMenuItems` 增 `case "git"`；`index.html:39-42` 加菜单按钮。

#### P0-3 文件树 / 编辑器 tab 右键加入 git 项 · 成本 FE
- **现状**：`fileTree.ts:466 renderCtxMenu` 通用构建器，调用点无 git；编辑器 tab 右键无 git。
- **目标**：右键菜单加「暂存 / 取消暂存 / 打开差异 / 丢弃 / 显示历史 / Blame / 复制路径」。
- **落地**：`fileTree.ts` 右键 CtxItem 列表注入；编辑器 tab 右键上下文（`main.ts` tab 区）。

#### P0-4 状态栏分支可点击 + 同步计数 · 成本 FS
- **现状**：`updateGitStatusBar`（`git.ts:122-130`）仅文本，不可点、无计数。
- **目标**：点分支名弹分支切换面板；显示 `↑n ↓m`（ahead/behind）。
- **规格**：ahead/behind 需后端 `git_status` 增 `git rev-list --left-right --count @{upstream}...HEAD`；状态栏元素加 click → 复用 `toggleBranchList`。
- **落地**：`git.ts:122`、`git_status.rs:39`、`index.html:307 #status-git`。

#### P0-5 编辑器 gutter 内联 diff 装饰 · 成本 FS（高价值）
- **现状**：编辑器内零 git 反馈（面 ① 空白）。
- **目标**：行号槽绿（新增）/蓝（修改）/红三角（删除）；点击弹出该 hunk 内联 diff，可 stage/revert 该块。
- **规格**：参照现有 `runGutter.ts`/`debugGutter.ts` 模式新增 `gitGutter.ts`；数据 = 当前文件 vs HEAD 的行级 diff（需后端单文件 hunk diff 命令，或复用 `git_diff_versions` 解析）；用 Monaco `deltaDecorations` 画 gutter。
- **落地**：新增 `shell/src/gitGutter.ts`；后端 `git_cmds.rs` 增 `git_diff_hunks(path)`（`git diff -U0` 解析 hunk 头）。

#### P0-6 历史改 `--graph` + 分支标签 · 成本 BE+FE
- **现状**：`git_log` 扁平 50 条无图（`git_cmds.rs:558-584`，D5）。
- **目标**：带分支/合并拓扑的历史视图，当前分支高亮，显示分支标签。
- **规格**：`git log --graph --all --decorate --pretty=format:...`（含 `%d` refs）；前端按 graph 字符缩进渲染 + 当前分支行高亮。
- **落地**：`git_cmds.rs:558 git_log`、`git.ts:918 renderHistory`。

#### P0-7 SCM 空态加「初始化仓库」按钮 · 成本 FE+BE(轻)
- **现状**：空态只有文案无按钮（`git.ts:163-165`，D13）；后端 `fs_cmds.rs:224 git_init_at` 仅向导内部用。
- **目标**：非仓库时显示「初始化 Git 仓库」按钮，点击执行 `git init` 并刷新。
- **落地**：`git.ts` 空态分支加按钮；`git_cmds.rs` 抽 `git_init` 命令（或复用 `git_init_at`）。

### 7.2 P1 — 高频能力补全

#### P1-1 Hunk / 行级暂存与丢弃 · 成本 FS（**最高价值单项**）
- **现状**：仅整文件（D 无 hunk）。
- **目标**：diff 编辑器每个变更块 gutter 加 Stage/Unstage/Revert；支持选行范围 `Stage Selected Ranges`。
- **规格**：解析 `git diff -U0` hunk 头 → 每 hunk 生成 `git apply --cached`（stage）/ `git apply --cached -R`（unstage）/ `git checkout -p` 替代（revert）；前端在 diff 编辑器 gutter 渲染按钮（需放开 D1 只读或独立 gutter 层）。
- **落地**：`git_cmds.rs` 增 `git_stage_hunk`/`git_unstage_hunk`；`git.ts:489 showDiff` + `ensureDiffEditor:461`。

#### P1-2 三态 diff + 人工切换 · 成本 BE+FE
- **现状**：仅「已暂存?HEAD↔Index:Index↔工作区」二态自动（D 无三态）。
- **目标**：每文件可在 未暂存(工作区↔HEAD) / 已暂存(HEAD↔Index) / 工作区↔HEAD 间切换。
- **落地**：`git_cmds.rs:386 git_diff_versions` 增基准参数；`git.ts:489` diff 工具栏加切换器。

#### P1-3 diff 内可编辑（至少 result 侧）· 成本 FE
- **现状**：`readOnly:true`（`git.ts:472`，D1）。
- **目标**：冲突解决场景放开 result 侧编辑，结合块级选择直接改文本。
- **落地**：`git.ts:461 ensureDiffEditor` 条件化 readOnly；冲突模式启用编辑 + 保存回写。

#### P1-4 cherry-pick / revert / reset UI · 成本 FS
- **现状**：无（D12）。
- **目标**：历史条目右键挂载 cherry-pick / revert / reset(soft/mixed/hard) / 新建分支 / 新建标签。
- **落地**：`git_cmds.rs` 增 `git_cherry_pick`/`git_revert`/`git_reset`；`git.ts:918 renderHistory` 条目加右键菜单。

#### P1-5 发起 merge / rebase(to branch) · 成本 FS
- **现状**：无（D12）。
- **目标**：分支条/历史提供「合并到当前分支」「变基到分支」；merge 冲突走现有冲突 UI。
- **落地**：`git_cmds.rs` 增 `git_merge`/`git_rebase`；`git.ts:966 refreshBranchPanel` 分支项右键。

#### P1-6 tag 创建 / 浏览 / 检出 · 成本 FS
- **现状**：无（D12）。
- **目标**：历史条目「新建标签」；分支条区域加标签列表；Go to Tag。
- **落地**：`git_cmds.rs` 增 `git_tags`/`git_create_tag`/`git_checkout`(复用)。

#### P1-7 Blame 结构化 · 成本 FE（后端已就绪）
- **现状**：`git_blame` 已返回结构化 `GitBlameLine`，但前端渲染纯文本（D6）。
- **目标**：行内注解（作者/相对时间），点击 hash 跳到对应 commit 详情，忽略空白开关。
- **落地**：`git.ts:880 showBlame` 改结构化渲染 + 接 P0-6 历史跳转。

#### P1-8 stash 增强 · 成本 FS
- **现状**：message 恒空、无 diff（D2）。
- **目标**：stash 时弹输入 message；stash 列表项可看 diff；支持 include-untracked。
- **落地**：`git.ts:702 gitStash` 加输入框；`git_cmds.rs:486 git_stash_push` 透传 message + `-u`；列表项接 `git_show stash@{n}`。

### 7.3 P2 — 深度对齐（按需排期）

| # | 改进项 | 规格要点 | 成本 |
|---|---|---|---|
| P2-1 | remote 管理 | add/remove/rename/set-upstream；push 选远端+分支；显示 upstream | FS |
| P2-2 | 凭据管理 | GIT_ASKPASS 桥 + 弹窗输 HTTPS 凭据；失败导向输出面板给可操作提示 | FS（难） |
| P2-3 | 远程异步化 + 进度/取消 | 去 120s 一刀切（D4），改流式输出 + 可取消 + 进度条 | BE+FE |
| P2-4 | changelist / shelf | 对标 PyCharm changelist 分组 + shelve/unshelve（可参考 localHistory 交互） | FS |
| P2-5 | Source Control Graph 级可视化 | 完整提交 DAG + 拖拽创建分支/重置 + incoming/outgoing | FE（重） |
| P2-6 | 子模块支持 | 子模块状态识别 + 递归操作 | FS |
| P2-7 | AI 提交信息 | 基于暂存 diff 生成提交信息（对标 VS Code sparkle / PyCharm） | FE+模型 |
| P2-8 | 提交前检查 | format / analyze / TODO / run tests / git hooks 开关 | FS |
| P2-9 | Worktree | 创建/切换/比较 worktree | FS（重） |

---

## 8. 交互细节审查（微交互层）

> 方法：逐函数实读 `git.ts` 全部交互代码（渲染 + 事件接线 + 对话框），对照 VS Code / PyCharm 官方文档中的微交互设计。
> 发现分三类：**A. 交互级 bug（3 个，应优先修）**、**B. 反馈/状态细节缺口（10 项）**、**C. 可用性/快捷操作缺口（8 项）**。

### 8.1 A 类：交互级 bug（建议立刻修，成本极低）

| # | 问题 | 证据 | 竞品对照 | 修复建议 |
|---|---|---|---|---|
| **A1** | **Ctrl+Enter 绕过提交按钮禁用态**：`git-commit-btn` 在无暂存时 `disabled`（`git.ts:158/198`），但 textarea 的 `Ctrl/Cmd+Enter` 处理器（`git.ts:1161-1166`）直接调 `commitChanges()`，不检查暂存态。无暂存时按 Ctrl+Enter 会向 git 发一个空提交请求，得到 git 报错「没有暂存的文件」，再走 catch 变 toastFail——用户看到的是一个**莫名其妙的失败 toast**，而不是「请先暂存」的引导 | `git.ts:1161` vs `git.ts:158` | VS Code：提交按钮禁用即不可触发，且空提交时内联提示 | `commitChanges` 开头加 `if (!hasStagedFiles()) { inline 提示「请先暂存要提交的更改」; return; }`；顺带 `commitChanges(true)`（Amend）应放行（amend 无需暂存也可用） |
| **A2** | **`commitAll()` 空消息报错链不闭环**：`commitAll` 先 `stageFiles` 再 `commitChanges()`（`git.ts:451-458`）。若提交消息为空，`commitChanges` 走内联校验 return——但**所有文件已被暂存**，用户消息没写、全仓库进了暂存区，与预期「什么都没发生」严重不符（误操作后需手动全部 unstage） | `git.ts:451-458` | VS Code Commit All 行为：消息为空时不动暂存区 | `commitAll` 前置校验消息非空（空则内联提示 + focus，不 stage） |
| **A3** | **`applyMergeResolve` 的冲突残留检测正则误伤**：用 `/<<<<<<<\|>>>>>>>\|\n=======/` 检测（`git.ts:624`）。`\n=======` 会把**用户主动选择「保留两者」或普通文本中本来就有的 markdown setext 标题下划线**误判为冲突残留 → toast「仍有未处理的冲突标记」，块级合并被卡死无法应用 | `git.ts:624` | VS Code merge editor：残留检测基于结构化冲突区状态，非正则 | 检测改为基于 `mergeSegments`：`parseMergeSegments` 已能识别冲突块，只检查「选择后重组的内容是否仍含**成对完整**的 `<<<<<<<…=======…>>>>>>>` 三行结构」，或直接信任解析结果（解析不到冲突块即无残留） |

### 8.2 B 类：反馈与状态细节缺口

| # | 缺口 | 现状（证据） | 竞品做法 |
|---|---|---|---|
| B1 | **提交无「暂存计数」反馈** | 提交按钮只写「提交」；面板标题有「已暂存（n）」但按钮本身不体现 | VS Code 按钮显示 `提交(3)`；PyCharm 提交按钮显示选中文件数 |
| B2 | **提交成功后焦点去向未管理** | `commitChanges` 成功后清空 textarea 但不归还焦点（`git.ts:444-445`） | 提交后焦点回 SCM 面板/保留输入态 |
| B3 | **分支切换无未提交保护与提示** | `checkoutBranch` 直接 `git_checkout`（`git.ts:1057`），带脏工作区切换若 git 拒绝只给一个失败 toast；无「先提交 / stash / 强制」选择 | VS Code：明确提示未提交更改会阻止切换，引导提交或 stash；PyCharm：**Smart merge**（自动 stash → checkout → unstash） |
| B3' | **checkout 失败无恢复指引** | 失败仅 toastFail 原始 git stderr（`git.ts:1061-1064`） | PyCharm 给出可操作动作（stash 后重试） |
| B4 | **无忙碌态/进度反馈** | push/pull/fetch/stash/checkout/commit 全部无 busy 状态：按钮可重复点击（连点 push 可能并发两个 git 进程）；界面无「正在推送…」提示 | VS Code 状态栏同步图标转圈 + 按钮禁用；PyCharm 后台任务进度条 |
| B5 | **diff 打开无 loading 态** | `showDiff` await 期间面板空白（`git.ts:489-517`） | 读取期间显示 spinner / 骨架 |
| B6 | **Stash 无 message 输入 & 无 diff 预览** | `gitStash` 恒传 `message:""`（`git.ts:706`）；stash 列表项只有「弹出/丢弃」按钮，不能看内容（`git.ts:790-809`） | VS Code：Stash 可输入说明、`View Stash`；PyCharm：stash tab 内双击文件看 diff |
| B7 | **历史条目不可交互** | 历史 item 只能点击看 `git show` 纯文本（`git.ts:942-959`），无右键、无 hash/作者点击跳转、无分页（固定 50 条） | PyCharm Log：右键全家桶 + 父/子跳转 + 无限滚动 + 筛选 |
| B8 | **分支列表无远程分支** | `git_branches` 只跑 `git branch`（本地），列表永远看不到 origin/*（`git.ts:974`、`git_cmds.rs:265`） | VS Code checkout 列表含本地/远程/最近分支；PyCharm 分支面板分 Local/Remote 树 |
| B9 | **Blame 时间格式生硬** | `new Date(r.time*1000).toISOString().slice(0,10)`（`git.ts:889`）——作者本时区的日期被格式化成 UTC，且无相对时间 | VS Code blame 模板支持 `${authorDateAgo}`（如「3 天前」）；PyCharm 可配日期格式 |
| B10 | **确认框文案不够「后果具体化」** | 丢弃确认只说「此操作不可撤销」（`git.ts:318`）；接受冲突覆盖无内容量信息 | 更具体：显示文件数、是否有未暂存改动被覆盖、staged 内容是否保留 |

### 8.3 C 类：可用性与快捷操作缺口

| # | 缺口 | 现状 | 竞品做法 |
|---|---|---|---|
| C1 | **无「打开文件」入口** | SCM 条目点击 = 直接 diff；想编辑源文件必须去文件树找（右键菜单也只有「打开差异」） | VS Code / PyCharm：列表点击看 diff，右键/双击打开文件；PyCharm 可设置双击行为 |
| C2 | **无「暂存所有更改」工具栏快捷** | 批量 stage 只能点分组标题 hover 的 `+`（`git.ts:188-194`） | VS Code 工具栏有 ✓ 提交按钮 + 常驻 + 按钮；分组标题 `+` 也常驻可见 |
| C3 | **stash 面板与历史/分支面板互斥但无 tab 化** | `toggleStashPanel`/`toggleHistory`/`toggleBranchList` 三者手动互斥（`git.ts:754-763/904-915/999-1004`），面板状态不记忆 | 竞品均为工具窗 tab（Log/Shelf/Stash 独立标签） |
| C3' | **「更多操作」菜单不含分支/历史入口**（历史在菜单里但分支靠分支条图标）入口逻辑分裂 | `wireGitUI:1103-1118` | VS Code：单一 … 菜单涵盖所有操作 + 命令面板 |
| C4 | **diff 无「忽略空白」选项** | diff 工具栏只有 上一处/下一处/折叠/布局/接受当前/传入/Blame/关闭（`wireGitUI:1124-1147`） | VS Code `diffEditor.ignoreTrimWhitespace`；PyCharm 4 档空白选项 + 高亮粒度 |
| C5 | **冲突 diff 缺「接受双方」快捷** | diff 工具栏只有 接受当前/接受传入（`wireGitUI:1128-1143`）；「两者都保留」藏在块级合并 UI 里，两套交互割裂 | VS Code CodeLens 三选一 + Compare Changes 同屏；PyCharm Apply both / Append |
| C6 | **多文件批量操作缺失** | 变更列表不支持多选（无 Ctrl/Shift 点选）、无「暂存 N 个」批处理 | VS Code 支持多选批量 stage/discard；PyCharm changelist 整组操作 |
| C7 | **新建分支无重名/非法字符预校验** | `createBranchAndSwitch` 直接调后端（`git.ts:1071-1087`），非法名靠 git 报错 | 前端正则预校验（`refs/heads` 规则）+ 即时内联提示 |
| C8 | **无「暂存后自动滚动/高亮」** | stage 文件后列表全量重渲染，滚动位置和视觉焦点丢失 | 局部更新或保持滚动位置 + transition 高亮移动 |

### 8.4 交互改进项并入优先级矩阵

| 改进项 | 影响 | 成本 | 建议优先级 |
|---|---|---|---|
| A1/A2/A3 三个交互 bug | 高（直接影响可用性） | 低 | **立即修**（可并入任何迭代） |
| B4 忙碌态 + 防重入 | 高 | 低 | P0+（与 P0-1 命令面板同批） |
| B3 分支切换保护 | 高 | 中 | P1（可借 P1-5 merge/rebase 顺带） |
| C1 打开文件入口 | 高 | 低 | P0（并入 P0-3 右键菜单） |
| C5 冲突「接受双方」 | 中 | 低 | P0（diff 工具栏加一个按钮） |
| B8 远程分支列表 | 高 | 低 | P1（`git branch -a` + 分组渲染） |
| B6 stash message + diff | 中 | 低 | P1-8 范围 |
| B1 提交计数 | 低 | 低 | P0 顺手 |
| B9 blame 时间本地化 | 低 | 极低 | P1-7 顺带 |
| C2 批量暂存常驻按钮 | 低 | 低 | P0 顺手 |
| C3 面板 tab 化 | 低 | 中 | P2（随 Graph 重构） |
| C4 忽略空白 | 低 | 低 | P1-2（三态 diff）顺带 |
| C6 多选批量 | 中 | 中 | P2 |
| C7 分支名预校验 | 低 | 低 | P1 顺手 |
| B2/B5/B10/B7 | 低 | 低 | 各自功能项顺带 |

### 8.5 微交互层面的总结

OpenCharm git 的微交互**基础素质不差**（错误内联提示、丢弃确认、冲突互斥面板、防抖刷新、状态刷新令牌 CR-20 等都做了），但对照竞品有一批「最后一公里」缺失：**忙碌态与防重入、破坏性操作的前置校验、空态/加载态、焦点管理、批量操作、时间格式本地化**。这类问题单个都不致命，叠加起来就是「功能都在但用着别扭」的直接来源——与第 6 章的入口/粒度问题共同构成「功能全却像不全」的完整拼图。**建议把 A 类 3 个 bug 修复 + B4 + C1 + C5 作为 P0.5 批次，先于所有新功能落地。**

---

## 9. 优先级矩阵与排期（已并入第 8 章交互细节发现）

**优先级 = 用户可见影响 × 使用频率 ÷ 实现成本**

| 改进项 | 可见影响 | 频率 | 成本 | 优先级 |
|---|---|---|---|---|
| P0-1 命令面板 | 高 | 高 | 低 | ★★★★★ |
| P0-5 gutter 内联 diff | 高 | 高 | 中 | ★★★★★ |
| P1-1 hunk/行级暂存 | 高 | 高 | 中 | ★★★★★ |
| P0-6 graph 历史 | 高 | 中 | 中 | ★★★★ |
| P0-2 Git 菜单 | 中 | 高 | 低 | ★★★★ |
| P0-3 右键 git | 中 | 高 | 低 | ★★★★ |
| P0-4 状态栏可点+计数 | 中 | 高 | 中 | ★★★★ |
| P1-3 diff 可编辑 | 中 | 中 | 低 | ★★★★ |
| P1-7 blame 结构化 | 中 | 中 | 低 | ★★★ |
| P1-4 cherry-pick/revert/reset | 中 | 中 | 中 | ★★★ |
| P0-7 init 按钮 | 中 | 低 | 低 | ★★★ |
| P1-2 三态 diff | 中 | 中 | 中 | ★★★ |
| P1-5 merge/rebase | 中 | 中 | 中 | ★★★ |
| P1-8 stash 增强 | 低 | 中 | 低 | ★★ |
| P1-6 tag | 低 | 低 | 中 | ★★ |
| P2-* 远程/凭据/shelf/图谱 | 高 | 低-中 | 高 | 排后 |

**推荐迭代**

0. **迭代 0（P0.5 交互止血，~2 天）**：A1/A2/A3 三个交互 bug + B4 忙碌态防重入 + C1「打开文件」右键 + C5 diff 工具栏「接受双方」。**✅ 已于 2026-09-18 落地**（`git.ts` / `index.html` / `gitMerge.test.ts`；tsc 全绿，46 文件 434 测试全过，含 2 个新增 A3 用例）。
   纯修复与微调，不动架构，先于一切新功能。**验收复核（E2E-01~10 全绿）时又修出 3 个真 bug**：① 刷新按钮只刷状态不重渲染面板（用户须切 tab 才见新状态，`git.ts` wireGitUI）；② `gitStatusOf` 大小写失配——写入 key 为 git 原始大小写、读取方传归一化小写路径，直接 Map.get 必 miss，文件树 git 右键菜单/徽标对混合大小写文件名消失（`gitStatusState.ts` 新增归一化索引 + `git.ts` 三处 rebuild）；③ `git init` 不带 `-b main`——宿主无 `init.defaultBranch` 配置时回落 master，与向导及用户预期不符（`git_cmds.rs` + e2e mock 同步）。另清理死代码：`git_diff` 旧命令（已被 `git_diff_versions` 取代）删除。
   **远程分支检出闭环（E2E-11/11b 验收驱动，2026-09-18 追加）**：修出第 4 个真 bug——`git_branches` 用 `%(refname:short)` 解析，而 git 对远程分支输出 `origin/x`（无 `remotes/` 前缀），前缀判定 remote 恒 false：**远程分支混进本地组、无云图标、点击走裸 checkout 必进 detached HEAD（迭代 3 B8 从未真正工作）**。修复：改完整 `%(refname)` 自行剥 `refs/remotes/`/`refs/heads/` 前缀（Rust + mock 同构）。在此之上落地检出路由：无同名本地 → `checkout --track origin/x` 建跟踪分支（点击零决策，不弹确认框）；有同名本地 → 切本地绝不覆盖；右键补「检出（仅查看，detached HEAD）」显式出口（与 tag 检出同款模式）；云图标 tip 与实现对齐。E2E：`update-ref` + `remote.origin` config 纯本地构造远程分支（本机安全策略禁 git 传输协议，clone/fetch/push 不可用），25 条全绿。
   **用户实测反馈修复（2026-09-18 第二批）**：① 编辑区保存后 SCM 面板不实时刷新（须切走再切回）——`handleFsChanged` 只 `refreshGitStatus` 不 `renderGitPanel`（与刷新按钮同款病），修复：git 视图前台时事件链尾即时重绘（E2E-12/12b 锁定）；② 「老是有黑框闪」——全仓 spawn 点审计抓到 3 处裸 `taskkill`（util.rs `kill_process_tree`/`kill_process_tree_async` + dap.rs `kill_pid_tree`）缺 `CREATE_NO_WINDOW`：编辑 .py 触发 LSP 重启/停止运行杀进程树时前台闪控制台，统一补 `no_window()`。③ **底部差异面板刷新修复（两步走的第 1 步）**：`showDiff` 是无事件订阅的静态快照，文件变更后内容不更新。修复：`refreshDiffIfViewing`（fs-changed 驱动，300ms 防抖 + 乱序令牌 + 冲突文件保护——块级选择/编辑态进行中不自动刷）+ `reopenDiffIfViewing`（stage/unstage 显式触发，auto 口径语义对齐 VS Code：staged 切 HEAD↔Index，文件离开变更列表才关闭）+ `closeDiffPanel` 补清状态（此前只切 tab，再点差异 tab 见僵尸内容）。验证：tsc / cargo / vitest 46×434 / git E2E 30 条全绿。
   **差异视图迁入编辑区 tab（第 2 步，2026-09-18 落地）**：diff 从底部面板迁为编辑区 tab（对标 VS Code「文件的一种视图」心智模型）。Tab 模型扩展 `kind:"diff"` + `diff:{base,conflict}` 元数据（path 用 `diff:` 前缀隔离命名空间，90+ 处按 path 工作的逻辑零误伤）；DOM 整体搬家（`#git-diff-panel` 入 `#editor-row`，absolute inset:0 与 `#editor` 互斥呈现；工具栏/块级合并面板/diff 编辑器纵向布局保留）；底部 `tab-diff` 移除，`BottomTab` 收窄为 output/terminal/git。新交互能力：**多文件 diff tab 共存**（此前单实例看下一个覆盖上一个）、SCM 点击去重（已开的 diff tab 激活而非重建）、Ctrl+Tab/←→ 与文件 tab 混排导航、diff tab 从后台切回按需重拉（`refreshDiffOnActivate`，递归由 `showDiffImpl(activate=false)` 打断）。E2E 验收驱动修出 2 个迁移期 bug：activateTab 的 diff 分支漏 `updateEditorOverlay()`（欢迎页覆盖层盖住 tabbar，elementFromPoint 实证定位）；closeTabSilent 对 diff tab 走 LSP/诊断清理链（虚拟路径会污染 LSP）。E2E-13a/13b/13c 重写为 tab 语义 + 新增 E2E-14（多 tab 共存/去重/关闭恢复），git E2E 31 条全绿。
1. **迭代 1（扭转口碑，~1 周）**：P0-1 + P0-2 + P0-3 + P0-6 + P0-7 + P1-3 + B1 提交计数 + C2 批量暂存按钮。**✅ 已于 2026-09-18 落地**（命令面板 12 条 Git 命令、Git 一级菜单、文件树右键 git 三项、历史 refs 装饰 + `--all` + 当前分支高亮、SCM 空态 init 按钮、冲突 diff 传入侧可编辑 + 「应用编辑结果」、提交按钮暂存计数；tsc / cargo check / 46 文件 434 测试全绿）。
   交付即让用户「搜得到、点得到、右键得到、历史有图、diff 能改」——直接消解「功能不全」主诉。
2. **迭代 2（核心粒度，~1.5 周）**：P0-5 gutter 内联 diff + P1-1 hunk/行级暂存 + P1-2 三态 diff + C4 忽略空白。**✅ 已于 2026-09-18 落地**（`gitGutter.ts` 行级装饰：绿条新增/蓝条修改/红三角删除，随编辑防抖与 git 状态联动；`git_diff_hunks`/`git_apply_hunk` 后端命令 + diff 工具栏「+块/−块/丢弃块」按光标定位 hunk（patch 切片含文件头与尾换行，Windows 下走 `.git/` 内临时 patch 文件规避 stdin 锁与 MSYS 路径坑）；三态基准切换（自动/已暂存/总差异）+ 忽略空白开关；E2E 新增 3 条用例，全套 **8/8 绿**）。
   SCM 达到 VS Code 必经能力。
3. **迭代 3（高级工作流，~1.5 周）**：P0-4 同步计数 + P1-4 cherry-pick/revert/reset + P1-5 merge/rebase + B3 分支切换保护（Smart stash）+ P1-6 tag + P1-7 blame（含 B9 时间本地化）+ P1-8 stash（含 B6 message/diff）+ B8 远程分支 + C7 分支名预校验。**✅ 已于 2026-09-18 落地**（状态栏可点击 + ↑n↓m 同步计数；分支列表本地/远程分组 + 右键 merge（含 --no-ff/--squash）/rebase；历史条目右键 cherry-pick/revert/reset(soft/mixed/hard)/新建分支/新建标签；checkout 脏工作区三选保护（stash→checkout→pop）；分支名 refs 规则预校验；stash 可输 message/含 untracked/列表 diff 查看；blame 结构化（hash 可点跳详情 + 相邻同提交折叠 + 本地时区日期）；标签列表进分支面板；E2E 新增 4 条，全套 **12/12 绿**）。
4. **迭代 4（远程与深度，~2 周）**：P2-1 remote + P2-2 凭据 + P2-3 异步化 + P2-4 shelf/changelist。**✅ 已于 2026-09-18 落地 P2-1/2/3**（`git_remote_list/add/remove` + 远程管理面板（列表/添加/删除/推送到此）；push/pull/fetch 重构为**流式输出**（`git-op-stdout` 事件逐行推进度）+ **可取消**（busy 浮条 + `git_cancel_op` 杀进程树）+ fetch `--all --prune`；**P2-2 务实降级**：`GIT_TERMINAL_PROMPT=0` + askpass=echo 拒绝交互挂死，认证失败时输出 credential helper 配置指引（完整凭据 UI 属后续增强）；P2-4 shelf/changelist **暂缓**——侵入 git 语义大且与本地历史/标签能力重叠，待用户反馈优先级；E2E 新增 2 条，全套 **14/14 绿**）。
5. **迭代 5（旗舰体验）**：P2-5 图谱 + P2-7 AI 提交 + P2-8 提交前检查 + P2-9 worktree + C3 面板 tab 化 + C6 多选批量。**✅ 已于 2026-09-18 落地**（SCM 内嵌 tab「更改/历史/贮藏」；Ctrl/Shift 多选 + 批量暂存/取消暂存/丢弃操作条；提交建议 chips（Conventional Commits 规则式：按暂存文件类型/scope 推断 feat/fix/docs/chore/test 前缀，点击填入）；提交前 ruff format 暂存 Python 文件（仅工作区干净文件，会话开关在提交下拉）；历史 graph 车道 4 色着色；worktree 管理面板（列出/新建(-b)/移除/复制路径切换）；E2E 新增 3 条，全套 **17/17 绿**。P2-7 采用规则式而非 AI 生成——零依赖零成本零幻觉，AI 版可后续作为增强）。

> 每个迭代收尾均含两道门禁（见第 11 章）：**11.1 Code Review 清单**过一遍 + 新功能补对应 E2E 用例；迭代 5 结束后跑 **11.2 全量 Playwright 验收（E2E-01 ~ E2E-10）**，全绿即整体交付。

---

## 10. 风险与依赖

| 风险 | 说明 | 缓解 |
|---|---|---|
| hunk 级 stage 的 patch 构造 | `git apply --cached` 对上下文敏感，行号偏移易失败 | 用 `git diff -U0` 精确 hunk + 失败回退整文件 + 充分测试（已有 `gitMerge.test.ts` 范式） |
| 凭据管理（P2-2） | `stdin(null)`（D4）下 HTTPS 交互认证无法弹窗 | GIT_ASKPASS 指向桥接脚本 + Tauri 弹窗；或先做「失败明确提示 + 引导配置 helper」 |
| 远程异步化（P2-3） | 去 120s 硬超时需防进程泄漏 | 流式读取 + 显式取消 token + 进程树清理（已有 `kill_process_tree`） |
| gutter 装饰性能（P0-5） | 大文件逐行 diff 装饰可能卡顿 | 仅可视区装饰 + 防抖 + 复用 `gitStatusState` 缓存 |
| 图谱渲染（P2-5） | DAG 布局复杂 | 先用 `--graph` 文本缩进（P0-6），旗舰版再上 canvas/SVG DAG |
| 架构铁律 | 自研组件须独立进程/包，不侵入外壳内核 | git 命令均走 Tauri `invoke` → Rust 子进程，符合「独立进程」原则；新增命令延续此模式 |

---

## 11. 质量保障与验收流程（v2.1 新增）

> 两条硬性流程规则，适用于本计划全部迭代（迭代 0 – 迭代 5）：
> **① 每轮开发完成后必须 Code Review；② 全部迭代完成后必须用 Playwright 做 E2E 验收。**

### 11.1 每迭代 Code Review（开发完成的门禁）

**流程**：迭代内所有改动合入前，走一次集中 review（本轮已验证有效的实做方式：改动完成后由第二个视角对全部 diff 做逐文件复核）。

**Review 清单**（git 功能特有的检查点，随迭代演进追加）：

| 维度 | 检查点 |
|---|---|
| 正确性 | 新增 git 命令的参数传递（root/path 大小写、Windows 分隔符）；错误分支是否都有用户可见反馈（toast/内联），不允许静默失败 |
| 状态一致性 | 模块级可变状态（`diffConflictPath`、`mergeSelections`、`gitRemoteBusy` 等）在**每条成功/失败/取消路径**上是否正确复位——本轮复核发现的 7 个问题中 4 个属此类 |
| 数据安全 | 写回类操作（`write_file` + `git add`）确认覆盖范围与提示文案一致；两条平行解决路径（块级选择 vs 直接编辑）不可叠加生效且互有提示 |
| UI 状态竞态 | busy 态与重渲染互斥（`setBusy` 期间 `renderGitPanel` 不得覆写按钮）；刷新令牌（CR-20 模式）防乱序 |
| a11y / 反馈规范 | 遵循 memory 61552154 的通道分工（操作结果 toast / 被动发现输出面板 / 长指导 openAlert）；DOM id 查重；按钮补 `aria-label` |
| 架构铁律 | 前端不直接跑 git，一律 Tauri `invoke` → Rust `spawn_blocking` 子进程；新 Rust 命令注册进 `lib.rs`；不引入 `probe`/`intel`/外壳内部 API 依赖 |
| 死代码 | 移除或注释标记被替代的旧实现（如 `git_cmds.rs:243 git_diff` 已弃用，应随本轮清理） |

**Review 产出**：问题清单（分级 阻塞/建议）→ 修复 → 复验（tsc + `vitest run` + `cargo check` 三绿）→ 才算迭代完成。

### 11.2 整体 Playwright 验收（全部迭代完成后）

**目标**：以真实用户操作路径端到端验证 git 改进成果，覆盖单测无法触达的「Tauri 命令桥 + Monaco 渲染 + 多面板联动」链路。

**接入方案**（项目现状无 Playwright，需先搭建）：

1. **安装**：`shell/` 下 `npm i -D @playwright/test` + `npx playwright install chromium`；
   `playwright.config.ts` 设 `webServer: { command: "npm run dev", url: "http://localhost:5173" }`。
2. **Tauri 桥 mock**（关键）：浏览器模式下 `@tauri-apps/api/core` 的 `invoke` 不可用，需测试夹具拦截——
   `page.addInitScript` 注入 `window.__TAURI_INTERNALS__.invoke` mock，将 `git_*` 命令映射到 Playwright 侧的真实临时 git 仓库（`tmpdir` + `git init`），既保留真实 git 行为又不依赖 Tauri 运行时。
   （若后续采用 WebDriver 模式驱动真实 Tauri 窗口，此 mock 层可整体替换，用例保持不变。）
3. **用例目录**：`shell/e2e/git/*.spec.ts`，与现有 `src/__tests__/`（vitest 单测）分层——E2E 只测「用户旅程」，不重复单测逻辑。

**验收用例清单**（对照第 7/8 章交付项；每条 = 一个 spec）：

| # | 用户旅程 | 断言要点 |
|---|---|---|
| E2E-01 | 命令面板 git 可达性 | `Ctrl+Shift+P` → 输入 `git` → 出现 ≥12 条 `Git: *` 命令 → 逐条执行不报错 |
| E2E-02 | Git 菜单 | 菜单栏出现「Git」→ 拉取/推送/贮藏等菜单项可点击且有反馈 |
| E2E-03 | init 流程 | 非仓库空态显示「初始化 Git 仓库」→ 点击 → 面板切换为正常 SCM 视图 |
| E2E-04 | 暂存/提交主链路 | 修改文件 → 右键/`+` 暂存 → 提交按钮显示 `提交(1)` → 提交 → toast 成功 + 历史出现新条目 |
| E2E-05 | 迭代 0 修复回归 | 空暂存 Ctrl+Enter → **内联提示**（非 toast 报错）；空消息「提交全部」→ **不暂存任何文件** |
| E2E-06 | 冲突解决三路径 | 构造冲突 → ① 接受当前 ② 接受传入 ③ 接受双方 ④ 块级选择 ⑤ 编辑传入侧 + 应用编辑结果 → 文件均标记已解决，且切换后编辑器回到只读 |
| E2E-07 | 文件树右键 git | 有变更文件右键出现 暂存/差异/Blame；untracked 只显示「暂存新文件」 |
| E2E-08 | 历史图谱 | 多分支仓库 → 历史含车道列与 refs 标签；`HEAD ->` 行高亮 |
| E2E-09 | 忙碌态防重入 | 慢速 push（mock 延迟）期间连点 → 只发一次请求；按钮转圈禁用 |
| E2E-10 | 大小写路径 | 混合大小写文件名（如 `Foo.py` 仓库内为 `foo.py`）右键暂存 → git 命令收到原始大小写路径（Linux CI 上必须过） |

**门禁**：E2E 全绿 + 单测全绿（46 文件基线只增不减）+ 复核清单归档到本报告附录，视为整体验收通过。

**基建落地状态（2026-09-18）**：E2E 基建已交付——`shell/playwright.config.ts`（webServer 起 vite dev、串行、失败留 trace）、`shell/e2e/mocks/tauri-mock.js`（纯 JS 注入 `__TAURI_INTERNALS__`：invoke/事件/窗口 API 全套，对齐 `@tauri-apps/api` v2 真实实现）、`shell/e2e/helpers.ts`（每用例真实临时 git 仓库 + `git_*`/`fs_*` bridge 分发 + 写操作后模拟 `fs-changed` 事件推送）；E2E-01/04/05 共 5 条用例全绿。**首轮即抓出 2 个真实 bug**（`stageFiles`/`commitFiles` 均未 `refreshGitStatus`，面板更新依赖 watcher 时序——已修复）。运行方式：`cd shell && npx playwright test e2e/git`。
补充（同日）：**`Ctrl+Shift+P` 命令面板键位已注册**（`command_palette`，VS Code 同款；此前该组合落入浏览器「打印」）——quickOpen 新增 `commands` 直达模式（只列命令、跳过文件/符号索引秒开），键位三处同步（keybindingDefaults.ts / state.ts / Rust settings.rs，漂移锁测试通过）；视图菜单同步增加「命令面板」入口；E2E-01 已改用 `Ctrl+Shift+P` 断言（拦截打印即用例超时，天然防回归）。

### 11.3 与现有流程的衔接

- **主干开发 + 短分支 PR；CI 全绿才可合并**（架构铁律第 3 条）——本节 review 门禁与 E2E 验收即 CI 的前置内容：PR 模板加「已按 11.1 清单 review / 新增交互已补 E2E 用例」勾选项。
- 迭代 0/1 的 review 已按 11.1 执行（复核发现并修复 7 问题，见 9.3 节记录）；E2E 基建（安装 + mock 层 + E2E-01/04/05 冒烟）~~建议在**迭代 2 开始前**搭好~~ **✅ 已于 2026-09-18 交付**（见 11.2 落地状态；且首轮运行即抓出 stage/commit 后未刷新状态的真实 bug），后续每个迭代的验收用例随功能一起写，避免最后集中补测试。

---

## 附录 A：代码位置速查

| 主题 | 位置 |
|---|---|
| SCM 面板渲染 / 提交 / 暂存 | `git.ts:155 renderGitPanel`、`:233 renderScmItem`、`:279 stageFiles`、`:422 commitChanges` |
| diff 只读 / 双路 | `git.ts:461 ensureDiffEditor`（`readOnly:true`@472）、`:489 showDiff` |
| 冲突块级合并 | `git.ts:576 renderMergeBlocks`、`:620 applyMergeResolve`、`gitMerge.ts:17/69` |
| 历史 / blame / 分支 | `git.ts:918 renderHistory`、`:880 showBlame`、`:966 refreshBranchPanel` |
| 状态栏分支 | `git.ts:122 updateGitStatusBar`、`index.html:307 #status-git` |
| 远程裸命令 / stash | `git.ts:685 gitRemoteOp`、`:702 gitStash`（message:""@706） |
| 文件树 git 装饰 / 右键 | `fileTree.ts:150-169`、`:466 renderCtxMenu`、`gitStatusState.ts` |
| 命令面板 / 菜单 / 快捷键 | `main.ts:1089 git_panel`、`:1280 getMenuItems`、`keybindingDefaults.ts`（无 git） |
| Rust 命令 | `git_cmds.rs`：`exec_git_timeout:41`、`git_stage:113`、`git_commit:224`、`git_diff:243`(死码)、`git_branches:265`、`git_diff_versions:386`、`git_push/pull/fetch:451/462/473`、`git_stash_*:486-535`、`git_log:558`、`git_show:588`、`git_blame:616` |
| 状态读取 | `git_status.rs:39 git_status`、`:82 current_branch`、`:99 parse_porcelain_z` |
| git 二进制定位 | `tool_paths.rs:21 ENV_GIT` |
| git init（仅向导） | `fs_cmds.rs:224 git_init_at` |

## 附录 B：参考资料

- VS Code 官方：Source Control overview / Staging & Committing / Resolve merge conflicts / Branches & worktrees / Repos & remotes / History（https://code.visualstudio.com/docs/sourcecontrol/*）
- PyCharm 官方：Commit and push / Investigate changes / Diff Viewer / Log tab / Merge·Rebase·Cherry-pick / Shelve or stash（https://www.jetbrains.com/help/pycharm/*）
- OpenCharm 现状：`shell/src` + `shell/src-tauri/src` 代码实读（2026-09-18），关键缺陷 D1–D14 均带 file:line 证据。