// 工具链引导（Phase 4 第 4 步）：探测 uv / 静态引擎（pyrefly/basedpyright）/ ruff / git 缺失项。
// 仅做底层 invoke 封装 + 一份进程内状态缓存；引导确认与输出渲染见 envPanel.ts。
//
// 缓存为什么必要：探测要 spawn 四次 `is_available`（含 PATH 扫描），而工具链状态现在有**三个**
// 消费方——首启引导、设置 →「保存」的内联提示、设置 →「Python」的工具链状态块。各自现查会出现
// 「一处说没装、一处说装了」。安装成功后由调用方 invalidateToolchainStatus() 失效。

import { invoke } from "@tauri-apps/api/core";
import { app } from "./state";

export interface ToolchainEngineStatus {
  name: string;
  command: string;
  ok: boolean;
}

export interface ToolchainStatus {
  uv: boolean;
  engine: ToolchainEngineStatus;
  ruff: boolean;
  /** git 是否存在（只探测、不进 allOk：git 不是 PyPI 包，uv 装不了，故不进一键安装流程） */
  git: boolean;
  /** uv 与当前静态引擎均就绪（补全 + 运行的最低门槛） */
  allOk: boolean;
}

/** 可一键安装的工具（git 不在此列：非 PyPI 包，只能提示用户自行安装） */
export type InstallableTool = "uv" | "engine" | "ruff";

let cached: ToolchainStatus | null = null;
/** 在途探测：并发调用合并成一次（三个入口可能同时首次渲染） */
let inflight: Promise<ToolchainStatus> | null = null;

/** 探测工具链缺失状态（默认走缓存；force=true 强制重查） */
export async function getToolchainStatus(force = false): Promise<ToolchainStatus> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  const engine = app.settings.lsp_engine ?? "pyrefly";
  inflight = invoke<ToolchainStatus>("detect_toolchain", { engine })
    .then((st) => {
      cached = st;
      return st;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 失效缓存（安装成功后必须调用，否则「装了还提示」） */
export function invalidateToolchainStatus(): void {
  cached = null;
  inflight = null;
}

/**
 * 安装工具（进度经 toolchain-stdout / toolchain-stderr 事件流式推送）。
 * @param only 按件安装，如 `["ruff"]`；省略 = 全量（uv → 静态引擎 → ruff）。
 *   传 only 时 uv 仍会作为前置自动确保——引擎与 ruff 都靠 `uv tool install` 落地。
 * @returns 点名项是否就绪（全量时只认静态引擎）
 */
export async function installToolchain(engine: string, only?: InstallableTool[]): Promise<boolean> {
  return invoke<boolean>("install_toolchain", { engine, only: only ?? null });
}
