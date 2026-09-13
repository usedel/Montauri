// 文件树功能域（TD-007 迁出 main.ts）：树渲染 / 展开折叠 / 选择 / 右键菜单 /
// 文件操作（新建/重命名/复制/剪切/粘贴/删除/拖拽）/ 过滤 / 键盘导航 / 输入模态。
// 域内私有状态留在本模块；跨域共享状态经 state.ts 的 app 读写。

import { invoke } from "@tauri-apps/api/core";
import { app, $, lazyEl, statusFileEl, type Entry, type Tab } from "./state";
import { basename, codicon, ensurePyExtension, samePath, stripPyExtension, gitBadgeClass, gitStatusLabel, joinPath, parentDirOf, relativePath, renderFileIcon } from "./util";
// CR-25：状态读取改从零依赖的 gitStatusState（切断 fileTree ↔ git 的状态耦合）；
// refreshGitStatus 是运行时才调用的函数（无初始化期循环风险），保留从 git.ts 导入
import { refreshGitStatus } from "./git";
import { gitStatusOf, isGitRepoActive, isGitDirtyDir } from "./gitStatusState";
import { openTerminalAt } from "./termUi";
import * as mdPreview from "./markdownPreview"; // Markdown 预览（.md 右键「打开预览」）
import { openConfirm } from "./dialog";
import { toast, toastFail } from "./toast";
import { setSidebarTab } from "./views";
import * as lsp from "./lsp/client";
import { hideMenu, showMenu, type MenuItem } from "./menu";

// ---------- 注入（main 的 init 中 setFileTreeHandlers） ----------
// TD-13：解「fileTree.ts → main.ts」循环边——打开文件 / 重绘标签 / 静默关标签 / 插入文件头
// 都是运行时函数引用，改由 main 注入（参照 terminal.ts::setTerminalLinkHandler 先例）。

interface FileTreeHandlers {
  openFile: (path: string, revealLine?: number) => Promise<void>;
  renderTabs: () => void;
  closeTabSilent: (tab: Tab) => void;
  insertHeaderTemplate: () => Promise<boolean>;
}

let handlers: FileTreeHandlers | null = null;

/** 注入 main 域函数（main 在 init 中、wireFileTree 之前调用；树交互都发生在 init 之后） */
export function setFileTreeHandlers(h: FileTreeHandlers): void {
  handlers = h;
}

function fh(): FileTreeHandlers {
  if (!handlers) throw new Error("[OpenCharm] fileTree 尚未接线（setFileTreeHandlers 须在 init 中先于文件树交互）");
  return handlers;
}

// ---------- 域内状态 ----------

// CR-26：顶层 DOM 快照改惰性（测试环境无完整 DOM 时模块仍可被 import）
const treeEl = lazyEl("tree");

/** 内部文件剪贴板（复制/剪切） */
let fileClipboard: { paths: string[]; mode: "copy" | "cut" } | null = null;
/** 多选：当前选中的路径集合 */
const selectedPaths = new Set<string>();
/** 兼容旧逻辑：最后选中的条目 */
let selectedEntry: Entry | null = null;
/** 内联输入框是否激活（激活时屏蔽树快捷键） */
let inlineInputActive = false;
/** 树过滤关键字 */
let treeFilter = "";
/** 已展开目录路径 → 子项容器（供局部刷新） */
const dirContainers = new Map<string, { container: HTMLElement; depth: number }>();
/** 是否显示隐藏文件（dot 文件） */
let showHiddenFiles = false;
/** 已展开目录路径集合（持久化用） */
const expandedDirs = new Set<string>();

// ---------- 树渲染 ----------

export async function refreshTree(): Promise<void> {
  if (!app.workspaceRoot) return;
  await refreshGitStatus();
  treeEl.textContent = "";
  dirContainers.clear();
  expandedDirs.clear();
  dirContainers.set(app.workspaceRoot, { container: treeEl, depth: 0 });
  await buildDir(app.workspaceRoot, treeEl, 0);
}

/** 读取 dir 的一层并填充到 container（不负责登记 map） */
async function buildDir(dir: string, container: HTMLElement, depth: number): Promise<void> {
  let entries: Entry[];
  try {
    entries = await invoke<Entry[]>("read_dir", { path: dir, showHidden: showHiddenFiles });
  } catch (e) {
    console.warn("read_dir 失败", dir, e);
    return;
  }
  entries.sort((a, b) => (b.is_dir ? 1 : 0) - (a.is_dir ? 1 : 0) || a.name.localeCompare(b.name));
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    // UI-16：role=tree 的容器期望子级为 treeitem/group；占位提示自身无语义，
    // 标 presentation 避免读屏把它当成结构节点（文本内容仍会被朗读）
    empty.setAttribute("role", "presentation");
    empty.style.paddingLeft = `${8 + depth * 14}px`;
    empty.textContent = "（空）";
    container.appendChild(empty);
    return;
  }
  for (const e of entries) container.appendChild(renderTreeItem(e, depth));
}

/** 渲染单个树节点（文件/目录），含类型图标 + git 状态装饰 */
function renderTreeItem(e: Entry, depth: number): HTMLElement {
  const item = document.createElement("div");
  item.className = `tree-item ${e.is_dir ? "dir" : "file"}`;
  item.style.paddingLeft = `${8 + depth * 14}px`;
  item.title = e.path;
  item.dataset.path = e.path;
  item.tabIndex = -1; // 可聚焦但不进 tab 序列（键盘导航手动管理）
  // UI-16：tree 模式（WAI-ARIA treeitem）。容器 #tree 的 role=tree 在 index.html 静态声明；
  // 目录的展开态用 aria-expanded（toggleDir/collapseAll 与 twisty 图标同源切换）；
  // 选中态用 aria-selected（selectEntry 与 .active 类同源切换）。
  item.setAttribute("role", "treeitem");
  item.setAttribute("aria-selected", "false");
  if (e.is_dir) item.setAttribute("aria-expanded", "false");

  const twisty = document.createElement("i");
  twisty.className = "twisty" + (e.is_dir ? " codicon codicon-chevron-right" : "");

  let icon: HTMLElement;
  if (e.is_dir) {
    icon = document.createElement("span");
    icon.className = "icon";
    icon.appendChild(codicon("folder")); // 展开时切 folder-opened（toggleDir）
  } else {
    icon = renderFileIcon(e.name);
  }

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = e.name;

  item.append(twisty, icon, name);

  // 目录级变更标记（P2：父目录含变更时高亮）
  if (e.is_dir && isGitRepoActive() && app.workspaceRoot) {
    const rel = relativePath(app.workspaceRoot, e.path);
    if (isGitDirtyDir(rel)) item.classList.add("git-dirty");
  }

  // Git 状态装饰（仅 git 仓库时渲染）
  if (!e.is_dir && isGitRepoActive() && app.workspaceRoot) {
    const rel = relativePath(app.workspaceRoot, e.path);
    const st = gitStatusOf(rel);
    if (st) {
      const badge = document.createElement("span");
      badge.className = gitBadgeClass(st);
      badge.textContent = st;
      // UI-09：保留原生 title（嵌套约束）。父级 .tree-item 按「截断披露」规则保留 title=e.path，
      // 而原生 title 沿祖先链继承解析——若此处改用 data-tip，悬停徽标时会与父级 title 双重提示。
      badge.title = gitStatusLabel(st);
      item.appendChild(badge);
    }
  }

  item.addEventListener("click", (ev) => {
    selectEntry(e, item, ev);
    if (e.is_dir && !ev.ctrlKey && !ev.shiftKey) void toggleDir(item, e, depth);
    else if (!e.is_dir && !ev.ctrlKey && !ev.shiftKey) void fh().openFile(e.path);
  });
  item.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    // 右键时若未选中当前项，则单选它
    if (!selectedPaths.has(e.path)) selectEntry(e, item);
    showContextMenu(e, ev.clientX, ev.clientY);
  });
  // 拖拽支持
  item.draggable = true;
  item.addEventListener("dragstart", (ev) => {
    ev.stopPropagation();
    if (!ev.dataTransfer) return;
    ev.dataTransfer.setData("text/plain", e.path);
    ev.dataTransfer.effectAllowed = "move";
  });
  if (e.is_dir) {
    item.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", (ev) => {
      ev.stopPropagation();
      item.classList.remove("drag-over");
    });
    item.addEventListener("drop", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      item.classList.remove("drag-over");
      const srcPath = ev.dataTransfer?.getData("text/plain");
      if (srcPath && srcPath !== e.path) void dropMoveFile(srcPath, e.path);
    });
  }
  return item;
}

/** 切换 twisty 箭头方向（codicon chevron 两态） */
function setTwisty(el: HTMLElement | null, expanded: boolean): void {
  if (!el) return;
  el.classList.toggle("codicon-chevron-right", !expanded);
  el.classList.toggle("codicon-chevron-down", expanded);
}

/** 切换文件夹图标两态（folder / folder-opened） */
function setFolderIcon(item: HTMLElement, expanded: boolean): void {
  const ic = item.querySelector(".icon .codicon");
  if (!ic) return;
  ic.classList.toggle("codicon-folder", !expanded);
  ic.classList.toggle("codicon-folder-opened", expanded);
}

/** 展开/折叠目录（懒加载 + 登记 map 供局部刷新） */
async function toggleDir(item: HTMLElement, e: Entry, depth: number): Promise<void> {
  const twisty = item.querySelector(".twisty") as HTMLElement | null;
  const existing = dirContainers.get(e.path);
  if (existing) {
    existing.container.remove();
    dirContainers.delete(e.path);
    expandedDirs.delete(e.path);
    setTwisty(twisty, false);
    setFolderIcon(item, false);
    item.setAttribute("aria-expanded", "false"); // UI-16：与 twisty 图标同源
    return;
  }
  setTwisty(twisty, true);
  setFolderIcon(item, true);
  item.setAttribute("aria-expanded", "true"); // UI-16
  expandedDirs.add(e.path);
  const childContainer = document.createElement("div");
  childContainer.className = "tree-children";
  childContainer.setAttribute("role", "group"); // UI-16：treeitem 的子级分组
  childContainer.dataset.depth = String(depth + 1);
  item.insertAdjacentElement("afterend", childContainer);
  dirContainers.set(e.path, { container: childContainer, depth: depth + 1 });
  await buildDir(e.path, childContainer, depth + 1);
}

/** 局部刷新：重建受影响目录的已展开容器（不整树重载） */
export async function reloadDir(dirPath: string): Promise<void> {
  const st = dirContainers.get(dirPath);
  if (!st) return; // 未展开：下次展开时自然读到最新内容
  const normBase = dirPath.replace(/[\\/]+$/, "");
  for (const key of [...dirContainers.keys()]) {
    const nk = key.replace(/[\\/]+$/, "");
    if (nk === normBase || nk.startsWith(normBase + "\\") || nk.startsWith(normBase + "/")) {
      dirContainers.delete(key);
    }
  }
  st.container.textContent = "";
  await buildDir(dirPath, st.container, st.depth);
  dirContainers.set(dirPath, st);
}

/** 全部折叠（保留根目录，收起所有已展开子目录） */
function collapseAll(): void {
  for (const [path, st] of [...dirContainers.entries()]) {
    if (path === app.workspaceRoot) continue; // 保留根
    st.container.remove();
    dirContainers.delete(path);
    expandedDirs.delete(path);
  }
  // 重置所有 twisty 与文件夹图标为收起态（UI-16：aria-expanded 一并复位）
  treeEl.querySelectorAll<HTMLElement>(".tree-item.dir .twisty").forEach((el) => setTwisty(el, false));
  treeEl.querySelectorAll<HTMLElement>(".tree-item.dir").forEach((el) => {
    setFolderIcon(el, false);
    el.setAttribute("aria-expanded", "false");
  });
}

/** 同步「显示隐藏文件」开关按钮的视觉态与提示——.active / data-tip / aria-label / aria-pressed 的单一来源。
 *
 *  UI-09 顺带修掉两个既有缺陷：
 *  1. 双重提示：index.html 上本按钮已带静态 data-tip，而这里又动态设 title，两个 tooltip 会同时弹出；
 *  2. 状态失同步：原先 toggleHiddenFiles 与 resetTreeState 各改一半状态——关闭工作区时
 *     resetTreeState 只把 showHiddenFiles 复位为 false，却不清 .active 与提示文案，
 *     导致按钮残留高亮、下次点击时视觉与真实状态相反。收敛到本函数后两处共用同一套写入。 */
function syncHiddenFilesBtn(): void {
  // 不用 $()：$ 在元素缺失时抛错，而本函数会在 closeWorkspace 路径上被调用，
  // 精简 DOM（如单测）环境下按钮可能不存在，此处按「无按钮则跳过」处理。
  const btn = document.getElementById("btn-tree-hidden");
  if (!btn) return;
  const tip = showHiddenFiles ? "隐藏 dot 文件" : "显示 dot 文件";
  btn.classList.toggle("active", showHiddenFiles);
  btn.dataset.tip = tip;
  // 图标按钮：内部 <i> 带 aria-hidden，可访问名称须由 aria-label 承担；
  // 开关态用 aria-pressed 表达，与 .active 类同源写入，避免二者不一致。
  btn.setAttribute("aria-label", tip);
  btn.setAttribute("aria-pressed", String(showHiddenFiles));
}

/** 切换显示/隐藏隐藏文件 */
async function toggleHiddenFiles(): Promise<void> {
  showHiddenFiles = !showHiddenFiles;
  syncHiddenFilesBtn();
  await refreshTreeWithExpandedState();
}

/** 刷新树并恢复之前的展开状态 */
export async function refreshTreeWithExpandedState(): Promise<void> {
  if (!app.workspaceRoot) return;
  const prevExpanded = new Set(expandedDirs);
  await refreshGitStatus();
  treeEl.textContent = "";
  dirContainers.clear();
  expandedDirs.clear();
  dirContainers.set(app.workspaceRoot, { container: treeEl, depth: 0 });
  await buildDir(app.workspaceRoot, treeEl, 0);
  // 恢复之前展开的目录（仅恢复仍存在的）
  for (const dir of prevExpanded) {
    if (dir === app.workspaceRoot) continue;
    const itemEl = treeEl.querySelector<HTMLElement>(`.tree-item[data-path="${CSS.escape(dir)}"]`);
    if (itemEl) {
      const entry = entryFromEl(itemEl);
      if (entry?.is_dir) {
        await toggleDir(itemEl, entry, depthOf(itemEl));
      }
    }
  }
}

/** UI-16：选中态的单一写入点——.active 类（视觉）与 aria-selected（读屏）必须同源，
 *  散落两写必然漂移（第四批 syncHiddenFilesBtn 同款教训）。 */
function setTreeItemSelected(el: HTMLElement, selected: boolean): void {
  el.classList.toggle("active", selected);
  el.setAttribute("aria-selected", String(selected));
}

/** 选中树节点（支持 Ctrl 多选、Shift 范围选） */
function selectEntry(e: Entry, itemEl?: HTMLElement, ev?: MouseEvent): void {
  const ctrl = ev?.ctrlKey || ev?.metaKey;
  const shift = ev?.shiftKey;

  if (ctrl && itemEl) {
    // Ctrl+点击：切换选中状态
    if (selectedPaths.has(e.path)) {
      selectedPaths.delete(e.path);
      setTreeItemSelected(itemEl, false);
    } else {
      selectedPaths.add(e.path);
      setTreeItemSelected(itemEl, true);
    }
    selectedEntry = e;
    return;
  }

  if (shift && itemEl && selectedEntry) {
    // Shift+点击：范围选择
    const items = Array.from(treeEl.querySelectorAll<HTMLElement>(".tree-item"));
    const startEl = items.find((el) => el.dataset.path === selectedEntry!.path);
    const startIdx = startEl ? items.indexOf(startEl) : 0;
    const endIdx = items.indexOf(itemEl);
    const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    selectedPaths.clear();
    clearTreeSelection();
    for (let i = lo; i <= hi; i++) {
      const p = items[i].dataset.path;
      if (p) selectedPaths.add(p);
      setTreeItemSelected(items[i], true);
    }
    selectedEntry = e;
    return;
  }

  // 普通点击：单选
  selectedPaths.clear();
  selectedPaths.add(e.path);
  selectedEntry = e;
  clearTreeSelection();
  if (itemEl) setTreeItemSelected(itemEl, true);
}

/** 清除全树选中高亮（.active 与 aria-selected 同步复位） */
function clearTreeSelection(): void {
  treeEl.querySelectorAll<HTMLElement>(".tree-item.active").forEach((el) => setTreeItemSelected(el, false));
}

/** 获取当前所有选中的 Entry */
function getSelectedEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const p of selectedPaths) {
    const el = treeEl.querySelector<HTMLElement>(`.tree-item[data-path="${CSS.escape(p)}"]`);
    if (el) {
      const entry = entryFromEl(el);
      if (entry) entries.push(entry);
    }
  }
  return entries.length > 0 ? entries : (selectedEntry ? [selectedEntry] : []);
}

// ---------- 右键菜单 ----------

export interface CtxItem {
  label?: string;
  sep?: boolean;
  danger?: boolean;
  action?: () => void;
}

function showContextMenu(entry: Entry, x: number, y: number): void {
  const multi = selectedPaths.size > 1;
  const items: CtxItem[] = [
    { label: "新建文件", action: () => createFileAt(entry) },
    { label: "新建文件夹", action: () => createDirAt(entry) },
    { label: "新建 Python 文件", action: () => void createPyFileAt(entry) },
    { label: "新建 Python 包", action: () => void createPyPackageAt(entry) },
    { sep: true },
  ];
  if (fileClipboard) {
    items.push({ label: "粘贴", action: () => pasteEntry(entry) }, { sep: true });
  }
  if (!multi) {
    items.push({ label: "重命名", action: () => renameEntry(entry) });
  }
  items.push(
    { label: multi ? `删除 ${selectedPaths.size} 项` : "删除", danger: true, action: () => void deleteSelected() },
    { sep: true },
    { label: multi ? `复制 ${selectedPaths.size} 项` : "复制", action: () => copySelected() },
    { label: multi ? `剪切 ${selectedPaths.size} 项` : "剪切", action: () => cutSelected() },
  );
  if (!multi) {
    items.push({ label: "复制路径", action: () => copyEntryPath(entry) });
  }
  items.push(
    { sep: true },
    { label: "在终端中打开", action: () => void openTerminalAt(entry.is_dir ? entry.path : parentDirOf(entry.path)) },
    { label: "在资源管理器中显示", action: () => revealEntry(entry) },
  );
  // Markdown 预览（markdown preview dev plan §5-T4）：.md 文件右键「打开预览」= 打开 + 开启分栏
  if (!entry.is_dir && mdPreview.isMarkdownPath(entry.path)) {
    items.push(
      { sep: true },
      { label: "打开预览", action: () => { mdPreview.setPreviewOpen(true); void fh().openFile(entry.path); } },
    );
  }

  renderCtxMenu(items, x, y);
}

/** 渲染右键菜单（通用：树/标签/分支共用）。C1 起为 menu.ts 的薄封装：
 *  CtxItem → MenuItem 映射后交给 showMenu，关闭接线已随渲染器收编到 menu.ts。 */
export function renderCtxMenu(items: CtxItem[], x: number, y: number): void {
  const mapped: MenuItem[] = items.map((it) => ({
    label: it.label,
    sep: it.sep,
    danger: it.danger,
    action: it.action,
  }));
  showMenu(mapped, { x, y });
}

export function hideContextMenu(): void {
  hideMenu();
}

// ---------- 输入模态（新建/重命名） ----------

/** 是否有任一模态框打开（打开时禁用文件树 F2/Del 快捷键）。
 * 模态多为懒创建（lt-modal 等随首次打开才建 DOM），必须用 getElementById——
 * $ 在元素缺失时抛「缺少元素」错（E2E 实测：未打开过 live-templates 时 F2 触发即崩）。 */
function anyModalOpen(): boolean {
  return [
    "confirm-modal",
    "env-modal",
    "settings-modal",
    "new-project-modal",
    "lt-modal",
    "surround-modal",
    "palette-modal",
  ].some((id) => {
    const m = document.getElementById(id);
    return m !== null && !m.classList.contains("hidden");
  });
}

/** 焦点是否位于可编辑控件（搜索框/过滤框等输入场景，应屏蔽文件树 F2/Del 快捷键） */
function isEditableFocused(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

// ---------- 文件操作（P25-T02） ----------

/** 内联输入框：在树中指定位置创建输入行，返回用户输入（取消返回 null） */
function inlineInput(container: HTMLElement, beforeEl: HTMLElement | null, initial: string, depth: number, selectStem = false): Promise<string | null> {
  return new Promise((resolve) => {
    inlineInputActive = true;
    const row = document.createElement("div");
    row.className = "tree-item inline-input-row";
    // UI-16：借用 .tree-item 只为行高/内边距样式，它不是树节点（role=tree 容器里
    // 出现第二个 treeitem 语义会误导读屏），标 presentation；内部 input 语义不受影响
    row.setAttribute("role", "presentation");
    row.style.paddingLeft = `${8 + depth * 14}px`;
    const input = document.createElement("input");
    input.className = "inline-input";
    input.type = "text";
    input.value = initial;
    input.spellcheck = false;
    row.appendChild(input);
    if (beforeEl) container.insertBefore(row, beforeEl);
    else container.appendChild(row);

    let finished = false;
    const finish = (val: string | null) => {
      if (finished) return;
      finished = true;
      inlineInputActive = false;
      row.remove();
      resolve(val);
    };
    input.title = "Enter 确认 · Esc 取消";
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // 防止触发树快捷键
      if (e.key === "Enter") finish(input.value.trim() || null);
      else if (e.key === "Escape") finish(null);
    });
    // P1（UX 审查）：blur = 取消而非提交——原先点击别处会被误当作确认，
    // 半输入的文件名/新名直接落盘（误建文件 / 误重命名）。提交必须显式按 Enter。
    input.addEventListener("blur", () => finish(null));
    setTimeout(() => {
      input.focus();
      if (selectStem) {
        const dot = initial.lastIndexOf(".");
        input.setSelectionRange(0, dot > 0 ? dot : initial.length);
      } else {
        input.select();
      }
    }, 0);
  });
}

/** 新建文件（内联输入，支持相对路径 pkg/mod.py；创建后立即打开） */
export async function createFileAt(entry: Entry): Promise<void> {
  const base = entry.is_dir ? entry.path : parentDirOf(entry.path);
  const st = dirContainers.get(base);
  const container = st?.container ?? treeEl;
  const depth = st ? st.depth : 0;
  const rel = await inlineInput(container, null, "", depth);
  if (!rel) return;
  const target = joinPath(base, rel);
  try {
    await invoke("create_file", { path: target });
  } catch (e) {
    console.error("新建文件失败", e);
    toastFail("新建文件", e);
    return;
  }
  await reloadDir(base);
  await fh().openFile(target);
}

/** P1（UX 审查）：全局「新建文件」入口（键位 Ctrl+Alt+Insert）。
 *  目标目录 = 活动文件所在目录（无活动文件时为工作区根）；目标目录已展开时先展开它，
 *  让内联输入框出现在目标目录之下（父链未展开等查不到元素时回落到树根部，行为同右键）。
 *  setSidebarTab 经 views.ts 注入无环（views 零依赖）。 */
export async function createFileInteractive(): Promise<void> {
  if (!app.workspaceRoot) return;
  setSidebarTab("files"); // 输入框在树里，先保证文件视图可见
  const tab = app.activeTab;
  const base = tab ? parentDirOf(tab.path) : app.workspaceRoot;
  if (base !== app.workspaceRoot && !dirContainers.has(base)) {
    const dirEl = treeEl.querySelector<HTMLElement>(`.tree-item.dir[data-path="${CSS.escape(base)}"]`);
    const dirEntry = dirEl ? entryFromEl(dirEl) : null;
    if (dirEl && dirEntry) await toggleDir(dirEl, dirEntry, depthOf(dirEl));
  }
  await createFileAt({ name: basename(base), path: base, is_dir: true });
}

/** 新建文件夹（内联输入，支持嵌套路径） */
export async function createDirAt(entry: Entry): Promise<void> {
  const base = entry.is_dir ? entry.path : parentDirOf(entry.path);
  const st = dirContainers.get(base);
  const container = st?.container ?? treeEl;
  const depth = st ? st.depth : 0;
  const rel = await inlineInput(container, null, "", depth);
  if (!rel) return;
  const target = joinPath(base, rel);
  try {
    await invoke("create_dir", { path: target });
  } catch (e) {
    console.error("新建文件夹失败", e);
    toastFail("新建文件夹", e);
    return;
  }
  await reloadDir(base);
}

/** 新建 Python 文件（.py/.pyw）：自动补扩展名，创建后立即打开并插入 header 文件头（若模板可用） */
export async function createPyFileAt(entry: Entry): Promise<void> {
  const base = entry.is_dir ? entry.path : parentDirOf(entry.path);
  const st = dirContainers.get(base);
  const container = st?.container ?? treeEl;
  const depth = st ? st.depth : 0;
  const rel = await inlineInput(container, null, "", depth);
  if (!rel) return;
  const target = joinPath(base, ensurePyExtension(rel));
  try {
    await invoke("create_file", { path: target });
  } catch (e) {
    console.error("新建 Python 文件失败", e);
    toastFail("新建 Python 文件", e);
    return;
  }
  await reloadDir(base);
  await fh().openFile(target);
  app.editor.setPosition({ lineNumber: 1, column: 1 });
  await fh().insertHeaderTemplate();
}

/** 新建 Python 包：目录 + 空 __init__.py（后端原子命令）；不自动打开文件 */
export async function createPyPackageAt(entry: Entry): Promise<void> {
  const base = entry.is_dir ? entry.path : parentDirOf(entry.path);
  const st = dirContainers.get(base);
  const container = st?.container ?? treeEl;
  const depth = st ? st.depth : 0;
  const rel = await inlineInput(container, null, "", depth);
  if (!rel) return;
  const target = joinPath(base, stripPyExtension(rel));
  try {
    await invoke("create_py_package", { path: target });
  } catch (e) {
    console.error("新建 Python 包失败", e);
    toastFail("新建 Python 包", e);
    return;
  }
  await reloadDir(base);
}

/** 重命名（内联输入，磁盘层面 + 树刷新 + 标签联动） */
async function renameEntry(entry: Entry): Promise<void> {
  const oldPath = entry.path;
  const itemEl = treeEl.querySelector<HTMLElement>(`.tree-item[data-path="${CSS.escape(oldPath)}"]`);
  if (!itemEl) return;
  const container = itemEl.parentElement!;
  const depth = depthOf(itemEl);

  const rel = await inlineInput(container, itemEl, entry.name, depth, true);
  if (!rel || rel === entry.name) return;
  const newPath = joinPath(parentDirOf(oldPath), rel);
  try {
    await invoke("rename_path", { oldPath, newPath });
  } catch (e) {
    console.error("重命名失败", e);
    toastFail("重命名", e);
    return;
  }
  await handleRenameLinks(oldPath, newPath);
  await reloadDir(parentDirOf(oldPath));
  if (selectedEntry) selectedEntry = { ...selectedEntry, path: newPath, name: rel };
  selectedPaths.delete(oldPath);
  selectedPaths.add(newPath);
}

/**
 * T03 重命名联动：磁盘改名已完成，这里迁移打开中的标签路径 + LSP didClose/didOpen
 * + 诊断缓存 key。内容不重新读盘（文件仍在磁盘，model 内容不变）。
 * 支持目录重命名：其下所有打开文件路径一起迁移。
 */
async function handleRenameLinks(oldPath: string, newPath: string): Promise<void> {
  const normOld = oldPath.replace(/[\\/]+$/, "");
  const matches = app.tabs.filter(
    (t) =>
      t.path === oldPath ||
      t.path.startsWith(normOld + "\\") ||
      t.path.startsWith(normOld + "/"),
  );
  for (const t of matches) {
    const oldTabPath = t.path;
    const newTabPath = newPath + oldTabPath.slice(oldPath.length);
    lsp.didClose(oldTabPath); // 关闭旧路径（引擎侧）
    lsp.migrateDiagnostics(oldTabPath, newTabPath); // 诊断缓存 key 迁移
    t.path = newTabPath;
    lsp.markModelPath(t.model, newTabPath);
    lsp.didOpen(newTabPath, t.model); // 以新路径重开（内容不变）
    if (app.pendingChanges.has(oldTabPath)) {
      app.pendingChanges.delete(oldTabPath);
      app.pendingChanges.add(newTabPath);
    }
    if (app.activeTab === t) statusFileEl.textContent = newTabPath;
  }
  fh().renderTabs();
}

/** 复制选中项到内部剪贴板 */
function copySelected(): void {
  const paths = [...selectedPaths];
  if (paths.length === 0 && selectedEntry) paths.push(selectedEntry.path);
  fileClipboard = { paths, mode: "copy" };
}

/** 剪切选中项 */
function cutSelected(): void {
  const paths = [...selectedPaths];
  if (paths.length === 0 && selectedEntry) paths.push(selectedEntry.path);
  fileClipboard = { paths, mode: "cut" };
  // 视觉上标记被剪切的项
  treeEl.querySelectorAll(".tree-item.cut").forEach((el) => el.classList.remove("cut"));
  for (const p of paths) {
    const el = treeEl.querySelector<HTMLElement>(`.tree-item[data-path="${CSS.escape(p)}"]`);
    el?.classList.add("cut");
  }
}

/** 粘贴（复制模式：同名加副本；剪切模式：移动） */
async function pasteEntry(entry: Entry): Promise<void> {
  if (!fileClipboard) return;
  const targetDir = entry.is_dir ? entry.path : parentDirOf(entry.path);
  const srcPaths = fileClipboard.paths;
  const mode = fileClipboard.mode;

  // UX P0-2：剪切（移动）不支持覆盖——目标目录已存在同名项时先拦截并提示，
  // 而不是让 rename_path 逐个报错后才知情（复制模式后端自动加「副本」，无同名冲突）。
  let moves = srcPaths;
  if (mode === "cut") {
    const skipped: string[] = [];
    moves = [];
    for (const src of srcPaths) {
      const name = basename(src);
      // 原地粘贴（目标 = 源位置）：不算同名冲突，交给循环内 src === dst 的跳过逻辑
      if (await dirHasEntry(targetDir, name) && !samePath(joinPath(targetDir, name), src)) skipped.push(name);
      else moves.push(src);
    }
    if (skipped.length > 0) {
      toast(`目标目录已存在同名项，已跳过：${skipped.join("、")}（移动不支持覆盖）`);
    }
    if (moves.length === 0) return; // 全部被跳过：剪贴板与 .cut 标记保持原状
  }

  const failed: string[] = [];
  for (const src of moves) {
    try {
      if (mode === "cut") {
        const newName = basename(src);
        const dst = joinPath(targetDir, newName);
        if (src === dst) continue;
        await invoke("rename_path", { oldPath: src, newPath: dst });
        await handleRenameLinks(src, dst);
      } else {
        await invoke<string>("paste_path", { src, dstDir: targetDir });
      }
    } catch (e) {
      console.error("粘贴失败", src, e);
      failed.push(basename(src));
    }
  }
  // UX P0-1：部分失败要有汇总反馈（原先只 console.error，用户以为粘贴成功）
  if (failed.length > 0) toast(`粘贴 ${failed.length} 项失败：${failed.join("、")}`, "error");

  // 剪切完成后清除剪贴板和视觉标记
  if (mode === "cut") {
    fileClipboard = null;
    treeEl.querySelectorAll(".tree-item.cut").forEach((el) => el.classList.remove("cut"));
    // 刷新源目录
    const srcDirs = new Set(srcPaths.map((p) => parentDirOf(p)));
    for (const d of srcDirs) {
      if (dirContainers.has(d)) await reloadDir(d);
    }
  }
  // 刷新目标目录
  await reloadDir(targetDir);
}

/** 删除所有选中项 */
async function deleteSelected(): Promise<void> {
  const entries = getSelectedEntries();
  if (entries.length === 0) return;
  const msg = entries.length === 1
    ? `确认删除「${entries[0].path}」？\n删除后将移入系统回收站（可恢复）。`
    : `确认删除 ${entries.length} 个选中项？\n删除后将移入系统回收站（可恢复）。`;
  const ok = await openConfirm({ message: msg, okLabel: "删除", kind: "danger" });
  if (!ok) return;

  const affectedDirs = new Set<string>();
  const failed: string[] = [];
  for (const entry of entries) {
    try {
      await invoke("trash_path", { path: entry.path });
    } catch (e) {
      console.error("删除失败", entry.path, e);
      failed.push(basename(entry.path));
      continue;
    }
    // 关闭打开中的标签
    for (const t of [...app.tabs]) {
      if (t.path === entry.path || t.path.startsWith(entry.path + "\\") || t.path.startsWith(entry.path + "/")) {
        fh().closeTabSilent(t);
      }
    }
    affectedDirs.add(parentDirOf(entry.path));
  }
  selectedPaths.clear();
  selectedEntry = null;
  // UX P0-1：失败项要有可见反馈
  if (failed.length > 0) toast(`删除 ${failed.length} 项失败：${failed.join("、")}`, "error");
  for (const d of affectedDirs) {
    if (dirContainers.has(d)) await reloadDir(d);
  }
}

/** 目标目录下是否已存在同名项（Windows 文件系统大小写不敏感，比较归一小写）。
 *  UX P0-2：移动/剪切不支持覆盖，冲突在动手前拦截并提示。目录读不到时返回 false，
 *  让后续 rename_path 自己报错（走 toastFail，不吞真实原因）。 */
async function dirHasEntry(dir: string, name: string): Promise<boolean> {
  try {
    const entries = await invoke<Entry[]>("read_dir", { path: dir, showHidden: true });
    const lower = name.toLowerCase();
    return entries.some((e) => e.name.toLowerCase() === lower);
  } catch {
    return false;
  }
}

/** 拖拽移动文件到目标目录 */
async function dropMoveFile(srcPath: string, targetDirPath: string): Promise<void> {
  // 不能移动到自身或自身的子目录（UX P0-2：原先静默拒绝，用户不知道拖拽为什么没生效）
  if (srcPath === targetDirPath) return;
  if (targetDirPath.startsWith(srcPath + "\\") || targetDirPath.startsWith(srcPath + "/")) {
    toast("不能把文件夹移动到它自己的子目录里");
    return;
  }
  const newName = basename(srcPath);
  const dst = joinPath(targetDirPath, newName);
  if (srcPath === dst) return;
  // UX P0-2：目标同名先拦截（移动不支持覆盖）
  if (await dirHasEntry(targetDirPath, newName)) {
    toast(`目标目录已存在同名项「${newName}」，已取消移动（不支持覆盖）`);
    return;
  }
  try {
    await invoke("rename_path", { oldPath: srcPath, newPath: dst });
  } catch (e) {
    console.error("拖拽移动失败", e);
    toastFail("拖拽移动", e);
    return;
  }
  await handleRenameLinks(srcPath, dst);
  const srcDir = parentDirOf(srcPath);
  if (dirContainers.has(srcDir)) await reloadDir(srcDir);
  if (dirContainers.has(targetDirPath)) await reloadDir(targetDirPath);
}

/** 绝对路径写入系统剪贴板 */
async function copyEntryPath(entry: Entry): Promise<void> {
  try {
    await invoke("copy_to_clipboard", { text: entry.path });
  } catch (e) {
    console.error("复制路径失败", e);
    toastFail("复制路径", e);
  }
}

/** 在资源管理器中显示并选中 */
async function revealEntry(entry: Entry): Promise<void> {
  try {
    await invoke("reveal_in_explorer", { path: entry.path });
  } catch (e) {
    console.error("打开资源管理器失败", e);
    toastFail("打开资源管理器", e);
  }
}

// ---------- 事件接线 ----------

/** 接线文件树全部交互：工具栏按钮 + 过滤框 + 树全局事件（原 init 内片段 + wireFileTreeEvents） */
export function wireFileTree(): void {
  // 文件树工具栏按钮
  $("btn-tree-refresh").addEventListener("click", () => void refreshTreeWithExpandedState());
  $("btn-tree-collapse").addEventListener("click", collapseAll);
  $("btn-tree-hidden").addEventListener("click", () => void toggleHiddenFiles());
  // 文件树过滤
  const filterInput = $("tree-filter-input") as HTMLInputElement;
  filterInput.addEventListener("input", () => {
    treeFilter = filterInput.value.trim();
    applyTreeFilter();
  });
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      filterInput.value = "";
      treeFilter = "";
      applyTreeFilter();
      filterInput.blur();
    }
    e.stopPropagation(); // 防止触发树快捷键
  });
  wireFileTreeEvents();
}

/** 树全局事件：空白处右键（根级新建）、F2/Del、菜单点击外部关闭、键盘导航 */
function wireFileTreeEvents(): void {
  // 树空白处右键 → 以工作区根为作用目标
  treeEl.addEventListener("contextmenu", (ev) => {
    if (ev.target === treeEl && app.workspaceRoot) {
      ev.preventDefault();
      showContextMenu({ name: basename(app.workspaceRoot), path: app.workspaceRoot, is_dir: true }, ev.clientX, ev.clientY);
    }
  });
  // 树容器级拖放：拖到空白处 = 移动到工作区根目录
  treeEl.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  });
  treeEl.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const srcPath = ev.dataTransfer?.getData("text/plain");
    if (srcPath && app.workspaceRoot) {
      void dropMoveFile(srcPath, app.workspaceRoot);
    }
  });
  // 右键菜单的关闭接线已随渲染器收编到 menu.ts（document click + Escape），此处不再重复接线。
  window.addEventListener("keydown", (e) => {
    // 模态/内联输入框打开时不处理文件树快捷键
    if (anyModalOpen() || inlineInputActive) return;
    const inEditor = !!document.activeElement?.closest(".monaco-editor");
    if (inEditor) return;
    // 焦点在输入控件（如搜索框）时不触发文件树快捷键：
    // 否则选中过文件后在搜索框按 Delete 会误弹删除确认、F2 会误触重命名
    if (isEditableFocused()) return;

    // 树键盘导航（焦点在树内或无选中时）
    const treeFocused = treeEl.contains(document.activeElement) || document.activeElement === treeEl;
    if (treeFocused && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) {
      e.preventDefault();
      handleTreeKeyNav(e.key);
      return;
    }

    if (!selectedEntry) return;
    if (e.key === "F2") {
      e.preventDefault();
      void renameEntry(selectedEntry);
    } else if (e.key === "Delete") {
      e.preventDefault();
      void deleteSelected();
    }
  });
  // 树容器聚焦时支持键盘导航
  treeEl.tabIndex = 0;
  treeEl.addEventListener("keydown", (e) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(e.key)) {
      e.preventDefault();
      handleTreeKeyNav(e.key);
    }
  });
}

/** 树键盘导航：↑↓ 移动焦点、→ 展开、← 折叠、Enter 打开 */
function handleTreeKeyNav(key: string): void {
  const items = Array.from(treeEl.querySelectorAll<HTMLElement>(".tree-item"));
  if (items.length === 0) return;

  const current = document.activeElement?.closest(".tree-item") as HTMLElement | null;
  const idx = current ? items.indexOf(current) : -1;

  switch (key) {
    case "ArrowDown": {
      const next = items[Math.min(idx + 1, items.length - 1)] ?? items[0];
      focusTreeItem(next);
      break;
    }
    case "ArrowUp": {
      const prev = items[Math.max(idx - 1, 0)] ?? items[0];
      focusTreeItem(prev);
      break;
    }
    case "ArrowRight": {
      if (!current) break;
      const entry = entryFromEl(current);
      if (entry?.is_dir && !dirContainers.has(entry.path)) {
        void toggleDir(current, entry, depthOf(current));
      }
      break;
    }
    case "ArrowLeft": {
      if (!current) break;
      const entry = entryFromEl(current);
      if (entry?.is_dir && dirContainers.has(entry.path)) {
        void toggleDir(current, entry, depthOf(current));
      }
      break;
    }
    case "Enter": {
      if (!current) break;
      const entry = entryFromEl(current);
      if (entry) {
        selectEntry(entry, current);
        if (entry.is_dir) void toggleDir(current, entry, depthOf(current));
        else void fh().openFile(entry.path);
      }
      break;
    }
  }
}

/** 聚焦树节点并同步选中状态 */
function focusTreeItem(el: HTMLElement): void {
  el.focus();
  const entry = entryFromEl(el);
  if (entry) selectEntry(entry, el);
}

/** 从 DOM 元素反查 Entry（通过 dataset.path） */
function entryFromEl(el: HTMLElement): Entry | null {
  const path = el.dataset.path;
  if (!path) return null;
  const name = basename(path);
  const isDir = el.classList.contains("dir");
  return { name, path, is_dir: isDir };
}

/** 获取树节点的深度（通过 paddingLeft 反推） */
function depthOf(el: HTMLElement): number {
  const pl = parseInt(el.style.paddingLeft || "8", 10);
  return Math.max(0, Math.round((pl - 8) / 14));
}

// ---------- 文件树过滤 ----------

/** 应用过滤：隐藏名称不匹配的节点（目录若有匹配子项则保留） */
function applyTreeFilter(): void {
  const keyword = treeFilter.toLowerCase();
  const items = treeEl.querySelectorAll<HTMLElement>(".tree-item");
  if (!keyword) {
    // 清除过滤：显示所有
    items.forEach((el) => el.classList.remove("filtered-out"));
    treeEl.querySelectorAll(".tree-empty.filtered-out").forEach((el) => el.classList.remove("filtered-out"));
    return;
  }
  // 先标记所有项
  for (const item of items) {
    const name = item.querySelector(".name")?.textContent?.toLowerCase() ?? "";
    const match = name.includes(keyword);
    item.classList.toggle("filtered-out", !match);
  }
  // 目录：若其子容器内有匹配项，则目录本身也显示
  for (const [dirPath, st] of dirContainers) {
    if (dirPath === app.workspaceRoot) continue;
    const hasVisibleChild = st.container.querySelector(".tree-item:not(.filtered-out)");
    if (hasVisibleChild) {
      const dirEl = treeEl.querySelector<HTMLElement>(`.tree-item[data-path="${CSS.escape(dirPath)}"]`);
      dirEl?.classList.remove("filtered-out");
    }
  }
}

// ---------- 供 main.ts 查询/复位 ----------

/** 目录是否已展开（文件监听增量刷新用） */
export function isDirExpanded(dirPath: string): boolean {
  return dirContainers.has(dirPath);
}

/** 树是否为空（首次监听整树刷新判定用） */
export function isTreeEmpty(): boolean {
  return treeEl.children.length === 0;
}

/** 关闭工作区时复位文件树状态（由 main.ts closeWorkspace 调用） */
export function resetTreeState(): void {
  showHiddenFiles = false;
  syncHiddenFilesBtn(); // UI-09：同步复位按钮的 .active / 提示 / aria 态（此前遗漏，详见该函数注释）
  expandedDirs.clear();
  treeEl.textContent = "";
  dirContainers.clear();
}
