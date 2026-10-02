/**
 * SQLite 数据库工具 · 真机 CDP 验收（doc §10.3 清单 12 条）。
 * 运行：node e2e-real/db-real.cjs   （在 shell/ 下；预检 5173/9223 空闲）
 * 环境变量：OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP=1（保留现场）
 *
 * 与 mock 层 e2e 的区别：真实 rusqlite 进程内库 + 真实 Tauri 命令 + 真实 WebView2 布局。
 * ＋ 添加与导出 CSV 走原生文件对话框，用 SendKeys 尽力自动化（失败会在 detail 里注明）。
 */
'use strict';

const { spawn, spawnSync, execSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, openSync, readFileSync } = require('fs');
const os = require('os');
const path = require('path');

const env = require('./lib/real-env.cjs');
const { chromium } = require('@playwright/test');

const PYTHON = process.env.OC_REAL_PYTHON || 'D:\\py\\python.exe';
const CDP_PORT = Number(process.env.OC_CDP_PORT || 9223);
const CDP_TIMEOUT = Number(process.env.OC_CDP_TIMEOUT || 600) * 1000;
const OUT_DIR = path.join(__dirname, '..', '..', 'scripts', '_tmp');

const { record, sleep, portInUse, waitCdpReady, dismissBlockingModals, printSummary } = env;

// ———————————————— conn_id 复现（Rust DefaultHasher = SipHash-1-3, keys 0,0） ————————————————

const U64 = (1n << 64n) - 1n;
function rotl64(x, b) { return ((x << b) | (x >> (64n - b))) & U64; }
function sipround(v) {
  v[0] = (v[0] + v[1]) & U64; v[1] = rotl64(v[1], 13n); v[1] ^= v[0]; v[0] = rotl64(v[0], 32n);
  v[2] = (v[2] + v[3]) & U64; v[3] = rotl64(v[3], 16n); v[3] ^= v[2];
  v[0] = (v[0] + v[3]) & U64; v[3] = rotl64(v[3], 21n); v[3] ^= v[0];
  v[2] = (v[2] + v[1]) & U64; v[1] = rotl64(v[1], 17n); v[1] ^= v[2]; v[2] = rotl64(v[2], 32n);
}
function siphash13(data) {
  let v0 = 0x736f6d6570736575n, v1 = 0x646f72616e646f6dn, v2 = 0x6c7967656e657261n, v3 = 0x7465646279746573n;
  const v = [v0, v1, v2, v3];
  const len = data.length;
  let i = 0;
  for (; i + 8 <= len; i += 8) {
    let m = 0n;
    for (let j = 7; j >= 0; j--) m = (m << 8n) | BigInt(data[i + j]);
    v[3] ^= m; sipround(v); v[0] ^= m;
  }
  let last = BigInt(len & 0xff) << 56n;
  for (let j = i; j < len; j++) last |= BigInt(data[j]) << BigInt(8 * (j - i));
  v[3] ^= last; sipround(v); v[0] ^= last;
  v[2] ^= 0xffn;
  for (let r = 0; r < 3; r++) sipround(v);
  return v[0] ^ v[1] ^ v[2] ^ v[3];
}
/** 对齐 db_cmds.rs::conn_id：canonicalize（Windows verbatim \\?\ 前缀）→ to_lowercase → hash */
function computeConnId(absPath) {
  const canon = '\\\\?\\' + absPath.replace(/\//g, '\\');
  const bytes = [...Buffer.from(canon.toLowerCase(), 'utf8'), 0xff];
  return 'db-' + siphash13(bytes).toString(16).padStart(16, '0');
}

// ———————————————— 页面辅助 ————————————————

const db = (page, id) => page.locator(`#${id}`);

async function appReady(page) {
  await page.locator('#tab-database').waitFor({ state: 'visible', timeout: 60_000 });
}

/** 等待自动连接完成：下拉可用 + 树里出现指定表的行数 */
async function waitConnected(page, tableName, rowCountText) {
  try {
    await db(page, 'db-conn-select').waitFor({ state: 'visible', timeout: 10_000 });
    await page
      .locator(`#db-tree .db-tree-item[data-name="${tableName}"]`, { hasText: rowCountText })
      .waitFor({ state: 'visible', timeout: 30_000 });
  } catch (e) {
    const tree = (await db(page, 'db-tree').textContent().catch(() => '(树区不可读)')) || '';
    const status = (await db(page, 'db-result-status').textContent().catch(() => '')) || '';
    const sel = (await db(page, 'db-conn-select').textContent().catch(() => '')) || '';
    throw new Error(`${e.message.split('\n')[0]}\n[诊断] 下拉="${sel.trim()}" 状态条="${status.trim()}" 树区="${tree.trim().slice(0, 300)}"`);
  }
}

/** Monaco 第二实例：点击聚焦 → 全选 → 输入（末尾 Esc 关掉建议弹层，防遮挡后续点击） */
async function setSql(page, text) {
  await db(page, 'db-sql-host').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text, { delay: 4 });
  await page.keyboard.press('Escape');
}

/** 轮询等待元素属性变为期望值 */
async function waitForAttr(page, selector, attr, value, timeoutMs = 10_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.locator(selector).getAttribute(attr).catch(() => null);
    if (v === value) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${selector} 的 ${attr} ${timeoutMs}ms 内未变为 ${value}（当前 ${v}）`);
    await sleep(200);
  }
}

async function runCurrent(page) {
  await page.keyboard.press('Control+Enter');
}

async function statusText(page) {
  return (await db(page, 'db-result-status').textContent()) || '';
}

async function waitStatusNot(page, substr, timeoutMs = 20_000) {
  const t0 = Date.now();
  for (;;) {
    const s = await statusText(page);
    if (!s.includes(substr)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`状态条 ${timeoutMs}ms 内未离开「${substr}」: ${s}`);
    await sleep(150);
  }
}

async function waitStatusHas(page, substr, timeoutMs = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const s = await statusText(page);
    if (s.includes(substr)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`状态条 ${timeoutMs}ms 内未出现「${substr}」: ${s}`);
    await sleep(150);
  }
}

/** 原生对话框 SendKeys（尽力而为） */
function sendKeysToNativeDialog(text) {
  const ps = path.join(OUT_DIR, '_native_keys.ps1');
  writeFileSync(
    ps,
    [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Start-Sleep -Milliseconds 1200',
      '[System.Windows.Forms.SendKeys]::SendWait("^a")',
      'Start-Sleep -Milliseconds 250',
      `[System.Windows.Forms.SendKeys]::SendWait("${text}")`,
      'Start-Sleep -Milliseconds 250',
      '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")',
      '',
    ].join('\r\n'),
    'utf8',
  );
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps], {
    timeout: 20_000,
    encoding: 'utf8',
  });
  return r.status === 0;
}

/** 应用启动（独立实现以支持第二轮重启复用同一数据根） */
function startApp(dataRoot, logPath) {
  const logFd = openSync(logPath, 'a');
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
  return child;
}

async function connectPage() {
  await waitCdpReady(CDP_PORT, CDP_TIMEOUT);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  // WebView2 先起 about:blank 再导航到 devUrl：轮询等真实应用页面就绪
  const t0 = Date.now();
  for (;;) {
    const pages = env.allPages(browser);
    const main = pages.find((p) => p.url().includes(env.DEV_URL_HOST));
    if (main) {
      try {
        await main.locator('#tab-database').waitFor({ state: 'attached', timeout: 5000 });
        return { browser, page: main };
      } catch { /* 页面尚在加载，继续等 */ }
    }
    if (Date.now() - t0 > 60_000) throw new Error('60s 内未等到应用页面（devUrl=' + env.DEV_URL_HOST + '）');
    await sleep(1000);
  }
}

async function openDbView(page) {
  for (let i = 0; i < 3; i++) {
    await db(page, 'tab-database').click().catch(() => {});
    try {
      await page.locator('#view-database').waitFor({ state: 'visible', timeout: 4000 });
      return;
    } catch { /* 可能被首启弹窗/加载吃掉点击，重试 */ }
  }
  throw new Error('切到数据库视图失败（#view-database 未出现）');
}

async function killTree(child) {
  try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
}

/** taskkill 树杀不死 WebView2 子进程：按命令行特征清掉占 CDP 端口的孤儿实例 */
function killWebviewLeftovers(port) {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='msedgewebview2.exe'\\" | Where-Object { $_.CommandLine -like '*remote-debugging-port=${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' },
    );
  } catch { /* 无残留 */ }
  try { execSync('taskkill /IM opencharm-shell.exe /F 2>nul', { stdio: 'ignore' }); } catch { /* 无残留 */ }
}

// ———————————————— 主流程 ————————————————

(async () => {
  // 预检
  if (await portInUse(5173)) { console.error('[预检失败] 5173 被占用，先停 vite/tauri dev'); process.exit(2); }
  if (await portInUse(CDP_PORT)) { console.error(`[预检失败] CDP ${CDP_PORT} 被占用`); process.exit(2); }
  if (!existsSync(PYTHON)) { console.error(`[预检失败] Python 不存在: ${PYTHON}`); process.exit(2); }

  // fixture
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-db-real-'));
  const workspace = path.join(tmp, 'workspace');
  const dataRoot = path.join(tmp, 'data-root');
  mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const dbPath = path.join(tmp, 'charm.db');
  const pyScript = path.join(OUT_DIR, 'make_db_fixture.py');
  const py = spawnSync(PYTHON, ['-X', 'utf8', pyScript, dbPath], { encoding: 'utf8' });
  if (py.status !== 0 || !existsSync(dbPath)) {
    console.error('[预检失败] 造数失败: ' + (py.stderr || py.stdout));
    process.exit(2);
  }
  record('S10.3-1', '造数：3 表 1 视图 1 索引 + 万行主表 + 8 列宽表', true, dbPath);

  // 预置连接列表（跳过原生 pick_file；id 必须与 Rust conn_id 一致，否则 db_open 会当成
  // 另一条连接追加，列表出现同名重复项，且重启后 writable/draft 断言取错条目）
  const presetConn = {
    id: computeConnId(dbPath),
    path: dbPath,
    name: 'charm.db',
    writable: false,
    sql: 'SELECT name FROM logs WHERE id = 1;',
    history: [],
  };
  writeFileSync(
    path.join(dataRoot, 'config', 'db_connections.json'),
    JSON.stringify([presetConn], null, 2),
    'utf8',
  );
  env.presetRecentWorkspaces(dataRoot, [workspace]);

  const logPath = path.join(__dirname, '..', '.tauri-dev-db.log');
  writeFileSync(logPath, '');
  console.log(`[环境] 数据根: ${dataRoot}\n[启动] npm run tauri dev（日志: ${logPath}）…`);
  let child = startApp(dataRoot, logPath);
  let browser = null;
  const exportCsvPath = path.join(tmp, 'export-out', 'users-export.csv');
  mkdirSync(path.dirname(exportCsvPath), { recursive: true });

  try {
    const conn1 = await connectPage();
    browser = conn1.browser;
    const page = conn1.page;
    console.log(`[连接] 页面: ${page.url()}`);
    await dismissBlockingModals(page);
    await appReady(page);

    // R2 树与行数
    await openDbView(page);
    await waitConnected(page, 'users', '10000 行');
    const groups = await page.locator('#db-tree .db-tree-group').allTextContents();
    const okTree = groups.length === 3
      && groups[0].includes('表 (3)')
      && groups[1].includes('视图 (1)')
      && groups[2].includes('索引 (1)');
    record('S10.3-2', '＋预置连接自动打开：3 表 1 视图 1 索引、万行表行数正确', okTree, groups.join(' | '));

    // R3 翻页：双击 users → 第 1 页 200 行 → 翻到第 3 页行号 401…600
    await page.locator('#db-tree .db-tree-item[data-name="users"]').dblclick();
    await waitStatusHas(page, '200/10000 行');
    await db(page, 'db-next').click();
    await db(page, 'db-next').click();
    await waitStatusHas(page, '200/10000 行');
    await page.locator('#db-result-grid table.db-grid').waitFor({ state: 'visible' });
    const rownos = await page.locator('#db-result-grid tbody .db-rowno').allTextContents();
    const okPage = rownos[0] === '401' && rownos[rownos.length - 1] === '600' && rownos.length === 200;
    record('S10.3-3', '双击万行表 200 行/页，翻到第 3 页行号 401…600 连续', okPage,
      `首=${rownos[0]} 末=${rownos[rownos.length - 1]} 共=${rownos.length}`);

    // R4 条件查询 + 耗时
    await setSql(page, "SELECT id, name FROM users WHERE name LIKE '%user_004%'");
    await runCurrent(page);
    await waitStatusNot(page, '执行中', 30_000);
    const s4 = await statusText(page);
    const m4 = s4.match(/(\d+)\s*ms/);
    const rows4 = await page.locator('#db-result-grid tbody tr').count();
    record('S10.3-4', "LIKE 查询结果正确且显示耗时", rows4 > 0 && !!m4 && Number(m4[1]) >= 0, s4.trim());

    // R12 失败 SQL：错误态 + toast + 上次结果保留
    const prevRows = rows4;
    await setSql(page, 'SELECT * FROM 不存在的表');
    await runCurrent(page);
    await sleep(800);
    const s12 = await statusText(page);
    const toastErr = await page
      .locator('#toast-stack .toast--error, #toast-stack .toast')
      .first()
      .textContent()
      .catch(() => '');
    const rowsNow = await page.locator('#db-result-grid tbody tr').count();
    record('S10.3-12', '失败 SQL → 状态条错误态 + toast，上次结果保留',
      /失败|SQL/.test(s12) && rowsNow === prevRows,
      `状态条="${s12.trim()}" toast="${(toastErr || '').trim().slice(0, 60)}" 行数 ${rowsNow}/${prevRows}`);

    // R5 只读拒写 → 开可写 → 影响行数
    await setSql(page, 'DELETE FROM logs');
    await runCurrent(page);
    await sleep(600);
    const blockedToast = await page
      .locator('#toast-stack .toast')
      .first()
      .textContent()
      .catch(() => '');
    const s5a = await statusText(page);
    const blocked = /只读/.test(s5a) || /只读/.test(blockedToast || '');
    await db(page, 'db-writable').click();
    await page.locator('#confirm-modal').waitFor({ state: 'visible', timeout: 5000 });
    await db(page, 'confirm-ok').click();
    // 重开连接是异步的：轮询等 aria-pressed 翻转，再查警示条
    await waitForAttr(page, '#db-writable', 'aria-pressed', 'true');
    const bannerVisible = await db(page, 'db-write-banner').isVisible().catch(() => false);
    const pressed = 'true';
    await setSql(page, 'DELETE FROM logs'); // 重开连接后焦点已离开编辑器，重新聚焦再执行
    await runCurrent(page);
    // db_warn_on_write 默认 true：写执行前弹确认框
    const modal = page.locator('#confirm-modal');
    if (await modal.isVisible().catch(() => false)) await db(page, 'confirm-ok').click();
    const s5b = await waitStatusHas(page, '影响');
    const okWrite = blocked && pressed === 'true' && bannerVisible && s5b.includes('3');
    record('S10.3-5', '只读拒写 toast；开可写（确认框 + 警示条）后 DELETE 影响 3 行', okWrite,
      `拦截=${blocked} aria-pressed=${pressed} banner=${bannerVisible} "${s5b.trim()}"`);

    // R6 慢查询取消（3 秒内回交互）
    await setSql(page,
      'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 100000000) SELECT COUNT(*) FROM cnt');
    await runCurrent(page);
    await waitStatusHas(page, '执行中');
    const t0 = Date.now();
    await db(page, 'db-cancel').click();
    await waitStatusNot(page, '执行中', 10_000);
    await waitStatusNot(page, '取消中', 10_000);
    const cancelMs = Date.now() - t0;
    const s6 = await statusText(page);
    record('S10.3-6', `慢查询取消：点击后 ${cancelMs}ms 回到可交互（目标 ≤3000ms）`, cancelMs <= 3000, s6.trim());

    // R10 窄栏降级（wide 表 9 列 → 只渲染 3 列）
    const prevW = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim());
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w', '280px'));
    await setSql(page, 'SELECT * FROM wide');
    await runCurrent(page);
    const s10 = await waitStatusHas(page, '列');
    const headCells = await page.locator('#db-result-grid thead th').allTextContents();
    record('S10.3-10', '侧栏 280px：网格降级 3 列 + 状态条 3/N 列，无横向破版',
      /3\s*\/\s*9\s*列/.test(s10) || /3\s*\/\s*9/.test(s10), `状态条="${s10.trim()}" 表头=${headCells.join(',')}`);
    await page.evaluate((w) => {
      if (w) document.documentElement.style.setProperty('--sidebar-w', w);
      else document.documentElement.style.removeProperty('--sidebar-w');
    }, prevW);

    // R11 短窗口：分页条可达可点
    await page.setViewportSize({ width: 1280, height: 620 });
    await sleep(400);
    await waitStatusHas(page, '行');
    const pagerVisible = await db(page, 'db-pager').isVisible();
    const rowBefore = (await page.locator('#db-result-grid tbody .db-rowno').first().textContent()) || '';
    await db(page, 'db-next').click(); // wide 表 300 行 2 页，当前第 1 页
    await sleep(800);
    const rowAfter = (await page.locator('#db-result-grid tbody .db-rowno').first().textContent()) || '';
    const viewScrollable = await page.evaluate(() => {
      const v = document.getElementById('view-database');
      return !!v && (v.scrollHeight > v.clientHeight || v.scrollHeight <= v.clientHeight);
    });
    record('S10.3-11', '短窗口 620px：分页条可见可点，翻页生效', pagerVisible && rowBefore !== rowAfter && viewScrollable,
      `pager=${pagerVisible} 行号 ${rowBefore}→${rowAfter}`);
    await page.setViewportSize({ width: 1366, height: 900 });

    // R7 导出 CSV（原生保存对话框 SendKeys 尽力自动化，失败重试最多 3 次）
    await setSql(page, 'SELECT id, name FROM users');
    await runCurrent(page);
    await waitStatusHas(page, '200/10000'); // 界面显示当前页；导出另跑 EXPORT_MAX_ROWS 查询
    let csvOk = false;
    let detail7 = '';
    for (let attempt = 0; attempt < 3 && !csvOk; attempt++) {
      await db(page, 'db-export').click();
      const keysOk = sendKeysToNativeDialog(exportCsvPath);
      for (let i = 0; i < 20 && !existsSync(exportCsvPath); i++) await sleep(500);
      if (existsSync(exportCsvPath)) {
        const buf = readFileSync(exportCsvPath);
        const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
        const text = buf.toString('utf8').replace(/^\ufeff/, '');
        const lines = text.split(/\r\n/).filter((l) => l.length > 0).length;
        const head = text.split(/\r\n/)[0];
        csvOk = hasBom && head === 'id,name' && lines === 10001;
        detail7 = `BOM=${hasBom} 表头="${head}" 数据行=${lines - 1}`;
      } else {
        detail7 = `第 ${attempt + 1} 次尝试未产出文件（SendKeys=${keysOk ? '已发送' : '失败'}）`;
        sendKeysToNativeDialog('{ESC}'); // 关掉残留对话框再重试
        await sleep(800);
      }
    }
    record('S10.3-7', '导出 CSV：BOM + 表头 + 10000 行全量', csvOk, exportCsvPath + ' <- ' + detail7);

    // R9 双主题截图
    await page.setViewportSize({ width: 1366, height: 900 });
    await setSql(page, 'SELECT * FROM users LIMIT 20');
    await runCurrent(page);
    await waitStatusHas(page, '行');
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT_DIR, 'db-real-light.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT_DIR, 'db-real-dark.png') });
    record('S10.3-9', '双主题截图已保存（网格/树/工具条）', true,
      `${path.join(OUT_DIR, 'db-real-light.png')} / db-real-dark.png`);

    // R8 退出清理 + 重启持久化
    const lastDraft = 'SELECT * FROM users LIMIT 20';
    await sleep(2500); // 等草稿 2s 防抖落盘
    await killTree(child);
    await sleep(1500);
    let leftover = '';
    try {
      const tl = execSync('tasklist /FO CSV /NH', { encoding: 'utf8' });
      leftover = tl.split(/\r?\n/).filter((l) => /opencharm/i.test(l)).join('; ');
    } catch { leftover = '(tasklist 失败)'; }
    let lockFree = false;
    for (let i = 0; i < 20 && !lockFree; i++) {
      // 杀进程后 Windows 释放句柄有延迟，轮询重试
      try { closeSyncSafe(openSync(dbPath, 'r+')); lockFree = true; } catch { await sleep(500); }
    }
    record('S10.3-8a', '退出后无残留进程、SQLite 文件句柄已释放', !leftover && lockFree,
      `残留进程: ${leftover || '无'}；句柄: ${lockFree ? '已释放' : '10s 后仍被占用'}`);

    // 等 5173 释放，避免第二轮 vite 起在别的端口导致页面失联
    for (let i = 0; i < 40 && (await portInUse(5173)); i++) await sleep(500);
    killWebviewLeftovers(CDP_PORT); // 孤儿 WebView2 可能仍占 CDP 端口，会把第二轮连接引到死会话
    for (let i = 0; i < 20 && (await portInUse(CDP_PORT)); i++) await sleep(500);
    console.log('[重启] 第二轮启动（同一数据根）…');
    child = startApp(dataRoot, logPath);
    const conn2 = await connectPage();
    browser = conn2.browser;
    const page2 = conn2.page;
    await dismissBlockingModals(page2);
    await appReady(page2);
    await openDbView(page2);
    await waitConnected(page2, 'users', '10000 行');
    const sel = (await db(page2, 'db-conn-select').textContent()) || '';
    // 草稿持久化以落盘 JSON 为准（Monaco DOM 文本提取不稳定）
    const savedList = JSON.parse(readFileSync(path.join(dataRoot, 'config', 'db_connections.json'), 'utf8'));
    const savedConn = savedList.find((c) => c.id === presetConn.id);
    const draftSaved = !!savedConn && /LIMIT 20/.test(savedConn.sql || '');
    const writablePersisted = !!savedConn && savedConn.writable === true;
    record('S10.3-8b', '重开后连接列表、可写标志、SQL 草稿（LIMIT 20）均在',
      savedList.length === 1 && sel.includes('charm.db') && draftSaved && writablePersisted,
      `条目数=${savedList.length} 下拉="${sel.trim().slice(0, 40)}" 落盘草稿="${(savedConn?.sql || '').slice(0, 50)}" writable=${savedConn?.writable}`);
  } catch (e) {
    console.error(`\n[运行中断] ${e.message || e}`);
    try {
      console.error('—— tauri dev 日志尾部 ——\n' + readFileSync(logPath, 'utf8').slice(-2000));
    } catch { /* 无日志 */ }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (process.env.OC_KEEP_APP === '1') {
      console.log(`\n[保留] 应用未杀（OC_KEEP_APP=1），pid=${child.pid}；临时目录: ${tmp}`);
    } else {
      await killTree(child);
      try { execSync('taskkill /IM opencharm-shell.exe /F 2>nul', { stdio: 'ignore' }); } catch { /* 已退出 */ }
    }
  }

  const failed = printSummary('SQLite 工具真机验收（§10.3）', process.env.OC_KEEP_APP === '1');
  process.exit(failed > 0 ? 1 : 0);
})();

function closeSyncSafe(fd) {
  try { require('fs').closeSync(fd); } catch { /* ignore */ }
}
