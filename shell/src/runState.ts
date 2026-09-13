// 运行态单一真值（TD-14 ①）：原 main.ts 的 6 个运行态模块级变量
// （running / runningPath / runChannel / runningStdinMode / runningStdinEofHinted / selectionRunMeta，
//  外加 P2-N 的 runningProfile）收敛为一个 discriminated union RunState，
// 杜绝「running=false 但 runningPath / selectionRunMeta 残留」这类半复位态——
// 任何字段都只在 phase:"running" 的分支里存在，置回 idle 即整组作废。
// 本模块零依赖（纯状态 + 纯函数），与 gitStatusState 同层级；
// 运行流程（runFlow.ts）经 getRunState/setRunState 与下方访问器读写。
//
// 说明：CR-07 的准备期闸门 runPreparing 不并入——它是「进入运行态之前」的并发防线，
// 生命周期与 RunState 正交（prepareRun 取消/失败时释放闸门但从不产生运行态），归 runFlow 私有。

// ---------- 运行配置类型（与后端 RunProfile serde 对齐；P0-C/D 起） ----------

/** 环境变量（运行配置 env 列表元素） */
export interface EnvVar { key: string; value: string }

/** stdin 来源：
 * - "null" 不接输入（input() 立即 EOF）——P0-A 起为**显式**选择档，不再缺省
 * - "file" 重定向自文件（S1，可复现）
 * - "interactive" 输出面板交互（S4，用户在输入行逐行应答）——P0-A 起为**默认**
 *   （对齐 PyCharm 控制台默认可输入；「piped 无人写入会永久阻塞」由输入行 +
 *   「等待输入…」状态 + stopRun 先 drop stdin 兜住） */
export type StdinMode = "null" | "file" | "interactive";
export interface StdinConfig { mode: StdinMode; path: string }

/** 运行入口（P0-C）：脚本路径 / 模块名（= python -m）二选一，对齐 PyCharm */
export interface RunEntry { kind: "script" | "module"; target: string }

/** 运行配置（P0-C/D，与后端 RunProfile 对齐）：命名配置列表 + 「当前文件」视角共用 */
export interface RunConfig {
  name: string;
  entry: RunEntry;
  args: string;
  /** P0-D：支持 ${workspaceRoot} / $PROJECT_DIR$ 宏；空 = 默认（script→脚本目录，module→工作区根） */
  cwd: string;
  env: EnvVar[];
  /** P1-G：.env 文件（有序，相对工作区根）；注入位置 = 默认注入之后、用户显式 env 之前 */
  env_files: string[];
  stdin: StdinConfig;
  /** P1-I：配置级解释器覆盖；空 = 沿用工作区解释器 */
  interpreter: string;
  /** P1-H：允许多实例（槽被占时再启动一个实例，stdin 恒 null） */
  allow_multiple: boolean;
  /** P1-K：启动前先运行的命名配置（等待其结束后再启动本配置；空 = 无） */
  pre_run_profile: string;
  /** P1-K：主运行 spawn 成功后用系统浏览器打开的 URL（空 = 不打开） */
  open_browser_url: string;
  /** P2-N：保存的源文件变更时自动停止并重启（Rerun automatically；module 入口不适用） */
  auto_rerun: boolean;
  /** P2-Q：解释器加 -i，脚本跑完留在同一交互 REPL（stdin 强制交互式） */
  python_console: boolean;
  /** PyCharm 临时配置：由「跑文件」自动落盘生成（上限 5，超出淘汰最旧）；
   *  在配置页显式保存即升格为永久配置（Save Configuration）。持久化在工作区配置里。 */
  temporary: boolean;
}

/** 缺省运行配置（与后端 RunProfile::default 一致，P0-A：stdin 默认 interactive） */
export const EMPTY_RUN_CONFIG: RunConfig = {
  name: "",
  entry: { kind: "script", target: "" },
  args: "",
  cwd: "",
  env: [],
  env_files: [],
  stdin: { mode: "interactive", path: "" },
  interpreter: "",
  allow_multiple: false,
  pre_run_profile: "",
  open_browser_url: "",
  auto_rerun: false,
  python_console: false,
  temporary: false,
};

/** 归一化后端返回的运行配置（防御缺字段；与 RunProfile serde default 同口径） */
export function normalizeRunConfig(raw: Partial<RunConfig> | undefined | null, fallbackName = ""): RunConfig {
  return {
    name: raw?.name ?? fallbackName,
    entry: { kind: raw?.entry?.kind === "module" ? "module" : "script", target: raw?.entry?.target ?? "" },
    args: raw?.args ?? "",
    cwd: raw?.cwd ?? "",
    env: raw?.env ?? [],
    env_files: raw?.env_files ?? [],
    stdin: { mode: (raw?.stdin?.mode as StdinMode) ?? "interactive", path: raw?.stdin?.path ?? "" },
    interpreter: raw?.interpreter ?? "",
    allow_multiple: raw?.allow_multiple === true,
    pre_run_profile: raw?.pre_run_profile ?? "",
    open_browser_url: raw?.open_browser_url ?? "",
    auto_rerun: raw?.auto_rerun === true,
    python_console: raw?.python_console === true,
    temporary: raw?.temporary === true,
  };
}

/** 归一化后端返回的 stdin 模式：与后端 `StdinConfig::effective_mode()` 同口径
 * （选了 file 却没给路径 → 视作 null；未知/存量异常值 → null，与后端归一化一致） */
export function stdinModeOf(rc: Partial<RunConfig> | undefined): StdinMode {
  const m = rc?.stdin?.mode;
  if (m === "file") return rc?.stdin?.path?.trim() ? "file" : "null";
  return m === "interactive" ? "interactive" : "null";
}

// ---------- RunState（TD-14 ① 判别联合） ----------

/** 选区运行的元信息：临时文件路径 → 源文件 + 起始行（traceback 跳转映射用） */
export interface SelectionRunMeta {
  tempPath: string;
  sourcePath: string;
  startLine: number;
}

/** 统一运行态（S3/S4 统一运行态模型 §4.7 结论 3 + TD-14 ①）：
 * idle 时所有运行期字段都不存在；进入 running 时整组置位，复位（resetRunState）整组作废。
 * - channel：本次运行走哪条路径（输出面板 / 运行终端），停止按钮按此路由 stop_script / term_kill
 * - path：正在运行的文件（用于 tab 停止图标；null = module 入口的命名配置运行，无文件锚点）
 * - stdinMode：S2 EOF 归因 + S4 输入行可见性
 * - eofHinted：一次运行只提示一次 EOF 归因，避免多行 EOFError 刷屏（运行中可变）
 * - selection：选区运行临时文件映射（run-exit / 停止 / 失败全路径统一清理）
 * - profile：P2-N auto_rerun 判定依据（文件运行为 prepareRun 归一化配置） */
export type RunState =
  | { phase: "idle" }
  | {
      phase: "running";
      channel: "output" | "terminal";
      path: string | null;
      stdinMode: StdinMode;
      eofHinted: boolean;
      selection: SelectionRunMeta | null;
      profile: RunConfig | null;
    };

let runState: RunState = { phase: "idle" };

export function getRunState(): RunState {
  return runState;
}

export function setRunState(next: RunState): void {
  runState = next;
}

/** 是否有运行进行中（不含准备期；准备期闸门见 runFlow 的 isRunBusy） */
export function isRunning(): boolean {
  return runState.phase === "running";
}

/** 本次运行的通道（idle 时 null）；停止动作按此路由 */
export function runChannelOf(): "output" | "terminal" | null {
  return runState.phase === "running" ? runState.channel : null;
}

/** 正在运行的文件路径（idle 或 module 入口运行时 null）；tab 停止图标判定用 */
export function runningPathOf(): string | null {
  return runState.phase === "running" ? runState.path : null;
}

/** 本次运行的 stdin 模式（idle 时 "null" 口径） */
export function runningStdinModeOf(): StdinMode {
  return runState.phase === "running" ? runState.stdinMode : "null";
}

/** 选区运行元信息（traceback 跳转映射；非选区运行或 idle 时 null） */
export function selectionMetaOf(): SelectionRunMeta | null {
  return runState.phase === "running" ? runState.selection : null;
}

// ---------- 运行目标（粘性，PyCharm「Run 部件 = 选中的配置」语义） ----------

/**
 * ▶ 的运行目标：**脚本文件** 或 **命名运行配置** 二选一。
 *
 * 与 RunState 的区别：RunState 描述"此刻正在跑什么"（idle 即整组作废），
 * 而运行目标描述"▶ 下次会跑什么"——**运行结束后仍然保留**，只有显式操作才会改变它：
 *   ① 标签右键 →「运行」/「在终端中运行」；② gutter ▶；③ ▸ 菜单选命名配置 / 命令面板「运行当前文件」。
 * 单纯**切换打开的文件不改变目标**（对齐 PyCharm；此前 ▶ 恒等于活动文件，见
 * `docs/python_run_dev_plan.md` §4）。
 * 无目标时（首次运行 / 新工作区）▶ 回落当前文件。
 */
export type RunTarget =
  | { kind: "file"; path: string }
  | { kind: "profile"; name: string };

/** 目标与上次所用通道的绑定记录（▶ 重跑沿用同一通道） */
export interface RunTargetRecord {
  target: RunTarget;
  channel: "output" | "terminal";
}

/**
 * 目标的显示名（运行部件 tooltip 用）：命名配置附加「（配置）」来源标识，
 * 以便与"跑某个文件"区分。`baseName` 由调用方注入以保持本模块零依赖。
 */
export function displayTargetName(t: RunTarget, baseName: (path: string) => string): string {
  return t.kind === "profile" ? `${t.name}（配置）` : baseName(t.path);
}
