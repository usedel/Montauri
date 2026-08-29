// 跨模块共享工具：用户目录定位 + Windows 无窗口子进程启动。
// 消除 file_ops / env_cmds / lsp / settings 中重复的 data_root 与 no_window 实现。

use std::path::PathBuf;

/// 用户主目录（Windows 为 USERPROFILE/HOME）。
/// 固定指向系统用户目录。
/// 用于 uv 官方脚本默认安装位置 `~/.local/bin` 等用户级路径。
pub(crate) fn user_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// OpenCharm 数据根目录，进程内只探测一次（OnceLock 缓存）。
///
/// 决策顺序（三级，无便携形态，跨平台无注册表依赖）：
/// 1. `OPENCHARM_DATA_ROOT` 环境变量（仅开发 / 测试 / 高级用户重定向，应用自身不写入）；
/// 2. 数据根指针文件（首启落位提示 / 迁移向导写入，见 `data_root_pointer`）；
/// 3. 平台默认：Windows 为 `%LOCALAPPDATA%\OpenCharm`（Known Folders 惯例）。
pub(crate) fn data_root() -> &'static PathBuf {
    static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    ROOT.get_or_init(resolve_data_root)
}

/// 数据根指针文件目录：平台标准配置目录（与数据根解耦——指针只有几十字节，
/// 落在系统盘无妨；真正的大体积数据按指针指向落盘，跨平台无注册表/环境变量依赖）。
/// Windows: `%APPDATA%\OpenCharm`；Linux: `$XDG_CONFIG_HOME/opencharm`；
/// macOS: `~/Library/Application Support/OpenCharm`。
pub(crate) fn pointer_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("APPDATA")
            .map(|d| PathBuf::from(d).join("OpenCharm"))
            .unwrap_or_else(|_| user_home().join("AppData").join("Roaming").join("OpenCharm"))
    }
    #[cfg(target_os = "macos")]
    {
        user_home().join("Library").join("Application Support").join("OpenCharm")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var("XDG_CONFIG_HOME")
            .map(|d| PathBuf::from(d).join("opencharm"))
            .unwrap_or_else(|_| user_home().join(".config").join("opencharm"))
    }
}

/// 数据根指针文件（内容 = 数据根绝对路径；不存在 = 用平台默认）。
pub(crate) fn data_root_pointer() -> PathBuf {
    pointer_dir().join("data-root")
}

fn resolve_data_root() -> PathBuf {
    // 1. 显式环境变量覆盖（仅开发 / 测试 / 高级用户，应用自身不写入环境变量）
    if let Ok(dir) = std::env::var("OPENCHARM_DATA_ROOT") {
        let p = PathBuf::from(dir.trim());
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    // 2. 指针文件（首启落位提示 / 迁移向导写入）
    if let Ok(s) = std::fs::read_to_string(data_root_pointer()) {
        let p = PathBuf::from(s.trim());
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    // 3. 平台默认：Known Folders（Windows %LOCALAPPDATA%\OpenCharm）
    std::env::var("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("OpenCharm"))
        .unwrap_or_else(|_| user_home().join("OpenCharm"))
}

/// OpenCharm 用户数据根（即 data_root）。
/// 各模块在此目录下按功能划分子目录（config/ workspaces/ recent/ traces/
/// runtime/ webview/ logs/），不要把文件平铺到根目录。
pub(crate) fn opencharm_home() -> PathBuf {
    data_root().to_path_buf()
}

/// WebView2 用户数据目录（localStorage / Cookie / 缓存落盘位置，仅 Windows WebView2 使用）。
#[cfg(windows)]
pub(crate) fn webview_data_dir() -> PathBuf {
    opencharm_home().join("webview")
}

/// 诊断日志目录（按天轮转，保留 14 天，见 logging.rs）。
pub(crate) fn logs_dir() -> PathBuf {
    opencharm_home().join("logs")
}

/// Windows 下为子进程附加 CREATE_NO_WINDOW，避免弹出控制台窗口；其他平台原样返回。
#[cfg(windows)]
pub(crate) fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
pub(crate) fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    cmd
}

/// 取出被 panic 污染的锁（poisoned lock），避免一个线程 panic 后连锁导致后续请求全部 panic。
/// 临界区内无 panic 点，poison 仅在异常发生时出现——宁可继续也不让请求整体挂掉。
pub(crate) fn unpoison<T>(r: std::sync::LockResult<T>) -> T {
    r.unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 终止子进程**及其全部子孙进程**并回收（同步阻塞）。
///
/// 只 `child.kill()` 会杀掉直接子进程（如 `uv run` / 解释器），但 uv 拉起的 python 脚本、
/// shell 再 spawn 的子进程会变成孤儿继续运行（停止按钮失效）。Windows 用
/// `taskkill /T /F` 杀进程树；其他平台仅杀直接子进程。
///
/// 阻塞直到进程树被终结并回收。调用方需自行确保不会被 `kill_process_tree` 阻塞数秒
/// （如关闭工作区场景应改用 [`kill_process_tree_async`]）。
pub(crate) fn kill_process_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// 同 [`kill_process_tree`]，但异步：阻塞性的 `taskkill` + 回收（`child.wait()`）全部移到
/// 后台线程执行并对回收加超时，函数立即返回。
///
/// 供关闭工作区 / 停止 LSP 引擎等**不应阻塞 UI** 的场景使用；需要同步确保子进程已退出的
/// 场景（如超时/出错后紧接着 join 输出线程）仍应使用 [`kill_process_tree`]。
pub(crate) fn kill_process_tree_async(child: std::process::Child) {
    // taskkill 的 PID 先取出（进程树终结后 child.id() 可能失效）。
    let pid = child.id();

    // taskkill 对庞杂进程树可能耗时数秒，必须在后台线程执行，否则仍会阻塞调用方（lsp_stop）。
    std::thread::spawn(move || {
        let t0 = std::time::Instant::now();
        #[cfg(windows)]
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        let mut child = child;
        #[cfg(not(windows))]
        let _ = child.kill();

        // 回收进程句柄，最多等 RETRIES 次共 ~1s，避免子进程迟迟不退出而卡住。
        const RETRIES: usize = 10;
        for _ in 0..RETRIES {
            match child.try_wait() {
                Ok(Some(_)) => {
                    crate::logging::log_line(
                        crate::logging::Level::Info,
                        &format!("[kill_async] pid={pid} reaped, took={:?}", t0.elapsed()),
                    );
                    return;
                }
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                Err(_) => {
                    crate::logging::log_line(
                        crate::logging::Level::Warn,
                        &format!("[kill_async] pid={pid} wait err, took={:?}", t0.elapsed()),
                    );
                    return;
                }
            }
        }
        crate::logging::log_line(
            crate::logging::Level::Warn,
            &format!("[kill_async] pid={pid} timeout(~1s), gave up"),
        );
    });
}