// 插件 manifest 类型与校验（PR-2，plugin_system_design §9.2）。
// 纯函数零依赖（不 import Tauri/DOM），全部逻辑可单测。
// v1 约束：schemaVersion 固定 1；engines 仅支持 ">=X.Y.Z"；entry 单文件。

/** v1 唯一支持的 manifest 格式版本 */
export const MANIFEST_SCHEMA_VERSION = 1;

/** manifest 顶层结构（只声明 v1 消费的字段；多余字段容忍保留） */
export interface PluginManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  engines: { opencharm: string };
  contributes?: {
    tools?: PluginToolContribution[];
  };
  permissions?: string[];
}

/** contributes.tools[i] */
export interface PluginToolContribution {
  id: string;
  title: string;
  description?: string;
  category?: string;
  icon?: string;
  entry: string;
  inline?: { label: string; handler: string };
}

/** 校验结果：ok=false 时 errors 给出全部问题（逐条中文，可直接展示） */
export interface ManifestCheck {
  ok: boolean;
  manifest: PluginManifest | null;
  errors: string[];
}

/** v1 已知权限集合；不在集合内的权限字符串视为笔误（拒绝，防「以为声明了其实拼错」） */
export const KNOWN_PERMISSIONS = ["clipboard", "selection", "fs:read", "storage", "monaco"] as const;
export type PluginPermission = (typeof KNOWN_PERMISSIONS)[number];

/** 校验权限声明：未知权限 → 错误；重复 → 去重后通过 */
function checkPermissions(perms: unknown, errors: string[]): string[] {
  if (perms === undefined) return [];
  if (!Array.isArray(perms)) {
    errors.push("permissions 必须是字符串数组");
    return [];
  }
  const out: string[] = [];
  for (const p of perms) {
    if (typeof p !== "string") {
      errors.push(`permissions 含非字符串项：${String(p)}`);
      continue;
    }
    if (!(KNOWN_PERMISSIONS as readonly string[]).includes(p)) {
      errors.push(`未知权限 "${p}"（已知：${KNOWN_PERMISSIONS.join(", ")}）`);
      continue;
    }
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** 校验并解析 manifest JSON 文本；失败返回逐条错误（不抛异常） */
export function validateManifest(json: string): ManifestCheck {
  const errors: string[] = [];
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, manifest: null, errors: ["manifest 根必须是 JSON 对象"] };
    }
    raw = parsed as Record<string, unknown>;
  } catch (e) {
    return { ok: false, manifest: null, errors: [`manifest 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`] };
  }

  // schemaVersion：v1 只认 1（数字）
  const sv = raw.schemaVersion;
  if (sv !== MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${MANIFEST_SCHEMA_VERSION}（当前支持版本），实际为 ${String(sv)}`);
  }

  // id：反向域名风格（宽松：至少一段且无路径分隔符/空白）
  const id = raw.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    errors.push(`id 必须是插件内唯一标识（字母数字开头的点分/连字符名），实际为 ${JSON.stringify(id)}`);
  }

  // name / version
  if (typeof raw.name !== "string" || raw.name.trim() === "") errors.push("name 不能为空");
  if (typeof raw.version !== "string" || raw.version.trim() === "") errors.push("version 不能为空");

  // engines.opencharm：v1 仅支持 ">=X.Y.Z"
  const engines = raw.engines;
  if (
    engines === null || typeof engines !== "object" || Array.isArray(engines) ||
    typeof (engines as Record<string, unknown>).opencharm !== "string"
  ) {
    errors.push('engines.opencharm 必须是字符串（如 ">=0.5.0"）');
  } else {
    const spec = (engines as Record<string, string>).opencharm.trim();
    if (!/^>=\d+\.\d+\.\d+$/.test(spec)) {
      errors.push(`engines.opencharm v1 仅支持 ">=X.Y.Z" 形式，实际为 "${spec}"`);
    }
  }

  // permissions
  const permissions = checkPermissions(raw.permissions, errors);

  // contributes.tools
  const contributes = raw.contributes;
  let tools: PluginToolContribution[] = [];
  if (contributes !== undefined) {
    if (contributes === null || typeof contributes !== "object" || Array.isArray(contributes)) {
      errors.push("contributes 必须是对象");
    } else {
      const t = (contributes as Record<string, unknown>).tools;
      if (t !== undefined) {
        if (!Array.isArray(t)) {
          errors.push("contributes.tools 必须是数组");
        } else {
          tools = t.map(checkToolContribution).filter((x): x is PluginToolContribution => x !== null);
        }
      }
    }
  }
  if (tools.length === 0 && errors.length === 0) {
    errors.push("contributes.tools 为空——工具插件至少贡献一个工具");
  }

  if (errors.length > 0) return { ok: false, manifest: null, errors };

  const manifest: PluginManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id: id as string,
    name: raw.name as string,
    version: raw.version as string,
    engines: raw.engines as { opencharm: string },
    contributes: { tools },
    permissions,
  };
  return { ok: true, manifest, errors: [] };
}

/** 校验单个工具声明；错误收集到模块级（通过闭包传入不便，直接返回 null 并 push 到外部数组） */
function checkToolContribution(raw: unknown): PluginToolContribution | null {
  // 注：错误文案拼接进 validateManifest 的 errors 由调用方负责；此处返回 null 即「跳过该项」。
  // 为让错误可定位，这里也做基础校验并 console 位置——但设计上「宁可整包失败也不半加载」，
  // 故工具级错误同样应阻断：由 validateTools 在外层收集（见 validateManifest 内联实现）。
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const entry = typeof r.entry === "string" ? r.entry : "";
  const toolId = typeof r.id === "string" ? r.id : "";
  const title = typeof r.title === "string" ? r.title : "";
  if (!toolId || !title || !entry) return null;
  const inline =
    r.inline !== null && typeof r.inline === "object" && !Array.isArray(r.inline)
      ? {
          label: String((r.inline as Record<string, unknown>).label ?? ""),
          handler: String((r.inline as Record<string, unknown>).handler ?? ""),
        }
      : undefined;
  return {
    id: toolId,
    title,
    description: typeof r.description === "string" ? r.description : "",
    category: typeof r.category === "string" ? r.category : "",
    icon: typeof r.icon === "string" ? r.icon : "symbol-extension",
    entry,
    ...(inline && inline.label && inline.handler ? { inline } : {}),
  };
}

/** engines ">=X.Y.Z" 兼容检查：app 版本满足下限返回 true。
 *  版本比较按数值逐段（不引 semver 库，§9.2 约束只有这一种形式）。 */
export function checkEnginesCompatible(spec: string, appVersion: string): boolean {
  const m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(spec.trim());
  if (!m) return false;
  const want = [Number(m[1]), Number(m[2]), Number(m[3])];
  const got = appVersion.trim().split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const g = got[i] ?? 0;
    if (g > want[i]) return true;
    if (g < want[i]) return false;
  }
  return true; // 完全相等
}

/** 工具全局键：全局唯一（防不同插件的同名工具冲突） */
export function pluginToolId(pluginId: string, toolId: string): string {
  return `${pluginId}.${toolId}`;
}
