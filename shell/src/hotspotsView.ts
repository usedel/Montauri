// 运行时热点视图（A1 · `docs/improvement_and_roadmap_report.md` §3「A 类 · 深化差异化」）。
//
// 数据来自 Rust 侧 `intel_cmds::scan_runtime_hotspots`（读 probe trace 库 + 扫项目 `def`
// 定义做差集），本模块只负责渲染与动作（照 endpointView.ts 先例）：
// - 上半「已观测」：真实跑过的函数，按调用次数（hits）降序，带 stale / 异常徽章；
// - 下半「未观测到运行」：项目里定义了但 trace 库没有的函数。
//
// **口径纪律**：下半区语义是「未观测到运行」，**不是**「死代码」——可能的正常原因包括
// 未被测试/入口覆盖、条件分支未走到、采样遗漏、进程外调用。UI 文案与提示均按此措辞
// （`hotspots.unobservedHint`），不得改写为"死代码"断言。

import { invoke } from "@tauri-apps/api/core";
import { app, $ } from "./state";
import { basename, codicon, emptyState, errMsg } from "./util";
import { t } from "./i18n";
import { localizeBackendError } from "./i18n/backendError";

/** 单条热点条目（与 Rust `HotspotItem` 同构）。 */
export interface HotspotItem {
  /** 绝对路径（正斜杠）——点击跳转直接交给 openFile → read_file */
  file: string;
  /** 函数限定名（类方法为 `Class.method`） */
  qualname: string;
  /** 定义行号（1 起） */
  line: number;
  /** 运行观测次数（未观测条目恒为 0） */
  hits: number;
  /** 陈旧：该文件在末次运行后被修改 */
  stale: boolean;
  /** 观测到的异常类型 */
  exc: string[];
}

/** 扫描结果（与 Rust `RuntimeHotspots` 同构）。 */
export interface RuntimeHotspots {
  has_data: boolean;
  runs: number;
  last_run: number | null;
  trace_db: string;
  observed: HotspotItem[];
  unobserved: HotspotItem[];
  total_defined: number;
  truncated: boolean;
}

// ---------- handlers 注入（同 endpointView 先例） ----------

export interface HotspotsViewHandlers {
  /** 点击条目 → 打开声明并定位（main.ts 的 openFile） */
  openFile: (path: string, line: number) => void;
}

let handlers: HotspotsViewHandlers | null = null;

export function setHotspotsViewHandlers(h: HotspotsViewHandlers): void {
  handlers = h;
}

// ---------- 状态 ----------

let data: RuntimeHotspots | null = null;
/** 刷新令牌：并发/连续刷新时旧结果不得覆盖新结果（同 endpointView） */
let hpToken = 0;
let loading = false;

/** 初始化运行时热点视图 DOM（init 时调用一次；#view-runtime 容器已在 index.html 声明）。 */
export function initHotspotsView(): void {
  const root = $("view-runtime");
  root.textContent = "";

  const toolbar = document.createElement("div");
  toolbar.id = "hp-toolbar";
  const summary = document.createElement("span");
  summary.id = "hp-summary";
  summary.textContent = "—";
  const refresh = document.createElement("button");
  refresh.id = "hp-refresh";
  refresh.className = "btn btn--ghost btn--icon";
  refresh.dataset.tip = t("hotspots.rescan");
  refresh.setAttribute("aria-label", t("hotspots.rescan"));
  refresh.appendChild(codicon("refresh"));
  refresh.addEventListener("click", () => void refreshHotspots());
  toolbar.append(summary, refresh);

  const list = document.createElement("div");
  list.id = "hp-results";

  root.append(toolbar, list);
  renderHotspots();
}

/** 重新扫描工作区（视图 onShow 与刷新按钮共用）。 */
export async function refreshHotspots(): Promise<void> {
  const list = document.getElementById("hp-results");
  const summary = document.getElementById("hp-summary");
  if (!app.workspaceRoot) {
    data = null;
    renderHotspots();
    return;
  }
  const tk = ++hpToken;
  loading = true;
  if (summary) summary.textContent = t("hotspots.scanning");
  if (list) list.textContent = "";
  let got: RuntimeHotspots;
  try {
    got = await invoke<RuntimeHotspots>("scan_runtime_hotspots", { root: app.workspaceRoot });
  } catch (e) {
    if (tk !== hpToken) return;
    data = null;
    loading = false;
    renderHotspots(t("hotspots.scanFailed", { error: localizeBackendError(errMsg(e)) }));
    return;
  }
  if (tk !== hpToken) return; // 已有更新一轮的扫描，丢弃旧结果
  data = got;
  loading = false;
  renderHotspots();
}

/** 工作区切换 / 关闭时复位（避免旧工作区结果残留）。 */
export function resetHotspotsView(): void {
  hpToken++;
  data = null;
  loading = false;
  renderHotspots();
}

// ---------- 渲染 ----------

/** 末次运行时间（Unix 秒 → 本地短格式）。 */
export function fmtTime(sec: number | null): string {
  if (!sec) return "—";
  try {
    return new Date(sec * 1000).toLocaleString();
  } catch {
    return "—";
  }
}

/** 覆盖率（已观测 / 定义总数，0 定义时为 0）。 */
export function coveragePct(d: RuntimeHotspots): number {
  if (d.total_defined <= 0) return 0;
  return Math.round((d.observed.length / d.total_defined) * 100);
}

/** 渲染面板（error 非空时显示为空态 + 错误说明）。 */
function renderHotspots(error?: string): void {
  const list = document.getElementById("hp-results");
  const summary = document.getElementById("hp-summary");
  if (!list) return;

  const d = data;
  if (summary) {
    // 分支顺序与下方正文一致（error → loading → 无工作区 → 无运行记录）：
    // 无工作区时必须先说"未打开工作区"，否则概要说"暂无运行记录"会误导成"有工作区但没跑过"。
    if (error) summary.textContent = t("hotspots.scanFailedShort");
    else if (loading) summary.textContent = t("hotspots.scanning");
    else if (!app.workspaceRoot) summary.textContent = t("hotspots.noWorkspace");
    else if (!d || !d.has_data) summary.textContent = t("hotspots.noData");
    else
      summary.textContent = `${t("hotspots.summaryObserved", { count: d.observed.length })}　·　${t("hotspots.summaryCoverage", { pct: coveragePct(d) })}`;
  }

  list.textContent = "";
  if (error) {
    list.appendChild(emptyState("pulse", t("hotspots.scanFailedShort"), error, true));
    return;
  }
  if (loading) {
    list.appendChild(emptyState("loading", t("hotspots.scanning"), t("hotspots.scanningHint"), true));
    return;
  }
  if (!app.workspaceRoot) {
    list.appendChild(emptyState("pulse", t("hotspots.noWorkspace"), t("hotspots.noWorkspaceHint"), true));
    return;
  }
  if (!d || !d.has_data) {
    list.appendChild(emptyState("pulse", t("hotspots.noData"), t("hotspots.noDataHint"), true));
    return;
  }

  // 元信息行（运行次数 / 末次运行）
  const meta = document.createElement("div");
  meta.className = "hp-meta";
  meta.textContent = `${t("hotspots.runsCount", { count: d.runs })}　·　${t("hotspots.lastRun", { time: fmtTime(d.last_run) })}`;
  list.appendChild(meta);

  // 上半：已观测
  list.appendChild(sectionHeader(t("hotspots.sectionObserved"), d.observed.length, null));
  if (d.observed.length === 0) {
    list.appendChild(emptyState("pulse", t("hotspots.zeroObserved"), undefined, true));
  } else {
    for (const it of d.observed) list.appendChild(buildRow(it, true));
  }

  // 下半：未观测到运行
  if (d.unobserved.length > 0) {
    list.appendChild(sectionHeader(t("hotspots.sectionUnobserved"), d.unobserved.length, t("hotspots.unobservedHint")));
    for (const it of d.unobserved) list.appendChild(buildRow(it, false));
    if (d.truncated) {
      const tr = document.createElement("div");
      tr.className = "hp-meta";
      tr.textContent = t("hotspots.truncatedHint", { count: d.unobserved.length });
      list.appendChild(tr);
    }
  }
}

/** 分组标题（复用 todo 分组样式；hint 非空时挂 title 提示）。 */
function sectionHeader(title: string, count: number, hint: string | null): HTMLElement {
  const header = document.createElement("div");
  header.className = "todo-group-header";
  const label = document.createElement("span");
  label.className = "hp-section-label";
  label.textContent = title;
  if (hint) {
    label.dataset.tip = hint;
    label.title = hint;
  }
  const badge = document.createElement("span");
  badge.className = "todo-group-count";
  badge.textContent = String(count);
  header.append(label, badge);
  return header;
}

/** 单行条目（observed 决定是否显示 hits / 徽章）。 */
function buildRow(it: HotspotItem, observed: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = "todo-item hp-item";

  const name = document.createElement("span");
  name.className = "hp-name";
  name.textContent = it.qualname;
  name.title = `${it.qualname}　·　${it.file}:${it.line}`;

  const loc = document.createElement("span");
  loc.className = "todo-loc";
  loc.textContent = `${basename(it.file)}:${it.line}`;
  loc.title = it.file;

  row.append(name, loc);

  if (observed) {
    if (it.stale) {
      const stale = document.createElement("span");
      stale.className = "hp-badge hp-badge--stale";
      stale.textContent = t("hotspots.staleBadge");
      stale.dataset.tip = t("hotspots.staleTip");
      stale.title = t("hotspots.staleTip");
      row.appendChild(stale);
    }
    if (it.exc.length > 0) {
      const exc = document.createElement("span");
      exc.className = "hp-badge hp-badge--exc";
      exc.textContent = `⚠ ${it.exc.length}`;
      const tip = t("hotspots.excTip", { types: it.exc.join("、") });
      exc.dataset.tip = tip;
      exc.title = tip;
      row.appendChild(exc);
    }
    const hits = document.createElement("span");
    hits.className = "hp-hits";
    hits.textContent = t("hotspots.hitsSuffix", { count: it.hits });
    row.appendChild(hits);
  }

  // UI-16：可点击行补 button 语义 + 键盘激活（跳转声明是主动作）
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.setAttribute("aria-label", `${it.qualname}，${basename(it.file)}:${it.line}，${t("hotspots.openAria")}`);
  const jump = (): void => handlers?.openFile(it.file, it.line);
  row.addEventListener("click", jump);
  row.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      jump();
    }
  });
  return row;
}
