/**
 * B4 · HTTP 工具真机（Real App）验收 — HR-1..HR-11
 * （P1-4 复核后唯一剩下的真空白；交付记录见 docs/delivery-overview.md §2）
 *
 * 为什么必须有这一层：mock 层（`e2e/http/01-devtools.spec.ts`，12 条）由 tauri-mock
 * 返回**罐头响应**，于是 reqwest 的真实链路**全盲**——真实 TCP 连接、真实响应头、
 * 真实重定向、真实超时、真实二进制判定、真实响应体截断，mock 一条都覆盖不到。
 *
 * 本脚本驱动真实 Tauri 应用 + 真实 reqwest，对打一个**本机 Node HTTP 服务**：
 * 服务端把收到的请求原样记下并回显，前端再把它渲染出来 —— 一条请求被**两端同时观测**，
 * 这是"跨进程链路真的通了"的硬证据（服务端观测到的 `User-Agent: Montauri/0.1`
 * 直接证明请求出自应用内核的 reqwest，而非任何 mock）。
 *
 * 全程离线（不碰外网）。若要额外覆盖 DNS/TLS 公网链路，设 `OC_HTTP_REAL_NET=1`
 * 启用 HR-11（best-effort：网络不通即 FAIL，属已知边界）。
 *
 * 用法：cd shell && node e2e-real/http-real.cjs
 * 环境变量：OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP / OC_REAL_PYTHON（同其余真机脚本）
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const {
  runWithRealApp,
  record,
  sleep,
  dismissBlockingModals,
  presetInterpreter,
  presetRecentWorkspaces,
} = require('./lib/real-env.cjs');

const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'python';
/** 预置 http_timeout_ms：让 HR-6「真实超时」在 3s 内可判（默认 30s 太慢） */
const TIMEOUT_MS = 3000;
/** 慢响应时长（远大于上面的超时，保证 HR-6 必超时） */
const SLOW_MS = 10_000;

/** 可见工具根（实例缓存：切走的工具 root 仍在 DOM 里，断言必须限定可见根） */
const ROOT = '.devtools-tool-root:not(.hidden)';

/**
 * 服务端观测到的请求（由 startServer 填充）。
 * 用途：`sendAndWait` 先等**本次请求真的到达服务端**再等 UI 落定——真机脚本没有
 * mock 那种 `__E2E_HTTP_LAST_REQ__` 直读通道，只盯 UI 会读到**上一条响应的旧状态**
 * （连续两次 200 时必然误判）。
 */
let SERVER_SEEN = [];

// ---------- 本机 HTTP 服务（被测目标） ----------

/**
 * 启动临时服务（127.0.0.1 + 随机端口）。
 * 每个端点带**唯一 tag**，使前端每次响应的内容都不同——否则连续两次 200 无法区分
 * 「新响应已到」与「旧响应还挂着」（真机脚本不像 mock 能查 __E2E_HTTP_LAST_REQ__）。
 */
function startServer() {
  const seen = [];
  /** 分块流的观测：`aborted` = 客户端在服务端吐完前断开了连接（HR-7 用来证明"取消真的断流"） */
  const streams = { started: 0, aborted: 0 };
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('error', () => { /* 客户端中断（取消 / 截断）不致命 */ });
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({
        path: u.pathname,
        query: u.search,
        method: req.method,
        ua: req.headers['user-agent'] || '',
        token: req.headers['x-token'] || null,
        contentType: req.headers['content-type'] || null,
        body,
        at: Date.now(),
      });
      const tag = u.searchParams.get('tag') || 'none';
      const json = (code, obj) => {
        const s = JSON.stringify(obj);
        res.writeHead(code, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(s),
        });
        res.end(s);
      };
      switch (u.pathname) {
        case '/json':
          return json(200, { ok: true, items: [1, 2, 3], tag, note: 'montauri-http-real' });
        case '/echo':
          return json(200, { method: req.method, token: req.headers['x-token'] || null, tag, body });
        case '/redirect':
          res.writeHead(302, { location: `/json?tag=${tag}` });
          return res.end();
        case '/missing':
          return json(404, { detail: 'missing', tag });
        case '/slow':
          return setTimeout(() => json(200, { slow: true, tag }), Number(u.searchParams.get('ms') || SLOW_MS));
        // 分块流：用于「取消在分块边界生效」——mock 只能模拟状态，这里是真的停止读取
        case '/stream': {
          const gap = Number(u.searchParams.get('gap') || 400);
          const n = Number(u.searchParams.get('n') || 25);
          streams.started++;
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
          let i = 0;
          const timer = setInterval(() => {
            if (i++ >= n) { clearInterval(timer); res.end(`\n${tag}\n`); return; }
            res.write(`chunk-${i}-${'x'.repeat(512)}\n`);
          }, gap);
          res.on('close', () => {
            clearInterval(timer);
            if (!res.writableEnded) streams.aborted++;   // 未吐完就被断开 = 客户端真的取消了
          });
          return;
        }
        case '/bytes': {
          const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0xff, 0xfe]);
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
          return res.end(buf);
        }
        case '/big': {
          const n = Number(u.searchParams.get('mb') || 6) * 1024 * 1024;
          // `ct=bin` → 二进制：**HR-9 用它**。前端对文本体是直接塞进 <pre> 的（无渲染上限），
          // 5 MB 文本会让 WebView 卡住若干秒、拖垮后续用例；二进制分支不渲染体，同样能验到
          // 后端 `stopped_early` 截断路径（截断逻辑与 content-type 无关）。
          const ct = u.searchParams.get('ct') === 'bin'
            ? 'application/octet-stream'
            : 'text/plain; charset=utf-8';
          res.writeHead(200, { 'content-type': ct, 'content-length': n });
          return res.end(Buffer.alloc(n, 0x61));
        }
        default:
          return json(200, { path: u.pathname, tag });
      }
    });
  });
  srv.on('clientError', (_e, sock) => { try { sock.destroy(); } catch { /* 已关闭 */ } });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    // 只绑回环：避免触发 Windows 防火墙弹窗（绑 0.0.0.0 会弹），也避免把测试端点暴露到局域网
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, seen, streams }));
  });
}

// ---------- 面板驱动 ----------

/**
 * 首启弹窗若挡住 init（工具链引导 `maybePromptToolchain` 是 `await openConfirm`，
 * 会卡在 `openInitialWorkspace()` 之前 → 文件树永不出现），先点掉它。
 * **刻意避开「立即安装」**：真机上点它会真的开始装 uv/pyrefly（长、需联网），
 * 不是本脚本想要的副作用——共享的 `dismissBlockingModals` 会点所有按钮，故这里另写一个。
 */
async function dismissFirstRunModals(page) {
  for (let i = 0; i < 5; i++) {
    const modal = page.locator('.modal-card:visible').first();
    if ((await modal.count().catch(() => 0)) === 0) return;
    const btns = modal.locator('.modal-actions button');
    const n = await btns.count().catch(() => 0);
    let clicked = false;
    for (let j = 0; j < n; j++) {
      const txt = ((await btns.nth(j).textContent().catch(() => '')) || '').trim();
      if (/稍后|later|取消|cancel|跳过|skip|关闭|close/i.test(txt)) {
        await btns.nth(j).click({ force: true, timeout: 2000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) return; // 只有破坏性按钮（如「立即安装」）→ 不点，留给调用方报错
    await sleep(400);
  }
}

/** 打开 devtools 面板并切到 HTTP 工具（picker 搜索 → Enter） */
async function openHttpTool(page) {
  // —— 就绪判据（首轮真机跑暴露，2026-10-07 17:51）——
  // mock 层等的是 `__TAURI_MOCK_INVOKE_LOG__` 里的 `list_plugin_dirs`；真机没有这个钩子。
  // 可用的 DOM 信号：`wireWindowKeys()`（main.ts:1745，装 Ctrl+Shift+T 的 window keydown）
  // 在 `openInitialWorkspace()`（main.ts:~2109）**之前**，故「文件树出现」⇒ 全局键位已可用。
  // 首轮就是因为按得太早（init 还没走到 1745 行）→ picker 一直 hidden。
  await dismissFirstRunModals(page);
  await page.locator('#tree .tree-item').first().waitFor({ timeout: 60_000 }).catch(() => {});

  // 仍保留重试兜底：工作区为空 / 键位被自定义时，重试能兜住，不把脚本钉死在内部时序上
  let opened = false;
  for (let attempt = 0; attempt < 10 && !opened; attempt++) {
    if ((await page.locator('#right-panel:not(.hidden)').count()) > 0) {
      await page.locator('#devtools-close').click().catch(() => {});
      await sleep(250);
    }
    await page.keyboard.press('Control+Shift+T');
    opened = await page.locator('#devtools-picker')
      .waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
    if (!opened) await sleep(1000);
  }
  if (!opened) {
    throw new Error('Ctrl+Shift+T 连按 10 次仍未打开 devtools picker'
      + '（键位未接线 / 窗口未聚焦 / 首启弹窗仍在挡 init——看 real-reports 截图与 #tree 是否为空）');
  }
  await page.locator('#devtools-picker-search').fill('HTTP 请求');
  await page.keyboard.press('Enter');
  await page.locator(`${ROOT} .http-url`).waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * 展开「请求体」分区。
 * 该 `<details>` 出厂**不 open**（`bodySection` 未设 open，与请求头分区相反），
 * 折叠时内容 display:none → Playwright 的 fill 会因元素不可见而超时。
 * 直接置 open（而不是点 summary）：选择器更稳，也不受动画/命中区域影响。
 */
async function openBodySection(page) {
  await page.evaluate((sel) => {
    const ta = document.querySelector(`${sel} .http-body`);
    const d = ta && ta.closest('details');
    if (d) d.open = true;
  }, ROOT);
}

/** 复位面板（URL / 方法 / 体 / 头行），保证各用例互不污染 */
async function resetPanel(page) {
  await page.locator(`${ROOT} .http-url`).fill('');
  await page.locator(`${ROOT} .http-method`).selectOption('GET');
  await openBodySection(page);
  await page.locator(`${ROOT} .http-body`).fill('');
  // 删头行走 UI 的删除按钮，不直接改 DOM：组件内部 headerRows 数组需同步
  for (let i = 0; i < 10; i++) {
    const del = page.locator(`${ROOT} .http-header-row button`).first();
    if ((await del.count().catch(() => 0)) === 0) break;
    await del.click({ timeout: 2000 }).catch(() => {});
    await sleep(80);
  }
}

/** 一次请求的 UI 快照（全部限定在可见工具根内） */
async function snapshot(page) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    // 根不可见时返回**同形状的空值**而不是 { err }：waitFor 的判据会直接读 statusClass 等字段，
    // 缺字段会抛 TypeError 把整个套件打断（而不是干净地判失败）
    if (!root) {
      return {
        err: 'no-visible-tool-root', status: '', statusClass: '', code: '', codeClass: '', meta: '',
        hints: [], leaves: [], bodyText: '', errSlot: '', headerNames: [], headersSummary: '', hasImage: false,
      };
    }
    const q = (s) => root.querySelector(s);
    const txt = (s) => (q(s)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      status: txt('.http-status'),
      statusClass: q('.http-status')?.className ?? '',
      code: txt('.http-code'),
      codeClass: q('.http-code')?.className ?? '',
      meta: txt('.http-meta'),
      hints: [...root.querySelectorAll('.http-hint')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      leaves: [...root.querySelectorAll('.json-leaf')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      bodyText: txt('.http-resp-body').slice(0, 300),
      errSlot: txt('.tool-error'),
      headerNames: [...root.querySelectorAll('.http-headers-table .http-header-name')].map((e) => e.textContent.trim()),
      headersSummary: txt('.http-section--resp > summary'),
      hasImage: !!q('img.http-image'),
    };
  }, ROOT);
}

/** 轮询直到 pred 满足（返回最后一次快照，由调用方断言） */
async function waitFor(page, pred, timeoutMs = 20_000, interval = 200) {
  const t0 = Date.now();
  let s = await snapshot(page);
  while (!pred(s) && Date.now() - t0 < timeoutMs) {
    await sleep(interval);
    s = await snapshot(page);
  }
  return s;
}

/** 轮询直到 pred() 为真（无 UI，用于等服务端观测） */
async function waitUntil(pred, timeoutMs = 20_000, interval = 100) {
  const t0 = Date.now();
  while (!pred() && Date.now() - t0 < timeoutMs) await sleep(interval);
  return pred();
}

/** 填表 + 发送；settled(s) 为该次响应的完成判据（内容唯一，故不会误判成上一次的旧响应） */
async function sendAndWait(page, { url, method = 'GET', headers = [], body = '' }, settled, timeoutMs = 20_000) {
  await resetPanel(page);
  if (method !== 'GET') await page.locator(`${ROOT} .http-method`).selectOption(method);
  if (body) {
    await openBodySection(page);
    await page.locator(`${ROOT} .http-body`).fill(body);
  }
  for (const [k, v] of headers) {
    await page.locator(`${ROOT} button`, { hasText: '添加头' }).click();
    const row = page.locator(`${ROOT} .http-header-row`).last();
    await row.locator('input').nth(0).fill(k);
    await row.locator('input').nth(1).fill(v);
  }
  const pathname = new URL(url).pathname;
  const n0 = SERVER_SEEN.length;
  await page.locator(`${ROOT} .http-url`).fill(url);
  await page.locator(`${ROOT} button`, { hasText: '发送' }).click();
  // 第一层：本次请求真的到达服务端（否则后续断言可能落在上一条响应上）
  await waitUntil(() => SERVER_SEEN.slice(n0).some((r) => r.path === pathname), 20_000);
  // 第二层：UI 落定
  return waitFor(page, settled, timeoutMs);
}

// ---------- 断言主体 ----------

async function runChecks(s, port, seen, streams) {
  const page = s.page;
  await dismissBlockingModals(page);
  const base = `http://127.0.0.1:${port}`;

  // HR-1 真实跨进程：前端 → invoke → reqwest → 本机服务 → 回包 → JSON 树
  {
    const n0 = seen.length;
    const s1 = await sendAndWait(
      page,
      { url: `${base}/json?tag=r1` },
      (x) => x.leaves.some((t) => t.includes('r1')) || x.statusClass.includes('--err'),
    );
    const req = seen[n0];
    const ok = /200 OK/.test(s1.code)
      && s1.leaves.some((t) => t.includes('montauri-http-real'))
      && s1.leaves.some((t) => t.includes('r1'))
      && req?.ua === 'Montauri/0.1';
    record('HR-1', 'GET JSON：真实 reqwest 打通本机服务（服务端观测到 UA=Montauri/0.1）+ JSON 树渲染',
      ok,
      `code="${s1.code}" meta="${s1.meta}" 服务端观测=${JSON.stringify(req && { path: req.path, ua: req.ua })} 叶子=${JSON.stringify(s1.leaves.slice(0, 8))}`);
  }

  // HR-2 真实响应头到达前端（mock 的头是手写常量，这里必须是服务端真发的）
  {
    const s2 = await sendAndWait(
      page,
      { url: `${base}/json?tag=r2` },
      (x) => x.leaves.some((t) => t.includes('r2')) || x.statusClass.includes('--err'),
    );
    const names = s2.headerNames.map((n) => n.toLowerCase());
    const ok = names.includes('content-type') && names.includes('content-length') && /响应头（\d+）/.test(s2.headersSummary);
    record('HR-2', '真实响应头到达并列出（content-type / content-length 来自服务端实发）', ok,
      `摘要="${s2.headersSummary}" 头名=${JSON.stringify(s2.headerNames.slice(0, 8))}`);
  }

  // HR-3 POST + 自定义头 + 请求体：服务端原样回显 → 前端渲染出回显内容
  {
    const n0 = seen.length;
    const s3 = await sendAndWait(
      page,
      { url: `${base}/echo?tag=r3`, method: 'POST', headers: [['X-Token', 't-123']], body: '{"a":1}' },
      (x) => x.leaves.some((t) => t.includes('t-123')) || x.statusClass.includes('--err'),
    );
    const req = seen[n0];
    const ok = req?.method === 'POST' && req.token === 't-123' && req.body === '{"a":1}'
      && s3.leaves.some((t) => t.includes('t-123'))
      && s3.leaves.some((t) => t.includes('POST'));
    record('HR-3', 'POST + 自定义头 + 请求体：服务端收到 method/token/body 并回显进前端', ok,
      `服务端观测=${JSON.stringify(req && { method: req.method, token: req.token, body: req.body })} 叶子=${JSON.stringify(s3.leaves.slice(0, 8))}`);
  }

  // HR-4 重定向跟随（真链路；mock 无法产生真实 302）
  {
    const n0 = seen.length;
    const s4 = await sendAndWait(
      page,
      { url: `${base}/redirect?tag=r4` },
      (x) => x.leaves.some((t) => t.includes('r4')) || x.statusClass.includes('--err'),
    );
    const paths = seen.slice(n0).map((r) => r.path);
    const ok = /200 OK/.test(s4.code) && paths.includes('/redirect') && paths.includes('/json');
    record('HR-4', '302 重定向真实跟随：最终 200 且服务端收到 /redirect → /json 两次请求', ok,
      `code="${s4.code}" 服务端路径序列=${JSON.stringify(paths)}`);
  }

  // HR-5 404 不是错误态（只换颜色）
  {
    const s5 = await sendAndWait(
      page,
      { url: `${base}/missing?tag=r5` },
      (x) => /404/.test(x.code) || x.statusClass.includes('--err'),
    );
    const ok = /404 Not Found/.test(s5.code) && s5.codeClass.includes('http-code--degraded')
      && !s5.statusClass.includes('--err') && s5.errSlot === '';
    record('HR-5', '404 不是错误态：状态码降级配色，无错误提示', ok,
      `code="${s5.code}" codeClass="${s5.codeClass}" statusClass="${s5.statusClass}" err="${s5.errSlot}"`);
  }

  // HR-6 真实超时（预置 http_timeout_ms=3000，打 10s 的慢端点）
  {
    const s6 = await sendAndWait(
      page,
      { url: `${base}/slow?tag=r6&ms=${SLOW_MS}` },
      (x) => x.statusClass.includes('--err') || /超时/.test(x.errSlot),
      TIMEOUT_MS + 12_000,
    );
    const ok = s6.statusClass.includes('--err') && /超时|timeout/i.test(`${s6.errSlot} ${s6.status}`);
    record('HR-6', `真实超时：${TIMEOUT_MS}ms 内未完成即报错（reqwest timeout 真链路）`, ok,
      `statusClass="${s6.statusClass}" status="${s6.status}" err="${s6.errSlot}"`);
  }

  // HR-7 取消在分块边界生效（服务端持续吐块；取消后前端回落 idle 且**服务端观测到断流**）
  {
    await resetPanel(page);
    await page.locator(`${ROOT} .http-url`).fill(`${base}/stream?tag=r7&gap=400&n=25`);
    const aborted0 = streams.aborted;
    await page.locator(`${ROOT} button`, { hasText: '发送' }).click();
    // 注意：sending 与 cancelling 共用 `--pending` 类（statusKind 不区分），故用文案区分阶段
    const s7a = await waitFor(page, (x) => x.statusClass.includes('--pending'), 8000);
    await page.locator(`${ROOT} button`, { hasText: '取消' }).click().catch(() => {});
    const s7b = await waitFor(page, (x) => /取消/.test(x.status), 3000);
    const s7c = await waitFor(page, (x) => x.statusClass.includes('--idle') || x.statusClass.includes('--err'), 8000);
    // 服务端观测：连接在吐完前被断开 → 取消是真的（不是只改前端状态）。mock 层做不到这条。
    const aborted = await waitUntil(() => streams.aborted > aborted0, 5000);
    const ok = /取消/.test(s7b.status) && s7c.statusClass.includes('--idle') && s7c.errSlot === '' && aborted;
    record('HR-7', '取消在分块边界生效：中间态「正在取消…」→ 回落 idle 不报错，且服务端观测到断流', ok,
      `发送态="${s7a.status}" 取消态="${s7b.status}" 终态="${s7c.statusClass}" err="${s7c.errSlot}" 服务端断流=${aborted}（累计 ${streams.aborted}）`);
  }

  // HR-8 二进制判定（octet-stream → 不渲染 JSON 树，给二进制提示）
  {
    const s8 = await sendAndWait(
      page,
      { url: `${base}/bytes?tag=r8` },
      (x) => x.hints.some((h) => /二进制响应体/.test(h)) || x.statusClass.includes('--err'),
    );
    const ok = /200 OK/.test(s8.code) && s8.hints.some((h) => /二进制响应体/.test(h)) && s8.leaves.length === 0;
    record('HR-8', '二进制响应体（application/octet-stream）：给二进制提示且不渲染 JSON 树', ok,
      `code="${s8.code}" 提示=${JSON.stringify(s8.hints)} 叶子数=${s8.leaves.length}`);
  }

  // HR-9 响应体截断（> 5 MB 上限）；用二进制体避免 5 MB 文本进 DOM（见服务端 /big 注释）
  {
    const s9 = await sendAndWait(
      page,
      { url: `${base}/big?tag=r9&mb=6&ct=bin` },
      (x) => x.hints.some((h) => /截断/.test(h)) || x.statusClass.includes('--err'),
      30_000,
    );
    const ok = /200 OK/.test(s9.code) && s9.hints.some((h) => /截断/.test(h)) && /5\.\d MB|5 MB/.test(s9.meta);
    record('HR-9', '响应体超过 5 MB 上限被截断：出「响应已截断」提示，字节数按截断后计（5 MB）', ok,
      `code="${s9.code}" meta="${s9.meta}" 提示=${JSON.stringify(s9.hints)}`);
  }

  // HR-10 主机名解析（localhost → hosts/解析器 → 回环），证明不是只认 IP 字面量
  {
    const s10 = await sendAndWait(
      page,
      { url: `http://localhost:${port}/json?tag=r10` },
      (x) => x.leaves.some((t) => t.includes('r10')) || x.statusClass.includes('--err'),
    );
    const ok = /200 OK/.test(s10.code) && s10.leaves.some((t) => t.includes('r10'));
    record('HR-10', '主机名解析：http://localhost:<port> 真实解析并连通（非仅 IP 字面量）', ok,
      `code="${s10.code}" 叶子=${JSON.stringify(s10.leaves.slice(0, 6))}`);
  }

  // HR-11（可选）公网 DNS + TLS：默认不跑，OC_HTTP_REAL_NET=1 启用
  if (process.env.OC_HTTP_REAL_NET === '1') {
    const s11 = await sendAndWait(
      page,
      { url: 'https://example.com/' },
      (x) => /Example Domain/i.test(x.bodyText) || x.statusClass.includes('--err'),
      30_000,
    );
    const ok = /200 OK/.test(s11.code) && /Example Domain/i.test(s11.bodyText);
    record('HR-11', '公网 https（真实 DNS + TLS 握手）：200 且返回 Example Domain', ok,
      `code="${s11.code}" body="${s11.bodyText.slice(0, 80)}"`);
  } else {
    console.log('[跳过] HR-11 公网 DNS/TLS 用例未启用（设 OC_HTTP_REAL_NET=1 打开；属已知边界，需外网）');
  }
}

// ---------- 入口 ----------

(async () => {
  let server = null;
  try {
    server = await startServer();
    SERVER_SEEN = server.seen;
    console.log(`[环境] 本机 HTTP 服务: http://127.0.0.1:${server.port}`);
  } catch (e) {
    console.error(`[预检失败] 本机 HTTP 服务启动失败: ${e.message || e}`);
    process.exit(2);
  }

  await runWithRealApp(
    {
      suite: 'http-real',
      tmpPrefix: 'oc-http-real-',
      logName: '.tauri-dev.log',
      summaryTitle: 'B4 HTTP 工具真机验收（真实 reqwest 链路）',
      requirePaths: [
        { path: REAL_PYTHON, message: '解释器不存在', hint: '用 OC_REAL_PYTHON 指定' },
      ],
      setupFixtures({ tmp, workspace, dataRoot }) {
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(path.join(workspace, 'main.py'), "print('http-real workspace')\n", 'utf8');
        presetInterpreter(dataRoot, workspace, REAL_PYTHON);
        presetRecentWorkspaces(dataRoot, [workspace]);
        // 预置 HTTP 超时 3s（HR-6 需要；默认 30s 会让该用例等半分钟）
        fs.writeFileSync(
          path.join(dataRoot, 'config', 'settings.json'),
          JSON.stringify({ http_timeout_ms: TIMEOUT_MS }),
          'utf8',
        );
        console.log(`[环境] 工作区: ${workspace}`);
        console.log(`[环境] http_timeout_ms: ${TIMEOUT_MS}（预置 settings.json）`);
        return { port: server.port };
      },
    },
    async (s) => {
      await openHttpTool(s.page);
      await runChecks(s, server.port, server.seen, server.streams);
    },
  ).finally(() => {
    try { server.srv.close(); } catch { /* 已关闭 */ }
  });
})();
