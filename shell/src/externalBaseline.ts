// 外部改动检测的「磁盘内容基线」（docs/fs_watch_dev_plan.md 裁决 ④，2026-11-03 误报修复）。
// 为什么单独成文件：
//   ① externalChange.ts 行数已触顶（ci/budgets.toml），基线是纯状态 + 读写盘包装，不掺判定流程；
//   ② 调用方（saveTab / openFile / reloadFileFromDisk）只需「读盘或写盘 + 记录」，不必 import 判定模块。
//
// 基线语义：每路径「最后一次观察到的磁盘内容」。事件读到 disk == 基线 → 磁盘没有任何内容变化
// （自身保存的回声、杀软/同步盘 touch、元数据写），**不看 dirty** 直接忽略。
// 只比 model 会把「autosave 写盘后 300ms 防抖窗口内继续输入」判成外部改动——默认 autosave 是
// delay 2s，停手 2s 后恢复打字是常态，于是每次自动保存都可能弹「文件已被外部修改」。
// 所以任何**自身写盘**都必须经本模块记录基线，漏记 = 下一次保存回声被当成外部改动。

import { invoke } from "@tauri-apps/api/core";
import type { Tab } from "./state";
import { normalizePath } from "./util";

const knownDiskText = new Map<string, string>();

/** 上一次比较前的基线（仅诊断日志用，随 diskChangedSince 覆盖）。 */
const prevDiskText = new Map<string, string>();

function key(path: string): string {
  return normalizePath(path);
}

/** 读盘 + 记基线（打开文件 / 面板重载用）：调用方拿到内容即可直接用。 */
export async function readFileTracked(path: string): Promise<string> {
  const text = await invoke<string>("read_file", { path });
  knownDiskText.set(key(path), text);
  return text;
}

/** 自身保存写盘：写入后记基线；脏标记只在「缓冲仍等于写入内容」时复位。
 *  invoke 往返期间用户继续输入 → 必须保留脏（否则后续 watcher 事件按 dirty=false
 *  走「自动重载」，会静默吞掉这段新输入）。 */
export async function writeTabToDisk(tab: Tab): Promise<void> {
  const written = tab.model.getValue();
  await invoke("write_file", { path: tab.path, content: written });
  knownDiskText.set(key(tab.path), written);
  if (tab.dirty && tab.model.getValue() === written) tab.dirty = false;
}

/** 重载 / 采纳外部内容后：记基线 + 内容守卫复位 dirty（同 writeTabToDisk 的守卫语义）。
 *  @returns 是否真的复位了脏标记（调用方据此决定要不要重绘 tab 条） */
export function markDiskSynced(tab: Tab, text: string): boolean {
  knownDiskText.set(key(tab.path), text);
  if (!tab.dirty || tab.model.getValue() !== text) return false;
  tab.dirty = false;
  return true;
}

/** 磁盘内容相对基线是否有变化（顺手把基线更新为本次观察值）。
 *  false = 无内容变化（回声），调用方必须直接忽略，不进入 dirty 判定。
 *  基线未初始化时返回 true（首次观察按「有变化」处理，不漏判真外部改动）。 */
export function diskChangedSince(path: string, disk: string): boolean {
  const k = key(path);
  const known = knownDiskText.get(k);
  if (known !== undefined) prevDiskText.set(k, known);
  knownDiskText.set(k, disk); // 观察即更新：同一外部改动的重复广播不反复打扰
  return known !== disk;
}

/** 工作区切换 / 重启时清空（旧工作区基线不得带到新工作区）。 */
export function resetDiskBaseline(): void {
  knownDiskText.clear();
  prevDiskText.clear();
}

/** 冲突判定留痕（复现误报时看这一行：prevLen == diskLen 说明磁盘内容没变过，不该冲突）。 */
export function logExternalConflict(
  path: string,
  modelText: string,
  diskText: string | null,
  dirty: boolean,
): void {
  const k = key(path);
  console.debug("[external-change] 判定为冲突", path, {
    dirty,
    prevLen: prevDiskText.get(k)?.length ?? -1,
    diskLen: diskText?.length ?? -1,
    modelLen: modelText.length,
  });
}
