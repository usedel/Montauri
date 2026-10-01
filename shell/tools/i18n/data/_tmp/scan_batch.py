# -*- coding: utf-8 -*-
"""临时：批量统计各文件中文模板数，辅助圈定下一批 i18n 范围。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scan_ts import collect  # noqa: E402

targets = sys.argv[1:]
rows = []
for t in targets:
    p = Path(t)
    files = sorted(p.rglob("*.ts")) if p.is_dir() else [p]
    for f in files:
        try:
            entry = collect(f)
        except Exception as e:  # noqa: BLE001
            print(f"ERR {f}: {e}")
            continue
        if entry:
            total = sum(v["count"] for v in entry.values())
            rows.append((len(entry), total, str(f)))

rows.sort(reverse=True)
uniq = sum(r[0] for r in rows)
total = sum(r[1] for r in rows)
print(f"== 文件数 {len(rows)}  唯一模板 {uniq}  出现总数 {total}")
for u, c, f in rows:
    print(f"{u:5d} {c:5d}  {f}")
