# 真机验收汇总 2026-10-07 20:08:11

- HEAD：`57e3404`
- 模式：发布前验收（含 release-real）
- 跑批：`shell/e2e-real/run-real-all.ps1`（套件清单与 `.github/workflows/nightly.yml` 一致）
- 判定：失败 0 个套件；用例 112 项 / 失败 0 项

| 套件 | 通过 | 失败 | 总数 | 用时 | 结论 |
|---|---|---|---|---|---|
| release-real | 7 | 0 | 7 | — | PASS |
| db-real | 18 | 0 | 18 | 66s | PASS |
| debug-real | 14 | 0 | 14 | 68s | PASS |
| endpoints-real | 4 | 0 | 4 | 30s | PASS |
| http-real | 10 | 0 | 10 | 31s | PASS |
| multi-window-real | 16 | 0 | 16 | 40s | PASS |
| new-project-fastapi-real | 4 | 0 | 4 | 201s | PASS |
| ui-real | 39 | 0 | 39 | 19s | PASS |
| **合计** | **112** | **0** | **112** | — | — |

> 逐项明细见同目录各 `<suite>.json` 的 `cases` 数组（含每项 detail）。
> 端口 5173 / 9223 为真机脚本共用，**必须串行**；`ENV` = 环境未就绪（预检未通过 / tauri dev 启动失败），**不是断言回归**——先看 error 字段再谈修代码。
