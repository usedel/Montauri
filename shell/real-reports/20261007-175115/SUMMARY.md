# 真机验收汇总 2026-10-07 17:51:47

- HEAD：`0fa00c3`
- 模式：日常真机跑批
- 跑批：`shell/e2e-real/run-real-all.ps1`（套件清单与 `.github/workflows/nightly.yml` 一致）
- 判定：失败 1 个套件；用例 0 项 / 失败 0 项

| 套件 | 通过 | 失败 | 总数 | 用时 | 结论 |
|---|---|---|---|---|---|
| http-real | 0 | 0 | 0 | 23s | ENV（locator.waitFor: Timeout 10000ms exceeded.
Call log:
[2m  - waiting for locator('#devtools-picker') to be visible[22m
[2m    22 × locator resolved to hidden <div class="hidden" id="devtools-picker">…</div>[22m
） |
| **合计** | **0** | **0** | **0** | — | — |

> 逐项明细见同目录各 `<suite>.json` 的 `cases` 数组（含每项 detail）。
> 端口 5173 / 9223 为真机脚本共用，**必须串行**；`ENV` = 环境未就绪（预检未通过 / tauri dev 启动失败），**不是断言回归**——先看 error 字段再谈修代码。
