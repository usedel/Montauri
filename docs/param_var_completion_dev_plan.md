# 参数位变量补全开发计划（P3-T11）

> 面向：OpenCharm 运行时补全下一迭代。本文自包含，不依赖任何外部参考资料。
> 定位：借鉴 PyCharm「智能类型匹配补全」机制，在调用实参位补上「作用域变量候选」这一层——不建索引、不改架构、零新依赖、零上行。
> 状态：**待评审**（2026-10-12 用户裁决「先出方案设计，不动代码」后编写；评审通过才进开发，维护态门禁见 §8）
> 编写时间：2026-10-12

---

## 0. 动机：PyCharm 的机制拆解与我们的差距

### 0.1 PyCharm 侧机制（2026-10-12 调研结论）

用户实测观察：定义 `cb_url` 后写 `request.get(`，光标移入括号时补全会提示 `cb_url`。该行为属于 IntelliJ 平台的**智能类型匹配补全**（官方文档称「类型匹配补全」，快捷键 Ctrl+Shift+Space）。它不是「猜意图」，而是四层基础设施叠加的确定性结果：

| 层 | 机制 | 作用 |
|---|---|---|
| 语义定位 | PSI（Program Structure Interface）全量语法 + 语义树 | `requests.get` 是可解析到定义与签名的符号，不是一段文本 |
| 位置上下文 | 括号栈 + caret 定位 | 知道光标位于 `get(url, params=None, ...)` 的第 1 个参数位，参数名 `url` |
| 类型推断 | 基于 PSI + typeshed stub 的深度推断 | `cb_url = "..."` 推得 `str`；`url` 参数期望 `str \| bytes` |
| 候选排序 | 本地 ML 重排（2020.1+）；2023 年后另有云端 AI 全行补全（另一套系统，可关） | 按「前缀匹配度、元素角色、近期使用」重排；模型随 IDE 分发、本机推理、不读代码内容 |

其代价同样明确：这套能力的燃料是**全量索引 + 深度类型推断**——PyCharm 启动建索引、随项目变大吃内存，属于「重量级语义」路线。

### 0.2 我们的现状差距

我们已有的是**另一半**：A3① 调用实参补全在光标进入 `foo(|` 时给出**被调函数的参数名**候选（insertText `url=`，detail 附运行时观测类型与证据数）。PyCharm 则两类都给：参数名 + **作用域内类型匹配的变量**。后者是我们的空缺，且恰好是「填参数」场景的高频意图——变量打完就没了，参数名却随时可打。

本计划的补齐思路：**复用已有全部原料**（括号栈上下文、callee 解析、参数位观测、文档文本类型推断），只缺「枚举作用域变量 + 按期望参数匹配」这一层。不引入 PyCharm 式全量索引（撞预算 / 常驻红线），不引入 ML（§6 有既有裁决）。

### 0.3 借鉴边界（一句话）

抄「**参数位感知 + 类型匹配排序**」这个机制思想；不抄「全量 PSI」「深度类型推断」「ML 重排」「云端全行」。

---

## 1. 现状盘点（已覆盖，勿重复投入）

以 2026-10-12 代码为准，落点用函数名锚定：

| 能力 | 现状 | 位置 |
|---|---|---|
| 光标在调用实参位的括号栈检测（有界 64 KB 窗口扫描） | 已实现 | `intel/crates/opencharm-intel/src/call_context.rs` `call_frame_at` |
| callee 解析（末段匹配 + 类构造回落） | 已实现 | `completion.rs` `resolve_callee` / `best_function` |
| 参数位观测聚合（arg_types → 参数名 / 类型 / shape / 证据数） | 已实现 | `completion.rs` `param_observations` |
| 参数名候选 + 位置参数前跳 | 已实现（A3①） | `completion.rs` `param_candidates` |
| 当前参数位计算（签名弹窗 activeParameter） | 已实现（A3③） | `signature.rs` `active_index` |
| 文档文本轻量类型推断（`x = fn()` / 字面量 / for 变量 / def 参数） | 已实现 | `type_infer.rs` `infer_receiver_type` / `infer_upward` |
| 候选截断声明 is_incomplete / 六段 sortText 契约 | 已实现 | `completion.rs` `dedup_sort_truncate`；`server.rs` `to_completion_response` |
| 频率排序 | **已生效，不再叠本地启发式**（P1-C 裁决：intel score 已按证据强度排序，数据源是运行时观测，比本地启发式真实） | `completion_interaction_dev_plan.md` §4 P1-C |

**结论**：新特性不新增任何「基础设施」，只新增一个匹配层 + 一个作用域枚举函数。

---

## 2. 目标语义与交互剧本

前置条件如实说明：本特性只对**运行时观测过的 callee** 生效——我们的签名来自 probe 观测，没有 stub 库；观测来自用户自己跑过的项目代码。

剧本（自己项目里调用过 `scraper.parse_page` 的前提下）：

```python
def run():
    cb_url = "https://example.com"      # 字面量赋值 → 推断 str
    page = scraper.parse_page(cb       # ← 光标在此
```

输入 `cb` 时（`(` 触发一次，逐字可再触发）：

- **首位**：变量候选 `cb_url`，detail `⟳ 匹配参数 url · str · 10 obs`（LSP Variable，纯插入无 `=`）
- **随后**：参数名候选 `url=` / `timeout=` / `retries=`——现有行为不变

三条降级（不满足条件时全部保持现状）：

- callee 解析不到（没跑过的函数）→ 回落符号补全，无变量候选
- 有观测但无变量匹配 → 只有参数名候选（= 今天的行为）
- 变量类型推断不到 → 该变量不出现（不猜类型）

## 3. 设计方案

### 3.1 总原则

1. **不建任何新索引**：作用域枚举是对当前文档文本的一次向上扫描；签名与类型全部取自既有 trace 索引与既有推断函数。
2. **六段 sortText 契约不动**：变量候选活在 intel `1xx` 段内，段位与截断语义零变化。
3. **零客户端改动**：复用 LSP `Variable` kind（与 Param 候选同一映射），`shell/src` 全层不碰（`lsp/client.ts`、`main.ts`、`style.css` 的余量留给别的项）。
4. **单一实现点防漂移**：「当前参数位」计算下沉为共用函数，签名弹窗高亮与变量匹配目标恒一致（沿用 A3③ 已确立的「弹窗高亮 == 补全首推」纪律）。

### 3.2 改动点 A：`local_var_types`（`type_infer.rs`，+约 55 行）

新增 `pub fn local_var_types(text: &str, line: u32) -> Vec<String>`：从光标行**向上**扫描，遇 `def ` / `class ` 行停止（与 `infer_upward` 同一作用域边界口径——外层局部变量不泄漏进内层函数），收集：

- 赋值 LHS 单标识符：`cb_url = ...` / `cb_url: str = ...`（与 `assignment_rhs` 对称的口径；**多目标与解包 v1 不收**，见 §10）
- `for name in ...:` 循环变量（与 `for_var_type` 的识别口径一致）
- 当前 `def f(name, ...)` 的形式参数（与 `infer_param_type` 口径一致）

**性能纪律**（对齐 `call_context.rs` C3 窗口化先例）：本函数是 O(文档) 单次扫描，但它**不直接返回类型**，只返回变量名清单——类型推断延迟到前缀过滤之后按需触发。`infer_receiver_type` 对每个候选变量又是 O(文档) 向上扫；若对全部变量无条件推断，50 个变量 × 2000 行文档 = 每次击键重扫 10 万行，正是 C3 修掉的那类退化。流程：先枚举（一次扫描）→ 按光标段前缀过滤（通常 ≤3 个幸存）→ 只对幸存者逐个 `infer_receiver_type`。总成本 = O(文档) + O(1) 次推断，与文档规模线性、与变量数无关。

### 3.3 改动点 B：匹配与排序（新文件 `arg_var_completion.rs`，约 170 行）

模块职责单一：给定调用上下文 + 变量清单，产出**已匹配、已排序**的变量候选。拆新文件的先例：`except_completion.rs`（P2 except 补全批，~99 行 / 上限 150）。

```rust
/// 匹配并排序调用实参位的作用域变量候选（P3-T11）。
/// 返回空 = 无匹配（调用方回落参数名候选，行为不变）。
pub fn variable_candidates(
    index: &TraceIndex,
    text: &str,
    ctx: &CallCtx,
) -> Vec<Candidate>
```

流程：

1. `resolve_callee` → `param_observations`（与 `param_candidates` 同入口数据）
2. **目标参数位**：第一个尚未写出的参数位——`skip = min(ctx.positional, obs.len())`，排除已按 keyword 写出的（与 `param_candidates` / `signature.rs::active_index` 同口径）；**`self` / `cls` 命名的参数位不参与变量匹配**——方法调用的 active slot 会落在 self 上，拿它匹配变量是错的；参数名候选侧的 self 问题是既有边界，本项不扩散也不修复
3. 目标参数 = 该 slot 的 `(name, type_label)`（如 `("url", "str")`）
4. `local_var_types` 枚举 → 光标段前缀过滤 → 逐个 `infer_receiver_type` → **严格相等**匹配 `type_label`（v1 不做子类 / duck typing；`list` vs `list[str]` 这类泛型差异也不匹配）
5. 排序：名称亲和（变量名包含参数名，`cb_url` 含 `url`）优先，其余按源码行距离（近者优先），再按名称字典序
6. 构造候选：`kind = CandidateKind::Variable`（新增枚举值），`insert_text = None`（纯标识符插入），detail = `⟳ 匹配参数 {name} · {type_label} · {count} obs`（沿用 `⟳ runtime` 前缀格式，不含实际值——probe 口径）

### 3.4 改动点 C：接线（三处小改）

1. **`completion.rs`**（+约 25 行）：
   - `CallCtx` 提为 `pub(crate)`（新模块要用；三个字段本就是内部数据）
   - `param_candidates` 函数体开头接入：`let mut out = variable_candidates(index, text, &ctx);`——无匹配返回空 vec，参数名候选照旧追加，`dedup_sort_truncate` 去重 / 降序 / 截断链路不变（label 撞车时保留 score 高者 = 变量，语义正确）
   - `CandidateKind` 增 `Variable` 枚举值
   - `active_index` 从 `signature.rs` **下沉**为本模块 `pub(crate) fn active_param_slot(obs: &[ParamObs], keywords: &[String], positional: usize) -> usize`（单一实现点）
2. **`signature.rs`**（净 −约 8 行）：`active_index` 函数体改为委托 `completion::active_param_slot`，注释标明「与补全变量匹配共用，勿漂移」
3. **`server.rs`**（+约 6 行）：`to_completion_response` 的 kind 映射增 `CandidateKind::Variable => CompletionItemKind::Variable`（与 Param 同一 LSP kind）；`sortText` 段位逻辑不变

### 3.5 排序决策记录（boost 常量，含备选否决）

变量候选要**恒排在该 slot 参数名之前**。既有排序是 `score` 降序 + label 字典序（`dedup_sort_truncate`），score 同源（证据计数）时 label 序会打乱相对顺序，故不能靠「先拼后排」。

- **决策**：变量候选 score = `p.count + VARIABLE_RANK_BOOST`，`VARIABLE_RANK_BOOST: i64 = 1 << 20`（常量，注释声明「纯排序段位，无语义——trace 证据计数远小于此值」）。
- **否决备选**：改 `dedup_sort_truncate` 为稳定排序 / 拆双段——破坏六段契约与全局截断语义，影响面远超本项。

### 3.6 降级语义与保守清单

| 场景 | 行为 |
|---|---|
| callee 无运行时观测 | 完全现状（回落符号补全），零新候选 |
| 有观测、变量类型匹配不上 | 完全现状（仅参数名候选） |
| 变量推断不到类型 | 该变量不出现；不猜、不降级为「无类型也推荐」 |
| 目标 slot 是 self / cls | 不出变量候选（回落参数名候选） |
| 光标段前缀不匹配 | 前缀过滤对所有候选一视同仁（与参数名候选同口径） |
| 光标段含点 / 表达式（`b.` / 嵌套 `f(` 后） | `call_ctx_at` 既有闸门直接让位，本特性不生效 |

---

## 4. 测试清单

主通道 **cargo 单测**（intel 侧浏览器 e2e 不可达——e2e mock 层没有 intel 进程，A3① 期的既定结论）。测试落点 `completion_tests.rs`，直接扩展既有 `call_fixture()`（`scraper.parse_page(url, timeout, retries)`，观测 url:str ×10 / timeout:int ×7 / retries:int ×4）：

| # | 用例 | 断言 |
|---|---|---|
| T1 | 文档 `cb_url = "https://x"` + `scraper.parse_page(cb` | 候选[0] = `cb_url`，kind Variable，detail 含「匹配参数 url · str」；其后才是 `url=` |
| T2 | 同上但光标在第 2 槽（`parse_page("u", cb`，目标 = timeout:int） | 不出现 `cb_url`，候选全为参数名 |
| T3 | `parse_page(url=cb` | keyword 已写 → url 不再作为目标 slot，`cb_url` 不出现 |
| T4 | `parse_page(cb_x`（前缀不匹配） | `cb_url` 不出现 |
| T5 | 两个 str 变量 `page_url` / `u`，param `url` | `page_url`（名称亲和）排前 |
| T6 | `def handler(link):` + `requests.get(li`，callee 有观测且 url:str | `link`（def 参数）入选 |
| T7 | 内层函数内的光标 | 外层函数局部变量不泄漏（def 边界） |
| T8 | callee 无观测 | 候选 == 现状（符号回落），无 Variable kind |
| T9 | 有观测、无匹配变量 | 候选 == 现状（纯参数名），顺序不变 |
| T10 | 性能哨兵（`--ignored`，release 跑） | 5000 行文档 + 60 个变量 + 前缀命中 3 个 → 全程 < 10ms（防 O(变量 × 文档) 退化） |
| T11 | `server.rs` 纯函数 | Variable → `CompletionItemKind::Variable`；sortText 仍为 `1xx` 连续段 |

**真机手测剧本**（跑批只能在用户 PowerShell 终端，见 §8）：

1. 打开 bench/sample 里调用过 `scraper.parse_page` 的项目；新建 `cb_url = "https://example.com"`，下一行 `page = scraper.parse_page(cb`
2. 断言：`cb_url` 首位；Enter 插入纯文本（无 `=`）；继续打 `b` 列表收窄
3. 对照实验：删掉 `cb_url` 行 → 只剩 `url=` / `timeout=` / `retries=`（证明降级路径无损）

## 5. 预算影响

| 文件 | 现值 / 上限 | 预估增量 | 说明 |
|---|---|---|---|
| `type_infer.rs` | 891 / 1050 | +55 | `local_var_types` |
| `arg_var_completion.rs`（新建） | — / **220**（新登记） | ~170 | 匹配 + 排序单模块 |
| `completion.rs` | 870 / 950 | +25 | 接线 + 枚举值 + `active_param_slot` 下沉 |
| `signature.rs` | 372 / 450 | −8 | 委托下沉函数 |
| `server.rs` | 610（登记观察） | +6 | kind 分支 |
| `completion_tests.rs` | 1158 / 1450 | +150 | T1~T11 |
| budget-check 项数 | 43 | **+1 → 44** | 新文件登记先例：`except_completion.rs` / `pathCompletion.ts` |
| `main.ts` / `style.css` / `lsp/client.ts` / `lspCompletion.ts` | — | **0** | 红线文件不碰 |

> 现值以 `ci/budgets.toml` 注释与 2026-10-12 计划文档为准，**动手前先跑 `node shell/scripts/budget-check.mjs` 实测刷新**（注释与实测漂移过：如 client.ts 注释 1,817 vs 计划表 1,840）。
> 纪律不变：估算超标就把逻辑继续往新模块拆，**不申请抬阈值**。

## 6. 明确不做（避免过度工程）

| 项 | 理由 |
|---|---|
| ML 重排 / 本地频率计数 | **既有裁决，不重开**：`completion_interaction_dev_plan.md` §4 P1-C + §5——intel score 已按运行时证据强度排序，比本地启发式真实；本项只在「类型匹配」这个新维度上排序，不引入第二套频率体系 |
| 全量 PSI 索引 / 深度类型推断 | 撞 bundle 与常驻红线，边际收益低；我们的路线是「够用的轻量判定」 |
| 云端全行补全 | 与零上传红线冲突（除非显式授权 + 可开关，另案） |
| stub 类型库（typeshed） | 与运行时观测路线冲突；「只对跑过的函数生效」作为已知边界接受（§7） |
| 光标移动触发补全 | Monaco provider 模型只由输入触发；`(` / `,` / 显式 `Alt+/` 已覆盖主路径 |

## 7. 与 PyCharm 的差距（诚实清单）

| 维度 | PyCharm | 本方案（v1） |
|---|---|---|
| 签名来源 | typeshed stub 全量覆盖 | 仅运行时观测过的 callee（用户自己跑过的代码） |
| 类型推断 | 深度（泛型 / 协议 / 推断） | 轻量（字面量 / 返回类型观测 / 参数名 / for 变量 / def 参数），严格相等 |
| 排序 | 本地 ML 重排 | 类型匹配（门槛）+ 名称亲和 + 源码距离 + 证据计数 |
| 触发 | 输入 / 光标移动 / Ctrl+Shift+Space | `(` `,` 触发字符 / 显式 `Alt+/` |

对外口径提醒：描述本能力时写「运行时观测 + 参数位匹配」，**不写「比 PyCharm 更准」**（永久纪律）。

## 8. 门禁、红线与登记

- **门禁**：`cd intel && cargo test`（T1~T9、T11）+ `cargo build -p opencharm-intel`（test 不刷新 shell 调用的 exe）+ `node shell/scripts/budget-check.mjs`；T10 哨兵 `--ignored` 显式跑
- **真机**：跑批只能在用户 PowerShell 终端执行（会话 shell 跑 tauri dev 不稳定）；输出不过 PowerShell（长行 + 全角会抛终止性异常）；中文注释 `.ps1` 带 UTF-8 BOM
- **红线核对**：不动 probe / intel **采集路径**（本项只碰消费侧补全）；不新增常驻进程 / 依赖；六段 sortText 契约不破；`MAX_CANDIDATES = 50` 不动；无新增用户可见 i18n 文案（detail 是运行时数据，同既有 `⟳ runtime` 格式）
- **登记**（落地后，不提前）：`docs/delivery-overview.md` 版本 +1；`ci/budgets.toml` 增新文件条目；工作记忆回填结论

## 9. 风险与回滚

| 风险 | 评估 | 处置 |
|---|---|---|
| 变量候选挤占 50 条截断名额，把参数名候选顶出 | 概率低（作用域变量通常 <30，函数参数通常 <15） | T1 / T9 守护；若真出现，截断语义本就是「第 51 名外继续输入可达」，无正确性损失 |
| 空段（刚打 `(`）时列表变长 | 与参数名候选同等暴露，靠 boost 保证匹配变量置顶 | 手测剧本观察；不接受则加「空段不出变量候选」一行闸门（预留） |
| 类型严格相等导致匹配率低 | 已知边界（§7） | v1 保守优先；匹配率真实数据出来后再议宽松化（另案） |
| `local_var_types` 大文档性能 | 已按「先枚举后按需推断」压到 O(文档) + O(1) | T10 哨兵钉死 |

**回滚**：`arg_var_completion.rs` 整文件删 + `completion.rs` revert 拼接线 + `signature.rs` revert 委托，三处单点，无协议变更。

## 10. 遗留缺口登记（v1 保守边界，评审时可议）

| # | 缺口 | v1 处置 |
|---|---|---|
| 1 | 解包赋值 `name, price = item` 不收 | 保守不收（误收半边变量比漏收更扰）；爬虫画像高频，v2 候选 |
| 2 | `with open(...) as f:` / 海象 `:=` 变量不收 | 同上 |
| 3 | 泛型标签不等（`list` vs `list[str]`） | v1 严格相等 |
| 4 | 跨函数 / 模块作用域（导入的变量） | 不做，文档文本扫描的天然边界 |
| 5 | 推断不到的变量完全隐身 | 接受（不猜类型原则） |


