/**
 * A4 · 爬虫工具箱「选择器测试」E2E 验收（交付记录见 docs/delivery-overview.md §2 第 27 行）。
 *
 * 覆盖：
 *  1. 入口与空态（Ctrl+Shift+T → picker → 工具挂载）
 *  2. CSS 命中：命中数 / 列表条目 / 属性与文本摘要
 *  3. 类型徽章自动识别（CSS ↔ XPath）
 *  4. **XPath 真实命中**（happy-dom 无 document.evaluate，这条只能在真 Chromium 里验）
 *  5. 非法选择器 → 错误槽（happy-dom 对非法选择器不抛，也测不到）
 *  6. 结构预览：`.sel-hit` 打上 + 列表点击 → `.sel-hit--active`
 *  7. 零命中空态
 *  8. 复制为 Python → `__E2E_COPIED__`（含 bs4 片段）
 *  9. 口径说明常驻（口径红线：浏览器 DOM 口径，不得被删）
 * 10. HTTP 响应 →「测试选择器」桥（A4 ③ 的入口）
 *
 * **全程离线**：不触网；HTTP 桥用 `__E2E_HTTP__` 罐头响应。
 */
import { expect, test, type Page } from "@playwright/test";
import { equipPage, makePlainDir } from "../helpers";

const PAGE_HTML = [
  '<div class="list">',
  '  <a class="item" href="/p/1" data-id="7" title="第一">商品一</a>',
  '  <a class="item" href="/p/2" data-id="8">商品二</a>',
  '  <a class="item promo" href="/p/3">商品三</a>',
  "</div>",
].join("\n");

/** 打开 devtools 面板并切到「选择器测试」（picker 搜索 → Enter） */
async function openSelectorTool(page: Page): Promise<void> {
  const panelOpen = await page.locator("#right-panel:not(.hidden)").count();
  if (panelOpen > 0) {
    await page.locator("#devtools-close").click();
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator("#devtools-picker")).toBeVisible({ timeout: 5_000 });
  await page.locator("#devtools-picker-search").fill("选择器测试");
  await page.keyboard.press("Enter");
  await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-pane")).toBeVisible({ timeout: 5_000 });
}

/** 打开 HTTP 工具（桥用例用） */
async function openHttpTool(page: Page): Promise<void> {
  const panelOpen = await page.locator("#right-panel:not(.hidden)").count();
  if (panelOpen > 0) {
    await page.locator("#devtools-close").click();
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator("#devtools-picker")).toBeVisible({ timeout: 5_000 });
  await page.locator("#devtools-picker-search").fill("HTTP 请求");
  await page.keyboard.press("Enter");
  await expect(page.locator(".devtools-tool-root:not(.hidden) .http-url")).toBeVisible({ timeout: 5_000 });
}

/** 填入 HTML（textarea 的 input 事件触发 150ms 防抖求值） */
async function fillHtml(page: Page, html: string): Promise<void> {
  await page.locator(".devtools-tool-root:not(.hidden) .sel-html-body .tool-textarea").fill(html);
}

/** 填入选择器（input 的 input 事件触发 150ms 防抖求值） */
async function fillSelector(page: Page, sel: string): Promise<void> {
  await page.locator(".devtools-tool-root:not(.hidden) .tool-input").first().fill(sel);
}

async function equip(page: Page): Promise<void> {
  const repo = await makePlainDir({ "main.py": "print('hello world')\n" });
  await equipPage(page, repo);
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible({ timeout: 15_000 });
  // init() 是异步的：#editor 静态存在 ≠ init 完成（**键位接线与内置工具注册在其后**）。
  // 不等这一步就按 Ctrl+Shift+T，会撞上「键位还没接好」→ picker 恒 hidden（本轮实测踩到：
  // SEL-1/3/4/8 随机挂在这条，SEL-2/5/6/7/9/10 又过——典型竞态）。照 http / plugins 域口径。
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log =
            (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
          return log.some((x) => x.startsWith("list_plugin_dirs")) &&
            document.querySelectorAll(".menubar-item").length > 0
            ? 1
            : 0;
        }),
      { timeout: 15_000 },
    )
    .toBe(1);
}

test.describe("A4 · 选择器测试", () => {
  test.beforeEach(async ({ page }) => {
    await equip(page);
  });

  test("SEL-1 入口与空态", async ({ page }) => {
    await openSelectorTool(page);
    // 空态：先粘贴 HTML
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-pane .empty-title")).toHaveText("先粘贴页面 HTML");
    // 口径说明常驻（口径红线，SEL-9 也钉）
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-note").first()).toContainText("浏览器 DOM");
    // 未输入选择器时不显示类型徽章
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-kind")).toBeHidden();
  });

  test("SEL-2 CSS 命中：计数 / 条目 / 属性与文本摘要", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);
    await fillSelector(page, "div.list > a.item");

    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-summary")).toContainText("命中 3");
    const items = page.locator(".devtools-tool-root:not(.hidden) .sel-item");
    await expect(items).toHaveCount(3);
    // 条目 1：tag / id-less / class / 序号
    await expect(items.first().locator(".sel-item-tag")).toHaveText("a");
    await expect(items.first().locator(".sel-item-class").first()).toHaveText(".item");
    await expect(items.first().locator(".sel-item-nth")).toHaveText("#1");
    // 文本摘要取直接文本
    await expect(items.first().locator(".sel-item-text")).toHaveText("商品一");
    // 属性摘要含 href 与 data-id
    await expect(items.first().locator(".sel-item-meta")).toContainText("href=/p/1");
    await expect(items.first().locator(".sel-item-meta")).toContainText("data-id=7");
    // 路径含父级 class 与 nth-of-type（同名兄弟多于一个）
    await expect(items.nth(1).locator(".sel-item-path")).toContainText("div.list");
    await expect(items.nth(1).locator(".sel-item-path")).toContainText(":nth-of-type(2)");
    // HTML 区标题带字符数
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-html > summary")).toContainText("字符");
  });

  test("SEL-3 类型徽章自动识别 CSS / XPath", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);

    await fillSelector(page, "a.item");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-kind")).toHaveText("CSS");

    await fillSelector(page, "//a[@class='item']");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-kind")).toHaveText("XPath");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-kind")).toHaveAttribute("data-kind", "xpath");

    await fillSelector(page, "#nope");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-kind")).toHaveText("CSS");
  });

  test("SEL-4 XPath 在真实 Chromium 下命中（happy-dom 覆盖不到）", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);
    await fillSelector(page, "//a[@class='item']");

    // ⚠ 这里**故意是 2 不是 3**：XPath 的 `@class='item'` 是**精确串匹配**，而第 3 个锚点写的是
    // `class="item promo"` → 不等于 `item`，故不命中。CSS `.item`（SEL-2）按**类列表**匹配才会给 3。
    // 这条差异正是「CSS 与 XPath 语义不同」的现场证据，也是本面板值得存在的原因之一。
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-summary")).toContainText("命中 2");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-item")).toHaveCount(2);
    // 未出现「不支持 XPath」的降级提示
    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-error")).toBeEmpty();

    // 换成 contains() 的写法 → 与 CSS 的类列表语义对齐，3 条全中
    await fillSelector(page, "//a[contains(@class, 'item')]");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-summary")).toContainText("命中 3");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-item")).toHaveCount(3);
  });

  test("SEL-5 非法选择器 → 错误槽（不是崩溃）", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);
    await fillSelector(page, "div >>>> a");

    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-error")).toContainText("选择器无效");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-item")).toHaveCount(0);
  });

  test("SEL-6 结构预览：命中高亮 + 列表点击切换当前项", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);
    await fillSelector(page, "a.item");

    // 切到结构预览
    await page.locator(".devtools-tool-root:not(.hidden) .tool-radio", { hasText: "结构预览" }).click();
    const preview = page.locator(".devtools-tool-root:not(.hidden) .sel-preview");
    await expect(preview).toBeVisible();
    await expect(preview.locator(".sel-hit")).toHaveCount(3);
    // 预览已剥离 script（结构预览而非页面渲染）
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-preview-box .sel-note")).toContainText("结构预览");

    // 切回列表并点击第 2 条 → 该元素成为当前命中
    await page.locator(".devtools-tool-root:not(.hidden) .tool-radio", { hasText: "命中列表" }).click();
    const items = page.locator(".devtools-tool-root:not(.hidden) .sel-item");
    await items.nth(1).click();
    await expect(items.nth(1)).toHaveClass(/is-active/);
    await expect(items.first()).not.toHaveClass(/is-active/);
    // 回预览：当前项带加重高亮，且只有一个
    await page.locator(".devtools-tool-root:not(.hidden) .tool-radio", { hasText: "结构预览" }).click();
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-preview .sel-hit--active")).toHaveCount(1);
  });

  test("SEL-7 零命中 → 空态而非错误", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);
    await fillSelector(page, ".not-there");

    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-summary")).toContainText("命中 0");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-pane .empty-title")).toHaveText("没有命中");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-error")).toBeEmpty();
  });

  test("SEL-8 复制为 Python（CSS → bs4 片段）", async ({ page }) => {
    await openSelectorTool(page);
    await fillHtml(page, PAGE_HTML);
    await fillSelector(page, "div.list > a.item");

    await page.locator(".devtools-tool-root:not(.hidden) .tool-toolbar .btn", { hasText: "复制为 Python" }).click();
    const copied = await page.evaluate(() => (window as unknown as { __E2E_COPIED__?: string[] }).__E2E_COPIED__ ?? []);
    const snippet = copied.at(-1) ?? "";
    expect(snippet).toContain("from bs4 import BeautifulSoup");
    expect(snippet).toContain('soup.select("div.list > a.item")');
  });

  test("SEL-9 口径说明常驻（红线：不得被删）", async ({ page }) => {
    await openSelectorTool(page);
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-note").first()).toContainText("不等于爬虫实际结果");
  });

  test("SEL-10 HTTP 响应 → 测试选择器（A4 ③ 桥）", async ({ page }) => {
    const htmlBody = PAGE_HTML;
    await page.evaluate((body) => {
      (window as unknown as Record<string, unknown>).__E2E_HTTP__ = {
        status: 200,
        statusText: "OK",
        headers: [["content-type", "text/html; charset=utf-8"]],
        body,
        bodyBase64: null,
        bytes: body.length,
        elapsedMs: 8,
        redirectChain: [],
        truncated: false,
        privateTarget: false,
        binary: false,
      };
    }, htmlBody);

    await openHttpTool(page);
    await page.locator(".devtools-tool-root:not(.hidden) .http-url").fill("https://example.com/list");
    await page.locator(".devtools-tool-root:not(.hidden) button", { hasText: "发送" }).click();
    await expect(page.locator(".devtools-tool-root:not(.hidden) .http-resp-status")).toContainText("200");

    // 响应工具栏是 .http-response 的兄弟节点，故按按钮文案定位（同 http 域 spec 的做法）
    await page.locator(".devtools-tool-root:not(.hidden) button", { hasText: "选择器测试" }).click();
    // 工具切到选择器测试，且 HTML 已导入（折叠区收起 → 摘要里有字符数）
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-pane")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-html > summary")).toContainText("字符");
    await fillSelector(page, "a.item.promo");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-summary")).toContainText("命中 1");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .sel-item .sel-item-text")).toHaveText("商品三");
  });
});
