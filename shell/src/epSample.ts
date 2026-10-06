// A5①：端点请求样例（前端侧 · 渲染与取数层）。
//
// 数据来自 Rust `ep_sample_cmds::scan_endpoint_sample`——静态解析 handler 签名
// （path / query / header / cookie / body 分类）+ 工作区 Pydantic 模型索引展开请求体字段。
//
// 本文件只管「取数 + 渲染」；纯函数（URL 拼装 / cURL 生成 / 文案码映射）在 `epSampleCore.ts`，
// 那里零 app 依赖、可被单测直取。此处转发导出，调用方只 import 本模块即可。
//
// 为什么 curl 在前端拼而不是 Rust：cURL 要用**运行中服务的 base URL**
// （`lastServiceBaseUrl()`，来自终端就绪行解析），那是前端状态；Rust 侧只产出与地址无关的
// 形状信息（参数分类 + 请求体 JSON）。

import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";
import { codicon, errMsg } from "./util";
import { t } from "./i18n";
import type { TKey } from "./i18n/locales/zh-CN";
import { localizeBackendError } from "./i18n/backendError";
import { lastServiceBaseUrl } from "./termUi";
import { openHttpTool } from "./devtools";
import { toast, toastFail } from "./toast";
import {
  buildCurl,
  buildRequestUrl,
  compactBody,
  kindText,
  noteText,
  skipText,
  type EndpointSample,
  type SampleParam,
  type SampleTarget,
} from "./epSampleCore";

export * from "./epSampleCore";

// ---------- 行内详情块（单例展开态） ----------

let openKey: string | null = null;
let openEl: HTMLElement | null = null;
const cache = new Map<string, EndpointSample>();

const keyOf = (target: SampleTarget): string => `${target.file}:${target.line}`;

/** 收起当前展开的样例块（元素随列表重建而消失时也要清引用） */
export function collapseEndpointSample(): void {
  if (openEl?.parentNode) openEl.remove();
  openKey = null;
  openEl = null;
}

/** 工作区切换 / 重新扫描时复位：展开态与缓存一并清掉（行号可能已变） */
export function resetEndpointSample(): void {
  collapseEndpointSample();
  cache.clear();
}

/** 展开 / 收起某一行下方的样例块（同一时刻只展开一行） */
export function toggleEndpointSample(row: HTMLElement, target: SampleTarget): void {
  const key = keyOf(target);
  const wasOpen = openKey === key;
  collapseEndpointSample();
  if (wasOpen) return;

  const el = document.createElement("div");
  el.className = "ep-sample";
  row.after(el);
  openKey = key;
  openEl = el;
  void fillSample(el, key, target);
}

async function fillSample(el: HTMLElement, key: string, target: SampleTarget): Promise<void> {
  const hit = cache.get(key);
  if (hit) {
    renderSample(el, target, hit);
    return;
  }
  el.textContent = "";
  el.appendChild(hintLine("loading", t("endpoints.sampleLoading")));
  let got: EndpointSample;
  try {
    got = await invoke<EndpointSample>("scan_endpoint_sample", {
      root: app.workspaceRoot,
      file: target.file,
      line: target.line,
      handler: target.handler,
      route: target.route,
      framework: target.framework,
      method: target.method,
    });
  } catch (e) {
    if (openEl !== el) return; // 期间已切到别的行
    el.textContent = "";
    el.appendChild(hintLine("error", t("endpoints.sampleFailed", { error: localizeBackendError(errMsg(e)) })));
    return;
  }
  cache.set(key, got);
  if (openEl !== el) return;
  renderSample(el, target, got);
}

function hintLine(cls: string, text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = `ep-sample-hint ep-sample-hint--${cls}`;
  d.textContent = text;
  return d;
}

function sectionLabel(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "ep-sample-label";
  d.textContent = text;
  return d;
}

function iconButton(id: string, tip: string, icon: string, onClick: () => void): HTMLElement {
  const b = document.createElement("button");
  b.id = id;
  b.className = "btn btn--ghost btn--icon";
  b.dataset.tip = tip;
  b.setAttribute("aria-label", tip);
  b.appendChild(codicon(icon));
  b.addEventListener("click", onClick);
  return b;
}

/** 复制到剪贴板并提示（两处复制按钮共用） */
function copyText(text: string, okMsg: string, failMsg: string): void {
  void invoke("copy_to_clipboard", { text })
    .then(() => toast(okMsg, "success"))
    .catch((e) => toastFail(failMsg, e));
}

const COL_KEYS: TKey[] = [
  "endpoints.sampleColName",
  "endpoints.sampleColIn",
  "endpoints.sampleColType",
  "endpoints.sampleColRequired",
  "endpoints.sampleColDefault",
  "endpoints.sampleColValue",
];

function paramTable(params: SampleParam[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "ep-sample-block";
  box.appendChild(sectionLabel(t("endpoints.sampleParams")));
  if (params.length === 0) {
    box.appendChild(hintLine("muted", t("endpoints.sampleNoParams")));
    return box;
  }
  const table = document.createElement("table");
  table.className = "ep-sample-table";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  for (const k of COL_KEYS) {
    const th = document.createElement("th");
    th.textContent = t(k);
    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const p of params) {
    const tr = document.createElement("tr");
    if (p.kind === "skip") tr.className = "ep-sample-row--skip";
    const cells = [
      p.name,
      kindText(p.kind),
      p.type_text || t("endpoints.sampleEmpty"),
      p.required ? t("endpoints.sampleYes") : t("endpoints.sampleNo"),
      p.default ?? t("endpoints.sampleEmpty"),
      p.kind === "skip" ? skipText(p.note) : p.value_text || t("endpoints.sampleEmpty"),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      // 类型与默认值可能很长（`Query(..., ge=1)`），title 承载全文
      if (i === 2 || i === 4 || i === 5) td.title = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);
  return box;
}

function bodyBlock(sample: EndpointSample): HTMLElement {
  const box = document.createElement("div");
  box.className = "ep-sample-block";
  box.appendChild(
    sectionLabel(
      sample.body_model
        ? t("endpoints.sampleBody", { model: sample.body_model })
        : t("endpoints.sampleBodyPlain"),
    ),
  );
  if (!sample.body_json) {
    box.appendChild(hintLine("muted", t("endpoints.sampleBodyNone")));
    return box;
  }
  const pre = document.createElement("pre");
  pre.className = "ep-sample-json";
  pre.id = "ep-sample-body";
  pre.textContent = sample.body_json;
  box.appendChild(pre);
  return box;
}

function renderSample(el: HTMLElement, target: SampleTarget, sample: EndpointSample): void {
  el.textContent = "";
  const url = buildRequestUrl(lastServiceBaseUrl(), target.route, sample.params);

  // 头部：标题 + 动作
  const head = document.createElement("div");
  head.className = "ep-sample-head";
  const title = document.createElement("span");
  title.className = "ep-sample-title";
  title.textContent = t("endpoints.sampleTitle", {
    method: target.method,
    route: target.route,
    handler: target.handler || "?",
  });
  const acts = document.createElement("span");
  acts.className = "ep-sample-acts";
  const curl = buildCurl(target.method, url, sample);
  acts.appendChild(
    iconButton("ep-sample-copy-curl", t("endpoints.sampleCopyCurl"), "copy", () =>
      copyText(curl, t("endpoints.sampleCopiedCurl"), t("endpoints.sampleCopyCurl")),
    ),
  );
  if (sample.body_json) {
    acts.appendChild(
      iconButton("ep-sample-copy-json", t("endpoints.sampleCopyJson"), "json", () =>
        copyText(sample.body_json ?? "", t("endpoints.sampleCopiedJson"), t("endpoints.sampleCopyJson")),
      ),
    );
  }
  if (target.method !== "WS") {
    acts.appendChild(
      iconButton("ep-sample-send", t("endpoints.sampleSend"), "play", () => {
        const body = compactBody(sample);
        openHttpTool(url, { method: target.method, ...(body !== null ? { body } : {}) });
      }),
    );
  }
  head.append(title, acts);
  el.appendChild(head);

  for (const code of sample.notes) el.appendChild(hintLine("note", noteText(code)));

  el.appendChild(paramTable(sample.params));
  el.appendChild(bodyBlock(sample));

  const curlBox = document.createElement("div");
  curlBox.className = "ep-sample-block";
  curlBox.appendChild(sectionLabel(t("endpoints.sampleCurl")));
  const pre = document.createElement("pre");
  pre.className = "ep-sample-curl";
  pre.id = "ep-sample-curl";
  pre.textContent = curl;
  curlBox.appendChild(pre);
  el.appendChild(curlBox);
}
