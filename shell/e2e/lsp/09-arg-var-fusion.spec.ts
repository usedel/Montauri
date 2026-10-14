/**
 * E2E：实参位作用域变量融合（运行前补全，FUSION-1）。
 *
 * 走**真实 pyrefly 桥**（equipPage realPyrefly）：本特性的存在理由是 pyrefly 自身的断路——
 * 空前缀只回参数名（isIncomplete=false）+ Monaco 完整列表不重请求，变量候选永远到不了用户眼前；
 * 融合层（completion/argVarCompletion.ts）用 signatureHelp 探测实参位并注入变量候选。
 * 计划真源：docs/arg_var_fusion_dev_plan.md（§0 探针实证链 / §6.2 本表）。
 *
 * ⚠ 行文本断言纪律（计划 E8）：pyrefly inlay hint 会改写 view-line 的 DOM 文本
 * （`def run() -> None:` / `page: str`），hasText 匹配行时避开污染段，键盘定位用
 * Ctrl+End + 方向键，不用像素点击行。
 *
 * E-AV-4 的 ghost 显式触发通道（__OC_ARGVAR__ dev-only 钩子，debugGutter __OC_DEBUG_TEST__
 * 先例；产品键位接线见计划 §4-4）；E-AV-6 的 augmentation 同屏通道（带前缀 + 下拉打开，
 * 灰字 = 选中项剩余 + 扩展段——PROBE-AUG 实证，编辑预测同链路，见计划 §1.2）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo } from "../helpers";

const LIB_PY = [
  "def parse_page(url: str, timeout: int = 10, retries: int = 3) -> str:",
  '    """Fetch a page."""',
  "    return url",
  "",
].join("\n");

const MAIN_PY = [
  "from lib import parse_page",
  "",
  "def run():",
  '    cb_url = "https://example.com"',
  "    page_num = 42",
  "    page = parse_page(",
].join("\n");

let stopPyrefly: (() => void) | undefined;

async function openMain(page: Page): Promise<void> {
  const file = page.locator("#tree .tree-item .name", { hasText: "main.py" }).first();
  await file.dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "lib.py": LIB_PY, "main.py": MAIN_PY },
    commitMsg: "baseline",
  });
  const equipped = await equipPage(page, repo, { realPyrefly: true });
  stopPyrefly = equipped.stopPyrefly;
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await expect(page.locator("#status-lsp")).toContainText("就绪", { timeout: 30_000 });
  await openMain(page);
});

test.afterEach(async () => {
  stopPyrefly?.();
  stopPyrefly = undefined;
});

/** 焦点编辑器 + Ctrl+End 到文件尾（最后一行即调用行 `page = parse_page(`，光标落 `(` 后） */
async function focusTail(page: Page): Promise<void> {
  const editor = page.locator("#editor .monaco-editor");
  await editor.click();
  await page.keyboard.press("Control+End");
  await expect(page.locator("#status-file")).toContainText("main", { timeout: 5_000 });
}

test("E-AV-1 `(` 触发瞬间：融合变量置顶 + pyrefly 参数名候选同屏", async ({ page }) => {
  await focusTail(page);
  // 删掉 ( 重打，制造触发字符瞬间（Ctrl+End 是光标移动，不触发补全）
  await page.keyboard.press("Backspace");
  await page.keyboard.type("(");
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  // 融合层注入的变量（pyrefly 空前缀不回变量的洞，被融合层补上）
  await expect(suggest.locator(".monaco-list-row", { hasText: "cb_url" }).first()).toBeVisible({ timeout: 5_000 });
  // pyrefly 原生的参数名候选仍在
  await expect(suggest.locator(".monaco-list-row", { hasText: "url=" }).first()).toBeVisible({ timeout: 5_000 });
});

test("E-AV-2 逐字输入：incomplete 重触发，列表收窄仍含融合变量", async ({ page }) => {
  await focusTail(page);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("(");
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  await expect(suggest.locator(".monaco-list-row", { hasText: "cb_url" }).first()).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type("c");
  await expect(suggest.locator(".monaco-list-row", { hasText: "cb_url" }).first()).toBeVisible({ timeout: 5_000 });
  await page.keyboard.type("b_");
  await expect(suggest.locator(".monaco-list-row", { hasText: "cb_url" }).first()).toBeVisible({ timeout: 5_000 });
});

test("E-AV-3 非实参位：融合层零介入，编辑器无报错", async ({ page }) => {
  const editor = page.locator("#editor .monaco-editor");
  await editor.click();
  await page.keyboard.press("Control+End");
  // 上移两行到 cb_url 行尾（page_num 行、cb_url 行），普通赋值位输入
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.keyboard.type("x"); // 非实参位，signatureHelp 空 → 融合层零介入
  await expect(editor).toBeVisible();
  const line = page.locator("#editor .monaco-editor .view-line", { hasText: "example.com" }).first();
  await expect(line).toBeVisible({ timeout: 5_000 });
});

test("E-AV-4 ghost text：显式触发通道灰字建议（扩展形态），采纳落文档", async ({ page }) => {
  // 无 suggest 历史（不输入触发字符）→ 干净 ghost 通道（引擎协同语义，计划 E5/E6）。
  // 扩展形态（计划 §1.2）：ghost = 变量名 + ", <下参名>=<默认值>)"——Tab 一步补全整个调用。
  await focusTail(page);
  await page.evaluate(() => {
    const hook = (window as unknown as { __OC_ARGVAR__?: { triggerInline: () => Promise<void> | undefined } }).__OC_ARGVAR__;
    if (!hook) throw new Error("__OC_ARGVAR__ not exposed");
    return hook.triggerInline();
  });
  const ghost = page.locator("#editor .monaco-editor .ghost-text-decoration").first();
  await expect(ghost).toBeVisible({ timeout: 10_000 });
  await expect(ghost).toContainText("cb_url");
  // 采纳走 accept action（Playwright 下 Tab 对 Monaco keybinding 有键位抖动——产品上 Tab
  // 是标准键位（Monaco commands.js kbOpts），真机手测剧本覆盖 Tab，e2e 验同一语义链路）
  await page.evaluate(() => {
    const hook = (window as unknown as { __OC_ARGVAR__?: { acceptInline: () => Promise<void> | undefined } }).__OC_ARGVAR__;
    return hook?.acceptInline();
  });
  await expect(
    page.locator("#editor .monaco-editor .view-line", { hasText: "parse_page(cb_url, timeout=10)" }).first(),
  ).toBeVisible({ timeout: 5_000 });
});

test("E-AV-5 类型匹配（v2）：第 2 参数位 int 变量压过 str 变量", async ({ page }) => {
  // timeout:int 位上，page_num（Literal[42]→int，tier1）应压过 cb_url（str，不匹配，tier3）
  await focusTail(page);
  await page.keyboard.type(","); // 进入第 2 参数位（timeout: int）——只输逗号：
  // 空格是非 word 字符且当前 word 为空，Monaco 会立刻 hide suggest（探针实证）
  await page.waitForTimeout(600); // 等 suggest + hover 往返 + tier 排序
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  const rows = suggest.locator(".monaco-list-row");
  await expect(rows.filter({ hasText: "page_num" }).first()).toBeVisible({ timeout: 5_000 });
  // tier 排序断言：page_num 的行序号 < cb_url 的行序号（类型匹配压过不匹配）
  const order = await rows.evaluateAll((els) => {
    const idx = (t: string) => els.findIndex((e) => (e.textContent || "").includes(t));
    return { page: idx("page_num"), cb: idx("cb_url") };
  });
  expect(order.page).toBeGreaterThanOrEqual(0);
  expect(order.cb).toBeGreaterThanOrEqual(0);
  expect(order.page).toBeLessThan(order.cb);
});

test("E-AV-6 augmentation 灰字：带前缀 + 下拉打开 → 选中项剩余 + 扩展段同屏", async ({ page }) => {
  // PROBE-AUG 实证链路的产品化验证（计划 §1.2 / edit_prediction_research_plan §10.1）：
  // 输入 c（带前缀，provider 恢复响应）→ 下拉选中 cb_url（硬选中）+ inline 扩展形态
  //（cb_url + ", timeout=10)"）→ 引擎 augmentation 渲染灰字 = 选中项剩余（b_url）+ 扩展段。
  await focusTail(page);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("(");
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.keyboard.type("c"); // 带前缀：下拉收窄选中 cb_url + inline（扩展形态）参与 augmentation
  await expect(suggest.locator(".monaco-list-row.focused", { hasText: "cb_url" }).first()).toBeVisible({ timeout: 5_000 });
  // 采样灰字（augmentation 计算需要 suggest 选中项稳定 + hover 往返，2s 窗口）
  const seen: string[] = [];
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const hits = await page.evaluate(() => {
      const el = document.querySelector("#editor .monaco-editor");
      if (!el) return [];
      const out: string[] = [];
      for (const m of el.innerHTML.matchAll(/<span[^>]*class="([^"]*(?:ghost|preview)[^"]*)"[^>]*>([^<]*)<\/span>/g)) {
        out.push(m[2]);
      }
      return out;
    });
    for (const h of hits) if (!seen.includes(h)) seen.push(h);
    if (seen.some((s) => s.includes("b_url") && s.includes(","))) break; // 命中即提前结束
    await page.waitForTimeout(120);
  }
  console.log("AUG-GHOST:", JSON.stringify(seen));
  // 断言：灰字渲染了选中项剩余（b_url）与扩展段（含下一参数名 timeout）——引擎渲染成独立 span
  const hasRemainder = seen.some((s) => s.includes("b_url"));
  const hasExtension = seen.some((s) => s.includes("timeout=10"));
  expect(hasRemainder, "灰字应含选中项剩余 b_url，实际：" + JSON.stringify(seen)).toBe(true);
  expect(hasExtension, "灰字应含扩展段（timeout），实际：" + JSON.stringify(seen)).toBe(true);
});
