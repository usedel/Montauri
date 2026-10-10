/**
 * P1 调用链推断 · 真机全链路验收 — CHAIN-1..CHAIN-6
 *
 * 与单元层（cargo test）和裸 LSP 层（%TEMP%\oc-chain-e2e，已 7/7 PASS）不同，
 * 本脚本验的是 **Tauri 外壳全链路**：
 *
 *   点 ▶ 运行按钮 → terminal.rs PTY → run_env.rs 注入 probe（PYTHONPATH+AUTOSTART）
 *   → probe 采样写 trace 库 → lsp.rs 桥起的 opencharm-intel（mtime+size 自动重载）
 *   → client.ts CompletionItemProvider → Monaco suggest-widget 出链式候选
 *
 * 任何一环断掉（注入失败 / 库写错位置 / 桥没起 / 前端没注册 provider），都会以
 * 「suggest-widget 无 ⟳ runtime 候选」的形式暴露——mock 层永远盖不住。
 *
 * 用例设计（对着 probe 真实语义——只记**跑过**的函数）：
 *   CHAIN-1  运行脚本真实完成（终端出 RESULT 行 + trace 库文件出现）
 *   CHAIN-2  工厂链：`make_order(9, [1]).` → price/items（首段 ret_type_of 路径；
 *            实参含列表字面量 `[1]`——真机探针抓出的 `]` 回扫缺口回归钉）
 *   CHAIN-3  方法链：`best_order().price.` 之类「返回实例的方法」→ 成员
 *   CHAIN-4  调用后下标：`get_quotes()["` → data/total（ret dict 键）
 *   CHAIN-5  深层下标链：`get_quotes()["data"][0]["` → code/name（嵌套 shape）
 *   CHAIN-6  无观测降级：`unknown_fn(x).` → 无 ⟳ runtime 候选（不出运行时垃圾）
 *
 * 触发前的焦点纪律（真机探针实锤）：运行脚本后焦点被终端 xterm 抢走，后续
 * keyboard.type 全进终端——**每次触发前必须先 click 编辑器**。
 *
 * 用法：cd shell && node e2e-real/chain-completion-real.cjs
 * 环境变量：OC_CDP_PORT / OC_CDP_TIMEOUT / OC_KEEP_APP / OC_REAL_PYTHON（同其余真机脚本）
 */
'use strict';

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

const REAL_PYTHON = process.env.OC_REAL_PYTHON || 'D:\\py\\python.exe';

/**
 * 被测脚本。main() 覆盖三类链式形态的采样点：
 * - make_order 工厂（ret=Order）；find_best 返回 Order 实例（方法 ret 传播用）；
 * - get_quotes 返回嵌套 dict（调用后下标 + 深层链用）。
 */
const TEST_PY = [
  'class Order:',
  '    def __init__(self, price, items):',
  '        self.price = price',
  '        self.items = items',
  '    def get_total(self):',
  '        return self.price + len(self.items)',
  '',
  'def make_order(price, items):',
  '    return Order(price, items)',
  '',
  'def find_best(orders):',
  '    best = None',
  '    for o in orders:',
  '        if best is None or o.price > best.price:',
  '            best = o',
  '    return best',
  '',
  'def get_quotes():',
  '    return {"data": [{"code": "000001", "name": "PINGAN"}], "total": 1}',
  '',
  'def risky(v):',
  '    if v < 0:',
  '        raise ValueError("negative")',
  '    return v',
  '',
  'def main():',
  '    order = make_order(15, [1, 2])',
  '    best = find_best([order])',
  '    quotes = get_quotes()',
  '    try:',
  '        risky(-1)',
  '    except ValueError:',
  '        pass',
  '    print("RESULT", best.get_total(), order.price, quotes["total"])',
  '',
  'main()',
  '',
].join('\n');

/** 等待 suggest-widget 出现「⟳ runtime」前缀的候选，返回 { ok, labels, dump } */
async function waitForRuntimeSuggest(page, { timeoutMs = 15000, needCount = 1 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastLabels = [];
  while (Date.now() < deadline) {
    const labels = await page.evaluate(() => {
      const rows = document.querySelectorAll('.suggest-widget:not(.hidden) .monaco-list-row');
      const out = [];
      for (const r of rows) {
        const label = (r.querySelector('.label-name, .monaco-highlighted-label')?.textContent || '').trim();
        const detail = (r.querySelector('.detail-label')?.textContent || r.textContent || '').trim();
        if (detail.includes('runtime') || detail.includes('⟳')) out.push(label);
      }
      return out;
    }).catch(() => []);
    lastLabels = labels;
    if (labels.length >= needCount) return { ok: true, labels };
    await sleep(400);
  }
  // 失败兜底：全量 dump 弹层（分辨「没弹」vs「只有静态候选」vs「选择器没抓到」）
  const dump = await page.evaluate(() => {
    const w = document.querySelector('.suggest-widget');
    const rows = document.querySelectorAll('.suggest-widget .monaco-list-row');
    const ed = window.monaco?.editor?.getModels?.()[0];
    const edCtl = window.monaco?.editor?.getEditors?.()[0];
    const pos = edCtl?.getPosition?.();
    const ln = pos ? ed.getModel().getLineContent(pos.lineNumber) : null;
    return {
      widgetExists: !!w,
      widgetHidden: w ? w.classList.contains('hidden') : null,
      visible: w ? w.offsetParent !== null : false,
      rowCount: rows.length,
      texts: Array.from(rows).slice(0, 6).map((r) => (r.textContent || '').trim().slice(0, 80)),
      activeEl: document.activeElement?.tagName + '.' + (document.activeElement?.className || '').slice(0, 40),
      cursorLine: pos ? `${pos.lineNumber}:${pos.column}` : null,
      cursorLineText: ln != null ? ln.slice(-80) : null,
    };
  }).catch((e) => ({ err: String(e) }));
  return { ok: false, labels: lastLabels, dump };
}

/** 统计当前弹层 runtime 候选数（降级断言用） */
async function runtimeSuggestCount(page) {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.suggest-widget:not(.hidden) .monaco-list-row');
    let n = 0;
    for (const r of rows) {
      const detail = (r.querySelector('.detail-label')?.textContent || r.textContent || '').trim();
      if (detail.includes('runtime') || detail.includes('⟳')) n += 1;
    }
    return n;
  }).catch(() => -1);
}

/** 关闭补全弹层 */
async function closeSuggest(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(150);
}

runWithRealApp(
  {
    tmpPrefix: 'oc-chain-real-',
    logName: '.tauri-dev-chain.log',
    summaryTitle: 'P1 调用链推断 · 真机全链路验收',
    requirePaths: [{ path: REAL_PYTHON, message: '解释器不存在', hint: '用 OC_REAL_PYTHON 指定' }],
    setupFixtures({ tmp, workspace, dataRoot }) {
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, 'chain_demo.py'), TEST_PY, 'utf8');
      presetInterpreter(dataRoot, workspace, REAL_PYTHON);
      presetRecentWorkspaces(dataRoot, [workspace]);
      console.log(`[环境] workspace=${workspace}`);
    },
  },
  async (s) => {
    const { page, dataRoot } = s;

    // 收集 intel 引擎全部 stderr 行 + [intel] 前缀 console（启动失败 warn 等）——
    // 「请求没到 intel」与「intel 返回空」用有无请求级日志区分，EXC-1 结束后输出
    const intelErrs = [];
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('[lsp-stderr:intel]') || t.includes('[intel]')) intelErrs.push(t);
    });

    // —— 预检：模拟 lsp.rs::locate_intel_binary **修复后**的完整查找顺序，报告
    // 「真机实际会执行的 exe」。教训两则：① dev 布局回扫 release 优先于 debug，
    // 旧 release 静默盖过新 debug（上一批）；② resource 候选（tauri dev 下 =
    // src-tauri/target/<profile>/）里的 intel exe 旧副本静默盖过 intel/target 工作副本，
    // 「链式用例过 + except 新用例挂 + 无新代码日志」三现象并存（本批实锤）。
    const os = require('os');
    const exeName = 'opencharm-intel.exe';
    const newestOf = (paths) => paths
      .filter((p) => fs.existsSync(p))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    const home = os.homedir();
    const shellTarget = path.join(__dirname, '..', 'src-tauri', 'target');
    const intelTarget = path.join(__dirname, '..', '..', 'intel', 'target');
    const pickOrder = [];
    if (process.env.OPENCHARM_INTEL_BIN) {
      pickOrder.push(['env OPENCHARM_INTEL_BIN', [process.env.OPENCHARM_INTEL_BIN]]);
    }
    pickOrder.push(
      ['runtime_dir', [path.join(home, '.opencharm', 'runtime', exeName)]],
      // tauri dev = debug 构建 → lsp.rs 的 dev 分支（intel/target mtime 新者）优先于 resource
      ['dev(intel/target 新者)', ['debug', 'release'].map((d) => path.join(intelTarget, d, exeName))],
      ['resource(src-tauri/target 新者)', ['debug', 'release'].map((d) => path.join(shellTarget, d, exeName))],
      ['回扫(intel/target 新者)', ['debug', 'release'].map((d) => path.join(intelTarget, d, exeName))],
    );
    let picked = null;
    let pickedStage = '';
    for (const [stage, paths] of pickOrder) {
      const hit = newestOf(paths.filter(Boolean));
      if (hit) { picked = hit; pickedStage = stage; break; }
    }
    if (!picked) {
      record('CHAIN-0', 'opencharm-intel.exe 已定位（完整查找顺序）', false,
        '未在任何候选位置找到 opencharm-intel.exe，先 cargo build -p opencharm-intel');
      return;
    }
    const ageMin = Math.round((Date.now() - picked.mtime) / 60000);
    const newestWorkspace = newestOf(['debug', 'release'].map((d) => path.join(intelTarget, d, exeName)));
    const lagNote = newestWorkspace && newestWorkspace.p !== picked.p
      ? `；⚠ intel/target 最新为 ${newestWorkspace.p}` : '';
    record('CHAIN-0', 'opencharm-intel.exe 已定位（按修复后查找顺序=真机实际执行者）', true,
      `命中 ${pickedStage}：${picked.p}（mtime 距今 ${ageMin} 分钟）${lagNote}`);

    await dismissBlockingModals(page);
    await page.locator('#tree .tree-item .name', { hasText: 'chain_demo.py' })
      .first().waitFor({ timeout: 60000 });
    record('CHAIN-TREE', '工作区恢复且树可见', true);

    // 打开文件
    await page.locator('#tree .tree-item .name', { hasText: 'chain_demo.py' }).first().dblclick();
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30000 });
    await sleep(2000); // 给静态引擎/intel 初次连接留时间
    record('CHAIN-OPEN', 'chain_demo.py 已打开进编辑器', true);

    // —— CHAIN-1：运行脚本（probe 真实采样 → trace 库落盘）——
    let runOk = false;
    let runDetail = '';
    const traceDir = path.join(dataRoot, 'traces');
    try {
      await page.locator('#btn-run-script').click();
      for (let i = 0; i < 40; i++) {
        await sleep(1000);
        const term = await page.locator('#terminal, .terminal, #view-terminal')
          .first().textContent().catch(() => '');
        if (/RESULT\s+17\s+/.test(term || '')) { runOk = true; runDetail = '终端输出含 RESULT 17'; break; }
        runDetail = (term || '').replace(/\s+/g, ' ').trim().slice(-160);
      }
    } catch (e) { runDetail = String(e).split('\n')[0]; }
    const traceDbs = fs.existsSync(traceDir) ? fs.readdirSync(traceDir).filter((f) => f.endsWith('.db')) : [];
    record('CHAIN-1', '运行脚本真实完成（probe 采样入库）', runOk && traceDbs.length > 0,
      `${runDetail}；trace 库 ${traceDbs.length} 个（${traceDir}）`);

    // —— 后续用例都需要 trace 库，缺了就不再硬跑 ——
    if (!runOk || traceDbs.length === 0) return;

    // 等待 intel 感知库变化（下一次补全请求触发 mtime+size 重载）
    await sleep(1500);

    // 触发器：先 click 编辑器夺回焦点（运行后 xterm 抢焦点），再文件尾新行键入触发串
    const typeAtTail = async (trigger) => {
      await page.locator('.monaco-editor').first().click();
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type(trigger, { delay: 20 });
    };

    // —— CHAIN-2：工厂链 `make_order(9, [1]).`（列表字面量实参回归钉）——
    await typeAtTail('make_order(9, [1]).');
    let r2 = await waitForRuntimeSuggest(page);
    const r2hit = r2.ok && /price|items/.test(r2.labels.join(' '));
    record('CHAIN-2', '工厂链 `make_order(9, [1]).` 出 price/items（`[` 实参回扫 + ret 传播）', r2hit,
      r2hit ? `候选: ${r2.labels.slice(0, 6).join(' | ')}` : `15s 内无 runtime 候选；dump=${JSON.stringify(r2.dump)}`);
    await closeSuggest(page);

    // —— CHAIN-3：方法链 `find_best(x).`（find_best ret=Order → 实例属性）——
    await typeAtTail('find_best([]).');
    let r3 = await waitForRuntimeSuggest(page);
    const r3hit = r3.ok && /price|items/.test(r3.labels.join(' '));
    record('CHAIN-3', '方法链 `find_best([]).` 出 price/items（find_best ret=Order）', r3hit,
      r3hit ? `候选: ${r3.labels.slice(0, 6).join(' | ')}` : `15s 内无 runtime 候选；dump=${JSON.stringify(r3.dump)}`);
    await closeSuggest(page);

    // —— CHAIN-4：调用后下标 `get_quotes()["` ——
    await typeAtTail('get_quotes()["');
    let r4 = await waitForRuntimeSuggest(page);
    const r4hit = r4.ok && /data|total/.test(r4.labels.join(' '));
    record('CHAIN-4', '调用后下标 `get_quotes()["` 出 data/total（ret dict 键）', r4hit,
      r4hit ? `候选: ${r4.labels.slice(0, 6).join(' | ')}` : `15s 内无 runtime 候选；dump=${JSON.stringify(r4.dump)}`);
    await closeSuggest(page);

    // —— CHAIN-5：深层下标链 `get_quotes()["data"][0]["` ——
    await typeAtTail('get_quotes()["data"][0]["');
    let r5 = await waitForRuntimeSuggest(page);
    const r5hit = r5.ok && /code|name/.test(r5.labels.join(' '));
    record('CHAIN-5', '深层下标链 `get_quotes()["data"][0]["` 出 code/name（嵌套 shape 解析）', r5hit,
      r5hit ? `候选: ${r5.labels.slice(0, 6).join(' | ')}` : `dump=${JSON.stringify(r5.dump)}`);
    await closeSuggest(page);

    // —— CHAIN-6：无观测降级 `unknown_fn(x).` → 不出 runtime 垃圾候选 ——
    await typeAtTail('unknown_fn(x).');
    await sleep(3000); // 给「确实无候选」的判定留观察窗
    const runtime6 = await runtimeSuggestCount(page);
    record('CHAIN-6', '无观测调用 `unknown_fn(x).` 不出 runtime 候选（降级不产垃圾）', runtime6 === 0,
      `runtime 候选数=${runtime6}`);
    await closeSuggest(page);

    // —— P2 EXC-1：except 异常补全 `except ValueErr` → ValueError（exc_types 观测）——
    // 采样点：main() 里 risky(-1) 抛 ValueError 被 except 捕获（probe RAISE 事件入库）。
    // 触发说明：20ms/字符快速连打时弹层先被静态候选打开，此后字母只做 Monaco 本地过滤
    // 不再请求 provider（真机多轮实测）——故 Escape 关层后补一个 trigger 字符 `(` 强制
    // 重新请求；intel 侧空前缀返回全部观测异常（含 ValueError），与用户慢速键入行为等价。
    await typeAtTail('except ValueErr');
    await sleep(400);
    await page.keyboard.press('Escape').catch(() => {});
    await page.keyboard.type('(', { delay: 60 });
    const rexc = await waitForRuntimeSuggest(page, { timeoutMs: 12000 });
    const exchit = rexc.ok && /ValueError/.test(rexc.labels.join(' '));
    record('EXC-1', 'except 头部 `except ValueErr(` 出 ValueError（异常观测候选）', exchit,
      exchit ? `候选: ${rexc.labels.slice(0, 6).join(' | ')}`
        : `12s 内无候选；dump=${JSON.stringify(rexc.dump)}；intel 相关 console ${intelErrs.length} 行:\n${intelErrs.join('\n')}`);
    await closeSuggest(page);
  },
);
