# Montauri Live Templates 上下文位置轴修订稿

> 版本：v1.1 · 日期：2026-08-25 · 状态：已实现（相位 A/B 落地，实现注记见 §8/§9；相位 C 为可选项，待 LSP AST 成熟再评估）
> 上游文档：live templates 重构方案 v1.0（M1-M4 已交付，文档已归档）
> 本文档修订：重构方案 v1.0 的 §5.1（Schema）、§6（作用域/上下文系统）、§9.2（补全路径）、§9.1（Tab 展开）、§10（管理 UI）、§5.4（PyCharm 导入）
> 冲突裁决：本文档版本号高于 v1.0，冲突处以本文档为准（符合「新旧版本文档冲突时以版本号更高者为准」约定）。

## 0. 修订动因与结论

**症状**：定义 `main` 函数时（键入 `def main|(`），补全弹窗仍提示 `if __name__ == '__main__'` 模板。

**根因**：v1.0 上下文模型只有「**容器轴**」（`module`/`class`/`function`，即「我嵌套在哪」），没有「**位置轴**」（「光标此刻在补什么」）。`builtin.main` 的 `scopes` 虽已收窄到 `python:module`（2026-08-24 反馈后修正），但在 module 层内「函数名位置」与「顶层语句位置」在模型里是同一个状态，无法区分。

**旁证**：`pycharmImport.ts` 导入时把 PyCharm 的 `<context>` 整段丢弃（`scopes: [...PY_SCOPES]` 硬编码），说明对标 PyCharm 的核心机制——「适用环境（Applicable Contexts）」——从未被建模。

**结论**：对齐 PyCharm 的 ContextType 机制，引入「位置轴」，模板声明「适用环境谓词」，判定层独立、可替换。**不是给 `main` 打补丁，而是补上缺失的一根轴**，同类问题（`def`/`class`/`if`/`for` 等一切结构模板撞名）一次全灭。

### 0.1 产品裁决（2026-08-25 拍板，2026-08-26 复核）

- **拍板 A**：缺省适用位置 = `statement + expression`（排除 `name`）。结构模板在 `def`/`class` 名字位、表达式位上不再误触发。
- **接受 B 边界**：「普通标识符（`main_xxx`、赋值左值、形参名）在语句位仍可能前缀匹配缩写」为已知边界；`variableName` / `parameter` 位置类型列为非目标，后续按需再评估。
- **内置缩写分工（2026-08-26 复核）**：位置轴落地后 `ifmain` 承担 `__main__` 守卫，`main` 改为「main 函数定义」模板——二者均为语句位，名字位/表达式位不误触发。

## 1. 目标模型：三维上下文

改造后上下文为三维正交，替代 v1.0 的单维 `ScopeInfo`：

| 维 | 取值 | 职责 |
|---|---|---|
| 容器 `container` | `module` / `class` / `function` | 我在哪（嵌套层级）——沿用现有 `scopes` 语义 |
| 位置 `position` | `statement` / `expression` / `name` | 我在补什么——**本次新增** |
| 词法 `lexical` | `code` / `string` / `comment` | 字符串/注释内——沿用 `lexicalEnvAt` |

产物类型：

```
SyntaxContext { container, position, lexical, className, methodName }
```

### 1.1 位置轴枚举（PositionKind）

| 值 | 含义 | 判定线索 |
|---|---|---|
| `statement` | 语句边界（可开始新语句处，含模块顶层） | 光标列左侧仅空白，且上一非空行为完整语句（跨行括号深度 0，行末非续行符；块头 `:` 结尾视为完整语句，故块体首行是 statement——见 §8.2） |
| `expression` | 表达式位置（`=`/`return`/`,`/`(`/`[`/`{` 之后、实参、下标等） | 落在未闭合括号内，或紧跟表达式引入符之后 |
| `name` | 定义名位置（`def`/`class` 头部名字 token 内） | 当前行形如 `^\s*(async\s+)?def\s+\w*` / `^\s*class\s+\w*` 且光标列落在名字 token 内 |

> 说明：PyCharm 采用「扁平 ContextType 集」（其中「顶层语句」同时编码了「module 容器 + 语句位」）。本项目已有独立容器轴（`scopes`），故无需引入冗余的扁平类型——「顶层语句」＝ `container=module × position=statement`，天然覆盖。`parameter`（形参名位）、`variableName`（赋值左值位）等更细位置后续作为同一轴的增量类型扩展，v1.1 先不引入（YAGNI）。

## 2. Schema 修订（§5.1）

`TemplateDef` 新增字段：

```
positions?: PositionKind[]   // 缺省 ["statement", "expression"]
```

- **有效适用** = `scopes`（容器）× `positions`（位置）；词法维仍由 `allowInStrings` / `allowInComments` 控制（不变）。
- **缺省 `["statement", "expression"]` = 排除 `name`**：任何模板都不在「起名」时触发。这是把「`main` 特例」升级为「通杀规则」的关键——只需新增位置轴，所有结构模板自动在名字位被抑制。
- 结构模板（`def`/`class`/`if`/`for`/`while`/`try`/`with`/`async` 系列）显式 `positions: ["statement"]`。
- `main`：`scopes: ["python:module"]`（不变）+ `positions: ["statement"]`。
- `super`/`print`/`lambda` 等保持缺省（statement + expression）。

JSON 示例：

```jsonc
{
  "id": "builtin.main",
  "abbreviation": "main",
  "description": "if __name__ == '__main__'",
  "body": "if __name__ == \"__main__\":\n    $END$",
  "scopes": ["python:module"],
  "positions": ["statement"],          // 新增：仅语句位，排除函数名位
  "kind": "normal",
  "tabExpand": true
}
```

### 2.1 兼容迁移

- v2 旧配置无 `positions` → 取缺省（statement + expression）：除「名字位不再误触发」这一预期改进外，行为等价，无破坏。
- v1 → v2 迁移（`migrateV1`）产出的 `TemplateDef` 不设 `positions` → 同样走缺省。

## 3. 判定器 PositionClassifier（§6.2 修订）

新增模块 `context.ts`，统一 v1.0 的「容器判定」+「位置判定」，对外收敛为单一接口：

```
classify(model, position, symbols) -> SyntaxContext
```

判定顺序：

1. **词法**：`lexicalEnvAt`（复用，非 code → 直接采样词法维）。
2. **容器**：documentSymbol（`SymbolIndex` 缓存，主）→ 缩进启发式（`resolveScope`，兜底）——即 v1.0 现有逻辑原样保留。
3. **位置**：按 §1.1 判定线索；其中「跨行括号平衡」是 v1.0 缺失的关键——从符号 `startLine`（或文件头）向前扫描、维护括号栈，判断是否落在未闭合括号内、上一非空行是否为完整语句。

工程要求：

- **纯函数 + vitest 单测**（对齐 `engine.ts`/`compiler.ts` 的既有风格），覆盖：装饰器行、多行函数签名续行、空行后、类体方法位、`def`/`class` 名字位、`=` 右侧、未闭合括号内、字符串/注释内。
- **缓存**：括号平衡扫描 O(行数)；单文件、单用户场景可按 model 版本号缓存（复用或仿 `SymbolIndex` 的 stale-while-revalidate 模式），展开/补全永不阻塞。

### 3.1 可替换性承诺（对齐 PyCharm ContextType 扩展点）

`PositionClassifier` 是**可替换实现**：v1.1 用启发式扫描；将来换 LSP AST（`montauri-intel` Phase 3）或 tree-sitter，只替换 `classify` 的实现，**模板模型与查询面均不动**。这是「根治」而非「多写一条 if」的本质——判定器是插件点，模型是稳定边界。

## 4. Registry / 查询面修订（§5.2 / 各查询）

- **键**：`scope + kind + abbreviation` → `kind + abbreviation`（一个模板可跨多容器×多位置；三层分层覆盖、墓碑语义不变）。
- **查询面**：
  - `templatesForScope(scope)` → `templatesForContext(ctx)`：按「容器 ∈ scopes」且「position ∈ positions」过滤，再按容器维 `ordering` 排序。
  - `findByAbbreviation(abbr, scope)` → `findByAbbreviation(abbr, ctx)`：Tab 展开同样过位置轴。
  - `findSurround` / `findPostfixByPrefix` 不受位置轴过滤（环绕走选区、后缀走表达式域，自有触发域）。
- **`⚡ 强制全显` 语义**：绕过「位置 + 成员访问」门控，但仍尊重容器与词法（语义写死进测试）。

## 5. 触发路径修订（§9）

- `completion.ts` / `tabExpand.ts` / `surround.ts` / `palette.ts` 四处 `resolveScopeInfo` 接口从 `ScopeInfo` 统一升级为 `SyntaxContext`——**一处接口改动，四处生效**。
- `completion.ts` 的 `.` 分流、`sortText 0xx` 三层合并契约、`⟳` 标注均不变。

## 6. 导入 & 管理 UI 修订（§5.4 / §10）

### 6.1 PyCharm XML 导入（补 `<context>` 映射）

`pycharmImport.ts` 不再丢弃 `<context>`，翻译为「容器 + 位置」：

| PyCharm context option | 本模型翻译 |
|---|---|
| `PYTHON_TOP_LEVEL_STATEMENT` | `scopes: ["python:module"]` + `positions: ["statement"]` |
| `PYTHON_STATEMENT` | `positions: ["statement"]`（scopes 保留三容器） |
| `PYTHON_EXPRESSION` | `positions: ["expression"]` |
| 无 `<context>` | 缺省（statement + expression） |

未识别的 context 选项记录到 `downgraded` 并计数提示（与现有表达式降级同套路，不整体失败）。

### 6.2 管理面板（适用环境多选）

`ui/manager.ts` 的「scope 多选」升级为「适用环境」：容器（module/class/function）× 位置（statement/expression/name）交叉勾选，对应 PyCharm 的 Applicable Contexts 界面；条目身份（`kind:abbreviation`）、墓碑、kind 专属校验均不变。

## 7. 分期与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| A 位置轴核心 | Schema `positions` + `PositionClassifier` + Registry 键/查询面适配 + `name` 默认抑制 | 见下 1-4 |
| B 对标闭环 | PyCharm `<context>` 导入映射 + 管理面板适用环境多选 | 见下 5 |
| C（可选） | 判定器引擎换 LSP AST / tree-sitter，模型不动 | 同 A，单测等价 |

移交到开发计划：归属 `python_ide_dev_plan_v2.md` §7「Phase 4 边角修复」的 live template 任务（建议在该任务下新增独立子项「上下文位置轴」，估时 0.5-1 周）——按「技术方案与开发计划冲突时以开发计划为准并反馈修订」约定，需同步反馈修订开发计划。

### 验收标准

1. `def main|(`、`class Foo|` 处不弹任何结构模板（`main`/`def`/`class`/`if`/`for`/`while`/`try`/`with`…）；
2. 模块层空行 `main` 仍弹 `if __name__ == '__main__'`；
3. `x = main` 不弹 `main` 守卫；`foo(for` 不弹 `for` 结构模板；
4. 装饰器行、多行续行、空行后、类体方法位置，容器判定与排序零回归；`0xx` 三层契约、`⚡ 强制全显` 语义不变；
5. PyCharm 导出的 `<context>` 导入后「适用环境」保真；
6. 新增模块单测全绿（对齐现有 vitest 体系）。

## 8. 实现注记（2026-08-26，相位 A 落地）

相位 A（位置轴核心）已实现并全绿（vitest 10 文件 · 80 项）。与正文的偏差/细化：

1. **判定器落点**：未新建 `context.ts`，`classifyPosition` 与 `resolveSyntaxContext` 直接落在 `scope.ts`——`SyntaxContext extends ScopeInfo` 仅追加 `position`，复用既有容器判定（documentSymbol 缓存 + 缩进兜底）体系。
2. **位置判定以「缩写词起点」为界**（§1.1/§3 细化）：触发补全/展开时光标紧贴缩写词，`statement` 判定为「缩写词起点到行首仅空白 + 上一非空行完整」；「跨行括号平衡」落地为「行末悬挂启发」——上一非空行 `trimEnd()` 以行连接符 `\`、悬挂标点（`, ( [ { . = + - * / % @ < > & | ^ ~`）或悬挂关键词（`and or not in is if elif else for while return yield import from as assert del raise with lambda await`）结尾即视为续行（expression）。`:` 单独处理（tech-debt #15）：块头 `:`（单行块头 def/class/if/... 或跨行签名闭合 `):` / `]:`）不视为续行——块体首行是 statement；仅值分隔冒号（字典键值 / 切片）算续行。v1.1 不维护跨行括号栈；换 LSP AST 时随「可替换性承诺」一并精确化。
3. **Registry 键粒度不变**（偏离 §4 文字）：保持 `scope + kind + abbreviation` 键；`templatesForContext(ctx)` 内部先取 `templatesForScope` 再按 `positions` 过滤，`findByAbbreviation` 增加位置维。理由：改键会牵动「按 scope 墓碑 / 三层覆盖 / ordering」既有语义，收益仅省一次遍历——不为优化引入回归。
4. **缩写分工**：`builtin.ifmain` 为 `__main__` 守卫，`builtin.main` 为「`def main()` 函数定义」模板，均 `scopes:["python:module"] + positions:["statement"]`。
5. **结构模板标注**：`def`/`class`/`dataclass`/`if`/`ife`/`for`/`while`/`try`/`with`/`header`/`adef`/`afor`/`awith`/`init`/`prop`/`iter`/`repr`/`docf` 均 `positions:["statement"]`；`super`/`print`/`lambda` 走缺省。
6. **测试**：新增 `scope.test.ts`（`classifyPosition` 6 项）；`registry.test.ts` 增「位置轴过滤」用例；`builtin.test.ts` 改为断言 `main`/`ifmain`/`header` 三者为 module + statement。

## 9. 实现注记（2026-09-25，相位 B 落地）

相位 B（§6 对标闭环）已实现并全绿（验收标准 5 达成）：

1. **XML 导入映射**（`pycharmImport.ts`）：新增纯函数 `translatePycharmContext(options)`，按 §6.1 表翻译三选项（TOP_LEVEL → `module + statement`，且同时勾选 EXPRESSION 时两位置保留；STATEMENT/EXPRESSION 各自映射）；选项缺失语义 = 未适用（false），显式 true 才计入；两位置都未适用（degenerate 导出）回落缺省不写字段；未识别且 value="true" 的选项记入 `downgraded`（`variable: "<context>"`），与表达式降级同套展示，不整体失败。`parsePycharmXml` 写入 `scopes`/`positions`（无 `<context>` = 缺省三容器 + 不写 positions）。
2. **管理面板适用环境**（`ui/manager.ts`）：「作用域」行旁新增「适用位置」行（语句/表达式/名字位多选，复用 `.lt-scope-opt` 交互范式、`data-position` 区分勾选域）；勾选基准 = 本层定义 > 生效定义 > 缺省；保存时与 `DEFAULT_POSITIONS` 一致则不写字段（配置精简）；空选校验报错。`makeTombstone` 随原定义保留 `positions`（墓碑覆盖语义一致）。列表行悬停 title 在位置轴非缺省时追加 `positions:` 披露。
3. **registry**：`EffectiveEntry` 补 `positions`（`positionsOf(最窄生效定义)`），供面板展示；查询面/键粒度不变（相位 A 偏差 3 继续有效）。
4. **测试**：`pycharmImport.test.ts` +8 项（context 翻译 5 项：TOP_LEVEL / TOP_LEVEL+EXPRESSION / 单独与组合 / 全 false 回落 / 未知选项；XML 导入 3 项：保真、无 context 缺省、未知降级不失败）。
5. **已知边界**：管理面板此前即无 e2e（registry 单测 + 手工验收覆盖策略），相位 B 沿用；「名字位」勾选属高级用法（PyCharm ContextType 无此粒度），默认不勾。