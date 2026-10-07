/**
 * P0-D 接受补全时的叠加编辑（additionalTextEdits）E2E。
 *
 * 守护对象：接受一个带「头部插 import」附加编辑的候选后——
 *   1. import 落地且**只出现一次**、落在文件头（不错位、不重复）；
 *   2. 补全文本落在光标处、**光标停在插入文本之后**（不是行首、不是 import 行）。
 *
 * ## 已核实的 Monaco 0.52.2 机制（`suggestController.js:275-360`，别再重读源码）
 *
 * accept 时 `additionalTextEdits` 有两条应用路径：
 *   · **同步路径**：accept 时 `item.isResolved === true`（Monaco 在条目获得焦点时就会触发
 *     resolve，见 `suggestWidget.js:312`）→ 立即 `executeEdits('...sync')`，**随后**才插主文本
 *     → 光标最终停在主文本之后 ✓
 *   · **异步路径**：accept 时还没 resolve 完（`resolveDelayMs` 构造此时序）→ 先插主文本，
 *     resolve 完成后再 `executeEdits('...async')` 补附加编辑 → **光标会跳到 import 行尾**
 *     （Monaco 原生行为，不是丢编辑）。所以 D-e2 只断言「import 落地且唯一」，不断言光标。
 *
 * 若 D-e2 失败（import 丢了）= 实锤「accept 先于 resolve 丢编辑」bug；
 * 修复方向见计划 §3 P0-D：确认 accept 前 resolve 的实证行为 / 引擎侧 upfront 下发。
 *
 * ## 断言读法（两个实测坑，别再踩）
 *
 *   · 逐行读 `.view-line` / 读 `.view-lines` 的 textContent 在本机曾出现**行序错乱/读不到**
 *     （Monaco 虚拟渲染 + DOM 复用），**不能当行序真源**。行序断言一律：Ctrl+S 落盘后
 *     `repo.read()` 读磁盘（权威）；「编辑器里有没有」这类即时断言用
 *     `expect(locator("#editor .view-lines")).toContainText(...)`。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const LIB_PY = [
  "def add_score(a, b):",
  '    """Return the sum of two integers."""',
  "    return a + b",
  "",
].join("\n");

const MAIN_PY = [
  "from lib import add_score",
  "",
  's = "hello"',
  "",
  "total = add_score(2, 3)",
  "",
].join("\n");

/** 附加编辑：文件头（第 1 行行首）插 `import json\n`（LSP 0-based 坐标） */
const IMPORT_EDIT = {
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  newText: "import json\n",
};

const EXTRA_ITEMS = [
  {
    label: "dump_json",
    kind: 3, // LSP Function
    detail: "json tool",
    insertText: "dump_json",
    additionalTextEdits: [IMPORT_EDIT],
  },
];

interface LspPreset {
  completionExtraItems?: typeof EXTRA_ITEMS;
  resolveOnlyLabel?: string;
  resolveDelayMs?: number;
}

async function boot(
  page: Page,
  repo: GitRepo,
  preset: LspPreset,
): Promise<void> {
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_LSP_PRESET__?: LspPreset }).__E2E_LSP_PRESET__ = p;
  }, preset);
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await page.locator("#tree .tree-item .name", { hasText: "lib.py" }).first().dblclick();
  await expect(page.locator("#status-file")).toContainText("lib.py", { timeout: 10_000 });
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator("#status-file")).toContainText("main.py", { timeout: 10_000 });
}

/** 光标落到文末新行，输入 dump_json，Ctrl+Space 触发补全面板 */
async function triggerSuggest(page: Page): Promise<void> {
  await page.locator("#editor .monaco-editor").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("dump_json");
  await page.keyboard.press("Control+Space");
  const suggest = page.locator("#editor .suggest-widget");
  await expect(suggest).toBeVisible({ timeout: 10_000 });
  // 首行即目标候选（exact 前缀得分最高）
  await expect(suggest.locator(".monaco-list-row").first()).toContainText("dump_json", {
    timeout: 10_000,
  });
}

/** 保存当前缓冲并断言磁盘上的 main.py：import json 恰好一次且在文件头 */
async function assertImportOnDisk(page: Page, repo: GitRepo): Promise<void> {
  // 先等编辑器缓冲出现（D-e2 的异步路径要 ~resolveDelayMs 才补编辑）
  await expect(page.locator("#editor .view-lines")).toContainText("import json", {
    timeout: 8_000,
  });
  // Ctrl+S 落盘后读磁盘（行序权威真源）
  await page.keyboard.press("Control+S");
  let content = "";
  await expect
    .poll(async () => {
      content = repo.read("main.py");
      return content;
    }, { timeout: 10_000 })
    .toContain("import json");
  const hits = content.match(/import json/g)?.length ?? 0;
  expect(hits, `import json 应恰好出现一次，实际：\n${content}`).toBe(1);
  expect(content.startsWith("import json\n"), `import 应在文件头，实际：\n${content}`).toBe(true);
}

test("D-e1 upfront 附加编辑：接受后 import 落在文件头且唯一，光标停在插入文本之后", async ({
  page,
}) => {
  const repo = await makeGitRepo({
    files: { "lib.py": LIB_PY, "main.py": MAIN_PY },
    commitMsg: "baseline",
  });
  await boot(page, repo, { completionExtraItems: EXTRA_ITEMS });
  await triggerSuggest(page);
  await page.keyboard.press("Enter");

  // 光标探针：接受后立即输入，ZZ 必须紧跟在补全文本之后（同步路径：附加编辑先于主文本应用）
  await page.keyboard.type("ZZ");
  await expect(page.locator("#editor .view-lines")).toContainText("dump_jsonZZ", {
    timeout: 5_000,
  });

  await assertImportOnDisk(page, repo);
});

test("D-e2 未 resolve 直接接受（慢 resolve 800ms）：import 仍须落地", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "lib.py": LIB_PY, "main.py": MAIN_PY },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    completionExtraItems: EXTRA_ITEMS,
    resolveOnlyLabel: "dump_json",
    resolveDelayMs: 800,
  });
  await triggerSuggest(page);
  // 刻意不等详情/resolve 落定就 Enter —— 走 Monaco 的异步附加编辑路径
  await page.keyboard.press("Enter");

  await assertImportOnDisk(page, repo);
  // 主文本仍在
  await expect(page.locator("#editor .view-lines")).toContainText("dump_json", {
    timeout: 5_000,
  });
});
