// 输出面板：非交互输出渲染 + traceback `File "…", line N` 点击跳转
//
// v3.4 §17-3：RunTranscript（S4 半行累积交互逻辑）已随 stdin 体系删除——运行输出统一走终端
// 控制台；本面板仅保留**非交互输出渲染**（appendOutputLine / URL / traceback 链接），
// 承载调试输出（debug-stdout / debug-stderr 事件，§13.3）。

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
// 导出供 xterm 终端 link provider 复用（S3，terminal.ts::provideUrlLinks）——
// 复用前必须 `lastIndex = 0`（带 `g` 的全局态，与 TRACEBACK_RE 同坑）。
export const URL_RE = /https?:\/\/[^\s"'<>()\[\]{}]+/g;
export const URL_TRAILING_PUNCT = ".,;:!?)]}\"'。，、）】》…；：！？";

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

// v3.4 §17-3：RunTranscript（S4 半行累积交互逻辑）已随 stdin 体系删除——运行输出统一走终端
// 控制台；本面板仅保留**非交互输出渲染**（appendOutputLine / URL / traceback 链接），
// 承载调试输出（debug-stdout / debug-stderr 事件，§13.3）。
