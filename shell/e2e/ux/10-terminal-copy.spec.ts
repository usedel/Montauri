/**
 * E2E：终端 Ctrl+C 的 VSCode 语义（有选区复制 / 无选区中断）。
 *
 * 根因（修在 terminal.ts::attachCustomKeyEventHandler + terminalKeys.ts，勿回退）：
 *   xterm.js 默认把 Ctrl+C 变成 \x03（ETX / SIGINT）写进 PTY，并 cancel(keydown) 阻断
 *   浏览器原生 copy 事件 → 选中运行输出后按 Ctrl+C 既没复制、也没有任何可见反馈。
 *   停止按钮的优雅退出同样依赖 \x03（termUi::stopRunInstanceById），因此不能把 Ctrl+C
 *   整体改成复制：按「有无选区」分流。
 *
 * 判据：① 有选区 → copy_to_clipboard 收到选区文本、term_write 不含 \x03；
 *       ② 无选区 → term_write 含 \x03、不产生复制记录；
 *       ③ Ctrl+Shift+C 仍走 xterm 原生复制路径（不发 \x03）；
 *       ④ 重新输入使选区消失后语义切回中断（同一实例内状态切换）。
 *
 * ⚠ 拖选后必须先断言 .xterm-selection 真的有子节点：坐标漂移时「没复制」会是假阴性
 *   （与 ux/05 滚动条用例同款几何前置判据）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo } from "../helpers";

/** 灌进 xterm 缓冲的首行输出（供鼠标拖选） */
const LINE = "COPY_ME_123";

interface Box { x: number; y: number; width: number; height: number }

const TEXTAREA = ".terminal-view:not(.hidden) .xterm-helper-textarea";
const ROWS = ".terminal-view:not(.hidden) .xterm-rows";

const copied = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __E2E_COPIED__?: string[] }).__E2E_COPIED__ ?? []);
const writes = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __E2E_TERM_WRITES__?: string[] }).__E2E_TERM_WRITES__ ?? []);
const selectionCount = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelector(".terminal-view:not(.hidden) .xterm-selection")?.childElementCount ?? 0);

/** 打开工作区 → 切终端 tab → 经 term-data 灌一行已知文本；返回首行包围盒 */
async function setup(page: Page): Promise<Box> {
  const repo = await makeGitRepo({ files: { "main.py": "print('hi')\n" } });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });

  await page.locator("#tab-terminal").click();
  await expect(page.locator(".terminal-view:not(.hidden) .xterm-viewport")).toBeVisible({ timeout: 15_000 });

  // 浏览器 mock 没有真实 PTY：直接分发 term-data（会话 id 由 createTerminal 分配，首个为 term-1）
  await page.evaluate((line) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { __emit?: (e: string, p: unknown) => void } }).__TAURI_INTERNALS__;
    internals?.__emit?.("term-data", { id: "term-1", data: line + "\r\n" });
  }, LINE);
  await expect
    .poll(() => page.evaluate((sel) => document.querySelector<HTMLElement>(sel)?.textContent ?? "", ROWS), { timeout: 10_000 })
    .toContain(LINE);

  const box = await page.locator(`${ROWS} > div`).first().boundingBox();
  expect(box, "终端首行未渲染，无法拖选").not.toBeNull();
  return box!;
}

/** 在首行拖出选区，并确认 xterm 真的形成了选区（防坐标漂移假阴性） */
async function selectFirstLine(page: Page, box: Box): Promise<void> {
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 102, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => selectionCount(page), { timeout: 5_000 }).toBeGreaterThan(0);
  await page.locator(TEXTAREA).focus();
}

test("有选区 Ctrl+C → 复制选区文本，且不向 PTY 发中断信号", async ({ page }) => {
  const box = await setup(page);
  await selectFirstLine(page, box);
  await page.keyboard.press("Control+c");

  await expect.poll(async () => (await copied(page)).at(-1) ?? "", { timeout: 10_000 }).toContain(LINE);
  expect(await writes(page), "有选区时不应写 \\x03（否则运行中会误中断程序）").not.toContain("\x03");
});

test("无选区 Ctrl+C → 仍写 \\x03（中断 / 优雅停止），不产生复制记录", async ({ page }) => {
  await setup(page);
  await page.locator(TEXTAREA).focus();
  await page.keyboard.press("Control+c");

  await expect.poll(() => writes(page), { timeout: 10_000 }).toContain("\x03");
  expect(await copied(page), "无选区不应触发复制").toEqual([]);
});

test("Ctrl+Shift+C → 不发 \\x03（xterm 原生复制路径保持）", async ({ page }) => {
  const box = await setup(page);
  await selectFirstLine(page, box);
  await page.keyboard.press("Control+Shift+c");

  // 无头 Chromium 不保证派发浏览器原生 copy 事件，故只锁「不误发中断」这一条不变量；
  // 真机剪贴板内容由发布前手测补验。
  await page.waitForTimeout(150);
  expect(await writes(page)).not.toContain("\x03");
});

test("重新输入使选区消失后 Ctrl+C → 语义在同一实例内切回中断", async ({ page }) => {
  const box = await setup(page);
  await selectFirstLine(page, box);

  // xterm SelectionService 订阅 onUserInput：任意输入都会 clearSelection。
  // 不用鼠标单击清选区——单击只重置 selectionStart，DOM 渲染层仍可能画出零宽选区
  // （实测 .xterm-selection 仍有 2 个子节点，会变成假阴性）。
  await page.keyboard.press("x");
  await expect.poll(() => selectionCount(page), { timeout: 5_000 }).toBe(0);
  const before = (await writes(page)).length;

  await page.keyboard.press("Control+c");
  await expect.poll(async () => (await writes(page)).slice(before), { timeout: 10_000 }).toContain("\x03");
});
