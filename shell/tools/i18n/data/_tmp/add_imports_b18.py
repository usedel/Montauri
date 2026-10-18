# -*- coding: utf-8 -*-
"""临时：为第十八批改写文件补 t() 导入。"""
import re
from pathlib import Path

SRC = Path("d:/aipro/montauri/shell/src")
FILES = ["libFormat.ts", "libRegex.ts", "libEval.ts", "libJson.ts", "libInject.ts"]

for rel in FILES:
    p = SRC / rel
    src = p.read_text(encoding="utf-8")
    if 'from "./i18n"' in src:
        print(f"skip {rel}")
        continue
    lines = src.split("\n")
    imp_idx = [i for i, ln in enumerate(lines) if ln.startswith("import ")]
    imp = 'import { t } from "./i18n"; // 第十八批 i18n：库文案走语言包'
    if imp_idx:
        lines.insert(max(imp_idx) + 1, imp)
    else:
        blank = next(i for i, ln in enumerate(lines) if ln.strip() == "")
        lines.insert(blank + 1, imp)
    p.write_text("\n".join(lines), encoding="utf-8")
    print(f"ok   {rel}")
