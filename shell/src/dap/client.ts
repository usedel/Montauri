// DAP 桥 TS 侧（docs/python_debug_dev_plan.md §6.3）：DAP 事件订阅、请求封装、会话状态机。
// Rust 侧（src-tauri/src/dap.rs）持有 TCP 连接并转发帧；本模块只做协议关联与状态分发，
// 与 lsp/client.ts 对称（id 自增 + Promise 表匹配响应 + 事件回调注册）。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ---------- 类型（DAP MVP 子集，§5.3） ----------

/** DAP 消息（Rust 侧原样转发的 JSON 帧） */
export interface DapMessage {
  seq?: number;
  type?: string; // "request" | "response" | "event"
  // request
  command?: string;
  arguments?: unknown;
  // response
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: unknown;
  // event
  event?: string;
  // rust 侧附带的关联 id（dap_send_request 的入参 id，响应匹配用）
  id?: number;
}

export interface DapStackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string };
  line: number;
  column: number;
}

export interface DapScope {
  name: string;
  presentationHint?: string;
  variablesReference: number;
  expensive?: boolean;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface DapThread {
  id: number;
  name: string;
}

export type DebugPhase = "idle" | "starting" | "running" | "stopped" | "exited";

// ---------- 会话状态（§6.5 状态机） ----------

let phase: DebugPhase = "idle";
const phaseListeners: Array<(p: DebugPhase) => void> = [];

export function onPhase(fn: (p: DebugPhase) => void): void {
  phaseListeners.push(fn);
  fn(phase);
}

export function currentPhase(): DebugPhase {
  return phase;
}

function setPhase(p: DebugPhase): void {
  phase = p;
  for (const fn of phaseListeners) fn(p);
}

// ---------- 请求关联（id 自增 + Promise 表） ----------

let nextRequestId = 1;
let nextMsgSeq = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: ReturnType<typeof setTimeout> }>();

/** 请求超时（ms）：正常 DAP 请求远小于此；debugpy 慢启动给足余量 */
const DAP_REQUEST_TIMEOUT_MS = 15_000;

function settlePending(id: number, fn: (p: { resolve: (v: any) => void; reject: (e: any) => void }) => void): void {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  fn(p);
}

/** 发送 DAP 请求，返回 Promise（响应按 request_seq 关联） */
export function request(command: string, arguments_: unknown): Promise<any> {
  const id = nextRequestId++;
  const msgSeq = nextMsgSeq++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settlePending(id, (p) => p.reject(new Error(`DAP 请求超时（${DAP_REQUEST_TIMEOUT_MS / 1000}s）: ${command}`)));
    }, DAP_REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    invoke("dap_send_request", { id: msgSeq, method: command, params: arguments_ ?? {} }).catch((e) => {
      settlePending(id, (p) => p.reject(e));
    });
  });
}

// ---------- 事件分发 ----------

const eventHandlers = new Map<string, (body: any) => void>();

/** 注册 DAP 事件回调（stopped / continued / output / terminated / exited / initialized） */
export function onEvent(event: string, fn: (body: any) => void): void {
  eventHandlers.set(event, fn);
}

// ---------- 生命周期 ----------

let unlistenMessage: UnlistenFn | null = null;
let unlistenExited: UnlistenFn | null = null;
let unlistenStarted: UnlistenFn | null = null;

/** 销毁 DAP 事件监听（与 lsp/client.ts disposeListeners 同语义：测试 teardown / 多窗口场景用） */
export function disposeDapListeners(): void {
  unlistenMessage?.();
  unlistenExited?.();
  unlistenStarted?.();
  unlistenMessage = null;
  unlistenExited = null;
  unlistenStarted = null;
}

/** 事件监听（幂等：只挂一次）。main.ts 启动时调用。 */
export async function wireDapEvents(): Promise<void> {
  if (unlistenMessage) return;

  unlistenMessage = await listen<DapMessage>("dap-message", (e) => {
    const msg = e.payload;
    if (msg.type === "response") {
      // 响应：按 Rust 侧回传的 request_seq（= 我们发请求时的 msgSeq）关联
      const reqId = msg.request_seq ?? -1;
      settlePending(reqId, (p) => {
        if (msg.success === false) {
          p.reject(new Error(msg.message ?? `DAP 请求失败: ${msg.command ?? ""}`));
        } else {
          p.resolve(msg.body);
        }
      });
    } else if (msg.type === "event" && msg.event) {
      // phase 状态机由事件驱动（§6.5）：stopped → "stopped"；continued → "running"；
      // terminated 由后端 debug-exited 收尾（此处不重复置 exited，避免与清场竞态）。
      if (msg.event === "stopped" && phase !== "idle") setPhase("stopped");
      else if (msg.event === "continued" && phase !== "idle") setPhase("running");
      const h = eventHandlers.get(msg.event);
      h?.(msg.body ?? {});
    }
  });

  // 会话结束（debug_stop / debugpy 自然退出 / 崩溃）：拒绝全部 pending + 状态机复位
  unlistenExited = await listen<{ reason: string }>("debug-exited", () => {
    const err = new Error("调试会话已结束");
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    setPhase("exited");
  });

  unlistenStarted = await listen<{ port: number; pid: number | null }>("debug-started", () => {
    setPhase("starting");
  });
}

/**
 * 启动调试会话（stdio adapter 架构，2026-09-10 实测修订）。
 *
 * 时序（全部经真实 debugpy 验证）：
 *   debug_start（Rust spawn stdio adapter）
 *   → initialize
 *   → attach {"listen":{"host":"127.0.0.1","port":0}}（走「server 主动连入」路径，
 *     同时清空 adapter access_token，debuggee 无需鉴权）
 *   → 收 debugpyWaitingForServer {host, port} 事件（adapter 的 server socket 地址）
 *   → debug_attach_debuggee（Rust 在 PTY 里 spawn --connect 的被调试脚本）
 *   → 收 initialized 事件（debuggee 的 pydevd 连入后触发）
 *   → setBreakpoints（回调注入）→ configurationDone → 脚本开始执行
 *
 * 历史教训（v1 设计为何废弃，见 dap.rs 文件头）：--listen 模式在 ConPTY 下
 * debugpy 内部 spawn adapter 不工作（应用内 30s 连不上）；stdio adapter 把
 * adapter 的生命周期移到 Rust 手里，PTY 里只跑被调试脚本本身。
 */
export async function startDebug(
  path: string,
  workspaceRoot: string | null,
  pushBreakpoints: () => Promise<void>,
): Promise<void> {
  await wireDapEvents();
  setPhase("starting");
  await invoke("debug_start", { path, workspaceRoot });

  // initialize 握手
  await request("initialize", {
    clientID: "opencharm",
    clientName: "OpenCharm",
    adapterID: "debugpy",
    locale: "en",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
    supportsVariableType: true,
    supportsRunInTerminalRequest: false,
  });

  // attach（listen 模式）：响应推迟到 configurationDone，发出后不等；
  // 随后 adapter 发 debugpyWaitingForServer 事件携带 server socket 地址
  request("attach", { listen: { host: "127.0.0.1", port: 0 }, justMyCode: true }).catch(() => undefined);

  // 等 debugpyWaitingForServer（server socket 地址）→ 在 PTY 里拉起被调试脚本
  const serverEp = await waitEvent("debugpyWaitingForServer", 30_000);
  const host: string = serverEp?.host ?? "127.0.0.1";
  const port: number = serverEp?.port ?? 0;
  await invoke("debug_attach_debuggee", { path, workspaceRoot, host, port });

  // 等 initialized（debuggee 的 pydevd 连入 adapter 后发出；此后才允许配置）
  await waitInitialized();

  // 推送断点（全部文件，见 §6.4）
  await pushBreakpoints();

  // configurationDone ← 此后脚本开始执行（attach 的响应也在此时回来）
  await request("configurationDone", {});
  setPhase("running");
}

/** 等指定事件一次（携带 body resolve；超时 reject） */
function waitEvent(event: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventHandlers.delete(event);
      reject(new Error(`等待 debugpy ${event} 事件超时`));
    }, timeoutMs);
    eventHandlers.set(event, (body: any) => {
      clearTimeout(timer);
      eventHandlers.delete(event);
      resolve(body);
    });
  });
}

/** 等 initialized 事件（启动时序用；超时 30s：debuggee 连入受系统繁忙影响） */
function waitInitialized(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      eventHandlers.delete("initialized");
      reject(new Error("等待 debugpy initialized 事件超时"));
    }, 30_000);
    eventHandlers.set("initialized", () => {
      clearTimeout(timer);
      eventHandlers.delete("initialized");
      resolve();
    });
  });
}

/** 停止调试会话（Rust 侧杀进程树 + 清理） */
export async function stopDebug(): Promise<void> {
  try {
    await invoke("debug_stop");
  } catch { /* 未启动时忽略 */ }
}

// ---------- DAP 请求封装（MVP 子集，§5.3） ----------

export async function dapThreads(): Promise<DapThread[]> {
  const body = await request("threads", {});
  return body?.threads ?? [];
}

export async function dapStackTrace(threadId: number): Promise<DapStackFrame[]> {
  const body = await request("stackTrace", { threadId });
  return body?.stackFrames ?? [];
}

export async function dapScopes(frameId: number): Promise<DapScope[]> {
  const body = await request("scopes", { frameId });
  return body?.scopes ?? [];
}

export async function dapVariables(variablesReference: number): Promise<DapVariable[]> {
  const body = await request("variables", { variablesReference });
  return body?.variables ?? [];
}

/** 设置单文件断点（§6.4：params = { source: { path }, breakpoints: [{line}] }） */
export async function dapSetBreakpoints(path: string, lines: number[]): Promise<any> {
  return request("setBreakpoints", {
    source: { path },
    breakpoints: lines.map((l) => ({ line: l })),
  });
}

/** 步进控制（§1.1）：继续 / 单步跳过 / 单步进入 / 单步退出 / 暂停 */
export async function dapContinue(threadId: number): Promise<void> {
  await request("continue", { threadId });
  setPhase("running");
}

export async function dapNext(threadId: number): Promise<void> {
  await request("next", { threadId });
}

export async function dapStepIn(threadId: number): Promise<void> {
  await request("stepIn", { threadId });
}

export async function dapStepOut(threadId: number): Promise<void> {
  await request("stepOut", { threadId });
}

/** 状态复位（debug-exited 后 UI 清场用；不触碰后端） */
export function resetDebugState(): void {
  setPhase("idle");
}
