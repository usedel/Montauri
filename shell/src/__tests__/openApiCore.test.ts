// A5④：OpenAPI 预览的纯函数核单测（openApiCore.ts）。
// methodIncludes / findScanMatch / sortOps 零依赖，直接 import；渲染与 invoke 走 e2e。

import { describe, expect, it } from "vitest";
import { findScanMatch, methodIncludes, sortOps, type OpenApiOp, type ScanMatch } from "../openApiCore";

function op(over: Partial<OpenApiOp>): OpenApiOp {
  return {
    method: "GET",
    path: "/v1/users",
    operation_id: "list_users",
    summary: "",
    tags: [],
    deprecated: false,
    ...over,
  };
}

function scan(over?: Partial<ScanMatch>): ScanMatch {
  return {
    method: "GET",
    route: "/v1/users",
    file: "app/main.py",
    line: 10,
    handler: "list_users",
    ...over,
  };
}

describe("methodIncludes（scan 的 method 可能是多值）", () => {
  it("单值与多值命中", () => {
    expect(methodIncludes("GET", "GET")).toBe(true);
    expect(methodIncludes("GET/POST", "POST")).toBe(true);
    expect(methodIncludes("GET/POST", "GET")).toBe(true);
  });

  it("大小写与空白容忍；不命中返回 false", () => {
    expect(methodIncludes(" get ", "GET")).toBe(true);
    expect(methodIncludes("GET", "PATCH")).toBe(false);
    expect(methodIncludes("GET/POST", "DELETE")).toBe(false);
  });
});

describe("findScanMatch（path 全等 + method 交集）", () => {
  it("命中：单方法与多方法声明都匹配", () => {
    const m1 = findScanMatch(op({ method: "GET" }), [scan()]);
    expect(m1?.file).toBe("app/main.py");
    expect(m1?.line).toBe(10);
    const m2 = findScanMatch(op({ method: "POST" }), [scan({ method: "GET/POST" })]);
    expect(m2).not.toBeNull();
  });

  it("path 不一致 → null（服务 schema 与离线扫描可能不同，识别不到就明说）", () => {
    expect(findScanMatch(op({ path: "/v1/users/{uid}" }), [scan()])).toBeNull();
  });

  it("method 无交集 → null", () => {
    expect(findScanMatch(op({ method: "DELETE" }), [scan({ method: "GET/POST" })])).toBeNull();
  });

  it("多条目时取第一个匹配", () => {
    const m = findScanMatch(op({ method: "GET" }), [
      scan({ route: "/other" }),
      scan({ route: "/v1/users", line: 33 }),
    ]);
    expect(m?.line).toBe(33);
  });
});

describe("sortOps（方法档位 → 路径字典序，不改变原数组）", () => {
  it("GET 组在 POST 组前；同方法按路径字典序", () => {
    const src = [
      op({ method: "POST", path: "/z" }),
      op({ method: "GET", path: "/b" }),
      op({ method: "GET", path: "/a" }),
    ];
    const sorted = sortOps(src);
    expect(sorted.map((o) => `${o.method} ${o.path}`)).toEqual(["GET /a", "GET /b", "POST /z"]);
    expect(src.map((o) => o.path)).toEqual(["/z", "/b", "/a"]); // 原数组不被改
  });

  it("未登记方法排最后（按路径字典序）", () => {
    const sorted = sortOps([
      op({ method: "CONNECT", path: "/x" }),
      op({ method: "GET", path: "/a" }),
    ]);
    expect(sorted.map((o) => o.method)).toEqual(["GET", "CONNECT"]);
  });
});
