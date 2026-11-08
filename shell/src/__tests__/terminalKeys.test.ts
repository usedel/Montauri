// 终端 Ctrl+C 分流谓词单测（实现在 terminalKeys.ts，纯逻辑层）。
import { describe, expect, it } from "vitest";
import { shouldCopyOnCtrlC, type TerminalKeyLike } from "../terminalKeys";

const ev = (over: Partial<TerminalKeyLike> = {}): TerminalKeyLike => ({
  type: "keydown",
  code: "KeyC",
  key: "c",
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
});

describe("shouldCopyOnCtrlC（有选区复制 / 无选区中断）", () => {
  it("有选区 + Ctrl+C keydown → 接管为复制", () => {
    expect(shouldCopyOnCtrlC(ev(), true)).toBe(true);
  });

  it("无选区 → 交回 xterm 发 \\x03（中断 / 优雅停止）", () => {
    expect(shouldCopyOnCtrlC(ev(), false)).toBe(false);
  });

  it("Ctrl+Shift+C → 不拦（xterm 原生复制路径保持）", () => {
    expect(shouldCopyOnCtrlC(ev({ shiftKey: true, key: "C" }), true)).toBe(false);
  });

  it("Ctrl+Alt+C / Ctrl+Meta+C → 不拦", () => {
    expect(shouldCopyOnCtrlC(ev({ altKey: true }), true)).toBe(false);
    expect(shouldCopyOnCtrlC(ev({ metaKey: true }), true)).toBe(false);
  });

  it("macOS Cmd+C（无 ctrl）→ 不拦", () => {
    expect(shouldCopyOnCtrlC(ev({ ctrlKey: false, metaKey: true }), true)).toBe(false);
  });

  it("keyup → 不拦（xterm _keyUp 也要跑 focus 收尾）", () => {
    expect(shouldCopyOnCtrlC(ev({ type: "keyup" }), true)).toBe(false);
  });

  it("非 C 键 → 不拦", () => {
    expect(shouldCopyOnCtrlC(ev({ code: "KeyV", key: "v" }), true)).toBe(false);
  });

  it("IME 下 key=Process 但物理 code=KeyC → 仍接管", () => {
    expect(shouldCopyOnCtrlC(ev({ key: "Process" }), true)).toBe(true);
  });

  it("无 code 的合成事件用 key 兜底（c / C 都认）", () => {
    expect(shouldCopyOnCtrlC(ev({ code: undefined, key: "c" }), true)).toBe(true);
    expect(shouldCopyOnCtrlC(ev({ code: undefined, key: "C" }), true)).toBe(true);
    expect(shouldCopyOnCtrlC(ev({ code: undefined, key: "x" }), true)).toBe(false);
  });
});
