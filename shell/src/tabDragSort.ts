// tab 拖拽排序（T4 · 微交互批，VSCode/PyCharm 标配）：tabbar 的 HTML5 DnD——
// dragstart 置位拖拽源，dragover 按目标 tab 左右半区算插入位（drop-before/after
// 竖线指示），drop 时 splice app.tabs 移动并重绘；顺序经 session 快照持久化
// （snapshot 按 app.tabs 顺序遍历，天然带顺序）。
//
// 从 main.ts 外提（预算红线 2,400 被破后拆分）：本模块只做纯交互编排，tab 数据
// 操作经注入的 moveTab 回调（main 持有 app.tabs 与 renderTabs——避免本模块反向
// import main 成环；renderTabs 的 h() 注入范式先例：fileTree::setFileTreeHandlers）。

import { app } from "./state";

export interface TabDragHandlers {
  /** 移动 tab 后的重绘（main::renderTabs）+ session 快照（main::scheduleSessionSave） */
  onMoved: () => void;
}

let handlers: TabDragHandlers | null = null;

/** 拖拽中的 tab 路径（dragstart 置位，drop/dragend 复位；null = 无排序拖拽进行中） */
let draggingTabPath: string | null = null;

/** 拖拽是否进行中（dragover 高频查询用；模块外只读语义经此暴露） */
export function isTabDragActive(): boolean {
  return draggingTabPath !== null;
}

/** 注入重绘回调（main 的 init 中调用，wireTabDragSort 之前） */
export function setTabDragHandlers(h: TabDragHandlers): void {
  handlers = h;
}

/** 移动 tab：把 from 移到 target 的前/后插入位。
 *  设计取舍：直接 splice app.tabs（保持引用稳定——renderTabs 等消费方持引用），
 *  不动激活 tab（VSCode 同款：拖拽只改顺序不切焦点）。纯函数（单测锁定语义）。 */
export function moveTabTo(from: string, target: string, before: boolean): void {
  const fromIdx = app.tabs.findIndex((t) => t.path === from);
  const targetIdx = app.tabs.findIndex((t) => t.path === target);
  if (fromIdx < 0 || targetIdx < 0 || fromIdx === targetIdx) return;
  const [moved] = app.tabs.splice(fromIdx, 1);
  // splice 后 target 的索引可能已位移（fromIdx < targetIdx 时 -1）——按 path 重找
  const insertIdx = app.tabs.findIndex((t) => t.path === target);
  app.tabs.splice(before ? insertIdx : insertIdx + 1, 0, moved);
  handlers?.onMoved();
}

/**
 * 给单个 tab 元素挂排序 DnD 监听（main::renderTabs 每个 tab 构造时调用）。
 * 外部拖入（文件，dataTransfer 无本栏路径）不参与排序——dragover 判
 * draggingTabPath 非空才接管。
 */
export function wireTabDnD(el: HTMLElement, tabPath: string): void {
  el.draggable = true;
  el.addEventListener("dragstart", (ev) => {
    ev.stopPropagation();
    if (!ev.dataTransfer) return;
    draggingTabPath = tabPath;
    ev.dataTransfer.setData("text/plain", tabPath);
    ev.dataTransfer.effectAllowed = "move";
  });
  el.addEventListener("dragover", (ev) => {
    if (draggingTabPath === null) return; // 外部拖入（文件）不参与排序
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer!.dropEffect = "move";
    const r = el.getBoundingClientRect();
    const before = ev.clientX < r.left + r.width / 2;
    el.classList.toggle("drop-before", before);
    el.classList.toggle("drop-after", !before);
  });
  el.addEventListener("dragleave", () => {
    el.classList.remove("drop-before", "drop-after");
  });
  el.addEventListener("drop", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.remove("drop-before", "drop-after");
    const from = draggingTabPath;
    draggingTabPath = null;
    if (from === null || from === tabPath) return;
    const before = el.classList.contains("drop-before");
    moveTabTo(from, tabPath, before);
  });
}

/** tabbar 级 dragend：拖到 tabbar 外松手 = 取消（清全局态与所有插入位指示）。
 *  init 中调用一次。 */
export function wireTabDragEnd(tabbar: HTMLElement): void {
  tabbar.addEventListener("dragend", () => {
    draggingTabPath = null;
    tabbar.querySelectorAll(".tab").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  });
}
