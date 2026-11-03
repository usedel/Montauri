// 由解析出的 CurlCommand 生成 Python requests 代码（风格对齐内置爬虫模板 reqget/reqpost）。

import type { CurlCommand } from "./parse";
import { pythonLiteralOf } from "../../pyLiteral";

/** 生成 Python 字符串字面量（JSON 字符串与 Python 双引号字符串转义一致） */
function pyStr(s: string): string {
  return JSON.stringify(s);
}

/** 尝试把 body 字符串按 JSON 解析 */
function tryJson(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/** -u "user:pass" → ("user", "pass") */
function pyAuth(u: string): string {
  const idx = u.indexOf(":");
  const name = idx === -1 ? u : u.slice(0, idx);
  const pass = idx === -1 ? "" : u.slice(idx + 1);
  return `(${pyStr(name)}, ${pyStr(pass)})`;
}

/** "a=1; b=2" → {a: "1", b: "2"} */
function parseCookies(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const t = part.trim();
    if (!t) continue;
    const idx = t.indexOf("=");
    if (idx === -1) out[t] = "";
    else out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

/** query 单段解码：`+` 视为空格，percent-decode 失败则保留原文（不抛错） */
function decodeQueryPart(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** "a=1&b=2"（urlencoded）→ 有序 [key, value] 列表（保留重复 key 与出现顺序） */
function queryPairs(s: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of s.split("&")) {
    const t = part.trim();
    if (!t) continue;
    const idx = t.indexOf("=");
    const rawK = idx === -1 ? t : t.slice(0, idx);
    const rawV = idx === -1 ? "" : t.slice(idx + 1);
    out.push([decodeQueryPart(rawK), decodeQueryPart(rawV)]);
  }
  return out;
}

/** 有序 pair → dict：重复 key 聚成 list（requests 会展开成 a=1&a=2，不丢值） */
function pairsToDict(pairs: Array<[string, string]>): Record<string, string | string[]> {
  // 无原型：`__proto__` 之类的 key 才能作为普通键写进去
  const out: Record<string, string | string[]> = Object.create(null);
  for (const [k, v] of pairs) {
    if (!(k in out)) out[k] = v;
    else if (Array.isArray(out[k])) (out[k] as string[]).push(v);
    else out[k] = [out[k] as string, v];
  }
  return out;
}

/** 拆出 URL 自带的 query：返回去掉 query 的 URL + 有序参数对（`#fragment` 保留在 URL 尾部，不参与拆分） */
function splitUrlQuery(url: string): { url: string; pairs: Array<[string, string]> } {
  const hashIdx = url.indexOf("#");
  const main = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const frag = hashIdx === -1 ? "" : url.slice(hashIdx);
  const qIdx = main.indexOf("?");
  if (qIdx === -1) return { url, pairs: [] };
  const pairs = queryPairs(main.slice(qIdx + 1));
  // 空 query（`url?`）原样保留，不产出空 params
  if (pairs.length === 0) return { url, pairs: [] };
  return { url: main.slice(0, qIdx) + frag, pairs };
}

/** 格式化 dict（pyLiteral 单一实现：true/false/null → True/False/None。
 *  原 JSON.stringify 实现对 JSON body 产出非法 Python——缺陷收口，登记见
 *  dx_features_backlog §6.6 PR-M 关联登记） */
function fmtDict(obj: unknown): string {
  return pythonLiteralOf(obj);
}

export function generatePython(input: CurlCommand): string {
  const method = input.method.toLowerCase();
  // URL 自带的 ?a=1&b=2 拆成 params 字典，URL 只留 base（requests 会重新编码）
  const target = splitUrlQuery(input.url);
  const headers = [...input.headers];
  if (input.userAgent && !headers.some(([k]) => k.toLowerCase() === "user-agent")) {
    headers.push(["User-Agent", input.userAgent]);
  }

  // URL 抽成变量放最前（headers/params/json/auth 同为变量，调用处只留参数名）
  const stmts: string[] = [`url = ${pyStr(target.url)}`];

  if (headers.length > 0) {
    const obj: Record<string, string> = {};
    for (const [k, v] of headers) obj[k] = v;
    stmts.push(`headers = ${fmtDict(obj)}`);
  }

  if (input.cookies) {
    stmts.push(`cookies = ${fmtDict(parseCookies(input.cookies))}`);
  }

  // 查询参数：URL 自带 query +（-G 时）-d 的 urlencoded 内容，合并成一个 params 字典
  const queryEntries: Array<[string, string]> = [...target.pairs];
  if (input.useGetQuery && input.data !== null) {
    queryEntries.push(...queryPairs(input.data));
  }
  const hasParams = queryEntries.length > 0;
  if (hasParams) stmts.push(`params = ${fmtDict(pairsToDict(queryEntries))}`);

  // 请求体
  let hasData = false;
  let hasJson = false;
  let hasFiles = false;
  let filesDict = "";

  if (input.form.length > 0) {
    const data: Record<string, string> = {};
    const files: Record<string, string> = {};
    for (const [k, v] of input.form) {
      if (v.startsWith("@")) files[k] = v.slice(1);
      else data[k] = v;
    }
    if (Object.keys(data).length > 0) {
      stmts.push(`data = ${fmtDict(data)}`);
      hasData = true;
    }
    if (Object.keys(files).length > 0) {
      const entries = Object.entries(files)
        .map(([k, v]) => `    ${pyStr(k)}: open(${pyStr(v)}, "rb")`)
        .join(",\n");
      filesDict = `files = {\n${entries},\n}`;
      hasFiles = true;
    }
  } else if (input.data !== null && !input.useGetQuery) {
    if (input.dataAsJson) {
      const parsed = tryJson(input.data);
      if (parsed.ok) {
        stmts.push(`json = ${fmtDict(parsed.value)}`);
        hasJson = true;
      } else {
        stmts.push(`data = ${pyStr(input.data)}`);
        hasData = true;
      }
    } else {
      stmts.push(`data = ${pyStr(input.data)}`);
      hasData = true;
    }
  }

  if (filesDict) stmts.push(filesDict);

  if (input.user) stmts.push(`auth = ${pyAuth(input.user)}`);

  // 构造调用参数
  const args: string[] = ["url"];
  if (headers.length > 0) args.push("headers=headers");
  if (input.cookies) args.push("cookies=cookies");
  if (hasParams) args.push("params=params");
  if (hasJson) args.push("json=json");
  if (hasData) args.push("data=data");
  if (hasFiles) args.push("files=files");
  if (input.user) args.push("auth=auth");
  if (input.insecure) args.push("verify=False");
  args.push("timeout=10");

  stmts.push(`resp = requests.${method}(${args.join(", ")})`);
  stmts.push("resp.raise_for_status()");

  return `import requests\n\n${stmts.join("\n")}\n`;
}