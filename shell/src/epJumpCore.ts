// A5③：handler→route 反向跳转的**纯函数核**。
//
// 与 `epJump.ts` 的分工同 `epSampleCore` / `epSample`：本文件零 app 依赖（不 import
// 任何模块），单测可直接 import。路径归一由调用层做——`epJump.ts` 用 `util::normalizePath`
// 在「进索引」与「查询」两端各归一一次（项目铁律：路径比较走 samePath/normalizePath，
// Core 不自写归一，避免单测场景与真实浏览器行为分裂）。
//
// 数据形状与 `endpointView.EndpointMatch` 同形（Core 自持接口，避免运行时 import
// endpointView → 拖入 termUi → git 的模块级 DOM 查询链，单测必然缺元素报错）。

/** 端点条目（endpointView.EndpointMatch 的拷贝；调用层负责把 file 归一为同一口径） */
export interface EpMatch {
  framework: string;
  method: string;
  route: string;
  /** 声明文件（已归一，正斜杠 + 大小写无关） */
  file: string;
  /** 声明行号（1 起） */
  line: number;
  handler: string;
}

/** 索引键：`file + NUL + handler`（handler 为空串的扫描退化也能区分文件） */
export function epIndexKey(file: string, handler: string): string {
  return `${file}\u0000${handler}`;
}

export type HandlerIndex = Map<string, EpMatch[]>;

/**
 * 建索引：`(file, handler)` → 绑定的端点列表。
 * `include_router` 会把同一 handler 挂到多个前缀 → 同一 handler 对应多条 route，
 * 全部归入同一条（反向跳转要展示的就是这组 route）。
 */
export function buildHandlerIndex(results: EpMatch[]): HandlerIndex {
  const idx: HandlerIndex = new Map();
  for (const m of results) {
    const key = epIndexKey(m.file, m.handler);
    const arr = idx.get(key);
    if (arr) arr.push(m);
    else idx.set(key, [m]);
  }
  return idx;
}

/** 查 handler 绑定的端点；未命中返回空数组（绝不臆测） */
export function findMatches(index: HandlerIndex, file: string, handler: string): EpMatch[] {
  return index.get(epIndexKey(file, handler)) ?? [];
}

/** handler 是否绑定任何端点（CodeLens 出镜条件：绑定 > 0 才出） */
export function hasMatches(index: HandlerIndex, file: string, handler: string): boolean {
  return findMatches(index, file, handler).length > 0;
}
