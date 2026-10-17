/**
 * 外部改动检测真机（Real App）CDP 验收脚本 — EC-REAL-1..3
 * （docs/fs_watch_dev_plan.md v0.1 §7.3：浏览器 mock 层已由 e2e/editor/13-external-change.spec.ts
 *   覆盖 E-EXT-1..9；本脚本验**真实 notify 链路**这一层：真 300ms 防抖、真 ReadDirectoryChangesW、
 *   真 read_file IPC——mock 的 __emit 手工触发对这些一无所知。）
 *
 * 用法：
 *   cd shell
 *   node e2e-real/external-change-real.cjs
 *
 * 环境变量：
 *   OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP   同其它真机套件（real-env.cjs）
 *
 * 判定：
 *   EC-REAL-1  外部写盘（真实 notify）→ 未脏 tab 自动重载，无对话框、脏点不上身（§4.7 的实锤）
 *   EC-REAL-2  脏 tab + 外部写盘 → 三选一面板出现（真实 fs-file-changed 链路）
 *   EC-REAL-3  「稍后处理」→ Ctrl+S → 保存语义面板 → 覆盖磁盘写回我的版本（§4.6）
 *
 * 避坑（e2e_divergence_ledger D-007 / 避坑速查 #6）：watcher 只上报启动后的变更，且新工作区
 * 的 watcher 就绪晚于树可用——所有「写盘 → 等变化」都带**重触写兜底**（8s 未出现就重写一次
 * 触发新变更事件），否则首写落在就绪前则事件永不出现、用例确定性失败。
 */
'use strict';

const { writeFileSync, mkdirSync, readFileSync } = require('fs');
const path = require('path');
const { runWithRealApp, record, sleep } = require('./lib/real-env.cjs');

const V1 = "alpha = 1\nprint('v1')\n";
const V2_OUTSIDE = "alpha = 1\nprint('changed by another program')\n";
const MAIN_PY = 'main.py';

function mainPy(wsRoot) { return path.join(wsRoot, MAIN_PY); }

/** 当前编辑器模型文本（与真实 app 的 state.ts 对话） */
async function modelText(page) {
  return page.evaluate(async () => {
    const { app } = await import('/src/state.ts');
    const m = app.editor.getModel();
    return m ? String(m.getValue()) : null;
  });
}

/** 脏圆点数量（.tab .dirty 下的 codicon 子元素） */
async function dirtyDots(page) {
  return page.evaluate(() => document.querySelectorAll('#tabbar .tab .dirty > *').length);
}

async function modalVisible(page) {
  return page.evaluate(() => {
    const el = document.getElementById('confirm-modal');
    return !!el && !el.classList.contains('hidden');
  });
}

/** 把当前编辑器弄脏（走真实 model 事件链 → onDidChangeContent → tab.dirty=true） */
async function dirtyEditor(page, text) {
  await page.evaluate(async (t) => {
    const { app } = await import('/src/state.ts');
    app.editor.getModel().setValue(t);
  }, text);
  for (let i = 0; i < 40; i++) {
    if (await dirtyDots(page)) return true;
    await sleep(150);
  }
  return false;
}

/** 写盘 + 重触写兜底（D-007）：直到 want 文本出现在编辑器模型里或超时
 *  @returns 'appeared' | 'timeout' */
async function writeAndWaitReload(page, wsRoot, content, want) {
  writeFileSync(mainPy(wsRoot), content, 'utf8');
  for (let attempt = 0; attempt < 3; attempt++) {
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const t = await modelText(page).catch(() => null);
      if (t !== null && t.includes(want)) return 'appeared';
    }
    // 首写可能落在 watcher 就绪前（不补发）→ 重写触发新变更
    writeFileSync(mainPy(wsRoot), content, 'utf8');
  }
  return 'timeout';
}

async function runChecks({ page, workspace }) {
  // EC-REAL-0 前置：工作区自动恢复 + main.py 打开（树可用晚于 watcher 就绪，等树再开文件）
  await page.locator('#tree .tree-item').first().waitFor({ timeout: 60000 });
  await page.locator('#tree .tree-item .name', { hasText: MAIN_PY }).first().dblclick();
  await page.locator('.monaco-editor').waitFor({ timeout: 30000 });
  for (let i = 0; i < 40; i++) {
    if ((await modelText(page).catch(() => null)) === V1) break;
    await sleep(300);
  }
  const opened = (await modelText(page).catch(() => null)) === V1;
  if (!opened) {
    record('EC-REAL-1', '外部写盘 → 未脏 tab 自动重载（真实 notify）', false, 'main.py 打开失败/内容不符（前置失败）');
    record('EC-REAL-2', '脏 tab + 外部写盘 → 三选一面板', false, '前置失败（main.py 未打开）');
    record('EC-REAL-3', '「稍后处理」→ Ctrl+S → 覆盖磁盘', false, '前置失败（main.py 未打开）');
    return;
  }

  // ---------- EC-REAL-1：未脏 tab 自动重载 ----------
  const r1 = await writeAndWaitReload(page, workspace, V2_OUTSIDE, 'changed by another program');
  const dots = await dirtyDots(page);
  const modal = await modalVisible(page);
  record('EC-REAL-1', '外部写盘 → 未脏 tab 自动重载，无对话框、脏点不上身（§4.7）',
    r1 === 'appeared' && !modal && dots === 0,
    `重载=${r1 === 'appeared'} · 对话框=${modal} · 脏圆点=${dots}（自动重载的 setValue 会触发统一置脏点，dirty 守卫按回 0 才算过）`);

  // ---------- EC-REAL-2：脏 tab + 外部写盘 → 三选一面板 ----------
  // 先恢复干净再弄脏：覆盖 tab 内容（同样走真实 onDidChangeContent）
  writeFileSync(mainPy(workspace), V1, 'utf8');
  await sleep(1200); // 等 EC-REAL-1 的回声事件处理完，避免与下面的判定相互踩
  const dirtyOk = await dirtyEditor(page, V1 + '# my real-app edit\n');
  const modal2 = await modalVisible(page);

  // 外部写盘（重触写兜底），等面板出现
  let panelSeen = false;
  let panelDetail = '';
  writeFileSync(mainPy(workspace), V2_OUTSIDE, 'utf8');
  for (let attempt = 0; attempt < 4 && !panelSeen; attempt++) {
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      if (await modalVisible(page).catch(() => false)) { panelSeen = true; break; }
    }
    if (!panelSeen) writeFileSync(mainPy(workspace), V2_OUTSIDE + `# retrigger ${attempt}\n`, 'utf8');
  }
  if (panelSeen) {
    const msg = await page.evaluate(() => document.getElementById('confirm-message')?.textContent ?? '');
    const ok = await page.evaluate(() => document.getElementById('confirm-ok')?.textContent ?? '');
    const cancel = await page.evaluate(() => document.getElementById('confirm-cancel')?.textContent ?? '');
    const flag = await page.evaluate(() => document.querySelectorAll('#tabbar .tab .tab-external-flag').length);
    panelDetail = `ok=${ok.trim()} · cancel=${cancel.trim()} · 标记=${flag} · 文案含 main.py=${/main\.py/.test(msg)}`;
  }
  record('EC-REAL-2', '脏 tab + 外部写盘 → 三选一面板（真实 fs-file-changed 链路）',
    dirtyOk && panelSeen && !modal2,
    `置脏=${dirtyOk} · 面板=${panelSeen}${panelDetail ? ' · ' + panelDetail : ''}`);

  // ---------- EC-REAL-3：稍后处理 → Ctrl+S → 保存语义面板 → 覆盖磁盘 ----------
  // 面板此刻应仍在（EC-REAL-2 末尾没有点掉）。点「稍后处理」(#confirm-cancel)。
  const stillPanel = await modalVisible(page);
  if (stillPanel) {
    await page.evaluate(() => { document.getElementById('confirm-cancel').click(); });
    await sleep(400);
  }
  const mine = await modelText(page).catch(() => null);
  // Ctrl+S（先点编辑器夺回焦点）
  await page.locator('.monaco-editor').click({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Control+s');
  let savePanel = false;
  let saveOkLabel = '';
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    if (await modalVisible(page).catch(() => false)) {
      savePanel = true;
      saveOkLabel = (await page.evaluate(() => document.getElementById('confirm-ok')?.textContent ?? '')).trim();
      break;
    }
  }
  let diskAfter = null;
  if (savePanel) {
    await page.evaluate(() => { document.getElementById('confirm-ok').click(); });
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      try {
        diskAfter = readFileSync(mainPy(workspace), 'utf8');
        if (diskAfter === mine) break;
      } catch { /* 文件可能正在被写 */ }
      diskAfter = null;
    }
  }
  record('EC-REAL-3', '「稍后处理」→ Ctrl+S → 保存语义面板 → 用我的版本覆盖磁盘（§4.6）',
    savePanel && saveOkLabel === '用我的版本覆盖磁盘' && diskAfter === mine,
    `保存面板=${savePanel} · ok 文案=${saveOkLabel || '(空)'} · 磁盘==我的缓冲=${diskAfter === mine}`);

  // ---------- EC-REAL-4：监听范围瘦身后仍完整（TD-029①） ----------
  // 顶层目录逐个订阅 + 根非递归 + 运行期新建顶层目录动态补订阅。任一条断了都表现为
  // 「新建目录里的文件改动收不到事件」，正是这次瘦身最容易埋的回归。
  const fresh = path.join(workspace, 'brand_new_dir'); // 运行期新建的顶层目录
  mkdirSync(fresh, { recursive: true });
  writeFileSync(path.join(fresh, 'inside.py'), "inside = 'v1'\n", 'utf8');
  await sleep(1500); // 等 watcher 补订阅（事件驱动）
  // 手动刷一次树：本用例验的是「新目录**内**的改动能否被监听到」，不耦合树自动刷新
  await page.locator('#btn-tree-refresh').click().catch(() => {});
  await sleep(1000);
  // 目录用**单击**展开（双击 = 展开又收起，文件才是双击打开）
  await page.locator('#tree .tree-item .name', { hasText: 'brand_new_dir' }).first().click().catch(() => {});
  await sleep(800);
  await page.locator('#tree .tree-item .name', { hasText: 'inside.py' }).first().dblclick().catch(() => {});
  await page.locator('.monaco-editor').waitFor({ timeout: 15000 }).catch(() => {});
  const treeNames = (await page.evaluate(() =>
    Array.from(document.querySelectorAll('#tree .tree-item .name')).map((e) => e.textContent || '').join('|')
  ).catch(() => '(读取失败)')) || '(空)';
  const modelNow = await modelText(page).catch(() => null);
  const openedOk = modelNow === "inside = 'v1'\n";

  let reloaded = 'timeout';
  if (openedOk) {
    writeFileSync(path.join(fresh, 'inside.py'), "inside = 'v2 outside'\n", 'utf8');
    for (let attempt = 0; attempt < 3 && reloaded === 'timeout'; attempt++) {
      for (let i = 0; i < 15; i++) {
        await sleep(400);
        const t = await modelText(page).catch(() => null);
        if (t && t.includes('v2 outside')) { reloaded = 'appeared'; break; }
      }
      // 重触写兜底（D-007）：首写可能落在补订阅完成之前
      if (reloaded === 'timeout') writeFileSync(path.join(fresh, 'inside.py'), "inside = 'v2 outside'\n", 'utf8');
    }
  }
  record('EC-REAL-4', '瘦身后：运行期新建顶层目录内的改动仍能触发自动重载（TD-029①）',
    openedOk && reloaded === 'appeared',
    `打开文件=${openedOk} · 外部改动自动重载=${reloaded === 'appeared'} · 树=[${String(treeNames).slice(0, 200)}] · model=[${String(modelNow).slice(0, 40)}]`);
}

runWithRealApp({
  suite: 'external-change-real',
  summaryTitle: '外部改动检测真机验收（EC-REAL）',
  tmpPrefix: 'oc-extchange-real-',
  setupFixtures({ workspace, dataRoot }) {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(mainPy(workspace), V1, 'utf8');
    writeFileSync(path.join(workspace, 'notes.md'), '# notes\n', 'utf8');
    const { presetRecentWorkspaces } = require('./lib/real-env.cjs');
    presetRecentWorkspaces(dataRoot, [workspace]);
    console.log(`[环境] 工作区: ${workspace}`);
  },
}, async (session) => {
  await runChecks(session);
});
