// Unicode ⇄ 明文工具（v1.1 · 转换类）：明文 → \uXXXX 转义 / 转义 → 明文。
// escape 形态对齐 Python repr（BMP 外拆代理对）；unescape 兼容 \uXXXX / 代理对 / \UXXXXXXXX / \u{...}。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { unicodeEscape, unicodeUnescape } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入明文（转义）或 \\uXXXX 串（还原）…", flex: true });
  const errEl = kit.errorSlot();

  const dirGroup = kit.radioGroup<"escape" | "unescape">({
    label: "转换方向",
    options: [
      { value: "escape", label: "转义" },
      { value: "unescape", label: "还原" },
    ],
    value: "escape",
  });

  const run = (): void => {
    const text = input.value;
    if (!text.trim()) {
      errEl.textContent = "请先输入内容";
      return;
    }
    try {
      out.set(dirGroup.get() === "escape" ? unicodeEscape(text) : unicodeUnescape(text));
      errEl.textContent = "";
    } catch (e) {
      errEl.textContent = `转换失败：${e instanceof Error ? e.message : String(e)}`;
      flashError(runBtn, "失败");
    }
  };

  const runBtn = kit.primaryButton("转换", "play", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
  });

  const out = kit.output({ language: "plaintext", placeholder: "结果将显示在这里" });
  wrap.append(
    input,
    kit.toolbar(dirGroup.el, runBtn, "spacer", kit.copyButton(() => out.get())),
    errEl,
    out.el,
  );
  host.root.appendChild(wrap);
  return {
    dispose() {
      out.dispose();
    },
  };
}

/** inline：选区 Unicode 转义 → 明文 */
export function unescapeSelection(text: string): string {
  return unicodeUnescape(text);
}
