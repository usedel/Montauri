// inlay hints 双源合并 + 跳变治理 B 的光标行冻结（纯函数，P0-A2 同款拆分范式）。
//
// 为什么从 client.ts 拆出：① client.ts 顶层 import invoke/monaco/state，不可单测
//（lspCompletion.ts 拆分时的同一理由）；② 预算红线 lsp_client_ts_max_lines 已压线，
// 增量逻辑按 budgets.toml 注释纪律外拆、不抬阈值。
//
// 跳变治理 B（2026-10-12，用户裁决推翻同日 A 方案的行尾锚定）：inlay 是注入文本，
// 光标视觉列 = 模型列 + 光标前注入文本宽度。变量提示锚在名字后（`req: (url: …) = sess.post`），
// 行尾编辑时一个字符即可令类型塌缩（方法签名 → 返回值），光标前注入宽度瞬间 ±25 字符
// → 光标视觉左跳（Monaco 不补偿）。B 方案保持 PyCharm 式锚位不变，**冻结光标行上
// 「列 ≤ 光标列」的提示**——光标停留期间沿用上次渲染值，光标跨行离开后才应用新值。
// 光标右侧的提示（参数名提示等）不受冻结影响，照常刷新（它们不推动光标视觉位置）。

/** LSP InlayHint 的协议形态（client.ts 的 queryInlays 返回值，label 可能是分段数组） */
export interface LspInlayHint {
  position: { line: number; character: number };
  label: string | Array<{ value: string }>;
  kind?: number; // 1 = Type, 2 = Parameter（pyrefly 实测不回填，判定不依赖它）
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: unknown;
}

/** 协议提示 → 可合并子集（label 拍平 + tooltip 收窄） */
export function toMergeableHint(h: LspInlayHint): MergeableHint {
  return {
    line: h.position.line,
    character: h.position.character,
    label: typeof h.label === "string" ? h.label : h.label.map((p) => p.value).join(""),
    kind: h.kind,
    paddingLeft: h.paddingLeft,
    paddingRight: h.paddingRight,
    tooltip: typeof h.tooltip === "string" ? h.tooltip : undefined,
  };
}

/** 可合并子集（0 基 line/character） */
export interface MergeableHint {
  line: number;
  character: number;
  label: string;
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: string;
}

/** 最终提示（1 基 line/column，Monaco 坐标） */
export interface AnchoredHint {
  line: number;
  column: number;
  label: string;
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
  tooltip?: string;
}

/**
 * 合并 intel（运行时标注）与 static（pyrefly/basedpyright）两源提示。
 * **位置一律引擎原位**（B 方案：不重锚）；两源变量提示均名字后锚定
 *（intel 于 2026-10-14 从行末改锚到 lhs 标识符后，锚位视觉统一）：
 *  - 同位置同文案去重（换引擎/切 intel 期间两源可能短暂并存）；
 *  - intel 行占位：同行静态变量提示（`: ` 前缀）让位——运行时是真实观测值，
 *    且两源同锚后不让位会在同位置并排叠两段文案；
 *  - `: ` 前缀判定静态变量提示（pyrefly 三类提示天然互斥：变量 `: T` / 返回值
 *    `-> T` / 参数名 `a= `）。
 */
export function mergeInlayHints(intel: MergeableHint[], staticHints: MergeableHint[]): AnchoredHint[] {
  const seen = new Set<string>();
  // 类型/返回值提示同行同文必为重复（含引擎邻列漂移：去重键带列会漏，真机双份 `: Response`
  // 实锤）；参数名不参与（同行不同列的同名参数提示合法，如嵌套调用）
  const typeSeen = new Set<string>();
  const dupType = (line: number, label: string): boolean => {
    if (!label.startsWith(": ") && !label.startsWith("-> ")) return false;
    const tk = `${line}:${label}`;
    if (typeSeen.has(tk)) return true;
    typeSeen.add(tk);
    return false;
  };
  const out: AnchoredHint[] = [];
  const push = (h: MergeableHint, line: number, column: number): void => {
    out.push({ line, column, label: h.label, kind: h.kind, paddingLeft: h.paddingLeft, paddingRight: h.paddingRight, tooltip: h.tooltip });
  };
  const intelLines = new Set<number>();
  for (const h of intel) {
    const line = h.line + 1;
    const column = h.character + 1;
    const key = `${line}:${column}:${h.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dupType(line, h.label)) continue;
    intelLines.add(line);
    push(h, line, column);
  }
  for (const h of staticHints) {
    const line = h.line + 1;
    const column = h.character + 1;
    const key = `${line}:${column}:${h.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dupType(line, h.label)) continue;
    if (h.label.startsWith(": ") && intelLines.has(line)) continue; // 运行时优先
    push(h, line, column);
  }
  out.sort((a, b) => a.line - b.line || a.column - b.column);
  return out;
}

// ---------- 光标行冻结（跳变治理 B 的行级变换） ----------

/** 光标位置（1 基，Monaco 坐标） */
export interface CursorInfo {
  line: number;
  column: number;
}

/** 类型提示判定：`: ` 前缀（探针实证的 pyrefly 变量提示形态；参数名 `a= ` / 返回值 `-> ` 不命中） */
function isTypeLabel(label: string): boolean {
  return label.startsWith(": ");
}

/**
 * 位置是否恰在某提示锚点上（1 基）。悬停闪现抑制判定：真机实证鼠标悬停注入文本时
 * monaco 的 target.position 映射 = 提示位置列（非装饰锚列），精确匹配即可。
 */
export function isAtInlayAnchor(hints: AnchoredHint[], line: number, column: number): boolean {
  return hints.some((h) => h.line === line && h.column === column);
}

/**
 * 缓存提示的锚点是否仍有效：列 column 前恰好是一个**完整标识符**的结尾。
 * 复活守卫——行被重写 / 标识符前插漂移后，旧位置渲染幽灵提示比消失更糟：
 * `request` 改写后锚进名字中间（列 8 停在 `requ|est`）必须拒绝。
 */
export function anchorStillValid(lineText: string, column: number): boolean {
  if (column < 2 || lineText.length < column - 1) return false;
  if (!/[A-Za-z_][A-Za-z0-9_]*$/.test(lineText.slice(0, column - 1))) return false;
  const at = lineText[column - 1]; // 列 column 处字符（0 基 column-1）
  return at === undefined || !/[A-Za-z0-9_]/.test(at); // 标识符须恰在此结束（防前插漂移）
}

/**
 * 光标行冻结：fresh 中「光标行上、列 ≤ 冻结边界」的提示，**位置取新值、标签取缓存旧值**。
 *  - 冻结边界 = 该行所有光标的最小列（多光标/分屏取保守值）；
 *  - 配对按类别分池（类型 `: ` / 参数名）后各池按序——不按列对齐：行内前插会令新提示
 *    列漂移，按列配对失配；不分池则「类型提示被引擎丢弃的同一轮新出现的参数提示」
 *    会顶替类型的缓存槽位（类型标签渲染到实参位置）；
 *  - **复活**：未被配对的缓存类型提示，锚点守卫通过则原位回填——引擎对不完整表达式
 *    （`r1 = sess.`）整条丢弃提示时，注入文本消失 = 宽度塌缩 = 光标左跳，与标签变形
 *    同病同治（2026-10-12 用户实案 + 探针实证）。参数名提示不复活：其实时位置语义强，
 *    旧位置渲染 `a= ` 比缺失更误导；
 *  - cached 为 null（首帧 / 行数变化失效）或无光标 → fresh 原引用直通（调用方以
 *    `out !== fresh` 判定冻结是否实际发生）；
 *  - 光标右侧（列 > 边界）照常取 fresh——它们不推动光标视觉位置。
 * 调用方负责缓存写回与失效判定（见 inlayFreeze.ts）。
 */
export function applyCursorFreeze(
  fresh: AnchoredHint[],
  cached: AnchoredHint[] | null,
  cursors: CursorInfo[],
  lineTextOf: (line: number) => string,
): AnchoredHint[] {
  if (!cached || cursors.length === 0) return fresh;
  // 行 → 冻结边界列（该行所有光标的最小列）
  const freezeAt = new Map<number, number>();
  for (const c of cursors) {
    const prev = freezeAt.get(c.line);
    if (prev === undefined || c.column < prev) freezeAt.set(c.line, c.column);
  }
  // 缓存冻结区分池（fresh/cached 均已按 (line, column) 排序，分组后保序）
  const cachedTypes = new Map<number, AnchoredHint[]>();
  const cachedParams = new Map<number, AnchoredHint[]>();
  for (const h of cached) {
    const bound = freezeAt.get(h.line);
    if (bound === undefined || h.column > bound) continue;
    const pool = isTypeLabel(h.label) ? cachedTypes : cachedParams;
    const arr = pool.get(h.line);
    if (arr) arr.push(h);
    else pool.set(h.line, [h]);
  }
  const typeIdx = new Map<number, number>();
  const paramIdx = new Map<number, number>();
  const out: AnchoredHint[] = [];
  for (const h of fresh) {
    const bound = freezeAt.get(h.line);
    if (bound === undefined || h.column > bound) {
      out.push(h); // 非光标行 / 光标右侧 → 新值
      continue;
    }
    const isType = isTypeLabel(h.label);
    const pool = (isType ? cachedTypes : cachedParams).get(h.line);
    const idx = isType ? typeIdx : paramIdx;
    const i = idx.get(h.line) ?? 0;
    idx.set(h.line, i + 1);
    const paired = pool?.[i];
    // 冻结区：位置/间距取新值（跟随代码漂移），标签与 tooltip 取缓存（视觉零跳变）
    out.push(paired ? { ...h, label: paired.label, kind: paired.kind, tooltip: paired.tooltip } : h);
  }
  // 复活：未被配对的缓存类型提示，锚点仍有效 → 原位回填（防「消失型」光标跳变）
  let revived = false;
  for (const [line, pool] of cachedTypes) {
    const used = typeIdx.get(line) ?? 0;
    if (used >= pool.length) continue;
    const text = lineTextOf(line);
    for (let i = used; i < pool.length; i++) {
      if (!anchorStillValid(text, pool[i].column)) continue; // 行被重写 → 放弃，宁缺勿错
      // 复活去重（2026-10-15 真机实案）：池内历史副本若同列或同文已有输出则跳过——
      // 否则「配对消耗一条 + 复活回填一条」令双份每轮化石重生
      if (out.some((o) => o.line === pool[i].line && (o.column === pool[i].column || o.label === pool[i].label))) continue;
      out.push(pool[i]);
      revived = true;
    }
  }
  if (revived) out.sort((a, b) => a.line - b.line || a.column - b.column);
  return out; // 无复活时 fresh 有序 + 逐项映射保序 → 无需重排
}
