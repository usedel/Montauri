#!/usr/bin/env python3
"""按「归一化模板 → key」映射表把 TS 源里的中文文案改写成 `t()` 调用。

配套：scan_ts.py 产出待抽取清单 → 人工定 key（写入 --map）→ 本脚本改写源码 + 产出中文词条。

三个关键设计：
1. **按字节区间从后往前替换**：后面的改动不影响前面待处理项的 offset，一次遍历即可全量改写。
2. **替换时重新解析 exprs**：模板字符串里嵌套的 `${cond ? "修订" : "提交"}` 会先被内层替换成
   `t(...)`，若沿用扫描时保存的原文会把已改好的内层又覆盖回中文。故每处理一项都从当前源码
   重新匹配引号与插值表达式。
3. **参数名 `error` 自动包 `localizeBackendError(errMsg(...))`**：输出到面板/提示里的错误来自 Rust
   侧中文 `Err("…")`，英文界面下必须过一层翻译，否则文案翻了、原因还是中文。

用法：
    python3 tools/i18n/apply_ts.py src/git.ts --map data/git_map.json --ns git
    python3 tools/i18n/apply_ts.py src/git.ts --map data/git_map.json --ns git --dry   # 只看不改
产物：源码就地改写 + tools/i18n/data/<ns>_zh.json（中文词条，占位符已换成 {name}）
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scan_ts import CJK, _interp_end, _match_quoted, exprs_of, iter_strings, norm_body  # noqa: E402

PH = "§"


def build_repl(keyname: str, params: list[str], exprs: list[str]) -> str:
    """生成 `t("key")` 或 `t("key", { a: x, b: y })`。"""
    if not params:
        return f't("{keyname}")'
    parts = []
    for name, expr in zip(params, exprs):
        # 错误消息统一过「Rust 中文 → 当前语言」翻译层（errMsg 兜住 unknown，非空串兜异常对象）
        if name == "error":
            expr = f"localizeBackendError(errMsg({expr}))"
        parts.append(f"{name}: {expr}")
    return f't("{keyname}", {{ {", ".join(parts)} }})'


def template_to_entry(tpl: str, params: list[str]) -> str:
    """归一化模板（`§` 占位）→ 词条原文（`{name}` 占位）。"""
    out = []
    idx = 0
    for ch in tpl:
        if ch == PH:
            out.append("{" + (params[idx] if idx < len(params) else f"p{idx}") + "}")
            idx += 1
        else:
            out.append(ch)
    return "".join(out)


def apply_file(path: Path, mapping: dict, ns: str, dry: bool) -> tuple[str, dict, list[str]]:
    src = path.read_text(encoding="utf-8")
    # 按 start 降序：从后往前替换，保证前面项的 offset 不被后续改动影响
    sites = sorted(iter_strings(src), key=lambda s: -s["start"])

    entries: dict[str, str] = {}
    missed: list[str] = []
    hits = 0
    for s in sites:
        tpl = norm_body(s["body"])
        m = mapping.get(tpl)
        if not m:
            missed.append(tpl)
            continue
        # 重新定位：内层可能已被替换，end 以当前源码为准
        end = _match_quoted(src, s["start"])
        if end is None:
            missed.append(tpl)
            continue
        body = src[s["start"] + 1 : end]
        exprs = exprs_of(body)
        params = m.get("params") or []
        if len(exprs) != len(params):
            print(f"  ! 参数个数不匹配（模板 {len(params)} / 实际 {len(exprs)}）: {tpl[:60]}")
            missed.append(tpl)
            continue
        # key 自带域前缀（含 "."）时原样使用：既能写本域 key，也能跨域引用 core 的 common.*
        key = m["key"] if "." in m["key"] else f"{ns}.{m['key']}"
        repl = build_repl(key, params, exprs)
        src = src[: s["start"]] + repl + src[end + 1 :]
        entries[key] = template_to_entry(tpl, params)
        hits += 1

    # 条目按 key 排序输出，保证生成文件的 diff 稳定
    return src, dict(sorted(entries.items())), missed, hits  # type: ignore[return-value]


def main() -> int:
    argv = sys.argv[1:]
    positional = [a for a in argv if not a.startswith("-")]
    if not positional:
        print(__doc__)
        return 2
    src_path = Path(positional[0])
    ns = argv[argv.index("--ns") + 1] if "--ns" in argv else "app"
    map_path = Path(argv[argv.index("--map") + 1]) if "--map" in argv else None
    dry = "--dry" in argv
    out = argv[argv.index("--out") + 1] if "--out" in argv else f"data/{ns}_zh.json"

    mapping = json.loads(map_path.read_text(encoding="utf-8")) if map_path else {}
    src, entries, missed, hits = apply_file(src_path, mapping, ns, dry)

    print(f"命中 {hits} 处 → {len(entries)} 条词条")
    uniq_missed = sorted(set(missed))
    if uniq_missed:
        print(f"未命中 {len(uniq_missed)} 条模板（需补映射或本就不该翻）：")
        for t in uniq_missed:
            print(f"   - {t[:90]}")
    if not dry:
        src_path.write_text(src, encoding="utf-8")
        out_path = Path(__file__).parent / out
        out_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"→ 改写 {src_path}；词条 → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
