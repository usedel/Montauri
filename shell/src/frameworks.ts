// 框架探针表（P1）TS 侧：Rust `detect_framework` 返回结构的镜像 + 纯函数助手。
// 规则表本体在 Rust（`env_cmds.rs`，纯文件扫描）——前端只负责**提示文案**与
// 「项目配置是否已等于该预设」的判定，两个助手都是纯函数，可脱离 DOM 单测
// （见 `__tests__/frameworks.test.ts`）。
// 依据：`docs/pycharm_framework_support_report.md` §8.2 P1（探针表 + 工作区级关闭开关）。

export type FrameworkKind = "django" | "flask" | "fastapi";

/** Rust `FrameworkPreset` 的镜像（字段一一对应，字段名随 Rust 走） */
export interface FrameworkPreset {
  framework: FrameworkKind;
  label: string;
  /** 命中的声明文件（相对工作区根，如 "manage.py" / "app/main.py"） */
  file: string;
  entry: { kind: "script" | "module"; target: string };
  args: string;
  cwd: string;
  /** 回显摘要（如 "-m uvicorn main:app --reload"） */
  summary: string;
  /** 依赖声明中未见的服务依赖（如 uvicorn / django）；仅提示，不代装 */
  missing: string[];
}

/** 展示名（后端已带 label；缺失时按 kind 回退，保证 UI 不出现空串） */
export function frameworkLabel(p: FrameworkPreset): string {
  return p.label || p.framework;
}

/** 输出面板提示行正文（不含可点击链接）：缺失依赖单独成句提示可安装 */
export function frameworkHintText(p: FrameworkPreset): string {
  const miss =
    p.missing.length > 0 ? `尚未安装 ${p.missing.join("、")}（可 uv add ${p.missing[0]}）。` : "";
  return `检测到 ${frameworkLabel(p)} 项目（${p.file}）。${miss}可一键生成运行配置：`;
}

/** 项目运行配置是否已等于该预设（已配置则不提示——「不打扰」纪律，同 P0-E FastAPI 口径）。
 *  只比入口（kind + target）：args 允许用户在配置面板里自行加参数，不算「已改走别的入口」。 */
export function presetConfigured(
  current: { entry?: { kind?: string; target?: string } } | null | undefined,
  p: FrameworkPreset,
): boolean {
  const e = current?.entry;
  if (!e) return false;
  return (
    e.kind === p.entry.kind && (e.target ?? "").trim().toLowerCase() === p.entry.target.trim().toLowerCase()
  );
}

// ---------- F0 裁决 B：Pydantic 栈的引擎推荐（纯函数部分） ----------
// 依据：bench/reports/pydantic-engine-probe.md——pyrefly 缺「类型检查 / 缺失必填 / 改名传播」，
// basedpyright 覆盖 4/6；仅当用户还在 pyrefly 上时才值得提示（已在 basedpyright 则无意义）。

/** 是否应提示「推荐切到 basedpyright」：仅当当前引擎还是 pyrefly（含缺省回退） */
export function shouldSuggestPydanticEngine(currentEngine: string | undefined): boolean {
  return (currentEngine || "pyrefly") === "pyrefly";
}

/** 提示行正文（不含可点击链接） */
export function pydanticEngineHintText(): string {
  return (
    "检测到 Pydantic 栈（pydantic/fastapi）。当前引擎 pyrefly 对 Pydantic 缺少请求体校验红线" +
    "与字段改名传播（实测见 bench/reports/pydantic-engine-probe.md），推荐切换到 basedpyright："
  );
}

// ---------- F1：端点路由合并（纯函数；Rust 侧同款语义见 fs_cmds::ep_join_route） ----------

/** 路由段合并：两端斜杠归一 + 空段跳过；全空 → "/"。
 *  支持把 FastAPI `{id}` / Flask `<int:id>` 路径参数原样保留。 */
export function joinRoute(...parts: Array<string | undefined | null>): string {
  const segs = parts
    .map((p) => (p ?? "").trim().replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0);
  return segs.length > 0 ? `/${segs.join("/")}` : "/";
}

/** base（origin）+ 路由 → 完整 URL；base 为空返回 null（无运行中的服务） */
export function fullEndpointUrl(base: string | null, route: string): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${joinRoute(route)}`;
}
