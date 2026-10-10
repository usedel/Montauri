// opencharm-intel 入口（P3-T01）：stdio LSP server。
// 独立进程/独立包，不依赖外壳内部 API（架构第一原则）。
// 数据来源：opencharm-probe 写入的 SQLite trace 库（~/.opencharm/traces/<project-hash>.db）。

mod call_context;
mod completion;
mod definition;
mod diagnostics;
mod hover;
mod inlay;
mod server;
mod signature;
mod type_infer;

use tower_lsp::{LspService, Server};

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let (service, socket) = LspService::new(server::Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}