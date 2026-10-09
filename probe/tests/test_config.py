"""TD-027 B4：load_config 值类型校验测试。

手写配置（probe.json）的值类型不符时（如 `max_calls_per_func: "abc"`），
必须打警告并保留默认值，而不是原样 setattr 让探针在回调内 TypeError 静默失效。
"""
from __future__ import annotations

import json

from opencharm_probe.config import ProbeConfig, load_config


def _write_cfg(tmp_path, data: dict) -> None:
    cfg_path = tmp_path / "config" / "probe.json"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    cfg_path.write_text(json.dumps(data), encoding="utf-8")


def test_bad_int_keeps_default(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"max_calls_per_func": "abc"})
    cfg = load_config()
    assert cfg.max_calls_per_func == ProbeConfig().max_calls_per_func  # 默认值
    out = capsys.readouterr().err
    assert "max_calls_per_func" in out and "类型不符" in out


def test_bad_bool_keeps_default(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"quiet": "yes"})  # 字符串不是 bool
    cfg = load_config()
    assert cfg.quiet is False
    assert "quiet" in capsys.readouterr().err


def test_int_not_accepted_as_bool(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"quiet": 1})  # 裸 int 不当开关
    cfg = load_config()
    assert cfg.quiet is False


def test_bool_not_accepted_as_int(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"max_calls_per_func": True})
    cfg = load_config()
    assert cfg.max_calls_per_func == ProbeConfig().max_calls_per_func


def test_good_values_still_apply(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"max_calls_per_func": 5, "quiet": True,
                          "include_modules": ["a", "b"]})
    cfg = load_config()
    assert cfg.max_calls_per_func == 5
    assert cfg.quiet is True
    assert cfg.include_modules == ["a", "b"]
    assert "类型不符" not in capsys.readouterr().err


def test_none_union_accepts_none(tmp_path, monkeypatch):
    # `db_dir: str | None`——显式 null 合法（None 分支）
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"db_dir": None, "exclude_modules": None})
    cfg = load_config()
    assert cfg.db_dir is None
    assert cfg.exclude_modules is None


def test_union_wrong_type_keeps_default(tmp_path, monkeypatch):
    # `db_dir: str | None`——int 不属于任一分支
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"db_dir": 42})
    cfg = load_config()
    assert cfg.db_dir == ProbeConfig().db_dir


def test_list_wrong_elem_keeps_default(tmp_path, monkeypatch):
    # `include_modules: list[str] | None` 的 None 分支 → list[str]：元素非 str 不收
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"include_modules": ["a", 1]})
    cfg = load_config()
    assert cfg.include_modules == ProbeConfig().include_modules


def test_unknown_key_still_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENCHARM_PROBE_HOME", str(tmp_path))
    _write_cfg(tmp_path, {"totally_unknown": 1})
    cfg = load_config()  # 未知键静默忽略（既有行为不变）
    assert not hasattr(cfg, "totally_unknown")
