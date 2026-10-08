# 补全交互层开发计划

> 面向：OpenCharm 补全功能后续迭代。本文自包含，不依赖任何外部参考资料。
> 定位：把「补全引擎能力」之外的**交互体验层**缺口拆成可逐项落地的开发项，按投入产出比排序。
> 状态：**已收官**（2026-10-08：P0-C 落地 + P1-B 的 `commitCharacters` 下发 spike 结清，§2 四个批次全部交付；维护态下仅受理缺陷修复）。
> 编写时间：2026-10-07　·　评审修订：2026-10-07（逐项核对代码后修正 P0-A/P0-B 的落地前提，补遗留缺口登记，v2 起为 §8）
> 细化定稿：2026-10-07（v2——每项补齐「现状定位 / 交互语义 / 改动方案（含代码骨架）/ 测试清单 / 预算影响 / 验收剧本」，可按 §2 批次直接进入开发）
> P0-C 收口：2026-10-08（**自动化 spike 取代 DevTools 手测**：四取值 × 四场景矩阵机器判定，结论回填 §3 P0-C；
> 计划里的 ⚠spike 假设「`whenTriggerCharacter` 下显式触发也不预选」**被实测推翻**）

---

## 0. 心智模型（一句话）

补全 = **候选池 → 过滤 → 排序 → 弹窗交互 → 接受动作**，是一条有状态的流水线。其中：

- **前段（候选池 / 过滤 / 排序）** 我们已经很扎实：四层合并契约、自研 auto-import 补引擎缺口、运行时频率排序。
- **后段（弹窗交互 / 接受动作）** 是我们相对薄弱、也决定「用户是信任补全还是关掉补全」的部分——这是本计划的主战场。

一个关键认知：**「补全不出来」多数不是排序问题，而是类型推断与候选池质量问题**；排序优化在候选池质量不高时救不了命。所以本计划不碰排序魔改，聚焦交互正确性与体感。

---

## 1. 现状盘点（已覆盖，勿重复投入）

| 能力 | 现状 | 位置 |
|---|---|---|
| 四层合并（模板 `0xx` / auto-import `0y` / alias `0z` / intel `1xx` / 静态 `2xx` / 关键字 `3xx`） | 已实现，sortText 段位固定，天然「异步汇聚 + 列表不抖动」 | `shell/src/lsp/client.ts`（`registerLspCompletion`）；`shell/src/live-templates/`；`shell/src/autoImport.ts`；`shell/src/importAlias.ts`；`shell/src/completion/keywordCompletion.ts` |
| 自动导入 + `additionalTextEdits` | 已实现（自研工作区顶层符号索引 + 头部插 import；LSP `additionalTextEdits` 映射到位） | `autoImport.ts`；`client.ts`（`resolveCompletionItem` 内 `additionalTextEdits` 映射） |
| 自定义别名（np/pd/plt…） | 已实现，内置表 + 工作区频率学习两层 | `importAlias.ts` |
| 补全二段 resolve | 已实现（`completionItem/resolve` 拉 detail/docs/insertText/additionalTextEdits） | `client.ts`（`resolveCompletionItem`） |
| 参数信息（signature help） | 已实现 | `client.ts`（`registerLspSignatureHelp`） |
| Postfix / 语句模板 + 面板 | 已实现 | `live-templates/postfix.ts`；`live-templates/palette.ts` |
| 诊断合并 + source 标记 | 已实现 | `client.ts`（诊断去重段） |
| 第二级全项目符号搜索（独立命令，不混进默认补全） | 已实现（quickOpen 符号模式，PR-G2） | `autoImport.ts`（`workspaceSymbolsSnapshot`） |
| 索引状态 UI / 降级提示 | 部分：references/rename 有「索引不稳定」提示（`engineChip.ts`）；补全侧待补齐（见 §4 P1-E） | `client.ts` + i18n（`ide.engine.indexingTitle` 等） |
| 禁子串进补全 / 仅前缀匹配 | 已满足（`wordBasedSuggestions: "off"`） | `main.ts`（编辑器选项） |
| 文档词兜底按语言开关 | 已实现 | `completion/wordBasedSuggestions.ts` |
| 请求超时 + pending 无界泄漏防护 | 已实现（`REQUEST_TIMEOUT_MS` + `pending` 定时句柄） | `client.ts`（`requestEngine`，`EngineSession.pending`） |

**结论**：引擎/能力层基本到位。剩余缺口集中在「补全协议正确性」与「弹窗接受交互」两类，见下文。

> 术语对齐（评审修订）：同一套段位契约在仓库里有三种叫法——本文档与 `ci/budgets.toml:146` 称**六段**，
> §1 首行沿用「四层」（模板/别名自动导入算一层、intel、静态、关键字），`client.ts:647` 的注释写「三层合并」
> （它只负责 intel `1xx` + 静态 `2xx` 两段，其余段位由各自 provider 产出）。**段位数值是唯一真源，
> 「几层」只是视角差异**，后续引用请连段位一起写，别只写层数。

> 环境事实（v2 核对）：Monaco **0.52.2**（`shell/package.json:23`）；`client.ts` 实测 **1,795 行**
> （`ci/budgets.toml:147` 上限 1,850，**余量 55 行**；预算注释里记的 1,774 已滞后，下次登记时顺手刷新）。

---

## 2. 批次与依赖总览（v2 新增）

| 批次 | 项 | 性质 | 依赖 | client.ts 净增估算 | 状态 |
|---|---|---|---|---|---|
| 批次 1 | P0-A1（intel 声明 `is_incomplete`） | 协议正确性 | 无 | 0（不动 client.ts） | ✅ `a800416` |
| 批次 1 | P0-A2（客户端透传 `isIncomplete`） | 协议正确性 | **必须先 A1** | ≈ +5（类型/解析外迁抵消大头） | ✅ `93b4c9a` |
| 批次 1 | P0-B（过期响应丢弃 + token 早退） | 健壮性 | 无 | ≈ +11 | ✅ `93b4c9a` |
| 批次 2 | P0-D（insert 坐标/接受路径测试） | 测试守护 | 无（可与批次 1 并行） | ≈ −2（映射外迁） | ✅ `d97e7ea` |
| 批次 3 | §8-1（`preselect` 映射）+ P0-C（selectionMode 软硬选中） | 交互体感 | 8-1 先行；P0-C **先 spike 再定值** | ≈ +3 | ✅ `63693ff` + `9707b1e` |
| 批次 4 | P1-A（Enter=插入 / Tab=替换） | 可选增强 | 批次 1 合并后 | ≈ +4（textEdit 映射外迁） | ✅ `63693ff`（spike 后由 P0-C 结清） |
| 批次 4 | P1-B（`commitCharacters`） | 可选增强 | 无 | ≈ +2（+设置面） | ✅ `63693ff`（spike 2026-10-08 结清：两引擎不下发） |
| 批次 4 | P1-E（补全侧忙碌提示） | 可选增强 | 无 | 0 | ✅ 验证后不改码关闭 |

**依赖链**：`P0-A1 → P0-A2`；`§8-1 → P0-C 兜底方案`；其余互不阻塞。
**行数总账**：全部落地后 client.ts ≈ 1,815 / 1,850 ✓；新增纯模块 `shell/src/completion/lspCompletion.ts`（≈ 90 行，**预算面新增 1 项，budget-check 37 → 38**）。

---

## 3. P0 批次逐项实施规格

> 每项统一结构：现状定位 → 交互语义（用户视角）→ 改动方案（接口 + 代码骨架）→ 测试清单 → 预算影响 → 风险与回滚。
> 「Monaco 机制」小节凡标 ⚠spike 的，均为按 0.52.2 源码/文档推断、**实现前必须先实证**的行为假设。

### P0-A1　intel 补全响应声明 `is_incomplete`（引擎侧，先行）

**现状定位**

- `intel/crates/opencharm-intel/src/server.rs:348` 返回 `Ok(Some(CompletionResponse::Array(items)))`——**LSP 裸数组无法携带 `isIncomplete`**。
- `intel/crates/opencharm-intel/src/completion.rs:23` `const MAX_CANDIDATES: usize = 50`；`:579` `v.truncate(MAX_CANDIDATES)`——intel **实际在截断，却从不声明**。
- 截断信息在 `dedup_sort_truncate`（`:566-581`）内部丢失；`complete()`（`:74`）只返回 `Vec<Candidate>`，调用方无从得知是否截断。
- `dedup_sort_truncate` 共 4 个调用点：`:90`（jmespath 分支）、`:111`（调用实参分支，经 `param_candidates` `:206-228` 间接）、`:183`（主路径末尾）、`:228`（`param_candidates` 内部）。

**交互语义（修好后用户视角）**

运行时补全候选超过 50 条被截断时，继续输入会**重新向 intel 请求**（而不是拿截断列表在本地过滤），第 51 名以后的运行时符号（低频但存在的字段/参数名）重新可达。修复前：这些符号**永远补不出来**，且无任何迹象。

**Monaco 机制**：Monaco 对 `incomplete: true` 的列表不做「可本地过滤的完整集合」假设，继续输入必重新调用 provider；`incomplete: false` 的列表则可能在同词内只做客户端过滤。我们要的就是前者这个副作用。

**改动方案**

1. `completion.rs`：
   - 新增 `CompletionOutcome { candidates: Vec<Candidate>, truncated: bool }`（派生 `Default`，供 `unwrap_or_default` 沿用）。
   - `dedup_sort_truncate` 返回 `(Vec<Candidate>, bool)`：`truncate` 前先记 `let truncated = v.len() > MAX_CANDIDATES;`。
   - 四处调用点机械适配；`param_candidates` 改返回 `Option<(Vec<Candidate>, bool)>`（内部函数，无外溢）。
   - 新增 `pub fn complete_with_meta(...) -> CompletionOutcome`（原 `complete()` 函数体迁入，收 tuple）；
     `pub fn complete(...)` 保留原签名、一行委托 `.candidates`——**测试面 30+ 调用点零改动**。
2. `server.rs`（`:311-349` completion handler）：
   - `spawn_blocking` 改调 `complete_with_meta`；抽出纯函数便于无 Client 单测：

```rust
/// candidates → LSP 响应（截断时声明 is_incomplete，让客户端继续输入时重新请求）
fn to_completion_response(outcome: CompletionOutcome) -> CompletionResponse {
    let items = outcome.candidates.iter().enumerate()
        .map(|(i, c)| CompletionItem {
            label: c.label.clone(),
            kind: Some(match c.kind { /* 原映射不变 */ }),
            detail: Some(c.detail.clone()),
            insert_text: c.insert_text.clone(),
            sort_text: Some(format!("1{:03}", i)),
            ..Default::default()
        })
        .collect();
    CompletionResponse::List(CompletionList { is_incomplete: outcome.truncated, items })
}
```

**红线澄清**：改的是 **LSP 响应封装**，不是采集路径，**不违反** §7「不改动 `probe`/`intel` 采集路径」。`MAX_CANDIDATES = 50` 数值不动（调阈值是另一个议题）。
**非目标**：索引未加载/加载中返回空候选时**不**标 `is_incomplete`（语义上那是「暂无数据」不是「列表被截断」；且 Monaco 反正每击键都重查）。

**测试清单**

| # | 用例 | 落点 | 通道 |
|---|---|---|---|
| A1-1 | 索引造 60 个同前缀符号 → `complete_with_meta` 返回 `truncated == true` 且 `candidates.len() == 50` | `completion.rs` 底部 `mod tests`（`:884` 起，沿用现有 TraceIndex fixture 模式） | cargo test |
| A1-2 | 少量候选（≤50）→ `truncated == false` | 同上 | cargo test |
| A1-3 | `to_completion_response`：`truncated=true` → `CompletionResponse::List` 且 `is_incomplete == true`；`sort_text` 仍为 `1000..1049` 连续段（段位契约不破） | `server.rs` 新增 `#[cfg(test)] mod tests`（纯函数，无需构造 tower-lsp `Client`） | cargo test |
| A1-4 | 端到端回归：>50 候选场景继续输入，第 51+ 项可达 | 真机手测（剧本见下）；e2e 浏览器侧无 intel 进程，**不可达**（同 `01-completion-hover-definition.spec.ts:103` 注释的既定结论） | 手测 |

**A1-4 手测剧本**：bench 仓造一个含 60+ 个 `data_*` 键的 dict 字面量并运行一次（让 trace 库有观测）→ 编辑器输入 `data[` → 补全仅 50 条 → 继续输键名前缀 → 断言目标键（按 score 排在 50 名外）出现。

**预算影响**：`completion.rs` 1,672 → ≈ 1,700（上限 1,950 ✓）；`server.rs` ≈ +20 行（未入预算面，按既有口径登记观察即可）。
**门禁**：`cd intel && cargo test`（A1-1/2/3）+ **`cargo build -p opencharm-intel`**（`cargo test` 不刷新 shell 调用的 exe，联调前必须 build）。
**风险与回滚**：响应形状从 Array 变 List——客户端 P0-A2 的 `normalizeCompletionList` 两种形态都兼容，**先合 A1 不会打破旧客户端**（旧客户端 `result?.items ?? []` 对 List 形态同样成立；对 Array 形态走 `Array.isArray`）。回滚 = revert 单文件。

---

### P0-A2　客户端透传 `isIncomplete`（依赖 A1）

**现状定位**

- `client.ts:617-622` `queryCompletion` 只返回 `items`：`return Array.isArray(result) ? result : (result?.items ?? [])`——`isIncomplete` 被丢弃。
- `client.ts:670-673` `Promise.all` 合并 static/intel 两路；`:684` 返回 `{ suggestions }` 无 `incomplete` 字段（Monaco `CompletionList` 原生支持该字段）。

**交互语义**：同 A1——静态引擎（basedpyright 系常标 `isIncomplete: true`）与 intel 截断时，继续输入触发重新请求，候选不被「本地过滤」锁死。

**改动方案**（核心原则：**解析逻辑外迁为纯函数**，client.ts 只做装配）

1. 新建 `shell/src/completion/lspCompletion.ts`（纯模块，零 monaco/tauri 依赖，同 `keywordCompletion.ts` 形态）：

```ts
/** LSP completion 响应归一化：裸数组 / CompletionList / null → 统一形态（P0-A2） */
export interface LspRangeLike { start: { line: number; character: number }; end: { line: number; character: number } }
export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number; // 1 = plain, 2 = snippet
  sortText?: string;
  filterText?: string;
  data?: unknown;
  labelDetails?: { detail?: string; description?: string };
  additionalTextEdits?: Array<{ range: LspRangeLike; newText: string }>;
  preselect?: boolean;        // §8-1（批次 3 接线）
  commitCharacters?: string[]; // P1-B（批次 4 接线）
}
export interface LspCompletionList<T = LspCompletionItem> { items: T[]; isIncomplete: boolean }

export function normalizeCompletionList(result: unknown): LspCompletionList {
  if (Array.isArray(result)) return { items: result, isIncomplete: false };
  const r = result as { items?: unknown; isIncomplete?: unknown } | null | undefined;
  return { items: Array.isArray(r?.items) ? (r.items as LspCompletionItem[]) : [], isIncomplete: r?.isIncomplete === true };
}
```

2. `client.ts`：
   - 删除本地 `LspCompletionItem` 定义（`:30-42`，−13 行），改 `import type { LspCompletionItem, LspCompletionList } from "../completion/lspCompletion";`（结构一致，其余使用点零改动）。
   - `queryCompletion` 返回类型改 `Promise<LspCompletionList>`，函数体一行委托 `normalizeCompletionList(await requestEngine(...))`；引擎未就绪分支返回 `{ items: [], isIncomplete: false }`。
   - `provideCompletionItems`：两路 `.catch()` 兜底值同步改形态；合并 `const incomplete = staticRes.isIncomplete || intelRes.isIncomplete;`，返回 `{ suggestions, incomplete }`。

**测试清单**

| # | 用例 | 落点 |
|---|---|---|
| A2-1 | 裸数组 `[{label:"a"}]` → `{ items: 1 条, isIncomplete: false }` | 新建 `shell/src/__tests__/lspCompletion.test.ts`（vitest 纯函数） |
| A2-2 | `{ items, isIncomplete: true }` → 透传 `true` | 同上 |
| A2-3 | `{ items }`（缺省）/ `null` / `undefined` / `{}` / `items` 非数组 → `isIncomplete: false`、`items: []` 不抛 | 同上 |
| A2-4 | e2e 冒烟：补全面板正常弹出（合并改造无回归） | 沿用 `e2e/lsp/01-completion-hover-definition.spec.ts` 首条用例，免新增 |

**预算影响**：client.ts ≈ +5（−13 类型外迁 + ~18 装配/注释）；新模块 ≈ 50 行（**预算面 +1 项**：`ci/budgets.toml` 增 `completion_lsp_ts_max_lines = 150`，`shell/scripts/budget-check.mjs` 登记，37 → 38 项）。
**风险与回滚**：纯类型面重构 + 一个字段透传，A2-4 冒烟即可兜底；回滚 = revert。

---

### P0-B　过期响应丢弃（+ token 早退）

> 命名订正（评审修订）：本项实际只做**丢弃过期结果**与**token 早退**，**不会**真正取消已在途的 LSP 请求
> （pending 条目仍会等到 `REQUEST_TIMEOUT_MS` 超时才清）。真取消需发 `$/cancelRequest`，不在本项范围，见 §8-3。

**现状定位**

- `client.ts:654` `provideCompletionItems(model, position)` **没接 Monaco 的 `CancellationToken`**，也无请求世代校验。
- 慢引擎（pyrefly 大仓首索引期间）响应迟到时，旧结果可能在新一代输入之后落地，面板闪现错位项。
- `requestEngine` 已有 `nextRequestId`（`:50`）与 `pending` 表（`:57`），但补全路径未利用任何世代机制。

**交互语义（修好后）**：快速连打 `s.` → `sp` → `spl`，面板只反映**最后一次输入**的候选；慢响应静默丢弃，不出现「先显示 `s.` 的旧成员列表再跳变」的闪跳。Esc/移动光标取消面板后，在途响应落地也不复活面板（Monaco 原生行为，本项不破坏）。

**改动方案**（全部在 `client.ts` `registerLspCompletion` 内）

1. **四参签名**——⚠ `token` 是**第 4 个**参数（第 3 个是 `CompletionContext`）。项目内先例：`autoImport.ts:273`
   `provideCompletionItems(model, position, _ctx, token)`。写成第 3 个会把 context 当 token，`token.isCancellationRequested` 恒 `undefined`，取消**静默失效**。
2. 模块级世代号 `let completionGen = 0;`；入口 `const gen = ++completionGen;`（**先取号再 await**，保证 flush 期间的新触发也能作废旧请求）。
3. 三个检查点：入口、flush 后、`Promise.all` 后——任一命中即 `return { suggestions: [] }`：

```ts
async provideCompletionItems(model, position, _context, token) {
  const gen = ++completionGen;
  if (token?.isCancellationRequested) return { suggestions: [] };
  if (engineStatus !== "ready") return { suggestions: [] };
  if (beforeCompletionHook) await beforeCompletionHook(model);
  if (token?.isCancellationRequested || gen !== completionGen) return { suggestions: [] };
  // …… range / params / Promise.all 不变 ……
  if (token?.isCancellationRequested || gen !== completionGen) return { suggestions: [] };
  // …… 组装 suggestions，返回（含 P0-A2 的 incomplete）……
}
```

4. **`resolveCompletionItem` 不加世代守卫**（v2 裁决，替代原文档的「实现时确认」）：Monaco 只对**当前聚焦项**调 resolve，且结果就地写回该 item 对象；过期 resolve 的写回不可见（项已不在面板）。在途请求占 pending 由 15s 超时兜底，代价可忽略。
5. 作用域说明：世代号是 **LSP provider 模块级**，只守 LSP 一路；autoImport/alias/模板/关键字各 provider 互不干扰（它们要么同步返回要么自带 token 检查，见 `autoImport.ts:274`）。

**测试清单**（`client.ts` 不可直接单测——顶层 import `invoke`/monaco/`app`，见 §6 测试通道；行为层走 e2e mock）

| # | 用例 | 落点 |
|---|---|---|
| B-1 | mock 层给 static completion 注入 300ms 延迟（**mock 扩展**：`tauri-mock.js:981-983` 分支读 `window.__E2E_LSP_PRESET__ = { completionDelayMs }`，`emitEvent` 包 `setTimeout`——先例见 `:944-946` 的 `__E2E_CLONE_PRESET__` 模式）。输入 `s.` 触发后立即续打 `pl`，断言：面板最终只含 `split` 族（最新前缀结果），不闪现旧全量列表 | 新建 `shell/e2e/lsp/04-completion-stale.spec.ts` |
| B-2 | 同场景读 `window.__OPENCHARM_LSP_LOG__`（`tauri-mock.js:1011-1013` 已有），断言触发 ≥2 次 completion 请求且面板内容与末次一致 | 同上 |
| B-3 | 手测：大仓库（`bench/large_repo`）内快速连打 + 频繁触发字符，无「旧建议先显示再跳变」错位感；Esc 取消面板后继续打字面板不复活 | 手测剧本 |

**预算影响**：client.ts ≈ +11（世代声明 + 签名 + 3 检查点 + 注释）。
**风险与回滚**：检查点返回空列表是 Monaco 合法响应，不会卡面板；唯一回归风险是「误杀正常响应」——世代号只在进入时自增，无跨调用串扰。回滚 = revert 单函数。

---

### P0-D　insert 后坐标/光标重算的专项测试（测试守护，不一定改逻辑）

**现状定位**

- 接受一个候选可能叠加多处编辑：`additionalTextEdits`（头部插 import）+ 主 `insertText`（光标处）+ 自动括号。Monaco 按序应用，但「头部插入」与「光标插入」叠加时的坐标归位（尤其文件第 1 行补全、插入行与光标行相邻）无测试守护。
- **⚠ 重点路径（评审修订）**：`additionalTextEdits` **只在 `resolveCompletionItem` 里映射**（`client.ts:708-717`）。若用户快速 `Enter`、Monaco 未触发 resolve，import 编辑可能丢失。Monaco 0.52 在 accept 时会先 await 该项 resolve（⚠spike：实测确认超时窗口与失败兜底），本项用测试把这条路径**钉死**。
- 顺手简化点：`resolveCompletionItem` 的映射里 `new monaco.Range(...)`（`:713`）可改返回**普通 IRange 对象**（Monaco `additionalTextEdits` 接受 plain range），映射逻辑即可外迁 `completion/lspCompletion.ts` 变纯函数单测。

**交互语义（守护对象）**：接受 auto-import 类候选后——import 落在正确行（最后一条顶层 import 的下一行 / 模块头之后）、不重复、不错位；补全文本落在光标处；**光标最终停在插入文本之后**（不是行首、不是 import 行）。

**改动/测试方案**

1. **纯函数单测**（fake model 桩，先例 `keywordCompletion.test.ts:8-17` 的最小 model 接口）：
   - `findImportInsertLineForModel`（`autoImport.ts:319`）边界：无 import（落模块头后）、import 在文件末尾、**首行即补全**（insertLine 与光标行相邻，off-by-one 高发区）、多行 docstring 模块头。落点：扩 `shell/src/__tests__/autoImport.test.ts`。
   - `additionalTextEdits` 映射外迁为 `mapAdditionalTextEdits(edits)`（纯，返回 plain range 对象）后单测：单行/跨行/插入行=1 三种。落点：`__tests__/lspCompletion.test.ts`。
2. **e2e 行为层**（mock 扩展：`__E2E_LSP_PRESET__` 增 `completionExtraItems`，向 `lspComplete` 结果注入一条带 `additionalTextEdits` 的候选，如 label `dump_json`、附加编辑在文件头插 `import json\n`）：
   - D-e1：选中该项 `Enter` → 断言编辑器文本含 `import json` 且只出现一次、插入文本在光标处、**光标列 = 插入文本末尾**（`page.evaluate` 读选择区或键入探针字符验证）。
   - D-e2（未 resolve 直接接受）：mock 改造——该候选**初始 items 不带** `additionalTextEdits`、`completionItem/resolve` 时才补（`tauri-mock.js:985` 当前原样透传，需按 label 特判）；快速 `Enter` 不等文档面板展开，断言 import 仍然落地。**若失败即实锤丢编辑 bug**，修复方向：确认 Monaco accept 前 resolve 的实证行为；不可靠则要求引擎侧 upfront 下发（autoImport 已 upfront，`autoImport.ts:306-311`）+ 登记技术债。

**预算影响**：client.ts ≈ −2（映射外迁）；测试文件不计预算；`tauri-mock.js` 不在预算面。
**风险**：纯测试项，唯一代码改动是映射外迁（机械、有单测兜底）。

---

### P0-C　硬选中 / 软选中（selectionMode）联动　✅ 已交付（2026-10-08）

**目标语义**：把「补全是否主动」做成连续光谱——
- **软选中**（自动打字弹出）：显示建议但不抢占输入，继续打字自然收窄列表，`Enter` 永远是换行、不被候选劫持。
- **硬选中**（触发字符 / 显式触发）：首项高亮，可直接 `Enter` 接受。

**定值：`suggest.selectionMode = "whenTriggerCharacter"`**（`main.ts` create 块）。原计划「先 spike 再定值」的流程已走完，**用自动化 e2e 探针取代 DevTools 手测**：临时在 create 块读 `localStorage.oc_spike_sm` 走四取值 × 四场景，机器判定「首项是否预选 / `Enter` 行为」，矩阵取到后**临时代码零残留删除**（探针 spec 亦删除，改为常驻回归 `shell/e2e/lsp/06-completion-selection-mode.spec.ts`）。

#### 实测矩阵（2026-10-08，浏览器层真 Monaco + mock 引擎，25 条断言全绿）

| `selectionMode` | S1 自动打字（autoImport 候选） | S2 触发字符 `s.` | S3 显式 `Alt+/` | S4 模板 `for` |
|---|---|---|---|---|
| 默认（= `always`，`editorOptions.js:2221`） | 硬·接受 | 硬·接受 | 硬·接受 | 硬·展开 |
| `always` | 硬·接受 | 硬·接受 | 硬·接受 | 硬·展开 |
| `never` | 软·换行 | 软·换行 | **硬·接受** | 软·换行 |
| **`whenTriggerCharacter`（选定）** | **软·换行** | **硬·接受** | **硬·接受** | 软·换行 ⚠ |
| `whenQuickSuggestion` | 硬·接受 | 软·换行 | 硬·接受 | 硬·展开 |

三条被矩阵**证实/推翻**的机制事实（`suggestController.js:216-233`，不必再读源码）：

1. **`selectionMode` 只作用于「自动触发」**：`noFocus` 的计算裹在 `if (e.triggerOptions.auto)` 里 → **显式触发（`Alt+/` → `editor.action.triggerSuggest`，`auto=false`）在四取值下恒硬选中**。官方 option 文档同义（"a suggestion is always selected when explicitly invoked"）。
   → **本计划原假设「`whenTriggerCharacter` 下 `Alt+/` 不预选」作废**：选定值**不牺牲显式触发**，S3 的代价不存在。
2. **默认值就是 `always`**（硬选中）→ 改前「快速打字 + 标点误插入」是**存量事实**，本项是净改善。
3. **`whenQuickSuggestion` 与目标相反**（自动打字硬、触发字符软）→ 排除；`never` 会把触发字符也软化 → 排除。

#### S4 代价与补偿（用户 2026-10-08 裁决：模板走特殊处理，不接受「需 ↓+Enter」）

live-template 也走自动打字 → 一并失去预选（`Enter` 换行）。补偿方案 = **把 Tab 让给「聚焦并接受首项」**：

- `keybindingDefaults.ts` 的 `KeybindingMeta` 扩两个可选字段：`softWhen` / `softCommand`——同一键位的**第二条互斥规则**（`when` 要求 `suggestWidgetHasFocusedSuggestion`、`softWhen` 要求其取反，故互不抢键；`softCommand` 直接绑 Monaco 原生命令，不经本项目 handler）。
- `accept_suggestion_replace` 相应调整为：`when: "editorTextFocus && suggestWidgetVisible && suggestWidgetHasFocusedSuggestion"` + `softWhen: "... && !suggestWidgetHasFocusedSuggestion"` / `softCommand: "focusAndAcceptSuggestion"`（该命令的 precondition 恰为「面板可见 && 无聚焦项」，`suggestController.js:833-840`，**现成可用、无需自研**）。
- 效果：**`Enter` = 换行（软选中，零误插入）· `Tab` = 接受首项（软选中）/ 替换模式接受（硬选中）· 面板关闭时 `Tab` 仍是缩进**。
- 为何不新增第二个 `Tab` 键位 id：`validateKeybindingMap`（`keybindings.ts:138`）把重复归一键位判为冲突，两个 id 同为 `Tab` 会让设置面板每次保存都报冲突。故**沿用单一 id + 双互斥规则**。

#### 顺带修正的两处认知（原 P1-A ⚠spike 结论作废）

- **P1-A「本动态规则与 Monaco 内建 `Tab→acceptSelectedSuggestion` 优先级待确认」**：实测**我们的规则确实覆盖内建**（e2e `06` C-6 钉住：有聚焦项时 Tab 走替换接受）。因两者 `when` 互补，谁先匹配都无所谓——但已用 C-6 防回归。
- **「Ctrl+Space 可当显式触发用」不成立**：面板可见且无聚焦项时 `Ctrl+Space` 绑定的是 `focusSuggestion`（weight 190）而非 `triggerSuggest`（weight 100，`suggestController.js:823-831`）。显式触发**只能用 `Alt+/`**（项目 `trigger_suggest` 键位）。探针里第一版用 Ctrl+Space 判 S3 是错的，已改。

#### 落地清单（实际改动）

| 文件 | 改动 |
|---|---|
| `main.ts` create 块 | `suggest: { insertMode: "insert", selectionMode: "whenTriggerCharacter" }`（+11 行注释含矩阵摘要） |
| `keybindingDefaults.ts` | `KeybindingMeta` 增 `softWhen` / `softCommand`；`accept_suggestion_replace` 的 `when` 收紧 + 补软选中分支；label 改「接受建议（Tab）」 |
| `keybindings.ts` | `applyEditorKeybindings` 对有 `softWhen` 的条目多推一条规则 |
| `e2e/lsp/06-completion-selection-mode.spec.ts`（新增） | C-1..C-6 常驻回归：软选中新行 / 触发字符接受 / 显式接受模板 / 软选中 Tab 展开模板 / 面板关闭 Tab 缩进 / 硬选中 Tab 替换接受 |
| `e2e/dx/05-auto-import.spec.ts` | 接受动作 `Enter` → `Tab`（自动打字已软选中的必然回归；同一用例在软/硬两种面板态下 Tab 均可接受） |

**IME 维度未单独立项**：`C-3`（合成期间不劫持 Enter）由 Monaco 自身处理（合成事件期间抑制 suggest），软选中后 Enter 本就恒为换行，风险进一步下降；未做真机输入法实测，如后续有反馈再登记。

**验收结论**：C-1（零误插入 + Enter 换行）✅ · C-2（触发字符硬选中）✅ · C-3（显式触发恒硬选中）✅ · C-4（模板经 Tab 展开）✅ · C-5（面板关闭 Tab 缩进不受影响）✅ · C-6（硬选中替换接受未被抢键）✅。

**预算影响**：`main.ts` +11（2127/2400）；`keybindingDefaults.ts` / `keybindings.ts` 各 +~10（未在单文件预算面）；`lsp/client.ts` 与 `completion/lspCompletion.ts` **零改动**（§8-1 的 `preselect` 映射已在 `63693ff` 完成，本项直接受益）。
**回滚**：删掉 `selectionMode` 一行即回默认硬选中；删掉 `softWhen` / `softCommand` 两字段即回 P1-A 原行为。

---

## 4. P1 批次逐项实施规格（可选增强，逐项裁决）

### P1-A　Enter=插入 / Tab=替换（InsertReplaceEdit 双 range）

**目标语义**：行内已有标识符 `my_list`，光标在词首，输 `enu` 选中 `enumerate`——`Enter`（insert）→ `enumy_list`（保留光标右侧）；`Tab`（replace）→ `enumerate`（整词替换）。这是「Tab 吃掉后面代码」投诉的根源区分。

**现状**：`toMonacoItem`（`client.ts:625-645`）只映射单一 `range`（word 范围），LSP `textEdit`（含 `InsertReplaceEdit` 的 `insert`/`replace` 双 range）**整体未映射**——引擎下发的精确替换范围被丢弃，两键行为无区分。

**改动方案（三部分，Monaco 0.52.2 事实）**

1. **textEdit 映射**（外迁 `completion/lspCompletion.ts` 纯函数 `mapLspTextEdit`，client.ts 装配 +2 行）：
   - `textEdit` 为 `{ range, newText }`（TextEdit）→ `range` 用之、`insertText = newText`（`insertTextFormat: 2` 时保留 snippet 规则）。
   - `textEdit` 为 `{ insert, replace, newText }`（InsertReplaceEdit）→ Monaco `range: { insert, replace }`（Monaco 原生支持双 range 形态）。
   - 无 `textEdit` → 回落现有 word range（现状不变）。
2. **编辑器选项**：create 块 `suggest` 增 `insertMode: "insert"`（= 0.52 默认值，显式写出只为给「alternative = replace」一个稳定基准）。
3. **键位区分**：Monaco suggest 贡献提供命令 `acceptAlternativeSelectedSuggestion`（VS Code 里绑 Shift+Enter；standalone Monaco 命令在、默认键不在，**2026-10-08 已实测可触发**，见 `e2e/lsp/06` C-6）。接线：
   - `keybindingDefaults.ts` 增 id `accept_suggestion_replace`（label 后经 P0-C 改为「接受建议（Tab）」，`def: "Tab"`，`scope: "editor"`）。
   - `keybindings.ts:303` 同款 handler：`app.editor.trigger("keybindings", "acceptAlternativeSelectedSuggestion", null)`。
   - **`KEYBINDING_META` 需扩展可选 `when` 字段**：当前 `applyEditorKeybindings`（`keybindings.ts:344-360`）对所有规则硬写 `when: "editorTextFocus"`（`:357`）；本项必须 `when: "editorTextFocus && suggestWidgetVisible && suggestWidgetHasFocusedSuggestion"`——只在面板可见**且已有聚焦项**时接管 `Tab`，否则吞掉正常缩进。动态规则优先级高于 Monaco 内建 `Tab`→`acceptSelectedSuggestion` 绑定（⚠spike 覆盖关系**已实测结清**：确实覆盖内建，`e2e/lsp/06` C-6 钉住）。软选中（无聚焦项）分支见 §3 P0-C 的 `softWhen`/`softCommand`。
   - 设置面板键位编辑走通用表，无需改 UI。

**验收**：目标语义两键行为可区分；无 `textEdit`/无双 range 的候选两键行为一致（回落 insert range，Monaco 原生兜底）；面板不可见时 `Tab` 缩进不受影响。
**风险**：`Tab` 语义变更涉及肌肉记忆，默认键位若争议可只注册命令不绑键（设置里自助绑）。成本中等 + 与 Monaco 原生 suggest 耦合，**标 P1 可选**。

### P1-B　`commitCharacters`（`.`/`(` 等接受键附加语义）

**目标语义**：用 `(` 接受硬选中项 = 强调用意图——候选插入 + `(` 跟随（Monaco 原生：commit char 追加在插入文本后），配合自动括号即成对。

**现状**：`triggerCharacters` 已含 `.`/`(`/`[`/`,`（`client.ts:653`，触发层面到位）；但 `commitCharacters` 字段未映射（全仓库 `shell/src` 无引用）。

**改动方案**

1. **能力声明（Rust 侧，先查后补）**：`shell/src-tauri/src/lsp.rs` initialize 参数确认/补 `textDocument.completion.completionItem.commitCharactersSupport = true`——pyright 系引擎只在客户端声明支持后才下发 commitCharacters。**⚠spike 已于 2026-10-08 结清（裸会话实测）**：pyrefly 的 completionProvider capability 只有 `{resolveProvider, triggerCharacters}`（无 `commitCharactersSupport`），66 个补全 item **0 个带 `commitCharacters`**；basedpyright 的 capability 只有 `{labelDetailsSupport}`，84 个 item **0 个带 `commitCharacters`**。→ **两个引擎均不下发**，本项对静态引擎零收益，价值只剩 intel/未来引擎（intel 候选 `insertText` 无括号也不受影响）。「默认关」门控因此是**正确且必要**的——开着也无数据可用。
2. **映射**：`toMonacoItem` 增 `commitCharacters: it.commitCharacters`（+1 行；类型已在 P0-A2 外迁模块预留）。
3. **默认关闭、设置可配**（避免误插入）：新增设置 `completion_commit_characters`（默认 `false`）——settings.rs 字段 + settingsPanel 开关 + i18n 三步（`docs/i18n.md`）；映射处按设置门控（关则不下发该字段给 Monaco）。
4. **Edge case**：候选 `insertText` 已含 `(`（如部分引擎对函数候选带括号）时 commit char 会**双括号**——门控默认关 + 文案注明；intel 候选 `insertText` 不含括号（`name=` / 裸名），不受影响。

**验收**：设置开启后，`.`/`(` 接受候选一次完成「插入 + 跟随字符」；关闭后行为与现状一致。**标 P1 可选**。
**spike 结清结论（2026-10-08）**：两个静态引擎都不下发 `commitCharacters`，本项**当前无观察对象**（仅当 intel/未来引擎主动下发时才产生行为差异）。能力声明与映射、设置门控仍保留（成本近零、为未来引擎预埋），默认关不变。

### P1-C　frecency / 邻近度排序

**结论：无需另行实现。** 仅登记结论，不立项。

**依据（评审修订，措辞订正）**：intel 的 `sortText` 本身是**位置索引** `format!("1{:03}", i)`
（`server.rs:343`），并不携带频率值；真正的常用度体现在上游 `complete()` 已按证据强度 `score` 降序排好候选
（`completion.rs` 去重排序段），`sortText` 只是把该顺序固化进 `1xx` 段位。也就是说：频率排序**已经生效**，
无需本地启发式再叠一层，且它的数据来源（运行时观测）比本地启发式更真实。

### P1-D　自动弹出超时兜底

**结论：Recorded，不立项。** Monaco 的 provider 是异步模型，慢引擎返回前不阻塞打字，天然缓解「大仓库卡顿」；显式触发已有 `Alt+/`（`keybindingDefaults.ts:188` `trigger_suggest`）作为兜底通道。批次 1（P0-B）落地后慢引擎的副作用进一步降为「晚到即弃」。若后续真机反馈卡顿，再评估「超时不自动弹、保留手动」的显式阈值。

### P1-E　补全侧的索引/降级提示

> 评审修订新增：§1 原表把这条缺口标为「见 §2.5」，但 §2 当时并无对应小节，等于登记了缺口却没排期。此处补上。

**现状定位（v2 核对，缺口比预想小）**：
- chip 忙碌态接线**已存在**：`main.ts:1718` `setEngineBusy(s === "starting")` + `engineChip.ts:48-54` 渲染「索引中…」。
- 补全在引擎非 ready 时静默返回空（`client.ts:655`），模板/关键字兜底照常——**面板不是空的，只是少了引擎候选**，用户无从区分「没有这个符号」与「引擎没准备好」。

**落地约束**：Monaco 原生 suggest 组件**没有面板内提示位**（同 §5「弹窗内直达设置入口」不可做的原因）；provider 的 `CompletionContext` 只有 `triggerKind/triggerCharacter`，**区分不了显式 `Alt+/` 与自动打字**，故「仅显式触发时提示」在 provider 层不可行。占位伪候选（不可选 label）可被误接受，dirty hack，不做。

**落地（最小化，标 P1 可选）**：
1. 不做面板内任何自绘；验收口径 = **复用 chip**：引擎 starting 期间触发补全，状态栏 chip 显示「索引中…」（与 references/rename 同款），ready 后消失。
2. 唯一可能的代码增量：若实测发现 chip busy 在「补全触发但引擎未 ready」场景下覆盖不到（如引擎 ready 但首次索引中——`engineStatus` 与索引进度是两条线），则按 findUsages 先例（`findUsages.ts:240`）在首次补全请求前后补一对 `setEngineBusy`——**先验证再决定动不动代码**。

**验收**：C-剧本——冷启动大仓，引擎 starting 期间输 `.` 触发补全：面板有模板/关键字兜底、chip 显示「索引中…」；ready 后同位置再触发，引擎候选出现、chip 恢复。

---

## 5. 明确不做（避免过度工程）

| 项 | 理由 |
|---|---|
| ML 排序 / ML 重排 | 无本地模型，收益有限；已有 intel 频率排序替代 |
| ML 结果可见化（星标/箭头） | 依赖 ML；可解释性已由「`⟳ runtime` 来源标签 + sortText 段位」部分覆盖，暂不追加 |
| 弹窗内直达设置入口 / 面板内提示横幅 | Monaco 原生无此能力，自绘成本高，维持不做（P1-E 因此落 chip） |
| 从 stub 复制类型注解（重写方法） | pyrefly 是否支持待确认，边缘场景，不立项 |
| 循环滚动开关 | Monaco 原生行为，暂不干预 |
| 第二级全项目符号搜索混进默认补全 | 已由设计避免（独立 quickOpen 命令），保持现状 |
| 补全占位伪候选（「索引中…」不可选项） | 可被误接受插入脏文本；提示走 chip（见 P1-E） |

---

## 6. 测试通道与 mock 扩展规范（v2 整合原 §4.1）

`shell/src/__tests__/` 里**没有** `lsp/client.ts` 的测试文件，且它顶层 import `@tauri-apps/api/core` 的 `invoke`、
monaco 与 `../state` 的 `app`，**不是可直接单测的纯函数模块**。因此本计划的验收分两类通道，别一律写「补单测」：

| 通道 | 适用 | 位置 / 先例 |
|---|---|---|
| 纯函数单测 | 可剥离的解析/映射逻辑（P0-A2 `normalizeCompletionList`、P0-D `mapAdditionalTextEdits`、P1-A `mapLspTextEdit`） | 外迁 `shell/src/completion/lspCompletion.ts` 后新建 `__tests__/lspCompletion.test.ts`；fake model/provider 桩先例见 `keywordCompletion.test.ts:8-30` |
| cargo 单测 | intel 截断标记与响应封装（P0-A1） | `completion.rs:884` `mod tests` 沿用现有 fixture；`server.rs` 新增 `#[cfg(test)] mod tests` 只测抽出的纯函数（无需 tower-lsp Client） |
| e2e mock 层 | 行为层（过期丢弃、附加编辑落地、双键区分） | `shell/e2e/lsp/`（01 已有 completion 用例可扩；过期丢弃新建 04） |
| 真机/手测 | 体感与性能（软硬选中、大仓连打、IME） | `shell/e2e-real/`；仅 P0 全绿后按需 |

**e2e mock 扩展规范（本计划新增两处，均沿用既有先例）**：

| 扩展 | 形态 | 先例 |
|---|---|---|
| 延迟注入 | `window.__E2E_LSP_PRESET__ = { completionDelayMs: 300 }`，`tauri-mock.js:981` completion 分支 `emitEvent` 包 `setTimeout` | `__E2E_CLONE_PRESET__`（`tauri-mock.js:944-946`，页面侧 `addInitScript` 注入） |
| 夹具候选 | `__E2E_LSP_PRESET__.completionExtraItems = [...]`，`lspComplete` 结果尾部追加（含 `additionalTextEdits` / resolve 才补编辑的特判 label） | 同上 |

诊断通道：`window.__OPENCHARM_LSP_LOG__`（`tauri-mock.js:1011-1013`，环形 60 条）可直接断言请求次数与载荷。

同理，`client.ts` 现有可测邻居只有 `autoImport.test.ts` / `importAlias.test.ts` / `keywordCompletion.test.ts`，
它们之所以能单测，是因为各自是纯逻辑模块——新增测试时优先沿用这个形态。

---

## 7. 门禁、预算与登记

- **门禁**：每次改动后 `cd shell && npm test`（补全相关单测）、`npm run build`（tsc 类型检查）、
  `node shell/scripts/budget-check.mjs`（**评审修订：原写 `scripts\budget-check.mjs`，实际在 `shell/scripts/` 下**）。
  改 `intel` 时另需 `cd intel && cargo test` + **`cargo build -p opencharm-intel`**（`cargo test` 不刷新 shell 调用的 exe）。
- **预算余量（逐项估算，动手前先核）**：

| 文件 | 现值 / 上限 | 批次 1 | 批次 2 | 批次 3 | 批次 4 | **实测落地值**（2026-10-08 `budget-check` 44 项全 PASS） |
|---|---|---|---|---|---|---|
| `lsp/client.ts` | 1,795 / 1,850 | +16（A2+B）−13（类型外迁）≈ **+3** | −2 | +2（8-1 映射） | +7（A+B） | **1,834** ✓ |
| `completion/lspCompletion.ts`（新建） | — / 150（新登记） | ≈ 50 | +15 | +79（P1-A `mapLspTextEdit`） | 0 | **150 / 150**（零余量，后续改动须先拆文件） |
| `intel completion.rs` | 1,672 / 1,950 | ≈ +30 | 0 | 0 | 0 | **1,787** ✓ |
| `intel server.rs` | 未入预算面 | ≈ +20 | 0 | 0 | 0 | **610 / 620**（登记观察，余 10） |
| `main.ts` / `keybinding*.ts` / `settings.rs` 等 | — | 0 | 0 | +11（P0-C，含矩阵注释） | 按需 | `main.ts` **2,127 / 2,400** ✓ |

  新模块登记：`ci/budgets.toml` 增 `completion_lsp_ts_max_lines = 150` + `budget-check.mjs` 同步（**37 → 38 项**，先例：terminalBackpressure 拆分 36 → 37）。
  估增量超标时的纪律不变：把解析/映射逻辑继续拆到 `shell/src/completion/` 下，**不要**申请抬阈值（抬阈值须显式 PR 写理由，见架构铁律）。
- **i18n**：新增用户可见文案（P1-B 设置项、P1-A 键位 label）走 `docs/i18n.md` 三步流程。
- **登记**：交付后更新 `docs/delivery-overview.md` 与 `docs/tech-debt.md`（若有遗留）；新决策走 `docs/adr/`。
- **红线**：不改动 `probe`/`intel` **采集路径**（P0-A1 改的是 LSP 响应封装，不在此列）；不新增常驻进程/依赖；
  补全改动不影响六段合并 sortText 契约（`0xx` `0y` `0z` `1xx` `2xx` `3xx`）；spike 临时代码（如 P0-C 的 localStorage 开关）**合并前必须删除**。

---

## 8. 遗留缺口登记（评审修订新增，v2 更新状态）

以下三项**不属于**本计划的 P0/P1 立项范围本身，但它们分别是 P0-C、P1-B 的**前置能力**或 P0-B 的**语义边界**：

| # | 缺口 | 现状 | v2 处置 |
|---|---|---|---|
| 8-1 | **`preselect` 未映射** | ✅ 已交付（`63693ff`）：`toMonacoItem` 透传 `preselect`（类型字段 P0-A2 已预留） | **已关闭**：P0-C 实测证明 `preselect` 只影响「有聚焦项时选哪项」（`suggestMemory.js`），**不能**让软选中态获得预选——故 P0-C 的补偿走 `Tab`（见 §3 P0-C） |
| 8-2 | **`commitCharacters` 未映射** | ✅ 已交付（`63693ff` = P1-B）：**`toMonacoItem` 已按设置门控映射 `commitCharacters`（`client.ts:663-667`）** + client 声明 `commitCharactersSupport` + 设置 `completion_commit_characters`（默认关） | **已关闭**（2026-10-08 裸会话实测：**pyrefly / basedpyright 均不下发** `commitCharacters`，本项当前无观察对象；映射/声明/门控保留为未来引擎预埋，默认关不变） |
| 8-3 | **真取消未做** | `requestEngine` 的 `pending` 条目只能等 `REQUEST_TIMEOUT_MS`（15s，`client.ts:116`）超时清理，无 `$/cancelRequest` | 维持登记。若未来要做：`requestEngine` 需暴露请求 id（或接受 cancel 回调）以便 `provideCompletionItems` 在新一代触发时发 `$/cancelRequest`；届时单独立项评估（引擎对取消的支持度也要先 spike） |

- **§5 明确不做**（ML 排序、面板内设置入口等）与此表性质不同：§5 是裁决不做，本表是**已排期或尚未裁决的未接线项**。
