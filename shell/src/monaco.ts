// Monaco 按需加载：只引入 editor core + 所需功能 + Python 语言（冷启动优化）
// 替代 `import * as monaco from "monaco-editor"`（后者打包全部 ~90 种语言，主 chunk 3.3 MB）
// 也替代 `editor.all`（含全部编辑器功能，~3.2 MB）——只引入本项目用到的：

import * as editorApi from "monaco-editor/esm/vs/editor/editor.api";

// --- 编辑器功能（按需） ---
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching"; // 括号匹配
import "monaco-editor/esm/vs/editor/contrib/caretOperations/browser/caretOperations"; // 光标操作
import "monaco-editor/esm/vs/editor/contrib/codeAction/browser/codeActionContributions"; // 灯泡 + 快速修复菜单入口（Ctrl+. / hover Quick Fix）
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu"; // 编辑器右键菜单（此前未引入 → 编辑器内右键无任何菜单，addAction 的入口全部不可达）
import "monaco-editor/esm/vs/editor/contrib/codelens/browser/codelensController"; // 引用计数 Code Vision（codeVision.ts）
import "monaco-editor/esm/vs/editor/contrib/comment/browser/comment"; // Ctrl+/ 行注释 / Ctrl+Shift+/ 块注释
import "monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController"; // Ctrl+F 查找
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding"; // 代码折叠
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions"; // Shift+Alt+F 格式化
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands"; // Shift+F12 查找引用（命令 + 语言服务）
// 查找引用的 peek 结果视图：goToCommands 只带命令与 referenceProvider 语言服务，
// ReferencesController（peek 窗口）是独立 contribution，需显式引入才会 registerEditorContribution，
// 否则引擎算出了引用但结果窗口静默不显示（实测 Shift+F12 无任何 UI 反应）。
import "monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution"; // hover
import "monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsContribution"; // 编辑器内联类型标注（runtime intel）
import "monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation"; // 自动缩进
import "monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection";
import "monaco-editor/esm/vs/editor/contrib/links/browser/links"; // 链接点击
// 行操作（PyCharm 的移动行/复制行/删除行/缩进调整等命令都在这里）：此前未引入 →
// editor.action.moveLinesUpAction / moveLinesDownAction 均不可达（C-2 依赖）。
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations";
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor"; // 多光标
import "monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints"; // 签名帮助 widget
// 注：内建 rename contribution（F2 单文件 rename widget）已移除——重命名统一走自研就地改名
// renameWidget.ts（prepareRename 锚定 + ghost 预览 + 跨文件 diff 确认），F2 由其 addCommand 接管。
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2"; // snippet 占位符会话（live templates 展开依赖，显式声明避免仅靠 suggest 传递引入）
// PR-B（dx_features_backlog §6.2）：粘性滚动（Monaco 0.52 内建 stickyScroll；按需裁剪必须显式引入，
// 否则 getOption 显示 enabled 但 contribution 不存在、widget 永不渲染——同 ReferencesController 教训）
import "monaco-editor/esm/vs/editor/contrib/stickyScroll/browser/stickyScrollContribution";
// 智能选区（PyCharm Ctrl+W）：按语法层级逐级扩大/缩小选区，命令 id =
// editor.action.smartSelect.expand / .shrink（grow 是其别名）。此前未引入 → 命令不可达。
import "monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController"; // 补全 UI
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter"; // 词高亮

// --- 语法高亮（Monarch 词法，无 worker；按 Python 项目常见文件类型按需引入） ---
// 配置与文档
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution"; // 兼容 toml/ini/cfg/conf 近似着色
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution";
import "monaco-editor/esm/vs/basic-languages/restructuredtext/restructuredtext.contribution";
// Web / 文档
import "monaco-editor/esm/vs/basic-languages/html/html.contribution";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution";
// 脚本 / 容器 / 数据
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution";
import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
// 其他语言
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// 本地 worker 配置（去 CDN，spike 踩坑 #2 的正式解法）
// 只用 editor worker（Python 高亮是 Monarch 词法，无需语言 worker）
self.MonacoEnvironment = {
  getWorker(): Worker {
    return new editorWorker();
  },
};

// --- JSON 高亮：basic-languages 无 json 目录，官方 json 由 language/json 包提供且依赖 json worker。
// 为保持「零 worker、按需」原则，这里手写一个 Monarch tokenizer 注册，仅做语法着色。
editorApi.languages.register({ id: "json", extensions: [".json"], aliases: ["JSON", "json"] });
editorApi.languages.setMonarchTokensProvider("json", {
  tokenizer: {
    root: [
      [/\s+/, "white"],
      [/[{}\[\]]/, "delimiter.bracket"],
      [/[:,]/, "delimiter"],
      // 键：字符串后紧跟冒号（非贪婪 + 前瞻）
      [/"[^"\\]*(?:\\.[^"\\]*)*"(?=\s*:)/, "attribute.name"],
      // 值字符串
      [/"[^"\\]*(?:\\.[^"\\]*)*"/, "string"],
      [/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, "number"],
      [/\b(?:true|false)\b/, "keyword"],
      [/\bnull\b/, "keyword"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, { token: "comment", next: "@comment" }],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\/\*/, { token: "comment", next: "@comment" }],
      [/\*\//, { token: "comment", next: "@pop" }],
      [/[/*]/, "comment"],
    ],
  },
});

// --- Monaco 取消噪声全局静默（PR-D 实测踩坑，dx_features_backlog §6.4）---
// wordHighlighter / stickyScroll 等贡献在 dispose 路径 Delayer.cancel() 会触发
// cancelable promise reject(CanceledError)，裸 Monaco 未像 VS Code 那样接全局
// error handler（「取消不是错误」哲学）→ 拒绝冒泡成 unhandledrejection/pageerror。
// 只按 CanceledError 的 name/message 精确过滤，其余拒绝照常上报，不掩盖真实错误。
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason as { name?: string; message?: string } | undefined;
  if (reason?.name === "Canceled" || reason?.message === "Canceled") e.preventDefault();
});

export default editorApi;
