/**
 * 调试功能真机（Real App）CDP 验收脚本 — R-REAL-1..12
 * （R-REAL-5 校验空局部帧空态；R-REAL-7 校验真局部变量 a/b——停在函数首行时局部变量
 *   尚未赋值，pydevd 返回 {"variables":[]} 属 Python 语义，mock 罐头数据掩盖了这一点）
 *
 * R-REAL-9/10/11/12 为 2026-10-03 补，覆盖 `docs/debug_acceptance_record.md` §五
 * 人工清单里 mock 层零覆盖的两项（第 5 项三态互斥、第 7 项改键生效）：
 *   9  调试暂停中「运行脚本」按钮应 aria-disabled + 提示"调试进行中"，点击被静默拦截
 *   10 同上，但走 **gutter ▶ 右键菜单**路径（与按钮路径对比，见验收记录 D-7）
 *   11 设置面板改键 UI → 保存 → settings.json 落盘 → 工具栏 tooltip 副文本同步
 *   12 改键后新键 F6 能启动调试、旧键 F5 失效
 *
 * R-REAL-10 / 13 为 2026-10-06 重写：原 R-REAL-10 是**诊断项（恒 true）**——选择器写成
 * `.menu-item, [role="menuitem"]`（真实类名是 `.ctx-menu-item`），且菜单未展开时根本读不到节点，
 * 实测恒返回 `not-found(menu-collapsed)`，等于没验证。本轮：
 *   - 真正**右键 gutter ▶** 展开菜单（`buildRunMenuItems` 的唯一入口）后读菜单项状态；
 *   - 10 断言「调试中菜单项置灰 + 提示与工具栏一致 + 点击被静默拦截」；
 *   - **13 为正对照**：停止调试后同一菜单项必须恢复可点，证明 10 不是恒真。
 *   D-7 修复方式（菜单复用 computeRunWidget）决定了这两条现在都应 PASS。
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
 *   - 隔离数据根 MONTAURI_DATA_ROOT + 预置 config/recent-workspaces.json（Node 写入天然无 BOM，
 *     规避 PS Set-Content 带 BOM 被 serde 静默拒读的坑）；
 *   - WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port> 打开 CDP；
 *   - Playwright connectOverCDP 驱动真实窗口；断点用 dev 钩子 __OC_DEBUG_TEST__
 *     （仅 vite dev 注入，与 e2e 同一 toggleBreakpoint 逻辑），规避 headless 外真机窗口
 *     glyph-margin 像素点击抖动；真实 gutter 点击已在 e2e D-FUNC-1 覆盖；
 *   - 结束 taskkill /T /F 清进程树（cargo/vite/应用一并回收）。
 */
'use strict';

const path = require('path');
const {
  runWithRealApp,
  record,
  sleep,
  tail,
  presetInterpreter,
  countPythonProcs,
  dismissBlockingModals,
} = require('./lib/real-env.cjs');

const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'D:\\py\\python.exe';

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

/**
 * 右键 gutter ▶ 展开运行组菜单（buildRunMenuItems 在当前 UI 下的**唯一**入口：
 * 「运行目标 ▾」下拉已在 §17-1/§17-2 删除，只剩 __main__ 守卫行的 glyph 右键）。
 *
 * 定位用装饰元素 `.gutter-run` **自身的包围盒**，不用 `(line-1)*lineHeight`——
 * 引用计数 CodeLens 会在 def/class 上方插 view zone 改变行的视口位置，按行高算坐标
 * 会点进 zone（Monaco 判为非 GUTTER_GLYPH_MARGIN，菜单静默不弹）；用渲染后的装饰元素
 * 对该竞态免疫。
 */
async function openRunGutterMenu(page) {
  const glyph = page.locator('.monaco-editor .gutter-run').first();
  await glyph.waitFor({ state: 'visible', timeout: 20000 });
  const box = await glyph.boundingBox().catch(() => null);
  if (!box) throw new Error('gutter ▶ 装饰无包围盒（未渲染或被滚动出视口）');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.locator('#ctx-menu .ctx-menu-item').first().waitFor({ timeout: 10000 });
}

/** 读菜单里「运行脚本」那一项的置灰态与原因文案（menu.ts::renderItem：
 *  disabled → class `disabled` + `aria-disabled="true"` + `data-tip = disabledReason`） */
async function readRunScriptMenuItem(page) {
  return page
    .evaluate(() => {
      const items = [...document.querySelectorAll('#ctx-menu .ctx-menu-item')];
      const it = items.find((el) => {
        const l = el.querySelector('.mi-label');
        return !!l && /运行脚本|Run Script/i.test(l.textContent || '');
      });
      if (!it) {
        return {
          found: false,
          labels: items.map((e) => ((e.querySelector('.mi-label') || {}).textContent || e.textContent || '').trim()).slice(0, 12),
        };
      }
      return {
        found: true,
        disabledClass: it.classList.contains('disabled'),
        ariaDisabled: it.getAttribute('aria-disabled'),
        tip: it.dataset.tip || '',
      };
    })
    .catch((e) => ({ found: false, error: String(e).split('\n')[0] }));
}

async function closeMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(400);
}

/**
 * 当前可见 toast 的文本集合。
 * ⚠ 不能用「toast 数量相等」表达「没新弹 toast」——toast 会自动消失：
 * 上一步遗留的 toast 到期就会让计数从 1 掉到 0，被误判成"新弹了一个"。
 * 实测踩过：R-REAL-10 首轮 toast 1→0 而菜单点击其实被正确拦下。
 * 故一律按**文本集合**判新增。
 */
async function toastTexts(page) {
  return page
    .evaluate(() => [...document.querySelectorAll('.toast')].map((e) => (e.textContent || '').trim()))
    .catch(() => []);
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

async function runChecks(page, dataRoot, workspace) {
  // R-REAL-1 工作区自动恢复（隔离数据根 + 预置 recent-workspaces）
  await dismissBlockingModals(page);
  try {
    await page.locator('#tree .tree-item .name', { hasText: 'script.py' }).first().waitFor({ timeout: 60000 });
    record('R-REAL-1', '隔离数据根下工作区自动恢复（文件树可见）', true);
  } catch (e) {
    record('R-REAL-1', '隔离数据根下工作区自动恢复（文件树可见）', false, String(e).split('\n')[0]);
    return;
  }

  // R-REAL-0 **护栏**（2026-10-06 新增）：确认驱动的是**本次**实例。
  // 已知坑：上一轮残留的 WebView2 孤儿进程会继续占着同一个 CDP 端口，
  // `connectOverCDP` 于是连到**旧会话**——端口预检通过、CDP 也连得上，
  // 但页面属于上一次运行（文件树 / 断点 map 的路径落在上一轮的临时目录），
  // 于是后续断言以一种极具误导性的方式连环失败（实测：断点 map 有 6/9 但红点 0 个、
  // 真 debugpy 命不中断点）。**光看 R-REAL-1「文件树可见」是发现不了这个的**，
  // 因为旧会话的文件树同样有 script.py。故在此断言路径归属，fail fast。
  const treePath = await page
    .evaluate(() => {
      const el = [...document.querySelectorAll('#tree .tree-item')].find(
        (e) => (((e.querySelector('.name') || {}).textContent) || '').trim() === 'script.py',
      );
      return el ? el.dataset.path || '' : '';
    })
    .catch(() => '');
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const inThisRun = !!treePath && !!workspace && norm(treePath).startsWith(norm(workspace));
  record('R-REAL-0', '护栏：驱动的是本次实例（文件树路径落在本轮临时工作区内，非上一轮残留孤儿 webview）',
    inThisRun, `tree=${treePath || '(未取到)'} | 期望前缀=${workspace || '(未传入)'}`);
  if (!inThisRun) {
    console.error('[护栏] 疑似连到旧会话（残留 WebView2 占了 CDP 端口）。'
      + '请先按命令行含 remote-debugging-port 清理 WebView2 孤儿进程、等端口释放后重跑。');
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
    // 变量行是**异步**渲染的（DAP variables 请求 → 回包 → renderVarRow），停点到达
    // 与变量上屏之间有间隔。单次 count() 会与渲染竞态——实测出现过
    // 「rows=0 而同一时刻 #debug-vars.innerText 已是 a 11 b 22」的假失败。
    // 故改为轮询等行出现（与 §7 记忆里的 waitReferencesStable 同一思路）。
    let rows = 0;
    for (let i = 0; i < 24 && rows < 2; i++) {
      rows = await page.locator('#debug-vars .debug-var-row').count().catch(() => 0);
      if (rows < 2) await sleep(250);
    }
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

  // R-REAL-9 三态互斥（§5 第 5 项 · 人工抽查）：调试暂停中，运行入口必须被拒
  // 时机：R-REAL-7 continue 到第二断点后仍处 stopped 态（调试会话占用中），正是互斥窗口。
  // 前端口径（runWidget.ts:147-152）：用 .is-disabled + aria-disabled + data-tip，
  // 不用 disabled 属性（Chromium 不给 disabled 控件派发鼠标事件，tooltip 会静默失效）。
  const runBtn = page.locator('#btn-run-script');
  const runDisabled = await runBtn.getAttribute('aria-disabled').catch(() => null);
  const runTip = (await runBtn.getAttribute('data-tip').catch(() => '')) || '';
  const runIsDisabled = await runBtn.evaluate((el) => el.classList.contains('is-disabled')).catch(() => false);
  // 点击应被前端守卫静默拦下（无新 toast、无状态变化）
  const toastBefore = await toastTexts(page);
  await runBtn.click({ force: true }).catch(() => {});
  await sleep(1200);
  const toastAfter = await toastTexts(page);
  const newToasts9 = toastAfter.filter((t) => !toastBefore.includes(t));
  const stillStopped = await page
    .locator('#debug-stack .debug-stack-frame.active')
    .count()
    .then((n) => n > 0)
    .catch(() => false);
  record('R-REAL-9', '三态互斥：调试暂停中「运行脚本」按钮 aria-disabled=true 且提示「调试进行中」，点击被静默拦截（无新 toast、调试态不变）',
    runDisabled === 'true' && runIsDisabled && /调试进行中/.test(runTip)
      && newToasts9.length === 0 && stillStopped,
    `aria-disabled=${runDisabled} is-disabled=${runIsDisabled} tip="${runTip.trim()}" toast ${toastBefore.length}→${toastAfter.length} 新增=${JSON.stringify(newToasts9)} 仍在断点=${stillStopped}`);

  // R-REAL-10 同一互斥的**菜单路径**（D-7 的落点）：gutter ▶ 右键菜单里的「运行脚本」
  // 必须与工具栏 ▶ 同一判定。缺陷形态（2026-10-06 修复前）：菜单 disabled 只看 scriptBusy，
  // 漏了 debugging → 按钮置灰、菜单仍可点 → 走 runScript() 由 Rust 兜底报「已有调试会话」。
  // 修复后菜单复用 computeRunWidget(s).runScript.disabled，两处不可能再分叉。
  // 断言口径：aria-disabled=true + .disabled 类 + data-tip 含「调试进行中」
  // + 提示文案与工具栏按钮**完全一致** + 点击被静默拦截（无 toast、仍停在断点）。
  let menu10 = { found: false };
  let menuOpenErr = '';
  try {
    await openRunGutterMenu(page);
  } catch (e) {
    menuOpenErr = String(e).split('\n')[0];
  }
  let toast10Before = await toastTexts(page);
  if (!menuOpenErr) {
    menu10 = await readRunScriptMenuItem(page);
    if (menu10.found) {
      // 点击应无反应（disabled 项只有 stopPropagation，无 action）
      await page
        .locator('#ctx-menu .ctx-menu-item')
        .filter({ hasText: /运行脚本|Run Script/ })
        .first()
        .click({ force: true })
        .catch(() => {});
      await sleep(1200);
    }
  }
  const toast10After = await toastTexts(page);
  const newToasts10 = toast10After.filter((t) => !toast10Before.includes(t));
  const stillStopped10 = await page
    .locator('#debug-stack .debug-stack-frame.active')
    .count()
    .then((n) => n > 0)
    .catch(() => false);
  const menu10Ok =
    !menuOpenErr &&
    menu10.found &&
    menu10.ariaDisabled === 'true' &&
    menu10.disabledClass === true &&
    /调试进行中/.test(menu10.tip) &&
    menu10.tip.trim() === runTip.trim() &&
    newToasts10.length === 0 &&
    stillStopped10;
  record('R-REAL-10', 'D-7 · 菜单路径与按钮路径一致：调试暂停中 gutter ▶ 右键菜单「运行脚本」置灰（aria-disabled + 提示与工具栏一致），点击被静默拦截',
    menu10Ok,
    menuOpenErr
      ? `菜单未展开：${menuOpenErr}`
      : `found=${menu10.found} aria-disabled=${menu10.ariaDisabled} .disabled=${menu10.disabledClass} tip="${(menu10.tip || '').trim()}"`
        + ` | 工具栏 tip="${runTip.trim()}" 一致=${(menu10.tip || '').trim() === runTip.trim()}`
        + ` toast ${toast10Before.length}→${toast10After.length} 新增=${JSON.stringify(newToasts10)} 仍在断点=${stillStopped10}`
        + (menu10.labels ? ` | 菜单项: ${JSON.stringify(menu10.labels)}` : ''));
  await closeMenu(page);

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

  // R-REAL-13 **正对照**（R-REAL-10 的反面）：停止调试后同一菜单项必须恢复可点。
  // 没有这条，R-REAL-10 可能因「菜单项恒置灰 / 选择器恒读不到」而假通过 —— 正对照把
  // 10 从"单向观察"变成"双向判定"。
  let menu13 = { found: false };
  let err13 = '';
  try {
    await openRunGutterMenu(page);
    menu13 = await readRunScriptMenuItem(page);
  } catch (e) {
    err13 = String(e).split('\n')[0];
  }
  const menu13Ok =
    !err13 && menu13.found && menu13.ariaDisabled !== 'true' && menu13.disabledClass === false;
  record('R-REAL-13', '正对照：停止调试后 gutter ▶ 右键菜单「运行脚本」恢复可点（证明 R-REAL-10 非恒真）',
    menu13Ok,
    err13
      ? `菜单未展开：${err13}`
      : `found=${menu13.found} aria-disabled=${menu13.ariaDisabled} .disabled=${menu13.disabledClass} tip="${(menu13.tip || '').trim()}"`);
  await closeMenu(page);

  // ── §5 第 7 项：设置面板改键后调试快捷键生效（全链路，真机） ──
  // 覆盖路径：设置面板 UI 改键 → 保存 → settings.json 落盘 → 工具栏 tooltip 副文本刷新
  //          → 新键真的能启动调试 → 旧键失效。mock 层 e2e 对改键链路零覆盖。
  // 键位路由是 window 级实时匹配（keybindings.ts:166-175 每次读 app.settings.keybindings），
  // 故无需重启；但 window keydown 在 INPUT/Monaco 聚焦时被忽略，按键前必须移开焦点。
  const { readFileSync: rf, existsSync: ex } = require('fs');
  const settingsPath = path.join(dataRoot, 'config', 'settings.json');
  try {
    await page.locator('#btn-settings').click();
    await page.locator('.settings-nav-item[data-cat="keybindings"]').click();
    const kbDebug = page.locator('#settings-kb-debug');
    await kbDebug.waitFor({ state: 'visible', timeout: 15000 });
    const before = await kbDebug.inputValue();
    await kbDebug.click();
    await page.keyboard.press('F6');            // wireKeybindingCapture：readOnly input 直接录键
    await sleep(400);
    const after = await kbDebug.inputValue();
    // 无冲突才允许保存；有冲突则 #settings-kb-conflict 会亮起并阻止保存
    const conflictText = (await page.locator('#settings-kb-conflict').textContent().catch(() => '')) || '';
    await page.locator('#settings-save').click();
    await sleep(1200);
    const saved = ex(settingsPath) ? JSON.parse(rf(settingsPath, 'utf8')) : {};
    const persisted = (saved.keybindings || {}).debug;
    // 面板关闭后，调试工具栏的 tooltip 副文本**本应**同步为 F6。
    // 实测仍为 F5：键位副文本只在 renderToolbar() 时刷新（debugView.ts:101 注释已说明），
    // 而 settingsPanel 保存后的刷新清单里没有调试工具栏（settingsPanel.ts:924-927），
    // 于是改键后要等下一次 phase 变化才显示新键 —— 已登记为缺陷 D-8。
    // 因此本条只断言「UI 录入 + 落盘」这段（功能真生效由 R-REAL-12 证明），
    // tooltip 滞后作为**诊断**记录，不伪装成通过。
    await page.locator('#settings-cancel, .settings-close').first().click().catch(() => {});
    await sleep(800);
    const tipKeyNow = (await page.locator('#debug-continue').getAttribute('data-tip-key').catch(() => null)) || '';
    const tipKeyOk = tipKeyNow.toUpperCase() === 'F6';
    record('R-REAL-11', '设置面板改键：原值 F5 → 录入 F6 无冲突 → 保存后 settings.json 落盘 F6（功能生效见 R-REAL-12）',
      before === 'F5' && after === 'F6' && !/冲突/.test(conflictText)
        && String(persisted).toUpperCase() === 'F6',
      `原值="${before}" 录入后="${after}" 冲突提示="${conflictText.trim()}" 落盘 keybindings.debug="${persisted}"`
        + (tipKeyOk ? '；工具栏 tooltip 已同步 F6' : `；⚠ 工具栏 tooltip 仍显示旧键 "${tipKeyNow}"（缺陷 D-8：改键后未刷新调试工具栏）`));

    // 新键启动调试（旧键 F5 应无效）：断点在 R-REAL-3 已设且停止后保留
    await page.locator('#tab-debug').click();   // 焦点移出 Monaco（window 键位在编辑器内被忽略）
    await sleep(500);
    const idleBefore = await page.locator('.debug-current-line').count();
    await page.keyboard.press('F5');            // 旧键：应无效果
    await sleep(1500);
    const afterOldKey = await page.locator('.debug-current-line').count();
    await page.keyboard.press('F6');            // 新键：应启动调试
    let newKeyWorks = true, newKeyDetail = '';
    try {
      await waitFrameText(page, 6, 30000);
    } catch (e) {
      try { await waitFrameText(page, 9, 10000); } catch { newKeyWorks = false; newKeyDetail = String(e).split('\n')[0]; }
    }
    const hasFrame = (await page.locator('#debug-stack .debug-stack-frame').count()) > 0;
    record('R-REAL-12', '改键生效：旧键 F5 无效果（不启动），新键 F6 能启动调试并命中断点',
      idleBefore === 0 && afterOldKey === 0 && newKeyWorks && hasFrame,
      `启动前 current-line=${idleBefore} 按 F5 后=${afterOldKey} 按 F6 后命中=${hasFrame} ${newKeyDetail}`);
    // 收尾：停止，避免留调试会话
    await page.locator('#debug-stop').click().catch(() => {});
    await sleep(4000);
  } catch (e) {
    record('R-REAL-11', '设置面板改键全链路', false, String(e).split('\n').slice(0, 2).join(' | '));
    record('R-REAL-12', '改键后新键生效 / 旧键失效', false, '因 R-REAL-11 中断未执行');
  }
}

runWithRealApp(
  {
    tmpPrefix: 'oc-debug-real-',
    logName: '.tauri-dev.log',
    summaryTitle: '真机 CDP 验收结果',
    requirePaths: [
      {
        path: REAL_PYTHON,
        message: '解释器不存在',
        hint: '调试 debuggee 需要真实 Python；用 OC_REAL_PYTHON 指定',
      },
    ],
    setupFixtures({ workspace, dataRoot }) {
      const { mkdirSync, writeFileSync } = require('fs');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(path.join(workspace, 'script.py'), SCRIPT_PY, 'utf8');
      // 预置工作区解释器（uv 兜底模式不支持调试，dap.rs fail fast）——
      // 等价于启动后手动「状态栏 → 选择解释器」，让 debug_start 直接走真实 debugpy 链路。
      presetInterpreter(dataRoot, workspace, REAL_PYTHON);
      writeFileSync(
        path.join(dataRoot, 'config', 'recent-workspaces.json'),
        JSON.stringify([workspace]),
        'utf8',
      );
      console.log(`[环境] 工作区: ${workspace}`);
    },
  },
  async (s) => {
    await runChecks(s.page, s.dataRoot, s.workspace);
  },
);
