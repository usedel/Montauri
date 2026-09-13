// 运行配置面板域（TD-14 拆分，原 main.ts 的「运行配置（P0-C/D 配置列表编辑器）」段）。
// 两种编辑视角：
// - 「当前文件」（file）：以活动文件为锚的配置（相当于 PyCharm 临时配置），入口固定为 script；
// - 「命名配置」（named / new）：独立命名配置，入口可选 script / module，可删除。
// 配置数据源为 runFlow 的 runProfiles 缓存（getRunProfiles / refreshRunProfiles）。

import { invoke } from "@tauri-apps/api/core";
import { app, $, $btn, outputEl } from "./state";
import { basename, setBusy } from "./util";
import { appendOutputLine } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { openConfirm } from "./dialog";
import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { EMPTY_RUN_CONFIG, normalizeRunConfig, type EnvVar, type RunConfig, type RunEntry, type StdinMode } from "./runState";
import { getRunProfiles, refreshRunProfiles } from "./runFlow";

// ---------- 域内 DOM ----------

const runConfigModalEl = $("run-config-modal");
const runConfigTargetEl = $("run-config-target");
const runConfigArgsEl = $("run-config-args") as HTMLInputElement;
const runConfigEnvEl = $("run-config-env") as HTMLTextAreaElement;
const runConfigStdinModeEl = $("run-config-stdin-mode") as HTMLSelectElement;
const runConfigStdinPathEl = $("run-config-stdin-path") as HTMLInputElement;
const runConfigStdinPathRowEl = $("run-config-stdin-path-row");
// P0-C：配置列表编辑器（选择 / 名称 / 入口类型 / 目标 / 工作目录）
const runConfigSelectEl = $("run-config-select") as HTMLSelectElement;
const runConfigNameEl = $("run-config-name") as HTMLInputElement;
const runConfigNameRowEl = $("run-config-name-row");
const runConfigEntryKindEl = $("run-config-entry-kind") as HTMLSelectElement;
const runConfigEntryRowEl = $("run-config-entry-row");
const runConfigTargetInputEl = $("run-config-target-input") as HTMLInputElement;
const runConfigTargetRowEl = $("run-config-target-row");
const runConfigTargetLabelEl = $("run-config-target-label");
const runConfigCwdEl = $("run-config-cwd") as HTMLInputElement;
const runConfigEnvFilesEl = $("run-config-env-files") as HTMLTextAreaElement;
const runConfigInterpreterEl = $("run-config-interpreter") as HTMLInputElement;
const runConfigAllowMultipleEl = $("run-config-allow-multiple") as HTMLInputElement;
const runConfigPreRunEl = $("run-config-pre-run") as HTMLInputElement;
const runConfigOpenBrowserEl = $("run-config-open-browser") as HTMLInputElement;
const runConfigAutoRerunEl = $("run-config-auto-rerun") as HTMLInputElement;
const runConfigPythonConsoleEl = $("run-config-python-console") as HTMLInputElement;

type RunConfigEditMode = { mode: "file"; path: string } | { mode: "named"; name: string } | { mode: "new" };

/** 当前编辑视角（null = 面板关闭） */
let runConfigEdit: RunConfigEditMode | null = null;
/** UI-05：模态焦点陷阱解除句柄，关闭时置 null */
let releaseRunConfigFocus: (() => void) | null = null;

// ---------- 视角与字段 ----------

/** 加载某文件的「当前文件」视角配置 */
async function loadConfigForFile(path: string): Promise<RunConfig> {
  try {
    const raw = await invoke<Partial<RunConfig>>("get_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: path });
    return normalizeRunConfig(raw, basename(path));
  } catch (e) {
    console.error("get_run_config 失败", e);
    return { ...EMPTY_RUN_CONFIG, name: basename(path) };
  }
}

/** 读取「当前文件」配置键（相对工作区根、正斜杠）——与后端 run_config_key 同口径 */
function runConfigKeyOf(path: string): string {
  const root = app.workspaceRoot?.replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  const norm = path.replace(/\\/g, "/");
  return root && norm.toLowerCase().startsWith(root.toLowerCase()) ? norm.slice(root.length).replace(/^\//, "") || norm : norm;
}

/** 组装配置选择下拉（当前文件 + 命名配置列表 + 新建） */
function fillProfileSelect(activePath: string): void {
  runConfigSelectEl.innerHTML = "";
  const opts: Array<{ value: string; label: string }> = [
    { value: `file:${activePath}`, label: `${basename(activePath)}（当前文件）` },
    ...getRunProfiles().map((p) => ({ value: `name:${p.name}`, label: p.name })),
    { value: "__new__", label: "＋ 新建配置…" },
  ];
  for (const o of opts) {
    const op = document.createElement("option");
    op.value = o.value;
    op.textContent = o.label;
    runConfigSelectEl.appendChild(op);
  }
  runConfigSelectEl.value = `file:${activePath}`;
}

/** 把一份配置填进编辑器字段；mode 决定名称/入口/删除行的可见性 */
function fillRunConfigEditor(cfg: RunConfig, mode: "file" | "named" | "new"): void {
  const named = mode !== "file";
  runConfigNameRowEl.classList.toggle("hidden", !named);
  runConfigEntryRowEl.classList.toggle("hidden", !named);
  runConfigTargetRowEl.classList.toggle("hidden", !named);
  $btn("run-config-delete").classList.toggle("hidden", mode !== "named");
  // file 视角：入口固定 script，target 由后端按路径推导，锚点以提示行展示
  if (mode === "file") {
    runConfigTargetEl.textContent = `当前文件：${runConfigEdit?.mode === "file" ? runConfigEdit.path : ""}`;
    runConfigTargetEl.classList.remove("hidden");
  }
  runConfigNameEl.value = mode === "new" ? "" : cfg.name;
  runConfigEntryKindEl.value = cfg.entry.kind;
  runConfigTargetInputEl.value = cfg.entry.target;
  syncEntryTargetLabel();
  runConfigArgsEl.value = cfg.args;
  runConfigCwdEl.value = cfg.cwd;
  runConfigEnvFilesEl.value = cfg.env_files.filter((p) => p.trim()).join("\n");
  runConfigInterpreterEl.value = cfg.interpreter;
  runConfigAllowMultipleEl.checked = cfg.allow_multiple;
  runConfigPreRunEl.value = cfg.pre_run_profile;
  runConfigOpenBrowserEl.value = cfg.open_browser_url;
  runConfigAutoRerunEl.checked = cfg.auto_rerun;
  runConfigPythonConsoleEl.checked = cfg.python_console;
  runConfigEnvEl.value = cfg.env.map((kv) => `${kv.key}=${kv.value}`).join("\n");
  // 未知/存量异常值回落到 null（与后端 effective_mode 同口径：未知模式运行时按 null 处理，
  // 面板展示必须与真实运行行为一致；正常缺省即 interactive，P0-A）
  runConfigStdinModeEl.value = cfg.stdin.mode === "file" || cfg.stdin.mode === "interactive" ? cfg.stdin.mode : "null";
  runConfigStdinPathEl.value = cfg.stdin.path;
  syncStdinPathRow();
  syncTargetHintVisibility();
}

/** 入口类型切换：模块名 / 脚本路径 的 label 与 placeholder */
function syncEntryTargetLabel(): void {
  const isModule = runConfigEntryKindEl.value === "module";
  runConfigTargetLabelEl.textContent = isModule ? "模块名 (Module name)" : "脚本路径 (Script path)";
  runConfigTargetInputEl.placeholder = isModule ? "uvicorn" : "main.py（相对工作区根）";
}

/** 锚点提示行仅 file 视角显示（命名配置用目标行承载 script 路径 / module 名） */
function syncTargetHintVisibility(): void {
  const named = runConfigEdit !== null && runConfigEdit.mode !== "file";
  runConfigTargetEl.classList.toggle("hidden", named);
}

/** stdin 选 file 时才显示文件路径行（interactive 由输出面板的输入行承载，无需路径） */
function syncStdinPathRow(): void {
  runConfigStdinPathRowEl.classList.toggle("hidden", runConfigStdinModeEl.value !== "file");
}

// ---------- 面板开合 ----------

/** 打开运行配置面板（默认「当前文件」视角；下拉可切命名配置 / 新建） */
export async function openRunConfig(path: string): Promise<void> {
  if (!app.workspaceRoot) {
    appendOutputLine(outputEl, "运行配置需先打开一个工作区", "stderr", gotoFromLink);
    return;
  }
  await refreshRunProfiles();
  runConfigEdit = { mode: "file", path };
  fillProfileSelect(path);
  fillRunConfigEditor(await loadConfigForFile(path), "file");
  showEl(runConfigModalEl);
  releaseRunConfigFocus?.();
  releaseRunConfigFocus = trapFocus(runConfigModalEl);
  runConfigArgsEl.focus();
}

/** 下拉切换视角：当前文件 / 命名配置 / 新建 */
async function onRunConfigSelectChange(): Promise<void> {
  if (!app.workspaceRoot) return;
  const v = runConfigSelectEl.value;
  if (v === "__new__") {
    startNewRunConfig();
    runConfigNameEl.focus();
    return;
  }
  if (v.startsWith("file:")) {
    const path = v.slice("file:".length);
    runConfigEdit = { mode: "file", path };
    fillRunConfigEditor(await loadConfigForFile(path), "file");
    return;
  }
  const name = v.startsWith("name:") ? v.slice("name:".length) : v;
  const p = getRunProfiles().find((x) => x.name === name);
  if (p) {
    runConfigEdit = { mode: "named", name };
    fillRunConfigEditor(p, "named");
  }
}

function closeRunConfig(): void {
  runConfigEdit = null;
  releaseRunConfigFocus?.();
  releaseRunConfigFocus = null;
  hideEl(runConfigModalEl);
}

/** 「＋ 新建配置…」视角（下拉选中 __new__ 或「新建」按钮共用） */
function startNewRunConfig(): void {
  runConfigEdit = { mode: "new" };
  runConfigSelectEl.value = "__new__";
  fillRunConfigEditor({ ...EMPTY_RUN_CONFIG, name: "" }, "new");
  runConfigNameEl.focus();
}

// ---------- 保存 / 删除 ----------

/** 解析环境变量文本（每行 KEY=VALUE，忽略空行与无 '=' 的行）为 EnvVar[] */
function parseEnvText(text: string): EnvVar[] {
  const out: EnvVar[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // 无 '=' 或空键 → 跳过
    out.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1) });
  }
  return out;
}

/** P1-G：解析 .env 文件列表文本（每行一个路径，忽略空行；按序加载） */
function parseEnvFilesText(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function saveRunConfig(): Promise<void> {
  if (!app.workspaceRoot || !runConfigEdit) return;
  const edit = runConfigEdit;
  // S4：三态（null / file / interactive）；下拉里的未知值一律回落 null
  const rawMode = runConfigStdinModeEl.value;
  const stdinMode: StdinMode = rawMode === "file" || rawMode === "interactive" ? rawMode : "null";
  const stdinPath = runConfigStdinPathEl.value.trim();
  // S1：选了重定向却没给文件 → 拦住并提示，避免保存出一个后端会归一化成 null 的“假配置”
  if (stdinMode === "file" && !stdinPath) {
    appendOutputLine(outputEl, "已选择「重定向自文件」，请先指定输入文件", "stderr", gotoFromLink);
    runConfigStdinPathEl.focus();
    return;
  }
  const entryKind: RunEntry["kind"] = runConfigEntryKindEl.value === "module" ? "module" : "script";
  const entryTarget = runConfigTargetInputEl.value.trim();
  let config: RunConfig;
  if (edit.mode === "file") {
    config = {
      name: basename(edit.path),
      entry: { kind: "script", target: runConfigKeyOf(edit.path) },
      args: runConfigArgsEl.value,
      cwd: runConfigCwdEl.value.trim(),
      env: parseEnvText(runConfigEnvEl.value),
      env_files: parseEnvFilesText(runConfigEnvFilesEl.value),
      stdin: { mode: stdinMode, path: stdinMode === "file" ? stdinPath : "" },
      interpreter: runConfigInterpreterEl.value.trim(),
      allow_multiple: runConfigAllowMultipleEl.checked,
      pre_run_profile: runConfigPreRunEl.value.trim(),
      open_browser_url: runConfigOpenBrowserEl.value.trim(),
      auto_rerun: runConfigAutoRerunEl.checked,
      python_console: runConfigPythonConsoleEl.checked,
    };
  } else {
    const name = runConfigNameEl.value.trim();
    if (!name) {
      appendOutputLine(outputEl, "配置名不能为空", "stderr", gotoFromLink);
      runConfigNameEl.focus();
      return;
    }
    if (entryKind === "module" && !entryTarget) {
      appendOutputLine(outputEl, "模块入口需指定模块名（如 uvicorn）", "stderr", gotoFromLink);
      runConfigTargetInputEl.focus();
      return;
    }
    if (entryKind === "script" && !entryTarget) {
      appendOutputLine(outputEl, "脚本入口需指定脚本路径（相对工作区根）", "stderr", gotoFromLink);
      runConfigTargetInputEl.focus();
      return;
    }
    config = {
      name,
      entry: { kind: entryKind, target: entryTarget },
      args: runConfigArgsEl.value,
      cwd: runConfigCwdEl.value.trim(),
      env: parseEnvText(runConfigEnvEl.value),
      env_files: parseEnvFilesText(runConfigEnvFilesEl.value),
      stdin: { mode: stdinMode, path: stdinMode === "file" ? stdinPath : "" },
      interpreter: runConfigInterpreterEl.value.trim(),
      allow_multiple: runConfigAllowMultipleEl.checked,
      pre_run_profile: runConfigPreRunEl.value.trim(),
      open_browser_url: runConfigOpenBrowserEl.value.trim(),
      auto_rerun: runConfigAutoRerunEl.checked,
      python_console: runConfigPythonConsoleEl.checked,
    };
  }
  const saveBtn = $btn("run-config-save");
  setBusy(saveBtn, true, "保存中…");
  try {
    if (edit.mode === "file") {
      await invoke("set_run_config", { workspaceRoot: app.workspaceRoot, scriptPath: edit.path, config });
      appendOutputLine(outputEl, `已保存运行配置：${basename(edit.path)}`, "stdout", gotoFromLink);
    } else {
      await invoke("save_run_profile", { workspaceRoot: app.workspaceRoot, profile: config });
      appendOutputLine(outputEl, `已保存运行配置：${config.name}`, "stdout", gotoFromLink);
    }
    await refreshRunProfiles();
    closeRunConfig();
  } catch (e) {
    appendOutputLine(outputEl, `保存运行配置失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(saveBtn, false);
}

/** 删除命名配置（仅 named 视角；file 视角全缺省保存即自动移除） */
async function deleteRunConfig(): Promise<void> {
  if (!app.workspaceRoot || !runConfigEdit || runConfigEdit.mode !== "named") return;
  const name = runConfigEdit.name;
  const ok = await openConfirm({
    title: "删除运行配置",
    message: `确定删除运行配置「${name}」？此操作不可撤销。`,
    okLabel: "删除", cancelLabel: "取消", kind: "danger",
  });
  if (!ok) return;
  try {
    await invoke("delete_run_profile", { workspaceRoot: app.workspaceRoot, name });
    await refreshRunProfiles();
    appendOutputLine(outputEl, `已删除运行配置：${name}`, "stdout", gotoFromLink);
    closeRunConfig();
  } catch (e) {
    appendOutputLine(outputEl, `删除运行配置失败：${e}`, "stderr", gotoFromLink);
  }
}

// ---------- 接线 ----------

/** 运行配置面板 DOM 接线（main 的 init 调用） */
export function wireRunConfigPanel(): void {
  $btn("run-config-close").addEventListener("click", closeRunConfig);
  $btn("run-config-cancel").addEventListener("click", closeRunConfig);
  $btn("run-config-save").addEventListener("click", () => void saveRunConfig());
  $btn("run-config-delete").addEventListener("click", () => void deleteRunConfig());
  $btn("run-config-new").addEventListener("click", startNewRunConfig);
  runConfigSelectEl.addEventListener("change", () => void onRunConfigSelectChange());
  runConfigEntryKindEl.addEventListener("change", syncEntryTargetLabel);
  runConfigArgsEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void saveRunConfig();
  });
  runConfigStdinModeEl.addEventListener("change", syncStdinPathRow);
  runConfigStdinPathEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void saveRunConfig();
  });
  $btn("run-config-stdin-browse").addEventListener("click", async () => {
    const p = await invoke<string | null>("pick_file").catch((e) => {
      appendOutputLine(outputEl, `打开文件选择器失败：${e}`, "stderr", gotoFromLink);
      return null;
    });
    if (p) runConfigStdinPathEl.value = p;
  });
  runConfigModalEl.addEventListener("click", (e) => {
    if (e.target === runConfigModalEl) closeRunConfig();
  });
}
