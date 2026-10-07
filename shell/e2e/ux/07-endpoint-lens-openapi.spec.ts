/**
 * E2E：A5③④ 端点面板余项（维护态下用户破例立项；docs/toolbox_dev_plan.md A5③/④）。
 *
 *  - EP-J1 ③ handler→route 反向跳转：源码 def 行上方 CodeLens「端点 N」出现
 *    （同 handler 多 route 合并计数），点击弹 content widget 列出绑定端点
 *  - EP-J2 弹层条目：点击激活端点面板并高亮该 route；复制 URL（无 base 提示 /
 *    注入 base 后落点正确）
 *  - EP-P1 ④ OpenAPI 预览：面板内懒加载展开块渲染（方法 + 路径 + summary + tags）、
 *    点击行匹配静态扫描结果跳源码、无 base 提示先运行
 *  - EP-P2 预览失败态：HttpStatus:500 → 错误文案（zh 界面 backendError 原样返回）
 *
 * 路径归一铁律（epJump 实现约束，误设会导致 lens 静默不显示）：
 *  - mock 的 lspDocumentSymbols 按 def|class 行扫描 → main.py 里必须有真实
 *    `def health` / `def create_user`；
 *  - epJump 对 file 两端 normalizePath（scan_endpoints 返回绝对路径；mock 默认
 *    相对路径会 miss）→ preset endpoints 的 file 必须用 repo.abs() 构造绝对路径。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

interface EndpointSample {
  framework: string;
  method: string;
  route: string;
  file: string;
  line: number;
  handler: string;
}

interface FrameworkPreset {
  endpoints?: EndpointSample[];
}

/** 形状对齐 openapi_cmds.rs::OpenApiOp */
interface OpenApiOp {
  method: string;
  path: string;
  operation_id: string;
  summary: string;
  tags: string[];
  deprecated: boolean;
}

const MAIN_PY = [
  "from fastapi import FastAPI",
  "",
  "app = FastAPI()",
  "",
  '@app.get("/health")',
  "def health():",
  '    return {"ok": True}',
  "",
  '@app.post("/v1/api/users")',
  "def create_user():",
  '    return {"created": True}',
  "",
].join("\n");

/** health 绑定 1 个端点；create_user 绑定 2 个（POST + GET）→ lens 计数 1 / 2 */
const fwPreset = (repo: GitRepo): FrameworkPreset => ({
  endpoints: [
    { framework: "fastapi", method: "GET", route: "/health", file: repo.abs("main.py"), line: 5, handler: "health" },
    { framework: "fastapi", method: "POST", route: "/v1/api/users", file: repo.abs("main.py"), line: 9, handler: "create_user" },
    { framework: "fastapi", method: "GET", route: "/v1/api/users/{uid}", file: repo.abs("main.py"), line: 13, handler: "create_user" },
  ],
});

const OPENAPI_OPS: OpenApiOp[] = [
  { method: "GET", path: "/health", operation_id: "health", summary: "健康检查", tags: ["system"], deprecated: false },
  { method: "POST", path: "/v1/api/users", operation_id: "create_user", summary: "创建用户", tags: ["users"], deprecated: false },
];

interface BootOpts {
  fw?: FrameworkPreset;
  openapi?: OpenApiOp[];
  openapiFail?: string;
}

/** PRESET 须先于 tauri-mock 注入（addInitScript 按序执行；mock 在 invoke 时才读状态） */
async function boot(page: Page, repo: GitRepo, opts: BootOpts = {}): Promise<void> {
  if (opts.fw) {
    await page.addInitScript((p) => {
      (window as unknown as { __E2E_FRAMEWORK_PRESET__?: FrameworkPreset }).__E2E_FRAMEWORK_PRESET__ = p;
    }, opts.fw);
  }
  if (opts.openapi !== undefined) {
    await page.addInitScript((p) => {
      (window as unknown as { __E2E_OPENAPI__?: OpenApiOp[] }).__E2E_OPENAPI__ = p;
    }, opts.openapi);
  }
  if (opts.openapiFail) {
    await page.addInitScript((f) => {
      (window as unknown as { __E2E_OPENAPI_FAIL__?: string }).__E2E_OPENAPI_FAIL__ = f;
    }, opts.openapiFail);
  }
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

/** 双击文件树打开文件（编辑器就绪即返回） */
async function openFile(page: Page, name: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: name }).first().dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
}

async function activeTabName(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector("#tabbar .tab.active .name")?.textContent ?? null);
}

async function setServiceBase(page: Page, base: string | null): Promise<void> {
  await page.evaluate(
    (b) =>
      (
        window as unknown as { __OC_E2E_SERVICE__?: { setServiceBase: (u: string | null) => void } }
      ).__OC_E2E_SERVICE__?.setServiceBase(b),
    base,
  );
}

const copiedTexts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __E2E_COPIED__?: string[] }).__E2E_COPIED__ ?? []);

// ---------- EP-J：③ handler→route 反向跳转（CodeLens + content widget 弹层） ----------

test("EP-J1 CodeLens「端点 N」：合并计数 + 弹层列出绑定端点", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await boot(page, repo, { fw: fwPreset(repo) });
  await openFile(page, "main.py");

  // 两个 handler 都出 lens：health=1、create_user=2（同 handler 多 route 合并计数）
  const lens1 = page.locator("#editor .codelens-decoration", { hasText: "端点 1" });
  await expect(lens1.first()).toBeVisible({ timeout: 15_000 });
  const lens2 = page.locator("#editor .codelens-decoration", { hasText: "端点 2" });
  await expect(lens2.first()).toBeVisible({ timeout: 15_000 });

  // 点击「端点 2」→ 弹层：标题 = create_user 的 2 个端点，两行（POST + GET）。
  // 注意：`.codelens-decoration` 是整行容器（含 codeVision 的「N 处引用」），必须点
  // `> a` 精确定位到本 provider 的 lens 链接，否则点击中心会落到引用 lens 上弹出 cv 弹层。
  await lens2.first().locator("a", { hasText: "端点 2" }).first().click();
  const popup = page.locator(".oc-epj-popup");
  await expect(popup).toBeVisible({ timeout: 10_000 });
  await expect(popup).toContainText("create_user 的 2 个端点");
  await expect(popup.locator(".oc-epj-row")).toHaveCount(2);
  await expect(popup.locator(".oc-epj-row-route", { hasText: "/v1/api/users/{uid}" })).toBeVisible();
  // 两行的定位文本 = 文件:行（file 为绝对路径时只显示 basename）
  await expect(popup.locator(".oc-epj-row-loc", { hasText: "main.py" })).toHaveCount(2);
});

test("EP-J2 弹层跳转：激活端点面板并高亮 + 复制 URL", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await boot(page, repo, { fw: fwPreset(repo) });
  await openFile(page, "main.py");
  await expect(page.locator("#editor .codelens-decoration", { hasText: "端点 2" }).first()).toBeVisible({ timeout: 15_000 });

  // 先开一次端点面板（results 非空 → 后续高亮立即可见）；切回资源管理器再双击打开文件
  //（端点面板会替换侧栏视图，#tree 不可见）
  await page.locator("#tab-endpoints").click();
  await expect(page.locator("#ep-results .todo-item", { hasText: "/v1/api/users" }).first()).toBeVisible({ timeout: 10_000 });
  await page.locator("#tab-files").click();
  await openFile(page, "main.py"); // 切回编辑器

  // 同上：必须点 `> a` 精确定位本 provider 的 lens（容器还含「N 处引用」）
  await page.locator("#editor .codelens-decoration a", { hasText: "端点 2" }).first().click();
  const popup = page.locator(".oc-epj-popup");
  await expect(popup).toBeVisible({ timeout: 10_000 });

  // 无 base：复制 → 提示先运行（弹层不关，跳转不受影响）
  await popup.locator(".oc-epj-row-copy").first().click();
  await expect(page.locator("#toast-stack .toast", { hasText: "无法复制完整 URL" })).toBeVisible();

  // 注入 base 后复制 → 落点 = base + route
  await setServiceBase(page, "http://127.0.0.1:8000");
  await popup.locator(".oc-epj-row-copy").first().click();
  await expect(page.locator("#toast-stack .toast", { hasText: "已复制完整 URL" })).toBeVisible();
  await expect.poll(() => copiedTexts(page)).toContain("http://127.0.0.1:8000/v1/api/users");

  // 点击 POST 行 → 激活端点面板 + 高亮该 route 条目（ep-highlight 1.2s 后自消，断言须及时）
  await popup.locator(".oc-epj-row", { hasText: "/v1/api/users" }).first().click();
  await expect(page.locator("#view-endpoints")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#ep-results .todo-item.ep-highlight")).toBeVisible({ timeout: 10_000 });
});

// ---------- EP-P：④ OpenAPI 面板内预览 ----------

test("EP-P1 OpenAPI 预览：渲染 + 点击跳源码 + 无 base 提示", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await boot(page, repo, { fw: fwPreset(repo), openapi: OPENAPI_OPS });

  await page.locator("#tab-endpoints").click();
  await expect(page.locator("#ep-results .todo-item", { hasText: "/health" }).first()).toBeVisible({ timeout: 10_000 });

  // 无 base（服务未运行）：提示先运行，不展开
  await page.locator("#ep-openapi-preview").click();
  await expect(page.locator("#toast-stack .toast", { hasText: "服务未运行" })).toBeVisible();
  await expect(page.locator(".ep-preview")).toHaveCount(0);

  // 注入 base → 懒加载展开块渲染（标题 + 操作计数 + 方法/路径/summary/tags）
  await setServiceBase(page, "http://127.0.0.1:8000");
  await page.locator("#ep-openapi-preview").click();
  const preview = page.locator(".ep-preview");
  await expect(preview).toBeVisible({ timeout: 10_000 });
  await expect(preview.locator(".ep-preview-title")).toContainText("OpenAPI 预览");
  await expect(preview.locator(".ep-preview-count")).toContainText("2 个操作");
  await expect(preview.locator(".ep-preview-row")).toHaveCount(2);
  await expect(preview.locator(".ep-preview-meta", { hasText: "健康检查" })).toBeVisible();
  await expect(preview.locator(".ep-preview-meta", { hasText: "system" })).toBeVisible();

  // 点击 GET /health 行 → findScanMatch 命中静态扫描结果 → 跳源码 main.py
  await preview.locator(".ep-preview-row", { hasText: "/health" }).click();
  await expect.poll(() => activeTabName(page), { timeout: 10_000 }).toBe("main.py");
});

test("EP-P2 预览失败态：HttpStatus:500 错误文案", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": MAIN_PY }, commitMsg: "baseline" });
  await boot(page, repo, { fw: fwPreset(repo), openapiFail: "HttpStatus:500" });

  await page.locator("#tab-endpoints").click();
  await expect(page.locator("#ep-results .todo-item", { hasText: "/health" }).first()).toBeVisible({ timeout: 10_000 });
  await setServiceBase(page, "http://127.0.0.1:8000");
  await page.locator("#ep-openapi-preview").click();

  // zh 界面：backendError 层原样返回后端错误（Http* 前缀不翻译）
  const hint = page.locator(".ep-preview-hint--error");
  await expect(hint).toBeVisible({ timeout: 10_000 });
  await expect(hint).toContainText("HttpStatus:500");
});
