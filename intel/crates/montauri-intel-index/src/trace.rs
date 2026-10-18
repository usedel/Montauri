//! trace 索引层：读 SQLite trace 库 → 内存索引。
//!
//! schema 与 `probe/src/montauri_probe/store.py` 对齐（版本对齐点 P2-T07，含 `stale` 列）。
//! 关键约定：
//! - `functions` 以 `(filename, qualname, lineno)` 为自然键（fid 跨运行不稳定）；
//! - `shape` 存空串而非 NULL（probe 端唯一约束对 NULL 不生效），本层归一化为 `Option`；
//! - `stale=1` 表示函数所在文件在末次运行后被修改，消费端可降权或忽略。

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

/// 与 probe `store.py` 只读消费侧对齐的 schema（仅用于测试/种子库创建；`open` 不建表）。
/// TD-027 D3：对齐 `runs.instance` 与 `functions.perf_*` 5 列（store.py 已有的增量迁移列），
/// 头注释的「schema 对齐」恢复为事实（读真实库走显式列名，不受本表影响）。
pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY,
  started REAL NOT NULL,
  elapsed REAL NOT NULL,
  project TEXT NOT NULL,
  script TEXT NOT NULL,
  python TEXT NOT NULL,
  probe_version TEXT NOT NULL,
  instance TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS functions(
  fid INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  qualname TEXT NOT NULL,
  lineno INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  perf_calls INTEGER NOT NULL DEFAULT 0,
  perf_total_ns INTEGER NOT NULL DEFAULT 0,
  perf_max_ns INTEGER NOT NULL DEFAULT 0,
  perf_excl_total_ns INTEGER NOT NULL DEFAULT 0,
  perf_excl_max_ns INTEGER NOT NULL DEFAULT 0,
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

#[derive(Debug)]
pub enum TraceError {
    Sqlite(rusqlite::Error),
    /// TD-027 D6：库路径不存在（原误用 InvalidParameterName Sqlite 变体——语义错位，
    /// 调用方无法按变体分类处理）。携带路径供日志直读。
    Missing(PathBuf),
}

impl fmt::Display for TraceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TraceError::Sqlite(e) => write!(f, "sqlite error: {e}"),
            TraceError::Missing(p) => write!(f, "trace 库不存在: {}", p.display()),
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
///
/// CR-17：消费端（补全/hover/definition/推断）原本按「qualname 最后段」与「type_label」
/// 两个维度做**全量线性扫描**（10 万函数下每键数十~数百 ms）。加载期预建倒排：
/// - `by_last_segment`：最后段 → 函数下标（ret_type_of / find_function / definition / infer_param_type）；
/// - `by_type_label`：type_label → (函数下标, 观测来源, 观测下标)（members/chain/first_shape）。
#[derive(Debug, Default)]
pub struct TraceIndex {
    functions: Vec<Function>,
    by_qualname: HashMap<String, Vec<usize>>,
    by_location: HashMap<String, HashMap<i64, Vec<usize>>>,
    by_file: HashMap<String, Vec<usize>>,
    /// C2（2026-10-10 清偿）：最后段 → 函数下标的**排序数组**（原 HashMap）。
    ///
    /// 顶级符号补全 `functions_by_last_segment_prefix` 原来对 HashMap 全键做
    /// `starts_with` 线性扫（10 万函数 ≈ 5 万键，实测 ~4.8ms/查询，且未命中前缀
    /// 同样全扫）。排序后前缀查询 = 二分下界 + 顺序扫描命中区段；精确查询
    /// `by_last_segment` 同享二分（原哈希查询本就 O(1)，此处统一容器避免两份数据）。
    /// 内存不变（键与值从哈希桶搬进一个 Vec），加载期多一次排序 O(K log K)。
    by_last_segment: Vec<(String, Vec<usize>)>,
    /// CR-17：qualname 倒数第二段 → 函数下标（符号补全 parent 段链匹配的粗筛）。
    by_second_last_segment: HashMap<String, Vec<usize>>,
    /// A-P2-1（2026-09-29 review）：type_label → 函数下标 → 观测定位列表（args+rets 合并，
    /// 观测来源用 flag 区分，消费端按需过滤 stale）。原结构键为 `(type_label, fid)` 复合
    /// 元组，查询却要线性遍历整个 map 逐键字符串比较——CR-17 声称的加速对 type_label
    /// 维度未落地（每次补全/hover/jmespath 诊断全量扫描 20-30 万键）。改为两层嵌套
    /// map，查询降为一次哈希查找。
    by_type_label: HashMap<String, HashMap<usize, Vec<(bool, usize)>>>,
}

impl TraceIndex {
    /// 打开并加载 trace 库。
    ///
    /// CR-16：只读消费——`SQLITE_OPEN_READ_ONLY` + 路径不存在直接报错（原 `Connection::open`
    /// 对不存在路径会**创建空 .db**（资源污染），随后报误导性 `no such table`）；
    /// `busy_timeout(2s)` 与 probe 写库争锁时等待而非立即失败。
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, TraceError> {
        use rusqlite::OpenFlags;
        let path = path.as_ref();
        if !path.exists() {
            return Err(TraceError::Missing(path.to_path_buf()));
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
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
        // CR-17：最后段倒排（消费端 hover/definition/ret_type_of/infer_param_type 的查询键）
        let mut by_last_segment: HashMap<String, Vec<usize>> = HashMap::new();
        let mut by_second_last_segment: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, f) in functions.iter().enumerate() {
            by_qualname.entry(f.qualname.clone()).or_default().push(i);
            by_location
                .entry(f.filename.clone())
                .or_default()
                .entry(f.lineno)
                .or_default()
                .push(i);
            by_file.entry(f.filename.clone()).or_default().push(i);
            let mut it = f.qualname.rsplitn(3, '.');
            let last = it.next().unwrap_or(&f.qualname);
            by_last_segment.entry(last.to_string()).or_default().push(i);
            // 倒数第二段（无则空串键，顶级函数对 parent 非空的补全天然不匹配）
            if let Some(second) = it.next() {
                by_second_last_segment
                    .entry(second.to_string())
                    .or_default()
                    .push(i);
            }
        }

        // CR-17：type_label 倒排——type_label → 函数下标 → 观测定位列表（args+rets 合并）。
        // members_for_type / chain_keys / first_shape_node 原本全表扫描 × 每观测重复
        // serde_json 解析，现在只遍历命中类型的观测。
        // A-P2-1：两层嵌套（type_label → fid → 观测），查询一次哈希命中（原复合元组键
        // 仍要全 map 线性比较，倒排未生效）。
        let mut by_type_label: HashMap<String, HashMap<usize, Vec<(bool, usize)>>> = HashMap::new();
        for (i, f) in functions.iter().enumerate() {
            for (j, obs) in f.args.iter().enumerate() {
                by_type_label
                    .entry(obs.type_label.clone())
                    .or_default()
                    .entry(i)
                    .or_default()
                    .push((false, j));
            }
            for (j, obs) in f.rets.iter().enumerate() {
                by_type_label
                    .entry(obs.type_label.clone())
                    .or_default()
                    .entry(i)
                    .or_default()
                    .push((true, j));
            }
        }

        // C2：最后段倒排转排序数组（前缀查询二分化的前置）。
        let mut by_last_segment: Vec<(String, Vec<usize>)> = by_last_segment.into_iter().collect();
        by_last_segment.sort_unstable_by(|a, b| a.0.cmp(&b.0));

        Ok(TraceIndex {
            functions,
            by_qualname,
            by_location,
            by_file,
            by_last_segment,
            by_second_last_segment,
            by_type_label,
        })
    }

    fn load_args(
        conn: &Connection,
        functions: &mut [Function],
        fid_to_idx: &HashMap<i64, usize>,
    ) -> Result<(), TraceError> {
        // A3①：`ORDER BY fid` 在 fid 相同时**不保序**（SQLite 排序非稳定）——同一函数的
        // 参数位顺序会被打乱，而「位置参数前跳」正依赖该顺序。probe 侧 `monitor._record_args`
        // 按 `co_varnames`（声明顺序）逐参数位写入，故插入序 = 声明序；这里补 `rowid` 作
        // 决胜键把它固定下来（arg_types 无 fid 索引，排序本就发生，补 rowid 零额外代价）。
        let sql = "SELECT fid, arg, type_label, shape, count FROM arg_types ORDER BY fid, rowid";
        let mut stmt = conn.prepare(sql)?;
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

    /// CR-17：按 qualname **最后段**查询（调用点写短名 `parse_page()` 与全限定名
    /// `scraper.parse_page()` 都命中）。hover/definition/推断原全量扫描的替代。
    /// C2：容器改排序数组，精确查询走 `partition_point` 二分（原 HashMap get）。
    pub fn by_last_segment(&self, last: &str) -> impl Iterator<Item = &Function> {
        let idx = self.last_segment_slot(last);
        idx.into_iter().flatten().map(|&i| &self.functions[i])
    }

    /// C2：排序数组内二分定位 `last` 的槽位（精确匹配；未命中 None）。
    fn last_segment_slot(&self, last: &str) -> Option<&Vec<usize>> {
        let pos = self
            .by_last_segment
            .partition_point(|(k, _)| k.as_str() < last);
        self.by_last_segment
            .get(pos)
            .filter(|(k, _)| k == last)
            .map(|(_, v)| v)
    }

    /// CR-17：按 type_label 拉出全部观测（args+rets 合并）。
    /// 返回迭代器元素：`(函数, 观测, 是否来自 rets)`；消费端自行过滤 stale。
    /// A-P2-1：一次哈希查找（原实现线性遍历整个 map 逐键比较）。
    pub fn observations_of_type<'a>(
        &'a self,
        type_label: &'a str,
    ) -> impl Iterator<Item = (&'a Function, &'a TypeObs, bool)> + 'a {
        self.by_type_label
            .get(type_label)
            .into_iter()
            .flat_map(move |per_fid| {
                per_fid.iter().flat_map(move |(&fi, locs)| {
                    locs.iter().filter_map(move |&(is_ret, oi)| {
                        let f = self.functions.get(fi)?;
                        let obs = if is_ret { f.rets.get(oi)? } else { f.args.get(oi)? };
                        Some((f, obs, is_ret))
                    })
                })
            })
    }

    /// CR-17：符号补全迭代入口——只遍历「最后段以 prefix 开头」的函数
    /// （原全量扫描 + 每函数 split('.')）。
    /// C2（2026-10-10 清偿）：原实现对 HashMap 全键 `starts_with` 线性扫，10 万函数
    /// 实测 ~4.8ms/查询（未命中前缀同样全扫）；排序数组上改为二分下界 + 命中区段
    /// 顺序扫描，查询成本 O(log K + 命中数)。对照数据见 `examples/bench_prefix.rs`。
    pub fn functions_by_last_segment_prefix<'a>(
        &'a self,
        prefix: &'a str,
    ) -> impl Iterator<Item = &'a Function> + 'a {
        // 二分下界：第一个 >= prefix 的槽（starts_with(prefix) 的键都 >= prefix）
        let start = self
            .by_last_segment
            .partition_point(|(k, _)| k.as_str() < prefix);
        self.by_last_segment[start..]
            .iter()
            .take_while(move |(k, _)| k.starts_with(prefix))
            .flat_map(|(_, idxs)| idxs.iter().map(|&i| &self.functions[i]))
    }

    /// CR-17：按 qualname 倒数第二段查询（符号补全 parent 段链匹配的粗筛，
    /// 命中候选再由消费端做完整段链校验）。
    pub fn by_second_last_segment(&self, second_last: &str) -> impl Iterator<Item = &Function> {
        self.by_second_last_segment
            .get(second_last)
            .into_iter()
            .flatten()
            .map(|&i| &self.functions[i])
    }
}

/// `shape` 列空串（probe 约定）归一化为 `None`。
fn normalize_shape(shape: Option<String>) -> Option<String> {
    match shape {
        Some(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}