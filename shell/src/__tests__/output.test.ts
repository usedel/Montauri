// @vitest-environment happy-dom
// v3.4 §17-3：RunTranscript 交互用例已随 stdin 体系删除（运行输出统一走终端控制台）；
// 保留**非交互输出渲染**用例——输出面板承载调试输出（debug-stdout / debug-stderr，§13.3）。
import { describe, expect, it, vi } from "vitest";
import { appendOutputLine, TRACEBACK_RE } from "../output";

describe("channel 过滤（P2：调试 / 环境 / Git 分组）", () => {
  it("未标注与 all 永远显示；切 debug 过滤后 env/git 行隐藏、debug/all 行可见", async () => {
    const { setOutputChannelFilter, refilterOutputChannel } = await import("../output");
    const container = document.createElement("div");
    appendOutputLine(container, "普通输出（未标注）", "stdout", vi.fn());
    appendOutputLine(container, "pip 行", "stdout", vi.fn(), "env");
    appendOutputLine(container, "git 行", "cmd", vi.fn(), "git");
    appendOutputLine(container, "debug 行", "stderr", vi.fn(), "debug");
    // 默认（null）全部可见
    expect(container.querySelectorAll(".out-ch-hidden").length).toBe(0);
    // 切 debug 过滤：已有行经 refilter 重刷
    setOutputChannelFilter("debug");
    refilterOutputChannel(container);
    const hidden = Array.from(container.querySelectorAll(".out-ch-hidden")) as HTMLElement[];
    expect(hidden.length).toBe(2); // env + git 隐藏
    expect(hidden.every((el) => el.dataset.channel === "env" || el.dataset.channel === "git")).toBe(true);
    // 过滤态下新追加的行直接按过滤渲染
    appendOutputLine(container, "新增 debug 行", "stdout", vi.fn(), "debug");
    expect(container.querySelectorAll(".out-ch-hidden").length).toBe(2);
    appendOutputLine(container, "新增 env 行", "stdout", vi.fn(), "env");
    expect(container.querySelectorAll(".out-ch-hidden").length).toBe(3);
    // 恢复 null：全部重新可见
    setOutputChannelFilter(null);
    refilterOutputChannel(container);
    expect(container.querySelectorAll(".out-ch-hidden").length).toBe(0);
    setOutputChannelFilter(null); // 复位全局态，不污染后续用例
  });
});

describe("appendOutputLine（一次性整行；调试输出承载）", () => {
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
