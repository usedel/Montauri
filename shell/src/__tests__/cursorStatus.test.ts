// T2（微交互批）：状态栏光标位置芯片纯函数单测。
// 语义对齐 VSCode：无选区只显示位置；单行选区显示字符数；多行选区显示行跨度 + 字符数。
import { describe, expect, it } from "vitest";
import { cursorStatusText } from "../cursorStatus";

describe("cursorStatusText（位置/选区 → 芯片文本）", () => {
  it("无选区：只显示行/列", () => {
    expect(cursorStatusText({ line: 42, column: 8 }, null)).toContain("42");
    expect(cursorStatusText({ line: 42, column: 8 }, null)).toContain("8");
  });

  it("空选区（chars=0）：等同无选区", () => {
    const withEmpty = cursorStatusText({ line: 3, column: 1 }, { lines: 0, chars: 0 });
    const without = cursorStatusText({ line: 3, column: 1 }, null);
    expect(withEmpty).toBe(without);
  });

  it("单行选区：显示字符计数，不含行跨度", () => {
    const s = cursorStatusText({ line: 10, column: 5 }, { lines: 1, chars: 17 });
    expect(s).toContain("10");
    expect(s).toContain("17");
    // 单行不出现「行」跨度形态（selectedLines 词条 vs selected 词条的区分）
    expect(s).not.toMatch(/\d+ 行（/);
  });

  it("多行选区：显示行跨度 + 字符数", () => {
    const s = cursorStatusText({ line: 5, column: 2 }, { lines: 3, chars: 120 });
    expect(s).toContain("5");
    expect(s).toContain("3");
    expect(s).toContain("120");
  });

  it("位置与选区计数在文本中同时可见（不互相覆盖）", () => {
    const s = cursorStatusText({ line: 1, column: 1 }, { lines: 2, chars: 45 });
    expect(s).toContain("1");
    expect(s).toContain("45");
  });
});
