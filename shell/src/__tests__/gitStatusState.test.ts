// gitStatusState ignored 集合与前缀查询单测（VSCode gitDecoration ignored 灰显借鉴批）。
// 纯逻辑：Set 填充 / 尾斜杠剥离 / 祖先前缀匹配 / 大小写与分隔符无关 / 清空。
import { beforeEach, describe, expect, it } from "vitest";
import { isGitIgnored, setGitIgnoredPaths } from "../gitStatusState";

beforeEach(() => {
  setGitIgnoredPaths([]);
});

describe("isGitIgnored 前缀查询", () => {
  it("目录级条目（--ignored=matching 带 / 尾斜杠）：目录自身与子孙全命中", () => {
    setGitIgnoredPaths(["node_modules/", "dist"]);
    expect(isGitIgnored("node_modules")).toBe(true);
    expect(isGitIgnored("node_modules/")).toBe(true);
    expect(isGitIgnored("node_modules/pkg/mod.js")).toBe(true);
    expect(isGitIgnored("dist/bundle.js")).toBe(true);
  });

  it("文件级条目：仅自身命中，同前缀目录不算", () => {
    setGitIgnoredPaths(["build.pyc"]);
    expect(isGitIgnored("build.pyc")).toBe(true);
    // node_modules2 不是 node_modules 的子路径（前缀按段匹配，非字符串前缀）
    expect(isGitIgnored("build.py")).toBe(false);
    expect(isGitIgnored("src/build.pyc")).toBe(false);
  });

  it("深层嵌套祖先命中（多级上溯）", () => {
    setGitIgnoredPaths(["vendor"]);
    expect(isGitIgnored("vendor/a/b/c.py")).toBe(true);
    expect(isGitIgnored("x/vendor/a.py")).toBe(false); // 非根级 vendor，不同路径
  });

  it("大小写与分隔符归一（Windows 路径反斜杠 / git 输出原始大小写）", () => {
    setGitIgnoredPaths(["Node_Modules/"]);
    expect(isGitIgnored("node_modules\\pkg\\mod.js")).toBe(true);
    expect(isGitIgnored("NODE_MODULES/pkg.js")).toBe(true);
  });

  it("段边界：node_modules2 不命中 node_modules", () => {
    setGitIgnoredPaths(["node_modules/"]);
    expect(isGitIgnored("node_modules2/x.js")).toBe(false);
  });

  it("空集合恒 false（非 git 仓库 / 无 ignored）", () => {
    expect(isGitIgnored("anything/x.py")).toBe(false);
  });

  it("全量替换语义：旧条目随新一次 set 清除", () => {
    setGitIgnoredPaths(["old_dir/"]);
    expect(isGitIgnored("old_dir/x.py")).toBe(true);
    setGitIgnoredPaths(["new_dir/"]);
    expect(isGitIgnored("old_dir/x.py")).toBe(false);
    expect(isGitIgnored("new_dir/x.py")).toBe(true);
  });
});
