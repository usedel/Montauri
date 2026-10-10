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
  'def main():',
  '    order = make_order(15, [1, 2])',
  '    best = find_best([order])',
  '    quotes = get_quotes()',
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
    return {
      widgetExists: !!w,
      widgetHidden: w ? w.classList.contains('hidden') : null,
      visible: w ? w.offsetParent !== null : false,
      rowCount: rows.length,
      texts: Array.from(rows).slice(0, 6).map((r) => (r.textContent || '').trim().slice(0, 80)),
      activeEl: document.activeElement?.tagName + '.' + (document.activeElement?.className || '').slice(0, 40),
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

    // —— 预检：intel 二进制必须已构建且足够新（对齐 lsp.rs::locate_intel_binary 的
    // dev 布局查找：从 shell exe 上溯，release 优先于 debug——旧 release 会静默盖过
    // 新 debug，真机验收栽过：debug 修了 bug 但真机跑的还是 3 小时前的 release exe）。
    // 这里取两级中较新者，且要求晚于最近一次 intel 源码提交（宽松：只提示不硬拦）。 ——
    const intelRepo = path.join(__dirname, '..', '..', 'intel', 'target');
    const cands = ['release', 'debug']
      .map((p) => path.join(intelRepo, p, 'opencharm-intel.exe'))
      .filter((p) => fs.existsSync(p))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }));
    const picked = cands.sort((a, b) => b.mtime - a.mtime)[0];
    if (!picked) {
      record('CHAIN-0', 'opencharm-intel.exe 已构建（dev 布局查找）', false, `未找到 ${intelRepo}/{release,debug}/opencharm-intel.exe，先 cargo build -p opencharm-intel`);
      return;
    }
    const ageMin = Math.round((Date.now() - picked.mtime) / 60000);
    record('CHAIN-0', 'opencharm-intel.exe 已构建（dev 布局查找，取 release/debug 较新者）', true,
      `${picked.p}（mtime 距今 ${ageMin} 分钟${cands.length > 1 ? `；共 ${cands.length} 个候选` : ''}）`);

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
  },
);
