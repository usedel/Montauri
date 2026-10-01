// 简体中文语言包「devtools 域」（真源）：由 tools/i18n/apply_ts.py 从源码抽取、gen_domain.py 生成，勿手改（改动请回到源码与 data/devtools_zh.json）。
// 复数条目（含 {count}）自动展开 .one/.other 两份——中文两形同文。
export const devtools = {
  // ---- devtools.panel ----
  "devtools.panel.loadFailed": "工具加载失败",
  "devtools.panel.noMatch": "无匹配工具",
  "devtools.panel.other": "其他",
  "devtools.panel.recent": "最近使用",
  "devtools.panel.retry": "重试",
  "devtools.panel.selectionNoMatch": "选区变换工具中无匹配，已显示全部工具",
  "devtools.panel.title": "开发工具",
};

/** 本域文案 key：en-US/devtools.ts 的 Record<DevtoolsKey, string> 由它派生。 */
export type DevtoolsKey = keyof typeof devtools;
