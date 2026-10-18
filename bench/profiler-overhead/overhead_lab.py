"""A2 内置 Profiler —— 开销门槛实验（未立项前的可行性探针）。

⚠ 口径纪律（本脚本第二版的教训，写在这里防止第三次重犯）：
第一版把 `Monitor` 构造与 `start()` 也算进计时窗口，得到 V0 = 3.05x，而官方
`bench_probe.ps1`（同样只测脚本内部 main()，探针早已起来）给的是 ~1.5x。
**差异全部来自一次性装配成本与"发现窗口是否覆盖到被测区"**。必须有意识地选择：
- 采用官方同款口径：**只计时 workload.run，Monitor 构造 / start / stop 在窗口外**；
- 同时把「构造+start 的一次性成本」作为独立一列报出（它真实存在，但是常量，
  不应混进每次调用的倍率里——混进去会得到"越短的脚本越吃亏"的失真结论）。

倍率 = variant_min / plain_min，两者计时区同为 workload.run(rounds)。

变体一览（V2f 起的 c 结尾变体为「真实 Profiler 模式」）：
- plain                 ：裸跑，分母
- V0 probe              ：现状 Monitor（应复现官方 ~1.5x）
- V1 wrapper            ：只多做一层 Python 转发（隔离"包装本身"的成本）
- V2 timing (muted)     ：V0 + per-call 计时，**沿用默认 max_calls_per_func=200**
- V2f timing-full       ：V0 + 计时，关闭静音与类型观测（Profiler 的真实形态）
- V2p timing-full+args  ：V2f 但保留类型观测（最贵）
- V3 sampled 1/N        ：V2f + 每 N 次调用计时 1 次
- V4 stack-Nms          ：**不含现行 probe**，只跑独立采样线程（py-spy 式）
- V5 probe+stack-Nms    ：V0 之上叠加 V4
- V6 cProfile (ref)     ：参照组（产品要"对标 cProfile"，须知道它自己有多贵）

用法：
  D:\\py\\python.exe -X utf8 overhead_lab.py --rounds 2000 --reps 7
  D:\\py\\python.exe -X utf8 overhead_lab.py --json <abs-path>
"""
from __future__ import annotations

import argparse
import cProfile
import json
import os
import statistics
import sys
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_PROBE_SRC = os.path.join(_HERE, "..", "..", "probe", "src")
if _PROBE_SRC not in sys.path:
    sys.path.insert(0, _PROBE_SRC)

import workload  # noqa: E402  (sys.path 装配后方可 import)

from montauri_probe.config import ProbeConfig  # noqa: E402
from montauri_probe.monitor import Monitor  # noqa: E402
from montauri_probe.sink import ObservationSink  # noqa: E402

ROUNDS = 2000
BIG = 10 ** 9  # 事实上的"不静音"（每函数调用数上限抬到不可能触发）
BIG_WORKLOAD = False  # True → 单轮更重，用于把每函数次数压在静音阈值以下


def _wl(rounds: int):
    """统一负载入口：`--big` 时改用放大版（见 workload.run 注释）。"""
    return workload.run(rounds, big=BIG_WORKLOAD)


def _install(mon: Monitor, mode: str, stride: int, count: bool) -> dict:
    """在原回调之上套一层转发/计时包装，返回统计容器。

    t0 在 orig_start **之后**取：回调返回后函数体才执行，故"orig 完成后再
    perf_counter"计到的仍是函数体耗时；这样还能借用 orig 的分类结果
    （_code_ok / _muted），只对**项目函数**计时，库函数只付一次 dict.get。
    """
    sm = sys.monitoring
    tid = mon._tid
    orig_start = mon._on_start
    orig_return = mon._on_return
    stats = {"timed": 0, "closed": 0, "total_ms": 0.0, "calls": 0}
    stacks: dict[object, list] = {}
    counters: dict[object, int] = {}
    code_ok = mon._code_ok
    muted = mon._muted
    perf = time.perf_counter

    def bump():
        stats["calls"] += 1

    if mode == "wrapper":

        def w_start(code, offset):
            orig_start(code, offset)
            if count:
                bump()
            return None

        def w_return(code, offset, retval):
            orig_return(code, offset, retval)
            return None

    elif mode in ("timing", "sampled"):

        def w_start(code, offset):
            orig_start(code, offset)
            if count:
                bump()
            if code_ok.get(code) is True and code not in muted:
                if mode == "sampled":
                    n = counters.get(code, 0)
                    counters[code] = n + 1
                    if n % stride:
                        return None
                st = stacks.get(code)
                if st is None:
                    stacks[code] = [perf()]
                else:
                    st.append(perf())
                stats["timed"] += 1
            return None

        def w_return(code, offset, retval):
            st = stacks.get(code)
            if st:
                stats["total_ms"] += (perf() - st.pop()) * 1000.0
                stats["closed"] += 1
            orig_return(code, offset, retval)
            return None

    else:  # pragma: no cover
        raise ValueError(mode)

    mon._on_start = w_start
    mon._on_return = w_return
    sm.register_callback(tid, sm.events.PY_START, w_start)
    sm.register_callback(tid, sm.events.PY_RETURN, w_return)
    return stats


def _new_monitor(**cfg_overrides) -> Monitor:
    return Monitor(ProbeConfig(**cfg_overrides), ObservationSink(), _HERE)


def _start_sampler(interval_ms: float):
    """py-spy 式：独立线程按间隔 dump 主线程调用栈，self-time 归属栈顶帧。"""
    interval = interval_ms / 1000.0
    counts: dict[object, int] = {}
    stop = threading.Event()
    main_ident = threading.main_thread().ident

    def sampler():
        current_frames = sys._current_frames
        while not stop.wait(interval):
            f = current_frames().get(main_ident)
            if f is not None:
                counts[f.f_code] = counts.get(f.f_code, 0) + 1

    t = threading.Thread(target=sampler, daemon=True)
    t.start()
    return counts, (lambda: (stop.set(), t.join(timeout=2.0)))


def _probe_case(mode=None, stride=16, stack_ms=None, count=False, **cfg_overrides):
    """构造一个「跑一次」的 runner：start → 【计时区】workload.run → stop。"""
    def runner():
        mon = _new_monitor(**cfg_overrides)
        stats: dict = {}
        sampler: dict | None = None
        stopper = None
        mon.start()
        try:
            if mode:
                stats = _install(mon, mode, stride, count)
            if stack_ms is not None:
                sampler, stopper = _start_sampler(stack_ms)
            t0 = time.perf_counter()
            _wl(ROUNDS)
            dt = (time.perf_counter() - t0) * 1000.0
            diag = {
                "armed": len(mon._armed),
                "muted": len(mon._muted),
                "funcs": mon._sink.func_count,
                "window_open": mon._in_window,
                "active": mon._active,
            }
        finally:
            mon.stop()
            if stopper:
                stopper()
        out = dict(stats)
        out.update(dt=dt, diag=diag)
        # PR-A2-P1 原生性能模式：直接从 sink 聚合取样本量（无需 _install 包装）
        perf = getattr(mon._sink, "perf", None)
        if perf:
            out["timed"] = sum(e[0] for e in perf.values())
            out["closed"] = out["timed"]
            out["total_ms"] = sum(e[1] for e in perf.values()) / 1e6
            frames = getattr(mon, "_perf_frames", None)
            if frames is not None:
                diag["perf_stack_residue"] = len(frames)
            else:
                diag["perf_stack_residue"] = sum(
                    len(s) for s in mon._perf_stacks.values())
        if sampler is not None:
            out["stack_samples"] = sum(sampler.values())
        return out
    return runner


def _force_close_window(mon: Monitor) -> None:
    """强制关闭发现窗口（把 _active 归零、静默计数拉满）。

    注意：现有 _on_start 的非窗口分支会在「项目函数再度活跃」时**立刻重开窗口**，
    因此只关窗不够，必须同时把 mon._open_window 置空才能真正进入
    「只靠局部事件」的形态——这就是本实验要量的那个假设形态。
    """
    mon._active = 0
    mon._quiet = 10 ** 9
    mon._win_until = 0.0
    mon._win_opened_at = 0.0
    mon._maybe_close_window()


def _decomp_case(kind: str):
    """默认路径开销归因：同样的 Monitor，只改"允许哪些成本发生"。

    - full        ：现状行为（但不静音，排除 mute 造成的差异）
    - no_type     ：再关掉参数/返回的类型观测（隔离 compact 计算的成本）
    - local_only  ：先跑一遍做发现 → 禁止重开 + 关窗 → 只量「局部事件」形态
    """
    def runner():
        cfg = {"max_calls_per_func": BIG}
        if kind == "no_type":
            cfg["max_type_obs_per_site"] = 0
        mon = _new_monitor(**cfg)
        mon.start()
        if kind == "local_only":
            _wl(ROUNDS)                     # 发现期（窗口内）：不计入计时区
            mon._open_window = lambda: None   # 禁止重开发现窗口
            _force_close_window(mon)
        t0 = time.perf_counter()
        _wl(ROUNDS)
        dt = (time.perf_counter() - t0) * 1000.0
        diag = {"window_open": mon._in_window, "armed": len(mon._armed),
                "muted": len(mon._muted)}
        mon.stop()
        return {"dt": dt, "diag": diag}
    return runner


def _hits_only_case(keep_type: bool = False):
    """E1/E2：解除「hits 被静音截断在 200」的候选实现（待定，先测成本）。

    keep_type=False → E1：顺带关掉类型观测（便宜，但会丢掉 A3 补全/hover 的数据源，
    **只能当成本下界看，不能当方案**）
    keep_type=True  → E2：保留类型观测（与现状同等数据），只改静音语义 ← 真正的候选

    现状 `_mute` 会清掉该 code 的全部局部事件 → **连 hits 一起停**，于是
    `functions.hits` 恒 ≤ max_calls_per_func(=200)，热点榜 / Profiler 的 Top-N
    到 200 就分不出高下。

    候选改法：静音时**保留 PY_START、清掉 PY_RETURN**，且被静音函数走
    「只 add_hit 即返回」的极简分支 ⇒ hits 无上限，同时省掉返回回调与类型观测。

    ⚠ 已知副作用（本实验一并量进去）：没有 PY_RETURN 会让 `_active` 无法在
    return 时递减，而 `_sync_active` 只按 code_ok 计数、不看 muted ⇒ 活跃帧里
    只要有被静音的函数，发现窗口就一直被顶开（全局 PY_START 常驻，贵 ~0.39x）。
    若 E1 成本过高，下一步就是把 muted 从 `_sync_active` 的计数里排除。
    """
    def runner():
        sm = sys.monitoring
        cfg = {} if keep_type else {"max_type_obs_per_site": 0}
        mon = _new_monitor(**cfg)
        orig_start = mon._on_start
        muted = mon._muted

        def mute_keep_start(code):
            """静音但保留 PY_START：hits 继续累加。"""
            muted.add(code)
            if code in mon._armed:
                try:
                    sm.set_local_events(mon._tid, code, sm.events.PY_START)
                except ValueError:
                    pass

        def w_start(code, offset):
            if code in muted:                       # 极简分支：只计 hits
                mon._sink.add_hit(mon._fid(code))
                return None
            return orig_start(code, offset)

        mon._mute = mute_keep_start                 # 在 start() 之前打补丁
        mon._on_start = w_start
        mon.start()
        try:
            t0 = time.perf_counter()
            _wl(ROUNDS)
            dt = (time.perf_counter() - t0) * 1000.0
            diag = {"window_open": mon._in_window, "armed": len(mon._armed),
                    "muted": len(mon._muted),
                    "hits_max": max(mon._sink.hits.values()) if mon._sink.hits else 0}
        finally:
            mon.stop()
        return {"dt": dt, "diag": diag}
    return runner


def _self_case(**cfg_overrides):
    """V2p-self（PR-A2-P2 成本实验）：child_ns 帧栈的 exclusive(self) time。

    结构**与落地形态一致**（若红线通过，照此改 monitor.py）：
    - 帧栈 `list[[code, t0_ns, child_ns]]`（单栈自然 LIFO，递归/父子天然配对）；
    - PY_START 压 [code, t0, 0]；PY_RETURN 弹：dt = now - t0，父帧 child_ns += dt；
      样本 = [calls, total_ns, max_ns, excl_total_ns, excl_max_ns]，excl = dt - 本帧 child_ns；
    - PY_UNWIND：弹帧 + 累计父 child_ns，**不记样本**（与 P1 同语义）；
    - 守卫：只弹「栈顶 code 匹配」的帧（库代码的 return/unwind 不配对，异常路径非热路径）；
    - 采集逻辑逐字复用原版回调（orig_start / orig_return），与 P1 同原则。
    """
    def runner():
        mon = _new_monitor(perf_mode=True, **cfg_overrides)
        sm = sys.monitoring
        E = sm.events
        code_ok = mon._code_ok
        muted = mon._muted
        fid_of = mon._fid
        ns = time.perf_counter_ns
        orig_start = mon._on_start
        orig_return = mon._on_return
        frames: list[list] = []
        agg: dict[int, list[int]] = {}
        stats = {"timed": 0, "closed": 0, "total_ms": 0.0, "excl_ms": 0.0}

        def s_start(code, offset):
            orig_start(code, offset)
            if code_ok.get(code) is True and code not in muted:
                frames.append([code, ns(), 0])
                stats["timed"] += 1
            return None

        def s_return(code, offset, retval):
            if frames and frames[-1][0] is code:
                f = frames.pop()
                dt = ns() - f[1]
                if frames:
                    frames[-1][2] += dt
                fid = fid_of(code)
                excl = dt - f[2]
                e = agg.get(fid)
                if e is None:
                    agg[fid] = [1, dt, dt, excl, excl]
                else:
                    e[0] += 1
                    e[1] += dt
                    if dt > e[2]:
                        e[2] = dt
                    e[3] += excl
                    if excl > e[4]:
                        e[4] = excl
                stats["closed"] += 1
                stats["total_ms"] += dt / 1e6
                stats["excl_ms"] += excl / 1e6
            orig_return(code, offset, retval)
            return None

        def s_unwind(code, offset, exc):
            if frames and frames[-1][0] is code:
                f = frames.pop()
                dt = ns() - f[1]
                if frames:
                    frames[-1][2] += dt
            return None

        mon.start()
        tid = mon._tid
        # 落地形态：self 回调组整体替换 perf 回调组（三事件同换）
        sm.register_callback(tid, E.PY_START, s_start)
        sm.register_callback(tid, E.PY_RETURN, s_return)
        sm.register_callback(tid, E.PY_UNWIND, s_unwind)
        try:
            t0 = time.perf_counter()
            _wl(ROUNDS)
            dt = (time.perf_counter() - t0) * 1000.0
            diag = {"window_open": mon._in_window, "armed": len(mon._armed),
                    "muted": len(mon._muted), "funcs": mon._sink.func_count,
                    "residue": len(frames)}
        finally:
            mon.stop()
        out = dict(stats)
        out.update(dt=dt, diag=diag)
        return out
    return runner


def _plain_case():
    def runner():
        t0 = time.perf_counter()
        _wl(ROUNDS)
        return {"dt": (time.perf_counter() - t0) * 1000.0}
    return runner


def _stack_only_case(stack_ms):
    def runner():
        sampler, stopper = _start_sampler(stack_ms)
        try:
            t0 = time.perf_counter()
            _wl(ROUNDS)
            dt = (time.perf_counter() - t0) * 1000.0
        finally:
            stopper()
        return {"dt": dt, "stack_samples": sum(sampler.values())}
    return runner


def _cprofile_case():
    def runner():
        pr = cProfile.Profile()
        pr.enable()
        t0 = time.perf_counter()
        _wl(ROUNDS)
        dt = (time.perf_counter() - t0) * 1000.0
        pr.disable()
        return {"dt": dt}
    return runner


def _measure(runner, reps):
    """reps 次 → min/median；min 最接近无干扰净值（与官方 best-of-3 同口径）。"""
    best = {"dt": float("inf")}
    samples = []
    for _ in range(reps):
        r = runner()
        samples.append(r["dt"])
        if r["dt"] < best["dt"]:
            best = r
    best["median"] = statistics.median(samples)
    return best


def main() -> int:
    global ROUNDS
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=ROUNDS)
    ap.add_argument("--reps", type=int, default=7)
    ap.add_argument("--stride", type=int, default=16)
    ap.add_argument("--interval-ms", type=float, default=1.0)
    ap.add_argument("--json", dest="json_out", default=None)
    ap.add_argument("--decomp", action="store_true",
                    help="只跑默认路径开销归因（full / no_type / local_only）")
    ap.add_argument("--big", action="store_true",
                    help="用放大版负载：单轮更重，使每函数调用次数低于静音阈值（200）")
    args = ap.parse_args()
    global BIG_WORKLOAD
    BIG_WORKLOAD = args.big
    ROUNDS = args.rounds

    if args.decomp:
        cases = [
            ("plain", _plain_case(), "denominator"),
            ("D0 current (mute on)", _probe_case(), "today's default: hits capped at 200"),
            ("D1 full (no mute)", _decomp_case("full"), "current behavior, mute disabled"),
            ("D2 no type obs", _decomp_case("no_type"), "D1 minus arg/ret compaction"),
            ("D3 local events only", _decomp_case("local_only"),
             "D1 minus re-opening global PY_START"),
            ("E1 mute keeps hits", _hits_only_case(False),
             "hits unbounded, no ret cb, NO type obs (cost floor only)"),
            ("E2 mute keeps hits+type", _hits_only_case(True),
             "real candidate: same data as today + unbounded hits"),
        ]
        rows = []
        for name, runner, note in cases:
            runner()
            r = _measure(runner, args.reps)
            r.update(name=name, note=note)
            rows.append(r)
        base = rows[0]["dt"]
        print("")
        print("=== default-path overhead decomposition (rounds=%d, reps=%d) ==="
              % (args.rounds, args.reps))
        print("")
        print("%-24s %9s %9s %8s   %s"
              % ("case", "min(ms)", "med(ms)", "ratio", "note"))
        print("-" * 96)
        for r in rows:
            print("%-24s %9.1f %9.1f %8s   %s"
                  % (r["name"], r["dt"], r["median"], "%.2fx" % (r["dt"] / base), r["note"]))
        print("-" * 96)
        print("D1-D2 = cost of type observation; D1-D3 = cost of keeping global PY_START alive")
        print("")
        print("=== diagnostics ===")
        for r in rows:
            d = r.get("diag")
            if not d:
                continue
            print("  %-24s window=%-5s armed=%-3s muted=%-3s hits_max=%s"
                  % (r["name"], d.get("window_open"), d.get("armed"),
                     d.get("muted"), d.get("hits_max", "-")))
        print("-" * 96)
        print("hits_max == 200 means the mute ceiling is truncating hits (today's behavior)")
        return 0

    variants = [
        ("plain", _plain_case(), "denominator", {}),
        ("V0 probe (current)", _probe_case(), "should match official ~1.5x", {}),
        ("V1 wrapper only", _probe_case("wrapper", count=True), "cost of one extra frame", {}),
        ("V2 timing (muted)", _probe_case("timing", count=True),
         "default params: MUTE kills samples", {}),
        ("V2f timing-full", _probe_case("timing", max_calls_per_func=BIG,
                                        max_type_obs_per_site=0, count=True),
         "true profiler mode: no mute, no type obs", {"primary": True}),
        ("V2p timing-full+args", _probe_case("timing", max_calls_per_func=BIG, count=True),
         "full calls AND keep type obs", {}),
        ("V2n native perf-mode", _probe_case(perf_mode=True),
         "PR-A2-P1 shipped impl (registered cb set)", {"primary": True}),
        ("V2p-self excl.time", _self_case(),
         "PR-A2-P2: child_ns frame stack (exclusive time)", {"primary": True}),
        ("V3 sampled 1/%d" % args.stride,
         _probe_case("sampled", args.stride, max_calls_per_func=BIG,
                     max_type_obs_per_site=0, count=True),
         "statistical: time every Nth call", {}),
        ("V4 stack %.3gms only" % args.interval_ms, _stack_only_case(args.interval_ms),
         "py-spy style, WITHOUT today's probe", {}),
        ("V5 probe+stack %.3gms" % args.interval_ms,
         _probe_case(stack_ms=args.interval_ms), "sampling on top of today's probe", {}),
        ("V6 cProfile (ref)", _cprofile_case(), "reference: what we claim to beat", {}),
    ]

    rows = []
    for name, runner, note, flags in variants:
        runner()  # warm-up
        r = _measure(runner, args.reps)
        r.update(name=name, note=note, flags=flags)
        rows.append(r)
    base = rows[0]["dt"]

    print("")
    print("=== A2 Profiler overhead gate (rounds=%d, reps=%d, stride=%d) | caliber: workload only ==="
          % (args.rounds, args.reps, args.stride))
    print("")
    print("%-26s %9s %9s %8s   %s" % ("variant", "min(ms)", "med(ms)", "ratio", "note"))
    print("-" * 104)
    for r in rows:
        r["ratio"] = r["dt"] / base
        print("%-26s %9.1f %9.1f %8s   %s"
              % (r["name"], r["dt"], r["median"], "%.2fx" % r["ratio"], r["note"]))
    print("-" * 104)
    print("Gate C red line: < 1.5x (official caliber = inside-script main() timing)")
    print("")
    print("=== diagnostics / sample quality ===")
    print("%-26s %8s %8s %7s   %s"
          % ("variant", "timed", "closed", "sum(ms)", "armed/muted/funcs/window/active"))
    print("-" * 104)
    for r in rows:
        if "timed" not in r and "stack_samples" not in r:
            continue
        diag = r.get("diag", {})
        extra = "%d/%d/%d/%s/%s" % (diag.get("armed", 0), diag.get("muted", 0),
                                    diag.get("funcs", 0), diag.get("window_open", "-"),
                                    diag.get("active", "-"))
        if "timed" in r:
            print("%-26s %8d %8d %8.1f   %s"
                  % (r["name"], r["timed"], r["closed"], r["total_ms"], extra))
        else:
            print("%-26s %8s %8s %8s   stack_samples=%d"
                  % (r["name"], "-", "-", "-", r["stack_samples"]))
    print("-" * 104)
    print("expected timed calls = %d (rounds x 3 project funcs); lower => mute truncated samples"
          % (args.rounds * 3))

    if args.json_out:
        payload = {
            "schema": "montauri-a2-overhead-lab/2",
            "caliber": "inside-script workload only (matches bench_probe.ps1)",
            "rounds": args.rounds,
            "reps": args.reps,
            "stride": args.stride,
            "interval_ms": args.interval_ms,
            "python": sys.version.split()[0],
            "variants": [{"name": r["name"], "note": r["note"], "min_ms": r["dt"],
                          "median_ms": r["median"], "ratio": r["ratio"]} for r in rows],
        }
        with open(args.json_out, "w", encoding="utf-8", newline="") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("\nJSON -> %s" % args.json_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
