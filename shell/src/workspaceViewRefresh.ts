// 工作区就绪后对「当前激活侧栏视图」的补偿刷新（main.ts openWorkspace 收尾调用）。
//
// 由来：侧栏视图的内容几乎只在 onShow（切 tab）时刷新。用户停在某个 tab 上
// 「关闭工作区 → 再打开」时，onShow 不再触发，面板会停留在关闭前的残留或
// 「未打开工作区」空态——git 视图（P1-3，2026-09-30 用户报告）与 database
// 视图（B3 §10.3-8b 真机发现）此前在 main.ts 内联补偿；todo / endpoints /
// runtime 从未补偿。2026-10-17 用户实案：停在端点面板关闭再打开工作区，
// 面板仍显示「未打开工作区」。本文件把补偿收口到一处，main 侧只留一行调用。
//
// 只刷「激活」视图：非激活视图的内容在用户切过去时由各自 onShow 自然刷新，
// 提前重扫纯属浪费（这些都是工作区级 IO：scan_endpoints / TODO 扫描 / trace 库）。
import { activeView } from "./views";
import { renderGitPanel, refreshBranchPanel } from "./git";
import { refreshDbWorkspace } from "./sqliteView";
import { refreshTodos } from "./todoView";
import { refreshEndpoints } from "./endpointView";
import { refreshHotspots } from "./hotspotsView";

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
