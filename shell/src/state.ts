// AppState 上下文对象（TD-007）：收敛原 main.ts 中跨功能域共享的模块级状态与 DOM 引用。
// 各功能域模块（fileTree / git / termUi / settingsPanel）经 app 读写共享状态；
// 域内私有状态（如文件树选中集、Git 变更列表、终端会话）仍留在各域模块内部。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";

export type MonacoModule = typeof MonacoApi;

/** 文件树条目 */
export interface Entry { name: string; path: string; is_dir: boolean }

/** 打开的文件标签 */
export interface Tab {
  path: string;
  model: MonacoApi.editor.ITextModel;
  dirty: boolean;
}

/** 全局设置（P25-T08/T09；P1 扩展编辑器高频项） */
export interface Settings {
  theme: string;
  font_size: number;
  font_family: string;
  font_ligatures: boolean;
  tab_size: number;
  insert_spaces: boolean;
  word_wrap: string;
  minimap: boolean;
  autosave: string;
  autosave_delay: number;
  probe_enabled: boolean;
  lsp_engine: string;
  format_on_save: boolean;
  runtime_intel_enabled: boolean;
  terminal_cwd: string;
  /** 集成终端 shell："auto" | "pwsh" | "powershell" | "cmd"（auto 按顺序回退） */
  terminal_shell: string;
  /** PyPI 包源（uv 拉取依赖用；默认官方源，国内网络可切镜像） */
  pypi_index: string;
  /** 快捷键自定义（id → 键位串如 "Ctrl+D"；空串 = 解绑）。
   *  id 清单与出厂默认见 keybindings.ts 的 KEYBINDING_META（两处须同步）。 */
  keybindings: Record<string, string>;
  /** 日志：总开关（关闭后仅 error 仍落盘） */
  log_enabled: boolean;
  /** 日志级别阈值："error" | "warn" | "info" | "debug" */
  log_level: string;
  /** 日志轮转保留份数（1-10） */
  log_keep: number;
  /** 日志是否同时打印 stdout（dev 终端可见；release 无控制台可关） */
  log_stdout: boolean;
}

/** Settings 出厂默认值（「恢复默认」与 app.settings 初始值共用；须与 Rust Settings::default 保持一致） */
export const DEFAULT_SETTINGS: Settings = {
  theme: "vs-dark",
  font_size: 14,
  // D3 P-14：显式常用等宽栈（须与 Rust Settings::default 保持同步）
  font_family: 'Consolas, "Cascadia Code", "JetBrains Mono", monospace',
  font_ligatures: false,
  tab_size: 4,
  insert_spaces: true,
  word_wrap: "off",
  minimap: false,
  autosave: "off",
  autosave_delay: 1000,
  probe_enabled: true,
  lsp_engine: "pyrefly",
  format_on_save: false,
  runtime_intel_enabled: true,
  terminal_cwd: "workspace",
  terminal_shell: "auto",
  // PyPI 包源默认官方源（须与 Rust Settings::default 保持同步）
  pypi_index: "https://pypi.org/simple",
  // 出厂默认键位（PyCharm 风格）：与 keybindings.ts KEYBINDING_META 的 def、
  // Rust settings.rs default_keybindings 三处保持同步（keybindings.test.ts 有漂移锁）。
  keybindings: {
    save: "Ctrl+S",
    run: "Ctrl+F10",
    stop: "Ctrl+F2",
    run_selection: "Alt+Shift+E",
    global_search: "Ctrl+Shift+F",
    goto_definition: "Ctrl+B",
    duplicate_line: "Ctrl+D",
    comment_line: "Ctrl+/",
    comment_block: "Ctrl+Shift+/",
    template_palette: "Ctrl+J",
    surround: "Ctrl+Alt+T",
    // 调试五件套（debug dev plan §6.6；三处同步：此处 / keybindings.ts META / Rust default_keybindings）
    debug: "F5",
    debug_stop: "Shift+F5",
    debug_step_over: "F10",
    debug_step_into: "F11",
    debug_step_out: "Shift+F11",
    // Markdown 预览开关（与 keybindings.ts META / Rust default_keybindings 三处同步）
    markdown_preview: "Ctrl+Shift+V",
  },
  // 日志默认（须与 Rust settings.rs Default 保持同步）
  log_enabled: true,
  log_level: "info",
  log_keep: 3,
  log_stdout: false,
};

export interface AppState {
  /** Monaco 模块（init 动态加载后赋值；此前访问即为 bug——getter 抛出带上下文的错误） */
  monaco: MonacoModule;
  /** 主编辑器（init 创建后赋值；约定同 monaco） */
  editor: MonacoApi.editor.IStandaloneCodeEditor;
  /** 当前工作区根路径（null = 无工作区） */
  workspaceRoot: string | null;
  /** 打开的标签页 */
  tabs: Tab[];
  /** 当前激活标签 */
  activeTab: Tab | null;
  /** 待同步的文件（200ms 防抖后发全量 didChange） */
  pendingChanges: Set<string>;
  /** 全局设置 */
  settings: Settings;
}

// CR-26：私有存储 + getter 抛错——原 `null as unknown as T` 双重断言把「初始化前访问」
// 变成静默 undefined 崩溃（错误信息晦涩、远离根因）。现在：
// - 类型保持非空（正常路径零判空，90+ 调用点无需改动）；
// - init 前访问立即抛出带上下文的清晰错误。
let _monaco: MonacoModule | null = null;
let _editor: MonacoApi.editor.IStandaloneCodeEditor | null = null;

export const app: AppState = {
  get monaco(): MonacoModule {
    if (_monaco === null) throw new Error("[OpenCharm] Monaco 尚未初始化（app.monaco 在 init 动态加载后才可用）");
    return _monaco;
  },
  set monaco(m: MonacoModule) {
    _monaco = m;
  },
  get editor(): MonacoApi.editor.IStandaloneCodeEditor {
    if (_editor === null) throw new Error("[OpenCharm] 编辑器尚未初始化（app.editor 在 init 创建后才可用）");
    return _editor;
  },
  set editor(e: MonacoApi.editor.IStandaloneCodeEditor) {
    _editor = e;
  },
  workspaceRoot: null,
  tabs: [],
  activeTab: null,
  pendingChanges: new Set<string>(),
  settings: { ...DEFAULT_SETTINGS },
};

// ---------- DOM 工具 ----------

/**
 * CR-26：按 id 取元素（找不到即抛错——原 `as T` 断言 90+ 调用点 id 拼错只在
 * 运行时静默 undefined，后续属性访问报晦涩错误）。合并 manager.ts:98 的同名实现。
 */
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

/** 按钮专用（语义 + 类型收窄；同样抛错） */
export const $btn = (id: string): HTMLButtonElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}（应为 <button>）`);
  return el as HTMLButtonElement;
};

/** 跨域共享 DOM 引用（被 2 个以上域模块引用的才放这里，其余各域自行缓存）。
 * CR-26：改惰性 Proxy——模块加载期（含测试环境的 jsdom/happy-dom，无完整 DOM）
 * 不再因顶层快照抛错；首次属性访问时才解析（生产 DOM 在入口 HTML 静态存在）。
 * 导出供各域模块的顶层 DOM 快照统一使用（如 fileTree 的 treeEl、dialog 的 modalEl）。 */
export function lazyEl<T extends HTMLElement = HTMLElement>(id: string): T {
  let cached: T | null = null;
  const resolve = (): T => (cached ??= $(id) as T);
  return new Proxy({} as T, {
    get(_t, prop) {
      const el = resolve();
      const v = Reflect.get(el, prop, el); // receiver 用真实元素：Proxy 非真实 Element/Node 子类
      if (typeof v === "function") return v.bind(el); // DOM 方法必须以真实元素为 this
      return v;
    },
    set(_t, prop, value) {
      const el = resolve();
      return Reflect.set(el, prop, value, el);
    },
    has(_t, prop) {
      return Reflect.has(resolve(), prop);
    },
  });
}

/** 输出面板元素（惰性解析，见 lazyEl 说明） */
export const outputEl: HTMLElement = lazyEl("output");
/** 状态栏文件路径元素（惰性解析） */
export const statusFileEl: HTMLElement = lazyEl("status-file");
