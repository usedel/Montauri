// 单元格解析单测（VS Code 调研 借鉴-2）：纯函数层（零 app 依赖，node 环境直测）。
// 键位三处同步（keybindingDefaults / settings.rs / handler）由各自测试与 e2e 覆盖。
import { describe, expect, it } from "vitest";
import { cellBounds, cellCode, isCellSeparator } from "../scratchCore";

const SRC = ["x = 1", "# %% cell2", "y = 2", "z = 3", "# %% cell3", "w = 4", ""];
// 行号（1 起）：1=x  2=分隔  3=y  4=z  5=分隔  6=w  7=空

describe("isCellSeparator", () => {
  it("识别 # %% / #%% / 带 [markdown] 的分隔行", () => {
    expect(isCellSeparator("# %%")).toBe(true);
    expect(isCellSeparator("#%%")).toBe(true);
    expect(isCellSeparator("  # %% [markdown]")).toBe(true);
    expect(isCellSeparator("# %% code")).toBe(true);
  });

  it("普通注释 / 行内 %% 不算分隔行", () => {
    expect(isCellSeparator("# hello")).toBe(false);
    expect(isCellSeparator("x = 1  # %%")).toBe(false);
    expect(isCellSeparator("")).toBe(false);
  });
});

describe("cellBounds", () => {
  it("光标在单元格中间 → 该单元格的界", () => {
    expect(cellBounds(SRC, 3)).toEqual({ startLine: 2, endLine: 4 });
    expect(cellBounds(SRC, 4)).toEqual({ startLine: 2, endLine: 4 });
  });

  it("光标在分隔行上 → 该分隔行开启的单元格", () => {
    expect(cellBounds(SRC, 5)).toEqual({ startLine: 5, endLine: 7 });
  });

  it("无分隔符 → 整个文件是一个单元格", () => {
    expect(cellBounds(["a = 1", "b = 2"], 2)).toEqual({ startLine: 1, endLine: 2 });
  });

  it("文件首的代码归第一个单元格（无前置分隔符）", () => {
    expect(cellBounds(SRC, 1)).toEqual({ startLine: 1, endLine: 1 });
  });

  it("最后一个单元格延伸到文件尾（含尾部空行）", () => {
    expect(cellBounds(SRC, 6).endLine).toBe(7);
  });
});

describe("cellCode", () => {
  it("剥掉分隔行，保留代码行（Jupyter 同语义）", () => {
    expect(cellCode(SRC, cellBounds(SRC, 3))).toBe("y = 2\nz = 3");
  });

  it("无分隔符 → 全文（含所有行）", () => {
    expect(cellCode(["a = 1", "b = 2"], cellBounds(["a = 1", "b = 2"], 1))).toBe("a = 1\nb = 2");
  });

  it("空单元格（相邻两个分隔符）→ 空串（调用方据此提示，不发起执行）", () => {
    const lines = ["# %%", "x = 1", "# %%", "# %%"];
    expect(cellCode(lines, cellBounds(lines, 4))).toBe("");
  });
});
