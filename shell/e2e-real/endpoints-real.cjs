/**
 * 端点工具窗真机（Real App）CDP 复现/验收脚本 — EP-REAL-1..3
 * （对应 docs/pycharm_framework_support_report.md §8.3 F1/F2：用户实测报告
 *   「打开 D:\aipro\cb_watcher\backend，端点侧栏点击各端点均报『打开文件失败』」）
 *
 * 与 e2e/ux/02-frameworks.spec.ts（浏览器 mock）分层：mock 桥的 fs read_file 对相对路径
 * 会 join 仓库根兜底，**复现不了**真实 Rust read_file 只认绝对路径的契约缺口——
 * 本脚本驱动真实 Tauri 应用 + 真实工作区，验证端点行点击 → openFile → read_file 全链路。
 *
 * 用法：
 *   cd shell
 *   node e2e-real/endpoints-real.cjs
 *
 * 环境变量：
 *   OC_WORKSPACE    目标工作区（默认 D:\aipro\cb_watcher\backend；需依赖声明含 fastapi/flask
 *                   且源码有 app 声明，端点侧栏才有内容）
 *   OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP   同 debug-real.cjs
 *
 * 判定（EP-REAL-3）：
 *   点击端点行后，活动标签应为「声明文件 basename」；
 *   失败且出现「打开文件失败」toast = 复现（修复前态）。
 */
'use strict';

const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, openSync } = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const CDP_PORT = Number(process.env.OC_CDP_PORT || 9223);
const CDP_TIMEOUT_MS = Number(process.env.OC_CDP_TIMEOUT || 600) * 1000;
const KEEP_APP = process.env.OC_KEEP_APP === '1';
const WORKSPACE = process.env.OC_WORKSPACE || 'D:\\aipro\\cb_watcher\\backend';
const DEV_URL_HOST = 'localhost:5173';

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

async function dismissBlockingModals(page) {
  // 首启「落位提示」等一次性弹窗（fresh 数据根会触发）：点掉所有可见 modal 按钮放行。
  for (let i = 0; i < 6; i++) {
    const btns = page.locator('.modal-card:visible .modal-actions button');
    const n = await btns.count().catch(() => 0);
    if (n === 0) return;
    for (let j = 0; j < n; j++) await btns.nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(400);
  }
}

async function activeTabName(page) {
  return page.evaluate(() => document.querySelector('#tabbar .tab.active .name')?.textContent ?? null);
}

/** 等待「打开文件失败」toast；出现返回 toast 文本，超时返回 null */
async function waitOpenFailToast(page, timeoutMs) {
  try {
    const el = page.locator('#toast-stack .toast', { hasText: '打开文件失败' }).first();
    await el.waitFor({ timeout: timeoutMs });
    return (await el.textContent()) || '(空 toast)';
  } catch {
    return null;
  }
}

async function runChecks(page) {
  await dismissBlockingModals(page);

  // EP-REAL-1 工作区自动恢复
  try {
    await page.locator('#tree .tree-item').first().waitFor({ timeout: 60000 });
    record('EP-REAL-1', '工作区自动恢复（文件树可见）', true);
  } catch (e) {
    record('EP-REAL-1', '工作区自动恢复（文件树可见）', false, String(e).split('\n')[0]);
    return;
  }

  // EP-REAL-2 端点侧栏扫描出结果
  await page.locator('#tab-endpoints').click();
  try {
    await page.locator('#ep-results .todo-item').first().waitFor({ timeout: 30000 });
  } catch (e) {
    const summary = await page.evaluate(() => document.getElementById('ep-summary')?.textContent ?? '(no #ep-summary)');
    record('EP-REAL-2', '端点侧栏扫描出结果（#ep-results 有条目）', false,
      String(e).split('\n')[0] + ` | summary=[${summary}]（确认工作区依赖声明含 fastapi/flask 且源码有 app 声明）`);
    return;
  }
  const rows = await page.locator('#ep-results .todo-item').count();
  const firstRoute = (await page.locator('#ep-results .ep-route').first().textContent()) || '';
  const firstLoc = (await page.locator('#ep-results .todo-loc').first().textContent()) || '';
  // loc 形如 "basename:line"（endpointView 用 basename(m.file) 渲染，不含盘符冒号歧义）
  const expectBase = firstLoc.replace(/:\d+\s*$/, '');
  record('EP-REAL-2', `端点扫描出结果（${rows} 项；首项 ${firstRoute} @ ${firstLoc}）`, true);

  // EP-REAL-3 点击端点行 → 应打开声明文件（活动标签 = basename）
  const first = page.locator('#ep-results .todo-item').first();
  await first.click();
  const failToast = await waitOpenFailToast(page, 8000);
  const tab = await activeTabName(page);
  const opened = tab !== null && tab === expectBase;
  if (opened) {
    record('EP-REAL-3', `点击端点行打开声明文件（活动标签=${tab}，期望=${expectBase}）`, true);
  } else {
    const extra = failToast ? `>>> 复现：出现「打开文件失败」toast [${failToast.trim().slice(0, 120)}]` : `未出现失败 toast`;
    record('EP-REAL-3', `点击端点行打开声明文件（活动标签=${tab}，期望=${expectBase}）`, false, extra);
  }

  // EP-REAL-4 抽查第二个端点（若有）：同一契约不应只对首项成立
  if (rows >= 2) {
    const loc2 = (await page.locator('#ep-results .todo-loc').nth(1).textContent()) || '';
    const base2 = loc2.replace(/:\d+\s*$/, '');
    await page.locator('#ep-results .todo-item').nth(1).click();
    const failToast2 = await waitOpenFailToast(page, 8000);
    const tab2 = await activeTabName(page);
    const opened2 = tab2 !== null && tab2 === base2;
    record('EP-REAL-4', `第二端点同契约（活动标签=${tab2}，期望=${base2}）`, opened2,
      failToast2 ? `>>> 复现：[${failToast2.trim().slice(0, 120)}]` : '');
  }
}

(async () => {
  if (await portInUse(5173)) {
    console.error(`[预检失败] 5173 已被占用（可能已有 vite / tauri dev 在跑），请先停掉再运行本脚本。`);
    process.exit(2);
  }
  if (await portInUse(CDP_PORT)) {
    console.error(`[预检失败] CDP 端口 ${CDP_PORT} 已被占用（可能残留上一次会话）。`);
    process.exit(2);
  }
  if (!existsSync(WORKSPACE)) {
    console.error(`[预检失败] 工作区不存在: ${WORKSPACE}（用 OC_WORKSPACE 指定）`);
    process.exit(2);
  }

  // 隔离数据根：recent-workspaces 指向真实目标工作区；不预置解释器（端点扫描纯文件操作，
  // 与解释器无关——顺带覆盖「未配解释器」的默认路径）
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-endpoints-real-'));
  const dataRoot = path.join(tmp, 'data-root');
  mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  writeFileSync(
    path.join(dataRoot, 'config', 'recent-workspaces.json'),
    JSON.stringify([WORKSPACE]),
    'utf8',
  );
  console.log(`[环境] 工作区: ${WORKSPACE}\n[环境] 数据根: ${dataRoot}\n[环境] CDP: http://127.0.0.1:${CDP_PORT}`);

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
    const page = ctx.pages().find((p) => p.url().includes(DEV_URL_HOST)) || ctx.pages()[0];
    if (!page) throw new Error('CDP 已连接但未找到应用页面（devUrl=' + DEV_URL_HOST + '）');
    console.log(`[连接] 页面: ${page.url()}`);

    await runChecks(page);
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

  console.log('\n========== 真机 CDP 验收结果 ==========');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.desc}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`--------------------------------------`);
  console.log(`共 ${results.length} 项，失败 ${failed} 项${KEEP_APP ? '（应用保留运行中）' : ''}`);
  process.exit(exitCode || (failed > 0 ? 1 : 0));
})();
