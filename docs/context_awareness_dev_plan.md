# 上下文感知增量开发计划（P3-T12）

> 面向：OpenCharm 补全与模板动作的上下文增量。本文自包含，不依赖任何外部参考资料。
> 定位：把 2026-10-12「PyCharm 上下文补全机制」讨论与代码核对后筛出的**真实缺口**落成可逐项开发的计划——四项，全部轻量、本地、零新依赖。
> 状态：**待评审**（2026-10-12 用户裁决「出增量开发计划文档，不动代码」后编写；注意本计划在维护态下属增强批，是否排期需用户明确）
> 编写时间：2026-10-12
> 追加（同日）：**§10 静态引擎覆盖核对**——裸会话探针实测 `self.`/局部变量/import 别名/多级属性链，三项已覆盖（关闭）、一项保留为候选 A9；探针脚本与靶场随本计划入库。
> 上游文档：`param_var_completion_dev_plan.md`（P3-T11，待评审）· `completion_interaction_dev_plan.md`（已收官）· `live_templates上下文轴修订稿.md`（已实现）

---

## 0. 范围与上游

**四项（按主题分两组）**：

| 项 | 主题 | 侧 | 性质 |
|---|---|---|---|
| A | keyword 实参 RHS 补全（`get(url=cb|` → `cb_url`） | intel | 增强，**依赖 P3-T11** |
| B | 多行调用续行修复（`foo(a,\n  b|` 候选复活） | intel | 上下文 bug 修复 |
| C | postfix 模板类型门控（字面量场景只列适用项） | shell | 契约扩展 |
| D | surround 模板结构筛（按选区形态过滤） | shell | 契约扩展 |

**不在范围（§9 登记）**：③ 类错误恢复（诊断 `relatedInformation` 透传、`RunRecord` 环境快照绑定缺包提示）——用户已决策本计划只覆盖 ①② 类；Enum/Literal 候选（未证实缺口）；灰字行预测（既有探索方案，见 `edit_prediction_research_plan.md`，不重开）。

**与 P3-T11 的关系**：A 项的完整体验（RHS 位给出类型匹配变量）复用 P3-T11 的 `variable_candidates`；若 P3-T11 未落地，A 降级为「只合入上下文识别层 + 单测，用户可见行为不变」（§3-A 有双路径设计）。B/C/D 与 P3-T11 完全独立。

## 1. 现状盘点（已覆盖，勿重复投入）

以 2026-10-12 代码为准，函数名锚定：

| 能力 | 现状 | 位置 |
|---|---|---|
| 调用实参括号栈检测（有界 64 KB 窗口） | 已实现 | `intel/.../call_context.rs` `call_frame_at` |
| 已写 keyword / 位置参数解析 | 已实现 | `call_context.rs` `written_args` / `top_level_eq` |
| 参数名候选 + 位置前跳 | 已实现（A3①） | `completion.rs` `param_candidates` |
| 签名帮助（含当前参数位） | 已实现（A3③） | `signature.rs` `signature_help` / `active_index` |
| keyword RHS 识别 | **不存在**（段含 `=` 直接让位） | `completion.rs` `call_ctx_at` |
| 点前表达式提取 | 已实现（无类型门控，v1 边界） | `shell/src/live-templates/postfix.ts` `extractExprBeforeDot` |
| 环绕选区缩进归一 | 已实现 | `shell/src/live-templates/surround.ts` `prepareSelectionIndent` |
| surround 选择器 | 已实现（只要求非空选区） | `surround.ts` `openSurroundPicker` |
| 模板 schema / 查询 | 已实现 | `schema.ts` `TemplateDef`；`registry.ts` `findSurround` / `findPostfixByPrefix` |
| 模板单测（同居形态） | 已实现 | `live-templates/__tests__/postfix.test.ts` / `surround.test.ts` |
| live-templates e2e | 已实现 | `shell/e2e/lt/01-live-templates.spec.ts` |
| 预算登记 | **仅 manager.ts**（`lt_manager_ts_max_lines = 1400`）；postfix/surround/schema/builtin 均不在预算面 | `ci/budgets.toml` |

## 2. 交互剧本（四项合起来的一天）

```python
# 1) B：多行调用的续行不再断链（今天第 3 行没有参数候选、签名不高亮）
r = requests.get(
    cb_url,
    timeout=30,
)

# 2) A：keyword 实参的右侧直接给匹配变量（今天 url= 后只有无关的函数名候选）
page = requests.get(url=cb|        # → cb_url 置顶

# 3) C：新建容器字面量后的 postfix 只列适用项（今天 .for 对 dict 也出现）
mapping = {"a": 1}.|               # → 只有 if/else/not/print/len/return/str/try，没有 for

# 4) D：环绕面板按选区形态过滤（今天选表达式片段也会列出 try/if/with）
#    选中 resp.json() → 面板只有 quote；选中整行 data = parse(x) → 只有 try/if/with
```

---

## 3. 逐项实施规格

> 每项结构：现状定位 → 交互语义 → 改动方案 → 测试清单 → 预算影响 → 风险与回滚。

### A　keyword 实参 RHS 补全（依赖 P3-T11）

**现状定位**

- `completion.rs::call_ctx_at`：光标所在段必须是空或**纯标识符**，否则 `None` 让位。`url=cb` 含 `=` → 直接落到符号补全。
- 符号补全的候选来自 trace 索引（运行时函数），**本地变量不在其中** → `cb_url` 在 RHS 位永远出不来。
- 签名帮助不受影响（`signature_help` 走 `call_frame_at` + `written_args`，不经 `call_ctx_at`；`url=cb` 已被判 keyword，activeParameter 定位正确）——要修的是**补全侧**。

**交互语义（修好后）**

`requests.get(url=cb|` → `cb_url` 置顶（type str 匹配 `url` 参数）；`requests.get(url=|` → 全部 str 变量按名称亲和/源码距离排序。插入为**纯标识符**（不带 `=`，`=` 用户已打）。目标参数取 `url=` **指定的那个名字**，不是「下一个未填槽」。

**改动方案**

1. `call_context.rs`（+约 25 行）新增段级识别（与 `written_args` 同层的纯函数，不进主扫描）：

```rust
/// 末段 keyword RHS 识别：`url=cb` / `url=` / `url = cb` → Some(("url", "cb"))。
/// 排除比较/复合赋值：`url==cb` / `url!=cb` / `url<=cb` / `url:=cb` → None。
pub(crate) fn keyword_rhs(segment: &str) -> Option<(String, String)>
```

2. `CallCtx` 增 `rhs: Option<(String, String)>`；`call_ctx_at` 末段解析：先试纯标识符（现状），再试 `keyword_rhs`。识别优先级：**RHS 段不再参与参数名候选的 `starts_with` 过滤**（那条路是给参数名用的）。
3. `completion.rs::param_candidates`（+约 10 行）：`ctx.rhs` 为 `Some((name, prefix))` 时——
   - 目标 = `param_observations(f)` 中 **name 对应项**（找不到 → 空，让位）；
   - 不产参数名候选（再产就是 `url=url=` 事故）；
   - 变量候选调 P3-T11 入口：`arg_var_completion::variable_candidates_for_kwarg(index, text, ctx)`——目标参数由 ctx.rhs 指定（**不走 active slot**，这是与 P3-T11 主路径的唯一差别）；P3-T11 未落地时本分支返回 `None`（= 今天行为）。
4. **与 `written_args` 的一致性**：`url=cb` 在非末段时早已被 `written_args` 计为 keyword；RHS 识别只作用于**末段**，两处口径天然一致，不改 `written_args`。

**双路径**：P3-T11 先落地 → A 作为其扩展 slice 一次做完（≈ +45 行）；P3-T11 未落地 → A 只合入 1/2 步 + 单测（行为不变、为接线铺路），**不单独飞**。

**测试清单**（`completion_tests.rs`，复用 `call_fixture`：`scraper.parse_page(url, timeout, retries)`，url:str ×10 / timeout:int ×7）

| # | 用例 | 断言 |
|---|---|---|
| A-1 | `keyword_rhs("url=cb")` / `("url=")` / `(" url = cb ")` | 分别 `Some(("url","cb"))` / `Some(("url",""))` / `Some(("url","cb"))` |
| A-2 | `keyword_rhs` 的比较/复合形态 | `url==cb` / `url!=cb` / `url<=cb` / `url:=cb` → `None` |
| A-3 | `call_ctx_at` 全链：`scraper.parse_page(url=cb` | `callee=scraper.parse_page`、`rhs=Some(("url","cb"))` |
| A-4 | 嵌套 `f(g(a=bb` | 最内层 callee=g（`call_frame_at` 既有语义不破） |
| A-5 | `param_candidates` 在 RHS 位 | **不产** `url=` / `timeout=` 参数名候选（守护 `url=url=` 事故） |
| A-6 | P3-T11 联动（其落地后） | `get("u", url=cb` 目标仍是 `url` 槽（不是下一个未填槽）；str 变量置顶 |
| A-7 | callee 无观测 | RHS 位返回 None → 符号补全（现状） |

**预算影响**：`call_context.rs` +25（412/560）；`completion.rs` +10（870/950）；测试进 `completion_tests.rs`（1158/1450，余 292）；`server.rs` 0（响应形态不变）。A6 依赖 P3-T11，其预算单独登记在彼文档。

**风险与回滚**：RHS 误判（A-2 的五种排除形态已覆盖；dict 字面量用 `:` 不受影响；f-string 调试语法 `f"{x=}"` 在字符串内，`call_frame_at` 字符串跳过已挡）。回滚 = 还原 `call_ctx_at` 段解析两分支。

---

### B　多行调用续行修复

**现状定位**

`call_context.rs::call_frame_at` 开头的廉价前置过滤：

```rust
if !line_text.get(..byte)?.contains('(') { return None; }
```

光标所在行、光标前没有 `(` 直接判「不在调用内」。多行调用的**续行**因此全灭：

```python
r = requests.get(
    cb_url,
    timeout=30,     # ← 本行无 (，第 2/3 行的参数候选、签名高亮全部丢失
)
```

**交互语义（修好后）**：续行位上参数名候选、签名帮助高亮、以及（P3-T11/A 落地后的）变量候选与首行完全一致。

**改动方案**

**删除该前置过滤**，理由三条：

1. 主扫描的括号栈天然覆盖——窗口内无未闭合 `(` 时栈空、`stack.last()?` 返回 None，语义等价且更正确；
2. 预过滤省下的成本相对 `text_offset`（O(行) 定位光标偏移，本来每次必跑）可忽略；
3. 它误伤的是真实高频形态（爬虫/配置类代码多行调用极常见）。

保留一段注释说明「为什么删」防复发。不动主扫描窗口（64 KB）、`call_receiver_at`（单行回扫）、`except_ctx_at` 的相对顺序（`except (` 判分组括号拒绝发生在 `call_ctx_at` 之前，不受影响）。

**测试清单**

| # | 用例 | 断言 |
|---|---|---|
| B-1 | `r = requests.get(\n    cb_url,\n    timeout=cb`，光标在末行 `cb` 后 | `callee=requests.get`，`segments=["cb_url", " timeout=cb"]`，`call_ctx_at` 产出 rhs 上下文（与 A 联动） |
| B-2 | 无调用普通行 `y = a + b` | `None` |
| B-3 | 既有 `call_frame_at` 全部用例（窗口 / 字符串 / def 边界 / 分组括号） | 零回归 |
| B-4 | 性能哨兵 `call_frame_bounded_scan_does_not_scale_with_document` | 1 MB 文档 < 2 ms（`--ignored` release 跑） |

**预算影响**：`call_context.rs` −3 行（净减）；测试 +约 30 行进 `completion_tests.rs`。

**风险与回滚**：每次 `,`/`(` 触发多跑一段扫描——B-4 哨兵兜底（相对 `text_offset` 是常数级增量）。回滚 = 恢复那 4 行。

---

### C　postfix 模板类型门控（字面量场景）

**现状定位**

- `postfix.ts::buildPostfixItems`：`extractExprBeforeDot` 抽出点前表达式后，**直接** `findPostfixByPrefix` 全量列出——文件头注释自述「不做类型门控（v1 边界）」。
- 典型噪声：`{"a": 1}.` 后 `for`/切片类后缀照样出现；`"text".` 后 `len` 之外的也全在。
- v1 只覆盖**字面量与构造表达式**（`[...]` / `{...}` / 字符串），变量/调用拿不到类型的**保持现状**——不为此新增类型推断或 LSP 往返（③ 类里「类型桥」另论，见 §9）。

**交互语义**

`{"a": 1}.` 后只列 dict 适用项；`["x"].` 后 `for` 在、`{"a":1}.` 后 `for` 不在；`data.`（变量，类型未知）行为与今天**完全一致**。

**改动方案**

1. `schema.ts`（+2 行）：`TemplateDef` 增可选字段——**undefined = 全适用**，存量模板零行为变化：

```ts
/** postfix 适用表达式类型（缺省 = 全适用）；仅字面量可判定，v1 见 dev_plan §3-C */
postfixTypes?: ("list" | "dict" | "str")[];
```

2. `postfix.ts`（+约 45 行）新增导出纯函数（与 `extractExprBeforeDot` 同文件同风格，直接进 `postfix.test.ts`）：

```ts
export function detectExprLiteralType(expr: string): "list" | "dict" | "str" | null
// `[` 起 → list；`{` 起 → dict；引号起（含 f/r/b/u 前缀）→ str；其余 → null（不门控）
```

3. `buildPostfixItems`：`detectExprLiteralType(extracted.expr)` 为 `null` → 不过滤（现状）；否则 `templates.filter(t => !t.postfixTypes || t.postfixTypes.includes(type))`。**过滤发生在候选构造前**，六段 sortText 的 `0xx` 段位逻辑不动。
4. `builtin.ts`（+约 10 行）标注：`for` → `["list","dict"]`（迭代容器最常见；str 逐字符迭代无实际意义，不标）；`len` → `["list","dict","str"]`；`if`/`else`/`not`/`try`/`print`/`return`/`str` → 不标（全适用）。
5. `registry.ts` **不改**（查询语义单一，筛选放在消费侧，同 D 的模式）。
6. 管理面板不展示该字段（v1 无 UI/i18n 改动）。

**测试清单**（`live-templates/__tests__/postfix.test.ts` 扩展）

| # | 用例 | 断言 |
|---|---|---|
| C-1 | `detectExprLiteralType` | `[1,2]`→list · `{"a":1}`→dict · `"s"`/`f"x"`/`b'x'`→str · `data`/`f(x)`/`-1`→null |
| C-2 | 过滤矩阵（模板标注 × 表达式类型 × undefined 模板） | 仅「有标注且不含该类型」被过滤；undefined 模板恒出现 |
| C-3 | 回归 | 既有 `extractExprBeforeDot` / `buildPostfixItems` 用例全绿 |
| C-4 | e2e 回归 | `npm run e2e -- e2e/lt`（`01-live-templates.spec.ts`）postfix 用例不破 |

**预算影响**：`postfix.ts` +45、`schema.ts` +2、`builtin.ts` +10、测试 +约 50——**四者均不在预算面**（`ci/budgets.toml` 仅登记 `lt_manager_ts_max_lines`），budget-check 项数不变；落地时仍跑一次 `budget-check.mjs` 确认无新增破线。

**风险与回滚**：误标导致「该出现的不出现」——标注原则**只减不增**，漏标 = 现状，最坏情况是收益变小而非行为错误。回滚 = 删字段 + 删过滤一行。

---

### D　surround 模板结构筛

**现状定位**

- `surround.ts::openSurroundPicker`：只要求选区非空，随后 `findSurround` 按容器筛出的模板**全量列出**。
- 噪声：选中表达式片段 `resp.json()` 时，`try`/`if`/`with` 也在面板里——包出来是 SyntaxError，选错还得重来。

**交互语义**

选中「表达式片段」→ 面板只有 `quote`；选中「完整语句块」（整行/多行）→ 只有 `try`/`if`/`with`。判定为纯语法形态（跨行、行首起、行尾止），不引入 AST。

**改动方案**

1. `schema.ts`（+2 行，与 C 同批）：`surroundStructures?: ("expr" | "stmt")[]`（undefined = 全适用）。
2. `surround.ts`（+约 40 行）新增导出纯函数：

```ts
export function classifySelectionShape(
  text: string, startsAtLineHead: boolean, endsAtLineEnd: boolean,
): "expr" | "stmt"
// 跨行（含 \n）→ stmt；单行且行首起 + 行尾止 → stmt；其余 → expr
```

   口径说明：`startsAtLineHead` **复用** `applySurround` 里已有的同义输入（`atLineHead`，`:174`），不引第二套判定；`endsAtLineEnd` 由选区末列与行尾比较得出（调用处算，函数保持纯）。
3. `openSurroundPicker`：选出结构后 `templates.filter(...)`（同 C 模式）；`applySurround` 与缩进归一不变。
4. `builtin.ts`（+4 行）：`quote` → `["expr"]`；`try`/`if`/`with` → `["stmt"]`。
5. 面板不做字段展示（同 C）。

**测试清单**（`live-templates/__tests__/surround.test.ts` 扩展）

| # | 用例 | 断言 |
|---|---|---|
| D-1 | `classifySelectionShape` | 单行片段 → expr · 单行整行 → stmt · 多行（任意起止）→ stmt |
| D-2 | 过滤矩阵（同 C-2 模式） | 仅「有标注且不含该结构」被过滤 |
| D-3 | 回归 | 既有 `prepareSelectionIndent` / `selectionLinePrefix` 用例全绿 |
| D-4 | e2e 回归 | `npm run e2e -- e2e/lt` surround 用例不破 |

**预算影响**：`surround.ts` +40、`builtin.ts` +4、测试 +约 40；均不在预算面，项数不变。

**风险与回滚**：误判的代价对称（ expr 集合被藏或 stmt 集合被藏）——口径刻意简单可预期（跨行即 stmt）；回滚 = 删字段 + 删过滤一行。

---

## 4. 批次与依赖总览

| 批次 | 项 | 性质 | 依赖 | 侧 |
|---|---|---|---|---|
| 批 1 | B（续行修复） | bug 修复级，风险最低、收益直接 | 无 | intel |
| 批 1 | D（surround 筛） | 纯前端确定性，e2e 有守护 | 无 | shell |
| 批 2 | C（postfix 门控） | 契约扩展，零行为风险（漏标=现状） | 无 | shell |
| 批 3 | A（keyword RHS） | 完整体验依赖 P3-T11 的 `variable_candidates` | **P3-T11** | intel |

建议顺序即表序：批 1 两项可并行（不同侧互不干扰）；A 等 P3-T11 评审结论再定是否同批。

## 5. 预算影响汇总

| 文件 | 现值 / 上限 | 增量 | 项 |
|---|---|---|---|
| `intel call_context.rs` | 412 / 560 | +22（A +25、B −3） | A/B |
| `intel completion.rs` | 870 / 950 | +10 | A 接线 |
| `intel completion_tests.rs` | 1158 / 1450 | +80 | A/B 测试 |
| `intel server.rs` | 610（登记观察） | 0 | 响应形态不变 |
| `shell postfix.ts` | 不在预算面 | +~45 | C |
| `shell surround.ts` | 不在预算面 | +~40 | D |
| `shell schema.ts` / `builtin.ts` | 不在预算面 | +~6 / +~14 | C/D |
| `live-templates/__tests__/*.test.ts` | 不在预算面 | +~90 | C/D 测试 |
| budget-check 项数 | 43 | **0**（无新登记文件） | — |
| `main.ts` / `style.css` / `lsp/client.ts` | 红线 | **0** | 不碰 |

> **叠加账（重要）**：若 P3-T11 与本计划同期落地，`completion.rs` 共用 80 行余量（P3-T11 +25、本计划 +10 → 870+35=905/950，仍可容纳但须**先跑 `budget-check.mjs` 实测刷新**——注释与实测漂移过先例）；`call_context.rs` 434/560、`type_infer.rs` 946/1050，均有余量。
> 纪律不变：估算超标先拆模块，**不申请抬阈值**。

## 6. 明确不做

| 项 | 理由 |
|---|---|
| postfix 的**变量**类型门控 | 需要 intel 类型结论到前端的桥（LSP 往返 + 延迟），超出「字面量判定」的零成本边界；§9 登记为后续 |
| surround 的 AST 级判定 | 纯语法形态判定与既有 v1 缩进处理同口径，够用；不引 tree-sitter/AST |
| RHS 位产参数名候选 | `url=url=` 事故路径，A 明确关闭 |
| Enum / Literal 候选 | 两静态引擎原生覆盖未证实，先核对（§9） |
| ML 重排 / 第二套频率排序 | P1-C + `completion_interaction §5` 既有裁决，不重开 |
| ③ 类错误恢复（relatedInformation / RunRecord 环境快照） | 用户已决策本计划不含，§9 登记 |
| 灰字行预测 | 既有探索方案（`edit_prediction_research_plan.md`），数据与隐私开关未就绪，不重开 |

## 7. 测试通道

| 通道 | 适用 | 位置 / 先例 |
|---|---|---|
| cargo 单测 | A/B 全部（intel 侧 e2e 浏览器层不可达，A3 期既定结论） | `completion_tests.rs`（`call_fixture` 扩展）；哨兵 `--ignored` |
| vitest 纯函数 | C/D 的判定与过滤 | `live-templates/__tests__/postfix.test.ts` / `surround.test.ts`（同居形态，同 `extractExprBeforeDot` 先例） |
| e2e 域回归 | C/D 的行为面 | `npm run e2e -- e2e/lt`（只跑 lt 域，不全量） |
| 真机手测 | A 的体感（RHS 变量置顶） | 用户 PowerShell 终端跑；输出不过 PS（长行+全角终止性异常） |

## 8. 门禁、红线与登记

- **门禁**：intel 项 `cd intel && cargo test` + `cargo build -p opencharm-intel`（test 不刷新 shell 调用的 exe）；shell 项 `npm test`（相关文件）+ `npm run build`（tsc 0 错）+ `npm run e2e -- e2e/lt`；`node shell/scripts/budget-check.mjs`（确认无新增破线）。
- **红线核对**：不动 probe/intel **采集路径**（四项全在消费侧）；不新增常驻进程/依赖；六段 sortText 契约不破（C/D 过滤在候选构造前，段位逻辑零改动）；无新增用户可见 i18n 文案（两个新字段是行为数据，不进面板）；`env_cmds.rs` 冻结不涉及。
- **维护态说明**：B 属缺陷修复（维护态可受理）；A/C/D 属增强，**排期需用户明确裁决**（本文状态即为待评审）。
- **登记**（落地后，不提前）：`docs/delivery-overview.md` 版本 +1；工作记忆回填。

## 9. 遗留缺口登记

| # | 缺口 | 处置 |
|---|---|---|
| 1 | ③ 类：诊断 `relatedInformation` 透传（`client.ts::handleDiagnostics` 未映射）；`RunRecord` 加解释器/cwd 快照、缺包提示按运行实例绑定（`runHistory.ts` / `depHealth.ts::handleTracebackLine`） | 用户决策不含于本计划；后续另立小计划或登记 `dx_features_backlog.md` |
| 2 | postfix 变量类型门控 | 需 intel 类型结论到前端的桥；C 的 `postfixTypes` 声明位已为其预留（届时只需扩展 `detectExprLiteralType` 的数据源） |
| 3 | Enum / Literal 候选 | 先核对 pyrefly/basedpyright 原生覆盖再定是否缺口；只从声明取候选，不从 trace 猜值 |
| 4 | 灰字行预测 | 既有探索方案；补保存时冲刷 dirty 行 + `edit_history_enabled` 隐私开关 + Tab 冲突验证，真实数据达标后立项 |
| 5 | keyword RHS 的「同名不同实现」歧义 | `resolve_callee` 已有唯一裁决式（非 stale、hits 最高），RHS 沿用不引第二套 |
| 6 | 静态引擎对 `self.` / 局部变量 / import 别名 / 多级属性链的覆盖度 | **已实测结清，见 §10**（三项已覆盖→关闭；一项保留为候选 A9） |

---

## 10. 附：静态引擎覆盖核对（2026-10-12 裸会话实测）

**背景**：候选池讨论中列出 4 项「疑似缺口」（`self.` 成员、多级属性链、局部变量、import 别名）。它们可能已由静态引擎覆盖，读代码无法定论——用裸会话探针实测，设施与口径照 `bench/pydantic-probe` 先例。

- **脚本**：`bench/context-coverage-probe/probe.cjs`（新）· **靶场**：`bench/sample/context_coverage/`（新，含 `target.py` 行内标记 + `pyproject.toml`）
- **报告**：`bench/reports/context-coverage-probe-{pyrefly,basedpyright}.json`——该目录 **gitignore**，本地复现：`node bench/context-coverage-probe/probe.cjs pyrefly|basedpyright`
- **引擎口径**：走 `ci/versions.toml` 锁定版 `uv tool run pyrefly@1.3.1 lsp` / `uv tool run --from basedpyright@1.39.10 basedpyright-langserver --stdio`（本机 `uv tool` 装的是 1.3.0 / 1.40.1，直接调用会偏离基线——先例见 `dx_features_backlog.md` 的探针口径）
- **对照设计**：每个场景「有注解 / 无注解」成对，区分「引擎不会做」与「引擎只在有类型信息时做」

**结果**（HIT = 期望标签全中；两引擎均 `diagnosticsReady=true`）：

| 场景 | pyrefly 1.3.1 | basedpyright 1.39.10 | 结论 |
|---|---|---|---|
| `self.` 成员（构造参数**有**注解） | HIT 5 项 | HIT 27 项 | 已覆盖 |
| `self.` 成员（构造参数**无**注解） | HIT 4 项 | HIT 26 项 | 已覆盖（引擎能从无注解赋值推出 self 属性） |
| 多级属性链 `self.customer.`（属性**有**注解） | HIT 5 项 | HIT 27 项 | 已覆盖 |
| 多级属性链 `self.customer.`（属性**无**注解） | **MISS 0 项** | **MISS 0 项** | **真实缺口** |
| 函数内局部变量前缀 `cb_` | HIT 15 项 | HIT 1 项 | 已覆盖 |
| 模块级变量前缀 `module_le` | HIT 38 项 | HIT 1 项 | 已覆盖 |
| import 别名 `import json as js` → `js.` | HIT 27 项 | HIT 22 项 | 已覆盖 |

**结论与动作**：

1. **关闭四项**（`self.` 成员 / 局部变量 / import 别名 / 有类型信息的多级属性链）——**不立项、不进 intel**。两引擎双覆盖；在 intel 重做等于重复投入，且违背「intel 独立、分工不同」的架构铁律。
2. **保留一项真实缺口**：多级属性链在**无任何类型信息**时两引擎均给 0 项。可行的子形态只有一个——
   `self.<attr> = <已观测函数的调用>()`（属性由调用赋值）：文档文本推断可走该调用的 `ret_types`（`type_infer::infer_rhs` 已有 `x = fn()` 口径，需把 LHS 扩展到点链），再复用 `members_for_type`。**不可行子形态**：属性直接来自无注解参数（`self.customer = customer`）——probe 的 shape 只记结构不记属性类型，我们同样拿不到（与 §6 的 `d["k"] = |` 同一条口径限制）。
   → 登记为候选 **A9**（本计划不排期；若做，与 P3-T11 的 `type_infer` 改动合并评估最省）。
3. **降级路径说明（不建议补）**：静态引擎未就绪/失败时，上面「已覆盖」的四项在面板上会整体缺失（intel 不提供它们）。补它等于在 intel 重做静态引擎能力，与分工冲突——登记为已知边界即可。


---

**一句话总结**：B 修 bug（续行复活）、D/C 给动作加上下文闸门（只列适用项）、A 把 P3-T11 的变量匹配延伸到 `name=` 右侧——全部复用既有原料，零新依赖，客户端与预算红线零触碰。



