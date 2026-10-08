//! LSP Backend（P3-T01 骨架 + P3-T03 运行时补全）。
//!
//! 懒加载 trace 索引：初始化时从 `initializationOptions.traceDbPath` 拿库路径，
//! 首次补全请求时同步加载（单项目规模 ~百 ms）。文档经 didOpen/didChange/didClose 全量同步。
//!
//! CR-18：并发模型重构——
//! - `index` 改 `Option<Arc<TraceIndex>>`：读锁内只做 `Arc::clone` 快照后**释放锁**，
//!   重计算在锁外/spawn_blocking 执行，不再持读锁做全量扫描（大索引阻塞事件循环）；
//! - `documents` 改 `HashMap<String, Arc<str>>`：取文本 = `Arc::clone` 零拷贝；
//! - `RwLock.unwrap()`（中毒即每请求 panic 连锁）全部改为 `parking_lot::RwLock`（无中毒概念）；
//! - CR-15：`documents` 存 `(version, text)`，didChange 仅当 version 更大时写入（防乱序回退）；
//! - CR-16：加载失败指数退避（每键重试），不再每键重试打满 stderr。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

use parking_lot::RwLock;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer};

use opencharm_intel_index::TraceIndex;

use crate::completion::{complete_with_meta, CandidateKind, CompletionOutcome};
use crate::definition;
use crate::diagnostics;
use crate::hover;
use crate::inlay;
use crate::signature;

#[derive(Default)]
struct Inner {
    /// CR-15：文档表（version, text）——仅 version 更大时写入，防乱序覆盖。
    documents: HashMap<String, (i32, Arc<str>)>,
    trace_db_path: Option<PathBuf>,
    /// CR-18：Arc 快照——读锁内只 clone Arc，重计算在锁外执行。
    index: Option<Arc<TraceIndex>>,
    /// 加载索引时的 trace 库 mtime：运行脚本重写库后据此检测并重载。
    index_mtime: Option<SystemTime>,
    /// A-P2-2（2026-09-29 review）：加载索引时的库 size——mtime 相同但 size 变化
    /// （Windows 写方持句柄时 mtime 更新可能延迟）也触发重载。此前只算了 size
    /// 却在比较与存储两处丢弃，CR-16 注释承诺的组合判定并未落地。
    index_size: Option<u64>,
    /// CR-16：加载失败退避——连续失败次数（指数退避，超过上限只按周期重试）。
    index_fail_count: u32,
}

pub struct Backend {
    #[allow(dead_code)]
    client: Client,
    inner: RwLock<Inner>,
    /// A-P2-3（2026-09-29 review）：加载互斥（in-flight 去重）——tower-lsp 每条消息
    /// 独立 task，连续键入时并发补全各自 spawn_blocking 全量加载（大库数百 ms~秒级、
    /// 内存峰值 ×N）。try_lock 拿不到锁 = 已有在途加载，本请求直接返回（空候选），
    /// 加载完成后后续请求命中缓存。
    index_load_lock: tokio::sync::Mutex<()>,
}

/// CR-16 退避闸门：这是自上次成功以来的第 `attempt_no` 次加载请求，是否放行尝试。
/// 前 3 次每次尝试；此后只在第 4/8/16/...（2 的幂）次请求时尝试。
/// ⚠ `attempt_no` 必须是**请求序号**（含被拦下的），不能是「实际尝试次数」——
/// 后者会让计数停在 3 后永不放行（退避死锁，2026-10-08 review P0）。
fn should_retry(attempt_no: u32) -> bool {
    attempt_no <= 3 || attempt_no.is_power_of_two()
}

impl Backend {
    pub fn new(client: Client) -> Self {
        Backend {
            client,
            inner: RwLock::new(Inner::default()),
            index_load_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// CR-18：取文档快照（Arc<str> 零拷贝），读锁立即释放。
    fn document_snapshot(&self, uri: &str) -> Option<Arc<str>> {
        self.inner.read().documents.get(uri).map(|(_, t)| Arc::clone(t))
    }

    /// CR-18：取索引快照（Arc clone），读锁立即释放；重计算在锁外执行。
    fn index_snapshot(&self) -> Option<Arc<TraceIndex>> {
        self.inner.read().index.as_ref().map(Arc::clone)
    }

    /// 懒加载 trace 索引（失败仅日志，不阻塞补全：无索引返回空候选）。
    /// 同步的 SQLite 全量加载放到 spawn_blocking，避免阻塞 tokio 事件循环
    /// （debug 构建或大库加载可能数百 ms ~ 数秒，期间不能让其他请求全部卡住）。
    ///
    /// CR-16：加载失败指数退避——原来的「每键重试 + 每次 eprintln」在库缺失/损坏时
    /// 每个补全请求都重试一次（每键数百 ms IO + stderr 刷屏）。
    /// 连续失败 N 次后改为每 8 次请求重试一次（约等于用户停顿间隔）。
    ///
    /// A-P2-3（2026-09-29 review）：`index_load_lock` 互斥——并发请求只有一个执行
    /// 加载，其余直接返回（不排队不重复 IO）。try_lock 而非 lock：排队等加载结果
    /// 会把 N 个并发请求的时延串成一列，返回空候选让下一次键入命中缓存更简单。
    async fn ensure_index_loaded(&self) {
        let path = {
            let g = self.inner.read();
            g.trace_db_path.clone()
        };
        let Some(path) = path else { return };

        // 运行脚本会重写 trace 库：以库 mtime 判断是否需要（重新）加载——首次加载，
        // 或库已更新（mtime 变化）时重载，保证「运行一次 → 补全立刻用上最新观测」。
        // CR-16：mtime+size 组合判定（Windows 下写方持句柄时 mtime 更新可能延迟，
        // 同 mtime 但 size 变化也应触发重载）。
        // A-P2-2（2026-09-29 review）：组合判定落地——原实现计算了 size 却在比较与
        // 存储两处丢弃（注释自认“size 未单独存”），Windows 持句柄写库的核心场景
        // （运行脚本重写库）可能 mtime 不变而 size 变，导致补全一直用陈旧索引。
        let stamp = std::fs::metadata(&path)
            .and_then(|m| Ok((m.modified()?, m.len())))
            .ok();
        {
            let g = self.inner.read();
            let loaded = g
                .index_mtime
                .zip(g.index_size)
                .zip(stamp)
                .map(|((mt, sz), (t, s))| mt == t && sz == s)
                .unwrap_or(false);
            if g.index.is_some() && loaded {
                return;
            }
        }

        // CR-16：退避闸门（2026-10-08 review P0 重构）——两点：① 放在新鲜度检查
        // 之后（稳态请求不推进计数，否则真需要重载时反被成功历史拦住）；② 计数
        // 语义 = 「自上次成功以来的第 N 次请求」**含被拦下的**（先自增再判定）——
        // 旧实现只在尝试失败后自增，被拦请求不计数，fail_count=3 后闸门拦下一切、
        // 计数永远停在 3 → 本会话永不重试（新项目库缺失连败 3 次后永久放弃）。
        let attempt_no = {
            let mut g = self.inner.write();
            g.index_fail_count = g.index_fail_count.saturating_add(1);
            g.index_fail_count
        };
        if !should_retry(attempt_no) {
            return; // 本次请求被退避拦下（计数已推进，重试窗口到来时自然放行）
        }

        // A-P2-3：在途加载互斥——拿不到锁说明已有加载在进行，本次直接返回
        let Ok(_guard) = self.index_load_lock.try_lock() else { return };

        let display_path = path.display().to_string();
        match tokio::task::spawn_blocking(move || TraceIndex::open(&path)).await {
            Ok(Ok(index)) => {
                let mut g = self.inner.write();
                g.index = Some(Arc::new(index));
                // A-P2-2：size 一并存（与 mtime 组成 (mtime, size) 戳）
                g.index_mtime = stamp.map(|(t, _)| t);
                g.index_size = stamp.map(|(_, s)| s);
                g.index_fail_count = 0;
            }
            Ok(Err(e)) => {
                // CR-16：计数已在闸门处推进（被拦下的请求同样计数），此处只负责日志。
                // 只在放行点（第 1/2/3/4/8/16... 次请求）打印，被拦下的请求静默。
                eprintln!("[opencharm-intel] 加载 trace 库失败 {display_path}: {e}");
            }
            Err(e) => {
                eprintln!("[opencharm-intel] 加载 trace 库任务异常: {e}");
            }
        }
    }

    /// 生成 jmespath 运行时诊断并发布（source=opencharm-intel，前端按引擎分 owner 显示）。
    async fn publish_diagnostics(&self, uri: &Url) {
        self.ensure_index_loaded().await;
        let uri_str = uri.to_string();
        // CR-18：锁内只取快照，重计算移出锁外（原持读锁对全文本扫描）
        let snapshot = {
            let g = self.inner.read();
            match (g.index.as_ref(), g.documents.get(&uri_str)) {
                (Some(idx), Some((_, text))) => Some((Arc::clone(idx), Arc::clone(text))),
                _ => None,
            }
        };
        let Some((index, text)) = snapshot else {
            self.client.publish_diagnostics(uri.clone(), Vec::new(), None).await;
            return;
        };
        // CR-18：CPU 密集的诊断扫描放 spawn_blocking（原在 async worker + 读锁内同步跑）
        let diags = tokio::task::spawn_blocking(move || diagnostics::diagnose(&index, &text))
            .await
            .unwrap_or_default();
        let diags = diags
            .into_iter()
            .map(|d| Diagnostic {
                range: Range {
                    start: Position {
                        line: d.line,
                        character: d.start_character,
                    },
                    end: Position {
                        line: d.line,
                        character: d.end_character,
                    },
                },
                severity: Some(match d.severity {
                    1 => DiagnosticSeverity::ERROR,
                    2 => DiagnosticSeverity::WARNING,
                    3 => DiagnosticSeverity::INFORMATION,
                    _ => DiagnosticSeverity::HINT,
                }),
                code: None,
                code_description: None,
                source: Some("opencharm-intel".to_string()),
                message: d.message,
                related_information: None,
                tags: None,
                data: None,
            })
            .collect();
        self.client.publish_diagnostics(uri.clone(), diags, None).await;
    }
}

/// 补全候选 → LSP 响应（P0-A1）。
///
/// 截断时声明 `is_incomplete`，让客户端在继续输入时**重新请求**而不是拿截断列表本地过滤
/// ——否则第 `MAX_CANDIDATES + 1` 名以后的运行时符号永远补不出来。
///
/// 非目标：索引未加载/加载中返回空候选**不**标 `is_incomplete`（那是「暂无数据」不是「被截断」）。
fn to_completion_response(outcome: CompletionOutcome) -> CompletionResponse {
    let items = outcome
        .candidates
        .iter()
        .enumerate()
        .map(|(i, c)| CompletionItem {
            label: c.label.clone(),
            kind: Some(match c.kind {
                CandidateKind::Function => CompletionItemKind::FUNCTION,
                CandidateKind::Field => CompletionItemKind::FIELD,
                CandidateKind::Param => CompletionItemKind::VARIABLE,
            }),
            detail: Some(c.detail.clone()),
            // A3①：实参候选插入 `name=`；其余候选无 insertText（客户端回落 label）
            insert_text: c.insert_text.clone(),
            // 段位契约：`1xx` 段，按 score 降序固化（ADR-0009 六段合并真源）
            sort_text: Some(format!("1{:03}", i)),
            ..Default::default()
        })
        .collect::<Vec<_>>();

    CompletionResponse::List(CompletionList {
        is_incomplete: outcome.truncated,
        items,
    })
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, params: InitializeParams) -> Result<InitializeResult> {
        let trace_db_path = params
            .initialization_options
            .as_ref()
            .and_then(|v| v.get("traceDbPath"))
            .and_then(|v| v.as_str())
            .map(PathBuf::from);

        {
            let mut g = self.inner.write();
            g.trace_db_path = trace_db_path;
        }

        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                // CR-02：显式声明全量文本同步——缺省时标准客户端不发 didOpen/didChange，
                // documents 恒空导致补全/hover/诊断全短路；did_change 取最后 contentChange
                // 全文替换，必须声明 FULL 契约（增量同步会损坏文档）。
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                completion_provider: Some(CompletionOptions {
                    // A3①：`(` / `,` 用于「调用实参补全」——打完 `(` 或 `,` 即给出参数名候选
                    trigger_characters: Some(vec![
                        ".".to_string(),
                        "_".to_string(),
                        "\"".to_string(),
                        "'".to_string(),
                        "[".to_string(),
                        "(".to_string(),
                        ",".to_string(),
                    ]),
                    resolve_provider: Some(true),
                    ..Default::default()
                }),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                definition_provider: Some(OneOf::Left(true)),
                inlay_hint_provider: Some(OneOf::Left(true)),
                // A3③：`(` / `,` 触发签名弹窗；`,` 重触发（换参数位时刷新高亮）。
                // 与 shell `registerLspSignatureHelp` 的 trigger/retrigger 字符一一对应。
                signature_help_provider: Some(SignatureHelpOptions {
                    trigger_characters: Some(vec!["(".to_string(), ",".to_string()]),
                    retrigger_characters: Some(vec![",".to_string()]),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, "opencharm-intel ready (runtime intelligence LSP)")
            .await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let uri = params.text_document.uri;
        let version = params.text_document.version;
        let text: Arc<str> = Arc::from(params.text_document.text);
        // CR-15 同款版本守卫（2026-10-08 review）：迟到 didOpen 不得回滚 didChange
        // 已写入的新文本（与 did_change 守卫对称）。⚠ 块作用域化：锁守卫不跨 await。
        {
            let mut g = self.inner.write();
            let newer = g
                .documents
                .get(uri.as_str())
                .map_or(true, |(v, _)| version > *v);
            if newer {
                g.documents.insert(uri.to_string(), (version, text));
            }
        }
        self.publish_diagnostics(&uri).await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        // 全量同步（与 shell 桥 didChangeFull 语义一致）：取最后一个 content change 的全文。
        if let Some(change) = params.content_changes.into_iter().last() {
            // CR-15：版本号校验——tower-lsp 每条消息独立 task，并发 didChange(v1,v2)
            // 的写锁获取顺序不保证；旧 version 后到不得覆盖新文本。
            let mut g = self.inner.write();
            let newer = g
                .documents
                .get(uri.as_str())
                .map_or(true, |(v, _)| params.text_document.version > *v);
            if newer {
                g.documents.insert(
                    uri.to_string(),
                    (params.text_document.version, Arc::from(change.text)),
                );
            }
        }
        self.publish_diagnostics(&uri).await;
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.inner
            .write()
            .documents
            .remove(&params.text_document.uri.to_string());
    }

    async fn completion(&self, params: CompletionParams) -> Result<Option<CompletionResponse>> {
        let uri = params.text_document_position.text_document.uri.to_string();
        let position = params.text_document_position.position;

        let Some(text) = self.document_snapshot(&uri) else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let Some(index) = self.index_snapshot() else {
            return Ok(None);
        };
        // CR-18：补全计算放 spawn_blocking（原持读锁在 async worker 同步跑全量扫描）
        let outcome = tokio::task::spawn_blocking(move || {
            complete_with_meta(&index, &text, position.line, position.character)
        })
        .await
        .unwrap_or_default();

        Ok(Some(to_completion_response(outcome)))
    }

    async fn completion_resolve(&self, params: CompletionItem) -> Result<CompletionItem> {
        // 补全项信息已完整，原样返回（与 shell 桥的二段 resolve 调用兼容）。
        Ok(params)
    }

    /// A3③：签名帮助。与 `completion` 同一份上下文解析与参数位聚合（见 `signature.rs`），
    /// 差别只在产出物——补全是候选列表，这里是「单条观测签名 + 当前参数位」。
    async fn signature_help(&self, params: SignatureHelpParams) -> Result<Option<SignatureHelp>> {
        let uri = params.text_document_position_params.text_document.uri.to_string();
        let position = params.text_document_position_params.position;

        let Some(text) = self.document_snapshot(&uri) else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let Some(index) = self.index_snapshot() else {
            return Ok(None);
        };
        // CR-18：签名合成放 spawn_blocking（与补全 / hover / 跳转同口径）
        let sig = tokio::task::spawn_blocking(move || {
            signature::signature_help(&index, &text, position.line, position.character)
        })
        .await
        .unwrap_or(None);
        let Some(sig) = sig else {
            return Ok(None);
        };

        let doc = signature::render_signature_doc(&sig);
        let parameters: Vec<ParameterInformation> = sig
            .params
            .iter()
            .map(|p| ParameterInformation {
                // 字符串标签必须是签名 label 的子串；Python 不允许重名参数，故无歧义
                label: ParameterLabel::Simple(p.name.clone()),
                documentation: Some(Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: signature::render_param_doc(p),
                })),
            })
            .collect();

        Ok(Some(SignatureHelp {
            signatures: vec![SignatureInformation {
                label: sig.label,
                documentation: Some(Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: doc,
                })),
                parameters: Some(parameters),
                // 单一真源：只用外层 `active_parameter`（`SignatureInformation` 的那份
                // 是 3.16 起、且要求客户端显式声明支持，填两处反而会打架）
                active_parameter: None,
            }],
            active_signature: Some(0),
            active_parameter: Some(sig.active_parameter),
        }))
    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        let uri = params.text_document_position_params.text_document.uri.to_string();
        let position = params.text_document_position_params.position;

        let Some(text) = self.document_snapshot(&uri) else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let Some(index) = self.index_snapshot() else {
            return Ok(None);
        };
        // CR-18：hover 推断放 spawn_blocking
        let info = tokio::task::spawn_blocking(move || {
            hover::hover(&index, &text, position.line, position.character)
        })
        .await
        .unwrap_or(None);
        let Some(info) = info else {
            return Ok(None);
        };
        let value = hover::render(&info);

        Ok(Some(Hover {
            contents: HoverContents::Markup(MarkupContent {
                kind: MarkupKind::Markdown,
                value,
            }),
            range: None,
        }))
    }

    async fn goto_definition(
        &self,
        params: GotoDefinitionParams,
    ) -> Result<Option<GotoDefinitionResponse>> {
        let uri = params.text_document_position_params.text_document.uri.to_string();
        let position = params.text_document_position_params.position;

        let Some(text) = self.document_snapshot(&uri) else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let Some(index) = self.index_snapshot() else {
            return Ok(None);
        };
        // CR-18：跳转查询放 spawn_blocking
        let targets = tokio::task::spawn_blocking(move || {
            definition::definition(&index, &text, position.line, position.character)
        })
        .await
        .unwrap_or_default();
        if targets.is_empty() {
            return Ok(None);
        }

        let locations: Vec<Location> = targets
            .into_iter()
            .filter_map(|t| {
                let url = Url::from_file_path(&t.filename).ok()?;
                let line0 = (t.lineno - 1).max(0) as u32;
                Some(Location {
                    uri: url,
                    range: Range {
                        start: Position { line: line0, character: 0 },
                        end: Position { line: line0, character: 0 },
                    },
                })
            })
            .collect();

        if locations.is_empty() {
            Ok(None)
        } else {
            Ok(Some(GotoDefinitionResponse::Array(locations)))
        }
    }

    async fn inlay_hint(&self, params: InlayHintParams) -> Result<Option<Vec<InlayHint>>> {
        let uri = params.text_document.uri.to_string();
        let Some(text) = self.document_snapshot(&uri) else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let Some(index) = self.index_snapshot() else {
            return Ok(None);
        };
        // CR-18：inlay 扫描放 spawn_blocking
        let hints: Vec<InlayHint> =
            tokio::task::spawn_blocking(move || inlay::inlay_hints(&index, &text))
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|h| InlayHint {
                    position: Position::new(h.line, h.character),
                    label: InlayHintLabel::String(h.label),
                    kind: Some(InlayHintKind::TYPE),
                    text_edits: None,
                    tooltip: None,
                    padding_left: Some(true),
                    padding_right: None,
                    data: None,
                })
                .collect();

        if hints.is_empty() {
            Ok(None)
        } else {
            Ok(Some(hints))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::completion::{Candidate, CandidateKind};

    /// 测试用候选（绕开 `Candidate::new` 的 crate 私有可见性）。
    fn cand(label: &str) -> Candidate {
        Candidate {
            label: label.to_string(),
            kind: CandidateKind::Field,
            detail: "⟳ runtime · dict[str, int] · 1 obs".to_string(),
            score: 1,
            insert_text: None,
        }
    }

    /// P0-A1：截断 → `CompletionResponse::List` 且 `is_incomplete == true`；
    /// 段位契约不破（sort_text 仍为 `1000..1049` 连续段）。
    #[test]
    fn declares_is_incomplete_when_truncated() {
        let outcome = CompletionOutcome {
            candidates: (0..50).map(|i| cand(&format!("k{:02}", i))).collect(),
            truncated: true,
        };
        match to_completion_response(outcome) {
            CompletionResponse::List(list) => {
                assert!(list.is_incomplete, "截断必须声明 is_incomplete=true");
                assert_eq!(list.items.len(), 50);
                // 段位契约：`1xx` 段按 score 降序连续编号（ADR-0009）
                assert_eq!(list.items[0].sort_text.as_deref(), Some("1000"));
                assert_eq!(list.items[49].sort_text.as_deref(), Some("1049"));
            }
            other => panic!("截断应返回 CompletionResponse::List，实际 {other:?}"),
        }
    }

    /// P0-A1：未截断 → `is_incomplete == false`（形态仍为 List，客户端两种形态都兼容）。
    #[test]
    fn no_is_incomplete_when_not_truncated() {
        let outcome = CompletionOutcome {
            candidates: vec![cand("title"), cand("url")],
            truncated: false,
        };
        match to_completion_response(outcome) {
            CompletionResponse::List(list) => {
                assert!(!list.is_incomplete, "未截断不得声明 is_incomplete");
                assert_eq!(list.items.len(), 2);
                assert_eq!(list.items[0].sort_text.as_deref(), Some("1000"));
            }
            other => panic!("应返回 CompletionResponse::List，实际 {other:?}"),
        }
    }

    /// 空候选（索引未加载等「暂无数据」场景）→ List + `is_incomplete == false`。
    #[test]
    fn empty_outcome_is_complete_list() {
        match to_completion_response(CompletionOutcome::default()) {
            CompletionResponse::List(list) => {
                assert!(list.items.is_empty());
                assert!(!list.is_incomplete, "空候选不得声明截断");
            }
            other => panic!("应返回 CompletionResponse::List，实际 {other:?}"),
        }
    }

    /// CR-16 退避闸门节奏：前 3 次请求每次尝试；之后只在第 4/8/16...（2 的幂）次请求放行。
    /// 第二段为死锁回归（2026-10-08 review P0）：计数必须是「请求序号」（含被拦下的），
    /// 不能是「实际尝试次数」——旧实现被拦请求不计数，停在 3 后永不放行。
    #[test]
    fn backoff_gate_allows_first_three_then_powers_of_two() {
        for n in 1u32..=3 {
            assert!(should_retry(n), "第 {n} 次请求必须放行");
        }
        for n in [5u32, 6, 7] {
            assert!(!should_retry(n), "第 {n} 次请求拦截");
        }
        for n in [4u32, 8, 16] {
            assert!(should_retry(n), "第 {n} 次请求（2 的幂）放行");
        }
        // 死锁回归：16 个连续失败请求，放行点按 1/2/3/4/8/16 节奏共 6 次
        let attempts = (1u32..=16).filter(|&n| should_retry(n)).count();
        assert_eq!(attempts, 6, "死锁实现（按尝试次数计数）会停在 3 次");
    }
}
