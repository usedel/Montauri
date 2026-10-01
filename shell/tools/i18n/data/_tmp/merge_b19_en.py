# -*- coding: utf-8 -*-
"""临时：第十九批 en 词条追加到 lt_en.json。"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]

EN_ADD = {
    "lt.tpl.main": "main function definition",
    "lt.tpl.ifmain": "if __name__ == '__main__'",
    "lt.tpl.def": "function definition",
    "lt.tpl.class": "class definition (with __init__)",
    "lt.tpl.dataclass": "@dataclass class",
    "lt.tpl.if": "if statement",
    "lt.tpl.ife": "if / else statement",
    "lt.tpl.for": "for loop",
    "lt.tpl.while": "while loop",
    "lt.tpl.try": "try / except block",
    "lt.tpl.with": "with statement",
    "lt.tpl.lambda": "lambda expression",
    "lt.tpl.print": "print call",
    "lt.tpl.init": "__init__ method",
    "lt.tpl.iter": "__iter__ / __next__ pair",
    "lt.tpl.repr": "__repr__ method",
    "lt.tpl.doc": "single-line docstring",
    "lt.tpl.docf": "function docstring (Args / Returns)",
    "lt.tpl.docc": "class docstring (Attributes)",
    "lt.tpl.header": "file header (auto file name/author/date)",
    "lt.tpl.adef": "async function definition",
    "lt.tpl.afor": "async for loop",
    "lt.tpl.awith": "async with statement",
    "lt.tpl.reqget": "requests.get skeleton (with raise_for_status)",
    "lt.tpl.reqpost": "requests.post skeleton (JSON body)",
    "lt.tpl.reqsess": "requests.Session + Retry adapter (imports HTTPAdapter/Retry)",
    "lt.tpl.hget": "httpx.AsyncClient async GET (async with)",
    "lt.tpl.bs4": "BeautifulSoup parsing skeleton",
    "lt.tpl.lxml": "lxml etree + xpath skeleton (needs from lxml import etree)",
    "lt.tpl.css": "soup.select CSS select + iterate ($ITEMS$ mirror)",
    "lt.tpl.jsonld": "resp.json() load + pick fields",
    "lt.tpl.page": "pagination while loop (stop on empty)",
    "lt.tpl.ua": "UA pool + random User-Agent (needs import random)",
    "lt.tpl.proxy": "requests proxy dict (http/https)",
    "lt.tpl.rsleep": "random delay (polite crawling, needs import time/random)",
    "lt.tpl.csvw": "csv.DictWriter file writer (needs import csv)",
    "lt.tpl.jsonw": "json.dump file writer (ensure_ascii=False, needs import json)",
    "lt.tpl.surroundQuote": "Wrap in double quotes",
    "lt.tpl.surroundTry": "Wrap in try / except",
    "lt.tpl.surroundIf": "Wrap in if",
    "lt.tpl.surroundWith": "Wrap in with",
    "lt.tpl.postfixIf": "if expr:",
    "lt.tpl.postfixElse": "if not expr:",
    "lt.tpl.postfixFor": "iterate expr",
    "lt.tpl.postfixNot": "not expr",
    "lt.tpl.postfixPrint": "print(expr)",
    "lt.tpl.postfixLen": "len(expr)",
    "lt.tpl.postfixReturn": "return expr",
    "lt.tpl.postfixStr": "str(expr)",
    "lt.tpl.postfixInt": "int(expr)",
    "lt.group.crawler": "Web Scraping",
    "lt.tpl.argDescDefault": "Description",
}

p = HERE / "lt_en.json"
en = json.loads(p.read_text(encoding="utf-8"))
added = 0
for k, v in EN_ADD.items():
    if k not in en:
        en[k] = v
        added += 1
p.write_text(json.dumps(dict(sorted(en.items())), ensure_ascii=False, indent=2), encoding="utf-8")
print(f"en 追加 {added} 条 → 共 {len(en)} 条")
