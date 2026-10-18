//! P2 except 异常补全（2026-10-10）：`except <prefix>` 头部的运行时异常类型候选。
//!
//! 从 completion.rs 外提（预算纪律「拆分即降阈值」——P2 批 +109 行使主文件 958/950 超限）。
//! 数据源 exc_types 表（probe 的 sys.monitoring RAISE 事件——被 except **捕获**的异常
//! 同样入库，捕获链路正是用户写 except 时最想补的类型）。上下文检测为纯行内扫描，
//! 与 completion 的其他分支（下标 / 点链 / 调用实参）互斥：except 头部不含 `[` /
//! 调用括号形态，点链回扫遇 `(` 即断，同一光标位置至多命中一族。

use std::collections::HashMap;

use montauri_intel_index::TraceIndex;

use crate::call_context::utf16_to_byte;
use crate::completion::{Candidate, CandidateKind};

/// 光标是否处于 `except <prefix>` 头部，返回已输入前缀。
///
/// 覆盖形态：`except ValueErr` / `except `（空前缀）/ 元组 `except (A, B`（逗号后）/
/// 模块限定 `except requests.HTTPError`。排除：`except A as`（as 后是绑定名）、
/// `except A:`（冒号后是 body）、含引号/注释行（字符串内或注释中不误触）。
pub(crate) fn except_ctx_at(text: &str, line: u32, character: u32) -> Option<String> {
    let target_line = text.lines().nth(line as usize)?;
    let target_line = target_line.trim_end_matches('\r');
    let byte_end = utf16_to_byte(target_line, character);
    let bytes = target_line.as_bytes();

    // 1. 光标前 token（含点——模块限定异常名）
    let mut i = byte_end;
    while i > 0
        && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_' || bytes[i - 1] == b'.')
    {
        i -= 1;
    }
    let token = &target_line[i..byte_end];

    // 2. token 前的行首余部；含引号或行首注释 → 一律不在 except 头部
    let rest = target_line[..i].trim_end();
    if rest.contains('"') || rest.contains('\'') || rest.trim_start().starts_with('#') {
        return None;
    }

    // 3. 余部须含词边界的 `except` 关键字；冒号说明头部已闭合（body 区）→ 排除
    let kw = find_except_keyword(rest)?;
    if rest.contains(':') {
        return None;
    }
    // 4. except 之后已有 `as` → 光标在绑定名上，不补异常名
    let after = rest[kw + "except".len()..].trim();
    if after.split_whitespace().any(|w| w == "as") {
        return None;
    }
    Some(token.to_string())
}

/// 在 `s` 中找词边界的 `except` 关键字（`handle_except` 等不含词边界的不命中）。
fn find_except_keyword(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut from = 0;
    while let Some(pos) = s[from..].find("except") {
        let p = from + pos;
        let end = p + "except".len();
        let word = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
        let before_ok = p == 0 || !word(bytes[p - 1]);
        let after_ok = end >= bytes.len() || !word(bytes[end]);
        if before_ok && after_ok {
            return Some(p);
        }
        from = end;
    }
    None
}

/// 聚合 trace 观测的异常类型（exc_types 表）为 except 补全候选。
///
/// 全库聚合——异常处理常跨文件复用同批异常类型；同名异常 count 求和作证据强度。
/// 裸前缀（`ValueErr`）按标签最后段匹配；带点前缀（`requests.`）按全名匹配。
pub(crate) fn exc_candidates(index: &TraceIndex, prefix: &str) -> Vec<Candidate> {
    let mut agg: HashMap<&str, i64> = HashMap::new();
    for f in index.functions() {
        for e in &f.excs {
            *agg.entry(e.exc_label.as_str()).or_insert(0) += e.count;
        }
    }
    let mut matched: Vec<(String, i64)> = agg
        .into_iter()
        .filter(|(label, _)| {
            if prefix.contains('.') {
                label.starts_with(prefix)
            } else {
                label.rsplit('.').next().is_some_and(|seg| seg.starts_with(prefix))
            }
        })
        .map(|(l, c)| (l.to_string(), c))
        .collect();
    matched.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    matched
        .into_iter()
        .map(|(label, count)| {
            Candidate::new(
                label,
                CandidateKind::Exception,
                format!("⟳ runtime · 异常观测 · {count} 次"),
                count,
            )
        })
        .collect()
}
