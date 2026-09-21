// 设置页「插件」tab 渲染域（PR-2，plugin_system_design §9.14 + P0 DX）：
// 目录行（真实路径/复制/打开/重扫/新建插件/作者指南）+ 插件列表（行展开：元数据/权限/工具/操作/日志）。
// 独立模块避免 settingsPanel.ts 膨胀；进入分类时由 switchCategory 触发 renderPluginsTab。
//
// P0 DX（「10 秒正反馈」闭环）：
// - 目录提示 = Rust get_plugins_dir 的真实绝对路径（修掉写死 "~" 的错误提示）；
// - 「新建插件…」：对话框收 id/名称 → scaffold_plugin 落盘模板 → 热重载自动加载；
// - 「作者指南」：?raw 打包的指南 markdown 落盘临时文件 → openFile（.md 自动开预览）。

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { codicon } from "../util";
import { toast } from "../toast";
import { openAlert } from "../dialog";
import { disablePlugin, enablePlugin, listPluginRecords, reloadPlugin, scanPlugins, type PluginRecord } from "./loader";
// 指南源（仓库 docs/，经 ?raw 打包进产物）：src/extensions/ → 仓库根是三级上溯
import guideRaw from "../../../docs/devtools_plugin_guide.md?raw";

/** 指南落盘路径（数据根 docs 子目录；main.ts 注入 openFile 打开） */
let openGuideFile: ((path: string) => Promise<unknown>) | null = null;

/** 注入「打开文件」能力（main.ts；避免反向依赖） */
export function setPluginsTabHandlers(h: { openFile: (path: string) => Promise<unknown> }): void {
  openGuideFile = h.openFile;
}

/** 写文件到数据根 docs/（复用 fs write_file；路径 = <data_root>/docs/<name>） */
async function writeDataDoc(name: string, content: string): Promise<string> {
  const path = await invoke<string>("get_data_doc_path", { name });
  await invoke("write_file", { path, content });
  return path;
}

/** 渲染整个插件 tab（进入分类 / 操作后刷新共用） */
export async function renderPluginsTab(): Promise<void> {
  const root = document.getElementById("plugins-panel");
  if (!root) return;
  root.textContent = "";

  // ---- 目录操作行（真实路径 + 复制 + 打开 + 重扫） ----
  let dirPath = "";
  try {
    dirPath = await invoke<string>("get_plugins_dir");
  } catch {
    dirPath = "(未知)";
  }
  const dirRow = document.createElement("div");
  dirRow.className = "plugins-dir-row";
  const dirLabel = document.createElement("span");
  dirLabel.className = "plugins-dir-label";
  dirLabel.textContent = `目录：${dirPath}`;
  dirLabel.title = dirPath;
  const copyDirBtn = document.createElement("button");
  copyDirBtn.className = "btn btn--sm";
  copyDirBtn.appendChild(codicon("copy"));
  copyDirBtn.append("复制路径");
  copyDirBtn.addEventListener("click", () => {
    void invoke("copy_to_clipboard", { text: dirPath }).then(() => toast("路径已复制", "success"));
  });
  const openDirBtn = document.createElement("button");
  openDirBtn.className = "btn btn--sm";
  openDirBtn.appendChild(codicon("folder-opened"));
  openDirBtn.append("打开目录");
  openDirBtn.addEventListener("click", () => {
    void invoke("reveal_plugins_dir").catch((e) => toast(`打开目录失败：${e}`, "error"));
  });
  const rescanBtn = document.createElement("button");
  rescanBtn.className = "btn btn--sm";
  rescanBtn.appendChild(codicon("refresh"));
  rescanBtn.append("重新扫描");
  rescanBtn.addEventListener("click", () => {
    void scanPlugins().then(() => {
      renderPluginsTab();
      toast("插件扫描完成", "success");
    });
  });
  dirRow.append(dirLabel, copyDirBtn, openDirBtn, rescanBtn);
  root.appendChild(dirRow);

  // ---- DX 行：新建 / 导入 / 作者指南 ----
  const dxRow = document.createElement("div");
  dxRow.className = "plugins-dx-row";
  const newBtn = document.createElement("button");
  newBtn.className = "btn btn--primary btn--sm";
  newBtn.appendChild(codicon("add"));
  newBtn.append("新建插件…");
  newBtn.addEventListener("click", () => void showScaffoldDialog());
  const importBtn = document.createElement("button");
  importBtn.className = "btn btn--sm";
  importBtn.appendChild(codicon("cloud-download"));
  importBtn.append("导入插件…");
  importBtn.addEventListener("click", () => void importPluginFromZip());
  const guideBtn = document.createElement("button");
  guideBtn.className = "btn btn--sm";
  guideBtn.appendChild(codicon("book"));
  guideBtn.append("作者指南");
  guideBtn.addEventListener("click", () => void openGuide());
  dxRow.append(newBtn, importBtn, guideBtn);
  root.appendChild(dxRow);

  // ---- 插件列表 ----
  const records = listPluginRecords();
  const list = document.createElement("div");
  list.className = "plugins-list";
  if (records.length === 0) {
    const empty = document.createElement("div");
    empty.className = "plugins-empty";
    empty.textContent = "暂无插件。点击「新建插件…」用模板起步，或将含 opencharm.plugin.json 的插件目录放入上述目录后「重新扫描」。";
    list.appendChild(empty);
  } else {
    for (const rec of records) list.appendChild(renderPluginRow(rec));
  }
  root.appendChild(list);
}

/** 打开作者指南（落盘数据根 docs → openFile → .md 自动开预览）；MB-13：帮助菜单「作者指南」同入口复用 */
export async function openGuide(): Promise<void> {
  if (!openGuideFile) return;
  try {
    const path = await writeDataDoc("devtools_plugin_guide.md", guideRaw);
    await openGuideFile(path);
  } catch (e) {
    toast(`打开指南失败：${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

/** 导入插件 zip（P2 分发）：选文件 → Rust 解包校验落盘 → 重扫 */
async function importPluginFromZip(): Promise<void> {
  const picked = await openDialog({
    title: "导入插件（zip）",
    multiple: false,
    directory: false,
    filters: [{ name: "插件包", extensions: ["zip"] }],
  });
  if (typeof picked !== "string" || !picked) return; // 取消
  try {
    await invoke<string>("import_plugin", { zipPath: picked });
    await scanPlugins();
    renderPluginsTab();
    toast("插件导入成功", "success");
  } catch (e) {
    void openAlert({ title: "导入插件", message: `导入失败：${e instanceof Error ? e.message : String(e)}` });
  }
}

/** 导出插件为 zip（P2 分发）：行内「导出」按钮调用 */
async function exportPluginZip(rec: PluginRecord): Promise<void> {
  if (rec.source !== "global") {
    toast("内置插件无需导出（随应用分发）", "info");
    return;
  }
  try {
    const defaultName = await invoke<string>("plugin_export_filename", { pluginDir: rec.dir });
    const target = await saveDialog({
      title: "导出插件",
      defaultPath: defaultName,
      filters: [{ name: "插件包", extensions: ["zip"] }],
    });
    if (typeof target !== "string" || !target) return; // 取消
    await invoke<string>("export_plugin", { pluginDir: rec.dir, savePath: target });
    toast(`已导出到 ${target}`, "success");
  } catch (e) {
    void openAlert({ title: "导出插件", message: `导出失败：${e instanceof Error ? e.message : String(e)}` });
  }
}

/** 新建插件对话框（P1：单表单——id + 名称 + 模板单选一次填完） → scaffold_plugin → 加载 */
async function showScaffoldDialog(): Promise<void> {
  const form = await promptScaffoldForm();
  if (form === null) return;
  try {
    await invoke<string>("scaffold_plugin", { id: form.id, name: form.name, template: form.template });
    await scanPlugins(); // 目录监听可能因创建时序错过首事件，主动扫一次保证「点了就有」
    renderPluginsTab();
    const next =
      form.template === "inline"
        ? "命令面板搜「问候选区」试试；面板里也有调试台"
        : "菜单「工具 → 文本」试试你的插件，改 hello.js 保存即热重载";
    toast(`模板已创建——${next}`, "success");
  } catch (e) {
    void openAlert({ title: "插件脚手架", message: `创建失败：${e instanceof Error ? e.message : String(e)}` });
  }
}

/** 脚手架表单（id + 名称 + 模板 radioGroup；返回 null = 取消） */
function promptScaffoldForm(): Promise<{ id: string; name: string; template: "panel" | "inline" | "blank" } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    const card = document.createElement("div");
    card.className = "modal-card scaffold-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "新建插件");

    const title = document.createElement("div");
    title.className = "scaffold-title";
    title.textContent = "新建插件";

    const idLabel = document.createElement("label");
    idLabel.className = "scaffold-field-label";
    idLabel.htmlFor = "scaffold-id";
    idLabel.textContent = "插件 id";
    const idInput = document.createElement("input");
    idInput.id = "scaffold-id";
    idInput.type = "text";
    idInput.placeholder = "如 com.yourname.my-tools";
    idInput.autocomplete = "off";
    idInput.spellcheck = false;

    const nameLabel = document.createElement("label");
    nameLabel.className = "scaffold-field-label";
    nameLabel.htmlFor = "scaffold-name";
    nameLabel.textContent = "名称";
    const nameInput = document.createElement("input");
    nameInput.id = "scaffold-name";
    nameInput.type = "text";
    nameInput.placeholder = "显示在菜单与插件列表，如 我的工具集";
    nameInput.autocomplete = "off";
    nameInput.spellcheck = false;

    // 模板单选（kit.radioGroup 不依赖 host——纯 UI 积木，静态复用）
    const tplLabel = document.createElement("div");
    tplLabel.className = "scaffold-field-label";
    tplLabel.textContent = "模板";
    const tplGroup = createScaffoldTemplateGroup();

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn";
    cancelBtn.textContent = "取消";
    const okBtn = document.createElement("button");
    okBtn.className = "btn btn--primary";
    okBtn.textContent = "创建";
    actions.append(cancelBtn, okBtn);

    card.append(title, idLabel, idInput, nameLabel, nameInput, tplLabel, tplGroup.el, actions);
    overlay.appendChild(card);
    const done = (v: { id: string; name: string; template: "panel" | "inline" | "blank" } | null): void => {
      overlay.remove();
      resolve(v);
    };
    const submit = (): void => {
      const id = idInput.value.trim();
      const name = nameInput.value.trim();
      if (!id || !name) {
        toast("请填写插件 id 与名称", "info");
        return;
      }
      done({ id, name, template: tplGroup.get() });
    };
    okBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => done(null));
    for (const input of [idInput, nameInput]) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
        else if (e.key === "Escape") done(null);
      });
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(null);
    });
    document.body.appendChild(overlay);
    idInput.focus();
  });
}

/** 模板单选组（内联 WAI-ARIA radiogroup——与 kit.radioGroup 同范式，此处无 host 故本地实现） */
function createScaffoldTemplateGroup(): { el: HTMLElement; get(): "panel" | "inline" | "blank" } {
  const OPTIONS: Array<{ value: "panel" | "inline" | "blank"; label: string; desc: string }> = [
    { value: "panel", label: "面板工具", desc: "带输入/输出界面的完整工具" },
    { value: "inline", label: "选区变换", desc: "选中文本原地替换，无界面" },
    { value: "blank", label: "空白", desc: "只有 manifest，从头写" },
  ];
  const root = document.createElement("div");
  root.className = "tool-radiogroup scaffold-templates";
  root.setAttribute("role", "radiogroup");
  root.setAttribute("aria-label", "模板");
  let selected: "panel" | "inline" | "blank" = "panel";
  const radios = OPTIONS.map((o) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-radio scaffold-template";
    btn.dataset.value = o.value;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(o.value === selected));
    btn.tabIndex = o.value === selected ? 0 : -1;
    const dot = document.createElement("span");
    dot.className = "tool-radio-dot";
    btn.appendChild(dot);
    const text = document.createElement("span");
    text.className = "tool-radio-text";
    const name = document.createElement("div");
    name.textContent = o.label;
    const desc = document.createElement("div");
    desc.className = "scaffold-template-desc";
    desc.textContent = o.desc;
    text.append(name, desc);
    btn.appendChild(text);
    btn.addEventListener("click", () => select(o.value));
    root.appendChild(btn);
    return btn;
  });
  const select = (v: "panel" | "inline" | "blank"): void => {
    selected = v;
    for (const r of radios) {
      const sel = r.dataset.value === v;
      r.setAttribute("aria-checked", String(sel));
      r.tabIndex = sel ? 0 : -1;
    }
  };
  return { el: root, get: () => selected };
}

/** 单个插件行（点击展开详情 + 操作） */
function renderPluginRow(rec: PluginRecord): HTMLElement {
  const row = document.createElement("div");
  row.className = `plugin-row plugin-row--${rec.status}`;

  const head = document.createElement("div");
  head.className = "plugin-row-head";
  const caret = codicon("chevron-right");
  caret.classList.add("plugin-caret");
  const icon = codicon(rec.status === "error" ? "error" : rec.status === "disabled" ? "circle-slash" : "extensions");
  const name = document.createElement("span");
  name.className = "plugin-name";
  name.textContent = rec.name;
  const meta = document.createElement("span");
  meta.className = "plugin-meta";
  const toolCount = rec.toolIds.length > 0 ? ` · ${rec.toolIds.length} 工具` : "";
  const statusText = rec.status === "active" ? "已启用" : rec.status === "disabled" ? "已停用" : rec.status === "error" ? "加载失败" : "";
  meta.textContent = `${rec.source === "builtin" ? "内置" : "全局"}${toolCount} · ${statusText}`;
  head.append(caret, icon, name, meta);
  row.appendChild(head);

  // 展开区（懒渲染：首次展开才填内容）
  let detailEl: HTMLElement | null = null;
  head.addEventListener("click", () => {
    const open = row.classList.toggle("open");
    caret.classList.toggle("codicon-chevron-down", open);
    caret.classList.toggle("codicon-chevron-right", !open);
    if (open && !detailEl) {
      detailEl = renderPluginDetail(rec);
      row.appendChild(detailEl);
    } else if (detailEl) {
      detailEl.classList.toggle("hidden", !open);
    }
  });

  return row;
}

/** 展开详情：版本/引擎/权限/工具 + 操作按钮 + 日志 */
function renderPluginDetail(rec: PluginRecord): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "plugin-detail";

  const line = (label: string, value: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = "plugin-detail-line";
    const l = document.createElement("span");
    l.className = "plugin-detail-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.textContent = value;
    el.append(l, v);
    return el;
  };

  detail.append(line("版本", rec.version));
  if (rec.manifest?.engines) detail.append(line("引擎要求", rec.manifest.engines.opencharm));
  detail.append(line("权限", (rec.manifest?.permissions ?? []).join(", ") || "（默认：toast / log）"));

  const toolTitles = (rec.manifest?.contributes?.tools ?? []).map((t) => t.title).join("、");
  if (toolTitles) detail.append(line("工具", toolTitles));
  if (rec.error) {
    const err = document.createElement("div");
    err.className = "plugin-error-msg";
    err.textContent = rec.error;
    detail.appendChild(err);
  }

  // 操作行
  const actions = document.createElement("div");
  actions.className = "plugin-actions";
  const reloadBtn = document.createElement("button");
  reloadBtn.className = "btn btn--sm";
  reloadBtn.textContent = "重载";
  reloadBtn.addEventListener("click", () => void reloadPlugin(rec.id).then(() => renderPluginsTab()));
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "btn btn--sm";
  if (rec.status === "disabled") {
    toggleBtn.textContent = "启用";
    toggleBtn.addEventListener("click", () => void enablePlugin(rec.id).then(() => renderPluginsTab()));
  } else {
    toggleBtn.textContent = "停用";
    toggleBtn.classList.add("btn--danger-outline");
    toggleBtn.addEventListener("click", () => void disablePlugin(rec.id).then(() => renderPluginsTab()));
  }
  actions.append(reloadBtn, toggleBtn);
  // P2 分发：导出 zip（仅第三方插件；内置随应用分发无意义）
  if (rec.source === "global") {
    const exportBtn = document.createElement("button");
    exportBtn.className = "btn btn--sm";
    exportBtn.textContent = "导出";
    exportBtn.addEventListener("click", () => void exportPluginZip(rec));
    actions.append(exportBtn);
  }
  detail.appendChild(actions);

  // 日志面板常驻（host.log 是插件作者的主要调试通道——空态也展示位置，引导其存在感）
  const logBox = document.createElement("div");
  logBox.className = "plugin-logs";
  const logTitle = document.createElement("div");
  logTitle.className = "plugin-logs-title";
  logTitle.textContent = "日志（最近 50 条 · 插件经 host.log() 输出）";
  logBox.appendChild(logTitle);
  const lines = rec.logs.slice(-50);
  if (lines.length === 0) {
    const emptyLog = document.createElement("div");
    emptyLog.className = "plugin-log-line plugin-log-empty";
    emptyLog.textContent = "（暂无日志——在插件代码里调 host.log(\"...\") 试试）";
    logBox.appendChild(emptyLog);
  } else {
    for (const { t, msg } of lines) {
      const lineEl = document.createElement("div");
      lineEl.className = "plugin-log-line";
      const time = new Date(t).toLocaleTimeString("zh-CN", { hour12: false });
      lineEl.textContent = `${time}  ${msg}`;
      logBox.appendChild(lineEl);
    }
  }
  detail.appendChild(logBox);

  return detail;
}
