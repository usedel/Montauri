// Search Everywhere / Quick Open（P1，PyCharm Double Shift 对标）：一个弹窗混搜
// **文件 / 符号 / 命令**，覆盖 PyCharm 三个独立入口：
//   · Double Shift      → 全量混搜（本模块的主入口，键位表里无法表达双击手势，故固定保留）
//   · Ctrl+Shift+N      → 只搜文件（goto_file）
//   · Ctrl+G            → 跳行（goto_line，输入 `行` 或 `行:列`）
//
// 三个数据源都落在既有能力上，无新增协议依赖：
//   · 文件  ：后端 `list_workspace_files`（复用全局搜索的 ignore 走查，.gitignore 感知）；
//   · 符号  ：LSP `textDocument/documentSymbol`（大纲已经在用），只索引**已打开的标签页**
//             ——工作区级符号索引需要引擎侧 workspace/symbol，成本高且 pyrefly 支持不稳，
//             而「跳到自己正在改的文件的某个函数」才是高频场景；
//   · 命令  ：由 main.ts 通过 registerQuickOpenActions 注入（避免本模块反向依赖 main.ts）。
//
// 焦点模型同 recentFiles：**焦点始终留在输入框**，↑↓ 只移动高亮项。

import { invoke } from "@tauri-apps/api/core";
import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { KEYBINDING_META, bindingLabel } from "./keybindings";
import * as lsp from "./lsp/client";
import { app } from "./state";
import { basename, codicon, emptyState, relativePath, renderFileIcon, symbolIcon } from "./util";

export type QuickOpenMode = "all" | "files" | "line" | "commands";

/** 一条可执行的命令（由 main.ts 注入） */
export interface QuickOpenAction {
  /** 唯一 id（与键位 id 对齐时可直接复用键位提示） */
  id: string;
  label: string;
  /** 键位提示（不传则尝试从键位表按 id 取） */
  hint?: string;
  run: () => void;
}

export interface QuickOpenHandlers {
  /** 打开文件（可带行号） */
  openFile: (path: string, line?: number) => void;
  /** 跳到当前文件的行 / 列 */
  gotoLine: (line: number, column: number) => void;
}

let handlers: QuickOpenHandlers | null = null;
let actions: QuickOpenAction[] = [];

export function setQuickOpenHandlers(h: QuickOpenHandlers): void {
  handlers = h;
}

export function registerQuickOpenActions(list: QuickOpenAction[]): void {
  actions = list;
}

// ---------- 模糊匹配（纯函数，可单测） ----------

/**
 * 子序列模糊匹配打分：query 的每个字符按序在 text 中出现即可命中，返回分数（越大越优）；
 * 任一字符找不到返回 null。
 *
 * 加成分档（与 PyCharm/VS Code 的手感对齐，不追求精确）：
 *   · 连续匹配 +8 —— "omod" 打到 http_client.py 里的连续片段应显著优于散落命中；
 *   · 词首/边界（首字符，或前一位为 / \ . _ - 空格）+5 —— 路径分段与 snake_case 分段；
 *   · camelCase 大写字母 +2 —— "gc" 打到 getData；
 *   · 越靠前 +0~4 —— 同分时短前缀优先。
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  if (!text) return null;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const qc of q) {
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === qc) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    if (found === prev + 1) score += 8;
    else score += 1;
    if (found === 0) {
      score += 5;
    } else {
      const p = t[found - 1];
      if (p === "/" || p === "\\" || p === "." || p === "_" || p === "-" || p === " ") score += 5;
      else if (text[found] !== text[found].toLowerCase()) score += 2;
    }
    score += Math.max(0, 4 - found);
    prev = found;
    ti = found + 1;
  }
  return score;
}

/** 文件名权重：basename 命中比全路径命中更贴近意图（同分时文件名优先） */
function scoreFile(path: string, query: string): number | null {
  const name = basename(path);
  const byName = fuzzyScore(name, query);
  const byPath = fuzzyScore(relativePath(app.workspaceRoot ?? "", path), query);
  if (byName === null && byPath === null) return null;
  return Math.max(byName === null ? -1 : byName + 20, byPath === null ? -1 : byPath);
}

// ---------- 数据源缓存 ----------

/** 工作区文件清单（按路径排序）；`filesRoot` 记录所属工作区，切换即失效 */
let files: string[] = [];
let filesRoot: string | null = null;

/** 符号索引：已打开标签页的 documentSymbol（扁平化，带容器名） */
interface SymbolItem {
  path: string;
  name: string;
  container: string;
  kind: number;
  line: number;
}
let symbolIndex: SymbolItem[] = [];
/** 索引所属的文件列表指纹（标签页集合变化即重建） */
let symbolFingerprint = "";

/** 工作区切换 / 文件树增删后调用：丢弃文件清单缓存，下次打开重新拉取 */
export function invalidateQuickOpenFiles(): void {
  files = [];
  filesRoot = null;
}

async function ensureFiles(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root) {
    files = [];
    filesRoot = null;
    return;
  }
  if (filesRoot === root && files.length > 0) return;
  try {
    files = await invoke<string[]>("list_workspace_files", { root });
    filesRoot = root;
  } catch (e) {
    console.warn("[quickOpen] 读取工作区文件清单失败", e);
    files = [];
    filesRoot = null;
  }
}

/** 扁平化 documentSymbol 树（保留父级链作容器名，与大纲同一口径） */
function flatten(path: string, symbols: lsp.LspDocumentSymbol[], chain: string[]): SymbolItem[] {
  const out: SymbolItem[] = [];
  for (const s of symbols) {
    const line = (s.selectionRange?.start?.line ?? s.range?.start?.line ?? 0) + 1;
    out.push({ path, name: s.name, container: chain.join(" › "), kind: s.kind, line });
    if (s.children?.length) out.push(...flatten(path, s.children, [...chain, s.name]));
  }
  return out;
}

async function ensureSymbols(): Promise<void> {
  if (!app.workspaceRoot) {
    symbolIndex = [];
    symbolFingerprint = "";
    return;
  }
  const fingerprint = app.tabs.map((t) => t.path).join("|");
  if (fingerprint === symbolFingerprint && (fingerprint === "" || symbolIndex.length > 0)) return;
  symbolFingerprint = fingerprint;
  symbolIndex = [];
  // 逐条 await（与其它域同一纪律：多文件异步转发禁止 fire-and-forget）
  for (const t of app.tabs) {
    const symbols = await lsp.documentSymbols(t.path);
    symbolIndex.push(...flatten(t.path, symbols, []));
  }
}

// ---------- 候选项 ----------

interface Item {
  kind: "file" | "symbol" | "action" | "line";
  title: string;
  sub: string;
  score: number;
  /** 键位提示（命令项用） */
  hint?: string;
  /** 图标：符号/命令用 codicon 名；文件用 basename 走文件图标 */
  icon?: string;
  filePath?: string;
  run: () => void;
}

/** 上限：混搜结果过多时只保留最靠前的一批（排序后截断） */
const MAX_ITEMS = 60;

/** 解析 `file.py:12` / `:12` 形式的行号后缀（PyCharm 同款） */
export function parseLineSuffix(query: string): { query: string; line: number | null } {
  const m = /:(\d+)$/.exec(query.trim());
  if (!m) return { query: query.trim(), line: null };
  return { query: query.trim().slice(0, m.index).trim(), line: Number(m[1]) };
}

/** 命令项的键位提示：显式 hint > 键位表里同 id 的当前键位 > 空 */
function actionHint(a: QuickOpenAction): string {
  if (a.hint !== undefined) return a.hint;
  const meta = KEYBINDING_META.find((m) => m.id === a.id);
  return meta ? bindingLabel(meta.id) : "";
}

function buildItems(mode: QuickOpenMode, query: string): Item[] {
  const out: Item[] = [];
  if (mode === "line") return out; // 行号模式不参与列表检索

  // 命令直达模式（Ctrl+Shift+P）：只列命令，不做行号后缀解析（对齐 VS Code）
  if (mode === "commands") {
    for (const a of actions) {
      const score = fuzzyScore(a.label, query.trim());
      if (score === null) continue;
      out.push({
        kind: "action",
        title: a.label,
        sub: "命令",
        score: score + 10,
        icon: "chevron-right",
        hint: actionHint(a),
        run: a.run,
      });
    }
    return out;
  }

  // `:行号` 后缀在混搜与文件模式都支持（PyCharm 的 Ctrl+Shift+N 同款）。
  // 上文已对 line 模式提前返回，此处 mode 只可能是 all / files。
  const { query: q, line } = parseLineSuffix(query);

  if (mode === "all" || mode === "files") {
    for (const p of files) {
      const score = scoreFile(p, q);
      if (score === null) continue;
      out.push({
        kind: "file",
        title: basename(p),
        sub: app.workspaceRoot ? relativePath(app.workspaceRoot, p) : p,
        score,
        filePath: p,
        run: () => handlers?.openFile(p, line ?? undefined),
      });
    }
  }

  if (mode === "all") {
    for (const s of symbolIndex) {
      const score = fuzzyScore(s.name, q);
      if (score === null) continue;
      out.push({
        kind: "symbol",
        title: s.name,
        sub: `${basename(s.path)}:${s.line}${s.container ? `  ${s.container}` : ""}`,
        score,
        icon: symbolIcon(s.kind),
        filePath: s.path,
        run: () => handlers?.openFile(s.path, s.line),
      });
    }
  }

  if (mode === "all") {
    for (const a of actions) {
      const score = fuzzyScore(a.label, q);
      if (score === null) continue;
      out.push({
        kind: "action",
        title: a.label,
        sub: "命令",
        // 命令名通常整体匹配，给一点基础权重避免被文件路径淹没
        score: score + 10,
        icon: "chevron-right",
        hint: actionHint(a),
        run: a.run,
      });
    }
  }

  out.sort((a, b) => b.score - a.score || a.title.length - b.title.length);
  return out.slice(0, MAX_ITEMS);
}

// ---------- DOM 与状态 ----------

let modalEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let releaseFocus: (() => void) | null = null;

let mode: QuickOpenMode = "all";
let items: Item[] = [];
let sel = 0;
/** 异步刷新令牌（照搬 search.ts 范本：慢响应不得覆盖新结果） */
let loadToken = 0;

// ---------- B 批：最近查询历史（有界 20 条，localStorage） ----------

const HISTORY_KEY = "opencharm.quickopen_history";
const HISTORY_MAX = 20;
/** -1 = 未处于历史浏览态；≥0 指向 queryHistory 下标（↑/↓ 在输入为空时回溯） */
let histIdx = -1;

function loadQueryHistory(): string[] {
  // 顶层调用（模块状态初始化），try/catch 兜底纯 Node 测试环境无 localStorage 的情况
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

let queryHistory: string[] = loadQueryHistory();

/** 记录一次生效的查询（去重置顶，有界截断）；line 模式的「123:45」不入史 */
function rememberQuery(q: string): void {
  queryHistory = [q, ...queryHistory.filter((s) => s !== q)].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(queryHistory));
  } catch {
    // 存储不可用：本次会话内存仍生效
  }
}

const PLACEHOLDERS: Record<QuickOpenMode, string> = {
  all: "搜索文件 / 符号 / 命令（支持 :行号）",
  files: "搜索文件名（支持 :行号）",
  line: "行号 或 行:列，Enter 跳转，Esc 关闭",
  commands: "输入命令名（Ctrl+Shift+P）",
};

/** 初始化弹窗 DOM（init 时调用一次；容器 #quick-open-modal 已在 index.html 声明） */
export function initQuickOpen(): void {
  const host = document.getElementById("quick-open-modal");
  if (!host) return;
  host.textContent = "";

  const card = document.createElement("div");
  card.className = "modal-card quick-open-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Search Everywhere");

  const input = document.createElement("input");
  input.id = "quick-open-input";
  input.type = "text";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-controls", "quick-open-list");

  const list = document.createElement("div");
  list.id = "quick-open-list";
  list.className = "quick-open-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "搜索结果");

  card.append(input, list);
  host.appendChild(card);

  modalEl = host;
  inputEl = input;
  listEl = list;

  input.addEventListener("input", () => {
    sel = 0;
    histIdx = -1; // 手动输入退出历史浏览态
    void refresh();
  });
  input.addEventListener("keydown", (e) => {
    // 与全局 window 级快捷键隔离：输入框内的按键不被任何键位截走
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      // B 批：输入为空时 ↑/↓ 回溯最近查询历史
      const q = inputEl?.value.trim() ?? "";
      if (!q && mode !== "line" && queryHistory.length > 0) {
        histIdx = Math.min(histIdx + (e.key === "ArrowUp" ? 1 : -1), queryHistory.length - 1);
        if (inputEl) inputEl.value = histIdx >= 0 ? queryHistory[histIdx] : "";
        sel = 0;
        void refresh();
        return;
      }
      const n = items.length;
      if (n === 0) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      renderList();
    } else if (e.key === "Home") {
      e.preventDefault();
      sel = 0;
      renderList();
    } else if (e.key === "End") {
      e.preventDefault();
      sel = Math.max(0, items.length - 1);
      renderList();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void activate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeQuickOpen();
    }
  });
  list.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".quick-open-item");
    const idx = row ? Number(row.dataset.index) : NaN;
    if (!Number.isNaN(idx)) {
      sel = idx;
      void activate();
    }
  });
  host.addEventListener("mousedown", (e) => {
    if (e.target === host) closeQuickOpen();
  });
}

/** 打开弹窗（mode 默认混搜；seed 为预填关键词，如当前选中的词） */
export async function openQuickOpen(next: QuickOpenMode = "all", seed = ""): Promise<void> {
  if (!modalEl || !inputEl) return;
  mode = next;
  sel = 0;
  histIdx = -1; // B 批：新开弹窗重置历史浏览态
  inputEl.placeholder = PLACEHOLDERS[next];
  inputEl.value = seed;
  showEl(modalEl);
  releaseFocus?.();
  releaseFocus = trapFocus(modalEl);
  await refresh();
  inputEl.focus();
  if (seed) inputEl.select();
}

export function closeQuickOpen(): void {
  if (!modalEl) return;
  releaseFocus?.();
  releaseFocus = null;
  hideEl(modalEl);
}

export function isQuickOpenOpen(): boolean {
  return !!modalEl && !modalEl.classList.contains("hidden");
}

/** 重新计算候选项（数据源就绪后渲染） */
async function refresh(): Promise<void> {
  const token = ++loadToken;
  if (mode === "commands") {
    // 命令直达：不加载文件/符号索引（Ctrl+Shift+P 秒开）
    items = buildItems(mode, inputEl?.value ?? "");
  } else if (mode !== "line") {
    await Promise.all([ensureFiles(), ensureSymbols()]);
    if (token !== loadToken) return;
    items = buildItems(mode, inputEl?.value ?? "");
  } else {
    items = [];
  }
  if (token !== loadToken) return;
  if (sel >= items.length) sel = Math.max(0, items.length - 1);
  renderList();
}

async function activate(): Promise<void> {
  if (mode === "line") {
    const parsed = parseTargetLine(inputEl?.value ?? "");
    if (!parsed) return;
    closeQuickOpen();
    handlers?.gotoLine(parsed.line, parsed.column);
    return;
  }
  const q = inputEl?.value.trim() ?? "";
  if (q) rememberQuery(q); // B 批：生效的查询入最近历史
  const it = items[sel];
  if (!it) return;
  closeQuickOpen();
  it.run();
}

/** `123` / `123:45` → {line, column}；非法返回 null */
export function parseTargetLine(raw: string): { line: number; column: number } | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d+)(?:\s*[:：]\s*(\d+))?$/.exec(s);
  if (!m) return null;
  const line = Number(m[1]);
  if (!Number.isFinite(line) || line < 1) return null;
  const column = m[2] === undefined ? 1 : Number(m[2]);
  if (!Number.isFinite(column) || column < 1) return null;
  return { line, column };
}

function renderList(): void {
  const list = listEl;
  const input = inputEl;
  if (!list || !input) return;
  list.textContent = "";

  if (mode === "line") {
    const parsed = parseTargetLine(input.value);
    const total = app.activeTab?.model.getLineCount() ?? 0;
    list.appendChild(
      emptyState(
        "go-to-file",
        parsed ? `跳转到第 ${parsed.line} 行${parsed.column > 1 ? ` 第 ${parsed.column} 列` : ""}` : "输入行号",
        parsed
          ? `当前文件共 ${total} 行，Enter 跳转`
          : `格式：行号 或 行号:列号（当前文件共 ${total} 行）`,
        true,
      ),
    );
    input.removeAttribute("aria-activedescendant");
    return;
  }

  if (items.length === 0) {
    const q = input.value.trim();
    list.appendChild(
      emptyState(
        "search",
        q ? "无匹配项" : "开始输入以搜索",
        app.workspaceRoot
          ? (q ? "换个关键词，或用 :行号 直接定位" : "文件 / 符号 / 命令混搜，:行号 可直接定位")
          : "打开工作区后可搜索其中的文件",
      ),
    );
    input.removeAttribute("aria-activedescendant");
    return;
  }

  items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = `quick-open-item${i === sel ? " active" : ""}`;
    row.id = `quick-open-item-${i}`;
    row.dataset.index = String(i);
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === sel));

    // 图标槽：文件走文件图标（按扩展名着色），符号/命令走 codicon
    if (it.kind === "file") {
      row.appendChild(renderFileIcon(it.title));
    } else {
      const icon = document.createElement("span");
      icon.className = "icon";
      icon.appendChild(codicon(it.icon ?? "symbol-misc"));
      row.appendChild(icon);
    }

    const name = document.createElement("span");
    name.className = "quick-open-name";
    name.textContent = it.title;
    row.appendChild(name);

    const sub = document.createElement("span");
    sub.className = "quick-open-sub";
    sub.textContent = it.sub;
    sub.title = it.sub;
    row.appendChild(sub);

    if (it.hint) {
      const kbd = document.createElement("span");
      kbd.className = "quick-open-kbd";
      kbd.textContent = it.hint;
      row.appendChild(kbd);
    }

    list.appendChild(row);
  });
  input.setAttribute("aria-activedescendant", `quick-open-item-${sel}`);
  list.children[sel]?.scrollIntoView({ block: "nearest" });
}
