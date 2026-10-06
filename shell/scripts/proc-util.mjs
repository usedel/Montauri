// 进程工具（**只用异步 spawn，禁用 spawnSync**）——e2e-launch.mjs / free-dev-port.mjs 共用。
//
// 为什么禁用 spawnSync（2026-10-06 实测，本机 Windows）：
//   `spawnSync` 起子进程会**持续报 EBUSY**（`spawnSync taskkill EBUSY` /
//   `spawnSync C:\WINDOWS\system32\cmd.exe EBUSY`），而同一时刻 bash 直接调同名命令却完全正常。
//   一旦踩中，杀进程、取命令行、查端口全部**静默失败**——表现为「脚本说已清理，端口还被占着」。
//   这就是「e2e 跑完 5173 仍被占」长期没被真正修掉的原因之一（旧实现用 spawnSync 杀进程）。
//   对照实测：同一目标进程，spawnSync 连试 3 次全 EBUSY；异步 spawn 一次成功。
//   异步 spawn 唯一代价是调用点要 await —— 这几个脚本本来就是异步的。

import { spawn } from "node:child_process";

export const IS_WIN = process.platform === "win32";

/**
 * 跑一个命令并收集输出（异步）。**永不抛**：起不来时返回 `{ code: null, error }`，
 * 让调用方按「失败」处理，而不是把整个脚本炸掉。
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: "", error: e.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    p.stdout?.on("data", (d) => (stdout += d));
    p.stderr?.on("data", (d) => (stderr += d));
    p.on("error", (e) => resolve({ code: null, stdout, stderr, error: e.message }));
    p.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * 杀**整个进程树**（vite 会带 esbuild 等子进程，只杀父进程会留下新孤儿）。
 * 主路 `taskkill /T /F`；它失败时退回单进程强杀（至少把端口放掉）。
 */
export async function killTree(pid) {
  if (IS_WIN) {
    const r = await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    if (r.code === 0) return true;
  } else {
    const r = await run("kill", ["-9", String(pid)]);
    if (r.code === 0) return true;
  }
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

/** 取进程命令行；取不到返回空串（调用方按「不敢动它」处理，是安全的默认值）。 */
export async function commandLineOf(pid) {
  if (IS_WIN) {
    // Windows 上 wmic 已被系统精简掉，只能走 PowerShell
    const r = await run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
    return `${r.stdout ?? ""}`.trim();
  }
  const r = await run("ps", ["-p", String(pid), "-o", "args="]);
  return `${r.stdout ?? ""}`.trim();
}

/** 监听指定端口的 PID 列表（去重；netstat 对 IPv4/IPv6 会各出一行，同一个 PID）。 */
export async function listeningPids(port) {
  if (IS_WIN) {
    // ⚠ **不要加 `-p tcp`**：那会把 IPv6 的 TCP 监听（TCPv6）整个过滤掉。
    //   而 vite 在本机默认绑 `[::1]`——于是 `-p tcp` 下永远查不到它，
    //   清理脚本会「静默地什么都没做」（这是 5173 长期清不掉的真正原因之一）。
    //   不加 `-p` 时 IPv4/IPv6 一起列；UDP 行没有 LISTENING 状态，下面的过滤会自然排除。
    const r = await run("netstat", ["-ano"]);
    const pids = new Set();
    for (const line of `${r.stdout ?? ""}`.split("\n")) {
      const cols = line.trim().split(/\s+/);
      // 形如：TCP  0.0.0.0:5173  0.0.0.0:0  LISTENING  3996
      //       TCP  [::1]:5173    [::]:0     LISTENING  3996
      if (cols.length < 5) continue;
      if (cols[0].toUpperCase() !== "TCP") continue;
      if (cols[3].toUpperCase() !== "LISTENING") continue;
      if (cols[1].split(":").pop() !== String(port)) continue;
      const pid = Number(cols[cols.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  }
  const r = await run("lsof", ["-ti", `tcp:${port}`]);
  return `${r.stdout ?? ""}`
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}
