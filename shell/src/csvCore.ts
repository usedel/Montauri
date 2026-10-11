// CSV 解析（VS Code 插件调研报告 借鉴-4 · 对标 Rainbow CSV / SQLite Viewer）。
//
// **零第三方依赖**（ADR-0010 体积红线：报告「不做的条件」明确写了「若必须引入 CSV 解析依赖 → 不做」）。
// 本文件是 `sqliteGrid.ts::csvCell / toCsv` 的**反向实现**（同一份 RFC 4180 契约）：
//   · 行分隔 CRLF（也容忍裸 LF / CR）；
//   · 含 `"` `,` CR LF 的字段整体加引号，内部 `"` 双写 → 解析时反向还原；
//   · 首行是列名。
//
// 纪律（改动前先读）：
//   1. **只读**：不写文件、不落库、不改 Tab 的 model；
//   2. **行数上限**：`maxRows` 由调用方按 SQLite `HARD_MAX_ROWS`（10 000）口径传入，
//      超出即停并置 `truncated`（不做分块懒加载——用户已裁决「上限 + 显式提示」）；
//   3. **编码不猜测**：只接受 UTF-8 / UTF-8 BOM，非 UTF-8 由调用方显式提示（见 `isUtf8Decodable`）。

/** 解析结果（形状对齐 sqliteGrid::DbQueryResult，可直接喂给 buildGridTable） */
export interface CsvTable {
  columns: string[];
  rows: Array<Array<string | null>>;
  /** 数据行数（不含表头） */
  total: number;
  /** 是否因触到 maxRows 而截断 */
  truncated: boolean;
}

/** 默认上限：与 Rust db_cmds::HARD_MAX_ROWS 同口径（10 000） */
export const CSV_MAX_ROWS = 10_000;

/** UTF-8 BOM（既有 CSV 导出写入的前缀，见 sqliteTabs.ts 的 `\ufeff` + toCsv） */
export const BOM = "\ufeff";

/** 剥离 BOM（导出带 BOM，读回来必须先剥，否则首列名会粘一个不可见字符） */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * UTF-8 可解码性判定（「编码不猜测」的落点）：用 TextDecoder 的 fatal 模式。
 * 不可解码 → 调用方显式提示，不做 GBK 猜测（猜错比不显示更糟）。
 */
export function isUtf8Decodable(bytes: Uint8Array): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * 逐字符状态机解析 CSV。
 * @param text 已剥 BOM 的全文
 * @param maxRows 数据行上限（触到即截断；表头不计入）
 */
export function parseCsv(text: string, maxRows: number = CSV_MAX_ROWS): CsvTable {
  const columns: string[] = [];
  const rows: Array<Array<string | null>> = [];
  if (text.length === 0) return { columns, rows, total: 0, truncated: false };

  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let truncated = false;

  /** 收下一个字段（带引号的字段按原样，不带引号的空字段按空串——与 toCsv 的 NULL→空字段对称） */
  const pushField = (): void => {
    row.push(field);
    field = "";
  };
  /** 收下一行（首行 = 列名） */
  const pushRow = (): boolean => {
    pushField();
    if (columns.length === 0) {
      // 表头：空列名补 `col序号`（CSV 里重复/空列名很常见，Grid 的表头不能出现空串）
      for (let i = 0; i < row.length; i++) {
        const name = row[i].trim();
        columns.push(name || `col${i + 1}`);
      }
    } else if (rows.length < maxRows) {
      // 行宽与表头对齐：短行右侧补 null（Grid 显示为 NULL），长行截断尾部
      const cells: Array<string | null> = [];
      for (let i = 0; i < columns.length; i++) cells.push(i < row.length ? row[i] : null);
      rows.push(cells);
    } else {
      truncated = true;
    }
    row = [];
    return !truncated;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // 双写引号 → 单个字面引号
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c; // 引号内的分隔符与换行都是字面内容
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true; // 只认字段起始处的开引号（与 csvCell 的「含分隔符才加引号」对称）
      continue;
    }
    if (c === ",") {
      pushField();
      continue;
    }
    // 行尾：CRLF 一次收行（LF 直接跳过），裸 CR / 裸 LF 也各自收行——
    // **不能**用「上一字符是 CR」的延迟状态：CRLF 会被收两次，多出一个空行
    if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      if (!pushRow()) break;
      continue;
    }
    if (c === "\n") {
      if (!pushRow()) break;
      continue;
    }
    field += c;
  }
  // 收尾：最后一行没有行尾符（含仍在引号内的未闭合字段）
  if (row.length > 0 || field !== "") pushRow();

  return { columns, rows, total: rows.length, truncated };
}
