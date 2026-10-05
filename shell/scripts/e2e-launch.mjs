#!/usr/bin/env node
/**
 * E2E 启动器（`npm run e2e`）——绕开 playwright `webServer` 在 Windows 上的关闭挂起。
 *
 * 为什么需要它（真实现场，反复出现过）：
 *   playwright 的 `webServer` 在 5173 无人监听时会**自己拉起** dev server；关闭阶段在 Windows
 *   上会挂住——用例其实 1 分钟就全跑完了，进程却再挂 5 分钟以上（DEBUG=pw:webserver 显示
 *   `Terminating the WebServer` 之后不再前进，最终把卡住时间也算进 `N passed (3.2m)`）。
 *   根因：playwright 经 `cmd /c <command>` 起 server，关闭时先只杀掉 cmd，vite 作为**孙进程**
 *   存活并持有 stdout 管道，playwright 于是一直等（`gracefulShutdown` 配置也无效）。
 *   → 同一个现象的另一个后果（孤儿 vite 占着 5173）由 `scripts/free-dev-port.mjs` 处理。
 *
 * 做法：先确保 5173 有 dev server 在跑（没有就起一个并保留），playwright 因
 *   `reuseExistingServer: true` 直接复用 → 不进入「自起再关闭」路径 → 正常退出。
 *
 * 用法：
 *   npm run e2e                    # 全量
 *   npm run e2e -- e2e/http        # 传参给 playwright（目录 / 文件 / --grep / --reporter 均可）
 */

import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

if (!(await portOpen(PORT))) {
  // 注：实测在 Windows + `npm run` 中间层下 vite 不会跨轮保留（npm 退出会连带收掉进程组），
  // 所以每轮多花约 3 秒自起。想让它常驻、让 playwright 直接复用，就先单独 `npm run dev`。
  console.log("[e2e] 5173 无 dev server，先起一个（约 3 秒）…");
  // 输出落系统临时目录（与 playwright 的 outputDir 同一约定，不污染工作区）：
  // stdio 用文件而不是管道——父进程退出后不会被未关闭的 stream 拖住。
  const logPath = join(tmpdir(), "opencharm-e2e-vite.log");
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js"], {
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
    // detached：本启动器退出后 vite 要继续活着供下一轮复用（否则它随父进程一起消失）
    detached: true,
  });
  child.on("error", (e) => console.error(`[e2e] 启动 dev server 失败：${e.message}`));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[e2e] dev server 退出（code=${code}），日志：${logPath}`);
  });
  child.unref();
  closeSync(logFd); // 父进程不再持有句柄（子进程已继承）
  if (!(await waitReady(60_000))) {
    console.error(`[e2e] dev server 未能在 60s 内就绪，日志：${logPath}`);
    console.error("[e2e] 若提示端口被占用，先跑：node scripts/free-dev-port.mjs");
    process.exit(1);
  }
  console.log("[e2e] dev server 就绪");
}

// 直接调 CLI 入口（照 scripts/vitest-launch.mjs 的约定）：不走 npx —— Node ≥18.20 出于安全
// 补丁拒绝在无 shell 时 spawn `.cmd`，而 `shell: true` 又会多插一层 cmd.exe。
const r = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
});
if (r.error) {
  console.error(`[e2e] 无法启动 playwright：${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
