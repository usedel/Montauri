// 结构化运行日志的**纯状态层**（B5 · docs/toolbox_dev_plan.md §6.7.2 状态机）
//
// 零 DOM 依赖（可单测，与 `logParse.ts` / `runDataBus.ts` 同一纪律）：状态机、半行缓冲切行、
// 行数上限（保尾弃头 + 已丢弃计数）、级别计数、过滤与搜索匹配全在这里；`logView.ts` 只管
// DOM 与渲染调度。

import { parseLogLine, type LogEntry } from "./logParse";
import type { OutputLogLevel } from "./output";

/** 视图相位：`idle` = 未绑定 / `live` = 运行中 / `ended` = 已结束（内容保留） */
export type LogPhase = "idle" | "live" | "ended";

/** 日志条目保留上限（与输出面板 `DEFAULT_MAX_OUTPUT_LINES` 同量级；B5-3 接 `log_max_lines`） */
export const DEFAULT_MAX_LOG_LINES = 5000;

/** 运行时状态（可变对象；由 `createLogState` 产出，各函数就地更新） */
export interface LogStoreState {
  phase: LogPhase;
  /** 绑定的运行实例 id；`null` = 未绑定（只跟**最近一次**运行，§6.9 决策 1） */
  instanceId: string | null;
  entries: LogEntry[];
  /** 半行缓冲（chunk 不以换行结尾时的残留，与 runHistory 同口径） */
  partial: string;
  /** 因超上限被丢弃的行数（状态条「已丢弃 N」） */
  dropped: number;
  counts: Record<OutputLogLevel, number>;
  /** 退出码（ended 才有值） */
  exitCode: number | null;
}

const EMPTY_COUNTS = (): Record<OutputLogLevel, number> => ({ error: 0, warn: 0, info: 0, debug: 0 });

export function createLogState(): LogStoreState {
  return {
    phase: "idle",
    instanceId: null,
    entries: [],
    partial: "",
    dropped: 0,
    counts: EMPTY_COUNTS(),
    exitCode: null,
  };
}

/** 清空内容但保留绑定状态（切工作区 / 手动清空用） */
export function clearLogEntries(s: LogStoreState): void {
  s.entries.length = 0;
  s.partial = "";
  s.dropped = 0;
  s.counts = EMPTY_COUNTS();
}

/** 完全复位到未绑定（关闭工作区） */
export function resetLogState(s: LogStoreState): void {
  clearLogEntries(s);
  s.phase = "idle";
  s.instanceId = null;
  s.exitCode = null;
}

/**
 * 新运行会话启动（`idle → live` / `ended → live`）：**清空视图并重绑实例**。
 * v1 只跟最近一次运行——切实例即清空重来（§6.9 决策 1）。
 */
export function beginSession(s: LogStoreState, instanceId: string): void {
  clearLogEntries(s);
  s.phase = "live";
  s.instanceId = instanceId;
  s.exitCode = null;
}

/** 运行结束（`live → ended`）：冲刷半行缓冲、落退出码。**非绑定实例的事件一律忽略** */
export function endSession(
  s: LogStoreState,
  instanceId: string,
  code: number | null,
  maxLines: number = DEFAULT_MAX_LOG_LINES,
): void {
  if (!s.instanceId || s.instanceId !== instanceId) return;
  // 必须带上调用方的上限：用默认值会让「用户把上限调小后」的收尾行绕过裁剪
  flushPartial(s, maxLines);
  s.phase = "ended";
  s.exitCode = code;
}

/** 冲刷半行缓冲（进程退出前的无换行尾行不丢失）；返回是否新增了一行 */
export function flushPartial(s: LogStoreState, maxLines: number = DEFAULT_MAX_LOG_LINES): boolean {
  if (!s.partial) return false;
  const line = s.partial;
  s.partial = "";
  return pushEntry(s, line, maxLines);
}

/** 追加一行（解析 + 计数 + 上限裁剪）；返回是否真的入列（空行不入列） */
function pushEntry(s: LogStoreState, line: string, maxLines: number): boolean {
  const e = parseLogLine(line);
  if (!e.raw.trim()) return false; // 空行：不占额度、不计数（多行日志的空行不显示为行）
  s.entries.push(e);
  if (e.level) s.counts[e.level]++;
  if (s.entries.length > maxLines) {
    const removed = s.entries.splice(0, s.entries.length - maxLines);
    for (const r of removed) if (r.level) s.counts[r.level]--;
    s.dropped += removed.length;
  }
  return true;
}

/**
 * 消费一块运行输出（`term-data` 分发 → `runDataBus`）。
 * **非绑定实例的输出直接丢弃**（v1 只跟最近一次运行）。
 * @returns 新增的行数（供视图决定是否需要重渲染）
 */
export function appendLogText(
  s: LogStoreState,
  instanceId: string,
  text: string,
  maxLines: number = DEFAULT_MAX_LOG_LINES,
): number {
  if (!text || !s.instanceId || s.instanceId !== instanceId) return 0;
  const joined = s.partial + text;
  const segs = joined.split(/\r\n|\n|\r/);
  s.partial = segs.pop() ?? "";
  let added = 0;
  for (const seg of segs) if (pushEntry(s, seg, maxLines)) added++;
  return added;
}

// ---------- 过滤与搜索（纯显示层，§6.7.4：过滤/搜索绝不动数据） ----------

export interface LogFilter {
  /** 选中的级别集合；`null` 或空集 = 不过滤（全显示） */
  levels: ReadonlySet<OutputLogLevel> | null;
  query: string;
  /** 正则模式（`.*` 开关） */
  regex: boolean;
  /** 大小写敏感（`Aa` 开关） */
  caseSensitive: boolean;
}

export const EMPTY_FILTER: LogFilter = { levels: null, query: "", regex: false, caseSensitive: false };

/** 级别是否可见：**未分级行永远显示**（与 `output.ts::levelVisible` 同口径） */
export function levelVisible(level: OutputLogLevel | null, levels: ReadonlySet<OutputLogLevel> | null): boolean {
  if (!levels || levels.size === 0) return true;
  if (!level) return true;
  return levels.has(level);
}

/** 正则编译结果：`error` 非空 = 表达式非法（视图显示提示且不过滤，避免整列空白） */
export interface LogMatcher {
  test: (text: string) => boolean;
  error: string | null;
}

export function compileMatcher(f: LogFilter): LogMatcher {
  const q = f.query.trim();
  if (!q) return { test: () => true, error: null };
  if (f.regex) {
    try {
      const re = new RegExp(q, f.caseSensitive ? "" : "i");
      return { test: (text) => re.test(text), error: null };
    } catch (e) {
      return { test: () => true, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (f.caseSensitive) return { test: (text) => text.includes(q), error: null };
  const lower = q.toLowerCase();
  return { test: (text) => text.toLowerCase().includes(lower), error: null };
}

/**
 * 过滤后的可见条目（级别 → 搜索，两级叠加）。
 * 搜索匹配范围 = `raw`（含时间戳与 logger），与用户"看到的行"一致。
 */
export function visibleEntries(s: LogStoreState, f: LogFilter): LogEntry[] {
  const m = compileMatcher(f);
  const out: LogEntry[] = [];
  for (const e of s.entries) {
    if (!levelVisible(e.level, f.levels)) continue;
    if (!m.test(e.raw)) continue;
    out.push(e);
  }
  return out;
}
