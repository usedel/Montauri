/**
 * 新建 FastAPI 项目真机（Real App）CDP 验收脚本 — NP-REAL-1..4
 * （对应 docs/pycharm_framework_support_report.md §8.3.1 F9；用户实测报告
 *   「创建 fastapi 服务项目，依赖安装报 invalid type: null, expected a string」——
 *   前端 pip_install 传 interpreter: null，而 Rust 签名是 interpreter: String，
 *   Tauri 反序列化直接报类型错。浏览器 e2e 的 mock 对 pip_install 静态返回 0、
 *   不校验参数类型，**复现不了**——跨层参数类型契约必须真机验收。）
 *
 * 与 e2e/ux/03-new-project-fastapi.spec.ts（浏览器 mock）分层：
 *   mock 面验证 UI 流程与落盘形状；本脚本驱动真实 Tauri 应用 + 真实 uv，
 *   验证 create_project（Rust）→ pip_install（Rust，参数反序列化 + 真实 uv add）全链路。
 *
 * 用法：
 *   cd shell
 *   node e2e-real/new-project-fastapi-real.cjs
 *
 * 环境变量：
 *   OC_PARENT        项目父目录（默认 %TEMP%\oc-np-real-<n>，脚本自建自清）
 *   OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP   同 endpoints-real.cjs
 *   OC_SKIP_INSTALL  =1 时跳过依赖安装检查（离线环境；只验创建与模板落盘）
 *
 * 判定：
 *   NP-REAL-1  欢迎页 → 新建项目面板 → 类型下拉存在且默认 script
 *   NP-REAL-2  选 fastapi 创建 → 工作区切换 + main.py 打开 + 模板/依赖落盘
 *   NP-REAL-3  依赖安装无「invalid type / interpreter」错误（修复前态 = 复现）
 *   NP-REAL-4  uv add 实际完成（pyproject 依赖已装或 uv.lock 生成；best-effort 口径）
 *   NP-REAL-5  （体验审查 C-1）创建收尾环境级联：workspaces 配置里 interpreter == 新建 .venv，
 *              且数据根日志中 venv 落盘后出现 dep_scan interpreter=true → lsp_stop 重启序列
 *   NP-REAL-6  （体验审查 L-4）create_venv 在途切工作区 → 结果丢弃：新工作区配置未被旧 .venv
 *              污染 + 旧工作区配置未被改写 + 丢弃 toast；在途窗口由「需下载」Python 版本天然制造
 *
 *   C-1/L-4 判据来源：docs/project_dep_health_ux_review.md §6。
 *
 *   ⚠ 两条判据都取磁盘侧证据：Tauri 2.11 对 __TAURI_INTERNALS__.invoke 用
 *   Object.defineProperty(value) 定义（writable=false / configurable=false），
 *   赋值包装层静默失效，**前端 invoke 调用链不可拦截**（2026-10-11 实测）。
 */
'use strict';

const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, openSync, rmSync, realpathSync, statSync } = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// 路径归一（对齐 Rust strip_verbatim_prefix + Windows 小写）：比较 workspaceRoot / 解释器路径用
function normPath(p) {
  return String(p || '').replace(/\//g, '\\').replace(/^\\\\\?\\/, '').toLowerCase();
}

// 复算 project_hash（file_ops.rs::project_hash 镜像）：sha1 前 6 字节 = 12 hex
function projectHash(root) {
  const real = realpathSync(root);
  const norm = normPath(real);
  return crypto.createHash('sha1').update(norm, 'utf8').digest('hex').slice(0, 12);
}
// 只借启动看门狗：exe / tauri dev 起不来时快速失败，不干等 cdpTimeout
// record/results/printSummary 一律用共享层：本脚本原先自带一份 results，
// 而 writeJsonSummary 读的是 real-env 的 results → JSON 永远 total=0（2026-10-07 踩到）
const {
  waitCdpReadyWatched, writeJsonSummary, gitHead, record, printSummary,
} = require('./lib/real-env.cjs');

const CDP_PORT = Number(process.env.OC_CDP_PORT || 9224);
const CDP_TIMEOUT_MS = Number(process.env.OC_CDP_TIMEOUT || 600) * 1000;
const KEEP_APP = process.env.OC_KEEP_APP === '1';
const SKIP_INSTALL = process.env.OC_SKIP_INSTALL === '1';
const DEV_URL_HOST = 'localhost:5173';
const PROJ_NAME = 'demo-api-real';

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

// TCP 双栈探测（不是 HTTP /json/version——vite 5173 没有该端点，预检会形同虚设）
function portInUse(port) {
  const probe = (host) => new Promise((resolve) => {
    const sock = net.connect({ port, host });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* 已关闭 */ }
      resolve(v);
    };
    sock.setTimeout(1200, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then(([v4, v6]) => v4 || v6);
}

function tail(text, n) { return text.length <= n ? text : '...' + text.slice(-n); }

async function dismissBlockingModals(page) {
  // 首启「落位提示」等一次性弹窗（fresh 数据根会触发）。只点 primary（确认类）按钮——
  // 不能按序全点：storage-onboarding 的「自定义位置…」会拉起原生目录选择框阻塞整个 UI。
  // 新建项目面板本身是 modal，但其 modal-actions 无 primary class（创建/取消都是 .btn），
  // 不在误伤面内。
  for (let i = 0; i < 6; i++) {
    const np = page.locator('#new-project-modal:not(.hidden)');
    if (await np.count()) { /* 新建面板开着：留给用例自己操作 */ return; }
    const btns = page.locator('.modal-card:visible .modal-actions .btn--primary');
    const n = await btns.count().catch(() => 0);
    if (n === 0) return;
    for (let j = 0; j < n; j++) await btns.nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(400);
  }
}

/** 收集输出面板全部文本（安装错误会以 stderr 行呈现；invalid args 错误走 catch 的 stderr 行） */
async function outputText(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#output .out-line')).map((e) => e.textContent || '').join('\n'));
}

async function runChecks(page, projRoot, dataRoot) {
  await dismissBlockingModals(page);

  // NP-REAL-1 欢迎页（空数据根 → 无最近工作区）→ 新建项目面板 → 类型下拉
  // 真机时序坑：#ew-new-project 的 click 监听器在 main.ts init 尾部（wireNewProject）才挂，
  // 而 DOM 元素静态渲染即"可见"——CDP 连上就点会落空（mock e2e 因 invoke 全同步 init 极快，
  // 掩盖此差异）。用「点击 → 验证面板打开 → 重试」循环替代裸 click。
  const typeSel = page.locator('#new-project-type');
  let panelOpened = false;
  let lastErr = '';
  for (let i = 0; i < 20 && !panelOpened; i++) {
    await dismissBlockingModals(page); // 首启落位弹窗可能在等待期间弹出
    try {
      await page.locator('#ew-new-project').click({ timeout: 3000 });
      await typeSel.waitFor({ state: 'visible', timeout: 2500 });
      panelOpened = true;
    } catch (e) {
      lastErr = String(e).split('\n')[0];
    }
  }
  if (!panelOpened) {
    record('NP-REAL-1', '新建项目面板可打开（点击重试循环）', false, lastErr);
    return;
  }
  const defVal = await typeSel.inputValue();
  const hasFastapiOpt = await typeSel.locator('option[value="fastapi"]').count();
  if (defVal === 'script' && hasFastapiOpt > 0) {
    record('NP-REAL-1', '新建项目面板：类型下拉存在，默认 script，含 fastapi 选项', true);
  } else {
    record('NP-REAL-1', '新建项目面板：类型下拉存在，默认 script，含 fastapi 选项', false,
      `默认值=${defVal}，fastapi 选项=${hasFastapiOpt}`);
    return;
  }

  // NP-REAL-2 填表（环境=venv 默认）→ 创建 → 工作区切换 + 模板/依赖落盘
  await page.locator('#new-project-name').fill(PROJ_NAME);
  await page.locator('#new-project-location').fill(path.dirname(projRoot));
  await typeSel.selectOption('fastapi');
  // 预览行含依赖说明（q2 裁决文案）
  const preview = await page.locator('#new-project-preview').textContent();
  if (!preview || !preview.includes('fastapi / uvicorn 依赖')) {
    record('NP-REAL-2', '预览行含 fastapi / uvicorn 依赖说明', false, `实际：${preview}`);
    return;
  }
  // 注：C-1/L-4 的证据一律取磁盘侧（workspaces 配置 + 数据根日志）——实测 Tauri 2.11 对
  // __TAURI_INTERNALS__.invoke 用 Object.defineProperty(value) 定义（writable=false、
  // configurable=false），赋值包装层会静默失效，前端调用链不可拦截。
  await page.locator('#new-project-create').click();

  // 工作区切换（#tree-header-text 显示项目名）+ main.py 打开
  try {
    await page.locator('#tree-header-text').filter({ hasText: PROJ_NAME }).waitFor({ timeout: 30000 });
    await page.locator('#tabbar .tab.active .name', { hasText: 'main.py' }).waitFor({ timeout: 20000 });
  } catch (e) {
    record('NP-REAL-2', '创建后工作区切换 + main.py 打开', false, String(e).split('\n')[0]);
    return;
  }
  const mainPy = readFileSync(path.join(projRoot, 'main.py'), 'utf8');
  const pyproject = readFileSync(path.join(projRoot, 'pyproject.toml'), 'utf8');
  const tplOk = mainPy.includes('app = FastAPI(') && mainPy.includes('@app.get("');
  const depOk = pyproject.includes('"fastapi"') && pyproject.includes('"uvicorn"');
  if (tplOk && depOk) {
    record('NP-REAL-2', `创建落盘：FastAPI 模板 + pyproject 依赖（${projRoot}）`, true);
  } else {
    record('NP-REAL-2', `创建落盘：FastAPI 模板 + pyproject 依赖`, false,
      `模板=${tplOk} 依赖=${depOk} | pyproject=${tail(pyproject, 200)}`);
    return;
  }

  // NP-REAL-3 依赖安装不报「invalid args / invalid type」错误（修复前态 = 用户报错复现）
  // 等安装阶段收尾（面板关闭 + busy 复位；uv add 真实跑，最长给 180s）
  await page.locator('#new-project-modal').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  let installErr = null;
  for (let i = 0; i < 60; i++) {
    const text = await outputText(page);
    if (/invalid (args|type)|expected a string|invalid type: null/.test(text)) { installErr = text.match(/.*(invalid (args|type)|expected a string|invalid type: null)[^\n]*/)?.[0] || 'matched'; break; }
    if (/uv add fastapi uvicorn/.test(text) && /依赖安装失败/.test(text)) { installErr = '依赖安装失败（非类型错误，见输出）'; break; }
    await sleep(3000);
  }
  if (installErr) {
    record('NP-REAL-3', '依赖安装无类型错误（interpreter: null 契约）', false, `>>> 复现：${installErr}`);
  } else {
    record('NP-REAL-3', '依赖安装无类型错误（interpreter: null 契约）', true);
  }

  // NP-REAL-4 uv add 实际完成（best-effort 口径：uv.lock 生成 或 venv 内已装 fastapi）
  let lockExists = false;
  let venvHasFastapi = false;
  if (!SKIP_INSTALL) {
    lockExists = existsSync(path.join(projRoot, 'uv.lock'));
    try {
      const siteDir = path.join(projRoot, '.venv', 'Lib', 'site-packages');
      venvHasFastapi = existsSync(siteDir) && readFileSync(path.join(siteDir, '..', '..'), 'utf8') !== undefined
        && require('fs').readdirSync(siteDir).some((n) => n.toLowerCase().startsWith('fastapi'));
    } catch { /* venv 未建或结构不同 */ }
  }
  if (SKIP_INSTALL) {
    record('NP-REAL-4', 'uv add 实际完成（OC_SKIP_INSTALL=1 跳过）', true, 'skipped');
  } else if (lockExists || venvHasFastapi) {
    record('NP-REAL-4', `uv add 实际完成（uv.lock=${lockExists} venv含fastapi=${venvHasFastapi}）`, true);
  } else {
    // 失败但非类型错误：best-effort 口径下不算 FAIL，标注 FAIL 便于观察（网络原因安装失败值得看见）
    const text = await outputText(page);
    const lastErr = (text.match(/[^\n]*依赖安装失败[^\n]*/) || ['(未捕获失败行)'])[0];
    record('NP-REAL-4', 'uv add 实际完成（uv.lock / venv 内 fastapi）', false, `${lastErr} | 若为网络原因属 best-effort 边界，人工判定`);
  }

  // —— C-1/L-4 共用判定辅助（对齐 Rust strip_verbatim_prefix + 小写归一）——
  const rootN = normPath(projRoot);
  const isUnderRoot = (p) => { const n = normPath(p); return n === rootN || n.startsWith(rootN + '\\'); };

  // —— NP-REAL-5（体验审查 C-1）：创建收尾环境级联 ——
  // 证据全部磁盘侧：
  // ① workspaces/<hash>.json：interpreter == 新建 .venv 的 python（set_interpreter 落对根、落对路径）
  // ② logs/opencharm.log：pyvenv.cfg 落盘后出现 dep_scan interpreter=true → 随后一次
  //    [lsp_stop]（引擎重启级联 = afterEnvChanged 收尾；修复前 startLsp 只在 venv 存在前跑过一次）
  const projCfg = path.join(dataRoot, 'workspaces', `${projectHash(projRoot)}.json`);
  const venvPyDisk = path.join(projRoot, '.venv', 'Scripts', 'python.exe');
  const venvCfg = path.join(projRoot, '.venv', 'pyvenv.cfg');
  const appLog = path.join(dataRoot, 'logs', 'opencharm.log');
  const msOf = (line) => { const m = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]/); return m ? ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4]) : null; };

  let legA = null;
  let c1Detail = '';
  for (let i = 0; i < 12 && !legA; i++) {
    try {
      if (existsSync(projCfg)) {
        const interp = JSON.parse(readFileSync(projCfg, 'utf8')).interpreter;
        if (typeof interp === 'string' && normPath(interp) === normPath(venvPyDisk)) { legA = interp; break; }
        c1Detail = `配置 interpreter=${interp || '(null)'} · 期望=${venvPyDisk}`;
      } else {
        c1Detail = 'workspaces/<hash>.json 未生成（set_interpreter 未发生）';
      }
    } catch (e) { c1Detail = `配置解析失败：${String(e).split('\n')[0]}`; }
    await sleep(1500);
  }
  let legB = false;
  if (legA) {
    for (let i = 0; i < 12 && !legB; i++) {
      try {
        // 日志行时间戳是 **UTC**（Rust log_line 用 UTC 打印），pyvenv.cfg mtime 是本地时间 ——
        // 两侧必须都按 UTC 折算「当日毫秒」，否则国内 UTC+8 会整体差 8 小时（2026-10-11 实测）
        const tv = new Date(statSync(venvCfg).mtimeMs);
        const tVenvMs = (tv.getUTCHours() * 3600 + tv.getUTCMinutes() * 60 + tv.getUTCSeconds()) * 1000 + tv.getUTCMilliseconds();
        let sawInterpTrue = false;
        for (const line of readFileSync(appLog, 'utf8').split('\n')) {
          let t = msOf(line);
          if (t === null) continue;
          if (t + 43200000 < tVenvMs) t += 86400000; // 跨午夜护栏
          if (t < tVenvMs) continue;
          if (/dep_scan：.*interpreter=true/.test(line)) sawInterpTrue = true;
          if (sawInterpTrue && /\[lsp_stop\] begin engine=/.test(line)) { legB = true; break; }
        }
        if (!legB) c1Detail = '日志级联未现（venv 后无 interpreter=true → lsp_stop 序列）';
      } catch (e) { c1Detail = `日志读取失败：${String(e).split('\n')[0]}`; }
      await sleep(1500);
    }
  }
  if (legA && legB) {
    record('NP-REAL-5', '创建收尾环境级联：.venv 解释器落配置 + 引擎重启级联（C-1）', true, legA);
  } else {
    record('NP-REAL-5', '创建收尾环境级联（C-1）', false, c1Detail);
  }

  // —— NP-REAL-6（体验审查 L-4）：create_venv 在途切工作区 → 结果丢弃 ——
  // 竞态窗口用「需下载」版本的 Python 下载期天然制造（create_venv = uv venv --clear --python X，
  // 未装版本触发联网下载，分钟级在途）；切工作区走真实 openWorkspace 路径（文件菜单
  // 「最近的工作区」子菜单动作，非直接改状态）。判定纯磁盘侧 + toast：
  //   ws2 配置不得出现旧工作区 .venv 解释器（L-4 核心判据）；
  //   pyvenv.cfg 变为下载版本 = 创建确实在切走之后才完成（成功分支被丢弃的完整证据）；
  //   旧工作区配置不得被改指新版本（丢弃 = 任何工作区的配置都不写）。
  const ws2 = path.join(path.dirname(projRoot), 'demo-ws2-real');
  if (!existsSync(ws2)) {
    record('NP-REAL-6', 'create_venv 在途切工作区（L-4）', false, '第二工作区不存在（应为脚本启动时创建）');
    return;
  }
  const ws2cfg = path.join(dataRoot, 'workspaces', `${projectHash(ws2)}.json`);
  const projCfgBefore = existsSync(projCfg) ? readFileSync(projCfg, 'utf8') : null;
  // ws2 登记进最近工作区（真实命令）。不能用启动前预置 recent-workspaces.json：
  // last-session 缺失时会回落 recents[0] 自动开工作区，破坏整套前置流程。
  await page.evaluate(async (p) => { await window.__TAURI_INTERNALS__.invoke('add_recent_workspace', { path: p }); }, ws2).catch(() => {});
  try {
    await page.locator('#status-interpreter').click();
    await page.locator('#env-modal:not(.hidden)').waitFor({ timeout: 8000 });
    await page.locator('#interp-trigger').click();
    const act = page.locator('#interp-popover .interp-action').first();
    await act.waitFor({ timeout: 5000 });
    await act.click();
    // 项目已有 .venv → 重建走 danger 确认（openConfirm kind=danger 的 ok 按钮是 btn--danger）
    const danger = page.locator('.modal-card:visible .modal-actions .btn--danger').first();
    if (await danger.count()) await danger.click({ force: true });
    await page.locator('#venv-version-modal:not(.hidden)').waitFor({ timeout: 8000 });
  } catch (e) {
    record('NP-REAL-6', 'create_venv 在途切工作区（L-4）', false, `打开版本弹窗失败：${String(e).split('\n')[0]}`);
    return;
  }
  const dlItem = page.locator('#venv-version-list .venv-version-item').filter({ hasText: /需下载|download required/ }).first();
  if (!(await dlItem.count())) {
    record('NP-REAL-6', 'create_venv 在途切工作区（L-4）', false, '版本列表无「需下载」项（无法天然制造在途窗口）');
    return;
  }
  const dlVer = ((await dlItem.textContent()) || '').trim().match(/^([\d.]+)/)?.[1] || '?';
  const oldVenvCfg = existsSync(venvCfg) ? readFileSync(venvCfg, 'utf8') : '';
  await dlItem.click();
  // 确认 create_venv 已起跑：输出面板出现命令行 echo（beginLongOp 记录）
  try {
    await page.waitForFunction(() => /uv venv \.venv --python/.test((document.querySelector('#output') || {}).textContent || ''), null, { timeout: 15000 });
  } catch {
    record('NP-REAL-6', 'create_venv 在途切工作区（L-4）', false, 'create_venv 未起跑（输出面板未见 uv venv 命令行）');
    return;
  }
  // 在途切换（真实 openWorkspace：teardown → resetWorkspaceUiState → 开 ws2）
  try {
    await page.evaluate(async (p) => {
      const norm = (s) => String(s || '').replace(/\//g, '\\').replace(/^\\\\\?\\/, '').toLowerCase();
      const m = await import('/src/menuItems.ts');
      const fileMenu = m.getMenuItems('file');
      const recentEntry = fileMenu.find((e) => typeof e.submenu === 'function');
      if (!recentEntry) throw new Error('file menu 无子菜单入口');
      const subs = await recentEntry.submenu();
      const target = subs.find((e) => e.detail && norm(e.detail) === norm(p));
      if (!target) throw new Error('最近工作区缺 ws2: ' + JSON.stringify(subs.map((s) => s.detail || s.label)));
      target.action();
    }, ws2);
    await page.locator('#tree-header-text').filter({ hasText: 'demo-ws2-real' }).waitFor({ timeout: 30000 });
  } catch (e) {
    record('NP-REAL-6', 'create_venv 在途切工作区（L-4）', false, `切换工作区失败：${String(e).split('\n')[0]}`);
    return;
  }
  // 竞态是否真正发生：切换完成时刻早于 venv 重建完成时刻才算「在途切走」
  const tSwitch = Date.now();
  // 等 create_venv 落地（下载 + 重建，最长 5min）：pyvenv.cfg 变为下载版本 + 丢弃 toast
  let toastSeen = false;
  let venvRebuilt = false;
  for (let i = 0; i < 150 && !(venvRebuilt && toastSeen); i++) {
    if (!toastSeen) {
      const txt = await page.evaluate(() => Array.from(document.querySelectorAll('#toast-stack .toast-text')).map((e) => e.textContent || '').join('\n'));
      if (/已切换工作区|Workspace changed/.test(txt)) toastSeen = true;
    }
    if (!venvRebuilt && existsSync(venvCfg)) {
      const cur = readFileSync(venvCfg, 'utf8');
      if (cur !== oldVenvCfg && cur.includes(`version_info = ${dlVer.split('.').slice(0, 2).join('.')}`)) venvRebuilt = true;
    }
    if (!(venvRebuilt && toastSeen)) await sleep(2000);
  }
  const ws2cfgAfter = existsSync(ws2cfg) ? readFileSync(ws2cfg, 'utf8') : null;
  let cfgClean = true;
  let cfgNote = '';
  if (ws2cfgAfter) {
    try {
      const interp = JSON.parse(ws2cfgAfter).interpreter;
      if (typeof interp === 'string' && isUnderRoot(interp)) { cfgClean = false; cfgNote = `ws2 配置解释器被旧工作区 .venv 污染：${interp}`; }
    } catch { cfgClean = false; cfgNote = 'ws2 配置解析失败'; }
  }
  let projUnchanged = true;
  let projNote = '';
  if (venvRebuilt && projCfgBefore) {
    try {
      const interp = JSON.parse(readFileSync(projCfg, 'utf8')).interpreter;
      if (typeof interp === 'string' && interp.includes(dlVer.split('.').slice(0, 2).join('.'))) {
        projUnchanged = false; projNote = '旧工作区配置被改指新版本（丢弃分支未生效）';
      }
    } catch (e) { projUnchanged = false; projNote = `配置解析失败：${String(e).split('\n')[0]}`; }
  }
  // 创建在切走之前就已收尾 = 竞态没发生（本机该 Python 版本已缓存），判据不可判定而非失败
  const venvMtime = existsSync(venvCfg) ? statSync(venvCfg).mtimeMs : 0;
  const completedBeforeSwitch = venvMtime > 0 && venvMtime <= tSwitch;
  if (cfgClean && venvRebuilt && toastSeen && projUnchanged) {
    record('NP-REAL-6', 'create_venv 在途切工作区 → 结果丢弃（L-4）', true,
      `toast 可见 · 创建在切走后完成（pyvenv.cfg→${dlVer}）· ws2 配置未污染 · 旧配置未被改写`);
  } else {
    const why = completedBeforeSwitch
      ? '不可判定：创建在切换前已收尾（本机该 Python 版本已缓存，未产生在途窗口）——需换未缓存版本或清 uv 缓存后重跑'
      : !venvRebuilt ? '创建未在窗口内完成（下载失败或超慢，成功分支未被丢弃路径覆盖）'
        : !toastSeen ? '未见丢弃 toast（创建完成但丢弃 UI 信号缺失）'
          : !cfgClean ? cfgNote
            : !projUnchanged ? projNote : '未知';
    record('NP-REAL-6', 'create_venv 在途切工作区（L-4）', false, why);
  }
}

(async () => {
  // 汇总元信息 + 预检失败出口：不落 JSON 的话，run-real-all 与 nightly 只会看到
  // 「无报告（未启动？）」，分不清「没跑」和「跑了失败」（2026-10-07 实测踩到）
  const t0 = Date.now();
  const suiteMeta = { suite: 'new-project-fastapi-real', cdpPort: CDP_PORT, headCommit: gitHead() };
  function precheckFail(msg) {
    console.error(`[预检失败] ${msg}`);
    writeJsonSummary({ ...suiteMeta, durationMs: Date.now() - t0, error: msg });
    process.exit(2);
  }

  if (await portInUse(5173)) precheckFail('5173 已被占用（可能已有 vite / tauri dev 在跑），请先停掉再运行本脚本。');
  if (await portInUse(CDP_PORT)) precheckFail(`CDP 端口 ${CDP_PORT} 已被占用（可能残留上一次会话）。`);

  // 项目父目录：默认临时目录（自建自清）；OC_PARENT 可指定（如 D:\logs）——不复用真实用户目录
  const parentDir = process.env.OC_PARENT || path.join(os.tmpdir(), `oc-np-real-${Date.now()}`);
  mkdirSync(parentDir, { recursive: true });
  const projRoot = path.join(parentDir, PROJ_NAME);
  if (existsSync(projRoot)) {
    precheckFail(`项目目录已存在: ${projRoot}（重名会触发「目标已存在」错误）`);
  }

  // NP-REAL-6 的切换目标：最小第二工作区（启动时落盘）。不预置 recent-workspaces.json——
  // last-session 缺失时 autoOpenRecentWorkspace 会回落 recents[0] 自动开它，破坏欢迎页前置。
  const ws2Root = path.join(parentDir, 'demo-ws2-real');
  mkdirSync(ws2Root, { recursive: true });
  writeFileSync(path.join(ws2Root, 'main.py'), 'print("demo-ws2-real")\n', 'utf8');

  // 隔离数据根：recent-workspaces 为空 → 启动停欢迎页（#ew-actions 可见）
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'oc-np-real-data-'));
  const dataRoot = path.join(tmp, 'data-root');
  mkdirSync(path.join(dataRoot, 'config'), { recursive: true });
  writeFileSync(path.join(dataRoot, 'config', 'recent-workspaces.json'), '[]', 'utf8');
  console.log(`[环境] 项目目录: ${projRoot}\n[环境] 数据根: ${dataRoot}\n[环境] CDP: http://127.0.0.1:${CDP_PORT}${SKIP_INSTALL ? '（跳过安装检查）' : ''}`);

  const logPath = path.join(__dirname, '.tauri-dev-np.log');
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
    const page = ctx.pages().find((p) => p.url().includes(DEV_URL_HOST)) || ctx.pages()[0];
    if (!page) throw new Error('CDP 已连接但未找到应用页面（devUrl=' + DEV_URL_HOST + '）');
    console.log(`[连接] 页面: ${page.url()}`);

    await runChecks(page, projRoot, dataRoot);
  } catch (e) {
    runError = String(e.message || e);
    console.error(`\n[运行中断] ${runError}`);
    try {
      const log = readFileSync(logPath, 'utf8');
      console.error('—— tauri dev 日志尾部 ——\n' + tail(log, 2000));
    } catch { /* 日志可能尚未生成 */ }
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (!KEEP_APP) {
      console.log('\n[清理] taskkill 进程树…');
      try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
      // 项目目录留存于 %TEMP% 由系统清理；不删以便排查（KEEP_APP 同理）
      console.log(`[留存] 项目目录未删（排查用）: ${projRoot}`);
    } else {
      console.log(`\n[保留] 应用未杀（OC_KEEP_APP=1），pid=${child.pid}；项目目录: ${projRoot}`);
    }
  }

  // 用共享层的 printSummary：它读的就是 writeJsonSummary 读的同一份 results
  const failed = printSummary('新建 FastAPI 项目真机验收（NP-REAL）', KEEP_APP);
  writeJsonSummary({ ...suiteMeta, durationMs: Date.now() - t0, error: runError });
  process.exit(exitCode || (failed > 0 ? 1 : 0));
})();
