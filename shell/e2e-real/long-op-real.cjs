/**
 * 长耗时 uv 操作真机（Real App）CDP 验收脚本 — LO-REAL-1..3
 * （对应 docs/project_dep_health_ux_review.md §3.3 的 L-1 / L-2 / L-3 / L-5 / L-8；
 *   批 3 的 mock 层已由 e2e/ux/12-long-op.spec.ts 覆盖，本脚本验**真实 uv 进程**这一层：
 *   真下载、真取消、真进程树终止——mock 层对这些一无所知。）
 *
 * 用法：
 *   cd shell
 *   node e2e-real/long-op-real.cjs
 *
 * 环境变量：
 *   OC_PARENT          工作区父目录（默认 %TEMP%\oc-longop-real-<n>）
 *   OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP   同 new-project-fastapi-real.cjs
 *   OC_SPEC            冷缓存安装的包（默认 polars，~30MB，用于 L-2 超时分级与 L-1 进度）
 *   OC_CANCEL_SPEC     取消用例的包（默认 scikit-learn，够大以保证有在途窗口）
 *
 * 判定：
 *   LO-REAL-1  L-2：冷缓存装包不因「命令执行超时（120s）」失败（超时已按动作分级到 600s）
 *   LO-REAL-2  L-5 + L-8：安装期间状态栏「进行中」芯片可见 + env 域写操作禁用 + 输出面板展开
 *   LO-REAL-3  L-1：安装期间芯片给出可判读进度（最近一行 / 进度条，二选一即可）
 *   LO-REAL-4  L-3：点「取消」→ 进程树被终止（无孤儿 uv）+ info 级「已取消」toast + 写操作恢复
 */
'use strict';

const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, openSync } = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  waitCdpReadyWatched, writeJsonSummary, gitHead, record, printSummary,
} = require('./lib/real-env.cjs');

const CDP_PORT = Number(process.env.OC_CDP_PORT || 9225);
const CDP_TIMEOUT_MS = Number(process.env.OC_CDP_TIMEOUT || 900) * 1000;
const KEEP_APP = process.env.OC_KEEP_APP === '1';
const SPEC = process.env.OC_SPEC || 'polars';
// 取消用例要够大才有在途窗口（scikit-learn 在本机 ~13MB 装得太快，抓不到窗口）
const CANCEL_SPEC = process.env.OC_CANCEL_SPEC || 'scipy';
const WS_NAME = 'demo-longop-real';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function portInUse(port) {
  const probe = (host) => new Promise((resolve) => {
    const sock = net.connect({ port, host });
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { sock.destroy(); } catch { /* 已关闭 */ } resolve(v); };
    sock.setTimeout(1200, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then(([v4, v6]) => v4 || v6);
}

/** 当前机器上的 uv 进程数（取消后必须归零：进程树被杀，不留孤儿） */
function uvCount() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq uv.exe" /NH', { encoding: 'utf8', windowsHide: true });
    return (out.match(/uv\.exe/gi) || []).length;
  } catch { return 0; }
}

async function dismissBlockingModals(page) {
  for (let i = 0; i < 6; i++) {
    const btns = page.locator('.modal-card:visible .modal-actions .btn--primary');
    const n = await btns.count().catch(() => 0);
    if (n === 0) return;
    for (let j = 0; j < n; j++) await btns.nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(400);
  }
}

async function outputText(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#output .out-line')).map((e) => e.textContent || '').join('\n'));
}

/** 经菜单「最近的工作区」切到目标工作区（真实 openWorkspace 路径，非直接改状态） */
async function switchWorkspace(page, root) {
  await page.evaluate(async (p) => {
    const norm = (s) => String(s || '').replace(/\//g, '\\').replace(/^\\\\\?\\/, '').toLowerCase();
    const m = await import('/src/menuItems.ts');
    const fileMenu = m.getMenuItems('file');
    const recentEntry = fileMenu.find((e) => typeof e.submenu === 'function');
    if (!recentEntry) throw new Error('file menu 无子菜单入口');
    const subs = await recentEntry.submenu();
    const target = subs.find((e) => e.detail && norm(e.detail) === norm(p));
    if (!target) throw new Error('最近工作区缺目标: ' + JSON.stringify(subs.map((s) => s.detail || s.label)));
    target.action();
  }, root);
}

async function runChecks(page, wsRoot) {
  await dismissBlockingModals(page);
  await page.evaluate(async (p) => { await window.__TAURI_INTERNALS__.invoke('add_recent_workspace', { path: p }); }, wsRoot).catch(() => {});
  // menuItems 的 handlers 在 main.init 深处才注入——CDP 一连通就切会撞「handlers 未注入」。
  // 重试到注入完成（NP-REAL-6 是在流程末尾调用才天然躲开这个时序）。
  let switched = false;
  let switchErr = '';
  for (let i = 0; i < 40 && !switched; i++) {
    try {
      await switchWorkspace(page, wsRoot);
      switched = true;
    } catch (e) {
      switchErr = String(e.message || e).split('\n')[0];
      await sleep(1500);
    }
  }
  if (!switched) {
    record('LO-REAL-1', `冷缓存装 ${SPEC} 不因 120s 超时失败（L-2）`, false, `切换工作区失败：${switchErr}`);
    return;
  }
  await page.locator('#tree-header-text').filter({ hasText: WS_NAME }).waitFor({ timeout: 30000 });

  // 建环境（默认版本，本机已装 → 秒级，不消耗下载窗口）
  await page.locator('#status-interpreter').click();
  await page.locator('#env-modal:not(.hidden)').waitFor({ timeout: 8000 });
  await page.locator('#interp-trigger').click();
  const act = page.locator('#interp-popover .interp-action').first();
  await act.waitFor({ timeout: 5000 });
  await act.click();
  await page.locator('#venv-version-modal:not(.hidden)').waitFor({ timeout: 8000 });
  const installed = page.locator('#venv-version-list .venv-version-item').filter({ hasText: /已安装|installed/ }).first();
  if (!(await installed.count())) {
    record('LO-REAL-1', `冷缓存装 ${SPEC} 不因 120s 超时失败（L-2）`, false, '版本列表无「已安装」项，无法建环境');
    return;
  }
  await installed.click();
  const venvCfg = path.join(wsRoot, '.venv', 'pyvenv.cfg');
  let venvOk = false;
  for (let i = 0; i < 60 && !venvOk; i++) {
    venvOk = existsSync(venvCfg);
    if (!venvOk) await sleep(2000);
  }
  if (!venvOk) {
    record('LO-REAL-1', `冷缓存装 ${SPEC} 不因 120s 超时失败（L-2）`, false, 'venv 未建成（前置失败）');
    return;
  }

  // ---------- LO-REAL-1 / 2 / 3：一次真实安装，同时采集三条判据 ----------
  const uvBase = uvCount();
  await page.locator('#env-pkg-input').fill(SPEC);
  await page.locator('#env-pkg-install').click();

  let chipSeen = false;
  let writeLocked = false;
  let bottomExpanded = false;
  let progressSeen = false;
  let barSeen = false;
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => {
      const chip = document.getElementById('status-op');
      const bar = document.getElementById('status-op-bar');
      return {
        chip: !!chip && !chip.classList.contains('hidden'),
        detail: (document.getElementById('status-op-detail') || {}).textContent || '',
        bar: !!bar && !bar.classList.contains('hidden'),
        installDisabled: !!document.getElementById('env-pkg-install')?.disabled,
        uninstallDisabled: !!document.getElementById('env-pkg-uninstall-selected')?.disabled,
        bottomExpanded: !document.getElementById('bottom')?.classList.contains('collapsed'),
      };
    }).catch(() => null);
    if (!st) break;
    if (st.chip) chipSeen = true;
    if (st.installDisabled || st.uninstallDisabled) writeLocked = true;
    if (st.bottomExpanded) bottomExpanded = true;
    if (st.detail.trim()) progressSeen = true;
    if (st.bar) barSeen = true;
    if (st.chip && uvCount() > uvBase) { /* 在途：uv 进程已起 */ }
    if (!st.chip && i > 3) break; // 芯片收起 = 安装已收尾
    await sleep(1000);
  }

  const out = await outputText(page);
  const timedOut120 = /命令执行超时（120s）/.test(out);
  // 装成功的判据：输出面板出现 uv 的完成行（Resolved/Installed/Prepared 任一 + 无失败行）
  const installSucceeded = /Installed |Prepared |Resolved /.test(out) && !/安装失败/.test(out);
  record('LO-REAL-1', `冷缓存装 ${SPEC} 不因 120s 超时失败（L-2）`,
    !timedOut120 && installSucceeded,
    `120s超时=${timedOut120} · 完成=${installSucceeded}`);

  record('LO-REAL-2', '安装期间：状态栏「进行中」芯片可见 + env 域写操作禁用 + 输出面板展开（L-5 / L-8）',
    chipSeen && writeLocked && bottomExpanded,
    `芯片=${chipSeen} · 写锁=${writeLocked} · 输出面板展开=${bottomExpanded}`);

  record('LO-REAL-3', '安装期间芯片给出可判读进度（L-1）',
    progressSeen,
    progressSeen ? `进度文本可见${barSeen ? ' + 进度条已画' : '（未解析出比例，走不确定态）'}` : '芯片详情始终为空');

  // ---------- LO-REAL-4：取消 → 进程树终止 + info toast + 写操作恢复 ----------
  await page.locator('#env-pkg-input').fill(CANCEL_SPEC);
  await page.locator('#env-pkg-install').click();
  // 起手后立刻关掉环境面板：状态栏在模态之外，面板开着会挡住「取消」按钮的点击
  //（Playwright 的点击被遮挡会重试到超时并被静默吞掉——表现为「点了没反应」）。
  await page.locator('#env-close').click({ timeout: 3000 }).catch(() => {});
  await page.locator('#env-modal').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  // 等芯片点亮（= 操作确实在途）后再点取消
  let cancelClicked = false;
  let uvPeakEarly = uvBase;
  for (let i = 0; i < 150 && !cancelClicked; i++) {
    const on = await page.evaluate(() => {
      const chip = document.getElementById('status-op');
      return !!chip && !chip.classList.contains('hidden');
    });
    const n = uvCount();
    if (n > uvPeakEarly) uvPeakEarly = n;
    // uv 已在跑才点取消——点得太早（前端刚置位、uv 尚未 spawn）会退化成「后端静默成功」
    if (on && uvPeakEarly > uvBase) {
      await page.locator('#status-op-cancel').click({ timeout: 3000 }).catch(() => {});
      cancelClicked = true;
      break;
    }
    await sleep(200);
  }
  if (!cancelClicked) {
    record('LO-REAL-4', '点「取消」→ 进程树终止（无孤儿 uv）+ info 级提示（L-3）', false, '取消前芯片未点亮（装包太快，没抓到在途窗口）');
    return;
  }
  const cancelingText = await page.evaluate(() => document.getElementById('status-op-cancel').textContent || '');
  let toastSeen = false;
  let uvCleared = false;
  let uvPeak = uvBase;
  for (let i = 0; i < 90; i++) {
    const txt = await page.evaluate(() => Array.from(document.querySelectorAll('#toast-stack .toast-text')).map((e) => e.textContent || '').join('\n'));
    if (/已取消|Canceled/.test(txt)) toastSeen = true;
    const n = uvCount();
    if (n > uvPeak) uvPeak = n;
    if (n <= uvBase) uvCleared = true;
    if (toastSeen && uvCleared) break;
    await sleep(300);
  }
  const restored = await page.evaluate(() => !document.getElementById('env-pkg-install')?.disabled);
  // 判据口径：uv 峰值 > 基线 = 取消确实打在**在途**的进程上；峰值未抬升说明装包太快、
  // 点取消时操作已收尾 —— 那是「没抓到窗口」而非产品缺陷，单独标注不可判定。
  const inFlight = uvPeak > uvBase;
  record('LO-REAL-4', '点「取消」→ 进程树终止（无孤儿 uv）+ info 级提示（L-3）',
    inFlight && toastSeen && uvCleared && restored,
    inFlight
      ? `toast=${toastSeen} · 无孤儿uv=${uvCleared}（基线 ${uvBase} / 峰值 ${uvPeak}）· 写操作恢复=${restored} · 按钮文案「${cancelingText.trim()}」`
      : `不可判定：点取消时操作已收尾（uv 峰值 ${uvPeak} = 基线 ${uvBase}）——换更大的包或更早点取消后重跑`);
}

(async () => {
  const t0 = Date.now();
  const suiteMeta = { suite: 'long-op-real', cdpPort: CDP_PORT, headCommit: gitHead() };
  function precheckFail(msg) {
    console.error(`[预检失败] ${msg}`);
    writeJsonSummary({ ...suiteMeta, durationMs: Date.now() - t0, error: msg });
    process.exit(2);
  }

  if (await portInUse(5173)) precheckFail('5173 已被占用（可能已有 vite / tauri dev 在跑）。');
  if (await portInUse(CDP_PORT)) precheckFail(`CDP 端口 ${CDP_PORT} 已被占用（可能残留上一次会话）。`);

  const parentDir = process.env.OC_PARENT || path.join(os.tmpdir(), `oc-longop-real-${Date.now()}`);
  mkdirSync(parentDir, { recursive: true });
  const wsRoot = path.join(parentDir, WS_NAME);
  mkdirSync(wsRoot, { recursive: true });
  writeFileSync(path.join(wsRoot, 'main.py'), 'print("long-op")\n', 'utf8');
  writeFileSync(path.join(wsRoot, 'pyproject.toml'),
    '[project]\nname = "demo-longop"\nversion = "0.1.0"\nrequires-python = ">=3.12"\ndependencies = []\n', 'utf8');

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-longop-data-'));
  const dataRoot = path.join(tmp, 'data-root');
  mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  writeFileSync(path.join(dataRoot, 'config', 'recent-workspaces.json'), '[]', 'utf8');
  console.log(`[环境] 工作区: ${wsRoot}\n[环境] 数据根: ${dataRoot}\n[环境] CDP: http://127.0.0.1:${CDP_PORT}`);
  console.log(`[环境] 装包 ${SPEC}（冷缓存）· 取消用例 ${CANCEL_SPEC}`);

  const logPath = path.join(__dirname, '.tauri-dev-longop.log');
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
  let runError = null;
  try {
    const waited = await waitCdpReadyWatched(CDP_PORT, CDP_TIMEOUT_MS, { child, logPath });
    console.log(`[就绪] CDP 已监听（等待 ${Math.round(waited / 1000)}s），连接…`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => p.url().includes('localhost:5173')) || ctx.pages()[0];
    if (!page) throw new Error('CDP 已连接但未找到应用页面');
    console.log(`[连接] 页面: ${page.url()}`);
    await runChecks(page, wsRoot);
  } catch (e) {
    runError = String(e.message || e);
    console.error(`\n[运行中断] ${runError}`);
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (!KEEP_APP) {
      console.log('\n[清理] taskkill 进程树…');
      try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
    }
  }

  const failed = printSummary('长耗时 uv 操作真机验收（LO-REAL）', KEEP_APP);
  writeJsonSummary({ ...suiteMeta, durationMs: Date.now() - t0, error: runError });
  process.exit(exitCode || (failed > 0 ? 1 : 0));
})();
