// curl2python 生成器单测（fmtDict 缺陷收口：曾用 JSON.stringify 冒充 Python dict
// 字面量，JSON body 的 true/false/null 产出非法 Python——登记见 dx_features_backlog §6.6 PR-M）。
// 纯函数直测（parse → gen，不经 UI）。
import { describe, expect, it } from "vitest";
import { generatePython } from "../devtools/curl2python/gen";
import { parseCurl } from "../devtools/curl2python/parse";
import { pythonToCurl } from "../devtools/builtin/python2curl.gen";

describe("generatePython（cURL → requests）", () => {
  it("JSON body 的三值转 Python 字面量（True/False/None，无 true/false/null 残留）", () => {
    const curl = [
      "curl -X POST https://api.example.com/v1/users",
      "-H 'Content-Type: application/json'",
      "-d '{\"active\": true, \"deleted\": false, \"avatar\": null, \"tags\": [\"a\", null]}'",
    ].join(" ");
    const out = generatePython(parseCurl(curl));
    expect(out).toContain('"active": True');
    expect(out).toContain('"deleted": False');
    expect(out).toContain('"avatar": None');
    expect(out).toContain('"tags": [\n        "a",\n        None,\n    ]');
    // 生成物整体不得再出现 JSON 小写三值字面量（Content-Type 值里的 "json" 不受影响）
    expect(out).not.toMatch(/:\s*(true|false|null)\b/);
  });

  it("headers / cookies 字符串 dict 形态不变且合法（收口后经 pyLiteral 序列化）", () => {
    const curl = [
      "curl https://api.example.com/",
      "-H 'X-Token: abc'",
      "-b 'sid=1; theme=dark'",
    ].join(" ");
    const out = generatePython(parseCurl(curl));
    expect(out).toContain('headers = {\n    "X-Token": "abc",\n}');
    expect(out).toContain('cookies = {\n    "sid": "1",\n    "theme": "dark",\n}');
    expect(out).toContain("requests.get(");
  });

  it("-G 查询串与普通 -d 字符串 body 路径不受收口影响", () => {
    const q = generatePython(parseCurl("curl -G https://api.example.com/ -d 'page=2&q=%20x'"));
    expect(q).toContain('"page": "2"');
    expect(q).toContain('"q": " x"');
    const raw = generatePython(parseCurl("curl -d 'plain body' https://api.example.com/"));
    expect(raw).toContain('data = "plain body"');
  });

  it("URL 自带 query 拆成 params 字典，URL 只留 base 并抽成变量", () => {
    const out = generatePython(parseCurl("curl 'https://api.example.com/search?q=hello&page=2&tag=%E4%B8%AD'"));
    expect(out).toContain('url = "https://api.example.com/search"');
    expect(out).not.toContain("?q=hello");
    expect(out).toContain('params = {\n    "q": "hello",\n    "page": "2",\n    "tag": "中",\n}');
    expect(out).toContain("requests.get(url, params=params");
  });

  it("重复 key 聚成 list（不丢值），`+` 解码为空格", () => {
    const out = generatePython(parseCurl("curl 'https://a.com/x?a=1&a=2&q=foo+bar'"));
    expect(out).toContain('"a": [\n        "1",\n        "2",\n    ]');
    expect(out).toContain('"q": "foo bar"');
  });

  it("URL query 与 JSON body 共存（params + json 同时产出）", () => {
    const out = generatePython(
      parseCurl(
        "curl -X POST 'https://a.com/v1/items?debug=1' -H 'Content-Type: application/json' -d '{\"n\":1}'",
      ),
    );
    expect(out).toContain('"https://a.com/v1/items"');
    expect(out).toContain('"debug": "1"');
    expect(out).toContain('"n": 1');
    expect(out).toContain("params=params, json=json");
  });

  it("URL query 与 -G 的 -d 合并到同一个 params", () => {
    const out = generatePython(parseCurl("curl -G 'https://a.com/x?page=1' -d 'q=x'"));
    expect(out).toContain('"page": "1"');
    expect(out).toContain('"q": "x"');
    expect(out.match(/params = /g)).toHaveLength(1);
  });

  it("无 query 时不产出 params（回归）", () => {
    const out = generatePython(parseCurl("curl 'https://a.com/x'"));
    expect(out).not.toContain("params");
  });

  it("正向产物可被 Python → cURL 反向读回（url / params / auth 变量）", () => {
    const py = generatePython(parseCurl("curl -u 'u:p' 'https://a.dev/x?q=1'"));
    expect(pythonToCurl(py)).toBe("curl -u 'u:p' 'https://a.dev/x?q=1' --max-time 10");
  });
});
