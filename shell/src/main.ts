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
import { formatPythonSource, optimizeImportsSource, registerRuffFormatter, setFormatErrorHandler } from "./format";
import { runSearch, cancelSearch, resetSearch, setOpenMatchHandler, type SearchMatch } from "./search";
import { registerSidebarView, setSidebarTab, activeView } from "./views";
import * as lsp from "./lsp/client";
import * as kb from "./keybindings";
import * as toolchain from "./toolchain";
import { appendOutputLine, clearOutput, RunTranscript, type OutputLink } from "./output";
import { openConfirm, openPrompt } from "./dialog";
import { app, $, $btn, outputEl, statusFileEl, type Entry, type Tab } from "./state";
import {
  createDirAt, createFileAt, isDirExpanded, isTreeEmpty, refreshTree, reloadDir,
  renderCtxMenu, resetTreeState, wireFileTree, type CtxItem,
} from "./fileTree";
import { refreshGitStatus, renderGitPanel, refreshBranchPanel, resetGitState, wireGitUI } from "./git";
import {
  disposeTerminal, openTerminalAt, runScriptInTerminal, setOutputPanelHooks,
  stopRunTerminal, wireBottomPanel, wireTerminalEvents,
} from "./termUi";
import { setTerminalLinkHandler } from "./terminal";
import { loadSettings, saveSettings, applyFontStatus, openSettingsPanel, wireSettingsPanel, buildEditorOptions } from "./settingsPanel";
import { checkFirstRunStorage } from "./storagePanel";
import { basename, codicon, DisposableStore, emptyState, joinPath, languageOf, parentDirOf, renderFileIcon, samePath, setBusy as utilSetBusy, spinIcon as utilSpinIcon, SNAKE_SVG, symbolIcon } from "./util";
import { restoreLayout, wireSplitters } from "./layout";
import { hideEl, motionDisabled, restoreReduceMotion, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { wireTooltip } from "./tooltip";
import { renderEngineChip, setEngineChipHandlers, wireEngineChip } from "./engineChip";
import { getRunMenuItems, renderRunWidget, setRunWidgetHandlers, setRunWidgetRepaint, wireRunWidget, type RunWidgetState } from "./runWidget";
import { clearRunGutter, isRunGutterLine, refreshRunGutter, setRunGutterHandlers, wireRunGutter } from "./runGutter";
import { wireGutterHover } from "./gutterHover";
import * as dap from "./dap/client";
import {
  breakpointKind, clearCurrentLine, getBreakpointSpec, pushAllBreakpoints, refreshDebugGutter,
  removeBreakpoint, setBreakpointMenuHandler, toggleBreakpoint, updateBreakpoint, wireDebugGutter,
} from "./debugGutter";
import { showMenu } from "./menu";
import { initTodoView, refreshTodos, resetTodoView, setTodoViewHandlers } from "./todoView"; // P0：TODO 工具窗
import { initDebugView, notifyDepFound, renderDebugView, runToCursor as runToCursorIn, setDebugViewHandlers, wireDebugViewEvents } from "./debugView";
import { closeRecentFiles, initRecentFiles, openRecentFiles, setRecentFilesHandlers } from "./recentFiles"; // P0：最近打开的文件（Ctrl+E）
// P1（PyCharm 调研）：Search Everywhere / 导航历史 / 本地历史 / 调试控制台
import {
  initQuickOpen, invalidateQuickOpenFiles, isQuickOpenOpen, openQuickOpen,
  registerQuickOpenActions, setQuickOpenHandlers, type QuickOpenAction,
} from "./quickOpen";
import { goBack, goForward, noteOpen, pushCurrent, resetNavHistory, setNavHistoryHandlers } from "./navHistory";
import { initLocalHistory, openLocalHistory, setLocalHistoryHandlers } from "./localHistory";
// P2
import {
  initBreadcrumbs, invalidateBreadcrumbs, resetBreadcrumbs, scheduleBreadcrumbs, setBreadcrumbHandlers,
} from "./breadcrumbs";
import { initDebugConsole, notifyNotPaused, openEvaluatePrompt } from "./debugConsole";
import { initInlineValues } from "./inlineValues";
import { lintActiveFile, resetRuffLint, scheduleRuffLint, setRuffLintHandlers } from "./ruffLint";
import {
  initBookmarks, loadBookmarks, openBookmarks, refreshBookmarkGutter,
  resetBookmarks, setBookmarkHandlers, toggleBookmarkAtCursor,
} from "./bookmarks";
import {
  finishRun, initRunHistory, openRunHistory, recordLines, resetRunHistory,
  setRunHistoryHandlers, startRun,
} from "./runHistory";
import { renderWelcomeShortcuts } from "./welcomeShortcuts"; // UI-25：欢迎页快捷键跟随键位系统
import { moveMenuFocus, wireMenuKeyNav } from "./menuKeys"; // UI-30：菜单键盘导航（与 menu.ts 共享同一套 APG 规则）
import * as mdPreview from "./markdownPreview"; // Markdown 预览（markdown preview dev plan）

// ---------- 模块级状态（本层私有） ----------

let liveTemplatesHandle: LiveTemplatesHandle | null = null;
/** 当前工作区解释器（null = uv run 兜底） */
let currentInterpreter: string | null = null;
/** 本轮会话是否已提示过 .venv 自动检测 */
const venvPrompted = new Set<string>();
let searchCaseSensitive = false;
let running = false;
/** CR-07：运行准备期闸门——检查与置位之间不得有 await，杜绝连按触发并发启动。
 * `running` 在 `prepareRun`（含保存、依赖预检、确认框）之后才置位，此前连点 Ctrl+F10
 * 会并发拉起两个 `run_script`，后端单实例槽被顶掉、状态错乱。 */
let runPreparing = false;
/** 当前正在运行的文件路径（用于 tab 上显示停止图标） */
let runningPath: string | null = null;
/** 选区运行的元信息：临时文件路径 → 源文件 + 起始行（traceback 跳转映射用） */
let selectionRunMeta: { tempPath: string; sourcePath: string; startLine: number } | null = null;
/** 本次运行的 stdin 模式（S2：EOFError 归因提示需要知道“是不是根本没接输入”；S4 增 interactive） */
let runningStdinMode: StdinMode = "null";
/** 本次运行是否已提示过 EOF 归因（一次运行只提示一次，避免多行 EOFError 刷屏） */
let runningStdinEofHinted = false;
/** 本次运行走哪条路径（S3/S4 统一运行态模型，§4.7 结论 3）：输出面板 or 运行终端。
 * 停止按钮 / tab 运行图标共用同一份 `running` 状态，按此路由到 stop_script 或 term_kill。 */
let runChannel: "output" | "terminal" | null = null;
/** 上次运行的路径与通道（「停止并重新运行」用）。resetRunState 不清，切换/关闭工作区清。 */
let lastRun: { path: string; channel: "output" | "terminal" } | null = null;
/** 运行输出转录器（S4）：把流式 chunk 还原成行——提示符立即可见，traceback 链接不被切碎 */
const runTranscript = new RunTranscript(outputEl, gotoFromLink);
/** 文件监听防抖定时器 */
let fsWatchTimer: number | undefined;
/** P1：Double Shift 的判定窗口（ms）——两次 Shift 抬起间隔超过它就不算双击 */
const DOUBLE_SHIFT_MS = 400;
/** UI-05：三个模态（环境面板 / 新建项目 / 运行配置）的焦点陷阱解除句柄，关闭时置 null */
let releaseEnvFocus: (() => void) | null = null;
let releaseNewProjectFocus: (() => void) | null = null;
let releaseRunConfigFocus: (() => void) | null = null;

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
const envPyprojectBannerEl = $("env-pyproject-banner");
const envPyprojectInitBtn = $btn("env-pyproject-init");
const newProjectModalEl = $("new-project-modal");
const newProjectNameEl = $("new-project-name") as HTMLInputElement;
const newProjectLocationEl = $("new-project-location") as HTMLInputElement;
const newProjectGitEl = $("new-project-git") as HTMLInputElement;
const newProjectEnvTypeEl = $("new-project-env-type") as HTMLSelectElement;
const newProjectVersionEl = $("new-project-version") as HTMLSelectElement;
const newProjectVersionRowEl = $("new-project-version-row");
const newProjectPreviewEl = $("new-project-preview");
const runConfigModalEl = $("run-config-modal");
const runConfigTargetEl = $("run-config-target");
const runConfigArgsEl = $("run-config-args") as HTMLInputElement;
const runConfigEnvEl = $("run-config-env") as HTMLTextAreaElement;
const runConfigStdinModeEl = $("run-config-stdin-mode") as HTMLSelectElement;
const runConfigStdinPathEl = $("run-config-stdin-path") as HTMLInputElement;
const runConfigStdinPathRowEl = $("run-config-stdin-path-row");
// S4：输出面板内的交互输入行（仅 running && stdin=interactive 时可见）
const runStdinRowEl = $("run-stdin-row");
const runStdinInputEl = $("run-stdin-input") as HTMLInputElement;
const runStdinStatusEl = $("run-stdin-status");

// ---------- 工作区 ----------

/** CR-13：编辑器防抖 timer 集中管理（原为 init() 局部闭包，工作区切换/关闭无法清理，
 * autosave 会在 tab 已 dispose 后触发，旧工作区未存修改被静默丢弃） */
const editorTimers = {
  change: undefined as number | undefined,
  outline: undefined as number | undefined,
  autosave: undefined as number | undefined,
  gutter: undefined as number | undefined,
  /** 全部 clearTimeout（切换/关闭工作区时调用，防旧工作区回调跨生命周期触发） */
  clearAll(): void {
    window.clearTimeout(this.change);
    window.clearTimeout(this.outline);
    window.clearTimeout(this.autosave);
    window.clearTimeout(this.gutter);
    this.change = this.outline = this.autosave = this.gutter = undefined;
  },
};

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
  editorTimers.clearAll();      // CR-13：防抖 timer 全清（autosave 不再跨工作区触发）
  app.pendingChanges.clear();   // CR-13：在途文档同步一并作废
  outlineToken++;               // CR-20：作废在途大纲请求
  runTranscript.discard();      // S4：先丢弃未完结行状态，否则会往已被清空的游离元素里写
  clearOutput(outputEl);        // 输出面板（运行输出 / traceback）
  resetGitState();              // git 状态 + diff 视图 + 分支列表
  outlineEl.textContent = "";   // 大纲符号树
  resetSearch();                // 搜索结果 + 作废在途请求
  resetTodoView();              // P0：TODO 列表 + 作废在途扫描
  resetNavHistory();            // P1：导航历史（跨工作区的历史没有意义）
  invalidateQuickOpenFiles();   // P1：工作区文件清单缓存随工作区失效
  resetBreadcrumbs();           // P2：面包屑（含符号缓存与防抖 timer）
  resetRuffLint();              // P2：ruff lint（防抖 timer + 在途请求）
  resetBookmarks();             // P2：书签（列表缓存 + gutter 装饰）
  resetRunHistory();            // P2：运行历史
  resetEnvPackages();           // 环境包面板状态
  pkgToken++;                   // CR-20：作废在途包列表请求
  currentInterpreter = null;    // 防切换瞬间误用旧解释器
  venvPrompted.clear();
  ($("search-input") as HTMLInputElement).value = ""; // 清空搜索关键词
  // S4：运行态与交互输入行一并复位（旧运行已由 teardownCurrent 停止）
  runStdinInputEl.value = "";
  resetRunState();
  lastRun = null; // 「停止并重新运行」的目标随工作区切换作废
  clearRunGutter(); // C5：切换/关闭工作区清空 gutter ▶
  clearCurrentLine(); // D4：清调试当前行高亮
  renderDebugView(); // D4：调试侧栏复位到 idle 呈现
}

/** 清理当前工作区（关闭标签 + 停 LSP + 销毁终端）；有未保存修改时先确认，取消则返回 false */
async function teardownCurrent(): Promise<boolean> {
  if (app.workspaceRoot) {
    if (app.tabs.some((t) => t.dirty) && !(await openConfirm({ message: "存在未保存的修改，继续将丢失，确认关闭工作区？", kind: "danger" }))) {
      return false;
    }
    // S3/S4：切换/关闭工作区前先停掉在跑的脚本（按 runChannel 路由，两条路径都覆盖）。
    // 否则后端进程会变成孤儿继续跑，而前端运行态随后被 resetWorkspaceUiState 复位，
    // 用户就再也没有停止入口了（统一运行态模型要求「状态与进程同生共死」）。
    if (running) await stopRun();

    // 调试会话同理（§8 坑 7）：关闭工作区必须停调试，否则 debugpy 进程树成孤儿。
    if (dap.currentPhase() !== "idle" && dap.currentPhase() !== "exited") {
      await dap.stopDebug();
      dap.resetDebugState();
    }

    // CR-30：teardown 计时改 console.debug（绕过日志系统的 console.log 清理；release 默认不显示）
    let t0 = performance.now();
    console.debug("[teardown] closeTabs begin, tabs=", app.tabs.length);
    for (const t of [...app.tabs]) closeTabSilent(t);
    console.debug("[teardown] closeTabs done, took=", (performance.now() - t0).toFixed(0), "ms");

    t0 = performance.now();
    console.debug("[teardown] lsp.stopEngine begin");
    await lsp.stopEngine();
    console.debug("[teardown] lsp.stopEngine done, took=", (performance.now() - t0).toFixed(0), "ms");

    t0 = performance.now();
    console.debug("[teardown] disposeTerminal begin");
    await disposeTerminal();
    console.debug("[teardown] disposeTerminal done, took=", (performance.now() - t0).toFixed(0), "ms");
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
  // P2：书签按工作区持久化，换工作区要重新加载（并刷新 gutter 装饰）
  await loadBookmarks();
  refreshBookmarkGutter();
  // Markdown 预览：动态授权 asset 协议读取当前工作区根（本地图片渲染）
  await invoke("allow_asset_dir", { path: root }).catch(console.error);
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
  const t0 = performance.now();
  console.debug("[closeWorkspace] stopFileWatcher begin");
  await stopFileWatcher();
  console.debug("[closeWorkspace] stopFileWatcher done, took=", (performance.now() - t0).toFixed(0), "ms");
  resetWorkspaceUiState();
  closeRecentFiles(); // 最近文件是工作区级的，切换工作区后旧列表不应还能被打开
  app.workspaceRoot = null;
  resetTreeState();
  $("tree-header-text").textContent = "文件"; // UI-13：与 index.html 的静态文案保持一致（分组标题统一中文）
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
  // UI-25：覆盖层要显示了才重绘快捷键网格（改键后 / 设置加载完成后经此路径刷新为真实键位）
  renderWelcomeShortcuts();

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
    // UI-09：整行与行内「×」按钮同轨迁到 data-tip。原生 title 会沿祖先链继承解析，
    // 若父行保留 title、子按钮改用 data-tip，悬停按钮时两个提示会同时出现。
    item.dataset.tip = p;
    item.addEventListener("click", () => openWorkspace(p).catch(console.error));
    // 单条删除（× 按钮，hover 时显示）
    const remove = document.createElement("button");
    remove.className = "ew-recent-remove";
    remove.dataset.tip = "从列表移除";
    // 图标按钮：内部 <i> 带 aria-hidden，可访问名称原先仅由 title 提供，须同步补 aria-label
    remove.setAttribute("aria-label", "从列表移除");
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
  /** pyproject.toml 生成说明（uv 官方脚手架 or 模板回退，P2 建议 1） */
  pyproject_note: string;
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
  releaseNewProjectFocus?.();
  releaseNewProjectFocus = trapFocus(newProjectModalEl);
  newProjectNameEl.focus();
}

function closeNewProjectPanel(): void {
  releaseNewProjectFocus?.();
  releaseNewProjectFocus = null;
  hideEl(newProjectModalEl);
}

/** 根据环境类型显隐版本/位置行（仅 venv 需要） */
function updateNewProjectEnvFields(): void {
  const isVenv = newProjectEnvTypeEl.value === "venv";
  newProjectVersionRowEl.classList.toggle("hidden", !isVenv);
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
  const createBtn = $btn("new-project-create");
  setBusy(createBtn, true, "创建中…");

  let result: CreateProjectResult;
  try {
    result = await invoke<CreateProjectResult>("create_project", {
      parentDir: parent,
      name,
      gitInit: wantGit,
      pythonVersion: version || null, // P2（建议 1）：所选版本写入 pyproject.toml 的 requires-python
    });
  } catch (e) {
    newProjectPreviewEl.textContent = `创建失败：${e}`;
    setBusy(createBtn, false);
    return;
  }
  if (!result.git_ok) {
    appendOutputLine(outputEl, `git init 失败（项目已创建）：${result.git_message}`, "stderr", gotoFromLink);
  }
  // P2（建议 1）：回显 pyproject.toml 的生成路径（uv 脚手架 / 模板回退），让“裸目录 uv run 语义不明”可见地收敛
  if (result.pyproject_note) {
    appendOutputLine(outputEl, result.pyproject_note, "stdout", gotoFromLink);
  }
  await openWorkspace(result.path);
  await openFile(joinPath(result.path, "main.py"));

  try {
    if (envType === "venv") {
      appendOutputLine(outputEl, `> uv venv .venv${version ? " --python " + version : ""}  (${result.path})`, "cmd", gotoFromLink);
      setBusy(createBtn, true, "创建环境…");
      const r = await invoke<CreateVenvResult>("create_venv", { workspaceRoot: result.path, version });
      if (r.output) appendOutputLine(outputEl, r.output, "stdout", gotoFromLink);
      if (r.python) await invoke("set_interpreter", { workspaceRoot: result.path, path: r.python }).catch(console.error);
    } else if (envType === "system") {
      const interp = await invoke<string | null>("pick_default_system_interpreter");
      if (interp) {
        await invoke("set_interpreter", { workspaceRoot: result.path, path: interp }).catch(console.error);
        appendOutputLine(outputEl, `已选用系统解释器：${interp}`, "stdout", gotoFromLink);
      } else {
        // P1（建议 4）：未检测到解释器时给出可执行引导，而非静默兜底
        appendOutputLine(
          outputEl,
          "未检测到已安装的 Python 解释器，可任选其一：\n" +
            "  1) 用 uv 安装托管 Python（环境面板或终端执行：uv python install 3.13）\n" +
            "  2) 手动指定已安装的 python 可执行文件路径（环境面板 → 解释器）\n" +
            "  在完成前将使用 uv run 兜底运行（首次运行可能联网下载 Python）。",
          "stderr",
          gotoFromLink,
        );
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
  // live templates M1 重构：重读用户/工作区配置并重建 registry
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
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
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
  // P3（建议 2）：Python 脚本可编辑持久化运行配置（Parameters / 环境变量）
  // S3（建议 4）：新增「在终端中运行」——真 TTY 才能满足 getpass / tqdm / rich / 彩色 / Ctrl+C（坑 3）
  if (isPy) {
    items.splice(
      5,
      0,
      { label: "运行", action: () => void runActive() },
      { label: "在终端中运行", action: () => void runActiveInTerminal() },
      { label: "运行配置…", action: () => void openRunConfig(tab.path) },
      { sep: true },
    );
  }
  // Markdown 预览（markdown preview dev plan §5-T4）：.md tab 右键开关分栏预览
  if (mdPreview.isMarkdownPath(tab.path)) {
    const open = mdPreview.isPreviewOpen();
    items.splice(
      5,
      0,
      { label: open ? "关闭预览" : "打开预览", action: () => mdPreview.setPreviewOpen(!open) },
      { sep: true },
    );
  }
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
    // P1：文件增删后作废 Search Everywhere 的文件清单缓存（下次打开重新拉取）
    invalidateQuickOpenFiles();
    // Live Templates 热重载：用户层（<data_root>/config，watcher 附加监听）或工作区层配置变更（M2）
    if (
      dirs.some((d) => {
        const n = d.toLowerCase().replace(/\\/g, "/");
        return n.endsWith(".opencharm") || n.endsWith("opencharm/config") || n.endsWith("/config");
      })
    )
      await loadTemplatesConfig();
  }, 200);
}

// ---------- Python 环境管理（P25-T05） ----------

interface PythonInfo { path: string; version: string; kind: string; is_selected: boolean }
interface PackageInfo { name: string; version: string }
interface PythonVersionOption { version: string; spec: string; path: string | null; installed: boolean }
interface OutdatedInfo { name: string; version: string; latest: string; filetype: string }
interface CreateVenvResult { output: string; python: string }
/** P3（建议 2）：脚本运行配置（持久化到工作区配置，不侵入项目） */
interface EnvVar { key: string; value: string }
/** stdin 来源：
 * - "null" 不接输入（历史行为，也是**默认**——坑 2 铁律：piped 无人写入会永久阻塞）
 * - "file" 重定向自文件（S1，可复现）
 * - "interactive" 输出面板交互（S4，用户在输入行逐行应答） */
type StdinMode = "null" | "file" | "interactive";
interface StdinConfig { mode: StdinMode; path: string }
interface RunConfig { args: string; env: EnvVar[]; stdin: StdinConfig }

/** 缺省运行配置（与后端 RunConfig::default 一致） */
const EMPTY_RUN_CONFIG: RunConfig = { args: "", env: [], stdin: { mode: "null", path: "" } };

/** 归一化后端返回的 stdin 模式：与后端 `StdinConfig::effective_mode()` 同口径
 * （选了 file 却没给路径 → 视作 null；存量配置无该字段 → null） */
function stdinModeOf(rc: Partial<RunConfig> | undefined): StdinMode {
  const m = rc?.stdin?.mode;
  if (m === "file") return rc?.stdin?.path?.trim() ? "file" : "null";
  return m === "interactive" ? "interactive" : "null";
}

/** 环境面板包列表状态 */
let currentPackages: PackageInfo[] = [];
let outdatedPackages: Map<string, OutdatedInfo> = new Map();
let selectedPkgs: Set<string> = new Set();

/** 按钮忙碌态：内联转圈 + 禁用——CR-27 已收敛到 util.ts（此处再导出供本文件旧调用点使用） */
const setBusy = utilSetBusy;

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
  // P1（建议 2）：状态栏升级为“解释器来源 + 版本”（(.venv) 3.13.x / uv run），运行前即可感知用哪套环境。
  let label: string;
  if (currentInterpreter) {
    const short = shortInterpreter(currentInterpreter);
    const srcTag = short === ".venv" ? "(.venv)" : short;
    let ver = "";
    try {
      ver = await invoke<string>("interpreter_version", { path: currentInterpreter });
    } catch {
      ver = ""; // 版本查询失败降级为仅显示来源，不阻断
    }
    label = ver ? `${srcTag} ${ver}` : srcTag;
  } else {
    label = "uv run";
  }
  const snake = document.createElement("span");
  snake.className = "status-snake";
  snake.innerHTML = SNAKE_SVG; // 常量 SVG
  statusInterpreterEl.replaceChildren(snake, ` ${label}`);
}

async function openEnvPanel(): Promise<void> {
  if (!app.workspaceRoot) return;
  showEl(envModalEl);
  // UI-30：解释器芯片（aria-haspopup=dialog）的开合态，与 envModal 显隐同源切换（第七批留给本批的待办）
  statusInterpreterEl.setAttribute("aria-expanded", "true");
  releaseEnvFocus?.();
  releaseEnvFocus = trapFocus(envModalEl);
  await renderEnvPanel();
}

function closeEnvPanel(): void {
  releaseEnvFocus?.();
  releaseEnvFocus = null;
  hideEl(envModalEl);
  statusInterpreterEl.setAttribute("aria-expanded", "false"); // UI-30
}

async function renderEnvPanel(): Promise<void> {
  if (!app.workspaceRoot) return;
  let pythons: PythonInfo[] = [];
  try {
    pythons = await invoke<PythonInfo[]>("list_pythons", { workspaceRoot: app.workspaceRoot });
  } catch (e) {
    console.error("list_pythons 失败", e);
  }

  // P2（建议 5）：裸目录（无 pyproject.toml）时显示横幅，一键幂等生成，收敛 uv run 语义
  try {
    const has = await invoke<boolean>("has_pyproject", { workspaceRoot: app.workspaceRoot });
    envPyprojectBannerEl.classList.toggle("hidden", has);
  } catch {
    envPyprojectBannerEl.classList.add("hidden");
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
    empty.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（样式不变）
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

/** P2（建议 5）：为裸目录一键生成最小 pyproject.toml（幂等，已存在则不覆盖） */
async function generatePyproject(): Promise<void> {
  if (!app.workspaceRoot) return;
  setBusy(envPyprojectInitBtn, true, "生成中…");
  try {
    const msg = await invoke<string>("init_pyproject", { workspaceRoot: app.workspaceRoot });
    appendOutputLine(outputEl, msg, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `生成 pyproject.toml 失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(envPyprojectInitBtn, false);
  await renderEnvPanel(); // 重新检测 → 横幅消失
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
  line.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（此处是加载态提示）
  line.appendChild(utilSpinIcon());
  line.append(` ${msg}`);
  envPackagesEl.appendChild(line);
}

/** 渲染包行（复用：首次快速渲染无 outdated 标记，后台补齐 outdated 后再渲染一次） */
function renderPkgLines(): void {
  envPackagesEl.textContent = "";
  if (currentPackages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（样式不变）
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
      // UI-09：这两个按钮的 className 本身就是 codicon（无内部 <i>、无任何文本内容），
      // 可访问名称此前完全依赖 title，迁移后必须由 aria-label 承担，否则读屏读到空按钮。
      upBtn.dataset.tip = `升级 ${p.name} 到 ${od.latest}`;
      upBtn.setAttribute("aria-label", `升级 ${p.name} 到 ${od.latest}`);
      upBtn.addEventListener("click", () => { void upgradePackage(p.name); });
      actions.append(upBtn);
    }
    const rmBtn = document.createElement("button");
    rmBtn.className = "codicon codicon-trash danger";
    rmBtn.dataset.tip = `卸载 ${p.name}`;
    rmBtn.setAttribute("aria-label", `卸载 ${p.name}`);
    rmBtn.addEventListener("click", () => { void uninstallPackages([p.name]); });
    actions.append(rmBtn);
    line.append(actions);

    envPackagesEl.appendChild(line);
  }
  updatePkgToolbar();
}

/** CR-20：包列表刷新令牌——快速切解释器时，解释器 A 的 outdated 不得标到 B 的包上 */
let pkgToken = 0;

async function renderPackages(): Promise<void> {
  updatePkgToolbar();
  if (!currentInterpreter) {
    envPackagesEl.textContent = "";
    const empty = document.createElement("div");
    empty.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（样式不变）
    empty.textContent = "选择解释器后查看已安装包";
    envPackagesEl.appendChild(empty);
    currentPackages = [];
    outdatedPackages.clear();
    selectedPkgs.clear();
    updatePkgToolbar();
    return;
  }
  const interp = currentInterpreter;
  const token = ++pkgToken;
  renderPkgLoading("正在加载已安装包…");
  // 先快速加载已装包并渲染：outdated 查询可能联网较慢，后台补齐不阻塞列表展示
  const pkgs = await invoke<PackageInfo[]>("list_packages", { interpreter: interp }).catch(() => [] as PackageInfo[]);
  if (token !== pkgToken || currentInterpreter !== interp) return; // 已切解释器，丢弃旧结果
  currentPackages = pkgs;
  selectedPkgs = new Set([...selectedPkgs].filter((n) => pkgs.some((p) => p.name === n)));
  renderPkgLines();

  const outdated = await invoke<OutdatedInfo[]>("list_outdated", { interpreter: interp }).catch(() => [] as OutdatedInfo[]);
  if (token !== pkgToken || currentInterpreter !== interp) return;
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
    const r = await invoke<CreateVenvResult>("create_venv", { workspaceRoot: app.workspaceRoot, version });
    if (r.output) appendOutputLine(outputEl, r.output, "stdout", gotoFromLink);
    // 直接以创建出的解释器路径持久化选中（不依赖 .venv 自动检测）
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
    console.debug(`[opencharm-install] 环境面板安装结束 code=${code} spec=${spec}`);
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
  console.debug(`[opencharm-install] 请求安装 pkg=${pkg} spec=${spec}`);
  if (!currentInterpreter) {
    console.debug("[opencharm-install] 未选择解释器，中止");
    appendOutputLine(outputEl, "尚未选择解释器，无法自动安装包（点状态栏解释器图标选择后再试）", "stderr", gotoFromLink);
    return;
  }
  // 询问确认（对照 PyCharm 的安装确认框）
  const proceed = await openConfirm({
    title: "安装包",
    message: `将安装 "${spec}" 到当前解释器：\n${currentInterpreter}\n\n是否继续？`,
    okLabel: "安装", cancelLabel: "取消", kind: "primary",
  });
  console.debug(`[opencharm-install] 确认结果=${proceed}`);
  if (!proceed) {
    appendOutputLine(outputEl, `已取消安装 ${spec}`, "stderr", gotoFromLink);
    return;
  }

  appendOutputLine(outputEl, `> uv pip install ${spec}  (${shortInterpreter(currentInterpreter)})`, "cmd", gotoFromLink);
  console.debug("[opencharm-install] 开始 pip_install invoke");
  try {
    const code = await invoke<number>("pip_install", { workspaceRoot: app.workspaceRoot, interpreter: currentInterpreter, spec });
    console.debug(`[opencharm-install] pip_install 结束 code=${code}`);
    if (code === 0) {
      appendOutputLine(outputEl, `已安装 ${spec}，重新检查诊断…`, "stdout", gotoFromLink);
      await startLsp();
    } else {
      appendOutputLine(outputEl, `安装失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
    }
  } catch (e) {
    console.debug("[opencharm-install] 安装异常:", e);
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

/** CR-20：本批大纲符号所属 tab（点击回调校验用，渲染时记录） */
let outlineOwnerTab: Tab | null = null;

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
      // CR-20：响应渲染时所在 tab 已可能被切换，点击前校验仍在该 tab 才跳转
      if (app.activeTab !== outlineOwnerTab) return;
      app.editor.setPosition({ lineNumber: line, column: 1 });
      app.editor.revealLineInCenter(line);
      app.editor.focus();
    });
    container.appendChild(item);
    if (s.children?.length) renderOutlineSymbols(container, s.children, depth + 1);
  }
}

/** CR-20：大纲刷新令牌——响应乱序时旧结果不得覆盖新结果（照搬 search.ts 的令牌模式） */
let outlineToken = 0;

async function refreshOutline(): Promise<void> {
  if (!app.activeTab) {
    outlineEl.textContent = "";
    return;
  }
  const tab = app.activeTab;
  const token = ++outlineToken;
  const symbols = await lsp.documentSymbols(tab.path);
  if (token !== outlineToken) return; // 已有更新一轮的请求（或工作区已切换），丢弃旧结果
  outlineOwnerTab = tab; // CR-20：记录本批符号所属 tab
  outlineEl.textContent = "";
  if (symbols.length === 0) {
    outlineEl.appendChild(emptyState("symbol-misc", "无符号", undefined, true));
    return;
  }
  renderOutlineSymbols(outlineEl, symbols, 0);
}

/** CR-13：串行冲刷待同步的文档变更——changeTimer 回调与补全前钩子共用。
 * 原来 for 循环内并发 fire-and-forget 多条 didChangeFull，invoke 到达顺序不保证 →
 * version 乱序，引擎文档状态错乱。此处逐条 await 保证 version 单调递增送达。 */
async function syncPendingChanges(): Promise<void> {
  for (const path of [...app.pendingChanges]) {
    const t = app.tabs.find((x) => x.path === path);
    if (t) {
      await lsp.didChangeFull(path, t.model);
    }
    app.pendingChanges.delete(path);
  }
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

/** CR-24：LSP provider 注册句柄集中管理（应用生命周期；startLsp 重建时 dispose 再注册） */
const lspProviders = new DisposableStore();

/** CR-08：openFile 进行中去重表（path → 未完成的打开 Promise），防并发双开同文件 */
const openFileInflight = new Map<string, Promise<void>>();

export async function openFile(path: string, revealLine?: number): Promise<void> {
  // CR-08：in-flight 去重——双击/多入口并发打开同一文件时，两次调用都查不到 tab、
  // 都进 read_file → createModel 对重复 URI 返回既有 model → 两 Tab 持同一 model，
  // closeTabSilent dispose 掉另一个仍在用的 model。以 path 为键串行化，
  // 后续调用 await 同一个 Promise（含 gotoFromLink / openSearchMatch / restartRun 双击路径）。
  const inflight = openFileInflight.get(path);
  if (inflight) {
    await inflight;
    await revealAfterOpen(path, revealLine);
    return;
  }
  const p = doOpenFile(path, revealLine);
  openFileInflight.set(path, p);
  try {
    await p;
  } finally {
    openFileInflight.delete(path);
  }
}

/** CR-08：openFile 的实际执行体（由 in-flight 去重表保证同一 path 串行） */
async function doOpenFile(path: string, revealLine?: number): Promise<void> {
  // P1：导航历史——先记「离开前的位置」，末尾记「到达的位置」，后退才能回到出发点
  pushCurrent();
  let tab = app.tabs.find((t) => t.path === path);
  if (!tab) {
    const content = await invoke<string>("read_file", { path });
    // CR-08：并发防线二——创建前再查既有 model 命中则复用（防其它入口已建）
    const uri = app.monaco.Uri.file(path);
    const model = app.monaco.editor.getModel(uri) ?? app.monaco.editor.createModel(content, languageOf(path), uri);
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
  revealAfterOpen(path, revealLine);
  // P1：记录到达位置（未指定行时取编辑器当前行，与用户所见一致）
  noteOpen(path, revealLine ?? app.editor.getPosition()?.lineNumber ?? 1);
}

/** CR-08：打开完成后按需跳行（去重等待路径也要走，故独立成函数） */
function revealAfterOpen(path: string, revealLine?: number): void {
  if (revealLine === undefined) return;
  const tab = app.tabs.find((t) => t.path === path);
  if (tab && app.activeTab === tab) {
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
  refreshRunGutter(); // C5：切换 tab 重算 __main__ 守卫行的 ▶
  refreshDebugGutter(); // D3：切换 tab 重算断点红点
  scheduleBreadcrumbs(); // P2：面包屑跟随激活文件
  refreshBookmarkGutter(); // P2：书签标记跟随激活文件
  void lintActiveFile(); // P2：ruff 实时 lint（切 tab 立即跑，不等防抖）
  mdPreview.updatePreviewVisibility(); // Markdown 预览：切换 tab 后按「是否 md + 开关」刷新显隐
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
  lsp.discardCachedDiagnostics(tab.path); // CR-22：关文件即释放诊断缓存
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
  refreshRunGutter(); // C5：关闭 tab 后重算/清空 ▶
  refreshDebugGutter(); // D3：关闭 tab 后重算/清空断点红点
  mdPreview.updatePreviewVisibility(); // Markdown 预览：关闭 tab 后刷新显隐
}

export function renderTabs(): void {
  // UI-16：重绘会销毁正在聚焦的 tab 元素，先记录焦点、渲染后按路径恢复，
  // 否则键盘用户每次激活/关闭标签后焦点都掉回 body（与 termUi 终端 tab 同款处理）。
  // 用 closest(".tab")：焦点也可能在 tab 内部的关闭按钮上
  const focusedPath = tabbarEl.contains(document.activeElement)
    ? ((document.activeElement as HTMLElement | null)?.closest(".tab") as HTMLElement | null)?.dataset?.path ?? null
    : null;
  tabbarEl.textContent = "";
  for (const t of app.tabs) {
    const active = t === app.activeTab;
    const el = document.createElement("div");
    el.className = `tab ${active ? "active" : ""}`;
    // UI-16：tabs 模式（#tabbar 的 role=tablist 在 index.html 静态声明）。
    // 所有 tab 共享同一个 Monaco 面板，故不设 aria-controls/tabpanel（与事实不符的声明不如不声明）；
    // 漫游 tabindex：激活项 0、其余 -1；←→ 在 tab 间移动焦点，Enter/Space 激活。
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.tabIndex = active ? 0 : -1;
    el.dataset.path = t.path;
    el.appendChild(renderFileIcon(basename(t.path))); // D2 P-08：标签页文件类型图标
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = basename(t.path);
    const dirty = document.createElement("span");
    dirty.className = "dirty";
    if (t.dirty) dirty.appendChild(codicon("circle-filled"));
    const isRunningHere = running && t.path === runningPath;
    // UI-16：脏标记/运行指示的圆点是纯视觉装饰（aria-hidden），状态并入 tab 的可访问名称，
    // 读屏聚焦该 tab 时直接听到「已修改 / 运行中」（承接 UI-09 对 .tab-running 的遗留说明）
    const labelParts = [basename(t.path)];
    if (t.dirty) labelParts.push("已修改");
    if (isRunningHere) labelParts.push("运行中");
    el.setAttribute("aria-label", labelParts.join("，"));
    // 被动运行指示（C3）：动作已集中到菜单栏运行组，tab 只显示状态（不可点，避免第二个动作入口）
    const close = document.createElement("span");
    close.className = "close";
    close.appendChild(codicon("close"));
    // UI-16：span 充当按钮 → 补 role/aria-label/tabindex + Enter/Space 键盘激活（第四批待办同款）
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", `关闭 ${basename(t.path)}`);
    close.tabIndex = 0;
    close.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // 不冒泡到 tab 本体的 Enter/方向键处理
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        void closeTab(t);
      }
    });
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeTab(t);
    });
    if (isRunningHere) {
      const ind = document.createElement("span");
      ind.className = "tab-running";
      ind.setAttribute("aria-hidden", "true"); // UI-16：运行态已并入 tab 的 aria-label
      const spin = codicon(motionDisabled() ? "circle-filled" : "loading");
      if (!motionDisabled()) spin.classList.add("codicon-modifier-spin");
      ind.appendChild(spin);
      // UI-09：删除死代码。.tab .tab-running 带 pointer-events:none（被动指示，动作集中在菜单栏运行组），
      // 浏览器命中测试不会落到它身上，原生 title 从来不显示；改 data-tip 同样无效（委托依赖 mouseover 命中）。
      el.append(name, dirty, ind, close);
    } else {
      el.append(name, dirty, close);
    }
    el.addEventListener("click", () => activateTab(t));
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activateTab(t);
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        const tabs = Array.from(tabbarEl.querySelectorAll<HTMLElement>(".tab"));
        if (tabs.length < 2) return;
        const dir = ev.key === "ArrowRight" ? 1 : -1;
        tabs[(tabs.indexOf(el) + dir + tabs.length) % tabs.length].focus();
      }
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showTabContextMenu(t, ev.clientX, ev.clientY);
    });
    tabbarEl.appendChild(el);
  }
  // UI-16：焦点恢复（原焦点 tab 已被关闭时落到激活项，与鼠标行为一致）
  if (focusedPath) {
    const target =
      tabbarEl.querySelector<HTMLElement>(`.tab[data-path="${CSS.escape(focusedPath)}"]`) ??
      tabbarEl.querySelector<HTMLElement>(".tab.active");
    target?.focus();
  }
  // 运行组按钮随 tab / 运行态一起重绘（renderTabs 覆盖了大多数状态变化点）
  renderRunWidget(runWidgetState());
}

/** Optimize Imports（P0，Ctrl+Alt+O）：整理当前 Python 文件的导入（排序 + 删无用）。 */
async function optimizeImportsActive(): Promise<void> {
  const tab = app.activeTab;
  if (!tab) return;
  if (!tab.path.endsWith(".py") && !tab.path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `Optimize Imports 仅支持 Python 文件：${tab.path}`, "stderr", gotoFromLink);
    return;
  }
  const before = tab.model.getValue();
  const optimized = await optimizeImportsSource(tab.path, before);
  if (optimized === null || optimized === before) return; // 失败已由 format 域提示；无改动则不动模型
  tab.model.setValue(optimized); // 单次 setValue → Ctrl+Z 可整体撤销
  appendOutputLine(outputEl, `已整理导入：${basename(tab.path)}`, "stdout", gotoFromLink);
}

async function saveActive(): Promise<void> {
  if (!app.activeTab) return;
  const isPy = app.activeTab.path.endsWith(".py") || app.activeTab.path.endsWith(".pyw");
  // 保存时整理导入（ruff I,F401，设置开关）：**先整理后格式化**——ruff format 不重排导入，
  // 二者正交，此顺序与 PyCharm 的「Optimize Imports → Reformat」一致。失败不阻断保存。
  if (app.settings.optimize_imports_on_save && isPy) {
    const optimized = await optimizeImportsSource(app.activeTab.path, app.activeTab.model.getValue());
    if (optimized !== null && optimized !== app.activeTab.model.getValue()) {
      app.activeTab.model.setValue(optimized); // 单次 setValue → Ctrl+Z 可整体撤销
    }
  }
  // 保存时格式化（ruff，设置开关）：失败不阻断保存
  if (app.settings.format_on_save && isPy) {
    const formatted = await formatPythonSource(app.activeTab.path, app.activeTab.model.getValue());
    if (formatted !== null && formatted !== app.activeTab.model.getValue()) {
      app.activeTab.model.setValue(formatted); // 单次 setValue → Ctrl+Z 可整体撤销
    }
  }
  // P1：本地历史——**写盘前**留一版快照（content 传 null = 后端读磁盘，落的是保存前的内容）。
  // 失败只记日志：历史是兜底能力，绝不阻断保存（与 ruff 缺席不阻断格式化的策略一致）。
  await snapshotHistory(app.activeTab.path);
  await invoke("write_file", { path: app.activeTab.path, content: app.activeTab.model.getValue() });
  app.activeTab.dirty = false;
  renderTabs();
  // 保存通知（引擎常在保存时触发完整重新检查）
  lsp.didSave(app.activeTab.path, app.activeTab.model);
}

/** 本地历史快照（保存前自动留痕）；无工作区时静默跳过 */
async function snapshotHistory(path: string, content: string | null = null): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("history_snapshot", {
      workspaceRoot: app.workspaceRoot,
      path,
      content,
      kind: "save",
    });
  } catch (e) {
    console.warn("[history] 保存快照失败", e);
  }
}

/** 从磁盘重新加载文件到编辑器（本地历史回滚后刷新内容用） */
async function reloadFileFromDisk(path: string): Promise<void> {
  const tab = app.tabs.find((t) => t.path === path);
  if (!tab) return;
  const content = await invoke<string>("read_file", { path });
  tab.model.setValue(content);
  tab.dirty = false;
  renderTabs();
  await lsp.didChangeFull(path, tab.model);
}

// ---------- 运行 ----------
//
// 两条运行路径共用一套「运行态」（§4.7 结论 3，S3/S4 首版单实例）：
// - **输出面板**（runActive → `lsp::run_script`）：默认路径，traceback 天然可点击；
//   stdin=interactive（S4）时输出面板下方亮出输入行，用户逐行应答。
// - **运行终端**（runActiveInTerminal → `terminal::run_in_terminal`）：真 TTY，覆盖
//   getpass / tqdm / rich / 彩色输出 / Ctrl+C（坑 3：管道模式下 isatty() 为假，这些全都退化）。
// `running` / `runningPath` / 停止按钮 / tab 运行图标对两条路径一致，按 `runChannel` 路由停止动作。

/** 运行前公共准备的产物 */
interface RunPrep {
  /** 归一化后的 stdin 模式（决定回显后缀 / 输入行可见性 / EOF 归因口径） */
  stdinMode: StdinMode;
  /** 运行回显行：`> [venv] <解释器> <脚本> <args> < <file>  (<路径>)` */
  echo: string;
}

/** 运行前公共准备：Python 文件校验 → 自动保存 → 依赖预检 → 读运行配置 → 组装回显。
 * 返回 null 表示不应运行（不是 Python 文件，或用户在预检对话框里选了取消）。
 * 两条运行路径共用，避免「预检只在输出面板路径生效」这类漂移。 */
async function prepareRun(path: string): Promise<RunPrep | null> {
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return null;
  }
  if (app.activeTab?.dirty) await saveActive(); // 运行前自动保存
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
      if (!proceed) return null;
    }
  }
  // P3：读取持久化的运行配置（后端同样读取并应用，此处仅为运行前显式化 + 决定 stdin 形态）
  const rc = app.workspaceRoot
    ? await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path }).catch(() => ({} as Partial<RunConfig>))
    : ({} as Partial<RunConfig>);
  // S1/S4：记下本次运行的 stdin 模式（回显后缀 + S2 的 EOF 归因 + 输入行可见性都依赖它）
  const stdinMode = stdinModeOf(rc);
  const args = rc.args?.trim() ?? "";
  const argsSuffix = args ? ` ${args}` : "";
  const stdinSuffix =
    stdinMode === "file" ? ` < ${rc.stdin?.path}` : stdinMode === "interactive" ? "  [交互输入]" : "";
  // P1（建议 2）：回显含来源前缀（[venv]/[system]/[uv run]）+ 实际解释器完整路径，
  // 让用户运行前明确知道“这次用哪套环境跑”。
  const source = currentInterpreter
    ? shortInterpreter(currentInterpreter) === ".venv"
      ? "venv"
      : "system"
    : "uv run";
  const cmd = currentInterpreter
    ? `${currentInterpreter} ${basename(path)}${argsSuffix}${stdinSuffix}`
    : `uv run ${basename(path)}${argsSuffix}${stdinSuffix}`;
  return { stdinMode, echo: `> [${source}] ${cmd}  (${path})` };
}

/** 复位运行态（两条路径共用：run-exit / 运行终端退出 / 启动失败 / 停止都走这里）。
 * CR-05：选区运行的临时文件在复位时删除（run-exit / 停止 / 失败全路径覆盖），meta 一并清空。 */
function resetRunState(): void {
  running = false;
  runningPath = null;
  runChannel = null;
  runningStdinMode = "null";
  runningStdinEofHinted = false;
  cleanupSelectionRunMeta();
  syncRunStdinRow();
  renderTabs();
}

/** CR-05：清理选区运行临时文件与元信息（幂等；失败仅提示不阻断状态复位） */
function cleanupSelectionRunMeta(): void {
  const meta = selectionRunMeta;
  selectionRunMeta = null;
  if (!meta) return;
  invoke("delete_file", { path: meta.tempPath }).catch((e) => {
    appendOutputLine(outputEl, `清理选区临时文件失败（可手工删除）: ${meta.tempPath} — ${e}`, "hint", gotoFromLink);
  });
}

/** 组装运行组状态（从现有模块级状态 + app 派生，不新增第二份真值） */
function runWidgetState(): RunWidgetState {
  const hasWs = !!app.workspaceRoot;
  const tab = app.activeTab;
  const isPy = !!tab && (tab.path.endsWith(".py") || tab.path.endsWith(".pyw"));
  const canRun = hasWs && !!tab && isPy;
  // D4「调试态与运行态 UI 不混淆」：调试中 ⏹ 必须可用（点击路由到 debug_stop），
  // 否则用户在调试中失去了菜单栏停止入口（E2E 实测：调试中 #btn-stop disabled）。
  const dbgPhase = dap.currentPhase();
  const debugging = dbgPhase === "starting" || dbgPhase === "running" || dbgPhase === "stopped";
  let disabledReason: string;
  if (!hasWs) disabledReason = "未打开工作区";
  else if (!tab) disabledReason = "没有打开的文件";
  else disabledReason = "当前文件不是 Python 文件";
  return {
    canRun,
    disabledReason,
    running: running || runPreparing || debugging,
    channel: runChannel,
    targetName: tab ? basename(tab.path) : "",
    runShortcut: kb.bindingLabel("run"),
    stopShortcut: kb.bindingLabel("stop"),
    selectionShortcut: kb.bindingLabel("run_selection"),
    canOpenConfig: canRun,
  };
}

/** CR-07：运行闸门——同步检查并置位（检查与置位间无 await）。
 * 返回 false 表示已有运行（准备中或进行中）。三条运行路径（输出面板 / 终端 / 选区）共用。 */
function beginRunPreparing(): boolean {
  if (running || runPreparing) return false;
  runPreparing = true;
  renderTabs(); // 准备期即置灰 ▶，给用户即时反馈
  return true;
}

/** CR-07：准备结束（成功进入运行态或放弃），释放闸门 */
function endRunPreparing(): void {
  runPreparing = false;
  renderTabs();
}

/** 「停止并重新运行」：按上次通道重跑 lastRun.path。目标文件已不在 tabs 时先打开，
 *  若打开失败（磁盘文件已删）则置灰不跑——绝不静默跑错文件（T11）。 */
async function restartRun(): Promise<void> {
  if (!lastRun) return;
  const { path, channel } = lastRun;
  await stopRun();
  const tab = app.tabs.find((t) => t.path === path);
  if (tab) {
    activateTab(tab);
  } else {
    try {
      await openFile(path);
    } catch (e) {
      appendOutputLine(outputEl, `无法重新运行：${path}（文件可能已不存在）`, "stderr", gotoFromLink);
      return;
    }
  }
  if (channel === "terminal") await runActiveInTerminal();
  else await runActive();
}

/** 在输出面板运行（默认路径） */
async function runActive(): Promise<void> {
  if (!app.activeTab) return;
  if (!beginRunPreparing()) return; // CR-07：准备期闸门（同步检查并置位）
  const path = app.activeTab.path;
  let prep: RunPrep | null = null;
  try {
    prep = await prepareRun(path);
  } finally {
    if (!prep) endRunPreparing(); // 预检取消/失败 → 释放闸门（成功路径在下方置 running 后释放）
  }
  if (!prep) return;
  if (running) {
    endRunPreparing(); // 准备期间已有运行启动（如 run-exit 重入）→ 放弃
    return;
  }
  running = true;
  runningPath = path;
  runChannel = "output";
  lastRun = { path, channel: "output" };
  runningStdinMode = prep.stdinMode;
  runningStdinEofHinted = false;
  runTranscript.flush(); // 上一轮残留的半行先定型，避免与本次输出粘成一行
  endRunPreparing(); // 状态就绪后释放闸门（内含 renderTabs）
  startRun(path); // P2：运行历史——本次留档（输出面板路径才有 run-stdout/stderr 事件可采）
  appendOutputLine(outputEl, prep.echo, "cmd", gotoFromLink);
  recordLines("cmd", [prep.echo]); // 回显行也入档，否则历史里看不出跑的是什么
  // S4：交互式运行 → 亮出输入行并聚焦，把「等待输入…」显式化（缓解坑 2 的单实例阻塞焦虑）
  syncRunStdinRow();
  try {
    await invoke("run_script", { path, workspaceRoot: app.workspaceRoot, probe: app.settings.probe_enabled });
    // 输出经 run-stdout / run-stderr / run-exit 事件流式到达
  } catch (e) {
    // S1：stdin 重定向文件打不开时后端 fail fast，错误原因在此可见（不留僵尸运行态）
    appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
    // P2：启动失败也要收尾历史记录——否则这条会永远停在中途，显示「运行中…」
    recordLines("stderr", [`运行失败: ${e}`]);
    finishRun(null);
    resetRunState();
  }
}

/** S3：在终端中运行（真 TTY）。输出落点=专用「运行终端」tab（§4.7 结论 2）：
 * 独立标签样式与普通 shell 区分，生命周期也不同——脚本跑完即结束会话，
 * tab 保留供阅读输出与点击 traceback（坑 4 由 xterm link provider 补齐）。 */
async function runActiveInTerminal(): Promise<void> {
  if (!app.activeTab) return;
  if (!beginRunPreparing()) return; // CR-07：准备期闸门（同步检查并置位）
  const path = app.activeTab.path;
  let prep: RunPrep | null = null;
  try {
    prep = await prepareRun(path);
  } finally {
    if (!prep) endRunPreparing();
  }
  if (!prep) return;
  // PTY 无法直接接管重定向文件（§4.4 末行）：不静默降级成手工输入——
  // 那会破坏 file 模式「可复现」的核心诉求，因此明确拒绝并给出两条出路。
  if (prep.stdinMode === "file") {
    endRunPreparing();
    appendOutputLine(
      outputEl,
      "「在终端中运行」不支持标准输入重定向自文件（PTY 无法直接接管文件）。可在标签右键 →「运行配置…」中改为「不接输入」或「交互式」，或改用普通「运行」。",
      "hint",
      gotoFromLink,
    );
    return;
  }
  if (running) {
    endRunPreparing();
    return;
  }
  running = true;
  runningPath = path;
  runChannel = "terminal";
  lastRun = { path, channel: "terminal" };
  // PTY 下 stdin 天然是 TTY：交互由终端自身承载，输出面板的输入行与 S2 的 EOF 归因都不适用
  runningStdinMode = "null";
  runningStdinEofHinted = false;
  endRunPreparing(); // 状态就绪后释放闸门（内含 renderTabs）
  syncRunStdinRow();
  try {
    await runScriptInTerminal(path, prep.echo, resetRunState);
  } catch (e) {
    appendOutputLine(outputEl, `在终端中运行失败: ${e}`, "stderr", gotoFromLink);
    resetRunState();
  }
}

// ---------- S4：输出面板内的交互式输入 ----------

/** 输入行可见性：仅「输出面板路径 + 运行中 + stdin=interactive + 输出标签可见」时亮出并聚焦。
 * 底部面板切标签时也要重新同步（输入行只在「输出」标签下有意义）。 */
function syncRunStdinRow(): void {
  const show =
    running &&
    runChannel === "output" &&
    runningStdinMode === "interactive" &&
    !outputEl.classList.contains("hidden");
  runStdinRowEl.classList.toggle("hidden", !show);
  if (show) {
    updateRunStdinStatus();
    runStdinInputEl.focus();
  }
}

/** 「等待输入…」状态文案（每次输出到达时刷新，**不抢焦点**——用户可能正在别处输入） */
function updateRunStdinStatus(): void {
  if (!running || runningStdinMode !== "interactive") return;
  // 有未完结行 = 脚本写了提示符正在等回答；无未完结行 = 脚本还在跑别的
  runStdinStatusEl.textContent = runTranscript.hasPending() ? "脚本正在等待输入…" : "运行中（交互模式）";
}

/** 提交一行输入给运行中的脚本（Enter）：先把未完结的提示符行定型，再以 `.input` 行回显用户输入，
 * 让 transcript 读起来像真控制台。 */
async function submitRunStdin(): Promise<void> {
  if (!running || runningStdinMode !== "interactive") return;
  const text = runStdinInputEl.value;
  runStdinInputEl.value = "";
  // 提示符（半行）先定型、用户输入另起一行回显：若把输入并进提示符同一行，
  // 定型时的 traceback 匹配会把用户输入也当成脚本输出去扫（且两种样式无法分段）
  runTranscript.flush();
  appendOutputLine(outputEl, text, "input", gotoFromLink);
  try {
    await invoke("run_stdin", { data: text });
  } catch (e) {
    // 槽位为空（非交互/已结束）或 BrokenPipe（脚本已退）→ 后端返回可读原因，不 panic
    appendOutputLine(outputEl, `${e}`, "stderr", gotoFromLink);
  }
  updateRunStdinStatus();
}

/** S2：EOFError 归因提示。只认 traceback 末行的 `EOFError`（**列首**匹配，避免把脚本自己打印的
 * 普通文本误判），一次运行只提示一次。
 * `interactive` 模式下**抑制**——用户主动交互时收到 EOF 属正常结束，弹「stdin 为不接输入」
 * 反而是错误归因（§4.5 跨流顺序评审结论）。 */
function maybeHintEof(line: string): void {
  if (runningStdinEofHinted || runningStdinMode === "interactive") return;
  if (!/^EOFError\b/.test(line.trim())) return;
  runningStdinEofHinted = true;
  const hint =
    runningStdinMode === "file"
      ? "提示：重定向的输入文件已读完，但脚本仍在请求更多输入。请补充文件内容，或在标签右键 →「运行配置…」中调整标准输入。"
      : "提示：脚本尝试读取标准输入，但本次运行的 stdin 为「不接输入」，因此立即收到 EOF。可在标签右键 →「运行配置…」中改为「重定向自文件」（可复现）或「交互式」（在输出面板直接应答）。";
  appendOutputLine(outputEl, hint, "hint", gotoFromLink);
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
  // CR-07：准备期闸门——保存 / 写临时文件都是 await，期间连点不得并发进入
  if (!beginRunPreparing()) return;
  try {
    if (app.activeTab.dirty) await saveActive(); // 运行前保存（与整文件运行一致）

    // 临时文件写到源文件同目录：保证 import 相对导入 / 相对路径资源与源文件一致。
    // CR-05：文件名带进程内随机后缀——并发运行选区 / 跨目录源文件互不覆盖；
    // 结束后由 resetRunState → cleanupSelectionRunMeta 删除；watcher 侧按前缀忽略。
    const tempPath = joinPath(
      parentDirOf(path),
      `__opencharm_selection__${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.py`,
    );
    try {
      await invoke("write_file", { path: tempPath, content: code });
    } catch (e) {
      appendOutputLine(outputEl, `写入选区临时文件失败: ${e}`, "stderr", gotoFromLink);
      return;
    }

    if (running) return; // 准备期间已有运行启动 → 放弃（闸门在 finally 释放）
    selectionRunMeta = { tempPath, sourcePath: path, startLine };

    running = true;
    runningPath = tempPath;
    runChannel = "output";
    // 选区运行用临时文件、**刻意不套运行配置**（含 args / env / stdin 重定向与交互）：
    // 语义上是一次性片段，保持最简 = 不接输入
    runningStdinMode = "null";
    runningStdinEofHinted = false;
    renderTabs();
    const rangeLabel = startLine === endLine ? `行 ${startLine}` : `行 ${startLine}-${endLine}`;
    appendOutputLine(outputEl, `> 运行选区  ${path}:${rangeLabel}`, "cmd", gotoFromLink);
    try {
      // probe=false：选区是临时代码，不采样（避免污染项目 trace 库）
      await invoke("run_script", { path: tempPath, workspaceRoot: app.workspaceRoot, probe: false });
    } catch (e) {
      appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
      resetRunState();
    }
  } finally {
    // 无论是否进入运行态都释放闸门：成功路径 running 已接管守卫，失败/放弃路径恢复可运行
    endRunPreparing();
  }
}

/** 停止运行（§4.7 结论 3：按当前路径路由——输出面板 → stop_script；运行终端 → term_kill） */
async function stopRun(): Promise<void> {
  if (runChannel === "terminal") {
    // term_kill 不发 term-exit（只有「自然退出」才 notify），故由 stopRunTerminal 内部触发退出回调
    await stopRunTerminal();
  } else {
    try {
      await invoke("stop_script");
    } catch { /* 忽略 */ }
  }
  // 立即更新状态（run-exit 事件也会更新，但可能有延迟）
  runTranscript.flush();
  resetRunState();
}

// ---------- 调试（debug dev plan §6.7：调试运行入口） ----------

/** 调试运行入口：prepareRun 复用 → debug_detect（debugpy 定位 + 依赖提示）→
 * debug_start（后端拉起 debugpy + TCP）→ DAP 握手（initialize → setBreakpoints →
 * configurationDone）→ 切调试侧栏 + 终端承载 stdout。 */
async function runDebug(): Promise<void> {
  if (!app.activeTab) return;
  const path = app.activeTab.path;
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return;
  }
  // 调试态与运行态互斥（后端强制）：正在运行时提示先停止
  if (running || runPreparing) {
    appendOutputLine(outputEl, "已有脚本在运行，请先停止再调试", "hint", gotoFromLink);
    return;
  }
  const phase = dap.currentPhase();
  if (phase === "starting" || phase === "running" || phase === "stopped") {
    appendOutputLine(outputEl, "已有调试会话在运行，请先停止（Shift+F5）", "hint", gotoFromLink);
    return;
  }

  // prepareRun 复用（自动保存 / 依赖预检 / 读运行配置；stdin=file 场景由后端 fail fast）
  const prep = await prepareRun(path);
  if (!prep) return;

  // P1：调试复用运行配置——后端 debug_start 直读 run_configs（参数 / env / 工作目录），
  // 这里把「用上了什么」显式回显，避免用户以为调试是完全独立的一套配置。
  if (app.workspaceRoot) {
    const rc = await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path })
      .catch(() => ({} as Partial<RunConfig>));
    const parts: string[] = [];
    if (rc.args?.trim()) parts.push(`参数 ${rc.args.trim()}`);
    if (rc.env?.length) parts.push(`环境变量 ${rc.env.length} 项`);
    if (parts.length) {
      appendOutputLine(outputEl, `调试复用运行配置：${parts.join("，")}`, "hint", gotoFromLink);
    }
  }

  // debug_detect：debugpy 定位 + 依赖声明提示（§5.1.6：提示性质，不阻断）
  interface DebugDetectResult { debugpyOk: boolean; debugpyDir: string | null; depFound: boolean; depFiles: string[] }
  let detect: DebugDetectResult;
  try {
    detect = await invoke<DebugDetectResult>("debug_detect", { workspaceRoot: app.workspaceRoot });
  } catch (e) {
    appendOutputLine(outputEl, `调试环境检测失败: ${e}`, "stderr", gotoFromLink);
    return;
  }
  if (!detect.debugpyOk) {
    appendOutputLine(
      outputEl,
      "未找到自带 debugpy（应用资源目录损坏，或开发环境未运行 tools/fetch-debugpy.ps1 拉取）。请重新安装应用或在仓库根目录执行：powershell -ExecutionPolicy Bypass -File tools/fetch-debugpy.ps1",
      "stderr",
      gotoFromLink,
    );
    return;
  }
  // §3.5：依赖清单命中 → 输出面板一次性提示（自带副本不冲突），不弹窗不阻断
  if (detect.depFound) {
    notifyDepFound(detect.depFiles);
    appendOutputLine(
      outputEl,
      `提示：${detect.depFiles.join("、")} 声明了 debugpy —— OpenCharm 调试使用自带副本，二者互不影响，可按需移除声明。`,
      "hint",
      gotoFromLink,
    );
  }

  appendOutputLine(outputEl, `> [debug] ${basename(path)}  (${path})`, "cmd", gotoFromLink);
  try {
    await dap.startDebug(path, app.workspaceRoot, pushAllBreakpoints);
  } catch (e) {
    appendOutputLine(outputEl, `调试启动失败: ${e}`, "stderr", gotoFromLink);
    dap.resetDebugState();
    return;
  }
  // 切到调试侧栏（§6.7）；终端 tab 承载调试进程 stdout（后端已落 PTY）
  setSidebarTab("debug");
}

/** 停止调试（Shift+F5 / 工具栏停止 / 调试态下的停止按钮路由） */
async function stopDebugSession(): Promise<void> {
  await dap.stopDebug();
  dap.resetDebugState();
  clearCurrentLine();
}

/**
 * P2：新建草稿文件（PyCharm Ctrl+Alt+Shift+Insert Scratch 同款）。
 * 草稿落在数据根的 scratches/ 目录（**不在工作区里**——不入库、不污染项目），
 * 创建后直接打开即可运行 / 调试。
 */
async function newScratch(): Promise<void> {
  try {
    const path = await invoke<string>("create_scratch", { ext: ".py" });
    await openFile(path);
    appendOutputLine(outputEl, `已新建草稿：${path}（不入库，可直接运行 / 调试）`, "hint", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `新建草稿失败: ${e}`, "stderr", gotoFromLink);
  }
}

/** Alt+F9 Run to Cursor：跑到光标所在行（临时断点 + 继续，命中断点后自动撤掉） */
async function runToCursorAtCursor(): Promise<void> {
  const tab = app.activeTab;
  if (!tab) return;
  const line = app.editor.getPosition()?.lineNumber;
  if (!line) return;
  if (dap.currentPhase() !== "stopped") {
    appendOutputLine(outputEl, "Run to Cursor 需要在调试暂停时使用（先运行到断点处）", "hint", gotoFromLink);
    return;
  }
  await runToCursorIn(tab.path, line);
}

/** Alt+F8 求值表达式：非暂停态给明确指引，暂停态切到调试侧栏并弹输入框 */
async function onEvaluateShortcut(): Promise<void> {
  if (dap.currentPhase() !== "stopped") {
    await notifyNotPaused();
    return;
  }
  setSidebarTab("debug");
  await openEvaluatePrompt();
}

/**
 * P1：Search Everywhere 的「命令」数据源。
 * 键位表里已有的动作直接用其 id——hint 会自动跟随用户在设置里改过的键位
 * （同 debugView 工具栏提示的处理，避免硬编码 "F5" 这类会失真的文案）；
 * 无键位的动作用显式 hint（如内建的 Shift+Alt+F）或留空。
 */
function buildQuickOpenActions(): QuickOpenAction[] {
  return [
    { id: "save", label: "保存", run: () => void saveActive() },
    { id: "run", label: "运行当前文件", run: () => void runActive() },
    { id: "debug", label: "启动调试 / 继续", run: () => void runDebug() },
    { id: "debug_stop", label: "停止调试", run: () => void stopDebugSession() },
    { id: "debug_evaluate", label: "求值表达式", run: () => void onEvaluateShortcut() },
    { id: "debug_run_to_cursor", label: "运行到光标处", run: () => void runToCursorAtCursor() },
    { id: "bookmark_toggle", label: "切换书签", run: () => void toggleBookmarkAtCursor() },
    { id: "bookmark_list", label: "书签列表", run: () => void openBookmarks() },
    { id: "scratch_new", label: "新建草稿文件", run: () => void newScratch() },
    { id: "run_history", label: "运行历史", run: () => openRunHistory() },
    { id: "goto_file", label: "转到文件", run: () => void openQuickOpen("files") },
    { id: "goto_line", label: "转到行 / 列", run: () => void openQuickOpen("line") },
    { id: "goto_definition", label: "跳转定义", run: () => void lsp.gotoDefinitionAtCursor(app.editor) },
    { id: "global_search", label: "全局搜索", run: () => setSidebarTab("search") },
    { id: "recent_files", label: "最近打开的文件", run: () => void openRecentFiles() },
    { id: "optimize_imports", label: "整理导入（Optimize Imports）", run: () => void optimizeImportsActive() },
    { id: "local_history", label: "本地历史", run: () => void openLocalHistory() },
    { id: "template_palette", label: "Live Templates 面板", run: () => liveTemplatesHandle?.openPalette() },
    { id: "surround", label: "环绕模板（需选区）", run: () => liveTemplatesHandle?.openSurround() },
    { id: "markdown_preview", label: "Markdown 预览", run: () => mdPreview.togglePreview() },
    { id: "format_document", label: "格式化文档", hint: "Shift+Alt+F", run: () => void app.editor.getAction("editor.action.formatDocument")?.run() },
    { id: "open_settings", label: "打开设置", run: () => openSettingsPanel() },
    { id: "new_project", label: "新建项目", run: () => openNewProjectPanel() },
    { id: "git_panel", label: "Git 面板", run: () => setSidebarTab("git") },
    { id: "todo_panel", label: "TODO 工具窗", run: () => setSidebarTab("todo") },
  ];
}

// ---------- 断点右键菜单（P0：条件断点 / 命中次数 / Logpoint） ----------

/**
 * 断点 gutter 右键菜单（对标 PyCharm 右键断点）。
 * 三个字段均为 DAP `SourceBreakpoint` 原生能力（见 dap/client.ts::BreakpointSpec），
 * 本函数只负责「录入 + 落库 + 重绘」，协议透传与同步由 debugGutter 负责。
 *
 * 录入口径：openPrompt 返回 null = 取消（保持原值）；空串 = 清空该字段。
 */
async function showBreakpointMenu(path: string, line: number, x: number, y: number): Promise<void> {
  const spec = getBreakpointSpec(path, line);
  const has = spec !== null;
  const kind = breakpointKind(spec);
  const apply = (next: Parameters<typeof updateBreakpoint>[2]): void => {
    updateBreakpoint(path, line, next);
    refreshDebugGutter();
  };

  showMenu(
    [
      {
        label: has ? "编辑条件…" : "添加条件断点…",
        icon: "debug-breakpoint-conditional",
        // 条件为真才断下——爬虫循环「第 N 次迭代才断」场景刚需
        detail: spec?.condition ? `当前：${spec.condition}` : undefined,
        action: () => {
          void openPrompt({
            title: `断点条件 · ${basename(path)}:${line}`,
            label: "Python 表达式，为真时才断下（如 i > 10）；留空清除条件。",
            value: spec?.condition ?? "",
            placeholder: "i > 10",
          }).then((v) => {
            if (v === null) return; // 取消：保持原值
            apply({ ...spec, condition: v || undefined });
          });
        },
      },
      {
        label: "设置命中次数…",
        icon: "debug-breakpoint-function",
        detail: spec?.hitCondition ? `当前：${spec.hitCondition}` : undefined,
        action: () => {
          void openPrompt({
            title: `命中次数 · ${basename(path)}:${line}`,
            label: "数字（第 N 次命中时断下）或比较表达式（>3、%2==0）；留空清除。",
            value: spec?.hitCondition ?? "",
            placeholder: ">3",
          }).then((v) => {
            if (v === null) return;
            apply({ ...spec, hitCondition: v || undefined });
          });
        },
      },
      {
        label: has && spec?.logMessage ? "编辑日志消息…" : "设为日志点（不打断）…",
        icon: "debug-breakpoint-log",
        detail: spec?.logMessage ? `当前：${spec.logMessage}` : undefined,
        action: () => {
          void openPrompt({
            title: `日志点 · ${basename(path)}:${line}`,
            label: "用 {表达式} 插值，如 i={i}；设置后该行不断下，只把结果打到调试输出。",
            value: spec?.logMessage ?? "",
            placeholder: "i={i}, url={url}",
          }).then((v) => {
            if (v === null) return;
            apply({ ...spec, logMessage: v || undefined });
          });
        },
      },
      {
        label: "转为普通断点",
        icon: "debug-breakpoint",
        disabled: kind === "plain",
        disabledReason: "当前已是普通断点",
        action: () => apply(null),
      },
      { sep: true },
      has
        ? {
            label: "删除断点",
            icon: "trash",
            danger: true,
            action: () => {
              removeBreakpoint(path, line);
              refreshDebugGutter();
            },
          }
        : {
            label: "在此添加断点",
            icon: "debug-breakpoint",
            action: () => {
              toggleBreakpoint(path, line);
              refreshDebugGutter();
            },
          },
    ],
    { x, y },
  );
}

// ---------- 运行配置（P3 建议 2）----------

/** 当前正在编辑运行配置的脚本路径（null = 面板关闭） */
let runConfigPath: string | null = null;

/** 打开某脚本的运行配置面板：加载已持久化的 Parameters / 环境变量 / stdin */
async function openRunConfig(path: string): Promise<void> {
  if (!app.workspaceRoot) {
    appendOutputLine(outputEl, "运行配置需先打开一个工作区", "stderr", gotoFromLink);
    return;
  }
  runConfigPath = path;
  runConfigTargetEl.textContent = path;
  let cfg: RunConfig = EMPTY_RUN_CONFIG;
  try {
    // 后端对存量配置（无 stdin 字段）已用 serde default 补齐，此处再兜一层防御
    const raw = await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path });
    cfg = {
      args: raw.args ?? "",
      env: raw.env ?? [],
      stdin: { mode: raw.stdin?.mode ?? "null", path: raw.stdin?.path ?? "" },
    };
  } catch (e) {
    console.error("get_run_config 失败", e);
  }
  runConfigArgsEl.value = cfg.args;
  runConfigEnvEl.value = cfg.env.map((kv) => `${kv.key}=${kv.value}`).join("\n");
  // 未知/存量值一律回落到 null（与后端 effective_mode 同口径，坑 2：默认值绝不能是交互）
  runConfigStdinModeEl.value = cfg.stdin.mode === "file" || cfg.stdin.mode === "interactive" ? cfg.stdin.mode : "null";
  runConfigStdinPathEl.value = cfg.stdin.path;
  syncStdinPathRow();
  showEl(runConfigModalEl);
  releaseRunConfigFocus?.();
  releaseRunConfigFocus = trapFocus(runConfigModalEl);
  runConfigArgsEl.focus();
}

/** stdin 选 file 时才显示文件路径行（interactive 由输出面板的输入行承载，无需路径） */
function syncStdinPathRow(): void {
  runConfigStdinPathRowEl.classList.toggle("hidden", runConfigStdinModeEl.value !== "file");
}

function closeRunConfig(): void {
  runConfigPath = null;
  releaseRunConfigFocus?.();
  releaseRunConfigFocus = null;
  hideEl(runConfigModalEl);
}

/** 解析环境变量文本（每行 KEY=VALUE，忽略空行与无 '=' 的行）为 EnvVar[] */
function parseEnvText(text: string): EnvVar[] {
  const out: EnvVar[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // 无 '=' 或空键 → 跳过
    out.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1) });
  }
  return out;
}

async function saveRunConfig(): Promise<void> {
  if (!app.workspaceRoot || !runConfigPath) return;
  // S4：三态（null / file / interactive）；下拉里的未知值一律回落 null
  const rawMode = runConfigStdinModeEl.value;
  const stdinMode: StdinMode = rawMode === "file" || rawMode === "interactive" ? rawMode : "null";
  const stdinPath = runConfigStdinPathEl.value.trim();
  // S1：选了重定向却没给文件 → 拦住并提示，避免保存出一个后端会归一化成 null 的“假配置”
  if (stdinMode === "file" && !stdinPath) {
    appendOutputLine(outputEl, "已选择「重定向自文件」，请先指定输入文件", "stderr", gotoFromLink);
    runConfigStdinPathEl.focus();
    return;
  }
  const config: RunConfig = {
    args: runConfigArgsEl.value,
    env: parseEnvText(runConfigEnvEl.value),
    stdin: { mode: stdinMode, path: stdinMode === "file" ? stdinPath : "" },
  };
  const saveBtn = $btn("run-config-save");
  setBusy(saveBtn, true, "保存中…");
  try {
    await invoke("set_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: runConfigPath, config });
    appendOutputLine(outputEl, `已保存运行配置：${basename(runConfigPath)}`, "stdout", gotoFromLink);
    closeRunConfig();
  } catch (e) {
    appendOutputLine(outputEl, `保存运行配置失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(saveBtn, false);
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
    // CR-28：joinPath 而非硬编码 \\ 拼接（跨平台一致性）
    path = joinPath(app.workspaceRoot, path);
  }
  openFile(path, line).catch(() => {
    appendOutputLine(outputEl, `无法打开: ${link.path}`, "stderr", gotoFromLink);
  });
}

// ---------- LSP ----------

export async function startLsp(): Promise<void> {
  if (!app.workspaceRoot) return;
  // 引擎真值统一读 app.settings.lsp_engine（C2 修 bug：不再读 menubar 的 DOM select，
  // 避免「界面显示 A、实际跑 B」的永久分叉）
  const engine = app.settings.lsp_engine || "pyrefly";
  const rootUri = lsp.workspaceRootUri(app.workspaceRoot); // CR-29：正确百分号编码（空格/中文路径）
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
/** UI-30：父项元素 → 子菜单解析器（键盘 → 键展开子菜单时取用；渲染时写入，随元素销毁自动回收） */
const submenuResolvers = new WeakMap<HTMLElement, () => MenuEntry[] | Promise<MenuEntry[]>>();

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
      // P0：Optimize Imports（PyCharm「编辑 → Optimize Imports」同位置）
      {
        label: "整理导入（Optimize Imports）",
        shortcut: kb.bindingLabel("optimize_imports") || undefined,
        action: () => void optimizeImportsActive(),
      },
    ];
    case "view": return [
      { label: "文件树", action: () => setSidebarTab("files") },
      { label: "搜索", shortcut: kb.bindingLabel("global_search") || undefined, action: () => setSidebarTab("search") },
      // P0：最近打开的文件（PyCharm「视图 → 最近的文件」同位置）
      { label: "最近的文件", shortcut: kb.bindingLabel("recent_files") || undefined, action: () => void openRecentFiles() },
      // P1：Search Everywhere / 本地历史
      { label: "Search Everywhere", shortcut: "Double Shift", action: () => void openQuickOpen("all") },
      { label: "转到文件", shortcut: kb.bindingLabel("goto_file") || undefined, action: () => void openQuickOpen("files") },
      { label: "转到行 / 列", shortcut: kb.bindingLabel("goto_line") || undefined, action: () => void openQuickOpen("line") },
      { label: "本地历史", shortcut: kb.bindingLabel("local_history") || undefined, action: () => void openLocalHistory() },
      { sep: true, label: "" },
      { label: "后退", shortcut: kb.bindingLabel("nav_back") || undefined, action: () => void goBack() },
      { label: "前进", shortcut: kb.bindingLabel("nav_forward") || undefined, action: () => void goForward() },
      { sep: true, label: "" },
      // P2：书签 / 运行历史
      { label: "书签列表", shortcut: kb.bindingLabel("bookmark_list") || undefined, action: () => void openBookmarks() },
      { label: "运行历史", shortcut: kb.bindingLabel("run_history") || undefined, action: () => openRunHistory() },
      { sep: true, label: "" },
      { label: "Markdown 预览", shortcut: kb.bindingLabel("markdown_preview") || undefined, action: () => mdPreview.togglePreview() },
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
      el.setAttribute("role", "separator"); // UI-30
      const line = document.createElement("div");
      line.className = "sep";
      el.appendChild(line);
    } else if (it.submenu) {
      // 有子菜单的父项：右侧 ▸，悬停延时展开、点击切换
      el.className = "ctx-menu-item with-submenu";
      // UI-30：APG menu 模式——父项声明 haspopup，aria-expanded 由 openSubmenu/hideSubmenu 同源切换
      el.setAttribute("role", "menuitem");
      el.setAttribute("aria-haspopup", "menu");
      el.setAttribute("aria-expanded", "false");
      el.tabIndex = -1;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      const arrow = document.createElement("span");
      arrow.className = "sub-arrow";
      arrow.textContent = "▸";
      el.appendChild(arrow);
      submenuResolvers.set(el, it.submenu); // UI-30：供键盘 → 键展开时取用
      el.addEventListener("mouseenter", () => scheduleSubmenu(el, it.submenu!));
      el.addEventListener("mouseleave", scheduleSubmenuClose);
      el.addEventListener("click", () => {
        if (activeSubmenuParent === el) hideSubmenu();
        else void openSubmenu(el, it.submenu!);
      });
    } else {
      el.className = "ctx-menu-item";
      el.setAttribute("role", "menuitem"); // UI-30
      el.tabIndex = -1;
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
  activeMenuBtn?.setAttribute("aria-expanded", "false"); // UI-30：直接切换菜单时旧按钮的开合态复位
  activeMenuBtn = btn;
  btn.classList.add("active");
  btn.setAttribute("aria-expanded", "true"); // UI-30
  // UI-30：打开即把焦点移入菜单首项（APG menu 模式），↑↓/Home/End/Enter 从此可用
  moveMenuFocus(menuDropdownEl, "first");
}

function hideMenuDropdown(): void {
  hideSubmenu();
  menuDropdownEl.classList.add("hidden");
  activeMenuBtn?.classList.remove("active");
  activeMenuBtn?.setAttribute("aria-expanded", "false"); // UI-30
  // UI-30：焦点尚未离开（仍在菜单内或掉到 body——如 Esc 关闭）时归还菜单按钮；
  // 用户已点击别处（含另一个菜单按钮）时焦点在点击目标上，不抢回
  const ae = document.activeElement;
  if (
    activeMenuBtn?.isConnected &&
    (ae === null || ae === document.body || menuDropdownEl.contains(ae) || submenuEl.contains(ae))
  ) {
    activeMenuBtn.focus();
  }
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
  activeSubmenuParent?.setAttribute("aria-expanded", "false"); // UI-30：与 .open 类同源切换
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

/** @param focusFirst UI-30：键盘（→ 键）展开时把焦点移入子菜单首项；鼠标悬停/点击展开不抢焦点 */
async function openSubmenu(
  parentEl: HTMLElement,
  resolve: () => MenuEntry[] | Promise<MenuEntry[]>,
  focusFirst = false,
): Promise<void> {
  cancelSubmenuTimer();
  activeSubmenuParent?.classList.remove("open");
  activeSubmenuParent?.setAttribute("aria-expanded", "false"); // UI-30：切换父项时旧父项复位
  activeSubmenuParent = parentEl;
  parentEl.classList.add("open");
  parentEl.setAttribute("aria-expanded", "true"); // UI-30：与 .open 类同源切换

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
      el.setAttribute("role", "separator"); // UI-30
      const line = document.createElement("div");
      line.className = "sep";
      el.appendChild(line);
      submenuEl.appendChild(el);
    } else {
      const el = document.createElement("div");
      el.className = "ctx-menu-item";
      el.setAttribute("role", "menuitem"); // UI-30
      el.tabIndex = -1;
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
  if (focusFirst) moveMenuFocus(submenuEl, "first"); // UI-30
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
  // UI-30：下拉菜单的键盘导航（↑↓/Home/End 漫游、Enter/Space 激活、Tab 退出，见 menuKeys.ts）。
  // Esc 走级联语义：子菜单开着先关子菜单、焦点回父项；否则关整个下拉（焦点归还菜单按钮）。
  // 两者都 stopPropagation，不再触发上面 window 级 Escape 的整体关闭。
  wireMenuKeyNav(menuDropdownEl, {
    onArrowRight: (item) => {
      if (!item.classList.contains("with-submenu")) return;
      const resolve = submenuResolvers.get(item);
      if (resolve) void openSubmenu(item, resolve, true); // 键盘展开 → 焦点移入子菜单
    },
    onEscape: () => {
      if (activeSubmenuParent) {
        const p = activeSubmenuParent;
        hideSubmenu();
        p.focus();
      } else {
        hideMenuDropdown();
      }
    },
    onTab: () => hideMenuDropdown(),
  });
  // 子菜单：← / Esc 折叠回父项（APG 级联菜单的退出方向）；Tab 关整个下拉
  wireMenuKeyNav(submenuEl, {
    onArrowLeft: () => {
      const p = activeSubmenuParent;
      hideSubmenu();
      p?.focus();
    },
    onEscape: () => {
      const p = activeSubmenuParent;
      hideSubmenu();
      p?.focus();
    },
    onTab: () => hideMenuDropdown(),
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
  // UI-25：欢迎页快捷键网格改由键位系统渲染，必须在首个 await（Monaco 动态包，首屏最慢的一步）
  // 之前同步画一次，否则覆盖层会露出空的「快捷键」区。此刻 app.settings 仍是 DEFAULT_SETTINGS，
  // 画的是出厂键位；loadSettings 完成后由 updateEditorOverlay 刷成真实值（多数用户二者相同）。
  renderWelcomeShortcuts();
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
  // P0：Optimize Imports（默认 Ctrl+Alt+O，PyCharm 同款）
  kb.setKeybindingHandler("optimize_imports", () => void optimizeImportsActive());
  // CR-24：LSP providers 统一入应用级 DisposableStore——不再丢弃句柄。
  // providers 与引擎实例无关（内部按 engineStatus 短路），init 只注册一次；
  // store 便于应用级 teardown / 测试中整体清理，防句柄泄漏累积。
  lspProviders.dispose();
  lspProviders.add(lsp.registerLspCompletion());
  lspProviders.add(lsp.registerLspHover());
  lspProviders.add(lsp.registerLspDefinition());
  lspProviders.add(lsp.registerLspRename()); // F2 编辑器内重命名
  lspProviders.add(lsp.registerLspReferences()); // Shift+F12 查找引用（peek 视图）
  lspProviders.add(lsp.registerLspSignatureHelp()); // 签名帮助（参数提示）
  lspProviders.add(lsp.registerLspCodeAction()); // Ctrl+. 快速修复
  lspProviders.add(lsp.registerLspInlayHints()); // 运行时类型标注（opencharm-intel）
  // 缺失包安装：注册全局命令供 CodeAction 的 command 引用（灯泡「安装 X」→ pip install）。
  // CodeAction 的 command 走 commandService.executeCommand(id)，必须用 registerCommand 全局注册 id；
  // 不能用 editor.addAction——addAction 内部会把 id 加 editorId 前缀（`editorId:id`），导致 executeCommand 找不到。
  app.monaco.editor.registerCommand(lsp.INSTALL_PACKAGE_COMMAND, (_accessor, ...args: unknown[]) => {
    const pkg = args[0];
    console.debug(`[opencharm-install] 命令触发 pkg=${String(pkg)}`);
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
      await syncPendingChanges(); // CR-13：串行冲刷（含本文件在内的全部待同步变更，保 FIFO）
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

  // window 级快捷键（保存 / 运行 / 全局搜索 / 调试五件套，PyCharm 风格）：经键位表实时匹配，可在设置中自定义
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
    else if (id === "stop") void stopRun();
    else if (id === "global_search") setSidebarTab("search");
    // P0：最近打开的文件（Ctrl+E）——后端数据早已在写，此前前端没有消费入口
    else if (id === "recent_files") void openRecentFiles();
    else if (id === "markdown_preview") mdPreview.togglePreview();
    // 调试五件套（debug dev plan §6.6）：F5 启动/继续、Shift+F5 停止、F10/F11/Shift+F11 步进
    else if (id === "debug") {
      const phase = dap.currentPhase();
      if (phase === "stopped") import("./dap/client").then((m) => void m.dapContinue(1));
      else if (phase === "idle" || phase === "exited") void runDebug();
    } else if (id === "debug_stop") void stopDebugSession();
    else if (id === "debug_step_over") import("./dap/client").then((m) => void m.dapNext(1));
    else if (id === "debug_step_into") import("./dap/client").then((m) => void m.dapStepIn(1));
    else if (id === "debug_step_out") import("./dap/client").then((m) => void m.dapStepOut(1));
    // P1：Search Everywhere 三入口 + 导航历史 + 本地历史 + 求值表达式
    else if (id === "goto_file") void openQuickOpen("files");
    else if (id === "goto_line") void openQuickOpen("line");
    else if (id === "nav_back") void goBack();
    else if (id === "nav_forward") void goForward();
    else if (id === "local_history") void openLocalHistory();
    else if (id === "debug_evaluate") void onEvaluateShortcut();
    // P2：Run to Cursor / 书签 / 草稿 / 运行历史
    else if (id === "debug_run_to_cursor") void runToCursorAtCursor();
    else if (id === "bookmark_toggle") void toggleBookmarkAtCursor();
    else if (id === "bookmark_list") void openBookmarks();
    else if (id === "scratch_new") void newScratch();
    else if (id === "run_history") openRunHistory();
  });

  // P1：Double Shift → Search Everywhere（键位表无法表达双击手势，故固定在此）。
  // 误触防护：两次 Shift 之间若按下过任何**其它**键（如打大写字母 A 的 Shift+A），
  // 计时器立即作废——否则连续输入大写字母会被误判成双击 Shift。
  let lastShiftUpAt = 0;
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Shift") lastShiftUpAt = 0;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key !== "Shift") return;
    const now = Date.now();
    if (lastShiftUpAt > 0 && now - lastShiftUpAt < DOUBLE_SHIFT_MS) {
      lastShiftUpAt = 0;
      if (!isQuickOpenOpen()) void openQuickOpen("all");
    } else {
      lastShiftUpAt = now;
    }
  });

  // didChange 全量同步（200ms 防抖，技术方案 §2.4）
  app.editor.onDidChangeModelContent(() => {
    if (!app.activeTab) return;
    // Markdown 预览：预览开启时才挂防抖渲染（关闭时零开销；仅活动 md tab 实际重渲染）
    if (mdPreview.isPreviewOpen()) mdPreview.schedulePreviewRender();
    window.clearTimeout(editorTimers.change);
    // C5：▶ 位置随内容变化 300ms 防抖重算（与 didChange 的 changeTimer 各管各的，不复用）
    window.clearTimeout(editorTimers.gutter);
    editorTimers.gutter = window.setTimeout(() => refreshRunGutter(), 300);
    // D3：断点行随内容变化防抖重算（行增删后断点按 Monaco 当前行号定位，不随行迁移）
    window.setTimeout(() => refreshDebugGutter(), 300);
    // CR-13：changeTimer 回调改串行 await——原来循环内并发 fire-and-forget，多 invoke
    // 到达顺序不保证 → version 乱序，引擎状态错乱
    editorTimers.change = window.setTimeout(() => {
      void syncPendingChanges();
    }, 200);
    // 大纲随编辑防抖刷新（500ms，P25-T07）
    window.clearTimeout(editorTimers.outline);
    editorTimers.outline = window.setTimeout(() => {
      if (activeView() === "files") refreshOutline();
    }, 500);
    // P2：面包屑的符号树随编辑过期（缓存丢弃 → 下次刷新重查）
    invalidateBreadcrumbs();
    scheduleBreadcrumbs();
    // P2：ruff 实时 lint（停手 800ms 后跑一次）
    scheduleRuffLint();
    // P2：书签按行号定位，行增删后装饰要跟着重算（与断点红点同款处理）
    window.setTimeout(() => refreshBookmarkGutter(), 300);
    // 自动保存（delay 模式，P25-T08）
    if (app.settings.autosave === "delay") {
      window.clearTimeout(editorTimers.autosave);
      editorTimers.autosave = window.setTimeout(() => {
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
  // P0：最近打开的文件（Ctrl+E 弹窗）
  initRecentFiles();
  setRecentFilesHandlers({ openFile: (p) => void openFile(p) });
  // P1：Search Everywhere（Double Shift / Ctrl+Shift+N / Ctrl+G）
  initQuickOpen();
  setQuickOpenHandlers({
    openFile: (p, line) => void openFile(p, line),
    gotoLine: (line, column) => {
      app.editor.setPosition({ lineNumber: line, column });
      app.editor.revealLineInCenter(line);
      app.editor.focus();
    },
  });
  registerQuickOpenActions(buildQuickOpenActions());
  // P1：导航历史（Ctrl+Alt+←/→）——跳转闭环的另一半
  setNavHistoryHandlers({ openFile: (p, line) => openFile(p, line) });
  // P1：本地历史（Ctrl+Shift+H）——无 Git 工作区的回滚兜底
  initLocalHistory();
  setLocalHistoryHandlers({ reloadFile: (p) => reloadFileFromDisk(p) });
  // P2：ruff 实时 lint（诊断第三桶，owner = opencharm-ruff）
  setRuffLintHandlers({ setMarkers });
  // P2：书签（Ctrl+F11 切换 / Ctrl+Shift+F11 列表）
  initBookmarks(app.editor, app.monaco);
  setBookmarkHandlers({ openFile: (p, line) => void openFile(p, line) });
  void loadBookmarks().then(() => refreshBookmarkGutter());
  // P2：运行历史（输出面板按次留存，可回看）
  initRunHistory();
  setRunHistoryHandlers({
    clearOutput: () => clearOutput(outputEl),
    appendLine: (cls, text) => appendOutputLine(outputEl, text, cls, gotoFromLink),
  });
  // P2：Breadcrumbs 面包屑（编辑区顶部层级链）
  initBreadcrumbs();
  setBreadcrumbHandlers({
    gotoLine: (line) => {
      app.editor.setPosition({ lineNumber: line, column: 1 });
      app.editor.revealLineInCenter(line);
      app.editor.focus();
    },
  });
  app.editor.onDidChangeCursorPosition(() => scheduleBreadcrumbs());
  // P0：TODO 工具窗
  initTodoView();
  setTodoViewHandlers({ openFile: (path, line) => void openFile(path, line) });
  $("ew-open-folder").addEventListener("click", () => void openFolderFromToolbar());
  $("ew-new-project").addEventListener("click", () => openNewProjectPanel());
  $("ew-recent-clear").addEventListener("click", () => void clearRecentWorkspaces());
  mdPreview.setMarkdownLinkHandler((path) => void openFile(path)); // 相对 .md 链接 → openFile（注入回调，避免循环依赖）
  mdPreview.wireMarkdownClicks(); // 预览点击委托（#锚点 / 相对 .md / http(s)）
  mdPreview.wireMarkdownControls(); // 方案A：右上角开关按钮 + 方案D：一次性引导关闭
  wireMenuBar();
  void checkFirstRunStorage(); // 首启数据落位提示（disk-space-plan.md P2-a；内部判断触发条件，多数启动为 no-op）

  // 自绘标题栏（decorations: false）：窗口控制按钮 + 拖拽区 + 边缘 resize 兜底
  const appWindow = getCurrentWindow();
  const winMaxBtn = $("win-max") as HTMLButtonElement;
  // UI-01：切换 codicon 类名而非覆盖 textContent——保住 HTML 里的 <i aria-hidden> 节点，
  // 与最小化/关闭按钮（同为 codicon）风格一致，也不再依赖 "Segoe UI Symbol" 字体渲染裸字符。
  const winMaxIcon = winMaxBtn.querySelector("i.codicon");
  const syncMaxIcon = async (): Promise<void> => {
    try {
      const max = await appWindow.isMaximized();
      winMaxIcon?.classList.toggle("codicon-chrome-maximize", !max);
      winMaxIcon?.classList.toggle("codicon-chrome-restore", max);
      // UI-09：与 index.html 的静态 data-tip 同轨。动态改写必须同时更新 aria-label——
      // 只改 tip 的话，最大化后读屏仍会报「最大化」，与已切换成还原态的图标不符。
      const label = max ? "还原" : "最大化";
      winMaxBtn.dataset.tip = label;
      winMaxBtn.setAttribute("aria-label", label);
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
  // 引擎 chip（C2）：状态栏身份展示 + 切换入口；真值已收敛到 app.settings.lsp_engine
  setEngineChipHandlers({ startLsp, saveSettings });
  wireEngineChip();
  renderEngineChip();

  // 运行组（C3）：菜单栏 ▶/⏹/▾。main 拥有运行动作，runWidget 只负责渲染与派发
  setRunWidgetHandlers({
    run: () => void runActive(),
    runInTerminal: () => void runActiveInTerminal(),
    runSelection: () => void runSelection(),
    // 调试态联动（D4）：运行组 ⏹ 在调试中路由到 debug_stop，避免「调试中误触停止脚本」
    stop: () => {
      const phase = dap.currentPhase();
      if (phase === "starting" || phase === "running" || phase === "stopped") void stopDebugSession();
      else void stopRun();
    },
    restart: () => void restartRun(),
    openRunConfig: () => { if (app.activeTab) void openRunConfig(app.activeTab.path); },
  });
  wireRunWidget();
  setRunWidgetRepaint(() => renderRunWidget(runWidgetState()));

  // gutter 运行图标（C5）：__main__ 守卫行的 ▶，点击运行整个文件、右键弹出与 ▾ 同源菜单
  wireRunGutter(app.editor, app.monaco);
  // gutter 悬停预示（方案 1/2）：把真正可点的 glyph 那一档画出来 + 悬停行显示淡化断点，
  // 否则用户会点在行号两侧的空白上而以为「断点坏了」（CSS 侧见 style.css 同段注释）
  wireGutterHover(app.editor, app.monaco);
  setRunGutterHandlers({
    run: () => void runActive(),
    menuItems: () => getRunMenuItems(),
    state: () => {
      const tab = app.activeTab;
      const isPy = !!tab && (tab.path.endsWith(".py") || tab.path.endsWith(".pyw"));
      return { canRun: !!app.workspaceRoot && !!tab && isPy, running, targetName: tab ? basename(tab.path) : "" };
    },
  });

  // 调试域接线（debug dev plan §6.7）：DAP 事件 + gutter 断点 + 侧栏视图 + 工具栏按钮。
  // 隔离性：任何一步失败只放弃调试功能，**不得中断 init 后续接线**——wireDebugGutter
  // 若未执行，行号断点点击将整体失效（用户实测坑：init 中途抛错 → 断点不出现）。
  try {
    void dap.wireDapEvents().catch((e) => console.error("[debug] DAP 事件监听失败:", e));
    // 注入「守卫行归属」判定：debugGutter 需让出 __main__ 行的 glyph（方案 A），
    // 但不直接 import runGutter（会带进 menu 的顶层 document 监听），故由此注入。
    wireDebugGutter(app.editor, app.monaco, isRunGutterLine);
    // P0：断点右键菜单（条件 / 命中次数 / Logpoint）——菜单构造需要 menu.ts 与 dialog.ts，
    // 由 main 注入以保持 debugGutter 的可测试性（同 runGutter 的 menuItems 注入范式）。
    setBreakpointMenuHandler((path, line, x, y) => void showBreakpointMenu(path, line, x, y));
    initDebugView();
    // P1：调试控制台（求值表达式 + Logpoint 输出承接）——必须挂在 initDebugView 之后，
    // 它往 #view-debug 末尾追加节点，先建会被 initDebugView 的 textContent = "" 清掉
    initDebugConsole();
    // P2：行内变量值（与 inlay hints 同一套注入文本装饰）
    initInlineValues(app.editor, app.monaco);
    wireDebugViewEvents();
    // 调试 phase 变化 → 运行组按钮同步（调试中 ⏹ 可用并路由 debug_stop，D4）
    dap.onPhase(() => {
      renderRunWidget(runWidgetState());
    });
    setDebugViewHandlers({
      start: () => void runDebug(),
      stop: () => void stopDebugSession(),
      openFile: (path, line) => { void openFile(path, line); },
      refreshGutter: () => refreshDebugGutter(),
    });
    $("btn-debug").addEventListener("click", () => {
      // 调试中点击 = 无操作（停止走工具栏/快捷键）；空闲 = 启动调试
      const phase = dap.currentPhase();
      if (phase === "idle" || phase === "exited") void runDebug();
    });
  } catch (e) {
    console.error("[debug] 调试域接线失败（调试功能不可用，其余功能不受影响）:", e);
  }

  // 环境面板（P25-T05）——状态栏解释器点击打开
  statusInterpreterEl.addEventListener("click", () => openEnvPanel());
  // 状态栏芯片语义（第七批）：解释器芯片补了 role=button + tabindex，键盘 Enter/Space 亦可打开（对齐 engineChip）
  statusInterpreterEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEnvPanel();
    }
  });
  $btn("env-close").addEventListener("click", closeEnvPanel);
  $btn("env-create").addEventListener("click", createVenv);
  $btn("env-pkg-install").addEventListener("click", installPackage);
  $btn("env-pkg-uninstall-selected").addEventListener("click", () => uninstallSelectedPackages());
  $btn("env-pkg-upgrade-all").addEventListener("click", () => upgradeAllPackages());
  envPyprojectInitBtn.addEventListener("click", () => void generatePyproject());
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
  // P0：TODO 工具窗——切到该视图才扫描（大仓库遍历不占用启动路径）
  registerSidebarView({
    id: "todo",
    rootId: "view-todo",
    tabId: "tab-todo",
    onShow: () => void refreshTodos(),
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
  registerSidebarView({
    id: "debug",
    rootId: "view-debug",
    tabId: "tab-debug",
    onShow: () => renderDebugView(),
  });

  // Activity Bar 图标（FILES / SEARCH / GIT / DEBUG）
  $("tab-files").addEventListener("click", () => setSidebarTab("files"));
  $("tab-search").addEventListener("click", () => setSidebarTab("search"));
  $("tab-todo").addEventListener("click", () => setSidebarTab("todo"));
  $("tab-git").addEventListener("click", () => setSidebarTab("git"));
  $("tab-debug").addEventListener("click", () => setSidebarTab("debug"));
  // 大纲折叠 / 展开（OUTLINE 并入文件视图，TD-001 附带考虑）
  // UI-16：disclosure 语义——aria-expanded 与 .collapsed 类同源切换（单一写入点），
  // 并给这个可点击 div 补键盘激活（role=button + tabindex 已在 index.html 静态声明）
  const outlineHeader = $("outline-header");
  const toggleOutline = () => {
    const collapsed = $("outline-section").classList.toggle("collapsed");
    outlineHeader.setAttribute("aria-expanded", String(!collapsed));
  };
  outlineHeader.addEventListener("click", toggleOutline);
  outlineHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleOutline();
    }
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
    // UI-16：开关按钮的按下态用 aria-pressed 表达，与 .active 类同源切换
    $("search-case").setAttribute("aria-pressed", String(searchCaseSensitive));
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

  // 运行配置面板（P3 建议 2；stdin 重定向 S1）
  $btn("run-config-close").addEventListener("click", closeRunConfig);
  $btn("run-config-cancel").addEventListener("click", closeRunConfig);
  $btn("run-config-save").addEventListener("click", () => void saveRunConfig());
  runConfigArgsEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void saveRunConfig();
  });
  runConfigStdinModeEl.addEventListener("change", syncStdinPathRow);
  runConfigStdinPathEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void saveRunConfig();
  });
  $btn("run-config-stdin-browse").addEventListener("click", async () => {
    const p = await invoke<string | null>("pick_file").catch((e) => {
      appendOutputLine(outputEl, `打开文件选择器失败：${e}`, "stderr", gotoFromLink);
      return null;
    });
    if (p) runConfigStdinPathEl.value = p;
  });
  runConfigModalEl.addEventListener("click", (e) => {
    if (e.target === runConfigModalEl) closeRunConfig();
  });

  // S4：输出面板内的交互输入行（Enter 发送一行 / Escape 失焦逃生）
  runStdinInputEl.addEventListener("keydown", (e) => {
    // window 级快捷键已有「焦点在 INPUT 时不触发」守卫，此处仍 stopPropagation 双保险：
    // 输入行里敲的字符不应被任何全局键位（如 Ctrl+F10 之外的组合）截走
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void submitRunStdin();
    } else if (e.key === "Escape") {
      // 逃生口：焦点还给编辑器，避免用户被「困」在输入行里（全局 keydown 守卫会因焦点在 INPUT 而失效）
      runStdinInputEl.blur();
      app.editor.focus();
    }
  });

  // 输出面板跨域回调：切标签 → 重新同步输入行可见性（输入行只在「输出」标签下有意义）；
  // 清空输出 → 先丢弃未完结行状态，否则转录器会往已被清空的游离元素里写
  setOutputPanelHooks({
    onTabChange: () => syncRunStdinRow(),
    onClear: () => runTranscript.discard(),
  });
  // S3：终端里的 traceback 也可点击（坑 4）——复用输出面板同一个正则与跳转逻辑；
  // 顺带让在 shell 终端里手敲 `uv run` 产生的 traceback 同样可点（PTY 路线的额外收益）
  setTerminalLinkHandler(gotoFromLink);

  // 文件监听事件（增量刷新树）
  await listen<string[]>("fs-changed", (e) => {
    handleFsChanged(e.payload);
  });

  // 运行事件（流式输出）。S4：交互式运行的 payload 带 `partial`（后端按 chunk 转发），
  // 统一交给 RunTranscript 还原成行——提示符立即可见（坑 1），traceback 链接不被 chunk 切碎（结论 6）。
  // 非交互路径没有 partial 字段，走同一套逻辑等价于旧的按行追加（且不再每行多出一个空白行）。
  await listen<{ data: string; partial?: boolean }>("run-stdout", (e) => {
    const lines = runTranscript.write("stdout", e.payload.data, e.payload.partial === true);
    recordLines("stdout", lines); // P2：运行历史留档（复用已还原好的整行）
    updateRunStdinStatus();
  });
  await listen<{ data: string; partial?: boolean }>("run-stderr", (e) => {
    // S2：只对**定型**的整行做 EOFError 归因（半行提示符不参与判定，避免误判）
    const lines = runTranscript.write("stderr", e.payload.data, e.payload.partial === true);
    recordLines("stderr", lines); // P2：运行历史留档
    for (const line of lines) maybeHintEof(line);
  });
  await listen<{ code: number | null }>("run-exit", (e) => {
    // 收尾：把残留半行定型（脚本以无换行输出结束时不吞字），并让它同样参与 EOF 归因
    const tail = runTranscript.flush();
    recordLines("stdout", tail); // P2：残留半行同样入档，否则最后一行报错会丢
    for (const line of tail) maybeHintEof(line);
    appendOutputLine(outputEl, `[进程退出 code=${e.payload.code ?? "null"}]`, "exit", gotoFromLink);
    finishRun(e.payload.code); // P2：结束本次运行记录
    resetRunState();
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
  renderRunWidget(runWidgetState()); // 首次渲染（无工作区时 renderTabs 不被调用，需显式补一次）
}

init().catch((e) => console.error("init 失败", e));
