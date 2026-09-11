// 开发工具面板（右侧辅助面板，非模态）：与编辑器同时可见、可交互。
// 工具以顶部 tab 切换；展开 / 收起只操作 #right-panel 的 .hidden，
// 不遮挡编辑器，使「插入编辑器」「复制」等动作可在编辑器保持光标/选区的前提下进行。

import { $, $btn } from "../state";
import { codicon } from "../util";
import { getDevTool, listDevTools } from "./registry";
import type { ToolHost, ToolInstance } from "./types";

const panelEl = $("right-panel");
const bodyEl = $("devtools-body");

let host: ToolHost | null = null;
let activeToolId: string | null = null;
let activeInstance: ToolInstance | null = null;

/** 渲染顶部工具切换 tab（按注册顺序） */
function renderTabs(): void {
  const tabs = $("devtools-tabs");
  tabs.textContent = "";
  for (const tool of listDevTools()) {
    const btn = document.createElement("button");
    btn.className = "devtools-tab";
    btn.dataset.toolId = tool.id;
    // UI-16：tabs 模式——所有 tab 共享 #devtools-body 这一个面板（同一时刻只挂载一个工具实例），
    // aria-selected 由 activateTool 与 .active 类同源切换
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    btn.setAttribute("aria-controls", "devtools-body");
    // UI-09：tab 已有可见文本（tool.title）作为可访问名称，description 是补充说明，只需 data-tip
    btn.dataset.tip = tool.description;
    btn.appendChild(codicon(tool.icon));
    const label = document.createElement("span");
    label.textContent = tool.title;
    btn.appendChild(label);
    btn.addEventListener("click", () => activateTool(tool.id));
    tabs.appendChild(btn);
  }
}

/** 激活指定工具：先 dispose 旧实例，再 mount 新实例到 #devtools-body */
function activateTool(id: string): void {
  if (!host || activeToolId === id) return;
  const tool = getDevTool(id);
  if (!tool) return;
  activeInstance?.dispose();
  activeInstance = null;
  bodyEl.textContent = "";
  activeToolId = id;
  activeInstance = tool.mount(host) ?? null;
  document.querySelectorAll<HTMLElement>(".devtools-tab").forEach((b) => {
    const sel = b.dataset.toolId === id;
    b.classList.toggle("active", sel);
    b.setAttribute("aria-selected", String(sel)); // UI-16
  });
}

/** 展开右侧面板并激活工具（未指定则激活第一个）；面板展开后不抢编辑器焦点 */
export function openDevTools(toolId?: string): void {
  const tools = listDevTools();
  if (tools.length === 0 || !host) return;
  const target = toolId && getDevTool(toolId) ? toolId : tools[0].id;
  activateTool(target);
  panelEl.classList.remove("hidden");
}

/** 收起右侧面板并释放当前工具实例 */
export function closeDevTools(): void {
  activeInstance?.dispose();
  activeInstance = null;
  activeToolId = null;
  panelEl.classList.add("hidden");
}

/** 初始化面板（注入 host 并接线顶部 tab 与收起按钮），须在 registerDevTool 之后调用 */
export function initDevToolsPanel(h: ToolHost): void {
  host = h;
  renderTabs();
  $btn("devtools-close").addEventListener("click", closeDevTools);
}