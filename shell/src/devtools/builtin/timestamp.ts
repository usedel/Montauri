// 时间戳转换工具（PR-3 内置插件 · 转换类）：时间戳 → 可读时间 + 当前时间戳 + 反向解析。
// 布局：标签行用 .tool-label（通用类）；窄面板下可换行；复制按钮贴着结果（就近原则）。

import type { PanelHost } from "../../extensions/facade";
import { nowUnixSeconds, timestampToReadable } from "./pure";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();

  // 当前时间戳（自动刷新 1s）
  const nowLabel = document.createElement("span");
  nowLabel.className = "tool-label";
  nowLabel.textContent = "当前 Unix 时间戳：";
  const nowOut = kit.input({ readOnly: true });
  nowOut.classList.add("ts-now");
  const copyNowBtn = kit.button("复制", "copy");
  const nowRow = kit.row(nowLabel, nowOut, copyNowBtn);
  const timer = window.setInterval(() => (nowOut.value = nowUnixSeconds()), 1000);
  nowOut.value = nowUnixSeconds();
  copyNowBtn.addEventListener("click", () => void host.copyToClipboard(nowOut.value));

  // 时间戳 → 可读
  const inLabel = document.createElement("span");
  inLabel.className = "tool-label";
  inLabel.textContent = "时间戳（秒/毫秒自动识别）：";
  const tsInput = kit.input({ placeholder: "如 1760985600", onEnter: () => conv() });
  tsInput.classList.add("ts-input");
  const convBtn = kit.primaryButton("转换", "watch", () => conv());
  const errEl = kit.errorSlot();
  const conv = (): void => {
    const r = timestampToReadable(tsInput.value);
    if (r === null) {
      errEl.textContent = "无法识别的时间戳（应为 10 位秒或 13 位毫秒数字）";
      readableOut.value = "";
    } else {
      errEl.textContent = "";
      readableOut.value = r;
    }
  };

  // 结果行：只读框占满 + 复制按钮贴右（结果在哪复制按钮就在哪）
  const readableOut = kit.input({ readOnly: true, placeholder: "可读时间" });
  const resultRow = kit.row(readableOut, kit.copyButton(() => readableOut.value));

  wrap.append(
    nowRow,
    kit.row(inLabel, tsInput, convBtn),
    resultRow,
    errEl,
  );
  host.root.appendChild(wrap);

  return {
    dispose() {
      window.clearInterval(timer);
    },
  };
}

/** inline：选区时间戳 → 可读时间（原地替换） */
export function tsToReadable(text: string): string {
  const r = timestampToReadable(text);
  if (r === null) throw new Error("选区不是有效的时间戳（10 位秒 / 13 位毫秒）");
  return r;
}
