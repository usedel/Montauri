// 外开类型分派纯逻辑单测（PyCharm 借鉴：二进制外开）。
// 只测 isExternalOpenPath（白名单判定）；openWithSystem 是 opener 插件接线，e2e 覆盖。
import { describe, expect, it } from "vitest";
import { isExternalOpenPath } from "../externalOpen";

describe("isExternalOpenPath（外开白名单判定）", () => {
  it("命中标准集各域", () => {
    // Office
    expect(isExternalOpenPath("C:\\p\\book.xlsx")).toBe(true);
    expect(isExternalOpenPath("/tmp/报告.docx")).toBe(true);
    expect(isExternalOpenPath("a/b.xlsm")).toBe(true);
    // PDF
    expect(isExternalOpenPath("spec.pdf")).toBe(true);
    // 图片
    expect(isExternalOpenPath("logo.PNG")).toBe(true);
    expect(isExternalOpenPath("img.jpg")).toBe(true);
    // 压缩包 / Windows 二进制
    expect(isExternalOpenPath("data.zip")).toBe(true);
    expect(isExternalOpenPath("tool.exe")).toBe(true);
    expect(isExternalOpenPath("C:\\Windows\\x.dll")).toBe(true);
  });

  it("不命中：代码与专属视图类型不外开", () => {
    expect(isExternalOpenPath("main.py")).toBe(false);
    expect(isExternalOpenPath("README.md")).toBe(false); // md 有预览视图
    expect(isExternalOpenPath("data.csv")).toBe(false); // csv 有查看器
    expect(isExternalOpenPath("blog.db")).toBe(false); // SQLite 工具
    expect(isExternalOpenPath("style.css")).toBe(false);
    expect(isExternalOpenPath("Cargo.toml")).toBe(false);
  });

  it("不命中：无扩展名 / 点属于目录名", () => {
    expect(isExternalOpenPath("C:\\p\\.gitignore")).toBe(false);
    expect(isExternalOpenPath("C:\\p\\.config\\settings")).toBe(false);
    expect(isExternalOpenPath("Makefile")).toBe(false);
  });

  it("大小写不敏感 + 反斜杠/正斜杠都认", () => {
    expect(isExternalOpenPath("D:\\a\\b\\DATA.XLSX")).toBe(true);
    expect(isExternalOpenPath("a/b/Cat.GIF")).toBe(true);
    expect(isExternalOpenPath("a/b/.hide/Excel.exe")).toBe(true);
  });
});
