"""实证：PY_UNWIND 能否作为局部事件？替代方案验证。"""
import sys

sm = sys.monitoring
tid = 5
sm.use_tool_id(tid, "local-unwind-probe")
E = sm.events


def target():
    raise ValueError("x")


code = target.__code__
for name in ("PY_UNWIND", "RAISE", "PY_RETURN", "PY_START", "EXCEPTION_HANDLED"):
    ev = getattr(E, name)
    try:
        sm.set_local_events(tid, code, ev)
        print(f"local {name}: OK")
        sm.set_local_events(tid, code, 0)
    except ValueError as e:
        print(f"local {name}: FAIL ({e})")

sm.free_tool_id(tid)
