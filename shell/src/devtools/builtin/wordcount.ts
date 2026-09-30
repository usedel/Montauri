// 字数统计工具（v1.1 · 文本类）：字符（含/不含空白）/ 词 / CJK 字数 / 行数实时统计。

import type { PanelHost } from "../../extensions/facade";
import { textStats } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({
    placeholder: "输入或粘贴文本，统计实时更新…",
    flex: true,
    onInput: () => refresh(),
  });

  // 统计行工厂：标签 + 只读值
  const mkStat = (label: string): { row: HTMLElement; out: HTMLInputElement } => {
    const lab = document.createElement("span");
    lab.className = "tool-label";
    lab.textContent = label;
    const out = kit.input({ readOnly: true, placeholder: "0" });
    out.classList.add("wc-out");
    return { row: kit.row(lab, out), out };
  };
  const chars = mkStat("字符数（含空白）：");
  const noSpace = mkStat("字符数（不含空白）：");
  const words = mkStat("词数：");
  const cjk = mkStat("CJK 字数：");
  const lines = mkStat("行数：");

  const refresh = (): void => {
    const s = textStats(input.value);
    chars.out.value = String(s.chars);
    noSpace.out.value = String(s.charsNoSpace);
    words.out.value = String(s.words);
    cjk.out.value = String(s.cjk);
    lines.out.value = String(s.lines);
  };

  wrap.append(input, chars.row, noSpace.row, words.row, cjk.row, lines.row);
  host.root.appendChild(wrap);
}
