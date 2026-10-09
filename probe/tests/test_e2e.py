"""端到端：runner 同进程采集 + CLI run/show 闭环。"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

PROBE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROBE_ROOT / "src"))

from opencharm_probe.config import ProbeConfig  # noqa: E402
from opencharm_probe.runner import run_with_probe  # noqa: E402

SCRIPT = '''
import sys

def add(a, b=10):
    return a + b

def parse(html):
    return {"title": html, "links": ["a", "b"]}

def boom():
    raise ValueError("boom")

def main():
    add(1, 2)
    add("x", "y")
    parse("<html>")
    try:
        boom()
    except ValueError:
        pass
    print("done")

main()
'''


def _env(tmp_path):
    env = os.environ.copy()
    env["OPENCHARM_PROBE_HOME"] = str(tmp_path / "home")
    env.pop("OPENCHARM_PROBE_CONFIG", None)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def test_run_with_probe(tmp_path):
    script = tmp_path / "app.py"
    script.write_text(SCRIPT, encoding="utf-8")
    cfg = ProbeConfig(db_dir=str(tmp_path / "traces"))
    summary = run_with_probe(cfg, str(script))
    assert summary["functions"] >= 4
    assert summary["exit_code"] == 0
    assert Path(summary["db"]).is_file()


def test_run_with_probe_system_exit(tmp_path):
    script = tmp_path / "app.py"
    script.write_text("import sys\nsys.exit(3)\n", encoding="utf-8")
    cfg = ProbeConfig(db_dir=str(tmp_path / "traces"))
    summary = run_with_probe(cfg, str(script))
    assert summary["exit_code"] == 3


def test_run_with_probe_crash_still_saves(tmp_path):
    """未捕获异常：先落库再抛出（异常路径 trace 最有价值）。"""
    script = tmp_path / "app.py"
    script.write_text(
        "def boom():\n    raise ValueError('x')\nboom()\n", encoding="utf-8")
    cfg = ProbeConfig(db_dir=str(tmp_path / "traces"))
    try:
        run_with_probe(cfg, str(script))
        raised = False
    except ValueError:
        raised = True
    assert raised
    dbs = list((tmp_path / "traces").glob("*.db"))
    assert len(dbs) == 1
    conn = sqlite3.connect(dbs[0])
    try:
        excs = conn.execute("SELECT exc_label FROM exc_types").fetchall()
        # boom() 与 <module> 帧各记一次（RAISE 沿传播链触发）
        assert excs == [("ValueError",), ("ValueError",)]
    finally:
        conn.close()


def test_run_with_probe_deleted_cwd_keeps_original_error(tmp_path, monkeypatch):
    """TD-027 B5：脚本删除启动 cwd 再抛异常——原始异常必须传播（不被 chdir 失败替换）。

    runner 启动时记录 old_dir（= 启动 cwd，与脚本目录分离——Windows 不允许删进程
    当前目录，脚本运行时 cwd 已是脚本目录，删除 old_dir 合法）；finally 恢复
    old_dir 时 chdir 抛 OSError——此前会替换原始 ValueError，现在必须只降级告警。
    """
    start = tmp_path / "start"   # 启动 cwd（待删的 old_dir）
    scripts = tmp_path / "scripts"
    start.mkdir()
    scripts.mkdir()
    script = scripts / "app.py"
    script.write_text(
        "import os, shutil\n"
        "shutil.rmtree(os.environ['OLD_DIR'])\n"  # 删 runner 的 old_dir（非当前目录）
        "def boom():\n    raise ValueError('original-error')\n"
        "boom()\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OLD_DIR", str(start))
    cfg = ProbeConfig(db_dir=str(tmp_path / "traces"))
    old_cwd = os.getcwd()
    os.chdir(start)
    try:
        raised = None
        try:
            run_with_probe(cfg, str(script))
        except BaseException as e:  # noqa: BLE001 - 断言异常身份
            raised = e
        assert isinstance(raised, ValueError), (
            f"原始 ValueError 必须传播（实际 {type(raised).__name__}: {raised}）")
        assert "original-error" in str(raised)
    finally:
        os.chdir(old_cwd)  # 测试进程自身 cwd 恢复（start 已删，chdir 回 pytest 原目录）


def test_cli_run_and_show(tmp_path):
    script = tmp_path / "app.py"
    script.write_text(SCRIPT, encoding="utf-8")
    env = _env(tmp_path)
    (tmp_path / "home").mkdir()

    r = subprocess.run(
        [sys.executable, "-m", "opencharm_probe.cli", "run", str(script)],
        capture_output=True, text=True, env=env, cwd=str(PROBE_ROOT),
        encoding="utf-8", errors="replace",
    )
    assert r.returncode == 0, r.stderr
    assert "✓" in r.stdout

    r2 = subprocess.run(
        [sys.executable, "-m", "opencharm_probe.cli", "show", "add", "--project",
         str(script.parent)],
        capture_output=True, text=True, env=env, cwd=str(PROBE_ROOT),
        encoding="utf-8", errors="replace",
    )
    assert r2.returncode == 0, r2.stderr
    assert "add" in r2.stdout
    assert "int" in r2.stdout and "str" in r2.stdout

    # JSON 输出（shell/Phase 3 消费接口）
    r3 = subprocess.run(
        [sys.executable, "-m", "opencharm_probe.cli", "show", "--json", "--project",
         str(script.parent)],
        capture_output=True, text=True, env=env, cwd=str(PROBE_ROOT),
        encoding="utf-8", errors="replace",
    )
    assert r3.returncode == 0, r3.stderr
    import json
    data = json.loads(r3.stdout)
    assert any(row["qualname"] == "add" for row in data)
