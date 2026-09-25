// AppState 上下文对象（TD-007）：收敛原 main.ts 中跨功能域共享的模块级状态与 DOM 引用。
// 各功能域模块（fileTree / git / termUi / settingsPanel）经 app 读写共享状态；
// 域内私有状态（如文件树选中集、Git 变更列表、终端会话）仍留在各域模块内部。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { KEYBINDING_META } from "./keybindingDefaults";

export type MonacoModule = typeof MonacoApi;

/** 文件树条目 */
export interface Entry { name: string; path: string; is_dir: boolean }

/** 打开的文件标签。
 *  diff 视图 tab（第 2 步迁移）：kind="diff" 时 path 为目标文件仓库相对路径，
 *  diff 元数据携带三态基准与冲突态；model 为占位（diff 宿主不消费主编辑器模型，
 *  但保留字段避免 90+ 处 t.model 访问点判空——占位模型随 tab 关闭一并 dispose）。 */
export interface Tab {
  path: string;
  model: MonacoApi.editor.ITextModel;
  dirty: boolean;
  /** tab 类型：普通文件（默认）| git diff 视图 */
  kind?: "file" | "diff";
  /** kind="diff" 时的元数据 */
  diff?: {
    /** 三态基准（auto/index/head），切 tab 恢复 */
    base: "auto" | "index" | "head";
    /** 冲突视图（当前 vs 传入 + 接受按钮组） */
    conflict: boolean;
  };
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
  /** 缩进参考线（C-6：长脚本可读性；含当前缩进层级高亮） */
  indent_guides: boolean;
  /** 括号彩色化（C-6：多层嵌套括号配对辨识） */
  bracket_colors: boolean;
  /** 调试「只步进我的代码」（B-3：不误入 site-packages；改动需重启调试会话生效） */
  debug_just_my_code: boolean;
  autosave: string;
  autosave_delay: number;
  probe_enabled: boolean;
  lsp_engine: string;
  format_on_save: boolean;
  /** 保存时用 ruff 整理导入（Ctrl+Alt+O 的保存联动；与 format_on_save 同模式） */
  optimize_imports_on_save: boolean;
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

/** 从单一来源（keybindingDefaults.ts）派生出厂键位表，避免三处手写漂移（tech-debt #6） */
function defaultKeybindings(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of KEYBINDING_META) map[m.id] = m.def;
  return map;
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
  // C-6（PyCharm 调研）：可读性默认开——PyCharm 出厂即有缩进参考线，「默认就对」
  indent_guides: true,
  bracket_colors: true,
  // B-3（PyCharm 调研）：只步进我的代码，默认开（与 DAP attach 硬编码时代行为一致）
  debug_just_my_code: true,
  autosave: "off",
  autosave_delay: 1000,
  probe_enabled: true,
  lsp_engine: "pyrefly",
  format_on_save: false,
  optimize_imports_on_save: false,
  runtime_intel_enabled: true,
  terminal_cwd: "workspace",
  terminal_shell: "auto",
  // PyPI 包源默认官方源（须与 Rust Settings::default 保持同步）
  pypi_index: "https://pypi.org/simple",
  // 出厂默认键位（PyCharm 风格）：由 keybindingDefaults.ts 单一来源派生（tech-debt #6），
  // 与 Rust settings.rs default_keybindings 保持同步（keybindings.test.ts 有漂移锁）。
  keybindings: defaultKeybindings(),
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
