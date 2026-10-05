/**
 * B4 · HTTP 工具 E2E 验收（PR-B4-2，docs/toolbox_dev_plan.md §5.7）。
 *
 * 覆盖：
 *  1. 入口与空态（Ctrl+Shift+T → picker → 工具挂载）
 *  2. 发送成功：状态行 / JSON 树 / 响应头折叠
 *  3. **loading 态**：细进度条可见 + 发送按钮忙碌禁用 + 旧响应灰显（§5.7.2）
 *  4. **进度事件**：`http-op-progress` 到达时状态行显示「已收 / 总量」
 *  5. 取消：中间态文案 + 后端真的收到 http_cancel + 3s 兜底回落
 *  6. 失败态：错误本地化进 error 槽
 *  7. 4xx 不是错误态（只换颜色，不出错误提示）
 *  8. 请求头组装进请求（__E2E_HTTP_LAST_REQ__）+ 草稿跨工具切换保留
 *
 * **全程离线**：http_send 由 tauri-mock 返回罐头响应，绝不发真实网络请求（§9 门禁）。
 */
import { expect, test, type Page } from "@playwright/test";
import { equipPage, makePlainDir } from "../helpers";

/** 打开 devtools 面板并切到 HTTP 工具（picker 搜索 → Enter） */
async function openHttpTool(page: Page): Promise<void> {
  const panelOpen = await page.locator("#right-panel:not(.hidden)").count();
  if (panelOpen > 0) {
    await page.locator("#devtools-close").click();
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator("#devtools-picker")).toBeVisible({ timeout: 5_000 });
  await page.locator("#devtools-picker-search").fill("HTTP 请求");
  await page.keyboard.press("Enter");
  await expect(page.locator("#devtools-body .http-url")).toBeVisible({ timeout: 5_000 });
}

/** 预置 mock 行为（页面上下文变量；发送前设置即可） */
async function preset(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => {
    Object.assign(window as unknown as Record<string, unknown>, p);
  }, patch);
}

async function equip(page: Page): Promise<void> {
  const repo = await makePlainDir({ "main.py": "print('hello world')\n" });
  await equipPage(page, repo);
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible({ timeout: 15_000 });
  // init() 是异步的：#editor 静态存在 ≠ init 完成（**键位接线与内置工具注册在其后**）。
  // 只等 menubar 会在键位接好之前就按 Ctrl+Shift+T —— 必须等插件首扫 + 内置工具注册完成
  // （照 e2e/plugins/01-devtools-plugin.spec.ts 的 equip 口径）。
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log =
            (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
          return log.some((x) => x.startsWith("list_plugin_dirs")) &&
            document.querySelectorAll(".menubar-item").length > 0
            ? 1
            : 0;
        }),
      { timeout: 15_000 },
    )
    .toBe(1);
}

test.describe("HTTP 工具 E2E", () => {
  test("01 入口与空态：picker 可达 + 未发送时显示空态", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await expect(page.locator("#devtools-body .http-url")).toBeVisible();
    await expect(page.locator("#devtools-body button", { hasText: "发送" })).toBeVisible();
    await expect(page.locator("#devtools-body .http-resp-body .empty-title")).toContainText("还没有响应");
    // 取消按钮初始禁用（无在途请求）
    await expect(page.locator("#devtools-body button", { hasText: "取消" })).toBeDisabled();
  });

  test("02 发送成功：状态行 + JSON 树 + 响应头折叠", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/users");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();

    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });
    await expect(page.locator("#devtools-body .http-meta")).toContainText("12 ms");
    await expect(page.locator("#devtools-body .http-meta")).toContainText("25 B");
    // JSON 树：默认展开到第 2 层 → 顶层 summary 可见，数组内条目可见
    await expect(page.locator("#devtools-body .json-node > summary").first()).toContainText("对象");
    await expect(page.locator("#devtools-body .json-node > summary").nth(1)).toContainText("数组 · 3 项");
    await expect(page.locator("#devtools-body .json-leaf").first()).toContainText("ok");
    // 响应头折叠区默认收起
    await expect(page.locator("#devtools-body .http-section--resp > summary")).toContainText("响应头（2）");
  });

  test("03 loading 态：细进度条 + 发送按钮忙碌 + 旧响应灰显（§5.7.2）", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    // 先发一次拿到「旧响应」（供灰显断言）
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/first");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });

    // 第二次：慢响应
    await preset(page, { __E2E_HTTP_DELAY_MS__: 900 });
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/slow");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();

    // 细进度条出现（非遮罩），发送按钮进入忙碌禁用，旧响应保留并灰显
    await expect(page.locator("#devtools-body .http-progress:not(.hidden)")).toBeVisible({ timeout: 3_000 });
    await expect(page.locator("#devtools-body button.busy")).toBeDisabled();
    await expect(page.locator("#devtools-body .http-response.is-stale")).toBeVisible();
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK"); // 旧响应未被清空

    // 完成后：进度条收起、忙碌态解除、灰显移除
    await expect(page.locator("#devtools-body .http-progress.hidden")).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator("#devtools-body button.busy")).toHaveCount(0);
    await expect(page.locator("#devtools-body .http-response.is-stale")).toHaveCount(0);
  });

  test("04 进度事件：状态行显示「已收 / 总量」", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await preset(page, { __E2E_HTTP_DELAY_MS__: 900 });
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/big");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    // mock 在延迟期间自动推 http-op-progress（3 步）→ 状态行出现已收字节
    await expect(page.locator("#devtools-body .http-status")).toContainText("/ 4.0 KB", { timeout: 3_000 });
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });
  });

  test("05 取消：中间态文案 + 后端收到 http_cancel + 回落 idle", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await preset(page, { __E2E_HTTP_DELAY_MS__: 4000 });
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/slow");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-progress:not(.hidden)")).toBeVisible({ timeout: 3_000 });

    await page.locator("#devtools-body button", { hasText: "取消" }).click();
    await expect(page.locator("#devtools-body .http-status")).toContainText("正在取消", { timeout: 2_000 });
    // 后端确实收到了取消（不是只改前端状态）
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __E2E_HTTP_CANCELLED__?: boolean }).__E2E_HTTP_CANCELLED__ === true ? 1 : 0), { timeout: 3_000 })
      .toBe(1);
    // 3s 兜底后回落 idle（不弹错误）
    await expect(page.locator("#devtools-body .http-status--idle")).toBeVisible({ timeout: 6_000 });
    await expect(page.locator("#devtools-body .http-progress.hidden")).toHaveCount(1);
  });

  test("06 失败态：错误本地化进 error 槽 + 状态行 err", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await preset(page, { __E2E_HTTP_FAIL__: "HttpTimeout:请求超时" });
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/timeout");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-status--err")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-error")).not.toBeEmpty();
  });

  test("07 4xx 不是错误态：只换颜色，不出错误提示", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await preset(page, {
      __E2E_HTTP__: {
        status: 404,
        statusText: "Not Found",
        headers: [["content-type", "application/json"]],
        body: '{"detail":"missing"}',
        bodyBase64: null,
        bytes: 19,
        elapsedMs: 8,
        redirectChain: [],
        truncated: false,
        privateTarget: false,
        binary: false,
      },
    });
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/nope");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-code--degraded")).toContainText("404 Not Found", { timeout: 5_000 });
    await expect(page.locator("#devtools-body .http-status--err")).toHaveCount(0);
    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-error")).toBeEmpty();
  });

  test("08 请求头组装 + 草稿跨工具切换保留", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await page.locator("#devtools-body .http-url").fill("https://api.example.com/headers");
    await page.locator("#devtools-body button", { hasText: "添加头" }).click();
    const row = page.locator("#devtools-body .http-header-row").first();
    await row.locator("input").nth(0).fill("X-Token");
    await row.locator("input").nth(1).fill("abc123");
    await expect(page.locator("#devtools-body .http-section > summary").first()).toContainText("请求头（1）");

    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });
    // 头确实进了请求（mock 记录最后一次 req）
    const sent = await page.evaluate(
      () => (window as unknown as { __E2E_HTTP_LAST_REQ__?: { headers: [string, string][] } }).__E2E_HTTP_LAST_REQ__,
    );
    expect(sent?.headers).toEqual([["X-Token", "abc123"]]);

    // 切走工具再切回：草稿（URL + 头）保留
    await page.locator("#devtools-current").click();
    await page.locator("#devtools-picker-search").fill("UUID 生成");
    await page.keyboard.press("Enter");
    // 切走后本工具 root 隐藏（实例缓存：DOM 仍在，故其他断言一律限定可见 root）
    await expect(page.locator("#devtools-body .http-url")).toBeHidden();
    await page.locator("#devtools-current").click();
    await page.locator("#devtools-picker-search").fill("HTTP 请求");
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-body .http-url")).toHaveValue("https://api.example.com/headers");
    await expect(page.locator("#devtools-body .http-header-row input").first()).toHaveValue("X-Token");
  });

  // ---------- PR-B4-3：变量 / curl 导入 / 历史 ----------

  test("09 变量：{{var}} 按当前环境替换后才发出", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await page.locator("#devtools-body button", { hasText: "编辑变量" }).click();
    await page.locator("#devtools-body .http-vars textarea").fill("base=https://api.dev\ntoken=abc");
    await page.locator("#devtools-body button", { hasText: "保存变量" }).click();
    await expect(page.locator("#devtools-body .http-vars > summary")).toContainText("变量 · dev（2）");

    await page.locator("#devtools-body .http-url").fill("{{base}}/users?t={{token}}");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });

    const sent = await page.evaluate(
      () => (window as unknown as { __E2E_HTTP_LAST_REQ__?: { url: string } }).__E2E_HTTP_LAST_REQ__,
    );
    expect(sent?.url).toBe("https://api.dev/users?t=abc"); // 发出去的是替换后的值
  });

  test("10 未定义变量：拦下不发送并在错误槽点名", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await page.locator("#devtools-body .http-url").fill("https://api.dev/{{nope}}");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-error")).toContainText("nope");
    // 关键：不能把字面量 {{nope}} 发出去
    const sent = await page.evaluate(
      () => (window as unknown as { __E2E_HTTP_LAST_REQ__?: unknown }).__E2E_HTTP_LAST_REQ__,
    );
    expect(sent).toBeUndefined();
  });

  test("11 粘贴 curl：自动拆解为方法 / URL / 头 / 体并可直接发送", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await page
      .locator("#devtools-body .http-url")
      .fill(`curl -X POST 'https://api.dev/items' -H 'X-Token: t1' -d '{"a":1}'`);

    await expect(page.locator("#devtools-body .http-url")).toHaveValue("https://api.dev/items");
    await expect(page.locator("#devtools-body .http-method")).toHaveValue("POST");
    await expect(page.locator("#devtools-body .http-header-row input").first()).toHaveValue("X-Token");
    await expect(page.locator(".devtools-tool-root:not(.hidden) .tool-textarea").first()).toHaveValue('{"a":1}');

    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });
    const sent = await page.evaluate(
      () =>
        (window as unknown as { __E2E_HTTP_LAST_REQ__?: { headers: [string, string][]; body: string } })
          .__E2E_HTTP_LAST_REQ__,
    );
    expect(sent?.headers).toEqual([["X-Token", "t1"]]);
    expect(sent?.body).toBe('{"a":1}');
  });

  test("12 历史：发送后入列，点击回填 method + url", async ({ page }) => {
    await equip(page);
    await openHttpTool(page);
    await page.locator("#devtools-body .http-url").fill("https://api.dev/first");
    await page.locator("#devtools-body button", { hasText: "发送" }).click();
    await expect(page.locator("#devtools-body .http-code")).toContainText("200 OK", { timeout: 5_000 });

    await expect(page.locator("#devtools-body .http-history-section > summary")).toContainText("历史（1）");
    await page.locator("#devtools-body .http-history-section > summary").click();
    await expect(page.locator("#devtools-body .http-history-row")).toHaveCount(1);

    // 改 URL → 点历史回填（只回填 method + url，历史不存 body）
    await page.locator("#devtools-body .http-url").fill("https://api.dev/other");
    await page.locator("#devtools-body .http-history-row").first().click();
    await expect(page.locator("#devtools-body .http-url")).toHaveValue("https://api.dev/first");
  });
});
