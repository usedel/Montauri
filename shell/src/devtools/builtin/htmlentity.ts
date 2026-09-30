// HTML 实体编码/解码工具（v1.1 · 编码类）：双向互转 + inline 编码。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { htmlDecode, htmlEncode } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入文本（编码）或 HTML 实体（解码）…", flex: true });
  const errEl = kit.errorSlot();

  const dirGroup = kit.radioGroup<"encode" | "decode">({
    label: "转换方向",
    options: [
      { value: "encode", label: "编码" },
      { value: "decode", label: "解码" },
    ],
    value: "encode",
  });

  const run = (): void => {
    const text = input.value;
    if (!text.trim()) {
      errEl.textContent = "请先输入内容";
      return;
    }
    try {
      out.set(dirGroup.get() === "encode" ? htmlEncode(text) : htmlDecode(text));
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

/** inline：选区 → HTML 实体编码 */
export function encodeSelection(text: string): string {
  return htmlEncode(text);
}
