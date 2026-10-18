/**
 * E2E：行内诊断文案（VS Code 插件调研报告 借鉴-1 · 对标 Error Lens）
 *
 * 交互契约（改动前先读 src/inlineDiagnostics.ts 文件头的四条噪音纪律）：
 *   1. 只显示 error(8) / warning(4)——info / hint 不上屏；
 *   2. 只显示**光标行 ± 2 行**——全量行尾文案 + 严格模式 = 噪音墙；
 *   3. 单行截断、不换行、不撑行高；
 *   4. 设置项且**默认关**。
 *
 *  - E-DX-ID1 默认关：注入 marker 后无行尾文案（噪音纪律 4）
 *  - E-DX-ID2 开 → 光标落到诊断行：行尾出现消息 + 级别 class
 *  - E-DX-ID3 窗口约束：仅光标行 ± 2 行（窗口外的诊断不上屏）
 *  - E-DX-ID4 info / hint 不上屏（噪音纪律 1）
 *  - E-DX-ID5 同行多条折叠为「主文案 +N」；error 压过 warning；同级取最左
 *  - E-DX-ID6 关掉开关即时清空
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

const SRC = Array.from({ length: 20 }, (_, i) => `v${i} = ${i}`).join("\n") + "\n";

let repo: GitRepo;

/** 注入 marker（owner montauri-lsp，与 handleDiagnostics 同一落点） */
async function inject(page: Page, markers: unknown[]): Promise<void> {
  await page.evaluate(async (ms) => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.monaco.editor.setModelMarkers(app.editor.getModel(), "montauri-lsp", ms as any[]);
  }, markers);
}

/** 光标落到指定行（触发 onDidChangeCursorPosition → 刷新） */
async function cursorTo(page: Page, line: number): Promise<void> {
  await page.evaluate(async (ln) => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.setPosition({ lineNumber: ln, column: 1 });
    app.editor.focus();
  }, line);
}

/** 上屏的行尾文案（text + 级别 class）。
 *  Monaco 把空白渲染成 U+00A0，比对前归一为普通空格（否则断言里出现「看起来一样」的假失败）。 */
function inlineTexts(page: Page): Promise<Array<{ text: string; cls: string }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".oc-inline-diag")).map((el) => ({
      text: (el.textContent ?? "").replace(/ /g, " ").trim(),
      cls: el.className,
    })),
  );
}

/** 打开样例 py 文件 */
async function openPy(page: Page): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: "id.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
}

test.beforeEach(async () => {
  repo = await makePlainDir({ "id.py": SRC });
});

test.describe("默认关（噪音纪律 4）", () => {
  test.beforeEach(async ({ page }) => {
    await equipPage(page, repo);
    await page.goto("/");
    await openPy(page);
  });

  test("E-DX-ID1 默认关：注入 marker 也不上屏", async ({ page }) => {
    await inject(page, [
      { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 3, severity: 8, message: "boom" },
    ]);
    await cursorTo(page, 5);
    await page.waitForTimeout(400);
    expect(await inlineTexts(page)).toEqual([]);
  });
});

test.describe("开启（经 __E2E_SETTINGS_PRESET__ 预置）", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
        inline_diagnostics: true,
      };
    });
    await equipPage(page, repo);
    await page.goto("/");
    await openPy(page);
  });

  test("E-DX-ID2 光标落到诊断行：行尾出现消息 + 级别 class", async ({ page }) => {
    await inject(page, [
      { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 3, severity: 8, message: "Expected int" },
      { startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: 3, severity: 4, message: "May be unused" },
    ]);
    await cursorTo(page, 5);
    await expect
      .poll(async () => (await inlineTexts(page)).map((d) => d.text), { timeout: 5_000 })
      .toEqual(["Expected int", "May be unused"]);
    const texts = await inlineTexts(page);
    expect(texts[0].cls).toContain("oc-inline-diag--error");
    expect(texts[1].cls).toContain("oc-inline-diag--warning");
  });

  test("E-DX-ID3 窗口约束：只渲染光标行 ± 2 行", async ({ page }) => {
    // 1 / 5 / 9 / 13 行各一条 error：光标在 5 时只有 3~7 行窗口内的 5 上屏
    await inject(page, [
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3, severity: 8, message: "line-one" },
      { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 3, severity: 8, message: "line-five" },
      { startLineNumber: 9, startColumn: 1, endLineNumber: 9, endColumn: 3, severity: 8, message: "line-nine" },
      { startLineNumber: 13, startColumn: 1, endLineNumber: 13, endColumn: 3, severity: 8, message: "line-thirteen" },
    ]);
    await cursorTo(page, 5);
    await expect
      .poll(async () => (await inlineTexts(page)).map((d) => d.text), { timeout: 5_000 })
      .toEqual(["line-five"]);
    // 光标移到 7：窗口 5~9 → 5 与 9 上屏，1 与 13 仍不上屏
    await cursorTo(page, 7);
    await expect
      .poll(async () => (await inlineTexts(page)).map((d) => d.text), { timeout: 5_000 })
      .toEqual(["line-five", "line-nine"]);
  });

  test("E-DX-ID4 info / hint 不上屏", async ({ page }) => {
    await inject(page, [
      { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 3, severity: 2, message: "just info" },
      { startLineNumber: 6, startColumn: 1, endLineNumber: 6, endColumn: 3, severity: 1, message: "just hint" },
    ]);
    await cursorTo(page, 5);
    await page.waitForTimeout(400);
    expect(await inlineTexts(page)).toEqual([]);
  });

  test("E-DX-ID5 同行折叠 +N；error 压过 warning；同级取最左", async ({ page }) => {
    await inject(page, [
      // 行 5：三条（一条 warning 在最左，两条 error 在右）→ 主文案取 error 中最左者
      { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 2, severity: 4, message: "warn-left" },
      { startLineNumber: 5, startColumn: 8, endLineNumber: 5, endColumn: 9, severity: 8, message: "err-right" },
      { startLineNumber: 5, startColumn: 4, endLineNumber: 5, endColumn: 5, severity: 8, message: "err-mid" },
    ]);
    await cursorTo(page, 5);
    await expect
      .poll(async () => (await inlineTexts(page)).map((d) => d.text), { timeout: 5_000 })
      .toEqual(["err-mid +2"]);
    expect((await inlineTexts(page))[0].cls).toContain("oc-inline-diag--error");
  });

  test("E-DX-ID6 关掉开关即时清空", async ({ page }) => {
    await inject(page, [
      { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 3, severity: 8, message: "boom" },
    ]);
    await cursorTo(page, 5);
    await expect.poll(async () => (await inlineTexts(page)).length, { timeout: 5_000 }).toBe(1);
    // 运行时关开关（与设置面板保存后同一条 refresh 路径）
    await page.evaluate(async () => {
      const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
      app.settings.inline_diagnostics = false;
    });
    await cursorTo(page, 6);
    await expect.poll(async () => (await inlineTexts(page)).length, { timeout: 5_000 }).toBe(0);
  });
});
