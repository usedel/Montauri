import { describe, expect, it } from "vitest";
import { ensurePyExtension, stripPyExtension } from "../util";

describe("ensurePyExtension（新建 Python 文件扩展名补齐）", () => {
  it("无扩展名补 .py", () => {
    expect(ensurePyExtension("foo")).toBe("foo.py");
    expect(ensurePyExtension("mod")).toBe("mod.py");
  });

  it(".py 保持不变", () => {
    expect(ensurePyExtension("foo.py")).toBe("foo.py");
  });

  it(".pyw 保持不变", () => {
    expect(ensurePyExtension("foo.pyw")).toBe("foo.pyw");
  });

  it("相对路径补最末段扩展名", () => {
    expect(ensurePyExtension("pkg/mod")).toBe("pkg/mod.py");
  });
});

describe("stripPyExtension（建包名归一化）", () => {
  it("无扩展名不变", () => {
    expect(stripPyExtension("pkg")).toBe("pkg");
  });

  it("剥离 .py 后缀", () => {
    expect(stripPyExtension("pkg.py")).toBe("pkg");
  });

  it("剥离 .pyw 后缀", () => {
    expect(stripPyExtension("pkg.pyw")).toBe("pkg");
  });

  it("相对路径剥离最末段后缀", () => {
    expect(stripPyExtension("sub/pkg.py")).toBe("sub/pkg");
  });
});