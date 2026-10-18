# Montauri Git 远端克隆开发计划（迭代 6）

> 版本：v1.0 · 日期：2026-10-01 · 状态：**已交付（2026-10-01）**
> 归属：`git_improvement_report.md` 迭代 6
> 范围：核心闭环（Rust `git_clone`/`git_default_branch` + 前端 `cloneRepository.ts` + tab 入口 + 命令面板/菜单/欢迎页入口 + URL 预设/平台识别 + 浅克隆 + 冲突检测 + 错误信息本地化）
> 工期：2–2.5 天 · PR 粒度：合 1 PR

---

## 1. 目标与价值

补齐 Montauri「创建项目」链路的最后一块——**从远端仓库克隆**。对标 PyCharm「Get from VCS」、VS Code「Clone Git Repository」。

复用已交付的流式/可取消/P2-2 凭据引导基建（`exec_git_streaming`、`git_cancel_op`），**零新依赖、零新密钥管理**。

---

## 2. 范围与非目标

### 2.1 本期做（已审批）

| # | 项 | 说明 |
|---|---|---|
| 1 | `git_clone`（Rust） | 流式 + 可取消，复用 `exec_git_streaming` |
| 2 | `git_default_branch`（Rust） | 预览远端默认分支，流式 + 可取消 |
| 3 | 新建项目面板 tab 切换 | 本地创建 / 从远端克隆，互斥切换 |
| 4 | `cloneRepository.ts`（前端） | 域自治新模块，复用 `newProject.ts` 范式 |
| 5 | 命令面板 + 菜单 + 欢迎页入口 | `Git: 从远端克隆…` / 文件菜单独立项 / 欢迎页三步卡 |
| 6 | URL 预设 + 平台识别 | GitHub / GitLab / Gitee 三档 codicon + 自动识别 |
| 7 | 浅克隆 `--depth 1` 开关 | checkbox，大仓库快速预览 |
| 8 | 目标路径冲突检测 | 非空 → 三选项对话框 |
| 9 | 完成后自动打开 | 开工作区 + 自动打开主文件（README.md 优先 → 第一个 `.py`） |
| 10 | 错误信息本地化 | authentication failed / repository not found / could not resolve host 等 |
| 11 | i18n `cloneRepository` 域 | zh-CN / en-US 双语 |
| 12 | E2E 5 条 | 覆盖 tab 切换 / 预设填入 / 分支预览 / clone 闭环 / 取消 |

### 2.2 明确不做（登记后续）

| 项 | 原因 |
|---|---|
| 真 OAuth + 仓库浏览器 | 三家 API 差异、密钥持久化新负担；与「自用 IDE」定位不符 |
| 远端分支/标签预览 | fetch 后选分支是 clone 概念耦合度低的后续增强 |
| SSH key 健康体检 | P2-2 凭据引导已覆盖错误反馈场景 |
| 多仓库批量 Clone | 增量价值低 |

---

## 3. 架构总览

```
┌─ 前端 shell/src/ ──────────────────────────────┐
│  cloneRepository.ts（域自治）                   │
│  ├── 渲染 Clone tab（DOM 构建/事件接线）        │
│  ├── URL 预设 + 平台识别（纯函数，可单测）      │
│  ├── 主分支预览（300ms 防抖调 git_default_branch）│
│  ├── 冲突检测 + 三选项对话框                    │
│  └── clone 流式进度消费（git-op-stdout 事件）   │
│  newProject.ts（改造：tab 切换 + openCloneTab） │
│  main.ts（命令面板 + 菜单 + 欢迎页接线）        │
│  i18n：cloneRepository 域 zh-CN/en-US          │
├─ Rust shell/src-tauri/src/ ───────────────────┤
│  git_cmds.rs：新增 git_clone + git_default_branch│
│  lib.rs：invoke_handler 注册                   │
└─ E2E shell/e2e/git/05-clone.spec.ts ──────────┘
```

---

## 4. Rust 侧详细设计

### 4.1 `git_clone` 命令

```rust
#[tauri::command]
pub async fn git_clone(
    app: AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    target_dir: String,
    depth: Option<u32>,
    branch: Option<String>,
) -> Result<String, String>
```

**参数校验**：
- `url.trim()` 非空，否则返回 `"克隆 URL 不能为空"`
- `target_dir.trim()` 非空，否则返回 `"目标路径不能为空"`
- **scheme 白名单**：只接受 `https` / `http` / `ssh` / `git` / `file`；拒绝时返回 `"不支持的 URL 协议：{scheme}"`
- **路径穿越守卫**：`target_dir` 不得含 `..` 组件；`target_dir` 为绝对路径时校验（与 `validate_repo_relative` 同款逻辑，但目标不是仓库而是**父目录**——因为 clone 会自建目录）
- 父目录不存在 → 友好错误 `"父目录不存在：{parent}"`

**构建命令**：
```
git clone
  --progress              # 进度输出到 stderr（exec_git_streaming 的 err_stream 会捕获）
  [ --depth {depth} ]     # depth 为 Some(n) 时附加
  [ --branch {branch} ]   # branch 为 Some(b) 时附加
  {url}
  {target_dir}            # git clone 的最后一个参数 = 本地目标目录名
```

**执行**：走 `exec_git_streaming(app, root_parent, cmd, "clone", wid)`，其中 `root_parent` = `target_dir` 的父目录（git clone 在父目录下执行，自建目标目录）。

**返回**：
- 成功 → git stdout（含 "Cloning into …" + "Switched to branch …" 等，前端 toast 摘要用）
- 失败 → stderr + 凭据引导（复用 P2-2：Authentication failed / could not read Username / terminal prompts disabled → 追加 credential.helper store 指引）

**取消语义**：`git_cancel_op(window, "clone")` 已存在；clone 期间 op key = `"clone"`。

**Windows 路径处理**：`target_dir` 中的 `/` 在 spawn 前替换为 `\`（与 `git_apply_hunk:505-512` 同款经验，避免 MSYS 路径转换把路径吃掉）。

**环境变量**：复用 `GIT_TERMINAL_PROMPT=0` + `GIT_ASKPASS=echo`（P2-2 务实降级），防止交互式凭据挂死。

### 4.2 `git_default_branch` 命令

```rust
#[tauri::command]
pub async fn git_default_branch(
    app: AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<String, String>
```

**实现**：
```
git ls-remote --symref {url} HEAD
```
- 解析 `ref: refs/heads/main\tHEAD` → `"main"`
- 无 symref（如空仓库或部分 git host）→ 返回 `"HEAD"`（前端降级提示）
- 走 `exec_git_streaming`，op key = `"clone-inspect"`（与 "clone" 区分，允许并行取消）

**返回**：主分支名；失败时返回 git stderr（前端显示「无法预览主分支」但不阻断 clone）。

### 4.3 `lib.rs` 注册

在现有 `git_cmds::git_init` 下方追加两行：
```rust
git_cmds::git_clone,
git_cmds::git_default_branch,
```

---

## 5. 前端侧详细设计

### 5.1 模块划分与职责

| 文件 | 职责 |
|---|---|
| `cloneRepository.ts`（新） | Clone tab 渲染/接线、平台识别、URL 预设、主分支预览防抖、clone 流式进度消费、冲突检测、完成后 openWorkspace |
| `newProject.ts`（改） | 顶部 tab 切换（本地/Clone）、`openCloneTab()` 暴露、互斥状态管理 |
| `main.ts`（改） | 命令面板 `git_clone` 条目、文件菜单「从远端克隆…」项、欢迎页三步卡接线、语言切换时重建 clone tab 文案 |
| `index.html`（改） | Clone tab DOM 骨架（或动态构建，见 §5.3） |

### 5.2 数据结构与状态机（`cloneRepository.ts`）

```ts
// 纯函数输出，可单测
export function detectPlatform(url: string): "github" | "gitlab" | "gitee" | "other";
export function fillPreset(platform: "github" | "gitlab" | "gitee", userRepo: string): string;

// 域内状态（模块级 let，非全局 state.ts，与 newProject.ts 同模式）
interface CloneState {
  url: string;
  targetDir: string;
  depth1: boolean;
  inspecting: boolean;        // git_default_branch 进行中（主分支预览）
  defaultBranch: string | null;
  busy: boolean;              // git_clone 进行中
  progressLines: string[];    // 流式输出缓存（最多保留 200 行，防内存泄漏）
}
let cloneState: CloneState = { …初始值… };

// 防抖令牌
let inspectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let inspectCancelToken: number = 0;
```

### 5.3 详细交互说明

#### 5.3.1 新建项目面板 tab 切换

**DOM 结构**（`index.html` `#new-project-modal` 内顶部插入）：

```html
<!-- 新增 tab 条（插入在 #new-project-modal 的 header 区域） -->
<div id="new-project-tabs" class="new-project-tabs">
  <button class="new-project-tab active" data-tab="local" data-i18n="newproject.tabLocal">本地创建</button>
  <button class="new-project-tab" data-tab="clone" data-i18n="cloneRepository.tabRemote">从远端克隆</button>
</div>
```

**交互规格**：
- 点击 tab → 互斥切换 `active` class；对应内容区显隐（`#new-project-local` / `#new-project-clone`）
- `active` tab 的 `aria-selected="true"`，其余 `false`
- 切换时**保留**另一 tab 的输入值（用户来回看不会丢），但切换为本地创建时 clone 的 inspect 请求应**取消**（`git_cancel_op(window, "clone-inspect")`），避免后台继续跑无意义请求
- 从 clone tab 切回 local tab 时，若 clone 处于 `busy` 态 → tab 按钮 disabled（用户无法切走，防止 clone 进行中误切 local 创建）；tab 条 hover 提示「克隆进行中…」
- 面板关闭时统一复位 tab 到 local + 清空 clone 输入（与 `newProject.ts` 现有关闭逻辑合并）

**与 `newProject.ts` 的衔接**：
- `newProject.ts` 原有内容区包一层 `#new-project-local`；新增 `#new-project-clone` 内容区
- `openNewProjectPanel()` 默认激活 local tab（不改变现有「新建项目」心智）
- `openCloneTab()`（由 `cloneRepository.ts` 导出）= 直接激活 clone tab + 打开面板

#### 5.3.2 Clone tab 内容区 DOM

```html
<div id="new-project-clone" class="new-project-section hidden">
  <!-- ① URL 输入 -->
  <label data-i18n="cloneRepository.url.label">仓库地址</label>
  <div class="clone-url-row">
    <input id="clone-url" type="text" placeholder="https://github.com/owner/repo.git" autocomplete="off" />
    <div class="clone-presets">
      <button class="clone-preset" data-platform="github" title="GitHub">
        <i class="codicon codicon-github"></i>
      </button>
      <button class="clone-preset" data-platform="gitlab" title="GitLab">
        <i class="codicon codicon-gitlab"></i>
      </button>
      <button class="clone-preset" data-platform="gitee" title="Gitee">
        <i class="codicon codicon-cloud"></i>
      </button>
    </div>
  </div>
  <div id="clone-platform-hint" class="clone-hint hidden"></div>

  <!-- ② 目标路径 -->
  <label data-i18n="cloneRepository.target.label">目标路径</label>
  <div class="clone-target-row">
    <input id="clone-target" type="text" autocomplete="off" />
    <button id="clone-browse" data-i18n="cloneRepository.target.browse">浏览…</button>
  </div>

  <!-- ③ 浅克隆 -->
  <label class="clone-option">
    <input id="clone-depth1" type="checkbox" />
    <span data-i18n="cloneRepository.depth.checkbox">仅最新一次提交（--depth 1）</span>
  </label>

  <!-- ④ 主分支预览 -->
  <div id="clone-branch-preview" class="clone-hint hidden">
    <span data-i18n="cloneRepository.detectedBranch">将检出：origin/</span><span id="clone-branch-name"></span>
  </div>

  <!-- ⑤ 提交按钮 -->
  <button id="clone-submit" data-i18n="cloneRepository.submit">克隆</button>

  <!-- ⑥ 流式进度条（busy 态显示） -->
  <div id="clone-progress" class="clone-progress hidden">
    <div class="clone-progress-bar"><div id="clone-progress-fill"></div></div>
    <div id="clone-progress-text" class="clone-progress-text"></div>
    <button id="clone-cancel" data-i18n="cloneRepository.cancel">取消</button>
  </div>
</div>
```

#### 5.3.3 各控件交互行为

**A. URL 输入框（`#clone-url`）**

| 事件 | 行为 |
|---|---|
| `input` | ① 清空平台图标（如果有）；② 300ms 防抖后调 `detectPlatform(url)` → 更新 `#clone-platform-hint` 显示平台名 + codicon；③ 若 URL 非空且合法 → 启动 `inspectDefaultBranch(url)` 防抖 |
| `blur` | 若 URL 为空 → 清空平台 hint + 隐藏分支预览；若 URL 非法（无 scheme / scheme 不在白名单）→ 输入框加 `.error` 红边（CSS），`#clone-platform-hint` 显示错误文案 |
| `keydown Enter` | 若表单有效 → 触发 clone；否则 focus 到第一个错误字段 |

**平台识别规则**（`detectPlatform`，纯函数，可单测）：
```ts
function detectPlatform(url: string): "github" | "gitlab" | "gitee" | "other" {
  try {
    const u = new URL(url); // 对 git@host:user/repo.git 会抛，走 catch
    if (/github\.com$/i.test(u.hostname)) return "github";
    if (/gitlab\.com$/i.test(u.hostname)) return "gitlab";
    if (/gitee\.com$/i.test(u.hostname)) return "gitee";
  } catch {
    // git@host:user/repo.git 格式
    const m = url.match(/^git@([^:]+):/);
    if (m) {
      const host = m[1];
      if (/github\.com$/i.test(host)) return "github";
      if (/gitlab\.com$/i.test(host)) return "gitlab";
      if (/gitee\.com$/i.test(host)) return "gitee";
    }
  }
  return "other";
}
```

**B. 预设按钮（`.clone-preset`）**

| 事件 | 行为 |
|---|---|
| `click` | 在 `#clone-url` 输入框填入预设前缀（`https://github.com/` / `https://gitlab.com/` / `https://gitee.com/`），并 focus 到输入框末尾（用户接着打 `owner/repo.git`） |
| 二次点击 | 无特殊行为（已经填了前缀，再点一遍把前缀替换为同一前缀 = no-op） |

**C. 目标路径输入框（`#clone-target`）**

| 事件 | 行为 |
|---|---|
| `input` | 实时校验：若目录已存在 → 按钮旁显示 warning hint「目标目录已存在」；不影响提交（clone 自带冲突检测对话框） |
| `blur` | 若路径为空 → 从 URL 自动推导（见下方「自动推导」） |
| `keydown Enter` | 触发 clone |

**目标路径自动推导**：URL 输入后 focus 离开且目标路径为空时：
1. 取 URL 最后一段路径（`repo.git` 或 `repo`）
2. 去 `.git` 后缀 → `repo`
3. 与默认父目录（`getRecentWorkspaces()[0]` 的父目录，与新建项目位置同口径）拼接 → 完整路径填入 `#clone-target`

```ts
function deriveTargetDir(url: string, defaultParent: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || '';
    return joinPath(defaultParent, last.replace(/\.git$/, ''));
  } catch {
    const m = url.match(/[:/]([^/]+?)(?:\.git)?$/);
    return joinPath(defaultParent, (m?.[1] || 'repo'));
  }
}
```

**D. 浏览按钮（`#clone-browse`）**

- `click` → `invoke("pick_folder")` → 用户选目录 → 填入 `#clone-target`
- 若用户选了某路径的子目录（如 `D:\work\myrepo` 已存在）→ 不做过滤，允许用户明确覆盖（clone 自带冲突检测兜底）

**E. 浅克隆 checkbox（`#clone-depth1`）**

- 默认 unchecked
- 状态存入 `cloneState.depth1`
- 提交时透传 `depth: depth1 ? 1 : null`（Rust 侧只认 `Some(1)` 或 `None`）

**F. 主分支预览（`#clone-branch-preview`）**

- **触发条件**：URL 输入框 `input` 事件后 300ms 防抖；URL 非空、scheme 合法时触发
- **请求**：`invoke("git_default_branch", { url })`
- **取消机制**：
  - 每次 `input` 清掉旧的 `inspectDebounceTimer`
  - 发送前 `++inspectCancelToken`；返回时校验 token 匹配（防乱序）
  - tab 切换时 `git_cancel_op(window, "clone-inspect")`
- **成功**：显示 `#clone-branch-preview`，`#clone-branch-name.textContent = branchName`
- **失败**：隐藏 `#clone-branch-preview`；不阻断 clone（用户仍可提交）
- **busy 态**：`#clone-branch-preview` 显示 spinner（轻量，不占用独立区域，仅在小字前加转圈图标）

**G. 克隆按钮（`#clone-submit`）**

| 状态 | 表现 | 行为 |
|---|---|---|
| 空闲 + 表单有效 | 正常可点 | clone |
| 空闲 + 表单无效 | disabled，opacity 0.5 | 不响应 |
| busy | disabled，文案变为「克隆中…」+ spinner | 不响应 |

**表单有效性校验**（提交前）：
- URL 非空
- URL scheme 在白名单
- targetDir 非空
- 三项都满足 → `valid = true`

**提交流程**：
1. `setBusy(true)` → 按钮 disabled + 显示「克隆中…」
2. 显示 `#clone-progress` 区（进度条 + 输出文本 + 取消按钮）
3. `invoke("git_clone", { url, targetDir: targetDir.trim(), depth: depth1 ? 1 : null, branch: defaultBranch })`
4. 注册 `git-op-stdout` 监听器（`op === "clone"`）
   - 每收到一行 → `cloneState.progressLines.push(line)` → `#clone-progress-text.textContent = lastLine`
   - 进度条解析：若行含 `Receiving objects:` → 提取百分比 → 更新 `#clone-progress-fill.style.width`
   - 行数上限 200，超限时 shift 最旧行
5. clone 完成（成功/失败/取消）→ `setBusy(false)` + unlisten 事件 + 清理进度区

**H. 取消按钮（`#clone-cancel`）**

- `click` → `invoke("git_cancel_op", { op: "clone" })`
- 前端立即显示「正在取消…」；等待 `git_clone` promise 返回「已取消」
- 取消后：进度区清空、按钮恢复「克隆」、表单恢复可编辑

**I. 冲突检测对话框**

clone 返回目标目录已存在错误时，弹 `openAlert` 三选项：

```
标题：cloneRepository.conflict.title（"目标目录已存在"）
消息：{targetDir}\n\n该目录已存在且非空，请选择操作方式。
按钮①：cloneRepository.conflict.cancel（"取消"）→ 关闭对话框，保留表单
按钮②：cloneRepository.conflict.change（"换个路径"）→ 对话框关闭，focus 到 `#clone-target`
按钮③：cloneRepository.conflict.subdir（"克隆到子目录"）→ targetDir 追加 `/repo`（自动推导同名子目录），自动重新提交
```

**J. 完成后自动打开**

clone 成功后：
1. `closeNewProjectPanel()`（关闭面板）
2. `openWorkspace(targetDir)`（打开工作区）
3. `openFirstSensibleFile(targetDir)`：
   - 尝试 `invoke("read_file", path.join(targetDir, "README.md"))` → 成功则 `openFile(…)`
   - 否则列出工作区文件 → 找第一个 `.py` → `openFile(…)`
   - 否则 `openFile` 不触发（用户自己在文件树点）
4. toast 成功：`cloneRepository.success`（"已克隆到 {path}"）

**K. 错误处理路径**

| 错误场景 | 前端行为 |
|---|---|
| URL 空 / scheme 拒绝 | 输入框红边 + 内联提示（不弹对话框） |
| 目标路径空 | 输入框红边 + 内联提示 |
| 目标目录已存在 | 弹三选项对话框（见 I） |
| 认证失败（P2-2 引导） | 输出面板追加凭据指引 + toastFail |
| 仓库不存在 / 404 | toastFail + 输出面板显示完整 git stderr |
| 网络超时（240s） | toastFail + 输出面板显示超时 |
| 用户取消 | toast（info 级）「已取消」 |
| 未知错误 | toastFail + 输出面板显示原始 stderr |

**错误信息本地化**：Rust 返回的原始 git message（如 "Authentication failed"）经 `backendError.ts` 模板匹配翻译：
- `"Authentication failed"` → `cloneRepository.err.authFailed`
- `"could not resolve host"` → `cloneRepository.err.resolveHost`
- `"repository not found"` → `cloneRepository.err.repoNotFound`
- `"already exists and is not an empty directory"` → `cloneRepository.err.notEmpty`
- 未命中 → 原样返回（不吞错误）

`backendError.ts` 新增映射条目（与现有 `git.pushRejected` 等 git 域错误并列）：
```ts
"Authentication failed": "cloneRepository.err.authFailed",
"could not resolve host": "cloneRepository.err.resolveHost",
"repository not found": "cloneRepository.err.repoNotFound",
"already exists and is not an empty directory": "cloneRepository.err.notEmpty",
```

### 5.4 与现有功能衔接

**命令面板**：`buildQuickOpenActions` 新增：
```ts
{ id: "git_clone", label: t("cloneRepository.cmdLabel"), run: () => openCloneTab() }
```
语言切换时 `onLocaleChange` 重建命令面板（与现有 `registerQuickOpenActions(buildQuickOpenActions())` 同模式）。

**文件菜单**：`getMenuItems("file")` 在「新建项目」下方加：
```ts
{ label: t("menu.file.cloneRepository"), action: () => openCloneTab() },
```
（i18n 走 `core.ts` `menu.file.cloneRepository`）

**欢迎页三步卡**：PR-S2 已落地，卡①「新建项目」动作 = `openNewProjectPanel()`（默认 local tab，不变）；用户想 clone 走命令面板或菜单即可。无需改造欢迎页（保持最小改动）。

**语言切换**：`cloneRepository.ts` 订阅 `onLocaleChange` → 若 Clone tab 当前可见 → 重绘全部文案（input placeholder、button label、hint text）。文案数组改「build 函数 + let 缓存」模式（memory 60941324 第 ⑩ 条）。

---

## 6. i18n 详细设计

### 6.1 新增域 `cloneRepository`

文件：`shell/src/i18n/locales/zh-CN/cloneRepository.ts` + `en-US/cloneRepository.ts`

**zh-CN 真源**：
```ts
export const cloneRepository = {
  "cloneRepository.tabRemote": "从远端克隆",
  "cloneRepository.url.label": "仓库地址",
  "cloneRepository.url.placeholder": "https://github.com/owner/repo.git",
  "cloneRepository.url.invalid": "请输入有效的 git 仓库地址",
  "cloneRepository.target.label": "目标路径",
  "cloneRepository.target.browse": "浏览…",
  "cloneRepository.target.empty": "目标路径不能为空",
  "cloneRepository.depth.checkbox": "仅最新一次提交（--depth 1）",
  "cloneRepository.detectedBranch": "将检出：origin/",
  "cloneRepository.submit": "克隆",
  "cloneRepository.submitting": "克隆中…",
  "cloneRepository.cancel": "取消",
  "cloneRepository.cancelling": "正在取消…",
  "cloneRepository.success": "已克隆到 {path}",
  "cloneRepository.progress.default": "准备克隆…",
  "cloneRepository.platform.github": "GitHub",
  "cloneRepository.platform.gitlab": "GitLab",
  "cloneRepository.platform.gitee": "Gitee",
  "cloneRepository.platform.other": "Git",
  "cloneRepository.conflict.title": "目标目录已存在",
  "cloneRepository.conflict.message": "{path}\n\n该目录已存在且非空，请选择操作方式。",
  "cloneRepository.conflict.cancel": "取消",
  "cloneRepository.conflict.change": "换个路径",
  "cloneRepository.conflict.subdir": "克隆到子目录",
  "cloneRepository.cmdLabel": "Git: 从远端克隆…",
  "cloneRepository.err.authFailed": "认证失败。可在终端配置凭据缓存后重试：\n  git config --global credential.helper store\n（首次 push/pull 时输入一次密码，之后记住；或改用 SSH 远程地址）",
  "cloneRepository.err.resolveHost": "无法解析主机。请检查网络连接或仓库地址。",
  "cloneRepository.err.repoNotFound": "仓库不存在。请检查地址或访问权限。",
  "cloneRepository.err.notEmpty": "目标目录已存在且非空。",
};
```

**en-US** 逐条对应（略，格式同 `newproject.ts`）。

### 6.2 菜单词条（`core.ts` 追加）

zh-CN：`"menu.file.cloneRepository": "从远端克隆…"`
en-US：`"menu.file.cloneRepository": "Clone Repository…"`

---

## 7. 验收门禁

### 7.1 Code Review 清单（迭代 6 专属检查点）

| 维度 | 检查点 |
|---|---|
| 正确性 | `git_clone` scheme 白名单拦截非法 URL；Windows 路径 `/` → `\` 转换；`validate_repo_relative` 同款路径穿越守卫 |
| 状态一致性 | `cloneState.busy` 在成功/失败/取消/切换 tab 四条路径都正确复位；`inspectDebounceTimer` 清理无泄漏 |
| 数据安全 | `target_dir` 不得含 `..`；`file://` 跨盘拒绝；URL 长度上限（防恶意输入） |
| UI 竞态 | busy 态 tab 切换 disabled；inspect 返回 token 匹配校验；流式输出行上限 200 防内存泄漏 |
| a11y | tab 按钮 `aria-selected`；输入框 `aria-invalid`；进度区 `aria-live="polite"`；取消按钮 `aria-label` |
| 架构铁律 | 前端不直接跑 git，全部 Tauri invoke；新 Rust 命令注册进 `lib.rs`；不引入 probe/intel 依赖 |
| i18n | 新域 key 与 en-US 一一对应；`backendError.ts` 新增映射条目；菜单 key 不撞现有 `menu.file.*` |

### 7.2 E2E 用例（`shell/e2e/git/05-clone.spec.ts`）

| # | 旅程 | 断言 |
|---|---|---|
| E2E-15 | tab 切换 | 点「从远端克隆」→ local 字段隐藏、clone 字段可见；切回 local 状态保留；clone busy 时 local tab disabled |
| E2E-16 | 预设填入 | 点 GitHub 预设 → URL 框 = `https://github.com/`；平台 hint 显示 GitHub |
| E2E-17 | 主分支预览 | mock `git_default_branch` 返回 `main` → 显示「将检出：origin/main」；URL 清空后 preview 隐藏 |
| E2E-18 | Clone 成功闭环 | mock `git_clone` 流式返回 → 面板关闭 + `openWorkspace` 被调用 + 打开 README.md（或第一个 .py） |
| E2E-19 | 路径冲突检测 | mock 返回 notEmpty → 三选项对话框；选「换个路径」→ focus 到目标输入框 |
| E2E-20 | 流式 + 取消 | mock `git_clone` 慢返回 → 进度条出现；点取消 → toast「已取消」且 `openWorkspace` 未被调用 |

### 7.3 通用门禁

- `tsc --noEmit` 全绿
- `cargo check` 全绿
- `vitest run` 全绿（含新增 `cloneRepository.test.ts`）
- `npx playwright test e2e/git/05-clone.spec.ts` 6/6 绿
- 中英文切换后 clone tab 文案正确（手动 smoke）

---

## 8. 工期与文件改动预估

| 阶段 | 内容 | 文件 | 时长 |
|---|---|---|---|
| Rust | `git_clone` + `git_default_branch` + `lib.rs` 注册 + 单测 | `git_cmds.rs`, `lib.rs` | 0.5 天 |
| 前端模块 | `cloneRepository.ts` 新建 + `newProject.ts` tab 改造 + DOM 接线 + 事件 | `cloneRepository.ts`(新), `newProject.ts`, `index.html` | 0.5 天 |
| 菜单/命令面板 | `main.ts` getMenuItems + buildQuickOpenActions + 欢迎页接线 | `main.ts` | 0.5h |
| i18n | 新域 zh-CN/en-US + backendError 映射 | `locales/*/cloneRepository.ts`(新), `backendError.ts` | 0.5h |
| 测试 | vitest 纯函数 + e2e 6 条 | `__tests__/cloneRepository.test.ts`(新), `e2e/git/05-clone.spec.ts`(新), `tauri-mock.js`, `helpers.ts` | 0.5 天 |
| 门禁 | tsc / cargo / vitest / e2e 四门禁 | — | 0.5h |
| **合计** | | | **2–2.5 天** |

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 大仓库 clone 慢 | 浅克隆 `--depth 1`；流式 + 可取消 |
| 认证失败 | P2-2 凭据引导已落地（自动追加 credential.helper store 指引） |
| scheme 误用（file:// 跨盘） | scheme 白名单 + 路径穿越守卫 |
| clone 期间切 tab | busy 态 tab disabled；取消旧 inspect |
| 默认分支解析失败 | 不阻断 clone，UI 降级显示「无法预览」 |
| 与 newProject.ts 耦合 |  handler 注入模式（与 `wireNewProject` 同），`cloneRepository.ts` 不直接 import `main.ts` |

---

## 10. 落地前置工作清单

1. 拉分支 `feat/git-clone`
2. 写本文档（`docs/git_clone_dev_plan.md`）→ 本步骤已完成
3. **Rust 先**：`git_clone` + `git_default_branch` + `lib.rs` 注册 + `cargo test git_clone` 单测
4. **前端**：建 `cloneRepository.ts` 空骨架 → tab 切换 DOM → 事件接线 → 流式进度
5. **i18n**：新域 `cloneRepository` 走 apply_ts 流程（memory 60941324）
6. **mock + e2e**：扩 `tauri-mock.js` + `helpers.ts` 桥接 + 6 条用例
7. **review**：按 §7.1 清单逐文件复核
8. **验收**：tsc + cargo check + vitest + e2e 四门禁全绿
9. **归档**：本文档末尾标「已交付」；`git_improvement_report.md` 补迭代 6 节

---

## 12. 交付记录（2026-10-01）

**四门禁全绿**：`tsc --noEmit` ✓ · `cargo check` ✓ · vitest 88 文件 / 941 测试 ✓ · `e2e/git/23-clone.spec.ts` 6/6 ✓（回归 `ux/03` 新建项目 3/3 ✓）。

### 12.1 与计划的偏差

| # | 计划 | 实际交付 | 理由 |
|---|---|---|---|
| 1 | E2E 文件 `e2e/git/05-clone.spec.ts` | `e2e/git/23-clone.spec.ts` | `git/05` 已被 iteration0-fixes 占用，按现有递增编号顺延 |
| 2 | 错误本地化映射加在 `backendError.ts` | 集中在 `cloneRepository.ts::localizeCloneError` | git stderr 为英文，backendError 面向后端中文错误模板；域内轻量映射更贴合，`backendError.ts` 零改动 |
| 3 | 冲突对话框三按钮 | `openConfirm` 双按钮（克隆到子目录 / 换个路径）+ 关闭即取消 | 复用现有对话框基建，语义等价；子目录名经 `conflict.subdirHint` 预告 |
| 4 | 取消提示「已取消」 | 新增词条 `cloneRepository.cancelled`（"已取消克隆"），info 级 toast | 补齐计划 §5.3.3-H 的取消反馈路径（Rust 返回「已取消」/ cancelled 时区分于失败 toast） |

### 12.2 实现期补强的计划外细节

- **clone busy 锁 tab**：`doClone` 起 `setCloneTabLock(true)`，成功/失败/取消/finally 四路径均复位（§7.1 状态一致性检查点）。
- **切走 clone tab 取消 inspect**：`cancelCloneInspect()`（newProject `switchNewProjectTab` 与 `resetCloneForm` 均调用），防后台空转请求。
- **手动点 tab 时动态构建 DOM**：`switchNewProjectTab("clone")` 调 `ensureCloneTabRendered()`（原实现仅 `openCloneTab` 入口会构建，手动切 tab 会见空白区）。
- **`openCloneTab` 走正规面板入口**：经 `wireCloneRepository` 注入 `openPanel`（= `openNewProjectPanel`），不再直接 `classList.remove("hidden")`（面板位置默认值 / Esc / 焦点链不缺失）。
- **语言切换重建**：`onLocaleChange → applyCloneTexts()` 重绘静态文案（不重建 DOM，保留输入值）。
- **E2E mock**：`git_clone` 走「落盘模拟」（本机 file 协议被 EDR 拦截，与 `git_push` 同款取舍）——目标目录生成 README.md + main.py 并 git init + commit；进度行经 `__TAURI_INTERNALS__.__emit` 推 `git-op-stdout` 事件；失败/延迟经 `window.__E2E_CLONE_PRESET__` 注入；`git_cancel_op(op=clone)` 令 pending clone 立即 reject「已取消」。

---

## 11. 附录

### 11.1 代码位置速查

| 主题 | 位置 |
|---|---|
| Rust clone 命令 | `shell/src-tauri/src/git_cmds.rs`（新增） |
| Rust 命令注册 | `shell/src-tauri/src/lib.rs:275-276`（新增） |
| 前端 clone 模块 | `shell/src/cloneRepository.ts`（新） |
| 新建项目 tab | `shell/src/newProject.ts`（改） |
| 菜单/命令面板 | `shell/src/main.ts:1543`, `:1784`, `:2485`（改） |
| i18n 域 | `shell/src/i18n/locales/{zh-CN,en-US}/cloneRepository.ts`（新） |
| backendError | `shell/src/i18n/backendError.ts`（改） |
| E2E | `shell/e2e/git/05-clone.spec.ts`（新） |
| mock | `shell/e2e/mocks/tauri-mock.js`（改） |
| helpers | `shell/e2e/helpers.ts`（改） |

### 11.2 竞品对标速查

| 能力 | VS Code | PyCharm | 本期交付 |
|---|---|---|---|
| Clone from URL | ✅ | ✅ | ✅ |
| 平台预设（GitHub/GitLab/Gitee） | ✅（GitHub 认证后） | ✅（内置 VCS 选择器） | ✅（URL 预设 + 识别） |
| 浅克隆 | ✅ `--depth` | ✅ | ✅ `--depth 1` checkbox |
| 主分支预览 | ❌（clone 后才知道） | ✅（fetch 后选分支） | ✅（ls-remote 预览） |
| OAuth + 仓库列表 | ✅ | ✅ | ❌（登记 P3） |
| 完成后打开项目 | ✅ | ✅ | ✅（README / .py 自动） |
