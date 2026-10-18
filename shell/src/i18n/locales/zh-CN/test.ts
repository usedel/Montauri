// 简体中文语言包「test 域」（pytest 测试运行器，docs/pytest_dev_plan.md §6）：真源，勿手改。
// 复数条目（含 {count}）提供 .one/.other 两形（中文同文）。
export const test = {
  // ---- test ----
  "test.title": "测试",
  "test.refresh": "刷新",
  "test.refreshTip": "重新扫描并收集测试",
  "test.collecting": "收集中…",
  "test.collectHint": "正在运行 pytest --collect-only（可取消）",
  "test.cancel": "取消",
  "test.stale": "有变更",
  "test.staleTip": "测试文件或声明文件已变更，点击刷新重新收集",
  "test.rerunFailed": "重跑失败",
  "test.rerunFailedTip": "重新运行全部失败的测试",
  "test.runAria": "运行此测试",
  "test.runThis": "运行此测试",
  "test.debugThis": "调试此测试",
  "test.tabLabel": "测试 · {node}",
  // ---- test.noWorkspace ----
  "test.noWorkspace": "未打开工作区",
  "test.noWorkspaceHint": "打开工作区后，在此收集与运行 pytest 测试",
  // ---- test.empty ----
  "test.empty": "未收集到测试",
  "test.emptyHint": "工作区内没有找到 pytest 测试（默认收集 test_*.py 与 *_test.py）",
  // ---- test.collectError ----
  "test.collectError": "收集失败",
  "test.collectErrorHint": "pytest 收集输出（尾部）：",
  "test.retry": "重试",
  // ---- test.pytestMissing ----
  "test.pytestMissing": "未安装 pytest",
  "test.pytestMissingHint": "pytest 是项目级测试框架，Montauri 不随包分发。安装后即可收集与运行测试。",
  "test.installPytest": "安装 pytest",
  "test.installTitle": "安装 pytest",
  // ---- test.status ----
  "test.statusPassed": "通过",
  "test.statusFailed": "失败",
  "test.statusError": "错误",
  "test.statusSkipped": "跳过",
  "test.statusUnknown": "未运行",
  // ---- test.failedCount ----
  "test.failedCount.one": "{count} 个失败",
  "test.failedCount.other": "{count} 个失败",
  // ---- test.casesCount ----
  "test.casesCount.one": "{count} 个用例",
  "test.casesCount.other": "{count} 个用例",
  // ---- test ----
  "test.duration": "耗时 {ms}",
  "test.runFailed": "运行测试失败：{error}",
  "test.runBusy": "测试正在运行中",
  "test.resultMissing": "未找到测试结果（进程可能被中断），状态保持未运行",
  "test.rerunNone": "没有失败的测试",
  "test.gutterTip": "测试 {name}",
  "test.needWorkspace": "运行测试需先打开工作区",
  "test.runEcho": "> [test] pytest {nodes}",
};

/** 本域文案 key：en-US/test.ts 的 Record<TestKey, string> 由它派生。 */
export type TestKey = keyof typeof test;
