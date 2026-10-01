# -*- coding: utf-8 -*-
# 临时脚本：为 ext/endpoints 域 3 个文件补 i18n import（放在 import 块末尾，跳过多行块）
import io, os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../shell/src"))
files = ["extensions/pluginsTab.ts", "extensions/loader.ts", "endpointView.ts"]
for f in files:
    src = io.open(f, encoding="utf-8").read()
    if 'from "../i18n"' in src or 'from "../../i18n"' in src or 'from "./i18n"' in src:
        print(f, "skip")
        continue
    lines = src.split("\n")
    # 找最后一个「完整的」import 语句末行：跳过以 import 开头但块未闭合的行
    idx = -1
    for i, l in enumerate(lines):
        if not l.startswith("import "):
            continue
        if l.rstrip().endswith(";") or l.rstrip().endswith('"') or l.rstrip().endswith("'"):
            idx = i
        else:
            j = i
            while j < len(lines) and not lines[j].rstrip().endswith(";"):
                j += 1
            idx = j
    depth = 0
    # 兜底：若上面估算的 idx 仍落在未闭合块内，继续向后找分号
    while idx < len(lines) and lines[idx].count("{") > lines[idx].count("}") and "}" not in "".join(lines[: idx + 1]).split(lines[idx].split("{")[0])[ -1:]:
        idx += 1
    # 简化处理：从前往后扫描，遇到未闭合的 { 则推进到含 } 的行
    i = 0
    pos = 0
    while i < len(lines):
        if lines[i].startswith("import "):
            j = i
            ok = False
            while j < len(lines):
                seg = lines[j]
                if "{" in seg and "}" not in seg:
                    j += 1
                    continue
                if seg.rstrip().endswith(";"):
                    pos = j
                    ok = True
                    break
                j += 1
            if ok:
                i = pos
        i += 1
    add = ['import { t } from "../i18n"; // 第十五批 i18n：动态文案走语言包']
    if "localizeBackendError(" in src:
        add.append('import { localizeBackendError } from "../i18n/backendError";')
    if "errMsg(" in src and "errMsg" not in src[: src.find("from")]:
        add.append('import { errMsg } from "../util";')
    lines[pos + 1:pos + 1] = add
    io.open(f, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
    print(f, "+", len(add), "at line", pos + 2)
