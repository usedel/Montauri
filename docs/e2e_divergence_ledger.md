# e2e 分歧台账（mock 层 ↔ CDP 真机层）

> 目的：记录所有「浏览器 mock e2e 能过、CDP 真机挂（或反之）」的分歧用例。
> 台账是 **mock 忠实度的度量**：大多数分歧应通过修 mock（`shell/e2e/mocks/tauri-mock.js`）
> 向真机对齐来关闭，而不是把用例全量搬去 CDP。
>
> 分层策略（双层演进）：
> - **mock 层**（`shell/e2e/`）：全量保留，每次提交全量跑，管快而全的交互回归；
> - **CDP 层**（`shell/e2e-real/`，公共基建 `lib/real-env.cjs`）：按功能域补关键路径用例，
>   作为发版前/合并主干时的冒烟，不进高频 CI。

## 根因分类

| 类别 | 含义 | 处理方向 |
|---|---|---|
| A-mock 不忠实 | 桩返回的数据形状 / 时序 / 语义与真机不同（罐头数据掩盖真实行为） | **修 mock**，向真机对齐；必要时给 mock 加「真机形态」开关 |
| B-真实时序/环境 | 真进程（LSP 索引、debugpy attach、watcher）带来的时延 / 异步竞态 / 环境前置 | **稳定化**：显式等待、稳定判定 helper（如 `waitReferencesStable`、`waitFrameText`）、fixture 预置 |
| C-前端真 bug | mock 环境掩盖的集成缺陷（契约缺口、状态覆盖、进程残留等） | **修产品代码**；CDP 用例固化为回归项 |
| D-工具链坑 | 文件编码（BOM）、路径（canonicalize / verbatim）、进程清理等测试基建自身问题 | 修基建（公共模块 `e2e-real/lib/real-env.cjs` 统一收口），并回填本文「避坑速查」 |

## 记录模板

新增一条分歧时复制下表填写；状态取 `open`（未处理）/ `fixed`（已修）/ `wontfix`（有意保留差异，需写明理由）。

```markdown
### D-XXX：<一句话标题>
- **日期**：YYYY-MM-DD
- **用例**：mock 侧 `shell/e2e/<path>.spec.ts`（用例 ID）/ CDP 侧 `shell/e2e-real/<name>.cjs`（用例 ID）
- **症状**：mock 层表现 vs 真机表现（贴关键断言输出）
- **类别**：A / B / C / D
- **根因**：<定位结论 + 证据（探针/日志），一句话说透>
- **处理**：<改了哪个文件什么逻辑 / 或为何 wontfix>
- **状态**：open | fixed | wontfix
```

## 台账

<!-- 以下为历史分歧回填（按发现时间排序），后续新分歧追加在表尾 -->

### D-001：references/rename 在真机只覆盖已打开文件
- **日期**：2026-09（引用/重命名专项）
- **用例**：mock 侧 `shell/e2e/lsp/`（03 spec）；CDP/探针侧 pyrefly 裸会话采样
- **症状**：mock e2e 全绿；真机 references 计数随打开文件递增、rename 漏改未打开文件
- **类别**：C-前端真 bug
- **根因**：`lsp.rs::lsp_start` 未设进程 cwd——pyrefly 从 cwd 发现 pyproject.toml 才启动工作区索引，cwd 错则永不索引
- **处理**：lsp_start 加 `cwd: Option<String>`；client.ts startEngine/startIntel 传 workspaceRoot
- **状态**：fixed

### D-002：真实 debugpy 栈帧 source.name 为空
- **日期**：2026-09（调试真机验收 R-REAL）
- **用例**：mock 侧 `shell/e2e/debug/01-functional.spec.ts`；CDP 侧 `e2e-real/debug-real.cjs` R-REAL-4
- **症状**：mock 断言 `script.py:6` 能过；真机栈顶帧文本为 `main :6`（source.name 空，loc 回退 `:${line}`）
- **类别**：A-mock 不忠实
- **根因**：mock 的 DAP 模拟返回了带文件名的 source；真实 pydevd stackTrace 的 source.name 为空
- **处理**：CDP 断言改「首帧文本以 `:行号` 结尾」（`waitFrameText`）；mock 不强行对齐（保留两种形态各有用例）
- **状态**：fixed

### D-003：停函数首行时 main 帧局部变量为空
- **日期**：2026-09（调试真机验收 R-REAL）
- **用例**：mock 侧 `shell/e2e/debug/01-functional.spec.ts`（D-FUNC 变量面板）；CDP 侧 R-REAL-5/7
- **症状**：mock 罐头数据永远有变量；真机第 6 行（`a = compute(10)` 未执行）pydevd 返回 `{"variables":[]}`
- **类别**：A-mock 不忠实（实为 Python 语义，非缺陷）
- **根因**：断点停在赋值语句时局部变量尚未赋值
- **处理**：R-REAL-5 校验变量面板空态提示；R-REAL-7 用第二断点（:9）验证真局部变量 a/b
- **状态**：fixed

### D-004：recent-workspaces.json 带 BOM 被 serde 静默拒读
- **日期**：2026-09（M4 运行验收）
- **用例**：CDP 侧所有 e2e-real 脚本（工作区自动恢复前置）
- **症状**：PS `Set-Content` 预置的配置文件应用读不到，工作区不恢复，无任何报错
- **类别**：D-工具链坑
- **根因**：serde 反序列化拒绝 UTF-8 BOM，且错误被吞
- **处理**：预置文件一律用 Node 写入（天然无 BOM），已收口进 `e2e-real/lib/real-env.cjs`
- **状态**：fixed

### D-005：uv 兜底模式下 debug_start 直接失败
- **日期**：2026-09（调试真机验收）
- **用例**：CDP 侧 `e2e-real/debug-real.cjs`
- **症状**：mock 下调试永远能起；真机无预置解释器时 dap.rs fail fast
- **类别**：A-mock 不忠实 + B-环境前置
- **根因**：uv 兜底模式不支持调试；mock 无解释器概念
- **处理**：CDP fixture 用 `presetInterpreter` 预置真实解释器（等价手动「状态栏 → 选择解释器」）
- **状态**：fixed

### D-006：gutter 像素点击落进引用计数 view zone（flake）
- **日期**：2026-09-25
- **用例**：mock 侧 `shell/e2e/debug/01-functional.spec.ts`、`02-experience.spec.ts`
- **症状**：同一用例时好时坏；探针定位 `elementFromPoint` 命中 GUTTER_VIEW_ZONE 而非 GUTTER_GLYPH_MARGIN
- **类别**：B-真实时序（CodeLens view zone 异步插入改变行视口位置）
- **根因**：`(line-1)*lineHeight` 坐标计算对 view zone 不免疫；debugGutter onMouseDown 对 view zone 直接 return，断点静默丢失
- **处理**：共享 helper `helpers.ts::clickGlyph` 以渲染后的 `.view-line nth(line-1)` 定位（对 zone 免疫）
- **状态**：fixed

### D-007：MC-REAL-WATCH-2 稳定失败——B 窗口 watcher 就绪前的事件不补发
- **日期**：2026-10-01
- **用例**：CDP 侧 `e2e-real/multi-window-real.cjs` MC-REAL-WATCH-2（mock 层无可比用例）
- **症状**：B 窗口打开后立即写 `b_after.py`，30s 内 B 树始终不出现；同流程手动重启 watcher 后立即恢复
- **类别**：B-真实时序
- **根因**：B 窗口「树/编辑器可用」早于「watch_start 完成」（`openWorkspace` 中 `startLsp`/解释器检查等同步链路排在 `startFileWatcher` 之前，Rust 探针实测滞后约 1s）；notify watcher 只上报启动之后的变更，首写落在就绪前则事件永不出现。测试只写一次且不重触 → 确定性失败。产品链路本身无恙（探针全通过 + 手动重启即恢复）
- **处理**：WATCH-2 改为「重触写」——8s 未出现则重写文件触发新变更事件，直至 30s 上限。探针方法：Rust `watch_start/stop/emit` 加时间戳 `println!` 对齐时间线（已还原）
- **附带观察**（未修）：`openWorkspace` 可考虑把 `startFileWatcher` 提前到 `startLsp` 之前（成本低、无依赖），缩小冷启动窗口；真实用户在窗口打开后 ~2s 内建文件才会受影响
- **状态**：fixed（测试侧）

## 避坑速查（基建约定，新脚本必须遵守）

1. 预置 JSON 一律 Node 写入（无 BOM），禁用 PS `Set-Content`（D-004）；
2. 工作区解释器预置走 `presetInterpreter`（对齐 `file_ops.rs::project_hash` 的 sha1[:12]，双变体防 canonicalize 差异）（D-005）；
3. 真机栈断言以 `:行号` 结尾匹配，不匹配文件名（D-002）；
4. 真机断点用 dev 钩子 `__OC_DEBUG_TEST__`，不做真机像素点击（真机 glyph 点击抖动 + D-006 同源问题，真实 gutter 点击在 mock 层 D-FUNC-1 覆盖）；
5. 新真机脚本一律基于 `e2e-real/lib/real-env.cjs::runWithRealApp` 托管生命周期（预检 / 隔离数据根 / tauri dev 启停 / CDP 连接 / 进程树清理 / 汇总），禁止再复制粘贴这套样板；
6. 断言「写文件 → 树刷新」类用例必须带**重触写兜底**（写后超时未出现则重写触发新变更事件）：watcher 只上报启动后的变更，且新窗口的 watcher 就绪晚于树可用（D-007）。
