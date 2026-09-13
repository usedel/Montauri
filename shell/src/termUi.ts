// 终端功能域（TD-007 迁出 main.ts）：集成终端多会话 UI（Phase 4 / P2-7）+
// 底部面板标签切换（输出 / 终端 / 差异）。term-data/term-exit 事件分发也在此接线。

import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { app, $, outputEl } from "./state";
import { basename, codicon, emptyState, parentDirOf } from "./util"; // UI-12：终端无会话时的空态
import { IntegratedTerminal } from "./terminal";
import { clearOutput } from "./output";
import { ensureDiffEditor } from "./git";
import { showMenu } from "./menu";

// ---------- 域内状态 ----------

/** 单个终端会话（P2-7 多会话） */
interface TermSessionUI {
  id: string;
  label: string;
  venv: string | null;
  iterm: IntegratedTerminal;
  view: HTMLElement;
  /** S3："run" = 专用「运行终端」（脚本跑完即结束会话）；"shell" = 普通交互 shell */
  kind: "shell" | "run";
  /** 运行终端专属：当前是否有脚本在跑（驱动 tab 上的停止按钮） */
  runActive: boolean;
  /** 该会话的 shell 别名（"auto"/"pwsh"/"powershell"/"cmd"）；run 会话恒为 "auto"（不参与 shell 选择，仅占位） */
  shell: string;
}

/** 终端会话列表 */
const termSessions: TermSessionUI[] = [];
/** 当前激活的终端 id */
let activeTermId: string | null = null;
/** 终端编号自增（生成 label「终端 N」） */
let termSeq = 0;
/** 运行终端编号自增（生成 id `run-term-N`；后端按该前缀识别「运行会话」做单实例守卫） */
let runTermSeq = 0;
/** 运行终端结束回调（main.ts 注册：复位统一运行态——停止按钮 / tab 运行图标，§4.7 结论 3） */
let runExitHook: (() => void) | null = null;
/** 输出面板的跨域回调（main.ts 注册，避免 termUi 反向依赖 main.ts 造成循环导入） */
export interface OutputPanelHooks {
  /** 切标签后调用：同步 S4 交互输入行的可见性（输入行只在「输出」标签下有意义） */
  onTabChange: () => void;
  /** 清空输出前调用：丢弃未完结行状态，否则转录器会往已被清空的游离元素里写 */
  onClear: () => void;
}
let outputHooks: OutputPanelHooks | null = null;

export function setOutputPanelHooks(h: OutputPanelHooks): void {
  outputHooks = h;
}

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
  // UI-16：role=tab 的 aria-selected 与 .active 类同源切换（单一写入点）
  for (const [id, sel] of [["tab-output", tab === "output"], ["tab-terminal", tab === "terminal"], ["tab-diff", tab === "diff"]] as const) {
    const el = $(id);
    el.classList.toggle("active", sel);
    el.setAttribute("aria-selected", String(sel));
  }
  outputEl.classList.toggle("hidden", tab !== "output");
  terminalPanelEl.classList.toggle("hidden", tab !== "terminal");
  gitDiffPanelEl.classList.toggle("hidden", tab !== "diff");
  $("terminal-cmd").classList.toggle("hidden", tab !== "terminal");
  $("bottom").classList.remove("collapsed");
  if (tab === "terminal") void ensureAnyTerminal();
  if (tab === "diff") ensureDiffEditor().layout();
  outputHooks?.onTabChange();
}

// ---------- 终端会话 ----------

/** 新建终端可选的 shell（取值与设置面板 `terminal_shell` 一致） */
const SHELL_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "自动（PowerShell 优先，回退 cmd）" },
  { value: "pwsh", label: "PowerShell 7（pwsh）" },
  { value: "powershell", label: "Windows PowerShell" },
  { value: "cmd", label: "命令提示符（cmd）" },
];

/** shell 短名（tab 标题用）；auto 不额外显示（实际 shell 由后端回退决定） */
function shellShortName(shell: string): string {
  return shell && shell !== "auto" ? shell : "";
}

// ---------- shell 可用性探测（后端 list_shells 运行时探测，避免列出机器上没有的 shell） ----------

/** 可用 shell 别名缓存（不含 "auto"；null = 尚未探测） */
let availableShells: string[] | null = null;

/** 拉取后端探测出的可用 shell 别名并缓存复用 */
async function fetchAvailableShells(): Promise<string[]> {
  if (availableShells) return availableShells;
  try {
    availableShells = await invoke<string[]>("list_shells");
  } catch {
    availableShells = [];
  }
  return availableShells;
}

/** 有效默认 shell：全局默认若（缓存已知时）不可用，退化为 "auto" */
function defaultShell(): string {
  const d = app.settings.terminal_shell ?? "auto";
  if (d === "auto" || !availableShells || availableShells.includes(d)) return d;
  return "auto";
}

/** 终端标题（含 shell 与 venv 指示） */
function termTitle(s: TermSessionUI): string {
  const parts: string[] = [s.label];
  const sh = shellShortName(s.shell);
  if (sh) parts.push(sh);
  if (s.venv) parts.push(s.venv);
  return parts.join(" · ");
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

/** 新建一个终端会话并设为激活；返回该会话。
 * `shell` 为显式别名；缺省回退全局默认 `app.settings.terminal_shell`。 */
async function createTerminal(cwd: string | null, shell?: string): Promise<TermSessionUI | null> {
  const id = `term-${++termSeq}`;
  const view = document.createElement("div");
  view.className = "terminal-view";
  // UI-16：与 .term-tab（role=tab）配对的面板；xterm 自身管理内部焦点与读屏播报
  view.setAttribute("role", "tabpanel");
  view.tabIndex = -1; // tabpanel 惯例：可被程序聚焦（不占 tab 序列），便于从 tab 跳转进来
  terminalViewsEl.appendChild(view);

  const chosenShell = shell ?? defaultShell();

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
    kind: "shell",
    runActive: false,
    shell: chosenShell,
  };
  termSessions.push(session);
  activeTermId = id;
  renderTerminalTabs();
  renderTerminalViews();

  session.venv = await iterm.start(cwd, app.workspaceRoot, chosenShell);
  renderTerminalTabs();
  return session;
}

/** 弹出「新建终端 shell 选择」菜单；先探测可用 shell 再渲染，只展示机器上实际存在的项（auto 恒保留）。 */
async function spawnShellMenu(anchor: HTMLElement): Promise<void> {
  const avail = await fetchAvailableShells();
  const options = SHELL_OPTIONS.filter((o) => o.value === "auto" || avail.includes(o.value));
  showMenu(
    options.map((o) => ({
      label: o.label,
      checked: o.value === defaultShell(),
      action: () => void createTerminal(defaultTerminalCwd(), o.value),
    })),
    anchor,
  );
}

/** 确保有一个可用的**交互 shell** 并激活它；返回该会话（工作区未打开时返回 null）。
 * 运行终端（S3）不算交互 shell：它跑完即结束会话，不能作为「命令…」下拉与手敲命令的落点。 */
async function ensureShellTerminal(): Promise<TermSessionUI | null> {
  const shell = termSessions.find((s) => s.kind === "shell");
  if (shell) {
    activateTerminal(shell.id);
    return shell;
  }
  if (!app.workspaceRoot) return null;
  return createTerminal(defaultTerminalCwd());
}

/** 切到「终端」标签时确保有可看的终端。
 * 已有运行终端时**不自动新建 shell**：用户此刻要看的是运行输出，凭空多一个 shell 会话
 * 只会抢激活态、多起一个 PTY 进程；真需要交互 shell 时点「＋」或用「命令…」下拉按需创建。 */
async function ensureAnyTerminal(): Promise<void> {
  const active = activeTermSession();
  if (active && active.kind === "shell") {
    active.iterm.focus();
    return;
  }
  if (termSessions.some((s) => s.kind === "run")) return;
  const shell = await ensureShellTerminal();
  shell?.iterm.focus();
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
  // S3：关掉正在跑的运行终端 = 停止运行，必须同步复位统一运行态（否则停止按钮永远亮着）
  if (s.kind === "run" && s.runActive) fireRunExit();
}

/** 触发运行结束回调（自然退出 / 主动停止 / 关闭运行终端三处共用，且只触发一次） */
function fireRunExit(): void {
  const hook = runExitHook;
  runExitHook = null;
  hook?.();
}

/** UI-16：给「以 span/div 充当按钮」的元素补齐 button 语义 + 键盘激活。
 *  第四批待办的落地：role=generic 的 span 上 aria-label 不会被读屏暴露，且无 tabindex
 *  键盘不可达——补 role=button + tabindex=0 + Enter/Space 触发 click（复用既有 click 回调，
 *  单一动作入口；keydown 需 stopPropagation，避免冒泡到 tab 本体的方向键/回车处理）。 */
function makeSpanButton(el: HTMLElement, label: string): void {
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", label);
  el.tabIndex = 0;
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      ev.stopPropagation();
      el.click();
    }
  });
}

/** 重绘终端 tab 栏（含「＋」新建按钮） */
function renderTerminalTabs(): void {
  // UI-16：重绘会销毁正在聚焦的 tab 元素，先记录焦点、渲染后按会话 id 恢复，
  // 否则键盘用户每按一次方向键/回车焦点就掉回 body
  const ae = document.activeElement as HTMLElement | null;
  const focusedId = ae?.classList.contains("term-tab-add")
    ? "__add__"
    : (ae?.closest(".term-tab") as HTMLElement | null)?.dataset?.termId ?? null;
  terminalTabsEl.textContent = "";
  for (const s of termSessions) {
    const el = document.createElement("div");
    const active = s.id === activeTermId;
    // S3：运行终端用独立样式（§4.7 结论 2：与普通 shell 视觉区分）
    el.className = `term-tab${active ? " active" : ""}${s.kind === "run" ? " run" : ""}`;
    // UI-16：tabs 模式。tab 本体 role=tab + aria-selected（与 .active 同源）；
    // 漫游 tabindex（激活项 0、其余 -1）+ Enter/Space 激活 + ←→ 移动焦点；
    // 面板侧 .terminal-view 为 tabpanel（createTerminal 处声明）。
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(active));
    // 显式给定可访问名称：tab 名称默认从内容计算，会把子级停止/关闭按钮的
    // aria-label 一并混入（「终端 1 · pwsh 关闭终端」），故收敛为会话标题本身
    el.setAttribute("aria-label", termTitle(s));
    el.tabIndex = active ? 0 : -1;
    el.dataset.termId = s.id;
    // UI-09：tab 本体一并迁到 data-tip。原生 title 会沿祖先链继承解析——若父 tab 留 title、
    // 子级 stop/close 用 data-tip，悬停子级时两个提示会同时出现，故父子必须同轨。
    el.dataset.tip = termTitle(s);
    const name = document.createElement("span");
    name.className = "term-tab-name";
    name.textContent = termTitle(s);
    el.appendChild(name);
    // S3：运行中给一个停止按钮（与标签页运行图标 / stopRun 共用同一运行态，结论 3）
    if (s.kind === "run" && s.runActive) {
      const stop = document.createElement("span");
      stop.className = "term-tab-stop";
      stop.appendChild(codicon("debug-stop"));
      // UI-09：这两个是 <span> 而非 <button>（沿用既有结构，改成 button 需重置按钮默认样式）。
      // UI-16：已按第四批待办补齐 role/tabindex/键盘激活（见 makeSpanButton）。
      stop.dataset.tip = "停止运行";
      makeSpanButton(stop, "停止运行");
      stop.addEventListener("click", (ev) => {
        ev.stopPropagation();
        void stopRunTerminal();
      });
      el.appendChild(stop);
    }
    const close = document.createElement("span");
    close.className = "term-tab-close";
    close.appendChild(codicon("close"));
    close.dataset.tip = s.kind === "run" ? "关闭运行终端" : "关闭终端";
    makeSpanButton(close, s.kind === "run" ? "关闭运行终端" : "关闭终端"); // UI-16
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeTerminal(s.id);
    });
    el.appendChild(close);
    el.addEventListener("click", () => activateTerminal(s.id));
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activateTerminal(s.id);
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        focusSiblingTermTab(el, ev.key === "ArrowRight" ? 1 : -1);
      }
    });
    terminalTabsEl.appendChild(el);
  }
  const add = document.createElement("div");
  add.className = "term-tab-add";
  add.appendChild(codicon("add"));
  add.dataset.tip = "新建终端";
  // UI-16：非 tab 的动作按钮，不进 tablist 的漫游序列，但需键盘可达
  makeSpanButton(add, "新建终端");
  // UI-30：点击弹出 shell 选择菜单（menu.ts showMenu 以本元素为 anchor）——声明 haspopup，
  // aria-expanded 由 menu.ts 的触发元素跟踪统一切换（打开置 true、关闭复位 false）
  add.setAttribute("aria-haspopup", "menu");
  add.setAttribute("aria-expanded", "false");
  add.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void spawnShellMenu(add);
  });
  terminalTabsEl.appendChild(add);
  // 焦点恢复：按会话 id 找回新元素；原焦点在「＋」上则还给「＋」
  if (focusedId) {
    const target = focusedId === "__add__" ? add : terminalTabsEl.querySelector<HTMLElement>(`.term-tab[data-term-id="${CSS.escape(focusedId)}"]`);
    target?.focus();
  }
}

/** 终端 tab 的 ←→ 焦点漫游（跳过中间的停止/关闭小按钮，只在 tab 之间移动；越界环绕） */
function focusSiblingTermTab(from: HTMLElement, dir: 1 | -1): void {
  const tabs = Array.from(terminalTabsEl.querySelectorAll<HTMLElement>(".term-tab"));
  if (tabs.length < 2) return;
  const idx = tabs.indexOf(from);
  const next = tabs[(idx + dir + tabs.length) % tabs.length];
  next.focus();
}

/** UI-12：无会话时的兜底空态元素（懒建；一旦有会话即移除，避免与终端视图争空间） */
let termEmptyEl: HTMLElement | null = null;

/** 重绘终端视图（仅显示激活的那个） */
function renderTerminalViews(): void {
  for (const s of termSessions) {
    s.view.classList.toggle("hidden", s.id !== activeTermId);
  }
  // UI-12：会话数为 0 时渲染引导性空态。此前本函数只切换已有 view 的显隐，
  // 关掉最后一个终端后 #terminal-views 会彻底空白，用户切到「终端」标签无从下手。
  // 用 compact 档：底部面板高度有限（可拖到 120px），标准档的大留白会放不下。
  if (termSessions.length === 0) {
    if (!termEmptyEl) {
      termEmptyEl = emptyState(
        "terminal",
        "尚无终端",
        "点击上方「＋」新建，或在文件树中右键「在终端中打开」",
        true,
      );
      termEmptyEl.classList.add("term-empty");
      terminalViewsEl.appendChild(termEmptyEl);
    }
  } else if (termEmptyEl) {
    termEmptyEl.remove();
    termEmptyEl = null;
  }
}

/** 外壳主题切换 → 所有终端实例重套配色（D1 P-01） */
export function refreshTerminalThemes(): void {
  for (const s of termSessions) s.iterm.applyTheme();
}

/** UI-11：「减少动画」开关切换 → 所有已存在的终端实例重设光标闪烁
 *  （新建实例在构造时已读开关，此处只负责补上切换前就存在的那些） */
export function refreshTerminalMotion(): void {
  for (const s of termSessions) s.iterm.applyMotionPreference();
}

/** UI-29：设置保存（字号/字体族）→ 所有已存在的终端实例重套字体并 refit
 *  （新建实例在构造时已读设置，此处只负责补上变更前就存在的那些——与 refreshTerminalMotion 同款模式） */
export function refreshTerminalFonts(): void {
  for (const s of termSessions) s.iterm.applyFontPreference();
}

/** 在指定目录新建终端（右键「在终端中打开」） */
export async function openTerminalAt(dir: string): Promise<void> {
  setBottomTab("terminal");
  await createTerminal(dir);
}

// ---------- S3：在终端中运行（真 TTY） ----------

/** 在专用「运行终端」中运行脚本（`terminal::run_in_terminal` → PTY 直跑解释器，不套 shell）。
 *
 * - **单实例**：全局只保留一个运行终端 tab，重复运行**复用**同一 tab（停止后立即可再跑，验收项）；
 * - 生命周期与 shell 不同（§4.7 结论 2）：脚本跑完即结束会话，tab 保留供阅读输出与点击 traceback；
 * - 回显行与运行按钮同一口径（来源前缀 + 解释器完整路径 + 参数 + stdin），
 *   让「这次用哪套环境跑」在终端里同样显式可见。
 *
 * @param echo 运行回显行（写在脚本输出之前）
 * @param onExit 会话结束（自然退出 / 主动停止 / 关闭 tab）时回调，供 main.ts 复位统一运行态
 * @throws 后端启动失败（已在终端里写下原因），调用方负责复位运行态 */
export async function runScriptInTerminal(path: string, echo: string, onExit: () => void): Promise<void> {
  runExitHook = onExit;

  let s = termSessions.find((x) => x.kind === "run");
  if (!s) {
    // id 必须以 `run-term-` 开头：后端据此与普通 shell 会话区分（单实例守卫 + 退出事件路由）
    const id = `run-term-${++runTermSeq}`;
    const view = document.createElement("div");
    view.className = "terminal-view";
    terminalViewsEl.appendChild(view);
    const iterm = new IntegratedTerminal(id, view);
    iterm.setOnExit(() => renderTerminalTabs());
    s = { id, label: "运行", venv: null, iterm, view, kind: "run", runActive: false, shell: "auto" };
    termSessions.push(s);
  }
  s.label = `运行 · ${basename(path)}`;
  activeTermId = s.id;
  // **先落好运行终端再切标签**：setBottomTab 会触发 ensureAnyTerminal，
  // 顺序反了它会先建一个交互 shell 并把激活态抢走（用户看到的是 shell 而不是运行输出）
  setBottomTab("terminal");
  renderTerminalTabs();
  renderTerminalViews();
  s.iterm.relayout(); // 面板刚切过来，尺寸可能还没稳定（cols/rows 要准，否则 PTY 换行错位）

  try {
    const warnings = await s.iterm.startRun(path, app.workspaceRoot, echo);
    s.runActive = true;
    // 非致命告警（如 Parameters 解析失败）写进终端，与输出面板路径同一份文案（来自 run_env）
    for (const w of warnings) s.iterm.writeData(`\x1b[33m${w.replace(/\n/g, "\r\n")}\x1b[0m\r\n`);
    renderTerminalTabs();
  } catch (e) {
    s.runActive = false;
    renderTerminalTabs();
    fireRunExit();
    throw e;
  }
}

/** 停止运行终端里的脚本（main.ts 的 `stopRun` 按 runChannel 路由到此）。
 * `term_kill` 不发 term-exit（只有自然退出才 notify），故此处直接触发退出回调，
 * 保证统一运行态立即复位、会话槽可立即复用。
 * P1-J：软杀优先——先向 PTY 写 Ctrl+C（\x03，ConPTY 转换为控制台事件，uvicorn 等
 * 长驻服务可优雅退出），宽限 1.2s 未退再 term_kill 强杀；脚本已自然退出则跳过。 */
export async function stopRunTerminal(): Promise<void> {
  const s = termSessions.find((x) => x.kind === "run");
  if (!s) {
    fireRunExit();
    return;
  }
  if (s.runActive) {
    await invoke("term_write", { id: s.id, data: "\x03" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1200));
  }
  await invoke("term_kill", { id: s.id }).catch(() => undefined);
  s.runActive = false;
  s.iterm.markStopped();
  renderTerminalTabs();
  fireRunExit();
}

/** 执行高频命令（P2-6：一键插入或立即执行）。
 * 命令必须落到**交互 shell**：运行终端（S3）跑完即退，往里写命令没有意义。 */
async function runTerminalCommand(cmd: string, run: boolean): Promise<void> {
  setBottomTab("terminal");
  const s = await ensureShellTerminal();
  if (!s) return;
  if (!s.iterm.isRunning()) {
    // 激活终端已退出 → 重启它（保持同一 tab，沿用当初选的 shell，不被全局默认覆盖）
    s.venv = await s.iterm.start(defaultTerminalCwd(), app.workspaceRoot, s.shell);
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
  runTermSeq = 0;
  // 运行态由 main.ts 的 resetWorkspaceUiState 统一复位；此处只丢弃回调，避免旧工作区的 hook 被后续触发
  runExitHook = null;
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
  $("btn-clear-output").addEventListener("click", () => {
    outputHooks?.onClear(); // S4：先丢弃未完结行状态，再清空容器
    clearOutput(outputEl);
  });
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
  // 启动即预取可用 shell 列表，让默认路径（右键「在终端中打开」/「命令…」落点）也能正确退化
  void fetchAvailableShells();
  await listen<{ id: string; data: string }>("term-data", (e) => {
    termSessions.find((s) => s.id === e.payload.id)?.iterm.writeData(e.payload.data);
  });
  await listen<{ id: string }>("term-exit", (e) => {
    const s = termSessions.find((x) => x.id === e.payload.id);
    if (!s) return;
    s.iterm.handleExit();
    // S3：运行终端里的脚本自然退出 → 复位统一运行态（停止按钮 / 标签页运行图标），
    // tab 本身保留，供阅读输出与点击 traceback（§4.7 结论 2）
    if (s.kind === "run") {
      s.runActive = false;
      renderTerminalTabs();
      fireRunExit();
    }
  });
}
