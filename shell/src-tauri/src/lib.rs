mod env_cmds;
mod file_ops;
mod fs_cmds;
mod git_cmds;
mod git_status;
mod logging;
mod lsp;
mod settings;
mod storage_cmds;
mod terminal;
mod tool_paths;
mod toolchain;
mod util;
mod watcher;

use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::WebviewUrl;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 手动创建主窗口：初始隐藏（visible:false），待页面加载完成（DOM/CSS 就绪）后再显示，
            // 消除启动白屏 / 无样式闪烁（FOUC）。相比前端 JS 调用 show()，此处由 Rust 侧监听
            // WebView 的页面加载事件可靠触发，不依赖 WebView 内脚本是否执行到位。
            // WebView2 用户数据目录随 data_root 落盘（便携/非系统盘安装时与程序同盘），
            // localStorage / Cookie / 缓存不再写系统盘 AppData（仅 Windows 有效）。
            #[cfg(windows)]
            let webview_dir = crate::util::webview_data_dir();
            #[cfg(windows)]
            std::fs::create_dir_all(&webview_dir)?;

            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("OpenCharm")
                .inner_size(1280.0, 800.0)
                .min_inner_size(800.0, 600.0)
                .decorations(false)
                .disable_drag_drop_handler()
                .visible(false);

            #[cfg(windows)]
            let builder = builder.data_directory(webview_dir);

            builder
                .on_page_load(|window, payload| {
                    match payload.event() {
                        PageLoadEvent::Started => {}
                        PageLoadEvent::Finished => {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build()?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            // 文件系统
            fs_cmds::read_dir,
            fs_cmds::read_file,
            fs_cmds::write_file,
            fs_cmds::read_templates_config,
            fs_cmds::write_templates_config,
            fs_cmds::get_user_name,
            fs_cmds::get_recent_workspaces,
            fs_cmds::add_recent_workspace,
            fs_cmds::clear_recent_workspaces,
            fs_cmds::remove_recent_workspace,
            fs_cmds::pick_folder,
            fs_cmds::create_project,
            fs_cmds::format_python,
            fs_cmds::search_workspace,
            // 文件管理写操作（P25-T01）
            file_ops::create_file,
            file_ops::create_dir,
            file_ops::create_py_package,
            file_ops::rename_path,
            file_ops::trash_path,
            file_ops::copy_path,
            file_ops::paste_path,
            file_ops::reveal_in_explorer,
            file_ops::copy_to_clipboard,
            file_ops::get_recent,
            file_ops::add_recent,
            // Python 环境管理（P25-T04）
            env_cmds::list_pythons,
            env_cmds::list_python_versions,
            env_cmds::pick_default_system_interpreter,
            env_cmds::create_venv,
            env_cmds::get_interpreter,
            env_cmds::set_interpreter,
            env_cmds::list_packages,
            env_cmds::list_outdated,
            env_cmds::pip_install,
            env_cmds::pip_uninstall,
            env_cmds::pip_upgrade,
            env_cmds::check_missing_imports,
            // 全局设置（P25-T08/T09）
            settings::get_settings,
            settings::set_settings,
            // 日志（TD-007 扩展：设置面板「日志」分类）
            logging::open_log_dir,
            logging::open_data_dir,
            // 磁盘占用治理（docs/disk-space-plan.md：存储页 + 首启落位 + 迁移）
            storage_cmds::storage_usage,
            storage_cmds::clean_traces,
            storage_cmds::clean_webview_cache,
            storage_cmds::clean_log_rotation,
            storage_cmds::uv_cache_clean,
            storage_cmds::first_run_status,
            storage_cmds::ack_first_run,
            storage_cmds::set_data_root,
            storage_cmds::migrate_data_root,
            storage_cmds::restart_app,
            // 工具链引导（Phase 4 第 4 步：探测 + 一键安装 uv/pyrefly/basedpyright）
            toolchain::detect_toolchain,
            toolchain::install_toolchain,
            // LSP 桥
            lsp::lsp_start,
            lsp::lsp_send_request,
            lsp::lsp_send_notification,
            lsp::lsp_send_response,
            lsp::lsp_stop,
            lsp::get_intel_info,
            // 运行
            lsp::run_script,
            lsp::stop_script,
            // 集成终端（Phase 4）
            terminal::term_spawn,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_kill,
            terminal::term_kill_all,
            // 文件监听（体验优化）
            watcher::watch_start,
            watcher::watch_stop,
            // Git 状态
            git_status::git_status,
            // Git 写操作（暂存/取消暂存/提交/diff/分支）
            git_cmds::git_stage,
            git_cmds::git_unstage,
            git_cmds::git_commit,
            git_cmds::git_diff,
            git_cmds::git_branches,
            git_cmds::git_checkout,
            git_cmds::git_create_branch,
            // Git 集成增强（TD-002）：行内 diff / 远程操作 / stash / log / blame
            git_cmds::git_diff_versions,
            git_cmds::git_push,
            git_cmds::git_pull,
            git_cmds::git_fetch,
            git_cmds::git_stash_push,
            git_cmds::git_stash_pop,
            git_cmds::git_stash_list,
            git_cmds::git_log,
            git_cmds::git_blame,
            git_cmds::git_show,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
