# -*- coding: utf-8 -*-
"""临时：第十九批（live-templates/builtin.ts 模板描述）映射表追加 + zh 词条合并。"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
PH = "§"

MAP_ADD = {
    "main 函数定义": {"key": "lt.tpl.main"},
    "if __name__ == '__main__'": {"key": "lt.tpl.ifmain"},
    "函数定义": {"key": "lt.tpl.def"},
    "类定义（含 __init__）": {"key": "lt.tpl.class"},
    "@dataclass 类": {"key": "lt.tpl.dataclass"},
    "if 语句": {"key": "lt.tpl.if"},
    "if / else 语句": {"key": "lt.tpl.ife"},
    "for 循环": {"key": "lt.tpl.for"},
    "while 循环": {"key": "lt.tpl.while"},
    "try / except 块": {"key": "lt.tpl.try"},
    "with 语句": {"key": "lt.tpl.with"},
    "lambda 表达式": {"key": "lt.tpl.lambda"},
    "print 调用": {"key": "lt.tpl.print"},
    "__init__ 方法": {"key": "lt.tpl.init"},
    "__iter__ / __next__ 对": {"key": "lt.tpl.iter"},
    "__repr__ 方法": {"key": "lt.tpl.repr"},
    "单行 docstring": {"key": "lt.tpl.doc"},
    "函数 docstring（Args / Returns）": {"key": "lt.tpl.docf"},
    "类 docstring（Attributes）": {"key": "lt.tpl.docc"},
    "文件头（自动填文件名/作者/日期）": {"key": "lt.tpl.header"},
    "async 函数定义": {"key": "lt.tpl.adef"},
    "async for 循环": {"key": "lt.tpl.afor"},
    "async with 语句": {"key": "lt.tpl.awith"},
    "requests.get 请求骨架（含 raise_for_status）": {"key": "lt.tpl.reqget"},
    "requests.post 请求骨架（JSON 体）": {"key": "lt.tpl.reqpost"},
    "requests.Session + Retry 适配器（需导入 HTTPAdapter/Retry）": {"key": "lt.tpl.reqsess"},
    "httpx.AsyncClient 异步 GET（async with）": {"key": "lt.tpl.hget"},
    "BeautifulSoup 解析骨架": {"key": "lt.tpl.bs4"},
    "lxml etree + xpath 解析骨架（需 from lxml import etree）": {"key": "lt.tpl.lxml"},
    "soup.select CSS 选择 + 遍历（$ITEMS$ 镜像）": {"key": "lt.tpl.css"},
    "resp.json() 加载 + 取字段": {"key": "lt.tpl.jsonld"},
    "翻页 while 循环骨架（抓空即停）": {"key": "lt.tpl.page"},
    "UA 池 + 随机 User-Agent（需 import random）": {"key": "lt.tpl.ua"},
    "requests 代理字典（http/https）": {"key": "lt.tpl.proxy"},
    "随机延时（礼貌抓取，需 import time/random）": {"key": "lt.tpl.rsleep"},
    "csv.DictWriter 写文件（需 import csv）": {"key": "lt.tpl.csvw"},
    "json.dump 写文件（ensure_ascii=False，需 import json）": {"key": "lt.tpl.jsonw"},
    "用双引号包裹": {"key": "lt.tpl.surroundQuote"},
    "包裹在 try / except 中": {"key": "lt.tpl.surroundTry"},
    "包裹在 if 中": {"key": "lt.tpl.surroundIf"},
    "包裹在 with 中": {"key": "lt.tpl.surroundWith"},
    "if 表达式:": {"key": "lt.tpl.postfixIf"},
    "if not 表达式:": {"key": "lt.tpl.postfixElse"},
    "for 遍历表达式": {"key": "lt.tpl.postfixFor"},
    "not 表达式": {"key": "lt.tpl.postfixNot"},
    "print(表达式)": {"key": "lt.tpl.postfixPrint"},
    "len(表达式)": {"key": "lt.tpl.postfixLen"},
    "return 表达式": {"key": "lt.tpl.postfixReturn"},
    "str(表达式)": {"key": "lt.tpl.postfixStr"},
    "int(表达式)": {"key": "lt.tpl.postfixInt"},
    "爬虫": {"key": "lt.group.crawler"},
    "说明": {"key": "lt.tpl.argDescDefault"},
}


def entry_of(tpl: str, params: list[str]) -> str:
    out = []
    idx = 0
    for ch in tpl:
        if ch == PH:
            out.append("{" + (params[idx] if idx < len(params) else f"p{idx}") + "}")
            idx += 1
        else:
            out.append(ch)
    return "".join(out)


# 1) map 追加
map_path = HERE / "lt_map.json"
mapping = json.loads(map_path.read_text(encoding="utf-8"))
added = 0
for tpl_, rec in MAP_ADD.items():
    if tpl_ not in mapping:
        mapping[tpl_] = rec
        added += 1
map_path.write_text(json.dumps(dict(sorted(mapping.items())), ensure_ascii=False, indent=1), encoding="utf-8")
print(f"map 追加 {added} 条 → 共 {len(mapping)} 条")

# 2) zh 增量合并（不整文件重建——lt_zh.json 含既有面板词条）
zh_path = HERE / "lt_zh.json"
zh = json.loads(zh_path.read_text(encoding="utf-8"))
new_zh = 0
for tpl_, rec in MAP_ADD.items():
    key = rec["key"]
    if key not in zh:
        zh[key] = entry_of(tpl_, rec.get("params") or [])
        new_zh += 1
zh_path.write_text(json.dumps(dict(sorted(zh.items())), ensure_ascii=False, indent=2), encoding="utf-8")
print(f"zh 新增 {new_zh} 条 → 共 {len(zh)} 条")
