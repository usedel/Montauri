"""TD-027 B7：autostart 摘要打印的 GBK 编码兜底测试。

模拟 GBK 控制台（TextIOWrapper(BytesIO, encoding='gbk')）。实测事实：
✓（U+2713）**不在 GBK 映射内**——摘要行在 GBK 控制台必然触发
UnicodeEncodeError，这正是原 bug 的触发字符。核心断言：_print_safe
不抛异常、降级后仍有可读输出、流关闭也静默。
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

PROBE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROBE_ROOT / "src"))

from montauri_probe.autostart import _print_safe  # noqa: E402


def _gbk_stream() -> io.TextIOWrapper:
    return io.TextIOWrapper(io.BytesIO(), encoding="gbk")


def test_print_safe_plain_ascii_always_works():
    s = _gbk_stream()
    _print_safe("[montauri-probe] ok 123", stream=s)
    s.seek(0)
    assert b"ok 123" in s.buffer.getvalue()


def test_print_safe_gbk_encodable_text():
    """常见中文在 GBK 可编码、✓（U+2713）实测无 GBK 映射 → 走降级，两者都不抛异常。"""
    s = _gbk_stream()
    _print_safe("[montauri-probe] ✓ 3 函数 · 12 类型观测", stream=s)
    s.seek(0)
    content = s.buffer.getvalue().decode("gbk")
    # 中文原样保留；✓ 被 replace 降级为 ?（U+2713 不在 GBK——这就是原 bug 的触发字符）
    assert "函数" in content and "类型观测" in content
    assert "✓" not in content


def test_print_safe_unencodable_char_degrades_not_raises():
    """GBK 无映射字符（如 emoji 🔥）→ 降级 replace，绝不抛 UnicodeEncodeError。"""
    s = _gbk_stream()
    msg = "[montauri-probe] ✓ summary 🔥 trailing"
    _print_safe(msg, stream=s)  # 不应抛异常
    s.seek(0)
    content = s.buffer.getvalue().decode("gbk")
    assert "summary" in content and "trailing" in content
    assert "🔥" not in content  # 已被 replace 降级


def test_print_safe_default_stream_is_stderr():
    """不传 stream 时落 sys.stderr（默认路径）。"""
    captured = io.StringIO()
    old, sys.stderr = sys.stderr, captured
    try:
        _print_safe("[probe] default-stream-check")
    finally:
        sys.stderr = old
    assert "default-stream-check" in captured.getvalue()


def test_print_safe_closed_stream_silent():
    """降级也失败（流已关）→ 静默（绝不炸 atexit）。"""
    s = _gbk_stream()
    s.close()
    _print_safe("anything 🔥", stream=s)  # 不应抛异常
