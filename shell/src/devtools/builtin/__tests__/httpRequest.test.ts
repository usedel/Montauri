// B4 · HTTP 工具纯函数与状态机测试（docs/toolbox_dev_plan.md §5.7）。
// 只测无 DOM 的纯函数层：格式化 / 分类 / 草稿解析 / 状态机转移。

import { describe, expect, it } from "vitest";
import type { HttpResponsePayload } from "../../../extensions/facade";
import {
  DRAFT_BODY_LIMIT,
  EMPTY_DRAFT,
  HISTORY_LIMIT,
  beginSend,
  cancelRequested,
  cancelSettled,
  classifyStatus,
  collectHeaders,
  curlToDraft,
  envVars,
  extractVarNames,
  fail,
  formatBytes,
  formatElapsed,
  formatProgress,
  formatVarLines,
  headerValue,
  imageDataUrl,
  initialHttpState,
  isEmptyBody,
  isStale,
  parseDraft,
  parseEnvs,
  parseHistory,
  parseJsonBody,
  parseVarLines,
  pushHistory,
  resetHttpState,
  resolveVariables,
  serializeDraft,
  setNotice,
  serializeEnvs,
  serializeHistory,
  succeed,
  type HttpHistoryEntry,
} from "../httpRequest";

function res(over: Partial<HttpResponsePayload> = {}): HttpResponsePayload {
  return {
    status: 200,
    statusText: "OK",
    headers: [["content-type", "application/json"]],
    body: "{}",
    bodyBase64: null,
    bytes: 2,
    elapsedMs: 1,
    redirectChain: [],
    truncated: false,
    privateTarget: false,
    binary: false,
    ...over,
  };
}

describe("formatElapsed（四档）", () => {
  it("0 / 毫秒 / 秒 / 分", () => {
    expect(formatElapsed(0)).toBe("0 ms");
    expect(formatElapsed(312)).toBe("312 ms");
    expect(formatElapsed(999)).toBe("999 ms");
    expect(formatElapsed(1_234)).toBe("1.2 s");
    expect(formatElapsed(59_900)).toBe("59.9 s");
    expect(formatElapsed(65_000)).toBe("1 m 5 s");
  });

  it("负值按 0 处理（不出现 -5 ms）", () => {
    expect(formatElapsed(-1)).toBe("0 ms");
  });
});

describe("formatBytes（四档）", () => {
  it("B / KB / MB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatProgress（无 total 不给百分比）", () => {
  it("有 total → 已收 / 总量", () => {
    expect(formatProgress(2048, 4096)).toBe("2.0 KB / 4.0 KB");
  });
  it("无 total / total=0 → 只给已收", () => {
    expect(formatProgress(2048, null)).toBe("2.0 KB");
    expect(formatProgress(2048, 0)).toBe("2.0 KB");
  });
});

describe("classifyStatus（4xx 不是错误态）", () => {
  it("2xx ok / 3xx-4xx degraded / 5xx err", () => {
    expect(classifyStatus(200)).toBe("ok");
    expect(classifyStatus(204)).toBe("ok");
    expect(classifyStatus(301)).toBe("degraded");
    expect(classifyStatus(404)).toBe("degraded");
    expect(classifyStatus(500)).toBe("err");
    expect(classifyStatus(503)).toBe("err");
  });
});

describe("headerValue", () => {
  it("大小写不敏感，取首个", () => {
    const r = res({ headers: [["Content-Type", "text/plain"], ["content-type", "application/json"]] });
    expect(headerValue(r, "content-type")).toBe("text/plain");
    expect(headerValue(r, "X-Missing")).toBeNull();
  });
});

describe("parseJsonBody", () => {
  it("content-type 是 json → 解析", () => {
    const got = parseJsonBody(res({ body: '{"a":1}' }));
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value).toEqual({ a: 1 });
  });

  it("无 json 头但形如 JSON → 仍解析（对齐 curl 用户直觉）", () => {
    const got = parseJsonBody(res({ headers: [["content-type", "text/plain"]], body: '[1,2]' }));
    expect(got.ok).toBe(true);
  });

  it("纯文本 → 不解析（不把 { 硬塞进树）", () => {
    expect(parseJsonBody(res({ headers: [["content-type", "text/plain"]], body: "hello" })).ok).toBe(false);
  });

  it("空体 / 二进制 / 坏 JSON → 不解析", () => {
    expect(parseJsonBody(res({ body: "   " })).ok).toBe(false);
    expect(parseJsonBody(res({ body: '{"a":1}', binary: true })).ok).toBe(false);
    expect(parseJsonBody(res({ body: "{oops" })).ok).toBe(false);
  });
});

describe("imageDataUrl / isEmptyBody", () => {
  it("二进制 + image/* + base64 → data URL", () => {
    const r = res({
      binary: true,
      body: "",
      bodyBase64: "AAAA",
      headers: [["content-type", "image/png; charset=binary"]],
    });
    expect(imageDataUrl(r)).toBe("data:image/png;base64,AAAA");
  });

  it("非 image / 无 base64 → null", () => {
    expect(imageDataUrl(res({ binary: true, bodyBase64: "AAAA" }))).toBeNull();
    expect(
      imageDataUrl(res({ binary: true, bodyBase64: null, headers: [["content-type", "image/png"]] })),
    ).toBeNull();
  });

  it("空体判定（二进制不算空）", () => {
    expect(isEmptyBody(res({ body: "  " }))).toBe(true);
    expect(isEmptyBody(res({ body: "x" }))).toBe(false);
    expect(isEmptyBody(res({ body: "", binary: true }))).toBe(false);
  });
});

describe("collectHeaders", () => {
  it("空名跳过；重名保留（同 curl 语义）", () => {
    const got = collectHeaders([
      { name: "X-A", value: "1" },
      { name: "   ", value: "ignored" },
      { name: "X-A", value: "2" },
      { name: " X-B ", value: "3" },
    ]);
    expect(got).toEqual([
      ["X-A", "1"],
      ["X-A", "2"],
      ["X-B", "3"],
    ]);
  });
});

describe("草稿解析与序列化", () => {
  it("null / 坏 JSON → 默认草稿（绝不抛）", () => {
    expect(parseDraft(null)).toEqual(EMPTY_DRAFT);
    expect(parseDraft("{not json")).toEqual(EMPTY_DRAFT);
  });

  it("字段类型不符 → 逐项回落", () => {
    const got = parseDraft(
      JSON.stringify({ method: "FOO", url: 42, headers: [{ name: "A" }, null, { name: "B", value: "v" }], body: 7 }),
    );
    expect(got.method).toBe("GET"); // 非白名单方法回落
    expect(got.url).toBe("");
    expect(got.headers).toEqual([{ name: "B", value: "v" }]);
    expect(got.body).toBe("");
  });

  it("往返一致；超长 body 不落盘", () => {
    const draft = { method: "POST", url: "https://x.dev", headers: [{ name: "A", value: "b" }], body: "hello" };
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);

    const huge = { ...draft, body: "x".repeat(DRAFT_BODY_LIMIT + 1) };
    expect(parseDraft(serializeDraft(huge)).body).toBe("");
  });
});

describe("状态机（§5.7.1 单点驱动的真源）", () => {
  it("beginSend：令牌 +1、计时起点置位、旧结果保留", () => {
    const s0 = succeed(initialHttpState(), res({ status: 200 }));
    const s1 = beginSend(s0, 1000);
    expect(s1.phase).toBe("sending");
    expect(s1.opId).toBe(s0.opId + 1);
    expect(s1.startedAt).toBe(1000);
    expect(s1.lastResult).toBe(s0.lastResult); // 发送中旧响应保留（灰显由 isStale 决定）
    expect(isStale(s1)).toBe(true);
  });

  it("succeed / fail：均清计时起点；fail 保留上一次结果", () => {
    const sending = beginSend(initialHttpState(), 5);
    const ok = succeed(sending, res({ status: 404, statusText: "Not Found" }));
    expect(ok.phase).toBe("ok");
    expect(ok.startedAt).toBeNull();

    const bad = fail(ok, "HttpTimeout:超时");
    expect(bad.phase).toBe("err");
    expect(bad.error).toBe("HttpTimeout:超时");
    expect(bad.lastResult).toBe(ok.lastResult);
    expect(isStale(bad)).toBe(false);
  });

  it("取消：sending → cancelling → idle（令牌作废，不产生错误）", () => {
    const sending = beginSend(initialHttpState(), 1);
    const cancelling = cancelRequested(sending);
    expect(cancelling.phase).toBe("cancelling");
    expect(isStale(cancelling)).toBe(true);

    const settled = cancelSettled(cancelling);
    expect(settled.phase).toBe("idle");
    expect(settled.opId).toBe(cancelling.opId + 1); // 旧回包因令牌不匹配被丢弃
    expect(settled.error).toBeNull(); // 取消不弹错误
  });

  it("非 sending 态调用 cancelRequested 是空操作", () => {
    const s = succeed(initialHttpState(), res());
    expect(cancelRequested(s)).toBe(s);
  });

  it("notice：瞬态提示与 error 分开，且被状态转移清空（渲染单点驱动的前提）", () => {
    const s0 = setNotice(initialHttpState(), "请先填写 URL");
    expect(s0.notice).toBe("请先填写 URL");
    expect(s0.phase).toBe("idle"); // 提示不改阶段：状态行不该变成错误态
    expect(setNotice(s0, null).notice).toBeNull();

    expect(beginSend(s0, 1).notice).toBeNull(); // 下一次发送自动清
    expect(succeed(s0, res()).notice).toBeNull();
    expect(fail(s0, "HttpTimeout:超时").notice).toBeNull(); // 失败时由 error 接管
  });

  it("resetHttpState：切走工具时令牌作废（在途回包一律丢弃）", () => {
    const sending = beginSend(initialHttpState(), 9);
    const reset = resetHttpState(sending);
    expect(reset.phase).toBe("idle");
    expect(reset.lastResult).toBeNull();
    expect(reset.opId).toBeGreaterThan(sending.opId);
  });
});

// ---------- PR-B4-3：变量 / 环境 / 历史 / curl 导入 ----------

describe("resolveVariables", () => {
  it("替换已定义变量；未定义的原样保留并收集名字", () => {
    const got = resolveVariables("{{base}}/users?t={{token}}&x={{missing}}", {
      base: "https://api.dev",
      token: "abc",
    });
    expect(got.text).toBe("https://api.dev/users?t=abc&x={{missing}}");
    expect(got.missing).toEqual(["missing"]);
  });

  it("支持两侧空白、重复变量只报一次、无变量时原样返回", () => {
    expect(resolveVariables("{{ a }}/{{a}}", { a: "1" }).text).toBe("1/1");
    expect(resolveVariables("{{x}}{{x}}", {}).missing).toEqual(["x"]);
    expect(resolveVariables("plain text", {})).toEqual({ text: "plain text", missing: [] });
  });

  it("空值变量算已定义（区别于未定义）", () => {
    expect(resolveVariables("{{empty}}", { empty: "" })).toEqual({ text: "", missing: [] });
  });

  it("extractVarNames 去重且保序", () => {
    expect(extractVarNames("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
    expect(extractVarNames("none")).toEqual([]);
  });
});

describe("parseVarLines / formatVarLines", () => {
  it("解析 key=value；忽略空行与注释；非法行进 invalid", () => {
    const got = parseVarLines(
      ["# 注释", "// 也是注释", "", "base=https://api.dev", "  token = abc  ", "oops", "=noKey"].join("\n"),
    );
    expect(got.vars).toEqual({ base: "https://api.dev", token: "abc" });
    expect(got.invalid).toEqual(["oops", "=noKey"]);
  });

  it("往返一致（值里含 = 时只按首个 = 切分）", () => {
    const vars = { base: "https://api.dev", q: "a=b=c" };
    expect(parseVarLines(formatVarLines(vars)).vars).toEqual(vars);
  });
});

describe("环境集合", () => {
  it("parseEnvs 容忍坏 JSON / 非对象 / 非字符串值", () => {
    expect(parseEnvs(null)).toEqual({});
    expect(parseEnvs("{oops")).toEqual({});
    expect(parseEnvs("[1,2]")).toEqual({});
    expect(parseEnvs(JSON.stringify({ dev: { a: "1", b: 2 }, prod: "x" }))).toEqual({ dev: { a: "1" } });
  });

  it("serializeEnvs / envVars 往返；未知环境返回空表", () => {
    const envs = { dev: { base: "https://d" }, prod: { base: "https://p" } };
    expect(parseEnvs(serializeEnvs(envs))).toEqual(envs);
    expect(envVars(envs, "dev")).toEqual({ base: "https://d" });
    expect(envVars(envs, "nope")).toEqual({});
  });
});

describe("历史", () => {
  const e = (method: string, url: string, at = 1): HttpHistoryEntry => ({
    method,
    url,
    status: 200,
    elapsedMs: 5,
    at,
  });

  it("pushHistory：同 method+url 提到最前（不重复堆积）", () => {
    const list = [e("GET", "a", 3), e("POST", "b", 2), e("GET", "a", 1)];
    const got = pushHistory(list, e("GET", "a", 9));
    expect(got.map((x) => [x.method, x.url, x.at])).toEqual([
      ["GET", "a", 9],
      ["POST", "b", 2],
    ]);
  });

  it("pushHistory：超出上限截尾（保留最新 20）", () => {
    let list: HttpHistoryEntry[] = [];
    for (let i = 0; i < 25; i++) list = pushHistory(list, e("GET", `u${i}`, i));
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].url).toBe("u24");
  });

  it("parseHistory：坏输入退回空表；缺字段兜底", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("nope")).toEqual([]);
    expect(parseHistory(JSON.stringify([{ method: "GET", url: "u", status: 404 }]))).toEqual([
      { method: "GET", url: "u", status: 404, elapsedMs: 0, at: 0 },
    ]);
    expect(parseHistory(JSON.stringify([{ url: "no-method" }]))).toEqual([]);
  });

  it("serializeHistory 与 parseHistory 往返", () => {
    const list = [e("GET", "https://x", 7)];
    expect(parseHistory(serializeHistory(list))).toEqual(list);
  });
});

describe("curlToDraft（复用 devtools/curl2python 的 parseCurl）", () => {
  it("基本 GET", () => {
    const got = curlToDraft("curl 'https://api.dev/users'");
    expect(got?.draft).toEqual({ method: "GET", url: "https://api.dev/users", headers: [], body: "" });
    expect(got?.warnings).toEqual([]);
  });

  it("POST + 头 + body", () => {
    const got = curlToDraft(
      `curl -X POST 'https://api.dev/items' -H 'Content-Type: application/json' -d '{"a":1}'`,
    );
    expect(got?.draft.method).toBe("POST");
    expect(got?.draft.headers).toEqual([{ name: "Content-Type", value: "application/json" }]);
    expect(got?.draft.body).toBe('{"a":1}');
  });

  it("-I → HEAD；-G → body 并入查询串", () => {
    expect(curlToDraft("curl -I 'https://api.dev/x'")?.draft.method).toBe("HEAD");
    const g = curlToDraft("curl -G 'https://api.dev/x' -d 'a=1' -d 'b=2'");
    expect(g?.draft.url).toBe("https://api.dev/x?a=1&b=2");
    expect(g?.draft.body).toBe("");
  });

  it("-b / -A / -u 派生为请求头；-F 转表单体并带告警", () => {
    const got = curlToDraft("curl 'https://api.dev/x' -b 'sid=1' -A 'UA/1' -u 'user:pass'");
    const names = got?.draft.headers.map((h) => h.name);
    expect(names).toContain("Cookie");
    expect(names).toContain("User-Agent");
    expect(names).toContain("Authorization");

    const form = curlToDraft("curl 'https://api.dev/x' -F 'a=1' -F 'f=@/tmp/x.png'");
    expect(form?.draft.body).toBe("a=1&f=%40%2Ftmp%2Fx.png");
    expect(form?.draft.headers.some((h) => h.name === "Content-Type")).toBe(true);
    expect(form?.warnings).toContain("formFile");
  });

  it("无 URL → null（调用方据此判定解析失败）", () => {
    expect(curlToDraft("curl -X POST")).toBeNull();
    // 注：parseCurl 不校验前缀（`not a curl` 会被当成 url="not"），"像不像 curl" 由
    // 调用方的 `looksLikeCurl()` 前置过滤负责，见 http.ts 的 tryImportCurl。
  });

  it("-k 收集为告警（本工具不支持关闭证书校验）", () => {
    expect(curlToDraft("curl -k 'https://api.dev/x'")?.warnings).toContain("insecure");
  });
});
