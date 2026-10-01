# -*- coding: utf-8 -*-
"""临时：主题名词条补入 settings 域（themePicker.ts 手工取词，不走 apply_ts）。"""
import json
from pathlib import Path

d = Path(__file__).resolve().parents[1]

m = json.loads((d / "settings_map.json").read_text(encoding="utf-8"))
m["深色"] = {"key": "settings.theme.dark"}
m["浅色"] = {"key": "settings.theme.light"}
(d / "settings_map.json").write_text(json.dumps(dict(sorted(m.items())), ensure_ascii=False, indent=1), encoding="utf-8")

z = json.loads((d / "settings_zh.json").read_text(encoding="utf-8"))
z["settings.theme.dark"] = "深色"
z["settings.theme.light"] = "浅色"
(d / "settings_zh.json").write_text(json.dumps(dict(sorted(z.items())), ensure_ascii=False, indent=2), encoding="utf-8")

e = json.loads((d / "settings_en.json").read_text(encoding="utf-8"))
e["settings.theme.dark"] = "Dark"
e["settings.theme.light"] = "Light"
(d / "settings_en.json").write_text(json.dumps(dict(sorted(e.items())), ensure_ascii=False, indent=2), encoding="utf-8")

print(f"settings 域词条已补（map {len(m)} / zh {len(z)} / en {len(e)} 条）")
