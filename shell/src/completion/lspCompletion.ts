// LSP 补全响应的解析/映射（P0-A2 / P0-D / P1-A 共用）。
// 存在理由：`lsp/client.ts` 顶层 import `invoke` / monaco / `state` 的 `app`，**不是可直接单测的纯模块**；
// 把可剥离的解析与映射搬到这里（形态同 `keywordCompletion.ts`），零 monaco / 零 tauri 依赖。
// 边界：纯函数、不新增进程 / worker / 依赖（符合零 worker 与开销红线）。

/** 与 LSP `Range` 同构（不引用 Monaco 类型，便于纯函数单测） */
export interface LspRangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** LSP TextEdit（单 range）/ InsertReplaceEdit（insert/replace 双 range）的并集形态 */
export interface LspTextEditLike {
  range?: LspRangeLike;
  insert?: LspRangeLike;
  replace?: LspRangeLike;
  newText: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string };
  insertText?: string;
  insertTextFormat?: number; // 1 = plain, 2 = snippet
  sortText?: string;
  filterText?: string;
  data?: unknown; // 引擎用于 completionItem/resolve 标识的不透明数据
  labelDetails?: { detail?: string; description?: string };
  additionalTextEdits?: Array<{ range: LspRangeLike; newText: string }>;
  textEdit?: LspTextEditLike;
  /** §8-1（批次 3 与 P0-C 同批接线）：引擎建议预选该项 */
  preselect?: boolean;
  /** P1-B（批次 4 接线）：接受键附加语义，需在 initialize 里声明 commitCharactersSupport */
  commitCharacters?: string[];
}

/** LSP `CompletionList`（裸数组 / CompletionList / null 归一化后的统一形态） */
export interface LspCompletionList<T = LspCompletionItem> {
  items: T[];
  /**
   * `true` = 引擎声明列表被截断（intel 超 `MAX_CANDIDATES` / basedpyright 系常见）。
   * 客户端据此继续输入时**重新请求**，而不是拿截断列表在本地过滤——否则第 51 名以后的
   * 运行时符号永远补不出来（P0-A1/P0-A2）。
   */
  isIncomplete: boolean;
}

/**
 * LSP completion 响应归一化：裸数组 / `CompletionList` / `null` → 统一 `{ items, isIncomplete }`。
 *
 * 裸数组形态按 LSP 规范**无法**携带 `isIncomplete`，故为 `false`——这正是 P0-A1 要把 intel
 * 响应从 Array 改成 List 的原因。
 */
export function normalizeCompletionList(result: unknown): LspCompletionList {
  if (Array.isArray(result)) {
    return { items: result as LspCompletionItem[], isIncomplete: false };
  }
  const r = result as { items?: unknown; isIncomplete?: unknown } | null | undefined;
  return {
    items: Array.isArray(r?.items) ? (r.items as LspCompletionItem[]) : [],
    isIncomplete: r?.isIncomplete === true,
  };
}

/** 空响应（引擎未就绪 / 请求失败兜底）：列表为空且**不**声明截断（语义是「暂无数据」） */
export function emptyCompletionList(): LspCompletionList {
  return { items: [], isIncomplete: false };
}

/** Monaco `IRange` 同构的普通对象（不引用 Monaco 命名空间，`additionalTextEdits` 接受 plain range） */
export interface MonacoRangeLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** LSP 位置（0-based line/character）→ Monaco 位置（1-based lineNumber/column） */
function lspPosToMonaco(p: { line: number; character: number }): {
  lineNumber: number;
  column: number;
} {
  return { lineNumber: p.line + 1, column: p.character + 1 };
}

/** LSP Range → Monaco IRange 同构（plain 对象，不引用 Monaco 命名空间） */
function lspRangeToMonaco(r: LspRangeLike): MonacoRangeLike {
  const s = lspPosToMonaco(r.start);
  const en = lspPosToMonaco(r.end);
  return {
    startLineNumber: s.lineNumber,
    startColumn: s.column,
    endLineNumber: en.lineNumber,
    endColumn: en.column,
  };
}

/**
 * LSP `additionalTextEdits` → Monaco `additionalTextEdits`（P0-D 外迁，便于单测）。
 *
 * 返回**普通对象**而非 `new monaco.Range(...)`——Monaco 接受 plain range，这样映射逻辑
 * 可脱离 Monaco 实例单测。
 */
export function mapAdditionalTextEdits(
  edits: Array<{ range: LspRangeLike; newText: string }> | undefined,
): Array<{ range: MonacoRangeLike; text: string }> {
  if (!edits?.length) return [];
  return edits.map((e) => ({
    range: lspRangeToMonaco(e.range),
    text: e.newText,
  }));
}

// ---------- P1-A：textEdit 映射（Enter=插入 / Tab=替换） ----------

/** Monaco 双 range 形态（`CompletionItem.range` 原生支持）：Enter 用 insert、Tab 用 replace */
export interface InsertReplaceRangeLike {
  insert: MonacoRangeLike;
  replace: MonacoRangeLike;
}

export interface LspTextEditResult {
  range: MonacoRangeLike | InsertReplaceRangeLike;
  insertText: string;
}

/**
 * LSP `textEdit` → Monaco range + insertText。
 *
 * · TextEdit（单 `{range, newText}`）→ 直接用之（引擎下发的精确替换范围，此前整体被丢弃）；
 * · InsertReplaceEdit（`{insert, replace, newText}`）→ Monaco 双 range 形态：
 *   `Enter`（insert 模式）保留光标右侧文本、`Tab`（replace 模式）整词替换；
 * · 无 `textEdit` → 返回 `null`，调用方回落 word range（现状不变）。
 * `insertTextRules`（snippet 规则）不在本函数处理——沿用 `it.insertTextFormat` 由调用方算。
 */
export function mapLspTextEdit(it: LspCompletionItem): LspTextEditResult | null {
  const te = it.textEdit;
  if (!te || typeof te.newText !== "string") return null;
  // InsertReplaceEdit：insert / replace 双 range 同时存在
  if (te.insert && te.replace) {
    return {
      range: { insert: lspRangeToMonaco(te.insert), replace: lspRangeToMonaco(te.replace) },
      insertText: te.newText,
    };
  }
  if (te.range) return { range: lspRangeToMonaco(te.range), insertText: te.newText };
  return null;
}
