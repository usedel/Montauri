// 侧栏视图注册表与活动栏接线（TD-001）：从 main.ts 外提（阶段二 init 阶段化第二轮）。
//
// 只做两件事：① 把 7 个侧栏视图登记进注册表（含各自 onShow/onHide 生命周期钩子）；
// ② 把活动栏图标点击、大纲折叠态（含 localStorage 持久化）接到 DOM 上。
// 除 `refreshOutline` 属 main 私有外，其余刷新动作都由功能域直接导出——故只注入 1 个回调。

import { $ } from "./state";
import { registerSidebarView, setSidebarTab, restoreSidebarView } from "./views";
import { cancelSearch } from "./search";
import { refreshTodos } from "./todoView";
import { refreshEndpoints } from "./endpointView";
import { refreshBranchPanel, refreshGitStatus, renderGitPanel } from "./git";
import { renderDebugView } from "./debugView";
import { onDbViewShow } from "./sqliteView";

export interface SidebarViewDeps {
  /** 文件视图 onShow 时刷新大纲（main 私有：读活动 tab + 走 LSP documentSymbols） */
  refreshOutline: () => void;
}

export function wireSidebarViews(deps: SidebarViewDeps): void {
  // 侧栏视图注册表（TD-001）：单根容器 + 生命周期钩子，切换只操作注册表根节点
  registerSidebarView({
    id: "files",
    rootId: "view-files",
    tabId: "tab-files",
    onShow: () => { deps.refreshOutline(); },
  });
  registerSidebarView({
    id: "search",
    rootId: "view-search",
    tabId: "tab-search",
    onShow: () => ($("search-input") as HTMLInputElement).focus(),
    onHide: () => cancelSearch(),
  });
  // P0：TODO 工具窗——切到该视图才扫描（大仓库遍历不占用启动路径）
  registerSidebarView({
    id: "todo",
    rootId: "view-todo",
    tabId: "tab-todo",
    onShow: () => void refreshTodos(),
  });
  // F1：端点工具窗——同 TODO：切到该视图才扫描
  registerSidebarView({
    id: "endpoints",
    rootId: "view-endpoints",
    tabId: "tab-endpoints",
    onShow: () => void refreshEndpoints(),
  });
  registerSidebarView({
    id: "git",
    rootId: "view-git",
    tabId: "tab-git",
    onShow: () => {
      refreshGitStatus().then(() => {
        renderGitPanel();
        void refreshBranchPanel();
      });
    },
  });
  registerSidebarView({
    id: "debug",
    rootId: "view-debug",
    tabId: "tab-debug",
    onShow: () => renderDebugView(),
  });
  // B3：数据库侧栏——同 TODO/端点：切到该视图才拉连接列表（不在启动路径上做 IO）
  registerSidebarView({
    id: "database",
    rootId: "view-database",
    tabId: "tab-database",
    onShow: () => void onDbViewShow(),
  });

  // Activity Bar 图标（FILES / SEARCH / GIT / DEBUG）
  $("tab-files").addEventListener("click", () => setSidebarTab("files"));
  $("tab-search").addEventListener("click", () => setSidebarTab("search"));
  $("tab-todo").addEventListener("click", () => setSidebarTab("todo"));
  $("tab-endpoints").addEventListener("click", () => setSidebarTab("endpoints"));
  $("tab-git").addEventListener("click", () => setSidebarTab("git"));
  $("tab-debug").addEventListener("click", () => setSidebarTab("debug"));
  $("tab-database").addEventListener("click", () => setSidebarTab("database"));
  // 大纲折叠 / 展开（OUTLINE 并入文件视图，TD-001 附带考虑）
  // UI-16：disclosure 语义——aria-expanded 与 .collapsed 类同源切换（单一写入点），
  // 并给这个可点击 div 补键盘激活（role=button + tabindex 已在 index.html 静态声明）
  const outlineHeader = $("outline-header");
  const toggleOutline = () => {
    const collapsed = $("outline-section").classList.toggle("collapsed");
    outlineHeader.setAttribute("aria-expanded", String(!collapsed));
    try {
      localStorage.setItem("opencharm.outline_collapsed", collapsed ? "1" : "0"); // B 批：写穿持久化
    } catch {
      // 存储不可用：本次会话内仍生效
    }
  };
  outlineHeader.addEventListener("click", toggleOutline);
  outlineHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleOutline();
    }
  });
  // B 批：恢复上次的大纲折叠态（存 "1" 且默认展开 → 切一次即折叠）
  if (localStorage.getItem("opencharm.outline_collapsed") === "1") toggleOutline();
  // 初始化激活视图：优先恢复上次会话的选择（B 批持久化），无记录/非法值回退 files
  restoreSidebarView("files");
}
