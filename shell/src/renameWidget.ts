// 就地重命名（P0，对标 PyCharm in-place rename）：
//
// - prepareRename 锚定符号（光标落在注释 / 字符串上给提示，不盲改）；
// - 标识符原地渲染输入框（content widget），当前文件引用位置 ghost 高亮预览；
// - Enter 确认：单文件改动直接写入（零摩擦）；跨文件改动弹出确认摘要
//   「影响 N 个文件 + 各文件命中数」（D-3，2026-09-25 立项）——不展示逐处 diff
//   （原用户决策「不做 diff 预览模态」仍有效），跨文件回滚依赖 Git / 本地历史。
//
// LSP 数据层（锚定 / 请求编辑集 / 应用编辑集）在 lsp/client.ts；本模块只做交互。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app } from "./state";
import {
  fetchRenameAnchor,
  fetchRenameChanges,
  applyRenameChanges,
  fetchReferencesAt,
  waitReferencesStable,
  modelPath,
  type RenameFileEdits,
  type LspReferenceLocation,
} from "./lsp/client";
import { relativePathOrName, samePath } from "./util";
import { toast, toastFail } from "./toast";
import { openConfirm } from "./dialog";
import { setEngineBusy } from "./engineChip";

// ---------- 就地改名 widget（editor content widget） ----------

let active = false; // 防重入（连按 Shift+F6 / F2）
let anchor: MonacoApi.Range | null = null;
let widgetModel: MonacoApi.editor.ITextModel | null = null;
let contentWidget: MonacoApi.editor.IContentWidget | null = null;
let inputEl: HTMLInputElement | null = null;
let countEl: HTMLElement | null = null;
let editorKeys: MonacoApi.IDisposable | null = null;
let ghostDecorations: string[] = [];
let localRefCount = 0;
let crossFileCount = 0;
/** E-2：引用索引是否稳定（false → 提示条与落地后 toast 都会告知「可能不完整」） */
let refsUnstable = false;

function closeWidget(): void {
  active = false;
  editorKeys?.dispose();
  editorKeys = null;
  if (contentWidget) {
    app.editor.removeContentWidget(contentWidget);
    contentWidget = null;
  }
  if (widgetModel && !widgetModel.isDisposed() && ghostDecorations.length > 0) {
    widgetModel.deltaDecorations(ghostDecorations, []);
  }
  ghostDecorations = [];
  widgetModel = null;
  anchor = null;
  inputEl = null;
  countEl = null;
  localRefCount = 0;
  crossFileCount = 0;
}

/** 当前文件引用 ghost 高亮（含定义本身；多行范围跳过） */
async function loadGhostPreview(model: MonacoApi.editor.ITextModel, path: string): Promise<void> {
  const start = anchor?.getStartPosition();
  if (!start) return;
  let refs: LspReferenceLocation[] = [];
  try {
    refs = await fetchReferencesAt(model, start);
  } catch {
    return;
  }
  if (!active || widgetModel !== model || anchor === null) return; // 会话已结束
  applyGhost(model, path, refs);
}

/** 用引用采样结果刷新 ghost 装饰与提示条计数（索引稳定轮询期间反复调用） */
function applyGhost(model: MonacoApi.editor.ITextModel, path: string, refs: LspReferenceLocation[]): void {
  if (!active || widgetModel !== model || anchor === null) return; // 会话已结束
  const decorable = refs.filter((r) => samePath(r.path, path) && r.endLine === r.line);
  localRefCount = decorable.length;
  crossFileCount = new Set(refs.filter((r) => !samePath(r.path, path)).map((r) => r.path)).size;
  const decos = decorable.map((r) => ({
    range: new app.monaco.Range(r.line, r.col, r.endLine, r.endCol),
    options: { inlineClassName: "oc-rename-ghost" },
  }));
  ghostDecorations = model.deltaDecorations(ghostDecorations, decos);
  updateHint();
}

function updateHint(): void {
  if (!countEl) return;
  const base =
    crossFileCount > 0
      ? `本文件 ${localRefCount} 处 · 其他 ${crossFileCount} 个文件`
      : `将更新本文件 ${localRefCount} 处`;
  // E-2：索引未稳定时显式告知（G-3 禁止静默不完整）
  countEl.textContent = refsUnstable ? `${base} · 索引未稳定，结果可能不完整` : base;
}

function buildWidget(): void {
  const host = document.createElement("div");
  host.className = "oc-rename-widget";
  const input = document.createElement("input");
  input.className = "oc-rename-input";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "输入新名称，Enter 确认，Esc 取消");
  const hint = document.createElement("div");
  hint.className = "oc-rename-hint";
  const count = document.createElement("span");
  count.className = "oc-rename-hint-count";
  count.textContent = "计算引用中…";
  const keys = document.createElement("span");
  keys.textContent = "Enter 确认 · Esc 取消";
  hint.append(count, keys);
  host.append(input, hint);
  inputEl = input;
  countEl = count;

  const widget: MonacoApi.editor.IContentWidget = {
    getId: () => "opencharm.renameWidget",
    getDomNode: () => host,
    getPosition: () => {
      if (!anchor) return null;
      return {
        position: anchor.getStartPosition(),
        preference: [app.monaco.editor.ContentWidgetPositionPreference.BELOW, app.monaco.editor.ContentWidgetPositionPreference.ABOVE],
      };
    },
  };
  contentWidget = widget;
  app.editor.addContentWidget(widget);

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void confirmRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeWidget();
      app.editor.focus();
    }
  });
  // 焦点在编辑器时（点回正文）按 Esc 也能收起
  editorKeys = app.editor.onKeyDown((e) => {
    if (e.keyCode === app.monaco.KeyCode.Escape) {
      closeWidget();
      app.editor.focus();
    }
  });
}

async function startSession(): Promise<void> {
  const ed = app.editor;
  const model = ed.getModel();
  const pos = ed.getPosition();
  if (!model || !pos) {
    toast("请先定位到要重命名的符号上", "info");
    return;
  }
  const path = modelPath(model);
  if (!path) {
    toast("请先定位到要重命名的符号上", "info");
    return;
  }
  let a = await fetchRenameAnchor(model, pos);
  if (!a) {
    const word = model.getWordAtPosition(pos);
    if (word) {
      a = { range: new app.monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn), placeholder: word.word };
    }
  }
  if (!a) {
    toast("光标处不是可重命名的符号", "info");
    return;
  }
  active = true;
  anchor = a.range;
  widgetModel = model;
  refsUnstable = false; // E-2：新会话重置稳定性
  buildWidget();
  ed.revealRange(a.range);
  // 预填当前符号名并全选（对齐 PyCharm：直接键入即整体替换）
  if (inputEl) inputEl.value = model.getValueInRange(a.range);
  inputEl?.focus();
  inputEl?.select();
  void loadGhostPreview(model, path);
}

/** Shift+F6 / F2 / 引用面板「重命名」统一入口 */
export async function startRenameAtCursor(): Promise<void> {
  if (active) return;
  await startSession();
}

// ---------- 确认与应用 ----------

let afterRename: (() => void) | null = null;
/** 重命名落盘后的刷新钩子（main.ts 注入：刷新引用面板） */
export function setAfterRenameHandler(fn: () => void): void {
  afterRename = fn;
}

/** 摘要明细的文件数上限（G-1：大工作区跨文件改名不刷出无界列表，超出折叠计数） */
const SUMMARY_MAX_FILES = 10;

/** 纯函数（vitest 直测）：跨文件确认摘要——按命中数降序的「文件 × 处数」明细。
 *  路径展示走 relativePathOrName（工作区内相对路径，越界回落文件名）。 */
export function summarizeRenameTargets(
  files: RenameFileEdits[],
  root: string | null,
  maxFiles = SUMMARY_MAX_FILES,
): { total: number; lines: string[] } {
  const total = files.reduce((n, f) => n + f.edits.length, 0);
  const sorted = [...files].sort((a, b) => b.edits.length - a.edits.length);
  const lines = sorted
    .slice(0, maxFiles)
    .map((f) => `· ${relativePathOrName(root, f.path)} × ${f.edits.length} 处`);
  if (sorted.length > maxFiles) lines.push(`· …以及其他 ${sorted.length - maxFiles} 个文件`);
  return { total, lines };
}

async function confirmRename(): Promise<void> {
  const model = widgetModel;
  const a = anchor;
  const input = inputEl;
  if (!model || !a || !input) return;
  const newName = input.value.trim();
  if (!newName) return;
  if (!/^[A-Za-z_]\w*$/.test(newName)) {
    input.classList.add("is-invalid");
    toast("名称需为合法 Python 标识符（字母 / 下划线开头）", "info");
    return;
  }
  const currentName = model.getValueInRange(a);
  if (newName === currentName) {
    closeWidget();
    app.editor.focus();
    return;
  }
  const start = a.getStartPosition();
  // pyrefly lsp 默认 lazy 索引（打开首文件后才后台建索引）：不等索引稳定就发 rename
  // 只会覆盖已索引文件 → 漏改。先轮询 references 直到连续两次全等（期间实时刷 ghost 计数），
  // 已稳定时只多一次请求（毫秒级）。
  const path = modelPath(model);
  refsUnstable = false;
  setEngineBusy(true); // E-2：稳定采样期间引擎 chip 显示忙碌态
  try {
    await waitReferencesStable(model, start, {
      onSample: (refs) => {
        if (path) applyGhost(model, path, refs);
      },
      onSettled: (stable) => {
        refsUnstable = !stable;
      },
    });
  } finally {
    setEngineBusy(false);
  }
  updateHint(); // E-2：稳定结果落地后刷新提示（含未稳定警示）
  let files: RenameFileEdits[];
  try {
    files = await fetchRenameChanges(model, start, newName);
  } catch (e) {
    toastFail("重命名", e);
    return;
  }
  if (files.length === 0) {
    toast("引擎未返回任何改动", "info");
    return;
  }
  // D-3：跨文件改动显式确认（影响面可见再落盘）；当前文件内改动保持 Enter 即应用（零摩擦）
  const crossFile = path !== null && files.some((f) => !samePath(f.path, path));
  if (crossFile) {
    const { total, lines } = summarizeRenameTargets(files, app.workspaceRoot);
    const ok = await openConfirm({
      title: `跨文件重命名「${currentName}」→「${newName}」`,
      message: `将修改 ${files.length} 个文件共 ${total} 处：\n${lines.join("\n")}${
        refsUnstable ? "\n\n⚠ 工作区索引未稳定，结果可能不完整。" : ""
      }`,
      okLabel: "全部修改",
      kind: "primary",
    });
    if (!ok) {
      closeWidget();
      app.editor.focus();
      return;
    }
  }
  closeWidget();
  app.editor.focus();
  try {
    await applyRenameChanges(model, files);
    const total = files.reduce((n, f) => n + f.edits.length, 0);
    toast(`已重命名「${currentName}」→「${newName}」：${files.length} 个文件 ${total} 处`, "success");
    if (refsUnstable) {
      // E-2：索引未稳定时落地的重命名可能漏改未打开文件——显式提醒复查（G-3）
      toast("工作区索引未稳定，重命名可能漏改未打开的文件——建议稍后用 Alt+F7 复查引用", "info");
    }
    afterRename?.();
  } catch (e) {
    toastFail("重命名", e);
  }
}

// ---------- 初始化 ----------

/** F2 / Shift+F6 就地改名 + 编辑器右键菜单「重命名…」入口（可发现性） */
export function initRenameWidget(editor: MonacoApi.editor.IStandaloneCodeEditor): MonacoApi.IDisposable {
  editor.addCommand(app.monaco.KeyCode.F2, () => void startRenameAtCursor());
  return editor.addAction({
    id: "opencharm.rename",
    label: "重命名…",
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.6,
    run: () => void startRenameAtCursor(),
  });
}
