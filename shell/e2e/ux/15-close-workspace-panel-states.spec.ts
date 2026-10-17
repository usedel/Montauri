/**
 * 回归：关闭工作区后各侧栏面板必须落在「未打开工作区」终态；测试面板还要覆盖
 * 「关闭 → 再打开」的重开刷新（用户报告 2026-10-17，当天第三跳）。
 *
 * 关闭态根因：resetWorkspaceUiState 里各视图的 reset 是**同步渲染**，而 closeWorkspace
 * 先调 resetWorkspaceUiState、后才把 app.workspaceRoot 置 null——reset 画出的是
 * 「没有端点 / 没有待办 / 暂无运行记录」这类「有工作区但没内容」的错误空态；
 * 数据库视图的 reset 干脆不渲染，整棵旧工作区的树残留。
 * 重开端根因：侧栏视图内容只在 onShow（切 tab）时刷新，重开工作区不触发 onShow，
 * 激活视图停在「未打开工作区」不动（测试面板的 onShow 带动态 import，第一轮收口
 * 时被漏掉）。
 * 两个方向统一走 workspaceViewRefresh.ts 的 refreshActiveViewForWorkspace() /
 * renderActiveViewClosed()（main.ts openWorkspace/closeWorkspace 收尾各一行）。
 *
 * 覆盖：endpoints / todo / runtime / database / tests 五个激活态关闭场景 +
 * tests 的重开刷新。git 的关闭态由 e2e/git/22 覆盖；files / search / debug 无
 * 工作区依赖的残留。
 *
 * mock：scan_todos 默认三条命中、scan_runtime_hotspots 默认「无运行记录」、db 默认
 * 1 连接 + 2 表、pytest_action 经 __E2E_PYTEST__ 预设 files/nodes——关闭前面板的
 * 内容都是真实渲染过的非空态。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const MAIN_PY = [
  "from fastapi import FastAPI",
  "",
  "app = FastAPI()",
  "",
  '@app.get("/health")',
  "def health():",
  '    return {"ok": True}',
  "",
  "# TODO 补上重试",
  "",
].join("\n");

const TEST_API = `import pytest


def test_create():
    assert 1 == 1
`;

/** pytest mock 预设（形状对齐 tauri-mock 的 __E2E_PYTEST__） */
const PYTEST_PRESET = {
  files: ["test_api.py"],
  nodes: ["test_api.py::test_create"],
};

/** 启动并等工作区就绪（状态栏分支名出现） */
async function boot(page: Page, repo: GitRepo, preset?: unknown): Promise<void> {
  if (preset) {
    await page.addInitScript((p) => {
      (window as unknown as { __E2E_PYTEST__?: unknown }).__E2E_PYTEST__ = p;
    }, preset);
  }
  await equipPage(page, repo);
  await page.goto("/");
  await expect
    .poll(async () => (await page.locator("#status-git").textContent())?.trim() ?? "", { timeout: 15_000 })
    .not.toBe("");
}

/** 文件菜单 → 关闭工作区，并等待关闭完成 */
async function closeWorkspaceViaMenu(page: Page): Promise<void> {
  await page.locator('.menubar-item[data-menu="file"]').click();
  await page.locator("#menu-dropdown").getByText("关闭工作区").click();
  await expect(page.locator("#tree-header-text")).toHaveText("文件");
  await expect(page.locator("#status-git")).toHaveText("");
}

/** 文件菜单 → 最近的工作区 → 重开 repo（走 openWorkspace 真实链路） */
async function reopenWorkspaceViaMenu(page: Page, repo: GitRepo): Promise<void> {
  await page.evaluate(async (root) => {
    const b = (window as { __E2E_BRIDGE__?: (ch: string, cmd: unknown, args: unknown) => Promise<unknown> }).__E2E_BRIDGE__;
    await b?.("setRecentWorkspaces", [root], null);
  }, repo.root);
  await page.locator('.menubar-item[data-menu="file"]').click();
  await page.locator("#menu-dropdown .ctx-menu-item.with-submenu", { hasText: "最近的工作区" }).click();
  await page.locator("#menu-submenu .ctx-menu-item .sub-label", { hasText: repo.root.split(/[\\/]/).pop() ?? "" }).click();
  await expect(page.locator("#tree-header-text")).toHaveText(repo.root);
  await expect
    .poll(async () => (await page.locator("#status-git").textContent())?.trim() ?? "", { timeout: 20_000 })
    .not.toBe("");
}

for (const spec of [
  {
    name: "端点",
    tab: "#tab-endpoints",
    container: "#ep-results",
    /** 关闭前的非空态（mock FW_DEFAULT 预设含 GET /health） */
    before: "/health",
    /** 附加断言：概要从「N 项」回落为「—」而不是误导性的「0 项」 */
    summary: "#ep-summary",
    preset: undefined as unknown,
  },
  {
    name: "TODO",
    tab: "#tab-todo",
    container: "#todo-results",
    /** mock 默认三条命中（app/main.py:12 等） */
    before: "补上重试",
    summary: "#todo-summary",
    preset: undefined as unknown,
  },
  {
    name: "运行时热点",
    tab: "#tab-runtime",
    container: "#hp-results",
    /** mock 默认「无运行记录」态（有工作区但没跑过） */
    before: "暂无运行记录",
    summary: undefined,
    preset: undefined as unknown,
  },
  {
    name: "数据库",
    tab: "#tab-database",
    container: "#db-tree",
    /** mock 默认对象树含 users 表 */
    before: "users",
    summary: undefined,
    preset: undefined as unknown,
  },
  {
    name: "测试",
    tab: "#tab-tests",
    container: "#test-content",
    /** pytest 预设 scan 出的文件骨架（§3.10 初始态折叠到文件级，用例子节点不渲染） */
    before: "test_api.py",
    summary: undefined,
    preset: PYTEST_PRESET,
  },
]) {
  test(`关闭工作区后「${spec.name}」面板显示「未打开工作区」（旧实现会显示错误空态/残留旧树）`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const repo = await makeGitRepo({ files: { "main.py": MAIN_PY, "test_api.py": TEST_API }, commitMsg: "baseline" });
    await boot(page, repo, spec.preset);

    // 激活目标面板，并等它渲染出关闭前的真实内容（排除扫描进行中的中间态）
    await page.locator(spec.tab).click();
    await expect(page.locator(spec.container)).toContainText(spec.before, { timeout: 15_000 });

    // 关闭工作区（未开文件 → 无脏 tab，不弹确认框）
    await closeWorkspaceViaMenu(page);

    // 核心断言：终态必须是「未打开工作区」。
    // 修复前：endpoints/todo 显示「没有端点 / 没有 TODO」、runtime 显示「暂无运行记录」、
    // database 整棵旧树残留——全部与「没有工作区」的事实矛盾。
    await expect(page.locator(spec.container)).toContainText("未打开工作区", { timeout: 10_000 });
    if (spec.summary) {
      await expect(page.locator(spec.summary)).toHaveText("—");
    }
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });
}

test("测试面板：关闭再打开 → 树刷新（不停留在「未打开工作区」；不重复点 tab）", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY, "test_api.py": TEST_API }, commitMsg: "baseline" });
  await boot(page, repo, PYTEST_PRESET);

  // 打开测试视图，等 scan 骨架 + collect 渲染（onShow 懒加载 initTestView + refreshTests）。
  // §3.10 初始态折叠到文件级——用文件行作锚点（展开是用户交互，不属于本回归面）。
  await page.locator("#tab-tests").click();
  const fileRow = page.locator("#test-content .test-row", { hasText: "test_api.py" }).first();
  await expect(fileRow).toBeVisible({ timeout: 15_000 });

  // 关闭工作区 → 终态「未打开工作区」
  await closeWorkspaceViaMenu(page);
  await expect(page.locator("#test-content")).toContainText("未打开工作区", { timeout: 10_000 });

  // 重开工作区（停在测试 tab，**不再点击 tab**——onShow 不会触发）
  await reopenWorkspaceViaMenu(page, repo);

  // 核心断言：补偿刷新必须把测试树重新收集出来。修复前停在「未打开工作区」直到
  // 用户手动切走再切回（与端点面板同款缺口，2026-10-17 用户第三跳）。
  await expect(fileRow).toBeVisible({ timeout: 15_000 });
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
