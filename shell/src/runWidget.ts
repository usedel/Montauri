// 运行入口 UI 域（C3）：菜单栏全局运行组（[运行目标 ▾] / ▶ / ⏹）+ 状态机 + 目标下拉菜单。
// 组成为 PyCharm 布局：左侧下拉显示**当前选中的运行目标**并切换，右侧 ▶ 才真正启动
// （见 docs/python_run_dev_plan.md §4；原先的 ▸「更多运行选项」并入此下拉）。
// 与 main.ts 解耦：main.ts 拥有运行动作与运行态真值，本模块只负责「渲染 + 派发」——
// handlers 注入（同 terminal.ts::setTerminalLinkHandler / termUi.ts::setOutputPanelHooks 先例），
// 避免 runWidget → main → runWidget 的循环导入。所有状态变化点调用 renderRunWidget 重绘。
// 本模块只更新按钮属性/类名，不重建按钮 DOM（renderTabs 高频调用，T10）。

import { lazyEl } from "./state";
import { showMenu, type MenuItem } from "./menu";
import type { RunTarget } from "./runState";

export interface RunWidgetState {
  /** 有工作区且（有粘性目标 或 有活动 .py/.pyw） */
  canRun: boolean;
  /** canRun 为假时的原因文案 */
  disabledReason: string;
  running: boolean;
  /** P1（UX 审查）：运行准备期（保存 / 依赖预检 / Before launch）——▶ 显示 spinner + 专属提示 */
  preparing: boolean;
  channel: "output" | "terminal" | null;
  /** ▶ 会跑的目标显示名（**仅粘性目标**；无目标时为空串，由下拉渲染成固定占位「当前文件」） */
  targetName: string;
  /** 当前粘性运行目标（▶ 下次会跑什么）；null = 无目标，▶ 将回落当前文件 */
  currentTarget: RunTarget | null;
  /** 当前目标是「文件」且尚未保存为运行配置时的那一行（null = 无 / 已被配置覆盖） */
  unsavedFileTarget: { path: string; name: string } | null;
  runShortcut: string;
  stopShortcut: string;
  selectionShortcut: string;
  /** 有工作区（运行配置入口可用性；面板是工作区级的，不依赖活动文件） */
  canOpenConfig: boolean;
  /** 运行配置列表（下拉的目标区展示；summary 为回显摘要，temporary = PyCharm 临时配置） */
  profiles: { name: string; summary: string; temporary?: boolean }[];
}

export interface RunWidgetHandlers {
  run: () => void;
  runInTerminal: () => void;
  runSelection: () => void;
  stop: () => void;
  restart: () => void;
  openRunConfig: () => void;
  /** P2 Compound：并行运行多个配置（勾选面板） */
  openCompound: () => void;
  /** 只把 ▶ 的目标切过去（不启动）——下拉的目标区用，对齐 PyCharm「选下拉 ≠ 运行」 */
  setTarget: (t: RunTarget) => void;
}

export interface RunButtonState {
  disabled: boolean;
  tip: string;
  tipKey?: string;
  /** P1：准备中——▶ 图标切为旋转 loader（data-tip 已解释原因） */
  busy?: boolean;
}

export interface RunWidgetComputed {
  run: RunButtonState;
  stop: RunButtonState;
  /** 左侧「运行目标」下拉（显示当前目标 + 切换入口） */
  target: RunButtonState;
}

// CR-26：顶层 DOM 快照改惰性（computeRunWidget 是纯函数，测试环境无 DOM 也要可 import）
const btnRun = lazyEl<HTMLButtonElement>("btn-run");
const btnStop = lazyEl<HTMLButtonElement>("btn-stop");
const btnTarget = lazyEl<HTMLButtonElement>("run-target");
const targetLabelEl = lazyEl<HTMLElement>("run-target-label");

/** 路径归一（跨平台大小写/分隔符），仅用于目标打勾比对 */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * 无目标时下拉的占位标签。用 PyCharm 的固定文案「当前文件」——它是**预选态**，
 * 含义是"跑编辑器里那个文件"，因此**绝不能**拼上真实文件名（拼了就会随切标签变化，
 * 看起来像一个叫 main.py 的已存配置）。
 */
const TARGET_PLACEHOLDER = "当前文件";

let handlers: RunWidgetHandlers | null = null;
let state: RunWidgetState | null = null;
/** 设置保存后改键位不会走 renderTabs，由 main 注册一个「重新组装状态并重绘」的回调补那条路径 */
let repaintFn: (() => void) | null = null;

export function setRunWidgetHandlers(h: RunWidgetHandlers): void {
  handlers = h;
}

/** 测试专用：直接注入 state（getRunMenuItems 为纯函数，测试不经过 renderRunWidget 的 DOM 路径） */
export function setRunWidgetStateForTest(s: RunWidgetState): void {
  state = s;
}

export function setRunWidgetRepaint(fn: () => void): void {
  repaintFn = fn;
}

/** 触发重绘（由 main 注册的回调组装最新状态；当前值有则可直接重绘） */
export function repaintRunWidget(): void {
  repaintFn?.();
}

/** 纯函数：把运行态映射为三按钮的亮/灰 + tooltip 文案（可单测，不碰 DOM）。 */
export function computeRunWidget(s: RunWidgetState): RunWidgetComputed {
  /** 下拉提示：当前目标 + 「只改选中、不启动」——后半句是本菜单与旧 ▸「更多选项」的关键区别，
   *  必须常驻可见，否则用户会以为点开菜单选中一项就等于跑了它（起跑仍由 ▶ 负责）。 */
  const targetTip = s.targetName
    ? `切换运行目标（当前：${s.targetName}）· 只改选中，不启动`
    : "选择运行目标（只改选中，不启动）";
  if (s.preparing) {
    // P1：准备期（保存 / 依赖预检 / 前置配置）——原先混在 running 里误报「已有脚本在运行」
    return {
      run: { disabled: true, tip: "正在准备运行（保存 / 依赖预检）…", busy: true },
      stop: { disabled: true, tip: "没有正在运行的脚本" },
      target: { disabled: false, tip: targetTip },
    };
  }
  if (!s.canRun) {
    // R0：不可运行
    const reason = s.disabledReason;
    return {
      run: { disabled: true, tip: reason },
      stop: { disabled: true, tip: "没有正在运行的脚本" },
      target: { disabled: true, tip: reason },
    };
  }
  if (!s.running) {
    // R1：可运行、未运行
    return {
      run: { disabled: false, tip: s.targetName ? `运行 ${s.targetName}` : "运行当前文件", tipKey: s.runShortcut },
      stop: { disabled: true, tip: "没有正在运行的脚本" },
      target: { disabled: false, tip: targetTip },
    };
  }
  // R2 / R3：运行中（仍允许改选目标——PyCharm 同样可以在运行中换选中项）
  const channelTip = s.channel === "terminal" ? "运行终端" : "输出面板";
  return {
    run: { disabled: true, tip: "已有脚本在运行（先停止）" },
    stop: { disabled: false, tip: `停止运行 · ${channelTip}`, tipKey: s.stopShortcut },
    target: { disabled: false, tip: targetTip },
  };
}

/** 按状态重绘三控件的亮/灰、tooltip、tip-key，并同步下拉上的目标名。所有状态变化点都要调它。 */
export function renderRunWidget(s: RunWidgetState): void {
  state = s;
  const c = computeRunWidget(s);
  applyButton(btnRun, c.run);
  applyButton(btnStop, c.stop);
  applyButton(btnTarget, c.target);
  targetLabelEl.textContent = s.targetName || TARGET_PLACEHOLDER;
  btnTarget.classList.toggle("is-empty", !s.targetName);
}

/** UX P0-3：禁用态用 .is-disabled 类 + aria-disabled（debugView 工具栏同款模式），
 *  不用 disabled 属性——Chromium 不向禁用的表单控件派发鼠标事件，data-tip 会静默失效，
 *  而「为什么不能运行」的原因文案恰是灰按钮最需要展示的信息；附带让按钮留在 tab 序列，
 *  键盘/读屏用户也能发现控件并听到「已禁用」。点击守卫在 wireRunWidget 的回调里。 */
function applyButton(btn: HTMLButtonElement, b: RunButtonState): void {
  btn.classList.toggle("is-disabled", b.disabled);
  btn.setAttribute("aria-disabled", String(b.disabled));
  btn.dataset.tip = b.tip;
  if (b.tipKey) btn.dataset.tipKey = b.tipKey;
  else delete btn.dataset.tipKey;
  // P1：准备中把 ▶ 切为旋转 loader（codicon-modifier-spin 已随「减少动画」自动归零）。
  // 只对「正在显示 loader」的图标做 run↔loading 双向切换——本函数是三按钮共用，
  // 不能无条件给 ⏹（codicon-debug-stop）/ ▾（codicon-chevron-down）加 codicon-run，
  // 否则同特异性的 ::before content 互相覆盖，三个按钮图标会变成同一个 ▶。
  const icon = btn.querySelector<HTMLElement>("i.codicon");
  if (icon) {
    if (b.busy) {
      icon.classList.remove("codicon-run");
      icon.classList.add("codicon-loading", "codicon-modifier-spin");
    } else if (icon.classList.contains("codicon-loading")) {
      icon.classList.remove("codicon-loading", "codicon-modifier-spin");
      icon.classList.add("codicon-run");
    }
  }
}

/**
 * 「运行目标」下拉菜单项（与 gutter 右键共用同源，保证两处菜单一致）。
 * 结构对齐 PyCharm：**顶部目标区**（单选，`checked` 标出当前项，点击只改选中、不启动）
 * + **底部「更多运行方式」**（终端运行 / 选区运行 / 并行 / 编辑配置）。
 * 旧版 ▸ 菜单里的「运行 <配置名>」不再单独列出——选中目标后按 ▶ 即运行，与 PyCharm 一致。
 */
export function getRunMenuItems(): MenuItem[] {
  const s = state;
  const h = handlers;
  if (!s || !h) return [];

  // P1：preparing（保存 / 依赖预检）与 running 同属「不可再启动」——否则准备期菜单项
  // 仍可点、点击被 runFlow 闸门静默拒绝（点了没反应）
  const busy = s.running || s.preparing;
  const busyReason = s.preparing ? "正在准备运行…" : "已有脚本在运行";
  const cur = s.currentTarget;
  const curFilePath = cur && cur.kind === "file" ? normPath(cur.path) : null;

  // ---- 目标区（单选）——切换目标本身不受 busy 限制：随时可改选，▶ 才是执行动作 ----
  // 只放**真实存在的配置**：永久的命名配置 + 临时的「跑过的文件」。
  // 不放"当前打开的文件"——它不是配置，且会随切标签漂移（PyCharm 也没有这样的条目）。
  const targetItems: MenuItem[] = [];
  for (const p of s.profiles) {
    targetItems.push({
      label: p.name,
      icon: "run",
      // 临时配置（跑文件自动落盘、上限 5）显式标注来源，与手工新建的永久配置区分
      detail: [p.summary, p.temporary ? "临时" : ""].filter(Boolean).join("  ·  ") || undefined,
      checked: cur?.kind === "profile" && cur.name === p.name,
      action: () => h.setTarget({ kind: "profile", name: p.name }),
    });
  }
  // 当前目标是未保存为配置的文件时补一行，保证 ▶ 会跑什么在下拉里可见
  if (s.unsavedFileTarget && curFilePath !== null && curFilePath === normPath(s.unsavedFileTarget.path)) {
    targetItems.push({
      label: s.unsavedFileTarget.name,
      icon: "file-code",
      detail: "临时（未保存为运行配置）",
      checked: true,
      action: () => h.setTarget({ kind: "file", path: s.unsavedFileTarget!.path }),
    });
  }

  const items: MenuItem[] = [];
  if (s.running) {
    items.push(
      { label: "停止运行", icon: "debug-stop", shortcut: s.stopShortcut, action: h.stop },
      { label: "停止并重新运行", icon: "debug-rerun", action: h.restart },
    );
  }
  if (items.length > 0) items.push({ sep: true });
  items.push(...targetItems);
  items.push({ sep: true });
  items.push(
    {
      label: "在终端中运行",
      icon: "terminal",
      detail: "真 TTY（getpass / tqdm / 彩色 / Ctrl+C）",
      disabled: busy || !s.canRun,
      disabledReason: busy ? busyReason : s.canRun ? undefined : s.disabledReason,
      action: h.runInTerminal,
    },
    {
      label: "运行选区 / 行",
      icon: "run",
      shortcut: s.selectionShortcut,
      disabled: busy || !s.canRun,
      disabledReason: busy ? busyReason : s.canRun ? undefined : s.disabledReason,
      action: h.runSelection,
    },
    { sep: true },
    {
      label: "并行运行配置…",
      icon: "combine",
      detail: "勾选多个配置一次性并行启动（Compound）",
      disabled: busy || s.profiles.length === 0,
      disabledReason: busy ? busyReason : s.profiles.length === 0 ? "暂无命名配置" : undefined,
      action: h.openCompound,
    },
    {
      label: "运行配置…",
      icon: "gear",
      detail: "配置列表 / 入口类型 / 工作目录 / 参数 / 环境变量 / 标准输入",
      disabled: !s.canOpenConfig,
      disabledReason: s.canOpenConfig ? undefined : s.disabledReason || "需先打开工作区",
      action: h.openRunConfig,
    },
  );
  return items;
}

/** 接线三控件（init 调用一次）。UX P0-3：控件不再用 disabled 属性（见 applyButton），
 *  故点击守卫移入回调——.is-disabled 时的点击一律忽略。 */
export function wireRunWidget(): void {
  btnRun.addEventListener("click", () => {
    if (btnRun.classList.contains("is-disabled")) return;
    handlers?.run();
  });
  btnStop.addEventListener("click", () => {
    if (btnStop.classList.contains("is-disabled")) return;
    handlers?.stop();
  });
  btnTarget.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btnTarget.classList.contains("is-disabled")) return;
    showMenu(getRunMenuItems(), btnTarget);
  });
}