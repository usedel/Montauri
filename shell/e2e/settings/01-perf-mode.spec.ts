/**
 * E2E：A2 性能模式设置项（PR-A2-P5 · runtime_profiler_dev_plan §5）
 *
 *  - HS-11 默认关 + §5 口径红线：Python/运行时分类下「性能模式（默认关）」行未勾选，
 *    描述文案含「探针开销 / 相对值」口径红线（耗时为含探针开销的相对值，仅用于热点排序，
 *    不等于真实耗时）
 *  - HS-12 开关保存：勾选 → 保存 → mock 侧 __E2E_SETTINGS_SAVED__ 记录 probe_perf_enabled: true；
 *    重开面板 fillForm 回填已勾选
 *  - HS-13 关闭探针提示：性能模式行描述提示「需要运行时采集（探针）开启」——探针关闭时本项无效果
 *  - HS-14 搜索可达：设置面板搜索「性能」能命中性能模式行（settings.kw.probePerf 关键词）
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

let repo: GitRepo;
const pageErrors: string[] = [];

/** 打开设置面板并切到 Python/运行时分类 */
async function openPerfRow(page: Page) {
  await page.keyboard.press("Control+Alt+S");
  await expect(page.locator("#settings-modal, .modal:has(#settings-save)").first()).toBeVisible({ timeout: 5_000 });
  await page.locator('.settings-nav-item[data-cat="python"]').click();
  await expect(page.locator("#settings-probe-perf")).toBeVisible({ timeout: 5_000 });
}

/** mock 侧最近一次保存的 settings（save_settings 已改为记录 __E2E_SETTINGS_SAVED__） */
function savedSettings(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() =>
    (window as unknown as { __E2E_SETTINGS_SAVED__?: Record<string, unknown> }).__E2E_SETTINGS_SAVED__ ?? {},
  );
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  repo = await makePlainDir({ "main.py": "alpha = 1\nprint(alpha)\n" });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("HS-11 性能模式默认关，描述含探针开销口径红线", async ({ page }) => {
  await openPerfRow(page);

  const toggle = page.locator("#settings-probe-perf");
  await expect(toggle).not.toBeChecked();
  // §5 口径红线：耗时含探针开销的相对值，仅用于排序，不等于真实耗时
  const desc = page.locator("#settings-probe-perf").locator("xpath=ancestor::div[contains(@class,'settings-field')]//*[contains(@class,'settings-row-desc')]");
  await expect(desc).toContainText("探针开销");
  await expect(desc).toContainText("相对值");
});

test("HS-12 勾选并保存 → 提交 probe_perf_enabled: true，重开面板回填勾选", async ({ page }) => {
  await openPerfRow(page);

  const toggle = page.locator("#settings-probe-perf");
  await toggle.check();
  await page.locator("#settings-save").click();
  // 保存关闭面板，随后 mock 记录的 settings 断言
  await expect(page.locator("#settings-modal, .modal:has(#settings-save)").first()).toBeHidden({ timeout: 5_000 });
  expect((await savedSettings(page)).probe_perf_enabled).toBe(true);

  // 重开面板：fillForm 回填勾选态
  await openPerfRow(page);
  await expect(page.locator("#settings-probe-perf")).toBeChecked();
});

test("HS-13 描述提示需探针开启（探针关闭时无效果）", async ({ page }) => {
  await openPerfRow(page);

  const desc = page.locator("#settings-probe-perf").locator("xpath=ancestor::div[contains(@class,'settings-field')]//*[contains(@class,'settings-row-desc')]");
  await expect(desc).toContainText("运行时采集");
});

test("HS-14 搜索「性能」命中性能模式行", async ({ page }) => {
  await openPerfRow(page);

  // 设置面板搜索框（UI-31 关键词表含 settings.kw.probePerf）
  const search = page.locator("#settings-search");
  await expect(search).toBeVisible({ timeout: 5_000 });
  await search.fill("性能");
  // 命中行 = label 文本为「性能模式（默认关）」的整行可见
  await expect(page.locator("label[for='settings-probe-perf']")).toBeVisible({ timeout: 5_000 });
});
