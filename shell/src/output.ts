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

// ---------- 输出 channel（P2：调试 / 环境 / Git 分组过滤） ----------
//
// 输出面板此前是单一混流：调试输出、pip/工具链安装输出、git 命令回显互相交错
// （「同时跑调试+装包」时无法阅读）。channel 体系给每行输出打域标签，头部 chips
// 按 channel 过滤显示；未标注的调用点归入 "all"（普通运行输出 / 运行历史重放，
// 永远显示）。过滤是**纯显示层**（display:none），行仍留在 DOM 与运行历史采集里。

/** 输出行的来源域；"all" 表示未分组的普通输出（兼容存量调用点，永远显示） */
export type OutputChannel = "all" | "debug" | "env" | "git";

/** 当前激活的过滤 channel（null = 不过滤，全部显示；默认） */
let channelFilter: OutputChannel | null = null;

/** 设置 channel 过滤（termUi 的 chips 点击驱动）；null = 恢复全部显示 */
export function setOutputChannelFilter(ch: OutputChannel | null): void {
  channelFilter = ch;
}

/** 行是否在当前过滤下可见：未标注（undefined）与 "all" 永远显示 */
function channelVisible(ch: OutputChannel | undefined): boolean {
  if (ch === undefined || ch === "all") return true;
  return channelFilter === null || channelFilter === "all" || ch === channelFilter;
}

/** 渲染一行的可见性并返回行元素（appendOutputLine 内部 + 已入 DOM 行的重过滤共用） */
function applyChannelVisibility(line: HTMLElement, ch: OutputChannel | undefined): void {
  line.dataset.channel = ch ?? "all";
  line.classList.toggle("out-ch-hidden", !channelVisible(ch));
}
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

/** 渲染一行输出，返回创建的行元素；识别 traceback 帧并渲染为可点击链接。
 *  M4-3（§6.4）：stderr 行同时喂 dep 域的 ModuleNotFoundError 检测（toast +「安装」）；
 *  注入式回调防循环依赖（output 不 import depHealth，main 接线同 setOutputUrlHandler 先例）。 */
let tracebackHandler: ((line: string) => void) | null = null;
export function setOutputTracebackHandler(fn: ((line: string) => void) | null): void {
  tracebackHandler = fn;
}

// ---------- 输出护栏（P0：无界增长的 DOM 是界面冻结的头号来源） ----------
//
// 依据：PyCharm 最受诟病的一条就是「输出一大就冻结」（调研见
// `docs/pycharm_ux_review_and_proposal.md` §3.3 / A-2）。本面板此前是「无限 appendChild +
// 无条件拽到底部」：跑一个狂打印的长任务会把 DOM 撑到几十万节点，且用户想往上翻会被强行
// 拉回底部。护栏两件事：①环形缓冲（超上限丢最前面的行，顶部显示已省略计数）；
// ②条件自动滚动（用户上滚即暂停跟随，回到底部自动恢复）。

/** 输出面板保留的最大行数（不含顶部「已省略」提示行） */
const DEFAULT_MAX_OUTPUT_LINES = 5000;
let maxOutputLines = DEFAULT_MAX_OUTPUT_LINES;

/** 供设置项/单测调整上限；非法值回落出厂默认（下限 100 行，防止自伤） */
export function setMaxOutputLines(n: number): void {
  maxOutputLines = Number.isFinite(n) && n >= 100 ? Math.floor(n) : DEFAULT_MAX_OUTPUT_LINES;
}
export function getMaxOutputLines(): number {
  return maxOutputLines;
}

/** 距底部多少像素内算「贴着底部」（决定自动滚动是否恢复跟随） */
const FOLLOW_BOTTOM_EPSILON_PX = 24;

/** 已被丢弃的行数（按容器计；clearOutput 复位） */
const omittedCounts = new WeakMap<HTMLElement, number>();
/** 顶部「已省略 N 行」提示行（惰性创建，永远是容器的第一个子节点） */
const omittedRows = new WeakMap<HTMLElement, HTMLElement>();
/** 用户手动上滚 → 暂停自动跟随（回到底部自动恢复） */
const followPaused = new WeakSet<HTMLElement>();
/** 已挂 scroll 监听的容器（每容器只挂一次；监听随元素一同回收） */
const scrollWired = new WeakSet<HTMLElement>();

/** 该容器当前是否处于「用户上滚、暂停跟随」状态（导出供单测） */
export function isScrollFollowPaused(container: HTMLElement): boolean {
  return followPaused.has(container);
}

function wireScrollFollow(container: HTMLElement): void {
  if (scrollWired.has(container)) return;
  scrollWired.add(container);
  container.addEventListener("scroll", () => {
    const gap = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (gap <= FOLLOW_BOTTOM_EPSILON_PX) followPaused.delete(container);
    else followPaused.add(container);
  });
}

/** 顶部提示行的存活判定：用 parentNode 而非 isConnected——容器可能尚未挂进 document
 *  （单测与离屏渲染场景），isConnected 会恒为 false 从而反复创建提示行。 */
function liveOmittedRow(container: HTMLElement): HTMLElement | null {
  const row = omittedRows.get(container);
  return row && row.parentNode === container ? row : null;
}

/** 取（必要时创建）顶部提示行：它不参与行数上限计算，也不带 channel */
function ensureOmittedRow(container: HTMLElement): HTMLElement {
  let row = liveOmittedRow(container);
  if (!row) {
    row = document.createElement("div");
    row.className = "out-omitted";
    row.hidden = true;
    container.insertBefore(row, container.firstChild);
    omittedRows.set(container, row);
  }
  return row;
}

function renderOmittedRow(container: HTMLElement): void {
  const n = omittedCounts.get(container) ?? 0;
  if (n <= 0) return;
  const row = ensureOmittedRow(container);
  row.textContent = `已省略前 ${n} 行（输出上限 ${maxOutputLines} 行）`;
  row.hidden = false;
}

/** 超出上限时从头部丢弃最旧的行（跳过顶部提示行） */
function trimOutput(container: HTMLElement): void {
  const row = liveOmittedRow(container);
  const hasRow = row ? 1 : 0;
  const over = container.children.length - hasRow - maxOutputLines;
  if (over <= 0) return;
  let removed = 0;
  for (let i = 0; i < over; i++) {
    const first = row ? row.nextElementSibling : container.firstElementChild;
    if (!first) break;
    container.removeChild(first);
    removed++;
  }
  if (removed > 0) {
    omittedCounts.set(container, (omittedCounts.get(container) ?? 0) + removed);
    renderOmittedRow(container);
  }
}

export function appendOutputLine(
  container: HTMLElement,
  text: string,
  cls: string,
  onLink: (link: OutputLink) => void,
  channel?: OutputChannel,
): HTMLElement {
  if (cls === "stderr") tracebackHandler?.(text);
  const line = document.createElement("div");
  renderLineContent(line, text, cls, onLink);
  applyChannelVisibility(line, channel);
  container.appendChild(line);
  wireScrollFollow(container);
  // 只在用户没往上翻时才拽到底部（上滚即"锁定"，回到底部自动解锁）
  if (!followPaused.has(container)) container.scrollTop = container.scrollHeight;
  trimOutput(container);
  return line;
}

/** 切换过滤后重刷已有行（termUi 的 chips 点击驱动）：遍历容器行，按 dataset.channel 重算显隐 */
export function refilterOutputChannel(container: HTMLElement): void {
  for (const line of Array.from(container.children)) {
    if (!(line instanceof HTMLElement)) continue;
    if (line.classList.contains("out-omitted")) continue; // 顶部提示行不参与过滤
    const ch = line.dataset.channel as OutputChannel | undefined;
    line.classList.toggle("out-ch-hidden", !channelVisible(ch));
  }
}

export function clearOutput(container: HTMLElement): void {
  container.textContent = "";
  omittedCounts.delete(container);
  omittedRows.delete(container);
  followPaused.delete(container);
}

// v3.4 §17-3：RunTranscript（S4 半行累积交互逻辑）已随 stdin 体系删除——运行输出统一走终端
// 控制台；本面板仅保留**非交互输出渲染**（appendOutputLine / URL / traceback 链接），
// 承载调试输出（debug-stdout / debug-stderr 事件，§13.3）。
