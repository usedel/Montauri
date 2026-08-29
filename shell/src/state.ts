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
  // PyPI 包源默认官方源（须与 Rust Settings::default 保持同步）
  pypi_index: "https://pypi.org/simple",
  // 出厂默认键位（PyCharm 风格）：与 keybindings.ts KEYBINDING_META 的 def、
  // Rust settings.rs default_keybindings 三处保持同步（keybindings.test.ts 有漂移锁）。
  keybindings: {
    save: "Ctrl+S",
    run: "Ctrl+F10",
    run_selection: "Alt+Shift+E",
    global_search: "Ctrl+Shift+F",
    goto_definition: "Ctrl+B",
    duplicate_line: "Ctrl+D",
    comment_line: "Ctrl+/",
    comment_block: "Ctrl+Shift+/",
    template_palette: "Ctrl+J",
    surround: "Ctrl+Alt+T",
  },
  // 日志默认（须与 Rust settings.rs Default 保持同步）
  log_enabled: true,
  log_level: "info",
  log_keep: 3,
  log_stdout: false,
};

export interface AppState {
  /** Monaco 模块（init 动态加载后赋值；此前访问即为 bug，类型标非空以免各域散落判空） */
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

export const app: AppState = {
  monaco: null as unknown as MonacoModule,
  editor: null as unknown as MonacoApi.editor.IStandaloneCodeEditor,
  workspaceRoot: null,
  tabs: [],
  activeTab: null,
  pendingChanges: new Set<string>(),
  settings: { ...DEFAULT_SETTINGS },
};

// ---------- DOM 工具 ----------

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export const $btn = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;

/** 跨域共享 DOM 引用（被 2 个以上域模块引用的才放这里，其余各域自行缓存） */
export const outputEl = $("output");
export const statusFileEl = $("status-file");
