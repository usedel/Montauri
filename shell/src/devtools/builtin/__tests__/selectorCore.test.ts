// @vitest-environment happy-dom
// A4 · 爬虫工具箱「选择器测试」求值层单测（交付记录见 docs/delivery-overview.md §2 第 27 行）。
//
// 环境口径：happy-dom 有 DOMParser + querySelectorAll，但**没有 document.evaluate**——
// 这正好让「XPath 在本环境不可用 → 降级为 unsupported」这条分支可被单测钉住。
// 真实 Chromium 下的 XPath 命中由 e2e 覆盖（happy-dom 测不到）。

import { describe, expect, it } from "vitest";
import {
  ATTR_LIMIT,
  HTML_MAX_CHARS,
  MAX_MATCHES,
  TEXT_LIMIT,
  applyHighlight,
  attrTotal,
  classifySelector,
  createSelectorEngine,
  elementAttrs,
  elementPath,
  looksLikeHtml,
  ownText,
  parseHtml,
  selectorToPython,
} from "../selectorCore";

const PAGE = `<!doctype html>
<html><body>
  <div class="list">
    <a class="item" href="/p/1" data-id="7" title="第一" style="color:red" id="first">  商品 一  </a>
    <a class="item" href="/p/2" data-id="8">商品二</a>
    <a class="item promo" href="/p/3">商品三</a>
  </div>
  <table><tr><td>1</td></tr></table>
</body></html>`;

function engineWith(html: string) {
  const e = createSelectorEngine();
  expect(e.setHtml(html)).toBeNull();
  return e;
}

describe("classifySelector（CSS / XPath 识别）", () => {
  it("以 / 开头的是 XPath（绝对与相对两种）", () => {
    expect(classifySelector("/html/body")).toBe("xpath");
    expect(classifySelector("//a[@class='item']")).toBe("xpath");
    expect(classifySelector("  //div  ")).toBe("xpath");
  });
  it(".// 与 ../ 前缀是 XPath", () => {
    expect(classifySelector(".//a")).toBe("xpath");
    expect(classifySelector("../div")).toBe("xpath");
    expect(classifySelector("./a")).toBe("xpath");
  });
  it("(//a)[1] 这种括号包裹的相对 XPath", () => {
    expect(classifySelector("(//a)[1]")).toBe("xpath");
  });
  it("具名轴（ancestor:: 等）是 XPath", () => {
    expect(classifySelector("div/ancestor::section")).toBe("xpath");
    expect(classifySelector("following-sibling::td")).toBe("xpath");
  });
  it("CSS 一律不被误判——含 :: 伪元素与属性值里的斜杠", () => {
    expect(classifySelector("div.list > a.item")).toBe("css");
    expect(classifySelector("#first")).toBe("css");
    expect(classifySelector("[data-id='7']")).toBe("css");
    expect(classifySelector("a::before")).toBe("css");
    expect(classifySelector("a[href^='/p/']")).toBe("css");
    expect(classifySelector("")).toBe("css");
  });
});

describe("looksLikeHtml（启发式提示，不阻断求值）", () => {
  it("含标签起始符判为像 HTML", () => {
    expect(looksLikeHtml("<div>x</div>")).toBe(true);
    expect(looksLikeHtml("<!doctype html>")).toBe(true);
  });
  it("纯文本 / JSON 判为不像", () => {
    expect(looksLikeHtml("hello")).toBe(false);
    expect(looksLikeHtml('{"a": 1}')).toBe(false);
  });
});

describe("parseHtml", () => {
  it("正常 HTML → 有 body 的文档", () => {
    const out = parseHtml("<p>hi</p>");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.doc.body.textContent).toBe("hi");
  });
  it("畸形 HTML 不抛错（HTML5 修复而非失败）", () => {
    const out = parseHtml("<div><span>未闭合");
    expect(out.ok).toBe(true);
  });
});

describe("引擎 · CSS 求值", () => {
  it("命中数与元素元信息", () => {
    const e = engineWith(PAGE);
    const res = e.evaluate("div.list > a.item");
    expect(res.state).toBe("ok");
    if (res.state !== "ok") return;
    expect(res.kind).toBe("css");
    expect(res.count).toBe(3);
    expect(res.matches.map((m) => m.tag)).toEqual(["a", "a", "a"]);
    expect(res.matches[0].id).toBe("first");
    expect(res.matches[0].classes).toEqual(["item"]);
    expect(res.matches[2].classes).toEqual(["item", "promo"]);
    expect(res.matches[0].childCount).toBe(0);
    expect(res.truncated).toBe(false);
    expect(res.nonElement).toBe(0);
  });

  it("ownText 只取直接文本并折叠空白；text 取全部文本", () => {
    const e = engineWith(`<div class="x">  甲  <b>乙</b>  丙 </div>`);
    const res = e.evaluate(".x");
    if (res.state !== "ok") throw new Error("应命中");
    expect(res.matches[0].ownText).toBe("甲 丙");
    expect(res.matches[0].text).toBe("甲 乙 丙");
  });

  it("无命中 → ok + count 0（不是错误态）", () => {
    const e = engineWith(PAGE);
    const res = e.evaluate(".nope");
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.count).toBe(0);
  });

  it("非法选择器 → badSelector（不抛到调用方）", () => {
    // ⚠ happy-dom 的 CSS 引擎**不按规范拒绝非法选择器**（实测 `div >>>> a` / `div[` / `a:nth-child(`
    // 都不抛，甚至返回命中）。故这里先探测环境是否真会抛：会抛才断言 badSelector，否则跳过——
    // 真实 Chromium 下该分支由 e2e `tools/01-selector.spec.ts` 钉住。
    const probe = createSelectorEngine();
    probe.setHtml("<div><a>x</a></div>");
    let throws = false;
    try {
      probe.evaluate("div >>>> a");
    } catch {
      throws = true;
    }
    if (!throws) {
      expect(probe.evaluate("div >>>> a").state).toBe("ok"); // 记录 happy-dom 的宽松行为
      return;
    }
    expect(probe.evaluate("div >>>> a").state).toBe("badSelector");
  });

  it("空选择器 → empty；无 HTML → noHtml", () => {
    const e = engineWith(PAGE);
    expect(e.evaluate("   ").state).toBe("empty");
    const empty = createSelectorEngine();
    empty.setHtml("");
    expect(empty.evaluate("div").state).toBe("noHtml");
  });

  it("超过 MAX_MATCHES 只计数 + truncated", () => {
    const many = `<div>${Array.from({ length: MAX_MATCHES + 25 }, () => "<i>x</i>").join("")}</div>`;
    const e = engineWith(many);
    const res = e.evaluate("i");
    expect(res.state).toBe("ok");
    if (res.state !== "ok") return;
    expect(res.count).toBe(MAX_MATCHES + 25);
    expect(res.matches).toHaveLength(MAX_MATCHES);
    expect(res.truncated).toBe(true);
  });

  it("超长文本按 TEXT_LIMIT 截断并带省略号", () => {
    const e = engineWith(`<p>${"字".repeat(TEXT_LIMIT + 50)}</p>`);
    const res = e.evaluate("p");
    if (res.state !== "ok") throw new Error("应命中");
    expect(res.matches[0].text).toHaveLength(TEXT_LIMIT + 1); // +1 = 省略号
    expect(res.matches[0].text.endsWith("…")).toBe(true);
  });
});

describe("引擎 · 高亮与清理", () => {
  it("求值后命中元素带 .sel-hit；下一次求值前先清（否则选择器会看见自己打的类）", () => {
    const e = engineWith(PAGE);
    e.evaluate("a.item");
    // 若没清理，这个选择器会返回 0（所有 a.item 都已被打上 .sel-hit）
    const after = e.evaluate("a.item:not(.sel-hit)");
    expect(after.state).toBe("ok");
    if (after.state === "ok") expect(after.count).toBe(3);
    // 注意：不能用 evaluate(".sel-hit") 验高亮——evaluate 每次先清高亮，恒返回 0。
    // 高亮是否打上，只能从序列化产物看。
    expect(e.previewHtml().match(/sel-hit/g)?.length).toBe(3);
  });

  it("setActive 只留一个 .sel-hit--active，且能取回元素引用", () => {
    const e = engineWith(PAGE);
    e.evaluate("a.item");
    e.setActive(1);
    expect(e.count()).toBe(3);
    const el = e.elementAt(1);
    expect(el?.getAttribute("href")).toBe("/p/2");
    const doc = el?.ownerDocument;
    expect(doc?.querySelectorAll(".sel-hit--active").length).toBe(1);
    expect(e.elementAt(99)).toBeNull();
  });

  it("previewHtml 是 body 的序列化（带高亮类）", () => {
    const e = engineWith(PAGE);
    e.evaluate("a.promo");
    const html = e.previewHtml();
    expect(html).toContain("sel-hit");
    expect(html).toContain("/p/3");
    expect(html).not.toContain("<html");
  });

  it("当前命中下标跨重新求值保留；选择器一变即作废", () => {
    const e = engineWith(PAGE);
    e.evaluate("a.item");
    e.setActive(2);
    expect(e.activeIndex()).toBe(2);
    // 同一选择器重新求值（面板切列表/切预览会走这条路）→ 保留
    e.evaluate("a.item");
    expect(e.activeIndex()).toBe(2);
    expect(e.previewHtml()).toContain("sel-hit--active");
    // 换选择器 → 下标不再指同一元素，作废
    e.evaluate("a.item.promo");
    expect(e.activeIndex()).toBe(-1);
    // 同一选择器 + 命中数缩水到下标之外 → 不越界加 active
    const e2 = engineWith(PAGE);
    e2.evaluate("a.item");
    e2.setActive(2);
    e2.setHtml("<a class='item'>x</a>");
    e2.evaluate("a.item");
    expect(e2.activeIndex()).toBe(-1);
    expect(e2.previewHtml()).not.toContain("sel-hit--active");
  });

  it("applyHighlight 是纯标记（不改变命中数）", () => {
    const out = parseHtml(PAGE);
    if (!out.ok) throw new Error("解析失败");
    const els = Array.from(out.doc.querySelectorAll("a.item"));
    applyHighlight(els, 0);
    expect(out.doc.querySelectorAll("a.item").length).toBe(3);
    expect(out.doc.querySelectorAll(".sel-hit--active").length).toBe(1);
  });
});

describe("引擎 · XPath 降级（happy-dom 无 document.evaluate）", () => {
  it("识别为 XPath 但本环境不支持 → unsupported（不是 badSelector）", () => {
    const e = engineWith(PAGE);
    const res = e.evaluate("//a[@class='item']");
    if (typeof (document as unknown as { evaluate?: unknown }).evaluate === "function") {
      // 万一跑在真浏览器环境（jsdom 某些版本提供），只断言不崩
      expect(["ok", "badSelector"]).toContain(res.state);
      return;
    }
    expect(res.state).toBe("unsupported");
    if (res.state === "unsupported") expect(res.kind).toBe("xpath");
  });
});

describe("引擎 · 输入上限", () => {
  it("HTML 超限 → tooLarge（不解析）", () => {
    const e = createSelectorEngine();
    expect(e.setHtml("x".repeat(HTML_MAX_CHARS + 1))).toBe("tooLarge");
    expect(e.evaluate("div").state).toBe("noHtml");
  });
  it("HTML 未变时复用解析结果（返回 null 而非重复解析）", () => {
    const e = createSelectorEngine();
    expect(e.setHtml("<div>x</div>")).toBeNull();
    expect(e.setHtml("<div>x</div>")).toBeNull();
  });
});

describe("元素摘要", () => {
  it("elementAttrs：优先级属性在前、跳过 id/class/style、带总数", () => {
    const out = parseHtml(PAGE);
    if (!out.ok) throw new Error("解析失败");
    const a = out.doc.querySelector("#first");
    if (!a) throw new Error("应找到元素");
    const attrs = elementAttrs(a);
    const names = attrs.map(([k]) => k);
    expect(names).toContain("href");
    expect(names).not.toContain("id");
    expect(names).not.toContain("class");
    expect(names).not.toContain("style");
    // href 在优先级表里排第一，应领先 data-id / title
    expect(names.indexOf("href")).toBeLessThan(names.indexOf("data-id"));
    expect(attrTotal(a)).toBe(6); // class id href data-id title style
  });

  it("elementAttrs：属性条数受 ATTR_LIMIT 限制", () => {
    const many = `<div ${Array.from({ length: 12 }, (_, i) => `data-k${i}="v"`).join(" ")}></div>`;
    const out = parseHtml(many);
    if (!out.ok) throw new Error("解析失败");
    const div = out.doc.body.firstElementChild;
    if (!div) throw new Error("应找到元素");
    expect(elementAttrs(div)).toHaveLength(ATTR_LIMIT);
    expect(attrTotal(div)).toBe(12);
  });

  it("ownText：无文本子节点时为空串", () => {
    const out = parseHtml("<div><span>只读子孙</span></div>");
    if (!out.ok) throw new Error("解析失败");
    const div = out.doc.body.firstElementChild;
    if (!div) throw new Error("应找到元素");
    expect(ownText(div)).toBe("");
  });

  it("elementPath：同名兄弟多于一个时补 nth-of-type，含 id 时优先用 #id", () => {
    const out = parseHtml(PAGE);
    if (!out.ok) throw new Error("解析失败");
    const first = out.doc.querySelector("#first");
    const second = out.doc.querySelectorAll("a.item")[1];
    if (!first || !second) throw new Error("应找到元素");
    expect(elementPath(first)).toContain("#first");
    expect(elementPath(second)).toContain(":nth-of-type(2)");
    expect(elementPath(second)).toContain("div.list");
  });
});

describe("selectorToPython", () => {
  it("CSS → bs4 片段（选择器字面量 JSON 转义，引号安全）", () => {
    const code = selectorToPython("a.item[href^='/p/']", "css");
    expect(code).toContain("from bs4 import BeautifulSoup");
    expect(code).toContain('soup.select("a.item[href^=\'/p/\']")');
    expect(code).toContain("get_text(strip=True)");
  });
  it("XPath → lxml 片段", () => {
    const code = selectorToPython("//a[@class='item']", "xpath");
    expect(code).toContain("from lxml import html");
    expect(code).toContain("tree.xpath(");
    expect(code).toContain("text_content()");
  });
  it("片段是合法可编译形态（缩进块闭合）", () => {
    const code = selectorToPython(".x", "css");
    expect(code.split("\n").at(-1)).toBe("    print(el.get_text(strip=True))");
  });
});
