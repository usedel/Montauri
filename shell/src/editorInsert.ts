// 把文本插入编辑器：有选区则替换选区，否则插到文档末尾（B5「插入编辑器」用）。
//
// 为什么单独成模块：`devtools/host.ts` 的 `host.insertToEditor` 是**插件通道内**的同名能力，
// 依赖 ToolHost 持有的 monaco 引用；底部面板等外壳功能用不到那条通道，而这段逻辑又不该堆在
// `main.ts`（规范：main 只做接线）。失败一律返回 false——编辑器未就绪时 `app.editor` 会抛错，
// 不能让它冒泡进点击处理。

import { app } from "./state";

/** @returns 是否插入成功（无打开文件 / 编辑器未初始化 → false） */
export function insertTextIntoEditor(text: string): boolean {
  try {
    const ed = app.editor;
    const model = ed.getModel();
    if (!model) return false;
    const lastLine = model.getLineCount();
    // 无选区时插到文档末尾（与 devtools host 同口径）
    const range = ed.getSelection() ?? {
      startLineNumber: lastLine,
      startColumn: model.getLineMaxColumn(lastLine),
      endLineNumber: lastLine,
      endColumn: model.getLineMaxColumn(lastLine),
    };
    ed.executeEdits("insert-text", [{ range, text }]);
    ed.focus();
    return true;
  } catch {
    return false;
  }
}
