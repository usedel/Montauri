/**
 * E2E：保存时动作（保存时整理导入 / 保存时格式化）的**正向**覆盖
 *
 * 背景（为什么补这套用例）：此前 `optimize_imports` / `format_python` 在 mock 里恒返回
 * `formatted: null`，唯一相关断言是 autosave/01 的 A-S-3——它只验证「命令被调用过」的时序，
 * **从不验证结果有没有真的写回模型和磁盘**。于是「ruff 没装 / 结果没应用」这类静默失效
 * 在 e2e 层完全测不出来（2026-10-10 用户报「保存时整理导入没生效」即由此漏网）。
 *
 * 本 spec 经 mock 的 `__E2E_OPTIMIZE_IMPORTS__` / `__E2E_FORMAT_PYTHON__` 预置「整理/格式化后
 * 的全文」，断言内容真的落到缓冲区与磁盘：
 *  - S-1 整理导入开：Ctrl+S → 模型与磁盘都变成整理后内容（不是原编辑内容）
 *  - S-2 整理导入关：Ctrl+S → 不调用 optimize_imports，磁盘保留原编辑内容（负向对照）
 *  - S-3 两个都开：先整理后格式化（与 PyCharm 同序），最终内容为格式化结果
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

/** 源文件：含未使用导入 + 乱序（像被真实 ruff 整理过的样子） */
const SRC = "import sys\nimport os\nfrom typing import List\n\nprint(os, sys)\n";

/** 预置「整理导入」的返回全文（mock 不接真 ruff，直接回这个串） */
const OPTIMIZED = "import os\nimport sys\n\nprint(os, sys)\n";
/** 预置「格式化」的返回全文 */
const FORMATTED = "FORMATTED = True\n";

let repo: GitRepo;
const pageErrors: string[] = [];

/** 预置设置覆写（addInitScript，先于应用启动生效） */
async function presetSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript((s) => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: unknown }).__E2E_SETTINGS_PRESET__ = s;
  }, settings);
}

/**
 * 预置保存动作的返回（string = 成功全文；`{formatted,message}` = 原样返回，用于失败路径；
 * 不预置 = mock 默认 null 失败）
 */
async function presetSaveResult(page: Page, key: string, value: string | Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([k, v]) => {
      (window as unknown as Record<string, unknown>)[k as string] = v;
    },
    [key, value] as const,
  );
}

/** mock 记录的 install_toolchain 入参（"all" 或 "ruff" 之类） */
function installs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __E2E_TOOLCHAIN_INSTALLS__?: string[] }).__E2E_TOOLCHAIN_INSTALLS__ ?? [],
  );
}

/** invoke 命令流水（mock 记录，形如 "write_file(path,content)"） */
function invocations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? []),
  );
}

/** 当前激活 tab 的缓冲区内容（模型真身，而非 DOM 文本） */
function activeModelValue(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    return String(app.activeTab?.model?.getValue() ?? "");
  });
}

/** 打开文件 + 末尾追加标记行（产生 dirty） */
async function openAndEdit(page: Page, file: string, marker: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: file }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.setPosition({ lineNumber: 9999, column: 1 });
    app.editor.focus();
  });
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n${marker}\n`);
  await expect(page.locator("#tabbar .tab.active .dirty")).toBeVisible({ timeout: 5_000 });
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("S-1 保存时整理导入：结果真的写回缓冲区与磁盘", async ({ page }) => {
  await presetSettings(page, { optimize_imports_on_save: true, format_on_save: false });
  await presetSaveResult(page, "__E2E_OPTIMIZE_IMPORTS__", OPTIMIZED);
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openAndEdit(page, "main.py", "# EDITED");

  await page.keyboard.press("Control+s");

  // 磁盘真身 = 整理后内容（含编辑标记已被整理结果整体替换，这正是 ruff 全量返回的语义）
  await expect.poll(() => repo.read("main.py"), { timeout: 8_000 }).toBe(OPTIMIZED);
  // 缓冲区同步（否则下次保存会覆盖回去）
  await expect.poll(() => activeModelValue(page), { timeout: 5_000 }).toBe(OPTIMIZED);
  // 命令流水确有 optimize_imports
  expect((await invocations(page)).some((l) => l.startsWith("optimize_imports("))).toBe(true);
  // dirty 清除
  await expect(page.locator("#tabbar .tab.active .dirty")).toBeHidden({ timeout: 5_000 });
});

test("S-2 开关关闭：不调用整理导入，磁盘保留原编辑内容", async ({ page }) => {
  await presetSettings(page, { optimize_imports_on_save: false, format_on_save: false });
  await presetSaveResult(page, "__E2E_OPTIMIZE_IMPORTS__", OPTIMIZED);
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openAndEdit(page, "main.py", "# NOT-OPTIMIZED");

  await page.keyboard.press("Control+s");

  // 磁盘是「原内容 + 编辑」，不是整理结果
  await expect.poll(() => repo.read("main.py"), { timeout: 8_000 }).toContain("# NOT-OPTIMIZED");
  await expect.poll(() => repo.read("main.py"), { timeout: 5_000 }).toBe(`${SRC}\n# NOT-OPTIMIZED\n`);
  expect((await invocations(page)).some((l) => l.startsWith("optimize_imports("))).toBe(false);
});

test("S-3 两个开关都开：先整理后格式化，最终为格式化结果", async ({ page }) => {
  await presetSettings(page, { optimize_imports_on_save: true, format_on_save: true });
  await presetSaveResult(page, "__E2E_OPTIMIZE_IMPORTS__", OPTIMIZED);
  await presetSaveResult(page, "__E2E_FORMAT_PYTHON__", FORMATTED);
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openAndEdit(page, "main.py", "# BOTH");

  await page.keyboard.press("Control+s");

  // ruff format 不重排导入，二者正交；顺序固定为「先整理、再格式化」（与 PyCharm 一致）
  await expect.poll(() => repo.read("main.py"), { timeout: 8_000 }).toBe(FORMATTED);
  const log = await invocations(page);
  const oi = log.findIndex((l) => l.startsWith("optimize_imports("));
  const fp = log.findIndex((l) => l.startsWith("format_python("));
  expect(oi).toBeGreaterThanOrEqual(0);
  expect(fp).toBeGreaterThan(oi); // 整理先于格式化
});

test("S-4 ruff 缺席（RuffMissing 分类码）：弹 toast 提示且不阻断保存", async ({ page }) => {
  await presetSettings(page, { optimize_imports_on_save: true, format_on_save: false });
  await presetSaveResult(page, "__E2E_OPTIMIZE_IMPORTS__", {
    formatted: null,
    message: "RuffMissing:无法启动 ruff（可能未安装）：e2e",
  });
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openAndEdit(page, "main.py", "# RUFF-ABSENT");

  await page.keyboard.press("Control+s");

  // 失败可见：过去只往输出面板写一行（面板没开 = 完全看不到），现在弹 toast
  const err = page.locator(".toast--error").first();
  await expect(err).toBeVisible({ timeout: 8_000 });
  await expect(err).toContainText("ruff");
  // 不阻断保存：磁盘仍是原编辑内容
  await expect.poll(() => repo.read("main.py"), { timeout: 8_000 }).toBe(`${SRC}\n# RUFF-ABSENT\n`);

  // 会话内只弹一次：再存一次不得叠加第二条（避免每次 Ctrl+S 刷屏）
  await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as any;
    app.editor.focus();
  });
  await page.keyboard.type("x = 1\n");
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(1_000);
  await expect(page.locator(".toast--error")).toHaveCount(1, { timeout: 3_000 });
});

test("S-5 提示里的「安装 ruff」按钮：忽略首启引导后的补装入口，走按件安装", async ({ page }) => {
  await presetSettings(page, { optimize_imports_on_save: true, format_on_save: false });
  await presetSaveResult(page, "__E2E_OPTIMIZE_IMPORTS__", {
    formatted: null,
    message: "RuffMissing:无法启动 ruff（可能未安装）：e2e",
  });
  repo = await makePlainDir({ "main.py": SRC });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree .tree-item .name").first()).toBeVisible({ timeout: 20_000 });

  await openAndEdit(page, "main.py", "# INSTALL-FROM-TOAST");
  await page.keyboard.press("Control+s");

  const err = page.locator(".toast--error").first();
  await expect(err).toBeVisible({ timeout: 8_000 });
  await err.locator(".toast-action").click();

  // 按件安装：only=["ruff"]（不是全量，不会顺带重装 uv / 静态引擎）
  await expect.poll(async () => installs(page), { timeout: 10_000 }).toEqual(["ruff"]);
});
