// CSV 解析单测（VS Code 调研 借鉴-4）。
// csvCore 是零依赖纯模块（不 import state / monaco / i18n），node 环境可直接 import。
// 契约来源：sqliteGrid::csvCell / toCsv（本项目 CSV **导出**的写法）——解析是它的反向实现。
import { describe, expect, it } from "vitest";
import { CSV_MAX_ROWS, isUtf8Decodable, parseCsv, stripBom } from "../csvCore";

describe("BOM 与编码", () => {
  it("剥离 UTF-8 BOM（导出写入的前缀，不剥会粘在首列名上）", () => {
    expect(stripBom("\ufeffa,b")).toBe("a,b");
    expect(stripBom("a,b")).toBe("a,b");
    expect(stripBom("")).toBe("");
  });

  it("UTF-8 可解码性：只承诺 UTF-8，非 UTF-8 显式判否（不猜测 GBK）", () => {
    expect(isUtf8Decodable(new TextEncoder().encode("a,b\n1,2"))).toBe(true);
    // 非法 UTF-8 字节序列
    expect(isUtf8Decodable(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });
});

describe("RFC 4180 解析", () => {
  it("基础：首行是列名，CRLF 分行", () => {
    const t = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(t.columns).toEqual(["a", "b"]);
    expect(t.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(t.total).toBe(2);
    expect(t.truncated).toBe(false);
  });

  it("裸 LF 与裸 CR 都容忍（不产生多余空行）", () => {
    expect(parseCsv("a\n1\n2\n").rows).toEqual([["1"], ["2"]]);
    expect(parseCsv("a\r1\r2\r").rows).toEqual([["1"], ["2"]]);
  });

  it("CRLF 不会多收一个空行（回归钉子：曾因延迟 CR 状态多出空行）", () => {
    const t = parseCsv("a,b\r\n1,2\r\n");
    expect(t.rows).toHaveLength(1);
  });

  it("引号字段内的逗号与换行是字面内容", () => {
    const t = parseCsv('a,b\r\n"x,y",2\r\n"line1\nline2",3\r\n');
    expect(t.rows[0][0]).toBe("x,y");
    expect(t.rows[1][0]).toBe("line1\nline2");
  });

  it("双写引号还原为单个字面引号（与 csvCell 的双写对称）", () => {
    const t = parseCsv('a\r\n"say ""hi"""\r\n');
    expect(t.rows[0][0]).toBe('say "hi"');
  });

  it("行宽不对齐：短行右侧补 null，长行截断尾部", () => {
    const t = parseCsv("a,b,c\r\n1\r\n1,2,3,4\r\n");
    expect(t.rows[0]).toEqual(["1", null, null]);
    expect(t.rows[1]).toEqual(["1", "2", "3"]);
  });

  it("空列名补 col 序号（Grid 表头不能出现空串）", () => {
    const t = parseCsv(",,c\r\n1,2,3\r\n");
    expect(t.columns).toEqual(["col1", "col2", "c"]);
  });

  it("末行无行尾符也收；空文件返回空表", () => {
    expect(parseCsv("a,b\r\n1,2").rows).toEqual([["1", "2"]]);
    const empty = parseCsv("");
    expect(empty.columns).toEqual([]);
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(0);
  });
});

describe("行数上限（用户裁决：上限 + 显式提示，不做懒加载）", () => {
  it("触到 maxRows 即截断并置 truncated", () => {
    const body = Array.from({ length: 50 }, (_, i) => `r${i}`).join("\r\n");
    const t = parseCsv(`a\r\n${body}\r\n`, 10);
    expect(t.rows).toHaveLength(10);
    expect(t.truncated).toBe(true);
    expect(t.total).toBe(10);
  });

  it("正好等于上限不置 truncated", () => {
    const body = Array.from({ length: 10 }, (_, i) => `r${i}`).join("\r\n");
    expect(parseCsv(`a\r\n${body}\r\n`, 10).truncated).toBe(false);
  });

  it("默认上限与 Rust HARD_MAX_ROWS 同口径（10 000）", () => {
    expect(CSV_MAX_ROWS).toBe(10_000);
  });
});
