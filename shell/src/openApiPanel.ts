// A5④：OpenAPI 面板内预览（前端侧 · 渲染与取数层）。
//
// 数据来自 Rust `openapi_cmds::fetch_openapi`——拉运行中服务 `/openapi.json`，
// 扁平化为操作列表（方法 + 路径 + summary + tags）。本文件只管「取数 + 渲染」；
// 纯函数（匹配 / 排序）在 `openApiCore.ts`，那里零 app 依赖、可被单测直取。
//
// 交互：端点面板工具栏「预览」按钮 → 懒加载展开块（单例，同一时刻只展开一处，
// 缓存键 = base URL）；条目点击 → 匹配静态扫描结果跳源码，匹配不到明说。
//
// 解耦：不直接 import endpointView（避免循环依赖）——扫描结果与 openFile 都经
// `setOpenApiPreviewHandlers` 由 main.ts 注入。

import { invoke } from "@tauri-apps/api/core";
import { errMsg } from "./util";
import { t } from "./i18n";
import { localizeBackendError } from "./i18n/backendError";
import { lastServiceBaseUrl } from "./termUi";
import { toast } from "./toast";
import { findScanMatch, sortOps, type OpenApiOp, type ScanMatch } from "./openApiCore";

// ---------- 依赖注入（main.ts 接线） ----------

export interface OpenApiPreviewHandlers {
  /** 打开源码声明并定位（main.ts 的 openFile） */
  openFile: (path: string, line: number) => void;
  /** 当前静态扫描结果（endpointView.getEndpointResults，main 注入以解环） */
  getScanResults: () => ScanMatch[];
}

let handlers: OpenApiPreviewHandlers | null = null;

export function setOpenApiPreviewHandlers(h: OpenApiPreviewHandlers): void {
  handlers = h;
}

// ---------- 单例展开态 ----------

let openKey: string | null = null;
let openEl: HTMLElement | null = null;
const cache = new Map<string, OpenApiOp[]>();

/** 收起当前展开的预览块（元素随面板重建而消失时也要清引用） */
export function collapseOpenApiPreview(): void {
  if (openEl?.parentNode) openEl.remove();
  openKey = null;
  openEl = null;
}

/** 工作区切换 / 重新扫描时复位：展开态与缓存一并清掉 */
export function resetOpenApiPreview(): void {
  collapseOpenApiPreview();
  cache.clear();
}

/** 展开 / 收起预览块（同一时刻只展开一处；无运行服务直接提示先运行） */
export function toggleOpenApiPreview(root: HTMLElement): void {
  const base = lastServiceBaseUrl();
  if (!base) {
    toast(t("endpoints.serviceNotRunning"), "info");
    return;
  }
  const wasOpen = openKey === base;
  collapseOpenApiPreview();
  if (wasOpen) return;

  const el = document.createElement("div");
  el.className = "ep-preview";
  root.insertBefore(el, root.querySelector("#ep-results"));
  openKey = base;
  openEl = el;
  void fillPreview(el, base);
}

// ---------- 取数 + 渲染 ----------

function hintLine(cls: string, text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = `ep-preview-hint ep-preview-hint--${cls}`;
  d.textContent = text;
  return d;
}

async function fillPreview(el: HTMLElement, base: string): Promise<void> {
  const hit = cache.get(base);
  if (hit) {
    renderPreview(el, hit);
    return;
  }
  el.textContent = "";
  el.appendChild(hintLine("loading", t("endpoints.previewFetching")));
  let got: OpenApiOp[];
  try {
    got = await invoke<OpenApiOp[]>("fetch_openapi", { baseUrl: base });
  } catch (e) {
    if (openEl !== el) return; // 期间已收起 / 重建
    el.textContent = "";
    el.appendChild(
      hintLine("error", t("endpoints.previewFailed", { error: localizeBackendError(errMsg(e)) })),
    );
    return;
  }
  cache.set(base, got);
  if (openEl !== el) return;
  renderPreview(el, got);
}

function renderPreview(el: HTMLElement, ops: OpenApiOp[]): void {
  el.textContent = "";
  const sorted = sortOps(ops);

  const head = document.createElement("div");
  head.className = "ep-preview-head";
  const title = document.createElement("span");
  title.className = "ep-preview-title";
  title.textContent = t("endpoints.previewTitle");
  const count = document.createElement("span");
  count.className = "ep-preview-count";
  count.textContent = t("endpoints.previewOps", { count: ops.length });
  head.append(title, count);
  el.appendChild(head);

  if (ops.length === 0) {
    el.appendChild(hintLine("muted", t("endpoints.previewEmpty")));
    return;
  }

  const list = document.createElement("div");
  list.className = "ep-preview-list";
  for (const op of sorted) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "ep-preview-row";
    const badge = document.createElement("span");
    badge.className = `ep-badge ep-badge-${op.method.toLowerCase()}`;
    badge.textContent = op.method;
    const path = document.createElement("span");
    path.className = "ep-preview-path";
    path.textContent = op.path;
    if (op.operation_id) path.title = op.operation_id;
    const meta = document.createElement("span");
    meta.className = "ep-preview-meta";
    const bits: string[] = [];
    if (op.summary) bits.push(op.summary);
    if (op.tags.length > 0) bits.push(op.tags.join(", "));
    meta.textContent = bits.join(" · ");
    if (op.deprecated) {
      const dep = document.createElement("span");
      dep.className = "ep-preview-deprecated";
      dep.textContent = t("endpoints.previewDeprecated");
      row.append(badge, path, meta, dep);
    } else {
      row.append(badge, path, meta);
    }
    row.addEventListener("click", () => {
      const scan = handlers?.getScanResults() ?? [];
      const m = findScanMatch(op, scan);
      if (m) handlers?.openFile(m.file, m.line);
      else toast(t("endpoints.previewJumpNotFound"), "info");
    });
    list.appendChild(row);
  }
  el.appendChild(list);
}
