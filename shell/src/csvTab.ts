// CSV 数据查看 Tab（VS Code 插件调研报告 借鉴-4 · 对标 Rainbow CSV / SQLite Viewer）。
//
// 形态：kind="csv" 的**只读** Tab，path 前缀 `csvtab:<绝对路径>`（照 mdpreview:/db-data:/diff:
// 先例——session 快照只收 kind="file"（session.ts:73），重启后自然消失；run gutter / quickopen
// 等按 path 工作的逻辑天然不误伤）。
//
// 宿主：#csv-tab-panel 是 #editor-row 内与 #editor 互斥的浮层（照 #md-preview-tab-panel 范式），
// 与 diff / db / md 宿主四方互斥（dismiss 链见 virtualTabs.ts 与 main.ts 的 activateTab）。
//
// 渲染：**复用 sqliteGrid 的 buildGridTable**（B3 的虚拟化表格 / 列筛选 / 复制整行一并复用，
// 报告「落点」明确要求），本模块只负责「文件 → DbQueryResult 形状」的适配。
//
// 纪律（改动前先读）：
// - 零第三方依赖：解析走 csvCore.ts 自研状态机（ADR-0010 体积红线）；
// - 只读：不写文件、不落库、不进 LSP / 诊断 / 脏标记链（tab.model 是占位模型）；
// - 行数上限 CSV_MAX_ROWS（10 000，与 Rust db_cmds::HARD_MAX_ROWS 同口径），超出截断并提示；
// - 编码只承诺 UTF-8 / BOM，其余**显式提示不猜测**（csvCore::isUtf8Decodable）。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, $, type Tab } from "./state";
import { t } from "./i18n";
import { CSV_MAX_ROWS, isUtf8Decodable, parseCsv, stripBom } from "./csvCore";
import { buildGridTable, statusText, type DbQueryResult } from "./sqliteGrid";

// ---------- 命名空间 ----------

export const CSV_TAB_PREFIX = "csvtab:";

export function csvSourcePath(tabPath: string): string {
  return tabPath.slice(CSV_TAB_PREFIX.length);
}

export function csvTabPath(srcPath: string): string {
  return CSV_TAB_PREFIX + srcPath;
}

/** 是否按 CSV 查看器打开（扩展名判定；纯函数便于单测） */
export function isCsvPath(p: string): boolean {
  return /\.csv$/i.test(p);
}

export function findCsvTab(srcPath: string): Tab | undefined {
  const p = csvTabPath(srcPath);
  return app.tabs.find((x) => x.kind === "csv" && x.path === p);
}

// ---------- handlers 注入（main → 本模块；避免循环 import） ----------

export interface CsvTabHandlers {
  activateTab: (tab: Tab) => void;
  /** 「以文本编辑」：绕过 CSV 查看器直接开编辑 Tab（openFile 走 csvMode:"edit"） */
  openFile: (path: string) => Promise<void>;
  /** 建占位模型（主编辑器 Monaco 实例的唯一真源） */
  createModel: (path: string) => MonacoApi.editor.ITextModel;
}

let handlers: CsvTabHandlers | null = null;

export function setCsvTabHandlers(h: CsvTabHandlers): void {
  handlers = h;
}

// ---------- 打开 / 提升 ----------

export function openCsvTab(srcPath: string): void {
  if (!handlers) return;
  const existing = findCsvTab(srcPath);
  if (existing) {
    handlers.activateTab(existing);
    return;
  }
  const tab: Tab = { path: csvTabPath(srcPath), model: handlers.createModel(srcPath), dirty: false, kind: "csv" };
  app.tabs.push(tab);
  handlers.activateTab(tab);
}

/** 「以文本编辑」：关查看 Tab → 开编辑 Tab（openFile 已绑定 csvMode:"edit"） */
export async function promoteCsvToEdit(srcPath: string): Promise<void> {
  const tab = findCsvTab(srcPath);
  if (tab) closeCsvTabQuiet(tab);
  await handlers?.openFile(srcPath);
}

function closeCsvTabQuiet(tab: Tab): void {
  const idx = app.tabs.indexOf(tab);
  if (idx !== -1) app.tabs.splice(idx, 1);
  cleanupCsvTab(tab);
}

// ---------- 宿主呈现（virtualTabs::presentVirtualTab 调用） ----------

let panelBuilt = false;
let renderToken = 0;

/** 激活 CSV Tab：显示宿主、隐藏 #editor，重读文件重渲染（外部修改可见，照 db tab 先例）。 */
export async function presentCsvTab(tab: Tab): Promise<void> {
  ensurePanel();
  const src = csvSourcePath(tab.path);
  $("csv-tab-panel")?.classList.remove("hidden");
  $("editor")?.classList.add("hidden");
  const token = ++renderToken;
  const body = $("csv-tab-body");
  const status = $("csv-tab-status");
  if (!body || !status) return;

  let bytes: Uint8Array;
  try {
    bytes = b64ToBytes(await invoke<string>("read_file_base64", { path: src }));
  } catch {
    if (token === renderToken) renderMessage(t("csv.readFailed"));
    return;
  }
  if (!isUtf8Decodable(bytes)) {
    // 编码不猜测：只承诺 UTF-8 / BOM，其余显式提示（猜错比不显示更糟）
    if (token === renderToken) renderMessage(t("csv.decodeFailed"));
    return;
  }
  if (token !== renderToken) return; // 已切走：丢弃过期渲染
  const table = parseCsv(stripBom(new TextDecoder("utf-8").decode(bytes)), CSV_MAX_ROWS);
  if (table.columns.length === 0) {
    renderMessage(t("csv.empty"));
    return;
  }
  const result: DbQueryResult = {
    columns: table.columns,
    rows: table.rows,
    total: table.total,
    offset: 0,
    truncated: table.truncated,
    elapsedMs: 0,
    affected: null,
  };
  status.textContent = statusText({ result, writable: false, querying: false, cancelling: false });
  body.textContent = "";
  const grid = buildGridTable(result, { offset: 0 }); // 表头不可点：只读内存数据，无后端排序
  body.appendChild(grid ?? emptyEl());
}

export function dismissCsvHost(): void {
  $("csv-tab-panel")?.classList.add("hidden");
}

export function cleanupCsvTab(tab: Tab): void {
  renderToken++; // 作废在途渲染
  tab.model.dispose();
  if (!app.tabs.some((x) => x.kind === "csv")) dismissCsvHost();
}

// ---------- Tab 标题 / 图标 ----------

export function csvTabLabel(tab: Tab): string {
  const src = csvSourcePath(tab.path);
  return `${src.split(/[\\/]/).pop() || src} ${t("csv.labelSuffix")}`;
}

export function csvTabIcon(): string {
  return "table";
}

// ---------- 共享 DOM（单面板，多 Tab 复用；照 db-tab-panel 惰性构建） ----------

function ensurePanel(): void {
  if (panelBuilt) return;
  panelBuilt = true;
  const panel = $("csv-tab-panel");
  if (!panel) return; // 测试环境无 DOM：静默
  panel.textContent = "";
  const bar = document.createElement("div");
  bar.className = "csv-tab-toolbar";
  const editBtn = document.createElement("button");
  editBtn.className = "btn btn--sm";
  editBtn.appendChild(codicon("edit"));
  const label = document.createElement("span");
  label.textContent = t("csv.editSource");
  editBtn.appendChild(label);
  editBtn.addEventListener("click", () => {
    const cur = app.activeTab;
    if (cur && cur.kind === "csv") void promoteCsvToEdit(csvSourcePath(cur.path));
  });
  bar.appendChild(editBtn);
  const status = document.createElement("span");
  status.id = "csv-tab-status";
  status.className = "csv-tab-status";
  bar.appendChild(status);
  panel.appendChild(bar);
  const body = document.createElement("div");
  body.id = "csv-tab-body";
  body.className = "csv-tab-body";
  panel.appendChild(body);
}

function renderMessage(msg: string): void {
  const body = $("csv-tab-body");
  const status = $("csv-tab-status");
  if (status) status.textContent = "";
  if (!body) return;
  body.textContent = "";
  body.appendChild(emptyEl(msg));
}

function emptyEl(msg = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = "csv-empty";
  el.textContent = msg || t("csv.empty");
  return el;
}

/** 极简 codicon（与 util.ts::codicon 同形；本模块不引 util 以免拉进其 DOM 依赖链） */
function codicon(name: string): HTMLElement {
  const i = document.createElement("i");
  i.className = `codicon codicon-${name}`;
  i.setAttribute("aria-hidden", "true");
  return i;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
