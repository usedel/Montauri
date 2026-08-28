//! trace 索引层集成测试：造库 → 加载 → 查询。

use opencharm_intel_index::{TraceIndex, SCHEMA};
use rusqlite::Connection;

fn seed(conn: &Connection) {
    conn.execute_batch(SCHEMA).unwrap();
    conn.execute(
        "INSERT INTO functions(filename, qualname, lineno, hits, stale) VALUES('a.py','A.foo',10,7,0)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO functions(filename, qualname, lineno, hits, stale) VALUES('b.py','B.bar',20,3,1)",
        [],
    )
    .unwrap();
    // A.foo (fid=1) 的观测：args + ret + exc
    conn.execute(
        "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'x','int','',5)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO arg_types(fid,arg,type_label,shape,count) VALUES(1,'y','dict[str,int]','[\"a\",\"b\"]',2)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'str','',8)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO exc_types(fid,exc_label,count) VALUES(1,'ValueError',1)",
        [],
    )
    .unwrap();
}

#[test]
fn loads_and_queries() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.db");
    let conn = Connection::open(&path).unwrap();
    seed(&conn);
    drop(conn);

    let idx = TraceIndex::open(&path).unwrap();
    assert_eq!(idx.len(), 2);

    let foo: Vec<_> = idx.by_qualname("A.foo").collect();
    assert_eq!(foo.len(), 1);
    let f = foo[0];
    assert_eq!(f.filename, "a.py");
    assert_eq!(f.lineno, 10);
    assert_eq!(f.hits, 7);
    assert!(!f.stale);
    assert!(f.excs.is_empty() == false);
    assert_eq!(f.excs[0].exc_label, "ValueError");

    // shape 空串归一化为 None，非空保留
    assert_eq!(f.args.len(), 2);
    assert_eq!(f.args[0].shape, None);
    assert_eq!(f.args[1].shape.as_deref(), Some("[\"a\",\"b\"]"));
    assert_eq!(f.rets.len(), 1);
    assert_eq!(f.rets[0].type_label, "str");

    // 位置查询
    let loc: Vec<_> = idx.by_location("a.py", 10).collect();
    assert_eq!(loc.len(), 1);
    assert_eq!(loc[0].qualname, "A.foo");

    // 文件查询；stale 读取正确
    let b: Vec<_> = idx.by_file("b.py").collect();
    assert_eq!(b.len(), 1);
    assert!(b[0].stale);
    assert_eq!(b[0].hits, 3);

    // 未命中
    assert_eq!(idx.by_qualname("Nope.missing").count(), 0);
    assert_eq!(idx.by_location("a.py", 999).count(), 0);
}

#[test]
fn empty_db_loads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();
    assert!(idx.is_empty());
}

#[test]
fn shape_empty_string_becomes_none_even_when_named_column_nullable() {
    // probe 端 shape 存空串；直接塞空串验证归一化（与上面用例交叉覆盖）。
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.db");
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute(
            "INSERT INTO functions(filename,qualname,lineno,hits,stale) VALUES('c.py','C.z',1,0,0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'int','',1)",
            [],
        )
        .unwrap();
    }
    let idx = TraceIndex::open(&path).unwrap();
    let f: Vec<_> = idx.by_qualname("C.z").collect();
    assert_eq!(f[0].rets[0].shape, None);
}