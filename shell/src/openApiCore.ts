// A5④：OpenAPI 面板内预览的**纯函数核**。
//
// 与 `openApiPanel.ts` 的分工同 `epSampleCore` / `epSample`：本文件零 app 依赖，
// 单测可直接 import。数据形状与 Rust `openapi_cmds.rs::OpenApiOp` 逐字对应
// （改一侧必改另一侧）。「扁平化 paths」在 Rust 侧已做，这里只做匹配与排序。

/** OpenAPI 操作（与 Rust OpenApiOp 对应） */
export interface OpenApiOp {
  method: string;
  path: string;
  operation_id: string;
  summary: string;
  tags: string[];
  deprecated: boolean;
}

/** 静态扫描条目（endpointView.EndpointMatch 的子集——匹配只用到这些字段） */
export interface ScanMatch {
  method: string;
  route: string;
  file: string;
  line: number;
  handler: string;
}

/** scan_endpoints 的 method 可能是多值（"GET/POST"）——拆分后比对 */
export function methodIncludes(all: string, method: string): boolean {
  return all
    .split("/")
    .some((m) => m.trim().toUpperCase() === method);
}

/**
 * OpenAPI 操作 ↔ 静态扫描结果匹配：path 全等 + method 交集。
 * 匹配不到返回 null（运行中服务的 schema 与离线扫描可能不一致：include_router
 * 展开差异、装饰器写法差异、服务代码比工作区新——识别不到就明说，绝不臆测）。
 */
export function findScanMatch(op: OpenApiOp, results: ScanMatch[]): ScanMatch | null {
  return (
    results.find((m) => m.route === op.path && methodIncludes(m.method, op.method)) ?? null
  );
}

/** 方法档位（预览列表分组顺序；未登记方法排最后，同 endpointView METHOD_ORDER） */
const METHOD_RANK: Record<string, number> = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
  HEAD: 5,
  OPTIONS: 6,
  TRACE: 7,
};

/** 预览列表排序：方法档位 → 路径字典序（不改变原数组） */
export function sortOps(ops: OpenApiOp[]): OpenApiOp[] {
  return [...ops].sort((a, b) => {
    const ra = METHOD_RANK[a.method] ?? 99;
    const rb = METHOD_RANK[b.method] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.path.localeCompare(b.path);
  });
}
