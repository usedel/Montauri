// 无状态纯工具函数：从 main.ts 拆出（消除「上帝文件」的第一步）。
// 仅包含不依赖 DOM / 全局状态的路径、展示类纯函数，便于单测与复用。

/** 取文件名（去除目录前缀） */
export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** 文件扩展名 → Monaco 语言 ID */
export function languageOf(path: string): string {
  // 复合扩展名/特殊文件名：按完整文件名精确匹配（如 uv.lock 实为 TOML 而非 .lock 文本）
  const byName: Record<string, string> = {
    "uv.lock": "ini",       // TOML（Monaco 无原生 toml，用 ini 近似着色）
    "poetry.lock": "ini",   // TOML
    "cargo.lock": "ini",    // TOML
    "pipfile.lock": "json", // JSON（避免与上列 toml 锁文件混淆）
  };
  const hit = byName[basename(path).toLowerCase()];
  if (hit) return hit;

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    // Python
    py: "python", pyw: "python",
    // Web / 前端
    js: "javascript", ts: "typescript", html: "html", htm: "html",
    css: "css", scss: "scss",
    // 数据 / 文档
    json: "json", xml: "xml", md: "markdown", rst: "restructuredtext",
    // 配置
    yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", cfg: "ini", conf: "ini",
    // 脚本 / 容器 / 其他
    sh: "shell", bat: "bat", ps1: "powershell", dockerfile: "dockerfile",
    sql: "sql", rs: "rust",
    // 纯文本
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

// ---------- 图标体系（D2 P-04：Codicons 单色图标 + 文本徽标，emoji 清零） ----------

/** 生成 Codicon 图标元素（@vscode/codicons，MIT） */
export function codicon(name: string): HTMLElement {
  const el = document.createElement("i");
  el.className = `codicon codicon-${name}`;
  el.setAttribute("aria-hidden", "true");
  return el;
}

/** 品牌蛇形图标（方案 1b）：Python 官方 logo 精确轮廓 · 去眼版。
 *  24px 网格 / currentColor 单色 / 实心填充，采用官方双蛇交织路径（去除眼睛子路径）。
 *  用于 .py 文件图标与状态栏解释器。 */
const SNAKE_BODY =
  '<path fill="currentColor" d="' +
  // 蛇身一（上蛇）
  "M14.25.18l.9.2.73.26.59.3.45.32.34.34.25.34.16.33.1.3.04.26.02.2-.01.13V8.5l-.05.63-.13.55-.21.46-.26.38-.3.31-.33.25-.35.19-.35.14-.33.1-.3.07-.26.04-.21.02H8.77l-.69.05-.59.14-.5.22-.41.27-.33.32-.27.35-.2.36-.15.37-.1.35-.07.32-.04.27-.02.21v3.06H3.17l-.21-.03-.28-.07-.32-.12-.35-.18-.36-.26-.36-.36-.35-.46-.32-.59-.28-.73-.21-.88-.14-1.05-.05-1.23.06-1.22.16-1.04.24-.87.32-.71.36-.57.4-.44.42-.33.42-.24.4-.16.36-.1.32-.05.24-.01h.16l.06.01h8.16v-.83H6.18l-.01-2.75-.02-.37.05-.34.11-.31.17-.28.25-.26.31-.23.38-.2.44-.18.51-.15.58-.12.64-.1.71-.06.77-.04.84-.02 1.27.05z" +
  // 蛇身二（下蛇）：起点位移已并入被去除的眼睛一偏移（-6.3,1.98）→ m6.79 5.93
  "m6.79 5.93l.28.06.32.12.35.18.36.27.36.35.35.47.32.59.28.73.21.88.14 1.04.05 1.23-.06 1.23-.16 1.04-.24.86-.32.71-.36.57-.4.45-.42.33-.42.24-.4.16-.36.09-.32.05-.24.02-.16-.01h-8.22v.82h5.84l.01 2.76.02.36-.05.34-.11.31-.17.29-.25.25-.31.24-.38.2-.44.17-.51.15-.58.13-.64.09-.71.07-.77.04-.84.01-1.27-.04-1.07-.14-.9-.2-.73-.25-.59-.3-.45-.33-.34-.34-.25-.34-.16-.33-.1-.3-.04-.25-.02-.2.01-.13v-5.34l.05-.64.13-.54.21-.46.26-.38.3-.32.33-.24.35-.2.35-.14.33-.1.3-.06.26-.04.21-.02.13-.01h5.84l.69-.05.59-.14.5-.21.41-.28.33-.32.27-.35.2-.36.15-.36.1-.35.07-.32.04-.28.02-.21V6.07h2.09l.14.01z" +
  '"/>';

export const SNAKE_SVG =
  `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">${SNAKE_BODY}</svg>`;

/** 通用空状态元素（D4：图标 + 标题 + 可选说明；compact 用于大纲等窄区域） */
export function emptyState(icon: string, title: string, desc?: string, compact = false): HTMLElement {
  const box = document.createElement("div");
  box.className = compact ? "empty-state compact" : "empty-state";
  box.appendChild(codicon(icon));
  const t = document.createElement("div");
  t.className = "empty-title";
  t.textContent = title;
  box.appendChild(t);
  if (desc) {
    const d = document.createElement("div");
    d.textContent = desc;
    box.appendChild(d);
  }
  return box;
}

/** 文件图标规格：三选一（codicon 名 / 内联 SVG / 文本徽标）+ 可选着色 */
export interface FileIconSpec {
  codicon?: string;
  svg?: string;
  text?: string;
  color?: string;
}

/** 文件类型图标（按扩展名差异化；D2：emoji 全部替换为 codicon / SVG / 文本徽标） */
export function fileIcon(name: string): FileIconSpec {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const base = name.toLowerCase();
  // 特殊文件名
  if (base === "readme.md" || base === "readme") return { codicon: "book", color: "#42a5f5" };
  if (base === "makefile" || base === "justfile") return { codicon: "gear", color: "#ef5350" };
  if (base === "dockerfile") return { codicon: "server-process", color: "#42a5f5" };
  if (base === ".gitignore" || base === ".gitattributes") return { codicon: "circle-slash", color: "#f05033" };
  if (base === "license") return { codicon: "law", color: "#dcdcaa" };
  // 按扩展名
  const map: Record<string, FileIconSpec> = {
    py: { svg: SNAKE_SVG, color: "#3572a5" },
    pyw: { svg: SNAKE_SVG, color: "#3572a5" },
    js: { text: "JS", color: "#f7df1e" },
    ts: { text: "TS", color: "#3178c6" },
    json: { text: "{}", color: "#cbcb41" },
    toml: { codicon: "gear", color: "#9c4221" },
    yml: { codicon: "gear", color: "#cb171e" },
    yaml: { codicon: "gear", color: "#cb171e" },
    md: { codicon: "markdown", color: "#519aba" },
    txt: { text: "≡", color: "#89e051" },
    rs: { text: "Rs", color: "#dea584" },
    html: { text: "<>", color: "#e34c26" },
    htm: { text: "<>", color: "#e34c26" },
    css: { text: "#", color: "#563d7c" },
    scss: { text: "#", color: "#c6538c" },
    sh: { text: ">", color: "#89e051" },
    bat: { text: ">", color: "#c1f12e" },
    ps1: { text: ">", color: "#012456" },
    sql: { codicon: "database", color: "#dad8d8" },
    svg: { codicon: "file-media", color: "#ffb13b" },
    png: { codicon: "file-media", color: "#a074c4" },
    jpg: { codicon: "file-media", color: "#a074c4" },
    jpeg: { codicon: "file-media", color: "#a074c4" },
    gif: { codicon: "file-media", color: "#a074c4" },
    ico: { codicon: "file-media", color: "#cbcb41" },
    lock: { codicon: "lock", color: "#888" },
    cfg: { codicon: "gear", color: "#6d8086" },
    ini: { codicon: "gear", color: "#6d8086" },
    env: { codicon: "key", color: "#faf743" },
  };
  return map[ext] ?? { codicon: "file", color: "#888" };
}

/** 将文件图标渲染为 16px 槽位元素（着色由调用方容器继承） */
export function renderFileIcon(name: string): HTMLElement {
  const spec = fileIcon(name);
  const span = document.createElement("span");
  span.className = "icon";
  if (spec.color) span.style.color = spec.color;
  if (spec.codicon) {
    span.appendChild(codicon(spec.codicon));
  } else if (spec.svg) {
    span.innerHTML = spec.svg; // 常量 SVG，无注入面
  } else {
    span.classList.add("icon-text");
    span.textContent = spec.text ?? "";
  }
  return span;
}

/** 路径拼接（Windows/Unix 通用；rel 支持 pkg/mod.py 嵌套） */
export function joinPath(base: string, rel: string): string {
  const sep = base.includes("/") && !base.includes("\\") ? "/" : "\\";
  return base.replace(/[\\/]+$/, "") + sep + rel.replace(/\//g, sep);
}

/** 取父目录路径 */
export function parentDirOf(p: string): string {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx <= 0 ? p : p.slice(0, idx);
}

/** 确保 Python 文件扩展名：无 .py/.pyw 时补 .py（支持 pkg/mod 相对路径） */
export function ensurePyExtension(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".py") || lower.endsWith(".pyw")) return name;
  return name + ".py";
}

/** 剥离 Python 文件扩展名（.py/.pyw → 无后缀）；供建包名归一化使用 */
export function stripPyExtension(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pyw")) return name.slice(0, -4);
  if (lower.endsWith(".py")) return name.slice(0, -3);
  return name;
}

/** 计算相对路径（用于 git 状态匹配） */
export function relativePath(root: string, full: string): string {
  if (!full.startsWith(root)) return full;
  return full.slice(root.length).replace(/^[\\/]/, "").replace(/\\/g, "/");
}

/** Git 状态码 → 可读描述 */
export function gitStatusLabel(code: string): string {
  const map: Record<string, string> = {
    M: "已修改", A: "已暂存（新增）", D: "已删除",
    R: "已重命名", "?": "未跟踪", "!": "冲突",
  };
  return map[code] ?? code;
}

/** 展示状态码 → badge CSS class（?/! 映射为合法 class 名） */
export function gitBadgeClass(code: string): string {
  const map: Record<string, string> = {
    M: "m", A: "a", D: "d", R: "r", "?": "u", "!": "conflict",
  };
  return `git-badge git-${map[code] ?? "m"}`;
}

/** git 输出行着色（用于 commit 详情、blame 等） */
export function gitLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-meta";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "stdout";
}

/** 大纲符号 kind → codicon 图标名（D2：替换单字符图标） */
export function symbolIcon(kind: number): string {
  switch (kind) {
    case 5: return "symbol-class";
    case 6: case 12: case 9: return "symbol-method"; // method/function/constructor
    case 13: return "symbol-variable";
    case 14: return "symbol-constant";
    case 7: return "symbol-property";
    case 8: return "symbol-field";
    case 2: return "symbol-namespace"; // module
    default: return "symbol-misc";
  }
}