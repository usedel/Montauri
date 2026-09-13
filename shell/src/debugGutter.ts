// 调试断点 gutter（docs/python_debug_dev_plan.md §6.4）：glyphMargin 红点装饰 + 点击切换。
// 复用 runGutter.ts 的装饰/命中范式，但独立一套装饰集合（勿与 run gutter 冲突）。
//
// 断点数据源：模块级 Map<filePath, Map<lineNumber, BreakpointSpec>>；调试会话期间同步到
// debugger（setBreakpoints 请求），停止调试后断点表保留（下次调试自动重放，D3 验收项）。
//
// P0（PyCharm 调研 N/D2/D3）：断点不再只有行号——每行可挂 condition / hitCondition /
// logMessage 三个 DAP 原生字段（见 dap/client.ts 的 BreakpointSpec 注释）。
// 数据结构由 Set<line> 升级为 Map<line, spec>：**空 spec 即普通断点**，
// 故既有「只有行号」的调用方（getBreakpointLines / setBreakpointLines）语义不变。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, type MonacoModule } from "./state";
import * as dap from "./dap/client";
import type { BreakpointKind, BreakpointSpec, DapSourceBreakpoint } from "./dap/client";

/** 断点表：文件路径 → 行号 → 高级属性（空对象 = 普通断点）。模块级持久（跨会话保留，D3 验收）。 */
const breakpoints = new Map<string, Map<number, BreakpointSpec>>();

let decorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;
let editorRef: MonacoApi.editor.IStandaloneCodeEditor | null = null;
let monacoRef: MonacoModule | null = null;

/**
 * 「该行是否被 runGutter 的 ▶ 占用」判定，由 main.ts 注入（`runGutter.isRunGutterLine`）。
 * 走注入而非直接 import runGutter：避免把 runGutter → menu 的传递依赖带进本模块
 * （menu.ts 在模块顶层注册 document 级监听，测试环境会因缺 #ctx-menu 抛错）。
 * 未注入时恒 false（不过滤），此时本模块的 glyph 点击也不会被 wire 上，行为不受影响。
 */
let isRunLine: (line: number) => boolean = () => false;

/** 断点表变更回调（debugView 注册：gutter 点击 / 列表删除后刷新侧栏断点列表） */
let onChange: (() => void) | null = null;

/** 注册断点表变更回调（幂等：后者覆盖前者） */
export function setBreakpointsChangeCallback(cb: (() => void) | null): void {
  onChange = cb;
}

function notifyChange(): void {
  onChange?.();
}

/** 取某文件断点行（排序副本） */
export function getBreakpointLines(path: string): number[] {
  const map = breakpoints.get(path);
  if (!map) return [];
  return [...map.keys()].sort((a, b) => a - b);
}

/** 取某文件全部断点（含高级属性，按行排序；setBreakpoints 推送用） */
export function getBreakpoints(path: string): DapSourceBreakpoint[] {
  return getBreakpointLines(path).map((line) => ({ line, ...(breakpoints.get(path)?.get(line) ?? {}) }));
}

/** 取单个断点的高级属性；该行无断点返回 null */
export function getBreakpointSpec(path: string, line: number): BreakpointSpec | null {
  return breakpoints.get(path)?.get(line) ?? null;
}

/** 断点类型判定（gutter 图标与断点列表徽标共用）：log 优先于 condition */
export function breakpointKind(spec: BreakpointSpec | null): BreakpointKind {
  if (!spec) return "plain";
  if (spec.logMessage) return "log";
  if (spec.condition || spec.hitCondition) return "condition";
  return "plain";
}

/** 全部断点文件路径（会话启动时批量推送用，§5.3 启动时序） */
export function breakpointFiles(): string[] {
  return [...breakpoints.keys()];
}

/** 是否存在任一断点 */
export function hasAnyBreakpoint(): boolean {
  for (const map of breakpoints.values()) {
    if (map.size > 0) return true;
  }
  return false;
}

/** 切换断点（gutter 点击）；返回切换后的状态（true = 已设断点） */
export function toggleBreakpoint(path: string, line: number): boolean {
  let map = breakpoints.get(path);
  if (!map) {
    map = new Map();
    breakpoints.set(path, map);
  }
  if (map.has(line)) {
    map.delete(line);
    if (map.size === 0) breakpoints.delete(path);
    syncBreakpointsToDebugger(path);
    notifyChange();
    return false;
  }
  map.set(line, {});
  syncBreakpointsToDebugger(path);
  notifyChange();
  return true;
}

/** 清空某文件全部断点 */
export function clearBreakpoints(path: string): void {
  if (!breakpoints.has(path)) return;
  breakpoints.delete(path);
  syncBreakpointsToDebugger(path);
  notifyChange();
}

/** 删除单行断点（断点列表删除按钮 / 右键菜单用） */
export function removeBreakpoint(path: string, line: number): void {
  const map = breakpoints.get(path);
  if (!map?.has(line)) return;
  map.delete(line);
  if (map.size === 0) breakpoints.delete(path);
  syncBreakpointsToDebugger(path);
  notifyChange();
}

/**
 * 直接设置某文件的断点行集合（断点列表删除单行用；完成后同步到 debugger）。
 * 保留仍在列表中的行原有的高级属性——删除单行不该把同文件其它条件断点清成普通断点。
 */
export function setBreakpointLines(path: string, lines: number[]): void {
  if (lines.length === 0) {
    breakpoints.delete(path);
  } else {
    const old = breakpoints.get(path);
    const next = new Map<number, BreakpointSpec>();
    for (const l of lines) next.set(l, old?.get(l) ?? {});
    breakpoints.set(path, next);
  }
  syncBreakpointsToDebugger(path);
  notifyChange();
}

/** 写入/合并单个断点的高级属性（行上无断点时自动创建）；传 null spec 即清空为普通断点 */
export function updateBreakpoint(path: string, line: number, spec: BreakpointSpec | null): void {
  let map = breakpoints.get(path);
  if (!map) {
    map = new Map();
    breakpoints.set(path, map);
  }
  map.set(line, spec ?? {});
  syncBreakpointsToDebugger(path);
  notifyChange();
}

/**
 * 同步单文件断点到 debugger（§6.4：断点变化 → setBreakpoints）。
 * 仅在会话存活期间发送（starting/running/stopped 均可：暂停态增删断点同样生效）。
 */
export async function syncBreakpointsToDebugger(path: string): Promise<void> {
  const phase = dap.currentPhase();
  if (phase === "idle" || phase === "exited") return;
  try {
    await dap.dapSetBreakpoints(path, getBreakpoints(path));
  } catch (e) {
    console.warn("[debugGutter] setBreakpoints 失败:", e);
  }
}

/** 全量重放断点（会话启动时 configurationDone 之前调用，§5.3 启动时序） */
export async function pushAllBreakpoints(): Promise<void> {
  for (const path of breakpointFiles()) {
    try {
      await dap.dapSetBreakpoints(path, getBreakpoints(path));
    } catch (e) {
      console.warn("[debugGutter] setBreakpoints（重放）失败:", e);
    }
  }
}

/**
 * 断点 gutter 右键菜单回调（由 main.ts 注入）。
 * 走注入而非直接 import menu.ts：menu.ts 在模块顶层解析 #ctx-menu（lazyEl 取不到即抛），
 * 本模块被断点相关单测直接 import —— 未注入时右键静默无动作，测试与生产行为都不受影响。
 */
let onContextMenu: ((path: string, line: number, x: number, y: number) => void) | null = null;

/** 注册断点右键菜单回调（幂等：后者覆盖前者） */
export function setBreakpointMenuHandler(
  fn: ((path: string, line: number, x: number, y: number) => void) | null,
): void {
  onContextMenu = fn;
}

export function wireDebugGutter(
  editor: MonacoApi.editor.IStandaloneCodeEditor,
  monaco: MonacoModule,
  isRunGutterLine: (line: number) => boolean,
): void {
  editorRef = editor;
  monacoRef = monaco;
  isRunLine = isRunGutterLine;
  // glyphMargin 点击切换断点（仅 .py/.pyw，与 runGutter 一致；§6.4）
  editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = e.target.position?.lineNumber;
    if (!line) return;
    const tab = app.activeTab;
    if (!tab) return;
    const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
    if (!isPy) return;
    // ▶ 占用的守卫行由 runGutter 的同类 handler 处理；Monaco onMouseDown 多订阅不可阻断，
    // 故此处显式让出，否则同一次点击会「既运行又设断点」，红点装饰还会盖掉 ▶（方案 A）。
    if (isRunLine(line)) return;
    // 右键 → 断点菜单（P0：条件断点 / 命中次数 / Logpoint）。
    // 不切换断点状态：右键是「设置」语义，误触不应删掉已有断点。
    // 坐标取法与 runGutter 一致：优先浏览器原生 clientX/Y（视口坐标，与 menu.ts 的
    // innerWidth/innerHeight 收敛同基准），Monaco 的 posx/posy（页面坐标）仅作兜底。
    if (e.event.rightButton) {
      const bx = e.event.browserEvent?.clientX ?? e.event.posx;
      const by = e.event.browserEvent?.clientY ?? e.event.posy;
      onContextMenu?.(tab.path, line, bx, by);
      return;
    }
    toggleBreakpoint(tab.path, line);
    refreshDebugGutter();
  });
}

/** 断点类型 → glyph 装饰类名（普通红点 / 条件红点带问号 / Logpoint 菱形） */
function breakpointGlyphClass(spec: BreakpointSpec | null): string {
  switch (breakpointKind(spec)) {
    case "log":
      return "gutter-breakpoint gutter-breakpoint-log";
    case "condition":
      return "gutter-breakpoint gutter-breakpoint-cond";
    default:
      return "gutter-breakpoint";
  }
}

/** 重算当前文件的断点红点装饰（切 tab / 内容变化 / 断点切换后调用） */
export function refreshDebugGutter(): void {
  clearDebugGutter();
  const editor = editorRef;
  const monaco = monacoRef;
  if (!editor || !monaco) return;
  const tab = app.activeTab;
  if (!tab) return;
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
  if (!isPy) return;
  // 过滤掉 ▶ 占用的守卫行：断点表跨会话持久，若有历史断点落在该行，
  // 其红点装饰会压过 ▶（style.css 中 .gutter-breakpoint::after 书写在后），故不渲染。
  const bps = getBreakpoints(tab.path).filter((b) => !isRunLine(b.line));
  if (bps.length === 0) return;
  decorations = editor.createDecorationsCollection(
    bps.map((b) => ({
      range: new monaco.Range(b.line, 1, b.line, 1),
      options: {
        glyphMarginClassName: breakpointGlyphClass(b),
        // 悬停可见条件/日志内容（gutter 空间有限，全文交给 tooltip）
        glyphMarginHoverMessage: { value: breakpointHoverText(b) },
      },
    })),
  );
}

/** 断点悬停文本（gutter hover）：条件 / 命中次数 / Logpoint 消息 */
function breakpointHoverText(b: DapSourceBreakpoint): string {
  const parts: string[] = [];
  if (b.condition) parts.push(`条件：${b.condition}`);
  if (b.hitCondition) parts.push(`命中次数：${b.hitCondition}`);
  if (b.logMessage) parts.push(`日志（不断下）：${b.logMessage}`);
  if (parts.length === 0) return "断点";
  return parts.join("\n\n");
}

/** 清空断点装饰（关闭 tab / 非 .py / 切工作区；断点表数据不动） */
export function clearDebugGutter(): void {
  decorations?.clear();
  decorations = null;
}

/** 关闭文件：若该文件无断点则无操作；有断点保留（表跨会话持久），仅清装饰 */
export function onFileClosed(path: string): void {
  void path; // 断点表保留（D3 验收：停止调试后断点表保留，下次自动重放）
}

// ---------- 当前行高亮（§6.5：stopped 事件 → current-line 装饰） ----------

let currentLineDecorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;

/** 标示当前执行行（每次 stopped 先 clear 再设，§6.4/D4） */
export function highlightCurrentLine(path: string, line: number): void {
  clearCurrentLine();
  const editor = editorRef;
  const monaco = monacoRef;
  if (!editor || !monaco) return;
  const tab = app.activeTab;
  if (!tab || tab.path !== path) return; // 只高亮当前打开的文件
  currentLineDecorations = editor.createDecorationsCollection([
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: "debug-current-line",
        linesDecorationsClassName: "debug-current-line-margin",
        overviewRuler: { color: "#F5C518", position: monaco.editor.OverviewRulerLane.Center },
      },
    },
  ]);
}

/** 清除当前行高亮（继续执行 / 会话结束时） */
export function clearCurrentLine(): void {
  currentLineDecorations?.clear();
  currentLineDecorations = null;
}
