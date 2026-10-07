/**
 * 补全「过期响应 / 截断列表」E2E（P0-A2 透传 `isIncomplete` + P0-B 过期丢弃）。
 *
 * ## 两条用例的判别力（**已做负向验证，结论写在这里，别再重踩**）
 *
 * | 用例 | 负向操作 | 结果 | 结论 |
 * |---|---|---|---|
 * | B-2 | 摘掉 `return { suggestions, incomplete }` 里的 `incomplete` | **失败**（completion 请求 1 次 < 2） | ✅ **P0-A2 的强判别** |
 * | B-1 | 摘掉 P0-B 的 `gen !== completionGen` 世代号守卫 | **仍然通过** | ⚠️ **不是 P0-B 的强判别** |
 *
 * B-1 不是强判别的原因（已核 `suggest.js:223/228`）：Monaco 在 retrigger 时会 `token.cancel()`，
 * `provideSuggestionItems` 在 `await` 之后检查 `token.isCancellationRequested` 并 **reject**，
 * 过期结果被 Monaco 自己丢掉了。P0-B 的世代号因此是**防御性冗余**：价值在于「token 已取消时
 * 不再白跑一趟引擎请求」与「将来 Monaco 行为变化时仍有兜底」，不在面板可观测行为上。
 *
 * 另注：本套件必须开 `completionIsIncomplete: true`——Monaco 只在存在 incomplete provider 时
 * 才会在**同词内继续输入**时重新请求 provider（`suggestModel.js:588`），否则仅本地过滤。
 * 这也是 P0-A1/A2 要修的东西：引擎截断（intel `MAX_CANDIDATES = 50`）却不声明，客户端就会
 * 拿被截断的列表本地过滤，第 51 名以后的候选永远补不出来。
 *
 * ## 前缀选型踩坑
 * 续打的前缀必须是**真实前缀**：`pl` 对 `split` 在 `completionModel.js:158` 的 `fuzzyScore`
 * 下只算弱匹配（得分 −8）会被判掉、面板直接收起；`sp` 才是强匹配（得分 10）。别拿 `pl` 试。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo } from "../helpers";

const LIB_PY = [
  "def add_score(a, b):",
  '    """Return the sum of two integers."""',
  "    return a + b",
  "",
].join("\n");

const MAIN_PY = [
  "from lib import add_score",
  "",
  's = "hello"',
  "",
  "total = add_score(2, 3)",
  "",
].join("\n");

/**
 * 过期候选：模拟「引擎在旧前缀/被截断状态下返回的列表」，且刻意带 `sp` 前缀
 * ——使其能穿过 Monaco 对当前词的本地过滤（否则过期与否在面板上都看不出差别）。
 */
const STALE_ITEMS = ["sp_stale_alpha", "sp_stale_beta"];

interface LspPreset {
  completionIsIncomplete?: boolean;
  staleDelayMs?: number;
  staleItems?: string[];
}

/** 双击文件树打开文件，并确认状态栏切到该文件后再继续 */
async function openFile(page: Page, name: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: name }).first().dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#status-file")).toContainText(name, { timeout: 10_000 });
}

async function boot(page: Page, preset: LspPreset): Promise<void> {
  const repo = await makeGitRepo({
    files: { "lib.py": LIB_PY, "main.py": MAIN_PY },
    commitMsg: "baseline",
  });
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_LSP_PRESET__?: LspPreset }).__E2E_LSP_PRESET__ = p;
  }, preset);
  await equipPage(page, repo);
  await page.goto("/");
  // 工作区自动恢复 + 首次 git 状态刷新完成
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  // 先打开 lib.py（让 mock 按 didOpen 索引进其符号），再打开 main.py（最终激活 main.py）
  await openFile(page, "lib.py");
  await openFile(page, "main.py");
}

/** 打 `r = s.` 后立即续打 `sp`（远早于慢响应落地） */
async function typeTriggerThenRefine(page: Page): Promise<void> {
  await page.locator("#editor .monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("r = s.");
  await page.keyboard.type("sp", { delay: 20 });
}

test("B-2 同词内继续输入触发重新请求（P0-A2 强判别）", async ({ page }) => {
  await boot(page, { completionIsIncomplete: true });
  await typeTriggerThenRefine(page);

  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  await expect(suggest).toContainText("split", { timeout: 10_000 });

  // 强判别：继续输入后 completion 请求 ≥2 次。
  // 摘掉 `incomplete` 透传后实测只有 1 次（Monaco 只做本地过滤），用例即失败。
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log =
            (window as unknown as { __OPENCHARM_LSP_LOG__?: Array<{ m: string }> })
              .__OPENCHARM_LSP_LOG__ ?? [];
          return log.filter((e) => e.m === "textDocument/completion").length;
        }),
      { timeout: 5_000 },
    )
    .toBeGreaterThanOrEqual(2);

  // 面板收窄到末次前缀：`upper` / `lower` 等不匹配 `sp` 的项不应在列
  const text = (await suggest.textContent()) ?? "";
  expect(text).not.toContain("upper");
});

test("B-1 慢引擎的过期结果不得污染面板（端到端契约守护，非 P0-B 强判别）", async ({ page }) => {
  await boot(page, {
    completionIsIncomplete: true,
    staleDelayMs: 1_200,
    staleItems: STALE_ITEMS,
  });
  await typeTriggerThenRefine(page);

  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  await expect(suggest).toContainText("split", { timeout: 10_000 });

  // 等过 1.2s 慢响应窗口，断言过期候选始终没进面板
  await page.waitForTimeout(1_800);
  const text = await suggest.textContent();
  expect(text ?? "").not.toContain("sp_stale_alpha");
  expect(text ?? "").not.toContain("sp_stale_beta");
});
