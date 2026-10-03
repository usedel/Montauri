/**
 * UI 基线截图工具（`docs/ui_premium_dev_plan.md` §5）。
 *
 * 用途：视觉改造的「基线截图」门禁（方案 §7-14）。改造前/后各跑一次同参数，
 * 逐张比对——**不接受无基线的人工抽查**（本项目曾两次「e2e 全绿但视觉崩」）。
 *
 * 架构：浏览器模式（vite dev :5173 + e2e/mocks/tauri-mock.js 注入 __TAURI_INTERNALS__），
 * 复用 e2e 的 mock 而不引 Tauri 真机——视觉 token 全在 CSS，浏览器模式足够；
 * 真机差异（WebView2 版本、缩放比）由「前后同环境」保证可比。
 *
 * 用法：
 *   node scripts/ui-baseline.mjs --tag before-b1
 *   node scripts/ui-baseline.mjs --tag after-b1
 *   node scripts/ui-baseline.mjs --tag x --out D:\some\dir
 *
 * 产物：<out>/<tag>/<theme>-<view>.png，共 8 张（深/浅 × 编辑区/侧栏/终端/设置）。
 * 默认 out = %TEMP%\opencharm-ui-baseline（**必须落系统 TEMP**：工作区路径会触发
 * safe-delete 批量删除确认门槛，见 playwright.config.ts outputDir 同款约束）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const SHELL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_PATH = join(SHELL_DIR, "e2e", "mocks", "tauri-mock.js");
const DEV_URL = "http://localhost:5173";
const VIEWPORT = { width: 1440, height: 900 };

/** 样例文件：覆盖语法高亮（类/装饰器/字符串/数字）、缩进参考线、行号栏 */
const FIXTURE_FILES = {
  "main.py": [
    '"""OpenCharm UI 基线样例。"""',
    "from dataclasses import dataclass",
    "",
    "@dataclass",
    "class Task:",
    "    name: str",
    "    priority: int = 3",
    "",
    "    def label(self) -> str:",
    '        return f"{self.name}(p{self.priority})"',
    "",
    "",
    "def main() -> None:",
    '    tasks = [Task("write"), Task("review", 5), Task("ship", 1)]',
    "    for t in sorted(tasks, key=lambda x: x.priority):",
    "        print(t.label(), t.priority * 2, True, None)",
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  ].join("\n"),
  "utils.py": [
    "def clamp(value: float, low: float, high: float) -> float:",
    "    return max(low, min(high, value))",
    "",
    "",
    "RETRY_LIMIT = 5",
    "TAGS = (\"ui\", \"baseline\")",
    "",
  ].join("\n"),
  "README.md": "# OpenCharm\n\nUI 基线截图样例工作区。\n",
  "data/config.json": '{\n  "theme": "dark",\n  "fontSize": 14\n}\n',
};

/** git 面板样例：让 SCM 视图带上 M/A/D/U 四种状态色（色相门禁的视觉证据） */
const GIT_STATUS = {
  files: [
    { path: "main.py", x: "M", y: " ", code: "M" },
    { path: "utils.py", x: "A", y: " ", code: "A" },
    { path: "data/config.json", x: "?", y: "?", code: "U" },
    { path: "legacy.py", x: " ", y: "D", code: "D" },
  ],
  is_git: true,
  current_branch: "ui/premium-batch-1",
};

function parseArgs(argv) {
  const out = { tag: "baseline", out: join(tmpdir(), "opencharm-ui-baseline") };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--tag") out.tag = argv[++i];
    else if (a === "--out") out.out = resolve(argv[++i]);
    else throw new Error(`未知参数：${a}`);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** vite dev 已在跑就复用，否则拉起（对齐 playwright.config.ts webServer 的 reuseExistingServer） */
async function ensureDevServer() {
  try {
    const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      console.log("[ui-baseline] 复用已在跑的 vite dev :5173");
      return null;
    }
  } catch {
    /* 未启动 → 下面拉起 */
  }
  console.log("[ui-baseline] 启动 vite dev …");
  const child = spawn("npm", ["run", "dev"], {
    cwd: SHELL_DIR,
    shell: true,
    stdio: "ignore",
    windowsHide: true,
  });
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    try {
      const res = await fetch(DEV_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log("[ui-baseline] vite dev 就绪");
        return child;
      }
    } catch {
      /* 继续等 */
    }
  }
  child.kill();
  throw new Error("vite dev 60s 内未就绪");
}

/** 样例工作区（真实磁盘：文件树/编辑器读的是真文件） */
function makeFixture() {
  const root = join(tmpdir(), "opencharm-ui-baseline-ws");
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(FIXTURE_FILES)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

/** __E2E_BRIDGE__：只实现 UI 渲染必需的通道（其余走 tauri-mock 的静态兜底） */
function makeBridge(repoRoot) {
  return async (channel, cmd, args) => {
    if (channel === "getRecentWorkspaces") return [repoRoot];
    if (channel === "setRecentWorkspaces") return null;
    if (channel === "git") {
      if (cmd === "git_status") return GIT_STATUS;
      if (cmd === "git_branches") return { current: "ui/premium-batch-1", remotes: [] };
      if (cmd === "git_log") return [];
      if (cmd === "git_stash_list") return [];
      return "";
    }
    if (channel === "fs") {
      const p = String(args?.path ?? repoRoot);
      const abs = p.includes(":") || p.startsWith("\\\\") ? p : join(repoRoot, p);
      if (cmd === "read_dir" || cmd === "list_dir") {
        if (!existsSync(abs)) return [];
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

async function settle(page, ms = 700) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(ms);
}

/** 打开设置面板（外观页）。
 *  不用 Ctrl+Alt+S 快捷键：终端 tab 打开后焦点在 xterm 里，快捷键收不到
 *  （实测卡在「#settings-modal 一直 hidden」）。走 menubar 的设置按钮最稳。 */
async function openSettings(page) {
  if (await page.locator("#settings-modal:not(.hidden)").count()) return;
  const btn = page.locator("#btn-settings, button[title='设置']").first();
  if (await btn.count()) {
    await btn.click();
  } else {
    await page.locator("#editor").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+Alt+S");
  }
  await page.locator("#settings-modal").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('.settings-nav-item[data-cat="appearance"]').click();
  await settle(page, 400);
}

async function closeSettings(page) {
  await page.locator("#settings-close").click();
  await page.locator("#settings-modal").waitFor({ state: "hidden", timeout: 10_000 });
}

/** 走真实链路切主题（设置 → 外观 → 色卡 → 保存），与 themePicker.ts 的 radiogroup 语义一致。
 *  仅作备用路径；主路径是每套主题一个独立页面 + __E2E_SETTINGS_PRESET__（见 main）。 */
async function setTheme(page, theme) {
  await openSettings(page);
  await page.locator(`.theme-swatch[data-theme="${theme === "dark" ? "vs-dark" : "vs"}"]`).click();
  await page.locator("#settings-save").click();
  await page.locator("#settings-modal").waitFor({ state: "hidden", timeout: 10_000 });
  await settle(page);
}

async function main() {
  const { tag, out } = parseArgs(process.argv);
  const outDir = join(out, tag);
  mkdirSync(outDir, { recursive: true });
  const devChild = await ensureDevServer();
  const repoRoot = makeFixture();
  const mockSrc = readFileSync(MOCK_PATH, "utf8");
  const browser = await chromium.launch();
  const shots = [];

  /** 每套主题一个**独立页面**，主题经 __E2E_SETTINGS_PRESET__ 在启动时预置。
   *  不用「切色卡再保存」的原因：tauri-mock 的 get_settings 是静态值（save_settings 也不落盘），
   *  应用中途任何一次重新读设置都会把 theme 打回 vs-dark —— 实测浅色轮第 2 张起 Monaco 就变回深色，
   *  而 data-theme 仍留在 light（外壳浅、编辑器深），截图对比会失真。 */
  const newThemedPage = async (theme) => {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await page.addInitScript((t) => {
      window.__E2E_SETTINGS_PRESET__ = { theme: t };
    }, theme === "dark" ? "vs-dark" : "vs");
    await page.addInitScript({ content: mockSrc });
    await page.exposeFunction("__E2E_BRIDGE__", makeBridge(repoRoot));
    await page.goto(DEV_URL, { waitUntil: "domcontentloaded" });
    // 应用就绪：文件树出现
    await page.locator("#tree .tree-item").first().waitFor({ state: "visible", timeout: 30_000 });
    // 主题断言：外壳 data-theme 与 Monaco 主题必须同侧（否则截图不可用于对比）
    const dom = await page.evaluate(() => document.documentElement.dataset.theme ?? "(none)");
    console.log(`[ui-baseline] ${theme}：data-theme=${dom}`);
    return page;
  };

  try {
    for (const theme of ["dark", "light"]) {
      console.log(`[ui-baseline] ${theme} 主题`);
      const page = await newThemedPage(theme);

      const shoot = async (name) => {
        const file = join(outDir, `${name}.png`);
        await page.screenshot({ path: file });
        shots.push(file);
        console.log(`  · ${file}`);
      };

      // ① 编辑区：打开样例文件，等 Monaco 渲染 + 高亮
      await page.locator(".tree-item", { hasText: "main.py" }).first().click();
      await page.locator(".monaco-editor .view-line").first().waitFor({ state: "visible", timeout: 30_000 });
      await settle(page, 1200);
      await shoot(`${theme}-1-editor`);

      // ② 侧栏：Git 视图（M/A/D/U 状态色 + 分支名 + 提交行）
      await page.locator("#tab-git").click();
      await page.locator("#view-git").waitFor({ state: "visible", timeout: 15_000 });
      await settle(page, 900);
      await shoot(`${theme}-2-sidebar`);

      // ③ 设置：外观页（主题色卡 + 字号控件，改色前后差异最集中）
      await openSettings(page);
      await shoot(`${theme}-3-settings`);
      await closeSettings(page);

      // ④ 终端：底部面板切到终端 tab（放最后——xterm 抢焦点会吃掉快捷键）
      await page.locator("#tab-terminal").click();
      await page.locator("#terminal-panel").waitFor({ state: "visible", timeout: 15_000 });
      await settle(page, 900);
      await shoot(`${theme}-4-terminal`);

      await page.close();
    }
  } finally {
    await browser.close();
    if (devChild) devChild.kill();
  }

  console.log(`\n[ui-baseline] 完成：${shots.length} 张 → ${outDir}`);
  for (const s of shots) console.log(`  ${s}`);
}

main().catch((e) => {
  console.error("[ui-baseline] 失败：", e);
  process.exit(1);
});
