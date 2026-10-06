#!/usr/bin/env node
/**
 * 释放 dev server 端口（默认 5173）——「`npm run tauri dev` 报 5173 被占用」的自愈前置。
 *
 * 背景（反复出现的真实现场）：Playwright 的 `webServer` 在 5173 无人监听时会自己
 * 拉起 dev server；一旦测试进程被强杀（Ctrl-C / 关终端 / 任务管理器 / CI 超时），
 * vite 就变成**孤儿进程**继续占着 5173。之后再跑 `npm run tauri dev`，Tauri 的
 * `beforeDevCommand`（`npm run dev`）又会去起 vite，而 `vite.config.ts` 里
 * `strictPort: true` 不会退让端口 → 直接失败，报「5173 端口被占用」。
 * 本脚本是 `npm run dev` 的**前置一步**（2026-10-06 起已真正接进 `package.json` 的 `dev` 脚本：
 * `node scripts/free-dev-port.mjs && vite`）：先把上一轮遗留的 vite 收掉。因为 Tauri 的
 * `beforeDevCommand` 就是 `npm run dev`，这一步同时护住了 `npm run tauri dev`。
 * 也可手动跑 `npm run e2e:clean`。
 *
 * 与 `e2e-launch.mjs` 的分工：**e2e 启动器负责回收「它自己起的」dev server**（正常退出 /
 * Ctrl-C / 异常三条路径）；本脚本是**兜底**——覆盖启动器被 SIGKILL / 任务管理器强杀、
 * 来不及收尾而留下的孤儿。
 *
 * ⚠ 2026-10-06 修：本脚本原先用 `spawnSync` 调 netstat/powershell/taskkill。本机
 *   `spawnSync` 起子进程会**持续 EBUSY**（详见 `proc-util.mjs` 头部），于是三个调用全部
 *   静默失败——**脚本会打印「已清理」而端口纹丝不动**。现已全部改走异步 `spawn`。
 *
 * 纪律：**只杀确认是本项目 vite dev server 的进程**——判定依据是进程命令行含
 * `vite`。拿不到命令行、或命令行不像 vite 的，一律**不杀**，退出码 1 并打印处置
 * 建议。宁可让人看一眼，也不误杀别的程序。
 *
 * 用法：
 *   node scripts/free-dev-port.mjs                 # 清 5173（默认）
 *   node scripts/free-dev-port.mjs --port 4173     # 清指定端口
 *   node scripts/free-dev-port.mjs --dry-run       # 只报告不杀（排查用）
 *
 * 退出码：0 = 端口可用（本来就空 / 已清理并确认释放）；1 = 端口被非 vite 进程占用而拒绝清理，
 *         或清理后端口仍未释放。
 */

import { setTimeout as delay } from "node:timers/promises";
import { commandLineOf, killTree, listeningPids } from "./proc-util.mjs";

const argv = process.argv.slice(2);

/** 取 `--port N`（默认 5173） */
function readPort() {
  const i = argv.indexOf("--port");
  if (i !== -1 && argv[i + 1] && /^\d+$/.test(argv[i + 1])) return Number(argv[i + 1]);
  return 5173;
}

const PORT = readPort();
const DRY_RUN = argv.includes("--dry-run");

/** 是否本项目的 vite dev server：命令行里含 vite（node .../vite/bin/vite.js / npx vite 都命中） */
function looksLikeVite(cmd) {
  return /vite/i.test(cmd);
}

/** 端口上的「外来」监听者（排除自己） */
async function othersOnPort(port) {
  return (await listeningPids(port)).filter((p) => p !== process.pid);
}

async function waitPortFree(port, deadlineMs) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if ((await othersOnPort(port)).length === 0) return true;
    await delay(200);
  }
  return (await othersOnPort(port)).length === 0;
}

// ---------- 主流程 ----------

const pids = await othersOnPort(PORT);

if (pids.length === 0) {
  process.exit(0); // 端口本来就空：静默放行，不拖慢 dev 启动
}

const verdicts = [];
for (const pid of pids) {
  const cmd = await commandLineOf(pid);
  verdicts.push({ pid, cmd, isVite: looksLikeVite(cmd) });
}

const strangers = verdicts.filter((v) => !v.isVite);

if (strangers.length > 0) {
  console.error(`[free-dev-port] 端口 ${PORT} 被**非 vite** 进程占用，已拒绝自动清理：`);
  for (const s of strangers) {
    console.error(`  PID ${s.pid}：${s.cmd || "（拿不到命令行）"}`);
  }
  console.error("请自行确认后处理，例如：taskkill /PID <pid> /T /F");
  process.exit(1);
}

if (DRY_RUN) {
  console.log(`[free-dev-port] --dry-run：端口 ${PORT} 被以下 vite 进程占用（未杀）：`);
  for (const v of verdicts) console.log(`  PID ${v.pid}：${v.cmd}`);
  process.exit(0);
}

for (const v of verdicts) {
  const ok = await killTree(v.pid);
  console.log(
    ok
      ? `[free-dev-port] 已清理上一轮遗留的 dev server：PID ${v.pid}（端口 ${PORT}）`
      : `[free-dev-port] 清理失败：PID ${v.pid}，请手动 taskkill /PID ${v.pid} /T /F`,
  );
}

// 等端口真正释放：调用方（vite）紧接着就会 bind，不留回收窗口会撞上「端口仍被占用」
if (!(await waitPortFree(PORT, 3_000))) {
  console.error(`[free-dev-port] 端口 ${PORT} 清理后仍未释放，请手动处理后再启动。`);
  process.exit(1);
}

process.exit(0);
