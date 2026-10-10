//! TD-027 C2 性能验收：`functions_by_last_segment_prefix`（顶级符号补全的迭代入口）。
//!
//! 运行：`cargo run --release -p opencharm-intel-index --example bench_prefix`
//!（release 下对照；无硬性红线——本例是 C2 改造**前后对照**的测量工具，
//! 改造结论记录在 `docs/tech-debt.md` C2 条目）。
//!
//! 场景：10 万函数（与 `bench_load.rs` 同一 seeding 形态），模拟用户逐字符
//! 键入前缀的补全请求序列（`f` / `fu` / `fun` …），测量每次查询的耗时。
//! 旧实现为 HashMap 全键 `starts_with` 线性扫——10 万函数、5 万+ 键下
//! 每键入一次都要全量比较（tech-debt C2）。

use std::path::PathBuf;
use std::time::Instant;

use opencharm_intel_index::{TraceIndex, SCHEMA};
use rusqlite::Connection;

fn seed_db(path: &std::path::Path, n_functions: usize) {
    if path.exists() {
        std::fs::remove_file(path).unwrap();
    }
    let mut conn = Connection::open(path).unwrap();
    conn.execute_batch(SCHEMA).unwrap();

    let tx = conn.transaction().unwrap();
    {
        let mut stmt = tx
            .prepare("INSERT INTO functions(filename, qualname, lineno, hits, stale) VALUES(?1,?2,?3,?4,?5)")
            .unwrap();
        for i in 0..n_functions {
            let filename = format!("pkg/mod{}.py", i % 100);
            // 5 万个不同最后段（pkg{0..500}.func_{i}），模拟真实项目符号密度
            let qualname = format!("pkg{}.func_{}", i % 500, i);
            let lineno = (i % 2000) as i64 + 1;
            stmt.execute(rusqlite::params![filename, qualname, lineno, 5, 0])
                .unwrap();
        }
    }
    tx.commit().unwrap();
}

fn main() {
    let n = 100_000;
    let path: PathBuf = std::env::temp_dir().join("opencharm-intel-bench-prefix.db");

    println!("seeding {n} functions ...");
    let t0 = Instant::now();
    seed_db(&path, n);
    println!("  seed took {:?}", t0.elapsed());

    let idx = TraceIndex::open(&path).unwrap();
    println!("loaded {} functions", idx.len());

    // 模拟逐字符键入的补全序列（含常见前缀与未命中前缀）
    let prefixes = [
        "f", "fu", "fun", "func", "func_", "func_1", "parse", "z", "zz", "zzz",
    ];

    let mut total = std::time::Duration::ZERO;
    let mut total_hits = 0usize;
    for p in prefixes {
        let t = Instant::now();
        let hits = idx.functions_by_last_segment_prefix(p).count();
        let el = t.elapsed();
        total += el;
        total_hits += hits;
        println!("  prefix {:<8} -> {:>6} hits in {:?}", p, hits, el);
    }

    let _ = std::fs::remove_file(&path);

    let avg_us = total.as_secs_f64() * 1_000_000.0 / prefixes.len() as f64;
    println!(
        "total: {:?} for {} queries ({} hits) | avg {:.1} us/query",
        total,
        prefixes.len(),
        total_hits,
        avg_us
    );
}
