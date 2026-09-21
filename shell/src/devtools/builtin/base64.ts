// Base64 编码/解码工具（PR-3 内置插件 · 编码类）：面板（双向互转）+ inline（编码选区）。
// 方向选择用 kit.radioGroup（互斥单选组）——比两个 .active 按钮更明确「二选一」语义。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { base64Decode, base64Encode } from "./pure";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入文本（编码）或 Base64（解码）…", flex: true });
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
      out.set(dirGroup.get() === "encode" ? base64Encode(text) : base64Decode(text));
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
}

/** inline：选区文本 → Base64（编码方向；解码请用面板） */
export function encodeSelection(text: string): string {
  return base64Encode(text);
}
