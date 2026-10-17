/**
 * pytest 测试运行器真机（Real App）CDP 验收脚本 — PY-REAL-0..6c（12 项检查）
 * （对应 docs/pytest_dev_plan.md §10 验收清单第 10 项；mock 层覆盖不了的部分）
 *
 * 与 e2e/（浏览器 + Tauri mock）分层：本脚本驱动 **真实 Tauri 应用 + 真实 pytest**：
 *   uv 造临时 venv（装 pytest）→ 工作区解释器预置指向该 venv → 真实 collect（导入测试模块）
 *   → 真实 pytest 运行（kind="test" 分支 + junitxml 结果合入）→ 真 debugpy 调试此测试断点命中
 *   → 取消 collect 杀树无孤儿。
 *
 * 检查项：
 *   0  护栏：驱动的是本次实例（文件树路径落在本轮临时工作区内）
 *   1  工作区自动恢复 + 打开测试视图：scan 骨架先行（不依赖 collect）→ 真实 collect 落地
 *      （文件 / 函数 / 类 / parametrize 单例成行）
 *   2  树行 ▶ 运行通过用例 → 真实 pytest 终端（label 测试 · test_ok）→ is-passed
 *      （真实链路 = run_in_terminal kind=test → junitxml → term-exit → result 合入）
 *   3  失败用例 → is-failed → 点击行名跳转（激活 test_fail.py + 光标 Ln 3）
 *   4  重跑失败：一次调用（终端 delta = 1）且失败状态保持
 *   5  调试此测试（树行右键，断点在函数体行）→ 真 debugpy 命中断点（栈顶 :2）
 *      → 停止后调试态复位 + 无孤儿 python
 *   6  collect 取消：慢导入测试文件 → stale → 自动重收 → 取消 → 杀树无孤儿；
 *      collect 进行中编辑器可正常输入（不卡死）
 *
 * 前置：
 *   - uv 在 PATH（OC_UV 可覆盖）；基础解释器 D:\py\python.exe（OC_REAL_PYTHON 可覆盖）；
 *   - vendor/debugpy 已就位（tools/fetch-debugpy.ps1，调试检查需要）；
 *   - 5173 / 9223 端口空闲（runWithRealApp 预检 fail fast）；
 *   - 网络可达 pypi（或 uv 缓存里有 pytest——probe 开发机通常有，--offline 兜底）。
 *
 * 用法：cd shell && node e2e-real/pytest-real.cjs
 * 环境变量：OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP / OC_JSON_OUT / OC_UV / OC_REAL_PYTHON
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { mkdirSync, writeFileSync, existsSync } = require('fs');
const {
  runWithRealApp, record, sleep, presetInterpreter, presetRecentWorkspaces,
  countPythonProcs, dismissBlockingModals, writeJsonSummary,
} = require('./lib/real-env.cjs');

const UV = process.env.OC_UV || 'uv';
const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'D:\\py\\python.exe';
const VENDOR_DEBUGPY = path.join(__dirname, '..', '..', 'vendor', 'debugpy', 'debugpy');

const TEST_API = [
  'import pytest',
  '',
  '',
  'def test_ok():',
  '    assert 1 == 1',
  '',
  '',
  'class TestUser:',
  '    def test_x(self):',
  '        assert True',
  '',
  '    @pytest.mark.parametrize("n", [1, 2])',
  '    def test_p(self, n):',
  '        assert n > 0',
  '',
].join('\r\n');

const TEST_FAIL = [
  '# 失败用例（真机：def 在行 3，断言行 5——跳转断言用「行 3」可与默认「行 1」区分）',
  '',
  'def test_bad():',
  '    v = 1',
  '    assert v == 2',
  '',
].join('\r\n');

/** collect 取消检查用的慢导入模块：pytest 收集要导入它 → collect 挂住 30s → 可取消 */
const TEST_SLOW = [
  'import time',
  '',
  'time.sleep(30)  # 真机取消检查：collect 导入本模块时挂住，给取消留窗口',
  '',
  '',
  'def test_zzz():',
  '    assert True',
  '',
].join('\r\n');

/**
 * uv 临时环境（setupFixtures 内执行；失败 → 落 ENV 汇总并 exit 2，
 * 让跑批按「环境未就绪」口径记录而不是断言回归）。
 * 先在线装，失败退 --offline（probe 开发机 uv 缓存通常有 pytest wheel）。
 */
function makeVenvWithPytest(workspace, dataRoot) {
  const venvPy = path.join(workspace, '.venv', 'Scripts', 'python.exe');
  const run = (args, label) => {
    const r = spawnSync(UV, args, { cwd: workspace, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) {
      const detail = `${label} 退出码 ${r.status}\nstdout: ${String(r.stdout || '').slice(-800)}\nstderr: ${String(r.stderr || '').slice(-800)}`;
      writeJsonSummary({ suite: 'pytest-real', error: `uv 环境准备失败：${detail.slice(0, 300)}` });
      console.error(`[预检失败] ${detail}`);
      process.exit(2);
    }
    return r;
  };
  run(['venv', '.venv', '--python', REAL_PYTHON], 'uv venv');
  let inst = spawnSync(UV, ['pip', 'install', '--python', venvPy, 'pytest'], { cwd: workspace, encoding: 'utf8', windowsHide: true });
  if (inst.status !== 0) {
    console.log('[环境] 在线安装失败，退 --offline（uv 缓存）…');
    inst = spawnSync(UV, ['pip', 'install', '--python', venvPy, '--offline', 'pytest'], { cwd: workspace, encoding: 'utf8', windowsHide: true });
  }
  if (inst.status !== 0 || !existsSync(venvPy)) {
    const detail = `pytest 安装失败（网络与缓存均不可用）\nstdout: ${String(inst.stdout || '').slice(-800)}\nstderr: ${String(inst.stderr || '').slice(-800)}`;
    writeJsonSummary({ suite: 'pytest-real', error: `pytest 不可用：${detail.slice(0, 300)}` });
    console.error(`[预检失败] ${detail}`);
    process.exit(2);
  }
  presetInterpreter(dataRoot, workspace, venvPy);
  presetRecentWorkspaces(dataRoot, [workspace]);
  return { venvPy };
}

// ---------- 页面辅助 ----------

/** 读一行测试树行的 class（状态判定用） */
async function rowClass(page, nodeId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`.test-row[data-node="${id}"]`);
    return el ? el.className : null;
  }, nodeId).catch(() => null);
}

/** 等树行出现并带上指定状态 class（真实 pytest 运行 → term-exit → result 合入的全链） */
async function waitRowStatus(page, nodeId, status, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const cls = await rowClass(page, nodeId);
    if (cls && cls.split(/\s+/).includes(`is-${status}`)) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) {
      const dump = await page.evaluate(() =>
        [...document.querySelectorAll('#test-content .test-row')].slice(0, 12).map((e) => `${e.dataset.node} [${e.className}]`),
      ).catch(() => []);
      throw new Error(`等待 ${nodeId} is-${status} 超时（${timeoutMs}ms）；树状态: \n  ${dump.join('\n  ')}`);
    }
    await sleep(500);
  }
}

/** 等树行存在（可见性交给视图自身；头行与子行都在 #test-content） */
async function waitRow(page, nodeId, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const cls = await rowClass(page, nodeId);
    if (cls) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) {
      const dump = await page.evaluate(() => {
        const views = [...document.querySelectorAll('#view-tests')];
        const panes = [...document.querySelectorAll('#test-content')];
        return {
          viewCls: views.map((v) => v.className),
          paneCount: panes.length,
          rows: [...document.querySelectorAll('#test-content .test-row')].slice(0, 12).map((e) => e.dataset.node),
          text: panes.map((p) => p.innerText.slice(0, 300).replace(/\n+/g, ' | ')).join(' || '),
          cancel: !!document.getElementById('test-cancel'),
          cancelCls: (document.getElementById('test-cancel') || {}).className || '',
          count: (document.getElementById('test-count') || {}).textContent || '',
          tabSel: (document.getElementById('tab-tests') || {}).getAttribute?.('aria-selected'),
        };
      }).catch((e) => ({ rows: [], text: '(evaluate failed) ' + String(e).split('\n')[0] }));
      throw new Error(
        `等待树行 ${nodeId} 超时（${timeoutMs}ms） | view=${JSON.stringify(dump.viewCls)} panes=${dump.paneCount} tabSelected=${dump.tabSel}` +
        ` | cancel=${dump.cancel}(${dump.cancelCls}) count=${JSON.stringify(dump.count)}` +
        ` | rows=${JSON.stringify(dump.rows)} | text=${dump.text}`,
      );
    }
    await sleep(400);
  }
}

/** 展开一个组行（文件 / 类；幂等——已展开（子行已渲染）则不动，防 toggle 折回去） */
async function ensureExpanded(page, nodeId) {
  const has = await page.evaluate((id) => {
    const row = document.querySelector(`.test-row[data-node="${id}"]`);
    if (!row) return false;
    let sib = row.nextElementSibling;
    while (sib) {
      if ((sib.dataset.node || '').startsWith(id + '::')) return true;
      sib = sib.nextElementSibling;
    }
    return false;
  }, nodeId).catch(() => false);
  if (!has) {
    await page.evaluate((id) => {
      const el = document.querySelector(`.test-row[data-node="${id}"] .test-twisty`);
      if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }, nodeId);
    await sleep(300);
  }
}

/** 点击树行 ▶ 运行该节点 */
async function clickRowRun(page, nodeId) {
  await page.evaluate((id) => {
    const el = document.querySelector(`.test-row[data-node="${id}"] .test-run`);
    if (!el) throw new Error('行内 ▶ 不存在: ' + id);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, nodeId);
}

/** 树行右键 → 菜单点指定文案项（调试此测试） */
async function rowMenuAction(page, nodeId, labelRe) {
  const row = page.locator(`.test-row[data-node="${nodeId}"]`).first();
  try {
    await row.waitFor({ state: 'visible', timeout: 15000 });
  } catch (e) {
    const diag = await page.evaluate((id) => {
      const el = document.querySelector(`.test-row[data-node="${id}"]`);
      const pane = document.getElementById('test-content');
      return {
        present: !!el,
        cls: el ? el.className : '',
        viewCls: (document.getElementById('view-tests') || {}).className || '',
        paneText: pane ? pane.innerText.slice(0, 200).replace(/\n+/g, ' | ') : '(no pane)',
      };
    }, nodeId).catch((x) => ({ err: String(x).split('\n')[0] }));
    throw new Error(`${String(e).replace(/\n+/g, ' | ')} | 行诊断=${JSON.stringify(diag)}`);
  }
  const box = await row.boundingBox();
  if (!box) throw new Error('树行无包围盒: ' + nodeId);
  await page.mouse.click(box.x + 20, box.y + box.height / 2, { button: 'right' });
  await page.locator('#ctx-menu .ctx-menu-item').first().waitFor({ timeout: 10000 });
  const items = page.locator('#ctx-menu .ctx-menu-item');
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const txt = await items.nth(i).textContent().catch(() => '');
    if (labelRe.test(txt || '')) {
      await items.nth(i).click();
      return true;
    }
  }
  throw new Error(`菜单无「${labelRe}」项`);
}

/** 等调试栈顶帧停在第 line 行（真 debugpy source.name 为空 → 帧文本以 :line 结尾） */
async function waitFrameLine(page, line, timeoutMs) {
  await page.waitForFunction(
    (l) => {
      const el = document.querySelector('#debug-stack .debug-stack-frame');
      return !!el && new RegExp(':' + l + '\\s*$').test(el.textContent.trim());
    },
    String(line),
    { timeout: timeoutMs, polling: 300 },
  );
}

/** DAP 原始流量监听（debug-real 同款；5a 失败时 dump 用） */
async function installDapLogger(page) {
  return page.evaluate(async () => {
    if (window.__dapLog) return 'already';
    window.__dapLog = [];
    const internals = window.__TAURI_INTERNALS__;
    const cb = (ev) => {
      try {
        window.__dapLog.push(typeof ev.payload === 'string' ? ev.payload : JSON.stringify(ev.payload));
        if (window.__dapLog.length > 300) window.__dapLog.shift();
      } catch { /* 忽略 */ }
    };
    const id = internals.transformCallback(cb, false);
    try {
      await internals.invoke('plugin:event|listen', { event: 'dap-message', target: { kind: 'Any' }, handler: id });
      return 'ok';
    } catch (e2) {
      return 'listen-failed:' + e2;
    }
  }).catch((e) => 'evaluate-failed:' + e);
}

async function dapLogTail(page, n) {
  return page.evaluate((k) => (window.__dapLog || []).slice(-k), n)
    .then((arr) => (arr || []).map((s) => String(s).slice(0, 160).replace(/\s+/g, ' ')).join(' ‖ '))
    .catch(() => '(no dap log)');
}

/** 终端面板里「测试 ·」运行会话数（.term-tab，重跑失败 delta 断言用） */
async function countTestTerminals(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.term-tab .term-tab-name')].filter((e) => /测试 ·/.test(e.textContent || '')).length,
  );
}

/** 切回文件视图（测试树操作后 #tree 在 files 视图里；编辑器操作前必须先切回来） */
async function switchToFilesView(page) {
  await page.locator('#tab-files').click();
  await sleep(300);
}

/** 切到测试视图（编辑器操作后右键树行 / 等失效自动重收都需要它可见） */
async function switchToTestsView(page) {
  await page.locator('#tab-tests').click();
  await sleep(300);
}

/** 树 dblclick 的可点性诊断（dblclick 超时时的现场还原） */
async function treeClickDiag(page, name) {
  return page.evaluate((n) => {
    const files = document.getElementById('view-files');
    const items = [...document.querySelectorAll('#tree .tree-item')].filter(
      (e) => (((e.querySelector('.name') || {}).textContent) || '').includes(n),
    );
    const first = items[0];
    let hit = null;
    if (first) {
      const r = first.getBoundingClientRect();
      const cx = r.left + Math.min(80, r.width / 2);
      const cy = r.top + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      hit = el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : 'null';
    }
    return {
      filesCls: files ? files.className : '(no #view-files)',
      matches: items.length,
      box: first ? JSON.parse(JSON.stringify(first.getBoundingClientRect())) : null,
      hitAtCenter: hit,
    };
  }, name).catch((e) => ({ err: String(e).split('\n')[0] }));
}

// ---------- 检查主体 ----------

async function runChecks(page, workspace) {
  // PY-REAL-0 护栏（沿用 debug-real 的孤儿 WebView2 教训）。
  // ⚠ 文件树默认折叠：test_api.py 在 tests/ 子目录里不渲染，先等目录再展开。
  await dismissBlockingModals(page);
  try {
    await page.locator('#tree .tree-item .name', { hasText: 'tests' }).first().waitFor({ timeout: 60000 });
    await page.locator('#tree .tree-item', { hasText: 'tests' }).first().locator('.twisty').click();
    await page.locator('#tree .tree-item .name', { hasText: 'test_api.py' }).first().waitFor({ timeout: 15000 });
  } catch (e) {
    record('PY-REAL-0', '工作区自动恢复（文件树可见）', false, String(e).split('\n')[0]);
    return;
  }
  const treePath = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#tree .tree-item')].find(
      (e) => (((e.querySelector('.name') || {}).textContent) || '').trim() === 'test_api.py',
    );
    return el ? el.dataset.path || '' : '';
  }).catch(() => '');
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const inThisRun = !!treePath && norm(treePath).startsWith(norm(workspace));
  record('PY-REAL-0', '护栏：驱动的是本次实例（树路径在本轮临时工作区内）', inThisRun,
    `tree=${treePath || '(未取到)'} | 期望前缀=${workspace}`);
  if (!inThisRun) return;

  // PY-REAL-1 打开测试视图：scan 骨架先行 → 真实 collect 落地（含 parametrize 单例）
  await page.locator('#tab-tests').click();
  const tOpen = Date.now();
  let skeletonMs = -1;
  try {
    skeletonMs = await waitRow(page, 'tests/test_api.py', 20000);
    record('PY-REAL-1a', `scan 骨架先行（文件行 ${skeletonMs}ms 可见，不依赖 collect）`, true);
  } catch (e) {
    record('PY-REAL-1a', 'scan 骨架先行（文件行可见，不依赖 collect）', false, String(e).split('\n')[0]);
    return;
  }
  try {
    // collect 落地的首选判据 = 头部计数（collect 节点数）；树默认折叠到文件级，
    // 用例行要展开后才能看到（mock e2e 同口径）
    await page.waitForFunction(
      () => /^5/.test(((document.getElementById('test-count') || {}).textContent || '').trim()),
      { timeout: 90000, polling: 500 },
    );
    const collectMs = Date.now() - tOpen;
    // 逐级展开验证行级形态：文件 → 函数 / 类 → parametrize 单例
    await ensureExpanded(page, 'tests/test_api.py');
    await waitRow(page, 'tests/test_api.py::test_ok', 10000);
    await ensureExpanded(page, 'tests/test_api.py::TestUser');
    await waitRow(page, 'tests/test_api.py::TestUser::test_x', 10000);
    await waitRow(page, 'tests/test_api.py::TestUser::test_p[1]', 10000);
    await waitRow(page, 'tests/test_api.py::TestUser::test_p[2]', 10000);
    await ensureExpanded(page, 'tests/test_fail.py');
    await waitRow(page, 'tests/test_fail.py::test_bad', 10000);
    record('PY-REAL-1b', `真实 collect 落地（计数 5 含 parametrize 单例；collect 总耗时 ${collectMs}ms；行级展开正确）`, true);
  } catch (e) {
    record('PY-REAL-1b', '真实 collect 落地（文件 / 函数 / 类 / parametrize）', false, String(e).split('\n')[0]);
    return;
  }

  // PY-REAL-2 树行 ▶ 运行通过用例 → 真实 pytest 终端 → is-passed
  try {
    await ensureExpanded(page, 'tests/test_api.py');
    const pyBefore = countPythonProcs();
    await clickRowRun(page, 'tests/test_api.py::test_ok');
    const took = await waitRowStatus(page, 'tests/test_api.py::test_ok', 'passed', 120000);
    const tabs = await countTestTerminals(page);
    record('PY-REAL-2', `真实 pytest 运行单用例（is-passed 合入 ${took}ms；终端 tab ${tabs} 个，label 测试 · test_ok）`,
      tabs >= 1, `python 进程 ${pyBefore} → 运行期`);
  } catch (e) {
    record('PY-REAL-2', '真实 pytest 运行单用例 → is-passed', false, String(e).split('\n')[0]);
    return;
  }

  // PY-REAL-3 失败用例 → is-failed → 点击行名跳转（激活 test_fail.py + Ln 3）
  try {
    await ensureExpanded(page, 'tests/test_fail.py');
    await clickRowRun(page, 'tests/test_fail.py::test_bad');
    await waitRowStatus(page, 'tests/test_fail.py::test_bad', 'failed', 120000);
    record('PY-REAL-3a', '真实失败用例 is-failed 合入', true);
  } catch (e) {
    record('PY-REAL-3a', '真实失败用例 is-failed 合入', false, String(e).split('\n')[0]);
    return;
  }
  try {
    await page.locator('.test-row[data-node="tests/test_fail.py::test_bad"] .test-name').first().click();
    await page.locator('#tabbar .tab.active .name', { hasText: 'test_fail.py' }).first().waitFor({ timeout: 15000 });
    // 光标芯片是中文 locale 格式「行 3，列 1」（cursorStatus）
    await page.waitForFunction(() => /行\s*3\s*，/.test((document.getElementById('status-cursor') || {}).textContent || ''), {
      timeout: 15000, polling: 300,
    });
    record('PY-REAL-3b', '失败点击跳转（激活 test_fail.py，光标 行 3 = assert 行）', true);
  } catch (e) {
    const chip = await page.evaluate(() => (document.getElementById('status-cursor') || {}).textContent || '(no chip)').catch(() => '');
    record('PY-REAL-3b', '失败点击跳转（激活 test_fail.py，光标 Ln 3）', false, `${String(e).split('\n')[0]} | chip=${chip.trim()}`);
  }

  // PY-REAL-4 重跑失败：一次调用（终端 delta = 1）且失败状态保持
  try {
    const before = await countTestTerminals(page);
    await page.locator('#test-rerun').click();
    // **单例复用语义**（run-term-test 固定 id）：重跑不新增终端，同一 tab 换 label
    // （首个失败节点 basename = test_bad）——断言 label 换名 + 跑完状态仍是 failed
    await page.waitForFunction(
      () => [...document.querySelectorAll('.term-tab .term-tab-name')]
        .some((e) => /测试 · .*test_bad/.test(e.textContent || '')),
      { timeout: 30000, polling: 500 },
    );
    const after = await countTestTerminals(page);
    await waitRowStatus(page, 'tests/test_fail.py::test_bad', 'failed', 120000);
    record('PY-REAL-4', `重跑失败复用单例终端（终端 ${before} → ${after} 不新增，label 换为 测试 · test_bad）且失败状态保持`,
      after === before, `delta=${after - before}`);
  } catch (e) {
    const dump = await page.evaluate(() => ({
      tabs: [...document.querySelectorAll('.term-tab .term-tab-name')].map((e) => e.textContent),
      rerunDisabled: (document.getElementById('test-rerun') || {}).disabled,
      stale: (document.getElementById('test-stale') || {}).className || '',
    })).catch((x) => ({ err: String(x).split('\n')[0] }));
    record('PY-REAL-4', '重跑失败一次调用且失败状态保持', false,
      `${String(e).split('\n')[0]} | dump=${JSON.stringify(dump)}`);
  }

  // PY-REAL-5 调试此测试（树行右键）→ 真 debugpy 命中断点（函数体行 2）→ 停止复位
  const dbgBase = countPythonProcs();
  try {
    // 打开 test_fail.py 并在函数体行下断点（dev 钩子 = 真实 gutter 点击同一逻辑）
    // ⚠ 测试树操作把侧栏留在了 tests 视图，#tree 在 files 视图里——先切回
    await switchToFilesView(page);
    await page.locator('#tree .tree-item .name', { hasText: 'test_fail.py' }).first().dblclick();
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
    await sleep(800);
    const hasHook = await page.evaluate(() => typeof window.__OC_DEBUG_TEST__ === 'object').catch(() => false);
    if (!hasHook) throw new Error('dev 钩子 __OC_DEBUG_TEST__ 缺失（非 vite dev 前端？）');
    await page.evaluate(() => window.__OC_DEBUG_TEST__.toggleActive(4));
    await sleep(500);
    const bps = await page.locator('.gutter-breakpoint').count();
    if (bps !== 1) throw new Error(`断点红点 ${bps} 个（期望 1）`);
    // 右键树行需要测试视图可见——从编辑器操作切回来；挂 DAP 流量监听（失败 dump 用）
    await switchToTestsView(page);
    await installDapLogger(page);
    await rowMenuAction(page, 'tests/test_fail.py::test_bad', /调试此测试/);
    await page.locator('.debug-current-line').first().waitFor({ timeout: 90000 });
    await waitFrameLine(page, 4, 30000);
    record('PY-REAL-5a', '调试此测试 → 真 debugpy 握手 + 命中断点（栈顶 :4）', true);
  } catch (e) {
    const diag = await treeClickDiag(page, 'test_fail.py');
    const pathCmp = await page.evaluate(() => {
      const out = { framePath: '', tabPath: '', tabTitle: '' };
      for (const s of window.__dapLog || []) {
        try {
          const obj = typeof s === 'string' ? JSON.parse(s) : s;
          if (obj.type === 'response' && obj.body && obj.body.stackFrames && obj.body.stackFrames[0]) {
            out.framePath = obj.body.stackFrames[0].source?.path || '(none)';
            break;
          }
        } catch { /* 非 JSON */ }
      }
      const tab = document.querySelector('#tabbar .tab.active');
      out.tabTitle = tab ? tab.getAttribute('title') || '' : '(no active tab)';
      out.tabPath = tab ? (tab.dataset.path || '') : '';
      return out;
    }).catch((x) => ({ err: String(x).split('\n')[0] }));
    record('PY-REAL-5a', '调试此测试 → 真 debugpy 命中断点', false,
      `${String(e).replace(/\n+/g, ' | ')} | 诊断=${JSON.stringify(diag)} | pathCmp=${JSON.stringify(pathCmp)}`);
  }
  try {
    await page.locator('#btn-stop').click();
    await page.locator('.debug-current-line').waitFor({ state: 'detached', timeout: 30000 });
    await sleep(1200);
    const after = countPythonProcs();
    record('PY-REAL-5b', `停止调试 → 调试态复位 + 无孤儿 python（${dbgBase} → ${after}）`, after <= dbgBase,
      `python 进程 ${dbgBase} → ${after}`);
  } catch (e) {
    record('PY-REAL-5b', '停止调试 → 调试态复位', false, String(e).split('\n')[0]);
  }

  // PY-REAL-6 collect 取消（杀树无孤儿）+ collect 进行中编辑器可输入
  const base = countPythonProcs();
  try {
    // 失效自动重收只在测试视图可见时发生（handleTestInvalidation 的 activeView 门）——先切回
    await switchToTestsView(page);
    writeFileSync(path.join(workspace, 'tests', 'test_slow.py'), TEST_SLOW, 'utf8');
    // watcher → dep-fs-changed → 1s 防抖 → 视图可见自动重收 → collect 导入 test_slow 挂 30s
    await page.locator('#test-cancel').waitFor({ state: 'visible', timeout: 30000 });
    record('PY-REAL-6a', '.py 变更 → 自动重收进行中（取消按钮现身）', true);
    // 收集进行中编辑器可正常交互（§3.10 不卡死纪律的真机面）——先切回文件视图。
    // ⏱ test_slow 只挂 30s（60s 后端超时前自然结束）：本段须在窗口内快速完成。
    // 断言用「点击第 2 行 → 光标芯片更新」：纯渲染进程信号，不依赖 OS 窗口前台焦点
    // （真机实测后台窗口下 keyboard.type / insertText 都不落 textarea）。
    await switchToFilesView(page);
    await page.locator('#tree .tree-item .name', { hasText: 'test_api.py' }).first().dblclick();
    await page.locator('.monaco-editor').first().waitFor({ timeout: 15000 });
    await page.locator('.monaco-editor .view-line').nth(1).click();
    let responsive = false;
    try {
      await page.waitForFunction(
        () => /行\s*2\s*，/.test((document.getElementById('status-cursor') || {}).textContent || ''),
        { timeout: 8000, polling: 300 },
      );
      responsive = true;
    } catch { /* 保持 false */ }
    record('PY-REAL-6b', 'collect 进行中编辑器可正常交互（点击定位 → 光标芯片更新，不卡死）', responsive);
    // 取消 → 后端杀进程树 → python 进程回落基线。⚠ 两个坑：
    //  ① 按钮在 tests 视图里——先切回再点；
    //  ② #test-cancel 永不 detach（syncToolbar 只切 hidden class），必须等 hidden。
    await switchToTestsView(page);
    const cancelVisible = await page.locator('#test-cancel').isVisible().catch(() => false);
    if (!cancelVisible) throw new Error('取消按钮已不可见（collect 被 60s 后端超时杀掉，脚本步骤过慢）');
    await page.locator('#test-cancel').click();
    await page.locator('#test-cancel').waitFor({ state: 'hidden', timeout: 20000 });
    let procs = -1;
    for (let i = 0; i < 12; i++) {
      procs = countPythonProcs();
      if (procs <= base) break;
      await sleep(1000);
    }
    record('PY-REAL-6c', `取消 collect → 杀树无孤儿（python ${base} → ${procs}）`, procs <= base,
      `python 进程 ${base} → ${procs}`);
  } catch (e) {
    const diag = await treeClickDiag(page, 'test_api.py');
    record('PY-REAL-6', 'collect 取消 / 编辑器不卡死', false,
      `${String(e).split('\n')[0]} | 诊断=${JSON.stringify(diag)}`);
  }
}

// ---------- 入口 ----------

runWithRealApp(
  {
    suite: 'pytest-real',
    tmpPrefix: 'oc-pytest-real-',
    logName: '.tauri-dev-pytest.log',
    summaryTitle: 'pytest 真机 CDP 验收结果',
    requirePaths: [
      { path: VENDOR_DEBUGPY, message: 'vendor/debugpy 缺失', hint: '先跑 tools/fetch-debugpy.ps1（调试此测试检查需要）' },
      { path: REAL_PYTHON, message: '基础解释器不存在', hint: '用 OC_REAL_PYTHON 指定（uv venv 的 --python 基座）' },
    ],
    setupFixtures({ workspace, dataRoot }) {
      mkdirSync(path.join(workspace, 'tests'), { recursive: true });
      writeFileSync(path.join(workspace, 'tests', 'test_api.py'), TEST_API, 'utf8');
      writeFileSync(path.join(workspace, 'tests', 'test_fail.py'), TEST_FAIL, 'utf8');
      console.log(`[环境] uv 造临时 venv 并安装 pytest（基座 ${REAL_PYTHON}）…`);
      const { venvPy } = makeVenvWithPytest(workspace, dataRoot);
      console.log(`[环境] 工作区解释器 = ${venvPy}`);
      return { venvPy };
    },
  },
  async (s) => runChecks(s.page, s.workspace),
);
