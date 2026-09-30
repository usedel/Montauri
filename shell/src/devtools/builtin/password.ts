// 密码生成工具（v1.1 · 生成类）：长度 + 四类字符集开关 + 排除易混字符；crypto 随机源。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { generatePassword } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const errEl = kit.errorSlot();

  // 长度（数字输入）
  const lenLabel = document.createElement("span");
  lenLabel.className = "tool-label";
  lenLabel.textContent = "长度（4-256）：";
  const lenInput = kit.input({ type: "number", placeholder: "16" });
  lenInput.classList.add("pw-len");
  lenInput.value = "16";
  lenInput.min = "4";
  lenInput.max = "256";

  // 字符集开关（独立 toggle；对齐 sortlines 的 aria-pressed 范式）
  const mkToggle = (label: string, on: boolean): HTMLButtonElement => {
    const btn = kit.button(label);
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(next));
      btn.classList.toggle("active", next);
    });
    return btn;
  };
  const lowerBtn = mkToggle("小写 a-z", true);
  const upperBtn = mkToggle("大写 A-Z", true);
  const digitsBtn = mkToggle("数字 0-9", true);
  const symbolsBtn = mkToggle("符号 !@#", false);
  const similarBtn = mkToggle("排除易混字符", false);

  const out = kit.input({ readOnly: true, placeholder: "点击「生成」…" });
  out.classList.add("pw-out");
  out.setAttribute("aria-label", "生成的密码");

  const gen = (): void => {
    try {
      out.value = generatePassword({
        length: Number(lenInput.value) || 16,
        lower: lowerBtn.getAttribute("aria-pressed") === "true",
        upper: upperBtn.getAttribute("aria-pressed") === "true",
        digits: digitsBtn.getAttribute("aria-pressed") === "true",
        symbols: symbolsBtn.getAttribute("aria-pressed") === "true",
        excludeSimilar: similarBtn.getAttribute("aria-pressed") === "true",
      });
      errEl.textContent = "";
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : String(e);
      flashError(genBtn, "失败");
    }
  };
  const genBtn = kit.primaryButton("生成", "key", gen);
  lenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") gen();
  });

  wrap.append(
    kit.row(lenLabel, lenInput, genBtn),
    kit.toolbar(lowerBtn, upperBtn, digitsBtn, symbolsBtn, similarBtn),
    errEl,
    kit.row(out, kit.copyButton(() => out.value)),
  );
  host.root.appendChild(wrap);
}
