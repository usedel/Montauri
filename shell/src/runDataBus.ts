// 运行输出多播总线（B5 · docs/toolbox_dev_plan.md §6.8）
//
// 背景：termUi 原有的 `runOnData` 是**单槽位**且签名不带 id，已被运行历史独占。
// 本模块把它抽成零依赖（无 DOM / 无 Tauri）的多播总线：termUi 在 term-data 分发点
// `emitRunData`，消费方（运行历史 / 结构化运行日志）各自 `addRunDataConsumer` 并按
// instanceId 判断归属。抽出来是为了**可单测**（termUi 依赖 DOM 与 Tauri，测试环境 import 不了）。

/** 运行会话输出消费者（`text` 已剥离 ANSI；`instanceId` 供消费者做归属判断） */
export type RunDataConsumer = (instanceId: string, text: string) => void;

const consumers = new Set<RunDataConsumer>();

/** 注册运行输出消费者，返回 dispose（幂等：重复 dispose 无害） */
export function addRunDataConsumer(fn: RunDataConsumer): () => void {
  consumers.add(fn);
  return () => {
    consumers.delete(fn);
  };
}

/** 注销消费者（等价 dispose；供显式调用方使用） */
export function removeRunDataConsumer(fn: RunDataConsumer): void {
  consumers.delete(fn);
}

/**
 * 广播一块运行输出（termUi 的 term-data 分发点调用，`kind === "run"` 的会话）。
 * 纪律：**单个消费者抛错不得影响其他消费者**（静默吞掉——高频路径打日志会刷屏）。
 * 遍历前拍快照：消费者在回调里注册/注销不会破坏本次遍历。
 */
export function emitRunData(instanceId: string, text: string): void {
  if (!text || consumers.size === 0) return;
  for (const fn of [...consumers]) {
    try {
      fn(instanceId, text);
    } catch {
      /* 单个消费者失败不阻断其余消费者 */
    }
  }
}

/** 已注册的消费者数量（单测 / 诊断用） */
export function runDataConsumerCount(): number {
  return consumers.size;
}

/** 清空所有消费者（仅供单测复位；生产路径不要调用） */
export function resetRunDataBus(): void {
  consumers.clear();
}
