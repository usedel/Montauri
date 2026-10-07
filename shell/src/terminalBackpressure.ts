// 输出背压队列（TD-021①）：UTF-8 字节口径。
// 旧实现（terminal.ts 内联）用 `data.length` 累加「字节数」——那是 UTF-16 码元数：
// CJK 一个字符 = 1 个码元 / 3 个 UTF-8 字节，中文输出下 4MB 硬上限实际放宽约 3 倍，
// 单帧 256KB 预算同理。改为 push 时一次性 TextEncoder 编码成 Uint8Array，
// 计数 / 切分 / 丢弃 / 限流全部按真实 UTF-8 字节走。
// xterm.js v5 的 `write(Uint8Array)` 自带增量 UTF-8 解码，按字节边界切块不会乱码。
// 拆成独立零依赖模块：IntegratedTerminal 依赖 xterm / DOM 无法单测，这里纯逻辑可直接验证
// （同 epSampleCore / selectorCore 的「应用相关 / 无关」分层惯例）。

const utf8 = new TextEncoder();

export class OutputBackpressure {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private throttleNotified = false;
  private droppedBytes = 0;

  constructor(
    /** 积压硬上限（超过丢最旧输出，防 OOM） */
    private readonly maxPendingBytes: number,
    /** 超过即提示一次「已限流」（洪峰结束才允许再次提示，防刷屏） */
    private readonly throttleWarnBytes: number,
  ) {}

  get pendingBytes(): number {
    return this.bytes;
  }

  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  push(text: string, throttleNotice?: string): void {
    if (!text) return;
    const data = utf8.encode(text);
    this.chunks.push(data);
    this.bytes += data.length;
    // 硬上限：丢最旧输出保响应（scrollback 有限，最旧内容本就即将滚出可视区）
    while (this.bytes > this.maxPendingBytes && this.chunks.length > 1) {
      const head = this.chunks.shift()!;
      this.bytes -= head.length;
      this.droppedBytes += head.length;
    }
    // 积压过大时只提示一次：让用户知道「输出被削峰」而非「程序卡了」
    if (this.bytes >= this.throttleWarnBytes && !this.throttleNotified && throttleNotice) {
      this.throttleNotified = true;
      const note = utf8.encode(throttleNotice);
      this.chunks.push(note);
      this.bytes += note.length;
    }
  }

  /** 按字节预算取一块（合并多个小块直到接近预算，保持「单帧一次 write」的批处理语义；
   *  单块超预算时切分，剩余留队首；null = 队列空或预算非正） */
  take(maxBytes: number): Uint8Array | null {
    if (this.chunks.length === 0 || maxBytes <= 0) return null;
    const head = this.chunks[0];
    if (head.length <= maxBytes) {
      this.chunks.shift();
      this.bytes -= head.length;
      let out = head;
      let budget = maxBytes - head.length;
      // 预算富余时继续合并后续小块（等价旧实现的 `while (budget > 0) out += head`）
      while (budget > 0 && this.chunks.length > 0) {
        const next = this.chunks[0];
        if (next.length > budget) break;
        this.chunks.shift();
        this.bytes -= next.length;
        const merged = new Uint8Array(out.length + next.length);
        merged.set(out, 0);
        merged.set(next, out.length);
        out = merged;
        budget -= next.length;
      }
      return out;
    }
    // 队首块超预算：切一部分写入，剩下的留在队首
    const part = head.slice(0, maxBytes);
    this.chunks[0] = head.slice(maxBytes);
    this.bytes -= maxBytes;
    return part;
  }

  /** 队列已排空且本洪峰提示过限流 → 返回丢弃字节数并复位（洪峰收尾提示）；否则 null */
  consumePeakEnd(): number | null {
    if (this.chunks.length > 0 || !this.throttleNotified) return null;
    this.throttleNotified = false;
    const dropped = this.droppedBytes;
    this.droppedBytes = 0;
    return dropped;
  }

  clear(): void {
    this.chunks = [];
    this.bytes = 0;
    this.throttleNotified = false;
    this.droppedBytes = 0;
  }
}
