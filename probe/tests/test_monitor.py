"""PEP 669 采集核心（P2-T02）单测：同进程直接驱动 Monitor。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from opencharm_probe.config import ProbeConfig  # noqa: E402
from opencharm_probe.monitor import Monitor  # noqa: E402
from opencharm_probe.sink import ObservationSink  # noqa: E402

ROOT = Path(__file__).resolve().parent


def _new_monitor(cfg=None):
    sink = ObservationSink()
    mon = Monitor(cfg or ProbeConfig(), sink, str(ROOT))
    return mon, sink


def _fids_by_suffix(sink, suffix: str) -> set[int]:
    """按 qualname 后缀匹配（测试内嵌函数 qualname 为 test_xxx.<locals>.name）。"""
    return {fid for (_fn, qn, _ln), fid in sink.funcs.items()
            if qn == suffix or qn.endswith("." + suffix)}


def _args_of(sink, name):
    out = {}
    fids = _fids_by_suffix(sink, name)
    for (fid, arg, t, _shape), c in sink.args.items():
        if fid in fids:
            out.setdefault(arg, {})[t] = c
    return out


def _rets_of(sink, name):
    out = {}
    fids = _fids_by_suffix(sink, name)
    for (fid, t, _shape), c in sink.rets.items():
        if fid in fids:
            out[t] = c
    return out


def _excs_of(sink, name):
    out = {}
    fids = _fids_by_suffix(sink, name)
    for (fid, e), c in sink.excs.items():
        if fid in fids:
            out[e] = c
    return out


def test_basic_args_and_return():
    mon, sink = _new_monitor()
    mon.start()

    def add(a, b=10):
        return a + b

    add(1, 2)
    add("x", "y")
    mon.stop()

    args = _args_of(sink, "add")
    assert args["a"] == {"int": 1, "str": 1}
    assert args["b"] == {"int": 1, "str": 1}
    rets = _rets_of(sink, "add")
    assert rets == {"int": 1, "str": 1}


def test_default_arg_captured():
    mon, sink = _new_monitor()
    mon.start()

    def f(x, y=99):
        return x

    f(1)
    mon.stop()
    args = _args_of(sink, "f")
    assert args["y"] == {"int": 1}  # 默认值也被捕获


def test_varargs_kwargs():
    mon, sink = _new_monitor()
    mon.start()

    def f(*args, **kwargs):
        return args

    f(1, "a", k=2)
    mon.stop()
    args = _args_of(sink, "f")
    assert args["args"] == {"tuple[int|str]": 1}
    assert args["kwargs"] == {"dict[str, int]": 1}


def test_exception_paths():
    mon, sink = _new_monitor()
    mon.start()

    def boom():
        raise ValueError("x")

    def caller():
        try:
            boom()
        except ValueError:
            pass

    caller()
    try:
        boom()  # 未捕获 → 传播出测试函数
    except ValueError:
        pass
    mon.stop()
    assert _excs_of(sink, "boom") == {"ValueError": 2}
    assert "ValueError" in _excs_of(sink, "caller")


def test_generator():
    mon, sink = _new_monitor()
    mon.start()

    def gen(n):
        for i in range(n):
            yield i
        return "done"

    g = gen(3)
    assert [next(g) for _ in range(3)] == [0, 1, 2]
    try:
        next(g)
    except StopIteration:
        pass
    mon.stop()
    args = _args_of(sink, "gen")
    assert args == {"n": {"int": 1}}
    rets = _rets_of(sink, "gen")
    assert "str" in rets  # StopIteration.value = "done"


def test_closure_and_nested():
    mon, sink = _new_monitor()
    mon.start()

    def outer(x):
        def inner(y):
            return x + y
        return inner

    inner = outer(1)
    inner(2)
    mon.stop()
    assert _args_of(sink, "outer") == {"x": {"int": 1}}
    assert _args_of(sink, "inner") == {"y": {"int": 1}}


def test_module_filter_excludes_stdlib():
    mon, sink = _new_monitor()
    mon.start()
    # 标准库函数（项目根外）不应被采集
    out = sorted("cba")
    mon.stop()
    assert out == ["a", "b", "c"]
    assert all(qn != "sorted" for _fn, qn, _ln in sink.funcs)


def test_mute_after_limit():
    cfg = ProbeConfig(max_calls_per_func=3)
    mon, sink = _new_monitor(cfg)
    mon.start()

    def hot(x):
        return x

    for i in range(10):
        hot(i)
    mon.stop()
    fids = _fids_by_suffix(sink, "hot")
    hits = [c for fid, c in sink.hits.items() if fid in fids]
    assert hits == [3]  # 超限静音：只记 3 次


def test_stop_idempotent():
    mon, _sink = _new_monitor()
    mon.start()
    mon.stop()
    mon.stop()  # 幂等


def test_active_reconcile_after_exception_leak():
    """回归（P0）：异常退出不触发 PY_RETURN，_active 只增不减。

    修复：关窗决策点用 _sync_active 从调用栈精确重算，把泄漏计数收敛到
    真实活跃帧数，避免全局 PY_START 被永久拖住（探针开销承诺失效）。
    """
    mon, sink = _new_monitor()
    mon.start()

    def boom():
        raise ValueError("x")

    for _ in range(5):
        try:
            boom()
        except ValueError:
            pass
    # 5 次异常退出：boom 的 PY_START 各 +1，但无对应 PY_RETURN → 净泄漏 +5
    assert mon._active == 5
    mon._sync_active()  # 模拟决策点校准（异常传播同样被 RAISE 归类的测试函数自身仍在栈上）
    assert mon._active == 1  # 仅剩测试函数这一帧真实活跃
    mon.stop()


def test_tool_id_released():
    import sys as _s
    mon, _sink = _new_monitor()
    mon.start()
    tid = mon._tid
    mon.stop()
    # 释放后可重新申请
    _s.monitoring.use_tool_id(tid, "reacquire-test")
    _s.monitoring.free_tool_id(tid)


# ---------- P2-T04：模块白/黑名单 ----------
# 注意：Monitor 的项目根 = probe/tests（见 _new_monitor），本文件相对路径为 test_monitor.py

def test_include_modules_whitelist():
    """白名单：仅采集匹配路径。"""
    cfg = ProbeConfig(include_modules=["test_monitor.py"])
    mon, sink = _new_monitor(cfg)
    mon.start()

    def matched(x):
        return x

    matched(1)
    mon.stop()
    assert _args_of(sink, "matched") == {"x": {"int": 1}}


def test_include_modules_excludes_unmatched():
    """白名单非空时，不匹配的路径不采集。"""
    cfg = ProbeConfig(include_modules=["src"])
    mon, sink = _new_monitor(cfg)
    mon.start()

    def elsewhere(x):
        return x

    elsewhere(1)
    mon.stop()
    assert _args_of(sink, "elsewhere") == {}


def test_exclude_modules_blacklist():
    """黑名单：匹配路径不采集（黑名单优先于白名单）。"""
    cfg = ProbeConfig(exclude_modules=["test_monitor.py"])
    mon, sink = _new_monitor(cfg)
    mon.start()

    def blocked(x):
        return x

    blocked(1)
    mon.stop()
    assert _args_of(sink, "blocked") == {}


def test_exclude_overrides_include():
    """黑名单优先于白名单：同一路径两边都匹配 → 不采集。"""
    cfg = ProbeConfig(include_modules=["test_monitor.py"],
                      exclude_modules=["test_monitor.py"])
    mon, sink = _new_monitor(cfg)
    mon.start()

    def blocked(x):
        return x

    blocked(1)
    mon.stop()
    assert _args_of(sink, "blocked") == {}


def test_glob_match_variants():
    """glob 语义：精确 / 通配 / 目录前缀（fnmatch 的 * 跨 /）。"""
    m = Monitor._glob_match
    assert m("tests/test_a.py", ("tests",))
    assert m("tests/sub/test_b.py", ("tests",))
    assert m("tests/test_a.py", ("tests/test_*.py",))
    assert m("pkg/mod.py", ("pkg/*.py",))
    assert m("pkg/sub/mod.py", ("pkg/*.py",))  # * 跨目录
    assert not m("other/mod.py", ("pkg",))
    assert not m("tests.py", ("tests",))  # 目录前缀不吞同级文件


# ---------- P2-T04：调用栈深度上限 ----------

def _frame_depth() -> int:
    """调用者帧起的栈深（含 pytest 内部帧，测试内标定基线用）。"""
    n = 0
    f = sys._getframe(1)
    while f is not None:
        n += 1
        f = f.f_back
    return n


def test_max_call_depth_limits_arg_recording():
    """超深调用：仍计 hits，但不记参数观测。"""
    base = _frame_depth()  # 测试函数处的栈深基线
    cfg = ProbeConfig(max_call_depth=base + 5)
    mon, sink = _new_monitor(cfg)
    mon.start()

    def deep(n, marker):
        if n <= 0:
            return n
        return deep(n - 1, marker)

    deep(30, "x")
    mon.stop()
    fids = _fids_by_suffix(sink, "deep")
    hits = sum(c for fid, c in sink.hits.items() if fid in fids)
    assert hits == 31  # hits 不受深度限制（deep(30)…deep(0) 共 31 次）
    args = _args_of(sink, "deep")
    # 仅浅层（栈深 ≤ base+5）调用记录参数观测：deep(30)…deep(26) 共 5 次
    assert args["marker"] == {"str": 5}


def test_max_call_depth_zero_unlimited():
    """0 = 不限深。"""
    cfg = ProbeConfig(max_call_depth=0)
    mon, sink = _new_monitor(cfg)
    mon.start()

    def deep(n, marker):
        if n <= 0:
            return n
        return deep(n - 1, marker)

    deep(30, "x")
    mon.stop()
    args = _args_of(sink, "deep")
    assert args["marker"] == {"str": 31}  # 全部 31 次调用都记录


def test_business_function_called_after_discovery_window(monkeypatch):
    """回归修复：慢 import 越过发现窗口后，业务函数首次调用仍应被采集。

    机制：项目函数（等价模块体 <module>）活跃期间（_active > 0），发现窗口不得被时间
    到期关闭；否则「外层活跃 + 库函数触发关窗检查 + 业务函数随后才首次被调用」会漏采
    （如 demo.py：import requests 耗时 > 窗口，main/get_quotes 被跳过）。
    """
    import time
    from opencharm_probe import monitor as mon_mod

    monkeypatch.setattr(mon_mod, "_DISCOVERY_WINDOW", 0.05)

    mon, sink = _new_monitor()
    mon.start()

    def outer():
        time.sleep(0.15)    # 越过缩短后的发现窗口
        len([1, 2, 3])      # 库函数：触发窗口关闭检查（活跃期间应保持开窗）
        def inner(x):
            return x
        inner(42)           # 业务函数：窗口过期后首次调用，必须被采集

    outer()
    mon.stop()
    assert _args_of(sink, "inner") == {"x": {"int": 1}}
