// LSP 补全响应的解析/映射（P0-A2 / P0-D / P1-A 共用）。
//
// 存在理由：`lsp/client.ts` 顶层 import `invoke` / monaco / `state` 的 `app`，**不是可直接单测的纯模块**
// （`shell/src/__tests__/` 里没有它的测试文件，原因即在此）。本模块把可剥离的解析与映射逻辑搬出来，
// 形态同 `keywordCompletion.ts`——零 monaco / 零 tauri 依赖，vitest 直接 import 即可。
//
// 边界：不新增进程 / worker / 依赖，纯函数（符合零 worker 与开销红线）。

/** 与 LSP `Range` 同构（不引用 Monaco 类型，便于纯函数单测） */
export interface LspRangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
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
  return edits.map((e) => {
    const s = lspPosToMonaco(e.range.start);
    const en = lspPosToMonaco(e.range.end);
    return {
      range: {
        startLineNumber: s.lineNumber,
        startColumn: s.column,
        endLineNumber: en.lineNumber,
        endColumn: en.column,
      },
      text: e.newText,
    };
  });
}
