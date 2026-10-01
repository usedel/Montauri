# -*- coding: utf-8 -*-
"""生成 shell/src/i18n/locales/{zh-CN,en-US}.ts。

输入：
- data/html_dict.json   —— index.html 自动抽取的词条（由 extract_html.py 产出）
- data/manual_zh.json   —— TS 侧 t() 直接引用的词条（手工登记）
- data/en_*.json        —— 英文翻译分片（与上面两份中文的 key 必须一一对应）

校验：中英文 key 集合不一致 / 出现空串立即报错退出（避免把半套语言包写进仓库）。
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "src", "i18n", "locales")


def esc(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def emit(pairs, head):
    out = list(head)
    last = None
    for k in sorted(pairs):
        ns = k.split(".")[0]
        if ns != last:
            out.append(f"  // ---- {ns} ----")
            last = ns
        out.append(f'  "{k}": "{esc(pairs[k])}",')
    out.append("};")
    return "\n".join(out) + "\n"


def main():
    zh = json.load(open(os.path.join(DATA, "html_dict.json"), encoding="utf-8"))
    zh.update(json.load(open(os.path.join(DATA, "manual_zh.json"), encoding="utf-8")))
    en = {}
    for f in sorted(os.listdir(DATA)):
        if f.startswith("en_") and f.endswith(".json"):
            en.update(json.load(open(os.path.join(DATA, f), encoding="utf-8")))

    missing = sorted(k for k in zh if k not in en)
    extra = sorted(k for k in en if k not in zh)
    empty = sorted(k for k, v in zh.items() if not v.strip()) + sorted(k for k, v in en.items() if not v.strip())
    print(f"zh: {len(zh)}  en: {len(en)}")
    if missing:
        print(f"!! 缺英文 {len(missing)} 条: {missing[:10]}")
    if extra:
        print(f"!! 多余英文 {len(extra)} 条: {extra[:10]}")
    if empty:
        print(f"!! 空文案: {empty[:10]}")
    if missing or extra or empty:
        sys.exit(1)

    zh_txt = emit(zh, [
        "// 简体中文语言包（真源）：key 来自两处——index.html 的 data-i18n* 标记（由 tools/i18n/extract_html.py",
        "// 自动抽取）与 TS 侧 t() 直接引用（登记在 tools/i18n/data/manual_zh.json）。",
        "// 约定：新增文案先在此登记，再在 en-US.ts 补英文（缺 key / 多 key / 拼错都在 tsc 阶段报错）。",
        "export const zhCN = {",
    ])
    en_txt = emit(en, [
        "// English (US) 语言包：key 与 zh-CN 一一对应，由 Record<TKey, string> 在编译期强校验。",
        'import type { TKey } from "./zh-CN";',
        "",
        "export const enUS: Record<TKey, string> = {",
    ])
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "zh-CN.ts"), "w", encoding="utf-8").write(
        zh_txt + "\n/** 全部文案 key：en-US 的 Record<TKey, string> 与 t() 入参类型都从这里派生。 */\nexport type TKey = keyof typeof zhCN;\n")
    open(os.path.join(OUT, "en-US.ts"), "w", encoding="utf-8").write(en_txt)
    print(f"已生成 {len(zh)} 条 → src/i18n/locales/")


if __name__ == "__main__":
    main()
