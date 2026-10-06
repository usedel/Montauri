// 自绘标题栏与窗口边缘（decorations: false）：从 main.ts 外提（阶段二 init 阶段化第二轮）。
//
// 窗口控制按钮（最小化 / 最大化-还原 / 关闭）+ menubar 空白区拖拽与双击最大化 +
// 边缘 resize 透明热区。整块只依赖 Tauri 窗口 API 与 DOM，**不触碰任何 main 私有状态**，
// 故无需注入，直接 `wireWindowChrome()`。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { $ } from "./state";
import { t } from "./i18n";

// @tauri-apps/api/window 的 ResizeDirection 未导出（上游类型导出缺失），本地声明同步。
type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

export function wireWindowChrome(): void {
  // 自绘标题栏（decorations: false）：窗口控制按钮 + 拖拽区 + 边缘 resize 兜底
  const appWindow = getCurrentWindow();
  const winMaxBtn = $("win-max") as HTMLButtonElement;
  // UI-01：切换 codicon 类名而非覆盖 textContent——保住 HTML 里的 <i aria-hidden> 节点，
  // 与最小化/关闭按钮（同为 codicon）风格一致，也不再依赖 "Segoe UI Symbol" 字体渲染裸字符。
  const winMaxIcon = winMaxBtn.querySelector("i.codicon");
  const syncMaxIcon = async (): Promise<void> => {
    try {
      const max = await appWindow.isMaximized();
      winMaxIcon?.classList.toggle("codicon-chrome-maximize", !max);
      winMaxIcon?.classList.toggle("codicon-chrome-restore", max);
      // UI-09：与 index.html 的静态 data-tip 同轨。动态改写必须同时更新 aria-label——
      // 只改 tip 的话，最大化后读屏仍会报「最大化」，与已切换成还原态的图标不符。
      const label = max ? t("main.win.restore") : t("main.win.maximize");
      winMaxBtn.dataset.tip = label;
      winMaxBtn.setAttribute("aria-label", label);
    } catch { /* 忽略 */ }
  };
  $("win-min").addEventListener("click", () => void appWindow.minimize());
  winMaxBtn.addEventListener("click", () => {
    void appWindow.toggleMaximize();
    void syncMaxIcon();
  });
  $("win-close").addEventListener("click", () => void appWindow.close());
  // 自绘标题栏：整个 menubar 的空白区可拖拽 / 双击最大化。
  // 用 mousedown 手动接管（data-tauri-drag-region 会吞掉双击且只对直接元素生效），
  // 交互元素（菜单按钮、引擎下拉、窗口控制按钮）不拦截。
  ($("menubar") as HTMLElement).addEventListener("mousedown", (ev) => {
    if (ev.buttons !== 1) return; // 仅响应左键
    const target = ev.target as HTMLElement;
    if (target.closest("button, select, input, #win-controls")) return;
    if (ev.detail === 2) {
      void appWindow.toggleMaximize();
      void syncMaxIcon();
    } else {
      void appWindow.startDragging();
    }
  });
  void syncMaxIcon();
  // 尺寸变化（含 snap 吸附 / 拉伸）后刷新最大化/还原图标
  void appWindow.onResized(() => void syncMaxIcon());

  // 边缘 resize 兜底：decorations:false 下部分 Windows 版本失去原生边缘缩放，
  // 用透明热区 + startResizeDragging 手动接管。
  const resizeEdges: Array<[ResizeDirection, string]> = [
    ["North", "n"], ["South", "s"], ["East", "e"], ["West", "w"],
    ["NorthEast", "ne"], ["NorthWest", "nw"], ["SouthEast", "se"], ["SouthWest", "sw"],
  ];
  for (const [dir, cls] of resizeEdges) {
    const h = document.createElement("div");
    h.className = `rs-handle rs-${cls}`;
    h.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return; // 仅响应左键
      ev.preventDefault();
      void appWindow.startResizeDragging(dir);
    });
    document.body.appendChild(h);
  }
}
