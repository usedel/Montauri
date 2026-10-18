// pytest 测试树纯函数层（docs/pytest_dev_plan.md §3.3/§3.4/§3.6/§3.10）。
//
// 分层惯例同 selectorCore / epSampleCore：**零 app / monaco / termUi 依赖**——只依赖
// 纯 TS，vitest 可直接 import。树形构建、静态扫描、状态合入、分帧计划全部在这里做
// 纯函数，接线层（testView / testRun / testGutter）只搬数据。
//
// 三段式数据流（计划 §3.2）：
//   ① scan 文件骨架  → buildTestTree(files)（仅文件行，首帧立即可见）
//   ② collect 增强   → buildTestTree(files, nodes)（用例子节点进骨架）
//   ③ result 合入    → applyResults(roots, cases)（按 node_id 匹配，汇总向上）

// ---------- 类型 ----------

/** 用例状态五档 + unknown（未运行）。xfail 在 Rust 侧已归 skipped 档（呈现口径）。 */
export type TestStatus = "unknown" | "passed" | "failed" | "error" | "skipped";

/** 用例子节点（树最内层；parametrize 的 `[1-2]` 后缀保留在 name 里） */
export interface TestCaseNode {
  kind: "case";
  /** node id（`file::Class::test[param]`；全树唯一） */
  id: string;
  /** 显示名（函数名 + parametrize id） */
  name: string;
  /** 相对工作区根的路径（正斜杠） */
  file: string;
  /** def 行号（1 基；collect 输出不含行号，静态扫描或 junitxml 兜底，可空） */
  line: number | null;
  status: TestStatus;
  durationMs: number | null;
  /** 失败 / 错误消息（tooltip 展示；Rust 侧已截断到 2000 字符） */
  message: string | null;
}

/** 文件 / 类分组节点（status 为子孙汇总，failedCount 为失败+错误计数） */
export interface TestGroupNode {
  kind: "file" | "class";
  id: string;
  name: string;
  file: string;
  line: number | null;
  children: TestTreeNode[];
  status: TestStatus;
  failedCount: number;
  durationMs: number | null;
  message: string | null;
}

export type TestTreeNode = TestGroupNode | TestCaseNode;

/** 单个 junitxml 用例结果（Rust pytest_action(result) 的 cases 元素） */
export interface TestCaseResult {
  node_id: string;
  status: TestStatus;
  duration_ms: number | null;
  message: string | null;
  file: string | null;
  line: number | null;
}

// ---------- 判定与构造 ----------

/** 测试文件名判定（默认命名模式 test_*.py / *_test.py；与 Rust is_test_file_name 同口径）。
 *  自定义 python_files 的非常规命名由 collect 结果补齐（两段式）。 */
export function isTestFileName(name: string): boolean {
  const base = name.slice(name.lastIndexOf("/") + 1);
  if (!base.endsWith(".py")) return false;
  const stem = base.slice(0, -3);
  return stem.startsWith("test_") || stem.endsWith("_test");
}

/** 拼 node id：`file::Class::…::test`（类路径逐段 :: 连接）。 */
export function buildNodeId(file: string, classPath: readonly string[], name: string): string {
  return [file, ...classPath, name].join("::");
}

/** 类分组节点 id：`file::Class::…`（无末段——与用例 id 的差别只在尾部，单测钉死）。 */
export function classGroupId(file: string, classPath: readonly string[]): string {
  return [file, ...classPath].join("::");
}

/** 拆 node id → { file, classPath, name }（parametrize 后缀留在 name 里）。
 *  与 buildNodeId 互为逆运算（类名不含 :: 时严格可逆）。 */
export function splitNodeId(nodeId: string): { file: string; classPath: string[]; name: string } {
  const parts = nodeId.split("::");
  const file = parts[0] ?? "";
  const name = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const classPath = parts.slice(1, Math.max(1, parts.length - 1));
  return { file, classPath, name };
}

/** 从 collect 的 node id 取显示名（最后一段；类路径不显示在用例行上）。 */
export function caseDisplayName(nodeId: string): string {
  return splitNodeId(nodeId).name || nodeId;
}

// ---------- 树构建 ----------

function fileGroup(file: string): TestGroupNode {
  return {
    kind: "file",
    id: file,
    name: file.slice(file.lastIndexOf("/") + 1),
    file,
    line: null,
    children: [],
    status: "unknown",
    failedCount: 0,
    durationMs: null,
    message: null,
  };
}

function classGroup(file: string, classPath: readonly string[]): TestGroupNode {
  const name = classPath[classPath.length - 1] ?? "";
  return {
    kind: "class",
    id: classGroupId(file, classPath),
    name,
    file,
    line: null,
    children: [],
    status: "unknown",
    failedCount: 0,
    durationMs: null,
    message: null,
  };
}

/**
 * 构建测试树。两段式（计划 §3.2）：
 * - `nodes` 为空 → 仅文件级骨架（scan 先行渲染，不依赖 collect）；
 * - `nodes` 非空 → 用例子节点进 `files` 骨架；collect 收到的**不在** files 里的文件
 *   （自定义 python_files 非常规命名）追加到末尾（保收集序）。
 * - `pruneEmptyFiles`（仅 collect 成功路径置 true）→ 剔除零用例的骨架文件行：
 *   pytest 真没收到的文件不该长期占位——scan 剪枝名单的漏网点（如用户现场
 *   smbter/venv 内三方包自带 test_*.py）与「文件存在但 pytest 未收集」同理。
 *   默认 false 保留骨架语义：collect 失败 / 取消 / 未安装时树仍可见。
 *   注意自定义 python_files 的追加文件不受影响（它们自带 case，不会零用例）。
 * 展开态与状态由调用方持有（buildTestTree 之后 applyResults 重放），本函数只管结构。
 */
export function buildTestTree(
  files: readonly string[],
  nodes: readonly string[] = [],
  pruneEmptyFiles = false,
): TestGroupNode[] {
  const byFile = new Map<string, TestGroupNode>();
  const roots: TestGroupNode[] = [];
  const ensureFile = (file: string): TestGroupNode => {
    let g = byFile.get(file);
    if (!g) {
      g = fileGroup(file);
      byFile.set(file, g);
      roots.push(g);
    }
    return g;
  };
  for (const f of files) ensureFile(f);
  if (nodes.length === 0) return roots;

  for (const nodeId of nodes) {
    const { file, classPath, name } = splitNodeId(nodeId);
    if (!file || !name) continue; // 畸形 node id 跳过（防脏数据撑爆树）
    const group = ensureFile(file);
    // 类路径逐层下沉（嵌套类天然支持）
    let parent: TestGroupNode = group;
    for (let i = 0; i < classPath.length; i++) {
      const clsId = classGroupId(file, classPath.slice(0, i + 1));
      let child = parent.children.find((c) => c.kind === "class" && c.id === clsId) as TestGroupNode | undefined;
      if (!child) {
        child = classGroup(file, classPath.slice(0, i + 1));
        parent.children.push(child);
      }
      parent = child;
    }
    if (parent.children.some((c) => c.kind === "case" && c.id === nodeId)) continue; // 去重
    parent.children.push({
      kind: "case",
      id: nodeId,
      name,
      file,
      line: null,
      status: "unknown",
      durationMs: null,
      message: null,
    });
  }
  return pruneEmptyFiles ? roots.filter((r) => r.children.length > 0) : roots;
}

// ---------- 结果合入 ----------

/** 状态严重度（汇总取最差）：passed < skipped < unknown < failed < error。 */
const SEVERITY: Record<TestStatus, number> = {
  passed: 0,
  skipped: 1,
  unknown: 2,
  failed: 3,
  error: 4,
};

/**
 * 把 junitxml 结果合入树（**就地**、幂等）：按 node_id 精确匹配用例行；
 * 匹配不上的走降级匹配（pytest < 6 无 file 属性时 node_id 不带文件前缀——
 * 计划 §3.6 防线 ④：按 name 后缀 + 文件一致兜底，行号由 junitxml / 静态扫描补）。
 * 文件 / 类节点同步汇总（最差状态 + 失败计数 + 耗时和）。
 *
 * 就地改是为了视图「只切 class 与计数文本、不重建 DOM」（§3.10）——返回同一引用，
 * 同一份 cases 重复应用结果不变（幂等）。
 */
export function applyResults(roots: readonly TestGroupNode[], cases: readonly TestCaseResult[]): void {
  // 建索引：node_id → 用例节点（一次遍历）
  const index = new Map<string, TestCaseNode>();
  const walk = (nodes: readonly TestTreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === "case") index.set(n.id, n);
      else walk(n.children);
    }
  };
  for (const r of roots) walk(r.children);

  for (const c of cases) {
    let target = index.get(c.node_id) ?? null;
    if (!target) target = degradedMatch(index, c);
    if (!target) continue; // 树里没有这个用例（如只跑了子集）——不造行
    target.status = c.status;
    target.durationMs = c.duration_ms ?? null;
    target.message = c.message ?? null;
    if (c.line != null) target.line = c.line;
  }
  for (const r of roots) rollup(r);
}

/** 降级匹配：node_id 精确匹配失败时（pytest < 6 的 classname 形态），
 *  找 id 以 `::name` 结尾且文件一致（或结果无 file 信息）的**唯一**用例。 */
function degradedMatch(index: Map<string, TestCaseNode>, c: TestCaseResult): TestCaseNode | null {
  const { name } = splitNodeId(c.node_id);
  if (!name) return null;
  const suffix = `::${name}`;
  const hits: TestCaseNode[] = [];
  for (const node of index.values()) {
    if (!node.id.endsWith(suffix)) continue;
    if (c.file && node.file !== c.file) continue;
    hits.push(node);
    if (hits.length > 1) return null; // 歧义不猜（同名多文件时静默跳过）
  }
  return hits[0] ?? null;
}

/** 自底向上汇总：status = 子孙最差；failedCount = failed+error 计数；耗时求和。 */
export function rollup(node: TestGroupNode): void {
  let worst: TestStatus = "unknown";
  let failed = 0;
  let duration = 0;
  let hasDuration = false;
  let message: string | null = null;
  for (const c of node.children) {
    if (c.kind === "case") {
      if (SEVERITY[c.status] > SEVERITY[worst]) {
        worst = c.status;
        if (c.status === "failed" || c.status === "error") message = c.message;
      }
      if (c.status === "failed" || c.status === "error") failed++;
      if (c.durationMs != null) {
        duration += c.durationMs;
        hasDuration = true;
      }
    } else {
      rollup(c);
      if (SEVERITY[c.status] > SEVERITY[worst]) {
        worst = c.status;
        message = c.message;
      }
      failed += c.failedCount;
      if (c.durationMs != null) {
        duration += c.durationMs;
        hasDuration = true;
      }
    }
  }
  node.status = worst;
  node.failedCount = failed;
  node.durationMs = hasDuration ? duration : null;
  node.message = message;
}

/** 收集全部失败 / 错误用例的 node id（「重跑失败」一次调用传多个，§3.5）。 */
export function collectFailedIds(roots: readonly TestGroupNode[]): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly TestTreeNode[]): void => {
    for (const n of nodes) {
      if (n.kind === "case") {
        if (n.status === "failed" || n.status === "error") out.push(n.id);
      } else {
        walk(n.children);
      }
    }
  };
  for (const r of roots) walk(r.children);
  return out;
}

/** 全部用例数（骨架阶段 = 0；collect 后为真实值）。 */
export function countCases(roots: readonly TestGroupNode[]): number {
  let n = 0;
  const walk = (nodes: readonly TestTreeNode[]): void => {
    for (const x of nodes) {
      if (x.kind === "case") n++;
      else walk(x.children);
    }
  };
  for (const r of roots) walk(r.children);
  return n;
}

// ---------- 编辑器静态扫描（绿箭头数据源，§3.4） ----------

/** scanTestDefs 的单条结果：def 行 + 类路径（就地拼 node id 用）。 */
export interface TestDef {
  /** 1 基行号 */
  line: number;
  /** 函数名（parametrize 不展开——箭头跑整个函数） */
  name: string;
  /** 外层类路径（模块级 = 空数组） */
  classPath: string[];
}

interface BlockEntry {
  kind: "class" | "def";
  indent: number;
  name: string;
  /** 类是否匹配 pytest 默认 python_classes（Test*）；非 Test 类整体不被收集 */
  test: boolean;
}

/**
 * 静态扫描测试定义（绿箭头数据源，§3.4）：识别 `def test_*` / `class Test*` 行，
 * 按缩进维护块栈就地拼类路径。
 *
 * 口径（与 runGutter「正则漏检只是没有图标」同款）：
 * - 只收 pytest 会收集的 def：**外层作用域必须是模块或类，且每条外层类都匹配 Test***
 *   （pytest 的 python_classes 默认 `Test*`——非 Test 类整体跳过，其内 def 不收集）；
 * - 函数内嵌 def 同样排除（pytest 不收集函数内嵌 def，报了也跑不了）；
 * - 装饰器行 / 注释 / 多行签名不特殊处理（`def test_x(` 跨行时只认首行）。
 */
export function scanTestDefs(text: string): TestDef[] {
  const out: TestDef[] = [];
  const stack: BlockEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).trimEnd();
    const m = /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/.exec(line);
    if (!m) continue;
    const indent = (m[1] as string).length;
    const kind = m[2] as "def" | "class";
    const name = m[3] as string;
    while (stack.length > 0 && (stack[stack.length - 1] as BlockEntry).indent >= indent) stack.pop();
    if (kind === "class") {
      stack.push({ kind: "class", indent, name, test: name.startsWith("Test") });
      continue;
    }
    // def：只有「无函数外层 + 全部外层类均匹配 Test*」的 test_* 才是 pytest 用例
    const classes = stack.filter((e) => e.kind === "class");
    if (name.startsWith("test_") && !stack.some((e) => e.kind === "def") && classes.every((e) => e.test)) {
      out.push({
        line: i + 1,
        name,
        classPath: classes.map((e) => e.name),
      });
    }
    stack.push({ kind: "def", indent, name, test: false });
  }
  return out;
}

// ---------- 分帧渲染计划（§3.10 大树不卡死） ----------

/**
 * 分帧计划：把 total 个节点切成若干帧，每帧最多 maxPerFrame 个（末帧余数）。
 * 纯函数化供单测直钉（帧大小与边界）；渲染侧按返回的数组逐帧 rAF/setTimeout。
 * total <= maxPerFrame → 单帧（[total]）；total = 0 → 空数组（无帧可排）。
 */
export function chunkPlan(total: number, maxPerFrame: number): number[] {
  if (total <= 0 || maxPerFrame <= 0) return [];
  const frames: number[] = [];
  let left = total;
  while (left > 0) {
    const take = Math.min(maxPerFrame, left);
    frames.push(take);
    left -= take;
  }
  return frames;
}
