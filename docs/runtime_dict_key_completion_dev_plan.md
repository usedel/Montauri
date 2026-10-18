# 运行时字典键补全开发计划（P3-T13）

> 面向：Montauri 运行时补全（intel）维护态下的零依赖增量批。
> 定位：把 `docs/context_awareness_dev_plan.md` §10 实测收敛后**唯一剩下的零依赖真实增量**——「键补全」补两个位点：容器方法位（`d.get(`）与实参位 dict 字面量（`f(headers={"|`）。
> 状态：**待评审**（2026-10-12 用户裁决「按投入产出比排序、挑前几条写成可执行小计划」后编写；维护态下属增强，排期需用户明确）
> 编写时间：2026-10-12
> 评审修订（同日，第二轮）：修正 4 处事实错误——`completion_tests.rs` 实测 **1439/1450**（余 11 行）→ 测试改新建 `dict_key_completion_tests.rs`；`server.rs` **664/700**（已入预算面）；`except_completion.rs` 实际 107 行且 **budget-check 未接线**（登记新文件须 toml + addLine 双改）；行数条目 **69**。补齐 3 处设计缺口：① A7'「键按类型标签聚合、不按变量」已知边界（`chain_keys` 全库聚合，与既有 `data["` 同语义）；② A8 callee 回溯口径（遇 `)` 停，链式 callee 不支持）；③ K-1 fixture 的 shape 格式（JSON 对象 + 裸 `dict` 标签，与旧 Keys 格式 `["title"]` 的区别）。
> 上游：`context_awareness_dev_plan.md` §10（双引擎裸会话实测）· `param_var_completion_dev_plan.md`（P3-T11）· `completion_interaction_dev_plan.md`（已收官）

---

## 0. 为什么只剩这两条（实测依据）

`context_awareness_dev_plan.md` §10 用裸会话探针把候选池过了一遍，结论是**大部分「疑似缺口」已被静态引擎覆盖**：

| 原候选 | 实测结论 | 处置 |
|---|---|---|
| `import` 模块名 / `from … import` 成员（含工作区模块） | 两引擎均 HIT | 关闭 |
| `raise` 异常类型 | 两引擎均 HIT（内置/可静态解析） | 关闭 |
| `self.` 成员 / 局部变量 / import 别名 / 有注解的多级属性链 | 两引擎均 HIT | 关闭 |
| **容器方法键（无类型变量）** | pyrefly **0 项**；basedpyright 186 项但**无一个键字面量** | **保留 → 本计划 A7'** |
| 实参位 dict 字面量键骨架 | 未被任何引擎覆盖（无对应形态） | **保留 → 本计划 A8** |
| `return` 期望类型 / `*`、`**` 解包 / f-string 插值变量 | 需 `local_var_types` | 依附 P3-T11，不在本计划 |

两条保留项的共同点：**数据源是我们独有的运行时观测**（dict 的 shape 键），且**静态引擎在无类型信息时恰好给不出**——这正是 intel 的分工。两条都零依赖（不依赖 P3-T11）、intel 侧、无客户端改动。

## 1. 现状盘点（锚点）

| 能力 | 现状 | 位置 |
|---|---|---|
| 下标位键补全（`data["` → 裸名候选） | 已实现 | `completion.rs` `subscript_ctx_at` 分支 |
| jmespath 字符串内路径补全 | 已实现（字符串内检测先例） | `completion.rs` `jmespath_ctx_at` |
| 运行时 dict 类型推断 / 键聚合 | 已实现 | `type_infer::infer_receiver_type` / `chain_keys`（`members_for_type` 是其薄封装） |
| 参数 shape 的「常见键」派生 | 已实现（签名弹窗在用） | `type_infer::shape_members`；`signature.rs` `ParamInfo.members` |
| 参数位观测（含 shape） | 已实现 | `completion.rs` `param_observations` |
| **容器方法位的键**（`d.get(`） | **无**（callee 解析失败 → 回落符号补全） | —— |
| **实参位 dict 字面量的键**（`f(h={"|`） | **无**（`call_ctx_at` 段校验拒绝 `{"`） | —— |
| 同类小特性外提先例 | 已实现（但登记不完整） | `except_completion.rs`（107 行；`budgets.toml` 有上限 150 的条目，**`budget-check.mjs` 的 `addLine` 未接线**——登记新文件必须两处都改，这是反面先例） |

## 2. 交互剧本

```python
d = {"url": "https://x", "title": "首页"}      # 运行时观测到 dict 的 shape

d.get(|          # → "url" / "title"（带引号插入，按 obs 计数降序）
d.get(u|         # → 只剩 "url"
d.pop(|          # 同族：pop / setdefault

requests.get(headers={"|    # → 该参数观测到的常见头键（shape 成员）
requests.get(params={"|     # → 参数字典的常见键
```

不适用时**完全保持现状**：方法名不在白名单（`d.items(`）、receiver 推不出类型、参数无 shape、非实参位的 dict 字面量（`d = {"|`）——一律零候选、零行为变化。

---

## 3. 逐项实施规格

> 结构：现状定位 → 交互语义 → 改动方案（含代码骨架）→ 测试清单 → 预算影响 → 风险与回滚。

### A7'　容器方法位的键补全（`d.get(` / `d.pop(` / `d.setdefault(`）

**现状定位**

- `complete_with_meta` 的调用实参分支：`call_ctx_at` → `param_candidates`。`d.get(` 的 callee 解析（`resolve_callee` 按末段 `get` 找 trace 函数）通常失败 → `None` → 回落符号补全，面板里没有任何键。
- `subscript_ctx_at` 只覆盖 `d["` 形态（候选为**裸名**）；方法位没有对应分支。
- 引擎侧实测（§10.2）：无类型变量上 pyrefly **0 项**、basedpyright 186 项但**无一个键字面量**。

**交互语义**：`d.get(|` → `"url"` / `"title"`（**带引号**插入，按观测计数降序）；已输前缀时按裸名过滤（`d.get(u|` → 只剩 `"url"`）。

**改动方案**

1. 新建 `intel/crates/montauri-intel/src/dict_key_completion.rs`（先例：`except_completion.rs` —— 同类小特性外提 + 独立预算项）：

```rust
/// 容器方法位的键补全：`<recv>.<method>(` 且 method ∈ {get,pop,setdefault}。
/// 返回 None = 不适用（让位参数名候选 / 符号补全，行为不变）。
pub(crate) fn dict_method_key_candidates(
    index: &TraceIndex,
    text: &str,
    line: u32,
    ctx: &CallCtx,
) -> Option<Vec<Candidate>>
```

   判定链（每步失败即 `None`）：
   - `ctx.callee` 按 `rsplit_once('.')` 拆 `(receiver, method)`；`method` 不在 `const DICT_KEY_METHODS: [&str; 3] = ["get", "pop", "setdefault"]` → `None`
   - `receiver` 必须是**纯标识符**（`is_identifier`）——链式 receiver 见 §6
   - `type_infer::infer_receiver_type(index, text, receiver, line)` → `is_dict(&ty)` 才继续（`is_dict` 按类型标签解析判定，`dict` 与 `dict[str,int]` 等参数化标签均算 dict）
   - `type_infer::chain_keys(index, &ty, &[])`（= `members_for_type`）→ 逐键构造候选

> ⚠ **已知边界（键按类型聚合，不按变量）**：`chain_keys` 遍历的是 `observations_of_type(ty)` 的**全库观测**——`d.get(` 给出的是「任何地方观测到的该类型标签的所有键」，不保证都属于 `d`。既有 `data["` 下标补全是同一语义（同一函数、同一聚合），本特性只是把同一数据搬到方法位，**不引入新的不精确性**；但文档与手测须知情：键序/键集是库级聚合，写着「常见键」而非「这个变量的键」。

2. 候选构造（**引号是硬要求**：`d.get(url` 是 NameError）：

```rust
let label = format!("\"{key}\"");
Candidate {
    label: label.clone(),
    kind: CandidateKind::Field,
    detail: format!("⟳ runtime · {ty} · {count} obs"),
    score: count,
    insert_text: Some(label),   // 带引号插入
}
```

   前缀过滤：`ctx.segment` 为空 → 全给；非空 → 按**裸名** `starts_with(segment)`（用户此时打的是裸前缀，还没打引号）。

3. `completion.rs` 接线：调用实参分支内**先试** `dict_method_key_candidates`，命中即返回；否则走原 `param_candidates`。顺序理由：`d.get(` 的 receiver 是 dict 时，参数名候选（`key=` / `default=`）本就不是用户意图；两者同时可得时以键优先（**测试 K-7 钉死该优先级**）。
4. `CallCtx` 提为 `pub(crate)`（P3-T12 §3.4 已规划；若 P3-T12 未落地则本项自行提升，两处改动等价）。

**测试清单**（新建 `dict_key_completion_tests.rs`——`dict_key_completion.rs` 的 `#[cfg(test)] #[path]` 子模块，同 `completion.rs` / `completion_tests.rs` 拆分形态。**不能进 `completion_tests.rs`**：该文件 2026-10-12 实测 **1439/1450**，仅剩 11 行）

**fixture 扩法（实现时照此，避免 shape 格式坑）**：现有 `call_fixture` 的 `ret_types` 行是 `('dict[str, int]', '["title"]', 4)`——`["title"]` 是**旧 Keys 格式**（JSON 数组），且标签带参数化后缀。本特性要的是：`infer_rhs` 对 dict 字面量返回**裸标签 `dict`**，随后 `chain_keys(index, "dict", &[])` 查 `observations_of_type("dict")`。因此 fixture 须新增一行观测：`INSERT INTO ret_types(fid,type_label,shape,count) VALUES(1,'dict','{"url": "str", "title": "str"}',4)`——shape 是 **JSON 对象**（经 `parse_shape` → `ParsedShape::Dict`，`shape_members` 按键名排序返回）。标签与 shape 格式任一不对，`chain_keys` 就返回空、测试全 MISS。

| # | 用例 | 断言 |
|---|---|---|
| K-1 | `d = {"url": u, "title": t}` + `d.get(` | 候选含 `"url"` / `"title"`；`insert_text` **带引号**；detail 含 `⟳ runtime` |
| K-2 | `d.get(u` | 只剩 `"url"` |
| K-3 | `d.items(`（非白名单） | `None` → 现状（参数名/符号路径不变） |
| K-4 | receiver 是 list 观测 | `None` |
| K-5 | receiver 推不出类型 | `None`（面板零变化） |
| K-6 | `d["` 既有下标补全 | 不回归（裸名形态、段位 `1xx` 不变） |
| K-7 | receiver 是 dict **且** 存在同名用户函数 `get` | 键候选优先（本项胜出），且不产生 `key=` 参数名候选 |
| K-8 | `d.pop(` / `d.setdefault(` | 同 K-1 产出 |

**预算影响**（2026-10-12 实测值）：新文件 `dict_key_completion.rs` ≈ 150 行 → 新登记 `intel_dict_key_completion_rs_max_lines = 200`；测试进新建 `dict_key_completion_tests.rs`（新登记 250，+约 90）；`completion.rs` 870/950 +约 15（接线 + 一处 `pub(crate)`）；`server.rs` **664/700** 0（响应形态不变）；budget-check 行数条目 69 → **+2**（两个新文件，登记须 toml + `addLine` 双改，见 §7）。

**风险与回滚**：误触发面极小（三重前置：白名单方法 + 标识符 receiver + dict 类型推断成功）；最坏情况是「多出几个带引号的候选」，不产生错误插入。回滚 = 删模块 + 还原接线一行。

---

### A8　实参位 dict 字面量的键骨架（`f(headers={"|`）

**现状定位**

- `f(headers={"|` 今天零候选：`call_ctx_at` 要求光标段为空或纯标识符，`{"` 不满足 → 让位；点链 / 下标分支也不匹配该形态。
- 数据源现成：`param_observations(f)` 的 `shape` + `type_infer::shape_members(shape, type_label)`（`signature.rs` 已在用它给签名弹窗的「常见键」）。
- ⚠ **不能复用 `call_frame_at`**：Monaco 自动闭合引号会让光标落在**已闭合字符串**内，而 `call_frame_at` 的字符串扫描遇到已闭合字符串直接返回 `None`（`end > cursor` 分支）。必须走行内检测——先例是 `jmespath_ctx_at` 与 `subscript_ctx_at`。

**交互语义**：`requests.get(headers={"|` → 该参数观测到的常见键（裸名插入，右侧闭合引号由 Monaco 自动补全提供）。

**改动方案**

1. 同模块（`dict_key_completion.rs`）新增行内检测：

```rust
/// `callee(<param>={"<prefix>` / `callee(<param>={|<prefix>` → (callee, 目标参数名, 前缀)
pub(crate) fn dict_literal_arg_ctx_at(
    text: &str, line: u32, character: u32,
) -> Option<(String, String, String)>
```

   扫描步骤（全部行内、纯文本）：光标向左取 `[A-Za-z0-9_]*` 作前缀 → 其前允许 `{` 或 `{"` / `{'` → 再前是 `<ident>=`（目标参数名）→ 再前是 `(` → 从 `(` 向左回溯标识符/点链得 callee。回溯字符集同 `call_frame_at`（`[A-Za-z0-9_.]`）——**遇 `)` 即停，含括号的链式 callee 不支持**（同 §6 遗留 1 与 A7' 的边界，两处口径一致）。
2. 候选构造：`resolve_callee(callee)` → `param_observations(f)` → 找 `name == 目标参数` 的项 → 其 `shape` 经 `shape_members(shape, type_label)` 展开为键 → 逐键构造候选（**裸名** label + 无 `insert_text`，与 `data["` 既有形态一致）。
3. `completion.rs` 接线：置于调用实参分支**之前**（`{"` 形态不会被 `call_ctx_at` 接受，顺序上不冲突，前置只为可读性与「更具体优先」的一致性）。

**测试清单**（A8 的检测与候选同进 `dict_key_completion_tests.rs`；K-10 复用 `call_fixture` 的 `url` 参数观测即可，但该参数 shape 为空——需按上面的 fixture 扩法给 `headers` 补一条带 JSON 对象 shape 的观测）

| # | 用例 | 断言 |
|---|---|---|
| K-9 | 行内检测：`f(h={"a` → `Some(("f","h","a"))`；`f(h={|` → `Some(("f","h",""))` | 纯函数单测 |
| K-10 | 键来自 `shape_members`（不新造解析） | 与签名弹窗同一份派生（同参同源） |
| K-11 | 目标参数无 shape（如 `timeout={`） | 零候选（不猜） |
| K-12 | 嵌套 `f(g(h={"|` | callee = `g`（最内层） |
| K-13 | 非实参位 `d = {"|` | 不触发（登记遗留） |
| K-14 | `f(h={x` （值非字符串） | 不触发（前缀必须是键名形态） |

**预算影响**：并入 `dict_key_completion.rs`（同文件，上限 200 内）；`completion.rs` 接线已含在 A7' 的 +15；测试 +约 50。

**风险与回滚**：误触发面同样由三重前置约束（`<ident>={` 形态 + callee 可解析 + 参数有 shape）；键名可能包含空格/特殊字符（如 `User-Agent`），裸名插入后引号内形态合法（`{"User-Agent": ...`）——K-10 覆盖。回滚 = 删函数 + 还原接线。

---

## 4. 批次与依赖

| 批次 | 项 | 依赖 | 说明 |
|---|---|---|---|
| 批 1 | A7'（方法位键） | 无 | 价值最高、改动最小、复用最充分 |
| 批 2 | A8（实参 dict 字面量键） | 无（同模块，建议同批或紧随） | 检测稍复杂（行内扫描 + 自动闭合引号） |

两项同文件同族，可一次落地；也可只做 A7' 先验证体感。

## 5. 预算影响汇总

| 文件 | 实测现值 / 上限 | 增量 | 说明 |
|---|---|---|---|
| `intel dict_key_completion.rs`（新建） | — / **200**（新登记） | ~150 | A7' + A8 |
| `dict_key_completion_tests.rs`（新建） | — / **250**（新登记） | ~140 | K-1~K-14。**不能进 `completion_tests.rs`**：该文件 **1439/1450**，仅剩 11 行 |
| `intel completion.rs` | 870 / 950 | +15 | 两处接线 + `CallCtx` 可见性 |
| `intel completion_tests.rs` | **1439 / 1450** | **0** | 已近满，不再追加 |
| `intel server.rs` | **664 / 700** | 0 | 已入预算面（首版误记为「登记观察」） |
| budget-check 行数条目 | **69**（`addLine` 计数） | **+2** | 两个新文件；登记须**两处**：`ci/budgets.toml` + `budget-check.mjs` 的 `addLine`（`except_completion.rs` 只改 toml 未接线，是反面先例） |
| `main.ts` / `style.css` / `lsp/client.ts` / `lspCompletion.ts` | 红线 | **0** | 不碰 |

> 下表现值均为 **2026-10-12 `budget-check.mjs` 实测值**（评审修订：首版引用的 `completion_tests.rs 1158/1450`、`server.rs 610 观察项`均与实测不符，已修正）。若与 P3-T11 / P3-T12 同期落地，`completion.rs` 三方合计 +50 → **920/950**（可容纳但余量变薄，优先拆模块而非抬阈值）；三个计划的测试文件各自新开，`completion_tests.rs` 不再追加任何内容。

## 6. 明确不做

| 项 | 理由 |
|---|---|
| 链式 receiver 的方法键（`resp.json().get(`） | `call_frame_at` 的 callee 回溯遇 `)` 即停（callee 以 `.` 结尾 → 整体 `None`），要支持需另立「含括号 receiver」的解析，超出本批 |
| 引号内形态 `d.get("|`（光标在已闭合字符串内） | 与 A8 的检测方式可复用，但 v1 只做无引号形态；登记遗留 |
| 非实参位的 dict 字面量（`d = {"|`） | 无目标参数 shape 可依据；不猜 |
| 键名之外的「值候选」（`{"url": |`） | 需要「键 → 值类型」映射，而 probe 的 shape 只记结构不记标量类型（同 §10 的 `d["k"] = |` 口径限制） |
| 与静态引擎的重复覆盖 | 本项只在 intel 有观测时产出；有 TypedDict 等注解时引擎已给键，intel 候选因 `1xx` 段位会排在前——这是既有契约（运行时证据优先），detail 已标 `⟳ runtime` 供用户区分 |
| ML 排序 / 频率重排 | 既有裁决（P1-C + `completion_interaction §5`） |

## 7. 门禁、红线与登记

- **门禁**：`cd intel && cargo test` + **`cargo build -p montauri-intel`**（`cargo test` 不刷新 shell 调用的 exe）+ `node shell/scripts/budget-check.mjs`
- **真机手测剧本**（跑批只能在用户 PowerShell 终端；输出不过 PowerShell）：跑一个会产出 dict 的项目脚本（bench/sample 的爬虫样例）→ 写 `d = resp.json()` → 输入 `d.get(` 断言键候选带引号；再试 `requests.get(headers={"|`
- **红线核对**：不动 probe/intel **采集路径**（只碰消费侧补全）；不新增常驻进程/依赖；六段 sortText 契约不破（键候选在 `1xx` 段）；`MAX_CANDIDATES = 50` 不动；无新增用户可见 i18n 文案（detail 是运行时数据，同既有 `⟳ runtime` 格式）
- **登记**（落地后）：`docs/delivery-overview.md` 版本 +1；**新文件两处登记**——`ci/budgets.toml` 加 `intel_dict_key_completion_rs_max_lines = 200` / `intel_dict_key_completion_tests_rs_max_lines = 250`，**且** `shell/scripts/budget-check.mjs` 的 `addLine(...)` 各加一行（只改 toml 不接线 = 无守护，反面先例 `except_completion.rs`）；工作记忆回填

## 8. 遗留缺口登记

| # | 缺口 | 处置 |
|---|---|---|
| 1 | 链式 receiver 的方法键（`resp.json().get(`） | 需含括号 receiver 的 callee 解析；另案 |
| 2 | 引号内形态（`d.get("|`） | v1 不做；与 A8 检测方式同源，后续可低成本合并 |
| 3 | 非实参位 dict 字面量键 | 无 shape 依据，不猜 |
| 4 | 键对应的**值**类型（`{"url": |`） | 受 shape 只记结构的口径限制（同 `d["k"] = |`），不可行 |
| 4b | 键的**逐变量**归位（`d.get(` 只给 `d` 自己的键） | `chain_keys` 按**类型标签**全库聚合（§3-A7' 已知边界）；要逐变量需 probe 记录「变量 → shape」关联，属采集路径，红线不可行。接受「常见键」口径（与既有 `data["` 一致） |
| 5 | A4（`return` 期望类型）/ A5（`*`、`**` 解包）/ A6（f-string 插值变量） | 依附 P3-T11 的 `local_var_types`，归「P3-T11 扩展批」 |
| 6 | A9（无注解多级属性链，属性由已观测调用赋值） | 登记，不排期 |
| 7 | A1 / A2 / A3 与 B 组四项 | **已实测关闭**（两引擎覆盖，见 `context_awareness_dev_plan.md` §10） |


