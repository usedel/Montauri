// DAP 桥 Rust 侧（docs/python_debug_dev_plan.md v1.1 + 实施修订）：debugpy 会话管理。
//
// 架构（v1.2 实测修订，2026-09-10）：**stdio adapter 模式**。
// 原设计的「--listen + 端口预分配 + TCP」在真实环境暴露两个致命问题（全部实测复现）：
//   1. debugpy 的 --listen 是两段式：debuggee 进程内部再 spawn 一个 adapter 子进程并
//      等它回连（内部 listener 30s 超时）——在 ConPTY 下该内部 spawn 不工作（应用内
//      30s 10061；独立管道复现 12.8s 才连上，系统繁忙时更久）；
//   2. Tauri resource_dir() 返回 \\?\ verbatim 路径，作为 python 脚本参数会使 debugpy
//      自举 import 失败（ModuleNotFoundError）——已在 locate 出口剥离。
// 新架构（已全链路验证：initialize → attach{listen} → debugpyWaitingForServer →
// PTY 内 --connect debuggee → initialized → stopped → stackTrace，2.2s 完成）：
//   - Rust spawn **stdio adapter**（python <debugpy>/adapter，管道模式，不进 PTY）——
//     adapter 与 debugpy 内部 spawn 无关，不存在 ConPTY 问题；
//   - DAP 通信走 adapter 的 stdin/stdout（同 lsp.rs 对 LSP 引擎的模式）；
//   - 被调试脚本进 PTY（stdout/stderr/交互归终端），以 --connect 连 adapter 的
//     server socket（地址经 debugpyWaitingForServer 事件获得）；
//   - attach 带 {"listen":{"host","port":0}}：走「server 主动连接」路径，同时清空
//     adapter access_token（servers.py 双 None 跳过鉴权，debuggee 无需 token）。
//
// 其余设计要点不变：
// - 三态互斥（§3.2）；debug_busy() 单实例守卫；
// - debug_stop 立即返回（CR-10 纪律）：取槽后杀进程树/清 PTY/关管道全部后台化；
// - locate_debugpy_dir 四级查找 + verbatim 剥离（§3.4 零安装）。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

use crate::logging::{log_line, Level};
use crate::util::unpoison;

// ---------- 全局状态（§5.1.1） ----------

struct DebugSession {
    /// stdio adapter 子进程（DAP 对端）。
    adapter: Option<Child>,
    /// adapter stdin 写侧（CR-03 纪律：独立 Arc<Mutex>，写阻塞不持全局锁）。
    adapter_stdin: Option<Arc<Mutex<ChildStdin>>>,
    /// debuggee 进程 pid（管道模式，进程本体由退出监视线程持有）。
    debuggee_pid: Option<u32>,
    /// 会话序号（防重启串线，同 lsp.rs 先例）。
    seq: u64,
}

static DEBUG: LazyLock<Mutex<Option<DebugSession>>> = LazyLock::new(|| Mutex::new(None));
static DEBUG_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// 调试会话是否占用（三态互斥之一，供 run_script / run_in_terminal 反向检查）。
pub(crate) fn debug_busy() -> bool {
    unpoison(DEBUG.lock()).is_some()
}

// 注：v1.2 架构曾有 DEBUG_TERM_PREFIX（"debug-term-"）——debuggee 落 PTY 会话的 id 前缀。
// v1.3 改管道模式（stdout → 输出面板）后不再创建终端会话，前缀随之移除；
// 若未来恢复 PTY 交互（见 debug_acceptance_record.md §〇 遗留），按此约定重建。

// ---------- debugpy 定位（§5.1.2 四级查找 + verbatim 剥离） ----------

/// 判定「这是含 __main__.py 的 debugpy 包目录」。
fn is_debugpy_pkg(dir: &std::path::Path) -> bool {
    dir.join("__main__.py").is_file() && dir.join("__init__.py").is_file()
}

/// 定位自带 debugpy 包目录，优先顺序（同 lsp.rs::locate_intel_binary 先例）：
/// 1) 环境变量 OPENCHARM_DEBUGPY_DIR（指向 debugpy/ 包目录本身）；
/// 2) 托管目录 <data_root>/runtime/debugpy/debugpy；
/// 3) Tauri 资源目录（打包分发，bundle.resources "vendor/debugpy/" -> "debugpy/"）；
/// 4) dev 相对 exe 上溯仓库布局（vendor/debugpy/debugpy，需先跑 tools/fetch-debugpy.ps1）。
/// 返回含 __main__.py 的包目录；找不到返回 None（安装包损坏 / dev 未拉取，无安装分支）。
///
/// **出口统一剥 `\\?\` verbatim 前缀**（实测坑 2026-09-10）：Tauri `resource_dir()` 返回
/// verbatim 路径，`python \\?\...\debugpy\__main__.py` 会让 debugpy 自举 import 失败
/// （`ModuleNotFoundError: No module named 'debugpy'`）→ debugpy 起了不监听 → 假 10061。
fn locate_debugpy_dir(app: &AppHandle) -> Option<PathBuf> {
    locate_debugpy_dir_raw(app).map(strip_verbatim)
}

fn locate_debugpy_dir_raw(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("OPENCHARM_DEBUGPY_DIR") {
        let p = PathBuf::from(p);
        if is_debugpy_pkg(&p) {
            return Some(p);
        }
    }

    let runtime = crate::tool_paths::runtime_dir().join("debugpy").join("debugpy");
    if is_debugpy_pkg(&runtime) {
        return Some(runtime);
    }

    for dir in crate::util::resource_candidates(app) {
        // bundle.resources 映射 "vendor/debugpy/" -> "debugpy/"：解包后 debugpy 包位于
        // <资源根>/debugpy/debugpy（外层 debugpy/ 是映射目标目录，内层才是包本身）
        for cand in [dir.join("debugpy").join("debugpy"), dir.join("debugpy")] {
            if is_debugpy_pkg(&cand) && cand.join("__main__.py").is_file() {
                return Some(cand);
            }
        }
    }

    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..6 {
        dir.pop();
        let cand = dir.join("vendor").join("debugpy").join("debugpy");
        if is_debugpy_pkg(&cand) {
            return Some(cand);
        }
    }
    None
}

/// 剥 Windows verbatim 路径前缀（`\\?\C:\...` → `C:\...`；UNC `\\?\UNC\server\...` → `\\server\...`）。
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p
    }
}

// ---------- 依赖声明检测（§5.1.6，提示性质） ----------

/// 扫描工作区依赖清单是否声明 debugpy（纯文件扫描，无子进程、不弹窗、不阻断）。
fn scan_debugpy_dep(workspace_root: &std::path::Path) -> (bool, Vec<String>) {
    let mut files = Vec::new();

    let pyproject = workspace_root.join("pyproject.toml");
    if pyproject.is_file() {
        let mut hit = false;
        if let Ok(text) = std::fs::read_to_string(&pyproject) {
            let mut in_dep_section = false;
            for line in text.lines() {
                let t = line.trim();
                if t.starts_with('[') {
                    in_dep_section =
                        t == "[project.dependencies]" || t == "[tool.poetry.dependencies]" || t == "dependencies";
                    continue;
                }
                if in_dep_section && pyproject_line_mentions_debugpy(t) {
                    hit = true;
                    break;
                }
            }
        }
        if hit {
            files.push("pyproject.toml".to_string());
        }
    }

    if let Ok(entries) = std::fs::read_dir(workspace_root) {
        let mut reqs: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.starts_with("requirements") && name.ends_with(".txt")
            })
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        reqs.sort();
        for name in reqs {
            let path = workspace_root.join(&name);
            if let Ok(text) = std::fs::read_to_string(&path) {
                let hit = text.lines().any(requirements_line_mentions_debugpy);
                if hit {
                    files.push(name);
                }
            }
        }
    }

    (!files.is_empty(), files)
}

fn pyproject_line_mentions_debugpy(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') {
        return false;
    }
    let key = t.split('=').next().unwrap_or(t);
    let key = key.split(['>', '<', '~', '!', '[', ';', ' ']).next().unwrap_or(key);
    key.trim_matches(|c: char| c == '"' || c == '\'').eq_ignore_ascii_case("debugpy")
}

fn requirements_line_mentions_debugpy(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') || t.starts_with('-') {
        return false;
    }
    let head = t.split(['>', '<', '~', '!', '=', '[', ';', ' ', '#']).next().unwrap_or(t);
    head.eq_ignore_ascii_case("debugpy")
}

// ---------- debug_detect（§7 D1-5：纯文件系统操作，无子进程） ----------

/// 调试前置检测：自带 debugpy 是否可用 + 依赖清单是否声明 debugpy（提示性质）。
#[tauri::command]
pub fn debug_detect(app: AppHandle, workspace_root: Option<String>) -> Result<Value, String> {
    let dir = locate_debugpy_dir(&app);
    let (dep_found, dep_files) = match workspace_root.as_deref() {
        Some(root) => scan_debugpy_dep(std::path::Path::new(root)),
        None => (false, Vec::new()),
    };
    Ok(json!({
        "debugpyOk": dir.is_some(),
        "debugpyDir": dir.map(|d| d.to_string_lossy().to_string()),
        "depFound": dep_found,
        "depFiles": dep_files,
    }))
}

// ---------- 帧解析（§5.1.3：复刻 lsp.rs::read_frame，不跨模块依赖） ----------

/// 单帧 payload 上限（与 lsp.rs MAX_FRAME_LEN 同量级：防异常对端触发巨额分配）。
const MAX_DAP_FRAME_LEN: usize = 64 * 1024 * 1024;

/// 读取一个 DAP 帧（Content-Length 头 + JSON payload；帧头与 LSP 相同）。
fn read_dap_frame(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = Vec::new();
        let n = reader.read_until(b'\n', &mut line).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(None);
        }
        let line_str = String::from_utf8_lossy(&line).trim().to_string();
        if line_str.is_empty() {
            break;
        }
        if let Some(v) = line_str.strip_prefix("Content-Length:") {
            content_length = v.trim().parse::<usize>().ok();
        }
    }
    let len = content_length.ok_or("缺少 Content-Length 头")?;
    if len > MAX_DAP_FRAME_LEN {
        return Err(format!("Content-Length 超上限（{len} > {MAX_DAP_FRAME_LEN}）"));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map(Some).map_err(|e| e.to_string())
}

// ---------- 会话清理 ----------

/// 通过 pid 终止进程树（taskkill /T /F，Windows；与 kill_process_tree 同口径但操作 pid）。
fn kill_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

/// 后台执行会话清理（debug_stop / 启动失败共用）：只操作已取走的载荷，不再碰 DEBUG 锁。
fn cleanup_session_payload(s: DebugSession, app: &AppHandle) {
    // 1. 杀 debuggee 进程树（连带脚本子树）
    if let Some(pid) = s.debuggee_pid {
        kill_pid_tree(pid);
    }
    // 2. 杀 adapter（管道模式，无 PTY 会话）
    if let Some(mut adapter) = s.adapter {
        let _ = adapter.kill();
        let _ = adapter.wait();
    }
    log_line(Level::Info, "[dap] cleanup_session done");
    let _ = app.emit("debug-exited", json!({ "reason": "stopped" }));
}

// ---------- debug_start（stdio adapter 架构） ----------

/// 启动调试会话。命令本身立即返回（async + 后台线程做全部耗时操作）；
/// 前端随后经 dap_send_request 发 initialize → attach{listen}，并在收到
/// debugpyWaitingForServer 事件后调 debug_attach_debuggee 在 PTY 里拉起被调试脚本。
#[tauri::command]
pub async fn debug_start(
    app: AppHandle,
    path: String,
    workspace_root: Option<String>,
) -> Result<(), String> {
    // ---- 1. 三态互斥（§3.2）----
    {
        let d = unpoison(DEBUG.lock());
        if d.is_some() {
            return Err("已有调试会话在运行".into());
        }
        if crate::lsp::run_slot_busy() {
            return Err("已有脚本在运行".into());
        }
        if crate::terminal::run_terminal_busy() {
            return Err("已有脚本在终端中运行".into());
        }
    }

    // ---- 2. 脚本路径解析（同 run_script 口径；cwd 在 debug_attach_debuggee 侧计算）----
    let p = std::path::Path::new(&path);
    let script_abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };

    // ---- 3. 解释器与运行配置 ----
    let interpreter = workspace_root
        .as_deref()
        .and_then(|r| crate::env_cmds::get_interpreter(r.to_string()).ok().flatten());
    let run_config = workspace_root
        .as_deref()
        .map(|r| crate::env_cmds::read_run_config(r, &path))
        .unwrap_or_default();

    if run_config.stdin.effective_mode() == "file" {
        return Err(
            "调试不支持标准输入重定向自文件（PTY 无法直接接管文件）。请在运行配置中把标准输入改为「不接输入」或「交互式」。"
                .into(),
        );
    }

    // ---- 4. 定位自带 debugpy（含 verbatim 剥离）----
    let debugpy_dir = locate_debugpy_dir(&app).ok_or_else(|| {
        "未找到自带 debugpy（应用资源目录损坏，或开发环境未运行 tools/fetch-debugpy.ps1 拉取）。\
         请重新安装应用或在仓库根目录执行：powershell -ExecutionPolicy Bypass -File tools/fetch-debugpy.ps1"
            .to_string()
    })?;

    // ---- 5. 环境装配（probe=false；§3.2 调试态 probe 恒 false）----
    let run_env = crate::run_env::build_run_env(
        &app,
        &script_abs,
        workspace_root.as_deref(),
        &run_config,
        /* probe= */ false,
    );

    // 解释器：工作区配置 > 系统 Python 兜底（adapter 也需要一个 Python；
    // 用与 debuggee 相同的解释器，保证 debugpy 的 .pyd 加速模块版本匹配）
    let python = interpreter
        .clone()
        .unwrap_or_else(|| "python".to_string());
    let uv_fallback = interpreter.is_none();
    if uv_fallback && !crate::tool_paths::is_available("uv", crate::tool_paths::ENV_UV) {
        // 未选解释器且无 uv：调试不可用（adapter 与 debuggee 都需要 Python）
        return Err("未选择解释器且未找到 uv，无法启动调试（可在状态栏选择解释器，或先安装 uv）".into());
    }
    let python = if uv_fallback {
        // uv 兜底：用 uv run 拉一个 Python 起本会话的组件过于绕——直接要求选解释器更可诊断。
        return Err("调试需要先选择 Python 解释器（状态栏 → 选择解释器）。uv 兜底模式暂不支持调试。".into());
    } else {
        python
    };

    // ---- 6. spawn stdio adapter（管道模式；DAP 对端）----
    let adapter_dir = debugpy_dir.join("adapter");
    log_line(
        Level::Info,
        &format!("[dap] spawn adapter: {python} {}", adapter_dir.to_string_lossy()),
    );

    let mut adapter_cmd = std::process::Command::new(&python);
    adapter_cmd
        .arg(&adapter_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (k, v) in &run_env.env {
        adapter_cmd.env(k, v);
    }
    // Windows 隐藏控制台窗口（同 util::no_window 语义，但 std::process 版本）
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        adapter_cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut adapter = adapter_cmd
        .spawn()
        .map_err(|e| format!("无法启动 debugpy adapter: {e}"))?;

    let adapter_stdin = adapter.stdin.take().ok_or("无法获取 adapter stdin")?;
    let adapter_stdout = adapter.stdout.take().ok_or("无法获取 adapter stdout")?;

    // ---- 7. 登记 DEBUG 槽（seq 防重启串线）----
    let seq = DEBUG_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    {
        let mut d = unpoison(DEBUG.lock());
        *d = Some(DebugSession {
            adapter: Some(adapter),
            adapter_stdin: Some(Arc::new(Mutex::new(adapter_stdin))),
            debuggee_pid: None,
            seq,
        });
    }

    // ---- 8. adapter stdout 读线程（帧解析 → dap-message 事件，同 lsp.rs 模式）----
    let app_read = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(adapter_stdout);
        loop {
            match read_dap_frame(&mut reader) {
                Ok(Some(payload)) => {
                    let _ = app_read.emit("dap-message", payload);
                }
                Ok(None) => break,
                Err(e) => {
                    log_line(Level::Warn, &format!("[dap] 帧解析错误: {e}"));
                    break;
                }
            }
        }
        log_line(Level::Info, "[dap] adapter stdout closed");
    });

    // ---- 9. adapter 退出监视（adapter 死亡 = 会话终了；seq 防误报新会话）----
    let app_watch = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let finished = {
                let mut d = unpoison(DEBUG.lock());
                match d.as_mut() {
                    None => return,
                    Some(s) => {
                        if s.seq != seq {
                            return;
                        }
                        // adapter 进程已退出（从槽里 try_wait；需 &mut）
                        match s.adapter.as_mut() {
                            None => true,
                            Some(a) => matches!(a.try_wait(), Ok(Some(_))),
                        }
                    }
                }
            };
            if finished {
                let sess = unpoison(DEBUG.lock()).take();
                if let Some(s) = sess {
                    if s.seq != seq {
                        return;
                    }
                    // debuggee 可能还活着（adapter 死了 pydevd 会继续跑）：杀树
                    if let Some(pid) = s.debuggee_pid {
                        kill_pid_tree(pid);
                    }
                    log_line(Level::Info, &format!("[dap] adapter exited (seq={})", s.seq));
                    let _ = app_watch.emit("debug-exited", json!({ "reason": "exited" }));
                }
                return;
            }
        }
    });

    log_line(Level::Info, &format!("[dap] debug_start ok: adapter spawned (seq={seq})"));
    let _ = app.emit("debug-started", json!({ "port": 0, "pid": null }));
    Ok(())
}

/// 在 PTY 里拉起被调试脚本（--connect 连 adapter）。
/// 由前端在收到 debugpyWaitingForServer 事件（携带 server host:port）后调用——
/// 这是 stdio adapter 架构的关键时序（attach 在前，debuggee 后连入）。
#[tauri::command]
pub async fn debug_attach_debuggee(
    app: AppHandle,
    path: String,
    workspace_root: Option<String>,
    host: String,
    port: u16,
) -> Result<(), String> {
    // 会话必须存在且未挂 debuggee
    let debugpy_dir = {
        let d = unpoison(DEBUG.lock());
        let s = d.as_ref().ok_or("调试会话未启动")?;
        if s.debuggee_pid.is_some() {
            return Err("被调试脚本已启动".into());
        }
        locate_debugpy_dir(&app).ok_or("debugpy 副本丢失")?
    };

    let p = std::path::Path::new(&path);
    let dir = p.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
    let script_abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };

    let interpreter = workspace_root
        .as_deref()
        .and_then(|r| crate::env_cmds::get_interpreter(r.to_string()).ok().flatten())
        .ok_or("调试需要已选择的解释器（debug_start 已校验，此处不应到达）")?;
    let run_config = workspace_root
        .as_deref()
        .map(|r| crate::env_cmds::read_run_config(r, &path))
        .unwrap_or_default();
    let run_env = crate::run_env::build_run_env(
        &app,
        &script_abs,
        workspace_root.as_deref(),
        &run_config,
        false,
    );

    // debuggee 以管道模式 spawn（stdout/stderr → 输出面板，同 run_script 模式）。
    // 实测结论（2026-09-10 二分验证）：ConPTY 下 pydevd 的回连 socket 不工作
    // （--connect 30s 不回连；禁用全部注入 env 后依旧 → 与环境变量无关，
    // 是 ConPTY 本身与 pydevd 网络线程的兼容性问题；--listen 模式同理翻车）。
    // 管道模式下全链路已验证（initialize → attach{listen} → WaitingForServer →
    // debuggee --connect → initialized → stopped → stack，2.2s）。
    // 代价：调试期 stdout 走输出面板而非终端（input() 交互暂不支持）。
    let connect_addr = format!("{host}:{port}");
    let connect_addr_for_log = connect_addr.clone();

    let mut cmd = std::process::Command::new(&interpreter);
    cmd.arg(debugpy_dir.join("__main__.py").to_string_lossy().to_string());
    cmd.arg("--connect");
    cmd.arg(&connect_addr);
    cmd.arg("--wait-for-client");
    cmd.arg(script_abs.to_string_lossy().to_string());
    cmd.args(&run_env.args);
    cmd.current_dir(&dir);
    for (k, v) in &run_env.env {
        cmd.env(k, v);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::util::no_window(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动调试命令: {e}"))?;

    let pid = child.id();
    let stdout = child.stdout.take().ok_or("无法获取 debuggee stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 debuggee stderr")?;

    // debuggee 输出转发到前端（复用 run-stdout/run-stderr 事件 → 输出面板）
    let app_out = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app_out.emit("run-stdout", json!({ "data": String::from_utf8_lossy(&buf) }));
                }
                Err(_) => break,
            }
        }
    });
    let app_err = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app_err.emit("run-stderr", json!({ "data": String::from_utf8_lossy(&buf) }));
                }
                Err(_) => break,
            }
        }
    });

    // debuggee 退出监视：清 DEBUG 槽（seq 防误报）+ 杀 adapter
    let app_watch = app.clone();
    let seq_now = {
        let d = unpoison(DEBUG.lock());
        d.as_ref().map(|s| s.seq).unwrap_or(0)
    };
    let mut child_owned = child;
    std::thread::spawn(move || {
        let _ = child_owned.wait();
        let sess = unpoison(DEBUG.lock()).take();
        if let Some(s) = sess {
            if s.seq != seq_now {
                // 被新会话替换：不清（新会话已在槽里——此处 take 已拿走，回填不可能，
                // 但 seq 不匹配说明旧线程迟到，仅记日志）
                log_line(Level::Warn, "[dap] stale debuggee-exit watcher fired");
                return;
            }
            if let Some(mut adapter) = s.adapter {
                let _ = adapter.kill();
                let _ = adapter.wait();
            }
            log_line(Level::Info, "[dap] debuggee exited; session finished");
            let _ = app_watch.emit("debug-exited", json!({ "reason": "exited" }));
        }
    });

    {
        let mut d = unpoison(DEBUG.lock());
        if let Some(s) = d.as_mut() {
            s.debuggee_pid = Some(pid);
        }
    }
    log_line(Level::Info, &format!("[dap] debuggee spawned (pipes): pid={pid} connect={connect_addr_for_log}"));
    Ok(())
}

/// 停止调试会话：**立即返回**，清理在后台线程执行（CR-10 纪律：
/// 同步 taskkill / ConPTY drop 会卡主线程 → UI 无响应，实测踩坑）。
#[tauri::command]
pub fn debug_stop(app: AppHandle) -> Result<(), String> {
    let sess = unpoison(DEBUG.lock()).take();
    let Some(s) = sess else { return Ok(()) };
    std::thread::spawn(move || cleanup_session_payload(s, &app));
    Ok(())
}

// ---------- DAP 请求 / 通知发送（写 adapter stdin） ----------

/// 发送 DAP 请求（前端组装 id/method/params；id 直接作为出站 seq——
/// debugpy 的响应以 request_seq 回显请求 seq，前端据此关联 Promise）。
#[tauri::command]
pub fn dap_send_request(id: i64, method: String, params: Value) -> Result<(), String> {
    let msg = json!({ "seq": id, "type": "request", "command": method, "arguments": params });
    send_dap(&msg)
}

/// 发送 DAP 通知。
#[tauri::command]
pub fn dap_send_notification(method: String, params: Value) -> Result<(), String> {
    let msg = json!({ "seq": next_seq(), "type": "event", "event": method, "body": params });
    send_dap(&msg)
}

/// 客户端 → debugpy 的响应（预留）。
#[tauri::command]
pub fn dap_send_response(request_seq: i64, body: Value) -> Result<(), String> {
    let msg = json!({ "seq": next_seq(), "type": "response", "request_seq": request_seq, "success": true, "body": body });
    send_dap(&msg)
}

/// DAP 出站消息序号（通知/响应用；请求 seq 由前端 id 提供）。
fn next_seq() -> u64 {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(100_000);
    SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// 写一帧到 adapter stdin（CR-03：锁内只取克隆，写阻塞不持全局锁）。
fn send_dap(msg: &Value) -> Result<(), String> {
    let stdin = {
        let d = unpoison(DEBUG.lock());
        d.as_ref()
            .and_then(|s| s.adapter_stdin.clone())
            .ok_or("调试会话未启动")?
    };
    let payload = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    let mut stdin = unpoison(stdin.lock());
    write!(stdin, "Content-Length: {}\r\n\r\n{}", payload.len(), payload).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

// ---------- 应用退出清理（CR-14：同步，不能被进程退出截断） ----------

pub(crate) fn debug_stop_for_exit() {
    let sess = unpoison(DEBUG.lock()).take();
    let Some(mut s) = sess else { return };
    if let Some(pid) = s.debuggee_pid {
        kill_pid_tree(pid);
    }
    if let Some(adapter) = s.adapter.as_mut() {
        let _ = adapter.kill();
        let _ = adapter.wait();
    }
}

// ---------- 单测 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn dap_frame(payload: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload).into_bytes()
    }

    #[test]
    fn reads_content_length_frame() {
        let payload = r#"{"seq":1,"type":"response","request_seq":7,"success":true}"#;
        let second = r#"{"seq":2,"type":"event","event":"stopped"}"#;
        let mut buf = dap_frame(payload);
        buf.extend_from_slice(&dap_frame(second));
        let mut cursor = Cursor::new(buf);
        let got = read_dap_frame(&mut cursor).unwrap().expect("应读出一帧");
        assert_eq!(got["request_seq"].as_i64(), Some(7));
        let got2 = read_dap_frame(&mut cursor).unwrap().expect("应读出第二帧");
        assert_eq!(got2["event"].as_str(), Some("stopped"));
    }

    #[test]
    fn returns_none_on_empty_input() {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        assert!(read_dap_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn errors_without_content_length() {
        let mut cursor = Cursor::new(b"Header: 1\r\n\r\n{}".to_vec());
        assert!(read_dap_frame(&mut cursor).is_err());
    }

    #[test]
    fn rejects_oversized_content_length() {
        let header = format!("Content-Length: {}\r\n\r\n", MAX_DAP_FRAME_LEN + 1);
        let mut cursor = Cursor::new(header.into_bytes());
        assert!(read_dap_frame(&mut cursor).is_err());
    }

    // ---------- scan_debugpy_dep ----------

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-dap-{tag}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn scan_finds_debugpy_in_requirements() {
        let d = tmpdir("req");
        std::fs::write(d.join("requirements.txt"), "# deps\nrequests\nDEBUGPY>=1.8\n").unwrap();
        let (found, files) = scan_debugpy_dep(&d);
        assert!(found);
        assert_eq!(files, vec!["requirements.txt".to_string()]);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn scan_ignores_comments_and_similar_names() {
        let d = tmpdir("comments");
        std::fs::write(d.join("requirements.txt"), "# debugpy not needed\npydevd-pycharm\nrequests\n").unwrap();
        let (found, _) = scan_debugpy_dep(&d);
        assert!(!found);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn scan_finds_debugpy_in_pyproject_project_deps() {
        let d = tmpdir("pyproject");
        std::fs::write(
            d.join("pyproject.toml"),
            "[project]\nname = \"x\"\n\n[project.dependencies]\ndebugpy = \">=1.8\"\nrequests = \"*\"\n",
        )
        .unwrap();
        let (found, files) = scan_debugpy_dep(&d);
        assert!(found);
        assert_eq!(files, vec!["pyproject.toml".to_string()]);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn scan_no_hit_on_clean_workspace() {
        let d = tmpdir("clean");
        let (found, files) = scan_debugpy_dep(&d);
        assert!(!found);
        assert!(files.is_empty());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn requirements_line_variants() {
        for line in ["debugpy", "debugpy>=1.8", "debugpy == 1.8.0", " debugpy; python_version >= '3.10'"] {
            assert!(requirements_line_mentions_debugpy(line), "应命中: {line}");
        }
        for line in ["", "# debugpy comment", "-r requirements-base.txt", "pydevd-pycharm", "debugpy-foo"] {
            assert!(!requirements_line_mentions_debugpy(line), "不应命中: {line}");
        }
    }

    // ---------- verbatim 剥离 ----------

    #[test]
    fn strip_verbatim_prefixes() {
        use std::path::Path;
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\F:\ai-pro\open-charm\vendor\debugpy\debugpy")),
            Path::new(r"F:\ai-pro\open-charm\vendor\debugpy\debugpy"),
        );
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\server\share\debugpy")),
            Path::new(r"\\server\share\debugpy"),
        );
        assert_eq!(strip_verbatim(PathBuf::from(r"F:\normal\path")), Path::new(r"F:\normal\path"));
        assert_eq!(strip_verbatim(PathBuf::from(r"\\server\normal")), Path::new(r"\\server\normal"));
    }
}
