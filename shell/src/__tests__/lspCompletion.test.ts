import { describe, expect, it } from "vitest";
import {
  emptyCompletionList,
  mapAdditionalTextEdits,
  normalizeCompletionList,
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
