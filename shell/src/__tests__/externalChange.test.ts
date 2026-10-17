import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";

// —— 隔离外部副作用：对话框 / IPC / 保存选择器 / toast 全部替身 ——
// 模块自身（externalChange）用真实实现，被测的是它的判定与状态机。
const openChoice = vi.fn();
const invoke = vi.fn();
const saveDialog = vi.fn();
const toast = vi.fn();
const refreshTabs = vi.fn();
const overwriteDisk = vi.fn();

vi.mock("../dialog", () => ({ openChoice: (...a: unknown[]) => openChoice(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => saveDialog(...a) }));
vi.mock("../toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

import {
  applyExternalText,
  classifyExternalChange,
  externalSaveGate,
  handleFileChanged,
  isTrackableTab,
  resetExternalChangeState,
  saveAsDefaultName,
  setExternalChangeActions,
  shouldHandleNow,
} from "../externalChange";
import { app, type Tab } from "../state";

// ---------- 测试替身 ----------

function fakeModel(text: string): MonacoApi.editor.ITextModel {
  let value = text;
  return {
    getValue: () => value,
    setValue: (v: string) => {
      value = v;
    },
  } as unknown as MonacoApi.editor.ITextModel;
}

function tab(path: string, opts?: { dirty?: boolean; kind?: Tab["kind"]; text?: string }): Tab {
  return {
    path,
    model: fakeModel(opts?.text ?? "print('v1')\n"),
    dirty: opts?.dirty ?? false,
    kind: opts?.kind,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  app.tabs = [];
  app.activeTab = null;
  setExternalChangeActions({ overwriteDisk, refreshTabs });
  resetExternalChangeState();
});

// ---------- 纯函数 ----------

describe("classifyExternalChange（plan §4.3 判定矩阵）", () => {
  it("内容相同 → identical（自身保存回声 / Undo 回原状）", () => {
    expect(classifyExternalChange({ modelText: "a", diskText: "a", dirty: true })).toBe("identical");
    expect(classifyExternalChange({ modelText: "a", diskText: "a", dirty: false })).toBe("identical");
  });

  it("读盘失败 → unreadable（不细分删除 / 10MB 守卫 / IO 错误）", () => {
    expect(classifyExternalChange({ modelText: "a", diskText: null, dirty: false })).toBe("unreadable");
    expect(classifyExternalChange({ modelText: "a", diskText: null, dirty: true })).toBe("unreadable");
  });

  it("缓冲干净 + 磁盘不同 → reload（磁盘是唯一真源）", () => {
    expect(classifyExternalChange({ modelText: "a", diskText: "b", dirty: false })).toBe("reload");
  });

  it("缓冲有未存修改 + 磁盘不同 → conflict（交用户裁决）", () => {
    expect(classifyExternalChange({ modelText: "a", diskText: "b", dirty: true })).toBe("conflict");
  });
});

describe("isTrackableTab（plan §4.8：占位模型一律不参与）", () => {
  it("普通文件 tab（kind 未定义 / \"file\"）参与", () => {
    expect(isTrackableTab(tab("a.py"))).toBe(true);
    expect(isTrackableTab(tab("a.py", { kind: "file" }))).toBe(true);
  });

  it("md 预览 / CSV 查看 / diff / db 一律跳过（比对无意义）", () => {
    expect(isTrackableTab(tab("mdpreview:a.md", { kind: "md" }))).toBe(false);
    expect(isTrackableTab(tab("csvtab:a.csv", { kind: "csv" }))).toBe(false);
    expect(isTrackableTab(tab("diff:a.py", { kind: "diff" }))).toBe(false);
    expect(isTrackableTab(tab("db-data:hash", { kind: "db" }))).toBe(false);
  });
});

describe("shouldHandleNow（800ms 单飞）", () => {
  it("首次必处理", () => {
    expect(shouldHandleNow(null, 1000)).toBe(true);
  });
  it("窗口内跳过、窗口外放行", () => {
    expect(shouldHandleNow(1000, 1200)).toBe(false);
    expect(shouldHandleNow(1000, 1799)).toBe(false);
    expect(shouldHandleNow(1000, 1800)).toBe(true);
    expect(shouldHandleNow(1000, 5000)).toBe(true);
  });
});

describe("applyExternalText（plan §4.7 dirty 复位的内容守卫）", () => {
  it("写入后内容与期望一致 → applied", () => {
    const m = fakeModel("old");
    expect(applyExternalText(m, "disk")).toBe("applied");
    expect(m.getValue()).toBe("disk");
  });

  it("写入后内容偏离期望（并发改写）→ changed，调用方必须保留脏标记", () => {
    const m = fakeModel("old");
    const proxy = {
      getValue: () => "user-typed-meanwhile",
      setValue: () => undefined,
    } as unknown as MonacoApi.editor.ITextModel;
    expect(applyExternalText(proxy, "disk")).toBe("changed");
    // 对照：正常路径
    expect(applyExternalText(m, "disk")).toBe("applied");
  });
});

describe("saveAsDefaultName（另存为默认名，防同路径覆盖）", () => {
  it("加「我的版本」且保留扩展名", () => {
    expect(saveAsDefaultName("C:\\ws\\main.py")).toBe("main (我的版本).py");
    expect(saveAsDefaultName("/ws/pkg/util.py")).toBe("util (我的版本).py");
  });
  it("无扩展名也加后缀", () => {
    expect(saveAsDefaultName("/ws/Makefile")).toBe("Makefile (我的版本)");
  });
});

// ---------- 事件处理 ----------

describe("handleFileChanged（plan §4.1 数据流）", () => {
  it("identical（自身保存回声）→ 不弹面板、不改内容，但顺带清掉常驻脏点", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "same\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("same\n");
    await handleFileChanged("C:\\ws\\main.py");
    expect(openChoice).not.toHaveBeenCalled();
    expect(t.model.getValue()).toBe("same\n");
    expect(t.dirty).toBe(false); // §4.7 后果 2：Undo/回声后圆点不该常驻
    expect(refreshTabs).toHaveBeenCalled();
  });

  it("reload（未脏 tab）→ 自动重载 + dirty 复位", async () => {
    const t = tab("C:\\ws\\main.py", { text: "v1\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("v2 from outside\n");
    await handleFileChanged("C:\\ws\\main.py");
    expect(openChoice).not.toHaveBeenCalled();
    expect(t.model.getValue()).toBe("v2 from outside\n");
    expect(t.dirty).toBe(false);
  });

  it("conflict（脏 tab）→ 弹三选一面板；选「用磁盘版本重载」→ 重载并清装饰", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("outside\n");
    openChoice.mockResolvedValue("neutral");
    await handleFileChanged("C:\\ws\\main.py");
    expect(openChoice).toHaveBeenCalledTimes(1);
    expect(openChoice.mock.calls[0][0]).toMatchObject({ okLabel: expect.any(String) });
    expect(t.model.getValue()).toBe("outside\n");
    expect(t.dirty).toBe(false);
  });

  it("conflict 选「稍后处理」(cancel) → 缓冲原样保留，pending 保留（保存时再决策）", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("outside\n");
    openChoice.mockResolvedValue("cancel");
    await handleFileChanged("C:\\ws\\main.py");
    expect(t.model.getValue()).toBe("mine\n");
    expect(t.dirty).toBe(true);
    // pending 生效：再次保存被拦截并弹面板
    openChoice.mockResolvedValue("cancel");
    expect(await externalSaveGate(t)).toBe(true);
    expect(openChoice).toHaveBeenCalledTimes(2);
  });

  it("conflict 选「另存为…」(ok) → 写到我选的新路径，原 tab 被动", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("outside\n");
    openChoice.mockResolvedValue("ok");
    saveDialog.mockResolvedValue("C:\\ws\\main (我的版本).py");
    await handleFileChanged("C:\\ws\\main.py");
    expect(invoke).toHaveBeenCalledWith("write_file", {
      path: "C:\\ws\\main (我的版本).py",
      content: "mine\n",
    });
    expect(t.model.getValue()).toBe("mine\n");
    expect(openChoice).not.toHaveBeenCalledTimes(0);
  });

  it("另存为目标 = 源路径 → 拒绝写入并提示（防误覆盖正在救回的文件）", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("outside\n");
    openChoice.mockResolvedValue("ok");
    saveDialog.mockResolvedValue("C:\\ws\\main.py");
    await handleFileChanged("C:\\ws\\main.py");
    expect(invoke).not.toHaveBeenCalledWith("write_file", expect.objectContaining({ path: "C:\\ws\\main.py" }));
    expect(toast).toHaveBeenCalled();
  });

  it("unreadable（读盘失败）→ 只 toast 提示，不关 tab、不改内容、不弹决策面板", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockRejectedValue("系统找不到指定的路径。");
    await handleFileChanged("C:\\ws\\main.py");
    expect(openChoice).not.toHaveBeenCalled();
    expect(app.tabs).toHaveLength(1); // tab 没被关掉
    expect(t.model.getValue()).toBe("mine\n");
    expect(toast).toHaveBeenCalled();
  });

  it("虚拟 tab（md/csv/diff/db）→ 直接跳过，连 read_file 都不调用", async () => {
    const t = tab("mdpreview:C:\\ws\\docs\\a.md", { kind: "md", text: "# old" });
    app.tabs = [t];
    await handleFileChanged("C:\\ws\\docs\\a.md");
    expect(invoke).not.toHaveBeenCalled();
    expect(openChoice).not.toHaveBeenCalled();
  });

  it("不在任何 tab 里的文件 → 不读盘（大仓性能闸门）", async () => {
    app.tabs = [tab("C:\\ws\\other.py")];
    await handleFileChanged("C:\\ws\\zzz.py");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("800ms 单飞：同路径连发两次只处理一次", async () => {
    const t = tab("C:\\ws\\main.py", { text: "v1\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("v2\n");
    await handleFileChanged("C:\\ws\\main.py");
    invoke.mockResolvedValue("v3\n");
    await handleFileChanged("C:\\ws\\main.py");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(t.model.getValue()).toBe("v2\n");
  });
});

describe("externalSaveGate（plan §4.6 保存拦截）", () => {
  it("无 pending → 放行（正常保存）", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true });
    app.tabs = [t];
    expect(await externalSaveGate(t)).toBe(false);
    expect(openChoice).not.toHaveBeenCalled();
  });

  it("pending + 选「用我的版本覆盖磁盘」→ 覆盖后拦截本次 saveTab（写盘已由我们完成）", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("outside\n");
    openChoice.mockResolvedValue("cancel"); // 先让冲突落成 pending
    await handleFileChanged("C:\\ws\\main.py");

    openChoice.mockResolvedValue("ok");
    overwriteDisk.mockImplementation(async () => {
      t.dirty = false;
    });
    expect(await externalSaveGate(t)).toBe(true);
    expect(overwriteDisk).toHaveBeenCalledTimes(1);
    expect(t.dirty).toBe(false);
  });

  it("覆盖写盘期间 saveTab 递归进来 → 放行（不再弹面板）", async () => {
    const t = tab("C:\\ws\\main.py", { dirty: true, text: "mine\n" });
    app.tabs = [t];
    invoke.mockResolvedValue("outside\n");
    openChoice.mockResolvedValue("cancel"); // 先让冲突落成 pending
    await handleFileChanged("C:\\ws\\main.py");

    openChoice.mockResolvedValue("ok");
    // 模拟 main 的 saveTab：被 overwriteDisk 调用时（savingByUs=true）不应再次被 gate 拦截
    let nestedGate: boolean | null = null;
    overwriteDisk.mockImplementation(async () => {
      nestedGate = await externalSaveGate(t);
      t.dirty = false;
    });
    await externalSaveGate(t);
    expect(nestedGate).toBe(false);
    expect(overwriteDisk).toHaveBeenCalledTimes(1);
    // 覆盖完成后 pending 清掉：后续保存不再弹面板
    expect(await externalSaveGate(t)).toBe(false);
  });
});
