// 脚本参数表单（库特别支持 PR-4，docs/python_library_support_dev_plan.md §6 + research §11.5）。
// 运行面板内嵌（D-3 裁决，不新增侧栏视图）：静态解析（ast_argparse kind）→ 表单 → 命令行拼装；
// 手工编辑命令行 → 尽力回填，inconsistent 标注「以命令行为准」，绝不静默覆盖（§11.5 纪律）。
// 三态：无参数 / 成功 / 解析失败退化纯输入框——都不阻止运行。

import { invoke } from "@tauri-apps/api/core";
import { $, app } from "./state";
import { openConfirm } from "./dialog";
import { evalKind } from "./libEval";
import {
  backfillFromCommandLine,
  buildCommandLine,
  missingRequired,
  toFormModel,
  type AstArgsData,
  type FormValue,
  type ScriptParam,
} from "./scriptArgs";

const container = $("run-config-args-form") as HTMLElement;
const INTROSPECT_TIP = "将执行脚本顶层代码以获取默认值（有副作用）";

// ---------- 模块状态（面板每次打开重渲染） ----------
let params: ScriptParam[] = [];
let values: Record<string, FormValue> = {};
let rendering = false; // 回填写控件时抑制 input 循环
let scriptPath: string | null = null;

/**
 * 渲染脚本参数区（运行面板打开 / 分区切换时调用）。
 * @param path 脚本分区目标文件（null = 非脚本分区，清空区域）
 */
export async function renderScriptArgs(path: string | null, argsInput: HTMLInputElement): Promise<void> {
  scriptPath = path;
  container.textContent = "";
  container.classList.add("hidden");
  params = [];
  values = {};
  if (!path) return;
  if (!argsInput.dataset.raWired) {
    argsInput.dataset.raWired = "1";
    argsInput.addEventListener("input", () => void onArgsEdited(argsInput));
  }

  let data: AstArgsData | null = null;
  let failed = false;
  try {
    const code = await invoke<string>("read_file", { path });
    const res = await evalKind<AstArgsData>("ast_argparse", { code }, { workspaceRoot: app.workspaceRoot ?? "" });
    if (res.state === "ok") data = res.data ?? null;
    else failed = true;
  } catch {
    failed = true;
  }

  // 本次渲染期间面板已切走（scriptPath 变了）→ 丢弃
  if (scriptPath !== path) return;

  params = toFormModel(data);
  container.classList.remove("hidden");
  if (failed) {
    renderNote("⚠ 未能解析参数声明（可在下方直接输入命令行参数）", "rx-status--degraded");
    return; // 三态 ③：退化纯输入框，不阻止运行
  }
  if (params.length === 0) {
    renderNote("此脚本未声明命令行参数（可直接在下方输入）", "rx-status--idle");
    return; // 三态 ①：空态
  }
  renderRows(argsInput);
}

function renderNote(text: string, cls: string): void {
  const note = document.createElement("div");
  note.className = `rx-status ${cls}`;
  note.id = "ra-note";
  note.textContent = text;
  container.appendChild(note);
}

/** 类型 → 控件映射（§11.5）：choices→下拉 · bool→勾选 · int/float→数字框 · 其余→文本框 */
function renderRows(argsInput: HTMLInputElement, introspected = false): void {
  container.textContent = "";
  const head = document.createElement("div");
  head.className = "ra-head";
  head.id = "ra-head";
  const info = document.createElement("span");
  info.className = "rx-flags-summary";
  info.textContent = `由源码解析（${params.length} 项）${introspected ? " · 内省已合并默认值" : ""}`;
  head.appendChild(info);
  const introBtn = document.createElement("button");
  introBtn.type = "button";
  introBtn.className = "btn ra-introspect";
  introBtn.id = "ra-introspect";
  introBtn.textContent = "内省";
  introBtn.dataset.tip = INTROSPECT_TIP;
  introBtn.setAttribute("aria-label", INTROSPECT_TIP);
  introBtn.addEventListener("click", () => void runIntrospect(argsInput));
  head.appendChild(introBtn);
  container.appendChild(head);

  for (const p of params) {
    container.appendChild(renderRow(p, argsInput));
  }
  const syncNote = document.createElement("div");
  syncNote.className = "rx-status rx-status--idle hidden";
  syncNote.id = "ra-sync-note";
  container.appendChild(syncNote);
}

function renderRow(p: ScriptParam, argsInput: HTMLInputElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "ra-row";
  row.dataset.name = p.name;
  const label = document.createElement("label");
  label.className = "ra-label";
  label.textContent = p.name;
  label.htmlFor = `ra-${p.name}`;
  if (p.help) {
    row.dataset.tip = p.help;
    label.title = p.help;
  }
  row.appendChild(label);

  const cur = values[p.name];
  let control: HTMLInputElement | HTMLSelectElement;
  if (p.type === "bool") {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = `ra-${p.name}`;
    cb.className = "ra-check";
    cb.checked = cur === true;
    cb.addEventListener("change", () => {
      values[p.name] = cb.checked;
      applyToArgs(argsInput);
    });
    control = cb;
  } else if (p.choices) {
    const sel = document.createElement("select");
    sel.id = `ra-${p.name}`;
    sel.className = "ra-select";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = p.default != null ? String(p.default) : "（未选择）";
    sel.appendChild(empty);
    for (const c of p.choices) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
    sel.value = typeof cur === "string" && cur ? cur : "";
    sel.addEventListener("change", () => {
      values[p.name] = sel.value;
      applyToArgs(argsInput);
    });
    control = sel;
  } else {
    const input = document.createElement("input");
    input.type = p.type === "int" || p.type === "float" ? "number" : "text";
    input.id = `ra-${p.name}`;
    if (p.type === "float") input.step = "any";
    input.className = "ra-input";
    // default 作占位符（不是值，§11.5：避免默认值被当成显式输入提交）
    input.placeholder = p.default != null ? String(p.default) : "";
    if (typeof cur === "string") input.value = cur;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      values[p.name] = input.value;
      applyToArgs(argsInput);
    });
    control = input;
  }
  row.appendChild(control);

  const tag = document.createElement("span");
  tag.className = "rx-flags-summary";
  tag.textContent = p.type === "bool" ? "bool" : p.type + (p.required ? "  * 必填" : "");
  row.appendChild(tag);
  return row;
}

/** 表单 → 命令行（覆盖 args 输入框；required 缺参给内联提示但不阻止运行） */
function applyToArgs(argsInput: HTMLInputElement): void {
  rendering = true;
  argsInput.value = buildCommandLine(params, values);
  rendering = false;
  const syncNote = document.getElementById("ra-sync-note");
  if (syncNote) {
    syncNote.classList.add("hidden");
    syncNote.textContent = "";
  }
  const missing = missingRequired(params, values);
  const head = document.getElementById("ra-head");
  if (head) {
    let req = document.getElementById("ra-required-note");
    if (missing.length > 0) {
      if (!req) {
        req = document.createElement("span");
        req.id = "ra-required-note";
        req.className = "rx-status--err";
        head.appendChild(req);
      }
      req.textContent = ` 缺少必填：${missing.join("、")}`;
      req.classList.remove("hidden");
    } else if (req) {
      req.classList.add("hidden");
    }
  }
}

/** 命令行被手工编辑 → 尽力回填；inconsistent 标注「以命令行为准」（绝不覆盖表单） */
async function onArgsEdited(argsInput: HTMLInputElement): Promise<void> {
  if (rendering || params.length === 0) return;
  const r = backfillFromCommandLine(params, argsInput.value);
  const syncNote = document.getElementById("ra-sync-note");
  if (r.inconsistent || r.values === null) {
    if (syncNote) {
      syncNote.textContent = "⚠ 表单与命令行不一致，以命令行为准";
      syncNote.classList.remove("hidden");
    }
    return;
  }
  if (syncNote) syncNote.classList.add("hidden");
  values = r.values;
  rendering = true;
  for (const p of params) {
    const el = document.getElementById(`ra-${p.name}`) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    const v = values[p.name];
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      el.checked = v === true;
    } else {
      el.value = typeof v === "string" ? v : "";
    }
  }
  rendering = false;
}

/** 内省（默认关）：openConfirm 确认副作用 → 独立子进程（Rust 侧 5s 超时）→ 合并默认值 */
async function runIntrospect(argsInput: HTMLInputElement): Promise<void> {
  if (!scriptPath || !app.workspaceRoot) return;
  const ok = await openConfirm({
    message: "内省将执行该脚本的顶层代码以获取运行时默认值（可能有副作用），是否继续？",
    kind: "primary",
  });
  if (!ok) return;
  const res = await evalKind<AstArgsData>("ast_introspect", { path: scriptPath }, { workspaceRoot: app.workspaceRoot });
  if (res.state !== "ok" || !res.data) {
    const note = document.getElementById("ra-note") ?? document.createElement("div");
    note.id = "ra-note";
    note.className = "rx-status rx-status--err";
    note.textContent = `内省失败：${res.error ?? "未知错误"}`;
    if (!note.parentElement) container.appendChild(note);
    return;
  }
  const runtime = toFormModel(res.data);
  // 合并：以 name 为键更新 default（用户已填的值不动）
  for (const p of runtime) {
    const cur = params.find((x) => x.name === p.name);
    if (cur) cur.default = p.default;
  }
  renderRows(argsInput, true);
}
