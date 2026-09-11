# opencharm-probe

OpenCharm 运行时探针：基于 **PEP 669（`sys.monitoring`，Python 3.12+）** 采集运行时类型与调用信息，写入 SQLite trace 库。Phase 2 交付物（P2-T01~T08），项目差异化核心的第一块基石。

**独立包，零第三方依赖，不依赖外壳**（架构第一原则）。

## 快速开始

```powershell
cd probe
uv sync                 # 建 venv（Python 3.13.7）
uv run pytest           # 61 个单测全绿

# 采集运行（同进程模式：脚本无第三方依赖时）
uv run opencharm-probe run <script.py>

# 采集运行（注入模式：脚本有自己的 venv/依赖时，如 bench 样例）
uv run opencharm-probe inject -- uv run python <script.py>

# 查看 trace 库
uv run opencharm-probe show [--project <dir>] [pattern] [--json]

# trace 库清理（P2-T07）
uv run opencharm-probe clean [--project <dir>] [--days N] [--stale] [--all-runs]

# 正确率抽检（P2-T08；--uv 用目标项目 venv 运行）
uv run opencharm-probe check <script.py> [--expect file.json] [--uv] [--threshold 98]
```

## 架构

```
┌────────────────────────────────────────────────────────────┐
│ CLI（run / show / inject / clean / check）                  │
├────────────────────────────────────────────────────────────┤
│ runner（同进程） / autostart + sitecustomize（注入模式）      │
├────────────────────────────────────────────────────────────┤
│ monitor（PEP 669 采集核心）                                  │
│   全局 PY_START 发现窗口 → arm 局部事件 → 窗口外零全局派发    │
│   RAISE 常开（异常路径 trace 最有价值）                       │
├────────────────────────────────────────────────────────────┤
│ compact（类型紧凑表示）→ sink（内存聚合，运行期零 I/O）        │
├────────────────────────────────────────────────────────────┤
│ store（SQLite：~/.opencharm/traces/<project-hash>.db）      │
└────────────────────────────────────────────────────────────┘
```

### 事件策略（开销关键设计）

实测（Python 3.13.7，bench `unannotated_scraper`，2000 轮 × 3 函数）：

| 策略 | 开销 |
|---|---|
| 全局 PY_START 常开（无操作回调地板） | 1.25x |
| 仅局部事件 | 1.10x |
| **本探针（发现窗口 + 局部事件 + 降采样）** | **1.00x** |

- **发现窗口**：启动后全局 `PY_START` 开启（上限 2s），期间分类每个被调用的 code，对项目内函数 arm 局部 `PY_START | PY_RETURN`；连续 2000 次派发无新函数即提前关窗；之后每 5s 重开 0.5s 捕获新函数（延迟 import 等）。
- **OR 语义**：全局+局部同开不双触发（实测确认），窗口外采集完全靠局部事件——库代码零派发。
- **静音**：每函数调用数超限（默认 200）后清空其全部局部事件，此后零派发开销。
- **类型观测降采样**：每参数位/返回位最多 100 次类型观测（类型分布的边际价值递减）。

### 类型紧凑表示（P2-T03）

- 实例 → `模块.类名`（builtins/`__main__` 省略前缀；私有实现段归一化，如 `pathlib._local.Path` → `pathlib.Path`）；
- 容器 → 结构指纹：`dict[str, int]` / `list[int|str|...]`，深度默认 2 层，元素类型采样联合（上限 3 个 + `|...`）；
- **绝不 repr 值本身**；
- `shape_fingerprint`：全 str 键小 dict 的键集合 / 实例属性名集合（JSON 数组）——Phase 3 推断 dict 字段与实例结构的关键信号。

### trace 库（P2-T05 + P2-T07）

`~/.opencharm/traces/<project-hash>.db`（项目根 realpath 的 sha1 前 12 位）：

- `runs`：每次运行一行（时间/耗时/脚本/Python 版本/探针版本）；
- `functions`：`(filename, qualname, lineno)` 自然键 + hits 累加 + `stale` 陈旧标记；
- `arg_types` / `ret_types` / `exc_types`：类型观测，count 跨运行累加（「运行过的代码」沉淀观测）。

**陈旧标记（P2-T07）**：`save()` 时自动检测——本次未覆盖的函数，若所在文件 mtime > 库内末次 run.started → `stale=1`（文件已删除也标陈旧）；同文件再次运行 → 清回 0。旧库（无 stale 列）自动迁移。`clean --stale` 删除陈旧函数及其观测；`clean --days N` 删旧 runs 行（观测保留）；`clean --all-runs` 清空 runs 表。

注意：`shape` 列用空串而非 NULL 存储——SQLite 唯一约束对 NULL 不生效，会导致 upsert 失效（实测踩坑）。

## 配置

默认值 ← `~/.opencharm/config/probe.json` ← 环境变量 ← CLI 覆盖：

```json
{
  "max_container_depth": 2,
  "max_union_types": 3,
  "sample_elems": 8,
  "max_calls_per_func": 200,
  "max_call_depth": 64,
  "max_type_obs_per_site": 100,
  "include_modules": null,
  "exclude_modules": null,
  "db_dir": null,
  "quiet": false
}
```

限流语义（P2-T04）：

- `include_modules` / `exclude_modules`：相对项目根的 POSIX 风格 glob 列表（`"tests"` ≙ `tests/*`，`*` 跨目录）；白名单非空时仅采集匹配路径，**黑名单优先于白名单**；
- `max_call_depth`：调用栈深度上限（从被监控帧沿 `f_back` 计数）；超限调用**仍计 hits**（静音兜底照常触发）但不记参数观测；`0` = 不限；

环境变量：`OPENCHARM_PROBE_HOME`（重定向 `~/.opencharm`，测试隔离用）、`OPENCHARM_PROBE_CONFIG`（配置文件路径）、`OPENCHARM_PROBE_QUIET=1`（抑制摘要）。

## 注入模式（P2-T06 预演）

`inject` 命令 = 目标项目自己的 venv + `PYTHONPATH` 注入 `src/`（含 `sitecustomize.py` 顶层模块）+ 环境变量激活：

- `OPENCHARM_PROBE_AUTOSTART=1` 才激活，**未设置则零介入**（不侵入原则）；
- `argv[0]` 守卫：仅主脚本进程挂探针（multiprocessing spawn 子进程跳过）；
- `atexit` 落库：正常退出 / `sys.exit()` / 未捕获异常都会落库；
- 探针任何失败（注入/落库）只打警告，绝不改写用户进程退出码。

shell 运行按钮集成（P2-T06，已交付）：`lsp.rs` 的 `run_script` 在 `uv run` 前注入同款环境变量（`PYTHONPATH` 前置 `probe/src` + `OPENCHARM_PROBE_AUTOSTART=1` + `OPENCHARM_PROBE_SCRIPT=<绝对路径>`）；probe/src 定位顺序：环境变量 `OPENCHARM_PROBE_SRC` → 相对 exe 上溯仓库布局；找不到则照常运行仅提示（探针缺席不拖垮脚本）。探针摘要走 stderr，输出面板以中性色透传。

## PEP 669 实测语义备忘（2026-08-21，Python 3.13.7）

1. tool id 范围 **0-5**（不是 PEP 文档暗示的 6+），回退链 5→0；
2. `PY_START` 回调内 `sys._getframe(1)` 即被监控函数帧，`f_locals` 已含实参+默认值；
3. 回调返回 `MISSING` 对**全局**事件无效（不能禁用），只能回调内快速返回；
4. 全局+局部同开为 **OR 语义**（单次触发）；
5. `RAISE` 沿异常传播链每帧触发一次；C 层异常（KeyError 等）也触发；生成器耗尽的 StopIteration 不触发；
6. 生成器：`PY_START` 首次 resume 触发一次，`PY_RETURN` 在 StopIteration 触发（返回值即 `StopIteration.value`）。

## 已知限制

- 同进程 `run` 模式下，目标脚本的第三方依赖需在 probe venv 中可用（否则用 `inject`）；
- `PYTHONPATH` 注入会遮蔽目标 venv 自身的 `sitecustomize`（显式运行场景可接受）；
- 类方法/闭包的 qualname 带 `<locals>` 段（与 Python 语义一致，Phase 3 消费时处理）。

## Gate C 验收状态（Phase 2 完成）

| 指标 | 目标 | 当前 |
|---|---|---|
| 探针开销 | < 1.5x | ✅ 1.00x（bench `unannotated_scraper`，2000 轮 × 3 函数；回归 0.94x） |
| trace 正确率抽检 | ≥ 98% | ✅ **100.0%**（`check` 命令，8 项全命中）+ 61 单测全绿 |
| 采集无感 | 无感 | ✅ shell 运行按钮一键采集；摘要仅 stderr 一行，quiet 可关 |
| trace 库稳定 | 稳定 | ✅ 跨运行累加正确 + 陈旧标记 + clean 防膨胀 |

Gate C 四项验收指标全部达标并未留待办。
