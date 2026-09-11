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

import { lazyEl } from "./state";
import { codicon } from "./util";

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

export function showMenu(items: MenuItem[], anchor: MenuAnchor): void {
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
}

export function hideMenu(): void {
  ctxMenuEl.classList.add("hidden");
}

export function isMenuOpen(): boolean {
  return !ctxMenuEl.classList.contains("hidden");
}

function renderItem(it: MenuItem): HTMLElement {
  const el = document.createElement("div");
  if (it.sep) {
    el.className = "ctx-menu-item sep-item";
    const line = document.createElement("div");
    line.className = "sep";
    el.appendChild(line);
    return el;
  }

  let cls = "ctx-menu-item";
  if (it.danger) cls += " danger";
  if (it.disabled) cls += " disabled";
  el.className = cls;

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