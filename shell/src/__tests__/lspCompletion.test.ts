import { describe, expect, it } from "vitest";
import {
  emptyCompletionList,
  mapAdditionalTextEdits,
  mapLspTextEdit,
  normalizeCompletionList,
  type LspCompletionItem,
} from "../completion/lspCompletion";

describe("normalizeCompletionList（P0-A2）", () => {
  it("A2-1：裸数组 → items 透传，isIncomplete=false（LSP 裸数组无法携带该字段）", () => {
    const r = normalizeCompletionList([{ label: "a" }, { label: "b" }]);
    expect(r.items).toHaveLength(2);
    expect(r.isIncomplete).toBe(false);
  });

  it("A2-2：CompletionList 带 isIncomplete: true → 透传 true", () => {
    const r = normalizeCompletionList({ items: [{ label: "a" }], isIncomplete: true });
    expect(r.items).toHaveLength(1);
    expect(r.isIncomplete).toBe(true);
  });

  it("A2-3：缺省 / null / undefined / 空对象 / items 非数组 → isIncomplete=false 且不抛", () => {
    expect(normalizeCompletionList({ items: [{ label: "a" }] })).toEqual({
      items: [{ label: "a" }],
      isIncomplete: false,
    });
    expect(normalizeCompletionList(null)).toEqual({ items: [], isIncomplete: false });
    expect(normalizeCompletionList(undefined)).toEqual({ items: [], isIncomplete: false });
    expect(normalizeCompletionList({})).toEqual({ items: [], isIncomplete: false });
    expect(normalizeCompletionList({ items: "nope" })).toEqual({ items: [], isIncomplete: false });
    expect(normalizeCompletionList({ items: null })).toEqual({ items: [], isIncomplete: false });
    // 非 true 的假值一律当 false（引擎可能下发 undefined / 0 / 字符串）
    expect(normalizeCompletionList({ items: [], isIncomplete: "yes" }).isIncomplete).toBe(false);
  });

  it("A2-4：引擎未就绪兜底为空列表且不声明截断（语义是「暂无数据」不是「被截断」）", () => {
    expect(emptyCompletionList()).toEqual({ items: [], isIncomplete: false });
  });
});

describe("mapAdditionalTextEdits（P0-D）", () => {
  it("单行编辑：LSP 0-based → Monaco 1-based 坐标转换", () => {
    const r = mapAdditionalTextEdits([
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import json\n" },
    ]);
    expect(r).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
        text: "import json\n",
      },
    ]);
  });

  it("跨行编辑：起止行均转换", () => {
    const r = mapAdditionalTextEdits([
      { range: { start: { line: 2, character: 4 }, end: { line: 5, character: 9 } }, newText: "" },
    ]);
    expect(r[0].range).toEqual({
      startLineNumber: 3,
      startColumn: 5,
      endLineNumber: 6,
      endColumn: 10,
    });
  });

  it("第 1 行插入（insertLine 与光标行相邻，off-by-one 高发区）", () => {
    const r = mapAdditionalTextEdits([
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: "x" },
    ]);
    expect(r[0].range).toEqual({
      startLineNumber: 1,
      startColumn: 2,
      endLineNumber: 1,
      endColumn: 2,
    });
  });

  it("undefined / 空数组 → 空结果，不抛", () => {
    expect(mapAdditionalTextEdits(undefined)).toEqual([]);
    expect(mapAdditionalTextEdits([])).toEqual([]);
  });
});

describe("mapLspTextEdit（P1-A：Enter=插入 / Tab=替换）", () => {
  it("TextEdit（单 range）→ 直接映射，insertText 用 newText", () => {
    const item: LspCompletionItem = {
      label: "x",
      textEdit: { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }, newText: "enumerate" },
    };
    expect(mapLspTextEdit(item)).toEqual({
      range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 },
      insertText: "enumerate",
    });
  });

  it("InsertReplaceEdit（双 range）→ Monaco 原生双 range 形态（两键区分的根基）", () => {
    const item: LspCompletionItem = {
      label: "x",
      textEdit: {
        insert: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } },
        replace: { start: { line: 0, character: 2 }, end: { line: 0, character: 12 } },
        newText: "enumerate",
      },
    };
    const r = mapLspTextEdit(item);
    expect(r).toEqual({
      range: {
        insert: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 6 },
        replace: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 13 },
      },
      insertText: "enumerate",
    });
  });

  it("跨行双 range：起止行均转换", () => {
    const item: LspCompletionItem = {
      label: "x",
      textEdit: {
        insert: { start: { line: 0, character: 0 }, end: { line: 2, character: 4 } },
        replace: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
        newText: "y",
      },
    };
    const r = mapLspTextEdit(item)!;
    expect((r.range as { insert: { endLineNumber: number } }).insert.endLineNumber).toBe(3);
    expect((r.range as { replace: { endLineNumber: number } }).replace.endLineNumber).toBe(4);
  });

  it("无 textEdit / newText 缺失 → null（调用方回落 word range）", () => {
    expect(mapLspTextEdit({ label: "a" })).toBeNull();
    expect(mapLspTextEdit({ label: "a", insertText: "a" })).toBeNull();
    expect(mapLspTextEdit({ label: "a", textEdit: {} as LspCompletionItem["textEdit"] })).toBeNull();
  });
});
