// A5③：handler→route 反向跳转（CodeLens「端点 N」）。
//
// 在源码 handler 的 def 行上方与引用计数 lens 并列显示「端点 N」（N = 该 handler
// 绑定的端点数，含 include_router 多前缀合并），点击弹 content widget 列出绑定
// route，条目可跳端点面板（激活 + 高亮）或复制 URL。
//
// 与 `codeVision.ts` 的关系：**不侵入**——引用计数 lens 保持专责；本模块注册
// 第二个 python CodeLens provider，Monaco 按 range 合并、同行并排（官方聚合行为）。
//
// 数据源：懒扫描（不依赖端点面板是否打开过）。`scan_endpoints` 是纯文本零子进程
// 扫描，重复 invoke 成本可接受；索引缓存键 = workspaceRoot，工作区切换时
// `resetEpJump()` 清掉。纯函数（索引建/查）在 `epJumpCore.ts`，本文件只做
// 「取数 + 渲染 + 弹层」；file 路径进出两端用 `normalizePath` 归一（项目铁律）。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";
import { basename, codicon, DisposableStore, errMsg, normalizePath } from "./util";
import { t } from "./i18n";
import { toast, toastFail } from "./toast";
import { fullEndpointUrl } from "./frameworks";
import { lastServiceBaseUrl } from "./termUi";
import { documentSymbols, modelPath, type LspDocumentSymbol } from "./lsp/client";
import {
  buildHandlerIndex,
  findMatches,
  hasMatches,
  type EpMatch,
  type HandlerIndex,
} from "./epJumpCore";

/** 出 lens 的符号种类：Class(5) / Method(6) / Function(12)（同 codeVision） */
const LENS_KINDS = new Set([5, 6, 12]);

interface EpSymbol {
  line: number;
  col: number;
  name: string;
}

function collectSymbols(list: LspDocumentSymbol[], out: EpSymbol[]): void {
  for (const s of list) {
    if (LENS_KINDS.has(s.kind)) {
      const start = s.selectionRange.start;
      out.push({ line: start.line + 1, col: start.character + 1, name: s.name });
    }
    if (s.children) collectSymbols(s.children, out);
  }
}

// ---------- 端点索引（懒扫描 + 缓存） ----------

let index: HandlerIndex | null = null;
let indexRoot: string | null = null;
let scanToken = 0;
let notify: (() => void) | null = null;

/** 确保索引就绪：工作区未开 → 清索引；已扫过同 root → 直接复用；否则懒扫一次 */
async function ensureIndex(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root) {
    index = null;
    indexRoot = null;
    return;
  }
  if (index && indexRoot === root) return;
  const token = ++scanToken;
  let got: EpMatch[];
  try {
    got = await invoke<EpMatch[]>("scan_endpoints", { root });
  } catch (e) {
    console.warn("[epJump] 端点扫描失败（CodeLens 不显示）：", errMsg(e));
    index = null;
    indexRoot = null;
    notify?.();
    return;
  }
  if (token !== scanToken) return; // 已有更新的触发，丢弃旧结果
  index = buildHandlerIndex(got.map((m) => ({ ...m, file: normalizePath(m.file) })));
  indexRoot = root;
  notify?.(); // 扫描完成 → 补一炮刷新（首开文件时 lens 先空后补）
}

// ---------- 端点弹层（content widget，仿 codeVision showUsagesPopup） ----------

let popupWidget: MonacoApi.editor.IContentWidget | null = null;
let popupKeys: MonacoApi.IDisposable | null = null;
let popupOutside: ((e: MouseEvent) => void) | null = null;

function closeEpPopup(): void {
  popupKeys?.dispose();
  popupKeys = null;
  if (popupOutside) {
    document.removeEventListener("mousedown", popupOutside);
    popupOutside = null;
  }
  if (popupWidget) {
    app.editor.removeContentWidget(popupWidget);
    popupWidget = null;
  }
}

async function showEpPopup(line: number, col: number): Promise<void> {
  const ed = app.editor;
  const model = ed.getModel();
  if (!model || !index) return;
  closeEpPopup();
  const pos = new app.monaco.Position(line, col);
  const path = modelPath(model);
  const name = model.getWordAtPosition(pos)?.word ?? "";
  if (!path) return;
  const ms = findMatches(index, normalizePath(path), name);
  if (ms.length === 0) return;
  const host = document.createElement("div");
  host.className = "oc-epj-popup";
  const header = document.createElement("div");
  header.className = "oc-epj-popup-header";
  header.textContent = t("editor.epLensTitle", { name, count: ms.length });
  host.appendChild(header);

  const list = document.createElement("div");
  list.className = "oc-epj-popup-list";
  for (const m of ms) {
    // 行用 div[role=button]（不是 <button>）：行内还要嵌一个可聚焦的「复制 URL」
    // 子按钮，<button> 的内容模型禁止交互性内容（嵌套 button / role=button 皆非法）。
    // 键盘可达性因此显式补齐：row 自己处理 Enter / Space，样式钩子 .oc-epj-row 不变。
    const row = document.createElement("div");
    row.className = "oc-epj-row";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    const badge = document.createElement("span");
    badge.className = `ep-badge ep-badge-${m.method.toLowerCase()}`;
    badge.textContent = m.method;
    const route = document.createElement("span");
    route.className = "oc-epj-row-route";
    route.textContent = m.route;
    const loc = document.createElement("span");
    loc.className = "oc-epj-row-loc";
    loc.textContent = `${basename(m.file)}:${m.line}`;
    loc.title = m.file;
    row.append(badge, route, loc);
    const activate = (): void => {
      closeEpPopup();
      handlers?.activateEndpoint(m.route);
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activate();
      }
    });
    list.appendChild(row);

    // 复制 URL 小图标（无运行服务 → 提示先运行，跳面板仍可用）
    const copy = document.createElement("span");
    copy.className = "oc-epj-row-copy";
    copy.setAttribute("role", "button");
    copy.tabIndex = 0;
    copy.setAttribute("aria-label", t("endpoints.jumpCopy"));
    copy.appendChild(codicon("copy"));
    const doCopy = (): void => {
      const url = fullEndpointUrl(lastServiceBaseUrl(), m.route);
      if (!url) {
        toast(t("endpoints.jumpNoBase"), "info");
        return;
      }
      void invoke("copy_to_clipboard", { text: url })
        .then(() => toast(t("endpoints.jumpCopied"), "success"))
        .catch((e) => toastFail(t("endpoints.jumpFailCopy"), e));
    };
    copy.addEventListener("click", (ev) => {
      ev.stopPropagation();
      doCopy();
    });
    copy.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        doCopy();
      }
    });
    row.append(copy);
  }
  host.appendChild(list);

  popupWidget = {
    getId: () => "montauri.epJumpPopup",
    getDomNode: () => host,
    getPosition: () => ({
      position: pos,
      preference: [
        app.monaco.editor.ContentWidgetPositionPreference.BELOW,
        app.monaco.editor.ContentWidgetPositionPreference.ABOVE,
      ],
    }),
  };
  ed.addContentWidget(popupWidget);
  popupKeys = ed.onKeyDown((e) => {
    if (e.keyCode === app.monaco.KeyCode.Escape) {
      closeEpPopup();
      ed.focus();
    }
  });
  // 关键时序（实测踩坑）：showEpPopup 是同步的，若在本函数内直接
  // document.addEventListener("mousedown", popupOutside)，会被「打开弹层的这一次 mousedown」
  // 在冒泡阶段命中（事件派发到 document 前监听已注册）→ host.contains(目标)=false →
  // 弹层创建后同一事件立刻关闭，popup 永远不显示。用 setTimeout(0) 把注册延后到独立 task
  //（mousedown/mouseup/click 全部派发完成之后，微任务在部分 Playwright 时序下仍可能提前，
  // 实测 queueMicrotask 不可靠）。codeVision 弹层无恙正是因为它有 await 挂起，天然延后。
  window.setTimeout(() => {
    popupOutside = (e) => {
      if (popupWidget && !host.contains(e.target as Node)) closeEpPopup();
    };
    document.addEventListener("mousedown", popupOutside);
  }, 0);
}

// ---------- 跳转动作注入（main.ts 接线） ----------

export interface EpJumpHandlers {
  /** 激活端点面板并高亮该 route 的条目 */
  activateEndpoint: (route: string) => void;
}

let handlers: EpJumpHandlers | null = null;

export function setEpJumpHandlers(h: EpJumpHandlers): void {
  handlers = h;
}

// ---------- 生命周期 ----------

/** 注册端点 CodeLens provider（main.ts 在 initCodeVision 旁调用一次） */
export function initEpJump(editor: MonacoApi.editor.IStandaloneCodeEditor): MonacoApi.IDisposable {
  const store = new DisposableStore();
  const commandId = editor.addCommand(0, (_ctx, line: number, col: number) => {
    void showEpPopup(line, col);
  });

  let listeners: Array<(e: MonacoApi.languages.CodeLensProvider) => void> = [];
  const fire = (): void => {
    for (const l of listeners) l(provider);
  };
  notify = fire;
  const onDidChange = (l: (e: MonacoApi.languages.CodeLensProvider) => void): MonacoApi.IDisposable => {
    listeners.push(l);
    return { dispose: () => (listeners = listeners.filter((x) => x !== l)) };
  };

  // 文档符号缓存（uri + version → 符号表）：避免每次 lens 请求都发 documentSymbols
  let symCache: { uri: string; version: number; symbols: EpSymbol[] } | null = null;
  const symbolsFor = async (model: MonacoApi.editor.ITextModel): Promise<EpSymbol[]> => {
    const uri = model.uri.toString();
    const version = model.getVersionId();
    if (symCache && symCache.uri === uri && symCache.version === version) return symCache.symbols;
    const path = modelPath(model);
    const roots = path ? await documentSymbols(path) : [];
    const symbols: EpSymbol[] = [];
    collectSymbols(roots, symbols);
    symCache = { uri, version, symbols };
    return symbols;
  };

  const provider: MonacoApi.languages.CodeLensProvider = {
    onDidChange,
    async provideCodeLenses(model) {
      // 首扫未完成则等待（scan_endpoints 是轻量文件扫描，阻塞毫秒级）：首次请求直接出 lens，
      // 不依赖「先返回空 → ensureIndex 完成 → notify 补刷新」的时序链——实测该链 flaky
      // （Monaco 的 onDidChange 补刷新在部分时序下不触发，索引就绪但 lens 永远不渲染）。
      await ensureIndex();
      const idx = index; // 局部捕获：async 中 index 可能在 await 间变化，闭包须持快照
      if (!idx) return { lenses: [], dispose: () => undefined };
      const path = modelPath(model);
      if (!path) return { lenses: [], dispose: () => undefined };
      const symbols = await symbolsFor(model);
      const norm = normalizePath(path);
      // 只对「绑定 > 0」的函数出 lens：端点索引空 / 未命中 → 什么都不显示
      const lenses = symbols
        .filter((s) => hasMatches(idx, norm, s.name))
        .map((s) => ({
          range: {
            startLineNumber: s.line,
            startColumn: s.col,
            endLineNumber: s.line,
            endColumn: s.col,
          },
        }));
      return { lenses, dispose: () => undefined };
    },
    async resolveCodeLens(model, lens) {
      const path = modelPath(model);
      if (!path || !index) return lens;
      const pos = new app.monaco.Position(lens.range.startLineNumber, lens.range.startColumn);
      const name = model.getWordAtPosition(pos)?.word ?? "";
      const ms = findMatches(index, normalizePath(path), name);
      if (ms.length > 0 && commandId) {
        lens.command = {
          id: commandId,
          title: t("editor.epLens", { count: ms.length }),
          arguments: [lens.range.startLineNumber, lens.range.startColumn],
        };
      }
      return lens;
    },
  };
  store.add(app.monaco.languages.registerCodeLensProvider("python", provider));

  // 立即预扫：让索引在 Monaco 首次请求前就绪（首轮 provideCodeLenses 直接出 lens，
  // 免去「先返回空 → ensureIndex 完成 → notify 补刷新」的时序竞争——实测该链 flaky）。
  // 工作区未开时 ensureIndex 置空返回；之后 provideCodeLenses 的 void ensureIndex()
  // 会在打开工作区后重扫（indexRoot 变化）。
  void ensureIndex();
  // 刷新触发器（对齐 codeVision 的稳定模式）：内容变更防抖 / 换文件收起弹层并补一炮 /
  // 首启 warmup——Monaco 的 onDidChange 刷新在某些时序下不可靠，多路触发兜底。
  store.add(editor.onDidChangeModelContent(() => fire()));
  store.add(editor.onDidChangeModel(() => {
    closeEpPopup(); // 换文件即收起端点弹层（同 codeVision）
    fire();
  }));
  const warmup = window.setTimeout(() => {
    for (const l of listeners) l(provider);
  }, 2500);
  store.add({ dispose: () => window.clearTimeout(warmup) });

  store.add({
    dispose: () => {
      notify = null;
      symCache = null;
      closeEpPopup();
    },
  });
  return store;
}

/** 工作区切换：清索引与弹层（resetEndpointView 同处调用） */
export function resetEpJump(): void {
  scanToken++;
  index = null;
  indexRoot = null;
  closeEpPopup();
}

/** 强制重扫并刷新 lens（rename 落盘 / 端点面板手动刷新后由 main 延迟调用） */
export function refreshEpJump(): void {
  index = null;
  indexRoot = null;
  notify?.();
}
