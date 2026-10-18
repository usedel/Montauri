"""端到端核验：`functions.hits` 不再被 `max_calls_per_func` 钳住。

单测（probe/tests/test_monitor.py::test_mute_after_limit）只覆盖 Monitor 层；
本脚本走完整链路（CLI run → 落库 → 回读 SQLite），钉住"采集到落库"这一段。

用法：D:\\py\\python.exe -X utf8 check_hits_e2e.py [calls=1000] [limit=200]
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

_PROBE_SRC = Path(__file__).resolve().parents[2] / "probe" / "src"
if str(_PROBE_SRC) not in sys.path:
    sys.path.insert(0, str(_PROBE_SRC))


def main() -> int:
    calls = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    if calls <= limit:
        print("calls must exceed limit")
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        app = root / "app.py"
        app.write_text(
            "def hot(x):\n    return x\n\n\n"
            "def main():\n"
            "    for i in range(%d):\n        hot(i)\n\n\nmain()\n" % calls,
            encoding="utf-8",
        )
        env = dict(os.environ)
        env["PYTHONPATH"] = str(_PROBE_SRC)
        env["MONTAURI_PROBE_HOME"] = str(root / "home")
        proc = subprocess.run(
            [sys.executable, "-m", "montauri_probe.cli", "run", str(app)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",  # 子进程摘要在 GBK 控制台下可能是非 UTF-8 字节
            env=env,
            cwd=str(root),
        )
        if proc.returncode != 0:
            print(proc.stdout, proc.stderr)
            return 1
        dbs = list((root / "home" / "traces").glob("*.db"))
        if not dbs:
            print("no trace db produced")
            return 1
        conn = sqlite3.connect(str(dbs[0]))
        try:
            rows = dict(conn.execute("SELECT qualname, hits FROM functions").fetchall())
            args = conn.execute(
                "SELECT COUNT(*) FROM arg_types a JOIN functions f ON f.fid=a.fid "
                "WHERE f.qualname='hot'"
            ).fetchone()[0]
        finally:
            conn.close()

    hits = rows.get("hot", 0)
    ok = hits == calls and args <= limit
    print("calls=%d limit=%d -> hits=%d arg_obs=%d" % (calls, limit, hits, args))
    print("PASS" if ok else "FAIL")
    if not ok:
        print("  expected hits == %d (unbounded); arg_obs <= %d (type obs still throttled)"
              % (calls, limit))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
