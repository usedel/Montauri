# Spike 实现参考：Tauri 2 + Monaco（已验证，供重新实现复用）

> 日期：2026-08-20 · 来源：`bench/spike-tauri-monaco/`（该目录已按产品负责人要求清理，本文档保留其核心实现）
> 用途：重新实现外壳时，本文的补全/跳转/Tauri 命令代码是**已实测可用**的起点，避免重复踩坑。
> 结论背景见 [`ADR-0002`](adr/0002-zed-completion-ordering-not-controllable.md) 与 [`handoff-tauri-monaco.md`](handoff-tauri-monaco.md)。

## 0. 技术栈与版本

| 组件 | 版本 | 说明 |
|---|---|---|
| Tauri | 2.11.5 | `create-tauri-app` vanilla 模板（无打包器，`frontendDist: ../src`） |
| Monaco | 0.52.2 | CDN 加载（`cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/`）；正式化需改本地打包 |
| WebView2 | 151.0 | Windows 已内置 |
| Rust target | x86_64-pc-windows-msvc | — |

## 1. 关键踩坑（重新实现务必注意）

1. **枚举对象可能取不到**：CDN 构建里 `monaco.languages.CompletionItemKind` 可能是 `undefined`。必须在**补全回调内**（monaco 已加载后）读取，并用数值回退：`Snippet=14`、`Function=2`、`Class=6`、`InsertAsSnippet=4`。**不能放模块顶层**（那时 monaco 未定义）。
2. **跨域 worker**：CDN 的 Monaco worker 跨域会失败，用同源 `data:` worker 去 `importScripts` CDN 的 `workerMain.js`（见 §3 `MonacoEnvironment`）。
3. **单词补全会淹没自定义 provider**：`wordBasedSuggestions: "off"` 关掉默认的「从文档抓词」补全。
4. **sortText 升序**：Monaco 按 `sortText` 字符串升序排，优先级 0 要 `padStart` 成 `"00"`。`preselect: true` 生效（Zed 忽略这两项，这是换壳主因）。
5. **前端编译期嵌入二进制**：vanilla 模板下 `src/` 在 `cargo build` 时被 codegen 嵌入，改前端必须重新 `cargo build`（增量约 20s–1min）。
6. **`uv run` 要锚定 cwd**：运行脚本时 `current_dir` 设为文件所在目录，uv 才能找到该目录的 `pyproject.toml`/`.venv`（否则退化成系统 python）。

## 2. Rust 侧（`src-tauri/src/lib.rs`）——三个最小命令

```rust
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
struct Entry { name: String, path: String }

#[tauri::command]
fn read_dir(path: &str) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    let rd = fs::read_dir(path).map_err(|e| e.to_string())?;
    for d in rd {
        let d = d.map_err(|e| e.to_string())?;
        if d.file_type().map(|t| t.is_file()).unwrap_or(false) {
            out.push(Entry {
                name: d.file_name().to_string_lossy().to_string(),
                path: d.path().to_string_lossy().to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

// 在文件所在目录运行 `uv run <文件名>`，回传 stdout+stderr。
#[tauri::command]
fn run_script(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let dir = p.parent().unwrap_or(Path::new(".")).to_path_buf();
    let fname = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
    let out = Command::new("uv").args(["run", &fname]).current_dir(&dir)
        .output().map_err(|e| format!("failed to spawn `uv`: {e}"))?;
    let mut s = String::new();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !stdout.is_empty() { s.push_str(&stdout); }
    if !stderr.is_empty() {
        if !s.is_empty() { s.push('\n'); }
        s.push_str("--- stderr ---\n");
        s.push_str(&stderr);
    }
    if s.is_empty() { s = format!("(no output, exit status: {})", out.status); }
    Ok(s)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_dir, read_file, run_script])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 3. 前端核心（`src/main.js`）——上下文感知补全 + 符号补全 + 跳转

```javascript
const { invoke } = window.__TAURI__.core;
const MONACO_BASE = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/";

let editor, currentFile = null, forceShowAll = false, symbolIndex = [];

// 跨域 worker 兜底（踩坑 #2）
window.MonacoEnvironment = {
  getWorkerUrl: function () {
    const proxy =
      "self.MonacoEnvironment={baseUrl:'" + MONACO_BASE + "'};" +
      "importScripts('" + MONACO_BASE + "vs/base/worker/workerMain.js');";
    return "data:text/javascript;charset=utf-8," + encodeURIComponent(proxy);
  },
};

require.config({ paths: { vs: MONACO_BASE + "vs" } });
require(["vs/editor/editor.main"], async function () {
  editor = monaco.editor.create(document.getElementById("editor"), {
    language: "python", theme: "vs-dark", automaticLayout: true, fontSize: 14,
    minimap: { enabled: false },
    wordBasedSuggestions: "off", // 踩坑 #3
    quickSuggestions: { other: true, comments: true, strings: true },
  });
  registerSmartPython();
  await loadTree();
  await buildSymbolIndex();
  wireRun(); wireSuggest(); wireGoto();
});

// ---- 智能模板（上下文感知）----
const TEMPLATES = {
  main:  { label: "if __name__ == '__main__'", body: 'if __name__ == "__main__":\n    $0' },
  def:   { label: "def function",              body: "def ${1:name}(${2:args}):\n    $0" },
  class: { label: "class",                     body: "class ${1:Name}:\n    def __init__(self${2:, *args}):\n        $0" },
  for:   { label: "for loop",                  body: "for ${1:item} in ${2:items}:\n    $0" },
  try:   { label: "try / except",              body: "try:\n    $1\nexcept ${2:Exception} as ${3:e}:\n    $0" },
  with:  { label: "with statement",            body: "with ${1:open}(${2:file}) as ${3:f}:\n    $0" },
};
// 数组下标 = 优先级（0 = 最前且 preselect）。同一前缀在不同上下文排序/预选不同。
const CONTEXT_PRIORITY = {
  module:   ["main", "class", "def", "for", "try", "with"],
  class:    ["def", "class", "for", "try", "with", "main"],
  function: ["for", "try", "with", "def", "main", "class"],
};

function registerSmartPython() {
  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                      startColumn: word.startColumn, endColumn: word.endColumn };
      const ctx = detectContext(model, position);
      let suggestions = buildSnippets(ctx).map((s) => ({ ...s, range }));

      // 符号补全（跨文件 def/class），排在模板之后
      const KIND_FUNCTION = (monaco.languages.CompletionItemKind && monaco.languages.CompletionItemKind.Function) ?? 2;
      const KIND_CLASS = (monaco.languages.CompletionItemKind && monaco.languages.CompletionItemKind.Class) ?? 6;
      const symbolItems = symbolIndex.map((s, i) => ({
        label: s.name, kind: s.kind === "class" ? KIND_CLASS : KIND_FUNCTION,
        insertText: s.name, sortText: "1" + String(i).padStart(3, "0"),
        detail: `${s.kind} · ${basename(s.file)}:${s.line}`, range,
      }));
      suggestions = suggestions.concat(symbolItems);

      if (forceShowAll) {
        suggestions = suggestions.map((s) => ({ ...s, filterText: word.word }));
        forceShowAll = false;
      }
      return { suggestions };
    },
  });
}

// 上下文判定：当前行缩进 + 向上找最近的更低缩进的 class/def
function detectContext(model, position) {
  const line = model.getLineContent(position.lineNumber);
  const indent = line.length - line.trimStart().length;
  if (indent === 0) return "module";
  for (let l = position.lineNumber - 1; l >= 1; l--) {
    const t = model.getLineContent(l);
    if (!t.trim()) continue;
    const ti = t.length - t.trimStart().length;
    if (ti < indent) {
      if (/^\s*class\s/.test(t)) return "class";
      if (/^\s*def\s/.test(t)) return "function";
      return "module";
    }
  }
  return "module";
}

function buildSnippets(ctx) {
  // 踩坑 #1：补全回调内读取枚举 + 数值回退
  const KIND_SNIPPET = (monaco.languages.CompletionItemKind && monaco.languages.CompletionItemKind.Snippet) ?? 14;
  const INSERT_AS_SNIPPET = (monaco.languages.CompletionItemInsertTextRules &&
    monaco.languages.CompletionItemInsertTextRules.InsertAsSnippet) ?? 4;
  const order = CONTEXT_PRIORITY[ctx] || CONTEXT_PRIORITY.module;
  return order.map((key, i) => {
    const t = TEMPLATES[key];
    return {
      label: t.label, kind: KIND_SNIPPET, insertText: t.body,
      insertTextRules: INSERT_AS_SNIPPET,
      sortText: String(i).padStart(2, "0"), // 踩坑 #4：升序
      preselect: i === 0,                    // Zed 忽略、Monaco 生效
      detail: `⟳ ctx=${ctx} · priority=${i}`,
    };
  });
}

// ---- 符号索引 / 跳转定义 ----
async function buildSymbolIndex() {
  symbolIndex = [];
  const entries = await invoke("read_dir", { path: DEMO_ROOT });
  for (const e of entries) {
    if (!e.name.endsWith(".py")) continue;
    const content = await invoke("read_file", { path: e.path });
    content.split("\n").forEach((line, idx) => {
      let m;
      if ((m = line.match(/^\s*def\s+(\w+)/))) symbolIndex.push({ name: m[1], kind: "function", file: e.path, line: idx + 1 });
      else if ((m = line.match(/^\s*class\s+(\w+)/))) symbolIndex.push({ name: m[1], kind: "class", file: e.path, line: idx + 1 });
    });
  }
}

function goToDefinition() {
  const pos = editor.getPosition(), model = editor.getModel();
  if (!pos || !model) return;
  const word = model.getWordAtPosition(pos);
  if (!word) return;
  const name = word.word;
  const target = symbolIndex.find((s) => s.name === name && s.file === currentFile)
              || symbolIndex.find((s) => s.name === name);
  if (!target) return;
  const reveal = () => { editor.revealLineInCenter(target.line); editor.setPosition({ lineNumber: target.line, column: 1 }); };
  if (target.file === currentFile) reveal();
  else openFile(target.file).then(reveal); // 跨文件跳转
}

function wireGoto() {
  editor.addCommand(monaco.KeyCode.F12, goToDefinition);       // F12
  editor.onMouseDown((e) => {                                   // Ctrl+点击
    if (e.event.ctrlKey && e.target && e.target.position) {
      editor.setPosition(e.target.position);
      goToDefinition();
    }
  });
}

function basename(p) { return p.split(/[\\/]/).pop(); }
```

> 其余（`loadTree`/`openFile`/`wireRun`/`wireSuggest`/`setOutput`）为常规 DOM/IPC 胶水，重新实现时按布局需要编写即可。

## 4. 布局与配置要点

- **布局**：顶部工具栏（`▶ Run`、`⚡ All templates`、状态）+ 左侧文件树（220px）+ 中间编辑器 + 底部输出面板（190px）。flex 纵向 + 横向嵌套。
- **`tauri.conf.json`**：`withGlobalTauri: true`（前端用 `window.__TAURI__`）、`security.csp: null`（允许 CDN）、窗口 800x600。
- **capabilities**：`core:default` + `opener:default` 即可（spike 未用 fs/shell 插件，文件读写走自定义命令）。

## 5. 实测指标（debug 构建）

- 首次 `cargo check` ~5m24s，`cargo build` ~2m03s，前端改动增量 ~20s–1min。
- 内存：主进程 ~39 MB + WebView2 六子进程 ~380 MB ≈ **420 MB**（Zed ~150，约 2.8x）。
- 功能：上下文模板补全 ✅ / sortText ✅ / preselect ✅ / 符号补全（跨文件）✅ / 跳转（F12、Ctrl+点击、跨文件）✅ / 文件树 ✅ / 运行按钮 ✅。
