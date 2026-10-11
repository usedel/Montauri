/**
 * E2E：长耗时操作的状态表达（2026-10-11 体验审查批 3，docs/project_dep_health_ux_review.md §5）
 *
 *  - LO-1（L-5）装依赖期间：状态栏出现「进行中」芯片——全局可见态，且**不随模态关闭消失**
 *    （新建项目流程里面板在 ③ 之前就关了，此时芯片是唯一的全局可见态）
 *  - LO-2（L-3）点芯片「取消」→ 调 uv_cancel_op 置位后端标志，按钮切「取消中…」并禁用（防连点）
 *
 * 让 pip_install 变慢的手法：e2e mock 的 `pip_install` 是静态瞬时返回（`function(){return 0}`），
 * 芯片会一闪而过。测试在**页面侧包装** `__TAURI_INTERNALS__.invoke` 给它加 3s 延迟——
 * 只改本用例的运行行为，不动 e2e mock（给 mock 加通用延迟钩子属另一个改动面）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

async function bootEmpty(page: Page, repo: GitRepo): Promise<void> {
  await equipPage(page, repo, { startEmpty: true });
  await page.goto("/");
  await expect(page.locator("#ew-new-project")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log = (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
          return log.some((x) => x.startsWith("list_plugin_dirs")) ? 1 : 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(1);
}

/** 给某条命令注入延迟（页面侧包装 invoke；不影响 mock 自身的调用流水记录） */
async function slowCommand(page: Page, cmd: string, ms: number): Promise<void> {
  await page.evaluate(
    ([c, d]) => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (name: string, args?: unknown) => Promise<unknown> };
      }).__TAURI_INTERNALS__;
      const orig = internals.invoke.bind(internals);
      internals.invoke = (name: string, args?: unknown) =>
        name === c
          ? new Promise((res) => window.setTimeout(() => void orig(name, args).then(res), d))
          : orig(name, args);
    },
    [cmd, ms] as const,
  );
}

test("LO-1/2（L-5 / L-3）装依赖期间：状态栏「进行中」芯片可见 + 取消入口可用", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo);
  await slowCommand(page, "pip_install", 3000);

  await page.locator("#ew-new-project").click();
  await expect(page.locator("#new-project-modal")).toBeVisible();
  await page.locator("#new-project-name").fill("demo-longop");
  await page.locator("#new-project-location").fill(repo.root);
  await page.locator("#new-project-type").selectOption("fastapi");
  await page.locator("#new-project-create").click();

  // L-5：芯片出现（此时新建项目面板已关，模态里没有任何进度指示）
  const chip = page.locator("#status-op");
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#status-op-label")).toContainText("正在安装依赖");
  await expect(page.locator("#new-project-modal")).toBeHidden();

  // L-3：取消入口 → uv_cancel_op + 按钮切「取消中…」
  await page.locator("#status-op-cancel").click();
  await expect(page.locator("#status-op-cancel")).toHaveText("取消中…");
  const cancelSent = await page.evaluate(() =>
    ((window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? []).some((x) =>
      x.startsWith("uv_cancel_op"),
    ),
  );
  expect(cancelSent).toBe(true);

  // 操作收尾（mock 的 pip_install 延迟结束）后芯片消失
  await expect(chip).toBeHidden({ timeout: 20_000 });
});
