# 真机验收汇总 2026-10-07 16:59:19

- HEAD：`32bbdce`
- 跑批：`shell/e2e-real/run-real-all.ps1`（套件清单与 `.github/workflows/nightly.yml` 一致）
- 判定：失败 1 个套件；用例 7 项 / 失败 0 项

| 套件 | 通过 | 失败 | 总数 | 用时 | 结论 |
|---|---|---|---|---|---|
| db-real | 7 | 0 | 7 | 32s | ENV（locator.click: Error: strict mode violation: locator('#db-data-view').locator('.db-cell-detail').locator('button') resolved to 2 elements:
    1) <button data-tip="关闭" aria-label="关闭" class="db-cell-detail-close">…</button> aka locator('#db-data-view').getByRole('button', { name: '关闭' })
    2) <button class="btn btn--sm">复制</button> aka getByRole('button', { name: '复制' })

Call log:
[2m  - waiting for locator('#db-data-view').locator('.db-cell-detail').locator('button')[22m
） |
| new-project-fastapi-real | 0 | 0 | 0 | 205s | FAIL |
| **合计** | **7** | **0** | **7** | — | — |

> 逐项明细见同目录各 `<suite>.json` 的 `cases` 数组（含每项 detail）。
> 端口 5173 / 9223 为真机脚本共用，**必须串行**；ENV 表示预检未通过（如解释器路径未设 OC_REAL_PYTHON）。
