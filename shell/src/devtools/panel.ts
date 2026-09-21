// 开发工具面板（右侧辅助面板，非模态）：与编辑器同时可见、可交互。
// PR-1（plugin_system_design §9.9 / §9.13）：
// - Tab 平铺 → 工具选择器（picker）：header 只显示当前工具，点击弹搜索式 picker（分组 + 最近使用）；
// - 切换即销毁 → 实例缓存（LRU ≤5）：切换 hide/show 保住输入状态，仅面板关闭时统一 dispose。
//
// 面板展开/收起只操作 #right-panel 的 .hidden，不遮挡编辑器，
// 「插入编辑器」「复制」等动作可在编辑器保持光标/选区的前提下进行。

import { $, $btn, lazyEl } from "../state";
import { codicon } from "../util";
import { fuzzyScore } from "../quickOpen"; // 复用 Search Everywhere 的模糊匹配
import { getDevTool, listDevTools, onRegistryChanged } from "./registry";
import { groupToolsByCategory, type DevTool, type ToolHost, type ToolInstance } from "./types";

// CR-26：模块顶层禁止立即解析 DOM（测试环境 happy-dom 无完整 DOM，import 即炸）——一律 lazyEl
const panelEl = lazyEl("right-panel");
const bodyEl = lazyEl("devtools-body");
const headerEl = lazyEl("devtools-header");
const pickerEl = lazyEl("devtools-picker");

/** 实例缓存上限：超出按 LRU dispose 最久未使用（Monaco 实例内存不可忽视） */
const CACHE_MAX = 5;

/** recent 持久化键（tool id 数组，最近在前） */
const RECENT_KEY = "opencharm.devtools.recent";

interface CacheEntry {
  instance: ToolInstance | null;
  rootEl: HTMLElement;
}

const cache = new Map<string, CacheEntry>(); // 插入序即使用序（Map 保序，LRU=重新 set）
let host: ToolHost | null = null;
let activeToolId: string | null = null;
/** 注册表变更期间的「最后激活」记忆：unregister→register 两轮通知间 activeToolId 会被清空，
 *  凭此在第二轮通知重挂热重载后的新定义（用户无感恢复） */
let lastActiveId: string | null = null;

// ---------- recent ----------

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, 5)));
  } catch {
    /* 存储不可用时静默降级（无痕窗口等） */
  }
}

/** 记录使用并去重置顶（同时过滤已注销的 id，防热重载/停用后的僵尸条目） */
function pushRecent(id: string): void {
  const valid = new Set(listDevTools().map((t) => t.id));
  const next = [id, ...loadRecent().filter((x) => x !== id && valid.has(x))].slice(0, 5);
  saveRecent(next);
}

// ---------- header ----------

/** 渲染 header 当前工具区（图标 + 标题 + ▾） */
function renderHeaderCurrent(): void {
  const current = $("devtools-current");
  current.textContent = "";
  const tool = activeToolId ? getDevTool(activeToolId) : null;
  if (!tool) {
    current.append("开发工具");
  } else {
    current.appendChild(codicon(tool.icon));
    const label = document.createElement("span");
    label.textContent = tool.title;
    current.appendChild(label);
  }
  current.appendChild(codicon("chevron-down"));
}

// ---------- picker ----------

/** 渲染 picker 列表（搜索过滤 + 分组 + 最近使用置顶） */
function renderPickerList(query: string): void {
  const listEl = $("devtools-picker-list");
  listEl.textContent = "";
  const q = query.trim();

  // 过滤：fuzzyScore 匹配 title + description + category；query 空 → 全量
  const tools = listDevTools();
  const matched = q
    ? tools.filter((t) => {
        const hay = `${t.title} ${t.description} ${t.category}`;
        return fuzzyScore(hay, q) !== null;
      })
    : tools;

  if (matched.length === 0) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "无匹配工具";
    listEl.appendChild(empty);
    return;
  }

  const addGroup = (title: string, items: DevTool[]): void => {
    if (items.length === 0) return;
    const head = document.createElement("div");
    head.className = "picker-group-head";
    head.textContent = title;
    listEl.appendChild(head);
    for (const t of items) {
      listEl.appendChild(renderPickerItem(t));
    }
  };

  if (!q) {
    // 最近使用组（跨 category 去重；loadRecent 已过滤僵尸 id，这里再按当前注册表校验）
    const byId = new Map(tools.map((t) => [t.id, t]));
    const recent = loadRecent()
      .map((id) => byId.get(id))
      .filter((t): t is DevTool => !!t);
    if (recent.length > 0) addGroup("最近使用", recent);
    for (const [cat, items] of groupToolsByCategory(matched)) addGroup(cat, items);
  } else {
    // 搜索态：不分组，保持匹配原序（插入序）
    for (const t of matched) listEl.appendChild(renderPickerItem(t));
  }
}

function renderPickerItem(tool: DevTool): HTMLElement {
  const item = document.createElement("div");
  item.className = "picker-item";
  item.setAttribute("role", "option");
  item.tabIndex = -1;
  item.appendChild(codicon(tool.icon));
  const main = document.createElement("div");
  main.className = "picker-item-main";
  const title = document.createElement("span");
  title.className = "picker-item-title";
  title.textContent = tool.title;
  const desc = document.createElement("span");
  desc.className = "picker-item-desc";
  desc.textContent = tool.description;
  main.append(title, desc);
  item.appendChild(main);
  const cat = document.createElement("span");
  cat.className = "picker-item-cat";
  cat.textContent = tool.category?.trim() || "其他";
  item.appendChild(cat);
  item.addEventListener("click", () => {
    hidePicker();
    openDevTools(tool.id);
  });
  return item;
}

/** 打开 picker：重渲染列表 + 聚焦搜索框 */
function showPicker(): void {
  const search = $("devtools-picker-search") as HTMLInputElement;
  search.value = "";
  renderPickerList("");
  pickerEl.classList.remove("hidden");
  search.focus();
}

function hidePicker(): void {
  pickerEl.classList.add("hidden");
}

function isPickerOpen(): boolean {
  return !pickerEl.classList.contains("hidden");
}

// ---------- 激活与缓存 ----------

/** 激活指定工具：缓存命中 → show；未命中 → mount 并入缓存（LRU 超限逐出） */
function activateTool(id: string): void {
  if (!host) return;
  const tool = getDevTool(id);
  if (!tool) return;
  if (activeToolId !== id) {
    let entry = cache.get(id);
    if (!entry) {
      // 每工具独立 rootEl + 独立 host 视图（root 指向该 rootEl）——
      // 工具 mount 里 host.root.textContent = "" 只会清自己的容器，
      // 不再误清 #devtools-body 里其他工具的缓存 rootEl（PR-4 E2E 揭露的共享 host 缺陷）
      const rootEl = document.createElement("div");
      rootEl.className = "devtools-tool-root";
      bodyEl.appendChild(rootEl);
      const toolHost: ToolHost = { ...host, root: rootEl };
      let instance: ToolInstance | null = null;
      try {
        instance = tool.mount(toolHost) ?? null;
      } catch (e) {
        // §9.15：mount 失败 → 错误卡片（信息 + 重试 + 停用该插件），不连累 picker 与其他工具
        console.warn(`[devtools] 工具 ${id} 挂载失败`, e);
        rootEl.textContent = "";
        rootEl.appendChild(renderMountErrorCard(id, e));
      }
      entry = { instance, rootEl };
      cache.set(id, entry);
      evictIfNeeded();
    } else {
      cache.delete(id);
      cache.set(id, entry); // LRU：命中即移到末尾（最新）
    }
    activeToolId = id;
    syncToolRoots();
    renderHeaderCurrent();
    pushRecent(id);
  }
}

/** mount 失败的错误卡片：错误信息 + 重试（清缓存重挂） */
function renderMountErrorCard(toolId: string, err: unknown): HTMLElement {
  const card = document.createElement("div");
  card.className = "tool-error-card";
  const title = document.createElement("div");
  title.className = "tool-error-title";
  title.textContent = "工具加载失败";
  const msg = document.createElement("div");
  msg.className = "tool-error-msg";
  msg.textContent = err instanceof Error ? err.message : String(err);
  const retry = document.createElement("button");
  retry.className = "btn btn--sm";
  retry.textContent = "重试";
  retry.addEventListener("click", () => {
    // 清该工具缓存后重新激活（走完整 mount 路径）
    const entry = cache.get(toolId);
    if (entry) {
      try {
        entry.instance?.dispose();
      } catch {
        /* dispose 失败不阻塞重试 */
      }
      entry.rootEl.remove();
      cache.delete(toolId);
    }
    if (activeToolId === toolId) activeToolId = null;
    activateTool(toolId);
  });
  card.append(title, msg, retry);
  return card;
}

/** LRU 逐出：超出上限时 dispose 并移除最旧（Map 首项）缓存项 */
function evictIfNeeded(): void {
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const entry = cache.get(oldest);
    if (entry) {
      try {
        entry.instance?.dispose();
      } catch (e) {
        console.warn(`[devtools] 工具 ${oldest} dispose 异常（忽略）`, e);
      }
      entry.rootEl.remove();
    }
    cache.delete(oldest);
    if (activeToolId === oldest) activeToolId = null; // 被逐出的不应是激活项（激活项刚 set 到末尾），防御兜底
  }
}

/** 按激活态同步各 rootEl 显隐 */
function syncToolRoots(): void {
  for (const [id, entry] of cache) {
    entry.rootEl.classList.toggle("hidden", id !== activeToolId);
  }
}

// ---------- 面板开关 ----------

/** PR-1 快捷键入口（Ctrl+Shift+T）：面板收起 → 展开并聚焦 picker；已展开 → 直接收起（toggle 语义） */
export function openDevToolsPanel(): void {
  if (!panelEl.classList.contains("hidden")) {
    closeDevTools();
    return;
  }
  openDevTools();
  // 面板展开后弹出 picker，让键盘流直接选工具（焦点进搜索框）
  const search = $("devtools-picker-search") as HTMLInputElement;
  search.value = "";
  renderPickerList("");
  pickerEl.classList.remove("hidden");
  search.focus();
}

/** 展开右侧面板并激活工具（未指定则取 recent 首个或第一个）；面板展开后不抢编辑器焦点 */
export function openDevTools(toolId?: string): void {
  const tools = listDevTools();
  if (tools.length === 0 || !host) return;
  let target = toolId && getDevTool(toolId) ? toolId : undefined;
  if (!target) {
    const byId = new Map(tools.map((t) => [t.id, t]));
    target = loadRecent().find((id) => byId.has(id)) ?? tools[0].id;
  }
  hidePicker();
  activateTool(target);
  panelEl.classList.remove("hidden");
}

/** 全清实例缓存（面板关闭 / 注册表变更共用）；dispose 异常吞掉不阻塞 */
function disposeAllCached(): void {
  for (const [, entry] of cache) {
    try {
      entry.instance?.dispose();
    } catch (e) {
      console.warn("[devtools] dispose 异常（忽略）", e);
    }
  }
  cache.clear();
  bodyEl.textContent = "";
  activeToolId = null;
}

/** 收起右侧面板并释放全部工具实例 */
export function closeDevTools(): void {
  hidePicker();
  disposeAllCached();
  renderHeaderCurrent();
  panelEl.classList.add("hidden");
}

// ---------- 初始化 ----------

/** 初始化面板（注入 host 并接线 picker / 关闭按钮），须在 registerDevTool 之后调用 */
export function initDevToolsPanel(h: ToolHost): void {
  host = h;
  renderHeaderCurrent();

  // 注册表变更（插件热重载/启停/重注册）：全清实例缓存。
  // 语义：热重载会 unregister→register 同 id，仅按「id 不存在」清理会漏掉「同 id 新定义」——
  // 旧实例闭包引用旧模块，不重建就永远跑旧代码。插件变更是低频事件，全清代价可接受；
  // 激活工具若仍存在则立即以新定义重挂（用户无感）。
  // lastActiveId 独立于缓存清理持久：unregister/register 两次通知间 activeToolId 已被
  // 第一轮清空（E2E 06 揭露），须凭记忆在第二轮重挂。
  onRegistryChanged(() => {
    if (activeToolId) lastActiveId = activeToolId;
    const restoreId = lastActiveId && getDevTool(lastActiveId) ? lastActiveId : null;
    disposeAllCached();
    if (restoreId) {
      lastActiveId = null; // 防陈旧恢复（下一轮重新记忆）
      activateTool(restoreId);
    }
    renderHeaderCurrent();
  });

  // 当前工具区 = picker 触发器（UI-16：aria-expanded 与 .open 类同源切换）
  const current = $("devtools-current");
  current.setAttribute("role", "button");
  current.setAttribute("aria-haspopup", "listbox");
  current.tabIndex = 0;
  current.addEventListener("click", () => (isPickerOpen() ? hidePicker() : showPicker()));
  current.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      isPickerOpen() ? hidePicker() : showPicker();
    }
  });

  // 搜索框：输入即过滤
  const search = $("devtools-picker-search") as HTMLInputElement;
  search.addEventListener("input", () => renderPickerList(search.value));
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hidePicker();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // ↑↓ 漫游列表项（焦点模型同 quickOpen：焦点恒在搜索框，只移动高亮）
      e.preventDefault();
      movePickerFocus(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      // 未漫游（无 .active 高亮）时默认激活第一项——纯键盘流「输入即 Enter」直达
      const item =
        pickerEl.querySelector<HTMLElement>(".picker-item.active") ??
        pickerEl.querySelector<HTMLElement>(".picker-item");
      if (item) item.click();
    }
  });

  // 点击 picker 外（面板 body 区）关闭
  headerEl.addEventListener("click", (e) => {
    if (isPickerOpen() && !pickerEl.contains(e.target as Node) && !current.contains(e.target as Node)) {
      hidePicker();
    }
  });
  bodyEl.addEventListener("click", () => {
    if (isPickerOpen()) hidePicker();
  });

  $btn("devtools-close").addEventListener("click", closeDevTools);
}

/** ↑↓ 在 picker 项间移动高亮（跳过组头/空态） */
function movePickerFocus(dir: 1 | -1): void {
  const items = [...pickerEl.querySelectorAll<HTMLElement>(".picker-item")];
  if (items.length === 0) return;
  const cur = items.findIndex((i) => i.classList.contains("active"));
  const next = cur < 0 ? (dir === 1 ? 0 : items.length - 1) : (cur + dir + items.length) % items.length;
  items.forEach((i, idx) => i.classList.toggle("active", idx === next));
  items[next].scrollIntoView({ block: "nearest" });
}
