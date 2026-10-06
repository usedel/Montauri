// 全局键位路由（window 级 keydown 派发 + Double Shift 手势）：从 main.ts 外提（阶段二 init 阶段化第二轮）。
//
// 为什么独立成文件：这是「所有窗口级快捷键 → 动作」的唯一派发点，本身是一个完整阶段；
// 它调用的动作几乎都由功能域直接导出（runFlow / debugEntry / quickOpen / navHistory / bookmarks…），
// 真正属于 main 私有的只有 4 个（saveActive / newScratch / closeTab / cycleTab），
// 经 `setWindowKeyActions` 注入解环——与 menuItems 的 `setMenuItemsHandlers` 同一套约定，
// 不制造 main ⇄ windowKeys 静态环。

import * as dap from "./dap/client";
import * as kb from "./keybindings";
import * as mdPreview from "./markdownPreview";
import { app, type Tab } from "./state";
import { t } from "./i18n";
import { toast } from "./toast";
import { setSidebarTab } from "./views";
import { toggleSidebar } from "./layout";
import { toggleBottomPanel } from "./termUi";
import { createFileInteractive } from "./fileTree";
import { openSettingsPanel } from "./settingsPanel";
import { openProblemsPanel } from "./problemsPanel";
import { openDevToolsPanel } from "./devtools";
import { openRecentFiles } from "./recentFiles";
import { goBack, goForward } from "./navHistory";
import { openLocalHistory } from "./localHistory";
import { openBookmarks, toggleBookmarkAtCursor } from "./bookmarks";
import { openRunHistory } from "./runHistory";
import { jumpToLastEdit } from "./editPoints";
import { reopenClosedTab } from "./tabReopen";
import { isQuickOpenOpen, openQuickOpen } from "./quickOpen";
import { runProject, runScript, stopRun } from "./runFlow";
import { onEvaluateShortcut, runDebug, runToCursorAtCursor, stopDebugSession } from "./debugEntry";

/** P1：Double Shift 的判定窗口（ms）——两次 Shift 抬起间隔超过它就不算双击 */
const DOUBLE_SHIFT_MS = 400;

/** main 注入的私有动作（解环：本文件不反向 import main）。 */
export interface WindowKeyActions {
  saveActive: () => void;
  newScratch: () => void;
  closeTab: (tab: Tab) => void;
  cycleTab: (dir: 1 | -1) => void;
}

let A: WindowKeyActions | null = null;

/** 由 main 的 init 在最早期调用（先于 wireWindowKeys）。 */
export function setWindowKeyActions(a: WindowKeyActions): void {
  A = a;
}

function need(): WindowKeyActions {
  if (!A) throw new Error("[windowKeys] actions 未注入：请先在 init 里调用 setWindowKeyActions");
  return A;
}

export function wireWindowKeys(): void {
  const act = need();
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
    if (id === "save") act.saveActive();
    else if (id === "run_script") void runScript();
    else if (id === "run_project") void runProject();
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
    else if (id === "scratch_new") act.newScratch();
    else if (id === "run_history") openRunHistory();
    // P1（UX 审查）：高频操作键位（关闭标签 / 新建文件 / 设置 / 侧栏 / 底部面板）
    else if (id === "close_tab") { if (app.activeTab) act.closeTab(app.activeTab); }
    // 标签页循环切换（Ctrl+Tab / Ctrl+Shift+Tab）
    else if (id === "next_tab") act.cycleTab(1);
    else if (id === "prev_tab") act.cycleTab(-1);
    else if (id === "new_file") void createFileInteractive();
    else if (id === "open_settings") openSettingsPanel();
    else if (id === "toggle_sidebar") toggleSidebar();
    else if (id === "toggle_bottom") toggleBottomPanel();
    // 问题面板（PyCharm Problems View 同款 Alt+0）
    else if (id === "open_problems") openProblemsPanel();
    // 命令面板直达（VS Code Ctrl+Shift+P 同款）：不注册时该组合会触发浏览器/系统「打印」
    else if (id === "command_palette") void openQuickOpen("commands");
    // PR-1：开发工具面板 + picker（Ctrl+Shift+T，toggle 语义）
    else if (id === "open_devtools") openDevToolsPanel();
    // PR-A（dx_features_backlog §6.1）：重开关闭的标签（Ctrl+Shift+Alt+T；Ctrl+Shift+T 已被 DevTools 占用）
    else if (id === "reopen_tab") {
      if (!reopenClosedTab()) toast(t("main.cmd.reopenNone"), "info");
    }
    // PR-D：最近编辑位置（Ctrl+Shift+Backspace，PyCharm Last Edit Location 同款）
    else if (id === "recent_edit_locations") {
      if (!jumpToLastEdit()) toast(t("main.cmd.noEarlierEdit"), "info");
    }
  });

  // P1：Double Shift → Search Everywhere（键位表无法表达双击手势，故固定在此）。
  // 误触防护：两次 Shift 之间若按下过任何**其它**键（如打大写字母 A 的 Shift+A），
  // 计时器立即作废——否则连续输入大写字母会被误判成双击 Shift。
  // keydown 必须 capture：焦点在 Monaco 内时编辑器会 stopPropagation 非认领键，
  // 冒泡阶段到不了 window——「Shift+End 选行后紧接着 Shift+F10 开右键菜单」会被误判成
  // Double Shift（F10 keydown 被吞、reset 不发生，两次 Shift keyup 落进 400ms 窗口）。
  let lastShiftUpAt = 0;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Shift") lastShiftUpAt = 0;
    },
    { capture: true },
  );
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
}
