#!/usr/bin/env node
/**
 * 真机验收：单实例 + 启动路由（tauri-plugin-single-instance，2026-10-10）
 *
 * 覆盖（用户报告双场景的修复验证）：
 *  - SI-1 第二实例被拦截退出：spawn 第二个 exe（同 identifier mutex），进程应在数秒内退出
 *  - SI-2 场景 2（文件 ∈ 当前工作区）：第二实例带「工作区内 md」参数 → 主窗口聚焦 + startup-file
 *        事件 → 文件 tab 打开（不新开窗口）
 *  - SI-3 场景 1/2 兜底（文件 ∉ 任何已开工作区）：第二实例带「外部 md」→ 路由开新项目窗口
 *        （探测根 = 外部文件所在目录）+ pending 槽透传 → 新窗口打开该文件
 *
 * 实现要点：
 *  - 主实例走 npm run tauri dev（real-env 基建 + CDP）；第二实例用同一 dev 产物 exe
 *    （target/debug/montauri-shell.exe）直接 spawn——同 identifier → 命中同一 mutex。
 *  - ⚠ dev 与安装版共用 identifier 互斥是已知边界；本脚本验证 dev↔dev（同产物）。
 *  - 第二实例不能带 CDP 环境变量（否则新开 9223 会话干扰主实例断言）。
 */
'use strict';

const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = require('fs');
const os = require('os');
const path = require('path');
const {
  runWithRealApp, record, sleep, presetRecentWorkspaces, dismissBlockingModals,
} = require('./lib/real-env.cjs');

const CDP_PORT = 9231; // 独立端口（不与常规 9223 套件互抢）
const EXE = path.join(__dirname, '..', 'src-tauri', 'target', 'debug', 'montauri-shell.exe');

/** spawn 第二实例（不带 CDP env），返回 [child, 退出码 Promise] */
function spawnSecondInstance(fileArg, dataRoot) {
  const args = fileArg ? [fileArg] : [];
  const child = spawn(EXE, args, {
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MONTAURI_DATA_ROOT: dataRoot,
      // 显式清掉主实例的 CDP 参数，防止第二实例抢 9223/9231
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '',
    },
  });
  const exited = new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });
  return [child, exited];
}

async function main() {
  if (!existsSync(EXE)) {
    console.error(`[预检失败] dev 产物不存在：${EXE}（先 cargo build 或跑一次 tauri dev）`);
    process.exit(2);
  }

  await runWithRealApp({
    suite: 'single-instance-real',
    cdpPort: CDP_PORT,
    logName: '.tauri-dev-si.log',
    summaryTitle: '单实例 + 启动路由 真机验收',
    requirePaths: [{ path: EXE, message: 'dev 产物 exe' }],
    setupFixtures: ({ tmp, workspace }) => {
      // 工作区 A：带 .git（find_project_root 对 md 找 .git）
      const gitDir = path.join(workspace, '.git');
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(path.join(workspace, 'inside.md'), '# inside\n');
      // 工作区外的外部文件（路由应开新窗口）
      const externalDir = path.join(tmp, 'external');
      mkdirSync(externalDir, { recursive: true });
      writeFileSync(path.join(externalDir, 'outside.md'), '# outside\n');
      return { externalDir };
    },
  }, async (session) => {
    const { page, tmp, workspace, dataRoot, fixtures } = session;
    presetRecentWorkspaces(dataRoot, [workspace]);

    // 等主实例恢复工作区 A（树可见）
    await page.waitForSelector('#tree .tree-item', { timeout: 60_000 });
    await dismissBlockingModals(page);
    // 等工作区上报（report_main_workspace 落注册表——路由判定的数据源）
    await page.waitForFunction(
      () => !!(window.__TAURI_INTERNALS__),
      undefined,
      { timeout: 10_000 },
    ).catch(() => { /* 注册表在 Rust 侧，页面侧不可见——只等时间 */ });
    await sleep(1500); // openWorkspace 末尾的上报 invoke 完成

    // —— SI-1：第二实例（无参数）被拦截退出 ——
    {
      const [, exited] = spawnSecondInstance(null, dataRoot);
      const code = await Promise.race([exited, sleep(15_000).then(() => null)]);
      record('SI-1', '第二实例被拦截快速退出', code !== null, `exit=${code}`);
      if (code === null) throw new Error('第二实例 15s 未退出（单实例未生效？）');
    }

    // —— SI-2：文件 ∈ 当前工作区 → 聚焦 + 直接打开文件（不新开窗口） ——
    {
      const before = session.pages().length;
      const inside = path.join(workspace, 'inside.md');
      const [, exited] = spawnSecondInstance(inside, dataRoot);
      const code = await Promise.race([exited, sleep(15_000).then(() => null)]);
      // 事件路由是异步的：等 startup-file → openFile → tab 渲染
      await page.waitForSelector('#tabbar .tab.active', { timeout: 15_000 }).catch(() => {});
      const tabText = await page.locator('#tabbar .tab.active .name').textContent().catch(() => '');
      const after = session.pages().length;
      record('SI-2a', '第二实例（工作区内文件）退出', code !== null, `exit=${code}`);
      record('SI-2b', '主窗口直接打开该文件（startup-file 路由）', (tabText || '').includes('inside.md'), `tab=${tabText}`);
      record('SI-2c', '不新开窗口', after === before, `pages ${before}→${after}`);
    }

    // —— SI-3：文件 ∉ 任何已开工作区 → 开新项目窗口 + pending 文件 ——
    {
      const before = session.pages().length;
      const outside = path.join(fixtures.externalDir, 'outside.md');
      const [, exited] = spawnSecondInstance(outside, dataRoot);
      const code = await Promise.race([exited, sleep(15_000).then(() => null)]);
      // 新窗口 page 出现（探测根 = externalDir 的 project_hash 窗口）
      let newPage = null;
      for (let i = 0; i < 40; i++) {
        const ps = session.pages();
        if (ps.length > before) {
          newPage = ps[ps.length - 1];
          break;
        }
        await sleep(500);
      }
      record('SI-3a', '第二实例（外部文件）退出', code !== null, `exit=${code}`);
      record('SI-3b', '路由开新项目窗口', !!newPage, `pages ${before}→${session.pages().length}`);
      if (newPage) {
        // 新窗口：openInitialWorkspace → take_startup_file → openSingleFile
        await newPage.waitForSelector('#tabbar .tab.active', { timeout: 30_000 }).catch(() => {});
        const tabText = await newPage.locator('#tabbar .tab.active .name').textContent().catch(() => '');
        record('SI-3c', '新窗口打开 pending 文件', (tabText || '').includes('outside.md'), `tab=${tabText}`);
        // 树头 = 探测根（externalDir，回退语义）
        const header = await newPage.locator('#tree-header-text').textContent().catch(() => '');
        record('SI-3d', '新窗口工作区 = 外部文件目录（探测根）', (header || '').includes('external'), `header=${header}`);
      }
    }
  });
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
