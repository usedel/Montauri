// 启动恢复决策（2026-10-10 两个用户报告 bug 的修复域）：
//   bug 1「关闭所有工作区后重启仍自动恢复」——启动恢复从盲取 recents[0] 改为读
//        <data_root>/config/last-session.json 终态（closeWorkspace 记 open=false）。
//   bug 2「双击关联 md 却打开上次工作区」——启动时读 argv 第一个存在的文件（get_startup_file），
//        走 openSingleFile（探测根 → openWorkspace → 定位文件）。
//   单实例路由（同日下午）：第二实例 argv 按「文件 ∈ 已开工作区」判定——命中聚焦+开文件，
//        未命中开新项目窗口（pending 槽透传初始文件）。
//
// 本模块只做「决策与编排」，动作（openWorkspace / openSingleFile / openFile）经 handlers
// 注入解环（与 openFileEntry.ts 同一套约定，避免 main ⇄ 本模块静态成环）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** 启动恢复的决策依据（Rust fs_cmds::get_last_session 的 TS 形状，camelCase 同名） */
export interface LastSession {
  open: boolean;
  workspace?: string | null;
}

/** main 注入的私有动作 */
export interface StartupRestoreHandlers {
  /** 打开工作区（main::openWorkspace，含 teardown / LSP / watcher / 会话恢复全链路） */
  openWorkspace: (root: string) => Promise<void>;
  /** 已知路径的打开文件（openFileEntry::openSingleFile：探测根 → openWorkspace → 定位文件） */
  openSingleFile: (path: string) => Promise<void>;
  /** 读取最近工作区列表（main::getRecentWorkspaces，无终态文件时的回落通道） */
  getRecentWorkspaces: () => Promise<string[]>;
  /** 打开文件定位（main::openFile——路由命中已开工作区时直接开 tab，不走探测链） */
  openFile: (path: string) => Promise<boolean>;
}

let H: StartupRestoreHandlers | null = null;

export function setStartupRestoreHandlers(h: StartupRestoreHandlers): void {
  H = h;
}

function need(): StartupRestoreHandlers {
  if (!H) throw new Error("[startupRestore] handlers 未注入：请先在 init 里调用 setStartupRestoreHandlers");
  return H;
}

/** 读取上次会话终态；异常时返回 null（沿用旧 recents 恢复语义，向后兼容） */
export async function getLastSession(): Promise<LastSession | null> {
  try {
    return await invoke<LastSession | null>("get_last_session");
  } catch (e) {
    console.warn("读取上次会话终态失败", e);
    return null;
  }
}

/** 记录上次会话终态：openWorkspace 成功后 (true, root)；closeWorkspace 后 (false, null)。 */
export async function setLastSession(open: boolean, workspace: string | null): Promise<void> {
  await invoke("set_last_session", { open, workspace }).catch(console.error);
}

/** 启动时的自动恢复：读 last-session 终态——上次「关闭工作区」后退出则保持欢迎页，
 *  否则恢复记录的工作区（目录已删时 Rust 侧已置 open=false）；
 *  文件不存在（首启 / 旧版本）回落 recents[0]（原行为，向后兼容）。 */
export async function autoOpenRecentWorkspace(): Promise<void> {
  const last = await getLastSession();
  if (last) {
    if (last.open && last.workspace) {
      await need().openWorkspace(last.workspace);
    }
    return; // open=false：用户上次明确关掉了工作区，不再恢复
  }
  const recents = await need().getRecentWorkspaces();
  if (recents.length > 0) {
    await need().openWorkspace(recents[0]);
  }
}

/** 多窗口启动路径优先级：项目窗口（label→path，窗口级信号）> argv 双击文件（进程级信号）
 *  > pending 路由文件（单实例开新窗口时透传）> 「恢复最近」。
 *  argv 排在项目窗口之后是**必须**的：`open_workspace_window` 新开的项目窗口与主窗口
 *  同进程，`get_startup_file` 读的是进程级 argv——若 argv 优先，「在新窗口打开工作区 B」
 *  会被启动时的 md 参数劫持（新窗口错误地打开那个 md）。主窗口 label="main" 不在
 *  WINDOW_PROJECTS 映射里，get_window_project 返回 null 天然落到 argv 分支，不受影响。
 *  pending 不在项目窗口 return 之后而是链式下落：单实例路由开的「新项目窗口」
 *  get_window_project 命中（label 注册表）且 pending 槽有文件——两步都要走。 */
export async function openInitialWorkspace(): Promise<void> {
  const winProject = await invoke<string | null>("get_window_project").catch(() => null);
  if (winProject) {
    await need().openWorkspace(winProject).catch((e) => console.error("打开窗口项目失败", e));
  } else {
    // 双击关联文件冷启动（montauri.exe D:\x\note.md）：优先打开该文件
    //（openSingleFile 内部 find_project_root → openWorkspace → openFile，与欢迎页
    // 「打开文件」按钮同一条链路；mdMode 不带 → 按设置分流 preview/edit）
    const startupFile = await invoke<string | null>("get_startup_file").catch(() => null);
    if (startupFile) {
      await need().openSingleFile(startupFile).catch((e) => console.error("打开启动文件失败", e));
      return;
    }
  }
  // pending 路由文件（单实例路由开新项目窗口时 Rust 侧写入，take 即清防重复打开）。
  // 直接 openFile 定位：探测根已在 Rust 侧算过并作为窗口绑定目录打开（winProject 分支），
  // 文件必然在其中，无需再走 openSingleFile 的探测链（省一轮重复 openWorkspace 全链路）。
  const pending = await invoke<string | null>("take_startup_file").catch(() => null);
  if (pending) {
    await need().openFile(pending).catch((e) => console.error("打开路由文件失败", e));
    return;
  }
  if (!winProject) {
    await autoOpenRecentWorkspace();
  }
}

/** 接线单实例路由事件（main 的 init 调用）：第二实例双击文件命中本窗口工作区时，
 *  Rust 侧 emit("startup-file")。直接 openFile 定位（工作区不变，不走探测+teardown）。
 *  双通道防丢：emit 可能早于本 listen 注册（项目窗口 build→init 有 1-3s 窗口期），
 *  Rust 侧同时写 pending 槽——由 openInitialWorkspace 末尾的 take 补投递；
 *  回调先清槽保证同一次路由只有一条路径生效（openFile 自带 in-flight 去重兜底）。 */
export async function wireStartupFileEvent(): Promise<void> {
  await listen<string>("startup-file", (e) => {
    // 事件已到 = 本次路由走 emit 通道，清掉 Rust 侧的 pending 备份（防 take 通道重复投递）
    void invoke("take_startup_file").catch(() => undefined);
    void need().openFile(e.payload).catch((err) => console.error("打开路由文件失败", err));
  });
}
