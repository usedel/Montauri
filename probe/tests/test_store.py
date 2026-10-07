"""SQLite trace 库（P2-T05）单测。"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import opencharm_probe.store as store  # noqa: E402
from opencharm_probe.config import ProbeConfig  # noqa: E402
from opencharm_probe.sink import ObservationSink  # noqa: E402
from opencharm_probe.store import _ensure_perf_columns, db_path, load_summary, project_hash, save  # noqa: E402


def _fill(sink: ObservationSink):
    fid = sink.func_id("F:/proj/scraper.py", "parse_page", 17)
    sink.add_hit(fid)
    sink.add_hit(fid)
    sink.add_arg(fid, "html", "str", None)
    sink.add_arg(fid, "html", "str", None)
    sink.add_ret(fid, "dict[str, str|list[str]]", '["links","title"]')
    fid2 = sink.func_id("F:/proj/scraper.py", "fetch", 12)
    sink.add_hit(fid2)
    sink.add_arg(fid2, "url", "str", None)
    sink.add_exc(fid2, "requests.exceptions.ConnectionError")


def test_project_hash_stable():
    a = project_hash("F:/proj")
    assert a == project_hash("F:/proj/")
    assert a == project_hash("F:\\proj")
    assert a != project_hash("F:/other")


def test_project_hash_case_insensitive():
    # tech-debt #4：Windows 路径不区分大小写，大小写变体须落到同一 trace 库键
    # （对齐 shell/src-tauri/src/file_ops.rs::project_hash 的 to_lowercase / os.path.normcase）。
    assert project_hash("F:/proj") == project_hash("f:/PROJ")
    assert project_hash("F:\\Api\\Scraper") == project_hash("f:\\api\\scraper")


def test_db_path_layout(cfg):
    p = db_path(cfg, "F:/proj")
    assert p.parent == Path(cfg.db_dir)
    assert p.name == f"{project_hash('F:/proj')}.db"


def test_save_and_accumulate(cfg):
    sink = ObservationSink()
    _fill(sink)
    path = save(cfg, sink, "F:/proj", "scraper.py", 1.0, 0.5)
    assert path.is_file()

    conn = sqlite3.connect(path)
    try:
        runs = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
        assert runs == 1
        fns = dict(conn.execute("SELECT qualname, hits FROM functions").fetchall())
        assert fns == {"parse_page": 2, "fetch": 1}
        # 非 perf_mode 运行：perf 列恒 0（默认路径零落库成本）
        perf = conn.execute(
            "SELECT perf_calls, perf_total_ns, perf_max_ns,"
            " perf_excl_total_ns, perf_excl_max_ns FROM functions"
            " WHERE qualname='parse_page'").fetchone()
        assert perf == (0, 0, 0, 0, 0)
        args = conn.execute(
            "SELECT arg, type_label, count FROM arg_types WHERE arg='html'").fetchall()
        assert args == [("html", "str", 2)]
        rets = conn.execute("SELECT type_label, shape, count FROM ret_types").fetchall()
        assert rets == [("dict[str, str|list[str]]", '["links","title"]', 1)]
        excs = conn.execute("SELECT exc_label FROM exc_types").fetchall()
        assert excs == [("requests.exceptions.ConnectionError",)]
    finally:
        conn.close()

    # 第二次运行：count 累加（「运行过的代码」沉淀观测）
    sink2 = ObservationSink()
    _fill(sink2)
    save(cfg, sink2, "F:/proj", "scraper.py", 2.0, 0.4)
    conn = sqlite3.connect(path)
    try:
        fns = dict(conn.execute("SELECT qualname, hits FROM functions").fetchall())
        assert fns == {"parse_page": 4, "fetch": 2}
        args = conn.execute(
            "SELECT count FROM arg_types WHERE arg='html'").fetchone()[0]
        assert args == 4
        runs = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
        assert runs == 2
    finally:
        conn.close()


def test_perf_columns_written_and_accumulate(cfg):
    """A2 性能模式：perf 聚合落库 + 跨运行累加 + max 取全局最大。"""
    sink = ObservationSink()
    fid = sink.func_id("F:/proj/scraper.py", "parse_page", 17)
    sink.add_hit(fid)
    sink.add_perf(fid, 1_000_000, 800_000)      # incl 1ms, excl 0.8ms
    sink.add_hit(fid)
    sink.add_perf(fid, 2_000_000, 1_500_000)    # 新一轮刷新 max
    path = save(cfg, sink, "F:/proj", "scraper.py", 1.0, 0.5)

    conn = sqlite3.connect(path)
    try:
        row = conn.execute(
            "SELECT hits, perf_calls, perf_total_ns, perf_max_ns,"
            " perf_excl_total_ns, perf_excl_max_ns FROM functions"
            " WHERE qualname='parse_page'").fetchone()
        assert row == (2, 2, 3_000_000, 2_000_000, 2_300_000, 1_500_000)
    finally:
        conn.close()

    # 第二次运行：total/calls 累加、max 取大（本轮更慢 → 全局 max 更新）
    sink2 = ObservationSink()
    fid2 = sink2.func_id("F:/proj/scraper.py", "parse_page", 17)
    sink2.add_hit(fid2)
    sink2.add_perf(fid2, 4_000_000, 3_000_000)
    save(cfg, sink2, "F:/proj", "scraper.py", 2.0, 0.4)
    conn = sqlite3.connect(path)
    try:
        row = conn.execute(
            "SELECT perf_calls, perf_total_ns, perf_max_ns,"
            " perf_excl_total_ns, perf_excl_max_ns FROM functions"
            " WHERE qualname='parse_page'").fetchone()
        assert row == (3, 7_000_000, 4_000_000, 5_300_000, 3_000_000)
    finally:
        conn.close()


def test_perf_columns_migration_on_old_db(cfg):
    """旧库（PR-A2-P3 前无 perf 列）：save 时自动 ALTER 补列，不破坏存量行。"""
    path = db_path(cfg, "F:/proj")
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE functions(fid INTEGER PRIMARY KEY, filename TEXT NOT NULL,"
        " qualname TEXT NOT NULL, lineno INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0,"
        " stale INTEGER NOT NULL DEFAULT 0, UNIQUE(filename, qualname, lineno))")
    conn.execute(
        "INSERT INTO functions(filename, qualname, lineno, hits, stale)"
        " VALUES('F:/proj/old.py', 'old_fn', 3, 5, 0)")
    conn.commit()
    conn.close()

    sink = ObservationSink()
    fid = sink.func_id("F:/proj/scraper.py", "parse_page", 17)
    sink.add_hit(fid)
    save(cfg, sink, "F:/proj", "scraper.py", 1.0, 0.5)

    conn = sqlite3.connect(path)
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(functions)")}
        assert {"perf_calls", "perf_total_ns", "perf_max_ns",
                "perf_excl_total_ns", "perf_excl_max_ns"} <= cols
        # 存量行补列回落 0
        old = conn.execute(
            "SELECT hits, perf_calls FROM functions WHERE qualname='old_fn'").fetchone()
        assert old == (5, 0)
        new = conn.execute(
            "SELECT hits, perf_calls FROM functions WHERE qualname='parse_page'").fetchone()
        assert new == (1, 0)
    finally:
        conn.close()


def test_perf_columns_migration_atomic_on_failure(tmp_path, monkeypatch):
    """迁移中途失败整组回滚：旧库不会留下半迁移状态（Issue1）。

    回归依据：sqlite3 隐式事务只对 DML（INSERT/UPDATE/DELETE/REPLACE）自动开启，
    ALTER TABLE 是 DDL 不触发——`with conn:` 里逐条 ALTER 各自持久化、中途失败
    会留下部分列；显式 BEGIN/ROLLBACK 保证「要么全加要么全不加」。
    """
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.executescript(
        "CREATE TABLE functions(filename TEXT NOT NULL, qualname TEXT NOT NULL,"
        " lineno INTEGER NOT NULL, stale INTEGER NOT NULL DEFAULT 0,"
        " UNIQUE(filename, qualname, lineno))")
    # 注入失败：第二条 ALTER 用非法 DDL（模拟迁移中断）——第一条已执行但须随事务回滚
    monkeypatch.setattr(store, "_PERF_COLUMNS", {
        "perf_calls": "perf_calls INTEGER NOT NULL DEFAULT 0",
        "perf_broken": "perf_broken INTEGER NOT NULL DEFAULT 0 BROKEN",  # 语法错误
    })
    with pytest.raises(sqlite3.OperationalError):
        _ensure_perf_columns(conn)
    # 回滚生效：第一条 perf_calls 也未留下（否则后续 INSERT 用全列名会因缺列失败）
    cols = {r[1] for r in conn.execute("PRAGMA table_info(functions)")}
    assert "perf_calls" not in cols
    conn.close()


def test_load_summary(cfg):
    sink = ObservationSink()
    _fill(sink)
    path = save(cfg, sink, "F:/proj", "scraper.py", 1.0, 0.5)
    rows = load_summary(path)
    assert len(rows) == 2
    by_name = {r["qualname"]: r for r in rows}
    pp = by_name["parse_page"]
    assert pp["hits"] == 2
    assert ("html", "str", 2) in pp["args"]
    assert pp["rets"] == [("dict[str, str|list[str]]", 1)]
    # pattern 过滤
    rows = load_summary(path, "fetch")
    assert [r["qualname"] for r in rows] == ["fetch"]
