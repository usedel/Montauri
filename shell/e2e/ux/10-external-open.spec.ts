/**
 * E2E（PyCharm 调研借鉴）：外开类型手势分流（xlsx/docx/pdf 等二进制不在编辑器打开）。
 *
 * E1：单击 xlsx → 只选中：不外开、不开 Tab、无失败 toast
 * E2：双击 xlsx → opener 外开（__E2E_OPENED_PATHS__ 命中）
 * E3：双击 py → 正常开编辑 Tab，不进外开表
 * E4：右键「用系统默认程序打开」→ 外开命中
 *
 * mock 侧 `plugin:opener|open_path` 只记录不真开（CI 无桌面）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

let repo: GitRepo;

test.beforeEach(async ({ page }) => {
  repo = await makePlainDir({ "main.py": "print('hello')\n", "book.xlsx": "PK\x03\x04" });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree")).toContainText("main.py", { timeout: 20_000 });
});

async function openedPaths(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __E2E_OPENED_PATHS__?: string[] }).__E2E_OPENED_PATHS__ ?? [],
  );
}

test("E1：单击外开类型只选中，不外开不开 Tab", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "book.xlsx" }).first().click();
  await expect(page.locator("#tabbar .tab", { hasText: "book.xlsx" })).toHaveCount(0);
  expect(await openedPaths(page)).toHaveLength(0);
});

test("E2：双击外开类型 → 系统默认程序", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "book.xlsx" }).first().dblclick();
  const opened = await openedPaths(page);
  expect(opened.some((p) => p.replace(/\\/g, "/").endsWith("book.xlsx"))).toBe(true);
  // 不开编辑 Tab
  await expect(page.locator("#tabbar .tab", { hasText: "book.xlsx" })).toHaveCount(0);
});

test("E3：双击文本文件 → 正常编辑 Tab，不走外开", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator("#tabbar .tab", { hasText: "main.py" })).toBeVisible({ timeout: 10_000 });
  expect(await openedPaths(page)).toHaveLength(0);
});

test("E4：右键「用系统默认程序打开」", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "book.xlsx" }).first().click({ button: "right" });
  await page.locator("#ctx-menu .ctx-menu-item", { hasText: "用系统默认程序打开" }).click();
  const opened = await openedPaths(page);
  expect(opened.some((p) => p.replace(/\\/g, "/").endsWith("book.xlsx"))).toBe(true);
});
