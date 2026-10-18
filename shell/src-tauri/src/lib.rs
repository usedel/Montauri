mod dap;
mod db_cmds;
mod dep_health;
mod dep_fix;
mod edit_history;
mod env_cmds;
mod ep_sample_cmds;
mod file_ops;
mod fs_cmds;
mod git_cmds;
mod git_status;
mod git_worktree_cmds;
mod history;
mod http_cmds;
mod intel_cmds;
mod lib_cmds;
mod logging;
mod lsp;
mod openapi_cmds;
mod search_cmds;
mod scratch_cmds;
mod plugin_cmds;
mod per_window;
mod plugin_pkg;
mod proc_stats;
mod pydantic_cmds;
mod pytest_cmds;
mod run_config;
mod run_env;
mod sessions;
mod settings;
mod storage_cmds;
mod terminal;
mod tool_paths;
mod toolchain;
mod util;
mod uv_cancel;
mod watcher;
mod window_mgr;

use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::WebviewUrl;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例 + 启动路由（2026-10-10）：插件要求**首个注册**（setup 之前）。第二实例被
        // 拦截退出，argv 转发第一实例；路由按「文件 ∈ 已开工作区」判定（window_mgr）。
        // ⚠ dev 与安装版共用 identifier 互斥（想同时跑两个调试版会互拦）——已知边界，
        // 不做 debug/release 双 identifier 特判（会波及数据目录语义）。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            window_mgr::route_second_instance(app, argv);
        }))
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
                .title("Montauri")
                .inner_size(crate::util::WIN_PREF_W, crate::util::WIN_PREF_H)
                // UI-23：窗口下限（本项目窗口在 Rust 侧手动构建，故约束在这里而非 tauri.conf.json 的 app.windows）。
                // 800 不是随手取的：三栏布局的宽度下限之和 = 侧栏 180 + 编辑区 240 + 右面板 260 = 680
                // （见 style.css 的 #sidebar / #center / #right-panel 与 layout.ts 的 SIDEBAR_MIN / RIGHT_MIN），
                // 留余量后任何面板宽度组合都不会把编辑区挤没；两侧面板可 flex 收缩、拖拽上限也按窗口宽动态收口。
                // ⚠ 下调前先核对上面那组下限；⚠ 上调到 900 以上会让 UI-21 的 `@media (max-width:900px)`
                // （状态栏窄窗口降级）在打包应用内永不触发。
                .min_inner_size(crate::util::WIN_MIN_W, crate::util::WIN_MIN_H)
                .decorations(false)
                .disable_drag_drop_handler()
                .visible(false);

            // 初始几何：按主显示器近似工作区收尺寸 + 居中（修「窗口偏下、底部被切」，
            // 见 util::initial_window_geometry 的推导）；拿不到显示器信息则只居中。
            let builder = match crate::util::initial_window_geometry(app.handle()) {
                Some((pos, size)) => {
                    builder.inner_size(size.width, size.height)
                        .position(pos.x, pos.y)
                }
                None => builder.center(),
            };

            #[cfg(windows)]
            let builder = builder.data_directory(webview_dir);

            builder
                .on_page_load(|window, payload| {
                    match payload.event() {
                        PageLoadEvent::Started => {}
                        PageLoadEvent::Finished => {
                            // 落位诊断：tao 只在「给定位置落在某显示器内」时才采纳 position，
                            // 否则退回 CW_USEDEFAULT（症状=窗口偏下/底部被切）。记实际值便于事后核对。
                            if let (Ok(pos), Ok(size), Ok(scale)) = (
                                window.outer_position(),
                                window.outer_size(),
                                window.scale_factor(),
                            ) {
                                crate::logging::log_line(
                                    crate::logging::Level::Info,
                                    &format!(
                                        "[window_geom] actual_outer=({},{}) {}x{} scale={scale} (physical)",
                                        pos.x,
                                        pos.y,
                                        size.width,
                                        size.height
                                    ),
                                );
                            }
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
        // 外部打开（CSV 查看器工具栏「外部打开」）：open_path = 用系统默认程序打开文件路径。
        // 插件命令不占 #[tauri::command] 预算；前端经 invoke("plugin:opener|open_path") 调用。
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // 文件系统
            fs_cmds::read_dir,
            fs_cmds::read_file,
            fs_cmds::read_file_base64,
            fs_cmds::write_file,
            fs_cmds::delete_file,
            fs_cmds::read_templates_config,
            fs_cmds::write_templates_config,
            fs_cmds::get_user_name,
            fs_cmds::get_recent_workspaces,
            fs_cmds::add_recent_workspace,
            fs_cmds::clear_recent_workspaces,
            fs_cmds::remove_recent_workspace,
            // 启动恢复终态 + 启动参数（关闭工作区后重启不恢复 / 双击关联文件打开）
            fs_cmds::get_last_session,
            fs_cmds::set_last_session,
            fs_cmds::get_startup_file,
            fs_cmds::pick_folder,
            fs_cmds::pick_file,
            fs_cmds::find_project_root,
            fs_cmds::workspace_has_python,
            fs_cmds::create_project,
            fs_cmds::create_scratch,
            // 外部拖入文件落地（T5 · 微交互批）：base64 内容 + unique_target 防覆盖
            file_ops::write_dropped_file,
            // 检索域（2026-10-09 自 fs_cmds 拆分）：格式化 / Optimize Imports / 搜索 /
            // TODO / 别名学习 / ruff lint / 文件清单
            search_cmds::format_python,
            search_cmds::optimize_imports,
            search_cmds::search_workspace,
            search_cmds::scan_todos,
            search_cmds::scan_import_aliases,
            search_cmds::read_import_aliases,
            search_cmds::list_workspace_files,
            search_cmds::list_workspace_dirs,
            scratch_cmds::scratch_eval,
            search_cmds::ruff_lint,
            // 本地历史（P1：无 Git 工作区的保存快照 / diff / 回滚）
            history::history_snapshot,
            history::history_list,
            history::history_read,
            history::history_restore,
            history::history_clear,
            // 编辑历史采集（低延迟编辑预测数据源 V1：行对 JSONL 落盘）
            edit_history::edit_history_append,
            // asset 协议动态授权（Markdown 预览本地图片）
            util::allow_asset_dir,
            // 文件管理写操作（P25-T01）
            file_ops::create_file,
            file_ops::create_dir,
            file_ops::create_py_package,
            file_ops::rename_path,
            file_ops::trash_path,
            file_ops::copy_path,
            file_ops::paste_path,
            file_ops::reveal_in_explorer,
            file_ops::open_external,
            file_ops::copy_to_clipboard,
            // 插件域（PR-2，plugin_system_design §9.5）：开发工具插件发现/读取/监听
            plugin_cmds::list_plugin_dirs,
            plugin_cmds::read_plugin_file,
            plugin_cmds::watch_plugins_dir,
            plugin_cmds::unwatch_plugins_dir,
            plugin_cmds::reveal_plugins_dir,
            // P0 DX：真实路径查询 + 脚手架落盘
            plugin_cmds::get_plugins_dir,
            plugin_cmds::get_data_doc_path,
            plugin_cmds::scaffold_plugin,
            // P2 DX：插件包导出/导入（zip 分发）
            plugin_pkg::export_plugin,
            plugin_pkg::import_plugin,
            plugin_pkg::plugin_export_filename,
            // v1.1（§9.14）：插件日志跨重启落盘
            plugin_cmds::append_plugin_log,
            file_ops::get_recent,
            file_ops::add_recent,
            // P2：书签（行级，工作区级持久化）
            file_ops::get_bookmarks,
            file_ops::toggle_bookmark,
            file_ops::clear_bookmarks,
            // P2-11（UX 审查）：断点随工作区持久化（与书签同模式）
            file_ops::get_breakpoints,
            file_ops::set_breakpoints,
            // A-5（PyCharm 调研）：会话快照（tab / 光标 / 未保存草稿）随工作区持久化
            sessions::get_session,
            sessions::save_session,
            // A-1（PyCharm 调研）：资源可观测（外壳 + 子进程内存/CPU）
            proc_stats::proc_stats,
            // Python 环境管理（P25-T04）
            env_cmds::list_pythons,
            env_cmds::list_python_versions,
            env_cmds::pick_default_system_interpreter,
            env_cmds::create_venv,
            env_cmds::get_interpreter,
            env_cmds::set_interpreter,
            env_cmds::interpreter_version,
            env_cmds::has_pyproject,
            env_cmds::init_pyproject,
            run_config::get_run_config,
            run_config::set_run_config,
            run_config::sweep_run_configs,
            run_config::get_project_run,
            run_config::set_project_run,
            run_config::detect_project_entry,
            // 框架探针表（P1：Django / Flask / FastAPI，docs/pycharm_framework_support_report.md §8.2）
            env_cmds::detect_framework,
            env_cmds::set_framework_hint_disabled,
            env_cmds::is_framework_hint_disabled,
            // Pydantic 栈检测（F0 裁决 B：推荐切换静态引擎，bench/reports/pydantic-engine-probe.md）
            env_cmds::detect_pydantic_stack,
            // 端点扫描（F1：FastAPI / Flask 静态路由，docs/pycharm_framework_support_report.md §8.3）
            //（2026-10-09 自 fs_cmds 拆至 pydantic_cmds）
            pydantic_cmds::scan_endpoints,
            // 端点请求样例（A5①：handler 签名 + Pydantic 模型 → 可复制的 JSON 样例）
            ep_sample_cmds::scan_endpoint_sample,
            // 端点 OpenAPI 预览（A5④：拉运行中服务 /openapi.json → 扁平操作列表）
            openapi_cmds::fetch_openapi,
            // 运行时热点（A1：probe trace 库 + 项目函数定义差集，交付记录见 docs/delivery-overview.md §2）
            intel_cmds::scan_runtime_hotspots,
            // Pydantic 语义层（阶段 4：构造校验诊断 + rename 传播补充，docs/pyrefly_pydantic_support_plan.md §3.4）
            //（2026-10-09 自 fs_cmds 拆至 pydantic_cmds）
            pydantic_cmds::scan_pydantic_issues,
            pydantic_cmds::scan_pydantic_ctor_refs,
            env_cmds::list_packages,
            env_cmds::list_outdated,
            env_cmds::pip_install,
            env_cmds::pip_uninstall,
            env_cmds::pip_upgrade,
            env_cmds::check_missing_imports,
            // Python 求值桥（库特别支持 PR-1：正则/格式串/参数表单的受控脚本求值）
            lib_cmds::py_eval,
            // 依赖健康（dep health M1，docs/dep_health_dev_plan.md）
            dep_health::dep_style,
            // dep 域后半段（dep_fix.rs）：dep_scan / 环境快照 / 修复动作 / 忽略清单
            dep_fix::dep_scan,
            dep_fix::dep_env_snapshot,
            dep_fix::dep_fix,
            dep_fix::dep_ignore_list,
            dep_fix::dep_ignore_add,
            dep_fix::dep_ignore_remove,
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
            // 集成终端（Phase 4）
            terminal::term_spawn,
            terminal::list_shells,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_kill,
            terminal::term_kill_all,
            // v3.4 §17-12：统一运行入口（真 TTY：getpass / tqdm / rich / 彩色 / Ctrl+C）
            terminal::run_in_terminal,
            // 调试（DAP / debugpy，docs/python_debug_dev_plan.md）
            dap::debug_detect,
            dap::debug_start,
            dap::debug_attach_debuggee,
            dap::debug_stop,
            dap::dap_send_request,
            dap::dap_send_notification,
            dap::dap_send_response,
            // 文件监听（体验优化）
            watcher::watch_start,
            watcher::watch_stop,
            // 多窗口（阶段 2）：新开项目窗口 + 窗口项目目录反查
            window_mgr::open_workspace_window,
            window_mgr::get_window_project,
            // 单实例路由配套：主窗口工作区上报 + 新窗口 pending 启动文件 take
            window_mgr::report_main_workspace,
            window_mgr::take_startup_file,
            // Git 状态
            git_status::git_status,
            // Git 写操作（暂存/取消暂存/提交/diff/分支）
            git_cmds::git_stage,
            git_cmds::git_unstage,
            git_cmds::git_discard,
            git_cmds::git_clean,
            git_cmds::git_accept_current,
            git_cmds::git_accept_incoming,
            git_cmds::git_commit,
            git_cmds::git_branches,
            git_cmds::git_checkout,
            git_cmds::git_create_branch,
            // Git 集成增强（TD-002）：行内 diff / 远程操作 / stash / log / blame
            git_cmds::git_diff_versions,
            git_cmds::git_conflict_versions,
            git_cmds::git_push,
            git_cmds::git_pull,
            git_cmds::git_fetch,
            git_cmds::git_stash_push,
            git_cmds::git_stash_pop,
            git_cmds::git_stash_list,
            git_cmds::git_stash_pop_at,
            git_cmds::git_stash_drop_at,
            git_cmds::git_log,
            git_cmds::git_blame,
            git_cmds::git_show,
            git_cmds::git_log_file,
            git_cmds::git_init,
            git_cmds::git_diff_hunks,
            git_cmds::git_apply_hunk,
            // Git 高级工作流（迭代 3：cherry-pick/revert/reset/merge/rebase/tag/同步计数）
            git_cmds::git_sync_status,
            git_cmds::git_cherry_pick,
            git_cmds::git_revert,
            git_cmds::git_reset,
            git_cmds::git_merge,
            git_cmds::git_rebase,
            git_cmds::git_abort_op,
            git_cmds::git_tags,
            git_cmds::git_create_tag,
            git_cmds::git_stash_show,
            git_cmds::git_create_branch_at,
            // Git 远程与深度（迭代 4：remote 管理 + 流式可取消网络操作 + 凭据指引）
            git_cmds::git_remote_list,
            git_cmds::git_remote_add,
            git_cmds::git_remote_remove,
            git_cmds::git_cancel_op,
            uv_cancel::uv_cancel_op,
            // Git worktree（迭代 5 · P2-9）+ Clone（迭代 6 · P3-1）
            //（2026-10-09 自 git_cmds 拆至 git_worktree_cmds）
            git_worktree_cmds::git_worktree_list,
            git_worktree_cmds::git_worktree_add,
            git_worktree_cmds::git_worktree_remove,
            git_worktree_cmds::git_clone,
            git_worktree_cmds::git_default_branch,
            // B3（docs/sqlite_tool_dev_plan.md）：SQLite 数据库工具窗
            // PR-1：连接骨架 + 列表持久化
            db_cmds::db_open,
            db_cmds::db_close,
            db_cmds::db_connections_load,
            db_cmds::db_connections_save,
            // PR-2：查询内核（对象树 / 执行 / 取消 / DDL）
            db_cmds::db_list_objects,
            db_cmds::db_query,
            db_cmds::db_rows,
            db_cmds::db_cancel,
            db_cmds::db_ddl,
            // B4（docs/toolbox_dev_plan.md §5）：HTTP 客户端内核（PR-B4-1）
            http_cmds::http_send,
            http_cmds::http_cancel,
            // pytest 测试运行器（docs/pytest_dev_plan.md）：四动作合一单命令
            // （scan / collect / cancel / result）——运行走 run_in_terminal kind="test"，不占命令面
            pytest_cmds::pytest_action,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // CR-14：应用退出统一清理——直接关窗/崩溃时 LSP 引擎、终端 PTY、运行中脚本、
            // 文件监听不再依赖前端主动调用（前端可能已死），防子进程成孤儿。
            if let tauri::RunEvent::Exit = event {
                crate::logging::log_line(
                    crate::logging::Level::Info,
                    "[exit] 清理子进程与监听：lsp / terminal / run / dap / watcher / git-net / plugins / db",
                );
                watcher::watch_stop_all_for_exit();
                dap::debug_stop_for_exit();
                terminal::term_kill_all_for_exit(); // v3.4 §17-16：运行全走 PTY，运行进程清理随会话统一承担
                lsp::lsp_stop_all_for_exit();
                git_cmds::git_stop_net_ops_for_exit(); // P2-6：进行中的 push/pull/fetch 同步杀树
                uv_cancel::uv_stop_ops_for_exit(); // L-3：进行中的建环境 / 装包 / 升级 / dep_fix 同步杀树
                plugin_cmds::plugins_stop_watcher_for_exit(); // P2-6：插件目录 watcher
                db_cmds::db_stop_for_exit(); // B3：SQLite 连接（句柄释放，防锁库）
                http_cmds::http_stop_for_exit(); // B4：在途 HTTP 请求（置取消标志，防线程悬挂）
                pytest_cmds::collect_stop_for_exit(); // pytest collect 子进程（非 PTY 会话，退出钩子统杀树）
            }
        });
}
