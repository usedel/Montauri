// 外部文件拖入工作区（T5 · 微交互批，VSCode/PyCharm 树侧 drop 导入同款）：
// HTML5 DnD 路线——Windows 资源管理器拖文件时 DataTransfer 只含 File 对象
//（无 text/plain、无绝对路径），与树内拖拽（text/plain = 源路径）天然分离。
//
// 内容传输（而非路径）：File.arrayBuffer → base64 → invoke("write_dropped_file")。
// 为什么不用路径：拿绝对路径须撤掉 disable_drag_drop_handler 走 wry 原生
// IDropTarget——那会抢注 WebView2 的 HTML5 drop（T4 tab 拖拽与树内移动全灭），
// 见微交互调研报告 T5 节的路线裁决。
//
// 本模块只做纯逻辑（落点计算 + 复制编排），DOM 监听接线在 fileTree.ts——
// 防其体积膨胀（预算红线 2,700）与反向依赖。

import { invoke } from "@tauri-apps/api/core";

/** 拖入的文件是否在拖入上限内（64MB，与 Rust 侧 MAX_BYTES 同口径） */
export const DROP_IMPORT_MAX_BYTES = 64 * 1024 * 1024;

/** DataTransfer 是否携带外部文件（树内拖拽只有 text/plain，不误判） */
export function hasExternalFiles(dt: DataTransfer | null): boolean {
  return !!dt && dt.types.includes("Files") && dt.files.length > 0;
}

/** 落点目录：目录条目 = 自身；文件条目 = 父目录（VSCode 同款语义） */
export function dropTargetDir(entry: { path: string; is_dir: boolean }): string {
  return entry.is_dir ? entry.path : parentDir(entry.path);
}

/** 路径 dirname（Windows / 分隔符皆可） */
function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
}

/** 导入结果（toast / reveal 用） */
export interface DropImportResult {
  ok: string[]; // 成功写入的绝对路径（可能带「 - 副本」后缀）
  failed: { name: string; error: string }[]; // 失败明细（逐文件 toast 汇总）
}

/** 单文件 base64（分块编码防超大字符串 +Array 超栈——64MB 上限下 8K 块安全） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // 32KB 块（String.prototype.apply 参数上限内的安全值）
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 把拖入的文件列表导入目标目录（顺序执行：同名「 - 副本」策略在 Rust 侧裁决） */
export async function importDroppedFiles(
  files: FileList | File[],
  dstDir: string,
): Promise<DropImportResult> {
  const ok: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const f of Array.from(files)) {
    // 目录拖入：File 对象无法表达目录树（webkitGetAsEntry 有 API 但拖入目录时
    // files 列表通常只含目录名占位）——不支持，明确提示走资源管理器复制
    if (f.size === 0 && !f.type && f.name && !f.name.includes(".")) {
      failed.push({ name: f.name, error: "directory" });
      continue;
    }
    if (f.size > DROP_IMPORT_MAX_BYTES) {
      failed.push({ name: f.name, error: "too-large" });
      continue;
    }
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const b64 = bytesToBase64(buf);
      const finalPath = await invoke<string>("write_dropped_file", {
        dstDir,
        name: f.name,
        contentB64: b64,
      });
      ok.push(finalPath);
    } catch (e) {
      failed.push({ name: f.name, error: String(e) });
    }
  }
  return { ok, failed };
}
