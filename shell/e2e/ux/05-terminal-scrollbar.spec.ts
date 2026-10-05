/**
 * E2E：终端面板的原生滚动条可被拖动（用户报「运行脚本后，终端面板里的滚动条无法拖动」）。
 *
 * 根因（修在 terminal.ts 构造器 + style.css .term-host，勿回退）：
 *   FitAddon 读的是 **xterm 元素的父元素** 的 getComputedStyle().width/height，只扣 xterm 自身
 *   padding；而 .terminal-view 带视觉内边距（6/8/6/12）且全局 `* { box-sizing: border-box }`
 *   下 border-box 元素的 computed width 是**边框盒**宽 → cols/rows 按 1280×188 算，
 *   而真实可用是 1260×176 → canvas 1272×180 越出 .xterm-viewport，.xterm-screen（DOM 渲染器，
 *   行 div 带 overflow:hidden）正好压住 viewport 右侧那条 8px 原生滚动条 → 鼠标按下落在行 div 上，
 *   滚动条收不到拖拽（滚轮仍可用：wheel 是 xterm 自己监听 element 的，不经滚动条）。
 *
 * 本用例锁两条判据：
 *   A. 几何不变式：.xterm-screen 不得越出 .xterm-viewport 的右/下缘（越出即压住滚动条）；
 *   B. 行为：在滚动条竖带上真实按下-拖动，viewport.scrollTop 必须变化（滚轮那条路径单独对照）。
 *
 * ⚠ 必须去掉 playwright 默认的 `--hide-scrollbars`（见下方 test.use）：它把滚动条变成 overlay
 *   （不占布局宽、不可命中），会让判据 A/B 都恒假。
 */
import { test, expect } from "@playwright/test";
import { equipPage, makeGitRepo } from "../helpers";

test.use({ launchOptions: { args: ["--no-proxy-server"], ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("终端面板 · 滚动条不被屏幕层压住且可拖动", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "print('hi')\n" } });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });

  // 切到终端 tab：面板此刻已可见 → ensureAnyTerminal 建交互 shell（与 shell 终端同一路径）
  await page.locator("#tab-terminal").click();
  const vp = page.locator(".terminal-view:not(.hidden) .xterm-viewport");
  await expect(vp).toBeVisible({ timeout: 15_000 });

  // 浏览器 mock 没有真实 PTY：经 term-data 事件灌入输出制造滚动条（会话 id 由 createTerminal 分配）
  await page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { __emit?: (e: string, p: unknown) => void } }).__TAURI_INTERNALS__;
    const data = Array.from({ length: 300 }, (_, i) => `line ${String(i).padStart(3, "0")}\r\n`).join("");
    internals?.__emit?.("term-data", { id: "term-1", data });
  });
  await expect
    .poll(() => page.evaluate(() => document.querySelector<HTMLElement>(".terminal-view:not(.hidden) .xterm-viewport")!.scrollHeight), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // ── 判据 A：几何不变式 ──
  const geom = await page.evaluate(() => {
    const view = document.querySelector<HTMLElement>(".terminal-view:not(.hidden)")!;
    const v = view.querySelector<HTMLElement>(".xterm-viewport")!;
    const s = view.querySelector<HTMLElement>(".xterm-screen")!;
    const rv = v.getBoundingClientRect();
    const rs = s.getBoundingClientRect();
    return {
      overflowRight: +(rs.right - rv.right).toFixed(1),
      overflowBottom: +(rs.bottom - rv.bottom).toFixed(1),
      screen: `${s.style.width} × ${s.style.height}`,
      viewport: `${v.clientWidth} × ${v.clientHeight}`,
      hasHost: !!view.querySelector(".term-host"),
    };
  });
  expect(geom.hasHost, "终端宿主层 .term-host 缺失（FitAddon 会量到带 padding 的 .terminal-view）").toBe(true);
  expect(geom.overflowRight, `.xterm-screen 越出 viewport 右缘 ${geom.overflowRight}px（screen=${geom.screen} / viewport=${geom.viewport}）——会压住滚动条`).toBeLessThanOrEqual(0.5);
  expect(geom.overflowBottom, `.xterm-screen 越出 viewport 下缘 ${geom.overflowBottom}px（screen=${geom.screen} / viewport=${geom.viewport}）——末行被裁`).toBeLessThanOrEqual(0.5);

  // ── 判据 B：真实拖动滚动条 ──
  const box = (await vp.boundingBox())!;
  const x = box.x + box.width - 4; // 8px 宽的滚动条，取靠右 4px 处
  const scrollTop = (): Promise<number> =>
    page.evaluate(() => document.querySelector<HTMLElement>(".terminal-view:not(.hidden) .xterm-viewport")!.scrollTop);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".terminal-view:not(.hidden) .xterm-viewport")!.scrollTop = 0;
  });
  await page.waitForTimeout(150);
  expect(await scrollTop(), "预置：滑块应已回到轨道顶端").toBe(0);

  await page.mouse.move(x, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 132, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await scrollTop(), "拖动滚动条后 viewport.scrollTop 应变化（拖不动 = 被屏幕层压住）").toBeGreaterThan(0);
});
