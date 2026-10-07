// English (US) 语言包「hotspots 域」：key 与 zh-CN/hotspots.ts 一一对应，Record<HotspotsKey, string> 在编译期强校验漏译。
import type { HotspotsKey } from "../zh-CN/hotspots";

export const hotspots: Record<HotspotsKey, string> = {
  // ---- hotspots ----
  "hotspots.excTip": "Exceptions observed: {types}",
  // ---- hotspots.hitsSuffix ----
  "hotspots.hitsSuffix.one": "{count} hits",
  "hotspots.hitsSuffix.other": "{count} hits",
  // ---- hotspots ----
  "hotspots.lastRun": "Last run {time}",
  "hotspots.noData": "No run records yet",
  "hotspots.noDataHint": "Run the project or its tests once; functions that ran and their call counts will appear here",
  "hotspots.noPerfHint": "Performance mode is off — no timing data",
  "hotspots.noWorkspace": "No workspace open",
  "hotspots.noWorkspaceHint": "Open a project to list the functions that actually ran, by call count",
  "hotspots.openAria": "Open declaration",
  "hotspots.rescan": "Rescan",
  // ---- hotspots.runsCount ----
  "hotspots.runsCount.one": "{count} runs total",
  "hotspots.runsCount.other": "{count} runs total",
  // ---- hotspots ----
  "hotspots.scanFailed": "Scan failed: {error}",
  "hotspots.scanFailedShort": "Scan failed",
  "hotspots.scanning": "Scanning…",
  "hotspots.scanningHint": "Reading run records and scanning the workspace",
  "hotspots.sectionObserved": "Observed (by call count)",
  "hotspots.sectionUnobserved": "Not observed running",
  "hotspots.sortHits": "By call count",
  "hotspots.sortTime": "By avg time",
  "hotspots.staleBadge": "changed",
  "hotspots.staleTip": "File changed after the last run; the observation may be stale",
  "hotspots.summaryCoverage": "{pct}% covered",
  // ---- hotspots.summaryObserved ----
  "hotspots.summaryObserved.one": "{count} functions observed",
  "hotspots.summaryObserved.other": "{count} functions observed",
  // ---- hotspots ----
  "hotspots.timeAvg": "avg {time}",
  // ---- hotspots.timeSamples ----
  "hotspots.timeSamples.one": "{count} samples",
  "hotspots.timeSamples.other": "{count} samples",
  // ---- hotspots ----
  "hotspots.timeTip": "Timing includes probe overhead; for relative ranking, not exact durations",
  "hotspots.title": "Runtime Hotspots",
  // ---- hotspots.truncatedHint ----
  "hotspots.truncatedHint.one": "Too many results; showing the first {count}",
  "hotspots.truncatedHint.other": "Too many results; showing the first {count}",
  // ---- hotspots ----
  "hotspots.unobservedHint": "Possible reasons: not covered by tests or entry points, branch not taken, sampling gap — this is not a dead-code verdict",
  "hotspots.zeroObserved": "No functions observed",
};
