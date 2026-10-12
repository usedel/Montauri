"""A 组覆盖核对用：工作区内部模块（供 `from helpers import ...` 场景）。"""


def parse_page(html, timeout=30):
    return {"title": html[:10]}


def build_url(base):
    return base + "/api"
