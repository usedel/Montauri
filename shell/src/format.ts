// ruff 格式化 provider：DocumentFormattingEditProvider → Tauri format_python 命令。
// 同文件还承载 Optimize Imports（PyCharm Ctrl+Alt+O 对标，走 ruff check --fix I,F401）。
// 设计要点：
// - ruff 走独立子进程（ruff format --stdin），不占用 LSP 桥 stdin（架构铁律：自研组件独立进程）；
// - 格式化缓冲区内容（未保存也可格式化），以单条全量 edit 应用 → Ctrl+Z 可撤销；
// - ruff 缺席/失败不拖垮编辑：返回空 edits，错误经 onError 回调由调用方提示。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n"; // i18n 复核修复：错误提示走语言包
import { toast } from "./toast";
import { errMsg } from "./util";

interface FormatResult {
  formatted: string | null;
  message: string;
}

/** 后端分类码前缀（与 `search_cmds.rs::RUFF_MISSING_PREFIX` 逐字一致）：ruff 二进制缺失 */
const RUFF_MISSING_PREFIX = "RuffMissing:";

/** 错误回调（main.ts 注入：输出面板提示，避免 provider 内直接依赖 UI） */
let onError: ((message: string) => void) | null = null;
export function setFormatErrorHandler(fn: (message: string) => void): void {
  onError = fn;
}

/** 「安装 ruff」入口（main.ts 注入 envPanel 的按件安装）。
 *  用注入而非直接 import：format.ts 是底层 provider 模块，不该依赖环境域 UI
 *  （既有 setFormatErrorHandler 同款先例）。 */
let ruffInstallAction: (() => void) | null = null;
export function setRuffInstallAction(fn: () => void): void {
  ruffInstallAction = fn;
}

/**
 * ruff 缺席提示（**会话内只提示一次**）：保存动作失败过去只往输出面板写一行，
 * 面板没打开时用户完全看不到 → 表现为「设置开了却没反应」。
 * 只针对「没装 ruff」提示——源码有语法错误等其它失败仍只写输出面板，
 * 否则每次 Ctrl+S 都会弹 toast，反而变成噪音。
 * 带「安装 ruff」动作按钮：**这就是忽略首启引导之后的补装入口**。
 */
let ruffMissingNotified = false;
function notifyRuffMissingOnce(): void {
  if (ruffMissingNotified) return;
  ruffMissingNotified = true;
  // kind 只有 info/success/error 三档（toast.ts）。用 error：用户是**显式开了开关**才走到这里，
  // 功能完全没生效属失败而非提示，且会话内只弹一次，不会刷屏。
  const install = ruffInstallAction;
  toast(t("main.ruff.missing"), "error", install ? { actionLabel: t("main.ruff.install"), onAction: install } : {});
}

/** 安装成功后复位提示去重：否则本次会话再遇到真正的失败就永远不提示了 */
export function resetRuffMissingNotice(): void {
  ruffMissingNotified = false;
}

/** 失败收口：ruff 缺席 → 会话内提示一次；其余照旧只写输出面板。
 *  key 收成字面量联合而非 string——`t()` 的 key 是类型级约束的，宽 string 过不了编译。 */
function reportFailure(msg: string, fallbackKey: "main.format.failed" | "main.imports.failed"): void {
  if (msg.startsWith(RUFF_MISSING_PREFIX)) notifyRuffMissingOnce();
  onError?.(t(fallbackKey, { error: msg }));
}

/** 单次格式化（供保存时格式化复用）：成功返回格式化全文，失败返回 null 并提示 */
export async function formatPythonSource(path: string, content: string): Promise<string | null> {
  let r: FormatResult;
  try {
    r = await invoke<FormatResult>("format_python", { path, content });
  } catch (e) {
    onError?.(t("main.format.failed", { error: errMsg(e) }));
    return null;
  }
  if (r.formatted === null) {
    reportFailure(r.message || t("main.format.emptyResult"), "main.format.failed");
    return null;
  }
  return r.formatted;
}

/**
 * Optimize Imports（P0，对标 PyCharm Ctrl+Alt+O）：移除未使用的导入 + 按 isort 规则排序。
 * 走既有的 ruff stdin 管线（`ruff check --fix --select I,F401`），**零新依赖**——
 * ruff 的 isort 兼容规则（I）就是 PyCharm 的对标物，F401 补上「删无用导入」。
 *
 * 与格式化的分工：ruff format 不重排导入，整理导入也不改代码格式，二者正交；
 * 保存时若两个开关都开，顺序为「先整理导入、再格式化」（与 PyCharm 一致）。
 */
export async function optimizeImportsSource(path: string, content: string): Promise<string | null> {
  let r: FormatResult;
  try {
    r = await invoke<FormatResult>("optimize_imports", { path, content });
  } catch (e) {
    onError?.(t("main.imports.failed", { error: errMsg(e) }));
    return null;
  }
  if (r.formatted === null) {
    reportFailure(r.message || t("main.format.emptyResult"), "main.imports.failed");
    return null;
  }
  return r.formatted;
}

/** 注册 Monaco DocumentFormattingEditProvider（python）：Shift+Alt+F / 右键菜单触发 */
export function registerRuffFormatter(monaco: typeof MonacoApi): MonacoApi.IDisposable {
  return monaco.languages.registerDocumentFormattingEditProvider("python", {
    async provideDocumentFormattingEdits(model: MonacoApi.editor.ITextModel) {
      const path = (model as any).__montauriPath as string | undefined;
      if (!path) return [];
      const formatted = await formatPythonSource(path, model.getValue());
      if (formatted === null || formatted === model.getValue()) return [];
      return [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ];
    },
  });
}
