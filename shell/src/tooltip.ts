// 自绘 Tooltip（D3 P-11）：300ms 延迟 + 深色浮层 + 可选快捷键副文本，样式统一。
// 用法：目标元素加 data-tip="提示文本"，可选 data-tip-key="Ctrl+S"；
// wireTooltip() 于 init 调用一次（document 级事件委托，无需逐元素绑定）。
// 接入 data-tip 的元素应移除原生 title 避免双重提示；树节点等低频场景保留原生 title。

let tipEl: HTMLElement | null = null;
let showTimer: number | undefined;
let currentTarget: HTMLElement | null = null;

function ensureTipEl(): HTMLElement {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "oc-tooltip hidden";
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function hideTip(): void {
  tipEl?.classList.add("hidden");
}

function showTipFor(el: HTMLElement): void {
  const tip = ensureTipEl();
  tip.textContent = "";
  tip.append(el.dataset.tip ?? "");
  const key = el.dataset.tipKey;
  if (key) {
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    tip.append(" ", kbd);
  }
  tip.classList.remove("hidden");
  // 定位：默认目标下方居中，近底边翻转到上方，水平方向夹紧到视口内
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const left = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6));
  let top = r.bottom + 6;
  if (top + th > window.innerHeight - 6) top = Math.max(6, r.top - th - 6);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

/** 接线 document 级委托（init 调用一次） */
export function wireTooltip(): void {
  document.addEventListener("mouseover", (e) => {
    const el = ((e.target as HTMLElement | null)?.closest("[data-tip]") as HTMLElement | null) ?? null;
    if (el === currentTarget) return;
    currentTarget = el;
    window.clearTimeout(showTimer);
    hideTip();
    if (!el) return;
    showTimer = window.setTimeout(() => showTipFor(el), 300);
  });
  // 按下即隐藏：点击反馈不被 tooltip 遮挡；失焦清理避免残留
  document.addEventListener("mousedown", () => {
    window.clearTimeout(showTimer);
    currentTarget = null;
    hideTip();
  });
  window.addEventListener("blur", () => {
    window.clearTimeout(showTimer);
    currentTarget = null;
    hideTip();
  });
}
