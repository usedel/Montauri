"""PEP 669 采集核心（P2-T02）。

基于 sys.monitoring（Python 3.12+）。

**事件策略（开销关键设计）**：
- 全局 PY_START 仅在「发现窗口」内开启：分类每个被调用的 code，
  对项目内函数 arm 局部 PY_RETURN；窗口结束关全局事件。
- 之后采集完全靠局部事件（OR 语义：全局+局部同开不双触发）。
  局部事件只对项目内函数派发回调，库代码零派发——这是开销达标的核心。
- 自适应关窗：连续 _QUIET_CLOSE 次派发无新函数发现即提前关窗
  （短脚本不再傻等时间窗口）；周期性重开窗口捕获新函数。

实测确认的语义（2026-08-21，Python 3.13.7）：
- PY_START 回调内 sys._getframe(1) 即被监控函数帧，f_locals 已含实参+默认值；
- 返回 MISSING 对全局事件无效（不能用于禁用），过滤只能在回调内快速返回；
- 全局与局部同开为 OR 语义（单次触发），局部事件可安全替代全局；
- RAISE 沿异常传播链每帧触发一次；C 层异常（KeyError 等）也触发；
  生成器耗尽的 StopIteration 不触发（C 层直接抛出）；
- 生成器：PY_START 首次 resume 触发一次，PY_RETURN 在 StopIteration 触发。

限流（P2-T04）：
- 模块过滤：仅采集项目根目录内的文件（venv/site-packages/标准库/探针自身排除）；
- 模块白/黑名单：include/exclude_modules，相对项目根的 glob（黑名单优先）；
- 每函数调用数上限：超限后清局部事件并静音（高频降采样）；
- 调用栈深度上限：超限只计 hits 不记参数观测（静音兜底不受影响）；
- 每参数位/返回位类型观测上限：边际价值递减，超限跳过 compact 计算。
"""
from __future__ import annotations

import os
import sys
import time
import types
from fnmatch import fnmatch

from .compact import compact_type, shape_fingerprint, type_label
from .config import ProbeConfig
from .sink import ObservationSink

_TOOL_IDS = (5, 4, 3, 2, 1, 0)  # 回退链：debugger 常占低位，从高位申请

# 参数名提取所需的 code 标志
_CO_VARARGS = 0x04
_CO_VARKEYWORDS = 0x08

# 发现窗口参数
_DISCOVERY_WINDOW = 2.0      # 启动后全局事件开启时长上限（秒）
_QUIET_CLOSE = 2000          # 连续 N 次派发无新函数即提前关窗
_REDISCOVERY_INTERVAL = 5.0  # 窗口关闭后多久重开一次（秒）


class Monitor:
    """sys.monitoring 探针：start() 后采集，stop() 幂等可重复调用。"""

    def __init__(self, cfg: ProbeConfig, sink: ObservationSink, project_root: str) -> None:
        self._cfg = cfg
        self._sink = sink
        self._root = os.path.normpath(os.path.realpath(project_root))
        self._tid: int | None = None
        self._dir_ok: dict[str, bool] = {}      # 目录 → 是否采集（分类缓存）
        self._code_ok: dict[types.CodeType, bool] = {}  # code → 是否采集
        self._armed: set[types.CodeType] = set()          # 已开局部事件的 code
        self._muted: set[types.CodeType] = set()          # 超限静音的 code
        self._own_files = _own_source_files()
        self._include = tuple(cfg.include_modules or ())  # 白名单 glob（空 = 不启用）
        self._exclude = tuple(cfg.exclude_modules or ())  # 黑名单 glob（优先于白名单）
        # 发现窗口状态
        self._win_until = 0.0        # 当前窗口关闭时刻（perf_counter）
        self._next_win = 0.0         # 下次窗口开启时刻
        self._in_window = False
        self._quiet = 0              # 连续无新函数的派发计数
        # 活跃的项目内调用数（进入 +1、返回 -1）：>0 时保持发现窗口开启，
        # 否则「模块顶部慢 import + 末尾才调用业务函数」的脚本会被 2s 时间窗漏采。
        # 注意：异常退出/静音/未耗尽生成器会造成计数漂移，靠 _sync_active 在决策点校准。
        self._active = 0

    # -- 生命周期 ---------------------------------------------------------

    def start(self) -> None:
        if self._tid is not None:
            return
        sm = sys.monitoring
        tid = None
        for cand in _TOOL_IDS:
            try:
                sm.use_tool_id(cand, "opencharm-probe")
                tid = cand
                break
            except ValueError:
                continue
        if tid is None:
            raise RuntimeError("sys.monitoring 无可用 tool id（0-5 全被占用）")
        self._tid = tid
        E = sm.events
        sm.register_callback(tid, E.PY_START, self._on_start)
        sm.register_callback(tid, E.PY_RETURN, self._on_return)
        sm.register_callback(tid, E.RAISE, self._on_raise)
        self._open_window()

    def stop(self) -> None:
        if self._tid is None:
            return
        sm = sys.monitoring
        E = sm.events
        tid = self._tid
        self._tid = None
        sm.set_events(tid, 0)
        for ev in (E.PY_START, E.PY_RETURN, E.RAISE):
            sm.register_callback(tid, ev, None)
        # 清掉本工具开过的局部事件（armed 集合内的 code）
        for code in self._armed:
            try:
                sm.set_local_events(tid, code, 0)
            except ValueError:
                pass  # code 已失效
        sm.restart_events()
        sm.free_tool_id(tid)
        self._armed.clear()
        self._muted.clear()

    # -- 发现窗口 ---------------------------------------------------------

    def _open_window(self) -> None:
        """开启全局 PY_START 发现窗口（RAISE 常开，不受窗口控制）。"""
        now = time.perf_counter()
        self._win_until = now + _DISCOVERY_WINDOW
        self._next_win = self._win_until + _REDISCOVERY_INTERVAL
        self._in_window = True
        self._quiet = 0
        E = sys.monitoring.events
        sys.monitoring.set_events(self._tid, E.PY_START | E.RAISE)

    def _maybe_close_window(self) -> None:
        """窗口到期或连续无新函数则关闭全局 PY_START（RAISE 保持常开）。

        活跃项目函数（_active > 0）期间保持窗口开启——其子调用（含慢 import 后
        才首次被调用的业务函数）仍需被发现。

        _active 存在三类无法即时抵消的泄漏（异常退出不触发 PY_RETURN、静音清掉
        局部事件导致在途调用 return 不再派发、生成器未耗尽无 StopIteration）。因此
        只在「关窗决策点」（窗口到期或静默超限）做一次调用栈回溯校准（_sync_active），
        把泄漏计数收敛到真实活跃帧数，避免全局 PY_START 被永久拖住。日常派发期间
        不做回溯，保持 O(1) 热路径开销。
        """
        now = time.perf_counter()
        if now < self._win_until and self._quiet < _QUIET_CLOSE:
            return  # 未到决策点：无论 _active 大小都保持窗口（避免每派发栈回溯）
        if self._active > 0:
            self._sync_active()  # 决策点校准：修复异常/生成器/静音造成的计数泄漏
        if self._active > 0:
            return  # 确有项目函数活跃（如慢 import 中的 <module> 帧），保持窗口
        sys.monitoring.set_events(self._tid, sys.monitoring.events.RAISE)
        self._in_window = False
        self._next_win = now + _REDISCOVERY_INTERVAL

    def _sync_active(self) -> int:
        """从调用栈精确重算活跃项目函数帧数，用于修复 _active 的计数漂移。"""
        try:
            f = sys._getframe(1)
        except ValueError:
            f = None
        n = 0
        known = self._code_ok
        while f is not None:
            if known.get(f.f_code) is True:
                n += 1
            f = f.f_back
        self._active = n
        return n

    # -- 回调（性能关键路径，保持极简） -----------------------------------

    def _on_start(self, code: types.CodeType, offset: int):
        if self._in_window:
            self._quiet += 1
            self._maybe_close_window()
            ok = self._code_ok.get(code)
            if ok is None:
                ok = self._classify(code)
                self._code_ok[code] = ok
                if ok:
                    self._quiet = 0  # 发现新项目函数：重置静默计数
            if not ok:
                return None
            if code in self._muted:
                return None
            fid = self._sink.func_id(code.co_filename, code.co_qualname,
                                     code.co_firstlineno)
            if self._sink.over_limit(fid, self._cfg.max_calls_per_func):
                # 高频降采样：静音并清局部事件（此后零派发开销）
                self._mute(code)
                return None
            self._active += 1
            self._sink.add_hit(fid)
            if not self._too_deep():
                self._record_args(code, fid)
            if code not in self._armed:
                E = sys.monitoring.events
                sys.monitoring.set_local_events(self._tid, code,
                                                E.PY_START | E.PY_RETURN)
                self._armed.add(code)
            return None
        # 非窗口期：局部事件路径（仅项目内函数会走到这里）
        if code in self._muted:
            return None
        fid = self._sink.func_id(code.co_filename, code.co_qualname,
                                 code.co_firstlineno)
        if self._sink.over_limit(fid, self._cfg.max_calls_per_func):
            self._mute(code)
            return None
        self._active += 1
        self._sink.add_hit(fid)
        if not self._too_deep():
            self._record_args(code, fid)
        # 项目函数再度活跃：重开发现窗口，捕获其子调用（替代原来的周期重开）
        if not self._in_window:
            self._open_window()
        return None

    def _mute(self, code: types.CodeType) -> None:
        """静音函数：清空其全部局部事件（此后该函数零派发开销）。"""
        self._muted.add(code)
        if code in self._armed:
            try:
                sys.monitoring.set_local_events(self._tid, code, 0)
            except ValueError:
                pass
            self._armed.discard(code)

    @staticmethod
    def _glob_match(rel: str, patterns: tuple[str, ...]) -> bool:
        """glob 匹配：精确 / 通配 / 目录前缀（"tests" ≙ "tests/*"；fnmatch 的 * 跨 /）。"""
        return any(fnmatch(rel, p) or fnmatch(rel, p + "/*") for p in patterns)

    def _too_deep(self) -> bool:
        """调用栈深度是否超限（从被监控帧沿 f_back 计数，O(depth)）。

        仅在记录路径执行（未静音、未超调用上限）；深层调用仍计 hits，
        深递归函数照常触发静音兜底，不会反复遍历。
        """
        limit = self._cfg.max_call_depth
        if limit <= 0:
            return False
        try:
            f = sys._getframe(2)  # _too_deep(0) → _on_start(1) → 被监控函数(2)
        except ValueError:
            return False
        depth = 0
        while f is not None:
            depth += 1
            if depth > limit:
                return True
            f = f.f_back
        return False

    def _on_return(self, code: types.CodeType, offset: int, retval):
        self._active = max(0, self._active - 1)
        fid = self._sink.func_id(code.co_filename, code.co_qualname,
                                 code.co_firstlineno)
        if not self._sink.ret_over(fid, self._cfg.max_type_obs_per_site):
            self._sink.add_ret(fid, compact_type(retval, self._cfg.max_container_depth,
                                                 self._cfg.max_union_types,
                                                 self._cfg.sample_elems),
                               shape_fingerprint(retval))
        return None

    def _on_raise(self, code: types.CodeType, offset: int, exc):
        # 全局事件：异常传播链每帧触发一次，聚合天然去重（count 虚高无妨，Phase 3 只看类型集合）
        ok = self._code_ok.get(code)
        if ok is None:
            ok = self._classify(code)
            self._code_ok[code] = ok
        if not ok:
            return None
        fid = self._sink.func_id(code.co_filename, code.co_qualname,
                                 code.co_firstlineno)
        self._sink.add_exc(fid, type_label(type(exc)))
        return None
    # -- 内部 -------------------------------------------------------------

    def _classify(self, code: types.CodeType) -> bool:
        """是否采集该 code：项目根内 + 非探针自身源文件 + 非 venv/site-packages。"""
        fn = code.co_filename
        if not fn or fn[0] == "<":  # <string> / <anon> 等非文件
            return False
        if fn in self._own_files:
            return False
        try:
            full = os.path.normpath(os.path.realpath(fn))
        except (OSError, ValueError):
            return False
        if not (full == self._root or full.startswith(self._root + os.sep)):
            return False
        # 模块白/黑名单（P2-T04）：相对项目根的 POSIX 风格 glob，黑名单优先
        if self._include or self._exclude:
            rel = full[len(self._root):].lstrip(os.sep).replace(os.sep, "/")
            if self._include and not self._glob_match(rel, self._include):
                return False
            if self._exclude and self._glob_match(rel, self._exclude):
                return False
        # 目录级缓存：同目录的文件分类结果一致（venv/site-packages 排除）
        d = os.path.dirname(full)
        cached = self._dir_ok.get(d)
        if cached is not None:
            return cached
        parts = full[len(self._root):].split(os.sep)
        ok = not any(
            p in ("site-packages", "dist-packages", "__pypackages__")
            or p.startswith(".venv") or p == "venv"
            for p in parts if p
        )
        self._dir_ok[d] = ok
        return ok

    def _record_args(self, code: types.CodeType, fid: int) -> None:
        """从被监控帧的 f_locals 提取参数类型（不含局部变量）。"""
        try:
            frame = sys._getframe(2)  # _record_args(0) → _on_start(1) → 被监控函数(2)
        except ValueError:
            return
        if frame.f_code is not code:
            return  # 帧定位失败（理论不发生，防御）
        names = code.co_varnames
        nargs = code.co_argcount + code.co_kwonlyargcount
        flags = code.co_flags
        has_varargs = bool(flags & _CO_VARARGS)
        has_varkw = bool(flags & _CO_VARKEYWORDS)
        total = nargs + (1 if has_varargs else 0) + (1 if has_varkw else 0)
        if total == 0:
            return
        cfg = self._cfg
        limit = cfg.max_type_obs_per_site
        locals_ = frame.f_locals
        for i in range(total):
            name = names[i]
            if self._sink.arg_over(fid, name, limit):
                continue  # 该参数位观测已饱和，跳过 compact 计算
            try:
                val = locals_[name]
            except KeyError:
                continue  # 尚未绑定的参数（理论不发生：PY_START 时已全部绑定）
            self._sink.add_arg(fid, name,
                               compact_type(val, cfg.max_container_depth,
                                            cfg.max_union_types, cfg.sample_elems),
                               shape_fingerprint(val))


def _own_source_files() -> frozenset[str]:
    """探针自身源文件集合（realpath 归一化），避免自采集。"""
    here = os.path.dirname(os.path.realpath(__file__))
    files = set()
    for mod in list(sys.modules.values()):
        f = getattr(mod, "__file__", None)
        if f and f.endswith(".py"):
            try:
                rf = os.path.realpath(f)
            except (OSError, ValueError):
                continue
            if os.path.dirname(rf) == here:
                files.add(rf)
    return frozenset(files)
