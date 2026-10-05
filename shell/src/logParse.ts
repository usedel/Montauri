// 结构化运行日志解析（B5 · docs/toolbox_dev_plan.md §6.3）
//
// **纯函数、零 DOM 依赖**（可单测，与 output.ts 的纯函数同纪律）。
// 纪律：**`parseLogLine` 绝不抛异常**——任何输入都要能退化成「原样一行」（§6.3）。
//
// 解析优先级：整行 JSON → loguru / logging 带时间戳前缀 → `LEVEL:logger:msg` →
// `[LEVEL] …` → 退化（级别交给 `output.ts::detectLogLevel`，其余字段 null，raw 原样展示）。

import { detectLogLevel, type OutputLogLevel } from "./output";

/** 行内 JSON 的解析结果（对象或数组都可能出现：`{"msg":…}` / `[{…},{…}]`） */
export type LogJson = Record<string, unknown> | unknown[];

/** 一条解析后的日志行 */
export interface LogEntry {
  /** 原始整行（去掉行尾 `\r`；解析失败时视图直接展示它） */
  raw: string;
  /** 时间戳文本（**原样保留**，只用于对齐展示，不做时区/格式转换） */
  ts: string | null;
  /** 识别出的级别；null = 未识别（着色与过滤都不参与） */
  level: OutputLogLevel | null;
  /** logger 名（`app.worker` 之类） */
  logger: string | null;
  /** 正文：JSON 行的 `message|msg|event`，前缀行的时间戳/级别之后的部分 */
  message: string;
  /** 行内嵌的 JSON（整行 JSON，或 `message` 字段本身是 JSON 字符串）——供行尾 `▸` 展开 */
  json: LogJson | null;
  /** JSON 行中除 time/level/logger/message 之外的其余字段 */
  extra: Record<string, unknown> | null;
}

/** JSON 行的字段别名（按优先级取第一个存在的键） */
const JSON_KEYS = {
  ts: ["time", "timestamp", "ts", "@timestamp", "asctime"],
  level: ["level", "severity", "levelname", "levelName"],
  logger: ["logger", "name", "module", "logger_name"],
  message: ["message", "msg", "event", "text"],
} as const;

/** 超过该长度的行不再尝试 JSON.parse（超长行解析不划算，且视图层也会折叠为摘要） */
const JSON_PARSE_MAX_LEN = 16 * 1024;

/** 级别展示文本（大写短名；null → 空串） */
const LEVEL_LABEL: Record<OutputLogLevel, string> = {
  error: "ERROR",
  warn: "WARN",
  info: "INFO",
  debug: "DEBUG",
};

/**
 * 带时间戳/级别前缀的行规则表（按优先级）。
 * 数字 = 捕获组下标，**0 = 该形态不含此字段**。
 * `level` 组必须能被 `detectLogLevel` 认出来，否则视为不匹配（防 "GET: /api" 之类误判）。
 */
interface LineRule {
  re: RegExp;
  ts: number;
  level: number;
  logger: number;
  msg: number;
}

/** 时间戳形态（**不含尾随空格**：宽松字符类会把 ` - ` 一起吃进 ts，实测会污染对齐列） */
const TS = String.raw`\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?|\d{4}-\d{2}-\d{2}`;

const LINE_RULES: readonly LineRule[] = [
  // loguru 默认：`2026-10-05 12:03:41.512 | INFO     | app.worker:33 - 连接失败`
  { re: new RegExp(String.raw`^\s*(${TS})\s*\|\s*([A-Za-z]+)\s*\|\s*([^:]+?)(?::\d+)?\s*-\s*(.*)$`), ts: 1, level: 2, logger: 3, msg: 4 },
  // logging 默认带 name：`2026-10-05 12:03:41,512 - INFO - app.worker - 连接失败`
  { re: new RegExp(String.raw`^\s*(${TS})\s*-\s*([A-Za-z]+)\s*-\s*([\w][\w.\-]*)\s*-\s*(.*)$`), ts: 1, level: 2, logger: 3, msg: 4 },
  // 空格分隔带 logger：`12:03:41.880 ERROR app.worker {"msg":"连接失败"}`
  { re: new RegExp(String.raw`^\s*(${TS})\s*[|\-]?\s*([A-Za-z]+)\s+([\w][\w.\-]*)\s+(.*)$`), ts: 1, level: 2, logger: 3, msg: 4 },
  // logging 无 name：`2026-10-05 12:03:41,512 - INFO - 连接失败` / `12:03:41 INFO 连接失败`
  { re: new RegExp(String.raw`^\s*(${TS})\s*[|\-]?\s*([A-Za-z]+)\s*[|\-]?\s*(.*)$`), ts: 1, level: 2, logger: 0, msg: 3 },
  // `LEVEL:logger:msg`（logging 不带 asctime 时）：`WARNING:root:连接失败`
  { re: /^\s*([A-Za-z]+)\s*:\s*([\w][\w.\-]*)\s*:\s*(.*)$/, ts: 0, level: 1, logger: 2, msg: 3 },
  // `[LEVEL] logger: msg` / `[LEVEL] msg`
  { re: /^\s*\[([A-Za-z]+)\]\s*(?:([\w][\w.\-]*)\s*[:\-]\s*)?(.*)$/, ts: 0, level: 1, logger: 2, msg: 3 },
  // `LEVEL: msg`（uvicorn `INFO:     127.0.0.1 - "GET /"`）/ `LEVEL - msg`
  { re: /^\s*([A-Za-z]+)\s*[:\-]\s*(.*)$/, ts: 0, level: 1, logger: 0, msg: 2 },
];

/** 级别文本 → 归一化级别（大小写不敏感；认不出返回 null） */
export function normalizeLogLevel(text: string): OutputLogLevel | null {
  const up = text.trim().toUpperCase();
  return up ? detectLogLevel(up) : null;
}

/** 级别 → 展示文本（null → ""） */
export function levelLabel(level: OutputLogLevel | null): string {
  return level ? LEVEL_LABEL[level] : "";
}

/** 取 JSON 对象里第一个存在的键的值（只认字符串/数字/布尔） */
function pickScalar(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  return null;
}

/** 整行是否为 JSON 对象/数组；是则解析，否则 null（解析失败也返回 null，绝不抛） */
function tryParseJsonLine(line: string): LogJson | null {
  const t = line.trim();
  if (t.length < 2 || t.length > JSON_PARSE_MAX_LEN) return null;
  const c = t[0];
  if (c !== "{" && c !== "[") return null;
  try {
    const v: unknown = JSON.parse(t);
    if (v && typeof v === "object") return v as LogJson;
  } catch {
    /* 不是合法 JSON → 走文本规则 */
  }
  return null;
}

/** `message` 字段本身是 JSON 字符串时解析出来（供行尾展开）；失败返回 null */
function tryParseEmbeddedJson(msg: string): LogJson | null {
  const t = msg.trim();
  if (t.length < 2 || t.length > JSON_PARSE_MAX_LEN) return null;
  const c = t[0];
  if (c !== "{" && c !== "[") return null;
  try {
    const v: unknown = JSON.parse(t);
    if (v && typeof v === "object") return v as LogJson;
  } catch {
    /* 正文恰好以 { 开头但不是 JSON（如字典 repr）→ 不展开 */
  }
  return null;
}

/** 从 JSON 行里挑出 known 字段后剩下的字段（无剩余 → null） */
function restFields(obj: Record<string, unknown>): Record<string, unknown> | null {
  const known = new Set<string>([...JSON_KEYS.ts, ...JSON_KEYS.level, ...JSON_KEYS.logger, ...JSON_KEYS.message]);
  const extra: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (known.has(k)) continue;
    extra[k] = v;
    n++;
  }
  return n > 0 ? extra : null;
}

/** 按规则表解析文本行；都不匹配 → null（调用方退化为 raw） */
function matchLineRules(line: string): Omit<LogEntry, "raw" | "json" | "extra"> | null {
  for (const rule of LINE_RULES) {
    const m = rule.re.exec(line);
    if (!m) continue;
    const g = (i: number): string | null => (i > 0 ? (m[i] ?? null) : null);
    const levelText = g(rule.level);
    const level = levelText ? normalizeLogLevel(levelText) : null;
    if (!level) continue; // 级别认不出 → 该形态不成立，继续下一条（防误判）
    const logger = g(rule.logger);
    return {
      ts: g(rule.ts),
      level,
      logger: logger && logger.trim() ? logger.trim() : null,
      message: (g(rule.msg) ?? "").trim(),
    };
  }
  return null;
}

/**
 * 解析一行运行输出。**任何输入都不抛异常**，最差退化为 `{ raw, level: detectLogLevel(raw) }`。
 * @param line 单行的原始文本（可含行尾 `\r`；由本函数剥离）
 */
export function parseLogLine(line: string): LogEntry {
  const raw = typeof line === "string" ? line.replace(/\r+$/, "") : String(line ?? "");
  const base = (): LogEntry => ({ raw, ts: null, level: null, logger: null, message: raw, json: null, extra: null });

  if (!raw.trim()) return base(); // 空行：原样（不参与级别判定）

  // 1) 整行 JSON（structlog / json-log-formatter 等）
  const parsed = tryParseJsonLine(raw);
  if (parsed && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const ts = pickScalar(obj, JSON_KEYS.ts);
    const levelText = pickScalar(obj, JSON_KEYS.level);
    const logger = pickScalar(obj, JSON_KEYS.logger);
    const message = pickScalar(obj, JSON_KEYS.message) ?? "";
    return {
      raw,
      ts,
      level: levelText ? normalizeLogLevel(levelText) : null,
      logger,
      message,
      json: parsed,
      extra: restFields(obj),
    };
  }
  if (parsed) {
    // 整行是 JSON 数组（批量日志）：不拆，整行原样 + 可展开
    return { raw, ts: null, level: null, logger: null, message: raw, json: parsed, extra: null };
  }

  // 2)~3) 带时间戳/级别前缀的文本行
  const hit = matchLineRules(raw);
  if (hit) {
    return { ...hit, raw, json: tryParseEmbeddedJson(hit.message), extra: null };
  }

  // 4) 退化：级别交给 detectLogLevel（output.ts 的四条形态），其余字段 null，raw 原样展示
  return { ...base(), level: detectLogLevel(raw) };
}

/** 单字段取值（供视图列渲染与 `formatLogRow` 共用；空值返回 ""） */
export function logFieldValue(e: LogEntry, field: string): string {
  switch (field) {
    case "time":
      return e.ts ?? "";
    case "level":
      return levelLabel(e.level);
    case "logger":
      return e.logger ?? "";
    case "message":
      return e.message || e.raw;
    case "extra":
      return e.extra ? JSON.stringify(e.extra) : "";
    default:
      return "";
  }
}

/** 可选字段（视图「字段 ▾」多选的来源，顺序即默认列序） */
export const LOG_FIELDS: readonly string[] = ["time", "level", "logger", "message", "extra"];

/** 按选中字段格式化一行（复制全部 / 插入编辑器用；字段间两空格对齐，尾部不留空白） */
export function formatLogRow(e: LogEntry, fields: readonly string[] = LOG_FIELDS): string {
  const parts: string[] = [];
  for (const f of fields) {
    const v = logFieldValue(e, f);
    if (v) parts.push(v);
  }
  return parts.join("  ").trimEnd();
}
