/**
 * E2E：TODO 视图 B6-3（过滤 / 分组切换 / 组折叠）
 *
 * 后端 `scan_todos` 由 tauri-mock 返回当前用例注入的三条命中（不触达真实扫描），本 spec 验
 * 浏览器层的交互接线：200ms 防抖过滤、命中计数、按文件分组、组折叠、语言切换与跳转。
 * Rust 侧的路径校验 / 忽略规则 / 排序由 `fs_cmds.rs` 单测覆盖，浏览器层够不到；
 * 纯函数（filterTodos / groupTodos*）由 `src/__tests__/todoView.test.ts` 覆盖。
 *
 * 三条命中的形状：main.py 两条（TODO@12 / FIXME@40）+ util.py 一条（TODO@7）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const MAIN_SOURCE = Array.from({ length: 40 }, (_, i) => `line_${i + 1} = ${i + 1}`).join("\n") + "\n";

async function makeTodoRepo(): Promise<GitRepo> {
  return makeGitRepo({
    files: { "app/main.py": MAIN_SOURCE, "app/util.py": "value = 1\n" },
    commitMsg: "baseline",
  });
}

async function boot(page: Page, repo: GitRepo): Promise<void> {
  await equipPage(page, repo);
  await page.addInitScript((matches) => {
    (window as unknown as { __E2E_TODO_SCAN__?: unknown }).__E2E_TODO_SCAN__ = matches;
  }, [
    { path: repo.abs("app/main.py"), line: 12, tag: "TODO", message: "补上重试", text: "# TODO 补上重试" },
    { path: repo.abs("app/main.py"), line: 40, tag: "FIXME", message: "空列表会漏", text: "# FIXME 空列表会漏" },
    { path: repo.abs("app/util.py"), line: 7, tag: "TODO", message: "抽成工具函数", text: "# TODO 抽成工具函数" },
  ]);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

/** 切到 TODO 视图（onShow 触发扫描）并等首屏列表就绪 */
async function openTodoView(page: Page): Promise<void> {
  await page.locator("#tab-todo").click();
  await expect(page.locator("#todo-results .todo-item")).toHaveCount(3, { timeout: 10_000 });
}

const items = (page: Page) => page.locator("#todo-results .todo-item");
const headers = (page: Page) => page.locator("#todo-results .todo-group-header");

test("默认按标签分组：两个标记组 + 三条条目", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  await expect(headers(page)).toHaveCount(2); // TODO / FIXME
  await expect(headers(page).first().locator(".todo-badge")).toHaveText("TODO");
  await expect(page.locator("#todo-summary")).toContainText("3 项");
});

test("关键字过滤：命中数收敛 + 摘要显示命中/总数", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  await page.locator("#todo-filter").fill("工具函数");
  await expect(items(page)).toHaveCount(1, { timeout: 5_000 }); // 200ms 防抖后收敛
  await expect(page.locator("#todo-summary")).toContainText("命中 1 / 共 3 项");
  await expect(page.locator("#todo-filter-clear")).not.toHaveClass(/\bhidden\b/);

  // 清空按钮：回到全量并复位摘要和按钮状态
  await page.locator("#todo-filter-clear").click();
  await expect(items(page)).toHaveCount(3);
  await expect(page.locator("#todo-summary")).toContainText("3 项");
  await expect(page.locator("#todo-filter-clear")).toHaveClass(/\bhidden\b/);

  // Esc 与按钮走同一状态收口
  await page.locator("#todo-filter").fill("TODO");
  await expect(page.locator("#todo-filter-clear")).not.toHaveClass(/\bhidden\b/);
  await page.locator("#todo-filter").press("Escape");
  await expect(page.locator("#todo-filter")).toHaveValue("");
  await expect(page.locator("#todo-filter-clear")).toHaveClass(/\bhidden\b/);
});

test("过滤无命中：显示空态而非空白列表", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  await page.locator("#todo-filter").fill("zzz-没有这个词");
  await expect(items(page)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator("#todo-results .empty-title")).toHaveText("没有匹配的待办");
});

test("切换到按文件分组：组头为文件名，条目前补标记徽标", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  await page.locator("#todo-group-mode").selectOption("file");
  await expect(headers(page)).toHaveCount(2); // main.py / util.py
  await expect(headers(page).first().locator(".todo-group-name")).toHaveText("main.py");
  // 文件模式下标记维度从组头丢失，改在条目前补徽标
  await expect(items(page).first().locator(".todo-badge")).toHaveText("TODO");
});

test("组头可折叠：键盘操作后保持焦点，再次操作可展开", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  const first = headers(page).first();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(items(page)).toHaveCount(1, { timeout: 5_000 }); // TODO 组两条被收起，只剩 FIXME 一条
  await expect(headers(page).first()).toHaveAttribute("aria-expanded", "false");
  await expect(headers(page).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(items(page)).toHaveCount(3);
  await expect(headers(page).first()).toBeFocused();
});

test("运行时切换语言：过滤控件、分组选项和摘要同步刷新", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  await expect(page.locator("#todo-filter")).toHaveAttribute("placeholder", "过滤标记 / 说明 / 文件");
  await page.locator("#btn-settings").click();
  await page.locator("#settings-locale").selectOption("en-US");

  await expect(page.locator("#todo-filter")).toHaveAttribute("placeholder", "Filter by tag / text / file");
  await expect(page.locator("#todo-group-mode option").first()).toHaveText("By tag");
  await expect(page.locator("#todo-summary")).toContainText("3 items");
});

test("点击条目：打开对应文件", async ({ page }) => {
  const repo = await makeTodoRepo();
  await boot(page, repo);
  await openTodoView(page);

  await items(page).first().click();
  await expect.poll(
    () => page.evaluate(() => document.querySelector("#tabbar .tab.active .name")?.textContent ?? null),
    { timeout: 10_000 },
  ).toBe("main.py");
  await expect(page.locator("#status-file")).toContainText("main.py");
});
