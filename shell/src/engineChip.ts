// 状态栏「静态语义引擎」chip（C2）：身份展示 + 切换入口。
// 引擎真值统一收敛到 app.settings.lsp_engine（修复原先 menubar select 与 settings 分叉的 bug）：
// chip 只做「渲染 settings + 写回 settings + 持久化 + 重启」，不再有第二份 DOM 真值。
// main.ts 与 settingsPanel.ts 都从本模块 import renderEngineChip，避免把 chip 渲染散在两处；
// startLsp / saveSettings 经 handler 注入，本模块不反向依赖 main.ts / settingsPanel.ts（无循环导入）。

import { app, $ } from "./state";
import { showMenu } from "./menu";

export interface EngineChipHandlers {
  /** 重启静态引擎（main.ts 的 startLsp，现已改读 app.settings.lsp_engine） */
  startLsp: () => Promise<void>;
  /** 持久化设置（settingsPanel.ts 的 saveSettings） */
  saveSettings: () => Promise<void>;
}

let handlers: EngineChipHandlers | null = null;
const statusEngineEl = $("status-engine");

const ENGINES = [
  { id: "pyrefly", label: "pyrefly" },
  { id: "basedpyright", label: "basedpyright" },
];

export function setEngineChipHandlers(h: EngineChipHandlers): void {
  handlers = h;
}

/** 渲染 chip 文本（唯一真值来源 = app.settings.lsp_engine） */
export function renderEngineChip(): void {
  statusEngineEl.textContent = app.settings.lsp_engine || "pyrefly";
}

/** 切换引擎：同值跳过；否则写回 settings → 持久化 → 重绘 chip → 重启 LSP */
async function switchEngine(engine: string): Promise<void> {
  if (engine === app.settings.lsp_engine) return;
  app.settings.lsp_engine = engine;
  await handlers?.saveSettings();
  renderEngineChip();
  await handlers?.startLsp();
}

/** 接线 chip 的点击 / 键盘（Enter / Space）入口 */
export function wireEngineChip(): void {
  statusEngineEl.addEventListener("click", openEngineMenu);
  statusEngineEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEngineMenu();
    }
  });
}

function openEngineMenu(): void {
  const current = app.settings.lsp_engine;
  showMenu(
    ENGINES.map((e) => ({
      label: e.label,
      checked: e.id === current,
      action: () => void switchEngine(e.id),
    })),
    statusEngineEl,
  );
}