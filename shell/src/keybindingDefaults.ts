// 出厂快捷键元数据（零依赖单一来源，tech-debt #6）。
// 原「KEYBINDING_META.def / state.ts DEFAULT_SETTINGS.keybindings / Rust default_keybindings」
// 三处手写易漂移；本文件收敛前端两处的出处：keybindings.ts（分发/解析）与 state.ts
// （DEFAULT_SETTINGS）都从这里取，Rust 一侧保留 default_keybindings 并由漂移锁测试兜底。

export type KeybindingId =
  | "save"
  | "run_script"
  | "run_project"
  | "stop"
  | "run_selection"
  | "global_search"
  | "goto_definition"
  | "duplicate_line"
  | "comment_line"
  | "comment_block"
  | "template_palette"
  | "surround"
  | "optimize_imports"
  | "recent_files"
  | "goto_file"
  | "goto_line"
  | "nav_back"
  | "nav_forward"
  | "local_history"
  | "debug"
  | "debug_stop"
  | "debug_step_over"
  | "debug_step_into"
  | "debug_step_out"
  | "debug_evaluate"
  | "debug_run_to_cursor"
  | "bookmark_toggle"
  | "bookmark_list"
  | "scratch_new"
  | "run_history"
  | "markdown_preview"
  // P1（UX 审查）：高频但此前无键位的操作
  | "close_tab"
  | "new_file"
  | "open_settings"
  | "toggle_sidebar"
  | "toggle_bottom";

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
  // v3.4 §17-7（M3-3.5）：run 拆为 run_script + run_project（标签「运行当前文件」改为「运行脚本」）
  { id: "run_script", label: "运行脚本", def: "Ctrl+F10", scope: "window" },
  { id: "run_project", label: "运行项目", def: "Ctrl+Shift+F10", scope: "window" },
  { id: "stop", label: "停止运行", def: "Ctrl+F2", scope: "window" },
  { id: "run_selection", label: "运行选区 / 行", def: "Alt+Shift+E", scope: "editor" },
  { id: "global_search", label: "全局搜索", def: "Ctrl+Shift+F", scope: "window" },
  { id: "goto_definition", label: "跳转定义（F12 / Ctrl+点击固定保留）", def: "Ctrl+B", scope: "editor" },
  { id: "duplicate_line", label: "复制行 / 选区", def: "Ctrl+D", scope: "editor" },
  { id: "comment_line", label: "行注释开关", def: "Ctrl+/", scope: "editor" },
  { id: "comment_block", label: "块注释开关", def: "Ctrl+Shift+/", scope: "editor" },
  { id: "template_palette", label: "Live Templates 面板", def: "Ctrl+J", scope: "editor" },
  { id: "surround", label: "环绕模板（需选区）", def: "Ctrl+Alt+T", scope: "editor" },
  // P0（PyCharm 调研）：Optimize Imports（Ctrl+Alt+O）/ 最近文件（Ctrl+E），均为 PyCharm 同款默认键
  { id: "optimize_imports", label: "Optimize Imports（整理导入）", def: "Ctrl+Alt+O", scope: "editor" },
  { id: "recent_files", label: "最近打开的文件", def: "Ctrl+E", scope: "window" },
  // P1（PyCharm 调研）：Search Everywhere / Go to File / Go to Line / 导航历史 / 本地历史。
  // 注：Search Everywhere 的 **Double Shift** 是双击手势，无法用「单键位串」表达
  // （同 F12 / Ctrl+点击，属固定保留入口，不可自定义），故不进本表。
  { id: "goto_file", label: "转到文件（Search Everywhere 文件模式）", def: "Ctrl+Shift+N", scope: "window" },
  { id: "goto_line", label: "转到行 / 列", def: "Ctrl+G", scope: "window" },
  { id: "nav_back", label: "导航后退", def: "Ctrl+Alt+Left", scope: "window" },
  { id: "nav_forward", label: "导航前进", def: "Ctrl+Alt+Right", scope: "window" },
  { id: "local_history", label: "本地历史", def: "Ctrl+Shift+H", scope: "window" },
  // 调试五件套（debug dev plan §6.6；window 级——调试中编辑器可能失焦）
  { id: "debug", label: "启动调试 / 继续", def: "F5", scope: "window" },
  { id: "debug_stop", label: "停止调试", def: "Shift+F5", scope: "window" },
  { id: "debug_step_over", label: "单步跳过", def: "F10", scope: "window" },
  { id: "debug_step_into", label: "单步进入", def: "F11", scope: "window" },
  { id: "debug_step_out", label: "单步退出", def: "Shift+F11", scope: "window" },
  // P1：断点处求值表达式（PyCharm Alt+F8 同款）
  { id: "debug_evaluate", label: "求值表达式（调试控制台）", def: "Alt+F8", scope: "window" },
  // P2：调试打磨组 + 书签 / 草稿 / 运行历史
  { id: "debug_run_to_cursor", label: "运行到光标处（Run to Cursor）", def: "Alt+F9", scope: "window" },
  { id: "bookmark_toggle", label: "切换书签", def: "Ctrl+F11", scope: "window" },
  { id: "bookmark_list", label: "书签列表", def: "Ctrl+Shift+F11", scope: "window" },
  { id: "scratch_new", label: "新建草稿文件（Scratch）", def: "Ctrl+Alt+Shift+Insert", scope: "window" },
  { id: "run_history", label: "运行历史", def: "Ctrl+Shift+R", scope: "window" },
  // Markdown 预览开关（window 级——编辑器聚焦/失焦均可用）
  { id: "markdown_preview", label: "Markdown 预览", def: "Ctrl+Shift+V", scope: "window" },
  // P1（UX 审查）：高频操作补键位。默认值取 PyCharm 同款（Ctrl+F4 关闭标签 / Ctrl+Alt+Insert 新建
  // / Ctrl+Alt+S 设置）；侧栏/底部面板取 PyCharm 工具窗口习惯键（Ctrl+Shift+F12 / Alt+F12）
  { id: "close_tab", label: "关闭标签", def: "Ctrl+F4", scope: "window" },
  { id: "new_file", label: "新建文件", def: "Ctrl+Alt+Insert", scope: "window" },
  { id: "open_settings", label: "打开设置", def: "Ctrl+Alt+S", scope: "window" },
  { id: "toggle_sidebar", label: "切换侧栏", def: "Ctrl+Shift+F12", scope: "window" },
  { id: "toggle_bottom", label: "切换底部面板", def: "Alt+F12", scope: "window" },
];