// JSON 字面量注入 · 编辑器侧（库特别支持 P1 §7-3）：
// 高亮装饰与 opencharm-libs 诊断已收敛进规则表 dispatcher（libInject.ts，dslLens 统一渲染），
// 本模块只保留 JSON 特有的两件事：多行三引号字面量的折叠区间 + 右键三项
// （格式化 / 压缩 / JSONPath 提取——后两项是既有 jsonfmt / jsonpath 能力的编辑器入口）。
// 写回一律 executeEdits（§2 纪律 4：禁 setValue 整文替换）。

import { app } from "./state";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { DisposableStore } from "./util";
import { toast } from "./toast";
import { offsetToPosition } from "./libRegex";
import { jsonParseError, pythonLiteralFor, type JsonHit } from "./libJson";
import { scanInjectLiterals } from "./libInject";
import { setPendingJsonPathRequest } from "./libsBridge";

const MAX_SCAN_CHARS = 500_000; // 与 dslLens 同一预算
const JSONPATH_TOOL_ID = "opencharm.builtin.jsonpath";

// ---------- 右键三项 ----------

/** 光标所在 json.loads 字面量；不在任何字面量内 → toast 并返回 null */
function hitAtCursor(): JsonHit | null {
  const editor = app.editor;
  const model = editor.getModel();
  if (!model || model.getLanguageId() !== "python") {
    toast("JSON 工具需要打开一个 Python 文件", "info");
    return null;
  }
  const offset = model.getOffsetAt(editor.getPosition() ?? { lineNumber: 1, column: 1 });
  const hit = scanInjectLiterals(model.getValue()).find(
    (l) => l.rule === "json" && offset > l.start && offset < l.end,
  );
  if (!hit) {
    toast("光标不在 json.loads 字面量内", "info");
    return null;
  }
  return hit.data as JsonHit;
}

/** 重新编码字面量并写回（executeEdits 单一撤销粒度） */
function rewriteLiteral(hit: JsonHit, indent: number): void {
  let value: unknown;
  try {
    value = JSON.parse(hit.value);
  } catch (e) {
    toast(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, "error");
    return;
  }
  const model = app.editor.getModel();
  if (!model) return;
  const text = model.getValue();
  if (text.slice(hit.start, hit.end) !== hit.source) return; // 扫描后源码已变 → 防误写
  const newSource = pythonLiteralFor(value, hit.quote, hit.triple, indent);
  const s = offsetToPosition(text, hit.start);
  const e = offsetToPosition(text, hit.end);
  app.editor.executeEdits("libs-json-rewrite", [
    { range: new app.monaco.Range(s.line + 1, s.col + 1, e.line + 1, e.col + 1), text: newSource },
  ]);
  app.editor.focus();
}

function openInJsonPathPanel(hit: JsonHit): void {
  const err = jsonParseError(hit.value);
  if (err) {
    toast(`JSON 解析失败：${err.message}`, "error");
    return;
  }
  setPendingJsonPathRequest({ json: hit.value });
  void import("./devtools/index").then((m) => m.openDevTools(JSONPATH_TOOL_ID));
}

// ---------- 初始化 ----------

export function initJsonLiteral(editor: MonacoApi.editor.IStandaloneCodeEditor): MonacoApi.IDisposable {
  const store = new DisposableStore();

  // 折叠：多行三引号 JSON 字面量注册折叠区间（单行字面量无行可折）
  store.add(
    app.monaco.languages.registerFoldingRangeProvider("python", {
      provideFoldingRanges(model) {
        if (model.getValue().length > MAX_SCAN_CHARS) return [];
        return scanInjectLiterals(model.getValue())
          .filter((l) => l.rule === "json")
          .map((l) => l.data as JsonHit)
          .filter((h) => h.endLine > h.startLine)
          .map((h) => ({ start: h.startLine + 1, end: h.endLine + 1 }));
      },
    }),
  );

  // 右键三项（导航组，正则入口 1.8 之后；格式化/压缩是就地写回，提取是面板入口）
  store.add(
    editor.addAction({
      id: "opencharm.jsonFormat",
      label: "格式化 JSON 字面量",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.85,
      run: () => {
        const hit = hitAtCursor();
        if (hit) rewriteLiteral(hit, 2);
      },
    }),
  );
  store.add(
    editor.addAction({
      id: "opencharm.jsonMinify",
      label: "压缩 JSON 字面量",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.86,
      run: () => {
        const hit = hitAtCursor();
        if (hit) rewriteLiteral(hit, 0);
      },
    }),
  );
  store.add(
    editor.addAction({
      id: "opencharm.jsonPathExtract",
      label: "在 JSONPath 提取器中打开",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.87,
      run: () => {
        const hit = hitAtCursor();
        if (hit) openInJsonPathPanel(hit);
      },
    }),
  );

  return store;
}
