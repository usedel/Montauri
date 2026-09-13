// 运行历史（P2 · PyCharm Run 工具窗「保留历史标签页」对标）：把每次运行的转录
// 按次留存，可回看、可再点 traceback 跳转。
//
// P2-M 升级（对标 Run 工具窗「每配置一标签」）：输出面板头部新增「运行标签条」——
// - 每次运行一个 chip（含运行中的**活标签**），点击把该次输出快照回填到输出面板；
// - Pin（图钉）：豁免留存上限淘汰——调试时最想留的那条报错不被新运行挤掉；
// - 重跑：按记录原始形态重跑（命名配置按名重跑；文件运行激活 tab 后运行）；
//   Ctrl+F5 全局「停止并重新运行」保持不变（重跑上一次）。
// - P2-O：保存当前查看记录的输出到文本文件（对标 Save console output to file）。
//
// 查看语义：viewingId 跟随最新运行（新运行自动激活自己的 chip，PyCharm 同款）；
// 回看历史记录期间，运行输出**仅入档不渲染面板**（main.ts 按 isViewingLive 分流，
// 后台入档按 chunk 尽力切行、半行直接成行——行界为近似值，回看场景可接受）。
//
// 落地方式：main.ts 在事件转发点挂钩（stdout / stderr / exit），复用 RunTranscript
// 已经还原好的**整行**，不重复解析 chunk；本模块只管留存 / 标签条 / 回填。

import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { app } from "./state";
import { basename, emptyState, relativePath } from "./util";

export interface RunLine {
  cls: string;
  text: string;
}

export interface RunRecord {
  id: number;
  /** 被运行的脚本路径；命名配置运行为 `profile:<名>` */
  path: string;
  /** P2-M：命名配置运行时记录配置名（重跑路由用；null = 文件运行） */
  profileName: string | null;
  /** 运行通道（重跑路由用） */
  channel: "output" | "terminal";
  startedAt: number;
  finishedAt: number | null;
  /** 退出码；运行被中断时为 null */
  code: number | null;
  lines: RunLine[];
  /** P2-M：Pin——豁免 MAX_RUNS 淘汰 */
  pinned: boolean;
}

export interface RunHistoryHandlers {
  clearOutput: () => void;
  appendLine: (cls: string, text: string) => void;
  /** P2-M：标签条「重跑」按钮（main.ts 按记录路由：runProfile / runFile） */
  rerun: (r: RunRecord) => void;
}

let handlers: RunHistoryHandlers | null = null;

export function setRunHistoryHandlers(h: RunHistoryHandlers): void {
  handlers = h;
}

// ---------- 存储 ----------

/** 留存次数上限（防长会话内存无界增长） */
const MAX_RUNS = 20;
/** 单次留存行数上限（超长输出只留尾部——报错总在最后） */
const MAX_LINES_PER_RUN = 3000;

const runs: RunRecord[] = [];
let nextId = 1;
let current: RunRecord | null = null;
/** 输出面板正在查看的记录（新运行自动切到最新；点击历史 chip 固定） */
let viewingId: number | null = null;

/** 开始记录一次运行（P2-M：新运行自动激活自己的标签） */
export function startRun(path: string, channel: "output" | "terminal" = "output", profileName: string | null = null): void {
  current = {
    id: nextId++,
    path,
    profileName,
    channel,
    startedAt: Date.now(),
    finishedAt: null,
    code: null,
    lines: [],
    pinned: false,
  };
  runs.push(current);
  viewingId = current.id;
  // 淘汰：从最旧找**未 Pin**的记录移除（Pinned 豁免；运行中的 current 不会被移除）
  while (runs.length > MAX_RUNS) {
    const idx = runs.findIndex((r) => !r.pinned && r !== current);
    if (idx < 0) break;
    runs.splice(idx, 1);
  }
  renderRunTabs();
}

/** 记录若干输出行（RunTranscript.write / flush 的返回值） */
export function recordLines(cls: string, lines: string[]): void {
  if (!current || lines.length === 0) return;
  for (const text of lines) current.lines.push({ cls, text });
  // 超限时保留尾部：脚本报错信息永远在最后，头部被截反而更可用
  if (current.lines.length > MAX_LINES_PER_RUN) {
    current.lines.splice(0, current.lines.length - MAX_LINES_PER_RUN);
  }
}

/** 结束记录（run-exit） */
export function finishRun(code: number | null): void {
  if (!current) return;
  current.finishedAt = Date.now();
  current.code = code;
  current = null;
  renderRunTabs();
}

/** 全部历史（从新到旧） */
export function listRuns(): RunRecord[] {
  return [...runs].reverse();
}

/** 清掉某次记录 */
export function removeRun(id: number): void {
  const i = runs.findIndex((r) => r.id === id);
  if (i >= 0) runs.splice(i, 1);
  if (viewingId === id) viewingId = null;
  renderRunTabs();
}

/** 清空历史（工作区切换） */
export function resetRunHistory(): void {
  runs.length = 0;
  current = null;
  viewingId = null;
  renderRunTabs();
}

// ---------- 查看分流（P2-M） ----------

/** 输出面板是否正跟随最新运行（false = 用户在回看历史记录，新输出仅入档） */
export function isViewingLive(): boolean {
  return viewingId === null || (current !== null && viewingId === current.id);
}

/** 回填某次运行的转录到输出面板（用户视点：回看这一轮） */
export function viewRun(id: number): void {
  const r = runs.find((x) => x.id === id);
  if (!r) return;
  viewingId = id;
  handlers?.clearOutput();
  for (const l of r.lines) handlers?.appendLine(l.cls, l.text);
  renderRunTabs();
}

/** P2-M：切换 Pin 状态（豁免淘汰） */
export function togglePin(id: number): void {
  const r = runs.find((x) => x.id === id);
  if (!r) return;
  r.pinned = !r.pinned;
  renderRunTabs();
}

// ---------- 标签条 UI（P2-M） ----------

let tabsEl: HTMLElement | null = null;

/** chip 展示名：配置运行用配置名，文件运行用文件名 */
function displayName(r: RunRecord): string {
  return r.profileName ?? basename(r.path);
}

export function initRunTabs(): void {
  const bar = document.getElementById("run-tabs");
  if (!bar) return;
  tabsEl = bar;
  bar.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>(".run-tab");
    if (!chip) return;
    const id = Number(chip.dataset.id);
    const r = runs.find((x) => x.id === id);
    if (!r) return;
    if (t.closest(".run-tab-pin")) {
      togglePin(id);
      return;
    }
    if (t.closest(".run-tab-rerun")) {
      handlers?.rerun(r);
      return;
    }
    if (t.closest(".run-tab-close")) {
      if (r === current) return; // 运行中的记录不移除
      removeRun(id);
      return;
    }
    viewRun(id);
  });
  renderRunTabs();
}

/** 重绘标签条（startRun / finishRun / pin / remove 后调用；高频 renderTabs 不经过这里） */
export function renderRunTabs(): void {
  const bar = tabsEl;
  if (!bar) return;
  bar.textContent = "";
  for (const r of runs) {
    const chip = document.createElement("div");
    chip.className = `run-tab${r.id === viewingId ? " active" : ""}${r.finishedAt === null ? " running" : ""}`;
    chip.dataset.id = String(r.id);
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(r.id === viewingId));
    chip.tabIndex = 0;

    const name = document.createElement("span");
    name.className = "run-tab-name";
    name.textContent = displayName(r);
    name.title = r.profileName ? `运行配置：${r.profileName}` : r.path;

    const meta = document.createElement("span");
    meta.className = "run-tab-meta";
    meta.textContent = r.finishedAt === null ? "运行中" : r.pinned ? "已固定" : `exit ${r.code ?? "—"}`;

    const pin = document.createElement("button");
    pin.className = `run-tab-btn run-tab-pin${r.pinned ? " pinned" : ""}`;
    pin.setAttribute("aria-label", r.pinned ? "取消固定" : "固定该记录（不被淘汰）");
    pin.dataset.tip = r.pinned ? "取消固定" : "固定（不被淘汰）";
    pin.innerHTML = '<i class="codicon codicon-pin" aria-hidden="true"></i>';

    const rerun = document.createElement("button");
    rerun.className = "run-tab-btn run-tab-rerun";
    rerun.setAttribute("aria-label", "重新运行");
    rerun.dataset.tip = "重新运行";
    rerun.innerHTML = '<i class="codicon codicon-debug-restart" aria-hidden="true"></i>';

    chip.append(name, meta, pin, rerun);

    if (r !== current) {
      const close = document.createElement("button");
      close.className = "run-tab-btn run-tab-close";
      close.setAttribute("aria-label", "移除该记录");
      close.dataset.tip = "移除记录";
      close.innerHTML = '<i class="codicon codicon-close" aria-hidden="true"></i>';
      chip.appendChild(close);
    }

    chip.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        viewRun(r.id);
      }
    });
    bar.appendChild(chip);
  }
}

/** P2-O：把当前查看记录的输出写入文本文件（对标 PyCharm Save console output to file） */
export async function saveCurrentOutput(): Promise<void> {
  const r = runs.find((x) => x.id === viewingId) ?? current;
  if (!r) return;
  const stamp = new Date(r.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const path = await saveDialog({
    defaultPath: `${displayName(r)}-${stamp}.log`,
    filters: [{ name: "运行输出", extensions: ["log", "txt"] }],
  });
  if (!path) return;
  const content = r.lines.map((l) => l.text).join("\n") + "\n";
  try {
    await invoke("write_file", { path, content });
    handlers?.appendLine("hint", `已保存运行输出：${path}`);
  } catch (e) {
    handlers?.appendLine("stderr", `保存运行输出失败：${e}`);
  }
}

// ---------- 历史列表弹窗（P2 首版形态，保留：批量回看 / 键盘删除） ----------

let modalEl: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let releaseFocus: (() => void) | null = null;
let sel = 0;

/** 时间 → HH:MM:SS */
function clockOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 状态摘要（退出码 / 行数 / 时长） */
function summaryOf(r: RunRecord): string {
  const dur = r.finishedAt ? `${((r.finishedAt - r.startedAt) / 1000).toFixed(1)}s` : "运行中…";
  const code = r.code === null ? "—" : String(r.code);
  const pin = r.pinned ? "已固定 · " : "";
  return `${pin}${clockOf(r.startedAt)} · ${r.lines.length} 行 · ${dur} · 退出码 ${code}`;
}

export function initRunHistory(): void {
  const host = document.getElementById("run-history-modal");
  if (!host) return;
  host.textContent = "";
  const card = document.createElement("div");
  card.className = "modal-card run-history-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "运行历史");
  const list = document.createElement("div");
  list.id = "run-history-list";
  list.className = "run-history-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "历史运行记录");
  card.appendChild(list);
  host.appendChild(card);
  modalEl = host;
  listEl = list;

  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".run-history-item");
    const id = row ? Number(row.dataset.id) : NaN;
    if (!Number.isNaN(id)) {
      viewRun(id);
      closeRunHistory();
    }
  });
  host.addEventListener("mousedown", (e) => {
    if (e.target === host) closeRunHistory();
  });
  document.addEventListener("keydown", (e) => {
    if (!isRunHistoryOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeRunHistory();
    } else if (e.key === "Delete") {
      const r = listRuns()[sel];
      if (r && r !== current) {
        e.preventDefault();
        removeRun(r.id);
        sel = Math.max(0, sel - 1);
        renderList();
      }
    }
  });
}

export function isRunHistoryOpen(): boolean {
  return !!modalEl && !modalEl.classList.contains("hidden");
}

export function openRunHistory(): void {
  if (!modalEl) return;
  sel = 0;
  showEl(modalEl);
  releaseFocus?.();
  releaseFocus = trapFocus(modalEl);
  renderList();
}

export function closeRunHistory(): void {
  if (!modalEl) return;
  releaseFocus?.();
  releaseFocus = null;
  hideEl(modalEl);
}

function renderList(): void {
  const list = listEl;
  if (!list) return;
  list.textContent = "";
  const items = listRuns();
  if (items.length === 0) {
    list.appendChild(emptyState("debug-alt", "暂无运行记录", "运行一次脚本后，这里会保留它的完整输出"));
    return;
  }
  items.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = `run-history-item${i === sel ? " active" : ""}`;
    row.dataset.id = String(r.id);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === sel));
    row.tabIndex = 0;

    const name = document.createElement("span");
    name.className = "run-history-name";
    name.textContent = displayName(r);
    const path = document.createElement("span");
    path.className = "run-history-path";
    path.textContent = app.workspaceRoot && !r.profileName ? relativePath(app.workspaceRoot, r.path) : displayName(r);
    path.title = r.path;
    const meta = document.createElement("span");
    meta.className = "run-history-meta";
    meta.textContent = summaryOf(r);
    row.append(name, path, meta);

    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        viewRun(r.id);
        closeRunHistory();
      }
    });
    list.appendChild(row);
  });
}
