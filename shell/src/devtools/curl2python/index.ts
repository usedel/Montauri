// cURL → Python 工具：输入 curl 命令，转换为 requests 代码（只读 Monaco 预览 + 复制/插入编辑器）。

import type { DevTool, ToolHost, ToolInstance } from "../types";
import { codicon } from "../../util";
import { flashError, flashSuccess } from "../feedback";
import { generatePython } from "./gen";
import { parseCurl } from "./parse";
import { motionDisabled } from "../../anim"; // UI-11：只读预览的光标闪烁也随「减少动画」
import { app } from "../../state"; // UI-29：字号/字体族跟随用户设置

export const curl2pythonTool: DevTool = {
  id: "curl2python",
  title: "cURL 转 Python",
  description: "把 curl 命令转换为 requests 代码",
  category: "爬虫",
  icon: "terminal",
  mount(host: ToolHost): ToolInstance {
    return mountCurl2Python(host);
  },
};

function mountCurl2Python(host: ToolHost): ToolInstance {
  const root = host.root;
  root.textContent = "";

  const wrap = document.createElement("div");
  wrap.className = "tool-body";

  const input = document.createElement("textarea");
  input.className = "tool-textarea";
  input.placeholder = "粘贴 curl 命令（可从浏览器「复制为 cURL」）…";
  input.spellcheck = false;
  input.addEventListener("input", () => {
    errEl.textContent = "";
  });

  const bar = document.createElement("div");
  bar.className = "tool-toolbar";

  // UI-08：全部按钮走通用 .btn 体系（flash 反馈依赖 .btn.flash-ok/.flash-error，缺 .btn 会失去样式）
  const convertBtn = document.createElement("button");
  convertBtn.className = "btn btn--primary";
  convertBtn.textContent = "转换";

  const pasteBtn = document.createElement("button");
  pasteBtn.className = "btn";
  pasteBtn.appendChild(codicon("clippy"));
  pasteBtn.append("从剪贴板粘贴"); // 图标与文字的间距由 .btn 的 gap 提供，不再靠前导空格

  const spacer = document.createElement("span");
  spacer.className = "spacer";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn";
  // UI-09：两按钮均有可见文本作可访问名称，且从不被 disabled，直接迁 data-tip
  copyBtn.dataset.tip = "复制生成的代码";
  copyBtn.appendChild(codicon("copy"));
  copyBtn.append("复制");

  const insertBtn = document.createElement("button");
  insertBtn.className = "btn";
  insertBtn.dataset.tip = "插入到当前编辑器";
  insertBtn.appendChild(codicon("export"));
  insertBtn.append("插入编辑器");

  const errEl = document.createElement("div");
  errEl.className = "tool-error";

  const out = document.createElement("div");
  out.className = "tool-output";

  // UI-29：字号/字体族读用户设置（原硬编码 fontSize:12）。与 UI-11 同一裁决：
  // 实例随工具挂载新建、卸载即销毁，创建时读一次即可；重新挂载自然拿到新值。
  const fontFamily = app.settings.font_family.trim();
  const editor = host.monaco.editor.create(out, {
    value: "# 粘贴 curl 命令后点击「转换」生成 Python requests 代码\n",
    language: "python",
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: app.settings.font_size,
    ...(fontFamily ? { fontFamily } : {}),
    scrollBeyondLastLine: false,
    wordWrap: "on",
    // UI-11：实例随工具挂载新建、卸载即销毁，故创建时读一次开关即可，无需运行时接线
    cursorBlinking: motionDisabled() ? "solid" : "blink",
  });

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
      editor.setValue(generatePython(cmd));
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
  pasteBtn.addEventListener("click", () => {
    void invokeReadClipboard()
      .then((text) => {
        if (text !== null) {
          input.value = text;
          convert();
        }
      })
      .catch(() => {
        errEl.textContent = "读取剪贴板失败，请手动粘贴";
      });
  });
  copyBtn.addEventListener("click", () => {
    void host.copyToClipboard(editor.getValue()).then((ok) => {
      if (ok) flashSuccess(copyBtn, "已复制");
      else flashError(copyBtn, "复制失败");
    });
  });
  insertBtn.addEventListener("click", () => {
    const ok = host.insertToEditor(editor.getValue());
    if (ok) flashSuccess(insertBtn, "已插入");
    else flashError(insertBtn, "无打开文件");
  });

  bar.append(convertBtn, pasteBtn, spacer, copyBtn, insertBtn);
  wrap.append(input, bar, errEl, out);
  root.appendChild(wrap);

  return {
    dispose() {
      editor.dispose();
    },
  };
}

/** 读取剪贴板文本（复用 Rust 侧 clipboard 插件命令；失败返回 null） */
async function invokeReadClipboard(): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const v = await invoke<string | null>("plugin:clipboard-manager|read_text");
    return v ?? null;
  } catch {
    return null;
  }
}