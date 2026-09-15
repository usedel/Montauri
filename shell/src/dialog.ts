// 统一自绘消息对话框（TD-008）：替代浏览器/系统原生消息框。
// 规则：shell/src 内禁止使用 window.alert / window.confirm / window.prompt，
// 以及 @tauri-apps/plugin-dialog 的 confirm / ask / message（open/save 文件选择除外）。
// 复用 #confirm-modal（遮罩 + showEl/hideEl + 品牌按钮），提供 confirm 与 alert 两种形态。

import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
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

export interface PromptOptions {
  title: string;
  /** 输入框上方的说明（如「Python 表达式，为真时才断下」） */
  label?: string;
  /** 初始值（编辑既有条件时回填） */
  value?: string;
  placeholder?: string;
  /** 确定按钮文案，默认「确定」 */
  okLabel?: string;
}

// CR-26：顶层 DOM 快照改惰性（测试环境无完整 DOM 时模块仍可被 import）
const modalEl = lazyEl("confirm-modal");
const titleEl = lazyEl("confirm-title");
const messageEl = lazyEl("confirm-message");
const okBtn = lazyEl<HTMLButtonElement>("confirm-ok");
const cancelBtn = lazyEl<HTMLButtonElement>("confirm-cancel");

/** 输入框模态（#prompt-modal）：条件断点 / Logpoint 等「一行文本输入」场景 */
const promptModalEl = lazyEl("prompt-modal");
const promptTitleEl = lazyEl("prompt-title");
const promptLabelEl = lazyEl("prompt-label");
const promptInputEl = lazyEl<HTMLInputElement>("prompt-input");
const promptOkBtn = lazyEl<HTMLButtonElement>("prompt-ok");
const promptCancelBtn = lazyEl<HTMLButtonElement>("prompt-cancel");

/** UI-08：切换 .btn 体系的变体类（原为裸 `danger`/`primary`，依赖已删除的 `.modal-actions button.*` 规则） */
function applyKind(kind: DialogKind): void {
  okBtn.classList.toggle("btn--danger", kind === "danger");
  okBtn.classList.toggle("btn--primary", kind === "primary");
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
    // UI-16：dialog 的可访问名称。有标题 → aria-labelledby 指向标题；
    // 无标题（多数调用只传 message）→ 用消息首行做 aria-label，避免 dialog 无名
    //（aria-labelledby 指向空元素时读屏只能报「对话框」，信息量为零）
    const card = modalEl.querySelector<HTMLElement>(".modal-card");
    if (card) {
      if (opts.title) {
        card.setAttribute("aria-labelledby", "confirm-title");
        card.removeAttribute("aria-label");
      } else {
        card.removeAttribute("aria-labelledby");
        const firstLine = opts.message.split("\n", 1)[0].trim();
        card.setAttribute("aria-label", firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine);
      }
    }
    messageEl.textContent = opts.message;
    okBtn.textContent = opts.okLabel;
    cancelBtn.textContent = opts.cancelLabel ?? "取消";
    cancelBtn.classList.toggle("hidden", !opts.withCancel);
    applyKind(opts.kind);

    showEl(modalEl);
    // UI-05：焦点陷阱——Tab 循环限制在本模态内；finish 时先解除再隐藏
    let releaseFocus: (() => void) | null = trapFocus(modalEl);

    const finish = (v: boolean) => {
      releaseFocus?.();
      releaseFocus = null;
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

// ---------- v3.4 §6.4（M3-3.7）：三选一对话框（项目运行二选一 + 取消） ----------

export interface ChoiceOptions {
  title?: string;
  message: string;
  /** 主按钮（推荐动作） */
  okLabel: string;
  /** 中性按钮（备选动作）；省略则退化为双按钮 */
  neutralLabel?: string;
  /** 取消按钮，默认「取消」 */
  cancelLabel?: string;
  kind?: DialogKind;
}

/** 三选一结果："ok" / "neutral" / "cancel"（Esc / 遮罩 = cancel，绝不误触动作） */
export type ChoiceResult = "ok" | "neutral" | "cancel";

/** 三按钮选择框：ok（主）+ neutral（备选）+ cancel。Esc 与点遮罩均 = cancel。
 *  v3.4 §6.4：项目运行中再点「运行项目」的「停止并重跑 / 新建实例」二选一——
 *  中性按钮承载「新建实例」，主按钮承载「停止并重跑」，取消是安全出口。
 *  ⚠️ DOM 节点一律 getElementById 取**真元素**：模块级 lazyEl 代理不能作为
 *  insertBefore 的参照节点（Proxy 非 Node，DOM API 直接抛 TypeError——实测踩坑）。 */
export function openChoice(opts: ChoiceOptions): Promise<ChoiceResult> {
  return new Promise((resolve) => {
    titleEl.textContent = opts.title ?? "";
    titleEl.classList.toggle("hidden", !opts.title);
    messageEl.textContent = opts.message;
    const okReal = document.getElementById("confirm-ok") as HTMLButtonElement;
    const cancelReal = document.getElementById("confirm-cancel") as HTMLButtonElement;
    okReal.textContent = opts.okLabel;
    cancelReal.textContent = opts.cancelLabel ?? "取消";
    applyKind(opts.kind ?? "primary");

    // 中性按钮：动态插入到 ok 按钮之前（对话框同时只会有一个实例，用后即删）
    const card = modalEl.querySelector<HTMLElement>(".modal-actions");
    let neutralBtn: HTMLButtonElement | null = null;
    if (opts.neutralLabel && card) {
      neutralBtn = document.createElement("button");
      neutralBtn.className = "btn";
      neutralBtn.textContent = opts.neutralLabel;
      card.insertBefore(neutralBtn, okReal);
    }

    showEl(modalEl);
    let releaseFocus: (() => void) | null = trapFocus(modalEl);

    const finish = (v: ChoiceResult): void => {
      releaseFocus?.();
      releaseFocus = null;
      hideEl(modalEl);
      okReal.onclick = null;
      cancelReal.onclick = null;
      okReal.onkeydown = null;
      cancelReal.onkeydown = null;
      modalEl.onmousedown = null;
      neutralBtn?.remove();
      resolve(v);
    };

    okReal.onclick = () => finish("ok");
    cancelReal.onclick = () => finish("cancel");
    neutralBtn?.addEventListener("click", () => finish("neutral"));
    for (const b of [okReal, cancelReal, neutralBtn]) {
      if (b) b.onkeydown = (e) => {
        if (e.key === "Escape") finish("cancel");
      };
    }
    modalEl.onmousedown = (e) => {
      if (e.target === modalEl) finish("cancel");
    };

    // 默认焦点放「取消」防误触（与 openConfirm 同策略）
    cancelReal.focus();
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

/**
 * 单行文本输入框（P0：条件断点 / Logpoint 表达式录入）。
 * resolve 规则：
 * - 确定 → 返回 trim 后的字符串（**允许空串**，调用方据此「清空条件」）；
 * - 取消 / Esc / 点遮罩 → 返回 null（与空串区分，调用方据此保持原值不变）。
 */
export function openPrompt(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const card = promptModalEl.querySelector<HTMLElement>(".modal-card");
    card?.setAttribute("aria-label", opts.title);
    promptTitleEl.textContent = opts.title;
    promptLabelEl.textContent = opts.label ?? "";
    promptLabelEl.classList.toggle("hidden", !opts.label);
    promptInputEl.value = opts.value ?? "";
    promptInputEl.placeholder = opts.placeholder ?? "";
    promptOkBtn.textContent = opts.okLabel ?? "确定";

    showEl(promptModalEl);
    let releaseFocus: (() => void) | null = trapFocus(promptModalEl);

    const finish = (v: string | null): void => {
      releaseFocus?.();
      releaseFocus = null;
      document.removeEventListener("keydown", onKeydown);
      hideEl(promptModalEl);
      promptOkBtn.onclick = null;
      promptCancelBtn.onclick = null;
      promptInputEl.onkeydown = null;
      resolve(v);
    };
    // tech-debt #18：含可编辑内容，点遮罩不关闭；仅 Esc / 确定 / 取消关闭（document 级，close 时移除）
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    };
    // 回车 = 确定（输入框单行的自然语义）
    const submit = (): void => finish(promptInputEl.value.trim());

    promptOkBtn.onclick = submit;
    promptCancelBtn.onclick = () => finish(null);
    promptInputEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onKeydown);

    promptInputEl.focus();
    promptInputEl.select();
  });
}