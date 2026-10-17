// 编辑器 glyph margin 绿箭头（docs/pytest_dev_plan.md §3.4）：
// `def test_*` / `class Test*` 行显示 ▶，点击 = 运行该测试，右键 = 「运行 / 调试此测试」。
//
// 范围界定（同 runGutter 口径）：绿箭头是**补充入口**，不是唯一入口——静态扫描漏检
// （奇异写法）只是没有图标，树行入口与 gutter 菜单照常。免发现依赖：不等 collect，
// 切 tab / 输入即出箭头。
//
// glyph margin 三方协调（断点 > 测试箭头 > run gutter，§3.4）：
// - 被占用行不画箭头：注入 hasBreakpointAt（debugGutter 断点表）+ isRunGutterLine
//   （runGutter 已导出）；点击判定同样先过这两道守卫，杜绝一次点击双动作；
// - 只在测试文件名显示（isTestFileName：test_*.py / *_test.py）。
//
// 防抖 + 指纹短路（§3.10）：onDidChangeModelContent → 200ms 防抖 → 内容指纹与上次
// 相同则短路（inlineDiagnostics 指纹先例）→ scanTestDefs → setDecorations。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, type MonacoModule } from "./state";
import { showMenu } from "./menu";
import { buildTestMenuItems } from "./menuItems";
import { isRunGutterLine } from "./runGutter";
import { getBreakpointSpec, onBreakpointsChanged } from "./debugGutter";
import { buildNodeId, isTestFileName, scanTestDefs, type TestDef } from "./testTreeCore";
import { runTestNodes } from "./testRun";
import { normalizePath } from "./util";

export interface TestGutterHandlers {
  /** 当前是否可运行测试（置灰判定；main 提供，与树行 ▶ 同源） */
  state: () => { canRun: boolean; running: boolean };
}

let handlers: TestGutterHandlers | null = null;
let decorations: MonacoApi.editor.IEditorDecorationsCollection | null = null;
/** 当前文件的测试定义（行 → 节点信息） */
let defs: TestDef[] = [];
/** 当前文件的 relPath（node id 前缀） */
let relPath: string | null = null;
let editorRef: MonacoApi.editor.IStandaloneCodeEditor | null = null;
let monacoRef: MonacoModule | null = null;
/** 内容指纹键（文件路径 + 文本；与上次相同则短路重算，§3.10） */
let lastKey = "";
/** 亮 / 灰态键（canRun:running；repaintTestGutter 短路用） */
let lastStateKey = "";
/** 防抖定时器 */
let debounceTimer: number | null = null;

export function setTestGutterHandlers(h: TestGutterHandlers): void {
  handlers = h;
}

/**
 * 该行是否被测试箭头占用（**三方协调的让位依据**，供 main 注入 debugGutter）。
 *
 * 口径与装饰一致：箭头实际画在「有测试定义 且 未被断点占用」的行上——断点行不画箭头
 * （refreshTestGutter 的 cls 由 hasBreakpointAt 之外的守卫决定，此处同源判定），
 * 故断点行恒 false，debugGutter 照常接管（§3.4：断点 > 测试箭头）。
 */
export function isTestGutterLine(line: number): boolean {
  return defs.some((d) => d.line === line) && !hasBreakpointAt(line);
}

/** 该行是否已有断点（debugGutter 断点表查询；断点优先于测试箭头，§3.4）。 */
function hasBreakpointAt(line: number): boolean {
  const tab = app.activeTab;
  if (!tab) return false;
  return getBreakpointSpec(tab.path, line) !== null;
}

/** 行 → { nodeId, name }（当前文件上下文；未武装时 null）。 */
function testAt(line: number): { nodeId: string; name: string } | null {
  const d = defs.find((x) => x.line === line);
  if (!d || !relPath) return null;
  return { nodeId: buildNodeId(relPath, d.classPath, d.name), name: d.name };
}

export function wireTestGutter(editor: MonacoApi.editor.IStandaloneCodeEditor, monaco: MonacoModule): void {
  editorRef = editor;
  monacoRef = monaco;
  editor.onMouseDown((e) => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const line = e.target.position?.lineNumber;
    if (!line) return;
    // 三方协调守卫：断点与 ▶ 占用的行不响应（同一次点击不得双动作）
    if (isRunGutterLine(line) || hasBreakpointAt(line)) return;
    const hit = testAt(line);
    if (!hit) return;
    const me = e.event;
    if (me.rightButton) {
      const bx = me.browserEvent?.clientX ?? me.posx;
      const by = me.browserEvent?.clientY ?? me.posy;
      showMenu(buildTestMenuItems(hit.nodeId, hit.name), { x: bx, y: by });
      return;
    }
    const st = handlers?.state();
    if (!st || !st.canRun || st.running) return; // 置灰：不触发
    void runTestNodes([hit.nodeId]);
  });
  // 防抖 + 指纹短路（§3.10）：逐 keystroke 触发时 200ms 防抖，内容未变则短路
  editor.onDidChangeModelContent(() => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refreshTestGutter(), 200);
  });
  // 断点增删 → 装饰重算（复核 P2：绘制过滤 hasBreakpointAt 依赖断点表，但断点变更
  // 点只刷新 debugGutter——箭头与红点同格残留/删断点后不复原）。指纹必须失效：
  // 内容没变但过滤结果变了。
  onBreakpointsChanged(() => {
    lastKey = "";
    refreshTestGutter();
  });
}

/** 重算当前文件的绿箭头（切 tab / 内容变化 / 打开文件后调用）。 */
export function refreshTestGutter(): void {
  const editor = editorRef;
  const monaco = monacoRef;
  const tab = app.activeTab;
  // 武装条件：编辑器就绪 + 测试文件 + 有工作区（路径在根内）；否则清空
  if (!editor || !monaco || !tab || !app.workspaceRoot) {
    clearTestGutter();
    return;
  }
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
  const name = tab.path.split(/[\\/]/).pop() ?? "";
  if (!isPy || !isTestFileName(name)) {
    clearTestGutter();
    return;
  }
  // 工作区内归属判定（复核 P2：路径比较走 normalizePath，禁手写 toLowerCase 拼接）。
  // rel 必须从原串切（保留大小写——node id 的文件段要与树/后端逐字匹配）。
  const rootRaw = app.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const absRaw = tab.path.replace(/\\/g, "/");
  if (!normalizePath(absRaw).startsWith(`${normalizePath(rootRaw)}/`)) {
    clearTestGutter();
    return;
  }
  const rel = absRaw.slice(rootRaw.length + 1);
  const text = tab.model.getValue();
  // 指纹短路：同文件同内容不重算（装饰仍在，直接返回）
  const key = `${tab.path}\u0000${text}`;
  if (key === lastKey && decorations) return;
  lastKey = key;
  relPath = rel;
  defs = scanTestDefs(text);
  clearDecorations();
  // 断点占用的行不画箭头（§3.4 三方协调：断点 > 测试箭头），两侧守卫与让位判定同源
  defs = defs.filter((d) => !hasBreakpointAt(d.line));
  if (defs.length === 0) return;
  const st = handlers?.state() ?? { canRun: false, running: false };
  lastStateKey = `${st.canRun}:${st.running}`;
  const cls = st.canRun && !st.running ? "gutter-test" : "gutter-test disabled";
  decorations = editor.createDecorationsCollection(
    defs.map((d) => ({
      range: new monaco.Range(d.line, 1, d.line, 1),
      options: { glyphMarginClassName: cls },
    })),
  );
}

/** 只清装饰（保留指纹与 defs——refresh 的短路路径依赖它们）。 */
function clearDecorations(): void {
  decorations?.clear();
  decorations = null;
}

/** 亮 / 灰态刷新（运行态变化时调用；状态未变则短路，不重算装饰）。 */
export function repaintTestGutter(): void {
  const st = handlers?.state() ?? { canRun: false, running: false };
  const key = `${st.canRun}:${st.running}`;
  if (key === lastStateKey) return; // 状态未变：装饰已在正确档位
  lastStateKey = key;
  lastKey = ""; // 强制重建装饰（换 class）
  refreshTestGutter();
}

/** 清空武装（关闭 tab / 非测试文件 / 无工作区 / 切工作区）。 */
export function clearTestGutter(): void {
  clearDecorations();
  defs = [];
  relPath = null;
  lastKey = "";
  lastStateKey = "";
}
