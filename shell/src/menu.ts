// 通用弹出菜单渲染器（C1）：带快捷键 + 可禁用 + 可打勾 + 可图标 + 可说明的扁平菜单。
//
// 分工说明（勿误以为是漏改）：本模块 = **无子菜单的扁平弹出菜单**；
// 菜单栏那套带 flyout 子菜单（MenuEntry / showMenuDropdown / openSubmenu / positionSubmenu）
// **故意留在 main.ts 不合并**——它需要「悬停延时展开 + 右缘折叠 + 异步子项」，
// 与本模块的「即时弹出 + 单击执行」语义不同，强行合并只会互相拖累。
//
// 渲染约定：复用既有 #ctx-menu 容器与 .ctx-menu-item / .sep-item > .sep / .menu-shortcut
// 类名，不新增菜单 DOM 节点。fileTree.ts 的 renderCtxMenu / hideContextMenu 已成为本模块
// 的薄封装（CtxItem → MenuItem 映射），树右键 / 标签右键 / Git 分支列表等现有调用方零改动。
// 关闭接线（document click + Escape）已收编到本模块，fileTree 不再自行接线。
//
// UI-30（APG menu 模式）：容器 role=menu 静态写在 index.html；菜单项 role=menuitem /
// menuitemradio（checked 显式传入即视为单选组成员）+ aria-disabled + tabindex=-1；
// 打开即聚焦首项，↑↓/Home/End/Enter/Space/Tab 键盘导航走共享的 menuKeys.ts；
// 触发元素带 aria-haspopup 时自动跟踪 aria-expanded，关闭时按条件归还焦点。

import { lazyEl } from "./state";
import { codicon } from "./util";
import { moveMenuFocus, wireMenuKeyNav } from "./menuKeys";

export interface MenuItem {
  label?: string;
  /** codicon 名（不含 "codicon-" 前缀） */
  icon?: string;
  /** 右侧键位副文本（空串/undefined = 不显示） */
  shortcut?: string;
  /** label 之后的次要说明（灰字） */
  detail?: string;
  /** 左侧打勾（单选组，如引擎切换） */
  checked?: boolean;
  disabled?: boolean;
  /** 置灰时 hover 显示原因（走 data-tip 自绘 tooltip） */
  disabledReason?: string;
  danger?: boolean;
  sep?: boolean;
  action?: () => void;
}

export type MenuAnchor = HTMLElement | { x: number; y: number };

// CR-26：顶层 DOM 快照改惰性（测试环境无完整 DOM 时模块仍可被 import）
const ctxMenuEl = lazyEl("ctx-menu");

/** 「打开即被关闭」防御：showMenu 由一次 click/contextmenu 同步调用，该事件随后会冒泡到
 *  document。若 document 的关闭监听在本次冒泡里直接关掉刚打开的菜单，用户就永远看不见菜单。
 *  这里采用 **setTimeout(0) 延迟生效** 方案：打开后的下一个宏任务才允许关闭，本次冒泡被免。 */
let armClose = false;

/** UI-30：当前展开菜单对应的触发元素（aria-haspopup 者），关闭时复位 aria-expanded */
let expandedAnchor: HTMLElement | null = null;
/** UI-30：打开菜单时的焦点来源，关闭时按条件归还（APG menu 模式：焦点应回到调用元素） */
let returnFocusEl: HTMLElement | null = null;
/** UI-30：键盘导航惰性接线标记。不能在模块顶层接——那会在 import 期解析 lazyEl(#ctx-menu)，
 *  未建该元素的测试环境（runWidget.test / runGutter.test 间接 import 本模块）会直接抛「缺少元素」。 */
let keyNavWired = false;

export function showMenu(items: MenuItem[], anchor: MenuAnchor): void {
  if (!keyNavWired) {
    keyNavWired = true;
    // UI-30：↑↓/Home/End 漫游 + Enter/Space 激活 + Tab 退出（共享工具见 menuKeys.ts）。
    // Escape 不在这里拦——文件末尾的 window 级监听已负责关闭（hideMenu 内含焦点归还）。
    wireMenuKeyNav(ctxMenuEl, { onTab: () => hideMenu() });
  }
  // UI-30：上一个菜单未走 hideMenu 就被顶掉时（anchor 直点开的菜单 stopPropagation，
  // document 关闭监听收不到），先复位旧触发元素的 aria-expanded，避免残留 "true"
  if (expandedAnchor && expandedAnchor !== anchor) {
    expandedAnchor.setAttribute("aria-expanded", "false");
    expandedAnchor = null;
  }
  returnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (anchor instanceof HTMLElement && anchor.hasAttribute("aria-haspopup")) {
    anchor.setAttribute("aria-expanded", "true");
    expandedAnchor = anchor;
  }

  ctxMenuEl.textContent = "";
  for (const it of items) {
    ctxMenuEl.appendChild(renderItem(it));
  }
  ctxMenuEl.classList.remove("hidden");

  // 定位：先复位到 0 测量真实宽高，再 clamp 进视口（与旧 renderCtxMenu 同算法）。
  const { innerWidth, innerHeight } = window;
  ctxMenuEl.style.left = "0px";
  ctxMenuEl.style.top = "0px";
  const rect = ctxMenuEl.getBoundingClientRect();
  const x = anchor instanceof HTMLElement ? anchor.getBoundingClientRect().left : anchor.x;
  const y = anchor instanceof HTMLElement ? anchor.getBoundingClientRect().bottom + 2 : anchor.y;
  ctxMenuEl.style.left = `${Math.min(x, innerWidth - rect.width - 6)}px`;
  ctxMenuEl.style.top = `${Math.min(y, innerHeight - rect.height - 6)}px`;

  armClose = true;
  window.setTimeout(() => {
    armClose = false;
  }, 0);
  // UI-30：打开即把焦点移入菜单首项（APG menu 模式），↑↓/Home/End/Enter 从此可用
  moveMenuFocus(ctxMenuEl, "first");
}

export function hideMenu(): void {
  ctxMenuEl.classList.add("hidden");
  // UI-30：触发元素的开合态与焦点归还
  expandedAnchor?.setAttribute("aria-expanded", "false");
  expandedAnchor = null;
  // 只在焦点尚未离开时归还（仍在菜单内、或落在 body——如 Esc 关闭）。
  // 用户点击别处关闭菜单时，焦点已经在点击目标上，不应抢回旧位置。
  const ae = document.activeElement;
  if (returnFocusEl?.isConnected && (ae === null || ae === document.body || ctxMenuEl.contains(ae))) {
    returnFocusEl.focus();
  }
  returnFocusEl = null;
}

export function isMenuOpen(): boolean {
  return !ctxMenuEl.classList.contains("hidden");
}

function renderItem(it: MenuItem): HTMLElement {
  const el = document.createElement("div");
  if (it.sep) {
    el.className = "ctx-menu-item sep-item";
    el.setAttribute("role", "separator"); // UI-30：分隔符不是 menuitem，读屏跳过
    const line = document.createElement("div");
    line.className = "sep";
    el.appendChild(line);
    return el;
  }

  let cls = "ctx-menu-item";
  if (it.danger) cls += " danger";
  if (it.disabled) cls += " disabled";
  el.className = cls;
  // UI-30：APG menu 模式——菜单项 role=menuitem（单选组用 menuitemradio + aria-checked），
  // tabindex=-1 供程序聚焦（不占 tab 序列）。checked 显式传入（含 false）即视为单选组成员：
  // 引擎切换 / shell 选择的调用方都传布尔值，若只标 true 项会让同组语义残缺。
  if (it.checked !== undefined) {
    el.setAttribute("role", "menuitemradio");
    el.setAttribute("aria-checked", String(!!it.checked));
  } else {
    el.setAttribute("role", "menuitem");
  }
  if (it.disabled) el.setAttribute("aria-disabled", "true");
  el.tabIndex = -1;

  // 前导槽：勾选（checked）优先于图标；均无则不占位（无图标菜单保持旧观感）
  if (it.checked) {
    const ic = document.createElement("span");
    ic.className = "mi-icon";
    ic.appendChild(codicon("check"));
    el.appendChild(ic);
  } else if (it.icon) {
    const ic = document.createElement("span");
    ic.className = "mi-icon";
    ic.appendChild(codicon(it.icon));
    el.appendChild(ic);
  }

  const label = document.createElement("span");
  label.className = "mi-label";
  label.textContent = it.label ?? "";
  el.appendChild(label);

  if (it.detail) {
    const d = document.createElement("span");
    d.className = "mi-detail";
    d.textContent = it.detail;
    el.appendChild(d);
  }

  if (it.shortcut) {
    const sc = document.createElement("span");
    sc.className = "menu-shortcut";
    sc.textContent = it.shortcut;
    el.appendChild(sc);
  }

  if (it.disabled) {
    // 置灰项：不执行 action；用 stopPropagation 阻止 document 关闭监听把菜单随手关掉，
    // 让「点了没反应」保持可见并继续展示 disabledReason tooltip。
    if (it.disabledReason) el.dataset.tip = it.disabledReason;
    el.addEventListener("click", (e) => e.stopPropagation());
    return el;
  }

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    hideMenu();
    it.action?.();
  });
  return el;
}

// ---------- 关闭接线（随渲染器一起收编，fileTree 不再自行接线） ----------

document.addEventListener("click", () => {
  if (armClose) return; // 本次打开事件尚未冒泡完，免关
  if (!ctxMenuEl.classList.contains("hidden")) hideMenu();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ctxMenuEl.classList.contains("hidden")) hideMenu();
});