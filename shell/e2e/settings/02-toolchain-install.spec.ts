/**
 * E2E：工具链缺失的一键安装入口（忽略首启引导后的补装路径）
 *
 * 背景：首启引导弹一次、点「稍后」就没了，用户后面再遇到「保存时整理导入没反应」
 * 没有任何入口可点（2026-10-10 用户报障的根因之一）。本套锁三件事：
 *  - TC-1 缺 ruff 时首启引导确实弹出（mock 形状此前是错的，这条路径从未被走到）
 *  - TC-2 点「稍后」→ 写入 `toolchain_prompt_dismissed`（下次启动不再重复打扰）
 *  - TC-3 已忽略过则不再弹（防打扰）
 *  - TC-4 设置 →「保存」：ruff 内联提示 + 点「安装」→ 按件安装 only=["ruff"]
 *  - TC-5 设置 →「Python」：工具链状态块四行（git 不给安装按钮）
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

let repo: GitRepo;
const pageErrors: string[] = [];

/** 预置工具链缺失项（mock 的 detect_toolchain 读它） */
async function presetMissing(page: Page, missing: string[]): Promise<void> {
  await page.addInitScript((m) => {
    (window as unknown as { __E2E_TOOLCHAIN_MISSING__?: string[] }).__E2E_TOOLCHAIN_MISSING__ = m;
  }, missing);
}

/** 预置设置覆写（addInitScript，先于应用启动生效） */
async function presetSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: unknown }).__E2E_SETTINGS_PRESET__ = s;
  }, settings);
}

/** mock 侧最近一次保存的 settings */
function savedSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    (window as unknown as { __E2E_SETTINGS_SAVED__?: Record<string, unknown> }).__E2E_SETTINGS_SAVED__ ?? {},
  );
}

/** mock 记录的 install_toolchain 入参（"all" 或 "ruff" 之类） */
function installs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __E2E_TOOLCHAIN_INSTALLS__?: string[] }).__E2E_TOOLCHAIN_INSTALLS__ ?? [],
  );
}

async function openSettings(page: Page, cat: "save" | "python"): Promise<void> {
  await page.keyboard.press("Control+Alt+S");
  await expect(page.locator("#settings-modal, .modal:has(#settings-save)").first()).toBeVisible({ timeout: 5_000 });
  await page.locator(`.settings-nav-item[data-cat="${cat}"]`).click();
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  repo = await makePlainDir({ "main.py": "alpha = 1\nprint(alpha)\n" });
  await equipPage(page, repo);
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("TC-1 缺 ruff 时首启引导弹出，并列出 ruff", async ({ page }) => {
  await presetMissing(page, ["ruff"]);
  await page.goto("/");

  // 引导是模态且**先于打开工作区**（main init 里 await maybePromptToolchain），
  // 所以先断弹窗、后断文件树——反过来等会一直等不到树。
  const modal = page.locator(".modal:has(#confirm-ok)").first();
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await expect(modal).toContainText("环境引导");
  await expect(modal).toContainText("ruff");

  // 收尾：关掉弹窗，工作区随后正常打开
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });
});

test("TC-2 点「稍后」→ 记录忽略项，下次启动不再重复打扰", async ({ page }) => {
  await presetMissing(page, ["ruff"]);
  await page.goto("/");

  const modal = page.locator(".modal:has(#confirm-ok)").first();
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await page.locator("#confirm-cancel").click();

  await expect
    .poll(async () => (await savedSettings(page)).toolchain_prompt_dismissed, { timeout: 5_000 })
    .toEqual(["ruff"]);
});

test("TC-3 已忽略过的项不再弹引导（防打扰）", async ({ page }) => {
  await presetMissing(page, ["ruff"]);
  await presetSettings(page, { toolchain_prompt_dismissed: ["ruff"] });
  await page.goto("/");
  // 没有弹窗挡路 → 工作区直接打开（这本身就是「没弹引导」的证据）
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  // 确认对话框此刻是隐藏态（DOM 里常驻，不能按数量断言）
  await expect(page.locator(".modal:has(#confirm-ok)").first()).toBeHidden();
});

test("TC-4 设置 →「保存」：ruff 内联提示可见，点「安装」走按件安装", async ({ page }) => {
  // 已忽略过首启引导 → 不弹窗（正是「忽略后如何补装」的真实场景）
  await presetMissing(page, ["ruff"]);
  await presetSettings(page, { toolchain_prompt_dismissed: ["ruff"] });
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openSettings(page, "save");
  const hint = page.locator("#settings-ruff-hint");
  await expect(hint).toBeVisible({ timeout: 5_000 });
  await expect(hint).toContainText("ruff");

  await hint.locator("button", { hasText: "安装" }).click();

  // 按件安装：only=["ruff"]，不是全量
  await expect.poll(async () => installs(page), { timeout: 10_000 }).toEqual(["ruff"]);
  // 装完状态刷新（mock 清掉了 missing）→ 提示消失
  await expect(hint).toBeHidden({ timeout: 10_000 });
});

test("TC-5 设置 →「Python」：工具链状态块四行，git 不给安装按钮", async ({ page }) => {
  await presetMissing(page, ["ruff", "git"]);
  await presetSettings(page, { toolchain_prompt_dismissed: ["ruff"] }); // 先挡掉引导弹窗，避免遮罩挡住面板
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openSettings(page, "python");
  const group = page.locator("#settings-toolchain-group");
  await expect(group).toBeVisible({ timeout: 5_000 });
  await expect(group).toContainText("工具链状态");
  // 四行：uv / 引擎 / ruff / git
  await expect(group.locator(".settings-row")).toHaveCount(4);
  // ruff 缺 → 有「安装」；git 缺 → 只提示需自行安装，没有按钮
  const rows = group.locator(".settings-row");
  await expect(rows.nth(2)).toContainText("未安装");
  await expect(rows.nth(2).locator("button")).toHaveCount(1);
  await expect(rows.nth(3)).toContainText("需自行安装");
  await expect(rows.nth(3).locator("button")).toHaveCount(0);
});
