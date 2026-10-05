/**
 * E2E：B5 结构化运行日志视图（底部「运行日志」tab）
 *
 * 数据来源：**不经真实 PTY 运行**——用页面内 `import("/src/logView.ts")` 直接调用视图的公共
 * 入口（`beginLogSession` / `ingestLogText` / `endLogSession` / `flushLogView`）灌入结构化文本。
 * 理由：e2e mock 不实现 PTY，而 `term-data → runDataBus → logView` 的多播链路已由
 * `src/__tests__/runDataBus.test.ts` + `logView.test.ts` 覆盖；本 spec 只验浏览器层的
 * **交互接线**（chips / 搜索 / 字段列 / 自动滚动 / JSON 展开 / 导出 / 设置项）。
 * 解析与状态机纯逻辑由 `logParse.test.ts` / `logStore.test.ts` 覆盖。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

const ID = "run-term-script";

/** 一段覆盖四种级别 + JSON + 中文的样本 */
const SAMPLE = [
  "2026-10-05 12:03:41.512 | INFO     | app.main:1 - 启动完成",
  "2026-10-05 12:03:41.880 | ERROR    | app.worker:33 - 连接失败",
  // msg 整体是 JSON 才会触发行内展开（前缀是中文的普通正文不展开）
  '12:03:42.101 | WARNING  | app.db:7 - {"retry":3,"host":"db"}',
  "12:03:42.400 | DEBUG    | app.main:9 - 细节",
  "普通输出行（无级别）",
].join("\n") + "\n";

let repo: GitRepo;

test.beforeEach(async ({ page }) => {
  repo = await makeGitRepo({ files: { "main.py": "value = 1\n" }, commitMsg: "baseline" });
  await equipPage(page, repo);
  await page.goto("/");
  // 与 e2e/todo 同口径：等 Git 分支就绪 = 应用 init 完成（避免抢跑点击）
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
});

/** 切到「运行日志」tab */
async function openLogsTab(page: Page): Promise<void> {
  await page.locator("#tab-logs").click();
  await expect(page.locator("#logs-panel")).toBeVisible({ timeout: 5_000 });
}

/** 直接经视图公共入口灌数据（先绑会话 → 喂文本 → 落退出码 → 立即渲染） */
async function pushLogs(
  page: Page,
  text: string,
  code: number | null = 0,
): Promise<{ total: number; phase: string; dropped: number }> {
  return page.evaluate(
    async (payload) => {
      const m = (await import(/* @vite-ignore */ "/src/logView.ts")) as {
        beginLogSession: (id: string) => void;
        ingestLogText: (id: string, text: string) => void;
        endLogSession: (id: string, code: number | null) => void;
        flushLogView: () => void;
        logViewSnapshot: () => { total: number; phase: string; dropped: number };
      };
      m.beginLogSession(payload.id);
      m.ingestLogText(payload.id, payload.text);
      m.endLogSession(payload.id, payload.code);
      m.flushLogView();
      return m.logViewSnapshot();
    },
    { id: ID, text, code },
  );
}

/** 追加输出（**不重开会话**，用于自动滚动 / 「新日志」提示这类增量场景） */
async function appendLogs(page: Page, text: string): Promise<void> {
  await page.evaluate(
    async (payload) => {
      const m = (await import(/* @vite-ignore */ "/src/logView.ts")) as {
        ingestLogText: (id: string, text: string) => void;
        flushLogView: () => void;
      };
      m.ingestLogText(payload.id, payload.text);
      m.flushLogView();
    },
    { id: ID, text },
  );
}

test("01 底部存在「运行日志」tab；打开后是空态而非空白", async ({ page }) => {
  await expect(page.locator("#tab-logs")).toHaveText("运行日志");
  await openLogsTab(page);
  await expect(page.locator(".logs-list .empty-title")).toContainText("运行脚本后");
  await expect(page.locator(".logs-status")).toContainText("共 0 行");
});

test("02 结构化行按四列渲染（时间戳 / 级别 / logger / 消息），级别着色生效", async ({ page }) => {
  await openLogsTab(page);
  const snap = await pushLogs(page, SAMPLE);
  expect(snap.total, `snapshot=${JSON.stringify(snap)}`).toBe(5);
  const rows = page.locator(".logs-list .log-row");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0).locator(".log-ts")).toHaveText("2026-10-05 12:03:41.512");
  await expect(rows.nth(0).locator(".log-level")).toHaveText("INFO");
  await expect(rows.nth(0).locator(".log-logger")).toHaveText("app.main");
  await expect(rows.nth(0).locator(".log-msg")).toHaveText("启动完成");
  await expect(rows.nth(1)).toHaveClass(/log-row--error/);
  await expect(page.locator(".logs-status")).toContainText("已结束（退出码 0）");
});

test("03 级别 chips 显示计数；点击即过滤（未分级行保留）", async ({ page }) => {
  await openLogsTab(page);
  await pushLogs(page, SAMPLE);
  await expect(page.locator('.log-chip[data-level="info"] .log-chip-count')).toHaveText("1");
  await expect(page.locator('.log-chip[data-level="error"] .log-chip-count')).toHaveText("1");
  await page.locator('.log-chip[data-level="info"]').click();
  await expect(page.locator(".logs-list .log-row")).toHaveCount(4); // info 被滤掉
  await expect(page.locator('.log-chip[data-level="info"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator('.log-chip[data-level="info"]').click(); // 恢复
  await expect(page.locator(".logs-list .log-row")).toHaveCount(5);
});

test("04 搜索：命中高亮 + 过滤；正则切换后支持锚点表达式", async ({ page }) => {
  await openLogsTab(page);
  await pushLogs(page, SAMPLE);
  const search = page.locator(".logs-search");
  await search.fill("连接");
  await expect(page.locator(".logs-list .log-row")).toHaveCount(1);
  await expect(page.locator(".logs-list mark.log-hit")).toHaveText("连接");
  // 字面量模式下 "^ERROR" 无命中 → 空态
  await search.fill("^ERROR");
  await expect(page.locator(".logs-list .log-row")).toHaveCount(0);
  await expect(page.locator(".logs-list .empty-title")).toContainText("没有匹配");
  // 切正则后支持真正的锚点/字符类表达式（行首是时间戳，故用分隔符锚定 ERROR 段）
  await page.locator(".out-chip", { hasText: ".*" }).click();
  await search.fill("\\| ERROR");
  await expect(page.locator(".logs-list .log-row")).toHaveCount(1);
  await expect(page.locator(".logs-list .log-msg")).toHaveText("连接失败");
});

test("05 字段列可切换：关掉「时间」后该列不占位", async ({ page }) => {
  await openLogsTab(page);
  await pushLogs(page, SAMPLE);
  await expect(page.locator(".logs-list .log-ts")).toHaveCount(5);
  await page.locator(".out-chip", { hasText: "字段" }).click();
  await page.locator("#ctx-menu .ctx-menu-item", { hasText: "时间" }).click();
  await expect(page.locator(".logs-list .log-ts")).toHaveCount(0);
  await expect(page.locator(".logs-list .log-row").first()).toHaveClass(/log-row--c3/);
});

test("06 行内 JSON：点 ▸ 展开折叠树，再点收起", async ({ page }) => {
  await openLogsTab(page);
  await pushLogs(page, SAMPLE);
  const toggle = page.locator(".logs-list .log-json-toggle").first();
  await expect(toggle).toHaveText("▸");
  await toggle.click();
  const tree = page.locator(".logs-list .log-json .json-tree").first();
  await expect(tree).toBeVisible();
  await expect(tree).toContainText("retry");
  await expect(tree).toContainText("db");
  await toggle.click();
  await expect(page.locator(".logs-list .log-json").first()).toBeHidden();
});

test("07 自动滚动：默认跟随底部；上滚后暂停并提示「↓ N 条新日志」，点击回到底部", async ({ page }) => {
  await openLogsTab(page);
  const many = Array.from({ length: 200 }, (_, i) => `12:00:0${i % 10} | INFO | app.x - 行 ${i}`).join("\n") + "\n";
  await pushLogs(page, many);
  const list = page.locator(".logs-list");
  // 默认跟随：滚到底部
  await expect
    .poll(async () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(8);
  // 手动上滚 → 暂停跟随
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(page.locator(".logs-autoscroll input")).not.toBeChecked(); // 上滚 → 自动暂停跟随
  await appendLogs(page, "12:01:00 | ERROR | app.x - 新错误\n");
  const newBtn = page.locator(".logs-new-btn");
  await expect(newBtn).toBeVisible();
  await expect(newBtn).toContainText("条新日志");
  await newBtn.click();
  await expect(newBtn).toBeHidden();
  await expect
    .poll(async () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(8);
});

test("08 导出：复制全部写入剪贴板；插入编辑器落到光标处", async ({ page }) => {
  await openLogsTab(page);
  await pushLogs(page, SAMPLE);
  await page.locator("button", { hasText: "复制全部" }).click();
  const copied = await page.evaluate(() => (window as unknown as { __E2E_COPIED__?: string[] }).__E2E_COPIED__ ?? []);
  expect(copied.join("\n")).toContain("启动完成");
  expect(copied.join("\n")).toContain("连接失败");
  // 打开文件后插入编辑器
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 20_000 });
  await page.locator("#tab-logs").click();
  await page.locator("button", { hasText: "插入编辑器" }).click();
  const text = await page.evaluate(async () => {
    const { app } = (await import(/* @vite-ignore */ "/src/state.ts")) as {
      app: { editor: { getModel: () => { getValue: () => string } | null } };
    };
    return app.editor.getModel()?.getValue() ?? "";
  });
  expect(text).toContain("启动完成");
});

test("11 列跨行对齐：四列 left 坐标逐行一致（含无时间戳/无级别的行）", async ({ page }) => {
  await openLogsTab(page);
  await pushLogs(page, SAMPLE);
  // 每行是**独立** grid 容器，只靠 tabular-nums 不会对齐——靠三列的最小宽度（§6.1 时间戳对齐）。
  // 样本里刻意混入「无时间戳（uvicorn）」「无级别」「无 logger」三种行，验证空列照样占位。
  const cols = await page.evaluate(() =>
    [...document.querySelectorAll(".logs-list .log-row")].map((r) => {
      const left = (sel: string): number => {
        const el = r.querySelector(sel);
        return el ? Math.round(el.getBoundingClientRect().left) : -1;
      };
      return [left(".log-ts"), left(".log-level"), left(".log-logger"), left(".log-msg")];
    }),
  );
  expect(cols.length).toBeGreaterThan(3);
  for (const c of cols) expect(c, JSON.stringify(cols)).toEqual(cols[0]);
});

test("10 首次使用提示：点「知道了」后消失（回归：display:flex 曾让 hidden 属性失效）", async ({ page }) => {
  await openLogsTab(page);
  const hint = page.locator(".logs-hint");
  await expect(hint).toBeVisible();
  await expect(hint).toContainText("运行历史");
  await page.locator(".logs-hint button").click();
  await expect(hint).toBeHidden();
});

test("09 设置项：关闭 log_structured_enabled 后底部不显示该 tab", async ({ page }) => {
  // 本用例需要预置设置，故重开一次页面（beforeEach 的 equipPage 已注入 mock）
  await page.addInitScript(() => {
    (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
      log_structured_enabled: false,
    };
  });
  await page.reload();
  await expect(page.locator("#status-git")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#tab-logs")).toBeHidden();
  await expect(page.locator("#tab-output")).toBeVisible();
});
