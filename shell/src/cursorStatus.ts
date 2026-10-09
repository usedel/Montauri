// 状态栏光标位置芯片（T2 · VSCode/PyCharm「Ln 42, Col 8」同款语义）：
// 常驻显示当前光标位置；有选区时追加「N selected (M chars)」；点击复用 goto_line
//（quickOpen "line" 模式，与 Ctrl+G 同入口）。
//
// 语义对齐 VSCode：位置/选区都以**主光标**（selection 0）为准——多光标不聚合计数
//（VSCode 也只报主光标位置；多选区聚合计数价值低且易误读）。

import { app } from "./state";
import { t } from "./i18n";
import { openQuickOpen } from "./quickOpen";

/** 芯片元素（惰性：单测/精简 DOM 环境无此元素） */
function el(): HTMLElement | null {
  return document.getElementById("status-cursor");
}

/** 位置/选区 → 芯片文本（纯函数，单测锁定语义；VSCode 同款格式）。
 *  selection 为 null/空 = 无选区，只显示位置。 */
export function cursorStatusText(pos: { line: number; column: number }, sel: { lines: number; chars: number } | null): string {
  const base = t("status.cursor.position", { line: pos.line, column: pos.column });
  if (!sel || sel.chars === 0) return base;
  // 多行选区显示行跨度（VSCode 同款「3 selected (120 chars)」/「Ln 1-3」语义）
  return sel.lines > 1
    ? `${base}  ${t("status.cursor.selectedLines", { lines: sel.lines, chars: sel.chars })}`
    : `${base}  ${t("status.cursor.selected", { chars: sel.chars })}`;
}

/** 从编辑器 selection 读出位置与选区统计（主光标口径） */
function readSelection(): { pos: { line: number; column: number }; sel: { lines: number; chars: number } | null } {
  const sel = app.editor.getSelection();
  const pos = app.editor.getPosition();
  if (!sel || !pos) return { pos: { line: 1, column: 1 }, sel: null };
  const chars = sel.isEmpty() ? 0 : app.editor.getModel()?.getValueInRange(sel).length ?? 0;
  const lines = sel.isEmpty() ? 0 : sel.endLineNumber - sel.startLineNumber + 1;
  return { pos: { line: pos.lineNumber, column: pos.column }, sel: chars > 0 ? { lines, chars } : null };
}

/** 刷新芯片显示（非文件 tab——diff/db/md 无文本光标——隐藏；VSCode 同款语义）。
 *  ⚠ Tab.kind 是可选字段：普通文件 tab 不显式设置（undefined），判定必须按
 *  「显式非 file 的三种特例才隐藏」（与 activateTab 的 kind === "diff" 判定同口径）。 */
export function refreshCursorStatus(): void {
  const node = el();
  if (!node) return;
  const tab = app.activeTab;
  const kind = tab?.kind ?? "file";
  if (!tab || kind !== "file" || !tab.model) {
    node.classList.add("hidden");
    return;
  }
  node.classList.remove("hidden");
  const { pos, sel } = readSelection();
  node.textContent = cursorStatusText(pos, sel);
}

/** 接线：光标/选区变化 + 点击跳行。monaco/编辑器就绪后由 main 调用一次。 */
export function wireCursorStatus(): void {
  const node = el();
  if (!node) return;
  app.editor.onDidChangeCursorPosition(() => refreshCursorStatus());
  app.editor.onDidChangeCursorSelection(() => refreshCursorStatus());
  // 点击 = 跳行（与 Ctrl+G goto_line 同入口；quickOpen line 模式自带当前行号回填）
  node.addEventListener("click", () => void openQuickOpen("line"));
  // aria：芯片是可点击按钮
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.setAttribute("aria-label", t("status.cursor.aria"));
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void openQuickOpen("line");
    }
  });
}
