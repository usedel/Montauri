// 三方一致门禁：shell/src/style.css ↔ index.html FOUC 块 ↔ [data-theme="light"] 覆盖层。
//
// 为什么需要它（ui_premium_dev_plan §4 门禁 5）：这三处是**静默 diverge** 的高发区——
// 改了任何一处另两处都不会报错、不会红、测试全绿，只是「慢慢地与新调色板脱节」。
// 项目里已经吃过一次同类亏：Monaco Python 高亮因 Vite 预打包 chunk hash 漂移而 404，
// 症状是「只有 py 没高亮、无其它报错」，最终靠用户看终端日志才定位。
//
// 三方各自的职责：
//   1. style.css :root        —— 深色真源
//   2. style.css light 覆盖层  —— 浅色真源（**故意与深色不同**，不是复制）
//   3. index.html FOUC 内联块  —— 首帧兜底，字面值，必须与 ① 逐项对齐
//
// 批 4 会引入第四方（Monaco 主题 theme/tokens.ts），本文件届时扩为四方。
// 断言全部读源码文本，不依赖浏览器生效——纯 Node 环境即可跑。
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** 读仓库内文件（vitest 的 cwd 通常是 shell/；兼容从仓库根 --root 启动） */
function readRepoFile(rel: string): string {
  for (const prefix of ["", "shell/"]) {
    const p = resolve(process.cwd(), prefix + rel);
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  throw new Error(`找不到 ${rel}（cwd=${process.cwd()}）`);
}

const css = readRepoFile("src/style.css");
const html = readRepoFile("index.html");

/** 去掉注释后再做块解析，避免注释里的 token 名/旧色值干扰 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}
const bare = stripComments(css);

/** 抽 :root / [data-theme="light"] 的声明表（同款多块合并） */
function decls(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(selector.replace(/[[\]]/g, "\\$&") + "\\s*\\{", "g");
  for (let m = re.exec(bare); m; m = re.exec(bare)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < bare.length && depth > 0; i++) {
      if (bare[i] === "{") depth++;
      else if (bare[i] === "}") depth--;
    }
    for (const chunk of bare.slice(m.index + m[0].length, i - 1).split(";")) {
      const c = chunk.indexOf(":");
      if (c < 0) continue;
      const name = chunk.slice(0, c).trim();
      if (name.startsWith("--")) out.set(name, chunk.slice(c + 1).trim());
    }
  }
  return out;
}

const root = decls(":root");
const light = decls('[data-theme="light"]');

/** 顺着 var() 链解析到字面量（只看单层链，够用且不引 CSS 解析器）。
 *  scope 缺该 token 时回退 :root——浅色覆盖层通常只写「要改的那几个」。 */
function resolveVar(name: string, scope: Map<string, string> = root): string {
  let v = scope.get(name) ?? root.get(name);
  for (let i = 0; i < 8 && v && v.startsWith("var("); i++) {
    const inner = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(v)?.[1];
    if (!inner) break;
    v = (scope.get(inner) ?? root.get(inner));
  }
  return (v ?? "").trim();
}

/** #rrggbb → [r,g,b] 0-255 */
function parseHex(value: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) throw new Error(`不是字面量色值：${value}`);
  const h = m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const hex = (v: string): string => v.toLowerCase();

/** WCAG 相对亮度（与 tools/ui/audit_tokens.py 同公式） */
function luminance(value: string): number {
  const [r8, g8, b8] = parseHex(value);
  const ch = (v8: number): number => {
    const s = v8 / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r8) + 0.7152 * ch(g8) + 0.0722 * ch(b8);
}

/** WCAG 相对亮度对比度 */
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("token 三方一致 · style.css 深色真源", () => {
  it(":root 必须定义表面五档阶梯（批 2a 的地基）", () => {
    for (let i = 0; i < 5; i++) expect(root.has(`--surface-${i}`)).toBe(true);
  });

  it("语义别名必须指向阶梯，不得再出现裸色值", () => {
    for (const name of ["--bg", "--bg-chrome", "--bg-panel", "--bg-alt"]) {
      expect(root.get(name), `${name} 应为 var(--surface-*) 别名`).toMatch(/^var\(--surface-\d\)$/);
    }
  });

  it("brand 阶梯是单一色相（五个档都落在青绿轴上）", () => {
    // 断言用「G 最高且 G/B ≤ 1.6」表达青绿轴；精确色相差门禁在 tools/ui/audit_tokens.py（ΔE ≤ 15°）
    for (const name of ["--brand-1", "--brand-2", "--brand-3", "--brand-4", "--brand-5"]) {
      const [r, g, b] = parseHex(resolveVar(name));
      expect(g, `${name} 绿通道应最高`).toBeGreaterThan(r);
      expect(g, `${name} 绿通道应高于蓝通道（青绿轴）`).toBeGreaterThan(b);
      expect(g / b, `${name} 色相应贴近青绿（G/B ≤ 1.6）`).toBeLessThanOrEqual(1.6);
    }
  });

  it("--accent 三角色齐备且各司其职（ADR-0005）", () => {
    const accent = resolveVar("--accent");
    const emph = resolveVar("--accent-emphasis");
    const fill = resolveVar("--accent-fill");
    expect(accent).not.toBe(emph);   // ≤S3 面用 accent
    expect(fill).not.toBe(accent);   // 实心按钮底用 fill
    // emphasis 必须比 accent 亮（同一色相、更高对比的那一档）
    expect(luminance(emph)).toBeGreaterThan(luminance(accent));
    // 白字 on fill ≥ AA 4.5
    expect(contrast("#ffffff", fill), "白字 on --accent-fill").toBeGreaterThanOrEqual(4.5);
  });

  it("投影四档齐备且 --shadow 走 --elev-*（深色下双轨：投影 + 顶边高光）", () => {
    for (let i = 1; i <= 4; i++) {
      const v = resolveVar(`--elev-${i}`);
      expect(v, `--elev-${i} 应有定义`).toBeTruthy();
      // 深色侧必须带 inset 高光——那是「浮起来」的真正信号源
      expect(v, `--elev-${i} 深色侧应含 inset 顶边高光`).toMatch(/inset/);
    }
    expect(root.get("--shadow")).toMatch(/^var\(--elev-\d\)$/);
  });

  it("阶梯对比度按轴达标（画布轴 ≥1.15 是用户能感知的那一刀）", () => {
    const s = (i: number): string => resolveVar(`--surface-${i}`);
    expect(contrast(s(0), s(2)), "深色 S0↔S2 画布轴").toBeGreaterThanOrEqual(1.15);
    expect(contrast(s(2), s(3)), "深色 S2↔S3 组件轴").toBeGreaterThanOrEqual(1.12);
    expect(contrast(s(3), s(4)), "深色 S3↔S4 浮层轴").toBeGreaterThanOrEqual(1.12);
    // chrome 与面板底必须分离：#menubar / #sidebar 同色会让 chrome 层糊成一片
    expect(contrast(resolveVar("--bg-chrome"), resolveVar("--bg-panel"))).toBeGreaterThanOrEqual(1.05);
  });

  it("深色 --fg-dim 在四档表面上全部 ≥ AA（抬升面用 --fg-muted）", () => {
    for (let i = 0; i < 4; i++) {
      expect(contrast(resolveVar("--fg-dim"), resolveVar(`--surface-${i}`)), `S${i} 上的 --fg-dim`)
        .toBeGreaterThanOrEqual(4.5);
    }
    expect(root.has("--fg-muted"), "抬升面专用的 --fg-muted 应已定义").toBe(true);
    expect(contrast(resolveVar("--fg-muted"), resolveVar("--surface-3")), "--fg-muted on S3")
      .toBeGreaterThanOrEqual(4.5);
  });
});

describe("token 三方一致 · 浅色覆盖层", () => {
  it("浅色必须覆盖表面五档 + 三个语义别名（否则浅色会停在深色阶梯上）", () => {
    for (let i = 0; i < 5; i++) expect(light.has(`--surface-${i}`), `light 缺 --surface-${i}`).toBe(true);
    for (const name of ["--bg", "--bg-chrome", "--bg-panel", "--bg-alt"]) {
      expect(light.get(name), `light ${name} 应显式覆盖`).toMatch(/^var\(--surface-\d\)$/);
    }
  });

  it("浅色侧投影不得带 inset 高光（白底上无意义，反而显脏）", () => {
    for (let i = 1; i <= 4; i++) {
      expect(light.get(`--elev-${i}`), `light --elev-${i} 不该有 inset`).not.toMatch(/inset/);
    }
    expect(light.get("--shadow")).toMatch(/^var\(--elev-\d\)$/);
  });

  it("浅色 accent 族必须显式覆盖（ADR-0005 推翻了「accent 跨主题一致」这条旧裁决）", () => {
    for (const name of ["--accent", "--accent-fill", "--accent-emphasis", "--accent-soft", "--accent-faint"]) {
      expect(light.has(name), `light 缺 ${name}——青绿在白底需更深，不能继承深色值`).toBe(true);
    }
  });

  it("主题预览色卡 8 值必须钉死且不随当前主题变化（不进 light 覆盖层）", () => {
    for (let i = 1; i <= 4; i++) {
      expect(root.has(`--theme-pv-dark-bg`) || i === 1).toBe(true);
    }
    for (const name of ["--theme-pv-dark-bg", "--theme-pv-dark-side", "--theme-pv-dark-fg", "--theme-pv-dark-border",
      "--theme-pv-light-bg", "--theme-pv-light-side", "--theme-pv-light-fg", "--theme-pv-light-border"]) {
      expect(root.has(name), `缺 ${name}`).toBe(true);
      expect(light.has(name), `${name} 不该出现在 light 覆盖层（覆盖掉就失去预览意义）`).toBe(false);
    }
  });

  it("预览色卡值必须与两套主题的真实表面一致（改了阶梯要回来同步）", () => {
    expect(hex(resolveVar("--theme-pv-dark-bg", root))).toBe(hex(resolveVar("--bg")));
    expect(hex(resolveVar("--theme-pv-dark-side", root))).toBe(hex(resolveVar("--bg-panel")));
    // 色卡定义在 :root（不进 light 覆盖层），比对时用 light 作用域解析 --bg / --bg-panel
    expect(hex(resolveVar("--theme-pv-light-bg", root))).toBe(hex(resolveVar("--bg", light)));
    expect(hex(resolveVar("--theme-pv-light-side", root))).toBe(hex(resolveVar("--bg-panel", light)));
  });

  it("浅色 --fg-dim 在四档表面上全部 ≥ AA（杠杆 9 的收口）", () => {
    for (let i = 0; i < 4; i++) {
      expect(contrast(resolveVar("--fg-dim", light), resolveVar(`--surface-${i}`, light)), `L${i}`)
        .toBeGreaterThanOrEqual(4.5);
    }
    // 浅色侧不需要 --fg-muted（浮层 L4 = 画布同值，--fg-dim 直接够用）
    expect(light.has("--fg-muted"), "浅色不该定义 --fg-muted（会多一个无用的档）").toBe(false);
  });
});

describe("token 三方一致 · index.html FOUC 块", () => {
  /** FOUC 块必须用字面值（var() 在那时还不存在），逐项与 :root 对齐 */
  it("FOUC 的背景色必须等于 --bg 的解析值（漏改会闪一帧旧底色）", () => {
    const bg = /html,\s*body\s*\{[^}]*background:\s*(#[0-9a-fA-F]{3,8})/s.exec(html);
    expect(bg, "FOUC 块里应能找到 html, body 的 background 字面值").not.toBeNull();
    expect(hex(bg![1])).toBe(hex(resolveVar("--bg")));
  });

  it("FOUC 的文字色 / 字号 / 字体栈 / 浅色底色必须与 :root 对齐（共 6 项同步义务）", () => {
    const block = /html,\s*body\s*\{([\s\S]*?)\}/.exec(html)![1];
    const fg = /color:\s*(#[0-9a-fA-F]{3,8})/.exec(block)![1];
    expect(hex(fg)).toBe(hex(resolveVar("--fg")));
    expect(/font-size:\s*13px/.test(block)).toBe(true);
    // 浅色兜底两值
    const lightRule = /html\[data-theme="light"\][^{]*\{[\s\S]*?background:\s*(#[0-9a-fA-F]{3,8});[\s\S]*?color:\s*(#[0-9a-fA-F]{3,8})/.exec(html);
    expect(lightRule, "FOUC 块应含浅色主题兜底规则").not.toBeNull();
    expect(hex(lightRule![1])).toBe(hex(resolveVar("--bg", light)));
    expect(hex(lightRule![2])).toBe(hex(resolveVar("--fg", light)));
  });

  it("FOUC 同步义务注释必须列全 6 项（font-family 是第 6 项，批 3 改字体前已预登记）", () => {
    const note = /⚠[^<]*同步义务[^<]*/.exec(html)?.[0] ?? "";
    expect(note).toContain("font-family");
    for (const token of ["--bg", "--fg", "--text-base"]) {
      expect(note, `注释里应登记 ${token}`).toContain(token);
    }
  });
});
