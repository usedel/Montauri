// TODO 工具窗（P0，PyCharm TODO tool window 对标）：扫描工作区的 TODO/FIXME 等标记并列出。
//
// 扫描在 Rust 侧（`fs_cmds::scan_todos`），复用 `search_workspace` 的 `ignore` 走查
// （.gitignore 感知 + 隐藏过滤 + 噪声目录剪枝），本模块只负责渲染与跳转：
// - 两种分组：按标记（P0 形态）/ 按文件（B6-3），可切换，组头可折叠；
// - 关键字过滤：匹配 标记 / 说明 / 整行原文 / 路径，大小写不敏感，200ms 防抖；
// - 每行显示「文件:行号 + 说明」，点击/Enter 跳转源码；
// - 结果用令牌防乱序（同 search.ts / 大纲的既有做法）。
//
// B6-3（docs/toolbox_dev_plan.md §7.3）：Rust `scan_todos` 已返回 `path` / `line`
// （`fs_cmds.rs:1110`），跳转 handler 也已在位，故本轮**纯前端**、不动后端。
// 过滤与分组抽成纯函数（filterTodos / groupTodosByTag / groupTodosByFile），
// 单测见 `src/__tests__/todoView.test.ts`。

import { invoke } from "@tauri-apps/api/core";
import { app, $ } from "./state";
import { basename, codicon, emptyState, errMsg } from "./util";
import { t, onLocaleChange } from "./i18n"; // 第十二批 i18n：TODO 视图动态文案走语言包
import { localizeBackendError } from "./i18n/backendError";

export interface TodoMatch {
  path: string;
  line: number;
  /** 归一化标记（大写，如 "TODO"） */
  tag: string;
  /** 标记之后的说明文字 */
  message: string;
  /** 整行原文（trim 后） */
  text: string;
}

/** 分组模式：按标记（默认，沿用 P0 形态）/ 按文件（B6-3） */
export type TodoGroupMode = "tag" | "file";

/** 分组结果：两种模式归一成同一形态，渲染层不必按模式分支 */
export interface TodoGroup {
  /** 组键（tag 模式为标记名，file 模式为文件绝对路径） */
  key: string;
  /** 组头文本（file 模式为文件名） */
  label: string;
  /** 组头悬浮提示（file 模式给完整路径） */
  title: string;
  /** 组头徽标文本（tag 模式有；file 模式为 null，改用文件名） */
  badge: string | null;
  items: TodoMatch[];
}

/** 分组展示顺序（与 Rust TODO_TAGS 一致） */
const TAG_ORDER = ["TODO", "FIXME", "HACK", "BUG", "XXX"];

/** 标记 → 徽标类名后缀（小写；CSS 侧 .todo-badge-<tag>） */
const tagClass = (tag: string): string => `todo-badge todo-badge-${tag.toLowerCase()}`;

/** 过滤防抖（毫秒）：清单上限 2000 条（Rust MAX_TODOS），逐键重建 DOM 会卡手 */
const FILTER_DEBOUNCE_MS = 200;

// ---------- 纯函数（单测见 __tests__/todoView.test.ts） ----------

/**
 * 关键字过滤：空 / 纯空白原样返回；否则按 标记 / 说明 / 整行原文 / 路径 做
 * 大小写不敏感子串匹配（命中任一字段即保留）。
 */
export function filterTodos(items: readonly TodoMatch[], query: string): TodoMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (m) =>
      m.tag.toLowerCase().includes(q) ||
      m.message.toLowerCase().includes(q) ||
      m.text.toLowerCase().includes(q) ||
      m.path.toLowerCase().includes(q),
  );
}

/** 标记排序权重：TAG_ORDER 内的按序在前，未登记标记排最后并按字典序 */
function tagRank(a: string, b: string): number {
  const ia = TAG_ORDER.indexOf(a);
  const ib = TAG_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

/** 按标记分组（无命中的组不出现；组间按 tagRank 排） */
export function groupTodosByTag(items: readonly TodoMatch[]): TodoGroup[] {
  const map = new Map<string, TodoMatch[]>();
  for (const m of items) {
    const arr = map.get(m.tag);
    if (arr) arr.push(m);
    else map.set(m.tag, [m]);
  }
  return [...map.keys()]
    .sort(tagRank)
    .map((tag) => ({ key: tag, label: tag, title: tag, badge: tag, items: map.get(tag)! }));
}

/**
 * 按文件分组。Rust 侧已按「文件 → 行号」排好序，故按首次出现顺序建组即路径有序，
 * 这里**不再自行排序**——再排一次可能与 Rust 的排序口径分叉（同 search.ts 的纪律）。
 */
export function groupTodosByFile(items: readonly TodoMatch[]): TodoGroup[] {
  const map = new Map<string, TodoMatch[]>();
  for (const m of items) {
    const arr = map.get(m.path);
    if (arr) arr.push(m);
    else map.set(m.path, [m]);
  }
  return [...map.entries()].map(([path, items]) => ({
    key: path,
    label: basename(path),
    title: path,
    badge: null,
    items,
  }));
}

/** 按当前模式分组（渲染层统一入口） */
export function groupTodos(items: readonly TodoMatch[], mode: TodoGroupMode): TodoGroup[] {
  return mode === "file" ? groupTodosByFile(items) : groupTodosByTag(items);
}

// ---------- handlers 注入（同 debugView 先例） ----------

export interface TodoViewHandlers {
  /** 点击条目 → 打开源码并定位（main.ts 的 openFile） */
  openFile: (path: string, line: number) => void;
}

let handlers: TodoViewHandlers | null = null;

export function setTodoViewHandlers(h: TodoViewHandlers): void {
  handlers = h;
}

// ---------- 状态 ----------

let results: TodoMatch[] = [];
/** 刷新令牌：并发/连续刷新时旧结果不得覆盖新结果 */
let todoToken = 0;
let loading = false;

/** 当前过滤词（trim 后；DOM 里的原值另存，防抖期间不同步） */
let query = "";
/** 当前分组模式（会话内，不持久化） */
let groupMode: TodoGroupMode = "tag";
/** 已折叠的组：键为 `<mode>:<组键>`——两种模式的组键空间不同，不加前缀会撞 */
const collapsed = new Set<string>();
let filterTimer: number | undefined;
let localeChangeWired = false;

const collapseKey = (key: string): string => `${groupMode}:${key}`;

// ---------- DOM ----------

function todoFilterInput(): HTMLInputElement | null {
  return document.getElementById("todo-filter") as HTMLInputElement | null;
}
function todoModeSelect(): HTMLSelectElement | null {
  return document.getElementById("todo-group-mode") as HTMLSelectElement | null;
}
function todoClearBtn(): HTMLElement | null {
  return document.getElementById("todo-filter-clear");
}

/** 把状态回写到控件（reset / 语言切换后 DOM 重build 时用） */
function syncFilterControls(): void {
  const input = todoFilterInput();
  if (input) input.value = query;
  const sel = todoModeSelect();
  if (sel) sel.value = groupMode;
  todoClearBtn()?.classList.toggle("hidden", !query);
}

/** 初始化 TODO 视图 DOM（init 时调用一次；#view-todo 容器已在 index.html 声明） */
export function initTodoView(): void {
  buildTodoShell();
  if (localeChangeWired) return;
  localeChangeWired = true;
  onLocaleChange(() => {
    // 切换语言可能发生在 200ms 防抖尚未提交时，先保住输入框当前值。
    const input = todoFilterInput();
    if (input) query = input.value.trim();
    window.clearTimeout(filterTimer);
    buildTodoShell();
  });
}

/** 构建动态控件；语言切换时整体重建，避免 placeholder / aria / option 文案滞留。 */
function buildTodoShell(): void {
  const root = $("view-todo");
  root.textContent = "";

  const toolbar = document.createElement("div");
  toolbar.id = "todo-toolbar";
  const summary = document.createElement("span");
  summary.id = "todo-summary";
  summary.textContent = "—";
  const refresh = document.createElement("button");
  refresh.id = "todo-refresh";
  refresh.className = "btn btn--ghost btn--icon";
  refresh.dataset.tip = t("editor.todo.rescan");
  refresh.setAttribute("aria-label", t("editor.todo.rescan"));
  refresh.appendChild(codicon("refresh"));
  refresh.addEventListener("click", () => void refreshTodos());
  toolbar.append(summary, refresh);

  // B6-3：过滤框（输入框 + 清空 + 分组模式下拉）
  const filterBox = document.createElement("div");
  filterBox.className = "todo-filter-box";

  const input = document.createElement("input");
  input.id = "todo-filter";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = t("editor.todo.filterPlaceholder");
  input.setAttribute("aria-label", t("editor.todo.filterAria"));
  input.addEventListener("input", () => {
    const raw = input.value;
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => {
      query = raw.trim();
      todoClearBtn()?.classList.toggle("hidden", !query);
      renderTodoPanel();
    }, FILTER_DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (ev) => {
    // 与全局 window 级快捷键隔离：输入框内的按键不被任何键位截走（同 recentFiles 先例）
    ev.stopPropagation();
    if (ev.key === "Escape" && input.value) {
      ev.preventDefault();
      window.clearTimeout(filterTimer);
      input.value = "";
      query = "";
      todoClearBtn()?.classList.toggle("hidden", true);
      renderTodoPanel();
    }
  });

  const clear = document.createElement("button");
  clear.id = "todo-filter-clear";
  clear.className = "btn btn--ghost btn--icon hidden";
  clear.dataset.tip = t("editor.todo.clearFilter");
  clear.setAttribute("aria-label", t("editor.todo.clearFilter"));
  clear.appendChild(codicon("close"));
  clear.addEventListener("click", () => {
    window.clearTimeout(filterTimer);
    query = "";
    input.value = "";
    clear.classList.add("hidden");
    input.focus();
    renderTodoPanel();
  });

  const sel = document.createElement("select");
  sel.id = "todo-group-mode";
  sel.className = "todo-group-mode";
  sel.setAttribute("aria-label", t("editor.todo.groupBy"));
  const modes: ReadonlyArray<[TodoGroupMode, string]> = [
    ["tag", t("editor.todo.groupByTag")],
    ["file", t("editor.todo.groupByFile")],
  ];
  for (const [value, label] of modes) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    groupMode = sel.value === "file" ? "file" : "tag";
    // 折叠状态按模式前缀隔离，切模式时清空（否则会留下看不见的折叠项）
    collapsed.clear();
    renderTodoPanel();
  });

  filterBox.append(input, clear, sel);

  const list = document.createElement("div");
  list.id = "todo-results";

  root.append(toolbar, filterBox, list);
  syncFilterControls();
  renderTodoPanel();
}

/** 重新扫描工作区（视图 onShow 与刷新按钮共用） */
export async function refreshTodos(): Promise<void> {
  const list = document.getElementById("todo-results");
  const summary = document.getElementById("todo-summary");
  if (!app.workspaceRoot) {
    results = [];
    renderTodoPanel();
    return;
  }
  const token = ++todoToken;
  loading = true;
  if (summary) summary.textContent = t("editor.todo.scanning");
  if (list) list.textContent = "";
  let got: TodoMatch[];
  try {
    got = await invoke<TodoMatch[]>("scan_todos", { root: app.workspaceRoot });
  } catch (e) {
    if (token !== todoToken) return;
    results = [];
    loading = false;
    renderTodoPanel(t("editor.todo.scanFailed", { error: localizeBackendError(errMsg(e)) }));
    return;
  }
  if (token !== todoToken) return; // 已有更新一轮的扫描，丢弃旧结果
  results = got;
  loading = false;
  renderTodoPanel(); // 保留当前过滤词与分组模式：重新扫描不该重置用户的视图状态
}

/** 工作区切换 / 关闭时复位（避免旧工作区结果与旧过滤条件残留） */
export function resetTodoView(): void {
  todoToken++;
  results = [];
  loading = false;
  query = "";
  collapsed.clear();
  window.clearTimeout(filterTimer);
  syncFilterControls();
  renderTodoPanel();
}

/** 折叠重渲染时需要恢复的瞬时视图状态。 */
interface TodoRenderOptions {
  preserveScroll?: boolean;
  focusGroupKey?: string;
}

/** 渲染面板（error 非空时显示为空态 + 错误说明） */
export function renderTodoPanel(error?: string, options: TodoRenderOptions = {}): void {
  const list = document.getElementById("todo-results");
  const summary = document.getElementById("todo-summary");
  if (!list) return;
  const previousScrollTop = options.preserveScroll ? list.scrollTop : 0;

  const shown = filterTodos(results, query);

  if (summary) {
    if (error) summary.textContent = t("editor.todo.scanFailedShort");
    else if (loading) summary.textContent = t("editor.todo.scanning");
    else if (results.length === 0) summary.textContent = t("editor.todo.zeroItems");
    else if (query) {
      // 过滤中：同时给出命中数与总数，避免用户误以为清单被裁掉了
      summary.textContent = t("editor.todo.summaryFiltered", { hit: shown.length, total: results.length });
    } else {
      const tags = new Set(results.map((m) => m.tag));
      summary.textContent = t("editor.todo.summary", { count: results.length, tags: [...tags].join(" / ") });
    }
  }

  list.textContent = "";
  if (error) {
    list.appendChild(emptyState("error", t("editor.todo.scanFailedShort"), error, true));
    return;
  }
  if (loading) {
    list.appendChild(emptyState("loading", t("editor.todo.scanning"), t("editor.todo.scanningHint"), true));
    return;
  }
  if (!app.workspaceRoot) {
    list.appendChild(emptyState("checklist", t("editor.todo.noWorkspace"), t("editor.todo.noWorkspaceHint"), true));
    return;
  }
  if (results.length === 0) {
    list.appendChild(emptyState("checklist", t("editor.todo.none"), t("editor.todo.noneHint"), true));
    return;
  }
  if (shown.length === 0) {
    list.appendChild(emptyState("filter", t("editor.todo.noMatch"), t("editor.todo.noMatchHint"), true));
    return;
  }

  for (const g of groupTodos(shown, groupMode)) {
    const isCollapsed = collapsed.has(collapseKey(g.key));
    list.appendChild(buildGroupHeader(g, isCollapsed));
    if (isCollapsed) continue;
    for (const m of g.items) {
      list.appendChild(
        buildTodoRow(m, { withFile: groupMode !== "file", withTag: groupMode === "file" }),
      );
    }
  }

  if (options.focusGroupKey) {
    const nextHeader = Array.from(list.querySelectorAll<HTMLElement>(".todo-group-header"))
      .find((header) => header.dataset.groupKey === options.focusGroupKey);
    nextHeader?.focus({ preventScroll: true });
  }
  if (options.preserveScroll) list.scrollTop = previousScrollTop;
}

/** 组头：chevron +（标记徽标 | 文件名）+ 计数；点击 / Enter 折叠展开 */
function buildGroupHeader(g: TodoGroup, isCollapsed: boolean): HTMLElement {
  const header = document.createElement("div");
  header.className = "todo-group-header";
  header.dataset.groupKey = collapseKey(g.key);
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.setAttribute("aria-expanded", String(!isCollapsed));
  header.setAttribute("aria-label", t("editor.todo.toggleGroup", { name: g.label }));

  const chev = document.createElement("span");
  chev.className = "todo-group-chev";
  chev.appendChild(codicon(isCollapsed ? "chevron-right" : "chevron-down"));
  header.appendChild(chev);

  if (g.badge !== null) {
    const badge = document.createElement("span");
    badge.className = tagClass(g.badge);
    badge.textContent = g.badge;
    header.appendChild(badge);
  } else {
    const name = document.createElement("span");
    name.className = "todo-group-name";
    name.textContent = g.label;
    name.title = g.title;
    header.appendChild(name);
  }

  const count = document.createElement("span");
  count.className = "todo-group-count";
  count.textContent = String(g.items.length);
  header.appendChild(count);

  const toggle = (): void => {
    const key = collapseKey(g.key);
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    renderTodoPanel(undefined, { preserveScroll: true, focusGroupKey: key });
  };
  header.addEventListener("click", toggle);
  header.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      toggle();
    }
  });
  return header;
}

/**
 * 条目行。
 * - 按标记分组时：`文件:行号 + 说明`（文件名是必要信息，标记在组头）；
 * - 按文件分组时：`L行号 + 说明`，行首补标记徽标（标记维度在组头丢失了，需补回）。
 */
function buildTodoRow(
  m: TodoMatch,
  opts: { withFile: boolean; withTag: boolean },
): HTMLElement {
  const row = document.createElement("div");
  row.className = "todo-item";

  if (opts.withTag) {
    const badge = document.createElement("span");
    badge.className = tagClass(m.tag);
    badge.textContent = m.tag;
    row.appendChild(badge);
  }

  const loc = document.createElement("span");
  loc.className = "todo-loc";
  loc.textContent = opts.withFile ? `${basename(m.path)}:${m.line}` : `L${m.line}`;
  loc.title = `${m.path}:${m.line}`;

  const msg = document.createElement("span");
  msg.className = "todo-msg";
  // 无说明文字时回退到整行原文（如只有孤零零一个 `TODO`）
  msg.textContent = m.message || m.text;
  msg.title = msg.textContent;

  row.append(loc, msg);
  // UI-16：可点击行补 button 语义 + 键盘激活
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.setAttribute("aria-label", `${basename(m.path)}:${m.line} ${msg.textContent}`);
  const jump = (): void => handlers?.openFile(m.path, m.line);
  row.addEventListener("click", jump);
  row.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      jump();
    }
  });
  return row;
}
