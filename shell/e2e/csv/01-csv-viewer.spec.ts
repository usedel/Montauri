/**
 * E2E：CSV 数据查看器（VS Code 插件调研报告 借鉴-4 · 对标 Rainbow CSV / SQLite Viewer）
 *
 * 交互契约（改动前先读 src/csvTab.ts 文件头）：
 *   · .csv 默认开**只读**查看 Tab（kind="csv"，path 前缀 `csvtab:`），不是可编辑文本 Tab；
 *   · 表格复用 sqliteGrid（.db-grid），本批只做「文件 → 结果形状」的适配；
 *   · 行数上限 10 000（与 Rust HARD_MAX_ROWS 同口径），超出截断并在状态条提示；
 *   · 编码只承诺 UTF-8 / BOM，其余**显式提示不猜测**；
 *   · 大文件前缀读取（CSV_READ_CAP）+ 每页 200 行分页渲染（翻页是内存切片，不重读文件）。
 *
 *  - E-CSV-1 打开 .csv → 渲染表格（列名 / 单元格 / 状态条行数）
 *  - E-CSV-2 引号字段内的逗号不被切断（RFC 4180 往返：导出 → 解析回原值）
 *  - E-CSV-3 空文件 → 空态提示
 *  - E-CSV-4 非 UTF-8 → 显式提示（不猜测编码）
 *  - E-CSV-5 「以文本编辑」→ 关查看 Tab 开编辑 Tab（查看器不是死胡同）
 *  - E-CSV-6 关闭查看 Tab 免确认（恒不 dirty）
 *  - E-CSV-7 分页：501 行 → 第 1 页 200 行，翻页看第 201 行，末页禁用下一页
 *  - E-CSV-8 大文件「以文本编辑」失败态：>10MB（read_file 守卫）→ toast 说明原因 +
 *    **查看器原样保留**（先开成功再关查看 Tab——顺序反了会出现空白编辑区 + 悬空 activeTab）
 *  - E-CSV-9 「外部打开」：经 opener 插件（mock 记录路径），不真开系统程序
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

test("E-CSV-7 分页：501 行 → 每页 200，翻页看第 201 行，末页禁用下一页", async ({ page }) => {
  const lines = ["id,name"];
  for (let i = 1; i <= 501; i++) lines.push(`${i},r${i}`);
  repo.write("big.csv", lines.join("\r\n"));
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "big.csv");

  const panel = page.locator("#csv-tab-panel");
  await expect(panel.locator(".db-grid")).toBeVisible({ timeout: 10_000 });
  // 状态条按全表口径：已显示 501/501（分页条管翻页，状态条管总量与截断）
  await expect(page.locator("#csv-tab-status")).toContainText("501", { timeout: 5_000 });
  // 首页：第 200 行可见，第 201 行不可见；下一页可用
  const cellsP1 = await gridCells(page);
  expect(cellsP1).toContain("r200");
  expect(cellsP1).not.toContain("r201");
  await expect(page.locator("#csv-pager-next")).toBeEnabled();
  await expect(page.locator("#csv-pager-prev")).toBeDisabled();

  // 翻到第 2 页：从第 201 行开始（内存切片，不重读文件）
  await page.locator("#csv-pager-next").click();
  const cellsP2 = await gridCells(page);
  expect(cellsP2).toContain("201");
  expect(cellsP2).toContain("r201");
  expect(cellsP2).not.toContain("r200");
  await expect(page.locator("#csv-pager-prev")).toBeEnabled();

  // 末页（第 3 页）：只剩 101 行，下一页禁用
  await page.locator("#csv-pager-next").click();
  const cellsP3 = await gridCells(page);
  expect(cellsP3).toContain("r501");
  await expect(page.locator("#csv-pager-next")).toBeDisabled();
  await expect(page.locator("#csv-tab-panel .db-page-label")).toContainText("3/3");
});

test("E-CSV-8 超限大文件「以文本编辑」失败 → toast 说明原因，查看器保留", async ({ page }) => {
  // >10MB（read_file 守卫口径）：903B × 12288 ≈ 11.1MB（须实打实越过 10×1024² 守卫线）
  const chunk = `${"row,data,".repeat(100)}x\r\n`; // 903B/行
  repo.write("huge.csv", chunk.repeat(12 * 1024));
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "huge.csv");
  await expect(page.locator("#csv-tab-panel .db-grid")).toBeVisible({ timeout: 15_000 });

  // 点「以文本编辑」：read_file 报「文件过大」→ toast；查看 Tab 不被拆掉
  await page.locator("#csv-tab-panel .csv-tab-toolbar button").first().click();
  await expect(page.locator(".toast--error", { hasText: "打开文件失败" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#csv-tab-panel")).toBeVisible();
  await expect(page.locator("#csv-tab-panel .db-grid")).toBeVisible();
  await expect(page.locator("#tabbar .tab")).toHaveCount(1); // 仍只有查看 Tab
  // 标签可正常关闭（回归钉子：此前失败路径下 activeTab 悬空导致关不掉）
  await page.locator("#tabbar .tab.active .close").click({ force: true });
  await expect(page.locator("#csv-tab-panel")).toBeHidden({ timeout: 5_000 });
});

test("E-CSV-9 「外部打开」→ opener 插件收到文件路径（mock 记录，不真开）", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openInTree(page, "data.csv");
  await expect(page.locator("#csv-tab-panel .db-grid")).toBeVisible({ timeout: 10_000 });

  // 工具栏第二个按钮 = 外部打开
  await page.locator("#csv-tab-panel .csv-tab-toolbar button").nth(1).click();
  const opened = await page.evaluate(() => (window as unknown as { __E2E_OPENED_PATHS__?: string[] }).__E2E_OPENED_PATHS__);
  expect(opened?.length).toBe(1);
  expect(opened?.[0]?.replace(/\\/g, "/")).toContain("data.csv");
});
