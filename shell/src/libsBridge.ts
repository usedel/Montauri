// 库支持面板桥（库特别支持 PR-2）：编辑器入口（lens / 右键 / 键位）向 devtools 面板
// 传递「当前正则」上下文的轻量中转。独立小模块，避免 dslLens ↔ devtools/builtin 循环依赖。

export interface RegexPanelRequest {
  /** 模式的 Python 字符串值（非 raw 串已反转义） */
  pattern: string;
  isRaw: boolean;
  flags: string[];
  /** 「替换字面量」写回定位：模式串首字符在文档中的偏移（-1 = 非编辑器来源，写回置灰） */
  contentOffset: number;
  /** 源码字面量全文（含引号），替换字面量时使用 */
  source: string;
}

let pending: RegexPanelRequest | null = null;

export function setPendingRegexRequest(req: RegexPanelRequest): void {
  pending = req;
}

/** 面板挂载时取走（取后清空，避免下次打开误用旧上下文） */
export function takePendingRegexRequest(): RegexPanelRequest | null {
  const p = pending;
  pending = null;
  return p;
}

// ---------- JSONPath 面板请求（库特别支持 P1 §7-3：编辑器右键「JSONPath 提取」入口） ----------

export interface JsonPathPanelRequest {
  /** 字面量反转义后的 JSON 文本 */
  json: string;
}

let pendingJsonPath: JsonPathPanelRequest | null = null;

export function setPendingJsonPathRequest(req: JsonPathPanelRequest): void {
  pendingJsonPath = req;
}

/** 面板挂载时取走（取后清空） */
export function takePendingJsonPathRequest(): JsonPathPanelRequest | null {
  const p = pendingJsonPath;
  pendingJsonPath = null;
  return p;
}
