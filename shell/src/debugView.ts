// 调试侧栏（docs/python_debug_dev_plan.md §6.5）：工具栏 / 调用栈 / 变量 / 断点列表。
// 对标 runWidget 的 handlers 注入模式：main.ts 拥有调试动作（启动/停止），本模块负责
// 渲染与步进派发；DAP 数据流经 dap/client（stopped → threads/stackTrace/scopes/variables）。

import * as dap from "./dap/client";
import type { DapStackFrame, DapVariable } from "./dap/client";
import { getBreakpointLines, setBreakpointLines, breakpointFiles, clearCurrentLine, highlightCurrentLine, setBreakpointsChangeCallback } from "./debugGutter";
import { $ } from "./state";
import { codicon, basename } from "./util";

// ---------- handlers 注入（同 runWidget 先例，避免循环导入） ----------

export interface DebugViewHandlers {
  /** 启动调试（工具栏 F5 同款入口） */
  start: () => void;
  /** 停止调试 */
  stop: () => void;
  /** 点击调用栈帧 → 打开源码并定位（main.ts 的 openFile） */
  openFile: (path: string, line: number) => void;
  /** 重建断点装饰（删除断点后） */
  refreshGutter: () => void;
}

let handlers: DebugViewHandlers | null = null;

export function setDebugViewHandlers(h: DebugViewHandlers): void {
  handlers = h;
}

// ---------- 状态（§6.5 状态机映射） ----------

let activeThreadId = 1;
let activeFrameId: number | null = null;
let activeFrames: DapStackFrame[] = [];

/** 记录「依赖清单命中 debugpy」的一次性提示是否已发（§3.5：输出面板一次性提示） */
let depNoticeShown = false;

export function notifyDepFound(files: string[]): void {
  if (depNoticeShown || files.length === 0) return;
  depNoticeShown = true;
  const list = files.join("、");
  console.info(`[debug] 项目依赖清单（${list}）声明了 debugpy：OpenCharm 调试使用自带副本，二者互不影响，可按需移除声明。`);
}

// ---------- 渲染 ----------

function toolbarButton(id: string, icon: string, tip: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = id;
  btn.className = "debug-toolbar-btn";
  btn.title = tip;
  btn.appendChild(codicon(icon));
  btn.addEventListener("click", onClick);
  return btn;
}

/** 初始化调试侧栏 DOM（init 时一次性构建；#view-debug 容器已在 index.html 声明） */
export function initDebugView(): void {
  const root = $("view-debug");
  root.textContent = "";

  // 工具栏（§6.1：继续/暂停/单步跳过/单步进入/单步退出/停止）
  const toolbar = document.createElement("div");
  toolbar.id = "debug-toolbar";
  toolbar.appendChild(toolbarButton("debug-continue", "debug-continue", "继续 (F5)", () => void onContinue()));
  toolbar.appendChild(toolbarButton("debug-pause", "debug-pause", "暂停", () => void onPause()));
  toolbar.appendChild(toolbarButton("debug-step-over", "debug-step-over", "单步跳过 (F10)", () => void onStep("next")));
  toolbar.appendChild(toolbarButton("debug-step-into", "debug-step-into", "单步进入 (F11)", () => void onStep("stepIn")));
  toolbar.appendChild(toolbarButton("debug-step-out", "debug-step-out", "单步退出 (Shift+F11)", () => void onStep("stepOut")));
  toolbar.appendChild(toolbarButton("debug-stop", "debug-stop", "停止调试 (Shift+F5)", () => handlers?.stop()));
  root.appendChild(toolbar);

  // 调用栈
  const stackHeader = document.createElement("div");
  stackHeader.className = "debug-section-header";
  stackHeader.textContent = "调用栈";
  const stack = document.createElement("div");
  stack.id = "debug-stack";
  root.appendChild(stackHeader);
  root.appendChild(stack);

  // 变量
  const varsHeader = document.createElement("div");
  varsHeader.className = "debug-section-header";
  varsHeader.textContent = "变量";
  const vars = document.createElement("div");
  vars.id = "debug-vars";
  root.appendChild(varsHeader);
  root.appendChild(vars);

  // 断点列表
  const bpHeader = document.createElement("div");
  bpHeader.className = "debug-section-header";
  bpHeader.textContent = "断点";
  const bps = document.createElement("div");
  bps.id = "debug-breakpoints";
  root.appendChild(bpHeader);
  root.appendChild(bps);

  renderDebugView();
}

/** 渲染入口：按当前 phase 更新工具栏可用态 + 三个面板 */
export function renderDebugView(): void {
  renderToolbar();
  renderStack();
  renderVars();
  renderBreakpoints();
}

function renderToolbar(): void {
  const phase = dap.currentPhase();
  const canControl = phase === "stopped" || phase === "running";
  const stopped = phase === "stopped";
  const btn = (id: string) => document.getElementById(id) as HTMLButtonElement | null;
  const set = (id: string, enabled: boolean) => {
    const el = btn(id);
    if (el) el.disabled = !enabled;
  };
  // 继续/步进只在 stopped 态可用；暂停只在 running 态可用；停止在 starting/running/stopped 可用
  set("debug-continue", stopped);
  set("debug-step-over", stopped);
  set("debug-step-into", stopped);
  set("debug-step-out", stopped);
  set("debug-pause", phase === "running");
  set("debug-stop", canControl || phase === "starting");
}

/** 渲染期元素获取：缺元素静默跳过（$ 会抛错，DOM 未建好时 phase 回调可能先于 initDebugView） */
function $soft(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function renderStack(): void {
  const el = $soft("debug-stack");
  if (!el) return;
  el.textContent = "";
  const phase = dap.currentPhase();
  if (phase !== "stopped" || activeFrames.length === 0) {
    const empty = document.createElement("div");
    empty.className = "debug-empty";
    empty.textContent = phase === "idle" ? "未在调试" : phase === "stopped" ? "" : "运行中…";
    el.appendChild(empty);
    return;
  }
  for (const frame of activeFrames) {
    const row = document.createElement("div");
    row.className = `debug-stack-frame${frame.id === activeFrameId ? " active" : ""}`;
    const name = document.createElement("span");
    name.textContent = frame.name;
    row.appendChild(name);
    const loc = document.createElement("span");
    loc.className = "debug-frame-loc";
    loc.textContent = frame.source?.name
      ? `${frame.source.name}:${frame.line}`
      : `:${frame.line}`;
    row.appendChild(loc);
    row.addEventListener("click", () => {
      // 点击帧 → 跳转源码（§1.1：点击帧跳转源码）
      const path = frame.source?.path;
      if (path) {
        activeFrameId = frame.id;
        handlers?.openFile(path, frame.line);
        renderStack();
        void refreshVariables();
      }
    });
    el.appendChild(row);
  }
}

function renderVars(): void {
  const el = $soft("debug-vars");
  if (!el) return;
  el.textContent = "";
  const phase = dap.currentPhase();
  if (phase !== "stopped") {
    const empty = document.createElement("div");
    empty.className = "debug-empty";
    empty.textContent = "";
    el.appendChild(empty);
    return;
  }
}

function renderBreakpoints(): void {
  const el = $soft("debug-breakpoints");
  if (!el) return;
  el.textContent = "";
  const files = breakpointFiles();
  const entries: [string, number[]][] = files.map((p) => [p, getBreakpointLines(p)]);
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "debug-empty";
    empty.textContent = "无断点（点击编辑器行号左侧空白处添加）";
    el.appendChild(empty);
    return;
  }
  for (const [path, lines] of entries) {
    for (const line of lines) {
      const row = document.createElement("div");
      row.className = "debug-bp-row";
      const icon = document.createElement("span");
      icon.className = "debug-bp-dot";
      row.appendChild(icon);
      const label = document.createElement("span");
      label.className = "debug-bp-label";
      label.textContent = `${basename(path)}:${line}`;
      label.addEventListener("click", () => handlers?.openFile(path, line));
      row.appendChild(label);
      const del = document.createElement("span");
      del.className = "debug-bp-del";
      del.title = "删除断点";
      del.appendChild(codicon("close"));
      del.addEventListener("click", () => {
        // 删除单行断点：整文件重设剩余行（setBreakpointLines 内部完成同步）
        const rest = getBreakpointLines(path).filter((l) => l !== line);
        setBreakpointLines(path, rest);
        handlers?.refreshGutter();
        renderBreakpoints();
      });
      row.appendChild(del);
      el.appendChild(row);
    }
  }
}

// ---------- DAP 事件 → 状态刷新 ----------

/** 调试会话事件接线（main.ts 启动时调用一次） */
export function wireDebugViewEvents(): void {
  // 断点表变更（gutter 点击 / 本列表删除）→ 重渲染断点列表
  setBreakpointsChangeCallback(() => renderBreakpoints());

  dap.onPhase(() => {
    // 会话结束：清栈/变量态（断点表保留）
    if (dap.currentPhase() === "exited" || dap.currentPhase() === "idle") {
      activeFrames = [];
      activeFrameId = null;
    }
    renderDebugView();
  });

  dap.onEvent("stopped", (body) => {
    // 断点命中：刷新调用栈 + 变量 + 当前行高亮（§1.1 最小闭环）
    void handleStopped(body);
  });

  dap.onEvent("continued", () => {
    // 继续执行：清当前行高亮（变量面板下次 stopped 再刷）
    clearCurrentLine();
  });

  dap.onEvent("terminated", () => {
    // debugpy 报告会话终止（脚本自然跑完）；后端退出监视会随后 emit debug-exited
  });

  dap.onEvent("output", () => {
    // MVP 忽略 output 事件：stdout 已走 PTY 真 TTY（§5.3），避免双份显示
  });
}

async function handleStopped(body: { threadId?: number; reason?: string }): Promise<void> {
  activeThreadId = body.threadId ?? 1;
  try {
    activeFrames = await dap.dapStackTrace(activeThreadId);
    activeFrameId = activeFrames[0]?.id ?? null;
    // 当前行高亮：栈顶帧
    const top = activeFrames[0];
    if (top?.source?.path) {
      highlightCurrentLine(top.source.path, top.line);
    }
    renderDebugView();
    await refreshVariables();
  } catch (e) {
    console.warn("[debugView] stopped 处理失败:", e);
  }
}

async function refreshVariables(): Promise<void> {
  const el = $soft("debug-vars");
  if (!el) return;
  el.textContent = "";
  if (activeFrameId === null) return;
  try {
    // §6.5：栈顶 frameId → scopes → locals scope → variables
    const scopes = await dap.dapScopes(activeFrameId);
    const locals = scopes.find((s) => s.presentationHint === "locals" || s.name.toLowerCase() === "locals");
    if (!locals) return;
    const vars: DapVariable[] = await dap.dapVariables(locals.variablesReference);
    for (const v of vars) {
      const row = document.createElement("div");
      row.className = "debug-var-row";
      const name = document.createElement("span");
      name.className = "debug-var-name";
      name.textContent = v.name;
      row.appendChild(name);
      const value = document.createElement("span");
      value.className = "debug-var-value";
      value.textContent = v.value;
      value.title = v.value;
      row.appendChild(value);
      el.appendChild(row);
    }
  } catch (e) {
    console.warn("[debugView] 变量刷新失败:", e);
  }
}

// ---------- 步进控制 ----------

async function onContinue(): Promise<void> {
  try {
    await dap.dapContinue(activeThreadId);
  } catch (e) {
    console.warn("[debugView] continue 失败:", e);
  }
}

async function onPause(): Promise<void> {
  try {
    await dap.request("pause", { threadId: activeThreadId });
  } catch (e) {
    console.warn("[debugView] pause 失败:", e);
  }
}

async function onStep(kind: "next" | "stepIn" | "stepOut"): Promise<void> {
  try {
    if (kind === "next") await dap.dapNext(activeThreadId);
    else if (kind === "stepIn") await dap.dapStepIn(activeThreadId);
    else await dap.dapStepOut(activeThreadId);
  } catch (e) {
    console.warn(`[debugView] ${kind} 失败:`, e);
  }
}
