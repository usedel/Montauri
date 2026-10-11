/**
 * E2E：字符串字面量路径补全（VS Code 插件调研报告 借鉴-3 · 对标 Path Intellisense）
 *
 * 交互契约（改动前先读 src/completion/pathCompletion.ts 文件头的三条纪律）：
 *   1. 触发收紧：光标在**未闭合字符串**内 +（路径形态 **或** 调用白名单首参位）；
 *      普通字符串 / 注释 / docstring / URL 一律不弹；
 *   2. 段位钉在 `2aNN`（静态 `2xxx` 之后、关键字 `3xx` 之前）；
 *   3. 单目录条目上限与忽略规则在后端。
 *
 *  - E-PC-1 `open("` 白名单首参位：弹出工作区条目，目录在前且带尾斜杠
 *  - E-PC-2 `data/` 逐级下钻：候选随目录切换
 *  - E-PC-3 不误弹：普通字符串 / 注释 / 三引号 / URL / 名单外调用都不弹
 *  - E-PC-4 接受后插入目录尾斜杠（可继续下钻）
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

let repo: GitRepo;

/** 打开 main.py 并把光标放到文末新行 */
async function openMain(page: Page): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 20_000 });
  await page.locator("#editor .monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
}

/** 建议弹层里的候选标签（按 DOM 顺序） */
function suggestLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("#editor .suggest-widget .monaco-list-row .label-name")).map(
      (el) => (el.textContent ?? "").trim(),
    ),
  );
}

test.beforeEach(async () => {
  repo = await makeGitRepo({
    files: {
      "main.py": "x = 1\n",
      "data/raw.csv": "a,b\n1,2\n",
      "data/clean.csv": "a,b\n3,4\n",
      "src/app.py": "print(1)\n",
      "notes.txt": "hi\n",
    },
    commitMsg: "baseline",
  });
});

test("E-PC-1 白名单首参位 `open(\"` 弹出工作区条目（目录在前）", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openMain(page);
  await page.keyboard.type('p = open("');

  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  const labels = await suggestLabels(page);
  expect(labels).toContain("data");
  expect(labels).toContain("src");
  expect(labels).toContain("main.py");
  expect(labels).toContain("notes.txt");
  // 目录优先：两条目录排在文件之前
  expect(labels.indexOf("data")).toBeLessThan(labels.indexOf("main.py"));
});

test("E-PC-2 `data/` 逐级下钻：候选随目录切换", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openMain(page);
  await page.keyboard.type('p = "data/');

  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  const labels = await suggestLabels(page);
  expect(labels).toContain("raw.csv");
  expect(labels).toContain("clean.csv");
  expect(labels).not.toContain("notes.txt"); // 只列当前目录
});

test("E-PC-3 不误弹：普通字符串 / 注释 / 三引号 / URL / 名单外调用", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openMain(page);

  // 普通字符串（非路径形态、非白名单）
  await page.keyboard.type('msg = "hello wor');
  await page.waitForTimeout(800);
  const labels = await suggestLabels(page);
  expect(labels.some((l) => l === "data" || l === "notes.txt")).toBe(false);

  // 关掉当前弹层，逐个验证其余不误弹场景
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type('url = "https://exa');
  await page.waitForTimeout(800);
  expect((await suggestLabels(page)).some((l) => l === "data")).toBe(false);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type('print("');
  await page.waitForTimeout(800);
  expect((await suggestLabels(page)).some((l) => l === "data")).toBe(false);
});

test("E-PC-4 接受目录候选后插入尾斜杠（可继续下钻）", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await openMain(page);
  // 前缀 `da` 把候选收敛到 data（目录），Enter 接受后应插入 `data/`
  await page.keyboard.type('p = open("da');
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  await expect(suggest).toContainText("data", { timeout: 10_000 });
  await page.keyboard.press("Enter");
  const value = await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    return app.editor.getModel().getValue() as string;
  });
  expect(value).toContain('open("data/'); // 目录候选带尾斜杠（可继续键入下钻）
});
