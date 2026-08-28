# Phase 1 验收实测记录（S1-T06 / S1-T07）

> 日期：2026-08-21 · 环境：Windows · release 构建（`target/release/opencharm-shell.exe`）

## 内存实测（S1-T06）

| 进程组 | 内存 |
|---|---|
| 主进程（opencharm-shell.exe） | 33 MB |
| WebView2（1 主 + 5 子：GPU/渲染/工具等） | 326 MB |
| **合计** | **≈ 359 MB** |

- 红线：≤ 600 MB（技术方案 v3 §1.1）→ **达标**（余量 40%）；
- 对照：spike debug + Monaco CDN 全量 ~420 MB → release + 本地打包降至 ~359 MB；
- 注：未含 pyrefly LSP 进程（需打开工作区后测量，预计 +50~150 MB，仍在红线内）。

## 冷启动（S1-T06，2026-08-21 优化后复测）

- **实测（3 次平均）：1181 ms**（首启 1198 / 热启 199 / 冷启 2145）；
- 红线：< 1500 ms → **达标** ✅；
- 优化手段：Monaco 动态 import（首屏 chunk 3182 KB → **17 KB**，Monaco 2790 KB 独立异步 chunk）+ contrib 按需引入（弃 `editor.all`）+ 语言包剥离（仅 Python Monarch，4 KB）；
- 优化前：~8.2 s（Monaco 全量同步加载）。

## 内存（S1-T06，2026-08-21 复测）

- **实测（3 次平均）：345 MB**（主进程 33 + WebView2 六进程 312）；
- 红线：≤ 600 MB → **达标** ✅（余量 43%）；
- 报告：`bench/reports/metrics-*.md`（`bench/collect-metrics.ps1` 自动采集）。

## 版本锁定（S1-T07）

见 `ci/versions.toml`（tauri 2.11.5 / monaco 0.52.2 / pyrefly 1.2.0 / basedpyright 1.39.10 / ruff 0.16.1 / uv 0.10.11 / rust 1.96.0 / python 3.13.7）。

## 本轮功能修复（2026-08-21）

| 项 | 状态 |
|---|---|
| 运行输出中文乱码 | ✅ 已修（`PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1`） |
| Ctrl+悬停误跳转 | ✅ 已修（provider 只返回数据；F12/Ctrl+点击显式触发） |
| 欢迎页不显示（首次启动无入口） | ✅ 已修（默认显示 + 工具栏「📂 打开」常驻） |
| 诊断仅对已打开 tab 生效 | ✅ 已修（诊断缓存，打开时应用） |
| didChange 全量同步 | ✅ 已修（range-based 增量 + didSave） |
| Ctrl+F10 运行键位 | ✅ 已加（PyCharm 键位） |
| 输入 "case" 无补全（2026-08-21） | ✅ 已修：增量同步防抖覆盖 bug + pyrefly `contentChanges` 语义是「替换文档状态」而非追加 → **回退为全量 didChange**（诊断实测：全量后补全 45 项含 6 个 `case_*`，错位增量只剩 1 项） |
| 引擎切换后补全失效（切回 pyrefly 也不行，2026-08-21） | ✅ 已修：切换后未重新 `didOpen` 已打开文件（新引擎进程对文档一无所知）→ 切换后重新同步全部已打开文件 + 清空旧诊断缓存 |
| `requests.` 成员补全只显示 6 个 live templates（2026-08-21） | ✅ 已修（P1-BUG-002，见下） |
| 运行脚本报 `module 'sys' has no attribute 'monitoring'`（2026-08-21） | ✅ 已修（P1-BUG-003，见下）：目标 venv Python 3.11.9 < 3.12，探针入口加版本守卫，明确提示后跳过采集 |

## 待办（Gate B 前）

- [x] ~~中文输入法专项验证~~ → ✅ 产品负责人实测通过（2026-08-21）
- [x] ~~5 类错误 traceback 点击跳转人工验收~~ → ✅ 产品负责人实测通过（2026-08-21）
- [x] ~~补全/跳转准确率评测用例~~ → ✅ 产品负责人确认（2026-08-21）
- [x] ~~引擎切换演练（pyrefly ⇄ basedpyright）~~ → ✅ P1-BUG-001 已修复且产品负责人复验通过（2026-08-21）
- [x] ~~冷启动优化至 < 1.5 s~~ → **1181 ms 达标**（Monaco 动态 chunk 化）
- [x] ~~bench 指标采集脚本~~ → `bench/collect-metrics.ps1`（冷启动 + 内存自动采集，报告落盘 `bench/reports/`）

## 已知问题（记录备查）

### P1-BUG-001：basedpyright 补全不可用（2026-08-21，已修复）

- **现象**：切换 basedpyright 后 `case` 补全不出现；切回 pyrefly 后补全也失效（重启应用才恢复）。
- **根因（两层）**：
  1. 「切回 pyrefly 也失效」：引擎切换后未重新 `didOpen` 已打开文件 → 已修（切换后重新同步 + 清空旧诊断缓存）；
  2. 「basedpyright 本身不返回」：**桥不响应服务端→客户端请求**。basedpyright 在 initialize 后发 `workspace/configuration` 等请求（带 id），我们的桥只处理通知、不回响应 → 引擎挂起等待配置 → 补全永不返回。诊断脚本实测：响应服务端请求后补全正常（51 项含 6 个 `case_*`）。
- **修复**：桥收到带 id 的服务端请求时自动回 `result: null`（LSP 规范允许的空配置语义）；新增 Rust 命令 `lsp_send_response`。
- **遗留**：basedpyright 补全项仅含 `label/kind/sortText/data`（无 `insertText`/`detail`），完整信息需 `completionItem/resolve` 二段式——当前用 label 作插入文本可用（标识符场景无碍），resolve 支持列入 Phase 1 后续迭代。

### P1-BUG-002：`requests.` 成员补全只显示 6 个 live templates（2026-08-21，已修复）

- **现象**：Python 文件中 `import requests` 后输入 `requests.`，补全列表只有 "for loop" 等 6 个模板项，无任何成员（`get`/`post`/…）。
- **根因（两层叠加）**：
  1. **模板 provider 无条件返回全部模板**：`smartTemplates.ts` 对任何补全请求（含 `.` 触发的成员访问）都返回 6 个模板，且 `.` 是其触发字符。`requests.` 后 word 为空 → Monaco 空过滤匹配一切 → 模板以 `sortText 0xx` + `preselect` 顶在最前；
  2. **补全请求早于文档同步到达引擎**：`.` 触发字符补全**立即**发出，而 `didChange` 有 200ms 防抖——pyrefly 拿到的是**旧文档**，补全位置落在旧文档范围外 → 返回空 → 只剩模板。这偏离了技术方案 §2.4「输入停止 200ms 节流后再请求 LSP」的本意（同步必须先于请求）。
- **修复**：
  1. `smartTemplates.ts`：成员访问上下文（当前 word 前紧邻 `.`）不提供模板（⚡ 强制全显是用户显式动作，放行）；
  2. `client.ts` 新增补全前钩子 `setBeforeCompletionHook`：补全请求发出前冲刷防抖窗口内未同步的 `didChange`（`notify`/`didChangeFull` 改为可 await，保证同步帧写入 stdin 后才发补全请求）；钩子由 `main.ts` 注入（需访问 `tabs`/`pendingChanges`，client 不持有编辑器层状态）。
- **验证**：`tsc --noEmit` + `vite build` 全绿；`requests.` 后模板不再出现，成员补全正常返回。

### P1-BUG-003：运行脚本报 `module 'sys' has no attribute 'monitoring'`（2026-08-21，已修复）

- **现象**：shell 运行按钮执行脚本，输出面板显示 `[opencharm-probe] ⚠ 注入失败（忽略，继续正常运行）：module 'sys' has no attribute 'monitoring'`。
- **根因**：目标工作区 venv（`D:\PycharmProjects\money\.venv`）是 **Python 3.11.9**，而探针依赖的 `sys.monitoring`（PEP 669）是 **Python 3.12+** 才有的。`Monitor.start()` 里 `sys.monitoring` 抛 `AttributeError`，被 `sitecustomize.py` 的兜底 except 捕获后打印了这条含混的警告——兜底逻辑本身正常（脚本继续运行），但报错信息没有点明根因。
- **修复**（探针入口加版本守卫，明确提示后跳过采集）：
  1. `autostart.py` `bootstrap()`：`sys.version_info < (3, 12)` 时打印「当前 Python X.Y < 3.12，无 sys.monitoring（PEP 669），本次运行不采集」并 return；
  2. `runner.py` `run_with_probe()`：同进程模式直接 `RuntimeError`（CLI 场景应显式失败而非静默）。
- **验证**：probe 54 单测全绿（含新增 `test_inject_old_python_skips_gracefully`：monkeypatch 伪装 3.11 验证守卫）；用真实 3.11.9 venv 端到端复现 → 提示明确、脚本正常执行。
- **说明**：这是**环境限制而非代码 bug**——要采集该项目的运行时类型，需把工作区 venv 升级到 Python 3.12+（`uv venv --python 3.12` 重建）。低于 3.12 时脚本运行、诊断、补全等其余功能不受影响。
