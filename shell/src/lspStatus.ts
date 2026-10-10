// 状态栏 LSP 芯片（#status-lsp）渲染收敛：从 main.ts 外提（第二十批 i18n 遗留修复——
// 原三处写入都是 t() 一次性快照，语言切换后无订阅者刷新，英文界面残留中文文案）。
//
// 形态两态：
//  - engine：状态机渲染（状态点 dot + 文案），来源 main 的 onEngineStatus 回调；
//  - note：一次性提示（无 py 跳过 / 启动失败），此后语言切换按记忆的 key+params 重取词。
// 两态共享「记忆当前态 → render()」单一渲染路径：状态推进互相覆盖（与外提前行为一致），
// 语言切换时按最后写入的态重渲染。

import { onLocaleChange, t, type TFuncKey } from "./i18n";
import type { EngineStatus } from "./lsp/client";

/** 芯片元素（每次现查，同 cursorStatus 范式：单测 beforeEach 重建 DOM 不受缓存干扰） */
function el(): HTMLElement {
  const node = document.getElementById("status-lsp");
  if (!node) throw new Error("缺少元素 #status-lsp");
  return node;
}

/** 芯片当前态：引擎状态机态 / 一次性提示态（key + 可选插值参数，供语言切换重取词） */
type ChipState =
  | { kind: "engine"; status: EngineStatus }
  | { kind: "note"; key: TFuncKey; params?: Record<string, string | number> };

let chip: ChipState = { kind: "engine", status: "off" };

/** D3 P-09：状态点（灰未启动 / 黄启动中 / 绿就绪 / 红错误） */
const DOT_CLASS: Record<EngineStatus, string> = {
  off: "dot-off", starting: "dot-starting", ready: "dot-ready",
  error: "dot-error", exited: "dot-off",
};

/** 状态机态文案（取词点集中在此，语言切换重渲染共用同一张表） */
function engineLabel(s: EngineStatus): string {
  const map: Record<EngineStatus, TFuncKey> = {
    off: "main.lsp.off", starting: "main.lsp.starting", ready: "main.lsp.ready",
    error: "main.lsp.error", exited: "main.lsp.exited",
  };
  return t(map[s]);
}

function render(): void {
  if (chip.kind === "note") {
    el().textContent = t(chip.key, chip.params);
    return;
  }
  const dot = document.createElement("span");
  dot.className = `lsp-dot ${DOT_CLASS[chip.status]}`;
  el().replaceChildren(dot, engineLabel(chip.status));
}

/** 引擎状态机渲染（main 的 onEngineStatus 回调；注册即回调一次，初始 off 与外提前一致） */
export function setLspEngineStatus(status: EngineStatus): void {
  chip = { kind: "engine", status };
  render();
}

/** 一次性提示（无 py 跳过 / 启动失败）；引擎状态推进后自然覆盖 */
export function setLspNote(key: TFuncKey, params?: Record<string, string | number>): void {
  chip = { kind: "note", key, params };
  render();
}

// 语言切换重取词：顶层订阅（注册不解析 DOM；render 内 lazyEl 惰性，同 depHealth/todoView 范式）
onLocaleChange(render);
