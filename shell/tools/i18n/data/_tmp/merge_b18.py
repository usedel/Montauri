# -*- coding: utf-8 -*-
"""临时：第十八批（库文案域 libFormat/libRegex/libEval/libInject）映射表追加 + zh 词条合并。"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
PH = "§"

MAP_ADD = {
    # ---- libFormat 码表 ----
    "四位年份": {"key": "devtools.fmt.code.Y"},
    "两位年份": {"key": "devtools.fmt.code.y"},
    "两位月份 (01-12)": {"key": "devtools.fmt.code.m"},
    "两位日期 (01-31)": {"key": "devtools.fmt.code.d"},
    "24 小时制小时 (00-23)": {"key": "devtools.fmt.code.H"},
    "12 小时制小时 (01-12)": {"key": "devtools.fmt.code.I"},
    "分钟 (00-59)": {"key": "devtools.fmt.code.M"},
    "秒 (00-59)": {"key": "devtools.fmt.code.S"},
    "微秒 (6 位)": {"key": "devtools.fmt.code.f"},
    "星期缩写": {"key": "devtools.fmt.code.a"},
    "星期全名": {"key": "devtools.fmt.code.A"},
    "月份缩写": {"key": "devtools.fmt.code.b"},
    "月份全名": {"key": "devtools.fmt.code.B"},
    "年内天数 (001-366)": {"key": "devtools.fmt.code.j"},
    "周号（周日为一周开始）": {"key": "devtools.fmt.code.U"},
    "周号（周一为一周开始）": {"key": "devtools.fmt.code.W"},
    "星期数字 (0=周日)": {"key": "devtools.fmt.code.w"},
    "ISO 星期 (1=周一)": {"key": "devtools.fmt.code.u"},
    "ISO 周年份": {"key": "devtools.fmt.code.G"},
    "ISO 周号": {"key": "devtools.fmt.code.V"},
    "UTC 偏移 (+0800)": {"key": "devtools.fmt.code.z"},
    "时区名": {"key": "devtools.fmt.code.Z"},
    "完整日期时间": {"key": "devtools.fmt.code.c"},
    "本地日期": {"key": "devtools.fmt.code.x"},
    "本地时间": {"key": "devtools.fmt.code.X"},
    "字面量 %": {"key": "devtools.fmt.code.pct"},
    "时间（默认 2026-09-27 10:30:15,123）": {"key": "devtools.fmt.field.asctime"},
    "级别名 (INFO / WARNING …)": {"key": "devtools.fmt.field.levelname"},
    "级别数字": {"key": "devtools.fmt.field.levelno"},
    "logger 名": {"key": "devtools.fmt.field.name"},
    "日志消息": {"key": "devtools.fmt.field.message"},
    "模块名 (不含 .py)": {"key": "devtools.fmt.field.module"},
    "文件名": {"key": "devtools.fmt.field.filename"},
    "文件完整路径": {"key": "devtools.fmt.field.pathname"},
    "行号": {"key": "devtools.fmt.field.lineno"},
    "函数名": {"key": "devtools.fmt.field.funcName"},
    "毫秒部分": {"key": "devtools.fmt.field.msecs"},
    "线程 id": {"key": "devtools.fmt.field.thread"},
    "线程名": {"key": "devtools.fmt.field.threadName"},
    "进程 id": {"key": "devtools.fmt.field.process"},
    "进程名": {"key": "devtools.fmt.field.processName"},
    "时间戳 (秒)": {"key": "devtools.fmt.field.created"},
    "字符串 (str)": {"key": "devtools.fmt.type.s"},
    "十进制整数": {"key": "devtools.fmt.type.d"},
    "二进制": {"key": "devtools.fmt.type.b"},
    "八进制": {"key": "devtools.fmt.type.o"},
    "十六进制小写": {"key": "devtools.fmt.type.x"},
    "十六进制大写": {"key": "devtools.fmt.type.X"},
    "科学计数 (小写 e)": {"key": "devtools.fmt.type.e"},
    "科学计数 (大写 E)": {"key": "devtools.fmt.type.E"},
    "定点小数": {"key": "devtools.fmt.type.f"},
    "定点小数 (inf/nan 大写)": {"key": "devtools.fmt.type.F"},
    "通用 (整数用 d，否则 e)": {"key": "devtools.fmt.type.g"},
    "通用 (大写 E)": {"key": "devtools.fmt.type.G"},
    "本地化数字": {"key": "devtools.fmt.type.n"},
    "百分比 (×100 后接 %)": {"key": "devtools.fmt.type.pct"},
    # ---- libFormat 分段/诊断/hover ----
    "字面量": {"key": "devtools.lib.literal"},
    "字面量 {": {"key": "devtools.lib.literalLBrace"},
    "字面量 }": {"key": "devtools.fmt.literalRBrace"},
    "悬空 %（后面没有格式码）": {"key": "devtools.fmt.danglingPct"},
    "未知格式码 %§": {"key": "devtools.fmt.unknownCode", "params": ["code"]},
    "未知记录字段 \"§\"（logging 只认 LogRecord 已有字段）": {"key": "devtools.fmt.unknownField", "params": ["field"]},
    "未知格式类型 \"§\"（常见：d f s e %）": {"key": "devtools.fmt.unknownType", "params": ["type"]},
    "字段 §": {"key": "devtools.fmt.fieldLabel", "params": ["name"]},
    "转换 !§（§）": {"key": "devtools.fmt.conv", "params": ["conv", "kind"]},
    "对齐 §（填充 §）": {"key": "devtools.fmt.align", "params": ["align", "fill"]},
    "强制符号 (+/-)": {"key": "devtools.fmt.signPlus"},
    "前缀形式 (0x / 0b)": {"key": "devtools.fmt.altForm"},
    "前导 0 填充": {"key": "devtools.fmt.zeroPad"},
    "宽度 §": {"key": "devtools.fmt.width", "params": ["width"]},
    "千分位分隔": {"key": "devtools.fmt.grouping"},
    "精度 §": {"key": "devtools.fmt.precision", "params": ["prec"]},
    "空格": {"key": "devtools.fmt.fillSpace"},
    "自动编号占位（按参数顺序）": {"key": "devtools.fmt.autoNumber"},
    "占位符": {"key": "devtools.fmt.placeholder"},
    "未闭合的 {": {"key": "devtools.fmt.unclosedBrace"},
    "默认格式": {"key": "devtools.fmt.defaultSpec"},
    "未知格式码「§」：§": {"key": "devtools.fmt.diagUnknown", "params": ["token", "desc"]},
    "…（仅显示前 20 段）": {"key": "devtools.fmt.truncated20"},
    "⚠ 含未知格式码。§": {"key": "devtools.fmt.unknownWarn", "params": ["hint"]},
    "示例：\\`§\\`（§）": {"key": "devtools.fmt.sampleLine", "params": ["sample", "hint"]},
    "在格式串工具中打开：右键 →「在格式串工具中打开」/ 编辑器 lens": {"key": "devtools.fmt.openTool"},
    "日期 strftime": {"key": "devtools.fmt.modeStrftime"},
    "格式规范": {"key": "devtools.fmt.modeSpec"},
    "logging 格式": {"key": "devtools.fmt.modeLogging"},
    "样本 2026-09-26 14:03:11": {"key": "devtools.fmt.sampleTs"},
    "样本 1234.5678": {"key": "devtools.fmt.sampleNum"},
    "样本记录": {"key": "devtools.fmt.sampleRec"},
    "常见码：%Y 年 %m 月 %d 日 %H 时 %M 分 %S 秒": {"key": "devtools.fmt.hintStrftime"},
    "常见类型：d 整数 · f 定点 · s 字符串 · e 科学计数 · % 百分比": {"key": "devtools.fmt.hintFormat"},
    "常见字段：%(asctime)s %(levelname)s %(name)s %(message)s": {"key": "devtools.fmt.hintLogging"},
    # ---- libRegex flags/诊断/token/hover ----
    "忽略大小写 (IGNORECASE)": {"key": "devtools.rx.flagI"},
    "^ $ 匹配行首行尾 (MULTILINE)": {"key": "devtools.rx.flagM"},
    ". 匹配换行符 (DOTALL)": {"key": "devtools.rx.flagS"},
    "忽略空白与 # 注释 (VERBOSE)": {"key": "devtools.rx.flagX"},
    "仅 ASCII 匹配 (ASCII)": {"key": "devtools.rx.flagA"},
    "悬空反斜杠": {"key": "devtools.rx.danglingBackslash"},
    "反向引用第 § 组": {"key": "devtools.rx.backrefN", "params": ["n"]},
    "反向引用（命名/编号）": {"key": "devtools.rx.backref"},
    "字符串开头锚点": {"key": "devtools.rx.anchorStart"},
    "字符串末尾锚点": {"key": "devtools.rx.anchorEnd"},
    "单词边界": {"key": "devtools.rx.wordBoundary"},
    "非单词边界": {"key": "devtools.rx.notWordBoundary"},
    "数字字符 (0-9)": {"key": "devtools.rx.digitClass"},
    "非数字字符": {"key": "devtools.rx.notDigitClass"},
    "单词字符 (字母/数字/下划线)": {"key": "devtools.rx.wordChars"},
    "非单词字符": {"key": "devtools.rx.notWordChars"},
    "空白字符": {"key": "devtools.rx.spaceChars"},
    "非空白字符": {"key": "devtools.rx.notSpaceChars"},
    "转义字符 §": {"key": "devtools.rx.escapeChar", "params": ["ch"]},
    "命名组「§」开始（可用 \\\\g<§> 引用）": {"key": "devtools.rx.namedGroup", "params": ["name", "ref"]},
    "命名组反向引用": {"key": "devtools.rx.namedBackref"},
    "非捕获分组开始（不参与引用编号）": {"key": "devtools.rx.noncapGroup"},
    "前瞻断言（不消耗字符）": {"key": "devtools.rx.lookahead"},
    "后顾断言（不消耗字符）": {"key": "devtools.rx.lookbehind"},
    "第 § 组捕获开始": {"key": "devtools.rx.groupStart", "params": ["n"]},
    "分组结束": {"key": "devtools.rx.groupEnd"},
    "字符类（匹配其中任一字符）": {"key": "devtools.rx.charClass"},
    "（懒惰）": {"key": "devtools.rx.quantLazy"},
    "（贪婪）": {"key": "devtools.rx.quantGreedy"},
    "0 次或多次": {"key": "devtools.rx.quant0"},
    "1 次或多次": {"key": "devtools.rx.quant1"},
    "0 或 1 次": {"key": "devtools.rx.quant01"},
    "行首锚点（re.M）": {"key": "devtools.rx.anchorLineStart"},
    "行尾锚点（re.M）": {"key": "devtools.rx.anchorLineEnd"},
    "任意字符（含换行，re.S）": {"key": "devtools.rx.anyDotall"},
    "除换行外的任意字符": {"key": "devtools.rx.anyNoNl"},
    "或（左右任选一支）": {"key": "devtools.rx.alt"},
    "[§-§] 字符区间倒置（起点码位大于终点）": {"key": "devtools.rx.intervalInvert", "params": ["lo", "hi"]},
    "多余的右括号 )": {"key": "devtools.rx.extraCloseParen"},
    "字符类 [ 未闭合": {"key": "devtools.rx.classUnclosed"},
    "括号 ( 未闭合": {"key": "devtools.rx.parenUnclosed"},
    "命名组 \"§\" 重复定义（此前位于位置 §）": {"key": "devtools.rx.dupNamedGroup", "params": ["name", "pos"]},
    "会变成控制字符（如 \\\\b → 退格），正则语义已丢失": {"key": "devtools.rx.ctrlChar"},
    "当前靠 CPython 对未知转义的容错保留，正式写法应为 raw 串": {"key": "devtools.rx.fallbackKept"},
    "非 raw 字符串中的 \\\\§：§。请写作 r\"…\"": {"key": "devtools.rx.nonRawWarn", "params": ["n", "detail"]},
    "…（仅显示前 24 段）": {"key": "devtools.rx.truncated24"},
    "⚠ 非 raw 字符串：建议写作 \\`r\"…\"\\`": {"key": "devtools.rx.nonRawHint"},
    "在测试器中打开：右键 →「在正则测试器中打开」/ `Ctrl+Alt+R`": {"key": "devtools.rx.openTester"},
    # ---- libEval ----
    "求值超时": {"key": "devtools.eval.timeoutFallback"},
    "未找到可用 Python 解释器": {"key": "devtools.eval.noInterpreterFallback"},
    "未知脚本错误": {"key": "devtools.eval.unknownScriptError"},
    "未打开工作区": {"key": "devtools.eval.noWorkspace"},
    "args 序列化失败：§": {"key": "devtools.eval.argsSerializeFailed", "params": ["msg"]},
    # ---- libInject（复用 devtools.common 既有词条） ----
    "JSON 解析失败：§": {"key": "devtools.common.jsonParseFailed"},
    # ---- libJson hover 摘要（真字符串；注释里的 128 项/14 键样例不进映射） ----
    "**JSON** · object · § 键 · § 层": {"key": "devtools.json.hoverObject", "params": ["keys", "depth"]},
    "**JSON** · array · § 项": {"key": "devtools.json.hoverArray", "params": ["count"]},
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


# 转义修正：map 模板里源码级 \\b / \\g / \\§ / \\` 在运行时是单字符，词条值须为运行时真实值
ZH_OVERRIDES = {
    "devtools.rx.namedGroup": "命名组「{name}」开始（可用 \\g<{ref}> 引用）",
    "devtools.rx.ctrlChar": "会变成控制字符（如 \\b → 退格），正则语义已丢失",
    "devtools.rx.nonRawWarn": "非 raw 字符串中的 \\{n}：{detail}。请写作 r\"…\"",
    "devtools.fmt.sampleLine": "示例：`{sample}`（{hint}）",
    "devtools.rx.nonRawHint": "⚠ 非 raw 字符串：建议写作 `r\"…\"`",
}

# 嵌套模板手工拆段的词条（不进 map，直接登记）
MANUAL = {
    "devtools.rx.quantRange": "重复 {from} 到 {to}",
    "devtools.rx.quantExact": "重复 {n} 次",
    "devtools.rx.hoverHead": "**Python 正则{api}{flags}**",
}

# 1) map 追加
map_path = HERE / "devtools_map.json"
mapping = json.loads(map_path.read_text(encoding="utf-8"))
mapping.pop("在测试器中打开：右键 →「在正则测试器中打开」/ \\`Ctrl+Alt+R\\`", None)  # 清理此前转义写错的键
added = 0
for tpl, rec in MAP_ADD.items():
    if tpl not in mapping:
        mapping[tpl] = rec
        added += 1
map_path.write_text(json.dumps(dict(sorted(mapping.items())), ensure_ascii=False, indent=1), encoding="utf-8")
print(f"map 追加 {added} 条 → 共 {len(mapping)} 条")

# 2) zh 合并
zh_path = HERE / "devtools_zh.json"
zh = json.loads(zh_path.read_text(encoding="utf-8"))
new_zh = 0
for tpl, rec in MAP_ADD.items():
    key = rec["key"]
    if key not in zh:
        zh[key] = entry_of(tpl, rec.get("params") or [])
        new_zh += 1
zh.update(ZH_OVERRIDES)
zh.update(MANUAL)
zh_path.write_text(json.dumps(dict(sorted(zh.items())), ensure_ascii=False, indent=2), encoding="utf-8")
print(f"zh 新增 {new_zh} 条 + override {len(ZH_OVERRIDES)} + manual {len(MANUAL)} → 共 {len(zh)} 条")
