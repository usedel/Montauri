#!/usr/bin/env node
/**
 * E2E 启动器（`npm run e2e`）——绕开 playwright `webServer` 在 Windows 上的关闭挂起，
 * 并**保证本轮自起的 dev server 在退出时被回收**（不再留孤儿占住 5173）。
 *
 * 为什么需要它（真实现场，反复出现过）：
 *   playwright 的 `webServer` 在 5173 无人监听时会**自己拉起** dev server；关闭阶段在 Windows
 *   上会挂住——用例其实 1 分钟就全跑完了，进程却再挂 5 分钟以上（DEBUG=pw:webserver 显示
 *   `Terminating the WebServer` 之后不再前进，最终把卡住时间也算进 `N passed (3.2m)`）。
 *   根因：playwright 经 `cmd /c <command>` 起 server，关闭时先只杀掉 cmd，vite 作为**孙进程**
 *   存活并持有 stdout 管道，playwright 于是一直等（`gracefulShutdown` 配置也无效）。
 *
 * 做法：先确保 5173 有 dev server 在跑（没有就起一个），playwright 因
 *   `reuseExistingServer: true` 直接复用 → 不进入「自起再关闭」路径 → 正常退出。
 *
 * ⚠ 端口回收（2026-10-06 修，本文件的核心职责之一）：
 *   早先的实现把自起的 vite 设成 `detached + unref` 并**刻意留着给下一轮复用**，但从不回收
 *   —— 于是**每跑一轮 e2e 就多一个孤儿 vite 占着 5173**，而 `vite.config.ts` 是
 *   `strictPort: true`（不让端口），下一次 `npm run tauri dev` 直接起不来。这个坑复发过多次。
 *   现在改为：**只回收「本轮自己起的」那个进程树**（`taskkill /PID <pid> /T /F`），
 *   别人已经起好的（你自己 `npm run dev` 的）绝不动；并在正常退出 / Ctrl-C / 异常三条路径上都收。
 *   兜底还有两道：`npm run dev` 前置 `free-dev-port.mjs` 自愈（覆盖被强杀留孤儿的情况），
 *   以及手动 `npm run e2e:clean`。
 *
 * 用法：
 *   npm run e2e                    # 全量
 *   npm run e2e -- e2e/http        # 传参给 playwright（目录 / 文件 / --grep / --reporter 均可）
 *   npm run e2e:clean              # 只回收 5173 上的遗留 dev server
 */

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { killTree } from "./proc-util.mjs";

const PORT = 5173;

/**
 * TCP 层探测端口是否有人监听。
 * **刻意不用 HTTP 探测**：本机装有 MITM 代理（http-divert-proxy），HTTP 请求会被它接走并
 * 返回 502 —— 那会让我们误判"服务在跑"（其实没有），代理不在时又误判相反方向。
 */
function tryConnect(port, host, timeoutMs) {
  return new Promise((resolve) => {
    const sock = connect({ port, host });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/** 双栈都试：vite 默认绑 `localhost`，在 Windows 上常只落在 `::1`（只探 127.0.0.1 会假阴性） */
function portOpen(port, timeoutMs = 800) {
  return Promise.all([
    tryConnect(port, "127.0.0.1", timeoutMs),
    tryConnect(port, "::1", timeoutMs),
  ]).then(([v4, v6]) => v4 || v6);
}

async function waitReady(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (await portOpen(PORT)) return true;
    await delay(250);
  }
  return false;
}

async function waitPortFree(deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (!(await portOpen(PORT, 400))) return true;
    await delay(200);
  }
  return !(await portOpen(PORT, 400));
}

// ---------- 自起 dev server（仅在本轮真的需要时） ----------

/** 本轮**由本脚本**起的 dev server PID；为 null 表示复用了别人的（绝不动它） */
let ownVitePid = null;

if (!(await portOpen(PORT))) {
  console.log("[e2e] 5173 无 dev server，先起一个（约 3 秒）…");
  // 输出落系统临时目录（与 playwright 的 outputDir 同一约定，不污染工作区）：
  // stdio 用文件而不是管道——父进程退出后不会被未关闭的 stream 拖住。
  const logPath = join(tmpdir(), "montauri-e2e-vite.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    // detached：把 vite 放进独立进程组，测试期间不受控制台 Ctrl-C 波及（收尾由本脚本负责）。
    // 注意：**必须**配合下面的 teardown 回收，否则就是孤儿进程（这正是 5173 被占住的根因）。
    detached: true,
  });
  child.on("error", (e) => console.error(`[e2e] 启动 dev server 失败：${e.message}`));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[e2e] dev server 退出（code=${code}），日志：${logPath}`);
  });
  child.unref();
  closeSync(logFd); // 父进程不再持有句柄（子进程已继承）
  ownVitePid = child.pid ?? null;
  if (!(await waitReady(60_000))) {
    console.error(`[e2e] dev server 未能在 60s 内就绪，日志：${logPath}`);
    console.error("[e2e] 若提示端口被占用，先跑：npm run e2e:clean");
    if (ownVitePid) await killTree(ownVitePid);
    process.exit(1);
  }
  console.log("[e2e] dev server 就绪");
} else {
  console.log("[e2e] 复用已在运行的 5173 dev server（退出时不回收，它不是本脚本起的）");
}

// ---------- 回收（正常退出 / Ctrl-C / 异常三条路径都要走到） ----------

let teardownDone = false;

async function teardown() {
  if (teardownDone) return;
  teardownDone = true;
  if (!ownVitePid) return;
  console.log(`[e2e] 回收本轮自起的 dev server（PID ${ownVitePid}）…`);
  if (!(await killTree(ownVitePid))) {
    console.error(`[e2e] 回收失败（PID ${ownVitePid}）。请跑：npm run e2e:clean`);
    return;
  }
  if (!(await waitPortFree(4_000))) {
    console.error(`[e2e] 端口 ${PORT} 未在 4s 内释放。请跑：npm run e2e:clean`);
  } else {
    console.log(`[e2e] 已释放端口 ${PORT}`);
  }
}

async function shutdown(code) {
  await teardown();
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

// ---------- 跑 playwright（异步 spawn：好在信号处理里收尾） ----------

// 直接调 CLI 入口（照 scripts/vitest-launch.mjs 的约定）：不走 npx —— Node ≥18.20 出于安全
// 补丁拒绝在无 shell 时 spawn `.cmd`，而 `shell: true` 又会多插一层 cmd.exe。
function runPlaywright(args) {
  return new Promise((resolve) => {
    const p = spawn(
      process.execPath,
      ["node_modules/@playwright/test/cli.js", "test", ...args],
      { stdio: "inherit", windowsHide: false },
    );
    p.on("error", (e) => {
      console.error(`[e2e] 无法启动 playwright：${e.message}`);
      resolve(1);
    });
    p.on("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
}

let exitCode = 1;
try {
  exitCode = await runPlaywright(process.argv.slice(2));
} finally {
  await teardown();
}
process.exit(exitCode);
