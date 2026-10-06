"""A2 Profiler 开销门槛实验的受控负载（Gate C 同源口径）。

复制 bench/sample/unannotated_scraper/bench_probe.py 的三函数形态
（dict 构造 / 循环+字符串 / 闭包工厂），但**不含任何计时与打印**——
计时由 overhead_lab.py 在进程内完成，避免 stdio 抖动混入开销测量。

刻意保持「函数体极短」：这是 Gate C 的最坏情形（回调成本相对占比最大），
若某方案在worst-case下达标，则真实场景（函数体更长）必然达标。
"""


def parse_page(html):
    return {
        "title": html.split("<title>")[1].split("</title>")[0],
        "links": [a for a in html.split('href="')[1::2]],
    }


def normalize(items):
    out = []
    for it in items:
        if it:
            out.append(it.strip().lower())
    return out


def make_fetcher(base_url):
    def _get(path):
        return base_url + path

    return _get


# 放大版负载：**单轮更重**，但每个函数的调用次数可以压在静音阈值（200）以下。
# 用途：测「没有静音节流时」的真实开销——细小负载加少的调用轮数会让总时长掉到
# 毫秒级，测量噪声压过信号（实测 rounds=150 的小负载出现 0.77x 这种不可能值）。
HTML_BIG = ('<html><title>bench</title>' + '<a href="x">y</a>' * 16) * 80

HTML = ('<html><title>bench</title>' + '<a href="x">y</a>' * 16) * 8


def run(rounds, big=False):
    html = HTML_BIG if big else HTML
    fetcher = make_fetcher("https://example.com")
    links = []
    for i in range(rounds):
        page = parse_page(html)
        links = normalize(page["links"])
        fetcher(f"/{i}")
    return len(links)
