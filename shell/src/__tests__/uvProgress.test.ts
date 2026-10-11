// uv 流式输出 → 可判读进度（体验审查 L-1）：纯解析，无 DOM 依赖。
import { describe, expect, it } from "vitest";
import { parseUvProgress } from "../uvProgress";

describe("parseUvProgress（L-1）", () => {
  it("大小型进度行 → 比例 + 百分数（1024 进制 MiB）", () => {
    const p = parseUvProgress("Downloading cpython-3.12.7  45.2 MiB / 100.5 MiB");
    expect(p).not.toBeNull();
    expect(p!.ratio).toBeCloseTo(45.2 / 100.5, 5);
    expect(p!.text).toContain("45.2 MiB / 100.5 MiB");
    expect(p!.text).toContain("45%");
  });

  it("1000 进制单位（MB）也按字面区分", () => {
    const p = parseUvProgress("1.5 MB / 3 MB");
    expect(p!.ratio).toBeCloseTo(0.5, 5);
  });

  it("计数型进度行 → 比例（Installed 5/9）", () => {
    const p = parseUvProgress("Installed 5/9 packages in 300ms");
    expect(p!.ratio).toBeCloseTo(5 / 9, 5);
    expect(p!.text).toContain("56%");
  });

  it("百分数行 → 比例", () => {
    const p = parseUvProgress("  46%  downloading");
    expect(p!.ratio).toBeCloseTo(0.46, 5);
  });

  it("解析不出比例 → ratio=null，但仍给最近一行（「在跑什么」也是进度信息）", () => {
    const p = parseUvProgress("Using Python 3.12.7 environment at: F:\\ws\\.venv");
    expect(p!.ratio).toBeNull();
    expect(p!.text).toContain("Using Python 3.12.7");
  });

  it("日期型 `12/07` 不被误当计数进度（done > total → 不画比例）", () => {
    const p = parseUvProgress("12/07 09:00 done");
    expect(p!.ratio).toBeNull();
  });

  it("进度块 / 盲文转圈符被剔除（\r 刷屏行压平后仍可读）", () => {
    const p = parseUvProgress("\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591 \u280b 45.2 MiB / 100.5 MiB");
    expect(p!.text).not.toMatch(/[\u2580-\u259F\u2800-\u28FF]/);
    expect(p!.ratio).toBeCloseTo(45.2 / 100.5, 5);
  });

  it("长行截断（状态栏只有一行高，不能把其它芯片挤出可视区）", () => {
    const p = parseUvProgress(`Resolving ${"x".repeat(200)}`);
    expect(p!.text.length).toBeLessThanOrEqual(49);
    expect(p!.text.endsWith("…")).toBe(true);
  });

  it("空行 / 纯空白 → null（UI 保持上一次显示）", () => {
    expect(parseUvProgress("")).toBeNull();
    expect(parseUvProgress("   \r\n  ")).toBeNull();
    expect(parseUvProgress("\u2588\u2588\u2588")).toBeNull(); // 剔掉进度块后是空行
  });

  it("比例被夹在 0..1（异常输入不溢出）", () => {
    expect(parseUvProgress("999 MiB / 1 MiB")!.ratio).toBe(1);
  });
});
