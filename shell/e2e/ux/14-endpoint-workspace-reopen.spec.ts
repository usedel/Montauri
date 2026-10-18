/**
 * 回归：停在端点面板时「关闭工作区 → 再打开」，面板必须刷新为新工作区数据
 * （用户报告 2026-10-17；同款缺陷 git P1-3 / database B3 已在 main.ts 补偿，
 * endpoints 从未补偿——onShow 只在切 tab 时触发，重开工作区不会补刷）。
 *
 * 链路：openWorkspace 收尾 refreshActiveViewForWorkspace() → 激活视图是
 * endpoints → refreshEndpoints() 重扫。断在该链路任一环节，最后一条断言
 * （重开后 .todo-item 再现）都会挂。
 *
 * mock 说明：scan_endpoints 由 tauri-mock 的 FW_DEFAULT 预设返回 4 个端点
 * （含 GET /health，file 为相对路径）——本用例只验列表刷新，不验跳转。
 */
import { test, expect } from "@playwright/test";
import { equipPage, makeGitRepo } from "../helpers";

const MAIN_PY = [
  "from fastapi import FastAPI",
  "",
  "app = FastAPI()",
  "",
  '@app.get("/health")',
  "def health():",
  '    return {"ok": True}',
  "",
].join("\n");

test("端点面板：关闭工作区再打开 → 面板刷新（不停留在「未打开工作区」）", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await equipPage(page, repo);
  await page.goto("/");

  // 工作区就绪：状态栏分支名出现（临时仓库默认分支 main/master，不硬编码）
  await expect
    .poll(async () => (await page.locator("#status-git").textContent())?.trim() ?? "", { timeout: 15_000 })
    .not.toBe("");

  // 切到端点面板并等扫描结果渲染（FW_DEFAULT 预设含 GET /health）
  await page.locator("#tab-endpoints").click();
  await expect(page.locator("#ep-results .todo-item", { hasText: "/health" }).first()).toBeVisible({ timeout: 10_000 });

  // 关闭工作区（未开文件 → 无脏 tab，不弹确认框）
  await page.locator('.menubar-item[data-menu="file"]').click();
  await page.locator("#menu-dropdown").getByText("关闭工作区").click();
  await expect(page.locator("#tree-header-text")).toHaveText("文件");
  await expect(page.locator("#status-git")).toHaveText("");

  // 端点 tab 仍是激活态：再点一次（重复点击激活 tab 也触发 onShow）→ 无工作区空态。
  // 复刻用户真实路径：关闭后回来看面板，看到「未打开工作区」。
  await page.locator("#tab-endpoints").click();
  await expect(page.locator("#ep-results")).toContainText("未打开工作区");

  // 从「最近的工作区」重新打开同一个仓库（走 openWorkspace 真实链路）
  await page.evaluate(async (root) => {
    const b = (window as { __E2E_BRIDGE__?: (ch: string, cmd: unknown, args: unknown) => Promise<unknown> }).__E2E_BRIDGE__;
    await b?.("setRecentWorkspaces", [root], null);
  }, repo.root);
  await page.locator('.menubar-item[data-menu="file"]').click();
  await page.locator("#menu-dropdown .ctx-menu-item.with-submenu", { hasText: "最近的工作区" }).click();
  await page.locator("#menu-submenu .ctx-menu-item .sub-label", { hasText: repo.root.split(/[\\/]/).pop() ?? "" }).click();

  // 工作区重新打开完成：树根节点显示工作区文件夹名 + 分支名再现
  // （2026-10-18 起树头不再显示全路径，就绪判定改判根节点 .name，见 main.ts openWorkspace）
  await expect(page.locator("#tree .tree-root .name")).toHaveText(repo.root.split(/[\\/]/).pop() ?? "");
  await expect
    .poll(async () => (await page.locator("#status-git").textContent())?.trim() ?? "", { timeout: 20_000 })
    .not.toBe("");

  // 核心断言：停在端点 tab（onShow 不触发）→ 补偿刷新必须把列表刷出来，
  // 不停留在「未打开工作区」（修复前此处超时挂掉）
  await expect(page.locator("#ep-results .todo-item", { hasText: "/health" }).first()).toBeVisible({ timeout: 15_000 });
});
