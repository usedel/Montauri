// 终端 Ctrl+C 分流谓词（零依赖纯逻辑层，同 terminalBackpressure / epSampleCore 分层惯例）。
//
// 背景：xterm.js 默认把无修饰的 Ctrl+C 变成 \x03（ETX / SIGINT）写进 PTY，并 cancel(keydown)
// 阻断浏览器原生 copy 事件——「选中输出后 Ctrl+C 复制」因此静默失败。
// 本模块只做判定，DOM / IPC 接线在 terminal.ts；零依赖保证单测可脱离 xterm 直接 import
// （terminal.ts 顶层 import @xterm/xterm 会把 `self` 带进 vitest 环境）。

/** KeyboardEvent 的最小结构（单测无需 DOM 环境即可构造） */
export interface TerminalKeyLike {
  type: string;
  code?: string;
  key?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * 是否由外壳接管 Ctrl+C 做「复制选区」（VSCode 语义）。
 *
 * 条件严格镜像 xterm 产 \x03 的那一支（common/input/Keyboard.ts::evaluateKeyboardEvent：
 * ctrlKey && !shiftKey && !altKey && !metaKey + A~Z），再加「keydown」与「有选区」两道门：
 * - keyup 不拦（xterm 的 _keyUp 也会调自定义钩子，拦了会跳过 focus 收尾）；
 * - Ctrl+Shift+C 不拦（xterm 原生复制路径，browserKeys.ts 也刻意放行）；
 * - macOS Cmd+C 不拦（metaKey，浏览器原生复制）。
 *
 * @param hasSelection xterm `Terminal.hasSelection()` 的结果
 */
export function shouldCopyOnCtrlC(e: TerminalKeyLike, hasSelection: boolean): boolean {
  if (!hasSelection || e.type !== "keydown") return false;
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return false;
  // IME 下 e.key 可能是 "Process"，物理 code 仍稳定；无 code 的合成事件用 key 兜底。
  if (e.code) return e.code === "KeyC";
  return e.key === "c" || e.key === "C";
}
