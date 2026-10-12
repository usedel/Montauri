"""A 组覆盖核对：容器方法的键补全（有类型 / 无类型对照）。"""

from typing import TypedDict


class Payload(TypedDict):
    url: str
    title: str


def use_typed(p: Payload):
    return p.get(  # @A7


def use_loose(d):
    return d.get(  # @A7b
