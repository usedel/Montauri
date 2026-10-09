// T4（微交互批）：tab 拖拽排序的数组语义单测（moveTabTo 纯逻辑）。
// app 单例（state.ts）共享：直接改 app.tabs。
import { beforeEach, describe, expect, it } from "vitest";
import { app, type Tab } from "../state";
import { moveTabTo, setTabDragHandlers } from "../tabDragSort";

function tab(path: string): Tab {
  // 测试只动 path 与数组序——model 用最小桩（类型层 cast，不触碰 Monaco）
  return { path, dirty: false, model: null as never };
}

/** 当前顺序（路径串） */
function order(): string[] {
  return app.tabs.map((t) => t.path);
}

let movedCalls = 0;

describe("moveTabTo（拖拽排序数组语义）", () => {
  beforeEach(() => {
    setTabDragHandlers({ onMoved: () => { movedCalls++; } });
    movedCalls = 0;
    (app as unknown as { tabs: Tab[] }).tabs = [tab("a"), tab("b"), tab("c"), tab("d")];
  });

  it("前插入：拖 d 到 a 的前半区 → d 移到最前", () => {
    moveTabTo("d", "a", true);
    expect(order()).toEqual(["d", "a", "b", "c"]);
    expect(movedCalls).toBe(1);
  });

  it("后插入：拖 a 到 d 的后半区 → a 移到末尾", () => {
    moveTabTo("a", "d", false);
    expect(order()).toEqual(["b", "c", "d", "a"]);
  });

  it("跨多格移动后其余相对顺序保持（b 拖到 c 后）", () => {
    moveTabTo("b", "c", false);
    expect(order()).toEqual(["a", "c", "b", "d"]);
  });

  it("相邻移动：a 拖到 b 前 = 原地不动（同位置短路？不——语义上仍执行 splice）", () => {
    // a 在 b 前：before=true 插到 b 前面 = 位置不变，但回调仍触发（幂等重绘无害）
    moveTabTo("a", "b", true);
    expect(order()).toEqual(["a", "b", "c", "d"]);
    expect(movedCalls).toBe(1); // 触发了 onMoved（renderTabs 幂等，无害）
  });

  it("自身拖到自身：短路无操作", () => {
    moveTabTo("a", "a", true);
    expect(order()).toEqual(["a", "b", "c", "d"]);
    expect(movedCalls).toBe(0);
  });

  it("未知路径：静默无操作（tab 已在拖拽途中被关闭的竞态兜底）", () => {
    moveTabTo("ghost", "a", true);
    moveTabTo("a", "ghost", false);
    expect(order()).toEqual(["a", "b", "c", "d"]);
    expect(movedCalls).toBe(0);
  });
});
