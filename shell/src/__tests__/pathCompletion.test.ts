// 路径补全单测（VS Code 调研 借鉴-3）：触发收紧（噪音纪律 1）+ 目录/前缀拆分 + 候选项构造。
// 只测纯函数层（parsePathContext / pathItems / 段位），provider 的 Monaco 接线由 e2e 覆盖。
import { describe, expect, it } from "vitest";
import { PATH_CALLS, SORT_PREFIX, parsePathContext, pathItems } from "../completion/pathCompletion";

const RANGE = { startLineNumber: 1, endLineNumber: 1, startColumn: 7, endColumn: 7 };

describe("触发收紧（噪音纪律 1：不该弹的一律不弹）", () => {
  it("不在字符串里 → 不弹", () => {
    expect(parsePathContext("x = 1")).toBeNull();
    expect(parsePathContext("def f(path):")).toBeNull();
  });

  it("字符串已闭合 → 不弹（光标在引号外）", () => {
    expect(parsePathContext('p = "data/" ')).toBeNull();
    expect(parsePathContext("p = 'a.py' #")).toBeNull();
  });

  it("行注释里的引号 → 不弹", () => {
    expect(parsePathContext('# open("data/')).toBeNull();
    expect(parsePathContext('x = 1  # "data/')).toBeNull();
  });

  it("三引号（docstring）→ 不弹", () => {
    expect(parsePathContext('"""load "data/')).toBeNull();
    expect(parsePathContext("'''see 'data/")).toBeNull();
  });

  it("普通字符串且非路径形态、不在白名单 → 不弹（这是最容易误弹的一类）", () => {
    expect(parsePathContext('log.info("hello wor')).toBeNull();
    expect(parsePathContext('d = {"ke')).toBeNull();
    // URL 不是工作区路径：`includes("/")` 会误判，故显式守卫
    expect(parsePathContext('url = "https://exa')).toBeNull();
    expect(parsePathContext('url = "file:///c')).toBeNull();
    expect(parsePathContext('BASE = "postgresql://u')).toBeNull();
  });

  it("转义引号不算闭合：字符串仍开着，但非路径形态且不在白名单 → 不弹", () => {
    // 行内实际文本：p = "a\"b
    expect(parsePathContext('p = "a\\"b')).toBeNull();
    // 白名单调用内则弹（行内实际文本：open("a\"b）
    const ctx = parsePathContext('open("a\\"b');
    expect(ctx).not.toBeNull();
    expect(ctx!.whitelisted).toBe(true);
  });
});

describe("路径形态（与白名单是「或」关系）", () => {
  it("已输入目录分隔符 → 弹（与调用名无关）", () => {
    const ctx = parsePathContext('cfg = "data/ra');
    expect(ctx).not.toBeNull();
    expect(ctx!.dir).toBe("data/");
    expect(ctx!.prefix).toBe("ra");
    expect(ctx!.whitelisted).toBe(false);
  });

  it("./ 与 ../ 与 / 开头都算路径形态", () => {
    expect(parsePathContext('p = "./")')).toBeNull(); // 已闭合
    expect(parsePathContext('p = "./')!.dir).toBe("./");
    expect(parsePathContext('p = "../')!.dir).toBe("../");
    expect(parsePathContext('p = "/etc/')!.dir).toBe("/etc/");
    expect(parsePathContext('p = "/etc/')!.prefix).toBe("");
  });

  it("单独的 . 与 .. 也算路径形态", () => {
    expect(parsePathContext('p = ".')!.fragment).toBe(".");
    expect(parsePathContext('p = "..')!.fragment).toBe("..");
  });

  it("字面反斜杠（Windows 写法 `data\\\\raw`）归一为正斜杠", () => {
    // 行内实际文本：p = "data\\raw
    const ctx = parsePathContext('p = "data\\\\ra');
    expect(ctx!.dir).toBe("data/");
    expect(ctx!.prefix).toBe("ra");
  });

  it("工作区根（无斜杠）→ dir 为空串、prefix 为整段", () => {
    const ctx = parsePathContext('p = "da');
    // 「da」本身不是路径形态且非白名单 → 不弹（防误弹的核心断言）
    expect(ctx).toBeNull();
    expect(parsePathContext('open("da')!.dir).toBe("");
    expect(parsePathContext('open("da')!.prefix).toBe("da");
  });
});

describe("调用白名单首参位", () => {
  it("白名单调用 + 空片段（刚敲开引号）→ 弹", () => {
    for (const call of ["open", "Path", "glob", "read_csv", "include"]) {
      const ctx = parsePathContext(`${call}("`);
      expect(ctx, call).not.toBeNull();
      expect(ctx!.whitelisted, call).toBe(true);
      expect(ctx!.dir, call).toBe("");
      expect(ctx!.prefix, call).toBe("");
    }
  });

  it("名单覆盖高频路径调用", () => {
    expect(PATH_CALLS).toContain("open");
    expect(PATH_CALLS).toContain("Path");
    expect(PATH_CALLS).toContain("read_csv");
    expect(PATH_CALLS).toContain("glob");
  });

  it("非首参位（`(` 前有实参）→ 不弹", () => {
    expect(parsePathContext('open(x, "')).toBeNull();
    expect(parsePathContext('print("')).toBeNull(); // 名单外调用
  });

  it("名单外调用名 → 不弹（哪怕形似）", () => {
    expect(parsePathContext('myopen("')).toBeNull();
    expect(parsePathContext('PathLike("')).toBeNull();
  });

  it("白名单内已输入子目录 → dir 随之下钻", () => {
    const ctx = parsePathContext('pd.read_csv("data/20');
    expect(ctx!.whitelisted).toBe(true);
    expect(ctx!.dir).toBe("data/");
    expect(ctx!.prefix).toBe("20");
  });
});

describe("候选项构造", () => {
  const ctx = parsePathContext('open("data/')!;
  const entries = [
    { name: "raw", is_dir: true },
    { name: "a.csv", is_dir: false },
    { name: "b.csv", is_dir: false },
  ];

  it("目录补尾斜杠（便于逐级下钻），文件不补", () => {
    const items = pathItems(ctx, entries, RANGE);
    expect(items.map((i) => i.insertText)).toEqual(["raw/", "a.csv", "b.csv"]);
    expect(items[0].isDir).toBe(true);
    expect(items[1].isDir).toBe(false);
  });

  it("段位钉在 2aNN：静态 2xxx 之后、关键字 3xx 之前", () => {
    const items = pathItems(ctx, entries, RANGE);
    expect(items.map((i) => i.sortText)).toEqual(["2a000", "2a001", "2a002"]);
    // 契约自证（'a' > '9' ⇒ 排在所有 2xxx 静态项之后；'2' < '3' ⇒ 排在关键字之前）
    expect(SORT_PREFIX > "2999").toBe(true);
    expect(SORT_PREFIX < "3").toBe(true);
    expect(SORT_PREFIX > "0z").toBe(true); // 不抢模板 / autoImport / importAlias
    expect(SORT_PREFIX > "1999").toBe(true); // 不抢 intel
  });

  it("detail 是相对目录本身（不引入新的可翻译文案）", () => {
    expect(pathItems(ctx, entries, RANGE)[0].detail).toBe("data/");
    expect(pathItems(parsePathContext('open("')!, entries, RANGE)[0].detail).toBe(".");
  });

  it("替换范围按 prefix 宽度（filterText 默认取 label，宽度一致才不会被静默滤掉）", () => {
    const items = pathItems(ctx, entries, RANGE);
    expect(items[0].range).toEqual(RANGE);
  });

  it("空条目列表 → 空候选", () => {
    expect(pathItems(ctx, [], RANGE)).toEqual([]);
  });
});
