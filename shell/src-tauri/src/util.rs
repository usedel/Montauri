// 跨模块共享工具：用户目录定位 + Windows 无窗口子进程启动 + 字节流增量 UTF-8 解码。
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

/// Montauri 数据根目录，进程内只探测一次（OnceLock 缓存）。
///
/// 决策顺序（三级，无便携形态，跨平台无注册表依赖）：
/// 1. `MONTAURI_DATA_ROOT` 环境变量（仅开发 / 测试 / 高级用户重定向，应用自身不写入）；
/// 2. 数据根指针文件（首启落位提示 / 迁移向导写入，见 `data_root_pointer`）；
/// 3. 平台默认：Windows 为 `%LOCALAPPDATA%\Montauri`（Known Folders 惯例）。
pub(crate) fn data_root() -> &'static PathBuf {
    static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    ROOT.get_or_init(resolve_data_root)
}

/// 数据根指针文件目录：平台标准配置目录（与数据根解耦——指针只有几十字节，
/// 落在系统盘无妨；真正的大体积数据按指针指向落盘，跨平台无注册表/环境变量依赖）。
/// Windows: `%APPDATA%\Montauri`；Linux: `$XDG_CONFIG_HOME/montauri`；
/// macOS: `~/Library/Application Support/Montauri`。
pub(crate) fn pointer_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("APPDATA")
            .map(|d| PathBuf::from(d).join("Montauri"))
            .unwrap_or_else(|_| user_home().join("AppData").join("Roaming").join("Montauri"))
    }
    #[cfg(target_os = "macos")]
    {
        user_home().join("Library").join("Application Support").join("Montauri")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::env::var("XDG_CONFIG_HOME")
            .map(|d| PathBuf::from(d).join("montauri"))
            .unwrap_or_else(|_| user_home().join(".config").join("montauri"))
    }
}

/// 数据根指针文件（内容 = 数据根绝对路径；不存在 = 用平台默认）。
/// v1「OpenCharm」→ v2「Montauri」一次性迁移：旧指针存在则复制过来，
/// 保住自定义数据根用户的指向（复制而非搬移，旧文件留着无害）。
pub(crate) fn data_root_pointer() -> PathBuf {
    let p = pointer_dir().join("data-root");
    if !p.exists() {
        if let Some(parent) = pointer_dir().parent() {
            for legacy in ["OpenCharm", "opencharm"] {
                let lp = parent.join(legacy).join("data-root");
                if lp.is_file() {
                    let _ = std::fs::copy(&lp, &p);
                    break;
                }
            }
        }
    }
    p
}

fn resolve_data_root() -> PathBuf {
    // 1. 显式环境变量覆盖（仅开发 / 测试 / 高级用户，应用自身不写入环境变量）
    if let Ok(dir) = std::env::var("MONTAURI_DATA_ROOT") {
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
    // 3. 平台默认：Known Folders（Windows %LOCALAPPDATA%\Montauri）
    let root = std::env::var("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("Montauri"))
        .unwrap_or_else(|_| user_home().join("Montauri"));
    // v1「OpenCharm」→ v2「Montauri」一次性迁移：旧根存在且新根不存在时整体搬移，
    // 保住既有 trace 库 / 配置 / 日志（probe 经 MONTAURI_PROBE_HOME 环境变量跟随新根）。
    // 失败静默——不影响启动，最坏后果是重新采集。
    if !root.exists() {
        for legacy in ["OpenCharm", "opencharm", ".opencharm"] {
            let old = std::env::var("LOCALAPPDATA")
                .map(|d| PathBuf::from(d).join(legacy))
                .unwrap_or_else(|_| user_home().join(legacy));
            if old.is_dir() {
                let _ = std::fs::rename(&old, &root);
                break;
            }
        }
    }
    root
}

/// Montauri 用户数据根（即 data_root）。
/// 各模块在此目录下按功能划分子目录（config/ workspaces/ recent/ traces/
/// runtime/ webview/ logs/），不要把文件平铺到根目录。
pub(crate) fn montauri_home() -> PathBuf {
    data_root().to_path_buf()
}

/// WebView2 用户数据目录（localStorage / Cookie / 缓存落盘位置，仅 Windows WebView2 使用）。
#[cfg(windows)]
pub(crate) fn webview_data_dir() -> PathBuf {
    montauri_home().join("webview")
}

/// 诊断日志目录（按天轮转，保留 14 天，见 logging.rs）。
pub(crate) fn logs_dir() -> PathBuf {
    montauri_home().join("logs")
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

// 注：曾有 soft_kill_pid（P1-J 温和终止，服务 piped run_script 的「stdin drop + 宽限 +
// 强杀」序列）——随 v3.4 §17-16 删净 piped 路径失去全部调用方，移除；运行链路的软杀
// 语义统一由 PTY 写 \x03（term_write）承担，见 termUi::stopRunInstanceById。

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
        // 体验修复：taskkill 也须 CREATE_NO_WINDOW——编辑 .py 触发 LSP 重启/停止运行时
        // 走到这里，裸 spawn 的 taskkill 会在前台闪黑框（用户报告的「老是有黑框闪」）
        let mut kill = std::process::Command::new("taskkill");
        kill.args(["/PID", &pid, "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let _ = no_window(&mut kill).status();
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
        {
            // 体验修复：同 kill_process_tree——taskkill 补 CREATE_NO_WINDOW（防黑框闪）
            let mut kill = std::process::Command::new("taskkill");
            kill.args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            let _ = no_window(&mut kill).status();
        }

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

/// 通过 pid 终止**整棵进程树**（同步 taskkill /T /F，Windows；非 Windows 无操作）。
///
/// 与 [`kill_process_tree`] 同口径但操作 pid：PTY 会话的 child 是
/// `Box<dyn portable_pty::Child>`（无法借用 `std::process::Child`），只能取 pid 杀树。
/// 同步阻塞；「不应阻塞 UI」的场景由调用方放进后台线程（如 terminal::kill_child_tree_async）。
pub(crate) fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        if pid == 0 {
            return;
        }
        // 体验修复：taskkill 补 CREATE_NO_WINDOW（防前台黑框闪，与 kill_process_tree 同口径）
        let mut kill = std::process::Command::new("taskkill");
        kill.args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let _ = no_window(&mut kill).status();
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

/// PTY 会话 child（`Box<dyn portable_pty::Child + Send + Sync>`）的异步杀树（铁律 1）。
///
/// 与 [`kill_process_tree_async`] 同语义但操作 portable-pty 的 child：先取 pid，
/// 阻塞性的 taskkill /T /F 与回收全部移到后台线程，函数立即返回。
/// 顺序要求：**必须先 taskkill 杀树再 kill/wait child**——直接子进程死了 taskkill 就
/// 找不到树根，孙进程会漏杀（这正是裸 `child.kill()` 的孤儿问题本身）。
pub(crate) fn kill_pty_child_tree_async(mut child: Box<dyn portable_pty::Child + Send + Sync>) {
    let pid = child.process_id().unwrap_or(0);
    std::thread::spawn(move || {
        crate::util::kill_pid_tree(pid);
        // 兜底：树杀失败（pid 复用等罕见情形）时仍终止直接子进程并回收句柄
        let _ = child.kill();
        let _ = child.wait();
    });
}

// ── 启动窗口的初始几何（主窗口 + 项目窗口共用） ──────────────────────────
//
// 修的问题：开应用后窗口偏下、底部被屏幕切掉，必须手动往上拖。
//
// 根因是**从不指定位置**。tao 建窗时只在「传入的 position 落在某显示器范围内」
// 才采纳它，否则一律退回 `CW_USEDEFAULT`（tao src/platform_impl/windows/window.rs
// 的 `(monitor, position)` 解析），交给系统自选——落到工作区下半部就表现为偏下。
// 实测修复前后（本机 1920×1080 @125%）：旧 rect 顶部越出工作区上沿、底部被切；
// 新 rect 完全落在工作区内并居中。
//
// 次要隐患一并处理：尺寸写死 `inner_size(1280, 800)`（逻辑像素 = CSS px），
// 在更高缩放 / 更矮的屏上（例：1536×864 物理 @150% → 工作区仅 384 逻辑高）
// 会直接超出工作区下沿。故按「近似工作区」收尺寸，并在工作区内居中。
// 取不到显示器信息（无头 / 远程会话）时返回 None，调用方退回 `center()`。

/// 窗口初始尺寸的期望值（逻辑像素 = CSS px）。
pub(crate) const WIN_PREF_W: f64 = 1280.0;
pub(crate) const WIN_PREF_H: f64 = 800.0;

/// 窗口尺寸下限（逻辑像素）。800×600 的推导见 `lib.rs` 建窗处注释（UI-23：
/// 三栏宽度下限 180 + 240 + 260 = 680，留余量后编辑区不会被挤没）。
pub(crate) const WIN_MIN_W: f64 = 800.0;
pub(crate) const WIN_MIN_H: f64 = 600.0;

/// 启动窗口的初始位置与尺寸：收进主显示器的近似工作区，并在该工作区内居中。
///
/// 工作区只能近似：tao 的 [`tauri::Monitor`] 只给整块显示器的物理尺寸与位置
/// （**不含**任务栏），故按「屏高 − 任务栏近似」反推。近似偏保守的唯一后果是
/// 窗口略小，不会切边，方向上安全。
///
/// 返回 `None` = 取不到显示器信息，调用方应退回 `center()` + 期望尺寸。
pub(crate) fn initial_window_geometry(
    app: &tauri::AppHandle,
) -> Option<(tauri::LogicalPosition<f64>, tauri::LogicalSize<f64>)> {
    let mon = app.primary_monitor().ok().flatten()?;
    let scale = mon.scale_factor();
    if !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let (x, y, w, h) = geometry_for_monitor(
        f64::from(mon.position().x) / scale,
        f64::from(mon.position().y) / scale,
        f64::from(mon.size().width) / scale,
        f64::from(mon.size().height) / scale,
        scale,
    );
    crate::logging::log_line(
        crate::logging::Level::Info,
        &format!(
            "[window_geom] monitor_px={}x{} origin_px=({},{}) scale={scale} \
             => pos=({x:.1},{y:.1}) size={w:.1}x{h:.1} (logical)",
            mon.size().width,
            mon.size().height,
            mon.position().x,
            mon.position().y
        ),
    );
    Some((
        tauri::LogicalPosition::new(x, y),
        tauri::LogicalSize::new(w, h),
    ))
}

/// 任务栏近似高度（物理像素）：Windows 默认 48，DPI 放大不成比例，
/// 故与屏高 5.5% 取大者；自动隐藏任务栏时会多扣一点空白，可接受。
const TASKBAR_PX: f64 = 48.0;
const TASKBAR_RATIO: f64 = 0.055;
/// 上下留白（物理像素）
const MARGIN_PX: f64 = 24.0;
/// 宽度占比。横向不按「屏宽 − 留白」算，是为了顺带容下贴侧边的任务栏
/// （竖排任务栏 / 侧边 dock 宽度不固定，按比例留边更稳）。
const WIDTH_RATIO: f64 = 0.92;

/// 纯计算部分（逻辑像素进出，`scale` 用于把物理量的留白/任务栏换算成逻辑量）。
///
/// 三个区域依次收窄，居中基于**工作区**（而非已扣过边的可用区），否则左右/上下
/// 留白会不对称（一侧贴边、另一侧留白）：
///   屏（mon）→ 工作区（扣底部任务栏）→ 可用区（工作区再扣上下留白 / 横向按比例）。
fn geometry_for_monitor(
    mon_x: f64,
    mon_y: f64,
    mon_w: f64,
    mon_h: f64,
    scale: f64,
) -> (f64, f64, f64, f64) {
    let mon_h_px = mon_h * scale;
    // 近似工作区：横 = 屏宽，纵 = 屏高 − 任务栏
    let work_w = mon_w;
    let work_h = (mon_h_px - TASKBAR_PX.max(mon_h_px * TASKBAR_RATIO)) / scale;
    // 可用区：横向按比例留边，纵向扣上下留白（极端小屏至少留屏高 40%）
    let avail_w = work_w * WIDTH_RATIO;
    let avail_h = (work_h - 2.0 * MARGIN_PX / scale).max(mon_h * 0.4);

    let w = fit_size(WIN_PREF_W, WIN_MIN_W, avail_w);
    let h = fit_size(WIN_PREF_H, WIN_MIN_H, avail_h);
    (
        mon_x + (work_w - w) / 2.0,
        mon_y + (work_h - h) / 2.0,
        w,
        h,
    )
}

/// 在 `[min, avail]` 区间内取最接近 `pref` 的值：优先不超过可用空间，
/// 又不被下限顶穿（`avail < min` 时取 `avail`，宁可在极小屏上略小也不越界）。
fn fit_size(pref: f64, min: f64, avail: f64) -> f64 {
    pref.min(avail).max(min.min(avail))
}

/// 打包后 Tauri 资源目录候选：`bundle.resources` 的落地位置跨平台有差异，
/// 列出多个常见位置（`resource_dir()` 本身与其 `resources/` 子目录），命中即用。
/// 供 `lsp::locate_intel_binary` / `run_env::locate_probe_src` 复用（第 2 步：资源目录支持）。
pub(crate) fn resource_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    use tauri::Manager;
    let mut dirs = Vec::new();
    if let Ok(d) = app.path().resource_dir() {
        dirs.push(d.clone());
        dirs.push(d.join("resources"));
    }
    dirs
}

/// 动态授权 asset 协议读取目录（Markdown 预览渲染本地图片用）。
///
/// 前端在打开 / 切换工作区（含启动恢复上次工作区）时调用，把 asset scope 收紧到
/// 当前工作区根（递归），而非在 tauri.conf.json 写死一个宽泛路径；越权路径仍由
/// 该 scope 拦截。asset 协议本身需在 tauri.conf.json 的 `app.security.assetProtocol`
/// 置为 `enable: true`（scope 留空，全走这里动态授权）。
#[tauri::command]
pub fn allow_asset_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri::Manager;
    app.asset_protocol_scope()
        .allow_directory(std::path::Path::new(&path), true)
        .map_err(|e| format!("asset 目录授权失败：{e}"))
}

/// 字节流增量 UTF-8 解码器（S3/S4 公共基建：按块读取子进程输出时避免多字节字符跨块乱码）。
///
/// 按块读取子进程输出时，多字节字符（中文提示符、跨块 traceback）可能正好落在块边界上；
/// 直接 `from_utf8_lossy` 会把尾部不完整序列替换成 U+FFFD 乱码。终端平时输出量大不显眼，
/// 但交互式一问一答（每块就几个字）必然暴露。
///
/// 本解码器只输出「完整字符」，把尾部 1–3 个不完整字节 carry 到下一轮；
/// 流结束时用 [`finish`](Self::finish) 冲刷（残留字节按 lossy 输出，不静默吞字节）。
/// 中间出现非法字节时替换为 U+FFFD 并继续扫描，保证 carry 恒定有界（≤3 字节）。
#[derive(Default)]
pub(crate) struct IncrementalUtf8Decoder {
    carry: Vec<u8>,
}

impl IncrementalUtf8Decoder {
    /// 送入一块字节，返回可安全输出的文本（空串 = 本块全是不完整尾巴，尚无可输出内容）。
    pub(crate) fn push(&mut self, bytes: &[u8]) -> String {
        if bytes.is_empty() && self.carry.is_empty() {
            return String::new();
        }
        self.carry.extend_from_slice(bytes);
        let mut out = String::new();
        let mut pos = 0;
        loop {
            match std::str::from_utf8(&self.carry[pos..]) {
                Ok(s) => {
                    out.push_str(s);
                    pos = self.carry.len();
                    break;
                }
                Err(e) => {
                    let valid = e.valid_up_to();
                    // valid_up_to 之前的字节已确认合法，直接取出（lossy 在此不会替换）
                    out.push_str(&String::from_utf8_lossy(&self.carry[pos..pos + valid]));
                    pos += valid;
                    match e.error_len() {
                        // 非法字节序列：替换为一个 U+FFFD 后继续扫描（与 from_utf8_lossy 同语义）
                        Some(len) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            pos += len;
                        }
                        // None = 尾部不完整（被块边界截断）：留给下一轮
                        None => break,
                    }
                }
            }
        }
        self.carry.drain(..pos);
        out
    }

    /// 流结束冲刷：残留的不完整字节已不可能拼成完整字符，按 lossy 输出。
    pub(crate) fn finish(&mut self) -> String {
        if self.carry.is_empty() {
            return String::new();
        }
        let out = String::from_utf8_lossy(&self.carry).into_owned();
        self.carry.clear();
        out
    }

    /// 是否仍有未输出的残留字节（仅测试用于断言 carry 状态）
    #[cfg(test)]
    pub(crate) fn pending(&self) -> usize {
        self.carry.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geometry_fits_real_125pct_screen() {
        // 本机实测屏（真机 DPI-aware 探针确认）：1920×1080 物理 @125%，
        // 工作区 1080−59.4 任务栏 = 1020.6 物理（System.Windows.Forms 之类
        // DPI-unaware API 会把它报成 1536×864 逻辑值，别拿那个当物理值用）。
        // 期望值 1280×800 逻辑在这里放得下，故宽度用期望值、高度收进工作区。
        let (x, y, w, h) = geometry_for_monitor(0.0, 0.0, 1920.0 / 1.25, 1080.0 / 1.25, 1.25);
        assert!((w - 1280.0).abs() < 0.5, "宽 {w} 应保持期望值 1280");
        assert!((h - 778.1).abs() < 0.5, "高 {h} 应收进「屏高 − 任务栏 − 上下留白」");
        let left = x * 1.25;
        let top = y * 1.25;
        let right = (x + w) * 1.25;
        let bottom = (y + h) * 1.25;
        assert!(left > 0.0, "左边距 {left} 不得贴边");
        assert!(top > 0.0, "上边距 {top} 不得贴边");
        assert!(
            ((1920.0 - right) - left).abs() < 0.5,
            "左右边距应对称（left={left}, right_gap={}）",
            1920.0 - right
        );
        assert!(bottom <= 1020.6, "底边 {bottom} 越过了工作区下沿 1020.6");
    }

    #[test]
    fn geometry_uses_pref_on_large_screen_and_clamps_on_small_one() {
        // 1080p @100%：期望 1280×800 装得下 → 用期望值并居中
        // （工作区高 = 1080 − 任务栏 max(48, 5.5%×1080=59.4) = 1020.6）
        let (x, y, w, h) = geometry_for_monitor(0.0, 0.0, 1920.0, 1080.0, 1.0);
        assert_eq!((w, h), (WIN_PREF_W, WIN_PREF_H));
        assert!((x - (1920.0 - 1280.0) / 2.0).abs() < 0.01);
        assert!((y - (1020.6 - 800.0) / 2.0).abs() < 0.01, "应在扣除任务栏后的工作区内居中");
        assert!(y + h <= 1020.6, "底边不得越过工作区下沿");

        // 极小屏（1024×768 @160% → 640×480 逻辑）：可用区小于下限时取可用区，不越界
        let (x, y, w, h) = geometry_for_monitor(0.0, 0.0, 640.0, 480.0, 1.6);
        assert!(w <= 640.0 && h <= 480.0, "不得越出屏幕 ({w}, {h})");
        assert!(x >= 0.0 && y >= 0.0 && x + w <= 640.0 && y + h <= 480.0);
    }

    #[test]
    fn geometry_shrinks_height_on_tall_scaled_screen() {
        // 高缩放 + 矮屏：1536×864 物理 @150% → 1024×576 逻辑，工作区仅 512 逻辑高。
        // 期望高度 800 逻辑在此必然越界（这正是「固定 800 高」的隐患），必须收到可用区。
        let (x, y, w, h) = geometry_for_monitor(0.0, 0.0, 1024.0, 576.0, 1.5);
        assert!(h < WIN_PREF_H, "高 {h} 应被收进工作区");
        assert!(y + h <= 576.0 - 1.0, "底边不得越过屏幕（{}+{}）", y, h);
        assert!(x >= 0.0 && x + w <= 1024.0);
    }

    #[test]
    fn fit_size_clamps_pref_into_available_space() {
        // 常规屏：期望 1280×800，工作区更大 → 用期望值
        assert_eq!(fit_size(1280.0, 800.0, 1920.0), 1280.0);
        assert_eq!(fit_size(800.0, 600.0, 1080.0), 800.0);
        // 本机 125% 缩放屏：工作区宽 1130 < 期望 1280 → 收到工作区宽
        assert_eq!(fit_size(1280.0, 800.0, 1130.5), 1130.5);
        // 工作区高于期望 → 不放大
        assert_eq!(fit_size(800.0, 600.0, 1400.0), 800.0);
        // 期望值低于下限 → 顶到下限
        assert_eq!(fit_size(640.0, 800.0, 1920.0), 800.0);
        // 极小屏：工作区小于下限 → 取工作区（宁略小不越界）
        assert_eq!(fit_size(1280.0, 800.0, 700.0), 700.0);
    }

    #[test]
    fn decoder_passes_ascii_through() {
        let mut d = IncrementalUtf8Decoder::default();
        assert_eq!(d.push(b"hello"), "hello");
        assert_eq!(d.push(b" world\n"), " world\n");
        assert_eq!(d.pending(), 0);
        assert_eq!(d.finish(), "");
    }

    #[test]
    fn decoder_carries_multibyte_across_chunks() {
        // 「你好」= 6 字节；在第 4 字节处切开（第二个汉字只到一半）
        let bytes = "你好".as_bytes();
        let mut d = IncrementalUtf8Decoder::default();
        assert_eq!(d.push(&bytes[..4]), "你");
        assert_eq!(d.pending(), 1); // 尾部 1 字节被 carry
        assert_eq!(d.push(&bytes[4..]), "好");
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn decoder_carries_each_truncation_width() {
        // 4 字节 emoji 逐字节喂入：前 3 次无可输出，第 4 次一次性产出完整字符
        let bytes = "🐍".as_bytes();
        assert_eq!(bytes.len(), 4);
        let mut d = IncrementalUtf8Decoder::default();
        for (i, b) in bytes.iter().enumerate() {
            let out = d.push(std::slice::from_ref(b));
            if i < 3 {
                assert_eq!(out, "", "第 {i} 字节不应产出文本");
            } else {
                assert_eq!(out, "🐍");
            }
        }
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn decoder_replaces_invalid_bytes_and_keeps_scanning() {
        // 中间非法字节不得让 carry 无限增长：替换后继续解码后续合法内容
        let mut d = IncrementalUtf8Decoder::default();
        let out = d.push(&[0xff, b'a', b'b']);
        assert_eq!(out, format!("{}ab", char::REPLACEMENT_CHARACTER));
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn decoder_finish_flushes_dangling_tail() {
        let bytes = "你".as_bytes();
        let mut d = IncrementalUtf8Decoder::default();
        assert_eq!(d.push(&bytes[..1]), "");
        assert_eq!(d.pending(), 1);
        assert_eq!(d.finish(), char::REPLACEMENT_CHARACTER.to_string());
        assert_eq!(d.pending(), 0);
    }

    #[test]
    fn decoder_keeps_traceback_frame_intact_across_chunks() {
        // 坑 5 的真实场景：中文路径的 traceback 帧跨块到达，拼接后必须逐字一致
        let line = r#"  File "F:\项目\主程序.py", line 42, in <module>"#;
        let bytes = line.as_bytes();
        let cut = bytes.len() / 2;
        let mut d = IncrementalUtf8Decoder::default();
        let mut got = d.push(&bytes[..cut]);
        got.push_str(&d.push(&bytes[cut..]));
        got.push_str(&d.finish());
        assert_eq!(got, line);
    }
}