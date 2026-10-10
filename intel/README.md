# opencharm-intel

OpenCharm 运行时智能 LSP（Phase 3）。独立 Rust 包/进程，经 stdio 挂着到 shell 的 LSP 桥，消费 opencharm-probe 写入的 SQLite trace 库，提供运行时驱动的代码补全 / 跳转 / hover。

**独立包，不依赖外壳内部 API（架构第一原则）。**

## 定位

| 层 | sortText | 来源标注 | 状态 |
|---|---|---|---|
| 智能 live template | `0xx` | `⟳ ctx=…` | Phase 1 已交付（shell） |
| **运行时智能（intel）** | **`1xx`** | **`⟳ runtime`** | **Phase 3 本包** |
| 静态引擎（pyrefly） | `2xx` | — | Phase 1 已交付 |

## 数据契约

读取 `~/.opencharm/traces/<project-hash>.db`（probe 的 trace 库，schema 见 `probe/src/opencharm_probe/store.py`）：

- `functions(filename, qualname, lineno, hits, stale)` —— 函数自然键 + 命中数 + 陈旧标记；
- `arg_types(fid, arg, type_label, shape, count)` / `ret_types` / `exc_types` —— 类型观测跨运行累加；
- 类型紧凑表示：实例 → `模块.类名`；容器 → `dict[str, int]` / `list[int|str]`；`shape` 为 `shape_fingerprint` JSON 数组（dict 键 / 实例属性名集合）。

## 构建

```powershell
cd intel
cargo build            # debug
cargo build --release  # P3-T02 性能验收用
```

> ⚠️ 联调 shell 前必须 `cargo build -p opencharm-intel`（**非 `cargo test`**）——`cargo test` 只构建测试 harness，不刷新 shell 调用的 `opencharm-intel.exe`（曾因此踩坑：shell 加载到 P3-T01 骨架版，补全返回 `method_not_found`）。

## 阶段任务

| 编号 | 任务 | 状态 |
|---|---|---|
| P3-T01 | 骨架（cargo workspace + tower-lsp stdio） | 已完成 |
| P3-T02 | trace 索引层（读 SQLite，10 万条 < 2s） | 已完成（2026-09-10 整改后实测 **429.9ms**，bench_load PASS） |
| P3-T03 | 补全 provider（符号补全） | 已完成（见下） |
| P3-T03b | 属性访问补全（局部类型推断） | 已完成（见下） |
| P3-T04 | 跳转 provider | 已完成（见下） |
| P3-T05 | hover provider | 已完成（见下） |
| P3-T06' | 挂载 shell LSP 桥（`⟳ runtime`，sortText `1xx`） | 已完成（端到端验证通过） |
| P3-T07 | inlay hints（运行时类型标注，`⟳ type`） | 已完成（`inlay.rs` + shell `registerLspInlayHints`） |
| P3-T08 | 类型推断补强（for 循环变量）+ stale 新鲜度降权 | 已完成（`type_infer` + 全链路降权） |
| P3-T09 | 运行时层一键关闭全局开关 | 已完成（设置 `runtime_intel_enabled` + `stopIntel`） |
| P3-T10 | bench 补全准确率评测 + Gate D 验收 | 确定性评测 23/23 通过（红线 ≥85%）；**第一格（PyCharm 人工横向对标）❌ 2026-10-07 撤下**（本机无 PyCharm；按 roadmap P0-2 二选一截止规则，到 v1.4 未取得即撤项，README「已知边界」已显式声明"未与 PyCharm 做过横向对比"）；**第二格（真实项目端到端）✅ 已采并收口**（3 项目 / 7 次运行 / 497 条函数观测，未达 ≥1000 门槛 → 改为日常累积，见 `bench/reports/trace-sample-threshold.md`） |
| P3-T11 | **A3 调用实参补全（①）+ hover 观测签名 / 常见键（②）** | 已完成（2026-10-06，见下） |
| P3-T12 | **A3③ intel 签名帮助（`textDocument/signatureHelp`）** | 已完成（2026-10-06，见下） |

### P3-T10 现状（2026-10-07 更新：第一格撤下，第二格收口）

**两格 PENDING 已全部关闭**——第一格按截止规则撤下（不再挂账），第二格已采到真实样本并按门槛口径收口：

| 项 | 状态 |
|---|---|
| 确定性口径 base 数值 | ✅ 23/23 = 100%（`bench/reports/gate-d-runtime-completion.md`），红线 ≥85% PASS |
| 评测覆盖的已知空洞 | ⚠️ `completion.rs::bench_seed()` 的 6 个函数**全部 `stale=0`** → 23 个评测点对**降权策略零覆盖**；100% 既不能证明也不能反驳降权合理性。已补单测 `stale_candidates_rank_below_fresh_ones` 钉住降权行为（33/33 通过） |
| 降权参数的依据 | 🔄 此前是裸字面量 `f.hits / 2`。现已提成具名常量 `STALE_HITS_DIVISOR`（值不变）+ 注释记录首个实测：改 1/2 源文件后只跑另一半，**stale 占比 30.0%**（3/10）——即常见编辑流下约 1/3 观测立刻变 stale。取值待真实项目 ≥1000 条观测后用 `tools/intel/trace_stats.py` 复核 |
| 人工横向对标 | ❌ **已撤下（2026-10-07）**：本机无 PyCharm，roadmap P0-2 的二选一截止规则到期（v1.4 仍无对标）即撤项。工作单 `bench/reports/gate-d-ab-worklist.md` 保留归档（OpenCharm 侧 23 点排名已填好），将来换对照组（如 VS Code + Pylance）可直接复用——但结论必须改写为"对 X"，不得拿它冒充原命题。**在新证据出现前，"比 PyCharm 更准"是不可写的表述**（口径纪律见 `CONTENT-SERIES.md`） |
| 真实项目端到端 | ✅ **已采并收口（2026-10-07）**：跨 **3 个真实项目 / 7 次运行 / 497 条函数观测**（`metawake/backend` 277 · `pylume/probe` 187 · `cb_watcher/backend` 33），742 B/条，hits p50 2 / p99 121，stale 仍 0.0%。真源 `bench/reports/trace-stats-cumulative.md`；**门槛口径（「≥1000 条」= 函数观测）与「不再专门采样、改为日常累积」的处置见 `bench/reports/trace-sample-threshold.md`** |
| trace 库保留窗口 | ⏳ 现行无条数/体积上限；`probe clean --days N` **只删 runs 行、不删观测数据**（易被误读为保留窗口）。`trace_stats.py` 建议按 8 MB 预算设条数上限（按当前 742 B/条反推约 ≤11,309 条）并已在报告中给出反推口径——**仍是建议值，未落代码**（同样受 ≥1000 条复核门槛约束） |

### P3-T11 A3 调用实参补全 + hover 观测签名（2026-10-06）

**① 调用实参补全**（`completion.rs`）：光标位于 `foo(|` / `foo(a, |` 时，按该函数的 `arg_types`
参数位观测给出**参数名**候选，insertText 为 `name=`，detail 为 `⟳ runtime · <观测类型> · <证据数>`。

- **上下文判定**：前向扫描（括号栈 + 字符串/注释跳过）取**最内层未闭合 `(`**，回溯取 callee 点链；
  光标在字符串内、最内层是 `[` / `{`、`def` / `class` 定义、分组括号 → 一律不出参数补全（让位给
  下标 / 属性 / 符号补全分支）。光标所在段不是「空或纯标识符」（如 `foo(a.`）时同样让位。
- **排除已写**：已按 keyword 写出的参数名直接排除；已按位置写出的参数按**参数位顺序**前跳。
  该顺序依赖 `arg_types` 的**插入序**（probe `monitor._record_args` 按 `co_varnames` 声明顺序逐位
  写入）——`trace.rs` 因此把 `ORDER BY fid` 补成 `ORDER BY fid, rowid`（fid 相同时 SQLite 排序
  不保序，会打乱顺序）。
- **类构造**：`Cls(` 先按最后段匹配，未命中再试 `Cls.__init__`。
- **已知边界**：只在**观测到过**的函数上工作（没跑过的函数没有 `arg_types`）；位置参数顺序对
  「观测缺失的参数位」偏保守（少跳，不会错跳）；内建函数（`print(` 等）无观测 → 不产生候选。
- **触发**：`(` `,` 加入补全 trigger characters（server `initialize` 声明 + shell
  `registerLspCompletion` 同步）。

**② hover 观测签名与常见键**（`hover.rs`）：函数 hover 新增「签名（观测）」行
（`parse_page(resp: requests.Response)`，按参数位顺序合成），且每条参数观测附 shape 派生的
**常见键**（dict）或**常见属性**（实例）。

> ⚠️ **口径**：probe 明确「**绝不 repr 值本身**」（见 `probe/README.md` 类型紧凑表示），
> 所以这里只能展示**结构**（键 / 属性名），**不存在"实际见过的字面取值"**。文案因此写
> 「常见键 / 常见属性」而非「常见值」。

**未做（A3④，已裁决覆盖不立项，2026-10-07）**：调用处参数名 inlay hint 已由 pyrefly 官方
`python.analysis.inlayHints.callArgumentNames` 提供，且 shell 已由 PR-N 接通——`lsp/client.ts`
`pushInlayHintSettings` 把 `inlay_param_hints`（默认开）映射推送 + `registerLspInlayHints` 双源
provider 已注册，无需 intel 自研（A3③ 签名弹窗已于 2026-10-06 交付，见 P3-T12）。

### P3-T12 A3③ 签名帮助（2026-10-06）

**`(` / `,` 触发**：光标位于某次调用的实参列表内时，弹出该函数的**观测签名**并高亮当前参数位。

- **与 A3① 共用一份上下文**（这是本项最关键的实现选择）：上下文扫描 `completion::call_frame_at`
  （括号栈 + 字符串/注释跳过 + callee 回溯）、callee 解析 `resolve_callee`（最后段匹配 +
  `Cls(` → `Cls.__init__` 回落）、参数位聚合 `param_observations` 全部复用；`signature.rs` 只负责
  「合成签名 label + 算当前参数位 + 出说明文本」。⇒ **弹窗高亮的参数位与补全首推的候选必然是同一个**，
  不会出现「补全让你填 `timeout`、弹窗高亮 `url`」的矛盾。为此 `call_frame_at` / `written_args` /
  `param_observations` / `resolve_callee` 从 `completion.rs` 提为 `pub(crate)`。
- **签名 label** 用**最后段短名**（`parse_page(url: str, timeout: int, retries: int)`），与 hover 的
  「签名（观测）」同口径；**只给一条签名**（`activeSignature=0`）——Python 无重载，`resolve_callee`
  已按「hits 最高、非 stale 优先」取唯一实现，列同名候选只会变噪声。
- **当前参数位**：观测顺序下**第一个尚未写出**的参数位；「已写出」判据与 A3① 逐字一致（已按
  keyword 写出的名字 + 已按位置写出的前 N 个）。参数填满时**钳到末位**而非回 0（回 0 更误导）。
- **参数说明**：`<观测类型> ×<证据数>` + shape 派生的**常见键**（dict）/ **常见属性**（实例）；
  shape 与「证据最高的类型」取自**同一条观测**，不混搭。
- **与 A3① 的一处有意差异**：补全要求「光标所在段是空或纯标识符」才出候选，签名帮助**不要求**——
  写 `foo(1 + |` 时补全让位（交给表达式/点链补全），但签名弹窗仍应显示（你确实在填第一个参数）。
  该差异由单测 `signature_survives_non_ident_segment` 钉住。
- **三处 `None`**（都不弹空窗）：不在调用实参内 / callee 无运行时观测 / 该函数无参数观测。
- **触发字符两处同步**：server `initialize` 的 `signature_help_provider`（trigger `(` `,` +
  retrigger `,`）与 shell `startIntel` 的 client capability、`registerLspSignatureHelp` 的
  trigger/retrigger 字符。

> ⚠️ **口径**（同 A3②）：probe 只记录 `type_label` + `shape`，**绝不 repr 值本身**。故签名里
> **没有默认值**（trace 不记默认值）、参数说明只能给结构（常见键 / 常见属性）。签名级说明文本
> 已显式写「**不含默认值**；probe 不记录字面取值」，由单测 `signature_doc_states_no_defaults` 钉住。

**shell 侧接线**（`shell/src/lsp/client.ts`）：`provideSignatureHelp` 原为**只问静态引擎**；
A3③ 改为**intel 优先、无结果回落 static**（`querySignatureHelp(engine, params)` 与 `queryHover`
同构：per-engine 就绪门控 + 失败静默）。理由与补全 / hover 的合并口径一致——只有运行时侧知道
「这个参数位实际见过什么类型」，静态引擎做覆盖面兜底（没跑过的函数 intel 无观测）。

**已知边界**：与补全 / hover 共享 `engineStatus === "ready"` 门控——**静态引擎未就绪时整条
intel 链路都不出结果**（既有设计，非本项引入）；若要让 intel 独立可用，须三项一起改。

## 索引与并发模型（2026-09-10 整改后）
- **倒排索引**（`opencharm-intel-index/src/trace.rs`）：加载期预建 `by_qualname` / `by_location` / `by_file` / `by_last_segment`（qualname 最后段，**排序数组**——C2 后前缀查询走二分下界 + 命中区段扫描）/ `by_second_last_segment` / `by_type_label`（类型 → 观测定位）；消费端 7 处全量线性扫描全部改为索引查询，shape 解析带请求级缓存。
- **只读打开**：`TraceIndex::open` 用 `SQLITE_OPEN_READ_ONLY` + 路径不存在直接报错（不创建垃圾 .db）+ `busy_timeout(2s)`。
- **server.rs 并发**：`parking_lot::RwLock`（无中毒）+ `Option<Arc<TraceIndex>>` 快照（读锁内只 clone，重计算锁外）+ 补全/hover/definition/inlay/诊断全部 `spawn_blocking`；didChange 带 **version 校验**（旧版本后到不覆盖新文本）；索引加载失败**指数退避**（连续失败后按 2 的幂间隔重试，不再每键重试刷 stderr）。

### P3-T03 运行时补全（已交付部分）

**符号补全**（`completion.rs::complete_symbols`）：基于 `qualname` 命名空间链匹配，覆盖三类：

| 输入 | 语义 | 示例 |
|---|---|---|
| `scraper.par` | 模块/类成员前缀补全 | `scraper.parse_page` |
| `scraper.`（尾点） | 命名空间成员全量补全 | `scraper.*` |
| `parse_p`（无点） | 运行过的函数名补全（跨文件） | 所有最后段以 `parse_p` 开头者 |

**调用实参补全**（P3-T11 / A3①）：`foo(|` / `foo(a, |` → 参数名候选（insertText `name=`）——详见下文 P3-T11。

- 候选 `label` = 成员名，`detail` = `⟳ runtime · <qualname> · <hits> hits · ret→<类型>`，`sortText` = `1xx`（hits 降序）；
- 索引懒加载自 `initializationOptions.traceDbPath`；文档经 didOpen/didChange/didClose 全量同步。

**属性补全**（`completion.rs::complete` + `type_infer.rs`，P3-T03b）：`x.` / `x.field` 时经轻量类型推断定位 `x` 的运行时类型，聚合该类型的 `shape` 字段（dict 键 / 实例属性名）为候选（`kind=Field`）。

| 推断规则 | 示例 |
|---|---|
| 赋值 = 函数调用 → 返回类型 | `data = parse_page()` → `dict[str, int]` |
| 赋值 = 字面量 | `x = []` → `list`；`x = "s"` → `str` |
| 函数参数观测 | `def parse_page(resp):` → `resp` 的 arg 观测 |

已知边界（MVP，逐行回溯 + 前缀匹配，无完整解析器）：链式 receiver（`a.b.c` 的字段级类型传播——受 shape 无「字段→类型」映射限制）、条件分支内的类型收窄不追踪。**循环变量（`for x in …`）已在 P3-T08 支持**（容器元素类型推断）。

**调用链推断**（`type_infer.rs::infer_call_chain_type`，P1 批 2026-10-10）：receiver 是**调用表达式**时的类型传播，覆盖爬虫画像第一高频形态：

| 输入形态 | 推断路径 | 示例 |
|---|---|---|
| `parse_page(html).` | 首段函数 ret 观测 → 类型 | dict 键 / 实例属性 |
| `order.get_total().` | head 变量类型 × 方法 qualname 段链匹配（`by_second_last_segment` 粗筛）→ 方法 ret | 方法返回类型的成员 |
| `make_order(c).` / `Order(...).` | 工厂 ret / 类构造约定（存在 `Cls.__init__` 观测 → 实例类型 = 类名） | 实例属性 |
| `get_quotes()["data"]["` | 调用后下标：ret 类型沿 `Access` 链解析嵌套 shape | 深层 dict 键 |

- 光标上下文由 `call_context.rs::call_receiver_at` 提取（括号感知回扫——圆/方括号对都跳过（实参带列表字面量 `make_order(9, [1]).` 是爬虫画像高频形态，真机探针实锤旧版在 `]` 上 break），纯点链让位原路径）；
- MVP 边界（登记不实现）：下标后再属性（shape 子节点不携带类型标签）、嵌套调用只解析最外层、首段 head 是模块点链（`mod.func().`——模块名推不出类型）；
- 全链路无命中时返回空候选（不回落符号补全——链形态下 parent 切分语义不成立）；
- 真机全链路验收：`shell/e2e-real/chain-completion-real.cjs`（运行 → probe 入库 → intel mtime+size 重载 → Monaco 弹层，9/9 PASS，2026-10-10）。注意 dev 布局查找 **release 优先于 debug**（`lsp.rs::locate_intel_binary`）——只重建 debug 时真机仍跑旧 release exe。

**Hover**（`hover.rs`，P3-T05）：悬停展示运行时观测（markdown）：

- 悬停函数名 → `⟳ runtime · <qualname> · <hits> hits` + **签名（观测）**（A3②）+ 参数/返回/异常观测（按 count 降序）；每条参数观测附 shape 派生的**常见键 / 常见属性**；
- 悬停对象变量 → `⟳ runtime · <name> : <类型>` + shape 字段列表；
- 复用 `type_infer` 的 receiver 定位与成员聚合，与补全共用一套推断语义。

**签名帮助**（`signature.rs`，A3③ / P3-T12）：`(` / `,` 触发 → 观测签名 + 当前参数位高亮；
上下文与参数位聚合**复用补全**（`call_frame_at` / `param_observations`），详见 P3-T12。

**跳转**（`definition.rs`，P3-T04）：光标落函数名时，按 qualname 最后段匹配 trace 函数，返回其 `(filename, lineno)`（probe 记下的 def 行）；同名函数返回多个、按 hits 降序（最常运行的实现排前）；server 层经 `Url::from_file_path` 转 file URI。

### P3-T06' 挂载 shell 桥（已交付）

- `shell/src-tauri/src/lsp.rs`：多引擎（`engine` 键区分 `static`/`intel`，事件 payload 带 engine）；新增 `get_intel_info`（定位 exe + 算 trace 库路径）；
- `shell/src/lsp/client.ts`：双引擎会话 + 补全三层合并（intel `1xx` / 静态 `2xx`，模板 `0xx` 在 main.ts）、hover/definition 合并、文档同步广播；intel 启动失败**静默降级**（静态引擎照常）；
- 关键坑：`project_hash` 用 Rust `fs::canonicalize`，Windows 上返回 `\\?\` verbatim 前缀，与 probe `os.path.realpath`（无前缀）不一致 → trace 库 hash 错位；已用 `strip_verbatim_prefix` 对齐（见 `shell/src-tauri/src/file_ops.rs`，含对齐测试）。补：Windows 路径大小写不敏感，两端已加大小写归一（Rust `to_lowercase` / probe `os.path.normcase`），否则同目录大小写不同会产两个 trace 库（tech-debt #4）。

## 已知约定（来自 probe）

- 类方法/闭包 qualname 带 `<locals>` 段，消费时需处理；
- `stale=1` 表示函数所在文件在末次运行后被修改，消费时可降权或忽略；
- `shape` 列存空串而非 NULL（SQLite 唯一约束对 NULL 不生效）。