// 运行域（TD-14 拆分；v3.4 M3：多实例运行模型 + 四控件运行组交互）。
// - runScript() / runProject()：统一运行控制台（PTY，真 TTY）；脚本 = 当前文件（全局唯一
//   「运行」tab，覆盖语义）；项目 = 项目入口（「项目」tab 复用 / 「项目 N」并行，§6.3/§6.4）。
// - 生命周期遵循 §7：实例与 tab 同生共死；preparing 所有出口统一收口（§7.5 硬规则 2）；
//   preparing 期关闭 tab 走 canceled 标记 + spawn 落地后按 id 幂等补杀（§7.4）。
// - 调试输出走输出面板（dap.rs 的 debug-stdout / debug-stderr 事件，§13.3），与运行通道分路。
// openFile / activateTab / renderTabs / saveActive 经 setRunFlowHandlers 注入
// （terminal.ts::setTerminalLinkHandler 的 handler 注入先例，避免与 main 循环依赖）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { app, outputEl, type Tab } from "./state";
import { basename, joinPath, parentDirOf, samePath } from "./util";
import { appendOutputLine } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { openChoice, openConfirm } from "./dialog";
import * as kb from "./keybindings";
import * as dap from "./dap/client";
import {
  runScriptInTerminal, stopRunInstanceById, cancelRunInstance, setOutputPanelHooks,
  setRunTabClosedHook, setRunTabStopHook, setRunAbortProbe,
} from "./termUi";
import { currentInterpreter, shortInterpreter } from "./envPanel";
import {
  EMPTY_RUN_CONFIG, addRunInstance, clearRunInstances, findRunInstance,
  latestActiveInstance, listRunInstances, normalizeRunConfig, projectRunActive,
  removeRunInstance, scriptRunActive,
  type RunConfig, type SelectionRunMeta,
} from "./runState";
import { startRunRecord, finishRunRecord, recordRunLines, runsSnapshot, type RunRecord } from "./runHistory";
import type { RunWidgetState } from "./runWidget";

// ---------- 注入（main 的 init 中 setRunFlowHandlers） ----------

interface RunFlowHandlers {
  openFile: (path: string, revealLine?: number) => Promise<void>;
  activateTab: (tab: Tab) => void;
  renderTabs: () => void;
  saveActive: () => Promise<void>;
  /** 保存**指定** tab（运行目标可能不是活动 tab，只靠 saveActive 会漏存） */
  saveTab: (tab: Tab) => Promise<void>;
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
 * 多实例模型下按 kind 分闸（脚本 / 项目各自独立，§12：脚本与项目可同时进行）。 */
const runPreparingByKind: Record<"script" | "project", boolean> = { script: false, project: false };

function beginRunPreparing(kind: "script" | "project"): boolean {
  if (kind === "script" && scriptRunActive()) return false;
  if (runPreparingByKind[kind]) return false;
  runPreparingByKind[kind] = true;
  h().renderTabs(); // 准备期即置灰对应 ▶，给用户即时反馈
  return true;
}

function endRunPreparing(kind: "script" | "project"): void {
  runPreparingByKind[kind] = false;
  h().renderTabs();
}

function isPreparing(kind: "script" | "project"): boolean {
  return runPreparingByKind[kind];
}

/** P0-E：FastAPI 提示按工作区每会话最多一次 */
let fastApiHintShownFor: string | null = null;

// ---------- 运行前公共准备 ----------

/** 运行前公共准备的产物 */
export interface RunPrep {
  /** 运行回显行：`> [venv] <解释器> <脚本> <args>  (<路径>)` */
  echo: string;
  /** 归一化后的完整运行配置 */
  profile: RunConfig;
}

/** 解释器来源前缀（回显行共用） */
function interpreterSource(): string {
  return currentInterpreter
    ? shortInterpreter(currentInterpreter) === ".venv"
      ? "venv"
      : "system"
    : "uv run";
}

/** 运行前公共准备：Python 文件校验 → 自动保存 → 依赖预检 → 读运行配置 → 组装回显。
 * 返回 null 表示不应运行（不是 Python 文件，或用户在预检对话框里选了取消）。
 * 运行与调试（main 的 runDebug）共用，避免「预检只在某条路径生效」这类漂移（§13.1）。 */
export async function prepareRun(path: string): Promise<RunPrep | null> {
  if (!path.endsWith(".py") && !path.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${path}`, "stderr", gotoFromLink);
    return null;
  }
  // 运行前自动保存：保存的是**本次运行目标所在的 tab**，而不是活动 tab——运行目标文件
  // 往往不是当前打开的文件，只存活动 tab 会让它跑到磁盘上的旧内容（表现为「改了没生效」）。
  const targetTab = app.tabs.find((t) => samePath(t.path, path));
  if (targetTab?.dirty) await h().saveTab(targetTab);
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
  // 读取持久化的运行配置（后端同样读取并应用，此处用于运行前显式化回显）
  const rc = app.workspaceRoot
    ? await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path }).catch(() => ({} as Partial<RunConfig>))
    : ({} as Partial<RunConfig>);
  const args = rc.args?.trim() ?? "";
  const argsSuffix = args ? ` ${args}` : "";
  // P1（建议 2）：回显含来源前缀（[venv]/[system]/[uv run]）+ 实际解释器完整路径，
  // 让用户运行前明确知道“这次用哪套环境跑”。
  const source = interpreterSource();
  const cmd = currentInterpreter
    ? `${currentInterpreter} ${basename(path)}${argsSuffix}`
    : `uv run ${basename(path)}${argsSuffix}`;
  return { echo: `> [${source}] ${cmd}  (${path})`, profile: normalizeRunConfig(rc) };
}

// ---------- 生命周期收口（§7.5 硬规则：preparing 必定复位） ----------

/** preparing 的统一收口：spawn 成功 → running（写实例）；返回是否成功进入运行态。
 *  幂等护栏：实例已被移除（preparing 期关闭 tab）或已退出（stopRunById 先于 spawn 落地
 *  收口了 preparing 实例）时**不再复活为 running**——前者静默返回 false（补杀由 termUi 承担），
 *  后者保持 exited（进程若真已 spawn，killIfCanceled 已按 id 补杀，无孤儿）。
 *  调用方据返回值决定是否 startRunRecord（失败的收口不产生悬挂历史）。 */
function settleInstance(id: string, opts: {
  label: string;
  path: string | null;
  selection: SelectionRunMeta | null;
  startedAt: number;
}): boolean {
  const inst = findRunInstance(id);
  if (!inst || inst.phase === "exited") return false;
  inst.phase = "running";
  inst.label = opts.label;
  inst.path = opts.path;
  inst.selection = opts.selection;
  h().renderTabs(); // preparing→running 的 UI 刷新（⏹ 变亮、▶ 的 spinner 消退）——与 settleExited 对称
  return true;
}

/** 实例退出收口（自然退出 / 停止 / canceled 补杀共用）：phase=exited + 历史落档 +
 *  选区临时文件清理。tab 保留供回看（关闭 tab 时 removeRunInstance）。
 *  M4 实测修复：stopping=true（用户已发 \x03）时，即便 term-exit 带 code 也按
 *  stopped 落档——ConPTY 下 \x03 → CTRL_C_EXIT(0xC000013A) 几乎立即触发 term-exit，
 *  常先于 stopRunById 的宽限等待到达，「用户停止」不能被误记为自然退出。 */
function settleExited(id: string, reason: { kind: "code"; code: number } | { kind: "stopped" } | { kind: "canceled" }): void {
  const inst = findRunInstance(id);
  if (!inst || inst.phase === "exited") return; // 幂等（§7.5 硬规则 3）
  if (inst.selection) cleanupSelectionRunMeta(inst.selection);
  const wasStopping = inst.stopping;
  inst.phase = "exited";
  inst.stopping = false;
  const effective = reason.kind === "code" && wasStopping ? { kind: "stopped" as const } : reason;
  inst.exit = effective;
  finishRunRecord(id, effective.kind === "code" ? effective.code : null, effective.kind);
  h().renderTabs();
}

/** CR-05：清理选区运行临时文件与元信息（幂等；失败仅提示不阻断状态复位） */
function cleanupSelectionRunMeta(meta: SelectionRunMeta): void {
  invoke("delete_file", { path: meta.tempPath }).catch((e) => {
    appendOutputLine(outputEl, `清理选区临时文件失败（可手工删除）: ${meta.tempPath} — ${e}`, "hint", gotoFromLink);
  });
}

/** 工作区切换/关闭时的运行域整体复位（§15：停全部实例 + 清 tab 由 disposeTerminal 承担） */
export function resetRunSessionState(): void {
  clearRunInstances();
  runPreparingByKind.script = false;
  runPreparingByKind.project = false;
  fastApiHintShownFor = null;
}

/** 关闭工作区：FastAPI 提示去重均为工作区级，一并清空 */
export function clearRunProfilesCache(): void {
  fastApiHintShownFor = null;
}

/** 运行进行中或准备中（调试互斥判定收窄为脚本运行，§13.2 裁决 10） */
export function isRunBusy(): boolean {
  return scriptRunActive() || runPreparingByKind.script;
}

// ---------- 运行组状态 ----------

/** 组装运行组状态（从实例列表 + app 派生，不新增第二份真值；§7.3 矩阵） */
export function runWidgetState(): RunWidgetState {
  const hasWs = !!app.workspaceRoot;
  const tab = app.activeTab;
  const isPy = !!tab && (tab.path.endsWith(".py") || tab.path.endsWith(".pyw"));
  // preparing 与 running 分开表达（Playwright 实测修复）：preparing → spinner 置灰；
  // running → ▶脚本置灰「已有脚本」/ ▶项目**可点**（触发二选一，§7.3）——
  // 此前 projectBusy 混含两态导致项目 running 时按钮永远停在「正在准备」
  const scriptPreparing = isPreparing("script");
  const projectPreparing = isPreparing("project");
  const scriptBusy = scriptRunActive() || scriptPreparing;
  const projectBusy = projectRunActive() || projectPreparing;
  // D4「调试态与运行态 UI 不混淆」：调试中 ⏹ 必须可用（点击路由到 debug_stop）
  const dbgPhase = dap.currentPhase();
  const debugging = dbgPhase === "starting" || dbgPhase === "running" || dbgPhase === "stopped";
  let scriptDisabledReason: string;
  if (!hasWs) scriptDisabledReason = "未打开工作区";
  else if (!tab) scriptDisabledReason = "没有打开的文件";
  else if (!isPy) scriptDisabledReason = "当前文件不是 Python 文件";
  else if (scriptBusy) scriptDisabledReason = "已有脚本在运行（先停止）";
  else scriptDisabledReason = "";
  // 调试中拒绝脚本运行（§13.2 互斥收窄：调试 ↔ 脚本运行互斥，项目放行）
  if (!scriptDisabledReason && debugging) scriptDisabledReason = "调试进行中，请先停止调试";
  return {
    hasWs,
    canRunScript: hasWs && !!tab && isPy,
    scriptDisabledReason,
    // 项目运行只要求有工作区（入口探测不到时提示配置，不置灰，§7.3/§14）
    canRunProject: hasWs,
    projectDisabledReason: hasWs ? "" : "未打开工作区",
    projectBusy,
    scriptBusy,
    // preparing 单独传递（spinner 只属于准备期；running 属于「可点弹二选一」）
    scriptPreparing,
    projectPreparing,
    debugging,
    runScriptShortcut: kb.bindingLabel("run_script"),
    runProjectShortcut: kb.bindingLabel("run_project"),
    stopShortcut: kb.bindingLabel("stop"),
    stopTarget: latestActiveInstance()?.label ?? null,
    canOpenConfig: hasWs,
  };
}

/** 停止指定实例（进程 + 实例态收口；幂等）。tab 停止按钮 / ⏹ / 停止并重跑共用。
 *  preparing 期（进程未落地）：标记 canceled，spawn 返回后由 killIfCanceled 补杀（§7.4）；
 *  running 期：Ctrl+C 软杀 → 宽限 → term_kill 强杀。发 \x03 前置位 stopping——
 *  term-exit 若先于宽限到达（ConPTY 下 CTRL_C_EXIT 立即触发），settleExited 按
 *  stopped 落档而非误记 code（M4 实测修复）。 */
export async function stopRunById(id: string): Promise<void> {
  const inst = findRunInstance(id);
  if (!inst || inst.phase === "exited") return; // 幂等（§7.5 硬规则 3）
  if (inst.phase === "preparing") {
    cancelRunInstance(id);
    settleExited(id, { kind: "canceled" });
    return;
  }
  inst.stopping = true;
  await stopRunInstanceById(id);
  settleExited(id, { kind: "stopped" });
}

/** 停止运行（⏹ / Ctrl+F2）：停最近启动且仍在跑的实例（只停一个，§10）；
 *  调试态下由 main 侧路由到 debug_stop（不进此函数）。 */
export async function stopRun(): Promise<void> {
  const target = latestActiveInstance();
  if (!target) return; // 幂等：都停了则无操作（§7.5 硬规则 3）
  await stopRunById(target.id);
}

/** 停止全部运行实例（§15 工作区切换/关闭：脚本 + 所有项目实例）。
 *  软杀宽限并行计时（Ctrl+C 广播 + 单一 1.2s 等待 → 集中强杀），避免 N 实例串行 N×1.2s。 */
export async function stopAllRuns(): Promise<void> {
  const targets = listRunInstances().filter((x) => x.phase !== "exited");
  if (targets.length === 0) return;
  await stopInstancesParallel(targets.map((x) => x.id));
}

/** 停止全部项目实例（二选一「停止并重跑」的前半段，§6.4 裁决 9） */
async function stopAllProjectInstances(): Promise<void> {
  const targets = listRunInstances().filter((x) => x.kind === "project");
  if (targets.length === 0) return;
  await stopInstancesParallel(targets.map((x) => x.id));
}

/** 并行停止一批实例：preparing 的标记 canceled；running 的先全部广播 Ctrl+C，
 *  共享一次宽限等待后集中强杀（多实例时不再各自等 1.2s）。 */
async function stopInstancesParallel(ids: string[]): Promise<void> {
  const runningIds: string[] = [];
  for (const id of ids) {
    const inst = findRunInstance(id);
    if (!inst || inst.phase === "exited") continue;
    if (inst.phase === "preparing") {
      cancelRunInstance(id);
      settleExited(id, { kind: "canceled" });
    } else {
      inst.stopping = true; // \x03 先于收口到达时按 stopped 落档（同 stopRunById）
      await invoke("term_write", { id, data: "\x03" }).catch(() => undefined);
      runningIds.push(id);
    }
  }
  if (runningIds.length > 0) {
    await new Promise((r) => setTimeout(r, 1200));
    for (const id of runningIds) {
      await stopRunInstanceById(id); // 幂等：已退出的（term-exit 先到）只做 UI 收尾
      settleExited(id, { kind: "stopped" });
    }
  }
}

// ---------- 运行历史入档（重跑按记录原始形态路由） ----------

/** P2-M：历史「重跑」——按记录原始形态路由：项目记录重跑项目；文件记录激活 tab 后运行。 */
export async function rerunRecord(r: RunRecord): Promise<void> {
  if (r.kind === "project") {
    await runProject();
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
  await runScript(r.path);
}

// ---------- 运行脚本（§2：总是跑「当前文件」，无粘性目标） ----------

/** 启动一次脚本文件运行（统一运行控制台；脚本 = 全局唯一「运行」tab，覆盖语义 §6.3）。
 *  历史按实例入档（ANSI 剥离由 termUi 采集侧承担）。 */
async function launchScript(path: string, selection: SelectionRunMeta | null = null, probe?: boolean): Promise<void> {
  // v3.4 §6.4 脚本覆盖语义：脚本运行中再点「运行脚本」= 直接终止上一次并重跑（不弹框）。
  // 连点防护由 runPreparing 闸门承担（停止+重跑是原子的用户意图）。
  if (scriptRunActive() && !isPreparing("script")) {
    const old = listRunInstances().find((x) => x.kind === "script" && x.phase !== "exited")!;
    old.stopping = true; // \x03 先于宽限到达时按 stopped 落档（M4 实测修复）
    await stopRunInstanceById(old.id);
    settleExited(old.id, { kind: "stopped" });
  }
  if (!beginRunPreparing("script")) return; // CR-07：准备期闸门（同步检查并置位）
  let prep: RunPrep | null = null;
  try {
    prep = await prepareRun(path);
  } finally {
    if (!prep) endRunPreparing("script"); // 预检取消/失败 → 释放闸门
  }
  if (!prep) return;
  if (scriptRunActive()) {
    endRunPreparing("script"); // 准备期间已有脚本运行启动（退出事件重入）→ 放弃
    return;
  }
  const startedAt = Date.now();
  const label = selection ? `运行 · 选区(${basename(selection.sourcePath)})` : `运行 · ${basename(path)}`;
  // 同槽复用：上次运行已退出（exited 驻留，tab 保留回看）→ 旧实例先移除再登记新实例
  const prev = findRunInstance("run-term-script");
  if (prev) removeRunInstance("run-term-script");
  // 实例先登记为 preparing（启动前确保 tab 存在由 termUi 承担，§7.1 不变式）
  addRunInstance({
    id: "run-term-script",
    kind: "script",
    label,
    phase: "preparing",
    startedAt,
    path,
    selection,
    exit: null,
    canceled: false,
    stopping: false,
  });
  endRunPreparing("script"); // 实例登记后由实例态接管守卫（内含 renderTabs）

  try {
    await runScriptInTerminal({
      path,
      echo: prep.echo,
      kind: "script",
      probe,
      onData: (text) => recordRunLines("run-term-script", text),
      onExit: (code) => settleExited("run-term-script", { kind: "code", code }),
    });
    // preparing 期 tab 被关闭：runScriptInTerminal 内 killIfCanceled 已补杀，
    // termUi 侧回调已解绑，此处实例同步移除（§7.4 竞态兜底的 runState 半边）
    if (!settleInstance("run-term-script", { label, path, selection, startedAt })) return;
    startRunRecord("run-term-script", { kind: "script", path, label, selection });
  } catch (e) {
    // preparing 期 tab 被关闭（canceled）→ 实例已移除，幂等收尾
    if (!findRunInstance("run-term-script")) return;
    appendOutputLine(outputEl, `在终端中运行失败: ${e}`, "stderr", gotoFromLink);
    removeRunInstance("run-term-script");
    h().renderTabs();
  }
}

/** 运行当前打开的 .py/.pyw 文件（§2：▶ 运行脚本 / Ctrl+F10 / gutter ▶ / 标签右键 / 命令面板）。
 *  无工作区 / 非 Python 文件的拦截在 UI 层（置灰），此处兜底再拦一次。 */
export async function runScript(path?: string): Promise<void> {
  const target = path ?? app.activeTab?.path;
  if (!target) return;
  if (!app.workspaceRoot) {
    appendOutputLine(outputEl, "运行脚本需先打开一个工作区", "stderr", gotoFromLink);
    return;
  }
  if (!target.endsWith(".py") && !target.endsWith(".pyw")) {
    appendOutputLine(outputEl, `不是 Python 文件：${target}`, "stderr", gotoFromLink);
    return;
  }
  await launchScript(target);
}

// ---------- 运行项目（§3：项目入口 = 模块名 | 入口脚本） ----------

/** 项目运行的回显行（与 prepareRun 同风格：来源前缀 + 命令 + cwd 说明） */
function projectEcho(p: RunConfig): string {
  const source = interpreterSource();
  const args = p.args?.trim() ? ` ${p.args.trim()}` : "";
  const cmd =
    p.entry.kind === "module"
      ? currentInterpreter
        ? `python -m ${p.entry.target}${args}`
        : `uv run python -m ${p.entry.target}${args}`
      : `${p.entry.target}${args}`;
  const cwd = p.cwd.trim() ? `  (cwd: ${p.cwd.trim()})` : "";
  return `> [${source}] ${cmd}${cwd}`;
}

/** 读取或探测项目配置；探测不到返回 null（调用方提示配置，§7.4 不静默失败） */
async function loadOrDetectProjectConfig(): Promise<RunConfig | null> {
  if (!app.workspaceRoot) return null;
  const stored = await invoke<Partial<RunConfig> | null>("get_project_run", { workspaceRoot: app.workspaceRoot })
    .then((raw) => (raw ? normalizeRunConfig(raw) : null))
    .catch(() => null);
  if (stored && stored.entry.target.trim()) return stored;
  // 首次运行：自动探测（命中即写入项目配置，用户可改）
  const detected = await invoke<{ source: string; summary: string; config: Partial<RunConfig> } | null>(
    "detect_project_entry",
    { workspaceRoot: app.workspaceRoot },
  ).catch(() => null);
  if (detected) {
    appendOutputLine(outputEl, `已自动配置项目入口：${detected.summary}`, "hint", gotoFromLink);
    return normalizeRunConfig(detected.config);
  }
  return null;
}

/** 项目运行落到统一运行控制台（「项目」主 tab 或「项目 N」并行实例，§6.3/§6.4）。
 *  preparing 期 tab 被关闭（runScriptInTerminal 抛错或返回后 killIfCanceled 已补杀）→
 *  实例移除收尾（§7.4：不留孤儿、不卡 preparing）。 */
async function launchProject(p: RunConfig, instanceId: string, label: string, startedAt: number): Promise<void> {
  const prev = findRunInstance(instanceId);
  if (prev) removeRunInstance(instanceId); // 同槽复用（重启路径）：旧实例（已 exited）先移除
  addRunInstance({
    id: instanceId,
    kind: "project",
    label,
    phase: "preparing",
    startedAt,
    path: null,
    selection: null,
    exit: null,
    canceled: false,
    stopping: false,
  });
  const echo = projectEcho(p);
  try {
    await runScriptInTerminal({
      path: p.entry.target,
      echo,
      kind: "project",
      instanceId,
      onData: (text) => recordRunLines(instanceId, text),
      onExit: (code) => settleExited(instanceId, { kind: "code", code }),
    });
    // preparing 期 tab 被关闭：runScriptInTerminal 内 killIfCanceled 已补杀，实例同步移除
    if (!settleInstance(instanceId, { label, path: null, selection: null, startedAt })) return;
    startRunRecord(instanceId, { kind: "project", path: `project:${p.entry.target}`, label, selection: null });
  } catch (e) {
    if (!findRunInstance(instanceId)) return; // preparing 期 tab 被关闭 → 幂等收尾
    appendOutputLine(outputEl, `运行项目失败: ${e}`, "stderr", gotoFromLink);
    removeRunInstance(instanceId);
    h().renderTabs();
  }
}

/** 运行项目（§3：▶ 运行项目 / Ctrl+Shift+F10 / 命令面板）。
 *  项目运行中再点 → 二选一对话框（§6.4）：停止并重跑（停**全部**项目实例）/
 *  新建实例（并行，「项目 N+1」tab，已有实例不动）；取消 = 安全退出。 */
export async function runProject(): Promise<void> {
  if (!app.workspaceRoot) return;
  if (isPreparing("project")) return; // 防双击（准备期内连点无效）
  // v3.4 §6.4：项目运行中再点「运行项目」= 二选一（裁决 9）；Esc / 取消安全退出
  let slot: "main" | "new" = "main";
  if (projectRunActive()) {
    const choice = await openChoice({
      title: "项目正在运行",
      message: "项目已有运行实例。要停止全部实例并重跑，还是新建一个并行实例？",
      okLabel: "停止并重跑",
      neutralLabel: "新建实例（并行）",
      kind: "primary",
    });
    if (choice === "cancel") return;
    if (choice === "ok") {
      await stopAllProjectInstances();
      slot = "main"; // 裁决 9：停全部后复用「项目」主 tab，项目回到单实例状态
    } else {
      slot = "new"; // 并行：多开「项目 N+1」，已有实例不动
    }
  }
  if (!beginRunPreparing("project")) return;
  let p: RunConfig | null = null;
  try {
    p = await loadOrDetectProjectConfig();
  } finally {
    if (!p) endRunPreparing("project");
  }
  if (!p) {
    appendOutputLine(outputEl, "项目未配置入口：请先在「运行配置 → 项目配置」中设置（模块名或入口脚本）", "stderr", gotoFromLink);
    return;
  }
  // 会话 id / tab 分配（§17-12）：复用「项目」主 tab 或新建「项目 N+1」
  const { instanceId, label } = allocateProjectSlot(slot);
  endRunPreparing("project");
  await launchProject(p, instanceId, label, Date.now());
}

/** 分配项目实例槽位：主 tab（run-term-project-1）或「项目 N+1」（并行，§6.4/§17-11）。
 *  会话 id 与 tab 由 termUi::runScriptInTerminal 统一管理，这里只决定「复用主 tab」还是
 *  「多开新实例」——重启路径固定主 tab；并行路径请求空闲序号。 */
function allocateProjectSlot(slot: "main" | "new"): { instanceId: string; label: string } {
  if (slot === "new") {
    const n = nextProjectSeq();
    return { instanceId: `run-term-project-${n}`, label: `项目 ${n}` };
  }
  return { instanceId: "run-term-project-1", label: "项目" };
}

/** 项目实例序号分配：从 2 起找**第一个空闲**序号（exited 驻留的槽也占用——tab 还在），
 *  全部释放后回到最小值（标签不无限增长）。 */
function nextProjectSeq(): number {
  let n = 2;
  while (findRunInstance(`run-term-project-${n}`)) n++;
  return n;
}

// ---------- P0-E：FastAPI 预设（写入项目配置 + 服务 URL 自动打开，§9/§16-4） ----------

/** P0-E：FastAPI 项目探测。每个工作区每会话最多提示一次；**项目配置已是 uvicorn 入口**则不打扰。
 *  探测与配置生成都只做「提示 + 用户点击」，绝不静默改配置/装包。 */
export async function maybeSuggestFastApi(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root || fastApiHintShownFor === root) return;
  fastApiHintShownFor = root;
  const hit = await invoke<{ file: string; module: string; app_var: string; has_uvicorn: boolean } | null>(
    "detect_fastapi",
    { workspaceRoot: root },
  ).catch(() => null);
  if (!hit) return;
  const projectRun = await invoke<Partial<RunConfig> | null>("get_project_run", { workspaceRoot: root })
    .catch(() => null);
  const hasUvicornEntry = (): boolean =>
    projectRun?.entry?.kind === "module" && projectRun.entry.target.trim().toLowerCase() === "uvicorn";
  if (hasUvicornEntry()) return;
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

/** P0-E：一键生成 FastAPI 预设（module=uvicorn, cwd=工作区根）并写入**项目配置**（v3.4 §9：
 *  预设命中即写入 project_run，用户可改）；写入后直接运行项目，服务 URL 由终端输出监听
 *  （Uvicorn running on http://…，15s 等待窗口）自动用系统浏览器打开（§9）。 */
async function createFastApiProfile(hit: { module: string; app_var: string }): Promise<void> {
  if (!app.workspaceRoot) return;
  const existing = await invoke<Partial<RunConfig> | null>("get_project_run", { workspaceRoot: app.workspaceRoot })
    .catch(() => null);
  if (!existing) {
    const profile: RunConfig = {
      ...EMPTY_RUN_CONFIG,
      entry: { kind: "module", target: "uvicorn" },
      args: `${hit.module}:${hit.app_var} --reload`,
      cwd: "${workspaceRoot}",
    };
    await invoke("set_project_run", { workspaceRoot: app.workspaceRoot, config: profile });
    appendOutputLine(outputEl, `已写入项目运行配置：uvicorn ${profile.args}`, "stdout", gotoFromLink);
    await runProject();
  }
}

// ---------- 选区运行（§16-5：临时文件 → 脚本运行路径，probe=false） ----------

/** 运行选区（无选区时运行光标所在行）：写入源文件同目录的临时文件后按脚本运行路径走控制台
 *  （v3.4 §16-5：临时文件 → 终端执行，probe=false 片段不采样，结束清理临时文件；
 *  不改变运行目标——选区实例随脚本实例走，临时文件清理由 settleExited 统一承担）。 */
export async function runSelection(): Promise<void> {
  if (!app.activeTab || (scriptRunActive() && !isPreparing("script"))) return;
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
  if (!beginRunPreparing("script")) return;
  try {
    if (app.activeTab.dirty) await h().saveActive(); // 运行前保存（与整文件运行一致）

    // 临时文件写到源文件同目录：保证 import 相对导入 / 相对路径资源与源文件一致。
    // CR-05：文件名带进程内随机后缀——并发运行选区 / 跨目录源文件互不覆盖；
    // 结束后由 settleExited → cleanupSelectionRunMeta 删除；watcher 侧按前缀忽略。
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

    if (scriptRunActive()) return; // 准备期间已有运行启动 → 放弃（闸门在 finally 释放）

    // 选区运行用临时文件、**刻意不套运行配置**（含 args / env）：语义上是一次性片段。
    const startedAt = Date.now();
    const label = `运行 · 选区(${basename(path)})`;
    const selMeta = { tempPath, sourcePath: path, startLine };
    // 同槽复用：上次运行已退出（exited 驻留）→ 旧实例先移除再登记新实例
    const prev = findRunInstance("run-term-script");
    if (prev) removeRunInstance("run-term-script");
    addRunInstance({
      id: "run-term-script",
      kind: "script",
      label,
      phase: "preparing",
      startedAt,
      path: tempPath,
      selection: selMeta,
      exit: null,
      canceled: false,
      stopping: false,
    });
    h().renderTabs();
    const rangeLabel = startLine === endLine ? `行 ${startLine}` : `行 ${startLine}-${endLine}`;
    const echo = `> 运行选区  ${path}:${rangeLabel}`;
    try {
      // probe=false：选区是临时代码，不采样（避免污染项目 trace 库）
      await runScriptInTerminal({
        path: tempPath,
        echo,
        kind: "script",
        probe: false,
        onData: (text) => recordRunLines("run-term-script", text),
        onExit: (code2) => settleExited("run-term-script", { kind: "code", code: code2 }),
      });
      // preparing 期 tab 被关闭：补杀已由 termUi 完成，实例同步移除（§7.4）
      if (!settleInstance("run-term-script", { label, path: tempPath, selection: selMeta, startedAt })) return;
      startRunRecord("run-term-script", { kind: "script", path: tempPath, label, selection: selMeta });
    } catch (e) {
      appendOutputLine(outputEl, `运行失败: ${e}`, "stderr", gotoFromLink);
      removeRunInstance("run-term-script");
      h().renderTabs();
    }
  } finally {
    // 无论是否进入运行态都释放闸门：成功路径实例态接管守卫，失败/放弃路径恢复可运行
    endRunPreparing("script");
  }
}

// ---------- 接线 ----------

/** 运行域 UI 接线（main 的 init 调用）。
 * v3.4 §17-3：输出面板钩子已无运行侧职责（转录器 / 输入行均删），
 * 保留空接线防 termUi 的 outputHooks 调用点空引用；
 * M3-3.2：注册运行 tab 关闭回调（§7.1 不变式的 runState 半边）。 */
export function wireRunFlow(): void {
  setOutputPanelHooks({
    onTabChange: () => {
      /* v3.4 §6.5：stdin 输入行已删，切标签无输入行可同步 */
    },
    onClear: () => {
      /* v3.4 §17-3：转录器已删，清空输出无未完结行状态需要丢弃 */
    },
  });
  setRunTabClosedHook((id) => {
    // 运行 tab 被关闭（closeTerminal 已先 term_kill）：实例移除 + 运行组重绘。
    // preparing 期：实例仍在档（spawn 在途）→ 移除 + 历史收尾（canceled），后续 spawn
    // 返回后由 killIfCanceled 补杀，runFlow 侧「settleInstance 返回 false」幂等收尾（§7.4）。
    // running 期：term_kill 即时生效，实例收口为 exited（历史在档记录 finish）。
    const inst = findRunInstance(id);
    if (inst) {
      if (inst.selection) cleanupSelectionRunMeta(inst.selection);
      finishRunRecord(id, null, inst.phase === "preparing" ? "canceled" : "stopped");
      removeRunInstance(id);
    }
    h().renderTabs();
  });
  setRunTabStopHook((id) => stopRunById(id));
  // §7.4 复查修复：spawn 前探针——实例已被 stopRunById（preparing 期）收口为 exited
  // 或被关闭 tab 私除时，放弃本次 spawn（堵「落地即孤儿」窗口；runState 是唯一真值）
  setRunAbortProbe((id) => {
    const inst = findRunInstance(id);
    return !inst || inst.phase === "exited";
  });
  // M3 验收测试钩子（Playwright + CDP 用；只读快照，不引入第二份真值）：
  // 返回运行实例列表 + 运行历史摘要。生产环境无消费者，保留在 wireRunFlow 便于
  // 与运行域同生命周期（工作区切换后实例表随之清空，快照永远反映当前态）。
  (window as unknown as { __ocProbe?: () => unknown }).__ocProbe = () => ({
    instances: listRunInstances().map((x) => ({ ...x })),
    history: runsSnapshot().map((r) => ({ ...r })),
  });
}

/** 调试事件接线（main 的 init 中 await）。v3.4 §13.3/§17-16：debuggee 输出走独立事件
 * debug-stdout / debug-stderr → 输出面板（运行角色的 run-* 事件已随 piped 路径下线，
 * 输出面板保留调试承载角色）。 */
export async function initRunEvents(): Promise<void> {
  await listen<{ data: string }>("debug-stdout", (e) => {
    for (const line of splitLines(e.payload.data)) {
      appendOutputLine(outputEl, line, "stdout", gotoFromLink);
    }
  });
  await listen<{ data: string }>("debug-stderr", (e) => {
    for (const line of splitLines(e.payload.data)) {
      appendOutputLine(outputEl, line, "stderr", gotoFromLink);
    }
  });
}

/** 按行拆分（调试输出按行转发；保留空行、末尾换行不产生空行） */
function splitLines(data: string): string[] {
  const segs = data.split("\n");
  if (segs.length > 0 && segs[segs.length - 1] === "") segs.pop();
  return segs;
}
