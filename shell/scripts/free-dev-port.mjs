#!/usr/bin/env node
/**
 * 释放 dev server 端口（默认 5173）——「`npm run tauri dev` 报 5173 被占用」的自愈前置。
 *
 * 背景（反复出现的真实现场）：Playwright 的 `webServer` 在 5173 无人监听时会自己
 * 拉起 dev server；一旦测试进程被强杀（Ctrl-C / 关终端 / 任务管理器 / CI 超时），
 * vite 就变成**孤儿进程**继续占着 5173。之后再跑 `npm run tauri dev`，Tauri 的
 * `beforeDevCommand`（`npm run dev`）又会去起 vite，而 `vite.config.ts` 里
 * `strictPort: true` 不会退让端口 → 直接失败，报「5173 端口被占用」。
 * 本脚本就是 `npm run dev` 的前置一步：先把上一轮遗留的 vite 收掉。
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
 * 退出码：0 = 端口可用（本来就空 / 已清理）；1 = 端口被非 vite 进程占用，已拒绝自动清理。
 */

import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);

/** 取 `--port N`（默认 5173） */
function readPort() {
  const i = argv.indexOf("--port");
  if (i !== -1 && argv[i + 1] && /^\d+$/.test(argv[i + 1])) return Number(argv[i + 1]);
  return 5173;
}

const PORT = readPort();
const DRY_RUN = argv.includes("--dry-run");
const IS_WIN = process.platform === "win32";

/** 监听该端口的 PID 列表（去重；`netstat` 对 IPv4/IPv6 会各出一行，同一个 PID） */
function listeningPids(port) {
  if (IS_WIN) {
    const r = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const out = `${r.stdout ?? ""}`;
    const pids = new Set();
    for (const line of out.split("\n")) {
      const cols = line.trim().split(/\s+/);
      // 形如：TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  3996
      if (cols.length < 5) continue;
      if (cols[0].toUpperCase() !== "TCP") continue;
      if (cols[3].toUpperCase() !== "LISTENING") continue;
      const localPort = cols[1].split(":").pop();
      if (localPort !== String(port)) continue;
      const pid = Number(cols[cols.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  return `${r.stdout ?? ""}`
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * 取进程命令行。Windows 上 `wmic` 已被系统精简掉，只能走 PowerShell；
 * 取不到时返回空串——空串会被判定为「不敢杀」，是安全的默认值。
 */
function commandLineOf(pid) {
  if (IS_WIN) {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    return `${r.stdout ?? ""}`.trim();
  }
  const r = spawnSync("ps", ["-p", String(pid), "-o", "args="], { encoding: "utf8" });
  return `${r.stdout ?? ""}`.trim();
}

/** 是否本项目的 vite dev server：命令行里含 vite（node .../vite/bin/vite.js / npx vite 都命中） */
function looksLikeVite(cmd) {
  return /vite/i.test(cmd);
}

function killTree(pid) {
  if (IS_WIN) {
    // /T 连子进程树一起收：vite 会带 esbuild 等子进程，只杀父进程会留下新孤儿
    const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
    return r.status === 0;
  }
  const r = spawnSync("kill", ["-9", String(pid)], { encoding: "utf8" });
  return r.status === 0;
}

// ---------- 主流程 ----------

const pids = listeningPids(PORT);

if (pids.length === 0) {
  process.exit(0); // 端口本来就空：静默放行，不拖慢 dev 启动
}

const verdicts = pids
  .filter((pid) => pid !== process.pid)
  .map((pid) => {
    const cmd = commandLineOf(pid);
    return { pid, cmd, isVite: looksLikeVite(cmd) };
  });

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
  const ok = killTree(v.pid);
  console.log(
    ok
      ? `[free-dev-port] 已清理上一轮遗留的 dev server：PID ${v.pid}（端口 ${PORT}）`
      : `[free-dev-port] 清理失败：PID ${v.pid}，请手动 taskkill /PID ${v.pid} /T /F`,
  );
}

// 收完不等端口回收：调用方（vite）紧接着会 bind，此时端口应已释放
process.exit(0);
