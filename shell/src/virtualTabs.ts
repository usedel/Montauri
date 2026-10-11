// 只读预览类 Tab 的统一分派（md 预览 · CSV 查看器）。
//
// 为什么单独成模块（main.ts 拆分纪律）：md 与 csv 两个 kind 在 activateTab / renderTabs /
// closeTabSilent 里走**完全同一条链路**（摘空主编辑器模型 → 显示各自宿主 → 恒不 dirty →
// 关闭只清占位模型），若各写一份分支，main.ts 会同时吃进两份 ~14 行——逼近 2 400 行上限。
// 分派收敛到这里后，main.ts 只认「是不是虚拟预览 Tab」这一件事。
//
// 纪律：**不反向 import main.ts**——present / cleanup 由两个域模块各自实现（它们内部已经
// 用 handlers 注入解环），本模块只做「按 kind 选哪个」的纯分派。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import type { Tab } from "./state";
import {
  cleanupCsvTab,
  csvSourcePath,
  csvTabIcon,
  csvTabLabel,
  dismissCsvHost,
  presentCsvTab,
  setCsvTabHandlers,
} from "./csvTab";
import {
  cleanupMdPreviewTab,
  dismissMdPreviewHost,
  mdPreviewSourcePath,
  mdPreviewTabIcon,
  mdPreviewTabLabel,
  presentMdPreviewTab,
  setMdPreviewTabHandlers,
} from "./mdPreviewTab";

/** 两个域的 handler 形态完全一致，故由本模块**一次性**向 main 收齐再转发
 *  （main.ts 因此只留一个注入点，而不是两份各 9 行的重复块——行数预算的直接动因）。 */
export interface VirtualTabHandlers {
  activateTab: (tab: Tab) => void;
  /** 打开编辑 Tab：`*Mode:"edit"` 由本模块按 kind 决定，main 只透传 opts */
  openFile: (path: string, opts?: { mdMode?: "edit"; csvMode?: "edit" }) => Promise<boolean>;
  /** 建占位模型：`ns` 决定 URI 命名空间（mdpreview / csvtab），`lang` 决定语言标记 */
  createModel: (ns: "mdpreview" | "csvtab", lang: string, path: string) => MonacoApi.editor.ITextModel;
  /** tabbar 重渲染（提升路径「成功后关查看 Tab」需要；旧顺序由后续 activateTab 兜底） */
  renderTabs: () => void;
}

export function setVirtualTabHandlers(h: VirtualTabHandlers): void {
  // md：「编辑源码」/预览内链接跳转都是显式编辑意图（不带 mdMode 会按 markdown_open_mode
  // 分回 preview，形成死循环——故必须带 mdMode:"edit"）
  setMdPreviewTabHandlers({
    activateTab: h.activateTab,
    openFile: (path) => h.openFile(path, { mdMode: "edit" }),
    createModel: (path) => h.createModel("mdpreview", "markdown", path),
    renderTabs: h.renderTabs,
  });
  // csv：查看器工具栏「以文本编辑」同理，必须带 csvMode:"edit"（否则又开回查看器）
  setCsvTabHandlers({
    activateTab: h.activateTab,
    openFile: (path) => h.openFile(path, { csvMode: "edit" }),
    createModel: (path) => h.createModel("csvtab", "plaintext", path),
    renderTabs: h.renderTabs,
  });
}

/** 只读预览类 Tab（md 预览 / CSV 查看器） */
export function isVirtualTab(tab: Tab): boolean {
  return tab.kind === "md" || tab.kind === "csv";
}

/** 呈现：显示对应宿主，并**互斥地**藏掉另一个预览宿主（两者共用 #editor-row 浮层） */
export function presentVirtualTab(tab: Tab): Promise<void> {
  if (tab.kind === "csv") {
    dismissMdPreviewHost();
    return presentCsvTab(tab);
  }
  dismissCsvHost();
  return presentMdPreviewTab(tab);
}

/** 关 Tab 的域内清理（占位模型随 tab dispose，照 diff tab 先例） */
export function cleanupVirtualTab(tab: Tab): void {
  if (tab.kind === "csv") cleanupCsvTab(tab);
  else cleanupMdPreviewTab(tab);
}

/** 隐藏全部预览宿主（切回文件 / diff / db Tab 或最后一个 Tab 关闭时） */
export function dismissVirtualHosts(): void {
  dismissMdPreviewHost();
  dismissCsvHost();
}

export function virtualTabLabel(tab: Tab): string {
  return tab.kind === "csv" ? csvTabLabel(tab) : mdPreviewTabLabel(tab);
}

export function virtualTabIcon(tab: Tab): string {
  return tab.kind === "csv" ? csvTabIcon() : mdPreviewTabIcon();
}

/** 虚拟 path → 源文件绝对路径（状态栏与 tab title 用） */
export function virtualTabSourcePath(tabPath: string): string {
  return tabPath.startsWith("csvtab:") ? csvSourcePath(tabPath) : mdPreviewSourcePath(tabPath);
}
