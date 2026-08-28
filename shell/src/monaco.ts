// Monaco 按需加载：只引入 editor core + 所需功能 + Python 语言（冷启动优化）
// 替代 `import * as monaco from "monaco-editor"`（后者打包全部 ~90 种语言，主 chunk 3.3 MB）
// 也替代 `editor.all`（含全部编辑器功能，~3.2 MB）——只引入本项目用到的：

import * as editorApi from "monaco-editor/esm/vs/editor/editor.api";

// --- 编辑器功能（按需） ---
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching"; // 括号匹配
import "monaco-editor/esm/vs/editor/contrib/caretOperations/browser/caretOperations"; // 光标操作
import "monaco-editor/esm/vs/editor/contrib/codeAction/browser/codeActionContributions"; // 灯泡 + 快速修复菜单入口（Ctrl+. / hover Quick Fix）
import "monaco-editor/esm/vs/editor/contrib/comment/browser/comment"; // Ctrl+/ 行注释 / Ctrl+Shift+/ 块注释
import "monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController"; // Ctrl+F 查找
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding"; // 代码折叠
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions"; // Shift+Alt+F 格式化
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands"; // Shift+F12 查找引用
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution"; // hover
import "monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsContribution"; // 编辑器内联类型标注（runtime intel）
import "monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation"; // 自动缩进
import "monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection";
import "monaco-editor/esm/vs/editor/contrib/links/browser/links"; // 链接点击
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor"; // 多光标
import "monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints"; // 签名帮助 widget
import "monaco-editor/esm/vs/editor/contrib/rename/browser/rename"; // F2 重命名（含 renameWidget）
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2"; // snippet 占位符会话（live templates 展开依赖，显式声明避免仅靠 suggest 传递引入）
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

export default editorApi;
