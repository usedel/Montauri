# 真机验收汇总 2026-10-07 17:21:14

- HEAD：`993c0b0`
- 跑批：`shell/e2e-real/run-real-all.ps1`（套件清单与 `.github/workflows/nightly.yml` 一致）
- 判定：失败 1 个套件；用例 11 项 / 失败 0 项

| 套件 | 通过 | 失败 | 总数 | 用时 | 结论 |
|---|---|---|---|---|---|
| db-real | 7 | 0 | 7 | 92s | ENV（locator.click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('#db-data-view').locator('.db-cell-detail').locator('.db-cell-detail button:not(.db-cell-detail-close)')[22m
） |
| new-project-fastapi-real | 4 | 0 | 4 | 206s | PASS |
| **合计** | **11** | **0** | **11** | — | — |

> 逐项明细见同目录各 `<suite>.json` 的 `cases` 数组（含每项 detail）。
> 端口 5173 / 9223 为真机脚本共用，**必须串行**；ENV 表示预检未通过（如解释器路径未设 OC_REAL_PYTHON）。
