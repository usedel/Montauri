/**
 * E2E：依赖健康入口与状态表达（2026-10-11 体验审查批 2，docs/project_dep_health_ux_review.md §5）
 *
 *  - DH-1（D-1）状态栏体检图标**常驻**：体检结束（含失败降级）后图标仍可见，非警示态为中性
 *    （不带 issues 类）且带 tooltip —— 修的是「一切正常时反而没有任何入口」
 *  - DH-2（D-4）命令面板注册 dep_health_panel：搜「依赖」命中「依赖健康：打开面板」，
 *    点击后环境面板打开且依赖明细同时展开（与状态栏图标共用 openDepHealthPanel 入口）
 *
 *  - DH-3（D-3）假绿：未选解释器（环境侧整体置空 → 0 问题）时状态栏走 noenv 独立形态，
 *    不并入「依赖一致」的 ok 态
 *  - DH-4（D-2）断边统一顶部摘要行：面板顶部一行列出各断边计数（E1/E4/E5 不逐条加横幅档位）
 *  - DH-5（D-8）明细筛选：输入筛选词只留命中行 + 显示计数；≥2 组可修时出现「修复全部可修项」
 *
 * mock 面：`dep_scan` 默认**未实现** → 走「体检失败」降级（onScanComplete(null)），正好是
 * D-1 要保证的场景：没有可展示的问题时入口也必须在。DH-3~DH-5 经 `window.__E2E_DEP_DIFF__`
 * 预置一份 diff（tauri-mock 的既有预置范式），未预置的用例不受影响。
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

/** 带声明文件的仓库：bare 工作区（无 pyproject / requirements）不会触发 dep_scan，
 *  预置 diff 也就无从生效（这也是真实行为——没声明就没得体检）。 */
async function makeDeclaredRepo(): Promise<GitRepo> {
  return makeGitRepo({
    files: {
      "a.py": "import os\n",
      "pyproject.toml": '[project]\nname = "demo"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n',
    },
    commitMsg: "baseline",
  });
}

/** 预置一份 DepDiff（dep_scan 的返回），并打开环境面板 + 展开依赖明细 */
async function bootWithDiff(page: Page, repo: GitRepo, diff: unknown): Promise<void> {
  await page.addInitScript((d) => {
    (window as unknown as { __E2E_DEP_DIFF__?: unknown }).__E2E_DEP_DIFF__ = d;
  }, diff);
  await boot(page, repo);
  // 体检编排「弹窗优先」（R13）：前台有模态时 dep_scan 会 500ms 轮询排队——工具链引导类的
  // 启动模态会让体检永远排不上队，故先关掉（只点 primary 确认类按钮）。
  for (let i = 0; i < 6; i++) {
    const btns = page.locator(".modal-card:visible .modal-actions .btn--primary");
    if ((await btns.count()) === 0) break;
    for (let j = 0; j < (await btns.count()); j++) {
      await btns.nth(j).click({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2_500); // 体检延迟启动（OPEN_CHECK_DELAY_MS=1500）+ 扫描
  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#quick-open-input")).toBeVisible({ timeout: 5_000 });
  await page.locator("#quick-open-input").fill("依赖");
  await page.locator(".quick-open-item", { hasText: "依赖健康：打开面板" }).first().click();
  await expect(page.locator("#dep-health-detail")).toBeVisible({ timeout: 10_000 });
}

/** 一份 DepDiff（interpreter=null 时环境侧整体置空，见 DepDiff 契约注释） */
function makeDiff(interpreter: string | null, withIssues: boolean): Record<string, unknown> {
  return {
    style: "pyproject",
    externalManager: null,
    missingInEnv: withIssues
      ? [
        { module: "yaml", dist: "PyYAML", distCandidates: ["PyYAML"], file: "a.py", line: 3, lazy: false },
        { module: "numpy", dist: "numpy", distCandidates: ["numpy"], file: "a.py", line: 4, lazy: false },
      ]
      : [],
    declaredMissing: [],
    declaredMissingModules: [],
    envDrift: withIssues ? [{ dist: "requests", version: "2.0" }] : [],
    undeclared: [],
    lockOutOfDate: false,
    requirementsUninstalled: false,
    interpreter,
    requirementsFile: null,
    scannedAt: Date.now(),
  };
}

test("DH-3（D-3）未选解释器 + 0 问题 → noenv 独立形态，不宣称「依赖一致」", async ({ page }) => {
  const repo = await makeDeclaredRepo();
  // 未选解释器 → 后端环境侧置空 → 断边计数天然为 0（这正是「假绿」的成因）
  await bootWithDiff(page, repo, makeDiff(null, false));

  const icon = page.locator("#dep-health-status");
  await expect(icon).toBeVisible({ timeout: 20_000 });
  await expect(icon).toHaveClass(/noenv/);
  await expect(icon).not.toHaveClass(/issues/);
  await expect(icon).toHaveAttribute("data-tip", /环境侧检测不可用/);
});

test("DH-4（D-2）断边统一顶部摘要行：一行列出各断边计数", async ({ page }) => {
  const repo = await makeDeclaredRepo();
  await bootWithDiff(page, repo, makeDiff("/.venv/Scripts/python.exe", true));

  const summary = page.locator("#dep-summary");
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#dep-summary-text")).toContainText("缺失模块 × 2");
  await expect(page.locator("#dep-summary-text")).toContainText("装了未声明 × 1");
  // 断边编号降为副标签（D-5），标题改人话
  await expect(page.locator("#dep-health-content")).toContainText("代码里 import 了但没装");
});

test("DH-5（D-8）明细筛选：只留命中行 + 计数；≥2 组可修 → 修复全部可修项", async ({ page }) => {
  const repo = await makeDeclaredRepo();
  await bootWithDiff(page, repo, makeDiff("/.venv/Scripts/python.exe", true));
  const content = page.locator("#dep-health-content");

  await expect(content).toContainText("修复全部可修项"); // E1 + E3 两组可修
  await expect(content).toContainText("yaml");
  await expect(content).toContainText("numpy");

  await page.locator("#dep-filter-input").fill("yaml");
  await expect(content).toContainText("yaml");
  await expect(content).not.toContainText("numpy");
  await expect(page.locator("#dep-filter-count")).toContainText("显示");
});
