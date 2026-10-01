// English (US) 语言包「devtools 域」：key 与 zh-CN/devtools.ts 一一对应，Record<DevtoolsKey, string> 在编译期强校验漏译。
import type { DevtoolsKey } from "../zh-CN/devtools";

export const devtools: Record<DevtoolsKey, string> = {
  // ---- devtools.panel ----
  "devtools.panel.loadFailed": "Tool failed to load",
  "devtools.panel.noMatch": "No matching tools",
  "devtools.panel.other": "Other",
  "devtools.panel.recent": "Recently used",
  "devtools.panel.retry": "Retry",
  "devtools.panel.selectionNoMatch": "No matches among selection tools; showing all tools",
  "devtools.panel.title": "Dev Tools",
};
