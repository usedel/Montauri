/**
 * E2E：批 4 · Monaco 自定义主题 opencharm-dark / opencharm-light。
 *
 * ## 为什么单测钉不住、必须上 e2e
 *
 * themeTokens.test.ts 能证明「映射表是对的」「变量两套都有定义」「没有残留出厂名」，
 * 但证明不了 **defineTheme 的色值真的落到了编辑器上**。而这一环恰恰最容易静默失效：
 * CSS 变量未定义 → defineTheme 静默跳过该槽位 → 编辑器用 base 主题（vs-dark）的颜色，
 * 界面看起来「正常」，只是所有表面色和语法色都悄悄退回出厂值。
 *
 * 断言选**出厂主题与本主题差异最大**的槽位，否则测不出真伪：
 *  · 选区 —— 出厂 #add6ff（蓝）vs 本项目 --selected #d3efeb（青绿染色，ADR-0005）；
 *    ⚠ 而 editor.background 浅色下两边都是纯白（--surface-2 = #ffffff），根本无法区分；
 *  · 缩进参考线 —— 出厂 #d3d3d3 / #404040 vs 本项目 --surface-3 #f7f7f8 / #2a2a30；
 *  · 语法色 —— 出厂 identifier #9cdcfe（浅蓝）vs 本项目 #7ce3cd（青绿），另有 keyword 紫轴。
 */
import { test, expect } from "@playwright/test";
import { equipPage, makePlainDir, type GitRepo } from "../helpers";

/** 深色侧 token 值（style.css :root；与 themeTokens.test.ts 同源） */
const DARK = {
  editorBg: "rgb(31, 31, 36)", // --surface-2 #1f1f24（0x24 = 36）
  selected: "rgb(38, 67, 63)", // --selected    #26433f
  lineHighlight: "rgb(36, 36, 41)", // --editor-line-highlight #242429（0x24=36, 0x29=41）
  syntaxVar: "rgb(124, 227, 205)", // --syntax-var    #7ce3cd 青绿
  syntaxKeyword: "rgb(197, 134, 192)", // --syntax-boolean #c586c0 紫
  legacyVar: "rgb(156, 220, 254)", // 旧 #9cdcfe 浅蓝 —— 必须不出现
  legacyKeyword: "rgb(86, 156, 214)", // 旧 #569cd6 蓝 —— 必须不出现
};

/** 浅色侧 token 值（style.css [data-theme="light"]） */
const LIGHT = {
  editorBg: "rgb(255, 255, 255)", // --surface-2 #ffffff
  selected: "rgb(211, 239, 235)", // --selected    #d3efeb
  indent: "rgb(247, 247, 248)", // --surface-3  #f7f7f8
  syntaxVar: "rgb(14, 114, 97)", // --syntax-var    #0e7261
  legacyVar: "rgb(0, 16, 128)", // 旧 #001080 深蓝 —— 必须不出现
  legacyKeyword: "rgb(0, 0, 255)", // 旧 #0000ff 纯蓝 —— 必须不出现
};

// 覆盖全部 7 类 token：变量名（identifier）/ 字符串 / 数字 / 关键字（keyword）/ 布尔 / 空 / 装饰器
const SRC = [
  "import os",
  "",
  "MAX = 42",
  "ok = True",
  "nothing = None",
  "",
  "def greet(name):",
  '    """doc"""',
  "    print(f'hi {name}')",
].join("\n");

let repo: GitRepo;

/** 打开工作区 + main.py，等 Monaco 真正渲染出带 token 的视图行 */
async function openPy(page: import("@playwright/test").Page): Promise<void> {
  await equipPage(page, repo);
  await page.goto("/");
  await page.locator("#tree .tree-item .name", { hasText: "main.py" }).first().dblclick();
  await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".monaco-editor .view-lines").first()).toBeAttached({ timeout: 30_000 });
  // 语法着色需 token 化完成：任一 token span 出现即可（纯文本时 mtk1 不着色）
  await expect(page.locator(".monaco-editor .view-line span[class*='mtk']").first()).toBeAttached({ timeout: 30_000 });
}

/** 全选并返回选区元素的实际底色。
 *  ⚠ 必须**轮询到拿到非透明底色**为止：`toBeAttached` 通过 ≠ 元素仍带背景——
 *    Monaco 重建视图行（切主题、token 化完成、异步渲染）会把 .selected-text 整体替换掉，
 *    那一刻读到的 computed backgroundColor 是空字符串。首跑就踩到过一次
 *    （T-B4-5 收到 "" 而非某个错误色值），真机层同样要求读到实际色值。 */
async function selectionBg(page: import("@playwright/test").Page): Promise<string> {
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+a");
  return page
    .waitForFunction(
      () => {
        const el = document.querySelector(".monaco-editor .selected-text");
        if (!el) return null;
        const c = getComputedStyle(el).backgroundColor;
        return c && c !== "rgba(0, 0, 0, 0)" ? c : null;
      },
      null,
      { timeout: 10_000 },
    )
    .then((h) => h.jsonValue() as Promise<string>);
}

/** 编辑器内所有 token 文本的实际渲染色（去重小写） */
async function tokenColors(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    for (const el of document.querySelectorAll(".monaco-editor .view-line span[class*='mtk']")) {
      out.add(getComputedStyle(el).color.toLowerCase());
    }
    return [...out];
  });
}

test.beforeEach(async () => {
  repo = await makePlainDir({ "main.py": SRC });
});

test.describe("深色主题 opencharm-dark", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
        theme: "opencharm-dark",
      };
    });
    await openPy(page);
  });

  test("T-B4-1 编辑器表面色与外壳 token 同源（不再是出厂 vs-dark）", async ({ page }) => {
    // ⚠ 当前行高亮只在编辑器**有焦点**时才绘制（Monaco 的 _shouldRenderInContent 判 focused），
    //   故先点一下再读——否则元素根本不存在，用例会因 null 而红，且与主题是否生效无关。
    await page.locator(".monaco-editor .view-lines").first().click();
    const probe = await page.evaluate(() => {
      const pick = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      return {
        editor: pick(".monaco-editor"),
        margin: pick(".monaco-editor .margin"),
        // ⚠ 选择器必须带 .view-overlays 前缀：Monaco 只对
        //   `.monaco-editor .view-overlays .current-line` 生成底色规则（见 currentLineHighlight.js
        //   的 registerThemingParticipant），gutter 侧那个 .current-line 由另一条规则管。
        //   用无前缀选择器会命中 gutter 元素并读到 transparent，误判成「主题没生效」。
        currentLine: pick(".monaco-editor .view-overlays .current-line"),
      };
    });
    expect(probe.editor, "editor.background 应取 --surface-2").toBe(DARK.editorBg);
    // gutter 底色：Monaco 把 editorGutter.background 设在 .margin 上；.margin-view-overlays
    // 本身透明（它只承载行号与折角控件）。
    expect(probe.margin, "editorGutter.background 应与画布同档").toBe(DARK.editorBg);
    expect(probe.currentLine, "editor.lineHighlightBackground 应取 --editor-line-highlight").toBe(DARK.lineHighlight);
    // 边框必须已去掉：Monaco 原生给当前行画 2px 描边，与「层级靠表面差、不靠描边」冲突
    expect(
      await page.evaluate(() => {
        const el = document.querySelector(".monaco-editor .view-overlays .current-line-exact");
        return el ? getComputedStyle(el).borderTopColor : null;
      }),
      "editor.lineHighlightBorder 应为透明（去掉 VS Code 那条描边）",
    ).toBe("rgba(0, 0, 0, 0)");
  });

  test("T-B4-2 选区是青绿染色而非出厂蓝（本批最醒目的判据）", async ({ page }) => {
    const bg = await selectionBg(page);
    expect(bg, "editor.selectionBackground 应取 --selected（ADR-0005 青绿）").toBe(DARK.selected);
    // 出厂 vs-dark 选区是 #264f78；若映射失效这里会拿到它
    expect(bg).not.toBe("rgb(38, 79, 120)");
  });

  test("T-B4-3 语法色已青绿化：identifier 青绿 + keyword 紫，旧蓝不得出现", async ({ page }) => {
    const colors = await tokenColors(page);
    expect(colors, "identifier 应渲染色为青绿 --syntax-var").toContain(DARK.syntaxVar);
    expect(colors, "keyword 应渲染色为紫 --syntax-boolean").toContain(DARK.syntaxKeyword);
    expect(colors, "旧的浅蓝 identifier 不应再出现").not.toContain(DARK.legacyVar);
    expect(colors, "旧的蓝 keyword 不应再出现").not.toContain(DARK.legacyKeyword);
  });
});

test.describe("浅色主题 opencharm-light", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
        theme: "opencharm-light",
      };
    });
    await openPy(page);
  });

  test("T-B4-4 外壳与编辑器同步切浅色（外壳 data-theme 与 Monaco 主题成对）", async ({ page }) => {
    const shellTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(shellTheme).toBe("light");
    const editorBg = await page.evaluate(() => {
      const el = document.querySelector(".monaco-editor");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    expect(editorBg).toBe(LIGHT.editorBg);
  });

  test("T-B4-5 浅色下选区与语法色取浅色覆盖层的值", async ({ page }) => {
    const bg = await selectionBg(page);
    expect(bg, "浅色选区应为 #d3efeb（出厂 vs 是蓝 #add6ff）").toBe(LIGHT.selected);
    expect(bg).not.toBe("rgb(173, 214, 255)");
    const colors = await tokenColors(page);
    expect(colors, "浅色 identifier 应为青绿 #0e7261").toContain(LIGHT.syntaxVar);
    expect(colors, "旧的深蓝 identifier 不应再出现").not.toContain(LIGHT.legacyVar);
    expect(colors, "旧的纯蓝 keyword 不应再出现").not.toContain(LIGHT.legacyKeyword);
  });
});

test.describe("存量设置迁移（旧出厂主题名 → 自定义名）", () => {
  // 这条是批 4 最大的静默风险：Monaco 对未注册的主题名**不报错**，
  // 静默回落到出厂 vs-dark。不迁移的症状是「用户升级后编辑器悄悄变回原厂主题且无提示」。
  test("T-B4-6 存量 theme=\"vs\" 迁移为 opencharm-light 并真正生效", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __E2E_SETTINGS_PRESET__?: Record<string, unknown> }).__E2E_SETTINGS_PRESET__ = {
        theme: "vs", // 批 4 之前用户 settings.json 里的真实存量值
      };
    });
    await openPy(page);
    const migrated = await page.evaluate(() => {
      const el = document.querySelector(".monaco-editor");
      return {
        shell: document.documentElement.dataset.theme,
        editor: el ? getComputedStyle(el).backgroundColor : null,
      };
    });
    expect(migrated.shell, "存量 vs 应被迁移成浅色外壳").toBe("light");
    expect(migrated.editor, "迁移后编辑器必须是浅色画布").toBe(LIGHT.editorBg);
    // 浅色画布与出厂 vs 相同，故再验一次选区——那是唯一能区分两者的槽位
    expect(await selectionBg(page), "迁移后选区应是青绿染色").toBe(LIGHT.selected);
  });
});
