// @vitest-environment happy-dom
// 状态栏「进行中」芯片（体验审查 L-5 / L-3）：全局可见态 + 取消入口 + env 域会话互斥。
// 芯片 DOM 是 index.html 里的静态骨架（#status-op / -label / -cancel），测试里手工搭同构骨架。
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn(), toastFail: vi.fn() }));

const chip = document.createElement("span");
chip.id = "status-op";
chip.classList.add("hidden");
const label = document.createElement("span");
label.id = "status-op-label";
const detail = document.createElement("span");
detail.id = "status-op-detail";
const cancelBtn = document.createElement("button");
cancelBtn.id = "status-op-cancel";
chip.append(label, detail, cancelBtn);
document.body.appendChild(chip);

const statusOp = await import("../statusOp");
const { invoke } = await import("@tauri-apps/api/core");
const { toast } = await import("../toast");

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => undefined as never); // 真实 invoke 恒返回 Promise
  vi.mocked(toast).mockReset();
  // 每个用例从「无操作在跑」起步：end 掉可能残留的（kind 不匹配时是 no-op，故四种都清一遍）
  statusOp.endUvOp("venv");
  statusOp.endUvOp("install");
  statusOp.endUvOp("upgrade");
  statusOp.endUvOp("fix");
});

describe("L-5：状态栏「进行中」芯片", () => {
  it("起手显示「正在…」+ 取消按钮；收尾隐藏", () => {
    expect(statusOp.beginUvOp("venv")).toBe(true);
    expect(chip.classList.contains("hidden")).toBe(false);
    expect(label.textContent).toContain("正在创建 Python 环境");
    expect(cancelBtn.textContent).toBe("取消");
    expect(cancelBtn.disabled).toBe(false);

    statusOp.endUvOp("venv");
    expect(chip.classList.contains("hidden")).toBe(true);
  });

  it("会话互斥：已有操作在跑时 begin 返回 false（不并发起第二个 uv 进程）", () => {
    expect(statusOp.beginUvOp("install")).toBe(true);
    expect(statusOp.isUvOpActive()).toBe(true);
    expect(statusOp.beginUvOp("venv")).toBe(false);
    // 标签仍是先起的那个操作
    expect(label.textContent).toContain("正在安装依赖");
    statusOp.endUvOp("install");
    expect(statusOp.isUvOpActive()).toBe(false);
  });

  it("endUvOp 只清理同 kind 的操作（防 A 收尾误清 B）", () => {
    statusOp.beginUvOp("fix");
    statusOp.endUvOp("venv"); // 不匹配 → no-op
    expect(statusOp.isUvOpActive()).toBe(true);
    statusOp.endUvOp("fix");
    expect(statusOp.isUvOpActive()).toBe(false);
  });
});

describe("L-1：芯片里的可判读进度", () => {
  it("有在途操作时喂流式行 → 显示解析出的进度；无操作时喂不点亮芯片", () => {
    expect(detail.textContent).toBe("");
    statusOp.pushUvProgressLine("45.2 MiB / 100.5 MiB");
    expect(detail.textContent).toBe(""); // 无在途操作 → 静默

    statusOp.beginUvOp("venv");
    statusOp.pushUvProgressLine("45.2 MiB / 100.5 MiB");
    expect(detail.textContent).toContain("45.2 MiB / 100.5 MiB");
    expect(detail.textContent).toContain("45%");
    statusOp.endUvOp("venv");
  });

  it("解析不出行 → 给最近一行（不做假百分比）", () => {
    statusOp.beginUvOp("install");
    statusOp.pushUvProgressLine("Using Python 3.12.7 environment at: F:\\ws\\.venv");
    expect(detail.textContent).toContain("Using Python 3.12.7");
    expect(detail.textContent).not.toContain("%");
    statusOp.endUvOp("install");
  });

  it("空行保持上一次显示（不被清成空白）", () => {
    statusOp.beginUvOp("fix");
    statusOp.pushUvProgressLine("Installed 5/9 packages");
    statusOp.pushUvProgressLine("");
    expect(detail.textContent).toContain("Installed 5/9 packages");
    statusOp.endUvOp("fix");
  });
});

describe("L-3：取消入口", () => {
  it("点「取消」→ 调 uv_cancel_op 置位后端标志；按钮切「取消中…」并禁用（防连点）", () => {
    statusOp.beginUvOp("install");
    cancelBtn.click();
    expect(invoke).toHaveBeenCalledWith("uv_cancel_op", { op: "install" });
    expect(cancelBtn.textContent).toBe("取消中…");
    expect(cancelBtn.disabled).toBe(true);

    cancelBtn.click(); // 连点不再发请求
    expect(vi.mocked(invoke).mock.calls.length).toBe(1);
    statusOp.endUvOp("install");
  });

  it("无在途操作时点击是 no-op（后端也会静默成功）", () => {
    cancelBtn.click();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("isCanceled 认后端哨兵「已取消」；notifyCanceled 走 info 级（不是失败）", () => {
    expect(statusOp.isCanceled(new Error("已取消"))).toBe(true);
    expect(statusOp.isCanceled("已取消")).toBe(true);
    expect(statusOp.isCanceled(new Error("命令失败（exit 1）"))).toBe(false);

    statusOp.notifyCanceled();
    expect(toast).toHaveBeenCalledWith("已取消", "info");
  });
});
