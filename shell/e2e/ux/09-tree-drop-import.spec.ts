/**
 * E2E（微交互批 T5）：外部文件拖入工作区（资源管理器 → 树）。
 *
 * D1：拖入单文件到树空白（落根）→ 写盘 + 树刷新可见 + toast「已导入」
 * D2：多文件批次 → importedMany 计数 toast + 全部落盘
 * D3：同名冲突 → 「 - 副本」策略（不覆盖既有文件）
 * D4：拖到目录条目 → 落子目录
 * D5：树内拖拽回归（text/plain 路径移动不受 T5 分支影响）
 *
 * 注：OS 级拖拽光标（copy + 号）无法在 Playwright 断言，走真机验证清单。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

const SRC = "print('hello')\n";

let repo: GitRepo;

test.beforeEach(async ({ page }) => {
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree")).toContainText("main.py", { timeout: 20_000 });
});

/** 在树上构造并 dispatch drop 事件（Files 载荷；目标选择器） */
async function dispatchFileDrop(page: Page, selector: string, files: { name: string; content: string }[]): Promise<void> {
  await page.evaluate(
    ({ sel, fileSpecs }) => {
      const target = document.querySelector(sel);
      if (!target) throw new Error(`target not found: ${sel}`);
      const dt = new DataTransfer();
      for (const spec of fileSpecs) {
        dt.items.add(new File([spec.content], spec.name, { type: "application/octet-stream" }));
      }
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    { sel: selector, fileSpecs: files },
  );
}

test("D1：拖入单文件到树空白（落根）→ 写盘 + 树刷新 + toast", async ({ page }) => {
  await dispatchFileDrop(page, "#tree", [{ name: "dropped.py", content: "x = 1\n" }]);

  await expect(page.locator(".toast--success", { hasText: "dropped.py" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#tree .tree-item", { hasText: "dropped.py" })).toBeVisible({ timeout: 10_000 });
});

test("D2：多文件批次 → 计数 toast + 全部落盘", async ({ page }) => {
  await dispatchFileDrop(page, "#tree", [
    { name: "a.txt", content: "aaa" },
    { name: "b.txt", content: "bbb" },
  ]);
  await expect(page.locator(".toast--success", { hasText: "2" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#tree .tree-item", { hasText: "a.txt" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#tree .tree-item", { hasText: "b.txt" })).toBeVisible({ timeout: 10_000 });
});

test("D3：同名冲突 → 「 - 副本」不覆盖既有文件", async ({ page }) => {
  await dispatchFileDrop(page, "#tree", [{ name: "main.py", content: "OVERWRITTEN?" }]);
  await expect(page.locator(".toast--success")).toBeVisible({ timeout: 10_000 });
  // 树中出现「main - 副本.py」（unique_target 策略；既有 main.py 保留）
  await expect(page.locator("#tree .tree-item", { hasText: "main - 副本" })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#tree .tree-item", { hasText: "main.py" })).toHaveCount(1, { timeout: 10_000 });
});

test("D4：拖到目录条目 → 落子目录", async ({ page }) => {
  // spec 侧真实建子目录（Node fs），reload 后树里可见
  repo.write("pkg/.keep", "");
  await page.reload();
  await expect(page.locator("#tree")).toContainText("pkg", { timeout: 20_000 });

  await dispatchFileDrop(page, "#tree .tree-item.dir", [{ name: "inner.py", content: "y = 2\n" }]);
  await expect(page.locator(".toast--success", { hasText: "inner.py" })).toBeVisible({ timeout: 10_000 });
  // 展开 pkg 验证文件落在子目录
  const pkg = page.locator("#tree .tree-item.dir", { hasText: "pkg" }).first();
  await pkg.click();
  await expect(page.locator("#tree .tree-item", { hasText: "inner.py" })).toBeVisible({ timeout: 10_000 });
});

test("D5：树内拖拽回归（text/plain 移动不受 T5 影响）", async ({ page }) => {
  repo.write("pkg/.keep", "");
  await page.reload();
  await expect(page.locator("#tree")).toContainText("pkg", { timeout: 20_000 });

  const main = page.locator("#tree .tree-item", { hasText: "main.py" }).first();
  const pkg = page.locator("#tree .tree-item.dir", { hasText: "pkg" }).first();
  const mBox = await main.boundingBox();
  const pBox = await pkg.boundingBox();
  expect(mBox).toBeTruthy();
  expect(pBox).toBeTruthy();
  if (mBox && pBox) {
    await page.mouse.move(mBox.x + mBox.width * 0.3, mBox.y + mBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(pBox.x + pBox.width * 0.5, pBox.y + pBox.height * 0.5, { steps: 5 });
    await page.mouse.up();
  }
  await expect(page.locator("#tree .tree-item", { hasText: "main.py" })).toHaveCount(0, { timeout: 10_000 });
  await pkg.click();
  await expect(page.locator("#tree .tree-item", { hasText: "main.py" })).toBeVisible({ timeout: 10_000 });
});
