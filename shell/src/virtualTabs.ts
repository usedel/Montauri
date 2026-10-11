// 只读预览类 Tab 的统一分派（md 预览 · CSV 查看器）+ 虚拟 Tab 的 path 命名空间/真实路径解析。
//
// 为什么单独成模块（main.ts 拆分纪律）：md 与 csv 两个 kind 在 activateTab / renderTabs /
// closeTabSilent 里走**完全同一条链路**（摘空主编辑器模型 → 显示各自宿主 → 恒不 dirty →
// 关闭只清占位模型），若各写一份分支，main.ts 会同时吃进两份 ~14 行——逼近 2 400 行上限。
// 分派收敛到这里后，main.ts 只认「是不是虚拟预览 Tab」这一件事。
//
// 纪律：**不反向 import main.ts**——present / cleanup 由两个域模块各自实现（它们内部已经
// 用 handlers 注入解环），本模块只做「按 kind 选哪个」的纯分派。
//
// 另一职责（2026-10-11）：虚拟 Tab 的 path 不是真实文件路径（mdpreview: / csvtab: / diff: /
// db-data:），凡按 path 取真实路径的消费方（tab 右键菜单、终端默认目录）都走 tabRealPath；
// `diff:` 前缀也归口本模块，供 git.ts 复用（单一真源，防两处字面量漂移）。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, type Tab } from "./state";
import { joinPath, relativePathOrName } from "./util";
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

// ---------- 虚拟 Tab path 解析（tab 右键菜单 / 终端默认目录） ----------

/** diff tab 的 path 命名空间（与文件 tab 隔离）：`<前缀><工作区相对路径>`。
 *  归口本模块而非 git.ts 的**唯一原因**是 import 方向：termUi.ts 也要用 tabRealPath，
 *  而 git.ts → termUi.ts；若本模块反向 import git.ts 取这个常量就成环（termUi → 本模块 → git
 *  → termUi）。故常量放这里，git.ts 反向 import。 */
export const DIFF_TAB_PREFIX = "diff:";

/**
 * Tab → 真实文件绝对路径（tab 右键菜单的路径类动作 / 终端默认目录）。
 *
 * **虚拟 Tab 的 path 不可直接当文件路径用**：`mdpreview:` / `csvtab:` / `diff:` 前缀会让
 * 路径类消费方拿到一个不存在的目录——`parentDirOf("mdpreview:C:\\…\\docs\\a.md")` 得到
 * `mdpreview:C:\\…\\docs`，而 portable-pty 的 `current_directory()` 对非目录 cwd 会静默回落
 * `USERPROFILE`，症状就是「在终端打开」把终端开在了用户主目录（2026-10-11 修）。
 *
 * @returns db Tab 无对应文件（path 是 connId 哈希）→ `null`，调用方应隐藏路径类动作；
 *          其余（文件 / md 预览 / CSV 查看 / diff）恒返回可用的绝对路径。
 */
export function tabRealPath(tab: Tab): string | null {
  if (tab.kind === "db") return null;
  if (tab.kind === "diff") {
    // diff tab 只在有工作区时存在；无工作区（理论不可达）同样按「无对应文件」处理
    const root = app.workspaceRoot;
    return root ? joinPath(root, tab.path.slice(DIFF_TAB_PREFIX.length)) : null;
  }
  return isVirtualTab(tab) ? virtualTabSourcePath(tab.path) : tab.path;
}

/** 相对工作区根的路径（规则见 util.relativePathOrName）；tab 右键菜单「复制相对路径」用。
 *  入参须是 tabRealPath 的**返回值**（真实绝对路径），不是 tab.path。 */
export function tabRelativePath(path: string): string {
  return relativePathOrName(app.workspaceRoot, path);
}
