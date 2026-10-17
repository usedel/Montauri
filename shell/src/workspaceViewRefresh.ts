// 工作区就绪 / 关闭后对「当前激活侧栏视图」的补偿（main.ts 的 openWorkspace /
// closeWorkspace 收尾各一行调用）。
//
// 由来：侧栏视图的内容几乎只在 onShow（切 tab）时刷新，开关工作区都不会触发
// onShow。两个方向的缺口：
//  · 打开后（openWorkspace 收尾）：激活视图停在关闭前的残留或「未打开工作区」
//    空态——git（P1-3，2026-09-30 用户报告）与 database（B3 §10.3-8b 真机发现）
//    此前在 main.ts 内联补偿，todo / endpoints / runtime 从未补偿（2026-10-17
//    用户实案：端点面板重开工作区后仍显示「未打开工作区」）。
//  · 关闭后（closeWorkspace 收尾）：resetWorkspaceUiState 里各视图的 reset 是
//    **同步渲染**，当时 root 尚未置 null，画出的是「没有端点 / 没有待办 /
//    暂无运行记录」这类错误空态；数据库视图的 reset 干脆不渲染，整棵旧工作区的
//    树残留（2026-10-17 用户实案：端点面板关闭后显示「没有端点」）。
//
// 两个分发器都只处理「激活」视图：非激活视图的内容在用户切过去时由各自 onShow
// 自然刷新，提前重扫/重绘纯属浪费（这些都是工作区级 IO 或整树重建）。
import { activeView } from "./views";
import { renderGitPanel, refreshBranchPanel } from "./git";
import { refreshDbWorkspace, renderDbTree } from "./sqliteView";
import { refreshTodos, renderTodoPanel } from "./todoView";
import { refreshEndpoints, renderEndpointPanel } from "./endpointView";
import { refreshHotspots, renderHotspots } from "./hotspotsView";

/** openWorkspace 收尾：按当前激活视图补一次刷新（无激活视图时无操作） */
export function refreshActiveViewForWorkspace(): void {
  switch (activeView()) {
    case "git":
      // P1-3：git 状态内存已由 refreshTree 内的 refreshGitStatus 更新，这里只补 DOM
      renderGitPanel();
      void refreshBranchPanel();
      break;
    case "database":
      // B3：内部按 viewShownOnce 短路，从未显示过的视图零开销
      refreshDbWorkspace();
      break;
    case "todo":
      void refreshTodos();
      break;
    case "endpoints":
      // 2026-10-17 用户实案：关工作区再打开后停在「未打开工作区」空态
      void refreshEndpoints();
      break;
    case "runtime":
      void refreshHotspots();
      break;
    default:
      // files / search / debug / tests：内容随打开动作或各自 onShow 自然刷新，无需补偿
      break;
  }
}

/**
 * closeWorkspace 收尾（root 已置 null）：把激活视图渲染到「未打开工作区」终态。
 * git 的 P1-3 终态渲染也收口到这里（原先内联在 main.ts）。
 * default 分支无需处理：debug 视图与工作区无关；tests 的 resetTestView 经动态
 * import 解析时 root 已置 null，天然落在 noWorkspace 分支；files/search 的关闭态
 * 由 resetTreeState / resetSearch 各自覆盖。
 */
export function renderActiveViewClosed(): void {
  switch (activeView()) {
    case "git":
      renderGitPanel();
      break;
    case "todo":
      renderTodoPanel();
      break;
    case "endpoints":
      renderEndpointPanel();
      break;
    case "runtime":
      renderHotspots();
      break;
    case "database":
      renderDbTree();
      break;
    default:
      break;
  }
}
