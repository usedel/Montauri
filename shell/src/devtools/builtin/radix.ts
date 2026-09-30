// 进制转换工具（v1.1 · 转换类）：智能识别输入进制 → 四进制全景展示。
// BigInt 实现（超 Number.MAX_SAFE_INTEGER 精度无损）。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { radixAllFormats } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.input({ placeholder: "如 255 / 0xff / 0b1010 / 0o17（下划线分隔可选）", onEnter: () => run() });
  input.classList.add("radix-input");
  const runBtn = kit.primaryButton("转换", "symbol-numeric", () => run());
  const errEl = kit.errorSlot();

  const mkRow = (label: string, prefix: string): { row: HTMLElement; out: HTMLInputElement } => {
    const lab = document.createElement("span");
    lab.className = "tool-label";
    lab.textContent = label;
    const out = kit.input({ readOnly: true, placeholder: "—" });
    out.classList.add("radix-out");
    // 前缀徽标（bin/oct/hex 结果的可读性）
    const pre = document.createElement("span");
    pre.className = "tool-label";
    pre.textContent = prefix;
    pre.hidden = prefix === "";
    return { row: kit.row(lab, pre, out), out };
  };
  const binRow = mkRow("二进制：", "0b");
  const octRow = mkRow("八进制：", "0o");
  const decRow = mkRow("十进制：", "");
  const hexRow = mkRow("十六进制：", "0x");

  const run = (): void => {
    const r = radixAllFormats(input.value);
    if (r === null) {
      errEl.textContent = "无法识别的数字（支持 0x/0b/0o 前缀与十进制）";
      binRow.out.value = octRow.out.value = decRow.out.value = hexRow.out.value = "";
      flashError(runBtn, "失败");
      return;
    }
    errEl.textContent = "";
    binRow.out.value = r.bin;
    octRow.out.value = r.oct;
    decRow.out.value = r.dec;
    hexRow.out.value = r.hex;
  };

  wrap.append(
    kit.row(input, runBtn),
    errEl,
    binRow.row,
    octRow.row,
    decRow.row,
    hexRow.row,
  );
  host.root.appendChild(wrap);
}

/** inline：选区数字 → 0x 十六进制 */
export { selectionToHex as toHexSelection } from "./textfns";
