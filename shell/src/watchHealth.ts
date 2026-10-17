// 文件监听健康度（tech-debt TD-029②）：把「watcher 不工作了」从日志里捞出来摆到状态栏。
//
// 背景：此前 `watch_start` 失败只 console.warn，debouncer 的运行期 Err 直接 `return` 吞掉。
// 工作区落在**网络盘 / OneDrive 同步目录**时 ReadDirectoryChangesW 会缓冲区溢出丢事件，
// 用户看到的只是「文件树不刷新、git 状态不更新」这类症状，完全不知道原因在哪。
//
// 设计（零新命令、零新依赖，纯事件消费）：
// - Rust watcher.rs 在「启动失败 / 运行期错误」两处 emit `fs-watch-health`（kind + detail）；
// - 本模块收到即亮状态栏芯片 + 一次性 toast，并按**有界**退避重订阅（最多 2 次，2s/6s）——
//   不做无限重试：工作区被删/权限变更这类失败重试只会空转，留给用户点芯片手动重试；
// - 只要再收到任意 `fs-changed`（证明监听确实还在工作）就复位：清芯片、清重试计数。
//
// 之所以自己监听 fs-changed 而不是让 main 回调：main.ts 已在 2440 行上限顶格，
// 接一根线就要挤掉既有注释；事件本身就是「监听活着」的证据，直接订阅更内聚。

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hideEl, showEl } from "./anim";
import { t } from "./i18n";
import { toast } from "./toast";
import { app } from "./state";
import { codicon } from "./util";

/** 自动重订阅的有界退避（毫秒），用完即停，交给用户点芯片手动重试 */
const RETRY_BACKOFF_MS = [2_000, 6_000];
/** 连续失败计数（收到 fs-changed 即清零） */
let failStreak = 0;
let retryTimer: number | null = null;
/** 一次性提示（同一轮故障不重复弹） */
let toastShown = false;

function chip(): HTMLElement | null {
  return document.getElementById("status-watch");
}

/** 亮芯片（含警示图标 + 可点击重试的语义） */
function render(bad: boolean, label?: string): void {
  const el = chip();
  if (!el) return;
  if (!bad) {
    hideEl(el);
    el.textContent = "";
    el.removeAttribute("data-tip");
    return;
  }
  el.textContent = "";
  const icon = codicon("warning");
  icon.className = "watch-health-icon codicon codicon-warning"; // 保留 codicon 类（重写 className 会丢字形）
  const text = document.createElement("span");
  text.textContent = label ?? t("watch.health.label");
  el.append(icon, text);
  const tip = t("watch.health.tip");
  el.setAttribute("data-tip", tip);
  el.title = tip;
  showEl(el);
}

/** 重订阅（复用既有 watch_start 命令）。失败会再次触发 fs-watch-health → 走下一轮退避 */
async function resubscribe(): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("watch_start", { root: app.workspaceRoot });
  } catch {
    // 失败细节由 Rust 侧事件统一上报，这里不重复提示
  }
}

function scheduleRetry(): void {
  if (failStreak > RETRY_BACKOFF_MS.length) return; // 有界：不再自动重试
  const delay = RETRY_BACKOFF_MS[failStreak - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
  if (retryTimer !== null) window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void resubscribe();
  }, delay);
}

/** 处理 Rust 侧的健康度事件（导出供单测直接驱动） */
export function handleWatchHealth(payload: { kind?: string; detail?: string } | null): void {
  if (!payload) return;
  failStreak += 1;
  render(true);
  if (!toastShown) {
    toastShown = true;
    toast(t("watch.health.toast"), "error");
  }
  scheduleRetry();
}

/** 「监听还活着」的证据（收到任意 fs-changed）：复位一切 */
export function noteWatcherAlive(): void {
  if (failStreak === 0 && retryTimer === null) return;
  failStreak = 0;
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (toastShown) {
    toastShown = false;
    render(false);
    toast(t("watch.health.restored"), "success");
  }
}

/** 接线（init 调一次）。芯片点击 = 手动重试（自动退避用完后的兜底入口） */
export async function wireWatchHealth(): Promise<void> {
  const el = chip();
  if (el) {
    el.addEventListener("click", () => void resubscribe());
    el.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") {
        e.preventDefault();
        void resubscribe();
      }
    });
  }
  const win = getCurrentWindow();
  await win.listen<{ kind?: string; detail?: string }>("fs-watch-health", (e) => {
    handleWatchHealth(e.payload);
  });
  // fs-changed 到达 = 监听在工作 → 复位（不做「假健康」：没有事件就不会复位）
  await win.listen("fs-changed", () => {
    noteWatcherAlive();
  });
}

/** 单测用：复位模块状态 */
export function resetWatchHealthState(): void {
  failStreak = 0;
  toastShown = false;
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  render(false);
}
