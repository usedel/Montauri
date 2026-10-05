#!/usr/bin/env python3
"""一次性脚本：向 devtools 域真源补 B4 HTTP 工具的 32 条词条（PR-B4-2）。

用法：python tools/i18n/data/_tmp/add_http_terms.py
随后：python tools/i18n/gen_domain.py --domain devtools
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]

ZH = {
    "devtools.tool.http.title": "HTTP 请求",
    "devtools.tool.http.desc": "随时发 HTTP 请求（不在项目里落文件）",
    "devtools.http.methodAria": "请求方法",
    "devtools.http.urlPh": "https://api.example.com/users?page=2",
    "devtools.http.send": "发送",
    "devtools.http.cancel": "取消",
    "devtools.http.cancelling": "取消中…",
    "devtools.http.sending": "发送中…",
    "devtools.http.sendingElapsed": "已用 {time}",
    "devtools.http.cancellingHint": "正在取消…（请求可能仍在服务端执行）",
    "devtools.http.idleHint": "填好 URL 后点「发送」（Ctrl+Enter）",
    "devtools.http.sendFailed": "请求失败",
    "devtools.http.done": "已完成",
    "devtools.http.needUrl": "请先填写 URL",
    "devtools.http.headerNamePh": "头名",
    "devtools.http.headerValuePh": "值",
    "devtools.http.removeHeader": "删除这一行",
    "devtools.http.addHeader": "添加头",
    "devtools.http.headersSection": "请求头（{n}）",
    "devtools.http.bodySection": "请求体",
    "devtools.http.bodyPh": "请求体（JSON / 表单原文…）",
    "devtools.http.respHeaders": "响应头（{n}）",
    "devtools.http.emptyTitle": "还没有响应",
    "devtools.http.emptyHint": "填好 URL 后点「发送」，响应会显示在这里",
    "devtools.http.privateTarget": "目标是本机或内网地址",
    "devtools.http.truncated": "响应已截断（超过 5 MB）",
    "devtools.http.binaryHint": "二进制响应体（{size}），未内联显示",
    "devtools.http.noBody": "无响应体",
    "devtools.http.imageAlt": "响应图片预览",
    "devtools.http.jsonArray": "数组 · {n} 项",
    "devtools.http.jsonObject": "对象 · {n} 项",
    "devtools.http.jsonMore": "…还有 {n} 项未显示",
}

EN = {
    "devtools.tool.http.title": "HTTP request",
    "devtools.tool.http.desc": "Send HTTP requests anytime (no files written)",
    "devtools.http.methodAria": "Request method",
    "devtools.http.urlPh": "https://api.example.com/users?page=2",
    "devtools.http.send": "Send",
    "devtools.http.cancel": "Cancel",
    "devtools.http.cancelling": "Cancelling…",
    "devtools.http.sending": "Sending…",
    "devtools.http.sendingElapsed": "Elapsed {time}",
    "devtools.http.cancellingHint": "Cancelling… (the request may still run on the server)",
    "devtools.http.idleHint": "Fill in a URL and click Send (Ctrl+Enter)",
    "devtools.http.sendFailed": "Request failed",
    "devtools.http.done": "Done",
    "devtools.http.needUrl": "Enter a URL first",
    "devtools.http.headerNamePh": "Header",
    "devtools.http.headerValuePh": "Value",
    "devtools.http.removeHeader": "Remove this row",
    "devtools.http.addHeader": "Add header",
    "devtools.http.headersSection": "Headers ({n})",
    "devtools.http.bodySection": "Body",
    "devtools.http.bodyPh": "Request body (JSON / raw form…)",
    "devtools.http.respHeaders": "Response headers ({n})",
    "devtools.http.emptyTitle": "No response yet",
    "devtools.http.emptyHint": "Fill in a URL and click Send — the response shows up here",
    "devtools.http.privateTarget": "Target is a local or private address",
    "devtools.http.truncated": "Response truncated (over 5 MB)",
    "devtools.http.binaryHint": "Binary response body ({size}), not inlined",
    "devtools.http.noBody": "No response body",
    "devtools.http.imageAlt": "Response image preview",
    "devtools.http.jsonArray": "array · {n} items",
    "devtools.http.jsonObject": "object · {n} items",
    "devtools.http.jsonMore": "…{n} more items not shown",
}


def main() -> int:
    for name, add in (("devtools_zh.json", ZH), ("devtools_en.json", EN)):
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
