//! 运行时诊断（阶段 2）：jmespath 路径校验。
//!
//! 扫描文本中的 `jmespath.search("path", data)` / `compile("path", data)` 调用，
//! 用运行时采样的递归 shape 校验路径段（字段是否存在、对对象用下标 / 对数组用字段访问）。

use opencharm_intel_index::TraceIndex;

use crate::call_context::scan_string_end;
use crate::completion::{is_jmespath_call_prefix, parse_jmespath_segments};
use crate::type_infer;

/// 一条运行时诊断（LSP 0 基坐标）。
#[derive(Debug)]
pub struct RuntimeDiagnostic {
    pub line: u32,
    pub start_character: u32,
    pub end_character: u32,
    pub message: String,
    /// LSP DiagnosticSeverity：1=Error 2=Warning 3=Info 4=Hint
    pub severity: i32,
}

/// 扫描文本中的所有 jmespath 调用，逐路径校验，返回诊断。
pub fn diagnose(index: &TraceIndex, text: &str) -> Vec<RuntimeDiagnostic> {
    let mut out = Vec::new();
    for (line_idx, line) in text.lines().enumerate() {
        scan_line(index, text, line_idx as u32, line, &mut out);
    }
    out
}

fn scan_line(
    index: &TraceIndex,
    text: &str,
    line_idx: u32,
    line: &str,
    out: &mut Vec<RuntimeDiagnostic>,
) {
    // TD-027 D8：注释/转义感知的行扫描。
    // - 注释边界（复核修复）：**字符串感知**——先跳过字符串字面量再找 `#`，
    //   否则 `"a#b"; jmespath.search(...)` 的字符串内 # 会把同行后续代码吞成注释；
    // - 字符串跳过走 completion 侧同款 `scan_string_end`（转义感知，`\"` 不再被
    //   当闭合引号——原 `find` 对 `"a\"b"` 会提前闭合，路径串截断错位）。
    let bytes = line.as_bytes();
    let n = bytes.len();
    let mut code_end = n;
    {
        let mut j = 0;
        while j < n {
            match bytes[j] {
                b'"' | b'\'' => j = scan_string_end(bytes, j),
                b'#' => {
                    code_end = j;
                    break;
                }
                _ => j += 1,
            }
        }
    }
    let mut i = 0;
    while i < code_end {
        let c = bytes[i];
        if c != b'"' && c != b'\'' {
            i += 1;
            continue;
        }
        // 字符串整体跳过（转义感知）；scan_string_end 返回闭合引号之后。
        // 未闭合返回 bytes.len() > code_end → i 越过边界自然终止本行。
        let str_end = scan_string_end(bytes, i);
        let close = str_end.saturating_sub(1); // 闭合引号位置
        if close <= i {
            break; // 空串或未闭合：跳过
        }
        let path = &line[i + 1..close];
        let before = line[..i].trim_end();
        // CR-12：复用补全侧的收窄判定（jmespath.xxx( / .search( / .compile(，排除 re.*）
        if is_jmespath_call_prefix(before) && !path.trim().is_empty() {
            // 数据变量 = 字符串结束引号后的第一个标识符
            let after = line[close + 1..].trim_start();
            let rest = after.strip_prefix(',').unwrap_or(after).trim_start();
            let var_end = rest
                .find(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
                .unwrap_or(rest.len());
            let data_var = &rest[..var_end];
            if is_ident(data_var) {
                if let Some(ty) = type_infer::infer_receiver_type(index, text, data_var, line_idx) {
                    let chain = parse_jmespath_segments(path);
                    if !chain.is_empty() {
                        if let Some(msg) = type_infer::validate_chain(index, &ty, &chain) {
                            out.push(RuntimeDiagnostic {
                                line: line_idx,
                                start_character: byte_to_col(line, i + 1),
                                end_character: byte_to_col(line, close),
                                // Warning：运行时采样可能不完整，字段缺失也可能是未采样到
                                message: msg,
                                severity: 2,
                            });
                        }
                    }
                }
            }
        }
        i = str_end;
    }
}

fn is_ident(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// 行内字节偏移 → UTF-16 列（LSP 坐标；ASCII 时两者相等）。
fn byte_to_col(line: &str, byte: usize) -> u32 {
    line[..byte].chars().map(|c| c.len_utf16() as u32).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencharm_intel_index::{TraceIndex, SCHEMA};
    use rusqlite::Connection;

    fn fixture() -> TraceIndex {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','get_quotes',1,10,0)",
                [],
            )
            .unwrap();
            conn.execute(
                r#"INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, object]','{"data":{"t":"dict","k":{"diff":{"t":"list","e":{"t":"dict","k":{"code":"str","name":"str"}}}}}}',7)"#,
                [],
            )
            .unwrap();
        }
        TraceIndex::open(&path).unwrap()
    }

    #[test]
    fn diagnoses_unknown_field() {
        let idx = fixture();
        let text = "quotes = get_quotes()\nresult = jmespath.search(\"data.dff\", quotes)";
        let diags = diagnose(&idx, text);
        assert_eq!(diags.len(), 1, "{diags:?}");
        assert!(diags[0].message.contains("dff"), "message: {}", diags[0].message);
        assert_eq!(diags[0].line, 1);
    }

    #[test]
    fn diagnoses_index_on_dict() {
        let idx = fixture();
        let text = "quotes = get_quotes()\nresult = jmespath.search(\"data[0]\", quotes)";
        let diags = diagnose(&idx, text);
        assert!(
            diags.iter().any(|d| d.message.contains("下标")),
            "{diags:?}"
        );
    }

    #[test]
    fn no_diag_for_valid_path() {
        let idx = fixture();
        let text = "quotes = get_quotes()\nresult = jmespath.search(\"data.diff[0].code\", quotes)";
        let diags = diagnose(&idx, text);
        assert!(diags.is_empty(), "{diags:?}");
    }

    /// CR-12：`re.search(...)` 不再被误判为 jmespath 调用（曾产生假诊断）。
    #[test]
    fn no_diag_for_re_search() {
        let idx = fixture();
        let text = "quotes = get_quotes()\nresult = re.search(\"data.dff\", quotes)";
        let diags = diagnose(&idx, text);
        assert!(
            diags.is_empty(),
            "re.search 不应产生 jmespath 诊断，实际 {diags:?}"
        );
        // `import re` 后的裸 search 同理（数据变量解析得到 quotes 也不触发）
        let text2 = "quotes = get_quotes()\nfrom re import search\nresult = search(\"data.dff\", quotes)";
        let diags2 = diagnose(&idx, text2);
        assert!(diags2.is_empty(), "裸 search( 不应产生 jmespath 诊断，实际 {diags2:?}");
    }

    /// CR-12：链式形态 `jmespath.compile("...").search("...", data)`（`.search(` 前缀）仍识别。
    #[test]
    fn diag_for_chained_compile_search() {
        let idx = fixture();
        let text = "quotes = get_quotes()\nresult = jmespath.compile(\"data\").search(\"dff\", quotes)";
        let diags = diagnose(&idx, text);
        assert!(
            diags.iter().any(|d| d.message.contains("dff")),
            "链式 .search( 应识别为 jmespath 调用，实际 {diags:?}"
        );
    }

    /// TD-027 D8：注释内的撇号不再开启伪字符串吞掉后续真实调用。
    #[test]
    fn comment_apostrophe_does_not_swallow_following_call() {
        let idx = fixture();
        let text = "quotes = get_quotes()\n# it's fine here\nresult = jmespath.search(\"data.dff\", quotes)";
        let diags = diagnose(&idx, text);
        // 注释行的撇号此前开启伪字符串 → 把第三行的 jmespath 调用吞进"字符串"，
        // 诊断丢失；现在注释截断后第三行正常扫描。
        assert!(
            diags.iter().any(|d| d.message.contains("dff")),
            "注释撇号后 jmespath 调用应正常诊断，实际 {diags:?}"
        );
    }

    /// TD-027 D8：字符串转义感知——`\"` 不再被当闭合引号，路径不截断错位。
    #[test]
    fn escaped_quote_in_string_keeps_path_intact() {
        let idx = fixture();
        // 路径含转义引号（构造场景）：`data.diff` 前有一个转义引号字符串段。
        // 原实现对 `"x\"` 形态提前闭合 → path 被截成 `x\`，valid 路径反被判为未知。
        let text = r#"quotes = get_quotes()
result = jmespath.search("data.diff", quotes)  # ok \" not a closer"#;
        let diags = diagnose(&idx, text);
        assert!(diags.is_empty(), "转义/注释混合下 valid 路径不应误报，实际 {diags:?}");
    }

    /// TD-027 D8：注释里的 jmespath 调用不产生诊断（原实现会扫注释内容）。
    #[test]
    fn jmespath_call_inside_comment_ignored() {
        let idx = fixture();
        let text = "quotes = get_quotes()\n# result = jmespath.search(\"data.dff\", quotes)";
        let diags = diagnose(&idx, text);
        assert!(diags.is_empty(), "注释内调用不应诊断，实际 {diags:?}");
    }

    /// TD-027 D8（复核修复）：字符串内的 `#` 不是注释——`"a#b"` 后同一行的
    /// 真实调用必须照常诊断。原首版实现取整行首个 #，会吞掉后续代码。
    #[test]
    fn hash_inside_string_does_not_eat_following_call() {
        let idx = fixture();
        let text = "quotes = get_quotes()\ns = \"a#b\"; result = jmespath.search(\"data.dff\", quotes)";
        let diags = diagnose(&idx, text);
        assert!(
            diags.iter().any(|d| d.message.contains("dff")),
            "字符串内 # 不应吞掉同行后续调用，实际 {diags:?}"
        );
    }

    /// TD-027 D8（复核修复）：字符串内 `#` + 伪路径——路径串含 # 时按非法段
    /// 处理（非标识符被丢弃 → 空 chain → 不诊断），不得截断成部分路径做校验。
    #[test]
    fn hash_inside_path_string_yields_no_truncated_validation() {
        let idx = fixture();
        let text = "quotes = get_quotes()\nresult = jmespath.search(\"data#diff\", quotes)";
        let diags = diagnose(&idx, text);
        // "data#diff" 整段非合法 jmespath 标识符（# 拆出的 data 与 #diff 中后者被丢弃）
        // → chain 非空但来自 "data"——不应产生截断伪诊断（data 是合法键）
        assert!(diags.is_empty(), "含 # 的非法路径不应产生伪诊断，实际 {diags:?}");
    }
}