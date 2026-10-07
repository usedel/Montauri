// TD-021①：终端背压 UTF-8 字节口径单测（纯逻辑，实现在 terminalBackpressure.ts）。
import { describe, expect, it } from "vitest";
import { OutputBackpressure } from "../terminalBackpressure";

describe("OutputBackpressure（TD-021① 背压 UTF-8 口径）", () => {
  it("CJK 按 UTF-8 字节计数（修复点：不是 UTF-16 码元数）", () => {
    const bp = new OutputBackpressure(1024, 512);
    bp.push("中");
    expect(bp.pendingBytes).toBe(3);
    bp.push("文中a"); // 3 + 3 + 1
    expect(bp.pendingBytes).toBe(10);
  });

  it("take 尊重字节预算，分片拼回与原文逐字节一致", () => {
    const bp = new OutputBackpressure(1 << 20, 1 << 19);
    const text = "中".repeat(1000); // 3000 bytes
    bp.push(text);
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const out = bp.take(256);
      if (!out) break;
      parts.push(out);
      total += out.length;
    }
    expect(total).toBe(3000);
    expect(bp.isEmpty).toBe(true);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.length;
    }
    expect(new TextDecoder().decode(merged)).toBe(text);
  });

  it("超硬上限丢最旧，计数走 UTF-8 字节", () => {
    const bp = new OutputBackpressure(10, 1 << 20);
    bp.push("a".repeat(8));
    bp.push("中中中"); // 9 字节 → 共 17 > 10，丢头块 8
    expect(bp.pendingBytes).toBe(9);
    const out = bp.take(64)!;
    expect(new TextDecoder().decode(out)).toBe("中中中");
    expect(bp.consumePeakEnd()).toBeNull(); // 本洪峰未提示过限流
  });

  it("跨限流阈值只插一次提示，收尾 consumePeakEnd 返回丢弃字节数并复位", () => {
    const bp = new OutputBackpressure(1 << 20, 100);
    bp.push("b".repeat(90), "[notice]");
    expect(bp.consumePeakEnd()).toBeNull(); // 未达阈值且队列非空
    bp.push("b".repeat(20), "[notice]");
    bp.push("b".repeat(20), "[notice]");
    bp.push("b".repeat(20), "[notice]");
    let noticeCount = 0;
    let bytes = 0;
    for (;;) {
      const out = bp.take(1 << 20);
      if (!out) break;
      bytes += out.length;
      if (new TextDecoder().decode(out).includes("[notice]")) noticeCount++;
    }
    expect(noticeCount).toBe(1);
    expect(bytes).toBe(150 + "[notice]".length);
    expect(bp.consumePeakEnd()).toBe(0); // 队列已空 + 已提示 → 收尾（本洪峰无硬上限丢弃）
    expect(bp.consumePeakEnd()).toBeNull(); // 复位后不重复
  });

  it("clear 清空全部状态 / 空串不入队 / take(0·负数) 返回 null", () => {
    const bp = new OutputBackpressure(10, 1 << 20);
    bp.push("");
    expect(bp.isEmpty).toBe(true);
    bp.push("abc");
    expect(bp.take(0)).toBeNull();
    expect(bp.take(-1)).toBeNull();
    bp.clear();
    expect(bp.pendingBytes).toBe(0);
    expect(bp.isEmpty).toBe(true);
  });

  it("字节边界切分后合并解码语义不变（xterm 增量解码的前提）", () => {
    const bp = new OutputBackpressure(1 << 20, 1 << 19);
    bp.push("中文abc"); // 3 + 3 + 3 = 9 bytes
    const a = bp.take(4)!; // 前 4 字节 = "中" + "文" 首字节
    const b = bp.take(1024)!;
    expect(a.length + b.length).toBe(9);
    const merged = new Uint8Array(9);
    merged.set(a, 0);
    merged.set(b, a.length);
    expect(new TextDecoder().decode(merged)).toBe("中文abc");
  });
});
