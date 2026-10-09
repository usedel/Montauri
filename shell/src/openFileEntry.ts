// 单文件打开入口（docs/open_file_dev_plan.md 批 1）。
//
// 需求：用户想直接打开一个 .py / .md 文件，而 IDE 只能打开目录。方案 = B+C：
// 选文件 → 向上探测最小项目根（find_project_root，分语言标记）→ 打开该工作区 → 定位到文件。
// openFile 本身不校验文件是否在工作区内（doOpenFile 只走 read_file + createModel），
// 本模块只负责「把目录上下文补齐」，openWorkspace 全链路（LSP/运行/调试/git/会话）原样复用。
//
// 解环：openWorkspace / openFile 是 main.ts 私有函数，经 setOpenFileEntryHandlers 注入
// （与 setMenuItemsHandlers / setRunWidgetHandlers 同一套约定），避免 main ⇄ 本模块静态成环。

import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { toast, toastFail } from "./toast";
import { basename } from "./util";

/** main 注入的私有动作（openWorkspace / openFile 在 main.ts）。 */
export interface OpenFileEntryHandlers {
  /** 打开工作区（main::openWorkspace，含 teardown / LSP / watcher / 会话恢复全链路） */
  openWorkspace: (root: string) => Promise<void>;
  /** 打开文件（main::openFile） */
  openFile: (path: string) => Promise<void>;
}

let H: OpenFileEntryHandlers | null = null;

export function setOpenFileEntryHandlers(h: OpenFileEntryHandlers): void {
  H = h;
}

function need(): OpenFileEntryHandlers {
  if (!H) throw new Error("[openFileEntry] handlers 未注入：请先在 init 里调用 setOpenFileEntryHandlers");
  return H;
}

/** 探测结果：项目根 + 是否为回退值（未命中任何标记 = 文件所在目录）。 */
export interface ProjectRootInfo {
  root: string;
  /** true = 探测未命中标记，root 就是文件所在目录（回退语义） */
  fallback: boolean;
}

/** 纯逻辑：探测结果 → 用户提示文案（可单测）。 */
export function openFileHint(info: ProjectRootInfo): string {
  return info.fallback
    ? t("openfile.hint.fallback", { dir: basename(info.root) })
    : t("openfile.hint.project", { dir: basename(info.root) });
}

/**
 * 打开单文件的完整流程（入口：工具栏按钮 / 文件菜单 / 欢迎页 / 命令面板）。
 * 1. pick_file 选文件；2. find_project_root 探测项目根；3. 打开工作区（或复用当前）；
 * 4. openFile 定位到该文件。
 */
export async function openFileFromDisk(): Promise<void> {
  let path: string | null = null;
  try {
    path = await invoke<string | null>("pick_file");
  } catch (e) {
    toastFail(t("openfile.pickFailed"), e);
    return;
  }
  if (!path) return; // 用户取消
  await openSingleFile(path);
}

/** 已知路径的打开流程（拖拽 / 外部调用预留）。 */
export async function openSingleFile(path: string): Promise<void> {
  let info: ProjectRootInfo;
  try {
    // Rust 侧返回 (root, fallback) 元组 → JSON 数组
    const [root, fallback] = await invoke<[string, boolean]>("find_project_root", { filePath: path });
    info = { root, fallback };
  } catch (e) {
    toastFail(t("openfile.probeFailed"), e);
    return;
  }
  try {
    // 探测根 == 当前工作区 → 只开文件，不走 teardown（避免重开动画）
    // samePath 语义（斜杠/大小写归一）由 main 侧 openWorkspace 前置判断承担；
    // 这里直接比较后交给 openWorkspace——相同 root 时 openWorkspace 内部天然跳过 teardown。
    await need().openWorkspace(info.root);
    await need().openFile(path);
    toast(openFileHint(info), "info");
  } catch (e) {
    toastFail(t("openfile.openFailed"), e);
  }
}
