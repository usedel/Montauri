// 设置面板功能域（TD-007 迁出 main.ts；P1 升级为左右分栏分类导航 + Live Templates 内嵌）：
// 全局设置加载/保存（P25-T08）+ 设置面板 UI（P25-T09）+ 运行时智能层开关（P3-T09）。
// 设置值本体在 state.ts 的 app.settings（多域共读）。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, $, $btn, DEFAULT_SETTINGS, lazyEl, outputEl, type Settings } from "./state";
import * as lsp from "./lsp/client";
import { renderEngineChip } from "./engineChip";
import { repaintRunWidget } from "./runWidget";
import * as ltUi from "./live-templates/ui/manager";
import { KEYBINDING_META, chordFromEvent, modsFromEvent, validateKeybindingMap, applyEditorKeybindings } from "./keybindings";
import { refreshTerminalFonts, refreshTerminalMotion, refreshTerminalThemes, syncOutputLevelChips } from "./termUi";
import { applyOutputLevelSetting } from "./output";
import { applyReduceMotion, hideEl, motionDisabled, reduceMotionEnabled, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { openAlert } from "./dialog";
import { fuzzyScore } from "./quickOpen";
import { toast, toastFail } from "./toast";
import { loadStorageUsage, wireStoragePanel } from "./storagePanel";
import { renderPluginsTab } from "./extensions/pluginsTab";
import { lintActiveFile, normalizeSeverity } from "./ruffLint"; // D-4：映射保存后立即重查当前文件
import { refreshPydanticDiagnostics } from "./pydanticDiagnostics"; // 阶段 4：开关保存后即时生效
import { refreshSplitEditorOptions } from "./splitEditor"; // C-4：分屏编辑器参数同步（splitEditor 不 import 本模块，无环）
// UI-26：主题选择改自绘预览色卡（原生 <option> 放不下色卡），值读写经 themePicker
import { getSelectedTheme, setSelectedTheme, wireThemePicker } from "./themePicker";
// UI-25：欢迎页快捷键网格跟随键位系统，改键保存后需刷新
import { renderWelcomeShortcuts } from "./welcomeShortcuts";
// 零引擎关键字补全开关（provider 只注册一次，此处只翻运行时真值）
import { setKeywordCompletionEnabled } from "./completion/keywordCompletion";
import { getLocale, setLocale } from "./i18n";

// ---------- 注入（main 的 init 中 setSettingsPanelHandlers） ----------
// TD-13：解「settingsPanel.ts → main.ts」循环边——切换静态引擎后需重启 LSP，
// 由 main 注入 startLsp（参照 terminal.ts::setTerminalLinkHandler 先例）。

interface SettingsPanelHandlers {
  startLsp: () => Promise<void>;
}

let handlers: SettingsPanelHandlers | null = null;

/** 注入 main 域函数（main 在 init 中调用；设置面板交互都发生在 init 之后） */
export function setSettingsPanelHandlers(h: SettingsPanelHandlers): void {
  handlers = h;
}

function sh(): SettingsPanelHandlers {
  if (!handlers) throw new Error("[OpenCharm] settingsPanel 尚未接线（setSettingsPanelHandlers 须在 init 中先于设置面板交互）");
  return handlers;
}

// ---------- 域内 DOM ----------
// P2-6（2026-09-29 review）：顶层快照改惰性（铁律 1——此前模块加载期解析 60 个控件，
// 精简 DOM 测试环境 import 即炸，设置域因此零单测）。用法均为 .value/.checked/
// .classList 方法访问，Proxy 安全；作为参数传给 DOM/组件 API 的元素不可用 lazyEl。

const statusFontEl = lazyEl("status-font");
const settingsModalEl = lazyEl("settings-modal");
const settingsFontEl = lazyEl<HTMLInputElement>("settings-font");
const settingsFontFamilyEl = lazyEl<HTMLInputElement>("settings-font-family");
const settingsFontLigaturesEl = lazyEl<HTMLInputElement>("settings-font-ligatures");
const settingsTabSizeEl = lazyEl<HTMLInputElement>("settings-tab-size");
const settingsInsertSpacesEl = lazyEl<HTMLInputElement>("settings-insert-spaces");
const settingsWordWrapEl = lazyEl<HTMLSelectElement>("settings-word-wrap");
const settingsMinimapEl = lazyEl<HTMLInputElement>("settings-minimap");
const settingsKeywordCompletionEl = lazyEl<HTMLInputElement>("settings-keyword-completion");
// C-6（PyCharm 调研）：可读性配置
const settingsIndentGuidesEl = lazyEl<HTMLInputElement>("settings-indent-guides");
const settingsBracketColorsEl = lazyEl<HTMLInputElement>("settings-bracket-colors");
// PR-B（dx_features_backlog §6.2）：粘性滚动
const settingsStickyScrollEl = lazyEl<HTMLInputElement>("settings-sticky-scroll");
// PR-N（dx_features_backlog §6.8）：参数名行内提示
const settingsInlayParamHintsEl = lazyEl<HTMLInputElement>("settings-inlay-param-hints");
// PR-C（dx_features_backlog §6.3）：保存清理
const settingsTrimTrailingEl = lazyEl<HTMLInputElement>("settings-trim-trailing");
const settingsFinalNewlineEl = lazyEl<HTMLInputElement>("settings-final-newline");
// PR-K（dx_features_backlog §6.6）：新建 .py 文件自动插文件头模板
const settingsNewFileTemplateEl = lazyEl<HTMLInputElement>("settings-new-file-template");
// PR-M（dx_features_backlog §6.6）：粘贴 JSON 自动转 Python 字面量
const settingsPasteJsonEl = lazyEl<HTMLInputElement>("settings-paste-json");
// B-3（PyCharm 调研）：调试只步进我的代码
const settingsDebugJmcEl = lazyEl<HTMLInputElement>("settings-debug-jmc");
// 库特别支持 PR-2：编辑器工具 lens / 正则高亮与测试器
const settingsLibsEditorLensEl = lazyEl<HTMLInputElement>("settings-libs-editor-lens");
const settingsLibsRegexEl = lazyEl<HTMLInputElement>("settings-libs-regex");
// 库特别支持 PR-3：格式串 hover/诊断 + 工具
const settingsLibsFormatEl = lazyEl<HTMLInputElement>("settings-libs-format");
// 库特别支持 PR-4：参数表单
const settingsLibsArgparseEl = lazyEl<HTMLInputElement>("settings-libs-argparse");
// 库特别支持 P1：JSON 字面量注入 / 输出面板日志级别着色（research §11.9）
const settingsLibsJsonInjectEl = lazyEl<HTMLInputElement>("settings-libs-json-inject");
const settingsLogLevelColorsEl = lazyEl<HTMLInputElement>("settings-log-level-colors");
// 阶段 4：Pydantic 构造校验诊断开关
const settingsPydanticDiagnosticsEl = lazyEl<HTMLInputElement>("settings-pydantic-diagnostics");
const settingsAutosaveEl = lazyEl<HTMLSelectElement>("settings-autosave");
const settingsProbeEl = lazyEl<HTMLInputElement>("settings-probe");
const settingsIntelEl = lazyEl<HTMLInputElement>("settings-intel");
const settingsEngineEl = lazyEl<HTMLSelectElement>("settings-engine");
const settingsFormatOnSaveEl = lazyEl<HTMLInputElement>("settings-format-on-save");
const settingsOptimizeImportsOnSaveEl = lazyEl<HTMLInputElement>("settings-optimize-imports-on-save");
// D-4（PyCharm 调研）：ruff 规则严重度映射（E/W/F 三类）
const settingsRuffSeverityEEl = lazyEl<HTMLSelectElement>("settings-ruff-severity-e");
const settingsRuffSeverityWEl = lazyEl<HTMLSelectElement>("settings-ruff-severity-w");
const settingsRuffSeverityFEl = lazyEl<HTMLSelectElement>("settings-ruff-severity-f");
const settingsTerminalCwdEl = lazyEl<HTMLSelectElement>("settings-terminal-cwd");
const settingsTerminalShellEl = lazyEl<HTMLSelectElement>("settings-terminal-shell");
const settingsReduceMotionEl = lazyEl<HTMLInputElement>("settings-reduce-motion");
// i18n：语言下拉（值不来自 settings.locale——语言存 localStorage，见 i18n/index.ts 头注）
const settingsLocaleEl = lazyEl<HTMLSelectElement>("settings-locale");
const settingsFontFamilyPresetEl = lazyEl<HTMLSelectElement>("settings-font-family-preset");
const settingsPypiIndexPresetEl = lazyEl<HTMLSelectElement>("settings-pypi-index-preset");
const settingsPypiIndexEl = lazyEl<HTMLInputElement>("settings-pypi-index");
const settingsLogEnabledEl = lazyEl<HTMLInputElement>("settings-log-enabled");
const settingsLogLevelEl = lazyEl<HTMLSelectElement>("settings-log-level");
const settingsLogKeepEl = lazyEl<HTMLInputElement>("settings-log-keep");
const settingsLogStdoutEl = lazyEl<HTMLInputElement>("settings-log-stdout");
const settingsLogOpenEl = lazyEl<HTMLButtonElement>("settings-log-open");
const settingsDataOpenEl = lazyEl<HTMLButtonElement>("settings-data-open");
// E-1（PyCharm 调研）：设置搜索
const settingsSearchEl = lazyEl<HTMLInputElement>("settings-search");
const settingsSearchEmptyEl = lazyEl("settings-search-empty");

// ---------- E-1：设置搜索 ----------

/** 动态内容页（列表 + 编辑器形态，不是 settings-row 表单行），搜索时整体隐藏 */
const NON_ROW_SECTIONS = new Set(["settings-section-templates", "settings-section-plugins"]);

/**
 * 控件 id → 搜索关键词（G-7「可发现性税」：每个设置行的英文/别名关键词，集中一处，
 * 避免给 index.html 每行加 data-kw 的漂移风险）。匹配时拼进行搜索域。
 */
const SETTINGS_ROW_KEYWORDS: Record<string, string> = {
  "settings-theme-picker": "theme 主题 appearance",
  "settings-font": "font size 字号",
  "settings-font-family": "font family 字体",
  "settings-font-family-preset": "font family 字体",
  "settings-font-ligatures": "ligatures 连字",
  "settings-reduce-motion": "motion animation 动画",
  "settings-tab-size": "tab indent 缩进",
  "settings-insert-spaces": "indent spaces 缩进空格",
  "settings-word-wrap": "wrap 换行",
  "settings-minimap": "minimap 小地图",
  "settings-indent-guides": "indent guides 参考线",
  "settings-bracket-colors": "bracket colorization 括号颜色",
  "settings-debug-jmc": "debug just my code 调试步进",
  "settings-autosave": "autosave 自动保存",
  "settings-format-on-save": "format ruff 格式化",
  "settings-optimize-imports-on-save": "imports isort 整理导入",
  "settings-ruff-severity-e": "ruff severity pycodestyle E 风格 级别 诊断",
  "settings-ruff-severity-w": "ruff severity pycodestyle W 警告 级别 诊断",
  "settings-ruff-severity-f": "ruff severity pyflakes F 级别 诊断",
  "settings-engine": "lsp engine pyrefly basedpyright 引擎",
  "settings-probe": "probe profiling 探针",
  "settings-intel": "intel runtime 运行时智能",
  "settings-pypi-index": "pypi mirror pip 源",
  "settings-pypi-index-preset": "pypi mirror pip 源",
  "settings-terminal-cwd": "terminal cwd 终端目录",
  "settings-terminal-shell": "terminal shell pwsh cmd powershell 终端",
  "settings-log-enabled": "log logging 日志",
  "settings-log-level": "log level 日志级别",
  "settings-log-keep": "log rotate 日志轮转",
  "settings-log-stdout": "log stdout 日志输出",
  "settings-data-open": "data directory 数据目录",
  "settings-log-open": "log directory 日志目录",
  "storage-open": "storage 磁盘",
  "storage-refresh": "storage usage 磁盘占用",
  "storage-clean-webview": "cache webview 清理缓存",
  "storage-clean-logs": "logs 清理日志",
  "storage-uv-prune": "uv cache 缓存",
  "storage-uv-clean": "uv cache 深度清理",
  "storage-migrate-path": "migrate 迁移",
  "storage-migrate": "migrate 迁移",
};

/** 行的搜索域：行文本 + 提示文本不在此（hint 归 section 层）+ 控件关键词 + data-kw */
function settingsRowHaystack(row: HTMLElement): string {
  const kws: string[] = [];
  if (row.dataset.kw) kws.push(row.dataset.kw);
  row.querySelectorAll("[id]").forEach((el) => {
    const kw = SETTINGS_ROW_KEYWORDS[el.id];
    if (kw) kws.push(kw);
  });
  return `${row.textContent ?? ""} ${kws.join(" ")}`;
}

/** 是否处于搜索态（E-1：空态恢复只在此为 true 时做一次，防止重复触发动态页渲染） */
let searchActive = false;

/** 应用设置搜索过滤：query 非空时跨分类显示所有含匹配行的 section，隐藏不匹配的行 */
function applySettingsFilter(rawQuery: string): void {
  const query = rawQuery.trim();
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".settings-section"));
  if (!query) {
    if (!searchActive) return; // 本就是分类视图：无状态可恢复（多余 switchCategory 会双渲染插件/模板页）
    searchActive = false;
    settingsSearchEmptyEl.classList.add("hidden");
    // 恢复：清掉行级 hidden，按当前分类还原 section 显隐。
    // 刻意不走 switchCategory——它对 plugins/templates 有渲染副作用，恢复显隐不该触发重渲染
    for (const s of sections) {
      s.classList.toggle("hidden", s.id !== `settings-section-${currentCategory}`);
      s.querySelectorAll<HTMLElement>(".settings-row").forEach((r) => r.classList.remove("hidden"));
    }
    document.querySelector(".settings-card")?.classList.toggle("settings-card--wide", currentCategory === "templates");
    return;
  }
  searchActive = true;
  document.querySelector(".settings-card")?.classList.remove("settings-card--wide");
  let totalMatches = 0;
  for (const s of sections) {
    if (NON_ROW_SECTIONS.has(s.id)) {
      s.classList.add("hidden");
      continue;
    }
    let sectionMatches = 0;
    s.querySelectorAll<HTMLElement>(".settings-row").forEach((row) => {
      const hit = fuzzyScore(settingsRowHaystack(row), query) !== null;
      row.classList.toggle("hidden", !hit);
      if (hit) sectionMatches++;
    });
    s.classList.toggle("hidden", sectionMatches === 0);
    totalMatches += sectionMatches;
  }
  settingsSearchEmptyEl.classList.toggle("hidden", totalMatches > 0);
}

/** 清空搜索框并恢复分类视图（切分类 / 关闭面板 / 空态跳转时调用） */
function clearSettingsSearch(): void {
  if (!searchActive && !settingsSearchEl.value) return;
  settingsSearchEl.value = "";
  applySettingsFilter("");
}

// ---------- 分类导航（P1） ----------

export type SettingsCategory = "appearance" | "editor" | "keybindings" | "save" | "python" | "templates" | "terminal" | "logging" | "storage" | "plugins";

/** 当前分类（E-1 设置搜索：清空搜索后恢复到该分类的显隐状态） */
let currentCategory: SettingsCategory = "appearance";

/** 切换到指定分类并更新导航高亮；进入 Live Templates 分类时渲染模板列表 */
function switchCategory(cat: SettingsCategory): void {
  currentCategory = cat;
  document.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((b) => {
    const sel = b.dataset.cat === cat;
    b.classList.toggle("active", sel);
    b.setAttribute("aria-selected", String(sel)); // UI-16：role=tab 的选中态与 .active 同源
  });
  document.querySelectorAll<HTMLElement>(".settings-section").forEach((s) => {
    s.classList.toggle("hidden", s.id !== `settings-section-${cat}`);
  });
  // 模板页为「列表 + 编辑器」双栏，加宽卡片以获得足够编辑空间
  document.querySelector(".settings-card")?.classList.toggle("settings-card--wide", cat === "templates");
  if (cat === "templates") ltUi.openPanel();
  // 存储页每次进入刷新占用明细（体积随使用变化）
  if (cat === "storage") void loadStorageUsage();
  // 插件页每次进入重渲染（启停/热重载后记录变化）
  if (cat === "plugins") void renderPluginsTab();
}

/** UI-24：窄窗口断点，须与 style.css 的 `@media (max-width: 720px)` 保持一致。
 *  该断点下分类导航由竖排改为横向滚动 tab 条，role=tablist 的 aria-orientation 必须跟着改——
 *  读屏播报的方向键语义（竖排 ↑↓ / 横排 ←→）与视觉排布不符会直接误导键盘用户。 */
const NARROW_NAV_QUERY = "(max-width: 720px)";

function syncNavOrientation(): void {
  const nav = document.querySelector(".settings-nav");
  if (!nav) return;
  const horizontal = window.matchMedia(NARROW_NAV_QUERY).matches;
  nav.setAttribute("aria-orientation", horizontal ? "horizontal" : "vertical");
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
    // UX P0-1：原先只 console，用户不知道自己在设置面板里的改动不会持久化
    toast("设置加载失败，本次会话使用默认设置（改动可能无法保存）", "error");
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
    toastFail("保存设置", e);
  }
}

/**
 * 把当前编辑器字号镜像到根节点变量（供 style.css 的 --editor-font-size 使用）。
 * 为什么要镜像：Monaco 只把 fontInfo 内联到 .view-lines / .view-overlays 等节点，glyphMargin
 * 不在它的子树内、继承不到；而 0.52.2 也没有输出 --vscode-editor-font-size 之类的 CSS 变量可读。
 * 不用 editor.applyFontInfo(#editor) 替代：那会给整个编辑器子树注入 font-size，连带影响 Monaco
 * 内部按继承取字号的浮层控件，副作用面太大。
 */
function applyEditorFontVar(): void {
  document.documentElement.style.setProperty("--editor-font-size", `${app.settings.font_size}px`);
}

/** 字号生效后的统一收口：状态栏文案 + CSS 变量镜像。
 *  init（main.ts 建完编辑器）、Ctrl+滚轮缩放、设置保存三条路径都只调本函数，故镜像放这里一处全覆盖。 */
export function applyFontStatus(): void {
  statusFontEl.textContent = `字号 ${app.settings.font_size}`;
  applyEditorFontVar();
}

/** 由 Settings 构造 Monaco 编辑器选项（P1：外观/编辑器高频项收敛）。
 *  注：tabSize / insertSpaces 属 model 层选项（Monaco ITextModel），经 applyModelIndent 应用。 */
export function buildEditorOptions(settings: Settings): MonacoApi.editor.IEditorOptions {
  const opts: MonacoApi.editor.IEditorOptions = {
    fontSize: settings.font_size,
    fontLigatures: settings.font_ligatures,
    wordWrap: settings.word_wrap === "on" ? "on" : "off",
    minimap: { enabled: settings.minimap },
    // C-6（PyCharm 调研）：可读性——缩进参考线（含当前层级高亮）+ 括号彩色化。
    // 旧配置无这两个字段时 serde(default) 落在 false，故用 `!== false` 兜底为开。
    guides: {
      indentation: settings.indent_guides !== false,
      highlightActiveIndentation: settings.indent_guides !== false,
    },
    bracketPairColorization: { enabled: settings.bracket_colors !== false },
    // 方案 2：收窄行号右侧的折叠箭头区。Monaco 默认 lineDecorationsWidth=10，且 folding 开启时
    // 会再 +16（实际约 26px，其中大半是只有少数带折叠箭头的行才占用的空白）。压到 6 让 gutter 更紧凑。
    lineDecorationsWidth: 6,
    // 方案 3：行号列最小宽度。Monaco 默认 minChars=5，行号数字右对齐，短文件里数字左侧会留
    // 大片空，视觉上拉大了「断点红点 ↔ 行号数字」的距离——这才是红点与行号间空白的头号来源。
    // 压到 3；文件行数变多时仍按实际位数自动伸缩。
    lineNumbersMinChars: 3,
    // PR-B：粘性滚动（Monaco 0.52 内建 stickyScroll；旧配置无字段时兜底为开，同 C-6 惯例）
    stickyScroll: { enabled: settings.sticky_scroll !== false },
  };
  const family = settings.font_family.trim();
  if (family) opts.fontFamily = family;
  // UI-11：「减少动画」也要管住 Monaco 内部动画——CSS 的 --motion 倍率到不了编辑器内部，
  // 而光标闪烁是编辑器里最显眼的常驻动画。本函数是创建（main.ts:2315 展开）与设置变更
  // （applySettings 的 updateOptions）的唯一共用入口，故在此一处写入即全覆盖。
  //
  // 必须【双向】显式赋值：updateOptions 是合并语义，未列出的项不会复位到默认值。
  // 若只在开启时写 "solid"，关掉开关后光标会一直不闪、直到重启才恢复。
  // "blink" 正是 Monaco 出厂默认，故未开启减少动画时行为与改动前完全一致。
  opts.cursorBlinking = motionDisabled() ? "solid" : "blink";
  // 下面两项出厂即为关闭，此处显式写出：一是表明「本开关负责管住它们」，
  // 二是将来若别处打开了，也会随本函数一并关回去。
  opts.smoothScrolling = false;
  opts.cursorSmoothCaretAnimation = "off";
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
    input.autocomplete = "off";
    input.id = kbInputId(m.id);
    input.placeholder = m.def;
    input.spellcheck = false;
    label.htmlFor = input.id; // 遗留修复：动态生成的行同样要 label↔控件关联（读屏聚焦输入框报得出动作名）
    wireKeybindingCapture(input); // UX：改为「按键录入」，不必手写字面量
    row.append(label, input);
    container.appendChild(row);
  }
}

/** 修饰键的 keydown/keyup（用于「按住 Ctrl 还没按主键」的预览与回退） */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** 写入键位输入框并同步「已成键基线」（回退/预览以基线为准，见 wireKeybindingCapture） */
function setKeybindingValue(input: HTMLInputElement, v: string): void {
  input.value = v;
  input.dataset.kbCommitted = v;
}

/**
 * 快捷键输入框改「按键录入」（PyCharm / VS Code 同款）：聚焦后直接按组合键即写入，
 * 不再是逐字母手输字面量（用户按 Ctrl+0 想改保存键时，此前只会触发浏览器/外壳行为）。
 * 语义：
 * - 主键按下即成键（"Ctrl+0"）；按住修饰键未成键时显示 "Ctrl+" 预览，抬起回退到基线；
 * - Backspace / Delete 清空（= 解绑）；Esc 撤销本次录入（吞掉事件，避免连带关闭面板丢掉其它未保存改动）；
 * - Tab 不拦截（保留键盘在表单里移动焦点）；输入框 readOnly，杜绝 IME/手输产生非键位串文本。
 */
function wireKeybindingCapture(input: HTMLInputElement): void {
  input.readOnly = true;
  input.title = "点击后直接按下要使用的组合键；Backspace 清除（留空 = 解绑）";
  const committed = (): string => input.dataset.kbCommitted ?? input.value;
  const commit = (v: string): void => setKeybindingValue(input, v);
  input.addEventListener("focus", () => input.classList.add("kb-capture"));
  input.addEventListener("blur", () => {
    input.classList.remove("kb-capture");
    input.value = committed(); // 离开时丢弃未成键的预览
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation(); // 不让 event 冒泡到 window 级快捷键分发（虽已按 INPUT 排除，仍显式隔离）
    if (e.key === "Escape") {
      input.value = committed();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      commit("");
      return;
    }
    if (MODIFIER_KEYS.has(e.key)) {
      const mods = modsFromEvent(e);
      input.value = mods.length > 0 ? `${mods.join("+")}+` : ""; // 预览：等主键
      return;
    }
    const chord = chordFromEvent(e);
    if (chord) commit(chord);
  });
  input.addEventListener("keyup", (e) => {
    if (!MODIFIER_KEYS.has(e.key)) return;
    if (input.value !== committed()) input.value = committed(); // 只按了修饰键：回退预览
  });
}

/** 读取快捷键表单 → id → 键位串（已 trim；未成键的预览回退到基线） */
function readKeybindingForm(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of KEYBINDING_META) {
    const input = document.getElementById(kbInputId(m.id)) as HTMLInputElement | null;
    const raw = (input?.value ?? "").trim();
    map[m.id] = raw.endsWith("+") ? (input?.dataset.kbCommitted ?? "").trim() : raw;
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

/** 终端 shell 别名 → 展示名（与 index.html 初始下拉、termUi 菜单文案保持一致） */
const TERMINAL_SHELL_LABELS: Record<string, string> = {
  auto: "自动（PowerShell 优先，回退 cmd）",
  pwsh: "PowerShell 7（pwsh）",
  powershell: "Windows PowerShell",
  cmd: "命令提示符（cmd）",
};

/** 按后端探测结果重建「终端 Shell」下拉（auto 恒保留，其余仅列出可用项）并回填当前值。
 * 回填逻辑：优先保持 select 当前值（openSettingsPanel 先 fillForm、reset 先填默认），
 * 若该值不在可用列表（如手改配置成机器上没有的 shell）则退为 "auto"。 */
async function refreshTerminalShellSelect(): Promise<void> {
  let avail: string[] = [];
  try {
    avail = await invoke<string[]>("list_shells");
  } catch {
    avail = [];
  }
  const keys = ["auto", ...avail.filter((k) => k !== "auto")];
  const prev = settingsTerminalShellEl.value || "auto";
  settingsTerminalShellEl.textContent = "";
  for (const k of keys) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = TERMINAL_SHELL_LABELS[k] ?? k;
    settingsTerminalShellEl.appendChild(opt);
  }
  settingsTerminalShellEl.value = keys.includes(prev) ? prev : "auto";
}

/** 用给定 settings 填充表单控件 */
function fillForm(settings: Settings): void {
  setSelectedTheme(settings.theme); // UI-26：原为 settingsThemeEl.value = settings.theme
  settingsFontEl.value = String(settings.font_size);
  settingsFontFamilyEl.value = settings.font_family;
  syncFontPreset(settings.font_family);
  settingsReduceMotionEl.checked = reduceMotionEnabled();
  settingsFontLigaturesEl.checked = settings.font_ligatures;
  settingsTabSizeEl.value = String(settings.tab_size);
  settingsInsertSpacesEl.checked = settings.insert_spaces;
  settingsWordWrapEl.value = settings.word_wrap;
  settingsMinimapEl.checked = settings.minimap;
  // 旧配置缺字段时兜底出厂默认（Rust 侧 struct 级 serde(default) 已保证整表缺省）
  settingsKeywordCompletionEl.checked = settings.keyword_completion ?? DEFAULT_SETTINGS.keyword_completion;
  settingsIndentGuidesEl.checked = settings.indent_guides !== false; // C-6
  settingsBracketColorsEl.checked = settings.bracket_colors !== false;
  settingsStickyScrollEl.checked = settings.sticky_scroll !== false; // PR-B
  settingsInlayParamHintsEl.checked = settings.inlay_param_hints !== false; // PR-N
  settingsTrimTrailingEl.checked = settings.trim_trailing_whitespace !== false; // PR-C
  settingsFinalNewlineEl.checked = settings.final_newline !== false;
  // PR-K：默认关，旧配置缺字段时兜底关（与 DEFAULT_SETTINGS 同向，!== true 反向兼容不适用）
  settingsNewFileTemplateEl.checked = settings.new_file_template ?? DEFAULT_SETTINGS.new_file_template;
  // PR-M：默认开，旧配置缺字段兜底开（!== false 惯例）
  settingsPasteJsonEl.checked = settings.paste_json_to_python !== false;
  settingsDebugJmcEl.checked = settings.debug_just_my_code !== false; // B-3
  // 库特别支持 PR-2：默认开，旧配置缺字段兜底开（!== false 惯例）
  settingsLibsEditorLensEl.checked = settings.libs_editor_lens !== false;
  settingsLibsRegexEl.checked = settings.libs_regex !== false;
  settingsLibsFormatEl.checked = settings.libs_format !== false;
  settingsLibsArgparseEl.checked = settings.libs_argparse !== false;
  settingsLibsJsonInjectEl.checked = settings.libs_json_inject !== false;
  settingsLogLevelColorsEl.checked = settings.log_level_colors !== false;
  // 阶段 4：Pydantic 诊断默认开（!== false 惯例）
  settingsPydanticDiagnosticsEl.checked = settings.pydantic_diagnostics !== false;
  settingsAutosaveEl.value = settings.autosave;
  settingsProbeEl.checked = settings.probe_enabled;
  settingsIntelEl.checked = settings.runtime_intel_enabled;
  settingsEngineEl.value = settings.lsp_engine;
  settingsFormatOnSaveEl.checked = settings.format_on_save;
  settingsOptimizeImportsOnSaveEl.checked =
    settings.optimize_imports_on_save ?? DEFAULT_SETTINGS.optimize_imports_on_save;
  // D-4：旧配置缺字段回落 warning（select 的 value 若不在候选中会显示空白，故先归一）
  settingsRuffSeverityEEl.value = normalizeSeverity(settings.ruff_severity_e);
  settingsRuffSeverityWEl.value = normalizeSeverity(settings.ruff_severity_w);
  settingsRuffSeverityFEl.value = normalizeSeverity(settings.ruff_severity_f);
  settingsTerminalCwdEl.value = settings.terminal_cwd;
  settingsTerminalShellEl.value = settings.terminal_shell ?? DEFAULT_SETTINGS.terminal_shell;
  // 旧配置缺 pypi_index 时兜底出厂默认（官方源）
  settingsPypiIndexEl.value = settings.pypi_index || DEFAULT_SETTINGS.pypi_index;
  syncPypiIndexPreset(settingsPypiIndexEl.value);
  // 日志配置（旧配置缺字段时兜底出厂默认）
  settingsLogEnabledEl.checked = settings.log_enabled ?? DEFAULT_SETTINGS.log_enabled;
  settingsLogLevelEl.value = settings.log_level || DEFAULT_SETTINGS.log_level;
  settingsLogKeepEl.value = String(settings.log_keep ?? DEFAULT_SETTINGS.log_keep);
  settingsLogStdoutEl.checked = settings.log_stdout ?? DEFAULT_SETTINGS.log_stdout;
  for (const m of KEYBINDING_META) {
    const input = document.getElementById(kbInputId(m.id)) as HTMLInputElement | null;
    // 经 setKeybindingValue：同步成键基线，否则录入器回退时会用上一次的旧基线
    if (input) setKeybindingValue(input, settings.keybindings[m.id] ?? "");
  }
}

/** UI-05：设置面板模态的焦点陷阱解除句柄 */
let releaseSettingsFocus: (() => void) | null = null;

/** tech-debt #18：Esc 关闭设置面板（document 级，open 时挂、close 时移除）。
 *  守卫：前台有更上层对话框（.modal 显隐约定）时 Esc 归对话框，防连带关闭丢失未保存改动
 * （与 envPanel.onEnvKeydown / bookmarks 同款守卫） */
function onSettingsKeydown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  if (document.querySelectorAll(".modal:not(.hidden)").length > 1) return;
  closeSettingsPanel();
}

/** 打开设置面板（可指定初始分类；「视图 → Live Templates」快捷入口复用） */
export function openSettingsPanel(category: SettingsCategory = "appearance"): void {
  clearSettingsSearch(); // E-1：每次打开重置搜索状态
  // i18n：打开即回显当前语言（语言可能在别处被改过，下拉不能停留在上次打开时的值）
  settingsLocaleEl.value = getLocale();
  fillForm(app.settings);
  void refreshTerminalShellSelect(); // 异步探测可用 shell，完成后重建下拉
  switchCategory(category);
  showEl(settingsModalEl);
  document.addEventListener("keydown", onSettingsKeydown); // tech-debt #18：Esc 关闭
  // UI-05：焦点陷阱（防御性先解除上一次未释放的陷阱，避免异常路径下重复叠加）
  releaseSettingsFocus?.();
  releaseSettingsFocus = trapFocus(settingsModalEl);
}

/** 恢复默认：仅重置表单控件为出厂默认，待用户「保存」才持久化/应用（与「取消」语义对称） */
function resetSettingsPanel(): void {
  fillForm(DEFAULT_SETTINGS);
  void refreshTerminalShellSelect(); // 重建下拉并回填 auto（DEFAULT 值）
  settingsReduceMotionEl.checked = false; // 出厂默认不减少动画
}

function closeSettingsPanel(): void {
  document.removeEventListener("keydown", onSettingsKeydown); // tech-debt #18
  releaseSettingsFocus?.();
  releaseSettingsFocus = null;
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
  const theme = getSelectedTheme(); // UI-26：原为 settingsThemeEl.value
  const fontSize = clampFontSize(Number(settingsFontEl.value), app.settings.font_size);
  const fontFamily = settingsFontFamilyEl.value.trim();
  const fontLigatures = settingsFontLigaturesEl.checked;
  const tabSize = Math.max(1, Math.min(8, Number(settingsTabSizeEl.value) || app.settings.tab_size));
  const insertSpaces = settingsInsertSpacesEl.checked;
  const wordWrap = settingsWordWrapEl.value;
  const minimap = settingsMinimapEl.checked;
  const indentGuides = settingsIndentGuidesEl.checked; // C-6
  const bracketColors = settingsBracketColorsEl.checked;
  const stickyScroll = settingsStickyScrollEl.checked; // PR-B
  const inlayParamHints = settingsInlayParamHintsEl.checked; // PR-N
  const trimTrailing = settingsTrimTrailingEl.checked; // PR-C
  const finalNewline = settingsFinalNewlineEl.checked;
  const newFileTemplate = settingsNewFileTemplateEl.checked; // PR-K
  const pasteJson = settingsPasteJsonEl.checked; // PR-M
  const autosave = settingsAutosaveEl.value;
  const probeEnabled = settingsProbeEl.checked;
  const lspEngine = settingsEngineEl.value;
  const formatOnSave = settingsFormatOnSaveEl.checked;
  const optimizeImportsOnSave = settingsOptimizeImportsOnSaveEl.checked;
  // D-4：严重度映射（select 固定候选；normalizeSeverity 兜底归一，双保险）
  const ruffSeverityE = normalizeSeverity(settingsRuffSeverityEEl.value);
  const ruffSeverityW = normalizeSeverity(settingsRuffSeverityWEl.value);
  const ruffSeverityF = normalizeSeverity(settingsRuffSeverityFEl.value);
  const runtimeIntelEnabled = settingsIntelEl.checked;
  const keywordCompletion = settingsKeywordCompletionEl.checked;
  const terminalCwd = settingsTerminalCwdEl.value;
  const terminalShell = settingsTerminalShellEl.value;
  const pypiIndex = settingsPypiIndexEl.value.trim();
  const logEnabled = settingsLogEnabledEl.checked;
  const logLevel = settingsLogLevelEl.value;
  const logKeep = Math.max(1, Math.min(10, Number(settingsLogKeepEl.value) || DEFAULT_SETTINGS.log_keep));
  const logStdout = settingsLogStdoutEl.checked;
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
    indent_guides: indentGuides,
    bracket_colors: bracketColors,
    sticky_scroll: stickyScroll,
    inlay_param_hints: inlayParamHints,
    trim_trailing_whitespace: trimTrailing,
    final_newline: finalNewline,
    new_file_template: newFileTemplate, // PR-K
    paste_json_to_python: pasteJson, // PR-M
    debug_just_my_code: settingsDebugJmcEl.checked, // B-3
    libs_editor_lens: settingsLibsEditorLensEl.checked, // 库支持 PR-2
    libs_regex: settingsLibsRegexEl.checked, // 库支持 PR-2
    libs_format: settingsLibsFormatEl.checked, // 库支持 PR-3
    libs_argparse: settingsLibsArgparseEl.checked, // 库支持 PR-4
    libs_json_inject: settingsLibsJsonInjectEl.checked, // 库支持 P1
    log_level_colors: settingsLogLevelColorsEl.checked, // 库支持 P1
    pydantic_diagnostics: settingsPydanticDiagnosticsEl.checked, // 阶段 4
    autosave,
    autosave_delay: app.settings.autosave_delay,
    probe_enabled: probeEnabled,
    lsp_engine: lspEngine,
    format_on_save: formatOnSave,
    optimize_imports_on_save: optimizeImportsOnSave,
    ruff_severity_e: ruffSeverityE,
    ruff_severity_w: ruffSeverityW,
    ruff_severity_f: ruffSeverityF,
    runtime_intel_enabled: runtimeIntelEnabled,
    keyword_completion: keywordCompletion,
    terminal_cwd: terminalCwd,
    terminal_shell: terminalShell,
    pypi_index: pypiIndex,
    keybindings,
    log_enabled: logEnabled,
    log_level: logLevel,
    log_keep: logKeep,
    log_stdout: logStdout,
  };
  // P1 副作用表：外观/编辑器即时生效（model 层缩进单独应用）；引擎变化重启；intel 变化起停
  app.monaco.editor.setTheme(theme);
  applyShellTheme(theme); // D1：外壳 CSS 主题与 Monaco 同步切换
  refreshTerminalThemes(); // D1：已打开的终端实例重套深浅配色
  // UI-29：已打开的终端实例跟随新字号/字体族（内部含 refit + PTY resize）。
  // 两个 devtools 只读预览器沿用第四批 UI-11 的既定裁决——随工具挂载新建、创建时读一次设置，
  // 重新挂载（切换工具 / 收起再展开面板）即刷新，不做运行时接线。
  refreshTerminalFonts();
  applyReduceMotion(settingsReduceMotionEl.checked); // D3：「减少动画」开关
  // UI-11：同步已存在的终端实例（光标闪烁）。这条路径不能省——「恢复默认」是直接给
  // .checked 赋值的，不会派发 change 事件，故下方那个即时生效的监听器不会被触发。
  refreshTerminalMotion();
  app.editor.updateOptions(buildEditorOptions(app.settings)); // UI-11：内部按 motionDisabled() 决定光标闪烁
  applyModelIndent(app.settings);
  // 关键字补全开关：provider 内部短路，不重注册（「恢复默认」同样经本路径落地）
  setKeywordCompletionEnabled(app.settings.keyword_completion);
  applyFontStatus();
  applyEditorKeybindings(); // 编辑器级键位即时重建（window 级实时匹配无需处理）
  refreshSplitEditorOptions(); // C-4：分屏编辑器同源 options（字号/主题/连字等即时生效）
  repaintRunWidget(); // 改键后运行组 tooltip 副文本跟随新键位（window 级键位变化不走 renderTabs）
  // UI-25：欢迎页快捷键网格同理——保存路径不经 updateEditorOverlay，不显式刷就会留着旧键位
  renderWelcomeShortcuts();
  // PR-N：参数名提示开关 → 立即把 inlay 配置推给静态引擎（引擎侧 150ms 防抖，无需重启引擎）
  void lsp.pushInlayHintSettings();
  // 库支持 P1：日志级别着色开关即时生效（既有行重刷 + chips 显隐，research §11.9）
  applyOutputLevelSetting(outputEl);
  syncOutputLevelChips();
  await saveSettings();
  toast("设置已保存", "success"); // tech-debt #19：即时操作结果统一轻提示
  // D-4：严重度映射保存后立即重查当前文件（波浪线级别即时生效，无需等下次编辑）
  void lintActiveFile();
  // 阶段 4：Pydantic 诊断开关即时生效（开→立扫，关→清空）
  refreshPydanticDiagnostics();
  closeSettingsPanel();

  if (engineChanged) {
    renderEngineChip(); // 真值已写入 app.settings.lsp_engine，chip 从 settings 读取（不再写 DOM select）
    await sh().startLsp();
  } else if (intelChanged) {
    // 运行时智能层开关变化：只起停 intel，不重启静态引擎（P3-T09 一键关闭）
    await applyIntelToggle(runtimeIntelEnabled);
  }
}

/** 一键开启/关闭运行时智能层（opencharm-intel），不影响静态引擎 */
async function applyIntelToggle(enabled: boolean): Promise<void> {
  if (!app.workspaceRoot) return;
  if (enabled) {
    const rootUri = lsp.workspaceRootUri(app.workspaceRoot); // CR-29：正确百分号编码
    try {
      await lsp.startIntel(app.workspaceRoot, rootUri);
      for (const t of app.tabs) lsp.didOpen(t.path, t.model);
    } catch (e) {
      toastFail("启动运行时智能层", e);
    }
  } else {
    await lsp.stopIntel();
  }
}

// ---------- 事件接线 ----------

/** 接线设置面板交互（菜单栏齿轮 + 分类导航 + 面板内按钮 + 遮罩点击关闭） */
export function wireSettingsPanel(): void {
  renderKeybindingRows(); // 快捷键分区行一次性构建（值由 fillForm 填充）
  wireThemePicker(); // UI-26：主题预览色卡（卡片构建 + radiogroup 键盘导航；值由 fillForm 填充）
  // UI-24：窄窗口断点下分类导航转横排，aria-orientation 随之同步（先跑一次覆盖「启动即窄窗口」）
  syncNavOrientation();
  window.matchMedia(NARROW_NAV_QUERY).addEventListener("change", syncNavOrientation);
  // i18n：切换语言即时生效并持久化（不经过「保存」——语言不是 Settings 字段，见 index.html 对应注释）。
  // setLocale 内部会重刷静态骨架并广播给订阅者重绘动态内容，这里无需再调 applyDomI18n。
  settingsLocaleEl.addEventListener("change", () => {
    const v = settingsLocaleEl.value;
    if (v === "zh-CN" || v === "en-US") setLocale(v);
  });
  $btn("btn-settings").addEventListener("click", () => openSettingsPanel());
  $btn("settings-close").addEventListener("click", closeSettingsPanel);
  $btn("settings-cancel").addEventListener("click", closeSettingsPanel);
  $btn("settings-save").addEventListener("click", () => saveSettingsPanel());
  $btn("settings-reset").addEventListener("click", resetSettingsPanel);
  document.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((b) => {
    b.addEventListener("click", () => {
      clearSettingsSearch(); // E-1：切分类即退出搜索态（搜索覆盖所有分类，与单分类视图互斥）
      switchCategory((b.dataset.cat ?? "appearance") as SettingsCategory);
    });
  });
  // E-1：设置搜索（防抖 150ms；空态提供「查找快捷键」跳转）
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  settingsSearchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySettingsFilter(settingsSearchEl.value), 150);
  });
  $("settings-search-goto-kb").addEventListener("click", () => {
    clearSettingsSearch();
    switchCategory("keybindings");
  });
  // tech-debt #18：含可编辑内容，点遮罩不关闭（仅 X / 取消 / Esc 关闭）
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
  // UI-11：开关即时生效。CSS 侧靠 applyReduceMotion 切换 html[data-reduce-motion] 立即生效，
  // 这里补上两个管不到的地方：已存在的终端实例、以及主编辑器光标。
  // 编辑器只单独写 cursorBlinking，不调 buildEditorOptions(app.settings)——后者会读「已保存」的
  // settings，在用户还没点保存时套用，会把表单里正在调整的字号/字体等改动先视觉回退掉。
  settingsReduceMotionEl.addEventListener("change", () => {
    applyReduceMotion(settingsReduceMotionEl.checked);
    refreshTerminalMotion();
    app.editor?.updateOptions({ cursorBlinking: motionDisabled() ? "solid" : "blink" });
  });
  // 日志：打开日志目录（系统资源管理器）
  settingsLogOpenEl.addEventListener("click", () => {
    invoke("open_log_dir").catch((e) => toastFail("打开日志目录", e));
  });
  // 数据：打开数据根目录（系统资源管理器）
  settingsDataOpenEl.addEventListener("click", () => {
    invoke("open_data_dir").catch((e) => toastFail("打开数据目录", e));
  });
  // 存储：占用可视化 / 清理 / 迁移（storagePanel.ts）
  wireStoragePanel();
}