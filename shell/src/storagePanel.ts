// 存储面板（docs/disk-space-plan.md P1/P2 前端）：
// - 占用可视化（数据根子目录 + trace 逐项 + uv 官方目录）
// - 可再生内容清理（traces / WebView 缓存 / 轮转日志 / uv 缓存）
// - 数据根迁移到其他盘（复制 + setx + 重启生效）
// - 首启数据落位提示（onboarding，只弹一次）

import { invoke } from "@tauri-apps/api/core";
import { $, $btn } from "./state";
import { hideEl, showEl } from "./anim";
import { openAlert, openConfirm } from "./dialog";
import { setBusy } from "./util"; // CR-27：按钮忙碌态收敛到 util

// ---------- 类型（对应 storage_cmds.rs 的 serde 结构） ----------

interface StorageEntry {
  key: string;
  label: string;
  path: string;
  size_bytes: number;
  renewable: string; // "yes" | "partial" | "no"
}
interface TraceEntry {
  hash: string;
  path: string;
  size_bytes: number;
}
interface UvEntry {
  label: string;
  path: string;
  size_bytes: number;
}
interface StorageUsage {
  data_root: string;
  entries: StorageEntry[];
  traces: TraceEntry[];
  uv: UvEntry[];
}
interface FirstRunStatus {
  should_prompt: boolean;
  data_root: string;
  pointer_set: boolean;
  migration_pending: boolean;
}
interface MigrateResult {
  old_root: string;
  new_root: string;
  skipped: string[];
}

// ---------- 域内 DOM ----------

const usageEl = $("storage-usage");
const rootPathEl = $("storage-root-path") as HTMLElement;
const migratePathEl = $("storage-migrate-path") as HTMLInputElement;
const onboardingModalEl = $("storage-onboarding-modal");

// ---------- 按钮忙碌态（CR-27：已收敛到 util.ts 的 setBusy，本域直接 import 使用） ----------

// ---------- 渲染 ----------

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function renewableBadge(r: string): HTMLElement {
  const span = document.createElement("span");
  if (r === "yes") {
    span.className = "storage-badge storage-badge-ok";
    span.textContent = "可再生";
  } else if (r === "partial") {
    span.className = "storage-badge storage-badge-part";
    span.textContent = "部分可再生";
  } else {
    span.className = "storage-badge";
    span.textContent = "不可删";
  }
  return span;
}

function sizeText(n: number): HTMLElement {
  const span = document.createElement("span");
  span.className = "storage-size";
  span.textContent = formatBytes(n);
  return span;
}

/** 构造一行 storage-row（CR-04：全 DOM API + textContent，路径/错误串不再经 innerHTML 插值） */
function storageRow(cls: string, title: string, ...children: Node[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = cls;
  row.title = title; // 属性赋值：含 " < > & 的路径不会逃逸出属性边界
  row.append(...children);
  return row;
}

function labelSpan(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "storage-label";
  span.textContent = text;
  return span;
}

function renderUsage(u: StorageUsage): void {
  rootPathEl.textContent = u.data_root;
  rootPathEl.title = u.data_root;
  usageEl.textContent = "";
  for (const e of u.entries) {
    usageEl.appendChild(
      storageRow("storage-row", e.path, labelSpan(e.label), sizeText(e.size_bytes), renewableBadge(e.renewable)),
    );
    if (e.key === "traces" && u.traces.length > 0) {
      for (const t of u.traces) {
        const del = document.createElement("button");
        del.className = "storage-del";
        del.dataset.trace = t.hash;
        del.textContent = "删除";
        usageEl.appendChild(
          storageRow("storage-row storage-row-sub", t.path, labelSpan(t.hash), sizeText(t.size_bytes), del),
        );
      }
      const allDel = document.createElement("button");
      allDel.className = "storage-del";
      allDel.dataset.trace = "__all__";
      allDel.textContent = "全部清理";
      usageEl.appendChild(
        storageRow("storage-row storage-row-sub", "", labelSpan("（全部 trace）"), allDel),
      );
    }
  }
  if (u.uv.length > 0) {
    const sep = document.createElement("div");
    sep.className = "storage-sep";
    sep.textContent = "uv（用户自有位置，OpenCharm 不代管）";
    usageEl.appendChild(sep);
    for (const v of u.uv) {
      usageEl.appendChild(
        storageRow("storage-row", v.path, labelSpan(v.label), sizeText(v.size_bytes)),
      );
    }
  }
}

export async function loadStorageUsage(): Promise<void> {
  // 递归扫目录（uv 缓存可达数万文件）需要时间，先给行内 loading 占位
  usageEl.textContent = "";
  const row = document.createElement("div");
  row.className = "storage-row";
  const loading = labelSpan("统计中…");
  const icon = document.createElement("i");
  icon.className = "codicon codicon-loading codicon-modifier-spin";
  loading.prepend(icon);
  row.appendChild(loading);
  usageEl.appendChild(row);
  try {
    const u = await invoke<StorageUsage>("storage_usage");
    renderUsage(u);
  } catch (e) {
    usageEl.textContent = "";
    usageEl.appendChild(storageRow("storage-row", "", labelSpan(`占用统计失败：${String(e)}`)));
  }
}

// ---------- 清理动作 ----------

async function cleanTraces(hash: string, btn?: HTMLButtonElement): Promise<void> {
  const all = hash === "__all__";
  const ok = await openConfirm({
    title: all ? "清理全部 trace 库" : "删除该 trace 库",
    message: all
      ? "将删除所有项目的运行时类型采样库（重新运行脚本即可重新采样）。继续？"
      : "将删除该项目的 trace 库（重新运行脚本即可重新采样）。继续？",
    kind: "danger",
    okLabel: all ? "全部清理" : "删除",
  });
  if (!ok) return;
  if (btn) setBusy(btn, true, "清理中…");
  try {
    const freed = await invoke<number>("clean_traces", { hash: all ? null : hash });
    await openAlert({ message: `已释放 ${formatBytes(freed)}。` });
  } catch (e) {
    await openAlert({ title: "清理失败", message: String(e), kind: "danger" });
  } finally {
    if (btn) setBusy(btn, false);
  }
  void loadStorageUsage();
}

async function cleanWebview(btn: HTMLButtonElement): Promise<void> {
  const ok = await openConfirm({
    title: "清理 WebView 缓存",
    message: "将删除 WebView2 的缓存子目录（登录态等文件保留）。继续？",
    kind: "danger",
  });
  if (!ok) return;
  setBusy(btn, true, "清理中…");
  try {
    const freed = await invoke<number>("clean_webview_cache");
    await openAlert({ message: `已释放 ${formatBytes(freed)}。` });
  } catch (e) {
    await openAlert({ title: "清理失败", message: String(e), kind: "danger" });
  } finally {
    setBusy(btn, false);
  }
  void loadStorageUsage();
}

async function cleanLogs(btn: HTMLButtonElement): Promise<void> {
  setBusy(btn, true, "清理中…");
  try {
    const freed = await invoke<number>("clean_log_rotation");
    await openAlert({ message: `已释放 ${formatBytes(freed)}（当前日志文件保留）。` });
  } catch (e) {
    await openAlert({ title: "清理失败", message: String(e), kind: "danger" });
  } finally {
    setBusy(btn, false);
  }
}

async function uvClean(deep: boolean, btn: HTMLButtonElement): Promise<void> {
  const ok = await openConfirm({
    title: deep ? "uv 缓存深度清理" : "uv 缓存清理",
    message: deep
      ? "将删除全部 uv 缓存（已装环境不受影响；之后重装包会重新下载落盘）。继续？"
      : "将清理 uv 缓存中的无效/悬空条目。继续？",
    kind: "danger",
    okLabel: deep ? "深度清理" : "清理",
  });
  if (!ok) return;
  setBusy(btn, true, deep ? "深度清理中…" : "清理中…");
  try {
    const msg = await invoke<string>("uv_cache_clean", { deep });
    await openAlert({ message: msg || "完成。" });
  } catch (e) {
    await openAlert({ title: "清理失败", message: String(e), kind: "danger" });
  } finally {
    setBusy(btn, false);
  }
  void loadStorageUsage();
}

// ---------- 迁移 ----------

async function migrate(btn: HTMLButtonElement): Promise<void> {
  const target = migratePathEl.value.trim();
  if (!target) {
    await openAlert({ title: "请填写目标目录", message: "例如 D:\\opencharm-data" });
    return;
  }
  const ok = await openConfirm({
    title: "迁移数据",
    message:
      `将把当前数据根完整复制到 ${target}，并把数据根指针指向该目录。` +
      `重启后生效，期间请勿关闭应用。继续？`,
    okLabel: "开始迁移",
  });
  if (!ok) return;
  setBusy(btn, true, "迁移中…");
  try {
    const r = await invoke<MigrateResult>("migrate_data_root", { target });
    setBusy(btn, false);
    const skippedNote = r.skipped.length > 0 ? `\n\n有 ${r.skipped.length} 个被占用文件未复制（详见新目录 .migration-skipped.txt）。` : "";
    const go = await openConfirm({
      title: "迁移完成",
      message: `数据已复制到 ${r.new_root}。${skippedNote}\n\n旧目录 ${r.old_root} 不会被自动删除，重启并确认无误后可手工删除。\n\n现在重启应用使新位置生效？`,
      okLabel: "立即重启",
    });
    if (go) await invoke("restart_app");
  } catch (e) {
    await openAlert({ title: "迁移失败", message: String(e), kind: "danger" });
  } finally {
    setBusy(btn, false);
  }
}

// ---------- 首启落位提示（P2-a） ----------

/** 首启检测：shouldPrompt 时弹一次落位提示；迁移中断时给恢复提示。 */
export async function checkFirstRunStorage(): Promise<void> {
  try {
    const st = await invoke<FirstRunStatus>("first_run_status");
    if (st.migration_pending) {
      await openAlert({
        title: "检测到未完成的迁移",
        message: `数据根 ${st.data_root} 存在迁移中断标记。可在「设置 → 存储」重新执行迁移，或删除该目录中的 .migration-in-progress 标记后忽略。`,
      });
    }
    if (!st.should_prompt) return;
    showEl(onboardingModalEl);
  } catch (e) {
    console.warn("首启落位检测失败", e);
  }
}

function wireOnboarding(): void {
  $btn("storage-ob-default").addEventListener("click", () => {
    invoke("ack_first_run")
      .catch((e) => console.warn("写首启标记失败", e))
      .finally(() => hideEl(onboardingModalEl));
  });
  $btn("storage-ob-custom").addEventListener("click", async () => {
    try {
      const dir = await invoke<string | null>("pick_folder");
      if (!dir) return; // 取消选择 → 弹窗保持，用户可再选或用默认
      await invoke("set_data_root", { path: dir });
      hideEl(onboardingModalEl);
      const go = await openConfirm({
        title: "数据位置已设置",
        message: `数据根已指向 ${dir}。重启后生效（首启尚无数据，重启无损失）。现在重启？`,
        okLabel: "立即重启",
      });
      if (go) await invoke("restart_app");
    } catch (e) {
      await openAlert({ title: "设置失败", message: String(e), kind: "danger" });
    }
  });
}

// ---------- 接线 ----------

export function wireStoragePanel(): void {
  wireOnboarding();
  $btn("storage-refresh").addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    setBusy(btn, true, "统计中…");
    void loadStorageUsage().finally(() => setBusy(btn, false));
  });
  $btn("storage-open").addEventListener("click", () => {
    invoke("open_data_dir").catch((e) => console.warn("打开数据目录失败", e));
  });
  usageEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".storage-del");
    if (btn?.dataset.trace) void cleanTraces(btn.dataset.trace, btn);
  });
  $btn("storage-clean-webview").addEventListener("click", (e) =>
    void cleanWebview(e.currentTarget as HTMLButtonElement));
  $btn("storage-clean-logs").addEventListener("click", (e) =>
    void cleanLogs(e.currentTarget as HTMLButtonElement));
  $btn("storage-uv-prune").addEventListener("click", (e) =>
    void uvClean(false, e.currentTarget as HTMLButtonElement));
  $btn("storage-uv-clean").addEventListener("click", (e) =>
    void uvClean(true, e.currentTarget as HTMLButtonElement));
  $btn("storage-migrate-browse").addEventListener("click", async () => {
    try {
      const dir = await invoke<string | null>("pick_folder");
      if (dir) migratePathEl.value = dir;
    } catch (e) {
      console.warn("选择目录失败", e);
    }
  });
  $btn("storage-migrate").addEventListener("click", (e) =>
    void migrate(e.currentTarget as HTMLButtonElement));
}
