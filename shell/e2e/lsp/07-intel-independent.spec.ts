/**
 * P0-C 观察点2　intel 补全独立于静态引擎故障 E2E。
 *
 * 守护的契约：`provideCompletionItems` 不再用 `engineStatus`（**静态引擎**状态）当补全总闸——
 * static 未就绪只关 static 路，intel 路照常查自己的 session（对齐架构铁律「intel 独立、失败静默降级」）。
 *
 * ## 构造方式
 *  - `__E2E_SETTINGS_PRESET__.runtime_intel_enabled = true`：让 `main.ts:startLsp` 执行 `startIntel`；
 *  - `__E2E_LSP_PRESET__.staticInitFail = true`：mock 对 static 的 initialize 返回 LSP error
 *    （前端 requestEngine reject → startEngine 抛异常 → **不阻断** intel 启动）；
 *  - `get_intel_info` mock 返回伪 command（浏览器侧无真实 opencharm-intel 二进制），让 intel 走到 ready。
 *
 * ## 强判别
 *  static 引擎起不来 → engineStatus 停在 `starting`（非 `ready`）。若总闸未拆，`provideCompletionItems`
 *  会在 `engineStatus !== "ready"` 处整体返回空 → 面板永远不出现 `upper`。故「面板出现 str 成员」即
 *  证明 intel 路绕过了 static 总闸、独立出了候选。
 *
 * 注：mock 下的 intel 候选实际是 `lspComplete`（静态成员语义）——浏览器侧无 intel 二进制，候选内容
 * 语义打折，但**行为契约（static 挂不拖死 intel 路的查询与上屏）** 由本 spec 钉死；真实 intel 候选
 * 由 opencharm-intel 构建 + 真机链路覆盖。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const MAIN_PY = ['s = "hello"', ""].join("\n");

async function bootWithStaticFailure(page: Page): Promise<GitRepo> {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
      runtime_intel_enabled: true,
    };
    (window as unknown as { __E2E_LSP_PRESET__?: Record<string, unknown> }).__E2E_LSP_PRESET__ = {
      staticInitFail: true,
    };
  });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator("#status-file")).toContainText("main.py", { timeout: 10_000 });
  return repo;
}

test("P0-C 观察点2：static 引擎启动失败时，intel 补全仍独立弹出", async ({ page }) => {
  await bootWithStaticFailure(page);

  // intel-mock 启动链全 mock（微秒级），openWorkspace 收尾即 ready；留一点余量再触发
  await page.waitForTimeout(800);
  await page.locator("#editor .monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("s.");

  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  // str 成员候选来自 intel 路（static 已起不来）。注意：intel 路候选的 sortText 在 mock 下同为
  // 兜底值 "1998"，Monaco 会按 label **字母序**重排，`upper` 排在末尾被 suggest 列表虚拟化裁出可视区；
  // 故断言字母序靠前、必在可视区的 capitalize / split（static 路时 upper 靠前是另一种顺序）。
  await expect(suggest).toContainText("capitalize", { timeout: 10_000 });
  await expect(suggest).toContainText("split", { timeout: 10_000 });
});

test("对照：无 staticInitFail（static 正常）时补全照常，拆总闸不破坏既有路径", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {};
    (window as unknown as { __E2E_LSP_PRESET__?: Record<string, unknown> }).__E2E_LSP_PRESET__ = {};
  });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator("#status-file")).toContainText("main.py", { timeout: 10_000 });

  await page.locator("#editor .monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("s.");

  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  await expect(suggest).toContainText("upper", { timeout: 10_000 });
});