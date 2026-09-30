# pyrefly Pydantic 支持完善计划（撤销 basedpyright 推荐）

> 版本：v0.2
> 日期：2026-09-28
> 状态：阶段 1/2/3 已实施（见 §8 实施记录）；阶段 4 待立项
> 关联：`bench/reports/pydantic-engine-probe.md`（F0 实测）、`docs/pycharm_framework_support_report.md` §8.3
> 修订记录：
> - v0.2（2026-09-28）：按评审修订。① 阶段 1 补测试文件清理任务（`__tests__/frameworks.test.ts` 引用待删函数，漏删则 `tsc` 必失败）；② 删除「最小档」选型（`tsconfig.json` 开 `noUnusedLocals`，只删调用不删 import 报 TS6133）；③ 阶段 2 挂点由 `findUsages.ts::renameSymbolAtCursor` / `client.ts::prepareRename` 修正为真实入口 `renameWidget.ts::startSession` / `client.ts::fetchRenameAnchor`，并加会话级去重；④ 阶段 3 补性能数据落盘任务；⑤ 阶段 4 补架构归属论证（铁律边界）、诊断刷新策略（`startEngine` 的 `diagnosticsCache.clear()` 连带清 owner）、开销红线与 Pydantic v2 误报清单；⑥ 消除 §0「顺序不可跳」与 §7「阶段 3 可并行」的矛盾；⑦ 排期按子项拆分。
> - v0.1（2026-09-28）：初稿。

---

## 0. 一页结论

- **撤销「推荐切换到 basedpyright」**：pyrefly 保持为唯一默认静态引擎，不再因检测到 pydantic/fastapi 而推荐 basedpyright。理由见 §1.1 / §1.2（性能实测 + basedpyright 自身缺陷）。
- **完善 pyrefly 分四步**（编号 = 投入产出优先级，**非执行顺序**；执行顺序见本节末行）：
  1. **升级跟踪**（最高杠杆）：跟踪 pyrefly 上游 `dataclass_transform` / 构造参数校验进度，达标即升级回补；
  2. **显式化短板**（低风险兜底）：把 pyrefly 已知缺口（重点是「字段重命名静默漏改」）显式提示，不静默踩坑；
  3. **撤销推荐**（前置关停）：移除现有「切 basedpyright」推荐链路；
  4. **自研 Pydantic 语义层**（中期差异化）：用 OpenCharm 已有 AST + 诊断 owner 分层，自研补齐构造校验与字段改名传播。
- **执行顺序**：阶段 1（撤销推荐）→ 阶段 2（兜底提示）为串行依赖（先撤推荐再上兜底，避免同屏出现矛盾信息：一边说「切 basedpyright」一边说「留在 pyrefly 注意边界」）；阶段 3（探针重跑 / 性能落盘）与 1/2 **可并行**；阶段 4 在 1/2 稳定后**单独立项**（需过 §3.4.0 架构裁决）。

---

## 1. 背景与现状

### 1.1 性能矛盾（本计划的直接动因）

真实项目实测（`cli.py` 13783 行 + `nacos_client.py`）：

| 指标 | basedpyright | pyrefly |
|---|---|---|
| 输入 `time.` 补全 warm avg | **4.7s（全量）/ 1.8s（增量后）** | 1.9s |
| 多窗口 CPU 竞争放大 | 单窗 72ms → 双窗 120ms | 几乎无放大 |

basedpyright 的 Pydantic 正确性优势是用「多窗口秒级卡顿 + 大文件重」换来的，且自身带 alias 双向误报与补全噪声（127 候选）。**产品取舍结论：优先「快」，放弃推荐 basedpyright。**

> ⚠️ 数据落盘缺口（v0.2 补）：上表出自会话复现记录，**尚无报告文件**。这是撤销推荐的全部动因，必须可追溯——已列入阶段 3 任务（§4 阶段 3-3）。

### 1.2 F0 探针结论（`bench/reports/pydantic-engine-probe.md`）

pyrefly 1.3.0 对 Pydantic/dataclass 缺失三项（根因是 PEP 681 `dataclass_transform` 的构造参数校验链未实现）：

1. 传值类型检查（`User(id="str")` 不报类型错）；
2. 缺失必填报错（`User(id=1)` 不报缺 `name`）；
3. **字段改名传播**（rename 只改声明处，调用处 references=0，静默漏改，最危险）。

basedpyright 1.40.1 覆盖 4/6（仅 alias 场景有双向误报，且误报与必填检查同属 `reportCallIssue`，无法配置单独规避——连坐实验见探针报告 §4.1）。

### 1.3 现有推荐链路（要关停的）

- **Rust**：`env_cmds.rs::detect_pydantic_stack`（`env_cmds.rs:1554`）—— 依赖声明含 `pydantic` / `fastapi` 且未关提示 → true。
- **前端**：`main.ts:302` `void maybeSuggestPydanticEngine()` → `pydanticEngineHint.ts` 输出「切换到 basedpyright / 保持 pyrefly」两个链接。
- **判定纯函数**：`frameworks.ts::shouldSuggestPydanticEngine`（`frameworks.ts:54`）、`pydanticEngineHintText`（`frameworks.ts:59`）。
- **测试**：`__tests__/frameworks.test.ts` import 两个函数并有 2 个专测用例（`frameworks.test.ts:67-77`）——**阶段 1 必须一并清理**，否则 `tsc --noEmit` 失败（`tsconfig.json` 的 `include: ["src"]` 覆盖 `__tests__`）。

---

## 2. 目标与范围

### 目标
1. pyrefly 为唯一默认静态引擎，不再有「推荐 basedpyright」的主动提示。
2. pyrefly 下 Pydantic/FastAPI 用户的体验缺口被「显式化 + 逐步自研补齐」，最终做到不比 basedpyright 明显差。

### 明确不做
- 不强制、不静默切引擎（历史原则不变）。
- 不引入第三方 Pydantic 校验库做运行时校验（运行期校验是 Pydantic 自己的职责）。
- 不贡献/改 pyrefly 上游源码（除非后续立项另议）。
- 不移除 basedpyright 引擎本身——用户仍可从状态栏手动切换（`engineChip`），只是不再主动推荐。

---

## 3. 方案设计

### 3.1 阶段 1：撤销推荐（关停）

**目标**：任何依赖含 pydantic/fastapi 的工作区，都不再出现「切 basedpyright」提示。

**选型**（v0.2 修正：原「最小档」不成立——`tsconfig.json` 开 `noUnusedLocals: true`，只删 `main.ts:302` 调用而保留 `main.ts:74` import 会报 TS6133；最小可行 = 调用 + import 同删）：

| 档位 | 改动 | 评估 |
|---|---|---|
| 标准 | `main.ts:301-302`（注释行 + 调用）与 `main.ts:74`（import）同删；`main.ts:329`（reset）/ `2340`（setHandlers）两处引用同删；`__tests__/frameworks.test.ts` 删 2 个 import + 2 个用例（67-77 行） | 最小可行，`tsc` / `vitest` 均通过，但 `pydanticEngineHint.ts` 成死文件 |
| 彻底（推荐） | 标准 + 删除 `pydanticEngineHint.ts` 整文件；删除 `frameworks.ts:49-64`（F0 裁决 B 分节注释 + `shouldSuggestPydanticEngine` + `pydanticEngineHintText`） | 最干净，无死代码；`detect_pydantic_stack` 保留供阶段 4 复用 |

**保留不动**：
- Rust 的 `detect_pydantic_stack` 命令与 `set_framework_hint_disabled`（`framework_hints["pydantic_engine"]`）及 3 条单测（`env_cmds.rs:3840-3866`）——阶段 4 自研语义层复用同一检测口径，`lib.rs:172` 注册无需动。
- 已写入各工作区 config 的 `framework_hints["pydantic_engine"]` 键——历史数据无害（无消费方即恒 false），删除反而要做配置迁移，不值。

**实施步骤**（彻底档，可按序提交）：

1. 删 `shell/src/pydanticEngineHint.ts` 整文件。
2. `shell/src/main.ts`：删 74（import）、301-302（注释 + 调用）、329（`resetPydanticEngineHint()`）、2340（`setPydanticEngineHandlers(...)` 及 2339 注释行）。
3. `shell/src/frameworks.ts`：删 49-64 行（F0 裁决 B 注释块 + 两个函数）。
4. `shell/src/__tests__/frameworks.test.ts`：删 import 列表中 `pydanticEngineHintText` / `shouldSuggestPydanticEngine` 两项，删 67-77 行两个用例。
5. 验证（见 §5 阶段 1）。

### 3.2 阶段 2：显式化短板（兜底）

**目标**：pyrefly 下用户不再「静默」踩坑，尤其字段重命名的静默漏改。

**挂点**（v0.2 修正：原计划的 `findUsages.ts::renameSymbolAtCursor` 只是转调壳、`lsp/client.ts` 无 `prepareRename` 函数；真实链路为 `main.ts` Shift+F6 → `findUsages.ts::renameSymbolAtCursor` → `renameWidget.ts::startRenameAtCursor` → `startSession`，LSP 侧锚定函数是 `client.ts::fetchRenameAnchor`）：

**改动点**：

1. **重命名警告**——挂 `renameWidget.ts::startSession`，在 `fetchRenameAnchor` 成功、`buildWidget()` 之前检测：
   - 新文件 `shell/src/pydanticField.ts`（纯函数，供 `renameWidget` 与阶段 4 复用；不并入 `frameworks.ts`——主题不同，且阶段 4 依赖它）：
     ```ts
     /** 光标 anchor 是否落在 BaseModel 子类的字段声明上（轻量文本启发式，第一版不建 AST） */
     export function isPydanticFieldDecl(lines: string[], line: number, col: number): boolean
     ```
     启发式规则（误报代价低——只多弹一次提示）：
     a. anchor 所在行匹配 `^\s*([A-Za-z_]\w*)\s*:\s*\w`（字段注解形态，允许尾随 `= Field(...)` / `= 默认值`）；
     b. 从该行**向上**找最近的 `class X(...)` 行（遇顶格 `def` / `class` / 最多 200 行停）：类声明匹配 `^\s*class\s+\w+\s*\((.*)\)\s*:` 且基类列表文本含 `BaseModel`（不验证 import 来源——第一版接受误报）。
   - `renameWidget.ts::startSession` 中，`isPydanticFieldDecl` 命中且 `app.settings.lsp_engine !== "basedpyright"` 时 `toast`：`pyrefly 暂不传播 Pydantic 字段的构造调用处引用，重命名可能只改声明处`。
   - **会话级去重**（v0.2 补，对齐项目反馈体系惯例）：每工作区每会话最多提示一次，`Set<string>` 键 = `${root}#pydantic_rename`，与 `pydanticEngineHint.ts` 旧实现同款模式（`hintShown` Set + close 时 reset）。
2. **文档标注**：README「已知边界」一节补：「Pydantic 构造校验以运行时为准；字段重命名暂不传播构造调用处（pyrefly 引擎限制，跟踪上游进展）」。

### 3.3 阶段 3：升级跟踪（pyrefly 上游）

**目标**：用最小成本守住「上游一旦补齐，立刻升级」的通道。

**做法**：
- 定期重跑 `bench/pydantic-probe/probe.cjs`（脚本已存在，产出 `bench/reports/pydantic-probe-{pyrefly,basedpyright}.json`），对比探针 JSON 的 4/6 覆盖项是否变化。
- 重点跟踪 pyrefly 的 `dataclass_transform` / `__init__` 签名校验进度（上游已宣称「Pydantic built-in support」，缺口属版本进度）。
- 当 pyrefly 任一缺失项转绿，升级 pyrefly 版本并重跑探针确认，即可自然回补，无需自研；同时若阶段 2 的 rename 提示、阶段 4 的对应子项已交付，须**同步退役**（避免上游已支持还在提示「不传播」——列入升级验收步骤）。
- **性能数据落盘**（v0.2 新增）：把 §1.1 的会话复现数据（补全 warm avg、双窗放大）整理为 `bench/reports/engine-perf-comparison.md`，含环境（机器/Python/两引擎版本）与复现命令——撤销推荐决策的唯一可追溯依据。

### 3.4 阶段 4：自研 Pydantic 语义层（中期差异化）

**目标**：在 pyrefly 缺的两项（构造校验 + 改名传播）上，用 OpenCharm 自己的 AST 能力补齐。

#### 3.4.0 架构归属裁决（v0.2 新增，立项前置条件）

架构铁律第 2 条：「一切自研组件都是**独立进程或独立包**，不侵入外壳与静态引擎内核」。本阶段代码若放 `fs_cmds.rs` 须先过此裁决：

- **先例**：F1 端点扫描（`fs_cmds.rs::scan_endpoints` / `ep_parse_*`）已按「轻量静态辅助」留在 shell——无独立进程、无后台守护、无持久索引、单次同步扫描即返回。这构成本阶段的归属基准。
- **判定标准**（满足全部四条才可留 shell）：
  1. 解析实现 ≤ 500 行 Rust（约 `scan_endpoints` 量级的 2-3 倍上限）；
  2. 无后台守护进程、无文件监听（file watcher）；
  3. 无持久化索引（产物即用即弃，不落盘）；
  4. 触发方式为「前端显式 invoke 拉取」，被动响应而非主动推送。
- **裁决结论（默认方案）**：
  - **子项 1（构造校验）**：满足四条 → 留 shell（`fs_cmds.rs` 新增 `scan_pydantic_issues`，形态对齐 `scan_endpoints`）。
  - **子项 2（改名传播）**：第一版设计为「rename 时**一次性按需扫描**构造调用点」（无持久索引，见 3.4.3），满足四条 → 留 shell；若实测性能不达标（超 §5 开销红线）需要缓存/持久索引，则**触发拆包**：独立包（如 `pydantic-ref-index`）或并入 opencharm-intel 扩展，重新立项评审。
- 本节结论须写入立项 PR 描述；违反任一条即回到「拆独立包」路径。

#### 3.4.1 架构依托（已具备）

- `diagnosticsCache`（`lsp/client.ts:1628`）是 **owner 分层**的：`normPath → (owner → markers)`，现 owner 有 `opencharm-lsp` / `opencharm-intel`。新增 owner `"opencharm-pydantic"` 即可并存显示，不覆盖 pyrefly 诊断。
- `fs_cmds.rs` 已有 Python 轻量解析先例（`ep_parse_route_decorator` / `ep_parse_router_decl` / `ep_parse_def_name` 等，`fs_cmds.rs:1466-1540`），可扩展为 Pydantic 字段解析；工作区受限扫描先例 `scan_app_decl`（`env_cmds.rs:1309`，深度/数量上限模式）。
- 开关复用 `detect_pydantic_stack`（依赖含 pydantic/fastapi 判定）——非此类工作区零开销。

#### 3.4.2 子项 1：构造参数校验（补「缺失必填 + 传值类型」）

**Rust 侧**（`fs_cmds.rs` 新增，形态对齐 `scan_endpoints`）：
- `pydantic_parse_models(source) → Vec<PydanticModel>`：解析 `class X(BaseModel):` 字段（名 + 类型标注文本 + 是否必填）；支持继承链合并（子类字段 = 自身 + 祖先，同文件内解析；跨文件继承第一版**不支持**，静默跳过并计入 known-limit）。
- `scan_pydantic_issues(workspace_root) → Vec<PydanticIssue>`：受限扫描（复用 `scan_app_decl` 的深度/数量上限模式）收集模型定义 + `X(...)` 构造调用点，校验：未知 kwargs / 缺失必填 / 传值类型（**第一版只做名义等价与字面量推断**：`id="str"` 对 `int` 报、`id=1` 对 `str` 报；复杂表达式静默跳过——宁可漏报不误报）。
- **Pydantic v2 语义红线**（v0.2 补，误报主源，全部按「识别到即跳过该字段校验」处理）：
  - `Optional[str]` 在 v2 是**必填**（无默认值时）——不能按「Optional = 可省」的 v1 直觉判；
  - `Field(default=...)` / `Field(default_factory=...)` → 可省；`Field(alias=...)` → 构造处参数名可能是 alias，**带 alias 的字段跳过校验**（basedpyright 都在此误报，我们第一版直接不碰）；
  - `ConfigDict(populate_by_name=True)` → alias 与字段名双合法，同上跳过；
  - `**kwargs` 展开传参（`X(**data)`）→ 该调用点跳过；
  - 位置参数传字段（`User(1, "a")`）→ 第一版跳过（只校验 kwargs 形态）。
- **类型检查开关**：`app.settings` 增 `pydantic_diagnostics: boolean`（默认 true），关闭即前端不注入该 owner 诊断（误报逃生门，对齐「可关闭 owner」缓解策略）。

**前端侧**（`lsp/client.ts` 或 `main.ts` 接线）：
- 触发：工作区打开时（`detect_pydantic_stack` 命中后）一次全量 + 文件保存后防抖 1.5s 增量（只重扫保存文件 + 引用其模型的文件）。
- 注入：`invoke("scan_pydantic_issues")` 返回 → 逐 path `setMarkers(path, markers, "opencharm-pydantic")`。
- **诊断刷新策略**（v0.2 补，关键坑）：`client.ts::startEngine` 里 `diagnosticsCache.clear()`（`client.ts:309`）会**连带清掉 `opencharm-pydantic` owner**。修复：`clear()` 改为 owner 感知——跳过 `opencharm-pydantic`（语义正确：pydantic 诊断不属于任何静态引擎，引擎切换不应使其实效）；同时引擎就绪（`engineStatus === "ready"`）后对已打开 model 重放一次缓存诊断（复用 `applyCachedDiagnostics` 现有机制即可，无需新协议）。
- 打开文件回放：`applyCachedDiagnostics` 已按 owner 遍历回放，天然兼容，无需改。

#### 3.4.3 子项 2：字段改名传播（补最危险的「静默漏改」）

**设计**（v0.2 细化）：第一版**无持久索引**，rename 时一次性按需扫描（过 3.4.0 裁决的前提）：

1. `renameWidget.ts` 确认改名时（`confirmRename` → `fetchRenameChanges` 之后）：若 anchor 命中 `isPydanticFieldDecl`（阶段 2 已交付）且模型类名可解析（同一启发式向上找 `class X(BaseModel)`），追加调用：
   `invoke("scan_pydantic_ctor_refs", { workspaceRoot, model, field }) → Vec<CtorRef { path, line, col, len }>`——受限扫描找 `Model(field=` / `Model(field =` 文本级调用点（`Model` 名与左括号间允许空白，`field` 后必须紧跟 `=`，避免命中同前缀字段）。
2. **合并与去重**：把 `CtorRef` 转为 Monaco edits，与 `fetchRenameChanges` 返回的 `files: RenameFileEdits[]` 按 `path` 分组合并；**同位置去重**（key = `normPath + startLine + startCol`，pyrefly 已覆盖的编辑优先，AST 补充编辑仅在 key 不存在时加入）——这是「与引擎 references 重复/冲突」风险的落地缓解。
3. 合并后走 `renameWidget` 现有 `summarizeRenameTargets` diff 预览与 `applyRenameChanges` 写回（「已打开 model / 未打开字符串层」两路写回天然复用，无需新通道）。
4. **开关与降级**：`pydantic_diagnostics` 设置同时管本子项；`scan_pydantic_ctor_refs` 超时（> 2s）即放弃补充、只按引擎结果改（toast 不打扰——rename 本身已有 diff 预览兜底）。

> 复杂度提示：若按需扫描实测超时（大工作区 > 2s 频繁触发），说明需要索引 → 触发 3.4.0 的拆包条款，**不得**就地加缓存。子项 2 依赖阶段 2 的 `pydanticField.ts`，须在其后实施。

---

## 4. 任务清单（逐项可执行）

### 阶段 1（撤销推荐）— 0.5 人日
- [ ] 删除 `shell/src/pydanticEngineHint.ts` 整文件。
- [ ] `shell/src/main.ts`：删 74 / 301-302 / 329 / 2339-2340 五处引用（import、注释+调用、reset、注释+setHandlers）。
- [ ] `shell/src/frameworks.ts`：删 49-64 行（F0 裁决 B 分节注释 + `shouldSuggestPydanticEngine` + `pydanticEngineHintText`）。
- [ ] `shell/src/__tests__/frameworks.test.ts`：删 import 两项 + 67-77 行两个用例。
- [ ] 验证：`npm run build`（含 `tsc --noEmit`）零错误；`npm test`（vitest）全绿；`cargo test` 不回归（Rust 未动，防误伤）；确认 `detect_pydantic_stack` / `set_framework_hint_disabled` / `is_framework_hint_disabled` 及其注册（`lib.rs:169-172`）保留。

### 阶段 2（显式化短板）— 1 人日
- [ ] 新增 `shell/src/pydanticField.ts`：`isPydanticFieldDecl`（含 `lines` / 行列参数与启发式规则 a/b，注释写明「文本启发式，误报代价 = 多一次提示」）+ 单测（`__tests__/pydanticField.test.ts`：命中注解字段 / 命中带默认值字段 / 普通类字段不命中 / 顶格 def 截断向上搜索）。
- [ ] `renameWidget.ts::startSession`：anchor 成功后检测，命中且引擎非 basedpyright → toast 提示；`Set<string>` 会话去重（键 `${root}#pydantic_rename`，close 工作区时 reset，挂 `main.ts` 现有 reset 点旁）。
- [ ] 文档：README「已知边界」补 Pydantic 校验边界两条（构造校验以运行时为准 / 字段重命名不传播调用处）。

### 阶段 3（升级跟踪 + 性能落盘）— 1 人日（可与阶段 1/2 并行）
- [ ] 重跑 `bench/pydantic-probe/probe.cjs`，记录当前 pyrefly 版本的 4/6 覆盖基线（写入探针报告 §4.1 追记）。
- [ ] 新增 `bench/reports/engine-perf-comparison.md`：落盘 §1.1 性能数据（环境、命令、原始数字），作为撤销推荐的追溯依据。
- [ ] 建立「升级 pyrefly → 重跑探针 → 缺失项转绿则退役对应自研/提示」验收 checklist（写入本文件 §5 追记区）。

### 阶段 4（自研语义层）— 单独立项，过 3.4.0 裁决后启动
- [ ] 立项 PR：附架构归属裁决结论（四条标准逐条对照）+ 本节规模预估。
- [ ] 子项 1a（Rust）：`pydantic_parse_models` + `scan_pydantic_issues` + v2 语义跳过清单（3.4.2 五条）+ 单测（继承合并 / alias 跳过 / Optional 必填 / `**kwargs` 跳过）。
- [ ] 子项 1b（前端）：`pydantic_diagnostics` 设置项 + 保存防抖增量触发 + `opencharm-pydantic` owner 注入。
- [ ] 子项 1c：`diagnosticsCache.clear()` 改 owner 感知（跳过 `opencharm-pydantic`）+ 引擎就绪后重放。
- [ ] 子项 2a（Rust）：`scan_pydantic_ctor_refs`（按需扫描，无索引）+ 单测（`Model(field=` 命中 / 同前缀字段不命中 / 跨行空白）。
- [ ] 子项 2b（前端）：`confirmRename` 追加补充 refs + 按 `path + 位置` 去重合并 + 超时 2s 降级。
- [ ] 验收：见 §5 阶段 4（含开销红线与引擎切换诊断不丢）。

---

## 5. 验收标准

### 阶段 1
- `npm run build`（含 `tsc`）零错误；`npm test` 全绿；`cargo test` 不回归。
- 打开一个**未关闭过提示**（config 无 `framework_hints["pydantic_engine"]`）且依赖含 pydantic/fastapi 的工作区，输出面板不再出现「切换到 basedpyright」提示。
- 全局搜索 `pydanticEngineHint|maybeSuggestPydanticEngine|shouldSuggestPydanticEngine` 仅剩本计划文档与 bench 报告中的历史记述，无代码命中。

### 阶段 2
- pyrefly 引擎下 rename 一个 `BaseModel` 字段：出现「不传播调用处引用」提示；**同会话同工作区第二次 rename 不再弹**；basedpyright 引擎下不弹。
- 非 Pydantic 类（普通 class / `@dataclass`）字段 rename 不弹（启发式不误报）。
- README 可查边界说明。

### 阶段 3
- `bench/pydantic-probe/probe.cjs` 重跑结论与基线一致（pyrefly 版本未变时）。
- `bench/reports/engine-perf-comparison.md` 存在且含复现命令。
- 若 pyrefly 新版达标：升级后探针对应项转绿，且阶段 2 提示 / 阶段 4 对应子项已按 checklist 退役。

#### 升级 pyrefly 验收 checklist（每次升级必跑）

1. `pyrefly --version` 确认新版本号；`node bench\pydantic-probe\probe.cjs pyrefly` 重跑。
2. 对照 `bench/reports/pydantic-engine-probe.md` §4.2 基线表，逐项检查 4 个缺失项是否转绿：
   - [ ] 传值类型检查（`usage.py` 出现类型诊断）
   - [ ] 缺失必填报错（`usage.py` 出现缺参诊断）
   - [ ] 字段改名传播（`stableReferences` > 0 且 rename 覆盖 `usage.py`）
   - [ ] （对照项不回归）alias / validators 零误报、补全 3 候选、hover 正常
3. 任一缺失项转绿 → 按对应关系退役自研/提示：
   - 类型/必填转绿 → 退役阶段 4 子项 1（构造校验）对应部分；`pydantic_diagnostics` 若已交付则置为默认关闭；
   - 改名传播转绿 → 删除 `renameWidget.ts::warnPydanticFieldRename` 及 `pydanticField.ts`（保留单测反转用例），README「已知边界」对应条目移除。
4. 全部转绿 → 本计划关闭；探针报告 §4.2 基线表更新为新版本。
5. 未转绿 → 仅更新 §4.2 的版本号与日期，结论不变。

### 阶段 4
- 子项 1：`usage.py` 类用例（`User(id="str")` 类型错 / `User(id=1)` 缺必填）在 pyrefly 下产生 `opencharm-pydantic` owner 的红线，且不与 pyrefly 诊断冲突；alias / `**kwargs` / 位置参数用例**零误报**。
- 子项 2：rename Pydantic 字段时，`Model(field=)` 构造调用处一并被改，`references` 计数覆盖声明处 + 调用处；`summarizeRenameTargets` 预览中可见补充的调用点文件。
- **诊断不丢**：pyrefly → basedpyright → pyrefly 切换引擎后，`opencharm-pydantic` 诊断仍在（不被 `startEngine` 的 clear 清掉）。
- **开销红线**（初值，验收时按真实工作区校准后固化进本表）：受控用例（`bench/sample/pydantic_models/`）全量扫描 < 500ms；≤ 2000 个 .py 文件的工作区全量 < 3s；单文件保存增量 < 100ms；`scan_pydantic_ctor_refs` 单次 < 2s（超时降级路径可用）；非 Pydantic 栈工作区零扫描零诊断。

---

## 6. 风险与回滚

| 风险 | 等级 | 缓解 |
|---|---|---|
| pyrefly 上游长期不补 `dataclass_transform` | 中 | 阶段 3 持续跟踪；阶段 4 自研兜底，不依赖上游 |
| 阶段 4 自研解析误报（Pydantic v2 语义） | 中→低 | 3.4.2 五条跳过清单（alias/Optional/`**kwargs`/位置参数/跨文件继承一律不碰）+ `pydantic_diagnostics` 设置总开关；误报不影响 pyrefly 主诊断（owner 隔离） |
| 阶段 4 改名传播与引擎 references 重复/冲突 | 中 | `path + 位置` key 去重，pyrefly 覆盖优先；超时 2s 降级为纯引擎结果 |
| 阶段 4 膨胀触发铁律（外壳长静态语义组件） | 中 | 3.4.0 四条判定标准为硬闸：违反任一（代码量 / 守护进程 / 持久索引 / 推送式触发）即拆独立包重评 |
| 引擎切换清掉 pydantic 诊断 | 高（若漏做） | 3.4.2 子项 1c 明确改 owner 感知 clear；验收含「三段切换诊断不丢」用例 |
| 撤销推荐后 FastAPI「无红线」体验缺口 | 中 | 阶段 2 显式化提示过渡；阶段 4 自研校验补齐 |
| 升级 pyrefly 后自研能力与上游重复 | 低 | 阶段 3 升级 checklist 含「退役对应自研/提示」步骤 |

**回滚**（v0.2 补全）：
- 阶段 1：纯删除，还原点 = `pydanticEngineHint.ts` + `main.ts` 五处 + `frameworks.ts` 函数块 + 测试两用例（git revert 单 PR 即可，Rust/存储未动）。
- 阶段 2：`pydanticField.ts` 与 toast 均独立新增，回滚 = 还原 PR；README 边界说明可保留（陈述的事实不因回滚失效）。
- 阶段 4：`pydantic_diagnostics` 设置总开关 = 一键停用全部自研诊断与传播补充；`diagnosticsCache` 的 owner 感知 clear 无行为回滚需求（对存量 owner 是纯增益）。
- 各阶段独立 PR，互不阻塞。

---

## 7. 排期总表

| 阶段 | 内容 | 预估 | 依赖 |
|---|---|---|---|
| 1 | 撤销推荐（纯前端删除，含测试清理） | 0.5 人日 | 无 |
| 2 | 显式化短板（`pydanticField.ts` + rename 提示 + 文档） | 1 人日 | 阶段 1 合并后（避免同屏矛盾信息） |
| 3 | 升级跟踪（探针重跑）+ 性能数据落盘 | 1 人日 | 无（可与 1/2 并行） |
| 4a | 子项 1：构造校验（Rust 解析 + owner 注入 + 刷新策略） | 2-3 人日 | 立项过 3.4.0 裁决；阶段 2 交付（复用 `pydanticField.ts` 语义） |
| 4b | 子项 2：改名传播（按需扫描 + 去重合并 + 超时降级） | 3-5 人日 | 4a + 阶段 2（`isPydanticFieldDecl`）；若超红线触发拆包另计 |

> 阶段 1/2/3 可立即启动；阶段 4（4a/4b）在 1/2 稳定后单独立项，立项 PR 必附 §3.4.0 裁决结论。

---

## 8. 实施记录

### 阶段 1：撤销推荐（2026-09-28 已实施）

- 删除 `shell/src/pydanticEngineHint.ts` 整文件；`main.ts` 清理 import / 调用 / reset / setHandlers 四处（连带清掉因删除而悬空的 `switchEngineTo` import）；`frameworks.ts` 删除 F0 裁决 B 函数块；`__tests__/frameworks.test.ts` 删除 2 个 import + 2 个用例。
- 保留：Rust `detect_pydantic_stack` / `set_framework_hint_disabled` / `is_framework_hint_disabled` 及注册（阶段 4 复用）。
- 验证：`tsc --noEmit` 零错误；vitest 76 文件 773 用例全绿（删 2 用例后）；`cargo test` 234 通过不回归；全局搜索无残留引用。

### 阶段 2：显式化短板（2026-09-28 已实施）

- 新增 `shell/src/pydanticField.ts`（`isPydanticFieldDecl` 文本启发式纯函数）+ `__tests__/pydanticField.test.ts`（7 用例：命中 / 普通类不命中 / 顶格 def 截断 / 缩进 def 不截断 / 多基类 / 越界）。
- `renameWidget.ts::startSession` 挂 `warnPydanticFieldRename`：anchor 成功后、`buildWidget()` 前检测；**去重置位在命中判定之后**（普通符号 rename 不消耗唯一提示机会——实施时修正的设计细节）；引擎为 basedpyright 时不提示。
- `main.ts::closeWorkspace` 接线 `resetPydanticRenameWarn()`（工作区级去重清空）。
- README 新增「已知边界」一节（构造校验以运行时为准 / 字段重命名不传播调用处，含文档链接）。

### 阶段 3：升级跟踪 + 性能落盘（2026-09-28 已实施）

- 重建受控探针环境（venv Python 3.11.15 + pydantic 2.13.5），重跑两引擎探针：**pyrefly 1.3.1 与 1.3.0 结论完全一致**（零构造诊断 / rename references=0），基线写入探针报告 §4.2；basedpyright 结论不变（references=3）。
- 新增 `bench/reports/engine-perf-comparison.md`（§1.1 性能数据 + 复现方法 + 决策结论）。
- 本文件 §5 增补「升级 pyrefly 验收 checklist」（含自研/提示退役的对应关系）。

### 阶段 4：自研 Pydantic 语义层（2026-09-28 已实施）

**架构裁决（§3.4.0 四条对照，全部满足）**：① 解析实现 ~430 行 Rust（含测试串独立统计，主逻辑低于 500 上限）；② 零守护进程零 watcher；③ 零持久索引（rename 时按需文本扫描）；④ 纯前端 invoke 拉取（`scan_endpoints` 同款）。两子项均留 shell（`fs_cmds.rs`），未触发拆包。

- **子项 1a（Rust）**：`pyd_parse_file`（类/字段轻量解析，缩进判类体边界）+ `pyd_class_is_model`（同文件继承链 memo 判定）+ `pyd_resolve_fields`（继承合并、同名覆盖、depth 防环）+ `scan_pydantic_issues`（kwargs 提取 → unknown/type/missing 三类）。v2 红线全落地：alias 字段按别名放行且类型检查跳过、`**` 整行跳过、位置参数整点跳过、字面量类型只做名义等价（复杂表达式跳过）、`find_call_head` 引号状态机排除字符串内误命中。
- **子项 2a（Rust）**：`scan_pydantic_ctor_refs(root, model, field)`——`Model(field=` 文本级定位，空白容忍、同前缀字段不误命中。
- **子项 1b（前端）**：新域模块 `pydanticDiagnostics.ts`（owner `opencharm-pydantic` 第四桶，`ruffLint.ts` 同款 handlers 注入形态）；触发 = 工作区打开（`detect_pydantic_stack` 门控）+ 保存防抖 1.5s；`pydantic_diagnostics` 设置项（默认开，TS/Rust 双侧 + 设置面板 UI 行）；消失文件显式清空防残留。
- **子项 1c**：`client.ts` 的 `diagnosticsCache.clear()` 改 owner 感知 `clearEngineDiagnostics()`（只清 `opencharm-lsp`）；新增 `replayPersistentDiagnostics`，main 在 `onEngineStatus("ready")` 时对已打开 tab 重放自研桶。
- **子项 2b（前端）**：`renameWidget.ts::confirmRename` 在 `fetchRenameChanges` 后调 `supplementPydanticCtorRefs`（pyrefly 引擎 + `isPydanticFieldDecl` 命中 + 设置开三重门控）；`mergeCtorRefsIntoFiles` 纯函数做 normPath+行+列去重合并（引擎优先）；2s 超时降级为纯引擎结果；basedpyright 引擎下不走补充（其自身传播）。

**测试与验收**：
- Rust 单测 7 项全绿：受控语义用例（4 诊断：type×2 + 继承必填缺失×2）、v2 跳过规则（alias/`**`/位置参数/空参数判缺失）、防误报（非模型类/`def Model(`/字符串字面量）、ctor_refs 语义（命中 3 处 + 列号精确）。
- TS 单测 5 项全绿：合并去重（引擎优先/新文件分组/路径归一/空与全重复）+ 摘要回归。
- **开销红线实测**（release，受控项目 `bench/sample/pydantic_models`）：全量扫描 **~6ms**（红线 500ms，80 倍余量）；单测内 `pyd_bench_scan_issues`（ignored，手动 `cargo test --release pyd_bench -- --ignored --nocapture`）。
- 全量回归：vitest 78 文件 785 用例、cargo 238 通过、tsc/build 零错误。
- 已知边界（文本级解析，登记不修）：跨文件继承链不合并（`class B(A)` 的 A 在别文件时 B 不认为模型）；多行构造调用（`User(
  id=1)`）跳过；f-string 内调用形态不解析。升级 checklist（§5）转绿后全部退役。

### E2E 验收（2026-09-29，Playwright）

新增 `shell/e2e/p4/pydantic.spec.ts`（8 用例，**8/8 通过**），对齐 §5 阶段 4 验收标准：

| # | 用例 | 验证点 |
|---|---|---|
| 01 | Pydantic 栈 → type/missing 渲染 | 子项 1b：第四桶红线 + DOM squiggly（2 处） |
| 02 | 非 Pydantic 栈 → 零诊断 | `detect_pydantic_stack` 门控（预置存在也不注入） |
| 03 | 保存后防抖重扫 | 预置清空 → Ctrl+S → marker 清空（1.5s 防抖） |
| 04 | 设置面板关闭 → 即时清空 | PR-2 修复项：`refreshPydanticDiagnostics`（设置 UI 路径） |
| 05 | 引擎切换不丢第四桶 | 子项 1c：pyrefly→basedpyright→pyrefly 三段后 marker 仍在 |
| 06 | rename `User.name` 传播 | 子项 2b：mock 复刻 pyrefly 缺陷（`__E2E_RENAME_SCOPE__="single"` 只改声明文件），补充路径把 `usage.py` 两处 `name=` 一并改落盘（跨文件确认摘要含 `usage.py × 2 处`） |
| 07 | rename 字段 toast | 阶段 2 提示（「暂不传播」） |
| 08 | rename 类名不触发补充 | 防误触边界（`isPydanticFieldDecl` 不命中 → 单文件语义） |

**E2E 又抓到一个真 bug（单测与 Rust 测试均盲区）**：首次扫描完成时若文件未打开，`setMarkers` 找不到 tab 被静默丢弃且无缓存——**打开文件后 marker 永远不出现**（LSP 桶有 `diagnosticsCache` 回放而第四桶没有）。修复：`pydanticDiagnostics` 自建 `cachedMarkers`（normKey → markers），新增 `applyPydanticMarkersOnOpen` 挂 `main.openFile`（与 `lsp.applyCachedDiagnostics` 对称）。

配套改动：mock 补 `scan_pydantic_issues` / `scan_pydantic_ctor_refs`（`__E2E_PYDANTIC_PRESET__` 预置面）+ `lspRename` 的 single-file 模式（复刻 pyrefly Pydantic 字段缺陷行为）；`ux/02-frameworks.spec.ts` FW-1/FW-3 退役为阶段 1 撤销推荐后的新行为断言（推荐链路已删，spec 过时）。

回归：frameworks 6/6、autosave 7/7、lsp 19/19（rename 链路含跨文件确认语义全绿）、vitest 789 全绿、tsc 零错误。

### 复核修复（2026-09-29）

实施次日全量走查发现并修复 **4 个正确性 bug + 3 个覆盖缺口**：

| # | 问题 | 严重度 | 修复 |
|---|---|---|---|
| 1 | 列号字节/字符混算：`extract_call_kwargs` 的 base 按字节偏移直加，行内含中文时 marker 错位、**rename 编辑落点会写坏代码** | P0 | 列号改按字符计（`byte_to_char_idx`） |
| 2 | 嵌套调用错位：整行取首个 `(` 提参，`wrap(User(id=1), extra=2)` 会把 `extra` 误计入 User | P0 | `extract_call_kwargs(line, open_byte)` 支持指定调用括号偏移 |
| 3 | Windows 路径失配：Rust 返回正斜杠、tab.path 反斜杠，`setMarkers` 精确 `===` 匹配 → **诊断全程挂不上** | P0 | `main.ts::setMarkers` 改 `samePath` |
| 4 | TS 侧 `pydanticModelNameOf` 只认「直接继承 BaseModel」，子类自有字段 rename 不补充；且返回了链头而非起点类 | P1 | 重写为沿继承链向上、返回起点类；无括号普通类作边界 |
| 5 | 注释未剥离：注释里的 `User(name=)` 误命中；`class A(BaseModel):  # x(y)` 解析受污染 | P1 | `pyd_strip_comment`（引号状态机）统一应用于类解析/字段解析/双扫描 |
| 6 | 子类调用点不传播：rename `User.name` 时 `Admin(name=)` 不被改 | P1 | Rust `scan_pydantic_ctor_refs` 经 `model_inherits_from`（BFS 全链）收子类调用点 |
| 7 | 设置开关切换不即时生效（要等下次保存）；关闭后旧 marker 残留 | P2 | `refreshPydanticDiagnostics`（开→立扫 / 关→清空）挂设置保存路径；`rescanAll` 头部关闭守卫 |

补充回归测试：Rust `pydantic_review_fixes`（中文字符列号精确断言 21/嵌套调用零误报/注释剥离）+ `pydantic_ctor_refs_subclass`（子类双向传播）；TS `pydanticModelNameOf` 4 用例（基类/子类/普通类/越界）。

复核后全量：cargo 240 通过（+2 ignored 基准）、vitest 789 通过、tsc/build 零错误；红线复测 ~6-7ms（受控项目，子类 BFS 无明显开销）。

**复核经验**：初版测试全部 ASCII 场景（字节列=字符列假象）、全部直调形态（无嵌套），正确性 bug 全部落在测试盲区。文本级解析的测试用例必须含**非 ASCII + 嵌套 + 注释**三类对抗样本。

### 遗留（阶段 4，待单独立项）

- ~~子项 1（构造校验）/ 子项 2（改名传播）未启动~~ → 已于 2026-09-28 实施完毕（见上）。
