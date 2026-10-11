// 状态栏「进行中」芯片（体验审查 L-5 / L-3）：长耗时 uv 操作的全局可见态 + 唯一取消入口。
//
// 为什么放在状态栏：长操作期间用户可能切工作区、关模态、翻到别的文件——任何挂在某个面板里的
// 进度/取消入口都会跟着消失，而状态栏一直在（「正在创建环境 / 正在安装」这类事实不该只存在于
// 一个可能已经关掉的模态里）。
//
// 与 `output.ts::beginLongOp`（L-6）的分工：beginLongOp 管「进度可见」（展开输出面板 + 记命令行），
// 本模块管「正在跑什么 + 能不能取消」。调用方成对使用 `beginUvOp` / `endUvOp`。
//
// 会话互斥：`beginUvOp` 返回 false = 已有操作在跑。env 域后端**没有**互斥（`env_cmds.rs` 无
// AtomicBool，只有 `dep_fix.rs` 有 DEP_FIX_BUSY），两个 uv 进程并发写同一 .venv 会互相踩；
// 这一层前端守卫与 L-8 的写操作锁配合，是当前唯一的互斥来源。
//
// 接线：不占 main.ts（该文件行数余量只剩 2 行）——首次 `beginUvOp` 时自接线。

import { invoke } from "@tauri-apps/api/core";
import { lazyEl } from "./state";
import { errMsg, spinIcon } from "./util";
import { hideEl, showEl } from "./anim";
import { onLocaleChange, t } from "./i18n";
import { toast } from "./toast";
import { parseUvProgress, type UvProgress } from "./uvProgress"; // L-1：把 uv 流式行解析成可判读进度

/** 可取消的 uv 操作名（与 Rust `uv_cancel.rs` 的登记键逐字一致） */
export type UvOpKind = "venv" | "install" | "upgrade" | "fix";

const OP_LABEL_KEY = {
  venv: "status.op.venv",
  install: "status.op.install",
  upgrade: "status.op.upgrade",
  fix: "status.op.fix",
} as const;

const statusOpEl = lazyEl("status-op");
const statusOpLabelEl = lazyEl("status-op-label");
const statusOpDetailEl = lazyEl("status-op-detail");
const statusOpBarEl = lazyEl("status-op-bar"); // L-1：进度条（仅在能解析出比例时可见）
const statusOpFillEl = lazyEl("status-op-fill");
const statusOpCancelBtn = lazyEl<HTMLButtonElement>("status-op-cancel");

interface ActiveOp {
  kind: UvOpKind;
  canceling: boolean;
  /** L-1：最近一行 uv 输出解析出的进度；null = 还没有任何输出 */
  progress: UvProgress | null;
}

let active: ActiveOp | null = null;
let wired = false;

/** 是否有长操作在跑（env 域写操作互斥的判据） */
export function isUvOpActive(): boolean {
  return active !== null;
}

function render(): void {
  if (!active) {
    hideEl(statusOpEl);
    // 收尾即复位：芯片隐藏后不留上一次的进度文本与进度条——否则下一次起手会在「有输出之前」
    // 短暂闪出上一个操作的旧数值（用户会误读成新操作的进度）。
    statusOpDetailEl.textContent = "";
    statusOpBarEl.classList.add("hidden");
    statusOpFillEl.style.width = "0";
    statusOpBarEl.removeAttribute("aria-valuenow");
    return;
  }
  showEl(statusOpEl);
  statusOpLabelEl.textContent = "";
  statusOpLabelEl.append(spinIcon(), ` ${t(OP_LABEL_KEY[active.kind])}`);
  // L-1：有可判读进度就显示（「45.2 MiB / 100.5 MiB（46%）」这类），没有就留空——
  // 空态与「转圈 + 操作名」等价，不给假进度
  statusOpDetailEl.textContent = active.progress?.text ?? "";
  // L-1 进度条：ratio 为 null（算不出比例）→ 保持 hidden，不做自走的假进度
  const ratio = active.progress?.ratio ?? null;
  statusOpBarEl.classList.toggle("hidden", ratio === null);
  if (ratio !== null) {
    const pct = Math.round(ratio * 100);
    statusOpFillEl.style.width = `${pct}%`;
    statusOpBarEl.setAttribute("aria-valuenow", String(pct));
  } else {
    statusOpFillEl.style.width = "0";
    statusOpBarEl.removeAttribute("aria-valuenow");
  }
  statusOpCancelBtn.textContent = active.canceling ? t("status.opCanceling") : t("common.cancel");
  statusOpCancelBtn.disabled = active.canceling; // 防连点：首次点击即进「取消中…」
}

function onCancelClick(): void {
  if (!active || active.canceling) return;
  const kind = active.kind;
  active.canceling = true;
  render();
  // 无在途操作时后端静默成功（用户可能点晚了）——失败也不打扰，真实结局由操作自身的收尾决定
  void invoke("uv_cancel_op", { op: kind }).catch(() => undefined);
}

function ensureWired(): void {
  if (wired) return;
  wired = true;
  statusOpCancelBtn.addEventListener("click", onCancelClick);
  onLocaleChange(() => render()); // 芯片可能正显示着：切语言要重取词
}

/** 起手：芯片显示「正在…」+ 取消按钮。
 *  @returns false = 已有操作在跑（调用方应放弃本次操作并提示，不要并发起第二个 uv 进程） */
export function beginUvOp(kind: UvOpKind): boolean {
  ensureWired();
  if (active) return false;
  active = { kind, canceling: false, progress: null };
  render();
  return true;
}

/** 收尾（成功 / 失败 / 取消统一走这里）。
 *  只清理与自己 kind 相同的操作——防「A 收尾误清 B」（互斥下不该发生，但守卫比假设便宜）。 */
export function endUvOp(kind: UvOpKind): void {
  if (active?.kind !== kind) return;
  active = null;
  render();
}

/** L-1：喂一行 uv 流式输出（pip-stdout / pip-stderr），更新芯片里的可判读进度。
 *  无在途操作时静默忽略——输出面板里的历史行不该点亮芯片。 */
export function pushUvProgressLine(line: string): void {
  if (!active) return;
  const p = parseUvProgress(line);
  if (!p) return; // 空行：保持上一次显示
  active.progress = p;
  render();
}

/** 取消哨兵：与 Rust `run_uv_streaming` 的 `Err("已取消")` 逐字一致。
 *  取消是用户主动行为，不是失败——调用方据此走 info 级提示而非 toastFail。 */
export function isCanceled(e: unknown): boolean {
  return errMsg(e).includes("已取消");
}

/** 取消后的统一提示（info 级，与 cloneRepository 的取消口径一致） */
export function notifyCanceled(): void {
  toast(t("status.opCanceled"), "info");
}

/** 已有操作在跑时的拒绝提示（互斥出口，供调用方复用同一文案） */
export function notifyBusy(): void {
  toast(t("status.opBusy"), "info");
}
