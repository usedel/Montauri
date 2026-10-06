// A4 · 爬虫场景工具箱 ①「选择器测试」工具面板（devtools 内置工具，Ctrl+Shift+T 唤起）。
//
// 真源 docs/improvement_and_roadmap_report.md §3 A4。求值/解析/快照逻辑全在 selectorCore.ts
// （零 app 依赖、可单测）；本文件只做 IO、防抖、渲染与持久化。
//
// ⚠ 口径红线（UI 文案必须与此一致，勿改写成"更准 / 就是爬虫结果"）：
//   本工具在**浏览器 DOM** 上求值，与 lxml / bs4 在 table 补 tbody、畸形标签修复、CSS 支持集
//   上有差异。面板常驻一行口径说明（`devtools.sel.engineNote`），**不得删**。
//
// 布局取舍：右侧面板默认仅 360px 宽（可缩，下限 260），双栏必挤 → 单列 + 「命中列表 / 结构预览」
// 互斥切换（kit.radioGroup，与 base64 方向选择同一范式）。

import DOMPurify from "dompurify";
import type { PanelHost } from "../../extensions/facade";
import { pluginToolId } from "../../extensions/manifest";
import { t, type TFuncKey } from "../../i18n";
import { flashError, flashSuccess } from "../feedback";
import { emptyState } from "../../util";
import {
  HTML_MAX_CHARS,
  HTML_PERSIST_LIMIT,
  MAX_MATCHES,
  classifySelector,
  createSelectorEngine,
  looksLikeHtml,
  selectorToPython,
  type EvalResult,
  type HtmlError,
  type MatchInfo,
} from "./selectorCore";

// ---------- 与 HTTP 工具的联动：待测 HTML ----------
//
// 与 http.ts 的 setPendingRequest 同构：工具**已挂载**（面板有实例缓存，CACHE_MAX=5）时直接投递给
// 在线消费者；否则先存起来，等下次 mount 消费——两条路都要通，否则「HTTP 响应 → 测试选择器」会
// 静默失效（同 openHttpTool 那条踩坑）。

let pendingHtml: string | null = null;
const pendingConsumers = new Set<(html: string) => void>();

/**
 * 本工具的全局 id（`<pluginId>.<toolId>`）。传裸 `"selector"` 会让 `openDevTools` 静默回落到
 * 「最近使用」工具（面板开了但打开的是别的工具）——同 devtools/index.ts 的 HTTP_TOOL_ID 踩坑。
 */
export const SELECTOR_TOOL_ID = pluginToolId("opencharm.builtin", "selector");

/** 预置待测 HTML（HTTP 工具响应工具栏「测试选择器」调用） */
export function setPendingSelectorHtml(html: string): void {
  if (pendingConsumers.size > 0) {
    for (const cb of pendingConsumers) cb(html);
    return;
  }
  pendingHtml = html;
}

/** 输入防抖（ms）——纯前端求值本可即时，但大 HTML 下 querySelectorAll 仍值得去抖 */
const DEBOUNCE_MS = 150;

/** 持久化 key（全局，不按工作区隔离：本工具是临时草稿本，跨项目复用同一份更好用） */
const KEY_SELECTOR = "sel.selector";
const KEY_HTML = "sel.html";

/** 解析失败码 → 词条（显式映射，不拼字符串——TKey 是联合类型，拼出来的 key 过不了编译期检查） */
const PARSE_ERR_KEY: Record<HtmlError, TFuncKey> = {
  tooLarge: "devtools.sel.errTooLarge",
  noParser: "devtools.sel.errNoParser",
  noBody: "devtools.sel.errNoBody",
  exception: "devtools.sel.errException",
};

/** 预览消毒配置：剥掉会污染宿主文档 / 触发外链的标签（DOMPurify 默认已挡 script 与事件属性） */
const PREVIEW_FORBID = ["style", "link", "base", "meta", "title", "iframe", "frame", "object", "embed", "script"];

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const engine = createSelectorEngine();
  let timer: ReturnType<typeof setTimeout> | null = null;

  // ---------- DOM ----------

  const wrap = kit.body();

  const selInput = kit.input({ placeholder: t("devtools.sel.selectorPh"), onInput: () => schedule() });
  const kindBadge = document.createElement("span");
  kindBadge.className = "sel-kind hidden";
  const selRow = kit.row(selInput, kindBadge);

  const htmlInput = kit.textarea({ placeholder: t("devtools.sel.htmlPh"), rows: 6 });
  const htmlSection = document.createElement("details");
  htmlSection.className = "sel-html";
  htmlSection.open = true;
  const htmlSummary = document.createElement("summary");
  const htmlBody = document.createElement("div");
  htmlBody.className = "sel-html-body";
  htmlBody.appendChild(htmlInput);
  htmlSection.append(htmlSummary, htmlBody);

  const pasteBtn = kit.pasteButton((text) => {
    htmlInput.value = text;
    schedule(true);
  });
  const clearBtn = kit.clearButton(selInput, htmlInput);
  const pyBtn = kit.button(t("devtools.sel.copyPython"), "code");
  const toolbar = kit.toolbar(pasteBtn, clearBtn, "spacer", pyBtn);

  const errEl = kit.errorSlot();

  const summaryEl = document.createElement("div");
  summaryEl.className = "sel-summary";
  summaryEl.setAttribute("aria-live", "polite");
  const modeGroup = kit.radioGroup<"list" | "preview">({
    label: t("devtools.sel.modeLabel"),
    options: [
      { value: "list", label: t("devtools.sel.modeList") },
      { value: "preview", label: t("devtools.sel.modePreview") },
    ],
    value: "list",
    onChange: () => render(),
  });
  const headRow = kit.row(modeGroup.el, "spacer", summaryEl);

  const noteEl = document.createElement("div");
  noteEl.className = "sel-note";

  const pane = document.createElement("div");
  pane.className = "sel-pane";

  wrap.append(selRow, toolbar, htmlSection, errEl, headRow, noteEl, pane);
  host.root.appendChild(wrap);

  // ---------- 持久化（storage 不可用一律静默降级，不影响主流程） ----------

  function persist(): void {
    try {
      host.storage.set(KEY_SELECTOR, selInput.value);
      // 超大 HTML 不落盘：localStorage 有配额，写爆会连带影响其它工具的草稿
      host.storage.set(KEY_HTML, htmlInput.value.length > HTML_PERSIST_LIMIT ? "" : htmlInput.value);
    } catch {
      /* 静默降级 */
    }
  }

  function restore(): void {
    try {
      const sel = host.storage.get(KEY_SELECTOR);
      if (sel !== null) selInput.value = sel;
      const html = host.storage.get(KEY_HTML);
      if (html !== null && html !== "") htmlInput.value = html;
    } catch {
      /* 静默降级 */
    }
  }

  // ---------- 求值调度 ----------

  function schedule(immediate = false): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    persist();
    if (immediate) {
      render();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      render();
    }, DEBOUNCE_MS);
  }

  function render(): void {
    const parseErr = engine.setHtml(htmlInput.value);
    const htmlLen = htmlInput.value.length;
    htmlSummary.textContent =
      htmlLen > 0 ? t("devtools.sel.htmlSection", { n: String(htmlLen) }) : t("devtools.sel.htmlSectionEmpty");

    // 常驻口径说明：导入的 HTML 不像 HTML 时追加一句提示（不阻断求值）
    noteEl.textContent =
      htmlLen > 0 && !looksLikeHtml(htmlInput.value)
        ? `${t("devtools.sel.engineNote")} · ${t("devtools.sel.notHtml")}`
        : t("devtools.sel.engineNote");

    if (parseErr !== null) {
      kindBadge.classList.add("hidden");
      summaryEl.textContent = "";
      errEl.textContent =
        parseErr === "tooLarge"
          ? t(PARSE_ERR_KEY.tooLarge, { n: String(HTML_MAX_CHARS) })
          : t(PARSE_ERR_KEY[parseErr]);
      pane.replaceChildren(emptyState("file-code", t("devtools.sel.noHtml"), t("devtools.sel.noHtmlHint")));
      return;
    }

    const raw = selInput.value;
    const kind = classifySelector(raw);
    if (raw.trim() === "") {
      kindBadge.classList.add("hidden");
    } else {
      kindBadge.classList.remove("hidden");
      kindBadge.textContent = kind === "xpath" ? t("devtools.sel.kindXpath") : t("devtools.sel.kindCss");
      kindBadge.dataset.kind = kind;
    }

    renderResult(engine.evaluate(raw));
  }

  function renderResult(res: EvalResult): void {
    errEl.textContent = "";
    summaryEl.textContent = "";

    if (res.state === "noHtml") {
      pane.replaceChildren(emptyState("file-code", t("devtools.sel.noHtml"), t("devtools.sel.noHtmlHint")));
      return;
    }
    if (res.state === "empty") {
      pane.replaceChildren(emptyState("search", t("devtools.sel.needSelector"), t("devtools.sel.needSelectorHint")));
      return;
    }
    if (res.state === "badSelector") {
      errEl.textContent = t("devtools.sel.errBadSelector", { msg: res.error });
      pane.replaceChildren();
      return;
    }
    if (res.state === "unsupported") {
      errEl.textContent = t("devtools.sel.errNoXPath");
      pane.replaceChildren();
      return;
    }

    const parts = [t("devtools.sel.summaryHits", { n: String(res.count) })];
    if (res.truncated) parts.push(t("devtools.sel.summaryTruncated", { n: String(MAX_MATCHES) }));
    if (res.nonElement > 0) parts.push(t("devtools.sel.summaryNonElement", { n: String(res.nonElement) }));
    summaryEl.textContent = parts.join(" · ");

    if (res.count === 0) {
      pane.replaceChildren(emptyState("search", t("devtools.sel.zeroHits"), t("devtools.sel.zeroHitsHint")));
      return;
    }
    pane.replaceChildren(modeGroup.get() === "preview" ? buildPreview() : buildList(res.matches));
  }

  // ---------- 命中列表 ----------

  function buildList(matches: readonly MatchInfo[]): HTMLElement {
    const list = document.createElement("div");
    list.className = "sel-list";
    const active = engine.activeIndex();
    for (const m of matches) {
      const item = document.createElement("div");
      item.className = "sel-item";
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.dataset.index = String(m.index);
      // 选中态跨「切列表/切预览」保留（引擎持下标，列表重建时恢复）
      if (m.index === active) item.classList.add("is-active");

      const head = document.createElement("div");
      head.className = "sel-item-head";
      const tag = document.createElement("code");
      tag.className = "sel-item-tag";
      tag.textContent = m.tag;
      head.appendChild(tag);
      if (m.id !== "") {
        const idEl = document.createElement("span");
        idEl.className = "sel-item-id";
        idEl.textContent = `#${m.id}`;
        head.appendChild(idEl);
      }
      for (const c of m.classes.slice(0, 3)) {
        const cEl = document.createElement("span");
        cEl.className = "sel-item-class";
        cEl.textContent = `.${c}`;
        head.appendChild(cEl);
      }
      const nth = document.createElement("span");
      nth.className = "sel-item-nth";
      nth.textContent = `#${m.index + 1}`;
      head.appendChild(nth);

      const textEl = document.createElement("div");
      textEl.className = "sel-item-text";
      textEl.textContent = m.ownText !== "" ? m.ownText : m.text !== "" ? m.text : t("devtools.sel.noText");

      const meta = document.createElement("div");
      meta.className = "sel-item-meta";
      const bits = [t("devtools.sel.childCount", { n: String(m.childCount) })];
      if (m.attrTotal > 0) bits.push(t("devtools.sel.attrTotal", { n: String(m.attrTotal) }));
      for (const [k, v] of m.attrs) bits.push(`${k}=${v}`);
      meta.textContent = bits.join(" · ");

      const pathEl = document.createElement("div");
      pathEl.className = "sel-item-path";
      pathEl.textContent = m.path;
      pathEl.title = m.path;

      item.append(head, textEl, meta, pathEl);
      const focus = (): void => focusMatch(m.index, item);
      item.addEventListener("click", focus);
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          focus();
        }
      });
      list.appendChild(item);
    }
    return list;
  }

  /** 列表点击：标为当前命中；预览可见时滚到该元素（预览不可见时不偷切视图） */
  function focusMatch(index: number, item: HTMLElement): void {
    engine.setActive(index);
    for (const el of Array.from(pane.querySelectorAll(".sel-item"))) {
      el.classList.toggle("is-active", el === item);
    }
    if (modeGroup.get() !== "preview") return;
    const el = engine.elementAt(index);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "center" });
  }

  // ---------- 结构预览 ----------

  function buildPreview(): HTMLElement {
    const box = document.createElement("div");
    box.className = "sel-preview-box";
    const note = document.createElement("div");
    note.className = "sel-note sel-note--dim";
    note.textContent = t("devtools.sel.previewNote");
    const body = document.createElement("div");
    body.className = "sel-preview";
    // 先消毒再注入：粘贴的页面 HTML 里可能有 <script> / onerror / 内联 <style>——
    // <style> 若不剥会**重排整个 IDE**（CSS 是全局的，不随容器隔离）。
    const clean = DOMPurify.sanitize(engine.previewHtml(), { FORBID_TAGS: PREVIEW_FORBID });
    body.innerHTML = clean;
    if (clean.trim() === "") {
      body.appendChild(emptyState("eye", t("devtools.sel.previewEmpty"), t("devtools.sel.previewEmptyHint")));
    }
    box.append(note, body);
    return box;
  }

  // ---------- 复制为 Python ----------

  pyBtn.addEventListener("click", () => {
    const raw = selInput.value.trim();
    if (raw === "") {
      flashError(pyBtn, t("devtools.sel.needSelector"));
      return;
    }
    const snippet = selectorToPython(raw, classifySelector(raw));
    void host.copyToClipboard(snippet).then((ok) => {
      if (ok) flashSuccess(pyBtn, t("devtools.sel.pythonCopied"));
      else flashError(pyBtn, t("devtools.common.copyFailed"));
    });
  });

  // ---------- 快捷键：Ctrl/Cmd+Enter 立即求值 ----------

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      schedule(true);
    }
  };
  selInput.addEventListener("keydown", onKeydown);
  htmlInput.addEventListener("keydown", onKeydown);

  // ---------- 联动 + 启动 ----------

  const consume = (html: string): void => {
    htmlInput.value = html;
    htmlSection.open = false; // 导入即收起来，把空间让给结果
    schedule(true);
  };
  pendingConsumers.add(consume);

  restore();
  render();
  if (pendingHtml !== null) {
    const html = pendingHtml;
    pendingHtml = null;
    consume(html);
  }

  return {
    dispose() {
      if (timer !== null) clearTimeout(timer);
      pendingConsumers.delete(consume);
    },
  };
}
