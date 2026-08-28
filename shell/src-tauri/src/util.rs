// 跨模块共享工具：用户目录定位 + Windows 无窗口子进程启动。
// 消除 file_ops / env_cmds / lsp / settings 中重复的 opencharm_home 与 no_window 实现。

use std::path::PathBuf;

/// 用户主目录（Windows 为 USERPROFILE/HOME）。
/// 固定指向系统用户目录，不随便携/安装目录模式改变。
/// 用于 uv 官方脚本默认安装位置 `~/.local/bin` 等用户级路径。
pub(crate) fn user_home() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

/// OpenCharm 数据根目录（不含 `.opencharm` 段），进程内只探测一次（OnceLock 缓存）。
///
/// 决策顺序：
/// 1. `OPENCHARM_DATA_ROOT` 环境变量（调试 / 便携自定义）；
/// 2. 可执行文件所在目录——存在 `opencharm.portable` 标记，或该目录可写
///    （绿色版 / 安装到非系统盘时数据与程序同盘，删目录即卸载）；
/// 3. 回退用户主目录（安装目录无写权限等场景，保持历史行为）。
pub(crate) fn data_root() -> &'static PathBuf {
    static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    ROOT.get_or_init(resolve_data_root)
}

fn resolve_data_root() -> PathBuf {
    // 1. 显式环境变量覆盖（最高优先级）
    if let Ok(dir) = std::env::var("OPENCHARM_DATA_ROOT") {
        let p = PathBuf::from(dir.trim());
        if !p.as_os_str().is_empty() {
            return p;
        }
    }
    // 2. 可执行文件目录：便携标记 或 目录可写
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join("opencharm.portable").is_file() || dir_writable(dir) {
                return dir.to_path_buf();
            }
        }
    }
    // 3. 回退用户主目录
    user_home()
}

/// 探针式可写检测：写临时空文件成功后删除。结果仅用于数据根决策。
fn dir_writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(format!(".opencharm-wprobe-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// OpenCharm 用户数据目录 `<data_root>/.opencharm`。
/// 各模块在此目录下按功能划分子目录（config/ workspaces/ recent/ traces/ envs/
/// bin/ runtime/ cache/ webview/），不要把文件平铺到根目录。
pub(crate) fn opencharm_home() -> PathBuf {
    data_root().join(".opencharm")
}

/// WebView2 用户数据目录（localStorage / Cookie / 缓存落盘位置，仅 Windows WebView2 使用）。
#[cfg(windows)]
pub(crate) fn webview_data_dir() -> PathBuf {
    opencharm_home().join("webview")
}

/// uv 下载/构建缓存目录（仅对 OpenCharm 引导安装的 uv 生效，见 tool_paths.rs）。
pub(crate) fn uv_cache_dir() -> PathBuf {
    opencharm_home().join("cache").join("uv")
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

/// 终止子进程**及其全部子孙进程**并回收。
///
/// 只 `child.kill()` 会杀掉直接子进程（如 `uv run` / 解释器），但 uv 拉起的 python 脚本、
/// shell 再 spawn 的子进程会变成孤儿继续运行（停止按钮失效）。Windows 用
/// `taskkill /T /F` 杀进程树；其他平台仅杀直接子进程。
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