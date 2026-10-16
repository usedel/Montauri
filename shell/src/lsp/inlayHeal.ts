// Inlay 装饰泄漏愈合（Monaco vendor 缺陷 mitigation，2026-10-14/15 真机实锤）。
// 规则：每行期望总额 = Σ(1+paddingLeft+paddingRight)；按行比对（类型提示装饰锚列 ≠
//   位置列，按位置会误删整条类型提示，IP3/IP4 实锤）；同行超额 = 泄漏。
// 愈合 v5（2026-10-16 插桩+源码闭环）：超标直接删除 + 清控制器 metadata 死项——渲染轮
//   sweep 按 range 包含回收，插行令装饰位移后成 stranded 滞留；死 id 记账不删，hover
//   以其 item 复活装饰 = 闪现计步器。另清 fast-restore 缓存 + refire；re-arm 冷却 1.6s。
// 触发（inlayFreeze）：每轮后 / 装饰任何变化 / 光标移动。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import type { AnchoredHint } from "./inlayMerge";
/** 模型装饰探针子集（可测性：单测以假模型注入） */
export interface DecorationProbe {
  id: string;
  line: number;
  column: number;
}

/** 期望装饰数 = 1（label）+ paddingLeft + paddingRight（margin 各至多一条） */
function expectedCount(h: AnchoredHint): number {
  return 1 + (h.paddingLeft ? 1 : 0) + (h.paddingRight ? 1 : 0);
}

/**
 * 纯函数：给定本轮渲染输出与模型装饰清单，返回应删除的泄漏装饰 id。
 * ⚠ 按**行**总额比对而非按位置（真机实证锚列语义，详见头注）。
 */
export function findSurplusDecorationIds(hints: AnchoredHint[], decos: DecorationProbe[]): string[] {
  const expectedByLine = new Map<number, number>();
  for (const h of hints) {
    expectedByLine.set(h.line, (expectedByLine.get(h.line) ?? 0) + expectedCount(h));
  }
  const seenByLine = new Map<number, number>();
  const surplus: string[] = [];
  for (const d of decos) {
    const n = (seenByLine.get(d.line) ?? 0) + 1;
    seenByLine.set(d.line, n);
    if (n > (expectedByLine.get(d.line) ?? 0)) surplus.push(d.id);
  }
  return surplus;
}

let refire: (() => void) | null = null;
/** client 注册经 inlayFreeze.setOnChanged 注入 fire；愈合收敛轮复用 */
export function setHealRefire(fn: () => void): void { refire = fn; }

/** 清控制器内部态（fast-restore 缓存 + 全部死项——渲染轮换代与 heal 删除的都算）；静默跳过 */
function purgeControllerState(ed: MonacoApi.editor.ICodeEditor, model: MonacoApi.editor.ITextModel, ids: string[]): void {
  try {
    const c = (ed as unknown as { getContribution(id: string): unknown }).getContribution("editor.contrib.InlayHints") as
      | { _inlayHintsCache?: { _entries?: Map<string, unknown> }; _decorationsMetadata?: Map<string, unknown> }
      | null;
    c?._inlayHintsCache?._entries?.delete(`${model.uri.toString()}/${model.getVersionId()}`);
    const m = c?._decorationsMetadata;
    if (!m) return;
    for (const id of [...m.keys()]) if (!model.getDecorationRange(id) || ids.includes(id)) m.delete(id);
  } catch {
    /* refire 轮仍会收敛 */
  }
}

const queued = new Set<string>();

/** 愈合排程：每 model 至多一个在途宏任务；愈合后仍有超额则 1.6s 冷却再自查 */
export function queueHeal(
  model: MonacoApi.editor.ITextModel,
  entryOf: () => { lineCount: number; hints: AnchoredHint[] } | undefined,
  editor?: MonacoApi.editor.ICodeEditor,
): void {
  const key = model.uri.toString();
  if (queued.has(key)) return;
  queued.add(key);
  setTimeout(() => {
    queued.delete(key);
    const e = entryOf();
    if (!e || e.lineCount !== model.getLineCount()) return;
    if (healInlayDecorations(model, e.hints, editor) > 0) {
      setTimeout(() => queueHeal(model, entryOf, editor), 1600);
    }
  }, 0);
}

/** 愈合入口（超额即直接删）。行数不一致（缓存失效窗口）或模型已销毁 → 跳过。 */
export function healInlayDecorations(model: MonacoApi.editor.ITextModel, hints: AnchoredHint[], editor?: MonacoApi.editor.ICodeEditor): number {
  if (model.isDisposed()) return 0;
  const decos: DecorationProbe[] = [];
  for (const d of model.getAllDecorations()) {
    // description 是控制器写入的记账标签（公开类型未暴露，窄化断言读取）
    if ((d.options as { description?: string }).description !== "InlayHint") continue;
    decos.push({ id: d.id, line: d.range.startLineNumber, column: d.range.startColumn });
  }
  const surplus = findSurplusDecorationIds(hints, decos);
  if (surplus.length) {
    model.deltaDecorations(surplus, []); // v4：直接删（stranded 机制见头注）
    if (editor) {
      purgeControllerState(editor, model, surplus);
      refire?.();
    }
  }
  return surplus.length;
}
