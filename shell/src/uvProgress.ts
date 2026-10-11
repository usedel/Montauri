// uv 流式输出 → 可判读进度（体验审查 L-1）。
//
// 为什么需要：uv 的下载进度走 stderr 且用 `\r` 原地刷新；后端 `stream_lines` 把 `\r` 统一转成
// `\n` 逐行推送后，结局只有两种——非 TTY 下退化成少量一次性行（**看不到进度**），或 `\r`
// 刷屏（**淹没有用输出**）。两条路都回答不了用户真正想问的「在下载还是卡住了」。
//
// 设计纪律（dep plan §5.6-2，与 cloneRepository 的进度区一致）：
// **解析得出就给真实数字，解析不出就只给最近一行 + 转圈——绝不做假进度条**（自己会走、
// 与实际无关的百分比比没有进度更糟）。

export interface UvProgress {
  /** 0..1；null = 已知在跑但算不出比例（UI 走不确定态，不画百分比） */
  ratio: number | null;
  /** 展示用的一句话进度：能解析时含 X/Y 或百分数，否则是最近一行输出 */
  text: string;
}

/** 展示长度上限：状态栏只有一行高，长行必须截掉（否则会把其它芯片挤出可视区） */
const MAX_TEXT = 48;

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1000, kib: 1024,
  mb: 1000 ** 2, mib: 1024 ** 2,
  gb: 1000 ** 3, gib: 1024 ** 3,
};

/** `45.2 MiB / 100.5 MiB`、`1.2 MB/3.4 MB` → 已用 / 总量 */
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|KB|MB|GB)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|KB|MB|GB)/i;
/** `Prepared 3/12 packages`、`Installed 5/9` → 已处理 / 总数 */
const COUNT_RE = /\b(\d+)\s*\/\s*(\d+)\b/;
/** `46%` / `46.5 %` → 百分数 */
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/;

function unitBytes(unit: string): number {
  // KiB/MiB/GiB 是 1024 进制，KB/MB/GB 是 1000 进制（uv 两者都用，按字面区分）
  return UNIT_BYTES[unit.toLowerCase()] ?? 1;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function shorten(line: string): string {
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
}

/**
 * 把 uv 的一行流式输出解析成进度。
 * @returns null = 空行（无信息，UI 保持上一次的显示）；否则给 ratio（可能为 null）与文本
 */
export function parseUvProgress(raw: string): UvProgress | null {
  // uv 的进度行带进度块（U+2580–259F）与盲文转圈符（U+2800–28FF）——先剔掉再压平空白
  const line = raw
    .replace(/[\u2580-\u259F\u2800-\u28FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return null;

  const size = SIZE_RE.exec(line);
  if (size) {
    const done = parseFloat(size[1]) * unitBytes(size[2]);
    const total = parseFloat(size[3]) * unitBytes(size[4]);
    if (total > 0 && done >= 0) {
      const ratio = clamp01(done / total);
      return { ratio, text: `${shorten(line)}（${Math.round(ratio * 100)}%）` };
    }
  }

  const count = COUNT_RE.exec(line);
  if (count) {
    const done = parseInt(count[1], 10);
    const total = parseInt(count[2], 10);
    if (total > 0 && done >= 0 && done <= total) {
      const ratio = clamp01(done / total);
      return { ratio, text: `${shorten(line)}（${Math.round(ratio * 100)}%）` };
    }
    return { ratio: null, text: shorten(line) }; // 形如 `12/07 09:00` 的日期类误命中：不画比例
  }

  const pct = PERCENT_RE.exec(line);
  if (pct) {
    const v = parseFloat(pct[1]);
    if (v >= 0 && v <= 100) return { ratio: clamp01(v / 100), text: shorten(line) };
  }

  // 解析不出比例：仍把最近一行交给 UI（「在跑什么」本身就是进度信息）
  return { ratio: null, text: shorten(line) };
}
