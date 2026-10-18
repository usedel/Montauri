# -*- coding: utf-8 -*-
"""临时：为第十七批改写文件补 t() 导入（apply_ts.py 不负责 import）。"""
import re
from pathlib import Path

SRC = Path("d:/aipro/montauri/shell/src")

FILES = [
    "devtools/builtin/password.ts",
    "devtools/builtin/pure.ts",
    "devtools/builtin/radix.ts",
    "devtools/builtin/regex.ts",
    "devtools/builtin/sortlines.ts",
    "devtools/builtin/textdiff.ts",
    "devtools/builtin/textfns.ts",
    "devtools/builtin/timestamp.ts",
    "devtools/builtin/unicode.ts",
    "devtools/builtin/urlcode.ts",
    "devtools/builtin/uuid.ts",
    "devtools/builtin/wordcount.ts",
    "devtools/builtin/python2curl.gen.ts",
    "devtools/kit.ts",
]

for rel in FILES:
    p = SRC / rel
    src = p.read_text(encoding="utf-8")
    if re.search(r'import \{ t \} from "\.\./\.\./i18n"|import \{ t \} from "\.\./i18n"', src):
        print(f"skip {rel}")
        continue
    imp = 'import { t } from "../i18n";' if rel.endswith("kit.ts") else 'import { t } from "../../i18n";'
    lines = src.split("\n")
    imp_idx = [i for i, ln in enumerate(lines) if ln.startswith("import ")]
    if imp_idx:
        lines.insert(max(imp_idx) + 1, imp)
    else:
        # 无 import 的文件（pure.ts）：插到首个空行后（头部注释块之后）
        blank = next(i for i, ln in enumerate(lines) if ln.strip() == "")
        lines.insert(blank + 1, imp)
    p.write_text("\n".join(lines), encoding="utf-8")
    print(f"ok   {rel}")
