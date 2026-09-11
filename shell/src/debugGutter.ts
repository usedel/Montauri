// 调试断点 gutter（docs/python_debug_dev_plan.md §6.4）：glyphMargin 红点装饰 + 点击切换。
// 复用 runGutter.ts 的装饰/命中范式，但独立一套装饰集合（勿与 run gutter 冲突）。
//
// 断点数据源：模块级 Map<filePath, Set<lineNumber>>；调试会话期间同步到 debugger
// （setBreakpoints 请求），停止调试后断点表保留（下次调试自动重放，D3 验收项）。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, type MonacoModule } from "./state";
import * as dap from "./dap/client";

/** 断点表：文件路径 → 行号集合（1 基）。模块级持久（跨会话保留，D3 验收）。 */
const breakpoints = new Map<string, Set<number>>();

let decorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;
let editorRef: MonacoApi.editor.IStandaloneCodeEditor | null = null;
let monacoRef: MonacoModule | null = null;

/** 断点表变更回调（debugView 注册：gutter 点击 / 列表删除后刷新侧栏断点列表） */
let onChange: (() => void) | null = null;

/** 注册断点表变更回调（幂等：后者覆盖前者） */
export function setBreakpointsChangeCallback(cb: (() => void) | null): void {
  onChange = cb;
}

function notifyChange(): void {
  onChange?.();
}

/** 取某文件断点行（排序副本） */
export function getBreakpointLines(path: string): number[] {
  const set = breakpoints.get(path);
  if (!set) return [];
  return [...set].sort((a, b) => a - b);
}

/** 全部断点文件路径（会话启动时批量推送用，§5.3 启动时序） */
export function breakpointFiles(): string[] {
  return [...breakpoints.keys()];
}

/** 是否存在任一断点 */
export function hasAnyBreakpoint(): boolean {
  for (const set of breakpoints.values()) {
    if (set.size > 0) return true;
  }
  return false;
}

/** 切换断点（gutter 点击）；返回切换后的状态（true = 已设断点） */
export function toggleBreakpoint(path: string, line: number): boolean {
  let set = breakpoints.get(path);
  if (!set) {
    set = new Set();
    breakpoints.set(path, set);
  }
  if (set.has(line)) {
    set.delete(line);
    if (set.size === 0) breakpoints.delete(path);
    syncBreakpointsToDebugger(path);
    notifyChange();
    return false;
  }
  set.add(line);
  syncBreakpointsToDebugger(path);
  notifyChange();
  return true;
}

/** 清空某文件全部断点 */
export function clearBreakpoints(path: string): void {
  if (!breakpoints.has(path)) return;
  breakpoints.delete(path);
  syncBreakpointsToDebugger(path);
  notifyChange();
}

/** 直接设置某文件的断点行集合（断点列表删除单行用；完成后同步到 debugger） */
export function setBreakpointLines(path: string, lines: number[]): void {
  if (lines.length === 0) {
    breakpoints.delete(path);
  } else {
    breakpoints.set(path, new Set(lines));
  }
  syncBreakpointsToDebugger(path);
  notifyChange();
}

/**
 * 同步单文件断点到 debugger（§6.4：断点变化 → setBreakpoints）。
 * 仅在会话存活期间发送（starting/running/stopped 均可：暂停态增删断点同样生效）。
 */
export async function syncBreakpointsToDebugger(path: string): Promise<void> {
  const phase = dap.currentPhase();
  if (phase === "idle" || phase === "exited") return;
  try {
    await dap.dapSetBreakpoints(path, getBreakpointLines(path));
  } catch (e) {
    console.warn("[debugGutter] setBreakpoints 失败:", e);
  }
}

/** 全量重放断点（会话启动时 configurationDone 之前调用，§5.3 启动时序） */
export async function pushAllBreakpoints(): Promise<void> {
  for (const path of breakpointFiles()) {
    try {
      await dap.dapSetBreakpoints(path, getBreakpointLines(path));
    } catch (e) {
      console.warn("[debugGutter] setBreakpoints（重放）失败:", e);
    }
  }
}

export function wireDebugGutter(editor: MonacoApi.editor.IStandaloneCodeEditor, monaco: MonacoModule): void {
  editorRef = editor;
  monacoRef = monaco;
  // glyphMargin 点击切换断点（仅 .py/.pyw，与 runGutter 一致；§6.4）
  editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = e.target.position?.lineNumber;
    if (!line) return;
    const tab = app.activeTab;
    if (!tab) return;
    const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
    if (!isPy) return;
    if (e.event.rightButton) return; // 右键不触发（与 run gutter 菜单语义区分）
    toggleBreakpoint(tab.path, line);
    refreshDebugGutter();
  });
}

/** 重算当前文件的断点红点装饰（切 tab / 内容变化 / 断点切换后调用） */
export function refreshDebugGutter(): void {
  clearDebugGutter();
  const editor = editorRef;
  const monaco = monacoRef;
  if (!editor || !monaco) return;
  const tab = app.activeTab;
  if (!tab) return;
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
  if (!isPy) return;
  const lines = getBreakpointLines(tab.path);
  if (lines.length === 0) return;
  decorations = editor.createDecorationsCollection(
    lines.map((l) => ({
      range: new monaco.Range(l, 1, l, 1),
      options: { glyphMarginClassName: "gutter-breakpoint" },
    })),
  );
}

/** 清空断点装饰（关闭 tab / 非 .py / 切工作区；断点表数据不动） */
export function clearDebugGutter(): void {
  decorations?.clear();
  decorations = null;
}

/** 关闭文件：若该文件无断点则无操作；有断点保留（表跨会话持久），仅清装饰 */
export function onFileClosed(path: string): void {
  void path; // 断点表保留（D3 验收：停止调试后断点表保留，下次自动重放）
}

// ---------- 当前行高亮（§6.5：stopped 事件 → current-line 装饰） ----------

let currentLineDecorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;

/** 标示当前执行行（每次 stopped 先 clear 再设，§6.4/D4） */
export function highlightCurrentLine(path: string, line: number): void {
  clearCurrentLine();
  const editor = editorRef;
  const monaco = monacoRef;
  if (!editor || !monaco) return;
  const tab = app.activeTab;
  if (!tab || tab.path !== path) return; // 只高亮当前打开的文件
  currentLineDecorations = editor.createDecorationsCollection([
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: "debug-current-line",
        linesDecorationsClassName: "debug-current-line-margin",
        overviewRuler: { color: "#F5C518", position: monaco.editor.OverviewRulerLane.Center },
      },
    },
  ]);
}

/** 清除当前行高亮（继续执行 / 会话结束时） */
export function clearCurrentLine(): void {
  currentLineDecorations?.clear();
  currentLineDecorations = null;
}
