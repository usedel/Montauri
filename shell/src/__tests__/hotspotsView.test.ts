// @vitest-environment happy-dom
// A1：运行时热点视图单测。
//  - 纯函数（coveragePct / fmtTime）在这里直接测；
//  - 三条**空态分支**（未打开工作区 / 无运行记录 / 扫描失败）也在这里用 happy-dom 驱动——
//    e2e 触达不到「无工作区」态：没有工作区时整个侧栏被欢迎页盖住，#view-runtime 即使
//    摘掉 .hidden 也 toBeVisible() 失败（2026-10-06 踩）。渲染主路径仍由 e2e 覆盖。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { coveragePct, fmtTime, initHotspotsView, refreshHotspots, type RuntimeHotspots } from "../hotspotsView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { invoke } = await import("@tauri-apps/api/core");
const { app } = await import("../state");

/** 造一份最小结果（只填该用例关心的字段） */
function mk(observed: number, totalDefined: number): RuntimeHotspots {
  return {
    has_data: true,
    runs: 1,
    last_run: 1700000000,
    trace_db: "d:/x/traces/abc.db",
    observed: Array.from({ length: observed }, (_, i) => ({
      file: "mod.py",
      qualname: `f${i}`,
      line: i + 1,
      hits: 1,
      stale: false,
      exc: [],
    })),
    unobserved: [],
    total_defined: totalDefined,
    truncated: false,
  };
}

const emptyTitle = (): string | null =>
  document.querySelector("#hp-results .empty-title")?.textContent ?? null;
const summaryText = (): string | null => document.querySelector("#hp-summary")?.textContent ?? null;

describe("coveragePct", () => {
  it("0 个定义时返回 0（不产生除零 / NaN）", () => {
    expect(coveragePct(mk(0, 0))).toBe(0);
  });

  it("按 已观测 / 定义总数 四舍五入", () => {
    expect(coveragePct(mk(277, 350))).toBe(79); // 79.14 → 79
    expect(coveragePct(mk(1, 3))).toBe(33); // 33.33 → 33
    expect(coveragePct(mk(2, 3))).toBe(67); // 66.67 → 67
  });

  it("全观测为 100，全未观测为 0", () => {
    expect(coveragePct(mk(10, 10))).toBe(100);
    expect(coveragePct(mk(0, 10))).toBe(0);
  });
});

describe("fmtTime", () => {
  it("null / 0 返回占位符（无运行记录时不显示 1970）", () => {
    expect(fmtTime(null)).toBe("—");
    expect(fmtTime(0)).toBe("—");
  });

  it("有效 Unix 秒返回非空字符串", () => {
    const s = fmtTime(1700000000);
    expect(s).not.toBe("—");
    expect(s.length).toBeGreaterThan(0);
  });
});

describe("空态分支", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    document.body.textContent = "";
    // initHotspotsView 走 $("view-runtime")，缺元素即抛（同 state.ts 的 $ 契约）
    const root = document.createElement("div");
    root.id = "view-runtime";
    document.body.appendChild(root);
    initHotspotsView();
  });

  it("未打开工作区：空态文案 + 不发扫描命令", async () => {
    app.workspaceRoot = null;
    await refreshHotspots();
    expect(emptyTitle()).toBe("未打开工作区");
    expect(summaryText()).toBe("未打开工作区");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("无运行记录（has_data=false）：空态而非 0 个函数的假数据", async () => {
    app.workspaceRoot = "D:/ws";
    vi.mocked(invoke).mockResolvedValue({ ...mk(0, 3), has_data: false, runs: 0, last_run: null });
    await refreshHotspots();
    expect(emptyTitle()).toBe("暂无运行记录");
    expect(summaryText()).toBe("暂无运行记录");
    // 口径红线：无运行数据时不产出「未观测到运行」分组
    expect(document.querySelector("#hp-results .todo-group-header")).toBeNull();
  });

  it("扫描失败：错误态可见且带后端错误原文（不静默吞错）", async () => {
    app.workspaceRoot = "D:/ws";
    vi.mocked(invoke).mockRejectedValue(new Error("trace 库损坏"));
    await refreshHotspots();
    expect(emptyTitle()).toBe("扫描失败");
    expect(summaryText()).toBe("扫描失败");
    expect(document.querySelector("#hp-results .empty-state")?.textContent).toContain("trace 库损坏");
  });
});
