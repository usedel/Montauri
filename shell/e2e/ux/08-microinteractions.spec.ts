/**
 * E2E（微交互批 T2/T3/T4/T6）：状态栏光标芯片 + 字号缩放 + tab 拖拽 + 括号参考线开关。
 *
 * T2-1：光标移动 → 芯片实时更新「行/列」；选中文字 → 追加字符计数
 * T2-2：点击芯片 → 打开跳行（quickOpen line 模式，Ctrl+G 同入口）
 * T3-1：Ctrl+滚轮缩放字号（既有 P25-T08 链路的回归 + 状态栏字号读数联动）
 * T3-2：Ctrl+0 一键复位默认字号
 * T4：tab 拖拽排序（拖 main.py 到末位，顺序变化）
 * T6a：括号对参考线设置开关默认开（buildEditorOptions 接线的产品级断言）
 *
 * 注：T1（树侧运行指示）的运行态注入无 mock 控制面，其 class 注入链路与
 * has-error 同构（24 spec C 用例已覆盖渲染路径），运行态真值由 runState 单测锁定，
 * 此处不写「直接加 class 验 CSS」的无意义断言。
 */
import { test, expect } from "@playwright/test";
import { equipPage, makePlainDir } from "../helpers";

const SRC = "def greet(name):\n    return 'hello ' + name\n\nprint(greet('world'))\n";

test.beforeEach(async ({ page }) => {
  const repo = await makePlainDir({ "main.py": SRC, "b_second.py": "b = 2\n", "c_third.py": "c = 3\n" });
  await equipPage(page, repo);
  await page.goto("/");
  await expect(page.locator("#tree")).toContainText("main.py", { timeout: 20_000 });
});

test("T2-1：光标位置芯片随移动更新，选中追加计数", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 10_000 });

  // 树 dblclick 后焦点留在树（focusEditor:false 语义）——点击编辑器把焦点交给 Monaco
  //（否则后续键盘事件全部丢失；探针实测验证过此路径）
  const box = await editor.boundingBox();
  if (box) await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);

  const chip = page.locator("#status-cursor");
  await expect(chip).toBeVisible({ timeout: 10_000 });
  // 打开后光标在 1:1（或 viewState 恢复位）——先断言有「行/列」形态
  await expect(chip).toContainText(/行 \d+，列 \d+/, { timeout: 10_000 });

  // 键盘移动光标到 2:1
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await expect(chip).toContainText("行 2", { timeout: 5_000 });

  // 选中一串字符（Shift+End 选到行尾）
  await page.keyboard.press("Shift+End");
  await expect(chip).toContainText(/\d+ 个字符已选择/, { timeout: 5_000 });

  // 取消选择（按方向键）→ 回到纯位置形态
  await page.keyboard.press("End");
  await expect(chip).not.toContainText("已选择", { timeout: 5_000 });
});

test("T2-2：点击芯片 → 跳行弹窗（quickOpen line 模式）", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  const chip = page.locator("#status-cursor");
  await expect(chip).toBeVisible({ timeout: 10_000 });

  await chip.click();
  // quickOpen 弹窗出现（动态创建的 #quick-open-input；line 模式占位符带「行」语义）
  const input = page.locator("#quick-open-input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  // line 模式断言（区分于 files/symbol 模式，防模式串台）
  await expect(input).toHaveAttribute("placeholder", /行|line/i, { timeout: 5_000 });
});

test("T3-1：Ctrl+滚轮缩放，状态栏字号读数联动", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 10_000 });

  const before = await page.locator("#status-font").textContent();
  expect(before).toContain("14"); // DEFAULT_SETTINGS.font_size

  // Ctrl+滚轮放大两档：Playwright mouse.wheel 不支持修饰键，用 dispatchEvent 直发
  // （wheel 监听挂在编辑器 DOM 上，判 ctrlKey + deltaY 方向）
  await editor.evaluate((node) => {
    for (const dir of [-120, -120]) {
      node.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: dir, bubbles: true, cancelable: true }));
    }
  });
  await expect(page.locator("#status-font")).toContainText("16", { timeout: 5_000 });
});

test("T3-2：Ctrl+0 一键复位默认字号", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 10_000 });

  // 先放大到 16
  await editor.evaluate((node) => {
    for (const dir of [-120, -120]) {
      node.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: dir, bubbles: true, cancelable: true }));
    }
  });
  await expect(page.locator("#status-font")).toContainText("16", { timeout: 5_000 });

  // Ctrl+0 → 回到默认 14
  await editor.click();
  await page.keyboard.press("Control+0");
  await expect(page.locator("#status-font")).toContainText("14", { timeout: 5_000 });
});

test("T4：tab 拖拽排序——拖 main.py 到 c_third.py 后半区，main 移到末位", async ({ page }) => {
  // 打开三个文件（树顺序字母序：b_second / c_third / main）
  for (const name of ["main.py", "b_second.py", "c_third.py"]) {
    await page.locator("#tree .tree-item", { hasText: name }).first().dblclick();
  }
  await expect(page.locator(".tab")).toHaveCount(3, { timeout: 10_000 });

  // 断言初始顺序 = 打开顺序：main / b_second / c_third
  let names = await page.locator(".tab .name").allTextContents();
  expect(names[0]).toContain("main.py");
  expect(names[2]).toContain("c_third.py");

  // 拖 main.py（首个）到 c_third.py（末个）的后半区 → main 移到末尾
  const src = page.locator(".tab", { hasText: "main.py" }).first();
  const dst = page.locator(".tab", { hasText: "c_third.py" }).first();
  const sBox = await src.boundingBox();
  const dBox = await dst.boundingBox();
  expect(sBox).toBeTruthy();
  expect(dBox).toBeTruthy();
  if (sBox && dBox) {
    await page.mouse.move(sBox.x + sBox.width * 0.3, sBox.y + sBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(dBox.x + dBox.width * 0.75, dBox.y + dBox.height * 0.5, { steps: 5 });
    await page.mouse.up();
  }

  names = await page.locator(".tab .name").allTextContents();
  expect(names[2]).toContain("main.py"); // main 移到末尾
  expect(names[0]).toContain("b_second"); // 其余相对顺序保持
});

test("T6a：括号对参考线设置开关默认开（三步接线的产品级断言）", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 10_000 });

  // 设置面板 → 切「编辑器」分类（默认激活「外观」，checkbox 在隐藏分区）
  await page.locator("#btn-settings").click();
  await page.locator('.settings-nav-item[data-cat="editor"]').click();
  const sw = page.locator("#settings-bracket-pair-guides");
  await expect(sw).toBeVisible({ timeout: 10_000 });
  await expect(sw).toBeChecked(); // 默认开（buildEditorOptions 接线的产品级断言）
  await page.keyboard.press("Escape");
});

test("T6b：编辑器右键「显示空白字符」切换（toast 反馈 + 再切回）", async ({ page }) => {
  await page.locator("#tree .tree-item", { hasText: "main.py" }).first().dblclick();
  const editor = page.locator(".monaco-editor").first();
  await expect(editor).toBeVisible({ timeout: 10_000 });

  // 编辑器内右键 → Monaco contextmenu 出现「显示空白字符」项
  const box = await editor.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4, { button: "right" });
  const item = page.locator(".monaco-action-bar .action-item", { hasText: "显示空白字符" });
  await expect(item).toBeVisible({ timeout: 5_000 });
  await item.click();

  // 开启 toast（状态可感知）
  await expect(page.locator(".toast--info", { hasText: "已显示空白字符" })).toBeVisible({ timeout: 5_000 });

  // 再切回（右键 → 同一菜单项）：关闭 toast
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4, { button: "right" });
  const item2 = page.locator(".monaco-action-bar .action-item", { hasText: "显示空白字符" });
  await expect(item2).toBeVisible({ timeout: 5_000 });
  await item2.click();
  await expect(page.locator(".toast--info", { hasText: "已隐藏空白字符" })).toBeVisible({ timeout: 5_000 });
});
