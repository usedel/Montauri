// 工作区就绪 / 关闭后对「当前激活侧栏视图」的补偿（main.ts 的 openWorkspace /
// closeWorkspace 收尾各一行调用）。
//
// 由来：侧栏视图内容几乎只在 onShow（切 tab）时刷新，开关工作区都不触发 onShow：
//  · 打开后：激活视图停在关闭前的残留或「未打开工作区」空态——git（P1-3）/
//    database（B3）曾在 main.ts 内联补偿，todo/endpoints/runtime/tests 从未补偿
//    （2026-10-17 用户实案：端点面板重开工作区后仍显示「未打开工作区」）。
//  · 关闭后：resetWorkspaceUiState 里各视图 reset 是同步渲染、当时 root 尚未置
//    null，画出「没有端点 / 没有待办 / 暂无运行记录」错误空态；database 的 reset
//    干脆不渲染、残留整棵旧树（同日用户第二次实案）。
// 两个分发器都只处理「激活」视图：非激活视图切过去时由各自 onShow 自然刷新，
// 提前重扫/重绘纯属浪费（工作区级 IO 或整树重建）。
import { activeView } from "./views";
import { renderGitPanel, refreshBranchPanel } from "./git";
import { refreshDbWorkspace, renderDbTree } from "./sqliteView";
import { refreshTodos, renderTodoPanel } from "./todoView";
import { refreshEndpoints, renderEndpointPanel } from "./endpointView";
import { refreshHotspots, renderHotspots } from "./hotspotsView";
import { refreshTests } from "./testRun";

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
    case "tests":
      // 第 9 视图：onShow 本身带动态 import（testView 挡在首屏 chunk 外），补偿同形态。
      // initTestView 幂等（onShow 每次点击都调）；handlers 已由 onShow 注入过。
      void import("./testView").then((m) => {
        m.initTestView();
        void refreshTests();
      });
      break;
    default:
      // files / search / debug：内容随打开动作或各自 onShow 自然刷新，无需补偿
      break;
  }
}

/**
 * closeWorkspace 收尾（root 已置 null）：把激活视图渲染到「未打开工作区」终态。
 * git 的 P1-3 终态渲染也收口在这里（原先内联在 main.ts）。
 * default 分支无需处理：debug 视图与工作区无关；files/search 的关闭态由
 * resetTreeState / resetSearch 各自覆盖。
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
    case "tests":
      // 与 resetWorkspaceUiState 的动态 import 复位同形态；root 已置 null，
      // renderTests 落 noWorkspace 分支。显式补一次，不依赖 import 解析时序。
      void import("./testView").then((m) => m.resetTestView());
      break;
    default:
      break;
  }
}
