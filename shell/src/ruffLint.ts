// ruff 实时 lint（P2 · PyCharm PEP8 实时检查对标）：诊断的**第三桶**。
//
// 诊断分桶架构（lsp/client.ts::handleDiagnostics）本就按 owner 分别缓存与下发，
// 故新增 ruff 桶不需要动桥：这里直接以 `opencharm-ruff` 为 owner 调 setModelMarkers，
// 与静态引擎（`opencharm-lsp`）、运行时 intel（`opencharm-intel`）三桶并存互补。
//
// 为什么是「离线 ruff check」而不是「ruff server LSP」：
//   · 与 Optimize Imports / 格式化同一个 stdin 管线（架构铁律：ruff 走独立子进程）；
//   · 不引入第二个语言服务器进程（省内存、省一条生命周期与崩溃面）；
//   · 代价是「保存/停手才刷」而非逐字符——对一个自用 IDE 足够，且更省电。
// ruff 缺席时静默降级（后端返回空列表），与探针缺席不拖垮运行的策略一致。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";

/** 后端 fs_cmds::RuffDiagnostic 的镜像 */
export interface RuffDiagnostic {
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  message: string;
  code: string | null;
}

/** 诊断 owner（三桶之一，与 lsp/client.ts 的两桶并列；marker 按 owner 独立管理） */
export const RUFF_OWNER = "opencharm-ruff";

/** 停手多久后跑一次（ms）：比 didChange 同步的 200ms 更长，避免边打字边刷波浪线 */
const LINT_DEBOUNCE_MS = 800;

export interface RuffLintHandlers {
  setMarkers: (path: string, markers: MonacoApi.editor.IMarkerData[], owner: string) => void;
}

let handlers: RuffLintHandlers | null = null;
let timer: number | undefined;
let token = 0;
/** ruff 缺席已提示过（一次会话只提示一次，避免每次编辑刷控制台） */
let missingNotified = false;

export function setRuffLintHandlers(h: RuffLintHandlers): void {
  handlers = h;
}

/** 请求 lint（防抖；关闭开关时直接清空） */
export function scheduleRuffLint(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void lintActiveFile(), LINT_DEBOUNCE_MS);
}

/** 立即 lint 当前文件（切换 tab / 保存后调用） */
export async function lintActiveFile(): Promise<void> {
  const tab = app.activeTab;
  if (!tab) return;
  const isPy = tab.path.endsWith(".py") || tab.path.endsWith(".pyw");
  if (!isPy) {
    clearRuffMarkers(tab.path);
    return;
  }
  const my = ++token;
  let diags: RuffDiagnostic[];
  try {
    diags = await invoke<RuffDiagnostic[]>("ruff_lint", {
      path: tab.path,
      content: tab.model.getValue(),
    });
  } catch {
    // ruff 缺席或执行失败：清空旧标记，不留下过期的波浪线
    if (!missingNotified) {
      missingNotified = true;
      console.info("[ruffLint] ruff 不可用，实时 lint 已跳过（不影响运行与调试）");
    }
    clearRuffMarkers(tab.path);
    return;
  }
  if (my !== token) return; // 已有更新的请求
  // 严重度走枚举而非裸数字（CR-29 同款纪律）；lint 只报 Warning——
  // 它是「卫生建议」不是「编译错误」，与静态引擎的 Error 混在一起会让用户误判优先级。
  const markers: MonacoApi.editor.IMarkerData[] = diags.map((d) => ({
    startLineNumber: d.line,
    startColumn: d.column,
    endLineNumber: Math.max(d.end_line, d.line),
    endColumn: Math.max(d.end_column, d.column + 1),
    message: d.code ? `${d.code} ${d.message}` : d.message,
    severity: app.monaco.MarkerSeverity.Warning,
    source: d.code ?? "ruff",
  }));
  handlers?.setMarkers(tab.path, markers, RUFF_OWNER);
}

/** 清空某文件的 ruff 标记（关闭 tab / 切到非 Python 文件） */
export function clearRuffMarkers(path: string): void {
  handlers?.setMarkers(path, [], RUFF_OWNER);
}

/** 复位（工作区切换：标记随 model 销毁，这里只需作废在途请求与定时器） */
export function resetRuffLint(): void {
  window.clearTimeout(timer);
  token++;
}
