// 工具链引导（Phase 4 · 第 4 步）：首次启动探测 + 一键安装 uv / 静态引擎（pyrefly / basedpyright）。
//
// 全新 Windows 系统缺 uv / pyrefly 时，shell 的补全、跳转、运行均无法工作。
// 本模块补上「随包分发」外的最后一块：探测缺失项，并引导用户一键把这些
// 外部工具安装到用户目录（~/.local/bin、~/.opencharm/bin，不污染系统）。
//
// 设计边界：只做「探测」与「引导安装」，不做版本锁定与升级；版本锁定仍走 ci/versions.toml。

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::tool_paths::{is_available, resolve_tool, ENV_RUFF, ENV_UV};
use crate::util::no_window;

/// 安装类命令超时（含网络下载）。
const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

/// 引擎 → uv/pip 包名。
fn engine_package(engine: &str) -> &'static str {
    match engine {
        "basedpyright" => "basedpyright",
        _ => "pyrefly",
    }
}

/// 引擎 → LSP 可执行命令名（与前端 client.ts 的 command 一致）。
fn engine_command(engine: &str) -> &'static str {
    match engine {
        "basedpyright" => "basedpyright-langserver",
        _ => "pyrefly",
    }
}

/// 探测工具链状态（uv / 当前静态引擎 / ruff），返回缺失清单供前端引导。
#[tauri::command]
pub fn detect_toolchain(engine: String) -> Result<Value, String> {
    let cmd = engine_command(&engine);
    let uv_ok = is_available("uv", ENV_UV);
    let engine_ok = is_available(cmd, "");
    let ruff_ok = is_available("ruff", ENV_RUFF);
    Ok(json!({
        "uv": uv_ok,
        "engine": { "name": engine, "command": cmd, "ok": engine_ok },
        "ruff": ruff_ok,
        "allOk": uv_ok && engine_ok,
    }))
}

/// 一键安装缺失工具（uv → 静态引擎），进度经 toolchain-stdout / toolchain-stderr 流式推送。
#[tauri::command]
pub async fn install_toolchain(app: AppHandle, engine: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || install_toolchain_impl(app, &engine))
        .await
        .map_err(|e| format!("安装任务异常：{e}"))?
}

fn install_toolchain_impl(app: AppHandle, engine: &str) -> Result<bool, String> {
    let pkg = engine_package(engine);
    let cmd = engine_command(engine);

    // 1. 确保 uv 就绪（缺失则走官方安装脚本，装到 ~/.local/bin）
    if !is_available("uv", ENV_UV) {
        emit(&app, "toolchain-stdout", "安装 uv（官方脚本，需联网）…\n")?;
        if cfg!(windows) {
            // 引导安装到 OpenCharm 托管目录（<data_root>/.opencharm/bin），不写用户主目录；
            // tool_command 会对托管 uv 注入 UV_CACHE_DIR 重定向缓存。
            let install_dir = crate::tool_paths::managed_bin_dir();
            std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
            let ps = format!(
                "$env:UV_INSTALL_DIR='{}'; irm https://astral.sh/uv/install.ps1 | iex",
                install_dir.to_string_lossy()
            );
            run_streaming(
                &app,
                "powershell.exe",
                &[
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    &ps,
                ],
                INSTALL_TIMEOUT,
            )?;
        } else {
            run_streaming(
                &app,
                "sh",
                &["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"],
                INSTALL_TIMEOUT,
            )?;
        }
    }

    // 2. 定位 uv 绝对路径（托管目录 ~/.local/bin 命中，无需新 shell 刷新 PATH）
    let uv = resolve_tool("uv", ENV_UV)
        .ok_or_else(|| "uv 安装后仍未找到，请重启 OpenCharm 或手动把 uv 加入 PATH".to_string())?;
    emit(&app, "toolchain-stdout", &format!("uv 位置：{}\n", uv.display()))?;

    // 3. 安装静态引擎（uv tool install，落 ~/.local/bin）
    if !is_available(cmd, "") {
        emit(&app, "toolchain-stdout", &format!("安装静态引擎 `{pkg}`（uv tool install）…\n"))?;
        let uv_str = uv.to_string_lossy().to_string();
        let tool_dir = crate::tool_paths::managed_bin_dir().to_string_lossy().to_string();
        run_streaming(&app, &uv_str, &["tool", "install", "--tool-dir", tool_dir.as_str(), pkg], INSTALL_TIMEOUT)?;
    }

    // 4. 复核
    let ok = is_available(cmd, "");
    emit(
        &app,
        "toolchain-stdout",
        if ok { "环境就绪。\n" } else { "安装结束，但引擎仍不可见；请重启 OpenCharm 后再试。\n" },
    )?;
    Ok(ok)
}

/// 向 WebView 推送一行安装日志。
fn emit(app: &AppHandle, event: &str, data: &str) -> Result<(), String> {
    app.emit(event, json!({ "data": data })).map_err(|e| e.to_string())
}

/// 后台线程逐行读取子进程输出并转发事件。
fn stream_lines<R: Read + Send + 'static>(
    r: R,
    app: AppHandle,
    event: &'static str,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(r);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&buf).replace("\r\n", "\n").replace('\r', "\n");
                    let _ = app.emit(event, json!({ "data": text }));
                }
                Err(_) => break,
            }
        }
    })
}

/// 运行外部命令，流式转发 stdout/stderr，带超时；返回退出码。
fn run_streaming(app: &AppHandle, program: &str, args: &[&str], timeout: Duration) -> Result<i32, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    let mut child = no_window(&mut cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 `{program}`：{e}"))?;

    let out_thread = stream_lines(child.stdout.take().unwrap(), app.clone(), "toolchain-stdout");
    let err_thread = stream_lines(child.stderr.take().unwrap(), app.clone(), "toolchain-stderr");

    let start = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = out_thread.join();
                    let _ = err_thread.join();
                    return Err(format!("命令执行超时（{} 秒）", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(format!("等待进程失败：{e}"));
            }
        }
    };
    let _ = out_thread.join();
    let _ = err_thread.join();
    Ok(code.unwrap_or(-1))
}