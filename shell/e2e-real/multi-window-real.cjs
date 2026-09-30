/**
 * 多窗口真机（Real App）CDP 验收脚本 — MC-REAL-1..7
 * （多窗口计划 docs/multi_window_dev_plan.md §5.4 真实双窗口场景自动化版）
 *
 * 思路（用户建议）：不方便操作系统文件夹选择框，故：
 *   - 隔离数据根 + 预置 config/recent-workspaces.json，让主窗口启动自动恢复【项目 A】；
 *   - 用页面内 `window.__TAURI_INTERNALS__.invoke('open_workspace_window', {path})`
 *     直接调用后端命令打开【项目 B】的新窗口（等价「在新窗口打开」，绕过 pick_folder）。
 *
 * 判定重点（复现/回归「新窗口啥都做不了」问题）：
 *   MC-REAL-4 新窗口文件树是否渲染 = 新窗口前端 init() 是否真正跑通；
 *   MC-REAL-6 新窗口 win-close 是否可关 = init() 是否执行到标题栏接线。
 *
 * 用法（shell/ 下）：
 *   node e2e-real/multi-window-real.cjs
 *
 * 环境变量：
 *   OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP   同 debug-real.cjs
 */
'use strict';

const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, openSync } = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CDP_PORT = Number(process.env.OC_CDP_PORT || 9224);
const CDP_TIMEOUT_MS = Number(process.env.OC_CDP_TIMEOUT || 600) * 1000;
const KEEP_APP = process.env.OC_KEEP_APP === '1';
const DEV_URL_HOST = 'localhost:5173';
const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'D:\\py\\python.exe';

// 调试独立性的最小脚本：断点停在 :6（a = compute(10) 之前）即可判断「命中」，
// 不验证局部变量（那是 debug-real 的口径，这里只验双窗口调试会话不互杀）。
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

function tail(text, n) { return text.length <= n ? text : '...' + text.slice(-n); }

/** 遍历所有 context 的所有 page（多窗口可能落在不同 WebView2 context） */
function allPages(browser) {
  const out = [];
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) out.push(p);
  }
  return out;
}

async function dismissBlockingModals(page) {
  for (let i = 0; i < 8; i++) {
    const btns = page.locator('.modal-card:visible .modal-actions button');
    const n = await btns.count().catch(() => 0);
    if (n === 0) return;
    for (let j = 0; j < n; j++) await btns.nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(400);
  }
}

/** 收集页面的未捕获异常 + console error/warning，供失败时诊断 */
function attachDiagnostics(page, label) {
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  return logs;
}

async function treeNames(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#tree .tree-item .name'))
      .map((n) => n.textContent || '')
      .filter(Boolean)
      .slice(0, 40),
  );
}

async function waitLspStatus(page, needle, timeoutMs) {
  await page.waitForFunction(
    (n) => (document.querySelector('#status-lsp')?.textContent || '').includes(n),
    needle,
    { timeout: timeoutMs },
  );
}

/** 工作区哈希：对齐 src-tauri/file_ops.rs::project_hash（sha1[:12]） */
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

/** 预置工作区解释器（<data_root>/workspaces/<hash>.json，对齐 env_cmds 形态） */
function presetInterpreter(dataRoot, workspace, interpreter) {
  const dir = path.join(dataRoot, 'workspaces');
  mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({ interpreter });
  for (const h of projectHash(workspace)) writeFileSync(path.join(dir, `${h}.json`), payload, 'utf8');
}

/** 读取当前窗口活动终端的 xterm 文本（压缩空白） */
async function termText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.terminal-view:not(.hidden) .xterm-rows');
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '(no rows)';
  });
}

async function runChecks(browser) {
  // 主窗口 = 启动时已有的第一个页面
  let pages = allPages(browser);
  const main = pages.find((p) => p.url().includes(DEV_URL_HOST)) || pages[0];
  const mainDiag = attachDiagnostics(main, 'main');
  await dismissBlockingModals(main);

  // MC-REAL-1 主窗口恢复项目 A
  try {
    await main.locator('#tree .tree-item .name', { hasText: 'a_project.py' }).first().waitFor({ timeout: 60000 });
    record('MC-REAL-1', '主窗口恢复项目 A（文件树可见 a_project.py）', true);
  } catch (e) {
    record('MC-REAL-1', '主窗口恢复项目 A（文件树可见 a_project.py）', false,
      String(e).split('\n')[0] + ' | tree=[' + (await treeNames(main)).join(',') + ']');
    return;
  }

  // MC-REAL-LSP-1 A 打开文件并等静态引擎就绪
  try {
    await main.locator('#tree .tree-item .name', { hasText: 'a_project.py' }).first().dblclick();
    await waitLspStatus(main, '就绪', 60000);
    record('MC-REAL-LSP-1', 'A 打开文件且静态引擎就绪（#status-lsp 含「就绪」）', true);
  } catch (e) {
    const txt = await main.evaluate(() => document.querySelector('#status-lsp')?.textContent || '(no #status-lsp)');
    record('MC-REAL-LSP-1', 'A 打开文件且静态引擎就绪', false,
      String(e).split('\n')[0] + ' | #status-lsp=[' + txt + ']');
  }

  // MC-REAL-2 调用 open_workspace_window 打开项目 B
  const beforeCount = allPages(browser).length;
  let invokeOk = true, invokeDetail = '';
  try {
    await main.evaluate(
      (p) => window.__TAURI_INTERNALS__.invoke('open_workspace_window', { path: p }),
      WS_B,
    );
  } catch (e) {
    invokeOk = false;
    invokeDetail = String(e).split('\n')[0];
  }
  record('MC-REAL-2', '调用 open_workspace_window 打开项目 B', invokeOk, invokeDetail);

  // MC-REAL-3 新窗口 page 出现
  let winB = null;
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const now = allPages(browser);
      const newPage = now.find((p) => p !== main && p.url().includes(DEV_URL_HOST));
      if (newPage) { winB = newPage; break; }
      await sleep(500);
    }
    record('MC-REAL-3', `新窗口 page 出现（pages ${beforeCount} -> ${allPages(browser).length}）`, !!winB);
  } catch (e) {
    record('MC-REAL-3', '新窗口 page 出现', false, String(e).split('\n')[0]);
  }
  if (!winB) {
    console.log(`\n[诊断] 主窗口 console/error：\n  ` + mainDiag.slice(0, 20).join('\n  ') || '（无）');
    return;
  }
  const winBDiag = attachDiagnostics(winB, 'winB');
  await dismissBlockingModals(winB);

  // MC-REAL-4 新窗口文件树渲染（= 前端 init 跑通，核心回归点）
  try {
    await winB.locator('#tree .tree-item .name', { hasText: 'b_project.py' }).first().waitFor({ timeout: 60000 });
    record('MC-REAL-4', '新窗口文件树可见 b_project.py（前端 init 跑通）', true);
  } catch (e) {
    record('MC-REAL-4', '新窗口文件树可见 b_project.py（前端 init 跑通）', false,
      String(e).split('\n')[0] + ' | tree=[' + (await treeNames(winB)).join(',') + ']');
  }

  // MC-REAL-LSP-2 开 B 后 A 的静态引擎仍就绪（回归：B 的 stopEngine("*") 不误杀 A 的 LSP）
  try {
    await waitLspStatus(main, '就绪', 15000);
    record('MC-REAL-LSP-2', '开 B 后 A 的静态引擎仍就绪（#status-lsp 含「就绪」）', true);
  } catch (e) {
    const txt = await main.evaluate(() => document.querySelector('#status-lsp')?.textContent || '(no #status-lsp)');
    record('MC-REAL-LSP-2', '开 B 后 A 的静态引擎仍就绪', false,
      String(e).split('\n')[0] + ' | #status-lsp=[' + txt + ']');
  }

  // MC-REAL-5 新窗口可交互：双击打开 b_project.py → Monaco 出现
  try {
    await winB.locator('#tree .tree-item .name', { hasText: 'b_project.py' }).first().dblclick();
    await winB.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
    record('MC-REAL-5', '新窗口可打开文件（Monaco 出现）', true);
  } catch (e) {
    record('MC-REAL-5', '新窗口可打开文件（Monaco 出现）', false, String(e).split('\n')[0]);
  }

  // MC-REAL-WATCH-1 开 B 后 A 的文件监听仍存活（回归：B 的 watch_start 不覆盖/误杀 A 的 watcher）
  try {
    writeFileSync(path.join(WS_A, 'a_after_b.py'), '# watcher A\nprint("after B")\n', 'utf8');
    await main.locator('#tree .tree-item .name', { hasText: 'a_after_b.py' }).first().waitFor({ timeout: 30000 });
    record('MC-REAL-WATCH-1', '开 B 后 A 的文件监听仍存活（写 A 新文件 → A 树出现 a_after_b.py）', true);
  } catch (e) {
    record('MC-REAL-WATCH-1', '开 B 后 A 的文件监听仍存活', false,
      String(e).split('\n')[0] + ' | tree=[' + (await treeNames(main)).join(',') + ']');
  }

  // MC-REAL-WATCH-2 B 的文件监听独立（写 B 新文件 → B 树刷新）
  try {
    writeFileSync(path.join(WS_B, 'b_after.py'), '# watcher B\nprint("new")\n', 'utf8');
    await winB.locator('#tree .tree-item .name', { hasText: 'b_after.py' }).first().waitFor({ timeout: 30000 });
    record('MC-REAL-WATCH-2', 'B 的文件监听独立（写 B 新文件 → B 树出现 b_after.py）', true);
  } catch (e) {
    record('MC-REAL-WATCH-2', 'B 的文件监听独立', false,
      String(e).split('\n')[0] + ' | tree=[' + (await treeNames(winB)).join(',') + ']');
  }

  // MC-REAL-TERM-1 A 开终端 spawn shell
  try {
    await main.locator('#tab-terminal').click();
    await main.locator('.terminal-view .xterm-rows').first().waitFor({ timeout: 30000 });
    record('MC-REAL-TERM-1', 'A 开终端（xterm 渲染 + shell spawn）', true);
  } catch (e) {
    record('MC-REAL-TERM-1', 'A 开终端', false, String(e).split('\n')[0]);
  }

  // MC-REAL-TERM-2 B 开终端 spawn shell（后端同名 term-1 按 wid 分区，不覆盖 A）
  try {
    await winB.locator('#tab-terminal').click();
    await winB.locator('.terminal-view .xterm-rows').first().waitFor({ timeout: 30000 });
    record('MC-REAL-TERM-2', 'B 开终端（xterm 渲染 + shell spawn）', true);
  } catch (e) {
    record('MC-REAL-TERM-2', 'B 开终端', false, String(e).split('\n')[0]);
  }

  // MC-REAL-TERM-3 term-data 定向：A 写命令 → 只有 A 的终端出现输出，B 不串
  try {
    await main.evaluate(() => window.__TAURI_INTERNALS__.invoke('term_write', { id: 'term-1', data: 'echo WIN_A\r' }));
    await main.waitForFunction(
      (n) => {
        const el = document.querySelector('.terminal-view:not(.hidden) .xterm-rows');
        return (el?.innerText || '').includes(n);
      },
      'WIN_A',
      { timeout: 20000 },
    );
    const bTxt = await termText(winB);
    record('MC-REAL-TERM-3', 'term-data 定向不串（A 出 WIN_A，B 无 WIN_A）', !bTxt.includes('WIN_A'),
      'B 终端=[' + bTxt.slice(0, 80) + ']');
  } catch (e) {
    record('MC-REAL-TERM-3', 'term-data 定向不串', false, String(e).split('\n')[0]);
  }

  // MC-REAL-DBG 调试独立性（需真实解释器 + __OC_DEBUG_TEST__ 钩子；无解释器则 SKIP）
  if (!existsSync(REAL_PYTHON)) {
    record('MC-REAL-DBG-1', 'A 调试命中（SKIP：无解释器 ' + REAL_PYTHON + '）', true, 'SKIP');
    record('MC-REAL-DBG-2', '双窗口调试会话并存（SKIP）', true, 'SKIP');
  } else {
    let aDebug = false;
    let aDebugDetail = '';
    try {
      await main.locator('#tree .tree-item .name', { hasText: 'script.py' }).first().dblclick();
      await main.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
      const hasHook = await main.evaluate(() => typeof window.__OC_DEBUG_TEST__ === 'object');
      if (!hasHook) throw new Error('__OC_DEBUG_TEST__ 钩子缺失');
      await sleep(800);
      await main.evaluate(() => { window.__OC_DEBUG_TEST__.toggleActive(6); });
      await sleep(500);
      await main.locator('#btn-debug').click();
      await main.locator('.debug-current-line').first().waitFor({ timeout: 90000 });
      aDebug = true;
      record('MC-REAL-DBG-1', 'A 调试命中（真 debugpy 停 :6）', true);
    } catch (e) {
      aDebugDetail = String(e).split('\n')[0];
      record('MC-REAL-DBG-1', 'A 调试命中（真 debugpy 停 :6）', false, aDebugDetail);
    }

    if (aDebug) {
      try {
        await winB.locator('#tree .tree-item .name', { hasText: 'script.py' }).first().dblclick();
        await winB.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
        await sleep(800);
        await winB.evaluate(() => { window.__OC_DEBUG_TEST__.toggleActive(6); });
        await sleep(500);
        await winB.locator('#btn-debug').click();
        await winB.locator('.debug-current-line').first().waitFor({ timeout: 90000 });
        const aStill = (await main.locator('.debug-current-line').first().count()) > 0;
        record('MC-REAL-DBG-2', '双窗口调试会话并存（B 命中且 A 仍在调试态）', aStill,
          aStill ? '' : 'A 的 .debug-current-line 丢失（B 覆盖了 A 的调试会话）');
      } catch (e) {
        record('MC-REAL-DBG-2', '双窗口调试会话并存（B 命中且 A 仍在调试态）', false, String(e).split('\n')[0]);
      }
    } else {
      record('MC-REAL-DBG-2', '双窗口调试会话并存（前置 DBG-1 失败，跳过）', false, 'DBG-1 失败: ' + aDebugDetail);
    }

    // 清场：两个窗口各自停止调试（避免残留 python 进程影响后续用例）
    try { await main.locator('#debug-stop').click(); } catch { /* 无会话 */ }
    try { await winB.locator('#debug-stop').click(); } catch { /* 无会话 */ }
    await sleep(2000);
  }

  // MC-REAL-6 去重：B 仍开着，重复 open_workspace_window(B) 不新增窗口
  try {
    const n0 = allPages(browser).length;
    await main.evaluate(
      (p) => window.__TAURI_INTERNALS__.invoke('open_workspace_window', { path: p }),
      WS_B,
    );
    await sleep(3000);
    const n1 = allPages(browser).length;
    record('MC-REAL-6', `重复打开 B 去重（pages ${n0} -> ${n1}）`, n1 === n0,
      n1 === n0 ? '' : `页面数 ${n0}->${n1}，未去重`);
  } catch (e) {
    record('MC-REAL-6', '重复打开 B 去重', false, String(e).split('\n')[0]);
  }

  // MC-REAL-7 关闭 B（win-close → 页面消失）且主窗口 A 不受影响
  try {
    await winB.locator('#win-close').click({ timeout: 5000 });
    let closed = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (!allPages(browser).includes(winB)) { closed = true; break; }
      await sleep(400);
    }
    const aOk = (await main.locator('#tree .tree-item .name', { hasText: 'a_project.py' }).first().count()) > 0;
    record('MC-REAL-7', `关闭 B（页面消失）且 A 不受影响（a_project.py 仍在）`, closed && aOk,
      `closed=${closed} aOk=${aOk}`);
  } catch (e) {
    record('MC-REAL-7', '关闭 B 且 A 不受影响', false, String(e).split('\n')[0]);
  }

  if (winBDiag.length) {
    console.log(`\n[诊断] 新窗口 console/error（${winBDiag.length} 条）:\n  ` + winBDiag.slice(0, 20).join('\n  '));
  }
}

// WS_B / WS_A 通过闭包注入（runChecks 内 main.evaluate / fs 写入使用）
let WS_B = '';
let WS_A = '';

(async () => {
  if (await portInUse(5173)) {
    console.error('[预检失败] 5173 已被占用，请先停掉现有 vite / tauri dev。');
    process.exit(2);
  }
  if (await portInUse(CDP_PORT)) {
    console.error(`[预检失败] CDP 端口 ${CDP_PORT} 已被占用（可能残留上次会话）。`);
    process.exit(2);
  }

  // 隔离环境：两个临时项目 + 预置 recent（仅 A，主窗口启动恢复 A）
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-multiwin-real-'));
  const wsA = path.join(tmp, 'wsA');
  const wsB = path.join(tmp, 'wsB');
  const dataRoot = path.join(tmp, 'data-root');
  mkdirSync(wsA, { recursive: true });
  mkdirSync(wsB, { recursive: true });
  mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  writeFileSync(path.join(wsA, 'a_project.py'), '# project A\nprint("A")\n', 'utf8');
  writeFileSync(path.join(wsB, 'b_project.py'), '# project B\nprint("B")\n', 'utf8');
  // 调试独立性 fixture：两个项目各带 script.py（断点停 :6）；有真实解释器才预置（无则调试段 SKIP）
  writeFileSync(path.join(wsA, 'script.py'), SCRIPT_PY, 'utf8');
  writeFileSync(path.join(wsB, 'script.py'), SCRIPT_PY, 'utf8');
  if (existsSync(REAL_PYTHON)) {
    presetInterpreter(dataRoot, wsA, REAL_PYTHON);
    presetInterpreter(dataRoot, wsB, REAL_PYTHON);
  }
  writeFileSync(
    path.join(dataRoot, 'config', 'recent-workspaces.json'),
    JSON.stringify([wsA]),
    'utf8',
  );
  WS_A = wsA;
  WS_B = wsB;
  console.log(`[环境] A=${wsA}\n[环境] B=${wsB}\n[环境] 数据根=${dataRoot}\n[环境] CDP=http://127.0.0.1:${CDP_PORT}`);

  const logPath = path.join(__dirname, '.tauri-dev-mw.log');
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

    await runChecks(browser);
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

  console.log('\n========== 多窗口真机 CDP 验收结果 ==========');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log('--------------------------------------');
  console.log(`共 ${results.length} 项，失败 ${failed} 项${KEEP_APP ? '（应用保留运行中）' : ''}`);
  process.exit(exitCode || (failed > 0 ? 1 : 0));
})();