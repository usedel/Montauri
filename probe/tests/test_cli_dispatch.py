"""TD-027 D13：CLI 分发层单测（_cmd_inject / _cmd_clean 的参数校验与提示路径）。

clean 函数本身有测试（test_store_manage），但 CLI 分发层（含非 .py 警告与
not_found 退出码）此前无覆盖。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PROBE_ROOT = Path(__file__).resolve().parent.parent
SRC = PROBE_ROOT / "src"
sys.path.insert(0, str(SRC))


def _env(tmp_path):
    env = os.environ.copy()
    env["MONTAURI_PROBE_HOME"] = str(tmp_path / "home")
    env.pop("MONTAURI_PROBE_CONFIG", None)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def _cli(env, *args, cwd=PROBE_ROOT):
    return subprocess.run(
        [sys.executable, "-m", "montauri_probe.cli", *args],
        capture_output=True, text=True, env=env, cwd=str(cwd),
        encoding="utf-8", errors="replace",
    )


def test_inject_without_command_returns_2(tmp_path):
    r = _cli(_env(tmp_path), "inject")
    assert r.returncode == 2
    assert "inject 需要命令" in r.stderr


def test_inject_non_py_tail_warns(tmp_path):
    """P2-6：命令尾部不是 .py 文件 → 警告 + 降级空串守卫（不崩、可运行）。"""
    r = _cli(_env(tmp_path), "inject", "--", sys.executable, "-c", "print('ok')")
    assert r.returncode == 0, r.stderr
    assert "无法从命令尾部推断" in r.stderr
    assert "ok" in r.stdout


def test_clean_missing_db_returns_2(tmp_path):
    r = _cli(_env(tmp_path), "clean", "--project", str(tmp_path / "nope"))
    assert r.returncode == 2
    assert "无 trace 库" in r.stderr


def test_clean_existing_db_reports_stats(tmp_path):
    """有库时 clean 走通并打印 runs/functions 统计（分发层不覆盖统计值本身）。

    CLI 子进程按 MONTAURI_PROBE_HOME 定位 trace 库（home/traces），
    故 save 的 db_dir 与之同根（不走 conftest 的 cfg fixture——那是另一套根）。
    """
    from montauri_probe.config import ProbeConfig
    from montauri_probe.sink import ObservationSink
    from montauri_probe.store import db_path, save

    project = tmp_path / "proj"
    project.mkdir()
    (project / "app.py").write_text("print('x')\n", encoding="utf-8")
    cfg = ProbeConfig(db_dir=str(tmp_path / "home" / "traces"))
    sink = ObservationSink()
    fid = sink.func_id(str(project / "app.py").replace("\\", "/"), "f", 1)
    sink.add_hit(fid)
    save(cfg, sink, str(project), "app.py", 1.0, 0.1)
    assert db_path(cfg, str(project)).is_file()

    r = _cli(_env(tmp_path), "clean", "--project", str(project))
    assert r.returncode == 0, r.stderr
    assert "clean 完成" in r.stdout
    assert "runs=1" in r.stdout


def test_show_missing_db_returns_2(tmp_path):
    r = _cli(_env(tmp_path), "show", "--project", str(tmp_path / "nope"))
    assert r.returncode == 2
    assert "无 trace 库" in r.stderr
