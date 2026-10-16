// 实参位变量 ghost text（PyCharm 式灰色小字，FUSION-1 二期；计划 docs/arg_var_fusion_dev_plan.md）。
//
// 与 argVarCompletion.ts（下拉候选）同一数据源（signatureHelp 探测 + 作用域扫描 + 类型匹配），
// 呈现为光标后灰色小字（Monaco inline completions / ghost text），Tab 采纳。
// 呈现语义（计划 §1.2 定稿）：下拉为主通道（置顶 + Tab 接受）；ghost 是扩展形态
//（变量名 + ", 下参=默认值)"），带前缀输入时经引擎 augmentation 与下拉同屏（E-AV-6）；
// 防闪烁闸门拦「光标贴 ( / ,」的自动触发（suggest 即将打开，避免闪一下被压）。
// sigQuery / rawHoverQuery 由 client.ts 注入（防环；本模块不 import client）。
import type * as MonacoApi from "monaco-editor/esm/vs/editor/editor.api";
import { matchArgVars, type HoverQuery, type SigHelpLike } from "./argVarCompletion";

/** signatureHelp 查询器（client.ts::querySignatureHelp 的门控形态） */
export type SigQuery = (params: unknown) => Promise<SigHelpLike | null>;

/** hover 查询器（client.ts 注入：uri + 0-based 坐标 → hover 原文或 null） */
export type RawHoverQuery = (uri: string, line0: number, char0: number) => Promise<string | null>;

/** hover contents 归一化为纯文本（空则 null）——client.ts::hoverToText 的零依赖同构 */
function hoverContentsToText(h: unknown): string | null {
  if (!h) return null;
  const contents = (h as { contents?: unknown }).contents;
  if (typeof contents === "string") return contents || null;
  if (Array.isArray(contents)) {
    const t = contents.map((c) => (typeof c === "string" ? c : String((c as { value?: unknown }).value ?? ""))).join(" ");
    return t || null;
  }
  const v = (contents as { value?: unknown } | undefined)?.value;
  return typeof v === "string" && v ? v : null;
}

/** FUSION-1 v2 类型匹配：hover 原文查询（变量赋值处推断类型）。
 *  经依赖注入由 client.ts 装配（setArgVarDeps），防反向 import。 */
let hoverRequest: ((uri: string, line0: number, char0: number) => Promise<unknown>) | null = null;

export function setArgVarDeps(
  hoverReq: (uri: string, line0: number, char0: number) => Promise<unknown>,
): void {
  hoverRequest = hoverReq;
}

export function hoverTextFor(uri: string, line0: number, char0: number): Promise<string | null> {
  const req = hoverRequest;
  if (!req) return Promise.resolve(null);
  return req(uri, line0, char0)
    .then((r) => hoverContentsToText(r))
    .catch(() => null);
}

let registered: MonacoApi.IDisposable | null = null;

/** 注册实参位 ghost text provider（幂等：重复调用先释放旧注册）。client.ts 每轮 providers 重建时调用。
 *  与 suggest 下拉**同屏共存**（Copilot 范式，VS Code 实测语义）：quickSuggestions 使标识符输入
 *  必弹 suggest，互斥会让 ghost 永无出现时机；Tab 语义两侧一致（suggest 开=接受选中项
 *  （融合变量恰为首项预选），suggest 关=采纳 ghost），无歧义。
 *  rawHoverQuery（v2 类型匹配）：ghost 的 tier0 首推更准——首个「类型匹配+名称亲和」者。 */
export function registerArgVarInline(
  monaco: typeof MonacoApi,
  sigQuery: SigQuery,
  rawHoverQuery?: RawHoverQuery,
): void {
  registered?.dispose();
  registered = monaco.languages.registerInlineCompletionsProvider("python", {
    async provideInlineCompletions(model, position, ctx, token) {
      const items: MonacoApi.languages.InlineCompletion[] = [];
      if (token?.isCancellationRequested) return { items };
      // 防闪烁闸门（真机实测修复）：**自动触发**（输入驱动）+ 光标紧贴 `(` / `,`（suggest
      // 触发字符）时 suggest 下拉必将打开（~100ms 后），此刻返回 ghost 只会「闪一下就被
      // 双池语义压制」（视觉毛刺）。显式触发（triggerInline，Explicit）不受闸门约束——
      // 它是干净通道（E-AV-4 / GHOST-ISO）。
      const auto = ctx?.triggerKind !== 1; // 1 = InlineCompletionTriggerKind.Explicit（Automatic=0）
      const chBefore = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: Math.max(1, position.column - 1),
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      if (auto && (chBefore === "(" || chBefore === ",")) return { items };
      const path = (model as { __opencharmPath?: string }).__opencharmPath;
      if (!path) return { items };
      const uri = "file:///" + path.replace(/\\/g, "/");
      const sig = await sigQuery({
        textDocument: { uri },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      }).catch(() => null);
      if (token?.isCancellationRequested) return { items };
      const hover: HoverQuery | null = rawHoverQuery
        ? (l0, c0) => rawHoverQuery(uri, l0, c0).catch(() => null)
        : null;
      const vars = await matchArgVars(
        sig,
        model.getValue().split("\n"),
        position.lineNumber - 1,
        cursorPrefix(model, position),
        hover,
      );
      // ghost 扩展形态（计划 §1.2，PROBE-AUG 实证）：inline 项 = 变量名 + 后缀（", " 进下一位 /
      //  ")" 闭括号）。下拉打开 + 选中项同变量时，引擎 augmentation 渲染「选中项剩余 + 扩展段」
      // 灰字（如已输 c 选中 cb_url → 灰字 "b_url, "）；Tab 一步接受「变量+逗号」。
      // 裸名形态（与选中项相等）会被双池语义压制——扩展形态是唯一活路。
      if (vars.length) items.push({ insertText: vars[0].name + vars[0].ghostSuffix });
      return { items };
    },
    disposeInlineCompletions() {
      /* 无状态；0.57 将 freeInlineCompletions 更名为此（必选） */
    },
  });
}

/** 光标前缀（与 computeArgVarsForPosition 同口径：字符级标识符回扫） */
function cursorPrefix(model: MonacoApi.editor.ITextModel, position: MonacoApi.Position): string {
  const line = model.getLineContent(position.lineNumber);
  let start = position.column - 1;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) start--;
  return line.slice(start, position.column - 1);
}

// E2E 测试钩子（同 debugGutter __OC_DEBUG_TEST__ 先例，仅 vite dev）：
// ghost 通道依赖 editor action（editor.action.inlineSuggest.trigger），
// Playwright 经此触发，规避键位抖动；action 本身在正式立项时绑键位。
let editorRef: { getAction(id: string): { run(): Promise<void> } } | null = null;

/** 注入编辑器引用（client.ts 注册 provider 时同步调用）。
 *  同时预热 InlineCompletionsController（Eventually 懒实例化——提前跑一次 trigger action
 *  强制实例化，保证 augmentation 协同（suggest 事件绑定等）先于用户首次补全就绪）。 */
export function setArgVarInlineEditor(editor: unknown): void {
  editorRef = editor as { getAction(id: string): { run(): Promise<void> } } | null;
  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    (window as unknown as { __OC_ARGVAR__?: unknown }).__OC_ARGVAR__ = {
      triggerInline: () => editorRef?.getAction("editor.action.inlineSuggest.trigger")?.run(),
      acceptInline: () => editorRef?.getAction("editor.action.inlineSuggest.commit")?.run(),
    };
  }
  // 预热（fire-and-forget，错误静默——失败只影响 ghost 渲染时机，不影响主功能）
  void editorRef?.getAction("editor.action.inlineSuggest.trigger")?.run().catch(() => {});
}
