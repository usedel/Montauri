/**
 * E2E：外部改动检测（docs/fs_watch_dev_plan.md v0.1，E-EXT-1..9）
 *
 * 背景：磁盘上的文件被**别的程序**改掉（git checkout / 外部编辑器 / 生成器）时，已打开的
 * tab 既不重载也不提示，用户 Ctrl+S 会静默覆盖外部改动 → 改动不可恢复。
 *
 * 链路：Rust watcher.rs 的 notify 防抖后 emit `fs-file-changed`（文件绝对路径数组）
 *       → externalChange.ts 读盘比对（content 代替事件类型；天然吞掉自身保存回声）
 *       → identical 清脏 / reload 自动重载 / conflict 三选一面板 / unreadable 只提示。
 *
 * mock 侧的真实度说明：`fs-file-changed` 由本 spec 按需手工 emit（PT-9 同款 __emit 通道），
 * 因为 helpers 的 FS_WRITE_CMDS 自动推送**故意**不扩到本事件——那会让所有「bridge 改盘 +
 * 编辑器开着的文件」的既有 spec 行为变化（自动重载/弹面板），属另一次有意的对齐。
 */
import { test, expect, type Page } from "@playwright/test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { equipPage, makeGitRepo, makePlainDir, type GitRepo } from "../helpers";

const V1 = "alpha = 1\nprint('v1')\n";
const V2_OUTSIDE = "alpha = 1\nprint('changed by another program')\n";

const pageErrors: string[] = [];

/** 读当前活动编辑器模型文本 */
function modelText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    return app.editor.getModel().getValue() as string;
  });
}

/** tab 上的脏圆点（.tab .dirty 下的 codicon 子元素）：0 个 = 干净 */
function dirtyDots(page: Page) {
  return page.locator(".tab .dirty > *");
}

/**「待裁决」外部改动标记（externalChange.ts 插入的 warning codicon） */
function externalFlags(page: Page) {
  return page.locator(".tab .tab-external-flag");
}

/** 手工 emit Rust watcher 的文件级事件（payload = 文件绝对路径数组） */
async function emitFsFileChanged(page: Page, paths: string[]): Promise<void> {
  await page.evaluate((p) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { __emit?: (e: string, p: unknown) => void } }).__TAURI_INTERNALS__;
    internals?.__emit?.("fs-file-changed", p);
  }, paths);
}

/** 另存为对话框预置（plugin-dialog 的 save 由 mock 读 window.__E2E_DIALOG_PRESET__.save） */
async function presetSavePath(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    (window as unknown as { __E2E_DIALOG_PRESET__?: { save?: string } }).__E2E_DIALOG_PRESET__ = { save: p };
  }, path);
}

async function openMain(page: Page): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => await modelText(page), { timeout: 10_000 }).toBe(V1);
}

/** 在编辑器里敲几个字（把 tab 弄脏，模拟用户有未保存修改） */
async function dirtyTheEditor(page: Page): Promise<void> {
  await page.locator(".monaco-editor").click();
  await page.keyboard.type("# my edit");
  await expect.poll(async () => (await dirtyDots(page)).count(), { timeout: 5_000 }).toBe(1);
}

/** 三选一面板的三个按钮（ok 是 #confirm-ok，neutral 是动态插入的普通按钮，cancel 是 #confirm-cancel） */
const panel = (page: Page) => page.locator("#confirm-modal");
const btnOk = (page: Page) => page.locator("#confirm-ok");
const btnCancel = (page: Page) => page.locator("#confirm-cancel");
const btnNeutral = (page: Page) => page.locator("#confirm-modal .modal-actions button.btn:not(#confirm-ok):not(#confirm-cancel)");

let repo: GitRepo;

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  repo = await makePlainDir({ "main.py": V1, "b.py": "b = 1\n", "notes.md": "# doc\n" });
  await equipPage(page, repo);
  await page.goto("/");
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

// ---------- E-EXT-1：未脏 tab → 外部写盘 → 自动重载，无对话框，圆点保持干净 ----------

test("E-EXT-1 未脏 tab 外部改动 → 自动重载且不弹面板（dirty 复位，plan §4.7）", async ({ page }) => {
  await openMain(page);
  repo.write("main.py", V2_OUTSIDE);
  await emitFsFileChanged(page, [join(repo.root, "main.py")]);

  // 自动重载：模型内容变成磁盘内容
  await expect.poll(async () => await modelText(page), { timeout: 10_000 }).toBe(V2_OUTSIDE);
  // 没有对话框
  await expect(panel(page)).toBeHidden();
  // 圆点没被带上（setValue 会触发统一置脏点；dirty 复位守卫把它按回去——§4.7 陷阱的视觉钉子）
  await expect(dirtyDots(page)).toHaveCount(0);
  await expect(page.locator(".tab[aria-selected='true']")).not.toHaveAttribute("aria-label", /已修改/);
});

// ---------- E-EXT-2/3：脏 tab → 外部写盘 → 三选一面板；选重载 → 磁盘版本 ----------

test("E-EXT-2 脏 tab 外部改动 → 弹三选一面板 + tab 待裁决标记", async ({ page }) => {
  await openMain(page);
  await dirtyTheEditor(page);
  repo.write("main.py", V2_OUTSIDE);
  await emitFsFileChanged(page, [join(repo.root, "main.py")]);

  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#confirm-message")).toContainText("main.py");
  await expect(externalFlags(page)).toHaveCount(1); // 待裁决标记
  // 视觉钉子：标记元素必须保留 codicon 类（glyph 渲染的唯一来源）。只数 DOM 个数抓不到
  // 「className 被重写、元素在但图标是空的」这类视觉崩（本项目历史事故同款）。
  await expect(page.locator(".tab .tab-external-flag.codicon-warning")).toHaveCount(1);
  await expect(page.locator(".tab-external")).toHaveCount(1);
  await expect(btnOk(page)).toHaveText("另存为…");
  await expect(btnCancel(page)).toHaveText("稍后处理");
});

test("E-EXT-3 面板选「用磁盘版本重载」→ 采用磁盘内容并清标记", async ({ page }) => {
  await openMain(page);
  await dirtyTheEditor(page);
  const mine = await modelText(page);
  repo.write("main.py", V2_OUTSIDE);
  await emitFsFileChanged(page, [join(repo.root, "main.py")]);
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });

  await btnNeutral(page).click();
  await expect(panel(page)).toBeHidden();
  await expect.poll(async () => await modelText(page), { timeout: 10_000 }).toBe(V2_OUTSIDE);
  expect(mine).not.toBe(V2_OUTSIDE); // 前置：确实丢掉了我的版本（用户在知情下显式选择）
  await expect(externalFlags(page)).toHaveCount(0);
  await expect(dirtyDots(page)).toHaveCount(0);
});

// ---------- E-EXT-4：稍后处理 → Ctrl+S 弹保存语义面板 → 覆盖磁盘 ----------

test("E-EXT-4 「稍后处理」后 Ctrl+S → 保存语义面板 → 用我的版本覆盖磁盘", async ({ page }) => {
  await openMain(page);
  await dirtyTheEditor(page);
  const mine = await modelText(page);
  repo.write("main.py", V2_OUTSIDE);
  await emitFsFileChanged(page, [join(repo.root, "main.py")]);
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });

  await btnCancel(page).click(); // 稍后处理：缓冲原样保留
  await expect(panel(page)).toBeHidden();
  expect(await modelText(page)).toBe(mine);

  // 保存拦截（plan §4.6）：按钮语义切换为「用我的版本覆盖磁盘」
  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+s");
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
  await expect(btnOk(page)).toHaveText("用我的版本覆盖磁盘");
  await expect(btnCancel(page)).toHaveText("取消保存");
  await btnOk(page).click();
  await expect(panel(page)).toBeHidden();

  // 磁盘 == 我的版本（没被外部内容吃掉），且 tab 变干净
  await expect.poll(() => repo.read("main.py"), { timeout: 10_000 }).toBe(mine);
  await expect(dirtyDots(page)).toHaveCount(0);
  await expect(externalFlags(page)).toHaveCount(0);
});

// ---------- E-EXT-5：自身保存的回声不弹面板（§4.3 的天然抑制器） ----------

test("E-EXT-5 自身保存的回声 → identical → 不弹任何面板", async ({ page }) => {
  await openMain(page);
  await dirtyTheEditor(page);
  const mine = await modelText(page);

  await page.locator(".monaco-editor").click();
  await page.keyboard.press("Control+s");
  await expect(dirtyDots(page)).toHaveCount(0); // 保存完成
  // 显式保存带保存清理（final newline）：落盘内容 == 保存后的模型内容（不是保存前的 mine）
  const saved = await modelText(page);
  expect(saved.trimEnd()).toBe(mine.trimEnd());
  expect(repo.read("main.py")).toBe(saved);

  // 真实环境里 notify 此刻一定会因为「文件刚刚被写」而推一条事件——照搬同一输入
  await emitFsFileChanged(page, [repo.abs("main.py")]);
  await page.waitForTimeout(600); // 给异步链留足处理窗口
  await expect(panel(page)).toBeHidden();
  await expect(externalFlags(page)).toHaveCount(0);
  expect(await modelText(page)).toBe(saved);
});

// ---------- E-EXT-6：读盘失败只提示，不关 tab（§4.3） ----------

test("E-EXT-6 文件被删/不可读 → 只 toast 提示，不自动关 tab", async ({ page }) => {
  await openMain(page);
  rmSync(join(repo.root, "main.py"));
  await emitFsFileChanged(page, [join(repo.root, "main.py")]);

  await expect(page.locator(".toast", { hasText: "main.py" })).toBeVisible({ timeout: 10_000 });
  await expect(panel(page)).toBeHidden(); // 不弹决策面板
  // tab 仍在（不误关），编辑区还显示原内容
  await expect(page.locator(".tab")).toHaveCount(1);
  expect(await modelText(page)).toBe(V1);
});

// ---------- E-EXT-7：虚拟 tab 不参与（md 预览） ----------

test("E-EXT-7 md 预览 tab 的同名文件外部改动 → 不弹面板、不插标记", async ({ page }) => {
  await page.locator("#tree .tree-item .name", { hasText: "notes.md" }).first().dblclick();
  await expect.poll(async () => await page.locator(".tab").count(), { timeout: 10_000 }).toBe(1);
  await expect(page.locator(".tab")).toHaveAttribute("title", /notes\.md$/);

  repo.write("notes.md", "# doc changed by outside\n");
  await emitFsFileChanged(page, [repo.abs("notes.md")]);
  await page.waitForTimeout(600);

  await expect(panel(page)).toBeHidden();
  await expect(externalFlags(page)).toHaveCount(0);
});

// ---------- E-EXT-8：另存为…（保住我的版本，原 tab 不动） ----------

test("E-EXT-8 冲突面板选「另存为…」→ 写到新路径，原 tab 与磁盘都不动", async ({ page }) => {
  await openMain(page);
  await dirtyTheEditor(page);
  const mine = await modelText(page);
  repo.write("main.py", V2_OUTSIDE);
  await emitFsFileChanged(page, [join(repo.root, "main.py")]);
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });

  const targetRel = "mine/main (我的版本).py";
  await presetSavePath(page, repo.abs(targetRel));
  await btnOk(page).click();

  // 新路径内容 == 我的缓冲（runOnSaveActions=false，未被保存清理改写）
  await expect.poll(() => repo.read(targetRel), { timeout: 10_000 }).toBe(mine);
  // 原 tab 仍是我的版本、仍脏；磁盘仍是外部内容（没被覆盖）
  expect(await modelText(page)).toBe(mine);
  expect(repo.read("main.py")).toBe(V2_OUTSIDE);
  await expect(dirtyDots(page)).toHaveCount(1);
  await expect(page.locator(".toast", { hasText: "已另存为" })).toBeVisible({ timeout: 10_000 });
});

// ---------- E-EXT-9：一批多文件事件（git checkout 类风暴）串行处理不崩 ----------

test("E-EXT-9 一批多文件事件 → 串行处理，各自落到自己的 tab", async ({ page }) => {
  await openMain(page);
  await page.locator("#tree .tree-item .name", { hasText: "b.py" }).first().dblclick();
  await expect.poll(async () => await page.locator(".tab").count(), { timeout: 10_000 }).toBe(2);

  repo.write("main.py", "main = 'outside'\n");
  repo.write("b.py", "b = 'outside'\n");
  await emitFsFileChanged(page, [repo.abs("main.py"), repo.abs("b.py")]);

  await expect(panel(page)).toBeHidden();
  await expect(page.locator(".toast", { hasText: "已被删除" })).toHaveCount(0);
  // 活动 tab（b.py，第二个打开的）被自动重载
  await expect.poll(async () => await modelText(page), { timeout: 10_000 }).toBe("b = 'outside'\n");
  // main.py tab 同样被重载，且都没插待裁决标记
  await page.locator(".tab", { hasText: "main.py" }).first().click();
  await expect.poll(async () => await modelText(page), { timeout: 10_000 }).toBe("main = 'outside'\n");
  await expect(externalFlags(page)).toHaveCount(0);
});
