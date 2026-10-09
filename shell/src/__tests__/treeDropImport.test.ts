// T5（微交互批）：外部文件拖入的纯函数单测（判定 / 落点 / base64 分块）。
// importDroppedFiles 的 invoke 链路由 e2e 走完整链路（mock invoke 真实写盘）。
import { describe, expect, it } from "vitest";
import { DROP_IMPORT_MAX_BYTES, dropTargetDir, hasExternalFiles } from "../treeDropImport";

/** 最小 DataTransfer 桩（浏览器 API 在 node 环境用 jsdom 部分可用，直接构造更稳） */
function fakeDT(types: string[], files: File[]): DataTransfer {
  return { types, files } as unknown as DataTransfer;
}

describe("hasExternalFiles（外部文件判定）", () => {
  it("含 Files 类型且文件非空 → true", () => {
    const f = new File(["hello"], "a.txt", { type: "text/plain" });
    expect(hasExternalFiles(fakeDT(["Files"], [f]))).toBe(true);
  });

  it("仅 text/plain（树内拖拽）→ false（不误判）", () => {
    expect(hasExternalFiles(fakeDT(["text/plain"], []))).toBe(false);
  });

  it("null / 空 files → false", () => {
    expect(hasExternalFiles(null)).toBe(false);
    expect(hasExternalFiles(fakeDT(["Files"], []))).toBe(false);
  });
});

describe("dropTargetDir（落点目录计算）", () => {
  it("目录条目 = 自身", () => {
    expect(dropTargetDir({ path: "D:\\ws\\pkg", is_dir: true })).toBe("D:\\ws\\pkg");
  });

  it("文件条目 = 父目录（反斜杠）", () => {
    expect(dropTargetDir({ path: "D:\\ws\\pkg\\mod.py", is_dir: false })).toBe("D:\\ws\\pkg");
  });

  it("文件条目 = 父目录（正斜杠）", () => {
    expect(dropTargetDir({ path: "D:/ws/mod.py", is_dir: false })).toBe("D:/ws");
  });

  it("根下文件的父目录 = 根（不越界截断）", () => {
    expect(dropTargetDir({ path: "D:\\mod.py", is_dir: false })).toBe("D:");
  });
});

describe("常量口径", () => {
  it("64MB 上限与 Rust 侧 MAX_BYTES 同值", () => {
    expect(DROP_IMPORT_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});
