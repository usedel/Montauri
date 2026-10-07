# 真机验收汇总 2026-10-07 16:43:50

- HEAD：`3ba7076`
- 跑批：`shell/e2e-real/run-real-all.ps1`（套件清单与 `.github/workflows/nightly.yml` 一致）
- 判定：失败 0 个套件；用例 73 项 / 失败 0 项

| 套件 | 通过 | 失败 | 总数 | 用时 | 结论 |
|---|---|---|---|---|---|
| db-real | — | — | — | — | 无报告（未启动？） |
| debug-real | 14 | 0 | 14 | 81s | PASS |
| endpoints-real | 4 | 0 | 4 | 34s | PASS |
| multi-window-real | 16 | 0 | 16 | 46s | PASS |
| new-project-fastapi-real | — | — | — | — | 无报告（未启动？） |
| ui-real | 39 | 0 | 39 | 23s | PASS |
| **合计** | **73** | **0** | **73** | — | — |

> 逐项明细见同目录各 `<suite>.json` 的 `cases` 数组（含每项 detail）。
> 端口 5173 / 9223 为真机脚本共用，**必须串行**；ENV 表示预检未通过（如解释器路径未设 OC_REAL_PYTHON）。
