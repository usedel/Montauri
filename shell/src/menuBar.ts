// 菜单栏域（TD-14 拆分，原 main.ts 的「菜单栏 + 级联子菜单」段）：
// 顶部下拉菜单 / flyout 子菜单的渲染与键盘导航机制。菜单项数据（getMenuItems）
// 由 main 注入——菜单是跨域动作的汇聚点，机制与数据分离后本模块不再依赖任何业务域。

import { $ } from "./state";
import { moveMenuFocus, wireMenuKeyNav } from "./menuKeys"; // UI-30：与 menu.ts 共享同一套 APG 规则

export interface MenuEntry {
  label: string;
  shortcut?: string;
  /** 子菜单项副标题（如最近工作区的路径） */
  detail?: string;
  action?: () => void;
  /** 有值即渲染为带 ▸ 的父项，悬停/点击展开右侧子菜单 */
  submenu?: () => MenuEntry[] | Promise<MenuEntry[]>;
  sep?: boolean;
}

const menuDropdownEl = $("menu-dropdown");
const submenuEl = $("menu-submenu");
let activeMenuBtn: HTMLElement | null = null;
/** 当前展开子菜单的父项元素（用于 hover 态与定位） */
let activeSubmenuParent: HTMLElement | null = null;
/** hover 延时展开 / 延时关闭定时器 */
let submenuTimer: number | undefined;
/** UI-30：父项元素 → 子菜单解析器（键盘 → 键展开子菜单时取用；渲染时写入，随元素销毁自动回收） */
const submenuResolvers = new WeakMap<HTMLElement, () => MenuEntry[] | Promise<MenuEntry[]>>();

function showMenuDropdown(btn: HTMLElement, getItems: (menu: string) => MenuEntry[], menu: string): void {
  const items = getItems(menu);
  menuDropdownEl.textContent = "";
  for (const it of items) {
    const el = document.createElement("div");
    if (it.sep) {
      el.className = "ctx-menu-item sep-item";
      el.setAttribute("role", "separator"); // UI-30
      const line = document.createElement("div");
      line.className = "sep";
      el.appendChild(line);
    } else if (it.submenu) {
      // 有子菜单的父项：右侧 ▸，悬停延时展开、点击切换
      el.className = "ctx-menu-item with-submenu";
      // UI-30：APG menu 模式——父项声明 haspopup，aria-expanded 由 openSubmenu/hideSubmenu 同源切换
      el.setAttribute("role", "menuitem");
      el.setAttribute("aria-haspopup", "menu");
      el.setAttribute("aria-expanded", "false");
      el.tabIndex = -1;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      const arrow = document.createElement("span");
      arrow.className = "sub-arrow";
      arrow.textContent = "▸";
      el.appendChild(arrow);
      submenuResolvers.set(el, it.submenu); // UI-30：供键盘 → 键展开时取用
      el.addEventListener("mouseenter", () => scheduleSubmenu(el, it.submenu!));
      el.addEventListener("mouseleave", scheduleSubmenuClose);
      el.addEventListener("click", () => {
        if (activeSubmenuParent === el) hideSubmenu();
        else void openSubmenu(el, it.submenu!);
      });
    } else {
      el.className = "ctx-menu-item";
      el.setAttribute("role", "menuitem"); // UI-30
      el.tabIndex = -1;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      if (it.shortcut) {
        const sc = document.createElement("span");
        sc.className = "menu-shortcut";
        sc.textContent = it.shortcut;
        el.appendChild(sc);
      }
      el.addEventListener("mouseenter", hideSubmenu);
      el.addEventListener("click", () => {
        hideMenuDropdown();
        it.action?.();
      });
    }
    menuDropdownEl.appendChild(el);
  }
  menuDropdownEl.classList.remove("hidden");
  const rect = btn.getBoundingClientRect();
  menuDropdownEl.style.left = `${rect.left}px`;
  menuDropdownEl.style.top = `${rect.bottom + 2}px`;
  activeMenuBtn?.classList.remove("active");
  activeMenuBtn?.setAttribute("aria-expanded", "false"); // UI-30：直接切换菜单时旧按钮的开合态复位
  activeMenuBtn = btn;
  btn.classList.add("active");
  btn.setAttribute("aria-expanded", "true"); // UI-30
  // UI-30：打开即把焦点移入菜单首项（APG menu 模式），↑↓/Home/End/Enter 从此可用
  moveMenuFocus(menuDropdownEl, "first");
}

function hideMenuDropdown(): void {
  hideSubmenu();
  menuDropdownEl.classList.add("hidden");
  activeMenuBtn?.classList.remove("active");
  activeMenuBtn?.setAttribute("aria-expanded", "false"); // UI-30
  // UI-30：焦点尚未离开（仍在菜单内或掉到 body——如 Esc 关闭）时归还菜单按钮；
  // 用户已点击别处（含另一个菜单按钮）时焦点在点击目标上，不抢回
  const ae = document.activeElement;
  if (
    activeMenuBtn?.isConnected &&
    (ae === null || ae === document.body || menuDropdownEl.contains(ae) || submenuEl.contains(ae))
  ) {
    activeMenuBtn.focus();
  }
  activeMenuBtn = null;
}

// ---------- 级联子菜单（flyout） ----------

function cancelSubmenuTimer(): void {
  window.clearTimeout(submenuTimer);
  submenuTimer = undefined;
}

function hideSubmenu(): void {
  cancelSubmenuTimer();
  activeSubmenuParent?.classList.remove("open");
  activeSubmenuParent?.setAttribute("aria-expanded", "false"); // UI-30：与 .open 类同源切换
  activeSubmenuParent = null;
  submenuEl.classList.add("hidden");
  submenuEl.textContent = "";
}

/** 悬停父项：延时展开（连续移动会重置计时，避免闪烁） */
function scheduleSubmenu(parentEl: HTMLElement, resolve: () => MenuEntry[] | Promise<MenuEntry[]>): void {
  cancelSubmenuTimer();
  submenuTimer = window.setTimeout(() => { void openSubmenu(parentEl, resolve); }, 200);
}

/** 离开父项：延时关闭，给鼠标移入子菜单留缓冲 */
function scheduleSubmenuClose(): void {
  cancelSubmenuTimer();
  submenuTimer = window.setTimeout(hideSubmenu, 250);
}

/** @param focusFirst UI-30：键盘（→ 键）展开时把焦点移入子菜单首项；鼠标悬停/点击展开不抢焦点 */
async function openSubmenu(
  parentEl: HTMLElement,
  resolve: () => MenuEntry[] | Promise<MenuEntry[]>,
  focusFirst = false,
): Promise<void> {
  cancelSubmenuTimer();
  activeSubmenuParent?.classList.remove("open");
  activeSubmenuParent?.setAttribute("aria-expanded", "false"); // UI-30：切换父项时旧父项复位
  activeSubmenuParent = parentEl;
  parentEl.classList.add("open");
  parentEl.setAttribute("aria-expanded", "true"); // UI-30：与 .open 类同源切换

  let children: MenuEntry[];
  try {
    children = await resolve();
  } catch (e) {
    console.warn("读取子菜单失败", e);
    children = [{ label: "（加载失败）" }];
  }

  // 异步期间可能已切到其它父项或菜单已关闭
  if (activeSubmenuParent !== parentEl || menuDropdownEl.classList.contains("hidden")) return;

  submenuEl.textContent = "";
  for (const it of children) {
    if (it.sep) {
      const el = document.createElement("div");
      el.className = "ctx-menu-item sep-item";
      el.setAttribute("role", "separator"); // UI-30
      const line = document.createElement("div");
      line.className = "sep";
      el.appendChild(line);
      submenuEl.appendChild(el);
    } else {
      const el = document.createElement("div");
      el.className = "ctx-menu-item";
      el.setAttribute("role", "menuitem"); // UI-30
      el.tabIndex = -1;
      const labelSpan = document.createElement("span");
      labelSpan.className = "sub-label";
      labelSpan.textContent = it.label;
      el.appendChild(labelSpan);
      if (it.detail) {
        const detailSpan = document.createElement("span");
        detailSpan.className = "sub-detail";
        detailSpan.textContent = it.detail;
        detailSpan.title = it.detail;
        el.appendChild(detailSpan);
      }
      el.addEventListener("click", () => {
        hideMenuDropdown();
        it.action?.();
      });
      submenuEl.appendChild(el);
    }
  }
  submenuEl.classList.remove("hidden");
  positionSubmenu(parentEl);
  if (focusFirst) moveMenuFocus(submenuEl, "first"); // UI-30
}

function positionSubmenu(parentEl: HTMLElement): void {
  const parentRect = parentEl.getBoundingClientRect();
  const menuRect = menuDropdownEl.getBoundingClientRect();
  // 先复位到 0 以便测量真实宽高
  submenuEl.style.left = "0px";
  submenuEl.style.top = "0px";
  const subRect = submenuEl.getBoundingClientRect();

  let left = menuRect.right - 1; // 紧贴父菜单右缘（共享 1px 边框）
  let top = parentRect.top;

  // 右侧放不下 → 折返到父菜单左侧
  if (left + subRect.width > window.innerWidth - 4) {
    left = menuRect.left - subRect.width + 1;
  }
  // 下缘溢出 → 向上夹取，保证不超视口
  if (top + subRect.height > window.innerHeight - 4) {
    top = window.innerHeight - subRect.height - 4;
  }
  if (top < 4) top = 4;

  submenuEl.style.left = `${left}px`;
  submenuEl.style.top = `${top}px`;
}

/** 菜单栏接线（main 的 init 调用）；getItems = main 的 getMenuItems（跨域动作数据源） */
export function wireMenuBar(getItems: (menu: string) => MenuEntry[]): void {
  document.querySelectorAll<HTMLElement>(".menubar-item").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = btn.dataset.menu ?? "";
      if (activeMenuBtn === btn) {
        hideMenuDropdown();
      } else {
        hideMenuDropdown();
        showMenuDropdown(btn, getItems, menu);
      }
    });
  });
  menuDropdownEl.addEventListener("click", (e) => e.stopPropagation());
  submenuEl.addEventListener("click", (e) => e.stopPropagation());
  submenuEl.addEventListener("mouseenter", cancelSubmenuTimer);
  submenuEl.addEventListener("mouseleave", scheduleSubmenuClose);
  document.addEventListener("click", () => {
    if (!menuDropdownEl.classList.contains("hidden")) hideMenuDropdown();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menuDropdownEl.classList.contains("hidden")) hideMenuDropdown();
  });
  // UI-30：下拉菜单的键盘导航（↑↓/Home/End 漫游、Enter/Space 激活、Tab 退出，见 menuKeys.ts）。
  // Esc 走级联语义：子菜单开着先关子菜单、焦点回父项；否则关整个下拉（焦点归还菜单按钮）。
  // 两者都 stopPropagation，不再触发上面 window 级 Escape 的整体关闭。
  wireMenuKeyNav(menuDropdownEl, {
    onArrowRight: (item) => {
      if (!item.classList.contains("with-submenu")) return;
      const resolve = submenuResolvers.get(item);
      if (resolve) void openSubmenu(item, resolve, true); // 键盘展开 → 焦点移入子菜单
    },
    onEscape: () => {
      if (activeSubmenuParent) {
        const p = activeSubmenuParent;
        hideSubmenu();
        p.focus();
      } else {
        hideMenuDropdown();
      }
    },
    onTab: () => hideMenuDropdown(),
  });
  // 子菜单：← / Esc 折叠回父项（APG 级联菜单的退出方向）；Tab 关整个下拉
  wireMenuKeyNav(submenuEl, {
    onArrowLeft: () => {
      const p = activeSubmenuParent;
      hideSubmenu();
      p?.focus();
    },
    onEscape: () => {
      const p = activeSubmenuParent;
      hideSubmenu();
      p?.focus();
    },
    onTab: () => hideMenuDropdown(),
  });
}
