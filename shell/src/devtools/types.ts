// 开发工具（DevTool）协议：定义一套所有工具共同遵循的接入契约。
// 每个工具只需实现「一份元数据 + 一个 mount(host)」，其余（面板、菜单、复制、回填编辑器）
// 均由框架统一提供。后续新增工具无需改动面板/菜单代码，仅 register 即可。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";

export type MonacoModule = typeof MonacoApi;

/** 框架注入给工具的能力集合（工具仅通过 host 与外壳交互，不直接触碰全局状态） */
export interface ToolHost {
  /** 工具面板的内容容器，工具把自己的 DOM 挂到此处 */
  root: HTMLElement;
  /** 复用 Monaco（只读代码预览 / 值预览等） */
  monaco: MonacoModule;
  /** 当前工作区根（null = 未打开工作区；供「从文件读取」等场景使用） */
  workspaceRoot: () => string | null;
  /** 复制到剪贴板（统一走已有的 copy_to_clipboard IPC）；返回是否成功 */
  copyToClipboard: (text: string) => Promise<boolean>;
  /** 把文本插入当前编辑器（光标/选区处）；无打开文件时返回 false */
  insertToEditor: (text: string) => boolean;
}

/** 工具清单元数据 */
export interface DevTool {
  /** 唯一 id，如 "curl2python" */
  id: string;
  /** 面板 / 菜单中的显示名 */
  title: string;
  /** 用途说明（面板导航 hover 提示） */
  description: string;
  /** 分组名（面板导航按此分组；空串归入「其他」） */
  category: string;
  /** codicon 图标名（如 "terminal" / "json"） */
  icon: string;
  /** 打开工具：挂载 UI 到 host.root，返回清理句柄（可返回 null 表示无需清理） */
  mount(host: ToolHost): ToolInstance | void;
}

/** 工具实例：面板切换 / 关闭时调用 dispose 清理（Monaco editor、事件监听器等） */
export interface ToolInstance {
  dispose(): void;
}