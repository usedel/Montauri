// A4 · 爬虫场景工具箱 ①「选择器测试」的纯逻辑 + 求值层（devtools 内置工具）。
//
// 交付记录见 docs/delivery-overview.md §2 第 27 行（画像专项 · 「只有 OpenCharm 会做」）。
// 本文件**零 app 依赖**（不 import state / i18n / git），可在 happy-dom 下直接单测；
// 一切展示文案留在 selector.ts，本文件只回**状态码与数据**（同 A5① epSampleCore 的约定）。
//
// ⚠ 口径（写文案前必读）——本模块在**浏览器 DOM** 上求值（`DOMParser` + `querySelectorAll` /
// `document.evaluate`）。爬虫真正跑的是 lxml / bs4，两侧在少数边界上结果不同：
//   · 浏览器会给缺 <tbody> 的 <table> 自动补一层（lxml 不会）→ `table > tr` 结果不同；
//   · 畸形 HTML 的修复规则不同（标签归属 / 自动闭合位置）；
//   · CSS 支持集不同：浏览器有 `:has()` / `:is()`，cssselect / soupsieve 未必支持。
// 因此面板必须**显式标注**「浏览器 DOM 口径」，**不得**写成「这就是爬虫看到的结果」。
// 另：本模块只用标准 DOM API，**不走 libEval 求值桥**（求值桥纪律管的是 Python 求值；
// 这里根本没有 Python 参与）。代价是口径差异，收益是输入即命中、零依赖、无解释器也能用。

// ---------- 上限（防超大输入把面板卡死） ----------

/** 命中列表上限：超出只计数不建条目（与正则测试器 500 行同族思路，这里更小以保滚动流畅） */
export const MAX_MATCHES = 200;
/** 单条文本摘要截断（字符） */
export const TEXT_LIMIT = 120;
/** 每元素展示的属性条数上限（超出只给总数） */
export const ATTR_LIMIT = 6;
/** 单条属性值截断（字符） */
export const ATTR_VALUE_LIMIT = 80;
/** HTML 求值上限（字符）：超过直接拒绝，不解析 */
export const HTML_MAX_CHARS = 2 * 1024 * 1024;
/** HTML 持久化上限（字符）：超过则不写 storage（面板内仍可用，只是换工具回来会丢） */
export const HTML_PERSIST_LIMIT = 64 * 1024;

// ---------- 选择器类型识别 ----------

export type SelectorKind = "css" | "xpath";

/** XPath 轴（`ancestor::` / `following-sibling::` …）——CSS 里 `::` 是伪元素，故须带轴名才判 */
const XPATH_AXIS_RE =
  /\b(?:ancestor|ancestor-or-self|attribute|child|descendant|descendant-or-self|following|following-sibling|namespace|parent|preceding|preceding-sibling|self)::/;

/**
 * 选择器类型识别（纯字符串规则，无 DOM）。
 *
 * 判 XPath 的信号（按可靠性）：① 以 `/` 开头（`/html/body`、`//a`）② 以 `.` / `..` 后接 `/` 开头
 * （`.//a`、`../div`）③ 以 `(` + `/` 开头（`(//a)[1]`）④ 含具名轴 `xxx::`。
 * 其余一律当 CSS。**已知误判**：CSS 属性值里出现上述形态（如 `a[href^="/x"]`）——
 * 以 `/` 开头才算，故 `a[href^="/x"]` 安全；但 `.//` 开头的选择器只能是 XPath，无歧义。
 */
export function classifySelector(raw: string): SelectorKind {
  const s = raw.trim();
  if (s === "") return "css";
  if (s.startsWith("/")) return "xpath";
  if (/^\.\.?\//.test(s)) return "xpath"; // .//a · ./a · ../div
  if (/^\(\s*\//.test(s)) return "xpath";
  if (XPATH_AXIS_RE.test(s)) return "xpath";
  return "css";
}

/** 输入是否「看起来像 HTML」（含标签起始符）。纯启发式，只用于空态引导与导入校验。 */
export function looksLikeHtml(text: string): boolean {
  return /<[a-zA-Z!/]/.test(text);
}

// ---------- HTML 解析 ----------

/** 解析失败码（文案在面板侧，本文件不产出用户可见字符串） */
export type HtmlError = "tooLarge" | "noParser" | "noBody" | "exception";

export type ParseOutcome = { ok: true; doc: Document } | { ok: false; error: HtmlError };

/**
 * HTML 文本 → Document（`text/html` 模式）。
 *
 * 注意：`text/html` 模式下 `DOMParser` **几乎不会失败**——畸形输入会被浏览器按 HTML5 规则修复，
 * 不是抛错。故本函数的失败分支只覆盖「环境无 DOMParser / 解析器未产出 body / 抛异常」三种基建态，
 * **不承担「输入不是 HTML」的校验**（那由 `looksLikeHtml` 做启发式提示，不阻断求值）。
 */
export function parseHtml(html: string): ParseOutcome {
  if (typeof DOMParser === "undefined") return { ok: false, error: "noParser" };
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc || !doc.body) return { ok: false, error: "noBody" };
    return { ok: true, doc };
  } catch {
    return { ok: false, error: "exception" };
  }
}

// ---------- 命中快照 ----------

export interface MatchInfo {
  /** 文档序（0 基） */
  index: number;
  tag: string;
  id: string;
  classes: string[];
  /** 展示用的属性（已按优先级截断；不含 id / class / style） */
  attrs: Array<[string, string]>;
  /** 属性总数（含被截断的）——用于「共 N 个属性」的诚实标注 */
  attrTotal: number;
  /** 直接文本（仅文本子节点，不含子孙）——爬虫最常取的那一段 */
  ownText: string;
  /** 全部文本（textContent） */
  text: string;
  childCount: number;
  /** 简洁路径（`div.list > a.item:nth-of-type(2)`），用于在页面结构里定位 */
  path: string;
  /** 命中元素本体（预览滚动定位用；不参与序列化） */
  element: Element;
}

/** 属性展示优先级：爬虫高频取值的属性排前面 */
const ATTR_PRIORITY = ["href", "src", "alt", "title", "name", "value", "content", "datetime", "type"];
/** 不进 attrs 的属性（id / class 各自有专列；style 是噪声） */
const ATTR_SKIP = new Set(["id", "class", "style"]);

function truncate(s: string, limit: number): string {
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** 元素属性 → 展示用有序数组（优先级属性在前，其后 data-* / aria-*，再其余按名字序） */
export function elementAttrs(el: Element): Array<[string, string]> {
  const items: Array<{ name: string; value: string; rank: number }> = [];
  for (const a of Array.from(el.attributes)) {
    const name = a.name;
    const lower = name.toLowerCase();
    if (ATTR_SKIP.has(lower)) continue;
    const pi = ATTR_PRIORITY.indexOf(lower);
    const rank = pi >= 0 ? pi : lower.startsWith("data-") || lower.startsWith("aria-") ? 100 : 200;
    items.push({ name, value: truncate(a.value, ATTR_VALUE_LIMIT), rank });
  }
  items.sort((x, y) => (x.rank !== y.rank ? x.rank - y.rank : x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return items.slice(0, ATTR_LIMIT).map((i) => [i.name, i.value] as [string, string]);
}

/** 元素的属性总数（含 id / class / style —— 与展示条数不同，用于诚实标注） */
export function attrTotal(el: Element): number {
  return el.attributes.length;
}

/** 直接文本：只拼文本子节点（不含子孙），空白折叠 */
export function ownText(el: Element): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.nodeValue ?? "";
  }
  return normalizeWs(out);
}

/**
 * 简洁路径：`html > body > div.list > a.item:nth-of-type(2)`。
 * 段内优先用 `#id`，否则取前两个 class；同名兄弟多于一个时补 `:nth-of-type(n)`。
 */
export function elementPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur.tagName.toLowerCase() !== "html") {
    const tag = cur.tagName.toLowerCase();
    let seg = tag;
    const id = cur.getAttribute("id");
    if (id) {
      seg += `#${id}`;
    } else {
      const cls = (cur.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length > 0) seg += `.${cls.join(".")}`;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur?.tagName);
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(seg);
    cur = parent;
  }
  return parts.join(" > ");
}

function snapshot(el: Element, index: number): MatchInfo {
  return {
    index,
    tag: el.tagName.toLowerCase(),
    id: el.getAttribute("id") ?? "",
    classes: (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
    attrs: elementAttrs(el),
    attrTotal: attrTotal(el),
    ownText: truncate(ownText(el), TEXT_LIMIT),
    text: truncate(normalizeWs(el.textContent ?? ""), TEXT_LIMIT),
    childCount: el.children.length,
    path: elementPath(el),
    element: el,
  };
}

// ---------- 求值 ----------

export type EvalResult =
  | { state: "noHtml" }
  | { state: "empty" }
  | { state: "ok"; kind: SelectorKind; count: number; matches: MatchInfo[]; truncated: boolean; nonElement: number }
  | { state: "badSelector"; kind: SelectorKind; error: string }
  | { state: "unsupported"; kind: SelectorKind; error: string };

/** `XPathResult.ORDERED_NODE_SNAPSHOT_TYPE`（用字面量：happy-dom 无该全局，避免 ReferenceError） */
const ORDERED_NODE_SNAPSHOT_TYPE = 7;

const HIGHLIGHT_CLASS = "sel-hit";
const ACTIVE_CLASS = "sel-hit--active";

/** 清掉上一次求值打的高亮类（求值前必须清，否则选择器会看见自己打上的类） */
function clearHighlight(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(`.${HIGHLIGHT_CLASS}`))) {
    el.classList.remove(HIGHLIGHT_CLASS);
    el.classList.remove(ACTIVE_CLASS);
  }
}

/** 命中元素打高亮类；`active` 为选中项下标（-1 = 无） */
export function applyHighlight(elements: readonly Element[], active = -1): void {
  elements.forEach((el, i) => {
    el.classList.add(HIGHLIGHT_CLASS);
    if (i === active) el.classList.add(ACTIVE_CLASS);
  });
}

// ---------- 引擎（解析缓存 + 求值 + 高亮，面板只做渲染） ----------

export interface SelectorEngine {
  /** 换 HTML（内容未变则复用上一次解析）。返回失败码，null = 成功 */
  setHtml(html: string): HtmlError | null;
  /** 求值 + 打高亮（每次调用先清旧高亮）。返回可直接渲染的命中数据 */
  evaluate(selector: string): EvalResult;
  /** 预览用 HTML（`body.innerHTML`，已带高亮类；调用方自行消毒） */
  previewHtml(): string;
  /** 重设「当前命中」（加重高亮），用于列表点击联动预览 */
  setActive(index: number): void;
  /** 当前命中下标（-1 = 无）——面板重建列表时用它恢复选中态 */
  activeIndex(): number;
  /** 命中元素引用（滚动定位） */
  elementAt(index: number): Element | null;
  /** 命中数（无结果 = 0） */
  count(): number;
}

export function createSelectorEngine(): SelectorEngine {
  let html = "";
  let doc: Document | null = null;
  let elements: Element[] = [];
  /** 当前命中下标：跨「切列表/切预览」保留，选择器一变就作废（下标会指向另一个元素） */
  let activeIndex = -1;
  let lastSelector = "";

  function setHtml(next: string): HtmlError | null {
    if (next === html && doc !== null) return null; // 选择器改动不重解析
    html = next;
    elements = [];
    activeIndex = -1;
    if (next.trim() === "") {
      doc = null;
      return null;
    }
    if (next.length > HTML_MAX_CHARS) {
      doc = null;
      return "tooLarge";
    }
    const out = parseHtml(next);
    if (!out.ok) {
      doc = null;
      return out.error;
    }
    doc = out.doc;
    return null;
  }

  function evaluate(selector: string): EvalResult {
    if (doc === null) return { state: "noHtml" };
    clearHighlight(doc);
    elements = [];
    const raw = selector.trim();
    if (raw !== lastSelector) {
      activeIndex = -1; // 换了选择器，旧下标不再指同一元素
      lastSelector = raw;
    }
    if (raw === "") return { state: "empty" };

    const kind = classifySelector(raw);
    let found: Element[] = [];
    let nonElement = 0;

    if (kind === "xpath") {
      const ev = (doc as Document & { evaluate?: unknown }).evaluate;
      if (typeof ev !== "function") {
        return { state: "unsupported", kind, error: "noXPathApi" };
      }
      try {
        const res = doc.evaluate(raw, doc, null, ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < res.snapshotLength; i++) {
          const node = res.snapshotItem(i);
          if (node && node.nodeType === 1) found.push(node as Element);
          else nonElement++;
        }
      } catch (e) {
        return { state: "badSelector", kind, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      try {
        found = Array.from(doc.querySelectorAll(raw));
      } catch (e) {
        return { state: "badSelector", kind, error: e instanceof Error ? e.message : String(e) };
      }
    }

    elements = found;
    const shown = found.slice(0, MAX_MATCHES);
    // 先取快照再打高亮：反过来的话 `classes` 会把我们自己的 `sel-hit` 也读进去
    // （单测 selectorCore.test.ts「命中数与元素元信息」钉住）。
    const matches = shown.map((el, i) => snapshot(el, i));
    const active = activeIndex >= 0 && activeIndex < shown.length ? activeIndex : -1;
    applyHighlight(shown, active);
    return {
      state: "ok",
      kind,
      count: found.length,
      matches,
      truncated: found.length > MAX_MATCHES,
      nonElement,
    };
  }

  return {
    setHtml,
    evaluate,
    previewHtml: () => (doc === null ? "" : doc.body.innerHTML),
    setActive: (index) => {
      const el = elements[index];
      if (!el) return;
      activeIndex = index;
      for (const hit of Array.from(el.ownerDocument.querySelectorAll(`.${ACTIVE_CLASS}`))) {
        hit.classList.remove(ACTIVE_CLASS);
      }
      el.classList.add(ACTIVE_CLASS);
    },
    activeIndex: () => activeIndex,
    elementAt: (index) => elements[index] ?? null,
    count: () => elements.length,
  };
}

// ---------- Python 片段 ----------

/**
 * 选择器 → 可直接粘进爬虫的 Python 片段。
 *
 * CSS 走 bs4（`soup.select` 用随包的 soupsieve，无需另装 cssselect）；XPath 走 lxml
 * （bs4 不支持 XPath）。**不做引擎可选**：本面板不假装知道项目用的是 bs4 还是 lxml，
 * 两种形态各给最通用的一版，用户按自己的栈取用。
 */
export function selectorToPython(raw: string, kind: SelectorKind): string {
  const lit = JSON.stringify(raw);
  if (kind === "xpath") {
    return [
      "# lxml（bs4 不支持 XPath）",
      "from lxml import html",
      "",
      "tree = html.fromstring(resp.text)",
      `for el in tree.xpath(${lit}):`,
      "    print(el.text_content().strip())",
    ].join("\n");
  }
  return [
    "# BeautifulSoup（bs4；select 用随包的 soupsieve，无需 cssselect）",
    "from bs4 import BeautifulSoup",
    "",
    'soup = BeautifulSoup(resp.text, "lxml")',
    `for el in soup.select(${lit}):`,
    "    print(el.get_text(strip=True))",
  ].join("\n");
}
