// 简体中文语言包「hotspots 域」（真源）：由 tools/i18n/apply_ts.py 从源码抽取、gen_domain.py 生成，勿手改（改动请回到源码与 data/hotspots_zh.json）。
// 复数条目（含 {count}）自动展开 .one/.other 两份——中文两形同文。
export const hotspots = {
  // ---- hotspots ----
  "hotspots.excTip": "观测到异常：{types}",
  // ---- hotspots.hitsSuffix ----
  "hotspots.hitsSuffix.one": "{count} 次",
  "hotspots.hitsSuffix.other": "{count} 次",
  // ---- hotspots ----
  "hotspots.lastRun": "末次运行 {time}",
  "hotspots.noData": "暂无运行记录",
  "hotspots.noDataHint": "运行一次项目或测试后，这里会列出跑过的函数与调用次数",
  "hotspots.noWorkspace": "未打开工作区",
  "hotspots.noWorkspaceHint": "打开后此处按调用次数列出真实跑过的函数",
  "hotspots.openAria": "打开声明并定位",
  "hotspots.rescan": "重新扫描",
  // ---- hotspots.runsCount ----
  "hotspots.runsCount.one": "累计 {count} 次运行",
  "hotspots.runsCount.other": "累计 {count} 次运行",
  // ---- hotspots ----
  "hotspots.scanFailed": "扫描失败：{error}",
  "hotspots.scanFailedShort": "扫描失败",
  "hotspots.scanning": "扫描中…",
  "hotspots.scanningHint": "正在读取运行记录并扫描工作区",
  "hotspots.sectionObserved": "已观测（按调用次数）",
  "hotspots.sectionUnobserved": "未观测到运行",
  "hotspots.staleBadge": "已改动",
  "hotspots.staleTip": "该文件在末次运行后被修改，观测可能已过期",
  "hotspots.summaryCoverage": "覆盖 {pct}%",
  // ---- hotspots.summaryObserved ----
  "hotspots.summaryObserved.one": "观测 {count} 个函数",
  "hotspots.summaryObserved.other": "观测 {count} 个函数",
  // ---- hotspots ----
  "hotspots.title": "运行时热点",
  // ---- hotspots.truncatedHint ----
  "hotspots.truncatedHint.one": "结果过多，仅显示前 {count} 条",
  "hotspots.truncatedHint.other": "结果过多，仅显示前 {count} 条",
  // ---- hotspots ----
  "hotspots.unobservedHint": "可能原因：未被测试或入口覆盖、条件分支未走到、采样遗漏——不代表死代码",
  "hotspots.zeroObserved": "没有观测到的函数",
};

/** 本域文案 key：en-US/hotspots.ts 的 Record<HotspotsKey, string> 由它派生。 */
export type HotspotsKey = keyof typeof hotspots;
