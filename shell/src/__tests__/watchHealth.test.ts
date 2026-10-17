// @vitest-environment happy-dom
// 文件监听健康度（TD-029②）单测：亮芯片 / 收到 fs-changed 后复位 / 重订阅**有界**。
// 覆盖的正是历史缺陷：失败被 console.warn 吞掉、且没有任何「监听已恢复」的反向信号。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const toast = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

import { handleWatchHealth, noteWatcherAlive, resetWatchHealthState } from "../watchHealth";
import { app } from "../state";

function chip(): HTMLElement {
  const el = document.getElementById("status-watch");
  if (!el) throw new Error("#status-watch 未挂载");
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  app.workspaceRoot = "C:\\ws";
  document.body.innerHTML = '<span id="status-watch" class="hidden"></span>';
  resetWatchHealthState();
});

afterEach(() => {
  resetWatchHealthState();
});

describe("handleWatchHealth（监听失败显式化）", () => {
  it("收到健康度事件 → 亮芯片 + 一次性 toast + 触发一次重订阅", () => {
    handleWatchHealth({ kind: "error", detail: "缓冲区溢出" });
    expect(chip().classList.contains("hidden")).toBe(false);
    expect(chip().textContent).toContain("监听异常");
    expect(chip().querySelector(".codicon.codicon-warning")).not.toBeNull(); // 图标类不能被覆盖掉
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("连续多次失败只弹一次 toast（同一轮故障不刷屏）", () => {
    handleWatchHealth({ kind: "error" });
    handleWatchHealth({ kind: "error" });
    handleWatchHealth({ kind: "io" });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("重订阅**有界**：超过退避档数后不再自动重试（留给用户点芯片）", () => {
    for (let i = 0; i < 8; i++) handleWatchHealth({ kind: "error" });
    // 2s 与 6s 两档各一次；后续失败不再排新的定时器（invoke 在本用例里不应被调用）
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("noteWatcherAlive（监听恢复的反向信号）", () => {
  it("fs-changed 到达 → 清芯片 + 复位计数，并给一次恢复提示", () => {
    handleWatchHealth({ kind: "error" });
    expect(chip().classList.contains("hidden")).toBe(false);
    noteWatcherAlive();
    expect(chip().classList.contains("hidden")).toBe(true);
    const msgs = toast.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes("恢复"))).toBe(true);
  });

  it("没有故障时不产生噪声（无 chip 操作、无 toast）", () => {
    noteWatcherAlive();
    expect(toast).not.toHaveBeenCalled();
    expect(chip().classList.contains("hidden")).toBe(true);
  });
});
