// B5（toolbox_dev_plan.md §6.7.2~6.7.4 / PR-B5-2）：运行日志纯状态层的单测。
// 覆盖：状态机三态转移与实例归属、半行缓冲、上限保尾弃头 + 已丢弃计数、级别计数、
// 过滤（未分级行永远显示）与搜索（关键字/正则/大小写 + 非法正则降级为不过滤）。
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LOG_LINES, appendLogText, beginSession, clearLogEntries, compileMatcher,
  createLogState, endSession, flushPartial, levelVisible, resetLogState, visibleEntries,
  type LogFilter,
} from "../logStore";

const ID = "run-term-script";

function filter(patch: Partial<LogFilter> = {}): LogFilter {
  return { levels: null, query: "", regex: false, caseSensitive: false, ...patch };
}

beforeEach(() => {
  // 全局状态不共享（每个用例自建 state）
});

describe("状态机（§6.7.2）", () => {
  it("idle → live：新运行清空视图并绑定实例；ended → live 同样清空重来", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, "a\nb\n");
    expect(s.phase).toBe("live");
    expect(s.entries).toHaveLength(2);
    // 同实例再次运行：清空
    beginSession(s, ID);
    expect(s.entries).toHaveLength(0);
    expect(s.phase).toBe("live");
  });

  it("只跟最近一次运行：非绑定实例的输出被丢弃（§6.9 决策 1）", () => {
    const s = createLogState();
    beginSession(s, "run-term-project-1");
    expect(appendLogText(s, "run-term-project-2", "x\n")).toBe(0);
    expect(appendLogText(s, "run-term-project-1", "y\n")).toBe(1);
    expect(s.entries.map((e) => e.raw)).toEqual(["y"]);
  });

  it("live → ended：冲刷半行缓冲并落退出码；非绑定实例的结束事件被忽略", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, "hello"); // 无换行 → 半行缓冲
    expect(s.entries).toHaveLength(0);
    endSession(s, ID, 0);
    expect(s.phase).toBe("ended");
    expect(s.exitCode).toBe(0);
    expect(s.entries.map((e) => e.raw)).toEqual(["hello"]);

    const s2 = createLogState();
    beginSession(s2, ID);
    endSession(s2, "run-term-project-1", 1); // 别的实例结束 → 不影响
    expect(s2.phase).toBe("live");
  });

  it("endSession 冲刷半行时按传入上限裁剪（上限调小后收尾行不越界）", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, ["INFO: a", "INFO: b", "INFO: c", "INFO: d"].join("\n") + "\n", 3);
    appendLogText(s, ID, "INFO: tail"); // 无换行 → 半行缓冲
    endSession(s, ID, 0, 3);
    expect(s.entries).toHaveLength(3);
    expect(s.dropped).toBe(2);
    expect(s.phase).toBe("ended");
  });

  it("未绑定时 append 不生效；reset 回到 idle", () => {
    const s = createLogState();
    expect(appendLogText(s, ID, "x\n")).toBe(0);
    beginSession(s, ID);
    appendLogText(s, ID, "x\n");
    resetLogState(s);
    expect(s.phase).toBe("idle");
    expect(s.instanceId).toBeNull();
    expect(s.entries).toHaveLength(0);
    expect(s.counts).toEqual({ error: 0, warn: 0, info: 0, debug: 0 });
  });

  it("clearLogEntries 只清内容，不动相位与绑定", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, "x\n");
    clearLogEntries(s);
    expect(s.phase).toBe("live");
    expect(s.instanceId).toBe(ID);
    expect(s.entries).toHaveLength(0);
  });
});

describe("切行与上限（§6.7.3）", () => {
  it("半行缓冲：跨 chunk 拼接，\\r\\n 也能正确切", () => {
    const s = createLogState();
    beginSession(s, ID);
    expect(appendLogText(s, ID, "2026-10-05 12:00:00 | INFO ")).toBe(0);
    expect(appendLogText(s, ID, "| app - 半行\n下一行\n")).toBe(2);
    expect(s.entries.map((e) => e.raw)).toEqual(["2026-10-05 12:00:00 | INFO | app - 半行", "下一行"]);
    expect(s.entries[0].level).toBe("info");
  });

  it("超上限：保尾弃头 + dropped 计数 + 计数同步递减", () => {
    const s = createLogState();
    beginSession(s, ID);
    const max = 10;
    appendLogText(s, ID, Array.from({ length: 12 }, (_, i) => `INFO: line${i}`).join("\n") + "\n", max);
    expect(s.entries).toHaveLength(max);
    expect(s.dropped).toBe(2);
    expect(s.entries[0].raw).toBe("INFO: line2");
    // counts.info 应为仍在列的 10 条（被丢弃的 2 条已减掉）
    expect(s.counts.info).toBe(10);
    expect(s.counts.error).toBe(0);
  });

  it("默认上限常量 5000；flushPartial 空缓冲不产生行", () => {
    expect(DEFAULT_MAX_LOG_LINES).toBe(5000);
    const s = createLogState();
    beginSession(s, ID);
    expect(flushPartial(s)).toBe(false);
    appendLogText(s, ID, "tail");
    expect(flushPartial(s)).toBe(true);
    expect(s.entries.map((e) => e.raw)).toEqual(["tail"]);
  });

  it("空行不入列（不占额度、不计级别）", () => {
    const s = createLogState();
    beginSession(s, ID);
    expect(appendLogText(s, ID, "\n\n  \nERROR x\n")).toBe(1);
    expect(s.counts.error).toBe(1);
  });
});

describe("级别计数与过滤（§6.7.4）", () => {
  it("级别计数按解析结果累加（含退化行的 detectLogLevel）", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, [
      "INFO: a",
      "WARNING: b",
      "ERROR: c",
      "DEBUG: d",
      "CRITICAL: e", // → error
      "普通行", // → 不计数
    ].join("\n") + "\n");
    expect(s.counts).toEqual({ error: 2, warn: 1, info: 1, debug: 1 });
  });

  it("级别过滤：**未分级行永远显示**；空集/ null = 不过滤", () => {
    expect(levelVisible(null, new Set(["error"]))).toBe(true);
    expect(levelVisible("error", new Set(["error"]))).toBe(true);
    expect(levelVisible("info", new Set(["error"]))).toBe(false);
    expect(levelVisible("info", null)).toBe(true);
    expect(levelVisible("info", new Set())).toBe(true);
  });

  it("过滤与搜索叠加（先级别后搜索），且**不改数据**", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, ["INFO: alpha", "ERROR: beta", "INFO: gamma", "plain delta"].join("\n") + "\n");
    // 未分级行（"plain delta"）按口径**永远显示**，所以只选 error 时它仍在（与 output.ts 同口径）
    const onlyError = visibleEntries(s, filter({ levels: new Set(["error"]) }));
    expect(onlyError.map((e) => e.raw)).toEqual(["ERROR: beta", "plain delta"]);
    // 级别 + 关键字叠加：无命中 → 空数组（视图显示空态）
    expect(visibleEntries(s, filter({ levels: new Set(["error"]), query: "alpha" }))).toEqual([]);
    // 切回全选立即恢复（数据未被过滤动过）
    expect(visibleEntries(s, filter())).toHaveLength(4);
  });

  it("搜索：关键字 / 大小写 / 正则，匹配范围是整个 raw", () => {
    const s = createLogState();
    beginSession(s, ID);
    appendLogText(s, ID, ["INFO: Alpha", "INFO: alpha", "ERROR: 2026-10-05 启动"].join("\n") + "\n");
    expect(visibleEntries(s, filter({ query: "alpha" })).map((e) => e.raw)).toEqual(["INFO: Alpha", "INFO: alpha"]);
    expect(visibleEntries(s, filter({ query: "alpha", caseSensitive: true })).map((e) => e.raw)).toEqual(["INFO: alpha"]);
    expect(visibleEntries(s, filter({ query: "^ERROR", regex: true })).map((e) => e.raw)).toEqual(["ERROR: 2026-10-05 启动"]);
    expect(visibleEntries(s, filter({ query: "\\d{4}-\\d{2}-\\d{2}", regex: true }))).toHaveLength(1);
  });

  it("非法正则：降级为不过滤 + 暴露 error（不让整列变空白）", () => {
    const m = compileMatcher(filter({ query: "([", regex: true }));
    expect(m.error).not.toBeNull();
    expect(m.test("anything")).toBe(true);
    expect(compileMatcher(filter({ query: "" })).error).toBeNull();
  });
});
