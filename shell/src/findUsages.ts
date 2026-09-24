// 查找引用结果面板（Alt+F7，对标 PyCharm「Find Usages」工具窗口）+ 重命名入口。
//
// - Alt+F7：全量跨文件引用落底部「引用」标签，按「引用种类」（定义/导入/调用/引用）分组
//   + 顶栏 chips 过滤；点击条目跳转并选中标识符（openRef → main.ts 注入的回调）。
// - Shift+F6 / 面板「重命名」按钮：就地改名入口（renameWidget.ts：prepareRename 锚定 +
//   ghost 预览 + Enter 全部文件一次性写入）。
// 结果树复用全局搜索面板视觉（search-file / search-match / search-hit）；跳转到文件的动作
// 经 main.ts 注入的回调执行（避免本域反向依赖 main.ts 造成循环导入）。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { app, $ } from "./state";
import { setBottomTab } from "./termUi";
import { waitReferencesStable, type LspReferenceLocation } from "./lsp/client";
import { basename, emptyState } from "./util";
import { toast } from "./toast";
import { startRenameAtCursor } from "./renameWidget";

/** 引用种类（启发式归类，对齐 PyCharm Find Usages 的核心分组） */
type RefKind = "definition" | "import" | "call" | "reference";

/** 单个引用：client.Location + 行文本 + 种类 */
interface RefItem extends LspReferenceLocation {
  text: string;
  kind: RefKind;
}

/** 跳转回调（main.ts 注入：打开文件 + 选中标识符 + 居中 + 聚焦） */
let onOpenRef:
  | ((path: string, line: number, col: number, endLine?: number, endCol?: number) => void)
  | null = null;
export function setOpenRefHandler(
  fn: (path: string, line: number, col: number, endLine?: number, endCol?: number) => void,
): void {
  onOpenRef = fn;
}

/** 跳转到某个引用（引用面板 / Code Vision 弹层共用；由 main.ts 注入的回调执行） */
export function openRef(ref: LspReferenceLocation): void {
  onOpenRef?.(ref.path, ref.line, ref.col, ref.endLine, ref.endCol);
}

/** 引用行文本缓存（单次查询内同文件复用） */
const fileLinesCache = new Map<string, string[]>();

async function readLines(path: string): Promise<string[]> {
  const hit = fileLinesCache.get(path);
  if (hit) return hit;
  try {
    const content = await invoke<string>("read_file", { path });
    const lines = content.split(/\r?\n/);
    fileLinesCache.set(path, lines);
    return lines;
  } catch {
    return [];
  }
}

/** 引用行文本（Code Vision 弹层复用；带单次查询内缓存） */
export async function readRefLines(path: string): Promise<string[]> {
  return readLines(path);
}

function panelEl(): HTMLElement {
  return $("find-usages-panel");
}

const KIND_ORDER: RefKind[] = ["definition", "import", "call", "reference"];
const KIND_LABEL: Record<RefKind, string> = {
  definition: "定义",
  import: "导入",
  call: "调用",
  reference: "引用",
};

/** 启发式分类：按行文本 + 符号后字符判定 usage kind */
function classifyRef(it: { text: string; col: number; endCol: number }): RefKind {
  const t = it.text.trimStart();
  if (/^from\s+\S+\s+import\b|^import\s+/.test(t)) return "import";
  if (/^(?:async\s+)?(?:def|class)\s+[A-Za-z_]\w*/.test(t)) return "definition";
  if (it.text[it.endCol - 1] === "(") return "call";
  return "reference";
}

// ---------- 最近一次结果（供 chips 过滤重渲染） ----------

let lastItems: RefItem[] = [];
let activeKind: RefKind | "all" = "all";

function renderRefText(container: HTMLElement, it: RefItem): void {
  const text = it.text;
  const start = it.col - 1;
  const lead = text.length - text.trimStart().length;
  const rel = start - lead;
  const before = rel > 0 ? text.slice(0, Math.min(rel, 60)) : "";
  const hitStart = Math.max(0, rel);
  const hitEnd = Math.min(text.length, hitStart + Math.max(1, it.endCol - it.col));
  const hit = text.slice(hitStart, hitEnd);
  const after = text.slice(hitEnd, hitEnd + 60);
  if (before) container.appendChild(document.createTextNode(before));
  if (hit) {
    const mark = document.createElement("span");
    mark.className = "search-hit";
    mark.textContent = hit;
    container.appendChild(mark);
  }
  if (after) container.appendChild(document.createTextNode(after));
}

function buildRefLine(it: RefItem): HTMLElement {
  const lineEl = document.createElement("div");
  lineEl.className = "search-match";
  lineEl.tabIndex = 0;
  const lineNo = document.createElement("span");
  lineNo.className = "search-line-no";
  lineNo.textContent = String(it.line);
  const textEl = document.createElement("span");
  textEl.className = "search-match-text";
  renderRefText(textEl, it);
  lineEl.append(lineNo, textEl);
  const go = (): void => openRef(it);
  lineEl.addEventListener("click", go);
  lineEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  return lineEl;
}

function buildFileHeader(path: string, total: number): HTMLElement {
  const fileEl = document.createElement("div");
  fileEl.className = "search-file";
  const name = document.createElement("div");
  name.className = "search-file-name";
  name.textContent = `${basename(path)} (${total})`;
  name.title = path;
  fileEl.appendChild(name);
  return fileEl;
}

function buildChip(kind: RefKind | "all", label: string, count: number, active: boolean): HTMLElement {
  const b = document.createElement("button");
  b.className = "fu-chip" + (active ? " active" : "");
  b.dataset.kind = kind;
  b.textContent = `${label} (${count})`;
  b.addEventListener("click", () => {
    activeKind = kind;
    render();
  });
  return b;
}

/** 「重命名」按钮：对上次查询的符号发起跨文件重命名 */
function buildRenameButton(): HTMLElement {
  const b = document.createElement("button");
  b.className = "fu-chip fu-rename-btn";
  b.textContent = "重命名";
  b.title = "重命名此符号及其所有引用（Shift+F6）";
  b.addEventListener("click", () => void renameSymbolAtCursor());
  return b;
}

function buildResults(filter: RefKind | "all"): HTMLElement {
  const root = document.createElement("div");
  const kinds = filter === "all" ? KIND_ORDER : [filter];
  for (const k of kinds) {
    const group = lastItems.filter((i) => i.kind === k);
    if (group.length === 0) continue;
    const kindHeader = document.createElement("div");
    kindHeader.className = "fu-kind-header";
    kindHeader.textContent = `${KIND_LABEL[k]} · ${group.length}`;
    root.appendChild(kindHeader);
    const byFile = new Map<string, RefItem[]>();
    for (const it of group) {
      const arr = byFile.get(it.path) ?? [];
      arr.push(it);
      byFile.set(it.path, arr);
    }
    for (const [path, list] of byFile) {
      root.appendChild(buildFileHeader(path, list.length));
      for (const it of list) root.appendChild(buildRefLine(it));
    }
  }
  return root;
}

function render(): void {
  const panel = panelEl();
  panel.textContent = "";
  const toolbar = document.createElement("div");
  toolbar.className = "find-usages-toolbar";
  toolbar.appendChild(buildChip("all", "全部", lastItems.length, activeKind === "all"));
  for (const k of KIND_ORDER) {
    const n = lastItems.filter((i) => i.kind === k).length;
    if (n > 0) toolbar.appendChild(buildChip(k, KIND_LABEL[k], n, activeKind === k));
  }
  const spacer = document.createElement("span");
  spacer.className = "fu-toolbar-spacer";
  toolbar.appendChild(spacer);
  toolbar.appendChild(buildRenameButton());
  panel.appendChild(toolbar);
  const results = document.createElement("div");
  results.className = "find-usages-results";
  results.appendChild(buildResults(activeKind));
  panel.appendChild(results);
}

function renderEmpty(desc: string): void {
  const el = panelEl();
  el.textContent = "";
  el.appendChild(emptyState("search", "无引用", desc));
}

/** 查询并渲染引用列表（Alt+F7 与重命名后刷新共用） */
export async function queryAndRender(model: MonacoApi.editor.ITextModel, position: MonacoApi.Position): Promise<void> {
  fileLinesCache.clear();
  let refs: LspReferenceLocation[];
  try {
    // 稳定采样：pyrefly lazy 索引推进期间不落瞬时值（已稳定时只多一次请求）
    refs = await waitReferencesStable(model, position, { maxTries: 4, intervalMs: 500 });
  } catch (e) {
    toast(`查找引用失败：${e instanceof Error ? e.message : e}`, "error");
    return;
  }
  if (refs.length === 0) {
    lastItems = [];
    activeKind = "all";
    renderEmpty("光标处符号未找到任何引用");
    setBottomTab("findUsages");
    return;
  }
  const items: RefItem[] = [];
  for (const r of refs) {
    const lines = await readLines(r.path);
    const text = lines[r.line - 1] ?? "";
    items.push({ ...r, text, kind: classifyRef({ text, col: r.col, endCol: r.endCol }) });
  }
  lastItems = items;
  activeKind = "all";
  render();
  setBottomTab("findUsages");
}

/** Alt+F7：查询光标处符号的所有引用并落到底部「引用」面板 */
export async function findUsagesAtCursor(): Promise<void> {
  const editor = app.editor;
  const model = editor.getModel();
  const pos = editor.getPosition();
  if (!model || !pos) {
    toast("请先定位到要查找引用的符号上", "info");
    return;
  }
  await queryAndRender(model, pos);
}

/** 编辑器右键菜单「查找引用」入口（可发现性；键位仍归键位系统 Alt+F7 管） */
export function initFindUsagesAction(editor: MonacoApi.editor.IStandaloneCodeEditor): MonacoApi.IDisposable {
  return editor.addAction({
    id: "opencharm.findUsages",
    label: "查找引用",
    contextMenuGroupId: "navigation",
    contextMenuOrder: 1.7,
    run: () => void findUsagesAtCursor(),
  });
}

/** Shift+F6 / 面板按钮：就地重命名光标处符号（ghost 预览 + 多文件 diff 确认，见 renameWidget.ts） */
export async function renameSymbolAtCursor(): Promise<void> {
  await startRenameAtCursor();
}

/** 清空面板与行缓存（工作区切换 / 关闭时调用） */
export function resetFindUsages(): void {
  fileLinesCache.clear();
  lastItems = [];
  activeKind = "all";
  const el = $("find-usages-panel");
  if (el) el.textContent = "";
}