// 入口与胶水层（TD-007 功能域拆分后）：工作区生命周期 / 标签页与编辑器 / 运行 /
// LSP 接线 / Python 环境面板 / 搜索与大纲 / 最近文件 / 菜单栏 / 新建项目 / 文件监听 / init。
// 文件树 → fileTree.ts；Git → git.ts；终端与底部面板 → termUi.ts；设置面板 → settingsPanel.ts；
// 跨域共享状态 → state.ts（app 上下文对象）。

// D2：统一单色图标体系（@vscode/codicons，MIT）。先于 style.css 引入，
// 使本项目的分场景图标尺寸规则在同特异性下覆盖 codicon 基础 16px。
import "@vscode/codicons/dist/codicon.css";
import "./style.css";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
// @tauri-apps/api/window 的 ResizeDirection 未导出（上游类型导出缺失），本地声明同步。
type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
import { initLiveTemplates, type LiveTemplatesHandle } from "./live-templates";
import * as ltUi from "./live-templates/ui/manager";
import { initDevTools, openDevTools, listDevTools } from "./devtools";
import { formatPythonSource, registerRuffFormatter, setFormatErrorHandler } from "./format";
import { runSearch, cancelSearch, resetSearch, setOpenMatchHandler, type SearchMatch } from "./search";
import { registerSidebarView, setSidebarTab, activeView } from "./views";
import * as lsp from "./lsp/client";
import * as kb from "./keybindings";
import * as toolchain from "./toolchain";
import { appendOutputLine, clearOutput, type OutputLink } from "./output";
import { openConfirm } from "./dialog";
import { app, $, $btn, outputEl, statusFileEl, type Entry, type Tab } from "./state";
import {
  createDirAt, createFileAt, isDirExpanded, isTreeEmpty, refreshTree, reloadDir,
  renderCtxMenu, resetTreeState, wireFileTree, type CtxItem,
} from "./fileTree";
import { refreshGitStatus, renderGitPanel, refreshBranchPanel, resetGitState, wireGitUI } from "./git";
import { disposeTerminal, openTerminalAt, wireBottomPanel, wireTerminalEvents } from "./termUi";
import { loadSettings, saveSettings, applyFontStatus, openSettingsPanel, wireSettingsPanel, buildEditorOptions } from "./settingsPanel";
import { basename, codicon, emptyState, joinPath, languageOf, parentDirOf, renderFileIcon, SNAKE_SVG, symbolIcon } from "./util";
import { restoreLayout, wireSplitters } from "./layout";
import { hideEl, restoreReduceMotion, showEl } from "./anim";
import { wireTooltip } from "./tooltip";

// ---------- 模块级状态（本层私有） ----------

let liveTemplatesHandle: LiveTemplatesHandle | null = null;
/** 当前工作区解释器（null = uv run 兜底） */
let currentInterpreter: string | null = null;
/** 本轮会话是否已提示过 .venv 自动检测 */
const venvPrompted = new Set<string>();
let searchCaseSensitive = false;
let running = false;
/** 当前正在运行的文件路径（用于 tab 上显示停止图标） */
let runningPath: string | null = null;
/** 选区运行的元信息：临时文件路径 → 源文件 + 起始行（traceback 跳转映射用） */
let selectionRunMeta: { tempPath: string; sourcePath: string; startLine: number } | null = null;
/** 文件监听防抖定时器 */
let fsWatchTimer: number | undefined;

// ---------- DOM ----------

const tabbarEl = $("tabbar");
const outlineEl = $("outline");
const statusLspEl = $("status-lsp");
const statusInterpreterEl = $("status-interpreter");
const envModalEl = $("env-modal");
const envListEl = $("env-list");
const envPackagesEl = $("env-packages");
const envVersionSelectEl = $("env-version-select") as HTMLSelectElement;
const envPkgInputEl = $("env-pkg-input") as HTMLInputElement;
const envPkgCountEl = $("env-pkg-count");
const envPkgUpgradeAllBtn = $btn("env-pkg-upgrade-all");
const envPkgUninstallSelectedBtn = $btn("env-pkg-uninstall-selected");
const newProjectModalEl = $("new-project-modal");
const newProjectNameEl = $("new-project-name") as HTMLInputElement;
const newProjectLocationEl = $("new-project-location") as HTMLInputElement;
const newProjectGitEl = $("new-project-git") as HTMLInputElement;
const newProjectEnvTypeEl = $("new-project-env-type") as HTMLSelectElement;
const newProjectVersionEl = $("new-project-version") as HTMLSelectElement;
const newProjectEnvLocationEl = $("new-project-env-location") as HTMLSelectElement;
const newProjectVersionRowEl = $("new-project-version-row");
const newProjectLocationRowEl = $("new-project-location-row");
const newProjectPreviewEl = $("new-project-preview");

// ---------- 工作区 ----------

/** 复位环境包面板状态（清空包列表状态 + 面板块 DOM；不主动触发 renderPackages，避免切换瞬间联网查询） */
function resetEnvPackages(): void {
  currentPackages = [];
  outdatedPackages.clear();
  selectedPkgs.clear();
  envPackagesEl.textContent = "";
  updatePkgToolbar();
}

/** 切换/关闭工作区时的共享 UI 复位：清理旧工作区残留的可视内容与内存状态 */
function resetWorkspaceUiState(): void {
  clearOutput(outputEl);        // 输出面板（运行输出 / traceback）
  resetGitState();              // git 状态 + diff 视图 + 分支列表
  outlineEl.textContent = "";   // 大纲符号树
  resetSearch();                // 搜索结果 + 作废在途请求
  resetEnvPackages();           // 环境包面板状态
  currentInterpreter = null;    // 防切换瞬间误用旧解释器
  venvPrompted.clear();
  ($("search-input") as HTMLInputElement).value = ""; // 清空搜索关键词
}

/** 清理当前工作区（关闭标签 + 停 LSP + 销毁终端）；有未保存修改时先确认，取消则返回 false */
async function teardownCurrent(): Promise<boolean> {
  if (app.workspaceRoot) {
    if (app.tabs.some((t) => t.dirty) && !(await openConfirm({ message: "存在未保存的修改，继续将丢失，确认关闭工作区？", kind: "danger" }))) {
      return false;
    }
    let t0 = performance.now();
    console.log("[teardown] closeTabs begin, tabs=", app.tabs.length);
    for (const t of [...app.tabs]) closeTabSilent(t);
    console.log("[teardown] closeTabs done, took=", (performance.now() - t0).toFixed(0), "ms");

    t0 = performance.now();
    console.log("[teardown] lsp.stopEngine begin");
    await lsp.stopEngine();
    console.log("[teardown] lsp.stopEngine done, took=", (performance.now() - t0).toFixed(0), "ms");

    t0 = performance.now();
    console.log("[teardown] disposeTerminal begin");
    await disposeTerminal();
    console.log("[teardown] disposeTerminal done, took=", (performance.now() - t0).toFixed(0), "ms");
  }
  return true;
}

async function openWorkspace(root: string): Promise<void> {
  // 切换工作区：先清理旧工作区状态
  if (app.workspaceRoot && app.workspaceRoot !== root) {
    if (!(await teardownCurrent())) return;
    await stopFileWatcher();
    resetWorkspaceUiState();
  }
  app.workspaceRoot = root;
  $("tree-header-text").textContent = root;
  await invoke("add_recent_workspace", { path: root }).catch(console.error);
  await refreshTree();
  await loadTemplatesConfig();
  await refreshInterpreterStatus(); // 先确定解释器，供 startLsp/run 使用
  await startLsp();
  await maybePromptVenv();
  await startFileWatcher(); // 启动文件监听
  updateEditorOverlay();
}

/** 关闭当前工作区，回到无工作区状态 */
async function closeWorkspace(): Promise<void> {
  if (!app.workspaceRoot) return;
  if (!(await teardownCurrent())) return;
  let t0 = performance.now();
  console.log("[closeWorkspace] stopFileWatcher begin");
  await stopFileWatcher();
  console.log("[closeWorkspace] stopFileWatcher done, took=", (performance.now() - t0).toFixed(0), "ms");
  resetWorkspaceUiState();
  app.workspaceRoot = null;
  resetTreeState();
  $("tree-header-text").textContent = "FILES";
  statusFileEl.textContent = "";
  statusInterpreterEl.textContent = "";
  updateEditorOverlay();
}

/** 根据当前状态刷新编辑区覆盖层：
 *  - 已打开文件 → 隐藏
 *  - 无工作区 → 完整 Get Started（含快捷入口与最近工作区）
 *  - 有工作区但未打开文件 → 仅保留品牌与快捷键，隐藏快捷入口与最近工作区 */
function updateEditorOverlay(): void {
  const overlayEl = $("editor-overlay");
  const actionsEl = $("ew-actions");
  const recentEl = $("ew-recent-section");

  if (app.activeTab) {
    overlayEl.classList.add("hidden");
    return;
  }

  overlayEl.classList.remove("hidden");

  if (app.workspaceRoot) {
    actionsEl.classList.add("hidden");
    recentEl.classList.add("hidden");
    return;
  }

  actionsEl.classList.remove("hidden");
  void renderEditorWelcomeRecents();
}

/** 渲染编辑器区 Welcome 页「最近的工作区」列表 */
async function renderEditorWelcomeRecents(): Promise<void> {
  const section = $("ew-recent-section");
  const listEl = $("ew-recent-list");
  listEl.textContent = "";
  const recents = await getRecentWorkspaces();
  if (recents.length === 0) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  for (const p of recents) {
    const item = document.createElement("div");
    item.className = "ew-recent-item";
    const folder = document.createElement("span");
    folder.className = "folder";
    folder.appendChild(codicon("folder"));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = basename(p);
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = p;
    item.append(folder, name, path);
    item.title = p;
    item.addEventListener("click", () => openWorkspace(p).catch(console.error));
    // 单条删除（× 按钮，hover 时显示）
    const remove = document.createElement("button");
    remove.className = "ew-recent-remove";
    remove.title = "从列表移除";
    remove.appendChild(codicon("close"));
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      void removeRecentWorkspace(p);
    });
    item.appendChild(remove);
    listEl.appendChild(item);
  }
}

/** 读取最近工作区列表（去重后按时间倒序） */
async function getRecentWorkspaces(): Promise<string[]> {
  try {
    return await invoke<string[]>("get_recent_workspaces");
  } catch (e) {
    console.warn("读取最近工作区失败", e);
    return [];
  }
}

/** 清空最近工作区列表并刷新 Welcome 页 */
async function clearRecentWorkspaces(): Promise<void> {
  try {
    await invoke("clear_recent_workspaces");
  } catch (e) {
    console.warn("清空最近工作区失败", e);
  }
  void renderEditorWelcomeRecents();
}

/** 删除单条最近工作区并刷新 Welcome 页 */
async function removeRecentWorkspace(path: string): Promise<void> {
  try {
    await invoke("remove_recent_workspace", { path });
  } catch (e) {
    console.warn("删除最近工作区失败", e);
  }
  void renderEditorWelcomeRecents();
}

/** 启动时的自动恢复：有记录打开最近，无记录则保持 Welcome 页，不弹目录框 */
async function autoOpenRecentWorkspace(): Promise<void> {
  const recents = await getRecentWorkspaces();
  if (recents.length > 0) {
    await openWorkspace(recents[0]);
  }
}

/** 工具栏「📂 打开」：弹文件夹选择框并切换工作区 */
async function openFolderFromToolbar(): Promise<void> {
  const path = await invoke<string | null>("pick_folder");
  if (!path) return;
  await openWorkspace(path);
}

// ---------- 新建项目 ----------

interface CreateProjectResult {
  path: string;
  git_ok: boolean;
  git_message: string;
}

/** 拼接父目录 + 项目名（沿用 joinPath 的分隔符规则） */
function projectTargetPath(): string {
  const parent = newProjectLocationEl.value.trim().replace(/[\\/]+$/, "");
  const name = newProjectNameEl.value.trim();
  if (!parent || !name) return "";
  return joinPath(parent, name);
}

/** 更新「将创建于」预览行 */
function updateNewProjectPreview(): void {
  const target = projectTargetPath();
  newProjectPreviewEl.textContent = target ? `将创建于：${target}` : "";
}

/** 打开新建项目面板（位置默认取最近工作区的父目录，便于就近创建） */
async function openNewProjectPanel(): Promise<void> {
  newProjectNameEl.value = "";
  newProjectEnvTypeEl.value = "venv";
  newProjectEnvLocationEl.value = "project";
  if (!newProjectLocationEl.value.trim()) {
    let recents: string[] = [];
    try {
      recents = await invoke<string[]>("get_recent_workspaces");
    } catch { /* 忽略 */ }
    const parent = recents.length > 0 ? parentDirOf(recents[0]) : "";
    newProjectLocationEl.value = parent;
  }
  updateNewProjectPreview();
  updateNewProjectEnvFields();
  void populateNewProjectVersions();
  showEl(newProjectModalEl);
  newProjectNameEl.focus();
}

function closeNewProjectPanel(): void {
  hideEl(newProjectModalEl);
}

/** 根据环境类型显隐版本/位置行（仅 venv 需要） */
function updateNewProjectEnvFields(): void {
  const isVenv = newProjectEnvTypeEl.value === "venv";
  newProjectVersionRowEl.classList.toggle("hidden", !isVenv);
  newProjectLocationRowEl.classList.toggle("hidden", !isVenv);
}

/** 填充 Python 版本下拉（venv 用，含可下载版本标记）。加载期间显示占位。 */
async function populateNewProjectVersions(): Promise<void> {
  newProjectVersionEl.textContent = "";
  const loading = document.createElement("option");
  loading.value = "";
  loading.textContent = "加载版本列表中…";
  newProjectVersionEl.appendChild(loading);
  let versions: PythonVersionOption[] = [];
  try {
    versions = await invoke<PythonVersionOption[]>("list_python_versions");
  } catch (e) {
    console.error("list_python_versions 失败", e);
  }
  newProjectVersionEl.textContent = "";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "（默认版本）";
  newProjectVersionEl.appendChild(defOpt);
  for (const v of versions) {
    const opt = document.createElement("option");
    opt.value = v.spec;
    opt.textContent = v.installed ? v.version : `${v.version}（需下载）`;
    newProjectVersionEl.appendChild(opt);
  }
}

/**
 * 创建项目：磁盘建目录 + main.py + 可选 git；按所选环境类型配置解释器。
 * - venv：按版本/位置创建虚拟环境并选中
 * - system：自动选用已安装解释器
 * - none：不设置（uv run 兜底）
 * 整个流程保持面板可见，按钮以忙碌态指示进度（耗时动作 loading）。
 */
async function createProject(): Promise<void> {
  const name = newProjectNameEl.value.trim();
  const parent = newProjectLocationEl.value.trim();
  if (!name || !parent) {
    newProjectPreviewEl.textContent = "请填写项目名称和位置";
    return;
  }
  const wantGit = newProjectGitEl.checked;
  const envType = newProjectEnvTypeEl.value; // venv | system | none
  const version = newProjectVersionEl.value; // venv 时为版本 spec，其余为空
  const location = newProjectEnvLocationEl.value; // project | global（仅 venv）
  const createBtn = $btn("new-project-create");
  setBusy(createBtn, true, "创建中…");

  let result: CreateProjectResult;
  try {
    result = await invoke<CreateProjectResult>("create_project", { parentDir: parent, name, gitInit: wantGit });
  } catch (e) {
    newProjectPreviewEl.textContent = `创建失败：${e}`;
    setBusy(createBtn, false);
    return;
  }
  if (!result.git_ok) {
    appendOutputLine(outputEl, `git init 失败（项目已创建）：${result.git_message}`, "stderr", gotoFromLink);
  }
  await openWorkspace(result.path);
  await openFile(joinPath(result.path, "main.py"));

  try {
    if (envType === "venv") {
      const targetLabel = location === "global" ? "~/.opencharm/envs" : ".venv";
      appendOutputLine(outputEl, `> uv venv ${targetLabel}${version ? " --python " + version : ""}  (${result.path})`, "cmd", gotoFromLink);
      setBusy(createBtn, true, "创建环境…");
      const r = await invoke<CreateVenvResult>("create_venv", { workspaceRoot: result.path, version, location });
      if (r.output) appendOutputLine(outputEl, r.output, "stdout", gotoFromLink);
      if (r.python) await invoke("set_interpreter", { workspaceRoot: result.path, path: r.python }).catch(console.error);
    } else if (envType === "system") {
      const interp = await invoke<string | null>("pick_default_system_interpreter");
      if (interp) {
        await invoke("set_interpreter", { workspaceRoot: result.path, path: interp }).catch(console.error);
        appendOutputLine(outputEl, `已选用系统解释器：${interp}`, "stdout", gotoFromLink);
      } else {
        appendOutputLine(outputEl, "未检测到已安装的解释器，将使用 uv run 兜底", "stderr", gotoFromLink);
      }
    }
  } catch (e) {
    appendOutputLine(outputEl, `环境配置失败：${e}`, "stderr", gotoFromLink);
  }

  closeNewProjectPanel();
  setBusy(createBtn, false);
  await refreshInterpreterStatus();
}

async function loadTemplatesConfig(): Promise<void> {
  // live templates M1 重构：重读用户/工作区配置并重建 registry（docs/live_templates重构方案1.md）
  await liveTemplatesHandle?.reload();
}

/** 在当前激活编辑器插入 header 文件头模板（新建 .py/.pyw 后调用）；模板缺失/禁用返回 false */
export async function insertHeaderTemplate(): Promise<boolean> {
  return liveTemplatesHandle ? liveTemplatesHandle.insertByAbbreviation("header") : false;
}

// ---------- 标签右键菜单 ----------

/** 标签右键菜单（P25-T08） */
function showTabContextMenu(tab: Tab, x: number, y: number): void {
  activateTab(tab);
  const items: CtxItem[] = [
    { label: "关闭", action: () => void closeTab(tab) },
    { label: "关闭其他", action: () => void closeOthersExcept(tab) },
    { label: "关闭右侧", action: () => void closeTabsRightOf(tab) },
    { label: "关闭全部", action: () => void closeAllTabs() },
    { sep: true },
    { label: "复制路径", action: () => invoke("copy_to_clipboard", { text: tab.path }).catch(console.error) },
    { label: "在终端中打开", action: () => void openTerminalAt(parentDirOf(tab.path)) },
    { label: "在资源管理器中显示", action: () => invoke("reveal_in_explorer", { path: tab.path }).catch(console.error) },
  ];
  renderCtxMenu(items, x, y);
}

async function closeTabsQuiet(list: Tab[]): Promise<void> {
  if (list.length === 0) return;
  if (list.some((t) => t.dirty) && !(await openConfirm({ message: "存在未保存的修改，确认关闭？", kind: "danger" }))) return;
  for (const t of [...list]) closeTabSilent(t);
}

async function closeOthersExcept(tab: Tab): Promise<void> {
  await closeTabsQuiet(app.tabs.filter((t) => t !== tab));
}

async function closeTabsRightOf(tab: Tab): Promise<void> {
  const idx = app.tabs.indexOf(tab);
  await closeTabsQuiet(app.tabs.slice(idx + 1));
}

async function closeAllTabs(): Promise<void> {
  await closeTabsQuiet([...app.tabs]);
}

// ---------- 文件监听 ----------

/** 启动文件监听（打开工作区时调用） */
async function startFileWatcher(): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("watch_start", { root: app.workspaceRoot });
  } catch (e) {
    console.warn("文件监听启动失败", e);
  }
}

/** 停止文件监听（关闭工作区时调用） */
async function stopFileWatcher(): Promise<void> {
  try {
    await invoke("watch_stop");
  } catch { /* 忽略 */ }
}

/** 处理文件变更事件（防抖后增量刷新受影响目录） */
function handleFsChanged(dirs: string[]): void {
  window.clearTimeout(fsWatchTimer);
  fsWatchTimer = window.setTimeout(async () => {
    // 增量刷新 git 状态：仅重查受影响的目录，避免大仓库全量扫描（TD-002）
    const root = app.workspaceRoot;
    const relPaths = root
      ? dirs
          .filter((d) => d.startsWith(root))
          .map((d) => d.slice(root.length).replace(/^[\\/]/, "").replace(/\\/g, "/"))
          .filter((p) => p.length > 0)
      : [];
    await refreshGitStatus(relPaths);
    // 增量刷新受影响的已展开目录
    for (const dir of dirs) {
      if (isDirExpanded(dir)) {
        await reloadDir(dir);
      }
    }
    // 如果变更涉及工作区根目录且树为空（首次），整树刷新
    if (root && dirs.includes(root) && isTreeEmpty()) {
      await refreshTree();
    }
    // Live Templates 热重载：用户层（~/.opencharm，watcher 附加监听）或工作区层配置变更（M2）
    if (dirs.some((d) => d.toLowerCase().endsWith(".opencharm"))) await loadTemplatesConfig();
  }, 200);
}

// ---------- Python 环境管理（P25-T05） ----------

interface PythonInfo { path: string; version: string; kind: string; is_selected: boolean }
interface PackageInfo { name: string; version: string }
interface PythonVersionOption { version: string; spec: string; path: string | null; installed: boolean }
interface OutdatedInfo { name: string; version: string; latest: string; filetype: string }
interface CreateVenvResult { output: string; python: string }

/** 环境面板包列表状态 */
let currentPackages: PackageInfo[] = [];
let outdatedPackages: Map<string, OutdatedInfo> = new Map();
let selectedPkgs: Set<string> = new Set();

/** 转圈图标：codicon 的 loading 图标默认静止，需叠加 codicon-modifier-spin 才转动 */
function spinIcon(): HTMLElement {
  const el = codicon("loading");
  el.classList.add("codicon-modifier-spin");
  return el;
}

/** 按钮忙碌态：内联转圈 + 禁用，用于耗时动作（装包/卸载/升级/建环境/建项目） */
function setBusy(btn: HTMLButtonElement, busy: boolean, busyText = "处理中…"): void {
  if (busy) {
    if (btn.dataset.label === undefined) btn.dataset.label = btn.textContent ?? "";
    btn.textContent = "";
    btn.appendChild(spinIcon());
    btn.append(` ${busyText}`);
    btn.disabled = true;
    btn.classList.add("busy");
  } else {
    const label = btn.dataset.label;
    if (label !== undefined) {
      btn.textContent = label;
      delete btn.dataset.label;
    }
    btn.disabled = false;
    btn.classList.remove("busy");
  }
}

function shortInterpreter(p: string): string {
  if (app.workspaceRoot && p.startsWith(app.workspaceRoot)) {
    const rel = p.slice(app.workspaceRoot.length).replace(/^[\\/]/, "");
    if (rel.startsWith(".venv")) return ".venv";
  }
  return basename(p);
}

function pythonLabel(p: PythonInfo): string {
  const ver = p.version ? ` ${p.version}` : "";
  if (p.kind === "workspace-venv") return `工作区 .venv${ver}`;
  if (p.kind === "manual") return `手动${ver}`;
  return p.version || p.path;
}

async function refreshInterpreterStatus(): Promise<void> {
  if (!app.workspaceRoot) {
    statusInterpreterEl.textContent = "";
    currentInterpreter = null;
    return;
  }
  try {
    currentInterpreter = await invoke<string | null>("get_interpreter", { workspaceRoot: app.workspaceRoot });
  } catch (e) {
    currentInterpreter = null;
  }
  // D2：品牌蛇形单色图标 + 解释器标签（textContent 拼接防注入）
  const label = currentInterpreter ? shortInterpreter(currentInterpreter) : "uv run";
  const snake = document.createElement("span");
  snake.className = "status-snake";
  snake.innerHTML = SNAKE_SVG; // 常量 SVG
  statusInterpreterEl.replaceChildren(snake, ` ${label}`);
}

async function openEnvPanel(): Promise<void> {
  if (!app.workspaceRoot) return;
  showEl(envModalEl);
  await renderEnvPanel();
}

function closeEnvPanel(): void {
  hideEl(envModalEl);
}

async function renderEnvPanel(): Promise<void> {
  if (!app.workspaceRoot) return;
  let pythons: PythonInfo[] = [];
  try {
    pythons = await invoke<PythonInfo[]>("list_pythons", { workspaceRoot: app.workspaceRoot });
  } catch (e) {
    console.error("list_pythons 失败", e);
  }
  envListEl.textContent = "";

  // 「默认」uv run 兜底项
  const noneItem = document.createElement("div");
  noneItem.className = `env-item${currentInterpreter ? "" : " selected"}`;
  const noneName = document.createElement("span");
  noneName.textContent = "（默认）uv run";
  const noneBadge = document.createElement("span");
  noneBadge.className = "badge";
  noneBadge.textContent = "兜底";
  noneItem.append(noneName, noneBadge);
  noneItem.addEventListener("click", () => selectInterpreter(null));
  envListEl.appendChild(noneItem);

  for (const p of pythons) {
    const item = document.createElement("div");
    item.className = `env-item${p.is_selected ? " selected" : ""}`;
    const name = document.createElement("span");
    name.textContent = pythonLabel(p);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = p.kind === "workspace-venv" ? "工作区" : p.kind === "manual" ? "手动" : "系统";
    const pathEl = document.createElement("span");
    pathEl.className = "path";
    pathEl.textContent = p.path;
    item.append(name, badge, pathEl);
    item.title = p.path;
    item.addEventListener("click", () => selectInterpreter(p.path));
    envListEl.appendChild(item);
  }
  if (pythons.length === 0) {
    const empty = document.createElement("div");
    empty.className = "env-empty";
    empty.textContent = "未检测到 Python（请安装 uv 或手动指定解释器路径）";
    envListEl.appendChild(empty);
  }

  // 版本下拉（用于创建 venv，含可下载版本）
  envVersionSelectEl.textContent = "";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "（默认版本）";
  envVersionSelectEl.appendChild(defOpt);
  let versions: PythonVersionOption[] = [];
  try {
    versions = await invoke<PythonVersionOption[]>("list_python_versions");
  } catch (e) {
    console.error("list_python_versions 失败", e);
  }
  for (const v of versions) {
    const opt = document.createElement("option");
    opt.value = v.spec;
    opt.textContent = v.installed ? v.version : `${v.version}（需下载）`;
    envVersionSelectEl.appendChild(opt);
  }

  await renderPackages();
}

async function selectInterpreter(path: string | null): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("set_interpreter", { workspaceRoot: app.workspaceRoot, path });
  } catch (e) {
    console.error("set_interpreter 失败", e);
    return;
  }
  await refreshInterpreterStatus();
  await renderEnvPanel();
}

/** 根据当前选择与 outdated 状态刷新包工具栏按钮与计数 */
function updatePkgToolbar(): void {
  envPkgCountEl.textContent = currentPackages.length ? `（${currentPackages.length}）` : "";
  envPkgUninstallSelectedBtn.disabled = selectedPkgs.size === 0;
  envPkgUpgradeAllBtn.disabled = !currentInterpreter || outdatedPackages.size === 0;
}

/** 包列表加载占位（内联转圈） */
function renderPkgLoading(msg: string): void {
  envPackagesEl.textContent = "";
  const line = document.createElement("div");
  line.className = "env-empty";
  line.appendChild(spinIcon());
  line.append(` ${msg}`);
  envPackagesEl.appendChild(line);
}

/** 渲染包行（复用：首次快速渲染无 outdated 标记，后台补齐 outdated 后再渲染一次） */
function renderPkgLines(): void {
  envPackagesEl.textContent = "";
  if (currentPackages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "env-empty";
    empty.textContent = "（无已安装包）";
    envPackagesEl.appendChild(empty);
    updatePkgToolbar();
    return;
  }
  for (const p of currentPackages) {
    const line = document.createElement("div");
    line.className = "env-pkg-line";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "pkg-check";
    check.checked = selectedPkgs.has(p.name);
    check.title = "选择以卸载";
    check.addEventListener("change", () => {
      if (check.checked) selectedPkgs.add(p.name);
      else selectedPkgs.delete(p.name);
      updatePkgToolbar();
    });

    const n = document.createElement("span");
    n.className = "pkg-name";
    n.textContent = p.name;
    const v = document.createElement("span");
    v.className = "pkg-version";
    v.textContent = p.version;
    line.append(check, n, v);

    const od = outdatedPackages.get(p.name);
    if (od) {
      const badge = document.createElement("span");
      badge.className = "pkg-outdated";
      badge.textContent = `有新版 ${od.latest}`;
      badge.title = `当前 ${od.version} → 最新 ${od.latest}（${od.filetype}）`;
      line.append(badge);
    }

    const actions = document.createElement("span");
    actions.className = "pkg-actions";
    if (od) {
      const upBtn = document.createElement("button");
      upBtn.className = "codicon codicon-arrow-up";
      upBtn.title = `升级 ${p.name} 到 ${od.latest}`;
      upBtn.addEventListener("click", () => { void upgradePackage(p.name); });
      actions.append(upBtn);
    }
    const rmBtn = document.createElement("button");
    rmBtn.className = "codicon codicon-trash danger";
    rmBtn.title = `卸载 ${p.name}`;
    rmBtn.addEventListener("click", () => { void uninstallPackages([p.name]); });
    actions.append(rmBtn);
    line.append(actions);

    envPackagesEl.appendChild(line);
  }
  updatePkgToolbar();
}

async function renderPackages(): Promise<void> {
  updatePkgToolbar();
  if (!currentInterpreter) {
    envPackagesEl.textContent = "";
    const empty = document.createElement("div");
    empty.className = "env-empty";
    empty.textContent = "选择解释器后查看已安装包";
    envPackagesEl.appendChild(empty);
    currentPackages = [];
    outdatedPackages.clear();
    selectedPkgs.clear();
    updatePkgToolbar();
    return;
  }
  renderPkgLoading("正在加载已安装包…");
  // 先快速加载已装包并渲染：outdated 查询可能联网较慢，后台补齐不阻塞列表展示
  const pkgs = await invoke<PackageInfo[]>("list_packages", { interpreter: currentInterpreter }).catch(() => [] as PackageInfo[]);
  if (!currentInterpreter) return;
  currentPackages = pkgs;
  selectedPkgs = new Set([...selectedPkgs].filter((n) => pkgs.some((p) => p.name === n)));
  renderPkgLines();

  const outdated = await invoke<OutdatedInfo[]>("list_outdated", { interpreter: currentInterpreter }).catch(() => [] as OutdatedInfo[]);
  if (!currentInterpreter) return;
  outdatedPackages = new Map(outdated.map((o) => [o.name, o]));
  renderPkgLines();
}

async function createVenv(): Promise<void> {
  if (!app.workspaceRoot) return;
  const version = envVersionSelectEl.value;
  const btn = $btn("env-create");
  const cmdDesc = `uv venv .venv${version ? " --python " + version : ""}  (${app.workspaceRoot})`;
  appendOutputLine(outputEl, `> ${cmdDesc}`, "cmd", gotoFromLink);
  setBusy(btn, true, "创建中…");
  try {
    const r = await invoke<CreateVenvResult>("create_venv", { workspaceRoot: app.workspaceRoot, version, location: null });
    if (r.output) appendOutputLine(outputEl, r.output, "stdout", gotoFromLink);
    // 直接以创建出的解释器路径持久化选中（不依赖 .venv 自动检测，兼容全局缓存位置）
    if (r.python) {
      await invoke("set_interpreter", { workspaceRoot: app.workspaceRoot, path: r.python }).catch(console.error);
    }
  } catch (e) {
    appendOutputLine(outputEl, `创建环境失败：${e}`, "stderr", gotoFromLink);
    setBusy(btn, false);
    return;
  }
  await refreshInterpreterStatus();
  await renderEnvPanel();
  setBusy(btn, false);
}

async function installPackage(): Promise<void> {
  const spec = envPkgInputEl.value.trim();
  if (!spec || !currentInterpreter) return;
  const btn = $btn("env-pkg-install");
  appendOutputLine(outputEl, `> uv pip install ${spec}  (${currentInterpreter})`, "cmd", gotoFromLink);
  setBusy(btn, true, "安装中…");
  try {
    const code = await invoke<number>("pip_install", { workspaceRoot: app.workspaceRoot, interpreter: currentInterpreter, spec });
    console.log(`[opencharm-install] 环境面板安装结束 code=${code} spec=${spec}`);
    if (code !== 0) appendOutputLine(outputEl, `安装失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `安装失败：${e}`, "stderr", gotoFromLink);
  }
  envPkgInputEl.value = "";
  setBusy(btn, false);
  await renderPackages();
}

/** 卸载指定包（列表勾选批量卸载或单行卸载复用同一入口） */
async function uninstallPackages(names: string[]): Promise<void> {
  const list = names.filter(Boolean);
  if (list.length === 0 || !currentInterpreter) return;
  const proceed = await openConfirm({
    title: "卸载包",
    message: `卸载 ${list.length} 个包：${list.join("、")}？`,
    okLabel: "卸载", cancelLabel: "取消", kind: "danger",
  });
  if (!proceed) return;
  const btn = $btn("env-pkg-uninstall-selected");
  appendOutputLine(outputEl, `> uv pip uninstall ${list.join(" ")}  (${currentInterpreter})`, "cmd", gotoFromLink);
  setBusy(btn, true, "卸载中…");
  try {
    const out = await invoke<string>("pip_uninstall", { interpreter: currentInterpreter, name: list.join(" ") });
    if (out) appendOutputLine(outputEl, out, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `卸载失败：${e}`, "stderr", gotoFromLink);
  }
  selectedPkgs.clear();
  setBusy(btn, false);
  await renderPackages();
}

async function uninstallSelectedPackages(): Promise<void> {
  await uninstallPackages([...selectedPkgs]);
}

/** 单个包升级（行内箭头） */
async function upgradePackage(name: string): Promise<void> {
  await upgradePackages([name]);
}

/** 升级全部过时包 */
async function upgradeAllPackages(): Promise<void> {
  if (!currentInterpreter || outdatedPackages.size === 0) return;
  const names = [...outdatedPackages.keys()];
  const proceed = await openConfirm({
    title: "升级包",
    message: `升级 ${names.length} 个过时包？`,
    okLabel: "升级", cancelLabel: "取消", kind: "primary",
  });
  if (!proceed) return;
  await upgradePackages(names);
}

async function upgradePackages(names: string[]): Promise<void> {
  const list = names.filter(Boolean);
  if (list.length === 0 || !currentInterpreter) return;
  const btn = envPkgUpgradeAllBtn;
  appendOutputLine(outputEl, `> uv pip install --upgrade ${list.join(" ")}  (${currentInterpreter})`, "cmd", gotoFromLink);
  setBusy(btn, true, "升级中…");
  try {
    const code = await invoke<number>("pip_upgrade", { interpreter: currentInterpreter, names: list });
    if (code !== 0) appendOutputLine(outputEl, `升级失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `升级失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(btn, false);
  await renderPackages();
}

/** import 名 → PyPI 包名映射（少数两者不一致时用；其余按顶层模块名原样安装） */
const PACKAGE_ALIASES: Record<string, string> = {
  PIL: "Pillow",
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  yaml: "PyYAML",
  dotenv: "python-dotenv",
  bs4: "beautifulsoup4",
  Crypto: "pycryptodome",
};

/**
 * 灯泡「安装 X」动作的回调（借鉴 PyCharm）：先询问确认，再 uv pip install 到当前解释器，
 * 输出经 pip-stdout / pip-stderr 事件实时滚动到输出面板，装完重启静态引擎刷新诊断。
 */
async function installMissingPackage(pkg: string): Promise<void> {
  if (!app.workspaceRoot) return;
  const spec = PACKAGE_ALIASES[pkg] ?? pkg.trim();
  if (!spec) return;
  console.log(`[opencharm-install] 请求安装 pkg=${pkg} spec=${spec}`);
  if (!currentInterpreter) {
    console.log("[opencharm-install] 未选择解释器，中止");
    appendOutputLine(outputEl, "尚未选择解释器，无法自动安装包（点状态栏解释器图标选择后再试）", "stderr", gotoFromLink);
    return;
  }
  // 询问确认（对照 PyCharm 的安装确认框）
  const proceed = await openConfirm({
    title: "安装包",
    message: `将安装 "${spec}" 到当前解释器：\n${currentInterpreter}\n\n是否继续？`,
    okLabel: "安装", cancelLabel: "取消", kind: "primary",
  });
  console.log(`[opencharm-install] 确认结果=${proceed}`);
  if (!proceed) {
    appendOutputLine(outputEl, `已取消安装 ${spec}`, "stderr", gotoFromLink);
    return;
  }

  appendOutputLine(outputEl, `> uv pip install ${spec}  (${shortInterpreter(currentInterpreter)})`, "cmd", gotoFromLink);
  console.log("[opencharm-install] 开始 pip_install invoke");
  try {
    const code = await invoke<number>("pip_install", { workspaceRoot: app.workspaceRoot, interpreter: currentInterpreter, spec });
    console.log(`[opencharm-install] pip_install 结束 code=${code}`);
    if (code === 0) {
      appendOutputLine(outputEl, `已安装 ${spec}，重新检查诊断…`, "stdout", gotoFromLink);
      await startLsp();
    } else {
      appendOutputLine(outputEl, `安装失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
    }
  } catch (e) {
    console.log("[opencharm-install] 安装异常:", e);
    appendOutputLine(outputEl, `安装失败：${e}`, "stderr", gotoFromLink);
  }
}

/** 首次打开工作区时提示检测到的 .venv（§4.2 优先级） */
async function maybePromptVenv(): Promise<void> {
  if (!app.workspaceRoot || venvPrompted.has(app.workspaceRoot)) return;
  venvPrompted.add(app.workspaceRoot);
  let pythons: PythonInfo[] = [];
  try {
    pythons = await invoke<PythonInfo[]>("list_pythons", { workspaceRoot: app.workspaceRoot });
  } catch {
    return;
  }
  const venv = pythons.find((p) => p.kind === "workspace-venv");
  if (!venv || venv.is_selected) return; // 无 .venv 或已显式选中则跳过
  if (await openConfirm({ message: "检测到工作区 .venv，是否设为当前解释器？", kind: "primary" })) {
    await invoke("set_interpreter", { workspaceRoot: app.workspaceRoot, path: venv.path }).catch(console.error);
    await refreshInterpreterStatus();
  }
}

/** 首次启动环境引导（Phase 4 第 4 步）：探测 uv / 静态引擎，缺失则引导一键安装 */
async function maybePromptToolchain(): Promise<void> {
  try {
    const engine = app.settings.lsp_engine ?? "pyrefly";
    const st = await toolchain.detectToolchain(engine);
    if (st.allOk) return;
    const missing: string[] = [];
    if (!st.uv) missing.push("uv（Python 环境与运行）");
    if (!st.engine.ok) missing.push(`${st.engine.name}（补全 / 跳转）`);
    const proceed = await openConfirm({
      title: "环境引导",
      message: `检测到缺少以下工具：\n\n${missing.map((m) => `· ${m}`).join("\n")}\n\n补全、跳转与运行都需要它们。可一键下载安装到用户目录（不影响系统，需联网）。\n\n是否现在安装？`,
      okLabel: "立即安装",
      cancelLabel: "稍后",
      kind: "primary",
    });
    if (!proceed) return;
    // 展开底部输出面板，展示安装进度
    $("bottom").classList.remove("collapsed");
    appendOutputLine(outputEl, `> 工具链引导：安装 ${missing.join("、")}`, "cmd", gotoFromLink);
    const ok = await toolchain.installToolchain(engine);
    appendOutputLine(
      outputEl,
      ok ? "工具链就绪。" : "安装结束，但部分工具仍不可见，请重启 OpenCharm 后再试。",
      ok ? "stdout" : "stderr",
      gotoFromLink,
    );
  } catch (e) {
    console.warn("[toolchain] 探测失败，跳过引导:", e);
  }
}

// ---------- 符号大纲（P25-T07）+ 全局搜索 ----------

/** 搜索匹配点击 → 打开文件并定位到匹配处 */
async function openSearchMatch(m: SearchMatch): Promise<void> {
  await openFile(m.path, m.line);
  app.editor.setPosition({ lineNumber: m.line, column: m.column });
  app.editor.revealLineInCenter(m.line);
  app.editor.focus();
}

/** 执行搜索（工作区未打开时忽略） */
async function executeSearch(): Promise<void> {
  if (!app.workspaceRoot) return;
  const input = $("search-input") as HTMLInputElement;
  await runSearch(app.workspaceRoot, input.value, searchCaseSensitive, $("search-results"));
}

function renderOutlineSymbols(container: HTMLElement, symbols: lsp.LspDocumentSymbol[], depth: number): void {
  for (const s of symbols) {
    const line = (s.selectionRange?.start?.line ?? s.range?.start?.line ?? 0) + 1;
    const item = document.createElement("div");
    item.className = "outline-item";
    item.style.paddingLeft = `${8 + depth * 14}px`;
    const icon = document.createElement("span");
    icon.className = "outline-icon";
    icon.appendChild(codicon(symbolIcon(s.kind)));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = s.name;
    item.append(icon, name);
    item.title = `${s.name}:${line}`;
    item.addEventListener("click", () => {
      app.editor.setPosition({ lineNumber: line, column: 1 });
      app.editor.revealLineInCenter(line);
      app.editor.focus();
    });
    container.appendChild(item);
    if (s.children?.length) renderOutlineSymbols(container, s.children, depth + 1);
  }
}

async function refreshOutline(): Promise<void> {
  if (!app.activeTab) {
    outlineEl.textContent = "";
    return;
  }
  const symbols = await lsp.documentSymbols(app.activeTab.path);
  outlineEl.textContent = "";
  if (symbols.length === 0) {
    outlineEl.appendChild(emptyState("symbol-misc", "无符号", undefined, true));
    return;
  }
  renderOutlineSymbols(outlineEl, symbols, 0);
}

// ---------- 最近文件（P25-T09） ----------

async function recordRecent(path: string): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("add_recent", { workspaceRoot: app.workspaceRoot, file: path });
  } catch (e) {
    console.warn("记录最近文件失败", e);
  }
}

// ---------- 标签页 / 编辑器 ----------

export async function openFile(path: string, revealLine?: number): Promise<void> {
  let tab = app.tabs.find((t) => t.path === path);
  if (!tab) {
    const content = await invoke<string>("read_file", { path });
    const model = app.monaco.editor.createModel(content, languageOf(path), app.monaco.Uri.file(path));
    model.updateOptions({ tabSize: app.settings.tab_size, insertSpaces: app.settings.insert_spaces }); // P1 缩进设置
    lsp.markModelPath(model, path);
    model.onDidChangeContent(() => {
      const t = app.tabs.find((x) => x.model === model);
      if (t && !t.dirty) {
        t.dirty = true;
        renderTabs();
      }
      // 标记待同步（200ms 防抖后发全量，见 init 中的 changeTimer）
      if (t) app.pendingChanges.add(t.path);
    });
    tab = { path, model, dirty: false };
    app.tabs.push(tab);
    lsp.didOpen(path, model);
    // 应用引擎已发布的诊断（打开前就收到的 publishDiagnostics）
    lsp.applyCachedDiagnostics(path, setMarkers);
  }
  activateTab(tab);
  void recordRecent(path);
  if (revealLine !== undefined) {
    app.editor.revealLineInCenter(revealLine);
    app.editor.setPosition({ lineNumber: revealLine, column: 1 });
  }
}

function activateTab(tab: Tab): void {
  app.activeTab = tab;
  app.editor.setModel(tab.model);
  renderTabs();
  statusFileEl.textContent = tab.path;
  if (activeView() === "files") refreshOutline();
  updateEditorOverlay();
}

async function closeTab(tab: Tab): Promise<void> {
  const idx = app.tabs.indexOf(tab);
  if (idx === -1) return;
  if (tab.dirty && !(await openConfirm({ message: `${basename(tab.path)} 有未保存修改，确认关闭？`, kind: "danger" }))) return;
  closeTabSilent(tab);
}

/** 关闭标签（不弹确认，用于工作区切换时的批量清理） */
export function closeTabSilent(tab: Tab): void {
  const idx = app.tabs.indexOf(tab);
  if (idx === -1) return;
  app.tabs.splice(idx, 1);
  lsp.didClose(tab.path);
  app.monaco.editor.setModelMarkers(tab.model, "opencharm-lsp", []);
  tab.model.dispose();
  if (app.activeTab === tab) {
    app.activeTab = null;
    const next = app.tabs[Math.min(idx, app.tabs.length - 1)] ?? null;
    if (next) activateTab(next);
    else {
      app.editor.setModel(null);
      statusFileEl.textContent = "";
      updateEditorOverlay();
    }
  }
  renderTabs();
}

export function renderTabs(): void {
  tabbarEl.textContent = "";
  for (const t of app.tabs) {
    const el = document.createElement("div");
    el.className = `tab ${t === app.activeTab ? "active" : ""}`;
    el.appendChild(renderFileIcon(basename(t.path))); // D2 P-08：标签页文件类型图标
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = basename(t.path);
    const dirty = document.createElement("span");
    dirty.className = "dirty";
    if (t.dirty) dirty.appendChild(codicon("circle-filled"));
    // .py/.pyw 文件显示运行/停止图标
    const isPython = t.path.endsWith(".py") || t.path.endsWith(".pyw");
    if (isPython) {
      const isRunning = running && t.path === runningPath;
      const runIcon = document.createElement("span");
      runIcon.className = `tab-run${isRunning ? " running" : ""}`;
      runIcon.appendChild(codicon(isRunning ? "stop" : "play"));
      runIcon.title = isRunning ? "停止运行" : "运行此文件";
      runIcon.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (isRunning) {
          void stopRun();
        } else {
          activateTab(t);
          void runActive();
        }
      });
      el.appendChild(runIcon);
    }
    const close = document.createElement("span");
    close.className = "close";
    close.appendChild(codicon("close"));
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeTab(t);
    });
    el.append(name, dirty, close);
    el.addEventListener("click", () => activateTab(t));
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showTabContextMenu(t, ev.clientX, ev.clientY);
    });
    tabbarEl.appendChild(el);
  }
}

async function saveActive(): Promise<void> {
  if (!app.activeTab) return;
  // 保存时格式化（ruff，设置开关）：失败不阻断保存
  if (app.settings.format_on_save && app.activeTab.path.endsWith(".py")) {
    const formatted = await formatPythonSource(app.activeTab.path, app.activeTab.model.getValue());
    if (formatted !== null && formatted !== app.activeTab.model.getValue()) {
      app.activeTab.model.setValue(formatted); // 单次 setValue → Ctrl+Z 可整体撤销
    }
  }
  await invoke("write_file", { path: app.activeTab.path, content: app.activeTab.model.getValue() });
  app.activeTab.dirty = false;
  renderTabs();
  // 保存通知（引擎常在保存时触发完整重新检查）
  lsp.didSave(app.activeTab.path, app.activeTab.model);
}

// ---------- 运行 ----------

async function runActive(): Promise<void> {
  if (!app.activeTab || running) return;
  const path = app.activeTab.path;
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return;
  }
  if (app.activeTab.dirty) await saveActive(); // 运行前自动保存
  // 运行前依赖预检：文件顶层 import 的第三方模块须在当前解释器中可解析，否则提前提示（避免「补全可用但运行 ImportError」）
  if (currentInterpreter) {
    const missing = await invoke<Array<{ name: string; line: number; stmt: string }>>(
      "check_missing_imports",
      { path, workspaceRoot: app.workspaceRoot },
    ).catch((e) => {
      console.warn("[pre-run] 依赖检测失败，跳过:", e);
      return [] as Array<{ name: string; line: number; stmt: string }>;
    });
    if (missing.length > 0) {
      const lines = missing.map((m) => `第 ${m.line} 行  ${m.stmt}`).join("\n");
      const proceed = await openConfirm({
        title: "运行前依赖预检",
        message: `以下导入在当前解释器中未找到，运行可能出现 ImportError：\n\n${lines}\n\n仍要运行吗？`,
        okLabel: "仍要运行", cancelLabel: "取消", kind: "danger",
      });
      if (!proceed) return;
    }
  }
  running = true;
  runningPath = path;
  renderTabs();
  const cmd = currentInterpreter
    ? `${shortInterpreter(currentInterpreter)} ${basename(path)}`
    : `uv run ${basename(path)}`;
  appendOutputLine(outputEl, `> ${cmd}  (${path})`, "cmd", gotoFromLink);
  try {
    await invoke("run_script", { path, workspaceRoot: app.workspaceRoot, probe: app.settings.probe_enabled });
    // 输出经 run-stdout / run-stderr / run-exit 事件流式到达
  } catch (e) {
    appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
    running = false;
    runningPath = null;
    renderTabs();
  }
}

/** 运行选区（无选区时运行光标所在行）：写入源文件同目录的临时文件后运行（不挂 probe 采样） */
async function runSelection(): Promise<void> {
  if (!app.activeTab || running) return;
  const path = app.activeTab.path;
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return;
  }
  const editor = app.editor;
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;

  let code: string;
  let startLine: number;
  let endLine: number;
  if (sel.isEmpty()) {
    // 无选区 → 运行光标所在行
    startLine = sel.startLineNumber;
    endLine = sel.endLineNumber;
    code = model.getLineContent(startLine);
  } else {
    startLine = sel.startLineNumber;
    endLine = sel.endLineNumber;
    code = model.getValueInRange(sel);
  }
  if (!code.trim()) {
    appendOutputLine(outputEl, "选区为空，无可运行代码", "stderr", gotoFromLink);
    return;
  }
  if (app.activeTab.dirty) await saveActive(); // 运行前保存（与整文件运行一致）

  // 临时文件写到源文件同目录：保证 import 相对导入 / 相对路径资源与源文件一致
  const tempPath = joinPath(parentDirOf(path), "__opencharm_selection__.py");
  try {
    await invoke("write_file", { path: tempPath, content: code });
  } catch (e) {
    appendOutputLine(outputEl, `写入选区临时文件失败: ${e}`, "stderr", gotoFromLink);
    return;
  }

  selectionRunMeta = { tempPath, sourcePath: path, startLine };

  running = true;
  runningPath = tempPath;
  renderTabs();
  const rangeLabel = startLine === endLine ? `行 ${startLine}` : `行 ${startLine}-${endLine}`;
  appendOutputLine(outputEl, `> 运行选区  ${path}:${rangeLabel}`, "cmd", gotoFromLink);
  try {
    // probe=false：选区是临时代码，不采样（避免污染项目 trace 库）
    await invoke("run_script", { path: tempPath, workspaceRoot: app.workspaceRoot, probe: false });
  } catch (e) {
    appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
    running = false;
    runningPath = null;
    renderTabs();
  }
}

async function stopRun(): Promise<void> {
  try {
    await invoke("stop_script");
  } catch { /* 忽略 */ }
  // 立即更新状态（run-exit 事件也会更新，但可能有延迟）
  running = false;
  runningPath = null;
  renderTabs();
}

// ---------- traceback 跳转 ----------

export function gotoFromLink(link: OutputLink): void {
  let path = link.path;
  let line = link.line;
  // 选区运行 traceback 的临时文件 → 映射回源文件选区起始行
  if (selectionRunMeta && samePath(link.path, selectionRunMeta.tempPath)) {
    path = selectionRunMeta.sourcePath;
    line = selectionRunMeta.startLine + link.line - 1;
  }
  if (!/^[a-zA-Z]:[\\/]/.test(path) && app.workspaceRoot) {
    path = `${app.workspaceRoot}\\${path}`;
  }
  openFile(path, line).catch(() => {
    appendOutputLine(outputEl, `无法打开: ${link.path}`, "stderr", gotoFromLink);
  });
}

/** 路径规范化比较（斜杠/大小写无关），用于选区临时文件匹配 */
function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

// ---------- LSP ----------

export async function startLsp(): Promise<void> {
  if (!app.workspaceRoot) return;
  const engine = ($("engine-select") as HTMLSelectElement).value;
  const rootUri = `file:///${app.workspaceRoot.replace(/\\/g, "/")}`;
  try {
    await lsp.startEngine(engine, rootUri, currentInterpreter);
  } catch (e) {
    statusLspEl.textContent = `LSP 启动失败: ${e}`;
    return;
  }
  // 运行时引擎（opencharm-intel）：开关控制（P3-T09），失败静默降级（静态引擎照常工作）
  if (app.settings.runtime_intel_enabled) {
    try {
      await lsp.startIntel(app.workspaceRoot, rootUri);
    } catch (e) {
      console.warn("[intel] 启动异常:", e);
    }
  } else {
    await lsp.stopIntel();
  }
  // 两个引擎（重）启动后重新同步已打开文件——新进程对它们一无所知
  for (const t of app.tabs) lsp.didOpen(t.path, t.model);
}

function setMarkers(path: string, markers: MonacoApi.editor.IMarkerData[], owner = "opencharm-lsp"): void {
  const tab = app.tabs.find((t) => t.path === path);
  if (tab) app.monaco.editor.setModelMarkers(tab.model, owner, markers);
}

// ---------- 菜单栏 ----------

const menuDropdownEl = $("menu-dropdown");
const submenuEl = $("menu-submenu");
let activeMenuBtn: HTMLElement | null = null;
/** 当前展开子菜单的父项元素（用于 hover 态与定位） */
let activeSubmenuParent: HTMLElement | null = null;
/** hover 延时展开 / 延时关闭定时器 */
let submenuTimer: number | undefined;

interface MenuEntry {
  label: string;
  shortcut?: string;
  /** 子菜单项副标题（如最近工作区的路径） */
  detail?: string;
  action?: () => void;
  /** 有值即渲染为带 ▸ 的父项，悬停/点击展开右侧子菜单 */
  submenu?: () => MenuEntry[] | Promise<MenuEntry[]>;
  sep?: boolean;
}

function rootEntry(): Entry {
  return { name: basename(app.workspaceRoot ?? ""), path: app.workspaceRoot ?? "", is_dir: true };
}

function getMenuItems(menu: string): MenuEntry[] {
  switch (menu) {
    case "file": return [
      { label: "新建项目", action: () => openNewProjectPanel() },
      { label: "新建文件", action: () => { if (app.workspaceRoot) void createFileAt(rootEntry()); } },
      { label: "新建文件夹", action: () => { if (app.workspaceRoot) void createDirAt(rootEntry()); } },
      { sep: true, label: "" },
      { label: "打开工作区", shortcut: "Ctrl+K Ctrl+O", action: () => void openFolderFromToolbar() },
      { label: "保存", shortcut: kb.bindingLabel("save") || undefined, action: () => void saveActive() },
      { sep: true, label: "" },
      {
        label: "最近的工作区",
        submenu: async () => {
          const recents = await getRecentWorkspaces();
          if (recents.length === 0) return [{ label: "（暂无最近的工作区）" }];
          const items: MenuEntry[] = recents.map((p) => ({
            label: basename(p),
            detail: p,
            action: () => openWorkspace(p).catch(console.error),
          }));
          items.push({ sep: true, label: "" });
          items.push({ label: "清空最近的工作区", action: () => void clearRecentWorkspaces() });
          return items;
        },
      },
      { sep: true, label: "" },
      { label: "关闭工作区", action: () => void closeWorkspace() },
    ];
    case "edit": return [
      { label: "撤销", shortcut: "Ctrl+Z", action: () => { app.editor.trigger("menu", "undo", null); } },
      { label: "重做", shortcut: "Ctrl+Shift+Z", action: () => { app.editor.trigger("menu", "redo", null); } },
      { sep: true, label: "" },
      { label: "查找", shortcut: "Ctrl+F", action: () => { app.editor.trigger("menu", "actions.find", null); } },
      { label: "替换", shortcut: "Ctrl+H", action: () => { app.editor.trigger("menu", "editor.action.startFindReplaceAction", null); } },
      { sep: true, label: "" },
      { label: "格式化文档", shortcut: "Shift+Alt+F", action: () => { void app.editor.getAction("editor.action.formatDocument")?.run(); } },
    ];
    case "view": return [
      { label: "文件树", action: () => setSidebarTab("files") },
      { label: "搜索", shortcut: kb.bindingLabel("global_search") || undefined, action: () => setSidebarTab("search") },
      { sep: true, label: "" },
      { label: "输出面板", action: () => { $("bottom").classList.toggle("collapsed"); } },
      { label: "设置", action: () => openSettingsPanel() },
      { label: "Live Templates", action: () => openSettingsPanel("templates") },
    ];
    case "tools": return listDevTools().map((t) => ({
      label: t.title,
      action: () => openDevTools(t.id),
    }));
    default: return [];
  }
}

function showMenuDropdown(btn: HTMLElement, menu: string): void {
  const items = getMenuItems(menu);
  menuDropdownEl.textContent = "";
  for (const it of items) {
    const el = document.createElement("div");
    if (it.sep) {
      el.className = "ctx-menu-item sep-item";
      const line = document.createElement("div");
      line.className = "sep";
      el.appendChild(line);
    } else if (it.submenu) {
      // 有子菜单的父项：右侧 ▸，悬停延时展开、点击切换
      el.className = "ctx-menu-item with-submenu";
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      const arrow = document.createElement("span");
      arrow.className = "sub-arrow";
      arrow.textContent = "▸";
      el.appendChild(arrow);
      el.addEventListener("mouseenter", () => scheduleSubmenu(el, it.submenu!));
      el.addEventListener("mouseleave", scheduleSubmenuClose);
      el.addEventListener("click", () => {
        if (activeSubmenuParent === el) hideSubmenu();
        else void openSubmenu(el, it.submenu!);
      });
    } else {
      el.className = "ctx-menu-item";
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      if (it.shortcut) {
        const sc = document.createElement("span");
        sc.className = "menu-shortcut";
        sc.textContent = it.shortcut;
        el.appendChild(sc);
      }
      el.addEventListener("mouseenter", hideSubmenu);
      el.addEventListener("click", () => {
        hideMenuDropdown();
        it.action?.();
      });
    }
    menuDropdownEl.appendChild(el);
  }
  menuDropdownEl.classList.remove("hidden");
  const rect = btn.getBoundingClientRect();
  menuDropdownEl.style.left = `${rect.left}px`;
  menuDropdownEl.style.top = `${rect.bottom + 2}px`;
  activeMenuBtn?.classList.remove("active");
  activeMenuBtn = btn;
  btn.classList.add("active");
}

function hideMenuDropdown(): void {
  hideSubmenu();
  menuDropdownEl.classList.add("hidden");
  activeMenuBtn?.classList.remove("active");
  activeMenuBtn = null;
}

// ---------- 级联子菜单（flyout） ----------

function cancelSubmenuTimer(): void {
  window.clearTimeout(submenuTimer);
  submenuTimer = undefined;
}

function hideSubmenu(): void {
  cancelSubmenuTimer();
  activeSubmenuParent?.classList.remove("open");
  activeSubmenuParent = null;
  submenuEl.classList.add("hidden");
  submenuEl.textContent = "";
}

/** 悬停父项：延时展开（连续移动会重置计时，避免闪烁） */
function scheduleSubmenu(parentEl: HTMLElement, resolve: () => MenuEntry[] | Promise<MenuEntry[]>): void {
  cancelSubmenuTimer();
  submenuTimer = window.setTimeout(() => { void openSubmenu(parentEl, resolve); }, 200);
}

/** 离开父项：延时关闭，给鼠标移入子菜单留缓冲 */
function scheduleSubmenuClose(): void {
  cancelSubmenuTimer();
  submenuTimer = window.setTimeout(hideSubmenu, 250);
}

async function openSubmenu(parentEl: HTMLElement, resolve: () => MenuEntry[] | Promise<MenuEntry[]>): Promise<void> {
  cancelSubmenuTimer();
  activeSubmenuParent?.classList.remove("open");
  activeSubmenuParent = parentEl;
  parentEl.classList.add("open");

  let children: MenuEntry[];
  try {
    children = await resolve();
  } catch (e) {
    console.warn("读取子菜单失败", e);
    children = [{ label: "（加载失败）" }];
  }

  // 异步期间可能已切到其它父项或菜单已关闭
  if (activeSubmenuParent !== parentEl || menuDropdownEl.classList.contains("hidden")) return;

  submenuEl.textContent = "";
  for (const it of children) {
    if (it.sep) {
      const el = document.createElement("div");
      el.className = "ctx-menu-item sep-item";
      const line = document.createElement("div");
      line.className = "sep";
      el.appendChild(line);
      submenuEl.appendChild(el);
    } else {
      const el = document.createElement("div");
      el.className = "ctx-menu-item";
      const labelSpan = document.createElement("span");
      labelSpan.className = "sub-label";
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      if (it.detail) {
        const detailSpan = document.createElement("span");
        detailSpan.className = "sub-detail";
        detailSpan.textContent = it.detail;
        detailSpan.title = it.detail;
        el.appendChild(detailSpan);
      }
      el.addEventListener("click", () => {
        hideMenuDropdown();
        it.action?.();
      });
      submenuEl.appendChild(el);
    }
  }
  submenuEl.classList.remove("hidden");
  positionSubmenu(parentEl);
}

function positionSubmenu(parentEl: HTMLElement): void {
  const parentRect = parentEl.getBoundingClientRect();
  const menuRect = menuDropdownEl.getBoundingClientRect();
  // 先复位到 0 以便测量真实宽高
  submenuEl.style.left = "0px";
  submenuEl.style.top = "0px";
  const subRect = submenuEl.getBoundingClientRect();

  let left = menuRect.right - 1; // 紧贴父菜单右缘（共享 1px 边框）
  let top = parentRect.top;

  // 右侧放不下 → 折返到父菜单左侧
  if (left + subRect.width > window.innerWidth - 4) {
    left = menuRect.left - subRect.width + 1;
  }
  // 下缘溢出 → 向上夹取，保证不超视口
  if (top + subRect.height > window.innerHeight - 4) {
    top = window.innerHeight - subRect.height - 4;
  }
  if (top < 4) top = 4;

  submenuEl.style.left = `${left}px`;
  submenuEl.style.top = `${top}px`;
}

function wireMenuBar(): void {
  document.querySelectorAll<HTMLElement>(".menubar-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = btn.dataset.menu ?? "";
      if (activeMenuBtn === btn) {
        hideMenuDropdown();
      } else {
        hideMenuDropdown();
        showMenuDropdown(btn, menu);
      }
    });
  });
  menuDropdownEl.addEventListener("click", (e) => e.stopPropagation());
  submenuEl.addEventListener("click", (e) => e.stopPropagation());
  submenuEl.addEventListener("mouseenter", cancelSubmenuTimer);
  submenuEl.addEventListener("mouseleave", scheduleSubmenuClose);
  document.addEventListener("click", () => {
    if (!menuDropdownEl.classList.contains("hidden")) hideMenuDropdown();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuDropdownEl.classList.contains("hidden")) hideMenuDropdown();
  });
}

// Monaco standalone 无文件系统：Ctrl+hover 定义预览（goToDefinitionAtPosition）会 createModelReference
// 报 "Model not found"（未打开的文件无法建 model）。F12/菜单跳转走 opencharm 自己的 handler，不受影响；
// 这里静默该已知限制的 unhandled rejection，避免控制台噪音。
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason as { message?: string } | string | undefined;
  const msg = typeof reason === "string" ? reason : reason?.message ?? "";
  if (msg.includes("Model not found")) e.preventDefault();
});

// ---------- 初始化 ----------

async function init(): Promise<void> {
  // Monaco 动态加载（首屏 UI 先渲染，编辑器包并行下载）
  app.monaco = (await import("./monaco")).default;
  lsp.setMonaco(app.monaco);
  await loadSettings(); // 设置先于编辑器创建（字号/主题，P25-T08）
  app.monaco.editor.setTheme(app.settings.theme); // D1：启动即应用已存主题（外壳 data-theme 由 loadSettings 同步）
  // 快捷键域：注册稳定命令 + 按设置建立键 → 命令映射（设置保存后可重建）
  kb.initKeybindingCommands(app.monaco);
  kb.applyEditorKeybindings();
  app.editor = app.monaco.editor.create($("editor"), {
    model: null,
    language: "python",
    theme: app.settings.theme,
    automaticLayout: true,
    glyphMargin: true, // 灯泡在顶格行（如 import）显示于 glyph 边距，须开启（P3 快速修复）
    // lightbulb 默认 onCode 已开启，无需显式设置
    ...buildEditorOptions(app.settings), // P1：字号/连字/缩进/换行/迷你地图/字体族由设置统一注入
    wordBasedSuggestions: "off", // 踩坑 #3
    quickSuggestions: { other: true, comments: false, strings: false },
  });
  applyFontStatus();
  

  // 字体缩放：Ctrl+滚轮 8-32px，状态栏显示，存全局配置（P25-T08）
  app.editor.getDomNode()?.addEventListener("wheel", (e: WheelEvent) => {
    if (!e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const next = Math.max(8, Math.min(32, app.settings.font_size + delta));
    if (next === app.settings.font_size) return;
    app.settings.font_size = next;
    app.editor.updateOptions({ fontSize: next });
    applyFontStatus();
    void saveSettings();
  }, { passive: false });

  // 失焦自动保存（P25-T08）
  app.editor.onDidBlurEditorText(() => {
    if (app.settings.autosave === "blur" && app.activeTab?.dirty) void saveActive();
  });

  liveTemplatesHandle = await initLiveTemplates(app.monaco, app.editor, {
    getWorkspaceRoot: () => app.workspaceRoot,
    fetchDocumentSymbols: (path) => lsp.documentSymbols(path), // M2：符号上下文主路径
    getModelPath: (model) => lsp.modelPath(model),
  });
  ltUi.wirePanel({
    getHandle: () => liveTemplatesHandle,
    hasWorkspace: () => !!app.workspaceRoot,
  });
  // 开发工具框架（curl→Python / JSONPath 提取器…）：菜单「工具」+ 模态面板统一入口
  initDevTools({
    monaco: app.monaco,
    editor: app.editor,
    workspaceRoot: () => app.workspaceRoot,
  });
  // 模板入口快捷键（可配置，默认 Ctrl+J / Ctrl+Alt+T）
  kb.setKeybindingHandler("template_palette", () => liveTemplatesHandle?.openPalette());
  kb.setKeybindingHandler("surround", () => liveTemplatesHandle?.openSurround());
  // 运行选区 / 行（默认 Alt+Shift+E）
  kb.setKeybindingHandler("run_selection", () => void runSelection());
  lsp.registerLspCompletion();
  lsp.registerLspHover();
  lsp.registerLspDefinition();
  lsp.registerLspRename(); // F2 编辑器内重命名
  lsp.registerLspReferences(); // Shift+F12 查找引用（peek 视图）
  lsp.registerLspSignatureHelp(); // 签名帮助（参数提示）
  lsp.registerLspCodeAction(); // Ctrl+. 快速修复
  lsp.registerLspInlayHints(); // 运行时类型标注（opencharm-intel）
  // 缺失包安装：注册全局命令供 CodeAction 的 command 引用（灯泡「安装 X」→ pip install）。
  // CodeAction 的 command 走 commandService.executeCommand(id)，必须用 registerCommand 全局注册 id；
  // 不能用 editor.addAction——addAction 内部会把 id 加 editorId 前缀（`editorId:id`），导致 executeCommand 找不到。
  app.monaco.editor.registerCommand(lsp.INSTALL_PACKAGE_COMMAND, (_accessor, ...args: unknown[]) => {
    const pkg = args[0];
    console.log(`[opencharm-install] 命令触发 pkg=${String(pkg)}`);
    if (typeof pkg === "string" && pkg) void installMissingPackage(pkg);
  });
  registerRuffFormatter(app.monaco); // Shift+Alt+F / 右键「Format Document」
  setFormatErrorHandler((msg) => appendOutputLine(outputEl, msg, "stderr", gotoFromLink));
  setOpenMatchHandler((m) => openSearchMatch(m).catch(console.error));
  // P1-BUG-002：补全请求前冲刷防抖窗口内未同步的 didChange——`.` 触发的补全请求会赶在
  // 200ms 防抖同步之前到达引擎，引擎按旧文档计算（补全位置越界 → 空结果）
  lsp.setBeforeCompletionHook(async (model) => {
    const t = app.tabs.find((x) => x.model === model);
    if (t && app.pendingChanges.has(t.path)) {
      app.pendingChanges.delete(t.path);
      await lsp.didChangeFull(t.path, t.model);
    }
  });
  lsp.wireGotoTriggers(app.editor); // F12 / Ctrl+点击 显式跳转（Ctrl+悬停不跳）
  lsp.setGotoDefinitionHandler((path, line, col) => {
    openFile(path, line).then(() => app.editor.setPosition({ lineNumber: line, column: col }));
  });
  // 跳转定义可配置键（默认 Ctrl+B，PyCharm 风格；F12 / Ctrl+点击固定保留）
  kb.setKeybindingHandler("goto_definition", () => void lsp.gotoDefinitionAtCursor(app.editor));
  lsp.onNotification("textDocument/publishDiagnostics", (params, engine) => {
    lsp.handleDiagnostics(params, engine, setMarkers);
  });
  lsp.onEngineStatus((s) => {
    const map: Record<lsp.EngineStatus, string> = {
      off: "LSP: 未启动", starting: "LSP: 启动中…", ready: "LSP: 就绪",
      error: "LSP: 错误", exited: "LSP: 已退出",
    };
    // D3 P-09：状态点（灰未启动 / 黄启动中 / 绿就绪 / 红错误）
    const dotClass: Record<lsp.EngineStatus, string> = {
      off: "dot-off", starting: "dot-starting", ready: "dot-ready",
      error: "dot-error", exited: "dot-off",
    };
    const dot = document.createElement("span");
    dot.className = `lsp-dot ${dotClass[s]}`;
    statusLspEl.replaceChildren(dot, map[s]);
  });

  // window 级快捷键（保存 / 运行 / 全局搜索，PyCharm 默认）：经键位表实时匹配，可在设置中自定义
  window.addEventListener("keydown", (e) => {
    // 焦点在表单控件时不触发全局键（搜索框 / 提交框等）；
    // Monaco 编辑器内部也是 textarea，经 .monaco-editor 判定排除
    const ae = document.activeElement as HTMLElement | null;
    const inMonaco = !!ae?.closest(".monaco-editor");
    if (!inMonaco && ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT" || ae.isContentEditable)) return;
    const id = kb.matchWindowBinding(e);
    if (!id) return;
    e.preventDefault();
    if (id === "save") void saveActive();
    else if (id === "run") void runActive();
    else if (id === "global_search") setSidebarTab("search");
  });

  // didChange 全量同步（200ms 防抖，技术方案 §2.4）
  let changeTimer: number | undefined;
  let outlineTimer: number | undefined;
  let autosaveTimer: number | undefined;
  app.editor.onDidChangeModelContent(() => {
    if (!app.activeTab) return;
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => {
      for (const path of app.pendingChanges) {
        const t = app.tabs.find((x) => x.path === path);
        if (t) lsp.didChangeFull(path, t.model);
      }
      app.pendingChanges.clear();
    }, 200);
    // 大纲随编辑防抖刷新（500ms，P25-T07）
    window.clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(() => {
      if (activeView() === "files") refreshOutline();
    }, 500);
    // 自动保存（delay 模式，P25-T08）
    if (app.settings.autosave === "delay") {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = window.setTimeout(() => {
        if (app.activeTab?.dirty) void saveActive();
      }, app.settings.autosave_delay);
    }
  });

  // 各功能域事件接线（TD-007 域拆分后由各域自行提供）
  restoreLayout(); // D2 P-03：先恢复上次的侧栏宽度 / 底部面板高度
  wireSplitters();
  restoreReduceMotion(); // D3 P-06：恢复「减少动画」设置
  wireTooltip(); // D3 P-11：自绘 tooltip（data-tip 委托）
  $("tab-search").dataset.tipKey = kb.bindingLabel("global_search"); // tooltip 快捷键副文本（跟随自定义键位）
  wireBottomPanel();
  wireFileTree();
  $("ew-open-folder").addEventListener("click", () => void openFolderFromToolbar());
  $("ew-new-project").addEventListener("click", () => openNewProjectPanel());
  $("ew-recent-clear").addEventListener("click", () => void clearRecentWorkspaces());
  wireMenuBar();

  // 自绘标题栏（decorations: false）：窗口控制按钮 + 拖拽区 + 边缘 resize 兜底
  const appWindow = getCurrentWindow();
  const winMaxBtn = $("win-max") as HTMLButtonElement;
  const syncMaxIcon = async (): Promise<void> => {
    try {
      const max = await appWindow.isMaximized();
      winMaxBtn.textContent = max ? "❐" : "□";
      winMaxBtn.title = max ? "还原" : "最大化";
    } catch { /* 忽略 */ }
  };
  $("win-min").addEventListener("click", () => void appWindow.minimize());
  winMaxBtn.addEventListener("click", () => {
    void appWindow.toggleMaximize();
    void syncMaxIcon();
  });
  $("win-close").addEventListener("click", () => void appWindow.close());
  // 自绘标题栏：整个 menubar 的空白区可拖拽 / 双击最大化。
  // 用 mousedown 手动接管（data-tauri-drag-region 会吞掉双击且只对直接元素生效），
  // 交互元素（菜单按钮、引擎下拉、窗口控制按钮）不拦截。
  ($("menubar") as HTMLElement).addEventListener("mousedown", (ev) => {
    if (ev.buttons !== 1) return; // 仅响应左键
    const target = ev.target as HTMLElement;
    if (target.closest("button, select, input, #win-controls")) return;
    if (ev.detail === 2) {
      void appWindow.toggleMaximize();
      void syncMaxIcon();
    } else {
      void appWindow.startDragging();
    }
  });
  void syncMaxIcon();
  // 尺寸变化（含 snap 吸附 / 拉伸）后刷新最大化/还原图标
  void appWindow.onResized(() => void syncMaxIcon());

  // 边缘 resize 兜底：decorations:false 下部分 Windows 版本失去原生边缘缩放，
  // 用透明热区 + startResizeDragging 手动接管。
  const resizeEdges: Array<[ResizeDirection, string]> = [
    ["North", "n"], ["South", "s"], ["East", "e"], ["West", "w"],
    ["NorthEast", "ne"], ["NorthWest", "nw"], ["SouthEast", "se"], ["SouthWest", "sw"],
  ];
  for (const [dir, cls] of resizeEdges) {
    const h = document.createElement("div");
    h.className = `rs-handle rs-${cls}`;
    h.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return; // 仅响应左键
      ev.preventDefault();
      void appWindow.startResizeDragging(dir);
    });
    document.body.appendChild(h);
  }
  ($("engine-select") as HTMLSelectElement).addEventListener("change", () => {
    startLsp().catch((e) => console.error(e));
  });

  // 环境面板（P25-T05）——状态栏解释器点击打开
  statusInterpreterEl.addEventListener("click", () => openEnvPanel());
  $btn("env-close").addEventListener("click", closeEnvPanel);
  $btn("env-create").addEventListener("click", createVenv);
  $btn("env-pkg-install").addEventListener("click", installPackage);
  $btn("env-pkg-uninstall-selected").addEventListener("click", () => uninstallSelectedPackages());
  $btn("env-pkg-upgrade-all").addEventListener("click", () => upgradeAllPackages());
  envModalEl.addEventListener("click", (e) => {
    if (e.target === envModalEl) closeEnvPanel();
  });

  // 侧栏视图注册表（TD-001）：单根容器 + 生命周期钩子，切换只操作注册表根节点
  registerSidebarView({
    id: "files",
    rootId: "view-files",
    tabId: "tab-files",
    onShow: () => { refreshOutline(); },
  });
  registerSidebarView({
    id: "search",
    rootId: "view-search",
    tabId: "tab-search",
    onShow: () => ($("search-input") as HTMLInputElement).focus(),
    onHide: () => cancelSearch(),
  });
  registerSidebarView({
    id: "git",
    rootId: "view-git",
    tabId: "tab-git",
    onShow: () => {
      refreshGitStatus().then(() => {
        renderGitPanel();
        void refreshBranchPanel();
      });
    },
  });

  // Activity Bar 图标（FILES / SEARCH / GIT）
  $("tab-files").addEventListener("click", () => setSidebarTab("files"));
  $("tab-search").addEventListener("click", () => setSidebarTab("search"));
  $("tab-git").addEventListener("click", () => setSidebarTab("git"));
  // 大纲折叠 / 展开（OUTLINE 并入文件视图，TD-001 附带考虑）
  $("outline-header").addEventListener("click", () => {
    $("outline-section").classList.toggle("collapsed");
  });
  // 初始化默认激活视图（files 默认显示，使 activeView() 非 null，outline 随文件打开刷新）
  setSidebarTab("files");
  // Git 域 UI 接线（SCM 工具栏 / 历史 / diff / 提交 / 分支，TD-007）
  wireGitUI();
  const searchInputEl = $("search-input") as HTMLInputElement;
  // 回车确认搜索；清空输入则清空搜索结果（并使进行中的搜索作废，避免旧结果回填）
  searchInputEl.addEventListener("input", () => {
    if (!searchInputEl.value.trim()) {
      executeSearch().catch(console.error);
    }
  });
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      executeSearch().catch(console.error);
    }
  });
  $("search-case").addEventListener("click", () => {
    searchCaseSensitive = !searchCaseSensitive;
    $("search-case").classList.toggle("active", searchCaseSensitive);
    if (searchInputEl.value.trim()) executeSearch().catch(console.error);
  });

  // 设置面板（P25-T09）——菜单栏右侧图标
  wireSettingsPanel();

  // 新建项目（文件菜单入口）
  $btn("new-project-close").addEventListener("click", closeNewProjectPanel);
  $btn("new-project-cancel").addEventListener("click", closeNewProjectPanel);
  $btn("new-project-create").addEventListener("click", () => createProject());
  $("new-project-browse").addEventListener("click", async () => {
    const p = await invoke<string | null>("pick_folder");
    if (p) {
      newProjectLocationEl.value = p;
      updateNewProjectPreview();
    }
  });
  newProjectNameEl.addEventListener("input", updateNewProjectPreview);
  newProjectLocationEl.addEventListener("input", updateNewProjectPreview);
  newProjectEnvTypeEl.addEventListener("change", updateNewProjectEnvFields);
  newProjectNameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createProject();
  });
  newProjectLocationEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") createProject();
  });
  newProjectModalEl.addEventListener("click", (e) => {
    if (e.target === newProjectModalEl) closeNewProjectPanel();
  });

  // 文件监听事件（增量刷新树）
  await listen<string[]>("fs-changed", (e) => {
    handleFsChanged(e.payload);
  });

  // 运行事件（流式输出）
  await listen<{ data: string }>("run-stdout", (e) => {
    for (const line of e.payload.data.split("\n")) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  });
  await listen<{ data: string }>("run-stderr", (e) => {
    for (const line of e.payload.data.split("\n")) appendOutputLine(outputEl, line, "stderr", gotoFromLink);
  });
  await listen<{ code: number | null }>("run-exit", (e) => {
    appendOutputLine(outputEl, `[进程退出 code=${e.payload.code ?? "null"}]`, "exit", gotoFromLink);
    running = false;
    runningPath = null;
    renderTabs();
  });

  // 包安装事件（流式输出，确认安装后由 pip_install 逐行推送）
  await listen<{ data: string }>("pip-stdout", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  });
  await listen<{ data: string }>("pip-stderr", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stderr", gotoFromLink);
  });

  // 工具链引导事件（Phase 4 第 4 步：uv/pyrefly 安装进度流式输出）
  await listen<{ data: string }>("toolchain-stdout", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  });
  await listen<{ data: string }>("toolchain-stderr", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stderr", gotoFromLink);
  });

  // 终端事件（P2-7 多会话）：按 id 分发到对应终端实例
  await wireTerminalEvents();

  // 首次启动环境引导（第 4 步）：缺失 uv/pyrefly 时弹窗引导一键安装
  await maybePromptToolchain();

  // 启动即自动恢复最近工作区；无记录则保持 Welcome 页
  await autoOpenRecentWorkspace();
  updateEditorOverlay();
}

init().catch((e) => console.error("init 失败", e));
