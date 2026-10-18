// 开发工具框架入口（PR-3）：内置工具以「内置插件」形态注册（§9.7 dogfooding），
// 与第三方插件走完全相同的注册路径（loader.registerBuiltinPlugin → registry），
// 面板导航与「工具」菜单自动生成对应入口。
//
// 新增内置工具只需：在 devtools/builtin/ 下写模块（mount + 可选 inline handler），
// 再在 builtin/index.ts 的 buildBuiltinManifest 与 BUILTIN_TOOL_MODULES 各加一行。

import { $ } from "../state";
import { onLocaleChange } from "../i18n"; // 第十七批 i18n：语言切换重注册内置工具（刷新 manifest 展示文案）
import { createToolHost, type DevToolsHostDeps } from "./host";
import { initDevToolsPanel, openDevTools } from "./panel";
import { setPendingRequest, type PendingRequest } from "./builtin/http";
import { registerBuiltinPlugin } from "../extensions/loader";
import { buildBuiltinManifest, BUILTIN_TOOL_MODULES } from "./builtin";

export { openDevTools, closeDevTools, openDevToolsPanel } from "./panel";
export { listDevTools } from "./registry";
export { groupToolsByCategory, PRESET_CATEGORIES, categoryLabel } from "./types";

/**
 * 内置 HTTP 工具的**全局 id**：`openDevTools` 收的是 `<pluginId>.<toolId>` 形态
 * （同 dslLens.ts 的 `montauri.builtin.regex` / jsonLiteral.ts 的 `...jsonpath`）。
 * 传裸 `"http"` 会让 `getDevTool` 返回 undefined → 静默回落到「最近使用」工具，
 * 表现为「面板开了但打开的是别的工具」——2026-10-06 由 e2e EP-S2 抓到并修。
 */
const HTTP_TOOL_ID = "montauri.builtin.http";

/**
 * 打开 HTTP 工具并预填请求（B4 PR-B4-3 端点视图联动；A5① 起可带方法与请求体）。
 * 预填值经模块级 pending 传递：工具可能是**首次挂载**（读 pending）也可能已在实例缓存中
 * （此时 `openDevTools` 只切显示，pending 会留在下一次挂载才消费——已知取舍，避免为一次
 * 联动给 panel 加跨模块回调）。
 */
export function openHttpTool(url: string, preset?: Omit<PendingRequest, "url">): void {
  setPendingRequest({ url, ...preset });
  openDevTools(HTTP_TOOL_ID);
}

/** 语言切换重注册只挂一次（重复调用 registerBuiltinTools 不重复订阅） */
let localeSubscribed = false;

/** 注册内置工具插件（幂等；devtools/index.ts 与 main.ts 均可安全调用） */
export function registerBuiltinTools(): void {
  registerBuiltinPlugin(buildBuiltinManifest(), BUILTIN_TOOL_MODULES as Record<string, never>);
  if (!localeSubscribed) {
    localeSubscribed = true;
    // 切语言后重注册：DevTool 的 title/description/inlineLabel 在注册时定格（loader 投影 manifest），
    // 重注册让 registry 拿到新语言的元数据；面板/菜单监听 registry 变更自动重绘。
    // registerBuiltinPlugin 幂等（先注销后注册），且尊重用户的插件停用状态。
    onLocaleChange(() => registerBuiltinPlugin(buildBuiltinManifest(), BUILTIN_TOOL_MODULES as Record<string, never>));
  }
}

/** 初始化框架：注册内置工具并接线面板（须在 DOM 就绪后调用一次） */
export function initDevTools(deps: DevToolsHostDeps): void {
  registerBuiltinTools();
  initDevToolsPanel(createToolHost($("devtools-body"), deps));
}
