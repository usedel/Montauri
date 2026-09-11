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