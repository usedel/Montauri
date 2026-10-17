// 侧栏测试视图（第 9 个视图，docs/pytest_dev_plan.md §3.3/§3.10）。
//
// DOM 全在本模块；数据与编排归 testRun.ts（currentTestTree / testViewState /
// runTestNodes / refreshTestsManual / cancelCollect / rerunFailed / installPytestForTests）。
//
// §3.10「耗时操作不卡死」落地：
// - 首帧来自 scan 骨架（不依赖 collect，文件级折叠）；
// - 展开文件时子节点**分帧续渲染**（>300 行/帧走 rAF，测试环境回落 setTimeout，
//   logView MAX_ROWS_PER_FRAME 同款）；
// - collect 落地整树重建但**保留展开态**（expanded Map）与**行元素 Map**
//   （applyResults 后只切 class 与计数文本，不重建 DOM）；
// - 跑完失败**自动展开有失败的文件**（节点数被结果收敛）；
// - collect 进行中：头部显示取消按钮 + 刷新置灰（防连点）。

import { invoke } from "@tauri-apps/api/core";
import { app, $ } from "./state";
import { codicon, emptyState } from "./util";
import { t, onLocaleChange } from "./i18n";
import { showMenu } from "./menu";
import { buildTestMenuItems } from "./menuItems";
import {
  cancelCollect, currentTestTree, installPytestForTests, refreshTests, refreshTestsManual,
  rerunFailed, runTestNodes, setTestRunHandlers, testViewState,
} from "./testRun";
import {
  countCases, scanTestDefs,
  type TestCaseResult, type TestDef, type TestGroupNode, type TestTreeNode,
} from "./testTreeCore";

// ---------- handlers 注入（main 私有动作，同 hotspotsView 先例） ----------

export interface TestViewHandlers {
  /** 打开文件并定位（main 的 openFile；行号由本模块懒解析补齐） */
  openFile: (path: string, revealLine?: number) => void;
}

let handlers: TestViewHandlers | null = null;

export function setTestViewHandlers(h: TestViewHandlers): void {
  handlers = h;
}

// ---------- 视图状态（本模块私有） ----------

/** 各文件展开态（collect 重建 / 结果合入后保留，§3.10） */
const expanded = new Map<string, boolean>();
/** node id → 行元素（结果合入只切 class，不重建 DOM，§3.10） */
const rowEls = new Map<string, HTMLElement>();
/** 文件内容扫描缓存（relPath → defs；点击跳转懒解析行号，避免重复 read_file） */
const defsCache = new Map<string, TestDef[]>();
/** 分帧渲染取消令牌（重建 / 折叠时作废在途帧） */
let renderToken = 0;
/** i18n 订阅取消函数（initTestView 随 onShow 重复触发，先取消旧订阅防累积） */
let unsubLocale: (() => void) | null = null;

/** 单帧最多渲染的行数（>300 行/帧分帧，logView 同款口径） */
const MAX_ROWS_PER_FRAME = 300;

/** 初始化视图 DOM（main init 调一次；#view-tests 容器已在 index.html 声明）。 */
export function initTestView(): void {
  setTestRunHandlers({
    onChanged: () => renderTests(),
    onResults: (cases) => applyResultsToRows(cases),
  });
  const root = $("view-tests");
  root.textContent = "";

  const toolbar = document.createElement("div");
  toolbar.className = "test-toolbar";
  const title = document.createElement("span");
  title.className = "test-title";
  title.textContent = t("test.title");
  const stale = document.createElement("span");
  stale.id = "test-stale";
  stale.className = "test-stale hidden";
  stale.textContent = t("test.stale");
  stale.dataset.tip = t("test.staleTip");
  stale.title = t("test.staleTip");
  const count = document.createElement("span");
  count.id = "test-count";
  count.className = "test-count";
  const rerun = document.createElement("button");
  rerun.id = "test-rerun";
  rerun.className = "btn btn--ghost btn--mini";
  rerun.textContent = t("test.rerunFailed");
  rerun.dataset.tip = t("test.rerunFailedTip");
  rerun.title = t("test.rerunFailedTip");
  rerun.addEventListener("click", () => void rerunFailed());
  const cancel = document.createElement("button");
  cancel.id = "test-cancel";
  cancel.className = "btn btn--ghost btn--mini hidden";
  cancel.textContent = t("test.cancel");
  cancel.addEventListener("click", () => void cancelCollect());
  const refresh = document.createElement("button");
  refresh.id = "test-refresh";
  refresh.className = "btn btn--ghost btn--icon";
  refresh.dataset.tip = t("test.refreshTip");
  refresh.setAttribute("aria-label", t("test.refresh"));
  refresh.appendChild(codicon("refresh"));
  refresh.addEventListener("click", () => void refreshTestsManual());
  toolbar.append(title, stale, count, rerun, cancel, refresh);

  const content = document.createElement("div");
  content.id = "test-content";
  content.className = "test-content";

  root.append(toolbar, content);
  // 语言切换 → 整树重取词。initTestView 随 onShow 重复触发，先取消旧订阅再注册
  //（复核 P2：不取消会无限累积，切一次语言 renderTests 执行 N 次）
  unsubLocale?.();
  unsubLocale = onLocaleChange(() => renderTests());
  renderTests();
}

/** 视图 DOM 复位（不清缓存——缓存按工作区键隔离，由 testRun.resetTests 管）。 */
export function resetTestView(): void {
  expanded.clear();
  rowEls.clear();
  defsCache.clear();
  renderToken++;
  if (!document.getElementById("test-content")) return; // 视图从未打开过：只清状态
  renderTests();
}

// ---------- 渲染 ----------

function renderTests(): void {
  const content = $("test-content");
  const st = testViewState();
  const tree = currentTestTree();
  syncToolbar(st, tree);
  const token = ++renderToken;
  content.textContent = "";

  if (!app.workspaceRoot) {
    content.appendChild(emptyState("beaker", t("test.noWorkspace"), t("test.noWorkspaceHint"), true));
    return;
  }
  if (st.phase === "scanning") {
    content.appendChild(emptyState("loading", t("test.collecting"), t("test.collectHint"), true));
    return;
  }
  if (st.phase === "missing") {
    content.appendChild(missingState());
    return;
  }
  if (st.phase === "error") {
    content.appendChild(errorState(st.errorTail));
    return;
  }
  if (tree.length === 0) {
    content.appendChild(emptyState("beaker", t("test.empty"), t("test.emptyHint"), true));
    return;
  }
  rowEls.clear();
  renderNodesFrame(content, visibleNodes(tree), token);
}

/** 按展开态拍平可见节点（真机 pytest-real 抓出的存量 bug：renderTests 全量重建时
 *  只渲染顶层行，已展开分组的子行不重渲染——且 expanded map 仍记为已展开，用户
 *  下一次点击会先「折叠」一次才展开，状态机错位。修法：渲染前按 map 拍平，
 *  buildRow 的 twisty 态与 map 天然一致；toggleExpand 的增删路径不变。 */
function visibleNodes(tree: TestGroupNode[]): TestTreeNode[] {
  const out: TestTreeNode[] = [];
  const walk = (n: TestTreeNode): void => {
    out.push(n);
    if (n.kind !== "case" && (expanded.get(n.id) ?? false)) {
      for (const c of (n as TestGroupNode).children) walk(c);
    }
  };
  for (const n of tree) walk(n);
  return out;
}

/** 头部工具条同步（stale chip / 计数 / 重跑失败可用性 / 收集中取消）。 */
function syncToolbar(st: ReturnType<typeof testViewState>, tree: TestGroupNode[]): void {
  const stale = $("test-stale");
  const count = $("test-count");
  const rerun = $("test-rerun") as HTMLButtonElement;
  const cancel = $("test-cancel");
  const refresh = $("test-refresh") as HTMLButtonElement;
  stale.classList.toggle("hidden", !st.stale);
  const total = countCases(tree);
  const failed = tree.reduce((n, f) => n + f.failedCount, 0);
  count.textContent =
    total > 0
      ? `${t("test.casesCount", { count: total })}${failed > 0 ? `　·　${t("test.failedCount", { count: failed })}` : ""}`
      : "";
  rerun.disabled = failed === 0;
  rerun.title = failed === 0 ? t("test.rerunNone") : t("test.rerunFailedTip");
  const busy = st.phase === "collecting" || st.phase === "scanning";
  cancel.classList.toggle("hidden", !busy);
  refresh.disabled = busy;
}

/** pytest 未安装三态（§3.9 防线 ③：安装引导，命令编排委托 depHealth）。 */
function missingState(): HTMLElement {
  const box = emptyState("error", t("test.pytestMissing"), t("test.pytestMissingHint"), true);
  const btn = document.createElement("button");
  btn.className = "btn btn--primary btn--mini";
  btn.textContent = t("test.installPytest");
  btn.addEventListener("click", () => void installPytestForTests());
  box.appendChild(btn);
  return box;
}

/** 收集错误三态：原文（尾部 40 行）+ 重试按钮（§3.2 防静默空树）。 */
function errorState(tail: string): HTMLElement {
  const box = emptyState("error", t("test.collectError"), undefined, true);
  const hint = document.createElement("div");
  hint.className = "test-error-hint";
  hint.textContent = t("test.collectErrorHint");
  const pre = document.createElement("pre");
  pre.className = "test-error-tail";
  pre.textContent = tail;
  const retry = document.createElement("button");
  retry.className = "btn btn--ghost btn--mini";
  retry.textContent = t("test.retry");
  retry.addEventListener("click", () => void refreshTests(true));
  box.append(hint, pre, retry);
  return box;
}

// ---------- 分帧渲染 ----------

/** 把一批节点分帧渲染进容器（>MAX_ROWS_PER_FRAME 走 rAF；测试环境回落 setTimeout）。 */
function renderNodesFrame(container: HTMLElement, nodes: TestTreeNode[], token: number): void {
  const frames = chunkFrames(nodes.length);
  let idx = 0;
  const step = (): void => {
    if (token !== renderToken) return; // 重建 / 切走：作废在途帧
    const take = frames[idx] as number;
    for (let i = 0; i < take; i++) {
      container.appendChild(buildRow(nodes[idx + i] as TestTreeNode));
    }
    idx++;
    if (idx < frames.length) scheduleFrame(step);
  };
  step();
}

/** 行数 → 每帧行数计划（testTreeCore.chunkPlan 同口径）。 */
function chunkFrames(total: number): number[] {
  if (total <= MAX_ROWS_PER_FRAME) return [total];
  const frames: number[] = [];
  let left = total;
  while (left > 0) {
    const take = Math.min(MAX_ROWS_PER_FRAME, left);
    frames.push(take);
    left -= take;
  }
  return frames;
}

/** 分帧调度（rAF 优先；无 rAF 环境（vitest）回落 setTimeout）。 */
function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn);
  else setTimeout(fn, 0);
}

// ---------- 树行 ----------

/** 状态 → codicon 名（check / error / circle-slash / 加载占位）。 */
function statusIcon(status: string): string {
  switch (status) {
    case "passed":
      return "check";
    case "failed":
    case "error":
      return "error";
    case "skipped":
      return "circle-slash";
    default:
      return "circle-outline";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "passed":
      return t("test.statusPassed");
    case "failed":
      return t("test.statusFailed");
    case "error":
      return t("test.statusError");
    case "skipped":
      return t("test.statusSkipped");
    default:
      return t("test.statusUnknown");
  }
}

function buildRow(node: TestTreeNode): HTMLElement {
  const row = document.createElement("div");
  const isFile = node.kind === "file";
  const isClass = node.kind === "class";
  row.className = `test-row test-row--${node.kind}`;
  row.dataset.node = node.id;
  rowEls.set(node.id, row);
  row.classList.add(node.status === "unknown" ? "is-unknown" : `is-${node.status}`);

  // 展开 twisty（文件 / 类行；骨架阶段子节点后到，twisty 仍显示）
  const twisty = document.createElement("span");
  twisty.className = "test-twisty";
  if (isFile || isClass) {
    const isExpanded = expanded.get(node.id) ?? false;
    twisty.appendChild(codicon(isExpanded ? "chevron-down" : "chevron-right"));
    twisty.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggleExpand(node as TestGroupNode);
    });
  } else {
    twisty.appendChild(codicon("blank"));
  }
  row.appendChild(twisty);

  // 状态图标
  const icon = document.createElement("span");
  icon.className = "test-icon";
  icon.appendChild(codicon(statusIcon(node.status)));
  const label = statusLabel(node.status);
  icon.dataset.tip = label;
  icon.title = label;
  row.appendChild(icon);

  // 名称（失败消息挂 tooltip）
  const name = document.createElement("span");
  name.className = "test-name";
  name.textContent = node.name;
  if (node.message) {
    name.dataset.tip = node.message;
    name.title = node.message;
  }
  row.appendChild(name);

  // 尾部信息：文件 / 类 = 失败计数；用例 = 耗时
  const meta = document.createElement("span");
  meta.className = "test-meta";
  const parts: string[] = [];
  if (isFile || isClass) {
    if (node.failedCount > 0) parts.push(t("test.failedCount", { count: node.failedCount }));
  } else if (node.durationMs != null) {
    parts.push(t("test.duration", { ms: node.durationMs }));
  }
  meta.textContent = parts.join("　");
  row.appendChild(meta);

  // hover ▶（运行该节点）
  const run = document.createElement("span");
  run.className = "test-run";
  run.appendChild(codicon("play"));
  run.dataset.tip = t("test.runAria");
  run.title = t("test.runAria");
  run.addEventListener("click", (ev) => {
    ev.stopPropagation();
    void runTestNodes([node.id]);
  });
  row.appendChild(run);

  // 主点击：类 → 展开；文件 / 用例 → 打开并定位 def 行
  row.addEventListener("click", () => {
    if (isClass) {
      toggleExpand(node as TestGroupNode);
      return;
    }
    void jumpToNode(node);
  });
  // 右键菜单（与 gutter 菜单同源数据，menuItems.ts）
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    showMenu(buildTestMenuItems(node.id, node.name), { x: ev.clientX, y: ev.clientY });
  });
  return row;
}

/** 展开 / 折叠（保留态）。**唯一渲染路径**：只改 map 后走 renderTests 全量重建——
 *  复核发现的三个 P1（renderChildrenAfter 的局部 token 作废全量分帧致大树截断、
 *  折叠不辨在途分帧把已折叠行整批插回成幽灵行、折叠不级联清 expanded 致孙行缺失）
 *  全部源于「增量渲染与全量分帧双路径并存」，此处收敛为单路径后互斥性由 renderToken
 *  单一所有者（renderTests）保证。 */
function toggleExpand(node: TestGroupNode): void {
  expanded.set(node.id, !(expanded.get(node.id) ?? false));
  renderTests();
}

/** 点击行 → 打开文件定位（行号懒解析：collect 输出不含行号，静态扫描兜底）。 */
async function jumpToNode(node: TestTreeNode): Promise<void> {
  const root = app.workspaceRoot;
  if (!root) return;
  const abs = fileAbs(root, node.file);
  let line = node.line;
  if (line == null) line = await resolveDefLine(node);
  handlers?.openFile(abs, line ?? 1);
}

/** 工作区根 + relPath → 绝对路径（正斜杠归一）。 */
function fileAbs(root: string, rel: string): string {
  return `${root.replace(/\\/g, "/").replace(/\/$/, "")}/${rel}`;
}

/** 懒解析 def 行：read_file + scanTestDefs（按类路径 + 函数名匹配；扫不中回落行 1）。 */
async function resolveDefLine(node: TestTreeNode): Promise<number | null> {
  const root = app.workspaceRoot;
  if (!root) return null;
  let defs = defsCache.get(node.file);
  if (!defs) {
    try {
      const text = await invoke<string>("read_file", { path: fileAbs(root, node.file) });
      defs = scanTestDefs(text);
    } catch {
      defs = [];
    }
    defsCache.set(node.file, defs);
  }
  if (node.kind === "file") return defs[0]?.line ?? null;
  const { classPath, name } = splitId(node.id);
  if (node.kind === "class") {
    // 类组行：按「类路径 = 既有 classPath + 类名」匹配该类下首个 def（def 名恒 test_*，
    // 用类名匹配 d.name 永远落空 → 恒跳行 1——复核 P2 实锤）
    const clsPath = [...classPath, name].join("::");
    const hit = defs.find((d) => d.classPath.join("::") === clsPath);
    return hit?.line ?? null;
  }
  const hit = defs.find((d) => d.name === name && d.classPath.join("::") === classPath.join("::"));
  return hit?.line ?? null;
}

/** 行 id（node id / 类组 id）→ { classPath, name }（类组 id 末段即类名，取该类首个 def 行）。 */
function splitId(id: string): { classPath: string[]; name: string } {
  const parts = id.split("::");
  const name = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const classPath = parts.slice(1, Math.max(1, parts.length - 1));
  return { classPath, name };
}

// ---------- 结果合入（只切 class，不重建 DOM，§3.10） ----------

/** testRun 合入结果后回调：按行元素 Map 切状态 class / 图标 / 汇总文本，
 *  并自动展开有失败的文件（节点数被结果收敛，不会抽爆界面）。 */
function applyResultsToRows(_cases: TestCaseResult[]): void {
  const tree = currentTestTree();
  const walk = (nodes: TestTreeNode[]): void => {
    for (const n of nodes) {
      const row = rowEls.get(n.id);
      if (row) {
        row.classList.remove("is-unknown", "is-passed", "is-failed", "is-error", "is-skipped");
        row.classList.add(n.status === "unknown" ? "is-unknown" : `is-${n.status}`);
        const iconWrap = row.querySelector<HTMLElement>(".test-icon");
        const icon = iconWrap?.querySelector(".codicon");
        if (icon) icon.className = `codicon codicon-${statusIcon(n.status)}`;
        const label = statusLabel(n.status);
        if (iconWrap) {
          iconWrap.setAttribute("title", label);
          iconWrap.dataset.tip = label;
        }
        // 尾部 meta（失败计数 / 耗时）
        const meta = row.querySelector(".test-meta");
        if (meta) {
          const parts: string[] = [];
          if (n.kind !== "case") {
            if (n.failedCount > 0) parts.push(t("test.failedCount", { count: n.failedCount }));
          } else if (n.durationMs != null) {
            parts.push(t("test.duration", { ms: n.durationMs }));
          }
          meta.textContent = parts.join("　");
        }
        // 失败消息 tooltip（行内）
        const nameEl = row.querySelector(".test-name");
        if (nameEl instanceof HTMLElement) {
          if (n.message) {
            nameEl.dataset.tip = n.message;
            nameEl.title = n.message;
          } else {
            nameEl.removeAttribute("data-tip");
            nameEl.removeAttribute("title");
          }
        }
      }
      if (n.kind !== "case") walk(n.children);
    }
  };
  walk(tree);
  // 跑完失败自动展开有失败的文件（§3.10③）：只改 map 后走唯一渲染路径落 DOM
  //（renderTests 的 visibleNodes 会把新展开的子行一并拍平渲染，twisty 状态随 map）
  let autoExpanded = false;
  for (const f of tree) {
    if (f.failedCount > 0 && !(expanded.get(f.id) ?? false)) {
      expanded.set(f.id, true);
      autoExpanded = true;
    }
  }
  if (autoExpanded) renderTests();
  // 头部计数（含失败数）与「重跑失败」可用性随结果刷新：结果合入刻意不重建 DOM
  //（§3.10），工具条不在重绘路径上，必须单独同步一次。
  syncToolbar(testViewState(), tree);
}
