/**
 * E2E：A1 运行时热点视图（docs/improvement_and_roadmap_report.md §3「A 类 · 深化差异化」）
 *
 *  - HS-1 切到「运行时热点」→ 触发 scan_runtime_hotspots；观测区按 hits 降序 + stale/exc 徽章；
 *        未观测区渲染；summary 覆盖率正确
 *  - HS-2 点击观测条目 → openFile 跳转声明（绝对路径 → read_file 直读）
 *  - HS-3 无运行记录（has_data=false）→ 空态 + summary「暂无运行记录」，不出现未观测区
 *  - HS-4 口径纪律：未观测区措辞为「未观测到运行」并显式否认「死代码」
 *  - HS-5 扫描失败：命令抛错 → 错误态可见（不静默吞错）
 *  - HS-6 惰性加载：未切到该视图不发扫描，切过去才拉取（不在启动路径上做 IO）
 *  - HS-7 刷新按钮：重新扫描后列表随之更新（非仅 onShow 一次性）
 *  - HS-8 截断提示 + 负向断言（stale 不串行 / 未观测行无 hits）+ 未观测行同路径可跳转
 *
 * mock 面跑在 tauri-mock.js（scan_runtime_hotspots），预置经 window.__E2E_HOTSPOTS_PRESET__
 * 注入、错误经 __E2E_HOTSPOTS_FAIL__ 注入（均须 addInitScript 先于 goto）。真实差集语义
 * （probe 库 × 静态 def 扫描）由 Rust 单测 intel_cmds 覆盖；本 spec 只验证前端渲染与动作接线。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

interface HotspotItem {
  file: string;
  qualname: string;
  line: number;
  hits: number;
  stale: boolean;
  exc: string[];
}

interface HotspotsPreset {
  has_data?: boolean;
  runs?: number;
  last_run?: number | null;
  trace_db?: string;
  observed?: HotspotItem[];
  unobserved?: HotspotItem[];
  total_defined?: number;
  truncated?: boolean;
}

async function activeTabName(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector("#tabbar .tab.active .name")?.textContent ?? null);
}

async function boot(
  page: Page,
  repo: GitRepo,
  preset?: HotspotsPreset,
  opts: { fail?: string } = {},
): Promise<void> {
  if (preset || opts.fail) {
    // PRESET / FAIL 须先于 tauri-mock 注入（addInitScript 按序执行；mock 在 invoke 时才读）
    await page.addInitScript((p) => {
      const w = window as unknown as { __E2E_HOTSPOTS_PRESET__?: unknown; __E2E_HOTSPOTS_FAIL__?: string };
      if (p.preset) w.__E2E_HOTSPOTS_PRESET__ = p.preset;
      if (p.fail) w.__E2E_HOTSPOTS_FAIL__ = p.fail;
    }, { preset, fail: opts.fail });
  }
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

// ---------- HS-1：观测区排序 / 徽章 + 未观测区 + summary ----------

test("HS-1 运行时热点：观测区按 hits 降序 + 徽章 + 未观测区", async ({ page }) => {
  const repo = await makeGitRepo({
    files: {
      "app/main.py": "def handle():\n    return 1\n\n\nclass C:\n    def method(self):\n        return 2\n",
      "app/util.py": "def helper():\n    return 3\n",
      "app/unused.py": "def never():\n    return 4\n",
    },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    has_data: true,
    runs: 4,
    last_run: 1_700_000_000,
    trace_db: "D:/data/traces/abc123.db",
    // 定义总数 4 = observed 3 + unobserved 1 → 覆盖率 75%
    total_defined: 4,
    observed: [
      { file: repo.abs("app/main.py"), qualname: "handle", line: 1, hits: 120, stale: false, exc: [] },
      { file: repo.abs("app/util.py"), qualname: "helper", line: 1, hits: 40, stale: true, exc: ["ValueError"] },
      { file: repo.abs("app/main.py"), qualname: "C.method", line: 6, hits: 3, stale: false, exc: [] },
    ],
    unobserved: [{ file: repo.abs("app/unused.py"), qualname: "never", line: 1, hits: 0, stale: false, exc: [] }],
  });

  await page.locator("#tab-runtime").click();
  const list = page.locator("#hp-results");
  await expect(list).toBeVisible();

  // summary：观测 3 + 覆盖 75%（3/4）
  await expect(page.locator("#hp-summary")).toContainText("观测 3 个函数");
  await expect(page.locator("#hp-summary")).toContainText("覆盖 75%");

  // 观测区标题 + 计数
  const obsHeader = list.locator(".todo-group-header", { hasText: "已观测" });
  await expect(obsHeader.locator(".todo-group-count")).toHaveText("3");

  // hits 降序：第一行是 handle（120 次）
  const rows = list.locator(".hp-item");
  await expect(rows.first().locator(".hp-name")).toHaveText("handle");
  await expect(rows.first().locator(".hp-hits")).toHaveText("120 次");

  // 徽章：helper 行同时带 stale（已改动）与 exc（⚠ 1）
  const helperRow = list.locator(".hp-item", { hasText: "helper" });
  await expect(helperRow.locator(".hp-badge--stale")).toBeVisible();
  await expect(helperRow.locator(".hp-badge--exc")).toContainText("1");

  // 未观测区：计数 1 + 条目渲染
  const unHeader = list.locator(".todo-group-header", { hasText: "未观测到运行" });
  await expect(unHeader.locator(".todo-group-count")).toHaveText("1");
  await expect(list.locator(".hp-item", { hasText: "never" })).toBeVisible();
});

// ---------- HS-2：点击跳转声明 ----------

test("HS-2 点击观测条目跳转声明", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "app/main.py": "def handle():\n    return 1\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    has_data: true,
    runs: 1,
    last_run: 1_700_000_000,
    total_defined: 1,
    observed: [{ file: repo.abs("app/main.py"), qualname: "handle", line: 1, hits: 9, stale: false, exc: [] }],
    unobserved: [],
  });

  await page.locator("#tab-runtime").click();
  const row = page.locator("#hp-results .hp-item", { hasText: "handle" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect.poll(() => activeTabName(page), { timeout: 10_000 }).toBe("main.py");
});

// ---------- HS-3：无运行记录空态 ----------

test("HS-3 无运行记录：空态 + summary，无未观测区", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "app/main.py": "def handle():\n    return 1\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    has_data: false,
    runs: 0,
    last_run: null,
    observed: [],
    unobserved: [],
    total_defined: 1,
  });

  await page.locator("#tab-runtime").click();
  await expect(page.locator("#hp-summary")).toHaveText("暂无运行记录");
  const list = page.locator("#hp-results");
  await expect(list.locator(".empty-state")).toBeVisible();
  await expect(list.locator(".empty-title")).toHaveText("暂无运行记录");
  // 无运行数据时「未观测」无信息量——口径红线：不产出未观测区
  await expect(list.locator(".todo-group-header", { hasText: "未观测到运行" })).toHaveCount(0);
});

// ---------- HS-4：口径纪律（未观测 ≠ 死代码） ----------

test("HS-4 口径纪律：未观测区措辞为「未观测到运行」并否认死代码", async ({ page }) => {
  const repo = await makeGitRepo({
    files: {
      "app/main.py": "def ran():\n    return 1\n",
      "app/never.py": "def never():\n    return 2\n",
    },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    has_data: true,
    runs: 2,
    last_run: 1_700_000_000,
    total_defined: 2,
    observed: [{ file: repo.abs("app/main.py"), qualname: "ran", line: 1, hits: 5, stale: false, exc: [] }],
    unobserved: [{ file: repo.abs("app/never.py"), qualname: "never", line: 1, hits: 0, stale: false, exc: [] }],
  });

  await page.locator("#tab-runtime").click();
  const list = page.locator("#hp-results");
  await expect(list.locator(".todo-group-header", { hasText: "未观测到运行" })).toBeVisible();

  // 两区标题措辞固定（不得把「未观测」写成「死代码」断言）
  await expect(list.locator(".hp-section-label")).toHaveText(["已观测（按调用次数）", "未观测到运行"]);
  // 提示显式否认死代码（title 属性承载完整口径）
  const label = list.locator(".hp-section-label", { hasText: "未观测到运行" });
  await expect(label).toHaveAttribute("title", /不代表死代码/);
});

// ---------- HS-5：扫描失败 ----------

test("HS-5 扫描失败：错误态可见（不静默吞错）", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "app/main.py": "def handle():\n    return 1\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, undefined, { fail: "trace 库损坏" });

  await page.locator("#tab-runtime").click();
  const list = page.locator("#hp-results");
  // summary 与空态都落在「扫描失败」，且带上后端错误原文
  await expect(page.locator("#hp-summary")).toHaveText("扫描失败");
  await expect(list.locator(".empty-title")).toHaveText("扫描失败");
  await expect(list.locator(".empty-state")).toContainText("trace 库损坏");
});

// ---------- HS-6：惰性加载（不在启动路径上做 IO） ----------

test("HS-6 未切到该视图不发扫描；切过去才拉取", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "app/main.py": "def handle():\n    return 1\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    has_data: true,
    runs: 1,
    last_run: 1_700_000_000,
    total_defined: 1,
    observed: [{ file: repo.abs("app/main.py"), qualname: "handle", line: 1, hits: 4, stale: false, exc: [] }],
    unobserved: [],
  });

  // 启动完成（工作区已打开、状态栏已就绪）后仍未扫描：该命令只挂在视图 onShow 上
  const calls = () =>
    page.evaluate(() => (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? []);
  expect((await calls()).some((c) => c.startsWith("scan_runtime_hotspots"))).toBe(false);

  await page.locator("#tab-runtime").click();
  await expect(page.locator("#hp-results .hp-item", { hasText: "handle" })).toBeVisible();
  expect((await calls()).some((c) => c.startsWith("scan_runtime_hotspots"))).toBe(true);
});

// ---------- HS-7：刷新按钮 ----------

test("HS-7 刷新按钮：重新扫描后列表随之更新", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "app/main.py": "def handle():\n    return 1\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, { has_data: false, runs: 0, last_run: null, observed: [], unobserved: [], total_defined: 1 });

  await page.locator("#tab-runtime").click();
  await expect(page.locator("#hp-results .empty-title")).toHaveText("暂无运行记录");

  // 跑过一次之后（mock 侧换 preset）→ 点刷新应重新拉取，而不是停在旧空态
  await page.evaluate((file) => {
    (window as unknown as { __E2E_HOTSPOTS_PRESET__?: unknown }).__E2E_HOTSPOTS_PRESET__ = {
      has_data: true,
      runs: 1,
      last_run: 1_700_000_000,
      observed: [{ file, qualname: "handle", line: 1, hits: 9, stale: false, exc: [] }],
      unobserved: [],
      total_defined: 1,
    };
  }, repo.abs("app/main.py"));
  await page.locator("#hp-refresh").click();
  await expect(page.locator("#hp-summary")).toContainText("观测 1 个函数");
  await expect(page.locator("#hp-results .hp-item", { hasText: "handle" }).locator(".hp-hits")).toHaveText("9 次");
});

// ---------- HS-8：截断提示 / 负向断言 / 未观测行跳转 ----------

test("HS-8 截断提示 + 徽章不串行 + 未观测行也可跳转", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "app/main.py": "def handle():\n    return 1\n\n\ndef spare():\n    return 2\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    has_data: true,
    runs: 1,
    last_run: 1_700_000_000,
    total_defined: 2,
    // stale / exc 只挂在第一条上 → 负向断言另一条不得被串上
    observed: [
      { file: repo.abs("app/main.py"), qualname: "handle", line: 1, hits: 8, stale: false, exc: [] },
      { file: repo.abs("app/main.py"), qualname: "spare", line: 5, hits: 2, stale: true, exc: ["KeyError"] },
    ],
    unobserved: [{ file: repo.abs("app/main.py"), qualname: "unused", line: 9, hits: 0, stale: false, exc: [] }],
    truncated: true,
  });

  await page.locator("#tab-runtime").click();
  const list = page.locator("#hp-results");
  const rows = list.locator(".hp-item");

  // 负向：stale / exc 不串行（handle 干净，spare 才带）
  await expect(rows.nth(0).locator(".hp-badge--stale")).toHaveCount(0);
  await expect(rows.nth(0).locator(".hp-badge--exc")).toHaveCount(0);
  await expect(rows.nth(1).locator(".hp-badge--stale")).toHaveText("已改动");
  await expect(rows.nth(1).locator(".hp-badge--exc")).toHaveText("⚠ 1");
  await expect(rows.nth(1).locator(".hp-badge--exc")).toHaveAttribute("title", /KeyError/);

  // 未观测行不显示 hits（hits 恒 0，显示"0 次"是噪声）
  await expect(list.locator(".hp-item", { hasText: "unused" }).locator(".hp-hits")).toHaveCount(0);

  // 截断提示：条数取 unobserved.length
  await expect(list.locator(".hp-meta", { hasText: "结果过多" })).toHaveText("结果过多，仅显示前 1 条");

  // 未观测行与已观测行走同一条 openFile 路径
  await list.locator(".hp-item", { hasText: "unused" }).click();
  await expect.poll(() => activeTabName(page), { timeout: 10_000 }).toBe("main.py");
});
