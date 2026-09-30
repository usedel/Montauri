// 内置工具插件（PR-3，plugin_system_design §9.7 dogfooding）：
// 内置工具以「内联 manifest + 构建时静态 import 的工具模块」形态走与第三方完全相同的
// 加载路径（loader.registerBuiltinPlugin → 注册表），registry/菜单/picker 不区分来源。
//
// 与第三方差异（有意为之）：
// - entry 是静态 import（打包产物，无 Blob URL / 热重载）；
// - manifest 为 TS 对象（类型 = PluginManifest），构建期即校验；
// - 权限默认授予（随应用分发，已在信任边界内）。

import type { PluginManifest } from "../../extensions/manifest";
import * as curl2python from "./curl2python";
import * as jsonpath from "./jsonpath";
import * as base64 from "./base64";
import * as urlcode from "./urlcode";
import * as hash from "./hash";
import * as jsonfmt from "./jsonfmt";
import * as timestamp from "./timestamp";
import * as uuid from "./uuid";
import * as regex from "./regex";
import * as format from "./format";
import * as json2model from "./json2model";
// v1.1 批次（2026-09-30）
import * as radix from "./radix";
import * as htmlentity from "./htmlentity";
import * as unicode from "./unicode";
import * as caseconvert from "./caseconvert";
import * as wordcount from "./wordcount";
import * as sortlines from "./sortlines";
import * as color from "./color";
import * as password from "./password";
import * as textdiff from "./textdiff";

/** 内置工具模块表：entry 名 → 模块（对应第三方 manifest 的 entry 文件） */
export const BUILTIN_TOOL_MODULES: Record<string, ToolModuleLike> = {
  "./curl2python.ts": curl2python as ToolModuleLike,
  "./jsonpath.ts": jsonpath as ToolModuleLike,
  "./base64.ts": base64 as ToolModuleLike,
  "./urlcode.ts": urlcode as ToolModuleLike,
  "./hash.ts": hash as ToolModuleLike,
  "./jsonfmt.ts": jsonfmt as ToolModuleLike,
  "./timestamp.ts": timestamp as ToolModuleLike,
  "./uuid.ts": uuid as ToolModuleLike,
  "./regex.ts": regex as ToolModuleLike,
  "./format.ts": format as ToolModuleLike,
  "./json2model.ts": json2model as ToolModuleLike,
  // v1.1 批次
  "./radix.ts": radix as ToolModuleLike,
  "./htmlentity.ts": htmlentity as ToolModuleLike,
  "./unicode.ts": unicode as ToolModuleLike,
  "./caseconvert.ts": caseconvert as ToolModuleLike,
  "./wordcount.ts": wordcount as ToolModuleLike,
  "./sortlines.ts": sortlines as ToolModuleLike,
  "./color.ts": color as ToolModuleLike,
  "./password.ts": password as ToolModuleLike,
  "./textdiff.ts": textdiff as ToolModuleLike,
};

/** 工具模块契约（与第三方 ES module 导出同形；见 loader.ToolModule） */
export interface ToolModuleLike {
  mount?: (host: never) => unknown;
  [handler: string]: unknown;
}

/** 内置插件 manifest（字段与磁盘版同构；id 固定 opencharm.builtin） */
export const BUILTIN_MANIFEST: PluginManifest = {
  schemaVersion: 1,
  id: "opencharm.builtin",
  name: "内置工具",
  version: "1.0.0",
  engines: { opencharm: ">=0.1.0" },
  contributes: {
    tools: [
      {
        id: "base64",
        title: "Base64 编码/解码",
        description: "文本与 Base64 互转（UTF-8 安全）",
        category: "编码",
        icon: "key",
        entry: "./base64.ts",
        inline: { label: "Base64 编码选区", handler: "encodeSelection" },
      },
      {
        id: "urlcode",
        title: "URL 编码/解码",
        description: "encodeURIComponent / decodeURIComponent 互转",
        category: "编码",
        icon: "link",
        entry: "./urlcode.ts",
        inline: { label: "URL 编码选区", handler: "encodeSelection" },
      },
      {
        id: "hash",
        title: "MD5 / SHA-256",
        description: "计算文本哈希（大写/小写可切）",
        category: "哈希",
        icon: "lock",
        entry: "./hash.ts",
        inline: { label: "MD5 选区", handler: "md5Selection" },
      },
      {
        id: "jsonfmt",
        title: "JSON 美化/压缩",
        description: "格式化（缩进可调）或压缩 JSON",
        category: "格式化",
        icon: "json",
        entry: "./jsonfmt.ts",
      },
      {
        id: "curl2python",
        title: "cURL ⇄ Python",
        description: "curl 命令与 requests / httpx 代码互转（双向）",
        category: "转换",
        icon: "terminal",
        entry: "./curl2python.ts",
      },
      {
        id: "timestamp",
        title: "时间戳转换",
        description: "Unix 时间戳 ⇄ 可读时间",
        category: "转换",
        icon: "watch",
        entry: "./timestamp.ts",
        inline: { label: "时间戳转可读时间", handler: "tsToReadable" },
      },
      {
        id: "uuid",
        title: "UUID 生成",
        description: "生成 v4 UUID（可批量）",
        category: "生成",
        icon: "symbol-numeric",
        entry: "./uuid.ts",
      },
      {
        id: "jsonpath",
        title: "JSONPath 提取器",
        description: "JSON 树状浏览，点击节点复制其路径",
        category: "提取",
        icon: "json",
        entry: "./jsonpath.ts",
      },
      {
        id: "regex",
        title: "正则测试器",
        description: "真实 re 引擎下验证正则：匹配 / 替换 / 分组 / flags",
        category: "文本",
        icon: "regex",
        entry: "./regex.ts",
      },
      {
        id: "format",
        title: "格式串预览",
        description: "strftime / 数字格式规范 / logging 格式串预览与速查",
        category: "文本",
        icon: "calendar",
        entry: "./format.ts",
      },
      {
        id: "json2model",
        title: "JSON → Python 模型",
        description: "由 JSON 生成 Pydantic / dataclass / TypedDict 模型类",
        category: "生成",
        icon: "json",
        entry: "./json2model.ts",
      },
      // ---------- v1.1 批次（2026-09-30，原 §9.7 备选清单） ----------
      {
        id: "radix",
        title: "进制转换",
        description: "0x/0b/0o/十进制互转（BigInt 精度无损）",
        category: "转换",
        icon: "symbol-numeric",
        entry: "./radix.ts",
        inline: { label: "数字转十六进制", handler: "toHexSelection" },
      },
      {
        id: "htmlentity",
        title: "HTML 实体编码/解码",
        description: "命名实体与数字实体互转",
        category: "编码",
        icon: "code",
        entry: "./htmlentity.ts",
        inline: { label: "HTML 实体编码选区", handler: "encodeSelection" },
      },
      {
        id: "unicode",
        title: "Unicode ⇄ 明文",
        description: "\\uXXXX 转义串与明文互转（含代理对合并）",
        category: "转换",
        icon: "whole-word",
        entry: "./unicode.ts",
        inline: { label: "Unicode 转义还原选区", handler: "unescapeSelection" },
      },
      {
        id: "caseconvert",
        title: "大小写/命名风格",
        description: "UPPER / lower / Title / snake_case / camelCase",
        category: "文本",
        icon: "case-sensitive",
        entry: "./caseconvert.ts",
        inline: { label: "英文转大写", handler: "upperSelection" },
      },
      {
        id: "wordcount",
        title: "字数统计",
        description: "字符 / 词 / CJK 字数 / 行数实时统计",
        category: "文本",
        icon: "symbol-keyword",
        entry: "./wordcount.ts",
      },
      {
        id: "sortlines",
        title: "行排序去重",
        description: "升/降/倒置/洗牌 × 去重/忽略大小写/空行",
        category: "文本",
        icon: "sort-precedence",
        entry: "./sortlines.ts",
      },
      {
        id: "color",
        title: "颜色转换",
        description: "Hex ⇄ RGB ⇄ HSL + ANSI 256 色号",
        category: "转换",
        icon: "color-mode",
        entry: "./color.ts",
      },
      {
        id: "password",
        title: "密码生成",
        description: "crypto 随机；四类字符集可组合",
        category: "生成",
        icon: "key",
        entry: "./password.ts",
      },
      {
        id: "textdiff",
        title: "文本 Diff",
        description: "两栏对比，行级差异（+ 新增 / - 删除）",
        category: "文本",
        icon: "diff",
        entry: "./textdiff.ts",
      },
    ],
  },
  // monaco：正则测试器的测试文本区（P6 定案）需要裸 Monaco 实例；fs:read：workspaceRoot()（求值桥定位解释器）
  permissions: ["clipboard", "selection", "monaco", "fs:read"],
};
