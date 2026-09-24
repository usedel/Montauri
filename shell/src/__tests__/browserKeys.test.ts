// 浏览器加速器护栏的纯逻辑单测（不依赖 DOM：DOM 用例在本机 vitest 环境暂不可用）。
import { describe, expect, it } from "vitest";
import { isBlockedCombo } from "../browserKeys";

describe("isBlockedCombo", () => {
  it("危险组合：Monaco 内外一律拦（重载 / 打印 / 关窗口 / 清数据 / 插入符浏览 / 浏览器前进后退）", () => {
    const danger = [
      "Ctrl+KeyR", "Ctrl+F5", "Ctrl+KeyP", "Ctrl+KeyO", "Ctrl+KeyU",
      "Ctrl+KeyN", "Ctrl+KeyT", "Ctrl+KeyW", "Ctrl+Shift+KeyW",
      "Ctrl+Shift+Delete", "F7", "Alt+ArrowLeft", "Alt+ArrowRight",
    ];
    for (const c of danger) {
      expect(isBlockedCombo(c, true), `${c} @monaco`).toBe(true);
      expect(isBlockedCombo(c, false), `${c} @outside`).toBe(true);
    }
  });

  it("Monaco 内不误伤自带键位；同样的键在编辑器外归浏览器 → 拦", () => {
    for (const c of ["Ctrl+KeyD", "Ctrl+KeyH", "Ctrl+KeyJ", "Ctrl+KeyK", "F3", "Shift+F3", "F12"]) {
      expect(isBlockedCombo(c, true), `${c} @monaco`).toBe(false);
    }
    for (const c of ["Ctrl+KeyD", "Ctrl+KeyH", "Ctrl+KeyJ", "Ctrl+KeyL", "F3", "Shift+F3", "F12"]) {
      expect(isBlockedCombo(c, false), `${c} @outside`).toBe(true);
    }
  });

  it("应用已认领的组合不吞（动作照旧，只在输入框内补 preventDefault）", () => {
    for (const c of ["F5", "Ctrl+Shift+KeyR", "Ctrl+Shift+KeyP", "Ctrl+KeyS", "Ctrl+KeyG", "Ctrl+Shift+KeyF", "Ctrl+KeyA"]) {
      expect(isBlockedCombo(c, false), `${c} @outside`).toBe(false);
      expect(isBlockedCombo(c, true), `${c} @monaco`).toBe(false);
    }
  });
});
