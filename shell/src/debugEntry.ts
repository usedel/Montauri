// 调试入口域（F5 链路）：从 main.ts 外提（阶段二 main.ts 拆分第一刀）。
//
// 为什么独立成文件：`main.ts` 已 2,919 行、距 `ci/budgets.toml` 的 3,000 上限只剩 81 行，
// 而调试入口（启动 / 停止 / Run to Cursor / 求值）是一组内聚且不依赖 main 私有状态的动作——
// 它只调 dap / runFlow / debugGutter / debugView / debugConsole 等域模块，可以整块搬走。
// 搬移是**纯位移**：函数体逐字未改，调用方（main 的菜单 / 命令面板 / 键位）改 import 即可。

import { invoke } from "@tauri-apps/api/core";
import { app, outputEl } from "./state";
import { t } from "./i18n";
import { toast, toastFail } from "./toast";
import { basename } from "./util";
import { appendOutputLine } from "./output";
import { openAlert } from "./dialog";
import { gotoFromLink } from "./tracebackLink";
import { setSidebarTab } from "./views";
import * as dap from "./dap/client";
import { clearCurrentLine, pushAllBreakpoints } from "./debugGutter";
import { notifyDepFound, runToCursor as runToCursorIn } from "./debugView";
import { notifyNotPaused, openEvaluatePrompt } from "./debugConsole";
import { isRunBusy, prepareRun } from "./runFlow";
import type { RunConfig } from "./runState";

// ---------- 调试（debug dev plan §6.7：调试运行入口） ----------

/** 调试运行入口：prepareRun 复用 → debug_detect（debugpy 定位 + 依赖提示）→
 * debug_start（后端拉起 debugpy + TCP）→ DAP 握手（initialize → setBreakpoints →
 * configurationDone）→ 切调试侧栏 + 终端承载 stdout。 */
export async function runDebug(): Promise<void> {
  if (!app.activeTab) return;
  const path = app.activeTab.path;
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    toast(t("main.debug.notPython", { name: basename(path) }), "info");
    return;
  }
  // 调试态与运行态互斥（后端强制）：正在运行/准备时提示先停止
  if (isRunBusy()) {
    toast(t("main.debug.runBusy"), "info");
    return;
  }
  const phase = dap.currentPhase();
  if (phase === "starting" || phase === "running" || phase === "stopped") {
    toast(t("main.debug.sessionBusy"), "info");
    return;
  }
  // P1-13（2026-09-29 review）：phase 门控到 startDebug 内部才置 starting——prepareRun /
  // get_run_config / debug_detect 多个 await 期间双击 F5 可并发穿透，第二个失败调用的
  // resetDebugState 会把第一会话的 phase 踩回 idle。这里在首个 await 前同步置位，
  // 失败路径由下面的 catch / 各早退点统一复位。
  // 复核补丁（2026-09-30）：markStarting 之后的代码若出现未预期异常（各早退点已复位，
  // 但 prepareRun / appendOutputLine 等 throw 时无人收口），phase 会永卡 starting——
  // F5 被门控拒死。包 try/catch 兜底；`sessionEstablished` 在 startDebug 握手成功的
  // 那一刻置位，其后 phase 归状态机接管，兜底不再触发（避免误清已建立的后端会话，
  // 同 P1-12 场景）。
  dap.markStarting();
  let sessionEstablished = false;
  try {
    await runDebugInner(path, () => { sessionEstablished = true; });
  } catch (e) {
    appendOutputLine(outputEl, t("main.debug.startError", { msg: String(e) }), "stderr", gotoFromLink, "debug");
    toastFail(t("main.debug.start"), e);
  } finally {
    if (!sessionEstablished) dap.resetDebugState();
  }
}

/** runDebug 的主体（markStarting 已由外层置位；异常统一在外层兜底复位）。
 *  `onEstablished` 在 startDebug 握手成功时回调（此后异常不复位 phase）。 */
export async function runDebugInner(path: string, onEstablished: () => void): Promise<void> {
  // prepareRun 复用（自动保存 / 依赖预检 / 读运行配置；stdin=file 场景由后端 fail fast）
  const prep = await prepareRun(path);
  if (!prep) {
    dap.resetDebugState(); // markStarting 早退复位（P1-13）
    return;
  }

  // P1：调试复用运行配置——后端 debug_start 直读 run_configs（参数 / env / 工作目录），
  // 这里把「用上了什么」显式回显，避免用户以为调试是完全独立的一套配置。
  if (app.workspaceRoot) {
    const rc = await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path })
      .catch(() => ({} as Partial<RunConfig>));
    const parts: string[] = [];
    if (rc.args?.trim()) parts.push(t("main.debug.argsLine", { args: rc.args.trim() }));
    if (rc.env?.length) parts.push(t("main.debug.envLine", { n: rc.env.length }));
    if (parts.length) {
      appendOutputLine(outputEl, t("main.debug.reuseConfig", { parts: parts.join("，") }), "hint", gotoFromLink, "debug");
    }
  }

  // debug_detect：debugpy 定位 + 依赖声明提示（§5.1.6：提示性质，不阻断）
  interface DebugDetectResult { debugpyOk: boolean; debugpyDir: string | null; depFound: boolean; depFiles: string[] }
  let detect: DebugDetectResult;
  try {
    detect = await invoke<DebugDetectResult>("debug_detect", { workspaceRoot: app.workspaceRoot });
  } catch (e) {
    appendOutputLine(outputEl, t("main.debug.detectError", { msg: String(e) }), "stderr", gotoFromLink, "debug");
    toastFail(t("main.debug.detect"), e);
    dap.resetDebugState(); // markStarting 早退复位（P1-13）
    return;
  }
  if (!detect.debugpyOk) {
    // E 类（长指导走 openAlert 对话框，非输出面板 stderr；附可复制命令）
    void openAlert({
      title: t("main.debug.noDebugpyTitle"),
      message:
        t("main.debug.noDebugpyBody1") +
        t("main.debug.noDebugpyBody2") +
        "powershell -ExecutionPolicy Bypass -File tools/fetch-debugpy.ps1",
      okLabel: t("main.debug.gotIt"),
    });
    dap.resetDebugState(); // markStarting 早退复位（P1-13）
    return;
  }
  // §3.5：依赖清单命中 → 输出面板一次性提示（自带副本不冲突），不弹窗不阻断
  if (detect.depFound) {
    notifyDepFound(detect.depFiles);
    appendOutputLine(
      outputEl,
      t("main.debug.depHint", { files: detect.depFiles.join("、") }),
      "hint",
      gotoFromLink,
    );
  }

  appendOutputLine(outputEl, `> [debug] ${basename(path)}  (${path})`, "cmd", gotoFromLink, "debug");
  try {
    await dap.startDebug(path, app.workspaceRoot, pushAllBreakpoints);
    onEstablished(); // 握手成功：phase 归状态机接管，外层兜底从此不触发
  } catch (e) {
    appendOutputLine(outputEl, t("main.debug.startFailed", { msg: String(e) }), "stderr", gotoFromLink, "debug");
    toastFail(t("main.debug.start"), e);
    // P1-12（2026-09-29 review）：startDebug 中途失败（握手超时 / 断点异常 / debug_start
    // 后任一步失败）时，后端 DEBUG 槽仍持有 adapter——只复位前端 phase 会让下次启动被
    // 「已有调试会话在运行」永久卡住。先停后端会话再复位（stopDebug 对未启动场景幂等）。
    await dap.stopDebug();
    dap.resetDebugState();
    return;
  }
  // 切到调试侧栏（§6.7）；终端 tab 承载调试进程 stdout（后端已落 PTY）
  setSidebarTab("debug");
}

/** 停止调试（Shift+F5 / 工具栏停止 / 调试态下的停止按钮路由） */
export async function stopDebugSession(): Promise<void> {
  await dap.stopDebug();
  dap.resetDebugState();
  clearCurrentLine();
}

/** Alt+F9 Run to Cursor：跑到光标所在行（临时断点 + 继续，命中断点后自动撤掉） */
export async function runToCursorAtCursor(): Promise<void> {
  const tab = app.activeTab;
  if (!tab) return;
  const line = app.editor.getPosition()?.lineNumber;
  if (!line) return;
  if (dap.currentPhase() !== "stopped") {
    toast(t("main.debug.runToCursorHint"), "info");
    return;
  }
  await runToCursorIn(tab.path, line);
}

/** Alt+F8 求值表达式：非暂停态给明确指引，暂停态切到调试侧栏并弹输入框 */
export async function onEvaluateShortcut(): Promise<void> {
  if (dap.currentPhase() !== "stopped") {
    await notifyNotPaused();
    return;
  }
  setSidebarTab("debug");
  await openEvaluatePrompt();
}
