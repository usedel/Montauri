// 字符串字面量路径补全（VS Code 插件调研报告 借鉴-3 · 对标 Path Intellisense）：
// `open("` / `Path("` / `pd.read_csv("` / `glob("` 这类调用里补全工作区文件与目录名。
//
// **噪音纪律（报告 §4 借鉴-3；本项风险最高，改动前先读）**：
//   1. **触发收紧**：必须同时满足「光标在未闭合的字符串字面量内」+（路径形态 **或**
//      调用白名单首参位）。普通字符串（日志文案、字典键、URL）一律不弹——见 `parsePathContext`；
//   2. **段位钉死**：sortText 取 `2aNN`，**排在静态引擎 `2xxx` 之后、关键字 `3xx` 之前**，
//      不抢模板 `0xx` / autoImport `0y` / importAlias `0z` / intel `1xx`（四层合并契约）；
//   3. 单目录条目上限与忽略规则在**后端**（`list_workspace_dirs` 的 `files=true` 分支）。
//
// 分层同 keywordCompletion / autoImport：纯函数零 monaco 依赖（单测可直接 import），
// provider 那层才碰 Monaco 枚举与 invoke。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { app, type MonacoModule } from "../state";

/** 段位：`2a` 排在静态引擎 `2xxx` 之后、关键字 `3xx` 之前（'a' > '9' 故不与之冲突） */
export const SORT_PREFIX = "2a";

/**
 * 允许在**首参位**直接弹路径的调用名白名单（与「路径形态」是**或**关系）。
 * 刻意只收「参数就是路径」的高频调用：白名单越宽，误弹面越大。
 */
export const PATH_CALLS = [
  "Path",
  "open",
  "glob",
  "iglob",
  "include",
  "read_csv",
  "read_excel",
  "read_json",
  "read_text",
  "to_csv",
  "write_text",
];

/** 目录条目（与 Rust search_cmds::DirEntry 同名同形） */
export interface DirEntry {
  name: string;
  is_dir: boolean;
}

export interface PathContext {
  /** 引号内已输入的全部内容（已把 `\` 归一为 `/`） */
  fragment: string;
  /** 目录部分（含尾斜杠；`""` = 工作区根） */
  dir: string;
  /** 待补全的最后一段（替换范围宽度 = prefix.length） */
  prefix: string;
  /** 是否命中调用白名单首参位 */
  whitelisted: boolean;
}

/**
 * 判定「光标处是否应弹路径候选」并拆出目录 / 前缀。
 * @param linePrefix 从行首到光标的文本（不含光标后内容）
 * @returns null = 不该弹（噪音纪律 1）
 */
export function parsePathContext(linePrefix: string): PathContext | null {
  // 1) 光标必须落在一个**未闭合**的字符串字面量内。
  //    逐字符扫（顺带解出片段内容）：行注释（`#`）与三引号（docstring）直接否掉
  //    ——这两处弹路径是纯噪音。
  let quote: string | null = null;
  let openIdx = -1;
  let escaped = false;
  let fragment = "";
  for (let i = 0; i < linePrefix.length; i++) {
    const c = linePrefix[i];
    if (quote === null) {
      if (c === "#") return null; // 行注释
      if (c === '"' || c === "'") {
        if (linePrefix[i + 1] === c && linePrefix[i + 2] === c) return null; // 三引号
        quote = c;
        openIdx = i;
        fragment = "";
        escaped = false;
      }
      continue;
    }
    if (escaped) {
      // 转义内容按 Python 语义解：`\"` 是字面引号（**不能**变成路径分隔符，否则
      // `p = "a\"b` 会被误判成 `a/` 目录）；`\\` 是字面反斜杠 → 归一为 `/`（Windows 路径）
      fragment += c === quote ? c : c === "\\" ? "/" : c;
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === quote) {
      quote = null; // 字符串闭合 → 光标不在字符串里
      openIdx = -1;
      fragment = "";
      continue;
    }
    fragment += c;
  }
  if (quote === null || openIdx < 0) return null;

  // URL 不是工作区路径：`https://` / `file://` 这类 scheme 一律不弹（否则 `url = "https://`
  // 会被 `includes("/")` 判成路径形态——这是最容易误弹的一类）
  if (/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//.test(fragment)) return null;

  // 2) 调用白名单**首参位**：引号前只允许 `名字(` + 空白（`open("` 可弹，`f("a", "` 不弹）
  const before = linePrefix.slice(0, openIdx);
  const call = /([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*$/.exec(before);
  const whitelisted = call !== null && PATH_CALLS.includes(call[1]);

  // 3) 路径形态：已输入 `/`（或 `./` `../` `/` 开头，或就是 `.` / `..`）
  const pathForm =
    fragment !== "" &&
    (fragment.startsWith("/") ||
      fragment.startsWith("./") ||
      fragment.startsWith("../") ||
      fragment.includes("/") ||
      fragment === "." ||
      fragment === "..");

  if (!whitelisted && !pathForm) return null;

  const slash = fragment.lastIndexOf("/");
  return {
    fragment,
    dir: slash >= 0 ? fragment.slice(0, slash + 1) : "",
    prefix: slash >= 0 ? fragment.slice(slash + 1) : fragment,
    whitelisted,
  };
}

/** 纯函数：候选 → 补全项（不含 kind——Monaco 枚举须在回调内读，踩坑同 keywordCompletion） */
export function pathItems(
  ctx: PathContext,
  entries: DirEntry[],
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number },
): Array<{ label: string; insertText: string; sortText: string; detail: string; range: typeof range; isDir: boolean }> {
  const out: Array<{
    label: string;
    insertText: string;
    sortText: string;
    detail: string;
    range: typeof range;
    isDir: boolean;
  }> = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    out.push({
      label: e.name,
      // 目录补 `/`：接受后继续键入会经 triggerCharacters 再次触发，可逐级下钻
      insertText: e.is_dir ? `${e.name}/` : e.name,
      sortText: SORT_PREFIX + String(i).padStart(3, "0"),
      // detail 用相对路径本身，不引入新的可翻译文案
      detail: ctx.dir === "" ? "." : ctx.dir,
      range,
      isDir: e.is_dir,
    });
  }
  return out;
}

// ---------- 数据源（可注入，便于单测；默认走 invoke） ----------

type Fetcher = (root: string, sub: string) => Promise<DirEntry[]>;
let fetcher: Fetcher = async (root, sub) =>
  invoke<DirEntry[]>("list_workspace_dirs", { root, sub, files: true });

/** 注入数据源（仅测试用；生产走 invoke） */
export function setPathEntryFetcher(f: Fetcher): void {
  fetcher = f;
}

// ---------- provider ----------

export function registerPathCompletion(monaco: MonacoModule): MonacoApi.IDisposable {
  return monaco.languages.registerCompletionItemProvider("python", {
    // `/` 触发逐级下钻；引号触发「刚开字符串」时的白名单首参位弹窗。
    // 刻意**不设** `.`：`.` 后是成员访问，弹文件名是纯噪音。
    triggerCharacters: ["/", '"', "'"],
    async provideCompletionItems(model, position) {
      if (!app.workspaceRoot) return { suggestions: [] };
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const ctx = parsePathContext(linePrefix);
      if (!ctx) return { suggestions: [] };

      let entries: DirEntry[] = [];
      try {
        entries = await fetcher(app.workspaceRoot, ctx.dir);
      } catch {
        return { suggestions: [] }; // 后端失败静默降级（与 intel 同纪律）
      }
      if (entries.length === 0) return { suggestions: [] };

      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: position.column - ctx.prefix.length,
        endColumn: position.column,
      };
      // 踩坑（同 keywordCompletion）：Monaco 动态加载时序下枚举必须在回调内读 + 数值回退
      const K = (monaco.languages as unknown as { CompletionItemKind?: Record<string, number> })
        .CompletionItemKind;
      const KIND_FOLDER = K?.Folder ?? 18;
      const KIND_FILE = K?.File ?? 16;

      const suggestions: MonacoApi.languages.CompletionItem[] = pathItems(ctx, entries, range).map(
        (it) => ({
          label: it.label,
          kind: it.isDir ? KIND_FOLDER : KIND_FILE,
          insertText: it.insertText,
          sortText: it.sortText,
          detail: it.detail,
          range: it.range as MonacoApi.IRange,
        }),
      );
      return { suggestions };
    },
  });
}
