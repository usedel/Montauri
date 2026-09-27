// cURL ⇄ Python 工具（PR-3 迁移为内置插件形态；P1 §7-5 扩为双向）：
// 输入 curl 命令 → requests 代码（curl2python/ 纯函数）；
// 输入 Python requests/httpx 代码 → cURL 命令（python2curl.gen.ts 纯函数，v1.1 补的反向）。
// 方向选择用 kit.radioGroup（互斥单选组，与 base64 的方向选择同一范式）。

import type { PanelHost } from "../../extensions/facade";
import { flashError, flashSuccess } from "../feedback";
import { generatePython } from "../curl2python/gen";
import { parseCurl } from "../curl2python/parse";
import { pythonToCurl } from "./python2curl.gen";

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "粘贴 curl 命令（可从浏览器「复制为 cURL」）…" });
  const errEl = kit.errorSlot();

  const dir = kit.radioGroup<"c2p" | "p2c">({
    label: "转换方向",
    options: [
      { value: "c2p", label: "cURL → Python" },
      { value: "p2c", label: "Python → cURL" },
    ],
    value: "c2p",
    onChange: (v) => {
      input.placeholder = v === "c2p"
        ? "粘贴 curl 命令（可从浏览器「复制为 cURL」）…"
        : "粘贴 Python requests / httpx 代码…";
    },
  });

  const convertBtn = kit.primaryButton("转换", "play");
  const convert = (): void => {
    const text = input.value.trim();
    if (!text) {
      errEl.textContent = "请先输入内容";
      flashError(convertBtn, "未输入");
      return;
    }
    try {
      if (dir.get() === "c2p") {
        const cmd = parseCurl(text);
        if (!cmd.url) {
          errEl.textContent = "未在命令中识别到 URL";
          flashError(convertBtn, "识别失败");
          return;
        }
        out.set(generatePython(cmd));
      } else {
        out.set(pythonToCurl(text));
      }
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

  const out = kit.output({ language: "shell", placeholder: "# 输入内容后点击「转换」" });
  const insertBtn = kit.button("插入编辑器", "export");
  insertBtn.dataset.tip = "插入到当前编辑器";
  insertBtn.addEventListener("click", () => {
    const ok = host.insertToEditor(out.get());
    if (ok) flashSuccess(insertBtn, "已插入");
    else flashError(insertBtn, "无打开文件");
  });

  wrap.append(
    input,
    kit.toolbar(dir.el, convertBtn, pasteBtn, "spacer", kit.copyButton(() => out.get()), insertBtn),
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
