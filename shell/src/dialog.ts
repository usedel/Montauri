// 统一自绘消息对话框（TD-008）：替代浏览器/系统原生消息框。
// 规则：shell/src 内禁止使用 window.alert / window.confirm / window.prompt，
// 以及 @tauri-apps/plugin-dialog 的 confirm / ask / message（open/save 文件选择除外）。
// 复用 #confirm-modal（遮罩 + showEl/hideEl + 品牌按钮），提供 confirm 与 alert 两种形态。

import { hideEl, showEl } from "./anim";
import { lazyEl } from "./state";

export type DialogKind = "danger" | "primary";

export interface ConfirmOptions {
  /** 标题（可省略，省略时隐藏标题行） */
  title?: string;
  message: string;
  /** 确定按钮文案，默认「确认」 */
  okLabel?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelLabel?: string;
  kind?: DialogKind;
}

export interface AlertOptions {
  title?: string;
  message: string;
  /** 确定按钮文案，默认「知道了」 */
  okLabel?: string;
  kind?: DialogKind;
}

// CR-26：顶层 DOM 快照改惰性（测试环境无完整 DOM 时模块仍可被 import）
const modalEl = lazyEl("confirm-modal");
const titleEl = lazyEl("confirm-title");
const messageEl = lazyEl("confirm-message");
const okBtn = lazyEl<HTMLButtonElement>("confirm-ok");
const cancelBtn = lazyEl<HTMLButtonElement>("confirm-cancel");

function applyKind(kind: DialogKind): void {
  okBtn.classList.toggle("danger", kind === "danger");
  okBtn.classList.toggle("primary", kind === "primary");
}

/** 统一底层：withCancel 决定双按钮（confirm）或单按钮（alert）形态 */
function openModal(opts: {
  title?: string;
  message: string;
  okLabel: string;
  cancelLabel?: string;
  kind: DialogKind;
  withCancel: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    titleEl.textContent = opts.title ?? "";
    titleEl.classList.toggle("hidden", !opts.title);
    messageEl.textContent = opts.message;
    okBtn.textContent = opts.okLabel;
    cancelBtn.textContent = opts.cancelLabel ?? "取消";
    cancelBtn.classList.toggle("hidden", !opts.withCancel);
    applyKind(opts.kind);

    showEl(modalEl);

    const finish = (v: boolean) => {
      hideEl(modalEl);
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      okBtn.onkeydown = null;
      cancelBtn.onkeydown = null;
      modalEl.onmousedown = null;
      resolve(v);
    };

    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    okBtn.onkeydown = (e) => {
      if (e.key === "Escape") finish(false);
    };
    cancelBtn.onkeydown = (e) => {
      if (e.key === "Escape") finish(false);
    };
    modalEl.onmousedown = (e) => {
      if (e.target === modalEl) finish(false);
    };

    // confirm 默认焦点放「取消」防误触；alert 聚焦「知道了」
    (opts.withCancel ? cancelBtn : okBtn).focus();
  });
}

/** 确认框（双按钮），返回用户是否确认 */
export function openConfirm(opts: ConfirmOptions): Promise<boolean> {
  return openModal({
    title: opts.title,
    message: opts.message,
    okLabel: opts.okLabel ?? "确认",
    cancelLabel: opts.cancelLabel,
    kind: opts.kind ?? "primary",
    withCancel: true,
  });
}

/** 提示框（单按钮），用户关闭后 resolve */
export function openAlert(opts: AlertOptions): Promise<void> {
  return openModal({
    title: opts.title,
    message: opts.message,
    okLabel: opts.okLabel ?? "知道了",
    kind: opts.kind ?? "primary",
    withCancel: false,
  }).then(() => undefined);
}