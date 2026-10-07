// PR-E（dx_features_backlog §6.5）：auto-import 纯函数单测（无 Monaco/invoke 依赖）。
// PR-G2：topLevelSymbolNames 增加 line（1-based）字段；IndexSymbol 增加 file/line（quickOpen 消费）。

import { describe, expect, it } from "vitest";
import {
  autoImportContext,
  autoImportItems,
  importedNames,
  topLevelSymbolNames,
  type IndexSymbol,
} from "../autoImport";

describe("topLevelSymbolNames", () => {
  it("收集 def/class/顶层赋值，跳过缩进与注释；line 为 1-based 行号", () => {
    const src = [
      "class DataFrame:",           // 1
      "    def head(self):  # 缩进方法不算",
      "        pass",
      "",
      "def convert(obj): return obj", // 5
      "MAX_ROWS = 100",               // 6
      "# 注释行",
      "if __name__ == '__main__':",
      "    main()",
    ].join("\n");
    expect(topLevelSymbolNames(src)).toEqual([
      { name: "DataFrame", kind: "class", line: 1 },
      { name: "convert", kind: "def", line: 5 },
      { name: "MAX_ROWS", kind: "var", line: 6 },
    ]);
  });

  it("块首关键字（else:/try:）不误收为 var；async def 收集", () => {
    const src = "async def fetch():\n    pass\n\nelse:\n    x = 1\n\ntry:\n    run()\n";
    expect(topLevelSymbolNames(src)).toEqual([{ name: "fetch", kind: "def", line: 1 }]);
  });

  it("CRLF 行尾行号正确（\\r\\n 不影响计数）", () => {
    const src = "a = 1\r\n\r\ndef f():\r\n    pass\r\n";
    expect(topLevelSymbolNames(src)).toEqual([
      { name: "a", kind: "var", line: 1 },
      { name: "f", kind: "def", line: 3 },
    ]);
  });
});

describe("importedNames", () => {
  it("识别 from / import / as / 多段模块 / 圆括号", () => {
    const src = [
      "import os",
      "import pandas as pd",
      "from lib import DataFrame, helper as h",
      "from lib.mod import (One,",
      "    Two)",
      "import a.b", // 引入的是 a，不是 b
    ].join("\n");
    const names = importedNames(src);
    expect(names.has("os")).toBe(true);
    expect(names.has("pd")).toBe(true);
    expect(names.has("DataFrame")).toBe(true);
    expect(names.has("h")).toBe(true);
    expect(names.has("One")).toBe(true);
    expect(names.has("Two")).toBe(true);
    expect(names.has("a")).toBe(true);
    expect(names.has("b")).toBe(false);
  });

  it("分号多语句逐段识别（边界②：此前整段进 tokenizer 两边都丢）", () => {
    const src = "import pandas as pd; import numpy as np\nfrom lib import A as b; import os\n";
    const names = importedNames(src);
    expect(names.has("pd")).toBe(true);
    expect(names.has("np")).toBe(true);
    expect(names.has("b")).toBe(true);
    expect(names.has("os")).toBe(true);
    // 分号后的非 import 段不误收
    expect(names.has("x")).toBe(false);
  });

  it("续行中分号结束续行；括号内空行不打断续行", () => {
    const src = "from lib import (\n    One,\n\n    Two; import x as y\n)\n";
    const names = importedNames(src);
    expect(names.has("One")).toBe(true);
    expect(names.has("Two")).toBe(true);
    expect(names.has("y")).toBe(true);
    // 续行收束后的成员不误收
    const closed = "from lib import (\n    One,\n    Two)\nThree = 1\n";
    expect(importedNames(closed).has("Three")).toBe(false);
  });
});

describe("autoImportContext", () => {
  it("标识符前缀 ≥2 字符返回 typed", () => {
    expect(autoImportContext("    return DataFra")).toBe("DataFra");
    expect(autoImportContext("x = ab")).toBe("ab");
  });

  it("import 行 / 短前缀 / 非词尾 → null", () => {
    expect(autoImportContext("import pand")).toBeNull(); // importAlias 域
    expect(autoImportContext("from lib import DataF")).toBeNull();
    expect(autoImportContext("x = a")).toBeNull(); // <2 字符
    expect(autoImportContext("x = ")).toBeNull(); // 光标不在词上
  });
});

const INDEX: IndexSymbol[] = [
  { module: "lib", name: "DataFrame", kind: "class", file: "lib.py", line: 1 },
  { module: "lib", name: "pd_convert", kind: "def", file: "lib.py", line: 9 },
  { module: "lib.mod", name: "DataBlk", kind: "class", file: "lib/mod.py", line: 3 },
];

describe("autoImportItems", () => {
  it("前缀过滤（大小写不敏感）+ 生成 from-import 文本", () => {
    const items = autoImportItems("data", INDEX, "");
    expect(items.map((i) => i.name).sort()).toEqual(["DataBlk", "DataFrame"]);
    const df = items.find((i) => i.name === "DataFrame")!;
    expect(df.importText).toBe("from lib import DataFrame");
    expect(df.insertText).toBe("DataFrame");
  });

  it("本文件已导入 / 本地已有同名定义 → 排除", () => {
    expect(autoImportItems("data", INDEX, "from lib import DataFrame\n").map((i) => i.name)).toEqual(["DataBlk"]);
    const src = "class DataFrame:\n    pass\n";
    expect(autoImportItems("data", INDEX, src).map((i) => i.name)).toEqual(["DataBlk"]);
  });

  it("学习表 member 别名命中 → as 形态 + 编辑点用别名", () => {
    const items = autoImportItems("data", INDEX, "", [
      { kind: "member", target: "lib.DataFrame", alias: "DF", count: 3 },
    ]);
    const df = items.find((i) => i.name === "DataFrame")!;
    expect(df.importText).toBe("from lib import DataFrame as DF");
    expect(df.insertText).toBe("DF");
  });

  it("上限 MAX_ITEMS=5 + 排序稳定", () => {
    const many: IndexSymbol[] = Array.from({ length: 8 }, (_, i) => ({
      module: `m${i}`,
      name: `DataX${i}`,
      kind: "class" as const,
      file: `m${i}.py`,
      line: i + 1,
    }));
    expect(autoImportItems("data", many, "")).toHaveLength(5);
  });
});

// ---------- findImportInsertLineForModel（P0-D：additionalTextEdits 行号真源） ----------
//
// 接受一个 auto-import 候选会叠加两处编辑：头部插 import（行号由本函数算）+ 光标处插主文本。
// 「头部插入行」与「光标行」相邻 / 重合时的坐标归一是 off-by-one 高发区，这里把边界钉死。
// fake model 桩只暴露本函数真正用到的 `getValue()`（先例：keywordCompletion.test.ts 的最小桩）。

import { findImportInsertLineForModel } from "../autoImport";

const fakeModel = (src: string) => ({ getValue: () => src }) as never;

describe("findImportInsertLineForModel（P0-D）", () => {
  it("无 import → 落在模块头之后（首行代码的上一行 = 第 1 行）", () => {
    const src = "x = 1\n\ndump_json(x)\n";
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(1);
  });

  it("有 import → 最后一条顶层 import 的下一行再空一行之后", () => {
    const src = "import os\n\nx = 1\n";
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(2);
  });

  it("import 在文件末尾 → 插入行越过末行（追加语义，不覆写已有代码）", () => {
    const src = "x = 1\nimport os";
    // 2 行文件，插入行 = 3（文件末尾之后）
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(3);
  });

  it("首行即补全：插入行与光标行重合（off-by-one 高发区）→ 仍取第 1 行", () => {
    const src = "dump_json(x)\ny = 2\n";
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(1);
  });

  it("单行 docstring 模块头 → 插入行在其后", () => {
    const src = '"""Doc."""\n\nx = 1\n';
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(2);
  });

  it("多行 docstring 模块头 → 跳过整个 docstring 再落一行", () => {
    const src = '"""Doc\nline2\nend."""\n\nx = 1\n';
    // docstring 占 1–3 行，插入行 = 4（紧随其后）
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(4);
  });

  it("注释/空行开头的文件头 → 跳过注释块", () => {
    const src = "# -*- coding: utf-8 -*-\n\nx = 1\n";
    expect(findImportInsertLineForModel(fakeModel(src))).toBe(3);
  });
});
