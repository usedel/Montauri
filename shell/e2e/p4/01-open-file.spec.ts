/**
 * E2E：单文件打开 + Markdown 预览模式（docs/open_file_dev_plan.md · 批 3 验收）
 *
 * 覆盖：
 *  - OF-1 欢迎页「打开文件」按钮存在且可点（pick 通道预置后走探测→openWorkspace→openFile）
 *  - OF-2 md 单击 = 预览 Tab（kind="md"，只读宿主，无编辑器抢焦）
 *  - OF-3 md 双击 = 提升为编辑 Tab（预览 Tab 关闭）
 *  - OF-4 预览工具栏「编辑源码」按钮 = 原地转编辑
 *  - OF-5 纯 md 工作区（无 py）LSP 跳过 + 状态栏提示
 *  - OF-6 设置 markdown_open_mode=edit → 单击直接开编辑 Tab
 *
 * 范式复用 ux spec：真实临时目录 + tauri-mock + __E2E_OPENFILE__ 控制面
 * （find_project_root / workspace_has_python / pick_file 的 mock 通道，见 tauri-mock.js）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

async function bootMdRepo(page: Page, repo: GitRepo, openfile?: { root?: string; fallback?: boolean; hasPy?: boolean }, startEmpty = false): Promise<void> {
  await page.addInitScript((of) => {
    (window as unknown as { __E2E_OPENFILE__?: unknown }).__E2E_OPENFILE__ = of;
  }, openfile ?? {});
  await equipPage(page, repo, { startEmpty });
  await page.goto("/");
  // startEmpty 时树是空态（等欢迎页），否则等文件树（工作区已恢复）
  if (startEmpty) {
    await expect(page.locator("#editor-overlay")).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(page.locator("#tree")).toBeVisible({ timeout: 20_000 });
  }
}

/** 文件树里单击条目（.tree-item 的 name 命中） */
async function clickTreeItem(page: Page, name: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: name }).first().click();
}

async function dblclickTreeItem(page: Page, name: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: name }).first().dblclick();
}

// ---------- OF-1：欢迎页「打开文件」按钮 ----------

test("OF-1 欢迎页有「打开文件」入口（无工作区空态）", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# hi\n" });
  await bootMdRepo(page, repo, { root: repo.root }, true);
  // 无工作区空态：actions 区可见，「打开文件」与「打开文件夹」并列
  await expect(page.locator("#ew-open-file")).toBeVisible({ timeout: 20_000 });
});

// ---------- OF-2/3：md 单击预览、双击提升 ----------

test("OF-2 md 单击打开预览 Tab（只读宿主可见、无 Monaco 抢焦）", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# 标题\n\n正文段落\n" });
  await bootMdRepo(page, repo, { hasPy: false });

  await clickTreeItem(page, "note.md");
  // 预览 Tab 出现且激活（显示名含「预览」后缀）
  await expect(page.locator("#tabbar .tab.active", { hasText: "note.md" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#tabbar .tab.active .name")).toContainText("预览");
  // 宿主可见、主编辑器隐藏
  await expect(page.locator("#md-preview-tab-panel")).toBeVisible();
  await expect(page.locator("#md-preview-tab-panel h1")).toHaveText("标题");
  await expect(page.locator("#md-preview-tab-panel p").first()).toHaveText("正文段落");
  // 分栏预览不叠加（预览 Tab 激活时分栏必须隐藏）
  await expect(page.locator("#md-preview")).toBeHidden();
});

test("OF-3 md 双击提升为编辑 Tab（预览 Tab 关闭）", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# t\n" });
  await bootMdRepo(page, repo, { hasPy: false });

  await clickTreeItem(page, "note.md"); // 单击 → 预览
  await expect(page.locator("#md-preview-tab-panel")).toBeVisible({ timeout: 10_000 });

  await dblclickTreeItem(page, "note.md"); // 双击 → 提升
  await expect(page.locator("#tabbar .tab.active .name")).toHaveText("note.md", { timeout: 10_000 });
  // 预览 Tab 已收、宿主隐藏、主编辑器回来（Monaco 可见）
  await expect(page.locator("#tabbar .tab", { hasText: "预览" })).toHaveCount(0);
  await expect(page.locator("#md-preview-tab-panel")).toBeHidden();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible();
});

// ---------- OF-4：预览工具栏「编辑源码」 ----------

test("OF-4 预览工具栏「编辑源码」原地转编辑", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# a\n" });
  await bootMdRepo(page, repo, { hasPy: false });

  await clickTreeItem(page, "note.md");
  await expect(page.locator("#md-preview-tab-panel .md-preview-tab-toolbar button")).toBeVisible({ timeout: 10_000 });
  await page.locator("#md-preview-tab-panel .md-preview-tab-toolbar button").click();

  await expect(page.locator("#tabbar .tab.active .name")).toHaveText("note.md", { timeout: 10_000 });
  await expect(page.locator("#md-preview-tab-panel")).toBeHidden();
});

// ---------- OF-5：纯 md 工作区 LSP 跳过 ----------

test("OF-5 纯 md 工作区状态栏显示 LSP 跳过原因", async ({ page }) => {
  const repo = await makePlainDir({ "a.md": "x\n", "b.md": "y\n" });
  await bootMdRepo(page, repo, { hasPy: false });
  await expect(page.locator("#status-lsp")).toContainText("无 Python", { timeout: 20_000 });
});

test("OF-5b 有 py 工作区照常启动 LSP（对照组）", async ({ page }) => {
  const repo = await makePlainDir({ "a.md": "x\n", "main.py": "print(1)\n" });
  await bootMdRepo(page, repo, { hasPy: true });
  // mock 环境下 LSP 走内置语义引擎，状态栏到「就绪」（非跳过文案）
  await expect(page.locator("#status-lsp")).not.toContainText("无 Python", { timeout: 20_000 });
});

// ---------- OF-6：设置 markdown_open_mode=edit ----------

test("OF-6 设置 edit 模式 → 单击 md 直接开编辑 Tab", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# t\n" });
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
      markdown_open_mode: "edit",
    };
  });
  await bootMdRepo(page, repo, { hasPy: false });

  await clickTreeItem(page, "note.md");
  await expect(page.locator("#tabbar .tab.active .name")).toHaveText("note.md", { timeout: 10_000 });
  await expect(page.locator("#md-preview-tab-panel")).toBeHidden();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible();
});

// ---------- OF-7：force 欢迎页与宿主浮层层级（帮助→欢迎页遮挡 bug 回归） ----------

test("OF-7 md 预览激活时 force 欢迎页 → 提层级盖过预览宿主；关闭还原", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# t\n" });
  await bootMdRepo(page, repo, { hasPy: false });

  await clickTreeItem(page, "note.md");
  await expect(page.locator("#md-preview-tab-panel")).toBeVisible({ timeout: 10_000 });

  // 帮助→欢迎页（force 态）：点菜单栏「帮助」→ 下拉「欢迎页」
  await page.locator(".menubar-item[data-menu='help']").click();
  const welcomeItem = page.locator("#menu-dropdown .ctx-menu-item").filter({ hasText: "欢迎页" }).first();
  await welcomeItem.click();

  // 欢迎页可见且盖在预览宿主之上（z-index 30 > 20）
  const overlay = page.locator("#editor-overlay");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay).toHaveClass(/forced/);
  // 品牌卡可见（不是只露个透明层）
  await expect(overlay.locator(".ew-brand")).toBeVisible();

  // force 关闭按钮 → 还原：overlay 隐藏、预览宿主回来
  await page.locator("#ew-force-close").click();
  await expect(overlay).toBeHidden();
  await expect(page.locator("#md-preview-tab-panel")).toBeVisible();
  await expect(page.locator("#tabbar .tab.active .name")).toContainText("预览");
});

// ---------- OF-8：编辑 tab → 切回预览模式（补入口回归） ----------

test("OF-8 编辑 tab 右键「切换到预览模式」→ 预览 Tab 激活、编辑 Tab 保留、新内容可见", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# 原始标题\n" });
  await bootMdRepo(page, repo, { hasPy: false });

  // 双击开编辑 tab，改内容（autosave 落盘与否不影响断言——预览取内存 model 值，
  // 与磁盘同步后的值一致）。先点编辑器中心拿焦点再键入。
  await dblclickTreeItem(page, "note.md");
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
  await page.locator("#editor .monaco-editor").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("# 草稿标题");
  // 编辑器内容已变（等待 Monaco 渲染出文本）
  await expect(page.locator("#editor .view-lines")).toContainText("草稿标题", { timeout: 5_000 });

  // 右键编辑 tab → 「切换到预览模式」
  await page.locator("#tabbar .tab.active").click({ button: "right" });
  const switchItem = page.locator("#ctx-menu .ctx-menu-item").filter({ hasText: "切换到预览模式" }).first();
  await switchItem.click();

  // 预览 Tab 激活 + 渲染的是编辑后的内容（内存 model 值，含未落盘草稿）
  await expect(page.locator("#tabbar .tab.active .name")).toContainText("预览", { timeout: 10_000 });
  await expect(page.locator("#md-preview-tab-panel h1")).toHaveText("草稿标题");
  // 编辑 Tab 保留在后台（草稿不丢），点它即回编辑
  const editTab = page.locator("#tabbar .tab", { hasText: "note.md" }).filter({ hasNotText: "预览" });
  await expect(editTab).toHaveCount(1);
  await editTab.click();
  await expect(page.locator("#tabbar .tab.active .name")).toHaveText("note.md");
  await expect(page.locator("#md-preview-tab-panel")).toBeHidden();
});

// ---------- OF-9：右上角三按钮（分栏预览 / 预览模式 / 导出） ----------

test("OF-9 编辑 md 右上角三按钮可见，「预览模式」按钮切纯预览 Tab", async ({ page }) => {
  const repo = await makePlainDir({ "note.md": "# 三按钮\n" });
  await bootMdRepo(page, repo, { hasPy: false });

  // 双击开编辑 tab（分栏/预览模式/导出三按钮应全部可见）
  await dblclickTreeItem(page, "note.md");
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#btn-md-preview")).toBeVisible();
  await expect(page.locator("#btn-md-preview-mode")).toBeVisible();
  await expect(page.locator("#btn-md-export")).toBeVisible();

  // 「预览模式」按钮 → 纯预览 Tab（激活、宿主渲染、分栏不叠加）
  await page.locator("#btn-md-preview-mode").click();
  await expect(page.locator("#tabbar .tab.active .name")).toContainText("预览", { timeout: 10_000 });
  await expect(page.locator("#md-preview-tab-panel h1")).toHaveText("三按钮");
  await expect(page.locator("#md-preview")).toBeHidden();

  // 预览 Tab 激活时三按钮全部隐藏（已在预览中，无编辑上下文）
  await expect(page.locator("#btn-md-preview")).toBeHidden();
  await expect(page.locator("#btn-md-preview-mode")).toBeHidden();
  await expect(page.locator("#btn-md-export")).toBeHidden();

  // 回编辑 tab：三按钮回来
  const editTab = page.locator("#tabbar .tab", { hasText: "note.md" }).filter({ hasNotText: "预览" });
  await editTab.click();
  await expect(page.locator("#btn-md-preview")).toBeVisible();
  await expect(page.locator("#btn-md-preview-mode")).toBeVisible();
});

