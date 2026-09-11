// Git 功能域（TD-007 迁出 main.ts）：git 状态缓存 / 状态栏 / SCM 变更面板 /
// 暂存与提交 / diff 视图 / 远程操作与 stash / 历史与 blame / 分支面板。
// 域内私有状态留在本模块；文件树装饰经下方三个访问器读取。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { app, $, $btn, outputEl } from "./state";
import { basename, codicon, emptyState, languageOf, gitBadgeClass, gitLineClass, renderFileIcon } from "./util";
import { appendOutputLine, clearOutput } from "./output";
import { refreshTreeWithExpandedState } from "./fileTree";
import { setBottomTab } from "./termUi";
import { gotoFromLink } from "./main";
// CR-25：状态存储下沉到零依赖的 gitStatusState（fileTree 装饰只读，不再 import 本模块）
import { gitStatuses, gitDirtyDirs, gitRepoActive } from "./gitStatusState";

// ---------- 域内状态 ----------

/** Git 变更文件条目（后端 git_status 返回） */
export interface GitStatusFile { path: string; x: string; y: string; code: string }

/** Git 变更文件列表（SCM 面板用） */
let gitFiles: GitStatusFile[] = [];
/** 当前分支名（非 git 仓库或 detached 时为 null） */
let currentBranch: string | null = null;
/** 本地分支列表（SCM 分支条用） */
let gitBranches: { name: string; current: boolean }[] = [];

let diffEditor: MonacoApi.editor.IStandaloneDiffEditor | null = null;
let diffOriginalModel: MonacoApi.editor.ITextModel | null = null;
let diffModifiedModel: MonacoApi.editor.ITextModel | null = null;
/** 当前 diff 视图展示的文件路径（Blame 入口） */
let diffFilePath: string | null = null;

const gitDiffEditorEl = $("git-diff-editor");

// ---------- Git 状态 ----------

/** CR-20：git 状态刷新令牌——响应乱序时旧结果不得覆盖新结果（SCM 面板显示过时暂存态） */
let gitStatusToken = 0;

/** 刷新 git 状态（非 git 仓库时静默跳过）；传入 paths 时按子集增量刷新（TD-002） */
export async function refreshGitStatus(paths?: string[]): Promise<void> {
  if (!app.workspaceRoot) {
    gitStatusToken++; // 作废在途请求
    gitStatuses.clear();
    gitFiles = [];
    gitRepoActive.value = false;
    currentBranch = null;
    gitDirtyDirs.clear();
    updateGitStatusBar();
    return;
  }
  const token = ++gitStatusToken;
  try {
    const scoped = paths && paths.length > 0 ? paths : null;
    const result = await invoke<{ files: GitStatusFile[]; is_git: boolean; current_branch: string | null }>(
      "git_status",
      { root: app.workspaceRoot, paths: scoped },
    );
    if (token !== gitStatusToken) return; // 已有更新一轮的刷新，丢弃旧结果
    gitRepoActive.value = result.is_git;
    currentBranch = result.current_branch ?? null;
    if (scoped && gitRepoActive.value && gitFiles.length > 0) {
      // 增量：移除命中查询路径（目录前缀）的旧记录，再合并最新结果
      const kept = gitFiles.filter(
        (f) => !scoped.some((p) => f.path === p || f.path.startsWith(p + "/")),
      );
      const keptPaths = new Set(kept.map((f) => f.path));
      gitFiles = [...kept];
      for (const f of result.files) {
        if (!keptPaths.has(f.path)) gitFiles.push(f);
      }
      gitFiles.sort((a, b) => a.path.localeCompare(b.path));
      gitStatuses.clear();
      for (const f of gitFiles) gitStatuses.set(f.path, f.code);
    } else {
      gitFiles = result.files;
      gitStatuses.clear();
      for (const f of gitFiles) gitStatuses.set(f.path, f.code);
    }
    rebuildGitDirtyDirs();
  } catch {
    gitStatuses.clear();
    gitFiles = [];
    gitRepoActive.value = false;
    currentBranch = null;
    gitDirtyDirs.clear();
  }
  updateGitStatusBar();
}

/** 更新状态栏当前分支显示 */
export function updateGitStatusBar(): void {
  const el = $("status-git");
  if (!el) return;
  if (gitRepoActive.value && currentBranch) {
    el.replaceChildren(codicon("git-branch"), ` ${currentBranch}`);
  } else {
    el.textContent = "";
  }
}

/** 由变更文件列表重建「有变更的目录」集合（向上冒泡所有父目录） */
function rebuildGitDirtyDirs(): void {
  gitDirtyDirs.clear();
  for (const f of gitFiles) {
    let i = f.path.lastIndexOf("/");
    while (i > 0) {
      gitDirtyDirs.add(f.path.slice(0, i));
      i = f.path.lastIndexOf("/", i - 1);
    }
  }
}

// isGitRepoActive / gitStatusOf / isGitDirtyDir 已下沉到 gitStatusState.ts（CR-25）

// ---------- SCM 面板（Git 变更列表 / 暂存 / 提交 / diff） ----------

/** 判断文件是否已暂存（未跟踪与冲突视作未暂存） */
function gitFileStaged(f: GitStatusFile): boolean {
  if (f.code === "?" || f.code === "!") return false;
  return f.x !== " ";
}

/** 渲染 SCM 变更列表（按「已暂存 / 更改」分组） */
export function renderGitPanel(): void {
  const box = $("git-changes");
  box.textContent = "";
  $("git-commit-btn").toggleAttribute("disabled", true);
  if (!app.workspaceRoot) {
    box.appendChild(emptyState("source-control", "尚未打开工作区", "打开后此处显示 Git 变更"));
    return;
  }
  if (!gitRepoActive.value) {
    box.appendChild(emptyState("source-control", "不是 Git 仓库", "初始化仓库后启用源代码管理"));
    return;
  }
  if (gitFiles.length === 0) {
    box.appendChild(emptyState("check", "无更改", "工作区干净"));
    return;
  }

  const staged = gitFiles.filter((f) => gitFileStaged(f));
  const unstaged = gitFiles.filter((f) => !gitFileStaged(f));

  if (staged.length > 0) {
    box.appendChild(gitSectionTitle(`已暂存（${staged.length}）`));
    for (const f of staged) box.appendChild(renderScmItem(f, true));
  }
  if (unstaged.length > 0) {
    box.appendChild(gitSectionTitle(`更改（${unstaged.length}）`));
    for (const f of unstaged) box.appendChild(renderScmItem(f, false));
  }

  $("git-commit-btn").toggleAttribute("disabled", staged.length === 0);
}

function gitSectionTitle(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "git-section-title";
  el.textContent = text;
  return el;
}



/** 渲染单个变更文件条目 */
function renderScmItem(f: GitStatusFile, staged: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = "scm-item";
  if (f.code === "?") el.classList.add("untracked");
  el.dataset.path = f.path;
  el.dataset.staged = staged ? "1" : "0";

  const action = document.createElement("button");
  action.className = "scm-action";
  if (f.code === "!") {
    action.textContent = "!";
    action.classList.add("conflict");
    action.title = "冲突，需手动解决";
  } else {
    action.textContent = staged ? "−" : "+";
    action.title = staged ? "取消暂存" : "暂存更改";
    if (staged) action.classList.add("staged");
  }

  const badge = document.createElement("span");
  badge.className = gitBadgeClass(f.code);
  badge.textContent = f.code;

  const name = document.createElement("span");
  name.className = "scm-name";
  name.textContent = f.path;
  name.title = f.path;

  el.append(action, badge, renderFileIcon(basename(f.path)), name);
  return el;
}

/** 暂存指定文件并刷新 */
async function stageFiles(paths: string[]): Promise<void> {
  if (!app.workspaceRoot || paths.length === 0) return;
  try {
    await invoke("git_stage", { root: app.workspaceRoot, paths });
  } catch (e) {
    appendOutputLine(outputEl, `暂存失败：${e}`, "stderr", gotoFromLink);
    return;
  }
  await refreshTreeWithExpandedState();
  renderGitPanel();
}

/** 取消暂存指定文件并刷新 */
async function unstageFiles(paths: string[]): Promise<void> {
  if (!app.workspaceRoot || paths.length === 0) return;
  try {
    await invoke("git_unstage", { root: app.workspaceRoot, paths });
  } catch (e) {
    appendOutputLine(outputEl, `取消暂存失败：${e}`, "stderr", gotoFromLink);
    return;
  }
  await refreshTreeWithExpandedState();
  renderGitPanel();
}

/** 提交已暂存更改 */
async function commitChanges(): Promise<void> {
  if (!app.workspaceRoot || !gitRepoActive.value) return;
  const msgEl = $("git-commit-msg") as HTMLTextAreaElement;
  const message = msgEl.value.trim();
  if (!message) {
    appendOutputLine(outputEl, "提交信息不能为空", "stderr", gotoFromLink);
    return;
  }
  appendOutputLine(outputEl, `> git commit -m "${message}"`, "cmd", gotoFromLink);
  try {
    const out = await invoke<string>("git_commit", { root: app.workspaceRoot, message });
    for (const line of out.split("\n")) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `提交失败：${e}`, "stderr", gotoFromLink);
    return;
  }
  msgEl.value = "";
  await refreshTreeWithExpandedState();
  renderGitPanel();
}

/** 懒创建 diff 编辑器（首次查看差异时） */
export function ensureDiffEditor(): MonacoApi.editor.IStandaloneDiffEditor {
  if (diffEditor) return diffEditor;
  diffEditor = app.monaco.editor.createDiffEditor(gitDiffEditorEl, {
    automaticLayout: true,
    theme: app.settings.theme,
    readOnly: true,
    renderSideBySide: true,
    fontSize: app.settings.font_size,
  });
  return diffEditor;
}

/** 释放上一次 diff 模型，避免内存泄漏 */
function releaseDiffModels(): void {
  diffOriginalModel?.dispose();
  diffModifiedModel?.dispose();
  diffOriginalModel = null;
  diffModifiedModel = null;
}

/** 查看单文件 diff（Monaco 左右对照，TD-002 行内 diff） */
async function showDiff(f: GitStatusFile): Promise<void> {
  if (!app.workspaceRoot) return;
  diffFilePath = f.path;
  const staged = gitFileStaged(f);
  setBottomTab("diff");
  ($("git-diff-label") as HTMLElement).textContent =
    `${f.path}  ·  ${staged ? "HEAD vs 暂存区" : "暂存区 vs 工作区"}`;
  try {
    const v = await invoke<{ old: string; new: string; old_label: string; new_label: string }>(
      "git_diff_versions",
      { root: app.workspaceRoot, path: f.path, staged },
    );
    const d = ensureDiffEditor();
    releaseDiffModels();
    const lang = languageOf(f.path);
    diffOriginalModel = app.monaco.editor.createModel(v.old, lang);
    diffModifiedModel = app.monaco.editor.createModel(v.new, lang);
    d.setModel({ original: diffOriginalModel, modified: diffModifiedModel });
    d.getOriginalEditor().updateOptions({ ariaLabel: v.old_label });
    d.getModifiedEditor().updateOptions({ ariaLabel: v.new_label });
  } catch (e) {
    appendOutputLine(outputEl, `读取 diff 失败：${e}`, "stderr", gotoFromLink);
    setBottomTab("output");
  }
}

/** 关闭差异视图，切回输出面板 */
function closeDiffPanel(): void {
  setBottomTab("output");
}

/** 执行远程操作（push/pull/fetch），输出写入输出面板后刷新状态 */
async function gitRemoteOp(op: "push" | "pull" | "fetch"): Promise<void> {
  if (!app.workspaceRoot || !gitRepoActive.value) return;
  const label = `git ${op}`;
  appendOutputLine(outputEl, `> ${label}`, "cmd", gotoFromLink);
  try {
    const out = await invoke<string>(`git_${op}`, { root: app.workspaceRoot });
    for (const line of out.split("\n")) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `${label} 失败：${e}`, "stderr", gotoFromLink);
  }
  await refreshGitStatus();
  await refreshBranchPanel();
  renderGitPanel();
}

/** 暂存当前更改（git stash push）后刷新 */
async function gitStash(): Promise<void> {
  if (!app.workspaceRoot || !gitRepoActive.value) return;
  appendOutputLine(outputEl, "> git stash push", "cmd", gotoFromLink);
  try {
    const out = await invoke<string>("git_stash_push", { root: app.workspaceRoot, message: "" });
    for (const line of out.split("\n")) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `stash 失败：${e}`, "stderr", gotoFromLink);
  }
  await refreshGitStatus();
  renderGitPanel();
}

/** 弹出最近一次 stash（git stash pop）后刷新 */
async function gitStashPop(): Promise<void> {
  if (!app.workspaceRoot || !gitRepoActive.value) return;
  appendOutputLine(outputEl, "> git stash pop", "cmd", gotoFromLink);
  try {
    const out = await invoke<string>("git_stash_pop", { root: app.workspaceRoot });
    for (const line of out.split("\n")) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `stash pop 失败：${e}`, "stderr", gotoFromLink);
  }
  await refreshGitStatus();
  renderGitPanel();
}

/** 查看指定提交详情（git show） */
async function showCommitDetail(hash: string): Promise<void> {
  if (!app.workspaceRoot) return;
  setBottomTab("output");
  clearOutput(outputEl);
  appendOutputLine(outputEl, `> git show ${hash}`, "cmd", gotoFromLink);
  try {
    const out = await invoke<string>("git_show", { root: app.workspaceRoot, hash });
    for (const line of out.split("\n")) appendOutputLine(outputEl, line, gitLineClass(line), gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `读取提交详情失败：${e}`, "stderr", gotoFromLink);
  }
}

/** 逐行 blame，结果以表格形式写入输出面板 */
async function showBlame(path: string): Promise<void> {
  if (!app.workspaceRoot) return;
  setBottomTab("output");
  clearOutput(outputEl);
  appendOutputLine(outputEl, `> git blame --line-porcelain -- ${path}`, "cmd", gotoFromLink);
  try {
    const rows = await invoke<{ line: number; short_hash: string; author: string; time: number; summary: string }[]>(
      "git_blame",
      { root: app.workspaceRoot, path },
    );
    for (const r of rows) {
      const when = r.time ? new Date(r.time * 1000).toISOString().slice(0, 10) : "";
      appendOutputLine(
        outputEl,
        `${String(r.line).padStart(5, " ")}  ${r.short_hash}  ${r.author.padEnd(12, " ")}  ${when}  ${r.summary}`,
        "stdout",
        gotoFromLink,
      );
    }
  } catch (e) {
    appendOutputLine(outputEl, `读取 blame 失败：${e}`, "stderr", gotoFromLink);
  }
}

interface GitCommitInfo { hash: string; short_hash: string; author: string; date: string; subject: string }

/** 历史面板开关：显示提交历史 / 返回更改列表 */
function toggleHistory(): void {
  const historyEl = $("git-history");
  const willShow = historyEl.classList.contains("hidden");
  historyEl.classList.toggle("hidden", !willShow);
  $("git-changes").classList.toggle("hidden", willShow);
  $("git-commit-box").classList.toggle("hidden", willShow);
  if (willShow) void renderHistory();
}

/** 渲染最近提交列表 */
async function renderHistory(): Promise<void> {
  const box = $("git-history");
  box.textContent = "";
  const back = document.createElement("button");
  back.className = "git-history-back";
  back.textContent = "← 返回更改列表";
  back.addEventListener("click", () => toggleHistory());
  box.appendChild(back);
  if (!app.workspaceRoot || !gitRepoActive.value) {
    box.appendChild(emptyState("source-control", "不是 Git 仓库"));
    return;
  }
  try {
    const commits = await invoke<GitCommitInfo[]>("git_log", { root: app.workspaceRoot, count: 50 });
    if (commits.length === 0) {
      box.appendChild(emptyState("git-commit", "无提交历史"));
      return;
    }
    for (const c of commits) box.appendChild(renderCommitItem(c));
  } catch (e) {
    box.appendChild(emptyState("error", "读取历史失败", String(e)));
  }
}

function renderCommitItem(c: GitCommitInfo): HTMLElement {
  const el = document.createElement("div");
  el.className = "git-commit-item";
  el.dataset.hash = c.hash;
  el.title = `${c.hash}\n${c.author} · ${c.date}`;
  const hash = document.createElement("span");
  hash.className = "hash";
  hash.textContent = c.short_hash;
  const date = document.createElement("span");
  date.className = "date";
  date.textContent = c.date;
  const subject = document.createElement("span");
  subject.className = "subject";
  subject.textContent = c.subject;
  const author = document.createElement("span");
  author.className = "author";
  author.textContent = c.author;
  el.append(hash, date, subject, author);
  return el;
}

// ---------- SCM 分支面板（P2：当前分支 / 切换 / 新建） ----------

/** 刷新 SCM 分支条（当前分支 + 分支列表） */
export async function refreshBranchPanel(): Promise<void> {
  if (!app.workspaceRoot || !gitRepoActive.value) {
    gitBranches = [];
    $("git-branch-current").textContent = "—";
    closeBranchList();
    return;
  }
  try {
    gitBranches = await invoke<{ name: string; current: boolean }[]>("git_branches", { root: app.workspaceRoot });
  } catch {
    gitBranches = [];
  }
  const cur = gitBranches.find((b) => b.current);
  $("git-branch-current").replaceChildren(codicon("git-branch"), ` ${cur ? cur.name : (currentBranch ?? "—")}`);
  if (!$("git-branch-list").classList.contains("hidden")) renderBranchList();
}

function closeBranchList(): void {
  $("git-branch-list").classList.add("hidden");
}

function toggleBranchList(): void {
  const list = $("git-branch-list");
  const willShow = list.classList.contains("hidden");
  list.classList.toggle("hidden", !willShow);
  if (willShow) renderBranchList();
}

function renderBranchList(): void {
  const box = $("git-branch-list");
  box.textContent = "";
  if (gitBranches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "git-empty";
    empty.textContent = "无分支";
    box.appendChild(empty);
  }
  for (const b of gitBranches) {
    const item = document.createElement("div");
    item.className = "git-branch-item" + (b.current ? " current" : "");
    item.dataset.branch = b.name;
    const name = document.createElement("span");
    name.className = "scm-name";
    name.textContent = b.name;
    item.appendChild(name);
    if (b.current) {
      const mark = codicon("check");
      mark.title = "当前分支";
      item.appendChild(mark);
    }
    box.appendChild(item);
  }
  const newBox = document.createElement("div");
  newBox.className = "git-branch-new";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "新分支名…";
  input.spellcheck = false;
  const btn = document.createElement("button");
  btn.textContent = "新建";
  newBox.append(input, btn);
  box.appendChild(newBox);
}

/** 切换分支 */
async function checkoutBranch(name: string): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("git_checkout", { root: app.workspaceRoot, branch: name });
  } catch (e) {
    appendOutputLine(outputEl, `切换分支失败：${e}`, "stderr", gotoFromLink);
    return;
  }
  closeBranchList();
  await refreshAfterBranchChange();
}

/** 新建并切换分支 */
async function createBranchAndSwitch(name: string): Promise<void> {
  if (!app.workspaceRoot) return;
  const n = name.trim();
  if (!n) return;
  try {
    await invoke("git_create_branch", { root: app.workspaceRoot, name: n });
  } catch (e) {
    appendOutputLine(outputEl, `新建分支失败：${e}`, "stderr", gotoFromLink);
    return;
  }
  closeBranchList();
  await refreshAfterBranchChange();
}

/** 分支变化后统一刷新（git 状态 + 分支 + 文件树） */
async function refreshAfterBranchChange(): Promise<void> {
  await refreshGitStatus();
  await refreshBranchPanel();
  await refreshTreeWithExpandedState();
  renderGitPanel();
}

// ---------- 事件接线 / 复位 ----------

/** 接线 Git 全部 UI 交互（SCM 工具栏 / 历史 / diff / 提交 / 变更列表 / 分支条） */
export function wireGitUI(): void {
  // SCM 工具栏：远程操作 / stash / 历史（TD-002）
  $btn("git-btn-fetch").addEventListener("click", () => void gitRemoteOp("fetch"));
  $btn("git-btn-pull").addEventListener("click", () => void gitRemoteOp("pull"));
  $btn("git-btn-push").addEventListener("click", () => void gitRemoteOp("push"));
  $btn("git-btn-stash").addEventListener("click", () => void gitStash());
  $btn("git-btn-unstash").addEventListener("click", () => void gitStashPop());
  $btn("git-btn-history").addEventListener("click", () => toggleHistory());
  $("git-history").addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".git-commit-item") as HTMLElement | null;
    if (item?.dataset.hash) void showCommitDetail(item.dataset.hash);
  });
  // 差异视图操作（关闭 / 逐行 Blame）
  $btn("git-diff-close").addEventListener("click", () => closeDiffPanel());
  $btn("git-diff-blame").addEventListener("click", () => {
    if (diffFilePath) void showBlame(diffFilePath);
  });
  // SCM：提交按钮 + 提交信息输入 + 变更列表点击委托
  $btn("git-commit-btn").addEventListener("click", () => void commitChanges());
  $("git-commit-msg").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void commitChanges();
    }
  });
  $("git-changes").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest(".scm-item") as HTMLElement | null;
    if (!item || !app.workspaceRoot) return;
    const path = item.dataset.path;
    if (!path) return;
    if (target.classList.contains("scm-action")) {
      // 暂存 / 取消暂存按钮（冲突项不可直接操作）
      if (target.classList.contains("conflict")) return;
      if (item.dataset.staged === "1") void unstageFiles([path]);
      else void stageFiles([path]);
    } else {
      // 点击条目查看 diff
      const f = gitFiles.find((x) => x.path === path);
      if (f) void showDiff(f);
    }
  });
  // SCM 分支条：展开列表 / 切换分支 / 新建分支
  $btn("git-branch-btn").addEventListener("click", () => toggleBranchList());
  $("git-branch-list").addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest(".git-branch-item") as HTMLElement | null;
    if (item && item.dataset.branch) {
      void checkoutBranch(item.dataset.branch);
      return;
    }
    if (target.closest(".git-branch-new button")) {
      const input = $("git-branch-list").querySelector(".git-branch-new input") as HTMLInputElement | null;
      if (input) void createBranchAndSwitch(input.value);
    }
  });
  $("git-branch-list").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target as HTMLElement).matches(".git-branch-new input")) {
      void createBranchAndSwitch((e.target as HTMLInputElement).value);
    }
  });
}

/** 关闭工作区时复位 Git 状态（由 main.ts closeWorkspace 调用） */
export function resetGitState(): void {
  gitStatuses.clear();
  gitFiles = [];
  gitRepoActive.value = false;
  currentBranch = null;
  gitDirtyDirs.clear();
  gitBranches = [];
  diffFilePath = null;
  releaseDiffModels();
  ($("git-diff-label") as HTMLElement).textContent = "—";
  updateGitStatusBar();
}
