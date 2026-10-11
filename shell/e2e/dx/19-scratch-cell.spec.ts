/**
 * E2E：Scratch / 单元格执行（VS Code 插件调研报告 借鉴-2 · 对标 Jupyter cell）
 *
 * 交互契约（改动前先读 src/scratch.ts 与 src-tauri/src/scratch_cmds.rs 文件头）：
 *   · 粒度：`# %%` 分隔的单元格，跑**当前**单元格（无分隔符 = 整个文件）；
 *   · 进程：按需起 + 空闲 5 分钟回收（ADR-0010 立项前提）；
 *   · 结果进「输出」面板。
 *
 * 浏览器侧无真实解释器：mock 回罐头输出 + 记录入参（__E2E_SCRATCH_LOG__），
 * 断言「发出去的源码恰好是当前单元格」（不夹带相邻单元格）——这是本功能的核心语义。
 *
 *  - E-SC-1 Ctrl+Enter 只跑光标所在单元格
 *  - E-SC-2 右键「停止 Scratch 会话」→ 发 action=stop
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const SRC = ["a = 1", "# %%", "b = 2", 'print("cell2")', "# %%", 'print("cell3")', ""].join("\n");

let repo: GitRepo;

async function scratchLog(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as any).__E2E_SCRATCH_LOG__ ?? []);
}

test.beforeEach(async () => {
  repo = await makeGitRepo({ files: { "cells.py": SRC }, commitMsg: "baseline" });
});

test("E-SC-1 Ctrl+Enter 只跑光标所在单元格", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await page.locator("#tree .tree-item .name", { hasText: "cells.py" }).first().dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 20_000 });

  // 光标落到第二个单元格内（第 3 行）
  await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.setPosition({ lineNumber: 3, column: 1 });
    app.editor.focus();
  });
  await page.keyboard.press("Control+Enter");

  const output = page.locator("#output");
  await expect(output).toContainText("[mock] b = 2", { timeout: 10_000 });
  await expect(output).toContainText("单元格 2-4", { timeout: 5_000 });

  const log = await scratchLog(page);
  const run = log.find((e) => e.action === "run");
  expect(run).toBeTruthy();
  // 核心语义：发出去的源码 = 当前单元格（不含第 1 行的 a = 1，也不含第 6 行的 cell3）
  expect(run!.code).toBe('b = 2\nprint("cell2")');
});

test("E-SC-2 右键「停止 Scratch 会话」→ 发 action=stop", async ({ page }) => {
  await equipPage(page, repo);
  await page.goto("/");
  await page.locator("#tree .tree-item .name", { hasText: "cells.py" }).first().dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 20_000 });
  await page.locator("#editor .monaco-editor").click();

  // 经 Monaco action 触发（右键菜单项即此 action；绕开菜单 DOM 的定位 flake，
  // 动作本身的存在性由 initScratch 的 addAction 保证）
  await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.getAction("opencharm.stopScratch").run();
  });

  const log = await scratchLog(page);
  expect(log.some((e) => e.action === "stop")).toBe(true);
  await expect(page.locator("#output")).toContainText("Scratch 会话已停止", { timeout: 5_000 });
});
