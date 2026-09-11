// 集成终端（P2-7 多会话）：xterm.js 渲染 + PTY 桥接。
// 每个实例绑定一个后端会话 id；term-data / term-exit 事件由 main.ts 统一监听并按 id 分发
// 到 writeData / handleExit，避免多实例各自订阅全局事件的浪费。

import { Terminal, type ILink, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";
import { TRACEBACK_RE, type OutputLink } from "./output";

/** 终端配色随外壳主题（D1 P-01：浅色主题下不再固定深色终端） */
function xtermTheme(): ITheme {
  if (app.settings.theme === "vs") {
    return { background: "#ececec", foreground: "#333333", cursor: "#333333", selectionBackground: "#add6ff" };
  }
  return { background: "#1b1b1b", foreground: "#d4d4d4", cursor: "#d4d4d4", selectionBackground: "#264f78" };
}

/** traceback 链接的点击处理（由 main.ts 注入 `gotoFromLink`）。
 * 做成模块级而非实例级：shell 终端与运行终端都该能点——顺带让手敲 `uv run` 产生的
 * traceback 也可跳转（坑 4 里 PTY 路线的额外收益，不是纯成本）。 */
let linkHandler: ((link: OutputLink) => void) | null = null;

export function setTerminalLinkHandler(cb: (link: OutputLink) => void): void {
  linkHandler = cb;
}

export class IntegratedTerminal {
  readonly id: string;
  private term: Terminal;
  private fit: FitAddon;
  private container: HTMLElement;
  private started = false;
  private resizeObserver: ResizeObserver;
  private onExit?: () => void;

  constructor(id: string, container: HTMLElement) {
    this.id = id;
    this.container = container;
    this.term = new Terminal({
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Code", "JetBrains Mono", monospace',
      cursorBlink: true,
      scrollback: 5000,
      theme: xtermTheme(),
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(container);
    this.fit.fit();

    // 键盘输入 → PTY
    this.term.onData((data) => {
      void invoke("term_write", { id: this.id, data }).catch(() => undefined);
    });

    // S3（坑 4）：输出跑进 xterm 后没有「行元素」可挂点击，traceback 跳转会整个丢掉。
    // 改用 xterm 的 link provider，复用输出面板同一个 TRACEBACK_RE 与跳转逻辑（注册一次，
    // xterm 按需回调：鼠标悬停该行 / refresh 时）。
    this.term.registerLinkProvider({
      provideLinks: (bufferLine, callback) => callback(this.provideTracebackLinks(bufferLine)),
    });

    // 容器尺寸变化 → adapt fit + 同步 PTY 尺寸
    this.resizeObserver = new ResizeObserver(() => this.syncSize());
    this.resizeObserver.observe(container);
  }

  setOnExit(cb: () => void): void {
    this.onExit = cb;
  }

  /** 当前是否有一个存活的 shell 会话 */
  isRunning(): boolean {
    return this.started;
  }

  /** 面板展开 / 尺寸变化后手动触发重布局（fit + resize） */
  relayout(): void {
    this.syncSize();
  }

  /** 外壳主题切换后重套配色（D1） */
  applyTheme(): void {
    this.term.options.theme = xtermTheme();
  }

  /** fit 当前尺寸并通知后端 resize（未启动时仅前端 fit） */
  private syncSize(): void {
    if (this.container.clientWidth === 0 || this.container.clientHeight === 0) return;
    this.fit.fit();
    if (this.started) {
      void invoke("term_resize", { id: this.id, cols: this.term.cols, rows: this.term.rows }).catch(() => undefined);
    }
  }

  /** 启动 shell（cwd 为终端工作目录，workspaceRoot 供 venv 检测）；幂等——重复调用会重启会话；返回激活的 venv 名。
   * `shell` 为显式别名（"auto"/"pwsh"/"powershell"/"cmd"）；缺省回退全局默认 `app.settings.terminal_shell`。 */
  async start(cwd: string | null, workspaceRoot: string | null, shell?: string): Promise<string | null> {
    if (this.started) {
      await invoke("term_kill", { id: this.id }).catch(() => undefined);
    }
    this.started = false;
    this.term.reset();
    this.started = true;

    const dims = this.fit.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;
    let venv: string | null = null;
    try {
      venv = await invoke<string | null>("term_spawn", {
        id: this.id,
        cols,
        rows,
        cwd,
        shell: shell ?? app.settings.terminal_shell ?? "auto",
        workspaceRoot,
      });
    } catch (e) {
      this.started = false;
      this.term.writeln(`\r\n\x1b[31m终端启动失败: ${e}\x1b[0m`);
      return null;
    }

    // 面板刚展开时容器尺寸可能未稳定，再同步一次
    requestAnimationFrame(() => this.syncSize());
    this.term.focus();
    return venv;
  }

  focus(): void {
    this.term.focus();
  }

  /** 程序化发送命令到终端（run=true 追加回车立即执行；否则仅插入文本供补参） */
  sendCommand(cmd: string, run: boolean): void {
    if (!this.started) return;
    const data = run ? cmd + "\r" : cmd;
    void invoke("term_write", { id: this.id, data }).catch(() => undefined);
    this.term.focus();
  }

  /** （外部事件分发）term-data → xterm 渲染 */
  writeData(data: string): void {
    this.term.write(data);
  }

  /** 为一行终端缓冲提供 traceback 链接（xterm 按需回调）。
   * PTY 路径不存在输出面板那种「chunk 切碎」问题——xterm 看的是完整行缓冲，
   * 因此这里直接对整行跑正则即可（§4.7 结论 5）。 */
  private provideTracebackLinks(bufferLine: number): ILink[] | undefined {
    if (!linkHandler) return undefined;
    // translateToString(true) 去掉行尾空白；列号按同一字符串计算，映射一致
    const text = this.term.buffer.active.getLine(bufferLine - 1)?.translateToString(true) ?? "";
    if (!text) return undefined;
    const links: ILink[] = [];
    TRACEBACK_RE.lastIndex = 0; // 带 `g` 的全局态：复用前必须重置，否则会漏掉行首的帧
    let m: RegExpExecArray | null;
    while ((m = TRACEBACK_RE.exec(text)) !== null) {
      const path = m[1];
      const line = parseInt(m[2], 10);
      links.push({
        // xterm 的列是 1-based，range 末列为闭区间；text 为悬停/激活时回传的链接文本
        range: {
          start: { x: m.index + 1, y: bufferLine },
          end: { x: m.index + m[0].length, y: bufferLine },
        },
        text: m[0],
        activate: () => linkHandler?.({ path, line }),
        // 注：@xterm/xterm 5.5 的 ILinkDecorations 尚无 tooltipCallback，这里只用它支持的装饰项
        decorations: { pointerCursor: true, underline: true },
      });
    }
    return links.length > 0 ? links : undefined;
  }

  /** S3：以「运行」语义启动 PTY 会话——后端 `run_in_terminal` 直接 spawn 解释器 + [脚本, ...参数]，
   * **不套 shell**（套 `pwsh -c python x.py` 会让 Ctrl+C 与退出码多一层语义损耗）。
   * @param banner 运行回显行（与运行按钮同一口径），在 reset 之后立即写入，保证排在脚本输出之前
   * @returns 后端的非致命告警（如 Parameters 解析失败）
   * @throws 启动失败（已写入终端提示），调用方负责复位运行态 */
  async startRun(path: string, workspaceRoot: string | null, banner: string): Promise<string[]> {
    if (this.started) {
      await invoke("term_kill", { id: this.id }).catch(() => undefined);
    }
    this.started = false;
    this.term.reset();
    this.term.write(`\x1b[90m${banner}\x1b[0m\r\n`);
    this.started = true;

    const dims = this.fit.proposeDimensions();
    const cols = dims?.cols ?? 80;
    const rows = dims?.rows ?? 24;
    let warnings: string[];
    try {
      warnings = await invoke<string[]>("run_in_terminal", { id: this.id, cols, rows, path, workspaceRoot });
    } catch (e) {
      this.started = false;
      this.term.writeln(`\r\n\x1b[31m在终端中运行失败: ${e}\x1b[0m`);
      throw e;
    }
    // 面板刚切过来时尺寸可能未稳定，再同步一次
    requestAnimationFrame(() => this.syncSize());
    this.term.focus();
    return warnings;
  }

  /** 外部主动停止（`term_kill` 不发 term-exit，只有自然退出才 notify）：复位会话态并留一行提示 */
  markStopped(): void {
    if (!this.started) return;
    this.started = false;
    this.term.writeln("\r\n\x1b[90m[已停止]\x1b[0m");
  }

  /** （外部事件分发）term-exit → 提示退出 */
  handleExit(): void {
    this.started = false;
    this.term.writeln("\r\n\x1b[90m[进程已退出]\x1b[0m");
    // 结论 5：写入完成后刷新可视区，让 link provider 立刻为已渲染的行提供 traceback 链接
    this.term.refresh(0, this.term.rows - 1);
    this.onExit?.();
  }

  /** 完全销毁（关闭某个终端 tab / 关闭工作区时调用） */
  async dispose(): Promise<void> {
    if (this.started) {
      this.started = false;
      await invoke("term_kill", { id: this.id }).catch(() => undefined);
    }
    this.resizeObserver.disconnect();
    this.term.dispose();
  }
}