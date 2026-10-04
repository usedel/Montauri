// @vitest-environment happy-dom
// B6-3：TODO 视图的过滤与分组纯函数单测（DOM 渲染另由 e2e 覆盖）。
// 只测导出的纯函数，不依赖 app 状态与真实扫描结果。

import { describe, expect, it } from "vitest";
import {
  filterTodos,
  groupTodos,
  groupTodosByFile,
  groupTodosByTag,
  type TodoMatch,
} from "../todoView";

/** 造一条命中（只填该用例关心的字段，其余留默认值） */
function mk(path: string, line: number, tag: string, message = "", text = ""): TodoMatch {
  return { path, line, tag, message, text };
}

const SAMPLE: TodoMatch[] = [
  mk("D:/p/app/main.py", 12, "TODO", "补上重试", "# TODO 补上重试"),
  mk("D:/p/app/main.py", 40, "FIXME", "这里会漏掉空列表", "# FIXME 这里会漏掉空列表"),
  mk("D:/p/app/util.py", 7, "TODO", "抽成工具函数", "# TODO 抽成工具函数"),
  mk("D:/p/tests/test_a.py", 3, "HACK", "先跳过", "# HACK 先跳过"),
];

describe("filterTodos", () => {
  it("空查询原样返回全部（且是新数组，不暴露内部状态引用）", () => {
    const got = filterTodos(SAMPLE, "");
    expect(got).toEqual(SAMPLE);
    expect(got).not.toBe(SAMPLE);
  });

  it("纯空白查询等同空查询", () => {
    expect(filterTodos(SAMPLE, "   \t ")).toEqual(SAMPLE);
  });

  it("匹配标记，且大小写不敏感", () => {
    expect(filterTodos(SAMPLE, "fixme").map((m) => m.line)).toEqual([40]);
    expect(filterTodos(SAMPLE, "TODO")).toHaveLength(2);
  });

  it("匹配说明文字（中文子串）", () => {
    expect(filterTodos(SAMPLE, "工具函数").map((m) => m.line)).toEqual([7]);
  });

  it("匹配文件路径", () => {
    expect(filterTodos(SAMPLE, "tests/").map((m) => m.tag)).toEqual(["HACK"]);
  });

  it("message 为空时退而匹配整行原文", () => {
    const only: TodoMatch[] = [mk("D:/p/a.py", 1, "NOTE", "", "# 只在整行里出现的关键词")];
    expect(filterTodos(only, "整行里")).toHaveLength(1);
    expect(filterTodos(only, "根本没有的词")).toHaveLength(0);
  });

  it("无命中返回空数组", () => {
    expect(filterTodos(SAMPLE, "zzz")).toEqual([]);
  });

  it("不改动入参数组", () => {
    const input = [...SAMPLE];
    filterTodos(input, "TODO");
    expect(input).toEqual(SAMPLE);
  });
});

describe("groupTodosByTag", () => {
  it("按 TAG_ORDER 排（TODO 在 FIXME 前，FIXME 在 HACK 前）", () => {
    const got = groupTodosByTag(SAMPLE);
    expect(got.map((g) => g.key)).toEqual(["TODO", "FIXME", "HACK"]);
  });

  it("同标记的条目聚到一组并保持原有顺序", () => {
    const got = groupTodosByTag(SAMPLE);
    const todo = got.find((g) => g.key === "TODO")!;
    expect(todo.items.map((m) => m.line)).toEqual([12, 7]);
  });

  it("未登记的标记排在已登记之后，并按字典序", () => {
    const got = groupTodosByTag([
      mk("D:/p/a.py", 1, "ZZZ"),
      mk("D:/p/b.py", 2, "TODO"),
      mk("D:/p/c.py", 3, "AAA"),
    ]);
    expect(got.map((g) => g.key)).toEqual(["TODO", "AAA", "ZZZ"]);
  });

  it("tag 模式的组带徽标文本、label 与 title 均为标记名", () => {
    const g = groupTodosByTag(SAMPLE)[0];
    expect(g.badge).toBe("TODO");
    expect(g.label).toBe("TODO");
    expect(g.title).toBe("TODO");
  });

  it("空输入得到空组列表", () => {
    expect(groupTodosByTag([])).toEqual([]);
  });
});

describe("groupTodosByFile", () => {
  it("按首次出现顺序建组（Rust 侧已按路径排好，前端不再重排）", () => {
    const got = groupTodosByFile(SAMPLE);
    expect(got.map((g) => g.key)).toEqual([
      "D:/p/app/main.py",
      "D:/p/app/util.py",
      "D:/p/tests/test_a.py",
    ]);
  });

  it("同文件多条聚为一组，组内保持行号有序", () => {
    const got = groupTodosByFile(SAMPLE);
    const main = got.find((g) => g.key === "D:/p/app/main.py")!;
    expect(main.items.map((m) => m.line)).toEqual([12, 40]);
  });

  it("label 是文件名、title 是完整路径、badge 为 null", () => {
    const g = groupTodosByFile(SAMPLE)[0];
    expect(g.label).toBe("main.py");
    expect(g.title).toBe("D:/p/app/main.py");
    expect(g.badge).toBeNull();
  });

  it("分组不丢条目也不重复（与过滤结果总数守恒）", () => {
    const shown = filterTodos(SAMPLE, "TODO");
    const grouped = groupTodosByFile(shown);
    expect(grouped.reduce((n, g) => n + g.items.length, 0)).toBe(shown.length);
  });
});

describe("groupTodos", () => {
  it("按 mode 分派到对应分组实现", () => {
    expect(groupTodos(SAMPLE, "tag").map((g) => g.key)).toEqual(["TODO", "FIXME", "HACK"]);
    expect(groupTodos(SAMPLE, "file")).toHaveLength(3);
  });

  it("file 模式的组头不带徽标，tag 模式带", () => {
    expect(groupTodos(SAMPLE, "file").every((g) => g.badge === null)).toBe(true);
    expect(groupTodos(SAMPLE, "tag").every((g) => g.badge !== null)).toBe(true);
  });
});
