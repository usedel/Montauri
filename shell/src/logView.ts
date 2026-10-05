// 结构化运行日志视图（B5 · docs/toolbox_dev_plan.md §6.7）
//
// 定位：**当前/最近一次运行的实时结构化视图**（与「运行历史」的分工见 §6.1）。
// v1 只跟最近一次运行（§6.9 决策 1）；纯状态与过滤在 `logStore.ts`，行解析在 `logParse.ts`，
// 本模块只负责 DOM 与**渲染调度**（批量 + rAF + 单帧上限，§6.7.3）。
//
// 纪律：① 禁止逐行 append DOM；② 过滤/搜索绝不动数据（纯显示层）；
// ③ 视图隐藏时只入数组不渲染，显示时整表重建；④ 不改 `output.ts`（只复用其类型）。

import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { app } from "./state";
import { codicon, emptyState } from "./util";
import { showMenu } from "./menu";
import { LOG_FIELDS, formatLogRow, levelLabel, type LogEntry } from "./logParse";
import {
  DEFAULT_MAX_LOG_LINES, EMPTY_FILTER, appendLogText, beginSession, clearLogEntries,
  compileMatcher, createLogState, endSession, resetLogState, visibleEntries,
  type LogFilter, type LogStoreState,
} from "./logStore";
import { addRunDataConsumer } from "./runDataBus";
import { renderJsonTree } from "./jsonTree";
import { bindingLabel } from "./keybindings"; // 提示文案里的「运行历史」入口键位（单一来源）
import type { OutputLogLevel } from "./output";

/** 字段列的中文名（顺序与 `LOG_FIELDS` 一致） */
const FIELD_LABEL_KEY: Record<string, string> = {
  time: "logs.fieldTime",
  level: "logs.fieldLevel",
  logger: "logs.fieldLogger",
  message: "logs.fieldMessage",
  extra: "logs.fieldExtra",
};

/** 自动滚动判定：距底部多少像素内算「贴着底部」（§6.7.5：不能用 scrollTop+clientHeight===scrollHeight） */
const FOLLOW_BOTTOM_EPSILON_PX = 8;

/** 单帧最多渲染的行数（超出分帧续渲染，避免一次插入上万节点卡住主线程，§6.7.3） */
const MAX_ROWS_PER_FRAME = 300;
/** 单个单元格最多渲染的字符数（超出折叠为摘要，§6.6 边界：超长行 > 5 KB） */
const MAX_CELL_CHARS = 5120;
/** 搜索防抖（ms，§6.7.4） */
const SEARCH_DEBOUNCE_MS = 200;

/** 级别 chips 顺序（与 `output.ts` 的 OutputLogLevel 一致） */
const LEVEL_ORDER: readonly OutputLogLevel[] = ["error", "warn", "info", "debug"];
const LEVEL_TEXT_KEY: Record<OutputLogLevel, string> = {
  error: "logs.levelError",
  warn: "logs.levelWarn",
  info: "logs.levelInfo",
  debug: "logs.levelDebug",
};

// ---------- 模块内状态（顶层不解析 DOM，铁律） ----------

const state: LogStoreState = createLogState();
let filter: LogFilter = { ...EMPTY_FILTER, levels: null };
/** 显示的字段列（顺序即列序；默认不含 extra，§6.7.1） */
let fields: string[] = ["time", "level", "logger", "message"];
/** 自动滚动开关（默认开；用户上滚即暂停，回到底部自动恢复，§6.7.5） */
let autoScroll = true;
/** 暂停跟随期间累计的新行数（状态条「↓ N 条新日志」） */
let pendingNew = 0;
/** 保留行数上限（设置项 `log_max_lines`，默认 5000） */
let maxLines = DEFAULT_MAX_LOG_LINES;
let root: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let statusTextEl: HTMLElement | null = null;
let newBtn: HTMLButtonElement | null = null;
let autoScrollEl: HTMLInputElement | null = null;
let hintEl: HTMLElement | null = null;
let levelsEl: HTMLElement | null = null;
let searchEl: HTMLInputElement | null = null;
/** 注入式宿主能力（main.ts 注入：插入编辑器） */
let insertToEditor: ((text: string) => boolean) | null = null;
let visible = false; // 面板是否前台（setBottomTab 通过 setLogPanelVisible 同步）
let dirty = false; // 隐藏期间有新增，恢复前台时整表重建
let frameHandle = 0;
let renderedUpTo = 0; // 已渲染的可见条目下标（增量游标）
let lastDropped = 0; // 上次渲染时的已丢弃数（变化 = 头部被裁 → 必须整表重建）
let hintDismissed = false;
let searchTimer = 0;

// ---------- 渲染调度（§6.7.3：批量 + rAF） ----------

/** rAF 不存在时（测试环境）回落定时器 */
function scheduleFrame(fn: () => void): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
  return setTimeout(fn, 100) as unknown as number;
}
function cancelFrame(h: number): void {
  if (typeof cancelAnimationFrame === "function" && typeof requestAnimationFrame === "function") cancelAnimationFrame(h);
  else clearTimeout(h);
}

/** 请求一次渲染：隐藏时只置脏标记；前台时合并到下一帧 */
function scheduleRender(): void {
  if (!root) return;
  if (!visible) {
    dirty = true;
    return;
  }
  if (frameHandle) return;
  frameHandle = scheduleFrame(() => {
    frameHandle = 0;
    renderChunk();
  });
}

/** 全量重建（过滤/搜索变化、清空、裁剪头部、恢复前台）；**面板不在前台时只置脏标记** */
function rebuild(): void {
  if (!listEl) return;
  dirty = true;
  if (!visible) return; // 隐藏时不碰 DOM，等 setLogPanelVisible(true) 整表重建（§6.7.3）
  listEl.textContent = "";
  renderedUpTo = 0;
  lastDropped = state.dropped;
  dirty = false;
  renderChunk();
}

/** 渲染一帧（最多 MAX_ROWS_PER_FRAME 行）；没渲染完则继续排下一帧 */
function renderChunk(): void {
  if (!listEl || !statusEl) return;
  const rows = visibleEntries(state, filter);
  // 头部被裁（超上限）会让增量游标错位 → 整表重建
  if (state.dropped !== lastDropped) {
    listEl.textContent = "";
    renderedUpTo = 0;
    lastDropped = state.dropped;
  } else if (renderedUpTo > rows.length) {
    listEl.textContent = "";
    renderedUpTo = 0;
  }
  const end = Math.min(rows.length, renderedUpTo + MAX_ROWS_PER_FRAME);
  if (end > renderedUpTo) {
    const frag = document.createDocumentFragment();
    for (let i = renderedUpTo; i < end; i++) frag.appendChild(buildRow(rows[i]));
    listEl.appendChild(frag);
    renderedUpTo = end;
  }
  if (rows.length === 0) renderEmpty();
  else clearEmpty();
  // chips 计数与状态条只在渲染帧更新一次（§6.7.3：高频输出禁止逐块写 DOM）
  updateChips();
  renderStatus(rows.length);
  if (autoScroll) scrollToBottom(); // 跟随底部（分帧续渲染时每帧都跟随，§6.7.5）
  if (renderedUpTo < rows.length) scheduleRender();
}

// ---------- 行渲染 ----------

/** 命中高亮（纯显示层；正则非法时不高亮，避免抛错） */
function highlightInto(el: HTMLElement, text: string): void {
  const q = filter.query.trim();
  if (!q) {
    el.textContent = text;
    return;
  }
  el.textContent = "";
  let re: RegExp | null = null;
  if (filter.regex) {
    try {
      re = new RegExp(q, filter.caseSensitive ? "g" : "gi");
    } catch {
      el.textContent = text;
      return;
    }
  }
  if (re) {
    let last = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "log-hit";
      mark.textContent = m[0];
      el.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
    return;
  }
  const hay = filter.caseSensitive ? text : text.toLowerCase();
  const needle = filter.caseSensitive ? q : q.toLowerCase();
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    if (idx > from) el.appendChild(document.createTextNode(text.slice(from, idx)));
    const mark = document.createElement("mark");
    mark.className = "log-hit";
    mark.textContent = text.slice(idx, idx + needle.length);
    el.appendChild(mark);
    from = idx + needle.length;
  }
  if (from < text.length) el.appendChild(document.createTextNode(text.slice(from)));
}

/** 构造一行：按选中字段出列（**关闭的列不占位**，§6.7.1）+ 可选 JSON 展开 */
function buildRow(e: LogEntry): HTMLElement {
  const row = document.createElement("div");
  const cols = fields.length;
  row.className = `${e.level ? `log-row log-row--${e.level}` : "log-row"} log-row--c${cols}`;

  const cell = (cls: string, text: string, highlight: boolean): void => {
    const span = document.createElement("span");
    span.className = cls;
    // 超长单元格折叠为摘要（§6.6 边界：> 5 KB 不整行塞进 DOM，避免单行撑爆布局与高亮开销）
    const shown = text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)} …` : text;
    if (text.length > MAX_CELL_CHARS) span.classList.add("log-cell--truncated");
    if (highlight) highlightInto(span, shown);
    else span.textContent = shown;
    row.appendChild(span);
  };

  for (const f of fields) {
    if (f === "time") cell("log-ts", e.ts ?? "", false);
    else if (f === "level") cell("log-level", levelLabel(e.level), false);
    else if (f === "logger") cell("log-logger", e.logger ?? "", false);
    else if (f === "message") cell("log-msg", e.message || e.raw, true);
    else if (f === "extra") cell("log-extra", e.extra ? JSON.stringify(e.extra) : "", false);
  }

  if (e.json) {
    const toggle = document.createElement("button");
    toggle.className = "log-json-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", t("logs.expandJson"));
    toggle.dataset.tip = t("logs.expandJson");
    toggle.textContent = "▸";
    let box: HTMLElement | null = null;
    toggle.addEventListener("click", () => {
      if (!box) {
        // 首次点击 = 展开：创建即可见，不挂 .hidden（显隐一律走全局 `.hidden` 类，见 logs-hint 注释）
        box = document.createElement("div");
        box.className = "log-json";
        box.appendChild(renderJsonTree(e.json));
        row.insertAdjacentElement("afterend", box);
      } else {
        box.classList.toggle("hidden");
      }
      toggle.textContent = box.classList.contains("hidden") ? "▸" : "▾";
    });
    // 挂在**最后一个单元格内**：直接 appendChild 到 row 会多出一个网格项而错位
    (row.lastElementChild ?? row).appendChild(toggle);
  }
  return row;
}

/** 带图标的按钮（flash 反馈只改文本，不动图标） */
function labeledButton(label: string, icon: string): { btn: HTMLButtonElement; labelEl: HTMLElement } {
  const btn = document.createElement("button");
  btn.className = "btn btn--sm";
  btn.type = "button";
  btn.appendChild(codicon(icon));
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  btn.appendChild(labelEl);
  return { btn, labelEl };
}

/** 按钮文本瞬时反馈（1.2 s 后还原；取向同 devtools kit 的 flash*） */
function flashLabel(labelEl: HTMLElement, text: string, isError: boolean, orig: string): void {
  labelEl.textContent = text;
  labelEl.classList.toggle("logs-flash--error", isError);
  window.setTimeout(() => {
    labelEl.textContent = orig;
    labelEl.classList.remove("logs-flash--error");
  }, 1200);
}

/** 当前**可见行**的纯文本（复制全部 / 插入编辑器共用；按选中字段格式化，§6.7.7） */
function visibleText(): string {
  return visibleEntries(state, filter)
    .map((e) => formatLogRow(e, fields))
    .join("\n");
}

function renderEmpty(): void {
  if (!listEl) return;
  listEl.textContent = "";
  listEl.appendChild(
    state.entries.length === 0
      ? emptyState("output", t("logs.empty"), t("logs.emptyHint"), true)
      : emptyState("filter", t("logs.noMatch"), t("logs.noMatchHint"), true),
  );
}

function clearEmpty(): void {
  if (!listEl) return;
  const box = listEl.querySelector(".empty-state");
  if (box) box.remove();
}

/** 滚到底部（自动滚动开启时每帧渲染后调用；「↓ N 条新日志」按钮也走这里） */
function scrollToBottom(): void {
  if (!listEl) return;
  listEl.scrollTop = listEl.scrollHeight;
  pendingNew = 0;
}

/** 是否「贴着底部」（浮点误差会让 `scrollTop + clientHeight === scrollHeight` 失效，§6.7.5） */
export function isAtBottom(): boolean {
  if (!listEl) return true;
  return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight <= FOLLOW_BOTTOM_EPSILON_PX;
}

/** scroll 监听：上滚 → 暂停跟随；回到底部 → 自动恢复（并清掉「新日志」计数） */
function wireScrollFollow(): void {
  if (!listEl) return;
  listEl.addEventListener("scroll", () => {
    const atBottom = isAtBottom();
    if (atBottom && !autoScroll) {
      autoScroll = true;
      pendingNew = 0;
      if (autoScrollEl) autoScrollEl.checked = true;
      renderStatus(visibleEntries(state, filter).length);
    } else if (!atBottom && autoScroll) {
      autoScroll = false;
      if (autoScrollEl) autoScrollEl.checked = false;
    }
  });
}

/** 状态条：`共 N 行 · 显示 M` + 已丢弃 + 相位 + 「↓ N 条新日志」（§6.7.1 / §6.7.5） */
function renderStatus(shown: number): void {
  if (!statusEl || !statusTextEl) return;
  const parts: string[] = [t("logs.statusCounts", { total: state.entries.length, shown })];
  if (state.dropped > 0) parts.push(t("logs.statusDropped", { dropped: state.dropped }));
  if (state.phase === "ended") {
    parts.push(state.exitCode === null ? t("logs.ended") : t("logs.statusEnded", { code: state.exitCode }));
  } else if (state.phase === "live") {
    parts.push(t("logs.statusLive"));
  }
  const err = compileMatcher(filter).error;
  let text = parts.join(" · ");
  if (err) text += ` · ${t("logs.regexError", { error: err })}`;
  statusTextEl.textContent = text;
  statusEl.classList.toggle("logs-status--error", !!err);
  // 「↓ N 条新日志」（暂停跟随期间才有；点击跳到底部并恢复跟随）
  if (newBtn) {
    newBtn.classList.toggle("hidden", pendingNew <= 0);
    newBtn.textContent = t("logs.newLogs", { n: pendingNew });
  }
}

// ---------- chips / 工具条 ----------

function updateChips(): void {
  if (!levelsEl) return;
  for (const btn of levelsEl.querySelectorAll<HTMLElement>(".log-chip")) {
    const lvl = btn.dataset.level as OutputLogLevel | undefined;
    if (!lvl) continue;
    const on = !filter.levels || filter.levels.size === 0 || filter.levels.has(lvl);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
    const badge = btn.querySelector<HTMLElement>(".log-chip-count");
    if (badge) {
      const n = state.counts[lvl] ?? 0;
      badge.textContent = n > 0 ? String(n) : "";
      badge.classList.toggle("hidden", n === 0);
    }
  }
}

/** 级别 chip 点击：普通点击切换该项；`Shift+点击` = 只留该项（对齐终端惯例，§6.7.4） */
function toggleLevel(lvl: OutputLogLevel, shift: boolean): void {
  const cur = new Set(filter.levels ?? LEVEL_ORDER);
  if (shift) {
    filter.levels = cur.size === 1 && cur.has(lvl) ? new Set(LEVEL_ORDER) : new Set([lvl]);
  } else {
    if (cur.has(lvl)) cur.delete(lvl);
    else cur.add(lvl);
    filter.levels = cur.size === LEVEL_ORDER.length || cur.size === 0 ? null : cur;
  }
  updateChips();
  rebuild();
}

// ---------- 构建 ----------

function buildDom(host: HTMLElement): void {
  host.textContent = "";
  // **不能覆盖 className**：面板容器由 termUi 用 `hidden` 类控制显隐，整体赋值会把 hidden 抹掉
  // （实测：初始化后面板在所有 tab 下都可见）。只追加自己的类。
  host.classList.add("logs-panel");

  // 首次使用提示（可关闭；会话级——不引入新的持久化通道）。
  // 显隐一律走全局 `.hidden` 类（带 `!important`），**不能用 `hidden` 属性**：
  // 本元素有 `display: flex` 的作者样式，会盖掉 hidden 属性的 UA `display:none`（实测点了没反应）。
  hintEl = document.createElement("div");
  hintEl.className = "logs-hint";
  hintEl.classList.toggle("hidden", hintDismissed);
  const hintText = document.createElement("span");
  // 带上「运行历史」的实际入口键位（键位可自定义，走 bindingLabel 单一来源）
  hintText.textContent = t("logs.hint", { key: bindingLabel("run_history") || "Ctrl+Shift+R" });
  const hintBtn = document.createElement("button");
  hintBtn.className = "btn btn--sm";
  hintBtn.type = "button";
  hintBtn.textContent = t("logs.hintDismiss");
  hintBtn.addEventListener("click", () => {
    hintDismissed = true;
    hintEl?.classList.add("hidden");
  });
  hintEl.appendChild(hintText);
  hintEl.appendChild(hintBtn);
  host.appendChild(hintEl);

  // 级别 chips
  levelsEl = document.createElement("div");
  levelsEl.className = "logs-levels";
  levelsEl.setAttribute("role", "group");
  for (const lvl of LEVEL_ORDER) {
    const chip = document.createElement("button");
    chip.className = "log-chip";
    chip.type = "button";
    chip.dataset.level = lvl;
    chip.setAttribute("aria-pressed", "false");
    const label = document.createElement("span");
    label.textContent = t(LEVEL_TEXT_KEY[lvl] as "logs.levelError");
    const badge = document.createElement("span");
    badge.className = "log-chip-count";
    badge.textContent = "";
    chip.appendChild(label);
    chip.appendChild(badge);
    chip.addEventListener("click", (ev) => toggleLevel(lvl, (ev as MouseEvent).shiftKey));
    levelsEl.appendChild(chip);
  }
  host.appendChild(levelsEl);

  // 搜索行
  const bar = document.createElement("div");
  bar.className = "logs-bar";
  searchEl = document.createElement("input");
  searchEl.className = "logs-search";
  searchEl.type = "search";
  searchEl.placeholder = t("logs.searchPh");
  searchEl.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      filter.query = searchEl?.value ?? "";
      rebuild();
    }, SEARCH_DEBOUNCE_MS) as unknown as number;
  });
  bar.appendChild(searchEl);

  const caseBtn = document.createElement("button");
  caseBtn.className = "out-chip";
  caseBtn.type = "button";
  caseBtn.textContent = t("logs.case");
  caseBtn.title = t("logs.caseTip");
  caseBtn.setAttribute("aria-label", t("logs.caseTip"));
  caseBtn.setAttribute("aria-pressed", "false");
  caseBtn.addEventListener("click", () => {
    filter.caseSensitive = !filter.caseSensitive;
    caseBtn.setAttribute("aria-pressed", String(filter.caseSensitive));
    rebuild();
  });
  bar.appendChild(caseBtn);

  const regexBtn = document.createElement("button");
  regexBtn.className = "out-chip";
  regexBtn.type = "button";
  regexBtn.textContent = t("logs.regex");
  regexBtn.title = t("logs.regexTip");
  regexBtn.setAttribute("aria-label", t("logs.regexTip"));
  regexBtn.setAttribute("aria-pressed", "false");
  regexBtn.addEventListener("click", () => {
    filter.regex = !filter.regex;
    regexBtn.setAttribute("aria-pressed", String(filter.regex));
    rebuild();
  });
  bar.appendChild(regexBtn);

  // 字段列多选（§6.7.1：关闭的列不占位）
  const fieldsBtn = document.createElement("button");
  fieldsBtn.className = "out-chip";
  fieldsBtn.type = "button";
  fieldsBtn.textContent = `${t("logs.fields")} ▾`;
  fieldsBtn.setAttribute("aria-haspopup", "menu");
  fieldsBtn.addEventListener("click", (ev) => {
    showMenu(
      LOG_FIELDS.map((f) => ({
        label: `${fields.includes(f) ? "✓" : "\u2003"} ${t(FIELD_LABEL_KEY[f] as "logs.fieldTime")}`,
        action: () => {
          if (fields.includes(f)) {
            if (fields.length <= 1) return; // 至少留一列（全关会让行变成空白）
            fields = fields.filter((x) => x !== f);
          } else {
            fields = LOG_FIELDS.filter((x) => fields.includes(x) || x === f);
          }
          rebuild();
        },
      })),
      ev.currentTarget as HTMLElement,
    );
  });
  bar.appendChild(fieldsBtn);

  const spacer = document.createElement("span");
  spacer.className = "spacer";
  bar.appendChild(spacer);

  // 自动滚动（§6.7.5：默认开；用户上滚即暂停，回到底部自动恢复）
  const autoLabel = document.createElement("label");
  autoLabel.className = "logs-autoscroll";
  autoScrollEl = document.createElement("input");
  autoScrollEl.type = "checkbox";
  autoScrollEl.checked = true;
  autoScrollEl.addEventListener("change", () => {
    autoScroll = autoScrollEl?.checked ?? true;
    if (autoScroll) scrollToBottom();
    renderStatus(visibleEntries(state, filter).length);
  });
  autoLabel.appendChild(autoScrollEl);
  const autoText = document.createElement("span");
  autoText.textContent = t("logs.autoscroll");
  autoLabel.appendChild(autoText);
  bar.appendChild(autoLabel);

  // 导出：复制全部 / 插入编辑器（v1 不做保存到磁盘，与 B4 同口径，§6.7.7）
  const copy = labeledButton(t("logs.copyAll"), "copy");
  copy.btn.title = t("logs.copyAllTip");
  copy.btn.addEventListener("click", () => {
    const text = visibleText();
    if (!text) return flashLabel(copy.labelEl, t("logs.noContent"), true, t("logs.copyAll"));
    void invoke("copy_to_clipboard", { text })
      .then(() => flashLabel(copy.labelEl, t("logs.copied"), false, t("logs.copyAll")))
      .catch(() => flashLabel(copy.labelEl, t("logs.copyFailed"), true, t("logs.copyAll")));
  });
  bar.appendChild(copy.btn);

  const insert = labeledButton(t("logs.insertEditor"), "export");
  insert.btn.title = t("logs.insertEditorTip");
  insert.btn.addEventListener("click", () => {
    const text = visibleText();
    if (!text) return flashLabel(insert.labelEl, t("logs.noContent"), true, t("logs.insertEditor"));
    const ok = insertToEditor ? insertToEditor(text) : false;
    flashLabel(insert.labelEl, ok ? t("logs.inserted") : t("logs.noFileOpen"), !ok, t("logs.insertEditor"));
  });
  bar.appendChild(insert.btn);

  const clear = labeledButton(t("logs.clear"), "clear-all");
  clear.btn.title = t("logs.clearTip");
  clear.btn.addEventListener("click", () => {
    clearLogEntries(state);
    pendingNew = 0;
    rebuild();
  });
  bar.appendChild(clear.btn);
  host.appendChild(bar);

  // 列表 + 状态条
  listEl = document.createElement("div");
  listEl.className = "logs-list";
  listEl.setAttribute("role", "log");
  host.appendChild(listEl);
  wireScrollFollow();

  statusEl = document.createElement("div");
  statusEl.className = "logs-status";
  newBtn = document.createElement("button");
  newBtn.className = "logs-new-btn";
  newBtn.type = "button";
  newBtn.classList.add("hidden"); // 同 logs-hint：显隐走 `.hidden` 类而非 hidden 属性
  newBtn.addEventListener("click", () => {
    autoScroll = true;
    if (autoScrollEl) autoScrollEl.checked = true;
    scrollToBottom();
    renderStatus(visibleEntries(state, filter).length);
  });
  statusTextEl = document.createElement("span");
  statusTextEl.className = "logs-status-text";
  statusEl.appendChild(newBtn);
  statusEl.appendChild(statusTextEl);
  host.appendChild(statusEl);
}

// ---------- 对外 API ----------

/** 初始化视图（main.ts 调用一次）；面板容器 = `#logs-panel` */
export function initLogView(): void {
  const host = document.getElementById("logs-panel");
  if (!host || root) return;
  root = host;
  buildDom(host);
  renderChunk(); // 内含 chips 计数与状态条的首帧刷新
  addRunDataConsumer(ingestLogText);
}

/** 消费一块运行输出（runDataBus 消费者；只认绑定的实例）。
 *  只入数组 + 排一帧渲染——chips 计数/状态条都留给渲染帧统一更新。 */
export function ingestLogText(instanceId: string, text: string): void {
  const added = appendLogText(state, instanceId, text, maxLines);
  if (added <= 0) return;
  if (!autoScroll) pendingNew += added; // 暂停跟随期间：累计新行（状态条提示，§6.7.5）
  scheduleRender();
}

/** 新运行开始（`idle → live`，清空重来）——由 runHistory 的生命周期事件转发。
 *  注意**不重置搜索/字段**：用户可能在连续调试同一问题（过滤条件是偏好，跨运行保留）。 */
export function beginLogSession(instanceId: string): void {
  beginSession(state, instanceId);
  rebuild();
}

/** 运行结束（`live → ended`）——由 runHistory 的生命周期事件转发 */
export function endLogSession(instanceId: string, code: number | null): void {
  const before = state.phase;
  endSession(state, instanceId, code, maxLines);
  if (before !== state.phase || state.phase === "ended") scheduleRender();
}

/** 底部面板切到/切离「运行日志」（termUi::setBottomTab 调用） */
export function setLogPanelVisible(v: boolean): void {
  visible = v;
  if (v && dirty) rebuild();
}

/** 注入宿主能力（main.ts 调用：插入编辑器；logView 不直接依赖编辑器域） */
export function setLogViewHandlers(h: { insertToEditor: (text: string) => boolean }): void {
  insertToEditor = h.insertToEditor;
}

/**
 * 应用设置（main.ts 在启动与设置保存后调用）：
 * `log_max_lines` 行数上限；`log_structured_enabled=false` 时隐藏底部 tab（§6.7.8）。
 * **切走当前 tab 由 main.ts 负责**（logView 不反向依赖 termUi，避免循环导入）。
 * @returns 是否仍启用（调用方据此决定要不要把当前 tab 切回「输出」）
 */
export function applyLogSettings(): boolean {
  const s = app.settings;
  const n = Number(s.log_max_lines);
  maxLines = Number.isFinite(n) && n >= 100 ? Math.floor(n) : DEFAULT_MAX_LOG_LINES;
  const enabled = s.log_structured_enabled !== false;
  const tab = document.getElementById("tab-logs");
  if (tab) tab.hidden = !enabled;
  return enabled;
}

/** 关闭/切换工作区：清空并解绑（与 `resetRunHistory` 同处调用） */
export function resetLogView(): void {
  resetLogState(state);
  filter = { ...EMPTY_FILTER, levels: null };
  autoScroll = true;
  pendingNew = 0;
  if (autoScrollEl) autoScrollEl.checked = true;
  if (searchEl) searchEl.value = "";
  if (frameHandle) {
    cancelFrame(frameHandle);
    frameHandle = 0;
  }
  updateChips();
  rebuild();
}

/** 立即渲染（跳过 rAF 合并）——单测与强制刷新用 */
export function flushLogView(): void {
  if (frameHandle) {
    cancelFrame(frameHandle);
    frameHandle = 0;
  }
  if (!visible) {
    dirty = true; // 面板不在前台：只置脏标记，等 setLogPanelVisible(true) 再整表重建（§6.7.3）
    return;
  }
  renderChunk();
}

/** 状态快照（单测 / 诊断用；只读语义，勿改） */
export function logViewSnapshot(): {
  phase: string;
  total: number;
  dropped: number;
  exitCode: number | null;
  fields: string[];
  autoScroll: boolean;
  pendingNew: number;
  maxLines: number;
  visible: boolean;
  renderedUpTo: number;
  wired: boolean;
} {
  return {
    phase: state.phase,
    total: state.entries.length,
    dropped: state.dropped,
    exitCode: state.exitCode,
    fields: [...fields],
    autoScroll,
    pendingNew,
    maxLines,
    visible,
    renderedUpTo,
    wired: root !== null,
  };
}

/** 切换字段列（单测用；等价于点「字段 ▾」菜单项） */
export function toggleLogField(field: string): void {
  if (fields.includes(field)) {
    if (fields.length <= 1) return;
    fields = fields.filter((x) => x !== field);
  } else {
    fields = LOG_FIELDS.filter((x) => fields.includes(x) || x === field);
  }
  rebuild();
}

/** 视图根元素（单测用） */
export function logViewRoot(): HTMLElement | null {
  return root;
}
