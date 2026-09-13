// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { appendOutputLine, RunTranscript, TRACEBACK_RE } from "../output";

/** 建一个输出容器 + 转录器（onLink 用 spy 断言跳转参数） */
function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onLink = vi.fn();
  return { container, onLink, t: new RunTranscript(container, onLink) };
}

/** 容器内所有行元素的文本 */
function lines(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".out-line")).map((el) => el.textContent ?? "");
}

describe("RunTranscript（S4 部分行累积）", () => {
  it("完整行（partial=false）逐行落地，且不再多出空白行", () => {
    const { container, t } = setup();
    // 旧按行转发的 payload 形态：每次一行且以 \n 结尾
    t.write("stdout", "hello\n", false);
    t.write("stdout", "world\n", false);
    expect(lines(container)).toEqual(["hello", "world"]);
  });

  it("脚本打印的空行被保留（不被当作尾随换行吞掉）", () => {
    const { container, t } = setup();
    t.write("stdout", "a\n\nb\n", false);
    expect(lines(container)).toEqual(["a", "", "b"]);
  });

  it("无换行的提示符立即可见（坑 1：不能等换行才转发）", () => {
    const { container, t } = setup();
    const finalized = t.write("stdout", "姓名: ", true);
    expect(finalized).toEqual([]); // 尚未定型
    expect(lines(container)).toEqual(["姓名: "]);
    expect(container.querySelector(".out-line")?.classList.contains("partial")).toBe(true);
    expect(t.hasPending()).toBe(true);
  });

  it("提示符与后续输出累积成同一行（真控制台语义）", () => {
    const { container, t } = setup();
    t.write("stdout", "姓名: ", true);
    t.write("stdout", "你好，张三\n", false);
    expect(lines(container)).toEqual(["姓名: 你好，张三"]);
    // 定型后 partial 标记必须清掉（否则光标一直挂着）
    expect(container.querySelector(".out-line")?.classList.contains("partial")).toBe(false);
    expect(t.hasPending()).toBe(false);
  });

  it("一个 chunk 含多行 + 末尾半行：前面定型、末尾留作未完结", () => {
    const { container, t } = setup();
    t.write("stdout", "a\nb\n c", true);
    expect(lines(container)).toEqual(["a", "b", " c"]);
    expect(t.hasPending()).toBe(true);
  });

  it("以换行结尾时即使 partial=true 也不留未完结行", () => {
    const { t } = setup();
    t.write("stdout", "done\n", true);
    expect(t.hasPending()).toBe(false);
  });

  it("中文跨 chunk 不截断、traceback 帧不被切碎（§4.7 结论 6 核心验收项）", () => {
    const { container, t, onLink } = setup();
    const frame = '  File "F:\\项目\\主程序.py", line 42, in <module>\n';
    const bytes = new TextEncoder().encode(frame);
    // 模拟后端管线：按 5 字节切块 + 增量 UTF-8 解码（TextDecoder 的 stream 模式与 Rust 侧
    // IncrementalUtf8Decoder 同语义——尾部不完整字节留到下一轮），再按 partial 标记转发。
    // 5 字节切块必然把「项」「主」等 3 字节汉字切开，是坑 5 的最坏情况。
    const dec = new TextDecoder();
    for (let i = 0; i < bytes.length; i += 5) {
      const last = i + 5 >= bytes.length;
      const chunk = dec.decode(bytes.slice(i, i + 5), { stream: !last });
      if (!chunk) continue; // 整块都是被截断的多字节尾巴
      t.write("stderr", chunk, !chunk.endsWith("\n"));
    }
    expect(lines(container)).toEqual([frame.trimEnd()]);
    // 整行定型后 traceback 帧必须可点击（只有一个链接，未被 chunk 切成两段）
    const links = container.querySelectorAll(".out-link");
    expect(links.length).toBe(1);
    (links[0] as HTMLElement).click();
    expect(onLink).toHaveBeenCalledWith({ path: "F:\\项目\\主程序.py", line: 42 });
  });

  it("flush 把残留半行定型（脚本以无换行输出收尾时不吞字）", () => {
    const { container, t } = setup();
    t.write("stdout", "结果: 42", true);
    expect(t.flush()).toEqual(["结果: 42"]);
    expect(lines(container)).toEqual(["结果: 42"]);
    expect(t.hasPending()).toBe(false);
  });

  it("flush 空的未完结行不留下空元素", () => {
    const { container, t } = setup();
    expect(t.flush()).toEqual([]);
    expect(lines(container)).toEqual([]);
  });

  it("write 返回定型的行文本，供 EOFError 归因按行判定（S2）", () => {
    const { t } = setup();
    expect(t.write("stderr", "Traceback (most recent call last):\n", false)).toEqual([
      "Traceback (most recent call last):",
    ]);
    expect(t.write("stderr", "EOFError: EOF when reading a line\n", false)).toEqual([
      "EOFError: EOF when reading a line",
    ]);
  });

  it("stderr 的 EOFError 命中列首正则（与 main.ts 的归因判定同一口径）", () => {
    const { t } = setup();
    const [line] = t.write("stderr", "EOFError: EOF when reading a line\n", false);
    expect(/^EOFError\b/.test(line.trim())).toBe(true);
  });

  it("discard 后不再往游离元素里写（切换工作区清空输出时用）", () => {
    const { container, t } = setup();
    t.write("stdout", "半行", true);
    container.textContent = ""; // clearOutput
    t.discard();
    t.write("stdout", "新一轮\n", false);
    expect(lines(container)).toEqual(["新一轮"]);
  });
});

describe("appendOutputLine（一次性整行）", () => {
  it("traceback 帧渲染为可点击链接并回传路径与行号", () => {
    const container = document.createElement("div");
    const onLink = vi.fn();
    appendOutputLine(container, '  File "main.py", line 7, in <module>', "stderr", onLink);
    const link = container.querySelector(".out-link") as HTMLElement;
    expect(link).toBeTruthy();
    link.click();
    expect(onLink).toHaveBeenCalledWith({ path: "main.py", line: 7 });
  });

  it("探针摘要行用中性色（probe）而非报错色", () => {
    const container = document.createElement("div");
    appendOutputLine(container, "[opencharm-probe] 采集完成", "stderr", vi.fn());
    expect(container.querySelector(".out-line")?.classList.contains("probe")).toBe(true);
  });

  it("TRACEBACK_RE 连续复用不漏匹配（lastIndex 已重置）", () => {
    const container = document.createElement("div");
    const onLink = vi.fn();
    for (let i = 0; i < 3; i++) {
      appendOutputLine(container, 'File "a.py", line 1, in f', "stderr", onLink);
    }
    expect(container.querySelectorAll(".out-link").length).toBe(3);
    expect(TRACEBACK_RE.lastIndex).toBe(0);
  });
});

describe("URL 链接识别（P2-L）", () => {
  it("行内 URL 渲染为可点击链接，点击回传 URL", async () => {
    const { setOutputUrlHandler } = await import("../output");
    const handler = vi.fn();
    setOutputUrlHandler(handler);
    const container = document.createElement("div");
    appendOutputLine(container, "Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)", "stdout", vi.fn());
    const link = Array.from(container.querySelectorAll(".out-link")).find(
      (el) => el.textContent?.startsWith("http"),
    ) as HTMLElement;
    expect(link).toBeTruthy();
    expect(link.textContent).toBe("http://127.0.0.1:8000");
    link.click();
    expect(handler).toHaveBeenCalledWith("http://127.0.0.1:8000");
  });

  it("句尾标点剥离（句号/右括号不算链接一部分），多 URL 各自成链", async () => {
    const { setOutputUrlHandler } = await import("../output");
    const handler = vi.fn();
    setOutputUrlHandler(handler);
    const container = document.createElement("div");
    appendOutputLine(container, "访问 http://a.dev. 与 https://b.dev/docs) 对比", "stdout", vi.fn());
    const links = Array.from(container.querySelectorAll(".out-link"))
      .map((el) => el.textContent)
      .filter((t) => t?.startsWith("http"));
    expect(links).toEqual(["http://a.dev", "https://b.dev/docs"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("traceback 帧内不误生 URL 链接（两种链接分层叠加不冲突）", () => {
    const container = document.createElement("div");
    const onLink = vi.fn();
    appendOutputLine(container, 'File "main.py", line 7, in <module>', "stderr", onLink);
    const links = Array.from(container.querySelectorAll(".out-link"));
    expect(links.length).toBe(1);
    (links[0] as HTMLElement).click();
    expect(onLink).toHaveBeenCalledWith({ path: "main.py", line: 7 });
  });
});
