// 运行入口 UI 域（C3）：菜单栏全局运行组（▶ / ⏹ / ▾）+ 状态机 + ▾ 下拉菜单。
// 与 main.ts 解耦：main.ts 拥有运行动作与运行态真值，本模块只负责「渲染 + 派发」——
// handlers 注入（同 terminal.ts::setTerminalLinkHandler / termUi.ts::setOutputPanelHooks 先例），
// 避免 runWidget → main → runWidget 的循环导入。所有状态变化点调用 renderRunWidget 重绘。
// 本模块只更新按钮属性/类名，不重建按钮 DOM（renderTabs 高频调用，T10）。

import { lazyEl } from "./state";
import { showMenu, type MenuItem } from "./menu";

export interface RunWidgetState {
  /** 有工作区且有活动 .py/.pyw */
  canRun: boolean;
  /** canRun 为假时的原因文案 */
  disabledReason: string;
  running: boolean;
  /** P1（UX 审查）：运行准备期（保存 / 依赖预检 / Before launch）——▶ 显示 spinner + 专属提示 */
  preparing: boolean;
  channel: "output" | "terminal" | null;
  /** 活动文件名（basename），用于 tooltip */
  targetName: string;
  runShortcut: string;
  stopShortcut: string;
  selectionShortcut: string;
  /** 有工作区且有活动 .py（运行配置入口可用性） */
  canOpenConfig: boolean;
  /** P0-C：命名运行配置列表（▾ 菜单展示；summary 为回显摘要） */
  profiles: { name: string; summary: string }[];
}

export interface RunWidgetHandlers {
  run: () => void;
  runInTerminal: () => void;
  runSelection: () => void;
  stop: () => void;
  restart: () => void;
  openRunConfig: () => void;
  /** P0-C：按名运行一份命名配置（module 入口无需文件锚点） */
  runProfile: (name: string) => void;
  /** P2 Compound：并行运行多个配置（勾选面板） */
  openCompound: () => void;
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
  menu: RunButtonState;
}

// CR-26：顶层 DOM 快照改惰性（computeRunWidget 是纯函数，测试环境无 DOM 也要可 import）
const btnRun = lazyEl<HTMLButtonElement>("btn-run");
const btnStop = lazyEl<HTMLButtonElement>("btn-stop");
const btnMenu = lazyEl<HTMLButtonElement>("btn-run-menu");

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
  if (s.preparing) {
    // P1：准备期（保存 / 依赖预检 / 前置配置）——原先混在 running 里误报「已有脚本在运行」
    return {
      run: { disabled: true, tip: "正在准备运行（保存 / 依赖预检）…", busy: true },
      stop: { disabled: true, tip: "没有正在运行的脚本" },
      menu: { disabled: false, tip: "更多运行选项" },
    };
  }
  if (!s.canRun) {
    // R0：不可运行
    const reason = s.disabledReason;
    return {
      run: { disabled: true, tip: reason },
      stop: { disabled: true, tip: "没有正在运行的脚本" },
      menu: { disabled: true, tip: reason },
    };
  }
  if (!s.running) {
    // R1：可运行、未运行
    return {
      run: { disabled: false, tip: `运行 ${s.targetName}`, tipKey: s.runShortcut },
      stop: { disabled: true, tip: "没有正在运行的脚本" },
      menu: { disabled: false, tip: "更多运行选项" },
    };
  }
  // R2 / R3：运行中
  const channelTip = s.channel === "terminal" ? "运行终端" : "输出面板";
  return {
    run: { disabled: true, tip: "已有脚本在运行（先停止）" },
    stop: { disabled: false, tip: `停止运行 · ${channelTip}`, tipKey: s.stopShortcut },
    menu: { disabled: false, tip: "更多运行选项" },
  };
}

/** 按状态重绘三按钮的亮/灰、tooltip、tip-key。所有状态变化点都要调它。 */
export function renderRunWidget(s: RunWidgetState): void {
  state = s;
  const c = computeRunWidget(s);
  applyButton(btnRun, c.run);
  applyButton(btnStop, c.stop);
  applyButton(btnMenu, c.menu);
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

/** ▾ 下拉菜单项（与 gutter 右键共用同源，保证两处菜单一致）。 */
export function getRunMenuItems(): MenuItem[] {
  const s = state;
  const h = handlers;
  if (!s || !h) return [];

  // P1：preparing（保存 / 依赖预检）与 running 同属「不可再启动」——否则准备期菜单项
  // 仍可点、点击被 runFlow 闸门静默拒绝（点了没反应）
  const busy = s.running || s.preparing;
  const busyReason = s.preparing ? "正在准备运行…" : "已有脚本在运行";

  // P0-C：命名配置区（未运行时可用，module 入口无需活动文件）
  const profileItems: MenuItem[] = [];
  if (s.profiles.length > 0) {
    profileItems.push({ sep: true });
    for (const p of s.profiles) {
      profileItems.push({
        label: `运行 ${p.name}`,
        icon: "run",
        detail: p.summary,
        disabled: busy,
        disabledReason: busy ? busyReason : undefined,
        action: () => h.runProfile(p.name),
      });
    }
  }

  if (s.running) {
    return [
      { label: "停止运行", icon: "debug-stop", shortcut: s.stopShortcut, action: h.stop },
      { label: "停止并重新运行", icon: "debug-rerun", action: h.restart },
      { sep: true },
      { label: "在终端中运行", icon: "terminal", detail: "真 TTY（getpass / tqdm / 彩色 / Ctrl+C）", disabled: true, disabledReason: "已有脚本在运行" },
      { label: "运行选区 / 行", icon: "run", shortcut: s.selectionShortcut, disabled: true, disabledReason: "已有脚本在运行" },
      ...profileItems,
      { sep: true },
      { label: "运行配置…", icon: "gear", detail: "配置列表 / 入口类型 / 工作目录 / 参数 / 环境变量 / 标准输入", disabled: !s.canOpenConfig, disabledReason: s.canOpenConfig ? undefined : "需先打开工作区", action: h.openRunConfig },
    ];
  }

  // R0 / R1（未运行；含准备期——各项置灰并给出原因）
  return [
    { label: "在终端中运行", icon: "terminal", detail: "真 TTY（getpass / tqdm / 彩色 / Ctrl+C）", disabled: busy || !s.canRun, disabledReason: busy ? busyReason : s.canRun ? undefined : s.disabledReason, action: h.runInTerminal },
    { label: "运行选区 / 行", icon: "run", shortcut: s.selectionShortcut, disabled: busy || !s.canRun, disabledReason: busy ? busyReason : s.canRun ? undefined : s.disabledReason, action: h.runSelection },
    ...profileItems,
    { sep: true },
    { label: "并行运行配置…", icon: "combine", detail: "勾选多个配置一次性并行启动（Compound）", disabled: busy || s.profiles.length === 0, disabledReason: busy ? busyReason : s.profiles.length === 0 ? "暂无命名配置" : undefined, action: h.openCompound },
    { label: "运行配置…", icon: "gear", detail: "配置列表 / 入口类型 / 工作目录 / 参数 / 环境变量 / 标准输入", disabled: !s.canOpenConfig, disabledReason: s.canOpenConfig ? undefined : "需先打开工作区", action: h.openRunConfig },
  ];
}

/** 接线三按钮（init 调用一次）。UX P0-3：按钮不再用 disabled 属性（见 applyButton），
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
  btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btnMenu.classList.contains("is-disabled")) return;
    showMenu(getRunMenuItems(), btnMenu);
  });
}