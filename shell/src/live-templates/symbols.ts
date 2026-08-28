// documentSymbol 缓存（M2，方案 §6.2）：为上下文判定提供符号数据
// 数据源由外层注入（LSP 桥 documentSymbols）；stale-while-revalidate：
// 查询总返回缓存（可能过期）并触发 300ms 防抖后台刷新，展开/补全永不阻塞。

export interface LspRangeLike {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface RawSymbol {
  name: string;
  kind: number;
  range?: LspRangeLike;
  selectionRange: LspRangeLike;
  children?: RawSymbol[];
}

export interface FlatSymbol {
  name: string;
  kind: number;
  /** 1-based 行号，闭区间 */
  startLine: number;
  endLine: number;
}

/** LSP SymbolKind（与引擎无关的通用值） */
export const SYMBOL_KIND_CLASS = 5;
export const SYMBOL_KIND_METHOD = 6;
export const SYMBOL_KIND_FUNCTION = 12;

/** 层级符号树 → 扁平列表（含全部种类，判定侧按需过滤） */
export function flattenSymbols(raw: RawSymbol[]): FlatSymbol[] {
  const out: FlatSymbol[] = [];
  const walk = (s: RawSymbol): void => {
    const r = s.range ?? s.selectionRange;
    if (r) {
      out.push({ name: s.name, kind: s.kind, startLine: r.start.line + 1, endLine: r.end.line + 1 });
    }
    s.children?.forEach(walk);
  };
  raw.forEach(walk);
  return out;
}

interface VersionedModel {
  getVersionId(): number;
}

export class SymbolIndex {
  private entries = new Map<string, { version: number; symbols: FlatSymbol[] }>();
  private timers = new Map<string, number>();
  private inflight = new Set<string>();

  constructor(private fetchSymbols: (path: string) => Promise<RawSymbol[]>) {}

  /** 取缓存；未取过或版本过期时触发后台刷新（仍返回旧数据） */
  lookup(path: string, model: VersionedModel): FlatSymbol[] | null {
    const key = normKey(path);
    const entry = this.entries.get(key);
    if (!entry || entry.version !== model.getVersionId()) {
      this.scheduleRefresh(key, path, model);
    }
    return entry?.symbols ?? null;
  }

  private scheduleRefresh(key: string, path: string, model: VersionedModel): void {
    if (this.inflight.has(key)) return;
    const prev = this.timers.get(key);
    if (prev !== undefined) window.clearTimeout(prev);
    this.timers.set(
      key,
      window.setTimeout(() => {
        this.timers.delete(key);
        if (this.inflight.has(key)) return;
        this.inflight.add(key);
        this.fetchSymbols(path)
          .then((raw) => {
            // 以响应到达时的 model 版本近似关联；若已过期，下次 lookup 自愈再刷
            this.entries.set(key, { version: model.getVersionId(), symbols: flattenSymbols(raw) });
          })
          .catch(() => {
            /* LSP 未就绪/请求失败：保持兜底路径 */
          })
          .finally(() => this.inflight.delete(key));
      }, 300),
    );
  }

  clear(): void {
    this.entries.clear();
  }
}

function normKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}
