"""实证 PY_UNWIND：是否只在「异常使帧退出」时触发（内部捕获不触发）。"""
import sys

sm = sys.monitoring
tid = 5
sm.use_tool_id(tid, "unwind-probe")

log = []
E = sm.events

def mk(name):
    def cb(code, offset, *rest):
        log.append((name, code.co_name))
    return cb

sm.register_callback(tid, E.PY_UNWIND, mk("UNWIND"))
sm.register_callback(tid, E.PY_RETURN, mk("RETURN"))


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


sm.set_events(tid, E.PY_UNWIND | E.PY_RETURN)

log.clear()
caught_inside()
print("case1 (caught inside):", log)

log.clear()
try:
    middle()
except KeyError:
    pass
print("case2 (propagates):", log)

# case 3: 生成器耗尽（StopIteration 走 C 层，probe 注释说 RAISE 不触发）
def gen():
    yield 1

log.clear()
g = gen()
next(g)
try:
    next(g)
except StopIteration:
    pass
print("case3 (gen exhaust):", log)

sm.set_events(tid, 0)
sm.free_tool_id(tid)
