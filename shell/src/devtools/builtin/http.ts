// HTTP 请求工具（B4 · docs/toolbox_dev_plan.md §5 v2）。
//
// 形态：devtools **内置工具**（Ctrl+Shift+T 随时唤起），面板驱动，**不在项目目录落下任何文件**；
// 草稿经 `host.storage`（localStorage，按插件 id 隔离）保存，见 §5.2。
//
// 交互细节全部照 §5.7，三条最容易写错的：
//  1. **渲染单点驱动**：所有 UI 变化都经 `setState` → `render(s)`，不在 then/catch 里零散改 DOM；
//  2. **loading 不新造**：细进度条（非遮罩）+ 发送中旧响应灰显不清空 + `setBusy` 按钮忙碌态；
//  3. **令牌防竞态**：`state.opId` 比对，dispose / 取消后到达的回包一律丢弃。
//
// PR-B4-3 才做的：变量/全局环境、历史回填、curl 粘贴导入、响应保存、端点视图联动。

import type { HttpRequestPayload, HttpResponsePayload, PanelHost } from "../../extensions/facade";
import { app } from "../../state"; // B4：超时/重定向/是否落盘三项设置
import { t } from "../../i18n";
import { localizeBackendError } from "../../i18n/backendError";
import { codicon, emptyState, errMsg, setBusy } from "../../util";
import { flashError, flashSuccess } from "../feedback";
import {
  HTTP_METHODS,
  beginSend,
  cancelRequested,
  cancelSettled,
  classifyStatus,
  collectHeaders,
  curlToDraft,
  envVars,
  fail,
  formatBytes,
  formatElapsed,
  formatProgress,
  formatVarLines,
  imageDataUrl,
  initialHttpState,
  isEmptyBody,
  isStale,
  looksLikeCurl,
  parseDraft,
  parseEnvs,
  parseHistory,
  parseJsonBody,
  parseVarLines,
  pushHistory,
  resolveVariables,
  setNotice,
  serializeDraft,
  serializeEnvs,
  serializeHistory,
  succeed,
  type CurlWarn,
  type HttpDraft,
  type HttpEnvMap,
  type HttpHistoryEntry,
  type HttpUiState,
} from "./httpRequest";

/**
 * 端点视图联动：待填请求。
 * 工具**已挂载**（devtools 有实例缓存，切走不 dispose）时直接投递给在线消费者；
 * 否则先存起来，等下次 mount 消费——两条路都要通，否则"工具已开着再点端点"会静默失效。
 *
 * A5① 起 `method` / `body` 可选带上（端点视图的请求样例可直接落到方法选择与请求体框）；
 * 只给 `url` 时行为与旧版 `setPendingHttpUrl` 完全一致。
 */
export interface PendingRequest {
  url: string;
  method?: string;
  body?: string;
}

let pendingRequest: PendingRequest | null = null;
const pendingConsumers = new Set<(r: PendingRequest) => void>();

export function setPendingRequest(r: PendingRequest): void {
  if (pendingConsumers.size > 0) {
    for (const cb of pendingConsumers) cb(r);
    return;
  }
  pendingRequest = r;
}

/** 取消中间态最长等待（ms）：超时强制回落 idle，不弹错误（§5.7.3） */
const CANCEL_GRACE_MS = 3_000;
/** 耗时计时器刷新间隔（ms） */
const TICK_MS = 200;
/** JSON 树默认展开层数（§5.6 边界 2） */
const TREE_OPEN_DEPTH = 2;
/** JSON 数组 / 对象最多渲染的条目数（防超大响应把面板卡死） */
const TREE_MAX_CHILDREN = 200;

interface HeaderRow {
  el: HTMLElement;
  name: HTMLInputElement;
  value: HTMLInputElement;
}

export function mount(host: PanelHost): { dispose(): void } {
  const { kit } = host;
  host.root.textContent = "";
  const wrap = kit.body();

  // ---------- 请求区 ----------

  const methodSel = document.createElement("select");
  methodSel.className = "http-method";
  methodSel.setAttribute("aria-label", t("devtools.http.methodAria"));
  for (const m of HTTP_METHODS) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    methodSel.appendChild(opt);
  }

  const urlInput = kit.input({ placeholder: t("devtools.http.urlPh") });
  urlInput.classList.add("http-url");

  const sendBtn = kit.primaryButton(t("devtools.http.send"), "play");
  const cancelBtn = kit.button(t("devtools.http.cancel"), "stop");
  cancelBtn.disabled = true;

  // ---------- 进度条 + 状态行（§5.7.2：细进度条，不用 spinner 遮罩） ----------

  const progress = document.createElement("div");
  progress.className = "http-progress hidden";

  const statusEl = document.createElement("div");
  statusEl.className = "http-status http-status--idle";
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");

  // ---------- 请求头 ----------

  const headerRows: HeaderRow[] = [];
  const headersList = document.createElement("div");
  headersList.className = "http-header-list";

  const addHeaderRow = (name = "", value = ""): void => {
    const el = document.createElement("div");
    el.className = "http-header-row";
    const nameIn = kit.input({ placeholder: t("devtools.http.headerNamePh") });
    const valueIn = kit.input({ placeholder: t("devtools.http.headerValuePh") });
    nameIn.value = name;
    valueIn.value = value;
    // 输入即时更新摘要计数（只在增删时同步会让「请求头（0）」在填完后仍是 0）
    nameIn.addEventListener("input", syncHeadersSummary);
    valueIn.addEventListener("input", syncHeadersSummary);
    const del = kit.iconButton("trash", t("devtools.http.removeHeader"), () => {
      el.remove();
      const i = headerRows.findIndex((r) => r.el === el);
      if (i >= 0) headerRows.splice(i, 1);
      syncHeadersSummary();
    });
    el.append(nameIn, valueIn, del);
    headersList.appendChild(el);
    headerRows.push({ el, name: nameIn, value: valueIn });
    syncHeadersSummary();
  };

  const headersSection = document.createElement("details");
  headersSection.className = "http-section";
  headersSection.open = true;
  const headersSummary = document.createElement("summary");
  const headersBody = document.createElement("div");
  headersBody.className = "http-section-body";
  const addHeaderBtn = kit.button(t("devtools.http.addHeader"), "add", () => addHeaderRow());
  headersBody.append(headersList, kit.toolbar(addHeaderBtn));
  headersSection.append(headersSummary, headersBody);

  const syncHeadersSummary = (): void => {
    const n = collectHeaders(headerRows.map((r) => ({ name: r.name.value, value: r.value.value }))).length;
    headersSummary.textContent = t("devtools.http.headersSection", { n: String(n) });
  };

  // ---------- 请求体 ----------

  const bodySection = document.createElement("details");
  bodySection.className = "http-section";
  const bodySummary = document.createElement("summary");
  bodySummary.textContent = t("devtools.http.bodySection");
  const bodyInput = kit.textarea({ placeholder: t("devtools.http.bodyPh"), rows: 4 });
  // 专用类名（同 urlInput 的 .http-url 约定）：面板里有两个 .tool-textarea（请求体 / 环境变量），
  // 无类名时 e2e 选择器不唯一——EP-S2 的「送进 HTTP 工具预填请求体」断言需要它。
  bodyInput.classList.add("http-body");
  const bodyBody = document.createElement("div");
  bodyBody.className = "http-section-body";
  bodyBody.appendChild(bodyInput);
  bodySection.append(bodySummary, bodyBody);

  // ---------- 环境与变量（PR-B4-3） ----------

  const envSel = document.createElement("select");
  envSel.className = "http-env";
  envSel.setAttribute("aria-label", t("devtools.http.envAria"));
  const editVarsBtn = kit.button(t("devtools.http.editVars"), "edit", () => {
    varsSection.open = !varsSection.open;
  });

  const varsSection = document.createElement("details");
  varsSection.className = "http-section http-vars";
  const varsSummary = document.createElement("summary");
  const varsBody = document.createElement("div");
  varsBody.className = "http-section-body";
  const varsInput = kit.textarea({ placeholder: t("devtools.http.varsPh"), rows: 4 });
  const varsHint = document.createElement("div");
  varsHint.className = "http-hint http-hint--dim";
  const varsSaveBtn = kit.button(t("devtools.http.saveVars"), "save", () => saveVars());
  varsBody.append(varsInput, varsHint, kit.toolbar(varsSaveBtn));
  varsSection.append(varsSummary, varsBody);

  const envRow = kit.row(envSel, editVarsBtn);

  // ---------- 历史（PR-B4-3：最近 20 条，不存 body） ----------

  const historySection = document.createElement("details");
  historySection.className = "http-section http-history-section";
  const historySummary = document.createElement("summary");
  const historyBody = document.createElement("div");
  historyBody.className = "http-section-body http-history";
  historySection.append(historySummary, historyBody);

  // ---------- 响应区 ----------

  const respWrap = document.createElement("div");
  respWrap.className = "http-response";
  const respStatusLine = document.createElement("div");
  respStatusLine.className = "http-resp-status";
  const respHeaders = document.createElement("details");
  respHeaders.className = "http-section http-section--resp";
  const respHeadersSummary = document.createElement("summary");
  const respHeadersBody = document.createElement("div");
  respHeadersBody.className = "http-section-body http-headers-table";
  respHeaders.append(respHeadersSummary, respHeadersBody);
  const respBody = document.createElement("div");
  respBody.className = "http-resp-body";
  respWrap.append(respStatusLine, respHeaders, respBody);

  const errEl = kit.errorSlot();

  // 响应工具栏：复制 / 插入到编辑器（保存到磁盘留 v1.1，见交付记录——需新增写权限与 save 对话框通道）
  const insertBtn = kit.button(t("devtools.http.insertEditor"), "export");
  insertBtn.dataset.tip = t("devtools.http.insertEditorTip");
  insertBtn.addEventListener("click", () => {
    const body = state.lastResult?.body ?? "";
    if (body === "") {
      flashError(insertBtn, t("devtools.http.noBody"));
      return;
    }
    if (host.insertToEditor(body)) flashSuccess(insertBtn, t("devtools.http.inserted"));
    else flashError(insertBtn, t("devtools.common.noFileOpen"));
  });
  const respToolbar = kit.toolbar(kit.copyButton(() => state.lastResult?.body ?? ""), insertBtn);

  wrap.append(
    kit.row(methodSel, urlInput, sendBtn, cancelBtn),
    envRow,
    progress,
    statusEl,
    errEl,
    headersSection,
    bodySection,
    varsSection,
    historySection,
    respToolbar,
    respWrap,
  );
  host.root.appendChild(wrap);

  // ---------- 状态与渲染（单点驱动，§5.7.1） ----------

  let state: HttpUiState = initialHttpState();
  /** 当前请求在 Rust 侧的 op_id（字符串；进度事件与取消都用它） */
  let currentOpId = "";
  let ticker: number | undefined;
  let cancelTimer: number | undefined;

  const stopTicker = (): void => {
    if (ticker !== undefined) {
      window.clearInterval(ticker);
      ticker = undefined;
    }
  };

  const setState = (next: HttpUiState): void => {
    state = next;
    render();
  };

  const render = (): void => {
    const busy = state.phase === "sending" || state.phase === "cancelling";

    progress.classList.toggle("hidden", !busy);
    setBusy(sendBtn, busy, t("devtools.http.sending"));
    cancelBtn.disabled = state.phase !== "sending";
    cancelBtn.textContent = state.phase === "cancelling" ? t("devtools.http.cancelling") : t("devtools.http.cancel");

    statusEl.className = `http-status http-status--${statusKind()}`;
    statusEl.textContent = statusText();
    // 错误槽与状态行同源（单点驱动）：`error`（请求失败）与 `notice`（校验/导入提示）都只由 state 决定，
    // 任何地方都不得直接写 errEl（否则提示会残留到下一次操作）
    errEl.textContent =
      state.phase === "err" ? (state.error ?? t("devtools.http.sendFailed")) : (state.notice ?? "");

    respWrap.setAttribute("aria-busy", String(busy));
    // 发送中：旧响应灰显但不清空（§5.7.2）
    respWrap.classList.toggle("is-stale", isStale(state));

    if (!busy) stopTicker();
    renderResponse();
  };

  const statusKind = (): string => {
    if (state.phase === "sending" || state.phase === "cancelling") return "pending";
    if (state.phase === "err") return "err";
    if (state.phase === "ok" && state.lastResult) return classifyStatus(state.lastResult.status);
    return "idle";
  };

  const statusText = (): string => {
    switch (state.phase) {
      case "sending": {
        const ms = state.startedAt === null ? 0 : Date.now() - state.startedAt;
        return t("devtools.http.sendingElapsed", { time: formatElapsed(ms) });
      }
      case "cancelling":
        return t("devtools.http.cancellingHint");
      case "err":
        return state.error ?? t("devtools.http.sendFailed");
      case "ok": {
        const r = state.lastResult;
        if (!r) return t("devtools.http.idleHint");
        const code = `${r.status}${r.statusText ? ` ${r.statusText}` : ""}`;
        return `${code} · ${formatElapsed(r.elapsedMs)} · ${formatBytes(r.bytes)}`;
      }
      default:
        return t("devtools.http.idleHint");
    }
  };

  // ---------- 响应渲染 ----------

  /** 上次已渲染的结果引用：同一结果不重建 DOM（render 会因 notice/状态变化被频繁调用） */
  let lastRendered: HttpResponsePayload | null | undefined;

  const renderResponse = (): void => {
    if (state.lastResult === lastRendered) return;
    lastRendered = state.lastResult;
    respStatusLine.textContent = "";
    respHeadersBody.textContent = "";
    respBody.textContent = "";
    const res = state.lastResult;

    if (!res) {
      respStatusLine.classList.add("hidden");
      respHeaders.classList.add("hidden");
      respBody.appendChild(
        emptyState("globe", t("devtools.http.emptyTitle"), t("devtools.http.emptyHint"), true),
      );
      return;
    }

    respStatusLine.classList.remove("hidden");
    respHeaders.classList.remove("hidden");

    // 状态行：状态码按档上色（4xx 不是错误态，§5.7.4）
    const codeSpan = document.createElement("span");
    codeSpan.className = `http-code http-code--${classifyStatus(res.status)}`;
    codeSpan.textContent = `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    const metaSpan = document.createElement("span");
    metaSpan.className = "http-meta";
    metaSpan.textContent = `· ${formatElapsed(res.elapsedMs)} · ${formatBytes(res.bytes)}`;
    respStatusLine.append(codeSpan, metaSpan);

    // 附加提示（内网目标 / 截断）
    if (res.privateTarget) respStatusLine.appendChild(hint(t("devtools.http.privateTarget"), "warn"));
    if (res.truncated) respStatusLine.appendChild(hint(t("devtools.http.truncated"), "warn"));

    // 响应头（可折叠；默认收起——状态行已给关键信息）
    respHeadersSummary.textContent = t("devtools.http.respHeaders", { n: String(res.headers.length) });
    respHeaders.open = false;
    for (const [k, v] of res.headers) {
      const row = document.createElement("div");
      row.className = "http-header-cell";
      const kn = document.createElement("span");
      kn.className = "http-header-name";
      kn.textContent = k;
      const vn = document.createElement("span");
      vn.className = "http-header-value";
      vn.textContent = v;
      row.append(kn, vn);
      respHeadersBody.appendChild(row);
    }

    // 响应体：图片 → 预览；JSON → 树；其余 → 纯文本；空 → 明确提示
    const img = imageDataUrl(res);
    if (img) {
      const el = document.createElement("img");
      el.className = "http-image";
      el.src = img;
      el.alt = t("devtools.http.imageAlt");
      respBody.appendChild(el);
      return;
    }
    if (res.binary) {
      respBody.appendChild(hint(t("devtools.http.binaryHint", { size: formatBytes(res.bytes) }), "dim"));
      return;
    }
    if (isEmptyBody(res)) {
      respBody.appendChild(hint(t("devtools.http.noBody"), "dim"));
      return;
    }
    const parsed = parseJsonBody(res);
    if (parsed.ok) {
      respBody.appendChild(jsonNode(parsed.value, 0));
      return;
    }
    const pre = document.createElement("pre");
    pre.className = "http-text";
    pre.textContent = res.body;
    respBody.appendChild(pre);
  };

  const hint = (text: string, kind: "warn" | "dim"): HTMLElement => {
    const el = document.createElement("div");
    el.className = `http-hint http-hint--${kind}`;
    el.appendChild(codicon(kind === "warn" ? "warning" : "info"));
    el.append(text);
    return el;
  };

  /**
   * JSON 折叠树：`<details>` 原生可访问；默认展开到 `TREE_OPEN_DEPTH` 层。
   * **嵌套值递归成子节点**（`key` 为 null 时是根节点）——漏掉递归会让数组/对象在叶子里
   * 变成 `[object Object]`，是这类树最经典的写法错误。
   */
  const jsonNode = (value: unknown, depth: number, key: string | null = null): HTMLElement => {
    if (value !== null && typeof value === "object") {
      const isArr = Array.isArray(value);
      const entries: [string, unknown][] = isArr
        ? (value as unknown[]).map((v, i) => [String(i), v])
        : Object.entries(value as Record<string, unknown>);
      const shown = entries.slice(0, TREE_MAX_CHILDREN);
      const node = document.createElement("details");
      node.className = "json-node";
      node.open = depth < TREE_OPEN_DEPTH;
      const sum = document.createElement("summary");
      const label = isArr
        ? t("devtools.http.jsonArray", { n: String(entries.length) })
        : t("devtools.http.jsonObject", { n: String(entries.length) });
      sum.textContent = key === null ? label : `${key} · ${label}`;
      node.appendChild(sum);
      const kids = document.createElement("div");
      kids.className = "json-children";
      for (const [k, v] of shown) kids.appendChild(jsonNode(v, depth + 1, k));
      if (entries.length > shown.length) {
        kids.appendChild(hint(t("devtools.http.jsonMore", { n: String(entries.length - shown.length) }), "dim"));
      }
      node.appendChild(kids);
      return node;
    }
    return jsonLeaf(key, value);
  };

  const jsonLeaf = (key: string | null, value: unknown): HTMLElement => {
    const row = document.createElement("div");
    row.className = "json-leaf";
    if (key !== null) {
      const kn = document.createElement("span");
      kn.className = "json-key";
      kn.textContent = `${key}:`;
      row.appendChild(kn);
    }
    const vn = document.createElement("span");
    vn.className = `json-value json-value--${valueKind(value)}`;
    vn.textContent = valueText(value);
    row.appendChild(vn);
    return row;
  };

  const valueKind = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "string") return "string";
    if (typeof v === "number") return "number";
    if (typeof v === "boolean") return "boolean";
    return "other";
  };

  const valueText = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "string") return `"${v}"`;
    return String(v);
  };

  // ---------- 持久化底座（§5.2：storage，按工作区隔离；环境跨工作区） ----------

  const readStorage = (key: string): string | null => {
    try {
      return host.storage.get(key);
    } catch {
      return null; // storage 不可用（隐私模式等）不该影响发送主流程
    }
  };

  const writeStorage = (key: string, value: string): void => {
    try {
      host.storage.set(key, value);
    } catch {
      /* 同上：静默降级 */
    }
  };

  const shortHash = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };

  /** 工作区作用域的 key（无工作区 / 无 fs:read 时退到 global） */
  const wsKey = (prefix: string): string => {
    let root: string | null = null;
    try {
      root = host.workspaceRoot();
    } catch {
      root = null;
    }
    return root ? `${prefix}.${shortHash(root)}` : `${prefix}.global`;
  };

  // ---------- 草稿 ----------

  const currentDraft = (): HttpDraft => ({
    method: methodSel.value,
    url: urlInput.value,
    headers: headerRows.map((r) => ({ name: r.name.value, value: r.value.value })),
    body: bodyInput.value,
  });

  const saveDraft = (): void => {
    writeStorage(wsKey("http.draft"), serializeDraft(currentDraft()));
  };

  const restoreDraft = (): void => {
    const d = parseDraft(readStorage(wsKey("http.draft")));
    methodSel.value = d.method;
    urlInput.value = d.url;
    bodyInput.value = d.body;
    for (const h of d.headers) addHeaderRow(h.name, h.value);
    syncHeadersSummary();
  };

  // ---------- 环境与变量（PR-B4-3） ----------

  let envs: HttpEnvMap = parseEnvs(readStorage("http.envs"));
  let currentEnv: string = readStorage("http.env.current") ?? "dev";

  const varsSummaryText = (): string =>
    t("devtools.http.varsSection", { env: currentEnv, n: String(Object.keys(envVars(envs, currentEnv)).length) });

  const renderEnvOptions = (): void => {
    if (Object.keys(envs).length === 0) envs = { dev: {} };
    const names = Object.keys(envs);
    if (!names.includes(currentEnv)) currentEnv = names[0];
    envSel.textContent = "";
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      envSel.appendChild(opt);
    }
    envSel.value = currentEnv;
    varsInput.value = formatVarLines(envVars(envs, currentEnv));
    varsSummary.textContent = varsSummaryText();
  };

  const saveVars = (): void => {
    const { vars, invalid } = parseVarLines(varsInput.value);
    envs[currentEnv] = vars;
    // §5.6 边界 3：设置里关掉「保存到本机」时，环境变量（可能含 token）只存活本次会话
    const persist = app.settings.http_save_tokens;
    if (persist) writeStorage("http.envs", serializeEnvs(envs));
    varsSummary.textContent = varsSummaryText();
    if (invalid.length > 0) {
      // 非法行（无 `=`）不静默吞掉：存下合法部分并明确指出问题行
      varsHint.textContent = t("devtools.http.varsInvalid", { list: invalid.join(" / ") });
      flashError(varsSaveBtn, t("devtools.http.varsSavedWithWarn"));
    } else {
      varsHint.textContent = persist ? t("devtools.http.varsSavedHint") : t("devtools.http.varsNotSaved");
      flashSuccess(varsSaveBtn, t("devtools.http.varsSaved"));
    }
  };

  envSel.addEventListener("change", () => {
    currentEnv = envSel.value;
    writeStorage("http.env.current", currentEnv);
    varsInput.value = formatVarLines(envVars(envs, currentEnv));
    varsSummary.textContent = varsSummaryText();
    varsHint.textContent = "";
  });

  // ---------- 历史（最近 20 条，不存 body） ----------

  let history: HttpHistoryEntry[] = parseHistory(readStorage(wsKey("http.history")));

  const renderHistory = (): void => {
    historyBody.textContent = "";
    historySummary.textContent = t("devtools.http.historySection", { n: String(history.length) });
    if (history.length === 0) {
      historyBody.appendChild(hint(t("devtools.http.historyEmpty"), "dim"));
      return;
    }
    for (const e of history) {
      const row = document.createElement("div");
      row.className = "http-history-row";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      // 专属类名（不复用 .http-code）：否则「响应状态行的 .http-code」与「历史行的 .http-code」
      // 会让所有响应断言撞上 strict mode violation
      const code = document.createElement("span");
      code.className = `http-history-code http-history-code--${classifyStatus(e.status)}`;
      code.textContent = String(e.status);
      const meth = document.createElement("span");
      meth.className = "http-history-method";
      meth.textContent = e.method;
      const url = document.createElement("span");
      url.className = "http-history-url";
      url.textContent = e.url;
      url.title = e.url;
      row.append(code, meth, url);
      // 回填只带 method + url（历史不存 body，见 §5.1）
      const fill = (): void => {
        methodSel.value = e.method;
        urlInput.value = e.url;
      };
      row.addEventListener("click", fill);
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          fill();
        }
      });
      historyBody.appendChild(row);
    }
  };

  const recordHistory = (res: HttpResponsePayload): void => {
    // 记**替换前**的原始输入（含 {{var}}）：既不泄露 token，回填后又能复用变量
    history = pushHistory(history, {
      method: methodSel.value,
      url: urlInput.value.trim(),
      status: res.status,
      elapsedMs: res.elapsedMs,
      at: Date.now(),
    });
    writeStorage(wsKey("http.history"), serializeHistory(history));
    renderHistory();
  };

  // ---------- curl 粘贴导入（复用 devtools/curl2python 的 parseCurl） ----------

  const curlWarnText = (w: CurlWarn): string =>
    w === "insecure"
      ? t("devtools.http.curlWarnInsecure")
      : w === "headOnly"
        ? t("devtools.http.curlWarnHead")
        : t("devtools.http.curlWarnFormFile");

  let lastImportedCurl = "";

  const tryImportCurl = (): void => {
    const v = urlInput.value.trim();
    if (!looksLikeCurl(v) || v === lastImportedCurl) return;
    const got = curlToDraft(v);
    if (!got) return;
    lastImportedCurl = v;
    methodSel.value = got.draft.method;
    urlInput.value = got.draft.url;
    for (const h of got.draft.headers) addHeaderRow(h.name, h.value);
    if (got.draft.body !== "") {
      bodyInput.value = got.draft.body;
      bodySection.open = true;
    }
    syncHeadersSummary();
    if (got.warnings.length > 0) {
      setState(
        setNotice(state, t("devtools.http.curlWarn", { list: got.warnings.map(curlWarnText).join("、") })),
      );
      flashError(sendBtn, t("devtools.http.curlImportedWarn"));
    } else {
      setState(setNotice(state, null));
      flashSuccess(sendBtn, t("devtools.http.curlImported"));
    }
  };

  urlInput.addEventListener("input", tryImportCurl);

  // ---------- 发送 / 取消 ----------

  const send = (): void => {
    if (state.phase === "sending" || state.phase === "cancelling") return; // 不排队、不并发
    const rawUrl = urlInput.value.trim();
    if (rawUrl === "") {
      setState(setNotice(state, t("devtools.http.needUrl")));
      flashError(sendBtn, t("devtools.http.needUrl"));
      urlInput.focus();
      return;
    }

    // 变量替换（`{{var}}` → 当前环境）；**缺失变量拦下不发送**——把字面量 `{{token}}` 发出去
    // 比报错更糟（服务端会当成真值，排查时看不到原因）
    const vars = envVars(envs, currentEnv);
    const missing = new Set<string>();
    const rUrl = resolveVariables(rawUrl, vars);
    rUrl.missing.forEach((m) => missing.add(m));
    const sentHeaders: [string, string][] = [];
    for (const [k, v] of collectHeaders(headerRows.map((r) => ({ name: r.name.value, value: r.value.value })))) {
      const r = resolveVariables(v, vars);
      r.missing.forEach((m) => missing.add(m));
      sentHeaders.push([k, r.text]);
    }
    const rBody = resolveVariables(bodyInput.value, vars);
    rBody.missing.forEach((m) => missing.add(m));
    if (missing.size > 0) {
      setState(setNotice(state, t("devtools.http.missingVars", { list: [...missing].join("、") })));
      flashError(sendBtn, t("devtools.http.missingVarsFlash"));
      return;
    }

    saveDraft();

    const next = beginSend(state, Date.now());
    currentOpId = `http-${next.opId}-${next.startedAt}`;
    setState(next);
    startTicker();

    const req: HttpRequestPayload = {
      method: methodSel.value,
      url: rUrl.text,
      headers: sentHeaders,
      body: rBody.text === "" ? null : rBody.text,
      // 三项来自设置（设置 → HTTP 请求）；maxRedirects 沿用后端默认上限
      timeoutMs: app.settings.http_timeout_ms,
      followRedirects: app.settings.http_follow_redirects,
      maxRedirects: null,
    };
    const myOp = next.opId;
    const myOpId = currentOpId;

    host.http
      .send(req, myOpId)
      .then((res) => {
        // 令牌不匹配（已重发 / 取消已落定）→ 丢弃。
        // 注意：点「取消」本身**不改变令牌**，所以取消后 3s 内到达的成功回包仍会照常显示
        // ——这是有意的（结果有效，丢掉反而逼用户重发）；超时兜底 `cancelSettled` 才作废令牌。
        if (state.opId !== myOp) return;
        setState(succeed(state, res));
        recordHistory(res);
        flashSuccess(sendBtn, t("devtools.http.done"));
      })
      .catch((e: unknown) => {
        if (state.opId !== myOp) return;
        const raw = errMsg(e);
        if (raw.includes("HttpCancelled")) {
          setState(cancelSettled(state));
          return;
        }
        setState(fail(state, localizeBackendError(raw)));
        flashError(sendBtn, t("devtools.http.sendFailed"));
      });
  };

  const startTicker = (): void => {
    stopTicker();
    ticker = window.setInterval(() => {
      if (state.phase !== "sending") return;
      statusEl.textContent = statusText();
    }, TICK_MS);
  };

  const requestCancel = (): void => {
    if (state.phase !== "sending") return;
    const opId = currentOpId;
    setState(cancelRequested(state));
    void host.http.cancel(opId).catch(() => {
      // 取消失败不阻断：3s 兜底会回落 idle
    });
    if (cancelTimer !== undefined) window.clearTimeout(cancelTimer);
    cancelTimer = window.setTimeout(() => {
      if (state.phase === "cancelling") setState(cancelSettled(state));
    }, CANCEL_GRACE_MS);
  };

  // ---------- 进度事件（令牌比对，§5.7.3） ----------

  const unsubProgress = host.http.onProgress((p) => {
    if (p.opId !== currentOpId) return;
    if (state.phase !== "sending") return;
    statusEl.textContent = `${t("devtools.http.sendingElapsed", {
      time: formatElapsed(state.startedAt === null ? 0 : Date.now() - state.startedAt),
    })} · ${formatProgress(p.received, p.total)}`;
  });

  // ---------- 键盘（§5.7.5） ----------

  const onKeydown = (e: KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      send();
      return;
    }
    // Esc 只在发送中拦截（其余情况放行给 devtools picker 的关闭逻辑）
    if (e.key === "Escape" && state.phase === "sending") {
      e.preventDefault();
      e.stopPropagation();
      requestCancel();
    }
  };
  wrap.addEventListener("keydown", onKeydown);

  sendBtn.addEventListener("click", send);
  cancelBtn.addEventListener("click", requestCancel);

  restoreDraft();

  // 端点视图联动（devtools/index.ts 的 openHttpTool）：注册在线消费者 + 消费挂起值。
  // 两条路都要通——工具已挂载（实例缓存）时走前者，首次挂载走后者。
  const applyPending = (r: PendingRequest): void => {
    urlInput.value = r.url;
    // 方法只在 HTTP_METHODS 内才写入（WS 等端点不适用，避免 select 落到空值）
    if (r.method && (HTTP_METHODS as readonly string[]).includes(r.method)) methodSel.value = r.method;
    if (r.body !== undefined) bodyInput.value = r.body;
  };
  pendingConsumers.add(applyPending);
  if (pendingRequest !== null) {
    applyPending(pendingRequest);
    pendingRequest = null;
  }

  renderEnvOptions();
  renderHistory();
  // 首次使用提示（§5.6 边界 3）：只提示一次，不打断操作
  if (readStorage("http.tipShown") !== "1") {
    writeStorage("http.tipShown", "1");
    state = setNotice(state, t("devtools.http.firstRunTip"));
  }
  render();

  return {
    dispose(): void {
      stopTicker();
      if (cancelTimer !== undefined) window.clearTimeout(cancelTimer);
      unsubProgress();
      pendingConsumers.delete(applyPending);
      // 在途请求必须取消：回包到达时本实例的 DOM 已卸载（§5.6 边界 1）
      if (state.phase === "sending" || state.phase === "cancelling") {
        void host.http.cancel(currentOpId).catch(() => {});
      }
      saveDraft();
      // 令牌作废：即使取消未即时生效，回包也因 opId 不匹配被丢弃
      state = { ...state, opId: state.opId + 1 };
    },
  };
}
