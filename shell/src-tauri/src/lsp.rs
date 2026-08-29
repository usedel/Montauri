// LSP 桥 Rust 侧（ADR-0003）：spawn 引擎进程（stdio）+ Content-Length 帧解析 + 事件转发。
// 引擎无关：pyrefly / basedpyright / opencharm-intel 只是前端传入的命令不同。
//
// P3-T06'：多引擎支持——`engine` 键区分实例（"static" / "intel"），事件 payload 带 engine
// 供前端按引擎分发；intel 缺席不拖垮静态引擎（两实例独立 stdio/线程）。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};

use crate::file_ops::project_hash;
use crate::tool_paths::{resolve_lsp_command, tool_command, ENV_UV};
use crate::logging::{log_line, Level};
use crate::util::{kill_process_tree, kill_process_tree_async, no_window, opencharm_home, unpoison};

use std::sync::atomic::{AtomicU64, Ordering};

struct LspInstance {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
    /// 实例序号（单调递增）：退出监视线程据此判断所监视实例是否已被重启替换。
    seq: u64,
}

static LSP: LazyLock<Mutex<HashMap<String, LspInstance>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static LSP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 启动 LSP 引擎进程（stdio），spawn stdout 帧 / stderr / 退出监视三个线程。
/// `engine` 为实例键（如 "static" / "intel"）；同名重启先杀旧实例。
#[tauri::command]
pub fn lsp_start(app: AppHandle, engine: String, command: String, args: Vec<String>) -> Result<(), String> {
    {
        let mut map = unpoison(LSP.lock());
        if let Some(mut inst) = map.remove(&engine) {
            if let Some(mut child) = inst.child.take() {
                kill_process_tree(&mut child); // 连同可能的子进程一并终止
            }
        }
    }

    let mut child = no_window(
        resolve_lsp_command(&command)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .spawn()
    .map_err(|e| format!("无法启动 `{command}`: {e}（请确认已安装并在 PATH 中）"))?;

    let stdin = child.stdin.take().ok_or("无法获取 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    let seq = LSP_SEQ.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = unpoison(LSP.lock());
        map.insert(engine.clone(), LspInstance { child: Some(child), stdin: Some(stdin), seq });
    }

    // stdout 读线程：Content-Length 帧解析 → lsp-message 事件（payload 带 engine）
    let app_out = app.clone();
    let engine_out = engine.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_frame(&mut reader) {
                Ok(Some(mut payload)) => {
                    if let Value::Object(map) = &mut payload {
                        map.insert("engine".to_string(), json!(engine_out));
                    }
                    let _ = app_out.emit("lsp-message", payload);
                }
                Ok(None) => break,
                Err(e) => {
                    eprintln!("[lsp-bridge] 帧解析错误: {e}");
                    break;
                }
            }
        }
    });

    // stderr 读线程 → lsp-stderr 事件
    let app_err = app.clone();
    let engine_err = engine.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let _ = app_err.emit("lsp-stderr", json!({ "engine": engine_err, "data": String::from_utf8_lossy(&buf) }));
                }
                Err(_) => break,
            }
        }
    });

    // 退出监视线程：以实例序号 seq 锁定监视对象。若同名引擎被重启（seq 变化），
    // 旧线程立即退出，避免误读新实例产生重复 lsp-exit / 线程累积。
    let app_exit = app.clone();
    let engine_exit = engine.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let code = {
            let mut map = unpoison(LSP.lock());
            match map.get_mut(&engine_exit) {
                Some(inst) => {
                    if inst.seq != seq {
                        return; // 实例已被重启替换
                    }
                    match inst.child.as_mut() {
                        Some(child) => match child.try_wait() {
                            Ok(Some(status)) => {
                                inst.child = None;
                                inst.stdin = None;
                                status.code()
                            }
                            Ok(None) => continue,
                            Err(_) => {
                                inst.child = None;
                                inst.stdin = None;
                                None
                            }
                        },
                        None => return,
                    }
                }
                None => return,
            }
        };
        let _ = app_exit.emit("lsp-exit", json!({ "engine": engine_exit, "code": code }));
        return;
    });

    Ok(())
}

/// 读取一个 LSP 帧（Content-Length 头 + JSON payload）
fn read_frame(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
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
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).map_err(|e| e.to_string())?;
    serde_json::from_slice(&buf).map(Some).map_err(|e| e.to_string())
}

/// 发送请求（前端组装 id/method/params，这里只做帧封装写 stdin）
#[tauri::command]
pub fn lsp_send_request(engine: String, id: i64, method: String, params: Value) -> Result<(), String> {
    let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    send_message(&engine, &msg)
}

#[tauri::command]
pub fn lsp_send_notification(engine: String, method: String, params: Value) -> Result<(), String> {
    let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
    send_message(&engine, &msg)
}

/// 响应服务端→客户端请求（如 workspace/configuration；不响应会导致引擎挂起，见 P1-BUG-001）
#[tauri::command]
pub fn lsp_send_response(engine: String, id: i64, result: Value) -> Result<(), String> {
    let msg = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    send_message(&engine, &msg)
}

fn send_message(engine: &str, msg: &Value) -> Result<(), String> {
    let mut map = unpoison(LSP.lock());
    let stdin = map
        .get_mut(engine)
        .and_then(|i| i.stdin.as_mut())
        .ok_or("LSP 未启动")?;
    let payload = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    write!(stdin, "Content-Length: {}\r\n\r\n{}", payload.len(), payload).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

/// 停止 LSP 引擎进程；`engine` 为 "*" / "all" 时停止全部实例。
#[tauri::command]
pub fn lsp_stop(engine: String) -> Result<(), String> {
    let start = std::time::Instant::now();
    log_line(Level::Info, &format!("[lsp_stop] begin engine={engine}"));
    let mut map = unpoison(LSP.lock());
    if engine == "*" || engine == "all" {
        for (_, mut inst) in map.drain() {
            if let Some(c) = inst.child.take() {
                log_line(Level::Debug, &format!("[lsp_stop] kill_process_tree_async: pid={}", c.id()));
                kill_process_tree_async(c); // 异步终止，避免关闭工作区时阻塞数秒
            }
        }
    } else if let Some(mut inst) = map.remove(&engine) {
        if let Some(c) = inst.child.take() {
            log_line(Level::Debug, &format!("[lsp_stop] kill_process_tree_async: pid={}", c.id()));
            kill_process_tree_async(c);
        }
    }
    log_line(Level::Info, &format!("[lsp_stop] done, took={:?}", start.elapsed()));
    Ok(())
}

/// 打包后 Tauri 资源目录候选：bundle.resources 的落地位置跨平台有差异，
/// 列出多个常见位置（resource_dir() 本身与其 resources/ 子目录），命中即用。
/// 供 locate_intel_binary / locate_probe_src 复用（第 2 步：资源目录支持）。
fn resource_candidates(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(d) = app.path().resource_dir() {
        dirs.push(d.clone());
        dirs.push(d.join("resources"));
    }
    dirs
}

/// 定位 opencharm-intel 二进制，优先顺序：
/// 1) 环境变量 OPENCHARM_INTEL_BIN；
/// 2) 托管目录 <data_root>/runtime/；
/// 3) Tauri 资源目录（打包分发，第 3 步 bundle.resources 落地）；
/// 4) dev 相对 exe 上溯仓库布局（intel/target/<profile>/）。
fn locate_intel_binary(app: &AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("OPENCHARM_INTEL_BIN") {
        let p = std::path::PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    let exe_name = if cfg!(windows) { "opencharm-intel.exe" } else { "opencharm-intel" };

    let runtime = crate::tool_paths::runtime_dir().join(exe_name);
    if runtime.is_file() {
        return Some(runtime);
    }
    for dir in resource_candidates(app) {
        let cand = dir.join(exe_name);
        if cand.is_file() {
            return Some(cand);
        }
    }

    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..6 {
        dir.pop();
        for profile in ["release", "debug"] {
            let cand = dir.join("intel").join("target").join(profile).join(exe_name);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

/// 供前端启动 intel：返回 { command, traceDbPath }（command 为 null 表示二进制未构建）。
#[tauri::command]
pub fn get_intel_info(app: AppHandle, workspace_root: String) -> Result<Value, String> {
    let dir = opencharm_home().join("traces");
    let trace_db_path = dir
        .join(format!("{}.db", project_hash(&workspace_root)))
        .to_string_lossy()
        .to_string();
    let command = locate_intel_binary(&app).map(|p| p.to_string_lossy().to_string());
    Ok(json!({ "command": command, "traceDbPath": trace_db_path }))
}

// ---------- 运行脚本（uv run，cwd 锚定文件目录，spike 已验证） ----------

static RUN_CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// 定位 probe/src 注入目录（含 sitecustomize.py 顶层模块），优先顺序：
/// 1) 环境变量 OPENCHARM_PROBE_SRC；
/// 2) 托管目录 <data_root>/runtime/probe/src（及 /probe 兼容）；
/// 3) Tauri 资源目录（打包分发）；
/// 4) dev 相对 exe 上溯仓库布局（probe/src）。
/// 找不到返回 None——运行照常，仅无采集（探针缺席绝不拖垮用户脚本）。
fn locate_probe_src(app: &AppHandle) -> Option<std::path::PathBuf> {
    let is_probe = |p: &std::path::Path| p.join("sitecustomize.py").is_file();

    if let Ok(p) = std::env::var("OPENCHARM_PROBE_SRC") {
        let p = std::path::PathBuf::from(p);
        if is_probe(&p) {
            return Some(p);
        }
    }

    let runtime = crate::tool_paths::runtime_dir();
    for cand in [runtime.join("probe").join("src"), runtime.join("probe")] {
        if is_probe(&cand) {
            return Some(cand);
        }
    }

    for dir in resource_candidates(app) {
        for cand in [
            dir.join("probe").join("src"),
            dir.join("resources").join("probe").join("src"),
        ] {
            if is_probe(&cand) {
                return Some(cand);
            }
        }
    }

    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..5 {
        dir.pop();
        let cand = dir.join("probe").join("src");
        if is_probe(&cand) {
            return Some(cand);
        }
    }
    None
}

/// 运行脚本：立即返回，输出经 run-stdout / run-stderr / run-exit 事件流式转发。
/// P25-T06：选中解释器 → 直接 <解释器> <file>；未选中 → uv run 兜底。
/// P25-T09：probe 开关——false 时不注入运行时探针（probe 注入对两种运行方式同样生效，仅在 probe=true 时）。
#[tauri::command]
pub fn run_script(app: AppHandle, path: String, workspace_root: Option<String>, probe: bool) -> Result<(), String> {
    {
        let rc = unpoison(RUN_CHILD.lock());
        if rc.is_some() {
            return Err("已有脚本在运行".into());
        }
    }

    let p = std::path::Path::new(&path);
    let dir = p.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
    let fname = p
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();

    let script_abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(p)
    };

    // 解释器分支：工作区配置优先，其次 .venv 自动检测（见 env_cmds::get_interpreter）
    let interpreter = workspace_root
        .as_deref()
        .and_then(|r| crate::env_cmds::get_interpreter(r.to_string()).ok().flatten());

    let mut cmd = if let Some(interp) = &interpreter {
        let mut c = Command::new(interp);
        c.arg(&script_abs);
        c
    } else {
        let mut c = tool_command("uv", ENV_UV);
        c.args(["run", &fname]);
        c
    };

    cmd
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // P2-T06 探针注入（probe 开关关闭时不注入，P25-T09）：
    let probe_src = if probe { locate_probe_src(&app) } else { None };
    if let Some(src) = &probe_src {
        let src_str = src.to_string_lossy().to_string();
        let sep = if cfg!(windows) { ";" } else { ":" };
        let existing = std::env::var("PYTHONPATH").unwrap_or_default();
        let pythonpath = if existing.is_empty() {
            src_str
        } else {
            format!("{src_str}{sep}{existing}")
        };
        cmd.env("PYTHONPATH", pythonpath)
            .env("OPENCHARM_PROBE_AUTOSTART", "1")
            .env("OPENCHARM_PROBE_SCRIPT", &script_abs)
            .env("OPENCHARM_PROBE_HOME", crate::util::opencharm_home());
    }

    let mut child = no_window(&mut cmd)
        .spawn()
        .map_err(|e| format!("无法启动运行命令: {e}"))?;

    if probe && probe_src.is_none() {
        let _ = app.emit(
            "run-stderr",
            json!({ "data": "[opencharm-probe] 未找到 probe/src，本次运行不采集（可用环境变量 OPENCHARM_PROBE_SRC 指定）\n" }),
        );
    }

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    {
        let mut rc = unpoison(RUN_CHILD.lock());
        rc.replace(child);
    }

    // stdout 流式转发
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

    // stderr 流式转发
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

    // 退出监视线程
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let code = {
            let mut rc = unpoison(RUN_CHILD.lock());
            match rc.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        rc.take();
                        status.code()
                    }
                    Ok(None) => continue,
                    Err(_) => {
                        rc.take();
                        None
                    }
                },
                None => return,
            }
        };
        let _ = app.emit("run-exit", json!({ "code": code }));
        return;
    });

    Ok(())
}

/// 停止运行中的脚本
#[tauri::command]
pub fn stop_script() -> Result<(), String> {
    let mut rc = unpoison(RUN_CHILD.lock());
    if let Some(mut child) = rc.take() {
        kill_process_tree(&mut child); // 杀 uv/解释器连带其 python 脚本子树
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn frame(payload: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{}", payload.len(), payload).into_bytes()
    }

    #[test]
    fn reads_content_length_frame() {
        let payload = r#"{"jsonrpc":"2.0","id":1,"result":{}}"#;
        let second = r#"{"jsonrpc":"2.0","method":"exit"}"#;
        let mut buf = frame(payload);
        buf.extend_from_slice(&frame(second));

        let mut cursor = Cursor::new(buf);
        // 第一帧解析正确
        let got = read_frame(&mut cursor).unwrap().expect("应读出一帧");
        assert_eq!(got["id"].as_i64(), Some(1));
        assert_eq!(got["result"], json!({}));
        // 连续第二帧仍可读（流式帧边界正确）
        let got2 = read_frame(&mut cursor).unwrap().expect("应读出第二帧");
        assert_eq!(got2["method"].as_str(), Some("exit"));
    }

    #[test]
    fn returns_none_on_empty_input() {
        let mut cursor = Cursor::new(Vec::<u8>::new());
        assert!(read_frame(&mut cursor).unwrap().is_none());
    }

    #[test]
    fn errors_without_content_length() {
        // 头部无 Content-Length 行 → 缺头错误
        let mut cursor = Cursor::new(b"Header: 1\r\n\r\n{}".to_vec());
        assert!(read_frame(&mut cursor).is_err());
    }
}