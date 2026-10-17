// 菜单与命令面板的数据源（顶部菜单 / Search Everywhere 动作表 / 断点右键菜单 / 运行 gutter 菜单）。
//
// 从 main.ts 外提（阶段二拆分第一刀）。机制侧分别落在 `menuBar.ts`（渲染与键盘导航）、
// `menu.ts`（通用浮层菜单）、`quickOpen.ts`（Search Everywhere）——本文件**只组装数据**。
//
// 解环方式：本文件需要的少数 main 私有动作（保存 / 关标签 / 工作区开关 / 最近工作区 /
// Live Templates 句柄…）经 `setMenuItemsHandlers` 注入，避免 main ⇄ menuItems 静态成环
// （与 `setRunWidgetHandlers` / `setSettingsPanelHandlers` 同一套约定）。

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { LiveTemplatesHandle } from "./live-templates";
import { app, $, type Entry, type Tab } from "./state";
import { openPreviewTab } from "./mdPreviewTab";
import { t } from "./i18n";
import { basename } from "./util";
import { toast, toastFail } from "./toast";
import { openAlert, openPrompt } from "./dialog";
import { showMenu, type MenuItem } from "./menu";
import { type MenuEntry } from "./menuBar";
import { type QuickOpenAction, openQuickOpen } from "./quickOpen";
import * as kb from "./keybindings";
import * as lsp from "./lsp/client";
import * as splitEditor from "./splitEditor";
import * as mdPreview from "./markdownPreview";
import { setSidebarTab } from "./views";
import { toggleSidebar } from "./layout";
import { toggleBottomPanel } from "./termUi";
import { createDirAt, createFileInteractive } from "./fileTree";
import {
  commitAll, discardAllChanges, gitInitRepo, gitRemoteOp, gitStash, gitStashPop,
  refreshBranchPanel, stageAllChanges, toggleBranchList, toggleHistory,
} from "./git";
import { openNewProjectPanel } from "./newProject";
import { openDepHealthPanel } from "./depHealthPanel"; // 体验审查 D-4：依赖健康命令面板入口
import { openCloneTab } from "./cloneRepository";
import { openGuide } from "./extensions/pluginsTab";
import { listPluginRecords } from "./extensions/loader";
import { inlineCommandLabel, listInlineEntries, runInline } from "./extensions/inline";
import { categoryLabel, groupToolsByCategory, listDevTools, openDevTools, openDevToolsPanel } from "./devtools";
import { dismissWelcomeOverlay, isWelcomeForced, openOnboardingGuide, showWelcomeOverlay } from "./welcomeGuide";
import { openHelpDocs } from "./helpDocs"; // MB-13 帮助菜单：内置帮助文档（随包分发的静态 Markdown）
import { openSettingsPanel } from "./settingsPanel";
import { openProblemsPanel } from "./problemsPanel";
import { openRunConfig } from "./runConfigPanel";
import { addConnection } from "./sqliteView"; // B3：数据库工具窗（命令面板入口）
import { openQueryTabForActive } from "./sqliteTabs";
import { openBookmarks, toggleBookmarkAtCursor } from "./bookmarks";
import { openLocalHistory } from "./localHistory";
import { openRecentFiles } from "./recentFiles";
import { openRunHistory } from "./runHistory";
import { openFileFromDisk } from "./openFileEntry";
import { goBack, goForward } from "./navHistory";
import { jumpToLastEdit } from "./editPoints";
import { reopenClosedTab } from "./tabReopen";
import {
  breakpointKind, getBreakpointSpec, isBreakpointEnabled, refreshDebugGutter, removeBreakpoint,
  setBreakpointEnabled, toggleBreakpoint, updateBreakpoint,
} from "./debugGutter";
import { computeRunWidget, runWidgetHandlers } from "./runWidget";
import { runProject, runScript, runWidgetState, stopRun } from "./runFlow";
import { onEvaluateShortcut, runDebug, runToCursorAtCursor, stopDebugSession, debugTest } from "./debugEntry";
import { runTestNodes } from "./testRun";
import { testRunActive } from "./runState";
import { currentThreadId } from "./debugView";

/** main 注入的私有动作（解环：本文件不反向 import main）。 */
export interface MenuItemsHandlers {
  saveActive: () => void | Promise<void>;
  optimizeImportsActive: () => void | Promise<void>;
  newScratch: () => void | Promise<void>;
  closeTab: (tab: Tab) => void | Promise<void>;
  openFolderFromToolbar: () => void | Promise<void>;
  openFolderInNewWindow: () => void | Promise<void>;
  getRecentWorkspaces: () => Promise<string[]>;
  clearRecentWorkspaces: () => Promise<void>;
  openWorkspace: (root: string) => Promise<void>;
  closeWorkspace: () => Promise<void>;
  liveTemplates: () => LiveTemplatesHandle | null;
}

let H: MenuItemsHandlers | null = null;

/** 由 main 的 init 在最早期调用（先于任何菜单 / 命令面板注册）。 */
export function setMenuItemsHandlers(h: MenuItemsHandlers): void {
  H = h;
}

function need(): MenuItemsHandlers {
  if (!H) throw new Error("[menuItems] handlers 未注入：请先在 init 里调用 setMenuItemsHandlers");
  return H;
}

// —— 注入动作的本地代理（保持下方搬移代码逐字不变，避免二次改动引入行为差异）——
function saveActive(): void { void need().saveActive(); }
function optimizeImportsActive(): void { void need().optimizeImportsActive(); }
function newScratch(): void { void need().newScratch(); }
function closeTab(tab: Tab): void { void need().closeTab(tab); }
function openFolderFromToolbar(): void { void need().openFolderFromToolbar(); }
function openFolderInNewWindow(): void { void need().openFolderInNewWindow(); }
function getRecentWorkspaces(): Promise<string[]> { return need().getRecentWorkspaces(); }
function clearRecentWorkspaces(): void { void need().clearRecentWorkspaces(); }
function openWorkspace(root: string): Promise<void> { return need().openWorkspace(root); }
function closeWorkspace(): void { void need().closeWorkspace(); }
function liveTemplates(): LiveTemplatesHandle | null { return need().liveTemplates(); }

/**
 * 工具菜单（PR-1，plugin_system_design §9.8）：按 category 分组 → flyout 子菜单。
 * groupToolsByCategory 处理预置有序集 + 自定义追加；空 category 归「其他」。
 */
function buildToolsMenu(): MenuEntry[] {
  const groups = groupToolsByCategory(listDevTools());
  const entries: MenuEntry[] = groups.map(([cat, tools]) => ({
    // 第十七批 i18n：预置分组展示名走语言包（标识串仍为中文原文，排序恒定）
    label: categoryLabel(cat),
    submenu: () => tools.map((t) => ({
      label: t.title,
      detail: t.description,
      action: () => openDevTools(t.id),
    })),
  }));
  // §9.8：尾部固定「插件管理…」入口（设置页插件 tab）
  if (groups.length > 0) entries.push({ label: "", sep: true });
  entries.push({ label: t("main.cmd.plugins"), action: () => openSettingsPanel("plugins") });
  return entries;
}

/**
 * P1：Search Everywhere 的「命令」数据源。
 * 键位表里已有的动作直接用其 id——hint 会自动跟随用户在设置里改过的键位
 * （同 debugView 工具栏提示的处理，避免硬编码 "F5" 这类会失真的文案）；
 * 无键位的动作用显式 hint（如内建的 Shift+Alt+F）或留空。
 */
export function buildQuickOpenActions(): QuickOpenAction[] {
  return [
    { id: "save", label: t("main.cmd.save"), run: () => void saveActive() },
    // v3.4 §8（M3-3.4）：命令面板对齐四控件运行组
    { id: "run_script", label: t("main.run.script"), run: () => { if (app.activeTab) void runScript(app.activeTab.path); } },
    { id: "run_project", label: t("main.run.project"), run: () => void runProject() },
    { id: "stop", label: t("main.run.stop"), run: () => void stopRun() },
    { id: "debug", label: t("main.cmd.debugStart"), run: () => void runDebug() },
    { id: "debug_stop", label: t("main.cmd.debugStop"), run: () => void stopDebugSession() },
    { id: "debug_evaluate", label: t("main.cmd.evaluate"), run: () => void onEvaluateShortcut() },
    { id: "debug_run_to_cursor", label: t("main.cmd.runToCursor"), run: () => void runToCursorAtCursor() },
    { id: "bookmark_toggle", label: t("main.cmd.bookmarkToggle"), run: () => void toggleBookmarkAtCursor() },
    { id: "bookmark_list", label: t("main.cmd.bookmarkList"), run: () => void openBookmarks() },
    { id: "scratch_new", label: t("main.cmd.scratchNew"), run: () => void newScratch() },
    { id: "split_editor", label: t("main.cmd.splitRight"), run: () => splitEditor.toggleSplit() }, // P4（C-4）
    // PR-A（dx_features_backlog §6.1）：键位补齐组的命令面板入口（id 对齐键位表，hint 自动跟随改键；
    // run 复用键位 handler——review 建议 5：与 keybindings.ts 的命令 id 手写两份会漂移）
    { id: "delete_line", label: t("main.cmd.deleteLine"), run: () => kb.triggerEditorKeybindingAction("delete_line") },
    { id: "fold_all", label: t("main.cmd.foldAll"), run: () => kb.triggerEditorKeybindingAction("fold_all") },
    { id: "unfold_all", label: t("main.cmd.unfoldAll"), run: () => kb.triggerEditorKeybindingAction("unfold_all") },
    { id: "jump_to_bracket", label: t("main.cmd.jumpBracket"), run: () => kb.triggerEditorKeybindingAction("jump_to_bracket") },
    { id: "reopen_tab", label: t("main.cmd.reopenTab"), run: () => { if (!reopenClosedTab()) toast(t("main.cmd.reopenNone"), "info"); } },
    { id: "recent_edit_locations", label: t("main.cmd.lastEdit"), run: () => { if (!jumpToLastEdit()) toast(t("main.cmd.noEarlierEdit"), "info"); } },
    { id: "run_history", label: t("main.cmd.runHistory"), run: () => openRunHistory() },
    { id: "goto_file", label: t("main.cmd.gotoFile"), run: () => void openQuickOpen("files") },
    { id: "goto_symbol", label: t("main.cmd.gotoSymbol"), run: () => kb.triggerEditorKeybindingAction("goto_symbol") },
    // PR-J：触发补全建议备选键（Ctrl+Space 被中文 IME 吞键，人工验证；handler 在 keybindings.ts）
    { id: "trigger_suggest", label: t("main.cmd.triggerSuggest"), run: () => kb.triggerEditorKeybindingAction("trigger_suggest") },
    { id: "goto_line", label: t("main.cmd.gotoLine"), run: () => void openQuickOpen("line") },
    { id: "goto_definition", label: t("main.cmd.gotoDef"), run: () => void lsp.gotoDefinitionAtCursor(app.editor) },
    { id: "global_search", label: t("main.cmd.globalSearch"), run: () => setSidebarTab("search") },
    { id: "recent_files", label: t("main.cmd.recentFiles"), run: () => void openRecentFiles() },
    { id: "optimize_imports", label: t("main.cmd.optimizeImports"), run: () => void optimizeImportsActive() },
    { id: "local_history", label: t("main.cmd.localHistory"), run: () => void openLocalHistory() },
    { id: "template_palette", label: t("main.cmd.ltPalette"), run: () => liveTemplates()?.openPalette() },
    { id: "surround", label: t("main.cmd.surround"), run: () => liveTemplates()?.openSurround() },
    // ⚡ 强制全显（S1-T03 宣称的能力，2026-10-08 补入口）：设置一次性开关后自动触发补全——
    // 下一次弹窗忽略成员访问门控展示全部模板（completion.ts setForceShowAll）
    { id: "force_show_templates", label: t("main.cmd.ltForceShow"), run: () => liveTemplates()?.forceShowAll() },
    { id: "markdown_preview", label: t("main.cmd.mdPreview"), run: () => mdPreview.togglePreview() },
    // open_file_dev_plan 补入口：当前 md 编辑 tab 一键切纯预览 Tab（编辑 Tab 保留后台）
    { id: "md_switch_preview", label: t("main.cmd.mdSwitchPreview"), run: () => { const p = app.activeTab?.path; if (p && mdPreview.isMarkdownPath(p)) openPreviewTab(p); } },
    { id: "format_document", label: t("main.cmd.formatDoc"), hint: "Shift+Alt+F", run: () => void app.editor.getAction("editor.action.formatDocument")?.run() },
    { id: "open_settings", label: t("main.cmd.openSettings"), run: () => openSettingsPanel() },
    // PR-S1/S2（onboarding plan §3.1）：新手指南 + 欢迎页 force-show 进命令面板
    { id: "onboarding_guide", label: t("main.cmd.guide"), run: () => void openOnboardingGuide() },
    // MB-13：内置帮助文档（与帮助菜单同一入口，提升可发现性）
    { id: "help_docs", label: t("menu.help.docs"), run: () => void openHelpDocs() },
    { id: "welcome_page", label: t("main.cmd.welcome"), run: () => { if (isWelcomeForced()) dismissWelcomeOverlay(); else showWelcomeOverlay(); } },
    { id: "new_project", label: t("main.cmd.newProject"), run: () => openNewProjectPanel() },
    { id: "git_clone", label: t("cloneRepository.cmdLabel"), run: () => openCloneTab() },
    { id: "git_panel", label: t("main.cmd.gitPanel"), run: () => setSidebarTab("git") },
    // 体验审查 D-4：依赖健康此前只有「状态栏图标 / 面板内分区」两个入口，键盘用户不可达、
    // 也搜不到；补命令面板条目（与状态栏图标共用 openDepHealthPanel 单一入口）
    { id: "dep_health_panel", label: t("dep.panel.cmdOpen"), run: () => openDepHealthPanel() },
    // P0-1：git 高频操作进命令面板（对标 VS Code Git: * 命令族）——
    // 此前仅 git_panel 一条，键盘流用户完全不可达（报告 D9）
    { id: "git_init", label: t("main.cmd.gitInit"), run: () => void gitInitRepo() },
    { id: "git_stage_all", label: t("main.cmd.gitStageAll"), run: () => void stageAllChanges() },
    { id: "git_discard_all", label: t("main.cmd.gitDiscardAll"), run: () => void discardAllChanges() },
    { id: "git_commit", label: t("main.cmd.gitCommit"), run: () => { setSidebarTab("git"); ($("git-commit-msg") as HTMLTextAreaElement).focus(); } },
    { id: "git_commit_all", label: t("main.cmd.gitCommitAll"), run: () => void commitAll() },
    { id: "git_fetch", label: t("main.cmd.gitFetch"), run: () => void gitRemoteOp("fetch") },
    { id: "git_pull", label: t("main.cmd.gitPull"), run: () => void gitRemoteOp("pull") },
    { id: "git_push", label: t("main.cmd.gitPush"), run: () => void gitRemoteOp("push") },
    { id: "git_stash", label: t("main.cmd.gitStash"), run: () => void gitStash() },
    { id: "git_stash_pop", label: t("main.cmd.gitStashPop"), run: () => void gitStashPop() },
    { id: "git_history", label: t("main.cmd.gitHistory"), run: () => { setSidebarTab("git"); toggleHistory(); } },
    { id: "git_branches", label: t("main.cmd.gitBranches"), run: () => { setSidebarTab("git"); toggleBranchList(); } },
    // 迭代 3：高级工作流进命令面板（cherry-pick/reset 等历史操作走历史条目右键）
    { id: "git_sync_status", label: t("main.cmd.gitSyncStatus"), run: () => { setSidebarTab("git"); toast(t("main.cmd.syncUpdated"), "info"); void refreshBranchPanel(); } },
    { id: "todo_panel", label: t("main.cmd.todoPanel"), run: () => setSidebarTab("todo") },
    // B3：数据库工具窗（引擎在 Rust db_cmds.rs；侧栏见 sqliteView.ts，Tab 见 sqliteTabs.ts）
    { id: "db_add_connection", label: t("database.cmdOpen"), run: () => { setSidebarTab("database"); void addConnection(); } },
    { id: "db_new_query", label: t("database.cmdNewQuery"), run: () => { setSidebarTab("database"); openQueryTabForActive(); } },
    // PR-S2 巡礼（onboarding plan §3.2b）：open_devtools 此前只有键位（Ctrl+Shift+T）与
    // keybindings.ts 分发，命令面板查不到——巡礼「试一下」挂注册表 id，一并补上可发现性
    { id: "open_devtools", label: t("main.cmd.devtools"), run: () => openDevToolsPanel() },
    // P1（UX 审查）：高频操作进命令面板（id 对齐键位表 → 提示自动跟随改键）
    { id: "close_tab", label: t("main.cmd.closeTab"), run: () => { if (app.activeTab) void closeTab(app.activeTab); } },
    { id: "new_file", label: t("main.cmd.newFile"), run: () => void createFileInteractive() },
    { id: "toggle_sidebar", label: t("main.cmd.toggleSidebar"), run: () => toggleSidebar() },
    { id: "toggle_bottom", label: t("main.cmd.toggleBottom"), run: () => toggleBottomPanel() },
    // 问题面板（PyCharm Problems View 同位；hint 跟随键位表改键，run 直接调域入口）
    { id: "open_problems", label: t("main.cmd.problems"), run: () => openProblemsPanel() },
    // PR-1（plugin_system_design §9.9）：注册表中的工具统一以「工具: <title>」前缀进命令面板
    ...listDevTools().map((tool) => ({
      id: `tool_${tool.id}`,
      label: t("main.cmd.toolPrefix", { title: tool.title }), // 参数名避开 t（i18n 取词函数，踩坑 ⑤）
      run: () => openDevTools(tool.id),
    })),
    // PR-2：插件 inline 变换入口（§9.15：命令面板「工具: <inline.label>」）
    ...listInlineEntries(listPluginRecords(), true).map((e) => ({
      id: `inline_${e.toolId}`,
      label: inlineCommandLabel(e),
      run: () => void runInline(e.toolId),
    })),
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
export async function showBreakpointMenu(path: string, line: number, x: number, y: number): Promise<void> {
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
        label: has ? t("main.bp.editCondition") : t("main.bp.addCondition"),
        icon: "debug-breakpoint-conditional",
        // 条件为真才断下——爬虫循环「第 N 次迭代才断」场景刚需
        detail: spec?.condition ? t("main.bp.current", { value: spec.condition }) : undefined,
        action: () => {
          void openPrompt({
            title: t("main.bp.conditionTitle", { name: basename(path), line: line }),
            label: t("main.bp.conditionLabel"),
            value: spec?.condition ?? "",
            placeholder: "i > 10",
          }).then((v) => {
            if (v === null) return; // 取消：保持原值
            apply({ ...spec, condition: v || undefined });
          });
        },
      },
      {
        label: t("main.bp.hitCount"),
        icon: "debug-breakpoint-function",
        detail: spec?.hitCondition ? t("main.bp.current", { value: spec.hitCondition }) : undefined,
        action: () => {
          void openPrompt({
            title: t("main.bp.hitTitle", { name: basename(path), line: line }),
            label: t("main.bp.hitLabel"),
            value: spec?.hitCondition ?? "",
            placeholder: ">3",
          }).then((v) => {
            if (v === null) return;
            apply({ ...spec, hitCondition: v || undefined });
          });
        },
      },
      {
        label: has && spec?.logMessage ? t("main.bp.editLog") : t("main.bp.setLogpoint"),
        icon: "debug-breakpoint-log",
        detail: spec?.logMessage ? t("main.bp.current", { value: spec.logMessage }) : undefined,
        action: () => {
          void openPrompt({
            title: t("main.bp.logTitle", { name: basename(path), line: line }),
            label: t("main.bp.logLabel"),
            value: spec?.logMessage ?? "",
            placeholder: "i={i}, url={url}",
          }).then((v) => {
            if (v === null) return;
            apply({ ...spec, logMessage: v || undefined });
          });
        },
      },
      {
        label: t("main.bp.toPlain"),
        icon: "debug-breakpoint",
        disabled: kind === "plain",
        disabledReason: t("main.bp.alreadyPlain"),
        action: () => apply(null),
      },
      {
        // B-6：启用/禁用（禁用 = 保留断点与全部属性，但不下发 debugger；gutter 灰点）
        label: has && isBreakpointEnabled(spec) ? t("main.bp.disable") : t("main.bp.enable"),
        icon: "eye-closed",
        disabled: !has,
        disabledReason: t("main.bp.noBpHere"),
        action: () => {
          setBreakpointEnabled(path, line, !isBreakpointEnabled(spec));
          refreshDebugGutter();
        },
      },
      { sep: true },
      has
        ? {
            label: t("main.bp.remove"),
            icon: "trash",
            danger: true,
            action: () => {
              removeBreakpoint(path, line);
              refreshDebugGutter();
            },
          }
        : {
            label: t("main.bp.addHere"),
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

// ---------- 菜单栏（TD-14：机制已迁至 menuBar.ts，此处仅保留菜单项数据源 getMenuItems） ----------

function rootEntry(): Entry {
  return { name: basename(app.workspaceRoot ?? ""), path: app.workspaceRoot ?? "", is_dir: true };
}

/** gutter ▶ 右键菜单（v3.4 §8：对齐四控件——运行脚本 / 运行项目 / 停止 / 运行配置…）。
 *  从 runWidget 注入的 handlers + **即时状态**（runWidgetState 现算，不依赖渲染快照——
 *  菜单打开时刻的状态可能与上次渲染不同）派生，保证各入口动作一致。
 *
 *  ▶ 运行脚本的置灰**直接复用 `computeRunWidget`**（与工具栏按钮同一判定式），
 *  不在菜单里另写一遍条件——此前两处各写一遍导致调试中"按钮置灰、菜单仍可点"
 *  （`scriptDisabledReason` 已含 debugging，菜单只看了 `scriptBusy`，漏了调试态）。 */
export function buildRunMenuItems(): MenuItem[] {
  const h = runWidgetHandlers();
  const s = runWidgetState();
  const computed = computeRunWidget(s);
  return [
    {
      label: t("main.run.script"),
      icon: "run",
      shortcut: kb.bindingLabel("run_script") || undefined,
      disabled: computed.runScript.disabled,
      disabledReason: s.scriptDisabledReason || t("main.run.preparingScript"),
      action: () => h?.runScript(),
    },
    {
      label: t("main.run.project"),
      icon: "run-all",
      shortcut: kb.bindingLabel("run_project") || undefined,
      disabled: !s.canRunProject || s.projectPreparing,
      disabledReason: s.projectDisabledReason || t("main.run.preparingProject"),
      action: () => h?.runProject(),
    },
    { sep: true },
    {
      label: t("main.run.stop"),
      icon: "debug-stop",
      shortcut: kb.bindingLabel("stop") || undefined,
      disabled: !s.debugging && !s.stopTarget,
      disabledReason: t("main.run.noneRunning"),
      action: () => h?.stop(),
    },
    {
      label: t("main.run.config"),
      icon: "gear",
      disabled: !s.canOpenConfig,
      disabledReason: t("main.run.needWorkspace"),
      action: () => h?.openRunConfig(),
    },
  ];
}

/** 测试右键菜单（docs/pytest_dev_plan.md §3.4）：树行与绿箭头 gutter **同源数据**，
 *  两个入口（侧栏树 / 编辑器 glyph）共用本函数，保证菜单永远一致。
 *  运行中置灰（testRunActive；同 scriptDisabledReason 口径）。 */
export function buildTestMenuItems(nodeId: string, name: string): MenuItem[] {
  const running = testRunActive();
  return [
    {
      label: t("test.runThis"),
      icon: "play",
      detail: name,
      disabled: running,
      disabledReason: t("test.runBusy"),
      action: () => void runTestNodes([nodeId]),
    },
    {
      label: t("test.debugThis"),
      icon: "debug-alt",
      detail: name,
      action: () => void debugTest(nodeId),
    },
  ];
}

export function getMenuItems(menu: string): MenuEntry[] {
  switch (menu) {
    case "file": return [
      { label: t("menu.file.newProject"), action: () => openNewProjectPanel() },
      { label: t("menu.file.cloneRepository"), action: () => openCloneTab() },
      // P1（UX 审查）：改走 createFileInteractive——目标目录跟随活动文件（原固定为工作区根），
      // 且键位标签与键位系统同源
      { label: t("menu.file.newFile"), shortcut: kb.bindingLabel("new_file") || undefined, action: () => void createFileInteractive() },
      { label: t("menu.file.newFolder"), action: () => { if (app.workspaceRoot) void createDirAt(rootEntry()); } },
      { sep: true, label: "" },
      { label: t("menu.file.openWorkspace"), shortcut: "Ctrl+K Ctrl+O", action: () => void openFolderFromToolbar() },
      { label: t("menu.file.openFile"), action: () => void openFileFromDisk() },
      { label: t("menu.file.openWorkspaceInNewWindow"), action: () => void openFolderInNewWindow() },
      { label: t("menu.file.save"), shortcut: kb.bindingLabel("save") || undefined, action: () => void saveActive() },
      { sep: true, label: "" },
      {
        label: t("menu.file.recentWorkspaces"),
        submenu: async () => {
          const recents = await getRecentWorkspaces();
          if (recents.length === 0) return [{ label: t("menu.file.noRecentWorkspaces") }];
          const items: MenuEntry[] = recents.map((p) => ({
            label: basename(p),
            detail: p,
            action: () => openWorkspace(p).catch(console.error),
          }));
          items.push({ sep: true, label: "" });
          items.push({ label: t("menu.file.clearRecentWorkspaces"), action: () => void clearRecentWorkspaces() });
          return items;
        },
      },
      // MB-12：「最近的文件」自「视图」迁入（与「最近的工作区」同区，属文件范畴）
      { label: t("menu.file.openRecentFiles"), shortcut: kb.bindingLabel("recent_files") || undefined, action: () => void openRecentFiles() },
      { sep: true, label: "" },
      { label: t("menu.file.closeWorkspace"), action: () => void closeWorkspace() },
      // MB-12：偏好设置归「文件」（VS Code File→Preferences / PyCharm File→Settings 同位），
      // 自「视图」迁入；Live Templates 本就是设置面板 templates 分类
      { sep: true, label: "" },
      {
        label: t("menu.file.preferences"),
        submenu: () => [
          { label: t("menu.file.settings"), shortcut: kb.bindingLabel("open_settings") || undefined, action: () => openSettingsPanel() },
          { label: "Live Templates", action: () => openSettingsPanel("templates") },
        ],
      },
    ];
    case "edit": return [
      { label: t("menu.edit.undo"), shortcut: "Ctrl+Z", action: () => { app.editor.trigger("menu", "undo", null); } },
      { label: t("menu.edit.redo"), shortcut: "Ctrl+Shift+Z", action: () => { app.editor.trigger("menu", "redo", null); } },
      { sep: true, label: "" },
      // MB-15：注释切换（Monaco 内建，PyCharm Ctrl+/ 同款高频项）
      { label: t("menu.edit.toggleComment"), shortcut: "Ctrl+/", action: () => { app.editor.trigger("menu", "editor.action.commentLine", null); } },
      { sep: true, label: "" },
      { label: t("menu.edit.find"), shortcut: "Ctrl+F", action: () => { app.editor.trigger("menu", "actions.find", null); } },
      { label: t("menu.edit.replace"), shortcut: "Ctrl+H", action: () => { app.editor.trigger("menu", "editor.action.startFindReplaceAction", null); } },
      // MB-15：全局搜索入口（复用 global_search 键位；搜索侧栏目前无替换 UI，「在文件中查找/替换」
      // 落地为切侧栏 + 聚焦，与 Ctrl+Shift+F 行为一致——侧栏补替换框属另一条独立需求）
      { label: t("menu.edit.findInFiles"), shortcut: kb.bindingLabel("global_search") || undefined, action: () => { setSidebarTab("search"); ($("search-input") as HTMLInputElement).focus(); } },
      { sep: true, label: "" },
      { label: t("menu.edit.formatDocument"), shortcut: "Shift+Alt+F", action: () => { void app.editor.getAction("editor.action.formatDocument")?.run(); } },
      // P0：Optimize Imports（PyCharm「编辑 → Optimize Imports」同位置）
      {
        label: t("menu.edit.optimizeImports"),
        shortcut: kb.bindingLabel("optimize_imports") || undefined,
        action: () => void optimizeImportsActive(),
      },
    ];
    case "view": return [
      { label: t("menu.view.fileTree"), action: () => setSidebarTab("files") },
      { label: t("menu.view.search"), shortcut: kb.bindingLabel("global_search") || undefined, action: () => setSidebarTab("search") },
      // P2：本地历史是工具窗入口，归属「视图」（MB-11 口径：布局开关 + 工具窗）
      { label: t("menu.view.localHistory"), shortcut: kb.bindingLabel("local_history") || undefined, action: () => void openLocalHistory() },
      { sep: true, label: "" },
      // P2：书签 / 运行历史
      { label: t("menu.view.bookmarkList"), shortcut: kb.bindingLabel("bookmark_list") || undefined, action: () => void openBookmarks() },
      { sep: true, label: "" },
      { label: t("menu.view.markdownPreview"), shortcut: kb.bindingLabel("markdown_preview") || undefined, action: () => mdPreview.togglePreview() },
      // P1（UX 审查）：面板开关 + 设置补键位标签，菜单与快捷键同源（改键后自动跟随）
      { label: t("menu.view.toggleSidebar"), shortcut: kb.bindingLabel("toggle_sidebar") || undefined, action: () => toggleSidebar() },
      { label: t("menu.view.toggleBottomPanel"), shortcut: kb.bindingLabel("toggle_bottom") || undefined, action: () => toggleBottomPanel() },
      // 问题面板（PyCharm Problems View 同位，Alt+0）
      { label: t("menu.view.problemsPanel"), shortcut: kb.bindingLabel("open_problems") || undefined, action: () => openProblemsPanel() },
    ];
    // MB-11：前往（Go）——收编原「视图」的导航/跳转类命令（VS Code Go / PyCharm Navigate 同位）。
    // 口径：命令面板 / Search Everywhere 属「搜索式导航」，归此处而非 VS Code View 菜单
    case "go": return [
      { label: t("menu.go.gotoFile"), shortcut: kb.bindingLabel("goto_file") || undefined, action: () => void openQuickOpen("files") },
      // PR-G：文件内符号（PyCharm Navigate → File Structure 同位；与命令面板同走键位 handler）
      { label: t("menu.go.gotoSymbolInFile"), shortcut: kb.bindingLabel("goto_symbol") || undefined, action: () => kb.triggerEditorKeybindingAction("goto_symbol") },
      { label: t("menu.go.gotoLine"), shortcut: kb.bindingLabel("goto_line") || undefined, action: () => void openQuickOpen("line") },
      { label: "Search Everywhere", shortcut: "Double Shift", action: () => void openQuickOpen("all") },
      { label: t("menu.go.commandPalette"), shortcut: kb.bindingLabel("command_palette") || undefined, action: () => void openQuickOpen("commands") },
      { sep: true, label: "" },
      { label: t("menu.go.back"), shortcut: kb.bindingLabel("nav_back") || undefined, action: () => void goBack() },
      { label: t("menu.go.forward"), shortcut: kb.bindingLabel("nav_forward") || undefined, action: () => void goForward() },
    ];
    // MB-10：运行——运行 + 调试合并为一级菜单（裁决 2026-09-21）。运行区 / 调试区 / 收尾三分区，
    // action 全部复用既有函数（与命令面板 / 标题栏图标同源）；单步三命令走命令面板同款动态导入
    case "run": return [
      { label: t("menu.run.runScript"), shortcut: kb.bindingLabel("run_script") || undefined, action: () => { if (app.activeTab) void runScript(app.activeTab.path); } },
      { label: t("menu.run.runProject"), shortcut: kb.bindingLabel("run_project") || undefined, action: () => void runProject() },
      { label: t("menu.run.runConfig"), action: () => openRunConfig() },
      { label: t("menu.run.stop"), shortcut: kb.bindingLabel("stop") || undefined, action: () => void stopRun() },
      { sep: true, label: "" },
      { label: t("menu.run.startDebug"), shortcut: kb.bindingLabel("debug") || undefined, action: () => void runDebug() },
      { label: t("menu.run.stopDebug"), shortcut: kb.bindingLabel("debug_stop") || undefined, action: () => void stopDebugSession() },
      // TD-027 A3：线程 id 同样读 debugView 真源（与 windowKeys 键位路由同源，勿再硬编码 1）
      { label: t("menu.run.stepOver"), shortcut: kb.bindingLabel("debug_step_over") || undefined, action: () => void import("./dap/client").then((m) => m.dapNext(currentThreadId())) },
      { label: t("menu.run.stepInto"), shortcut: kb.bindingLabel("debug_step_into") || undefined, action: () => void import("./dap/client").then((m) => m.dapStepIn(currentThreadId())) },
      { label: t("menu.run.stepOut"), shortcut: kb.bindingLabel("debug_step_out") || undefined, action: () => void import("./dap/client").then((m) => m.dapStepOut(currentThreadId())) },
      { label: t("menu.run.runToCursor"), shortcut: kb.bindingLabel("debug_run_to_cursor") || undefined, action: () => void runToCursorAtCursor() },
      { label: t("menu.run.evaluateExpression"), shortcut: kb.bindingLabel("debug_evaluate") || undefined, action: () => void onEvaluateShortcut() },
      { sep: true, label: "" },
      { label: t("menu.run.runHistory"), shortcut: kb.bindingLabel("run_history") || undefined, action: () => openRunHistory() },
    ];
    // PR-1（plugin_system_design §9.8）：工具菜单按 category 分组 flyout 子菜单，
    // 渲染走 menuBar.ts 既有 submenu 机制（悬停延时展开 + →/← 键盘导航），此处只组装数据
    case "tools": return buildToolsMenu();
    // MB-13：帮助菜单（裁决 2026-09-21）——关于走 openAlert 轻量档；日志/数据目录复用设置页
    // 既有 invoke 命令；作者指南复用插件 tab 的 openGuide（同一份指南文档，导出复用）。
    // PR-S1/S2（onboarding plan）：新增「新手指南」（指南落盘打开）与「欢迎页」（force-show toggle，
    // 收掉 MB-13「欢迎页一期不纳入」登记）。
    case "help": return [
      // 帮助文档（内置完整手册，随包分发；主入口置于首位）
      {
        label: t("menu.help.docs"),
        action: () => void openHelpDocs(),
      },
      {
        label: t("menu.help.onboardingGuide"),
        action: () => void openOnboardingGuide(),
      },
      {
        label: t("menu.help.welcomePage"),
        action: () => {
          // toggle（方案 §3.2c 关闭途径 ①）：force 态再点一次解除；否则置位显示完整版覆盖层
          if (isWelcomeForced()) dismissWelcomeOverlay();
          else showWelcomeOverlay();
        },
      },
      { sep: true, label: "" },
      {
        label: t("menu.help.about"),
        action: () => {
          void getVersion()
            .then((v) => {
              void openAlert({
                title: t("main.about.title"),
                message: t("main.about.body", { version: v }),
                okLabel: t("main.tab.close"),
              });
            })
            .catch((e) => toastFail(t("main.about.versionFail"), e));
        },
      },
      { sep: true, label: "" },
      { label: t("menu.help.authorGuide"), action: () => void openGuide() },
      { sep: true, label: "" },
      { label: t("menu.help.openLogDir"), action: () => invoke("open_log_dir").catch((e) => toastFail(t("main.about.openLogDir"), e)) },
      { label: t("menu.help.openDataDir"), action: () => invoke("open_data_dir").catch((e) => toastFail(t("main.about.openDataDir"), e)) },
    ];
    // P0-2：Git 一级菜单（报告 D10）——此前 git 操作只能从侧栏「更多操作」二级菜单触达
    case "git": return [
      { label: t("menu.git.initRepo"), action: () => void gitInitRepo() },
      { sep: true, label: "" },
      { label: t("menu.git.stageAll"), action: () => void stageAllChanges() },
      { label: t("menu.git.discardAll"), action: () => void discardAllChanges() },
      {
        label: t("menu.git.commit"),
        action: () => { setSidebarTab("git"); ($("git-commit-msg") as HTMLTextAreaElement).focus(); },
      },
      { label: t("menu.git.commitAll"), action: () => void commitAll() },
      { sep: true, label: "" },
      // MB-14：同步 / 贮藏归组子菜单（原 5 项平铺 → 2 个父项），视觉长度减半；action 原样迁移
      {
        label: t("menu.git.sync"),
        submenu: () => [
          { label: t("menu.git.fetch"), action: () => void gitRemoteOp("fetch") },
          { label: t("menu.git.pull"), action: () => void gitRemoteOp("pull") },
          { label: t("menu.git.push"), action: () => void gitRemoteOp("push") },
        ],
      },
      {
        label: t("menu.git.stash"),
        submenu: () => [
          { label: t("menu.git.stashChanges"), action: () => void gitStash() },
          { label: t("menu.git.stashPop"), action: () => void gitStashPop() },
        ],
      },
      { sep: true, label: "" },
      { label: t("menu.git.switchBranch"), action: () => { setSidebarTab("git"); toggleBranchList(); } },
      { label: t("menu.git.commitHistory"), action: () => { setSidebarTab("git"); toggleHistory(); } },
      { sep: true, label: "" },
      { label: t("menu.git.openGitPanel"), action: () => setSidebarTab("git") },
    ];
    default: return [];
  }
}
