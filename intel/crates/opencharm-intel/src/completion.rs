//! P3-T03 运行时补全：符号补全 + 属性补全 + 调用实参补全的统一入口。
//!
//! - **符号补全**（P3-T03）：`qualname` 是命名空间链，直接匹配 `mod.cls.member` / 顶级函数名；
//! - **属性补全**（P3-T03b）：`x.` / `x.field` 时，经 `type_infer` 推断 `x` 的运行时类型，
//!   再用 `members_for_type` 聚合该类型的 shape 字段（dict 键 / 实例属性名）为候选。
//! - **调用实参补全**（A3①）：光标位于 `foo(|` / `foo(a, |` 内时，按 `arg_types` 的参数位观测
//!   给出**参数名**候选（insertText `name=`），detail 附运行时观测类型与证据数；已写出的
//!   keyword 参数被排除，位置参数按观测顺序前跳。
//!
//! A3③（签名帮助，`signature.rs`）复用本模块的 `call_frame_at` / `written_args` /
//! `resolve_callee` / `param_observations`——**上下文扫描与 callee 解析只有这一份**，
//! 差别只在产出物（补全是候选列表，签名帮助是单条签名 + 当前参数位）。
//!
//! TD-027 C3 拆分（2026-10-10）：括号栈扫描与文本辅助函数外提至 `call_context.rs`
//! （有界窗口扫描，O(文档) → O(窗口)）；本模块保留补全语义层。
//!
//! 纯函数设计：不依赖 tower-lsp，便于单元测试（server.rs 负责 LSP 类型转换）。

use std::collections::HashMap;

use opencharm_intel_index::{Function, TraceIndex};
use opencharm_intel_index::type_label::is_dict;

use crate::call_context::{call_frame_at, call_receiver_at, utf16_to_byte, written_args};
use crate::type_infer;

const MAX_CANDIDATES: usize = 50;

/// stale（所在文件在末次运行后被改过）函数的补全降权除数。
///
/// 此前是 `f.hits / 2` 的裸字面量，无常量名、无依据记录——`dev_plan_v2` §7
/// 「基于真实使用数据调整降权策略」因此长期标 ⚠️。
///
/// **首个实测依据**（2026-10-03，`tools/intel/trace_stats.py` + 可复现实验）：
/// 构造 2 个源文件各 2 个函数，先全量跑一次，改动其中 1 个文件的 mtime 后只跑另一半，
/// 结果 stale 占比 **30.0%**（3/10）。即在常见的「改一个文件、只跑相关代码」编辑流下，
/// 约三分之一的运行时观测立刻变 stale——这说明 stale 并非罕见边角情况。
/// 当时 `trace_stats.py` 的建议规则给出 0.25（stale ≥30% 档）。
///
/// **为何暂不改成 0.25**：上面样本仅 10 条函数，来源是合成实验，不足以支撑改交互体感。
/// 现状 0.5 保持不变，但参数从此显式可审；等真实项目跑出 ≥1000 条观测后按同一脚本复核
/// （`python tools/intel/trace_stats.py <db> --out bench/reports/trace-stats.md`）。
const STALE_HITS_DIVISOR: i64 = 2;

/// 补全候选（server 层转 `CompletionItem`，sortText `1xx` 段）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub label: String,
    pub kind: CandidateKind,
    pub detail: String,
    pub score: i64,
    /// A3①：调用实参候选插入 `name=`（其余候选为 `None`，由 server 层回落 label）。
    pub insert_text: Option<String>,
}

impl Candidate {
    /// 统一构造（`insert_text` 默认 `None`）——新增字段时只需改这一处。
    pub(crate) fn new(label: impl Into<String>, kind: CandidateKind, detail: String, score: i64) -> Self {
        Candidate {
            label: label.into(),
            kind,
            detail,
            score,
            insert_text: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateKind {
    Function,
    Field,
    /// A3①：调用实参名（LSP `VARIABLE`）。
    Param,
    /// P2：except 处观测过的异常类型（LSP `CLASS`）。
    Exception,
}

/// 补全结果：候选列表 + 是否因 `MAX_CANDIDATES` 截断。
///
/// P0-A1：`truncated` 供 LSP 响应声明 `is_incomplete`——截断时客户端继续输入会重新请求，
/// 否则可能被当作「可本地过滤的完整集合」，导致第 51 名以后的运行时符号永远补不出来。
#[derive(Debug, Default, Clone)]
pub struct CompletionOutcome {
    pub candidates: Vec<Candidate>,
    /// `true` = 候选数超过 `MAX_CANDIDATES`，列表被截断（语义是「被截断」而非「暂无数据」）。
    pub truncated: bool,
}

/// 统一补全入口（带截断元信息）：下标访问（dict 键）+ 符号补全 + 属性补全，去重后按证据强度（score）降序。
pub fn complete_with_meta(
    index: &TraceIndex,
    text: &str,
    line: u32,
    character: u32,
) -> CompletionOutcome {
    // jmespath 路径补全：`jmespath.search("data.diff[0].co", data)` 字符串内补字段
    if let Some(jm) = jmespath_ctx_at(text, line, character) {
        if let Some(ty) = type_infer::infer_receiver_type(index, text, &jm.data_var, line) {
            let member_keys = type_infer::chain_keys(index, &ty, &jm.chain);
            let mut candidates = Vec::new();
            for (field, count) in member_keys {
                if field.starts_with(&jm.prefix) {
                    candidates.push(Candidate::new(
                        field,
                        CandidateKind::Field,
                        format!("⟳ runtime · {} · {} obs", ty, count),
                        count,
                    ));
                }
            }
            let (candidates, truncated) = dedup_sort_truncate(candidates);
            return CompletionOutcome { candidates, truncated };
        }
        return CompletionOutcome::default();
    }

    // 下标访问补全（dict 键 / list 元素）：`data["prefix` / `data["key"]["prefix` / `rows[0]["prefix`。
    // P1（2026-10-10）：base 放开为调用链——`parse_page(html)["` / `get_quotes()[0]["` 的
    // receiver 类型走 infer_call_chain_type，沿 chain 解析 shape 的机器不变。
    if let Some(sub) = subscript_ctx_at(text, line, character) {
        let ty = match &sub.receiver {
            Receiver::Ident(base, _) => type_infer::infer_receiver_type(index, text, base, line),
            Receiver::Call(expr, _) => type_infer::infer_call_chain_type(index, text, expr, line),
        };
        if let Some(ty) = ty {
            // 沿访问链解析 shape（空链=顶层键；Key 进 dict 子节点；Index 进 list 元素）
            let member_keys = type_infer::chain_keys(index, &ty, sub.receiver.chain());
            let mut candidates = Vec::new();
            for (field, count) in member_keys {
                if field.starts_with(&sub.prefix) {
                    candidates.push(Candidate::new(
                        field,
                        CandidateKind::Field,
                        format!("⟳ runtime · {} · {} obs", ty, count),
                        count,
                    ));
                }
            }
            let (candidates, truncated) = dedup_sort_truncate(candidates);
            return CompletionOutcome { candidates, truncated };
        }
        // 下标访问但推断不到 base 类型：不产生补全
        return CompletionOutcome::default();
    }

    // P2（2026-10-10）except 异常补全：`except ValueErr` / `except (A, B` →
    // 运行时观测过的异常类型（exc_types 表全库聚合）。必须在 call_ctx 之前——
    // `except (` 会被 call_ctx_at 判为分组括号而拒绝。
    if let Some(prefix) = except_ctx_at(text, line, character) {
        let mut candidates = exc_candidates(index, &prefix);
        // 空前缀（`except `）不并符号候选——否则全量函数灌入 except 头部成噪声；
        // 非空前缀保留符号补全（自定义异常工厂等仍可见）。
        if !prefix.is_empty() {
            candidates.extend(symbol_candidates(index, &[], &prefix));
        }
        let (candidates, truncated) = dedup_sort_truncate(candidates);
        return CompletionOutcome { candidates, truncated };
    }

    // 调用实参补全（A3①）：`foo(|` / `foo(a, |` → 该函数的参数名候选（带运行时观测类型）。
    // callee **无运行时观测时不拦截**（`print(` 等内建）——返回 None 回落符号补全，保持既有行为。
    if let Some(ctx) = call_ctx_at(text, line, character) {
        if let Some((cands, truncated)) = param_candidates(index, &ctx) {
            return CompletionOutcome { candidates: cands, truncated };
        }
    }

    // P1 调用链属性补全：receiver 是调用表达式（`parse_page(html).` /
    // `order.get_total().fi`）时，dot_chain_at 的纯点链回扫会错切 parent——
    // 用括号感知的 call_receiver_at 提取 `(表达式, 前缀)`，走 infer_call_chain_type。
    // 纯点链 / 跨行未闭合括号 → None，继续走原符号补全路径（行为不变）。
    if let Some((expr, prefix)) = call_receiver_at(text, line, character) {
        if let Some(ty) = type_infer::infer_call_chain_type(index, text, &expr, line) {
            if !is_dict(&ty) {
                let mut candidates = Vec::new();
                for (field, count) in type_infer::members_for_type(index, &ty) {
                    if field.starts_with(&prefix) {
                        candidates.push(Candidate::new(
                            field,
                            CandidateKind::Field,
                            format!("⟳ runtime · {} · {} obs", ty, count),
                            count,
                        ));
                    }
                }
                let (candidates, truncated) = dedup_sort_truncate(candidates);
                return CompletionOutcome { candidates, truncated };
            }
            return CompletionOutcome::default();
        }
        // 链式 receiver 推不出类型：返回空（不回落符号补全——parent 切分在链形态下
        // 语义不成立，回落会把 `get_total` 当 parent 段产生错误候选）
        return CompletionOutcome::default();
    }

    let Some(token) = dot_chain_at(text, line, character) else {
        return CompletionOutcome::default();
    };
    if token.is_empty() {
        return CompletionOutcome::default();
    }

    let ends_with_dot = token.ends_with('.');
    let trimmed = token.trim_end_matches('.');
    let segs: Vec<String> = trimmed
        .split('.')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    if segs.is_empty() {
        return CompletionOutcome::default();
    }

    let parent: Vec<String>;
    let prefix: String;
    let receiver: Option<String>;
    if ends_with_dot {
        parent = segs.clone();
        prefix = String::new();
        receiver = Some(trimmed.to_string());
    } else {
        let last = segs[segs.len() - 1].clone();
        parent = segs[..segs.len() - 1].to_vec();
        prefix = last;
        receiver = if parent.is_empty() {
            None
        } else {
            Some(parent.join("."))
        };
    }

    let mut candidates = symbol_candidates(index, &parent, &prefix);

    // 属性补全：仅单段 receiver（变量名）可做轻量类型推断；dict 键走下标补全，此处排除。
    // P1（2026-10-10）：调用链 receiver（`parse_page(html).` / `order.get_total().`）
    // 已在上文 call_receiver_at 分支拦截——dot_chain_at 的回扫字符集不含括号，
    // 走到这里的 receiver 恒为纯点链（无调用）。
    if let Some(recv) = &receiver {
        if is_identifier(recv) {
            if let Some(ty) = type_infer::infer_receiver_type(index, text, recv, line) {
                if !is_dict(&ty) {
                    for (field, count) in type_infer::members_for_type(index, &ty) {
                        if field.starts_with(&prefix) {
                            candidates.push(Candidate::new(
                                field,
                                CandidateKind::Field,
                                format!("⟳ runtime · {} · {} obs", ty, count),
                                count,
                            ));
                        }
                    }
                }
            }
        }
    }

    let (candidates, truncated) = dedup_sort_truncate(candidates);
    CompletionOutcome { candidates, truncated }
}

/// 统一补全入口（无截断元信息）：委托 [`complete_with_meta`]，测试与既有调用点沿用此签名。
///
/// `#[allow(dead_code)]`：产物只经 `server.rs` 的 `complete_with_meta`，本函数在当前 bin 里
/// 仅测试使用——保留它是为了让 30+ 个既有测试（以及未来只想拿候选的调用点）零改动。
#[allow(dead_code)]
pub fn complete(index: &TraceIndex, text: &str, line: u32, character: u32) -> Vec<Candidate> {
    complete_with_meta(index, text, line, character).candidates
}

// ---------- A3① 调用实参补全 ----------

/// 调用实参上下文：光标位于某个调用的 `(` 与（尚未闭合的）`)` 之间。
///
/// 只做「够用」的静态判定（与 A5 `ep_sample_cmds` 同一条纪律：纯文本、零子进程、只读）：
/// 前向扫描跟踪括号栈 + 字符串/注释，取**最内层**未闭合 `(`，再回溯取 callee 点链。
#[derive(Debug, PartialEq, Eq)]
struct CallCtx {
    /// callee 点链（`foo` / `scraper.parse_page`）。
    callee: String,
    /// 已写出的 keyword 参数名（`foo(a=1, …)` 的 `a`）。
    keywords: Vec<String>,
    /// 已写出的位置参数个数（顶层逗号切分、无顶层 `=`、且不含光标所在段）。
    positional: usize,
    /// 光标所在段的 trim 结果（空串 = 刚打完 `(` 或 `,`）。
    segment: String,
}

/// 调用实参补全：`arg_types` 的参数位观测 → 参数名候选（insertText `name=`）。
/// 返回 `(候选, 是否截断)`；callee 解析不到（无运行时观测）返回 `None`——调用方据此回落符号补全。
fn param_candidates(index: &TraceIndex, ctx: &CallCtx) -> Option<(Vec<Candidate>, bool)> {
    let f = resolve_callee(index, &ctx.callee)?;
    let obs = param_observations(f);
    let mut out = Vec::new();
    // 位置参数前跳（2026-10-08 review 修正）：`i` 是**观测列表**下标而非真实参数位。
    // 签名前段的参数位可能无观测（从未以该类型被记录），观测序整体前移——
    // 固定按 `i < positional` 跳会在「观测缺位」时系统性多跳（例：签名 (a,b,c) 只
    // 观测到 b/c，写 f(x,| 时 b 被错误跳过，候选只剩 c）。缺位不可静态判定，
    // 取保守语义：跳过 min(positional, 观测数)——宁可多给一个已填参数的候选
    // （用户忽略即可），不让候选集被错误清空。
    let skip = ctx.positional.min(obs.len());
    for (i, p) in obs.iter().enumerate() {
        if ctx.keywords.iter().any(|k| k == &p.name) {
            continue; // 已按 keyword 写出
        }
        if i < skip {
            continue; // 已按位置写出（顺序取自观测首次出现序，见 param_observations）
        }
        if !p.name.starts_with(&ctx.segment) {
            continue;
        }
        let mut cand = Candidate::new(
            p.name.clone(),
            CandidateKind::Param,
            format!("⟳ runtime · {} · {} obs", p.type_label, p.count),
            p.count,
        );
        cand.insert_text = Some(format!("{}=", p.name));
        out.push(cand);
    }
    Some(dedup_sort_truncate(out))
}

/// 单个参数的观测聚合（同名参数的多条类型观测合并）。
pub(crate) struct ParamObs {
    pub name: String,
    pub type_label: String,
    pub count: i64,
    /// A3③：该参数位**证据最高**那条观测的 shape（签名帮助据此给「常见键 / 常见属性」）。
    pub shape: Option<String>,
}

/// 按 `arg_types` **首次出现顺序**聚合参数观测：同名参数取证据最高的类型，count 求和。
///
/// 顺序依据：probe 逐参数位记录类型观测，`arg_types` 的行序即参数位首次出现序
/// （`TraceIndex::load_args` 按 fid 保持表内行序）。这是「位置参数前跳」的唯一依据，
/// 属尽力而为——**观测缺失的参数位不会出现在顺序里**（例：签名 (a,b,c) 只观测到
/// b/c 时，观测序整体前移一位）。消费端（param_candidates / active_index）据此
/// 把前跳钳到 min(positional, 观测数)，宁可多给候选也不清空候选集。
pub(crate) fn param_observations(f: &Function) -> Vec<ParamObs> {
    let mut order: Vec<String> = Vec::new();
    // name -> (证据最高的类型, 该类型计数, 全部类型计数之和, 该类型观测的 shape)
    let mut agg: HashMap<String, (String, i64, i64, Option<String>)> = HashMap::new();
    for a in &f.args {
        let e = agg.entry(a.arg.clone()).or_insert_with(|| {
            order.push(a.arg.clone());
            (a.type_label.clone(), 0, 0, a.shape.clone())
        });
        if a.count > e.1 {
            e.0 = a.type_label.clone();
            e.1 = a.count;
            // A3③：shape 与「证据最高的类型」取自同一条观测，不混搭
            e.3 = a.shape.clone();
        }
        e.2 += a.count;
    }
    order
        .into_iter()
        .filter_map(|n| {
            agg.get(&n).map(|(t, _best, total, shape)| ParamObs {
                name: n.clone(),
                type_label: t.clone(),
                count: *total,
                shape: shape.clone(),
            })
        })
        .collect()
}

/// callee → 函数：先按最后段匹配（与 hover 同口径），再试类构造 `Cls(...)` → `Cls.__init__`。
/// A3③（签名帮助）复用同一份解析，保证「补全给谁参数名」与「签名弹窗显示谁」始终一致。
pub(crate) fn resolve_callee<'a>(index: &'a TraceIndex, callee: &str) -> Option<&'a Function> {
    if let Some(f) = best_function(index, callee) {
        return Some(f);
    }
    // TD-027 A8：类构造回落。旧实现 `by_qualname("{callee}.__init__")` 是全名精确匹配，
    // 只覆盖「trace qualname == 用户写法 + .__init__」这一种巧合（同文件裸类名）。
    // probe 记录的是 `code.co_qualname`——**不含模块路径**（定义在 mymod/scraper.py 的
    // 类存的是 `Scraper.__init__`），用户写 `mymod.Scraper(` / `import mymod` 后的
    // `mymod.Scraper(` 均拼不出全名 → 导入类构造的实参补全/签名帮助系统性失效。
    //
    // 修法：取 callee 的**类名最后段**（`mymod.Scraper` → `Scraper`），按
    // `{类名}.__init__` 做后缀匹配（qualname == 它，或以 `.类名.__init__` 结尾——嵌套类
    // `Outer.Scraper.__init__` 也算），多候选按 (非 stale, hits) 取最高——与 best_function
    // 同一裁决式，不引入第二套排序口径。
    let class_seg = callee.rsplit('.').next().unwrap_or(callee);
    if class_seg.is_empty() {
        return None;
    }
    let suffix = format!("{class_seg}.__init__");
    index
        .functions()
        .iter()
        .filter(|f| {
            f.qualname == suffix
                || (f.qualname.ends_with(&suffix) && {
                    // 后缀必须落在段边界上（`Foo.__init__` 后缀不命中 `MyFoo.__init__`）
                    let head = &f.qualname[..f.qualname.len() - suffix.len()];
                    head.ends_with('.')
                })
        })
        .max_by_key(|f| (!f.stale, f.hits))
}

/// 取 qualname 最后段 == `name` 最后段的函数中 hits 最高者（非 stale 优先）。
/// hover 模块复用（原 `hover::find_function` 内联了同一段比较）。
pub(crate) fn best_function<'a>(index: &'a TraceIndex, name: &str) -> Option<&'a Function> {
    let seg = name.rsplit('.').next().unwrap_or(name);
    let mut best: Option<&Function> = None;
    for f in index.by_last_segment(seg) {
        if best.map_or(true, |b| (!f.stale, f.hits) > (!b.stale, b.hits)) {
            best = Some(f);
        }
    }
    best
}

// TD-027 C3：`CallFrame` / `call_frame_at` / `written_args` / `split_top_level` /
// `top_level_eq` / `scan_string_end` / `text_offset` / `utf16_to_byte` 已外提至
// `call_context.rs`（有界窗口扫描）；本模块与 signature.rs / diagnostics.rs / hover.rs
// 统一从那里 import。

/// 提取调用实参上下文；光标不在「调用的实参列表」内时返回 `None`（让位给其余补全分支）。
fn call_ctx_at(text: &str, line: u32, character: u32) -> Option<CallCtx> {
    let frame = call_frame_at(text, line, character)?;

    // 光标所在段必须是空或纯标识符（`b.` / `f(` 让位给其余补全分支）
    let last = frame.segments.last().cloned().unwrap_or_default();
    let last_trim = last.trim();
    let segment = if last_trim.is_empty() {
        String::new()
    } else if is_identifier(last_trim) {
        last_trim.to_string()
    } else {
        return None;
    };

    let (keywords, positional) = written_args(&frame.segments);

    Some(CallCtx {
        callee: frame.callee,
        keywords,
        positional,
        segment,
    })
}

/// 符号补全：qualname 命名空间链匹配。
/// CR-17：不再全量扫描 + 每函数 split('.')——
/// - parent 为空（顶级符号）：按最后段前缀倒排迭代；
/// - parent 非空：qualname 倒数第二段必须 == parent 末段，用倒排粗筛后再完整校验段链。
/// TD-027 D7：不做内部去重——同 label 候选（不同文件同名函数）由调用方的
/// `dedup_sort_truncate` 统一去重（保留 score 高者），此处先收集后合并即可。
fn symbol_candidates(index: &TraceIndex, parent: &[String], prefix: &str) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::new();

    let iter: Box<dyn Iterator<Item = &Function>> = if parent.is_empty() {
        Box::new(index.functions_by_last_segment_prefix(prefix))
    } else {
        // 倒数第二段 == parent 末段（matches_chain 的必要条件）
        let last_parent = &parent[parent.len() - 1];
        Box::new(index.by_second_last_segment(last_parent))
    };

    for f in iter {
        let qsegs: Vec<&str> = f.qualname.split('.').collect();
        if let Some(member) = matches_chain(&qsegs, parent, prefix) {
            let ret = top_ret(f);
            let ret_suffix = if ret.is_empty() {
                String::new()
            } else {
                format!(" · ret→{}", ret)
            };
            // P3-T08 新鲜度：stale（代码已变更）函数降权 + 标注，仍可见但排后
            let stale_note = if f.stale { " · stale" } else { "" };
            let detail =
                format!("⟳ runtime · {} · {} hits{}{}", f.qualname, f.hits, ret_suffix, stale_note);
            out.push(Candidate::new(
                member.clone(),
                CandidateKind::Function,
                detail,
                if f.stale { f.hits / STALE_HITS_DIVISOR } else { f.hits },
            ));
        }
    }
    out
}

/// 同 label 去重（保留 score 高者）→ score 降序 → 截断。
///
/// 返回 `(候选项, 是否发生截断)`：截断标记在 truncate 前取，供 LSP `is_incomplete` 声明（P0-A1）。
fn dedup_sort_truncate(cands: Vec<Candidate>) -> (Vec<Candidate>, bool) {
    let mut map: HashMap<String, Candidate> = HashMap::new();
    for c in cands {
        map.entry(c.label.clone())
            .and_modify(|e| {
                if c.score > e.score {
                    *e = c.clone();
                }
            })
            .or_insert(c);
    }
    let mut v: Vec<Candidate> = map.into_values().collect();
    v.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.label.cmp(&b.label)));
    let truncated = v.len() > MAX_CANDIDATES;
    v.truncate(MAX_CANDIDATES);
    (v, truncated)
}

/// 光标前「点链 token」提取：回溯 `[A-Za-z0-9_.]`，允许以点结尾（成员补全信号）。
fn dot_chain_at(text: &str, line: u32, character: u32) -> Option<String> {
    let target_line = text.lines().nth(line as usize)?;
    let target_line = target_line.trim_end_matches('\r');
    let byte_end = utf16_to_byte(target_line, character);
    let bytes = target_line.as_bytes();
    let mut start = byte_end;
    while start > 0 {
        let c = bytes[start - 1];
        if c.is_ascii_alphanumeric() || c == b'_' || c == b'.' {
            start -= 1;
        } else {
            break;
        }
    }
    Some(target_line[start..byte_end].to_string())
}

/// jmespath 补全上下文：数据变量 + 已解析路径链 + 当前字段前缀。
struct JmCtx {
    data_var: String,
    chain: Vec<type_infer::Access>,
    prefix: String,
}

/// CR-12：识别 jmespath 一行式调用的接收者前缀（`quote 前的文本 trimmed）。
/// 收窄规则：
/// - `jmespath.search(` / `jmespath.compile(`：模块限定全名（最精确）；
/// - `).search(`：链式形态 `jmespath.compile("a").search("path", data)`——前面的
///   `)` 表明 receiver 是另一调用的返回值，jmespath 风格的链式用法；
/// - 裸 `search(` / `compile(` 与任意标识符同名调用（`re.search(` / `myobj.search(`
///   等）误判，已移除。
pub(crate) fn is_jmespath_call_prefix(before: &str) -> bool {
    if before.ends_with("jmespath.search(") || before.ends_with("jmespath.compile(") {
        return true;
    }
    if before.ends_with("re.search(") {
        return false;
    }
    before.ends_with(").search(")
}

/// 检测 `xxx.search("path…", data)` / `xxx.compile("path…", data)` 一行式调用，
/// 光标在路径字符串内时提取数据变量、解析访问链与未完成前缀。
fn jmespath_ctx_at(text: &str, line: u32, character: u32) -> Option<JmCtx> {
    let target = text.lines().nth(line as usize)?;
    let target = target.trim_end_matches('\r');
    let byte = utf16_to_byte(target, character);
    let bytes = target.as_bytes();

    // 1. 光标前路径文本（jmespath 字符集：标识符 / . / [ / ] / - / *）
    let mut i = byte;
    while i > 0 {
        let c = bytes[i - 1];
        if c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b'[' | b']' | b'-' | b'*') {
            i -= 1;
        } else {
            break;
        }
    }
    let path_text = &target[i..byte];

    // 2. 路径文本前必须是开引号，且引号前是 jmespath 调用（收窄后的判定）
    if i == 0 || (bytes[i - 1] != b'"' && bytes[i - 1] != b'\'') {
        return None;
    }
    let open = i - 1;
    let before = target[..open].trim_end();
    if !is_jmespath_call_prefix(before) {
        return None;
    }

    // 3. 向右找闭合引号，再提取第二个参数（数据变量）
    let quote = bytes[open] as char;
    let close = byte + target[byte..].find(|c| c == quote)?;
    let after = target[close + 1..].trim_start();
    let rest = after.strip_prefix(',').unwrap_or(after).trim_start();
    let var_end = rest
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .unwrap_or(rest.len());
    let data_var = &rest[..var_end];
    if !is_identifier(data_var) {
        return None;
    }

    let (chain, prefix) = parse_jmespath_path(path_text);
    Some(JmCtx {
        data_var: data_var.to_string(),
        chain,
        prefix,
    })
}

/// 解析 jmespath 路径（光标前文本）→ (已解析段链, 未完成字段前缀)。
fn parse_jmespath_path(s: &str) -> (Vec<type_infer::Access>, String) {
    let trimmed = s.trim_end();
    if trimmed.is_empty() {
        return (Vec::new(), String::new());
    }
    // 以 `]` 结尾 → 全部是完整段（下标闭合），无前缀
    if trimmed.ends_with(']') {
        return (parse_jmespath_segments(trimmed), String::new());
    }
    // 否则最后一个 `.` 之后是未完成字段前缀
    let (done, prefix_part) = match trimmed.rfind('.') {
        Some(pos) => (trimmed[..pos].trim_end_matches('.'), &trimmed[pos + 1..]),
        None => ("", trimmed),
    };
    let prefix = prefix_part
        .split(|c| c == '[' || c == ']')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    (parse_jmespath_segments(done), prefix)
}

/// 把已完成段（点分隔，含下标）解析为访问链。诊断模块复用。
pub(crate) fn parse_jmespath_segments(s: &str) -> Vec<type_infer::Access> {
    let mut chain = Vec::new();
    for seg in s.split('.') {
        if seg.is_empty() {
            continue;
        }
        let bracket = seg.find('[').unwrap_or(seg.len());
        let field = seg[..bracket].trim();
        if is_identifier(field) {
            chain.push(type_infer::Access::Key(field.to_string()));
        }
        // 下标链：[*] / [0] / [-1]
        let mut rest = &seg[bracket..];
        while rest.starts_with('[') {
            let Some(close) = rest.find(']') else { break };
            let inner = &rest[1..close];
            let digits = |x: &str| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit());
            let is_index = inner == "*"
                || digits(inner)
                || (inner.len() > 1 && inner.as_bytes()[0] == b'-' && digits(&inner[1..]));
            if !is_index {
                break; // 过滤 [?] / 字段下标：不支持
            }
            chain.push(type_infer::Access::Index);
            rest = &rest[close + 1..];
        }
    }
    chain
}

/// 下标访问上下文：receiver（单标识符或调用链）+ 访问链 + 当前 key 前缀。
struct SubscriptCtx {
    receiver: Receiver,
    prefix: String,
}

// P2 except 异常补全（2026-10-10）已外提 except_completion.rs——预算纪律
// 「拆分即降阈值」（P2 批 +109 行使本文件 958/950 超限）。use 引入的名字
// 对 `use super::*` 的测试子模块同样可见。
use crate::except_completion::{exc_candidates, except_ctx_at};

/// 提取下标访问上下文：`id["prefix` / `id["key"]["prefix` / `id["a"][0]["prefix` 等。
/// 链式最多 MAX_CHAIN 层；点链 receiver、变量索引暂不处理。
fn subscript_ctx_at(text: &str, line: u32, character: u32) -> Option<SubscriptCtx> {
    let target_line = text.lines().nth(line as usize)?;
    let target_line = target_line.trim_end_matches('\r');
    let byte_end = utf16_to_byte(target_line, character);
    let bytes = target_line.as_bytes();

    // 1. 光标前已输入的 key 前缀（标识符字符）
    let mut i = byte_end;
    while i > 0 && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_') {
        i -= 1;
    }
    let prefix = target_line[i..byte_end].to_string();

    // 2. 前缀前必须是开引号 `"` 或 `'`
    if i == 0 || (bytes[i - 1] != b'"' && bytes[i - 1] != b'\'') {
        return None;
    }
    let rest = target_line[..i - 1].trim_end();

    // 3. 剥离最外层 `.get(` 或 `[`，得到 receiver 侧表达式（含完整访问链）
    let receiver_expr = if let Some(base) = rest.strip_suffix(".get(") {
        base
    } else if let Some(base) = rest.strip_suffix('[') {
        base
    } else {
        return None;
    };
    let receiver = parse_receiver(receiver_expr)?;
    Some(SubscriptCtx { receiver, prefix })
}

/// 解析下标/调用链 receiver：`id`、`id["k"]`、`id[0]`、`id.get("k")` 及任意组合（≤ MAX_CHAIN）。
/// 逆向逐段剥离，容忍赋值前缀（如 `y = quotes["data"][0]`）。
/// P1（2026-10-10）：base 放开为调用链——`parse_page(html)["k"]` / `get_quotes()[0]["k"]`
/// 的最左段是配对括号收尾的调用表达式（剥离完下标/`.get` 链后仍以 `)` 结尾）时，
/// 返回链表达式 base（下标分支走 infer_call_chain_type + 沿 chain 解析）。
fn parse_receiver(s: &str) -> Option<Receiver> {
    let mut cur = s.trim_end();
    let mut chain: Vec<type_infer::Access> = Vec::new();
    loop {
        // 尾部 `[...]`：字符串键 → Key；纯数字 → Index；其他 → 不支持
        if let Some(close) = cur.rfind(']') {
            let open = cur[..close].rfind('[')?;
            let inner = cur[open + 1..close].trim();
            if let Some(key) = strip_quotes(inner) {
                chain.push(type_infer::Access::Key(key));
            } else if !inner.is_empty() && inner.bytes().all(|b| b.is_ascii_digit()) {
                chain.push(type_infer::Access::Index);
            } else {
                return None;
            }
            cur = cur[..open].trim_end();
            continue;
        }
        // 尾部 `.get("key")`（中间段）；不匹配则是普通调用（`fn(args)` / `obj.m(args)`）
        // ——调用链 base，停止剥离（P1：原实现此处 `?` 直接放弃，调用后下标补不出来）。
        if let Some(close) = cur.rfind(')') {
            if let Some(dot) = cur[..close].rfind(".get(") {
                if let Some(key) = strip_quotes(&cur[dot + 5..close]) {
                    chain.push(type_infer::Access::Key(key));
                    cur = cur[..dot].trim_end();
                    continue;
                }
            }
            break;
        }
        break;
    }
    if chain.len() > type_infer::MAX_CHAIN {
        return None;
    }
    chain.reverse();
    // base 判定：`.get(` 剥离后仍以 `)` 收尾 → 调用链表达式（含首段调用 + 可选方法链）；
    // 否则单标识符（原路径）。`.get(` 本身已在上文消费，这里的 `)` 只能来自调用。
    if cur.ends_with(')') {
        // 剥掉可能残留的赋值前缀（`y = parse_page(html)` → `parse_page(html)`）：
        // 找 `)` 的配对 `(`，再向左找第一个非表达式字符。
        let close = cur.rfind(')')?;
        let mut depth = 0usize;
        let mut open = 0usize;
        for (bi, b) in cur.as_bytes().iter().enumerate().take(close + 1).rev() {
            match b {
                b')' => depth += 1,
                b'(' => {
                    depth -= 1;
                    if depth == 0 {
                        open = bi;
                        break;
                    }
                }
                _ => {}
            }
        }
        if depth != 0 {
            return None;
        }
        // open 向左必须是表达式字符（标识符/点）或行首——`y = ` 这类前缀截掉
        let mut start = open;
        while start > 0 {
            let c = cur.as_bytes()[start - 1];
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'.' {
                start -= 1;
            } else {
                break;
            }
        }
        let base_expr = cur[start..].trim();
        if base_expr.is_empty() {
            return None;
        }
        Some(Receiver::Call(base_expr.to_string(), chain))
    } else {
        let base = last_identifier(cur)?;
        Some(Receiver::Ident(base, chain))
    }
}

/// 下标/属性访问的 receiver 解析结果。
#[derive(Debug, PartialEq, Eq)]
enum Receiver {
    /// 单标识符 base + 访问链（原路径：infer_receiver_type）。
    Ident(String, Vec<type_infer::Access>),
    /// 调用链表达式 base + 访问链（P1：infer_call_chain_type）。
    Call(String, Vec<type_infer::Access>),
}

impl Receiver {
    fn chain(&self) -> &[type_infer::Access] {
        match self {
            Receiver::Ident(_, c) | Receiver::Call(_, c) => c,
        }
    }
}

/// 取尾部独立标识符（前驱非 `.`，排除 `a.b` 点链 receiver）；空/非标识符返回 None。
fn last_identifier(s: &str) -> Option<String> {
    let s = s.trim_end();
    let bytes = s.as_bytes();
    let mut start = bytes.len();
    while start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_') {
        start -= 1;
    }
    if start == bytes.len() {
        return None;
    }
    if start > 0 && bytes[start - 1] == b'.' {
        return None;
    }
    Some(s[start..].to_string())
}

/// 剥离一层配对引号 `"..."` / `'...'`，返回内部内容。
fn strip_quotes(s: &str) -> Option<String> {
    let s = s.trim();
    let b = s.as_bytes();
    if b.len() >= 2 {
        let (o, c) = (b[0], b[b.len() - 1]);
        if (o == b'"' && c == b'"') || (o == b'\'' && c == b'\'') {
            return Some(s[1..s.len() - 1].to_string());
        }
    }
    None
}

/// 判断 qualname 段链与输入链的匹配；命中返回成员名（最后一段）。
fn matches_chain(qsegs: &[&str], parent: &[String], prefix: &str) -> Option<String> {
    let m = qsegs.len();
    let p = parent.len();
    if m < p + 1 {
        return None;
    }
    for (i, seg) in parent.iter().enumerate() {
        if qsegs[m - p - 1 + i] != seg.as_str() {
            return None;
        }
    }
    let member = qsegs[m - 1];
    if member.starts_with(prefix) && !member.is_empty() {
        Some(member.to_string())
    } else {
        None
    }
}

fn top_ret(f: &Function) -> String {
    f.rets
        .iter()
        .max_by_key(|r| r.count)
        .map(|r| r.type_label.clone())
        .unwrap_or_default()
}

fn is_identifier(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')
}


#[cfg(test)]
#[path = "completion_tests.rs"]
mod tests;
