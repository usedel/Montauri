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
// - 编码只承诺 UTF-8 / BOM，其余**显式提示不猜测**（fatal 解码，失败即提示）；
// - **前缀读取**（2026-10-11 修复大文件假死）：read_file_base64 只取前 CSV_READ_CAP 字节
//   （1 万行的宽表也用不满），整读几十 MB 再 base64 全量过 IPC 是假死数秒的主因；
// - **分页渲染**：buildGridTable 是全量 DOM 表（无虚拟化），1 万行一次上屏同样秒级卡顿，
//   照 db Tab 先例按 CSV_PAGE_SIZE 分页（翻页是内存切片，不重读文件）。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, $, type Tab } from "./state";
import { t } from "./i18n";
import { toast } from "./toast";
import { CSV_MAX_ROWS, parseCsv, stripBom, type CsvTable } from "./csvCore";
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
  /** 「以文本编辑」：绕过 CSV 查看器直接开编辑 Tab（openFile 走 csvMode:"edit"）。
   *  返回是否成功——失败（超 10MB read_file 守卫 / 非 UTF-8）时调用方必须保留查看 Tab。 */
  openFile: (path: string) => Promise<boolean>;
  /** 建占位模型（主编辑器 Monaco 实例的唯一真源） */
  createModel: (path: string) => MonacoApi.editor.ITextModel;
  /** tabbar 重渲染（关 Tab 只动数组；提升路径反转顺序后没有后续 activateTab 兜底重渲染） */
  renderTabs: () => void;
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

/** 「以文本编辑」：开编辑 Tab → **成功后**才关查看 Tab（openFile 已绑定 csvMode:"edit"）。
 *  顺序敏感：反过来（先关再开）一旦打开失败——超 10MB read_file 守卫 / 非 UTF-8——
 *  查看 Tab 已被移除且无人恢复 #editor 显隐 → 编辑区空白 + activeTab 悬空（标签关不掉），
 *  2026-10-11 用户实测踩中。失败时 main 的 toast 已说明原因，查看器原样保留。 */
export async function promoteCsvToEdit(srcPath: string): Promise<void> {
  const ok = await handlers?.openFile(srcPath);
  if (ok) {
    const tab = findCsvTab(srcPath);
    if (tab) {
      closeCsvTabQuiet(tab);
      handlers?.renderTabs(); // 关 Tab 只动数组，tabbar 重渲染由 main 承担
    }
  }
}

function closeCsvTabQuiet(tab: Tab): void {
  const idx = app.tabs.indexOf(tab);
  if (idx !== -1) app.tabs.splice(idx, 1);
  cleanupCsvTab(tab);
}

// ---------- 宿主呈现（virtualTabs::presentVirtualTab 调用） ----------

let panelBuilt = false;
let renderToken = 0;

/** 前缀读取上限：1 万行 × 几百字节/行的宽表也远用不满（Rust 端再钳 32 MB） */
const CSV_READ_CAP = 8 * 1024 * 1024;
/** 每页行数（与 db Tab 默认页大小一致） */
const CSV_PAGE_SIZE = 200;
/** 本次 present 的解析结果 + 翻页游标（翻页 = 内存切片，不重读文件） */
let pageState: { table: CsvTable; page: number } | null = null;

/** 激活 CSV Tab：显示宿主、隐藏 #editor，重读文件重渲染（外部修改可见，照 db tab 先例）。 */
export async function presentCsvTab(tab: Tab): Promise<void> {
  ensurePanel();
  const src = csvSourcePath(tab.path);
  $("csv-tab-panel")?.classList.remove("hidden");
  $("editor")?.classList.add("hidden");
  const token = ++renderToken;
  const body = $("csv-tab-body");
  if (!body) return;

  let b64: string;
  try {
    b64 = await invoke<string>("read_file_base64", { path: src, maxBytes: CSV_READ_CAP });
  } catch {
    if (token === renderToken) renderMessage(t("csv.readFailed"));
    return;
  }
  if (token !== renderToken) return; // 已切走：丢弃过期渲染
  const bytes = b64ToBytes(b64);
  // 只解码一次（fatal 模式兼做编码判定）——此前 isUtf8Decodable + 再解码对全量字节跑两遍
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (token === renderToken) renderMessage(t("csv.decodeFailed")); // 编码不猜测：显式提示
    return;
  }
  if (token !== renderToken) return;
  const table = parseCsv(stripBom(text), CSV_MAX_ROWS);
  // 字节前缀截断：真实总行数未知；末行可能截在行中间/引号内 → 丢弃（截断提示已覆盖语义）。
  // 判据用**字节**长度（b64 是 ×1.33）；Rust 端 UTF-8 边界回退最多让前缀短 3 字节，留 8 字节窗。
  if (bytes.length > CSV_READ_CAP - 8 && table.rows.length > 0) {
    table.rows.pop();
    table.total = table.rows.length;
    table.truncated = true;
  }
  if (table.columns.length === 0) {
    renderMessage(t("csv.empty"));
    return;
  }
  pageState = { table, page: 1 };
  renderCsvPage();
}

/** 渲染当前页：状态条按**全表**口径（已显示=全部解析行；截断提示按上限），表格按页切片。 */
function renderCsvPage(): void {
  const st = pageState;
  const body = $("csv-tab-body");
  const status = $("csv-tab-status");
  if (!st || !body || !status) return;
  const full: DbQueryResult = {
    columns: st.table.columns,
    rows: st.table.rows,
    total: st.table.total,
    offset: 0,
    truncated: st.table.truncated,
    elapsedMs: 0,
    affected: null,
  };
  status.textContent = statusText({ result: full, writable: false, querying: false, cancelling: false });
  const pages = Math.max(1, Math.ceil(st.table.rows.length / CSV_PAGE_SIZE));
  if (st.page > pages) st.page = pages;
  const start = (st.page - 1) * CSV_PAGE_SIZE;
  const page: DbQueryResult = { ...full, rows: st.table.rows.slice(start, start + CSV_PAGE_SIZE), offset: start };
  body.textContent = "";
  const grid = buildGridTable(page, { offset: start }); // 表头不可点：只读内存数据，无后端排序
  body.appendChild(grid ?? emptyEl());
  syncCsvPager(pages);
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
  // 外部打开：超 10MB read_file 守卫打不开文本编辑的大 CSV 的兜底出口（系统默认程序）
  const extBtn = document.createElement("button");
  extBtn.className = "btn btn--sm";
  extBtn.appendChild(codicon("link-external"));
  const extLabel = document.createElement("span");
  extLabel.textContent = t("csv.openExternal");
  extBtn.appendChild(extLabel);
  extBtn.addEventListener("click", () => {
    const cur = app.activeTab;
    if (cur && cur.kind === "csv") void openExternal(csvSourcePath(cur.path));
  });
  bar.appendChild(extBtn);
  const status = document.createElement("span");
  status.id = "csv-tab-status";
  status.className = "csv-tab-status";
  bar.appendChild(status);
  panel.appendChild(bar);
  const body = document.createElement("div");
  body.id = "csv-tab-body";
  body.className = "csv-tab-body";
  panel.appendChild(body);
  // 分页条（照 db-pager 形态：上一页 / 页码 / 下一页；词条与样式均复用 database.* / .db-pager）
  const pager = document.createElement("div");
  pager.className = "db-pager csv-tab-pager";
  const pageLabel = document.createElement("span");
  pageLabel.className = "db-page-label";
  pager.append(
    pagerBtn("csv-pager-prev", "chevron-left", t("database.prevPage"), () => {
      if (pageState && pageState.page > 1) {
        pageState.page--;
        renderCsvPage();
      }
    }),
    pageLabel,
    pagerBtn("csv-pager-next", "chevron-right", t("database.nextPage"), () => {
      if (pageState) {
        pageState.page++;
        renderCsvPage();
      }
    }),
  );
  panel.appendChild(pager);
}

/** 分页按钮工厂（上一页 / 下一页同构） */
function pagerBtn(id: string, icon: string, tip: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.id = id;
  b.className = "btn btn--sm btn--icon";
  b.appendChild(codicon(icon));
  b.setAttribute("aria-label", tip);
  b.dataset.tip = tip;
  b.addEventListener("click", onClick);
  return b;
}

/** 同步分页条：页码文案 + 首末页禁用；单页时整条隐藏 */
function syncCsvPager(pages: number): void {
  const pager = document.querySelector(".csv-tab-pager");
  const prev = document.getElementById("csv-pager-prev") as HTMLButtonElement | null;
  const next = document.getElementById("csv-pager-next") as HTMLButtonElement | null;
  if (!pager || !prev || !next) return;
  const st = pageState;
  pager.classList.toggle("hidden", pages <= 1);
  if (!st) return;
  pager.querySelector(".db-page-label")!.textContent = t("database.pageLabel", { page: st.page, pages });
  prev.disabled = st.page <= 1;
  next.disabled = st.page >= pages;
}

function renderMessage(msg: string): void {
  const body = $("csv-tab-body");
  const status = $("csv-tab-status");
  document.querySelector(".csv-tab-pager")?.classList.add("hidden"); // 消息态无页可翻
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

/** 用系统默认程序打开（tauri-plugin-opener 插件命令）。走 `plugin:opener|open_path`
 *  原生 invoke 串而不引 JS 包装包：dist 体积预算仅剩 ~20KB，插件命令不占命令面。 */
async function openExternal(path: string): Promise<void> {
  try {
    await invoke("plugin:opener|open_path", { path, with: null });
  } catch (e) {
    toast(t("csv.openExternalFailed", { msg: String(e) }), "error");
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
