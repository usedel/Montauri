import { describe, expect, it } from "vitest";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { classifyPosition } from "../scope";

type Model = MonacoApi.editor.ITextModel;
type Pos = MonacoApi.Position;

/** 最小 mock：classifyPosition 仅依赖 getLineContent */
function model(lines: string[]): Model {
  return { getLineContent: (n: number) => lines[n - 1] ?? "" } as unknown as Model;
}
function pos(lineNumber: number, column: number): Pos {
  return { lineNumber, column } as Pos;
}

describe("classifyPosition（位置轴判定）", () => {
  it("def/class/async def 头名字 token 内 → name", () => {
    const def = "def main";
    expect(classifyPosition(model([def]), pos(1, def.length + 1))).toBe("name");
    const cls = "class User";
    expect(classifyPosition(model([cls]), pos(1, cls.length + 1))).toBe("name");
    const adef = "async def fetch";
    expect(classifyPosition(model([adef]), pos(1, adef.length + 1))).toBe("name");
  });

  it("名字后已跟 '('（进入参数）→ 不再视为 name", () => {
    const def = "def main(";
    expect(classifyPosition(model([def]), pos(1, def.length + 1))).toBe("expression");
  });

  it("行首且上一行完整 → statement", () => {
    expect(classifyPosition(model(["x = 1", "main"]), pos(2, 1))).toBe("statement");
  });

  it("左侧有非空白 token → expression", () => {
    expect(classifyPosition(model(["x = main"]), pos(1, "x = ".length + 1))).toBe("expression");
    expect(classifyPosition(model(["return super"]), pos(1, "return ".length + 1))).toBe("expression");
  });

  it("上一非空行以 '(' 悬挂（多行签名）→ expression", () => {
    expect(classifyPosition(model(["def foo(", "    a"]), pos(2, 5))).toBe("expression");
  });

  it("上一非空行以行连接符结尾 → expression", () => {
    expect(classifyPosition(model(["x = \\", "    main"]), pos(2, 5))).toBe("expression");
  });

  it("空行（含缩进）敲缩写 → statement（结构模板可用）", () => {
    expect(classifyPosition(model(["", "if"]), pos(2, 3))).toBe("statement");
    expect(classifyPosition(model(["x = 1", "    def"]), pos(2, 8))).toBe("statement");
    expect(classifyPosition(model(["x = 1", "    class"]), pos(2, 11))).toBe("statement");
    expect(classifyPosition(model(["x = 1", "main"]), pos(2, 5))).toBe("statement");
  });
});