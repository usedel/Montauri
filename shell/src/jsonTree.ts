// 通用 JSON 折叠树（纯 DOM 渲染，可复用）
//
// 出处：这是仓库里**第三处** JSON 树需求（`devtools/jsonpath/tree.ts` 只有数据结构、
// B4 的 `http.ts` 有一份私有实现、本模块服务 B5 的运行日志行内展开）——§6.7.6 判断
// 「抽公共的收益此时成立」，故落成公共模块。**默认折叠**，展开状态不随重渲染保留。

type JsonVal = Record<string, unknown> | unknown[] | string | number | boolean | null;

/** 树渲染选项 */
export interface JsonTreeOptions {
  /** 初始展开的层级深度（0 = 全折叠，默认） */
  expandedDepth?: number;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 值的展示文本（字符串带引号，其余原样；超长截断） */
function leafText(v: JsonVal): string {
  if (v === null) return "null";
  if (typeof v === "string") return `"${v.length > 200 ? `${v.slice(0, 200)}…` : v}"`;
  return String(v);
}

/** 有子节点时的一行摘要（折叠时看得到结构，不必展开） */
function preview(v: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(v)) return `Array(${v.length})`;
  const keys = Object.keys(v);
  const head = keys.slice(0, 3).join(", ");
  return keys.length > 3 ? `{${head}, …}` : `{${head}}`;
}

/** 渲染一个节点（容器递归 / 叶子直接文本） */
function renderNode(key: string | null, value: JsonVal, depth: number, expandedDepth: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "jt-row";
  row.style.paddingLeft = `${depth * 14}px`;
  if (key !== null) {
    const k = document.createElement("span");
    k.className = "jt-key";
    k.textContent = key;
    row.appendChild(k);
    const sep = document.createElement("span");
    sep.className = "jt-sep";
    sep.textContent = ": ";
    row.appendChild(sep);
  }

  if (isObj(value) || Array.isArray(value)) {
    const children = isObj(value)
      ? Object.entries(value).map(([k, v]) => [k, v as JsonVal] as const)
      : value.map((v, i) => [String(i), v as JsonVal] as const);
    const toggle = document.createElement("span");
    toggle.className = "jt-toggle";
    toggle.textContent = "▸";
    row.appendChild(toggle);
    const pv = document.createElement("span");
    pv.className = "jt-preview";
    pv.textContent = preview(value as Record<string, unknown> | unknown[]);
    row.appendChild(pv);

    const box = document.createElement("div");
    box.className = "jt-children";
    box.hidden = depth >= expandedDepth;
    toggle.textContent = box.hidden ? "▸" : "▾";
    for (const [k, v] of children) box.appendChild(renderNode(k, v, depth + 1, expandedDepth));
    if (children.length > 0) {
      row.addEventListener("click", () => {
        box.hidden = !box.hidden;
        toggle.textContent = box.hidden ? "▸" : "▾";
      });
      toggle.classList.add("jt-toggle--link");
    } else {
      toggle.classList.add("jt-toggle--empty");
    }
    const wrap = document.createElement("div");
    wrap.className = "jt-node";
    wrap.appendChild(row);
    wrap.appendChild(box);
    return wrap;
  }

  const val = document.createElement("span");
  val.className = `jt-val jt-val--${value === null ? "null" : typeof value}`;
  val.textContent = leafText(value);
  row.appendChild(val);
  return row;
}

/**
 * 渲染 JSON 折叠树（根节点）。
 * @param value 任意 JSON 值（对象 / 数组 / 标量）
 * @param opts.expandedDepth 初始展开层级（默认 0 = 全折叠）
 */
export function renderJsonTree(value: unknown, opts: JsonTreeOptions = {}): HTMLElement {
  const root = document.createElement("div");
  root.className = "json-tree";
  root.appendChild(renderNode(null, value as JsonVal, 0, Math.max(0, opts.expandedDepth ?? 0)));
  return root;
}
