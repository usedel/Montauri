// 帮助文档入口（帮助菜单 → 帮助文档）。
//
// 形态：正文是随包分发的静态 Markdown（`shell/public/help/opencharm-help{,.en}.md`），**不进前端 JS 包**——
// 前端 JS+CSS 产物体积预算（ci/budgets.toml `max_bundle_kb`）余量极小，正文用 `?raw` 内联会直接顶穿；
// 放 public/ 则 dev/prod 同由「self」同源静态服务（与 public/fonts 的 `/fonts/...` 同一条路径，
// CSP 无需放开），构建后落在 dist/help/ 而非 dist/assets/，不计入 JS+CSS 体积。
//
// 语言：按**当前界面语言**选正文（en-US → `opencharm-help.en.md`，其余 → 中文 `opencharm-help.md`）；
// 本语缺失（未随包分发）时回落中文，保证入口永远可用。两份正文落盘为两个不同文件名，
// 故中英文可各开一个预览 Tab 互不覆盖。
//
// 流程：fetch 正文 → `get_data_doc_path` + `write_file` 落盘到数据根 `docs/` → `openPreviewTab`
// 打开只读预览 Tab（每次打开都覆写，故永远是当前版本的副本）。
//
// 解环：**不 import main.ts**——写盘与开 Tab 都用既有能力（invoke 命令 + mdPreviewTab 的公开入口），
// 无需 main 注入 handler；main.ts 行数预算已触顶，这里刻意不占它的行数。

import { invoke } from "@tauri-apps/api/core";
import { openPreviewTab } from "./mdPreviewTab";
import { getLocale, t } from "./i18n";
import { localizeBackendError } from "./i18n/backendError";
import { toast } from "./toast";
import { errMsg } from "./util";

const HELP_DOC_BASE = "opencharm-help";
/** 中文正文文件名（兜底） */
const HELP_DOC_ZH = `${HELP_DOC_BASE}.md`;

/** 界面语言 → 正文文件名（前缀匹配，避免与 Locale 联合类型耦合） */
function helpDocName(locale: string): string {
  return locale.startsWith("en") ? `${HELP_DOC_BASE}.en.md` : HELP_DOC_ZH;
}

/** 取正文：2xx → 文本；404 → null（交给调用方回落）；其余 → 抛错 */
async function fetchDoc(name: string): Promise<string | null> {
  const res = await fetch(`/help/${name}`);
  if (res.ok) return await res.text();
  if (res.status === 404) return null;
  throw new Error(`HTTP ${res.status}`);
}

/** 并发去重：连点菜单不重复 fetch + 写盘（openPreviewTab 自身按 path 去重，这里省掉重复 IO） */
let inflight: Promise<void> | null = null;

/** 打开帮助文档（帮助菜单入口）。 */
export function openHelpDocs(): Promise<void> {
  if (inflight) return inflight;
  inflight = doOpenHelpDocs().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function doOpenHelpDocs(): Promise<void> {
  try {
    // 先取本语文档；本语缺失（未随包分发）时回落中文，保证入口永远可用
    let name = helpDocName(getLocale());
    let content = await fetchDoc(name);
    if (content === null && name !== HELP_DOC_ZH) {
      name = HELP_DOC_ZH;
      content = await fetchDoc(name);
    }
    if (content === null) throw new Error("HTTP 404");
    const path = await invoke<string>("get_data_doc_path", { name });
    await invoke("write_file", { path, content });
    openPreviewTab(path);
  } catch (e) {
    toast(t("help.docs.openFailed", { error: localizeBackendError(errMsg(e)) }), "error");
  }
}
