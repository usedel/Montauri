# -*- coding: utf-8 -*-
"""临时：main.ts renderTabs 循环变量 t 改名 tab（避让 i18n 取词函数，踩坑 ⑤）。"""
import re
from pathlib import Path

P = Path("d:/aipro/opencharm/shell/src/main.ts")
lines = P.read_text(encoding="utf-8").split("\n")

start = next(i for i, ln in enumerate(lines) if ln.strip() == "for (const t of app.tabs) {")
# 找匹配的循环闭合：从 start 起计数大括号
depth = 0
end = None
for i in range(start, len(lines)):
    depth += lines[i].count("{") - lines[i].count("}")
    if depth == 0:
        end = i
        break
assert end is not None
for i in range(start, end + 1):
    lines[i] = re.sub(r"\bt\b", "tab", lines[i])
lines[start] = lines[start].replace("const tab of app.tabs", "const tab of app.tabs")  # 占位（已被上一行替换）
P.write_text("\n".join(lines), encoding="utf-8")
print(f"renderTabs 循环体 L{start + 1}-L{end + 1} 已改名 t → tab")
print(lines[start])
