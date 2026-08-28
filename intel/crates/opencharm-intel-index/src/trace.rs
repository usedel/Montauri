//! trace 索引层：读 SQLite trace 库 → 内存索引。
//!
//! schema 与 `probe/src/opencharm_probe/store.py` 对齐（版本对齐点 P2-T07，含 `stale` 列）。
//! 关键约定：
//! - `functions` 以 `(filename, qualname, lineno)` 为自然键（fid 跨运行不稳定）；
//! - `shape` 存空串而非 NULL（probe 端唯一约束对 NULL 不生效），本层归一化为 `Option`；
//! - `stale=1` 表示函数所在文件在末次运行后被修改，消费端可降权或忽略。

use std::collections::HashMap;
use std::fmt;
use std::path::Path;

use rusqlite::Connection;

/// 与 probe `store.py` 只读消费侧对齐的 schema（仅用于测试/种子库创建；`open` 不建表）。
pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY,
  started REAL NOT NULL,
  elapsed REAL NOT NULL,
  project TEXT NOT NULL,
  script TEXT NOT NULL,
  python TEXT NOT NULL,
  probe_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS functions(
  fid INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  qualname TEXT NOT NULL,
  lineno INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  UNIQUE(filename, qualname, lineno)
);
CREATE TABLE IF NOT EXISTS arg_types(
  fid INTEGER NOT NULL REFERENCES functions(fid),
  arg TEXT NOT NULL,
  type_label TEXT NOT NULL,
  shape TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(fid, arg, type_label, shape)
);
CREATE TABLE IF NOT EXISTS ret_types(
  fid INTEGER NOT NULL REFERENCES functions(fid),
  type_label TEXT NOT NULL,
  shape TEXT,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(fid, type_label, shape)
);
CREATE TABLE IF NOT EXISTS exc_types(
  fid INTEGER NOT NULL REFERENCES functions(fid),
  exc_label TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(fid, exc_label)
);
CREATE INDEX IF NOT EXISTS idx_functions_qualname ON functions(qualname);
CREATE INDEX IF NOT EXISTS idx_functions_filename ON functions(filename);
"#;

/// 参数/返回位的类型观测（`arg_types` / `ret_types` 共用；`arg` 在 ret 场景恒为 `""`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeObs {
    pub arg: String,
    pub type_label: String,
    pub shape: Option<String>,
    pub count: i64,
}

/// 异常观测（`exc_types`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExcObs {
    pub exc_label: String,
    pub count: i64,
}

/// 单个函数的全部运行时观测。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Function {
    pub filename: String,
    pub qualname: String,
    pub lineno: i64,
    pub hits: i64,
    pub stale: bool,
    pub args: Vec<TypeObs>,
    pub rets: Vec<TypeObs>,
    pub excs: Vec<ExcObs>,
}

impl Function {
    /// 自然键定位 `(filename, lineno)`（跳转/diagnostic 用）。
    pub fn loc(&self) -> (&str, i64) {
        (&self.filename, self.lineno)
    }
}

#[derive(Debug)]
pub enum TraceError {
    Sqlite(rusqlite::Error),
}

impl fmt::Display for TraceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TraceError::Sqlite(e) => write!(f, "sqlite error: {e}"),
        }
    }
}

impl std::error::Error for TraceError {}

impl From<rusqlite::Error> for TraceError {
    fn from(e: rusqlite::Error) -> Self {
        TraceError::Sqlite(e)
    }
}

/// 内存索引。加载一次性完成，之后全部走 `HashMap` 查询，不再命中 SQLite。
#[derive(Debug, Default)]
pub struct TraceIndex {
    functions: Vec<Function>,
    by_qualname: HashMap<String, Vec<usize>>,
    by_location: HashMap<String, HashMap<i64, Vec<usize>>>,
    by_file: HashMap<String, Vec<usize>>,
}

impl TraceIndex {
    /// 打开并加载 trace 库。
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, TraceError> {
        let conn = Connection::open(path)?;
        Self::from_conn(&conn)
    }

    fn from_conn(conn: &Connection) -> Result<Self, TraceError> {
        // 1. functions：单次全表扫描 + fid → Vec 下标的映射
        let mut functions: Vec<Function> = Vec::new();
        let mut fid_to_idx: HashMap<i64, usize> = HashMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT fid, filename, qualname, lineno, hits, stale FROM functions ORDER BY fid",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let fid: i64 = row.get(0)?;
                fid_to_idx.insert(fid, functions.len());
                functions.push(Function {
                    filename: row.get(1)?,
                    qualname: row.get(2)?,
                    lineno: row.get(3)?,
                    hits: row.get(4)?,
                    stale: row.get(5)?,
                    args: Vec::new(),
                    rets: Vec::new(),
                    excs: Vec::new(),
                });
            }
        }

        // 2. 观测：三张表各单次扫描，按 fid 分发（避免 N+1 逐函数查询）
        Self::load_args(conn, &mut functions, &fid_to_idx)?;
        Self::load_rets(conn, &mut functions, &fid_to_idx)?;
        Self::load_excs(conn, &mut functions, &fid_to_idx)?;

        // 3. 派生索引
        let mut by_qualname: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_location: HashMap<String, HashMap<i64, Vec<usize>>> = HashMap::new();
        let mut by_file: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, f) in functions.iter().enumerate() {
            by_qualname.entry(f.qualname.clone()).or_default().push(i);
            by_location
                .entry(f.filename.clone())
                .or_default()
                .entry(f.lineno)
                .or_default()
                .push(i);
            by_file.entry(f.filename.clone()).or_default().push(i);
        }

        Ok(TraceIndex {
            functions,
            by_qualname,
            by_location,
            by_file,
        })
    }

    fn load_args(
        conn: &Connection,
        functions: &mut [Function],
        fid_to_idx: &HashMap<i64, usize>,
    ) -> Result<(), TraceError> {
        let mut stmt =
            conn.prepare("SELECT fid, arg, type_label, shape, count FROM arg_types ORDER BY fid")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let fid: i64 = row.get(0)?;
            if let Some(&idx) = fid_to_idx.get(&fid) {
                functions[idx].args.push(TypeObs {
                    arg: row.get(1)?,
                    type_label: row.get(2)?,
                    shape: normalize_shape(row.get::<_, Option<String>>(3)?),
                    count: row.get(4)?,
                });
            }
        }
        Ok(())
    }

    fn load_rets(
        conn: &Connection,
        functions: &mut [Function],
        fid_to_idx: &HashMap<i64, usize>,
    ) -> Result<(), TraceError> {
        let mut stmt =
            conn.prepare("SELECT fid, type_label, shape, count FROM ret_types ORDER BY fid")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let fid: i64 = row.get(0)?;
            if let Some(&idx) = fid_to_idx.get(&fid) {
                functions[idx].rets.push(TypeObs {
                    arg: String::new(),
                    type_label: row.get(1)?,
                    shape: normalize_shape(row.get::<_, Option<String>>(2)?),
                    count: row.get(3)?,
                });
            }
        }
        Ok(())
    }

    fn load_excs(
        conn: &Connection,
        functions: &mut [Function],
        fid_to_idx: &HashMap<i64, usize>,
    ) -> Result<(), TraceError> {
        let mut stmt = conn.prepare("SELECT fid, exc_label, count FROM exc_types ORDER BY fid")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let fid: i64 = row.get(0)?;
            if let Some(&idx) = fid_to_idx.get(&fid) {
                functions[idx].excs.push(ExcObs {
                    exc_label: row.get(1)?,
                    count: row.get(2)?,
                });
            }
        }
        Ok(())
    }

    // ---- 查询 API ----

    pub fn functions(&self) -> &[Function] {
        &self.functions
    }

    pub fn len(&self) -> usize {
        self.functions.len()
    }

    pub fn is_empty(&self) -> bool {
        self.functions.is_empty()
    }

    pub fn get(&self, idx: usize) -> Option<&Function> {
        self.functions.get(idx)
    }

    /// 按 qualified name 精确查询（同名函数可能位于多个文件）。
    pub fn by_qualname(&self, qualname: &str) -> impl Iterator<Item = &Function> {
        self.by_qualname
            .get(qualname)
            .into_iter()
            .flatten()
            .map(|&i| &self.functions[i])
    }

    /// 按 `(filename, lineno)` 查询（跳转/diagnostic）。
    pub fn by_location(&self, filename: &str, lineno: i64) -> impl Iterator<Item = &Function> {
        self.by_location
            .get(filename)
            .and_then(|m| m.get(&lineno))
            .into_iter()
            .flatten()
            .map(|&i| &self.functions[i])
    }

    /// 按文件名查询该文件内的全部函数。
    pub fn by_file(&self, filename: &str) -> impl Iterator<Item = &Function> {
        self.by_file
            .get(filename)
            .into_iter()
            .flatten()
            .map(|&i| &self.functions[i])
    }

    /// 全部 qualified name（去重不保证，仅遍历 key；P3-T03 前缀补全再决定排序结构）。
    pub fn qualnames(&self) -> impl Iterator<Item = &String> {
        self.by_qualname.keys()
    }
}

/// `shape` 列空串（probe 约定）归一化为 `None`。
fn normalize_shape(shape: Option<String>) -> Option<String> {
    match shape {
        Some(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}