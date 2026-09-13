// 侧栏视图注册表（TD-001 阶段一）：每个视图包成单一根节点（#view-*），
// 切换时遍历注册表「隐藏所有根、只显示激活根」，结构性杜绝平铺兄弟元素
// 逐个 toggle hidden 的遗漏问题。新增视图只需 registerSidebarView 登记。

export type SidebarViewId = "files" | "search" | "todo" | "git" | "debug";

export interface SidebarView {
  id: SidebarViewId;
  /** 视图根节点 id（切换时唯一被操作显隐的节点） */
  rootId: string;
  /** 侧栏 tab 按钮 id */
  tabId: string;
  /** 视图变为激活时调用（重复点击激活 tab 也会触发，如搜索视图聚焦输入框） */
  onShow?: () => void;
  /** 视图失去激活时调用（如搜索视图取消进行中的请求） */
  onHide?: () => void;
}

const views: SidebarView[] = [];
let activeId: SidebarViewId | null = null;

/** 登记一个侧栏视图（需在首次 setSidebarTab 之前完成） */
export function registerSidebarView(view: SidebarView): void {
  views.push(view);
}

/** 当前激活的视图 id（未初始化时为 null） */
export function activeView(): SidebarViewId | null {
  return activeId;
}

/** 切换侧栏视图：隐藏所有根 → 显示激活根 → 触发 onHide/onShow 生命周期钩子 */
export function setSidebarTab(id: SidebarViewId): void {
  const cur = views.find((v) => v.id === id);
  if (!cur) return;
  if (activeId === id) {
    // 重复点击激活 tab：保持原行为（如重新聚焦搜索框 / 刷新大纲）
    cur.onShow?.();
    return;
  }
  for (const v of views) {
    const show = v.id === id;
    document.getElementById(v.rootId)?.classList.toggle("hidden", !show);
    const tabEl = document.getElementById(v.tabId);
    tabEl?.classList.toggle("active", show);
    // UI-16：tab 语义的选中态与 .active 类同源切换（单一写入点，避免二者漂移）
    tabEl?.setAttribute("aria-selected", String(show));
  }
  views.find((v) => v.id === activeId)?.onHide?.();
  activeId = id;
  cur.onShow?.();
}
