# 实参位变量补全 · 运行前融合层开发计划（FUSION-1）

> 面向：Montauri 补全体验迭代。本文自包含，不依赖任何外部参考资料。
> 定位：PyCharm「智能类型匹配补全」的**运行前**等价物——实参位注入「作用域变量候选」，签名与类型全部来自静态引擎（pyrefly / basedpyright），**零运行时依赖、零新索引、零新常驻**。
> 状态：**已实施并经真机反馈闭环（2026-10-14）**——一期（下拉候选）+ 二期（ghost text）+ v2 类型匹配均已落地，§10 真机反馈根因链与防闪烁闸门已修。
> 编写时间：2026-10-14
> 前史：`param_var_completion_dev_plan.md`（P3-T11，intel 侧版本）已**被回滚**——「callee 必须运行过才有观测」的前置条件覆盖面过窄（requests.get 等第三方库、跨模块函数、未跑过的函数全部无候选），用户裁决换运行前静态路线。该文档保留作历史存档，本计划为现行真源。

---

## 0. 探针实证链（本计划的地基，全部可复现）

裸会话探针脚本：`%TEMP%\pyrefly-completion-probe\`（probe.cjs / probe-q1.cjs / probe-hover.cjs / probe-bp.cjs 等，Node spawn 真实引擎 + Content-Length 帧手工协议）。

| # | 结论 | 证据 |
|---|---|---|
| E1 | pyrefly 在 `(` 触发瞬间（空前缀）只返回**参数名**候选（`url=` 等），`isIncomplete=false`；局部变量候选仅在**带前缀**时返回 | probe.cjs 场景 A/A0 |
| E2 | `(` 前一位（表达式位）发补全也拿不到局部变量（只有模块符号）——「双请求 hack」不成立 | probe-dual.cjs |
| E3 | basedpyright 对照：变量候选排第 1、签名同构——**双引擎原料一致**，融合层引擎无关 | probe-bp.cjs |
| E4 | signatureHelp 完整覆盖第三方库（`requests.get` 全签名含参数类型与 docstring），`activeParameter` 对首参/第 2/3 参/keyword 位全部正确；keyword 已写的参数不回跳 | probe-q1.cjs 六场景 |
| E5 | Monaco 0.52 inline/suggest 协同语义（`inlineCompletionsSource.js:44`）：suggest 打开过的会话里 `selectedSuggestionInfo` 残留使 fetch 目标指向 suggestWidgetInlineCompletions 池（augmentation 用），自研 inline provider 结果**不进主渲染池**——Escape 后 ghost 不显示是引擎设计，非 bug | e2e 二分实验 |
| E6 | 干净的 ghost 通道 = 无 suggest 历史的显式触发（`editor.action.inlineSuggest.trigger`，内置命令无默认键位） | GHOST-ISO 探针 |
| E7 | hover 对变量赋值处返回规范形态 `(variable) name: TYPE`——`Literal[42]`、`list[str]`、`requests.models.Response`（全限定）；单次耗时 ~0ms | probe-hover.cjs |
| E8 | inlay hint 会改写 view-line 的 DOM 文本（`def run() -> None:` / `page: str`）——e2e 行匹配须避开 inlay 污染段 | arg-var-fusion spec 首轮失败分析 |
| E9 | pyrefly 变量候选自带类型 detail（`Literal['https://example.com']`）——带前缀路径的候选已有类型信息 | probe.cjs 场景 A |
| E10 | **Monaco 原生 suggest preview 在 autoClosingBrackets 场景永不渲染**：自动插入的 `)` 成为 lineSuffix（`suggestController.getOverwriteInfo` 的 suffixDelta），preview edit 的 range 覆盖 `)` → `computeGhostText` 遇替换性 diff 返回 undefined。关闭 autoClosingBrackets 后 preview 灰字立即恢复（previewMode 三值全试过均被吞） | ghost-preview 探针对照实验（真机反馈根因） |

**E1 + Monaco 既有结论**（「完整列表停止打字后只本地过滤不再请求」）推出本特性存在的理由：**pyrefly 明明有变量候选能力，但用户在实参位永远看不到**——空前缀不给 + 完整列表不重请求，两条路都断。融合层把断路接上。

## 1. 交付形态

### 1.1 一期：下拉候选（主通道）

用户旅程（运行前，无需跑过任何代码）：

```python
def run():
    cb_url = "https://example.com"
    page = parse_page(cb        # ← 光标在此
```

- 打完 `(` 瞬间：融合变量 `cb_url` 置顶（detail `匹配参数 url`），其后是 pyrefly 参数名候选（`url=` / `timeout=` / `retries=`）——两类同屏；
- 逐字输入：每键重请求（`incomplete=true` 强制），实时收窄；
- 逗号进第 2 参数位：目标参数切换为 `timeout`，tier 排序重算（`page_num:int` 压过 `cb_url:str`）；
- 覆盖面：**第三方库全静态可达**（typeshed 签名），跨模块、未跑过的函数全覆盖。

### 1.2 二期：ghost text 灰字（扩展形态 + augmentation 同屏）

- **扩展形态（2026-10-14 晚增强，PROBE-AUG/EMPTY-AUG 实证链）**：ghost 不再是裸变量名，而是「变量名 + `, <下一参数名>=<默认值>)`」——Tab 一步补全「本参变量 + 下参默认值 + 闭括号」，整个调用一步到位（PyCharm「补全调用」体验）；
- **augmentation 同屏（E-AV-6 钉住）**：带前缀输入（如 `c`）+ 下拉打开 + 选中 `cb_url` 时，灰字显示「选中项剩余（`b_url`）+ 扩展段（`, timeout=10`）」双 span——下拉与灰字共存，正是编辑预测的呈现通道（见 `edit_prediction_research_plan.md` §10.1）；
- **后缀必须以 `)` 收尾**（实测矩阵：`,`/`, `/`, timeout=` 全不渲染，`, timeout=10)` 渲染）——autoClosingBrackets 的 `)` 是 lineSuffix，后缀含 `)` 时公共后缀被引擎剥掉、diff 变纯插入；不含则 diff 含替换性 change，`computeGhostText` 返回 undefined；
- 防闪烁闸门（保留）：自动触发 + 光标紧贴 `(`/`,` → 不出 ghost（下拉即将打开，避免闪一下被压）；带前缀后 provider 恢复响应，augmentation 接管；
- 空前缀瞬间（刚打 `(`）无灰字——引擎不给 provider 执行机会（PROBE-EMPTY-AUG 实证），且下拉刚弹出注意力在下拉上，不伤体验。

### 1.3 与 intel 运行时层的关系

叠加不冲突：有 trace 观测的 callee 仍走 intel `1xx` 段；融合层活在 static `2xx` 段头部。运行前 pyrefly 兜底全覆盖，跑过之后 intel 观测排序增强。

## 2. 架构与数据流

```
Monaco completion provider（client.ts registerLspCompletion）
  ├─ queryCompletion("static") ──────→ pyrefly 参数名候选（既有）
  ├─ queryCompletion("intel") ────────→ intel 运行时候选（既有）
  ├─ querySignatureHelp("static") ───→ 实参位探测器（~1ms；非空=实参位，
  │                                     白拿 activeParameter 槽位 + 参数名 + 参数类型）
  └─ completion/argVarCompletion.ts（纯函数，零 monaco/tauri 依赖）
       ├─ computeArgVarsForPosition：前缀回扫 + matchArgVars 总入口（async，hover 注入）
       ├─ scopeVarNames：向上扫描（赋值/for/def 形参，遇 def/class 停）
       ├─ matchArgVars：前缀过滤 + tier 排序（v2 类型匹配，§5）
       └─ argVarToSuggestions：候选构造（static 段头 2 20x，恒排参数名之前）
  → incomplete = 任一路截断 || argVars.length > 0（击键重触发的关键）

Monaco inline provider（completion/argVarInline.ts，二期）
  ├─ 防闪烁闸门：auto 触发 + 光标贴 `(`/`,` → 空（§10）
  ├─ 同一 signatureHelp 探测 + matchArgVars → 首个命中者做 ghost
  └─ 依赖注入防环：setArgVarDeps（hover 请求器）/ setArgVarInlineEditor（editor 引用
     + dev 钩子 __OC_ARGVAR__ + InlineCompletionsController 预热）由 client.ts 装配
```

**关键设计决策**：

1. **signatureHelp 当实参位探测器**：不在 TS 侧重写括号栈解析。~1ms 成本白拿 activeParameter 与参数类型。
2. **六段 sortText 契约不动**：融合变量编号 `2 20x`，pyrefly 参数名从其后顺延。
3. **同名去重以融合版优先**（置顶 + 有 detail）。
4. **扫描口径对齐 intel P3-T11 设计**：遇第一个 `def` 收形参即停、遇 `class` 停、光标行自身不算。

## 3. 现状盘点（已落地，勿重复投入）

| 件 | 状态 | 位置 |
|---|---|---|
| 纯函数模块（扫描/类型匹配/排序/候选构造） | ✅ | `shell/src/completion/argVarCompletion.ts`（212/220） |
| ghost text provider（含防闪烁闸门） | ✅ | `shell/src/completion/argVarInline.ts`（136/150） |
| client.ts 接线（探测 + 注入 + incomplete + 去重 + 依赖装配） | ✅ | `shell/src/lsp/client.ts`（1850/1850 压线） |
| Monaco contribution | ✅ | `shell/src/monaco.ts`（inlineCompletions.contribution；体积显式 +40 见 §9） |
| 单元测试（16 例） | ✅ | `shell/src/completion/__tests__/argVarCompletion.test.ts`（155/180） |
| e2e（真实 pyrefly 桥，5 用例） | ✅ | `shell/e2e/lsp/09-arg-var-fusion.spec.ts`（E-AV-1..5） |
| dev-only 测试钩子 | ✅ | `__OC_ARGVAR__`（triggerInline/acceptInline）+ `__OC_GET_EDITOR__`（诊断） |

## 4. 遗留清单（下次迭代）

| # | 事项 | 落点 |
|---|---|---|
| 1 | i18n：detail 文案 `匹配参数 {name}` 纳管（硬编码中文） | `data/` 词条 + gen_domain.py 三步流程 |
| 2 | ghost 触发键位绑定（`editor.action.inlineSuggest.trigger`） | keybindingDefaults.ts 三处同步（type + META + GROUP、main.ts handler、settings.rs len 断言） |
| 3 | 真机手测剧本二轮（防闪烁闸门验证） | 用户终端 |

## 5. v2 类型匹配（已实施）

### 5.1 排序 tier

```
tier 0：类型匹配 + 名称亲和    （cb_url: str → url: str 且含 "url"）
tier 1：类型匹配               （page_num: int → timeout: int）
tier 2：名称亲和               （v1 语义）
tier 3：其余（近 → 远，名称字典序）
```

### 5.2 匹配判定（保守三层）

1. 基础类型严格相等；
2. Literal 归一后相等（`Literal[42]` ≈ `int`，窄赋宽合法；`Literal['x']` ≈ `str`）；
3. 全限定末段相等（`requests.models.Response` vs `Response`）。

参数侧：param label 的 `: TYPE` 段；无注解 / `Any` / 联合类型（含 `|`）→ 类型维度整体不参与。变量侧：hover 原文 → `parseHoverType` 提取（正则 `(variable) name: TYPE`）→ `normalizeType` 归一。

### 5.3 成本

hover 只对**前缀过滤后的幸存者**发起（通常 ≤3 个，引擎侧 ~0ms + 帧往返 ~1ms）。失败静默降级 v1 排序（单测 U5 钉住）。

## 6. 测试

### 6.1 单元测试（16 例，纯函数零 mock）

scopeVarNames 4 例（作用域边界）+ matchArgVars v1 语义 4 例 + v2 类型匹配 5 例（tier 压序 / Literal 归一 / 末段相等 / 联合类型降级 / hover 失败降级）+ 解析函数 3 例（hover 形态 / Literal 归一 / 全限定末段）。

### 6.2 e2e（`e2e/lsp/09-arg-var-fusion.spec.ts`，真实 pyrefly 桥）

| # | 用例 | 断言 |
|---|---|---|
| E-AV-1 | `(` 触发瞬间 | 融合变量置顶 + 参数名候选同屏 |
| E-AV-2 | 逐字输入 | incomplete 重触发，收窄仍含融合变量 |
| E-AV-3 | 非实参位 | 融合层零介入，编辑器无报错 |
| E-AV-4 | ghost 显式触发（扩展形态） | 灰字含 `cb_url` + accept 落文档 `parse_page(cb_url, timeout=10)` |
| E-AV-5 | v2 类型匹配 | `,` 后 int 变量压过 str 变量（行序断言） |
| E-AV-6 | augmentation 同屏 | 带前缀 + 下拉打开 → 灰字双 span（`b_url` + `, timeout=10`） |

e2e 纪律（E8）：行文本断言避开 inlay hint 污染段；键盘定位用 Ctrl+End + 方向键；`,` 后只输逗号（空格会 hide suggest）。

### 6.3 真机手测剧本

1. 定义 `cb_url = "..."` 后输入 `parse_page(`——`cb_url` 置顶、参数名随后，**无灰字闪烁**（闸门生效）；
2. 逗号进第 2 参位——目标切换，`count = 42` 压过 str 变量；
3. Escape 后触发 ghost 键位——灰字出现，采纳落文档；
4. 对照：删掉 `cb_url` 定义行 → 只剩参数名候选（降级无损）。

## 7. 明确不做（v2 边界）

| 项 | 理由 |
|---|---|
| 子类 / 协议 / 泛型参数推断 | PyCharm 深度推断领域；轻量红线，三层判定够用（匹配率数据出来再议） |
| 变量类型缓存层 | 每键 hover ≤3 次的成本不值得缓存失效逻辑 |
| 跨文件作用域变量 | 文档文本扫描的天然边界（pyrefly 自身候选覆盖 import 场景） |
| 解包 / with / 海象变量 | 误收半边变量比漏收更扰 |
| Escape 后 ghost 自动显示 | 引擎双池语义（E5）不允许干净实现，不 hack |
| suggest 打开期间的灰字（augmentation 或 preview） | preview 被 lineSuffix 吞（E10）；augmentation 需 inline 项比选中项长，语义不匹配 |
| ML / 频率重排 | 既有裁决不重开 |

## 8. 预算

| 文件 | 现值 / 上限 | 说明 |
|---|---|---|
| `completion/argVarCompletion.ts` | 212 / 220 | `completion_argvar_ts_max_lines` |
| `completion/argVarInline.ts` | 136 / 150 | `completion_argvar_inline_ts_max_lines` |
| `completion/__tests__/argVarCompletion.test.ts` | 155 / 180 | `completion_argvar_test_ts_max_lines` |
| `lsp/client.ts` | **1850 / 1850** | 压线（三轮外拆纪律执行） |
| `dist/assets`（JS+CSS） | 5162 / **5170** | **显式 +40**（2026-10-14）：inlineCompletions contribution ~50KB 落按需 monaco chunk，不伤冷启动；不可再拆（双实例竞态实测遭双池语义反噬），理由全文见 `ci/budgets.toml` |
| index chunk | 1583 / 1700 | 不进首屏 |

纪律不变：超标外拆纯函数，**不申请抬阈值**。

## 9. 门禁与红线

- **门禁**：`npx tsc --noEmit`（0 错）+ `node scripts/gate-tests.mjs unit` + `npm run e2e -- e2e/lsp` + `npm run build` 后 `node shell/scripts/budget-check.mjs`；
- **红线**：不动 probe / intel 采集路径；零新常驻 / 依赖；六段 sortText 契约不破；无越权文件访问；
- **基线（2026-10-14 扩展形态增强后）**：vitest 122 文件/1522 · e2e `lsp/09` **6/6**（+E-AV-6）+ lsp 域 43/43 · budget 全 PASS（`argVarCompletion.ts` 215/220）。

## 10. 真机手测反馈闭环（2026-10-14 首轮，已修）

**用户实测现象**：输入 `parse_page(` 后灰字 `cb_url`「一闪而过」消失，编辑器自动补右括号，之后只剩普通下拉（`cb_url` 排第一）。

**根因链（探针二分实锤）**：

1. **闪一下**：输入 `(` 同时触发 inline provider（快）与 suggest 下拉（慢 ~100ms）——灰字先渲染，下拉打开后引擎把 inline 模型切到 suggest 协同池（E5），我们的灰字被撤 → 视觉毛刺；
2. **之后无灰字**：Monaco 原生 suggest preview 在 autoClosingBrackets 场景**永不渲染**（E10）——`)` 成为 lineSuffix，preview edit 变替换性 diff，`computeGhostText` 返回 undefined。对照实验：关 autoClosingBrackets 后 preview 灰字 `b_url` 立即恢复。

**修复**：provider 防闪烁闸门——`triggerKind !== 1`（Explicit=1，Automatic=0）且光标紧贴 `(`/`,` → 不返回 ghost；显式触发不受约束。`suggest.preview` 配置移除（此场景恒无效）。

**定稿语义**：**下拉是实参位主呈现**（置顶 + Tab 接受）；**灰字是显式触发的独立通道**。suggest 打开期间灰字消失是引擎设计，非缺陷。

**右括号说明**：autoClosingBrackets 是 Monaco Python 语言配置的存量行为（`languageDefined` 默认），与本特性无关，非本项引入。

## 11. 风险与回滚

| 风险 | 评估 | 处置 |
|---|---|---|
| signatureHelp 顺发拖慢首帧 | ~1ms | 真机感知延迟则改并行 |
| 融合变量挤占 50 条截断 | 作用域变量通常 <30 | 截断语义无损 |
| hover 逐候选往返 | ≤3 个 | 性能数据不足再议缓存 |
| pyrefly 版本升级改 hover 格式 | LSP 惯例形态 | 解析失败静默降级 v1 |

**回滚**：`argVarCompletion.ts` + `argVarInline.ts` 两文件删 + client.ts 调用点 revert + monaco.ts 一行 import 删 + budgets.toml 体积条目恢复 5120——单点回滚，无协议变更。
