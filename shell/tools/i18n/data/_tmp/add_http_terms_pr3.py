#!/usr/bin/env python3
"""一次性脚本：补 PR-B4-3 词条（devtools 域 22 条 + endpoints 域 2 条）。

用法：python tools/i18n/data/_tmp/add_http_terms_pr3.py
随后：python tools/i18n/gen_domain.py --domain devtools
      python tools/i18n/gen_domain.py --domain endpoints
"""
import json
import pathlib

BASE = pathlib.Path(__file__).resolve().parents[1]

DEVTOOLS_ZH = {
    "devtools.http.envAria": "环境",
    "devtools.http.editVars": "编辑变量",
    "devtools.http.varsSection": "变量 · {env}（{n}）",
    "devtools.http.varsPh": "每行一个 key=value，# 开头为注释",
    "devtools.http.saveVars": "保存变量",
    "devtools.http.varsSaved": "已保存",
    "devtools.http.varsSavedHint": "变量只存在本机，不写入项目目录",
    "devtools.http.varsSavedWithWarn": "已保存，但有格式问题",
    "devtools.http.varsInvalid": "这些行没有 =，已忽略：{list}",
    "devtools.http.historySection": "历史（{n}）",
    "devtools.http.historyEmpty": "还没有发送记录",
    "devtools.http.curlImported": "已从 curl 导入",
    "devtools.http.curlImportedWarn": "已导入，但有未支持的选项",
    "devtools.http.curlWarn": "注意：{list}",
    "devtools.http.curlWarnInsecure": "-k（忽略证书校验）不生效，证书校验始终开启",
    "devtools.http.curlWarnHead": "-I 已转为 HEAD 请求",
    "devtools.http.curlWarnFormFile": "-F 文件上传（key=@file）不支持，已按普通字段发送",
    "devtools.http.missingVars": "未定义的变量：{list}（请先在「编辑变量」里补上）",
    "devtools.http.missingVarsFlash": "变量未定义",
    "devtools.http.insertEditor": "插入编辑器",
    "devtools.http.insertEditorTip": "把响应体插入当前编辑器（不写文件）",
    "devtools.http.inserted": "已插入",
}

DEVTOOLS_EN = {
    "devtools.http.envAria": "Environment",
    "devtools.http.editVars": "Edit variables",
    "devtools.http.varsSection": "Variables · {env} ({n})",
    "devtools.http.varsPh": "One key=value per line, # for comments",
    "devtools.http.saveVars": "Save variables",
    "devtools.http.varsSaved": "Saved",
    "devtools.http.varsSavedHint": "Variables stay on this machine — nothing is written to your project",
    "devtools.http.varsSavedWithWarn": "Saved with warnings",
    "devtools.http.varsInvalid": "Ignored lines without =: {list}",
    "devtools.http.historySection": "History ({n})",
    "devtools.http.historyEmpty": "No requests sent yet",
    "devtools.http.curlImported": "Imported from curl",
    "devtools.http.curlImportedWarn": "Imported, but some options are unsupported",
    "devtools.http.curlWarn": "Note: {list}",
    "devtools.http.curlWarnInsecure": "-k (skip certificate check) has no effect — verification is always on",
    "devtools.http.curlWarnHead": "-I converted to a HEAD request",
    "devtools.http.curlWarnFormFile": "-F file upload (key=@file) is unsupported; sent as a plain field",
    "devtools.http.missingVars": "Undefined variables: {list} (add them under Edit variables)",
    "devtools.http.missingVarsFlash": "Undefined variables",
    "devtools.http.insertEditor": "Insert into editor",
    "devtools.http.insertEditorTip": "Insert the response body into the current editor (writes no file)",
    "devtools.http.inserted": "Inserted",
}

ENDPOINTS_ZH = {
    "endpoints.sendAria": "在 HTTP 工具中打开",
    "endpoints.sendTip": "在 HTTP 工具中打开（预填完整 URL）",
}

ENDPOINTS_EN = {
    "endpoints.sendAria": "Open in HTTP tool",
    "endpoints.sendTip": "Open in HTTP tool (URL prefilled)",
}

JOBS = [
    ("devtools_zh.json", DEVTOOLS_ZH),
    ("devtools_en.json", DEVTOOLS_EN),
    ("endpoints_zh.json", ENDPOINTS_ZH),
    ("endpoints_en.json", ENDPOINTS_EN),
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
