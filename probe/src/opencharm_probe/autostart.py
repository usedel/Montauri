"""注入模式引导：进程启动即挂探针，atexit 落库。

sitecustomize 在主脚本之前执行——这里只挂监控、注册 atexit 收尾，
不接管主脚本执行（避免重复运行）。主脚本的正常退出 / sys.exit() /
未捕获异常，atexit 都会触发落库（异常路径的 trace 最有价值）。

argv[0] 守卫：multiprocessing spawn 子进程等会带着同样的环境变量重启，
但 argv[0] 不是目标脚本——跳过，避免重复采集。
"""
from __future__ import annotations

import atexit
import os
import sys
import time


def bootstrap() -> None:
    script = os.environ.get("OPENCHARM_PROBE_SCRIPT", "")
    if not script or not os.path.isfile(script):
        return  # 非目标进程（如 uv 内部调用）——静默跳过
    # argv[0] 守卫：仅主脚本进程挂探针
    try:
        if os.path.abspath(sys.argv[0]) != os.path.abspath(script):
            return
    except (IndexError, ValueError):
        return
    # PEP 669（sys.monitoring）需要 Python 3.12+：低版本明确提示后跳过采集，
    # 不让 AttributeError 从 Monitor.start() 深处冒出来（P1-BUG-003）
    if sys.version_info < (3, 12):
        print(f"[opencharm-probe] ⚠ 当前 Python {sys.version.split()[0]} < 3.12，"
              f"无 sys.monitoring（PEP 669），本次运行不采集（脚本正常运行不受影响）",
              file=sys.stderr)
        return
    from .config import load_config
    from .monitor import Monitor
    from .sink import ObservationSink
    from .store import save

    cfg = load_config()
    project_root = os.path.dirname(os.path.abspath(script))
    sink = ObservationSink()
    mon = Monitor(cfg, sink, project_root)

    wall_started = time.time()
    perf_started = time.perf_counter()
    mon.start()

    def _finalize() -> None:
        try:
            mon.stop()
            elapsed = time.perf_counter() - perf_started
            path = save(cfg, sink, project_root, script, wall_started, elapsed)
            if not cfg.quiet:
                print(f"[opencharm-probe] ✓ {sink.func_count} 函数 · "
                      f"{sink.observation_count} 类型观测 · {elapsed:.3f}s → {path}",
                      file=sys.stderr)
        except Exception as e:  # noqa: BLE001 - 落库失败绝不改写用户进程退出码
            print(f"[opencharm-probe] ⚠ 落库失败：{e}", file=sys.stderr)

    atexit.register(_finalize)
