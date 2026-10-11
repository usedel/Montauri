// Markdown 预览 Tab（open_file_dev_plan §1.3 · 批 2）。
//
// 形态：kind="md" 的只读预览 Tab，path 前缀 `mdpreview:<绝对路径>`（照 db-data:/diff: 先例——
// session 快照 / run gutter / quickopen 等按 path 工作的逻辑天然不误伤，session.ts 快照只收
// kind="file" 的 tab，预览 Tab 重启后自然消失）。
//
// 宿主：#md-preview-tab-panel 是 #editor-row 内与 #editor 互斥的浮层（照 #db-tab-panel 范式），
// 与 diff / db 宿主三方互斥（dismiss 链在 main.ts 的 activateTab，v1.4 曾漏 dismiss 出过 P0）。
//
// 渲染：复用 markdownPreview.ts 的纯函数（renderMarkdownToHtml / sanitize / 锚点 / 图片 asset 改写），
// 点击委托也复用 wireMarkdownClicks 的既有逻辑（锚点/外链/相对 md 链接）。
//
// 纪律：
// - **不反向 import main.ts**：activateTab / openFile 由 main 经 setMdPreviewTabHandlers 注入；
// - 无编辑 → 无 dirty / autosave / LSP didOpen / pendingChanges（tab.model 是占位模型，
//   随 Tab 关闭一并 dispose，照 diff tab 先例）。

import { invoke } from "@tauri-apps/api/core";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app, $ } from "./state";
import type { Tab } from "./state";
import { t } from "./i18n";
import { codicon, parentDirOf, samePath } from "./util";
import * as mdPreview from "./markdownPreview";

// ---------- 命名空间 ----------

export const MD_PREVIEW_PREFIX = "mdpreview:";

/** 预览 Tab path（mdpreview:<绝对路径>）→ 源文件绝对路径 */
export function mdPreviewSourcePath(tabPath: string): string {
  return tabPath.slice(MD_PREVIEW_PREFIX.length);
}

/** 源文件绝对路径 → 预览 Tab path */
export function mdPreviewTabPath(srcPath: string): string {
  return MD_PREVIEW_PREFIX + srcPath;
}

/** 该绝对路径的预览 Tab 是否已存在（main 的 openFile 查重用） */
export function findPreviewTab(srcPath: string): Tab | undefined {
  const p = mdPreviewTabPath(srcPath);
  return app.tabs.find((x) => x.kind === "md" && x.path === p);
}

// ---------- handlers 注入（main → 本模块；避免循环 import） ----------

export interface MdPreviewTabHandlers {
  /** 打开/激活 Tab 统一走 main 的 activateTab（renderTabs / 宿主互斥 / 会话快照都在那边） */
  activateTab: (tab: Tab) => void;
  /** 「编辑源码」/提升语义：把预览 Tab 原地转成编辑 Tab（强制 mdMode="edit"，防止设置
   *  markdown_open_mode=preview 时又开回预览形成死循环） */
  openFile: (path: string) => Promise<boolean>;
  /** 建占位模型（主编辑器 Monaco 实例的唯一真源，防多个 createModel 入口漂移） */
  createModel: (path: string) => MonacoApi.editor.ITextModel;
  /** tabbar 重渲染（关 Tab 只动数组；提升路径反转顺序后没有后续 activateTab 兜底重渲染） */
  renderTabs: () => void;
}

let handlers: MdPreviewTabHandlers | null = null;

export function setMdPreviewTabHandlers(h: MdPreviewTabHandlers): void {
  handlers = h;
}

// ---------- 打开 / 提升 ----------

/**
 * 打开（或激活）某 md 文件的预览 Tab。
 * 已存在 → 直接激活；不存在 → 建 Tab（占位模型照 diff tab 先例，随关闭 dispose）。
 */
export function openPreviewTab(srcPath: string): void {
  if (!handlers) return;
  const existing = findPreviewTab(srcPath);
  if (existing) {
    handlers.activateTab(existing);
    return;
  }
  const tab: Tab = {
    path: mdPreviewTabPath(srcPath),
    model: handlers.createModel(srcPath),
    dirty: false,
    kind: "md",
  };
  app.tabs.push(tab);
  handlers.activateTab(tab);
}

/** 「编辑源码」：打开编辑 Tab → **成功后**才关预览 Tab（main::openFile 负责建编辑 Tab / 复用既有）。
 *  openFile 走 mdMode:"edit" 通道（handlers.openFile 由 main 注入时已绑定该选项）。
 *  顺序敏感（同 csvTab.promoteCsvToEdit）：先关再开一旦打开失败（超 10MB 守卫等），
 *  预览已被拆掉且无人恢复 #editor 显隐 → 编辑区空白 + activeTab 悬空。 */
export async function promoteToEdit(srcPath: string): Promise<void> {
  const ok = await handlers?.openFile(srcPath);
  if (ok) {
    const pv = findPreviewTab(srcPath);
    if (pv) {
      closePreviewTabQuiet(pv);
      handlers?.renderTabs(); // 关 Tab 只动数组，tabbar 重渲染由 main 承担
    }
  }
}

/** 若存在该源文件的预览 Tab 则静默关闭（文件树双击提升 / 编辑源码按钮共用）。 */
export function closePreviewTabIfExists(srcPath: string): void {
  const pv = findPreviewTab(srcPath);
  if (pv) closePreviewTabQuiet(pv);
}

// ---------- 宿主呈现（main 的 activateTab md 分支调用） ----------

let panelBuilt = false;
let renderToken = 0;

/** 激活预览 Tab：显示宿主、隐藏 #editor，重渲染（外部修改可见，照 db tab 激活重拉先例）。
 *  内容来源：该文件有已打开的编辑 Tab 时取**内存 model 值**（含未保存草稿，对齐 VSCode
 *  「预览缓冲区」语义——autosave 关闭时刚写的草稿也要立刻可见）；否则 read_file 读磁盘。 */
export async function presentMdPreviewTab(tab: Tab): Promise<void> {
  ensurePanel();
  const src = mdPreviewSourcePath(tab.path);
  $("md-preview-tab-panel")?.classList.remove("hidden");
  $("editor")?.classList.add("hidden");
  // 激活即重渲染：预览 Tab 无编辑链路，内容随激活重算（后台期间外部改动/编辑草稿可见）
  const token = ++renderToken;
  // 优先内存：同名编辑 Tab 的 model 就是该文件的唯一真源（草稿在缓冲区里）。
  // samePath 归一比较（斜杠/大小写无关）——tab path 与文件树路径分隔符方向可能不同。
  const editTab = app.tabs.find((x) => x.kind !== "md" && samePath(x.path, src));
  if (editTab) {
    if (token !== renderToken) return; // 已切走：丢弃过期渲染
    renderPreviewBody(editTab.model.getValue(), src);
    return;
  }
  let content: string;
  try {
    content = await invoke<string>("read_file", { path: src });
  } catch {
    // 读失败（文件被删 / 权限）：渲染空态提示，不弹窗打断
    if (token === renderToken) renderPreviewBody(t("mdtab.readFailed"), src);
    return;
  }
  if (token !== renderToken) return; // 已切走：丢弃过期渲染
  renderPreviewBody(content, src);
}

/** 隐藏预览宿主（切回文件/diff/db Tab 或最后一个预览 Tab 关闭时；不动 Tab） */
export function dismissMdPreviewHost(): void {
  $("md-preview-tab-panel")?.classList.add("hidden");
}

/** 关闭预览 Tab 的域内清理（main 的 closeTabSilent md 分支调用；占位模型随 tab dispose） */
export function cleanupMdPreviewTab(tab: Tab): void {
  renderToken++; // 作废在途渲染
  tab.model.dispose();
  if (!app.tabs.some((x) => x.kind === "md")) dismissMdPreviewHost();
}

/** 关预览 Tab 不走确认（只读恒不 dirty；供提升语义用） */
function closePreviewTabQuiet(tab: Tab): void {
  // splice 由 main 的 closeTabSilent 承担——这里只做域内清理 + 数组移除（照 main 调用域函数的分工，
  // 避免反向 import）。activateTab 的「关后激活相邻」逻辑由 main 的 closeTab 统一处理；
  // 提升路径调用方（promoteToEdit）随后 openFile 会立刻激活新 tab，无需中间态。
  const idx = app.tabs.indexOf(tab);
  if (idx !== -1) app.tabs.splice(idx, 1);
  cleanupMdPreviewTab(tab);
}

// ---------- Tab 标题 / 图标（main 的 renderTabs 调用） ----------

/** 预览 Tab 显示名（与编辑 Tab 同名区分：`名称 预览`） */
export function mdPreviewTabLabel(tab: Tab): string {
  const src = mdPreviewSourcePath(tab.path);
  return `${src.split(/[\\/]/).pop() || src} ${t("mdtab.labelSuffix")}`;
}

/** 预览 Tab 图标 codicon 名（open-preview 与编辑 tab 的文件图标区分） */
export function mdPreviewTabIcon(): string {
  return "open-preview";
}

// ---------- 共享 DOM（单面板，多 Tab 复用；照 db-tab-panel 惰性构建） ----------

function ensurePanel(): void {
  if (panelBuilt) return;
  panelBuilt = true;
  // 宿主：#editor-row 内与 #editor 互斥（index.html 静态声明 #md-preview-tab-panel）
  const panel = $("md-preview-tab-panel");
  if (!panel) return; // 测试环境无 DOM：静默
  panel.textContent = "";
  // 工具栏：编辑源码（提升）+ 导出 HTML 复用 markdownPreview 域逻辑（按钮挂预览面板头部）
  const bar = document.createElement("div");
  bar.className = "md-preview-tab-toolbar";
  const editBtn = document.createElement("button");
  editBtn.className = "btn btn--sm";
  editBtn.appendChild(codicon("edit"));
  const label = document.createElement("span");
  label.textContent = t("mdtab.editSource");
  editBtn.appendChild(label);
  editBtn.addEventListener("click", () => {
    const cur = app.activeTab;
    if (cur && cur.kind === "md") void promoteToEdit(mdPreviewSourcePath(cur.path));
  });
  bar.appendChild(editBtn);
  panel.appendChild(bar);
  // 渲染主体：复用 markdownPreview 的容器结构与点击委托（锚点 / 相对 md / 外链）
  const body = document.createElement("div");
  body.id = "md-preview-tab-body";
  body.className = "md-preview-tab-body";
  panel.appendChild(body);
  wireBodyClicks(body);
}

/** 渲染主体：md → HTML（消毒 / 锚点 / 图片 asset 改写复用 markdownPreview 纯函数）。 */
function renderPreviewBody(md: string, srcPath: string): void {
  const body = $("md-preview-tab-body");
  if (!body) return;
  body.innerHTML = mdPreview.renderMarkdownToHtml(md, parentDirOf(srcPath));
  void mdPreview.highlightCodeBlocks(body);
}

/** 点击委托：复用 markdownPreview 的链接分类（锚点滚动 / 相对 md → openFile / 外链系统浏览器）。 */
function wireBodyClicks(body: HTMLElement): void {
  body.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    const kind = mdPreview.classifyLink(href);
    if (kind === "anchor") {
      const target = mdPreview.findAnchorTarget(body, href.slice(1));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (kind === "relative-md") {
      const cur = app.activeTab;
      if (cur && cur.kind === "md") {
        const src = mdPreviewSourcePath(cur.path);
        void handlers?.openFile(mdPreview.resolveMarkdownLinkPath(href, parentDirOf(src)));
      }
    }
    // external / other：预览 tab 内不放开（外链在编辑态分栏预览有既有通道；这里保持只读浏览语义）
  });
}
