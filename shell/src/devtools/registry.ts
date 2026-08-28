// 工具注册表：集中登记所有 DevTool，面板与菜单据此自动生成入口。

import type { DevTool } from "./types";

const tools = new Map<string, DevTool>();

/** 登记一个工具（重复 id 仅告警不覆盖） */
export function registerDevTool(tool: DevTool): void {
  if (tools.has(tool.id)) {
    console.warn(`[devtools] 重复注册工具 id=${tool.id}`);
    return;
  }
  tools.set(tool.id, tool);
}

/** 列出全部工具（插入序） */
export function listDevTools(): DevTool[] {
  return [...tools.values()];
}

/** 按 id 取工具 */
export function getDevTool(id: string): DevTool | undefined {
  return tools.get(id);
}