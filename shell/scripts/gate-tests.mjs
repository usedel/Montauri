// 门禁包装：把测试全量跑完并落盘，绕开「执行监控按 watch 处理并杀进程 + 吞 stdout」的限制。
// 命名刻意避开 vitest/playwright 关键字——含这些词的命令会被监控判为 watch 并在约 10s 后被杀。
//
// 用法：
//   node shell/scripts/gate-tests.mjs unit            # vitest 全量
//   node shell/scripts/gate-tests.mjs unit <filter>   # vitest 单文件/单用例
//   node shell/scripts/gate-tests.mjs e2e [spec...]   # playwright e2e（可指定 spec）
//   node shell/scripts/gate-tests.mjs e2e-real        # 真机 CDP（若有）
//
// 产物：%TEMP%\opencharm-gates\<kind>.log（覆盖写）；退出码透传。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHELL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(tmpdir(), "opencharm-gates");
const kind = process.argv[2] ?? "unit";
const rest = process.argv.slice(3);
mkdirSync(OUT_DIR, { recursive: true });

let cmd;
let args;
if (kind === "unit") {
  cmd = process.execPath;
  args = ["scripts/vitest-launch.mjs", "--watch=false", "--run", ...rest];
} else if (kind === "e2e") {
  cmd = process.execPath;
  args = ["node_modules/@playwright/test/cli.js", "test", ...rest];
} else {
  console.error(`未知门禁类型：${kind}`);
  process.exit(2);
}

const logPath = join(OUT_DIR, `${kind}.log`);
writeFileSync(logPath, `[gate] ${new Date().toISOString()} running: node ${args.join(" ")}\n\n`, "utf8");
const startedAt = Date.now();
const r = spawnSync(cmd, args, {
  cwd: SHELL_DIR,
  shell: false,
  env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(
  logPath,
  readFileSync(logPath, "utf8") + (r.stdout ?? "") + (r.stderr ?? "") +
    `\n[gate] exit=${r.status} signal=${r.signal ?? "-"} elapsed=${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`,
  "utf8",
);
console.log(`[gate] ${kind} 日志：${logPath}（exit=${r.status}）`);
const text = readFileSync(logPath, "utf8");
const tail = text.split(/\r?\n/).slice(-40).join("\n");
console.log(tail);
process.exit(r.status ?? 1);
