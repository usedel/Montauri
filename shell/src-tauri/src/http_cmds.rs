//! HTTP 请求内核（B4 · `docs/toolbox_dev_plan.md` §5 v2 · 形态改版后面板驱动）。
//!
//! **PR-B4-1**：依赖落地（reqwest 0.13 + rustls + blocking）+ `http_send` / `http_cancel`
//! + 纯函数（URL 校验 / 头名消毒 / 响应体截断 / 私网标记）+ 退出清理。前端工具见 PR-B4-2。
//!
//! 四条设计约定（改动前先回文档）：
//! 1. **不经文件**：请求内容由前端传入，本模块**不读写工作区任何文件**；草稿/历史走前端
//!    `host.storage`（文档 §5.2），响应保存复用既有 `fs_cmds::write_file`，故此处无任何
//!    持久化命令。
//! 2. **取消是协作式的**：`http_cancel` 只置标志，读取循环每块检查一次 → 取消在下个分块
//!    边界生效（文档 §5.7.3 已声明"不保证即时生效"，UI 侧有 `cancelling` 中间态兜底）。
//! 3. **进度事件定向**：`http-op-progress` 走 `emit_to(window.label())`，禁全局 `emit`
//!    （§2 纪律 6）。
//! 4. **执行模型与 `db_cmds` / `git_cmds` 同构**：blocking 客户端 + `spawn_blocking`，
//!    便于在读取循环里做取消检查与进度上报。
//!
//! 命令错误一律 `Result<T, String>`，前缀 `Http*`：`HttpInvalidUrl:` / `HttpTimeout:` /
//! `HttpConnect:` / `HttpCancelled:` …，前端经 `i18n/backendError.ts` 本地化（§5.7.4）。

use std::io::Read;
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::per_window::PerWindow;
use crate::util::unpoison;

// ---------- 常量 ----------

/// 响应体 IPC 截断阈值（5 MB；防把几十 MB 塞进 IPC，文档 §5.3）
const BODY_LIMIT: usize = 5 * 1024 * 1024;
/// 二进制内联上限（图片预览走 base64，超过则只回元信息）
const BINARY_INLINE_LIMIT: usize = 2 * 1024 * 1024;
/// 默认超时（ms；设置项 `http_timeout_ms` 默认 30000）
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// 超时上下限（下限 1s 防误配 0 导致"永不超时"以外的怪异行为；上限 10 min）
const TIMEOUT_MIN_MS: u64 = 1_000;
const TIMEOUT_MAX_MS: u64 = 600_000;
/// 默认/最大重定向次数
const MAX_REDIRECTS: usize = 10;
const REDIRECT_MAX: usize = 20;
/// 分块读取缓冲（同时是进度事件的粒度）
const CHUNK: usize = 8 * 1024;
/// 取消标志轮询分块粒度：每读一块检查一次
const USER_AGENT: &str = "OpenCharm/0.1";

/// 由客户端计算的头：一律剔除，防用户手填导致请求畸形（文档 §5.3 纯函数口径）
const SKIP_HEADERS: [&str; 3] = ["host", "content-length", "transfer-encoding"];

/// 视为文本、可直接进 `body` 的 content-type 前缀
const TEXTUAL_TYPES: [&str; 6] = [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
    "application/graphql",
    "application/x-yaml",
];

/// 允许的方法白名单（大写；小写输入自动上抬）
const METHODS: [&str; 8] = [
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE",
];

// ---------- 数据契约（与前端 devtools/builtin/http.ts 同名 camelCase） ----------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestJson {
    pub method: String,
    pub url: String,
    /// `[name, value]` 对；消毒在 Rust 侧做（前端不可信）
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
    pub follow_redirects: Option<bool>,
    pub max_redirects: Option<usize>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    /// `canonical_reason`（"OK" / "Not Found"）；非标准状态码为空串
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    /// 文本响应体；二进制响应体为空串（见 `body_base64`）
    pub body: String,
    /// 二进制（含图片）且 ≤ `BINARY_INLINE_LIMIT` 时的 base64，供前端预览
    pub body_base64: Option<String>,
    /// 响应体字节数（截断时为截断后的长度）
    pub bytes: usize,
    pub elapsed_ms: u64,
    /// 跟随过程中的目标 URL 序列（未跟随为空）
    pub redirect_chain: Vec<String>,
    /// 响应体被 `BODY_LIMIT` 截断
    pub truncated: bool,
    /// 目标是本机 / 内网地址（不拦截，仅供前端提示，文档 §5.3）
    pub private_target: bool,
    /// 响应体被判定为二进制（前端据此不渲染 JSON 树）
    pub binary: bool,
}

/// 进度事件 `http-op-progress` 的 payload
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct HttpProgress {
    op_id: String,
    received: usize,
    total: Option<u64>,
}

// ---------- 全局表 ----------

/// 在途请求：`窗口 → (op_id → 取消标志)`。
/// 与 `git_cmds::GIT_NET_OPS` 同形：窗口隔离，退出时统一置位并清空。
static HTTP_OPS: LazyLock<PerWindow<std::collections::HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(PerWindow::new);

// ---------- 纯函数（单测目标） ----------

/// scheme 白名单 + host 非空（抄 `git_cmds::validate_clone_url` 的形态）
pub(crate) fn validate_http_url_impl(raw: &str) -> Result<Url, String> {
    let s = raw.trim();
    if s.is_empty() {
        return Err("empty:URL 为空".to_string());
    }
    let u = Url::parse(s).map_err(|e| format!("invalid:{e}"))?;
    match u.scheme() {
        "http" | "https" => {}
        other => return Err(format!("scheme:不支持 {other}（仅 http/https）")),
    }
    if u.host_str().unwrap_or("").is_empty() {
        return Err("host:缺少主机名".to_string());
    }
    Ok(u)
}

/// 本机 / 内网目标判定（**不拦截**，只提示；自用工具调 localhost 是常态）
fn is_private_target_impl(host: &str) -> bool {
    let h = host.trim().trim_end_matches('.');
    if h.is_empty() {
        return false;
    }
    if h.eq_ignore_ascii_case("localhost") || h == "::1" || h == "[::1]" {
        return true;
    }
    if h.eq_ignore_ascii_case("localhost.localdomain")
        || h.len() > 7 && h.to_ascii_lowercase().ends_with(".localhost")
    {
        return true;
    }
    if h.to_ascii_lowercase().ends_with(".local") {
        return true;
    }
    match h.parse::<Ipv4Addr>() {
        Ok(ip) => {
            let o = ip.octets();
            o[0] == 127
                || o[0] == 10
                || (o[0] == 172 && (16..=31).contains(&o[1]))
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 169 && o[1] == 254)
        }
        Err(_) => false,
    }
}

/// 头名消毒：`Err` = 注入风险（直接拒绝整次请求）；`Ok(None)` = 应剔除（交由客户端计算）
fn sanitize_header_name_impl(raw: &str) -> Result<Option<String>, String> {
    let n = raw.trim();
    if n.is_empty() {
        return Ok(None);
    }
    if n.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0) {
        return Err(format!("injection:头名含控制字符（{:?}）", n));
    }
    if n.chars().any(|c| c.is_control()) {
        return Err(format!("control:头名含控制字符（{:?}）", n));
    }
    let lower = n.to_ascii_lowercase();
    if SKIP_HEADERS.contains(&lower.as_str()) {
        return Ok(None);
    }
    Ok(Some(n.to_string()))
}

/// 头值消毒：禁止 CRLF（防响应拆分 / 头注入）
fn sanitize_header_value_impl(raw: &str) -> Result<String, String> {
    if raw.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0) {
        return Err("injection:头值含控制字符".to_string());
    }
    Ok(raw.to_string())
}

/// 响应体截断 + 宽松 UTF-8 转换（二进制内容由 `is_binary_content_type_impl` 另行判定）
pub(crate) fn truncate_body_impl(bytes: &[u8], limit: usize) -> (String, bool) {
    let truncated = bytes.len() > limit;
    let slice = if truncated { &bytes[..limit] } else { bytes };
    (String::from_utf8_lossy(slice).into_owned(), truncated)
}

/// content-type 是否按二进制处理（文本类与已知文本型 application/* 例外）
fn is_binary_content_type_impl(ct: &str) -> bool {
    let base = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if base.is_empty() || base.starts_with("text/") {
        return false;
    }
    if TEXTUAL_TYPES.iter().any(|p| base.starts_with(p)) {
        return false;
    }
    true
}

/// 方法白名单（小写输入上抬）
fn parse_method_impl(raw: &str) -> Result<String, String> {
    let m = raw.trim().to_ascii_uppercase();
    if METHODS.contains(&m.as_str()) {
        Ok(m)
    } else {
        Err(format!("HttpMethod:不支持的请求方法 {}", raw.trim()))
    }
}

/// 超时钳制（防 0 / 超大值）
pub(crate) fn clamp_timeout_ms(raw: Option<u64>) -> u64 {
    raw.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)
}

/// reqwest 错误 → 带前缀的可本地化错误（超时/连接/请求/解码四类，文档 §5.7.4）。
/// `timeout_ms` 传本次实际生效的超时（钳制后），避免文案里写死默认值误导用户。
pub(crate) fn classify_reqwest_error(e: &reqwest::Error, timeout_ms: u64) -> String {
    if e.is_timeout() {
        format!("HttpTimeout:请求超时（{}ms 内未完成）", timeout_ms)
    } else if e.is_connect() {
        format!("HttpConnect:无法连接目标主机（{e}）")
    } else if e.is_decode() || e.is_body() {
        format!("HttpDecode:响应解码失败（{e}）")
    } else if e.is_request() {
        format!("HttpRequest:{e}")
    } else {
        format!("HttpNetwork:{e}")
    }
}

// ---------- 执行 ----------

/// 单次发送的参数（已校验，移入 blocking 线程）
struct SendSpec {
    url: Url,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    timeout_ms: u64,
    follow: bool,
    max_redirects: usize,
    private_target: bool,
}

/// 发送一次请求（blocking 线程内执行；每读一块检查取消 + 上报进度）
fn http_send_blocking(
    app: &AppHandle,
    wid: &str,
    op_id: &str,
    spec: SendSpec,
    cancel: Arc<AtomicBool>,
) -> Result<HttpResponse, String> {
    if cancel.load(Ordering::SeqCst) {
        return Err("HttpCancelled:已取消".to_string());
    }

    // 重定向链：自定义 policy 顺带记录每次跳转的目标（blocking 客户端自动跟随，否则拿不到链）
    let chain: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let max_redirects = spec.max_redirects;
    let mut builder = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_millis(spec.timeout_ms));
    if spec.follow {
        let chain2 = chain.clone();
        builder = builder.redirect(reqwest::redirect::Policy::custom(move |attempt| {
            let mut c = unpoison(chain2.lock());
            if c.len() >= max_redirects {
                attempt.stop()
            } else {
                c.push(attempt.url().to_string());
                attempt.follow()
            }
        }));
    } else {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    let client = builder.build().map_err(|e| format!("HttpBuild:{e}"))?;

    let method = reqwest::Method::from_bytes(spec.method.as_bytes())
        .map_err(|_| format!("HttpMethod:不支持的请求方法 {}", spec.method))?;
    let mut rb = client.request(method, spec.url.clone());
    for (k, v) in &spec.headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(b) = &spec.body {
        if !b.is_empty() {
            rb = rb.body(b.clone());
        }
    }

    let started = Instant::now();
    let mut resp = rb
        .send()
        .map_err(|e| classify_reqwest_error(&e, spec.timeout_ms))?;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let headers: Vec<(String, String)> = resp
        .headers()
        .iter()
        .map(|(n, v)| {
            (
                n.as_str().to_string(),
                v.to_str().unwrap_or("<binary>").to_string(),
            )
        })
        .collect();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let binary = is_binary_content_type_impl(&content_type);
    let total = resp.content_length();

    // 分块读取：每块检查取消并上报进度；读满 BODY_LIMIT 即停（置 truncated）
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; CHUNK];
    // `stopped_early` = 因达到 BODY_LIMIT 而提前停止（真正的截断标志）。
    // 注意：不能靠 `buf.len() > limit` 判定——读满时正好 == limit，长度判据会漏报。
    let mut stopped_early = false;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("HttpCancelled:已取消".to_string());
        }
        let n = resp.read(&mut chunk).map_err(|e| format!("HttpRead:{e}"))?;
        if n == 0 {
            break;
        }
        let remaining = BODY_LIMIT.saturating_sub(buf.len());
        if remaining == 0 {
            stopped_early = true;
            break;
        }
        let take = n.min(remaining);
        buf.extend_from_slice(&chunk[..take]);
        emit_progress(app, wid, op_id, buf.len(), total);
        if take < n {
            stopped_early = true;
            break;
        }
    }
    if cancel.load(Ordering::SeqCst) {
        return Err("HttpCancelled:已取消".to_string());
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let (text, _) = truncate_body_impl(&buf, BODY_LIMIT);
    let truncated = stopped_early;
    let body_base64 = if binary && buf.len() <= BINARY_INLINE_LIMIT {
        Some(base64_encode(&buf))
    } else {
        None
    };
    // 先取出再构造：MutexGuard 临时值不得活到 struct 字面量结束（E0597）
    let redirect_chain = unpoison(chain.lock()).clone();

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body: if binary { String::new() } else { text },
        body_base64,
        bytes: buf.len(),
        elapsed_ms,
        redirect_chain,
        truncated,
        private_target: spec.private_target,
        binary,
    })
}

fn emit_progress(app: &AppHandle, wid: &str, op_id: &str, received: usize, total: Option<u64>) {
    let _ = app.emit_to(
        wid,
        "http-op-progress",
        HttpProgress {
            op_id: op_id.to_string(),
            received,
            total,
        },
    );
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

// ---------- 命令 ----------

/// 发送一次 HTTP 请求（前端经 facade 的 `net` 门控调用，不直接 invoke）
#[tauri::command]
pub async fn http_send(
    app: AppHandle,
    window: tauri::WebviewWindow,
    req: HttpRequestJson,
    op_id: String,
) -> Result<HttpResponse, String> {
    let wid = window.label().to_string();

    // 同步校验（快速失败，不进 blocking 线程）
    let url = validate_http_url_impl(&req.url).map_err(|d| format!("HttpInvalidUrl:{d}"))?;
    let private_target = is_private_target_impl(url.host_str().unwrap_or(""));
    let method = parse_method_impl(&req.method)?;
    let mut headers: Vec<(String, String)> = Vec::new();
    for (k, v) in &req.headers {
        // 纯函数返回裸串，命令层统一加 `HttpHeader:` 前缀（前端 localizeBackendError 靠前缀分派）
        let name = sanitize_header_name_impl(k).map_err(|d| format!("HttpHeader:{d}"))?;
        if let Some(name) = name {
            let value = sanitize_header_value_impl(v).map_err(|d| format!("HttpHeader:{d}"))?;
            headers.push((name, value));
        }
    }

    let spec = SendSpec {
        url,
        method,
        headers,
        body: req.body.clone(),
        timeout_ms: clamp_timeout_ms(req.timeout_ms),
        follow: req.follow_redirects.unwrap_or(true),
        max_redirects: req.max_redirects.unwrap_or(MAX_REDIRECTS).min(REDIRECT_MAX),
        private_target,
    };

    let cancel = Arc::new(AtomicBool::new(false));
    // `PerWindow::lock()` 内部已 unpoison（per_window.rs:31），此处不再包一层
    HTTP_OPS
        .lock()
        .entry(wid.clone())
        .or_default()
        .insert(op_id.clone(), cancel.clone());

    let app2 = app.clone();
    let wid2 = wid.clone();
    let op2 = op_id.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        http_send_blocking(&app2, &wid2, &op2, spec, cancel)
    })
    .await
    .map_err(|e| format!("HttpTaskError:{e}"))?;

    // 无论成败都摘除 op（防表膨胀；取消标志随 op 一起消失）
    if let Some(m) = HTTP_OPS.lock().get_mut(&wid) {
        m.remove(&op_id);
    }
    res
}

/// 取消在途请求（协作式：只置标志，读取循环下个分块边界生效）
#[tauri::command]
pub fn http_cancel(op_id: String) {
    for m in HTTP_OPS.lock().values_mut() {
        if let Some(c) = m.get(&op_id) {
            c.store(true, Ordering::SeqCst);
        }
    }
}

// ---------- 退出清理 ----------

/// 应用退出时置位全部取消标志并清空（照 `db_cmds::db_stop_for_exit` 先例，
/// 由 `lib.rs` 的 `RunEvent::Exit` 调用）
pub fn http_stop_for_exit() {
    let mut ops = HTTP_OPS.lock();
    let n: usize = ops.values().map(|m| m.len()).sum();
    for m in ops.values_mut() {
        for c in m.values() {
            c.store(true, Ordering::SeqCst);
        }
    }
    ops.clear();
    if n > 0 {
        crate::logging::log_line(
            crate::logging::Level::Info,
            &format!("[exit] 取消 {} 个在途 HTTP 请求", n),
        );
    }
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_accepts_http_and_https() {
        assert!(validate_http_url_impl("https://api.example.com/v1/users?page=2").is_ok());
        assert!(validate_http_url_impl("http://localhost:8000/health").is_ok());
        // 前后空白由 trim 兜住（前端输入框常见尾部空格）
        assert!(validate_http_url_impl("  http://127.0.0.1:8080/  ").is_ok());
    }

    #[test]
    fn url_rejects_bad_scheme_and_empty() {
        for bad in [
            "ftp://example.com/x",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "example.com/x",
            "",
            "   ",
            "https://",
        ] {
            let err = validate_http_url_impl(bad);
            assert!(err.is_err(), "应拒绝：{bad}");
        }
    }

    #[test]
    fn url_rejects_missing_host() {
        // 无主机一律拒绝。注意 `https:///path` 会被 url crate 解析成 host="path"
        // （第三个斜杠后的段被当作域名），故只以真正的空主机样本为准；
        // `host:` 分支是防御性的（url crate 对 http/https 通常已保证 host 存在）。
        for bad in ["https://", "http://", "https:///"] {
            let e = validate_http_url_impl(bad).unwrap_err();
            assert!(
                e.starts_with("invalid:") || e.starts_with("host:"),
                "应拒绝（{bad}），实际：{e}"
            );
        }
    }

    #[test]
    fn private_target_detection() {
        for host in [
            "localhost",
            "LOCALHOST",
            "127.0.0.1",
            "10.2.3.4",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.1.1",
            "::1",
            "foo.local",
            "my.host.localhost",
        ] {
            assert!(is_private_target_impl(host), "应判为私网：{host}");
        }
        for host in ["example.com", "93.184.216.34", "8.8.8.8", "172.32.0.1", ""] {
            assert!(!is_private_target_impl(host), "应判为公网：{host}");
        }
    }

    #[test]
    fn header_name_blocks_injection() {
        for bad in ["X-Token\r\nX-Evil: 1", "X-Token\nx", "X\0Y", "X\u{7}Y"] {
            let e = sanitize_header_name_impl(bad).unwrap_err();
            assert!(e.starts_with("injection:") || e.starts_with("control:"), "实际：{e}");
        }
    }

    #[test]
    fn header_name_drops_client_computed() {
        // 由客户端计算的头一律剔除（防手填导致请求畸形）
        for skip in ["Host", "host", "Content-Length", "Transfer-Encoding"] {
            assert_eq!(sanitize_header_name_impl(skip).unwrap(), None, "应剔除：{skip}");
        }
        assert_eq!(
            sanitize_header_name_impl(" X-Token ").unwrap(),
            Some("X-Token".to_string())
        );
        assert_eq!(sanitize_header_name_impl("").unwrap(), None);
    }

    #[test]
    fn header_value_blocks_crlf() {
        assert!(sanitize_header_value_impl("a\r\nSet-Cookie: x").is_err());
        assert!(sanitize_header_value_impl("a\nb").is_err());
        assert_eq!(sanitize_header_value_impl("Bearer abc").unwrap(), "Bearer abc");
    }

    #[test]
    fn body_truncation_and_lossy_utf8() {
        let small = b"hello".to_vec();
        assert_eq!(truncate_body_impl(&small, 100), ("hello".to_string(), false));

        let big = vec![b'a'; 100];
        let (s, truncated) = truncate_body_impl(&big, 10);
        assert!(truncated);
        assert_eq!(s.len(), 10);

        // 非法 UTF-8 → lossy 替换，绝不 panic（前端拿不到二进制也该有可读文本）
        let bad = vec![0xff, 0xfe, 0x41];
        let (s, _) = truncate_body_impl(&bad, 100);
        assert!(s.contains('A'));
    }

    #[test]
    fn binary_content_type_classification() {
        assert!(is_binary_content_type_impl("image/png"));
        assert!(is_binary_content_type_impl("application/octet-stream"));
        assert!(is_binary_content_type_impl("application/pdf"));
        assert!(is_binary_content_type_impl("font/woff2"));
        assert!(!is_binary_content_type_impl("text/html; charset=utf-8"));
        assert!(!is_binary_content_type_impl("application/json; charset=utf-8"));
        assert!(!is_binary_content_type_impl("application/xml"));
        assert!(!is_binary_content_type_impl(""));
    }

    #[test]
    fn method_whitelist() {
        assert_eq!(parse_method_impl("get").unwrap(), "GET");
        assert_eq!(parse_method_impl(" POST ").unwrap(), "POST");
        assert_eq!(parse_method_impl("DELETE").unwrap(), "DELETE");
        assert!(parse_method_impl("FOO").unwrap_err().starts_with("HttpMethod:"));
        assert!(parse_method_impl("").is_err());
        // 防注入：方法字段不允许塞进整行
        assert!(parse_method_impl("GET / HTTP/1.1").is_err());
    }

    #[test]
    fn timeout_clamped() {
        assert_eq!(clamp_timeout_ms(None), DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout_ms(Some(0)), TIMEOUT_MIN_MS);
        assert_eq!(clamp_timeout_ms(Some(10_000_000)), TIMEOUT_MAX_MS);
        assert_eq!(clamp_timeout_ms(Some(5_000)), 5_000);
    }
}
