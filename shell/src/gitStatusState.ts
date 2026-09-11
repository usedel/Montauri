// Git 状态存储（CR-25 从 git.ts 下沉的独立状态层，零依赖）：
// fileTree.ts 只需读这些状态做装饰，原本从 git.ts import 导致 fileTree ↔ git 循环。
// 写入方仍只有 git.ts（refreshGitStatus / resetGitState）；本模块只存状态 + 访问器，
// 不含任何 invoke / DOM / 其它模块引用（可安全被任何层 import）。

/** Git 状态缓存：相对路径 → 展示状态码（M/A/D/R/?/!） */
export const gitStatuses = new Map<string, string>();

/** 有变更的目录集合（相对路径，文件树目录高亮用） */
export const gitDirtyDirs = new Set<string>();

/** 是否为 git 仓库（文件树装饰总开关） */
export const gitRepoActive = { value: false };

/** 相对路径 → 状态码（fileTree 装饰用） */
export function gitStatusOf(relPath: string): string | undefined {
  return gitStatuses.get(relPath);
}

/** 目录是否有变更（fileTree 装饰用） */
export function isGitDirtyDir(relPath: string): boolean {
  return gitDirtyDirs.has(relPath);
}

/** 是否 git 仓库（fileTree 装饰用） */
export function isGitRepoActive(): boolean {
  return gitRepoActive.value;
}
