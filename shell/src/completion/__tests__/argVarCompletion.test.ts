// 实参位作用域变量融合（FUSION-1）纯函数单测。
// v1 用例（U1：作用域枚举 / 亲和排序 / 前缀过滤）+ v2 类型匹配（U2-U6，计划 §6.1）。
// 链路验收（真实 pyrefly + 融合层注入 + incomplete 重触发 + ghost 通道）由
// e2e/lsp/09-arg-var-fusion.spec.ts 覆盖，这里钉死纯函数语义。
import { describe, expect, it } from "vitest";
import {
  matchArgVars,
  normalizeType,
  parseHoverType,
  scopeVarNames,
  type HoverQuery,
  type SigHelpLike,
} from "../argVarCompletion";

const SIG: SigHelpLike = {
  signatures: [
    {
      label: "parse_page(url: str, timeout: int = 10, retries: int = 3)",
      parameters: [{ label: "url: str" }, { label: "timeout: int = 10" }, { label: "retries: int = 3" }],
    },
  ],
  activeSignature: 0,
  activeParameter: 0,
};

const LINES = [
  "from lib import parse_page",
  "",
  "def run():",
  '    cb_url = "https://example.com"',
  "    page_num = 42",
  "    page = parse_page(",
];

describe("scopeVarNames", () => {
  it("收赋值 / for / def 形参，光标行自身不算", () => {
    expect(scopeVarNames(LINES, 5)).toEqual(["page_num", "cb_url"]);
  });

  it("def 边界：外层函数局部变量不泄漏", () => {
    const lines = ["outer_var = 1", "", "def inner():", "    local_x = 2", "    call("];
    expect(scopeVarNames(lines, 4)).toEqual(["local_x"]);
  });

  it("for 循环变量与带注解赋值（`: type =`）都收", () => {
    const lines = ["def f():", "    for item in items:", "        total: int = 0", "        g("];
    expect(scopeVarNames(lines, 3)).toEqual(["total", "item"]);
  });

  it("class 边界停扫", () => {
    const lines = ["module_level = 1", "class A:", "    def m(self):", "        n("];
    expect(scopeVarNames(lines, 3)).toEqual(["self"]);
  });
});

describe("matchArgVars（v1 语义回归，无 hover）", () => {
  it("名称亲和置顶：cb_url（含 url）排 page_num 前", async () => {
    const out = await matchArgVars(SIG, LINES, 5, "");
    expect(out.map((v) => v.name)).toEqual(["cb_url", "page_num"]);
    expect(out[0].detail).toBe("匹配参数 url");
  });

  it("前缀过滤：c 只留 cb_url", async () => {
    expect((await matchArgVars(SIG, LINES, 5, "c")).map((v) => v.name)).toEqual(["cb_url"]);
    expect(await matchArgVars(SIG, LINES, 5, "z")).toEqual([]);
  });

  it("第 2 参数位：目标参数变 timeout，亲和重排", async () => {
    const sig2: SigHelpLike = { ...SIG, activeParameter: 1 };
    const out = await matchArgVars(sig2, LINES, 5, "");
    expect(out[0].detail).toBe("匹配参数 timeout");
  });

  it("非实参位（无签名）/ 参数越界 → 空，调用方零介入", async () => {
    expect(await matchArgVars(null, LINES, 5, "")).toEqual([]);
    expect(
      await matchArgVars({ signatures: [{ label: "f()", parameters: [] }], activeParameter: 0 }, LINES, 5, ""),
    ).toEqual([]);
  });
});

describe("matchArgVars（v2 类型匹配）", () => {
  // 行号直查 hover stub：LINES 里 cb_url 在第 3 行、page_num 在第 4 行
  const hover: HoverQuery = async (l0) =>
    l0 === 3 ? "(variable) cb_url: Literal['https://example.com']" : l0 === 4 ? "(variable) page_num: Literal[42]" : null;
  it("U2 类型匹配压亲和：timeout:int 位上 page_num（int）压 cb_url（str）", async () => {
    const sig2: SigHelpLike = { ...SIG, activeParameter: 1 }; // timeout: int
    const out = await matchArgVars(sig2, LINES, 5, "", hover);
    expect(out.map((v) => v.name)).toEqual(["page_num", "cb_url"]); // tier1 < tier2
    expect(out[0].detail).toBe("匹配参数 timeout · int");
  });

  it("U2b 类型+亲和双命中 = tier0：url:str 位上 cb_url 仍首位", async () => {
    const out = await matchArgVars(SIG, LINES, 5, "", hover); // url: str
    expect(out.map((v) => v.name)).toEqual(["cb_url", "page_num"]);
    expect(out[0].tier).toBe(0);
    expect(out[0].detail).toBe("匹配参数 url · str");
  });

  it("U7 ghost 扩展后缀：非末参数位 \", <名>=<默认值>)\"、末参数位 \")\"", async () => {
    const first = await matchArgVars(SIG, LINES, 5, "", hover); // activeParameter=0（url）→ 下一参 timeout（默认 10）
    expect(first[0].ghostSuffix).toBe(", timeout=10)");
    const last: SigHelpLike = { ...SIG, activeParameter: 2 }; // retries（末位）
    const out = await matchArgVars(last, LINES, 5, "", hover);
    expect(out[0].ghostSuffix).toBe(")");
  });

  it("U5 hover 无返回 → 降级 v1 排序（亲和+近远）", async () => {
    const empty: HoverQuery = async () => null;
    const out = await matchArgVars(SIG, LINES, 5, "", empty);
    expect(out.map((v) => v.name)).toEqual(["cb_url", "page_num"]); // 亲和序，无类型 detail
  });

  it("U5b 参数无注解（label 只有名字）→ 类型维度整体不参与", async () => {
    const sigNoAnn: SigHelpLike = {
      signatures: [{ label: "f(url)", parameters: [{ label: "url" }] }],
      activeParameter: 0,
    };
    const out = await matchArgVars(sigNoAnn, LINES, 5, "", hover);
    expect(out.map((v) => v.name)).toEqual(["cb_url", "page_num"]); // 亲和序
  });
});

describe("parseHoverType / normalizeType", () => {
  it("U6 hover 形态解析：markdown 代码块内的 (variable) name: TYPE", () => {
    expect(parseHoverType("```python\n(variable) cb_url: Literal['x']\n```")).toBe("Literal['x']");
    expect(parseHoverType("(variable) n: int")).toBe("int");
    expect(parseHoverType(null)).toBeNull();
    expect(parseHoverType("no match here")).toBeNull();
  });

  it("U6b Literal 归一：字符串→str、整数→int；全限定取末段", () => {
    expect(normalizeType("Literal['a']")).toBe("str");
    expect(normalizeType('Literal["a"]')).toBe("str");
    expect(normalizeType("Literal[42]")).toBe("int");
    expect(normalizeType("requests.models.Response")).toBe("Response");
    expect(normalizeType("list[str]")).toBe("list[str]");
  });

  it("U4 末段相等匹配：requests.models.Response vs Response", async () => {
    const sigResp: SigHelpLike = {
      signatures: [{ label: "do(resp: Response)", parameters: [{ label: "resp: Response" }] }],
      activeParameter: 0,
    };
    const lines = ["def f():", "    resp = get()", "    do("];
    const hoverResp: HoverQuery = async () => "(variable) resp: requests.models.Response";
    const out = await matchArgVars(sigResp, lines, 2, "", hoverResp);
    // 变量名 resp 含参数名 resp（亲和）+ 类型末段命中 → tier0（类型+亲和双命中）
    expect(out[0].tier).toBe(0);
    expect(out[0].detail).toBe("匹配参数 resp · Response");
  });

  it("联合类型参数不参与匹配（| 形态）", async () => {
    const sigUnion: SigHelpLike = {
      signatures: [{ label: "f(u: bytes | str)", parameters: [{ label: "u: bytes | str" }] }],
      activeParameter: 0,
    };
    const hoverUnion: HoverQuery = async (l0) =>
      l0 === 3 ? "(variable) cb_url: Literal['https://example.com']" : l0 === 4 ? "(variable) page_num: Literal[42]" : null;
    const out = await matchArgVars(sigUnion, LINES, 5, "", hoverUnion);
    expect(out[0].detail).toBe("匹配参数 u"); // 无类型后缀
  });
});
