/**
 * 回归：关闭工作区后各侧栏面板必须落在「未打开工作区」终态（用户报告 2026-10-17）。
 *
 * 根因：resetWorkspaceUiState 里各视图的 reset 是**同步渲染**，而 closeWorkspace
 * 先调 resetWorkspaceUiState、后才把 app.workspaceRoot 置 null——reset 画出的是
 * 「没有端点 / 没有待办 / 暂无运行记录」这类「有工作区但没内容」的错误空态；
 * 数据库视图的 reset 干脆不渲染，整棵旧工作区的树残留。git 视图的终态渲染
 * （P1-3）+ 数据库/端点/todo/runtime 的收口见 workspaceViewRefresh.ts::
 * renderActiveViewClosed()（closeWorkspace 收尾、root 置 null 之后调用）。
 *
 * 覆盖：endpoints / todo / runtime / database 四个激活态关闭场景。
 * git 的关闭态由 e2e/git/22-close-workspace-stale-list.spec.ts 覆盖；
 * files / search / debug / tests 无工作区依赖的残留（debug 与工作区无关；
 * tests 的 resetTestView 经动态 import 解析时 root 已置 null，天然正确）。
 *
 * mock：scan_todos 默认三条命中、scan_runtime_hotspots 默认「无运行记录」、
 * db 默认 1 连接 + 2 表——关闭前的面板内容都是真实渲染过的非空态。
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

/** 启动并等工作区就绪（状态栏分支名出现） */
async function boot(page: Page, repo: GitRepo): Promise<void> {
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

for (const spec of [
  {
    name: "端点",
    tab: "#tab-endpoints",
    container: "#ep-results",
    /** 关闭前的非空态（mock FW_DEFAULT 预设含 GET /health） */
    before: "/health",
    /** 附加断言：概要从「N 项」回落为「—」而不是误导性的「0 项」 */
    summary: "#ep-summary",
  },
  {
    name: "TODO",
    tab: "#tab-todo",
    container: "#todo-results",
    /** mock 默认三条命中（app/main.py:12 等） */
    before: "补上重试",
    summary: "#todo-summary",
  },
  {
    name: "运行时热点",
    tab: "#tab-runtime",
    container: "#hp-results",
    /** mock 默认「无运行记录」态（有工作区但没跑过） */
    before: "暂无运行记录",
    summary: undefined,
  },
  {
    name: "数据库",
    tab: "#tab-database",
    container: "#db-tree",
    /** mock 默认对象树含 users 表 */
    before: "users",
    summary: undefined,
  },
]) {
  test(`关闭工作区后「${spec.name}」面板显示「未打开工作区」（旧实现会显示错误空态/残留旧树）`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
    await boot(page, repo);

    // 激活目标面板，并等它渲染出关闭前的真实内容（排除扫描进行中的中间态）
    await page.locator(spec.tab).click();
    await expect(page.locator(spec.container)).toContainText(spec.before, { timeout: 10_000 });

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
