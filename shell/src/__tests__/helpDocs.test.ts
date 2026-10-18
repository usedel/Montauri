// @vitest-environment happy-dom
// 帮助文档入口（helpDocs.ts）单测：fetch 正文 → 落盘数据根 docs/ → 打开只读预览 Tab 的主链路、
// 按界面语言选正文（en → .en.md）、本语缺失回落中文，以及失败态与并发去重。
// 全部外部依赖（invoke / mdPreviewTab / toast / i18n / util）以 mock 替掉，故本用例零 monaco、零 Tauri 运行时依赖。
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  openPreviewTab: vi.fn(),
  toast: vi.fn(),
  state: { locale: "zh-CN" as string },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("../mdPreviewTab", () => ({ openPreviewTab: h.openPreviewTab }));
vi.mock("../toast", () => ({ toast: h.toast }));
vi.mock("../i18n", () => ({ t: (k: string) => k, getLocale: () => h.state.locale }));
vi.mock("../i18n/backendError", () => ({ localizeBackendError: (s: string) => s }));
vi.mock("../util", () => ({ errMsg: (e: unknown) => String(e) }));

import { openHelpDocs } from "../helpDocs";

const fetchMock = vi.fn();
/** 构造 fetch 响应：url → { ok, status, body } */
function stubFetch(routes: Record<string, { status?: number; body?: string }>): void {
  fetchMock.mockImplementation(async (url: string) => {
    const r = routes[url];
    const status = r?.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => r?.body ?? "" };
  });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.openPreviewTab.mockReset();
  h.toast.mockReset();
  h.state.locale = "zh-CN";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  h.invoke.mockImplementation(async (cmd: string) => (cmd === "get_data_doc_path" ? "C:/data/docs/doc.md" : undefined));
});

describe("helpDocs（帮助文档入口）", () => {
  it("中文界面：fetch 中文正文 → 写盘数据根 docs → 打开预览 Tab", async () => {
    stubFetch({ "/help/montauri-help.md": { body: "# 帮助\n正文" } });

    await openHelpDocs();

    expect(fetchMock).toHaveBeenCalledWith("/help/montauri-help.md");
    expect(h.invoke).toHaveBeenCalledWith("get_data_doc_path", { name: "montauri-help.md" });
    expect(h.invoke).toHaveBeenCalledWith("write_file", {
      path: "C:/data/docs/doc.md",
      content: "# 帮助\n正文",
    });
    expect(h.openPreviewTab).toHaveBeenCalledWith("C:/data/docs/doc.md");
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("英文界面：取 .en.md 正文并以英文文件名落盘", async () => {
    h.state.locale = "en-US";
    stubFetch({ "/help/montauri-help.en.md": { body: "# Help" } });

    await openHelpDocs();

    expect(fetchMock).toHaveBeenCalledWith("/help/montauri-help.en.md");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("get_data_doc_path", { name: "montauri-help.en.md" });
  });

  it("英文界面但英文正文缺失（404）→ 回落中文正文", async () => {
    h.state.locale = "en-US";
    stubFetch({ "/help/montauri-help.en.md": { status: 404 }, "/help/montauri-help.md": { body: "# 帮助" } });

    await openHelpDocs();

    expect(h.invoke).toHaveBeenCalledWith("get_data_doc_path", { name: "montauri-help.md" });
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("失败：两份都取不到 → toast 报错且不打开 Tab", async () => {
    stubFetch({ "/help/montauri-help.md": { status: 404 } });

    await openHelpDocs();

    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.openPreviewTab).not.toHaveBeenCalled();
  });

  it("并发去重：连点两次只 fetch 一次", async () => {
    stubFetch({ "/help/montauri-help.md": { body: "x" } });

    await Promise.all([openHelpDocs(), openHelpDocs()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.openPreviewTab).toHaveBeenCalledTimes(1);
  });
});
