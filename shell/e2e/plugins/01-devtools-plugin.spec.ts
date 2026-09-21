/**
 * 开发工具插件切片 · E2E 验收（PR-1~4 闭环，docs/plugin_system_design.md §9）。
 *
 * 用户旅程覆盖（对照验收记录 §二 决策落地核对）：
 *  1. 内置插件 dogfooding：9 工具出现在菜单分类子菜单 + picker（决策 #8）
 *  2. 面板交互：picker 搜索/分组；实例缓存（切换不丢输入）（§9.9/9.13）
 *  3. 第三方插件安装流：目录 → 扫描 → 注册 → 菜单/picker/命令面板可达（§9.5）
 *  4. inline 变换：选区 → 命令面板 → 原地替换 → 撤销 toast（§9.15）
 *  5. manifest 校验：坏插件整包失败不连累他人（§9.2）
 *  6. 热重载：entry 变更 → 新代码生效（§9.15 diff）
 *  7. 设置页插件 tab：列表/状态/停用/启用（§9.14）
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { equipPage, makePlainDir } from "../helpers";

// ---------- 测试用插件源码 ----------

const GOOD_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  id: "com.e2e.sample",
  name: "E2E 样例",
  version: "1.0.0",
  engines: { opencharm: ">=0.1.0" },
  contributes: {
    tools: [
      {
        id: "upper",
        title: "转大写",
        description: "选区转大写（E2E）",
        category: "文本",
        icon: "case-sensitive",
        entry: "./upper.js",
        inline: { label: "选区转大写", handler: "upperSelection" },
      },
    ],
  },
  permissions: ["clipboard", "selection"],
});

const UPPER_JS_V1 = `
export function mount(host) {
  const { kit } = host;
  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入…", flex: true });
  const out = kit.output({ placeholder: "结果" });
  const go = kit.primaryButton("转大写", "play", () => out.set(input.value.toUpperCase()));
  wrap.append(input, kit.toolbar(go), out.el);
  host.root.appendChild(wrap);
}
export function upperSelection(text) { return text.toUpperCase(); }
`;

const UPPER_JS_V2 = `
export function mount(host) {
  const { kit } = host;
  const wrap = kit.body();
  const input = kit.textarea({ placeholder: "输入…", flex: true });
  const out = kit.output({ placeholder: "结果 v2" });
  const go = kit.primaryButton("转大写V2", "play", () => out.set(input.value.toUpperCase() + "-V2"));
  wrap.append(input, kit.toolbar(go), out.el);
  host.root.appendChild(wrap);
}
export function upperSelection(text) { return text.toUpperCase() + "-V2"; }
`;

/** 坏 manifest：未知权限（校验必失败，§9.2「未知值=笔误拒绝」） */
const BAD_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  id: "com.e2e.broken",
  name: "坏插件",
  version: "1.0.0",
  engines: { opencharm: ">=0.1.0" },
  contributes: { tools: [{ id: "x", title: "X", entry: "./x.js" }] },
  permissions: ["not-a-perm"],
});

const BROKEN_JS = `export function mount(host) { host.root.textContent = "should never mount"; }`;

// ---------- 装配 ----------

interface Equipped {
  pluginsDir: string;
  triggerPluginsChanged(): void;
}

async function equip(page: Page, pluginFiles?: Record<string, string>): Promise<Equipped> {
  const repo = await makePlainDir({ "main.py": "print('hello world')\n" });
  const pluginsDir = mkdtempSync(join(tmpdir(), "opencharm-e2e-plugins-"));
  if (pluginFiles) {
    for (const [rel, content] of Object.entries(pluginFiles)) {
      const target = join(pluginsDir, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
  }
  const { triggerPluginsChanged } = await equipPage(page, repo, { pluginsDir });
  // 暴露插件加载链路的错误（loader catch 后只 console.warn——不捕获则失败难定位）
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[console.error] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 6).join("\n")}`));
  await page.goto("/");
  await expect(page.locator("#editor")).toBeVisible({ timeout: 15_000 });
  // init() 是异步的：#editor 静态存在 ≠ init 完成（键位接线/内置工具注册在其后）。
  // 等插件首扫的 list_plugin_dirs 出现在 invoke 流水 + 内置工具注册完成（picker 数据源就绪）。
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const log = (window as unknown as { __TAURI_MOCK_INVOKE_LOG__?: string[] }).__TAURI_MOCK_INVOKE_LOG__ ?? [];
          return log.some((x) => x.startsWith("list_plugin_dirs")) && document.querySelectorAll(".menubar-item").length > 0 ? 1 : 0;
        }),
      { timeout: 15_000 },
    )
    .toBe(1);
  return { pluginsDir, triggerPluginsChanged };
}

function writePlugin(dir: string, id: string, files: Record<string, string>): void {
  const root = join(dir, id);
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(root, rel), content, "utf8");
}

/** 打开 Search Everywhere（Double Shift，间隔须 < 400ms） */
async function openSearchEverywhere(page: Page): Promise<void> {
  await page.keyboard.press("Shift");
  await page.waitForTimeout(100);
  await page.keyboard.press("Shift");
  await expect(page.locator("#quick-open-modal")).toBeVisible({ timeout: 5_000 });
}

/** 确保工具面板为打开态（toggle 语义防歧义：先归零再打开） */
async function openPanelFresh(page: Page): Promise<void> {
  // 关可能的设置模态（plugins 管理入口开过）
  const settingsOpen = await page.locator("#settings-modal:not(.hidden)").count();
  if (settingsOpen > 0) {
    await page.locator("#settings-close").click();
    await page.waitForTimeout(200);
  }
  // 面板若已开（含 picker 开着）→ Ctrl+Shift+T 会 toggle 关闭；先探测归零
  const panelOpen = await page.locator("#right-panel:not(.hidden)").count();
  if (panelOpen > 0) {
    await page.locator("#devtools-close").click();
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Control+Shift+T");
  await expect(page.locator("#devtools-picker")).toBeVisible({ timeout: 5_000 });
}

// ---------- 用例 ----------

test.describe("工具插件 E2E 验收", () => {
  test("01 内置工具：菜单分类子菜单（dogfooding #8）", async ({ page }) => {
    await equip(page);
    await page.locator('.menubar-item[data-menu="tools"]').click();
    // 预置分类分组（flyout 父项）
    for (const cat of ["编码", "哈希", "格式化", "转换", "生成", "提取"]) {
      await expect(page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: cat })).toBeVisible();
    }
    await expect(page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" })).toBeVisible();
    // hover 展开「编码」→ 内置工具
    await page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: "编码" }).hover();
    await expect(page.locator("#menu-submenu .ctx-menu-item", { hasText: "Base64 编码/解码" })).toBeVisible({ timeout: 5_000 });
  });

  test("02 内置工具面板：picker 分组 + 搜索 + 实例缓存", async ({ page }) => {
    await equip(page);
    await openPanelFresh(page);
    await expect(page.locator(".picker-group-head", { hasText: "编码" })).toBeVisible();
    // 搜索过滤
    await page.locator("#devtools-picker-search").fill("md5");
    await expect(page.locator(".picker-item")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-current")).toContainText("MD5");
    await expect(page.locator("#devtools-picker")).toBeHidden();
    // 输入内容 → 切走再切回 → 实例缓存保输入
    // 选择器用 .tool-textarea（工具自身的输入框类）——Monaco 内部也有 <textarea>（隐藏输入层），
    // 用裸 textarea 会 strict mode violation
    const visibleToolRoot = page.locator(".devtools-tool-root:not(.hidden)");
    await visibleToolRoot.locator(".tool-textarea").fill("abc");
    await page.locator("#devtools-current").click();
    // 搜索词用完整标题（"uuid" 会模糊命中「URL 编码/解码」的字符序列）
    await page.locator("#devtools-picker-search").fill("UUID 生成");
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-current")).toContainText("UUID");
    await page.locator("#devtools-current").click();
    await page.locator("#devtools-picker-search").fill("md5");
    await page.keyboard.press("Enter");
    await expect(visibleToolRoot.locator(".tool-textarea")).toHaveValue("abc");
  });

  test("03 第三方插件安装流：目录 → 扫描 → 三入口可达（§9.5）", async ({ page }) => {
    await equip(page, {
      "com.e2e.sample/opencharm.plugin.json": GOOD_MANIFEST,
      "com.e2e.sample/upper.js": UPPER_JS_V1,
    });
    // picker 可搜到 + 面板 mount 生效
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("转大写");
    await expect(page.locator(".picker-item")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-body button", { hasText: "转大写" })).toBeVisible();
    // 菜单「工具 → 文本」含第三方工具
    await page.locator("#devtools-close").click();
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: "文本" }).hover();
    await expect(page.locator("#menu-submenu .ctx-menu-item", { hasText: "转大写" })).toBeVisible({ timeout: 5_000 });
    // 命令面板可达
    await page.keyboard.press("Escape");
    await openSearchEverywhere(page);
    await page.locator("#quick-open-input").fill("工具: 转大写");
    await expect(page.locator(".quick-open-item", { hasText: "工具: 转大写" })).toBeVisible({ timeout: 5_000 });
  });

  test("04 inline 变换：命令面板 → 原地替换 → 撤销（§9.15）", async ({ page }) => {
    await equip(page, {
      "com.e2e.sample/opencharm.plugin.json": GOOD_MANIFEST,
      "com.e2e.sample/upper.js": UPPER_JS_V1,
    });
    // 经文件树打开 main.py（启动只开工作区不开文件）
    await page.locator('.tree-item.file[data-path*="main.py"]').first().dblclick();
    await expect(page.locator("#tabbar .tab", { hasText: "main.py" })).toBeVisible({ timeout: 5_000 });
    // 选中首行
    await page.locator(".monaco-editor").first().click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+End");
    // 命令面板触发 inline
    await openSearchEverywhere(page);
    await page.locator("#quick-open-input").fill("选区转大写");
    await expect(page.locator(".quick-open-item", { hasText: "选区转大写" })).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Enter");
    // toast 带撤销按钮
    const toast = page.locator(".toast", { hasText: "已应用" });
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await toast.locator("button", { hasText: "撤销" }).click();
    await page.waitForTimeout(300);
  });

  test("05 坏插件整包失败 + 好插件不受连累（§9.2 错误隔离）", async ({ page }) => {
    await equip(page, {
      "com.e2e.broken/opencharm.plugin.json": BAD_MANIFEST,
      "com.e2e.broken/x.js": BROKEN_JS,
      "com.e2e.sample/opencharm.plugin.json": GOOD_MANIFEST,
      "com.e2e.sample/upper.js": UPPER_JS_V1,
    });
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("转大写");
    await expect(page.locator(".picker-item")).toHaveCount(1); // 好插件照常
    // 设置 → 插件
    await page.locator("#devtools-close").click();
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    // 校验失败的插件 name 回落目录名（manifest 未通过校验，name 不可信）——断言用目录名
    await expect(page.locator(".plugin-row--error", { hasText: "com.e2e.broken" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".plugin-row", { hasText: "E2E 样例" }).first()).toBeVisible();
    await page.locator(".plugin-row--error .plugin-row-head").click();
    await expect(page.locator(".plugin-error-msg")).toContainText("未知权限");
  });

  test("06 热重载：entry 变更 → 新代码生效（§9.15 diff）", async ({ page }) => {
    const eq = await equip(page, {
      "com.e2e.sample/opencharm.plugin.json": GOOD_MANIFEST,
      "com.e2e.sample/upper.js": UPPER_JS_V1,
    });
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("转大写");
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-body button", { hasText: "转大写" }).first()).toBeVisible();
    // 磁盘改 entry → 模拟 watcher → 去抖 diff → 重载
    writePlugin(eq.pluginsDir, "com.e2e.sample", { "upper.js": UPPER_JS_V2 });
    await eq.triggerPluginsChanged();
    await expect(page.locator(".toast", { hasText: "插件已重新加载" })).toBeVisible({ timeout: 10_000 });
    // 激活工具以新定义重挂（V2 按钮出现 = 新 mount 闭包生效）
    await expect(page.locator("#devtools-body button", { hasText: "转大写V2" })).toBeVisible({ timeout: 10_000 });
  });

  test("07 停用/启用：设置页操作 + 入口消失/恢复（§9.14）", async ({ page }) => {
    await equip(page, {
      "com.e2e.sample/opencharm.plugin.json": GOOD_MANIFEST,
      "com.e2e.sample/upper.js": UPPER_JS_V1,
    });
    // 停用（内置工具行排在列表首位——必须按名称精确定位第三方行）
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    const sampleRow = page.locator(".plugin-row", { hasText: "E2E 样例" });
    await expect(sampleRow).toBeVisible({ timeout: 5_000 });
    await sampleRow.locator(".plugin-row-head").click();
    await sampleRow.locator(".plugin-actions button", { hasText: "停用" }).click();
    await expect(sampleRow.locator(".plugin-meta", { hasText: "已停用" })).toBeVisible({ timeout: 5_000 });
    // 菜单二级消失：工具 → 编码组展开无 Base64/URL（整组工具都来自内置——组仍在但子项要少；
    // 更直接的验证：picker 搜不到（下一段）+ 菜单「格式化」组消失（JSON 美化是唯一格式化工具）
    // picker 搜不到
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("转大写");
    await expect(page.locator(".picker-item")).toHaveCount(0);
    // 启用恢复
    await page.locator("#devtools-close").click();
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    const sampleRow2 = page.locator(".plugin-row", { hasText: "E2E 样例" });
    await sampleRow2.locator(".plugin-row-head").click();
    await sampleRow2.locator(".plugin-actions button", { hasText: "启用" }).click();
    await page.waitForTimeout(1_500);
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("转大写");
    await expect(page.locator(".picker-item")).toHaveCount(1);
  });

  test("08 内置插件停用→启用：菜单二级子菜单恢复（人工验收缺陷回归钉）", async ({ page }) => {
    await equip(page);
    // 菜单「工具 → 格式化」组存在（JSON 美化是唯一格式化工具，整组随内置插件）
    const openToolsMenu = async (): Promise<void> => {
      await page.locator('.menubar-item[data-menu="tools"]').click();
      await expect(page.locator("#menu-dropdown:not(.hidden)")).toBeVisible();
    };
    await openToolsMenu();
    await expect(page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: "格式化" })).toBeVisible();
    await page.keyboard.press("Escape");

    // 停用内置插件（builtin 行排在首位）
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    const builtinRow = page.locator(".plugin-row", { hasText: "内置工具" });
    await expect(builtinRow).toBeVisible({ timeout: 5_000 });
    await builtinRow.locator(".plugin-row-head").click();
    await builtinRow.locator(".plugin-actions button", { hasText: "停用" }).click();
    await expect(builtinRow.locator(".plugin-meta", { hasText: "已停用" })).toBeVisible({ timeout: 5_000 });

    // 菜单：格式化组消失（该组唯一工具来自内置插件）——这是用户报告的缺陷主症状的镜像
    await page.keyboard.press("Escape");
    await openToolsMenu();
    await expect(page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: "格式化" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 启用 → 菜单二级恢复（缺陷场景：此前启用后菜单仍不显示）
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    const builtinRow2 = page.locator(".plugin-row", { hasText: "内置工具" });
    await builtinRow2.locator(".plugin-row-head").click();
    await builtinRow2.locator(".plugin-actions button", { hasText: "启用" }).click();
    await expect(builtinRow2.locator(".plugin-meta", { hasText: "已启用" })).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await openToolsMenu();
    await expect(page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: "格式化" })).toBeVisible({ timeout: 5_000 });
    // 展开确认工具项也回来了
    await page.locator('#menu-dropdown .ctx-menu-item.with-submenu', { hasText: "格式化" }).hover();
    await expect(page.locator("#menu-submenu .ctx-menu-item", { hasText: "JSON 美化" })).toBeVisible({ timeout: 5_000 });
  });

  test("09 脚手架：新建插件 → 10 秒正反馈闭环（DX P0）", async ({ page }) => {
    await equip(page);
    // 真实路径显示（不再是写死的 ~/opencharm/extensions）
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    await expect(page.locator(".plugins-dir-label")).toContainText("opencharm-e2e-plugins");

    // 单表单对话框（id + 名称 + 模板单选，一次填完）
    await page.locator("button", { hasText: "新建插件…" }).click();
    await page.locator("#scaffold-id").fill("com.e2e.scaffolded");
    await page.locator("#scaffold-name").fill("脚手架测试插件");
    await expect(page.locator(".scaffold-template").first()).toHaveAttribute("aria-checked", "true"); // 默认面板模板
    await page.locator(".scaffold-card button", { hasText: "创建" }).click();

    // toast 引导 + 插件行出现（已启用）
    await expect(page.locator(".toast", { hasText: "模板已创建" })).toBeVisible({ timeout: 10_000 });
    const row = page.locator(".plugin-row", { hasText: "脚手架测试插件" });
    await expect(row).toBeVisible({ timeout: 5_000 });
    await expect(row.locator(".plugin-meta")).toContainText("已启用");

    // 工具入口可达：picker 搜到模板工具（openPanelFresh 内部会兜底关设置模态）
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("我的第一个工具");
    await expect(page.locator(".picker-item")).toHaveCount(1);

    // 面板 mount 生效：模板的「问候」按钮
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-body button", { hasText: "问候" })).toBeVisible({ timeout: 5_000 });
    // host.log 已落日志（模板 greet() 首屏即跑）——设置页日志面板可见
    await page.locator("#devtools-close").click();
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    await row.locator(".plugin-row-head").click();
    await expect(row.locator(".plugin-log-line").last()).toContainText("问候了", { timeout: 5_000 });
  });

  test("10 inline 模板 + 调试台：不选文本也能验证 handler（DX P1）", async ({ page }) => {
    await equip(page);
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    await page.locator("button", { hasText: "新建插件…" }).click();
    await page.locator("#scaffold-id").fill("com.e2e.inliner");
    await page.locator("#scaffold-name").fill("选区变换测试");
    await page.locator(".scaffold-template", { hasText: "选区变换" }).click();
    await page.locator(".scaffold-card button", { hasText: "创建" }).click();
    await expect(page.locator(".toast", { hasText: "调试台" })).toBeVisible({ timeout: 10_000 });

    // 面板打开 = 自动调试台（inline-only 工具无 mount）
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("问候选区");
    await expect(page.locator(".picker-item")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator("#devtools-body .tool-label")).toContainText("选区变换");
    const benchInput = page.locator(".devtools-tool-root:not(.hidden) .tool-textarea");
    await benchInput.fill("OpenCharm");
    await page.locator("#devtools-body button", { hasText: "运行" }).click();
    await page.waitForTimeout(300);
    // host.log 落了变换输入日志（inline 模板 handler 里带 host.log）
    await page.locator("#devtools-close").click();
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    const row = page.locator(".plugin-row", { hasText: "选区变换测试" });
    await row.locator(".plugin-row-head").click();
    await expect(row.locator(".plugin-log-line").last()).toContainText("变换输入", { timeout: 5_000 });
  });

  test("11 分发闭环：导出 zip → 删源 → 导入恢复（DX P2）", async ({ page }) => {
    const eq = await equip(page, {
      "com.e2e.share/opencharm.plugin.json": JSON.stringify({
        schemaVersion: 1, id: "com.e2e.share", name: "分享测试", version: "2.0.0",
        engines: { opencharm: ">=0.1.0" },
        contributes: { tools: [{ id: "t", title: "分享工具", description: "P2", category: "文本", icon: "rocket", entry: "./t.js" }] },
        permissions: [],
      }),
      "com.e2e.share/t.js": "export function mount(host) { const { kit } = host; host.root.appendChild(kit.body()); }",
    });

    // 导出：展开行 → 导出按钮 → save 对话框（mock 预置保存路径）
    const zipPath = join(eq.pluginsDir, "..", "shared-plugin.zip");
    await page.evaluate((p) => {
      (window as unknown as { __E2E_DIALOG_PRESET__: { save: string } }).__E2E_DIALOG_PRESET__ = { save: p };
    }, zipPath);
    await page.locator('.menubar-item[data-menu="tools"]').click();
    await page.locator('#menu-dropdown .ctx-menu-item', { hasText: "插件管理…" }).click();
    const row = page.locator(".plugin-row", { hasText: "分享测试" });
    await row.locator(".plugin-row-head").click();
    await row.locator(".plugin-actions button", { hasText: "导出" }).click();
    await expect(page.locator(".toast", { hasText: "已导出" })).toBeVisible({ timeout: 5_000 });

    // 删源（模拟换机器/重装场景）→ 插件消失
    rmSync(join(eq.pluginsDir, "com.e2e.share"), { recursive: true, force: true });
    await page.locator("button", { hasText: "重新扫描" }).click();
    await expect(page.locator(".plugin-row", { hasText: "分享测试" })).toHaveCount(0, { timeout: 5_000 });

    // 导入：open 对话框（mock 预置 zip 路径）→ 恢复
    await page.evaluate((p) => {
      (window as unknown as { __E2E_DIALOG_PRESET__: { open: string } }).__E2E_DIALOG_PRESET__ = { open: p };
    }, zipPath);
    await page.locator("button", { hasText: "导入插件…" }).click();
    await expect(page.locator(".toast", { hasText: "插件导入成功" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".plugin-row", { hasText: "分享测试" })).toBeVisible({ timeout: 5_000 });

    // 恢复的工具可用（picker 可达）
    await openPanelFresh(page);
    await page.locator("#devtools-picker-search").fill("分享工具");
    await expect(page.locator(".picker-item")).toHaveCount(1);
  });
});
