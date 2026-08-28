# ADR（Architecture Decision Records）

所有重大技术决策记录于此。编号规则：`NNN-kebab-title.md`，按时间顺序递增。

## 已记录决策

| 编号 | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0003](0003-lsp-bridge-custom.md) | LSP 接入采用自研轻量桥接层（Rust stdio ↔ Tauri IPC ↔ Monaco providers） | 已定案 | 2026-08-20 |

> 外壳切换交接文档：[`docs/handoff-tauri-monaco.md`](../handoff-tauri-monaco.md)

## 待记录（候选）

- 双静态引擎（Pyrefly 默认 / basedpyright 备选）+ 首日适配抽象层
- 运行时智能作为独立 LSP（`opencharm-intel`），不修改 Pyrefly 内核
- 运行时采样技术选型：PEP 669 `sys.monitoring`
- LSP 结果合并策略（运行时优先 + 来源标注 `⟳ runtime`）

## 模板

```markdown
# ADR-NNN: <决策标题>

- 状态：提议 / 已定案 / 已废弃 / 被取代（指向新 ADR）
- 日期：YYYY-MM-DD
- 决策者：<角色>

## 背景

<为什么需要做这个决策>

## 决策

<选择了什么，一句话结论>

## 备选方案

<考虑过哪些方案，为何否决>

## 后果

<正反面影响与后续约束>
```