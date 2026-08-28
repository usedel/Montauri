import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Rust 编译产物目录，前端无需监听；且 Windows 下 cargo 写入 dll 时
      // 会被 fs.watch 占用导致 EBUSY 崩溃（beforeDevCommand 退出）。
      ignored: ["**/src-tauri/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});
