// English (US) 语言包「watch 域」：key 与 zh-CN/watch.ts 一一对应，Record<WatchKey, string> 在编译期强校验漏译。
import type { WatchKey } from "../zh-CN/watch";

export const watch: Record<WatchKey, string> = {
  // ---- watch.batch ----
  "watch.batch.later": "Decide later",
  "watch.batch.message.one": "{count} open files were modified on disk by another program, and all of them have unsaved changes.",
  "watch.batch.message.other": "{count} open files were modified on disk by another program, and all of them have unsaved changes.",
  "watch.batch.oneByOne": "Handle one by one",
  "watch.batch.reloadAll": "Reload all from disk",
  "watch.batch.title": "Several files changed on disk",
  // ---- watch.conflict ----
  "watch.conflict.cancelSave": "Cancel Save",
  "watch.conflict.later": "Decide Later",
  "watch.conflict.message": "{name} was modified on disk by another program. Your changes are unsaved.",
  "watch.conflict.overwrite": "Overwrite with My Version",
  "watch.conflict.reload": "Reload from Disk",
  "watch.conflict.saveAs": "Save As…",
  "watch.conflict.title": "File changed on disk",
  // ---- watch.health ----
  "watch.health.label": "Watching broken",
  "watch.health.restored": "File watching restored",
  "watch.health.tip": "File watching is not working (common on network/synced drives). Click to resubscribe.",
  "watch.health.toast": "File watching stopped working: the file tree and git status may no longer refresh automatically (click the status chip to retry)",
  // ---- watch ----
  "watch.saveAsFailed": "Save As failed",
  "watch.saveAsSamePath": "Cannot save as the original file; pick a different path",
  "watch.saved": "Saved as {name}",
  "watch.unreadable": "{name} may have been deleted or cannot be read; check it manually",
};
