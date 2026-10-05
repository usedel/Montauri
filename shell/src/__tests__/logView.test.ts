// @vitest-environment happy-dom
// B5（toolbox_dev_plan.md §6.7 / PR-B5-2 + PR-B5-3）：结构化运行日志**视图**的单测。
// 覆盖：DOM 骨架与空态、行四列渲染、级别 chips（含 Shift 只留该项）、搜索（关键字/正则/大小写 + 高亮）、
// 行内 JSON 展开、清空回空态、隐藏时只入数组（显示时重建）、状态条（已丢弃 / 已结束）；
// PR-B5-3 追加：字段列切换、自动滚动开关与「↓ N 条新日志」、导出（复制 / 插入编辑器）、设置项应用。
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn((_cmd: string, _payload?: unknown) => Promise.resolve(null));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, payload?: unknown) => invokeMock(cmd, payload),
}));

import {
  applyLogSettings, beginLogSession, endLogSession, flushLogView, ingestLogText, initLogView,
  logViewRoot, logViewSnapshot, resetLogView, setLogPanelVisible, setLogViewHandlers, toggleLogField,
} from "../logView";
import { resetRunHistory, startRunRecord } from "../runHistory";
import { app } from "../state";

const ID = "run-term-script";

function rows(): HTMLElement[] {
  const root = logViewRoot();
  return root ? [...root.querySelectorAll<HTMLElement>(".log-row")] : [];
}
function rowText(i: number): string[] {
  const r = rows()[i];
  return [".log-ts", ".log-level", ".log-logger", ".log-msg"].map((sel) => r.querySelector(sel)?.textContent ?? "");
}
function chip(level: string): HTMLElement {
  return logViewRoot()!.querySelector<HTMLElement>(`.log-chip[data-level="${level}"]`)!;
}
function statusText(): string {
  return logViewRoot()!.querySelector(".logs-status")?.textContent ?? "";
}
async function typeSearch(text: string): Promise<void> {
  const input = logViewRoot()!.querySelector<HTMLInputElement>(".logs-search")!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  await new Promise((r) => setTimeout(r, 260)); // 防抖 200ms
}

beforeAll(() => {
  resetRunHistory();
  const host = document.createElement("div");
  host.id = "logs-panel";
  document.body.appendChild(host);
  // applyLogSettings 会按开关隐藏这个 tab；测试里保证它存在
  const tab = document.createElement("button");
  tab.id = "tab-logs";
  document.body.appendChild(tab);
  // 「字段 ▾」走 showMenu（渲染到 #ctx-menu），且 menu.ts 会给 document 挂关闭监听——
  // 缺这个容器会让**后续任何点击**都抛「缺少元素 #ctx-menu」
  const menu = document.createElement("div");
  menu.id = "ctx-menu";
  document.body.appendChild(menu);
  initLogView();
});

beforeEach(() => {
  resetLogView();
  setLogPanelVisible(true);
  resetRunHistory();
  invokeMock.mockClear();
  // 字段列是**用户偏好**，`resetLogView` 有意不重置（切工作区保留列选择）——
  // 测试里显式复位到默认四列，避免用例间互相影响
  const cur = logViewSnapshot().fields;
  for (const f of ["time", "level", "logger", "message"]) if (!cur.includes(f)) toggleLogField(f);
  if (logViewSnapshot().fields.includes("extra")) toggleLogField("extra");
});

describe("视图骨架与空态（§6.7.1 / §6.7.7）", () => {
  it("初始化后具备 chips / 搜索 / 清空 / 列表 / 状态条，并显示空态", () => {
    const root = logViewRoot()!;
    expect(root.querySelectorAll(".log-chip")).toHaveLength(4);
    expect(root.querySelector(".logs-search")).not.toBeNull();
    expect(root.querySelector(".logs-status")).not.toBeNull();
    expect(root.querySelector(".empty-state")).not.toBeNull(); // 无日志时是空态而非空白
    expect(rows()).toHaveLength(0);
  });

  it("空态文案区分「还没日志」与「过滤无命中」", () => {
    expect(logViewRoot()!.querySelector(".empty-title")?.textContent).toContain("运行脚本后");
    beginLogSession(ID);
    ingestLogText(ID, "INFO: alpha\n");
    flushLogView();
    expect(rows()).toHaveLength(1);
    chip("error").click();
    chip("info").click(); // 关掉 info → alpha 被过滤
    flushLogView();
    expect(rows()).toHaveLength(0);
    expect(logViewRoot()!.querySelector(".empty-title")?.textContent).toContain("没有匹配");
  });
});

describe("行渲染（§6.7.1）", () => {
  it("四列按解析结果渲染（时间戳 / 级别 / logger / 消息）", () => {
    beginLogSession(ID);
    ingestLogText(ID, "2026-10-05 12:03:41.512 | INFO     | app.main:1 - 启动完成\n");
    flushLogView();
    expect(rows()).toHaveLength(1);
    expect(rowText(0)).toEqual(["2026-10-05 12:03:41.512", "INFO", "app.main", "启动完成"]);
    expect(rows()[0].className).toContain("log-row--info");
  });

  it("只跟最近一次运行：别的实例输出不入视图（§6.9 决策 1）", () => {
    beginLogSession(ID);
    ingestLogText("run-term-project-1", "INFO: 别的实例\n");
    flushLogView();
    expect(rows()).toHaveLength(0);
    ingestLogText(ID, "ERROR: 本次\n");
    flushLogView();
    expect(rows()).toHaveLength(1);
  });

  it("新运行开始会清空重来（ended → live）", () => {
    beginLogSession(ID);
    ingestLogText(ID, "INFO: 第一次\n");
    flushLogView();
    expect(rows()).toHaveLength(1);
    startRunRecord(ID, { kind: "script", path: "/ws/a.py", label: "运行 · a.py", selection: null });
    beginLogSession(ID);
    flushLogView();
    expect(rows()).toHaveLength(0);
    expect(logViewSnapshot().phase).toBe("live");
  });
});

describe("级别 chips 与搜索（§6.7.4）", () => {
  function seed(): void {
    beginLogSession(ID);
    ingestLogText(ID, ["INFO: alpha", "ERROR: beta", "INFO: gamma", "plain delta"].join("\n") + "\n");
    flushLogView();
  }

  it("chips 计数随数据累加；关闭某级别即过滤（未分级行永远显示）", () => {
    seed();
    expect(chip("info").querySelector(".log-chip-count")?.textContent).toBe("2");
    expect(chip("error").querySelector(".log-chip-count")?.textContent).toBe("1");
    chip("info").click();
    flushLogView();
    const texts = rows().map((r) => r.querySelector(".log-msg")?.textContent);
    expect(texts).toEqual(["beta", "plain delta"]); // info 被滤掉，未分级行保留
  });

  it("Shift+点击 = 只留该项（对齐终端惯例）", () => {
    seed();
    chip("error").dispatchEvent(new MouseEvent("click", { shiftKey: true, bubbles: true }));
    flushLogView();
    const texts = rows().map((r) => r.querySelector(".log-msg")?.textContent);
    expect(texts).toEqual(["beta", "plain delta"]); // 只留 error（+ 未分级行）
  });

  it("搜索关键字：过滤 + 命中高亮；切回空搜索立即恢复", async () => {
    seed();
    await typeSearch("alpha");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector("mark.log-hit")?.textContent).toBe("alpha");
    await typeSearch("");
    expect(rows()).toHaveLength(4);
  });

  it("正则模式与大小写切换（非法正则时状态条报错且不过滤）", async () => {
    seed();
    await typeSearch("^ERROR");
    expect(rows()).toHaveLength(0); // 非正则模式按字面量搜 "^ERROR" → 无命中（显示 noMatch 空态）
    const regexBtn = [...logViewRoot()!.querySelectorAll<HTMLElement>(".out-chip")].find((b) => b.textContent === ".*")!;
    regexBtn.click();
    await typeSearch("^ERROR");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector(".log-msg")?.textContent).toBe("beta");
    // 非法正则：降级为不过滤（不让整列变空白）+ 状态条提示
    await typeSearch("([");
    expect(rows()).toHaveLength(4);
    expect(statusText()).toContain("正则表达式无效");
    regexBtn.click();
    await typeSearch("");
  });
});

describe("JSON 展开 / 清空 / 隐藏重建（§6.7.6 / §6.7.3）", () => {
  it("行内 JSON：点 ▸ 展开树，再点收起", () => {
    beginLogSession(ID);
    ingestLogText(ID, '12:03:41.880 ERROR app.worker {"msg":"连接失败","retry":3}\n');
    flushLogView();
    const row = rows()[0];
    const toggle = row.querySelector<HTMLElement>(".log-json-toggle")!;
    expect(toggle.textContent).toBe("▸");
    toggle.click();
    const box = logViewRoot()!.querySelector<HTMLElement>(".log-json")!;
    expect(box).not.toBeNull();
    expect(box.classList.contains("hidden")).toBe(false);
    expect(box.querySelector(".json-tree")).not.toBeNull();
    expect(box.textContent).toContain("msg");
    expect(toggle.textContent).toBe("▾");
    toggle.click();
    expect(box.classList.contains("hidden")).toBe(true);
  });

  it("清空按钮：回到空态但保持 live 相位", () => {
    beginLogSession(ID);
    ingestLogText(ID, "INFO: a\n");
    flushLogView();
    const clearBtn = [...logViewRoot()!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.includes("清空"))!;
    clearBtn.click();
    expect(rows()).toHaveLength(0);
    expect(logViewRoot()!.querySelector(".empty-state")).not.toBeNull();
    expect(logViewSnapshot().phase).toBe("live");
  });

  it("面板隐藏时只入数组不渲染；恢复前台时整表重建", () => {
    beginLogSession(ID);
    setLogPanelVisible(false);
    ingestLogText(ID, "INFO: 隐藏期间\n");
    flushLogView(); // 强制渲染也应因隐藏而跳过（脏标记）
    expect(rows()).toHaveLength(0);
    expect(logViewSnapshot().total).toBe(1); // 数据已入数组
    setLogPanelVisible(true);
    flushLogView();
    expect(rows()).toHaveLength(1);
  });
});

describe("状态条（§6.7.1）", () => {
  it("显示总行 / 可见行 / 已丢弃 / 已结束（退出码）", () => {
    beginLogSession(ID);
    ingestLogText(ID, Array.from({ length: 12 }, () => "INFO: x").join("\n") + "\n");
    flushLogView();
    // 上限 5000，未超限
    expect(statusText()).toContain("共 12 行");
    expect(statusText()).toContain("运行中");
    endLogSession(ID, 0);
    flushLogView();
    expect(statusText()).toContain("已结束（退出码 0）");
  });

  it("超出上限时状态条显示已丢弃数（保尾弃头）", () => {
    beginLogSession(ID);
    // 上限由 logStore 常量 5000 控制；这里用 5001 行触发一次裁剪
    const chunk = Array.from({ length: 5001 }, (_, i) => `INFO: l${i}`).join("\n") + "\n";
    ingestLogText(ID, chunk);
    flushLogView();
    expect(logViewSnapshot().dropped).toBe(1);
    expect(statusText()).toContain("已丢弃 1");
    expect(logViewSnapshot().total).toBe(5000);
  });
});

describe("字段列 / 自动滚动 / 导出 / 设置（PR-B5-3）", () => {
  function seedSample(): void {
    beginLogSession(ID);
    ingestLogText(ID, "2026-10-05 12:03:41.512 | INFO | app.main:1 - 启动完成\n");
    flushLogView();
  }

  it("字段列可切换：关掉「时间」后该列不占位（列数类同步）", () => {
    seedSample();
    expect(logViewRoot()!.querySelectorAll(".logs-list .log-ts")).toHaveLength(1);
    expect(rows()[0].className).toContain("log-row--c4");
    toggleLogField("time");
    expect(logViewSnapshot().fields).toEqual(["level", "logger", "message"]);
    expect(logViewRoot()!.querySelectorAll(".logs-list .log-ts")).toHaveLength(0);
    expect(rows()[0].className).toContain("log-row--c3");
    // 至少留一列：只剩一列时再关不掉
    toggleLogField("logger");
    toggleLogField("message");
    toggleLogField("level");
    expect(logViewSnapshot().fields).toHaveLength(1);
    toggleLogField("level");
    expect(logViewSnapshot().fields).toHaveLength(1);
    // 恢复时间列（按 LOG_FIELDS 顺序重排）
    toggleLogField("time");
    expect(logViewSnapshot().fields).toEqual(["time", "level"]);
  });

  it("自动滚动：关闭后新日志只计数并提示「↓ N 条新日志」，点击跳回底部并恢复", () => {
    seedSample();
    const box = logViewRoot()!.querySelector<HTMLInputElement>(".logs-autoscroll input")!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(logViewSnapshot().autoScroll).toBe(false);
    ingestLogText(ID, "INFO: 新的一行\n");
    flushLogView();
    expect(logViewSnapshot().pendingNew).toBe(1);
    const newBtn = logViewRoot()!.querySelector<HTMLButtonElement>(".logs-new-btn")!;
    expect(newBtn.classList.contains("hidden")).toBe(false);
    expect(newBtn.textContent).toContain("1");
    newBtn.click();
    expect(logViewSnapshot().pendingNew).toBe(0);
    expect(logViewSnapshot().autoScroll).toBe(true);
    expect(box.checked).toBe(true);
    expect(newBtn.classList.contains("hidden")).toBe(true);
  });

  it("导出：复制全部写剪贴板（内容按选中字段格式化）", async () => {
    seedSample();
    const copyBtn = [...logViewRoot()!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.includes("复制全部"))!;
    copyBtn.click();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("copy_to_clipboard", expect.objectContaining({ text: expect.stringContaining("启动完成") }));
  });

  it("导出：插入编辑器走注入通道；未注入时给失败反馈", () => {
    seedSample();
    const insertBtn = [...logViewRoot()!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent?.includes("插入编辑器"))!;
    const spy = vi.fn(() => true);
    setLogViewHandlers({ insertToEditor: spy });
    insertBtn.click();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("启动完成"));
    const label = insertBtn.querySelector("span")!;
    expect(label.textContent).toContain("已插入");
  });

  it("设置项：log_max_lines 生效（超限保尾弃头）", () => {
    const prev = app.settings.log_max_lines;
    app.settings.log_max_lines = 100;
    applyLogSettings();
    expect(logViewSnapshot().maxLines).toBe(100);
    beginLogSession(ID);
    ingestLogText(ID, Array.from({ length: 120 }, (_, i) => `INFO: l${i}`).join("\n") + "\n");
    flushLogView();
    expect(logViewSnapshot().total).toBe(100);
    expect(logViewSnapshot().dropped).toBe(20);
    // 非法值回落默认
    app.settings.log_max_lines = 0;
    applyLogSettings();
    expect(logViewSnapshot().maxLines).toBe(5000);
    app.settings.log_max_lines = prev;
    applyLogSettings();
  });

  it("设置项：关闭 log_structured_enabled 时隐藏底部 tab（applyLogSettings 返回 false）", () => {
    const prev = app.settings.log_structured_enabled;
    app.settings.log_structured_enabled = false;
    expect(applyLogSettings()).toBe(false);
    expect(document.getElementById("tab-logs")!.hidden).toBe(true);
    app.settings.log_structured_enabled = true;
    expect(applyLogSettings()).toBe(true);
    expect(document.getElementById("tab-logs")!.hidden).toBe(false);
    app.settings.log_structured_enabled = prev;
  });
});

describe("首次使用提示（会话级，可关闭）", () => {
  it("提示带「运行历史」入口键位（占位符已替换），点「知道了」后隐藏", () => {
    const hint = logViewRoot()!.querySelector<HTMLElement>(".logs-hint")!;
    expect(hint.classList.contains("hidden")).toBe(false);
    expect(hint.textContent).toContain("运行历史");
    expect(hint.textContent).not.toContain("{key}"); // t() 的键位参数必须已注入
    const btn = [...hint.querySelectorAll("button")].find((b) => b.textContent?.includes("知道了"))!;
    btn.click();
    // 回归：曾用 `hidden` 属性，被 `display: flex` 盖掉导致「点了没反应」
    expect(hint.classList.contains("hidden")).toBe(true);
  });
});

describe("超长行折叠（§6.6 边界）", () => {
  it("单元格超过 5 KB 时只渲染前 5 KB + 省略号，并打截断标记", () => {
    beginLogSession(ID);
    ingestLogText(ID, "INFO: " + "x".repeat(6000) + "\n");
    flushLogView();
    const msg = rows()[0].querySelector(".log-msg")!;
    expect(msg.textContent!.length).toBeLessThan(5200);
    expect(msg.textContent!.endsWith(" …")).toBe(true);
    expect(msg.classList.contains("log-cell--truncated")).toBe(true);
    // 未超限的单元格不打标记
    ingestLogText(ID, "INFO: 短行\n");
    flushLogView();
    expect(rows()[1].querySelector(".log-msg")!.classList.contains("log-cell--truncated")).toBe(false);
  });
});
