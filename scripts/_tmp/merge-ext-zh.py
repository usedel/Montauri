# -*- coding: utf-8 -*-
# 临时脚本：ext_zh.json 并入手工词条（含 \" 转义引号与 \n 的 6 条）
import json, io, os

os.chdir(os.path.dirname(os.path.abspath(__file__)) + "/../../shell/tools/i18n/data")
d = json.load(open("ext_zh.json", encoding="utf-8"))
d.update({
    "ext.manifestCheckFailed": "manifest 校验失败：",
    "ext.handlerNotExported": "handler \"{handler}\" 未导出",
    "ext.idDirMismatch": "manifest.id \"{id}\" 与目录名 \"{dir}\" 不一致（约定目录名 = id）",
    "ext.noMount": "工具 \"{id}\" 既无 mount() 导出也未声明 inline（至少实现其一）",
    "ext.toolLoadFailed": "工具 \"{id}\" 加载失败：{error}",
    "ext.noLogHint": "（暂无日志——在插件代码里调 host.log(\"...\") 试试）",
})
io.open("ext_zh.json", "w", encoding="utf-8").write(json.dumps(dict(sorted(d.items())), ensure_ascii=False, indent=2) + "\n")
print("ext zh", len(d))
