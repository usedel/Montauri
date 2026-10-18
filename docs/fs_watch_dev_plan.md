# Montauri 文件监听（notify）增强开发计划

> 版本：**v1.0（已交付）** · 日期：2026-10-18 · 状态：**T1–T8 全部交付并验收通过**
> 验收记录：`docs/fs_watch_acceptance_record.md` **v1.0**（门禁数字 + 真机 3/3 + 实现偏差对账真源）
> 修订：v0.2 复核轮（修正 5 处事实错误 + §3.4 ADR 判断 + §4.7 dirty 陷阱）· v1.0 交付轮（实现偏差与实测数字回填，见 §12）
> 关联真源：`docs/pytest_dev_plan.md` v1.0（`dep-fs-changed` 消费方先例）· `docs/dep_health_dev_plan.md` v1.7（§4.4 失效矩阵与 site-packages 例外）· `docs/e2e_divergence_ledger.md` D-007（watcher 就绪窗口）· `docs/adr/0010-performance-lightweight-charter.md`（性能与体积一等目标）
> 约束：`ci/budgets.toml`（命令面 209 / bundle 6,050 KB / 文件行数）+ `.codebuddy/rules/rust-code-style`、`typescript-code-style`

---

## 0. 前提纠正：本计划不是「引入 notify」

**`notify` 早已是依赖，且是工作区刷新的主链路。** 讨论「引入文件监听 notify」时需先对齐这一事实，避免重复立项或重复造轮子。

```27:27:shell/src-tauri/Cargo.toml
notify-debouncer-mini = "0.6"
```

`cargo tree -i notify` 实测：`notify v8.2.0` ← `notify-debouncer-mini v0.6.0` ← `montauri-shell`（2026-10-17 核实）。本计划要处理的是**已存在监听能力的缺口**，不是新增依赖或新增监听器。

---

## 1. 现状盘点（可复用基建）

| 能力 | 现状（代码位置） | 本计划的关系 |
|---|---|---|
| 工作区递归监听 | `watcher.rs::watch_start`（每窗口一实例，`PerWindow<Debouncer<RecommendedWatcher>>`，300ms 防抖） | 复用，**不新建 watcher** |
| 附加监听 | `<data_root>/config`（NonRecursive，用户级 Live Templates 热重载） | 复用 |
| 目录级事件 | `fs-changed`（`Vec<String>`，**只发受影响父目录**，`watcher.rs:160-162`） | 服务文件树 / git 增量 / diff 重拉 / QuickOpen 缓存失效 / 无 .py 工作区补起引擎 |
| 文件级事件 | `dep-fs-changed`（`DepFileEvent{path, kind}`，`kind ∈ {py, declaration}`，`watcher.rs:152-158`） | 只覆盖 `.py` 与声明文件，**外部改动检测不能复用它的过滤**（§4.2） |
| 环境信号 | `dep-env-changed`（`.venv` 下 `RECORD` / `*.dist-info` 例外放行，`is_site_packages_signal`） | 与本计划正交 |
| 噪声过滤 | `should_ignore`（`.git` / `.venv` / `node_modules` / `__pycache__` / `.idea` / `.vscode` + `__montauri_selection__` 前缀），**事后过滤** | 复用判据；「事前不监听」属 W2（§11） |
| 前端消费 | `main.ts::handleFsChanged`（200ms 二次防抖 → `reloadDir` / `refreshGitStatus(relPaths)` / `renderGitPanel` / `refreshDiffIfViewing` / `invalidateQuickOpenFiles` / `loadTemplatesConfig`） | 复用防抖与归一手法，不改其行为 |
| 生命周期 | `openWorkspace` → `watch_start`（`main.ts:713`）· `closeWorkspace` → `watch_stop` · 窗口关闭 `window_mgr.rs:194` · 退出 `watch_stop_all_for_exit` | 已完备 |
| 脏状态 | `Tab.dirty`（`state.ts:18-22`，`saveTab` 落盘后置 false，`main.ts:1421`）；**会话快照持久化未保存内容**（`sessions.rs::SessionTab.draft: Option<String>`） | 冲突判定与「稍后处理」的兜底依据（§8） |
| 统一对话框 | `dialog.ts::openChoice`（三按钮 ok / neutral / cancel，`ChoiceResult`，`dialog.ts:187-246`） | 冲突裁决面板（§4.5）；**禁用** `window.confirm` 与 plugin-dialog |
| 读盘 | `fs_cmds.rs::read_file`（10 MB 守卫）/ `write_file` | 内容比对与落盘，**零新命令**（§5） |
| Rust 单测 | `watcher.rs` 4 组（忽略判定 / dep 分类 / site-packages 信号 / 相对路径） | 新增纯函数沿同款 `#[cfg(test)]` 内联 |
| e2e mock 桥 | `helpers.ts::emitFsChanged`（推 `fs-changed`）；`FS_WRITE_CMDS` / `GIT_WRITE_CMDS` 写命令后自动推送 | 需扩一个结构化事件通道（§7.2） |

---

## 2. 缺口清单

按「用户可感知缺陷 > 性能损耗 > 内部整洁」排序。

| # | 缺口 | 现象 | 级 | 预估 |
|---|---|---|---|---|
| **W1** | **外部修改已打开文件：零处理** | 全库搜不到「文件已被磁盘修改」词条或代码路径。git checkout / 外部编辑器 / 代码生成器改了正在编辑的 tab，Monaco 不重载也不提示；用户 Ctrl+S 直接静默覆盖外部改动，且会话快照里的 `draft` 也随之被覆盖 —— **改动不可恢复** | **P0** | 3.5d（见 §9） |
| W2 | 忽略清单是「事后过滤」不是「事前不监听」 | 对根目录一次性 `Recursive`，`.venv` / `node_modules` / `__pycache__` 的事件照样进 Rust 回调再被丢弃；大仓纯开销。notify 8 无原生 exclude | P2（性能） | 1d + bench 回归 |
| W3 | 监听健康度无上报 | `watch_start` 失败只 `console.warn`（`main.ts:714-716`）；网络盘 / OneDrive 同步目录上 `ReadDirectoryChangesW` 缓冲区溢出丢事件，无溢出后重订阅路径 | P2 | 0.5~1d |
| W4 | 两套 watcher 逻辑重复 | `plugin_cmds.rs:250` 的 `PLUGIN_WATCHER` 与 `watcher.rs` 各有一套 debouncer + 各自的忽略/转发逻辑 | P3（整洁） | 0.5d |
| W5 | 事件类型不可区分 | `notify-debouncer-mini` 的 `DebouncedEvent` 只有 `path` + `kind(Any/AnyContinuous)`，无 create/modify/remove | 见 §4.3 | 换 `debouncer-full` ≈ 0（**但加依赖，不建议**） |
| W6 | 改动 watcher 语义门禁抓不到 | mock 层通知是模拟的（`helpers.ts:923`），真机层无 watcher 用例 | P2（工程） | 含在 W1 的测试里 |

---

## 3. 范围裁决（草案，待产品负责人确认）

### 3.1 本期（M1）

| 项 | 内容 |
|---|---|
| **W1** | 外部修改检测：未脏 tab 自动重载；脏 tab 弹「另存为 / 用磁盘版本重载 / 稍后处理」三选一（**用户 2026-10-17 裁决：提示 + 三选一，不做静默重载**） |
| **W0** | 顺手项：把 `startFileWatcher` 在 `openWorkspace` 中提前到 `startLsp` 之前（收敛 D-007 记录的 ~1s「树可用但 watcher 未就绪」窗口；零风险、纯顺序调整） |

### 3.2 登记不排期（候选，需各自前置条件）

- **W2** 监听范围瘦身（性能批，须配 `bench/large_repo` 回归；章程「运行时开销红线」同类要求）
- **W3** 监听健康度上报（需新增状态栏 UI 面，另议）
- **W4** 两套 watcher 合并（纯内部整洁，可搭车任一批次）
- **W5** 事件类型精确化（**裁决倾向：不做**。§4.3 证明内容比对足以推导全部必要语义，换 `debouncer-full` 违反「默认轻量」铁律）

### 3.3 明确不做

| 不做 | 理由 |
|---|---|
| 换 `notify-debouncer-full` / `notify` 直用 | 增依赖，而收益可由内容比对替代（§4.3） |
| 目录级冲突面板（一次裁决多个文件） | M1 单文件粒度即闭环；批量场景（git checkout 改 20 个文件）会弹 20 次 —— 见 §8 缓解措施 |
| 文件被删的冲突裁决 / 自动关 tab | **删除也走「只提示不动作」**（§4.3）：命令面无 `path_exists`，读盘失败无法与 10MB 守卫、网络盘 IO 错误区分，关 tab 属误关 |
| 冲突历史 / 差异对比窗 | 属 Local History 议题（`pycharm_feature_research_report.md` E7），不在本计划 |
| 监听范围可配置（settings 项） | 违反「轻量」定位；忽略清单是产品决策不是用户偏好 |

### 3.4 ADR 判断：不新增

按「重大设计决策先写 ADR」逐条过：本批**零新依赖、零新进程、零新命令、零持久化格式变更**，属「既有监听的消费侧接线」，不构成架构决策 → **不写 ADR**。唯一带契约性质的新事件 `fs-file-changed` 以本计划为单一真源；若后续要升级为对外承诺的稳定契约（如供第三方插件消费），届时补 ADR-000x 并回写本节。

---

## 4. W1 详细设计：外部修改检测

### 4.1 数据流

```
notify（磁盘变更）
  └─ debouncer 300ms
      └─ watcher 回调 ── emit "fs-file-changed"（结构化，本计划新增）
          └─ main.ts 单行 listen 接线
              └─ externalChange.ts（本计划新增模块）
                  ├─ 命中普通文件 tab？路径 samePath 归一（diff/md/csv/db 虚拟 tab 跳过）
                  ├─ 并发/风暴抑制：同一路径 800ms 内只处理一次
                  ├─ invoke("read_file") 取磁盘内容
                  ├─ classifyExternalChange(model 内容, 磁盘内容|null) → identical / reload / conflict / unreadable
                  │     ├─ identical → 无动作（吞掉自身保存的回声，§4.3）
                  │     ├─ reload    → model.setValue + **内容守卫后**的 dirty 复位（§4.7 陷阱）+ LSP 通知
                  │     ├─ conflict  → 标 pendingExternal + tab 装饰 + 三选一面板（§4.5）
                  │     └─ unreadable→ 只提示不动作（§4.3：不自动关 tab）
                  └─ 独立 200ms 防抖（照 handleFsChanged 手法）
```

**三条边界（与本功能的独立性，实现时不得越界）**：

- **不广播额外失效信号**：depHealth / pytest 测试树的缓存失效由 `dep-fs-changed` 独立驱动（`depHealth.ts` / `testRun.ts` 各订阅各的），与本功能并行；重载或覆盖磁盘都不再触发第二重扫，避免同一次磁盘变更被消费三遍。
- **不手动刷新 LSP / 红箭头 / 大纲 / 问题面板**：`model.setValue` 走的 `onDidChangeContent` 已把这些全带起来 —— pyrefly 增量同步（`lsp.didChange`）、绿箭头（`testGutter.ts:98-101`，200ms 防抖 + 指纹短路）、大纲（`main.ts:1636-1640`，500ms 防抖）、问题面板随 markers。本功能只改内容与 `dirty`，**任何手动 refresh 调用都是重复劳动**。
- **不自己写 session**：`dirty` 复位后由既有快照链路处理，不新增写入点。

### 4.2 事件契约：新增 `fs-file-changed`，不改 `fs-changed`

| 载荷 | 说明 |
|---|---|
| `Vec<String>` | 受影响**文件**的绝对路径（与 `fs-changed` 的目录口径并列，互不干扰） |
| 发出条件 | 通过 `should_ignore` 且**不是**目录、**不是** `__montauri_selection__*` 临时文件；`site-packages` 例外信号仍只走 `dep-env-changed`（不重复发） |

**为什么加新事件而不改 `fs-changed` 的形状**：`fs-changed` 已有 4 个消费点（`main.ts::handleFsChanged`）+ e2e mock 桥 + 真机套件依赖其「目录」语义；改成结构体是破坏性变更且无收益。新事件是纯加法，符合项目「新能力一律加法」的既有惯例。

**为什么不复用 `dep-fs-changed`**：它的 `classify_dep_file` 只放行 `.py` 与声明文件（`watcher.rs:77-90`），外部改动检测必须覆盖工作区里所有已打开的文件（`.md` / `.txt` / `.json` / `.csv` …）。

**发射顺序**（同一 debounce 批次内固定）：`fs-changed` → **`fs-file-changed`（新）** → `dep-fs-changed` → `dep-env-changed`。四个事件的前端消费各自独立防抖，**顺序不构成契约**，任何消费方不得依赖另一个事件的到达时序。

### 4.3 判定算法（核心技术裁决：内容比对，零新依赖）

`notify-debouncer-mini` 不给 create/modify/remove（§2 W5）。**但本功能不需要事件类型** —— 读盘比对即可推导全部必要语义：

| 磁盘状态 | 判定 | 动作 |
|---|---|---|
| 读盘成功且内容 == model 当前值 | `identical` | **无动作**。这就是「自身保存回声」的天然抑制器 |
| 读盘成功且 `tab.dirty == false` | `reload` | 自动重载（用户没在改，磁盘是唯一真源） |
| 读盘成功且 `tab.dirty == true` | `conflict` | 三选一面板（§4.5） |
| 读盘失败 | `unreadable` | **只提示、不动作**：入 pendingExternal + toast「可能已被删除或无法读取」；**不自动关 tab**（理由见下） |
| 用户主动点该文件且读盘仍失败 | — | 走既有 `openFile` → `read_file` 失败 → 已有 toast 报错链路，删除语义由此自然呈现 |

**为什么读盘失败不判 `removed`（已核实命令面）**：当前**没有** `path_exists` / `metadata` 类命令（`fs_cmds.rs` 的 17 个命令已逐个确认），而 `read_file` 的失败混着三种原因 —— ① 文件确实被删；② 命中 10 MB 守卫（`fs_cmds.rs:54-55`）；③ 网络盘瞬时 IO 错误 / 权限不足。把三种一律当「已删除」会在网络盘 / OneDrive 同步目录上误关用户 tab，且没有便宜的精确化手段。方案：**只提示不动作**，删除语义由「用户主动打开该文件」这条既有链路兜底。若后续确需精确判定，`path_exists` 会撞 `max_tauri_commands` 信号线（209），须单独讨论。

**为什么不用「时间窗抑制」**（保存后 N 毫秒内忽略该路径事件）：时间窗会连带吞掉窗口内的**真**外部改动（保存后立刻被 git 覆盖的经典丢改动场景），且需要 mtime 命令（当前无此命令）。内容比对无窗口、无漏判、无新命令 —— 这是本计划最重要的一条裁决。

**并发抑制**：`pendingExternal: Set<path>` + 每路径 800ms 单飞（照 `testRun` 失效合并 / `waitReferencesStable` 范式），防 git checkout 批量改动时面板连弹。

### 4.4 决策落地的重校验（防「面板开着用户又改了」）

面板打开到用户点按之间，model 可能再变（autosave / 用户继续敲字）。落地前必须重校验：

1. `tab.dirty` 仍为 true 且 `model.getValue()` 仍等于面板弹出时的快照 → 正常执行决策；
2. 内容已变 → **不执行**任何破坏性动作，toast 提示「内容已变化，请重新处理」并清 pending。

（自动重载路径同理：`setValue` 前重读一次，避免覆盖刚发生的编辑。）

### 4.5 冲突面板：三选一（`openChoice` 映射）

复用 `dialog.ts::openChoice`（已有三按钮 + `ChoiceResult`，且 Esc / 点遮罩 = cancel 的安全出口约定、`activeFinish` 强制裁决机制均已实现）。

| 按钮 | 语义 | 实现 |
|---|---|---|
| **ok（主按钮）** | **另存为…** —— 保住我的改动，无破坏性 | `@tauri-apps/plugin-dialog` 的 `save()`（`dialog.ts:3` 规则明示豁免 open/save 文件选择）+ 既有 `write_file`。先例 `sqliteTabs.ts:619-623`：`saveDialog({ defaultPath, filters })`，用户取消返回 null。**不计命令面**（JS 侧调用，不是 `#[tauri::command]`）。另存成功后 toast 提示，**不自动打开**新文件（避免抢焦点） |
| **neutral** | **用磁盘版本重载** —— 丢弃我的修改（用户在明确知情下选择） | `read_file` → `model.setValue` → **内容守卫后的** `dirty=false`（必须读 §4.7）→ LSP 随 `onDidChangeContent` 自动同步，无手动调用 |
| **cancel / Esc / 遮罩** | **稍后处理** —— 什么都不做，我的缓冲原样保留；pending 标记与 tab 装饰保留，Ctrl+S 时再决策（§4.6） | 无动作 |

**「覆盖磁盘」为何不设独立按钮**：它需要第二层确认（覆盖的是对方的改动），而对话框第三档必须留给安全出口。入口改为 §4.6 的保存流程 —— 既少一个按钮，又堵住「稍后处理后随手 Ctrl+S 静默覆盖」这个真正的病根。

**「用磁盘版本重载」会清空 Monaco undo 栈**（`setValue` 语义）：可接受 —— 用户在知情下显式选择，且未保存内容此刻仍在会话 `draft` 里（除非 autosave 已把它写盘，那本来就与磁盘一致）。

### 4.6 保存路径的冲突拦截（同一决策面板，第二种语义）

`saveTab` 写盘前检查 `pendingExternal` 命中；命中则不直接写，弹同一面板但按钮语义改为：

| 按钮 | 语义 |
|---|---|
| **ok** | 用我的版本覆盖磁盘并保存（`saveTab(tab, { runOnSaveActions: false })` —— **必须关保存动作**，否则 ruff 会重排/格式化外部内容，把一次「保存」变成「改写对方代码」） |
| **neutral** | 用磁盘版本重载（放弃我的修改） |
| **cancel / Esc** | 取消本次保存（缓冲不动） |

### 4.7 `dirty` 复位陷阱（实现高危，动键盘前必读）

置脏是**统一集中点**：`main.ts:1009-1014` 的 `model.onDidChangeContent` 在**任何**内容变化（含程序化的 `setValue`）时把 `tab.dirty = true` 并 `renderTabs()`；另一个写入点 `session.ts:125` 是恢复 draft，语义正确。由此推出两个后果：

1. **纯 `model.setValue(磁盘内容)` 会自动重载会把 tab 置脏** —— 重载后 tab 显示未保存圆点，且会话快照会把**整个文件内容**存成 `draft`（`sessions.rs::SessionTab.draft`），把「与磁盘一致」伪装成「有未保存修改」。这是本方案最容易埋、且 e2e 视觉断言的天然盲区（内容是新的，圆点却是脏的）。
2. **`identical` 分支也应顺带清脏**：用户改了几下又 Ctrl+Z（或 autosave）回成与磁盘一致时，`tab.dirty` 仍为 true，圆点常驻。

因此每个「重载 / identical」路径都必须 **setValue 之后、内容守卫成立才复位**：

```ts
const applied = expectedDiskText;               // 本次读到的磁盘文本
model.setValue(applied);
if (model.getValue() === applied) { tab.dirty = false; renderTabs(); }   // 守卫：用户已继续编辑则不清
```

- 守卫不是形式主义：`setValue` 与复位之间存在窗口，用户此时敲键会让 `getValue()` 偏离 `applied` —— 此时**必须保留脏标记**，宁可留给下一轮冲突流程，绝不吞掉用户的编辑。
- 该逻辑必须进单测（§7.1 用例 9）并进 e2e 视觉断言（圆点消失，用例 E-EXT-1/E-EXT-3）。
- 「重载」会清空 Monaco undo 栈（`setValue` 语义）：可接受 —— 用户在知情下显式选择。但注意**自动重载路径用户没有按钮可点**，若需undo护底可退化为「identical 才自动重载、其余一律先问」，这条是实施时可按实测颤噪度回退的开关。

### 4.8 状态与不变式

- `pendingExternal: Set<string>`（**内存态，不落盘**）：路径归一后存，消费后即删；`closeWorkspace` / `closeTab` 清理。
- 虚拟 tab 一律不参与：`isVirtualTab(tab)` 只覆盖 md / csv（`virtualTabs.ts:68-70`），因此必须**另加** `tab.kind === "diff"` 与 `kind === "db"`（SQLite 数据/查询 Tab，同为占位 model）判定。更稳的做法：比对前统一走 `tabRealPath(tab.path)` 取真实路径（`virtualTabs.ts` 的 path 前缀解析是唯一真源）—— `mdpreview:` / `csvtab:` / `diff:` / `db-data:` / `db-query:` 前缀天然匹配不上事件路径，等于**双重保险**。
- 只处理「有对应 tab」的事件：不在 tab 里的文件变更走既有 `fs-changed` 链路（树/git），不额外读盘（**大仓下这是关键的性能闸门**：一次 git checkout 若产生 500 个文件事件，只有已打开的那些会触发 `read_file`）。
- LSP 一致性：重载走 `model.setValue`，Monaco 自动触发 `onDidChangeContent` → 引擎增量同步，**不额外调 `didSave`**（那不是保存，会误导引擎与运行前预检）。
- 多窗口：事件经 `emit_to(wid)` 天然按窗口分流，零额外处理。

### 4.9 模块落点（拆分纪律：`main.ts` 已 2,429/2,440 禁入）

| 文件 | 内容 | 预算 |
|---|---|---|
| **新建** `shell/src/externalChange.ts` | 纯逻辑层（`classifyExternalChange` / 路径归一 / 单飞与 pending 状态）+ 接线（listen 注册、面板、保存拦截）。零新增第三方依赖 | 首次登记，上限按实测 +25% |
| **新建** `shell/src/__tests__/externalChange.test.ts` | 纯逻辑单测（`vi.mock` 替 `dialog.ts` / `state.ts`） | — |
| `shell/src/main.ts` | **+2 行以内**：`wireExternalChange()` 调用（照 `wireDepHealthEvents()` 先例，§`main.ts:2414-2415`） | 已在 2,440 上限内 |
| `shell/src-tauri/src/watcher.rs` | +约 15 行：结构化事件发射（复用现有 `should_ignore` / `relative_to_root`，无新依赖） | **该文件当前不在预算面**，本批首次登记（见 §5） |
| `shell/e2e/helpers.ts` | 新增结构化事件派发通道（§7.2） | 非预算面 |
| `shell/e2e/editor/13-external-change.spec.ts` | 新建 spec | 非预算面 |

---

## 5. 预算与命令面（先算账，再动工）

| 项 | 现状 | 本批影响 | 裁决 |
|---|---|---|---|
| **命令面** | 209 / 209（`max_tauri_commands`，warn_only 信号线） | **+0**：复用 `read_file` / `write_file`；另存走 plugin-dialog `save()`（JS 侧调用，不计命令面）；无新 `#[tauri::command]` | 不撞线，无需扩预算 |
| **bundle** | 6,012 / 6,050 KB（余量 38 KB） | 预估 +6~10 KB（`externalChange.ts` 约 5 KB + i18n 词条）；**建议动态 import**（照 `testView` 先例）以免进 index 首屏 | 在余量内；仍按「动态 import」执行，`index_chunk_kb` 1,700 不动 |
| **`main.ts`** | 2,429 / 2,440 | +2 | 禁入新逻辑，只留接线 |
| **`watcher.rs`** | 291 行，**不在预算面** | +15 | **首次登记** `watcher_rs_max_lines`（照 `endpointView`「首次登记」先例，设 360） |
| **`externalChange.ts`** | 新文件 | 预估 ~230 | 首次登记，设 ~290（实测 +25%，不按拍脑袋低估） |
| 运行时开销 | probe 开销红线 1.35x | 无新增常驻进程 / 定时器（单飞窗口走已有 setTimeout 范式） | 不触红线 |

---

## 6. i18n（`docs/i18n.md` 三步流程）

新词条走功能域流程：映射登记 → `apply_ts.py` 改写源码 → `gen_domain.py --domain watch` 生成 `locales/{zh-CN,en-US}/watch.ts`。

| key | 中文 | English |
|---|---|---|
| `watch.conflict.title` | 文件已被外部修改 | File changed on disk |
| `watch.conflict.message` | `{name} 在磁盘上已被其他程序修改。你的修改尚未保存。` | `{name} was modified on disk by another program. Your changes are unsaved.` |
| `watch.conflict.saveAs` | 另存为… | Save As… |
| `watch.conflict.reload` | 用磁盘版本重载 | Reload from Disk |
| `watch.conflict.later` | 稍后处理 | Decide Later |
| `watch.conflict.overwrite` | 用我的版本覆盖磁盘 | Overwrite with My Version |
| `watch.conflict.cancelSave` | 取消保存 | Cancel Save |
| `watch.conflict.changed` | 内容已变化，请重新处理 | Content changed; please decide again |
| `watch.unreadable` | `{name}` 可能已被删除或无法读取，请手动确认 | `{name}` may have been deleted or cannot be read; check manually |

注意：生成器是**全量重写**，登记后须 `git diff` 扫一眼有无意外删除（`docs/i18n.md` 踩坑记录）。

---

## 7. 测试口径

### 7.1 单测（vitest，纯逻辑）

`externalChange.test.ts` 用例矩阵：

1. `classifyExternalChange`：内容相同 → `identical`（**回声抑制核心用例**）；未脏 + 内容不同 → `reload`；脏 + 内容不同 → `conflict`；**读盘失败 → `unreadable`（不产生任何写盘/关 tab 动作）**。
2. 路径归一：大小写 / 正斜杠 / `samePath` 口径一致（TS 规范铁律：禁手写 `replace + toLowerCase`）。
3. 虚拟 tab 跳过：`kind="diff"` / `kind="db"` / md / csv 一律返回 `null`（不进判定）；`db-data:` / `db-query:` / `mdpreview:` 前缀经 `tabRealPath` 取真路径后仍匹配不上事件路径（双重保险各验一次）。
4. 单飞：同路径 800ms 内连续 3 次事件 → 只处理 1 次。
5. pending 生命周期：命中入集合 → 决策后移除 → `closeTab` 清理。
6. 重校验（§4.4）：面板期间内容变化 → 不执行破坏性动作。
7. 「覆盖磁盘」必传 `runOnSaveActions: false`（断言写盘内容 == model 原文，未被 ruff 改写）。
8. **`dirty` 复位守卫（§4.7，最高优先级用例）**：`setValue` 后内容 == 期望文本 → `dirty` 复位且圆点消失；`setValue` 后模拟用户又敲键（内容偏离）→ `dirty` 必须保留。另验 `identical` 分支的清脏（用户 Undo 回原状 → 圆点消失）。

Rust 侧：`watcher.rs` 补「结构化事件只发文件不发目录」「忽略目录不发」两组断言（沿现有 4 组风格）。

### 7.2 e2e（mock 层，`shell/e2e/editor/13-external-change.spec.ts`）

| 用例 | 断言 |
|---|---|
| E-EXT-1 | 未脏 tab → 外部写盘 → 事件后 model 内容自动更新、`dirty` 仍 false、**无对话框** |
| E-EXT-2 | 脏 tab → 外部写盘 → 三选一面板出现，tab 装饰在位 |
| E-EXT-3 | 面板选「用磁盘版本重载」→ model == 磁盘内容、装饰消失 |
| E-EXT-4 | 面板选「稍后处理」→ 缓冲不变；随后 Ctrl+S → 弹保存语义面板 → 选「用我的版本覆盖」→ 磁盘 == 我的内容 |
| E-EXT-5 | 自身保存的回声**不**触发任何面板（E-EXT-2 的镜像负向用例，钉死 §4.3） |
| E-EXT-6 | 文件被删（mock 令 `read_file` 失败）→ **不自动关 tab**，只见 toast 提示（更正：旧稿的「直接关 tab」是误判，见 §4.3） |
| E-EXT-7 | 虚拟 tab（md 预览 / CSV 查看器 / diff）打开时，同名文件外部改动不弹面板、不触发读盘 |
| E-EXT-8 | 「另存为」：预置 `__E2E_DIALOG_PRESET__.save` → 点 ok → 断言新路径内容 == 我的缓冲，且原 tab 未被动过 |
| E-EXT-9 | 自动重载后 **tab 圆点消失**（`dirty` 复位，§4.7 陷阱的视觉钉子）；LSP 诊断 / 绿箭头 / 大纲随 `setValue` 自动刷新（不码任何手动 refresh 调用） |

**mock 桥扩通道**：`helpers.ts` 现有 `emitFsChanged` 只推 `fs-changed`（且 `FS_WRITE_CMDS` 推的是**文件路径**而非 Rust 的父目录口径 —— 既有 A-mock 不忠实，见 §7.3）。本批新增 `emitFsFileChanged(paths)` 走新事件，**不得**改动 `emitFsChanged` 的既有语义（会打到 git 域 50 条用例）。

### 7.3 真机层（`shell/e2e-real/`）

在真实 notify 链路上验 3 条（外部写盘 → 自动重载 / 冲突面板 / 保存回声不弹）：

- **D-007 避坑必读**：真机套件里「写文件 → 断言出现」类检查必须带**重触写兜底**（`docs/e2e_divergence_ledger.md` 避坑速查 #6）——watcher 只上报启动后的变更，且 W0 落地前新窗口的 watcher 就绪晚于树可用。
- 建议挂 `shell/e2e-real/` 现有基建（`lib/real-env.cjs::runWithRealApp`），登记进 `run-real-all.ps1`，**不新造样板**。

### 7.4 顺带修正的既有分叉（登记，防后人踩）

`helpers.ts:1160` 的 `emitFsChanged([relToAbs(path)])` 推的是**文件绝对路径**，而 Rust `watcher.rs:143-147` 对文件变更推的是**父目录**。后果：mock 层 `write_file` 后 `isDirExpanded(filePath)` 恒 false → 文件树不刷新，而真机刷新。即「mock 比真机更弱」的 A-mock 不忠实。**本批只在文档登记**（改动会打到既有 git / ux 用例的期望），修它另立小项。

### 7.5 门禁（口径已按 `shell/scripts/gate-tests.mjs` 核实）

| 门禁 | 命令 |
|---|---|
| 单测 | `node shell/scripts/gate-tests.mjs unit`（内部即 `vitest-launch.mjs --watch=false --run`） |
| 类型 | `cd shell && npx tsc --noEmit` |
| e2e 本域 | `node shell/scripts/gate-tests.mjs e2e e2e/editor` |
| e2e 视觉子集 | `node shell/scripts/gate-tests.mjs e2e-ui`（**12 spec / 66 用例**，`gate-tests.mjs:8` —— 不是 npm script） |
| Rust | `cd shell/src-tauri && cargo test` |
| 预算 | `node shell/scripts/budget-check.mjs` |

全量 e2e 62 spec / ~26 min，只在跨域改动或发版前跑（`docs/AGENTS.md` 门禁纪律）。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **git checkout / 分支切换批量改动** | 一次改 30 个已打开文件 → 弹 30 次面板 | ① 单飞窗口 800ms 合并；② 同一 debounce 批次内**多文件冲突合并为一个面板**（「3 个文件被外部修改，全部重载 / 逐个处理 / 稍后」）；③ `git_checkout` 走的是 shell 自己的写命令链（`GIT_WRITE_CMDS`），可在该路径上直接抑制本功能（用户主动操作，不算「外部」）—— **这一条要在实施时确认 `git.ts` 的 checkout 落点**，属实施细节 |
| 会话 `draft` 被覆盖 | 未保存内容不可恢复 | 本功能的核心动因就是消除这条路径；重载只在用户显式选择后发生 |
| `read_file` 打在网络盘上慢 | 大仓 checkout 时读盘抖动 | 只对**已打开 tab** 读盘（§4.8 闸门）；读盘并发上限 4，超出排队；单路径 800ms 单飞 |
| 读盘失败被误判成「已删除」 → 误关 tab | 10MB 守卫 / 网络盘 IO 错误 / 权限 | `unreadable` 分支**只提示不动作**（§4.3）；删除语义由用户主动打开时的既有报错链路兜底 |
| **`setValue` 顺带置脏**（`main.ts:1009-1014` 统一置位点） | 重载后 tab 假脏 + 会话快照把整文件存成 draft | §4.7 内容守卫复位 + 单测用例 8 + e2e E-EXT-9 视觉钉子三重保险 |
| 对话框与既有 modal 抢占 | `activeFinish` 会以 cancel 裁决旧对话框 | 语义正好是「稍后处理」，不产生意外动作（`dialog.ts:64-75` 已论证该守卫存在的原因即此类并发） |
| 「覆盖磁盘」把外部内容改写掉 | 对方改动丢失 | 强制 `runOnSaveActions: false`（§7.1 用例 7 钉死） |
| 忽略清单遗漏（如 `dist/`、`.mypy_cache/`） | 编辑器自身产物触发无谓面板/读盘 | 事件到「无 tab 命中」即止；有 tab 命中才读盘，实际影响面很小；扩清单属 W2 一并处理 |
| 自动重载清空 undo 栈 | 用户无法撤销被外部改掉的内容 | 用户显式选择的重载路径可接受；**自动重载路径**若实测引发投诉，回退开关 = 「只有 identical 才自动重载，其余一律先问」（§4.7 末条） |

---

## 9. 任务分解与预估

| # | 任务 | 预估 | 门禁 |
|---|---|---|---|
| **T1** | Rust：结构化事件 `fs-file-changed` + 2 组单测 | 0.25d | cargo test |
| **T2** | 前端纯逻辑层 `externalChange.ts`（判定 / 单飞 / pending / 路径归一 / `unreadable` 分支）+ 单测（含 §4.7 守卫） | 0.75d | vitest |
| **T3** | 决策面板接线（`openChoice` 两处语义）+ `saveTab` 拦截 + 另存为（plugin-dialog `save()`）+ tab 装饰 + `dirty` 守卫复位 | 0.75d | vitest |
| **T4** | i18n 词条（`watch` 域生成器全流程） | 0.25d | tsc 0 错 |
| **T5** | e2e mock 通道 + `editor/13` spec 9 条（E-EXT-1..9） | 0.75d | gate e2e editor + e2e-ui |
| **T6** | 真机 3 条（含 D-007 重触写兜底） | 0.5d | e2e-real |
| **T7** | W0：`startFileWatcher` 前置 + 预算登记（`watcher_rs` / `externalChange_ts` / budget-check.mjs） | 0.25d | budget 全 PASS |
| **T8** | 文档收尾：`delivery-overview` / `tech-debt` / 仓库根 `AGENTS.md`（仅当需在功能范围行补一句时）/ 本计划状态行 | 0.25d | — |

**合计 ~3.5d**。低估风险集中在两处：① `dirty` 复位与 autosave / 恢复 draft 路径的交叉（§4.7）；② 多文件冲突时 `activeFinish` 裁决旧对话框的连弹行为（§8）。与 pytest 批同类经验：计划量级对、实测会超 —— 真机阶段预留 0.5d 缓冲。

---

## 10. 验收口径（交付后建 `docs/fs_watch_acceptance_record.md`）

1. E-EXT-1..9 全绿 + `editor` 域 / `e2e-ui` 无回归；
2. 真机 3 条 PASS（含「保存回声不弹面板」这条最易回归的负向用例）；
3. budget-check 全 PASS（含 2 条新登记项）；
4. **人工验收清单**：① 开着 `main.py` 用外部编辑器改同名文件 → 面板出现，三选一各点一遍，**每次点完检查 tab 圆点与「文件 → 保存」菜单亮灰态是否符合预期**（§4.7）；② git 切分支 → 观察多文件冲突的连弹行为是否可接受（M1 若未做批量合并，如实登记为遗留）；③ 在 `.venv` 里 pip install → 不弹任何面板（`should_ignore` 回归）；④ 断开网络盘 / OneDrive 暂停同步下同样操作 → 不误关 tab；⑤ 关闭工作区再打开 → pending 标记不残留、session draft 未被污染。

---

## 11. 后续候选（登记，不排期）

| # | 候选 | 前置 / 备注 |
|---|---|---|
| W2 | 监听范围瘦身：按顶层目录分别 `watch`（跳过忽略目录），或用已有 `ignore` crate 先算应监听集合 | 须配 `bench/large_repo` 回归；属章程「运行时开销红线」同类要求 |
| W3 | 监听健康度：失败 / 溢出事件 → 状态栏芯片 + 自动重订阅 | 需新增 UI 面，另议；网络盘用户实案驱动 |
| W4 | 插件目录 watcher 并入 `watcher.rs` 共用 debouncer 与忽略规则 | 搭车任一批次 |
| W5 | 事件类型精确化（create/modify/remove） | **裁决不做**：内容比对已证明可替代，换 `debouncer-full` 违反「默认轻量」 |
| — | 修 §7.4 的 mock 载荷分叉（文件路径 vs 父目录） | 影响面打到既有 git / ux 用例期望，另立小项 |
| — | 批量冲突合并面板（git checkout 改多文件时逐个弹） | 现由 800ms 单飞 + 串行兜底；人工验收后按投诉排期 |
| — | Local History（保存 / 外部修改快照，`pycharm_feature_research_report.md` E7） | 独立议题，与本功能共用 `fs-file-changed` 信号源 |

---

## 12. 交付记录（v1.0，2026-10-18）

**实现与计划的偏差**（细节见验收记录 §2，六条值得复用的结论）：

1. **虚拟 tab 判据改正向**：计划写「枚举 diff/db/md/csv 跳过」，实现改为「只认普通文件 tab」（`kind === undefined || "file"`）——`Tab.kind` 是可选字段，枚举判据漏一种就假阳性。
2. **另存为补「同路径拒绝」**：用户在保存框里选回原路径会覆盖正要救回的文件（自伤路径，计划未识别）。
3. **`emit_file_path()` 是三事件共用的准入闸**：不另写一份过滤逻辑，避免死代码与口径漂移。
4. **mock 桥不自动推 `fs-file-changed`**：helpers 的 `FS_WRITE_CMDS` 若自动推本事件，所有「bridge 改盘 + 编辑器开着该文件」的既有 spec 行为会变（自动重载 / 弹面板）。spec 内按需 `__emit`（PT-9 先例），并把这个分歧写进 ledger 备查。
5. **bundle 实测 +5 KB**（计划估 +6~10），`index chunk` 1606/1700 持平；`main.ts` 仅 +9 行（2438/2440）。
6. **命令面 +0**：另存走 plugin-dialog `save()`（JS 侧），冲突面板走既有 `openChoice`，读盘/写盘复用 `read_file`/`write_file`。

**真机实证（`external-change-real` 3/3，43.5s）**：EC-REAL-1 自动重载后脏圆点=0（§4.7 陷阱的实锤）· EC-REAL-2 真实 notify 链路弹出三选一面板（ok=另存为… / cancel=稍后处理 / 标记=1）· EC-REAL-3 Ctrl+S 弹保存语义面板 → 覆盖磁盘 == 我的缓冲。

**门禁**：tsc 0 错 · vitest 125 文件/1598 用例 · cargo 373 · e2e editor 域全绿 · e2e-ui 65/66（1 项存量，已 stash 对照实证与本批无关）· budget-check 全 PASS（新登记 5 项：watcher.rs 410 / externalChange.ts 380 / 单测 340 / CSS 60 / 已含 main.ts 余量核算）。

