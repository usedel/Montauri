// Live Templates 管理面板（M2，方案 §10；P1 内嵌到设置面板的分类页）：
// 列表 / 编辑 / 启停 / 变量表 / 表达式校验 / 导入导出；纯 DOM 构建（Vanilla TS 约定）；
// 静态骨架见 index.html #settings-section-templates；保存目标层可选（用户/工作区）

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { parseExpression } from "../engine";
import { parsePycharmXml } from "../pycharmImport";
import {
  parseTemplatesFile,
  type TemplateDef,
  type TemplateKind,
  type TemplateVariableDef,
  type TemplatesFile,
} from "../schema";
import type { ConfigLayer, EffectiveEntry, LiveTemplatesHandle } from "../index";
import { codicon } from "../../util";

export interface PanelHost {
  getHandle(): LiveTemplatesHandle | null;
  hasWorkspace(): boolean;
}

interface PanelEls {
  layer: HTMLSelectElement;
  search: HTMLInputElement;
  /** 分组筛选下拉（全部 / 各命名分组 / 未分组） */
  groupFilter: HTMLSelectElement;
  /** 对当前筛选结果批量启用 / 禁用 */
  batchEnable: HTMLButtonElement;
  batchDisable: HTMLButtonElement;
  /** 重命名当前选中的分组 */
  groupRename: HTMLButtonElement;
  list: HTMLElement;
  editor: HTMLElement;
  status: HTMLElement;
}

const ALL_SCOPES = ["python:module", "python:class", "python:function"] as const;
const SCOPE_LABELS: Record<string, string> = {
  "python:module": "模块",
  "python:class": "类",
  "python:function": "函数",
};
const ABBR_RE = /^[A-Za-z0-9._-]+$/;
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 面板创建的墓碑条目约定 body（区分「禁用占位」与「真实模板」） */
const TOMBSTONE_BODY = "-";

let host: PanelHost;
let els: PanelEls;
/** 当前编辑中的模板标识 `${kind}:${abbreviation}`（null = 未打开编辑器；"normal:" = 新建） */
let editingIdentity: string | null = null;

const KIND_LABELS: Record<TemplateKind, string> = {
  normal: "插入",
  surround: "环绕",
  postfix: "后缀",
};

const identityOf = (kind: TemplateKind, abbr: string): string => `${kind}:${abbr}`;

// ---------- 入口 ----------

export function wirePanel(h: PanelHost): void {
  host = h;
  els = {
    layer: $("lt-layer") as HTMLSelectElement,
    search: $("lt-search") as HTMLInputElement,
    groupFilter: $("lt-group-filter") as HTMLSelectElement,
    batchEnable: $("lt-batch-enable") as HTMLButtonElement,
    batchDisable: $("lt-batch-disable") as HTMLButtonElement,
    groupRename: $("lt-group-rename") as HTMLButtonElement,
    list: $("lt-list"),
    editor: $("lt-editor"),
    status: $("lt-status"),
  };
  $("lt-new").addEventListener("click", () => openEditor(null));
  $("lt-import").addEventListener("click", () => void doImport());
  $("lt-export").addEventListener("click", () => void doExport());
  els.layer.addEventListener("change", () => renderList());
  els.search.addEventListener("input", () => renderList());
  els.groupFilter.addEventListener("change", () => renderList());
  els.batchEnable.addEventListener("click", () => void batchSetEnabled(true));
  els.batchDisable.addEventListener("click", () => void batchSetEnabled(false));
  els.groupRename.addEventListener("click", () => beginGroupRename());
}

/** 进入 Live Templates 分类时由设置面板调用：重置层默认值 + 渲染列表 */
export function openPanel(): void {
  if (!host.getHandle()) return;
  els.layer.value = host.hasWorkspace() ? (els.layer.value || "user") : "user";
  (els.layer.options[1] as HTMLOptionElement).disabled = !host.hasWorkspace();
  renderList();
  if (editingIdentity === null) renderEmptyEditor();
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el;
}

function currentLayer(): ConfigLayer {
  return els.layer.value === "workspace" ? "workspace" : "user";
}

function setStatus(msg: string, isError = false): void {
  els.status.textContent = msg;
  els.status.classList.toggle("error", isError);
  if (msg) {
    window.setTimeout(() => {
      if (els.status.textContent === msg) els.status.textContent = "";
    }, 4000);
  }
}

// ---------- 列表 ----------

function renderList(): void {
  const handle = host.getHandle();
  if (!handle) return;
  rebuildGroupFilter();
  const entries = filteredEntries();

  els.list.textContent = "";
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "lt-row" + (identityOf(entry.kind, entry.abbreviation) === editingIdentity ? " selected" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = entry.enabled;
    cb.title = entry.enabled ? "点击禁用" : "点击启用";
    cb.addEventListener("click", (ev) => ev.stopPropagation());
    cb.addEventListener("change", () => void toggleEnabled(entry, cb.checked));
    row.appendChild(cb);

    const abbr = document.createElement("span");
    abbr.className = "lt-abbr";
    abbr.textContent = entry.kind === "postfix" ? `.${entry.postfixKey ?? entry.abbreviation}` : entry.abbreviation;
    row.appendChild(abbr);

    // 徽章仅在非默认时展示（插入/内置占多数），减少列表重复噪声
    if (entry.kind !== "normal") {
      const kindBadge = document.createElement("span");
      kindBadge.className = `lt-badge lt-kind-${entry.kind}`;
      kindBadge.textContent = KIND_LABELS[entry.kind];
      row.appendChild(kindBadge);
    }
    if (entry.origin !== "builtin") {
      const badge = document.createElement("span");
      badge.className = `lt-badge lt-origin-${entry.origin}`;
      badge.textContent = entry.origin === "user" ? "用户" : "工作区";
      row.appendChild(badge);
    }
    // 领域分组徽章（如「爬虫」）：仅在非默认组时展示，区分领域模板与通用内置
    if (entry.group) {
      const gbadge = document.createElement("span");
      gbadge.className = "lt-badge lt-group";
      gbadge.textContent = entry.group;
      row.appendChild(gbadge);
    }

    const desc = document.createElement("span");
    desc.className = "lt-desc";
    desc.textContent = entry.description;
    desc.title = `${entry.description}\nscopes: ${entry.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(", ") || "（已全部禁用）"}`;
    row.appendChild(desc);

    row.addEventListener("click", () => openEditor(entry));
    els.list.appendChild(row);
  }
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lt-empty";
    empty.textContent = "无匹配模板";
    els.list.appendChild(empty);
  }
  // 批量按钮随筛选结果联动：无结果时禁用
  const none = entries.length === 0;
  els.batchEnable.disabled = none;
  els.batchDisable.disabled = none;
  // 重命名仅对「命名分组」可用（全部/未分组不可改名）
  const gf = els.groupFilter.value;
  els.groupRename.disabled = !gf || gf === "__all__" || gf === "__none__";
}

/** 当前「搜索 + 分组」筛选后的生效模板集合（批量操作与列表渲染共用） */
function filteredEntries(): EffectiveEntry[] {
  const handle = host.getHandle();
  if (!handle) return [];
  const filter = els.search.value.trim().toLowerCase();
  const gf = els.groupFilter?.value ?? "__all__";
  return handle.listEffective().filter((e) => {
    if (gf === "__none__") {
      if (e.group) return false;
    } else if (gf !== "__all__" && e.group !== gf) {
      return false;
    }
    if (
      filter &&
      !e.abbreviation.toLowerCase().includes(filter) &&
      !e.description.toLowerCase().includes(filter)
    ) {
      return false;
    }
    return true;
  });
}

/** 分组筛选签名缓存：分组集合不变时不重建下拉，避免搜索每次击键重绘 */
let lastGroupSig: string | null = null;

/** 生效集中出现过的分组名（明文，去重排序）；编辑器分组候选与筛选下拉共用 */
function distinctGroups(): string[] {
  const handle = host.getHandle();
  const s = new Set<string>();
  if (handle) for (const e of handle.listEffective()) if (e.group) s.add(e.group);
  return Array.from(s).sort();
}

/** 依据 listEffective 中的命名分组重建筛选下拉（保持当前选择；非法则回落「全部」） */
function rebuildGroupFilter(): void {
  const sel = els.groupFilter;
  if (!host.getHandle() || !sel) return;
  const groupList = distinctGroups();
  const sig = groupList.join("\u0000");
  if (sig === lastGroupSig && sel.options.length > 0) return;
  lastGroupSig = sig;

  const current = sel.value || "__all__";
  sel.textContent = "";
  const mk = (value: string, label: string): void => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  };
  mk("__all__", "全部分组");
  for (const g of groupList) mk(g, g);
  mk("__none__", "未分组");
  const values = Array.from(sel.options).map((o) => o.value);
  sel.value = values.includes(current) ? current : "__all__";
}

/** 分组输入框自绘候选下拉（替代原生 datalist，适配深色主题） */
function wireGroupAutocomplete(inp: HTMLInputElement, drop: HTMLElement): void {
  const render = (): void => {
    const q = inp.value.trim().toLowerCase();
    const groups = distinctGroups().filter((g) => !q || g.toLowerCase().includes(q));
    drop.textContent = "";
    if (groups.length === 0) {
      drop.classList.remove("open");
      return;
    }
    for (const g of groups) {
      const item = document.createElement("div");
      item.className = "lt-group-drop-item";
      item.textContent = g;
      item.addEventListener("mousedown", (e) => {
        e.preventDefault(); // 先于 blur 触发，保证点击选中生效
        inp.value = g;
        drop.classList.remove("open");
      });
      drop.appendChild(item);
    }
    drop.classList.add("open");
  };
  inp.addEventListener("focus", render);
  inp.addEventListener("input", render);
  inp.addEventListener("blur", () => drop.classList.remove("open"));
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Escape") drop.classList.remove("open");
  });
}

async function toggleEnabled(entry: EffectiveEntry, enabled: boolean): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  const layer = currentLayer();
  const file = cloneFile(handle.getFile(layer)) ?? emptyFile();
  const outcome = applyEnabledToFile(file, entry, enabled, layer);
  if (outcome === "blocked") {
    setStatus("该模板被其他层禁用，请切换到对应层操作", true);
    renderList();
    return;
  }
  if (outcome === "noop") {
    renderList();
    return;
  }
  try {
    await handle.saveFile(layer, file);
    setStatus(enabled ? `已启用 ${entry.abbreviation}` : `已禁用 ${entry.abbreviation}`);
  } catch (e) {
    setStatus(`保存失败：${e}`, true);
  }
  renderList();
}

/** 单个模板启停的落盘结果 */
type ApplyOutcome = "changed" | "noop" | "blocked";

/** 生成禁用墓碑（携带 group：禁用后仍能被分组筛选命中，便于整组恢复） */
function makeTombstone(entry: EffectiveEntry, layer: ConfigLayer): TemplateDef {
  return {
    id: `${layer === "user" ? "user" : "ws"}.${entry.kind}.${entry.abbreviation}`,
    abbreviation: entry.abbreviation,
    description: entry.description,
    body: TOMBSTONE_BODY,
    scopes: entry.tpl.scopes,
    group: entry.group,
    kind: entry.kind,
    postfixKey: entry.postfixKey,
    enabled: false,
    tabExpand: false,
  };
}

/**
 * 将单个模板启用/禁用到 file（原地修改）：
 * 启用——本层墓碑则移除、本层禁用条目则置启用、本层无条目视为被其他层禁用（blocked）；
 * 禁用——本层有条目则置禁用、无条目则写墓碑；已是目标态返回 noop。
 */
function applyEnabledToFile(
  file: TemplatesFile,
  entry: EffectiveEntry,
  enabled: boolean,
  layer: ConfigLayer,
): ApplyOutcome {
  const existing = file.templates.find(
    (t) => t.abbreviation === entry.abbreviation && t.kind === entry.kind,
  );
  if (enabled) {
    if (existing && !existing.enabled) {
      if (existing.body === TOMBSTONE_BODY) {
        file.templates = file.templates.filter((t) => t !== existing);
      } else {
        existing.enabled = true;
      }
      return "changed";
    }
    if (!existing) return "blocked";
    return "noop";
  }
  if (existing) {
    if (!existing.enabled) return "noop";
    existing.enabled = false;
    return "changed";
  }
  file.templates.push(makeTombstone(entry, layer));
  return "changed";
}

/** 对当前「搜索 + 分组」筛选结果批量启用/禁用：一次性改 file 后单次保存 */
async function batchSetEnabled(enabled: boolean): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  const entries = filteredEntries();
  if (entries.length === 0) {
    setStatus("当前筛选结果为空，无可操作模板", true);
    return;
  }
  const layer = currentLayer();
  const file = cloneFile(handle.getFile(layer)) ?? emptyFile();
  let changed = 0;
  let noop = 0;
  let blocked = 0;
  for (const entry of entries) {
    const r = applyEnabledToFile(file, entry, enabled, layer);
    if (r === "changed") changed++;
    else if (r === "noop") noop++;
    else blocked++;
  }
  if (changed === 0) {
    setStatus(
      blocked > 0
        ? `筛选内无可变更模板（${blocked} 个被其他层禁用，请切换层）`
        : `筛选内模板均已处于${enabled ? "启用" : "禁用"}状态`,
      blocked > 0,
    );
    renderList();
    return;
  }
  try {
    await handle.saveFile(layer, file);
    let msg = `批量${enabled ? "启用" : "禁用"}完成：生效 ${changed} 个`;
    if (noop > 0) msg += `，${noop} 个本就${enabled ? "启用" : "禁用"}`;
    if (blocked > 0) msg += `，${blocked} 个被其他层禁用`;
    setStatus(msg);
  } catch (e) {
    setStatus(`保存失败：${e}`, true);
  }
  renderList();
}

// ---------- 分组重命名 ----------

/** 内联重命名当前选中分组：在「重命名」按钮旁展开输入框，回车/确定提交，Esc/取消放弃 */
function beginGroupRename(): void {
  const oldName = els.groupFilter.value;
  if (!oldName || oldName === "__all__" || oldName === "__none__") return;
  const btn = els.groupRename;
  const wrap = document.createElement("span");
  wrap.className = "lt-rename-inline";
  const inp = document.createElement("input");
  inp.type = "text";
  inp.autocomplete = "off";
  inp.className = "lt-rename-input";
  inp.value = oldName;
  inp.spellcheck = false;
  // UI-08：内联重命名的确定/取消原先靠 `.lt-toolbar button` 后代选择器取样式，
  // 迁移到 .btn 体系后必须显式加类名（紧凑档，贴合工具栏行高）
  const ok = document.createElement("button");
  ok.className = "btn btn--sm";
  ok.textContent = "确定";
  const cancel = document.createElement("button");
  cancel.className = "btn btn--sm";
  cancel.textContent = "取消";
  wrap.append(inp, ok, cancel);
  btn.style.display = "none";
  btn.insertAdjacentElement("afterend", wrap);
  inp.focus();
  inp.select();

  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    wrap.remove();
    btn.style.display = "";
  };
  const commit = (): void => {
    const newName = inp.value.trim();
    finish();
    if (!newName) {
      setStatus("分组名不能为空", true);
      return;
    }
    if (newName === oldName) return;
    void renameGroup(oldName, newName);
  };
  ok.addEventListener("click", commit);
  cancel.addEventListener("click", finish);
  inp.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
  });
}

/** 重命名分组：把生效集中属于 oldName 的模板（含内置）在本层落「改组覆盖」，单次保存 */
async function renameGroup(oldName: string, newName: string): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  const layer = currentLayer();
  const file = cloneFile(handle.getFile(layer)) ?? emptyFile();
  const entries = handle.listEffective().filter((e) => e.group === oldName);
  if (entries.length === 0) {
    setStatus(`分组「${oldName}」下没有模板`, true);
    return;
  }
  let count = 0;
  for (const entry of entries) {
    const existing = file.templates.find(
      (t) => t.abbreviation === entry.abbreviation && t.kind === entry.kind,
    );
    if (existing) {
      existing.group = newName;
    } else {
      // 下层（如内置）模板 → 本层写一份仅改分组的覆盖，使改名对其生效
      file.templates.push({
        ...entry.tpl,
        id: `${layer === "user" ? "user" : "ws"}.${entry.kind}.${entry.abbreviation}`,
        group: newName,
      });
    }
    count++;
  }
  try {
    await handle.saveFile(layer, file);
    setStatus(`已将分组「${oldName}」重命名为「${newName}」（${count} 个模板）`);
  } catch (e) {
    setStatus(`保存失败：${e}`, true);
    return;
  }
  renderList();
  // 选中重命名后的分组，保持用户所在组上下文
  if (Array.from(els.groupFilter.options).some((o) => o.value === newName)) {
    els.groupFilter.value = newName;
    renderList();
  }
}

// ---------- 编辑器 ----------

function renderEmptyEditor(): void {
  editingIdentity = null;
  els.editor.textContent = "";
  const hint = document.createElement("div");
  hint.className = "lt-empty";
  hint.textContent = "从左侧选择模板编辑，或点击「新建模板」";
  els.editor.appendChild(hint);
}

function openEditor(entry: EffectiveEntry | null): void {
  const handle = host.getHandle();
  if (!handle) return;
  const layer = currentLayer();
  const layerFile = handle.getFile(layer);
  // 优先取本层已有定义（含被覆盖的形态），否则取生效定义，否则空白
  const base: TemplateDef | null = entry
    ? (layerFile?.templates.find(
        (t) => t.abbreviation === entry.abbreviation && t.kind === entry.kind,
      ) ?? entry.tpl)
    : null;
  editingIdentity = entry ? identityOf(entry.kind, entry.abbreviation) : "normal:";

  const ed = els.editor;
  ed.textContent = "";

  // 双列网格表单（标签在上、控件在下），避免横向长标签在窄容器下挤压控件
  const grid = document.createElement("div");
  grid.className = "lt-grid";

  // 类型（插入 / 环绕 / 后缀）
  const kindRow = document.createElement("div");
  kindRow.className = "lt-field";
  const kindLabel = document.createElement("label");
  kindLabel.textContent = "类型";
  const kindSel = document.createElement("select");
  kindSel.id = "lt-f-kind";
  kindLabel.htmlFor = kindSel.id; // 遗留修复：label↔控件关联
  for (const k of ["normal", "surround", "postfix"] as const) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = KIND_LABELS[k];
    kindSel.appendChild(opt);
  }
  kindSel.value = base?.kind ?? "normal";
  kindSel.addEventListener("change", () => {
    const pk = $("lt-f-postfixkey") as HTMLInputElement;
    pk.disabled = kindSel.value !== "postfix";
    const hint = $("lt-kind-hint");
    if (hint) {
      hint.textContent =
        kindSel.value === "surround"
          ? "环绕模板：模板体须含 $SELECTION$（承载选中代码），经 Ctrl+Alt+T 调用"
          : kindSel.value === "postfix"
            ? "后缀模板：`表达式.键` 触发，$EXPR$ 由表达式字面注入"
            : "插入模板：缩写 + Tab 直接展开，或经补全弹窗插入";
    }
  });
  const kindHint = document.createElement("div");
  kindHint.className = "lt-hint";
  kindHint.id = "lt-kind-hint";
  kindHint.textContent = "插入模板：缩写 + Tab 直接展开，或经补全弹窗插入";
  kindRow.append(kindLabel, kindSel, kindHint);
  grid.appendChild(kindRow);

  grid.appendChild(fieldRow("缩写", input("lt-f-abbr", base?.abbreviation ?? "", "如 logf")));
  // 直接持有引用：grid 尚未挂载到文档，getElementById 此时查不到
  const postfixInput = input("lt-f-postfixkey", base?.postfixKey ?? "", "仅后缀模板：`.` 后的键，如 if");
  grid.appendChild(fieldRow("后缀键", postfixInput));
  postfixInput.disabled = (base?.kind ?? "normal") !== "postfix";
  grid.appendChild(fieldRow("描述", input("lt-f-desc", base?.description ?? "", "补全列表中的说明")));
  // 分组：选已有分组或输入新名称即新建；留空 = 未分组。
  // 用自绘下拉替代原生 <datalist>——WebView2 原生下拉为浅色且不可主题化，与深色 UI 冲突
  const groupInput = input("lt-f-group", base?.group ?? "", "未分组；输入名称以新建分组");
  const groupWrap = document.createElement("div");
  groupWrap.className = "lt-group-wrap";
  const groupDrop = document.createElement("div");
  groupDrop.className = "lt-group-drop";
  groupWrap.append(groupInput, groupDrop);
  grid.appendChild(fieldRow("分组", groupWrap));
  ed.appendChild(grid);
  wireGroupAutocomplete(groupInput, groupDrop);

  // 作用域 + Tab 展开合并为一行，节省纵向空间
  const inlineRow = document.createElement("div");
  inlineRow.className = "lt-inline";
  const scopeLabel = document.createElement("span");
  scopeLabel.className = "lt-inline-label";
  scopeLabel.textContent = "作用域";
  inlineRow.appendChild(scopeLabel);
  const scopeBox = document.createElement("div");
  scopeBox.className = "lt-scope-box";
  for (const s of ALL_SCOPES) {
    const wrap = document.createElement("label");
    wrap.className = "lt-scope-opt";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.dataset.scope = s;
    cb.checked = base ? base.scopes.includes(s) : true;
    wrap.append(cb, document.createTextNode(SCOPE_LABELS[s]));
    scopeBox.appendChild(wrap);
  }
  inlineRow.appendChild(scopeBox);
  const tabWrap = document.createElement("label");
  tabWrap.className = "lt-tab-opt";
  tabWrap.title = "关闭后仅通过补全弹窗使用（关键字类缩写建议关闭）";
  const tabCb = document.createElement("input");
  tabCb.type = "checkbox";
  tabCb.id = "lt-f-tabexpand";
  tabCb.checked = base?.tabExpand ?? true;
  tabWrap.append(tabCb, document.createTextNode("Tab 直接展开"));
  inlineRow.appendChild(tabWrap);
  ed.appendChild(inlineRow);

  ed.appendChild(fieldRow("模板体", textarea("lt-f-body", base?.body ?? "", "$VAR$ 变量 · $END$ 终点 · $$ 字面 $")));
  const bodyHint = document.createElement("div");
  bodyHint.className = "lt-hint";
  bodyHint.textContent = "变量在下方声明；未声明的 $VAR$ 自动成为普通占位符";
  ed.appendChild(bodyHint);

  // 变量表
  const varsWrap = document.createElement("div");
  varsWrap.className = "lt-vars";
  const varsTitle = document.createElement("div");
  varsTitle.className = "lt-vars-title";
  varsTitle.textContent = "变量（行序 = Tab 跳转序）";
  varsWrap.appendChild(varsTitle);
  const table = document.createElement("table");
  table.className = "lt-vars-table";
  table.innerHTML =
    "<thead><tr><th>名称</th><th>表达式</th><th>默认值</th><th title=\"求值成功即跳过\">跳过</th><th></th></tr></thead>";
  const tbody = document.createElement("tbody");
  tbody.id = "lt-vars-body";
  table.appendChild(tbody);
  varsWrap.appendChild(table);
  const addBtn = document.createElement("button");
  // UI-08：中性档（原 .lt-mini-btn 把 danger hover 写死在基类，「添加」也泛红，此处顺带修正）；
  // 图标与文字间距由 .btn 的 gap 提供，不再靠前导空格
  addBtn.className = "btn btn--sm";
  addBtn.append(codicon("add"), "添加变量");
  addBtn.addEventListener("click", () => addVarRow());
  varsWrap.appendChild(addBtn);
  ed.appendChild(varsWrap);
  for (const v of base?.variables ?? []) {
    addVarRow(v.name, v.expression ?? "", v.defaultValue ?? "", v.skipIfDefined ?? false);
  }

  // 操作按钮
  const actions = document.createElement("div");
  actions.className = "lt-editor-actions";
  const layerHasOverride = !!layerFile?.templates.some(
    (t) => t.abbreviation === (entry?.abbreviation ?? "") && t.kind === (entry?.kind ?? "normal"),
  );
  const isBuiltin = entry?.origin === "builtin";
  // UI-08：底部操作按钮迁移到 .btn 体系——破坏性动作用描边形态（次要位置不宜整块实心红）
  const delBtn = document.createElement("button");
  delBtn.textContent = "删除";
  delBtn.className = "btn btn--danger-outline";
  delBtn.disabled = !entry || isBuiltin;
  // UI-09 例外：保留原生 title。本按钮的提示主要就是「禁用原因」（内置模板不可删除 / 需先选中模板），
  // 而它在这些情况下恰恰是 disabled 的——Chromium 不向禁用表单控件派发鼠标事件，data-tip 会静默失效，
  // 等于把最该看到的提示弄丢。原生 title 由渲染层命中测试驱动，禁用态仍显示。resetBtn 同理。
  delBtn.title = isBuiltin
    ? "内置模板不可删除，只能禁用"
    : entry
      ? `从该模板所属层删除「${entry.abbreviation}」`
      : "选择模板后方可删除";
  delBtn.addEventListener("click", () => {
    if (entry) void doDelete(entry);
  });
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = "恢复内置";
  resetBtn.title = "移除本层对该模板的覆盖/禁用";
  resetBtn.disabled = !entry || !isBuiltin || !layerHasOverride;
  resetBtn.addEventListener("click", () => void doReset(entry?.kind ?? "normal", entry?.abbreviation ?? ""));
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn--primary";
  saveBtn.textContent = "保存模板";
  saveBtn.addEventListener("click", () => void doSave());
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", renderEmptyEditor);

  // 左：破坏性/还原操作；右：主流程操作，左右分组避免拥挤
  const leftGroup = document.createElement("div");
  leftGroup.className = "lt-actions-left";
  leftGroup.append(delBtn, resetBtn);
  const rightGroup = document.createElement("div");
  rightGroup.className = "lt-actions-right";
  rightGroup.append(saveBtn, cancelBtn);
  actions.append(leftGroup, rightGroup);
  ed.appendChild(actions);
  renderList(); // 刷新高亮
}

function fieldRow(labelText: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "lt-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  // 遗留修复：label↔控件关联。control 可能是包装容器（如「分组」行的 input+自绘下拉 wrapper），
  // 此时下探到首个带 id 的表单控件；找不到可关联目标则不设 for（label 只作视觉行标题）
  const target = control.id ? control : control.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[id],select[id],textarea[id]");
  if (target?.id) label.htmlFor = target.id;
  row.append(label, control);
  return row;
}

function input(id: string, value: string, placeholder: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.autocomplete = "off";
  el.id = id;
  el.value = value;
  el.placeholder = placeholder;
  el.spellcheck = false;
  return el;
}

function textarea(id: string, value: string, placeholder: string): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.id = id;
  el.value = value;
  el.placeholder = placeholder;
  el.spellcheck = false;
  return el;
}

function addVarRow(name = "", expression = "", defaultValue = "", skip = false): void {
  const tbody = document.getElementById("lt-vars-body");
  if (!tbody) return;
  const tr = document.createElement("tr");

  const tdName = document.createElement("td");
  const nameInput = input("", name, "NAME");
  nameInput.classList.add("lt-v-name");
  tdName.appendChild(nameInput);

  const tdExpr = document.createElement("td");
  const exprInput = input("", expression, 'fileName() / concat(...) / enum("a","b")');
  exprInput.classList.add("lt-v-expr");
  exprInput.addEventListener("input", () => {
    const v = exprInput.value.trim();
    if (!v) {
      exprInput.classList.remove("invalid");
      exprInput.title = "";
      return;
    }
    try {
      parseExpression(v);
      exprInput.classList.remove("invalid");
      exprInput.title = "";
    } catch (e) {
      exprInput.classList.add("invalid");
      exprInput.title = `表达式语法错误：${e instanceof Error ? e.message : String(e)}`;
    }
  });
  tdExpr.appendChild(exprInput);

  const tdDefault = document.createElement("td");
  tdDefault.appendChild(input("", defaultValue, "求值失败时的值"));

  const tdSkip = document.createElement("td");
  const skipCb = document.createElement("input");
  skipCb.type = "checkbox";
  skipCb.checked = skip;
  skipCb.classList.add("lt-v-skip");
  tdSkip.appendChild(skipCb);

  const tdDel = document.createElement("td");
  const delBtn = document.createElement("button");
  // UI-08：表格行内的图标删除按钮——紧凑档 + 图标内边距 + 破坏性描边
  delBtn.className = "btn btn--sm btn--icon btn--danger-outline";
  delBtn.appendChild(codicon("close"));
  // UI-09：纯图标按钮且从不 disabled → 迁 data-tip；内部 <i> 带 aria-hidden，
  // 可访问名称原先仅由 title 提供，故同步补 aria-label。
  delBtn.dataset.tip = "删除变量";
  delBtn.setAttribute("aria-label", "删除变量");
  delBtn.addEventListener("click", () => tr.remove());
  tdDel.appendChild(delBtn);

  tr.append(tdName, tdExpr, tdDefault, tdSkip, tdDel);
  tbody.appendChild(tr);
}

/** 收集表单 → TemplateDef；错误返回 null 并就地提示 */
function collectDraft(): TemplateDef | null {
  const kind = ($("lt-f-kind") as HTMLSelectElement).value as TemplateKind;
  const abbr = ($("lt-f-abbr") as HTMLInputElement).value.trim();
  if (!ABBR_RE.test(abbr)) {
    setStatus("缩写非法：仅允许字母/数字/点/下划线/连字符", true);
    return null;
  }
  const postfixKey = ($("lt-f-postfixkey") as HTMLInputElement).value.trim();
  if (kind === "postfix" && !ABBR_RE.test(postfixKey)) {
    setStatus("后缀模板需要合法后缀键（`.` 后的键）", true);
    return null;
  }
  const body = ($("lt-f-body") as HTMLTextAreaElement).value;
  if (!body.trim() || body === TOMBSTONE_BODY) {
    setStatus("模板体不能为空", true);
    return null;
  }
  if (kind === "surround" && !body.includes("$SELECTION$")) {
    setStatus("环绕模板的模板体必须包含 $SELECTION$", true);
    return null;
  }
  const scopes = Array.from(document.querySelectorAll<HTMLInputElement>(".lt-scope-opt input:checked")).map(
    (cb) => cb.dataset.scope ?? "",
  );
  if (scopes.length === 0) {
    setStatus("至少选择一个作用域", true);
    return null;
  }

  const variables: TemplateVariableDef[] = [];
  const seen = new Set<string>();
  for (const tr of Array.from(document.querySelectorAll<HTMLTableRowElement>("#lt-vars-body tr"))) {
    const name = tr.querySelector<HTMLInputElement>(".lt-v-name")?.value.trim() ?? "";
    const expression = tr.querySelector<HTMLInputElement>(".lt-v-expr")?.value.trim() ?? "";
    const defaultValue = tr.querySelector<HTMLInputElement>("td:nth-child(3) input")?.value ?? "";
    const skip = tr.querySelector<HTMLInputElement>(".lt-v-skip")?.checked ?? false;
    if (!name && !expression && !defaultValue) continue; // 空行跳过
    if (!VAR_NAME_RE.test(name)) {
      setStatus(`变量名非法：${name || "（空）"}`, true);
      return null;
    }
    if (seen.has(name)) {
      setStatus(`变量名重复：${name}`, true);
      return null;
    }
    seen.add(name);
    if (expression) {
      try {
        parseExpression(expression);
      } catch (e) {
        setStatus(`变量 ${name} 表达式错误：${e instanceof Error ? e.message : String(e)}`, true);
        return null;
      }
    }
    variables.push({
      name,
      expression: expression || undefined,
      defaultValue: defaultValue || undefined,
      skipIfDefined: skip,
    });
  }

  const group = ($("lt-f-group") as HTMLInputElement).value.trim();
  return {
    id: "", // 保存时按层分配
    abbreviation: abbr,
    description: ($("lt-f-desc") as HTMLInputElement).value.trim() || abbr,
    body,
    scopes,
    group: group || undefined,
    kind,
    postfixKey: kind === "postfix" ? postfixKey : undefined,
    enabled: true,
    tabExpand: ($("lt-f-tabexpand") as HTMLInputElement).checked,
    variables: variables.length > 0 ? variables : undefined,
  };
}

async function doSave(): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  const draft = collectDraft();
  if (!draft) return;
  const layer = currentLayer();
  const file = cloneFile(handle.getFile(layer)) ?? emptyFile();

  // 标识（kind+缩写）变更 → 移除旧条目；同标识覆盖
  const editingKind = (editingIdentity?.split(":")[0] ?? "") as TemplateKind | "";
  const editingAbbr = editingIdentity?.split(":")[1] ?? "";
  if (editingIdentity && editingIdentity !== identityOf(draft.kind, draft.abbreviation)) {
    file.templates = file.templates.filter(
      (t) => !(t.abbreviation === editingAbbr && t.kind === editingKind),
    );
  }
  const existing = file.templates.find(
    (t) => t.abbreviation === draft.abbreviation && t.kind === draft.kind,
  );
  draft.id = existing?.id ?? `${layer === "user" ? "user" : "ws"}.${draft.kind}.${draft.abbreviation}`;
  if (existing) {
    // 相位 B 才提供「适用环境」编辑 UI；此前编辑已有模板时继承原 positions，避免 round-trip 丢位置轴数据
    if (draft.positions === undefined) draft.positions = existing.positions;
    file.templates[file.templates.indexOf(existing)] = draft;
  } else {
    file.templates.push(draft);
  }

  try {
    await handle.saveFile(layer, file);
    setStatus(`已保存 ${draft.abbreviation}（${layer === "user" ? "用户层" : "工作区层"}）`);
    editingIdentity = identityOf(draft.kind, draft.abbreviation);
    renderList();
  } catch (e) {
    setStatus(`保存失败：${e}`, true);
  }
}

async function doReset(kind: TemplateKind, abbr: string): Promise<void> {
  const handle = host.getHandle();
  if (!handle || !abbr) return;
  const layer = currentLayer();
  const file = cloneFile(handle.getFile(layer));
  if (!file) return;
  file.templates = file.templates.filter((t) => !(t.abbreviation === abbr && t.kind === kind));
  try {
    await handle.saveFile(layer, file);
    setStatus(`已恢复内置 ${abbr}`);
    renderEmptyEditor();
    renderList();
  } catch (e) {
    setStatus(`保存失败：${e}`, true);
  }
}

/** 删除模板：仅限用户/工作区自定义模板；内置模板只可禁用/恢复 */
async function doDelete(entry: EffectiveEntry): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  if (entry.origin === "builtin") {
    setStatus("内置模板不可删除，只能禁用", true);
    return;
  }
  const layer = entry.origin as ConfigLayer; // 此时 origin ∈ { user, workspace }
  const file = cloneFile(handle.getFile(layer));
  if (!file) return;
  const before = file.templates.length;
  file.templates = file.templates.filter(
    (t) => !(t.abbreviation === entry.abbreviation && t.kind === entry.kind),
  );
  if (file.templates.length === before) {
    setStatus(`未找到可删除的模板 ${entry.abbreviation}`, true);
    return;
  }
  try {
    await handle.saveFile(layer, file);
    setStatus(`已删除 ${entry.abbreviation}（${layer === "user" ? "用户层" : "工作区层"}）`);
    renderEmptyEditor();
    renderList();
  } catch (e) {
    setStatus(`删除失败：${e}`, true);
  }
}

// ---------- 导入 / 导出 ----------

async function doExport(): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  const layer = currentLayer();
  const file = handle.getFile(layer);
  if (!file || file.templates.length === 0) {
    setStatus("当前层没有可导出的模板", true);
    return;
  }
  const target = await saveDialog({
    title: "导出 Live Templates",
    defaultPath: "opencharm-live-templates.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!target) return;
  try {
    await invoke("write_file", { path: target, content: JSON.stringify(file, null, 2) });
    setStatus(`已导出到 ${target}`);
  } catch (e) {
    setStatus(`导出失败：${e}`, true);
  }
}

async function doImport(): Promise<void> {
  const handle = host.getHandle();
  if (!handle) return;
  const picked = await openDialog({
    title: "导入 Live Templates",
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!picked || typeof picked !== "string") return;
  let raw: string;
  try {
    raw = await invoke<string>("read_file", { path: picked });
  } catch (e) {
    setStatus(`读取失败：${e}`, true);
    return;
  }

  // 双通道：XML（PyCharm 导出，M4）/ JSON（Schema v2 或 v1）
  let templates: TemplateDef[];
  let ordering: Record<string, string[]> | undefined;
  let note = "";
  if (raw.trim().startsWith("<")) {
    const result = parsePycharmXml(raw);
    if (!result || result.templates.length === 0) {
      setStatus("导入失败：不是合法的 PyCharm Live Templates XML（或无可解析模板）", true);
      return;
    }
    templates = result.templates;
    if (result.downgraded.length > 0) {
      for (const d of result.downgraded) {
        console.warn(
          `[live-templates] PyCharm 导入：${d.abbreviation} 变量 ${d.variable} 表达式不支持，已降级为默认值：${d.expression}`,
        );
      }
      note = `；${result.downgraded.length} 个表达式降级为默认值（详见控制台）`;
    }
  } else {
    const parsed = parseTemplatesFile(raw);
    if (!parsed) {
      setStatus("导入失败：文件不是合法的模板配置（Schema v2 / v1 / PyCharm XML）", true);
      return;
    }
    templates = parsed.file.templates;
    ordering = parsed.file.ordering;
    if (parsed.errors.length > 0) note = `；${parsed.errors.length} 条非法条目被跳过`;
  }

  const layer = currentLayer();
  const file = cloneFile(handle.getFile(layer)) ?? emptyFile();
  let replaced = 0;
  let added = 0;
  for (const tpl of templates) {
    const idx = file.templates.findIndex(
      (t) => t.abbreviation === tpl.abbreviation && t.kind === tpl.kind,
    );
    if (idx >= 0) {
      file.templates[idx] = { ...tpl, id: file.templates[idx].id };
      replaced++;
    } else {
      file.templates.push(tpl);
      added++;
    }
  }
  for (const [scope, list] of Object.entries(ordering ?? {})) {
    if (file.ordering) file.ordering[scope] = list;
    else file.ordering = { [scope]: list };
  }

  try {
    await handle.saveFile(layer, file);
    setStatus(`导入完成：新增 ${added}，覆盖 ${replaced}${note}`);
    renderList();
  } catch (e) {
    setStatus(`导入保存失败：${e}`, true);
  }
}

// ---------- 工具 ----------

function emptyFile(): TemplatesFile {
  return { version: 2, templates: [], ordering: {} };
}

function cloneFile(file: TemplatesFile | null): TemplatesFile | null {
  return file ? structuredClone(file) : null;
}
