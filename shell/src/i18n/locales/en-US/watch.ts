// English (US) 语言包「watch 域」：key 与 zh-CN/watch.ts 一一对应，Record<WatchKey, string> 在编译期强校验漏译。
import type { WatchKey } from "../zh-CN/watch";

export const watch: Record<WatchKey, string> = {
  // ---- watch.conflict ----
  "watch.conflict.cancelSave": "Cancel Save",
  "watch.conflict.later": "Decide Later",
  "watch.conflict.message": "{name} was modified on disk by another program. Your changes are unsaved.",
  "watch.conflict.overwrite": "Overwrite with My Version",
  "watch.conflict.reload": "Reload from Disk",
  "watch.conflict.saveAs": "Save As…",
  "watch.conflict.title": "File changed on disk",
  // ---- watch ----
  "watch.saveAsFailed": "Save As failed",
  "watch.saveAsSamePath": "Cannot save as the original file; pick a different path",
  "watch.saved": "Saved as {name}",
  "watch.unreadable": "{name} may have been deleted or cannot be read; check it manually",
};
