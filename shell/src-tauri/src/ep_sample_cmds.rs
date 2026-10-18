//! A5：端点请求样例（静态推断，离线可用）。
//!
//! `docs/improvement_and_roadmap_report.md` §3「A 类 · 深化差异化」A5 的子项①。
//! `fs_cmds::scan_endpoints` 只回答「**有哪些**端点」，本模块回答「**这个端点怎么调**」：
//! 解析 handler 签名把参数分成 path / query / header / cookie / body，再用工作区的
//! Pydantic 模型索引展开请求体字段，产出可直接复制粘贴的 JSON 样例。
//!
//! 纪律与 `scan_endpoints` 完全一致：纯文本逐行解析、零子进程、零正则依赖、
//! 拉取式（前端显式 invoke，不在启动路径做 IO）、**只读**（不写任何文件）。
//!
//! 已知边界（一律「识别不到就明说」，绝不臆测）：
//! - **Flask**：查询参数与请求体来自 `request.args` / `request.json`，签名里看不到 →
//!   只产出 path 参数，其余参数标 `skip` + note，并由 `notes` 给出框架级说明；
//! - **跨文件继承**的 Pydantic 模型按单文件口径（沿用 `pyd_collect_models` 的既有边界）；
//! - 依赖注入（`= Depends(...)` / `= Security(...)`）与框架对象（`Request` / `Response` …）跳过；
//! - 未识别的类型标注产出 `null`，**不猜值**。
//!
//! 「识别不到」不走 `Err`：文件读不到 / def 行对不上都返回 `Ok` + `notes` 里的码，
//! 由前端按语言包渲染（后端错误文案另有 `backendError.ts` 那条漂移锁管线，不掺进来）。

use serde::Serialize;
use std::path::Path;

use crate::pydantic_cmds::{pyd_collect_models, PydModel};
use crate::search_cmds::read_text_file;

/// 签名跨行拼接上限（防御：括号不闭合的异常代码不无限读）
const MAX_SIG_LINES: usize = 40;
/// 嵌套模型展开深度上限
const MAX_BODY_DEPTH: usize = 3;
/// 参数条目上限
const MAX_PARAMS: usize = 64;
/// 请求体字段上限
const MAX_FIELDS: usize = 200;

// ---------- 出口结构（前端 `epSample.ts` 的 TS 类型与之逐字对应） ----------

#[derive(Serialize)]
pub struct SampleParam {
    /// "path" | "query" | "header" | "cookie" | "body" | "skip"
    pub kind: String,
    pub name: String,
    /// 注解原文（未剥壳；前端直接展示）
    pub type_text: String,
    pub required: bool,
    /// 默认值原文（无默认值为 None）
    pub default: Option<String>,
    /// 裸文本样例值（query / path 用；不含引号）
    pub value_text: String,
    /// 跳过原因码（kind == "skip" 时非空）：dependency / varargs / framework_object /
    /// websocket / flask_scope
    pub note: Option<String>,
}

#[derive(Serialize)]
pub struct SampleField {
    /// 输出键名（有 `Field(alias=...)` 时为别名）
    pub name: String,
    pub type_text: String,
    pub required: bool,
    /// JSON 字面量文本（紧凑）
    pub value: String,
}

#[derive(Serialize)]
pub struct EndpointSample {
    pub handler: String,
    pub params: Vec<SampleParam>,
    /// 请求体模型名（识别到 Pydantic 模型时）
    pub body_model: Option<String>,
    pub body_fields: Vec<SampleField>,
    /// 美化 JSON 请求体样例（无请求体时为 None）
    pub body_json: Option<String>,
    /// 框架级说明码（前端映射为 `endpoints.sampleNote.<码>`）：
    /// def_not_found / flask_scope / websocket / body_model_unknown / unknown_type
    pub notes: Vec<String>,
}

// ---------- 样例值树（手写渲染） ----------
//
// 为什么不用 serde_json：它默认按 key 字典序输出（`preserve_order` 未开），会把字段
// 声明顺序打乱——样例的价值一半在「顺序与模型声明一致」，故手写一棵极小的树。

enum JVal {
    Num(String),
    Str(String),
    Bool(bool),
    Null,
    Arr(Vec<JVal>),
    Obj(Vec<(String, JVal)>),
}

fn j_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o
}

/// 渲染为 JSON 文本；`pretty` 决定缩进多行还是单行紧凑
fn j_render(v: &JVal, indent: usize, pretty: bool) -> String {
    let nest = |items: Vec<String>, open: char, close: char| -> String {
        if !pretty {
            return format!("{open}{}{close}", items.join(", "));
        }
        let pad = "  ".repeat(indent);
        let inner = "  ".repeat(indent + 1);
        let body: Vec<String> = items.into_iter().map(|s| format!("{inner}{s}")).collect();
        format!("{open}\n{}\n{pad}{close}", body.join(",\n"))
    };
    match v {
        JVal::Num(n) => n.clone(),
        JVal::Str(s) => format!("\"{}\"", j_escape(s)),
        JVal::Bool(b) => b.to_string(),
        JVal::Null => "null".to_string(),
        JVal::Arr(a) => {
            if a.is_empty() {
                return "[]".to_string();
            }
            nest(a.iter().map(|x| j_render(x, indent + 1, pretty)).collect(), '[', ']')
        }
        JVal::Obj(o) => {
            if o.is_empty() {
                return "{}".to_string();
            }
            nest(
                o.iter()
                    .map(|(k, x)| format!("\"{}\": {}", j_escape(k), j_render(x, indent + 1, pretty)))
                    .collect(),
                '{',
                '}',
            )
        }
    }
}

/// 参数表用的裸文本值：剥掉字符串外层引号（query / path 里写的就是裸值）
fn plain(v: &JVal) -> String {
    let s = j_render(v, 0, false);
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        s[1..s.len() - 1].to_string()
    } else {
        s
    }
}

// ---------- 文本工具（括号 / 引号感知的顶层切分） ----------

/// 是否为合法 Python 标识符
fn is_ident(s: &str) -> bool {
    let mut ch = s.chars();
    match ch.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    ch.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 剥行内注释：首个**引号外** `#` 起截断（签名里 `#` 只会出现在字符串中）
fn strip_comment(line: &str) -> &str {
    let b = line.as_bytes();
    let mut quote: Option<u8> = None;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        match quote {
            Some(q) => {
                if c == b'\\' {
                    i += 2;
                    continue;
                }
                if c == q {
                    quote = None;
                }
            }
            None => {
                if c == b'"' || c == b'\'' {
                    quote = Some(c);
                } else if c == b'#' {
                    return &line[..i];
                }
            }
        }
        i += 1;
    }
    line
}

/// `s[open_idx]` 处左括号的配对右括号下标（括号与字符串双感知）
fn matching_bracket(s: &str, open_idx: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut stack: Vec<u8> = Vec::new();
    let mut quote: Option<u8> = None;
    let mut i = open_idx;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' | b'\'' => quote = Some(c),
            b'(' | b'[' | b'{' => stack.push(c),
            b')' | b']' | b'}' => {
                stack.pop()?;
                if stack.is_empty() {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// 顶层分隔符位置（跳过括号与字符串内部）；`sep` 不得是括号本身
fn find_top_level(s: &str, sep: char) -> Option<usize> {
    let b = s.as_bytes();
    let sepb = sep as u8;
    let mut depth = 0i32;
    let mut quote: Option<u8> = None;
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' | b'\'' => quote = Some(c),
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth -= 1,
            _ if depth == 0 && c == sepb => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

/// 按顶层分隔符切分（保留空段，由调用方过滤）
fn split_top_level(s: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = s;
    loop {
        match find_top_level(rest, sep) {
            Some(i) => {
                out.push(rest[..i].to_string());
                rest = &rest[i + sep.len_utf8()..];
            }
            None => {
                out.push(rest.to_string());
                break;
            }
        }
    }
    out
}

// ---------- 类型文本 ----------

/// `Name[inner]` → inner 的**第一个顶层实参**（`Annotated[X, Field(...)]` 取 `X`）；不匹配返回 None
fn strip_wrapper(s: &str, name: &str) -> Option<String> {
    let rest = s.strip_prefix(name)?.trim_start();
    if !rest.starts_with('[') {
        return None;
    }
    let close = matching_bracket(rest, 0)?;
    let inner = &rest[1..close];
    Some(
        split_top_level(inner, ',')
            .into_iter()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string(),
    )
}

/// 类型文本归一：剥 `Optional[...]` / `Annotated[X, ...]` 外壳、去 `X | None` 联合。
/// 循环到不动点（`Optional[Annotated[str, ...]]` 这类嵌套只剥一层是不够的）。
fn type_core(t: &str) -> String {
    let mut s = t.trim().to_string();
    for _ in 0..8 {
        if let Some(inner) = strip_wrapper(&s, "Optional") {
            s = inner;
            continue;
        }
        if let Some(inner) = strip_wrapper(&s, "Annotated") {
            s = inner;
            continue;
        }
        let parts: Vec<String> = split_top_level(&s, '|')
            .into_iter()
            .map(|p| p.trim().to_string())
            .filter(|p| p != "None")
            .collect();
        if parts.len() == 1 {
            let only = parts.into_iter().next().unwrap_or_default();
            if only != s {
                s = only;
                continue;
            }
        }
        break;
    }
    s
}

/// 泛型外层名（无下标即自身）：`list[User]` → `list`
fn generic_head(core: &str) -> String {
    match core.find('[') {
        Some(i) => core[..i].trim().to_string(),
        None => core.trim().to_string(),
    }
}

/// 类型尾段名（去掉模块限定前缀）：`app.models.User` → `User`；`list[User]` → `list`
fn type_tail(t: &str) -> String {
    let head = generic_head(&type_core(t));
    head.rsplit('.').next().unwrap_or("").trim().to_string()
}

// ---------- 样例值生成 ----------

/// 由类型标注推出一个「占位但形状正确」的样例值。识别不到一律 `null`（不猜）。
fn sample_val(ty: &str, models: &[PydModel], depth: usize, seen: &mut Vec<String>) -> JVal {
    let core = type_core(ty);
    let head = generic_head(&core);
    let tail = head.rsplit('.').next().unwrap_or("").trim().to_string();
    match tail.to_ascii_lowercase().as_str() {
        "int" => JVal::Num("0".into()),
        "float" => JVal::Num("0.0".into()),
        "str" => JVal::Str("string".into()),
        "bool" => JVal::Bool(true),
        "bytes" => JVal::Str(String::new()),
        "datetime" | "date" | "time" => JVal::Str("2026-01-01T00:00:00".into()),
        "uuid" => JVal::Str("00000000-0000-0000-0000-000000000000".into()),
        "decimal" => JVal::Num("0".into()),
        "list" | "sequence" | "iterable" | "set" | "frozenset" | "tuple" => JVal::Arr(vec![]),
        "dict" | "mapping" => JVal::Obj(vec![]),
        "any" | "object" | "none" | "nonetype" => JVal::Null,
        _ => {
            // 模型名 → 递归展开（深度 + 环保护；模型名大小写敏感）
            if depth < MAX_BODY_DEPTH && !seen.iter().any(|s| s == &tail) {
                if let Some(m) = models.iter().find(|m| m.name == tail) {
                    seen.push(tail.clone());
                    let entries = model_entries(m, models, depth + 1, seen);
                    seen.pop();
                    return JVal::Obj(entries);
                }
            }
            JVal::Null
        }
    }
}

/// 模型字段 → (输出键名, 样例值)；有 `Field(alias=...)` 时键名用别名
fn model_entries(m: &PydModel, models: &[PydModel], depth: usize, seen: &mut Vec<String>) -> Vec<(String, JVal)> {
    let mut out: Vec<(String, JVal)> = Vec::new();
    for f in m.fields.iter().take(MAX_FIELDS) {
        let key = f.alias.clone().unwrap_or_else(|| f.name.clone());
        let ty = f.type_text.clone().unwrap_or_default();
        out.push((key, sample_val(&ty, models, depth, seen)));
    }
    out
}

// ---------- 签名解析 ----------

/// 定位 `def` 行：先试扫描结果给的行号，对不上再在 ±8 行内找同名 def
/// （文件在扫描与点击之间被编辑过是常态，不该因此报错）
fn find_def_line(lines: &[&str], line: u32, handler: &str) -> Option<usize> {
    let hit = |i: usize| -> bool {
        let Some(raw) = lines.get(i) else { return false };
        let t = strip_comment(raw).trim_start();
        let t = t.strip_prefix("async ").unwrap_or(t).trim_start();
        let Some(rest) = t.strip_prefix("def ") else { return false };
        let name: String = rest
            .trim_start()
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if name.is_empty() {
            return false;
        }
        handler.is_empty() || name == handler
    };
    let idx = (line as usize).saturating_sub(1);
    if hit(idx) {
        return Some(idx);
    }
    for d in 1..=8usize {
        if idx >= d && hit(idx - d) {
            return Some(idx - d);
        }
        if hit(idx + d) {
            return Some(idx + d);
        }
    }
    None
}

/// 从 def 行起拼接完整签名（跨行），返回 `(...)` **内部**的文本
fn collect_signature(lines: &[&str], start: usize) -> Option<String> {
    let mut buf = String::new();
    let mut open: Option<usize> = None;
    for line in lines.iter().skip(start).take(MAX_SIG_LINES) {
        let l = strip_comment(line);
        if open.is_none() {
            if let Some(p) = l.find('(') {
                open = Some(buf.len() + p);
            }
        }
        buf.push_str(l);
        if let Some(o) = open {
            if let Some(c) = matching_bracket(&buf, o) {
                return Some(buf[o + 1..c].to_string());
            }
        }
        buf.push('\n');
    }
    None
}

struct RawParam {
    name: String,
    ty: Option<String>,
    default: Option<String>,
    varargs: bool,
}

/// 单个形参文本 → RawParam。注解与默认值都取**顶层**的 `:` / `=`，
/// 且 `:` 前必须是合法标识符（挡掉 `f=lambda x: x` 这类默认值里的冒号）。
fn parse_one_param(text: &str) -> Option<RawParam> {
    let t = text.trim();
    if t.is_empty() {
        return None;
    }
    let colon = find_top_level(t, ':').filter(|c| is_ident(t[..*c].trim()));
    let (head, ty, default) = match colon {
        Some(c) => {
            let rest = &t[c + 1..];
            match find_top_level(rest, '=') {
                Some(e) => (
                    t[..c].trim(),
                    Some(rest[..e].trim().to_string()),
                    Some(rest[e + 1..].trim().to_string()),
                ),
                None => (t[..c].trim(), Some(rest.trim().to_string()), None),
            }
        }
        None => match find_top_level(t, '=') {
            Some(e) => (t[..e].trim(), None, Some(t[e + 1..].trim().to_string())),
            None => (t, None, None),
        },
    };
    let varargs = head.starts_with('*');
    let name = head.trim_start_matches('*').trim().to_string();
    if name.is_empty() {
        return None;
    }
    Some(RawParam { name, ty, default, varargs })
}

/// 默认值是否表示「必填」：`...`（Ellipsis）与 `Query(...)` / `Body(...)` 的首参为 `...`
fn default_is_required(d: &str) -> bool {
    let t = d.trim();
    if t == "..." {
        return true;
    }
    let inner = match t.split_once('(') {
        Some((_, r)) => r.trim_start(),
        None => return false,
    };
    inner.starts_with("...")
}

/// 默认值里的**调用名**（`Depends(get_db)` → `Depends`；非调用 → ""）
fn default_call(d: &str) -> String {
    let t = d.trim();
    let Some((head, _)) = t.split_once('(') else { return String::new() };
    head.trim().rsplit('.').next().unwrap_or("").trim().to_string()
}

/// 参数分类 → (kind, 跳过原因码)
fn classify_param(
    p: &RawParam,
    route_params: &[String],
    is_flask: bool,
    is_ws: bool,
    models: &[PydModel],
) -> (String, Option<String>) {
    if p.varargs {
        return ("skip".into(), Some("varargs".into()));
    }
    if is_ws {
        return ("skip".into(), Some("websocket".into()));
    }
    let d = p.default.as_deref().unwrap_or("");
    let call = default_call(d);
    if call == "Depends" || call == "Security" {
        return ("skip".into(), Some("dependency".into()));
    }
    let tail = p.ty.as_deref().map(type_tail).unwrap_or_default();
    if matches!(
        tail.as_str(),
        "Request" | "Response" | "WebSocket" | "HTTPConnection" | "BackgroundTasks" | "State"
    ) {
        return ("skip".into(), Some("framework_object".into()));
    }
    if is_flask {
        // Flask 的视图函数只收路径转换器传进来的实参；查询参数与请求体在 request 对象里
        return if route_params.iter().any(|r| r == &p.name) {
            ("path".into(), None)
        } else {
            ("skip".into(), Some("flask_scope".into()))
        };
    }
    match call.as_str() {
        "Path" => return ("path".into(), None),
        "Query" => return ("query".into(), None),
        "Header" => return ("header".into(), None),
        "Cookie" => return ("cookie".into(), None),
        "Body" => return ("body".into(), None),
        _ => {}
    }
    if !tail.is_empty() && models.iter().any(|m| m.name == tail) {
        return ("body".into(), None);
    }
    if route_params.iter().any(|r| r == &p.name) {
        return ("path".into(), None);
    }
    ("query".into(), None)
}

/// 路由里的参数名：FastAPI `{name}` / `{name:converter}`；Flask `<name>` / `<converter:name>`
fn route_params(route: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = route;
    while let Some(i) = rest.find('{') {
        let Some(j) = rest[i..].find('}') else { break };
        let name = rest[i + 1..i + j].split(':').next().unwrap_or("").trim();
        if !name.is_empty() {
            out.push(name.to_string());
        }
        rest = &rest[i + j + 1..];
    }
    let mut rest = route;
    while let Some(i) = rest.find('<') {
        let Some(j) = rest[i..].find('>') else { break };
        let name = rest[i + 1..i + j].rsplit(':').next().unwrap_or("").trim();
        if !name.is_empty() {
            out.push(name.to_string());
        }
        rest = &rest[i + j + 1..];
    }
    out
}

// ---------- 命令 ----------

/// 单个端点的请求样例（A5①）。`file` / `line` / `handler` / `route` / `framework` / `method`
/// 全部来自前端已渲染的 `scan_endpoints` 结果——本命令不重扫端点，只补「怎么调」。
#[tauri::command]
pub async fn scan_endpoint_sample(
    root: String,
    file: String,
    line: u32,
    handler: String,
    route: String,
    framework: String,
    method: String,
) -> Result<EndpointSample, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_endpoint_sample_impl(&root, &file, line, &handler, &route, &framework, &method)
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

fn scan_endpoint_sample_impl(
    root: &str,
    file: &str,
    line: u32,
    handler: &str,
    route: &str,
    framework: &str,
    method: &str,
) -> Result<EndpointSample, String> {
    let is_flask = framework == "flask";
    let is_ws = method == "WS";
    let mut notes: Vec<String> = Vec::new();
    if is_flask {
        notes.push("flask_scope".into());
    }
    if is_ws {
        notes.push("websocket".into());
    }

    let empty = |notes: Vec<String>| EndpointSample {
        handler: handler.to_string(),
        params: Vec::new(),
        body_model: None,
        body_fields: Vec::new(),
        body_json: None,
        notes,
    };

    let Some(content) = read_text_file(Path::new(file)) else {
        notes.push("def_not_found".into());
        return Ok(empty(notes));
    };
    let lines: Vec<&str> = content.lines().collect();
    let Some(start) = find_def_line(&lines, line, handler) else {
        notes.push("def_not_found".into());
        return Ok(empty(notes));
    };
    let Some(sig) = collect_signature(&lines, start) else {
        notes.push("def_not_found".into());
        return Ok(empty(notes));
    };

    let models = pyd_collect_models(Path::new(root));
    let rp = route_params(route);
    let mut params: Vec<SampleParam> = Vec::new();
    let mut unknown = false;

    for raw in split_top_level(&sig, ',')
        .iter()
        .filter_map(|t| parse_one_param(t))
        .take(MAX_PARAMS)
    {
        let (kind, note) = classify_param(&raw, &rp, is_flask, is_ws, &models);
        let ty = raw.ty.clone().unwrap_or_default();
        let required = match raw.default.as_deref() {
            None => true,
            Some(d) => default_is_required(d),
        };
        let value_text = if kind == "skip" || kind == "body" {
            String::new()
        } else {
            let mut seen: Vec<String> = Vec::new();
            let v = sample_val(&ty, &models, 0, &mut seen);
            let s = plain(&v);
            if s == "null" && !ty.is_empty() {
                unknown = true;
            }
            s
        };
        params.push(SampleParam {
            kind,
            name: raw.name,
            type_text: ty,
            required,
            default: raw.default,
            value_text,
            note,
        });
    }

    // ---------- 请求体 ----------
    let mut body_model: Option<String> = None;
    let mut body_fields: Vec<SampleField> = Vec::new();
    let mut body_json: Option<String> = None;

    if !is_ws {
        if let Some(bp) = params.iter().find(|p| p.kind == "body") {
            let tail = type_tail(&bp.type_text);
            match models.iter().find(|m| m.name == tail) {
                Some(m) => {
                    body_model = Some(m.name.clone());
                    let mut seen: Vec<String> = vec![m.name.clone()];
                    let entries = model_entries(m, &models, 1, &mut seen);
                    for (f, (key, val)) in m.fields.iter().zip(entries.iter()) {
                        if matches!(val, JVal::Null) && f.type_text.as_deref().is_some_and(|t| !t.is_empty()) {
                            unknown = true;
                        }
                        body_fields.push(SampleField {
                            name: key.clone(),
                            type_text: f.type_text.clone().unwrap_or_default(),
                            required: f.required,
                            value: j_render(val, 0, false),
                        });
                    }
                    body_json = Some(j_render(&JVal::Obj(entries), 0, true));
                }
                None => {
                    // 形如 `body: dict` 的裸容器：形状已知但内容不可知 → 空对象
                    if matches!(tail.to_ascii_lowercase().as_str(), "dict" | "mapping") {
                        body_model = Some(bp.type_text.clone());
                        body_json = Some("{}".to_string());
                    } else {
                        notes.push("body_model_unknown".into());
                        body_json = Some("{}".to_string());
                    }
                }
            }
        }
    }
    if unknown {
        notes.push("unknown_type".into());
    }

    Ok(EndpointSample {
        handler: handler.to_string(),
        params,
        body_model,
        body_fields,
        body_json,
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("montauri-epsample-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(root: &Path, rel: &str, body: &str) -> String {
        let p = root.join(rel);
        fs::write(&p, body).unwrap();
        p.to_string_lossy().replace('\\', "/")
    }

    /// 样例主路径：path / query / body 三类 + Depends 跳过 + 模型字段展开
    #[test]
    fn sample_fastapi_params_and_body() {
        let d = tmpdir("fastapi");
        let file = write(
            &d,
            "main.py",
            "from fastapi import FastAPI, Depends, Query\n\
             from pydantic import BaseModel, Field\n\
             \n\
             class UserIn(BaseModel):\n\
             \x20   name: str\n\
             \x20   age: int = 0\n\
             \x20   tags: list[str] = []\n\
             \x20   nick: str = Field(alias=\"nickName\")\n\
             \n\
             app = FastAPI()\n\
             \n\
             @app.post(\"/users/{uid}\")\n\
             async def create_user(uid: int, q: str, limit: int = 10, body: UserIn = None, db=Depends(get_db)):\n\
             \x20   ...\n",
        );
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &file,
            15,
            "create_user",
            "/users/{uid}",
            "fastapi",
            "POST",
        )
        .unwrap();

        assert_eq!(s.handler, "create_user");
        let kinds: Vec<(&str, &str)> = s.params.iter().map(|p| (p.name.as_str(), p.kind.as_str())).collect();
        assert_eq!(
            kinds,
            vec![
                ("uid", "path"),
                ("q", "query"),
                ("limit", "query"),
                ("body", "body"),
                ("db", "skip"),
            ]
        );
        // path / query 的样例值：int → 0，str → 裸 string（不带引号）
        assert_eq!(s.params[0].value_text, "0");
        assert!(s.params[0].required, "path 参数无默认值 → 必填");
        assert_eq!(s.params[1].value_text, "string");
        assert_eq!(s.params[2].value_text, "0");
        assert!(!s.params[2].required, "有默认值 → 非必填");
        // 依赖注入被跳过并给出原因
        assert_eq!(s.params[4].note.as_deref(), Some("dependency"));

        assert_eq!(s.body_model.as_deref(), Some("UserIn"));
        let names: Vec<&str> = s.body_fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["name", "age", "tags", "nickName"], "顺序与声明一致，alias 生效");
        assert_eq!(s.body_fields[0].value, "\"string\"");
        assert_eq!(s.body_fields[1].value, "0");
        assert_eq!(s.body_fields[2].value, "[]");
        let json = s.body_json.unwrap();
        assert!(json.contains("\"nickName\""), "JSON 用别名作键: {json}");
        assert!(json.starts_with("{\n  \"name\""), "美化输出且顺序保持: {json}");
    }

    /// 跨行签名 + `Query(...)` 显式必填 + Optional 剥壳
    #[test]
    fn sample_multiline_signature_and_optional() {
        let d = tmpdir("multiline");
        let file = write(
            &d,
            "api.py",
            "from typing import Optional\n\
             from fastapi import Query\n\
             \n\
             async def search(\n\
             \x20   q: str,\n\
             \x20   page: int = Query(..., ge=1),\n\
             \x20   tag: Optional[str] = None,\n\
             \x20   limit: int = 20,\n\
             ):\n\
             \x20   ...\n",
        );
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &file,
            4,
            "search",
            "/search",
            "fastapi",
            "GET",
        )
        .unwrap();
        assert_eq!(s.params.len(), 4);
        assert_eq!(s.params[0].kind, "query");
        assert!(s.params[1].required, "Query(...) → 必填");
        assert_eq!(s.params[1].default.as_deref(), Some("Query(..., ge=1)"));
        assert!(!s.params[2].required, "Optional[str] = None → 非必填");
        assert_eq!(s.params[2].type_text, "Optional[str]");
        assert_eq!(s.params[2].value_text, "string");
        assert!(s.notes.is_empty(), "无异常说明: {:?}", s.notes);
    }

    /// Flask：只产出 path 参数，其余标注框架级说明
    #[test]
    fn sample_flask_scope() {
        let d = tmpdir("flask");
        let file = write(
            &d,
            "app.py",
            "from flask import Blueprint\n\
             bp = Blueprint(\"bp\", __name__)\n\
             \n\
             @bp.route(\"/item/<int:iid>\", methods=[\"GET\"])\n\
             def item(iid):\n\
             \x20   ...\n",
        );
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &file,
            4,
            "item",
            "/item/<int:iid>",
            "flask",
            "GET",
        )
        .unwrap();
        assert!(s.notes.contains(&"flask_scope".to_string()));
        assert_eq!(s.params.len(), 1);
        assert_eq!(s.params[0].kind, "path");
        assert_eq!(s.params[0].name, "iid");
    }

    /// 嵌套模型（深度 1 层）+ 未识别类型 → null 并记 unknown_type
    #[test]
    fn sample_nested_model_and_unknown_type() {
        let d = tmpdir("nested");
        let file = write(
            &d,
            "m.py",
            "from pydantic import BaseModel\n\
             class Addr(BaseModel):\n\
             \x20   city: str\n\
             \n\
             class User(BaseModel):\n\
             \x20   addr: Addr\n\
             \x20   blob: SomeExternalThing\n\
             \n\
             async def create(body: User):\n\
             \x20   ...\n",
        );
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &file,
            10,
            "create",
            "/u",
            "fastapi",
            "POST",
        )
        .unwrap();
        assert_eq!(s.body_model.as_deref(), Some("User"));
        let json = s.body_json.unwrap();
        assert!(json.contains("\"city\": \"string\""), "嵌套模型已展开: {json}");
        assert!(json.contains("\"blob\": null"), "未识别类型 → null: {json}");
        assert!(s.notes.contains(&"unknown_type".to_string()));
    }

    /// def 行号漂移（文件在扫描后被编辑过）→ 邻近找同名 def，不报错
    #[test]
    fn sample_def_line_drift() {
        let d = tmpdir("drift");
        let file = write(
            &d,
            "d.py",
            "x = 1\n\
             y = 2\n\
             async def ping(a: int = 1):\n\
             \x20   ...\n",
        );
        // 扫描时记的是第 3 行；传 5（漂移 +2）仍应命中
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &file,
            5,
            "ping",
            "/ping",
            "fastapi",
            "GET",
        )
        .unwrap();
        assert!(s.notes.is_empty(), "{:?}", s.notes);
        assert_eq!(s.params.len(), 1);
        assert_eq!(s.params[0].name, "a");
    }

    /// 文件不存在 / 找不到 def → Ok + def_not_found（不 Err，前端按语言包渲染）
    #[test]
    fn sample_def_not_found() {
        let d = tmpdir("missing");
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &d.join("nope.py").to_string_lossy().replace('\\', "/"),
            1,
            "ghost",
            "/x",
            "fastapi",
            "GET",
        )
        .unwrap();
        assert!(s.notes.contains(&"def_not_found".to_string()));
        assert!(s.params.is_empty());
        assert!(s.body_json.is_none());
    }

    /// websocket 端点：参数全跳过并给出原因
    #[test]
    fn sample_websocket_skips_params() {
        let d = tmpdir("ws");
        let file = write(
            &d,
            "w.py",
            "async def ws(websocket: WebSocket):\n\
             \x20   ...\n",
        );
        let s = scan_endpoint_sample_impl(
            &d.to_string_lossy(),
            &file,
            1,
            "ws",
            "/ws",
            "fastapi",
            "WS",
        )
        .unwrap();
        assert!(s.notes.contains(&"websocket".to_string()));
        assert_eq!(s.params[0].kind, "skip");
        assert!(s.body_json.is_none(), "websocket 不产出请求体");
    }

    /// 类型工具：剥壳 / 尾段名 / 路由参数提取
    #[test]
    fn type_and_route_helpers() {
        assert_eq!(type_core("Optional[str]"), "str");
        assert_eq!(type_core("str | None"), "str");
        assert_eq!(type_core("Annotated[int, Field(gt=0)]"), "int");
        assert_eq!(type_core("Optional[Annotated[str, Query()]]"), "str");
        assert_eq!(type_tail("app.models.User"), "User");
        assert_eq!(type_tail("list[User]"), "list");
        assert_eq!(type_tail("List[app.m.User]"), "List");
        assert_eq!(route_params("/v1/users/{uid}/x/{n:path}"), vec!["uid", "n"]);
        assert_eq!(route_params("/item/<int:iid>/<name>"), vec!["iid", "name"]);
        assert!(route_params("/health").is_empty());
    }

    /// 顶层切分不得被括号 / 字符串里的分隔符带偏
    #[test]
    fn split_top_level_respects_nesting() {
        let parts = split_top_level("a: dict[str, int] = {}, b: str = \",\"", ',');
        assert_eq!(parts.len(), 2, "{parts:?}");
        assert_eq!(parse_one_param(&parts[0]).unwrap().name, "a");
        assert_eq!(parse_one_param(&parts[1]).unwrap().default.as_deref(), Some("\",\""));
        // lambda 默认值里的冒号不得被当成注解分隔
        let p = parse_one_param("key=lambda x: x").unwrap();
        assert_eq!(p.name, "key");
        assert!(p.ty.is_none(), "{:?}", p.ty);
    }
}
