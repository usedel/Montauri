// 设置面板功能域（TD-007 迁出 main.ts；P1 升级为左右分栏分类导航 + Live Templates 内嵌）：
// 全局设置加载/保存（P25-T08）+ 设置面板 UI（P25-T09）+ 运行时智能层开关（P3-T09）。
// 设置值本体在 state.ts 的 app.settings（多域共读）。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, $, $btn, DEFAULT_SETTINGS, type Settings } from "./state";
import * as lsp from "./lsp/client";
import { startLsp } from "./main";
import * as ltUi from "./live-templates/ui/manager";
import { KEYBINDING_META, validateKeybindingMap, applyEditorKeybindings } from "./keybindings";
import { refreshTerminalThemes } from "./termUi";
import { applyReduceMotion, hideEl, reduceMotionEnabled, showEl } from "./anim";
import { openAlert } from "./dialog";

// ---------- 域内 DOM ----------

const statusFontEl = $("status-font");
const settingsModalEl = $("settings-modal");
const settingsThemeEl = $("settings-theme") as HTMLSelectElement;
const settingsFontEl = $("settings-font") as HTMLInputElement;
const settingsFontFamilyEl = $("settings-font-family") as HTMLInputElement;
const settingsFontLigaturesEl = $("settings-font-ligatures") as HTMLInputElement;
const settingsTabSizeEl = $("settings-tab-size") as HTMLInputElement;
const settingsInsertSpacesEl = $("settings-insert-spaces") as HTMLInputElement;
const settingsWordWrapEl = $("settings-word-wrap") as HTMLSelectElement;
const settingsMinimapEl = $("settings-minimap") as HTMLInputElement;
const settingsAutosaveEl = $("settings-autosave") as HTMLSelectElement;
const settingsProbeEl = $("settings-probe") as HTMLInputElement;
const settingsIntelEl = $("settings-intel") as HTMLInputElement;
const settingsEngineEl = $("settings-engine") as HTMLSelectElement;
const settingsFormatOnSaveEl = $("settings-format-on-save") as HTMLInputElement;
const settingsTerminalCwdEl = $("settings-terminal-cwd") as HTMLSelectElement;
const settingsReduceMotionEl = $("settings-reduce-motion") as HTMLInputElement;
const settingsFontFamilyPresetEl = $("settings-font-family-preset") as HTMLSelectElement;
const settingsPypiIndexPresetEl = $("settings-pypi-index-preset") as HTMLSelectElement;
const settingsPypiIndexEl = $("settings-pypi-index") as HTMLInputElement;

// ---------- 分类导航（P1） ----------

export type SettingsCategory = "appearance" | "editor" | "keybindings" | "save" | "python" | "templates" | "terminal";

/** 切换到指定分类并更新导航高亮；进入 Live Templates 分类时渲染模板列表 */
function switchCategory(cat: SettingsCategory): void {
  document.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.cat === cat);
  });
  document.querySelectorAll<HTMLElement>(".settings-section").forEach((s) => {
    s.classList.toggle("hidden", s.id !== `settings-section-${cat}`);
  });
  // 模板页为「列表 + 编辑器」双栏，加宽卡片以获得足够编辑空间
  document.querySelector(".settings-card")?.classList.toggle("settings-card--wide", cat === "templates");
  if (cat === "templates") ltUi.openPanel();
}

// ---------- 加载 / 保存 ----------

/** 外壳主题联动（D1 P-01）：Monaco 主题值驱动 html[data-theme]，
 *  style.css 的 [data-theme="light"] 覆盖层负责外壳配色（"vs" = 浅色，其余按深色）。 */
export function applyShellTheme(theme: string): void {
  document.documentElement.dataset.theme = theme === "vs" ? "light" : "dark";
}

export async function loadSettings(): Promise<void> {
  try {
    app.settings = await invoke<Settings>("get_settings");
  } catch (e) {
    console.warn("设置加载失败，使用默认", e);
  }
  // 快捷键逐项兜底：旧配置 / 手改文件缺项时回落出厂默认（Rust 侧仅保证整表缺省）
  app.settings.keybindings = { ...DEFAULT_SETTINGS.keybindings, ...(app.settings.keybindings ?? {}) };
  applyShellTheme(app.settings.theme);
}

export async function saveSettings(): Promise<void> {
  try {
    await invoke("set_settings", { settings: app.settings });
  } catch (e) {
    console.warn("设置保存失败", e);
  }
}

export function applyFontStatus(): void {
  statusFontEl.textContent = `字号 ${app.settings.font_size}`;
}

/** 由 Settings 构造 Monaco 编辑器选项（P1：外观/编辑器高频项收敛）。
 *  注：tabSize / insertSpaces 属 model 层选项（Monaco ITextModel），经 applyModelIndent 应用。 */
export function buildEditorOptions(settings: Settings): MonacoApi.editor.IEditorOptions {
  const opts: MonacoApi.editor.IEditorOptions = {
    fontSize: settings.font_size,
    fontLigatures: settings.font_ligatures,
    wordWrap: settings.word_wrap === "on" ? "on" : "off",
    minimap: { enabled: settings.minimap },
  };
  const family = settings.font_family.trim();
  if (family) opts.fontFamily = family;
  return opts;
}

/** 把缩进选项应用到所有已打开 model（Monaco 的 tabSize/insertSpaces 属 model 层） */
export function applyModelIndent(settings: Settings): void {
  for (const t of app.tabs) {
    t.model.updateOptions({ tabSize: settings.tab_size, insertSpaces: settings.insert_spaces });
  }
}

// ---------- 快捷键分区（渲染 / 读写） ----------

/** 快捷键输入框 id 规则 */
const kbInputId = (id: string): string => `settings-kb-${id}`;

/** 渲染快捷键分区的表单行（按 KEYBINDING_META 顺序，一次性构建） */
function renderKeybindingRows(): void {
  const container = $("settings-keybinding-rows");
  container.textContent = "";
  for (const m of KEYBINDING_META) {
    const row = document.createElement("div");
    row.className = "settings-row";
    const label = document.createElement("label");
    label.textContent = m.label;
    const input = document.createElement("input");
    input.type = "text";
    input.id = kbInputId(m.id);
    input.placeholder = m.def;
    input.spellcheck = false;
    row.append(label, input);
    container.appendChild(row);
  }
}

/** 读取快捷键表单 → id → 键位串（已 trim） */
function readKeybindingForm(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of KEYBINDING_META) {
    const input = document.getElementById(kbInputId(m.id)) as HTMLInputElement | null;
    map[m.id] = (input?.value ?? "").trim();
  }
  return map;
}

// ---------- 设置面板（P25-T09 + P1） ----------

function clampFontSize(raw: number, fallback: number): number {
  const n = Number.isFinite(raw) ? raw : fallback;
  return Math.max(8, Math.min(32, n));
}

/** 字体族下拉候选 ↔ 自定义输入框同步（D3 P-14：命中候选则选中，否则落「自定义…」） */
function syncFontPreset(family: string): void {
  const hit = Array.from(settingsFontFamilyPresetEl.options).find(
    (o) => o.value === family && o.value !== "__custom__",
  );
  settingsFontFamilyPresetEl.value = hit ? hit.value : "__custom__";
}

/** PyPI 源下拉候选 ↔ 自定义输入框同步（命中候选则选中，否则落「自定义…」） */
function syncPypiIndexPreset(index: string): void {
  const hit = Array.from(settingsPypiIndexPresetEl.options).find(
    (o) => o.value === index && o.value !== "__custom__",
  );
  settingsPypiIndexPresetEl.value = hit ? hit.value : "__custom__";
}

/** 字体族实时预览（设置面板内即时生效；正式保存仍走「保存」按钮） */
function previewFontFamily(): void {
  const family = settingsFontFamilyEl.value.trim();
  if (family) app.editor.updateOptions({ fontFamily: family });
}

/** 用给定 settings 填充表单控件 */
function fillForm(settings: Settings): void {
  settingsThemeEl.value = settings.theme;
  settingsFontEl.value = String(settings.font_size);
  settingsFontFamilyEl.value = settings.font_family;
  syncFontPreset(settings.font_family);
  settingsReduceMotionEl.checked = reduceMotionEnabled();
  settingsFontLigaturesEl.checked = settings.font_ligatures;
  settingsTabSizeEl.value = String(settings.tab_size);
  settingsInsertSpacesEl.checked = settings.insert_spaces;
  settingsWordWrapEl.value = settings.word_wrap;
  settingsMinimapEl.checked = settings.minimap;
  settingsAutosaveEl.value = settings.autosave;
  settingsProbeEl.checked = settings.probe_enabled;
  settingsIntelEl.checked = settings.runtime_intel_enabled;
  settingsEngineEl.value = settings.lsp_engine;
  settingsFormatOnSaveEl.checked = settings.format_on_save;
  settingsTerminalCwdEl.value = settings.terminal_cwd;
  // 旧配置缺 pypi_index 时兜底出厂默认（官方源）
  settingsPypiIndexEl.value = settings.pypi_index || DEFAULT_SETTINGS.pypi_index;
  syncPypiIndexPreset(settingsPypiIndexEl.value);
  for (const m of KEYBINDING_META) {
    const input = document.getElementById(kbInputId(m.id)) as HTMLInputElement | null;
    if (input) input.value = settings.keybindings[m.id] ?? "";
  }
}

/** 打开设置面板（可指定初始分类；「视图 → Live Templates」快捷入口复用） */
export function openSettingsPanel(category: SettingsCategory = "appearance"): void {
  fillForm(app.settings);
  switchCategory(category);
  showEl(settingsModalEl);
}

/** 恢复默认：仅重置表单控件为出厂默认，待用户「保存」才持久化/应用（与「取消」语义对称） */
function resetSettingsPanel(): void {
  fillForm(DEFAULT_SETTINGS);
  settingsReduceMotionEl.checked = false; // 出厂默认不减少动画
}

function closeSettingsPanel(): void {
  hideEl(settingsModalEl);
}

async function saveSettingsPanel(): Promise<void> {
  // 快捷键先行校验（格式 / 冲突），不通过则整体不保存
  const keybindings = readKeybindingForm();
  const kbError = validateKeybindingMap(keybindings);
  if (kbError) {
    await openAlert({ message: kbError, kind: "danger" });
    return;
  }
  const theme = settingsThemeEl.value;
  const fontSize = clampFontSize(Number(settingsFontEl.value), app.settings.font_size);
  const fontFamily = settingsFontFamilyEl.value.trim();
  const fontLigatures = settingsFontLigaturesEl.checked;
  const tabSize = Math.max(1, Math.min(8, Number(settingsTabSizeEl.value) || app.settings.tab_size));
  const insertSpaces = settingsInsertSpacesEl.checked;
  const wordWrap = settingsWordWrapEl.value;
  const minimap = settingsMinimapEl.checked;
  const autosave = settingsAutosaveEl.value;
  const probeEnabled = settingsProbeEl.checked;
  const lspEngine = settingsEngineEl.value;
  const formatOnSave = settingsFormatOnSaveEl.checked;
  const runtimeIntelEnabled = settingsIntelEl.checked;
  const terminalCwd = settingsTerminalCwdEl.value;
  const pypiIndex = settingsPypiIndexEl.value.trim();
  const engineChanged = lspEngine !== app.settings.lsp_engine;
  const intelChanged = runtimeIntelEnabled !== app.settings.runtime_intel_enabled;

  app.settings = {
    theme,
    font_size: fontSize,
    font_family: fontFamily,
    font_ligatures: fontLigatures,
    tab_size: tabSize,
    insert_spaces: insertSpaces,
    word_wrap: wordWrap,
    minimap,
    autosave,
    autosave_delay: app.settings.autosave_delay,
    probe_enabled: probeEnabled,
    lsp_engine: lspEngine,
    format_on_save: formatOnSave,
    runtime_intel_enabled: runtimeIntelEnabled,
    terminal_cwd: terminalCwd,
    pypi_index: pypiIndex,
    keybindings,
  };
  // P1 副作用表：外观/编辑器即时生效（model 层缩进单独应用）；引擎变化重启；intel 变化起停
  app.monaco.editor.setTheme(theme);
  applyShellTheme(theme); // D1：外壳 CSS 主题与 Monaco 同步切换
  refreshTerminalThemes(); // D1：已打开的终端实例重套深浅配色
  applyReduceMotion(settingsReduceMotionEl.checked); // D3：「减少动画」开关
  app.editor.updateOptions(buildEditorOptions(app.settings));
  applyModelIndent(app.settings);
  applyFontStatus();
  applyEditorKeybindings(); // 编辑器级键位即时重建（window 级实时匹配无需处理）
  await saveSettings();
  closeSettingsPanel();

  if (engineChanged) {
    ($("engine-select") as HTMLSelectElement).value = lspEngine;
    await startLsp();
  } else if (intelChanged) {
    // 运行时智能层开关变化：只起停 intel，不重启静态引擎（P3-T09 一键关闭）
    await applyIntelToggle(runtimeIntelEnabled);
  }
}

/** 一键开启/关闭运行时智能层（opencharm-intel），不影响静态引擎 */
async function applyIntelToggle(enabled: boolean): Promise<void> {
  if (!app.workspaceRoot) return;
  if (enabled) {
    const rootUri = `file:///${app.workspaceRoot.replace(/\\/g, "/")}`;
    try {
      await lsp.startIntel(app.workspaceRoot, rootUri);
      for (const t of app.tabs) lsp.didOpen(t.path, t.model);
    } catch (e) {
      console.warn("[intel] 启动异常:", e);
    }
  } else {
    await lsp.stopIntel();
  }
}

// ---------- 事件接线 ----------

/** 接线设置面板交互（菜单栏齿轮 + 分类导航 + 面板内按钮 + 遮罩点击关闭） */
export function wireSettingsPanel(): void {
  renderKeybindingRows(); // 快捷键分区行一次性构建（值由 fillForm 填充）
  $btn("btn-settings").addEventListener("click", () => openSettingsPanel());
  $btn("settings-close").addEventListener("click", closeSettingsPanel);
  $btn("settings-cancel").addEventListener("click", closeSettingsPanel);
  $btn("settings-save").addEventListener("click", () => saveSettingsPanel());
  $btn("settings-reset").addEventListener("click", resetSettingsPanel);
  document.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((b) => {
    b.addEventListener("click", () => switchCategory((b.dataset.cat ?? "appearance") as SettingsCategory));
  });
  settingsModalEl.addEventListener("click", (e) => {
    if (e.target === settingsModalEl) closeSettingsPanel();
  });
  // D3 P-14：字体族下拉候选 → 写入自定义框 + 实时预览
  settingsFontFamilyPresetEl.addEventListener("change", () => {
    if (settingsFontFamilyPresetEl.value !== "__custom__") {
      settingsFontFamilyEl.value = settingsFontFamilyPresetEl.value;
    }
    previewFontFamily();
  });
  settingsFontFamilyEl.addEventListener("input", () => {
    syncFontPreset(settingsFontFamilyEl.value.trim());
    previewFontFamily();
  });
  // PyPI 源：预设命中写入输入框；输入框失配时落「自定义…」
  settingsPypiIndexPresetEl.addEventListener("change", () => {
    if (settingsPypiIndexPresetEl.value !== "__custom__") {
      settingsPypiIndexEl.value = settingsPypiIndexPresetEl.value;
    }
    syncPypiIndexPreset(settingsPypiIndexEl.value);
  });
  settingsPypiIndexEl.addEventListener("input", () => {
    syncPypiIndexPreset(settingsPypiIndexEl.value.trim());
  });
  // D3 P-06：「减少动画」勾选即时生效（localStorage 持久化，独立于 Settings 结构）
  settingsReduceMotionEl.addEventListener("change", () => applyReduceMotion(settingsReduceMotionEl.checked));
}