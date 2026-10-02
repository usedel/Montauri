/**
 * B3 SQLite 数据库工具窗 · 连接管理与对象树（docs/sqlite_tool_dev_plan.md §10 / PR-3 DoD）。
 *
 * 桩：e2e/mocks/tauri-mock.js 的 db_* 分发（内存连接列表 + 默认 2 表 1 视图 1 索引 + 250 行结果），
 * 不触达真实 SQLite（rusqlite 是 Rust 进程内库），只驱动前端状态机与渲染。
 * 预置入口：window.__E2E_DB__ = { connections, objects, result, ddl, pick, failOpen, failQuery }。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

let repo: GitRepo;
const pageErrors: string[] = [];

/** 预置数据库桩（mock 在 invoke 时才读，顺序无所谓；仍统一放 goto 前便于阅读） */
async function presetDb(page: Page, preset: Record<string, unknown>): Promise<void> {
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_DB__?: unknown }).__E2E_DB__ = p;
  }, preset);
}

/** 切到数据库视图（Activity Bar 第七项） */
async function openDbView(page: Page): Promise<void> {
  await page.locator("#tab-database").click();
  await expect(page.locator("#view-database")).toBeVisible({ timeout: 10_000 });
}

/** 视图内按 id 取元素 */
function db(page: Page, id: string) {
  return page.locator(`#${id}`);
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  repo = await makeGitRepo({ files: { "main.py": "print(1)\n" }, commitMsg: "baseline" });
  await equipPage(page, repo);
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("DB-CONN-1：Activity Bar 第七项可切，视图互斥且 tab 选中态同步", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });

  await openDbView(page);
  await expect(page.locator("#tab-database")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#view-files")).toBeHidden();

  // 切回文件视图：database 收起、files 展开（注册表的单根互斥语义）
  await page.locator("#tab-files").click();
  await expect(page.locator("#view-database")).toBeHidden();
  await expect(page.locator("#view-files")).toBeVisible();
});

test("DB-CONN-2：无连接时空态 + 下拉禁用", async ({ page }) => {
  await presetDb(page, { connections: [] });
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  await expect(db(page, "db-conn-select")).toBeDisabled();
  await expect(db(page, "db-tree")).toContainText("没有数据库连接");
  await expect(db(page, "db-tree")).toContainText(".sqlite");
  // 无连接时连接级按钮全部不可用
  await expect(db(page, "db-refresh")).toBeDisabled();
  await expect(db(page, "db-remove")).toBeDisabled();
  await expect(db(page, "db-writable")).toBeDisabled();
});

test("DB-CONN-3：有连接时自动打开并渲染三组对象树", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  // 下拉格式：<文件名> · <父目录>
  await expect(db(page, "db-conn-select")).toBeEnabled();
  await expect(db(page, "db-conn-select")).toContainText("app.db");
  await expect(db(page, "db-conn-select")).toContainText("e2e");

  // 三组标题带条数（表 2 / 视图 1 / 索引 1）
  const tree = db(page, "db-tree");
  await expect(tree.locator(".db-tree-group")).toHaveCount(3);
  await expect(tree.locator(".db-tree-group").nth(0)).toContainText("表 (2)");
  await expect(tree.locator(".db-tree-group").nth(1)).toContainText("视图 (1)");
  await expect(tree.locator(".db-tree-group").nth(2)).toContainText("索引 (1)");

  // 组内按名排序 + 行数显示
  await expect(tree.locator('.db-tree-item[data-name="users"]')).toContainText("250 行");
  await expect(tree.locator('.db-tree-item[data-name="logs"]')).toContainText("12 行");
});

test("DB-CONN-4：单击表节点展开列（名 + 类型 + PK/NN），索引无子项", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  const users = page.locator('#db-tree .db-tree-item[data-name="users"]');
  const cols = users.locator(".db-tree-cols");
  await expect(cols).toBeHidden();
  await users.click();
  await expect(cols).toBeVisible();
  await expect(cols.locator(".db-tree-col").nth(0)).toContainText("id");
  await expect(cols.locator(".db-tree-col").nth(0)).toContainText("INTEGER");
  await expect(cols.locator(".db-tree-col").nth(0)).toContainText("PK");
  await expect(cols.locator(".db-tree-col").nth(1)).toContainText("NN");

  // 索引节点没有列容器
  await expect(page.locator('#db-tree .db-tree-item[data-name="idx_users_name"] .db-tree-cols')).toHaveCount(0);
});

test("DB-CONN-5：双击表节点直接查前 N 行（最常用路径）", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  await page.locator('#db-tree .db-tree-item[data-name="users"]').dblclick();
  const grid = db(page, "db-result-grid");
  await expect(grid.locator("table.db-grid")).toBeVisible({ timeout: 10_000 });
  const head = await grid.locator("thead th").allTextContents();
  expect(head).toEqual(["#", "id", "name", "note"]);
  await expect(grid.locator("tbody tr").first().locator(".db-rowno")).toHaveText("1");
  // 状态条：已显示/总数 行 · 耗时 · 只读
  await expect(db(page, "db-result-status")).toContainText("200/250 行");
  await expect(db(page, "db-result-status")).toContainText("只读");
});

test("DB-CONN-6：可写开关需二次确认，开启后 aria-pressed 与警示条同步", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  const toggle = db(page, "db-writable");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(db(page, "db-write-banner")).toBeHidden();

  await toggle.click();
  // 自绘确认框：取消则不改变状态
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.locator("#confirm-cancel").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await page.locator("#confirm-ok").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(db(page, "db-write-banner")).toBeVisible();
  await expect(db(page, "db-write-banner")).toContainText("可写模式");
});

test("DB-CONN-7：移除连接只从列表摘除（确认框 + 落盘列表不含它）", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);
  await expect(db(page, "db-tree")).toContainText("users");

  await db(page, "db-remove").click();
  await expect(page.locator("#confirm-modal")).toContainText("不会删除文件");
  await page.locator("#confirm-ok").click();

  await expect(db(page, "db-conn-select")).toBeDisabled();
  await expect(db(page, "db-tree")).toContainText("没有数据库连接");

  const saved = await page.evaluate(
    () => (window as unknown as { __E2E_DB_SAVED__?: { id: string }[] }).__E2E_DB_SAVED__,
  );
  expect(saved).toEqual([]);
});

test("DB-CONN-8：＋ 添加连接走 pick_file，成功后进入下拉并可打开", async ({ page }) => {
  await presetDb(page, { pick: "C:\\e2e\\extra.db" });
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  await expect(db(page, "db-conn-select").locator("option")).toHaveCount(1);
  await db(page, "db-add").click();
  await expect(db(page, "db-conn-select").locator("option")).toHaveCount(2);
  await expect(db(page, "db-conn-select")).toContainText("extra.db");
  // 新增连接后自动切换过去并刷新树
  await expect(db(page, "db-tree")).toContainText("users");
});

test("DB-CONN-9：段折叠状态持久化到 localStorage，重开视图仍生效", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);

  const header = page.locator("#db-tree-wrap .db-section-header");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(db(page, "db-tree")).toBeHidden();

  const stored = await page.evaluate(() => localStorage.getItem("opencharm.db.sections"));
  expect(stored).toContain("db-tree-wrap");

  // 重新加载：折叠态由 main 启动路径的 restoreDbSections 读 localStorage 恢复
  await page.reload();
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await openDbView(page);
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(db(page, "db-tree")).toBeHidden();
});
