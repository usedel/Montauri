/**
 * E2E：inlay hints——PR-N 参数名提示（dx_features_backlog §6.8）+ 跳变治理 B（2026-10-12）
 *
 * 走**真实 pyrefly 桥**（equipPage realPyrefly）：提示是引擎侧能力，
 * mock 的 LSP 替身没有 inlayHint 实现，只有真机桥能证明整条链路：
 *   startEngine 就绪 → didChangeConfiguration 推 callArgumentNames="all"
 *   → Monaco provider 拿到 textDocument/inlayHint → 调用处渲染灰字 `a= / b=`。
 *
 *  - E-DX-IP1 默认开：调用处出现参数名提示（`a=` 与 `b=`）
 *  - E-DX-IP2 设置关掉后提示消失（配置经 didChangeConfiguration 即时生效，无需重启引擎）
 *  - E-DX-IP3 变量类型提示在名字后（引擎原位）+ 光标行冻结（变形不跳变，跨行解冻）
 *  - E-DX-IP4 引擎丢弃提示时冻结区原位复活（消失型跳变，输入 `.` 实案）
 *
 * 前置：本机安装 pyrefly（ci/versions.toml 锁 1.3.1；本机 1.3.0，探针同口径）。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo } from "../helpers";

const LIB_PY = [
  "def add_score(a, b):",
  '    """Return the sum of two integers."""',
  "    return a + b",
  "",
].join("\n");

const MAIN_PY = [
  "from lib import add_score",
  "",
  "class Session:",
  "    def post(self, url: str) -> int:",
  "        return 1",
  "",
  "",
  "def fake_req():",
  "    sess = Session()",
  "    r2 = sess",
  "    req = sess.post",
  "",
  "",
  "total = add_score(2, 3)",
  "print(total)",
  "",
].join("\n");

// ⚠ 必须有 pyproject.toml：pyrefly 从它发现工作区并启动索引（引用计数那次的同款教训），
// 没有它连变量类型提示都不给（实测 engineResult = []）。
const PYPROJECT = '[project]\nname = "probe"\nversion = "0.1.0"\n';

let stopPyrefly: (() => void) | undefined;
const pageErrors: string[] = [];

async function openFile(page: Page, name: string): Promise<void> {
  await page.locator("#tree .tree-item .name", { hasText: name }).first().dblclick();
  await expect(page.locator("#editor .monaco-editor")).toBeVisible({ timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const repo = await makeGitRepo({
    files: { "pyproject.toml": PYPROJECT, "lib.py": LIB_PY, "main.py": MAIN_PY },
    commitMsg: "baseline",
  });
  const equipped = await equipPage(page, repo, { realPyrefly: true });
  stopPyrefly = equipped.stopPyrefly;
  await page.goto("/");
  await expect(page.locator("#status-git")).toContainText("main", { timeout: 20_000 });
  await expect(page.locator("#status-lsp")).toContainText("就绪", { timeout: 30_000 });
  // 行内提示总开关默认关（2026-10-15 用户裁决）：本 spec 断言提示可见，须显式打开
  await page.keyboard.press("Control+Alt+S");
  await expect(page.locator("#settings-modal, .modal:has(#settings-save)").first()).toBeVisible({ timeout: 5_000 });
  await page.locator('.settings-nav-item[data-cat="editor"]').click();
  await page.locator("#settings-inlay-type-hints").check();
  await page.locator("#settings-save").click();
  await expect(page.locator("#settings-modal")).toBeHidden({ timeout: 5_000 });
  await openFile(page, "main.py");
});

test.afterEach(async () => {
  stopPyrefly?.();
  stopPyrefly = undefined;
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});

test("E-DX-IP1 真实 pyrefly：调用处出现参数名提示", async ({ page }) => {
  // ⚠ hasText 定位：不能用 "add_score(2, 3)"（提示插入后整行渲染成 "add_score(a= 2, 3)"），
  //   也不能只用 "add_score"（会先命中 import 行）——用 "add_score(" 唯一命中调用行
  const line = page.locator("#editor .monaco-editor .view-line", { hasText: "add_score(" }).first();
  await expect(line).toBeVisible({ timeout: 10_000 });
  // 引擎侧 150ms 防抖 + provider 异步：轮询等待提示渲染
  await expect.poll(async () => (await line.textContent()) ?? "", { timeout: 20_000 }).toContain("a=");
  expect(await line.textContent()).toContain("b=");
});

test("E-DX-IP2 关闭设置后参数名提示消失", async ({ page }) => {
  const line = page.locator("#editor .monaco-editor .view-line", { hasText: "add_score(" }).first();
  await expect.poll(async () => (await line.textContent()) ?? "", { timeout: 20_000 }).toContain("a=");

  await page.keyboard.press("Control+Alt+S");
  await expect(page.locator("#settings-modal, .modal:has(#settings-save)").first()).toBeVisible({ timeout: 5_000 });
  await page.locator('.settings-nav-item[data-cat="editor"]').click();
  await page.locator("#settings-inlay-param-hints").uncheck();
  await page.locator("#settings-save").click();
  await expect(page.locator("#settings-modal")).toBeHidden({ timeout: 5_000 });

  // 引擎侧防抖 150ms；关掉后不再有参数名提示（变量类型提示仍可能由引擎默认给出，不在本断言内）
  await expect
    .poll(async () => ((await line.textContent()) ?? "").includes("a="), { timeout: 20_000 })
    .toBe(false);
});

// 跳变治理 B（2026-10-12，用户裁决推翻同日 A 方案的行尾锚定）：提示保持引擎原位
// （变量名后，PyCharm 式），光标行「列 ≤ 光标列」的提示冻结——光标停留期间沿用上次
// 渲染标签，跨行离开后才应用新值。动机：行尾编辑时类型塌缩（方法签名 → 返回值）令
// 光标前注入宽度突变 ±25 字符 → 光标视觉左跳；冻结后光标停留期间视觉零变化。
test("E-DX-IP3 变量提示在名字后 + 光标行冻结", async ({ page }) => {
  // ⚠ Monaco inlay 渲染会把提示文本中的空格替换为不换行空格 \u00a0（fixSpace），
  //   断言串必须同款替换，否则「看起来包含」永远匹配不上（E-DX-IP1 的 "a=" 段
  //   不含空格所以从未踩到）。
  const nb = (s: string): string => s.replace(/ /g, "\u00a0");
  const line = page.locator("#editor .monaco-editor .view-line").nth(10); // `req = sess.post`（IP4 夹具加行后从 9 → 10）
  // ① 提示在名字后（引擎原位，B 方案回退 A 的行尾锚定）
  await expect
    .poll(async () => (await line.textContent()) ?? "", { timeout: 20_000 })
    .toContain(nb("req: (url: str) -> int = sess.post"));
  // ② 光标行冻结：光标定位行尾，输入 `(`（Monaco 自动补全成 `()`）令类型塌缩为
  //   `: int`（post 的返回值）——光标仍在本行，冻结生效：旧标签不动、新值不穿透
  await line.click({ position: { x: 30, y: 8 } });
  await page.keyboard.press("End");
  await page.keyboard.type("(");
  await page.waitForTimeout(2500); // Monaco 打字防抖 1250ms + 引擎 150ms + 余量
  const during = (await line.textContent()) ?? "";
  expect(during).toContain(nb("req: (url: str) -> int")); // 冻结：旧标签仍在
  expect(during).not.toContain(nb("req: int =")); // 塌缩新值未穿透
  // ③ 点击其它行（光标跨行离开）→ 解冻 → 塌缩新值上屏
  await page.locator("#editor .monaco-editor .view-line").nth(12).click({ position: { x: 30, y: 8 } });
  await expect
    .poll(async () => (await line.textContent()) ?? "", { timeout: 10_000 })
    .toContain(nb("req: int ="));
});

// 消失型跳变（2026-10-12 用户实案 + 探针实证）：`r2 = sess` 有 `: Session`，输入 `.`
// 成不完整属性访问后 pyrefly **整条丢弃**提示——注入文本消失 = 光标前宽度塌缩 = 左跳，
// 与标签变形同病。修复：冻结区未被配对的缓存类型提示，锚点守卫（该列前仍是完整标识符）
// 通过则原位复活；光标离开后引擎真值（无提示）照常生效。
test("E-DX-IP4 引擎丢弃提示时冻结区原位复活（输入 `.` 不消失）", async ({ page }) => {
  const nb = (s: string): string => s.replace(/ /g, "\u00a0");
  const line = page.locator("#editor .monaco-editor .view-line").nth(9); // `r2 = sess`
  // ① 变量引用赋值 → `: Session` 上屏（探针实证的 pyrefly 形态）
  await expect
    .poll(async () => (await line.textContent()) ?? "", { timeout: 20_000 })
    .toContain(nb("r2: Session = sess"));
  // ② 行尾输入 `.` → 不完整属性访问，引擎丢弃提示；光标仍在本行 → 复活守卫保旧值不消失
  await line.click({ position: { x: 30, y: 8 } });
  await page.keyboard.press("End");
  await page.keyboard.type(".");
  await page.waitForTimeout(2500); // 跨 Monaco 1250ms 防抖，确保「丢弃」的那轮重查已发生
  expect(await line.textContent()).toContain(nb("r2: Session")); // 未消失（复活生效）
  // ③ 光标跨行离开 → 解冻 → 引擎真值（无提示）生效，复活不残留
  await page.locator("#editor .monaco-editor .view-line").nth(13).click({ position: { x: 30, y: 8 } });
  await expect
    .poll(async () => (await line.textContent()) ?? "", { timeout: 10_000 })
    .not.toContain("Session");
});
