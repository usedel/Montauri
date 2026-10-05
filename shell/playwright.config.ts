import { defineConfig } from "@playwright/test";

/**
 * E2E 验收配置（git 改进报告 §11.2）。
 *
 * 架构：浏览器模式驱动 vite dev（5173），Tauri invoke 由 e2e/mocks/tauri.ts 注入的
 * window.__TAURI_INTERNALS__ mock 承载——git_* 命令映射到 Playwright 侧管理的真实
 * 临时 git 仓库（保留真实 git 行为，不依赖 Tauri 运行时）。用例只写「用户旅程」，
 * 不与 vitest 单测（src/__tests__/）重复。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // 用例共享同一 dev server + mock 仓库句柄，串行最稳
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // 产物落系统临时目录：Playwright 每轮清空 outputDir，任何工作区内路径都会触发
  // safe-delete 批量删除确认门槛（>500 文件）卡死测试进程（node_modules 内也一样）
  outputDir: `${process.env.TEMP ?? process.env.TMP ?? "/tmp"}/opencharm-pw-results`,
  use: {
    baseURL: "http://localhost:5173",
    // 强制直连（**不要删**）：本机装有全局 MITM 代理（http-divert-proxy，HTTP_PROXY=127.0.0.1:53018），
    // Windows 上 Chromium 默认走**系统代理**，连 localhost 也丢给代理转发：
    //   · 实测单个请求 0.19s（直连）→ 1.08s（走代理）；vite dev 首屏要拉数百个模块，
    //     整轮 e2e 因此从约 1 分钟劣化到 9 分钟以上，表现为「跑不完」；
    //   · 代理不可用时直接 `net::ERR_PROXY_CONNECTION_FAILED`（清空 HTTP_PROXY 环境变量无效，
    //     因为 Chromium 在 Windows 读的是 WinINET 系统代理，不是 env）。
    // `--no-proxy-server` 覆盖系统代理；e2e 全程离线（tauri-mock 罐头响应、禁真网络），直连无副作用。
    launchOptions: { args: ["--no-proxy-server"] },
    trace: "retain-on-failure", // 失败留现场（trace + 截图）
    screenshot: "only-on-failure",
  },
  webServer: {
    // 直接跑 vite 入口，**不要**改回 `npm run dev`：npm 作为中间层时 playwright 关闭阶段
    // 杀不干净进程树，表现为「用例早已全部跑完（约 1 分钟），进程却再挂 5 分钟以上不退出」。
    command: "node ./node_modules/vite/bin/vite.js",
    url: "http://localhost:5173",
    reuseExistingServer: true, // 本地起过 dev 就复用，避免端口冲突
    timeout: 60_000,
    // Windows 上 playwright 经 `cmd /c <command>` 起 server：关闭时它先只杀掉 cmd，vite 作为
    // 孙进程存活并占着 stdout 管道 → playwright 一直等，表现为「用例全跑完（~1 分钟）后进程
    // 再挂 5 分钟以上」。设优雅关闭上限，超时后走 taskkill /T /F 强杀进程树，不再无限等待。
    gracefulShutdown: { signal: "SIGTERM", timeout: 1_000 },
  },
});
