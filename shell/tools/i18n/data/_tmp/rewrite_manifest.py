# -*- coding: utf-8 -*-
"""临时：builtin/index.ts manifest 改写为 buildBuiltinManifest() + t() 取词。

category 保留中文原文（types.ts 的预置序恒定标识，展示时经 categoryLabel() 翻译）；
title / description / inline.label / name 为纯展示文案，改写为 t()。
"""
import json
import re
from pathlib import Path

P = Path("d:/aipro/opencharm/shell/src/devtools/builtin/index.ts")
zh = json.loads(Path("d:/aipro/opencharm/shell/tools/i18n/data/devtools_zh.json").read_text(encoding="utf-8"))
reverse = {}
for k, v in zh.items():
    reverse.setdefault(v, []).append(k)

src = P.read_text(encoding="utf-8")

# 1) const → build 函数
src = src.replace(
    "/** 内置插件 manifest（字段与磁盘版同构；id 固定 opencharm.builtin） */\nexport const BUILTIN_MANIFEST: PluginManifest = {",
    "/** 内置插件 manifest 构建（字段与磁盘版同构；id 固定 opencharm.builtin）。\n"
    " *  构建函数而非模块级常量：title/description/inline 走 t() 取词，语言切换重注册时重建（踩坑 ④）。 */\n"
    "export function buildBuiltinManifest(): PluginManifest {\n  return {",
)
src = src.replace(
    '  permissions: ["clipboard", "selection", "monaco", "fs:read"],\n};',
    '  permissions: ["clipboard", "selection", "monaco", "fs:read"],\n  };\n}',
)

# 2) 展示文案 → t()
def repl_attr(src: str, attr: str) -> str:
    pat = re.compile(rf'{attr}: "([^"]*[\u4e00-\u9fff][^"]*)"')
    def sub(m: re.Match) -> str:
        text = m.group(1)
        keys = reverse.get(text) or reverse.get(text.replace("\\\\", "\\"))
        if not keys:
            raise SystemExit(f"未找到 key：{attr}={text!r}")
        # 展示文案的 key 不会与 category 撞值（category 行不匹配本模式）
        return f'{attr}: t("{keys[0]}")'
    return pat.sub(sub, src)

for attr in ("name", "title", "description", "label"):
    src = repl_attr(src, attr)

# 3) 补 t 导入
if 'from "../../i18n"' not in src:
    src = src.replace(
        'import type { PluginManifest } from "../../extensions/manifest";',
        'import type { PluginManifest } from "../../extensions/manifest";\nimport { t } from "../../i18n"; // 第十七批 i18n：内置工具 manifest 展示文案走语言包',
    )

P.write_text(src, encoding="utf-8")

leftover = [ln.strip() for ln in src.split("\n") if re.search(r'[\u4e00-\u9fff]', ln) and re.match(r'\s*(name|title|description|label):', ln)]
print("残留未改写展示文案行：", leftover if leftover else "无")
