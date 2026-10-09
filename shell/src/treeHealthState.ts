// 文件树健康度状态（CR-25 同款零依赖状态层）：path（归一）→ error/warning。
// 数据源 = problemsPanel 的防抖刷新（collectProblems 汇总 marker）；消费方 = fileTree
// 的错误/警告文件着色。独立模块切断 fileTree ↔ problemsPanel 依赖（二者互不 import）。
//
// 语义对齐 VSCode：只有打开过（被诊断过）的文件才有色；关 tab → marker 随 model
// dispose → 下次刷新该 path 不在 map 中 → 颜色自然消失。

import { normalizePath } from "./util";

export type TreeHealth = "error" | "warning";

/** path（normalizePath 归一）→ 健康度（error 优先于 warning） */
const fileHealth = new Map<string, TreeHealth>();

/** 全量替换（problemsPanel 每轮防抖刷新时调用；传 null 表示清空——工作区切换） */
export function setTreeFileHealth(entries: [path: string, health: TreeHealth][]): void {
  fileHealth.clear();
  for (const [p, h] of entries) fileHealth.set(normalizePath(p), h);
}

/** 查询文件健康度（大小写/分隔符无关；无诊断返回 undefined） */
export function treeHealthOf(path: string): TreeHealth | undefined {
  return fileHealth.get(normalizePath(path));
}

/** 是否有任何健康态条目（树侧避免无谓的 class 刷新循环） */
export function hasTreeHealthEntries(): boolean {
  return fileHealth.size > 0;
}
