// 终端功能域（TD-007 迁出 main.ts）：集成终端多会话 UI（Phase 4 / P2-7）+
// 底部面板标签切换（输出 / 终端 / 差异）。term-data/term-exit 事件分发也在此接线。

import { listen } from "@tauri-apps/api/event";
import { app, $, outputEl } from "./state";
import { codicon, parentDirOf } from "./util";
import { IntegratedTerminal } from "./terminal";
import { clearOutput } from "./output";
import { ensureDiffEditor } from "./git";

// ---------- 域内状态 ----------

/** 单个终端会话（P2-7 多会话） */
interface TermSessionUI {
  id: string;
  label: string;
  venv: string | null;
  iterm: IntegratedTerminal;
  view: HTMLElement;
}

/** 终端会话列表 */
const termSessions: TermSessionUI[] = [];
/** 当前激活的终端 id */
let activeTermId: string | null = null;
/** 终端编号自增（生成 label「终端 N」） */
let termSeq = 0;

/** 底部面板可切换标签 */
export type BottomTab = "output" | "terminal" | "diff";
/** 底部面板当前激活标签（输出 / 终端 / 差异） */
let bottomTab: BottomTab = "output";

const terminalPanelEl = $("terminal-panel");
const terminalTabsEl = $("terminal-tabs");
const terminalViewsEl = $("terminal-views");
const gitDiffPanelEl = $("git-diff-panel");

// ---------- 底部面板 ----------

/** 切换底部面板标签（输出 / 终端 / 差异） */
export function setBottomTab(tab: BottomTab): void {
  bottomTab = tab;
  $("tab-output").classList.toggle("active", tab === "output");
  $("tab-terminal").classList.toggle("active", tab === "terminal");
  $("tab-diff").classList.toggle("active", tab === "diff");
  outputEl.classList.toggle("hidden", tab !== "output");
  terminalPanelEl.classList.toggle("hidden", tab !== "terminal");
  gitDiffPanelEl.classList.toggle("hidden", tab !== "diff");
  $("terminal-cmd").classList.toggle("hidden", tab !== "terminal");
  $("bottom").classList.remove("collapsed");
  if (tab === "terminal") void ensureAnyTerminal();
  if (tab === "diff") ensureDiffEditor().layout();
}

// ---------- 终端会话 ----------

/** 终端标题（含 venv 指示） */
function termTitle(s: TermSessionUI): string {
  return s.venv ? `${s.label} · ${s.venv}` : s.label;
}

/** 计算终端默认启动目录（P2-4：工作区根 或 活动文件所在目录） */
function defaultTerminalCwd(): string | null {
  if (app.settings.terminal_cwd === "file" && app.activeTab) {
    return parentDirOf(app.activeTab.path);
  }
  return app.workspaceRoot;
}

/** 当前激活的终端会话 */
function activeTermSession(): TermSessionUI | null {
  return termSessions.find((s) => s.id === activeTermId) ?? null;
}

/** 新建一个终端会话并设为激活；返回该会话 */
async function createTerminal(cwd: string | null): Promise<TermSessionUI | null> {
  const id = `term-${++termSeq}`;
  const view = document.createElement("div");
  view.className = "terminal-view";
  terminalViewsEl.appendChild(view);

  const iterm = new IntegratedTerminal(id, view);
  iterm.setOnExit(() => {
    // shell 自然退出后刷新 tab（标题环境指示状态变化）
    if (termSessions.some((x) => x.id === id)) renderTerminalTabs();
  });

  const session: TermSessionUI = {
    id,
    label: `终端 ${termSeq}`,
    venv: null,
    iterm,
    view,
  };
  termSessions.push(session);
  activeTermId = id;
  renderTerminalTabs();
  renderTerminalViews();

  session.venv = await iterm.start(cwd, app.workspaceRoot);
  renderTerminalTabs();
  return session;
}

/** 确保至少有一个终端（无则新建） */
async function ensureAnyTerminal(): Promise<void> {
  if (termSessions.length > 0) {
    activeTermSession()?.iterm.focus();
    return;
  }
  if (!app.workspaceRoot) return;
  await createTerminal(defaultTerminalCwd());
}

/** 切换激活终端 */
function activateTerminal(id: string): void {
  activeTermId = id;
  renderTerminalTabs();
  renderTerminalViews();
  const s = activeTermSession();
  if (s) {
    s.iterm.relayout();
    s.iterm.focus();
  }
}

/** 关闭指定终端 */
async function closeTerminal(id: string): Promise<void> {
  const idx = termSessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const [s] = termSessions.splice(idx, 1);
  await s.iterm.dispose();
  s.view.remove();
  if (activeTermId === id) {
    activeTermId = termSessions[Math.min(idx, termSessions.length - 1)]?.id ?? null;
  }
  renderTerminalTabs();
  renderTerminalViews();
}

/** 重绘终端 tab 栏（含「＋」新建按钮） */
function renderTerminalTabs(): void {
  terminalTabsEl.textContent = "";
  for (const s of termSessions) {
    const el = document.createElement("div");
    el.className = `term-tab${s.id === activeTermId ? " active" : ""}`;
    el.title = termTitle(s);
    const name = document.createElement("span");
    name.className = "term-tab-name";
    name.textContent = termTitle(s);
    const close = document.createElement("span");
    close.className = "term-tab-close";
    close.appendChild(codicon("close"));
    close.title = "关闭终端";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeTerminal(s.id);
    });
    el.append(name, close);
    el.addEventListener("click", () => activateTerminal(s.id));
    terminalTabsEl.appendChild(el);
  }
  const add = document.createElement("div");
  add.className = "term-tab-add";
  add.appendChild(codicon("add"));
  add.title = "新建终端";
  add.addEventListener("click", () => void createTerminal(defaultTerminalCwd()));
  terminalTabsEl.appendChild(add);
}

/** 重绘终端视图（仅显示激活的那个） */
function renderTerminalViews(): void {
  for (const s of termSessions) {
    s.view.classList.toggle("hidden", s.id !== activeTermId);
  }
}

/** 外壳主题切换 → 所有终端实例重套配色（D1 P-01） */
export function refreshTerminalThemes(): void {
  for (const s of termSessions) s.iterm.applyTheme();
}

/** 在指定目录新建终端（右键「在终端中打开」） */
export async function openTerminalAt(dir: string): Promise<void> {
  setBottomTab("terminal");
  await createTerminal(dir);
}

/** 执行高频命令（P2-6：一键插入或立即执行） */
async function runTerminalCommand(cmd: string, run: boolean): Promise<void> {
  setBottomTab("terminal");
  await ensureAnyTerminal();
  const s = activeTermSession();
  if (!s) return;
  if (!s.iterm.isRunning()) {
    // 激活终端已退出 → 重启它（保持同一 tab）
    s.venv = await s.iterm.start(defaultTerminalCwd(), app.workspaceRoot);
    renderTerminalTabs();
    await new Promise((r) => setTimeout(r, 600));
  }
  s.iterm.sendCommand(cmd, run);
}

/** 销毁所有终端并重置底部面板到「输出」标签（关闭/切换工作区时调用） */
export async function disposeTerminal(): Promise<void> {
  for (const s of termSessions) {
    await s.iterm.dispose();
    s.view.remove();
  }
  termSessions.length = 0;
  activeTermId = null;
  termSeq = 0;
  renderTerminalTabs();
  bottomTab = "output";
  $("tab-output").classList.add("active");
  $("tab-terminal").classList.remove("active");
  $("tab-diff").classList.remove("active");
  outputEl.classList.remove("hidden");
  terminalPanelEl.classList.add("hidden");
  gitDiffPanelEl.classList.add("hidden");
}

// ---------- 事件接线 ----------

/** 接线底部面板交互：标签切换 / 清空输出 / 展开收起 / 高频命令下拉 */
export function wireBottomPanel(): void {
  // 底部面板：输出 / 终端标签 + 清空 + 展开收起
  $("tab-output").addEventListener("click", () => setBottomTab("output"));
  $("tab-terminal").addEventListener("click", () => setBottomTab("terminal"));
  $("tab-diff").addEventListener("click", () => setBottomTab("diff"));
  $("btn-clear-output").addEventListener("click", () => clearOutput(outputEl));
  $("btn-toggle-output").addEventListener("click", () => {
    const bottom = $("bottom");
    bottom.classList.toggle("collapsed");
    // 展开时若终端可见，重新 fit + resize（收起期间尺寸归零）
    if (!bottom.classList.contains("collapsed") && bottomTab === "terminal") {
      activeTermSession()?.iterm.relayout();
    }
  });
  // 高频命令下拉（P2-6）：选中即发送到终端
  ($("terminal-cmd") as HTMLSelectElement).addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    const idx = sel.selectedIndex;
    if (idx <= 0) return;
    const cmd = sel.options[idx].value;
    const run = sel.options[idx].dataset.run === "1";
    sel.selectedIndex = 0;
    void runTerminalCommand(cmd, run);
  });
}

/** 接线终端 PTY 事件（P2-7 多会话）：按 id 分发到对应终端实例 */
export async function wireTerminalEvents(): Promise<void> {
  await listen<{ id: string; data: string }>("term-data", (e) => {
    termSessions.find((s) => s.id === e.payload.id)?.iterm.writeData(e.payload.data);
  });
  await listen<{ id: string }>("term-exit", (e) => {
    const s = termSessions.find((x) => x.id === e.payload.id);
    if (s) s.iterm.handleExit();
  });
}
