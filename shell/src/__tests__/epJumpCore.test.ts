// A5③：handler→route 反向跳转的纯函数核单测（epJumpCore.ts）。
// 索引建/查是零依赖纯逻辑，直接 import 即可；路径归一在调用层（epJump.ts）做，Core 不参与。
// CodeLens 渲染与弹层交互走 e2e（ux/07-endpoint-lens-openapi.spec.ts），此处只测可直取的纯函数。

import { describe, expect, it } from "vitest";
import { buildHandlerIndex, epIndexKey, findMatches, hasMatches, type EpMatch } from "../epJumpCore";

function ep(over?: Partial<EpMatch>): EpMatch {
  return {
    framework: "fastapi",
    method: "GET",
    route: "/v1/users",
    file: "D:/proj/app/main.py",
    line: 10,
    handler: "list_users",
    ...over,
  };
}

describe("epIndexKey（文件与 handler 用 NUL 分隔）", () => {
  it("同 handler 不同文件不串键", () => {
    expect(epIndexKey("D:/proj/app/main.py", "list_users")).not.toBe(
      epIndexKey("D:/proj/app/admin.py", "list_users"),
    );
    expect(epIndexKey("D:/proj/app/main.py", "list_users")).toBe(
      epIndexKey("D:/proj/app/main.py", "list_users"),
    );
  });
});

describe("buildHandlerIndex（(file, handler) → 绑定端点组）", () => {
  it("include_router：同一 handler 多 route 归入同一条（反向跳转要展示整组）", () => {
    const idx = buildHandlerIndex([
      ep({ route: "/v1/users", line: 10 }),
      ep({ route: "/v2/users", line: 10 }),
      ep({ route: "/v1/users/{uid}", line: 10 }),
    ]);
    const ms = findMatches(idx, "D:/proj/app/main.py", "list_users");
    expect(ms).toHaveLength(3);
    expect(ms.map((m) => m.route).sort()).toEqual(["/v1/users", "/v1/users/{uid}", "/v2/users"]);
  });

  it("同名 handler 在不同文件是两条独立索引（不互相污染）", () => {
    const idx = buildHandlerIndex([
      ep({ file: "D:/proj/app/main.py", route: "/v1/users", line: 10 }),
      ep({ file: "D:/proj/app/admin.py", route: "/admin/users", line: 5 }),
    ]);
    expect(findMatches(idx, "D:/proj/app/main.py", "list_users")).toHaveLength(1);
    expect(findMatches(idx, "D:/proj/app/admin.py", "list_users")).toHaveLength(1);
  });

  it("空扫描结果 → 空索引（不炸）", () => {
    const idx = buildHandlerIndex([]);
    expect(idx.size).toBe(0);
  });
});

describe("findMatches / hasMatches（未命中绝不臆测）", () => {
  it("未命中返回空数组而非 undefined", () => {
    const idx = buildHandlerIndex([ep()]);
    expect(findMatches(idx, "D:/proj/app/main.py", "no_such_handler")).toEqual([]);
    expect(hasMatches(idx, "D:/proj/app/main.py", "no_such_handler")).toBe(false);
  });

  it("命中：hasMatches 为 true，findMatches 返回绑定组", () => {
    const idx = buildHandlerIndex([ep()]);
    expect(hasMatches(idx, "D:/proj/app/main.py", "list_users")).toBe(true);
  });
});
