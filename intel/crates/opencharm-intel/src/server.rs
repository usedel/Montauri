//! LSP Backend（P3-T01 骨架 + P3-T03 运行时补全）。
//!
//! 懒加载 trace 索引：初始化时从 `initializationOptions.traceDbPath` 拿库路径，
//! 首次补全请求时同步加载（单项目规模 ~百 ms）。文档经 didOpen/didChange/didClose 全量同步。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::SystemTime;

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
    documents: HashMap<String, String>,
    trace_db_path: Option<PathBuf>,
    index: Option<TraceIndex>,
    /// 加载索引时的 trace 库 mtime：运行脚本重写库后据此检测并重载。
    index_mtime: Option<SystemTime>,
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

    /// 懒加载 trace 索引（失败仅日志，不阻塞补全：无索引返回空候选）。
    /// 同步的 SQLite 全量加载放到 spawn_blocking，避免阻塞 tokio 事件循环
    /// （debug 构建或大库加载可能数百 ms ~ 数秒，期间不能让其他请求全部卡住）。
    async fn ensure_index_loaded(&self) {
        let path = {
            let g = self.inner.read().unwrap();
            g.trace_db_path.clone()
        };
        let Some(path) = path else { return };

        // 运行脚本会重写 trace 库：以库 mtime 判断是否需要（重新）加载——首次加载，
        // 或库已更新（mtime 变化）时重载，保证「运行一次 → 补全立刻用上最新观测」。
        let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        {
            let g = self.inner.read().unwrap();
            if g.index.is_some() && g.index_mtime == mtime {
                return;
            }
        }

        let display_path = path.display().to_string();
        match tokio::task::spawn_blocking(move || TraceIndex::open(&path)).await {
            Ok(Ok(index)) => {
                let mut g = self.inner.write().unwrap();
                g.index = Some(index);
                g.index_mtime = mtime;
            }
            Ok(Err(e)) => {
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
        let diags = {
            let g = self.inner.read().unwrap();
            match (g.index.as_ref(), g.documents.get(&uri_str)) {
                (Some(index), Some(text)) => diagnostics::diagnose(index, text)
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
                            _ => DiagnosticSeverity::WARNING,
                        }),
                        code: None,
                        code_description: None,
                        source: Some("opencharm-intel".to_string()),
                        message: d.message,
                        related_information: None,
                        tags: None,
                        data: None,
                    })
                    .collect(),
                _ => Vec::new(),
            }
        };
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
            let mut g = self.inner.write().unwrap();
            g.trace_db_path = trace_db_path;
        }

        Ok(InitializeResult {
            capabilities: ServerCapabilities {
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
        self.inner
            .write()
            .unwrap()
            .documents
            .insert(uri.to_string(), params.text_document.text);
        self.publish_diagnostics(&uri).await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        // 全量同步（与 shell 桥 didChangeFull 语义一致）：取最后一个 content change 的全文。
        if let Some(change) = params.content_changes.into_iter().last() {
            self.inner.write().unwrap().documents.insert(uri.to_string(), change.text);
        }
        self.publish_diagnostics(&uri).await;
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.inner
            .write()
            .unwrap()
            .documents
            .remove(&params.text_document.uri.to_string());
    }

    async fn completion(&self, params: CompletionParams) -> Result<Option<CompletionResponse>> {
        let uri = params.text_document_position.text_document.uri.to_string();
        let position = params.text_document_position.position;

        let text = {
            let g = self.inner.read().unwrap();
            g.documents.get(&uri).cloned()
        };
        let Some(text) = text else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let items = {
            let g = self.inner.read().unwrap();
            let Some(index) = g.index.as_ref() else {
                return Ok(None);
            };
            let candidates = complete(index, &text, position.line, position.character);
            candidates
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
                .collect::<Vec<_>>()
        };

        Ok(Some(CompletionResponse::Array(items)))
    }

    async fn completion_resolve(&self, params: CompletionItem) -> Result<CompletionItem> {
        // 补全项信息已完整，原样返回（与 shell 桥的二段 resolve 调用兼容）。
        Ok(params)
    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        let uri = params.text_document_position_params.text_document.uri.to_string();
        let position = params.text_document_position_params.position;

        let text = {
            let g = self.inner.read().unwrap();
            g.documents.get(&uri).cloned()
        };
        let Some(text) = text else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let g = self.inner.read().unwrap();
        let Some(index) = g.index.as_ref() else {
            return Ok(None);
        };
        let Some(info) = hover::hover(index, &text, position.line, position.character) else {
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

        let text = {
            let g = self.inner.read().unwrap();
            g.documents.get(&uri).cloned()
        };
        let Some(text) = text else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let g = self.inner.read().unwrap();
        let Some(index) = g.index.as_ref() else {
            return Ok(None);
        };
        let targets = definition::definition(index, &text, position.line, position.character);
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
        let text = {
            let g = self.inner.read().unwrap();
            g.documents.get(&uri).cloned()
        };
        let Some(text) = text else {
            return Ok(None);
        };

        self.ensure_index_loaded().await;

        let g = self.inner.read().unwrap();
        let Some(index) = g.index.as_ref() else {
            return Ok(None);
        };
        let hints: Vec<InlayHint> = inlay::inlay_hints(index, &text)
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