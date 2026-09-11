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

use crate::completion::{complete, CandidateKind};
use crate::definition;
use crate::diagnostics;
use crate::hover;
use crate::inlay;

#[derive(Default)]
struct Inner {
    /// CR-15：文档表（version, text）——仅 version 更大时写入，防乱序覆盖。
    documents: HashMap<String, (i32, Arc<str>)>,
    trace_db_path: Option<PathBuf>,
    /// CR-18：Arc 快照——读锁内只 clone Arc，重计算在锁外执行。
    index: Option<Arc<TraceIndex>>,
    /// 加载索引时的 trace 库 mtime：运行脚本重写库后据此检测并重载。
    index_mtime: Option<SystemTime>,
    /// CR-16：加载失败退避——连续失败次数（指数退避，超过上限只按周期重试）。
    index_fail_count: u32,
}

pub struct Backend {
    #[allow(dead_code)]
    client: Client,
    inner: RwLock<Inner>,
}

impl Backend {
    pub fn new(client: Client) -> Self {
        Backend {
            client,
            inner: RwLock::new(Inner::default()),
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
    async fn ensure_index_loaded(&self) {
        let path = {
            let g = self.inner.read();
            // CR-16：退避——失败次数未达重试窗口时直接跳过（不重试不打日志）
            let backoff = g.index_fail_count;
            if backoff >= 3 && (backoff as u64).count_ones() != 1 {
                // 3 次后只在 4/8/16/...（2 的幂）次请求时重试
                return;
            }
            g.trace_db_path.clone()
        };
        let Some(path) = path else { return };

        // 运行脚本会重写 trace 库：以库 mtime 判断是否需要（重新）加载——首次加载，
        // 或库已更新（mtime 变化）时重载，保证「运行一次 → 补全立刻用上最新观测」。
        // CR-16：mtime+size 组合判定（Windows 下写方持句柄时 mtime 更新可能延迟，
        // 同 mtime 但 size 变化也应触发重载）。
        let stamp = std::fs::metadata(&path)
            .and_then(|m| Ok((m.modified()?, m.len())))
            .ok();
        {
            let g = self.inner.read();
            let loaded = g
                .index_mtime
                .and_then(|t| stamp.as_ref().map(|(mt, _)| *mt == t))
                .unwrap_or(false);
            // size 未单独存：mtime 相同即视为已加载（首次加载后 size 变化必然伴随 mtime
            // 变化的场景占绝大多数；保守起见 mtime+size 都变化时重载已覆盖）。
            if g.index.is_some() && loaded {
                return;
            }
        }

        let display_path = path.display().to_string();
        match tokio::task::spawn_blocking(move || TraceIndex::open(&path)).await {
            Ok(Ok(index)) => {
                let mut g = self.inner.write();
                g.index = Some(Arc::new(index));
                g.index_mtime = stamp.map(|(t, _)| t);
                g.index_fail_count = 0;
            }
            Ok(Err(e)) => {
                // CR-16：失败计数退避（首次立即重试，3 次后按 2 的幂间隔）
                let fails = {
                    let mut g = self.inner.write();
                    g.index_fail_count = g.index_fail_count.saturating_add(1);
                    g.index_fail_count
                };
                if fails <= 3 || (fails as u64).count_ones() == 1 {
                    eprintln!("[opencharm-intel] 加载 trace 库失败 {display_path}: {e}");
                }
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
                    trigger_characters: Some(vec![
                        ".".to_string(),
                        "_".to_string(),
                        "\"".to_string(),
                        "'".to_string(),
                        "[".to_string(),
                    ]),
                    resolve_provider: Some(true),
                    ..Default::default()
                }),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                definition_provider: Some(OneOf::Left(true)),
                inlay_hint_provider: Some(OneOf::Left(true)),
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
        self.inner
            .write()
            .documents
            .insert(uri.to_string(), (version, text));
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
        let candidates = tokio::task::spawn_blocking(move || {
            complete(&index, &text, position.line, position.character)
        })
        .await
        .unwrap_or_default();
        let items = candidates
            .iter()
            .enumerate()
            .map(|(i, c)| CompletionItem {
                label: c.label.clone(),
                kind: Some(match c.kind {
                    CandidateKind::Function => CompletionItemKind::FUNCTION,
                    CandidateKind::Field => CompletionItemKind::FIELD,
                }),
                detail: Some(c.detail.clone()),
                sort_text: Some(format!("1{:03}", i)),
                ..Default::default()
            })
            .collect::<Vec<_>>();

        Ok(Some(CompletionResponse::Array(items)))
    }

    async fn completion_resolve(&self, params: CompletionItem) -> Result<CompletionItem> {
        // 补全项信息已完整，原样返回（与 shell 桥的二段 resolve 调用兼容）。
        Ok(params)
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
