use super::*;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-test-pytest-{tag}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    // ---------- scan 过滤 ----------

    #[test]
    fn is_test_file_name_rules() {
        assert!(is_test_file_name(Path::new("tests/test_api.py")));
        assert!(is_test_file_name(Path::new("a/api_test.py")));
        // 裸 test.py 不在 pytest 默认 python_files（test_*.py / *_test.py）内——
        // 漏检仅无骨架行，collect 落地后由子节点补齐（两段式，计划 §3.2）
        assert!(!is_test_file_name(Path::new("tests/test.py")));
        assert!(!is_test_file_name(Path::new("tests/api.py")));
        assert!(!is_test_file_name(Path::new("tests/testing.py"))); // 前缀近似但不匹配
        assert!(!is_test_file_name(Path::new("tests/test_api.txt")));
        assert!(!is_test_file_name(Path::new("tests/test_api.pyx")));
    }

    #[test]
    fn scan_filters_ignored_dirs_and_keeps_order() {
        let tmp = tmpdir("scan");
        let root = tmp.join("ws");
        std::fs::create_dir_all(root.join("tests")).unwrap();
        std::fs::create_dir_all(root.join(".venv/lib")).unwrap();
        std::fs::create_dir_all(root.join("__pycache__")).unwrap();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("tests/test_a.py"), "").unwrap();
        std::fs::write(root.join("tests/test_b.py"), "").unwrap();
        std::fs::write(root.join("src/app.py"), "").unwrap();
        std::fs::write(root.join(".venv/lib/test_c.py"), "").unwrap(); // venv 内测试文件不应出现
        std::fs::write(root.join("__pycache__/test_d.py"), "").unwrap();
        let v = scan_impl(&root.to_string_lossy()).unwrap();
        let files: Vec<String> = serde_json::from_value(v["files"].clone()).unwrap();
        assert_eq!(files, vec!["tests/test_a.py".to_string(), "tests/test_b.py".to_string()]);
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn scan_missing_dir_errors() {
        let v = scan_impl("Z:\\opencharm-no-such-dir-xyz");
        assert!(v.is_err());
    }

    /// 大仓性能哨兵：collect_files 全仓遍历 + 过滤不得退化为 O(n²)（历史教训：
    /// 选择器扫描器按行切块的假阴性）。1000 文件的量级在 debug 下也应秒级完成。
    #[test]
    fn scan_large_tree_sentinel() {
        let tmp = tmpdir("scan-large");
        let root = tmp.join("ws");
        for i in 0..50 {
            let d = root.join(format!("pkg{i}"));
            std::fs::create_dir_all(&d).unwrap();
            for j in 0..20 {
                std::fs::write(d.join(format!("test_{j}.py")), "def test_x(): pass\n").unwrap();
            }
        }
        let t0 = Instant::now();
        let v = scan_impl(&root.to_string_lossy()).unwrap();
        let files: Vec<String> = serde_json::from_value(v["files"].clone()).unwrap();
        assert_eq!(files.len(), 1000);
        assert!(t0.elapsed() < Duration::from_secs(10), "scan 1000 文件耗时 {:?}", t0.elapsed());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    // ---------- collect 输出解析 ----------

    #[test]
    fn node_id_line_rules() {
        assert!(is_node_id_line("tests/test_api.py::TestUser::test_create[1-2]"));
        assert!(is_node_id_line("tests/test_api.py::test_create"));
        assert!(is_node_id_line("  tests/test_api.py::test_create  "));
        // 告警行：.py 后是 :12
        assert!(!is_node_id_line("tests/test_api.py:12: PytestUnknownMarkWarning"));
        // 摘要行：不含 .py
        assert!(!is_node_id_line("2 tests collected in 0.5s"));
        assert!(!is_node_id_line(""));
        assert!(!is_node_id_line("no tests collected in 0.01s"));
    }

    #[test]
    fn parse_collect_nodes_filters_warnings_and_summary() {
        let out = "\
tests/test_api.py::test_create
tests/test_api.py::TestUser::test_x[1-2]
tests/test_api.py:7: PytestUnknownMarkWarning: Unknown pytest.mark.slow
============================= warnings summary ==============================
2 tests collected in 0.51s
";
        let nodes = parse_collect_nodes(out);
        assert_eq!(nodes, vec![
            "tests/test_api.py::test_create".to_string(),
            "tests/test_api.py::TestUser::test_x[1-2]".to_string(),
        ]);
    }

    #[test]
    fn parse_collect_nodes_empty_output() {
        assert!(parse_collect_nodes("").is_empty());
        assert!(parse_collect_nodes("no tests collected in 0.01s").is_empty());
    }

    #[test]
    fn detect_missing_module_variants() {
        assert_eq!(detect_missing_module("ModuleNotFoundError: No module named pytest"), Some("pytest".to_string()));
        assert_eq!(detect_missing_module("ModuleNotFoundError: No module named 'pytest'"), Some("pytest".to_string()));
        assert_eq!(detect_missing_module("ModuleNotFoundError: No module named 'requests'"), None);
        assert_eq!(detect_missing_module("some random error"), None);
    }

    // ---------- junitxml 解析 ----------

    #[test]
    fn rebuild_node_id_strips_module_prefix() {
        // 类用例：classname 带模块前缀，剥掉后点分转 ::
        assert_eq!(
            rebuild_node_id("tests/test_api.py", "tests.test_api.TestUser", "test_create"),
            "tests/test_api.py::TestUser::test_create"
        );
        // 嵌套类：点分全部转 ::
        assert_eq!(
            rebuild_node_id("tests/test_api.py", "tests.test_api.TestUser.TestInner", "test_x"),
            "tests/test_api.py::TestUser::TestInner::test_x"
        );
        // 模块级函数：classname == 模块路径 → 无类段
        assert_eq!(
            rebuild_node_id("tests/test_api.py", "tests.test_api", "test_create"),
            "tests/test_api.py::test_create"
        );
        // classname 空 → 无类段
        assert_eq!(rebuild_node_id("tests/test_api.py", "", "test_create"), "tests/test_api.py::test_create");
        // 前缀不匹配兜底：整体转 ::（不静默丢类名）
        assert_eq!(
            rebuild_node_id("tests/test_api.py", "pkg.TestUser", "test_x"),
            "tests/test_api.py::pkg::TestUser::test_x"
        );
    }

    #[test]
    fn parse_junit_failure_error_skipped_xfail() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="1" failures="1" skipped="1" tests="4" time="0.5">
    <testcase classname="tests.test_api" name="test_ok" file="tests/test_api.py" line="10" time="0.01"/>
    <testcase classname="tests.test_api.TestUser" name="test_bad" file="tests/test_api.py" line="20" time="0.02">
      <failure message="assert 1 == 2">def test_bad():
&gt;       assert 1 == 2
E       assert 1 == 2</failure>
    </testcase>
    <testcase classname="tests.test_api" name="test_err" file="tests/test_api.py" line="30" time="0.0">
      <error message="fixture &#x27;db&#x27; not found">ERROR setup</error>
    </testcase>
    <testcase classname="tests.test_api" name="test_skip" file="tests/test_api.py" line="40" time="0.0">
      <skipped type="pytest.skip" message="win only">/ 40 skip</skipped>
    </testcase>
    <testcase classname="tests.test_api" name="test_xf" file="tests/test_api.py" line="50" time="0.0">
      <skipped type="pytest.xfail" message="known bug">expected failure</skipped>
    </testcase>
  </testsuite>
</testsuites>"#;
        let cases = parse_junit_xml(xml);
        assert_eq!(cases.len(), 5);
        assert_eq!(cases[0].node_id, "tests/test_api.py::test_ok");
        assert_eq!(cases[0].status, "passed");
        assert_eq!(cases[0].duration_ms, 10);
        assert_eq!(cases[1].node_id, "tests/test_api.py::TestUser::test_bad");
        assert_eq!(cases[1].status, "failed");
        assert_eq!(cases[1].message, "assert 1 == 2");
        assert_eq!(cases[1].line, Some(20));
        assert_eq!(cases[2].status, "error");
        assert!(cases[2].message.contains("fixture 'db' not found"));
        assert_eq!(cases[3].status, "skipped");
        assert_eq!(cases[4].status, "xfail");
    }

    #[test]
    fn parse_junit_message_falls_back_to_text() {
        // 无 message 属性 → 取文本首行
        let xml = r#"<testcase classname="t.test_a" name="test_x" file="t/test_a.py" time="0.5"><failure>E   assert False
more lines</failure></testcase>"#;
        let cases = parse_junit_xml(xml);
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].status, "failed");
        assert_eq!(cases[0].message, "E   assert False");
        assert_eq!(cases[0].duration_ms, 500);
    }

    #[test]
    fn parse_junit_truncated_xml_returns_parsed_prefix() {
        // 进程被杀导致 xml 截断：已闭合的用例照常返回，畸形尾部不阻断
        let xml = r#"<testcase classname="t.a" name="test_a" file="t/a.py" time="0.1"/><testcase classname="t.b" name="test_b" file="t/b.py" time="0.2"><fail"#;
        let cases = parse_junit_xml(xml);
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].node_id, "t/a.py::test_a");
    }

    #[test]
    fn unescape_xml_numeric_entities() {
        // minidom 写引号用 &#x27; / &#39; 数字形态（pytest junitxml 实测）
        assert_eq!(unescape_xml("fixture &#x27;db&#x27; not found"), "fixture 'db' not found");
        assert_eq!(unescape_xml("a &amp; b &#34;c&#34;"), "a & b \"c\"");
        assert_eq!(unescape_xml("&#x4E2D;&#25991;"), "中文");
        assert_eq!(unescape_xml("no entity"), "no entity");
    }

    #[test]
    fn parse_junit_missing_file_attr_pytest5_degradation() {
        // pytest < 6：无 file/line 属性 → node_id 退化为 classname 展开（前端按
        // classname+name 匹配 + 静态扫描行号兜底）
        let xml = r#"<testcase classname="t.test_a" name="test_x" time="0.1"/>"#;
        let cases = parse_junit_xml(xml);
        assert_eq!(cases[0].node_id, "::t::test_a::test_x");
        assert_eq!(cases[0].file, "");
        assert_eq!(cases[0].line, None);
    }

    // ---------- result ----------

    #[test]
    fn result_impl_missing_file_returns_found_false() {
        let v = result_impl("no-such-session-xyz").unwrap();
        assert_eq!(v["found"], json!(false));
        assert_eq!(v["cases"], json!([]));
    }

    #[test]
    fn result_impl_rejects_path_traversal_session_id() {
        assert!(result_impl("../etc/passwd").is_err());
        assert!(result_impl("a/b").is_err());
    }

    // ---------- 清理 ----------

    #[test]
    fn sweep_stale_results_removes_old_xml_only() {
        let tmp = tmpdir("sweep");
        let dir = tmp.join("test-results");
        std::fs::create_dir_all(&dir).unwrap();
        let fresh = dir.join("fresh.xml");
        let stale = dir.join("stale.xml");
        std::fs::write(&fresh, "<x/>").unwrap();
        std::fs::write(&stale, "<x/>").unwrap();
        std::fs::write(dir.join("note.txt"), "keep").unwrap();
        // 把 stale 的 mtime 拨到 48h 前（std::fs::File::set_modified，Rust 1.75+——
        // 复核 P2：原版没拨 mtime，stale 被删的主路径零覆盖）
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(48 * 3600);
        let f = std::fs::OpenOptions::new().write(true).open(&stale).unwrap();
        f.set_modified(old).unwrap();
        drop(f);
        sweep_stale_results(&dir);
        assert!(fresh.exists(), "新鲜结果不得被误删");
        assert!(!stale.exists(), "超 TTL 的 xml 应被清理");
        assert!(dir.join("note.txt").exists(), "非 xml 不碰");
        std::fs::remove_dir_all(&tmp).unwrap();
    }
