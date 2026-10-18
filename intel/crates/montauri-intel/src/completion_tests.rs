//! completion.rs 的内联测试（#[path] 外提自 completion.rs，2026-10-10 P1 批）。
//! 仍是 completion 的私有子模块（use super::* 可访问私有项），
//! 与内联 mod tests 完全等价——外提只为遵守行数预算（拆分即降阈值）。

use super::*;
use montauri_intel_index::{TraceIndex, SCHEMA};
use rusqlite::Connection;

/// 建库：scraper.parse_page(hits 12, ret dict[str,int])、scraper.fetch_url(8)、
/// other.parse_json(5)、other.parse_pages(3)。
fn symbol_fixture() -> TraceIndex {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('scraper.py','scraper.parse_page',1,12,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('scraper.py','scraper.fetch_url',2,8,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('other.py','other.parse_json',3,5,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('other.py','other.parse_pages',4,3,0)",
                [],
            )
            .unwrap();
        conn.execute(
            "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str,int]','',4)",
            [],
        )
        .unwrap();
        // 泄漏 dir：fixture 返回索引后临时目录被删，但索引已全量载入内存，不受影响。
    }
    TraceIndex::open(&path).unwrap()
}

#[test]
fn matches_parent_and_prefix() {
    let q: Vec<&str> = "scraper.parse_page".split('.').collect();
    let parent = vec!["scraper".to_string()];
    assert_eq!(matches_chain(&q, &parent, "par"), Some("parse_page".into()));
    assert_eq!(matches_chain(&q, &parent, ""), Some("parse_page".into()));
    assert_eq!(matches_chain(&q, &parent, "x"), None);

    let parent2 = vec!["other".to_string()];
    assert_eq!(matches_chain(&q, &parent2, "par"), None);
}

#[test]
fn matches_top_level_name() {
    let q: Vec<&str> = "parse_page".split('.').collect();
    let parent: Vec<String> = Vec::new();
    assert_eq!(
        matches_chain(&q, &parent, "parse"),
        Some("parse_page".into())
    );
}

#[test]
fn extracts_dot_chain() {
    let text = "x = scraper.par\nprint(1)\n";
    // 光标在 "scraper.par" 末尾（第 0 行第 15 个 UTF-16 列）
    assert_eq!(dot_chain_at(text, 0, 15), Some("scraper.par".to_string()));
    // 尾点形式：光标在 "." 之后（第 12 列），保留尾部点
    assert_eq!(dot_chain_at(text, 0, 12), Some("scraper.".to_string()));
    // 非标识符前（等号后空格，第 2 列）→ 空
    assert_eq!(dot_chain_at(text, 0, 2), Some(String::new()));
}

#[test]
fn completes_symbols() {
    let idx = symbol_fixture();

    // `scraper.par` → parse_page
    let doc = "data = scraper.par";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(cands.len(), 1);
    assert_eq!(cands[0].label, "parse_page");
    assert_eq!(cands[0].kind, CandidateKind::Function);
    assert!(cands[0].detail.contains("⟳ runtime"));

    // `scraper.` → 全部成员
    let doc2 = "data = scraper.";
    let cands2 = complete(&idx, doc2, 0, doc2.len() as u32);
    let labels: Vec<&str> = cands2.iter().map(|c| c.label.as_str()).collect();
    assert!(labels.contains(&"parse_page") && labels.contains(&"fetch_url"));

    // `parse_p`（顶级名）→ 两个（跨文件），hits 降序
    let doc3 = "x = parse_p";
    let cands3 = complete(&idx, doc3, 0, doc3.len() as u32);
    assert_eq!(cands3.len(), 2);
    assert_eq!(cands3[0].label, "parse_page");
    assert_eq!(cands3[1].label, "parse_pages");
}

/// 下标访问补全端到端：`data = parse_page()` 返回 dict，shape 含 title/url → `data["` 补全键。
#[test]
fn completes_dict_keys_via_subscript() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','parse_page',1,10,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, int]','[\"title\",\"url\"]',7)",
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();

    // `data["ti` → title 键
    let doc = "data = parse_page(url)\nprint(data[\"ti";
    let line_len = doc.lines().nth(1).unwrap().len() as u32;
    let cands = complete(&idx, doc, 1, line_len);
    let title = cands.iter().find(|c| c.label == "title");
    assert!(title.is_some(), "应补全出 title 键，实际 {cands:?}");
    let title = title.unwrap();
    assert_eq!(title.kind, CandidateKind::Field);
    assert!(title.detail.contains("dict[str, int]"));

    // `data["`（空前缀）→ title/url 两个键
    let doc2 = "data = parse_page(url)\ny = data[\"";
    let line_len2 = doc2.lines().nth(1).unwrap().len() as u32;
    let cands2 = complete(&idx, doc2, 1, line_len2);
    let fields: Vec<&str> = cands2.iter().map(|c| c.label.as_str()).collect();
    assert!(fields.contains(&"title") && fields.contains(&"url"));

    // `.get("` 形态同样补全键
    let doc3 = "data = parse_page(url)\nz = data.get(\"ur";
    let line_len3 = doc3.lines().nth(1).unwrap().len() as u32;
    let cands3 = complete(&idx, doc3, 1, line_len3);
    assert!(
        cands3.iter().any(|c| c.label == "url"),
        "data.get(\"ur 应补全 url，实际 {cands3:?}"
    );

    // 点访问不再补 dict 键（dict 无属性访问）
    let doc4 = "data = parse_page(url)\ny = data.";
    let line_len4 = doc4.lines().nth(1).unwrap().len() as u32;
    let cands4 = complete(&idx, doc4, 1, line_len4);
    assert!(
        !cands4.iter().any(|c| c.label == "title"),
        "data. 不应补 dict 键 title，实际 {cands4:?}"
    );
}

/// P0-A1：截断元信息 —— 候选数超过 `MAX_CANDIDATES` 时 `truncated == true`。
///
/// 修复前：intel 实际在截断（`v.truncate(MAX_CANDIDATES)`）却从不声明，客户端把列表
/// 当「可本地过滤的完整集合」，第 51 名以后的运行时符号永远补不出来。
#[test]
fn reports_truncation_when_over_max_candidates() {
    // 60 个同前缀键 → 必定超过 MAX_CANDIDATES(50)
    let shape = format!(
        "[{}]",
        (0..60)
            .map(|i| format!("\"k{:02}\"", i))
            .collect::<Vec<_>>()
            .join(",")
    );
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','get_big',1,10,0)",
                [],
            )
            .unwrap();
        conn.execute(
            "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, int]',?1,7)",
            rusqlite::params![shape],
        )
        .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();

    let doc = "d = get_big()\ny = d[\"k";
    let line_len = doc.lines().nth(1).unwrap().len() as u32;
    let outcome = complete_with_meta(&idx, doc, 1, line_len);
    assert_eq!(
        outcome.candidates.len(),
        MAX_CANDIDATES,
        "应截断到 MAX_CANDIDATES 条，实际 {}",
        outcome.candidates.len()
    );
    assert!(
        outcome.truncated,
        "60 个候选必须声明 truncated=true（否则客户端不会重新请求）"
    );
    // 排序契约不破：score 降序 + label 决胜
    assert_eq!(outcome.candidates[0].label, "k00");
    // 原 `complete()` 委托不丢行为
    assert_eq!(complete(&idx, doc, 1, line_len).len(), MAX_CANDIDATES);
}

/// P0-A1：候选数未超上限 → `truncated == false`（不得把「少」误报成「被截断」）。
#[test]
fn reports_no_truncation_when_under_max_candidates() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','get_small',1,10,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, int]','[\"title\",\"url\"]',7)",
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();

    let doc = "d = get_small()\ny = d[\"";
    let line_len = doc.lines().nth(1).unwrap().len() as u32;
    let outcome = complete_with_meta(&idx, doc, 1, line_len);
    assert_eq!(outcome.candidates.len(), 2);
    assert!(!outcome.truncated, "2 个候选不得声明截断");

    // 索引无数据（空候选）同样不得声明截断——语义是「暂无数据」不是「被截断」
    let empty = complete_with_meta(&idx, "z = nosuch.", 0, 12);
    assert!(empty.candidates.is_empty());
    assert!(!empty.truncated, "空候选不得声明截断");
}

/// 多层链式 + list 索引下标补全（`quotes["data"]["diff"][0]["`）。
#[test]
fn completes_nested_dict_keys_via_chain() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','get_quotes',1,10,0)",
                [],
            )
            .unwrap();
        // 递归 shape：data → dict{k: diff → list{e: dict{k: code,name}}}
        conn.execute(
                r#"INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, object]','{"data":{"t":"dict","k":{"diff":{"t":"list","e":{"t":"dict","k":{"code":"str","name":"str"}}}}}}',7)"#,
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();

    // `quotes["data"]["` → 补 diff
    let doc = "quotes = get_quotes()\ny = quotes[\"data\"][\"";
    let line_len = doc.lines().nth(1).unwrap().len() as u32;
    let cands = complete(&idx, doc, 1, line_len);
    let fields: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert!(
        fields.contains(&"diff"),
        "应补 data 子键 diff，实际 {cands:?}"
    );

    // `quotes["data"]["diff"][0]["` → 补 code/name（多层 + list 索引）
    let doc2 = "quotes = get_quotes()\ny = quotes[\"data\"][\"diff\"][0][\"";
    let line_len2 = doc2.lines().nth(1).unwrap().len() as u32;
    let cands2 = complete(&idx, doc2, 1, line_len2);
    let fields2: Vec<&str> = cands2.iter().map(|c| c.label.as_str()).collect();
    assert!(
        fields2.contains(&"code") && fields2.contains(&"name"),
        "深层应补 code/name，实际 {cands2:?}"
    );

    // `quotes.get("data")["` 同理（get 形态）
    let doc3 = "quotes = get_quotes()\ny = quotes.get(\"data\")[\"";
    let line_len3 = doc3.lines().nth(1).unwrap().len() as u32;
    let cands3 = complete(&idx, doc3, 1, line_len3);
    assert!(
        cands3.iter().any(|c| c.label == "diff"),
        "get 形态应补 diff，实际 {cands3:?}"
    );
}

/// jmespath 路径补全：`jmespath.search("data.diff[0].co", quotes)` 补 code。
#[test]
fn completes_jmespath_path() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','get_quotes',1,10,0)",
                [],
            )
            .unwrap();
        conn.execute(
                r#"INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, object]','{"data":{"t":"dict","k":{"diff":{"t":"list","e":{"t":"dict","k":{"code":"str","name":"str"}}}}}}',7)"#,
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();

    // 深层路径：`jmespath.search("data.diff[0].co", quotes)` → 补 code
    let text = "quotes = get_quotes()\nresult = jmespath.search(\"data.diff[0].co\", quotes)";
    let l2 = text.lines().nth(1).unwrap();
    let col = l2.find(".co").unwrap() as u32 + 3;
    let cands = complete(&idx, text, 1, col);
    assert!(
        cands.iter().any(|c| c.label == "code"),
        "深度 jmespath 应补 code，实际 {cands:?}"
    );

    // 顶层：`jmespath.search("dat", quotes)` → 补 data
    let text2 = "quotes = get_quotes()\nresult = jmespath.search(\"dat\", quotes)";
    let l2b = text2.lines().nth(1).unwrap();
    let col2 = l2b.find("dat").unwrap() as u32 + 3;
    let cands2 = complete(&idx, text2, 1, col2);
    assert!(
        cands2.iter().any(|c| c.label == "data"),
        "顶层应补 data，实际 {cands2:?}"
    );

    // 非 jmespath 字符串不影响：普通字符串不触发
    let line3 = "s = \"data.diff\"";
    let col3 = line3.len() as u32 - 1;
    let cands3 = complete(&idx, line3, 0, col3);
    assert!(
        cands3.is_empty(),
        "非 jmespath 字符串不应补全，实际 {cands3:?}"
    );
}

// ---- P3-T10 运行时补全准确率评测（Gate D：无注解代码 ≥ 85%）----

/// 评测点：文档内嵌 `<|>` 光标标记 + 期望补全 label。
struct BenchCase {
    doc: &'static str,
    expect: &'static str,
}

/// 23 评测点的形态归类（索引 0 基，对应 cases 数组顺序）。
/// 与 `bench/reports/gate-d-runtime-completion.md` 的形态表一一对应，
/// 仅用于生成人工对标工作单，不参与判定。
const BENCH_SHAPES: [&str; 23] = [
    "① 函数返回 dict → 字段",
    "① 函数返回 dict → 字段",
    "① 函数返回 dict → 字段（前缀 tit）",
    "① 函数返回 dict → 字段（前缀 li）",
    "② 工厂返回自定义实例 → 属性",
    "② 工厂返回自定义实例 → 属性",
    "② 工厂返回自定义实例 → 属性",
    "② 工厂返回自定义实例 → 属性",
    "② 工厂返回自定义实例 → 属性（前缀 cu）",
    "② 工厂返回自定义实例 → 属性（前缀 it）",
    "③ 商品字典字段",
    "③ 商品字典字段",
    "③ 商品字典字段（前缀 na）",
    "③ 商品字典字段（前缀 pr）",
    "③ 商品字典字段（前缀 st）",
    "④ 用户实例属性",
    "④ 用户实例属性",
    "④ 用户实例属性（前缀 em）",
    "④ 用户实例属性（前缀 ro）",
    "⑤ for 循环变量（list[User]）",
    "⑤ for 循环变量（list[User]）",
    "⑥ 函数参数类型观测",
    "⑥ 函数参数类型观测",
];

/// 导出人工对标工作单（Gate D 剩余项 1「≥ PyCharm 同场景」用）。
///
/// 为什么要自动化这一步：PyCharm 无 CLI 导出补全准确率，只能人工逐点复核。
/// 若让人自己重新拼 23 个光标位置，既慢又会与本测试的 cases 数组漂移。
/// 这里直接把**本测试自己的 cases** 渲染成工作单——Montauri 一列（期望 / 实际排名）
/// 由测试填好，人只需在 PyCharm 里对同一位置点补全、勾「是否在 top-5」。
///
/// 触发：设 `OC_GATE_D_WORKLIST=<输出路径>` 后跑
/// `cargo test -p montauri-intel -- --nocapture runtime_completion_accuracy`。
/// 不设则完全不写文件（保持测试无副作用）。
fn dump_worklist(path: &str, cases: &[BenchCase], ranks: &[Option<usize>]) {
    use std::fmt::Write as _;
    let mut md = String::new();
    let _ = writeln!(md, "# Gate D 人工对标工作单（PyCharm 同场景）");
    let _ = writeln!(md);
    let _ = writeln!(
            md,
            "> 由 `cargo test -p montauri-intel -- --nocapture runtime_completion_accuracy` 自动导出（设 `OC_GATE_D_WORKLIST=<路径>`）。"
        );
    let _ = writeln!(
            md,
            "> **Montauri 两列已由测试填好**，人只需在 PyCharm 打开 `bench/sample/unannotated_scraper/` 同一样例、"
        );
    let _ = writeln!(
        md,
        "> 在下表「光标位置」处触发补全，勾选期望 label 是否出现在 **top-5**。"
    );
    let _ = writeln!(
            md,
            "> 判定口径与 `bench/reports/gate-d-runtime-completion.md` 一致：期望 label 出现在 top-5 即命中。");
    let _ = writeln!(md);
    let _ = writeln!(
            md,
            "> 读法：`▏` = 光标位置（在此触发补全），`↵` = 换行（同一列里换行只是排版，代码本身是一行接一行）。"
        );
    let _ = writeln!(
        md,
        "> 例：``data = parse_page(html)↵print(data[\"▏`` 表示在 `data[\"` 后触发补全。"
    );
    let _ = writeln!(md);
    let _ = writeln!(md, "| # | 形态 | 期望 label | 光标位置 | Montauri 实际排名 | Montauri 命中 | PyCharm 命中（人工填） | 备注 |");
    let _ = writeln!(md, "|---|---|---|---|---|---|---|---|");
    for (i, c) in cases.iter().enumerate() {
        // 表格单元格必须单行：换行折成 ↵，光标标记 ▏ 保留，竖线转义
        let ctx = c
            .doc
            .replace("\r\n", "\n")
            .replace('\n', "↵")
            .replace("<|>", "▏");
        let rank = ranks[i];
        let oc_rank = match rank {
            Some(0) => "**1**".to_string(),
            Some(r) => (r + 1).to_string(),
            None => "未进 top-5".to_string(),
        };
        let oc_hit = if rank.is_some() { "✅" } else { "❌" };
        let _ = writeln!(
            md,
            "| {} | {} | `{}` | `{}` | {} | {} | ☐ | |",
            i + 1,
            BENCH_SHAPES.get(i).copied().unwrap_or("—"),
            c.expect,
            ctx.replace('|', "\\|"),
            oc_rank,
            oc_hit
        );
    }
    let hit_n = ranks.iter().filter(|r| r.is_some()).count();
    let _ = writeln!(md);
    let _ = writeln!(md, "## 小结（人工填）");
    let _ = writeln!(md);
    let _ = writeln!(md, "- Montauri 命中：{hit_n}/{}", cases.len());
    let _ = writeln!(md, "- PyCharm 命中：___/{}（人工填）", cases.len());
    let _ = writeln!(
        md,
        "- 结论（人工填）：☐ Montauri ≥ PyCharm　☐ Montauri < PyCharm　☐ 持平"
    );
    if let Ok(mut f) = std::fs::File::create(path) {
        use std::io::Write as _;
        let _ = f.write_all(md.as_bytes());
    }
}

/// 解析 `<|>` 标记为 (0 基行, 0 基 UTF-16 列)。
fn cursor_of(doc: &str) -> (u32, u32) {
    let pos = doc.find("<|>").expect("缺光标标记 <|>");
    let before: String = doc.chars().take(pos).collect();
    let line = before.matches('\n').count() as u32;
    let col = before.chars().rev().take_while(|&c| c != '\n').count() as u32;
    (line, col)
}

/// 模拟无注解「订单 + 爬虫」项目运行后的 trace 观测（deterministic seed）。
fn bench_seed() -> TraceIndex {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bench.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let funcs = [
            ("shop.py", "parse_page", 1, 120, 0),
            ("shop.py", "make_order", 2, 80, 0),
            ("shop.py", "fetch_product", 3, 60, 0),
            ("shop.py", "get_user", 4, 45, 0),
            ("shop.py", "list_users", 5, 30, 0),
            ("shop.py", "handle_order", 6, 15, 0),
        ];
        for (f, q, l, h, s) in funcs {
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES(?1,?2,?3,?4,?5)",
                rusqlite::params![f, q, l, h, s],
            )
            .unwrap();
        }
        let rets = [
            (1, "dict[str, str|list]", "[\"links\",\"title\"]", 100),
            (2, "Order", "[\"customer\",\"id\",\"items\",\"total\"]", 80),
            (
                3,
                "dict[str, str|float|int]",
                "[\"name\",\"price\",\"sku\",\"stock\"]",
                60,
            ),
            (4, "User", "[\"email\",\"name\",\"roles\"]", 45),
            (5, "list[User]", "", 30),
        ];
        for (fid, ty, shape, c) in rets {
            conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(?1,?2,?3,?4)",
                rusqlite::params![fid, ty, shape, c],
            )
            .unwrap();
        }
        conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(6,'order','Order','[\"customer\",\"id\",\"items\",\"total\"]',15)",
                [],
            )
            .unwrap();
    }
    TraceIndex::open(&path).unwrap()
}

/// 运行时补全准确率（确定性 seed + 评测点集，覆盖无注解代码四种核心形态）。
#[test]
fn runtime_completion_accuracy() {
    let idx = bench_seed();
    let cases: &[BenchCase] = &[
        // ① 函数返回 dict → 下标访问补全键
        BenchCase {
            doc: "data = parse_page(html)\nprint(data[\"<|>",
            expect: "title",
        },
        BenchCase {
            doc: "data = parse_page(html)\nprint(data[\"<|>",
            expect: "links",
        },
        BenchCase {
            doc: "data = parse_page(html)\nprint(data[\"tit<|>",
            expect: "title",
        },
        BenchCase {
            doc: "data = parse_page(html)\nprint(data[\"li<|>",
            expect: "links",
        },
        // ② 工厂返回自定义实例 → 属性补全
        BenchCase {
            doc: "o = make_order(c)\nprint(o.<|>",
            expect: "id",
        },
        BenchCase {
            doc: "o = make_order(c)\nprint(o.<|>",
            expect: "customer",
        },
        BenchCase {
            doc: "o = make_order(c)\nprint(o.<|>",
            expect: "items",
        },
        BenchCase {
            doc: "o = make_order(c)\nprint(o.<|>",
            expect: "total",
        },
        BenchCase {
            doc: "o = make_order(c)\nprint(o.cu<|>",
            expect: "customer",
        },
        BenchCase {
            doc: "o = make_order(c)\nprint(o.it<|>",
            expect: "items",
        },
        // ③ 商品字典键（下标访问）
        BenchCase {
            doc: "p = fetch_product(sku)\nprint(p[\"<|>",
            expect: "sku",
        },
        BenchCase {
            doc: "p = fetch_product(sku)\nprint(p[\"<|>",
            expect: "name",
        },
        BenchCase {
            doc: "p = fetch_product(sku)\nprint(p[\"na<|>",
            expect: "name",
        },
        BenchCase {
            doc: "p = fetch_product(sku)\nprint(p[\"pr<|>",
            expect: "price",
        },
        BenchCase {
            doc: "p = fetch_product(sku)\nprint(p[\"st<|>",
            expect: "stock",
        },
        // ④ 用户实例属性
        BenchCase {
            doc: "u = get_user(uid)\nprint(u.<|>",
            expect: "name",
        },
        BenchCase {
            doc: "u = get_user(uid)\nprint(u.<|>",
            expect: "email",
        },
        BenchCase {
            doc: "u = get_user(uid)\nprint(u.em<|>",
            expect: "email",
        },
        BenchCase {
            doc: "u = get_user(uid)\nprint(u.ro<|>",
            expect: "roles",
        },
        // ⑤ for 循环变量（P3-T08 补强）
        BenchCase {
            doc: "for u in list_users():\n    print(u.<|>",
            expect: "name",
        },
        BenchCase {
            doc: "for u in list_users():\n    print(u.<|>",
            expect: "email",
        },
        // ⑥ 函数参数类型观测
        BenchCase {
            doc: "def handle_order(order):\n    return order.<|>",
            expect: "id",
        },
        BenchCase {
            doc: "def handle_order(order):\n    return order.<|>",
            expect: "customer",
        },
    ];

    let mut hit = 0usize;
    let mut miss: Vec<&str> = Vec::new();
    // 记录每个评测点的实际排名（None = 未进 top-5），既用于工作单也便于失败定位
    let mut ranks: Vec<Option<usize>> = Vec::with_capacity(cases.len());
    for c in cases {
        let (line, col) = cursor_of(c.doc);
        let text = c.doc.replace("<|>", "");
        let cands = complete(&idx, &text, line, col);
        let top5: Vec<&str> = cands.iter().take(5).map(|x| x.label.as_str()).collect();
        let rank = top5.iter().position(|l| *l == c.expect);
        if rank.is_some() {
            hit += 1;
        } else {
            miss.push(c.expect);
        }
        ranks.push(rank);
    }
    let total = cases.len();
    let rate = hit as f64 / total as f64;
    println!(
        "[bench] 运行时补全准确率: {hit}/{total} = {:.1}%",
        rate * 100.0
    );
    if !miss.is_empty() {
        println!("[bench] 未命中: {miss:?}");
    }
    // 人工对标工作单（Gate D 剩余项 1）：仅在显式设 OC_GATE_D_WORKLIST 时写文件
    if let Ok(path) = std::env::var("OC_GATE_D_WORKLIST") {
        if !path.trim().is_empty() {
            dump_worklist(path.trim(), cases, &ranks);
            println!("[bench] 人工对标工作单已导出: {}", path.trim());
        }
    }
    assert!(
        rate >= 0.85,
        "运行时补全准确率 {:.1}% 低于 85% 红线",
        rate * 100.0
    );
}

/// stale 降权参数被钉住：`STALE_HITS_DIVISOR` 不得被改回裸字面量或悄悄变更。
///
/// 为什么要这条：`runtime_completion_accuracy` 的 seed **全部 stale=0**
/// （`bench_seed()`），所以 23 个评测点对降权策略**零覆盖**——100% 分数
/// 无法证明降权行为正确或合理。参数一旦被改回字面量，也没有任何测试会失败。
/// 本用例补上这个空白：同一 hits 下 stale 候选必须排在新鲜候选之后。
#[test]
fn stale_candidates_rank_below_fresh_ones() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stale.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        // 同样 hits=40，一个 fresh 一个 stale —— 排序差异必须只由 stale 标记决定
        for (lineno, qual, stale) in [(1, "fresh_fn", 0), (2, "stale_fn", 1)] {
            conn.execute(
                    "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py',?1,?2,40,?3)",
                    rusqlite::params![qual, lineno, stale],
                )
                .unwrap();
        }
    }
    let idx = TraceIndex::open(&path).unwrap();

    // 直接取符号候选的原始 score（同模块私有函数），避免受补全入口的
    // 光标/前缀判定与 MAX_CANDIDATES 截断影响 —— 本用例只验降权语义。
    let cands = symbol_candidates(&idx, &[], "");
    let score_of = |label: &str| {
        cands
            .iter()
            .find(|c| c.label == label)
            .unwrap_or_else(|| panic!("{label} 应在符号候选中，实际 {:?}", cands))
            .score
    };
    let (fresh, stale) = (score_of("fresh_fn"), score_of("stale_fn"));

    assert_eq!(fresh, 40, "新鲜候选分数应等于原 hits");
    assert_eq!(
        stale,
        40 / STALE_HITS_DIVISOR,
        "stale 候选分数应等于 hits / STALE_HITS_DIVISOR"
    );
    assert!(
        stale < fresh,
        "同 hits 下 stale 必须排后（fresh={fresh} stale={stale}）"
    );
    // 参数语义：除数是整数除法，必须 >=2 才不会把 stale 抬到与 fresh 同分
    assert!(
        STALE_HITS_DIVISOR >= 2,
        "除数 <2 会使 stale 与 fresh 同分，降权失效"
    );
    // stale 只降权、不隐藏 —— 降权是排序手段，不是可见性开关
    assert!(
        cands
            .iter()
            .any(|c| c.label == "stale_fn" && c.detail.contains("stale")),
        "stale 候选应仍在列表中并带 · stale 标注"
    );
}

/// CR-12：jmespath 调用识别收窄——re.search 不再误判，正常补全不被吞。
#[test]
fn jmespath_detection_narrowed() {
    // 判定函数本身：正例
    assert!(is_jmespath_call_prefix("result = jmespath.search("));
    assert!(is_jmespath_call_prefix("result = jmespath.compile("));
    assert!(is_jmespath_call_prefix(
        "result = jmespath.compile(\"a\").search("
    ));
    assert!(is_jmespath_call_prefix("result = compile(\"a\").search("));
    // 判定函数本身：负例（曾误命中）
    assert!(!is_jmespath_call_prefix("result = re.search("));
    assert!(!is_jmespath_call_prefix("result = re.compile("));
    assert!(!is_jmespath_call_prefix("result = search("));
    assert!(!is_jmespath_call_prefix("result = compile("));
    assert!(!is_jmespath_call_prefix("x = myobj.compile("));
    assert!(!is_jmespath_call_prefix("x = myobj.search("));

    // 端到端（补全）：re.search 路径串内不触发 jmespath 补全（原被吞，正常补全失效）
    let idx = jmespath_fixture();
    let text = "quotes = get_quotes()\nresult = re.search(\"data.dff\", quotes)";
    let l2 = text.lines().nth(1).unwrap();
    let col = l2.find("dff").unwrap() as u32 + 2;
    let cands = complete(&idx, text, 1, col);
    assert!(
        !cands.iter().any(|c| c.label == "diff"),
        "re.search 不应触发 jmespath 补全，实际 {cands:?}"
    );

    // 端到端（补全）：jmespath.search 正常触发
    let text2 = "quotes = get_quotes()\nresult = jmespath.search(\"data.d\", quotes)";
    let l2b = text2.lines().nth(1).unwrap();
    let col2 = l2b.find("data.d").unwrap() as u32 + 6;
    let cands2 = complete(&idx, text2, 1, col2);
    assert!(
        cands2.iter().any(|c| c.label == "diff"),
        "jmespath.search 应补 diff，实际 {cands2:?}"
    );
}

/// jmespath 测试索引：get_quotes() → dict{data: dict{k: diff: list{e: dict{k: code}}}}。
fn jmespath_fixture() -> TraceIndex {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','get_quotes',1,10,0)",
                [],
            )
            .unwrap();
        conn.execute(
                r#"INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, object]','{"data":{"t":"dict","k":{"diff":{"t":"list","e":{"t":"dict","k":{"code":"str"}}}}}}',7)"#,
                [],
            )
            .unwrap();
    }
    TraceIndex::open(&path).unwrap()
}

// ---------- A3① 调用实参补全 ----------

/// 调用实参测试索引：`scraper.parse_page(url, timeout, retries)`，
/// 参数位观测 url:str ×10 / timeout:int ×7 / retries:int ×4。
fn call_fixture() -> TraceIndex {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('scraper.py','scraper.parse_page',1,12,0)",
                [],
            )
            .unwrap();
        for (arg, ty, c) in [
            ("url", "str", 10),
            ("timeout", "int", 7),
            ("retries", "int", 4),
        ] {
            conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,?1,?2,'',?3)",
                rusqlite::params![arg, ty, c],
            )
            .unwrap();
        }
        conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict[str, int]','[\"title\"]',4)",
                [],
            )
            .unwrap();
    }
    TraceIndex::open(&path).unwrap()
}

/// `foo(|` → 全部参数名候选，insertText 为 `name=`。
#[test]
fn completes_params_after_open_paren() {
    let idx = call_fixture();
    let doc = "scraper.parse_page(";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(cands.len(), 3, "{cands:?}");
    assert!(labels.contains(&"url") && labels.contains(&"timeout") && labels.contains(&"retries"));
    for c in &cands {
        assert_eq!(c.kind, CandidateKind::Param);
        assert_eq!(
            c.insert_text.as_deref(),
            Some(format!("{}=", c.label).as_str())
        );
        assert!(c.detail.contains("⟳ runtime"), "{}", c.detail);
    }
    // 证据数降序：url(10) > timeout(7) > retries(4)
    assert_eq!(labels, vec!["url", "timeout", "retries"]);
}

/// 已按 keyword 写出的参数被排除（且字符串里的逗号不参与切分）。
#[test]
fn excludes_written_keyword_params() {
    let idx = call_fixture();
    let doc = r#"scraper.parse_page(url="a, b", "#;
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels.len(), 2, "{cands:?}");
    assert!(!labels.contains(&"url"), "已写 keyword 应排除：{labels:?}");
}

/// 已按位置写出的参数按观测顺序前跳。
#[test]
fn skips_written_positional_params() {
    let idx = call_fixture();
    let doc = r#"scraper.parse_page("http://x", "#;
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    // 位置参数已消耗 1 个（url），剩余按证据降序：timeout(7) > retries(4)
    assert_eq!(labels, vec!["timeout", "retries"]);
}

/// 观测缺位场景的前跳钳制（2026-10-08 review P1）：签名首个参数位无观测时，
/// 观测序整体前移——固定按 `i < positional` 跳会错误清空候选（多跳），
/// 钳到 min(positional, 观测数) 后宁可多给一个已填参数，候选集不清空。
#[test]
fn positional_skip_clamped_when_observations_missing() {
    // fixture：签名事实上是 (a, timeout, retries)，但 a 位从未被观测（只在
    // 调用处传值、无类型记录）——arg_types 里只有 timeout/retries 两条
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('scraper.py','scraper.parse_page',1,12,0)",
                [],
            )
            .unwrap();
        for (arg, ty, c) in [("timeout", "int", 7), ("retries", "int", 4)] {
            conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,?1,?2,'',?3)",
                rusqlite::params![arg, ty, c],
            )
            .unwrap();
        }
    }
    let idx = TraceIndex::open(&path).unwrap();
    // 用户已写 1 个位置参数（填的是缺观测的 a 位）：f(x, |
    let doc = r#"scraper.parse_page(123, "#;
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    // 修复前：i=0(timeout) < positional(1) 被跳 → 候选只剩 retries（系统性多跳）
    // 修复后：min(1, 2)=1 仍跳 1 个但候选集按证据序保留——本例 timeout 依然
    // 被跳（无法确定 a 位缺观测），但观测列表更短时不会被清空：
    assert_eq!(
        labels,
        vec!["retries"],
        "钳制后候选按证据序保留：{labels:?}"
    );

    // 关键回归面：positional >= 观测数时（写满 2 个位置参数后）不再「全部跳光」
    // 之外还错位——min 钳制保证 skip 恒 ≤ 观测数，行为可预期：
    let doc2 = r#"scraper.parse_page(123, 456, "#;
    let cands2 = complete(&idx, doc2, 0, doc2.len() as u32);
    assert!(
        cands2.iter().all(|c| c.kind != CandidateKind::Param) || cands2.is_empty(),
        "写满观测数后无参数候选：{:?}",
        cands2.iter().map(|c| c.label.clone()).collect::<Vec<_>>()
    );
}

/// 前缀过滤 + 只有「方法 + 括号」时不误伤：`foo(ur` → 只剩 url。
#[test]
fn filters_params_by_prefix() {
    let idx = call_fixture();
    let doc = "scraper.parse_page(ur";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(cands.len(), 1, "{cands:?}");
    assert_eq!(cands[0].label, "url");
}

/// 类构造：`Cls(` → `Cls.__init__` 的参数观测。
#[test]
fn completes_class_constructor_params() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('m.py','Scraper.__init__',1,6,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'session','requests.Session','',6)",
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();
    let doc = "Scraper(";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(cands.len(), 1, "{cands:?}");
    assert_eq!(cands[0].label, "session");
}

/// TD-027 A8 回归：`mymod.Scraper(`（模块前缀写法）→ 命中 trace 的 `Scraper.__init__`
/// （probe 的 co_qualname 不含模块路径，旧精确匹配拼出 `mymod.Scraper.__init__` 永不命中）。
#[test]
fn completes_class_constructor_via_module_prefix() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('mymod/scraper.py','Scraper.__init__',1,6,0)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'session','requests.Session','',6)",
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();
    let doc = "mymod.Scraper(";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(cands.len(), 1, "模块前缀形态必须命中：{cands:?}");
    assert_eq!(cands[0].label, "session");
}

/// TD-027 A8 回归：多文件同名类时按 (非 stale, hits) 裁决，段边界不误伤
/// （`Scraper.__init__` 的后缀不命中 `MyScraper.__init__`）。
#[test]
fn class_constructor_init_suffix_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        // 同名类两处：b.py 的非 stale + 高 hits 应胜出；a.py 的 stale 低 hits 落选
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('a.py','Scraper.__init__',1,3,1)",
                [],
            )
            .unwrap();
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('b.py','Scraper.__init__',1,9,0)",
                [],
            )
            .unwrap();
        conn.execute(
            "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'from_a','int','',3)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(2,'from_b','str','',9)",
            [],
        )
        .unwrap();
        // 段边界负例：`MyScraper.__init__` 不应被 `Scraper.__init__` 后缀命中
        conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('c.py','MyScraper.__init__',1,99,0)",
                [],
            )
            .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();
    // 补全路径：多候选裁决（非 stale + 高 hits 胜出）
    let doc = "Scraper(";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(cands.len(), 1, "{cands:?}");
    assert_eq!(cands[0].label, "from_b");
    // 后缀段边界：MyScraper( 不误吃 Scraper.__init__ 的观测
    let doc2 = "MyScraper(";
    let cands2 = complete(&idx, doc2, 0, doc2.len() as u32);
    assert!(
        cands2.iter().all(|c| c.kind != CandidateKind::Param),
        "段边界不得误伤：{cands2:?}"
    );
}

/// 上下文判定：字符串内 / 分组括号 / 定义语句 / 非调用括号 → 不出参数补全。
#[test]
fn call_ctx_negative_cases() {
    // 光标在字符串内
    assert_eq!(call_ctx_at(r#"foo("a"#, 0, 6), None);
    // 分组括号（前无标识符）
    assert_eq!(call_ctx_at("x = (a + b", 0, 10), None);
    // def / class 定义
    assert_eq!(call_ctx_at("def foo(", 0, 8), None);
    assert_eq!(call_ctx_at("class Foo(", 0, 10), None);
    // 下标而非调用
    assert_eq!(call_ctx_at("data[", 0, 5), None);
    // 无括号
    assert_eq!(call_ctx_at("foo", 0, 3), None);
    // 正向：`foo(` 命中，callee 取到点链
    let ctx = call_ctx_at("x = scraper.parse_page(", 0, 24).unwrap();
    assert_eq!(ctx.callee, "scraper.parse_page");
    assert_eq!(ctx.segment, "");
    assert!(ctx.keywords.is_empty() && ctx.positional == 0);
}

/// 光标所在段是点链 / 嵌套调用时让位给其余补全分支。
#[test]
fn call_ctx_defers_on_non_ident_segment() {
    // `foo(a.` → 交给点链（属性补全）
    assert_eq!(call_ctx_at("foo(a.", 0, 6), None);
    // `foo(bar(` → 最内层是 bar 的括号
    let ctx = call_ctx_at("foo(bar(", 0, 8).unwrap();
    assert_eq!(ctx.callee, "bar");
}

/// callee 无运行时观测时不拦截：回落符号补全（`print(` / 未跑过的函数）。
#[test]
fn untraced_callee_falls_back_to_symbols() {
    let idx = symbol_fixture();
    // `nope` 不在 trace 里 → 不产出参数候选，回落符号补全（`parse_p` 前缀命中两个）
    let doc = "nope(parse_p";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels: Vec<&str> = cands.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, vec!["parse_page", "parse_pages"], "{cands:?}");
    assert!(cands.iter().all(|c| c.kind == CandidateKind::Function));
}

/// `param_observations`：按首次出现顺序聚合，同名参数取证据最高的类型、count 求和。
#[test]
fn param_observations_orders_and_merges() {
    use montauri_intel_index::{Function, TypeObs};
    let f = Function {
        filename: "m.py".into(),
        qualname: "m.f".into(),
        lineno: 1,
        hits: 3,
        stale: false,
        args: vec![
            TypeObs {
                arg: "b".into(),
                type_label: "int".into(),
                shape: None,
                count: 2,
            },
            TypeObs {
                arg: "a".into(),
                type_label: "str".into(),
                shape: None,
                count: 5,
            },
            TypeObs {
                arg: "b".into(),
                type_label: "str".into(),
                shape: None,
                count: 9,
            },
        ],
        rets: vec![],
        excs: vec![],
    };
    let obs = param_observations(&f);
    // 顺序 = 首次出现序（b 先于 a）
    assert_eq!(
        obs.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
        vec!["b", "a"]
    );
    // b 的两条观测合并：类型取证据最高（str ×9），count 求和（2+9=11）
    assert_eq!(obs[0].type_label, "str");
    assert_eq!(obs[0].count, 11);
    assert_eq!(obs[1].count, 5);
}

// ---------- P1 调用链推断（2026-10-10）----------

/// 调用链 fixture：工厂函数 / 类方法 / 类构造 / dict 形状，模拟无注解订单+爬虫项目。
fn chain_fixture() -> TraceIndex {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("chain.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let funcs = [
            // fid 1: parse_page → dict[str, str]（键 title/links）
            ("scraper.py", "parse_page", 1, 100, 0),
            // fid 2: Order.get_total → float（head 变量的方法）
            ("order.py", "Order.get_total", 2, 50, 0),
            // fid 3: Order.fmt → str
            ("order.py", "Order.fmt", 3, 30, 0),
            // fid 4: make_order → Order（工厂函数）
            ("order.py", "make_order", 4, 80, 0),
            // fid 5: Order.__init__（类构造观测存在 → Order(...) 的实例类型 = Order）
            ("order.py", "Order.__init__", 5, 80, 0),
            // fid 6: get_quotes → dict[str, object]（嵌套 shape）
            ("quotes.py", "get_quotes", 6, 60, 0),
            // fid 7: list_users → list[User]
            ("users.py", "list_users", 7, 40, 0),
            // fid 8: User.__init__
            ("users.py", "User.__init__", 8, 40, 0),
            // fid 9: User.get_name → str（通过 list 元素类型再走方法）
            ("users.py", "User.get_name", 9, 35, 0),
            // fid 10: Order 类 body 本身（probe 真实形态：qualname=Order、ret=None——
            // e2e 抓出的盲区：若类构造不优先于 ret_type_of，None 会截胡）
            ("order.py", "Order", 10, 1, 0),
        ];
        for (f, q, l, h, s) in funcs {
            conn.execute(
                "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES(?1,?2,?3,?4,?5)",
                rusqlite::params![f, q, l, h, s],
            )
            .unwrap();
        }
        let rets = [
            // parse_page → dict
            (1, "dict[str, str]", "[\"title\",\"links\"]", 100),
            // Order.get_total → float
            (2, "float", "", 50),
            // Order.fmt → str
            (3, "str", "", 30),
            // make_order → Order（实例属性 shape）
            (4, "Order", "[\"amount\",\"items\"]", 80),
            // get_quotes → 嵌套 dict
            (
                6,
                "dict[str, object]",
                "{\"data\":{\"t\":\"dict\",\"k\":{\"code\":{\"t\":\"str\"}}}}",
                60,
            ),
            // list_users → list[User]
            (7, "list[User]", "", 40),
            // User.get_name → str
            (9, "str", "", 35),
        ];
        for (fid, ty, shape, c) in rets {
            conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(?1,?2,?3,?4)",
                rusqlite::params![fid, ty, shape, c],
            )
            .unwrap();
        }
        // Order.__init__ 参数观测（对齐真实 probe 形态：self 的类型标签 = 实例类型）
        conn.execute(
            "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(5,'self','Order','',80)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(5,'amount','float','',20)",
            [],
        )
        .unwrap();
        // 类 body 行的 ret 观测 = None（probe 对类 body 的真实记录形态）
        conn.execute(
            "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(10,'None','',1)",
            [],
        )
        .unwrap();
        // User 的实例属性（User.get_name 的 receiver 是 User 实例——属性来自 rets/args 的 shape 聚合）
        conn.execute(
                "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(8,'User','[\"email\",\"name\"]',40)",
                [],
            )
            .unwrap();
    }
    TraceIndex::open(&path).unwrap()
}

fn labels_of(cands: &[Candidate]) -> Vec<&str> {
    cands.iter().map(|c| c.label.as_str()).collect()
}

/// 形态①：首段函数调用 ret → 属性补全（`parse_page(html).` → dict 键）。
/// 注：dict 类型走下标补全分支，`."` 形态在本实现下不可达——
/// 但 `parse_page(html)[0].` 的元素类型若非 dict 则可测。此处测「调用链 + 点」
/// 的核心路径：make_order(c).（类工厂 → 实例属性）。
#[test]
fn chain_call_then_attribute_factory() {
    let idx = chain_fixture();
    let doc = "o = make_order(c)\nx = make_order(c).";
    let cands = complete(&idx, doc, 1, doc.lines().nth(1).unwrap().len() as u32);
    let labels = labels_of(&cands);
    assert!(labels.contains(&"amount"), "实际 {labels:?}");
    assert!(labels.contains(&"items"), "实际 {labels:?}");
}

/// 形态②：head 变量类型 × 方法匹配 → 方法 ret 的属性（`order.get_total().`）。
#[test]
fn chain_head_var_method_then_attribute() {
    let idx = chain_fixture();
    let doc = "order = make_order(c)\ny = order.get_total().";
    let cands = complete(&idx, doc, 1, doc.lines().nth(1).unwrap().len() as u32);
    // get_total → float：无 shape → 空候选（不 crash、不误出）——此处验证不 crash
    assert!(cands.is_empty());
}

/// 形态③：类构造约定（`Order(...)` 有 `Order.__init__` 观测 → 实例类型 = Order）。
#[test]
fn chain_class_ctor_then_attribute() {
    let idx = chain_fixture();
    let doc = "x = Order(amount=1).";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    // Order 实例的属性来自 shape 聚合（User shape 有 email/name——Order 的
    // __init__ 只观测了 amount 参数）→ 应能出 amount（来自 make_order ret shape）
    let labels = labels_of(&cands);
    assert!(labels.contains(&"amount"), "实际 {labels:?}");
    assert!(labels.contains(&"items"), "实际 {labels:?}");
}

/// 形态④：调用后下标（`get_quotes()["data"]["`）沿 chain 解析嵌套 shape。
#[test]
fn chain_call_then_subscript() {
    let idx = chain_fixture();
    let doc = "x = get_quotes()[\"data\"][\"";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels = labels_of(&cands);
    assert!(labels.contains(&"code"), "实际 {labels:?}");
}

/// 形态⑤：调用链前缀过滤（`make_order(c).am` → 只剩 am 前缀候选）。
#[test]
fn chain_prefix_filter() {
    let idx = chain_fixture();
    let doc = "x = make_order(c).am";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    let labels = labels_of(&cands);
    assert!(labels.contains(&"amount"), "实际 {labels:?}");
    assert!(!labels.contains(&"items"), "实际 {labels:?}");
}

/// 降级路径：链上方法无观测（推不出类型）→ 空候选且不 crash；
/// 纯点链（无括号）行为不变（走原 dot_chain_at 路径）。
#[test]
fn chain_unknown_method_yields_empty() {
    let idx = chain_fixture();
    let doc = "x = order.no_such_method().";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert!(cands.is_empty(), "实际 {cands:?}");
}

/// parse_call_chain 单元：链形态/非链形态/实参含引号/括号不配对。
#[test]
fn call_chain_parser_shapes() {
    use super::type_infer::parse_call_chain;
    // 单调用
    assert_eq!(
        parse_call_chain("parse_page(html)"),
        Some(super::type_infer::CallChain {
            head: "parse_page".into(),
            methods: vec![]
        })
    );
    // head 点链 + 方法链
    assert_eq!(
        parse_call_chain("order.get_total(a, b).fmt()"),
        Some(super::type_infer::CallChain {
            head: "order.get_total".into(),
            methods: vec!["fmt".into()]
        })
    );
    // 嵌套括号实参
    assert_eq!(
        parse_call_chain("f(g(x))"),
        Some(super::type_infer::CallChain {
            head: "f".into(),
            methods: vec![]
        })
    );
    // 非调用（纯点链）/ 实参含引号 / 括号不配对 → None
    assert_eq!(parse_call_chain("order.get_total"), None);
    assert_eq!(parse_call_chain("f(\"a(b\")"), None);
    assert_eq!(parse_call_chain("f(g(x)"), None);
}

// ---------- P2 except 异常补全（2026-10-10）----------

fn exc_fixture() -> TraceIndex {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("exc.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        // 两个函数观测到 ValueError（跨文件复用 → 聚合求和），一个观测到模块限定异常
        conn.execute(
            "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('scraper.py','scraper.parse_page',1,12,0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('api.py','api.call',2,7,0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO exc_types(fid,exc_label,count) VALUES(1,'ValueError',3)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO exc_types(fid,exc_label,count) VALUES(2,'ValueError',2)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO exc_types(fid,exc_label,count) VALUES(2,'requests.HTTPError',4)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO exc_types(fid,exc_label,count) VALUES(2,'KeyError',1)",
            [],
        )
        .unwrap();
    }
    TraceIndex::open(&path).unwrap()
}

/// `except ValueErr` → ValueError（Exception 种类 + 观测 detail）。
#[test]
fn completes_except_by_prefix() {
    let idx = exc_fixture();
    let doc = "try:\n    call(u)\nexcept ValueErr";
    let cands = complete(&idx, doc, 2, doc.lines().nth(2).unwrap().len() as u32);
    let labels = labels_of(&cands);
    assert_eq!(labels, vec!["ValueError"], "实际 {labels:?}");
    let c = &cands[0];
    assert_eq!(c.kind, CandidateKind::Exception);
    assert!(c.detail.contains("⟳ runtime"), "{:?}", c.detail);
    assert!(c.detail.contains('5'), "跨函数 count 求和 3+2=5：{:?}", c.detail);
}

/// `except `（空前缀）→ 全部观测异常，count 降序（HTTPError 4 > ValueError 5?——
/// ValueError 聚合 5 最高，HTTPError 4 次之，KeyError 1 末位）。
#[test]
fn completes_except_empty_prefix_sorted_by_evidence() {
    let idx = exc_fixture();
    let doc = "try:\n    call(u)\nexcept ";
    let cands = complete(&idx, doc, 2, doc.lines().nth(2).unwrap().len() as u32);
    let labels = labels_of(&cands);
    assert_eq!(
        labels,
        vec!["ValueError", "requests.HTTPError", "KeyError"],
        "实际 {labels:?}"
    );
}

/// 裸前缀按标签最后段匹配：`except HTTPErr` → requests.HTTPError。
#[test]
fn completes_except_matches_last_segment() {
    let idx = exc_fixture();
    let doc = "except HTTPErr";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(labels_of(&cands), vec!["requests.HTTPError"]);
}

/// 元组形态：`except (Key` → KeyError。
#[test]
fn completes_except_tuple_form() {
    let idx = exc_fixture();
    let doc = "except (Key";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert_eq!(labels_of(&cands), vec!["KeyError"]);
}

/// 负例：as 绑定 / 冒号后 body / 字符串内 / 注释 → 不出异常候选。
#[test]
fn except_ctx_negative_cases() {
    let idx = exc_fixture();
    // `except ValueError as`（绑定名位置）→ 无 Exception 候选
    let doc = "except ValueError as";
    let cands = complete(&idx, doc, 0, doc.len() as u32);
    assert!(
        cands.iter().all(|c| c.kind != CandidateKind::Exception),
        "as 后不出异常候选：{cands:?}"
    );
    // 冒号后（body 区）
    let doc2 = "except ValueError:";
    assert_eq!(except_ctx_at(doc2, 0, doc2.len() as u32), None);
    // 字符串内
    let doc3 = r#"x = "except "#;
    assert_eq!(except_ctx_at(doc3, 0, doc3.len() as u32), None);
    // 注释行
    let doc4 = "# except ";
    assert_eq!(except_ctx_at(doc4, 0, doc4.len() as u32), None);
    // 非词边界：handle_except 不触发
    let doc5 = "handle_except ";
    assert_eq!(except_ctx_at(doc5, 0, doc5.len() as u32), None);
}
