// 格式串工具纯函数层（库特别支持 PR-3，docs/python_library_support_dev_plan.md §5）。
// 三类码表（strftime / 格式规范 mini-language / logging %(…)s）+ 分段解释 + 未知码判定。
// 离线可用（分段与码表），预览真值走求值桥 format_preview（不做 JS 近似，口径统一 §5-降级）。

import { buildCodeMask, parsePyStringLiteral, unescapePythonString, type PyStringLiteral } from "./libRegex";

// ---------- 模式 ----------

export type FormatMode = "strftime" | "format" | "logging";

export interface FormatToken {
  /** 分段文本（格式串值内） */
  text: string;
  /** 位置（格式串值内偏移；点击段 → 模式框内选中） */
  pos: number;
  length: number;
  desc: string;
  /** 未知码（诊断 warning；不臆测意图，只提示常见码） */
  unknown?: boolean;
}

// ---------- 码表 ----------

/** strftime 指令表（值 = 人话说明） */
export const STRFTIME_CODES: Record<string, string> = {
  Y: "四位年份",
  y: "两位年份",
  m: "两位月份 (01-12)",
  d: "两位日期 (01-31)",
  H: "24 小时制小时 (00-23)",
  I: "12 小时制小时 (01-12)",
  M: "分钟 (00-59)",
  S: "秒 (00-59)",
  f: "微秒 (6 位)",
  a: "星期缩写",
  A: "星期全名",
  b: "月份缩写",
  B: "月份全名",
  p: "AM / PM",
  j: "年内天数 (001-366)",
  U: "周号（周日为一周开始）",
  W: "周号（周一为一周开始）",
  w: "星期数字 (0=周日)",
  u: "ISO 星期 (1=周一)",
  G: "ISO 周年份",
  V: "ISO 周号",
  z: "UTC 偏移 (+0800)",
  Z: "时区名",
  c: "完整日期时间",
  x: "本地日期",
  X: "本地时间",
  "%": "字面量 %",
};

/** 速查 chips 顺序（按使用频率，%Y %m %d %H %M %S 在前，§11.4） */
export const STRFTIME_CHIP_ORDER = ["Y", "m", "d", "H", "M", "S", "y", "a", "b", "B", "p", "z", "j", "f", "A", "w", "%"];

/** logging 记录字段表 */
export const LOGGING_FIELDS: Record<string, string> = {
  asctime: "时间（默认 2026-09-27 10:30:15,123）",
  levelname: "级别名 (INFO / WARNING …)",
  levelno: "级别数字",
  name: "logger 名",
  message: "日志消息",
  module: "模块名 (不含 .py)",
  filename: "文件名",
  pathname: "文件完整路径",
  lineno: "行号",
  funcName: "函数名",
  msecs: "毫秒部分",
  thread: "线程 id",
  threadName: "线程名",
  process: "进程 id",
  processName: "进程名",
  created: "时间戳 (秒)",
};

/** logging 速查 chips（按频率，§11.4） */
export const LOGGING_CHIP_ORDER = ["asctime", "levelname", "name", "message", "module", "lineno", "funcName", "pathname"];

/** 格式规范类型字符表 */
const FORMAT_TYPES: Record<string, string> = {
  s: "字符串 (str)",
  d: "十进制整数",
  b: "二进制",
  o: "八进制",
  x: "十六进制小写",
  X: "十六进制大写",
  e: "科学计数 (小写 e)",
  E: "科学计数 (大写 E)",
  f: "定点小数",
  F: "定点小数 (inf/nan 大写)",
  g: "通用 (整数用 d，否则 e)",
  G: "通用 (大写 E)",
  n: "本地化数字",
  "%": "百分比 (×100 后接 %)",
};

/** 格式规范速查 chips（按频率） */
export const FORMAT_CHIP_ORDER = [".2f", "d", "s", ">10", "^10", "<10", ",", ".0%", "+.1e", "08.3f"];

// ---------- 分段解释 ----------

/** strftime：%X 指令分段（%% 字面量；未知码 → unknown） */
function tokenizeStrftime(fmt: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  let i = 0;
  let plainStart = 0;
  const flushPlain = (end: number): void => {
    if (end > plainStart) tokens.push({ text: fmt.slice(plainStart, end), pos: plainStart, length: end - plainStart, desc: "字面量" });
  };
  while (i < fmt.length) {
    if (fmt[i] !== "%") {
      i++;
      continue;
    }
    flushPlain(i);
    const next = fmt[i + 1];
    if (next === undefined) {
      tokens.push({ text: "%", pos: i, length: 1, desc: "悬空 %（后面没有格式码）", unknown: true });
      i++;
      plainStart = i;
      continue;
    }
    const desc = STRFTIME_CODES[next];
    tokens.push({ text: fmt.slice(i, i + 2), pos: i, length: 2, desc: desc ?? `未知格式码 %${next}`, unknown: desc === undefined });
    i += 2;
    plainStart = i;
  }
  flushPlain(fmt.length);
  return tokens;
}

/** logging：%(field)char 分段（%% 字面量；未知字段 → unknown） */
function tokenizeLogging(fmt: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  const re = /%\((\w+)\)([sdfg])/g;
  let i = 0;
  let plainStart = 0;
  for (const m of fmt.matchAll(re)) {
    const idx = m.index;
    if (idx > plainStart) tokens.push({ text: fmt.slice(plainStart, idx), pos: plainStart, length: idx - plainStart, desc: "字面量" });
    // 段内混入裸 % 字面量提示
    const field = m[1];
    const desc = LOGGING_FIELDS[field];
    tokens.push({
      text: m[0],
      pos: idx,
      length: m[0].length,
      desc: desc ?? `未知记录字段 "${field}"（logging 只认 LogRecord 已有字段）`,
      unknown: desc === undefined,
    });
    i = idx + m[0].length;
    plainStart = i;
  }
  if (plainStart < fmt.length) tokens.push({ text: fmt.slice(plainStart), pos: plainStart, length: fmt.length - plainStart, desc: "字面量" });
  return tokens;
}

/**
 * 格式规范分段：模板里的 {field!conv:spec} 逐段展开；
 * spec 语法 [[fill]align][sign][#][0][width][,][.precision][type]，未知 type → unknown。
 * 单独的 spec（无 {}，如面板直接输入 ">10,.2f"）也按 spec 解析。
 */
function tokenizeFormat(fmt: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  const hasBraces = fmt.includes("{");
  let plainStart = 0;
  const flushPlain = (end: number): void => {
    if (end > plainStart) tokens.push({ text: fmt.slice(plainStart, end), pos: plainStart, length: end - plainStart, desc: "字面量" });
  };
  // 纯 spec 输入（无 {}，如面板直接输入 ">10,.2f"）：整体按 spec 解析
  if (!hasBraces) {
    const parts = parseSpec(fmt);
    tokens.push({
      text: fmt,
      pos: 0,
      length: fmt.length,
      desc: parts.unknownType ? `未知格式类型 "${parts.type}"（常见：d f s e %）` : specPartsDesc(parts) || "默认格式",
      unknown: parts.unknownType,
    });
    return tokens;
  }
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i];
    if (c === "{" && fmt[i + 1] === "{") {
      flushPlain(i);
      tokens.push({ text: "{{", pos: i, length: 2, desc: "字面量 {" });
      i += 2;
      plainStart = i;
      continue;
    }
    if (c === "}" && fmt[i + 1] === "}") {
      flushPlain(i);
      tokens.push({ text: "}}", pos: i, length: 2, desc: "字面量 }" });
      i += 2;
      plainStart = i;
      continue;
    }
    if (c !== "{") {
      i++;
      continue;
    }
    const close = fmt.indexOf("}", i);
    if (close < 0) {
      flushPlain(i);
      tokens.push({ text: fmt.slice(i), pos: i, length: fmt.length - i, desc: "未闭合的 {", unknown: true });
      return tokens;
    }
    flushPlain(i);
    const field = fmt.slice(i, close + 1);
    const colon = field.indexOf(":");
    const spec = colon >= 0 ? field.slice(colon + 1, field.length - 1) : "";
    const convMatch = /^[^!]*!([rsa])/.exec(field);
    const head: string[] = [];
    const name = colon >= 0 ? field.slice(1, colon) : field.slice(1, field.length - 1);
    if (name) head.push(`字段 ${name}`);
    if (convMatch) head.push(`转换 !${convMatch[1]}（${convMatch[1] === "r" ? "repr" : convMatch[1] === "s" ? "str" : "ascii"}）`);
    const descParts: string[] = [];
    if (head.length) descParts.push(head.join(" · "));
    if (spec) {
      const parts = parseSpec(spec);
      if (parts.unknownType) {
        tokens.push({ text: field, pos: i, length: field.length, desc: `未知格式类型 "${parts.type}"（常见：d f s e %）`, unknown: true });
        i = close + 1;
        plainStart = i;
        continue;
      }
      const sub = specPartsDesc(parts);
      if (sub) descParts.push(sub);
    } else if (!name && !convMatch) {
      descParts.push("自动编号占位（按参数顺序）");
    }
    tokens.push({ text: field, pos: i, length: field.length, desc: descParts.join(" · ") || "占位符" });
    i = close + 1;
    plainStart = i;
  }
  flushPlain(fmt.length);
  return tokens;
}

function specPartsDesc(parts: ReturnType<typeof parseSpec>): string {
  const descs: string[] = [];
  if (parts.align) descs.push(`对齐 ${parts.align}（填充 ${parts.fill ?? "空格"}）`);
  if (parts.sign === "+") descs.push("强制符号 (+/-)");
  if (parts.alt) descs.push("前缀形式 (0x / 0b)");
  if (parts.zero) descs.push("前导 0 填充");
  if (parts.width) descs.push(`宽度 ${parts.width}`);
  if (parts.grouping) descs.push("千分位分隔");
  if (parts.precision !== null) descs.push(`精度 ${parts.precision}`);
  if (parts.type) descs.push(FORMAT_TYPES[parts.type] ?? parts.type);
  return descs.join(" · ");
}

interface SpecParts {
  fill?: string;
  align?: string;
  sign?: string;
  alt: boolean;
  zero: boolean;
  width?: string;
  grouping: boolean;
  precision: number | null;
  type?: string;
  unknownType: boolean;
}

/** 解析格式规范语法（Python Format String Mini-Language） */
export function parseSpec(spec: string): SpecParts {
  const out: SpecParts = { alt: false, zero: false, grouping: false, precision: null, unknownType: false };
  let rest = spec;
  // [[fill]align]
  const alignM = /^(.)?([<>^])/.exec(rest);
  if (alignM) {
    if (alignM[1]) out.fill = alignM[1];
    out.align = alignM[2];
    rest = rest.slice(alignM[0].length);
  }
  // sign
  const signM = /^[+\- ]/.exec(rest);
  if (signM) {
    out.sign = signM[0];
    rest = rest.slice(1);
  }
  if (rest.startsWith("#")) {
    out.alt = true;
    rest = rest.slice(1);
  }
  if (rest.startsWith("0")) {
    out.zero = true;
    rest = rest.slice(1);
  }
  const widthM = /^\d+/.exec(rest);
  if (widthM) {
    out.width = widthM[0];
    rest = rest.slice(widthM[0].length);
  }
  if (rest.startsWith(",") || rest.startsWith("_")) {
    out.grouping = true;
    rest = rest.slice(1);
  }
  const precM = /^\.(\d+)?/.exec(rest);
  if (precM) {
    out.precision = precM[1] !== undefined ? Number(precM[1]) : 0;
    rest = rest.slice(precM[0].length);
  }
  if (rest.length > 0) {
    out.type = rest[0];
    if (FORMAT_TYPES[rest[0]!] === undefined && rest[0] !== "%") out.unknownType = true;
  }
  return out;
}

/** 分段解释入口（§5：三类码表 + 分段 + 未知码判定） */
export function segmentFormat(mode: FormatMode, fmt: string): FormatToken[] {
  if (!fmt) return [];
  if (mode === "strftime") return tokenizeStrftime(fmt);
  if (mode === "logging") return tokenizeLogging(fmt);
  return tokenizeFormat(fmt);
}

// ---------- 诊断（未知格式码 warning，§5） ----------

export interface FormatDiag {
  message: string;
  pos: number;
  length: number;
}

/** 未知码 warning（strftime %Q / format {:q} / logging %(nope)s）；不臆测意图 */
export function formatDiagnostics(mode: FormatMode, fmt: string): FormatDiag[] {
  return segmentFormat(mode, fmt)
    .filter((t) => t.unknown)
    .map((t) => ({ message: `未知格式码「${t.text}」：${t.desc}`, pos: t.pos, length: t.length }));
}

// ---------- hover markdown（§11.4：示例输出 + 分段说明） ----------

const MODE_LABEL: Record<FormatMode, string> = { strftime: "日期 strftime", format: "格式规范", logging: "logging 格式" };

const COMMON_HINT: Record<FormatMode, string> = {
  strftime: "常见码：%Y 年 %m 月 %d 日 %H 时 %M 分 %S 秒",
  format: "常见类型：d 整数 · f 定点 · s 字符串 · e 科学计数 · % 百分比",
  logging: "常见字段：%(asctime)s %(levelname)s %(name)s %(message)s",
};

/** hover 卡（R-1 结论：追加进 lsp/client.ts 合并管线）；示例输出由面板预览给真值，hover 只给分段 */
export function formatHoverMarkdown(mode: FormatMode, fmt: string): string {
  const tokens = segmentFormat(mode, fmt).slice(0, 20);
  const lines = tokens.map((t) => `\`${escapeMd(t.text)}\` — ${t.desc}`);
  if (segmentFormat(mode, fmt).length > 20) lines.push("…（仅显示前 20 段）");
  const hasUnknown = tokens.some((t) => t.unknown);
  if (hasUnknown) lines.push(`⚠ 含未知格式码。${COMMON_HINT[mode]}`);
  lines.push("---");
  lines.push(`在格式串工具中打开：右键 →「在格式串工具中打开」`);
  return [`**Python ${MODE_LABEL[mode]}**`, ...lines].join("\n\n");
}

function escapeMd(s: string): string {
  return s.replace(/`/g, "\\`").replace(/\n/g, "\\n");
}

// ---------- 源码扫描（编辑器 hover / 诊断的识别层） ----------

export interface FormatHit {
  mode: FormatMode;
  fmt: string; // 字符串值（非 raw 已反转义）
  source: string;
  isRaw: boolean;
  start: number;
  end: number;
  contentStart: number;
  /** 0-based 行 */
  line: number;
}

/** 单文件识别上限 */
export const MAX_FORMAT_HITS = 200;

/**
 * 识别源码中的格式串字面量（保守白名单，避免误报刷屏）：
 * - strftime：`.strftime(<字面量>)` / `.strptime(<…>, <字面量>)` 的实参；
 * - format：`.format` 方法调用的**接收者字面量**（含 {}）/ `format(x, <spec 字面量>)` 内建形态；
 * - logging：含已知字段且**上下文可信**（format= kwarg / Formatter( 调用 / 赋值且 ≥2 已知字段）。
 */
export function scanFormatLiterals(text: string): FormatHit[] {
  const hits: FormatHit[] = [];
  const seen = new Set<number>();
  const mask = buildCodeMask(text);
  const push = (mode: FormatMode, lit: PyStringLiteral, at: number): void => {
    if (hits.length >= MAX_FORMAT_HITS || seen.has(lit.start)) return;
    seen.add(lit.start);
    hits.push({
      mode,
      fmt: lit.isRaw ? lit.content : unescapePythonString(lit.content),
      source: lit.content,
      isRaw: lit.isRaw,
      start: lit.start,
      end: lit.end,
      contentStart: lit.contentStart,
      line: lineColAt(text, at).line,
    });
  };

  // 收集全部字符串字面量（end 偏移索引，供 .format 接收者反查）
  const litByEnd = new Map<number, PyStringLiteral>();
  {
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "#") {
        const nl = text.indexOf("\n", i);
        if (nl < 0) break;
        i = nl + 1;
        continue;
      }
      if (c === '"' || c === "'") {
        const lit = parsePyStringLiteral(text, i);
        if (!lit) {
          i++;
          continue;
        }
        litByEnd.set(lit.end, lit);
        i = lit.end;
        continue;
      }
      i++;
    }
  }

  // 1) strftime / strptime 实参
  for (const m of text.matchAll(/\.\s*(?:strftime|strptime)\s*\(/g)) {
    if (mask[m.index] === 1) continue;
    const open = m.index + m[0].length - 1;
    const lit = firstStringArg(text, open);
    if (lit) push("strftime", lit, m.index);
  }

  // 2) format：方法调用（接收者字面量）+ 内建调用（实参字面量）
  for (const m of text.matchAll(/format\s*\(/g)) {
    if (mask[m.index] === 1) continue;
    const isMethod = m.index > 0 && text[m.index - 1] === ".";
    if (isMethod) {
      // 接收者：.format 前的字符串字面量（允许中间空白，跨行 ".\n  format(" 不支持——边界外）
      const lit = litByEnd.get(m.index - 1);
      if (!lit) continue;
      const value = lit.isRaw ? lit.content : unescapePythonString(lit.content);
      if (value.includes("{") && value.includes("}")) push("format", lit, m.index);
    } else {
      // 内建：前一字符须非标识符（防 xformat( 误匹配）
      const prev = text[m.index - 1];
      if (prev && /[\w]/.test(prev)) continue;
      const open = m.index + m[0].length - 1;
      const lit = firstStringArg(text, open);
      if (!lit) continue;
      const value = lit.isRaw ? lit.content : unescapePythonString(lit.content);
      // 模板（含 {}）或 spec 形态（如 ".2f" / ">10"）；普通词串不误收
      const specLike = /^[<>^+\-#0.,_]/.test(value) || /^[sdefgnEFGXob%]$/.test(value);
      if ((value.includes("{") && value.includes("}")) || specLike) push("format", lit, m.index);
    }
  }

  // 3) logging：已知字段 + 上下文可信（kwarg / Formatter( 调用 / 赋值且 ≥2 已知字段）
  for (const [, lit] of litByEnd) {
    const value = lit.isRaw ? lit.content : unescapePythonString(lit.content);
    if (!/%\(\w+\)[sdfg]/.test(value)) continue;
    const fields = [...value.matchAll(/%\((\w+)\)[sdfg]/g)].map((x) => x[1]!);
    const knownCount = fields.filter((f) => LOGGING_FIELDS[f] !== undefined).length;
    if (knownCount === 0) continue;
    // 上下文：字面量前 200 字符内紧邻 format= / fmt= kwarg，或 Formatter( 调用
    const prefix = text.slice(Math.max(0, lit.start - 200), lit.start);
    const kwargCtx = /(?:format|fmt)\s*=\s*(?:[fFrRbBuU]{0,2}(['"]))$/.test(prefix.trimEnd());
    const formatterCtx = /Formatter\s*\(\s*$/.test(prefix.trimEnd());
    // 赋值兜底：NAME = "…" 且 ≥2 已知字段
    const assignCtx = /=\s*(?:[fFrRbBuU]{0,2}(['"]))?$/.test(prefix.trimEnd()) && knownCount >= 2;
    if (kwargCtx || formatterCtx || assignCtx) push("logging", lit, lit.start);
  }
  return hits;
}

function lineColAt(text: string, offset: number): { line: number; col: number } {
  let line = 0;
  let lastNl = -1;
  const limit = Math.min(offset, text.length);
  for (let k = 0; k < limit; k++) {
    if (text.charCodeAt(k) === 10) {
      line++;
      lastNl = k;
    }
  }
  return { line, col: offset - lastNl - 1 };
}

/** 调用括号内的首个字符串字面量（跳过空白/注释/简单位置实参如 datetime 对象） */
function firstStringArg(text: string, openIdx: number): PyStringLiteral | null {
  let i = openIdx + 1;
  for (;;) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
    } else if (c === "#") {
      const nl = text.indexOf("\n", i);
      if (nl < 0) return null;
      i = nl + 1;
    } else break;
  }
  // strptime(x, fmt) / strftime(fmt)：允许跳过一个逗号前实参
  const first = parsePyStringLiteral(text, i);
  if (first) return first;
  // 跳过非逗号非括号内容找第二个实参（strptime 的 fmt 在第 2 位）
  let j = i;
  while (j < text.length && text[j] !== "," && text[j] !== ")" && text[j] !== "\n") j++;
  if (text[j] !== ",") return null;
  let k = j + 1;
  while (/\s/.test(text[k] ?? "")) k++;
  return parsePyStringLiteral(text, k);
}
