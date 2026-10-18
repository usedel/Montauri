"""PEP 669 采集核心（P2-T02）。

基于 sys.monitoring（Python 3.12+）。

**事件策略（开销关键设计）**：
- 全局 PY_START 仅在「发现窗口」内开启：分类每个被调用的 code，
  对项目内函数 arm 局部 PY_RETURN；窗口结束关全局事件。
- 之后采集完全靠局部事件（OR 语义：全局+局部同开不双触发）。
  局部事件只对项目内函数派发回调，库代码零派发——这是开销达标的核心。
- 自适应关窗：连续 _QUIET_CLOSE 次派发无新函数发现即提前关窗
  （短脚本不再傻等时间窗口）。窗口重开由「项目函数再度活跃」驱动
  （P2-8：原 docstring 承诺的周期性重开从未实现，`_next_win` 是死字段——已清理；
  `<module>` 返回后才首次调用的函数（atexit/延迟回调）确实漏采，属已知取舍）。

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
- 每函数调用数上限：超限后静音（停类型观测与返回回调，hits 照旧累加）；
- 调用栈深度上限：超限只计 hits 不记参数观测（静音兜底不受影响）；
- 每参数位/返回位类型观测上限：边际价值递减，超限跳过 compact 计算。
"""
from __future__ import annotations

import os
import sys
import time
import types
from dataclasses import replace
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
# 静默关窗的时间地板（M4 修复）：sitecustomize 链上的第三方代码（如宿主 IDE 的
# 安全删除 shim）会在主脚本开始前的毫秒内涌入数千次库函数派发——全是「无新函数」，
# 把 _QUIET_CLOSE 配额瞬间吃光导致发现窗口误关、主脚本 0 采集（实测 PTY 注入链）。
# 要求静默关窗距 start() 至少本时长：库噪音在启动瞬间涌完，而主脚本的 <module>
# 帧一旦开始执行，_active > 0 会接管保窗——地板只挡「启动噪音」，不影响正常关窗。
_MIN_DISCOVERY_FLOOR = 0.25  # 秒


def _monitored_frame(code: types.CodeType):
    """沿 f_back 搜索 `f_code is code` 的被监控帧（perf 包装免疫，2026-10-08 review）。

    回调栈上以 code 对象身份匹配——`_on_start_perf` 等包装层多出的帧不干扰
    定位（固定 `_getframe(2)` 在包装下会取到包装帧自身）。未命中返回 None
    （防御：理论上回调总在目标帧的调用栈上执行）。
    """
    try:
        f = sys._getframe(1)  # 本函数的调用者（_record_args / _too_deep）
    except ValueError:
        return None
    while f is not None:
        if f.f_code is code:
            return f
        f = f.f_back
    return None


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
        # P2-4（2026-09-29 review）：filename 归一化缓存（code → 归一化 fid 键）。
        # func_id 的入库键此前存原始 co_filename——Windows 下大小写/分隔符变体
        #（f:/proj/app.py vs F:\Proj\app.py）会让同函数跨运行分裂多行（project_hash
        # 已在 store 侧修过同类问题，函数级漏网）。realpath+normcase 成本高，
        # 必须在 code 级缓存（回调热路径只查 dict）。
        self._code_fid_key: dict[types.CodeType, tuple[str, str, int]] = {}
        self._include = tuple(cfg.include_modules or ())  # 白名单 glob（空 = 不启用）
        self._exclude = tuple(cfg.exclude_modules or ())  # 黑名单 glob（优先于白名单）
        # 发现窗口状态
        self._win_until = 0.0        # 当前窗口关闭时刻（perf_counter）
        self._in_window = False
        self._quiet = 0              # 连续无新函数的派发计数
        self._win_opened_at = 0.0    # 当前窗口开启时刻（静默关窗的时间地板基准）
        # 活跃的项目内调用数（进入 +1、返回 -1）：>0 时保持发现窗口开启，
        # 否则「模块顶部慢 import + 末尾才调用业务函数」的脚本会被 2s 时间窗漏采。
        # 注意：异常退出/静音/未耗尽生成器会造成计数漂移，靠 _sync_active 在决策点校准。
        self._active = 0
        # A2 性能模式（PR-A2-P1 + P2）：per-call 计时的帧栈 [code, t0_ns, child_ns]。
        # **仅 perf_mode 时使用**，默认路径不触碰。单栈天然 LIFO：递归/父子配对，
        # 返回时把 dt 累计进父帧 child_ns，样本同时产出 inclusive 与 exclusive
        #（sink.perf 行 = [calls, total_ns, max_ns, excl_total_ns, excl_max_ns]）。
        # PY_UNWIND 弹掉异常退出的帧并累计父 child_ns、不记样本（实证：内部捕获
        # 的异常不触发 UNWIND，传播出帧才触发——unwind_semantics_probe.py）。
        # ⚠ PY_UNWIND **不能作局部事件**（3.13.7 set_local_events 拒收）——只能开
        # 全局事件，靠「栈顶 code 匹配」守卫过滤未计时的帧（库 unwind 只付一次
        # 比较；异常路径非热路径）。⚠ 单栈为单线程语义（多线程交错会破坏配对，
        # 与 P1 的 per-code 栈同等程度的技术债）。
        # TD-027 D10：帧元素实际为 [CodeType, t0_ns, child_ns]（int 计时值占后两位）。
        self._perf_frames: list[list[types.CodeType | int]] = []
        # 全局事件基座（窗口外常开的事件）：perf 模式叠加 PY_UNWIND。
        self._base_events = sys.monitoring.events.RAISE
        if cfg.perf_mode:
            # 静音对耗时统计是致命失真（停 PY_RETURN 会让计时栈泄漏、样本只剩
            # 每函数前 200 次）——必须抬开静音上限。这不是调参偏好，是正确性前提
            #（runtime_profiler_dev_plan.md §3.1）。
            # TD-027 D9：抬开写入局部副本（dataclasses.replace），不改写调用方 cfg
            #（mutator 坏味道：ProbeConfig 是共享对象，调用链外的测试同样持有引用）。
            self._cfg = replace(cfg, max_calls_per_func=sys.maxsize)
            self._base_events |= sys.monitoring.events.PY_UNWIND

    # -- 生命周期 ---------------------------------------------------------

    def start(self) -> None:
        if self._tid is not None:
            return
        sm = sys.monitoring
        tid = None
        for cand in _TOOL_IDS:
            try:
                sm.use_tool_id(cand, "montauri-probe")
                tid = cand
                break
            except ValueError:
                continue
        if tid is None:
            raise RuntimeError("sys.monitoring 无可用 tool id（0-5 全被占用）")
        self._tid = tid
        E = sm.events
        if self._cfg.perf_mode:
            # A2 性能模式：注册「计时版」回调组（两套回调之一，热路径零 if perf_mode
            # 分支——runtime_profiler_dev_plan.md §3.2；多一层包装帧实测成本 ≈ 0）。
            # 计时版在原回调之外只做 t0 压栈/弹栈聚合，采集逻辑逐字复用原版。
            # PY_UNWIND 为全局事件（不可局部），回调内靠「栈顶 code 匹配」过滤。
            sm.register_callback(tid, E.PY_START, self._on_start_perf)
            sm.register_callback(tid, E.PY_RETURN, self._on_return_perf)
            sm.register_callback(tid, E.PY_UNWIND, self._on_unwind_perf)
        else:
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
        for ev in (E.PY_START, E.PY_RETURN, E.RAISE, E.PY_UNWIND):
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
        self._perf_frames.clear()

    # -- 发现窗口 ---------------------------------------------------------

    def _open_window(self) -> None:
        """开启全局 PY_START 发现窗口（_base_events 常开，不受窗口控制）。"""
        now = time.perf_counter()
        self._win_until = now + _DISCOVERY_WINDOW
        self._win_opened_at = now
        self._in_window = True
        self._quiet = 0
        sys.monitoring.set_events(self._tid,
                                  sys.monitoring.events.PY_START | self._base_events)

    def _maybe_close_window(self) -> None:
        """窗口到期或连续无新函数则关闭全局 PY_START（RAISE 保持常开）。

        活跃项目函数（_active > 0）期间保持窗口开启——其子调用（含慢 import 后
        才首次被调用的业务函数）仍需被发现。

        _active 存在三类无法即时抵消的泄漏（异常退出不触发 PY_RETURN、静音清掉
        局部事件导致在途调用 return 不再派发、生成器未耗尽无 StopIteration）。因此
        只在「关窗决策点」（窗口到期或静默超限）做一次调用栈回溯校准（_sync_active），
        把泄漏计数收敛到真实活跃帧数，避免全局 PY_START 被永久拖住。日常派发期间
        不做回溯，保持 O(1) 热路径开销。

        校准确有活跃项目函数时**推进窗口**（win_until += _DISCOVERY_WINDOW）：否则
        长运行脚本（_active 恒 > 0）下每次派发都命中决策点，回溯退化成 O(派发数×
        栈深)，击穿「局部事件零派发」开销目标。推进后下一个决策点在完整窗口周期
        之后，回溯频率收敛到每窗口至多一次；「慢 import 后才发现的业务函数」仍被
        采集（原设计意图不变）。
        """
        now = time.perf_counter()
        # M4 修复：静默关窗加时间地板——窗口开启后 _MIN_DISCOVERY_FLOOR 内即便 quiet
        # 已达阈值也不关（sitecustomize 链噪音在启动毫秒内涌完，见 _MIN_DISCOVERY_FLOOR
        # 注释）。时间到期路径不受影响（2s 硬上限仍在）。
        if now < self._win_until and self._quiet < _QUIET_CLOSE:
            return  # 未到决策点：无论 _active 大小都保持窗口（避免每派发栈回溯）
        if self._quiet >= _QUIET_CLOSE and now - self._win_opened_at < _MIN_DISCOVERY_FLOOR:
            return  # 静默超限但仍在时间地板内：库噪音免疫，保持窗口（等待主脚本激活 _active）
        if self._active > 0:
            self._sync_active()  # 决策点校准：修复异常/生成器/静音造成的计数泄漏
        if self._active > 0:
            # 确有项目函数活跃（如慢 import 中的 <module> 帧），保持窗口；
            # 同步推进窗口到期时刻，避免下个派发再次触发栈回溯（每窗口至多一次）。
            # M4 开销修复：**重置 _quiet**——否则 _quiet 已超 _QUIET_CLOSE 的长运行脚本
            # （每次派发 +1、从不归零）会让本分支后的每次派发都再次命中决策点，
            # 推进窗口也拦不住（时间条件早满足、静默条件永远不满足），节流失效
            # 退化成 O(派发数×栈深)（实测 bench 60004 次派发跑出 57999 次栈回溯）。
            self._win_until = now + _DISCOVERY_WINDOW
            self._quiet = 0
            return
        sys.monitoring.set_events(self._tid, self._base_events)
        self._in_window = False

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
        # 静音判断置顶：被静音的函数只计 hits，越早返回越省。
        # 不要把它放在 _maybe_close_window() 之后——实测（bench/profiler-overhead，
        # E2 vs 落地首版）那样每次派发都要多付一次 perf_counter + 函数调用，
        # 而 _active > 0 时窗口根本不会被关掉，这笔开销纯属白付（1.71x → 1.57x）。
        if code in self._muted:
            self._count_hit_only(code)
            return None
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
            fid = self._fid(code)
            if self._sink.over_limit(fid, self._cfg.max_calls_per_func):
                # 高频降采样：静音（保留 hits，停类型观测与返回回调）
                self._mute(code)
                # 触发静音的这次调用也要计数，否则每次静音会吞掉 1 次 hits
                self._sink.add_hit(fid)
                return None
            self._active += 1
            self._sink.add_hit(fid)
            if not self._too_deep(code):
                self._record_args(code, fid)
            if code not in self._armed:
                E = sys.monitoring.events
                sys.monitoring.set_local_events(self._tid, code,
                                                E.PY_START | E.PY_RETURN)
                self._armed.add(code)
            return None
        # 非窗口期：局部事件路径（仅项目内函数会走到这里）
        fid = self._fid(code)
        if self._sink.over_limit(fid, self._cfg.max_calls_per_func):
            self._mute(code)
            self._sink.add_hit(fid)  # 触发静音的这次调用也要计数
            return None
        self._active += 1
        self._sink.add_hit(fid)
        if not self._too_deep(code):
            self._record_args(code, fid)
        # 项目函数再度活跃：重开发现窗口，捕获其子调用（替代原来的周期重开）
        if not self._in_window:
            self._open_window()
        return None

    def _mute(self, code: types.CodeType) -> None:
        """静音：停类型观测与返回回调，但**保留 PY_START 继续累加 hits**。

        旧行为是清掉全部局部事件（此后零派发开销），副作用是 `functions.hits`
        被钳在 `max_calls_per_func` 上限——热点榜与 Profiler 的 Top-N 一到上限
        就分不出高下（3 个真实项目里 hits max 恒为 200）。

        新行为只清 PY_RETURN、保留 PY_START：静音后该函数的回调退化为一次
        dict 查表 + 一次计数（见 `_count_hit_only`），省下的返回回调与
        `compact_type` 成本正好抵消继续派发的成本——实测与旧行为开销持平：
        S1 形状 1.57x vs 1.56x、S3 形状 1.08x vs 1.08x
        （`bench/profiler-overhead/overhead_lab.py --decomp` 的 D0 vs E2）。

        code 仍留在 `_armed` 里，好让 `stop()` 统一清理局部事件。
        """
        self._muted.add(code)
        if code in self._armed:
            try:
                sys.monitoring.set_local_events(self._tid, code,
                                                sys.monitoring.events.PY_START)
            except ValueError:
                self._armed.discard(code)

    def _count_hit_only(self, code: types.CodeType) -> None:
        """静音函数的热路径：只累加 hits，不做分类/类型观测/深度检查。"""
        self._sink.add_hit(self._fid(code))

    # -- A2 性能模式回调（仅 perf_mode 时注册；采集逻辑逐字复用原版） --------

    def _on_start_perf(self, code: types.CodeType, offset: int):
        """原版 _on_start 之后压帧 [code, t0, child_ns]。

        t0 在原回调**之后**取：回调返回后函数体才执行，计到的仍是函数体耗时，
        且能借用原回调的分类结果——只对**项目函数**计时，库函数只付一次 dict.get。
        静音检查保留兜底（perf 模式静音上限已抬开，_muted 恒为空，几乎零成本）。
        """
        self._on_start(code, offset)
        if self._code_ok.get(code) is True and code not in self._muted:
            self._perf_frames.append([code, time.perf_counter_ns(), 0])
        return None

    def _on_return_perf(self, code: types.CodeType, offset: int, retval):
        """弹帧聚合耗时，**先于**原版 _on_return——不把探针记账算进函数耗时。

        弹帧时把 dt 累计进父帧 child_ns（exclusive 的扣除依据），样本同时记
        inclusive（dt）与 exclusive（dt - 本帧 child_ns）。栈顶 code 匹配守卫
        保证库代码的 return/unwind 不会误弹项目帧。
        """
        frames = self._perf_frames
        if frames and frames[-1][0] is code:
            f = frames.pop()
            dt = time.perf_counter_ns() - f[1]
            if frames:
                frames[-1][2] += dt
            self._sink.add_perf(self._fid(code), dt, dt - f[2])
        self._on_return(code, offset, retval)
        return None

    def _on_unwind_perf(self, code: types.CodeType, offset: int, exc):
        """异常退出（PY_UNWIND）：弹帧、把耗时累计进父帧 child_ns、不记样本。"""
        frames = self._perf_frames
        if frames and frames[-1][0] is code:
            f = frames.pop()
            dt = time.perf_counter_ns() - f[1]
            if frames:
                frames[-1][2] += dt
        return None

    def _fid(self, code: types.CodeType) -> int:
        """按归一化 filename 取函数 id（P2-4：code 级缓存，热路径零 realpath）。"""
        key = self._code_fid_key.get(code)
        if key is None:
            fn = code.co_filename
            try:
                fn = os.path.normcase(os.path.normpath(fn))
            except (OSError, ValueError):
                pass
            key = (fn, code.co_qualname, code.co_firstlineno)
            self._code_fid_key[code] = key
        return self._sink.func_id(*key)

    @staticmethod
    def _glob_match(rel: str, patterns: tuple[str, ...]) -> bool:
        """glob 匹配：精确 / 通配 / 目录前缀（"tests" ≙ "tests/*"；fnmatch 的 * 跨 /）。"""
        return any(fnmatch(rel, p) or fnmatch(rel, p + "/*") for p in patterns)

    def _too_deep(self, code: types.CodeType) -> bool:
        """调用栈深度是否超限（从被监控帧沿 f_back 计数，O(depth)）。

        仅在记录路径执行（未静音、未超调用上限）；深层调用仍计 hits，
        深递归函数照常触发静音兜底，不会反复遍历。

        帧定位（2026-10-08 review 修正）：沿 f_back 搜索 `f_code is code` 的帧，
        不再用固定 `_getframe(2)`——perf 模式的回调是 `_on_start_perf` 包装
        （被监控函数 → _on_start_perf → _on_start → _too_deep），固定深度偏移 +1，
        深度限制会提前 1 层误触发。按 code 搜索对包装层级天然免疫。
        """
        limit = self._cfg.max_call_depth
        if limit <= 0:
            return False
        f = _monitored_frame(code)
        depth = 0
        while f is not None:
            depth += 1
            if depth > limit:
                return True
            f = f.f_back
        return False

    def _on_return(self, code: types.CodeType, offset: int, retval):
        self._active = max(0, self._active - 1)
        fid = self._fid(code)
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
        fid = self._fid(code)
        # 兜底（2026-10-08 review P1，与 compact_type 顶层同款）：异常类经魔法
        # metaclass 在 __module__/__qualname__/__name__ 上抛异常时，裸 type_label
        # 会让 RAISE 回调按 unraisable 处理甚至被禁用——RAISE 是唯一常开的
        # 全局事件，回调被禁 = 此后异常观测全灭且无警告（违反「探针失败只打
        # 警告」铁律）。降级为 "?"，观测近似值，探针存活优先。
        try:
            label = type_label(type(exc))
        except Exception:  # noqa: BLE001 - 恶意/魔法对象的降级路径
            label = "?"
        self._sink.add_exc(fid, label)
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
        """从被监控帧的 f_locals 提取参数类型（不含局部变量）。

        帧定位（2026-10-08 review 修正，P1）：沿 f_back 搜索 `f_code is code` 的帧。
        旧实现 `_getframe(2)` 依赖「_record_args → _on_start → 被监控函数」的固定
        三层链，但 perf 模式的回调是 `_on_start_perf` 包装（多一层）——`_getframe(2)`
        取到包装帧自身，`frame.f_code is not code` 恒命中 → perf 模式下**所有**
        参数观测被静默丢弃（耗时/hits/异常不受影响，测试因此漏网）。按 code
        搜索对包装层级免疫，未命中则防御性跳过。
        """
        frame = _monitored_frame(code)
        if frame is None:
            return
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
