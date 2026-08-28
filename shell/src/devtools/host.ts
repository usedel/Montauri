// ToolHost 实现：把外壳能力（剪贴板 IPC、编辑器插入、工作区根）适配成工具可见的统一接口。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import type { MonacoModule, ToolHost } from "./types";

export interface DevToolsHostDeps {
  monaco: MonacoModule;
  editor: MonacoApi.editor.IStandaloneCodeEditor;
  workspaceRoot: () => string | null;
}

/** 以指定容器为 root 构造 ToolHost */
export function createToolHost(root: HTMLElement, deps: DevToolsHostDeps): ToolHost {
  return {
    root,
    monaco: deps.monaco,
    workspaceRoot: deps.workspaceRoot,
    copyToClipboard: async (text: string) => {
      try {
        await invoke("copy_to_clipboard", { text });
        return true;
      } catch (e) {
        console.warn("[devtools] 复制失败", e);
        return false;
      }
    },
    insertToEditor: (text: string) => {
      const model = deps.editor.getModel();
      if (!model) return false;
      // 无选区时插到文档末尾
      const sel = deps.editor.getSelection() ?? {
        startLineNumber: model.getLineCount(),
        startColumn: model.getLineMaxColumn(model.getLineCount()),
        endLineNumber: model.getLineCount(),
        endColumn: model.getLineMaxColumn(model.getLineCount()),
      };
      deps.editor.executeEdits("devtools", [{ range: sel, text }]);
      deps.editor.focus();
      return true;
    },
  };
}