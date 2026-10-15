/**
 * inlayHeal 单测：装饰泄漏愈合的期望计数规则（2026-10-14 真机实锤的控制器缺陷 mitigation）。
 * 期望数 = 1（label）+ paddingLeft + paddingRight（控制器 margin 注入条件实证）。
 */
import { describe, expect, it } from "vitest";
import { findSurplusDecorationIds, type DecorationProbe } from "../lsp/inlayHeal";
import type { AnchoredHint } from "../lsp/inlayMerge";

const hint = (line: number, column: number, label: string, pad?: { l?: boolean; r?: boolean }): AnchoredHint => ({
  line,
  column,
  label,
  paddingLeft: pad?.l,
  paddingRight: pad?.r,
});

const deco = (id: string, line: number, column: number): DecorationProbe => ({ id, line, column });

describe("findSurplusDecorationIds", () => {
  it("无 padding 提示：同行超额装饰 = 泄漏（按行总额，删超额条）", () => {
    const out = findSurplusDecorationIds(
      [hint(8, 9, ": Response"), hint(8, 21, "url= ")],
      [deco("a", 8, 9), deco("b", 8, 9), deco("c", 8, 21), deco("d", 8, 21)],
    );
    expect(out).toEqual(["c", "d"]);
  });

  it("回归守卫：类型提示装饰锚列 ≠ 提示位置列（真机实证）不得误删", () => {
    // 类型提示 deco 落标识符起列 5，缓存位置列 9；参数名同列 21——行总额 2=2 不删
    const out = findSurplusDecorationIds(
      [hint(8, 9, ": Response"), hint(8, 21, "url= ")],
      [deco("a", 8, 5), deco("b", 8, 21)],
    );
    expect(out).toEqual([]);
  });

  it("intel 带 paddingLeft：label+margin 两条属正常，不删", () => {
    const out = findSurplusDecorationIds(
      [hint(7, 11, ": str", { l: true })],
      [deco("a", 7, 11), deco("b", 7, 11)],
    );
    expect(out).toEqual([]);
  });

  it("带 padding 位置出现第三条 = 泄漏", () => {
    const out = findSurplusDecorationIds(
      [hint(7, 11, ": str", { l: true })],
      [deco("a", 7, 11), deco("b", 7, 11), deco("c", 7, 11)],
    );
    expect(out).toEqual(["c"]);
  });

  it("不在本轮输出里的位置（陈旧残留）全删", () => {
    const out = findSurplusDecorationIds(
      [hint(8, 9, ": Response")],
      [deco("a", 8, 9), deco("x", 9, 5), deco("y", 9, 5)],
    );
    expect(out.sort()).toEqual(["x", "y"]);
  });

  it("空装饰清单 → 无操作", () => {
    expect(findSurplusDecorationIds([hint(1, 1, ": int")], [])).toEqual([]);
  });
});
