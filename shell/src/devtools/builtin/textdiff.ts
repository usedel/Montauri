// 文本 Diff 工具（v1.1 · 文本类）：两栏输入 → 行级 LCS diff（+/-/= 前缀渲染）。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { diffLines, formatDiff } from "./textfns";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const aInput = kit.textarea({ placeholder: "原文（A）…" });
  const bInput = kit.textarea({ placeholder: "改文（B）…" });
  const errEl = kit.errorSlot();

  const run = (): void => {
    try {
      out.set(formatDiff(diffLines(aInput.value, bInput.value)));
      errEl.textContent = "";
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : String(e);
      flashError(runBtn, "失败");
    }
  };
  const runBtn = kit.primaryButton("对比", "diff", run);

  const out = kit.output({ language: "plaintext", placeholder: "差异将显示在这里（+ 新增 / - 删除）" });
  wrap.append(
    kit.row(aInput, bInput),
    kit.toolbar(runBtn, "spacer", kit.copyButton(() => out.get())),
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
