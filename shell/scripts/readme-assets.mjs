/**
 * README 首屏素材生成器（对外分发用；**不进 CI 门禁**，不参与预算统计）。
 *
 * 为什么单独一份脚本：`ui-baseline.mjs` 是视觉回归基线，它的样例工作区带 Git 假状态、
 * 输出面板里还有 tauri-mock 未实现通道的红字提示——适合比对，不适合给路人看第一眼。
 * 本脚本复用同一套 mock/起服务机制，只换一份贴产品画像（FastAPI + 爬虫 + 小脚本）的
 * 干净样例，并收起底部面板，产出可直接放进 README 的 hero 图。
 *
 * 用法（在 shell/ 下执行）：
 *   node scripts/readme-assets.mjs                 # 深 / 浅两张
 *   node scripts/readme-assets.mjs --theme dark   # 只出深色
 *   node scripts/readme-assets.mjs --out D:\some\dir
 *
 * 产物：<out>/hero-dark.png、<out>/hero-light.png（默认 <repo>/docs/assets/）。
 * 零新增依赖：vite dev + tauri-mock + @playwright/test 都是仓库既有设施。
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const SHELL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SHELL_DIR, "..");
const MOCK_PATH = join(SHELL_DIR, "e2e", "mocks", "tauri-mock.js");
const DEV_URL = "http://localhost:5173";
const VIEWPORT = { width: 1440, height: 900 };
const EDITOR_THEME = { dark: "montauri-dark", light: "montauri-light" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 演示工作区：文件树与编辑器读真实临时文件，不依赖任何 Python 环境或第三方包。 */
const FIXTURE = {
  "app.py": [
    '"""Price Watch —— FastAPI + 爬虫 + 小脚本的最小闭环。"""',
    "",
    "from fastapi import FastAPI",
    "from pydantic import BaseModel",
    "from scraper import fetch_rows",
    "",
    'app = FastAPI(title="price-watch")',
    "",
    "",
    "class Item(BaseModel):",
    "    name: str",
    "    price: float",
    "    url: str",
    "",
    "",
    '@app.get("/items")',
    "async def list_items(limit: int = 20, tag: str | None = None) -> list[Item]:",
    '    """返回最近抓取的商品；跑过一次后，rows 的形状会进入运行时补全。"""',
    "    rows = await fetch_rows(limit, tag)",
    "    return [Item(**row) for row in rows]",
    "",
    "",
    '@app.get("/health")',
    "def health() -> dict[str, str]:",
    '    return {"status": "ok"}',
    "",
  ].join("\n"),
  "scraper.py": [
    '"""极简抓取器：运行 → traceback 跳转 → 运行时补全的演示入口。"""',
    "import json",
    "from urllib.request import urlopen",
    "",
    "",
    "def fetch_rows(limit: int = 20, tag: str | None = None) -> list[dict]:",
    '    with urlopen("https://example.com/items.json", timeout=10) as resp:',
    "        items = json.load(resp)",
    "    rows = [i for i in items if tag is None or i.get(\"tag\") == tag]",
    "    return rows[:limit]",
    "",
  ].join("\n"),
  "test_app.py": [
    "from app import health",
    "",
    "",
    "def test_health() -> None:",
    '    assert health() == {"status": "ok"}',
    "",
  ].join("\n"),
  "README.md": "# Price Watch\n\nMontauri 演示工作区（由 scripts/readme-assets.mjs 生成）。\n",
};

function parseArgs(argv) {
  const out = { themes: ["dark", "light"], outDir: join(ROOT, "docs", "assets") };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--theme") {
      const t = argv[++i];
      if (!EDITOR_THEME[t]) throw new Error(`未知主题：${t}`);
      out.themes = [t];
    } else if (a === "--out") out.outDir = resolve(argv[++i]);
    else throw new Error(`未知参数：${a}`);
  }
  return out;
}

/** vite dev 已在跑就复用，否则拉起（同 ui-baseline.mjs / playwright.config.ts 口径）。 */
async function ensureDevServer() {
  try {
    const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log("[readme-assets] 复用已在跑的 vite dev :5173");
      return null;
    }
  } catch { /* 未启动 → 下面拉起 */ }
  console.log("[readme-assets] 启动 vite dev …");
  const child = spawn("npm", ["run", "dev"], {
    cwd: SHELL_DIR, shell: true, stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    try {
      const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log("[readme-assets] vite dev 就绪");
        return child;
      }
    } catch { /* 继续等 */ }
  }
  child.kill();
  throw new Error("vite dev 60s 内未就绪");
}

function makeFixture() {
  const root = join(tmpdir(), "montauri-readme-demo-ws");
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(FIXTURE)) {
    writeFileSync(join(root, rel), content, "utf8");
  }
  return root;
}

/** 只实现 UI 渲染必需的通道，其余走 tauri-mock 静态兜底（同 ui-baseline.mjs）。 */
function makeBridge(repoRoot) {
  return async (channel, cmd, args) => {
    if (channel === "getRecentWorkspaces") return [repoRoot];
    if (channel === "setRecentWorkspaces") return null;
    if (channel === "git") {
      if (cmd === "git_status") return { files: [], is_git: true, current_branch: "main" };
      if (cmd === "git_branches") return { current: "main", remotes: [] };
      if (cmd === "git_log" || cmd === "git_stash_list") return [];
      return "";
    }
    if (channel === "fs") {
      const p = String(args?.path ?? repoRoot);
      const abs = p.includes(":") || p.startsWith("\\\\") ? p : join(repoRoot, p);
      if (cmd === "read_dir" || cmd === "list_dir") {
        return readdirSync(abs, { withFileTypes: true })
          .filter((e) => !e.name.startsWith("."))
          .map((e) => ({ name: e.name, path: join(abs, e.name), is_dir: e.isDirectory() }));
      }
      if (cmd === "read_file") return readFileSync(abs, "utf8");
      if (cmd === "watch_start" || cmd === "watch_stop") return null;
      return null;
    }
    return null;
  };
}

/** 清掉只属于 mock 环境的视觉噪声：底部面板的未实现提示 + 无解释器 toast。 */
async function cleanStage(page) {
  await page.evaluate(() => {
    const bottom = document.getElementById("bottom");
    if (bottom) bottom.style.display = "none";
    document.getElementById("toast-stack")?.remove();
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(700);
  await page.evaluate(() => document.getElementById("toast-stack")?.remove());
}

async function main() {
  const { themes, outDir } = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });
  const devChild = await ensureDevServer();
  const repoRoot = makeFixture();
  const mockSrc = readFileSync(MOCK_PATH, "utf8");
  const browser = await chromium.launch();
  try {
    for (const theme of themes) {
      // 每套主题一个独立页面：tauri-mock 的 get_settings 不落盘，切色卡会被中途重读打回深色。
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      await page.addInitScript((t) => { window.__E2E_SETTINGS_PRESET__ = { theme: t }; }, EDITOR_THEME[theme]);
      await page.addInitScript({ content: mockSrc });
      await page.exposeFunction("__E2E_BRIDGE__", makeBridge(repoRoot));
      await page.goto(DEV_URL, { waitUntil: "domcontentloaded" });
      await page.locator("#tree .tree-item").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.locator(".tree-item", { hasText: "app.py" }).first().click();
      await page.locator(".monaco-editor .view-line").first().waitFor({ state: "visible", timeout: 30_000 });
      await cleanStage(page);
      const file = join(outDir, `hero-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(`[readme-assets] ${file}`);
      await page.close();
    }
  } finally {
    await browser.close();
    if (devChild) devChild.kill();
  }
}

main().catch((e) => {
  console.error("[readme-assets] 失败：", e);
  process.exit(1);
});
