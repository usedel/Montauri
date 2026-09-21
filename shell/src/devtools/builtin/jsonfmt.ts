// JSON 美化/压缩工具（PR-3 内置插件 · 格式化类）：可编辑 Monaco 输入 + 只读输出，缩进单选。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.output({ language: "json", readOnly: false, placeholder: "粘贴 JSON 文本…" });
  const errEl = kit.errorSlot();

  // 缩进互斥选择：单选组（2 / 4 空格二选一）
  const indentGroup = kit.radioGroup<"2" | "4">({
    label: "缩进宽度",
    options: [
      { value: "2", label: "2 空格" },
      { value: "4", label: "4 空格" },
    ],
    value: "2",
  });

  const runBtn = kit.primaryButton("格式化", "check", () => run("beautify"));
  const minifyBtn = kit.button("压缩", "collapse-all", () => run("minify"));

  const run = (mode: "beautify" | "minify"): void => {
    const text = input.get().trim();
    if (!text) {
      errEl.textContent = "请先粘贴 JSON";
      return;
    }
    try {
      const v = JSON.parse(text);
      out.set(mode === "beautify" ? JSON.stringify(v, null, Number(indentGroup.get())) : JSON.stringify(v));
      errEl.textContent = "";
    } catch (e) {
      errEl.textContent = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`;
      flashError(runBtn, "失败");
    }
  };

  const out = kit.output({ language: "json", placeholder: "结果将显示在这里" });
  wrap.append(
    input.el,
    kit.toolbar(indentGroup.el, runBtn, minifyBtn, "spacer", kit.copyButton(() => out.get())),
    errEl,
    out.el,
  );
  host.root.appendChild(wrap);
}
