// @vitest-environment happy-dom
// UX P0-3 回归：运行组三按钮的禁用态必须用 .is-disabled + aria-disabled，**不能用 disabled 属性**。
// 原因同 debugView 工具栏：Chromium 不向禁用的表单控件派发鼠标事件，data-tip 会静默失效，
// 而「为什么不能运行」的原因文案（R0 disabledReason）恰是灰按钮最需要展示的信息。
import { beforeAll, describe, expect, it } from "vitest";
import type * as RunWidgetModule from "../runWidget";
import type { RunWidgetState } from "../runWidget";

let rw: typeof RunWidgetModule;

const IDS = ["btn-run", "btn-stop", "btn-run-menu"];

function state(partial: Partial<RunWidgetState>): RunWidgetState {
  return {
    canRun: false,
    disabledReason: "未打开工作区",
    running: false,
    preparing: false,
    channel: null,
    targetName: "",
    runShortcut: "Ctrl+F10",
    stopShortcut: "Ctrl+F2",
    selectionShortcut: "Alt+Shift+E",
    canOpenConfig: false,
    profiles: [],
    ...partial,
  };
}

beforeAll(async () => {
  // renderRunWidget 走 lazyEl 解析 DOM，须先备好三个按钮再动态导入
  for (const id of IDS) {
    if (!document.getElementById(id)) {
      const b = document.createElement("button");
      b.id = id;
      document.body.appendChild(b);
    }
  }
  rw = await import("../runWidget");
});

describe("运行组禁用态（UX P0-3：.is-disabled + aria-disabled，保留 data-tip）", () => {
  it("R0 不可运行：三按钮 .is-disabled + aria-disabled=true，disabled 属性保持 false，data-tip 保留原因", () => {
    rw.renderRunWidget(state({ canRun: false, disabledReason: "当前文件不是 Python 文件" }));
    for (const id of IDS) {
      const b = document.getElementById(id) as HTMLButtonElement;
      expect(b.disabled, `${id} 不应设 disabled 属性（会让 data-tip 静默失效）`).toBe(false);
      expect(b.classList.contains("is-disabled"), `${id} 应带 .is-disabled`).toBe(true);
      expect(b.getAttribute("aria-disabled"), `${id} 应有 aria-disabled=true`).toBe("true");
      expect(b.dataset.tip, `${id} 应保留 tooltip 文案`).toBeTruthy();
    }
    expect(document.getElementById("btn-run")!.dataset.tip).toBe("当前文件不是 Python 文件");
  });

  it("R1 可运行未运行：▶/▾ 清除禁用态，⏹ 仍禁用；aria-disabled 与类同源", () => {
    rw.renderRunWidget(state({ canRun: true, targetName: "main.py" }));
    for (const id of ["btn-run", "btn-run-menu"]) {
      const b = document.getElementById(id) as HTMLButtonElement;
      expect(b.classList.contains("is-disabled"), `${id} 不应再带 .is-disabled`).toBe(false);
      expect(b.getAttribute("aria-disabled")).toBe("false");
    }
    const stop = document.getElementById("btn-stop") as HTMLButtonElement;
    expect(stop.classList.contains("is-disabled")).toBe(true);
    expect(stop.getAttribute("aria-disabled")).toBe("true");
    expect(stop.dataset.tip).toBe("没有正在运行的脚本");
  });
});
