//! 调用上下文解析（从 `completion.rs` 外提的共享模块，TD-027 C3 顺带清偿）。
//!
//! `call_frame_at` / `written_args` / `split_top_level` / `top_level_eq` /
//! `scan_string_end` / `text_offset` / `utf16_to_byte`——补全（A3①）与签名帮助
//! （A3③）共用的**唯一一份**括号栈扫描与 callee 回溯逻辑，避免两处各自漂移。
//!
//! C3（2026-10-10 清偿）：原实现从文档字节 0 前向扫描到光标，O(文档)/请求——
//! 大爬虫文件（百 KB）每次键入（含 `,` 触发）都重扫全篇。现改为**有界窗口扫描**：
//! 只扫光标前 `SCAN_WINDOW_BYTES`（64 KB）+ 起点回退到行首，窗口外视为「不在调用
//! 实参内」。64 KB 约等于 1500 行 Python——真实调用点极少距离函数开头超过这个
//! 距离；超过窗口的调用不做补全（正确性让位于延迟，与 probe「够用的判定」同一
//! 纪律）。诊断/jmespath 路径不受影响（它们不走本函数）。

/// C3：括号栈扫描窗口（字节）。超出窗口的未闭合 `(` 不再参与判定。
///
/// 取 64 KB 的依据：`bench/sample/large_repo` 最大文件 ~4 KB、真实爬虫脚本
/// 单文件 1-2 万行以下占绝对多数；64 KB ≈ 1500 行源码，覆盖「函数定义 → 调用点」
/// 的常见距离绰绰有余，同时把最坏情况钉在常数（而非随文档增长）。
const SCAN_WINDOW_BYTES: usize = 64 * 1024;

/// 调用栈帧：光标位于某次调用的 `(` 与（尚未闭合的）`)` 之间时的**原始**信息。
///
/// A3①（调用实参补全）与 A3③（签名帮助）共用同一次扫描——括号栈 / 字符串跳过 / callee 回溯
/// 只此一份，避免两处逻辑各自漂移。补全在其上再叠「光标段必须是空或纯标识符」的额外约束
/// （见 `completion::call_ctx_at`），签名帮助不需要（光标落在 `foo(a + |` 里也照样该显示签名）。
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct CallFrame {
    /// callee 点链（`foo` / `scraper.parse_page`）。
    pub callee: String,
    /// 顶层逗号切分后的实参段；**末段含光标所在段**（未闭合，可能不完整）。
    pub segments: Vec<String>,
}

/// 提取调用栈帧；光标不在「某次调用的实参列表」内时返回 `None`。
///
/// 只做「够用」的静态判定（与 A5 `ep_sample_cmds` 同一条纪律：纯文本、零子进程、只读）：
/// 前向扫描跟踪括号栈 + 字符串/注释，取**最内层**未闭合 `(`，再回溯取 callee 点链。
///
/// C3：扫描不从文档头开始，而从 `cursor - SCAN_WINDOW_BYTES`（回退到行首边界）开始。
pub(crate) fn call_frame_at(text: &str, line: u32, character: u32) -> Option<CallFrame> {
    // 廉价前置过滤：本行光标前没有 `(` 就不可能处于调用实参内（`,` 触发时挡住绝大多数行）
    let line_text = text.lines().nth(line as usize)?;
    let line_text = line_text.trim_end_matches('\r');
    let byte = utf16_to_byte(line_text, character);
    if !line_text.get(..byte)?.contains('(') {
        return None;
    }

    let cursor = text_offset(text, line, character)?;
    let bytes = text.as_bytes();

    // C3：窗口起点 = max(0, cursor - SCAN_WINDOW_BYTES)，对齐到字符边界后，若发生
    // 截断（naive_start > 0）则**前进**到下一个行首——保证扫描从完整行的开头开始
    // （否则窗口首行被切一半，起点可能落在字符串/注释中间，状态机直接失真）。
    // 小文档（≤64 KB）不截断，从 0 全量扫（与旧行为一致）。
    //
    // 复核修正记录：首版写成 `text[..cursor].rfind('\n')`（光标前最后换行 = 当前行
    // 行首），大文档下窗口缩成当前行；第二版 `rfind` 方向仍反。正确语义是
    // `find`——naive_start 之后的**第一个**换行，窗口覆盖「截断点之后的完整行」。
    let mut naive_start = cursor.saturating_sub(SCAN_WINDOW_BYTES);
    while naive_start < cursor && !text.is_char_boundary(naive_start) {
        naive_start += 1; // 至多推进 3 字节（UTF-8 最长 4 字节）
    }
    let window_start = if naive_start == 0 {
        0
    } else {
        match text[naive_start..cursor].find('\n') {
            Some(nl) => naive_start + nl + 1,
            None => naive_start, // 窗口内整段无换行（超长单行），从截断点起扫
        }
    };

    // 前向扫描：括号栈 + 字符串/注释跳过；光标落在字符串内 → 不是调用实参上下文
    let mut stack: Vec<usize> = Vec::new();
    let mut i = window_start;
    while i < cursor {
        match bytes[i] {
            b'#' => {
                while i < cursor && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            b'"' | b'\'' => {
                let end = scan_string_end(bytes, i);
                if end > cursor {
                    return None; // 光标落在**已闭合**字符串内（如 `foo("a|b")`）
                }
                i = end;
                continue;
            }
            b'(' | b'[' | b'{' => stack.push(i),
            b')' | b']' | b'}' => {
                stack.pop();
            }
            _ => {}
        }
        i += 1;
    }

    let paren = *stack.last()?;
    if bytes[paren] != b'(' {
        return None; // 最内层是 `[` / `{` —— 由下标补全分支处理
    }

    // 回溯 callee 点链；空 / 首尾带点 → 不是调用（如分组括号 `(a + b`）
    let mut s = paren;
    while s > 0 && matches!(bytes[s - 1], b'0'..=b'9' | b'A'..=b'Z' | b'a'..=b'z' | b'_' | b'.') {
        s -= 1;
    }
    let callee = &text[s..paren];
    if callee.is_empty() || callee.starts_with('.') || callee.ends_with('.') {
        return None;
    }
    // `def foo(` / `class Foo(` 是定义不是调用
    let before = text[..s].trim_end();
    let last_word = before
        .rsplit(|c: char| !(c.is_alphanumeric() || c == '_'))
        .next()
        .unwrap_or("");
    if last_word == "def" || last_word == "class" {
        return None;
    }

    Some(CallFrame {
        callee: callee.to_string(),
        segments: split_top_level(&text[paren + 1..cursor]),
    })
}

/// 已写出的实参 → `(keyword 参数名, 位置参数个数)`；只看**除末段外**的段（末段是光标所在段）。
pub(crate) fn written_args(segments: &[String]) -> (Vec<String>, usize) {
    let mut keywords = Vec::new();
    let mut positional = 0usize;
    for seg in &segments[..segments.len().saturating_sub(1)] {
        let t = seg.trim();
        if t.is_empty() {
            continue;
        }
        match top_level_eq(t) {
            Some((lhs, _)) if is_identifier(lhs.trim()) => keywords.push(lhs.trim().to_string()),
            _ => positional += 1,
        }
    }
    (keywords, positional)
}

/// 顶层（相对实参列表）按逗号切分；括号/引号感知。空输入返回 `[""]`。
fn split_top_level(s: &str) -> Vec<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut depth = 0i32;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => {
                i = scan_string_end(bytes, i);
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b',' if depth == 0 => {
                out.push(s[start..i].to_string());
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    out.push(s[start..].to_string());
    out
}

/// 顶层 `=` 切分（排除 `==` `!=` `<=` `>=` `:=` 与复合赋值），返回 `(lhs, rhs)`。
fn top_level_eq(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    let mut depth = 0i32;
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => {
                i = scan_string_end(bytes, i);
                continue;
            }
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            b'=' if depth == 0 => {
                let prev = if i > 0 { bytes[i - 1] } else { 0 };
                let next = bytes.get(i + 1).copied().unwrap_or(0);
                // 排除 `==` 与复合赋值（`+=` / `:=` / `<=` …）：`=` 左侧紧邻这些字符即非关键字实参
                let compound = b"=!<>:+-*/%&|^@".contains(&prev);
                if next != b'=' && !compound {
                    return Some((&s[..i], &s[i + 1..]));
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// 从 `start`（引号位置）跳过整个字符串字面量，返回闭合引号**之后**的偏移。
/// 支持 `"` / `'` 与三引号；未闭合返回 `bytes.len()`。转义按非 raw 处理（尽力而为）。
/// TD-027 D8：pub(crate)——diagnostics 的行扫描复用同一转义口径（两处原本不一致：
/// 诊断侧 `\"` 转义未处理、注释内引号会开启伪字符串）。
pub(crate) fn scan_string_end(bytes: &[u8], start: usize) -> usize {
    let q = bytes[start];
    let triple = start + 2 < bytes.len() && bytes[start + 1] == q && bytes[start + 2] == q;
    let mut i = if triple { start + 3 } else { start + 1 };
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] == q {
            if !triple {
                return i + 1;
            }
            if i + 2 < bytes.len() && bytes[i + 1] == q && bytes[i + 2] == q {
                return i + 3;
            }
        }
        i += 1;
    }
    bytes.len()
}

/// `(line, character)` → 全文字节偏移（LSP 0 基 UTF-16 列）。
pub(crate) fn text_offset(text: &str, line: u32, character: u32) -> Option<usize> {
    let mut off = 0usize;
    for (i, l) in text.split_inclusive('\n').enumerate() {
        if i as u32 == line {
            let l = l.trim_end_matches('\n').trim_end_matches('\r');
            return Some(off + utf16_to_byte(l, character));
        }
        off += l.len();
    }
    None
}

/// LSP 0 基 UTF-16 列 → 行内字节偏移（hover 模块复用）。
pub(crate) fn utf16_to_byte(line: &str, char_idx: u32) -> usize {
    let mut utf16 = 0u32;
    for (byte, ch) in line.char_indices() {
        if utf16 >= char_idx {
            return byte;
        }
        utf16 += ch.len_utf16() as u32;
    }
    line.len()
}

/// 标识符判定（与 completion.rs 同口径；`written_args` 关键字实参判定用）。
fn is_identifier(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// 提取光标前的**调用链 receiver** 上下文（P1 调用链推断用）。
///
/// 从光标回扫标识符/点/配对括号得到 receiver 串，再按「回扫遇到的第一个顶层 `.`」
/// 切分为 `(表达式, 前缀)`：
/// - `order.get_total().`   → (`order.get_total()`, ``)
/// - `order.get_total().am` → (`order.get_total()`, `am`)
/// - `parse_page(html).`    → (`parse_page(html)`, ``)
///
/// 只在 receiver **含配对括号**（即有调用）且存在顶层 `.` 时返回 Some——纯点链
/// （`x.` / `x.fi`，无括号）返回 None 让位原 dot_chain_at 路径；行内括号不配对
/// （跨行调用未闭合）同样 None。
///
/// 真机验收补充（2026-10-10）：实参里的**列表字面量**（`make_order(9, [1]).`）极常见，
/// 回扫必须把 `[`/`]` 也当配对括号跳过——否则在 `]` 上 break，`has_paren` 误判为
/// false，整条链让位符号补全（真机探针实锤：`make_order(9, []).` 无 runtime 候选）。
pub(crate) fn call_receiver_at(text: &str, line: u32, character: u32) -> Option<(String, String)> {
    let target_line = text.lines().nth(line as usize)?;
    let target_line = target_line.trim_end_matches('\r');
    let byte_end = utf16_to_byte(target_line, character);
    let bytes = target_line.as_bytes();

    // 回扫：标识符/点直接过；配对括号（圆/方）跳配对；其余停。
    // 顶层 dot_pos = 回扫中遇到的第一个 `.`（此时尚未进入任何括号——回扫是从
    // 光标向左，遇到闭括号才进括号，其后的 `.` 都在括号内不算顶层）。
    let mut start = byte_end;
    let mut dot_pos: Option<usize> = None;
    let mut has_paren = false;
    while start > 0 {
        let c = bytes[start - 1];
        if c.is_ascii_alphanumeric() || c == b'_' {
            start -= 1;
        } else if c == b'.' {
            if dot_pos.is_none() {
                dot_pos = Some(start - 1);
            }
            start -= 1;
        } else if c == b')' || c == b']' {
            has_paren = true;
            let (open_ch, close_ch) = if c == b')' {
                (b'(', b')')
            } else {
                (b'[', b']')
            };
            let mut depth = 0usize;
            let mut j = start;
            let mut ok = false;
            while j > 0 {
                let b = bytes[j - 1];
                if b == close_ch {
                    depth += 1;
                } else if b == open_ch {
                    depth -= 1;
                    if depth == 0 {
                        ok = true;
                        break;
                    }
                }
                j -= 1;
            }
            if !ok {
                return None;
            }
            start = j - 1;
        } else {
            break;
        }
    }
    // 必须是「调用 + 点」形态：无括号（纯点链）或无顶层点（`x` / `f(x)` 后未打点）都让位
    if !has_paren {
        return None;
    }
    let dot = dot_pos?;

    let expr = target_line[start..dot].to_string();
    let prefix = target_line[dot + 1..byte_end].to_string();
    if expr.is_empty() {
        return None;
    }
    Some((expr, prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// C3 回归：窗口内的调用帧提取行为不变（跨多行调用 + 字符串感知 + callee 回溯）。
    #[test]
    fn call_frame_at_unchanged_within_window() {
        let text = "x = scraper.parse_page(html,\n    timeout=30)\ny = foo(a, b)\n";
        // 光标在 `,` 之后（行尾）：实参段 ["html", ""]（末段空 = 光标所在段）
        let frame = call_frame_at(text, 0, 28).unwrap();
        assert_eq!(frame.callee, "scraper.parse_page");
        assert_eq!(frame.segments, vec!["html", ""]);

        // 光标在 `b` 之后（`)` 之前）：实参段 ["a", " b"]
        let frame = call_frame_at(text, 2, 12).unwrap();
        assert_eq!(frame.callee, "foo");
        assert_eq!(frame.segments, vec!["a", " b"]);
    }

    /// C3 核心行为差异：**窗口外**的未闭合 `(` 不再让光标被误判进实参列表。
    ///
    /// 旧行为（从文档头扫到底）：文档开头的 `outer(` 未闭合时，任何光标都会被
    /// 判定「位于 outer( 的实参内」——大文件里距函数开头数万字节的光标拿到的是
    /// 完全过期的栈帧。窗口化后：窗口外的不配对括号不参与栈，返回 None 让位。
    #[test]
    fn call_frame_at_paren_outside_window_is_ignored() {
        let mut text = String::from("result = outer(  # 未闭合，位于文档头\n");
        // ~120 KB 无括号 padding（每行 60 字节 × 2000 行），确保超出 64 KB 窗口
        for _ in 0..2000 {
            text.push_str("x = some_padding_value_without_any_parenthesis_here\n");
        }
        // 光标在文档末尾 `y + z` 内——不在任何调用的实参里
        let last_line = "value = y + z";
        text.push_str(last_line);
        let line = text.split('\n').count() as u32 - 1;
        let col = last_line.len() as u32;
        assert!(text.len() > 64 * 1024, "文档须超过窗口大小");
        assert_eq!(call_frame_at(&text, line, col), None);
    }

    /// C3 复核修复的回归钉子：窗口起点回退逻辑首版写成「光标前最后一个换行」，
    /// 64 KB+ 文档下窗口缩成当前行。真正被它咬坏的场景：光标行有一个已闭合的
    /// 调用（过前置过滤），且光标处于跨行的外层调用实参内——窗口缩成当前行后
    /// 括号栈被弹空，外层帧丢失。本用例钉住：窗口必须覆盖光标前的完整多行调用。
    ///
    /// 注：跨行调用若光标所在行完全没有 `(`（如 `foo(1,\n    2`），会被开头的
    /// 前置过滤挡掉返回 None——这是**前置过滤的既有边界**（非本批引入），
    /// 本用例刻意让光标行含 `(` 以穿过前置过滤、直测窗口语义。
    #[test]
    fn call_frame_at_multiline_call_in_large_document() {
        let mut text = String::from("import os\n");
        // ~120 KB padding（超过 64 KB 窗口）
        for _ in 0..2000 {
            text.push_str("x = some_padding_value_without_any_parenthesis_here\n");
        }
        // 外层调用跨行；光标行含一个**已闭合**的调用（inner2）——前置过滤放行
        text.push_str("r = outer(inner(a),\n");
        text.push_str("          b + inner2(c), d");
        let line = text.split('\n').count() as u32 - 1;
        let col = "          b + inner2(c), d".len() as u32;
        assert!(text.len() > 64 * 1024, "文档须超过窗口大小");

        let frame = call_frame_at(&text, line, col).unwrap();
        assert_eq!(frame.callee, "outer");
        assert_eq!(
            frame.segments,
            vec!["inner(a)", "\n          b + inner2(c)", " d"]
        );
    }

    /// C3：文档超窗口，但调用点贴近光标 → 仍正常提取（窗口覆盖调用点即可）。
    /// 窗口外还有一个未闭合的 `[`（若参与栈也不影响 last()，此用例钉住该不变量）。
    #[test]
    fn call_frame_at_bounded_window_still_extracts_nearby_call() {
        let mut text = String::from("data = [\n"); // 未闭合 `[`，在窗口外
        for _ in 0..2000 {
            text.push_str("x = some_padding_value_without_any_parenthesis_here\n");
        }
        text.push_str("result = foo(");
        let line = text.split('\n').count() as u32 - 1;
        let col = "result = foo(".len() as u32;
        assert!(text.len() > 64 * 1024);
        let frame = call_frame_at(&text, line, col).unwrap();
        assert_eq!(frame.callee, "foo");
        // `foo(` 后无实参 → split_top_level("") 返回 [""]
        assert_eq!(frame.segments, vec![""]);
    }

    /// C3：未闭合字符串跨窗口起点时的安全性（不 panic；此处光标在字符串外，正常提取）。
    #[test]
    fn call_frame_at_unclosed_string_across_window() {
        let mut text = String::from("s = \"");
        while text.len() < 100 * 1024 {
            text.push_str("padding line without quotes\n");
        }
        text.push_str("foo(");
        let line = text.split('\n').count() as u32 - 1;
        let frame = call_frame_at(&text, line, 4).unwrap();
        assert_eq!(frame.callee, "foo");
    }

    /// 顶层切分与 `=` 定位的边界（括号嵌套 / 引号 / 复合运算符）——
    /// 随函数从 completion.rs 迁入，语义覆盖不得丢失。
    #[test]
    fn split_and_eq_helpers() {
        assert_eq!(split_top_level(""), vec![""]);
        assert_eq!(split_top_level("a, b"), vec!["a", " b"]);
        // 嵌套括号与字符串内的逗号不切分
        assert_eq!(
            split_top_level(r#"f(1, 2), "x,y""#),
            vec!["f(1, 2)", r#" "x,y""#]
        );
        assert_eq!(top_level_eq("a=1"), Some(("a", "1")));
        assert_eq!(top_level_eq("a == 1"), None);
        assert_eq!(top_level_eq("a := 1"), None);
        assert_eq!(top_level_eq("f(x=1)"), None); // 嵌套内的 `=` 非顶层
        assert_eq!(top_level_eq("a"), None);
    }

    /// C3 性能哨兵（`--ignored` 显式运行；对齐 shell `bench_dep_scan` 惯例）：
    /// `cargo test --release -p opencharm-intel call_frame_bounded_scan -- --ignored --nocapture`
    ///
    /// 1 MB 文档上 `call_frame_at` 必须 < 2ms——有界窗口把扫描钉在 64 KB 常数；
    /// 若退化回 O(文档)（窗口被移除 / 前置过滤被删），1 MB 文档会显著超此阈值。
    /// 阈值给的是宽松上限（debug 构建不跑本测试，release 下含文本定位开销）。
    #[test]
    #[ignore]
    fn call_frame_bounded_scan_does_not_scale_with_document() {
        let pad = "x = some_padding_value_without_any_parenthesis_here\n"; // 55 B/行
        let mut text = String::with_capacity(1024 * 1024 + 64);
        while text.len() < 1024 * 1024 {
            text.push_str(pad);
        }
        text.push_str("result = foo(a, b");
        let line = text.split('\n').count() as u32 - 1;
        let col = "result = foo(a, b".len() as u32;

        let t = std::time::Instant::now();
        let frame = call_frame_at(&text, line, col).unwrap();
        let el = t.elapsed();
        assert_eq!(frame.callee, "foo");
        println!(
            "[bench] call_frame_at on {} KB doc: {:?}",
            text.len() / 1024,
            el
        );
        assert!(
            el.as_millis() < 2,
            "call_frame_at 退化：1 MB 文档耗时 {:?}（有界窗口应 < 2ms）",
            el
        );
    }

    /// 真机验收补充（2026-10-10）：`call_receiver_at` 回扫必须跳过**方括号对**——
    /// 实参里的列表字面量（`make_order(9, [1]).`）是爬虫画像的高频形态。旧实现只认
    /// 圆括号，在 `]` 上 break → has_paren 误判 false → 整条链让位符号补全（真机
    /// 探针实锤：`make_order(9, []).` 无 runtime 候选）。
    #[test]
    fn call_receiver_at_skips_square_bracket_args() {
        // 列表字面量实参：`make_order(9, [1]).` 光标在行尾（`.` 后，col=19）
        let text = "make_order(9, [1]).";
        assert_eq!(
            call_receiver_at(text, 0, 19),
            Some(("make_order(9, [1])".into(), "".into()))
        );

        // 带前缀：`make_order(9, []).pr` 光标行尾 col=20
        let text = "make_order(9, []).pr";
        assert_eq!(
            call_receiver_at(text, 0, 20),
            Some(("make_order(9, [])".into(), "pr".into()))
        );

        // 嵌套：实参同时含圆括号与方括号（wrap 行尾 col=21）
        let text = "wrap(fn(a), [1, 2]).x";
        assert_eq!(
            call_receiver_at(text, 0, 21),
            Some(("wrap(fn(a), [1, 2])".into(), "x".into()))
        );

        // 未闭合的列表字面量实参（光标前是开 `[`，回扫在其上截断，has_paren=false）：
        // 返回 None（保守让位——真实语法下单行内构造不出「`]` 无配对 `[`」的形态）
        let text = "make_order(9, [1.";
        assert_eq!(call_receiver_at(text, 0, 16), None);
    }
}
