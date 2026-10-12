"""A 组覆盖核对：raise 位置的异常类型。"""


def risky(x):
    if not x:
        raise Val  # @A3
    return x
