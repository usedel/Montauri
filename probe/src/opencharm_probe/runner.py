"""runner：探针运行编排——start → 运行目标脚本 → stop → 落库。

同进程模式（CLI run 命令）：目标脚本无第三方依赖时直接用；
有依赖时用 inject 命令（目标项目自己的 venv + sitecustomize 注入）。
"""
from __future__ import annotations

import os
import runpy
import sys
import time

from .config import ProbeConfig
from .monitor import Monitor
from .sink import ObservationSink
from .store import save


def run_with_probe(cfg: ProbeConfig, script: str, argv: list[str] | None = None) -> dict:
    """同进程运行 script 并采集。返回摘要 dict（供 CLI/测试断言）。

    主脚本 sys.exit(code) → 摘要含 exit_code，不落 traceback；
    主脚本未捕获异常 → 先落库再原样抛出（异常路径 trace 最有价值）。
    """
    script = os.path.abspath(script)
    if not os.path.isfile(script):
        raise FileNotFoundError(script)
    if sys.version_info < (3, 12):
        raise RuntimeError(
            f"opencharm-probe 需要 Python 3.12+（sys.monitoring / PEP 669），"
            f"当前 {sys.version.split()[0]}")
    project_root = os.path.dirname(script)
    sink = ObservationSink()
    mon = Monitor(cfg, sink, project_root)

    old_argv = sys.argv
    old_dir = os.getcwd()
    old_path = list(sys.path)
    sys.argv = [script, *(argv or [])]
    os.chdir(project_root)
    # 与 `python script.py` 一致：脚本目录进 sys.path（同级 import 可用）
    sys.path.insert(0, project_root)
    wall_started = time.time()
    perf_started = time.perf_counter()
    exit_code = 0
    error: BaseException | None = None

    # CR-19：mon.start() 纳入 try/finally——若 start 抛异常（如 PEP 669 不可用），
    # sys.argv / cwd / sys.path 必须照样恢复（原 start 在 try 之外，异常路径泄漏现场）。
    try:
        mon.start()
        runpy.run_path(script, run_name="__main__")
    except SystemExit as e:
        if e.code is None:
            exit_code = 0
        elif isinstance(e.code, int):
            exit_code = e.code
        else:
            exit_code = 1
    except BaseException as e:  # noqa: BLE001 - 先落库再抛
        error = e
    finally:
        mon.stop()
        elapsed = time.perf_counter() - perf_started
        sys.argv = old_argv
        sys.path[:] = old_path
        # TD-027 B5：old_dir 被脚本删除时 chdir 抛 OSError，会替换掉 finally 链上
        # 更有价值的原始异常——单独隔离，降级为停留当前目录（不吞原始异常）。
        # 复核修复：告警前缀用纯 ASCII（[WARN]）——⚠ 不在 GBK 映射，告警 print 自身
        # 抛 UnicodeEncodeError（ValueError 子类）会逃逸 except OSError 之外，恰好
        # 复现 B5 要防的「新异常替换原始异常」（与 B7 的 _print_safe 同根）。
        try:
            os.chdir(old_dir)
        except OSError:
            print(f"[opencharm-probe][WARN] 恢复工作目录失败（{old_dir}），"
                  f"进程停留在 {os.getcwd()}", file=sys.stderr)

    # P2-3（2026-09-29 review）：save 失败只告警不吞脚本原始异常——脚本崩溃（error
    # 非 None）且落库同时失败（盘满等）时，原实现 save 的异常会替换原始异常传播，
    # 最有价值的异常路径 trace 连同原始错误一起丢失。铁律「探针失败只打警告」。
    # 复核修复：同上，⚠ 换 [WARN]（GBK 控制台下告警自身不得再抛异常）。
    try:
        path = save(cfg, sink, project_root, script, wall_started, elapsed)
    except Exception as e:  # noqa: BLE001 - 探针侧失败不吞脚本异常
        print(f"[opencharm-probe][WARN] 落库失败（观测未写入 trace 库）：{e}", file=sys.stderr)
        path = None
    if error is not None:
        raise error
    summary = {
        "db": str(path) if path is not None else "(未落库)",
        "functions": sink.func_count,
        "observations": sink.observation_count,
        "elapsed": elapsed,
        "exit_code": exit_code,
    }
    if cfg.perf_mode:
        # A2 性能模式：暴露计时样本量（样本完整度必须可见——dev plan §5.3）
        summary["perf_timed_calls"] = sum(e[0] for e in sink.perf.values())
    return summary
