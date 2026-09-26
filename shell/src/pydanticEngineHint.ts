// F0 裁决 B（docs/pycharm_framework_support_report.md §8.3 / bench/reports/pydantic-engine-probe.md）：
// 依赖声明含 pydantic / fastapi 的工作区 → **推荐（不强制）**切换静态引擎到 basedpyright。
// 与框架探针表同形态：输出面板持久 hint 行 + 链接（发现与关闭同一处，一次交互完成）；
// 「保持 pyrefly」写 workspace config 的 `framework_hints["pydantic_engine"]`（工作区级关闭，
// 与框架提示共用 Rust 侧存储，语义 = 框架相关提示的工作区级开关）。
// 切换动作经 handler 注入（engineChip 的 switchEngineTo），避免反向依赖 main / settingsPanel。

import { invoke } from "@tauri-apps/api/core";
import { app, outputEl } from "./state";
import { appendOutputLine } from "./output";
import { gotoFromLink } from "./tracebackLink";
import { toast, toastFail } from "./toast";
import { pydanticEngineHintText, shouldSuggestPydanticEngine } from "./frameworks";

interface PydanticEngineHandlers {
  /** 切换静态引擎并重启（engineChip::switchEngineTo；内部已处理同值跳过与持久化） */
  switchEngine: (engine: string) => Promise<void>;
}

let handlers: PydanticEngineHandlers | null = null;

export function setPydanticEngineHandlers(h: PydanticEngineHandlers): void {
  handlers = h;
}

/** 会话去重键 = 工作区 + "pydantic_engine"（每工作区每会话最多一次；Set 随应用生命周期存在，
 *  规模 = 打开过的工作区数，无增长风险；关闭工作区由 main 调 resetPydanticEngineHint 清空） */
const hintShown = new Set<string>();

/** Pydantic 栈引擎推荐（F0 裁决 B）：仅当当前引擎是 pyrefly 时提示；绝不静默改设置 */
export async function maybeSuggestPydanticEngine(): Promise<void> {
  const root = app.workspaceRoot;
  if (!root || !shouldSuggestPydanticEngine(app.settings.lsp_engine)) return;
  const key = `${root}#pydantic_engine`;
  if (hintShown.has(key)) return;
  hintShown.add(key);

  const hit = await invoke<boolean>("detect_pydantic_stack", { workspaceRoot: root }).catch(() => false);
  if (!hit) return;

  const el = appendOutputLine(outputEl, pydanticEngineHintText(), "hint", gotoFromLink);

  // 动作一：切换引擎（用户显式点击 → 全局生效，toast 明示 + 状态栏可切回）
  const sw = document.createElement("span");
  sw.className = "out-link";
  sw.textContent = "切换到 basedpyright";
  sw.addEventListener("click", () => {
    void (async () => {
      try {
        await handlers?.switchEngine("basedpyright");
        sw.className = "";
        sw.textContent = "（已切换）";
        toast("已切换静态引擎：basedpyright（全局生效，状态栏可切回）", "success");
        // 已表达意图：本工作区不再提示（即使日后切回 pyrefly 也不打扰）
        await invoke("set_framework_hint_disabled", {
          workspaceRoot: root,
          framework: "pydantic_engine",
          disabled: true,
        }).catch(() => undefined);
      } catch (e) {
        toastFail("切换引擎", e);
      }
    })();
  });
  el.appendChild(document.createTextNode("　"));
  el.appendChild(sw);

  // 动作二：保持 pyrefly（工作区级关闭，对齐 PyCharm 的抑制开关设计）
  const off = document.createElement("span");
  off.className = "out-link";
  off.textContent = "保持 pyrefly（不再提示）";
  off.addEventListener("click", () => {
    void (async () => {
      try {
        await invoke("set_framework_hint_disabled", {
          workspaceRoot: root,
          framework: "pydantic_engine",
          disabled: true,
        });
        off.className = "";
        off.textContent = "（已关闭本工作区提示）";
        toast("已关闭本工作区的引擎推荐提示", "success");
      } catch (e) {
        toastFail("关闭提示", e);
      }
    })();
  });
  el.appendChild(document.createTextNode("　"));
  el.appendChild(off);
}

/** 关闭工作区时清空会话去重（main 的 clearRunProfilesCache 调用点旁） */
export function resetPydanticEngineHint(): void {
  hintShown.clear();
}
