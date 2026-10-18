/**
 * 真机体验度量脚本（M0「先度量后动手」）—— 用数字回答「体验优化该先做什么」。
 *
 * 与既有指标采集的分工：
 *   - bench/collect-metrics.ps1：进程级冷启动/内存（窗口句柄出现即停表，不含前端交互）；
 *   - 本脚本：**端到端旅程时延**（CDP 驱动真实 UI），指标全部取「用户可感知」的时刻：
 *
 *   T1  CDP 可连接（进程+WebView 起）          —— 与 collect-metrics 的窗口句柄口径互补
 *   T2  窗口可交互（menubar 挂载）
 *   T3  工作区文件树可见（含首个 tab 恢复）
 *   T4  静态引擎就绪（.lsp-dot.dot-ready，含 index）
 *   T5  文件可编辑（点进编辑器 + 输入首字符落 DOM）
 *   T6  首次补全弹出（键入 time. → .suggest-widget 可见）
 *   T7  首条诊断红波浪线（缺 import → .squiggly-error）
 *   T8  Search Everywhere 首开（Double Shift → #quick-open-modal 输入框可见）
 *   T9  双击词选中时延（关键词选中样式出现）
 *
 * 指标口径纪律（对齐 bench/reports/probe-overhead-caliber.md 的教训）：
 *   - 每指标输出 median / p90 / min / max / 样本数，并显式标注口径；
 *   - ⚠ dev 与 release 不可比（vite dev server 首次编译/按需加载会污染前端指标）——
 *     默认跑 dev（快、免构建），release 对比另跑 OC_MODE=release 并明确标注；
 *   - 逐键补全/诊断时延受机器负载与索引状态影响，采样前预热（打开文件 → 等引擎就绪
 *     → 等索引 3s），且「首次触发」与「预热后触发」分开记录（首次含引擎冷态，属真实体验）。
 *
 * 用法：cd shell && node e2e-real/metrics-real.cjs
 * 环境变量：OC_CDP_PORT(9225) / OC_CDP_TIMEOUT(300) / OC_MODE=dev|release
 *          / OC_REAL_PYTHON（解释器）/ OC_METRICS_OUT（报告路径，默认 %TEMP%\montauri-metrics\）
 *          / OC_KEEP_APP=1
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');
const {
  sleep, portInUse, waitCdpReadyWatched, startAppWatchdog,
  gitHead, presetInterpreter, presetRecentWorkspaces, dismissBlockingModals,
  record, results, printSummary, writeJsonSummary,
} = require('./lib/real-env.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const MODE = (process.env.OC_MODE || 'dev').toLowerCase(); // dev | release
const CDP_PORT = Number(process.env.OC_CDP_PORT || 9225);
const CDP_TIMEOUT_MS = Number(process.env.OC_CDP_TIMEOUT || 300) * 1000;
const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'python';
const OUT_DIR = process.env.OC_METRICS_OUT || path.join(os.tmpdir(), 'montauri-metrics');
const DEV_URL_HOST = 'localhost:5173';
const BUILD_EXE = path.join(REPO, 'shell', 'src-tauri', 'target', 'release', 'montauri-shell.exe');

// 工作区内容：一个有错误 import 的文件（触发 T7 诊断）+ 干净文件（T5/T6 编辑与补全）
const FILES = {
  'main.py': 'import json\n\n\ndef main():\n    print(json.dumps({"a": 1}))\n\n\nif __name__ == "__main__":\n    main()\n',
  'with_error.py': 'import missing_module_xyz\nimport os\n\n\ndef broken():\n    return missing_module_xyz.thing(os.getcwd())\n',
};
const pyproject = '[project]\nname = "metrics-real-bench"\nversion = "0.1.0"\nrequires-python = ">=3.12"\ndependencies = []\n';

// —— 指标采集（非断言，全部记录不判 FAIL）——
const metrics = [];
// [init]/[openWorkspace] 打点缓存（T3 拆解数据源；在 try 块内填充）
const marks = [];
function measure(id, desc, ms, note) {
  metrics.push({ id, desc, ms, note: note || '' });
  console.log(`  METRIC ${id.padEnd(6)} ${String(Math.round(ms)).padStart(7)} ms  ${desc}${note ? `  (${note})` : ''}`);
}
function stats(vals) {
  const v = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  const p90 = v[Math.min(v.length - 1, Math.ceil(v.length * 0.9) - 1)];
  return { n: v.length, min: v[0], median, p90, max: v[v.length - 1] };
}
function fmtStat(s) {
  return `n=${s.n} median=${Math.round(s.median)}ms p90=${Math.round(s.p90)}ms min=${Math.round(s.min)}ms max=${Math.round(s.max)}ms`;
}

(async () => {
  // ---------- 预检 ----------
  for (const [p, why] of [[REAL_PYTHON, '解释器不存在（用 OC_REAL_PYTHON 指定）']]) {
    if (!fs.existsSync(p)) { console.error(`[预检失败] ${p} —— ${why}`); process.exit(2); }
  }
  if (await portInUse(CDP_PORT)) { console.error(`[预检失败] CDP 端口 ${CDP_PORT} 被占用`); process.exit(2); }
  if (MODE === 'dev' && await portInUse(5173)) {
    console.error('[预检失败] 5173 已被占用（可能已有 vite / tauri dev 在跑）'); process.exit(2);
  }
  if (MODE === 'release' && !fs.existsSync(BUILD_EXE)) {
    console.error(`[预检失败] release exe 不存在：${BUILD_EXE}（先跑 build-release.ps1）`); process.exit(2);
  }

  // ---------- fixture ----------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-metrics-real-'));
  const workspace = path.join(tmp, 'workspace');
  const dataRoot = path.join(tmp, 'data-root');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  for (const [name, content] of Object.entries(FILES)) {
    fs.writeFileSync(path.join(workspace, name), content, 'utf8');
  }
  fs.writeFileSync(path.join(workspace, 'pyproject.toml'), pyproject, 'utf8');
  presetInterpreter(dataRoot, workspace, REAL_PYTHON);
  presetRecentWorkspaces(dataRoot, [workspace]);
  console.log(`[环境] mode=${MODE} 工作区=${workspace} 数据根=${dataRoot}`);

  // ---------- 启动 ----------
  const logPath = path.join(__dirname, `.metrics-real-${MODE}.log`);
  const logFd = fs.openSync(logPath, 'w');
  const env = {
    ...process.env,
    MONTAURI_DATA_ROOT: dataRoot,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
  };
  let child;
  let t0;
  if (MODE === 'release') {
    console.log('[启动] release exe + CDP …');
    child = spawn(BUILD_EXE, [], { cwd: path.dirname(BUILD_EXE), env, stdio: ['ignore', logFd, logFd] });
  } else {
    console.log('[启动] npm run tauri dev（日志落盘）…');
    child = spawn('cmd.exe', ['/c', 'npm', 'run', 'tauri', 'dev'], {
      cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', logFd, logFd], env,
    });
  }

  let browser = null;
  let stopWatchdog = null;
  try {
    t0 = Date.now();
    await waitCdpReadyWatched(CDP_PORT, CDP_TIMEOUT_MS, { child, logPath });
    const t1 = Date.now() - t0;
    measure('T1', 'CDP 可连接（进程 + WebView 起）', t1, MODE);

    const { chromium } = require(path.join(REPO, 'shell', 'node_modules', 'playwright-core'));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    stopWatchdog = startAppWatchdog({ child, cdpPort: CDP_PORT, suite: 'metrics-real' });
    const pages = [];
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) pages.push(p);
    // release 下 WebView2 加载 Tauri 自定义协议（http://tauri.localhost/），dev 才是 vite 5173
    const urlMatch = MODE === 'release' ? 'tauri' : DEV_URL_HOST;
    const page = pages.find((p) => p.url().includes(urlMatch)) || pages[0];
    if (!page) throw new Error('未找到主窗口 page');

    // 收集 [init]/[openWorkspace] 打点（console.debug；T3 拆解数据源——CDP 连上后的才收得到，
    // T1 阶段的打点已丢失可接受，T2 起的段落完整覆盖 4.5s 嫌疑区）
    page.on('console', (m) => {
      const txt = m.text();
      if (m.type() === 'debug' && (/^\[init\]/.test(txt) || /^\[openWorkspace\]/.test(txt))) {
        marks.push(txt);
      }
    });

    // T2 窗口可交互：menubar 挂载（index.html 是 id=menubar 的 <nav>，无 .menubar 类）
    await page.locator('#menubar').first().waitFor({ state: 'attached', timeout: 60_000 });
    const t2 = Date.now() - t0;
    measure('T2', '窗口可交互（menubar 挂载）', t2, MODE);
    await dismissBlockingModals(page);

    // T3 工作区恢复：文件树可见 main.py
    await page.locator('#tree .tree-item .name', { hasText: 'main.py' }).first()
      .waitFor({ timeout: 60_000 });
    const t3 = Date.now() - t0;
    measure('T3', '工作区文件树可见（会话恢复完成）', t3, MODE);

    // T4 静态引擎就绪：.lsp-dot.dot-ready（对 i18n 文本免疫；引擎在 openWorkspace 即启动）
    await page.locator('.lsp-dot.dot-ready').first().waitFor({ timeout: 120_000 });
    const t4 = Date.now() - t0;
    measure('T4', '静态引擎就绪（pyrefly ready，含 initialize 握手）', t4, MODE);

    // T5 文件可编辑：双击打开 main.py（tab 恢复可能已打开过，此处为「用户动作」口径）→ 点进编辑器 → 输入首字符
    await page.locator('#tree .tree-item .name', { hasText: 'main.py' }).first().dblclick();
    await page.locator('.monaco-editor').first().waitFor({ timeout: 60_000 });
    await page.locator('.monaco-editor').first().click(); // 点进编辑器拿焦点（dblclick 打开不抢焦点）
    const t5Start = Date.now();
    await page.keyboard.type('x', { delay: 0 });
    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('.monaco-editor .view-lines .view-line');
      const last = lines[lines.length - 1];
      return !!(last && /x/.test(last.textContent || ''));
    }, undefined, { timeout: 15_000 });
    const t5 = Date.now() - t5Start;
    measure('T5', '编辑器可编辑（输入首字符渲染上屏）', t5);
    await page.keyboard.press('Backspace');

    // —— 预热：等 pyrefly 后台索引（lazy-non-blocking，首个文件打开后才开始）——
    await sleep(3000);

    // T6 补全首弹：文件末尾新行键入 `json.` → .suggest-widget
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    const t6Start = Date.now();
    await page.keyboard.type('json.', { delay: 0 });
    let suggestOk = true;
    try {
      await page.locator('#editor .suggest-widget').first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    } catch { suggestOk = false; }
    const t6 = Date.now() - t6Start;
    if (suggestOk) {
      measure('T6', '首次补全弹出（json. → suggest-widget）', t6, '首次含引擎冷态');
    } else {
      record('T6', '首次补全弹出', false, '30s 超时未弹出（计入 FAIL 而非 METRIC）');
    }
    await page.keyboard.press('Escape');
    await sleep(300);

    // T6w 补全暖态：再触发 5 次（引擎已热）。清输入用 Home+Shift+End 全选后重打，
    // 不用 Backspace 逐字符删（次数与残留字符数耦合，曾把 json. 删成 jsonjson.）
    const warm = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+End');
      await page.keyboard.type('json.', { delay: 0 });
      const tw = Date.now();
      let ok = true;
      try {
        await page.locator('#editor .suggest-widget').first()
          .waitFor({ state: 'visible', timeout: 10_000 });
      } catch { ok = false; }
      const ms = Date.now() - tw;
      if (ok) warm.push(ms);
      else console.log(`  [T6w ${i + 1}] 超时（>10s），弃样本`);
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    if (warm.length) {
      const s = stats(warm);
      measure('T6w', '补全暖态时延（预热后 5 次采样）', s.median, fmtStat(s));
    }

    // T7 诊断出现：双击打开 with_error.py 起计时 → 首条 .squiggly-error
    // （旧口径在 tab 渲染后才起表，诊断早已到达——5ms 是假象）
    const t7Start = Date.now();
    await page.locator('#tree .tree-item .name', { hasText: 'with_error.py' }).first().dblclick();
    await page.locator('#editor .squiggly-error').first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    const t7 = Date.now() - t7Start;
    measure('T7', '首条诊断红波浪线（双击打开 → squiggly-error 可见）', t7, '从双击起计时');

    // T8 Search Everywhere 首开：Double Shift = 两次 Shift keyup 间隔 <400ms（windowKeys.ts:137-146）
    const t8Start = Date.now();
    await page.keyboard.press('Shift');
    await sleep(100);
    await page.keyboard.press('Shift');
    await page.locator('#quick-open-modal input').first()
      .waitFor({ state: 'visible', timeout: 15_000 });
    const t8 = Date.now() - t8Start;
    measure('T8', 'Search Everywhere 首开（Double Shift）', t8);
    await page.keyboard.press('Escape');
    await sleep(200);

    // T9 双击词选中：矩形中心双击法（e2e/dx/09 先例——span 过滤定位曾点不中目标）
    const wordCenter = await page.evaluate(() => {
      const spans = document.querySelectorAll('#editor .view-line span[class*="mtk"]');
      for (const s of spans) {
        const r = document.createRange();
        r.selectNodeContents(s);
        if ((s.textContent || '').includes('missing_module_xyz')) {
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
      }
      return null;
    });
    if (wordCenter) {
      await page.locator('.monaco-editor').first().click(); // 确保焦点在编辑器（T8 弹窗关闭后焦点悬空）
      const t9Start = Date.now();
      await page.mouse.dblclick(wordCenter.x, wordCenter.y);
      await page.locator('#editor .selected-text').first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      const t9 = Date.now() - t9Start;
      measure('T9', '双击词选中（.selected-text 出现）', t9);
    } else {
      record('T9', '双击词选中', false, '未找到目标词的渲染矩形');
    }
  } catch (e) {
    console.error('[运行中断]', e.message || e);
    record('RUN', '度量流程完整性', false, String(e.message || e));
  } finally {
    if (stopWatchdog) stopWatchdog();
    if (browser) await browser.close().catch(() => {});
    console.log('[清理] taskkill 进程树…');
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
  }

  // ---------- 报告落盘（系统 TEMP，避开工作区 safe-delete 门槛）----------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 17);
  const reportPath = path.join(OUT_DIR, `metrics-real-${MODE}-${stamp}.json`);
  const payload = {
    schema: 'montauri-metrics-real/1',
    mode: MODE,
    at: new Date().toISOString(),
    headCommit: gitHead(),
    workspace: 'tmp:2py+pyproject',
    metrics,
    marks,
    notes: [
      'dev 与 release 不可比（vite dev server 首次编译/按需加载会污染前端指标）',
      'T4 口径：.lsp-dot.dot-ready，引擎在 openWorkspace 即启动（main.ts:341），不含文件打开',
      'T6 首次含引擎冷态；T6w 为预热后 5 次采样 median',
      '机器负载与索引状态影响绝对值；跨次对比须同机同负载，优先看相对排序',
    ],
  };
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== 度量结果（mode=${MODE}）=====`);
  for (const m of metrics) {
    console.log(`  ${m.id.padEnd(5)} ${String(Math.round(m.ms)).padStart(7)} ms  ${m.desc}${m.note ? `  (${m.note})` : ''}`);
  }
  if (marks.length) {
    console.log('\n----- T3 拆解打点（[init]/[openWorkspace] console.debug）-----');
    for (const m of marks) console.log(`  ${m}`);
  }
  console.log(`[报告] ${reportPath}`);
  writeJsonSummary({ suite: 'metrics-real', durationMs: Date.now() - t0 });
  const failed = results.length ? results.filter((r) => !r.ok).length : 0;
  printSummary(`真机体验度量（mode=${MODE}）`, false);
  process.exit(failed > 0 ? 1 : 0);
})();
