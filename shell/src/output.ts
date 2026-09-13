// 输出面板：运行输出渲染 + traceback `File "…", line N` 点击跳转
//
// S4 起有两种写入形态：
// - **一次性整行**（appendOutputLine）：命令回显 / 归因提示 / 诊断等非流式内容；
// - **流式片段**（RunTranscript）：run-stdout / run-stderr 事件。交互式运行下后端按 chunk 转发，
//   提示符（无换行）必须先落到 DOM 用户才看得到（坑 1），而 traceback 链接只能在整行**定型**后
//   匹配，否则会被 chunk 切碎（§4.7 结论 6）。RunTranscript 同时兼容旧的按行转发（partial=false）。

export interface OutputLink {
  path: string;
  line: number;
}

// Python traceback 帧：File "path", line N（含 SyntaxError 单行格式）。
// 带 `g` 的全局正则：输出面板与 xterm link provider（S3）两处共用，
// **复用前必须 `lastIndex = 0`**，否则上一次匹配的游标会让下一次匹配漏掉行首的帧。
export const TRACEBACK_RE = /File "([^"]+)", line (\d+)/g;

// P2-L：输出中的 http/https URL（uvicorn "Uvicorn running on http://…" 等）。
// 端点字符集排除空白与常见包裹符；句尾标点在入链前剥离。
const URL_RE = /https?:\/\/[^\s"'<>()\[\]{}]+/g;
const URL_TRAILING_PUNCT = ".,;:!?)]}\"'。，、）】》…；：！？";

/** P2-L：URL 点击处理器（main.ts 注册 → invoke open_external；与 setTerminalLinkHandler 同模式） */
let urlHandler: ((url: string) => void) | null = null;
export function setOutputUrlHandler(fn: (url: string) => void): void {
  urlHandler = fn;
}

/** 把一段纯文本写入 el：识别其中的 URL 并渲染为可点击 span（P2-L，与 traceback 分层叠加） */
function appendTextWithUrls(el: HTMLElement, text: string): void {
  URL_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    // 剥离句尾标点（正则字符集吃进的句号/括号等不属于链接）
    let url = m[0];
    let end = m.index + url.length;
    while (url.length > 0 && URL_TRAILING_PUNCT.includes(url[url.length - 1])) {
      url = url.slice(0, -1);
      end--;
    }
    if (!url) continue;
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement("span");
    a.className = "out-link";
    a.textContent = url;
    a.addEventListener("click", () => urlHandler?.(url));
    el.appendChild(a);
    last = end;
    URL_RE.lastIndex = end; // 从剥离后的末尾继续匹配
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

/** 把整行文本渲染进元素：识别 traceback 帧并渲染为可点击链接（只在行「定型」后调用）；
 * P2-L：非帧文本段中的 URL 同样渲染为可点击链接。 */
function renderLineContent(
  el: HTMLElement,
  text: string,
  cls: string,
  onLink: (link: OutputLink) => void,
): void {
  // 探针摘要行（[opencharm-probe] 前缀）：中性色，与真实错误区分
  if (cls === "stderr" && text.startsWith("[opencharm-probe]")) {
    cls = "probe";
  }
  el.className = `out-line ${cls}`;
  el.textContent = "";

  let last = 0;
  TRACEBACK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRACEBACK_RE.exec(text)) !== null) {
    if (m.index > last) appendTextWithUrls(el, text.slice(last, m.index));
    const a = document.createElement("span");
    a.className = "out-link";
    a.textContent = m[0];
    const path = m[1];
    const lineNo = parseInt(m[2], 10);
    a.addEventListener("click", () => onLink({ path, line: lineNo }));
    el.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) appendTextWithUrls(el, text.slice(last));
}

/** 渲染一行输出，返回创建的行元素；识别 traceback 帧并渲染为可点击链接 */
export function appendOutputLine(
  container: HTMLElement,
  text: string,
  cls: string,
  onLink: (link: OutputLink) => void,
): HTMLElement {
  const line = document.createElement("div");
  renderLineContent(line, text, cls, onLink);
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  return line;
}

export function clearOutput(container: HTMLElement): void {
  container.textContent = "";
}

/** 未完结行（partial）：脚本写了半行还没换行，典型是 `input("姓名: ")` 的提示符 */
interface PendingLine {
  el: HTMLElement;
  text: string;
  cls: string;
}

/**
 * 运行输出转录器（S4）：把「流式片段」还原成「行」，同时保证
 * ① 提示符立即可见（坑 1：不能等换行才转发）；
 * ② traceback 链接不被 chunk 切碎（§4.7 结论 6：整行定型后才跑 `TRACEBACK_RE`）；
 * ③ 多字节中文不被截断（后端增量 UTF-8 解码 + 此处按行累积共同保证）。
 *
 * stdout / stderr 共用**一个**未完结行：两条流无顺序保证，交互式下可能交错，
 * 首版接受交错（与 PyCharm 一致，见 §4.5 末行评审结论）。
 */
export class RunTranscript {
  private pending: PendingLine | null = null;

  constructor(
    private container: HTMLElement,
    private onLink: (link: OutputLink) => void,
  ) {}

  /**
   * 写入一段流数据。
   * @param cls 行样式（"stdout" / "stderr"）
   * @param data 后端转发的一段文本（可能含多个换行，也可能是无换行的半行）
   * @param partial true = 末段尚无换行（未完结，继续累积）；false/缺省 = 末段也是完整行
   * @returns 本次**定型**的完整行文本（供 EOFError 归因等「按行」判定使用）
   */
  write(cls: string, data: string, partial: boolean): string[] {
    if (!data) return [];
    const finalized: string[] = [];
    const endsWithNewline = data.endsWith("\n");
    const segs = data.split("\n");
    // 末尾换行只用于「结束当前行」，不额外产生空行
    // （旧的按行转发直接 split("\n") 逐段追加，每行后都会多出一个空白行元素）
    if (endsWithNewline) segs.pop();
    const keepOpen = partial && !endsWithNewline;
    for (let i = 0; i < segs.length; i++) {
      const isLast = i === segs.length - 1;
      if (isLast && keepOpen) this.appendToPending(cls, segs[i]);
      else finalized.push(this.completeLine(cls, segs[i]));
    }
    return finalized;
  }

  /** 把未完结行定型（运行结束 / 用户提交输入时调用）；无内容则移除空元素，返回定型的行文本 */
  flush(): string[] {
    const p = this.pending;
    if (!p) return [];
    this.pending = null;
    if (p.text === "") {
      p.el.remove();
      return [];
    }
    renderLineContent(p.el, p.text, p.cls, this.onLink);
    this.scroll();
    return [p.text];
  }

  /** 丢弃未完结行状态（容器被 clearOutput 清空时用，避免继续持有游离元素） */
  discard(): void {
    this.pending = null;
  }

  /** 当前是否有未完结行（= 脚本正等着用户输入，可用于「等待输入…」可视化） */
  hasPending(): boolean {
    return this.pending !== null;
  }

  /** 并入一段文本并把整行定型，返回整行文本 */
  private completeLine(cls: string, seg: string): string {
    this.ensurePending(cls);
    this.pending!.text += seg;
    const p = this.pending!;
    this.pending = null;
    // 定型时才跑 traceback 匹配：chunk 边界不会把 `File "…", line N` 切碎（同时清掉 partial 标记）
    renderLineContent(p.el, p.text, p.cls, this.onLink);
    this.scroll();
    return p.text;
  }

  /** 追加半行文本（先让用户看见提示符，链接留到定型时再渲染） */
  private appendToPending(cls: string, seg: string): void {
    this.ensurePending(cls);
    const p = this.pending!;
    p.text += seg;
    p.el.appendChild(document.createTextNode(seg));
    this.scroll();
  }

  private ensurePending(cls: string): void {
    if (this.pending) return;
    const el = document.createElement("div");
    el.className = `out-line ${cls} partial`;
    this.container.appendChild(el);
    this.pending = { el, text: "", cls };
  }

  private scroll(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }
}
