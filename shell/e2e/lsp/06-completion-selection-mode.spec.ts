/**
 * P0-C　软/硬选中（`suggest.selectionMode`）与 Tab 接受路径 E2E。
 *
 * 守护的配置（`main.ts` create 块）：`suggest.selectionMode = "whenTriggerCharacter"` ——
 * 「自动打字 = 软选中（不抢输入，Enter 必为换行）/ 触发字符与显式触发 = 硬选中」。
 *
 * ## 四取值实测矩阵（2026-10-08 一次性 spike 探针，结论已固化进配置）
 *
 * | selectionMode        | S1 自动打字 | S2 触发字符 `.` | S3 显式 Alt+/ | S4 模板 `for` |
 * |----------------------|------------|----------------|--------------|--------------|
 * | 默认（= `always`）    | 硬·接受     | 硬·接受        | 硬·接受      | 硬·展开      |
 * | `always`             | 硬·接受     | 硬·接受        | 硬·接受      | 硬·展开      |
 * | `never`              | 软·换行     | 软·换行        | **硬·接受**  | 软·换行      |
 * | `whenTriggerCharacter` | **软·换行** | **硬·接受**    | **硬·接受**  | 软·换行 ⚠   |
 * | `whenQuickSuggestion`  | 硬·接受     | 软·换行        | 硬·接受      | 硬·展开      |
 *
 * 两条关键机制（`suggestController.js:216-233`，别再重读源码）：
 *   · `selectionMode` **只在 `triggerOptions.auto === true` 时**生效 → 显式触发恒硬选中
 *     （官方 option 文档同义：「a suggestion is always selected when explicitly invoked」）。
 *     故选 `whenTriggerCharacter` **不牺牲显式触发**（开发计划里的 ⚠spike 假设已被推翻）。
 *   · `noFocus` → `list.setFocus([])`（`suggestWidget.js:452`）→ 面板无 `.monaco-list-row.focused`。
 *
 * ⚠ S4 代价与补偿：live-template 也走自动打字 → 一并失去预选，Enter 换行（零误插入的主诉求）。
 * 补偿 = `accept_suggestion_replace` 的软选中分支（`keybindingDefaults.ts` 的 `softWhen`/`softCommand`）：
 * 面板可见且无聚焦项时 Tab → Monaco 原生 `focusAndAcceptSuggestion`（聚焦并接受首项）。
 * C-4 钉这条，C-5 钉「面板关闭时 Tab 不得被吞（缩进不受影响）」。
 *
 * 断言读法：行序以「Ctrl+S 落盘后读磁盘」为权威（`05-completion-insert-edits.spec.ts` 纪律）。
 * Tab 缩进一类断言必须**在 Tab 后再输一个 `Z`**——保存时格式化会裁掉行尾空白，
 * 首轮探针因此误判为「Tab 被吞」（已修正，见 C-5 注释）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const LIB_PY = [
  "def add_score(a, b):",
  '    """Return the sum of two integers."""',
  "    return a + b",
  "",
].join("\n");

/** 刻意**不** import add_score：让 autoImport provider 在输入 `add_sc` 时有候选（S1 用） */
const MAIN_PY = ['s = "hello"', ""].join("\n");

async function boot(page: Page): Promise<GitRepo> {
  const repo = await makeGitRepo({
    files: { "lib.py": LIB_PY, "main.py": MAIN_PY },
    commitMsg: "baseline",
  });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await page.locator("#tree .tree-item .name", { hasText: "lib.py" }).first().dblclick();
  await expect(page.locator("#status-file")).toContainText("lib.py", { timeout: 10_000 });
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator("#status-file")).toContainText("main.py", { timeout: 10_000 });
  return repo;
}

/** 面板弹出并返回「是否有聚焦项」（软选中 = 无 `.monaco-list-row.focused`） */
async function waitSuggest(page: Page, wantFocused: boolean): Promise<void> {
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  // focused 行数即「硬选中」信号（软选中时 list.setFocus([]) → 一行都没有）
  const focused = page.locator("#editor .suggest-widget .monaco-list-row.focused");
  if (wantFocused) await expect(focused.first()).toBeVisible({ timeout: 5_000 });
  else await expect(focused).toHaveCount(0, { timeout: 5_000 });
}

/** 光标落到文末新行并返回该行输入前的定位动作 */
async function newLine(page: Page): Promise<void> {
  await page.locator("#editor .monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
}

/** Ctrl+S 落盘后读磁盘（行序权威真源） */
async function readMain(page: Page, repo: GitRepo): Promise<string> {
  await page.keyboard.press("Control+S");
  await page.waitForTimeout(600);
  return repo.read("main.py").replace(/\r\n/g, "\n");
}

test("C-1 自动打字（软选中）：面板无聚焦项，Enter 换行不误插入", async ({ page }) => {
  const repo = await boot(page);
  await newLine(page);
  await page.keyboard.type("add_sc");
  // autoImport 索引异步构建：首查若未就绪 provider 返回空且停止打字后不再 retrigger → 补一次重输
  if (!(await page.locator("#editor .suggest-widget").isVisible().catch(() => false))) {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(1_500);
    await page.keyboard.type("c");
  }
  await waitSuggest(page, false); // 软选中：无聚焦项

  await page.keyboard.press("Enter");
  const content = await readMain(page, repo);
  expect(content, "软选中下 Enter 必须换行，不得插入候选").toContain("add_sc");
  expect(content, "不得插入 autoImport 候选").not.toContain("add_score");
  expect(content, "不得顺带插入 import").not.toContain("from lib import add_score");
});

test("C-2 触发字符（硬选中）：`s.` 后 Enter 接受首项", async ({ page }) => {
  const repo = await boot(page);
  await newLine(page);
  await page.keyboard.type("s.");
  await waitSuggest(page, true); // 触发字符 = 硬选中
  await expect(page.locator("#editor .suggest-widget")).toContainText("upper");

  await page.keyboard.press("Enter");
  const content = await readMain(page, repo);
  expect(content).toContain("s.upper");
});

test("C-3 显式触发（Alt+/）：恒硬选中，Enter 接受模板", async ({ page }) => {
  const repo = await boot(page);
  await newLine(page);
  await page.keyboard.type("for");
  await waitSuggest(page, false); // 自动打字段：软选中（本用例要对比的是显式触发段）
  await page.keyboard.press("Escape"); // 先关掉自动弹出的面板，再显式触发
  await page.waitForTimeout(200);
  await page.keyboard.press("Alt+/"); // → editor.action.triggerSuggest（auto=false）
  await waitSuggest(page, true); // selectionMode 不作用于显式触发 → 硬选中

  await page.keyboard.press("Enter");
  const content = await readMain(page, repo);
  expect(content, "显式触发下 Enter 应展开模板").toContain("for item in items:");
});

test("C-4 软选中补偿：输 `for` 后 Tab 展开模板（focusAndAcceptSuggestion 分支）", async ({ page }) => {
  const repo = await boot(page);
  await newLine(page);
  await page.keyboard.type("for");
  await waitSuggest(page, false); // 软选中（模板同属自动打字，同样不预选）

  await page.keyboard.press("Tab");
  const content = await readMain(page, repo);
  expect(content, "软选中态 Tab 应聚焦并接受首项（展开模板）").toContain("for item in items:");
});

test("C-5 面板关闭时 Tab 仍缩进（软选中规则不得误吞 Tab）", async ({ page }) => {
  const repo = await boot(page);
  await newLine(page);
  await page.keyboard.type("for");
  await waitSuggest(page, false);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.keyboard.press("Tab");
  // Tab 后必须再输 Z：保存格式化会裁掉行尾空白（`for    ` → `for`），只按 Tab 测不出来
  await page.keyboard.type("Z");

  const content = await readMain(page, repo);
  expect(
    content,
    "面板关闭时 Tab 必须仍是缩进（缩进落在 for 与 Z 之间，不会被格式化裁掉）",
  ).toMatch(/^for\s+Z$/m);
});

test("C-6 硬选中态 Tab 仍走替换接受（有聚焦项分支未被软选中分支抢走）", async ({ page }) => {
  const repo = await boot(page);
  await newLine(page);
  await page.keyboard.type("s.");
  await waitSuggest(page, true);

  await page.keyboard.press("Tab");
  const content = await readMain(page, repo);
  expect(content, "有聚焦项时 Tab 应被 accept_suggestion_replace 接管并接受首项").toContain("s.upper");
});