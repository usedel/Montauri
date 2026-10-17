/**
 * E2E：pytest 测试运行器（docs/pytest_dev_plan.md，浏览器 mock 层）。
 *
 *  - PT-1 打开测试视图 → scan 文件骨架先行 → collect 用例子节点增强（文件 → 类 → 用例）
 *  - PT-2 树行 ▶ → run_in_terminal 以 kind="test" 调用（path = node id，零新命令）
 *  - PT-3 term-exit → result 读取 → 状态合入（行 class / 失败计数 / 失败文件自动展开）
 *  - PT-4 重跑失败：一次调用传多个 node id（换行拼接）
 *  - PT-5 pytest 未安装三态（missing_module + 安装引导按钮）
 *  - PT-6 收集错误三态（error_tail 原文 + 重试）
 *  - PT-7 绿箭头：测试文件 def 行装饰 + 点击运行；非测试文件不武装
 *  - PT-8 gutter 右键菜单「调试此测试」→ debug_start 带 test_node
 *  - PT-9 .py 变更 → dep-fs-changed → stale chip
 *  - PT-10 collect 取消分支：静默复位不报错
 *
 * mock 面跑在 tauri-mock.js（pytest_action 四动作 + run_in_terminal 记录），预置经
 * window.__E2E_PYTEST__ 注入（须 addInitScript 先于 goto）。真实 collect / junitxml
 * 解析 / kind="test" 命令构造由 Rust 单测（pytest_cmds / terminal）覆盖；真机链路
 * （真实 pytest 环境）归 shell/e2e-real 的 pytest-real 套件。
 */
import { test, expect, type Page } from "@playwright/test";
import { clickGlyph, equipPage, makeGitRepo, type GitRepo } from "../helpers";

const TEST_API = `import pytest


def test_create():
    assert 1 == 1


class TestUser:
    def test_x(self):
        assert True

    @pytest.mark.parametrize("n", [1, 2])
    def test_p(self, n):
        assert n > 0
`;

const APP_PY = "def handle():\n    return 1\n";

interface PytestPreset {
  files?: string[];
  nodes?: string[];
  missingModule?: string;
  /** collect 慢路径（ms）：验证 scan 骨架不依赖 collect（§3.2/§10 第 12 项） */
  collectDelayMs?: number;
  collectError?: string;
  cases?: Array<{ node_id: string; status: string; duration_ms: number | null; message: string | null; file: string | null; line: number | null }>;
}

async function boot(page: Page, repo: GitRepo, preset?: PytestPreset, opts: { cancel?: boolean; noResult?: boolean } = {}): Promise<void> {
  if (preset || opts.cancel || opts.noResult) {
    await page.addInitScript((p) => {
      const w = window as unknown as {
        __E2E_PYTEST__?: unknown;
        __E2E_PYTEST_CANCEL__?: boolean;
        __E2E_PYTEST_NO_RESULT__?: boolean;
      };
      if (p.preset) w.__E2E_PYTEST__ = p.preset;
      if (p.cancel) w.__E2E_PYTEST_CANCEL__ = true;
      if (p.noResult) w.__E2E_PYTEST_NO_RESULT__ = true;
    }, { preset, cancel: opts.cancel, noResult: opts.noResult });
  }
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

/** 打开测试视图（活动栏 #tab-tests；懒加载 initTestView + refreshTests） */
async function openTestsView(page: Page): Promise<void> {
  await page.locator("#tab-tests").click();
  await expect(page.locator("#view-tests")).not.toHaveClass(/hidden/);
}

/** 展开测试树里的一行（默认折叠到文件级，§3.10 初始态；点 twisty） */
async function expandRow(page: Page, node: string): Promise<void> {
  const row = page.locator(`.test-row[data-node="${node}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator(".test-twisty").click();
}

/** 展开到用例级：文件行 → 类行（嵌套逐级，同 PyCharm 树交互） */
async function expandToCases(page: Page, file: string, cls: string): Promise<void> {
  await expandRow(page, file);
  await expandRow(page, cls);
}

/** 打开编辑器里的测试文件（tests/ 为子目录：先展开目录 twisty 再双击文件） */
async function openTestFile(page: Page): Promise<void> {
  const dir = page.locator("#tree .tree-item", { hasText: "tests" }).first();
  await dir.locator(".twisty").click();
  await page.locator("#tree .tree-item .name", { hasText: "test_api.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 10_000 });
}

/** 读取 run_in_terminal 调用记录（mock 侧记录，断言 kind/path） */
async function runCalls(page: Page): Promise<Array<{ id: string; path: string; kind: string }>> {
  return page.evaluate(() =>
    ((window as unknown as { __E2E_RUN_IN_TERMINAL__?: Array<{ id: string; path: string; kind: string }> }).__E2E_RUN_IN_TERMINAL__ ?? []).map((c) => ({ ...c })),
  );
}

/** 模拟后端 term-exit（真实 Tauri 下由 PTY 退出监视线程发；mock 侧手动发） */
async function emitTermExit(page: Page, id: string, code: number): Promise<void> {
  await page.evaluate(
    ([i, c]) => {
      const internals = (window as unknown as { __TAURI_INTERNALS__?: { __emit?: (e: string, p: unknown) => void } }).__TAURI_INTERNALS__;
      internals?.__emit?.("term-exit", { id: i, code: c });
    },
    [id, code] as const,
  );
}

/** 标准 preset：scan 两文件 + collect 四节点 */
function stdPreset(): PytestPreset {
  return {
    files: ["tests/test_api.py", "tests/test_util.py"],
    nodes: [
      "tests/test_api.py::test_create",
      "tests/test_api.py::TestUser::test_x",
      "tests/test_api.py::TestUser::test_p[1]",
      "tests/test_api.py::TestUser::test_p[2]",
    ],
  };
}

let repo: GitRepo;
const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  repo = await makeGitRepo({
    files: { "tests/test_api.py": TEST_API, "tests/test_util.py": "def test_util():\n    pass\n", "app.py": APP_PY },
    commitMsg: "baseline",
  });
});

test.afterEach(() => {
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

// ---------- PT-1：scan 骨架 → collect 增强 ----------

test("PT-1 测试视图：scan 文件骨架先行，collect 用例子节点增强", async ({ page }) => {
  await boot(page, repo, stdPreset());
  await openTestsView(page);
  // 文件行先行（scan 骨架，不依赖 collect）
  const fileRow = page.locator('.test-row[data-node="tests/test_api.py"]');
  await expect(fileRow).toBeVisible({ timeout: 10_000 });
  // collect 落地后展开（文件 → 类 → 用例，逐级）：parametrize 单例成行
  await expandToCases(page, "tests/test_api.py", "tests/test_api.py::TestUser");
  await expect(page.locator('.test-row[data-node="tests/test_api.py::TestUser"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.test-row[data-node="tests/test_api.py::TestUser::test_p[1]"]')).toBeVisible();
  await expect(page.locator('.test-row[data-node="tests/test_api.py::TestUser::test_p[2]"]')).toBeVisible();
  // 头部计数：4 个用例（collect 的节点全部落树）
  await expect(page.locator("#test-count")).toContainText("4");
});

// ---------- PT-2：树行 ▶ → kind="test" ----------

test("PT-2 树行 ▶ 点击 → run_in_terminal kind=test（path=node id）", async ({ page }) => {
  await boot(page, repo, stdPreset());
  await openTestsView(page);
  await expandToCases(page, "tests/test_api.py", "tests/test_api.py::TestUser");
  const row = page.locator('.test-row[data-node="tests/test_api.py::TestUser::test_x"]');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator(".test-run").click();
  await expect(async () => {
    const calls = await runCalls(page);
    const hit = calls.find((c) => c.kind === "test");
    expect(hit, "应有一次 kind=test 的 run_in_terminal 调用").toBeTruthy();
    expect(hit?.path).toBe("tests/test_api.py::TestUser::test_x");
    expect(hit?.id).toBe("run-term-test"); // 单例实例（§3.5）
  }, { timeout: 10_000 }).toPass();
});

// ---------- PT-3：结果合入 ----------

test("PT-3 term-exit → result 合入：失败行状态 + 计数 + 自动展开", async ({ page }) => {
  await boot(page, repo, {
    ...stdPreset(),
    cases: [
      { node_id: "tests/test_api.py::test_create", status: "passed", duration_ms: 3, message: null, file: "tests/test_api.py", line: 5 },
      { node_id: "tests/test_api.py::TestUser::test_x", status: "failed", duration_ms: 8, message: "assert True", file: "tests/test_api.py", line: 10 },
      { node_id: "tests/test_api.py::TestUser::test_p[1]", status: "passed", duration_ms: 2, message: null, file: "tests/test_api.py", line: 15 },
      { node_id: "tests/test_api.py::TestUser::test_p[2]", status: "error", duration_ms: 1, message: "boom", file: "tests/test_api.py", line: 15 },
    ],
  });
  await openTestsView(page);
  await expandToCases(page, "tests/test_api.py", "tests/test_api.py::TestUser");
  const failRow = page.locator('.test-row[data-node="tests/test_api.py::TestUser::test_x"]');
  await expect(failRow).toBeVisible({ timeout: 10_000 });
  await failRow.locator(".test-run").click();
  await emitTermExit(page, "run-term-test", 1);
  // 状态合入（只切 class，不重建 DOM）
  await expect(failRow).toHaveClass(/is-failed/, { timeout: 10_000 });
  await expect(page.locator('.test-row[data-node="tests/test_api.py::TestUser::test_p[2]"]')).toHaveClass(/is-error/);
  await expect(page.locator('.test-row[data-node="tests/test_api.py::test_create"]')).toHaveClass(/is-passed/);
  // 文件行汇总：2 个失败 + 失败消息 tooltip
  await expect(page.locator("#test-count")).toContainText("2");
  await expect(failRow.locator(".test-name")).toHaveAttribute("title", "assert True");
  // 失败文件自动展开（§3.10③）：子行在文件行之后可见
  await expect(page.locator('.test-row[data-node="tests/test_api.py::TestUser"]')).toBeVisible();
});

// ---------- PT-4：重跑失败 ----------

test("PT-4 重跑失败：一次调用传多个 node id", async ({ page }) => {
  await boot(page, repo, {
    ...stdPreset(),
    cases: [
      { node_id: "tests/test_api.py::test_create", status: "passed", duration_ms: 3, message: null, file: "tests/test_api.py", line: 5 },
      { node_id: "tests/test_api.py::TestUser::test_x", status: "failed", duration_ms: 8, message: "assert True", file: "tests/test_api.py", line: 10 },
      { node_id: "tests/test_api.py::TestUser::test_p[1]", status: "failed", duration_ms: 2, message: "x", file: "tests/test_api.py", line: 15 },
      { node_id: "tests/test_api.py::TestUser::test_p[2]", status: "passed", duration_ms: 1, message: null, file: "tests/test_api.py", line: 15 },
    ],
  });
  await openTestsView(page);
  await expandToCases(page, "tests/test_api.py", "tests/test_api.py::TestUser");
  const row = page.locator('.test-row[data-node="tests/test_api.py::TestUser::test_x"]');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator(".test-run").click();
  await emitTermExit(page, "run-term-test", 1);
  await expect(page.locator("#test-count")).toContainText("2", { timeout: 10_000 });
  // 「重跑失败」按钮可用 → 点击 → 一次调用带两个失败 node id
  await page.locator("#test-rerun").click();
  await expect(async () => {
    const calls = await runCalls(page);
    const rerun = calls.filter((c) => c.kind === "test").at(-1);
    expect(rerun?.path).toBe("tests/test_api.py::TestUser::test_x\ntests/test_api.py::TestUser::test_p[1]");
  }, { timeout: 10_000 }).toPass();
});

// ---------- PT-5：pytest 未安装三态 ----------

test("PT-5 pytest 未安装：missing_module 三态 + 安装引导按钮", async ({ page }) => {
  await boot(page, repo, { files: ["tests/test_api.py"], missingModule: "pytest" });
  await openTestsView(page);
  await expect(page.locator("#test-content")).toContainText("未安装 pytest", { timeout: 10_000 });
  await expect(page.locator("#test-content button", { hasText: "安装 pytest" })).toBeVisible();
});

// ---------- PT-6：收集错误三态 ----------

test("PT-6 收集失败：error_tail 原文 + 重试按钮", async ({ page }) => {
  await boot(page, repo, { files: ["tests/test_api.py"], collectError: "tests/test_api.py:3: ImportError" });
  await openTestsView(page);
  await expect(page.locator(".test-error-tail")).toContainText("tests/test_api.py:3: ImportError", { timeout: 10_000 });
  await expect(page.locator("#test-content button", { hasText: "重试" })).toBeVisible();
});

// ---------- PT-7：绿箭头 ----------

test("PT-7 绿箭头：测试文件 def 行装饰 + 点击运行；非测试文件不武装", async ({ page }) => {
  await boot(page, repo, stdPreset());
  await openTestFile(page);
  // def test_create(): 在第 4 行（1 基：import pytest / 空 / 空 / def…）：装饰 + 点击 → kind=test
  await expect(page.locator(".gutter-test").first()).toBeVisible({ timeout: 10_000 });
  const count = await page.locator(".gutter-test").count();
  expect(count).toBeGreaterThanOrEqual(3); // test_create(4) + test_x + test_p（3 个 def）
  await clickGlyph(page, 4);
  await expect(async () => {
    const calls = await runCalls(page);
    const hit = calls.find((c) => c.kind === "test");
    expect(hit?.path).toBe("tests/test_api.py::test_create");
  }, { timeout: 10_000 }).toPass();
  // 非测试文件：无绿箭头
  await page.locator("#tree .tree-item .name", { hasText: "app.py" }).first().dblclick();
  await expect(page.locator(".gutter-test")).toHaveCount(0, { timeout: 10_000 });
});

// ---------- PT-8：gutter 右键「调试此测试」 ----------

test("PT-8 gutter 右键菜单 → 调试此测试 → debug_start 带 test_node", async ({ page }) => {
  await boot(page, repo, stdPreset());
  await openTestFile(page);
  await expect(page.locator(".gutter-test").first()).toBeVisible({ timeout: 10_000 });
  // 右键第 4 行（def test_create():）glyph（坐标取法同 clickGlyph）。
  // 重试：LSP 异步插入的 CodeLens view zone 会改变行的视口位置，坐标可能落在相邻行
  // （debug 域 D-FUNC-1 同款 flake 处理）。
  await expect(async () => {
    const glyph = await page.locator(".glyph-margin").first().boundingBox();
    const row = await page.locator(".view-line").nth(3).boundingBox();
    if (!glyph || !row) throw new Error("glyph 或行不可见");
    await page.mouse.click(glyph.x + 6, row.y + row.height / 2, { button: "right" });
    // 菜单归属：测试定义行必须由 testGutter 接管（§3.4）——断点菜单会让位
    await expect(page.locator("#ctx-menu .ctx-menu-item", { hasText: "运行此测试" })).toHaveCount(1, { timeout: 2_000 });
  }, { timeout: 15_000 }).toPass();
  // 右键不得顺带设断点（三方协调让位注入的回归面）
  await expect(page.locator(".gutter-breakpoint")).toHaveCount(0);
  await page.locator("#ctx-menu .ctx-menu-item", { hasText: "调试此测试" }).first().click();
  await expect(async () => {
    const st = await page.evaluate(() => (window as unknown as { __OC_DEBUG__?: { state: () => { testNode: string | null } } }).__OC_DEBUG__?.state());
    expect(st?.testNode).toBe("tests/test_api.py::test_create");
  }, { timeout: 10_000 }).toPass();
});

// ---------- PT-9：stale chip ----------

test("PT-9 .py 变更 → dep-fs-changed → stale chip 可见", async ({ page }) => {
  await boot(page, repo, stdPreset());
  await openTestsView(page);
  await expect(page.locator('.test-row[data-node="tests/test_api.py"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#test-stale")).toHaveClass(/hidden/);
  await page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { __emit?: (e: string, p: unknown) => void } }).__TAURI_INTERNALS__;
    internals?.__emit?.("dep-fs-changed", [{ path: "tests/test_api.py", kind: "py" }]);
  });
  await expect(page.locator("#test-stale")).not.toHaveClass(/hidden/, { timeout: 10_000 });
});

// ---------- PT-11：2000 节点大 fixture（§10 第 12 项） ----------

/** 造 N 个文件的用例节点（大 fixture：验证首帧与分帧不卡） */
function bigPreset(files: number, perFile: number): PytestPreset {
  const list: string[] = [];
  const nodes: string[] = [];
  for (let f = 0; f < files; f++) {
    const file = `tests/test_big_${f}.py`;
    list.push(file);
    for (let i = 0; i < perFile; i++) nodes.push(`${file}::test_case_${i}`);
  }
  return { files: list, nodes };
}

test("PT-11 2000 节点：骨架首帧不依赖 collect + 展开分帧不阻塞", async ({ page }) => {
  // collect 故意慢 1500ms：骨架必须先于它可见（§3.2 两段式的核心收益）
  await boot(page, repo, { ...bigPreset(20, 100), collectDelayMs: 1500 });
  const opened = Date.now();
  await openTestsView(page);
  const fileRow = page.locator('.test-row[data-node="tests/test_big_0.py"]');
  await expect(fileRow).toBeVisible({ timeout: 3_000 });
  const firstFrameMs = Date.now() - opened;
  console.log("[PT-11] 骨架首帧:", firstFrameMs, "ms（collect 仍在途 1500ms）");
  expect(firstFrameMs).toBeLessThan(1_000); // 首帧不得被 collect 拖住
  // 等 collect 落地（骨架阶段文件行无子节点，展开要在增强之后才有意义）
  await expect(page.locator("#test-count")).toContainText("2000", { timeout: 10_000 });
  // 展开单个文件（100 个子行，分帧渲染）：不阻塞、末行可见
  const t1 = Date.now();
  await fileRow.locator(".test-twisty").click();
  await expect(page.locator('.test-row[data-node="tests/test_big_0.py::test_case_99"]')).toBeVisible({ timeout: 5_000 });
  console.log("[PT-11] 展开 100 行:", Date.now() - t1, "ms");
  await expect(page.locator("#test-count")).toContainText("2000");
});

// ---------- PT-12：连点 collect 单飞 ----------

test("PT-12 连点刷新：collect 在途只发一次 invoke（§3.10 单飞）", async ({ page }) => {
  await boot(page, repo, { ...stdPreset(), collectDelayMs: 800 });
  await openTestsView(page);
  // 等首轮 collect 落地（计数 = 4 用例）→ 闸门空闲，连点才有「应放行一次」的语义
  await expect(page.locator("#test-count")).toContainText("4", { timeout: 10_000 });
  const before = await page.evaluate(() =>
    ((window as unknown as { __E2E_PYTEST_CALLS__?: string[] }).__E2E_PYTEST_CALLS__ ?? []).filter((a) => a === "collect").length,
  );
  // 连点三次（**同步派发**）：不能用 locator.click()——按钮在收集中置灰，Playwright 会
  // 等它变可用再点，那样就变成三轮串行刷新，测不到编排层闸门。合成事件直达监听，
  // 才是真实的「用户连点」语义（鼠标事件在 UI 重绘之前就已经到达）。
  await page.evaluate(() => {
    const b = document.getElementById("test-refresh");
    for (let i = 0; i < 3; i++) b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.locator("#test-cancel")).not.toHaveClass(/hidden/, { timeout: 5_000 });
  const all = await page.evaluate(() => (window as unknown as { __E2E_PYTEST_CALLS__?: string[] }).__E2E_PYTEST_CALLS__ ?? []);
  const during = all.filter((a) => a === "collect").length;
  // 三次连点 → 只放行一轮（第二次起被单飞闸门挡住）
  expect(during - before).toBe(1);
  // 收集中：取消按钮现身、刷新按钮置灰（UI 层的第二道闸）
  await expect(page.locator("#test-refresh")).toBeDisabled();
});

// ---------- PT-10：取消分支静默复位 ----------

test("PT-10 collect 取消：静默复位不报错（树保持骨架）", async ({ page }) => {
  await boot(page, repo, stdPreset(), { cancel: true });
  await openTestsView(page);
  // cancelled 分支：phase 回落 idle，文件骨架仍在（scan 先行落地）
  await expect(page.locator('.test-row[data-node="tests/test_api.py"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#test-cancel")).toHaveClass(/hidden/);
});
