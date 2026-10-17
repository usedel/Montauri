// pytest 运行 / 结果接线（docs/pytest_dev_plan.md §3.5/§3.6/§3.8/§3.10）。
//
// 本模块是测试域的**编排层**：缓存与失效、scan→collect 两段式、runTestNode(s)、
// junitxml 结果读取与合入、安装引导触发。DOM 一律不碰（归 testView.ts），
// 树数据经 currentTestTree() 暴露、变化经 handlers 广播。
//
// 关键纪律：
// - **两段式**（§3.2）：scan 先行（无子进程、骨架首帧）→ collect 后台增强；
// - **单飞 + 令牌**：collect 在途拒绝二次 spawn（后端亦有 COLLECT_BUSY）；扫描/收集
//   结果带令牌，切工作区 / 连续刷新的旧结果不得回填（CR-07 同款）；
// - **失效**（§3.8）：dep-fs-changed（.py / 声明文件）→ 立即 stale chip → 1s 防抖合并
//   → 视图可见则自动重收、不可见留手动；切工作区取消在途 collect（不留孤儿 python）；
// - **结果合入不重建 DOM**（§3.10）：applyResults 就地改树，视图只切行 class。

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { app, outputEl } from "./state";
import { t } from "./i18n";
import { toast } from "./toast";
import { basename, errMsg } from "./util";
import { appendOutputLine } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { localizeBackendError } from "./i18n/backendError";
import {
  beginRunPreparing, endRunPreparing, prepareRun, settleExited, settleInstance,
} from "./runFlow";
import { runScriptInTerminal } from "./termUi";
import { addRunInstance, findRunInstance, removeRunInstance, testRunActive } from "./runState";
import {
  applyResults, buildTestTree, collectFailedIds, splitNodeId,
  type TestCaseResult, type TestGroupNode,
} from "./testTreeCore";
import { activeView } from "./views";
import { fixCommandPreview, latestDiff, runDepFix, type DepFixAction, type DepFixPlan } from "./depHealth";

// ---------- 常量与类型 ----------

/** 测试运行实例 id（单例；与脚本 / 项目实例各自独立，§3.5） */
export const TEST_INSTANCE_ID = "run-term-test";

/** 视图状态机：idle → scanning → collecting → idle；error / missing 为终态（可重试）。 */
export type TestPhase = "idle" | "scanning" | "collecting" | "error" | "missing";

export interface TestViewState {
  phase: TestPhase;
  /** 缓存已失效（.py / 声明文件变更）待重收 */
  stale: boolean;
  /** collect 失败时的输出尾部（原文展示，§3.2） */
  errorTail: string;
  /** pytest 缺失信号（三态之一，§3.9 防线 ③） */
  missingModule: string | null;
}

export interface TestRunHandlers {
  /** 树 / 状态变化（骨架落地 / collect 完成 / stale / 错误 / missing）→ 视图整树重渲染 */
  onChanged: () => void;
  /** 结果合入后 → 视图只切行 class 与计数文本（不重建 DOM） */
  onResults: (cases: TestCaseResult[]) => void;
}

interface TestCache {
  files: string[];
  nodes: string[];
  tree: TestGroupNode[];
  collectedAt: number;
  stale: boolean;
}

// ---------- 状态 ----------

let handlers: TestRunHandlers | null = null;
/** 按工作区根的缓存（scan 的 files 与 collect 的 nodes 共用一份记录，§3.8） */
const caches = new Map<string, TestCache>();
/** 最近一次结果（重建树后重放，保留状态，§3.10） */
let lastCases: TestCaseResult[] = [];
/** scan / collect 合并令牌：旧结果不得覆盖新结果（切工作区 / 连续刷新） */
let refreshToken = 0;
/** collect 是否在途（视图置灰 / 取消按钮用；后端单飞之外的前端闸门） */
let collecting = false;
/** 整轮在途（scan + collect）：连点闸门，见 refreshTests 头注释（§3.10 单飞） */
let refreshing = false;
/** 失效防抖定时器（1s 合并多次变更，§3.8） */
let invalidateTimer: number | null = null;
let phase: TestPhase = "idle";
let errorTail = "";
let missingModule: string | null = null;

export function setTestRunHandlers(h: TestRunHandlers): void {
  handlers = h;
}

function notify(): void {
  handlers?.onChanged();
}

/** 当前视图状态（testView 头部芯片 / 三态渲染用）。 */
export function testViewState(): TestViewState {
  return { phase, stale: isStale(), errorTail, missingModule };
}

function isStale(): boolean {
  const root = app.workspaceRoot;
  if (!root) return false;
  return caches.get(root)?.stale ?? false;
}

/** 当前工作区的测试树（骨架或 collect 增强后；无缓存 = 空）。 */
export function currentTestTree(): TestGroupNode[] {
  const root = app.workspaceRoot;
  if (!root) return [];
  return caches.get(root)?.tree ?? [];
}

// ---------- scan → collect 两段式 ----------

/**
 * 打开视图 / 刷新按钮 / 失效自动重收的统一入口（§3.2/§3.8）：
 * ① 有新鲜缓存且不 stale → 直接渲染（不 spawn）；
 * ② scan（无子进程）→ 文件骨架先行渲染（首帧，§3.10）；
 * ③ collect 后台增强 → 全量重建（保留展开态由视图负责）→ 结果重放。
 */
/**
 * 刷新外壳：**整轮单飞闸门**（§3.10）。`collecting` 只在 collect invoke 期间为真，
 * **scan 窗口（首帧之前）是敞开的**——连点会各自穿过闸门各发一轮（实测连点 3 次 = 3 次
 * collect）。闸门罩住 scan+collect 整轮，finally 释放（早退路径不得永久卡死）。
 */
export async function refreshTests(force = false): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    await refreshTestsOnce(force);
  } finally {
    refreshing = false;
  }
}

async function refreshTestsOnce(force: boolean): Promise<void> {
  const root = app.workspaceRoot;
  if (!root) {
    caches.clear();
    phase = "idle";
    notify();
    return;
  }
  if (collecting) return; // 冗余但无害：collect 单独在途（取消后重收窗口）
  const cached = caches.get(root);
  if (!force && cached && !cached.stale) {
    phase = "idle";
    notify();
    return;
  }
  const token = ++refreshToken;
  phase = "scanning";
  notify();
  let files: string[];
  try {
    // 后端契约：scan 返回 `{ files: [...] }`（pytest_cmds::scan_impl；mock 同形）
    const scanned = await invoke<{ files: string[] }>("pytest_action", { action: "scan", workspaceRoot: root });
    files = Array.isArray(scanned?.files) ? scanned.files : [];
  } catch (e) {
    if (token !== refreshToken) return;
    phase = "error";
    errorTail = localizeBackendError(errMsg(e));
    notify();
    return;
  }
  if (token !== refreshToken) return; // 已有更新一轮（切工作区 / 连续刷新）
  // 骨架先行（§3.10 首帧）：不依赖 collect，大仓遍历亦仅百毫秒级
  const skeleton = buildTestTree(files);
  putCache(root, { files, nodes: cached?.nodes ?? [], tree: skeleton, collectedAt: cached?.collectedAt ?? 0, stale: false });
  applyCasesToCurrentTree();
  phase = "collecting";
  collecting = true;
  notify();

  let res: CollectResult;
  try {
    res = await invoke<CollectResult>("pytest_action", { action: "collect", workspaceRoot: root });
  } catch (e) {
    // 后端单飞拒绝（取消后立刻重发的窄窗口：旧 invoke 尚未注销注册表）：
    // 回落 idle 并保留 stale chip，用户再点一次刷新即可（不弹错误、不卡「收集中」态）。
    // collecting 统一在 finally 释放（含令牌已过期路径——否则前端闸门永久卡死）。
    if (token !== refreshToken) return;
    if (errMsg(e).includes("收集正在进行中")) {
      phase = "idle";
      const c = caches.get(root);
      if (c) c.stale = true;
      notify();
      return;
    }
    phase = "error";
    errorTail = localizeBackendError(errMsg(e));
    notify();
    return;
  } finally {
    collecting = false;
  }
  if (token !== refreshToken) return;
  if (res.cancelled) {
    phase = "idle"; // 用户取消：静默复位（不弹错误，§3.10）
    notify();
    return;
  }
  if (res.missing_module) {
    missingModule = res.missing_module;
    phase = "missing";
    notify();
    return;
  }
  if (!res.ok) {
    missingModule = null;
    errorTail = res.error_tail || t("test.collectError");
    phase = "error";
    notify();
    return;
  }
  // collect 落地（全量重建 + 保留展开态 + 结果重放）。**stale 透传**（复核 P1）：
  // 在途期间发生过失效时结果树不含新用例，不得洗成新鲜——保留 stale 并补排重收。
  const wasStale = caches.get(root)?.stale ?? false;
  const tree = buildTestTree(files, res.nodes);
  putCache(root, { files, nodes: res.nodes, tree, collectedAt: Date.now(), stale: wasStale });
  missingModule = null;
  errorTail = "";
  phase = "idle";
  applyCasesToCurrentTree();
  notify();
  handlers?.onResults(lastCases);
  if (wasStale) {
    // 1s 防抖重收（与失效编排同一节奏）；refreshing 已释放，闸门自然放行
    if (invalidateTimer !== null) window.clearTimeout(invalidateTimer);
    invalidateTimer = window.setTimeout(() => {
      invalidateTimer = null;
      if (activeView() === "tests") void refreshTests();
    }, 1000);
  }
}

interface CollectResult {
  ok: boolean;
  cancelled: boolean;
  nodes: string[];
  missing_module: string | null;
  error_tail: string;
  duration_ms: number;
}

function putCache(root: string, c: TestCache): void {
  caches.set(root, c);
}

/** 把最近一次结果合入当前树（重建后重放 / 骨架阶段无结果时无操作）。 */
function applyCasesToCurrentTree(): void {
  const tree = currentTestTree();
  if (tree.length === 0 || lastCases.length === 0) return;
  applyResults(tree, lastCases);
}

/** 取消进行中的 collect（视图取消按钮；后端杀进程树，§3.10）。 */
export async function cancelCollect(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root || !collecting) return;
  try {
    await invoke("pytest_action", { action: "cancel", workspaceRoot: root });
  } catch {
    /* 取消失败不阻断：后端超时（60s）同路杀树 */
  }
}

/**
 * 强制刷新（视图刷新按钮）：`force=true` 跳过「未失效即短路」；在途期间直接返回
 * （§3.10「连点 collect 不双 spawn」；收集中按钮已置灰）。修订：初版是「取消在途 →
 * 600ms → 重收」，实测连点三次真的发三次 collect（每次先杀掉上一次）——既破单飞闸门，
 * 也让「取消」与「重收」挤在一个按钮上；取消有独立入口（#test-cancel / 后端 60s 超时）。
 */
export async function refreshTestsManual(): Promise<void> {
  if (collecting) return;
  await refreshTests(true);
}

// ---------- 失效（§3.8） ----------

/**
 * dep-fs-changed 订阅入口（main 的 wireTestRun 调一次）：
 * .py / 声明文件变更 → 立即 stale chip → 1s 防抖合并 → 视图可见则自动重收。
 * 粗粒度整树失效（正确但不过度精细）：conftest.py 是 .py 天然覆盖。
 */
export function handleTestInvalidation(): void {
  const root = app.workspaceRoot;
  if (!root) return;
  const c = caches.get(root);
  if (c) c.stale = true;
  notify(); // 用户立刻知道树旧了（chip 即时，重收防抖）
  if (invalidateTimer !== null) window.clearTimeout(invalidateTimer);
  invalidateTimer = window.setTimeout(() => {
    invalidateTimer = null;
    if (activeView() === "tests") void refreshTests();
  }, 1000);
}

/** 工作区切换 / 关闭：取消在途 collect（不留孤儿 python）+ 清缓存与令牌。
 *  **同步函数**（复核 P1）：状态复位必须在任何 await 之前完成——先 await cancel 再
 *  清缓存，切换窗口内新工作区的缓存会被全表误清。cancel 降级 fire-and-forget。 */
export function resetTests(): void {
  refreshToken++;
  if (invalidateTimer !== null) {
    window.clearTimeout(invalidateTimer);
    invalidateTimer = null;
  }
  const root = app.workspaceRoot;
  if (root && collecting) {
    void invoke("pytest_action", { action: "cancel", workspaceRoot: root }).catch(() => {
      /* 取消失败由后端退出钩子兜底杀树 */
    });
  }
  collecting = false;
  caches.clear();
  lastCases = [];
  phase = "idle";
  errorTail = "";
  missingModule = null;
  notify();
}

// ---------- 运行测试（§3.5） ----------

/** node id → 测试文件绝对路径（预检按文件查缺失 import，与跑脚本同口径）。 */
function nodeFileAbs(nodeId: string): string {
  const root = app.workspaceRoot ?? "";
  const rel = splitNodeId(nodeId).file;
  return rel ? `${root.replace(/\\/g, "/").replace(/\/$/, "")}/${rel}` : root;
}

/**
 * 运行一个或多个测试节点（树行 ▶ / 绿箭头 / gutter 菜单 / 重跑失败共用）。
 * - 单例实例 run-term-test（独立「测试」tab；与脚本 / 项目互不排斥）；
 * - 预检继承 prepareRun（测试文件顶 import pytest 缺失 → 用户已熟悉的确认框）；
 * - kind="test"：后端合成 module=pytest + junit-xml（后端内部契约，§3.6）。
 */
export async function runTestNodes(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!app.workspaceRoot) {
    toast(t("test.needWorkspace"), "info");
    return;
  }
  if (collecting) return;
  if (testRunActive()) {
    toast(t("test.runBusy"), "info");
    return;
  }
  if (!beginRunPreparing("test")) return; // CR-07 同步闸门（防连点）
  let prepped = false;
  try {
    // 预检继承（§3.5）：多 node 同文件时只检一次；保存脏 tab 由 prepareRun 承担
    const prep = await prepareRun(nodeFileAbs(ids[0] as string));
    prepped = !!prep;
  } finally {
    if (!prepped) endRunPreparing("test");
  }
  if (!prepped) return;
  await launchTest(ids);
}

async function launchTest(ids: string[]): Promise<void> {
  const startedAt = Date.now();
  const label = t("test.tabLabel", { node: basename(ids[0] as string) });
  const prev = findRunInstance(TEST_INSTANCE_ID);
  if (prev) removeRunInstance(TEST_INSTANCE_ID); // 同槽复用（上次已 exited）
  addRunInstance({
    id: TEST_INSTANCE_ID,
    kind: "test",
    label,
    phase: "preparing",
    startedAt,
    path: null,
    selection: null,
    exit: null,
    canceled: false,
    stopping: false,
  });
  endRunPreparing("test"); // 实例登记后由实例态接管守卫
  try {
    await runScriptInTerminal({
      // node id 换行拼接（后端按 \n 拆多个 node id，terminal.rs kind="test" 契约）
      path: ids.join("\n"),
      echo: t("test.runEcho", { nodes: ids.join(" ") }),
      kind: "test",
      instanceId: TEST_INSTANCE_ID,
      onExit: (code) => void onTestExited(code),
    });
    if (!settleInstance(TEST_INSTANCE_ID, { label, path: null, selection: null, startedAt })) return;
  } catch (e) {
    if (!findRunInstance(TEST_INSTANCE_ID)) return; // preparing 期 tab 被关闭 → 幂等
    appendOutputLine(outputEl, t("test.runFailed", { error: localizeBackendError(errMsg(e)) }), "stderr", gotoFromLink);
    removeRunInstance(TEST_INSTANCE_ID);
  }
}

/** 测试进程退出：收口实例态 → 读 junitxml → 合入树（§3.6）。 */
async function onTestExited(code: number): Promise<void> {
  settleExited(TEST_INSTANCE_ID, { kind: "code", code });
  const root = app.workspaceRoot;
  if (!root) return;
  let res: { found: boolean; cases: TestCaseResult[] };
  try {
    res = await invoke<{ found: boolean; cases: TestCaseResult[] }>("pytest_action", {
      action: "result",
      workspaceRoot: root,
      sessionId: TEST_INSTANCE_ID,
    });
  } catch {
    toast(t("test.resultMissing"), "info"); // 解析失败：轻提示，不报错刷屏
    return;
  }
  if (!res.found) {
    // 进程被 kill（无 xml）：状态留 unknown + toast 说明（§3.6）
    toast(t("test.resultMissing"), "info");
    return;
  }
  lastCases = res.cases;
  applyCasesToCurrentTree();
  handlers?.onResults(res.cases);
}

/** 「重跑失败」：一次调用传多个 node id（junitxml 自然覆盖全部，§3.5）。 */
export async function rerunFailed(): Promise<void> {
  if (testRunActive()) {
    toast(t("test.runBusy"), "info");
    return;
  }
  const ids = collectFailedIds(currentTestTree());
  if (ids.length === 0) {
    toast(t("test.rerunNone"), "info");
    return;
  }
  await runTestNodes(ids);
}

// ---------- pytest 安装引导（§3.9） ----------

/**
 * pytest 缺失时的安装入口：命令编排委托 depHealth——E2（已声明未装）→ sync；
 * 否则 install（dep_fix 后端按 style 分支：pyproject → uv add --dev；bare/requirements
 * → uv pip install --python）。测试视图只触发与展示，不自己算执行命令。
 */
export async function installPytestForTests(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root) return;
  const diff = latestDiff();
  const declared = diff?.declaredMissing.some((m) => m.dist === "pytest") ?? false;
  const action: DepFixAction = declared ? "sync" : "install";
  const dists = action === "install" ? ["pytest"] : [];
  const command = diff
    ? fixCommandPreview(diff, action, dists)
    : action === "install"
      ? "uv pip install pytest"
      : "uv sync";
  const plan: DepFixPlan = { action, dists, command };
  await runDepFix([plan], t("test.installTitle"));
}

// ---------- 接线 ----------

/** main 的 init 调用：注入视图 handlers + 订阅失效事件。 */
export function wireTestRun(): void {
  // handlers 由 testView.initTestView 注入（setTestRunHandlers）；
  // dep-fs-changed 订阅放这里（与 dep 域各自 listen 同一事件，互不干扰）
  void getCurrentWindow()
    .listen<Array<{ kind: string }>>("dep-fs-changed", () => handleTestInvalidation())
    .catch(() => undefined);
}
