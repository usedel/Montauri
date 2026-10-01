# -*- coding: utf-8 -*-
"""临时：由 devtools_map.json 确定性重建 devtools_zh.json（第十七批 zh 真源合并）。

apply_ts.py 的词条值 = 归一化模板把 § 换成 {参数名}，与 map 一一对应，可直接重建；
panel.* 7 条与 map 一致；manifest/cat/matchCount 等手工词条在 MANUAL 里登记。
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
MAP = json.loads((HERE / "devtools_map.json").read_text(encoding="utf-8"))

PH = "§"


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


MANUAL = {
    "devtools.manifest.name": "内置工具",
    "devtools.cat.encoding": "编码",
    "devtools.cat.hash": "哈希",
    "devtools.cat.format": "格式化",
    "devtools.cat.convert": "转换",
    "devtools.cat.generate": "生成",
    "devtools.cat.extract": "提取",
    "devtools.cat.text": "文本",
    "devtools.cat.other": "其他",
    "devtools.rx.matchCount": "共 {total} 处匹配",
    "devtools.rx.matchCapSuffix": "（仅显示前 {cap}）",
    "devtools.tool.base64.title": "Base64 编码/解码",
    "devtools.tool.base64.desc": "文本与 Base64 互转（UTF-8 安全）",
    "devtools.tool.base64.inline": "Base64 编码选区",
    "devtools.tool.urlcode.title": "URL 编码/解码",
    "devtools.tool.urlcode.desc": "encodeURIComponent / decodeURIComponent 互转",
    "devtools.tool.urlcode.inline": "URL 编码选区",
    "devtools.tool.hash.title": "MD5 / SHA-256",
    "devtools.tool.hash.desc": "计算文本哈希（大写/小写可切）",
    "devtools.tool.hash.inline": "MD5 选区",
    "devtools.tool.jsonfmt.title": "JSON 美化/压缩",
    "devtools.tool.jsonfmt.desc": "格式化（缩进可调）或压缩 JSON",
    "devtools.tool.curl2python.title": "cURL ⇄ Python",
    "devtools.tool.curl2python.desc": "curl 命令与 requests / httpx 代码互转（双向）",
    "devtools.tool.timestamp.title": "时间戳转换",
    "devtools.tool.timestamp.desc": "Unix 时间戳 ⇄ 可读时间",
    "devtools.tool.timestamp.inline": "时间戳转可读时间",
    "devtools.tool.uuid.title": "UUID 生成",
    "devtools.tool.uuid.desc": "生成 v4 UUID（可批量）",
    "devtools.tool.jsonpath.title": "JSONPath 提取器",
    "devtools.tool.jsonpath.desc": "JSON 树状浏览，点击节点复制其路径",
    "devtools.tool.regex.title": "正则测试器",
    "devtools.tool.regex.desc": "真实 re 引擎下验证正则：匹配 / 替换 / 分组 / flags",
    "devtools.tool.format.title": "格式串预览",
    "devtools.tool.format.desc": "strftime / 数字格式规范 / logging 格式串预览与速查",
    "devtools.tool.json2model.title": "JSON → Python 模型",
    "devtools.tool.json2model.desc": "由 JSON 生成 Pydantic / dataclass / TypedDict 模型类",
    "devtools.tool.radix.title": "进制转换",
    "devtools.tool.radix.desc": "0x/0b/0o/十进制互转（BigInt 精度无损）",
    "devtools.tool.radix.inline": "数字转十六进制",
    "devtools.tool.htmlentity.title": "HTML 实体编码/解码",
    "devtools.tool.htmlentity.desc": "命名实体与数字实体互转",
    "devtools.tool.htmlentity.inline": "HTML 实体编码选区",
    "devtools.tool.unicode.title": "Unicode ⇄ 明文",
    "devtools.tool.unicode.desc": "\\uXXXX 转义串与明文互转（含代理对合并）",
    "devtools.tool.unicode.inline": "Unicode 转义还原选区",
    "devtools.tool.caseconvert.title": "大小写/命名风格",
    "devtools.tool.caseconvert.desc": "UPPER / lower / Title / snake_case / camelCase",
    "devtools.tool.caseconvert.inline": "英文转大写",
    "devtools.tool.wordcount.title": "字数统计",
    "devtools.tool.wordcount.desc": "字符 / 词 / CJK 字数 / 行数实时统计",
    "devtools.tool.sortlines.title": "行排序去重",
    "devtools.tool.sortlines.desc": "升/降/倒置/洗牌 × 去重/忽略大小写/空行",
    "devtools.tool.color.title": "颜色转换",
    "devtools.tool.color.desc": "Hex ⇄ RGB ⇄ HSL + ANSI 256 色号",
    "devtools.tool.password.title": "密码生成",
    "devtools.tool.password.desc": "crypto 随机；四类字符集可组合",
    "devtools.tool.textdiff.title": "文本 Diff",
    "devtools.tool.textdiff.desc": "两栏对比，行级差异（+ 新增 / - 删除）",
}

out: dict[str, str] = {}
for tpl, rec in MAP.items():
    out[rec["key"]] = entry_of(tpl, rec.get("params") or [])
out.update(MANUAL)

# 手工词条（matchCapSuffix 等）若含占位符，保持 {name} 原样即可——已在上面写好
out = dict(sorted(out.items()))
(HERE / "devtools_zh.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"devtools_zh.json 重建：{len(out)} 条")
