// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { computeRunWidget, getRunMenuItems, setRunWidgetHandlers, setRunWidgetStateForTest, type RunWidgetState } from "../runWidget";
import type { MenuItem } from "../menu";
import type { RunTarget } from "../runState";

function s(partial: Partial<RunWidgetState>): RunWidgetState {
  return {
    canRun: false,
    disabledReason: "未打开工作区",
    running: false,
    preparing: false,
    channel: null,
    targetName: "",
    currentTarget: null,
    unsavedFileTarget: null,
    runShortcut: "Ctrl+F10",
    stopShortcut: "Ctrl+F2",
    selectionShortcut: "Alt+Shift+E",
    canOpenConfig: false,
    profiles: [],
    ...partial,
  };
}

describe("computeRunWidget 状态 → 目标下拉 / ▶ / ⏹", () => {
  it("R0（不可运行）：三控件均置灰，▶ 显示原因", () => {
    const c = computeRunWidget(s({ canRun: false, disabledReason: "当前文件不是 Python 文件" }));
    expect(c.run.disabled).toBe(true);
    expect(c.run.tip).toBe("当前文件不是 Python 文件");
    expect(c.stop.disabled).toBe(true);
    expect(c.target.disabled).toBe(true);
  });

  it("P1 准备期：▶ 灰 + busy + 专属提示（不再误报「已有脚本在运行」）", () => {
    const c = computeRunWidget(s({ canRun: true, targetName: "main.py", preparing: true }));
    expect(c.run.disabled).toBe(true);
    expect(c.run.busy).toBe(true);
    expect(c.run.tip).toBe("正在准备运行（保存 / 依赖预检）…");
    expect(c.stop.disabled).toBe(true);
    expect(c.target.disabled).toBe(false);
  });

  it("R1（可运行未运行）：▶ 亮 + 运行名 + 快捷键，⏹ 灰，目标下拉亮", () => {
    const c = computeRunWidget(s({ canRun: true, targetName: "main.py" }));
    expect(c.run.disabled).toBe(false);
    expect(c.run.tip).toBe("运行 main.py");
    expect(c.run.tipKey).toBe("Ctrl+F10");
    expect(c.stop.disabled).toBe(true);
    expect(c.stop.tip).toBe("没有正在运行的脚本");
    expect(c.target.disabled).toBe(false);
    // 下拉提示要说明「当前目标是什么」且明确切换本身不会启动
    expect(c.target.tip).toContain("main.py");
    expect(c.target.tip).toContain("不启动");
  });

  it("无粘性目标：▶ 提示回落「运行当前文件」，下拉提示不含任何具体文件名", () => {
    // 回归钉：运行目标区与活动标签无关——targetName 为空时必须走占位语义，
    // 绝不能由 runFlow 侧拼上活动文件名（如 pyproject.toml）。
    const c = computeRunWidget(s({ canRun: true, targetName: "" }));
    expect(c.run.disabled).toBe(false);
    expect(c.run.tip).toBe("运行当前文件");
    expect(c.target.tip).toBe("选择运行目标（只改选中，不启动）");
  });

  it("R2（运行中·输出面板）：▶ 灰（说明原因），⏹ 亮（输出面板）", () => {
    const c = computeRunWidget(s({ canRun: true, running: true, channel: "output", targetName: "main.py" }));
    expect(c.run.disabled).toBe(true);
    expect(c.run.tip).toBe("已有脚本在运行（先停止）");
    expect(c.stop.disabled).toBe(false);
    expect(c.stop.tip).toBe("停止运行 · 输出面板");
    expect(c.stop.tipKey).toBe("Ctrl+F2");
    // 运行中仍可改选目标（下一次运行才生效）——同 PyCharm
    expect(c.target.disabled).toBe(false);
  });

  it("R3（运行中·运行终端）：⏹ 亮（运行终端）", () => {
    const c = computeRunWidget(s({ canRun: true, running: true, channel: "terminal", targetName: "main.py" }));
    expect(c.stop.disabled).toBe(false);
    expect(c.stop.tip).toBe("停止运行 · 运行终端");
  });
});

describe("getRunMenuItems 运行目标区（PyCharm 语义：下拉只改选中，不启动）", () => {
  const row = (items: MenuItem[], label: string): MenuItem => {
    const found = items.find((i) => "label" in i && i.label === label);
    if (!found) throw new Error(`菜单缺少项：${label}`);
    return found as MenuItem;
  };

  it("目标区列出已保存配置；未保存为配置的文件目标单列一行。点击只分发 setTarget，绝不触发运行", () => {
    let ran = 0;
    const got: RunTarget[] = [];
    setRunWidgetHandlers({
      run: () => {
        ran++;
      },
      runInTerminal: () => {},
      runSelection: () => {},
      stop: () => {},
      restart: () => {},
      openRunConfig: () => {},
      openCompound: () => {},
      setTarget: (t) => got.push(t),
    });
    setRunWidgetStateForTest(
      s({
        canRun: true,
        targetName: "main.py",
        currentTarget: { kind: "file", path: "/ws/main.py" },
        unsavedFileTarget: { path: "/ws/main.py", name: "main.py" },
        profiles: [{ name: "FastAPI", summary: "-m uvicorn main:app --reload" }],
      }),
    );
    const items = getRunMenuItems();
    const prof = row(items, "FastAPI");
    prof.action?.();
    expect(got).toEqual([{ kind: "profile", name: "FastAPI" }]);
    expect(ran, "选择目标不得顺手把脚本跑起来").toBe(0);
    // 当前这个尚未保存为配置的文件目标也要可见、可选
    const temp = row(items, "main.py");
    expect(temp.detail).toContain("未保存");
    temp.action?.();
    expect(got).toEqual([
      { kind: "profile", name: "FastAPI" },
      { kind: "file", path: "/ws/main.py" },
    ]);
  });

  it("目标区不出现「当前文件」这类随编辑区漂移的条目（回归钉）", () => {
    setRunWidgetStateForTest(
      s({
        canRun: true,
        targetName: "main.py",
        currentTarget: { kind: "file", path: "/ws/main.py" },
        unsavedFileTarget: { path: "/ws/main.py", name: "main.py" },
        profiles: [{ name: "FastAPI", summary: "-m uvicorn" }],
      }),
    );
    const labels = getRunMenuItems().map((i) => ("label" in i ? i.label : "") ?? "");
    expect(labels.some((l) => l.includes("当前文件"))).toBe(false);
    expect(labels).toContain("main.py");
  });

  it("自动生成的临时配置在标题上标「临时」，与手工新建的永久配置区分", () => {
    setRunWidgetStateForTest(
      s({
        canRun: true,
        targetName: "main.py",
        currentTarget: { kind: "profile", name: "main.py" },
        unsavedFileTarget: null,
        profiles: [
          { name: "main.py", summary: "", temporary: true },
          { name: "FastAPI", summary: "-m uvicorn app:app" },
        ],
      }),
    );
    const items = getRunMenuItems();
    expect(row(items, "main.py").detail).toBe("临时");
    expect(row(items, "FastAPI").detail).toBe("-m uvicorn app:app");
  });

  it("文件目标已被某份配置覆盖时不重复出现（避免同名两行）", () => {
    setRunWidgetStateForTest(
      s({
        canRun: true,
        targetName: "main.py",
        currentTarget: { kind: "file", path: "/ws/main.py" },
        unsavedFileTarget: null, // runFlow 侧判定：已保存过配置 → 不单列
        profiles: [{ name: "main.py", summary: "" }],
      }),
    );
    const labels = getRunMenuItems().map((i) => ("label" in i ? i.label : "") ?? "");
    expect(labels.filter((l) => l === "main.py")).toHaveLength(1);
  });

  it("当前目标在菜单里打勾（单选语义）", () => {
    setRunWidgetStateForTest(
      s({
        canRun: true,
        targetName: "FastAPI（配置）",
        currentTarget: { kind: "profile", name: "FastAPI" },
        unsavedFileTarget: null,
        profiles: [{ name: "FastAPI", summary: "-m uvicorn" }, { name: "worker", summary: "" }],
      }),
    );
    const items = getRunMenuItems();
    expect(row(items, "FastAPI").checked).toBe(true);
    expect(row(items, "worker").checked).toBe(false);
  });

  it("文件目标选中时打勾（路径跨平台归一比较）", () => {
    setRunWidgetStateForTest(
      s({
        canRun: true,
        targetName: "main.py",
        currentTarget: { kind: "file", path: "D:\\ws\\main.py" },
        unsavedFileTarget: { path: "d:/ws/main.py", name: "main.py" },
        profiles: [],
      }),
    );
    expect(row(getRunMenuItems(), "main.py").checked).toBe(true);
  });

  it("目标区不受 busy 限制（运行中仍可改选），而「更多运行方式」置灰", () => {
    setRunWidgetStateForTest(
      s({ canRun: true, running: true, channel: "output", profiles: [{ name: "FastAPI", summary: "-m uvicorn" }] }),
    );
    const items = getRunMenuItems();
    expect(row(items, "FastAPI").disabled).toBeFalsy();
    const term = row(items, "在终端中运行");
    expect(term.disabled).toBe(true);
    expect(term.disabledReason).toBe("已有脚本在运行");
  });

  it("准备期：「更多运行方式」置灰并说明原因（P1：点击不再被 runFlow 闸门静默拒绝）", () => {
    setRunWidgetStateForTest(s({ canRun: true, targetName: "main.py", preparing: true }));
    const items = getRunMenuItems();
    const term = row(items, "在终端中运行");
    expect(term.disabled).toBe(true);
    expect(term.disabledReason).toBe("正在准备运行…");
  });
});