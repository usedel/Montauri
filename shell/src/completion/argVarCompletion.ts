// 实参位作用域变量融合（运行前补全，FUSION-1；计划真源 docs/arg_var_fusion_dev_plan.md）。
// 背景（计划 §0）：pyrefly 空前缀只回参数名 + Monaco 完整列表不重请求 = 变量候选永远不可见，
// 融合层接上断路。v2 类型匹配（计划 §5）：hover 注入取 `(variable) name: TYPE`（E7），
// 参数期望类型取 param label `: TYPE` 段；tier 0 类型+亲和/1 类型/2 亲和/3 近远；
// 匹配三层（基础相等 / Literal 归一 / 全限定末段）。
// 边界（§7）：嵌套函数不透外层；解包/with/海象不收；子类/协议/泛型不做。
// 零 monaco / 零 tauri 依赖，可直接单测（形态同 lspCompletion.ts）。

/** signatureHelp 结果的最小同构形态（不 import client.ts 的内部类型） */
export interface SigHelpLike {
  signatures?: Array<{
    label: string;
    parameters?: Array<{ label: string | [number, number] }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

/** hover 查询注入（client.ts 接线：引擎 LSP 请求；单测传 stub）。返回 hover 原文或 null */
export type HoverQuery = (line0: number, char0: number) => Promise<string | null>;

export interface ArgVarCandidate {
  name: string;
  /** 展示文案（含匹配类型时带类型，i18n 纳管见计划 §4-3） */
  detail: string;
  /** 排序 tier（计划 §5.3）：0 类型+亲和 / 1 类型 / 2 亲和 / 3 近远 */
  tier: number;
  /** ghost 扩展后缀（计划 §1.2）：非末参数位 ", <名>=<默认值>)"、末位 ")"——augmentation
   *  要求 inline 项比下拉选中项更长，且须以 ")" 收尾才渲染（详见 matchArgVars 注释） */
  ghostSuffix: string;
}

/** 参数 label（"url: str" 或偏移对）→ 参数名（剥注解/默认值；偏移形式从签名 label 切片） */
function paramLabelName(sig: { label: string }, p: { label: string | [number, number] }): string {
  if (typeof p.label === "string") return p.label.split(":")[0].split("=")[0].trim();
  const [s, e] = p.label;
  return sig.label.slice(s, e).split(":")[0].split("=")[0].trim();
}

/** 参数 label → 期望类型注解（`url: str` / `timeout: int = 10` → `str`/`int`；无注解/Any/联合 → null） */
function paramLabelType(sig: { label: string }, p: { label: string | [number, number] }): string | null {
  const raw = typeof p.label === "string" ? p.label : sig.label.slice(p.label[0], p.label[1]);
  const m = /:\s*([^=]+?)(?:\s*=\s*.*)?$/.exec(raw.trim());
  const t = m?.[1].trim();
  if (!t || t === "Any" || t.includes("|") || t.startsWith("*")) return null;
  return t;
}

/** ghost 扩展后缀（计划 §1.2）：非末参数位 ", <名>=<默认值>)"，末位 ")"（实测后缀必须以 ")"
 *  收尾才渲染——详见 matchArgVars 内注释）。默认值剥自 param label，无则 "..." 占位。 */
function ghostSuffixFor(s: { label: string; parameters?: Array<{ label: string | [number, number] }> }, idx: number): string {
  const ps = s.parameters ?? [];
  if (idx + 1 >= ps.length) return ")";
  const p = ps[idx + 1];
  const raw = typeof p.label === "string" ? p.label : s.label.slice(p.label[0], p.label[1]);
  const eq = raw.indexOf("=");
  return `, ${paramLabelName(s, p)}=${eq >= 0 ? raw.slice(eq + 1).trim() : "..."})`;
}

/** hover 原文 → 类型字符串（计划 E7 形态 `(variable) name: TYPE`，markdown 代码块内）。
 *  解析失败返回 null（静默降级 v1 排序，计划 §5.4）。 */
export function parseHoverType(hover: string | null): string | null {
  if (!hover) return null;
  const m = /\(variable\)\s+\w+\s*:\s*(.+)/.exec(hover);
  if (!m) return null;
  return m[1].trim() || null;
}

/** 类型归一（计划 §5.3 三层匹配的前处理）：
 *  Literal[42]→int · Literal['x']→str（窄赋宽合法）· 全限定路径取末段 · 其余原样 */
export function normalizeType(t: string): string {
  const lit = /^Literal\[\s*(['"]).*?\1\s*\]$/.exec(t);
  if (lit) return "str";
  if (/^Literal\[\s*-?\d+\s*\]$/.test(t)) return "int";
  if (t.includes(".")) return t.split(".").pop()!.trim();
  return t.trim();
}

/** 类型匹配三层判定（保守）：基础严格相等 / Literal 归一后相等 / 末段相等 */
function typeMatches(varType: string, paramType: string): boolean {
  const v = normalizeType(varType);
  const p = normalizeType(paramType);
  return v === p;
}

/**
 * 极简作用域变量枚举：从光标行（0-based）向上扫，遇第一个 `def` 收形参后停、
 * 遇 `class` 停。收集：赋值 LHS（含 `: type =` 形态）/ for 循环变量 / def 形参。
 * 返回顺序 = 近 → 远（去重保最近出现）。
 */
export function scopeVarNames(lines: string[], cursorLine: number): string[] {
  const names: string[] = [];
  const ident = /^[A-Za-z_]\w*$/;
  const start = Math.min(cursorLine, lines.length) - 1; // 光标行自身不算（正在写的调用行）
  for (let i = start; i >= 0; i--) {
    const l = lines[i];
    const defM = /^(\s*)(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/.exec(l);
    if (defM) {
      for (const part of defM[2].split(",")) {
        const name = part.split(":")[0].split("=")[0].trim().replace(/^\*+/, "").replace(/=$/, "");
        if (ident.test(name)) names.push(name);
      }
      break; // 当前函数边界：外层局部变量不泄漏
    }
    if (/^\s*class\s+\w+/.test(l)) break;
    const forM = /^\s*(?:async\s+)?for\s+([\w\s,]+)\s+in\b/.exec(l);
    if (forM) {
      for (const n of forM[1].split(",")) {
        const t = n.trim();
        if (ident.test(t)) names.push(t);
      }
      continue;
    }
    const asgM = /^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/.exec(l);
    if (asgM) names.push(asgM[1]);
  }
  return [...new Set(names)];
}

/** 变量赋值行查找（hover 定位用）：向上找最近一次 `name =` / `name: t =` / for / def 形参行，
 *  返回 [行号, 列号]（0-based，指向名字首字符）。找不到 null。 */
function varDefPos(lines: string[], name: string, cursorLine: number): [number, number] | null {
  const start = Math.min(cursorLine, lines.length) - 1;
  for (let i = start; i >= 0; i--) {
    const l = lines[i];
    const asgM = new RegExp(`^\\s*(${name})\\s*(?::[^=]+)?=(?!=)`).exec(l);
    if (asgM) return [i, l.indexOf(name)];
    const forM = new RegExp(`^\\s*(?:async\\s+)?for\\s+.*\\b(${name})\\b\\s*[,:]?`).exec(l);
    if (forM) return [i, l.indexOf(name)];
    const defM = new RegExp(`^\\s*(?:async\\s+)?def\\s+\\w+\\s*\\(.*\\b(${name})\\b`).exec(l);
    if (defM) return [i, l.indexOf(name)];
  }
  return null;
}

/** 实参位变量匹配（v2，计划 §5）：目标参数 + 作用域变量 + 前缀过滤 + 类型/亲和双层排序。
 *  hoverQuery 为 null 时降级 v1。返回空 = 非实参位/无签名/无匹配（调用方行为零变化）。 */
export async function matchArgVars(
  sig: SigHelpLike | null,
  lines: string[],
  cursorLine: number,
  prefix: string,
  hoverQuery?: HoverQuery | null,
): Promise<ArgVarCandidate[]> {
  if (!sig?.signatures?.length) return [];
  const s = sig.signatures[sig.activeSignature ?? 0] ?? sig.signatures[0];
  const idx = sig.activeParameter ?? 0;
  const p = s.parameters?.[idx];
  if (!p) return [];
  const paramName = paramLabelName(s, p);
  if (!paramName || paramName === "*" || paramName === "**") return [];
  const paramType = paramLabelType(s, p);
  const lower = prefix.toLowerCase();
  const out: ArgVarCandidate[] = [];
  const useType = !!hoverQuery && !!paramType;
  // ghost 扩展后缀（计划 §1.2）：⚠ 必须以 ")" 收尾才渲染——autoClosingBrackets 的 ")" 是
  // lineSuffix，后缀含 ")" 时公共后缀被剥、diff 变纯插入；不含则 diff 含替换性 change，
  // computeGhostText 返回 undefined（实测 `,`/`, `/`, timeout=` 全不渲染，`, timeout=10)` 渲染）。
  const suffix = ghostSuffixFor(s, idx);
  for (const name of scopeVarNames(lines, cursorLine)) {
    if (lower && !name.toLowerCase().startsWith(lower)) continue;
    let tier = 3; // 基线近远序
    let detail = `匹配参数 ${paramName}`;
    if (name.toLowerCase().includes(paramName.toLowerCase())) tier = 2;
    if (useType) {
      const pos = varDefPos(lines, name, cursorLine);
      const hover = pos ? await hoverQuery!(pos[0], pos[1]).catch(() => null) : null;
      const varType = parseHoverType(hover);
      if (varType && paramType && typeMatches(varType, paramType)) {
        tier = tier === 2 ? 0 : 1; // 类型命中：亲和升 tier0，无亲和 tier1
        detail = `匹配参数 ${paramName} · ${normalizeType(varType)}`;
      }
    }
    out.push({ name, detail, tier, ghostSuffix: suffix });
  }
  if (!out.length) return [];
  // tier 升序（0 最优）；同 tier 保持 scopeVarNames 天然近远序（sort 稳定）
  out.sort((a, b) => a.tier - b.tier);
  return out;
}

/** 融合层总入口（client.ts 唯一调用点）：文档文本 + 光标（0-based 行 / 1-based 列，Monaco 口径）
 *  + 签名 + hover 注入 → 匹配变量。前缀 = 光标列往前到词首（字符级判定标识符）。 */
export async function computeArgVarsForPosition(
  sig: SigHelpLike | null,
  text: string,
  cursorLine0: number,
  cursorColumn1: number,
  hoverQuery?: HoverQuery | null,
): Promise<ArgVarCandidate[]> {
  const lines = text.split("\n");
  const line = lines[cursorLine0] ?? "";
  let end = cursorColumn1 - 1;
  let start = end;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) start--;
  const prefix = line.slice(start, end);
  return matchArgVars(sig, lines, cursorLine0, prefix, hoverQuery);
}

/** 融合变量 → Monaco 补全项（static 段头部 `2 20x`，恒排 pyrefly 参数名之前）。
 *  kind / range 以参数注入（本模块零 monaco 依赖；同 lspCompletion.ts 的映射函数形态）。 */
export function argVarToSuggestions<T>(
  vars: ArgVarCandidate[],
  range: T,
  variableKind: number,
): Array<{ label: string; kind: number; insertText: string; detail: string; sortText: string; range: T }> {
  return vars.map((v, i) => ({
    label: v.name,
    kind: variableKind,
    insertText: v.name,
    detail: v.detail,
    sortText: "2" + String(200 + i).padStart(3, "0"),
    range,
  }));
}
