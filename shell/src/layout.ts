// 面板布局域（D2 P-03）：侧栏宽度 / 底部面板高度拖拽调整 + 本地持久化。
// 尺寸存 localStorage 而非全局 Settings：布局属视图状态（类 VS Code workspace state），
// 避免为 UI 尺寸改动 Rust Settings 结构与前后端漂移锁。

import { $ } from "./state";

const SIDEBAR_KEY = "opencharm.sidebar_width";
const BOTTOM_KEY = "opencharm.bottom_height";
const RIGHT_KEY = "opencharm.rightpanel_width";

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEF = 280;
const BOTTOM_MIN = 120;
const BOTTOM_DEF = 220;
const RIGHT_MIN = 260;
const RIGHT_MAX = 560;
const RIGHT_DEF = 360;
/** 底部面板最大高度占视口比例 */
const BOTTOM_MAX_RATIO = 0.6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function readStored(key: string): number | null {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 启动时恢复上次的侧栏宽度 / 底部面板高度（越界值忽略） */
export function restoreLayout(): void {
  const sw = readStored(SIDEBAR_KEY);
  if (sw !== null && sw >= SIDEBAR_MIN && sw <= SIDEBAR_MAX) {
    $("sidebar").style.width = `${sw}px`;
  }
  const bh = readStored(BOTTOM_KEY);
  if (bh !== null && bh >= BOTTOM_MIN) {
    $("bottom").style.height = `${Math.min(bh, Math.floor(window.innerHeight * BOTTOM_MAX_RATIO))}px`;
  }
  const rw = readStored(RIGHT_KEY);
  if (rw !== null && rw >= RIGHT_MIN && rw <= RIGHT_MAX) {
    $("right-panel").style.width = `${rw}px`;
  }
}

/** 通用拖：拖动期间给热区加 .dragging（样式反馈），结束时回调 onDone */
function startDrag(handle: HTMLElement, onMove: (e: MouseEvent) => void, onDone?: () => void): void {
  handle.classList.add("dragging");
  const move = (e: MouseEvent): void => {
    e.preventDefault();
    onMove(e);
  };
  const up = (): void => {
    handle.classList.remove("dragging");
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    onDone?.();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/** 接线两个分隔条：拖拽调整 + 双击重置 */
export function wireSplitters(): void {
  const sidebar = $("sidebar");
  const bottom = $("bottom");

  const sidebarSplitter = $("sidebar-splitter");
  sidebarSplitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const left = sidebar.getBoundingClientRect().left;
    sidebar.classList.add("resizing"); // D3：拖拽期间关闭宽度过渡，避免跟手延迟
    startDrag(
      sidebarSplitter,
      (ev) => {
        const w = clamp(Math.round(ev.clientX - left), SIDEBAR_MIN, SIDEBAR_MAX);
        sidebar.style.width = `${w}px`;
        localStorage.setItem(SIDEBAR_KEY, String(w));
      },
      () => sidebar.classList.remove("resizing"),
    );
  });
  sidebarSplitter.addEventListener("dblclick", () => {
    sidebar.style.width = `${SIDEBAR_DEF}px`;
    localStorage.removeItem(SIDEBAR_KEY);
  });

  const rightPanel = $("right-panel");
  const rightSplitter = $("right-splitter");
  rightSplitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const right = rightPanel.getBoundingClientRect().right;
    rightPanel.classList.add("resizing");
    startDrag(
      rightSplitter,
      (ev) => {
        const w = clamp(Math.round(right - ev.clientX), RIGHT_MIN, RIGHT_MAX);
        rightPanel.style.width = `${w}px`;
        localStorage.setItem(RIGHT_KEY, String(w));
      },
      () => rightPanel.classList.remove("resizing"),
    );
  });
  rightSplitter.addEventListener("dblclick", () => {
    rightPanel.style.width = `${RIGHT_DEF}px`;
    localStorage.removeItem(RIGHT_KEY);
  });

  const bottomSplitter = $("bottom-splitter");
  bottomSplitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    bottom.classList.remove("collapsed"); // 收起态拖动 = 直接展开调整
    bottom.classList.add("resizing"); // D3：拖拽期间关闭高度过渡，避免跟手延迟
    startDrag(
      bottomSplitter,
      (ev) => {
        const max = Math.floor(window.innerHeight * BOTTOM_MAX_RATIO);
        const h = clamp(Math.round(window.innerHeight - ev.clientY), BOTTOM_MIN, max);
        bottom.style.height = `${h}px`;
        localStorage.setItem(BOTTOM_KEY, String(h));
      },
      () => bottom.classList.remove("resizing"),
    );
  });
  bottomSplitter.addEventListener("dblclick", () => {
    bottom.style.height = `${BOTTOM_DEF}px`;
    localStorage.removeItem(BOTTOM_KEY);
  });
}
