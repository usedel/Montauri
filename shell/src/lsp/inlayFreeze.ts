// 光标行冻结的会话态（跳变治理 B）：光标跟踪 + per-model 渲染缓存 + 跨行解冻 fire；
// 行级纯函数见 inlayMerge.ts。自管缓存原因：vendor _inlayHintsCache 无「按光标部分保留」钩子。
// ⚠ 主编辑器创建早于 provider 注册，onDidCreateEditor 捕获不到——注册方必须显式传
// existingEditors，否则光标表恒空、冻结静默失效（e2e E-DX-IP3 实锤过）。

import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { DisposableStore } from "../util";
import { applyCursorFreeze, type AnchoredHint } from "./inlayMerge";
import { queueHeal, setHealRefire } from "./inlayHeal"; // 控制器装饰泄漏愈合（2026-10-14 真机实锤）

/** 渲染缓存条目：hints + 采样时的行数（行数变化 = 缓存失效，防行号错位） */
interface CacheEntry {
  lineCount: number;
  hints: AnchoredHint[];
}

class InlayFreezeManager {
  private store = new DisposableStore();
  /** editor → 光标位置快照（provider 查询时读，避免闭包陈旧） */
  private cursorsByEditor = new Map<MonacoApi.editor.ICodeEditor, Array<{ line: number; column: number }>>();
  /** model uri → 渲染缓存 */
  private cache = new Map<string, CacheEntry>();
  /** 冻结实际发生过的 model（跨行移动才值得 fire 重查；无提示的文件不打扰引擎） */
  private engaged = new Set<string>();
  /** 已挂 onWillDispose 清理的 model（与 cache 分开——invalidateAll 清缓存不得重复挂监听） */
  private tracked = new Set<string>();
  /** 跨行解冻回调（client.ts 注入 inlayHintsChanged.fire） */
  private onChanged: (() => void) | null = null;

  /**
   * 批量接线：已存在编辑器显式传入（⚠ 主编辑器创建早于 provider 注册，
   * onDidCreateEditor 捕获不到它）+ 后续新建编辑器（分屏）走事件捕获。
   * onDidCreateEditor 以参数传入（避免本模块依赖 monaco 运行时实例，保持可测性）。
   */
  watchEditors(
    existing: MonacoApi.editor.ICodeEditor[],
    onDidCreateEditor: (cb: (ed: MonacoApi.editor.ICodeEditor) => void) => { dispose(): void },
  ): { dispose(): void } {
    for (const ed of existing) this.attachEditor(ed);
    return onDidCreateEditor((ed) => this.attachEditor(ed));
  }

  /** 注册编辑器（主编辑器显式传入；分屏走 onDidCreateEditor） */
  attachEditor(editor: MonacoApi.editor.ICodeEditor): void {
    if (this.cursorsByEditor.has(editor)) return;
    const snapshot = () => {
      const positions = editor.getSelections()?.map((s) => ({ line: s.positionLineNumber, column: s.positionColumn }));
      this.cursorsByEditor.set(editor, positions ?? []);
    };
    snapshot();
    this.store.add(editor.onDidChangeCursorPosition((e) => {
      const prevLine = this.cursorsByEditor.get(editor)?.[0]?.line;
      snapshot();
      // 跨行移动 = 解冻信号：Monaco 不因光标移动重查 inlay，必须主动 fire。
      // 仅在该 model 冻结实际发生过才 fire（避免无提示文件里方向键狂打引擎）；
      // 同行列移动不 fire——下次内容变更重算时自然生效。
      const model = editor.getModel();
      // 兜底：插删行行号漂移后失去事件触发的残留装饰，光标一动即清扫（heal 幂等）
      if (model) queueHeal(model, () => this.cache.get(model.uri.toString()), editor);
      if (
        prevLine !== undefined && prevLine !== e.position.lineNumber &&
        model && this.engaged.has(model.uri.toString())
      ) {
        this.onChanged?.();
      }
    }));
    this.store.add(editor.onDidChangeModel(() => snapshot())); // 切 tab/换 model 后光标快照即时校正
    this.store.add(editor.onDidDispose(() => this.cursorsByEditor.delete(editor)));
  }

  /** client.ts 传入解冻回调（inlayHintsChanged fire 时触发 Monaco 重查）；愈合收敛轮复用同一 fire */
  setOnChanged(fn: () => void): void {
    this.onChanged = fn;
    setHealRefire(fn);
  }

  /** provider 每轮调用：fresh 经冻结变换后落缓存并返回 */
  snapshotFor(model: MonacoApi.editor.ITextModel, fresh: AnchoredHint[]): AnchoredHint[] {
    const key = model.uri.toString();
    // 缓存随 model 生命周期清理（listener 与 model 同生共死，无需入 store——
    // 入了反而在 store 里无限累积已销毁 model 的句柄）；tracked 防 invalidateAll 后重复挂
    if (!this.tracked.has(key)) {
      this.tracked.add(key);
      model.onWillDispose(() => {
        this.tracked.delete(key);
        this.cache.delete(key);
        this.engaged.delete(key);
      });
      model.onDidChangeDecorations(() => queueHeal(model, () => this.cache.get(key), [...this.cursorsByEditor.keys()].find((ed) => ed.getModel() === model))); // 含 vendor fast-restore，见 inlayHeal 头注
    }
    const cached = this.cache.get(key);
    const lineCount = model.getLineCount();
    // 行数变化（插/删行）→ 缓存行号错位风险 > 冻结收益 → 失效直通
    const valid = cached && cached.lineCount === lineCount ? cached : null;
    // lineTextOf 供复活锚点守卫（getLineContent 越界会 throw——防御性钳制，尽管
    // lineCount 一致时缓存行号理论上都合法）
    const out = applyCursorFreeze(fresh, valid ? valid.hints : null, this.cursorsOf(model), (l) =>
      l >= 1 && l <= lineCount ? model.getLineContent(l) : "",
    );
    this.cache.set(key, { lineCount, hints: out });
    queueHeal(model, () => this.cache.get(key), [...this.cursorsByEditor.keys()].find((ed) => ed.getModel() === model)); // 渲染后宏任务愈合（含视图重绘）
    if (out !== fresh) this.engaged.add(key);
    else this.engaged.delete(key);
    return out;
  }

  /** 该 model 关联的所有光标（主编辑器 + 分屏） */
  private cursorsOf(model: MonacoApi.editor.ITextModel): Array<{ line: number; column: number }> {
    const out: Array<{ line: number; column: number }> = [];
    for (const [editor, positions] of this.cursorsByEditor) {
      if (editor.getModel() === model) out.push(...positions);
    }
    return out;
  }

  /** 该 model 当前渲染缓存的提示（client.ts hover 闪现抑制用；无缓存为 null） */
  hintsAt(model: MonacoApi.editor.ITextModel): AnchoredHint[] | null {
    return this.cache.get(model.uri.toString())?.hints ?? null;
  }

  /** 设置切换（inlay_param_hints）等场景：清空缓存与冻结态（调用方负责 fire 重查） */
  invalidateAll(): void {
    this.cache.clear();
    this.engaged.clear();
  }

  dispose(): void {
    this.store.dispose();
    this.cursorsByEditor.clear();
    this.cache.clear();
    this.engaged.clear();
    this.tracked.clear();
  }
}

/** 模块级单例：inlay provider 全应用只有一个（registerLspInlayHints 唯一调用方），
 * 单例省掉 client.ts 的持有/判空/透传（预算红线下的接线成本压缩）。 */
export const inlayFreeze = new InlayFreezeManager();
