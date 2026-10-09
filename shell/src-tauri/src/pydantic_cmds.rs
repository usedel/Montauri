// Pydantic / 端点扫描域命令（2026-10-09 自 fs_cmds.rs 拆分，纯搬运零语义变更）：
// FastAPI/Flask 静态路由扫描（F1）+ Pydantic 构造校验与改名传播（阶段 4）。
// 纪律与拆分前完全一致：纯文本逐行解析、零子进程、零正则依赖、拉取式
//（前端显式 invoke）、无守护无索引（pyrefly_pydantic_support_plan §3.4 四条全满足）。
//
// 共享走查辅助（collect_files / read_text_file）经 crate::search_cmds 引用。
// PydModel/PydField/pyd_collect_models 的 pub(crate) 可见性保持——A5 的
// ep_sample_cmds.rs 复用本解析器生成请求体样例，不另造第二套解析。

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::search_cmds::{collect_files, read_text_file, MAX_FILE_SIZE};

// ---------- 端点扫描（F1：FastAPI / Flask 静态路由，docs/pycharm_framework_support_report.md §8.3） ----------
//
// 对标 PyCharm Endpoints 工具窗口的**静态可见**部分（不做 HTTP Client / OpenAPI 引擎）。
// 设计纪律（同框架探针表）：
// - **纯文本逐行正则级解析、零子进程**，复用 collect_files 的 ignore 走查（限深限数）；
// - 只认**稳定的公开约定**：`@obj.<method>("path")` / `@obj.route(..., methods=[...])` /
//   `<obj> = APIRouter(prefix=...)` / `<obj> = Blueprint(..., url_prefix=...)` /
//   `x.include_router(obj, prefix=...)` / `x.register_blueprint(obj, url_prefix=...)`，
//   不解析框架源码结构、不做跨文件类型推断；
// - 前缀合并按**对象名**全局匹配（router 声明处 + include 处各取一段），支持一层
//   include_router / register_blueprint；多级嵌套与多行装饰器（path 换行）是已知边界；
// - 结果上限 MAX_ENDPOINTS（同 scan_todos 思路）。

/// 结果上限（防超大仓库把序列化与前端渲染拖垮）
const MAX_ENDPOINTS: usize = 2000;

/// FastAPI 风格路由装饰器（方法名小写）；api_route 的方法取行内 methods=[...]，默认 GET
const FASTAPI_ROUTE_DECORATORS: [&str; 10] = [
    "get", "post", "put", "patch", "delete", "options", "head", "trace", "websocket", "api_route",
];

#[derive(Serialize, Clone, PartialEq)]
pub struct EndpointInfo {
    /// "fastapi" | "flask" | "unknown"（按路由对象的声明类判定；未识别对象只知方法）
    pub framework: String,
    /// HTTP 方法（大写；多方法用 "/" 连接；websocket = "WS"）
    pub method: String,
    /// 合并后的完整路由（include 前缀 + router 前缀 + 声明路径，斜杠归一）
    pub route: String,
    /// 声明文件（**绝对路径**、正斜杠——openFile → read_file 只认绝对路径，
    /// 对齐 scan_todos 的路径契约；相对路径会导致「打开文件失败：找不到路径」）
    pub file: String,
    /// 声明行号（1 起）
    pub line: u32,
    /// 处理函数名（装饰器之后首个 def；装饰器与 def 间被其他语句隔开时为空）
    pub handler: String,
}

/// 是否为合法 Python 标识符（防止 `@app.get(path="/x")` 被 `=` 切开后误判为赋值声明）
fn ep_is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 行内第一个字符串字面量（单双引号均可；不支持转义——路由字面量一般不含引号）
fn ep_first_string_literal(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'"' || b == b'\'' {
            let rest = &line[i + 1..];
            let end = rest.find(b as char)?;
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// 取行内 `key="..."` 形式的关键字参数值；`before` 检查保证 key 不
/// 是更长标识符的尾部（找 "prefix=" 不得命中 "url_prefix="）。
fn ep_kwarg_string(line: &str, key: &str) -> Option<String> {
    let pat = format!("{key}=");
    let bytes = line.as_bytes();
    let mut from = 0usize;
    while let Some(pos) = line[from..].find(&pat) {
        let at = from + pos;
        let before_ok = at == 0 || !(bytes[at - 1].is_ascii_alphanumeric() || bytes[at - 1] == b'_');
        if before_ok {
            let after = line[at + pat.len()..].trim_start();
            if after.starts_with('"') || after.starts_with('\'') {
                return ep_first_string_literal(after);
            }
        }
        from = at + pat.len();
    }
    None
}

/// 装饰器行 `@obj.method("path"...)` → (obj, 展示方法, 路径字面量)。
/// 方法展示在**装饰器行**上完成（methods=[...] 只在装饰器行上，def 行拿不到）；
/// 只认 FASTAPI_ROUTE_DECORATORS 与 "route"（Flask）；其余装饰器返回 None（不截断 pending）。
fn ep_parse_route_decorator(line: &str) -> Option<(String, String, String)> {
    let rest = line.trim().strip_prefix('@')?;
    let (obj, method_part) = rest.split_once('.')?;
    let obj = obj.trim();
    let method = method_part.split('(').next()?.trim();
    if obj.is_empty() || method.is_empty() {
        return None;
    }
    let known = method == "route" || FASTAPI_ROUTE_DECORATORS.contains(&method);
    if !known {
        return None;
    }
    let path = ep_first_string_literal(line).unwrap_or_default();
    Some((obj.to_string(), ep_display_method(method, line), path))
}

/// 对象声明行 `<name> = APIRouter(...)` / `<name> = Blueprint(...)` / `<name> = Flask(...)`
/// / `<name> = FastAPI(...)` → (对象名, 框架 "fastapi"|"flask", 前缀)
fn ep_parse_router_decl(line: &str) -> Option<(String, &'static str, String)> {
    let t = line.trim();
    if t.starts_with('#') {
        return None;
    }
    let (lhs, rhs) = t.split_once('=')?;
    let name = lhs.trim();
    if !ep_is_ident(name) {
        return None;
    }
    let rhs_trim = rhs.trim_start();
    let (framework, prefix_key) = if rhs_trim.starts_with("APIRouter") {
        ("fastapi", "prefix")
    } else if rhs_trim.starts_with("Blueprint") {
        ("flask", "url_prefix")
    } else if rhs_trim.starts_with("Flask") {
        ("flask", "")
    } else if rhs_trim.starts_with("FastAPI") {
        ("fastapi", "")
    } else {
        return None;
    };
    let prefix = if prefix_key.is_empty() {
        String::new()
    } else {
        ep_kwarg_string(t, prefix_key).unwrap_or_default()
    };
    Some((name.to_string(), framework, prefix))
}

/// include 行 `x.include_router(<name>, prefix="...")` / `x.register_blueprint(<name>, url_prefix="...")`
/// → (路由对象名, 合并前缀；缺省为空串)
fn ep_parse_include(line: &str) -> Option<(String, String)> {
    let t = line.trim();
    if t.starts_with('#') {
        return None;
    }
    let (key, kw) = if t.contains(".include_router(") {
        ("include_router(", "prefix")
    } else if t.contains(".register_blueprint(") {
        ("register_blueprint(", "url_prefix")
    } else {
        return None;
    };
    let at = t.find(key)? + key.len();
    let name: String = t[at..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    if name.is_empty() {
        return None;
    }
    let prefix = ep_kwarg_string(t, kw).unwrap_or_default();
    Some((name, prefix))
}

/// def 行（含 async def）→ 函数名
fn ep_parse_def_name(line: &str) -> Option<String> {
    let t = line.trim();
    let rest = t.strip_prefix("async def ").or_else(|| t.strip_prefix("def "))?;
    let name: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    if name.is_empty() { None } else { Some(name) }
}

/// 方法名 → 展示方法（大写；websocket → WS；route/api_route 取行内 methods=[...]，缺省 GET）
fn ep_display_method(method: &str, line: &str) -> String {
    match method {
        "websocket" => "WS".to_string(),
        "api_route" | "route" => {
            let inner = line.find("methods").and_then(|a| {
                let seg = &line[a..];
                let lb = seg.find('[')?;
                let rb = seg.find(']')?;
                if rb > lb { Some(&seg[lb + 1..rb]) } else { None }
            });
            let ms: Vec<String> = inner
                .unwrap_or("")
                .split(',')
                .map(|p| p.trim().trim_matches(|c| c == '"' || c == '\'').trim())
                .filter(|p| !p.is_empty())
                .map(|p| p.to_ascii_uppercase())
                .collect();
            if ms.is_empty() { "GET".to_string() } else { ms.join("/") }
        }
        other => other.to_ascii_uppercase(),
    }
}

/// 路由段合并：两端斜杠归一 + 空段跳过；全空 → "/"
fn ep_join_route(parts: &[&str]) -> String {
    let segs: Vec<&str> = parts
        .iter()
        .map(|p| p.trim().trim_matches('/'))
        .filter(|p| !p.is_empty())
        .collect();
    if segs.is_empty() { "/".to_string() } else { format!("/{}", segs.join("/")) }
}

/// 工作区端点扫描：按「文件 → 行号」排序（前端再按方法分组展示）
#[tauri::command]
pub async fn scan_endpoints(root: String) -> Result<Vec<EndpointInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_endpoints_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn scan_endpoints_impl(root: &str) -> Result<Vec<EndpointInfo>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let mut router_prefix: HashMap<String, String> = HashMap::new();
    let mut include_prefix: HashMap<String, String> = HashMap::new();
    let mut framework_of: HashMap<String, String> = HashMap::new();
    // 第一遍的中间产物：(对象名, 展示方法, 声明路径, 文件, 行号, 处理函数)
    // —— include 行常写在装饰器之后，前缀合并必须**等全部文件扫完**再统一做（单遍会漏）
    let mut raw_endpoints: Vec<(String, String, String, String, u32, String)> = Vec::new();

    for path in collect_files(root_path) {
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }
        let Some(content) = read_text_file(&path) else { continue };
        // 声明文件用绝对路径（对齐 scan_todos）：openFile → read_file 直接 fs 读，
        // 相对路径相对进程 cwd 几乎必失败（E-BASIC 端点真机复现：os error 3）
        let file_abs = path.to_string_lossy().replace('\\', "/");
        // 待配对的装饰器 (obj, 展示方法, 路径)：命中后续 def 行时成对产出
        let mut pending: Option<(String, String, String)> = None;
        for (i, raw) in content.lines().enumerate() {
            let t = raw.trim();
            if t.is_empty() || t.starts_with('#') {
                continue; // 注释/空行不打断 pending（装饰器与 def 之间允许有注释）
            }
            // 1) 对象声明（APIRouter / Blueprint / Flask / FastAPI）
            if let Some((name, framework, prefix)) = ep_parse_router_decl(raw) {
                framework_of.insert(name.clone(), framework.to_string());
                if !prefix.is_empty() {
                    router_prefix.insert(name, prefix);
                }
                pending = None; // 声明插入会打断「装饰器 → def」配对
                continue;
            }
            // 2) include（合并前缀）
            if let Some((name, prefix)) = ep_parse_include(raw) {
                include_prefix.insert(name, prefix);
                continue;
            }
            // 3) def：与 pending 装饰器配对产出端点
            if let Some(handler) = ep_parse_def_name(t) {
                if let Some((obj, method, route_path)) = pending.take() {
                    raw_endpoints.push((obj, method, route_path, file_abs.clone(), (i + 1) as u32, handler));
                }
                continue;
            }
            // 4) 装饰器：可识别的路由装饰器更新 pending；不可识别的装饰器保留 pending（堆叠装饰器）
            if t.starts_with('@') {
                if let Some((obj, method, route_path)) = ep_parse_route_decorator(raw) {
                    pending = Some((obj, method, route_path));
                }
            }
        }
    }

    // 第二遍（纯内存）：include 已收齐，统一做前缀合并
    let mut out: Vec<EndpointInfo> = Vec::new();
    for (obj, method, route_path, file, line, handler) in raw_endpoints {
        if out.len() >= MAX_ENDPOINTS {
            break;
        }
        let framework = framework_of.get(&obj).cloned().unwrap_or_else(|| "unknown".into());
        let inc = include_prefix.get(&obj).cloned().unwrap_or_default();
        let pre = router_prefix.get(&obj).cloned().unwrap_or_default();
        out.push(EndpointInfo {
            framework,
            method,
            route: ep_join_route(&[&inc, &pre, &route_path]),
            file,
            line,
            handler,
        });
    }
    out.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    Ok(out)
}

// ---------- Pydantic 构造校验与改名传播（阶段 4：诊断第四桶 + rename 补充） ----------
//
// docs/pyrefly_pydantic_support_plan.md §3.4：pyrefly 缺 Pydantic 构造校验与字段改名传播
// （F0 实测 references=0，rename 只改声明处），这里用轻量文本解析补齐，纪律与 scan_endpoints
// 完全一致：纯文本逐行解析、零子进程、零正则依赖、拉取式（前端显式 invoke）、无守护无索引
// ——架构裁决 §3.4.0 四条全部满足（≤500 行、无守护、无持久索引、被动响应）。
//
// 判定语义（v2 红线，全部「识别到即跳过」——宁可漏报不误报）：
// - alias 字段（Field(alias=...)）跳过校验（basedpyright 都在此误报）；
// - Optional[...] 无默认值在 Pydantic v2 是必填——按 v2 语义处理（不做 v1 兼容）；
// - `**kwargs` 展开传参的调用点整行跳过；位置参数传字段（User(1, "a")）跳过；
// - 跨文件继承链不合并（模型解析按单文件）；
// - 类型检查只做字面量名义等价（"str" vs int / 1 vs str）；复杂表达式静默跳过。

/// 解析出的 Pydantic 字段（单文件内）
/// 可见性放宽到 crate：A5 的端点请求样例（`ep_sample_cmds.rs`）复用本解析器生成
/// 请求体样例，不另造第二套 Pydantic 解析。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PydField {
    pub(crate) name: String,
    /// 类型标注文本（如 "int" / "Optional[str]"）；用于字面量名义比对
    pub(crate) type_text: Option<String>,
    /// 是否必填（无默认值）
    pub(crate) required: bool,
    /// Field(alias="...") 的别名（构造处可用别名传参）；has_alias 时校验按别名放行
    pub(crate) alias: Option<String>,
}

/// 解析出的 Pydantic 模型（BaseModel 子类，含同文件继承合并后的字段）
#[derive(Debug, Clone)]
pub(crate) struct PydModel {
    pub(crate) name: String,
    /// 类声明所在文件绝对路径（正斜杠）
    file: String,
    /// 合并后字段（继承在前、自有覆盖在后）
    pub(crate) fields: Vec<PydField>,
}

/// 单文件类解析中间结构（尚未判定是否 Pydantic 模型、未合并继承）
#[derive(Debug, Clone)]
struct PydClassInfo {
    name: String,
    /// 基类名列表（去空白；模块限定名取尾段）
    bases: Vec<String>,
    /// 本类自有字段
    fields: Vec<PydField>,
}

/// 行首缩进宽度（空格数；Tab 计 1——仅作类体边界比较，不追求精确列）
fn pyd_indent_of(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

/// 剥离行内注释：首个**引号外** `#` 起截断（引号状态机，与 find_call_head 同款语义）。
/// 返回前缀切片（字节偏移不变，调用方的列号计算不受影响）。
fn pyd_strip_comment(line: &str) -> &str {
    let mut quote: Option<u8> = None;
    for (i, &b) in line.as_bytes().iter().enumerate() {
        match quote {
            None => {
                if b == b'"' || b == b'\'' {
                    quote = Some(b);
                } else if b == b'#' {
                    return &line[..i];
                }
            }
            Some(q) if b == q => quote = None,
            _ => {}
        }
    }
    line
}

/// 字节偏移 → 字符索引（列号必须按字符算：中文值字面量会让字节列错位，
/// 错位列号在 rename 编辑里会写坏代码——2026-09-29 复核修复）
fn byte_to_char_idx(line: &str, byte_idx: usize) -> usize {
    line[..byte_idx].chars().count()
}

/// `class X(BaseModel):` / `class X(User):` → 类名与基类列表文本；非类声明行返回 None。
/// 行内注释先剥离（`class A(BaseModel):  # 说明` 的注释文本不进基类列表）。
fn pyd_parse_class_decl(line: &str) -> Option<(String, String)> {
    let t = pyd_strip_comment(line).trim_start();
    if t.starts_with('#') {
        return None;
    }
    let rest = t.strip_prefix("class ")?;
    let name: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    if name.is_empty() {
        return None;
    }
    let after = rest[name.len()..].trim_start();
    let paren = after.strip_prefix('(')?;
    let close = paren.rfind(')')?;
    Some((name, paren[..close].trim().to_string()))
}

/// 字段声明行 `name: type` / `name: type = default` / `name: type = Field(...)`
/// → PydField。非字段行返回 None：方法 / 嵌套类 / 装饰器 / `model_config =` 赋值
/// （Pydantic 类配置不是字段）/ `ClassVar[...]` 注解（v2 语义：非构造字段）。
fn pyd_parse_field(line: &str) -> Option<PydField> {
    let t = pyd_strip_comment(line).trim_start();
    if t.starts_with('#') || t.is_empty() {
        return None;
    }
    if t.starts_with("def ") || t.starts_with("async def ") || t.starts_with("class ") || t.starts_with('@') {
        return None;
    }
    let Some(colon) = t.find(':') else { return None };
    let name = t[..colon].trim();
    if name.is_empty() || !name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') {
        return None;
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    let after = t[colon + 1..].trim_start();
    if after.is_empty() {
        return None;
    }
    if after.starts_with("ClassVar") {
        return None; // v2：ClassVar 不是构造字段
    }
    if name == "model_config" {
        return None; // Pydantic 类配置（ConfigDict 赋值），不是构造字段
    }
    // 类型文本截到 `=` 或行尾：类型标注不含裸 `=`（嵌套 [] 内也无），split_once 安全
    let (type_part, default_part) = match after.split_once('=') {
        Some((ty, d)) => (ty.trim(), Some(d.trim())),
        None => (after.trim_end(), None),
    };
    if type_part.is_empty() {
        return None;
    }
    // Field(alias="...") 提取别名（单双引号均可；不含引号的复杂 alias 表达式不认）
    let alias = default_part.and_then(|d| {
        if !d.starts_with("Field") {
            return None;
        }
        let v = d.find("alias")?;
        let seg = &d[v..];
        let eq = seg.find('=')? + 1;
        let after = seg[eq..].trim_start();
        let q = after.chars().next()?;
        if q != '"' && q != '\'' {
            return None;
        }
        let rest = &after[1..];
        let end = rest.find(q)?;
        Some(rest[..end].to_string())
    });
    Some(PydField {
        name: name.to_string(),
        type_text: Some(type_part.to_string()),
        required: default_part.is_none(),
        alias,
    })
}

/// 单文件解析：收集全部类声明与各自类体字段（类体 = 声明行之后缩进更深的行，
/// 遇到缩进 ≤ 类行缩进的非空行即结束）。
fn pyd_parse_file(content: &str) -> Vec<PydClassInfo> {
    let lines: Vec<&str> = content.lines().collect();
    let mut classes: Vec<PydClassInfo> = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        if let Some((name, bases)) = pyd_parse_class_decl(lines[i]) {
            let class_indent = pyd_indent_of(lines[i]);
            let mut fields: Vec<PydField> = Vec::new();
            let mut j = i + 1;
            while j < lines.len() {
                let l = lines[j];
                let t = l.trim();
                if t.is_empty() || t.starts_with('#') {
                    j += 1;
                    continue;
                }
                if pyd_indent_of(l) <= class_indent {
                    break;
                }
                if let Some(f) = pyd_parse_field(l) {
                    fields.push(f);
                }
                j += 1;
            }
            classes.push(PydClassInfo {
                name,
                bases: bases
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
                fields,
            });
            i = j;
        } else {
            i += 1;
        }
    }
    classes
}

/// 类是否为 Pydantic 模型：基类链（同文件）含 BaseModel（或 pydantic.BaseModel）。
/// memo 防环（文本层面的循环继承）；未知基类（跨文件 / 外部库）不认。
fn pyd_class_is_model(name: &str, classes: &[PydClassInfo], memo: &mut HashMap<String, bool>) -> bool {
    if let Some(&v) = memo.get(name) {
        return v;
    }
    memo.insert(name.to_string(), false); // 防环：计算中再入直接 false
    let v = classes
        .iter()
        .find(|c| c.name == name)
        .map_or(false, |cls| {
            cls.bases.iter().any(|b| {
                let base = b.rsplit('.').next().unwrap_or(b);
                base == "BaseModel" || pyd_class_is_model(base, classes, memo)
            })
        });
    memo.insert(name.to_string(), v);
    v
}

/// 继承合并：父类字段在前、自有覆盖在后（同名去重）；depth 防文本循环继承。
fn pyd_resolve_fields(cls: &PydClassInfo, classes: &[PydClassInfo], depth: usize) -> Vec<PydField> {
    let mut fields: Vec<PydField> = Vec::new();
    if depth < 10 {
        for b in &cls.bases {
            let base = b.rsplit('.').next().unwrap_or(b);
            if let Some(parent) = classes.iter().find(|c| c.name == base) {
                for f in pyd_resolve_fields(parent, classes, depth + 1) {
                    if !fields.iter().any(|x| x.name == f.name) {
                        fields.push(f);
                    }
                }
            }
        }
    }
    for f in &cls.fields {
        fields.retain(|x| x.name != f.name);
        fields.push(f.clone());
    }
    fields
}

/// 工作区扫描收集全部 Pydantic 模型（单文件解析 + 同文件继承合并；跨文件继承不合并）
pub(crate) fn pyd_collect_models(root: &Path) -> Vec<PydModel> {
    let mut out: Vec<PydModel> = Vec::new();
    for path in collect_files(root) {
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }
        let Some(content) = read_text_file(&path) else { continue };
        let file_abs = path.to_string_lossy().replace('\\', "/");
        let classes = pyd_parse_file(&content);
        let mut memo: HashMap<String, bool> = HashMap::new();
        for cls in &classes {
            if pyd_class_is_model(&cls.name, &classes, &mut memo) {
                out.push(PydModel {
                    name: cls.name.clone(),
                    file: file_abs.clone(),
                    fields: pyd_resolve_fields(cls, &classes, 0),
                });
            }
        }
    }
    out
}

/// 字面量名义类型："..."→str、整数→int、True/False→bool、浮点→float；
/// 复杂表达式返回 None（跳过类型检查）
fn pyd_literal_type(text: &str) -> Option<&'static str> {
    let t = text.trim();
    if (t.starts_with('"') && t.ends_with('"') && t.len() >= 2)
        || (t.starts_with('\'') && t.ends_with('\'') && t.len() >= 2)
    {
        return Some("str");
    }
    if t == "True" || t == "False" {
        return Some("bool");
    }
    if t.parse::<i64>().is_ok() {
        return Some("int");
    }
    if t.parse::<f64>().is_ok() {
        return Some("float");
    }
    None
}

/// 注解文本 → 名义类型名（仅 int / str / bool / float；Optional[X] 剥壳后同判；其余 None）
fn pyd_annot_type(text: &str) -> Option<String> {
    let t = text.trim();
    let inner = t.strip_prefix("Optional[").and_then(|r| r.strip_suffix(']'));
    let base = inner.unwrap_or(t);
    match base {
        "int" | "str" | "bool" | "float" => Some(base.to_string()),
        _ => None,
    }
}

/// 构造调用诊断（owner = opencharm-pydantic，前端第四桶）
#[derive(Serialize, Clone, Debug)]
pub struct PydanticIssue {
    /// 诊断所在文件（绝对路径正斜杠）
    pub file: String,
    /// 1 基行号
    pub line: u32,
    /// 1 基列号（参数名起始列）
    pub column: u32,
    pub end_column: u32,
    /// "missing" | "unknown" | "type"
    pub kind: String,
    pub message: String,
    /// 涉及字段名
    pub field: String,
    /// 所属模型名
    pub model: String,
}

/// 工作区 Pydantic 构造校验扫描：模型收集 + `X(...)` 调用点逐行校验。
#[tauri::command]
pub async fn scan_pydantic_issues(root: String) -> Result<Vec<PydanticIssue>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_pydantic_issues_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn scan_pydantic_issues_impl(root: &str) -> Result<Vec<PydanticIssue>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let models = pyd_collect_models(root_path);
    if models.is_empty() {
        return Ok(Vec::new());
    }
    let mut out: Vec<PydanticIssue> = Vec::new();
    for path in collect_files(root_path) {
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }
        let Some(content) = read_text_file(&path) else { continue };
        let file_abs = path.to_string_lossy().replace('\\', "/");
        for (i, raw) in content.lines().enumerate() {
            let line = pyd_strip_comment(raw); // 注释里的 `User(name=)` 不参与诊断（2026-09-29 修复）
            let lineno = (i + 1) as u32;
            // **kwargs 展开传参：该行所有调用点跳过（v2 红线）
            if line.contains("**") {
                continue;
            }
            for m in &models {
                let Some(at) = find_call_head(line, &m.name) else { continue };
                scan_pydantic_call_args(line, lineno, &file_abs, at, m, &mut out);
            }
        }
    }
    out.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    Ok(out)
}

/// 行内 `Model(` 调用头位置：Model 名前后非标识符字符、后紧跟 `(`、
/// 前文不是 `def ` / `class `（`def Model(` 不算调用）、且不在字符串字面量内
/// （`e = "User(name=1)"` 不算）。简易引号状态机：行内未闭合引号后的内容全部跳过。
fn find_call_head(line: &str, name: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut from = 0usize;
    while let Some(pos) = line[from..].find(name) {
        let at = from + pos;
        let after = at + name.len();
        let ok_before = at == 0 || !(bytes[at - 1].is_ascii_alphanumeric() || bytes[at - 1] == b'_');
        let ok_after = bytes.get(after).copied() == Some(b'(');
        let head = line[..at].trim_end();
        let not_def = !head.ends_with("def ") && !head.ends_with("class ");
        let in_string = count_unpaired_quote(line, at) > 0;
        if ok_before && ok_after && not_def && !in_string {
            return Some(at);
        }
        from = at + name.len();
    }
    None
}

/// line[..at] 内未配对引号数（>0 = at 处于字符串字面量内；简易状态机，不处理转义嵌套）
fn count_unpaired_quote(line: &str, upto: usize) -> usize {
    let mut quote: Option<u8> = None;
    let mut n = 0usize;
    for &b in &line.as_bytes()[..upto] {
        match quote {
            None => {
                if b == b'"' || b == b'\'' {
                    quote = Some(b);
                    n += 1;
                }
            }
            Some(q) if b == q => {
                quote = None;
                n -= 1;
            }
            _ => {}
        }
    }
    n
}

/// 单行调用点参数校验：kwargs 提取 → unknown / type；必填缺失另查。
/// 没识别出任何 kwargs（位置参数 / 跨行调用）时整个调用点跳过（v2 红线）。
fn scan_pydantic_call_args(
    line: &str,
    lineno: u32,
    file: &str,
    at: usize,
    model: &PydModel,
    out: &mut Vec<PydanticIssue>,
) {
    let args = extract_call_kwargs(line, at);
    if args.is_empty() {
        let inner = line[at + model.name.len() + 1..].trim_start();
        // 空参数 `User()` 也要判缺失必填；其余（位置参数 / 跨行）跳过
        if !inner.starts_with(')') {
            return;
        }
    }
    for (k, v, col) in &args {
        // 字段本体或其 alias 均合法（populate_by_name 语义：双合法）
        let Some(field) = model
            .fields
            .iter()
            .find(|f| f.name == *k || f.alias.as_deref() == Some(k.as_str()))
        else {
            out.push(PydanticIssue {
                file: file.to_string(),
                line: lineno,
                column: *col,
                end_column: col + k.len() as u32,
                kind: "unknown".into(),
                message: format!("Pydantic：模型 {} 没有字段 {}（构造参数未知）", model.name, k),
                field: k.clone(),
                model: model.name.clone(),
            });
            continue;
        };
        // alias 字段的类型检查跳过（basedpyright 都在此误报；本名与别名混传形态太复杂）
        if field.alias.is_some() {
            continue;
        }
        if let (Some(ann), Some(lit)) = (
            field.type_text.as_deref().and_then(pyd_annot_type),
            pyd_literal_type(v),
        ) {
            if ann != lit {
                out.push(PydanticIssue {
                    file: file.to_string(),
                    line: lineno,
                    column: *col,
                    end_column: col + k.len() as u32,
                    kind: "type".into(),
                    message: format!(
                        "Pydantic：字段 {} 期望 {}，传入 {}",
                        k,
                        field.type_text.as_deref().unwrap_or("?"),
                        v
                    ),
                    field: k.clone(),
                    model: model.name.clone(),
                });
            }
        }
    }
    // 缺失必填：只对「全部 kwargs 形态 / 空参数」的调用点判；
    // 有 alias 的字段按「本名或别名任一传入」判定
    let passed: std::collections::HashSet<&str> = args.iter().map(|(k, _, _)| k.as_str()).collect();
    for f in &model.fields {
        let ok = passed.contains(f.name.as_str())
            || f.alias.as_deref().map_or(false, |a| passed.contains(a));
        if f.required && !ok {
            out.push(PydanticIssue {
                file: file.to_string(),
                line: lineno,
                column: 0,
                end_column: 0,
                kind: "missing".into(),
                message: format!("Pydantic：构造 {} 缺少必填字段 {}", model.name, f.name),
                field: f.name.clone(),
                model: model.name.clone(),
            });
        }
    }
}

/// 从调用行提取关键字参数 `k=v`（v 为到下一个 `,` 或 `)` 的文本）。
/// 返回 (参数名, 值文本, 参数名列 1 基)；不完整（跨行/嵌套括号）时返回已识别前缀。
fn extract_call_kwargs(line: &str, open_byte: usize) -> Vec<(String, String, u32)> {
    let mut out = Vec::new();
    let Some(open) = line.get(open_byte..).and_then(|s| s.find('(')).map(|p| open_byte + p) else {
        return out;
    };
    let rest = &line[open + 1..];
    // 逐字符扫描：ident= → 值到下一个顶层逗号
    let mut i = 0usize;
    let chars: Vec<char> = rest.chars().collect();
    // 列号按**字符**算（1 基）：open 前字符数 + 1（'('）+ i + 1。
    // 旧实现按字节偏移直加——中文值字面量会让列错位，rename 编辑落点会写坏代码。
    let prefix_chars = byte_to_char_idx(line, open);
    while i < chars.len() {
        let c = chars[i];
        if c == ')' {
            break;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            // 跳过空白找 `=`
            let mut j = i;
            while j < chars.len() && chars[j] == ' ' { j += 1; }
            if j < chars.len() && chars[j] == '=' && (j + 1 >= chars.len() || chars[j + 1] != '=') {
                // 值：从 j+1 到顶层 `,` 或 `)`
                let mut k = j + 1;
                let mut d2 = 0i32;
                while k < chars.len() {
                    let ck = chars[k];
                    if ck == '(' { d2 += 1; }
                    if ck == ')' && d2 == 0 { break; }
                    if ck == ')' { d2 -= 1; }
                    if ck == ',' && d2 == 0 { break; }
                    k += 1;
                }
                let name: String = chars[start..i].iter().collect();
                let value: String = chars[j + 1..k.min(chars.len())].iter().collect();
                out.push((name, value.trim().to_string(), (prefix_chars + 1 + start + 1) as u32));
                i = k;
                continue;
            }
            // 不是 kwargs 形态（位置参数）：跳过到顶层 `,`
            let mut k = i;
            let mut d2 = 0i32;
            while k < chars.len() {
                let ck = chars[k];
                if ck == '(' { d2 += 1; }
                if ck == ')' && d2 == 0 { break; }
                if ck == ')' { d2 -= 1; }
                if ck == ',' && d2 == 0 { break; }
                k += 1;
            }
            i = k;
            continue;
        }
        i += 1;
    }
    out
}

/// rename 补充引用点（子项 2a）：`Model(field=` 的文本级定位。
#[derive(Serialize, Clone, Debug)]
pub struct PydanticCtorRef {
    /// 文件绝对路径（正斜杠）
    pub file: String,
    /// 1 基行号
    pub line: u32,
    /// field 参数名 1 基起始列
    pub column: u32,
    /// 字段名长度（rename 替换宽度）
    pub len: u32,
}

/// 扫描工作区内 `Model(field=` 构造调用点（rename 传播补充；无索引按需扫描）。
/// 匹配规则：Model 名后紧跟 `(`，括号内出现 `field=`（field 后必须紧跟 `=`，
/// 前一字符非标识符——`name=` 不命中 `user_name=`）。
/// 子类调用点一并命中（字段可经继承传入：`User.name` 改名时 `Admin(name=)` 也要改）；
/// 行内注释先剥离（2026-09-29 复核修复）。
#[tauri::command]
pub async fn scan_pydantic_ctor_refs(
    root: String,
    model: String,
    field: String,
) -> Result<Vec<PydanticCtorRef>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_pydantic_ctor_refs_impl(&root, &model, &field))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn scan_pydantic_ctor_refs_impl(root: &str, model: &str, field: &str) -> Result<Vec<PydanticCtorRef>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    // 同文件继承链上的全部模型名（子类构造调用点也算字段引用）
    let mut names: Vec<String> = vec![model.to_string()];
    for m in pyd_collect_models(root_path) {
        if &m.name != model && m.fields.iter().any(|f| f.name == field) {
            // 只收「继承链含 model」的子类（fields 含同名字段可能是巧合的独立字段）
            if model_inherits_from(&m.name, model, root_path) {
                names.push(m.name.clone());
            }
        }
    }
    let mut out: Vec<PydanticCtorRef> = Vec::new();
    for path in collect_files(root_path) {
        let Ok(meta) = fs::metadata(&path) else { continue };
        if meta.len() > MAX_FILE_SIZE {
            continue;
        }
        let Some(content) = read_text_file(&path) else { continue };
        let file_abs = path.to_string_lossy().replace('\\', "/");
        for (i, raw) in content.lines().enumerate() {
            let line = pyd_strip_comment(raw);
            for name in &names {
                let Some(at) = find_call_head(line, name) else { continue };
                let args = extract_call_kwargs(line, at);
                for (k, _, col) in args {
                    if k == field {
                        out.push(PydanticCtorRef {
                            file: file_abs.clone(),
                            line: (i + 1) as u32,
                            column: col, // extract_call_kwargs 已按整行字符列计算（含 at 偏移）
                            len: field.chars().count() as u32,
                        });
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)).then(a.column.cmp(&b.column)));
    Ok(out)
}

/// model_name 的同文件继承链是否含 ancestor（BFS 全链遍历，多继承不漏；
/// 跨文件继承不判——已知边界）
fn model_inherits_from(model_name: &str, ancestor: &str, root: &Path) -> bool {
    let Some(m) = pyd_collect_models(root).into_iter().find(|m| m.name == model_name) else {
        return false;
    };
    let Some(content) = read_text_file(Path::new(&m.file)) else { return false };
    let classes = pyd_parse_file(&content);
    let mut queue: Vec<String> = vec![model_name.to_string()];
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    while let Some(cur) = queue.pop() {
        if !seen.insert(cur.clone()) {
            continue;
        }
        let Some(cls) = classes.iter().find(|c| c.name == cur) else { continue };
        for b in &cls.bases {
            let base = b.rsplit('.').next().unwrap_or(b).to_string();
            if base == ancestor {
                return true;
            }
            if base != "BaseModel" {
                queue.push(base); // 未知基类（跨文件/外部）也入队：找到声明就继续向上
            }
        }
    }
    false
}



// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmpdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-pydcmds-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    // ---------- 端点扫描（F1）单测 ----------

    /// FastAPI：@app.get + APIRouter(prefix) + include_router 合并；websocket → WS
    #[test]
    fn endpoints_fastapi_prefix_merge() {
        let d = tmpdir("ep-fastapi");
        fs::write(
            d.join("main.py"),
            "from fastapi import APIRouter, FastAPI\n\
             app = FastAPI()\n\
             router = APIRouter(prefix=\"/api\")\n\
             \n\
             @app.get(\"/health\")\n\
             async def health(): ...\n\
             \n\
             @router.get(\"/users/{uid}\")\n\
             def list_users(uid: int): ...\n\
             \n\
             @router.websocket(\"/ws\")\n\
             async def ws(): ...\n\
             \n\
             app.include_router(router, prefix=\"/v1\")\n",
        )
        .unwrap();
        let r = scan_endpoints_impl(&d.to_string_lossy()).unwrap();
        assert_eq!(r.len(), 3);
        // 按文件 → 行号排序：health(5) / list_users(9) / ws(13)
        assert_eq!(r[0].route, "/health");
        assert_eq!(r[0].method, "GET");
        assert_eq!(r[0].framework, "fastapi");
        assert_eq!(r[0].handler, "health");
        // file 是绝对路径（正斜杠）——openFile → read_file 只认绝对路径（真机复现回归钉死）
        assert!(r[0].file.starts_with('/') || r[0].file.as_bytes()[1] == b':', "file 应为绝对路径: {}", r[0].file);
        assert!(r[0].file.ends_with("/main.py"), "file 应为绝对路径: {}", r[0].file);
        // include 前缀 /v1 + router 前缀 /api + /users/{uid}
        assert_eq!(r[1].route, "/v1/api/users/{uid}");
        assert_eq!(r[1].handler, "list_users");
        assert!(r[1].file.ends_with("/main.py"));
        assert_eq!(r[2].method, "WS");
        assert_eq!(r[2].route, "/v1/api/ws");
    }

    /// Flask：@app.route 默认 GET + methods 多方法 + Blueprint url_prefix 两处来源
    #[test]
    fn endpoints_flask_methods_and_blueprint() {
        let d = tmpdir("ep-flask");
        fs::write(
            d.join("app.py"),
            "from flask import Blueprint, Flask\n\
             app = Flask(__name__)\n\
             bp = Blueprint(\"admin\", __name__, url_prefix=\"/admin\")\n\
             \n\
             @app.route(\"/index\")\n\
             def index(): ...\n\
             \n\
             @app.route(\"/submit\", methods=[\"POST\"])\n\
             def submit(): ...\n\
             \n\
             @bp.route(\"/dash\", methods=[\"GET\", \"POST\"])\n\
             def dash(): ...\n\
             \n\
             app.register_blueprint(bp)\n",
        )
        .unwrap();
        let r = scan_endpoints_impl(&d.to_string_lossy()).unwrap();
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].method, "GET"); // route 无 methods → 默认 GET
        assert_eq!(r[0].route, "/index");
        assert_eq!(r[0].framework, "flask");
        assert_eq!(r[1].method, "POST");
        assert_eq!(r[2].method, "GET/POST"); // 多方法 "/" 连接
        assert_eq!(r[2].route, "/admin/dash"); // register_blueprint 无 url_prefix → 只用 Blueprint 自带
        // 契约：file 绝对路径（见 endpoints_files_readable_by_openfile_consumer）
        assert!(r.iter().all(|e| e.file.starts_with('/') || e.file.as_bytes().get(1) == Some(&b':')));
    }

    /// 边界：非路由装饰器不截断 pending（堆叠装饰器）；未声明对象 → framework=unknown；
    /// 关键字形态 `@app.get(path="/x")` 不得被误判为赋值声明；api_route 缺 methods → GET
    #[test]
    fn endpoints_edges() {
        assert!(ep_parse_router_decl("@app.get(path=\"/x\")").is_none());
        assert_eq!(
            ep_parse_router_decl("api = APIRouter()").map(|(n, f, p)| (n, f.to_string(), p)),
            Some(("api".into(), "fastapi".into(), String::new()))
        );
        // kwarg 的 before 检查：找 "prefix=" 不得命中 "url_prefix="
        assert_eq!(ep_kwarg_string("bp = Blueprint(\"a\", __name__, url_prefix=\"/u\")", "prefix"), None);
        assert_eq!(ep_kwarg_string("bp = Blueprint(\"a\", __name__, url_prefix=\"/u\")", "url_prefix"), Some("/u".into()));
        let d = tmpdir("ep-edges");
        fs::write(
            d.join("svc.py"),
            "from functools import cache\n\
             svc = object()\n\
             \n\
             @svc.get(\"/x\")\n\
             @cache\n\
             def x(): ...\n\
             \n\
             @app.api_route(\"/y\")\n\
             def y(): ...\n",
        )
        .unwrap();
        let r = scan_endpoints_impl(&d.to_string_lossy()).unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].framework, "unknown"); // svc 未用已知类声明
        assert_eq!(r[0].handler, "x"); // 堆叠装饰器 @cache 不截断配对
        assert_eq!(r[1].method, "GET"); // api_route 缺 methods → GET
        fs::remove_dir_all(&d).unwrap();
    }

    /// 路由段合并纯函数：空段跳过、全空 → "/"
    #[test]
    fn endpoints_join_route() {
        assert_eq!(ep_join_route(&["/v1", "/api", "/users"]), "/v1/api/users");
        assert_eq!(ep_join_route(&["", "/x"]), "/x");
        assert_eq!(ep_join_route(&["", ""]), "/");
        assert_eq!(ep_join_route(&["v1/", "//users/"]), "/v1/users");
    }

    /// 【消费者契约测试】scan_endpoints 产出的 file 必须能被 openFile → read_file 直接消费。
    ///
    /// 背景（真机缺陷复盘）：file 曾返回相对工作区根路径，而前端 `openFile` → Rust
    /// `read_file` 直接 `fs` 读、只认绝对路径 → 真机上点击每个端点都报「打开文件失败：
    /// 系统找不到指定的路径 (os error 3)」。当时的单测按**实现的相对形状**写断言，把
    /// 错误契约钉死了；本测试改按**消费者需要的形状**断言——对扫描结果的每个 file 直接
    /// 走一次 fs 读取，任何人改回相对路径都会在这里红（E2E mock 桥对相对路径有 join
    /// 兜底，测不出这个缺口，必须由本层契约测试守卫）。
    #[test]
    fn endpoints_files_readable_by_openfile_consumer() {
        let d = tmpdir("ep-contract");
        fs::write(
            d.join("main.py"),
            "from fastapi import FastAPI\n\napp = FastAPI()\n\nMARKER_MAIN = 1\n\n@app.get(\"/health\")\nasync def health(): ...\n",
        )
        .unwrap();
        fs::create_dir_all(d.join("routes")).unwrap();
        fs::write(
            d.join("routes").join("users.py"),
            "from fastapi import APIRouter\n\nrouter = APIRouter()\n\nMARKER_USERS = 2\n\n@router.get(\"/users\")\nasync def users(): ...\n",
        )
        .unwrap();

        let r = scan_endpoints_impl(&d.to_string_lossy()).unwrap();
        assert!(r.len() >= 2, "至少 main.py 与 routes/users.py 各一个端点，实际 {} 项", r.len());
        for ep in &r {
            // 契约 1：绝对路径（正斜杠）
            assert!(
                ep.file.starts_with('/') || ep.file.as_bytes().get(1) == Some(&b':'),
                "file 必须是绝对路径（正斜杠）：{}",
                ep.file
            );
            // 契约 2：可被 read_file 语义直接消费（fs 打开成功且读到工作区内容）
            let content = fs::read_to_string(&ep.file)
                .unwrap_or_else(|e| panic!("read_file 消费失败（{}）：{}", ep.file, e));
            assert!(content.contains("MARKER_"), "读到的不是工作区文件内容：{}", ep.file);
        }
    }

    // ---------- Pydantic 语义层（阶段 4）单测 ----------

    fn pyd_tmpdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-pyd-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// 受控语义用例（与 bench/sample/pydantic_models 同款）：类型错 / 缺必填 / 继承合并 / unknown
    #[test]
    fn pydantic_issues_full_semantics() {
        let d = pyd_tmpdir("issues");
        fs::write(
            d.join("models.py"),
            concat!(
                "from pydantic import BaseModel\n",
                "\n",
                "\n",
                "class User(BaseModel):\n",
                "    id: int\n",
                "    name: str\n",
                "    is_active: bool = True\n",
                "\n",
                "\n",
                "class Admin(User):\n",
                "    level: int = 1\n",
            ),
        )
        .unwrap();
        fs::write(
            d.join("usage.py"),
            concat!(
                "from models import Admin, User\n",
                "\n",
                "good = User(id=1, name=\"Alice\")\n",
                "bad_type = User(id=\"not-an-int\", name=\"Steve\")\n",
                "missing = User(id=1)\n",
                "admin = Admin(id=2, name=\"Bob\", level=3)\n",
                "bad_admin = Admin(id=3, level=\"x\")\n",
            ),
        )
        .unwrap();
        let r = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        // bad_type：id 传 str（type）+ bad_admin：level 传 str（type，继承字段默认值可省）+ missing：缺 name
        // 4 条：bad_type 的 id 类型错（行4）；missing 的 name 缺失（行5）；
        // bad_admin 的 level 类型错（行7）+ name 缺失（行7，Admin 继承 User 必填 name）
        assert_eq!(r.len(), 4, "应恰好 4 条：type×2 + missing×2，实际 {:?}",
            r.iter().map(|i| (i.kind.as_str(), i.field.as_str(), i.line)).collect::<Vec<_>>());
        let types: Vec<_> = r.iter().filter(|i| i.kind == "type").map(|i| (i.field.clone(), i.line)).collect();
        assert!(types.contains(&("id".to_string(), 4)), "bad_type 行的 id 类型错：{:?}", types);
        assert!(types.contains(&("level".to_string(), 7)), "bad_admin 行的 level 类型错（继承链合并）：{:?}", types);
        assert!(r.iter().any(|i| i.kind == "missing" && i.field == "name" && i.line == 5));
        assert!(r.iter().any(|i| i.kind == "missing" && i.field == "name" && i.line == 7), "Admin 继承必填 name");
        fs::remove_dir_all(&d).unwrap();
    }

    /// v2 红线：alias 跳过 / **kwargs 跳过 / 位置参数跳过 / unknown 报告 / 空参数判缺失
    #[test]
    fn pydantic_issues_v2_skip_rules() {
        let d = pyd_tmpdir("v2");
        fs::write(
            d.join("m.py"),
            concat!(
                "from pydantic import BaseModel, Field\n",
                "\n",
                "class M(BaseModel):\n",
                "    a: str = Field(alias=\"a_alias\")\n",
                "    b: int\n",
                "    c: str = \"x\"\n",
            ),
        )
        .unwrap();
        fs::write(
            d.join("u.py"),
            concat!(
                "from m import M\n",
                "\n",
                "x = M(b=1)\n",
                "y = M(a_alias=\"s\", b=2)\n",
                "z = M(**data)\n",
                "w = M(1, 2)\n",
                "v = M(b=1, d=9)\n",
            ),
        )
        .unwrap();
        let r = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        // x/y/z/w 都不报（alias 跳过含缺失判定；** 与位置参数整行跳过）；
        // v 报 unknown d（c 有默认可省、a 有 alias 缺失不判）。
        // 注意 `z = M(**data)` 与 `w = M(1, 2)` 行内含引号前的嵌套括号不影响——
        // `w = M(1, 2)` 首参位置参数整点跳过；`z` 含 ** 跳过。
        assert_eq!(r.len(), 1, "只应报 v 行的 unknown d，实际 {:?}", r);
        assert_eq!(r[0].kind, "unknown");
        assert_eq!(r[0].field, "d");
        assert_eq!(r[0].line, 7);
        // 空参数判缺失：M() 缺 b
        fs::write(d.join("u.py"), "from m import M\n\nv = M()\n").unwrap();
        let r2 = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        assert!(r2.iter().any(|i| i.kind == "missing" && i.field == "b"), "M() 应缺必填 b：{:?}", r2);
        fs::remove_dir_all(&d).unwrap();
    }

    /// 非模型类不产生诊断；def Model( / 同前缀类名不误命中
    #[test]
    fn pydantic_issues_no_false_positive() {
        let d = pyd_tmpdir("nfp");
        fs::write(
            d.join("a.py"),
            concat!(
                "class Plain:\n",
                "    x: int\n",
                "\n",
                "def Model():\n",
                "    return 1\n",
                "\n",
                "class MyModel(BaseModel):\n",
                "    y: int\n",
            ),
        )
        .unwrap();
        fs::write(
            d.join("b.py"),
            concat!(
                "from a import MyModel\n",
                "\n",
                "p = Plain(x=1)\n",
                "m = MyModel(y=\"s\")\n",
            ),
        )
        .unwrap();
        let r = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        // Plain 非 BaseModel 链：不报；def Model() 非调用：不报；MyModel(y=\"s\")：报 type
        assert_eq!(r.len(), 1, "只应报 MyModel(y=\"s\") 的 type，实际 {:?}", r);
        assert_eq!(r[0].kind, "type");
        assert_eq!(r[0].model, "MyModel");
        fs::remove_dir_all(&d).unwrap();
    }

    /// rename 传播补充：`Model(field=` 命中 / 同前缀字段不命中 / 非调用行不命中
    #[test]
    fn pydantic_ctor_refs_semantics() {
        let d = pyd_tmpdir("refs");
        fs::write(
            d.join("m.py"),
            concat!(
                "from pydantic import BaseModel\n",
                "\n",
                "class User(BaseModel):\n",
                "    name: str\n",
            ),
        )
        .unwrap();
        fs::write(
            d.join("u.py"),
            concat!(
                "from m import User\n",
                "\n",
                "a = User(name=\"x\")\n",
                "b = User(  name = 2)\n",
                "c = User(user_name=\"y\")\n",
                "d = User(name)\n",
                "\n",
                "name = User(name=\"z\")\n",
                "e = \"User(name=1)\"\n",
            ),
        )
        .unwrap();
        let r = scan_pydantic_ctor_refs_impl(&d.to_string_lossy(), "User", "name").unwrap();
        // 行 3（紧邻）/ 行 4（空白容忍）/ 行 8（赋值行右侧调用）命中；
        // 行 5 user_name= 不命中；行 6 name 无 = 不命中；行 9 字符串内不命中（引号状态机）
        assert_eq!(r.len(), 3, "应命中 3 处（行3/4/8），实际 {:?}", r);
        let lines: Vec<u32> = r.iter().map(|x| x.line).collect();
        assert_eq!(lines, vec![3, 4, 8]);
        // 列号：行 3 `a = User(name=...)` → name 起始列 10（1 基）
        assert_eq!(r[0].column, 10, "行3 name 列号");
        assert_eq!(r[0].len, 4);
        fs::remove_dir_all(&d).unwrap();
    }

    /// 开销红线实测（§5：受控用例全量 < 500ms）：对 bench/sample/pydantic_models 计时。
    /// ignored + 手动跑：cargo test --release pyd_bench -- --ignored --nocapture
    #[test]
    #[ignore]
    fn pyd_bench_scan_issues() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../bench/sample/pydantic_models");
        for i in 0..5 {
            let t = std::time::Instant::now();
            let n = scan_pydantic_issues_impl(root).unwrap().len();
            println!("run {}: {} issues in {:?}", i + 1, n, t.elapsed());
        }
    }

    /// 复核修复回归（2026-09-29）：中文值字面量的字符列号 / 嵌套调用 / 注释剥离
    #[test]
    fn pydantic_review_fixes() {
        let d = pyd_tmpdir("review");
        fs::write(
            d.join("m.py"),
            concat!(
                "from pydantic import BaseModel\n",
                "\n",
                "class User(BaseModel):  # 用户模型\n",
                "    name: str  # 姓名\n",
                "    id: int\n",
            ),
        )
        .unwrap();
        fs::write(
            d.join("u.py"),
            concat!(
                "from m import User\n",
                "\n",
                "a = User(name=\"中文字符串\", id=1)\n",
                "b = wrap(User(name=\"x\", id=2), extra=3)\n",
                "c = User(name=\"y\", id=3)  # User(name=错, id=0)\n",
            ),
        )
        .unwrap();
        let r = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        // 行3：中文串后 id 列号必须按字符算（旧字节列会偏移）；行4 嵌套：extra 不算 User 参数；
        // 行5 注释里的调用不诊断。三条调用点全部正确传参 → 零诊断
        assert_eq!(r.len(), 0, "三行调用点均合法，不应有诊断，实际 {:?}", r);

        // 列号精确性：构造含中文前缀的坏参行，验证 type 诊断的 column 落在参数名上
        fs::write(
            d.join("u.py"),
            concat!(
                "from m import User\n",
                "\n",
                "a = User(name=\"中文\", id=\"bad\")\n",
            ),
        )
        .unwrap();
        let r2 = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        assert_eq!(r2.len(), 1, "id 传 str 应报 type：{:?}", r2);
        // `a = User(name="中文", id="bad")`：id 的 1 基字符列 = 21
        assert_eq!(r2[0].column, 21, "列号必须按字符算（中文场景），实际 {}", r2[0].column);

        // 旧实现的真正错位场景：`(` 之前有非 ASCII（旧 base 按字节偏移直加）
        fs::write(
            d.join("u.py"),
            concat!(
                "from m import User\n",
                "\n",
                "变量 = User(name=\"x\", id=\"bad\")\n",
            ),
        )
        .unwrap();
        let r3 = scan_pydantic_issues_impl(&d.to_string_lossy()).unwrap();
        assert_eq!(r3.len(), 1, "id 传 str 应报 type：{:?}", r3);
        // `变量 = User(...)`：`变`(1)`量`(2)` `(3)`=`(4)` `(5)U(6)s(7)e(8)r(9)`(`(10)n(11)...
        // id 的 1 基字符列 = 21；旧字节算法 `(` 在字节 12 → base 13 → 会报 24
        assert_eq!(r3[0].column, 21, "（ 前有中文时列号仍须按字符算，实际 {}", r3[0].column);

        // ctor_refs：注释里的 field= 不命中；列号按字符算
        let refs = scan_pydantic_ctor_refs_impl(&d.to_string_lossy(), "User", "name").unwrap();
        assert!(refs.iter().all(|x| x.line == 3), "只应命中行3，实际 {:?}", refs);
        // 行3 `变量 = User(name="x", id="bad")`：name 的 1 基字符列 = 11
        assert_eq!(refs[0].column, 11, "name 列号按字符算，实际 {}", refs[0].column);
        fs::remove_dir_all(&d).unwrap();
    }

    /// 复核修复回归：子类调用点传播（User.name 改名 → Admin(name=) 也命中）
    #[test]
    fn pydantic_ctor_refs_subclass() {
        let d = pyd_tmpdir("sub");
        fs::write(
            d.join("m.py"),
            concat!(
                "from pydantic import BaseModel\n",
                "\n",
                "class User(BaseModel):\n",
                "    name: str\n",
                "\n",
                "\n",
                "class Admin(User):\n",
                "    level: int = 1\n",
            ),
        )
        .unwrap();
        fs::write(
            d.join("u.py"),
            concat!(
                "from m import Admin, User\n",
                "\n",
                "a = User(name=\"x\")\n",
                "b = Admin(name=\"y\", level=2)\n",
                "c = Admin(level=3)  # 独立字段 rename 不应命中 User.name\n",
            ),
        )
        .unwrap();
        // User.name → 两处调用点（User 直调 + Admin 子类调用）
        let r = scan_pydantic_ctor_refs_impl(&d.to_string_lossy(), "User", "name").unwrap();
        assert_eq!(r.len(), 2, "User(name=) 与 Admin(name=) 都应命中，实际 {:?}", r);
        let lines: Vec<u32> = r.iter().map(|x| x.line).collect();
        assert_eq!(lines, vec![3, 4]);
        // Admin.level → Admin 自己的两处调用点（行4 b 与行5 c）；User(name=) 无 level 不命中
        let r2 = scan_pydantic_ctor_refs_impl(&d.to_string_lossy(), "Admin", "level").unwrap();
        assert_eq!(r2.len(), 2, "Admin 两处构造调用都应命中 level，实际 {:?}", r2);
        let lines2: Vec<u32> = r2.iter().map(|x| x.line).collect();
        assert_eq!(lines2, vec![4, 5]);
        fs::remove_dir_all(&d).unwrap();
    }
}
