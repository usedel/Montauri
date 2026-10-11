/**
 * E2E：依赖健康入口与状态表达（2026-10-11 体验审查批 2，docs/project_dep_health_ux_review.md §5）
 *
 *  - DH-1（D-1）状态栏体检图标**常驻**：体检结束（含失败降级）后图标仍可见，非警示态为中性
 *    （不带 issues 类）且带 tooltip —— 修的是「一切正常时反而没有任何入口」
 *  - DH-2（D-4）命令面板注册 dep_health_panel：搜「依赖」命中「依赖健康：打开面板」，
 *    点击后环境面板打开且依赖明细同时展开（与状态栏图标共用 openDepHealthPanel 入口）
 *
 * mock 面：`dep_scan` 未在 tauri-mock 里实现 → 走「体检失败」降级路径（onScanComplete(null)），
 * 这正好是 D-1 要保证的场景：没有可展示的问题时，入口也必须还在。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

async function boot(page: Page, repo: GitRepo): Promise<void> {
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

test("DH-1（D-1）状态栏体检图标常驻：非警示态也可见且为中性色", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "a.py": "import os\n" }, commitMsg: "baseline" });
  await boot(page, repo);

  const icon = page.locator("#dep-health-status");
  await expect(icon).toBeVisible({ timeout: 20_000 });
  await expect(icon).not.toHaveClass(/issues/); // 中性态：颜色走 --fg-dim，不切 --warn
  await expect(icon.locator(".codicon")).toBeVisible();
  const tip = await icon.getAttribute("data-tip");
  expect((tip ?? "").length).toBeGreaterThan(0);
});

test("DH-2（D-4）命令面板搜「依赖」命中 dep_health_panel 并可打开面板 + 展开明细", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "a.py": "import os\n" }, commitMsg: "baseline" });
  await boot(page, repo);

  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#quick-open-input")).toBeVisible({ timeout: 5_000 });
  await page.locator("#quick-open-input").fill("依赖");
  const item = page.locator(".quick-open-item", { hasText: "依赖健康：打开面板" }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.click();

  await expect(page.locator("#env-modal")).toBeVisible({ timeout: 10_000 });
  // 入口语义是「看问题」→ 明细一并展开（不再是「打开面板后还要再点一次」）
  await expect(page.locator("#dep-health-detail")).toBeVisible();
});
