// 开发工具框架入口：注册内置工具 + 初始化模态面板。
// 新增工具只需：在 devtools/<tool>/ 下实现 mount + 元数据，再在此 register 即可，
// 面板导航与「工具」菜单会自动生成对应入口。

import { $ } from "../state";
import { curl2pythonTool } from "./curl2python";
import { jsonpathTool } from "./jsonpath";
import { createToolHost, type DevToolsHostDeps } from "./host";
import { initDevToolsPanel } from "./panel";
import { registerDevTool } from "./registry";

export { openDevTools, closeDevTools } from "./panel";
export { listDevTools } from "./registry";

function registerBuiltinTools(): void {
  registerDevTool(curl2pythonTool);
  registerDevTool(jsonpathTool);
}

/** 初始化框架：注册内置工具并接线面板（须在 DOM 就绪后调用一次） */
export function initDevTools(deps: DevToolsHostDeps): void {
  registerBuiltinTools();
  initDevToolsPanel(createToolHost($("devtools-body"), deps));
}