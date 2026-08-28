// 集成终端（P2-7 多会话）：xterm.js 渲染 + PTY 桥接。
// 每个实例绑定一个后端会话 id；term-data / term-exit 事件由 main.ts 统一监听并按 id 分发
// 到 writeData / handleExit，避免多实例各自订阅全局事件的浪费。

import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";

/** 终端配色随外壳主题（D1 P-01：浅色主题下不再固定深色终端） */
function xtermTheme(): ITheme {
  if (app.settings.theme === "vs") {
    return { background: "#ececec", foreground: "#333333", cursor: "#333333", selectionBackground: "#add6ff" };
  }
  return { background: "#1b1b1b", foreground: "#d4d4d4", cursor: "#d4d4d4", selectionBackground: "#264f78" };
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

  /** 启动 shell（cwd 为终端工作目录，workspaceRoot 供 venv 检测）；幂等——重复调用会重启会话；返回激活的 venv 名 */
  async start(cwd: string | null, workspaceRoot: string | null): Promise<string | null> {
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
      venv = await invoke<string | null>("term_spawn", { id: this.id, cols, rows, cwd, workspaceRoot });
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

  /** （外部事件分发）term-exit → 提示退出 */
  handleExit(): void {
    this.started = false;
    this.term.writeln("\r\n\x1b[90m[进程已退出]\x1b[0m");
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