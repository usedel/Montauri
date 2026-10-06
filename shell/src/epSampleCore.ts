// A5①：端点请求样例的**纯函数核**。
//
// 与 `epSample.ts` 的分工：本文件零 app 依赖（只依赖 i18n 的 `t()`），因此
// 单测可直接 import——`epSample.ts` 那层要拿 `app.workspaceRoot`、`lastServiceBaseUrl()`
// 与 devtools，一 import 就把 `git.ts → termUi.ts` 的模块级 DOM 查询带进来，
// 单测里必然「缺少元素 #git-detail-view」。纯函数与副作用分层是这里唯一的目的。
//
// 数据形状与 Rust `ep_sample_cmds.rs` 逐字对应（改一侧必改另一侧）。

import { t } from "./i18n";
import type { TKey } from "./i18n/locales/zh-CN";

// ---------- 与 Rust 出口逐字对应的类型 ----------

export type SampleKind = "path" | "query" | "header" | "cookie" | "body" | "skip";

export interface SampleParam {
  kind: SampleKind;
  name: string;
  type_text: string;
  required: boolean;
  default: string | null;
  /** 裸文本样例值（不含引号） */
  value_text: string;
  /** 跳过原因码：dependency / varargs / framework_object / websocket / flask_scope */
  note: string | null;
}

export interface SampleField {
  name: string;
  type_text: string;
  required: boolean;
  /** JSON 字面量文本（紧凑） */
  value: string;
}

export interface EndpointSample {
  handler: string;
  params: SampleParam[];
  body_model: string | null;
  body_fields: SampleField[];
  body_json: string | null;
  /** 框架级说明码：def_not_found / flask_scope / websocket / body_model_unknown / unknown_type */
  notes: string[];
}

/** 展开样例所需的端点标识（`EndpointMatch` 的子集——只取用得上的字段） */
export interface SampleTarget {
  framework: string;
  method: string;
  route: string;
  file: string;
  line: number;
  handler: string;
}

// ---------- 文案码 → 语言包 key（显式表：动态拼串过不了 TKey 的编译期检查） ----------

const NOTE_KEYS: Record<string, TKey> = {
  def_not_found: "endpoints.sampleNote.def_not_found",
  flask_scope: "endpoints.sampleNote.flask_scope",
  websocket: "endpoints.sampleNote.websocket",
  body_model_unknown: "endpoints.sampleNote.body_model_unknown",
  unknown_type: "endpoints.sampleNote.unknown_type",
};

const SKIP_KEYS: Record<string, TKey> = {
  dependency: "endpoints.sampleSkip.dependency",
  varargs: "endpoints.sampleSkip.varargs",
  framework_object: "endpoints.sampleSkip.framework_object",
  websocket: "endpoints.sampleSkip.websocket",
  flask_scope: "endpoints.sampleSkip.flask_scope",
};

const KIND_KEYS: Record<string, TKey> = {
  path: "endpoints.sampleKind.path",
  query: "endpoints.sampleKind.query",
  header: "endpoints.sampleKind.header",
  cookie: "endpoints.sampleKind.cookie",
  body: "endpoints.sampleKind.body",
  skip: "endpoints.sampleKind.skip",
};

/** 未登记码原样露出（宁可露码也不要空白 UI） */
export function noteText(code: string): string {
  const k = NOTE_KEYS[code];
  return k ? t(k) : code;
}

export function skipText(code: string | null): string {
  if (!code) return t("endpoints.sampleEmpty");
  const k = SKIP_KEYS[code];
  return k ? t(k) : code;
}

export function kindText(kind: string): string {
  const k = KIND_KEYS[kind];
  return k ? t(k) : kind;
}

// ---------- 纯函数：URL / cURL ----------

/**
 * URL 里安全化一个裸值：只转义会破坏结构的字符（`% # ? & = +` 与空格），
 * 保留 `:` `.` `,` `-` `_` 等可读符号——样例 URL 是给人看的，
 * `encodeURIComponent` 会把 `2026-01-01T00:00:00` 变成 `2026-01-01T00%3A00%3A00`。
 */
function urlSafe(s: string): string {
  return s.replace(/[%#?&=+ ]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** shell 单引号包裹（内含 `'` → `'\''` 惯例，同 python2curl.gen.ts） */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** 路由模板 + 样例值 → 实际请求路径（替换 path 参数，串接 query） */
export function buildRequestPath(route: string, params: SampleParam[]): string {
  const byName = new Map(params.map((p) => [p.name, p]));
  const valueOf = (name: string): string => {
    const p = byName.get(name);
    return p && p.value_text !== "" ? urlSafe(p.value_text) : `{${name}}`;
  };
  // FastAPI：{name} / {name:path}
  let path = route.replace(/\{(\w+)(?::\w+)?\}/g, (_m, name: string) => valueOf(name));
  // Flask：<name> / <int:name>
  path = path.replace(/<(?:\w+:)?(\w+)>/g, (_m, name: string) => valueOf(name));
  const q = params
    .filter((p) => p.kind === "query" && p.value_text !== "")
    .map((p) => `${p.name}=${urlSafe(p.value_text)}`);
  return q.length > 0 ? `${path}?${q.join("&")}` : path;
}

/** 完整 URL；服务未运行时退回相对路径（`lastServiceBaseUrl()` 为 null） */
export function buildRequestUrl(base: string | null, route: string, params: SampleParam[]): string {
  const path = buildRequestPath(route, params);
  if (!base) return path;
  return base.replace(/\/+$/, "") + path;
}

/** 请求体紧凑 JSON：cURL 里塞多行美化 JSON 会很难读；解析失败退回「去换行」原文 */
export function compactBody(sample: EndpointSample): string | null {
  if (!sample.body_json) return null;
  try {
    return JSON.stringify(JSON.parse(sample.body_json));
  } catch {
    return sample.body_json.replace(/\s*\n\s*/g, "");
  }
}

/** 生成 cURL 命令（多行 `\` 续行，可直接粘贴） */
export function buildCurl(method: string, url: string, sample: EndpointSample): string {
  const body = compactBody(sample);
  const lines: string[] = [`curl -X ${method}`];
  if (body !== null) lines.push(`-H ${shellQuote("Content-Type: application/json")}`);
  for (const p of sample.params) {
    if (p.kind === "header" && p.value_text !== "") lines.push(`-H ${shellQuote(`${p.name}: ${p.value_text}`)}`);
  }
  if (body !== null) lines.push(`-d ${shellQuote(body)}`);
  lines.push(shellQuote(url));
  // 只有「方法 + URL」时不摆续行符（`curl -X GET 'http://h/x'` 一行更干净）
  return lines.length === 2 ? lines.join(" ") : lines.join(" \\\n  ");
}
