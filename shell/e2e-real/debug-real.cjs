/**
 * 调试功能真机（Real App）CDP 验收脚本 — R-REAL-1..8
 * （R-REAL-5 校验空局部帧空态；R-REAL-7 校验真局部变量 a/b——停在函数首行时局部变量
 *   尚未赋值，pydevd 返回 {"variables":[]} 属 Python 语义，mock 罐头数据掩盖了这一点）
 *
 * 与 e2e/（浏览器 + Tauri mock）分层：本脚本驱动 **真实 Tauri 应用 + 真实 debugpy**
 * （tauri dev 模式），验证 mock 层验证不了的链路：
 *   Rust spawn stdio adapter → 真 debugpy 握手 → 真 debuggee 断点暂停/步进 → 停止后进程树无残留。
 *
 * 用法（仓库根或 shell/ 下）：
 *   cd shell
 *   node e2e-real/debug-real.cjs
 *
 * 前置：
 *   - vendor/debugpy 已就位（tools/fetch-debugpy.ps1）；
 *   - 5173 / 9223 端口空闲（脚本会预检并 fail fast）；
 *   - 本机有可用 Python 解释器（调试 debuggee 需要）。
 *
 * 环境变量：
 *   OC_CDP_PORT     WebView2 CDP 端口（默认 9223）
 *   OC_CDP_TIMEOUT  等待 CDP 就绪秒数（默认 600，首次 cargo build 较慢可调大）
 *   OC_KEEP_APP=1   结束后不杀应用（保留现场人工检查；临时目录同样保留）
 *
 * 实现要点（沿 M4 运行验收既有经验）：
 *   - 隔离数据根 OPENCHARM_DATA_ROOT + 预置 config/recent-workspaces.json（Node 写入天然无 BOM，
 *     规避 PS Set-Content 带 BOM 被 serde 静默拒读的坑）；
 *   - WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port> 打开 CDP；
 *   - Playwright connectOverCDP 驱动真实窗口；断点用 dev 钩子 __OC_DEBUG_TEST__
 *     （仅 vite dev 注入，与 e2e 同一 toggleBreakpoint 逻辑），规避 headless 外真机窗口
 *     glyph-margin 像素点击抖动；真实 gutter 点击已在 e2e D-FUNC-1 覆盖；
 *   - 结束 taskkill /T /F 清进程树（cargo/vite/应用一并回收）。
 */
'use strict';

const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, openSync } = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CDP_PORT = Number(process.env.OC_CDP_PORT || 9223);
const CDP_TIMEOUT_MS = Number(process.env.OC_CDP_TIMEOUT || 600) * 1000;
const KEEP_APP = process.env.OC_KEEP_APP === '1';
const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'D:\\py\\python.exe';
const DEV_URL_HOST = 'localhost:5173';

const SCRIPT_PY = [
  'def compute(x):',
  '    y = x + 1',
  '    return y',
  '',
  'def main():',
  '    a = compute(10)',
  '    b = a * 2',
  '    print(a, b)',
  '    return b',
  '',
  'if __name__ == "__main__":',
  '    main()',
  '',
].join('\r\n');

const results = [];
function record(id, desc, ok, detail) {
  results.push({ id, desc, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${desc}${detail ? '\n      -> ' + detail : ''}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
  });
}

function portInUse(port) {
  return httpGet(`http://127.0.0.1:${port}/json/version`).then(() => true, () => false);
}

async function waitCdpReady(port, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await httpGet(`http://127.0.0.1:${port}/json/version`);
      if (r.status === 200) return Date.now() - t0;
    } catch { /* 未就绪继续等 */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`CDP ${port} 在 ${timeoutMs / 1000}s 内未就绪（tauri dev 可能编译失败，见日志尾部）`);
    await sleep(1500);
  }
}

function countPythonProcs() {
  try {
    const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter((l) => /^"python(\w)?\.exe"/i.test(l.trim())).length;
  } catch { return -1; }
}

/**
 * 工作区哈希：对齐 src-tauri/file_ops.rs::project_hash（= probe store.py::project_hash）：
 * sha1( lowercase( strip_verbatim( realpath(root).replace('/','\\') ) ) )[:12]。
 * realpath 变体与书写变体各写一份同内容配置，规避 canonicalize 差异。
 */
function projectHash(root) {
  const norm = (p) => {
    let s = String(p).replace(/\//g, '\\');
    while (s.startsWith('\\\\?\\')) s = s.slice(4);
    return s.toLowerCase();
  };
  const variants = new Set([norm(root)]);
  try { variants.add(norm(require('fs').realpathSync(root))); } catch { /* 目录未建时忽略 */ }
  return [...variants].map((v) => crypto.createHash('sha1').update(v, 'utf8').digest('hex').slice(0, 12));
}

/** 预置工作区解释器（<data_root>/workspaces/<hash>.json，对齐 env_cmds::write_config 形态） */
function presetInterpreter(dataRoot, workspace, interpreter) {
  const dir = path.join(dataRoot, 'workspaces');
  mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({ interpreter });
  for (const h of projectHash(workspace)) writeFileSync(path.join(dir, `${h}.json`), payload, 'utf8');
}

function tail(text, n) { return text.length <= n ? text : '...' + text.slice(-n); }

async function stackText(page) {
  return page
    .evaluate(() => {
      const el = document.getElementById('debug-stack');
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(no #debug-stack)';
    })
    .catch(() => '(evaluate failed)');
}

async function dumpVars(page) {
  return page
    .evaluate(() => {
      const el = document.getElementById('debug-vars');
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(no #debug-vars)';
    })
    .catch(() => '(evaluate failed)');
}

/**
 * 等待栈顶帧停在第 line 行。
 * 真实 debugpy 的 stackTrace source.name 为空（帧 loc 回退为 `:${line}`），栈顶帧文本形如
 * "main :6"；不能像 mock 用例那样断言 "script.py:6"。以「首帧文本以 :line 结尾」为准。
 */
async function waitFrameText(page, line, timeoutMs) {
  try {
    await page.waitForFunction(
      (l) => {
        const el = document.querySelector('#debug-stack .debug-stack-frame');
        if (!el) return false;
        return new RegExp(':' + l + '\\s*$').test(el.textContent.trim());
      },
      String(line),
      { timeout: timeoutMs, polling: 250 },
    );
  } catch (e) {
    const dump = await stackText(page);
    throw new Error(`${String(e).split('\n')[0]} | #debug-stack 实际内容: [${dump}]`);
  }
}

async function dismissBlockingModals(page) {
  // 首启「落位提示」等一次性弹窗（fresh 数据根会触发）：点掉所有可见 modal 按钮放行。
  // 任意选择（默认位置 / 自定义取消）都不影响本次验收。
  for (let i = 0; i < 6; i++) {
    const btns = page.locator('.modal-card:visible .modal-actions button');
    const n = await btns.count().catch(() => 0);
    if (n === 0) return;
    for (let j = 0; j < n; j++) await btns.nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(400);
  }
}

/** 订阅原始 dap-message 事件（Rust → 前端），供 R-REAL-5 失败时核对 debugpy 真实响应 */
async function installDapLogger(page) {
  const reg = await page
    .evaluate(async () => {
      if (window.__dapLog) return 'already';
      window.__dapLog = [];
      const internals = window.__TAURI_INTERNALS__;
      const cb = (ev) => {
        try {
          window.__dapLog.push(ev.payload);
          if (window.__dapLog.length > 300) window.__dapLog.shift();
        } catch { /* 忽略 */ }
      };
      const id = internals.transformCallback(cb, false);
      try {
        const r = await internals.invoke('plugin:event|listen', { event: 'dap-message', target: { kind: 'Any' }, handler: id });
        return 'ok:' + JSON.stringify(r);
      } catch (e2) {
        return 'listen-failed:' + e2;
      }
    })
    .catch((e) => 'evaluate-failed:' + e);
  console.log(`[诊断] DAP 流量监听注册: ${reg}`);
}

async function runChecks(page) {
  // R-REAL-1 工作区自动恢复（隔离数据根 + 预置 recent-workspaces）
  await dismissBlockingModals(page);
  try {
    await page.locator('#tree .tree-item .name', { hasText: 'script.py' }).first().waitFor({ timeout: 60000 });
    record('R-REAL-1', '隔离数据根下工作区自动恢复（文件树可见）', true);
  } catch (e) {
    record('R-REAL-1', '隔离数据根下工作区自动恢复（文件树可见）', false, String(e).split('\n')[0]);
    return;
  }

  // R-REAL-2 打开脚本文件
  await page.locator('#tree .tree-item .name', { hasText: 'script.py' }).first().dblclick();
  try {
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
    record('R-REAL-2', '打开 script.py（Monaco 可编辑）', true);
  } catch (e) {
    record('R-REAL-2', '打开 script.py（Monaco 可编辑）', false, String(e).split('\n')[0]);
    return;
  }

  // R-REAL-3 设断点（dev 钩子 = 真实 gutter 点击同一 toggleBreakpoint 逻辑）
  const hasHook = await page.evaluate(() => typeof window.__OC_DEBUG_TEST__ === 'object' && !!window.__OC_DEBUG_TEST__).catch(() => false);
  if (!hasHook) {
    record('R-REAL-3', 'dev 调试钩子可用（__OC_DEBUG_TEST__）', false, '钩子缺失：非 vite dev 前端？tauri dev 未起 devUrl？');
    return;
  }
  await sleep(800); // 等 tab 激活（app.activeTab 就位）后再下断点
  let bpCount = 0;
  let bpDetail = '';
  for (let i = 0; i < 3 && bpCount !== 2; i++) {
    const listed = await page.evaluate(() => { window.__OC_DEBUG_TEST__.toggleActive(6); window.__OC_DEBUG_TEST__.toggleActive(9); return window.__OC_DEBUG_TEST__.list(); });
    await sleep(500);
    bpCount = await page.locator('.gutter-breakpoint').count();
    bpDetail = `map=${JSON.stringify(listed)} 红点x${bpCount}`;
    if (bpCount !== 2) await sleep(800);
  }
  record('R-REAL-3', '断点红点渲染（6/9 两行）', bpCount === 2, bpDetail);

  // R-REAL-4 启动调试 → 真 debugpy 握手 → 命中断点（真机链路核心项）
  await installDapLogger(page); // 应用已加载完，__TAURI_INTERNALS__ 就位后再订阅原始 DAP 流量
  const pyBefore = countPythonProcs();
  await page.locator('#btn-debug').click();
  try {
    await page.locator('.debug-current-line').first().waitFor({ timeout: 90000 });
    await waitFrameText(page, 6, 30000);
    record('R-REAL-4', '真 debugpy 握手 + 命中断点（当前行高亮 + 栈顶停在 :6）', true);
  } catch (e) {
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    record('R-REAL-4', '真 debugpy 握手 + 命中断点（当前行高亮 + 栈顶 script.py:6）', false,
      String(e).split('\n')[0] + '\n      [输出面板/界面文本尾部] ' + tail(bodyText.replace(/\s+/g, ' '), 600));
    return;
  }

  // R-REAL-5 空局部帧的变量面板：第 6 行（`a = compute(10)` 未执行）时 main 帧还没有任何
  // 局部变量，pydevd 真实返回 {"variables":[]}（Python 语义，非缺陷）——面板应显示空态提示而非空白。
  try {
    await page.locator('#debug-vars').getByText('无局部变量', { exact: false }).first().waitFor({ timeout: 15000 });
    record('R-REAL-5', '空局部帧变量面板显示空态提示（非空白）', true);
  } catch (e) {
    const vars = await dumpVars(page);
    record('R-REAL-5', '空局部帧变量面板显示空态提示（非空白）', false, String(e).split('\n')[0] + ' | #debug-vars: [' + vars + ']');
  }

  // R-REAL-6 单步跳过 → 行推进（真 debugpy next）
  await page.locator('#debug-step-over').click();
  try {
    await waitFrameText(page, 7, 30000);
    record('R-REAL-6', '单步跳过推进到第 7 行', true);
  } catch (e) {
    record('R-REAL-6', '单步跳过推进到第 7 行', false, String(e).split('\n')[0]);
  }

  // R-REAL-7 继续到第二断点（:9 `return b` 前，main 局部已有 a/b）→ 变量面板渲染真局部变量
  await page.locator('#debug-continue').click();
  try {
    await waitFrameText(page, 9, 30000);
    const rows = await page.locator('#debug-vars .debug-var-row').count();
    const hasAB = await page.evaluate(() => {
      const t = (document.getElementById('debug-vars') || {}).innerText || '';
      return t.includes('a') && t.includes('b');
    });
    record('R-REAL-7', '继续命中第二断点（:9）且变量面板渲染真局部变量 a/b', rows >= 2 && hasAB,
      `var-row x${rows} 含a/b=${hasAB} | #debug-vars: [${await dumpVars(page)}]`);
  } catch (e) {
    record('R-REAL-7', '继续命中第二断点（:9）且变量面板渲染真局部变量 a/b', false,
      String(e).split('\n')[0] + ' | #debug-vars: [' + await dumpVars(page) + ']');
  }

  // R-REAL-8 停止清场 + 进程树无残留（D5 真机口径）
  await page.locator('#debug-stop').click();
  let cleared = true, clearDetail = '';
  try {
    await page.locator('.debug-current-line').first().waitFor({ state: 'detached', timeout: 30000 });
  } catch (e) { cleared = false; clearDetail = String(e).split('\n')[0]; }
  await sleep(5000); // 等后台 taskkill /T /F 完成
  const pyAfter = countPythonProcs();
  const noResidue = pyBefore >= 0 && pyAfter >= 0 ? pyAfter <= pyBefore : true;
  record('R-REAL-8', '停止后 UI 清场 + python 进程树无残留',
    cleared && noResidue,
    `current-line 清除=${cleared} python 进程 ${pyBefore} -> ${pyAfter}${clearDetail ? '；' + clearDetail : ''}`);
}

(async () => {
  // —— 预检 ——
  if (await portInUse(5173)) {
    console.error(`[预检失败] 5173 已被占用（可能已有 vite / tauri dev 在跑），请先停掉再运行本脚本。`);
    process.exit(2);
  }
  if (await portInUse(CDP_PORT)) {
    console.error(`[预检失败] CDP 端口 ${CDP_PORT} 已被占用（可能残留上一次会话）。`);
    process.exit(2);
  }
  if (!existsSync(REAL_PYTHON)) {
    console.error(`[预检失败] 解释器不存在: ${REAL_PYTHON}（调试 debuggee 需要真实 Python；用 OC_REAL_PYTHON 指定）`);
    process.exit(2);
  }

  // —— 隔离环境：临时工作区 + 隔离数据根（Node 写文件天然无 BOM） ——
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-debug-real-'));
  const workspace = path.join(tmp, 'workspace');
  const dataRoot = path.join(tmp, 'data-root');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  writeFileSync(path.join(workspace, 'script.py'), SCRIPT_PY, 'utf8');
  // 预置工作区解释器（uv 兜底模式不支持调试，dap.rs fail fast）——
  // 等价于启动后手动「状态栏 → 选择解释器」，让 debug_start 直接走真实 debugpy 链路。
  presetInterpreter(dataRoot, workspace, REAL_PYTHON);
  writeFileSync(
    path.join(dataRoot, 'config', 'recent-workspaces.json'),
    JSON.stringify([workspace]),
    'utf8',
  );
  console.log(`[环境] 工作区: ${workspace}\n[环境] 数据根: ${dataRoot}\n[环境] CDP: http://127.0.0.1:${CDP_PORT}`);

  // —— 启动 tauri dev（日志落盘，失败时打尾部） ——
  const logPath = path.join(__dirname, '.tauri-dev.log');
  const logFd = openSync(logPath, 'w');
  console.log(`[启动] npm run tauri dev（日志: ${logPath}）…`);
  const child = spawn('cmd.exe', ['/c', 'npm', 'run', 'tauri', 'dev'], {
    cwd: path.join(__dirname, '..'),
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      OPENCHARM_DATA_ROOT: dataRoot,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
  });

  let exitCode = 0;
  let browser = null;
  try {
    const waited = await waitCdpReady(CDP_PORT, CDP_TIMEOUT_MS);
    console.log(`[就绪] CDP 已监听（等待 ${Math.round(waited / 1000)}s），连接…`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);

    const ctx = browser.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes(DEV_URL_HOST)) || ctx.pages()[0];
    if (!page) throw new Error('CDP 已连接但未找到应用页面（devUrl=' + DEV_URL_HOST + '）');
    console.log(`[连接] 页面: ${page.url()}`);

    const pageErrors = [];
    const consoleWarns = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') consoleWarns.push(`[${m.type()}] ${m.text()}`);
    });

    await runChecks(page);

    if (pageErrors.length) {
      console.log(`\n[提示] 页面未捕获异常 ${pageErrors.length} 条（不计入失败，仅供排查）:`);
      for (const e of pageErrors.slice(0, 5)) console.log('  - ' + e.split('\n')[0]);
    }
    if (consoleWarns.length) {
      console.log(`\n[提示] console warning/error ${consoleWarns.length} 条（不计入失败，仅供排查）:`);
      for (const e of consoleWarns.slice(0, 30)) console.log('  - ' + e.split('\n')[0]);
    }
  } catch (e) {
    console.error(`\n[运行中断] ${e.message || e}`);
    try {
      const fs = require('fs');
      const log = fs.readFileSync(logPath, 'utf8');
      console.error('—— tauri dev 日志尾部 ——\n' + tail(log, 2000));
    } catch { /* 日志可能尚未生成 */ }
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (!KEEP_APP) {
      console.log('\n[清理] taskkill 进程树…');
      try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
    } else {
      console.log(`\n[保留] 应用未杀（OC_KEEP_APP=1），pid=${child.pid}；临时目录: ${tmp}`);
    }
  }

  // —— 汇总 ——
  console.log('\n========== 真机 CDP 验收结果 ==========');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`--------------------------------------`);
  console.log(`共 ${results.length} 项，失败 ${failed} 项${KEEP_APP ? '（应用保留运行中）' : ''}`);
  process.exit(exitCode || (failed > 0 ? 1 : 0));
})();
