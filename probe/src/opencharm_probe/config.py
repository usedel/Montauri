"""配置加载：默认值 ← ~/.opencharm/config/probe.json ← 环境变量/CLI 覆盖。

环境变量：
- OPENCHARM_PROBE_HOME   重定向 ~/.opencharm（测试用）
- OPENCHARM_PROBE_CONFIG 指定配置文件路径
- OPENCHARM_PROBE_QUIET  =1 时抑制摘要输出
- OPENCHARM_PROBE_PERF   =1 时开启性能模式（A2 per-call 计时，默认关）
"""
from __future__ import annotations

import json
import os
import sys
import types
import typing
from dataclasses import dataclass
from pathlib import Path
from typing import get_args, get_origin, get_type_hints


@dataclass
class ProbeConfig:
    """探针配置（全部有默认值，零配置可用）。"""

    # 类型紧凑表示（P2-T03）
    max_container_depth: int = 2   # 容器嵌套深度上限
    max_union_types: int = 3       # 容器元素类型联合上限（超出截断为 |...）
    sample_elems: int = 8          # 容器元素采样个数上限
    # 采样限流（P2-T04）
    # 每函数「类型观测」的调用数上限：超限后静音（停类型观测与返回回调），
    # 但 hits 继续累加、不再被钳在本值（热点榜/Profiler 需要无上限的调用次数）。
    max_calls_per_func: int = 200
    max_call_depth: int = 64       # 调用栈深度上限（更深只计 hits 不记参数观测；0 = 不限）
    max_type_obs_per_site: int = 100  # 每参数位/返回位类型观测上限（类型分布采样）
    # 模块白/黑名单：相对项目根的 POSIX 风格 glob（"tests" ≙ "tests/*"，* 跨目录）；
    # 白名单非空时仅采集匹配路径，黑名单优先于白名单
    include_modules: list[str] | None = None
    exclude_modules: list[str] | None = None
    # 存储
    db_dir: str | None = None      # None → <probe_home>/traces
    quiet: bool = False            # 抑制摘要输出
    # 性能模式（A2 内置 Profiler，PR-A2-P1）：开 = per-call wall-clock 计时
    # （inclusive，聚合 calls/total_ns/max_ns），实测开销 ~2.7x，**默认关**。
    # 开启时静音上限被抬开（静音对耗时统计是致命失真，见 runtime_profiler_dev_plan §3.1）。
    perf_mode: bool = False


def probe_home() -> Path:
    """OpenCharm 用户目录（可用 OPENCHARM_PROBE_HOME 重定向，测试隔离用）。"""
    env = os.environ.get("OPENCHARM_PROBE_HOME")
    if env:
        return Path(env)
    return Path.home() / ".opencharm"


def config_path() -> Path:
    env = os.environ.get("OPENCHARM_PROBE_CONFIG")
    if env:
        return Path(env)
    return probe_home() / "config" / "probe.json"


def load_config(**overrides) -> ProbeConfig:
    """加载配置：默认值 ← 配置文件 ← 环境变量 ← 显式覆盖（None 值忽略）。"""
    cfg = ProbeConfig()
    path = config_path()
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"[opencharm-probe] ⚠ 配置文件解析失败，使用默认值（{path}: {e}）",
                  file=sys.stderr)
        else:
            if isinstance(data, dict):
                # TD-027 B4：值类型校验——手写配置 `max_calls_per_func: "abc"` 此前会
                # 原样 setattr，回调内 TypeError 让探针静默失效。类型不符 → 警告 + 保默认。
                hints = get_type_hints(ProbeConfig)
                for key, val in data.items():
                    if not key.startswith("_") and hasattr(cfg, key):
                        hint = hints.get(key)
                        if hint is not None and not _matches(hint, val):
                            print(f"[opencharm-probe] ⚠ 配置项 {key} 类型不符"
                                  f"（期望 {hint}，得到 {type(val).__name__}），保留默认值",
                                  file=sys.stderr)
                            continue
                        setattr(cfg, key, val)
    if os.environ.get("OPENCHARM_PROBE_QUIET") == "1":
        cfg.quiet = True
    if os.environ.get("OPENCHARM_PROBE_PERF") == "1":
        cfg.perf_mode = True
    for key, val in overrides.items():
        if val is not None and hasattr(cfg, key):
            setattr(cfg, key, val)
    return cfg


def _matches(hint, val) -> bool:
    """值是否符合字段类型标注（dataclass 字段的运行时校验；覆盖 int/bool/str/
    list[X] 与 `X | None`，其余宽放行——校验目标是无声崩溃，不是严格类型系统）。"""
    args = get_args(hint)
    if hint is type(None):
        return val is None
    if get_origin(hint) is typing.Union or isinstance(hint, types.UnionType):
        # `X | None`（3.10+ 是 types.UnionType；Optional[X] 是 typing.Union）
        return any(_matches(a, val) for a in args)
    if hint is bool:
        return isinstance(val, bool)
    if hint is int:
        # bool 是 int 子类：int 字段不接受 bool（防 True 静默当 1）
        return isinstance(val, int) and not isinstance(val, bool)
    if hint is str:
        return isinstance(val, str)
    origin = get_origin(hint)
    if origin in (list, tuple, set, frozenset):
        if not isinstance(val, (list, tuple, set, frozenset)):
            return False
        elem = args[0] if args else None
        # 不带元素类型（裸 list）或不校验元素（采集路径不做深校验，防误杀）
        return elem is None or elem is object or all(
            _matches(elem, v) for v in val)
    return True  # 未识别的标注宽放行


