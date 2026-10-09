// Git 状态存储（CR-25 从 git.ts 下沉的独立状态层，零依赖）：
// fileTree.ts 只需读这些状态做装饰，原本从 git.ts import 导致 fileTree ↔ git 循环。
// 写入方仍只有 git.ts（refreshGitStatus / resetGitState）；本模块只存状态 + 访问器，
// 不含任何 invoke / DOM / 其它模块引用（可安全被任何层 import）。

import { normalizePath } from "./util";

/** Git 状态缓存：相对路径 → 展示状态码（M/A/D/R/?/!）
 *  写入 key 为 git 输出的原始大小写（如 Foo.py）；读取经 normalizePath 大小写无关。 */
export const gitStatuses = new Map<string, string>();

/** 有变更的目录集合（相对路径，文件树目录高亮用） */
export const gitDirtyDirs = new Set<string>();

/** 被 .gitignore 忽略的路径集合（相对路径，git --ignored=matching 输出，小写归一 key）。
 *  条目可能是目录（node_modules/）或文件；树侧判断「该条目或其祖先在集合内」即视为 ignored。
 *  归一化原因：gitStatuses 用原始大小写 + 查询侧归一的双结构，此处直接存归一 key——
 *  ignored 条目不需要反查原始路径（不做 add/diff 操作），单 Set + 前缀匹配足够。 */
const ignoredPaths = new Set<string>();

/** 重建 ignored 集合（git.ts 在状态刷新后调用；传入相对路径原始大小写，内部归一） */
export function setGitIgnoredPaths(paths: string[]): void {
  ignoredPaths.clear();
  for (const p of paths) {
    // git 目录条目带尾斜杠（node_modules/），统一剥掉再归一
    const trimmed = p.replace(/[\\/]+$/, "");
    if (trimmed) ignoredPaths.add(normalizePath(trimmed));
  }
}

/** 相对路径是否被忽略（自身或任一祖先是 ignored 条目；大小写/分隔符无关） */
export function isGitIgnored(relPath: string): boolean {
  if (ignoredPaths.size === 0) return false;
  // 尾斜杠统一剥离（查询侧目录条目可能带 /，与存储侧 setGitIgnoredPaths 的剥法一致）
  const norm = normalizePath(relPath).replace(/[\\/]+$/, "");
  if (ignoredPaths.has(norm)) return true;
  // 祖先前缀匹配：a/b/c.py → a/b、a
  let dir = norm;
  let idx = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
  while (idx > 0) {
    if (ignoredPaths.has(dir.slice(0, idx))) return true;
    dir = dir.slice(0, idx);
    idx = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
  }
  return false;
}

/** 是否为 git 仓库（文件树装饰总开关） */
export const gitRepoActive = { value: false };

/** 归一化索引（小写 key → 原始 key）：gitStatusOf 的大小写无关查询用（E2E 验收实测：
 *  写入侧原始大小写 + 调用方归一化小写 → 直接 Map.get 必 miss，git 右键菜单消失） */
const statusIndex = new Map<string, string>();

/** 重建归一化索引（git.ts 在 gitStatuses.clear + 重填后调用） */
export function rebuildStatusIndex(): void {
  statusIndex.clear();
  for (const key of gitStatuses.keys()) statusIndex.set(normalizePath(key), key);
}

/** 相对路径 → 状态码（fileTree 装饰用；大小写/分隔符无关） */
export function gitStatusOf(relPath: string): string | undefined {
  const direct = gitStatuses.get(relPath);
  if (direct !== undefined) return direct;
  const key = statusIndex.get(normalizePath(relPath));
  return key !== undefined ? gitStatuses.get(key) : undefined;
}

/** 目录是否有变更（fileTree 装饰用） */
export function isGitDirtyDir(relPath: string): boolean {
  return gitDirtyDirs.has(relPath);
}

/** 是否 git 仓库（fileTree 装饰用） */
export function isGitRepoActive(): boolean {
  return gitRepoActive.value;
}
