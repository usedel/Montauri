// English (US) 语言包「test 域」：key 与 zh-CN/test.ts 一一对应，Record<TestKey, string> 在编译期强校验漏译。
import type { TestKey } from "../zh-CN/test";

export const test: Record<TestKey, string> = {
  // ---- test ----
  "test.title": "Tests",
  "test.refresh": "Refresh",
  "test.refreshTip": "Rescan and collect tests",
  "test.collecting": "Collecting…",
  "test.collectHint": "Running pytest --collect-only (cancellable)",
  "test.cancel": "Cancel",
  "test.stale": "changed",
  "test.staleTip": "Test or declaration files changed — refresh to recollect",
  "test.rerunFailed": "Rerun Failed",
  "test.rerunFailedTip": "Run all failed tests again",
  "test.runAria": "Run this test",
  "test.runThis": "Run This Test",
  "test.debugThis": "Debug This Test",
  "test.tabLabel": "Test · {node}",
  // ---- test.noWorkspace ----
  "test.noWorkspace": "No workspace open",
  "test.noWorkspaceHint": "Open a workspace to collect and run pytest tests here",
  // ---- test.empty ----
  "test.empty": "No tests collected",
  "test.emptyHint": "No pytest tests found in the workspace (defaults to test_*.py and *_test.py)",
  // ---- test.collectError ----
  "test.collectError": "Collection failed",
  "test.collectErrorHint": "pytest collect output (tail):",
  "test.retry": "Retry",
  // ---- test.pytestMissing ----
  "test.pytestMissing": "pytest is not installed",
  "test.pytestMissingHint": "pytest is a project-level test framework and is not bundled with OpenCharm. Install it to collect and run tests.",
  "test.installPytest": "Install pytest",
  "test.installTitle": "Install pytest",
  // ---- test.status ----
  "test.statusPassed": "passed",
  "test.statusFailed": "failed",
  "test.statusError": "error",
  "test.statusSkipped": "skipped",
  "test.statusUnknown": "not run",
  // ---- test.failedCount ----
  "test.failedCount.one": "{count} failed",
  "test.failedCount.other": "{count} failed",
  // ---- test.casesCount ----
  "test.casesCount.one": "{count} cases",
  "test.casesCount.other": "{count} cases",
  // ---- test ----
  "test.duration": "took {ms}",
  "test.runFailed": "Failed to run tests: {error}",
  "test.runBusy": "A test run is in progress",
  "test.resultMissing": "Test result not found (the process may have been interrupted); status stays unknown",
  "test.rerunNone": "No failed tests",
  "test.gutterTip": "Test {name}",
  "test.needWorkspace": "Open a workspace before running tests",
  "test.runEcho": "> [test] pytest {nodes}",
};
