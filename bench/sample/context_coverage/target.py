"""B 组覆盖核对靶场（docs/context_awareness_dev_plan.md §9 B1~B4）。

每个场景用行内标记 `# @Bx` 标注补全位置——探针按标记定位，不写死行列号。
每对场景刻意做「有注解 / 无注解」对照：用来区分「引擎不会做」与
「引擎只在有类型信息时做」两种根因（同 pydantic-probe 的 plain.py 对照组手法）。
"""

import json as js


class TypedCustomer:
    def __init__(self, name: str, email: str):
        self.name = name
        self.email = email

    def display(self) -> str:
        return f"{self.name} <{self.email}>"

    def touch(self):
        return self.  # @B1


class LooseCustomer:
    def __init__(self, name, email):
        self.name = name
        self.email = email

    def touch(self):
        return self.  # @B1b


class TypedOrder:
    def __init__(self, customer: TypedCustomer, total: int):
        self.customer = customer
        self.total = total

    def touch(self):
        return self.customer.  # @B2


class LooseOrder:
    def __init__(self, customer, total):
        self.customer = customer
        self.total = total

    def touch(self):
        return self.customer.  # @B2b


def build_local():
    cb_url = "https://example.com"
    timeout_seconds = 30
    return cb_  # @B3


def use_alias():
    return js.  # @B4


module_level_url = "https://example.com"
module_le  # @B3b
