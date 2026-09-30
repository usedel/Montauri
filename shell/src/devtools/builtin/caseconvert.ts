// 大小写/命名风格转换工具（v1.1 · 文本类）：upper / lower / title / snake / camel 五模式。

import type { PanelHost } from "../../extensions/facade";
import { transformCase, type CaseMode } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入文本…", flex: true });

  const modeGroup = kit.radioGroup<CaseMode>({
    label: "转换模式",
    options: [
      { value: "upper", label: "大写" },
      { value: "lower", label: "小写" },
      { value: "title", label: "标题" },
      { value: "snake", label: "snake_case" },
      { value: "camel", label: "camelCase" },
    ],
    value: "upper",
  });

  const run = (): void => {
    out.set(transformCase(input.value, modeGroup.get()));
  };
  const runBtn = kit.primaryButton("转换", "case-sensitive", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
  });

  const out = kit.output({ language: "plaintext", placeholder: "结果将显示在这里" });
  wrap.append(
    input,
    kit.toolbar(modeGroup.el, runBtn, "spacer", kit.copyButton(() => out.get())),
    out.el,
  );
  host.root.appendChild(wrap);
  return {
    dispose() {
      out.dispose();
    },
  };
}

/** inline：选区 → 大写（其余模式请用面板） */
export function upperSelection(text: string): string {
  return transformCase(text, "upper");
}
