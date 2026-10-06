// @vitest-environment happy-dom
// A5①：端点请求样例的前端纯函数单测（URL 拼装 / cURL 生成 / 文案码映射）。
// DOM 渲染与 invoke 走 e2e（ux/02-frameworks.spec.ts 的 EP-S* 组），此处只测可直取的纯函数。

import { describe, expect, it } from "vitest";
import {
  buildCurl,
  buildRequestPath,
  buildRequestUrl,
  compactBody,
  kindText,
  noteText,
  skipText,
  type EndpointSample,
  type SampleParam,
} from "../epSampleCore";

function param(over: Partial<SampleParam>): SampleParam {
  return {
    kind: "query",
    name: "p",
    type_text: "str",
    required: false,
    default: null,
    value_text: "x",
    note: null,
    ...over,
  };
}

function sample(over: Partial<EndpointSample> = {}): EndpointSample {
  return {
    handler: "h",
    params: [],
    body_model: null,
    body_fields: [],
    body_json: null,
    notes: [],
    ...over,
  };
}

describe("buildRequestPath", () => {
  it("替换 FastAPI 的 {name} 与 {name:converter}", () => {
    const ps = [param({ kind: "path", name: "uid", value_text: "42" })];
    expect(buildRequestPath("/users/{uid}", ps)).toBe("/users/42");
    expect(buildRequestPath("/f/{p:path}", [param({ kind: "path", name: "p", value_text: "a/b" })])).toBe(
      "/f/a/b",
    );
  });

  it("替换 Flask 的 <name> 与 <int:name>", () => {
    const ps = [param({ kind: "path", name: "iid", value_text: "7" })];
    expect(buildRequestPath("/item/<int:iid>", ps)).toBe("/item/7");
    expect(buildRequestPath("/u/<name>", [param({ kind: "path", name: "name", value_text: "tom" })])).toBe(
      "/u/tom",
    );
  });

  it("query 参数串接成 ?a=1&b=2，header/cookie/body/skip 不进 URL", () => {
    const ps = [
      param({ kind: "query", name: "q", value_text: "a b" }),
      param({ kind: "query", name: "n", value_text: "1" }),
      param({ kind: "header", name: "X-K", value_text: "v" }),
      param({ kind: "body", name: "body", value_text: "" }),
      param({ kind: "skip", name: "db", value_text: "" }),
    ];
    expect(buildRequestPath("/s", ps)).toBe("/s?q=a%20b&n=1");
  });

  it("没有样例值的 path 参数保留 {name} 占位（不臆造）", () => {
    expect(buildRequestPath("/u/{id}", [])).toBe("/u/{id}");
    expect(buildRequestPath("/u/{id}", [param({ kind: "path", name: "id", value_text: "" })])).toBe("/u/{id}");
  });

  it("只转义会破坏 URL 结构的字符，保留 : . , 等可读符号", () => {
    expect(buildRequestPath("/t", [param({ kind: "query", name: "at", value_text: "2026-01-01T00:00:00" })])).toBe(
      "/t?at=2026-01-01T00:00:00",
    );
    expect(buildRequestPath("/t", [param({ kind: "query", name: "v", value_text: "a&b=c#d" })])).toBe(
      "/t?v=a%26b%3Dc%23d",
    );
  });
});

describe("buildRequestUrl", () => {
  it("拼接 base（去掉尾斜杠）", () => {
    expect(buildRequestUrl("http://127.0.0.1:8000/", "/health", [])).toBe("http://127.0.0.1:8000/health");
    expect(buildRequestUrl("http://127.0.0.1:8000", "/health", [])).toBe("http://127.0.0.1:8000/health");
  });

  it("服务未运行（base 为 null）退回相对路径", () => {
    expect(buildRequestUrl(null, "/health", [])).toBe("/health");
  });
});

describe("compactBody", () => {
  it("美化 JSON → 紧凑 JSON", () => {
    const s = sample({ body_json: '{\n  "a": 1,\n  "b": [\n    2\n  ]\n}' });
    expect(compactBody(s)).toBe('{"a":1,"b":[2]}');
  });

  it("无请求体返回 null", () => {
    expect(compactBody(sample())).toBeNull();
  });

  it("非法 JSON 退回「去换行」原文（不抛错）", () => {
    expect(compactBody(sample({ body_json: "{\n  oops\n}" }))).toBe("{oops}");
  });
});

describe("buildCurl", () => {
  it("无请求体：单行，只有方法与 URL", () => {
    expect(buildCurl("GET", "http://h/x", sample())).toBe("curl -X GET 'http://h/x'");
  });

  it("有请求体：补 Content-Type 与 -d（紧凑 JSON），多行续行", () => {
    const s = sample({
      body_json: '{\n  "a": 1\n}',
      params: [param({ kind: "body", name: "body", value_text: "" })],
    });
    expect(buildCurl("POST", "http://h/u", s)).toBe(
      ["curl -X POST", "-H 'Content-Type: application/json'", "-d '{\"a\":1}'", "'http://h/u'"].join(
        " \\\n  ",
      ),
    );
  });

  it("header 参数生成 -H", () => {
    const s = sample({ params: [param({ kind: "header", name: "X-Token", value_text: "abc" })] });
    expect(buildCurl("GET", "http://h/x", s)).toBe(
      ["curl -X GET", "-H 'X-Token: abc'", "'http://h/x'"].join(" \\\n  "),
    );
  });

  it("URL 内的单引号按 shell 惯例转义", () => {
    expect(buildCurl("GET", "http://h/a'b", sample())).toBe("curl -X GET 'http://h/a'\\''b'");
  });
});

describe("文案码映射", () => {
  it("已登记的码出文案（非空且不等于码本身）", () => {
    for (const code of ["def_not_found", "flask_scope", "websocket", "body_model_unknown", "unknown_type"]) {
      const s = noteText(code);
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toBe(code);
    }
    expect(kindText("query")).not.toBe("query");
    expect(skipText("dependency")).not.toBe("dependency");
  });

  it("未登记的码原样露出（宁可露码也不要空白 UI）", () => {
    expect(noteText("bogus_code")).toBe("bogus_code");
    expect(kindText("bogus")).toBe("bogus");
    expect(skipText("bogus")).toBe("bogus");
  });

  it("skipText(null) 走占位符", () => {
    expect(skipText(null)).toBe("—");
  });
});
