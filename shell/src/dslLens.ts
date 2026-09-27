// 库支持编辑器侧 L1/L2 入口（库特别支持 PR-2，docs/python_library_support_dev_plan.md §4.2）。
// 职责：正则字面量的 CodeLens（🧪 测试正则）/ 高亮装饰 / 静态诊断（opencharm-libs 桶）/
// 右键菜单 / 键位 handler 桥。不动 codeVision.ts 的引用逻辑（D-2：两条并存，Monaco 多 provider 合并）。
// R-1 结论：hover 不注册第二 provider，走 lsp/client.ts 的既有合并管线追加（本模块只提供 regexHoverAt）。

import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { DisposableStore } from "./util";
import { toast } from "./toast";
import {
  offsetToPosition,
  regexHoverMarkdown,
  scanRegexLiterals,
  staticDiagnostics,
  type RegexHit,
} from "./libRegex";
import { formatDiagnostics, formatHoverMarkdown, scanFormatLiterals } from "./libFormat";
import { setPendingRegexRequest } from "./libsBridge";
import { evalKind } from "./libEval";
import type { AstArgsData } from "./scriptArgs";

/** 诊断新桶（与 opencharm-lsp / opencharm-intel / opencharm-ruff 并列；仅 warning/error 两级） */
export const LIBS_OWNER = "opencharm-libs";

/** 面板工具全局 id（= `<pluginId>.<toolId>`，builtin/index.ts manifest 的 regex 项） */
const REGEX_TOOL_ID = "opencharm.builtin.regex";
/** 单文件 lens 上限（D-2） */
const LENS_MAX = 20;
/** 超上限时对「可见区域 + 光标 ±50 行」出 lens（§11.1-3） */
const LENS_WINDOW = 50;
/** 超大文件跳过扫描闸门（R-6：扫描 O(n)，500KB 上限保护极端大文件） */
const MAX_SCAN_CHARS = 500_000;

// ---------- 打开测试器（lens / 右键 / 键位共用） ----------

export function openRegexTester(hit: Pick<RegexHit, "pattern" | "isRaw" | "flags" | "contentStart" | "source">): void {
  setPendingRegexRequest({
    pattern: hit.pattern,
    isRaw: hit.isRaw,
    flags: [...hit.flags],
    contentOffset: hit.contentStart,
    source: hit.source,
  });
  void import("./devtools/index").then((m) => m.openDevTools(REGEX_TOOL_ID));
}

/** 光标处（或光标前最近的）正则字面量 → 打开测试器；找不到给 toast 提示 */
export function openRegexTesterAtCursor(): void {
  const editor = app.editor;
  const model = editor.getModel();
  if (!model || model.getLanguageId() !== "python") {
    toast("正则测试器需要打开一个 Python 文件", "info");
    return;
  }
  const pos = editor.getPosition();
  const text = model.getValue();
  const hits = scanRegexLiterals(text);
  if (hits.length === 0) {
    toast("当前文件未识别到 re 正则字面量", "info");
    return;
  }
  const offset = model.getOffsetAt(pos ?? { lineNumber: 1, column: 1 });
  // 光标所在 hit 优先；否则取光标之前最近的；再否则取第一个
  const hit =
    hits.find((h) => offset >= h.start && offset <= h.end) ??
    [...hits].reverse().find((h) => h.end <= offset) ??
    hits[0]!;
  openRegexTester(hit);
}

/** 面板「替换字面量」写回（I-4：executeEdits 单一撤销粒度，禁 setValue 整文替换）。
 *  contentOffset 变化（用户在源文件上改动过）→ 返回 false 防误写。 */
export function replaceRegexLiteralInEditor(contentOffset: number, source: string, newSource: string): boolean {
  const model = app.editor.getModel();
  if (!model) return false;
  const text = model.getValue();
  if (text.slice(contentOffset, contentOffset + source.length) !== source) return false;
  const s = offsetToPosition(text, contentOffset);
  const e = offsetToPosition(text, contentOffset + source.length);
  app.editor.executeEdits("libs-regex-replace", [
    {
      range: new app.monaco.Range(s.line + 1, s.col + 1, e.line + 1, e.col + 1),
      text: newSource,
    },
  ]);
  app.editor.focus();
  return true;
}

// ---------- hover（lsp/client.ts 合并管线调用；R-1 追加段） ----------

/** 光标若落在正则字面量内 → 返回 hover markdown（否则 null） */
function regexHoverAt(model: MonacoApi.editor.ITextModel, position: MonacoApi.Position): string | null {
  if (app.settings.libs_regex === false) return null;
  const offset = model.getOffsetAt(position);
  const hits = scanRegexLiterals(model.getValue());
  const hit = hits.find((h) => offset >= h.start && offset <= h.end);
  if (!hit) return null;
  return regexHoverMarkdown(hit);
}

/** 光标若落在格式串字面量内 → 返回 hover markdown（否则 null） */
function formatHoverAt(model: MonacoApi.editor.ITextModel, position: MonacoApi.Position): string | null {
  if (app.settings.libs_format === false) return null;
  const offset = model.getOffsetAt(position);
  const hit = scanFormatLiterals(model.getValue()).find((h) => offset >= h.start && offset <= h.end);
  if (!hit) return null;
  return formatHoverMarkdown(hit.mode, hit.fmt);
}

/** 库支持 hover 总入口（正则 + 格式串；PR-2/PR-3 同一管线追加） */
export function libsHoverAt(model: MonacoApi.editor.ITextModel, position: MonacoApi.Position): string | null {
  if (model.getLanguageId() !== "python") return null;
  return regexHoverAt(model, position) ?? formatHoverAt(model, position);
}

// ---------- L1：装饰 + 诊断 ----------

function updateLibsArtifacts(editor: MonacoApi.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  if (!model || model.getLanguageId() !== "python" || app.settings.libs_regex === false) {
    setMarkers(model, []);
    applyDecorations(model, []);
    return;
  }
  const text = model.getValue();
  if (text.length > MAX_SCAN_CHARS) {
    setMarkers(model, []);
    applyDecorations(model, []);
    return;
  }
  const hits = scanRegexLiterals(text);

  // 装饰：只改前景色 + 下划线（§11.3.4，不改字体/背景，避免与主题语法着色打架）
  applyDecorations(model, hits);

  // 诊断：静态检查（正则 + 格式串未知码）→ opencharm-libs 桶
  const markers: MonacoApi.editor.IMarkerData[] = [];
  const pushMarker = (offset: number, message: string, isError: boolean, length: number): void => {
    const p = offsetToPosition(text, offset);
    markers.push({
      severity: isError ? app.monaco.MarkerSeverity.Error : app.monaco.MarkerSeverity.Warning,
      message,
      startLineNumber: p.line + 1,
      startColumn: p.col + 1,
      endLineNumber: p.line + 1,
      endColumn: p.col + 1 + Math.max(1, length),
      source: LIBS_OWNER,
    });
  };
  for (const hit of hits) {
    for (const d of staticDiagnostics(hit.source, hit.isRaw)) {
      // diag.pos 是 pattern 值内位置；非 raw 串的转义诊断落在源码 contentStart + pos（近似定位）
      const offset = Math.min(hit.contentStart + d.pos, Math.max(hit.end - 1, hit.contentStart));
      pushMarker(offset, d.message, d.severity === "error", d.length);
    }
  }
  if (app.settings.libs_format !== false) {
    for (const hit of scanFormatLiterals(text)) {
      for (const d of formatDiagnostics(hit.mode, hit.fmt)) {
        pushMarker(hit.contentStart + d.pos, d.message, false, d.length);
      }
    }
  }
  setMarkers(model, markers);
}

function setMarkers(model: MonacoApi.editor.ITextModel | null, markers: MonacoApi.editor.IMarkerData[]): void {
  if (!model) return;
  app.monaco.editor.setModelMarkers(model, LIBS_OWNER, markers);
}

// ---------- L2：CodeLens ----------

/** argparse 参数计数缓存（key = uri:version）；负缓存也存（解析失败 / 无参数文件不再重复 spawn） */
const argsCountCache = new Map<string, Promise<number | null>>();
let lastArgsComputeAt = 0;

function modelPathOf(model: MonacoApi.editor.ITextModel): string | null {
  return (model as unknown as { __opencharmPath?: string }).__opencharmPath ?? null;
}

/** 参数计数（py_eval ast_argparse；节流 1.5s 防键入期连续 spawn；缓存上限 20 版本） */
function argsCountFor(model: MonacoApi.editor.ITextModel): Promise<number | null> {
  const key = `${model.uri.toString()}:${model.getVersionId()}`;
  const hit = argsCountCache.get(key);
  if (hit) return hit;
  const now = Date.now();
  if (now - lastArgsComputeAt < 1500) return Promise.resolve(null); // 节流：本轮不出 lens，下次变更再算
  lastArgsComputeAt = now;
  const p = (async (): Promise<number | null> => {
    if (app.settings.libs_argparse === false || !app.workspaceRoot) return null;
    const path = modelPathOf(model);
    if (!path) return null;
    try {
      const code = await invoke<string>("read_file", { path });
      const res = await evalKind<AstArgsData>("ast_argparse", { code }, { workspaceRoot: app.workspaceRoot });
      if (res.state !== "ok" || !res.data?.params) return null;
      return res.data.params.length;
    } catch {
      return null;
    }
  })();
  argsCountCache.set(key, p);
  while (argsCountCache.size > 20) {
    const oldest = argsCountCache.keys().next().value;
    if (oldest === undefined) break;
    argsCountCache.delete(oldest);
  }
  return p;
}

function openArgsLensTarget(model: MonacoApi.editor.ITextModel): void {
  const path = modelPathOf(model) ?? app.activeTab?.path ?? undefined;
  void import("./runConfigPanel").then((m) => m.openRunConfig(path, true));
}

export function initDslLens(editor: MonacoApi.editor.IStandaloneCodeEditor): MonacoApi.IDisposable {
  const store = new DisposableStore();

  // 手写微型 emitter（codeVision 同款）：内容变更 / 换文件 / 设置变化 → 刷新
  let listeners: Array<(e: MonacoApi.languages.CodeLensProvider) => void> = [];
  const fire = (delay = 300): void => {
    window.clearTimeout(fireTimer);
    fireTimer = window.setTimeout(() => {
      updateLibsArtifacts(editor); // 装饰 + opencharm-libs 诊断随 lens 同步刷新
      for (const l of listeners) l(provider);
    }, delay);
  };
  let fireTimer = 0;
  const onDidChange = (l: (e: MonacoApi.languages.CodeLensProvider) => void): MonacoApi.IDisposable => {
    listeners.push(l);
    return { dispose: () => (listeners = listeners.filter((x) => x !== l)) };
  };

  const commandId = editor.addCommand(0, (_ctx, hit: RegexHit) => {
    openRegexTester(hit);
  });
  const argsCommandId = editor.addCommand(0, (_ctx, modelRef: MonacoApi.editor.ITextModel) => {
    openArgsLensTarget(modelRef);
  });

  const provider: MonacoApi.languages.CodeLensProvider = {
    onDidChange,
    async provideCodeLenses(model) {
      if (app.settings.libs_editor_lens === false) return { lenses: [], dispose: () => undefined };
      if (model.getLanguageId() !== "python" || model.getValue().length > MAX_SCAN_CHARS) {
        return { lenses: [], dispose: () => undefined };
      }
      const lenses: MonacoApi.languages.CodeLens[] = [];
      // 正则 lens（libs_regex 开关；D-2：与引用 lens 并存，[工具][引用] 顺序由 provider 注册序决定）
      if (app.settings.libs_regex !== false) {
        const hits = scanRegexLiterals(model.getValue());
        // 单行聚合（同一行多个 re 调用只出一条 lens）
        const byLine = new Map<number, RegexHit>();
        for (const h of hits) {
          const prev = byLine.get(h.callLine);
          if (!prev || h.start < prev.start) byLine.set(h.callLine, h);
        }
        let entries = [...byLine.entries()].sort((a, b) => a[0] - b[0]);
        // 超上限：收敛到可见区域 + 光标 ±50 行（§11.1-3）
        if (entries.length > LENS_MAX) {
          const visible = new Set<number>();
          for (const r of editor.getVisibleRanges()) {
            for (let ln = r.startLineNumber; ln <= r.endLineNumber; ln++) visible.add(ln);
          }
          const cursor = editor.getPosition()?.lineNumber ?? 1;
          const windowed = entries.filter(([ln]) => visible.has(ln + 1) || Math.abs(ln + 1 - cursor) <= LENS_WINDOW);
          entries = (windowed.length ? windowed : entries).slice(0, LENS_MAX);
        }
        for (const [line, hit] of entries) {
          lenses.push({
            range: { startLineNumber: line + 1, startColumn: 1, endLineNumber: line + 1, endColumn: 1 },
            command: commandId
              ? { id: commandId, title: "🧪 测试正则", arguments: [hit] }
              : undefined,
          });
        }
      }
      // 参数 lens（libs_argparse 开关；文件顶部「⚙ N 个参数」→ 打开运行面板聚焦参数区，D-3）
      if (app.settings.libs_argparse !== false && argsCommandId) {
        const count = await argsCountFor(model);
        if (count !== null && count > 0) {
          lenses.push({
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            command: { id: argsCommandId, title: `⚙ ${count} 个参数`, arguments: [model] },
          });
        }
      }
      return { lenses, dispose: () => undefined };
    },
    resolveCodeLens(_model, lens) {
      return lens;
    },
  };
  store.add(app.monaco.languages.registerCodeLensProvider("python", provider));

  // 装饰 + 诊断刷新（防抖 300ms，与 lens 同步）
  store.add(editor.onDidChangeModelContent(() => fire()));
  store.add(
    editor.onDidChangeModel(() => {
      fire(0);
    }),
  );

  // 右键菜单「在正则测试器中打开」（findUsages.ts 样板；导航组，查找引用之后）
  store.add(
    editor.addAction({
      id: "opencharm.openRegexTester",
      label: "在正则测试器中打开",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.8,
      run: () => openRegexTesterAtCursor(),
    }),
  );

  store.add({
    dispose: () => {
      window.clearTimeout(fireTimer);
      setMarkers(app.editor.getModel(), []);
      applyDecorations(app.editor.getModel(), []);
    },
  });

  // 首次挂载立即计算一轮
  fire(0);
  return store;
}

// ---------- 装饰实现 ----------

interface DecoStore {
  model: MonacoApi.editor.ITextModel | null;
  collection: MonacoApi.editor.IEditorDecorationsCollection | null;
}
const decoStore: DecoStore = { model: null, collection: null };

function applyDecorations(model: MonacoApi.editor.ITextModel | null, hits: RegexHit[]): void {
  if (decoStore.model !== model) {
    decoStore.collection = null; // 换模型：旧 collection 属于旧 model，作废重建
    decoStore.model = model;
  }
  if (!model) {
    decoStore.collection?.clear();
    return;
  }
  const text = model.getValue();
  const decos: MonacoApi.editor.IModelDeltaDecoration[] = hits.map((h) => {
    const s = offsetToPosition(text, h.start);
    const e = offsetToPosition(text, h.end);
    return {
      range: new app.monaco.Range(s.line + 1, s.col + 1, e.line + 1, e.col + 1),
      options: { inlineClassName: "oc-regex-literal", stickiness: 1 /* NeverGrowsWhenTypingAtEdges */ },
    };
  });
  if (!decoStore.collection) {
    decoStore.collection = app.editor.createDecorationsCollection(decos);
  } else {
    decoStore.collection.set(decos);
  }
}
