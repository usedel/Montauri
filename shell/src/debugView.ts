// 调试侧栏（docs/python_debug_dev_plan.md §6.5）：工具栏 / 调用栈 / 变量 / 断点列表。
// 对标 runWidget 的 handlers 注入模式：main.ts 拥有调试动作（启动/停止），本模块负责
// 渲染与步进派发；DAP 数据流经 dap/client（stopped → threads/stackTrace/scopes/variables）。

import * as dap from "./dap/client";
import type { DapStackFrame, DapVariable } from "./dap/client";
import { getBreakpointLines, setBreakpointLines, breakpointFiles, clearCurrentLine, highlightCurrentLine, setBreakpointsChangeCallback } from "./debugGutter";
import { $ } from "./state";
import { codicon, basename, emptyState } from "./util"; // UI-12：空态改用统一组件
// UI-09：工具栏提示的快捷键副文本改为读键位系统（原先把 "(F5)" 等硬编码进提示文本，
// 用户在设置里改键后提示就是错的）。keybindings 仅依赖 state，此处导入不成环。
import { bindingLabel, type KeybindingId } from "./keybindings";

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

/** 工具栏提示元数据：base 文案 + 可选键位 id。
 *  「继续」复用键位 `debug`（其语义即「启动调试 / 继续」，与工具栏同一动作）；「暂停」无快捷键。 */
const TOOLBAR_TIPS: Record<string, { tip: string; kbId: KeybindingId | null }> = {
  "debug-continue": { tip: "继续", kbId: "debug" },
  "debug-pause": { tip: "暂停", kbId: null },
  "debug-step-over": { tip: "单步跳过", kbId: "debug_step_over" },
  "debug-step-into": { tip: "单步进入", kbId: "debug_step_into" },
  "debug-step-out": { tip: "单步退出", kbId: "debug_step_out" },
  "debug-stop": { tip: "停止调试", kbId: "debug_stop" },
};

/** 写入 tooltip 文案 + kbd 副文本 + aria-label（每次渲染工具栏都刷新，故改键后下次渲染即生效） */
function applyToolbarTip(btn: HTMLElement, id: string): void {
  const meta = TOOLBAR_TIPS[id];
  if (!meta) return;
  const key = meta.kbId ? bindingLabel(meta.kbId) : "";
  btn.dataset.tip = meta.tip;
  // 副文本为空时删除属性：tooltip.ts 以 `if (key)` 判断，残留空串会渲染出空 kbd 框
  if (key) btn.dataset.tipKey = key;
  else delete btn.dataset.tipKey;
  btn.setAttribute("aria-label", key ? `${meta.tip} ${key}` : meta.tip);
}

function toolbarButton(id: string, icon: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = id;
  btn.className = "debug-toolbar-btn";
  // UI-09：图标按钮统一走自绘 data-tip。内部 <i> 带 aria-hidden，可访问名称原先仅由 title
  // 提供，故同步补 aria-label（由 applyToolbarTip 写入）。
  applyToolbarTip(btn, id);
  btn.appendChild(codicon(icon));
  // UI-09：以 .is-disabled + aria-disabled 取代 disabled 属性。原因：Chromium 不向禁用的表单
  // 控件派发鼠标事件（事件落到父元素），data-tip 会静默失效；而「未调试时整排灰按钮」恰是
  // 最需要提示的场景（原生 title 由渲染层命中测试驱动，禁用态仍显示，故不能简单替换）。
  // 附带收益：按钮保留在 tab 序列内，键盘/读屏用户能发现控件并听到「已禁用」状态
  //（disabled 属性会把元素移出焦点序列，等于对键盘用户完全隐藏）。
  btn.addEventListener("click", () => {
    if (btn.classList.contains("is-disabled")) return;
    onClick();
  });
  return btn;
}

/** 初始化调试侧栏 DOM（init 时一次性构建；#view-debug 容器已在 index.html 声明） */
export function initDebugView(): void {
  const root = $("view-debug");
  root.textContent = "";

  // 工具栏（§6.1：继续/暂停/单步跳过/单步进入/单步退出/停止）
  // UI-09：提示文案与快捷键改由 TOOLBAR_TIPS + 键位系统提供，此处只传 id / 图标 / 动作
  const toolbar = document.createElement("div");
  toolbar.id = "debug-toolbar";
  toolbar.appendChild(toolbarButton("debug-continue", "debug-continue", () => void onContinue()));
  toolbar.appendChild(toolbarButton("debug-pause", "debug-pause", () => void onPause()));
  toolbar.appendChild(toolbarButton("debug-step-over", "debug-step-over", () => void onStep("next")));
  toolbar.appendChild(toolbarButton("debug-step-into", "debug-step-into", () => void onStep("stepIn")));
  toolbar.appendChild(toolbarButton("debug-step-out", "debug-step-out", () => void onStep("stepOut")));
  toolbar.appendChild(toolbarButton("debug-stop", "debug-stop", () => handlers?.stop()));
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
  // UI-09：禁用态改用 .is-disabled + aria-disabled（不用 disabled 属性），理由见 toolbarButton；
  // 同时每次渲染刷新提示，使快捷键副文本跟随用户在设置里的改键。
  const set = (id: string, enabled: boolean) => {
    const el = btn(id);
    if (!el) return;
    el.classList.toggle("is-disabled", !enabled);
    el.setAttribute("aria-disabled", String(!enabled));
    applyToolbarTip(el, id);
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
    // UI-12：改用统一的 emptyState()（图标 + 标题 + 说明），与文件树/大纲/搜索面板同一套视觉语言。
    // compact=true：侧栏是窄区域（默认 280px），用紧凑档避免大块留白。
    // 顺带修掉两个文案缺陷：① phase==="stopped" 但无栈帧时，原先塞的是 textContent="" 的空 div，
    // 用户看到彻底空白、无从判断是异常还是正常；② 「未在调试」原先不给任何下一步指引。
    if (phase === "stopped") {
      el.appendChild(emptyState("debug-alt", "无调用栈信息", "调试适配器未返回栈帧", true));
    } else if (phase === "idle") {
      // 快捷键读键位系统而非硬编码 F5（同 UI-09 对工具栏提示的处理），改键后文案不会失真
      const key = bindingLabel("debug");
      el.appendChild(emptyState(
        "debug-alt",
        "未在调试",
        key ? `按 ${key} 启动调试，命中断点后此处显示调用栈` : "启动调试并命中断点后，此处显示调用栈",
        true,
      ));
    } else {
      el.appendChild(emptyState("debug-alt", "运行中…", "命中断点后此处显示调用栈", true));
    }
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
    // UI-16：可点击行补 button 语义 + 键盘激活（此前鼠标独占；行内容是可访问名称，无需 aria-label）
    const jump = (): void => {
      // 点击帧 → 跳转源码（§1.1：点击帧跳转源码）
      const path = frame.source?.path;
      if (path) {
        activeFrameId = frame.id;
        handlers?.openFile(path, frame.line);
        renderStack();
        void refreshVariables();
      }
    };
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.addEventListener("click", jump);
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        jump();
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
    // UI-12：原先塞的是 textContent="" 的空 div（纯占位，用户看到彻底空白，容易误以为面板坏了）。
    // 改为明确说明变量的可见条件，与调用栈面板的空态语言保持一致。
    el.appendChild(emptyState(
      "debug-alt",
      phase === "idle" ? "未在调试" : "运行中…",
      "变量仅在命中断点暂停时可见",
      true,
    ));
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
    // UI-12：改用统一 emptyState()。原文案把「标题 + 操作指引」挤在一行的括号里，
    // 拆成标题与说明两层后更易扫读；图标用 debug-breakpoint，与编辑器 gutter 里的断点图形呼应。
    el.appendChild(emptyState("debug-breakpoint", "无断点", "点击编辑器行号左侧的空白处添加", true));
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
      // UI-16：可点击 span 补 button 语义 + 键盘激活（行文本 `文件:行号` 即可访问名称）
      label.setAttribute("role", "button");
      label.tabIndex = 0;
      label.addEventListener("click", () => handlers?.openFile(path, line));
      label.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          handlers?.openFile(path, line);
        }
      });
      row.appendChild(label);
      const del = document.createElement("span");
      del.className = "debug-bp-del";
      // UI-09：同 .term-tab-close，span 结构下只统一视觉轨，role/键盘可达性归 UI-16
      // UI-16：已补齐——role=button + aria-label（icon-only，无文本可作名称）+ tabindex + Enter/Space
      del.dataset.tip = "删除断点";
      del.appendChild(codicon("close"));
      del.setAttribute("role", "button");
      del.setAttribute("aria-label", `删除断点 ${basename(path)}:${line}`);
      del.tabIndex = 0;
      const removeBp = (): void => {
        // 删除单行断点：整文件重设剩余行（setBreakpointLines 内部完成同步）
        const rest = getBreakpointLines(path).filter((l) => l !== line);
        setBreakpointLines(path, rest);
        handlers?.refreshGutter();
        renderBreakpoints();
      };
      del.addEventListener("click", removeBp);
      del.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          removeBp();
        }
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
