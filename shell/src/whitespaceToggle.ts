// 空白字符渲染切换（T6b · PyCharm「Show Whitespaces」同款语义）：
// 编辑器右键菜单勾选项，切换 Monaco renderWhitespace——"selection"（选区内渲染，
// VSCode 出厂默认：平时零噪音、选中时可见）/ "none"。
//
// 会话级状态（不进 Settings）：PyCharm 也是视图级开关而非持久设置；生命周期随窗口，
// 重启回默认（selection）。刻意不挂设置面板——低频视图工具，进设置面板徒增噪音。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { app } from "./state";
import { t } from "./i18n";

/** 当前空白渲染态（初始 = selection，Monaco 出厂默认行为一致） */
let showWhitespace = false;

/** 空白渲染是否开启（单测/外部查询用） */
export function whitespaceRenderEnabled(): boolean {
  return showWhitespace;
}

/** 应用空白渲染到编辑器（updateOptions 双向显式——合并语义下未列项不复位） */
function applyWhitespaceRender(): void {
  app.editor?.updateOptions({ renderWhitespace: showWhitespace ? "all" : "selection" });
}

/** 切换开关并应用。返回切换后的状态（菜单勾选态用）。 */
export function toggleWhitespaceRender(): boolean {
  showWhitespace = !showWhitespace;
  applyWhitespaceRender();
  return showWhitespace;
}

/** 编辑器右键菜单入口（main 的 init 中注册，返回 IDisposable 入 DisposableStore） */
export function initWhitespaceAction(editor: MonacoApi.editor.IStandaloneCodeEditor): MonacoApi.IDisposable {
  return editor.addAction({
    id: "opencharm.toggleWhitespace",
    label: t("ide.ws.actionLabel"),
    contextMenuGroupId: "2_view", // 视察组：排在修改组之后
    contextMenuOrder: 1.5,
    keybindings: undefined, // 不占键位（低频视图工具；用户可经命令面板发现）
    run: (_ed) => {
      const on = toggleWhitespaceRender();
      toastVisibility(on);
    },
  });
}

/** 切换后的轻提示（状态可感知——菜单关闭后勾选态不可见，toast 补反馈） */
function toastVisibility(on: boolean): void {
  // 动态 import 防 toast 依赖链进单测（toast 模块有 DOM 依赖）
  void import("./toast").then(({ toast }) => {
    toast(on ? t("ide.ws.enabled") : t("ide.ws.disabled"), "info");
  });
}
