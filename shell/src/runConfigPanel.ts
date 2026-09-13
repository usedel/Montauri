// 运行配置管理器域（PyCharm 式「左列表 + 右编辑」）。
//
// - 左侧列出工作区里**全部**运行配置：手工新建的永久配置 + 跑文件时自动落盘的临时配置
//   （`temporary = true`，上限 5，见 env_cmds::ensure_run_profile）。列表与「当前打开哪个文件」无关。
// - 右侧编辑选中的那一份；保存即写入 `save_run_profile`，临时配置在此**升格为永久配置**
//   （对应 PyCharm 的 Save Configuration）。
// - 开关面板时默认选中**当前运行目标**（▶ 下次会跑的那个），而不是永远落在某个文件上。
// 数据源为 runFlow 的 runProfiles 缓存（getRunProfiles / refreshRunProfiles）。

import { invoke } from "@tauri-apps/api/core";
import { app, $, $btn, outputEl } from "./state";
import { setBusy } from "./util";
import { appendOutputLine } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { openConfirm } from "./dialog";
import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { EMPTY_RUN_CONFIG, type EnvVar, type RunConfig, type RunEntry, type StdinMode } from "./runState";
import { getRunProfiles, getRunTarget, refreshRunProfiles } from "./runFlow";

// ---------- 域内 DOM ----------

const runConfigModalEl = $("run-config-modal");
const runConfigListEl = $("run-config-list");
const runConfigTargetEl = $("run-config-target");
const runConfigNameEl = $("run-config-name") as HTMLInputElement;
const runConfigEntryKindEl = $("run-config-entry-kind") as HTMLSelectElement;
const runConfigTargetInputEl = $("run-config-target-input") as HTMLInputElement;
const runConfigTargetLabelEl = $("run-config-target-label");
const runConfigArgsEl = $("run-config-args") as HTMLInputElement;
const runConfigCwdEl = $("run-config-cwd") as HTMLInputElement;
const runConfigEnvEl = $("run-config-env") as HTMLTextAreaElement;
const runConfigStdinModeEl = $("run-config-stdin-mode") as HTMLSelectElement;
const runConfigStdinPathEl = $("run-config-stdin-path") as HTMLInputElement;
const runConfigStdinPathRowEl = $("run-config-stdin-path-row");
const runConfigEnvFilesEl = $("run-config-env-files") as HTMLTextAreaElement;
const runConfigInterpreterEl = $("run-config-interpreter") as HTMLInputElement;
const runConfigAllowMultipleEl = $("run-config-allow-multiple") as HTMLInputElement;
const runConfigPreRunEl = $("run-config-pre-run") as HTMLInputElement;
const runConfigOpenBrowserEl = $("run-config-open-browser") as HTMLInputElement;
const runConfigAutoRerunEl = $("run-config-auto-rerun") as HTMLInputElement;
const runConfigPythonConsoleEl = $("run-config-python-console") as HTMLInputElement;

/** 当前选中项：已保存的配置（按名）或正在新建的草稿；null = 面板关闭 */
type Selection = { kind: "profile"; name: string } | { kind: "new" };
let selection: Selection | null = null;
/** UI-05：模态焦点陷阱解除句柄，关闭时置 null */
let releaseRunConfigFocus: (() => void) | null = null;

// ---------- 左侧列表 ----------

/** 相对工作区根的正斜杠路径（与后端 run_config_key 同口径），用于把文件匹配到配置 */
function runConfigKeyOf(path: string): string {
  const root = app.workspaceRoot?.replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  const norm = path.replace(/\\/g, "/");
  return root && norm.toLowerCase().startsWith(root.toLowerCase())
    ? norm.slice(root.length).replace(/^\//, "") || norm
    : norm;
}

function listItem(label: string, temporary: boolean, selected: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `run-config-list-item${selected ? " selected" : ""}`;
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", String(selected));
  const name = document.createElement("span");
  name.className = "rcl-name";
  name.textContent = label;
  li.appendChild(name);
  if (temporary) {
    const tag = document.createElement("span");
    tag.className = "rcl-tag";
    tag.textContent = "临时";
    li.appendChild(tag);
  }
  return li;
}

/** 重绘左侧列表（含「新配置草稿」占位与空态） */
function renderList(): void {
  const profiles = getRunProfiles();
  runConfigListEl.textContent = "";
  if (selection?.kind === "new") {
    runConfigListEl.appendChild(listItem("（新配置，未保存）", false, true));
  }
  for (const p of profiles) {
    const selected = selection?.kind === "profile" && selection.name === p.name;
    const li = listItem(p.name, p.temporary === true, selected);
    li.addEventListener("click", () => selectProfile(p.name));
    runConfigListEl.appendChild(li);
  }
  if (profiles.length === 0 && selection?.kind !== "new") {
    const li = document.createElement("li");
    li.className = "run-config-list-empty";
    li.textContent = "暂无运行配置。点「新建」，或直接运行一个脚本（运行时会自动生成一份临时配置）。";
    runConfigListEl.appendChild(li);
  }
  // 删除只对已保存的配置有意义
  $btn("run-config-delete").disabled = selection?.kind !== "profile";
}

/** 选中一份已保存的配置并载入右侧编辑器 */
function selectProfile(name: string): void {
  const p = getRunProfiles().find((x) => x.name === name);
  if (!p) return;
  selection = { kind: "profile", name };
  fillEditor(p);
  renderList();
}

/** 切到「新建」视角（可带一份草稿——「复制」即用此路径） */
function selectNew(draft?: RunConfig): void {
  selection = { kind: "new" };
  fillEditor(draft ?? { ...EMPTY_RUN_CONFIG, name: "" });
  renderList();
}

// ---------- 右侧编辑器 ----------

/** 把一份配置填进编辑器字段 */
function fillEditor(cfg: RunConfig): void {
  runConfigNameEl.value = cfg.name;
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
  // 临时配置由「跑文件」自动落盘，用户需要知道「保存 = 升格为永久配置」这层含义
  const isTemp = selection?.kind === "profile" && cfg.temporary === true;
  runConfigTargetEl.classList.toggle("hidden", !isTemp);
  if (isTemp) {
    runConfigTargetEl.textContent = "这是运行脚本时自动生成的临时配置（上限 5 份）。保存后即升格为永久配置。";
  }
}

/** 入口类型切换：模块名 / 脚本路径 的 label 与 placeholder */
function syncEntryTargetLabel(): void {
  const isModule = runConfigEntryKindEl.value === "module";
  runConfigTargetLabelEl.textContent = isModule ? "模块名 (Module name)" : "脚本路径 (Script path)";
  runConfigTargetInputEl.placeholder = isModule ? "uvicorn" : "main.py（相对工作区根）";
}

/** stdin 选 file 时才显示文件路径行（interactive 由输出面板的输入行承载，无需路径） */
function syncStdinPathRow(): void {
  runConfigStdinPathRowEl.classList.toggle("hidden", runConfigStdinModeEl.value !== "file");
}

// ---------- 面板开合 ----------

/**
 * 打开运行配置管理器。
 * 默认选中**当前运行目标**（▶ 下次会跑的那个）——PyCharm 打开配置页时高亮当前配置；
 * 目标无法匹配到任何配置时，退而求其次选中「覆盖当前文件的那份配置」，再不然选第一份 / 新建。
 * `path` 仅用于上面这层回退（活动文件路径；无活动文件时可省略）。
 */
export async function openRunConfig(path?: string): Promise<void> {
  if (!app.workspaceRoot) {
    appendOutputLine(outputEl, "运行配置需先打开一个工作区", "stderr", gotoFromLink);
    return;
  }
  await refreshRunProfiles();
  const profiles = getRunProfiles();
  const t = getRunTarget()?.target ?? null;

  const byTarget =
    t?.kind === "profile"
      ? profiles.find((p) => p.name === t.name)?.name
      : t?.kind === "file"
        ? profiles.find((p) => p.entry.kind === "script" && p.entry.target === runConfigKeyOf(t.path))?.name
        : undefined;
  // 无活动文件（未打开任何标签）时跳过这一层回退——否则空路径会误配到 entry.target 为空的配置
  const byFile = path
    ? profiles.find((p) => p.entry.kind === "script" && p.entry.target === runConfigKeyOf(path))?.name
    : undefined;

  showEl(runConfigModalEl);
  releaseRunConfigFocus?.();
  releaseRunConfigFocus = trapFocus(runConfigModalEl);
  const pick = byTarget ?? byFile ?? profiles[0]?.name;
  if (pick) selectProfile(pick);
  else selectNew();
  runConfigNameEl.focus();
}

function closeRunConfig(): void {
  selection = null;
  releaseRunConfigFocus?.();
  releaseRunConfigFocus = null;
  hideEl(runConfigModalEl);
}

// ---------- 保存 / 删除 / 复制 ----------

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
  if (!app.workspaceRoot || !selection) return;
  const sel = selection;
  const name = runConfigNameEl.value.trim();
  if (!name) {
    appendOutputLine(outputEl, "配置名不能为空", "stderr", gotoFromLink);
    runConfigNameEl.focus();
    return;
  }
  const entryKind: RunEntry["kind"] = runConfigEntryKindEl.value === "module" ? "module" : "script";
  const entryTarget = runConfigTargetInputEl.value.trim();
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
  const rawMode = runConfigStdinModeEl.value;
  const stdinMode: StdinMode = rawMode === "file" || rawMode === "interactive" ? rawMode : "null";
  const stdinPath = runConfigStdinPathEl.value.trim();
  // S1：选了重定向却没给文件 → 拦住并提示，避免保存出一个后端会归一化成 null 的“假配置”
  if (stdinMode === "file" && !stdinPath) {
    appendOutputLine(outputEl, "已选择「重定向自文件」，请先指定输入文件", "stderr", gotoFromLink);
    runConfigStdinPathEl.focus();
    return;
  }
  const config: RunConfig = {
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
    // 在配置页显式保存 = 升格为永久配置（临时配置正是靠这一步"转正"）
    temporary: false,
  };

  const saveBtn = $btn("run-config-save");
  setBusy(saveBtn, true, "保存中…");
  try {
    // 改名：save_run_profile 按新名 upsert，旧条目不会被清掉 → 先删旧名，避免留下孤儿配置
    if (sel.kind === "profile" && sel.name !== name) {
      await invoke("delete_run_profile", { workspaceRoot: app.workspaceRoot, name: sel.name }).catch(() => {});
    }
    await invoke("save_run_profile", { workspaceRoot: app.workspaceRoot, profile: config });
    await refreshRunProfiles();
    appendOutputLine(outputEl, `已保存运行配置：${name}`, "stdout", gotoFromLink);
    selectProfile(name); // 保持面板打开并选中刚保存的这份（管理器的常态）
  } catch (e) {
    appendOutputLine(outputEl, `保存运行配置失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(saveBtn, false);
}

/** 复制当前选中的配置为一份未保存草稿（改名后保存即生成新配置） */
function copyRunConfig(): void {
  const sel = selection;
  if (sel?.kind !== "profile") return;
  const p = getRunProfiles().find((x) => x.name === sel.name);
  if (!p) return;
  const taken = getRunProfiles().map((x) => x.name);
  let name = `${p.name} 副本`;
  for (let n = 2; taken.includes(name); n++) name = `${p.name} 副本 ${n}`;
  selectNew({ ...p, name, temporary: false });
  runConfigNameEl.focus();
  runConfigNameEl.select();
}

/** 删除当前选中的配置（仅已保存配置；草稿无从删起） */
async function deleteRunConfig(): Promise<void> {
  const sel = selection;
  if (!app.workspaceRoot || sel?.kind !== "profile") return;
  const name = sel.name;
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
    const rest = getRunProfiles();
    if (rest.length > 0) selectProfile(rest[0].name);
    else selectNew();
  } catch (e) {
    appendOutputLine(outputEl, `删除运行配置失败：${e}`, "stderr", gotoFromLink);
  }
}

// ---------- 接线 ----------

/** 运行配置管理器 DOM 接线（main 的 init 调用） */
export function wireRunConfigPanel(): void {
  $btn("run-config-close").addEventListener("click", closeRunConfig);
  $btn("run-config-cancel").addEventListener("click", closeRunConfig);
  $btn("run-config-save").addEventListener("click", () => void saveRunConfig());
  $btn("run-config-delete").addEventListener("click", () => void deleteRunConfig());
  $btn("run-config-copy").addEventListener("click", copyRunConfig);
  $btn("run-config-new").addEventListener("click", () => {
    selectNew();
    runConfigNameEl.focus();
  });
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
