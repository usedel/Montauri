// @vitest-environment happy-dom
// LSP 状态栏芯片（lspStatus.ts）单测：两态渲染 + 语言切换重取词。
// 背景（第二十批 i18n 遗留修复）：原先三处 t() 一次性快照写入 #status-lsp，
// 语言切换后无订阅者刷新——英文界面残留「LSP: 无 Python 文件（已跳过）」中文文案。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { setLspEngineStatus, setLspNote } from "../lspStatus";

function chip(): HTMLElement {
  const el = document.getElementById("status-lsp");
  if (!el) throw new Error("#status-lsp 未挂载");
  return el;
}

describe("lspStatus（LSP 状态栏芯片）", () => {
  beforeEach(() => {
    document.body.innerHTML = `<span id="status-lsp"></span>`;
  });
  afterEach(() => setLocale("zh-CN"));

  it("引擎态渲染状态点 + 本语文案", () => {
    setLspEngineStatus("ready");
    expect(chip().querySelector(".lsp-dot.dot-ready")).not.toBeNull();
    expect(chip().textContent).toBe("LSP: 就绪");

    setLspEngineStatus("off");
    expect(chip().querySelector(".lsp-dot.dot-off")).not.toBeNull();
    expect(chip().textContent).toBe("LSP: 未启动");
  });

  it("提示态渲染（含插值参数）", () => {
    setLspNote("main.lsp.skippedNoPy");
    expect(chip().textContent).toBe("LSP: 无 Python 文件（已跳过）");

    setLspNote("main.lsp.startFailed", { msg: "boom" });
    expect(chip().textContent).toContain("boom");
  });

  it("语言切换后按记忆态重取词（本修复的核心断言）", () => {
    setLspNote("main.lsp.skippedNoPy");
    expect(chip().textContent).toContain("无 Python 文件");
    // 模块顶层的 onLocaleChange(render) 订阅随 import 生效；setLocale 广播即重渲染
    setLocale("en-US");
    expect(chip().textContent).toBe("LSP: no Python files (skipped)");

    // 引擎态同样跟随语言
    setLspEngineStatus("ready");
    expect(chip().textContent).toBe("LSP: ready");
    setLocale("zh-CN");
    expect(chip().textContent).toBe("LSP: 就绪");
  });
});
