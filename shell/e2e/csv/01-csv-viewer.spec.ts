/**
 * E2E：CSV 数据查看器（VS Code 插件调研报告 借鉴-4 · 对标 Rainbow CSV / SQLite Viewer）
 *
 * 交互契约（改动前先读 src/csvTab.ts 文件头）：
 *   · .csv 默认开**只读**查看 Tab（kind="csv"，path 前缀 `csvtab:`），不是可编辑文本 Tab；
 *   · 表格复用 sqliteGrid（.db-grid），本批只做「文件 → 结果形状」的适配；
 *   · 行数上限 10 000（与 Rust HARD_MAX_ROWS 同口径），超出截断并在状态条提示；
 *   · 编码只承诺 UTF-8 / BOM，其余**显式提示不猜测**。
 *
 *  - E-CSV-1 打开 .csv → 渲染表格（列名 / 单元格 / 状态条行数）
 *  - E-CSV-2 引号字段内的逗号不被切断（RFC 4180 往返：导出 → 解析回原值）
 *  - E-CSV-3 空文件 → 空态提示
 *  - E-CSV-4 非 UTF-8 → 显式提示（不猜测编码）
 *  - E-CSV-5 「以文本编辑」→ 关查看 Tab 开编辑 Tab（查看器不是死胡同）
 *  - E-CSV-6 关闭查看 Tab 免确认（恒不 dirty）
 */
import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const CSV = ["name,qty,note", 'widget,2,"a,b"', 'gadget,3,"say ""hi"""', ""].join("\r\n");

let repo: GitRepo;

async function openInTree(page: Page, name: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: name }).first().click();
}

async function gridCells(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#csv-tab-body .db-grid td, #csv-tab-body .db-grid th")).map(
      (el) => (el.textContent ?? "").trim(),
    ),
  );
}

test.beforeEach(async () => {
  repo = await makeGitRepo({ files: { "data.csv": CSV }, commitMsg: "baseline" });
});

test("E-CSV-1 打开 .csv → 只读查看 Tab 渲染表格", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "data.csv");

  const panel = page.locator("#csv-tab-panel");
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator(".db-grid")).toBeVisible({ timeout: 10_000 });

  const cells = await gridCells(page);
  expect(cells).toContain("name");
  expect(cells).toContain("qty");
  expect(cells).toContain("widget");
  // 状态条：行数口径（database.statusRows 走 sqliteGrid::statusText）
  await expect(page.locator("#csv-tab-status")).toContainText("2", { timeout: 5_000 });
  // Tab 标题带「数据」后缀（与同名编辑 Tab 区分）
  await expect(page.locator("#tabbar .tab.active .name")).toContainText("数据", { timeout: 5_000 });
});

test("E-CSV-2 引号字段内的逗号与双写引号往返正确", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "data.csv");
  await expect(page.locator("#csv-tab-panel .db-grid")).toBeVisible({ timeout: 10_000 });

  const cells = await gridCells(page);
  expect(cells).toContain("a,b"); // 引号内的逗号不是分隔符
  expect(cells).toContain('say "hi"'); // 双写引号还原
});

test("E-CSV-3 空文件 → 空态提示（不造空表格）", async ({ page }) => {
  repo.write("empty.csv", "");
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "empty.csv");
  await expect(page.locator("#csv-tab-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#csv-tab-body .csv-empty")).toContainText("空文件", { timeout: 5_000 });
});

test("E-CSV-4 非 UTF-8 → 显式提示，不猜测编码", async ({ page }) => {
  writeFileSync(join(repo.root, "gbk.csv"), Buffer.from([0xd0, 0xd5, 0xc3, 0xfb, 0x2c, 0x31]));
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "gbk.csv");
  await expect(page.locator("#csv-tab-panel")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#csv-tab-body .csv-empty")).toContainText("UTF-8", { timeout: 5_000 });
});

test("E-CSV-5 「以文本编辑」→ 关查看 Tab 开编辑 Tab", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "data.csv");
  await expect(page.locator("#csv-tab-panel .db-grid")).toBeVisible({ timeout: 10_000 });

  await page.locator("#csv-tab-panel .csv-tab-toolbar button").first().click();
  // 编辑 Tab：主编辑器回来，内容就是 CSV 原文
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#csv-tab-panel")).toBeHidden({ timeout: 5_000 });
  const value = await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    return app.editor.getModel().getValue() as string;
  });
  expect(value).toContain("name,qty,note");
});

test("E-CSV-6 关闭查看 Tab 免确认（恒不 dirty）", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "data.csv");
  await expect(page.locator("#csv-tab-panel .db-grid")).toBeVisible({ timeout: 10_000 });
  await page.locator("#tabbar .tab.active .close").click({ force: true });
  await expect(page.locator("#csv-tab-panel")).toBeHidden({ timeout: 5_000 });
  await expect(page.locator("#tabbar .tab")).toHaveCount(0, { timeout: 5_000 });
});
