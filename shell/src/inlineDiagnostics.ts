// 行内诊断文案（VS Code 插件调研报告 借鉴-1 · 对标 Error Lens）：把「哪一行、错什么」
// 就地压到代码行尾，省去「去 Problems 面板逐条点开」的往返。
//
// **噪音纪律（报告 §4 借鉴-1 四条硬约束；改本文件前先读，越界即等于把功能做成噪音墙）**：
//   1. 只显示 error / warning——info / hint 一律不显示（Error Lens 官方亦如此建议）；
//   2. 只显示**光标行 ± CONTEXT_LINES 行**——全量行尾文案 + 严格模式 = 视觉污染，与
//      ui_premium §7「往代码区加装饰有害」同一判断；真机评估仍吵则下调 CONTEXT_LINES（0 = 仅光标行）；
//   3. 文案单行截断，不换行、不撑行高（避免破坏 ui-baseline 截图基线）；
//   4. 设置项且**默认关**（沿用 A2 性能模式同款默认关纪律）。
//
// 渲染机制与行内变量值（inlineValues.ts）同一套：Monaco 注入文本装饰
// （`IModelDecorationOptions.after`），零上游依赖、视觉语言统一。
// 调试暂停时整体让位（行尾已被变量值占用，两处注入文本同行会叠字）。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, DEFAULT_SETTINGS, type MonacoModule } from "./state";
import { inlineValuesActive } from "./inlineValues";

/** 显示窗口：光标行 ± 本值行（噪音纪律 2；0 = 只显示光标所在行） */
export const CONTEXT_LINES = 2;
/** 单条文案的显示上限（超出截断；含省略号不超过 MAX_MESSAGE_LEN 个字符） */
export const MAX_MESSAGE_LEN = 80;
/** Monaco MarkerSeverity 的数值契约（editor.api：Hint=1 Info=2 Warning=4 Error=8） */
export const SEV_ERROR = 8;
export const SEV_WARNING = 4;
/** 注入文本前缀：两个空格。刻意不加图标——级别已由颜色表达，图标只会加重噪音 */
const CONTENT_PREFIX = "  ";

/** 单行归并后的诊断（一行至多一条上屏，其余折叠为计数） */
export interface LineDiagnostic {
  line: number;
  severity: number;
  /** 已归一为单行 + 截断的文案（不含 extra 后缀） */
  message: string;
  /** 同行被折叠的其余诊断条数（0 = 无） */
  extra: number;
}

/** 消息归一：多行/连续空白压成单空格（不撑行高）+ 超长截断 */
export function normalizeMessage(msg: string): string {
  const oneLine = msg.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_MESSAGE_LEN ? `${oneLine.slice(0, MAX_MESSAGE_LEN - 1)}…` : oneLine;
}

/**
 * 取「光标行 ± CONTEXT_LINES」窗口内每行的主诊断。
 * 主诊断选取：级别高者优先（error > warning）→ 同级取列号最小者（最靠左、离行首最近）。
 * 同行其余条数折进 `extra`（文案后缀 ` +N`）。
 */
export function pickLineDiagnostics(
  markers: Array<Pick<MonacoApi.editor.IMarker, "startLineNumber" | "startColumn" | "severity" | "message">>,
  cursorLine: number,
  lineCount: number,
): LineDiagnostic[] {
  const from = Math.max(1, cursorLine - CONTEXT_LINES);
  const to = Math.min(lineCount, cursorLine + CONTEXT_LINES);
  const acc = new Map<number, { severity: number; column: number; message: string; count: number }>();
  for (const m of markers) {
    if (m.severity !== SEV_ERROR && m.severity !== SEV_WARNING) continue; // 噪音纪律 1
    if (m.startLineNumber < from || m.startLineNumber > to) continue; // 噪音纪律 2
    const cur = acc.get(m.startLineNumber);
    if (!cur) {
      acc.set(m.startLineNumber, { severity: m.severity, column: m.startColumn, message: m.message, count: 1 });
      continue;
    }
    cur.count += 1;
    if (m.severity > cur.severity || (m.severity === cur.severity && m.startColumn < cur.column)) {
      cur.severity = m.severity;
      cur.column = m.startColumn;
      cur.message = m.message;
    }
  }
  const out: LineDiagnostic[] = [];
  for (const [line, v] of acc) {
    out.push({ line, severity: v.severity, message: normalizeMessage(v.message), extra: v.count - 1 });
  }
  out.sort((a, b) => a.line - b.line);
  return out;
}

/** 注入文本（前缀 + 文案 + 折叠计数） */
export function diagnosticContent(d: LineDiagnostic): string {
  return `${CONTENT_PREFIX}${d.message}${d.extra > 0 ? ` +${d.extra}` : ""}`;
}

/** 注入文本的 class（级别靠颜色表达，e2e 亦以此断言） */
export function diagnosticClass(severity: number): string {
  return severity === SEV_ERROR
    ? "oc-inline-diag oc-inline-diag--error"
    : "oc-inline-diag oc-inline-diag--warning";
}

// ---------- 接线（编辑器实例 + 装饰集合） ----------

let editorRef: MonacoApi.editor.IStandaloneCodeEditor | null = null;
let monacoRef: MonacoModule | null = null;
let collection: MonacoApi.editor.IEditorDecorationsCollection | null = null;
/** marker 世代号：诊断刷新（onDidChangeMarkers）自增，用于下面的重算短路 */
let markerGen = 0;
/** 上次渲染的指纹（model + 光标行 + marker 世代）：光标在同一行内左右移动不重算 */
let lastKey = "";

export function initInlineDiagnostics(
  editor: MonacoApi.editor.IStandaloneCodeEditor,
  monaco: MonacoModule,
): void {
  editorRef = editor;
  monacoRef = monaco;
}

/** 诊断到达/清理时调用（世代号自增 → 下次 refresh 必重算） */
export function noteMarkersChanged(): void {
  markerGen += 1;
}

/** 重算并渲染（开关关 / 无 model / 调试暂停 → 清空） */
export function refreshInlineDiagnostics(): void {
  const editor = editorRef;
  const monaco = monacoRef;
  if (!editor || !monaco) return;
  const enabled = app.settings.inline_diagnostics ?? DEFAULT_SETTINGS.inline_diagnostics;
  if (!enabled) {
    clearInlineDiagnostics();
    return;
  }
  const model = editor.getModel();
  const pos = editor.getPosition();
  if (!model || !pos) {
    clearInlineDiagnostics();
    return;
  }
  // 调试暂停：行尾已被行内变量值占用，整体让位（避免两处注入文本同行叠字）
  if (inlineValuesActive()) {
    clearInlineDiagnostics();
    return;
  }
  const key = `${model.id}|${pos.lineNumber}|${markerGen}`;
  if (key === lastKey) return;
  clearInlineDiagnostics();
  lastKey = key;

  const markers = monaco.editor.getModelMarkers({ resource: model.uri });
  const picks = pickLineDiagnostics(markers, pos.lineNumber, model.getLineCount());
  if (picks.length === 0) return;
  const decos: MonacoApi.editor.IModelDeltaDecoration[] = picks.map((p) => {
    const col = model.getLineMaxColumn(p.line);
    return {
      // 空区间（行尾锚点）+ `showIfCollapsed: true`：**两者必须同时成立**，
      // 否则 Monaco 在 getInjectedTextInInterval 里按 `showIfCollapsed || !range.isEmpty()`
      // 直接把这条注入文本过滤掉——症状是装饰进了 model（getAllDecorations 查得到）
      // 但永远不上屏，且没有任何报错（textModel.js 的过滤静默发生）。
      range: new monaco.Range(p.line, col, p.line, col),
      options: {
        showIfCollapsed: true,
        after: { content: diagnosticContent(p), inlineClassName: diagnosticClass(p.severity) },
      },
    };
  });
  collection = editor.createDecorationsCollection(decos);
}

export function clearInlineDiagnostics(): void {
  collection?.clear();
  collection = null;
  lastKey = "";
}
