/**
 * E2E：F9 新建 FastAPI 项目（2026-09-30，docs/pycharm_framework_support_report.md §8.3.1 / PR-R）
 *
 *  - NP-1 默认「Python 脚本」创建 → main.py 为 def main() 模板（回归）
 *  - NP-2 选 FastAPI 创建 → 工作区切换成功 → main.py 打开且含 app = FastAPI( →
 *        磁盘 pyproject 含 "fastapi" → busy 复位 + 面板关闭
 *  - NP-3 下游零接线：创建完成后（预置 mock 探针状态）「检测到 FastAPI 项目」hint 出现
 *
 * mock 面：create_project 经 bridge 走真实磁盘（helpers.ts dispatchFs）；pip_install
 * 静态返回 0；探针表状态经 __E2E_FRAMEWORK_PRESET__ 预置（同 ux/02-frameworks）。
 * 注意：parent 必须填 repo.root（dispatchFs 的 guard 限仓库根内），项目目录为
 * repo.root/<name>。
 */
import { test, expect, type Page } from "@playwright/test";
import { equipPage, makeGitRepo, type GitRepo } from "../helpers";

interface FrameworkPreset {
  deps?: string;
  hasFastApiApp?: boolean;
}

/** 启动到欢迎页（startEmpty：最近工作区为空 → autoOpenRecentWorkspace 无动作）。
 *  #ew-new-project 可见 ≠ init 完成（wireNewProject 在 init 后段接线，早期点击会被吞）——
 *  再等 invoke 流水出现 list_plugin_dirs（init 中段信号，onboarding OG spec 同款等待）。 */
async function bootEmpty(page: Page, repo: GitRepo, fw?: FrameworkPreset): Promise<void> {
  if (fw) {
    await page.addInitScript((preset) => {
      (window as unknown as { __E2E_FRAMEWORK_PRESET__?: FrameworkPreset }).__E2E_FRAMEWORK_PRESET__ = preset;
    }, fw);
  }
  await equipPage(page, repo, { startEmpty: true });
  await page.goto("/");
  await expect(page.locator("#ew-new-project")).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log = (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
          return log.some((x) => x.startsWith("list_plugin_dirs")) ? 1 : 0;
        }),
      { timeout: 20_000 },
    )
    .toBe(1);
}

/** 打开新建项目面板并填表（名称 / 位置=repo.root / 类型） */
async function openPanelAndFill(page: Page, repo: GitRepo, name: string, type: "script" | "fastapi"): Promise<void> {
  await page.locator("#ew-new-project").click();
  const modal = page.locator("#new-project-modal");
  await expect(modal).toBeVisible();
  // 面板打开复位校验：类型应重置为 script（默认）
  await expect(page.locator("#new-project-type")).toHaveValue("script");
  await page.locator("#new-project-name").fill(name);
  await page.locator("#new-project-location").fill(repo.root);
  if (type !== "script") {
    await page.locator("#new-project-type").selectOption(type);
  }
}

test("NP-1 默认脚本类型：main.py 为 def main() 模板", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo);

  // 预览行：script 无追加说明
  await openPanelAndFill(page, repo, "demo-script", "script");
  await expect(page.locator("#new-project-preview")).toContainText(`将创建于：`);
  await expect(page.locator("#new-project-preview")).not.toContainText("FastAPI");

  await page.locator("#new-project-create").click();
  // 工作区切换成功（树根节点显示新工作区文件夹名；2026-10-18 起树头不再显示全路径）
  await expect(page.locator("#tree .tree-root .name")).toHaveText("demo-script", { timeout: 20_000 });
  await expect(page.locator("#tabbar .tab.active .name", { hasText: "main.py" })).toBeVisible({ timeout: 15_000 });
  // 磁盘：脚本模板（回归——F9 不破坏默认路径）
  expect(repo.read("demo-script/main.py")).toContain("def main()");
  expect(repo.read("demo-script/pyproject.toml")).not.toContain("fastapi");
  // 面板关闭 + busy 复位
  await expect(page.locator("#new-project-modal")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("#new-project-create")).not.toHaveText(/创建中|安装依赖/);
});

test("NP-2 FastAPI 类型：模板 + 依赖落盘 + 全链路反馈", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo);

  await openPanelAndFill(page, repo, "demo-api", "fastapi");
  // 预览行（q2 裁决）：入口 + 依赖说明
  await expect(page.locator("#new-project-preview")).toContainText("FastAPI 服务 入口 main.py + fastapi / uvicorn 依赖");

  await page.locator("#new-project-create").click();
  await expect(page.locator("#tree .tree-root .name")).toHaveText("demo-api", { timeout: 20_000 });
  await expect(page.locator("#tabbar .tab.active .name", { hasText: "main.py" })).toBeVisible({ timeout: 15_000 });

  // 磁盘断言：FastAPI 模板 + pyproject 依赖（mock 模板与 Rust 粗粒度同步）
  const mainPy = repo.read("demo-api/main.py");
  expect(mainPy).toContain("from fastapi import FastAPI");
  expect(mainPy).toContain("app = FastAPI(");
  const pyproject = repo.read("demo-api/pyproject.toml");
  expect(pyproject).toContain("\"fastapi\"");
  expect(pyproject).toContain("\"uvicorn\"");

  // 依赖安装走 pip_install mock（成功路径：不弹失败 toast）
  await expect(page.locator("#toast-stack .toast--error", { hasText: "依赖安装" })).toHaveCount(0);
  // uv add 回显行（cmd 样式，env 域）
  await expect(page.locator("#output .out-line", { hasText: "uv add fastapi uvicorn" })).toBeVisible({ timeout: 10_000 });
  // 面板关闭 + busy 复位
  await expect(page.locator("#new-project-modal")).toBeHidden({ timeout: 10_000 });
  await expect(page.locator("#new-project-create")).not.toHaveText(/创建中|安装依赖/);
});

test("NP-3 下游零接线：FastAPI 项目创建完成后探针 hint 出现", async ({ page }) => {
  // 预置探针状态（deps 含 fastapi + 源码命中）：创建切工作区后 openWorkspace →
  // maybeSuggestFramework → detect_framework 命中 → hint（NP-3 = q4 裁决）
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo, { deps: "fastapi\nuvicorn\n", hasFastApiApp: true });

  await openPanelAndFill(page, repo, "demo-hint", "fastapi");
  await page.locator("#new-project-create").click();

  const hint = page.locator("#output .out-line.hint", { hasText: "检测到 FastAPI 项目" });
  await expect(hint).toBeVisible({ timeout: 20_000 });
  // hint 带一键生成链接（下游 F3 预设链路在 ux/02 FW-2 已覆盖，此处只验入口存在）
  await expect(hint.locator(".out-link", { hasText: "生成「FastAPI」配置并运行" })).toBeVisible();
});

// ---------- 批 1（2026-10-11 体验审查：docs/project_dep_health_ux_review.md）----------
// C-2 防重入 / C-3 关面板时机 / C-4 展开输出面板 / C-6 预览行双态 / C-9 成功汇总

/** 统计 invoke 流水里某命令的调用次数（流水条目形如 `create_project(parentDir,name,…)`） */
async function invokeCount(page: Page, cmd: string): Promise<number> {
  return page.evaluate((c) => {
    const log = (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
    return log.filter((x) => x.startsWith(`${c}(`)).length;
  }, cmd);
}

test("NP-4（C-2）防重入：创建中连按 Enter 只发起一次 create_project", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo);
  await openPanelAndFill(page, repo, "demo-guard", "script");

  // 同一 tick 内连发两次 Enter（复刻 Enter 连按 / 双击的竞态）——守卫必须在首个 await 前同步置位
  await page.locator("#new-project-name").evaluate((el) => {
    const ev: KeyboardEventInit = { key: "Enter", bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", ev));
    el.dispatchEvent(new KeyboardEvent("keydown", ev));
  });

  // 第二次触发给明确提示（而非静默吞掉，或重复落盘后报「目标已存在」）
  await expect(page.locator("#toast-stack .toast--info", { hasText: "正在创建上一个项目" })).toBeVisible();
  // 等流程走完再数：竞态下第二次若真跑起来，此处必然是 2
  await expect(page.locator("#new-project-modal")).toBeHidden({ timeout: 20_000 });
  expect(await invokeCount(page, "create_project")).toBe(1);
});

test("NP-5（C-3/C-4）创建流程：进入环境/依赖阶段前已关面板并展开输出面板", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  // 预置「输出面板已收起」——C-4 的判据正是创建流程把它重新展开（否则进度被模态压暗又不可见）
  await page.addInitScript(() => localStorage.setItem("opencharm.bottom_collapsed", "1"));
  await bootEmpty(page, repo);
  await expect(page.locator("#bottom")).toHaveClass(/collapsed/);

  await openPanelAndFill(page, repo, "demo-bottom", "fastapi");
  await page.locator("#new-project-create").click();

  // C-3：③④（建环境 / 装依赖）跑起来时模态必须已经关闭——uv add 回显出现即为 ③④ 已进入
  await expect(page.locator("#output .out-line", { hasText: "uv add fastapi uvicorn" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#new-project-modal")).toBeHidden();
  // C-4：输出面板被展开
  await expect(page.locator("#bottom")).not.toHaveClass(/collapsed/);
});

test("NP-6（C-9）创建成功：汇总 toast 带路径/依赖数 + FastAPI「运行 main.py」动作", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo);
  await openPanelAndFill(page, repo, "demo-summary", "fastapi");
  await page.locator("#new-project-create").click();

  const summary = page.locator("#toast-stack .toast--success", { hasText: "项目已创建" });
  await expect(summary).toBeVisible({ timeout: 25_000 });
  await expect(summary).toContainText("demo-summary"); // 路径
  await expect(summary).toContainText("已安装 2 个依赖"); // pip_install mock 返回 0 → 计为已装
  await expect(summary.locator(".toast-action", { hasText: "运行 main.py" })).toBeVisible();
});

test("NP-7（C-6）校验失败：预览行走错误态（danger 类 + 图标），修正后恢复弱化预览", async ({ page }) => {
  const repo = await makeGitRepo({ files: { "keep.py": "print('keep')\n" }, commitMsg: "baseline" });
  await bootEmpty(page, repo);
  await page.locator("#ew-new-project").click();
  await expect(page.locator("#new-project-modal")).toBeVisible();

  const preview = page.locator("#new-project-preview");
  await page.locator("#new-project-location").fill(repo.root);
  await page.locator("#new-project-create").click(); // 名称留空 → 前端预检拦截
  await expect(preview).toHaveClass(/new-project-error/);
  await expect(preview).toContainText("请填写项目名称和位置");
  await expect(preview.locator(".codicon-error")).toBeVisible();

  // 修正输入 → 回到「将创建于…」弱化预览态（错误类清除）
  await page.locator("#new-project-name").fill("demo-err");
  await expect(preview).not.toHaveClass(/new-project-error/);
  await expect(preview).toContainText("将创建于：");
});
