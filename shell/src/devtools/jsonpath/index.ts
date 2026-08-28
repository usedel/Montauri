// JSONPath 提取器：输入 JSON → 树状展示 → 点击节点显示路径（JSONPath / Python 下标可切换）并可复制。
// 窄面板适配：树占满纵向空间，值预览收在底部可折叠区，避免左右分栏被压扁。

import type { DevTool, ToolHost, ToolInstance } from "../types";
import { codicon } from "../../util";
import { flashError, flashSuccess } from "../feedback";
import { buildJsonTree, toJsonPath, toPythonSubscript, tryParseJson, type JsonNode } from "./tree";

export const jsonpathTool: DevTool = {
  id: "jsonpath",
  title: "JSONPath 提取器",
  description: "JSON 树状浏览，点击节点复制其路径",
  category: "爬虫",
  icon: "json",
  mount(host: ToolHost): ToolInstance {
    return mountJsonPath(host);
  },
};

const SAMPLE = JSON.stringify(
  {
    store: {
      book: [
        { title: "Python 爬虫实战", price: 59.0 },
        { title: "深入浅出爬虫", price: 79.0 },
      ],
      bicycle: { color: "red", price: 299.0 },
    },
  },
  null,
  2,
);

/** 标量值预览文本（长字符串截断） */
function scalarPreview(v: unknown): string {
  if (typeof v === "string") {
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "null";
}

/** 「复制值」的内容：字符串裸值，object/array 序列化，其余字面量 */
function valueText(node: JsonNode): string {
  if (typeof node.value === "string") return node.value;
  if (node.value === null || typeof node.value === "number" || typeof node.value === "boolean") {
    return String(node.value);
  }
  return JSON.stringify(node.value, null, 2);
}

function mountJsonPath(host: ToolHost): ToolInstance {
  const root = host.root;
  root.textContent = "";

  let mode: "jsonpath" | "python" = "jsonpath";
  let selected: JsonNode | null = null;

  const wrap = document.createElement("div");
  wrap.className = "tool-body";

  const input = document.createElement("textarea");
  input.className = "tool-textarea";
  input.placeholder = "粘贴 JSON 文本…";
  input.spellcheck = false;

  const bar = document.createElement("div");
  bar.className = "tool-toolbar";
  const parseBtn = document.createElement("button");
  parseBtn.className = "primary";
  parseBtn.textContent = "解析";
  const sampleBtn = document.createElement("button");
  sampleBtn.textContent = "示例";
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "清空";
  const errEl = document.createElement("div");
  errEl.className = "tool-error";

  // 路径区：只读输入框 + 复制按钮（首行）、格式切换（次行）
  const pathBox = document.createElement("div");
  pathBox.className = "jp-pathbox";

  const pathRow = document.createElement("div");
  pathRow.className = "jp-pathrow";
  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.readOnly = true;
  pathInput.spellcheck = false;
  pathInput.placeholder = "点击树节点显示路径";
  const copyPathBtn = document.createElement("button");
  copyPathBtn.title = "复制路径";
  copyPathBtn.appendChild(codicon("copy"));
  copyPathBtn.append(" 路径");
  const copyValueBtn = document.createElement("button");
  copyValueBtn.title = "复制值";
  copyValueBtn.appendChild(codicon("copy"));
  copyValueBtn.append(" 值");
  pathRow.append(pathInput, copyPathBtn, copyValueBtn);

  const modeRow = document.createElement("div");
  modeRow.className = "jp-moderow";
  const jsonpathModeBtn = document.createElement("button");
  jsonpathModeBtn.textContent = "JSONPath";
  const pyModeBtn = document.createElement("button");
  pyModeBtn.textContent = "Python []";
  modeRow.append(jsonpathModeBtn, pyModeBtn);

  pathBox.append(pathRow, modeRow);

  // 值预览（底部可折叠）
  const valueToggle = document.createElement("button");
  valueToggle.className = "jp-value-toggle";
  const valueCaret = codicon("chevron-down");
  valueToggle.appendChild(valueCaret);
  valueToggle.append(" 值预览");
  const valueBox = document.createElement("div");
  valueBox.className = "jp-value-box";

  const treeBox = document.createElement("div");
  treeBox.className = "jp-tree";

  const valueEditor = host.monaco.editor.create(valueBox, {
    value: "",
    language: "json",
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    scrollBeyondLastLine: false,
    wordWrap: "on",
  });

  const setMode = (m: "jsonpath" | "python"): void => {
    mode = m;
    jsonpathModeBtn.classList.toggle("active", m === "jsonpath");
    pyModeBtn.classList.toggle("active", m === "python");
    updatePathBar();
  };

  const updatePathBar = (): void => {
    pathInput.value = selected ? (mode === "jsonpath" ? toJsonPath(selected) : toPythonSubscript(selected)) : "";
    copyPathBtn.disabled = !selected;
    copyValueBtn.disabled = !selected;
    if (selected) {
      valueEditor.setValue(
        typeof selected.value === "string" ? selected.value : JSON.stringify(selected.value, null, 2),
      );
    } else {
      valueEditor.setValue("");
    }
  };

  const select = (node: JsonNode, rowEl: HTMLElement): void => {
    selected = node;
    treeBox.querySelectorAll<HTMLElement>(".jp-row.selected").forEach((r) => r.classList.remove("selected"));
    rowEl.classList.add("selected");
    updatePathBar();
  };

  const renderNode = (node: JsonNode): HTMLElement => {
    const wrapper = document.createElement("div");
    wrapper.className = "jp-node";
    const row = document.createElement("div");
    row.className = "jp-row";
    wrapper.appendChild(row);

    const hasChildren = !!node.children && node.children.length > 0;
    const toggle = document.createElement("span");
    toggle.className = `jp-toggle${hasChildren ? "" : " hidden"}`;
    toggle.appendChild(codicon("chevron-right"));
    row.appendChild(toggle);

    const key = document.createElement("span");
    key.className = "jp-key";
    key.textContent = node.isIndex
      ? `[${node.segments[node.segments.length - 1]}]`
      : node.key ?? "$";
    row.appendChild(key);

    if (node.type === "object" || node.type === "array") {
      const badge = document.createElement("span");
      badge.className = `jp-badge jp-${node.type}`;
      badge.textContent = node.type === "array" ? `[${node.children?.length ?? 0}]` : `{${node.children?.length ?? 0}}`;
      row.appendChild(badge);
    } else {
      const val = document.createElement("span");
      val.className = `jp-value jp-${node.type}`;
      val.textContent = scalarPreview(node.value);
      row.appendChild(val);
    }

    row.addEventListener("click", () => select(node, row));

    const childrenBox = document.createElement("div");
    childrenBox.className = "jp-children hidden";
    wrapper.appendChild(childrenBox);

    if (hasChildren) {
      let expanded = false;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        expanded = !expanded;
        toggle.classList.toggle("expanded", expanded);
        if (expanded) {
          if (childrenBox.childElementCount === 0) {
            for (const c of node.children ?? []) childrenBox.appendChild(renderNode(c));
          }
          childrenBox.classList.remove("hidden");
        } else {
          childrenBox.classList.add("hidden");
        }
      });
    }

    return wrapper;
  };

  const parse = (): void => {
    const text = input.value.trim();
    if (!text) {
      errEl.textContent = "请先粘贴 JSON 文本";
      flashError(parseBtn, "未输入");
      return;
    }
    const r = tryParseJson(text);
    if (!r.ok) {
      errEl.textContent = `JSON 解析失败：${r.error}`;
      flashError(parseBtn, "解析失败");
      return;
    }
    selected = null;
    treeBox.textContent = "";
    treeBox.appendChild(renderNode(buildJsonTree(r.value)));
    errEl.textContent = "";
    flashSuccess(parseBtn, "已解析");
    updatePathBar();
  };

  parseBtn.addEventListener("click", parse);
  sampleBtn.addEventListener("click", () => {
    input.value = SAMPLE;
    parse();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    selected = null;
    treeBox.textContent = "";
    errEl.textContent = "";
    updatePathBar();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) parse();
  });
  jsonpathModeBtn.addEventListener("click", () => setMode("jsonpath"));
  pyModeBtn.addEventListener("click", () => setMode("python"));
  copyPathBtn.addEventListener("click", () => {
    if (!pathInput.value) return;
    void host.copyToClipboard(pathInput.value).then((ok) => {
      if (ok) flashSuccess(copyPathBtn, "已复制");
      else flashError(copyPathBtn, "复制失败");
    });
  });
  copyValueBtn.addEventListener("click", () => {
    if (!selected) return;
    void host.copyToClipboard(valueText(selected)).then((ok) => {
      if (ok) flashSuccess(copyValueBtn, "已复制");
      else flashError(copyValueBtn, "复制失败");
    });
  });

  // 值预览折叠
  let valueOpen = false;
  const setValueOpen = (open: boolean): void => {
    valueOpen = open;
    valueBox.classList.toggle("hidden", !open);
    valueCaret.classList.toggle("expanded", open);
    if (open) valueEditor.layout();
  };
  valueToggle.addEventListener("click", () => setValueOpen(!valueOpen));
  setValueOpen(false);

  bar.append(parseBtn, sampleBtn, clearBtn);
  wrap.append(input, bar, errEl, pathBox, treeBox, valueToggle, valueBox);
  root.appendChild(wrap);

  copyPathBtn.disabled = true;
  copyValueBtn.disabled = true;
  jsonpathModeBtn.classList.add("active");

  return {
    dispose() {
      valueEditor.dispose();
    },
  };
}