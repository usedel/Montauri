# bench：基准项目集

> 对应开发计划 v2 S1-T05 / S1-T07。Phase 0 版本已清理，本目录为重建版。

## 样例项目

| 项目 | 特征 | 考察点 | 状态 |
|---|---|---|---|
| `sample/errors/` | 5 类错误 + 语法错误 | **traceback 点击跳转**（Gate B 验收第 3 条） | ✅ traceback 格式已验证 |
| `sample/fastapi_annotated/` | Pydantic 注解齐全 | 静态引擎上限（有注解补全 ≥95%） | ✅ 可导入 |
| `sample/unannotated_scraper/` | 无注解、动态结构 | 运行时采样价值（Phase 2/3 主战场） | ✅ 可导入 |

每个样例目录含独立 `pyproject.toml` + `.venv`（uv 管理，Python 3.13.7；`.venv` 已被根 `.gitignore` 忽略）。

## errors 验收步骤（S1-T05）

在 OpenCharm 中打开 `bench/sample/errors/` 为工作区，逐条运行（运行按钮或终端）：

```powershell
uv run main.py -- --case runtime    # ZeroDivisionError（line 23）
uv run main.py -- --case attribute  # AttributeError（line 29）
uv run main.py -- --case import     # ModuleNotFoundError（line 34）
uv run main.py -- --case assert     # AssertionError（line 40）
uv run main.py -- --case nested     # KeyError 多帧（line 46/50/54）
uv run syntax_error.py              # SyntaxError 单行格式（line 16）
```

> 注意 `--` 分隔符：uv run 需用它区分自身参数与脚本参数。

**验收标准**：输出面板中每个 `File "…", line N` 帧渲染为可点击链接，点击后打开文件并定位到出错行（含跨文件场景——traceback 中 venv 内文件路径也应可跳转）。

## 环境版本（锁定基线）

| 工具 | 版本 |
|---|---|
| Python（uv 管理） | 3.13.7（`D:\py3\3.13.7`） |
| uv | 0.10.11 |
| pyrefly | 1.2.0 |
| basedpyright | 1.39.10（`~/.local/bin`，已入 PATH） |
| ruff | 0.16.1 |

## 待补（S1-T07 后续）

- [x] 指标采集脚本（启动时间/内存）→ ✅ `collect-metrics.ps1`，报告落盘 `bench/reports/`
- [x] 运行时补全准确率评测 → ✅ `bench/reports/gate-d-runtime-completion.md`（P3-T10，23/23）
- [ ] 静态引擎补全/跳转准确率评测用例（每项目 ≥50 评测点）
- [ ] 50+ 小脚本合集、动态架构样例（Phase 2/3 前补齐）
