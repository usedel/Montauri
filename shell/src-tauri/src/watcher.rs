// 文件系统监听（File Watcher）：notify crate 监听工作区变更，推送事件到前端增量刷新。
// 设计要点：
// - 使用 notify-debouncer-mini 做 300ms 防抖，避免批量操作（如 git checkout）触发风暴；
// - 过滤 .git/.venv/node_modules 等噪声目录；
// - 前端收到事件后只刷新受影响的目录（增量），不整树重载。

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, Debouncer};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::util::{opencharm_home, unpoison};

/// 忽略的目录名（与 fs_cmds::read_dir 的 IGNORED 保持一致）
const WATCH_IGNORED: [&str; 6] = [".git", ".venv", "node_modules", "__pycache__", ".idea", ".vscode"];

/// 忽略的文件名前缀（CR-05：选区运行临时文件，写删都不触发树刷新/Git 幽灵变更）
const WATCH_IGNORED_PREFIXES: [&str; 1] = ["__opencharm_selection__"];

/// 全局 watcher 实例（同一时刻只监听一个工作区）
static WATCHER: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>> = Mutex::new(None);

/// 判断路径是否应被忽略（任一层级命中忽略目录或忽略文件名前缀即跳过）
fn should_ignore(path: &Path) -> bool {
    if path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        WATCH_IGNORED.contains(&name.as_ref())
    }) {
        return true;
    }
    path.file_name()
        .map(|n| {
            let name = n.to_string_lossy();
            WATCH_IGNORED_PREFIXES.iter().any(|p| name.starts_with(p))
        })
        .unwrap_or(false)
}

/// 启动文件监听（停止旧监听 → 新建 debouncer → 监听工作区根目录）
#[tauri::command]
pub fn watch_start(app: AppHandle, root: String) -> Result<(), String> {
    // 先停止旧的
    watch_stop_impl();

    let root_path = Path::new(&root).to_path_buf();
    let app_handle = app.clone();

    let mut debouncer = new_debouncer(
        std::time::Duration::from_millis(300),
        move |res: Result<Vec<DebouncedEvent>, notify_debouncer_mini::notify::Error>| {
            let events = match res {
                Ok(evts) => evts,
                Err(_) => return,
            };
            // 收集受影响的目录（去重）
            let mut dirs: Vec<String> = Vec::new();
            for ev in &events {
                if should_ignore(&ev.path) {
                    continue;
                }
                // 取变更路径的父目录（文件变更 → 刷新其所在目录）
                let dir = if ev.path.is_dir() {
                    ev.path.clone()
                } else {
                    ev.path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| ev.path.clone())
                };
                let dir_str = dir.to_string_lossy().to_string();
                if !dirs.contains(&dir_str) {
                    dirs.push(dir_str);
                }
            }
            if !dirs.is_empty() {
                let _ = app_handle.emit("fs-changed", dirs);
            }
        },
    )
    .map_err(|e| format!("创建文件监听器失败：{e}"))?;

    debouncer
        .watcher()
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("监听目录失败：{e}"))?;

    // 附加监听用户级 Live Templates 目录（M2 热重载）；目录不存在时静默跳过
    let lt_dir = opencharm_home().join("config");
    if lt_dir.is_dir() {
        let _ = debouncer.watcher().watch(&lt_dir, RecursiveMode::NonRecursive);
    }

    let mut guard = unpoison(WATCHER.lock());
    *guard = Some(debouncer);
    Ok(())
}

/// 停止文件监听
#[tauri::command]
pub fn watch_stop() -> Result<(), String> {
    watch_stop_impl();
    Ok(())
}

fn watch_stop_impl() {
    let mut guard = unpoison(WATCHER.lock());
    *guard = None; // drop debouncer → 自动停止监听
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CR-05：选区运行临时文件（随机后缀）与忽略目录都不得触发树刷新。
    #[test]
    fn test_should_ignore_selection_temp_and_noise_dirs() {
        // 选区临时文件：任意随机后缀都被前缀规则忽略
        assert!(should_ignore(Path::new(
            r"C:\ws\proj\__opencharm_selection__lx2k-a1b2c3.py"
        )));
        assert!(should_ignore(Path::new(
            r"C:\ws\proj\pkg\__opencharm_selection__9f8e7d-x0y9.py"
        )));
        // 噪声目录：任一层级命中即忽略
        assert!(should_ignore(Path::new(r"C:\ws\proj\.git\HEAD")));
        assert!(should_ignore(Path::new(r"C:\ws\proj\.venv\Scripts\python.exe")));
        assert!(should_ignore(Path::new(r"C:\ws\proj\sub\node_modules\x.js")));
        // 正常项目文件：不忽略
        assert!(!should_ignore(Path::new(r"C:\ws\proj\main.py")));
        assert!(!should_ignore(Path::new(r"C:\ws\proj\pkg\util.py")));
        // 前缀相似但不同的文件：不忽略（避免误伤用户以 __opencharm 开头的文件）
        assert!(!should_ignore(Path::new(r"C:\ws\proj\__opencharm_config__.py")));
    }
}
