// CSV 数据查看器（VS Code 插件调研报告 借鉴-4）词条。
export const csv = {
  /** Tab 显示名后缀（与同名编辑 Tab 区分） */
  "csv.labelSuffix": "数据",
  /** 工具栏「以文本编辑」：查看器是只读的，编辑另开文本 Tab */
  "csv.editSource": "以文本编辑",
  /** 工具栏「外部打开」：超 10MB 守卫打不开文本编辑时，用系统默认程序兜底 */
  "csv.openExternal": "外部打开",
  /** 外部打开失败（opener 插件报错） */
  "csv.openExternalFailed": "外部打开失败：{msg}",
  /** 读文件失败（被移动/删除/无权限） */
  "csv.readFailed": "读取失败（文件可能已被移动或删除）",
  /** 非 UTF-8：不做编码猜测，显式提示 */
  "csv.decodeFailed": "不是 UTF-8 编码，无法预览（请先转码为 UTF-8）",
  /** 空文件（连表头都没有） */
  "csv.empty": "空文件（没有表头也没有数据行）",
};
