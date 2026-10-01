# -*- coding: utf-8 -*-
"""临时：汇总批次内全部唯一模板（含出现文件），供制定映射表。"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scan_ts import collect  # noqa: E402

targets = sys.argv[1:]
acc: dict[str, dict] = {}
for t in targets:
    p = Path(t)
    files = sorted(p.rglob("*.ts")) if p.is_dir() else [p]
    for f in files:
        if "__tests__" in str(f):
            continue
        for tpl, rec in collect(f).items():
            d = acc.setdefault(tpl, {"count": 0, "files": []})
            d["count"] += rec["count"]
            d["files"].append(f.name)

items = sorted(acc.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
out = Path(__file__).parent / "batch17_templates.json"
out.write_text(json.dumps({k: v for k, v in items}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"唯一模板 {len(acc)} → {out}")
for k, v in items:
    print(f"{v['count']:3d}  {','.join(sorted(set(v['files'])))[:48]:48s} | {k[:110]}")
