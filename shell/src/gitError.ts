// Git 错误分类码 → 用户可读文案（**leaf 模块**）。
//
// 后端 `git_message` / `Err(…)` 带 `GitMissing:` / `GitNotRepo:` 分类码，输出到 toast 与输出面板
// 之前必须翻成人话，否则会露出裸前缀。为什么要分流：spawn 失败（没装 Git）与 exit!=0（不是仓库）
// 以前都糊成一条 git 原始 stderr，SCM 面板一律显示「不是 Git 仓库」，用户装了 Git 也不知道该装。
//
// 独立成 leaf 的原因（与 scratchCore.ts 同款教训）：newProject.ts 需要它，但 git.ts 经 ./termUi
// 拉入 xterm（@xterm/addon-fit 的 UMD 包装引用 `self`），node 环境单测一 import 即
// `ReferenceError: self is not defined`（newProjectType.test.ts 曾因此整文件收集失败）。
// 本模块只依赖 util / i18n，无 DOM、无 xterm、无 state——可被纯函数单测直接 import。

import { errMsg } from "./util";
import { t } from "./i18n";
import { localizeBackendError } from "./i18n/backendError";

/** 后端分类码前缀（与 `git_cmds.rs` 的同名常量逐字一致）：git 二进制缺失 */
const GIT_MISSING_PREFIX = "GitMissing:";
/** 后端分类码前缀：`git` 在，但工作区不是仓库 */
const GIT_NOT_REPO_PREFIX = "GitNotRepo:";

/**
 * git 命令失败文案：把后端分类码翻成用户可读的原因。
 * 未命中前缀时行为与改造前完全一致（走后端文案翻译层）。
 */
export function gitErrText(e: unknown): string {
  const raw = errMsg(e);
  if (raw.startsWith(GIT_MISSING_PREFIX)) return t("git.err.missing");
  if (raw.startsWith(GIT_NOT_REPO_PREFIX)) return t("git.err.notRepo");
  return localizeBackendError(raw);
}
