// 颜色转换工具（v1.1 · 转换类）：Hex ⇄ RGB ⇄ HSL + ANSI 256 色号 + 色卡预览。
// 输入驱动的多向展示：一个 Hex 输入框 → RGB / HSL / ANSI 全景 + 色卡。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { hexToRgbAlias, hslToRgb, rgbToAnsi256, rgbToHex, rgbToHsl } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const errEl = kit.errorSlot();

  // 色卡（纯 CSS 尺寸，背景随解析结果更新）
  const swatch = document.createElement("div");
  swatch.className = "color-swatch";
  swatch.setAttribute("role", "img");
  swatch.setAttribute("aria-label", "颜色预览");

  // Hex 输入 → 全景
  const hexLabel = document.createElement("span");
  hexLabel.className = "tool-label";
  hexLabel.textContent = "Hex（#rgb / #rrggbb / #rrggbbaa）：";
  const hexInput = kit.input({ placeholder: "#FF8000", onEnter: () => refresh(), onInput: () => refresh() });
  const parseBtn = kit.primaryButton("解析", "color-mode", () => refresh());

  const mkOut = (label: string): { row: HTMLElement; out: HTMLInputElement } => {
    const lab = document.createElement("span");
    lab.className = "tool-label";
    lab.textContent = label;
    const out = kit.input({ readOnly: true, placeholder: "—" });
    out.classList.add("color-out");
    return { row: kit.row(lab, out), out };
  };
  const rgbRow = mkOut("RGB：");
  const hslRow = mkOut("HSL：");
  const ansiRow = mkOut("ANSI 256：");

  // HSL → 逆推（调试配色回路）
  const hslLabel = document.createElement("span");
  hslLabel.className = "tool-label";
  hslLabel.textContent = "HSL 逆推（h,s,l）：";
  const hslInput = kit.input({ placeholder: "210, 90, 55", onEnter: () => hslBack() });

  const refresh = (): void => {
    const rgb = hexToRgbAlias(hexInput.value);
    if (rgb === null) {
      if (!hexInput.value.trim()) {
        errEl.textContent = "";
        return; // 清空态不报错
      }
      errEl.textContent = "无法识别的颜色（形如 #f80 / #ff8000 / #ff8000cc）";
      flashError(parseBtn, "失败");
      return;
    }
    errEl.textContent = "";
    const [r, g, b] = rgb;
    const hsl = rgbToHsl(r, g, b);
    rgbRow.out.value = `rgb(${r}, ${g}, ${b})`;
    hslRow.out.value = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    ansiRow.out.value = String(rgbToAnsi256(r, g, b));
    swatch.style.background = rgbToHex(r, g, b);
  };

  const hslBack = (): void => {
    const parts = hslInput.value.split(/[,\s]+/).map(Number);
    if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
      errEl.textContent = "HSL 逆推格式：h, s, l（如 210, 90, 55）";
      return;
    }
    const [r, g, b] = hslToRgb(parts[0]!, parts[1]!, parts[2]!);
    errEl.textContent = "";
    hexInput.value = rgbToHex(r, g, b);
    refresh();
  };

  wrap.append(
    kit.row(swatch, hexLabel, hexInput, parseBtn),
    errEl,
    rgbRow.row,
    hslRow.row,
    ansiRow.row,
    kit.row(hslLabel, hslInput),
  );
  host.root.appendChild(wrap);
}
