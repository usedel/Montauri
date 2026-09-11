// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import type * as MenuModule from "../menu";

let menu: typeof MenuModule;

const ctx = () => document.getElementById("ctx-menu")!;

beforeAll(async () => {
  // 动态导入：让 menu.ts 在 #ctx-menu 已存在的环境下求值（模块顶层会捕获该元素）
  if (!document.getElementById("ctx-menu")) {
    const el = document.createElement("div");
    el.id = "ctx-menu";
    el.className = "ctx-menu hidden";
    document.body.appendChild(el);
  }
  menu = await import("../menu");
});

describe("menu.ts 通用弹出菜单", () => {
  it("映射 label/icon/shortcut/detail/checked/danger/sep 到 DOM", () => {
    menu.showMenu(
      [
        { label: "在终端中运行", icon: "terminal", detail: "真 TTY", shortcut: "Ctrl+F2" },
        { label: "pyrefly", checked: true },
        { sep: true },
        { label: "删除", danger: true },
      ],
      { x: 0, y: 0 },
    );
    const el = ctx();
    expect(el.classList.contains("hidden")).toBe(false);
    expect(el.querySelectorAll(".ctx-menu-item").length).toBe(4);
    expect(el.querySelector(".mi-icon .codicon-terminal")).not.toBeNull();
    expect(el.querySelector(".mi-detail")?.textContent).toBe("真 TTY");
    expect(el.querySelector(".menu-shortcut")?.textContent).toBe("Ctrl+F2");
    expect(el.querySelector(".mi-icon .codicon-check")).not.toBeNull();
    expect(el.querySelector(".ctx-menu-item.danger")).not.toBeNull();
    expect(el.querySelector(".sep-item")).not.toBeNull();
  });

  it("disabled 项不执行 action、带 disabledReason，也不关闭菜单", () => {
    let called = false;
    menu.showMenu(
      [{ label: "已禁用", disabled: true, disabledReason: "已有脚本在运行", action: () => { called = true; } }],
      { x: 0, y: 0 },
    );
    const item = ctx().querySelector(".ctx-menu-item.disabled") as HTMLElement;
    expect(item.dataset.tip).toBe("已有脚本在运行");
    item.click();
    expect(called).toBe(false);
    expect(menu.isMenuOpen()).toBe(true);
  });

  it("普通项点击执行 action 并关闭菜单", () => {
    let called = false;
    menu.showMenu([{ label: "运行", action: () => { called = true; } }], { x: 0, y: 0 });
    const item = ctx().querySelector(".ctx-menu-item:not(.sep-item)") as HTMLElement;
    item.click();
    expect(called).toBe(true);
    expect(menu.isMenuOpen()).toBe(false);
  });
});

// ---------- UI-30：ARIA 语义与键盘导航（APG menu 模式） ----------

/** 在指定元素上派发一个冒泡的 keydown（wireMenuKeyNav 的监听挂在 #ctx-menu 容器上） */
function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

/** 焦点项的 label 文本（null = 焦点不在菜单项上） */
function focusedLabel(): string | null {
  const ae = document.activeElement;
  return ae?.classList.contains("ctx-menu-item") ? (ae.querySelector(".mi-label")?.textContent ?? "") : null;
}

describe("menu.ts UI-30 ARIA 与键盘导航", () => {
  it("菜单项 role=menuitem + tabindex=-1；分隔符 role=separator；禁用项 aria-disabled", () => {
    menu.showMenu(
      [
        { label: "运行" },
        { sep: true },
        { label: "已禁用", disabled: true },
      ],
      { x: 0, y: 0 },
    );
    const items = ctx().querySelectorAll<HTMLElement>(".ctx-menu-item");
    expect(items[0].getAttribute("role")).toBe("menuitem");
    expect(items[0].tabIndex).toBe(-1);
    expect(items[1].getAttribute("role")).toBe("separator");
    expect(items[2].getAttribute("role")).toBe("menuitem");
    expect(items[2].getAttribute("aria-disabled")).toBe("true");
    expect(items[0].hasAttribute("aria-disabled")).toBe(false);
  });

  it("checked 显式传入（含 false）即为单选组：role=menuitemradio + aria-checked", () => {
    menu.showMenu(
      [
        { label: "pyrefly", checked: true },
        { label: "basedpyright", checked: false },
        { label: "普通项" },
      ],
      { x: 0, y: 0 },
    );
    const items = ctx().querySelectorAll(".ctx-menu-item");
    expect(items[0].getAttribute("role")).toBe("menuitemradio");
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(items[1].getAttribute("role")).toBe("menuitemradio");
    expect(items[1].getAttribute("aria-checked")).toBe("false");
    expect(items[2].getAttribute("role")).toBe("menuitem");
  });

  it("打开即聚焦首个可用项", () => {
    menu.showMenu([{ label: "第一项" }, { label: "第二项" }], { x: 0, y: 0 });
    expect(focusedLabel()).toBe("第一项");
  });

  it("↑↓ 环绕漫游且跳过禁用项与分隔符；Home/End 跳首末", () => {
    menu.showMenu(
      [
        { label: "A" },
        { label: "B", disabled: true },
        { sep: true },
        { label: "C" },
      ],
      { x: 0, y: 0 },
    );
    const focusables = () => Array.from(ctx().querySelectorAll<HTMLElement>(".ctx-menu-item:not(.sep-item):not(.disabled)"));
    expect(focusedLabel()).toBe("A");
    key(focusables()[0], "ArrowDown");
    expect(focusedLabel()).toBe("C"); // B 禁用、分隔符不可聚焦，直达 C
    key(focusables()[1], "ArrowDown");
    expect(focusedLabel()).toBe("A"); // 越界环绕
    key(focusables()[0], "ArrowUp");
    expect(focusedLabel()).toBe("C"); // 反向环绕
    key(focusables()[1], "Home");
    expect(focusedLabel()).toBe("A");
    key(focusables()[0], "End");
    expect(focusedLabel()).toBe("C");
  });

  it("Enter 激活聚焦项并关闭菜单；Tab 只关闭不激活", () => {
    let called = 0;
    menu.showMenu([{ label: "A", action: () => { called++; } }, { label: "B", action: () => { called += 10; } }], { x: 0, y: 0 });
    const a = ctx().querySelectorAll<HTMLElement>(".ctx-menu-item")[0];
    key(a, "Enter");
    expect(called).toBe(1);
    expect(menu.isMenuOpen()).toBe(false);

    menu.showMenu([{ label: "A", action: () => { called += 100; } }], { x: 0, y: 0 });
    key(ctx().querySelector(".ctx-menu-item")!, "Tab");
    expect(called).toBe(1); // Tab 不激活任何项
    expect(menu.isMenuOpen()).toBe(false);
  });

  it("aria-haspopup 触发元素的 aria-expanded 随开合同步", () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    document.body.appendChild(btn);
    btn.focus();
    menu.showMenu([{ label: "pyrefly", checked: true }], btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    menu.hideMenu();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    btn.remove();
  });

  it("Escape 关闭菜单并把焦点归还触发元素", () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-haspopup", "menu");
    document.body.appendChild(btn);
    btn.focus();
    menu.showMenu([{ label: "A" }], btn);
    expect(focusedLabel()).toBe("A"); // 焦点已在菜单内
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(btn); // APG：焦点回到调用元素
    btn.remove();
  });
});