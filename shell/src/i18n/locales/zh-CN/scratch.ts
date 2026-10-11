// Scratch / 单元格执行（VS Code 插件调研报告 借鉴-2）词条。
export const scratch = {
  /** 右键菜单：运行光标所在单元格 */
  "scratch.actionRun": "运行单元格（# %%）",
  /** 右键菜单：显式关闭会话（ADR-0010「可显式关闭」的另一半） */
  "scratch.actionStop": "停止 Scratch 会话",
  /** 输出头：本次执行的行范围 */
  "scratch.header": "▶ 单元格 {range}",
  /** 当前单元格没有可执行代码 */
  "scratch.empty": "当前单元格为空（无 `# %%` 分隔时整个文件是一个单元格）",
  /** 执行失败 toast */
  "scratch.fail": "单元格执行失败",
  /** 超时回收提示 */
  "scratch.recycled": "会话因超时被回收，下次执行将重新启动解释器",
  /** 显式停止提示 */
  "scratch.stopped": "Scratch 会话已停止",
};
