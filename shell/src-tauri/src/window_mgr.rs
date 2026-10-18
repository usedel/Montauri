//! 多窗口管理（阶段 2）：新开项目窗口 + 窗口→项目目录映射 + 窗口销毁清理。
//! 遵循「一窗口一项目」：label = project_hash(绝对路径)，已存在则聚焦去重。
//!
//! 单实例路由（2026-10-10）：第二实例的 argv 经 lib.rs 的 single-instance 回调进入
//! `route_second_instance`——按「文件 ∈ 已开工作区」前缀判定路由：命中聚焦+emit，
//! 未命中开新项目窗口（初始文件经 pending 槽透传，新窗口启动时 take）。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::file_ops::project_hash;
use crate::util::unpoison;

/// label（= project_hash 或 "main"）→ 项目绝对路径
static WINDOW_PROJECTS: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// 新开项目窗口的「初始启动文件」pending 槽（label → 文件路径，take 即清）。
/// 单实例路由开新窗口时写入；新窗口前端 `openInitialWorkspace` 时经 take_startup_file 取走。
static PENDING_STARTUP_FILES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// 主窗口工作区上报（前端 openWorkspace/closeWorkspace 时调用；主窗口的 workspaceRoot
/// 只存在前端内存里，Rust 侧路由需要它）。workspace=null = 主窗口无工作区。
/// **label 守卫**：只有主窗口（label="main"）能写本条目——项目窗口的 openWorkspace
/// 也会走到 main.ts 的上报调用，不守卫会污染主窗口条目（路由误判到错误窗口）。
#[tauri::command]
pub fn report_main_workspace(window: tauri::WebviewWindow, workspace: Option<String>) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(()); // 项目窗口的注册表条目由 open_workspace_window 维护，不经此上报
    }
    let mut m = unpoison(WINDOW_PROJECTS.lock());
    match workspace {
        Some(ws) => {
            m.insert("main".to_string(), ws);
        }
        None => {
            m.remove("main");
        }
    }
    Ok(())
}

/// 取走本窗口的 pending 启动文件（单实例路由开新窗口时透传；take 即清防重复打开）。
#[tauri::command]
pub fn take_startup_file(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    Ok(unpoison(PENDING_STARTUP_FILES.lock()).remove(window.label()))
}

/// 路径归一比较：小写 + 统一 `/` 分隔（Windows 大小写不敏感 + 混用分隔符防御）。
fn norm_path(p: &str) -> String {
    p.to_lowercase().replace('\\', "/")
}

/// 判定 file 是否落在 dir 目录树内（路径前缀包含：`dir` 或 `dir/…`）。
fn is_under(file: &str, dir: &str) -> bool {
    let (f, d) = (norm_path(file), norm_path(dir));
    let d = d.trim_end_matches('/');
    f == d || f.starts_with(&format!("{d}/"))
}

/// 单实例路由（lib.rs 的 on_second_instance 回调进入）：
/// - 无文件参数 → 聚焦任一已有窗口（用户就是想「把 Montauri 带到前台」）。
/// - 有文件 → 查窗口注册表找「文件 ∈ 已开工作区」的窗口：命中则聚焦 + emit startup-file
///   （前端 openFile）；未命中则 find_project_root 探测根 → 开新项目窗口（同进程多窗口，
///   去重内建）+ pending 槽透传初始文件。
pub fn route_second_instance(app: &AppHandle, argv: Vec<String>) {
    let file = crate::fs_cmds::extract_startup_file(&argv);
    let Some(file) = file else {
        if let Some(win) = app.get_webview_window("main").or_else(|| app.webview_windows().values().next().cloned()) {
            let _ = win.set_focus();
        }
        return;
    };

    // 命中判定：文件落在某窗口的工作区目录树内（含主窗口——经 report_main_workspace 上报）
    let hit = {
        let m = unpoison(WINDOW_PROJECTS.lock());
        m.iter().find(|(_, ws)| is_under(&file, ws)).map(|(label, _)| label.clone())
    };

    if let Some(label) = hit {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_focus();
            // 双通道投递（防「emit 早于前端 listen 注册」丢失——项目窗口从 build 到 init
            // 注册 listen 有 1-3s 窗口，期间事件无声丢失）：
            //   ① emit_to 定向（项目纪律「禁全局 emit」，广播会让所有窗口都打开该文件）
            //   ② pending 槽兜底——前端 wireStartupFileEvent 注册 listen 时先 take 一次
            // listen 回调先清槽，保证同一次路由只有一条路径生效（不会重复打开）
            unpoison(PENDING_STARTUP_FILES.lock()).insert(label.clone(), file.clone());
            let _ = app.emit_to(&label, "startup-file", &file);
            return;
        }
        // 注册表有但窗口已销毁（销毁钩子竞态）→ 走下方开新窗口兜底
    }

    // 未命中任何已开工作区 → 探测根开新项目窗口；文件经 pending 槽给新窗口
    if let Ok((root, _fallback)) = crate::fs_cmds::find_project_root(&file) {
        let label = project_hash(&root);
        // 去重：探测根的窗口恰好已存在（注册表竞态兜底）→ 聚焦 + emit，不再开新窗
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_focus();
            unpoison(PENDING_STARTUP_FILES.lock()).insert(label.clone(), file.clone());
            let _ = app.emit_to(&label, "startup-file", &file);
            return;
        }
        unpoison(PENDING_STARTUP_FILES.lock()).insert(label.clone(), file);
        let app = app.clone();
        // open_workspace_window 是 async（同步上下文里 build() 死锁，§2.4 探针 #2）；
        // 失败时清 pending 防槽位泄漏（下次同 label 窗口会误开旧文件）
        tauri::async_runtime::spawn(async move {
            if let Err(e) = open_workspace_window(app, root).await {
                unpoison(PENDING_STARTUP_FILES.lock()).remove(&label);
                crate::logging::log_line(
                    crate::logging::Level::Warn,
                    &format!("[single-instance] 打开项目窗口失败：{e}"),
                );
            }
        });
    }
}

/// 打开项目窗口：label = project_hash(path)，已存在则聚焦，不存在则新建。
/// 必须 `async fn`：同步命令里 `WebviewWindowBuilder::build()` 死锁（§2.4 探针 #2）。
#[tauri::command]
pub async fn open_workspace_window(app: AppHandle, path: String) -> Result<(), String> {
    let label = project_hash(&path);

    // 去重：同名项目窗口已存在 → 仅聚焦
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_focus();
        return Ok(());
    }

    // 复刻主窗口构建配置（lib.rs 建窗处）：隐藏待页面加载完成后显示（防 FOUC），
    // 尺寸常量与初始几何（按主显示器工作区收尺寸 + 居中）统一走 util，避免两处漂移。
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Montauri")
        .inner_size(crate::util::WIN_PREF_W, crate::util::WIN_PREF_H)
        .min_inner_size(crate::util::WIN_MIN_W, crate::util::WIN_MIN_H)
        .decorations(false)
        .disable_drag_drop_handler()
        .visible(false);

    let builder = match crate::util::initial_window_geometry(&app) {
        Some((pos, size)) => builder
            .inner_size(size.width, size.height)
            .position(pos.x, pos.y),
        None => builder.center(),
    };

    // 与主窗口共享同一 WebView2 数据目录（同一 profile，多 Webview 共享是常态）：
    // 应用级 UI 偏好经 localStorage 共享；窗口/项目级状态走 Rust storage 按 root 落盘。
    #[cfg(windows)]
    let builder = builder.data_directory(crate::util::webview_data_dir());

    let win = builder
        .on_page_load(|window, payload| {
            if let PageLoadEvent::Finished = payload.event() {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    let label_for_close = label.clone();
    unpoison(WINDOW_PROJECTS.lock()).insert(label, path);

    // 窗口销毁时统一清理：移除映射 + 停该窗口 LSP/终端/调试/文件监听
    win.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            cleanup_window(&label_for_close);
        }
    });

    Ok(())
}

/// 返回本窗口的项目目录（label 反查；主窗口 / 无项目窗口返回 null）。
#[tauri::command]
pub fn get_window_project(window: tauri::WebviewWindow) -> Option<String> {
    unpoison(WINDOW_PROJECTS.lock()).get(window.label()).cloned()
}

/// 窗口销毁的统一清理：移除映射 + 各域按 wid 清理资源。
fn cleanup_window(wid: &str) {
    unpoison(WINDOW_PROJECTS.lock()).remove(wid);
    unpoison(PENDING_STARTUP_FILES.lock()).remove(wid);
    crate::lsp::lsp_stop_for_window(wid);
    crate::terminal::term_kill_all_for_window(wid);
    crate::dap::debug_stop_for_window(wid);
    crate::watcher::watch_stop_impl(wid);
}

#[cfg(test)]
mod route_tests {
    use super::*;

    #[test]
    fn is_under_matches_child_and_self() {
        assert!(is_under("D:\\proj\\src\\a.py", "D:\\proj"));
        assert!(is_under("D:\\proj\\a.py", "D:\\proj\\"));
        assert!(is_under("D:/proj/a.py", "d:/PROJ"));
        assert!(is_under("D:\\proj", "D:\\proj"));
        // 前缀字符串相同但目录不同：D:\project-x 不能命中 D:\proj
        assert!(!is_under("D:\\project-x\\a.py", "D:\\proj"));
        assert!(!is_under("D:\\other\\a.py", "D:\\proj"));
    }
}
