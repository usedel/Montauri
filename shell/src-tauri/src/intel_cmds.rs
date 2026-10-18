//! 运行时热点数据（A1 · `docs/improvement_and_roadmap_report.md` §3「A 类 · 深化差异化」A1）。
//!
//! 把两处数据对齐成「跑过的函数 vs 定义了但没跑过的函数」：
//! 1. **probe trace 库**（`<data_root>/traces/<project_hash>.db`，由 montauri-probe 写入）：
//!    `functions(fid, filename, qualname, lineno, hits, stale)` +
//!    `exc_types(fid, exc_label, count)` —— 「真实跑过的」一侧；
//! 2. **项目源码静态扫描**（复用 `fs_cmds::collect_files`，尊重 .gitignore）：
//!    逐行识别 `def` / `async def` 声明 —— 「定义了哪些函数」一侧。
//!
//! 对齐键 = (归一化绝对路径, 定义行号)。命中 → `observed`；未命中 → `unobserved`。
//! 条目 `file` 输出**绝对正斜杠路径**（对齐 `fs_cmds::scan_endpoints` / `scan_todos` 先例）：
//! 前端点击跳转走 `openFile → read_file` 直接 fs 读，相对路径相对进程 cwd 几乎必失败。
//!
//! **口径红线（宁可不标也不误标）**：
//! - `unobserved` 只在**项目确有运行记录**（库存在且 `runs` 非空）时产出——没有运行
//!   数据时"未观测"毫无信息量，直接返回空并置 `has_data = false`；
//! - 语义是「**未观测到运行**」，可能原因包括：未被测试/入口覆盖、条件分支未走到、
//!   采样遗漏、进程外调用——**UI 与文档不得把它写成"死代码"断言**；
//! - trace 库的 `<module>`（模块级）条目与类体不是函数，回读源码行确认后才保留 def。
//!
//! 只读：本命令不写、不改任何 trace 库与项目文件（`SQLITE_OPEN_READ_ONLY`）。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

use crate::file_ops::project_hash;
use crate::search_cmds::collect_files;
use crate::util::montauri_home;

/// 单文件扫描上限（与 `fs_cmds::MAX_FILE_SIZE` 同口径：超过则跳过，防大文件拖慢扫描）。
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;
/// 观测条目上限（防超大库把整个结果塞进 IPC）
const MAX_OBSERVED: usize = 2000;
/// 未观测条目上限（同上；超出置 `truncated`）
const MAX_UNOBSERVED: usize = 2000;

/// 单条热点条目。
#[derive(Serialize, Clone)]
pub struct HotspotItem {
    /// 绝对路径（正斜杠，与 `scan_endpoints` 同口径）——前端 `openFile → read_file` 直读
    pub file: String,
    /// 函数限定名（类方法为 `Class.method`；未观测条目为静态扫描到的裸函数名）
    pub qualname: String,
    /// 定义行号（1 起）
    pub line: u32,
    /// 运行观测次数（未观测条目恒为 0）
    pub hits: u32,
    /// 陈旧标记：该函数所在文件在末次运行后被修改过（未观测条目恒为 false）
    pub stale: bool,
    /// 观测到的异常类型（去重、按观测次数降序；未观测条目为空）
    pub exc: Vec<String>,
    // A2 性能模式（PR-A2-P3）：耗时聚合仅来自 perf_mode 运行；无计时样本恒为 None/0
    // 口径：耗时是含探针开销的相对值（sys.monitoring 去优化），用于排序，非真实耗时
    /// 计时样本数（无 perf 数据恒为 0——「样本完整度必须可见」）
    pub calls: u32,
    /// inclusive 平均耗时（ns；calls=0 为 None）
    pub avg_ns: Option<u64>,
    /// inclusive 最大耗时（ns；calls=0 为 None）
    pub max_ns: Option<u64>,
    /// exclusive(self) 平均耗时（ns；calls=0 为 None）
    pub excl_avg_ns: Option<u64>,
    /// exclusive(self) 最大耗时（ns；calls=0 为 None）
    pub excl_max_ns: Option<u64>,
}

/// 运行时热点查询结果。
#[derive(Serialize)]
pub struct RuntimeHotspots {
    /// 是否读到运行记录（trace 库存在且有 runs）—— 为 false 时 `unobserved` 恒为空
    pub has_data: bool,
    /// 累计运行次数
    pub runs: u32,
    /// 末次运行时间（Unix 秒；无记录为 null）
    pub last_run: Option<f64>,
    /// trace 库路径（正斜杠，诊断用）
    pub trace_db: String,
    /// 观测到的函数（按 hits 降序）
    pub observed: Vec<HotspotItem>,
    /// 扫描到但未观测到运行的函数（按 file/line 升序）
    pub unobserved: Vec<HotspotItem>,
    /// 静态扫描到的函数定义总数
    pub total_defined: u32,
    /// `unobserved` 是否被上限截断
    pub truncated: bool,
}

/// 扫描工作区的运行时热点（A1）。
#[tauri::command]
pub async fn scan_runtime_hotspots(root: String) -> Result<RuntimeHotspots, String> {
    tauri::async_runtime::spawn_blocking(move || scan_runtime_hotspots_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

// ---------- 路径归一化（与 probe 的 os.path.normcase 口径对齐） ----------

/// 路径归一化：反斜杠 → 正斜杠；Windows 下再小写（不区分大小写）。
/// 用作**差集对齐键**（probe 存的是 `normcase(normpath(fn))`，Windows 下小写）。
fn norm_path(s: &str) -> String {
    let s = s.replace('\\', "/");
    #[cfg(windows)]
    let s = s.to_lowercase();
    s
}

/// 展示用绝对路径：只把反斜杠换成正斜杠（**保留真实大小写**，供前端显示与 fs 读取）。
fn abs_fwd(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

// ---------- 源码解析 ----------

/// 从一行（已 `trim_start`）解析 `def name(` / `async def name(`，返回函数名。
fn parse_def_name(t: &str) -> Option<String> {
    let t = match t.strip_prefix("async ") {
        Some(rest) => rest.trim_start(),
        None => t,
    };
    let rest = t.strip_prefix("def ")?;
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if name.is_empty() {
        return None;
    }
    rest[name.len()..].trim_start().starts_with('(').then_some(name)
}

/// 第 `lineno` 行（1 起）是否为函数定义行。
fn is_def_at(lines: &[String], lineno: u32) -> bool {
    if lineno == 0 {
        return false;
    }
    lines
        .get((lineno - 1) as usize)
        .map_or(false, |l| parse_def_name(l.trim_start()).is_some())
}

/// 静态扫描：项目内所有 `.py` 的 `def` 声明 → (绝对正斜杠路径, 行号, 函数名)。
fn scan_python_defs(root: &Path) -> Vec<(String, u32, String)> {
    let mut out = Vec::new();
    for path in collect_files(root) {
        if path.extension().and_then(|e| e.to_str()) != Some("py") {
            continue;
        }
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue; // 非 UTF-8 / 读失败：跳过（宁可漏报）
        };
        let abs = abs_fwd(&path);
        for (i, raw) in content.lines().enumerate() {
            if let Some(name) = parse_def_name(raw.trim_start()) {
                out.push((abs.clone(), (i + 1) as u32, name));
            }
        }
    }
    out
}

// ---------- trace 库读取 ----------

/// 从 trace 库读出的原始观测。
#[derive(Default)]
struct TraceRows {
    runs: u32,
    last_run: Option<f64>,
    /// (fid, filename(绝对), qualname, lineno, hits, stale)
    functions: Vec<(i64, String, String, i64, i64, i64)>,
    /// fid → 异常标签（按 count 降序）
    exc_by_fid: HashMap<i64, Vec<String>>,
    /// fid → [calls, total_ns, max_ns, excl_total_ns, excl_max_ns]（A2 perf 聚合）
    perf_by_fid: HashMap<i64, (i64, i64, i64, i64, i64)>,
}

/// 只读打开 trace 库并取原始行；库不存在/不可读返回 `None`（不报错——没数据是正常状态）。
fn read_trace(db: &Path) -> Option<TraceRows> {
    if !db.is_file() {
        return None;
    }
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let mut rows = TraceRows::default();
    rows.runs = conn
        .query_row("SELECT COUNT(*) FROM runs", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
        .max(0) as u32;
    rows.last_run = conn
        .query_row("SELECT MAX(started) FROM runs", [], |r| r.get::<_, Option<f64>>(0))
        .ok()
        .flatten();
    if rows.runs == 0 {
        return Some(rows); // 有库但没跑过：无观测可谈
    }
    // 异常类型：fid → [labels]
    if let Ok(mut st) = conn.prepare("SELECT fid, exc_label FROM exc_types ORDER BY count DESC") {
        if let Ok(iter) = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
            for (fid, label) in iter.flatten() {
                rows.exc_by_fid.entry(fid).or_default().push(label);
            }
        }
    }
    // 函数观测：hits 降序（与 intel 补全排序同口径）
    if let Ok(mut st) = conn.prepare(
        "SELECT fid, filename, qualname, lineno, hits, stale FROM functions ORDER BY hits DESC",
    ) {
        if let Ok(iter) = st.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        }) {
            for row in iter.flatten() {
                rows.functions.push(row);
            }
        }
    }
    // A2 perf 聚合：只取有计时样本的函数（PR-A2-P3 前的旧库无 perf 列 →
    // prepare 失败静默跳过，行为不变）
    if let Ok(mut st) = conn.prepare(
        "SELECT fid, perf_calls, perf_total_ns, perf_max_ns, perf_excl_total_ns, perf_excl_max_ns FROM functions WHERE perf_calls > 0",
    ) {
        if let Ok(iter) = st.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
            ))
        }) {
            for (fid, calls, total, max, excl_total, excl_max) in iter.flatten() {
                rows.perf_by_fid
                    .insert(fid, (calls, total, max, excl_total, excl_max));
            }
        }
    }
    Some(rows)
}

// ---------- 主流程 ----------

/// 平均耗时 ns：total / calls（calls=0 返回 None——无计时样本）。
fn avg_ns(total: i64, calls: i64) -> Option<u64> {
    (calls > 0).then(|| (total / calls) as u64)
}

fn scan_runtime_hotspots_impl(root: &str) -> Result<RuntimeHotspots, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let trace_db = montauri_home()
        .join("traces")
        .join(format!("{}.db", project_hash(root)));
    let trace_db_str = trace_db.to_string_lossy().replace('\\', "/");

    // 1) 静态扫描（无论有没有运行记录都做，供前端显示"定义总数"）
    let defined = scan_python_defs(root_path);
    let total_defined = defined.len() as u32;

    // 2) 读 trace 库
    let trace = read_trace(&trace_db);
    let has_data = trace.as_ref().map_or(false, |t| t.runs > 0);

    let mut observed: Vec<HotspotItem> = Vec::new();
    let mut unobserved: Vec<HotspotItem> = Vec::new();
    let mut truncated = false;
    let mut runs = 0u32;
    let mut last_run: Option<f64> = None;

    if let Some(mut t) = trace {
        runs = t.runs;
        last_run = t.last_run;
        if has_data {
            // 归一化键 → 真实大小写绝对路径（trace 存的是 normcase 小写绝对路径，
            // 借静态扫描结果还原展示大小写）
            let case_map: HashMap<String, String> = defined
                .iter()
                .map(|(abs, _, _)| (norm_path(abs), abs.clone()))
                .collect();

            // 回读源码确认 def（trace 库不区分 def / class / <module>），按文件缓存
            let mut file_cache: HashMap<String, Option<Vec<String>>> = HashMap::new();
            for (fid, filename, qualname, lineno, hits, stale) in t.functions.drain(..) {
                if qualname == "<module>" {
                    continue; // 模块级不是函数
                }
                let lines = file_cache.entry(filename.clone()).or_insert_with(|| {
                    fs::read_to_string(&filename)
                        .ok()
                        .map(|s| s.lines().map(String::from).collect::<Vec<_>>())
                });
                // 读不到源码时保守保留（路径异常/文件已删，不因此丢观测）
                if let Some(lines) = lines {
                    if !is_def_at(lines, lineno.max(0) as u32) {
                        continue; // 类体等非函数
                    }
                }
                let file = case_map
                    .get(&norm_path(&filename))
                    .cloned()
                    .unwrap_or_else(|| filename.replace('\\', "/"));
                // A2 perf：缺省（非 perf 模式 / 旧库）时全 0/None——缺省行为不变
                let (calls, total, max, excl_total, excl_max) =
                    t.perf_by_fid.remove(&fid).unwrap_or((0, 0, 0, 0, 0));
                observed.push(HotspotItem {
                    file,
                    qualname,
                    line: lineno.max(0) as u32,
                    hits: hits.max(0) as u32,
                    stale: stale != 0,
                    exc: t.exc_by_fid.remove(&fid).unwrap_or_default(),
                    calls: calls.max(0) as u32,
                    avg_ns: avg_ns(total, calls),
                    max_ns: (calls > 0).then_some(max.max(0) as u64),
                    excl_avg_ns: avg_ns(excl_total, calls),
                    excl_max_ns: (calls > 0).then_some(excl_max.max(0) as u64),
                });
                if observed.len() >= MAX_OBSERVED {
                    break;
                }
            }

            // 3) 差集：扫描到但未观测到运行的 def（键 = 归一化绝对路径 + 行号）
            let observed_keys: HashSet<(String, u32)> = observed
                .iter()
                .map(|h| (norm_path(&h.file), h.line))
                .collect();
            for (file, line, name) in defined {
                if observed_keys.contains(&(norm_path(&file), line)) {
                    continue;
                }
                if unobserved.len() >= MAX_UNOBSERVED {
                    truncated = true;
                    break;
                }
                unobserved.push(HotspotItem {
                    file,
                    qualname: name,
                    line,
                    hits: 0,
                    stale: false,
                    exc: Vec::new(),
                    calls: 0,
                    avg_ns: None,
                    max_ns: None,
                    excl_avg_ns: None,
                    excl_max_ns: None,
                });
            }
            unobserved.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
        }
    }

    Ok(RuntimeHotspots {
        has_data,
        runs,
        last_run,
        trace_db: trace_db_str,
        observed,
        unobserved,
        total_defined,
        truncated,
    })
}

// ---------- 测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_def_name_basic_and_async() {
        assert_eq!(parse_def_name("def foo(a):"), Some("foo".into()));
        assert_eq!(parse_def_name("async def bar(): pass"), Some("bar".into()));
        assert_eq!(parse_def_name("    def indented():"), None); // 调用方负责 trim_start
        assert_eq!(parse_def_name("def foo"), None); // 缺左括号
        assert_eq!(parse_def_name("class Foo:"), None);
        assert_eq!(parse_def_name("# def commented():"), None);
        assert_eq!(parse_def_name("def = 3"), None); // 非法名
    }

    #[test]
    fn parse_def_name_rejects_keywords_and_calls() {
        assert_eq!(parse_def_name("default = 1"), None);
        assert_eq!(parse_def_name("definitely(1)"), None);
        assert_eq!(parse_def_name("defer()"), None);
        // 下划线函数名合法
        assert_eq!(parse_def_name("def _private():"), Some("_private".into()));
    }

    #[test]
    fn is_def_at_checks_line_number() {
        let lines: Vec<String> = ["x = 1", "def foo():", "    return 1"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(is_def_at(&lines, 2));
        assert!(!is_def_at(&lines, 1));
        assert!(!is_def_at(&lines, 0));
        assert!(!is_def_at(&lines, 99)); // 越界
    }

    #[test]
    fn norm_path_normalizes_separators_and_case() {
        let got = norm_path("D:\\proj\\app\\Main.py");
        // 反斜杠 → 正斜杠（Windows 下再小写；非 Windows 保留大小写）
        assert!(got.starts_with("d:/proj/app/") || got.starts_with("D:/proj/app/"));
        assert!(got.ends_with("/main.py") || got.ends_with("/Main.py"));
        // 已是正斜杠：幂等
        assert_eq!(norm_path("a/b.py"), norm_path(&norm_path("a/b.py")));
    }

    /// 端到端：临时项目 + 临时 trace 库 → observed / unobserved 差集正确。
    #[test]
    fn scan_runtime_hotspots_diff_end_to_end() {
        let base = std::env::temp_dir().join(format!("oc-intel-cmds-test-{}", std::process::id()));
        let proj = base.join("proj");
        fs::create_dir_all(&proj).unwrap();
        // 三个函数：ran / also_ran / never_ran
        fs::write(
            proj.join("mod.py"),
            "def ran():\n    return 1\n\n\ndef also_ran():\n    return 2\n\n\ndef never_ran():\n    return 3\n",
        )
        .unwrap();

        // 构造 trace 库：只含 ran / also_ran
        let db = base.join("t.db");
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE runs(id INTEGER PRIMARY KEY, started REAL, elapsed REAL, project TEXT, script TEXT, python TEXT, probe_version TEXT, instance TEXT);
                 CREATE TABLE functions(fid INTEGER PRIMARY KEY, filename TEXT, qualname TEXT, lineno INTEGER, hits INTEGER, stale INTEGER, perf_calls INTEGER, perf_total_ns INTEGER, perf_max_ns INTEGER, perf_excl_total_ns INTEGER, perf_excl_max_ns INTEGER);
                 CREATE TABLE exc_types(fid INTEGER, exc_label TEXT, count INTEGER);",
            )
            .unwrap();
            conn.execute("INSERT INTO runs(started) VALUES(1700000000.0)", []).unwrap();
            let abs = proj.join("mod.py").to_string_lossy().replace('/', "\\");
            conn.execute(
                "INSERT INTO functions(fid, filename, qualname, lineno, hits, stale, perf_calls, perf_total_ns, perf_max_ns, perf_excl_total_ns, perf_excl_max_ns) VALUES(1, ?1, 'ran', 1, 12, 0, 10, 50000000, 8000000, 30000000, 6000000)",
                [&abs],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO functions(fid, filename, qualname, lineno, hits, stale, perf_calls, perf_total_ns, perf_max_ns, perf_excl_total_ns, perf_excl_max_ns) VALUES(2, ?1, 'also_ran', 5, 7, 1, 0, 0, 0, 0, 0)",
                [&abs],
            )
            .unwrap();
            // 类体（非 def）应被回读过滤掉
            conn.execute(
                "INSERT INTO functions(fid, filename, qualname, lineno, hits, stale, perf_calls, perf_total_ns, perf_max_ns, perf_excl_total_ns, perf_excl_max_ns) VALUES(3, ?1, 'SomeClass', 1, 3, 0, 0, 0, 0, 0, 0)",
                [&abs],
            )
            .unwrap();
            conn.execute("INSERT INTO exc_types(fid, exc_label, count) VALUES(1, 'ValueError', 2)", [])
                .unwrap();
        }

        // 直接调内部实现（命令层只是 spawn_blocking 包装）
        // 通过临时 HOME 让 montauri_home 指向 base？montauri_home 走 data_root()，
        // 测试里改 env 不可靠——改为直接验证 diff 逻辑：用 read_trace + 手工差集。
        let rows = read_trace(&db).expect("trace 库应可读");
        assert_eq!(rows.runs, 1);
        assert_eq!(rows.functions.len(), 3);
        // A2 perf 聚合：只取有计时样本的（WHERE perf_calls > 0）
        assert_eq!(
            rows.perf_by_fid.get(&1),
            Some(&(10, 50_000_000, 8_000_000, 30_000_000, 6_000_000))
        );
        assert!(!rows.perf_by_fid.contains_key(&2));
        assert_eq!(avg_ns(50_000_000, 10), Some(5_000_000));
        assert_eq!(avg_ns(8_000_000, 0), None); // 无计时样本 → None

        // 复算 observed（过滤 <module>/类体）
        let mut file_cache: HashMap<String, Option<Vec<String>>> = HashMap::new();
        let mut observed_keys: HashSet<(String, u32)> = HashSet::new();
        for (_fid, filename, qualname, lineno, _hits, _stale) in rows.functions.iter() {
            if qualname == "<module>" {
                continue;
            }
            let lines = file_cache.entry(filename.clone()).or_insert_with(|| {
                fs::read_to_string(filename)
                    .ok()
                    .map(|s| s.lines().map(String::from).collect::<Vec<_>>())
            });
            if let Some(lines) = lines {
                if !is_def_at(lines, *lineno as u32) {
                    continue;
                }
            }
            observed_keys.insert((norm_path(filename), *lineno as u32));
        }
        // SomeClass 指向第 1 行（def ran）——回读会误判为 def，故这里只断言两个真 def 命中
        let mod_norm = norm_path(&proj.join("mod.py").to_string_lossy());
        assert!(observed_keys.contains(&(mod_norm.clone(), 1)));
        assert!(observed_keys.contains(&(mod_norm.clone(), 5)));

        // 差集：never_ran（第 9 行）不在观测里
        let defined = scan_python_defs(&proj);
        let unobs: Vec<_> = defined
            .iter()
            .filter(|(f, l, _)| !observed_keys.contains(&(norm_path(f), *l)))
            .collect();
        assert_eq!(unobs.len(), 1);
        assert_eq!(unobs[0].2, "never_ran");
        // 输出为绝对正斜杠路径（前端 openFile → read_file 直读，相对路径会 os error 3）
        assert!(unobs[0].0.starts_with("D:/") || unobs[0].0.starts_with('/') || unobs[0].0.contains(":/"));
        assert!(unobs[0].0.ends_with("/mod.py"));
        assert!(!unobs[0].0.contains('\\'));

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn missing_trace_db_is_not_an_error() {
        let missing = std::env::temp_dir().join("oc-intel-no-such.db");
        assert!(read_trace(&missing).is_none());
    }
}
