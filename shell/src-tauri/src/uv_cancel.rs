// 长耗时 uv 操作的取消通道（体验审查 L-3）。
//
// 为什么独立成文件：`env_cmds.rs` 有冻结线纪律——「新增的 Python 环境类命令一律落新文件，
// 本文件只减不增」，而取消必然要新增一个 tauri 命令（`uv_cancel_op`）。
//
// 设计照抄 git 侧已验证的一套（`git_cmds.rs` 的 `GIT_NET_OPS` / `git_cancel_op` /
// `git_stop_net_ops_for_exit`）：注册表按「窗口 × 操作名」登记在途进程的取消标志与 pid，
// 流式轮询线程见标志置位即杀进程树并返回「已取消」。
//
// 为什么要能取消：建 venv 可能联网下载 CPython、装包可能解析 + 下载整套依赖闭包，慢网下
// 数分钟起步。此前唯一出路是干等或超时（600s），用户只能看着转圈猜「在下载还是卡住了」。
// 与「超时调小」的分工：超时是兜底（L-2 已按动作分级放宽），取消才是主动出路。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use tauri::WebviewWindow;

use crate::util::{kill_pid_tree, unpoison};

/// 在途 uv 操作句柄：取消标志（轮询线程持有 Arc）+ pid（退出清理同步杀树用）。
pub(crate) struct UvOp {
    cancel: Arc<AtomicBool>,
    pid: u32,
}

/// 注册表：窗口 label → 操作名 → 句柄。操作名取值见 `UvOpKind`（venv / install / upgrade / fix）。
static UV_OPS: LazyLock<Mutex<HashMap<String, HashMap<String, UvOp>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 登记一个在途操作，返回取消标志（流式轮询线程据此提前退出）。
pub(crate) fn register_uv_op(wid: &str, op: &str, pid: u32) -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    let mut ops = unpoison(UV_OPS.lock());
    ops.entry(wid.to_string()).or_default().insert(
        op.to_string(),
        UvOp { cancel: cancel.clone(), pid },
    );
    cancel
}

/// 注销（操作成功 / 失败 / 取消统一走这里）。
pub(crate) fn unregister_uv_op(wid: &str, op: &str) {
    let mut ops = unpoison(UV_OPS.lock());
    if let Some(map) = ops.get_mut(wid) {
        map.remove(op);
        if map.is_empty() {
            ops.remove(wid);
        }
    }
}

/// 取消进行中的 uv 操作（L-3）。无进行中操作时静默成功——用户可能只是点了两下，
/// 或操作恰好在点击前一瞬完成，这都不该报错。
#[tauri::command]
pub async fn uv_cancel_op(window: WebviewWindow, op: String) -> Result<(), String> {
    let wid = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let ops = unpoison(UV_OPS.lock());
        if let Some(map) = ops.get(&wid) {
            if let Some(handle) = map.get(&op) {
                handle.cancel.store(true, Ordering::Relaxed);
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

/// 应用退出清理：进行中的 uv 进程树**同步**杀灭——轮询线程的 cancel-杀树是后台路径，
/// 会被进程退出截断，孤儿 uv 会继续联网下载。同时置位全部取消标志（轮询线程若还在跑则提前退出）。
pub(crate) fn uv_stop_ops_for_exit() {
    let mut ops = unpoison(UV_OPS.lock());
    for map in ops.drain().map(|(_, m)| m) {
        for (_, handle) in map {
            handle.cancel.store(true, Ordering::Relaxed);
            kill_pid_tree(handle.pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_and_cancel_roundtrip() {
        let flag = register_uv_op("w1", "venv", 12345);
        assert!(!flag.load(Ordering::Relaxed));
        {
            let ops = unpoison(UV_OPS.lock());
            let handle = ops.get("w1").and_then(|m| m.get("venv")).expect("已登记");
            assert_eq!(handle.pid, 12345);
            handle.cancel.store(true, Ordering::Relaxed);
        }
        assert!(flag.load(Ordering::Relaxed), "取消标志应可跨持有者观察到");
        unregister_uv_op("w1", "venv");
        assert!(unpoison(UV_OPS.lock()).get("w1").is_none(), "空窗口表应一并移除");
    }

    #[test]
    fn unregister_missing_op_is_noop() {
        unregister_uv_op("nope", "venv"); // 不应 panic
    }
}
