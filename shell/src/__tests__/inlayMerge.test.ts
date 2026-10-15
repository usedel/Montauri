// inlayMerge 单测（跳变治理 B）：双源合并（引擎原位）+ 光标行冻结。
// 数据形态来自 2026-10-12 pyrefly 1.3.0 裸会话探针实证：
//   · 变量提示 label `": (url: str) -> int"`（": " 前缀，锚名字后）
//   · 参数名提示 label `"a= "`（不以 ": " 开头，锚实参前）
//   · pyrefly 不回填 kind/paddingLeft（判定不得依赖 kind）
import { describe, expect, it } from "vitest";
import { anchorStillValid, applyCursorFreeze, isAtInlayAnchor, mergeInlayHints, type AnchoredHint, type MergeableHint } from "../lsp/inlayMerge";

function hint(line: number, character: number, label: string, kind?: number): MergeableHint {
  return { line, character, label, kind };
}

function labels(out: AnchoredHint[]): string[] {
  return out.map((h) => h.label);
}

describe("mergeInlayHints：引擎原位 + 双源去重", () => {
  it("变量提示保持引擎原位（锚名字后，不再重锚行尾）", () => {
    // `req = sess.post`（0 基 line 5）：pyrefly 锚 char=7（名字后）→ 原样输出
    const out = mergeInlayHints([], [hint(5, 7, ": (url: str) -> int")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ line: 6, column: 8, label: ": (url: str) -> int" });
  });

  it("参数名提示（`a= `）与返回值提示（`-> `）原位透传", () => {
    const out = mergeInlayHints([], [hint(12, 22, "a= "), hint(12, 25, "b= "), hint(9, 13, "-> None")]);
    expect(out.map((h) => [h.line, h.column, h.label])).toEqual([
      [10, 14, "-> None"],
      [13, 23, "a= "],
      [13, 26, "b= "],
    ]);
  });

  it("同位置同文案去重（两源短暂并存期）", () => {
    const same = hint(5, 7, ": Session");
    expect(mergeInlayHints([same], [same])).toHaveLength(1);
  });

  it("intel 行占位：同行静态变量提示让位（防名字后 + 行尾两段视觉重复）", () => {
    const out = mergeInlayHints([hint(5, 19, ": dict[str, int]")], [hint(5, 4, ": dict[str, Any]")]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe(": dict[str, int]");
  });

  it("intel 行上的参数名提示不受行占位影响", () => {
    expect(mergeInlayHints([hint(5, 19, ": dict[str, int]")], [hint(5, 10, "url= ")])).toHaveLength(2);
  });

  it("结果按 (line, column) 排序", () => {
    const out = mergeInlayHints([], [hint(3, 5, ": int"), hint(1, 2, "a= "), hint(1, 1, ": str")]);
    expect(labels(out)).toEqual([": str", "a= ", ": int"]);
  });
});

describe("anchorStillValid：复活锚点守卫", () => {
  it("标识符恰在锚点列前结束 → 有效", () => {
    expect(anchorStillValid("    req = sess.", 8)).toBe(true); // `req` 止于列 7，列 8 是空格
    expect(anchorStillValid("    req", 8)).toBe(true); // 行尾锚点（标识符后即 EOL）
  });
  it("标识符延续过锚点（前插漂移）→ 无效", () => {
    expect(anchorStillValid("    request = x", 8)).toBe(false); // 列 8 停在 requ|est 中间
  });
  it("锚点前不是标识符 / 行过短 / 列非法 → 无效", () => {
    expect(anchorStillValid("    x = 1", 8)).toBe(false); // 列 7 是 `=`
    expect(anchorStillValid("    r", 8)).toBe(false); // 行长度 < 列-1
    expect(anchorStillValid("    req = x", 1)).toBe(false);
  });
});

describe("applyCursorFreeze：光标行冻结（B 方案，分池按序配对 + 复活）", () => {
  const cached: AnchoredHint[] = [
    { line: 6, column: 8, label: ": (url: str) -> int" }, // 光标行冻结区
    { line: 6, column: 23, label: "url= " }, // 光标行但光标右侧（列 23 > 边界 20）
    { line: 9, column: 14, label: "-> None" }, // 非光标行
  ];
  // 行文本夹具：line 6 的 `req` 止于列 7（列 8 锚点有效）
  const TEXTS: Record<number, string> = { 6: "    req = sess.post", 9: "def fake_req():" };
  const lineTextOf = (l: number): string => TEXTS[l] ?? "";

  it("冻结区标签取缓存、位置取新值（主场景：行尾输入令类型塌缩）", () => {
    const fresh: AnchoredHint[] = [
      { line: 6, column: 8, label: ": int" }, // `sess.post()` 塌缩后的新值
      { line: 6, column: 23, label: "url= " },
      { line: 9, column: 14, label: "-> None" },
    ];
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 20 }], lineTextOf);
    expect(labels(out)).toEqual([": (url: str) -> int", "url= ", "-> None"]);
  });

  it("行内前插令新提示列漂移 → 位置跟随新值、标签仍冻结（按序配对不按列）", () => {
    const fresh: AnchoredHint[] = [{ line: 6, column: 11, label: ": int" }]; // 变量前插入 3 字符
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 30 }], lineTextOf);
    expect(out[0]).toMatchObject({ line: 6, column: 11, label: ": (url: str) -> int" });
  });

  it("光标右侧照常刷新（列 > 冻结边界取新值）", () => {
    const fresh: AnchoredHint[] = [
      { line: 6, column: 8, label: ": int" },
      { line: 6, column: 23, label: "data= " }, // 光标右侧提示变了
      { line: 9, column: 14, label: "-> None" },
    ];
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 20 }], lineTextOf);
    expect(labels(out)).toEqual([": (url: str) -> int", "data= ", "-> None"]);
  });

  it("引擎丢弃提示 → 锚点有效则原位复活（用户实案：`sess.` 不完整态消失型跳变）", () => {
    // 探针实证：`r1 = sess.` 时 pyrefly 整条丢弃变量提示；不复活则注入宽度塌缩、光标左跳
    const fresh: AnchoredHint[] = [{ line: 9, column: 14, label: "-> None" }];
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 20 }], (l) =>
      l === 6 ? "    req = sess." : lineTextOf(l),
    );
    expect(labels(out)).toEqual([": (url: str) -> int", "-> None"]);
    expect(out[0]).toMatchObject({ line: 6, column: 8 }); // 原位复活
  });

  it("锚点失效不复活（行被重写 → 宁缺勿错）", () => {
    const fresh: AnchoredHint[] = [{ line: 9, column: 14, label: "-> None" }];
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 20 }], (l) =>
      l === 6 ? "    x = 1" : lineTextOf(l),
    );
    expect(labels(out)).toEqual(["-> None"]);
  });

  it("分池配对：新出现的参数提示不顶替类型提示的缓存槽位", () => {
    // 类型提示被引擎丢弃的同一轮，实参处新出现 `url= `——若不分池，按序配对会把
    // `: Session` 标签渲染到实参位置
    const c: AnchoredHint[] = [{ line: 6, column: 8, label: ": Session" }];
    const fresh: AnchoredHint[] = [{ line: 6, column: 22, label: "url= " }];
    const out = applyCursorFreeze(fresh, c, [{ line: 6, column: 30 }], lineTextOf);
    expect(out.map((h) => [h.column, h.label])).toEqual([
      [8, ": Session"], // 复活（锚点有效）
      [22, "url= "], // 新值保留自身标签
    ]);
  });

  it("新值多出的提示无缓存可配 → 保留新标签（新参数名等）", () => {
    const fresh: AnchoredHint[] = [
      { line: 6, column: 8, label: ": int" },
      { line: 6, column: 12, label: "json= " }, // 新增参数提示，缓存里没有第 2 项
    ];
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 20 }], lineTextOf);
    expect(labels(out)).toEqual([": (url: str) -> int", "json= "]);
  });

  it("光标跨行离开后（无光标在该行）→ 新值直通（解冻）", () => {
    const fresh: AnchoredHint[] = [
      { line: 6, column: 8, label: ": int" },
      { line: 6, column: 23, label: "url= " },
      { line: 9, column: 14, label: "-> None" },
    ];
    const out = applyCursorFreeze(fresh, cached, [{ line: 9, column: 14 }], lineTextOf);
    expect(labels(out)).toEqual([": int", "url= ", "-> None"]);
  });

  it("多光标同取最小列为冻结边界（边界右侧照常刷新）", () => {
    // 光标 A 在列 20、光标 B 在列 5 → 边界取 5；列 8 的提示在边界右侧（8 > 5）
    // → 属于光标右侧 → 照常取新值（不冻结——它不推动光标视觉位置）
    const fresh: AnchoredHint[] = [{ line: 6, column: 8, label: ": int" }];
    const out = applyCursorFreeze(fresh, cached, [{ line: 6, column: 20 }, { line: 6, column: 5 }], lineTextOf);
    expect(labels(out)).toEqual([": int"]);
  });

  it("缓存为 null（首帧）或光标为空 → fresh 原引用直通（调用方以引用判定冻结发生）", () => {
    const fresh: AnchoredHint[] = [{ line: 6, column: 8, label: ": int" }];
    expect(applyCursorFreeze(fresh, null, [{ line: 6, column: 20 }], lineTextOf)).toBe(fresh);
    expect(applyCursorFreeze(fresh, cached, [], lineTextOf)).toBe(fresh);
  });
});

describe("mergeInlayHints：类型提示 (行,文) 去重", () => {
  it("同行同文邻列重复（引擎漂移）→ 仅一条", () => {
    const out = mergeInlayHints([], [hint(9, 8, ": Response"), hint(9, 9, ": Response")]);
    expect(out).toHaveLength(1);
  });
  it("同行同文参数名不同列 → 保留两条（嵌套调用合法形态）", () => {
    const out = mergeInlayHints([], [hint(9, 20, "a= "), hint(9, 26, "a= ")]);
    expect(out).toHaveLength(2);
  });
  it("同行不同文类型提示 → 保留（intel 让位规则另管）", () => {
    const out = mergeInlayHints([], [hint(9, 8, ": Response"), hint(9, 8, ": Session")]);
    expect(out).toHaveLength(2);
  });
});

// 复活去重守卫（2026-10-15 真机双份 `: Response` 实案）：池内历史多副本不得每轮
// 「配对消耗一条 + 复活回填一条」化石重生——同列已有输出即跳过，双份自然收敛。
describe("applyCursorFreeze：复活去重守卫", () => {
  const lineTextOf = (l: number): string => (l === 6 ? "    resp = sess.get(my_url)" : "");
  it("池同列双副本 + fresh 单份 → 输出单份（化石链斩断）", () => {
    const cached2: AnchoredHint[] = [
      { line: 6, column: 9, label: ": Response" },
      { line: 6, column: 9, label: ": Session" }, // 历史轮形成的同列双副本
    ];
    const fresh: AnchoredHint[] = [{ line: 6, column: 9, label: ": Response" }];
    const out = applyCursorFreeze(fresh, cached2, [{ line: 6, column: 20 }], lineTextOf);
    expect(out).toHaveLength(1);
  });
  it("fresh 无、池同列双副本 → 仅复活一条（下轮缓存收敛为单份）", () => {
    const cached2: AnchoredHint[] = [
      { line: 6, column: 9, label: ": Response" },
      { line: 6, column: 9, label: ": Session" },
    ];
    const out = applyCursorFreeze([], cached2, [{ line: 6, column: 20 }], lineTextOf);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe(": Response");
  });
});

// 悬停闪现抑制判定（真机 2026-10-15 实证：鼠标悬停注入文本时 monaco 的 target.position
// 映射 = 提示位置列（非装饰锚列），精确匹配即可）
describe("isAtInlayAnchor", () => {
  const hints: AnchoredHint[] = [
    { line: 14, column: 15, label: " -> None" },
    { line: 8, column: 9, label: ": Response" },
  ];
  it("锚点精确命中 → true", () => {
    expect(isAtInlayAnchor(hints, 14, 15)).toBe(true);
    expect(isAtInlayAnchor(hints, 8, 9)).toBe(true);
  });
  it("邻列/邻行/空表 → false", () => {
    expect(isAtInlayAnchor(hints, 14, 14)).toBe(false);
    expect(isAtInlayAnchor(hints, 14, 16)).toBe(false);
    expect(isAtInlayAnchor(hints, 9, 9)).toBe(false);
    expect(isAtInlayAnchor([], 14, 15)).toBe(false);
  });
});
