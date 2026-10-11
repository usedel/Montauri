// @vitest-environment happy-dom
// envPanel：体验审查 L-8——长操作（建环境 / 装包 / 卸包 / 升级 / 工具链安装）期间
// env 域写操作必须整体禁用，防两个 uv 进程并发写同一环境。
//
// 只测「锁」这一条契约（不测 uv 调用本身）：工具链安装是 envPanel 导出的唯一长操作入口，
// 用它当探针最省事——installToolchain 用可手动释放的 pending promise 挂住，观察中途与结束后的禁用态。
// DOM 骨架必须先于 import 就位（envPanel 的 lazyEl 在调用点解析，但 setEnvWriteDisabled 会直接摸这些节点）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../state";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen: vi.fn() }) }));
vi.mock("../toast", () => ({ toast: vi.fn(), toastFail: vi.fn() }));
vi.mock("../dialog", () => ({ openConfirm: vi.fn(), openAlert: vi.fn() }));
vi.mock("../toolchain", () => ({
  installToolchain: vi.fn(),
  invalidateToolchainStatus: vi.fn(),
  getToolchainStatus: vi.fn(),
}));

const DIV_IDS = [
  "output", "bottom", "env-modal", "env-packages", "env-pkg-count", "status-interpreter",
  "interp-trigger-label", "interp-popover", "interp-select",
  "venv-version-modal", "venv-version-list", "venv-version-hint",
];
const INPUT_IDS = ["env-pkg-input", "env-pkg-filter"];
const BUTTON_IDS = [
  "env-pkg-install", "env-pkg-upgrade-all", "env-pkg-uninstall-selected",
  "interp-trigger", "venv-version-close", "env-close",
];
for (const id of DIV_IDS) {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
}
for (const id of INPUT_IDS) {
  const el = document.createElement("input");
  el.id = id;
  document.body.appendChild(el);
}
for (const id of BUTTON_IDS) {
  const el = document.createElement("button");
  el.id = id;
  document.body.appendChild(el);
}
document.getElementById("env-modal")!.classList.add("hidden");

const envPanel = await import("../envPanel");
const toolchain = await import("../toolchain");

envPanel.initEnvPanel({ restartEngine: async () => {} });

beforeEach(() => {
  app.workspaceRoot = "F:/ws";
  vi.mocked(toolchain.installToolchain).mockReset();
  vi.mocked(toolchain.invalidateToolchainStatus).mockReset();
  envPanel.resetEnvPanelState(); // 每个用例从「未锁定」起步
});

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
/** env 域写操作的全部入口（锁必须同时覆盖它们） */
const writeControls = (): Array<HTMLInputElement | HTMLButtonElement> => [
  byId<HTMLInputElement>("env-pkg-input"),
  byId<HTMLButtonElement>("env-pkg-install"),
  byId<HTMLButtonElement>("env-pkg-uninstall-selected"),
  byId<HTMLButtonElement>("env-pkg-upgrade-all"),
];

describe("L-8：长操作期间锁定 env 域写操作", () => {
  it("工具链安装进行中：包输入 / 安装 / 卸载 / 升级全部禁用；结束后整体恢复", async () => {
    let release: (ok: boolean) => void = () => {};
    vi.mocked(toolchain.installToolchain).mockImplementation(
      () => new Promise<boolean>((resolve) => { release = resolve; }),
    );

    const pending = envPanel.installToolNamed("uv");
    await Promise.resolve(); // 推进到 await installToolchain 处

    for (const el of writeControls()) expect(el.disabled).toBe(true);

    release(false); // false 路径不触发 clearToolchainDismissed 的落盘
    await pending;

    // 锁驱动（纯由 envWriteLocked 决定）的两个控件恢复可用；
    // 另两个（卸载所选 / 升级全部）的禁用来自自身条件（0 勾选 / 0 过时包），与锁无关——
    // 行内按钮的解锁由下一条用例单独验证。
    expect(byId<HTMLInputElement>("env-pkg-input").disabled).toBe(false);
    expect(byId<HTMLButtonElement>("env-pkg-install").disabled).toBe(false);
  });

  it("行内动作按钮随锁同步（重绘产生的行也受锁约束）", async () => {
    const packages = byId("env-packages");
    const rowBtn = document.createElement("button");
    rowBtn.className = "codicon codicon-trash danger";
    packages.appendChild(rowBtn);

    let release: (ok: boolean) => void = () => {};
    vi.mocked(toolchain.installToolchain).mockImplementation(
      () => new Promise<boolean>((resolve) => { release = resolve; }),
    );
    const pending = envPanel.installToolNamed("ruff");
    await Promise.resolve();
    expect(rowBtn.disabled).toBe(true);

    release(false);
    await pending;
    expect(rowBtn.disabled).toBe(false);
    packages.textContent = "";
  });

  it("写锁不影响读操作（筛选框保持可用）", async () => {
    vi.mocked(toolchain.installToolchain).mockImplementation(() => new Promise<boolean>(() => {}));
    void envPanel.installToolNamed("uv");
    await Promise.resolve();
    expect(byId<HTMLInputElement>("env-pkg-filter").disabled).toBe(false);
  });
});
