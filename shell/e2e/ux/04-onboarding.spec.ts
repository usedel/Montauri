/**
 * E2E：新手引导 + uv 速查卡（2026-09-30，docs/onboarding_dev_plan.md PR-S1/S2/S4）
 *
 *  - OG-1 帮助菜单「新手指南」→ md 落盘打开且预览含「uv 速查卡」标题
 *  - OG-1b 帮助菜单「帮助文档」→ 内置手册落盘打开且预览含目录标题（正文来自 public/help/）
 *  - OG-1c 英文界面下同一入口 → 取英文正文 opencharm-help.en.md（语言路由）
 *  - OG-1d 中文目录锚点可跳转（回归：marked 对中文 href 施加 encodeURI，点击需解码）
 *  - OG-1e 预览 Tab 右键「在终端中打开」→ 终端 cwd 为文档真实目录（回归：mdpreview: 虚拟 path）
 *  - OG-1f 语言切换 → 预览工具栏与 tab 标题同步重取词（回归：面板 chrome 惰性构建一次不刷词）
 *  - OG-2 欢迎页三步卡可见 + 指南链接可点
 *  - OG-3 有工作区时帮助菜单「欢迎页」→ overlay 完整版显示 → 点关闭恢复编辑器
 *  - OG-4 命令面板「新手指南」可达（打开指南）
 *  - OG-6 巡礼条目「试一下」（选 open_devtools）→ devtools 面板打开 + 条目变勾选 + 计数 1/6
 *  - OG-7 巡礼全部完成 → 折叠为一行 · 清 localStorage 后恢复
 *  - OG-8 问题面板空态改用 emptyState（断言含「ruff」教学文案）
 *  - OG-9 书签空态键位跟随（改键后文案变）
 *
 * mock 面：get_data_doc_path 双侧已映射（helpers plugins 通道），write_file 走 FS bridge 真实磁盘；
 * 落盘路径 = repo.root/docs/onboarding_guide.md（pluginsDir 未提供时）。
 * 注意：帮助菜单子菜单无 hover 竞态问题（help 一级即含「新手指南」，直接 click 菜单项）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, makePlainDir, type GitRepo } from "../helpers";

/** 启动到欢迎页（startEmpty：最近工作区为空 → 停在欢迎页）。
 *  #ew-new-project 可见只说明页面渲染，wireMenuBar / 键位接线 / 命令注册表在其后的 init 步骤——
 *  再等 invoke 流水出现 list_plugin_dirs（init 中段信号，plugins spec 同款等待）。 */
async function bootEmpty(page: Page, repo: GitRepo, locale?: string): Promise<void> {
  await equipPage(page, repo, { startEmpty: true });
  // 语言须先于页面脚本落 localStorage（键见 docs/i18n.md；默认 zh-CN）
  if (locale) await page.addInitScript((l) => localStorage.setItem("opencharm.locale", l), locale);
  await page.goto("/");
  await expect(page.locator("#ew-new-project")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log = (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
          return log.some((x) => x.startsWith("list_plugin_dirs")) ? 1 : 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(1);
}

/** 有工作区启动（默认路径：自动恢复最近工作区；等 Git 状态就绪 = init 后段完成） */
async function bootWorkspace(page: Page, repo: GitRepo): Promise<void> {
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

/** 点帮助菜单的指定项（menuBar 渲染的 #menu-dropdown，项 class .ctx-menu-item） */
async function clickHelpMenu(page: Page, itemText: string): Promise<void> {
  await page.locator('.menubar-item[data-menu="help"]').click();
  const item = page.locator('#menu-dropdown .ctx-menu-item', { hasText: itemText }).first();
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.click();
}

/** 经 state.ts 在页内执行源码（withApp 范式；参数须可序列化） */
function withApp(page: Page, src: string): Promise<unknown> {
  return page.evaluate(async (code) => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    return new Function("app", code)(app);
  }, src);
}

test.describe("OG-1/2：指南入口 + 欢迎页三步卡", () => {
  test("OG-1 帮助菜单「新手指南」→ md 打开且预览含「uv 速查卡」", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    await clickHelpMenu(page, "新手指南");
    // 落盘 + 打开：open_file_dev_plan 起 markdown_open_mode 默认 preview——
    // 指南（阅读场景）直接开纯预览 Tab（tab 名带「预览」后缀），内容即渲染结果，
    // 不再需要先开编辑 tab 再点分栏按钮。
    await expect(page.locator("#tabbar .tab.active .name", { hasText: "onboarding_guide.md" })).toContainText("预览", { timeout: 15_000 });
    await expect(page.locator("#md-preview-tab-panel")).toBeVisible();
    await expect(page.locator("#md-preview-tab-panel")).toContainText("uv 速查卡", { timeout: 10_000 });
    // 磁盘落盘（write_file 走真实 FS bridge）
    expect(repo.read("docs/onboarding_guide.md")).toContain("uv 速查卡");
  });

  test("OG-1b 帮助菜单「帮助文档」→ 内置手册落盘打开且预览含目录标题", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    await clickHelpMenu(page, "帮助文档");
    // 与 OG-1 同款落盘 + 预览；差别在正文来源是 public/help/（fetch 同源静态资源，非 ?raw 内联）
    await expect(page.locator("#tabbar .tab.active .name", { hasText: "opencharm-help.md" })).toContainText("预览", { timeout: 15_000 });
    await expect(page.locator("#md-preview-tab-panel")).toBeVisible();
    await expect(page.locator("#md-preview-tab-panel")).toContainText("快捷键总表", { timeout: 10_000 });
    expect(repo.read("docs/opencharm-help.md")).toContain("快捷键总表");
  });

  test("OG-1c 英文界面 → 帮助菜单取英文正文（opencharm-help.en.md）", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo, "en-US");

    await clickHelpMenu(page, "Help Documentation");
    // 语言路由：英文界面取 .en.md（中文界面取 opencharm-help.md，见 OG-1b）
    await expect(page.locator("#tabbar .tab.active .name", { hasText: "opencharm-help.en.md" })).toContainText("Preview", { timeout: 15_000 });
    await expect(page.locator("#md-preview-tab-panel")).toContainText("Keyboard Shortcuts", { timeout: 10_000 });
    expect(repo.read("docs/opencharm-help.en.md")).toContain("Keyboard Shortcuts");
  });

  test("OG-1d 中文目录锚点可跳转（回归：marked 百分号编码 href）", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    await clickHelpMenu(page, "帮助文档");
    await expect(page.locator("#md-preview-tab-panel")).toContainText("快捷键总表", { timeout: 15_000 });

    /** 「快捷键总表」标题是否落在视口内（不依赖具体滚动容器是谁） */
    const targetInView = () =>
      page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("#md-preview-tab-body [id]")).find((n) => n.id === "快捷键总表");
        if (!el) return -1;
        const r = el.getBoundingClientRect();
        return r.top >= -4 && r.top <= window.innerHeight - 40 ? 1 : 0;
      });

    expect(await targetInView()).toBe(0); // 章节在文档后段，初始不在视口

    const clicked = await page.evaluate(() => {
      const body = document.getElementById("md-preview-tab-body");
      if (!body) return "no-body";
      // marked 把中文 href 编码为 #%E5%…；这里按「解码后等于标题文本」定位目录链接
      const link = Array.from(body.querySelectorAll("a[href^='#']")).find(
        (a) => decodeURIComponent(a.getAttribute("href")!.slice(1)) === "快捷键总表",
      ) as HTMLAnchorElement | undefined;
      if (!link) return "no-link";
      link.click();
      return "clicked";
    });
    expect(clicked).toBe("clicked");

    await expect.poll(targetInView, { timeout: 6_000 }).toBe(1);
  });

  test("OG-1e 预览 Tab 右键「在终端中打开」→ 终端 cwd 为文档真实目录", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    await clickHelpMenu(page, "帮助文档");
    // 预览 Tab 的 path 是 `mdpreview:<绝对路径>`（虚拟命名空间）
    const tab = page.locator('#tabbar .tab[data-path^="mdpreview:"]');
    await expect(tab).toBeVisible({ timeout: 15_000 });

    await tab.click({ button: "right" });
    const item = page.locator("#ctx-menu .ctx-menu-item", { hasText: "在终端中打开" }).first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.click();

    // 回归判据（2026-10-11）：cwd 必须是文档真实所在目录。
    // 旧行为把 `mdpreview:C:\…\docs\a.md` 直接喂给 parentDirOf → `mdpreview:C:\…\docs` 不是
    // 目录 → portable-pty 的 current_directory() 静默回落 USERPROFILE → 终端开在**用户主目录**。
    await expect
      .poll(() => page.evaluate(() => ((window as unknown as { __E2E_TERM_SPAWNS__?: unknown[] }).__E2E_TERM_SPAWNS__ ?? []).length), { timeout: 10_000 })
      .toBeGreaterThan(0);
    const cwd = await page.evaluate(() => {
      const arr = (window as unknown as { __E2E_TERM_SPAWNS__: { cwd: string | null }[] }).__E2E_TERM_SPAWNS__;
      return arr[arr.length - 1].cwd;
    });
    expect(cwd).toBe(repo.abs("docs"));
    expect(cwd ?? "").not.toContain("mdpreview:");
  });

  test("OG-1f 语言切换后预览 Tab 工具栏与标题同步重取词", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    await clickHelpMenu(page, "帮助文档");
    const barBtn = page.locator(".md-preview-tab-toolbar button").first();
    await expect(barBtn).toHaveText("编辑源码", { timeout: 15_000 });
    await expect(page.locator("#tabbar .tab.active .name")).toContainText("预览");

    // 回归判据（2026-10-11）：md/csv/db 三个 Tab 面板的 chrome 是**惰性构建一次**的，
    // 构建时取词后就不再变；不给元素打 data-i18n 标记就会停在旧语言（applyDomI18n 只扫带标记的元素）。
    // 走设置面板的 select（change 监听在 init 时已挂，不必真的打开面板）。
    await page.evaluate(() => {
      const sel = document.getElementById("settings-locale") as HTMLSelectElement;
      sel.value = "en-US";
      sel.dispatchEvent(new Event("change"));
    });

    await expect(barBtn).toHaveText("Edit Source", { timeout: 10_000 });
    // tab 标题含语言包后缀（mdtab.labelSuffix）：main 的 renderTabs 也须在切换时重跑
    await expect(page.locator("#tabbar .tab.active .name")).toContainText("Preview");
    await expect(page.locator("#tabbar .tab.active .name")).not.toContainText("预览");
  });

  test("OG-2 欢迎页三步卡可见 + 指南链接可点", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    // 三步卡：三张卡 + 键位标签（运行脚本 Ctrl+F10 / 启动调试 F5 出厂值）
    const steps = page.locator("#ew-quickstart-steps .ew-qs-step");
    await expect(steps).toHaveCount(3);
    await expect(page.locator("#ew-quickstart-steps .ew-qs-step", { hasText: "运行脚本" }).locator("kbd")).toHaveText("Ctrl+F10");
    await expect(page.locator("#ew-quickstart-steps .ew-qs-step", { hasText: "启动调试" }).locator("kbd")).toHaveText("F5");
    // 巡礼区：6 条 + 计数 0/6
    await expect(page.locator("#ew-tour-body .ew-tour-item")).toHaveCount(6);
    await expect(page.locator("#ew-tour-count")).toHaveText("0/6 已体验");
    // 指南链接可点 → 打开指南 tab
    await page.locator("#ew-guide-link").click();
    await expect(page.locator("#tabbar .tab.active .name", { hasText: "onboarding_guide.md" })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("OG-3：force-show 欢迎页（有工作区）", () => {
  test("帮助菜单「欢迎页」→ overlay 完整版 → 点关闭恢复编辑器", async ({ page }) => {
    const repo = await makeGitRepo({ files: { "a.py": "print('a')\n" }, commitMsg: "baseline" });
    await bootWorkspace(page, repo);
    // 打开一个文件（activeTab 存在 → overlay 隐藏）
    await page.locator("#tree .tree-item .name", { hasText: "a.py" }).first().dblclick();
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#editor-overlay")).toBeHidden();

    // force-show：完整版 overlay（actions + quickstart + tour 全显 + force-close 可见）
    await clickHelpMenu(page, "欢迎页");
    await expect(page.locator("#editor-overlay")).toBeVisible();
    await expect(page.locator("#ew-actions")).toBeVisible();
    await expect(page.locator("#ew-quickstart")).toBeVisible();
    await expect(page.locator("#ew-tour-section")).toBeVisible();
    await expect(page.locator("#ew-force-close")).toBeVisible();

    // 关闭 → 恢复编辑器（force 解除，activeTab 仍在）
    await page.locator("#ew-force-close").click();
    await expect(page.locator("#editor-overlay")).toBeHidden();
    await expect(page.locator(".monaco-editor")).toBeVisible();

    // 再点帮助菜单「欢迎页」（toggle 语义：置位后再点 = 解除）
    await clickHelpMenu(page, "欢迎页");
    await expect(page.locator("#editor-overlay")).toBeVisible();
    await clickHelpMenu(page, "欢迎页");
    await expect(page.locator("#editor-overlay")).toBeHidden();
  });

  test("OG-3b force 欢迎页下打开文件 → 覆盖层自动解除（文件不被挡住）", async ({ page }) => {
    const repo = await makeGitRepo({
      files: { "a.py": "print('a')\n", "b.py": "print('b')\n" },
      commitMsg: "baseline",
    });
    await bootWorkspace(page, repo);
    await page.locator("#tree .tree-item .name", { hasText: "a.py" }).first().dblclick();
    await expect(page.locator("#editor-overlay")).toBeHidden();

    // force-show 完整版欢迎页：整层盖在编辑器上（回归前提）
    await clickHelpMenu(page, "欢迎页");
    await expect(page.locator("#editor-overlay")).toBeVisible();

    // 文件树打开另一个文件：激活内容即解除 force，新文件必须可见（曾整层被挡住）
    await page.locator("#tree .tree-item .name", { hasText: "b.py" }).first().dblclick();
    await expect(page.locator("#editor-overlay")).toBeHidden();
    await expect(page.locator("#tabbar .tab.active .name", { hasText: "b.py" })).toBeVisible();
    await expect(page.locator(".monaco-editor")).toBeVisible();
  });
});

test.describe("OG-4：命令面板「新手指南」", () => {
  test("Search Everywhere 命令模式搜「新手指南」→ 打开指南", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    // 命令面板直达（Ctrl+Shift+P）——浏览器键位由 browserKeys 护栏放行应用处理
    await page.keyboard.press("Control+Shift+P");
    await expect(page.locator("#quick-open-input")).toBeVisible({ timeout: 5_000 });
    await page.locator("#quick-open-input").fill("新手指南");
    const item = page.locator(".quick-open-item", { hasText: "新手指南" }).first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.click();
    await expect(page.locator("#tabbar .tab.active .name", { hasText: "onboarding_guide.md" })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("OG-6/7：功能巡礼", () => {
  test.beforeEach(async ({ page }) => {
    // 清巡礼完成态（localStorage 持久化，跨用例不污染）
    await page.addInitScript(() => {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith("opencharm.tour.")) localStorage.removeItem(k);
      } catch { /* 忽略 */ }
    });
  });

  test("OG-6 巡礼「试一下」（open_devtools）→ 面板打开 + 勾选 + 计数 1/6", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    // 点击 open_devtools 条目的「试一下」→ devtools 面板（picker）打开
    const row = page.locator("#ew-tour-body .ew-tour-item", { hasText: "工具箱" });
    await row.locator(".btn", { hasText: "试一下" }).click();
    await expect(page.locator("#devtools-picker")).toBeVisible({ timeout: 5_000 });
    // 条目变勾选（done 类）+ 计数 1/6
    await expect(row).toHaveClass(/done/);
    await expect(page.locator("#ew-tour-count")).toHaveText("1/6 已体验");
    // localStorage 已持久化
    const stored = await page.evaluate(() => localStorage.getItem("opencharm.tour.open_devtools"));
    expect(stored).toBe("1");
  });

  test("OG-7 全部完成 → 折叠为一行 · 重置后恢复", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await bootEmpty(page, repo);

    // 直接经页内 API 标记全部完成 + 重渲（6 条逐一「试一下」会真的开 6 个面板，不适合 e2e）
    await page.evaluate(async () => {
      const wg = (await import(/* @vite-ignore */ "/src/welcomeGuide.ts")) as any;
      for (const t of wg.TOUR_ITEMS) localStorage.setItem(`opencharm.tour.${t.quickOpenId}`, "1");
      wg.renderTour();
    });
    await expect(page.locator("#ew-tour-count")).toHaveText("6/6 已体验");
    // 全部完成条目淡化 + 勾选
    await expect(page.locator("#ew-tour-body .ew-tour-item.done")).toHaveCount(6);

    // 「全部完成，收起」→ 折叠为一行（collapsed 类 + body/foot 被 CSS 隐藏，DOM 不重建）
    await page.locator("#ew-tour-foot .ew-tour-fold", { hasText: "全部完成，收起" }).click();
    await expect(page.locator("#ew-tour-section")).toHaveClass(/collapsed/);
    await expect(page.locator("#ew-tour-body")).toBeHidden();
    await expect(page.locator("#ew-tour-foot")).toBeHidden();

    // 「重新体验」重置入口：折叠态标题行点击展开 → foot 出现「重新体验」→ 点击后全部恢复未完成
    await page.locator("#ew-tour-header").click();
    await expect(page.locator("#ew-tour-section")).not.toHaveClass(/collapsed/);
    await expect(page.locator("#ew-tour-body .ew-tour-item").first()).toBeVisible();
    await page.locator("#ew-tour-foot .ew-tour-fold", { hasText: "重新体验" }).click();
    await expect(page.locator("#ew-tour-count")).toHaveText("0/6 已体验");
    await expect(page.locator("#ew-tour-body .ew-tour-item.done")).toHaveCount(0);

    // 不感兴趣收起：点击后折叠，计数保持
    await page.locator("#ew-tour-foot .ew-tour-fold", { hasText: "不感兴趣，收起" }).click();
    await expect(page.locator("#ew-tour-section")).toHaveClass(/collapsed/);
    await expect(page.locator("#ew-tour-count")).toHaveText("0/6 已体验");
  });
});

test.describe("OG-8/9：空状态（S4）", () => {
  test("OG-8 问题面板空态含「ruff」教学文案", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await equipPage(page, repo);
    await page.goto("/");
    await page.locator("#tree .tree-item .name", { hasText: "a.py" }).first().dblclick();
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });

    // 打开问题面板（无 marker → 空态）
    await page.locator("#tab-problems").click();
    await expect(page.locator("#problems-panel")).toBeVisible();
    await expect(page.locator("#problems-panel .empty-state")).toContainText("没有发现问题");
    await expect(page.locator("#problems-panel .empty-state")).toContainText("ruff");
  });

  test("OG-9 书签空态键位跟随（改键后文案变）", async ({ page }) => {
    const repo = await makePlainDir({ "a.py": "x = 1\n" });
    await equipPage(page, repo);
    await page.goto("/");
    // 等 init 完成（书签 modal 由 initBookmarks 建立；书签弹窗是 wireBookmarks 动态创建的 host）
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const log = (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
            return log.some((x) => x.startsWith("list_plugin_dirs")) ? 1 : 0;
          }),
        { timeout: 20_000 },
      )
      .toBe(1);

    // 改 bookmark_toggle 键位 → 渲染书签列表空态 → 文案带新键
    await withApp(page, "app.settings.keybindings.bookmark_toggle = 'Ctrl+Alt+B';");
    await page.evaluate(async () => {
      const b = (await import(/* @vite-ignore */ "/src/bookmarks.ts")) as any;
      await b.openBookmarks();
    });
    const empty = page.locator(".empty-state", { hasText: "暂无书签" }).last();
    await expect(empty).toBeVisible({ timeout: 5_000 });
    await expect(empty).toContainText("Ctrl+Alt+B");
    await expect(empty).not.toContainText("Ctrl+F11");
  });
});
