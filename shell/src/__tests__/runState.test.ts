// TD-14 ①：运行态单一真值（RunState 判别联合）+ 运行配置归一化口径的单测。
// 纯模块（零 DOM 依赖），默认 node 环境即可。

import { describe, expect, it, beforeEach } from "vitest";
import {
  EMPTY_RUN_CONFIG, getRunState, isRunning, normalizeRunConfig, runChannelOf, runningPathOf,
  runningStdinModeOf, selectionMetaOf, setRunState, stdinModeOf, type RunConfig,
} from "../runState";

describe("normalizeRunConfig（与后端 RunProfile serde default 同口径）", () => {
  it("缺字段一律回落缺省（stdin 默认 interactive，布尔默认 false）", () => {
    const cfg = normalizeRunConfig(undefined, "main.py");
    expect(cfg).toEqual({ ...EMPTY_RUN_CONFIG, name: "main.py" });
  });

  it("未知 entry.kind 回落 script；module 原样保留", () => {
    expect(normalizeRunConfig({ entry: { kind: "bogus" as "script", target: "x" } }).entry.kind).toBe("script");
    expect(normalizeRunConfig({ entry: { kind: "module", target: "uvicorn" } }).entry).toEqual({
      kind: "module",
      target: "uvicorn",
    });
  });

  it("布尔字段仅显式 true 才算真（存量 0/undefined 不误判）", () => {
    const cfg = normalizeRunConfig({ allow_multiple: 1 as unknown as boolean, auto_rerun: true, python_console: false });
    expect(cfg.allow_multiple).toBe(false);
    expect(cfg.auto_rerun).toBe(true);
    expect(cfg.python_console).toBe(false);
  });

  it("P2-Q 新增字段 python_console 被归一化", () => {
    expect(normalizeRunConfig({ python_console: true }).python_console).toBe(true);
  });
});

describe("stdinModeOf（与后端 effective_mode 同口径）", () => {
  it("file 且有路径 → file", () => {
    expect(stdinModeOf({ stdin: { mode: "file", path: "in.txt" } })).toBe("file");
  });

  it("file 但路径为空 → null（选了重定向却没给文件）", () => {
    expect(stdinModeOf({ stdin: { mode: "file", path: "   " } })).toBe("null");
  });

  it("interactive 原样；未知/缺失 → null", () => {
    expect(stdinModeOf({ stdin: { mode: "interactive", path: "" } })).toBe("interactive");
    expect(stdinModeOf({ stdin: { mode: "weird" as "null", path: "" } })).toBe("null");
    expect(stdinModeOf(undefined)).toBe("null");
  });
});

describe("RunState 判别联合（TD-14 ①：整组置位 / 整组作废）", () => {
  beforeEach(() => setRunState({ phase: "idle" }));

  it("idle：全部运行期字段取空口径（不再有「半复位」的残留值）", () => {
    expect(getRunState()).toEqual({ phase: "idle" });
    expect(isRunning()).toBe(false);
    expect(runChannelOf()).toBeNull();
    expect(runningPathOf()).toBeNull();
    expect(runningStdinModeOf()).toBe("null");
    expect(selectionMetaOf()).toBeNull();
  });

  it("running：六个原模块级变量从同一状态读出", () => {
    const profile: RunConfig = { ...EMPTY_RUN_CONFIG, name: "main.py", auto_rerun: true };
    setRunState({
      phase: "running",
      channel: "output",
      path: "/ws/main.py",
      stdinMode: "interactive",
      eofHinted: false,
      selection: null,
      profile,
    });
    expect(isRunning()).toBe(true);
    expect(runChannelOf()).toBe("output");
    expect(runningPathOf()).toBe("/ws/main.py");
    expect(runningStdinModeOf()).toBe("interactive");
    expect(selectionMetaOf()).toBeNull();
    const s = getRunState();
    expect(s.phase === "running" && s.profile).toBe(profile);
  });

  it("module 入口运行：path 为 null（无文件锚点）但环境判定仍准确", () => {
    setRunState({
      phase: "running",
      channel: "output",
      path: null,
      stdinMode: "null",
      eofHinted: false,
      selection: null,
      profile: null,
    });
    expect(isRunning()).toBe(true);
    expect(runningPathOf()).toBeNull();
  });

  it("eofHinted 可在运行中置位（一次运行只提示一次 EOF 归因）", () => {
    setRunState({
      phase: "running",
      channel: "output",
      path: "/ws/main.py",
      stdinMode: "null",
      eofHinted: false,
      selection: null,
      profile: null,
    });
    const s = getRunState();
    if (s.phase === "running") s.eofHinted = true;
    const after = getRunState();
    expect(after.phase === "running" && after.eofHinted).toBe(true);
  });

  it("选区运行：selection 元信息随状态整组存在，复位后一并消失", () => {
    setRunState({
      phase: "running",
      channel: "output",
      path: "/ws/__opencharm_selection__abc.py",
      stdinMode: "null",
      eofHinted: false,
      selection: { tempPath: "/ws/__opencharm_selection__abc.py", sourcePath: "/ws/main.py", startLine: 12 },
      profile: null,
    });
    expect(selectionMetaOf()).toEqual({
      tempPath: "/ws/__opencharm_selection__abc.py",
      sourcePath: "/ws/main.py",
      startLine: 12,
    });

    setRunState({ phase: "idle" });
    expect(selectionMetaOf()).toBeNull();
    expect(isRunning()).toBe(false);
  });

  it("terminal 通道：stdin 恒 null、profile 为 null（PTY 自身承载交互）", () => {
    setRunState({
      phase: "running",
      channel: "terminal",
      path: "/ws/main.py",
      stdinMode: "null",
      eofHinted: false,
      selection: null,
      profile: null,
    });
    expect(runChannelOf()).toBe("terminal");
    expect(runningStdinModeOf()).toBe("null");
  });
});
