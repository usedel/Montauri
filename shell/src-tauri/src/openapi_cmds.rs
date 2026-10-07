//! A5④：OpenAPI 面板内预览。
//!
//! `docs/improvement_and_roadmap_report.md` §3「A 类 · 深化差异化」A5 的子项④。
//! 拉取运行中服务的 `/openapi.json`，把 `paths` 扁平化为方法 + 路径 + operationId +
//! summary + tags 的列表（前端 `openApiPanel.ts` 渲染 + 匹配 `scan_endpoints` 结果跳源码）。
//!
//! 纪律与 `ep_sample_cmds` 一致：
//! - **只读拉取式**：命令被显式 invoke 时才发请求，不在启动路径做 IO；
//! - **纯函数可测**：`parse_openapi_impl` 离线单测，不依赖网络；
//! - 错误一律 `Result<T, String>`，前缀 `HttpStatus:` / `HttpParse:` / 复用 `http_cmds`
//!   的 `Http*` 家族，前端经 `i18n/backendError.ts` 本地化。
//!
//! 已知边界（识别不到就明说，绝不臆测）：
//! - **WS 不在此列**：OpenAPI 规范只描述 HTTP 操作，WebSocket 端点天然不在 `/openapi.json`；
//! - `paths` 下非对象条目（`$ref` 等）与 `x-` 扩展键一律跳过；
//! - 响应体上限 2 MB（openapi.json 通常几十 KB，防失控服务撑爆 IPC）。

use std::io::Read;
use std::time::Duration;

use serde::Serialize;

use crate::http_cmds::{classify_reqwest_error, clamp_timeout_ms, truncate_body_impl, validate_http_url_impl};

/// 拉取路径（FastAPI 自带，F4 同款）
const OPENAPI_PATH: &str = "/openapi.json";
/// 响应体上限（2 MB；超出即截断——openapi.json 超限基本可断定是异常服务）
const OPENAPI_BODY_LIMIT: usize = 2 * 1024 * 1024;
/// 拉取超时（10s；面板内预览不等太久）
const OPENAPI_TIMEOUT_MS: u64 = 10_000;
/// 读块大小
const CHUNK: usize = 8 * 1024;
/// OpenAPI operation key 白名单（小写）；`x-` 扩展与 `parameters` / `servers` 等结构键被排除
const HTTP_METHODS: [&str; 8] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"];

// ---------- 出口结构（前端 `openApiPanel.ts` 的 TS 类型与之逐字对应） ----------

#[derive(Serialize, Debug, PartialEq)]
pub struct OpenApiOp {
    /// 大写 HTTP 方法（GET / POST / …）
    pub method: String,
    /// 路径（如 "/users/{uid}"；OpenAPI 与 FastAPI 路由同形）
    pub path: String,
    /// operationId（可为空串；FastAPI 默认不给，端点为空正常）
    pub operation_id: String,
    /// summary 摘要（可为空串）
    pub summary: String,
    pub tags: Vec<String>,
    pub deprecated: bool,
}

// ---------- 纯函数（单测目标） ----------

/// 解析 OpenAPI JSON 文本 → 扁平操作列表。
///
/// 容错口径：`paths` 缺失 / 为空 → `Ok(vec![])`；路径条目不是对象 → 跳过；
/// operation key 不在白名单（`x-*` / `parameters` / `servers`）→ 跳过；
/// operation 值不是对象 → 跳过。**整个 JSON 解析失败才 `Err`**（前端按 HttpParse 渲染）。
fn parse_openapi_impl(text: &str) -> Result<Vec<OpenApiOp>, String> {
    let root: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("invalid:{e}"))?;
    let Some(paths) = root.get("paths").and_then(|v| v.as_object()) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<OpenApiOp> = Vec::new();
    for (path, ops) in paths {
        let Some(ops_obj) = ops.as_object() else { continue };
        for (m, spec) in ops_obj {
            let method = m.to_ascii_uppercase();
            if !HTTP_METHODS.contains(&method.as_str()) {
                continue;
            }
            let Some(spec_obj) = spec.as_object() else { continue };
            let get_str = |k: &str| -> String {
                spec_obj
                    .get(k)
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            };
            out.push(OpenApiOp {
                method,
                path: path.clone(),
                operation_id: get_str("operationId"),
                summary: get_str("summary"),
                tags: spec_obj
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|t| t.as_str().map(String::from)).collect())
                    .unwrap_or_default(),
                deprecated: spec_obj
                    .get("deprecated")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
            });
        }
    }
    Ok(out)
}

// ---------- 命令 ----------

/// 拉取并解析运行中服务的 OpenAPI 规范（A5④）。`base_url` 由前端
/// `lastServiceBaseUrl()` 提供（无 base 时前端不调用本命令，直接提示先运行）。
#[tauri::command]
pub async fn fetch_openapi(base_url: String) -> Result<Vec<OpenApiOp>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_openapi_impl(&base_url))
        .await
        .map_err(|e| format!("HttpTaskError:{e}"))?
}

fn fetch_openapi_impl(base_url: &str) -> Result<Vec<OpenApiOp>, String> {
    let base = base_url.trim();
    if base.is_empty() {
        return Err("HttpInvalidUrl:empty:URL 为空".to_string());
    }
    let url_text = if base.ends_with('/') {
        format!("{base}openapi.json")
    } else {
        format!("{base}{OPENAPI_PATH}")
    };
    let url = validate_http_url_impl(&url_text).map_err(|d| format!("HttpInvalidUrl:{d}"))?;
    let timeout = clamp_timeout_ms(Some(OPENAPI_TIMEOUT_MS));

    let client = reqwest::blocking::Client::builder()
        .user_agent("OpenCharm/0.1")
        .timeout(Duration::from_millis(timeout))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HttpBuild:{e}"))?;
    let mut resp = client
        .get(url)
        .send()
        .map_err(|e| classify_reqwest_error(&e, timeout))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HttpStatus:{}", status.as_u16()));
    }

    // 分块读取 + 2 MB 截断（防失控服务撑爆 IPC；同 http_send 的读取循环范式）
    let mut body: Vec<u8> = Vec::new();
    let mut chunk = [0u8; CHUNK];
    loop {
        let n = resp.read(&mut chunk).map_err(|e| format!("HttpRead:{e}"))?;
        if n == 0 {
            break;
        }
        let remaining = OPENAPI_BODY_LIMIT.saturating_sub(body.len());
        if remaining == 0 {
            break;
        }
        let take = n.min(remaining);
        body.extend_from_slice(&chunk[..take]);
        if take < n {
            break;
        }
    }
    let (text, _) = truncate_body_impl(&body, OPENAPI_BODY_LIMIT);
    parse_openapi_impl(&text).map_err(|d| format!("HttpParse:{d}"))
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_multi_method_and_metadata() {
        let doc = r#"{
          "openapi": "3.1.0",
          "paths": {
            "/users/{uid}": {
              "get": {
                "operationId": "get_user",
                "summary": "获取用户",
                "tags": ["users"],
                "deprecated": false
              },
              "post": {
                "summary": "创建用户"
              }
            },
            "/health": {
              "get": {}
            }
          }
        }"#;
        let ops = parse_openapi_impl(doc).unwrap();
        assert_eq!(ops.len(), 3);
        // 遍历顺序是序列化实现的细节（BTreeMap 字典序 / preserve_order 插入序）——
        // 断言按 (method, path) 显式查找，不依赖顺序。
        let find_op = |method: &str, path: &str| {
            ops.iter()
                .find(|o| o.method == method && o.path == path)
                .expect("op")
        };
        let health = find_op("GET", "/health");
        assert_eq!(health.operation_id, "");
        let get = find_op("GET", "/users/{uid}");
        assert_eq!(get.operation_id, "get_user");
        assert_eq!(get.summary, "获取用户");
        assert_eq!(get.tags, vec!["users"]);
        assert!(!get.deprecated);
        // 无 operationId 的 post：空串，不报错
        let post = find_op("POST", "/users/{uid}");
        assert_eq!(post.operation_id, "");
        assert_eq!(post.method, "POST");
    }

    #[test]
    fn parse_missing_or_empty_paths() {
        // 无 paths 字段 → 空列表（不是错误）
        assert_eq!(parse_openapi_impl(r#"{"openapi":"3.1.0"}"#).unwrap(), vec![]);
        // paths 为空对象 → 空列表
        assert_eq!(parse_openapi_impl(r#"{"paths":{}}"#).unwrap(), vec![]);
    }

    #[test]
    fn parse_rejects_bad_json() {
        assert!(parse_openapi_impl("not json {").unwrap_err().starts_with("invalid:"));
        assert!(parse_openapi_impl("").is_err());
    }

    #[test]
    fn parse_skips_non_object_and_extensions() {
        let doc = r#"{
          "paths": {
            "/a": null,
            "/b": {
              "x-custom": {"irrelevant": true},
              "parameters": [],
              "get": {}
            }
          }
        }"#;
        let ops = parse_openapi_impl(doc).unwrap();
        // /a 非对象跳过；x-custom / parameters 不是 HTTP 方法跳过；只留 /b GET
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].path, "/b");
        assert_eq!(ops[0].method, "GET");
    }

    #[test]
    fn parse_deprecated_flag() {
        let doc = r#"{"paths":{"/old":{"delete":{"deprecated":true}}}}"#;
        let ops = parse_openapi_impl(doc).unwrap();
        assert!(ops[0].deprecated);
        assert_eq!(ops[0].method, "DELETE");
    }

    #[test]
    fn parse_ignores_webhook_and_tags_not_array() {
        let doc = r#"{
          "paths": {
            "/x": {
              "get": {"tags": "not-array"}
            }
          }
        }"#;
        let ops = parse_openapi_impl(doc).unwrap();
        // tags 非数组 → 空 Vec（不 panic）
        assert_eq!(ops[0].tags, Vec::<String>::new());
    }

    #[test]
    fn url_join_and_validate() {
        // 拼 URL 口径：带 / 与不带 / 的 base 都拼出 {base}/openapi.json
        let cases = [
            ("http://127.0.0.1:8000", "http://127.0.0.1:8000/openapi.json"),
            ("http://127.0.0.1:8000/", "http://127.0.0.1:8000/openapi.json"),
        ];
        for (base, want) in cases {
            let url_text = if base.ends_with('/') {
                format!("{base}openapi.json")
            } else {
                format!("{base}{OPENAPI_PATH}")
            };
            let url = validate_http_url_impl(&url_text).unwrap();
            assert_eq!(url.as_str(), want);
        }
        // 空 base → 拒绝
        assert!(validate_http_url_impl(&format!("{}{OPENAPI_PATH}", "")).is_err());
    }
}
