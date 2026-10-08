//! A3③ 签名帮助（`textDocument/signatureHelp`）。
//!
//! `(` / `,` 触发：光标位于某次调用的实参列表内时，给出该函数的**观测签名**
//! （参数名 + 该参数位证据最高的运行时类型），并定位**当前参数位**（`activeParameter`），
//! 供编辑器高亮「正在填哪个参数」。
//!
//! **与 A3① 共用一份上下文**：上下文扫描（`completion::call_frame_at`）、callee 解析
//! （`completion::resolve_callee`）、参数位聚合（`completion::param_observations`）全部复用，
//! 本模块只负责「合成签名 label + 算当前参数位 + 出说明文本」。故弹窗高亮的参数位与补全
//! 首推的候选**必然是同一个**，不会出现「补全让你填 `timeout`、弹窗高亮 `url`」的矛盾。
//!
//! ⚠ **口径**（同 A3②）：probe 只记录 `type_label` + `shape`，**绝不 repr 值本身**
//! （见 `probe/README.md` 类型紧凑表示）。因此：
//! - 参数说明只能给「常见键 / 常见属性」（结构），**不存在"实际见过的字面取值"**；
//! - 签名里**没有默认值**（trace 不记默认值），说明文本已显式声明这一点。
//!
//! 纯函数设计：不依赖 tower-lsp，便于单元测试（server.rs 负责 LSP 类型转换）。

use opencharm_intel_index::TraceIndex;
use opencharm_intel_index::type_label::is_dict;

use crate::completion::{ParamObs, call_frame_at, param_observations, resolve_callee, written_args};
use crate::type_infer;

/// 单个参数的展示信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParamInfo {
    pub name: String,
    pub type_label: String,
    pub count: i64,
    /// shape 派生的常见键（dict）/ 常见属性（实例）；无 shape 时为空。
    pub members: Vec<String>,
}

/// 观测签名。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Signature {
    pub qualname: String,
    pub hits: i64,
    /// `parse_page(resp: requests.Response, url: str)`。
    pub label: String,
    pub params: Vec<ParamInfo>,
    /// 当前参数位（`params` 下标）。
    pub active_parameter: u32,
}

/// 签名帮助入口。
///
/// 三处返回 `None`（都不弹空窗）：不在调用实参内 / callee 无运行时观测 / 该函数无参数观测。
///
/// **只给一条签名**：与 A3① 同口径——`resolve_callee` 按「qualname 最后段匹配 + hits 最高
/// （非 stale 优先）」取唯一实现，不列同名候选。Python 无重载，同名不同模块的实现在此列出
/// 只会变成噪声（补全那边同理）。
pub fn signature_help(
    index: &TraceIndex,
    text: &str,
    line: u32,
    character: u32,
) -> Option<Signature> {
    let frame = call_frame_at(text, line, character)?;
    let f = resolve_callee(index, &frame.callee)?;
    let obs = param_observations(f);
    if obs.is_empty() {
        return None; // 无参数观测 → 没有可展示的签名
    }

    let (keywords, positional) = written_args(&frame.segments);
    let active_parameter = active_index(&obs, &keywords, positional);

    let params: Vec<ParamInfo> = obs
        .iter()
        .map(|p| ParamInfo {
            name: p.name.clone(),
            type_label: p.type_label.clone(),
            count: p.count,
            members: p
                .shape
                .as_deref()
                .map(|s| type_infer::shape_members(s, &p.type_label))
                .unwrap_or_default(),
        })
        .collect();

    let short = f.qualname.rsplit('.').next().unwrap_or(&f.qualname);
    let list = params
        .iter()
        .map(|p| format!("{}: {}", p.name, p.type_label))
        .collect::<Vec<_>>()
        .join(", ");
    let label = format!("{short}({list})");

    Some(Signature {
        qualname: f.qualname.clone(),
        hits: f.hits,
        label,
        params,
        active_parameter,
    })
}

/// 当前参数位：观测顺序下**第一个尚未写出**的参数位；全部写出时钳到末位。
///
/// 「已写出」判据与 A3① 一致（已按 keyword 写出的名字 + 已按位置写出的前 `positional` 个），
/// 这是「弹窗高亮 == 补全首推」这条一致性保证的唯一实现点。
/// 与 param_candidates 同步（2026-10-08 review）：`i` 是观测列表下标而非真实参数位，
/// 前跳钳到 min(positional, 观测数)——观测缺位时观测序前移，固定按 positional 跳
/// 会系统性过跳（高亮到错误参数）。
///
/// 钳到末位而非回 0：LSP 客户端要求合法下标，且「参数已填满」时停在最后一个比跳回第一个更少误导。
fn active_index(obs: &[ParamObs], keywords: &[String], positional: usize) -> u32 {
    let last = obs.len().saturating_sub(1);
    let skip = positional.min(obs.len());
    for (i, p) in obs.iter().enumerate() {
        if i < skip || keywords.iter().any(|k| k == &p.name) {
            continue;
        }
        return i as u32;
    }
    last as u32
}

/// 签名级说明（markdown）：来源与口径（含「不含默认值」的显式声明）。
pub fn render_signature_doc(s: &Signature) -> String {
    format!(
        "**⟳ runtime** `{}` · {} hits\n\n\
         签名与类型来自运行时观测（按参数位顺序），**不含默认值**；probe 不记录字面取值。",
        s.qualname, s.hits
    )
}

/// 参数级说明（markdown）：观测类型 ×证据数 + 常见键 / 常见属性。
pub fn render_param_doc(p: &ParamInfo) -> String {
    let mut s = format!("{} ×{}", p.type_label, p.count);
    if !p.members.is_empty() {
        let label = if is_dict(&p.type_label) {
            "常见键"
        } else {
            "常见属性"
        };
        s.push_str(&format!(" · {}: {}", label, p.members.join(", ")));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencharm_intel_index::SCHEMA;
    use rusqlite::Connection;

    /// `scraper.parse_page(url, timeout, retries)`：
    /// 参数位观测 url:str ×10 / timeout:int ×7 / retries:int ×4（无 shape）。
    fn call_fixture() -> TraceIndex {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('scraper.py','scraper.parse_page',1,12,0)",
                [],
            )
            .unwrap();
            for (arg, ty, c) in [("url", "str", 10), ("timeout", "int", 7), ("retries", "int", 4)] {
                conn.execute(
                    "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,?1,?2,'',?3)",
                    rusqlite::params![arg, ty, c],
                )
                .unwrap();
            }
        }
        TraceIndex::open(&path).unwrap()
    }

    /// 取 `doc` 末尾（光标在行尾）的签名。
    fn sig_at(idx: &TraceIndex, doc: &str) -> Option<Signature> {
        signature_help(idx, doc, 0, doc.len() as u32)
    }

    #[test]
    fn signature_after_open_paren() {
        let idx = call_fixture();
        let s = sig_at(&idx, "scraper.parse_page(").unwrap();
        assert_eq!(s.qualname, "scraper.parse_page");
        assert_eq!(s.hits, 12);
        // label 用最后段短名（与 hover 的「签名（观测）」同口径）
        assert_eq!(s.label, "parse_page(url: str, timeout: int, retries: int)");
        assert_eq!(
            s.params.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["url", "timeout", "retries"]
        );
        // 刚打完 `(` → 停在第一个参数位
        assert_eq!(s.active_parameter, 0);
    }

    #[test]
    fn active_parameter_advances_with_positional() {
        let idx = call_fixture();
        let s = sig_at(&idx, r#"scraper.parse_page("http://x", "#).unwrap();
        assert_eq!(s.active_parameter, 1, "已写出 1 个位置参数 → 停在 timeout");
    }

    #[test]
    fn active_parameter_skips_written_keyword() {
        let idx = call_fixture();
        // 已按 keyword 写出 url（位置参数 0 个）→ 跳过 url，停在 timeout
        let s = sig_at(&idx, r#"scraper.parse_page(url="a, b", "#).unwrap();
        assert_eq!(s.active_parameter, 1);
    }

    #[test]
    fn active_parameter_clamps_when_all_written() {
        let idx = call_fixture();
        let s = sig_at(&idx, r#"scraper.parse_page("a", 1, 2, "#).unwrap();
        assert_eq!(s.active_parameter, 2, "参数填满 → 钳到末位而非回 0");
    }

    /// A3③ 与 A3① 的关键差异：光标段是表达式（非纯标识符）时，补全让位，
    /// **签名帮助仍应出弹窗**——用户写 `foo(1 + |` 时照样需要知道在填哪个参数。
    #[test]
    fn signature_survives_non_ident_segment() {
        let idx = call_fixture();
        // 补全在该输入下不产参数候选（call_ctx_at 让位）
        assert!(crate::completion::complete(&idx, "scraper.parse_page(1 + ", 0, 23).is_empty());
        // 签名帮助照出
        let s = sig_at(&idx, "scraper.parse_page(1 + ").unwrap();
        assert_eq!(s.active_parameter, 0);
    }

    #[test]
    fn nested_call_takes_innermost_callee() {
        let idx = call_fixture();
        // 最内层是 len 的括号 → callee=len 无观测 → None（不回落外层）
        assert!(sig_at(&idx, "scraper.parse_page(1 + len(").is_none());
    }

    #[test]
    fn no_signature_for_untraced_or_non_call() {
        let idx = call_fixture();
        // 未观测到的 callee
        assert!(sig_at(&idx, "nope(").is_none());
        // def / class 定义不是调用
        assert!(sig_at(&idx, "def parse_page(").is_none());
        // 分组括号
        assert!(sig_at(&idx, "x = (a + b").is_none());
        // 下标不是调用
        assert!(sig_at(&idx, "data[").is_none());
        // 光标落在**已闭合**字符串内（`"a|b"`）→ 不是实参上下文
        let doc = r#"x = scraper.parse_page("ab")"#;
        assert!(signature_help(&idx, doc, 0, 25).is_none(), "{doc:?}");
    }

    /// 函数有观测但**无参数观测** → 不出空弹窗。
    #[test]
    fn no_signature_without_param_observations() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','m.noargs',1,3,0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'int','',3)",
                [],
            )
            .unwrap();
        }
        let idx = TraceIndex::open(&path).unwrap();
        assert!(sig_at(&idx, "m.noargs(").is_none());
    }

    /// 类构造：`Cls(` → `Cls.__init__` 的参数观测（与 A3① 同一条回落）。
    #[test]
    fn class_constructor_signature() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','Scraper.__init__',1,6,0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'session','requests.Session','',6)",
                [],
            )
            .unwrap();
        }
        let idx = TraceIndex::open(&path).unwrap();
        let s = sig_at(&idx, "Scraper(").unwrap();
        assert_eq!(s.qualname, "Scraper.__init__");
        assert_eq!(s.label, "__init__(session: requests.Session)");
    }

    /// 参数说明：dict → 常见键，实例 → 常见属性；证据最高的类型与 shape 取自同一条观测。
    #[test]
    fn param_members_follow_best_observation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','m.post',1,9,0)",
                [],
            )
            .unwrap();
            // payload：先弱观测 dict（2 次，shape 带 url），后强观测 str（5 次，无 shape）
            conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'payload','dict[str, int]','[\"title\",\"url\"]',2)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'payload','str','',5)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'resp','requests.Response','[\"status_code\"]',9)",
                [],
            )
            .unwrap();
        }
        let idx = TraceIndex::open(&path).unwrap();
        let s = sig_at(&idx, "m.post(").unwrap();
        assert_eq!(s.params[0].name, "payload");
        // 证据最高的是 str ×5 → 类型取 str，shape 也随该条观测（空）而非弱观测的 dict 键
        assert_eq!(s.params[0].type_label, "str");
        assert_eq!(s.params[0].count, 7, "count 为全部观测之和");
        assert!(s.params[0].members.is_empty(), "{:?}", s.params[0].members);
        // 实例属性 → 常见属性
        assert_eq!(s.params[1].members, vec!["status_code".to_string()]);
        assert!(render_param_doc(&s.params[1]).contains("常见属性: status_code"));
        assert!(render_param_doc(&s.params[1]).contains("requests.Response ×9"));
    }

    #[test]
    fn dict_param_doc_uses_key_label() {
        let p = ParamInfo {
            name: "payload".into(),
            type_label: "dict[str, int]".into(),
            count: 4,
            members: vec!["title".into(), "url".into()],
        };
        let doc = render_param_doc(&p);
        assert!(doc.contains("常见键: title, url"), "{doc:?}");
    }

    #[test]
    fn signature_doc_states_no_defaults() {
        let s = Signature {
            qualname: "m.f".into(),
            hits: 3,
            label: "f(a: int)".into(),
            params: vec![ParamInfo {
                name: "a".into(),
                type_label: "int".into(),
                count: 3,
                members: vec![],
            }],
            active_parameter: 0,
        };
        let doc = render_signature_doc(&s);
        assert!(doc.contains("⟳ runtime"));
        assert!(doc.contains("m.f"));
        assert!(doc.contains("不含默认值"), "口径必须显式声明：{doc:?}");
        assert!(doc.contains("不记录字面取值"));
    }
}
