// 行排序去重工具（v1.1 · 文本类）：升/降/倒置/洗牌 × 去重 / 忽略大小写 / 去空行。

import type { PanelHost } from "../../extensions/facade";
import { sortLines, type SortMode } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "每行一项…", flex: true });

  // 模式（互斥单选组）
  const modeGroup = kit.radioGroup<SortMode>({
    label: "排序模式",
    options: [
      { value: "asc", label: "升序" },
      { value: "desc", label: "降序" },
      { value: "reverse", label: "倒置" },
      { value: "shuffle", label: "洗牌" },
    ],
    value: "asc",
  });

  // 独立开关（toggle 按钮 + aria-pressed 同源切换——UI 约定：独立开关不用 radioGroup）
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
  const dedupeBtn = mkToggle("去重", false);
  const caseBtn = mkToggle("忽略大小写", false);
  const emptyBtn = mkToggle("保留空行", true);

  const run = (): void => {
    const result = sortLines(input.value, modeGroup.get(), {
      dedupe: dedupeBtn.getAttribute("aria-pressed") === "true",
      caseSensitive: caseBtn.getAttribute("aria-pressed") !== "true",
      keepEmpty: emptyBtn.getAttribute("aria-pressed") === "true",
    });
    out.set(result);
  };
  const runBtn = kit.primaryButton("运行", "sort-precedence", run);

  const out = kit.output({ language: "plaintext", placeholder: "结果将显示在这里" });
  wrap.append(
    input,
    kit.toolbar(modeGroup.el, "spacer", dedupeBtn, caseBtn, emptyBtn),
    kit.toolbar(runBtn, "spacer", kit.copyButton(() => out.get())),
    out.el,
  );
  host.root.appendChild(wrap);
  return {
    dispose() {
      out.dispose();
    },
  };
}
