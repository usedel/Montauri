#!/usr/bin/env python3
"""一次性脚本：补 B4 复核修正的词条（settings 域 4 条 + devtools 域 2 条）。

用法：python tools/i18n/data/_tmp/add_http_settings_terms.py
随后：python tools/i18n/gen_domain.py --domain settings
      python tools/i18n/gen_domain.py --domain devtools
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]

SETTINGS_ZH = {
    "settings.http.section": "HTTP 请求",
    "settings.http.timeout": "请求超时",
    "settings.http.followRedirects": "跟随重定向",
    "settings.http.saveTokens": "把环境变量保存到本机",
}

SETTINGS_EN = {
    "settings.http.section": "HTTP requests",
    "settings.http.timeout": "Request timeout",
    "settings.http.followRedirects": "Follow redirects",
    "settings.http.saveTokens": "Keep variables on this machine",
}

DEVTOOLS_ZH = {
    "devtools.http.firstRunTip": "环境变量（可能含 token）保存在本机，不写入项目目录；可在设置 → HTTP 请求里关掉",
    "devtools.http.varsNotSaved": "已在本次会话生效（设置里关闭了「保存到本机」，重启后需重新填写）",
}

DEVTOOLS_EN = {
    "devtools.http.firstRunTip": "Variables (which may hold tokens) are kept on this machine, never written into your project — you can turn this off in Settings → HTTP requests",
    "devtools.http.varsNotSaved": "Applied for this session only (\"Keep variables on this machine\" is off in Settings)",
}

JOBS = [
    ("settings_zh.json", SETTINGS_ZH),
    ("settings_en.json", SETTINGS_EN),
    ("devtools_zh.json", DEVTOOLS_ZH),
    ("devtools_en.json", DEVTOOLS_EN),
]


def main() -> int:
    for name, add in JOBS:
        p = BASE / name
        d = json.loads(p.read_text(encoding="utf-8"))
        before = len(d)
        d.update(add)
        p.write_text(
            json.dumps(d, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(f"{name}: {before} -> {len(d)} (+{len(d) - before})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
