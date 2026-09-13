// 运行历史（P2 · PyCharm Run 工具窗「保留历史标签页」对标）：把每次运行的转录
// 按次留存，可回看、可再点 traceback 跳转。
//
// 为什么值得做：输出面板是**单份**的——新一轮运行会清掉上一轮，而调试一个失败脚本
// 时最想要的恰恰是「上一次的报错长什么样」。PyCharm 的解法是 Run 窗口保留历史标签页，
// 这里用「历史列表 + 回填输出面板」达到同等效果（不引入第二套输出渲染）。
//
// 落地方式：只在 main.ts 的三处转发点挂钩（stdout / stderr / exit），
// 复用 RunTranscript 已经还原好的**整行**，不重复解析 chunk。

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
  /** 被运行的脚本路径 */
  path: string;
  startedAt: number;
  finishedAt: number | null;
  /** 退出码；运行被中断时为 null */
  code: number | null;
  lines: RunLine[];
}

export interface RunHistoryHandlers {
  clearOutput: () => void;
  appendLine: (cls: string, text: string) => void;
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

/** 开始记录一次运行 */
export function startRun(path: string): void {
  current = { id: nextId++, path, startedAt: Date.now(), finishedAt: null, code: null, lines: [] };
  runs.push(current);
  if (runs.length > MAX_RUNS) runs.splice(0, runs.length - MAX_RUNS);
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
}

/** 全部历史（从新到旧） */
export function listRuns(): RunRecord[] {
  return [...runs].reverse();
}

/** 清掉某次记录 */
export function removeRun(id: number): void {
  const i = runs.findIndex((r) => r.id === id);
  if (i >= 0) runs.splice(i, 1);
}

/** 清空历史（工作区切换） */
export function resetRunHistory(): void {
  runs.length = 0;
  current = null;
}

// ---------- UI ----------

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
  return `${clockOf(r.startedAt)} · ${r.lines.length} 行 · ${dur} · 退出码 ${code}`;
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
    if (!Number.isNaN(id)) showRun(id);
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
      if (r) {
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

/** 把某次运行的转录回填到输出面板（用户视点：回看这一轮） */
function showRun(id: number): void {
  const r = runs.find((x) => x.id === id);
  if (!r) return;
  closeRunHistory();
  handlers?.clearOutput();
  for (const l of r.lines) handlers?.appendLine(l.cls, l.text);
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
    name.textContent = basename(r.path);
    const path = document.createElement("span");
    path.className = "run-history-path";
    path.textContent = app.workspaceRoot ? relativePath(app.workspaceRoot, r.path) : r.path;
    path.title = r.path;
    const meta = document.createElement("span");
    meta.className = "run-history-meta";
    meta.textContent = summaryOf(r);
    row.append(name, path, meta);

    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        showRun(r.id);
      }
    });
    list.appendChild(row);
  });
}
