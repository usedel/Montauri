// PyCharm XML 导入（M4，方案 §5.4）：解析导出的 <templateSet>/<template> XML。
// 模板体同为 $VAR$/$END$ 语法直接沿用；表达式按函数映射表尽力翻译，
// 不支持的函数整条降级为 defaultValue 并记录待人工确认。

import { parseExpression, type Expr } from "./engine";
import type { TemplateDef, TemplateVariableDef } from "./schema";

export interface PycharmDowngrade {
  abbreviation: string;
  variable: string;
  expression: string;
}

export interface PycharmImportResult {
  templates: TemplateDef[];
  downgraded: PycharmDowngrade[];
  errors: string[];
}

const ABBR_RE = /^[A-Za-z0-9._-]+$/;
const PY_SCOPES = ["python:module", "python:class", "python:function"];

/** PyCharm 函数 → 本引擎函数的重映射 */
const FN_REMAP: Record<string, string> = {
  lowercaseAndDash: "kebabCase",
  completeSmart: "complete",
  classNameComplete: "complete",
};

/** 与本引擎同名同义的函数 */
const FN_SAME = new Set([
  "camelCase", "capitalize", "decapitalize", "snakeCase", "firstWord",
  "spacesToUnderscores", "underscoresToCamelCase",
  "fileName", "fileNameWithoutExtension", "filePath", "fileRelativePath",
  "className", "methodName",
  "date", "time", "user", "clipboard", "lineNumber",
  "concat", "enum", "complete", "regularExpression",
]);

function remapExpr(expr: Expr): Expr | null {
  switch (expr.kind) {
    case "str":
      // 本引擎字符串常量不支持转义：含双引号的常量视为不可翻译
      return expr.value.includes('"') ? null : expr;
    case "ref":
      return expr;
    case "call": {
      const name = FN_REMAP[expr.name] ?? (FN_SAME.has(expr.name) ? expr.name : null);
      if (!name) return null;
      const args: Expr[] = [];
      for (const a of expr.args) {
        const r = remapExpr(a);
        if (!r) return null;
        args.push(r);
      }
      return { kind: "call", name, args };
    }
  }
}

function renderExpr(e: Expr): string {
  switch (e.kind) {
    case "str":
      return `"${e.value}"`;
    case "ref":
      return e.name;
    case "call":
      return `${e.name}(${e.args.map(renderExpr).join(", ")})`;
  }
}

/** 翻译 PyCharm 表达式；不可翻译返回 null（调用方降级） */
export function translatePycharmExpression(src: string): string | null {
  try {
    const remapped = remapExpr(parseExpression(src));
    return remapped ? renderExpr(remapped) : null;
  } catch {
    return null;
  }
}

/** PyCharm defaultValue 为带引号的字符串字面量（如 "&quot;text&quot;"）→ 去引号 */
function unquoteDefault(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

/** 解析 PyCharm Live Templates 导出 XML；非 XML 返回 null */
export function parsePycharmXml(xml: string): PycharmImportResult | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return null;

  const result: PycharmImportResult = { templates: [], downgraded: [], errors: [] };
  const nodes = Array.from(doc.getElementsByTagName("template"));

  for (const [i, node] of nodes.entries()) {
    const where = `template[${i}]`;
    const abbr = node.getAttribute("name") ?? "";
    const body = node.getAttribute("value") ?? "";
    if (!ABBR_RE.test(abbr)) {
      result.errors.push(`${where}: 缩写非法（${abbr || "缺失"}），跳过`);
      continue;
    }
    if (!body) {
      result.errors.push(`${where}(${abbr}): 模板体为空，跳过`);
      continue;
    }

    const variables: TemplateVariableDef[] = [];
    for (const v of Array.from(node.getElementsByTagName("variable"))) {
      const name = v.getAttribute("name") ?? "";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const rawExpr = v.getAttribute("expression") ?? "";
      const defaultValue = unquoteDefault(v.getAttribute("defaultValue") ?? "");
      // alwaysStopAt=false ⇔ PyCharm「Skip if defined」勾选
      const skipIfDefined = v.getAttribute("alwaysStopAt") === "false";
      let expression: string | undefined;
      if (rawExpr) {
        const translated = translatePycharmExpression(rawExpr);
        if (translated) {
          expression = translated;
        } else {
          result.downgraded.push({ abbreviation: abbr, variable: name, expression: rawExpr });
        }
      }
      variables.push({ name, expression, defaultValue: defaultValue || undefined, skipIfDefined });
    }

    result.templates.push({
      id: `pycharm.${abbr}`,
      abbreviation: abbr,
      description: node.getAttribute("description") || abbr,
      body,
      scopes: [...PY_SCOPES],
      kind: "normal",
      enabled: true,
      tabExpand: true,
      variables: variables.length > 0 ? variables : undefined,
    });
  }

  return result;
}
