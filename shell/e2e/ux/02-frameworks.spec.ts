/**
 * E2E：框架支持第一档验收（2026-09-26，docs/pycharm_framework_support_report.md §8.3）
 *
 *  - FW-1 F0 裁决 B：Pydantic 栈 → 引擎推荐提示 + 一键切换 basedpyright（chip 变化 + 行内状态）
 *  - FW-2 F1 探针表：FastAPI 提示 + 一键生成项目运行配置（写入 project_run 的形状）
 *  - FW-3 工作区级关闭开关持久：不再提示 → reload 后 FastAPI 提示不再出现（Pydantic 提示仍在）
 *  - FW-4 F1 端点侧栏：按方法分组渲染 + 点击跳转声明
 *  - FW-5 F2/F4：行内浏览器打开 / 复制 URL（base 注入 + 无 base 提示）+ /docs、/openapi.json 入口
 *  - EP-S1~S5 A5① 请求样例：参数表 / 请求体 JSON / cURL 三段渲染、一键复制与送进 HTTP 工具、
 *    展开态单例与缓存、失败态文案、Flask 说明与 WS 不给发送入口
 *
 * mock 面跑在 tauri-mock.js（detect_framework / detect_pydantic_stack / scan_endpoints /
 * scan_endpoint_sample / set_framework_hint_disabled / project_run / open_external /
 * copy_to_clipboard 记录），服务 base 经 __OC_E2E_SERVICE__（termUi E2E 钩子）注入，
 * 请求样例经 __E2E_EP_SAMPLE__ 预置。真实签名解析（含跨行签名、嵌套模型、alias）与
 * cURL 文本生成由 Rust 单测 ep_sample_cmds 与前端单测 epSample.test.ts 覆盖，
 * 本组只验前端渲染与动作接线。真实 LSP 语义（basedpyright 候选观感）在浏览器 mock
 * 无法触达，由 bench/pydantic-probe 实测记录覆盖。
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
  deps?: string;
  hasFastApiApp?: boolean;
  hasFlaskApp?: boolean;
  hasManagePy?: boolean;
  pydanticStack?: boolean;
  endpoints?: EndpointSample[];
}

async function activeTabName(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector("#tabbar .tab.active .name")?.textContent ?? null);
}

async function boot(page: Page, repo: GitRepo, fw?: FrameworkPreset): Promise<void> {
  if (fw) {
    // PRESET 须先于 tauri-mock 注入（addInitScript 按序执行；mock 首次读状态时合并 PRESET）
    await page.addInitScript((preset) => {
      (window as unknown as { __E2E_FRAMEWORK_PRESET__?: FrameworkPreset }).__E2E_FRAMEWORK_PRESET__ = preset;
    }, fw);
  }
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
}

const hintLine = (page: Page, text: string) =>
  page.locator("#output .out-line.hint", { hasText: text });

// ---------- FW-1：Pydantic 栈（阶段 1 撤销推荐后的行为） ----------

test("FW-1 Pydantic 栈：不出现引擎推荐（已撤销），FastAPI 探针表照常", async ({ page }) => {
  const repo = await makeGitRepo({
    files: { "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" },
    commitMsg: "baseline",
  });
  await boot(page, repo, { deps: "fastapi\npydantic\n", hasFastApiApp: true, pydanticStack: true });

  // 阶段 1（docs/pyrefly_pydantic_support_plan.md §3.1）撤销「推荐切 basedpyright」：
  // Pydantic 栈不再产生任何引擎推荐提示
  await expect(hintLine(page, "检测到 Pydantic 栈")).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator("#output .out-line", { hasText: "basedpyright" })).toHaveCount(0);
  // 引擎保持 pyrefly（不被静默切换——历史原则）
  await expect(page.locator("#status-engine")).toContainText("pyrefly");
  // 同一工作区：FastAPI 探针表提示照常（推荐撤销不影响框架探针）
  await expect(hintLine(page, "检测到 FastAPI 项目（main.py）")).toBeVisible({ timeout: 15_000 });
});

// ---------- FW-2：探针表一键生成运行配置 ----------

test("FW-2 FastAPI 提示 + 一键生成项目运行配置", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" }, commitMsg: "baseline" });
  await boot(page, repo, { deps: "fastapi\nuvicorn\n", hasFastApiApp: true, pydanticStack: false });

  const fa = hintLine(page, "检测到 FastAPI 项目（main.py）");
  await expect(fa).toBeVisible({ timeout: 15_000 });
  // pydanticStack=false → 引擎推荐提示不得出现
  await expect(hintLine(page, "检测到 Pydantic 栈")).toHaveCount(0);

  await fa.locator(".out-link", { hasText: "生成「FastAPI」配置并运行" }).click();
  // 写入项目配置的形状（对齐 Rust FrameworkPreset：entry/args/cwd；mock 侧捕获 set_project_run）
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __E2E_PROJECT_RUN__?: { entry: { kind: string; target: string }; args: string; cwd: string } | null }).__E2E_PROJECT_RUN__ ?? null),
  ).toEqual(expect.objectContaining({
    entry: { kind: "module", target: "uvicorn" },
    args: "main:app --reload",
    cwd: "${workspaceRoot}",
  }));
});

// ---------- FW-3：工作区级关闭开关持久（reload 验证） ----------

test("FW-3 不再提示持久化：reload 后 FastAPI 提示不再出现", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" }, commitMsg: "baseline" });
  await boot(page, repo, { deps: "fastapi\npydantic\n", hasFastApiApp: true, pydanticStack: true });

  const fa = hintLine(page, "检测到 FastAPI 项目（main.py）");
  await expect(fa).toBeVisible({ timeout: 15_000 });
  await fa.locator(".out-link", { hasText: "不再提示" }).click();
  await expect(fa.getByText("（已关闭本工作区提示）")).toBeVisible();

  // reload（模拟重启）：mock hints 从 sessionStorage 恢复 → FastAPI 提示不再出现
  await page.reload();
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await expect(hintLine(page, "检测到 FastAPI 项目")).toHaveCount(0, { timeout: 15_000 });
  // 阶段 1 撤销推荐：Pydantic 引擎提示本就不存在（与关闭开关无关）
  await expect(hintLine(page, "检测到 Pydantic 栈")).toHaveCount(0, { timeout: 8_000 });
});

// ---------- FW-4：端点侧栏分组与跳转 ----------

test("FW-4 端点侧栏按方法分组 + 点击跳转声明", async ({ page }) => {
  const repo = await makeGitRepo({
    files: {
      "main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get(\"/health\")\nasync def health(): ...\n",
      "routes/users.py": "@router.get(\"/users/{uid}\")\ndef get_user(uid: int): ...\n",
      "routes/ws.py": "@router.websocket(\"/ws\")\nasync def ws(): ...\n",
    },
    commitMsg: "baseline",
  });
  await boot(page, repo, {
    // file 与 Rust 真实形状对齐（scan_endpoints 返回绝对路径——openFile → read_file 只认绝对）
    endpoints: [
      { framework: "fastapi", method: "GET", route: "/health", file: repo.abs("main.py"), line: 5, handler: "health" },
      { framework: "fastapi", method: "POST", route: "/v1/api/users", file: repo.abs("main.py"), line: 9, handler: "create_user" },
      { framework: "fastapi", method: "GET", route: "/v1/api/users/{uid}", file: repo.abs("routes/users.py"), line: 12, handler: "get_user" },
      { framework: "fastapi", method: "WS", route: "/v1/api/ws", file: repo.abs("routes/ws.py"), line: 3, handler: "ws_echo" },
    ],
  });

  await page.locator("#tab-endpoints").click();
  const list = page.locator("#ep-results");
  await expect(list).toBeVisible();
  // 分组：GET×2 / POST×1 / WS×1（组序按 METHOD_ORDER）
  await expect(list.locator(".todo-group-header", { hasText: "GET" }).locator(".todo-group-count")).toHaveText("2");
  await expect(list.locator(".todo-group-header", { hasText: "POST" }).locator(".todo-group-count")).toHaveText("1");
  await expect(list.locator(".todo-group-header", { hasText: "WS" }).locator(".todo-group-count")).toHaveText("1");
  await expect(list.locator(".ep-route", { hasText: "/v1/api/users/{uid}" })).toBeVisible();

  // 点击 /health 行 → 跳转声明（main.py 第 5 行）
  await list.locator(".todo-item", { hasText: "/health" }).first().click();
  await expect.poll(() => activeTabName(page), { timeout: 10_000 }).toBe("main.py");
});

// ---------- FW-5/6：F2 直达浏览器 / 复制 URL / F4 /docs 入口 ----------

test("FW-5 端点打开与复制：无 base 提示先运行，注入 base 后落点正确", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "app = FastAPI()\n" }, commitMsg: "baseline" });
  await boot(page, repo, {
    endpoints: [{ framework: "fastapi", method: "GET", route: "/health", file: "main.py", line: 5, handler: "health" }],
  });
  await page.locator("#tab-endpoints").click();
  const row = page.locator("#ep-results .todo-item", { hasText: "/health" }).first();
  await expect(row).toBeVisible();
  const getUrls = () => page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? []);

  // 无 base（服务未运行）：提示先运行，不触发 open_external
  await row.locator(".ep-action").first().click();
  await expect(page.locator("#toast-stack .toast", { hasText: "服务未运行" })).toBeVisible();
  expect(await getUrls()).toEqual([]);

  // 注入 base（termUi E2E 钩子，替代真实终端就绪行）→ 打开与复制的落点 URL 正确
  await page.evaluate(() =>
    (window as unknown as { __OC_E2E_SERVICE__?: { setServiceBase: (u: string | null) => void } }).__OC_E2E_SERVICE__?.setServiceBase("http://127.0.0.1:8000"),
  );
  await row.locator(".ep-action").first().click();
  await expect.poll(() => getUrls()).toContain("http://127.0.0.1:8000/health");

  await row.locator(".ep-action").nth(1).click();
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __E2E_COPIED__?: string[] }).__E2E_COPIED__ ?? []),
  ).toContain("http://127.0.0.1:8000/health");
});

test("FW-6 /docs 与 /openapi.json 固定入口", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "app = FastAPI()\n" }, commitMsg: "baseline" });
  await boot(page, repo);
  await page.locator("#tab-endpoints").click();
  await expect(page.locator("#ep-toolbar")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __OC_E2E_SERVICE__?: { setServiceBase: (u: string | null) => void } }).__OC_E2E_SERVICE__?.setServiceBase("http://127.0.0.1:8000"),
  );
  await page.locator("#ep-open-docs").click();
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? []),
  ).toContain("http://127.0.0.1:8000/docs");
  await page.locator("#ep-open-openapi").click();
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? []),
  ).toContain("http://127.0.0.1:8000/openapi.json");
});

// ---------- EP-S：A5① 请求样例（handler 签名 + Pydantic 模型 → 参数表 / JSON / cURL） ----------

interface EpParamPreset {
  kind: string;
  name: string;
  type_text: string;
  required: boolean;
  default: string | null;
  value_text: string;
  note: string | null;
}

interface EpSamplePreset {
  params?: EpParamPreset[];
  body_model?: string | null;
  body_fields?: { name: string; type_text: string; required: boolean; value: string }[];
  body_json?: string | null;
  notes?: string[];
}

function epParam(over: Partial<EpParamPreset>): EpParamPreset {
  return {
    kind: "query",
    name: "p",
    type_text: "str",
    required: false,
    default: null,
    value_text: "x",
    note: null,
    ...over,
  };
}

const SAMPLE_FILE = "main.py";
const SAMPLE_LINE = 7;

async function bootWithSample(
  page: Page,
  repo: GitRepo,
  preset: EpSamplePreset,
  endpoint?: Partial<EndpointSample>,
): Promise<void> {
  // PRESET 须先于 tauri-mock 注入（addInitScript 按序执行；mock 在 invoke 时才读）
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_EP_SAMPLE__?: unknown }).__E2E_EP_SAMPLE__ = p;
  }, preset);
  await boot(page, repo, {
    endpoints: [
      {
        framework: "fastapi",
        method: "POST",
        route: "/users/{uid}",
        file: repo.abs(SAMPLE_FILE),
        line: SAMPLE_LINE,
        handler: "create_user",
        ...endpoint,
      },
    ],
  });
}

/** 注入服务 base（替代真实终端就绪行解析）——cURL / 完整 URL 断言需要 */
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

/** 已发出的 scan_endpoint_sample 次数（缓存命中判据：应保持 1） */
const sampleInvokes = (page: Page) =>
  page.evaluate(
    () =>
      ((window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? []).filter(
        (c) => c.startsWith("scan_endpoint_sample"),
      ).length,
  );

const FULL_SAMPLE: EpSamplePreset = {
  params: [
    epParam({ kind: "path", name: "uid", type_text: "int", required: true, value_text: "0" }),
    epParam({ kind: "query", name: "q", type_text: "str", required: true, value_text: "string" }),
    epParam({ kind: "query", name: "limit", type_text: "int", default: "10", value_text: "0" }),
    epParam({ kind: "body", name: "body", type_text: "UserIn", required: true, value_text: "" }),
    epParam({ kind: "skip", name: "db", type_text: "Session", value_text: "", note: "dependency" }),
  ],
  body_model: "UserIn",
  body_fields: [
    { name: "name", type_text: "str", required: true, value: '"string"' },
    { name: "age", type_text: "int", required: false, value: "0" },
  ],
  body_json: '{\n  "name": "string",\n  "age": 0\n}',
  notes: [],
};

test("EP-S1 请求样例：参数表 / 请求体 JSON / cURL 三段渲染", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\n" }, commitMsg: "baseline" });
  await bootWithSample(page, repo, FULL_SAMPLE);
  await setServiceBase(page, "http://127.0.0.1:8000");

  await page.locator("#tab-endpoints").click();
  const row = page.locator("#ep-results .todo-item", { hasText: "/users/{uid}" }).first();
  await expect(row).toBeVisible();
  // 动作序：open(0) / copy(1) / sample(2) / send(3)
  await row.locator(".ep-action").nth(2).click();

  const box = page.locator("#ep-results .ep-sample");
  await expect(box).toBeVisible();
  await expect(box.locator(".ep-sample-title")).toContainText("POST /users/{uid} → create_user()");

  // 参数表：5 行，path 行标「路径」，跳过行压暗并给出原因
  await expect(box.locator(".ep-sample-table tbody tr")).toHaveCount(5);
  await expect(box.locator(".ep-sample-table tbody tr").first()).toContainText("路径");
  await expect(box.locator(".ep-sample-row--skip")).toContainText("依赖注入");
  // 必填列：uid 必填 / limit 有默认值 → 非必填
  await expect(box.locator(".ep-sample-table tbody tr").first()).toContainText("是");

  // 请求体：模型名进标题，JSON 原样
  await expect(box.locator(".ep-sample-label", { hasText: "UserIn" })).toBeVisible();
  await expect(box.locator("#ep-sample-body")).toContainText('"name": "string"');

  // cURL：path 已替换 + query 已串接 + Content-Type / -d
  const curl = box.locator("#ep-sample-curl");
  await expect(curl).toContainText("curl -X POST");
  await expect(curl).toContainText("http://127.0.0.1:8000/users/0?q=string&limit=0");
  await expect(curl).toContainText("Content-Type: application/json");
  await expect(curl).toContainText("-d '{\"name\":\"string\",\"age\":0}'");
});

test("EP-S2 一键 cURL：复制到剪贴板 + 送进 HTTP 工具（方法 / 请求体预填）", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\n" }, commitMsg: "baseline" });
  await bootWithSample(page, repo, FULL_SAMPLE);
  await setServiceBase(page, "http://127.0.0.1:8000");

  await page.locator("#tab-endpoints").click();
  const row = page.locator("#ep-results .todo-item", { hasText: "/users/{uid}" }).first();
  await row.locator(".ep-action").nth(2).click();
  const box = page.locator("#ep-results .ep-sample");
  await expect(box).toBeVisible();

  await box.locator("#ep-sample-copy-curl").click();
  await expect
    .poll(async () => (await copiedTexts(page)).some((c) => c.includes("curl -X POST") && c.includes("/users/0")))
    .toBe(true);
  await expect(page.locator("#toast-stack .toast", { hasText: "已复制 cURL" })).toBeVisible();

  // 送进 B4 HTTP 工具：URL / 方法 / 请求体三项都要落到面板控件
  await box.locator("#ep-sample-send").click();
  await expect(page.locator("#devtools-body .http-url")).toHaveValue("http://127.0.0.1:8000/users/0?q=string&limit=0");
  await expect(page.locator("#devtools-body .http-method")).toHaveValue("POST");
  await expect(page.locator("#devtools-body textarea.http-body")).toHaveValue('{"name":"string","age":0}');
});

test("EP-S3 展开态单例 + 缓存：收起再开不重复取数，换行只留一个块", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\n" }, commitMsg: "baseline" });
  await bootWithSample(page, repo, FULL_SAMPLE);
  await page.locator("#tab-endpoints").click();
  const row = page.locator("#ep-results .todo-item", { hasText: "/users/{uid}" }).first();
  const sample = row.locator(".ep-action").nth(2);

  await sample.click();
  await expect(page.locator("#ep-results .ep-sample")).toHaveCount(1);
  await expect.poll(() => sampleInvokes(page)).toBe(1);

  // 收起
  await sample.click();
  await expect(page.locator("#ep-results .ep-sample")).toHaveCount(0);

  // 重开：命中缓存 → invoke 次数不增
  await sample.click();
  await expect(page.locator("#ep-results .ep-sample")).toHaveCount(1);
  expect(await sampleInvokes(page)).toBe(1);
});

test("EP-S4 解析失败：错误提示走语言包（不吞错）", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\n" }, commitMsg: "baseline" });
  await page.addInitScript(() => {
    (window as unknown as { __E2E_EP_SAMPLE_FAIL__?: string }).__E2E_EP_SAMPLE_FAIL__ = "boom";
  });
  await boot(page, repo, {
    endpoints: [
      {
        framework: "fastapi",
        method: "GET",
        route: "/health",
        file: repo.abs("main.py"),
        line: 5,
        handler: "health",
      },
    ],
  });
  await page.locator("#tab-endpoints").click();
  const row = page.locator("#ep-results .todo-item", { hasText: "/health" }).first();
  await row.locator(".ep-action").nth(2).click();
  await expect(page.locator("#ep-results .ep-sample-hint--error")).toContainText("解析失败：boom");
});

test("EP-S5 Flask 说明照实说；WS 不提供「送进 HTTP 工具」", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "main.py": "from fastapi import FastAPI\n" }, commitMsg: "baseline" });
  // Flask 端点：给说明码，前端必须照实渲染（不假装能推断）
  await page.addInitScript((p) => {
    (window as unknown as { __E2E_EP_SAMPLE__?: unknown }).__E2E_EP_SAMPLE__ = p;
  }, {
    params: [epParam({ kind: "path", name: "iid", type_text: "", required: true, value_text: "" })],
    body_model: null,
    body_fields: [],
    body_json: null,
    notes: ["flask_scope"],
  } as EpSamplePreset);
  await boot(page, repo, {
    endpoints: [
      {
        framework: "flask",
        method: "GET",
        route: "/item/<int:iid>",
        file: repo.abs("main.py"),
        line: 3,
        handler: "item",
      },
      {
        framework: "fastapi",
        method: "WS",
        route: "/ws",
        file: repo.abs("main.py"),
        line: 5,
        handler: "ws_echo",
      },
    ],
  });
  await page.locator("#tab-endpoints").click();

  const flaskRow = page.locator("#ep-results .todo-item", { hasText: "/item/" }).first();
  await flaskRow.locator(".ep-action").nth(2).click();
  const box = page.locator("#ep-results .ep-sample");
  await expect(box.locator(".ep-sample-hint--note")).toContainText("Flask 端点");
  await expect(box.locator(".ep-sample-hint--muted")).toContainText("未识别到请求体");

  // WS 端点：样例可看，但不该出现「送进 HTTP 工具」（HTTP 方法表里没有 WS）
  const wsRow = page.locator("#ep-results .todo-item", { hasText: "/ws" }).first();
  await wsRow.locator(".ep-action").nth(2).click();
  await expect(page.locator("#ep-results .ep-sample")).toHaveCount(1);
  await expect(page.locator("#ep-sample-send")).toHaveCount(0);
});
