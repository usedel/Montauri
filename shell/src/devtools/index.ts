// 开发工具框架入口（PR-3）：内置工具以「内置插件」形态注册（§9.7 dogfooding），
// 与第三方插件走完全相同的注册路径（loader.registerBuiltinPlugin → registry），
// 面板导航与「工具」菜单自动生成对应入口。
//
// 新增内置工具只需：在 devtools/builtin/ 下写模块（mount + 可选 inline handler），
// 再在 builtin/index.ts 的 BUILTIN_MANIFEST 与 BUILTIN_TOOL_MODULES 各加一行。

import { $ } from "../state";
import { createToolHost, type DevToolsHostDeps } from "./host";
import { initDevToolsPanel } from "./panel";
import { registerBuiltinPlugin } from "../extensions/loader";
import { BUILTIN_MANIFEST, BUILTIN_TOOL_MODULES } from "./builtin";

export { openDevTools, closeDevTools, openDevToolsPanel } from "./panel";
export { listDevTools } from "./registry";
export { groupToolsByCategory, PRESET_CATEGORIES } from "./types";

/** 注册内置工具插件（幂等；devtools/index.ts 与 main.ts 均可安全调用） */
export function registerBuiltinTools(): void {
  registerBuiltinPlugin(BUILTIN_MANIFEST, BUILTIN_TOOL_MODULES as Record<string, never>);
}

/** 初始化框架：注册内置工具并接线面板（须在 DOM 就绪后调用一次） */
export function initDevTools(deps: DevToolsHostDeps): void {
  registerBuiltinTools();
  initDevToolsPanel(createToolHost($("devtools-body"), deps));
}
