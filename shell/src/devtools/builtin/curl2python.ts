// cURL → Python 工具（PR-3 迁移为内置插件形态）：输入 curl 命令 → requests 代码。
// 原实现见 devtools/curl2python/（parse/gen 纯函数保留原位，此处仅迁移 UI 壳）。

import type { PanelHost } from "../../extensions/facade";
import { flashError, flashSuccess } from "../feedback";
import { generatePython } from "../curl2python/gen";
import { parseCurl } from "../curl2python/parse";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "粘贴 curl 命令（可从浏览器「复制为 cURL」）…" });
  const errEl = kit.errorSlot();

  const convertBtn = kit.primaryButton("转换", "play");
  const convert = (): void => {
    const text = input.value.trim();
    if (!text) {
      errEl.textContent = "请先粘贴 curl 命令";
      flashError(convertBtn, "未输入");
      return;
    }
    try {
      const cmd = parseCurl(text);
      if (!cmd.url) {
        errEl.textContent = "未在命令中识别到 URL";
        flashError(convertBtn, "识别失败");
        return;
      }
      out.set(generatePython(cmd));
      errEl.textContent = "";
      flashSuccess(convertBtn, "已转换");
    } catch (e) {
      errEl.textContent = `转换失败：${e instanceof Error ? e.message : String(e)}`;
      flashError(convertBtn, "转换失败");
    }
  };
  convertBtn.addEventListener("click", convert);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) convert();
  });

  // 从剪贴板粘贴并立即转换
  const pasteBtn = kit.button("粘贴", "clippy");
  pasteBtn.addEventListener("click", () => {
    void host.readClipboard().then((text) => {
      if (text !== null && text !== "") {
        input.value = text;
        convert();
      } else {
        errEl.textContent = "剪贴板为空或读取失败";
        flashError(pasteBtn, "无内容");
      }
    });
  });

  const out = kit.output({ language: "python", placeholder: "# 粘贴 curl 命令后点击「转换」生成 Python requests 代码" });
  const insertBtn = kit.button("插入编辑器", "export");
  insertBtn.dataset.tip = "插入到当前编辑器";
  insertBtn.addEventListener("click", () => {
    const ok = host.insertToEditor(out.get());
    if (ok) flashSuccess(insertBtn, "已插入");
    else flashError(insertBtn, "无打开文件");
  });

  wrap.append(
    input,
    kit.toolbar(convertBtn, pasteBtn, "spacer", kit.copyButton(() => out.get()), insertBtn),
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
