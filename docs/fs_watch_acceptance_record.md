# OpenCharm 外部改动检测验收记录

> 版本：**v1.0** · 日期：2026-10-18 · 对应计划 `docs/fs_watch_dev_plan.md` **v0.2**
> 结论：**T1–T8 全部交付并验收通过**（真机 3/3 · mock e2e 9/9 · 单测 25/25 · Rust 373 · 预算全 PASS）
> 门禁基线：`tsc` 0 错 · vitest **125 文件 / 1598 用例**（本批 +25）· cargo **373 通过**（watcher 6/6）· budget-check **全 PASS**

---

## 1. 交付清单

| 任务 | 内容 | 落地文件 |
|---|---|---|
| T1 | Rust 文件级结构化事件 `fs-file-changed` + 准入函数 + 3 组单测 | `shell/src-tauri/src/watcher.rs`（291 → 355 行） |
| T2 | 前端纯逻辑层（判定 / 单飞 / pending / dirty 守卫 / unreadable 分支）+ 25 例单测 | `shell/src/externalChange.ts`（316 行）· `shell/src/__tests__/externalChange.test.ts`（294 行） |
| T3 | 接线：saveTab 冲突闸门、openChoice 两语义、另存为、tab 标记、dirty 守卫复位 | `shell/src/main.ts`（+9 行，2438/2440）· `shell/src/styles/externalChange.css`（21 行） |
| T4 | i18n `watch` 域 11 词条（生成器全流程） | `tools/i18n/data/watch_{zh,en}.json` · `locales/{zh-CN,en-US}/watch.ts` + 两 index.ts 登记 |
| T5 | mock e2e 9 用例 | `shell/e2e/editor/13-external-change.spec.ts`（E-EXT-1..9 全绿） |
| T6 | 真机 CDP 3 项 | `shell/e2e-real/external-change-real.cjs`（EC-REAL-1..3 PASS）+ `run-real-all.ps1` / `nightly.yml` 登记 |
| T7 | W0：`startFileWatcher` 前置到 startLsp 之前；预算登记 5 项 | `main.ts::openWorkspace` · `ci/budgets.toml` + `budget-check.mjs` |
| T8 | 文档收尾 | 本文件 + 计划状态行 + `docs/tech-debt.md`（§4）+ `docs/delivery-overview.md`（§3） |

## 2. 实现相对计划的偏差（逐条对账）

| 计划 | 实际 | 说明 |
|---|---|---|
| §4.2 新增 `fs-file-changed`，只发文件不发目录 | ✅ 按计划。发射顺序 fs-changed → **fs-file-changed** → dep-fs-changed → dep-env-changed（契约写进 watcher.rs 注释） | 准入复用 `emit_file_path()`（噪声过滤三事件共用一道闸），避免死代码 |
| §4.3 内容比对代替事件类型 | ✅ 按计划 | 实测确认：自身保存回声 → identical → 无动作（E-EXT-5 钉死） |
| §4.3 读盘失败不判 removed | ✅ 按计划（`unreadable` 分支） | 命令面无 `path_exists`（已逐个确认 17 个命令），只 toast 不关 tab |
| §4.5「另存为…」 | 用 plugin-dialog `save()` + `write_file`；另加**同路径拒绝**（初版没写，实现期补） | 计划里未提「另存目标 = 源路径」这个自伤路径，实测把它堵了 |
| §4.6 保存拦截 | ✅ 按计划 | `savingByUs` 标志防 saveTab 递归再弹面板（单测钉死嵌套调用返回 false） |
| §4.7 dirty 复位守卫 | ✅ 按计划，且**真机 EC-REAL-1 实证**：自动重载后脏圆点=0 | 这条是全批最高价值的不变式 |
| §4.8 虚拟 tab 跳过 | 用「只认普通文件 tab」正向判定（`kind === undefined \|\| "file"`），比枚举四种 kind 更稳 | 计划提的是枚举判据；实测发现枚举法容易漏（`kind` 可选），改正向 |
| §5 预估 bundle +6~10 KB | **实测 +5 KB**（6012 → 6017 / 6050）；index chunk 1606/1700 持平 | 比预估省 |
| §7.2 mock 桥扩 `emitFsFileChanged` | **改为 spec 内直接 `__emit`**（PT-9 先例） | 若让 helpers 的 FS_WRITE_CMDS 自动推本事件，所有「bridge 改盘 + 编辑器开着」的既有 spec 行为会变（自动重载/弹面板）；另立有意的对齐 |
| §9 预估 3.5d | 实际约 1 个工作日（含真机），低估的部分被计划阶段的复核补回 | — |

## 3. 门禁数字（本批实测）

| 门禁 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错 |
| vitest | **125 文件 / 1598 用例全绿**（新增 `externalChange.test.ts` 25 例） |
| cargo test | **373 通过**（watcher 6/6，新增 2 组） |
| e2e `editor` 域 | 全绿（含新 `13-external-change` 9/9） |
| e2e `e2e-ui`（12 spec / 66 用例） | 65 passed / **1 failed = 存量**（UX-6，stash 对照在原始代码上同样失败，与本批无关；见 §5） |
| 真机 `external-change-real` | **EC-REAL-1/2/3 PASS**（43.5s，真实 notify + 真实 read_file + 真实 Ctrl+S） |
| budget-check | **全 PASS**：watcher.rs 355/410 · externalChange.ts 316/380 · 单测 294/340 · CSS 21/60 · main.ts 2438/2440 · bundle 6017/6050 · index 1606/1700 · 命令面 209/209（**+0**） |

## 4. 后续清偿（2026-10-18 同日，TD-029 ①②③⑤ 闭环）

同日继续清偿 `tech-debt.md` TD-029（明细见该条目），**①–⑥ 全部闭环**：

| # | 项 | 落地要点 | 验证 |
|---|---|---|---|
| ① | 监听范围瘦身 | 根 NonRecursive + 非忽略顶层目录逐个 Recursive；运行期新顶层目录动态补订阅（`try_lock`，不阻塞） | Rust 2 组单测 + 真机 **EC-REAL-4 PASS** |
| ② | 监听健康度 | `fs-watch-health` 事件 + `#status-watch` 状态栏芯片 + 有界自动重订阅（2s/6s）+ 收到 `fs-changed` 即复位 | 单测 5 例 + e2e E-EXT-12/13 |
| ③ | 两套 watcher 合并 | `spawn_dir_watcher` 成唯一装配入口；插件目录复用并同样上报错误 | cargo 375；plugins 域 e2e 绿 |
| ⑤ | 批量冲突面板 | 整批先静默处理完毕，>1 个冲突合并为一次询问（逐个/全部重载/稍后） | e2e E-EXT-11 |
| ④ | mock 载荷分叉 | ✅ 已闭环：bridge 改推**父目录**（与 Rust 同口径），mock 层文件树增量刷新从此真正生效 | e2e 广域 241 全过 |
| ⑥ | UX-6 存量回归 | ✅ 已闭环（根因在 `fileTree.ts::restoreExpandedDirs` 对已展开目录重复 toggle → 写穿 localStorage） | `e2e/ux/01` 单独跑 10/10 |

**顺带修掉的既有缺口**：notify 对「新建目录」只给目录自身事件 → 父层不刷新 → 真机实测 mkdir 后树里看不到新目录。修法：目录事件连父目录一起发 `fs-changed`（真机 EC-REAL-4 暴露并证伪/证实）。

**门禁**：tsc 0 错 · vitest **126 文件 / 1608 用例** · cargo **375 通过** · e2e 广域（git/ux/editor/p4/session/plugins/p3）**241 全过** · 真机 `external-change-real` **4/4** · budget 全 PASS。
预算变动：`watcher_rs_max_lines` 410→580（①②③ 都落在该文件，实测 531）；新登记 `watch_health_ts` 170 / `watch_health_test_ts` 110 / `styles_watchhealth_css` 45。

## 5. 计划期已识别、本批未做（登记备查）

| 项 | 状态 |
|---|---|
| W2 监听范围瘦身（顶层目录粒度 watch，跳过大目录） | 未做（性能批，需 bench/large_repo 回归） |
| W3 监听健康度上报（失败/溢出 → 状态栏 + 重订阅） | 未做 |
| W4 两套 watcher（插件目录 vs 工作区）合并 | 未做 |
| W5 事件类型精确化（换 notify-debouncer-full） | **裁决不做**（内容比对已够；增依赖违反「默认轻量」） |
| §7.4 既有 A-mock 不忠实（`helpers.ts:1160` 推文件路径，Rust 推父目录 → mock 层文件树不刷新） | 仅登记，修它另立小项（会打到既有 git/ux 期望） |
| 批量冲突合并面板（git checkout 改多文件时逐个弹） | M1 未做；有 800ms 单飞 + 串行处理兜底，人工验收记录在 §5 |
| 开启 autosave 时的冲突弹面板时序 | 未专项验（gate 对所有 saveTab 入口生效，语义正确） |

## 6. 人工验收记录（待用户补登）

- [ ] ① 外部编辑器改 `main.py` → 三选一各点一遍，圆点/灰态符合预期
- [ ] ② git 切分支改多个已打开文件 → 逐个弹面板是否可接受（M1 未做批量合并）
- [ ] ③ `.venv` 里 pip install → 不弹面板（`should_ignore` 回归；真机 EC 套件已覆盖 `.venv` 之外的忽略项）
- [ ] ④ 网络盘 / OneDrive 暂停同步 → 不误关 tab（`unreadable` 只提示）
- [ ] ⑤ 关工作区再开 → pending 标记不残留（`startFileWatcher` 收尾复位 + 每次装饰同步剪枝）

## 7. 已知存量问题（与本批无关，stash 对照实证）

`e2e/ux/01-ux-batch.spec.ts` **UX-6「文件树展开状态跨会话持久化；刷新后滚动位置恢复」** 在
`git stash` 掉本批前端改动后同样失败（1 failed / 9 passed）→ 存量回归，需另立小项排查
（现象：`page.reload()` 后深层目录 `deep.py` 15s 内不出现在树里）。
