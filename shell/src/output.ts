// 输出面板：运行输出渲染 + traceback `File "…", line N` 点击跳转

export interface OutputLink {
  path: string;
  line: number;
}

// Python traceback 帧：File "path", line N（含 SyntaxError 单行格式）
const TRACEBACK_RE = /File "([^"]+)", line (\d+)/g;

/** 渲染一行输出，返回创建的行元素；识别 traceback 帧并渲染为可点击链接 */
export function appendOutputLine(
  container: HTMLElement,
  text: string,
  cls: string,
  onLink: (link: OutputLink) => void,
): HTMLElement {
  // 探针摘要行（[opencharm-probe] 前缀）：中性色，与真实错误区分
  if (cls === "stderr" && text.startsWith("[opencharm-probe]")) {
    cls = "probe";
  }
  const line = document.createElement("div");
  line.className = `out-line ${cls}`;

  let last = 0;
  TRACEBACK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRACEBACK_RE.exec(text)) !== null) {
    if (m.index > last) line.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement("span");
    a.className = "out-link";
    a.textContent = m[0];
    const path = m[1];
    const lineNo = parseInt(m[2], 10);
    a.addEventListener("click", () => onLink({ path, line: lineNo }));
    line.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) line.appendChild(document.createTextNode(text.slice(last)));

  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  return line;
}

export function clearOutput(container: HTMLElement): void {
  container.textContent = "";
}
