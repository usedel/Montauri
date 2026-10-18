// 临时测试包装：全量测试，输出落盘
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const r = spawnSync(process.execPath, ["scripts/vitest-launch.mjs"], {
  cwd: "d:/aipro/montauri/shell",
  encoding: "utf8",
  timeout: 600000,
});
writeFileSync("d:/aipro/montauri/shell/tools/i18n/data/_tmp/test-full.txt", (r.stdout ?? "") + (r.stderr ?? ""), "utf8");
console.log("exit=" + r.status);
