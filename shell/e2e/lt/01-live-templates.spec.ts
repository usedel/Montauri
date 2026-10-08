/**
 * E2E：Live Templates 用户旅程（本轮改进批 8，2026-10-08）
 *
 *  - E-LT-1 Tab 直接展开：模块层语句位键入 ifmain + Tab → if __name__ 守卫骨架
 *  - E-LT-2 位置轴门控：def 头名字位（def main|）+ Tab → 不展开（默认 tab）；空行语句位 → 展开
 *  - E-LT-3 后缀补全：键入 表达式.if → 补全弹窗出现 if expr 项；接受后转换为 if 块
 *  - E-LT-4 环绕模板：选区 + Ctrl+Alt+T → 选择器弹层 → try 包裹
 *  - E-LT-5 模板面板：Ctrl+J → palette 弹层 → 过滤 ifmain → Enter 插入
 *
 * 全部走真实键盘事件，覆盖 tabExpand precondition / 位置轴 classifyPosition /
 * `.` 分流 buildPostfixItems / palette 过滤的完整链路。
 * 关键竞态认知（记忆 ID 25672754 同源）：CodeLens view zone 会改变行视口位置，
 * 故不按 (line-1)*lineHeight 算坐标，一律 model API 定位 + editor.setPosition。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

const SRC = "alpha = 1\nbeta = 2\n";

let repo: GitRepo;
const pageErrors: string[] = [];

function modelValue(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    return app.editor.getModel()?.getValue() ?? "";
  });
}

async function caret(page: Page, line: number, column: number): Promise<void> {
  await page.evaluate(
    async ([l, c]) => {
      const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
      app.editor.setPosition({ lineNumber: l as number, column: c as number });
      app.editor.focus();
    },
    [line, column] as const,
  );
  // 焦点未就绪时 keyboard.type 前几个字符会被丢（E-LT-3 实测：`.` 丢失 → 弹窗不出现）
  await expect(page.locator(".monaco-editor textarea")).toBeFocused({ timeout: 5_000 });
}

/** 键入文本到当前光标（真实键盘逐字符，走 IME 组合门控链路） */
async function type(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text, { delay: 10 });
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("E-LT-1 Tab 直接展开：模块层语句位 ifmain + Tab → __main__ 守卫", async ({ page }) => {
  // 光标到第 3 行行首（模块层空行语句位）
  await caret(page, 3, 1);
  await type(page, "ifmain");
  await page.keyboard.press("Tab");
  await expect
    .poll(async () => modelValue(page), { timeout: 5_000 })
    .toContain('if __name__ == "__main__":');
});

test("E-LT-2 位置轴门控：名字位不展开，语句位展开", async ({ page }) => {
  // 名字位：键入 def main 后光标在 main 词内（名字位）——main 模板不得展开
  await caret(page, 3, 1);
  await type(page, "def main");
  await page.keyboard.press("Tab");
  let v = await modelValue(page);
  expect(v).not.toContain("def main($");
  // 名字位 Tab 应保持默认行为（缩进或无变化），值不得出现 main 函数模板体
  expect(v).not.toContain("def main():\n");

  // 语句位：清空重来，模块层空行键入 main + Tab → main 函数模板
  const src = SRC;
  await page.evaluate(async (text) => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.getModel().setValue(text);
  }, src);
  await caret(page, 3, 1);
  await type(page, "main");
  await page.keyboard.press("Tab");
  await expect
    .poll(async () => modelValue(page), { timeout: 5_000 })
    .toContain("def main(");
});

test("E-LT-3 后缀补全：表达式.if → if 块转换", async ({ page }) => {
  // beta = 2 行后追加一行 `beta`，随后 `.if` 触发后缀补全
  const withBeta = SRC + "beta";
  await page.evaluate(async (text) => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.getModel().setValue(text);
  }, withBeta);
  await caret(page, 3, 5); // 行尾（beta 之后）
  await type(page, ".if");
  // 后缀补全项进入弹窗（triggerCharacters "." + 前缀过滤）
  const widget = page.locator(".suggest-widget");
  await expect(widget).toBeVisible({ timeout: 10_000 });
  // 接受（Tab 在「面板可见 + 无聚焦项」软选中分支 = focusAndAcceptSuggestion；
  // 有聚焦项时也是 accept——两分支都能接受）
  await page.keyboard.press("Tab");
  await expect
    .poll(async () => modelValue(page), { timeout: 5_000 })
    .toContain("if beta:");
});

test("E-LT-4 环绕模板：选区 Ctrl+Alt+T → try 包裹", async ({ page }) => {
  // 选中 alpha = 1 整行
  await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    const monaco = app.monaco;
    app.editor.setSelection(new monaco.Selection(1, 1, 1, 10));
    app.editor.focus();
  });
  await page.keyboard.press("Control+Alt+T");
  const modal = page.locator("#surround-modal");
  await expect(modal).toBeVisible({ timeout: 5_000 });
  // 列表项含 try（数字键或点击均可；用点击稳妥）
  await modal.locator(".surround-item", { hasText: "try" }).first().click();
  await expect
    .poll(async () => modelValue(page), { timeout: 5_000 })
    .toContain("try:");
  await expect
    .poll(async () => modelValue(page), { timeout: 5_000 })
    .toContain("except");
});

test("E-LT-5 模板面板：Ctrl+J 打开 → 过滤 → Enter 插入", async ({ page }) => {
  await caret(page, 3, 1);
  await page.keyboard.press("Control+J");
  const modal = page.locator("#palette-modal");
  await expect(modal).toBeVisible({ timeout: 5_000 });
  const input = modal.locator("#palette-search");
  await expect(input).toBeFocused();
  await type(page, "ifmain");
  // 过滤后列表只剩 ifmain 一项（选中态）
  await expect
    .poll(async () => modal.locator(".palette-item").count(), { timeout: 5_000 })
    .toBe(1);
  await page.keyboard.press("Enter");
  await expect(modal).toBeHidden({ timeout: 5_000 });
  await expect
    .poll(async () => modelValue(page), { timeout: 5_000 })
    .toContain('if __name__ == "__main__":');
});
