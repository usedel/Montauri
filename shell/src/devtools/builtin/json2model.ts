// JSON → Python 模型工具（P1 · 库支持 §7-2 内置插件 · 生成类）：
// 粘贴 JSON → 实时生成 Pydantic / dataclass / TypedDict 模型类。纯前端零求值（转换全程本地）。
// 形态选择用 kit.radioGroup（互斥单选组，与 base64 的方向选择同一范式）；转换逻辑在 json2model.gen.ts。

import type { PanelHost } from "../../extensions/facade";
import { pluginToolId } from "../../extensions/manifest";
import { jsonToModelCode } from "./json2model.gen";
import { t } from "../../i18n";

/**
 * 本工具的全局 id（`<pluginId>.<toolId>`）。传裸 `"json2model"` 会让 `openDevTools` 静默回落到
 * 「最近使用」工具（面板开了但打开的是别的工具）——同 devtools/index.ts 的 HTTP_TOOL_ID 踩坑。
 */
export const JSON2MODEL_TOOL_ID = pluginToolId("opencharm.builtin", "json2model");

// A4 ③：HTTP 响应 → 模型生成的**接收端**（与 http.ts 的 setPendingRequest 同构）：
// 工具已挂载（面板有实例缓存）时直接投递给在线消费者，否则暂存等下次 mount 消费。
let pendingJson: string | null = null;
const pendingConsumers = new Set<(json: string) => void>();

/** 预填待转 JSON（HTTP 工具响应工具栏「生成模型」调用） */
export function setPendingJson2Model(json: string): void {
  if (pendingConsumers.size > 0) {
    for (const cb of pendingConsumers) cb(json);
    return;
  }
  pendingJson = json;
}

export function mount(host: PanelHost): { dispose(): void } | void {
  const { kit } = host;
  host.root.textContent = "";

  const wrap = kit.body();
  const input = kit.textarea({ placeholder: t("devtools.j2m.inputPh"), flex: true, rows: 8 });
  const nameInput = kit.input({ placeholder: t("devtools.j2m.rootNamePh"), onInput: run });
  const errEl = kit.errorSlot();
  const out = kit.output({ language: "python", placeholder: t("devtools.j2m.outPh") });

  const style = kit.radioGroup<"pydantic" | "dataclass" | "typeddict">({
    label: t("devtools.j2m.style"),
    options: [
      { value: "pydantic", label: "Pydantic" },
      { value: "dataclass", label: "dataclass" },
      { value: "typeddict", label: "TypedDict" },
    ],
    value: "pydantic",
    onChange: run,
  });

  function run(): void {
    const text = input.value;
    if (!text.trim()) {
      out.clear();
      errEl.textContent = "";
      return;
    }
    try {
      out.set(jsonToModelCode(text, { style: style.get(), rootName: nameInput.value }));
      errEl.textContent = "";
    } catch (e) {
      errEl.textContent = t("devtools.common.jsonParseFailed", { msg: e instanceof Error ? e.message : String(e) });
    }
  }

  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run();
  });

  wrap.append(
    input,
    kit.toolbar(style.el, nameInput, "spacer", kit.pasteButton((t) => { input.value = t; run(); }), kit.copyButton(() => out.get())),
    errEl,
    out.el,
  );
  host.root.appendChild(wrap);

  // A4 ③：接收 HTTP 响应导入（在线消费者 + 未挂载暂存两条路）
  const consume = (json: string): void => {
    input.value = json;
    run();
  };
  pendingConsumers.add(consume);
  if (pendingJson !== null) {
    const json = pendingJson;
    pendingJson = null;
    consume(json);
  }

  // kit.output 持有 Monaco 实例，须随工具实例释放（R-5 复测发现的泄漏）
  return {
    dispose() {
      pendingConsumers.delete(consume);
      out.dispose();
    },
  };
}
