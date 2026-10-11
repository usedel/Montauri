// 行内诊断文案（VS Code 调研 借鉴-1）单测：纯逻辑（归一 / 窗口 / 归并 / 文案）+ 接线渲染。
// state 与 inlineValues 用 vi.mock 替身：本模块只从它们读设置与「调试是否暂停」，
// 换成替身后即可在 node 环境直测（不必拉起 Monaco 与 DOM）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inlineValues: false }));

vi.mock("../state", () => ({
  app: { settings: { inline_diagnostics: false } },
  DEFAULT_SETTINGS: { inline_diagnostics: false },
}));
vi.mock("../inlineValues", () => ({
  inlineValuesActive: () => mocks.inlineValues,
}));

import { app } from "../state";
import {
  CONTEXT_LINES,
  MAX_MESSAGE_LEN,
  SEV_ERROR,
  SEV_WARNING,
  clearInlineDiagnostics,
  diagnosticClass,
  diagnosticContent,
  initInlineDiagnostics,
  normalizeMessage,
  noteMarkersChanged,
  pickLineDiagnostics,
  refreshInlineDiagnostics,
} from "../inlineDiagnostics";

const INFO = 2;
const HINT = 1;

function mk(line: number, col: number, severity: number, message: string) {
  return { startLineNumber: line, startColumn: col, severity, message };
}

/** 装配 editor / monaco / model 替身，返回本轮渲染出来的装饰 */
function setup(opts: {
  lineCount: number;
  cursorLine: number;
  markers: Array<{ startLineNumber: number; startColumn: number; severity: number; message: string }>;
}) {
  const rendered: Array<{
    range: unknown;
    options: { showIfCollapsed?: boolean; after: { content: string; inlineClassName: string } };
  }> = [];
  let cleared = 0;
  const model = {
    id: "m1",
    uri: { toString: () => "file:///a.py" },
    getLineCount: () => opts.lineCount,
    getLineMaxColumn: (line: number) => line + 10, // 具体值不参与断言，只要稳定
  };
  const editor = {
    getModel: () => model,
    getPosition: () => ({ lineNumber: opts.cursorLine, column: 1 }),
    createDecorationsCollection: (decos: typeof rendered) => {
      rendered.push(...decos);
      return { clear: () => void cleared++ };
    },
  };
  const monaco = {
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
    editor: { getModelMarkers: () => opts.markers },
  };
  initInlineDiagnostics(editor as never, monaco as never);
  return { rendered, clearedCount: () => cleared };
}

beforeEach(() => {
  clearInlineDiagnostics();
  mocks.inlineValues = false;
  (app.settings as { inline_diagnostics: boolean }).inline_diagnostics = false;
});

describe("消息归一（噪音纪律 3：不换行、不撑行高）", () => {
  it("多行与连续空白压成单空格", () => {
    expect(normalizeMessage("Expected  'int'\n  got\n\n'str'")).toBe("Expected 'int' got 'str'");
  });

  it("超长截断并加省略号（含省略号不超过上限）", () => {
    const cut = normalizeMessage("x".repeat(500));
    expect(cut.length).toBeLessThanOrEqual(MAX_MESSAGE_LEN);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("空消息安全", () => {
    expect(normalizeMessage("")).toBe("");
    expect(normalizeMessage("   \n  ")).toBe("");
  });
});

describe("窗口与归并（噪音纪律 1/2）", () => {
  it("只取光标行 ± CONTEXT_LINES，窗口外的丢弃", () => {
    const picks = pickLineDiagnostics(
      [mk(1, 1, SEV_ERROR, "far above"), mk(10, 1, SEV_ERROR, "far below"), mk(11, 1, SEV_ERROR, "here")],
      11,
      30,
    );
    expect(picks.map((p) => p.line)).toEqual([10, 11]);
    expect(picks.find((p) => p.line === 11)!.message).toBe("here");
  });

  it("info / hint 一律不上屏", () => {
    const picks = pickLineDiagnostics([mk(5, 1, INFO, "note"), mk(5, 2, HINT, "hint")], 5, 30);
    expect(picks).toEqual([]);
  });

  it("级别高者优先（error 压过 warning）", () => {
    const picks = pickLineDiagnostics([mk(5, 9, SEV_WARNING, "warn"), mk(5, 2, SEV_ERROR, "err")], 5, 30);
    expect(picks).toHaveLength(1);
    expect(picks[0].severity).toBe(SEV_ERROR);
    expect(picks[0].message).toBe("err");
  });

  it("同级取列号最小者（最靠左）", () => {
    const picks = pickLineDiagnostics([mk(5, 20, SEV_ERROR, "right"), mk(5, 3, SEV_ERROR, "left")], 5, 30);
    expect(picks[0].message).toBe("left");
  });

  it("同行其余条数折进 extra", () => {
    const picks = pickLineDiagnostics(
      [mk(5, 1, SEV_ERROR, "a"), mk(5, 2, SEV_ERROR, "b"), mk(5, 3, SEV_WARNING, "c")],
      5,
      30,
    );
    expect(picks[0].extra).toBe(2);
  });

  it("窗口被文件首尾截断（不越界）", () => {
    const picks = pickLineDiagnostics([mk(1, 1, SEV_ERROR, "first"), mk(3, 1, SEV_ERROR, "third")], 1, 3);
    expect(picks.map((p) => p.line)).toEqual([1, 3]);
    expect(pickLineDiagnostics([mk(1, 1, SEV_ERROR, "x")], 99, 3)).toEqual([]);
  });

  it("按行号升序返回（渲染顺序稳定）", () => {
    const picks = pickLineDiagnostics(
      [mk(7, 1, SEV_ERROR, "c"), mk(5, 1, SEV_ERROR, "a"), mk(6, 1, SEV_ERROR, "b")],
      6,
      30,
    );
    expect(picks.map((p) => p.line)).toEqual([5, 6, 7]);
  });
});

describe("注入文本与 class", () => {
  it("前缀两空格；无折叠时不带后缀", () => {
    expect(diagnosticContent({ line: 1, severity: SEV_ERROR, message: "boom", extra: 0 })).toBe("  boom");
  });

  it("有折叠时带 +N 后缀", () => {
    expect(diagnosticContent({ line: 1, severity: SEV_ERROR, message: "boom", extra: 3 })).toBe("  boom +3");
  });

  it("级别映射 class（e2e 以此断言）", () => {
    expect(diagnosticClass(SEV_ERROR)).toContain("oc-inline-diag--error");
    expect(diagnosticClass(SEV_WARNING)).toContain("oc-inline-diag--warning");
  });
});

describe("刷新接线", () => {
  it("默认关：不上屏（噪音纪律 4）", () => {
    const { rendered } = setup({ lineCount: 30, cursorLine: 5, markers: [mk(5, 1, SEV_ERROR, "boom")] });
    refreshInlineDiagnostics();
    expect(rendered).toHaveLength(0);
  });

  it("开启后只渲染窗口内的行，且带级别 class", () => {
    (app.settings as { inline_diagnostics: boolean }).inline_diagnostics = true;
    const { rendered } = setup({
      lineCount: 30,
      cursorLine: 5,
      markers: [mk(5, 1, SEV_ERROR, "boom"), mk(6, 1, SEV_WARNING, "warn"), mk(20, 1, SEV_ERROR, "far")],
    });
    refreshInlineDiagnostics();
    expect(rendered).toHaveLength(2);
    // 回归钉子：空区间 + showIfCollapsed 缺一不可（缺后者 → Monaco 静默过滤，装饰永不渲染）
    expect(rendered[0].options.showIfCollapsed).toBe(true);
    expect(rendered[0].options.after.content).toBe("  boom");
    expect(rendered[0].options.after.inlineClassName).toContain("oc-inline-diag--error");
    expect(rendered[1].options.after.inlineClassName).toContain("oc-inline-diag--warning");
  });

  it("关闭开关立即清空", () => {
    const s = app.settings as { inline_diagnostics: boolean };
    s.inline_diagnostics = true;
    const { rendered, clearedCount } = setup({ lineCount: 30, cursorLine: 5, markers: [mk(5, 1, SEV_ERROR, "boom")] });
    refreshInlineDiagnostics();
    expect(rendered).toHaveLength(1);
    s.inline_diagnostics = false;
    refreshInlineDiagnostics();
    expect(clearedCount()).toBe(1);
  });

  it("调试暂停（行内变量值上屏）时整体让位", () => {
    (app.settings as { inline_diagnostics: boolean }).inline_diagnostics = true;
    mocks.inlineValues = true;
    const { rendered } = setup({ lineCount: 30, cursorLine: 5, markers: [mk(5, 1, SEV_ERROR, "boom")] });
    refreshInlineDiagnostics();
    expect(rendered).toHaveLength(0);
  });

  it("指纹短路：光标在同一行内移动不重算；marker 变化后必重算", () => {
    (app.settings as { inline_diagnostics: boolean }).inline_diagnostics = true;
    const { rendered } = setup({ lineCount: 30, cursorLine: 5, markers: [mk(5, 1, SEV_ERROR, "boom")] });
    refreshInlineDiagnostics();
    refreshInlineDiagnostics(); // 同一行、同一 marker 世代 → 短路
    expect(rendered).toHaveLength(1);

    noteMarkersChanged(); // 诊断到达/清理
    refreshInlineDiagnostics();
    expect(rendered).toHaveLength(2); // 重算一次（并重新渲染）
  });

  it("窗口内无诊断时不建装饰，也不抛错", () => {
    (app.settings as { inline_diagnostics: boolean }).inline_diagnostics = true;
    const { rendered } = setup({ lineCount: 30, cursorLine: 5, markers: [] });
    refreshInlineDiagnostics();
    expect(rendered).toHaveLength(0);
  });
});

describe("窗口常量自证", () => {
  it("CONTEXT_LINES = 2（光标行 ± 2 行 = 5 行上下文窗口）", () => {
    expect(CONTEXT_LINES).toBe(2);
  });
});
