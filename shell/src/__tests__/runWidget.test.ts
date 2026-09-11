// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { computeRunWidget, type RunWidgetState } from "../runWidget";

function s(partial: Partial<RunWidgetState>): RunWidgetState {
  return {
    canRun: false,
    disabledReason: "未打开工作区",
    running: false,
    channel: null,
    targetName: "",
    runShortcut: "Ctrl+F10",
    stopShortcut: "Ctrl+F2",
    selectionShortcut: "Alt+Shift+E",
    canOpenConfig: false,
    ...partial,
  };
}

describe("computeRunWidget 状态 → 三按钮", () => {
  it("R0（不可运行）：三按钮均置灰，▶ 显示原因", () => {
    const c = computeRunWidget(s({ canRun: false, disabledReason: "当前文件不是 Python 文件" }));
    expect(c.run.disabled).toBe(true);
    expect(c.run.tip).toBe("当前文件不是 Python 文件");
    expect(c.stop.disabled).toBe(true);
    expect(c.menu.disabled).toBe(true);
  });

  it("R1（可运行未运行）：▶ 亮 + 运行名 + 快捷键，⏹ 灰，▾ 亮", () => {
    const c = computeRunWidget(s({ canRun: true, targetName: "main.py" }));
    expect(c.run.disabled).toBe(false);
    expect(c.run.tip).toBe("运行 main.py");
    expect(c.run.tipKey).toBe("Ctrl+F10");
    expect(c.stop.disabled).toBe(true);
    expect(c.stop.tip).toBe("没有正在运行的脚本");
    expect(c.menu.disabled).toBe(false);
  });

  it("R2（运行中·输出面板）：▶ 灰（说明原因），⏹ 亮（输出面板）", () => {
    const c = computeRunWidget(s({ canRun: true, running: true, channel: "output", targetName: "main.py" }));
    expect(c.run.disabled).toBe(true);
    expect(c.run.tip).toBe("已有脚本在运行（先停止）");
    expect(c.stop.disabled).toBe(false);
    expect(c.stop.tip).toBe("停止运行 · 输出面板");
    expect(c.stop.tipKey).toBe("Ctrl+F2");
    expect(c.menu.disabled).toBe(false);
  });

  it("R3（运行中·运行终端）：⏹ 亮（运行终端）", () => {
    const c = computeRunWidget(s({ canRun: true, running: true, channel: "terminal", targetName: "main.py" }));
    expect(c.stop.disabled).toBe(false);
    expect(c.stop.tip).toBe("停止运行 · 运行终端");
  });
});