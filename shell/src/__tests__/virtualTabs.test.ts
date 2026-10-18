// @vitest-environment happy-dom
//
// 虚拟 Tab 的 path 解析（2026-10-11 修）：tabRealPath / tabRelativePath。
//
// 回归背景：tab 右键菜单「在终端中打开」此前直接把 `tab.path` 交给后端——
// 对 md 预览 Tab 而言那是 `mdpreview:C:\…\docs\a.md`，`parentDirOf` 得到
// `mdpreview:C:\…\docs`（不存在的目录）；portable-pty 的 `current_directory()` 对非目录
// cwd 会静默回落 `USERPROFILE`，症状 = 终端开在了**用户主目录**。同理波及
// 「复制绝对路径」「在资源管理器中显示」，以及终端默认目录（terminal_cwd="file"）。

import { afterEach, describe, expect, it } from "vitest";
import { app, type Tab } from "../state";
import { parentDirOf } from "../util";
import { MD_PREVIEW_PREFIX } from "../mdPreviewTab";
import { CSV_TAB_PREFIX } from "../csvTab";
import { DIFF_TAB_PREFIX, tabRealPath, tabRelativePath } from "../virtualTabs";

/** 只关心 path/kind 的轻量 Tab 桩（tabRealPath 不触碰 model） */
function stubTab(path: string, kind: Tab["kind"]): Tab {
  return { path, kind } as unknown as Tab;
}

const ROOT = "D:\\proj";
const SRC = "D:\\proj\\docs\\montauri-help.md";

describe("tabRealPath：虚拟 path → 真实文件路径", () => {
  afterEach(() => {
    app.workspaceRoot = null;
  });

  it("文件 Tab：原样返回（不误解前缀）", () => {
    app.workspaceRoot = ROOT;
    expect(tabRealPath(stubTab("D:\\proj\\main.py", "file"))).toBe("D:\\proj\\main.py");
    expect(tabRealPath(stubTab("D:\\proj\\main.py", undefined))).toBe("D:\\proj\\main.py");
  });

  it("md 预览 Tab：剥离 mdpreview: 前缀", () => {
    app.workspaceRoot = ROOT;
    const tab = stubTab(MD_PREVIEW_PREFIX + SRC, "md");
    expect(tabRealPath(tab)).toBe(SRC);
  });

  it("CSV 查看 Tab：剥离 csvtab: 前缀", () => {
    app.workspaceRoot = ROOT;
    const tab = stubTab(CSV_TAB_PREFIX + "D:\\proj\\data.csv", "csv");
    expect(tabRealPath(tab)).toBe("D:\\proj\\data.csv");
  });

  it("diff Tab：工作区根 + 相对路径拼接为绝对路径", () => {
    app.workspaceRoot = ROOT;
    const tab = stubTab(DIFF_TAB_PREFIX + "src/a.py", "diff");
    expect(tabRealPath(tab)).toBe("D:\\proj\\src\\a.py");
  });

  it("db Tab：无对应文件 → null（调用方应隐藏路径类动作）", () => {
    app.workspaceRoot = ROOT;
    expect(tabRealPath(stubTab("db-data:abc123", "db"))).toBeNull();
    expect(tabRealPath(stubTab("db-query:conn1", "db"))).toBeNull();
  });

  it("回归钉子：md 预览 Tab 解析出的目录必须真实可用（parentDirOf 不含前缀）", () => {
    app.workspaceRoot = ROOT;
    const real = tabRealPath(stubTab(MD_PREVIEW_PREFIX + SRC, "md"));
    expect(real).not.toBeNull();
    const dir = parentDirOf(real as string);
    expect(dir).toBe("D:\\proj\\docs");
    // 旧行为（把 tab.path 直接喂给 parentDirOf）产出的是这种不存在的目录
    expect(dir).not.toContain(MD_PREVIEW_PREFIX);
  });
});

describe("tabRelativePath：真实路径 → 工作区相对路径", () => {
  afterEach(() => {
    app.workspaceRoot = null;
  });

  it("工作区内取相对路径", () => {
    app.workspaceRoot = ROOT;
    expect(tabRelativePath(SRC)).toBe("docs\\montauri-help.md");
  });

  it("工作区外/无工作区回落文件名", () => {
    app.workspaceRoot = ROOT;
    expect(tabRelativePath("C:\\elsewhere\\a.py")).toBe("a.py");
    app.workspaceRoot = null;
    expect(tabRelativePath(SRC)).toBe("montauri-help.md");
  });
});
