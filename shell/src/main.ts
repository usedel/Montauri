// 入口与胶水层（TD-007 + TD-14 功能域拆分后）：工作区生命周期 / 标签页与编辑器 /
// LSP 接线 / 搜索与大纲 / 最近文件 / 菜单栏数据 / 调试入口 / 文件监听 / init。
// 文件树 → fileTree.ts；Git → git.ts；终端与底部面板 → termUi.ts；设置面板 → settingsPanel.ts；
// Python 环境面板 → envPanel.ts；新建项目 → newProject.ts；菜单栏机制 → menuBar.ts；
// 运行域（含 RunState 收敛）→ runFlow.ts + runState.ts；运行配置面板 → runConfigPanel.ts；
// 输出链接跳转 → tracebackLink.ts；跨域共享状态 → state.ts（app 上下文对象）。

// D2：统一单色图标体系（@vscode/codicons，MIT）。先于 style.css 引入，
// 使本项目的分场景图标尺寸规则在同特异性下覆盖 codicon 基础 16px。
import "@vscode/codicons/dist/codicon.css";
import "./style.css";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initLiveTemplates, type LiveTemplatesHandle } from "./live-templates";
import * as ltUi from "./live-templates/ui/manager";
import { registerKeywordCompletion, setKeywordCompletionEnabled } from "./completion/keywordCompletion"; // 零引擎关键字补全（无 LSP 引擎的语言）
import { wireWordBasedSuggestions } from "./completion/wordBasedSuggestions"; // 文档词补全按语言开关
import { initDevTools } from "./devtools"; // 工具菜单 / 命令面板的工具项数据源已随菜单外提到 menuItems.ts
// PR-2：插件域（plugin_system_design §9）——加载器 / facade 依赖注入 / inline 管线
import { initPluginLoader, scanPlugins, schedulePluginRescan, listPluginRecords, setAppVersion } from "./extensions/loader";
import { initInlineRunner } from "./extensions/inline";
import { initInlineSelectionMenu } from "./extensions/inlineMenu"; // P2：编辑器右键「变换选区 ▸」子菜单
import { setPluginsTabHandlers } from "./extensions/pluginsTab";
import {
  wireWelcomeGuide, isWelcomeForced, setWelcomeOverlayRefresh, setWelcomeGuideHandlers,
  renderQuickstartCards, renderTour, consumeWelcomeForce,
} from "./welcomeGuide";
import { formatPythonSource, optimizeImportsSource, registerRuffFormatter, setFormatErrorHandler } from "./format";
import { runSearch, resetSearch, setOpenMatchHandler, type SearchMatch, type SearchScope, type SearchScopeMode } from "./search";
import { findUsagesAtCursor, renameSymbolAtCursor, resetFindUsages, setOpenRefHandler, queryAndRender, initFindUsagesAction, installCtrlShiftDblclickUsages } from "./findUsages";
import { wireProblemsPanel, resetProblemsPanel, setOpenProblemHandler, setShowPanelHandler, renderProblemsChip } from "./problemsPanel"; // 问题面板（对标 PyCharm Problems）
import { initCodeVision, refreshCodeVision } from "./codeVision";
import { initEpJump, refreshEpJump, resetEpJump, setEpJumpHandlers } from "./epJump"; // A5③：端点 CodeLens「端点 N」
import { initDslLens, openRegexTesterAtCursor } from "./dslLens"; // 库支持 PR-2：正则 lens/装饰/诊断/右键
import { initJsonLiteral } from "./jsonLiteral"; // 库支持 P1 §7-3：JSON 字面量高亮/折叠/诊断/右键
import { resetOpenApiPreview, setOpenApiPreviewHandlers, toggleOpenApiPreview } from "./openApiPanel"; // A5④：OpenAPI 面板内预览
import { refreshImportAliases, registerImportAliasCompletion } from "./importAlias"; // import 别名补全（import pandas as pd）
import { registerAutoImportCompletion, resetAutoImportIndex } from "./autoImport"; // PR-E：补全内联 auto-import（自研，探针结局 C）
import { initRenameWidget, setAfterRenameHandler, resetPydanticRenameWarn } from "./renameWidget";
import { initClipboardDiffAction } from "./clipboardDiff"; // C-5：与剪贴板对比（右键菜单）
import { initNoqaAction } from "./ruffLint"; // D-4：忽略此规则（# noqa，右键菜单）
import { initWhitespaceAction } from "./whitespaceToggle"; // T6b：显示空白字符（右键菜单，视图级开关）
import { setTabDragHandlers, wireTabDnD, wireTabDragEnd } from "./tabDragSort"; // T4：tab 拖拽排序
import { installPasteJson } from "./pasteJson"; // PR-M（dx_features_backlog §6.6）：粘贴 JSON → Python 字面量
import { initQuickFixActions, resetQuickFixCache } from "./quickFix"; // P4：D-1 缺失 import 兜底 + D-2 就地创建符号
import { breakDownSaveErrors, saveErrorToastMessage, revealFirstError } from "./markerNavigation"; // 诊断导航 + 保存错误分类（F8 / 保存 toast 定位）
import * as splitEditor from "./splitEditor"; // P4（C-4）：向右分屏（handlers 注入，防 settingsPanel 成环）
import { recordClosedTab, resetTabReopen, setTabReopenHandlers } from "./tabReopen"; // PR-A（dx_features_backlog §6.1）：重开关闭的标签
import { activeView } from "./views";
import * as lsp from "./lsp/client";
import * as kb from "./keybindings";
import { appendOutputLine, clearOutput, setOutputLevelColorsEnabled, setOutputTracebackHandler, setOutputUrlHandler } from "./output";
import { openConfirm } from "./dialog";
import { wireCursorStatus, refreshCursorStatus } from "./cursorStatus"; // T2：状态栏光标位置芯片
import { app, $, lazyEl, outputEl, statusFileEl, DEFAULT_SETTINGS, type SaveOptions, type Tab } from "./state";
import {
  isDirExpanded, isTreeEmpty, refreshTree, reloadDir, refreshTreeRunningClasses,
  renderCtxMenu, resetTreeState, scheduleFollowReveal, setFileTreeHandlers, wireFileTree, type CtxItem,
} from "./fileTree";
import {
  cleanupDiffTabState, currentDiffEditor, dismissDiffHost, presentDiffHost, refreshBranchPanel,
  refreshDiffIfViewing, refreshDiffOnActivate, refreshGitStatus, renderGitPanel, resetGitState,
  setDiffTabHandlers, setGitEditorBridge, setGitOpenFileHandler, setGitReloadHandler, wireGitUI,
} from "./git";
import {
  disposeTerminal, openTerminalAt, resetOutputChannelUi, setBottomTab,
  wireBottomPanel, wireTerminalEvents,
} from "./termUi";
import { addRunDataConsumer } from "./runDataBus"; // B5 §6.8：运行输出多播的消费方注册
import { setTerminalLinkHandler, setTerminalUrlHandler } from "./terminal";
import { setExternalUrlOpener } from "./termUi";
import { loadSettings, saveSettings, applyFontStatus, setSettingsPanelHandlers, wireSettingsPanel, buildEditorOptions, ensureEditorFontLoaded, clampFontSize } from "./settingsPanel";
import { checkFirstRunStorage } from "./storagePanel";
import { cancelPendingSessionSave, restoreSession, scheduleSessionSave, saveSessionNow, setSessionHandlers } from "./session"; // A-5 会话恢复
import { wireResourcePanel } from "./resourcePanel"; // A-1 资源可观测
import { basename, codicon, DisposableStore, emptyState, languageOf, normalizePath, parentDirOf, relativePathOrName, renderFileIcon, samePath, symbolIcon } from "./util";
import { toast, toastFail } from "./toast";
import { initI18n, onLocaleChange, t } from "./i18n"; // i18n 运行时：initI18n 首屏套用静态骨架，t 取动态文案
import { restoreLayout, wireSplitters } from "./layout";
import { motionDisabled, restoreReduceMotion } from "./anim";
import { wireTooltip } from "./tooltip";
import { renderEngineChip, setEngineBusy, setEngineChipHandlers, wireEngineChip } from "./engineChip";
import { setLspEngineStatus, setLspNote } from "./lspStatus";
import { renderRunWidget, setRunWidgetHandlers, setRunWidgetRepaint, wireRunWidget } from "./runWidget";
import { clearRunGutter, isRunGutterLine, refreshRunGutter, setRunGutterHandlers, wireRunGutter } from "./runGutter";
import { clearGitGutter, refreshGitGutter, scheduleGitGutter, wireGitGutter } from "./gitGutter"; // 迭代 2 · P0-5
import { wireGutterHover } from "./gutterHover";
import * as dap from "./dap/client";
import {
  clearCurrentLine, loadBreakpoints, refreshDebugGutter, resetBreakpoints, setBreakpointMenuHandler, wireDebugGutter,
} from "./debugGutter";
import { initTodoView, resetTodoView, setTodoViewHandlers } from "./todoView"; // P0：TODO 工具窗
import { getEndpointResults, highlightEndpoint, initEndpointView, resetEndpointView, setEndpointViewHandlers } from "./endpointView"; // F1：端点工具窗
import { initHotspotsView, resetHotspotsView, setHotspotsViewHandlers } from "./hotspotsView"; // A1：运行时热点
import { initDbView, resetDbView, refreshDbWorkspace } from "./sqliteView"; // B3：SQLite 数据库侧栏（资源管理器）
import { setDbTabHandlers, presentDbTab, cleanupDbTab, dismissDbHost, dbTabLabel, dbTabIcon, invalidateDbTokens } from "./sqliteTabs"; // B3：SQLite 编辑器 Tab（表数据 / SQL 查询）
import { initDebugView, renderDebugView, setDebugViewHandlers, wireDebugViewEvents } from "./debugView";
import { closeRecentFiles, initRecentFiles, setRecentFilesHandlers } from "./recentFiles"; // P0：最近打开的文件（Ctrl+E）
// P1（PyCharm 调研）：Search Everywhere / 导航历史 / 本地历史 / 调试控制台
import {
  initQuickOpen, invalidateQuickOpenFiles, openQuickOpen, closeQuickOpen,
  registerQuickOpenActions, setQuickOpenHandlers,
} from "./quickOpen";
import { noteOpen, pushCurrent, resetNavHistory, setNavHistoryHandlers } from "./navHistory";
import { initLocalHistory, closeLocalHistory, setLocalHistoryHandlers } from "./localHistory";
import { initEditHistory } from "./editHistory"; // 低延迟编辑预测数据源 V1：行对采集
// P2
import {
  initBreadcrumbs, invalidateBreadcrumbs, resetBreadcrumbs, scheduleBreadcrumbs, setBreadcrumbHandlers,
} from "./breadcrumbs";
import { initDebugConsole, clearDebugConsole } from "./debugConsole";
import { initInlineValues } from "./inlineValues";
import { lintActiveFile, resetRuffLint, scheduleRuffLint, setRuffLintHandlers } from "./ruffLint";
import { applyPydanticMarkersOnOpen, initPydanticDiagnostics, resetPydanticDiagnostics, schedulePydanticRescan, setPydanticDiagnosticsHandlers } from "./pydanticDiagnostics";
import { cleanupSaveContent } from "./saveCleanup"; // PR-C（dx_features_backlog §6.3）：保存清理
import { initEditPoints, resetEditPoints } from "./editPoints"; // PR-D（dx_features_backlog §6.4）：最近编辑位置
import {
  initBookmarks, loadBookmarks, closeBookmarks, refreshBookmarkGutter,
  resetBookmarks, setBookmarkHandlers,
} from "./bookmarks";
import {
  addRunLifecycleListener, initRunHistory, closeRunHistory, recordRunLines,
  resetRunHistory, setRunHistoryHandlers,
} from "./runHistory";
import { applyLogSettings, beginLogSession, endLogSession, initLogView, resetLogView, setLogViewHandlers } from "./logView"; // B5：结构化运行日志
import { insertTextIntoEditor } from "./editorInsert"; // B5：日志「插入编辑器」的外壳级实现
import { renderWelcomeShortcuts } from "./welcomeShortcuts"; // UI-25：欢迎页快捷键跟随键位系统
import * as mdPreview from "./markdownPreview"; // Markdown 预览（markdown preview dev plan）
// TD-14 拆分出的功能域：环境面板 / 新建项目 / 菜单栏机制 / 运行域 / 运行配置面板 / 输出链接
import {
  clearInterpreterStatus, currentInterpreter, declarePackage, initEnvPanel, initEnvPanelEvents,
  installMissingPackage, maybePromptToolchain, maybePromptVenv, refreshInterpreterStatus,
  resetEnvPanelState, openEnvPanel, onEnvPanelOpened, refreshPackagesIfOpen, repaintPkgBadgesIfOpen,
} from "./envPanel";
import { openNewProjectPanel, wireNewProject } from "./newProject";
import { wireCloneRepository } from "./cloneRepository";
import {
  handleTracebackLine, runOpenWorkspaceCheck, resetDepHealth, initDepHealth,
  setDepInstallHandler, wireDepHealthEvents,
} from "./depHealth";
import {
  initDepHealthPanel, renderDepHealth, resetDepHealthPanel, handleScanComplete, setHealthStatus,
  expandDepDetail,
} from "./depHealthPanel";
import { wireMenuBar } from "./menuBar";
import { openFileFromDisk, openSingleFile, setOpenFileEntryHandlers } from "./openFileEntry";
import { openInitialWorkspace, setLastSession, setStartupRestoreHandlers, wireStartupFileEvent } from "./startupRestore";
import {
  cleanupMdPreviewTab, dismissMdPreviewHost, mdPreviewSourcePath, mdPreviewTabIcon, mdPreviewTabLabel,
  openPreviewTab, presentMdPreviewTab, setMdPreviewTabHandlers,
} from "./mdPreviewTab";
import {
  initRunEvents, maybeSuggestFramework,
  resetRunSessionState, runScript, runProject, stopAllRuns,
  runSelection, runWidgetState, setRunFlowHandlers, stopRun, wireRunFlow,
  clearRunProfilesCache, rerunRecord,
} from "./runFlow";
import { openRunConfig, wireRunConfigPanel } from "./runConfigPanel";
import { gotoFromLink, setTracebackOpenFile } from "./tracebackLink";
import { isRunning, scriptRunActive, runningPathsOf } from "./runState";
import { installFindShortcut, setFindDiffEditorProvider } from "./editorFind";
import { installBrowserKeyGuard } from "./browserKeys";
import { runDebug, stopDebugSession } from "./debugEntry"; // 阶段二：调试入口域外提
import {
  buildQuickOpenActions, buildRunMenuItems, getMenuItems, setMenuItemsHandlers, showBreakpointMenu,
} from "./menuItems"; // 阶段二：菜单 / 命令面板数据源外提（main 私有动作经 setMenuItemsHandlers 注入解环）
import { setWindowKeyActions, wireWindowKeys } from "./windowKeys"; // 阶段二：全局键位路由外提（4 个 main 私有动作经 setWindowKeyActions 注入解环）
import { wireWindowChrome } from "./windowChrome"; // 阶段二：自绘标题栏与窗口边缘外提（无 main 私有依赖）
import { wireSidebarViews } from "./sidebarViews"; // 阶段二：侧栏视图注册表 + 活动栏外提（仅注入 refreshOutline）

// ---------- 模块级状态（本层私有；TD-14 后运行态归 runState.ts / runFlow.ts） ----------

let liveTemplatesHandle: LiveTemplatesHandle | null = null;
let searchCaseSensitive = false;
// PR-H（dx_features_backlog §6.6）：全局搜索的正则开关与文件掩码（会话内记忆，不落设置）
let searchUseRegex = false;
let searchFileGlob = "";
/** 文件监听防抖定时器 */
let fsWatchTimer: number | undefined;

// ---------- DOM ----------
// P2-6（2026-09-29 review）：顶层快照改惰性（铁律 1——模块加载期解析 DOM 会让
// 精简 DOM 测试环境 import 即炸，main 域因此一直无法单测）。
const tabbarEl = lazyEl("tabbar");
const outlineEl = lazyEl("outline");

// ---------- 工作区 ----------

/** CR-13：编辑器防抖 timer 集中管理（原为 init() 局部闭包，工作区切换/关闭无法清理，
 * autosave 会在 tab 已 dispose 后触发，旧工作区未存修改被静默丢弃） */
const editorTimers = {
  change: undefined as number | undefined,
  outline: undefined as number | undefined,
  /** autosave delay 模式：每个脏 tab 独立计时（path → timer；对标 VSCode 语义，
   *  后台 tab 的编辑静默到期也落盘，不再是只存 activeTab） */
  autosave: new Map<string, number>(),
  gutter: undefined as number | undefined,
  /** P1-8（2026-09-29 review）：断点/书签 gutter 防抖槽位——此前两处裸 setTimeout
   *  既不 clear 前值也不入集中管理，快速输入 N 字符 = N 次全量重算，且工作区切换后
   *  clearAll 清不到（靠 refreshXxx 内部判空兜底）。 */
  debug: undefined as number | undefined,
  bookmark: undefined as number | undefined,
  /** 全部 clearTimeout（切换/关闭工作区时调用，防旧工作区回调跨生命周期触发） */
  clearAll(): void {
    window.clearTimeout(this.change);
    window.clearTimeout(this.outline);
    for (const t of this.autosave.values()) window.clearTimeout(t);
    this.autosave.clear();
    window.clearTimeout(this.gutter);
    window.clearTimeout(this.debug);
    window.clearTimeout(this.bookmark);
    this.change = this.outline = this.gutter = this.debug = this.bookmark = undefined;
  },
  /** 清除指定文件的 autosave 计时器（关闭 tab 时调用，防 dispose 后回调触发） */
  clearAutosave(path: string): void {
    const t = this.autosave.get(path);
    if (t !== undefined) {
      window.clearTimeout(t);
      this.autosave.delete(path);
    }
  },
};

/** 切换/关闭工作区时的共享 UI 复位：清理旧工作区残留的可视内容与内存状态 */
function resetWorkspaceUiState(): void {
  editorTimers.clearAll();      // CR-13：防抖 timer 全清（autosave 不再跨工作区触发）
  app.pendingChanges.clear();   // CR-13：在途文档同步一并作废
  outlineToken++;               // CR-20：作废在途大纲请求
  clearOutput(outputEl);        // 输出面板（调试输出 / traceback）
  clearDebugConsole();          // P0（2026-09-30 审计）：调试控制台 #debug-console-log——renderDebugView/onShow 均不覆盖，唯一清空入口 clearDebugConsole 此前零调用
  resetGitState();              // git 状态 + diff 视图 + 分支列表
  outlineEl.textContent = "";   // 大纲符号树
  resetSearch();                // 搜索结果 + 作废在途请求
  resetFindUsages();            // 查找引用结果面板 + 行缓存
  resetTodoView();              // P0：TODO 列表 + 作废在途扫描
  resetEndpointView();          // F1：端点列表 + 作废在途扫描
  resetEpJump();                // A5③：端点 CodeLens 索引随工作区失效
  resetOpenApiPreview();        // A5④：OpenAPI 预览展开态与缓存随工作区失效
  resetHotspotsView();          // A1：运行时热点结果 + 作废在途扫描
  resetDbView();                // B3：数据库连接态 / 对象树 / 结果 + 作废在途请求
  invalidateDbTokens();         // B3 v1.4：db Tab 的在途查询响应一并作废
  resetNavHistory();            // P1：导航历史（跨工作区的历史没有意义）
  invalidateQuickOpenFiles();   // P1：工作区文件清单缓存随工作区失效
  resetBreadcrumbs();           // P2：面包屑（含符号缓存与防抖 timer）
  resetRuffLint();              // P2：ruff lint（防抖 timer + 在途请求）
  resetPydanticDiagnostics();   // 阶段 4：Pydantic 诊断（timer + 在途请求 + 栈状态）
  resetProblemsPanel();         // 问题面板（防抖 timer + 过滤态复位；marker 随 model 销毁自然清空）
  splitEditor.resetSplitEditor(); // C-4：分屏随工作区切换收起（快照不含分屏态）
  resetQuickFixCache();          // P4：自研快速修复的符号来源缓存随工作区失效
  resetBookmarks();             // P2：书签（列表缓存 + gutter 装饰）
  resetBreakpoints();           // P2-11：断点内存表随工作区切换清空（盘上数据按工作区隔离）
  resetRunHistory();            // P2：运行历史（§15：切换/关闭工作区重置）
  resetLogView();               // B5：结构化运行日志（§6.7.2：任意相位 → idle，清空 + 解绑）
  resetEnvPanelState();          // 环境域状态（包面板 + 解释器缓存 + 在途请求令牌 + 提示去重）
  resetDepHealth();              // 依赖健康域（在途体检令牌作废 + diff 快照清空，dep plan §4.7 规则 4）
  resetDepHealthPanel();         // 健康面板 UI 投影（横幅/tab/折叠态/状态栏图标，dep plan M3）
  ($("search-input") as HTMLInputElement).value = ""; // 清空搜索关键词
  // P1（2026-09-30 审计）：文件掩码同属工作区级输入，残留会让新工作区首次搜索被旧掩码
  // 静默过滤（*.py 残留 → 搜 .txt 无结果）；内存态 searchFileGlob 一并复位
  ($("search-mask") as HTMLInputElement).value = "";
  searchFileGlob = "";
  // v3.4 §15（M3-3.10）：停全部运行实例（teardownCurrent 已停止）+ 清实例表 + 清配置缓存
  resetRunSessionState();
  clearRunGutter(); // C5：切换/关闭工作区清空 gutter ▶
  clearGitGutter(); // 迭代 2 · P0-5：git 行级装饰一并清空
  clearCurrentLine(); // D4：清调试当前行高亮
  renderDebugView(); // D4：调试侧栏复位到 idle 呈现
}

/** 清理当前工作区（关闭标签 + 停 LSP + 销毁终端）；有未保存修改时先确认，取消则返回 false */
async function teardownCurrent(): Promise<boolean> {
  if (app.workspaceRoot) {
    // A-5：草稿会随会话快照保留（重开工作区自动恢复），故文案不再是「将丢失」——
    // 保留确认（用户仍应知道有未落盘的改动），但不再暗示数据会没。
    if (app.tabs.some((t) => t.dirty) && !(await openConfirm({ message: t("main.confirm.closeWorkspace"), kind: "danger" }))) {
      return false;
    }
    // v3.4 §15（M3-3.10）：切换/关闭工作区前停掉**全部**运行实例（脚本 + 所有项目实例）。
    // 否则后端进程会变成孤儿继续跑，而前端运行态随后被 resetWorkspaceUiState 复位，
    // 用户就再也没有停止入口了（§7.1 不变式：状态与进程同生共死）。
    // 调试清理走 debug_stop 独立链路（§13.5），不在此处覆盖。
    if (isRunning()) await stopAllRuns();

    // 调试会话同理（§8 坑 7）：关闭工作区必须停调试，否则 debugpy 进程树成孤儿。
    if (dap.currentPhase() !== "idle" && dap.currentPhase() !== "exited") {
      await dap.stopDebug();
      dap.resetDebugState();
    }

    // CR-30：teardown 计时改 console.debug（绕过日志系统的 console.log 清理；release 默认不显示）
    let t0 = performance.now();
    console.debug("[teardown] closeTabs begin, tabs=", app.tabs.length);
    // A-5：关标签之前先落一次会话快照（tab / 光标 / 未保存草稿），下次打开原地恢复
    await saveSessionNow();
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

// P1-9（2026-09-29 review）：openWorkspace / closeWorkspace 的并发互斥。
// 原实现「检查（workspaceRoot）→ await teardownCurrent（含确认弹窗可达数秒）→ 置位」，
// 窗口期内第二路并发进入会再次走完整 teardown + 双份 refreshTree/startLsp/restoreSession
// 交错（LSP 双启动）。同步置位互斥标志，finally 复位。
let wsSwitching = false;

async function openWorkspace(root: string): Promise<void> {
  if (wsSwitching) return; // 已有切换在进行：丢弃并发调用
  // 复核注记（2026-09-30）：丢弃语义是有意取舍——并发场景主要是「启动自动恢复在途 +
  // 用户主动选新目录」，此时丢弃的是**用户请求**（不理想，用户需重试一次）；备选方案
  // 「排队最后一次」需处理排队合并与取消，复杂度不成比例。若后续用户反馈「点了没反应」
  // 再升级为排队语义。串行损坏（双 teardown / LSP 双启动）的防护优先。
  wsSwitching = true;
  try {
  // T3 打点（M0 体验度量拆解）：openWorkspace 各阶段耗时。console.debug 与 teardown 计时同款，
  // release 默认不显示、零行为变更；排查「窗口出现→文件树可见」的 4.5s 去向时按段读数。
  const tWs = performance.now();
  const wsMark = (label: string) => console.debug(`[openWorkspace] ${label} +${(performance.now() - tWs).toFixed(0)}ms`);
  // 切换工作区：先清理旧工作区状态
  if (app.workspaceRoot && app.workspaceRoot !== root) {
      if (!(await teardownCurrent())) return;
      cancelPendingSessionSave(); // A-5：teardown 已同步存过旧工作区快照，挂起的防抖不得用新 root 覆盖
      await stopFileWatcher();
      resetWorkspaceUiState();
    }
    app.workspaceRoot = root;
    $("tree-header-text").textContent = root;
    wsMark("前置清理完成");
    // P2：书签按工作区持久化，换工作区要重新加载（并刷新 gutter 装饰）
    await loadBookmarks();
    refreshBookmarkGutter();
    // P2-11（UX 审查）：断点同样按工作区持久化——回填后重绘当前文件的红点
    await loadBreakpoints();
    refreshDebugGutter();
    wsMark("书签+断点加载");
    // Markdown 预览：动态授权 asset 协议读取当前工作区根（本地图片渲染）
    await invoke("allow_asset_dir", { path: root }).catch(console.error);
    await invoke("add_recent_workspace", { path: root }).catch(console.error);
    wsMark("asset 授权+recent 登记");
    await refreshTree();
    wsMark("refreshTree 完成（文件树可见）");
    await invoke("sweep_run_configs", { workspaceRoot: root }).catch(console.error); // tech-debt #9：打开工作区清扫孤儿运行配置
    await loadTemplatesConfig();
    wsMark("配置清扫+模板加载");
    await refreshInterpreterStatus(); // 先确定解释器，供 startLsp/run 使用
    wsMark("解释器探测");
    await startLsp();
    wsMark("startLsp 返回（引擎 spawn，ready 异步）");
    // 依赖健康体检（dep plan §4.7，M1 形态）：后台数据采集，绝不阻塞打开流程——
    // L0 style 判定先行，1.5s 后若 venv 确认/工具链引导等弹窗在前台则排队轮询（R13 弹窗优先），
    // 结果只进输出面板一行摘要（无横幅无弹窗，M3 才上 UI 投影）
    void runOpenWorkspaceCheck(root);
    await maybePromptVenv();
    await startFileWatcher(); // 启动文件监听
    await restoreSession(); // A-5：恢复上次现场（标签 / 光标 / 未保存草稿）
    wsMark("venv 提示+watcher+会话恢复完成");
    // 框架探针表（P1：Django / Flask / FastAPI）：仅提示，不打扰；工作区级可关闭
    void maybeSuggestFramework();
    // 阶段 4：Pydantic 构造校验诊断（第四桶）——栈命中才扫描，后台进行不阻塞打开流程
    void initPydanticDiagnostics(root);
    // import 别名频率学习：缓存秒生效 + 后台重扫回写，失败静默（importAlias 域）
    void refreshImportAliases(root);
    resetAutoImportIndex(); // PR-E：工作区切换后 auto-import 索引按新根重建（TTL 兜底文件变更）
    // PR review（dx_features_backlog §6.5）：跨工作区残留一并清空——重开栈与编辑点栈
    resetTabReopen();
    resetEditPoints();
    // P1-3（2026-09-30 审计）：切换工作区时若用户停在 git 视图，teardown 阶段的空态渲染
    // 后不会再有 onShow 触发——补一次与新仓库数据的同步刷新（refreshTree 内部的
    // refreshGitStatus 只更新内存，不重渲染面板 DOM）。
    if (activeView() === "git") {
      renderGitPanel();
      void refreshBranchPanel();
    }
    // B3（§10.3-8b 真机发现）：数据库视图若在自动恢复工作区完成前初始化，会停在
    // 「未打开工作区」空态且无 onShow 触发——工作区就绪后补一次状态刷新。
    refreshDbWorkspace();
    updateEditorOverlay();
    // 启动恢复终态：工作区成功打开 → 记录 (true, root)，下次启动据此恢复
    await setLastSession(true, root);
    // 单实例路由注册表：主窗口工作区上报（Rust 侧「文件 ∈ 已开工作区」判定用）
    await invoke("report_main_workspace", { workspace: root }).catch(console.error);
  } finally {
    wsSwitching = false;
  }
}

/** 关闭当前工作区，回到无工作区状态 */
async function closeWorkspace(): Promise<void> {
  if (!app.workspaceRoot) return;
  if (wsSwitching) return; // P1-9：与 openWorkspace 互斥（交叉并发防双 teardown）
  wsSwitching = true;
  try {
    if (!(await teardownCurrent())) return;
    const t0 = performance.now();
    console.debug("[closeWorkspace] stopFileWatcher begin");
    await stopFileWatcher();
    console.debug("[closeWorkspace] stopFileWatcher done, took=", (performance.now() - t0).toFixed(0), "ms");
    resetWorkspaceUiState();
    closeRecentFiles(); // 最近文件是工作区级的，切换工作区后旧列表不应还能被打开
    // P2（2026-09-30 审计）：工作区级弹层一并收口——开着弹层关工作区时，候选列表/历史
    // 残留旧工作区数据且动作按钮已失效（内存已清、DOM 仍旧数据）。统一关闭最干净。
    closeQuickOpen();          // Ctrl+P 候选列表（点旧条目会打开已关闭工作区的文件）
    closeRunHistory();         // 运行历史（重放按钮指向已清空的 runs 表，静默 no-op）
    closeBookmarks();          // 书签列表（items 已随 resetBookmarks 清空）
    closeLocalHistory();       // 本地历史（针对当前文件，工作区关闭后无意义）
    app.workspaceRoot = null;
    resetTreeState();
    $("tree-header-text").textContent = t("tree.treeHeaderText"); // UI-13：与 index.html 静态词条同 key（第二十批 i18n）
    statusFileEl.textContent = "";
    clearInterpreterStatus();
    // P1-3 补充：resetWorkspaceUiState 先于本行执行，其 renderGitPanel 走「不是 Git 仓库」
    // 分支（gitRepoActive 已 false 但 root 未清）。root 置 null 后补一次终态渲染——
    // 文案修正为「尚未打开工作区」空态，避免误导用户以为要 git init。
    renderGitPanel();
    // 框架提示去重为工作区级，关闭工作区即清空
    clearRunProfilesCache();
    // 阶段 2：Pydantic 字段改名提示的会话去重同样工作区级
    resetPydanticRenameWarn();
    renderRunWidget(runWidgetState());
    updateEditorOverlay();
    // 启动恢复终态：用户明确关闭工作区 → 记 (false, null)，下次启动不再自动恢复
    //（recent-workspaces 列表保留——菜单「最近的工作区」语义不变）
    await setLastSession(false, null);
    // 单实例路由注册表：主窗口已无工作区（第二实例双击的文件不再命中本窗口）
    await invoke("report_main_workspace", { workspace: null }).catch(console.error);
  } finally {
    wsSwitching = false;
  }
}

/** 根据当前状态刷新编辑区覆盖层：
 *  - 已打开文件 → 隐藏
 *  - 无工作区 → 完整 Get Started（含快捷入口与最近工作区）
 *  - 有工作区但未打开文件 → 仅保留品牌与快捷键，隐藏快捷入口与最近工作区
 *  PR-S2c（MB-13 收口）：forceWelcome 态下即使有 activeTab / workspaceRoot 也显示**完整版**
 *  overlay（actions + quickstart + tour + recents 全显）——纯显示层覆盖，不动会话真值。 */
function updateEditorOverlay(): void {
  const overlayEl = $("editor-overlay");
  const actionsEl = $("ew-actions");
  const recentEl = $("ew-recent-section");
  const quickstartEl = $("ew-quickstart");
  const tourEl = $("ew-tour-section");
  const forceCloseEl = $("ew-force-close");

  if (app.activeTab && !isWelcomeForced()) {
    overlayEl.classList.add("hidden");
    return;
  }

  overlayEl.classList.remove("hidden");
  // PR-S2c 补丁（欢迎页被宿主浮层遮挡 bug）：diff/db/md 预览宿主都是 #editor-row 内
  // z-index:20 的浮层，而 overlay 是 z-index:5——force 态（帮助菜单「欢迎页」）在这些
  // Tab 激活时会被整个盖住。force 态提层级到 30（盖过所有宿主），解除时还原。
  overlayEl.classList.toggle("forced", isWelcomeForced());
  // UI-25：覆盖层要显示了才重绘快捷键网格（改键后 / 设置加载完成后经此路径刷新为真实键位）
  renderWelcomeShortcuts();
  // PR-S2：三步卡与巡礼同口径重绘（键位标签跟随改键；巡礼完成态即时刷新）
  renderQuickstartCards();
  renderTour();

  const forced = isWelcomeForced();
  forceCloseEl.classList.toggle("hidden", !forced);

  if (app.workspaceRoot && !forced) {
    actionsEl.classList.add("hidden");
    quickstartEl.classList.add("hidden");
    tourEl.classList.add("hidden");
    recentEl.classList.add("hidden");
    return;
  }

  actionsEl.classList.remove("hidden");
  quickstartEl.classList.remove("hidden");
  tourEl.classList.remove("hidden");
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
    remove.dataset.tip = t("main.recent.remove");
    // 图标按钮：内部 <i> 带 aria-hidden，可访问名称原先仅由 title 提供，须同步补 aria-label
    remove.setAttribute("aria-label", t("main.recent.remove"));
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
    toastFail(t("main.recent.clear"), e);
  }
  void renderEditorWelcomeRecents();
}

/** 删除单条最近工作区并刷新 Welcome 页 */
async function removeRecentWorkspace(path: string): Promise<void> {
  try {
    await invoke("remove_recent_workspace", { path });
  } catch (e) {
    console.warn("删除最近工作区失败", e);
    toastFail(t("main.recent.removeOne"), e);
  }
  void renderEditorWelcomeRecents();
}

/** 启动恢复终态 + argv 启动文件（2026-10-10 用户报告双 bug）已外提 startupRestore.ts；
 *  本文件只保留 openWorkspace / closeWorkspace 末尾的 setLastSession 写入（一行一调用）。 */

/** 多窗口启动路径（含 argv 双击文件 / last-session 终态恢复）——startupRestore.ts 承担 */

/** 工具栏「📂 打开」：弹文件夹选择框并切换工作区 */
async function openFolderFromToolbar(): Promise<void> {
  const path = await invoke<string | null>("pick_folder");
  if (!path) return;
  await openWorkspace(path);
}

/** 「在新窗口打开工作区」：弹文件夹选择框（挑选后经后端新开项目窗口，去重由后端承担） */
async function openFolderInNewWindow(): Promise<void> {
  const path = await invoke<string | null>("pick_folder");
  if (!path) return;
  await invoke("open_workspace_window", { path }).catch((e) => toastFail(t("main.recent.openInNewWindow"), e));
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

/** tab 的相对路径（规则见 util.relativePathOrName） */
function relativePathOfTab(path: string): string {
  return relativePathOrName(app.workspaceRoot, path);
}

/** 复制文本到系统剪贴板（tab 右键菜单）；成功静默、失败弹提示（与 fileTree.copyPaths 一致） */
async function copyTabPath(text: string): Promise<void> {
  try {
    await invoke("copy_to_clipboard", { text });
  } catch (e) {
    console.error("复制路径失败", e);
    toastFail(t("main.recent.copyPath"), e);
  }
}

/** 标签右键菜单（P25-T08） */
function showTabContextMenu(tab: Tab, x: number, y: number): void {
  activateTab(tab);
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
  const items: CtxItem[] = [
    { label: t("main.tab.close"), action: () => void closeTab(tab) },
    { label: t("main.tab.closeOthers"), action: () => void closeOthersExcept(tab) },
    { label: t("main.tab.closeRight"), action: () => void closeTabsRightOf(tab) },
    { label: t("main.tab.closeAll"), action: () => void closeAllTabs() },
    { sep: true },
    // 复制路径三件套（对齐 VSCode：Copy Name / Copy Relative Path / Copy Path）
    { label: t("main.tab.copyName"), action: () => void copyTabPath(basename(tab.path)) },
    { label: t("main.tab.copyRelPath"), action: () => void copyTabPath(relativePathOfTab(tab.path)) },
    // PR-A（dx_features_backlog §6.1）：file:line 引用（相对工作区根，贴 issue/聊天可直点）
    { label: t("main.tab.copyFileLine"), action: () => void copyTabPath(`${relativePathOfTab(tab.path)}:${app.editor.getPosition()?.lineNumber ?? 1}`) },
    { label: t("main.tab.copyAbsPath"), action: () => void copyTabPath(tab.path) },
    { label: t("main.tab.openInTerminal"), action: () => void openTerminalAt(parentDirOf(tab.path)) },
    { label: t("main.tab.revealInExplorer"), action: () => invoke("reveal_in_explorer", { path: tab.path }).catch(console.error) },
  ];
  // P3（建议 2）：Python 脚本可编辑持久化运行配置（Parameters / 环境变量）
  // v3.4 §8（M3-3.4）：标签右键入口对齐四控件运行组——「运行脚本 / 运行项目 / 运行配置…」
  //（「在终端中运行」已删：运行统一走终端控制台，双入口等价无意义，§6.5）
  if (isPy) {
    items.splice(
      5,
      0,
      { label: t("main.run.script"), action: () => void runScript(tab.path) },
      { label: t("main.run.project"), action: () => void runProject() },
      { label: t("main.run.config"), action: () => void openRunConfig(tab.path) },
      { sep: true },
    );
  }
  // Markdown 预览（markdown preview dev plan §5-T4）：.md tab 右键开关分栏预览 +
  // open_file_dev_plan 补入口：编辑 tab「切换到预览模式」（开纯预览 Tab 并激活，
  // 编辑 Tab 保留后台——dirty 草稿不丢，切回一键即回）。
  if (mdPreview.isMarkdownPath(tab.path)) {
    const open = mdPreview.isPreviewOpen();
    items.splice(
      5,
      0,
      { label: open ? t("main.tab.previewClose") : t("main.tab.previewOpen"), action: () => mdPreview.setPreviewOpen(!open) },
      { label: t("main.tab.switchToPreview"), action: () => openPreviewTab(tab.path) },
      { sep: true },
    );
  }
  renderCtxMenu(items, x, y);
}

async function closeTabsQuiet(list: Tab[]): Promise<void> {
  if (list.length === 0) return;
  if (list.some((t) => t.dirty) && !(await openConfirm({ message: t("main.confirm.closeTabs"), kind: "danger" }))) return;
  for (const t of [...list]) {
    closeTabSilent(t);
    if (t.kind !== "diff") recordClosedTab(t.path); // PR-A：批量关闭同样入重开栈（按关闭顺序栈顶=最后关闭）
  }
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
  // v3.4 §18 裁决 3：auto_rerun 已删（框架自带 reload，纯脚本手动重跑够用），监听回调只剩通用防抖刷新
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
    // 体验修复（用户报告）：编辑器改文件后 SCM 面板不实时更新，须切走再切回——
    // 此前只刷内存不重渲染。git 视图可见时立即重绘（不可见则等 onShow 兜底渲染）
    if (activeView() === "git") {
      renderGitPanel();
    }
    // 体验修复第 2 则：活动 diff tab 正展示某文件时，该文件变更 → 差异内容自动重拉
    //（第 2 步迁移后 diff 在编辑区 tab；防抖与冲突保护在 refreshDiffIfViewing 内部）
    if (app.activeTab?.kind === "diff") {
      for (const dir of dirs) refreshDiffIfViewing(dir);
    }
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
    // open_file_dev_plan §1.2：纯 md 工作区跳过引擎后，watcher 发现新增 .py/.pyw → 后补启动
    // （用户把纯笔记目录逐步变成代码仓库时功能不缺失）。lspSkippedForNoPy 带 root 校验防跨工作区误触发。
    if (root && lspSkippedForNoPy === root) {
      const hasNewPy = dirs.some((d) => {
        const n = normalizePath(d);
        return n.endsWith(".py") || n.endsWith(".pyw");
      });
      if (hasNewPy) {
        lspSkippedForNoPy = null;
        void startLsp();
      }
    }
    // Live Templates 热重载（M2）：工作区层 <ws>/.opencharm/ 或用户层 <data_root>/config 变更。
    // TD-027 A6：原 `endsWith("/config")` 把工作区任意 xxx/config 变更也当成模板配置——收紧。
    // 取舍：OPENCHARM_DATA_ROOT 重定向到非默认路径时用户层外部编辑的热重载失效（面板内保存不受影响）。
    if (
      dirs.some((d) => {
        const n = d.toLowerCase().replace(/\\/g, "/");
        return n.endsWith("/.opencharm") || n.endsWith("/.opencharm/config") || n.endsWith("/opencharm/config");
      })
    )
      await loadTemplatesConfig();
  }, 200);
}

// ---------- 符号大纲（P25-T07）+ 全局搜索 ----------

/** 搜索匹配点击 → 打开文件并定位到匹配处 */
async function openSearchMatch(m: SearchMatch): Promise<void> {
  await openFile(m.path, m.line);
  app.editor.setPosition({ lineNumber: m.line, column: m.column });
  app.editor.revealLineInCenter(m.line);
  app.editor.focus();
}

/** 执行搜索（工作区未打开时忽略；E-5：scope 支持 当前文件 / 打开的标签 / 整个工作区） */
async function executeSearch(): Promise<void> {
  if (!app.workspaceRoot) return;
  const input = $("search-input") as HTMLInputElement;
  const mode = ($("search-scope") as HTMLSelectElement).value as SearchScopeMode;
  let scope: SearchScope | undefined;
  if (mode === "file") {
    const t = app.activeTab;
    // 无普通文件 tab（未打开/diff 视图）时给空列表 →「已扫描 0 个文件」空态；
    // 静默回退全工作区搜索反而误导（scope 选择与实际行为不符）
    scope = { mode, paths: t && t.kind !== "diff" ? [t.path] : [] };
  } else if (mode === "tabs") {
    // 只搜普通文件 tab（diff 视图的 path 是仓库相对路径，不是可读文件路径）
    scope = { mode, paths: app.tabs.filter((t) => t.kind !== "diff").map((t) => t.path) };
  }
  // PR-H：正则 / 掩码两个开关随每次搜索透传（workspace 走 Rust，scope 走 TS 筛选器，语义一致）
  await runSearch(app.workspaceRoot, input.value, searchCaseSensitive, $("search-results"), scope, {
    useRegex: searchUseRegex,
    fileGlob: searchFileGlob,
  });
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
    outlineEl.appendChild(emptyState("symbol-misc", t("main.outline.noSymbols"), undefined, true));
    return;
  }
  renderOutlineSymbols(outlineEl, symbols, 0);
}

/** CR-13：串行冲刷待同步的文档变更——changeTimer 回调与补全前钩子共用。
 * 原来 for 循环内并发 fire-and-forget 多条 didChangeFull，invoke 到达顺序不保证 →
 * version 乱序，引擎文档状态错乱。此处逐条 await 保证 version 单调递增送达。 */
async function syncPendingChanges(): Promise<void> {
  for (const [path, changes] of [...app.pendingChanges]) {
    app.pendingChanges.delete(path);
    const t = app.tabs.find((x) => x.path === path);
    if (t) {
      await lsp.didChange(path, t.model, changes);
    }
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
/** P1（2026-10-08 review）：已注册 change handler 的 model 集合——防止 model 复用
 *  分支（CR-08 防线二）重复注册导致 pendingChanges 双倍累积。WeakSet 随 model 释放。 */
const modelChangeHandled = new WeakSet<MonacoApi.editor.ITextModel>();

/** openFile 选项 */
export interface OpenFileOptions {
  /** 打开后是否把焦点交给编辑器（默认 true）。文件树单击/键盘打开传 false：
   *  焦点留在树内可继续浏览与键盘漫游（VSCode/PyCharm 同款）——修复 tree 点击
   *  已打开文件时焦点被编辑器抢走的回归（activateTab 焦点改造引入）。 */
  focusEditor?: boolean;
  /** open_file_dev_plan §1.3：md 文件打开方式覆盖（默认读 settings.markdown_open_mode）。
   *  "edit" = 强制编辑 tab（文件树双击 / 预览「编辑源码」/ markdown 链接跳转等显式编辑意图）。 */
  mdMode?: "edit";
}

export async function openFile(path: string, revealLine?: number, opts?: OpenFileOptions): Promise<void> {
  // CR-08：in-flight 去重——双击/多入口并发打开同一文件时，两次调用都查不到 tab、
  // 都进 read_file → createModel 对重复 URI 返回既有 model → 两 Tab 持同一 model，
  // closeTabSilent dispose 掉另一个仍在用的 model。以归一化路径（斜杠/大小写无关）为键串行化，
  // 后续调用 await 同一个 Promise（含 gotoFromLink / openSearchMatch / 历史重跑双击路径）。
  const key = normalizePath(path);
  const inflight = openFileInflight.get(key);
  if (inflight) {
    await inflight;
    await revealAfterOpen(path, revealLine);
    return;
  }
  const p = doOpenFile(path, revealLine, opts);
  openFileInflight.set(key, p);
  try {
    await p;
  } finally {
    openFileInflight.delete(key);
  }
}

/** CR-08：openFile 的实际执行体（由 in-flight 去重表保证同一 path 串行） */
async function doOpenFile(path: string, revealLine?: number, opts?: OpenFileOptions): Promise<void> {
  // open_file_dev_plan §1.3：md 文件按设置分流——preview（默认）开只读预览 Tab；
  // split = 编辑 tab + 自动开分栏；edit（显式意图或设置）走下方正常编辑路径。
  // 显式 opts.mdMode="edit" 一律强制编辑（双击 / 编辑源码按钮 / 链接跳转）。
  if (mdPreview.isMarkdownPath(path) && opts?.mdMode !== "edit") {
    const mode = app.settings.markdown_open_mode ?? "preview";
    if (mode === "preview") {
      // 已有该文件的编辑 tab → 激活它（不重复开预览；预览与编辑互斥但共享 openFile 入口）
      const editTab = app.tabs.find((x) => x.kind !== "md" && samePath(x.path, path));
      if (editTab) {
        activateTab(editTab, opts?.focusEditor === false ? { focusEditor: false } : undefined);
        await revealAfterOpen(editTab.path, revealLine);
        return;
      }
      openPreviewTab(path);
      await revealAfterOpen(path, revealLine);
      return;
    }
    if (mode === "split") {
      // 分栏模式：正常开编辑 tab，随后自动开预览分栏（现有 setPreviewOpen 通道）
      mdPreview.setPreviewOpen(true);
    }
  }
  // P1：导航历史——先记「离开前的位置」，末尾记「到达的位置」，后退才能回到出发点
  pushCurrent();
  // 路径等价比较用 samePath（斜杠/大小写无关）：会话恢复的 tab 路径与文件树/Rust
  // 返回的路径分隔符方向可能不同（如 D:\proj/src/a.py vs D:\proj\src\a.py），
  // 严格 === 会导致同一文件开出第二个标签。
  let tab = app.tabs.find((t) => samePath(t.path, path));
  if (!tab) {
    let content: string;
    try {
      content = await invoke<string>("read_file", { path });
    } catch (e) {
      // 大文件守卫 / 目录 / 编码错误等：toast 呈现而非静默 unhandled rejection
      toast(t("main.openFile.failed", { msg: String(e) }), "error");
      return;
    }
    // CR-08：并发防线二——创建前再查既有 model 命中则复用（防其它入口已建）
    const uri = app.monaco.Uri.file(path);
    const existing = app.monaco.editor.getModel(uri);
    // P1（2026-10-08 review）：rename 后的过期引用防线——model URI 创建后不可变，
    // rename a.py→b.py 时 tab.path/model.__opencharmPath 已迁移到新路径，但过期引用
    // （搜索结果/引用面板/LSP 未更新期的 traceback 链接）仍指向旧路径 a.py：
    // getModel(旧uri) 命中 b.py 的 model → 若不拦会开出共享同一 model 的第二个 tab
    // （关一个 dispose 另一个跟着坏）。此时按 model 的真实归属重定向到既有 tab。
    if (existing) {
      const owner = lsp.modelPath(existing);
      const ownerTab = owner ? app.tabs.find((x) => x.model === existing) : undefined;
      if (owner && !samePath(owner, path) && ownerTab) {
        activateTab(ownerTab, opts?.focusEditor === false ? { focusEditor: false } : undefined);
        await revealAfterOpen(ownerTab.path, revealLine);
        return;
      }
    }
    const model = existing ?? app.monaco.editor.createModel(content, languageOf(path), uri);
    model.updateOptions({ tabSize: app.settings.tab_size, insertSpaces: app.settings.insert_spaces }); // P1 缩进设置
    lsp.markModelPath(model, path);
    // P1（2026-10-08 review）：change handler 只在**首次**为该 model 注册——
    // 复用命中（CR-08 并发防线二）时若再注册一次，pendingChanges 会双倍累积、
    // 脏标记重复触发。WeakSet 随 model 释放，无泄漏面。
    if (!modelChangeHandled.has(model)) {
      modelChangeHandled.add(model);
      model.onDidChangeContent((e) => {
        const t = app.tabs.find((x) => x.model === model);
        if (t && !t.dirty) {
          t.dirty = true;
          renderTabs();
        }
        // 累积增量编辑（200ms 防抖后发；basedpyright 走增量、pyrefly 由 lsp.didChange 回落全量）
        if (t) {
          const acc = app.pendingChanges.get(t.path) ?? [];
          acc.push(...e.changes);
          app.pendingChanges.set(t.path, acc);
        }
        scheduleSessionSave(); // A-5：编辑后刷新会话快照（草稿随内容一起留存）
        // autosave delay 模式：每个文件独立计时（model 级监听，后台 tab 的编辑也触发）
        if (t) scheduleAutosave(t.path);
      });
    }
    tab = { path, model, dirty: false };
    app.tabs.push(tab);
    lsp.didOpen(path, model);
    // 应用引擎已发布的诊断（打开前就收到的 publishDiagnostics）
    lsp.applyCachedDiagnostics(path, setMarkers);
    // 阶段 4：第四桶同款回放（扫描完成时文件未开 → marker 挂不上；打开时从缓存补）
    applyPydanticMarkersOnOpen(path);
  }
  activateTab(tab, opts?.focusEditor === false ? { focusEditor: false } : undefined);
  void recordRecent(path);
  revealAfterOpen(path, revealLine);
  // P1：记录到达位置（未指定行时取编辑器当前行，与用户所见一致）
  noteOpen(path, revealLine ?? app.editor.getPosition()?.lineNumber ?? 1);
}

/** CR-08：打开完成后按需跳行（去重等待路径也要走，故独立成函数） */
function revealAfterOpen(path: string, revealLine?: number): void {
  if (revealLine === undefined) return;
  const tab = app.tabs.find((t) => samePath(t.path, path));
  if (tab && app.activeTab === tab) {
    app.editor.revealLineInCenter(revealLine);
    app.editor.setPosition({ lineNumber: revealLine, column: 1 });
  }
}

function activateTab(tab: Tab, opts?: { focusEditor?: boolean }): void {
  // 帮助菜单「欢迎页」是纯显示层 force 覆盖（welcomeGuide.ts §6 决策 4）：一旦激活任何内容 tab
  // （文件树打开文件 / 切标签 / 关标签后自动激活下一个），说明用户已回到内容——必须解除覆盖，
  // 否则新打开的文件被欢迎页整层盖住看不见（严重可用性 bug）。置于最前，末尾的
  // updateEditorOverlay 才会按真实态（有 activeTab）隐藏覆盖层。
  consumeWelcomeForce();
  // v1.4 Tab 化：宽屏 hack 已退役，无需在此归位（历史见 sqlite_tool_dev_plan.md §16）
  // 切标签记忆视图状态：离开前保存前一文件 tab 的光标/滚动，切回时恢复
  const prev = app.activeTab;
  if (prev && prev !== tab && prev.kind !== "diff" && app.editor.getModel() === prev.model) {
    prev.viewState = app.editor.saveViewState() ?? undefined;
  }
  app.activeTab = tab;
  scheduleSessionSave(); // A-5：切标签后刷新会话快照（恢复期间由 session.ts 的 restoring 标志屏蔽）
  if (tab.kind === "diff") {
    // 第 2 步迁移：diff tab——主编辑器隐藏（宿主由 git.presentDiffHost 显示），
    // 模型不动（占位）、状态栏显示 diff: 前缀路径、编辑器专属装饰全部跳过
    app.editor.setModel(null);
    dismissDbHost(); // v1.4：db Tab 宿主与 diff 宿主同为 #editor-row 浮层，互斥
    presentDiffHost(tab);
    splitEditor.setDiffActive(true); // C-4：diff 占满编辑区，分屏（若开着）一并隐藏
    renderTabs();
    statusFileEl.textContent = tab.path;
    updateEditorOverlay(); // 诊断实证：diff tab 也是「有活动内容」，欢迎页覆盖层必须隐藏
    mdPreview.updatePreviewVisibility(); // 与文件/db 分支同口径（2026-10-08 review 补）
    refreshDiffOnActivate(tab); // 后台期间文件可能已变：按需重拉（冲突 tab 保护跳过）
    return;
  }
  if (tab.kind === "db") {
    // v1.4 Tab 化：数据库 Tab（表数据 / SQL 查询）——主编辑器隐藏，
    // 宿主由 sqliteTabs.presentDbTab 显示并同步共享视图 DOM（结果缓存在 Tab 内，切换不重查）
    app.editor.setModel(null);
    dismissDiffHost(); // P0（2026-10-08 review）：db 宿主与 diff 宿主同为 #editor-row 浮层互斥——
    // 漏掉时 diff→db 切换后旧 diff 面板残留遮挡 db 面板（diff 分支与文件分支均已互调 dismiss）
    presentDbTab(tab);
    splitEditor.setDiffActive(true); // db Tab 占满编辑区，分屏（若开着）一并隐藏
    renderTabs();
    statusFileEl.textContent = "";
    updateEditorOverlay(); // db Tab 也是「有活动内容」，欢迎页覆盖层必须隐藏
    mdPreview.updatePreviewVisibility();
    return;
  }
  if (tab.kind === "md") {
    // open_file_dev_plan §1.3：Markdown 预览 Tab（只读）——主编辑器隐藏，
    // 宿主由 mdPreviewTab.presentMdPreviewTab 显示（激活即重读源文件，外部修改可见）。
    // 互斥链三方：diff / db / md 宿主都是 #editor-row 浮层，切走时统一 dismiss。
    app.editor.setModel(null);
    dismissDiffHost();
    dismissDbHost();
    void presentMdPreviewTab(tab);
    splitEditor.setDiffActive(true); // 预览 Tab 占满编辑区，分屏（若开着）一并隐藏
    renderTabs();
    statusFileEl.textContent = mdPreviewSourcePath(tab.path);
    updateEditorOverlay(); // 预览 Tab 也是「有活动内容」，欢迎页覆盖层必须隐藏
    mdPreview.updatePreviewVisibility(); // 预览 Tab 激活时分栏预览必须隐藏（防预览套预览）
    return;
  }
  // 文件 tab：从 diff/db/md tab 切回时恢复主编辑器
  dismissDiffHost();
  dismissDbHost(); // v1.4：db Tab 宿主随切回文件隐藏（互斥，不动各 Tab 的 state）
  dismissMdPreviewHost(); // 预览宿主同理（互斥）
  splitEditor.setDiffActive(false); // C-4：分屏若开着则恢复显示
  app.editor.setModel(tab.model);
  if (tab.viewState) app.editor.restoreViewState(tab.viewState);
  renderTabs();
  statusFileEl.textContent = tab.path;
  if (activeView() === "files") {
    refreshOutline();
    scheduleFollowReveal(); // B 批：文件树自动跟随当前文件（可关开关，防抖 120ms 去抖动）
  }
  updateEditorOverlay();
  refreshRunGutter(); // C5：切换 tab 重算 __main__ 守卫行的 ▶
  refreshDebugGutter(); // D3：切换 tab 重算断点红点
  refreshGitGutter(); // 迭代 2 · P0-5：切换 tab 重算 git 行级变更装饰
  scheduleBreadcrumbs(); // P2：面包屑跟随激活文件
  refreshBookmarkGutter(); // P2：书签标记跟随激活文件
  renderProblemsChip(); // 问题芯片：切 tab 立即按新文件的 marker 刷新（不等 500ms 防抖）
  refreshCursorStatus(); // T2：光标位置芯片按新 tab 的 viewState 刷新（隐藏/显示 + 位置）
  void lintActiveFile(); // P2：ruff 实时 lint（切 tab 立即跑，不等防抖）
  mdPreview.updatePreviewVisibility(); // Markdown 预览：切换 tab 后按「是否 md + 开关」刷新显隐
  // 鼠标切 tab / 关 tab 后焦点落回编辑器（打字立即生效）；tab 键盘激活路径传 false，
  // 保住 UI-16 的 tabbar 方向键漫游（Enter 激活后继续 ←→ 移动）
  if (opts?.focusEditor !== false) app.editor.focus();
}

/** 下一个/上一个标签（Ctrl+Tab / Ctrl+Shift+Tab）：按 tabs 数组顺序循环切换 */
function cycleTab(dir: 1 | -1): void {
  if (app.tabs.length < 2) return;
  const idx = app.activeTab ? app.tabs.indexOf(app.activeTab) : -1;
  const next = app.tabs[(idx + dir + app.tabs.length) % app.tabs.length] ?? null;
  if (next) activateTab(next);
}

async function closeTab(tab: Tab): Promise<void> {
  const idx = app.tabs.indexOf(tab);
  if (idx === -1) return;
  // diff/db/md tab 恒不 dirty（占位模型/只读视图），无需确认直接关
  const virtualTab = tab.kind === "diff" || tab.kind === "db" || tab.kind === "md";
  if (!virtualTab && tab.dirty && !(await openConfirm({ message: t("main.confirm.closeDirty", { name: basename(tab.path) }), kind: "danger" }))) return;
  closeTabSilent(tab);
  if (!virtualTab) recordClosedTab(tab.path); // PR-A：用户主动关闭入重开栈（工作区切换的批量清理不入栈）
}

/** 关闭标签（不弹确认，用于工作区切换时的批量清理） */
export function closeTabSilent(tab: Tab): void {
  const idx = app.tabs.indexOf(tab);
  if (idx === -1) return;
  app.tabs.splice(idx, 1);
  if (tab.kind === "diff") {
    // diff tab：不走 LSP/诊断/标记链（path 是 diff: 虚拟路径）；域内清理统一入口
    cleanupDiffTabState(tab);
  } else if (tab.kind === "db") {
    // v1.4：db tab 不走 LSP/诊断/标记链（path 是 db-data:/db-query: 虚拟路径）；
    // model（查询 Tab 的 SQL model / 占位模型）与状态表由域内统一清理
    cleanupDbTab(tab);
  } else if (tab.kind === "md") {
    // 预览 tab 同 diff/db：不走 LSP/诊断/标记链（path 是 mdpreview: 虚拟路径）；
    // 占位模型与在途渲染令牌由域内统一清理
    cleanupMdPreviewTab(tab);
  } else {
    editorTimers.clearAutosave(tab.path); // 在途 autosave 计时器随 tab 关闭作废（防 dispose 后写盘复活内容）
    lsp.didClose(tab.path);
    lsp.discardCachedDiagnostics(tab.path); // CR-22：关文件即释放诊断缓存
    app.monaco.editor.setModelMarkers(tab.model, "opencharm-lsp", []);
    splitEditor.onModelDisposed(tab.model); // C-4：分屏钉住该 model 时同步收起（先于 dispose）
    tab.model.dispose();
  }
  if (app.activeTab === tab) {
    app.activeTab = null;
    const next = app.tabs[Math.min(idx, app.tabs.length - 1)] ?? null;
    if (next) activateTab(next);
    else {
      app.editor.setModel(null);
      statusFileEl.textContent = "";
      dismissDiffHost(); // 最后一个 diff tab 关闭（无下一个 tab）：宿主一并隐藏
      dismissDbHost(); // v1.4：最后一个 db tab 关闭同理
      dismissMdPreviewHost(); // 预览 tab 同理
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
  for (const tab of app.tabs) {
    const active = tab === app.activeTab;
    const isDiff = tab.kind === "diff";
    const isDb = tab.kind === "db";
    const isMd = tab.kind === "md";
    // diff tab 的显示名：剥 diff: 前缀（VS Code 同款「文件名 (Working Tree)」语义）
    // db tab 的显示名由域内解析（`表名 · 库名` / `查询 N · 库名`），path 里是 connId 哈希
    // md 预览 tab：`文件名 预览`（与同名编辑 tab 区分）
    const displayName = isDiff
      ? t("main.tab.diffTitle", { name: basename(tab.path.slice("diff:".length)) })
      : isDb
        ? dbTabLabel(tab)
        : isMd
          ? mdPreviewTabLabel(tab)
          : basename(tab.path);
    const el = document.createElement("div");
    el.className = `tab ${active ? "active" : ""}`;
    // UI-16：tabs 模式（#tabbar 的 role=tablist 在 index.html 静态声明）。
    // 所有 tab 共享同一个 Monaco 面板，故不设 aria-controls/tabpanel（与事实不符的声明不如不声明）；
    // 漫游 tabindex：激活项 0、其余 -1；←→ 在 tab 间移动焦点，Enter/Space 激活。
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    el.tabIndex = active ? 0 : -1;
    el.dataset.path = tab.path;
    // 悬停显示完整路径（tooltip.ts 规则 4：纯路径披露用原生 title，不挂 data-tip；
    // tab 内部无 data-tip，不触发规则 5 的父子不同轨冲突）
    // db tab 的 path 是 connId 哈希虚拟路径，对用户无意义——title 用显示名
    // md 预览 tab 的 path 是 mdpreview: 虚拟路径——title 用源文件路径
    el.title = isDb ? displayName : isMd ? tab.path.slice("mdpreview:".length) : tab.path;
    // diff/db/md tab 用专属图标（与文件类型图标区分）；文件 tab 保持类型图标
    el.appendChild(
      isDiff
        ? codicon("diff")
        : isDb
          ? codicon(dbTabIcon(tab))
          : isMd
            ? codicon(mdPreviewTabIcon())
            : renderFileIcon(basename(tab.path)),
    ); // D2 P-08：标签页文件类型图标
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = displayName;
    const dirty = document.createElement("span");
    dirty.className = "dirty";
    if (tab.dirty) dirty.appendChild(codicon("circle-filled"));
    // TD-14：runningPathsOf() 取运行中脚本路径集合，故 tab.path 命中即为「该 tab 正在运行」
    //（v3.4 M3-3.3：多实例模型——脚本实例的 path 集合；项目实例无文件锚点不在此列）
    const runningScripts = runningPathsOf();
    const isRunningHere = runningScripts.has(tab.path);
    // UI-16：脏标记/运行指示的圆点是纯视觉装饰（aria-hidden），状态并入 tab 的可访问名称，
    // 读屏聚焦该 tab 时直接听到「已修改 / 运行中」（承接 UI-09 对 .tab-running 的遗留说明）
    const labelParts = [displayName];
    if (tab.dirty) labelParts.push(t("main.tab.modified"));
    if (isRunningHere) labelParts.push(t("main.tab.running"));
    el.setAttribute("aria-label", labelParts.join("，"));
    // 被动运行指示（C3）：动作已集中到菜单栏运行组，tab 只显示状态（不可点，避免第二个动作入口）
    const close = document.createElement("span");
    close.className = "close";
    close.appendChild(codicon("close"));
    // UI-16：span 充当按钮 → 补 role/aria-label/tabindex + Enter/Space 键盘激活（第四批待办同款）
    close.setAttribute("aria-label", t("main.tab.closeAria", { name: displayName }));
    close.tabIndex = 0;
    close.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // 不冒泡到 tab 本体的 Enter/方向键处理
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        void closeTab(tab);
      }
    });
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeTab(tab);
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
    el.addEventListener("click", () => activateTab(tab));
    // 中键关闭（编辑器惯例）：mousedown 先拦掉 Chromium 的 autoscroll，auxclick 执行关闭
    el.addEventListener("mousedown", (ev) => {
      if (ev.button === 1) ev.preventDefault();
    });
    el.addEventListener("auxclick", (ev) => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      ev.stopPropagation();
      void closeTab(tab); // dirty 时仍走 closeTab 的确认弹窗，与关闭按钮一致
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activateTab(tab, { focusEditor: false }); // 键盘激活：焦点留在 tabbar，方向键漫游继续
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
      showTabContextMenu(tab, ev.clientX, ev.clientY);
    });
    // T4：拖拽排序（tabDragSort.ts 外提模块——预算红线后拆分；main 只保留接线）
    wireTabDnD(el, tab.path);
    tabbarEl.appendChild(el);
  }
  // UI-16：焦点恢复（原焦点 tab 已被关闭时落到激活项，与鼠标行为一致）
  if (focusedPath) {
    const target =
      tabbarEl.querySelector<HTMLElement>(`.tab[data-path="${CSS.escape(focusedPath)}"]`) ??
      tabbarEl.querySelector<HTMLElement>(".tab.active");
    target?.focus();
  }
  // 激活标签滚入可视区（Ctrl+E / 跳转定义打开远处文件时激活 tab 可能完全在屏外；
  // nearest 只在屏外时才滚，不影响日常重绘）
  tabbarEl.querySelector<HTMLElement>(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  // 运行组按钮随 tab / 运行态一起重绘（renderTabs 覆盖了大多数状态变化点）
  renderRunWidget(runWidgetState());
  // T1：树侧运行中指示与 tab 同步（renderTabs 恰是全部运行态变化点的汇聚处——
  // runFlow 各状态迁移都调 h().renderTabs()；树不可见时刷新空 DOM 无开销）
  refreshTreeRunningClasses();
}

/** Optimize Imports（P0，Ctrl+Alt+O）：整理当前 Python 文件的导入（排序 + 删无用）。 */
async function optimizeImportsActive(): Promise<void> {
  const tab = app.activeTab;
  if (!tab) return;
  if (!tab.path.endsWith(".py") && !tab.path.endsWith(".pyw")) {
    toast(t("main.imports.pyOnly", { name: basename(tab.path) }), "info");
    return;
  }
  const before = tab.model.getValue();
  const optimized = await optimizeImportsSource(tab.path, before);
  if (optimized === null || optimized === before) return; // 失败已由 format 域提示；无改动则不动模型
  tab.model.setValue(optimized); // 单次 setValue → Ctrl+Z 可整体撤销
  toast(t("main.imports.done", { name: basename(tab.path) }), "success");
}

/**
 * 保存**指定** tab（保存时整理导入 → 格式化 → 写盘 → 本地历史 → 通知引擎）。
 * 从 saveActive 抽出来是为了运行域：▶ 的粘性目标可能不是活动 tab，只靠 saveActive
 * 会漏存目标文件，导致「跑了磁盘上的旧内容」（表现为改了没生效）。
 * @param opts.runOnSaveActions 保存时动作（isort/format）开关：显式保存（Ctrl+S/菜单）为 true；
 *  自动保存与运行前落盘传 false——落盘与保存动作解耦，避免 autosave 高频跑 ruff（PyCharm 教训）。
 */
async function saveTab(tab: Tab, opts?: SaveOptions): Promise<void> {
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
  const runActions = opts?.runOnSaveActions !== false;
  // 保存时整理导入（ruff I,F401，设置开关）：**先整理后格式化**——ruff format 不重排导入，
  // 二者正交，此顺序与 PyCharm 的「Optimize Imports → Reformat」一致。失败不阻断保存。
  if (runActions && app.settings.optimize_imports_on_save && isPy) {
    const optimized = await optimizeImportsSource(tab.path, tab.model.getValue());
    if (optimized !== null && optimized !== tab.model.getValue()) {
      tab.model.setValue(optimized); // 单次 setValue → Ctrl+Z 可整体撤销
    }
  }
  // 保存时格式化（ruff，设置开关）：失败不阻断保存
  if (runActions && app.settings.format_on_save && isPy) {
    const formatted = await formatPythonSource(tab.path, tab.model.getValue());
    if (formatted !== null && formatted !== tab.model.getValue()) {
      tab.model.setValue(formatted); // 单次 setValue → Ctrl+Z 可整体撤销
    }
  }
  // PR-C（dx_features_backlog §6.3）：保存清理（行尾空白 / 最终换行，设置开关）。
  // 与 ruff 钩子同一显式保存纪律（runActions 门控）；在 format **之后**执行——ruff format
  // 自身会重写内容，清理须以最终内容为准。单次 setValue 先例同上。
  if (runActions && (app.settings.trim_trailing_whitespace !== false || app.settings.final_newline !== false)) {
    const value = tab.model.getValue();
    const cleaned = cleanupSaveContent(value, {
      trimTrailing: app.settings.trim_trailing_whitespace !== false,
      finalNewline: app.settings.final_newline !== false,
    });
    if (cleaned !== value) tab.model.setValue(cleaned);
  }
  // PR-F（dx_features_backlog §6.6/§6.8）：保存时语法错误提示——写盘前查当前模型 error 级
  // marker。getModelMarkers 不带 owner 过滤 = 三桶统一覆盖（opencharm-lsp / opencharm-intel /
  // opencharm-ruff，owner 名实测见 6.6），与 quickFix.ts 的双桶口径一致且更宽。
  // **只提示不阻止保存**（避免打断自动化场景）；runActions 门控——autosave / 运行前落盘 /
  // git 改写磁盘等非显式路径不弹 toast（高频路径会刷屏）。
  // 2026-09-29 修订：文案区分「语法错误 / 类型/引用错误」（旧文案统称语法错误，pyrefly
  // typeCheckingMode=default 下 168 error 中仅 23 个是语法错误——大文件场景用户按文案找不到
  // 语法错误误以为错报），并加「定位」动作直达第一个错误（revealFirstError）。
  if (runActions) {
    const errorMarkers = app.monaco.editor
      .getModelMarkers({ resource: tab.model.uri })
      .filter((m) => m.severity === app.monaco.MarkerSeverity.Error);
    if (errorMarkers.length > 0) {
      const breakdown = breakDownSaveErrors(errorMarkers, app.monaco.MarkerSeverity.Error);
      toast(saveErrorToastMessage(basename(tab.path), breakdown), "error", {
        actionLabel: t("main.save.locate"),
        onAction: () => revealFirstError(),
      });
    }
  }
  // P1：本地历史——**写盘前**留一版快照（content 传 null = 后端读磁盘，落的是保存前的内容）。
  // 失败只记日志：历史是兜底能力，绝不阻断保存（与 ruff 缺席不阻断格式化的策略一致）。
  await snapshotHistory(tab.path);
  await invoke("write_file", { path: tab.path, content: tab.model.getValue() });
  tab.dirty = false;
  renderTabs();
  // 保存通知（引擎常在保存时触发完整重新检查）
  lsp.didSave(tab.path, tab.model);
  // 阶段 4：Pydantic 构造校验随保存防抖重扫（跨文件校验，全量毫秒级）
  schedulePydanticRescan();
}

async function saveActive(opts?: SaveOptions): Promise<void> {
  if (!app.activeTab) return;
  await saveTab(app.activeTab, opts);
}

/** autosave delay 模式的核心：为指定文件安排独立计时器（每个脏 tab 各自静默到期落盘）。
 *  timer 回调再次校验模式（设置中途改 off 时在途计时器自然失效）与 dirty 状态；
 *  写盘走 runOnSaveActions=false（autosave 不跑 ruff，保存动作只跟显式保存走）。 */
function scheduleAutosave(path: string): void {
  if (app.settings.autosave !== "delay") return;
  editorTimers.clearAutosave(path);
  const timer = window.setTimeout(() => {
    editorTimers.autosave.delete(path);
    if (app.settings.autosave !== "delay") return;
    const tab = app.tabs.find((x) => x.path === path);
    // 失败 toast 兜底：autosave 静默失败比显式保存更危险（用户以为已落盘）
    if (tab?.dirty) saveTab(tab, { runOnSaveActions: false }).catch((e) => toastFail(t("main.save.autosave"), e));
  }, app.settings.autosave_delay);
  editorTimers.autosave.set(path, timer);
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

/** 从磁盘重新加载文件到编辑器（git 改写工作区 / 本地历史回滚后刷新内容用）。
 *  体验修复第 5 则：force=false 时 dirty tab 跳过——git 改写工作区后，用户未保存
 *  的修改绝不能被磁盘内容静默覆盖；本地历史回滚是用户主动替换（force=true）不受限。 */
async function reloadFileFromDisk(path: string, force = false): Promise<void> {
  const tab = app.tabs.find((t) => t.path === path);
  console.debug("[reloadFileFromDisk]", path, "命中 tab:", !!tab, "打开的 tab:", app.tabs.map((t) => t.path));
  if (!tab) return;
  if (!force && tab.dirty) return; // 有未保存修改且非强制：跳过（调用方负责提示）
  const content = await invoke<string>("read_file", { path });
  // 全文替换用 pushEditOperations 而非 setValue——setValue 会清空该 model 的 undo 栈，
  // git 改写工作区/本地历史回滚后 Ctrl+Z 将无法回到替换前内容；pushEditOperations 保栈
  tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: content }], () => null);
  tab.dirty = false;
  renderTabs();
  await lsp.didChangeFull(path, tab.model);
}

// 运行域（prepareRun / runScript / runProject / runSelection /
// stopRun / runWidgetState / 输出事件流）→ runFlow.ts；运行态真值 → runState.ts。

/**
 * P2：新建草稿文件（PyCharm Ctrl+Alt+Shift+Insert Scratch 同款）。
 * 草稿落在数据根的 scratches/ 目录（**不在工作区里**——不入库、不污染项目），
 * 创建后直接打开即可运行 / 调试。
 */
async function newScratch(): Promise<void> {
  try {
    const path = await invoke<string>("create_scratch", { ext: ".py" });
    await openFile(path);
    toast(t("main.scratch.created"), "success");
  } catch (e) {
    toastFail(t("main.scratch.failAction"), e);
  }
}

/**
 * 插件 facade 依赖（PR-2）：编辑器选区/插入操作与工作区根。
 * devtools host 与插件 facade 共用同一套编辑器语义，此处集中构造。
 */
function buildPluginFacadeDeps() {
  return {
    monaco: app.monaco,
    workspaceRoot: () => app.workspaceRoot,
    getSelectedText: () => {
      const model = app.editor.getModel();
      const sel = app.editor.getSelection();
      if (!model || !sel || sel.isEmpty()) return null;
      return model.getValueInRange(sel);
    },
    replaceSelection: (text: string) => {
      const model = app.editor.getModel();
      if (!model) return false;
      const sel = app.editor.getSelection();
      const range = sel ?? new app.monaco.Range(1, 1, 1, 1);
      app.editor.executeEdits("plugin-inline", [{ range, text }]);
      app.editor.focus();
      return true;
    },
    insertToEditor: (text: string) => {
      const model = app.editor.getModel();
      if (!model) return false;
      const sel = app.editor.getSelection() ?? {
        startLineNumber: model.getLineCount(),
        startColumn: model.getLineMaxColumn(model.getLineCount()),
        endLineNumber: model.getLineCount(),
        endColumn: model.getLineMaxColumn(model.getLineCount()),
      };
      app.editor.executeEdits("plugin-inline", [{ range: sel, text }]);
      app.editor.focus();
      return true;
    },
  };
}

// ---------- LSP ----------

/** open_file_dev_plan §1.2：本会话静态引擎是否因「工作区无 py」被跳过（watcher 后补启动用）。
 *  null = 未跳过（正常启动 / 从未判定）；root 记录跳过时的工作区，切工作区后作废。 */
let lspSkippedForNoPy: string | null = null;

/** 工作区含 .py/.pyw 才启动静态引擎；探测失败保守放行（宁可空转不丢功能）。 */
async function shouldStartStaticEngine(): Promise<boolean> {
  const root = app.workspaceRoot;
  if (!root) return false;
  try {
    const hasPy = await invoke<boolean>("workspace_has_python", { root });
    if (!hasPy) {
      lspSkippedForNoPy = root;
      setLspNote("main.lsp.skippedNoPy");
      return false;
    }
  } catch (e) {
    console.warn("[lsp] 工作区 py 探测失败，按含 py 处理：", e);
  }
  lspSkippedForNoPy = null;
  return true;
}

export async function startLsp(): Promise<void> {
  if (!app.workspaceRoot) return;
  // open_file_dev_plan §1.2：纯 md / 无 py 工作区跳过静态引擎（ADR-0010「按需加载优先于常驻」——
  // pyrefly 对无 py 文件的目录是纯空转；现状手动开纯 md 目录也会启动，本次顺手收掉）。
  // 判定失败保守处理 = 照常启动（宁可空转也不静默丢功能）。
  if (!(await shouldStartStaticEngine())) return;
  // 引擎真值统一读 app.settings.lsp_engine（C2 修 bug：不再读 menubar 的 DOM select，
  // 避免「界面显示 A、实际跑 B」的永久分叉）
  const engine = app.settings.lsp_engine || "pyrefly";
  const rootUri = lsp.workspaceRootUri(app.workspaceRoot); // CR-29：正确百分号编码（空格/中文路径）
  try {
    await lsp.startEngine(engine, rootUri, currentInterpreter, app.workspaceRoot ?? undefined);
  } catch (e) {
    // 静态引擎启动失败**不阻断**运行时引擎（P0-C 观察点2）：intel 是完全独立的进程/包，
    // 架构铁律要求它失败静默降级、互不拖累；此处只提示，不 return（return 会让 intel 不启动）。
    setLspNote("main.lsp.startFailed", { msg: String(e) });
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
  // samePath（斜杠+大小写归一）：pydantic 诊断的 Rust 侧返回正斜杠绝对路径，
  // tab.path 可能是反斜杠——精确 === 会全程失配（2026-09-29 复核修复）
  const tab = app.tabs.find((t) => samePath(t.path, path));
  if (tab) app.monaco.editor.setModelMarkers(tab.model, owner, markers);
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

/** didChange 内容变化管线（P1 2026-10-08 review 抽取）——主编辑器与分屏实例共用。
 *  原 inline 只挂 app.editor，分屏内编辑时 LSP 同步 / ruff lint / 四个 gutter
 *  装饰 / 大纲 / 面包屑全部失联。防抖定时器共用 editorTimers 单槽：两实例编辑
 *  同一 model 时天然去重；交替编辑时最后一次事件胜出（与单编辑器语义一致）。 */
function wireDidChangePipeline(): void {
  if (!app.activeTab) return;
  // Markdown 预览：预览开启时才挂防抖渲染（关闭时零开销；仅活动 md tab 实际重渲染）
  if (mdPreview.isPreviewOpen()) mdPreview.schedulePreviewRender();
  window.clearTimeout(editorTimers.change);
  // C5：▶ 位置随内容变化 300ms 防抖重算（与 didChange 的 changeTimer 各管各的，不复用）
  window.clearTimeout(editorTimers.gutter);
  editorTimers.gutter = window.setTimeout(() => refreshRunGutter(), 300);
  // D3：断点行随内容变化防抖重算（行增删后断点按 Monaco 当前行号定位，不随行迁移）
  // P1-8：入 editorTimers 集中管理（先 clear 前值，防连点叠加全量重算）
  window.clearTimeout(editorTimers.debug);
  editorTimers.debug = window.setTimeout(() => refreshDebugGutter(), 300);
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
  // P1-8：入 editorTimers 集中管理（先 clear 前值）
  window.clearTimeout(editorTimers.bookmark);
  editorTimers.bookmark = window.setTimeout(() => refreshBookmarkGutter(), 300);
  // 迭代 2 · P0-5：git 行级装饰随编辑防抖重算（dirty 文件实时反映新增/修改行）
  scheduleGitGutter();
  // （autosave delay 模式已迁移到 model 级监听 doOpenFile → scheduleAutosave：
  //  每个脏 tab 独立计时，不再只针对活动 tab）
}

async function init(): Promise<void> {
  // i18n 首屏：把语言包套到 index.html 的静态骨架（菜单条 / 设置面板 / 各模态的 data-i18n* 标记）。
  // 必须早于首个 await——否则静态文案会先以 HTML 里的中文原值闪一帧再跳成用户语言。
  // 放在这里而非模块顶层：套用需要 DOM 已就绪（顶层解析 DOM 违反本项目铁律）。
  initI18n();
  // TD-14 / TD-13：功能域解环注入（须先于任何事件与运行调用）
  setTracebackOpenFile(openFile);
  setGitReloadHandler(reloadFileFromDisk);
  setGitEditorBridge({
    // git 改写磁盘前落盘受影响脏文件（autosave 语义：不跑 ruff，保存动作只跟显式保存走）
    saveTabsBeforeGit: async (paths) => {
      for (const p of paths) {
        const tab = app.tabs.find((t) => t.path === p && t.dirty && t.kind !== "diff");
        if (tab) await saveTab(tab, { runOnSaveActions: false });
      }
    },
    // 未跟踪文件被丢弃删除：先留本地历史快照再关 tab（防 autosave 把缓冲写回复活文件）
    closeTabOf: (p) => {
      const tab = app.tabs.find((t) => t.path === p);
      if (!tab || tab.kind === "diff") return;
      // P1-10（2026-09-29 review）：snapshotHistory 的 invoke 往返期间该 tab 的 autosave
      // 计时器仍存活（closeTabSilent 内的 clearAutosave 要等快照回来才执行）——窗口内
      // 到期会把缓冲写回**已删除的路径**（文件复活）。入口先清计时器。
      editorTimers.clearAutosave(tab.path);
      void snapshotHistory(tab.path, tab.model.getValue()).then(() => closeTabSilent(tab));
    },
    // autosave 开启时批量改写后的 dirty tab：缓冲留历史 → 强制从磁盘重载（覆盖旧缓冲）
    reloadDirtyWithHistory: async (p) => {
      const tab = app.tabs.find((t) => t.path === p);
      if (!tab || tab.kind === "diff") return;
      // P1-10：同 closeTabOf——快照往返窗口内 autosave 写回旧缓冲会顶掉 git 改写结果。
      editorTimers.clearAutosave(tab.path);
      await snapshotHistory(tab.path, tab.model.getValue());
      await reloadFileFromDisk(p, true);
    },
  });
  setGitOpenFileHandler(openFile);
  setRunFlowHandlers({ openFile, activateTab, renderTabs, saveActive, saveTab });
  setFileTreeHandlers({ openFile, renderTabs, closeTabSilent, insertHeaderTemplate, runScript: (p) => void runScript(p) });
  setSettingsPanelHandlers({ startLsp });
  // 单文件打开（open_file_dev_plan 批 1）：openWorkspace / openFile 注入 openFileEntry 域
  setOpenFileEntryHandlers({ openWorkspace, openFile });
  // 启动恢复（last-session 终态 + argv 启动文件 + 单实例路由）：注入 openWorkspace /
  // openSingleFile / openFile / getRecentWorkspaces（startupRestore 只做决策编排，动作经注入解环）
  setStartupRestoreHandlers({ openWorkspace, openSingleFile, openFile, getRecentWorkspaces });
  void wireStartupFileEvent(); // 第二实例双击文件命中本窗口工作区 → 直接定位打开
  // md 预览 Tab（批 2）：activateTab / openFile / 占位模型创建注入 mdPreviewTab 域。
  // openFile 绑定 mdMode:"edit"——「编辑源码」/预览内链接跳转都是显式编辑/打开意图
  // （mdMode 缺省时会按 settings.markdown_open_mode 分流，preview 模式下会开回预览死循环）。
  setMdPreviewTabHandlers({
    activateTab,
    openFile: (path) => openFile(path, undefined, { mdMode: "edit" }),
    createModel: (path) => {
      // 占位模型（照 diff tab 先例）：唯一 URI，随 Tab 关闭 dispose；语言标记 markdown 供语法无关功能使用
      const uri = app.monaco.Uri.parse(`inmemory://mdpreview/${normalizePath(path)}`);
      return app.monaco.editor.getModel(uri) ?? app.monaco.editor.createModel("", "markdown", uri);
    },
  });

  // 菜单 / 命令面板数据源（menuItems.ts）：本层私有动作经注入解环，避免 main ⇄ menuItems 静态成环
  setMenuItemsHandlers({
    saveActive: () => saveActive(),
    optimizeImportsActive: () => optimizeImportsActive(),
    newScratch: () => newScratch(),
    closeTab: (tab) => closeTab(tab),
    openFolderFromToolbar: () => openFolderFromToolbar(),
    openFolderInNewWindow: () => openFolderInNewWindow(),
    getRecentWorkspaces: () => getRecentWorkspaces(),
    clearRecentWorkspaces: () => clearRecentWorkspaces(),
    openWorkspace: (root) => openWorkspace(root),
    closeWorkspace: () => closeWorkspace(),
    liveTemplates: () => liveTemplatesHandle,
  });
  // 阶段 4：Pydantic 诊断 handlers 必须先于 openWorkspace（autoOpenRecentWorkspace 在
  // init 更深处才走到这里之前已可能触发首次扫描——扫描完成时 handlers 为 null 会被静默丢弃，
  // marker 永远挂不上；与 setRuffLintHandlers 不同，ruff 首扫由用户编辑触发无此时序问题）
  setPydanticDiagnosticsHandlers({ setMarkers });
  // A-5：会话恢复（session.ts 不反向 import main，能力经注入）
  setSessionHandlers({
    openFile,
    activateTabByPath: (p) => {
      const t = app.tabs.find((x) => samePath(x.path, p));
      if (t) activateTab(t);
    },
    renderTabs,
  });
  // UI-25：欢迎页快捷键网格改由键位系统渲染，必须在首个 await（Monaco 动态包，首屏最慢的一步）
  // 之前同步画一次，否则覆盖层会露出空的「快捷键」区。此刻 app.settings 仍是 DEFAULT_SETTINGS，
  // 画的是出厂键位；loadSettings 完成后由 updateEditorOverlay 刷成真实值（多数用户二者相同）。
  renderWelcomeShortcuts();
  // T3 打点（M0 体验度量拆解）：init 各阶段耗时（console.debug 同款，release 不显示零行为变更）
  // performance.now() 绝对值 = 导航起点→此刻：init 是模块体末尾调用，此刻的绝对值 ≈
  // HTML 解析完成后 main.ts 静态 import 图（全部功能域模块）加载+解析+执行的总耗时。
  console.debug(`[init] init 开始 performance.now=${performance.now().toFixed(0)}ms（≈模块图加载总耗时）`);
  const tInit = performance.now();
  const initMark = (label: string) => console.debug(`[init] ${label} +${(performance.now() - tInit).toFixed(0)}ms`);
  initMark("静态骨架+i18n 完成（T2 口径附近）");
  // Monaco 动态加载（首屏 UI 先渲染，编辑器包并行下载）
  const monacoModule = await import("./monaco");
  app.monaco = monacoModule.default;
  initMark("monaco 动态包加载");
  // 批 4：注入主题钩子（settingsPanel / markdownPreview 经 app 调，不静态 import 本模块——
  // 那会把 ~3 MB 的 monaco-editor 拖进冷路径的按需加载链，抵消 monaco.ts 静态引入语言包的意义）。
  app.applyEditorTheme = monacoModule.applyEditorTheme;
  app.withEditorTheme = monacoModule.withEditorTheme;
  lsp.setMonaco(app.monaco);
  await loadSettings(); // 设置先于编辑器创建（字号/主题，P25-T08）
  initMark("loadSettings");
  // 批 3：等随包等宽字体真正就绪再建编辑器。Monaco 用 canvas measureText 测字符宽度并缓存
  // （CharConfig），字体异步到位后宽度与缓存不符会让网格/光标列整体错位，且 0.52 不会自动重测；
  // font-display: swap 下浏览器先画回退字体再交换，不等就是这个窗口。
  // 实测本地 4 个 woff2 共 75 KB，load 约 8ms；函数内另有 1.5s 超时兜底，绝不把 init 拖死。
  await ensureEditorFontLoaded(app.settings);
  initMark("字体就绪");
  app.applyEditorTheme(app.settings.theme); // 批 4：重注册（读 loadSettings 已切好的 data-theme 快照）+ setTheme
  // 快捷键域：注册稳定命令 + 按设置建立键 → 命令映射（设置保存后可重建）
  kb.initKeybindingCommands(app.monaco);
  kb.applyEditorKeybindings();
  app.editor = app.monaco.editor.create($("editor"), {
    model: null,
    language: "python",
    theme: app.settings.theme,
    automaticLayout: true,
    glyphMargin: true, // 断点/运行 glyph 依赖 glyph 边距，保留
    ...buildEditorOptions(app.settings), // P1：字号/连字/缩进/换行/迷你地图/字体族由设置统一注入
    lightbulb: { enabled: app.monaco.editor.ShowLightbulbIconMode.Off }, // 关闭快速修复灯泡图标（保留 Ctrl+. 菜单）
    wordBasedSuggestions: "off", // 踩坑 #3
    quickSuggestions: { other: true, comments: false, strings: false },
    // P1-A（补全交互层 §4）：显式写出 0.52 默认值，给「Tab=替换模式接受」一个稳定基准
    suggest: {
      insertMode: "insert",
      // P0-C（补全交互层 §3）：自动打字=软选中（不抢输入、Enter 必为换行），触发字符/显式=硬选中。
      // 四取值实测矩阵（2026-10-08，e2e/lsp/06-completion-selection-mode.spec.ts）：
      //   · `selectionMode` 只作用于**自动触发**（Monaco suggestController.js:217 `if (triggerOptions.auto)`）；
      //     显式触发（Alt+/ → editor.action.triggerSuggest）恒硬选中 —— 四取值下 S3 都接受首项。
      //   · 默认值是 `always`（editorOptions.js:2221）＝硬选中，即改前快速打字会误插入。
      //   · `whenQuickSuggestion` 与目标**相反**（自动打字硬、触发字符软），排除。
      //   · 代价：live-template 也走自动打字 → 一并失去预选；由 accept_suggestion_replace 的
      //     软选中分支（Tab → focusAndAcceptSuggestion）补偿，见 keybindingDefaults.ts。
      selectionMode: "whenTriggerCharacter",
    },
  });
  // A-5：光标移动同样刷新会话快照（防抖），恢复时才落回原处
  app.editor.onDidChangeCursorPosition(() => scheduleSessionSave());
  applyFontStatus();
  // T2：状态栏光标位置芯片（wire 一次；activateTab 里随 tab 切换刷新显示/隐藏）
  wireCursorStatus();

  // C-4：分屏域接线（buildOptions 注入防 settingsPanel ⇄ splitEditor 成环；
  // 右键动作入 lspProviders 随编辑器生命周期统一释放）
  // onEditorCreated：分屏实例懒创建时挂 live-templates 的 per-editor 注册
  //（Tab 展开 / docstring；闭包运行时读 handle，分屏创建必然晚于 init 无时序问题）
  // P1（2026-10-08 review）：didChange 管线同挂——分屏内编辑的 LSP 同步 / lint /
  // gutter 装饰不再失联（实例常驻复用，注册一次即可）。
  splitEditor.setSplitEditorHandlers({
    buildOptions: () => buildEditorOptions(app.settings),
    onEditorCreated: (ed) => {
      liveTemplatesHandle?.attachEditor(ed);
      ed.onDidChangeModelContent(wireDidChangePipeline);
    },
  });
  splitEditor.wireSplitEditor();
  lspProviders.add(splitEditor.initSplitEditorAction(app.editor));
  

  // 字体缩放：Ctrl+滚轮 8-32px，状态栏显示，存全局配置（P25-T08）
  // T3 补齐（2026-10-09 微交互批）：① Ctrl+0 一键复位默认字号（VSCode 同款）；
  // ② 分屏编辑器同源刷新（此前只有主编辑器，分屏字体脱节）；③ 范围常量与
  // settingsPanel::clampFontSize / state.ts 默认值同源引用（不再各写魔法数）。
  // ⚠ 挂点改 #editor 外层容器 + capture（T3 e2e 探针三连实测修正）：
  //   · Monaco 的 wheelHandler 在内层节点 stopPropagation，冒泡阶段收不到；
  //   · getDomNode() 的实际节点与 querySelector(".monaco-editor") 不保证同层
  //    （页面存在多个 .monaco-editor 实例时漂移）——挂外层容器是必经之路，双保险。
  $("editor").addEventListener("wheel", (e: WheelEvent) => {
    if (!e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -1 : 1;
    const next = clampFontSize(app.settings.font_size + delta, app.settings.font_size);
    if (next === app.settings.font_size) return;
    app.settings.font_size = next;
    app.editor.updateOptions({ fontSize: next });
    splitEditor.refreshSplitEditorOptions(); // C-4：分屏同源（buildOptions 读 app.settings 现值）
    applyFontStatus();
    void saveSettings();
  }, { capture: true, passive: false });

  // T3：Ctrl+0 一键复位默认字号（VSCode 同款；与 Ctrl+滚轮同族的轻量手势，
  // 不进键位表——刻意保持与 wheel 缩放相同的「直接生效 + 存盘」语义）。
  // window 级挂载：输入框聚焦时 Ctrl+0 也是复位（WebView2 的浏览器缩放复位被
  // 我们接管语义；焦点在 Monaco 时 keydown 冒泡到 window，两条路径合一）。
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Digit0" && e.code !== "Numpad0") return;
    if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    e.preventDefault(); // 吞掉浏览器页面缩放复位
    if (app.settings.font_size === DEFAULT_SETTINGS.font_size) return;
    app.settings.font_size = DEFAULT_SETTINGS.font_size;
    app.editor.updateOptions({ fontSize: app.settings.font_size });
    splitEditor.refreshSplitEditorOptions();
    applyFontStatus();
    void saveSettings();
  });

  // T4：拖拽排序（tabDragSort.ts 外提模块接线：handlers + dragend 收尾）
  setTabDragHandlers({ onMoved: () => { renderTabs(); scheduleSessionSave(); } });
  wireTabDragEnd(tabbarEl);

  // 标签栏滚轮横滚（标签多时鼠标滚轮纵向增量转横向滚动，与触控板行为一致）
  tabbarEl.addEventListener("wheel", (e: WheelEvent) => {
    if (e.ctrlKey) return; // Ctrl+滚轮留给编辑器字体缩放语义
    if (tabbarEl.scrollWidth <= tabbarEl.clientWidth) return;
    e.preventDefault();
    tabbarEl.scrollLeft += e.deltaY + e.deltaX;
  }, { passive: false });

  // 失焦自动保存（P25-T08）：runOnSaveActions=false，与 delay 模式同口径（不跑 ruff）
  app.editor.onDidBlurEditorText(() => {
    // P1-10（2026-09-29 review）：模态打开时的失焦是弹窗夺焦（focus trap），不是用户
    // 离开编辑器——此刻 blur autosave 会与 git 确认后的丢弃/改写操作竞速（write_file
    // 晚于删除落地即「复活」文件）。跳过；模态关闭后用户回到编辑器再自然触发。
    if (document.querySelector(".modal:not(.hidden)")) return;
    if (app.settings.autosave === "blur" && app.activeTab?.dirty) {
      saveActive({ runOnSaveActions: false }).catch((e) => toastFail(t("main.save.autosave"), e));
    }
  });

  liveTemplatesHandle = await initLiveTemplates(app.monaco, app.editor, {
    getWorkspaceRoot: () => app.workspaceRoot,
    fetchDocumentSymbols: (path) => lsp.documentSymbols(path), // M2：符号上下文主路径
    getModelPath: (model) => lsp.modelPath(model),
  });
  initMark("live-templates 初始化");
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
  // PR-2：插件加载内核（§9.5/§9.15）——依赖注入 → 首扫 → 目录监听 → inline 管线
  const pluginDeps = buildPluginFacadeDeps();
  initPluginLoader(pluginDeps, () => registerQuickOpenActions(buildQuickOpenActions()));
  initInlineRunner(pluginDeps, () => listPluginRecords());
  initInlineSelectionMenu(); // P2：编辑器右键「变换选区 ▸」（子菜单条目随注册表自动重建）
  // P0 DX：作者指南落盘后经 openFile 打开（.md 自动开预览）
  setPluginsTabHandlers({ openFile: (p) => openFile(p) });
  // PR-S1：新手指南落盘后经 openFile 打开（同 pluginsTab 模式）
  setWelcomeGuideHandlers({ openFile: (p) => openFile(p) });
  // PR-S2：欢迎页引导接线（指南链接 / force-close / 动作按钮自动解除 / 巡礼交互 + 首渲染）
  wireWelcomeGuide();
  // PR-S2c：force 态变化 → 刷新覆盖层（updateEditorOverlay 注入，防循环依赖）
  setWelcomeOverlayRefresh(() => updateEditorOverlay());
  void getVersion()
    .then((v) => setAppVersion(v))
    .then(() => scanPlugins())
    .then(() => registerQuickOpenActions(buildQuickOpenActions()))
    .catch((e) => console.warn("[extensions] 插件首扫失败", e));
  // 第二十批 i18n：命令面板 label 是注册时快照——语言切换后整体重注册（registerQuickOpenActions 为替换语义）
  onLocaleChange(() => registerQuickOpenActions(buildQuickOpenActions()));
  void invoke("watch_plugins_dir").catch(() => undefined); // 监听失败静默（设置页「重新扫描」兜底）
  await listen("plugins-dir-changed", () => schedulePluginRescan());
  // 模板入口快捷键（可配置，默认 Ctrl+J / Ctrl+Alt+T / Ctrl+Shift+J 强制全显）
  kb.setKeybindingHandler("template_palette", () => liveTemplatesHandle?.openPalette());
  kb.setKeybindingHandler("surround", () => liveTemplatesHandle?.openSurround());
  kb.setKeybindingHandler("force_show_templates", () => liveTemplatesHandle?.forceShowAll());
  // PR-G：转到文件内符号（Ctrl+F12，editor 级）——handler 放这里避免 keybindings.ts 反向依赖
  // quickOpen 成环；命令面板 / 前往菜单走同一 handler（消除双写漂移）
  kb.setKeybindingHandler("goto_symbol", () => void openQuickOpen("symbol"));
  // 运行选区 / 行（默认 Alt+Shift+E）
  kb.setKeybindingHandler("run_selection", () => void runSelection());
  // P0：Optimize Imports（默认 Ctrl+Alt+O，PyCharm 同款）
  kb.setKeybindingHandler("optimize_imports", () => void optimizeImportsActive());
  // P1：查找引用（默认 Alt+F7，PyCharm 同款）——完整列表落底部「引用」面板
  kb.setKeybindingHandler("find_usages", () => void findUsagesAtCursor());
  // P2：跨文件重命名（默认 Shift+F6，PyCharm 同款）——定义 + 所有引用同步改名
  kb.setKeybindingHandler("rename_symbol", () => void renameSymbolAtCursor());
  // 库支持 PR-2：正则测试器（默认 Ctrl+Alt+R，editor 级）——与右键/lens 同一入口
  kb.setKeybindingHandler("open_regex_tester", () => openRegexTesterAtCursor());
  // CR-24：LSP providers 统一入应用级 DisposableStore——不再丢弃句柄。
  // providers 与引擎实例无关（内部按 engineStatus 短路），init 只注册一次；
  // store 便于应用级 teardown / 测试中整体清理，防句柄泄漏累积。
  lspProviders.dispose();
  lspProviders.add(lsp.registerLspCompletion());
  lspProviders.add(registerImportAliasCompletion(app.monaco)); // import 别名（纯前端静态，与引擎无关）
  lspProviders.add(registerAutoImportCompletion(app.monaco)); // PR-E：auto-import（自研 G-1 索引数据源，与引擎无关）
  lspProviders.add(lsp.registerLspHover());
  lspProviders.add(lsp.registerLspDefinition());
  lspProviders.add(lsp.registerLspReferences()); // Shift+F12 查找引用（peek 视图）
  lspProviders.add(initCodeVision(app.editor)); // 引用计数 Code Vision（声明行上方「N 处引用」）
  lspProviders.add(initEpJump(app.editor)); // A5③：端点 CodeLens「端点 N」（独立 provider，Monaco 按 range 合并并排）
  lspProviders.add(initFindUsagesAction(app.editor)); // 右键菜单「查找引用」
  // PR-I：Ctrl+Shift+双击 = 查找引用（PyCharm 手势对标，鼠标事件因而按 into DisposableStore）
  lspProviders.add(installCtrlShiftDblclickUsages(app.editor));
  lspProviders.add(initRenameWidget(app.editor)); // F2 就地重命名 + 右键菜单「重命名…」
  // 库支持 PR-2：正则字面量 lens / 高亮装饰 / opencharm-libs 诊断（与 codeVision 引用 lens 并存，D-2）
  lspProviders.add(initDslLens(app.editor));
  lspProviders.add(initJsonLiteral(app.editor)); // 库支持 P1 §7-3：JSON 字面量高亮/折叠/诊断/右键
  lspProviders.add(initClipboardDiffAction(app.editor)); // C-5：右键菜单「与剪贴板对比」
  lspProviders.add(initNoqaAction(app.editor)); // D-4：右键菜单「忽略此规则（# noqa）」
  lspProviders.add(installPasteJson(app.editor)); // PR-M：粘贴 JSON → Python 字面量（onDidPaste 拦截）
  lspProviders.add(initWhitespaceAction(app.editor)); // T6b：右键菜单「显示空白字符」（视图级开关）
  initQuickFixActions(); // P4：D-1/D-2 自研快速修复（Ctrl+. 灯泡；registerCodeActionProvider 自持 dispose 无需入 store）
  lspProviders.add(lsp.registerLspSignatureHelp()); // 签名帮助（参数提示）
  lspProviders.add(lsp.registerLspCodeAction()); // Ctrl+. 快速修复
  lspProviders.add(lsp.registerLspInlayHints()); // 运行时类型标注（opencharm-intel）
  // 零引擎关键字补全：非 LSP 的静态兜底（无引擎语言才生效，python 由上面三段负责），
  // 段位 `3xx` 最低。与 LSP providers 同入应用级 store，便于统一 teardown。
  // 开关初值在此读一次；设置保存路径会再刷一次（与 intel 开关同模式）。
  setKeywordCompletionEnabled(app.settings.keyword_completion);
  lspProviders.add(registerKeywordCompletion(app.monaco));
  // 文档词补全按语言开关：python 恒 off（避免淹没语义补全），其余语言取当前文档的词。
  lspProviders.add(wireWordBasedSuggestions(app.editor));
  // 缺失包安装：注册全局命令供 CodeAction 的 command 引用（灯泡「安装 X」→ pip install）。
  // CodeAction 的 command 走 commandService.executeCommand(id)，必须用 registerCommand 全局注册 id；
  // 不能用 editor.addAction——addAction 内部会把 id 加 editorId 前缀（`editorId:id`），导致 executeCommand 找不到。
  app.monaco.editor.registerCommand(lsp.INSTALL_PACKAGE_COMMAND, (_accessor, ...args: unknown[]) => {
    const pkg = args[0];
    console.debug(`[opencharm-install] 命令触发 pkg=${String(pkg)}`);
    if (typeof pkg === "string" && pkg) void installMissingPackage(pkg);
  });
  // 依赖健康 M3（§6.3）：「安装 X 并加入 pyproject」灯泡动作（E4/E3 → uv add，diff 数据源）
  app.monaco.editor.registerCommand(lsp.DECLARE_PACKAGE_COMMAND, (_accessor, ...args: unknown[]) => {
    const spec = args[0];
    if (typeof spec === "string" && spec) void declarePackage(spec);
  });
  registerRuffFormatter(app.monaco); // Shift+Alt+F / 右键「Format Document」
  setFormatErrorHandler((msg) => appendOutputLine(outputEl, msg, "stderr", gotoFromLink));
  setOpenMatchHandler((m) => openSearchMatch(m).catch(console.error));
  // 查找引用结果跳转：打开文件 + **选中标识符**（范围来自引用 Location）+ 居中聚焦，
  // 对齐 PyCharm「点击引用后落点一目了然」的体验（复用 openFile 的 tab/model 管理）
  setOpenRefHandler((path, line, col, endLine, endCol) => {
    void openFile(path, line).then(() => {
      const sel = {
        startLineNumber: line,
        startColumn: col,
        endLineNumber: endLine ?? line,
        endColumn: endCol ?? col,
      };
      app.editor.setSelection(sel);
      app.editor.revealLineInCenter(line);
      app.editor.focus();
    });
  });
  // 就地重命名落盘后刷新引用面板（符号名已变，位置仍在原符号处）；Code Vision 计数
  // 需等引擎重索引完成，延迟刷两次拿最终值（引擎侧慢时第二次兜底）
  setAfterRenameHandler(() => {
    const model = app.editor.getModel();
    const pos = app.editor.getPosition();
    if (model && pos) void queryAndRender(model, pos);
    window.setTimeout(() => refreshCodeVision(), 1500);
    window.setTimeout(() => refreshCodeVision(), 4000);
    window.setTimeout(() => refreshEpJump(), 1500); // A5③：改名落盘后端点 lens 延迟重扫（同 codeVision 兜底）
  });
  // 问题面板（对标 PyCharm Problems）：marker 驱动 + 点击条目跳转（openFile 复用 tab/model 管理）
  setOpenProblemHandler((path, line, column) => {
    void openFile(path, line).then(() => {
      app.editor.setPosition({ lineNumber: line, column });
      app.editor.revealLineInCenter(line);
      app.editor.focus();
    });
  });
  // 面板显示经回调注入（problemsPanel 不 import termUi，避免其 git→DOM 依赖链进单测）
  setShowPanelHandler(() => setBottomTab("problems"));
  lspProviders.add(wireProblemsPanel()); // marker 订阅入应用级 DisposableStore 收口（CR-24 纪律）
  // P1-BUG-002：补全请求前冲刷防抖窗口内未同步的 didChange——`.` 触发的补全请求会赶在
  // 200ms 防抖同步之前到达引擎，引擎按旧文档计算（补全位置越界 → 空结果）
  lsp.setBeforeCompletionHook(async (model) => {
    const t = app.tabs.find((x) => x.model === model);
    if (t && app.pendingChanges.has(t.path)) {
      await syncPendingChanges(); // CR-13：串行冲刷（含本文件在内的全部待同步变更，保 FIFO）
    }
  });
  // 语义请求（references / rename / prepareRename / documentSymbol）同理前置冲刷：
  // 引擎按旧缓冲算 rename 会漏改/错位，引用计数也会错
  lsp.setBeforeSemanticHook(() => syncPendingChanges());
  // F12 / Ctrl+点击 显式跳转（Ctrl+悬停不跳）；TD-027 D2：句柄入应用级 store
  lspProviders.add(lsp.wireGotoTriggers(app.editor));
  lsp.setGotoDefinitionHandler((path, line, col) => {
    openFile(path, line).then(() => app.editor.setPosition({ lineNumber: line, column: col }));
  });
  // 跳转定义可配置键（默认 Ctrl+B，PyCharm 风格；F12 / Ctrl+点击固定保留）
  kb.setKeybindingHandler("goto_definition", () => void lsp.gotoDefinitionAtCursor(app.editor));
  lsp.onNotification("textDocument/publishDiagnostics", (params, engine) => {
    lsp.handleDiagnostics(params, engine, setMarkers);
  });
  lsp.onEngineStatus((s) => {
    setEngineBusy(s === "starting"); // E-2：引擎启动期 chip 显示忙碌态
    if (s === "ready") {
      // 阶段 4 子项 1c：引擎切换只清了引擎桶，重放自研桶（pydantic 等）的缓存诊断
      lsp.replayPersistentDiagnostics(setMarkers, app.tabs.map((tb) => tb.path));
    }
    // D3 P-09：状态点 + 文案渲染收敛到 lspStatus（语言切换重取词）
    setLspEngineStatus(s);
  });

  // 全局键位路由（window 级 keydown + Double Shift）——阶段二外提到 windowKeys.ts；
  // 4 个 main 私有动作经 setWindowKeyActions 注入解环
  setWindowKeyActions({
    saveActive: () => saveActive(),
    newScratch: () => newScratch(),
    closeTab: (tab) => closeTab(tab),
    cycleTab: (dir) => cycleTab(dir),
  });
  wireWindowKeys();

  // didChange 全量同步（200ms 防抖，技术方案 §2.4）
  // P1（2026-10-08 review）：接线抽成 wireDidChangePipeline（本文件上方）——分屏实例
  // （splitEditor 懒创建的第二编辑器）同样要挂，否则分屏内编辑时 LSP 同步 / ruff
  // lint / run/debug/git/bookmark gutter / 大纲 / 面包屑全部失联（dirty/autosave
  // 因 model 级监听幸存）。防抖定时器共用 editorTimers 单槽（两个实例编辑同一
  // model 时天然去重；不同 model 交替编辑时最后一次事件胜出，行为可预期）。
  app.editor.onDidChangeModelContent(wireDidChangePipeline);

  // 各功能域事件接线（TD-007 域拆分后由各域自行提供）
  restoreLayout(); // D2 P-03：先恢复上次的侧栏宽度 / 底部面板高度
  wireSplitters();
  restoreReduceMotion(); // D3 P-06：恢复「减少动画」设置
  wireTooltip(); // D3 P-11：自绘 tooltip（data-tip 委托）
  $("tab-search").dataset.tipKey = kb.bindingLabel("global_search"); // tooltip 快捷键副文本（跟随自定义键位）
  wireBottomPanel();
  wireFileTree();
  // Ctrl+F：活动标签内查找（无活动标签则吞键，且永不弹 WebView2 原生查找条）
  setFindDiffEditorProvider(() => currentDiffEditor()?.getModifiedEditor() ?? null);
  installFindShortcut();
  // 其余浏览器加速器护栏（Ctrl+R 重载 / Ctrl+P 打印 / Ctrl+W 关窗口 …）
  installBrowserKeyGuard();
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
  // PR-A：重开关闭的标签（Ctrl+Shift+Alt+T）——openFile 注入同 navHistory 模式
  setTabReopenHandlers({ openFile: (p) => void openFile(p) });
  // PR-D：最近编辑位置（Ctrl+Shift+Backspace）——独立监听 + openFile 注入
  initEditPoints(app.editor, { openFile: (p, line) => void openFile(p, line) });
  // P1：本地历史（Ctrl+Shift+H）——无 Git 工作区的回滚兜底
  initLocalHistory();
  setLocalHistoryHandlers({ reloadFile: (p) => reloadFileFromDisk(p, true) }); // 用户主动回滚：强制替换
  // P2：ruff 实时 lint（诊断第三桶，owner = opencharm-ruff）
  setRuffLintHandlers({ setMarkers });
  // P2：书签（Ctrl+F11 切换 / Ctrl+Shift+F11 列表）
  initBookmarks(app.editor, app.monaco);
  setBookmarkHandlers({ openFile: (p, line) => void openFile(p, line) });
  void loadBookmarks().then(() => refreshBookmarkGutter());
  // P2-11（UX 审查）：启动恢复上次会话的断点（与书签同源同模式）
  void loadBreakpoints().then(() => refreshDebugGutter());
  // P2：运行历史（v3.4 M3-3.8：chip 标签条已删，Ctrl+Shift+R 列表；M4 收口：P2-O
  // 保存输出随历史列表行，原 #run-tabs-row 的「保存当前」按钮一并删除）
  initRunHistory();
  // B5 §6.8：运行历史的采集改走 termUi 多播（per-instance `runOnData` 槽位已删）。
  // 消费者签名带 instanceId，由 runHistory 自己按实例入档（半行缓冲仍在 runHistory 内部）。
  addRunDataConsumer(recordRunLines);
  // B5 §6.7.2：运行日志的状态机由 runHistory 的生命周期事件驱动（注入式，logView 不认识 runHistory）
  addRunLifecycleListener((e) => {
    if (e.type === "start") beginLogSession(e.instanceId);
    else endLogSession(e.instanceId, e.code);
  });
  initLogView();
  // B5 §6.7.7：「插入编辑器」由外壳注入（logView 不直接依赖编辑器域）
  setLogViewHandlers({ insertToEditor: insertTextIntoEditor });
  applyLogSettings(); // B5 §6.7.8：启动时按 log_structured_enabled 决定 tab 显隐
  setRunHistoryHandlers({
    // P2：历史重放回填前重置 channel 过滤——历史行是 all，停在「调试/Git」过滤态下回放会看不到内容
    clearOutput: () => {
      resetOutputChannelUi();
      clearOutput(outputEl);
    },
    appendLine: (cls, text) => appendOutputLine(outputEl, text, cls, gotoFromLink),
    rerun: (r) => void rerunRecord(r),
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
  // 编辑历史采集（低延迟编辑预测数据源 V1）：行对事件，攒语料，仅采集不预测
  initEditHistory(app.editor);
  // P0：TODO 工具窗
  initTodoView();
  setTodoViewHandlers({ openFile: (path, line) => void openFile(path, line) });
  // F1：端点工具窗（渲染与动作见 endpointView.ts；扫描在 Rust fs_cmds::scan_endpoints）
  initEndpointView();
  setEndpointViewHandlers({
    openFile: (path, line) => void openFile(path, line),
    openApiPreview: (root) => toggleOpenApiPreview(root), // A5④：工具栏「预览」→ 展开/收起 OpenAPI 预览块
  });
  // A5③④ 反向解环：epJump 弹层点击 → 激活端点面板并高亮；预览块条目点击 → 匹配扫描结果跳源码
  setEpJumpHandlers({ activateEndpoint: (route) => void highlightEndpoint(route) });
  setOpenApiPreviewHandlers({
    openFile: (path, line) => void openFile(path, line),
    getScanResults: getEndpointResults,
  });
  // A1：运行时热点视图（渲染与动作见 hotspotsView.ts；扫描在 Rust intel_cmds::scan_runtime_hotspots）
  initHotspotsView();
  setHotspotsViewHandlers({ openFile: (path, line) => void openFile(path, line) });
  // B3：数据库工具窗（侧栏资源管理器见 sqliteView.ts；编辑器 Tab 见 sqliteTabs.ts；引擎在 Rust db_cmds.rs）
  initDbView();
  setDbTabHandlers({ activateTab, buildOptions: () => buildEditorOptions(app.settings) });
  $("ew-open-folder").addEventListener("click", () => void openFolderFromToolbar());
  $("ew-open-file").addEventListener("click", () => void openFileFromDisk());
  $("ew-new-project").addEventListener("click", () => openNewProjectPanel());
  $("ew-recent-clear").addEventListener("click", () => void clearRecentWorkspaces());
  mdPreview.setMarkdownLinkHandler((path) => void openFile(path)); // 相对 .md 链接 → openFile（注入回调，避免循环依赖）
  mdPreview.setPreviewModeHandler(() => {
    // 预览模式按钮（open_file_dev_plan）：活动编辑态 md → 切纯预览 Tab（编辑 Tab 保留后台）
    const p = app.activeTab?.path;
    if (p && mdPreview.isMarkdownPath(p)) openPreviewTab(p);
  });
  mdPreview.wireMarkdownClicks(); // 预览点击委托（#锚点 / 相对 .md / http(s)）
  mdPreview.wireMarkdownControls(); // 方案A：右上角开关按钮 + 方案D：一次性引导关闭
  wireMenuBar(getMenuItems); // TD-14：菜单机制在 menuBar.ts，菜单项数据仍由本层组装
  void checkFirstRunStorage(); // 首启数据落位提示（disk-space-plan.md P2-a；内部判断触发条件，多数启动为 no-op）

  // 自绘标题栏与窗口边缘（窗口控制按钮 / 拖拽区 / resize 热区）——阶段二外提到 windowChrome.ts
  wireWindowChrome();

  // 引擎 chip（C2）：状态栏身份展示 + 切换入口；真值已收敛到 app.settings.lsp_engine
  setEngineChipHandlers({ startLsp, saveSettings });
  wireEngineChip();
  renderEngineChip();
  // A-1：资源可观测（状态栏 MEM 芯片 + 面板；明细采样仅面板打开时进行）
  wireResourcePanel({ restartLsp: startLsp });

  // 运行组（v3.4 §8 / M3-3.4）：四控件 [▶ 运行脚本] [▶ 运行项目] [⏹ 停止] [⚙ 运行配置…]。
  // main 拥有运行动作，runWidget 只负责渲染与派发
  setRunWidgetHandlers({
    runScript: () => void runScript(),
    runProject: () => void runProject(),
    // 调试态联动（D4）：运行组 ⏹ 在调试中路由到 debug_stop，避免「调试中误触停止脚本」
    stop: () => {
      const phase = dap.currentPhase();
      if (phase === "starting" || phase === "running" || phase === "stopped") void stopDebugSession();
      else void stopRun();
    },
    // 面板为工作区级：没有活动标签也可打开（活动文件仅用于脚本分区预选，见 openRunConfig）
    openRunConfig: () => void openRunConfig(app.activeTab?.path),
  });
  wireRunWidget();
  setRunWidgetRepaint(() => renderRunWidget(runWidgetState()));

  // gutter 运行图标（C5）：__main__ 守卫行的 ▶，点击运行整个文件、右键弹出运行组同源菜单
  wireRunGutter(app.editor, app.monaco);
  // 迭代 2 · P0-5：git 行级变更装饰（绿/蓝条 + 删除红三角）
  wireGitGutter(app.editor, app.monaco);
  // gutter 悬停预示（方案 1/2）：把真正可点的 glyph 那一档画出来 + 悬停行显示淡化断点，
  // 否则用户会点在行号两侧的空白上而以为「断点坏了」（CSS 侧见 style.css 同段注释）
  wireGutterHover(app.editor, app.monaco);
  setRunGutterHandlers({
    // gutter ▶ 的语义是「运行这个文件」（v3.4 §2：gutter ▶ = 运行脚本）
    run: () => { if (app.activeTab) void runScript(app.activeTab.path); },
    menuItems: () => buildRunMenuItems(),
    state: () => {
      const tab = app.activeTab;
      const isPy = !!tab && (tab.path.endsWith(".py") || tab.path.endsWith(".pyw"));
      // v3.4 M3 复查修复：gutter ▶ 的置灰只看**脚本运行**（项目实例不互斥，§12）+
      // 调试态（§13.2 调试 ↔ 脚本运行互斥）——原 isRunning() 含项目实例会误置灰
      const dbgPhase = dap.currentPhase();
      const debugging = dbgPhase === "starting" || dbgPhase === "running" || dbgPhase === "stopped";
      return { canRun: !!app.workspaceRoot && !!tab && isPy, running: scriptRunActive() || debugging, targetName: tab ? basename(tab.path) : "" };
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

  // 环境面板（P25-T05）：DOM 接线 + 装包后重启引擎（restartEngine = startLsp，TD-14 注入解环）
  initEnvPanel({ restartEngine: startLsp });
  // 依赖健康面板（dep plan M3）：tab/刷新/状态栏图标接线；openEnvPanel 与包列表刷新经此注入
  //（depHealthPanel 单向 import envPanel 的 shortInterpreter，反向调用全部走注入——无环）
  initDepHealthPanel({ openEnvPanel: () => void openEnvPanel(), refreshPackagesIfOpen, repaintPackagesIfOpen: repaintPkgBadgesIfOpen });
  // 面板打开即重绘健康分区（envPanel 的 openedHooks，避免 envPanel ↔ depHealthPanel 循环依赖）
  onEnvPanelOpened(() => void renderDepHealth());
  // 依赖健康域（dep plan M2/M3）：引擎重启器 + M3 UI 钩子（状态栏体检图标 / toast「查看」入口）
  initDepHealth({
    restartEngine: startLsp,
    // toast「查看」入口语义是「看问题」——展开依赖明细再开面板（明细默认收起）
    openHealthPanel: () => { expandDepDetail(); void openEnvPanel(); },
    onScanStart: () => setHealthStatus("scanning"),
    onScanComplete: handleScanComplete,
  });
  // 依赖健康 M4-3（§6.4 traceback 一键安装）：toast「安装」入口 → envPanel.installMissingPackage
  //（内部走 runDepFix 统一编排 + M4-4 候选选择）；输出面板 stderr 行 → ModuleNotFoundError 检测。
  setDepInstallHandler((module) => installMissingPackage(module));
  setOutputTracebackHandler((line) => handleTracebackLine(line));

  // 侧栏视图注册表 + 活动栏 + 大纲折叠态——阶段二外提到 sidebarViews.ts
  wireSidebarViews({ refreshOutline });

  // Git 域 UI 接线（SCM 工具栏 / 历史 / diff / 提交 / 分支，TD-007）
  wireGitUI();
  // 第 2 步迁移：diff tab 生命周期回调（git.ts 的 showDiff/关闭链 → main 的 tab 统一路径）
  setDiffTabHandlers({
    activate: (tab) => activateTab(tab),
    close: (tab) => closeTabSilent(tab),
  });
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
  // PR-H：正则开关（与 Aa 同款接线）
  $("search-regex").addEventListener("click", () => {
    searchUseRegex = !searchUseRegex;
    $("search-regex").classList.toggle("active", searchUseRegex);
    $("search-regex").setAttribute("aria-pressed", String(searchUseRegex));
    if (searchInputEl.value.trim()) executeSearch().catch(console.error);
  });
  // PR-H：文件掩码——change 而非 per-keystroke（掩码是「限定条件」，逐键重搜既吵又贵）；
  // 回车即时触发一次，方便边写边验证
  const searchMaskEl = $("search-mask") as HTMLInputElement;
  searchMaskEl.addEventListener("change", () => {
    searchFileGlob = searchMaskEl.value.trim();
    if (searchInputEl.value.trim()) executeSearch().catch(console.error);
  });
  searchMaskEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    searchFileGlob = searchMaskEl.value.trim();
    if (searchInputEl.value.trim()) executeSearch().catch(console.error);
  });
  // E-5：scope 切换即重搜（当前文件 / 打开的标签 / 整个工作区）
  $("search-scope").addEventListener("change", () => {
    if (searchInputEl.value.trim()) executeSearch().catch(console.error);
  });

  // 设置面板（P25-T09）——菜单栏右侧图标
  wireSettingsPanel();

  // 新建项目（文件菜单入口）——面板接线在 newProject.ts，openWorkspace / openFile 由本层注入
  wireNewProject({ openWorkspace, openFile });
  wireCloneRepository({ openWorkspace, openFile, openPanel: openNewProjectPanel });

  // 运行配置面板（P0-C 配置列表编辑器；stdin 重定向 S1）——接线在 runConfigPanel.ts
  wireRunConfigPanel();

  // P2 并行运行 + S4 交互输入行 + 输出面板钩子——接线在 runFlow.ts
  wireRunFlow();

  // S3：终端里的 traceback 也可点击（坑 4）——复用输出面板同一个正则与跳转逻辑；
  // 顺带让在 shell 终端里手敲 `uv run` 产生的 traceback 同样可点（PTY 路线的额外收益）
  setTerminalLinkHandler(gotoFromLink);
  // P2-L：终端里的 URL 可点开（uvicorn/FastAPI 等），与输出面板 URL / 自动开浏览器共用 open_external
  setTerminalUrlHandler((url) => {
    invoke("open_external", { url }).catch((e) => toastFail(t("main.url.openBrowser"), e));
  });
  // P2-L：输出中的 URL 可点开（invoke open_external 仅放行 http/https，后端二次校验）
  setOutputUrlHandler((url) => {
    invoke("open_external", { url }).catch((e) => toastFail(t("main.url.openBrowser"), e));
  });
  // 库支持 P1：`log_level_colors` 开关注入（research §11.9；output.ts 保持无 state 依赖可单测）
  setOutputLevelColorsEnabled(() => app.settings.log_level_colors !== false);
  // v3.4 §9（M3-3.9）：FastAPI 服务就绪（Uvicorn running on http://…）自动开浏览器
  // ——与输出面板 URL 点击共用同一 open_external 通道
  setExternalUrlOpener((url) => {
    invoke("open_external", { url }).catch((e) => toastFail(t("main.url.openBrowser"), e));
  });

  // 文件监听事件（增量刷新树）
  await getCurrentWindow().listen<string[]>("fs-changed", (e) => {
    handleFsChanged(e.payload);
  });

  // 调试输出事件（debug-stdout / debug-stderr → 输出面板，§13.3）——接线在 runFlow.ts
  await initRunEvents();

  // 包安装 / 工具链引导事件流（pip-* / toolchain-*）——在 envPanel.ts
  await initEnvPanelEvents();

  // 终端事件（P2-7 多会话）：按 id 分发到对应终端实例
  await wireTerminalEvents();

  // 依赖健康失效矩阵（dep plan M2）：watcher 的 dep-fs-changed / dep-env-changed 事件接线
  await wireDepHealthEvents();

  // 首次启动环境引导（第 4 步）：缺失 uv/pyrefly 时弹窗引导一键安装
  await maybePromptToolchain();
  initMark("事件接线+工具链引导");

  // 多窗口/启动恢复（startupRestore.ts）：项目窗口按绑定目录打开；主窗口依次回落
  // argv 双击文件 → 恢复最近（last-session 终态优先，open=false 不恢复）
  await openInitialWorkspace();
  initMark("openInitialWorkspace 返回（含 openWorkspace 全链）");
  updateEditorOverlay();
  renderRunWidget(runWidgetState()); // 首次渲染（无工作区时 renderTabs 不被调用，需显式补一次）
}

init().catch((e) => console.error("init 失败", e));
