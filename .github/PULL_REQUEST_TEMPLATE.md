# Pull Request

## 变更类型

- [ ] feat（新功能）
- [ ] fix（缺陷修复）
- [ ] refactor（无行为变化）
- [ ] docs（仅文档）
- [ ] chore / ci / build（工程杂务）

## 说明

<!-- 做了什么、为什么；关联 Issue 用 Closes #123 -->

## 门禁自查（按改动面勾选）

- [ ] **CI 全绿**（前端 vitest + tsc / probe pytest / intel cargo test / shell cargo test / 预算门禁 / UI token 门禁）
- [ ] 改动面单测已补充（`shell/src`、`shell/src-tauri`、`probe`、`intel`）
- [ ] Rust 改动已本地 `cargo check` / `cargo test` 通过（交付铁律）
- [ ] 改 `shell/src` 或 `src-tauri` 后已跑 `npm run build` + `shell/scripts/budget-check.mjs`，**预算未超限**（超限需在正文写清理由，不允许静默抬阈值）
- [ ] 涉及 DAP / LSP 桥 / PTY / 真实 Rust 逻辑的改动附真机 e2e 结论（`shell/e2e-real/`）
- [ ] 文档已同步（`docs/` 计划/验收记录，或 `tech-debt.md` 登记）

## 风险与回滚

<!-- 影响面、可观测指标变化、回滚方式；大批量改动请说明拆分理由 -->
