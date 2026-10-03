#!/usr/bin/env python3
"""UI token 审计 + WCAG 复算 + 门禁（`docs/ui_premium_dev_plan.md` §3.2 / §4）。

零第三方依赖（Python 3.13 标准库）——与 `probe/` 同一纪律。
本脚本是 `docs/ui_premium_design_report.md` §7「验收清单」里那批「可机检、不接受纯人工抽查」
门禁的落点：把报告里手算的对比度/色相数字固化成一键可重跑的判定。

用法：
    python tools/ui/audit_tokens.py                 # 人读报告（违规退出码 1）
    python tools/ui/audit_tokens.py --json          # 机器可读 JSON
    python tools/ui/audit_tokens.py --css <path>    # 指定 style.css（默认仓库内 shell/src/style.css）

已实现的门禁（批次推进时在 KNOWN_RESIDUALS 里登记"待后续批修"的残留面）：
  1. 单色相：brand/accent/link/focus-ring/brand-gradient 的色相与 --brand 基准相差 ≤ 15°
  2. accent 面门禁：--accent 作为文字色在各面上需 ≥4.5；不达标的面必须有 --accent-emphasis 且它达标
  3. 白字 on --accent-fill ≥ 4.5（--on-accent 13 处白字的合规前提）
  4. 浅色 --fg-dim 在各面 ≥ 4.5（杠杆 9）
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------- 常量

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSS = REPO_ROOT / "shell" / "src" / "style.css"

AA_TEXT = 4.5          # WCAG 2.1 AA 正文阈值
HUE_TOLERANCE = 15.0   # 单色相轴容差（度）

# 「面」= 文字可能落上去的背景。新阶梯（--surface-0..4，批 2a 起）优先；
# 批 1 尚无 --surface-*，回落到旧语义面（--bg-panel / --bg / --bg-alt）作代理。
SURFACES_NEW = [f"--surface-{i}" for i in range(5)]
SURFACES_LEGACY = ["--bg-panel", "--bg", "--bg-alt"]
# 派生交互面：只进 accent 门禁（九面），不进 --fg-dim 门禁——
# 方案 §5.2.3 对它们的规则是「染色面 / 控件底上禁用 --fg-dim，改用 --fg / --fg-muted」，
# 属批 2b 的**选择器级**扫描（门禁 6），不是 token 级对比度能判定的。
DERIVED_FACES = ["--hover", "--control-hover", "--selected", "--tab-inactive-bg"]

# 单色相门禁覆盖的 token 名（正则）。--on-accent 是白字、--accent-*-bg 类非色相项不参与。
HUE_AXIS_PATTERN = re.compile(
    r"^--(brand(-[a-z0-9]+)?|accent[a-z-]*|link[a-z-]*|focus-ring|diff-hunk|"
    r"welcome-glow|debug-frame-active|brand-gradient)$"
)
HUE_AXIS_SKIP = {"--on-accent"}

# 已登记残留：(theme, token, face) → 处置说明。命中即降级为 WARN（不拦门禁），
# 但必须在对应批次收口后从这里删除，否则会永久豁免。
KNOWN_RESIDUALS: dict[tuple[str, str, str], str] = {
    # 方案 §5.2.3：--fg-dim #5f5f68 打在现状 --control-hover #c8c8c8 上仅 3.78。
    # 彻底修好依赖批 2b 的浅色派生面重算（--control-hover → #e4e4e6，新值下 4.98 ✅）。
    ("light", "--fg-dim", "--control-hover"): "批 2b 浅色派生面重算（--control-hover → #e4e4e6）",
    # 现状深色 --control-hover #4b4b4b 是遗留的越阶值（比新 S4 还亮），
    # 批 2b 重算为 #3a3a42 后 --accent-emphasis 在其上为 5.53 ✅。
    ("dark", "--accent", "--control-hover"): "批 2b 派生面重算（--control-hover → #3a3a42）",
    # 同一个浅色遗留面 #c8c8c8：它同时压着 --fg-dim（3.78）与 --accent（3.49）两项，
    # 批 2b 重算为 #e4e4e6 后两者分别为 4.98 / 4.60 ✅。
    ("light", "--accent", "--control-hover"): "批 2b 浅色派生面重算（--control-hover → #e4e4e6）",
}

# ---------------------------------------------------------------- CSS 解析


def strip_comments(css: str) -> str:
    """去掉 /* ... */（token 块里有大段论证性注释，必须先剥）。"""
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def extract_block(css: str, selector: str) -> list[str]:
    """按选择器取块体（同一选择器可能出现多次，如两个 :root）。"""
    out: list[str] = []
    for m in re.finditer(re.escape(selector) + r"\s*\{", css):
        depth, i = 1, m.end()
        while i < len(css) and depth:
            if css[i] == "{":
                depth += 1
            elif css[i] == "}":
                depth -= 1
            i += 1
        out.append(css[m.end(): i - 1])
    return out


def parse_decls(body: str) -> dict[str, str]:
    """声明解析：`name: value;` → dict。值内可能含逗号/括号但不含分号。"""
    out: dict[str, str] = {}
    for chunk in body.split(";"):
        if ":" not in chunk:
            continue
        name, _, value = chunk.partition(":")
        name = name.strip()
        if name.startswith("--"):
            out[name] = value.strip()
    return out


def load_tokens(css_path: Path) -> dict[str, dict[str, str]]:
    css = strip_comments(css_path.read_text(encoding="utf-8"))
    themes: dict[str, dict[str, str]] = {}
    for selector, theme in ((":root", "dark"), ('[data-theme="light"]', "light")):
        merged: dict[str, str] = {}
        for body in extract_block(css, selector):
            merged.update(parse_decls(body))
        themes[theme] = merged
    return themes


# ---------------------------------------------------------------- 颜色

RGBA = tuple[float, float, float, float]  # 0-255 / alpha 0-1


def parse_color(value: str) -> RGBA | None:
    v = value.strip()
    m = re.match(r"^#([0-9a-f]{3,8})$", v, re.I)
    if m:
        h = m.group(1)
        if len(h) in (3, 4):
            r, g, b = (int(c * 2, 16) for c in h[:3])
            a = int(h[3] * 2, 16) / 255 if len(h) == 4 else 1.0
        else:
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return (r, g, b, a)
    m = re.match(r"^rgba?\(([^)]+)\)$", v, re.I)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        if len(parts) < 3:
            return None
        try:
            nums = [float(p.rstrip("%").strip()) for p in parts[:3]]
        except ValueError:
            return None
        alpha = float(parts[3]) if len(parts) > 3 else 1.0
        return (nums[0], nums[1], nums[2], alpha)
    return None


def gradient_colors(value: str) -> list[RGBA]:
    """取 linear-gradient 内的全部色标（色相门禁用）。"""
    out: list[RGBA] = []
    for token in re.findall(r"rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}", value):
        c = parse_color(token)
        if c:
            out.append(c)
    return out


def resolve(tokens: dict[str, str], name: str, depth: int = 0) -> RGBA | None:
    """递归解析 var() 引用 → RGBA；无法解析（如 linear-gradient）返回 None。"""
    if depth > 8:
        return None
    raw = tokens.get(name)
    if raw is None:
        return None
    m = re.fullmatch(r"var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,[^)]*)?\)", raw)
    if m:
        return resolve(tokens, m.group(1), depth + 1)
    return parse_color(raw)


def over(fg: RGBA, bg: RGBA) -> RGBA:
    """alpha 合成（token 大量使用半透明面）。"""
    a = fg[3]
    return tuple(fg[i] * a + bg[i] * (1 - a) for i in range(3)) + (1.0,)  # type: ignore[return-value]


def luminance(c: RGBA) -> float:
    def ch(v: float) -> float:
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c[i]) for i in range(3))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg: RGBA, bg: RGBA) -> float:
    l1, l2 = luminance(fg), luminance(bg)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def hue(c: RGBA) -> float | None:
    r, g, b = (c[i] / 255 for i in range(3))
    hi, lo = max(r, g, b), min(r, g, b)
    d = hi - lo
    if d < 1e-6:  # 灰/白/黑：色相无定义
        return None
    if hi == r:
        h = 60 * (((g - b) / d) % 6)
    elif hi == g:
        h = 60 * ((b - r) / d + 2)
    else:
        h = 60 * ((r - g) / d + 4)
    return h


def hue_delta(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def hexs(c: RGBA) -> str:
    return "#{:02x}{:02x}{:02x}".format(int(c[0]), int(c[1]), int(c[2])) + (
        f"{int(round(c[3] * 255)):02x}" if c[3] < 1 else ""
    )


# ---------------------------------------------------------------- 门禁


class Report:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.fails: list[str] = []
        self.warns: list[str] = []

    def check(self, gate: str, name: str, ok: bool, detail: str, residual: str | None = None) -> None:
        self.rows.append({"gate": gate, "item": name, "ok": ok, "detail": detail,
                          "residual": residual})
        if ok:
            return
        msg = f"[{gate}] {name}: {detail}"
        if residual:
            self.warns.append(f"{msg} —— 已登记残留：{residual}")
        else:
            self.fails.append(msg)


def faces_for(tokens: dict[str, str], group: str) -> list[str]:
    """面列表。新阶梯（--surface-*，批 2a 起）优先，批 1 回落到旧语义面。
    group="accent"：表面档 + 4 个派生交互面（九面门禁）。
    group="surface"：仅表面档（--fg-dim 门禁，方案 §7-3 的 L0–L3）。"""
    has_new = all(f"--surface-{i}" in tokens for i in range(4))
    surfaces = ([f"--surface-{i}" for i in range(4)] if has_new else SURFACES_LEGACY)
    if group == "surface":
        return surfaces
    if has_new and "--surface-4" in tokens:
        surfaces = surfaces + ["--surface-4"]
    return [*surfaces, *DERIVED_FACES]


def gate_hue_axis(report: Report, theme: str, tokens: dict[str, str]) -> None:
    base = resolve(tokens, "--brand")
    if base is None:
        report.check("单色相", f"{theme}/--brand", False, "--brand 未定义或不可解析")
        return
    base_h = hue(base)
    if base_h is None:
        report.check("单色相", f"{theme}/--brand", False, "--brand 无有效色相")
        return
    for name in sorted(tokens):
        if not HUE_AXIS_PATTERN.match(name) or name in HUE_AXIS_SKIP:
            continue
        raw = tokens[name]
        colors = gradient_colors(raw) if raw.startswith("linear-gradient") else (
            [resolve(tokens, name)] if resolve(tokens, name) else []
        )
        if not colors:
            continue
        for c in colors:
            h = hue(c)
            if h is None:
                continue  # 灰阶（如纯白字）不参与色相判定
            d = hue_delta(h, base_h)
            report.check("单色相", f"{theme}{name}={hexs(c)}", d <= HUE_TOLERANCE,
                         f"色相 {h:.1f}° vs 基准 {base_h:.1f}°（Δ{d:.1f}°）")


def gate_accent_faces(report: Report, theme: str, tokens: dict[str, str]) -> None:
    accent = resolve(tokens, "--accent")
    emph = resolve(tokens, "--accent-emphasis")
    if accent is None:
        report.check("accent 面", f"{theme}/--accent", False, "--accent 未定义或不可解析")
        return
    for face in faces_for(tokens, "accent"):
        bg = resolve(tokens, face)
        if bg is None:
            continue
        # 面自身可能半透明：先合成到该主题的画布底上
        canvas = resolve(tokens, "--bg") or (0, 0, 0, 1)
        bg_solid = over(bg, canvas)
        ca = contrast(accent, bg_solid)
        ce = contrast(emph, bg_solid) if emph else None
        if ca >= AA_TEXT:
            report.check("accent 面", f"{theme} --accent on {face}({hexs(bg_solid)})", True,
                         f"{ca:.2f} ✅ 可用 --accent")
        elif ce is not None and ce >= AA_TEXT:
            report.check("accent 面", f"{theme} --accent on {face}({hexs(bg_solid)})", True,
                         f"--accent {ca:.2f} ✗ → 须走 --accent-emphasis（{ce:.2f} ✅）")
        else:
            report.check("accent 面", f"{theme} --accent on {face}({hexs(bg_solid)})", False,
                         f"--accent {ca:.2f} ✗"
                         + (f" 且 --accent-emphasis 仅 {ce:.2f} ✗" if ce is not None
                            else " 且未定义 --accent-emphasis"),
                         residual=KNOWN_RESIDUALS.get((theme, "--accent", face)))


def gate_on_accent_fill(report: Report, theme: str, tokens: dict[str, str]) -> None:
    fill = resolve(tokens, "--accent-fill")
    on = resolve(tokens, "--on-accent")
    if fill is None:
        report.check("白字 on fill", f"{theme}/--accent-fill", False, "--accent-fill 未定义")
        return
    canvas = resolve(tokens, "--bg") or (0, 0, 0, 1)
    solid = over(fill, canvas)
    c = contrast(on or (255, 255, 255, 1), solid)
    report.check("白字 on fill", f"{theme} --on-accent on --accent-fill({hexs(solid)})",
                 c >= AA_TEXT, f"{c:.2f}")


def gate_fg_dim(report: Report, theme: str, tokens: dict[str, str]) -> None:
    dim = resolve(tokens, "--fg-dim")
    if dim is None:
        report.check("fg-dim 面", f"{theme}/--fg-dim", False, "--fg-dim 未定义")
        return
    canvas = resolve(tokens, "--bg") or (0, 0, 0, 1)
    for face in faces_for(tokens, "surface"):
        bg = resolve(tokens, face)
        if bg is None:
            continue
        solid = over(bg, canvas)
        c = contrast(dim, solid)
        report.check("fg-dim 面", f"{theme} --fg-dim on {face}({hexs(solid)})", c >= AA_TEXT,
                     f"{c:.2f}", residual=KNOWN_RESIDUALS.get((theme, "--fg-dim", face)))


def audit(css_path: Path) -> Report:
    tokens = load_tokens(css_path)
    report = Report()
    for theme in ("dark", "light"):
        t = tokens.get(theme, {})
        if not t:
            report.check("解析", f"{theme} 块", False, "未找到该主题的 token 块")
            continue
        gate_hue_axis(report, theme, t)
        gate_accent_faces(report, theme, t)
        gate_on_accent_fill(report, theme, t)
        gate_fg_dim(report, theme, t)
    return report


# ---------------------------------------------------------------- CLI


def main() -> int:
    ap = argparse.ArgumentParser(description="OpenCharm UI token 审计 + WCAG 门禁")
    ap.add_argument("--css", default=str(DEFAULT_CSS), help="style.css 路径")
    ap.add_argument("--json", action="store_true", help="输出 JSON（仍按门禁给退出码）")
    ap.add_argument("--out", help="把 JSON 报告写到该文件（逐批对照用；退出码不受影响）")
    args = ap.parse_args()

    css_path = Path(args.css)
    if not css_path.exists():
        print(f"找不到 CSS：{css_path}", file=sys.stderr)
        return 2
    report = audit(css_path)

    if args.out:
        payload = {"css": str(css_path), "fails": report.fails, "warns": report.warns,
                   "rows": report.rows}
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"JSON 报告已写入 {out_path}")

    if args.json:
        print(json.dumps({"fails": report.fails, "warns": report.warns, "rows": report.rows},
                         ensure_ascii=False, indent=2))
        return 1 if report.fails else 0

    total = len(report.rows)
    bad = [r for r in report.rows if not r["ok"]]
    print(f"OpenCharm UI token 审计 —— {css_path}")
    print(f"共 {total} 项判定，未达标 {len(bad)} 项；FAIL {len(report.fails)} · WARN {len(report.warns)}\n")
    for gate in ("单色相", "accent 面", "白字 on fill", "fg-dim 面"):
        rows = [r for r in report.rows if r["gate"] == gate]
        if not rows:
            continue
        print(f"── {gate}（{len(rows)} 项）")
        for r in rows:
            mark = "✅" if r["ok"] else ("⚠ " if r["residual"] else "❌")
            print(f"   {mark} {r['item']:<46} {r['detail']}")
        print()
    if report.warns:
        print("── 已登记残留（待后续批次收口，不拦门禁）")
        for w in report.warns:
            print(f"   ⚠ {w}")
        print()
    if report.fails:
        print("── FAIL")
        for f in report.fails:
            print(f"   ❌ {f}")
        return 1
    print("全部门禁通过 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
