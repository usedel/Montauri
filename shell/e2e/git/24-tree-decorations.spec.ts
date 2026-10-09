/**
 * E2E-24：文件树装饰（VSCode FileDecoration 机制借鉴批）
 *
 * A：.gitignore 忽略的目录/文件在树中灰显（.git-ignored），子树条目同样命中
 * B：ignored 条目不进 SCM 变更列表（不是变更）；目录不触发 dirty 高亮
 * C：有语法错误的打开文件在树中红名（.has-error），修复后颜色消失
 */
import { test, expect } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

test.beforeEach(async ({ page }) => {
  // ruff E 类规则映射为 error（默认 warning）——用例 C 需要红线（addInitScript 须在 goto 前）
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
      ruff_severity_e: "error",
    };
  });
  const repo: GitRepo = await makeGitRepo({
    files: { "main.py": "print('hello')\n" },
    commitMsg: "baseline",
  });
  // ignored 目录 + ignored 单文件（.gitignore 本身未跟踪 → 会出现在「更改」里，正常）
  repo.write(".gitignore", "node_modules/\n*.pyc\n");
  repo.write("node_modules/pkg.js", "");
  repo.write("build.pyc", "junk");
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
});

test("A：ignored 目录/文件灰显，子树条目同样命中", async ({ page }) => {
  await page.locator("#tab-files").click();
  // 根节点展开后的顶层条目：node_modules（ignored 目录）灰显
  const ignoredDir = page.locator(".tree-item", { hasText: "node_modules" }).first();
  await expect(ignoredDir).toHaveClass(/git-ignored/, { timeout: 10_000 });
  // ignored 单文件同样灰显
  const ignoredFile = page.locator(".tree-item", { hasText: "build.pyc" }).first();
  await expect(ignoredFile).toHaveClass(/git-ignored/, { timeout: 10_000 });
  // 展开目录后子项也命中（前缀匹配语义；pkg.js 非 dot 文件不受隐藏过滤影响）
  await ignoredDir.click();
  const child = page.locator(".tree-item", { hasText: "pkg.js" }).first();
  await expect(child).toHaveClass(/git-ignored/, { timeout: 10_000 });
  // 正常文件不灰显（main.py 已跟踪且干净；.gitignore 是 dot 文件默认不显示在树里）
  const normal = page.locator(".tree-item", { hasText: "main.py" }).first();
  await expect(normal).not.toHaveClass(/git-ignored/);
});

test("B：ignored 条目不进 SCM 列表、不触发目录 dirty 高亮", async ({ page }) => {
  await page.locator("#tab-git").click();
  // SCM 面板不含 node_modules / build.pyc
  await expect(page.locator("#git-changes .scm-item", { hasText: "node_modules" })).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("#git-changes .scm-item", { hasText: "build.pyc" })).toHaveCount(0);
  // .gitignore 自身（未跟踪）正常出现
  await expect(page.locator("#git-changes .scm-item", { hasText: ".gitignore" })).toHaveCount(1);
  // 树中根节点不带 dirty 高亮（ignored 不冒泡）
  await page.locator("#tab-files").click();
  const root = page.locator(".tree-item.tree-root");
  await expect(root).not.toHaveClass(/git-dirty/);
});

test("C：语法错误文件红名，修复后消失", async ({ page }) => {
  await page.locator("#tab-files").click();
  const item = page.locator(".tree-item", { hasText: "main.py" }).first();
  // 打开前无健康色
  await expect(item).not.toHaveClass(/has-error/, { timeout: 10_000 });

  // 预置 ruff error 诊断（真实链路：ruff_lint → setMarkers → onDidChangeMarkers →
  // problemsPanel 防抖 → syncTreeHealth → refreshTreeHealthClasses）
  await page.evaluate(() => {
    const w = window as unknown as { __E2E_RUFF_LINT__?: unknown };
    w.__E2E_RUFF_LINT__ = [{
      code: "E999", line: 1, column: 1, end_line: 1, end_column: 5,
      message: "SyntaxError: invalid syntax",
    }];
  });
  await item.dblclick();
  // 防抖 500ms + marker 传播，放宽等待
  await expect(item).toHaveClass(/has-error/, { timeout: 10_000 });

  // 修复：清预置 + 触发重查（切 tab 回来即 lintActiveFile）
  await page.evaluate(() => {
    const w = window as unknown as { __E2E_RUFF_LINT__?: unknown };
    w.__E2E_RUFF_LINT__ = [];
  });
  await page.locator("#tab-files").click();
  await item.dblclick();
  await expect(item).not.toHaveClass(/has-error/, { timeout: 10_000 });
});
