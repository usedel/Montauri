// 外开类型分派（PyCharm 调研借鉴：xlsx/docx/pdf 等二进制不在编辑器里打开）。
//
// 手势语义（PyCharm 同款，docs/open_file_dev_plan 之外的轻量增补）：
//   · 单击 = 只选中（不尝试读文件——二进制 read_file 会 UTF-8 解码失败弹 toast）；
//   · 双击 = 系统默认程序打开（fileTree 分流）；
//   · 其他一切入口（键盘 Enter / quickOpen / 单文件打开）统一在 main::doOpenFile 分流外开。
//
// 零新命令：走 tauri-plugin-opener 的 `plugin:opener|open_path`（能力已在
// capabilities/default.json 放行，csvTab「外部打开」同款先例）——插件命令不占命令面预算，
// 不动 budgets.toml 的 max_tauri_commands 信号线。

import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { toast } from "./toast";

/** 外开白名单（标准集，用户裁决 2026-10-11）：Office / PDF / 图片 / 压缩包 / Windows 二进制。
 *  已有专属视图的类型不纳入（md 预览 / csv 查看器 / SQLite 工具），避免抢路由。 */
const EXTERNAL_OPEN_EXTS: ReadonlySet<string> = new Set([
  // Office
  "xlsx", "xls", "xlsm", "doc", "docx", "ppt", "pptx",
  // PDF
  "pdf",
  // 图片
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff",
  // 压缩包
  "zip", "7z", "rar", "gz", "tar",
  // Windows 二进制
  "exe", "dll", "msi",
]);

/** 纯逻辑：该路径是否走「系统默认程序打开」（扩展名命中白名单）。 */
export function isExternalOpenPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (dot === -1 || dot < slash) return false; // 无扩展名 / 点属于目录名
  return EXTERNAL_OPEN_EXTS.has(path.slice(dot + 1).toLowerCase());
}

/** 用系统默认程序打开（opener 插件）。失败 toast 反馈，不打断流程。 */
export async function openWithSystem(path: string): Promise<void> {
  try {
    await invoke("plugin:opener|open_path", { path, with: null });
  } catch (e) {
    toast(t("filetree.openExternalFailed", { msg: String(e) }), "error");
  }
}
