// 运行域（TD-14 拆分，原 main.ts 的「运行 + P0-C 命名配置 + Compound + FastAPI + S4 交互输入 + P2-N auto_rerun」段）。
// 两条运行路径共用一套「运行态」（§4.7 结论 3，S3/S4 首版单实例）：
// - **输出面板**（runActive → `lsp::run_script`）：默认路径，traceback 天然可点击；
//   stdin=interactive（S4）时输出面板下方亮出输入行，用户逐行应答。
// - **运行终端**（runActiveInTerminal → `terminal::run_in_terminal`）：真 TTY，覆盖
//   getpass / tqdm / rich / 彩色输出 / Ctrl+C（坑 3：管道模式下 isatty() 为假，这些全都退化）。
// 运行态收敛为 runState.ts 的 RunState 判别联合（TD-14 ①）；`running` / `runningPath` /
// 停止按钮 / tab 运行图标对两条路径一致，按 `channel` 路由停止动作。
// openFile / activateTab / renderTabs / saveActive 经 setRunFlowHandlers 注入
// （terminal.ts::setTerminalLinkHandler 的 handler 注入先例，避免与 main 循环依赖）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { app, $, $btn, outputEl, type Tab } from "./state";
import { basename, joinPath, parentDirOf, samePath } from "./util";
import { appendOutputLine, RunTranscript } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { openConfirm } from "./dialog";
import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import * as kb from "./keybindings";
import * as dap from "./dap/client";
import { runScriptInTerminal, stopRunTerminal, setOutputPanelHooks } from "./termUi";
import { currentInterpreter, shortInterpreter } from "./envPanel";
import {
  EMPTY_RUN_CONFIG, getRunState, setRunState, isRunning, runChannelOf, runningPathOf,
  normalizeRunConfig, stdinModeOf,
  type RunConfig, type StdinMode, type SelectionRunMeta,
} from "./runState";
import { startRun, finishRun, recordLines, isViewingLive, type RunRecord } from "./runHistory";
import { renderRunWidget, type RunWidgetState } from "./runWidget";

// ---------- 注入（main 的 init 中 setRunFlowHandlers） ----------

interface RunFlowHandlers {
  openFile: (path: string, revealLine?: number) => Promise<void>;
  activateTab: (tab: Tab) => void;
  renderTabs: () => void;
  saveActive: () => Promise<void>;
}

let handlers: RunFlowHandlers | null = null;

export function setRunFlowHandlers(h: RunFlowHandlers): void {
  handlers = h;
}

function h(): RunFlowHandlers {
  if (!handlers) throw new Error("[OpenCharm] runFlow 尚未接线（setRunFlowHandlers 须在 init 中先于任何运行调用）");
  return handlers;
}

// ---------- 域内状态 ----------

/** CR-07：运行准备期闸门——检查与置位之间不得有 await，杜绝连按触发并发启动。
 * `running`（RunState）在 `prepareRun`（含保存、依赖预检、确认框）之后才置位，此前连点 Ctrl+F10
 * 会并发拉起两个 `run_script`，后端单实例槽被顶掉、状态错乱。生命周期与 RunState 正交（见 runState.ts）。 */
let runPreparing = false;
/** 上次运行的路径与通道（「停止并重新运行」用）。resetRunState 不清，切换/关闭工作区清（resetRunSessionState）。
 * P0-C：命名配置运行的路径存为 `profile:<name>`。 */
let lastRun: { path: string; channel: "output" | "terminal" } | null = null;
/** P0-C：命名运行配置缓存（▾ 菜单 / 编辑面板数据源）；打开工作区 / 编辑配置后刷新 */
let runProfiles: RunConfig[] = [];
/** P0-C：最近一次按命名配置运行的名字（restartRun 重跑用） */
let lastProfile: string | null = null;
/** P0-E：FastAPI 提示按工作区每会话最多一次 */
let fastApiHintShownFor: string | null = null;
/** P0-B：EOF 一键补救动作执行中（防连点：重跑链路含 stopRun + runActive 多个 await） */
let eofRemedyBusy = false;
/** P2-N：auto_rerun 防抖定时器 */
let autoRerunTimer: number | undefined;
/** 运行输出转录器（S4）：把流式 chunk 还原成行——提示符立即可见，traceback 链接不被切碎 */
const runTranscript = new RunTranscript(outputEl, gotoFromLink);
/** UI-05：并行运行模态焦点陷阱解除句柄，关闭时置 null */
let releaseCompoundFocus: (() => void) | null = null;

// S4：输出面板内的交互输入行（仅 running && stdin=interactive 时可见）
const runStdinRowEl = $("run-stdin-row");
const runStdinInputEl = $("run-stdin-input") as HTMLInputElement;
const runStdinStatusEl = $("run-stdin-status");

// ---------- 运行前公共准备 ----------

/** 运行前公共准备的产物 */
export interface RunPrep {
  /** 归一化后的 stdin 模式（决定回显后缀 / 输入行可见性 / EOF 归因口径） */
  stdinMode: StdinMode;
  /** 运行回显行：`> [venv] <解释器> <脚本> <args> < <file>  (<路径>)` */
  echo: string;
  /** P1-K：归一化后的完整运行配置（Before launch 执行依赖 pre_run_profile / open_browser_url） */
  profile: RunConfig;
}

/** 运行前公共准备：Python 文件校验 → 自动保存 → 依赖预检 → 读运行配置 → 组装回显。
 * 返回 null 表示不应运行（不是 Python 文件，或用户在预检对话框里选了取消）。
 * 两条运行路径（含 main 的 runDebug）共用，避免「预检只在输出面板路径生效」这类漂移。 */
export async function prepareRun(path: string): Promise<RunPrep | null> {
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return null;
  }
  if (app.activeTab?.dirty) await h().saveActive(); // 运行前自动保存
  // 运行前依赖预检：文件顶层 import 的第三方模块须在当前解释器中可解析，否则提前提示（避免「补全可用但运行 ImportError」）
  if (currentInterpreter) {
    const missing = await invoke<Array<{ name: string; line: number; stmt: string }>>(
      "check_missing_imports",
      { path, workspaceRoot: app.workspaceRoot },
    ).catch((e) => {
      console.warn("[pre-run] 依赖检测失败，跳过:", e);
      return [] as Array<{ name: string; line: number; stmt: string }>;
    });
    if (missing.length > 0) {
      const lines = missing.map((m) => `第 ${m.line} 行  ${m.stmt}`).join("\n");
      const proceed = await openConfirm({
        title: "运行前依赖预检",
        message: `以下导入在当前解释器中未找到，运行可能出现 ImportError：\n\n${lines}\n\n仍要运行吗？`,
        okLabel: "仍要运行", cancelLabel: "取消", kind: "danger",
      });
      if (!proceed) return null;
    }
  }
  // P3：读取持久化的运行配置（后端同样读取并应用，此处仅为运行前显式化 + 决定 stdin 形态）
  const rc = app.workspaceRoot
    ? await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path }).catch(() => ({} as Partial<RunConfig>))
    : ({} as Partial<RunConfig>);
  // S1/S4：记下本次运行的 stdin 模式（回显后缀 + S2 的 EOF 归因 + 输入行可见性都依赖它）
  const stdinMode = stdinModeOf(rc);
  const args = rc.args?.trim() ?? "";
  const argsSuffix = args ? ` ${args}` : "";
  const stdinSuffix =
    stdinMode === "file" ? ` < ${rc.stdin?.path}` : stdinMode === "interactive" ? "  [交互输入]" : "";
  // P1（建议 2）：回显含来源前缀（[venv]/[system]/[uv run]）+ 实际解释器完整路径，
  // 让用户运行前明确知道“这次用哪套环境跑”。
  const source = currentInterpreter
    ? shortInterpreter(currentInterpreter) === ".venv"
      ? "venv"
      : "system"
    : "uv run";
  const cmd = currentInterpreter
    ? `${currentInterpreter} ${basename(path)}${argsSuffix}${stdinSuffix}`
    : `uv run ${basename(path)}${argsSuffix}${stdinSuffix}`;
  return { stdinMode, echo: `> [${source}] ${cmd}  (${path})`, profile: normalizeRunConfig(rc, basename(path)) };
}

/** P1-K：等待当前输出面板运行结束（run-exit 事件）；超时或事件丢失则报错（供前置配置等待） */
async function waitForRunExit(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let un: (() => void) | null = null;
    const timer = setTimeout(() => {
      un?.();
      reject(new Error(`等待运行结束超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);
    void listen<{ code: number | null }>("run-exit", () => {
      clearTimeout(timer);
      un?.();
      resolve();
    }).then((u) => {
      un = u;
    });
  });
}

/** P1-K：Before launch 最小集——先运行指定命名配置并等待其结束（超时中止，长驻服务慎配）。
 * 返回 false = 前置失败，主运行不应继续。 */
async function runPreLaunch(preRunProfile: string): Promise<boolean> {
  const n = preRunProfile.trim();
  if (!n) return true;
  appendOutputLine(outputEl, `> [before-launch] 先运行配置「${n}」，结束后再继续…`, "cmd", gotoFromLink);
  try {
    await invoke("run_profile", { workspaceRoot: app.workspaceRoot, name: n, probe: false });
  } catch (e) {
    appendOutputLine(outputEl, `前置配置「${n}」启动失败：${e}`, "stderr", gotoFromLink);
    return false;
  }
  try {
    await waitForRunExit(5 * 60_000);
  } catch (e) {
    appendOutputLine(outputEl, `等待前置配置「${n}」结束失败：${e}`, "stderr", gotoFromLink);
    return false;
  }
  return true;
}

/** P1-K：主运行 spawn 成功后打开浏览器（fire-and-forget；open_external 仅放行 http/https） */
function openBrowserAfterLaunch(url: string): void {
  const u = url.trim();
  if (!u) return;
  invoke("open_external", { url: u }).catch((e) =>
    appendOutputLine(outputEl, `打开浏览器失败：${e}`, "stderr", gotoFromLink),
  );
}

// ---------- 运行态复位 ----------

/** 复位运行态（两条路径共用：run-exit / 运行终端退出 / 启动失败 / 停止都走这里）。
 * CR-05：选区运行的临时文件在复位时删除（run-exit / 停止 / 失败全路径覆盖），meta 一并清空。
 * TD-14 ①：RunState 整组置回 idle，杜绝残留半复位态。 */
export function resetRunState(): void {
  const s = getRunState();
  if (s.phase === "running" && s.selection) cleanupSelectionRunMeta(s.selection);
  setRunState({ phase: "idle" });
  syncRunStdinRow();
  h().renderTabs();
}

/** CR-05：清理选区运行临时文件与元信息（幂等；失败仅提示不阻断状态复位） */
function cleanupSelectionRunMeta(meta: SelectionRunMeta): void {
  invoke("delete_file", { path: meta.tempPath }).catch((e) => {
    appendOutputLine(outputEl, `清理选区临时文件失败（可手工删除）: ${meta.tempPath} — ${e}`, "hint", gotoFromLink);
  });
}

/** 工作区切换/关闭时的运行域会话复位：交互输入行清空 + 「停止并重新运行」目标作废
 * （运行态本身已由 resetRunState 复位；原 main 的两行收敛于此） */
export function resetRunSessionState(): void {
  runStdinInputEl.value = "";
  lastRun = null;
}

/** 关闭工作区：命名配置缓存 / lastProfile / FastAPI 提示去重均为工作区级，一并清空 */
export function clearRunProfilesCache(): void {
  runProfiles = [];
  lastProfile = null;
  fastApiHintShownFor = null;
}

/** 切换/关闭工作区时丢弃未完结行状态（否则会往已被清空的游离元素里写） */
export function discardRunTranscript(): void {
  runTranscript.discard();
}

/** 运行进行中或准备中（CR-07 闸门语义；runDebug 等的互斥判定） */
export function isRunBusy(): boolean {
  return isRunning() || runPreparing;
}

// ---------- 运行组状态 ----------

/** 组装运行组状态（从 RunState + 域内缓存 + app 派生，不新增第二份真值） */
export function runWidgetState(): RunWidgetState {
  const hasWs = !!app.workspaceRoot;
  const tab = app.activeTab;
  const isPy = !!tab && (tab.path.endsWith(".py") || tab.path.endsWith(".pyw"));
  const canRun = hasWs && !!tab && isPy;
  // D4「调试态与运行态 UI 不混淆」：调试中 ⏹ 必须可用（点击路由到 debug_stop），
  // 否则用户在调试中失去了菜单栏停止入口（E2E 实测：调试中 #btn-stop disabled）。
  const dbgPhase = dap.currentPhase();
  const debugging = dbgPhase === "starting" || dbgPhase === "running" || dbgPhase === "stopped";
  let disabledReason: string;
  if (!hasWs) disabledReason = "未打开工作区";
  else if (!tab) disabledReason = "没有打开的文件";
  else disabledReason = "当前文件不是 Python 文件";
  return {
    canRun,
    disabledReason,
    running: isRunning() || debugging,
    // P1（UX 审查）：准备期独立表达——原先混进 running，▶ 的提示误报「已有脚本在运行（先停止）」
    preparing: runPreparing,
    channel: runChannelOf(),
    targetName: tab ? basename(tab.path) : "",
    runShortcut: kb.bindingLabel("run"),
    stopShortcut: kb.bindingLabel("stop"),
    selectionShortcut: kb.bindingLabel("run_selection"),
    canOpenConfig: canRun,
    // P0-C：▾ 菜单配置区数据源
    profiles: runProfiles.map((p) => ({ name: p.name, summary: profileSummary(p) })),
  };
}

/** CR-07：运行闸门——同步检查并置位（检查与置位间无 await）。
 * 返回 false 表示已有运行（准备中或进行中）。三条运行路径（输出面板 / 终端 / 选区）共用。 */
function beginRunPreparing(): boolean {
  if (isRunning() || runPreparing) return false;
  runPreparing = true;
  h().renderTabs(); // 准备期即置灰 ▶，给用户即时反馈
  return true;
}

/** CR-07：准备结束（成功进入运行态或放弃），释放闸门 */
function endRunPreparing(): void {
  runPreparing = false;
  h().renderTabs();
}

// ---------- 运行历史入档 ----------

/** P2-M：非实时查看期间的后台入档——不渲染面板（用户正回看历史记录），
 * 按 chunk 尽力切行；**无 half-line 缓冲**：半行直接成行，行界为近似值（回看场景可接受），
 * 空行保留、末尾换行不产生空行。 */
function ingestBackground(cls: string, data: string): void {
  const segs = data.split("\n");
  if (segs.length > 0 && segs[segs.length - 1] === "") segs.pop();
  if (segs.length > 0) recordLines(cls, segs);
}

/** P2-M：标签条「重跑」——按记录原始形态路由：命名配置按名重跑；文件运行激活 tab 后运行。
 * 已有运行在跑时由 runProfile / runActive 的冲突询问式兜底（P1-H）。 */
export async function rerunRecord(r: RunRecord): Promise<void> {
  if (r.profileName) {
    await runProfile(r.profileName);
    return;
  }
  const tab = app.tabs.find((t) => t.path === r.path);
  if (tab) {
    h().activateTab(tab);
  } else {
    try {
      await h().openFile(r.path);
    } catch {
      appendOutputLine(outputEl, `无法重新运行：${r.path}（文件可能已不存在）`, "stderr", gotoFromLink);
      return;
    }
  }
  await runActive();
}

/** 「停止并重新运行」：按上次通道重跑 lastRun.path。目标文件已不在 tabs 时先打开，
 *  若打开失败（磁盘文件已删）则置灰不跑——绝不静默跑错文件（T11）。 */
export async function restartRun(): Promise<void> {
  if (!lastRun) return;
  const { path, channel } = lastRun;
  await stopRun();
  // P0-C：命名配置运行的重跑——无文件锚点，按名重跑（输出面板路径）
  if (path.startsWith("profile:")) {
    if (lastProfile) await runProfile(lastProfile);
    return;
  }
  const tab = app.tabs.find((t) => t.path === path);
  if (tab) {
    h().activateTab(tab);
  } else {
    try {
      await h().openFile(path);
    } catch (e) {
      appendOutputLine(outputEl, `无法重新运行：${path}（文件可能已不存在）`, "stderr", gotoFromLink);
      return;
    }
  }
  if (channel === "terminal") await runActiveInTerminal();
  else await runActive();
}

// ---------- 输出面板路径 ----------

/** 在输出面板运行（默认路径） */
export async function runActive(): Promise<void> {
  if (!app.activeTab) return;
  if (!beginRunPreparing()) return; // CR-07：准备期闸门（同步检查并置位）
  const path = app.activeTab.path;
  let prep: RunPrep | null = null;
  try {
    prep = await prepareRun(path);
  } finally {
    if (!prep) endRunPreparing(); // 预检取消/失败 → 释放闸门（成功路径在下方置 RunState 后释放）
  }
  if (!prep) return;
  if (isRunning()) {
    endRunPreparing(); // 准备期间已有运行启动（如 run-exit 重入）→ 放弃
    return;
  }
  // P1-K：Before launch——前置配置先跑完（失败则中止主运行）
  if (!(await runPreLaunch(prep.profile.pre_run_profile))) {
    endRunPreparing();
    return;
  }
  lastRun = { path, channel: "output" };
  setRunState({
    phase: "running",
    channel: "output",
    path,
    stdinMode: prep.stdinMode,
    eofHinted: false,
    selection: null,
    profile: prep.profile, // P2-N：auto_rerun 判定依据
  });
  runTranscript.flush(); // 上一轮残留的半行先定型，避免与本次输出粘成一行
  endRunPreparing(); // 状态就绪后释放闸门（内含 renderTabs）
  startRun(path, "output"); // P2：运行历史——本次留档（输出面板路径才有 run-stdout/stderr 事件可采）
  appendOutputLine(outputEl, prep.echo, "cmd", gotoFromLink);
  recordLines("cmd", [prep.echo]); // 回显行也入档，否则历史里看不出跑的是什么
  // S4：交互式运行 → 亮出输入行并聚焦，把「等待输入…」显式化（缓解坑 2 的单实例阻塞焦虑）
  syncRunStdinRow();
  try {
    await invoke("run_script", { path, workspaceRoot: app.workspaceRoot, probe: app.settings.probe_enabled });
    // 输出经 run-stdout / run-stderr / run-exit 事件流式到达
  } catch (e) {
    // P1-H：冲突改询问式（后端竞态报「已有…在运行」时弹「停止并重跑」）
    if (await maybeRetryAfterConflict(e, () => runActive())) return;
    // S1：stdin 重定向文件打不开时后端 fail fast，错误原因在此可见（不留僵尸运行态）
    appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
    // P2：启动失败也要收尾历史记录——否则这条会永远停在中途，显示「运行中…」
    recordLines("stderr", [`运行失败: ${e}`]);
    finishRun(null);
    resetRunState();
  }
}

/** P1-H：运行冲突询问式。后端报「已有…在运行」类错误时弹确认「停止当前实例并启动新实例？」，
 * 确认后 stopRun + 重试一次；用户取消则保留当前运行（输出提示，不算失败）。
 * 返回 true = 冲突已处理（调用方不再走失败分支）。 */
async function maybeRetryAfterConflict(e: unknown, retry: () => Promise<void>): Promise<boolean> {
  const msg = String(e ?? "");
  if (!/已有(脚本在运行|脚本在终端中运行|调试会话在运行)/.test(msg)) return false;
  const ok = await openConfirm({
    title: "已有运行中的实例",
    message: `${msg}。要停止当前实例并启动新实例吗？`,
    okLabel: "停止并运行", cancelLabel: "取消", kind: "danger",
  });
  if (!ok) {
    appendOutputLine(outputEl, "已保留当前运行，未启动新实例", "hint", gotoFromLink);
    return true;
  }
  await stopRun();
  await retry();
  return true;
}

// ---------- 运行终端路径 ----------

/** S3：在终端中运行（真 TTY）。输出落点=专用「运行终端」tab（§4.7 结论 2）：
 * 独立标签样式与普通 shell 区分，生命周期也不同——脚本跑完即结束会话，
 * tab 保留供阅读输出与点击 traceback（坑 4 由 xterm link provider 补齐）。 */
export async function runActiveInTerminal(): Promise<void> {
  if (!app.activeTab) return;
  if (!beginRunPreparing()) return; // CR-07：准备期闸门（同步检查并置位）
  const path = app.activeTab.path;
  let prep: RunPrep | null = null;
  try {
    prep = await prepareRun(path);
  } finally {
    if (!prep) endRunPreparing();
  }
  if (!prep) return;
  // PTY 无法直接接管重定向文件（§4.4 末行）：不静默降级成手工输入——
  // 那会破坏 file 模式「可复现」的核心诉求，因此明确拒绝并给出两条出路。
  if (prep.stdinMode === "file") {
    endRunPreparing();
    appendOutputLine(
      outputEl,
      "「在终端中运行」不支持标准输入重定向自文件（PTY 无法直接接管文件）。可在标签右键 →「运行配置…」中改为「不接输入」或「交互式」，或改用普通「运行」。",
      "hint",
      gotoFromLink,
    );
    return;
  }
  if (isRunning()) {
    endRunPreparing();
    return;
  }
  lastRun = { path, channel: "terminal" };
  // PTY 下 stdin 天然是 TTY：交互由终端自身承载，输出面板的输入行与 S2 的 EOF 归因都不适用
  setRunState({
    phase: "running",
    channel: "terminal",
    path,
    stdinMode: "null",
    eofHinted: false,
    selection: null,
    profile: null,
  });
  endRunPreparing(); // 状态就绪后释放闸门（内含 renderTabs）
  syncRunStdinRow();
  try {
    await runScriptInTerminal(path, prep.echo, resetRunState);
  } catch (e) {
    // P1-H：冲突改询问式（终端路径仍为单实例硬约束，但给「停止并重跑」出路）
    if (await maybeRetryAfterConflict(e, () => runActiveInTerminal())) return;
    appendOutputLine(outputEl, `在终端中运行失败: ${e}`, "stderr", gotoFromLink);
    resetRunState();
  }
}

// ---------- P0-C：命名运行配置（Run 部件 ▾ 菜单） ----------

/** ▾ 菜单配置项的摘要：`-m uvicorn main:app --reload` / `pkg/main.py --flag`（runConfigPanel 复用） */
export function profileSummary(p: RunConfig): string {
  const args = p.args?.trim() ? ` ${p.args.trim()}` : "";
  const target = p.entry.kind === "module" ? `-m ${p.entry.target}${args}` : `${p.entry.target}${args}`;
  const cwdNote = p.cwd.trim() ? `  @${p.cwd.trim()}` : "";
  return target + cwdNote;
}

/** 配置运行的回显行（与 prepareRun 同风格：来源前缀 + 命令 + cwd 说明） */
function profileEcho(p: RunConfig): string {
  const source = currentInterpreter
    ? shortInterpreter(currentInterpreter) === ".venv"
      ? "venv"
      : "system"
    : "uv run";
  const args = p.args?.trim() ? ` ${p.args.trim()}` : "";
  const mode = stdinModeOf(p);
  const stdinSuffix = mode === "file" ? ` < ${p.stdin.path}` : mode === "interactive" ? "  [交互输入]" : "";
  const cmd =
    p.entry.kind === "module"
      ? currentInterpreter
        ? `python -m ${p.entry.target}${args}`
        : `uv run python -m ${p.entry.target}${args}`
      : `${p.entry.target}${args}`;
  const cwd = p.cwd.trim() ? `  (cwd: ${p.cwd.trim()})` : "";
  return `> [${source}] ${cmd}${stdinSuffix}${cwd}`;
}

/** P0-C：刷新命名运行配置缓存 + 重绘运行部件（▾ 菜单数据源） */
export async function refreshRunProfiles(): Promise<void> {
  if (!app.workspaceRoot) {
    runProfiles = [];
    renderRunWidget(runWidgetState());
    return;
  }
  runProfiles = await invoke<Partial<RunConfig>[]>("list_run_profiles", { workspaceRoot: app.workspaceRoot })
    .then((list) => list.map((p) => normalizeRunConfig(p)))
    .catch(() => runProfiles);
  renderRunWidget(runWidgetState());
}

/** 命名运行配置缓存（runConfigPanel 的下拉 / 编辑数据源；刷新走 refreshRunProfiles） */
export function getRunProfiles(): RunConfig[] {
  return runProfiles;
}

/** P0-C：按命名运行配置运行（module 入口无需打开任何文件；script 入口做依赖预检）。
 * P1-H：`allow_multiple` 配置在已有运行时放行为额外实例（stdin 恒 null、不动运行态）；
 * 其余情况冲突改询问式——弹「停止当前实例并运行新实例？」确认后重跑。
 * P2 Compound：`forceExtra` 用于并行启动多个配置（绕过冲突询问，直接作为并行实例）。 */
export async function runProfile(name: string, forceExtra = false): Promise<void> {
  if (!app.workspaceRoot) return;
  if (runPreparing) return; // 防双击（多实例路径同样适用）
  const p = runProfiles.find((x) => x.name === name);
  if (!p) {
    appendOutputLine(outputEl, `找不到运行配置：${name}`, "stderr", gotoFromLink);
    return;
  }
  const isExtra = isRunning() && (p.allow_multiple || forceExtra);
  if (isRunning() && !p.allow_multiple && !forceExtra) {
    // P1-H：冲突询问式——与 PyCharm「停止正在运行的实例并启动新实例」一致
    const ok = await openConfirm({
      title: "已有运行中的实例",
      message: `已有脚本在运行。要停止当前实例并运行「${name}」吗？`,
      okLabel: "停止并运行", cancelLabel: "取消", kind: "danger",
    });
    if (!ok) return;
    await stopRun();
    await runProfile(name); // 槽已空，走主实例路径
    return;
  }
  if (!isExtra && !beginRunPreparing()) return;
  try {
    // 额外实例路径：不动统一运行态（RunState / lastRun 仍归属首个实例），仅回显 + spawn
    if (isExtra) {
      const echo = profileEcho(p);
      appendOutputLine(outputEl, echo, "cmd", gotoFromLink);
      try {
        await invoke("run_profile", { workspaceRoot: app.workspaceRoot, name, probe: app.settings.probe_enabled, forceExtra });
      } catch (e) {
        appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
      }
      return;
    }
    // script 入口：对目标文件做依赖预检（module 入口的依赖即模块自身，交给运行时暴露）
    if (p.entry.kind === "script" && p.entry.target.trim() && currentInterpreter) {
      const targetAbs = joinPath(app.workspaceRoot, p.entry.target.trim());
      const missing = await invoke<Array<{ name: string; line: number; stmt: string }>>(
        "check_missing_imports",
        { path: targetAbs, workspaceRoot: app.workspaceRoot },
      ).catch(() => [] as Array<{ name: string; line: number; stmt: string }>);
      if (missing.length > 0) {
        const lines = missing.map((m) => `第 ${m.line} 行  ${m.stmt}`).join("\n");
        const proceed = await openConfirm({
          title: "运行前依赖预检",
          message: `运行配置「${name}」：以下导入在当前解释器中未找到，运行可能出现 ImportError：\n\n${lines}\n\n仍要运行吗？`,
          okLabel: "仍要运行", cancelLabel: "取消", kind: "danger",
        });
        if (!proceed) return;
      }
    }
    // P1-K：Before launch——前置配置先跑完（失败则中止主运行；额外实例路径不执行）
    if (!(await runPreLaunch(p.pre_run_profile))) return;
    lastRun = { path: `profile:${name}`, channel: "output" };
    lastProfile = name;
    setRunState({
      phase: "running",
      channel: "output",
      path: null, // module 入口无文件锚点：tab 不显示停止图标，⏹ 按钮照常可用
      stdinMode: stdinModeOf(p),
      eofHinted: false,
      selection: null,
      profile: p, // P2-N：auto_rerun 判定依据
    });
    // P2-M 顺带修复：配置运行此前未调 startRun，输出从未进历史留档
    startRun(`profile:${name}`, "output", name);
    runTranscript.flush(); // 上一轮残留的半行先定型
    const echo = profileEcho(p);
    appendOutputLine(outputEl, echo, "cmd", gotoFromLink);
    recordLines("cmd", [echo]);
    syncRunStdinRow();
    try {
      await invoke("run_profile", { workspaceRoot: app.workspaceRoot, name, probe: app.settings.probe_enabled });
      // P1-K：启动成功后打开浏览器（Launch Web Browser 最小集）
      openBrowserAfterLaunch(p.open_browser_url);
    } catch (e) {
      appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
      recordLines("stderr", [`运行失败: ${e}`]);
      finishRun(null);
      resetRunState();
    }
  } finally {
    endRunPreparing();
  }
}

// ---------- P2：并行运行多个配置（Compound 最小集，不持久化） ----------

/** 打开并行运行勾选面板（▾ 菜单「并行运行配置…」） */
export function openCompoundPanel(): void {
  const host = $("run-compound-modal");
  const list = $("run-compound-list");
  list.innerHTML = "";
  if (runProfiles.length === 0) {
    appendOutputLine(outputEl, "暂无命名运行配置，请先在 ▾ →「运行配置…」中创建", "hint", gotoFromLink);
    return;
  }
  runProfiles.forEach((p, i) => {
    const label = document.createElement("label");
    label.className = "compound-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = p.name;
    cb.checked = i === 0;
    const span = document.createElement("span");
    span.textContent = `${p.name}（${profileSummary(p)}）`;
    span.title = profileSummary(p);
    label.append(cb, span);
    list.appendChild(label);
  });
  showEl(host);
  releaseCompoundFocus?.();
  releaseCompoundFocus = trapFocus(host);
}

function closeCompoundPanel(): void {
  releaseCompoundFocus?.();
  releaseCompoundFocus = null;
  hideEl($("run-compound-modal"));
}

/** 并行运行勾选的配置：第一个走常规路径（占用主槽），其余强制并行实例（forceExtra） */
async function runCompound(): Promise<void> {
  const list = $("run-compound-list");
  const names = Array.from(list.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")).map((cb) => cb.value);
  closeCompoundPanel();
  if (names.length === 0) return;
  appendOutputLine(outputEl, `> 并行运行 ${names.length} 个配置：${names.join(" + ")}`, "cmd", gotoFromLink);
  for (let i = 0; i < names.length; i++) {
    await runProfile(names[i], i > 0);
  }
}

// ---------- P0-E：FastAPI 预设（仅提示形态） ----------

/** P0-E：FastAPI 项目探测。每个工作区每会话最多提示一次；已有 uvicorn 配置则不打扰。
 * 探测与配置生成都只做「提示 + 用户点击」，绝不静默改配置/装包。 */
export async function maybeSuggestFastApi(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root || fastApiHintShownFor === root) return;
  fastApiHintShownFor = root;
  const hit = await invoke<{ file: string; module: string; app_var: string; has_uvicorn: boolean } | null>(
    "detect_fastapi",
    { workspaceRoot: root },
  ).catch(() => null);
  if (!hit) return;
  const hasUvicornProfile = (): boolean =>
    runProfiles.some((p) => p.entry.kind === "module" && p.entry.target.trim().toLowerCase() === "uvicorn");
  if (hasUvicornProfile()) return;
  const el = appendOutputLine(
    outputEl,
    `检测到 FastAPI 项目（${hit.file}）。${hit.has_uvicorn ? "" : "尚未安装 uvicorn（可 uv add uvicorn）。"}可一键生成运行配置：`,
    "hint",
    gotoFromLink,
  );
  const a = document.createElement("span");
  a.className = "out-link";
  a.textContent = "生成「FastAPI」配置并运行";
  a.addEventListener("click", () => {
    void createFastApiProfile(hit).catch((e) =>
      appendOutputLine(outputEl, `生成 FastAPI 配置失败：${e}`, "stderr", gotoFromLink),
    );
  });
  el.appendChild(document.createTextNode("　"));
  el.appendChild(a);
}

/** P0-E：一键生成 FastAPI 预设（module=uvicorn, cwd=工作区根）并直接运行；已存在同名配置则直接运行。 */
async function createFastApiProfile(hit: { module: string; app_var: string }): Promise<void> {
  if (!app.workspaceRoot) return;
  if (!runProfiles.some((p) => p.name === "FastAPI")) {
    const profile: RunConfig = {
      name: "FastAPI",
      entry: { kind: "module", target: "uvicorn" },
      args: `${hit.module}:${hit.app_var} --reload`,
      cwd: "${workspaceRoot}",
      env: [],
      env_files: [],
      stdin: { mode: "interactive", path: "" },
      interpreter: "",
      allow_multiple: false,
      // P1-K/P2-L：uvicorn 默认端口，启动后自动开浏览器（服务未就绪时用户刷新即可）
      pre_run_profile: "",
      open_browser_url: "http://127.0.0.1:8000",
      auto_rerun: false,
      python_console: false,
    };
    await invoke("save_run_profile", { workspaceRoot: app.workspaceRoot, profile });
    await refreshRunProfiles();
    appendOutputLine(outputEl, `已创建运行配置「FastAPI」：uvicorn ${profile.args}`, "stdout", gotoFromLink);
  }
  await runProfile("FastAPI");
}

// ---------- S4：输出面板内的交互式输入 ----------

/** 输入行可见性：仅「输出面板路径 + 运行中 + stdin=interactive + 输出标签可见」时亮出并聚焦。
 * 底部面板切标签时也要重新同步（输入行只在「输出」标签下有意义）。 */
function syncRunStdinRow(): void {
  const s = getRunState();
  const show =
    s.phase === "running" &&
    s.channel === "output" &&
    s.stdinMode === "interactive" &&
    !outputEl.classList.contains("hidden");
  runStdinRowEl.classList.toggle("hidden", !show);
  if (show) {
    updateRunStdinStatus();
    runStdinInputEl.focus();
  }
}

/** 「等待输入…」状态文案（每次输出到达时刷新，**不抢焦点**——用户可能正在别处输入） */
function updateRunStdinStatus(): void {
  const s = getRunState();
  if (s.phase !== "running" || s.stdinMode !== "interactive") return;
  // 有未完结行 = 脚本写了提示符正在等回答；无未完结行 = 脚本还在跑别的
  runStdinStatusEl.textContent = runTranscript.hasPending() ? "脚本正在等待输入…" : "运行中（交互模式）";
}

/** 提交一行输入给运行中的脚本（Enter）：先把未完结的提示符行定型，再以 `.input` 行回显用户输入，
 * 让 transcript 读起来像真控制台。 */
async function submitRunStdin(): Promise<void> {
  const s = getRunState();
  if (s.phase !== "running" || s.stdinMode !== "interactive") return;
  const text = runStdinInputEl.value;
  runStdinInputEl.value = "";
  // 提示符（半行）先定型、用户输入另起一行回显：若把输入并进提示符同一行，
  // 定型时的 traceback 匹配会把用户输入也当成脚本输出去扫（且两种样式无法分段）
  runTranscript.flush();
  appendOutputLine(outputEl, text, "input", gotoFromLink);
  try {
    await invoke("run_stdin", { data: text });
  } catch (e) {
    // 槽位为空（非交互/已结束）或 BrokenPipe（脚本已退）→ 后端返回可读原因，不 panic
    appendOutputLine(outputEl, `${e}`, "stderr", gotoFromLink);
  }
  updateRunStdinStatus();
}

// ---------- S2 + P0-B：EOF 归因与一键补救 ----------

/** S2 + P0-B：EOFError 归因提示。只认 traceback 末行的 `EOFError`（**列首**匹配，避免把
 * 脚本自己打印的普通文本误判），一次运行只提示一次。
 * `interactive` 模式下**抑制**——用户主动交互时收到 EOF 属正常结束，弹「stdin 为不接输入」
 * 反而是错误归因（§4.5 跨流顺序评审结论）。
 * P0-A 后 `null` 仅剩显式选择与选区运行两种来源；提示升级为**可点击补救动作**：
 * 「以交互模式重跑」（把 stdin=interactive 落进运行配置）或「在终端中运行」（PTY 天然可输入）。 */
function maybeHintEof(line: string): void {
  const s = getRunState();
  if (s.phase !== "running" || s.eofHinted || s.stdinMode === "interactive") return;
  if (!/^EOFError\b/.test(line.trim())) return;
  s.eofHinted = true;
  if (s.stdinMode === "file") {
    appendOutputLine(
      outputEl,
      "提示：重定向的输入文件已读完，但脚本仍在请求更多输入。请补充文件内容，或在标签右键 →「运行配置…」中调整标准输入。",
      "hint",
      gotoFromLink,
    );
    return;
  }
  const el = appendOutputLine(
    outputEl,
    "提示：脚本尝试读取标准输入，但本次运行的 stdin 为「不接输入」，因此立即收到 EOF。可一键补救：",
    "hint",
    gotoFromLink,
  );
  appendEofAction(el, "以交互模式重跑", () => rerunAfterEof("output"));
  appendEofAction(el, "在终端中运行", () => rerunAfterEof("terminal"));
}

/** P0-B：在提示行尾部追加可点击动作（复用 traceback 链接的 out-link 样式） */
function appendEofAction(el: HTMLElement, label: string, fn: () => Promise<void>): void {
  const a = document.createElement("span");
  a.className = "out-link";
  a.textContent = label;
  a.addEventListener("click", () => {
    if (eofRemedyBusy) return; // 防连点：重跑链路含多个 await
    eofRemedyBusy = true;
    fn().finally(() => {
      eofRemedyBusy = false;
    });
  });
  el.appendChild(document.createTextNode("　"));
  el.appendChild(a);
}

/** P0-B：EOF 一键补救——按指定通道重跑 EOF 的那次运行。
 * output：先把 stdin=interactive 写回该脚本的运行配置（其余字段原样保留）再跑，
 *         用户点一次即永久修正「这脚本需要输入」；terminal：PTY 天然可输入，无需落配置。 */
async function rerunAfterEof(channel: "output" | "terminal"): Promise<void> {
  const path = runningPathOf();
  if (!path) return;
  try {
    if (channel === "output" && app.workspaceRoot) {
      let cfg: RunConfig = { ...EMPTY_RUN_CONFIG };
      try {
        const raw = await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path });
        cfg = normalizeRunConfig(raw);
        cfg.stdin = { mode: "interactive", path: "" };
      } catch { /* 读不到配置就按空配置落 stdin=interactive */ }
      await invoke("set_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path, config: cfg });
    }
    if (isRunBusy()) await stopRun();
    // 目标文件已不在 tabs（如用户切走）时先打开；打不开则提示并放弃——绝不静默跑错文件
    const tab = app.tabs.find((t) => t.path === path);
    if (tab) {
      h().activateTab(tab);
    } else {
      try {
        await h().openFile(path);
      } catch {
        appendOutputLine(outputEl, `无法补救重跑：${path}（文件可能已不存在）`, "stderr", gotoFromLink);
        return;
      }
    }
    if (channel === "terminal") await runActiveInTerminal();
    else await runActive();
  } catch (e) {
    appendOutputLine(outputEl, `补救重跑失败：${e}`, "stderr", gotoFromLink);
  }
}

// ---------- 选区运行 / 停止 ----------

/** 运行选区（无选区时运行光标所在行）：写入源文件同目录的临时文件后运行（不挂 probe 采样） */
export async function runSelection(): Promise<void> {
  if (!app.activeTab || isRunning()) return;
  const path = app.activeTab.path;
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return;
  }
  const editor = app.editor;
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;

  let code: string;
  let startLine: number;
  let endLine: number;
  if (sel.isEmpty()) {
    // 无选区 → 运行光标所在行
    startLine = sel.startLineNumber;
    endLine = sel.endLineNumber;
    code = model.getLineContent(startLine);
  } else {
    startLine = sel.startLineNumber;
    endLine = sel.endLineNumber;
    code = model.getValueInRange(sel);
  }
  if (!code.trim()) {
    appendOutputLine(outputEl, "选区为空，无可运行代码", "stderr", gotoFromLink);
    return;
  }
  // CR-07：准备期闸门——保存 / 写临时文件都是 await，期间连点不得并发进入
  if (!beginRunPreparing()) return;
  try {
    if (app.activeTab.dirty) await h().saveActive(); // 运行前保存（与整文件运行一致）

    // 临时文件写到源文件同目录：保证 import 相对导入 / 相对路径资源与源文件一致。
    // CR-05：文件名带进程内随机后缀——并发运行选区 / 跨目录源文件互不覆盖；
    // 结束后由 resetRunState → cleanupSelectionRunMeta 删除；watcher 侧按前缀忽略。
    const tempPath = joinPath(
      parentDirOf(path),
      `__opencharm_selection__${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.py`,
    );
    try {
      await invoke("write_file", { path: tempPath, content: code });
    } catch (e) {
      appendOutputLine(outputEl, `写入选区临时文件失败: ${e}`, "stderr", gotoFromLink);
      return;
    }

    if (isRunning()) return; // 准备期间已有运行启动 → 放弃（闸门在 finally 释放）

    // 选区运行用临时文件、**刻意不套运行配置**（含 args / env / stdin 重定向与交互）：
    // 语义上是一次性片段，保持最简 = 不接输入。P0-A 后端默认已改 interactive，
    // 故经 stdinMode 显式锁定 null——否则片段里的 input() 会被 piped 挂起而输入行不可见
    setRunState({
      phase: "running",
      channel: "output",
      path: tempPath,
      stdinMode: "null",
      eofHinted: false,
      selection: { tempPath, sourcePath: path, startLine },
      profile: null,
    });
    h().renderTabs();
    const rangeLabel = startLine === endLine ? `行 ${startLine}` : `行 ${startLine}-${endLine}`;
    appendOutputLine(outputEl, `> 运行选区  ${path}:${rangeLabel}`, "cmd", gotoFromLink);
    try {
      // probe=false：选区是临时代码，不采样（避免污染项目 trace 库）
      await invoke("run_script", { path: tempPath, workspaceRoot: app.workspaceRoot, probe: false, stdinMode: "null" });
    } catch (e) {
      appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
      resetRunState();
    }
  } finally {
    // 无论是否进入运行态都释放闸门：成功路径 running 已接管守卫，失败/放弃路径恢复可运行
    endRunPreparing();
  }
}

/** 停止运行（§4.7 结论 3：按当前路径路由——输出面板 → stop_script；运行终端 → term_kill） */
export async function stopRun(): Promise<void> {
  if (runChannelOf() === "terminal") {
    // term_kill 不发 term-exit（只有「自然退出」才 notify），故由 stopRunTerminal 内部触发退出回调
    await stopRunTerminal();
  } else {
    try {
      await invoke("stop_script");
    } catch { /* 忽略 */ }
  }
  // 立即更新状态（run-exit 事件也会更新，但可能有延迟）
  runTranscript.flush();
  resetRunState();
}

// ---------- P2-N：Rerun automatically ----------

/** P2-N：Rerun automatically——配置开启 auto_rerun 且**运行中的目标文件**变更时，
 * 防抖 800ms 后自动「停止并重新运行」（restartRun 按原通道重跑）。
 * module 入口不适用：uvicorn --reload 自带变更内环，双层重启会互相踩踏。
 * 由 main 的文件监听回调调用（自身带防抖，须在通用防抖之外先行判定）。 */
export function maybeAutoRerun(dirs: string[]): void {
  const s = getRunState();
  if (s.phase !== "running" || s.channel !== "output" || !s.profile?.auto_rerun) return;
  if (s.profile.entry.kind === "module") return;
  const root = app.workspaceRoot;
  if (!root) return;
  const target =
    s.profile.entry.kind === "script" && s.profile.entry.target.trim() ? joinPath(root, s.profile.entry.target.trim()) : s.path;
  if (!target) return;
  if (!dirs.some((d) => samePath(d, target))) return;
  window.clearTimeout(autoRerunTimer);
  autoRerunTimer = window.setTimeout(() => {
    if (isRunning()) void restartRun();
  }, 800);
}

// ---------- 接线 ----------

/** 运行域 UI 接线（main 的 init 调用）：并行运行模态 + 交互输入行 + 输出面板钩子 */
export function wireRunFlow(): void {
  // P2：并行运行（Compound 最小集）
  $btn("run-compound-close").addEventListener("click", closeCompoundPanel);
  $btn("run-compound-cancel").addEventListener("click", closeCompoundPanel);
  $btn("run-compound-run").addEventListener("click", () => void runCompound());
  $("run-compound-modal").addEventListener("click", (e) => {
    if (e.target === $("run-compound-modal")) closeCompoundPanel();
  });

  // S4：输出面板内的交互输入行（Enter 发送一行 / Escape 失焦逃生）
  runStdinInputEl.addEventListener("keydown", (e) => {
    // window 级快捷键已有「焦点在 INPUT 时不触发」守卫，此处仍 stopPropagation 双保险：
    // 输入行里敲的字符不应被任何全局键位（如 Ctrl+F10 之外的组合）截走
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void submitRunStdin();
    } else if (e.key === "Escape") {
      // 逃生口：焦点还给编辑器，避免用户被「困」在输入行里（全局 keydown 守卫会因焦点在 INPUT 而失效）
      runStdinInputEl.blur();
      app.editor.focus();
    }
  });

  // 输出面板跨域回调：切标签 → 重新同步输入行可见性（输入行只在「输出」标签下有意义）；
  // 清空输出 → 先丢弃未完结行状态，否则转录器会往已被清空的游离元素里写
  setOutputPanelHooks({
    onTabChange: () => syncRunStdinRow(),
    onClear: () => runTranscript.discard(),
  });
}

/** 运行事件接线（main 的 init 中 await）。S4：交互式运行的 payload 带 `partial`（后端按 chunk 转发），
 * 统一交给 RunTranscript 还原成行——提示符立即可见（坑 1），traceback 链接不被 chunk 切碎（结论 6）。
 * 非交互路径没有 partial 字段，走同一套逻辑等价于旧的按行追加（且不再每行多出一个空白行）。 */
export async function initRunEvents(): Promise<void> {
  await listen<{ data: string; partial?: boolean }>("run-stdout", (e) => {
    // P2-M：回看历史记录期间输出仅入档不渲染面板（不打断回看），切回标签时全量回填
    if (isViewingLive()) {
      const lines = runTranscript.write("stdout", e.payload.data, e.payload.partial === true);
      recordLines("stdout", lines); // P2：运行历史留档（复用已还原好的整行）
    } else {
      ingestBackground("stdout", e.payload.data);
    }
    updateRunStdinStatus();
  });
  await listen<{ data: string; partial?: boolean }>("run-stderr", (e) => {
    if (isViewingLive()) {
      // S2：只对**定型**的整行做 EOFError 归因（半行提示符不参与判定，避免误判）
      const lines = runTranscript.write("stderr", e.payload.data, e.payload.partial === true);
      recordLines("stderr", lines); // P2：运行历史留档
      for (const line of lines) maybeHintEof(line);
    } else {
      ingestBackground("stderr", e.payload.data);
    }
  });
  await listen<{ code: number | null }>("run-exit", (e) => {
    // 收尾：把残留半行定型（脚本以无换行输出结束时不吞字），并让它同样参与 EOF 归因
    const tail = runTranscript.flush();
    recordLines("stdout", tail); // P2：残留半行同样入档，否则最后一行报错会丢
    for (const line of tail) maybeHintEof(line);
    appendOutputLine(outputEl, `[进程退出 code=${e.payload.code ?? "null"}]`, "exit", gotoFromLink);
    finishRun(e.payload.code); // P2：结束本次运行记录
    resetRunState();
  });
}
