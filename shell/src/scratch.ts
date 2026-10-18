// Scratch / 单元格执行（VS Code 插件调研报告 借鉴-2 · 对标 Jupyter 的 cell 执行）。
//
// 粒度：`# %%` 分隔的单元格（解析在 scratchCore.ts 纯函数层，本文件只做执行与接线）。
// 进程：按需起一个解释器会话（scratch_cmds.rs），**空闲 5 分钟回收**——这是本功能立项的前提
// （报告 §4 借鉴-2 的「不做的条件」），改动本文件不得绕过该纪律。
//
// 结果输出到「输出」面板（复用 appendOutputLine，不新开面板/不新增常驻 UI）。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, outputEl, type MonacoModule } from "./state";
import { t } from "./i18n";
import { toastFail } from "./toast";
import { appendOutputLine } from "./output";
import { setBottomTab } from "./termUi";
import * as kb from "./keybindings";
import { cellBounds, cellCode, IDLE_TIMEOUT_MS } from "./scratchCore";

export { cellBounds, cellCode, isCellSeparator, IDLE_TIMEOUT_MS } from "./scratchCore";

// ---------- 执行 ----------

let idleTimer: number | null = null;
let running = false;

/** 重置空闲回收计时（每次执行后调用；到点即 stop，不留常驻） */
function scheduleIdleRecycle(): void {
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    void invoke("scratch_eval", { action: "stop" }).catch(() => undefined);
  }, IDLE_TIMEOUT_MS);
}

/** 运行光标所在单元格（结果进「输出」面板） */
export async function runCell(editor: MonacoApi.editor.IStandaloneCodeEditor): Promise<void> {
  const model = editor.getModel();
  const pos = editor.getPosition();
  if (!model || !pos || !app.workspaceRoot) return;
  if (running) return; // 连点穿透守卫：检查 + 置位同步完成
  running = true;
  const b = cellBounds(model.getLinesContent(), pos.lineNumber);
  const code = cellCode(model.getLinesContent(), b).trim();
  try {
    if (!code) {
      appendOutputLine(outputEl, t("scratch.empty"), "stderr");
      setBottomTab("output");
      return;
    }
    appendOutputLine(outputEl, t("scratch.header", { range: `${b.startLine}-${b.endLine}` }), "cmd");
    setBottomTab("output");
    const res = await invoke<{ out: string; running: boolean; timed_out: boolean }>("scratch_eval", {
      action: "run",
      code,
      workspaceRoot: app.workspaceRoot,
    });
    if (res.out) appendOutputLine(outputEl, res.out, "stdout");
    if (res.timed_out) appendOutputLine(outputEl, t("scratch.recycled"), "stderr");
  } catch (e) {
    appendOutputLine(outputEl, String(e), "stderr");
    toastFail(t("scratch.fail"), e);
  } finally {
    running = false;
    scheduleIdleRecycle();
  }
}

/** 显式关闭会话（ADR-0010「可显式关闭」的另一半；空闲计时器是另一半） */
async function stopSession(): Promise<void> {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
  try {
    await invoke("scratch_eval", { action: "stop" });
    appendOutputLine(outputEl, t("scratch.stopped"), "stdout");
  } catch {
    /* 会话本就不存在：静默 */
  }
}

// ---------- 接线 ----------

/**
 * 注册：编辑器右键菜单两项 + `run_cell` 键位。
 * 由 main.ts 的 init 一次性调用（handler 落本模块，不再吃 main.ts 的行数预算）。
 */
export function initScratch(
  editor: MonacoApi.editor.IStandaloneCodeEditor,
  _monaco: MonacoModule,
): void {
  editor.addAction({
    id: "montauri.runCell",
    label: t("scratch.actionRun"),
    keybindings: [],
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.85,
    run: () => void runCell(editor),
  });
  editor.addAction({
    id: "montauri.stopScratch",
    label: t("scratch.actionStop"),
    keybindings: [],
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.86,
    run: () => void stopSession(),
  });
  kb.setKeybindingHandler("run_cell", () => void runCell(editor));
}
