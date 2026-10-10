/**
 * E2E：启动恢复终态 + argv 双击文件（2026-10-10 两个用户报告 bug 的回归）
 *
 * bug 1「关闭所有工作区后重启仍自动恢复」：启动恢复从盲取 recents[0] 改为读
 *   <data_root>/config/last-session.json 终态——closeWorkspace 记 (open=false)、
 *   openWorkspace 记 (open=true, root)；文件不存在（首启/升级）回落旧行为。
 * bug 2「双击关联 md 却打开上次工作区」：启动时读 argv 第一个存在的文件（get_startup_file），
 *   优先级 argv > 项目窗口 > 恢复最近；走 openSingleFile（探测根 → openWorkspace → 定位文件）。
 *
 * mock 通道：__E2E_STARTUP__ = { lastSession?, startupFile? }（见 tauri-mock.js 静态表）。
 * 模拟重启 = 用同一预置新开 context/page（浏览器层没有真进程重启，预置即「上次终态」）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

interface StartupPreset {
  lastSession?: { open: boolean; workspace?: string | null } | null;
  startupFile?: string | null;
}

/** 预置 __E2E_STARTUP__ 后装配页面（照 p4/01 的 bootMdRepo 范式） */
async function bootWithStartup(page: Page, repo: GitRepo, preset: StartupPreset, startEmpty = false): Promise<void> {
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_STARTUP__?: unknown }).__E2E_STARTUP__ = p;
  }, preset);
  await equipPage(page, repo, { startEmpty });
  await page.goto("/");
}

/** 文件菜单 →「关闭工作区」（照 git/22 spec 的既有写法） */
async function closeWorkspaceViaMenu(page: Page): Promise<void> {
  await page.locator('.menubar-item[data-menu="file"]').click();
  await page.locator("#menu-dropdown").getByText("关闭工作区").click();
}

// ---------- SR-1：关闭工作区写「未打开」终态 ----------

test("SR-1 关闭工作区后 set_last_session 记录 open=false", async ({ page }) => {
  const repo = await makePlainDir({ "main.py": "print(1)\n" });
  await bootWithStartup(page, repo, {}); // 无预置 = 旧行为：recents[0] 恢复
  // 等「树条目出现」而非容器可见：#tree 是静态 DOM 天然可见，容器断言立即通过，
  // 冷启动下 init 可能仍在 monaco 动态包阶段、wireMenuBar 未接线 → 点菜单无效（30s 超时）。
  // 树条目 = refreshTree 完成 = openWorkspace 恢复链路就绪。
  await expect(page.locator("#tree .tree-item", { hasText: "main.py" })).toBeVisible({ timeout: 20_000 });

  await closeWorkspaceViaMenu(page);
  // 回到欢迎页 + 终态已写 open=false（重启不再恢复的直接依据）
  await expect(page.locator("#editor-overlay")).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __E2E_LAST_SESSION__?: { open: boolean } }).__E2E_LAST_SESSION__))?.open)
    .toBe(false);
});

// ---------- SR-2：终态 open=false 时启动不恢复（即使 recents 非空） ----------

test("SR-2 上次终态 open=false → 启动停在欢迎页（recents 仍有记录）", async ({ page }) => {
  const repo = await makePlainDir({ "main.py": "print(1)\n" });
  // recents 非空（equipPage 默认注入 [repo.root]）但 lastSession.open=false → 不恢复
  await bootWithStartup(page, repo, { lastSession: { open: false, workspace: null } });
  await expect(page.locator("#editor-overlay")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#tree")).toHaveCount(1); // 树容器在，但树是空态（无工作区）
  await expect(page.locator("#tree .tree-item")).toHaveCount(0);
});

// ---------- SR-3：终态 open=true → 恢复记录的工作区 ----------

test("SR-3 上次终态 open=true → 启动恢复该工作区并刷新终态", async ({ page }) => {
  const repo = await makePlainDir({ "main.py": "print(1)\n" });
  await bootWithStartup(page, repo, { lastSession: { open: true, workspace: repo.root } });
  await expect(page.locator("#tree")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#tree .tree-item", { hasText: "main.py" })).toBeVisible();
  // 恢复走 openWorkspace 全链路 → 终态被刷新为 (true, root)（保持连续会话语义）
  const last = await page.evaluate(() => (window as unknown as { __E2E_LAST_SESSION__?: { open: boolean; workspace?: string | null } }).__E2E_LAST_SESSION__);
  expect(last?.open).toBe(true);
  expect(last?.workspace).toBe(repo.root);
});

// ---------- SR-4：无终态文件（首启/升级）→ 回落 recents 恢复（向后兼容） ----------

test("SR-4 无终态记录 → 沿用 recents[0] 恢复（旧版本行为）", async ({ page }) => {
  const repo = await makePlainDir({ "main.py": "print(1)\n" });
  await bootWithStartup(page, repo, {}); // get_last_session 返回 null
  await expect(page.locator("#tree")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#tree .tree-item", { hasText: "main.py" })).toBeVisible();
});

// ---------- SR-5：欢迎页「打开文件」用户主动路径也写终态 ----------

test("SR-5 用户主动打开工作区（欢迎页最近列表）→ 终态记 (true, root)", async ({ page }) => {
  const repo = await makePlainDir({ "main.py": "print(1)\n" });
  // recents 非空但 lastSession.open=false → 停在欢迎页，最近列表可点
  await bootWithStartup(page, repo, { lastSession: { open: false, workspace: null } });
  await expect(page.locator("#editor-overlay")).toBeVisible({ timeout: 20_000 });

  const item = page.locator("#ew-recent-list .ew-recent-item").first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
  // 工作区打开 + 终态写入（openWorkspace 链路统一承担，不区分启动恢复/用户主动）。
  // set_last_session 在 openWorkspace 末尾——树可见 ≠ 链路走完，用 poll 等终态落定。
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __E2E_LAST_SESSION__?: { open: boolean } }).__E2E_LAST_SESSION__))?.open)
    .toBe(true);
});

// ---------- SR-6：argv 双击文件优先于恢复最近 ----------

test("SR-6 argv 双击文件 → 打开该文件所属工作区并定位文件（md 按设置分流预览）", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# hello\n" });
  // recents 默认 [repo.root]（若无 argv 会恢复它）；argv 文件 = repo 内的 note.md
  await page.addInitScript((of) => {
    (window as unknown as { __E2E_OPENFILE__?: unknown }).__E2E_OPENFILE__ = of;
  }, { root: repo.root, fallback: true, hasPy: false });
  await bootWithStartup(page, repo, { startupFile: `${repo.root}\\note.md` });
  await expect(page.locator("#tree")).toBeVisible({ timeout: 20_000 });
  // openSingleFile 链路：openWorkspace(root) → openFile(note.md) → 默认 preview 模式开预览 Tab
  await expect(page.locator("#tabbar .tab.active", { hasText: "note.md" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#md-preview-tab-panel h1")).toHaveText("hello");
});

// ---------- SR-7：单实例路由事件（第二实例双击文件命中本窗口工作区） ----------

test("SR-7 startup-file 事件 → 本窗口直接定位打开文件；工作区上报注册表", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# first\n", "other.md": "# second\n" });
  await bootWithStartup(page, repo, {}); // 正常恢复工作区
  await expect(page.locator("#tree .tree-item", { hasText: "note.md" })).toBeVisible({ timeout: 20_000 });

  // 单实例路由注册表已上报主窗口工作区（Rust 侧 is_under 判定的数据源）
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __E2E_MAIN_WORKSPACE__?: string | null }).__E2E_MAIN_WORKSPACE__)))
    .toBe(repo.root);

  // 模拟第二实例双击 another.md（同工作区内）→ Rust emit("startup-file")
  // → 前端 wireStartupFileEvent 监听 → 直接 openFile（不走探测/teardown）
  await page.evaluate((p) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { __emit?: (e: string, payload: unknown) => void } }).__TAURI_INTERNALS__;
    internals?.__emit?.("startup-file", p);
  }, `${repo.root}\\other.md`);
  await expect(page.locator("#tabbar .tab.active", { hasText: "other.md" })).toBeVisible({ timeout: 10_000 });
});

// ---------- SR-8：pending 启动文件（单实例路由开新项目窗口的透传） ----------

test("SR-8 pending 启动文件 → 项目窗口分支链式下落取走并打开（take 即清）", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# pending\n" });
  await page.addInitScript((of) => {
    (window as unknown as { __E2E_OPENFILE__?: unknown }).__E2E_OPENFILE__ = of;
  }, { root: repo.root, fallback: true, hasPy: false });
  // 模拟「路由未命中已开工作区 → 开新项目窗口 + pending 槽透传」：新窗口启动时
  // openInitialWorkspace 的项目窗口分支（get_window_project 命中 mock 返回 null 走空）
  // → take_startup_file 命中 → openFile 定位。注意 mock 的 get_window_project 返回
  // null（主窗口语义），pending 查询在 argv 检查的 else 分支之后照常执行。
  await bootWithStartup(page, repo, { pendingFile: `${repo.root}\\note.md` });
  await expect(page.locator("#tree")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#tabbar .tab.active", { hasText: "note.md" })).toBeVisible({ timeout: 10_000 });
  // take 即清：槽已空（重复查询返回 null）
  const taken = await page.evaluate(() => (window as unknown as { __E2E_STARTUP__?: { pendingFile?: string } }).__E2E_STARTUP__?.pendingFile);
  expect(taken).toBeUndefined();
});
