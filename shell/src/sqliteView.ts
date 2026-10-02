// 数据库工具窗（B3 · docs/sqlite_tool_dev_plan.md §6）。
//
// 四段竖排：#db-toolbar（连接管理）→ #db-tree-wrap（对象树）→ #db-sql-wrap（SQL 编辑器，
// PR-4）→ #db-result-wrap（状态条 + 结果网格 + 分页条）。
//
// 纪律（照 endpointView.ts 的先例）：
// - **不反向 import main.ts**（TD-013 已把循环 import 清零，禁止再引入）；需要主编辑器
//   能力的走 `setDbViewHandlers` 注入；
// - 纯逻辑（SQL 判定 / 单元格格式化 / 分页换算 / CSV）放 sqliteGrid.ts，本模块只管 DOM 与编排；
// - 并发一律用**刷新令牌**（同 endpointView.ts:55）：连续切换连接/连续查询时，旧回调不得覆盖新结果。
//
// 后端契约见 db_cmds.rs：命令 `db_open` / `db_close` / `db_connections_load` /
// `db_connections_save` / `db_list_objects` / `db_query` / `db_cancel` / `db_ddl`。

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, $ } from "./state";
import { basename, codicon, emptyState, errMsg } from "./util";
import { t, type TFuncKey } from "./i18n";
import { localizeBackendError } from "./i18n/backendError";
import { openAlert, openConfirm } from "./dialog";
import { showMenu, type MenuItem } from "./menu";
import { toast, toastFail } from "./toast";
import {
  buildGridTable,
  offsetOfPage,
  pageOf,
  statusText,
  toCsv,
  visibleColumnCount,
  type CellDisplay,
  type DbQueryResult,
} from "./sqliteGrid";

// ---------- 数据契约（与 Rust 侧同名 camelCase） ----------

export interface DbConnection {
  id: string;
  /** 绝对路径 */
  path: string;
  /** 文件名（basename） */
  name: string;
  /** 是否以可写方式打开（默认 false） */
  writable: boolean;
  /** SQL 编辑器草稿（PR-4 写入） */
  sql: string;
  /** 查询历史（最近 20 条，PR-4 写入） */
  history: string[];
}

export interface DbColumn {
  name: string;
  declType: string;
  pk: boolean;
  notNull: boolean;
}

export interface DbObject {
  name: string;
  kind: "table" | "view" | "index";
  /** 建表 / 建索引语句（`sqlite_master.sql`） */
  sql: string | null;
  /** 表 / 视图行数；索引为 null */
  rowCount: number | null;
  /** 表 / 视图列；索引为 null */
  columns: DbColumn[] | null;
}

// ---------- handlers 注入（同 todoView / endpointView 先例） ----------

export interface DbViewHandlers {
  /** 与主编辑器同源的 Monaco options（字号 / 主题 / 连字）——SQL 编辑器实例用 */
  buildOptions: () => MonacoApi.editor.IEditorOptions;
}

let handlers: DbViewHandlers | null = null;

export function setDbViewHandlers(h: DbViewHandlers): void {
  handlers = h;
}

// ---------- SQL 判定（Rust `classify_sql` 的前端镜像） ----------

const READ_KEYWORDS = new Set(["select", "values", "explain"]);
/** 只读类 PRAGMA（与 Rust `READ_PRAGMAS` 同源；其余 PRAGMA 一律按写处理，最保守） */
const READ_PRAGMAS = new Set([
  "table_info",
  "table_list",
  "table_xinfo",
  "index_list",
  "index_info",
  "index_xinfo",
  "database_list",
  "function_list",
  "collation_list",
]);

/**
 * 去噪：行注释 / 块注释 / 单双引号字符串一律替换为**等长空格**（保持字符位置），
 * 后续判定只看去噪文本，避免 `SELECT '; DROP TABLE t;'` 这类字符串内的关键字被误判。
 * 与 Rust `strip_noise` 同源。
 */
export function stripSqlNoise(sql: string): string {
  const out = sql.split("");
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) out[i++] = " ";
      if (i < n) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      out[i++] = " ";
      while (i < n) {
        const ch = sql[i];
        out[i++] = " ";
        if (ch === quote) {
          // SQL 里连续两个引号是转义，不算字符串结束
          if (sql[i] === quote) out[i++] = " ";
          else break;
        }
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

/** 取顶层词序列（小写）：跳过成对括号内的内容，词内只留字母数字与下划线。与 Rust `top_level_words` 同源。 */
export function topLevelWords(sql: string): string[] {
  const words: string[] = [];
  let cur = "";
  let depth = 0;
  const flush = (): void => {
    const w = cur.replace(/[^\p{L}\p{N}_]/gu, "").toLowerCase();
    cur = "";
    if (w) words.push(w);
  };
  for (const c of stripSqlNoise(sql)) {
    if (c === "(") {
      flush();
      depth++;
      continue;
    }
    if (c === ")") {
      flush();
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue; // 括号内一律忽略
    if (/\s/.test(c) || c === "," || c === ";") {
      flush();
      continue;
    }
    cur += c;
  }
  flush();
  return words;
}

export type SqlKind = "read" | "write";

/**
 * 判定 SQL 大类。**不确定一律 `write`**（保守：宁可多弹一次确认，也不放走一次写）。
 *
 * 用途仅两处：① 只读连接上省一次 IPC 直接拦下；② 可写连接上决定是否弹写确认框。
 * **真正的硬闸门在 Rust**（`DbReadOnly:`）——前端这份镜像被绕过也不会写坏库。
 */
export function classifySql(sql: string): SqlKind {
  const words = topLevelWords(sql);
  if (words.length === 0) return "write";
  let i = 0;
  // WITH 前缀：跳过 `name AS (…)` 的 CTE 定义，落到真正的主语句上
  if (words[i] === "with") {
    i++;
    if (words[i] === "recursive") i++;
    while (i + 1 < words.length && words[i + 1] === "as") i += 2;
  }
  const w = words[i] ?? "";
  if (READ_KEYWORDS.has(w)) return "read";
  if (w === "pragma") return READ_PRAGMAS.has(words[i + 1] ?? "") ? "read" : "write";
  return "write";
}

// ---------- 语句切分（Rust `split_statements` 的前端镜像） ----------

export interface StatementSpan {
  /** 语句文本（已 trim，不含结尾分号） */
  text: string;
  /** 该语句在原文中的结束下标（含结尾 `;`；末条无分号时为原文长度） */
  end: number;
}

/**
 * 扫描出各语句的文本与结束位置（**字符串与注释内的分号不算分隔符**）。
 *
 * 与 Rust `split_statements` 同源。为什么前端也要一份：后端的**读**查询路径会拒绝多语句
 * （`DbSqlError:一次只能执行一条查询语句`），所以「执行全部」必须由前端切好、逐条发
 * `db_query`；「执行当前语句」也要靠它定位光标所在的那一条。
 */
export function statementSpans(sql: string): StatementSpan[] {
  const out: StatementSpan[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const flush = (end: number): void => {
    const text = cur.trim();
    if (text) out.push({ text, end });
    cur = "";
  };
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") cur += sql[i++];
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      cur += sql[i++];
      cur += sql[i++];
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) cur += sql[i++];
      if (i < n) {
        cur += sql[i++];
        cur += sql[i++];
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      cur += sql[i++];
      while (i < n) {
        const ch = sql[i];
        cur += sql[i++];
        if (ch === quote) {
          if (sql[i] === quote) cur += sql[i++]; // 双写引号是转义，不算收尾
          else break;
        }
      }
      continue;
    }
    if (c === ";") {
      i++;
      flush(i);
      continue;
    }
    cur += c;
    i++;
  }
  flush(n);
  return out;
}

/** 按 `;` 切分语句（空片段丢弃）。「执行全部」用。 */
export function splitSqlStatements(sql: string): string[] {
  return statementSpans(sql).map((s) => s.text);
}

/**
 * 取光标所在的语句（`offset` = 光标在整段 SQL 中的字符下标）。
 *
 * 落在两条语句之间的空白/分号上时**取前一条**——用户的直觉是「我刚写完的那条」；
 * 全空时返回空串（调用方据此提示，而不是把空串发到后端）。
 */
export function currentStatement(sql: string, offset: number): string {
  const spans = statementSpans(sql);
  if (spans.length === 0) return "";
  const pos = Math.max(0, Math.min(offset, sql.length));
  for (const s of spans) {
    if (pos <= s.end) return s.text;
  }
  return spans[spans.length - 1].text;
}

// ---------- 状态 ----------

/** 导出 CSV 的行上限（与 Rust `HARD_MAX_ROWS` 对齐：一次查询最多回这么多行） */
export const EXPORT_MAX_ROWS = 10_000;
/** 查询历史保留条数（与 Rust 侧 DbConnection.history 的约定一致） */
const HISTORY_MAX = 20;
/** SQL 草稿写盘防抖（毫秒）：连打字时不反复写 json */
const DRAFT_SAVE_DEBOUNCE_MS = 2000;

let connections: DbConnection[] = [];
let activeId: string | null = null;
/** 当前连接的对象树 */
let objects: DbObject[] = [];
let result: DbQueryResult | null = null;
/** 结果对应的 SQL（分页时重跑用） */
let lastSql = "";
let pageSize = 200;
let querying = false;
let cancelling = false;
/** 对象树是否在加载中（切换连接/刷新时避免闪一下「没有表」空态） */
let treeLoading = false;
/** 刷新令牌：切换连接 / 连续查询时旧回调不得覆盖新结果（照 endpointView.ts:55） */
let token = 0;

/** 当前连接（无连接 = null） */
function activeConn(): DbConnection | null {
  return connections.find((c) => c.id === activeId) ?? null;
}

// ---------- DOM 构建 ----------

/** 工具条 / 段头通用的图标按钮（tip + aria-label 同源，避免两者漂移） */
function iconButton(
  id: string,
  ariaKey: TFuncKey,
  icon: string,
  onClick: (ev: MouseEvent) => void,
  cls = "btn btn--ghost btn--icon",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.id = id;
  b.className = cls;
  b.setAttribute("aria-label", t(ariaKey));
  b.dataset.tip = t(ariaKey);
  b.appendChild(codicon(icon));
  b.addEventListener("click", onClick);
  return b;
}

/** 初始化数据库视图 DOM（init 时调用一次；#view-database 容器已在 index.html 声明） */
export function initDbView(): void {
  const root = $("view-database");
  root.textContent = "";

  // ① 工具条
  const toolbar = document.createElement("div");
  toolbar.id = "db-toolbar";
  toolbar.className = "db-toolbar";

  const select = document.createElement("select");
  select.id = "db-conn-select";
  select.className = "db-conn-select";
  select.setAttribute("aria-label", t("database.connSelectAria"));
  select.addEventListener("change", () => void selectConnection(select.value));
  toolbar.appendChild(select);

  const mkBtn = (id: string, ariaKey: TFuncKey, icon: string, onClick: (ev: MouseEvent) => void): HTMLButtonElement =>
    iconButton(id, ariaKey, icon, onClick);
  toolbar.append(
    mkBtn("db-add", "database.addAria", "add", () => void addConnection()),
    mkBtn("db-remove", "database.removeAria", "trash", () => void removeConnection()),
  );

  // 可写开关：SQLite 的打开模式在 open 时定死，故切换 = 关旧连接 + 以新模式重开
  const writable = document.createElement("button");
  writable.id = "db-writable";
  writable.className = "btn btn--ghost btn--icon";
  writable.setAttribute("aria-pressed", "false");
  writable.appendChild(codicon("lock"));
  writable.addEventListener("click", () => void toggleWritable());
  toolbar.appendChild(writable);

  toolbar.append(
    mkBtn("db-refresh", "database.refreshAria", "refresh", () => void refreshTree()),
    mkBtn("db-more", "database.moreAria", "ellipsis", (ev: Event) => openMoreMenu(ev)),
  );

  // 可写警示条（只在可写时显示）
  const banner = document.createElement("div");
  banner.id = "db-write-banner";
  banner.className = "db-write-banner hidden";
  banner.textContent = t("database.writeBanner");

  // ② 对象树段
  const treeWrap = section("db-tree-wrap", "database.sectionTree", "db-tree");
  // ③ SQL 编辑器段（内容由 buildSqlBody 填；Monaco 实例懒创建）
  const sqlWrap = section("db-sql-wrap", "database.sectionSql", "db-sql-body");
  // ④ 结果段（不可折叠：结果区是主体，收起来等于把功能藏了）
  const resultWrap = document.createElement("div");
  resultWrap.id = "db-result-wrap";
  resultWrap.className = "db-result-wrap";
  const resultHead = document.createElement("div");
  resultHead.className = "db-section-header db-result-header";
  resultHead.textContent = t("database.sectionResult");
  const status = document.createElement("div");
  status.id = "db-result-status";
  status.className = "db-result-status";
  const grid = document.createElement("div");
  grid.id = "db-result-grid";
  grid.className = "db-result-grid";
  const pager = buildPager();
  const detail = document.createElement("div");
  detail.id = "db-cell-detail";
  detail.className = "db-cell-detail hidden";
  resultWrap.append(resultHead, status, grid, pager, detail);

  root.append(toolbar, banner, treeWrap, sqlWrap, resultWrap);
  buildSqlBody();
  renderAll();
}

/** SQL 编辑器段内容：Monaco 宿主 + 空态提示 + 执行条（doc §3.4） */
function buildSqlBody(): void {
  const body = document.getElementById("db-sql-body");
  if (!body) return;
  body.textContent = "";

  const host = document.createElement("div");
  host.id = "db-sql-host";
  host.className = "db-sql-host";
  // 空 model 时的提示（Monaco 无原生 placeholder，用同级提示行替代）
  const hint = document.createElement("div");
  hint.id = "db-sql-hint";
  hint.className = "db-sql-hint";
  hint.textContent = t("database.sqlHint");

  const bar = document.createElement("div");
  bar.id = "db-sql-bar";
  bar.className = "db-sql-bar";
  const run = document.createElement("button");
  run.id = "db-run";
  run.className = "btn btn--sm";
  run.textContent = t("database.run");
  run.dataset.tip = t("database.runTip");
  run.setAttribute("aria-label", t("database.runTip"));
  run.addEventListener("click", () => void runCurrent());
  const runAll = document.createElement("button");
  runAll.id = "db-run-all";
  runAll.className = "btn btn--sm";
  runAll.textContent = t("database.runAll");
  runAll.dataset.tip = t("database.runAllTip");
  runAll.setAttribute("aria-label", t("database.runAllTip"));
  runAll.addEventListener("click", () => void runAllStatements());
  const history = document.createElement("button");
  history.id = "db-history";
  history.className = "btn btn--sm";
  history.textContent = t("database.history");
  history.addEventListener("click", () => openHistoryMenu());
  bar.append(run, runAll, history);

  body.append(host, hint, bar);
}

/** 造一个「段头（可折叠）+ 段体」容器（doc §3.1：段头 aria-expanded 与 .collapsed 同源切换） */
function section(wrapId: string, titleKey: TFuncKey, bodyId: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.id = wrapId;
  wrap.className = "db-section";
  const header = document.createElement("div");
  header.className = "db-section-header";
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.setAttribute("aria-expanded", "true");
  header.setAttribute("aria-controls", bodyId);
  const arrow = codicon("chevron-down");
  const label = document.createElement("span");
  label.textContent = t(titleKey);
  header.append(arrow, label);
  const toggle = (): void => {
    const collapsed = wrap.classList.toggle("collapsed");
    header.setAttribute("aria-expanded", String(!collapsed));
    arrow.className = `codicon codicon-${collapsed ? "chevron-right" : "chevron-down"}`;
    persistSections();
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  const body = document.createElement("div");
  body.id = bodyId;
  body.className = "db-section-body";
  wrap.append(header, body);
  return wrap;
}

/** 分页条：上一页 / 页码 / 下一页 / 每页行数 / 导出 CSV / 取消 */
function buildPager(): HTMLElement {
  const pager = document.createElement("div");
  pager.id = "db-pager";
  pager.className = "db-pager";

  const prev = document.createElement("button");
  prev.id = "db-prev";
  prev.className = "btn btn--sm btn--icon";
  prev.appendChild(codicon("chevron-left"));
  prev.setAttribute("aria-label", t("database.prevPage"));
  prev.dataset.tip = t("database.prevPage");
  prev.addEventListener("click", () => void gotoPage(currentPageNo() - 1));

  const label = document.createElement("span");
  label.id = "db-page-label";
  label.className = "db-num";

  const next = document.createElement("button");
  next.id = "db-next";
  next.className = "btn btn--sm btn--icon";
  next.appendChild(codicon("chevron-right"));
  next.setAttribute("aria-label", t("database.nextPage"));
  next.dataset.tip = t("database.nextPage");
  next.addEventListener("click", () => void gotoPage(currentPageNo() + 1));

  const sizeLabel = document.createElement("span");
  sizeLabel.textContent = t("database.pageSize");
  const sizeSel = document.createElement("select");
  sizeSel.id = "db-page-size";
  sizeSel.className = "db-page-size";
  sizeSel.setAttribute("aria-label", t("database.pageSize"));
  for (const n of [100, 200, 500, 1000]) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = String(n);
    sizeSel.appendChild(opt);
  }
  sizeSel.addEventListener("change", () => {
    pageSize = Number(sizeSel.value) || 200;
    if (lastSql) void runQuery(lastSql, 0);
  });

  const cancel = document.createElement("button");
  cancel.id = "db-cancel";
  cancel.className = "btn btn--sm hidden";
  cancel.textContent = t("database.cancel");
  cancel.addEventListener("click", () => void cancelQuery());

  const exportBtn = document.createElement("button");
  exportBtn.id = "db-export";
  exportBtn.className = "btn btn--sm";
  exportBtn.textContent = t("database.exportCsv");
  exportBtn.dataset.tip = t("database.exportHint", { n: EXPORT_MAX_ROWS });
  exportBtn.setAttribute("aria-label", t("database.exportHint", { n: EXPORT_MAX_ROWS }));
  exportBtn.addEventListener("click", () => void exportCsv());

  pager.append(prev, label, next, sizeLabel, sizeSel, exportBtn, cancel);
  return pager;
}

// ---------- 渲染 ----------

/** 全量重渲染（连接下拉 → 工具条态 → 树 → 结果） */
function renderAll(): void {
  renderConnSelect();
  renderToolbar();
  renderTree();
  renderResult();
}

/** 连接下拉：无工作区/无连接/打开中/已连接 四态（doc §3.2 状态机） */
function renderConnSelect(): void {
  const sel = document.getElementById("db-conn-select") as HTMLSelectElement | null;
  if (!sel) return;
  const prev = sel.value;
  sel.textContent = "";
  if (connections.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = app.workspaceRoot ? t("database.noConnPlaceholder") : "—";
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const c of connections) {
    const opt = document.createElement("option");
    opt.value = c.id;
    // doc §3.2：`<文件名> · <父目录>`
    opt.textContent = `${c.name} · ${basename(parentDir(c.path))}`;
    opt.title = c.path;
    sel.appendChild(opt);
  }
  sel.value = activeId && connections.some((c) => c.id === activeId) ? activeId : prev;
}

function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

/** 工具条按钮可用性与可写开关态 */
function renderToolbar(): void {
  const conn = activeConn();
  const has = conn !== null;
  for (const id of ["db-remove", "db-refresh", "db-more", "db-writable"]) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = !has;
  }
  const w = document.getElementById("db-writable") as HTMLButtonElement | null;
  if (w) {
    const on = conn?.writable ?? false;
    w.setAttribute("aria-pressed", String(on));
    w.dataset.tip = on ? t("database.writableTipOn") : t("database.writableTipOff");
    w.setAttribute("aria-label", on ? t("database.writableTipOn") : t("database.writableTipOff"));
    w.replaceChildren(codicon(on ? "unlock" : "lock"));
  }
  const banner = document.getElementById("db-write-banner");
  banner?.classList.toggle("hidden", !(conn?.writable ?? false));
}

/** 对象树：表 / 视图 / 索引 三组，组内按名排序（doc §3.3） */
function renderTree(error?: string): void {
  const host = document.getElementById("db-tree");
  if (!host) return;
  host.textContent = "";

  if (error) {
    host.appendChild(emptyState("database", t("database.failListShort"), error, true));
    return;
  }
  if (!app.workspaceRoot) {
    host.appendChild(
      emptyState("database", t("database.noWorkspace"), t("database.noWorkspaceHint"), true),
    );
    return;
  }
  if (!activeId) {
    host.appendChild(
      emptyState("database", t("database.noConnection"), t("database.noConnectionHint"), true),
    );
    return;
  }
  if (treeLoading) {
    host.appendChild(emptyState("loading", t("database.listing"), undefined, true));
    return;
  }
  if (objects.length === 0) {
    host.appendChild(emptyState("database", t("database.noObjects"), t("database.noObjectsHint"), true));
    return;
  }

  const groups: [TFuncKey, DbObject["kind"]][] = [
    ["database.groupTables", "table"],
    ["database.groupViews", "view"],
    ["database.groupIndexes", "index"],
  ];
  for (const [key, kind] of groups) {
    const items = objects
      .filter((o) => o.kind === kind)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (items.length === 0) continue;
    const header = document.createElement("div");
    header.className = "db-tree-group";
    const arrow = codicon("chevron-down");
    const label = document.createElement("span");
    label.textContent = `${t(key)} (${items.length})`;
    header.append(arrow, label);
    host.appendChild(header);
    for (const o of items) host.appendChild(buildTreeItem(o));
  }
}

function buildTreeItem(o: DbObject): HTMLElement {
  const item = document.createElement("div");
  item.className = "db-tree-item";
  item.dataset.name = o.name;
  item.dataset.kind = o.kind;
  item.setAttribute("role", "button");
  item.tabIndex = 0;

  const arrow = o.kind === "index" ? null : codicon("chevron-right");
  const icon = codicon(o.kind === "table" ? "table" : o.kind === "view" ? "eye" : "list-ordered");
  const name = document.createElement("span");
  name.className = "db-tree-name";
  name.textContent = o.name;
  const count = document.createElement("span");
  count.className = "db-tree-count db-num";
  if (o.kind === "index") {
    // 索引只显示名字（doc §3.3：无子项、无行数）
    count.textContent = "";
  } else {
    count.textContent = o.rowCount === null ? "…" : t("database.rowsCount", { n: o.rowCount });
  }

  if (arrow) item.appendChild(arrow);
  item.append(icon, name, count);

  if (o.kind !== "index") {
    // 列清单（默认收起）
    const cols = document.createElement("div");
    cols.className = "db-tree-cols hidden";
    for (const c of o.columns ?? []) {
      const row = document.createElement("div");
      row.className = "db-tree-col";
      const cn = document.createElement("span");
      cn.textContent = c.name;
      const ct = document.createElement("span");
      ct.className = "db-tree-col-type";
      const flags = [c.pk ? "PK" : "", c.notNull ? "NN" : ""].filter(Boolean);
      ct.textContent = [c.declType, ...flags].filter(Boolean).join(" ");
      row.append(cn, ct);
      cols.appendChild(row);
    }
    item.appendChild(cols);
  }

  const toggleCols = (): void => {
    if (!arrow) return;
    const body = item.querySelector(".db-tree-cols");
    if (!body) return;
    const collapsed = body.classList.toggle("hidden");
    arrow.className = `codicon codicon-${collapsed ? "chevron-right" : "chevron-down"}`;
  };
  const showRows = (): void => {
    // doc §3.3：双击表/视图 → SELECT * LIMIT pageSize（最常用路径，必须顺手）
    void runQuery(`SELECT * FROM "${o.name}"`, 0);
  };
  item.addEventListener("click", toggleCols);
  item.addEventListener("dblclick", showRows);
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      showRows();
    } else if (e.key === " ") {
      e.preventDefault();
      toggleCols();
    }
  });
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const items: MenuItem[] = [
      { label: t("database.showRows"), icon: "table", action: showRows },
    ];
    if (o.kind !== "index") {
      items.push({ label: t("database.showDdl"), icon: "code", action: () => void showDdl(o.name) });
    }
    items.push(
      {
        label: t("database.copyName"),
        icon: "copy",
        action: () => void copyText(o.name, t("database.copyName")),
      },
      {
        label: t("database.copySelect"),
        icon: "terminal",
        action: () => void copyText(`SELECT * FROM "${o.name}"`, t("database.copySelect")),
      },
    );
    showMenu(items, { x: e.clientX, y: e.clientY });
  });
  return item;
}

/** 结果区：状态条 + 网格 + 分页条（doc §3.5 / §3.6） */
function renderResult(error?: string): void {
  const status = document.getElementById("db-result-status");
  const grid = document.getElementById("db-result-grid");
  if (!status || !grid) return;

  const width = grid.clientWidth || 0;
  const maxCols = result ? visibleColumnCount(width, result.columns.length) : 0;

  status.classList.toggle("is-error", Boolean(error));
  status.textContent = statusText({
    result,
    writable: activeConn()?.writable ?? false,
    querying,
    cancelling,
    error,
    shownCols: result && maxCols < result.columns.length ? maxCols : undefined,
  });

  grid.classList.toggle("db-stale", querying);
  grid.textContent = "";
  if (!result) return;
  if (result.rows.length === 0) {
    // 写语句没有结果集：不显示空态（否则「DELETE 成功」看起来像「没查到数据」）
    if (result.affected === null) {
      grid.appendChild(
        emptyState("table", t("database.emptyResult"), t("database.emptyResultHint"), true),
      );
    }
    renderPager();
    return;
  }
  const table = buildGridTable(result, {
    offset: result.offset,
    maxCols,
    onCellClick: (info) => showCellDetail(info.column, info.row, info.display),
  });
  if (table) grid.appendChild(table);
  renderPager();
}

function renderPager(): void {
  const label = document.getElementById("db-page-label");
  const prev = document.getElementById("db-prev") as HTMLButtonElement | null;
  const next = document.getElementById("db-next") as HTMLButtonElement | null;
  const cancel = document.getElementById("db-cancel");
  const sizeSel = document.getElementById("db-page-size") as HTMLSelectElement | null;
  if (sizeSel) sizeSel.value = String(pageSize);

  cancel?.classList.toggle("hidden", !querying);

  if (!result) {
    if (label) label.textContent = "";
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    return;
  }
  const info = pageOf(result.total, result.offset, pageSize);
  if (label) label.textContent = t("database.pageLabel", { page: info.page, pages: info.pages });
  if (prev) prev.disabled = !info.hasPrev || querying;
  if (next) next.disabled = !info.hasNext || querying;
}

/** 单元格详情（doc §3.5）：显示当前拿到的完整值（后端已按 200 字符截断） */
function showCellDetail(column: string, row: number, d: CellDisplay): void {
  const box = document.getElementById("db-cell-detail");
  if (!box) return;
  box.textContent = "";
  const head = document.createElement("div");
  head.className = "db-cell-detail-head";
  head.textContent = `${column} · #${row}`;
  const body = document.createElement("div");
  body.className = "db-cell-detail-body";
  body.textContent = d.kind === "null" ? t("database.null") : d.full;
  const copy = document.createElement("button");
  copy.className = "btn btn--sm";
  copy.textContent = t("database.copyValue");
  copy.addEventListener("click", () => void copyText(d.full, t("database.copyValue")));
  box.append(head, body, copy);
  box.classList.remove("hidden");
}

async function copyText(text: string, action: string): Promise<void> {
  try {
    await invoke("copy_to_clipboard", { text });
    toast(t("database.copied"), "success");
  } catch (e) {
    toastFail(action, e);
  }
}

// ---------- 连接管理 ----------

/** 拉取全局连接列表（启动与增删后调用） */
export async function refreshConnections(): Promise<void> {
  try {
    connections = await invoke<DbConnection[]>("db_connections_load");
  } catch (e) {
    connections = [];
    toastFail(t("database.failLoad"), e);
  }
  if (activeId && !connections.some((c) => c.id === activeId)) activeId = null;
  renderAll();
}

/** 切换连接：关旧 → 开新 → 刷新树（doc §3.2：切换是切换不是叠加，同时只活一个） */
async function selectConnection(id: string): Promise<void> {
  if (!id || id === activeId) return;
  const my = ++token;
  const old = activeId;
  const target = connections.find((c) => c.id === id);
  if (!target) return;
  querying = false;
  cancelling = false;
  if (old) {
    try {
      await invoke("db_close", { id: old });
    } catch {
      // 关旧连接失败不阻断（后端可能已摘除）
    }
  }
  activeId = id;
  objects = [];
  result = null;
  lastSql = "";
  treeLoading = true; // 打开期间树区显示「加载中…」，避免闪一下「没有表」
  renderAll();
  loadDraft();
  try {
    const conn = await invoke<DbConnection>("db_open", { path: target.path, writable: target.writable });
    if (my !== token) return;
    // db_open 会把合并后的条目写回全局列表（保留草稿与历史），以它为准
    await refreshConnections();
    if (my !== token) return;
    activeId = conn.id;
    await refreshTree();
  } catch (e) {
    if (my !== token) return;
    // 打开失败：回退到上一个有效连接（doc §3.2 状态机）
    activeId = old;
    treeLoading = false;
    renderAll();
    toastFail(t("database.failOpen"), e);
  }
}

/** 添加连接：选文件 → db_open（默认只读）→ 刷新列表 */
export async function addConnection(): Promise<void> {
  let picked: string | null = null;
  try {
    picked = await invoke<string | null>("pick_file");
  } catch (e) {
    toastFail(t("database.failPick"), e);
    return;
  }
  if (!picked) return; // 用户取消
  try {
    // 后缀白名单在 Rust 侧校验（DbInvalidPath:ext:…）——pick_file 不带过滤器
    const conn = await invoke<DbConnection>("db_open", { path: picked, writable: false });
    await refreshConnections();
    await selectConnection(conn.id);
  } catch (e) {
    toastFail(t("database.failOpen"), e);
  }
}

/** 移除连接：仅从列表移除（不删文件），需确认；移除的是当前连接则顺带关闭 */
async function removeConnection(): Promise<void> {
  const conn = activeConn();
  if (!conn) return;
  const ok = await openConfirm({
    title: t("database.removeConfirmTitle"),
    message: t("database.removeConfirm", { name: conn.name }),
    okLabel: t("database.removeConfirmOk"),
    kind: "danger",
  });
  if (!ok) return;
  try {
    await invoke("db_close", { id: conn.id });
  } catch {
    // 已摘除/已关闭都当成功
  }
  connections = connections.filter((c) => c.id !== conn.id);
  activeId = null;
  objects = [];
  result = null;
  lastSql = "";
  treeLoading = false;
  token++;
  renderAll();
  await saveConnections();
}

/** 可写开关：SQLite 打开模式在 open 时定死 → 关旧连接 + 以新模式重开 */
async function toggleWritable(): Promise<void> {
  const conn = activeConn();
  if (!conn) return;
  const next = !conn.writable;
  if (next && !(await confirmWritable())) return;
  try {
    await invoke("db_close", { id: conn.id });
    const reopened = await invoke<DbConnection>("db_open", { path: conn.path, writable: next });
    await refreshConnections();
    activeId = reopened.id;
    renderAll();
    toast(next ? t("database.writableOn") : t("database.writableOff"), "info");
  } catch (e) {
    toastFail(t("database.failOpen"), e);
  }
}

/** 开启可写前的二次确认（写库不可撤销，且只读是产品默认值） */
async function confirmWritable(): Promise<boolean> {
  return openConfirm({
    title: t("database.writableConfirmTitle"),
    message: t("database.writableConfirmBody"),
    okLabel: t("database.writableConfirmOk"),
    kind: "danger",
  });
}

/** ⋯ 更多菜单（doc §3.2） */
function openMoreMenu(ev: Event): void {
  const conn = activeConn();
  if (!conn) return;
  const anchor = (ev.currentTarget as HTMLElement | null) ?? { x: 0, y: 0 };
  showMenu(
    [
      { label: t("database.copyPath"), icon: "copy", action: () => void copyText(conn.path, t("database.copyPath")) },
      { label: t("database.revealInOs"), icon: "folder-opened", action: () => void revealInOs(conn.path) },
      { sep: true },
      { label: t("database.closeConn"), icon: "close", action: () => void closeActive() },
    ],
    anchor,
  );
}

async function revealInOs(path: string): Promise<void> {
  try {
    await invoke("reveal_in_explorer", { path });
  } catch (e) {
    toastFail(t("database.failReveal"), e);
  }
}

/** 关闭当前连接（保留在列表里，只是断开） */
async function closeActive(): Promise<void> {
  const conn = activeConn();
  if (!conn) return;
  try {
    await invoke("db_close", { id: conn.id });
  } catch (e) {
    toastFail(t("database.failClose"), e);
  }
  activeId = null;
  objects = [];
  result = null;
  lastSql = "";
  treeLoading = false;
  token++;
  renderAll();
}

/** 把当前列表写回全局 json（仅移除连接用；db_open 会自己写） */
async function saveConnections(): Promise<void> {
  try {
    await invoke("db_connections_save", { list: connections });
  } catch (e) {
    toastFail(t("database.failSave"), e);
  }
}

// ---------- 对象树刷新 ----------

/** 重新拉对象树（工具条 ⟳ 与切换连接后调用；不重连） */
export async function refreshTree(): Promise<void> {
  if (!activeId) {
    objects = [];
    treeLoading = false;
    renderTree();
    return;
  }
  const my = ++token;
  objects = [];
  treeLoading = true;
  renderTree();
  try {
    const got = await invoke<DbObject[]>("db_list_objects", { id: activeId });
    if (my !== token) return;
    objects = got;
    treeLoading = false;
    renderTree();
  } catch (e) {
    if (my !== token) return;
    objects = [];
    treeLoading = false;
    renderTree(localizeBackendError(errMsg(e)));
  }
}

// ---------- 查询 ----------

/** 执行查询（分页重跑也走这里）。前端只做「省一次往返」的拦截，硬闸门在 Rust。 */
export async function runQuery(sql: string, offset: number): Promise<void> {
  const conn = activeConn();
  const text = sql.trim().replace(/;$/, "");
  if (!conn || !text) return;

  if (classifySql(text) === "write" && !conn.writable) {
    // doc §3.6：只读模式下执行写语句 → 不发 IPC，直接提示
    renderResult(t("database.readonlyBlocked"));
    toast(t("database.readonlyBlocked"), "info");
    return;
  }

  const my = ++token;
  lastSql = sql;
  const off = Math.max(0, offset);
  querying = true;
  cancelling = false;
  renderResult();
  try {
    const got = await invoke<DbQueryResult>("db_query", {
      id: conn.id,
      sql,
      limit: pageSize,
      offset: off,
    });
    if (my !== token) return;
    result = got;
    querying = false;
    renderResult();
  } catch (e) {
    if (my !== token) return;
    querying = false;
    renderResult(t("database.statusFail", { error: localizeBackendError(errMsg(e)) }));
    toastFail(t("database.failQuery"), e);
  }
}

/** 取消进行中的查询（SQLite 协作式中断，不保证即时 → 先显示「取消中…」） */
export async function cancelQuery(): Promise<void> {
  const conn = activeConn();
  if (!conn || !querying) return;
  cancelling = true;
  renderResult();
  try {
    await invoke("db_cancel", { id: conn.id });
    toast(t("database.cancelled"), "info");
  } catch (e) {
    toastFail(t("database.failCancel"), e);
  }
}

/** 当前页码（**1 基**，无结果时 1）。分页按钮的 ±1 必须基于页码，而不是行偏移——
    曾把行偏移当页码用，导致「下一页」原地不动（e2e DB-Q-1 抓到的真 bug）。
    口径取自 `result.offset`（已显示的结果），与 renderPager 的页码显示同源。 */
function currentPageNo(): number {
  return result ? pageOf(result.total, result.offset, pageSize).page : 1;
}

/** 翻页（入参是 **1 基页码**，不是行偏移；越界不动作，页码由 pageOf 收敛） */
async function gotoPage(target: number): Promise<void> {
  if (!result || querying) return;
  const info = pageOf(result.total, result.offset, pageSize);
  if (target < 1 || target > info.pages) return;
  await runQuery(lastSql, offsetOfPage(target, pageSize));
}

/** 工作区切换 / 关闭时复位（避免旧库的树与结果残留） */
export function resetDbView(): void {
  token++;
  activeId = null;
  objects = [];
  result = null;
  lastSql = "";
  querying = false;
  cancelling = false;
  treeLoading = false;
  renderAll();
}

// ---------- 段折叠状态持久化 ----------

const SECTIONS_KEY = "opencharm.db.sections";

function persistSections(): void {
  const state: Record<string, boolean> = {};
  for (const id of ["db-tree-wrap", "db-sql-wrap"]) {
    state[id] = document.getElementById(id)?.classList.contains("collapsed") ?? false;
  }
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用：本次会话内仍生效
  }
}

/** 启动时恢复段折叠状态（initDbView 之后调用） */
export function restoreDbSections(): void {
  let saved: Record<string, boolean> = {};
  try {
    saved = JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    saved = {};
  }
  for (const [id, collapsed] of Object.entries(saved)) {
    const wrap = document.getElementById(id);
    const header = wrap?.querySelector(".db-section-header");
    if (!wrap || !header) continue;
    wrap.classList.toggle("collapsed", collapsed);
    header.setAttribute("aria-expanded", String(!collapsed));
    const arrow = header.querySelector(".codicon");
    if (arrow) arrow.className = `codicon codicon-${collapsed ? "chevron-right" : "chevron-down"}`;
  }
}

// ---------- 页面尺寸变化（窄栏裁列） ----------

let resizeObserver: ResizeObserver | null = null;

/** 监听结果区宽度变化，重算渲染列数（doc §3.1 窄栏规则） */
export function watchDbResize(): void {
  const grid = document.getElementById("db-result-grid");
  if (!grid || typeof ResizeObserver === "undefined") return;
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => renderResult());
  resizeObserver.observe(grid);
}

/** 视图显示时调用（切到 database 视图） */
let viewShownOnce = false;

export async function onDbViewShow(): Promise<void> {
  viewShownOnce = true;
  pageSize = app.settings.db_page_size ?? 200;
  watchDbResize();
  if (connections.length === 0) await refreshConnections();
  else renderAll();
  // 有连接但没激活时自动打开第一条：只列出来却不打开会让树区停在「没有数据库连接」空态，
  // 用户必须去下拉里再点一次——同一条连接点第二次是空操作，体验上等于「点了没反应」。
  if (!activeId && connections.length > 0) await selectConnection(connections[0].id);
  syncSqlHint();
}

/**
 * 工作区就绪后补一次渲染（openWorkspace 收尾时调用）。
 * 视图可能在「启动自动恢复工作区」完成前初始化/显示——renderTree 依赖 app.workspaceRoot，
 * 当时只会画出「未打开工作区」空态，且工作区就绪不会触发任何重渲染
 * （§10.3-8b 真机发现；与 main.ts 的 git 视图补刷新同款处理）。
 */
export function refreshDbWorkspace(): void {
  if (!viewShownOnce) return; // 视图从未显示：不开连接不建编辑器（autosave 等域的 e2e 回归）
  void (async () => {
    if (connections.length === 0) await refreshConnections();
    else renderAll();
    if (!activeId && connections.length > 0) await selectConnection(connections[0].id);
    syncSqlHint();
  })();
}

// ---------- SQL 编辑器（doc §3.4 / §6.6） ----------

let sqlEditor: MonacoApi.editor.IStandaloneCodeEditor | null = null;
let sqlModel: MonacoApi.editor.ITextModel | null = null;
let saveTimer = 0;

/**
 * SQL 编辑器的最终 options：主编辑器同源参数（字号 / 主题 / 连字，由 main 注入）
 * **之上**再叠侧栏专有覆盖——侧栏只有 300 来像素宽，缩略图与行号纯属占地方。
 */
function sqlEditorOptions(): MonacoApi.editor.IStandaloneEditorConstructionOptions {
  return {
    ...(handlers?.buildOptions() ?? {}),
    automaticLayout: true,
    language: "sql",
    minimap: { enabled: false },
    lineNumbers: "off",
    glyphMargin: false,
    folding: false,
    scrollBeyondLastLine: false,
    wordWrap: "on",
    renderLineHighlight: "none",
  };
}

/**
 * 懒创建 SQL 编辑器实例（G-1 纪律：不随开随弃；切连接只换 model 内容，实例常驻）。
 *
 * host 用 `$()` 取真实元素，**不能**用 `lazyEl` Proxy——Monaco 的 automaticLayout 会把
 * 容器交给 `ResizeObserver.observe()`，Proxy 不是真实 Element 会被原生 API 拒绝
 * （splitEditor.ts:23-25 的同款踩坑注释）。
 */
function ensureSqlEditor(): MonacoApi.editor.IStandaloneCodeEditor {
  if (sqlEditor && sqlModel) return sqlEditor;
  const monaco = app.monaco;
  sqlModel = monaco.editor.createModel("", "sql");
  sqlEditor = monaco.editor.create($("db-sql-host"), { ...sqlEditorOptions(), model: sqlModel });
  sqlEditor.addAction({
    id: "opencharm.dbRun",
    label: t("database.runTip"),
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    run: () => void runCurrent(),
  });
  sqlEditor.addAction({
    id: "opencharm.dbRunAll",
    label: t("database.runAllTip"),
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
    run: () => void runAllStatements(),
  });
  sqlEditor.onDidChangeModelContent(() => {
    syncSqlHint();
    scheduleDraftSave();
  });
  return sqlEditor;
}

/** 设置保存后同步编辑器参数（字号 / 连字 / 主题；照 splitEditor.ts:130 的范式） */
export function refreshDbSqlOptions(): void {
  sqlEditor?.updateOptions(sqlEditorOptions());
}

/** 空 model 时显示提示行（Monaco 无原生 placeholder） */
function syncSqlHint(): void {
  const hint = document.getElementById("db-sql-hint");
  if (!hint) return;
  hint.classList.toggle("hidden", Boolean(sqlModel && sqlModel.getValue().trim()));
}

/** 把当前连接的 SQL 草稿灌进编辑器（切连接 / 初始化时调用） */
function loadDraft(): void {
  const editor = ensureSqlEditor();
  const text = activeConn()?.sql ?? "";
  if (editor.getValue() !== text) editor.setValue(text);
  syncSqlHint();
}

/** 草稿落库：内存立即更新，写盘防抖 2s（避免连打字时反复写 json） */
function scheduleDraftSave(): void {
  const conn = activeConn();
  if (conn && sqlEditor) conn.sql = sqlEditor.getValue();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveConnections(), DRAFT_SAVE_DEBOUNCE_MS);
}

/** 切到数据库视图 + 聚焦 SQL 编辑器（命令面板「新建查询」用） */
export function focusDbSql(): void {
  const wrap = document.getElementById("db-sql-wrap");
  if (wrap?.classList.contains("collapsed")) {
    wrap.classList.remove("collapsed");
    wrap.querySelector(".db-section-header")?.setAttribute("aria-expanded", "true");
    persistSections();
  }
  ensureSqlEditor().focus();
}

// ---------- 执行 ----------

/**
 * 写语句闸门（doc §3.6）：只读连接直接拒（省一次 IPC）；可写连接按设置决定是否弹确认框。
 * 返回 true = 放行。**真正的硬闸门在 Rust**（`DbReadOnly:`），这里被绕过也写不坏库。
 */
async function confirmWrite(sql: string): Promise<boolean> {
  if (classifySql(sql) !== "write") return true;
  const conn = activeConn();
  if (!conn?.writable) {
    renderResult(t("database.readonlyBlocked"));
    toast(t("database.readonlyBlocked"), "info");
    return false;
  }
  if (app.settings.db_warn_on_write === false) return true;
  return openConfirm({
    title: t("database.writeConfirmTitle"),
    message: t("database.writeConfirmBody", { sql: sql.slice(0, 200) }),
    okLabel: t("database.writeConfirmOk"),
    kind: "danger",
  });
}

/** 执行当前语句（Ctrl+Enter）：按光标位置定位 `;` 分隔出的那一条 */
export async function runCurrent(): Promise<void> {
  if (!activeConn()) {
    toast(t("database.noConnection"), "info");
    return;
  }
  const editor = ensureSqlEditor();
  const pos = editor.getPosition();
  const model = editor.getModel();
  const offset = pos && model ? model.getOffsetAt(pos) : 0;
  const stmt = currentStatement(editor.getValue(), offset);
  if (!stmt) {
    toast(t("database.sqlHint"), "info");
    return;
  }
  if (!(await confirmWrite(stmt))) return;
  pushHistory(stmt);
  await runQuery(stmt, 0);
}

/** 执行全部（Ctrl+Shift+Enter）：前端切分后逐条发（后端的读路径拒绝多语句） */
export async function runAllStatements(): Promise<void> {
  if (!activeConn()) {
    toast(t("database.noConnection"), "info");
    return;
  }
  const stmts = splitSqlStatements(ensureSqlEditor().getValue());
  if (stmts.length === 0) {
    toast(t("database.sqlHint"), "info");
    return;
  }
  for (const stmt of stmts) {
    if (!(await confirmWrite(stmt))) return;
    pushHistory(stmt);
    await runQuery(stmt, 0);
  }
}

/** 记入查询历史（去重、最近的在前、上限 20 条），并触发一次草稿写盘 */
function pushHistory(sql: string): void {
  const conn = activeConn();
  if (!conn) return;
  conn.history = [sql, ...conn.history.filter((h) => h !== sql)].slice(0, HISTORY_MAX);
  scheduleDraftSave();
}

/** 历史下拉：点击回填编辑器 */
function openHistoryMenu(): void {
  const anchor = document.getElementById("db-history");
  if (!anchor) return;
  const conn = activeConn();
  const items: MenuItem[] = (conn?.history ?? []).map((h) => ({
    label: h.replace(/\s+/g, " ").slice(0, 70),
    action: () => {
      ensureSqlEditor().setValue(h);
      focusDbSql();
    },
  }));
  if (items.length === 0) items.push({ label: t("database.historyEmpty"), disabled: true });
  showMenu(items, anchor);
}

// ---------- 导出 / DDL ----------

/** 导出 CSV：按当前 SQL 重跑一次（上限 10000 行）→ UTF-8 BOM 写盘（Excel 双击不乱码） */
async function exportCsv(): Promise<void> {
  const conn = activeConn();
  if (!conn || !lastSql) {
    toast(t("database.statusIdle"), "info");
    return;
  }
  const target = await saveDialog({
    defaultPath: `${conn.name.replace(/\.[^.]+$/, "")}-${stamp()}.csv`,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!target) return; // 用户取消
  try {
    const full = await invoke<DbQueryResult>("db_query", {
      id: conn.id,
      sql: lastSql,
      limit: EXPORT_MAX_ROWS,
      offset: 0,
    });
    await invoke("write_file", { path: target, content: "\ufeff" + toCsv(full) });
    toast(t("database.exportOk", { path: target }), "success");
  } catch (e) {
    toastFail(t("database.failExport"), e);
  }
}

/** 时间戳（文件名用，本地时间、秒级） */
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 查看建表 / 建索引语句（右键菜单） */
async function showDdl(name: string): Promise<void> {
  const conn = activeConn();
  if (!conn) return;
  try {
    const ddl = await invoke<string>("db_ddl", { id: conn.id, name });
    await openAlert({ title: t("database.ddlTitle", { name }), message: ddl });
  } catch (e) {
    toastFail(t("database.failDdl"), e);
  }
}
