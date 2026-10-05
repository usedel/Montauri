// B5（toolbox_dev_plan.md §6.8 / PR-B5-1）：运行输出多播总线的单测。
// 覆盖：多消费者同时收到 / 带 instanceId / dispose 后不再收到 / **单个消费者抛错不影响其他** /
// 空文本不广播 / 回调内注册注销不破坏本次遍历。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addRunDataConsumer, emitRunData, removeRunDataConsumer, resetRunDataBus, runDataConsumerCount,
} from "../runDataBus";

afterEach(() => {
  resetRunDataBus();
});

describe("运行输出多播总线（§6.8）", () => {
  it("多消费者同时收到同一块输出，且都拿到 instanceId", () => {
    const a = vi.fn();
    const b = vi.fn();
    addRunDataConsumer(a);
    addRunDataConsumer(b);
    emitRunData("run-term-script", "hello\n");
    expect(a).toHaveBeenCalledWith("run-term-script", "hello\n");
    expect(b).toHaveBeenCalledWith("run-term-script", "hello\n");
    expect(runDataConsumerCount()).toBe(2);
  });

  it("多实例并存：消费者各自按 instanceId 归属（不被串线）", () => {
    const seen: [string, string][] = [];
    addRunDataConsumer((id, text) => seen.push([id, text]));
    emitRunData("run-term-project-1", "a");
    emitRunData("run-term-project-2", "b");
    expect(seen).toEqual([
      ["run-term-project-1", "a"],
      ["run-term-project-2", "b"],
    ]);
  });

  it("dispose 后不再收到；重复 dispose 无害；removeRunDataConsumer 等价", () => {
    const a = vi.fn();
    const off = addRunDataConsumer(a);
    off();
    off();
    emitRunData("run-term-script", "x");
    expect(a).not.toHaveBeenCalled();
    expect(runDataConsumerCount()).toBe(0);

    const b = vi.fn();
    addRunDataConsumer(b);
    removeRunDataConsumer(b);
    emitRunData("run-term-script", "y");
    expect(b).not.toHaveBeenCalled();
  });

  it("单个消费者抛错不影响其他消费者（§6.8 铁律）", () => {
    const ok = vi.fn();
    addRunDataConsumer(() => {
      throw new Error("consumer boom");
    });
    addRunDataConsumer(ok);
    expect(() => emitRunData("run-term-script", "z")).not.toThrow();
    expect(ok).toHaveBeenCalledWith("run-term-script", "z");
  });

  it("空文本不广播；无消费者时不报错", () => {
    const a = vi.fn();
    addRunDataConsumer(a);
    emitRunData("run-term-script", "");
    expect(a).not.toHaveBeenCalled();
    resetRunDataBus();
    expect(() => emitRunData("run-term-script", "x")).not.toThrow();
  });

  it("回调内注册/注销消费者不破坏本次遍历（快照遍历）", () => {
    const late = vi.fn();
    const host = vi.fn(() => {
      addRunDataConsumer(late);
    });
    addRunDataConsumer(host);
    emitRunData("run-term-script", "1");
    expect(host).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled(); // 本次遍历不含新注册的
    emitRunData("run-term-script", "2");
    expect(late).toHaveBeenCalledWith("run-term-script", "2");
  });
});
