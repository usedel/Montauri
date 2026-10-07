"""一次性实证：RAISE / EXCEPTION_HANDLED 在 sys.monitoring 下的触发语义。

回答 PR-A2-P1 计时栈配对的关键问题：
1. 函数内部 try/except 捕获自己 raise 的异常 → RAISE 是否触发？（决定能否靠 RAISE pop 计时栈）
2. 异常传播出函数 → RAISE 对该函数帧触发几次？PY_RETURN 是否触发？
3. sys.monitoring.events 里有没有 PY_UNWIND。
"""
import sys

sm = sys.monitoring
tid = 5
sm.use_tool_id(tid, "raise-probe")

log = []

def on_raise(code, offset, exc):
    log.append(("RAISE", code.co_name, type(exc).__name__))

def on_ret(code, offset, val):
    log.append(("PY_RETURN", code.co_name, None))

def on_handled(code, offset, exc):
    log.append(("HANDLED", code.co_name, type(exc).__name__))

E = sm.events
print("has PY_UNWIND:", hasattr(E, "PY_UNWIND"))
print("has EXCEPTION_HANDLED:", hasattr(E, "EXCEPTION_HANDLED"))
sm.register_callback(tid, E.RAISE, on_raise)
sm.register_callback(tid, E.PY_RETURN, on_ret)
if hasattr(E, "EXCEPTION_HANDLED"):
    sm.register_callback(tid, E.EXCEPTION_HANDLED, on_handled)


def caught_inside():
    try:
        raise ValueError("inner")
    except ValueError:
        pass
    return "ok"


def propagates():
    raise KeyError("boom")


def middle():
    propagates()


sm.set_events(tid, E.RAISE | E.PY_RETURN | getattr(E, "EXCEPTION_HANDLED", 0))

print("--- case 1: internally caught ---")
log.clear()
caught_inside()
print(log)

print("--- case 2: propagates through middle to caller ---")
log.clear()
try:
    middle()
except KeyError:
    pass
print(log)

sm.set_events(tid, 0)
sm.free_tool_id(tid)
