// Python 环境面板域（TD-14 拆分，原 main.ts 的「Python 环境管理 P25-T05」段）：
// 解释器状态栏 / 环境面板（解释器选择 / venv 创建 / 包管理）/ 灯泡装包 /
// .venv 自动检测提示 / 工具链首启引导 / pip 与 toolchain 事件流。
// 域内私有状态（包列表 / outdated / 勾选集 / 会话内提示去重）留在本模块；
// currentInterpreter 为跨域共享（runFlow 的 prepareRun、main 的 startLsp 读），导出 live binding。
// startLsp 经 initEnvPanel 注入（restartEngine）——避免与 main 循环依赖（terminal.ts 先例）。

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { app, $, $btn, outputEl } from "./state";
import { basename, setBusy, spinIcon as utilSpinIcon, SNAKE_SVG } from "./util";
import { appendOutputLine } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { openConfirm } from "./dialog";
import { hideEl, showEl } from "./anim";
import { trapFocus } from "./focusTrap";
import { toastFail } from "./toast";
import * as toolchain from "./toolchain";

// ---------- 域内类型 ----------

interface PythonInfo { path: string; version: string; kind: string; is_selected: boolean }
interface PackageInfo { name: string; version: string }
/** Python 版本下拉项（venv 创建用，含可下载版本标记；新建项目域共用） */
export interface PythonVersionOption { version: string; spec: string; path: string | null; installed: boolean }
interface OutdatedInfo { name: string; version: string; latest: string; filetype: string }
/** create_venv 返回（新建项目域共用） */
export interface CreateVenvResult { output: string; python: string }

// ---------- 域内 DOM ----------

const statusInterpreterEl = $("status-interpreter");
const envModalEl = $("env-modal");
const envListEl = $("env-list");
const envPackagesEl = $("env-packages");
const envVersionSelectEl = $("env-version-select") as HTMLSelectElement;
const envPkgInputEl = $("env-pkg-input") as HTMLInputElement;
const envPkgCountEl = $("env-pkg-count");
const envPkgUpgradeAllBtn = $btn("env-pkg-upgrade-all");
const envPkgUninstallSelectedBtn = $btn("env-pkg-uninstall-selected");
const envPyprojectBannerEl = $("env-pyproject-banner");
const envPyprojectInitBtn = $btn("env-pyproject-init");

// ---------- 域内状态 ----------

/** 当前工作区解释器（null = uv run 兜底）；runFlow / main 跨域读取 */
export let currentInterpreter: string | null = null;
/** 本轮会话是否已提示过 .venv 自动检测 */
const venvPrompted = new Set<string>();
/** 环境面板包列表状态 */
let currentPackages: PackageInfo[] = [];
let outdatedPackages: Map<string, OutdatedInfo> = new Map();
let selectedPkgs: Set<string> = new Set();
/** CR-20：包列表刷新令牌——快速切解释器时，解释器 A 的 outdated 不得标到 B 的包上 */
let pkgToken = 0;
/** UI-05：环境面板焦点陷阱解除句柄，关闭时置 null */
let releaseEnvFocus: (() => void) | null = null;
/** installMissingPackage 装完后重启静态引擎（initEnvPanel 注入 startLsp） */
let restartEngine: () => Promise<void> = () => Promise.resolve();

// ---------- 状态栏 ----------

/** 解释器路径短名（.venv / 文件名）；runFlow 的回显与 prepareRun 复用（来源前缀判定） */
export function shortInterpreter(p: string): string {
  if (app.workspaceRoot && p.startsWith(app.workspaceRoot)) {
    const rel = p.slice(app.workspaceRoot.length).replace(/^[\\/]/, "");
    if (rel.startsWith(".venv")) return ".venv";
  }
  return basename(p);
}

function pythonLabel(p: PythonInfo): string {
  const ver = p.version ? ` ${p.version}` : "";
  if (p.kind === "workspace-venv") return `工作区 .venv${ver}`;
  if (p.kind === "manual") return `手动${ver}`;
  return p.version || p.path;
}

export async function refreshInterpreterStatus(): Promise<void> {
  if (!app.workspaceRoot) {
    statusInterpreterEl.textContent = "";
    currentInterpreter = null;
    return;
  }
  try {
    currentInterpreter = await invoke<string | null>("get_interpreter", { workspaceRoot: app.workspaceRoot });
  } catch {
    currentInterpreter = null;
  }
  // D2：品牌蛇形单色图标 + 解释器标签（textContent 拼接防注入）
  // P1（建议 2）：状态栏升级为“解释器来源 + 版本”（(.venv) 3.13.x / uv run），运行前即可感知用哪套环境。
  let label: string;
  if (currentInterpreter) {
    const short = shortInterpreter(currentInterpreter);
    const srcTag = short === ".venv" ? "(.venv)" : short;
    let ver = "";
    try {
      ver = await invoke<string>("interpreter_version", { path: currentInterpreter });
    } catch {
      ver = ""; // 版本查询失败降级为仅显示来源，不阻断
    }
    label = ver ? `${srcTag} ${ver}` : srcTag;
  } else {
    label = "uv run";
  }
  const snake = document.createElement("span");
  snake.className = "status-snake";
  snake.innerHTML = SNAKE_SVG; // 常量 SVG
  statusInterpreterEl.replaceChildren(snake, ` ${label}`);
}

/** 关闭工作区时清空解释器状态栏（main 的 closeWorkspace 调用） */
export function clearInterpreterStatus(): void {
  statusInterpreterEl.textContent = "";
}

/** 切换/关闭工作区时的环境域复位（原 resetEnvPackages + pkgToken / currentInterpreter / venvPrompted 清理）：
 * 清空包列表状态与面板块 DOM + 作废在途请求 + 防切换瞬间误用旧解释器；不主动触发 renderPackages，
 * 避免切换瞬间联网查询。 */
export function resetEnvPanelState(): void {
  currentPackages = [];
  outdatedPackages.clear();
  selectedPkgs.clear();
  envPackagesEl.textContent = "";
  updatePkgToolbar();
  pkgToken++;
  currentInterpreter = null;
  venvPrompted.clear();
}

// ---------- 环境面板 ----------

async function openEnvPanel(): Promise<void> {
  if (!app.workspaceRoot) return;
  showEl(envModalEl);
  // UI-30：解释器芯片（aria-haspopup=dialog）的开合态，与 envModal 显隐同源切换（第七批留给本批的待办）
  statusInterpreterEl.setAttribute("aria-expanded", "true");
  releaseEnvFocus?.();
  releaseEnvFocus = trapFocus(envModalEl);
  await renderEnvPanel();
}

function closeEnvPanel(): void {
  releaseEnvFocus?.();
  releaseEnvFocus = null;
  hideEl(envModalEl);
  statusInterpreterEl.setAttribute("aria-expanded", "false"); // UI-30
}

async function renderEnvPanel(): Promise<void> {
  if (!app.workspaceRoot) return;
  let pythons: PythonInfo[] = [];
  try {
    pythons = await invoke<PythonInfo[]>("list_pythons", { workspaceRoot: app.workspaceRoot });
  } catch (e) {
    console.error("list_pythons 失败", e);
  }

  // P2（建议 5）：裸目录（无 pyproject.toml）时显示横幅，一键幂等生成，收敛 uv run 语义
  try {
    const has = await invoke<boolean>("has_pyproject", { workspaceRoot: app.workspaceRoot });
    envPyprojectBannerEl.classList.toggle("hidden", has);
  } catch {
    envPyprojectBannerEl.classList.add("hidden");
  }

  envListEl.textContent = "";

  // 「默认」uv run 兜底项
  const noneItem = document.createElement("div");
  noneItem.className = `env-item${currentInterpreter ? "" : " selected"}`;
  const noneName = document.createElement("span");
  noneName.textContent = "（默认）uv run";
  const noneBadge = document.createElement("span");
  noneBadge.className = "badge";
  noneBadge.textContent = "兜底";
  noneItem.append(noneName, noneBadge);
  noneItem.addEventListener("click", () => selectInterpreter(null));
  envListEl.appendChild(noneItem);

  for (const p of pythons) {
    const item = document.createElement("div");
    item.className = `env-item${p.is_selected ? " selected" : ""}`;
    const name = document.createElement("span");
    name.textContent = pythonLabel(p);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = p.kind === "workspace-venv" ? "工作区" : p.kind === "manual" ? "手动" : "系统";
    const pathEl = document.createElement("span");
    pathEl.className = "path";
    pathEl.textContent = p.path;
    item.append(name, badge, pathEl);
    item.title = p.path;
    item.addEventListener("click", () => selectInterpreter(p.path));
    envListEl.appendChild(item);
  }
  if (pythons.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（样式不变）
    empty.textContent = "未检测到 Python（请安装 uv 或手动指定解释器路径）";
    envListEl.appendChild(empty);
  }

  // 版本下拉（用于创建 venv，含可下载版本）
  envVersionSelectEl.textContent = "";
  const defOpt = document.createElement("option");
  defOpt.value = "";
  defOpt.textContent = "（默认版本）";
  envVersionSelectEl.appendChild(defOpt);
  let versions: PythonVersionOption[] = [];
  try {
    versions = await invoke<PythonVersionOption[]>("list_python_versions");
  } catch (e) {
    console.error("list_python_versions 失败", e);
  }
  for (const v of versions) {
    const opt = document.createElement("option");
    opt.value = v.spec;
    opt.textContent = v.installed ? v.version : `${v.version}（需下载）`;
    envVersionSelectEl.appendChild(opt);
  }

  await renderPackages();
}

/** P2（建议 5）：为裸目录一键生成最小 pyproject.toml（幂等，已存在则不覆盖） */
async function generatePyproject(): Promise<void> {
  if (!app.workspaceRoot) return;
  setBusy(envPyprojectInitBtn, true, "生成中…");
  try {
    const msg = await invoke<string>("init_pyproject", { workspaceRoot: app.workspaceRoot });
    appendOutputLine(outputEl, msg, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `生成 pyproject.toml 失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(envPyprojectInitBtn, false);
  await renderEnvPanel(); // 重新检测 → 横幅消失
}

async function selectInterpreter(path: string | null): Promise<void> {
  if (!app.workspaceRoot) return;
  try {
    await invoke("set_interpreter", { workspaceRoot: app.workspaceRoot, path });
  } catch (e) {
    toastFail("设置解释器", e);
    return;
  }
  await refreshInterpreterStatus();
  await renderEnvPanel();
}

// ---------- 包管理 ----------

/** 根据当前选择与 outdated 状态刷新包工具栏按钮与计数 */
function updatePkgToolbar(): void {
  envPkgCountEl.textContent = currentPackages.length ? `（${currentPackages.length}）` : "";
  envPkgUninstallSelectedBtn.disabled = selectedPkgs.size === 0;
  envPkgUpgradeAllBtn.disabled = !currentInterpreter || outdatedPackages.size === 0;
}

/** 包列表加载占位（内联转圈） */
function renderPkgLoading(msg: string): void {
  envPackagesEl.textContent = "";
  const line = document.createElement("div");
  line.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（此处是加载态提示）
  line.appendChild(utilSpinIcon());
  line.append(` ${msg}`);
  envPackagesEl.appendChild(line);
}

/** 渲染包行（复用：首次快速渲染无 outdated 标记，后台补齐 outdated 后再渲染一次） */
function renderPkgLines(): void {
  envPackagesEl.textContent = "";
  if (currentPackages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（样式不变）
    empty.textContent = "（无已安装包）";
    envPackagesEl.appendChild(empty);
    updatePkgToolbar();
    return;
  }
  for (const p of currentPackages) {
    const line = document.createElement("div");
    line.className = "env-pkg-line";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "pkg-check";
    check.checked = selectedPkgs.has(p.name);
    check.title = "选择以卸载";
    check.addEventListener("change", () => {
      if (check.checked) selectedPkgs.add(p.name);
      else selectedPkgs.delete(p.name);
      updatePkgToolbar();
    });

    const n = document.createElement("span");
    n.className = "pkg-name";
    n.textContent = p.name;
    const v = document.createElement("span");
    v.className = "pkg-version";
    v.textContent = p.version;
    line.append(check, n, v);

    const od = outdatedPackages.get(p.name);
    if (od) {
      const badge = document.createElement("span");
      badge.className = "pkg-outdated";
      badge.textContent = `有新版 ${od.latest}`;
      badge.title = `当前 ${od.version} → 最新 ${od.latest}（${od.filetype}）`;
      line.append(badge);
    }

    const actions = document.createElement("span");
    actions.className = "pkg-actions";
    if (od) {
      const upBtn = document.createElement("button");
      upBtn.className = "codicon codicon-arrow-up";
      // UI-09：这两个按钮的 className 本身就是 codicon（无内部 <i>、无任何文本内容），
      // 可访问名称此前完全依赖 title，迁移后必须由 aria-label 承担，否则读屏读到空按钮。
      upBtn.dataset.tip = `升级 ${p.name} 到 ${od.latest}`;
      upBtn.setAttribute("aria-label", `升级 ${p.name} 到 ${od.latest}`);
      upBtn.addEventListener("click", () => { void upgradePackage(p.name); });
      actions.append(upBtn);
    }
    const rmBtn = document.createElement("button");
    rmBtn.className = "codicon codicon-trash danger";
    rmBtn.dataset.tip = `卸载 ${p.name}`;
    rmBtn.setAttribute("aria-label", `卸载 ${p.name}`);
    rmBtn.addEventListener("click", () => { void uninstallPackages([p.name]); });
    actions.append(rmBtn);
    line.append(actions);

    envPackagesEl.appendChild(line);
  }
  updatePkgToolbar();
}

async function renderPackages(): Promise<void> {
  updatePkgToolbar();
  if (!currentInterpreter) {
    envPackagesEl.textContent = "";
    const empty = document.createElement("div");
    empty.className = "hint-text"; // UI-12：.env-empty 更名为中性的 .hint-text（样式不变）
    empty.textContent = "选择解释器后查看已安装包";
    envPackagesEl.appendChild(empty);
    currentPackages = [];
    outdatedPackages.clear();
    selectedPkgs.clear();
    updatePkgToolbar();
    return;
  }
  const interp = currentInterpreter;
  const token = ++pkgToken;
  renderPkgLoading("正在加载已安装包…");
  // 先快速加载已装包并渲染：outdated 查询可能联网较慢，后台补齐不阻塞列表展示
  const pkgs = await invoke<PackageInfo[]>("list_packages", { interpreter: interp }).catch(() => [] as PackageInfo[]);
  if (token !== pkgToken || currentInterpreter !== interp) return; // 已切解释器，丢弃旧结果
  currentPackages = pkgs;
  selectedPkgs = new Set([...selectedPkgs].filter((n) => pkgs.some((p) => p.name === n)));
  renderPkgLines();

  const outdated = await invoke<OutdatedInfo[]>("list_outdated", { interpreter: interp }).catch(() => [] as OutdatedInfo[]);
  if (token !== pkgToken || currentInterpreter !== interp) return;
  outdatedPackages = new Map(outdated.map((o) => [o.name, o]));
  renderPkgLines();
}

async function createVenv(): Promise<void> {
  if (!app.workspaceRoot) return;
  const version = envVersionSelectEl.value;
  const btn = $btn("env-create");
  const cmdDesc = `uv venv .venv${version ? " --python " + version : ""}  (${app.workspaceRoot})`;
  appendOutputLine(outputEl, `> ${cmdDesc}`, "cmd", gotoFromLink);
  setBusy(btn, true, "创建中…");
  try {
    const r = await invoke<CreateVenvResult>("create_venv", { workspaceRoot: app.workspaceRoot, version });
    if (r.output) appendOutputLine(outputEl, r.output, "stdout", gotoFromLink);
    // 直接以创建出的解释器路径持久化选中（不依赖 .venv 自动检测）
    if (r.python) {
      await invoke("set_interpreter", { workspaceRoot: app.workspaceRoot, path: r.python }).catch((e) => toastFail("设置解释器", e));
    }
  } catch (e) {
    appendOutputLine(outputEl, `创建环境失败：${e}`, "stderr", gotoFromLink);
    setBusy(btn, false);
    return;
  }
  await refreshInterpreterStatus();
  await renderEnvPanel();
  setBusy(btn, false);
}

async function installPackage(): Promise<void> {
  const spec = envPkgInputEl.value.trim();
  if (!spec || !currentInterpreter) return;
  const btn = $btn("env-pkg-install");
  appendOutputLine(outputEl, `> uv pip install ${spec}  (${currentInterpreter})`, "cmd", gotoFromLink);
  setBusy(btn, true, "安装中…");
  try {
    const code = await invoke<number>("pip_install", { workspaceRoot: app.workspaceRoot, interpreter: currentInterpreter, spec });
    console.debug(`[opencharm-install] 环境面板安装结束 code=${code} spec=${spec}`);
    if (code !== 0) appendOutputLine(outputEl, `安装失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `安装失败：${e}`, "stderr", gotoFromLink);
  }
  envPkgInputEl.value = "";
  setBusy(btn, false);
  await renderPackages();
}

/** 卸载指定包（列表勾选批量卸载或单行卸载复用同一入口） */
async function uninstallPackages(names: string[]): Promise<void> {
  const list = names.filter(Boolean);
  if (list.length === 0 || !currentInterpreter) return;
  const proceed = await openConfirm({
    title: "卸载包",
    message: `卸载 ${list.length} 个包：${list.join("、")}？`,
    okLabel: "卸载", cancelLabel: "取消", kind: "danger",
  });
  if (!proceed) return;
  const btn = $btn("env-pkg-uninstall-selected");
  appendOutputLine(outputEl, `> uv pip uninstall ${list.join(" ")}  (${currentInterpreter})`, "cmd", gotoFromLink);
  setBusy(btn, true, "卸载中…");
  try {
    const out = await invoke<string>("pip_uninstall", { interpreter: currentInterpreter, name: list.join(" ") });
    if (out) appendOutputLine(outputEl, out, "stdout", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `卸载失败：${e}`, "stderr", gotoFromLink);
  }
  selectedPkgs.clear();
  setBusy(btn, false);
  await renderPackages();
}

async function uninstallSelectedPackages(): Promise<void> {
  await uninstallPackages([...selectedPkgs]);
}

/** 单个包升级（行内箭头） */
async function upgradePackage(name: string): Promise<void> {
  await upgradePackages([name]);
}

/** 升级全部过时包 */
async function upgradeAllPackages(): Promise<void> {
  if (!currentInterpreter || outdatedPackages.size === 0) return;
  const names = [...outdatedPackages.keys()];
  const proceed = await openConfirm({
    title: "升级包",
    message: `升级 ${names.length} 个过时包？`,
    okLabel: "升级", cancelLabel: "取消", kind: "primary",
  });
  if (!proceed) return;
  await upgradePackages(names);
}

async function upgradePackages(names: string[]): Promise<void> {
  const list = names.filter(Boolean);
  if (list.length === 0 || !currentInterpreter) return;
  const btn = envPkgUpgradeAllBtn;
  appendOutputLine(outputEl, `> uv pip install --upgrade ${list.join(" ")}  (${currentInterpreter})`, "cmd", gotoFromLink);
  setBusy(btn, true, "升级中…");
  try {
    const code = await invoke<number>("pip_upgrade", { interpreter: currentInterpreter, names: list });
    if (code !== 0) appendOutputLine(outputEl, `升级失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
  } catch (e) {
    appendOutputLine(outputEl, `升级失败：${e}`, "stderr", gotoFromLink);
  }
  setBusy(btn, false);
  await renderPackages();
}

// ---------- 灯泡「安装 X」（CodeAction 命令回调） ----------

/** import 名 → PyPI 包名映射（少数两者不一致时用；其余按顶层模块名原样安装） */
const PACKAGE_ALIASES: Record<string, string> = {
  PIL: "Pillow",
  cv2: "opencv-python",
  sklearn: "scikit-learn",
  yaml: "PyYAML",
  dotenv: "python-dotenv",
  bs4: "beautifulsoup4",
  Crypto: "pycryptodome",
};

/**
 * 灯泡「安装 X」动作的回调（借鉴 PyCharm）：先询问确认，再 uv pip install 到当前解释器，
 * 输出经 pip-stdout / pip-stderr 事件实时滚动到输出面板，装完重启静态引擎刷新诊断。
 */
export async function installMissingPackage(pkg: string): Promise<void> {
  if (!app.workspaceRoot) return;
  const spec = PACKAGE_ALIASES[pkg] ?? pkg.trim();
  if (!spec) return;
  console.debug(`[opencharm-install] 请求安装 pkg=${pkg} spec=${spec}`);
  if (!currentInterpreter) {
    console.debug("[opencharm-install] 未选择解释器，中止");
    appendOutputLine(outputEl, "尚未选择解释器，无法自动安装包（点状态栏解释器图标选择后再试）", "stderr", gotoFromLink);
    return;
  }
  // 询问确认（对照 PyCharm 的安装确认框）
  const proceed = await openConfirm({
    title: "安装包",
    message: `将安装 "${spec}" 到当前解释器：\n${currentInterpreter}\n\n是否继续？`,
    okLabel: "安装", cancelLabel: "取消", kind: "primary",
  });
  console.debug(`[opencharm-install] 确认结果=${proceed}`);
  if (!proceed) {
    appendOutputLine(outputEl, `已取消安装 ${spec}`, "stderr", gotoFromLink);
    return;
  }

  appendOutputLine(outputEl, `> uv pip install ${spec}  (${shortInterpreter(currentInterpreter)})`, "cmd", gotoFromLink);
  console.debug("[opencharm-install] 开始 pip_install invoke");
  try {
    const code = await invoke<number>("pip_install", { workspaceRoot: app.workspaceRoot, interpreter: currentInterpreter, spec });
    console.debug(`[opencharm-install] pip_install 结束 code=${code}`);
    if (code === 0) {
      appendOutputLine(outputEl, `已安装 ${spec}，重新检查诊断…`, "stdout", gotoFromLink);
      await restartEngine();
    } else {
      appendOutputLine(outputEl, `安装失败（exit ${code}），详见上方输出`, "stderr", gotoFromLink);
    }
  } catch (e) {
    console.debug("[opencharm-install] 安装异常:", e);
    appendOutputLine(outputEl, `安装失败：${e}`, "stderr", gotoFromLink);
  }
}

// ---------- 首启引导 ----------

/** 首次打开工作区时提示检测到的 .venv（§4.2 优先级） */
export async function maybePromptVenv(): Promise<void> {
  if (!app.workspaceRoot || venvPrompted.has(app.workspaceRoot)) return;
  venvPrompted.add(app.workspaceRoot);
  let pythons: PythonInfo[] = [];
  try {
    pythons = await invoke<PythonInfo[]>("list_pythons", { workspaceRoot: app.workspaceRoot });
  } catch {
    return;
  }
  const venv = pythons.find((p) => p.kind === "workspace-venv");
  if (!venv || venv.is_selected) return; // 无 .venv 或已显式选中则跳过
  if (await openConfirm({ message: "检测到工作区 .venv，是否设为当前解释器？", kind: "primary" })) {
    await invoke("set_interpreter", { workspaceRoot: app.workspaceRoot, path: venv.path }).catch((e) => toastFail("设置解释器", e));
    await refreshInterpreterStatus();
  }
}

/** 首次启动环境引导（Phase 4 第 4 步）：探测 uv / 静态引擎，缺失则引导一键安装 */
export async function maybePromptToolchain(): Promise<void> {
  try {
    const engine = app.settings.lsp_engine ?? "pyrefly";
    const st = await toolchain.detectToolchain(engine);
    if (st.allOk) return;
    const missing: string[] = [];
    if (!st.uv) missing.push("uv（Python 环境与运行）");
    if (!st.engine.ok) missing.push(`${st.engine.name}（补全 / 跳转）`);
    const proceed = await openConfirm({
      title: "环境引导",
      message: `检测到缺少以下工具：\n\n${missing.map((m) => `· ${m}`).join("\n")}\n\n补全、跳转与运行都需要它们。可一键下载安装到用户目录（不影响系统，需联网）。\n\n是否现在安装？`,
      okLabel: "立即安装",
      cancelLabel: "稍后",
      kind: "primary",
    });
    if (!proceed) return;
    // 展开底部输出面板，展示安装进度
    $("bottom").classList.remove("collapsed");
    appendOutputLine(outputEl, `> 工具链引导：安装 ${missing.join("、")}`, "cmd", gotoFromLink);
    const ok = await toolchain.installToolchain(engine);
    appendOutputLine(
      outputEl,
      ok ? "工具链就绪。" : "安装结束，但部分工具仍不可见，请重启 OpenCharm 后再试。",
      ok ? "stdout" : "stderr",
      gotoFromLink,
    );
  } catch (e) {
    console.warn("[toolchain] 探测失败，跳过引导:", e);
  }
}

// ---------- 接线 ----------

/** 环境面板 DOM 接线（main 的 init 调用）；restartEngine = startLsp（装完包重启引擎刷诊断） */
export function initEnvPanel(deps: { restartEngine: () => Promise<void> }): void {
  restartEngine = deps.restartEngine;
  // 环境面板（P25-T05）——状态栏解释器点击打开
  statusInterpreterEl.addEventListener("click", () => void openEnvPanel());
  // 状态栏芯片语义（第七批）：解释器芯片补了 role=button + tabindex，键盘 Enter/Space 亦可打开（对齐 engineChip）
  statusInterpreterEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void openEnvPanel();
    }
  });
  $btn("env-close").addEventListener("click", closeEnvPanel);
  $btn("env-create").addEventListener("click", createVenv);
  $btn("env-pkg-install").addEventListener("click", installPackage);
  $btn("env-pkg-uninstall-selected").addEventListener("click", () => uninstallSelectedPackages());
  $btn("env-pkg-upgrade-all").addEventListener("click", () => upgradeAllPackages());
  envPyprojectInitBtn.addEventListener("click", () => void generatePyproject());
  envModalEl.addEventListener("click", (e) => {
    if (e.target === envModalEl) closeEnvPanel();
  });
}

/** 环境域事件流接线：pip 与 toolchain 的流式输出（原 main init 内的四个 listen） */
export async function initEnvPanelEvents(): Promise<void> {
  // 包安装事件（流式输出，确认安装后由 pip_install 逐行推送）
  await listen<{ data: string }>("pip-stdout", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  });
  await listen<{ data: string }>("pip-stderr", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stderr", gotoFromLink);
  });
  // 工具链引导事件（Phase 4 第 4 步：uv/pyrefly 安装进度流式输出）
  await listen<{ data: string }>("toolchain-stdout", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stdout", gotoFromLink);
  });
  await listen<{ data: string }>("toolchain-stderr", (e) => {
    for (const line of e.payload.data.split("\n")) if (line) appendOutputLine(outputEl, line, "stderr", gotoFromLink);
  });
}
