// B 组覆盖核对探针（docs/context_awareness_dev_plan.md §9 B1~B4）
//
// 用法：node bench/context-coverage-probe/probe.cjs [pyrefly|basedpyright]
// 输出：bench/reports/context-coverage-probe-<engine>.json + stdout 摘要
//
// 口径（照 pydantic-probe 的踩坑先例）：
// - 引擎必须走 ci/versions.toml 锁定版：`uv tool run pyrefly@1.4.0 lsp` /
//   `uv tool run --from basedpyright@1.39.10 basedpyright-langserver --stdio`
//   （显式钉版保证其他机器/CI 可复现，不依赖本机 PATH 上装的版本）；
// - 必须响应服务端请求（basedpyright 不响应配置请求会挂起，P1-BUG-001）；
// - 进程 cwd = 受控项目根（pyrefly 靠 cwd 发现 pyproject.toml 才建工作区索引）；
// - pyrefly 是 lazy 索引：每个场景重试若干轮取「条数最多」的一次，避免把
//   「还没索引完」误判成「引擎不支持」。

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "sample", "context_coverage");
const FILES = ["target.py", "helpers.py", "imports.py", "raises.py", "keys.py"];
const ENGINE = (process.argv[2] || "pyrefly").toLowerCase();

const PY_CANDIDATES = [
  process.env.OC_REAL_PYTHON,
  "D:\\py\\python.exe",
  "C:\\Users\\tom\\.local\\bin\\python3.13.exe",
].filter(Boolean);
const PYTHON = PY_CANDIDATES.find((p) => fs.existsSync(p)) || undefined;

const ENGINES = {
  pyrefly: {
    command: "uv",
    args: ["tool", "run", "pyrefly@1.4.0", "lsp"],
    label: "pyrefly 1.4.0",
  },
  basedpyright: {
    command: "uv",
    args: [
      "tool",
      "run",
      "--from",
      "basedpyright@1.39.10",
      "basedpyright-langserver",
      "--stdio",
    ],
    label: "basedpyright 1.39.10",
  },
};

const SCENARIOS = [
  { id: "B1", marker: "@B1", desc: "self. 成员（类内，参数有注解）", expect: ["name", "email", "display"] },
  { id: "B1b", marker: "@B1b", desc: "self. 成员（类内，参数无注解）", expect: ["name", "email"] },
  { id: "B2", marker: "@B2", desc: "多级属性链 self.customer.（属性有注解）", expect: ["name", "email", "display"] },
  { id: "B2b", marker: "@B2b", desc: "多级属性链 self.customer.（属性无注解）", expect: ["name", "email"] },
  { id: "B3", marker: "@B3", desc: "函数内局部变量前缀 cb_", expect: ["cb_url"] },
  { id: "B3b", marker: "@B3b", desc: "模块级变量前缀 module_le", expect: ["module_level_url"] },
  { id: "B4", marker: "@B4", desc: "import 别名 js.（json as js）", expect: ["loads", "dumps", "load", "dump"] },
  { id: "A1", file: "imports.py", marker: "@A1", desc: "import 位置模块名（前缀 coll）", expect: ["collections"] },
  { id: "A2", file: "imports.py", marker: "@A2", desc: "from 标准库 import 成员（前缀 lo）", expect: ["loads"] },
  { id: "A2b", file: "imports.py", marker: "@A2b", desc: "from 工作区模块 import 成员（前缀 pa）", expect: ["parse_page"] },
  { id: "A3", file: "raises.py", marker: "@A3", desc: "raise 位置异常类型（前缀 Val）", expect: ["ValueError"] },
  { id: "A7", file: "keys.py", marker: "@A7", form: "quoted", desc: "容器方法键（TypedDict 有类型）", expect: ["url", "title"] },
  { id: "A7b", file: "keys.py", marker: "@A7b", form: "quoted", desc: "容器方法键（无类型变量）", expect: ["url", "title"] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uriOf = (f) => "file:///" + path.join(ROOT, f).replace(/\\/g, "/");
const ROOT_URI = "file:///" + ROOT.replace(/\\/g, "/");

const info = ENGINES[ENGINE];
if (!info) {
  console.error(`未知引擎：${ENGINE}（可选 pyrefly / basedpyright）`);
  process.exit(1);
}

const child = spawn(info.command, info.args, {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32",
});

let buf = Buffer.alloc(0);
const pending = new Map();
const diags = new Map();
let serverCapabilities = null;
let stderrTail = "";
let nextId = 1;

child.stderr.on("data", (c) => {
  stderrTail = (stderrTail + c.toString("utf8")).slice(-2000);
});

child.stdout.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx < 0) return;
    const header = buf.slice(0, idx).toString("ascii");
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) {
      buf = buf.slice(idx + 4);
      continue;
    }
    const len = Number(m[1]);
    if (buf.length < idx + 4 + len) return;
    const body = buf.slice(idx + 4, idx + 4 + len).toString("utf8");
    buf = buf.slice(idx + 4 + len);
    try {
      handle(JSON.parse(body));
    } catch {
      /* 忽略无法解析的帧 */
    }
  }
});

function send(msg) {
  const s = JSON.stringify(msg);
  child.stdin.write(Buffer.from(`Content-Length: ${Buffer.byteLength(s, "utf8")}\r\n\r\n${s}`, "utf8"));
}

function sendRequest(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} 超时（${timeoutMs / 1000}s）`));
      }
    }, timeoutMs);
  });
}

function sendNotification(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function handle(msg) {
  // 服务端 → 客户端请求：一律给合法响应，避免引擎等待（basedpyright 会挂起）
  if (msg.id !== undefined && msg.id !== null && msg.method) {
    let result = null;
    if (msg.method === "workspace/configuration") {
      const items = Array.isArray(msg.params?.items) ? msg.params.items : [];
      result = items.map((it) => (it?.section === "python" ? { pythonPath: PYTHON } : null));
    }
    send({ jsonrpc: "2.0", id: msg.id, result });
    return;
  }
  if (msg.id !== undefined && msg.id !== null) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
    return;
  }
  if (msg.method === "textDocument/publishDiagnostics") {
    const name = String(msg.params?.uri || "").split("/").pop();
    diags.set(name, msg.params?.diagnostics || []);
  }
}

/** 按行内标记定位补全位置（不写死行列号）：代码段末尾，`#` 之后的内容忽略 */
function positionOf(text, marker) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(marker)) continue;
    const hash = lines[i].indexOf("#");
    const code = (hash >= 0 ? lines[i].slice(0, hash) : lines[i]).replace(/\s+$/, "");
    return { line: i, character: code.length };
  }
  throw new Error(`标记未找到：${marker}`);
}

/**
 * 标签分类（判定精度的关键，2026-10-12 修正）：
 * - `'url'` / `"url"` → quoted：**键字面量**候选（键补全的唯一有效形态）；
 * - `key=` / `url=`   → kw：**关键字参数建议**，不是键，不能算命中；
 * - 其余             → bare：普通符号/成员名。
 * 旧版只剥尾部 `=`，导致「`url=` 误判为键命中」与「`'url'` 被漏判」两个方向都错。
 */
function classify(label) {
  const s = String(label).trim();
  const q = /^(['"])([\s\S]*)\1$/.exec(s);
  if (q) return { kind: "quoted", name: q[2] };
  if (s.endsWith("=")) return { kind: "kw", name: s.slice(0, -1) };
  return { kind: "bare", name: s };
}

/** form="quoted" 只认键字面量；缺省只认 bare（kw 一律不算命中） */
function hitOf(labels, exp, form) {
  return labels.some((l) => {
    const c = classify(l);
    if (form === "quoted") return c.kind === "quoted" && c.name === exp;
    return c.kind === "bare" && (c.name === exp || c.name.startsWith(exp));
  });
}

/** 带重试的补全（pyrefly lazy 索引）：取「期望全中」或「条数最多」的一次 */
async function completeAt(file, pos, expect, form) {
  let best = { total: -1, labels: [], error: null };
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await sendRequest("textDocument/completion", {
        textDocument: { uri: uriOf(file) },
        position: pos,
        context: { triggerKind: 1 },
      });
      const items = Array.isArray(res) ? res : res?.items || [];
      const labels = items.map((it) => String(it.label));
      if (labels.length > best.total) best = { total: labels.length, labels, error: null };
      if (expect.every((e) => hitOf(labels, e, form))) break;
    } catch (e) {
      best.error = String(e.message || e);
    }
    await sleep(1200);
  }
  return best;
}

async function main() {
  const init = await sendRequest(
    "initialize",
    {
      processId: process.pid,
      clientInfo: { name: "opencharm-context-coverage-probe", version: "1.0" },
      rootUri: ROOT_URI,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          completion: {
            completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] },
          },
          hover: { contentFormat: ["markdown", "plaintext"] },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: {} },
      },
      initializationOptions: { pythonPath: PYTHON },
      workspaceFolders: [{ uri: ROOT_URI, name: "context_coverage" }],
    },
    60000,
  );
  serverCapabilities = init?.capabilities || null;
  sendNotification("initialized", {});

  const texts = {};
  for (const f of FILES) {
    texts[f] = fs.readFileSync(path.join(ROOT, f), "utf8");
    sendNotification("textDocument/didOpen", {
      textDocument: { uri: uriOf(f), languageId: "python", version: 1, text: texts[f] },
    });
  }

  // 等首次诊断（索引就绪信号）或 15s
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && !diags.has("target.py")) await sleep(300);

  const results = [];
  for (const s of SCENARIOS) {
    const file = s.file || "target.py";
    const pos = positionOf(texts[file], s.marker);
    const r = await completeAt(file, pos, s.expect, s.form);
    const hits = s.expect.filter((e) => hitOf(r.labels, e, s.form));
    results.push({
      id: s.id,
      file,
      desc: s.desc,
      position: pos,
      total: r.total < 0 ? 0 : r.total,
      hits,
      missing: s.expect.filter((e) => !hits.includes(e)),
      verdict: hits.length === s.expect.length ? "HIT" : hits.length ? "PARTIAL" : "MISS",
      labelsTop: r.labels.slice(0, 12),
      error: r.error,
    });
    console.log(
      `[${s.id}] ${r.total < 0 ? 0 : r.total} 项 · ${results[results.length - 1].verdict}` +
        ` · 命中 ${hits.join("/") || "-"}${r.error ? ` · 错误 ${r.error}` : ""}`,
    );
  }

  const report = {
    engine: info.label,
    engineCmd: `${info.command} ${info.args.join(" ")}`,
    python: PYTHON || null,
    generatedAt: new Date().toISOString(),
    diagnosticsReady: FILES.filter((f) => diags.has(f)),
    completionProvider: serverCapabilities?.completionProvider || null,
    scenarios: results,
    stderrTail,
  };
  const outDir = path.resolve(__dirname, "..", "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `context-coverage-probe-${ENGINE}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n报告：${outPath}`);

  try {
    await sendRequest("shutdown", null, 10000);
    sendNotification("exit", null);
  } catch {
    /* 引擎退出竞态，忽略 */
  }
  await sleep(500);
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(`探针失败：${e.message}`);
  if (stderrTail) console.error(`引擎 stderr 尾部：\n${stderrTail}`);
  child.kill();
  process.exit(1);
});
