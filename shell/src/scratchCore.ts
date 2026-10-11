// 单元格解析纯函数层（VS Code 调研 借鉴-2 · 对标 Jupyter cell）。
// 分层同 epSample/epSampleCore 惯例：本文件零 app / monaco / i18n / termUi 依赖
// （scratch.ts 那层要拿编辑器与输出面板，一 import 就把 xterm 的 `self` 依赖带进单测——
// 表现为「self is not defined」，故解析必须独立成层，node 环境可直接 import）。

/** 空闲回收阈值（与 Rust scratch_cmds::IDLE_TIMEOUT 同口径：5 分钟） */
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** `# %%` 分隔行（`#%%` / `# %%` / `# %% [markdown]` 都算；行内代码不算） */
export function isCellSeparator(line: string): boolean {
  return /^\s*#\s*%%/.test(line);
}

export interface CellBounds {
  /** 1 起含端点；`startLine` 是分隔行本身（无分隔符的整文件单元格为 1） */
  startLine: number;
  endLine: number;
}

/**
 * 光标所在单元格的行界。
 * 规则：光标在分隔行上 → 该分隔行开启的单元格；否则向前找最近的分隔行。
 * 文件没有分隔符 → 整个文件是一个单元格（Jupyter 同语义）。
 */
export function cellBounds(lines: string[], cursorLine: number): CellBounds {
  let start = 1;
  for (let i = Math.min(cursorLine, lines.length); i >= 1; i--) {
    if (isCellSeparator(lines[i - 1])) {
      start = i;
      break;
    }
  }
  let end = lines.length;
  for (let i = start + 1; i <= lines.length; i++) {
    if (isCellSeparator(lines[i - 1])) {
      end = i - 1;
      break;
    }
  }
  return { startLine: start, endLine: end };
}

/** 取单元格源码（剥掉分隔行；Jupyter 同语义：分隔行是标记不是代码） */
export function cellCode(lines: string[], b: CellBounds): string {
  const out: string[] = [];
  for (let i = b.startLine; i <= b.endLine; i++) {
    const line = lines[i - 1];
    if (isCellSeparator(line)) continue;
    out.push(line);
  }
  return out.join("\n");
}
