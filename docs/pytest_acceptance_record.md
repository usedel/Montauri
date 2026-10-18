# pytest 测试运行器验收记录

> 版本：v1.3 · 日期：2026-10-18 · 对应计划 `docs/pytest_dev_plan.md` v1.0
> 范围：**T1–T5 全部交付并验收**（v1.0 覆盖 T1–T4；v1.1 增补 T5 真机 `pytest-real` 12 项检查 + 真机抓出的 5 个 bug，连同 mock 层共 7 个；v1.2 修掉 §6 audit_tokens 两项存量 FAIL 并勘误；**v1.3 venv 误收集修补批**：用户现场 smbter 反馈 venv 三方包测试被收进测试树，§7 记 bug 8/9 与双保险修法）。
> 约束真源：`ci/budgets.toml` · `docs/adr/0010-performance-lightweight-charter.md`

---

## 1. 结论

| 项 | 结果 |
|---|---|
| 功能闭环（发现 → 树 → 运行 / 调试 → 结果 → 失败跳转） | ✅ T1–T4 全部落地 |
| 门禁（cargo / vitest / tsc / budget / e2e / audit_tokens / i18n） | ✅ 全绿，数字见 §5 |
| 预算 | ✅ 全部达标（bundle 6,012/6,050 KB · index chunk 1,600/1,700 KB · 命令 209/209 · 行数全 PASS） |
| 真机验收 | ✅ T5（`shell/e2e-real/pytest-real.cjs` **12 项检查 PASS**（PY-REAL-0..6c），uv 临时 venv + 真 pytest 9.x + 真 debugpy；数字见 §4） |

---

## 2. 交付清单（按里程碑）

### T1 · Rust 命令面 + kind="test" 运行分支

- `shell/src-tauri/src/pytest_cmds.rs`（新，564/650）：`pytest_action` 四动作合一
  （scan / collect / cancel / result）+ junitxml **手写解析**（不引 XML crate）。
- `shell/src-tauri/src/terminal.rs`：kind="test" 分支——合成 `module=pytest` +
  junit-xml 输出路径（后端内部契约，前端不碰 data_root / XML）；命令构造单测覆盖。
- `shell/src-tauri/src/run_env.rs`：提取 `resolve_run_interpreter`，脚本 / 项目 / 测试三处共用。
- `lib.rs` 命令注册；命令面 **200 → 209**（budgets.toml 显式修订 §4）。

### T2 · 第 9 侧栏视图 + 缓存 / 失效

- `views.ts` / `index.html` / `sidebarViews.ts`：登记 `tests` 视图（活动栏 `codicon-beaker`）。
  **动态 import**（与既有 8 视图的静态 import 刻意不同）：`testView` 不进 index 首屏 chunk。
- `testView.ts`（514/600）：scan 骨架先行 + collect 增强 + 分帧渲染（300 行/帧）+ 展开态保留
  + 三态（空 / 收集错误原文 / pytest 未安装）。
- `testRun.ts`（459/460）：scan→collect 两段式 + 单飞闸门 + 令牌 + `dep-fs-changed` 失效
  （1s 防抖合并 + stale chip）+ 切工作区取消在途 collect。

### T3 · 绿箭头 + 运行 / 结果合入 / 重跑失败

- `testGutter.ts`（171/200）：`def test_*` / `class Test*` 行 ▶，点击运行、右键「运行 / 调试此测试」；
  **三方 glyph 协调**（断点 > 测试箭头 > run gutter）。
- `testTreeCore.ts`（383/400）：`buildTestTree` / `scanTestDefs` / `applyResults` /
  `collectFailedIds` / `isTestFileName` / `buildNodeId`——零 app 依赖，vitest 直测。
- 结果合入**不重建 DOM**（只切行 class + 图标 + meta + tooltip）；失败文件自动展开。
- 「重跑失败」一次调用传多个 node id（换行拼接，后端拆）。

### T4 · 调试此测试

- `dap.rs`：`debug_start` / `debug_attach_debuggee` 加 `test_node: Option<String>`（为 Some 时
  合成 `module=pytest` + `args=[test_node]` + `cwd=工作区根`）。
- `debugEntry.ts::debugTest(nodeId)`：绿箭头右键 / 树行菜单入口，复用三态互斥与 PTY 管道模式。

---

## 3. 实测数字

| 指标 | 计划口径 | 实测 | 来源 |
|---|---|---|---|
| scan 骨架首帧（2000 节点 collect 仍在途 1500ms） | ≤ 300ms 可见 | **180 / 183 ms** | e2e PT-11 |
| 展开单文件 100 行（分帧） | 不阻塞 | **138 ms** | e2e PT-11 |
| bundle 增量 | +约 43 KB（余量 60KB） | **+25 KB**（5,987 → 6,012） | budget-check |
| index 首屏 chunk | 持平（testView 动态 import） | **1,600 / 1,700 KB** | budget-check |
| Rust 单测 | 新增 pytest/terminal 构造用例 | **371 passed**（+31） | cargo test |
| vitest | `testTreeCore` 36 例 | **124 文件 / 1,573 用例** | gate-tests unit |
| mock e2e | 新 spec | **12/12**（`e2e/ux/13-pytest-runner.spec.ts`） | e2e |
| 命令面 | 206 → 207（计划）→ **209**（实到） | 209/209 | budget-check |

---

## 4. 验收清单（Gate F）逐项

| # | 项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 打开视图自动收集，树正确（文件 / 类 / 用例 / parametrize，保收集序） | ✅ | PT-1 |
| 2 | 三入口（树行 ▶ / 绿箭头 / gutter 菜单）运行单用例，结果合入，失败跳转 | ✅ | PT-2 / PT-3 / PT-7 / PT-8 |
| 3 | 重跑失败一次调用跑完 | ✅ | PT-4 |
| 4 | 调试此测试断点命中，停止后三态复位 | ✅ 真 debugpy 命中断点（栈顶 :4）+ 复位无孤儿（PY-REAL-5a/5b） | PT-8 + §9 |
| 5 | pytest 未安装四层防线 | ✅ 静态信号 / 预检 / `missing_module` 三态 / toast 出口已接线（PT-5 验三态 DOM）；⚠ **安装命令分支真机实测**留待下轮（本机走已安装路径） | PT-5 + §9 |
| 6 | .py 变更 → 失效 → 自动 / 手动重收 | ✅ | PT-9（stale chip）+ 失效编排单测 |
| 7 | collect 可取消（按钮 + 60s 超时），杀树无孤儿 | ✅ 真机取消 → python 1 → 1（PY-REAL-6c） | PT-10 + §9 |
| 8 | 预算 | ✅ | §5 |
| 9 | 门禁全绿 | ✅（audit_tokens 验收时报 2 项**存量** FAIL，验收当日已修归零，见 §6） | §5 |
| 10 | 真机 `pytest-real` | ✅ **12 项检查 PASS**（PY-REAL-0..6c） | §9 |
| 11 | 文档 | ✅ 本记录 + delivery-overview / roadmap 回写 | §8 |
| 12 | 不卡死（2000 节点 / 连点 / 切视图 / 切工作区） | ✅ 首帧与展开实测见 §3；连点单飞见 PT-12；collect 进行中编辑器可交互（PY-REAL-6b） | PT-11 / PT-12 |

---

## 5. 门禁数字

```
cargo check          ✅ Finished（无 error / 无新增 warning）
cargo test           ✅ 371 passed / 0 failed（2 ignored）
npx tsc --noEmit     ✅ 0 错
gate-tests unit      ✅ 124 文件 / 1,573 用例
npm run build        ✅ built in ~22s
budget-check         ✅ 全部达标（行数 + bundle + index chunk + 命令面 + .ps1 BOM）
e2e（本轮）          ✅ ux+logs 101 · debug+editor 43 · 13-pytest-runner 12/12
audit_tokens         ✅ 全绿（验收时 2 项存量 FAIL 已修，见 §6）
i18n                 ✅ 编译期对齐（en-US 为 Record<ZhKey, string>）+ i18n.test 26 例
```

---

## 6. 存量问题（非本次引入，不回退）

1. **audit_tokens 2 项 FAIL**（验收时为存量 → **验收当日已修，门禁归零**，v1.2）：
   ① `oc-spin` 循环 loading 动画未挂 `--motion`（`.tree-item.tree-running::after`，L955，
   微交互批 T1 树侧运行指示）——循环动画不能时长乘 motion（motion=0 会高频闪糊），
   正确降级是 `animation: none`（`data-reduce-motion` + `prefers-reduced-motion` 双通道
   已压制），故登记进 `audit_tokens.py` 的 `MOTION_EXEMPT` 白名单（与 rx/http-progress-slide
   同类）；② `.tab.drop-before/after` 裸 `box-shadow`（微交互批 T4 拖拽插入位竖线，
   修后 L1075/1076）——改为 **inset 色条**（`inset ±2px 0 0`），命中门禁既有「inset 语义色条」
   豁免，视觉等价且零行数增长（style.css 5,725/5,780 PASS）。验证：audit_tokens 98 项判定
   FAIL 0 · e2e 微交互 7/7（含 T4 拖拽用例）· budget 全 PASS。
   勘误：v1.1 原文写「`.engine-chip`」系笔误——该选择器在 style.css 全历史不存在
   （`git log -S` 零命中；engineChip.ts 渲染的是状态栏 `#status-engine` 文本芯片，无动画），
   L955 实为 `.tree-item.tree-running::after`。另注意 audit_tokens 输出的行号是
   @import 合成源行号（如 L1717/L1835），与源文件行号口径不同。
   本次新增 `styles/testTree.css` **零裸色值 / 零裸阴影 / 零动效**（113 行全走 token）。
2. **`git.ts` / `lsp/client.ts` 逼近上限**：3,264/3,300 与 1,850/1,850（压线），与本次无关。

---

## 7. 本次修掉的七个真 bug（mock e2e / 真机抓出，勿回退）

**mock e2e 层（T4 收尾批）：**

1. **glyph margin 三方协调缺失**：`debugGutter` 的 `onMouseDown` 注册晚于 `testGutter`，
   Monaco 多订阅不可阻断 → 右键测试行弹出的是**断点菜单**、左键点击还会顺带设断点。
   修法：`main` 注入让位谓词 `(line) => isRunGutterLine(line) || isTestGutterLine(line)`
   （沿用 debugGutter 既有的「显式让位」范式）；`isTestGutterLine` 对断点行返回 false，
   保证「断点 > 测试箭头」。回归面 = PT-8 的菜单归属 + 断点计数断言。
2. **单飞闸门漏了 scan 窗口**：`collecting` 只在 collect invoke 期间为真，连点会各自穿过
   闸门（实测连点 3 次 = 3 次 collect）。修法：`refreshTests` 加整轮闸门 `refreshing`
   （scan+collect，finally 释放）；同时把刷新按钮从「取消在途 → 600ms → 重收」改为
   **在途直接返回**（取消有独立入口），杜绝「取消 + 重收」挤在一个按钮上。

**真机 pytest-real 层（T5）：**

3. **scan 返回形状与前端假设不符**（T1/T2 交界 bug，`files is not iterable`）：后端
   `pytest_action` scan 返回 `{ files: [...] }`，前端按裸数组解构 → 打开测试视图即白屏错误态。
   修法：前端对齐 `{ files }` 契约 + mock 同形（mock 必须镜像 Rust 语义的老纪律再次应验）。
4. **失败跳转整条链死亡**：`setTestViewHandlers` 从未被调用（testView 动态 import，
   main 无法静态注入）→ 点失败行名无任何反应。修法：`SidebarViewDeps` 加 `openFile`，
   动态 import 回调里注入。教训：mock e2e 当初没覆盖「失败点击跳转」，集成缝隙漏网。
5. **调试当前行不亮（路径比较裸比较）**：`highlightCurrentLine` 用 `tab.path !== path` 严格
   比较——测试树跳转产生的 tab.path 是**正斜杠**（`fileAbs` 拼接），debugpy 帧是**反斜杠**原样
   → DAP 链路全部正常（stopped/frame/variables 都对）但高亮不画。修法：`normalizePath` 归一化
   （TS 红线「路径比较走 normalizePath」的存量违反，DAP 日志 + pathCmp 对照实锤）。
6. **文件树增量刷新折叠子树**（存量）：`reloadDir` 重建本层时不恢复已展开子目录——根目录一有
   构建产物（pytest 的 `.pytest_cache`）→ watcher → `reloadDir(root)` → 整棵 `tests/` 子树
   折叠回默认态。修法：`buildDir` 渲染目录条目后按 `expandedDirs` 单一真源自动重开。
7. **测试树重建丢子行 + 状态机错位**（存量）：`renderTests` 全量重建只渲染顶层行，
   已展开分组的子行不重渲染，且 `expanded` map 仍记为已展开 → 下一次点击先「折叠」一次才展开。
   修法：`visibleNodes()` 按 map 拍平可见节点后再分帧渲染（`toggleExpand` 增删路径不变）。

**venv 误收集（2026-10-18，用户真实项目现场反馈，T1–T5 之后的修补批）：**

8. **venv 目录下的三方包测试被收进测试树**（48 个 `test_*.py`，项目本体 0 个）：
   根因三层叠加——① `scan` 的共享剪枝名单 `SEARCH_IGNORED_DIRS` 只有 `.venv`，
   无点命名的 `venv` 逃过 `hidden(true)`；② 工作区**非 git 仓库**（无 `.git`）时
   `.gitignore` 里的 `venv/` 因 ignore crate `require_git` 默认 true 而**不生效**；
   ③ `buildTestTree` 无条件把全部 scan 文件建成树行，pytest（默认 `norecursedirs`
   本就含 `venv`）一个用例都没收到的文件仍长期占位。修法：`SEARCH_IGNORED_DIRS`
   补 `venv` / `env` / `virtualenv` / `site-packages` / `dist-packages`（与 dep_health
   的 Python 侧 `_is_local_path` 排除组件对齐）+ `buildTestTree` 第三参
   `pruneEmptyFiles`（仅 collect 成功路径置 true，剔除零用例骨架行）。
   回归面：Rust `test_list_workspace_files_prunes_venv_and_site_packages` +
   vitest pruneEmptyFiles 三例 + e2e PT-13。
9. **`venv` 命名导致解释器自动检测落空**（同一现场的连带缺陷）：
   `env_cmds.rs::venv_python` 原先只认 `.venv` → 该项目的 pytest collect 退
   `uv run pytest` 兜底（且该 venv 未装 pytest）。修法：按序识别
   `.venv` / `venv` / `env`（判据是真实存在 `Scripts/python.exe` / `bin/python`，
   故名 `env` 的普通源码目录不误判）；回归面 = `test_venv_python_alt_names`。

## 8. 文档回写

- `docs/pytest_dev_plan.md`：状态 →「T1–T5 已交付（2026-10-17）」。
- `docs/delivery-overview.md`：pytest 条目（第 32 行）+ 真机验收结论。
- `docs/improvement_and_roadmap_report.md`：B1 → 已交付（含 T5 真机）。
- `ci/budgets.toml`：显式修订 4 条（main.ts 2,410→2,440 · testTreeCore 300→400 ·
  testRun 340→460 · 新文件登记），每条均写明理由（见文件内注释）。
- **v1.3（2026-10-18）**：`docs/pytest_dev_plan.md` §3.2 增补两条口径
  （venv / 三方包目录剪枝 · 零用例骨架行剔除）；§7 增补 bug 8/9。
  预算零调整（search_cmds 1,800/2,000 · testTreeCore 392/400 · testRun 470/470 净 0 ·
  env_cmds 1,515/1,700，非测试代码净 0）。

## 9. T5 真机验收（pytest-real，12 项检查 PASS）

环境：`uv venv`（基座 PATH 中的 python 3.13）+ `uv pip install pytest`（在线 ~2s，缓存兜底
`--offline`）→ 工作区解释器预置指向 venv python（`file_ops::project_hash` 同款 sha1 文件名）；
真 Tauri app（tauri dev）+ CDP 9223 + 隔离数据根；结束 taskkill。

| # | 检查项 | 结果 / 实测 |
|---|---|---|
| 0 | 护栏（驱动的是本次实例） | ✅ 树路径落在本轮临时工作区 |
| 1a | scan 骨架先行（不依赖 collect） | ✅ **412–424ms** 可见 |
| 1b | 真实 collect（文件/函数/类/parametrize 单例） | ✅ 计数 5，**2.4–2.7s**，行级展开正确 |
| 2 | 树行 ▶ 真实 pytest 运行 → is-passed | ✅ 合入 **~3.1s**，终端 label「测试 · test_ok」 |
| 3a | 失败用例 is-failed 合入 | ✅ |
| 3b | 失败点击跳转（激活 test_fail.py + 光标 def 行） | ✅ 芯片「行 3」 |
| 4 | 重跑失败：单例复用（不新增终端）+ 状态保持 | ✅ label 换「测试 · test_bad」 |
| 5a | 调试此测试 → 真 debugpy 命中断点 | ✅ 栈顶 `test_fail.py:4`（`stopped reason=breakpoint`） |
| 5b | 停止调试 → 调试态复位 + 无孤儿 | ✅ python 3 → 1 |
| 6a | .py 变更 → 自动重收（取消按钮现身） | ✅ |
| 6b | collect 进行中编辑器可交互（点击定位 → 芯片更新） | ✅ 不卡死 |
| 6c | 取消 collect → 杀树无孤儿 | ✅ python 1 → 1 |

**真机层方法论沉淀**（跨会话有效）：① 后台窗口下 CDP 键盘输入不落 textarea（`type`/`insertText`
均无效，textarea 已聚焦也没用）——交互断言改用纯渲染进程信号（点击定位 → 光标芯片）；
② `#test-cancel` 这类按钮**永不 detach**（syncToolbar 只切 hidden class），等 `state: 'hidden'`
不是 `'detached'`；③ 侧栏视图切换会改变可见性——跨视图操作（编辑器 ↔ 测试树）必须显式切回；
④ 单例复用语义（run-term-test）下「重跑」不新增终端，断言 label 换名；⑤ 慢挂检查项要在
后端 60s 超时窗口内完成，或挂起时长 > 窗口（本例 test_slow 挂 30s < 60s）；
⑥ DAP 流量监听（`dap-message` 事件 + `__dapLog`）是「链路 vs UI」二分的利器——
本次 5a 靠它实锤 debugpy 正常、纯 UI 层路径比较 bug。

**遗留（非阻塞，下轮迭代）**：① 四层防线的安装命令分支真机实测（pyproject → `uv add --dev`；
bare → `uv pip install`；已声明 → sync 建议）——本机走的是「已安装」路径；② collect 并发大仓
（2000+ 文件）真机耗时基线未采（mock 层已验 2000 节点首帧/分帧）。
