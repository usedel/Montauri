// testTreeCore 单测（docs/pytest_dev_plan.md §7）：纯函数层零 app 依赖，node 环境直测。
// 覆盖：树构建（顺序 / 嵌套 / parametrize / 自定义命名文件）/ scanTestDefs（缩进类栈 /
// 同名消歧 / 函数内嵌排除）/ applyResults（匹配 / 汇总 / 幂等 / 降级匹配）/
// collectFailedIds / isTestFileName / chunkPlan（帧大小与边界）。
import { describe, expect, it } from "vitest";
import {
  applyResults,
  buildNodeId,
  buildTestTree,
  caseDisplayName,
  chunkPlan,
  collectFailedIds,
  countCases,
  isTestFileName,
  rollup,
  scanTestDefs,
  splitNodeId,
  type TestCaseResult,
} from "../testTreeCore";

function caseResult(nodeId: string, status: TestCaseResult["status"], extra: Partial<TestCaseResult> = {}): TestCaseResult {
  return { node_id: nodeId, status, duration_ms: 10, message: null, file: null, line: null, ...extra };
}

// ---------- isTestFileName ----------

describe("isTestFileName", () => {
  it("默认命名模式 test_*.py / *_test.py", () => {
    expect(isTestFileName("test_api.py")).toBe(true);
    expect(isTestFileName("tests/test_api.py")).toBe(true);
    expect(isTestFileName("a/api_test.py")).toBe(true);
  });

  it("裸 test.py / 普通 py / 非 py 扩展名都不是", () => {
    expect(isTestFileName("test.py")).toBe(false); // 默认 python_files 不含（collect 阶段补齐）
    expect(isTestFileName("app.py")).toBe(false);
    expect(isTestFileName("test_api.txt")).toBe(false);
    expect(isTestFileName("test_api.pyx")).toBe(false);
  });
});

// ---------- node id 构造 / 拆分 ----------

describe("buildNodeId / splitNodeId", () => {
  it("互为逆运算（类名不含 :: 时）", () => {
    const id = buildNodeId("tests/test_api.py", ["TestUser"], "test_create");
    expect(id).toBe("tests/test_api.py::TestUser::test_create");
    expect(splitNodeId(id)).toEqual({ file: "tests/test_api.py", classPath: ["TestUser"], name: "test_create" });
  });

  it("parametrize 后缀留在 name 里", () => {
    const id = "tests/test_api.py::TestUser::test_create[1-2]";
    expect(splitNodeId(id).name).toBe("test_create[1-2]");
    expect(caseDisplayName(id)).toBe("test_create[1-2]");
  });

  it("嵌套类路径逐段 :: 连接", () => {
    expect(buildNodeId("t.py", ["A", "B"], "test_x")).toBe("t.py::A::B::test_x");
    expect(splitNodeId("t.py::A::B::test_x").classPath).toEqual(["A", "B"]);
  });

  it("模块级用例无类段", () => {
    expect(splitNodeId("t.py::test_x")).toEqual({ file: "t.py", classPath: [], name: "test_x" });
  });
});

// ---------- buildTestTree ----------

describe("buildTestTree", () => {
  it("nodes 为空 → 仅文件级骨架（scan 先行渲染）", () => {
    const roots = buildTestTree(["tests/test_a.py", "tests/test_b.py"]);
    expect(roots.map((r) => r.id)).toEqual(["tests/test_a.py", "tests/test_b.py"]);
    expect(roots.every((r) => r.children.length === 0)).toBe(true);
    expect(roots[0]?.name).toBe("test_a.py");
    expect(countCases(roots)).toBe(0);
  });

  it("collect 节点进骨架：文件 → 类 → 用例，保收集序", () => {
    const roots = buildTestTree(["tests/test_api.py"], [
      "tests/test_api.py::test_create",
      "tests/test_api.py::TestUser::test_x[1-2]",
      "tests/test_api.py::TestUser::test_x[3-4]",
      "tests/test_api.py::TestUser::test_y",
    ]);
    expect(roots).toHaveLength(1);
    const file = roots[0]!;
    expect(file.children.map((c) => (c.kind === "case" ? c.id : c.id))).toEqual([
      "tests/test_api.py::test_create",
      "tests/test_api.py::TestUser",
    ]);
    const cls = file.children[1]!;
    expect(cls.kind).toBe("class");
    if (cls.kind === "class") {
      expect(cls.children.map((c) => c.id)).toEqual([
        "tests/test_api.py::TestUser::test_x[1-2]",
        "tests/test_api.py::TestUser::test_x[3-4]",
        "tests/test_api.py::TestUser::test_y",
      ]);
    }
    expect(countCases(roots)).toBe(4);
  });

  it("自定义 python_files 的非常规命名文件：collect 有而 scan 无 → 追加末尾", () => {
    const roots = buildTestTree(["tests/test_a.py"], [
      "tests/test_a.py::test_one",
      "checks/suite.py::test_two", // 自定义命名，scan 骨架里没有
    ]);
    expect(roots.map((r) => r.id)).toEqual(["tests/test_a.py", "checks/suite.py"]);
  });

  it("嵌套类分组 + 同名方法按类路径消歧", () => {
    const roots = buildTestTree(["t.py"], [
      "t.py::A::B::test_x",
      "t.py::A::test_x",
      "t.py::test_x",
    ]);
    const a = roots[0]!.children.find((c) => c.kind === "class" && c.name === "A")!;
    expect(a.kind).toBe("class");
    if (a.kind === "class") {
      expect(a.children.map((c) => c.id)).toEqual(["t.py::A::B", "t.py::A::test_x"]);
      const b = a.children[0]!;
      if (b.kind === "class") expect(b.children.map((c) => c.id)).toEqual(["t.py::A::B::test_x"]);
    }
    expect(roots[0]!.children.some((c) => c.kind === "case")).toBe(true);
  });

  it("畸形 node id（无 :: / 空段）跳过", () => {
    const roots = buildTestTree(["t.py"], ["t.py", "", "::test_x"]);
    expect(countCases(roots)).toBe(0);
  });

  it("重复 node id 去重", () => {
    const roots = buildTestTree(["t.py"], ["t.py::test_x", "t.py::test_x"]);
    expect(countCases(roots)).toBe(1);
  });

  it("pruneEmptyFiles：collect 成功口径下剔除零用例骨架文件行（venv 误收集修复）", () => {
    // 现场复刻：scan 骨架里混进 venv/Lib/site-packages 三方包测试文件，而 pytest
    // 一个用例都没从它们收到——这些行不该在收集成功后长期占位。
    const roots = buildTestTree(
      ["tests/test_a.py", "venv/Lib/site-packages/h11/tests/test_io.py", "venv/Lib/site-packages/greenlet/tests/test_gc.py"],
      ["tests/test_a.py::test_one"],
      true,
    );
    expect(roots.map((r) => r.id)).toEqual(["tests/test_a.py"]);
  });

  it("pruneEmptyFiles 不误伤自定义 python_files 的追加文件（它们自带 case）", () => {
    const roots = buildTestTree(["tests/test_a.py", "checks/suite.py"], ["tests/test_a.py::test_one", "checks/suite.py::test_two"], true);
    expect(roots.map((r) => r.id)).toEqual(["tests/test_a.py", "checks/suite.py"]);
  });

  it("pruneEmptyFiles 默认 false：骨架语义不变（collect 失败/取消时树仍可见）", () => {
    const roots = buildTestTree(["tests/test_a.py", "venv/Lib/site-packages/x/test_b.py"], ["tests/test_a.py::test_one"]);
    expect(roots.map((r) => r.id)).toEqual(["tests/test_a.py", "venv/Lib/site-packages/x/test_b.py"]);
  });
});

// ---------- applyResults / rollup ----------

describe("applyResults", () => {
  const tree = () => buildTestTree(["tests/test_api.py"], [
    "tests/test_api.py::test_ok",
    "tests/test_api.py::TestUser::test_bad",
    "tests/test_api.py::TestUser::test_skip",
  ]);

  it("按 node_id 匹配写入状态 / 耗时 / 消息 / 行号", () => {
    const roots = tree();
    applyResults(roots, [
      caseResult("tests/test_api.py::test_ok", "passed", { duration_ms: 12, line: 10 }),
      caseResult("tests/test_api.py::TestUser::test_bad", "failed", { message: "assert 1 == 2", line: 20 }),
      caseResult("tests/test_api.py::TestUser::test_skip", "skipped"),
    ]);
    const cases = roots[0]!.children;
    expect(cases[0]!.status).toBe("passed");
    expect(cases[0]!.durationMs).toBe(12);
    expect(cases[0]!.line).toBe(10);
    const cls = cases[1]!;
    if (cls.kind === "class") {
      expect(cls.children[0]!.status).toBe("failed");
      expect(cls.children[0]!.message).toBe("assert 1 == 2");
      expect(cls.children[0]!.line).toBe(20);
      expect(cls.children[1]!.status).toBe("skipped");
    }
  });

  it("汇总：文件 / 类取最差状态 + 失败计数 + 耗时和", () => {
    const roots = tree();
    applyResults(roots, [
      caseResult("tests/test_api.py::test_ok", "passed", { duration_ms: 10 }),
      caseResult("tests/test_api.py::TestUser::test_bad", "failed", { duration_ms: 20, message: "boom" }),
      caseResult("tests/test_api.py::TestUser::test_skip", "skipped", { duration_ms: 5 }),
    ]);
    const file = roots[0]!;
    expect(file.status).toBe("failed"); // 最差
    expect(file.failedCount).toBe(1);
    expect(file.durationMs).toBe(35);
    const cls = file.children[1]!;
    if (cls.kind === "class") {
      expect(cls.status).toBe("failed");
      expect(cls.failedCount).toBe(1);
      expect(cls.durationMs).toBe(25);
    }
  });

  it("error 比 failed 更差（汇总口径）", () => {
    const roots = buildTestTree(["t.py"], ["t.py::test_a", "t.py::test_b"]);
    applyResults(roots, [
      caseResult("t.py::test_a", "failed"),
      caseResult("t.py::test_b", "error"),
    ]);
    expect(roots[0]!.status).toBe("error");
    expect(roots[0]!.failedCount).toBe(2); // failed + error 都算失败
  });

  it("幂等：同一份 cases 应用两次状态不变", () => {
    const roots = tree();
    const cases = [
      caseResult("tests/test_api.py::test_ok", "passed"),
      caseResult("tests/test_api.py::TestUser::test_bad", "failed"),
      caseResult("tests/test_api.py::TestUser::test_skip", "skipped"),
    ];
    applyResults(roots, cases);
    const snap = JSON.stringify(roots);
    applyResults(roots, cases);
    expect(JSON.stringify(roots)).toBe(snap);
  });

  it("未运行的用例保持 unknown；树里没有的结果不造行", () => {
    const roots = tree();
    applyResults(roots, [caseResult("tests/test_api.py::test_ok", "passed")]);
    const file = roots[0]!;
    // passed + unknown + unknown → unknown（未运行比 skipped 更「未知」，严重度 2 > 1）
    expect(file.status).toBe("unknown");
    const cls = file.children[1]!;
    if (cls.kind === "class") {
      expect(cls.children.every((c) => c.status === "unknown")).toBe(true);
    }
  });

  it("降级匹配：pytest < 6（node_id 无文件前缀）按 name 后缀 + 文件兜底", () => {
    const roots = buildTestTree(["t.py"], ["t.py::test_x"]);
    // Rust 侧对缺 file 属性的老 xml 重建出 "::t::test_x" 形态
    applyResults(roots, [{ node_id: "::t::test_x", status: "failed", duration_ms: 1, message: "m", file: null, line: null }]);
    expect(roots[0]!.children[0]!.status).toBe("failed");
  });

  it("降级匹配歧义（同名多文件）不猜", () => {
    const roots = buildTestTree(["a.py", "b.py"], ["a.py::test_x", "b.py::test_x"]);
    applyResults(roots, [{ node_id: "::x::test_x", status: "failed", duration_ms: 1, message: null, file: null, line: null }]);
    expect(roots[0]!.children[0]!.status).toBe("unknown");
    expect(roots[1]!.children[0]!.status).toBe("unknown");
  });

  it("rollup 单独调用可重算（重建树后重放结果的口径）", () => {
    const roots = buildTestTree(["t.py"], ["t.py::test_a"]);
    const c = roots[0]!.children[0]!;
    c.status = "failed";
    rollup(roots[0]!);
    expect(roots[0]!.status).toBe("failed");
    expect(roots[0]!.failedCount).toBe(1);
  });
});

// ---------- collectFailedIds ----------

describe("collectFailedIds", () => {
  it("只收 failed / error，保树序", () => {
    const roots = buildTestTree(["t.py"], ["t.py::test_a", "t.py::test_b", "t.py::test_c"]);
    applyResults(roots, [
      caseResult("t.py::test_a", "passed"),
      caseResult("t.py::test_b", "error"),
      caseResult("t.py::test_c", "failed"),
    ]);
    expect(collectFailedIds(roots)).toEqual(["t.py::test_b", "t.py::test_c"]);
  });

  it("无失败 → 空（「重跑失败」按钮据此置灰）", () => {
    const roots = buildTestTree(["t.py"], ["t.py::test_a"]);
    applyResults(roots, [caseResult("t.py::test_a", "passed")]);
    expect(collectFailedIds(roots)).toEqual([]);
  });
});

// ---------- scanTestDefs ----------

describe("scanTestDefs", () => {
  it("模块级 def test_* 直接成行", () => {
    const defs = scanTestDefs("import pytest\n\ndef test_a():\n    pass\n\ndef test_b():\n    pass\n");
    expect(defs).toEqual([
      { line: 3, name: "test_a", classPath: [] },
      { line: 6, name: "test_b", classPath: [] },
    ]);
  });

  it("缩进类栈：类内 def 带类路径，async def 也认", () => {
    const src = [
      "class TestUser:",
      "    def test_create(self):",
      "        pass",
      "",
      "class TestInner:",
      "    class TestNested:",
      "        async def test_x(self):",
      "            pass",
    ].join("\n");
    const defs = scanTestDefs(src);
    expect(defs).toEqual([
      { line: 2, name: "test_create", classPath: ["TestUser"] },
      { line: 7, name: "test_x", classPath: ["TestInner", "TestNested"] },
    ]);
  });

  it("函数内嵌 def 排除（pytest 不收集）", () => {
    const src = [
      "def test_outer():",
      "    def test_inner():",
      "        pass",
      "    return test_inner",
    ].join("\n");
    const defs = scanTestDefs(src);
    expect(defs).toEqual([{ line: 1, name: "test_outer", classPath: [] }]);
  });

  it("非 Test 类内的 def 排除（类栈占位挡住外层路径）", () => {
    const src = [
      "class TestA:",
      "    def test_x(self):",
      "        pass",
      "class Helper:",
      "    def test_y(self):",
      "        pass",
    ].join("\n");
    const defs = scanTestDefs(src);
    expect(defs).toEqual([{ line: 2, name: "test_x", classPath: ["TestA"] }]);
  });

  it("同名方法按类路径消歧（两个 Test 类各有一个 test_x）", () => {
    const src = [
      "class TestA:",
      "    def test_x(self):",
      "        pass",
      "class TestB:",
      "    def test_x(self):",
      "        pass",
    ].join("\n");
    const defs = scanTestDefs(src);
    expect(defs.map((d) => buildNodeId("t.py", d.classPath, d.name))).toEqual([
      "t.py::TestA::test_x",
      "t.py::TestB::test_x",
    ]);
  });

  it("非 Test 类整体跳过：其内的 Test 类用例也不收集（pytest python_classes 语义）", () => {
    const src = [
      "class Helper:",
      "    class TestInner:",
      "        def test_x(self):",
      "            pass",
    ].join("\n");
    expect(scanTestDefs(src)).toEqual([]);
  });

  it("非 test_ 函数 / 非 Test 类不产生行", () => {
    const defs = scanTestDefs("def helper():\n    pass\n\nclass Helper:\n    def method(self):\n        pass\n");
    expect(defs).toEqual([]);
  });

  it("CRLF 行尾与行首空白容忍", () => {
    const defs = scanTestDefs("class TestA:\r\n\tdef test_x(self):\r\n\t\tpass\r\n");
    expect(defs).toEqual([{ line: 2, name: "test_x", classPath: ["TestA"] }]);
  });

  it("装饰器行不干扰（parametrize 不展开，箭头跑整个函数）", () => {
    const src = [
      "@pytest.mark.parametrize(\"n\", [1, 2])",
      "def test_p(n):",
      "    assert n > 0",
    ].join("\n");
    const defs = scanTestDefs(src);
    expect(defs).toEqual([{ line: 2, name: "test_p", classPath: [] }]);
  });
});

// ---------- chunkPlan ----------

describe("chunkPlan", () => {
  it("总量不超单帧 → 单帧", () => {
    expect(chunkPlan(100, 300)).toEqual([100]);
  });

  it("整除切分", () => {
    expect(chunkPlan(900, 300)).toEqual([300, 300, 300]);
  });

  it("末帧余数", () => {
    expect(chunkPlan(1000, 300)).toEqual([300, 300, 300, 100]);
    expect(chunkPlan(1, 300)).toEqual([1]);
  });

  it("边界：0 / 负 / 非法帧大小 → 空", () => {
    expect(chunkPlan(0, 300)).toEqual([]);
    expect(chunkPlan(-5, 300)).toEqual([]);
    expect(chunkPlan(100, 0)).toEqual([]);
    expect(chunkPlan(100, -1)).toEqual([]);
  });

  it("2000 节点 fixture 的分帧规模（§10 第 12 项量级）", () => {
    const frames = chunkPlan(2000, 300);
    expect(frames).toEqual([300, 300, 300, 300, 300, 300, 200]);
    expect(frames.reduce((a, b) => a + b, 0)).toBe(2000);
  });
});
