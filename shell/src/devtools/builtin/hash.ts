// MD5 / SHA-256 哈希工具（PR-3 内置插件 · 哈希类）：面板（算法单选 + 大小写开关）+ inline（MD5 选区）。

import type { PanelHost } from "../../extensions/facade";
import { flashError } from "../feedback";
import { md5Hex, sha256Hex } from "./pure";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  let upper = false;
  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入文本…（SHA-256 为异步计算）", flex: true });
  const errEl = kit.errorSlot();

  // 算法互斥选择：单选组（MD5 / SHA-256 二选一）
  const algoGroup = kit.radioGroup<"md5" | "sha256">({
    label: "哈希算法",
    options: [
      { value: "md5", label: "MD5" },
      { value: "sha256", label: "SHA-256" },
    ],
    value: "md5",
  });

  // 大小写：独立开关（非互斥，保持按钮 + aria-pressed）
  const upperBtn = kit.button("大写");
  upperBtn.dataset.tip = "切换输出大小写";
  upperBtn.setAttribute("aria-label", "切换输出大小写");
  const toggleUpper = (): void => {
    upper = !upper;
    upperBtn.classList.toggle("active", upper);
    upperBtn.setAttribute("aria-pressed", String(upper));
  };
  upperBtn.addEventListener("click", toggleUpper);

  const runBtn = kit.primaryButton("计算", "play");
  const run = (): void => {
    const text = input.value;
    if (!text) {
      errEl.textContent = "请先输入内容";
      return;
    }
    try {
      if (algoGroup.get() === "md5") {
        out.set(fmt(md5Hex(text)));
        errEl.textContent = "";
      } else {
        void sha256Hex(text)
          .then((h) => {
            out.set(fmt(h));
            errEl.textContent = "";
          })
          .catch((e) => {
            errEl.textContent = `SHA-256 计算失败：${String(e)}`;
            flashError(runBtn, "失败");
          });
      }
    } catch (e) {
      errEl.textContent = `计算失败：${e instanceof Error ? e.message : String(e)}`;
      flashError(runBtn, "失败");
    }
  };
  runBtn.addEventListener("click", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
  });

  const fmt = (h: string): string => (upper ? h.toUpperCase() : h);

  const out = kit.output({ language: "plaintext", placeholder: "哈希值将显示在这里" });
  wrap.append(
    input,
    kit.toolbar(algoGroup.el, upperBtn, runBtn, "spacer", kit.copyButton(() => out.get())),
    errEl,
    out.el,
  );
  host.root.appendChild(wrap);
  // kit.output 持有 Monaco 实例，须随工具实例释放（对齐 curl2python/jsonpath 先例；R-5 复测发现的泄漏）
  return {
    dispose() {
      out.dispose();
    },
  };
}

/** inline：选区 → MD5（小写 hex） */
export function md5Selection(text: string): string {
  return md5Hex(text);
}
