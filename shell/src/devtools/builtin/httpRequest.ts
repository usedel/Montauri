// HTTP 工具纯函数层（B4 · docs/toolbox_dev_plan.md §5.7）。
// 零 DOM、零 Tauri、零 i18n 依赖：状态机转移 / 格式化 / 分类都在这里，便于单测。
// 纪律（§5.7.1）：UI 只认 `HttpUiState`，所有变化经这里的纯函数产生新状态，再交给渲染函数。

import type { HttpResponsePayload } from "../../extensions/facade";
import { parseCurl } from "../curl2python/parse";

export type HttpPhase = "idle" | "sending" | "cancelling" | "ok" | "err";

export interface HttpUiState {
  phase: HttpPhase;
  /** 本次发送令牌（单调自增）；回包与进度事件都比对它，不一致即丢弃（§5.7.3） */
  opId: number;
  /** 耗时计时起点（ms epoch）；非发送态为 null */
  startedAt: number | null;
  /** 上一次结果：发送中保留并灰显，不清空（§5.7.2） */
  lastResult: HttpResponsePayload | null;
  error: string | null;
  /**
   * 瞬态提示（发送前校验失败 / curl 导入告警）。与 `error` 分开：它不代表请求失败，
   * 但**同样必须经 render 写入**——直写 `errEl` 会出现「状态行还是 ok、错误槽却报错」
   * 且无法被下一次状态转移清掉（§5.7.1 渲染单点驱动）。
   */
  notice: string | null;
}

export function initialHttpState(): HttpUiState {
  return { phase: "idle", opId: 0, startedAt: null, lastResult: null, error: null, notice: null };
}

/** 设置瞬态提示（传 null 清除） */
export function setNotice(s: HttpUiState, notice: string | null): HttpUiState {
  return { ...s, notice };
}

// ---------- 状态机转移（纯函数，返回新状态） ----------

/** 开始发送：令牌 +1，计时起点置位，旧结果保留（灰显由 `isStale` 决定） */
export function beginSend(s: HttpUiState, now: number): HttpUiState {
  return { ...s, phase: "sending", opId: s.opId + 1, startedAt: now, error: null, notice: null };
}

/** 请求成功（4xx/5xx 也算成功返回，走 `ok`，颜色由 `classifyStatus` 决定） */
export function succeed(s: HttpUiState, res: HttpResponsePayload): HttpUiState {
  return { ...s, phase: "ok", startedAt: null, lastResult: res, error: null, notice: null };
}

/** 请求失败：保留上一次结果（灰显），错误进 error 槽 */
export function fail(s: HttpUiState, error: string): HttpUiState {
  return { ...s, phase: "err", startedAt: null, error, notice: null };
}

/** 用户点了取消：进入 cancelling 中间态（最长 3s，由 UI 侧定时器兜底回落） */
export function cancelRequested(s: HttpUiState): HttpUiState {
  return s.phase === "sending" ? { ...s, phase: "cancelling" } : s;
}

/** 取消落定（服务端确认或超时兜底）：回落 idle，**不弹错误**，令牌作废 */
export function cancelSettled(s: HttpUiState): HttpUiState {
  return { ...s, phase: "idle", opId: s.opId + 1, startedAt: null };
}

/** 工具切走 / 工作区切换：令牌作废（在途回包一律丢弃），状态复位 */
export function resetHttpState(s: HttpUiState): HttpUiState {
  return { ...initialHttpState(), opId: s.opId + 1 };
}

/** 回包是否属于当前这一次请求（§5.7.3 令牌比对） */
export function isCurrentOp(s: HttpUiState, opId: number): boolean {
  return s.phase !== "idle" && s.opId === opId;
}

/** 发送中：旧响应灰显但不清空（§5.7.2） */
export function isStale(s: HttpUiState): boolean {
  return s.phase === "sending" || s.phase === "cancelling";
}

// ---------- 格式化 ----------

/** 耗时：<1s → "312 ms"；<60s → "1.2 s"；≥60s → "1 m 5 s" */
export function formatElapsed(ms: number): string {
  const n = Math.max(0, Math.round(ms));
  if (n < 1000) return `${n} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  const sec = Math.round(n / 1000);
  return `${Math.floor(sec / 60)} m ${sec % 60} s`;
}

/** 字节：0 / <1KB / <1MB / ≥1MB（响应体 5 MB 截断，无需 GB） */
export function formatBytes(n: number): string {
  const v = Math.max(0, n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

/** 下载进度文案：有 total 给「已收 / 总量」，无 total 只给已收（不给百分比，§5.7.2） */
export function formatProgress(received: number, total: number | null): string {
  if (total !== null && total > 0) return `${formatBytes(received)} / ${formatBytes(total)}`;
  return formatBytes(received);
}

// ---------- 状态码与响应体分类 ----------

/** 状态码三档：2xx 常规 / 3xx-4xx 降级 / 5xx 错误（**4xx 不是错误态**，§5.7.4） */
export function classifyStatus(code: number): "ok" | "degraded" | "err" {
  if (code >= 200 && code < 300) return "ok";
  if (code >= 500) return "err";
  return "degraded";
}

/** 响应头取值（大小写不敏感，取首个） */
export function headerValue(res: HttpResponsePayload, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of res.headers) {
    if (k.toLowerCase() === want) return v;
  }
  return null;
}

/**
 * 尝试解析 JSON 响应体。**只在 content-type 明确是 JSON 或 body 看起来是 JSON 时才尝试**——
 * 纯文本响应里出现 `{` 不该被强行塞进树（§5.7.4「不渲染空白 JSON 树」的同一取向）。
 */
export function parseJsonBody(res: HttpResponsePayload): { ok: true; value: unknown } | { ok: false } {
  if (res.binary || res.body.trim() === "") return { ok: false };
  const ct = (headerValue(res, "content-type") ?? "").toLowerCase();
  const ctSaysJson = ct.includes("json");
  const looksJson = /^[\s]*[[{]/.test(res.body);
  if (!ctSaysJson && !looksJson) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(res.body) as unknown };
  } catch {
    return { ok: false };
  }
}

/** 图片预览 data URL（二进制 + 有 base64 + content-type 是 image/* 三者齐备才有） */
export function imageDataUrl(res: HttpResponsePayload): string | null {
  if (!res.binary || !res.bodyBase64) return null;
  const ct = headerValue(res, "content-type") ?? "";
  const base = ct.split(";")[0].trim().toLowerCase();
  if (!base.startsWith("image/")) return null;
  return `data:${base};base64,${res.bodyBase64}`;
}

/** 响应体是否为空（204 / 空体：显示「无响应体」，不渲染空树） */
export function isEmptyBody(res: HttpResponsePayload): boolean {
  return !res.binary && res.body.trim() === "";
}

// ---------- 请求侧 ----------

/** 头表输入行 → 请求头对；空名跳过；重名保留（服务端可多次接收，同 curl） */
export function collectHeaders(rows: ReadonlyArray<{ name: string; value: string }>): [string, string][] {
  const out: [string, string][] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (name === "") continue;
    out.push([name, r.value]);
  }
  return out;
}

/** 方法下拉的可选值（与 Rust `http_cmds::METHODS` 白名单同源） */
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] as const;

/** URL 是否像 curl 命令（PR-B4-3 的粘贴导入用它分流；此处供状态行提示复用） */
export function looksLikeCurl(text: string): boolean {
  return /^\s*curl\s/i.test(text);
}

/** 草稿（跨工具切换保留；经 `host.storage` 落盘，见 §5.2） */
export interface HttpDraft {
  method: string;
  url: string;
  headers: { name: string; value: string }[];
  body: string;
}

export const EMPTY_DRAFT: HttpDraft = { method: "GET", url: "", headers: [], body: "" };

/** 反序列化草稿：任何异常（缺字段 / 非法 JSON / 类型不符）都退回默认值，绝不抛（§5.7 纪律） */
export function parseDraft(raw: string | null): HttpDraft {
  if (!raw) return { ...EMPTY_DRAFT };
  try {
    const v = JSON.parse(raw) as Partial<HttpDraft>;
    const method = typeof v.method === "string" && (HTTP_METHODS as readonly string[]).includes(v.method)
      ? v.method
      : EMPTY_DRAFT.method;
    const headers = Array.isArray(v.headers)
      ? v.headers
          .filter((h): h is { name: string; value: string } =>
            !!h && typeof h.name === "string" && typeof h.value === "string")
          .map((h) => ({ name: h.name, value: h.value }))
      : [];
    return {
      method,
      url: typeof v.url === "string" ? v.url : "",
      headers,
      body: typeof v.body === "string" ? v.body : "",
    };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

/** 序列化草稿（超长 body 不落盘：storage 容量有限，> 64 KB 的体丢弃并置空） */
export const DRAFT_BODY_LIMIT = 64 * 1024;

export function serializeDraft(d: HttpDraft): string {
  const body = d.body.length > DRAFT_BODY_LIMIT ? "" : d.body;
  return JSON.stringify({ method: d.method, url: d.url, headers: d.headers, body });
}

// ---------- 变量与环境（PR-B4-3，§5.1 变量：{{var}} + 全局环境） ----------

/** `{{name}}` 占位（名字允许字母数字与 `_ . -`，两侧空白宽容） */
const VAR_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/**
 * 变量替换。未定义的变量**原样保留**并把名字收集进 `missing` —— 由调用方决定是拦下还是照发
 * （本工具选拦下，见 http.ts 的 send 前置校验）。
 */
export function resolveVariables(
  text: string,
  vars: Record<string, string>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(VAR_RE, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      missing.add(name);
      return `{{${name}}}`;
    }
    return v;
  });
  return { text: out, missing: [...missing] };
}

/** 文本里出现的全部变量名（去重，按首次出现序） */
export function extractVarNames(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR_RE)) seen.add(m[1]);
  return [...seen];
}

/** `key=value` 行解析（`#` / `//` 注释与空行忽略；非法行进 `invalid` 供 UI 提示） */
export function parseVarLines(text: string): { vars: Record<string, string>; invalid: string[] } {
  const vars: Record<string, string> = {};
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("//")) continue;
    const i = line.indexOf("=");
    if (i <= 0) {
      invalid.push(line);
      continue;
    }
    const key = line.slice(0, i).trim();
    if (key === "") {
      invalid.push(line);
      continue;
    }
    vars[key] = line.slice(i + 1).trim();
  }
  return { vars, invalid };
}

/** 变量表 → 可编辑文本（与 `parseVarLines` 往返一致） */
export function formatVarLines(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** 环境集合：`{ dev: { base: "…" }, prod: { … } }`（存 `host.storage`，跨工作区共享） */
export type HttpEnvMap = Record<string, Record<string, string>>;

export function parseEnvs(raw: string | null): HttpEnvMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: HttpEnvMap = {};
    for (const [name, vars] of Object.entries(v as Record<string, unknown>)) {
      if (!vars || typeof vars !== "object" || Array.isArray(vars)) continue;
      const table: Record<string, string> = {};
      for (const [k, val] of Object.entries(vars as Record<string, unknown>)) {
        if (typeof val === "string") table[k] = val;
      }
      out[name] = table;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeEnvs(envs: HttpEnvMap): string {
  return JSON.stringify(envs);
}

/** 取某环境的变量表（不存在返回空表，绝不抛） */
export function envVars(envs: HttpEnvMap, name: string): Record<string, string> {
  return envs[name] ?? {};
}

// ---------- 历史（PR-B4-3：最近 20 条，**不存 body**，§5.1） ----------

export interface HttpHistoryEntry {
  method: string;
  url: string;
  status: number;
  elapsedMs: number;
  /** 时间戳（ms epoch） */
  at: number;
}

export const HISTORY_LIMIT = 20;

/** 插入历史：同 method+url 的旧记录被提到最前（不重复堆积），超出上限截尾 */
export function pushHistory(
  list: readonly HttpHistoryEntry[],
  entry: HttpHistoryEntry,
  limit = HISTORY_LIMIT,
): HttpHistoryEntry[] {
  const rest = list.filter((e) => !(e.method === entry.method && e.url === entry.url));
  return [entry, ...rest].slice(0, limit);
}

/** 反序列化历史：任何异常都退回空表（storage 内容不可信） */
export function parseHistory(raw: string | null): HttpHistoryEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((e): e is HttpHistoryEntry => {
        if (!e || typeof e !== "object") return false;
        const o = e as Record<string, unknown>;
        return typeof o.method === "string" && typeof o.url === "string" && typeof o.status === "number";
      })
      .map((e) => ({
        method: e.method,
        url: e.url,
        status: e.status,
        elapsedMs: typeof e.elapsedMs === "number" ? e.elapsedMs : 0,
        at: typeof e.at === "number" ? e.at : 0,
      }))
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function serializeHistory(list: readonly HttpHistoryEntry[]): string {
  return JSON.stringify(list.slice(0, HISTORY_LIMIT));
}

// ---------- curl 导入（PR-B4-3：复用 devtools/curl2python 的 parseCurl，零新解析） ----------

/** curl 导入的告警 key（UI 侧映射成文案） */
export type CurlWarn = "insecure" | "headOnly" | "formFile";

/**
 * curl 命令 → 请求草稿。URL 缺失返回 null（调用方据此判定"不是 curl / 解析不出"）。
 * 未支持的语义（`-k` / `-I` / `-F key=@file`）不静默丢弃，收集进 `warnings` 由 UI 提示。
 */
export function curlToDraft(text: string): { draft: HttpDraft; warnings: CurlWarn[] } | null {
  const cmd = parseCurl(text);
  if (!cmd.url) return null;
  const warnings: CurlWarn[] = [];
  const headers = cmd.headers.map(([name, value]) => ({ name, value }));
  const has = (n: string): boolean => headers.some((h) => h.name.toLowerCase() === n);

  if (cmd.cookies) headers.push({ name: "Cookie", value: cmd.cookies });
  if (cmd.userAgent) headers.push({ name: "User-Agent", value: cmd.userAgent });
  if (cmd.user) {
    // Basic 认证：非 ASCII 凭据无法进头值，转义后提示用户自行替换
    let encoded = cmd.user;
    try {
      encoded = btoa(cmd.user);
    } catch {
      warnings.push("insecure");
    }
    headers.push({ name: "Authorization", value: `Basic ${encoded}` });
  }

  let url = cmd.url;
  let body = cmd.data ?? "";
  if (cmd.useGetQuery && cmd.data) {
    url = `${url}${url.includes("?") ? "&" : "?"}${cmd.data}`;
    body = "";
  }
  if (cmd.form.length > 0) {
    body = cmd.form.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    if (!has("content-type")) {
      headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
    }
    if (cmd.form.some(([, v]) => v.startsWith("@"))) warnings.push("formFile");
  }
  if (cmd.insecure) warnings.push("insecure");
  if (cmd.headOnly) warnings.push("headOnly");

  return {
    draft: {
      method: cmd.headOnly ? "HEAD" : cmd.method.toUpperCase(),
      url,
      headers,
      body,
    },
    warnings,
  };
}
