// 快捷键配置域：PyCharm 风格默认键位 + 用户自定义（设置 → 快捷键）。
// 分发分两层：
// - window 级（save / run / global_search）：main.ts 的 window keydown 经 matchWindowBinding
//   实时读取 app.settings.keybindings 匹配，改键即时生效；
// - editor 级（跳转定义 / 复制行 / 注释 / 模板入口）：initKeybindingCommands 一次性注册
//   稳定命令（monaco.editor.addCommand），applyEditorKeybindings 按设置重建
//   键 → 命令映射（monaco.editor.addKeybindingRules，可反复重建）。
//   动态规则权重高于 Monaco 内建键位，同键可覆盖（如 Ctrl+D 内建「选中下一匹配」）。
// 出厂默认值三处同步：KEYBINDING_META.def / state.ts DEFAULT_SETTINGS / Rust default_keybindings。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, type MonacoModule } from "./state";

export type KeybindingId =
  | "save"
  | "run"
  | "stop"
  | "run_selection"
  | "global_search"
  | "goto_definition"
  | "duplicate_line"
  | "comment_line"
  | "comment_block"
  | "template_palette"
  | "surround"
  | "debug"
  | "debug_stop"
  | "debug_step_over"
  | "debug_step_into"
  | "debug_step_out"
  | "markdown_preview";

export interface KeybindingMeta {
  id: KeybindingId;
  /** 设置面板显示名 */
  label: string;
  /** 出厂默认键位 */
  def: string;
  /** window = 全局生效；editor = 仅编辑器聚焦时生效 */
  scope: "window" | "editor";
}

export const KEYBINDING_META: KeybindingMeta[] = [
  { id: "save", label: "保存", def: "Ctrl+S", scope: "window" },
  { id: "run", label: "运行当前文件", def: "Ctrl+F10", scope: "window" },
  { id: "stop", label: "停止运行", def: "Ctrl+F2", scope: "window" },
  { id: "run_selection", label: "运行选区 / 行", def: "Alt+Shift+E", scope: "editor" },
  { id: "global_search", label: "全局搜索", def: "Ctrl+Shift+F", scope: "window" },
  { id: "goto_definition", label: "跳转定义（F12 / Ctrl+点击固定保留）", def: "Ctrl+B", scope: "editor" },
  { id: "duplicate_line", label: "复制行 / 选区", def: "Ctrl+D", scope: "editor" },
  { id: "comment_line", label: "行注释开关", def: "Ctrl+/", scope: "editor" },
  { id: "comment_block", label: "块注释开关", def: "Ctrl+Shift+/", scope: "editor" },
  { id: "template_palette", label: "Live Templates 面板", def: "Ctrl+J", scope: "editor" },
  { id: "surround", label: "环绕模板（需选区）", def: "Ctrl+Alt+T", scope: "editor" },
  // 调试五件套（debug dev plan §6.6；window 级——调试中编辑器可能失焦）
  { id: "debug", label: "启动调试 / 继续", def: "F5", scope: "window" },
  { id: "debug_stop", label: "停止调试", def: "Shift+F5", scope: "window" },
  { id: "debug_step_over", label: "单步跳过", def: "F10", scope: "window" },
  { id: "debug_step_into", label: "单步进入", def: "F11", scope: "window" },
  { id: "debug_step_out", label: "单步退出", def: "Shift+F11", scope: "window" },
  // Markdown 预览开关（markdown preview dev plan §5-T4；window 级——编辑器聚焦/失焦均可用）
  { id: "markdown_preview", label: "Markdown 预览", def: "Ctrl+Shift+V", scope: "window" },
];

// ---------- 解析 ----------

/** 解析结果：key 同时是 KeyboardEvent.code 与 Monaco KeyCode 枚举名（如 KeyD / Digit1 / Slash / F10） */
export interface ParsedBinding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const SYMBOL_KEYS: Record<string, string> = {
  "/": "Slash",
  "\\": "Backslash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
};

const NAMED_KEYS = [
  "Enter", "Tab", "Space", "Backspace", "Delete", "Escape",
  "Home", "End", "PageUp", "PageDown",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
];

/** 单个键名 → 标准 key 码；非法返回 null */
export function parseKeyToken(token: string): string | null {
  if (/^[A-Za-z]$/.test(token)) return "Key" + token.toUpperCase();
  if (/^[0-9]$/.test(token)) return "Digit" + token;
  const f = /^F([1-9]|1[0-9]|2[0-4])$/i.exec(token);
  if (f) return "F" + f[1];
  const sym = SYMBOL_KEYS[token];
  if (sym) return sym;
  const named = NAMED_KEYS.find((n) => n.toLowerCase() === token.toLowerCase());
  return named ?? null;
}

/** 解析 "Ctrl+Shift+F" 形式的键位串；空串 / 非法格式 / 未知键名返回 null */
export function parseBinding(raw: string): ParsedBinding | null {
  const tokens = raw.split("+").map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  let ctrl = false;
  let shift = false;
  let alt = false;
  for (const t of tokens.slice(0, -1)) {
    const k = t.toLowerCase();
    if (k === "ctrl" || k === "control") ctrl = true;
    else if (k === "shift") shift = true;
    else if (k === "alt") alt = true;
    else return null; // 修饰键位置出现非修饰词（如 "Ctrl+X+Y"）
  }
  const key = parseKeyToken(tokens[tokens.length - 1]);
  if (!key) return null;
  return { ctrl, shift, alt, key };
}

/** 归一化（修饰键固定序 + key 码），用于冲突检测；非法返回 null */
export function normalizeBinding(raw: string): string | null {
  const p = parseBinding(raw);
  if (!p) return null;
  const mods = [p.ctrl ? "Ctrl" : "", p.shift ? "Shift" : "", p.alt ? "Alt" : ""].filter(Boolean);
  return [...mods, p.key].join("+");
}

// ---------- 校验 ----------

/** 校验键位表：各键可解析、互不冲突；返回错误消息，null = 通过 */
export function validateKeybindingMap(map: Record<string, string>): string | null {
  const seen = new Map<string, string>();
  for (const m of KEYBINDING_META) {
    const raw = (map[m.id] ?? "").trim();
    if (!raw) continue; // 空 = 解绑，合法
    if (!parseBinding(raw)) return `快捷键「${m.label}」格式无效：${raw}`;
    const norm = normalizeBinding(raw);
    if (!norm) return `快捷键「${m.label}」格式无效：${raw}`;
    const dup = seen.get(norm);
    if (dup) return `快捷键「${m.label}」与「${dup}」冲突（${norm}）`;
    seen.set(norm, m.label);
  }
  return null;
}

// ---------- window 级匹配 ----------

/** 按键事件是否匹配给定解析结果（Ctrl 兼容 Cmd） */
export function eventMatches(e: KeyboardEvent, p: ParsedBinding): boolean {
  return (
    e.code === p.key &&
    (e.ctrlKey || e.metaKey) === p.ctrl &&
    e.shiftKey === p.shift &&
    e.altKey === p.alt
  );
}

/** 从 window 级快捷键中找出与事件匹配的项；无匹配返回 null（实时读设置，改键即生效） */
export function matchWindowBinding(e: KeyboardEvent): KeybindingId | null {
  for (const m of KEYBINDING_META) {
    if (m.scope !== "window") continue;
    const raw = (app.settings.keybindings[m.id] ?? "").trim();
    if (!raw) continue;
    const p = parseBinding(raw);
    if (p && eventMatches(e, p)) return m.id;
  }
  return null;
}

/** 当前键位显示文本（菜单标签用；解绑时返回空串） */
export function bindingLabel(id: KeybindingId): string {
  return (app.settings.keybindings[id] ?? "").trim();
}

/** 修饰键的规范显示形（用户可能写成 control/CTRL 等，显示时统一） */
const MOD_DISPLAY: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  alt: "Alt",
};

/** 键位串 → 逐段显示 token（"Ctrl+Shift+F" → ["Ctrl","Shift","F"]），供 <kbd> 分段渲染（UI-25 欢迎页）。
 *  与 tooltip 的 data-tip-key 分工不同：那里是整串一个 kbd 框（浮层空间紧张），这里是每段一个框。
 *  规则：修饰键按 MOD_DISPLAY 归一大小写；末位单字母/数字转大写（用户写 "ctrl+s" 也显示 "S"）；
 *  其余功能键/符号原样保留（F10、Slash 等由用户自己写）。
 *  无法解析的串（parseBinding 判非法，如 "Ctrl+X+Y"）整串作一段返回——不猜拆法，也不丢信息。
 *  空串返回 []（调用方据此显示「未绑定」占位，而不是渲染一个空 kbd 框）。 */
export function bindingChord(raw: string): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const tokens = s.split("+").map((t) => t.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  if (!parseBinding(s)) return [s];
  const last = tokens.length - 1;
  return tokens.map((t, i) => {
    const mod = MOD_DISPLAY[t.toLowerCase()];
    if (mod) return mod;
    if (i === last && t.length === 1) return t.toUpperCase(); // 末位主键：单字符统一大写
    return t;
  });
}

// ---------- editor 级命令与映射 ----------

const COMMAND_PREFIX = "opencharm.kb.";
const handlers = new Map<KeybindingId, () => void>();
let commandsRegistered = false;
let rulesDisposable: MonacoApi.IDisposable | null = null;

/** 设置/替换某快捷键命令的实际处理函数（可多次调用，后设者生效） */
export function setKeybindingHandler(id: KeybindingId, fn: () => void): void {
  handlers.set(id, fn);
}

/** 复制当前行（空选区）或选区覆盖的行（PyCharm Ctrl+D 语义），光标位置不变 */
function duplicateCurrentLine(): void {
  const editor = app.editor;
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;
  const lines: string[] = [];
  for (let l = sel.startLineNumber; l <= sel.endLineNumber; l++) {
    lines.push(model.getLineContent(l));
  }
  const endLine = sel.endLineNumber;
  const endCol = model.getLineMaxColumn(endLine);
  editor.executeEdits("opencharm-duplicate", [
    {
      range: new app.monaco.Range(endLine, endCol, endLine, endCol),
      text: "\n" + lines.join("\n"),
    },
  ]);
}

/** 一次性注册 editor 级稳定命令（幂等）；键 → 命令映射由 applyEditorKeybindings 建立 */
export function initKeybindingCommands(monaco: MonacoModule): void {
  if (commandsRegistered) return;
  commandsRegistered = true;
  setKeybindingHandler("duplicate_line", duplicateCurrentLine);
  setKeybindingHandler("comment_line", () => {
    app.editor.trigger("keybindings", "editor.action.commentLine", null);
  });
  setKeybindingHandler("comment_block", () => {
    app.editor.trigger("keybindings", "editor.action.blockComment", null);
  });
  for (const m of KEYBINDING_META) {
    if (m.scope !== "editor") continue;
    monaco.editor.addCommand({
      id: COMMAND_PREFIX + m.id,
      run: () => handlers.get(m.id)?.(),
    });
  }
}

/** ParsedBinding → Monaco keybinding 数值；未知键返回 null */
export function toMonacoKeybinding(monaco: MonacoModule, p: ParsedBinding): number | null {
  const code = (monaco.KeyCode as unknown as Record<string, number | undefined>)[p.key];
  if (code === undefined) return null;
  let kb = code;
  if (p.ctrl) kb |= monaco.KeyMod.CtrlCmd;
  if (p.shift) kb |= monaco.KeyMod.Shift;
  if (p.alt) kb |= monaco.KeyMod.Alt;
  return kb;
}

/** 按当前设置（重新）建立 editor 级键 → 命令映射；初始化与设置保存后调用 */
export function applyEditorKeybindings(): void {
  const monaco = app.monaco;
  rulesDisposable?.dispose();
  rulesDisposable = null;
  const rules: MonacoApi.editor.IKeybindingRule[] = [];
  for (const m of KEYBINDING_META) {
    if (m.scope !== "editor") continue;
    const raw = (app.settings.keybindings[m.id] ?? "").trim();
    if (!raw) continue; // 解绑：不注册（Monaco 内建同键行为可能恢复，属预期）
    const p = parseBinding(raw);
    if (!p) continue;
    const kb = toMonacoKeybinding(monaco, p);
    if (kb === null) continue;
    rules.push({ keybinding: kb, command: COMMAND_PREFIX + m.id, when: "editorTextFocus" });
  }
  if (rules.length > 0) rulesDisposable = monaco.editor.addKeybindingRules(rules);
}
