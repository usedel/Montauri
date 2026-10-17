// 简体中文语言包「watch 域」（真源）：由 tools/i18n/apply_ts.py 从源码抽取、gen_domain.py 生成，勿手改（改动请回到源码与 data/watch_zh.json）。
// 复数条目（含 {count}）自动展开 .one/.other 两份——中文两形同文。
export const watch = {
  // ---- watch.conflict ----
  "watch.conflict.cancelSave": "取消保存",
  "watch.conflict.later": "稍后处理",
  "watch.conflict.message": "{name} 在磁盘上已被其他程序修改。你的修改尚未保存。",
  "watch.conflict.overwrite": "用我的版本覆盖磁盘",
  "watch.conflict.reload": "用磁盘版本重载",
  "watch.conflict.saveAs": "另存为…",
  "watch.conflict.title": "文件已被外部修改",
  // ---- watch ----
  "watch.saveAsFailed": "另存失败",
  "watch.saveAsSamePath": "不能另存为原文件（请换一个路径）",
  "watch.saved": "已另存为 {name}",
  "watch.unreadable": "{name} 可能已被删除或无法读取，请手动确认",
};

/** 本域文案 key：en-US/watch.ts 的 Record<WatchKey, string> 由它派生。 */
export type WatchKey = keyof typeof watch;
