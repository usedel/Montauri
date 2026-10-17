// 外部改动检测（External Change）：消费 watcher 的文件级事件 `fs-file-changed`
// （docs/fs_watch_dev_plan.md v0.1 执行真源，§4.1 数据流 / §4.3 判定 / §4.7 dirty 陷阱）。
//
// 要解决的问题：磁盘上的文件被**别的程序**改掉（git checkout / 外部编辑器 / 代码生成器）时，
// 本 IDE 里已打开的 tab 既不重载也不提示，用户 Ctrl+S 会**静默覆盖外部改动**，且会话快照的
// draft 也随之被覆盖 → 改动不可恢复。
//
// 三条核心裁决（推导见计划文档，动代码前必读）：
// ① **内容比对代替事件类型**：notify-debouncer-mini 不给 create/modify/remove，但读盘比对
//    model 内容可推出全部必要语义，且天然吞掉「自身保存的回声」（保存后磁盘 == model → no-op）。
//    因此不换 notify-debouncer-full（零新增依赖）。
// ② **读盘失败只提示不动作**：命令面无 path_exists/metadata，读盘失败混着「真删除 /
//    10MB 守卫 / 网络盘 IO 错误」，判 removed 会误关 tab。
// ③ **dirty 复位必须内容守卫**：置脏是统一集中点（main.ts 的 onDidChangeContent 对任何
//    setValue 生效），裸 setValue 会让 tab 假脏并把整文件内容存进会话 draft。

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openChoice, type ChoiceResult } from "./dialog";
import { t } from "./i18n";
import { app, type Tab } from "./state";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { basename, codicon, normalizePath } from "./util";
import { toast } from "./toast";

// ---------- 纯逻辑（零依赖，单测直接 import） ----------

/** 外部改动判定结果（plan §4.3） */
export type ExternalKind = "identical" | "reload" | "conflict" | "unreadable";

export interface ClassifyInput {
  /** model 当前内容 */
  modelText: string;
  /** 磁盘内容；null = 读盘失败（§4.3：不细分原因） */
  diskText: string | null;
  /** tab 是否有未保存修改 */
  dirty: boolean;
}

/** 判定一次磁盘变更对本 tab 的意义。
 *  - identical：磁盘与缓冲一致（= 自身保存的回声，或用户 Undo 回原状）→ 无动作
 *  - reload：缓冲干净 → 磁盘是唯一真源，自动重载
 *  - conflict：缓冲有未存修改 → 交用户裁决
 *  - unreadable：读盘失败 → 只提示，绝不自动关 tab */
export function classifyExternalChange(input: ClassifyInput): ExternalKind {
  if (input.diskText === null) return "unreadable";
  if (input.diskText === input.modelText) return "identical";
  return input.dirty ? "conflict" : "reload";
}

/** 是否参与外部改动判定：只有**普通文件 tab**参与。
 *  md 预览 / CSV 查看（只读，kind=md/csv）、git diff（kind=diff）、数据库视图（kind=db）
 *  的 model 都是占位模型，内容比对无意义（plan §4.8）。 */
export function isTrackableTab(tab: Tab): boolean {
  const k = tab.kind;
  return k === undefined || k === "file";
}

/** 单飞判定：同路径 minGapMs 内只处理一次（git checkout 批量改动的风暴抑制，plan §4.3）。 */
export function shouldHandleNow(lastAt: number | null, now: number, minGapMs = 800): boolean {
  if (lastAt === null) return true;
  return now - lastAt >= minGapMs;
}

/** 把磁盘内容写进 model，并在**内容守卫成立**时复位 dirty（plan §4.7）。
 *  - "applied"：写入成功且写入后内容与期望一致 → 调用方可置 dirty=false
 *  - "changed"：写入后内容被并发修改偏离期望 → 调用方必须**保留**脏标记
 *  注：单线程 JS 内 setValue 后不可能被插值，这里的守卫真正防的是「读盘 await 期间用户
 *  敲了字」——那种情况由调用方在 await 前后比对，不走到本函数。 */
export function applyExternalText(
  model: MonacoApi.editor.ITextModel,
  diskText: string,
): "applied" | "changed" {
  model.setValue(diskText);
  return model.getValue() === diskText ? "applied" : "changed";
}

/** 另存为的默认文件名：原名 + ` (我的版本)` 后缀——避免用户在同一目录直接确认时
 *  覆盖我们正要救回来的那个文件。 */
export function saveAsDefaultName(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (我的版本)${name.slice(dot)}` : `${name} (我的版本)`;
}

// ---------- 接线（依赖 main 注入的动作，模块不反向 import main） ----------

export interface ExternalChangeActions {
  /** 用我的缓冲覆盖磁盘（保存动作必须关闭，否则 ruff 会重排外部内容，plan §7.1 用例 7） */
  overwriteDisk(tab: Tab): Promise<void>;
  /** 重绘 tab 条（dirty 复位 / 装饰变化后调用） */
  refreshTabs(): void;
  /** 文件级事件的旁路通知（main 的无 py 工作区后补启动引擎用；可选） */
  onFilesChanged?(filePaths: readonly string[]): void;
}

let actions: ExternalChangeActions | null = null;

export function setExternalChangeActions(a: ExternalChangeActions): void {
  actions = a;
}

/** 冲突未决路径（归一化后）。内存态、不落盘；每次装饰同步顺带剪掉已无 tab 的条目
 *  （plan §4.8：tab 关闭 / 工作区切换都不会留下幽灵 pending）。 */
const pendingExternal = new Set<string>();

/** 单飞窗口里每个路径的上次处理时刻（plan §4.3）。 */
const lastHandledAt = new Map<string, number>();

const SINGLE_FLIGHT_MS = 800;

/** 我们正在代替用户写盘（面板「用我的版本覆盖磁盘」→ saveTab）：
 *  此时 externalSaveGate 必须放行，否则 saveTab 递归再弹一次面板。 */
let savingByUs = false;

function tabKey(path: string): string {
  return normalizePath(path);
}

/** 按归一化路径找参与判定的普通文件 tab。 */
function findTrackedTab(path: string): Tab | null {
  return app.tabs.find((tb) => isTrackableTab(tb) && normalizePath(tb.path) === tabKey(path)) ?? null;
}

function refreshTabsSafe(): void {
  actions?.refreshTabs();
  syncTabDecorations();
}

/** tab 装饰同步：renderTabs 每次全量重建 DOM，故在每次刷新后按 pending 集合补标记。
 *  标记元素用 codicon("warning")（照 tab-running 先例：codicon 字体来自 Monaco，
 *  CSS 里手写 glyph 无效）。顺带剪枝：pending 里已无对应 tab 的路径直接清掉
 *  （plan §4.8：关 tab / 换工作区都不该留下幽灵 pending）。 */
function syncTabDecorations(): void {
  if (typeof document === "undefined") return; // node 环境单测：无 DOM 直接跳过
  const bar = document.getElementById("tabbar");
  if (!bar) return;
  const live = new Set(app.tabs.map((tb) => normalizePath(tb.path)));
  for (const key of [...pendingExternal]) {
    if (!live.has(key)) pendingExternal.delete(key);
  }
  for (const el of bar.querySelectorAll<HTMLElement>(".tab")) {
    const on = pendingExternal.has(normalizePath(el.dataset.path ?? ""));
    el.classList.toggle("tab-external", on);
    const existing = el.querySelector<HTMLElement>(".tab-external-flag");
    if (on && !existing) {
      // ⚠ 必须 classList.add 而不是重写 className：codicon() 返回的类名
      // 「codicon codicon-warning」是 glyph 渲染的唯一来源，重写会把图标删掉
      // （DOM 还在、视觉是空的——e2e 只数元素个数抓不到这种崩）。
      const flag = codicon("warning");
      flag.classList.add("tab-external-flag");
      el.appendChild(flag);
    } else if (!on && existing) {
      existing.remove();
    }
  }
}

/** 工作区切换/重启后的状态复位（main 的 openWorkspace 调一次）：旧工作区的 pending 不得
 *  带到新工作区（同路径文件会被误判成「有未决冲突」而在保存时弹面板）。 */
export function resetExternalChangeState(): void {
  pendingExternal.clear();
  lastHandledAt.clear();
  syncTabDecorations();
}

async function readDisk(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_file", { path });
  } catch {
    return null; // §4.3：不细分删除 / 10MB 守卫 / IO 错误
  }
}

/** 把磁盘内容落进 model（plan §4.3/§4.7 的统一落地路径）。
 *  - `prefetched`：调用方已经读到的磁盘内容（读一次就够，别为一次重载打两次 IPC）；
 *    省略时自行读盘（面板「用磁盘版本重载」路径，距读盘已过了一段时间，必须重读）。
 *  - 全程内容守卫：`snapshot` 是调用方在读盘前取到的缓冲快照，任何时候缓冲偏离它都作废
 *    （用户在我们等 IPC 的期间敲了字——单线程 JS 里这是唯一的真实竞态）。 */
async function applyFromDisk(tab: Tab, snapshot: string, prefetched?: string): Promise<boolean> {
  if (tab.model.getValue() !== snapshot) return false; // 期间被改过 → 本轮作废
  const disk = prefetched ?? (await readDisk(tab.path));
  if (disk === null) {
    toast(t("watch.unreadable", { name: basename(tab.path) }), "error");
    return false;
  }
  if (tab.model.getValue() !== snapshot) return false;
  if (disk === tab.model.getValue()) {
    // 用户已自行改回与磁盘一致：identical 语义，顺手清脏（plan §7.1 用例 8 的另一半）
    if (tab.dirty) {
      tab.dirty = false;
      refreshTabsSafe();
    }
    pendingExternal.delete(tabKey(tab.path));
    syncTabDecorations();
    return true;
  }
  if (applyExternalText(tab.model, disk) === "changed") return false;
  tab.dirty = false;
  pendingExternal.delete(tabKey(tab.path));
  refreshTabsSafe();
  return true;
}

/** 冲突面板（plan §4.5 / §4.6）。mode=save 时语义切换为「保存前的拦截」。 */
async function showConflictPanel(tab: Tab, mode: "watch" | "save", snapshot: string): Promise<boolean> {
  const name = basename(tab.path);
  const res: ChoiceResult = await openChoice({
    title: t("watch.conflict.title"),
    message: t("watch.conflict.message", { name }),
    okLabel: mode === "watch" ? t("watch.conflict.saveAs") : t("watch.conflict.overwrite"),
    neutralLabel: t("watch.conflict.reload"),
    cancelLabel: mode === "watch" ? t("watch.conflict.later") : t("watch.conflict.cancelSave"),
    kind: mode === "save" ? "danger" : "primary",
  });
  if (res === "cancel") return true; // 安全出口：什么都不做（稍后处理 / 取消保存）
  if (res === "neutral") {
    // 用磁盘版本重载——同样要过 §4.4 的重校验（面板开着的时候用户可能又改了）
    await applyFromDisk(tab, snapshot);
    return true;
  }
  if (mode === "watch") {
    await saveAsCopy(tab);
    return true;
  }
  await runOverwriteDisk(tab);
  return true;
}

/** 另存为…（plan §4.5 ok 档）：保住我的改动，无破坏性。
 *  与源同路径时拒绝（防用户在同一目录误确认覆盖回原文件）。 */
async function saveAsCopy(tab: Tab): Promise<void> {
  const target = await saveDialog({ defaultPath: saveAsDefaultName(tab.path) });
  if (!target) return; // 用户取消
  if (tabKey(target) === tabKey(tab.path)) {
    toast(t("watch.saveAsSamePath"), "error");
    return;
  }
  try {
    await invoke("write_file", { path: target, content: tab.model.getValue() });
    toast(t("watch.saved", { name: basename(target) }), "success");
  } catch (e) {
    toast(t("watch.saveAsFailed"), "error");
  }
}

/** 用我的版本覆盖磁盘（面板 ok 档 / 保存拦截 ok 档）。写盘动作一律关闭。 */
async function runOverwriteDisk(tab: Tab): Promise<void> {
  if (!actions) return;
  savingByUs = true;
  try {
    await actions.overwriteDisk(tab);
  } finally {
    savingByUs = false;
  }
  pendingExternal.delete(tabKey(tab.path));
  syncTabDecorations();
}

/** 处理一条文件级事件（plan §4.1）。导出供单测直接驱动。
 *  `deferConflict`：批量模式下把冲突「收集」而不是就地弹面板（见 handleFilesChanged）。 */
export async function handleFileChanged(
  path: string,
  deferConflict?: (tab: Tab, snapshot: string) => void,
): Promise<void> {
  const tab = findTrackedTab(path);
  if (!tab) {
    // 性能闸门（§4.8）+ 顺手剪枝：该路径没有对应 tab，单飞表条目永不再被读到，
    // 大仓里事件很多，不剪会让 lastHandledAt 无限增长。
    lastHandledAt.delete(tabKey(path));
    return;
  }
  const now = Date.now();
  if (!shouldHandleNow(lastHandledAt.get(tabKey(path)) ?? null, now, SINGLE_FLIGHT_MS)) return;
  lastHandledAt.set(tabKey(path), now);

  const before = tab.model.getValue();
  const disk = await readDisk(tab.path);
  if (tab.model.getValue() !== before) return; // 读盘期间缓冲变了 → 本轮作废（§4.4）

  const kind = classifyExternalChange({ modelText: before, diskText: disk, dirty: tab.dirty });
  if (kind === "unreadable") {
    pendingExternal.add(tabKey(tab.path));
    toast(t("watch.unreadable", { name: basename(tab.path) }), "error");
    refreshTabsSafe();
    return;
  }
  if (kind === "identical") {
    if (tab.dirty) {
      tab.dirty = false; // Undo 回原状 / 自动保存回声：清掉常驻圆点（§4.7 后果 2）
      refreshTabsSafe();
    }
    pendingExternal.delete(tabKey(tab.path));
    syncTabDecorations();
    return;
  }
  if (kind === "reload" && disk !== null) {
    // 自动重载：用户没在改，磁盘是唯一真源。复用刚读到的内容（不二次 IPC）。
    await applyFromDisk(tab, before, disk);
    return;
  }
  pendingExternal.add(tabKey(tab.path));
  refreshTabsSafe();
  // 冲突一律先标记。批量模式下交给批次末尾的合并面板；单文件时就地裁决（保持原 UX）
  if (deferConflict) {
    deferConflict(tab, before);
    return;
  }
  await showConflictPanel(tab, "watch", before);
}

/** 一批事件（watcher 的 fs-file-changed 载荷）→ 串行处理，防读盘并发风暴。
 *  旁路通知先走：它不读盘、与下面的判定无因果，让消费者尽早拿到文件级路径。
 *
 *  冲突合并（tech-debt TD-029⑤）：git checkout / 切分支会一次改掉多个已打开文件，
 *  逐个弹面板等于让用户连点 N 次。这里把**整批**先过一遍——identical / reload /
 *  unreadable 都静默处理完（本来也不用问），冲突集中到批次末尾：
 *  1 个 → 原单文件三选一；>1 个 → 一次批量询问，用户可选「逐个处理 / 全部重载 / 稍后」。 */
export async function handleFilesChanged(paths: readonly string[]): Promise<void> {
  actions?.onFilesChanged?.(paths);
  const conflicts: Array<{ tab: Tab; snapshot: string }> = [];
  for (const p of paths) {
    await handleFileChanged(p, (tab, snapshot) => {
      if (!conflicts.some((c) => c.tab === tab)) conflicts.push({ tab, snapshot });
    });
  }
  if (conflicts.length === 1) {
    await showConflictPanel(conflicts[0].tab, "watch", conflicts[0].snapshot);
  } else if (conflicts.length > 1) {
    await showBatchPanel(conflicts);
  }
}

/** 多文件冲突的合并面板（TD-029⑤）。三档语义与单文件同构：
 *  ok = 逐个处理（保住用户每一份未存改动，退回原单文件三选一）
 *  neutral = 全部用磁盘版本重载（明确知情下丢弃全部未存改动）
 *  cancel / Esc / 遮罩 = 稍后处理（全部留在 pending，Ctrl+S 时再逐个裁决） */
async function showBatchPanel(items: Array<{ tab: Tab; snapshot: string }>): Promise<void> {
  const res: ChoiceResult = await openChoice({
    title: t("watch.batch.title"),
    message: t("watch.batch.message", { count: items.length }),
    okLabel: t("watch.batch.oneByOne"),
    neutralLabel: t("watch.batch.reloadAll"),
    cancelLabel: t("watch.batch.later"),
    kind: "primary", // ok 是「保住改动」那一档，危险按钮不给它
  });
  if (res === "cancel") return;
  if (res === "ok") {
    for (const it of items) await showConflictPanel(it.tab, "watch", it.snapshot);
    return;
  }
  for (const it of items) await applyFromDisk(it.tab, it.snapshot);
}

/** 保存拦截（plan §4.6）：main 的 saveTab 在最前面调它。
 *  返回 true = **放弃本次写盘**（已由本模块处理完：覆盖 / 重载 / 用户取消）。 */
export async function externalSaveGate(tab: Tab): Promise<boolean> {
  if (savingByUs) return false;
  if (!isTrackableTab(tab)) return false;
  if (!pendingExternal.has(tabKey(tab.path))) return false;
  return showConflictPanel(tab, "save", tab.model.getValue());
}

/** 接线 watcher 的文件级事件（main 的 init 调一次；应用生命周期内常驻，同 wireDepHealthEvents） */
export async function wireExternalChange(): Promise<void> {
  await getCurrentWindow().listen<string[]>("fs-file-changed", (e) => {
    void handleFilesChanged(e.payload ?? []);
  });
}
