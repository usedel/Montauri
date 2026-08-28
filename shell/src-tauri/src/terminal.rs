// 集成终端（Phase 4 / P2-7 多终端会话）：PTY 进程管理 + 数据/退出事件转发。
// 设计要点：
// - 依赖 portable-pty（Windows 走 ConPTY API，Unix 走 openpty）；
// - 多会话：TERMS 以前端分配的 id（"term-1"、"term-2"…）为键的 HashMap；
// - 输出/退出事件 payload 带 id，前端按 id 分发到对应终端；
// - P0：自动激活虚拟环境（复用 env_cmds::get_interpreter 优先级）+ UTF-8 环境变量注入；
// - 不侵入外壳内部 API（架构第一原则）：本模块与 lsp/env_cmds 平级，仅通过 tauri 命令/事件交互。

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

use crate::util::unpoison;

/// 单个终端会话：master 供 resize / clone reader / take writer；writer/child 各自持有。
struct TermSession {
    master: Box<dyn MasterPty>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

static TERMS: LazyLock<Mutex<HashMap<String, TermSession>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// 杀掉并移除指定会话（不 emit term-exit——只有「自然退出」才 notify 前端）。
fn kill_session(id: &str) {
    let mut map = unpoison(TERMS.lock());
    if let Some(mut s) = map.remove(id) {
        let _ = s.child.kill();
    }
}

/// 解析要启动的 shell：(program, args)。
/// 优先级：前端显式指定 > pwsh.exe > powershell.exe > cmd.exe（Windows）；Unix 用 $SHELL / bash。
fn shell_candidates(preferred: Option<String>) -> Vec<(String, Vec<String>)> {
    if let Some(p) = preferred {
        let p = p.trim().to_string();
        if !p.is_empty() {
            return vec![(p, Vec::new())];
        }
    }
    if cfg!(windows) {
        vec![
            ("pwsh.exe".to_string(), vec!["-NoLogo".to_string()]),
            ("powershell.exe".to_string(), vec!["-NoLogo".to_string()]),
            ("cmd.exe".to_string(), Vec::new()),
        ]
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        vec![(shell, Vec::new())]
    }
}

/// 从解释器路径反推 venv 根目录（`.venv/Scripts/python.exe` → `.venv`）。
/// 用 `pyvenv.cfg` 标记确认，避免把系统 Python 的 Scripts/bin 目录误判为 venv。
/// 注：仅覆盖 CPython 标准 venv（uv / python -m venv）；conda 等其它形式后续再扩。
fn venv_root_of(interpreter: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(interpreter);
    let bin_dir = p.parent()?; // .../.venv/Scripts 或 .../.venv/bin
    let root = bin_dir.parent()?; // .../.venv
    root.join("pyvenv.cfg").is_file().then(|| root.to_path_buf())
}

/// 启动终端：创建 PTY → spawn shell（cwd 锚定工作区）→ 起读线程 + 退出监视线程。
/// 返回实际激活的 venv 名（如 ".venv"），供前端在标签上指示环境。
#[tauri::command]
pub fn term_spawn(
    app: AppHandle,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
    workspace_root: Option<String>,
) -> Result<Option<String>, String> {
    kill_session(&id); // 同名重启先杀旧会话

    // 复用解释器系统（工作区配置 > .venv 自动检测 > 无），与运行按钮行为一致
    let venv_root = workspace_root
        .as_deref()
        .and_then(|r| crate::env_cmds::get_interpreter(r.to_string()).ok().flatten())
        .and_then(|i| venv_root_of(&i));

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(4),
            cols: cols.max(4),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("创建伪终端失败: {e}"))?;

    // 依次尝试候选 shell（Windows 无 pwsh 则回退 powershell，再回退 cmd）
    let candidates = shell_candidates(shell);
    let mut last_err = String::new();
    let mut child = None;
    for (prog, args) in candidates {
        let mut cb = CommandBuilder::new(prog.clone());
        if !args.is_empty() {
            cb.args(args.iter().cloned());
        }
        if let Some(dir) = cwd.as_deref() {
            cb.cwd(dir);
        }
        cb.env("TERM", "xterm-256color");
        // P0-2：UTF-8 编码（与 run_script 一致，解决 Windows 中文输出乱码）
        cb.env("PYTHONIOENCODING", "utf-8");
        cb.env("PYTHONUTF8", "1");
        // P0-1：激活虚拟环境（环境变量注入，跨 shell 一致，无 activate 脚本策略风险）
        if let Some(root) = &venv_root {
            let bin = if cfg!(windows) { root.join("Scripts") } else { root.join("bin") };
            let existing = std::env::var("PATH").unwrap_or_default();
            let sep = if cfg!(windows) { ";" } else { ":" };
            cb.env("PATH", format!("{}{sep}{}", bin.display(), existing));
            cb.env("VIRTUAL_ENV", root.as_os_str());
        }
        match pair.slave.spawn_command(cb) {
            Ok(c) => {
                child = Some(c);
                break;
            }
            Err(e) => last_err = format!("{prog}: {e}"),
        }
    }
    let child = child.ok_or_else(|| format!("无法启动终端 shell: {last_err}"))?;

    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    unpoison(TERMS.lock()).insert(id.clone(), TermSession {
        master: pair.master,
        writer,
        child,
    });

    // 读线程：PTY 输出 → term-data 事件（ANSI 原样透传，payload 带 id）
    let app_out = app.clone();
    let id_out = id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_out.emit("term-data", json!({ "id": id_out, "data": data }));
                }
                Err(_) => break,
            }
        }
    });

    // 退出监视线程：轮询 child 状态，自然退出时移除会话并 notify 前端
    let id_exit = id.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let exited = {
            let mut map = unpoison(TERMS.lock());
            let done = match map.get_mut(&id_exit) {
                Some(s) => match s.child.try_wait() {
                    Ok(Some(_)) => true,
                    Ok(None) => false,
                    Err(_) => true,
                },
                None => return, // 已被 term_kill / term_spawn 移除，静默退出
            };
            if done {
                map.remove(&id_exit);
            }
            done
        };
        if exited {
            let _ = app.emit("term-exit", json!({ "id": id_exit }));
            return;
        }
    });

    Ok(venv_root
        .as_ref()
        .and_then(|r| r.file_name())
        .map(|n| n.to_string_lossy().to_string()))
}

/// 前端 xterm onData → 写入 PTY
#[tauri::command]
pub fn term_write(id: String, data: String) -> Result<(), String> {
    let mut map = unpoison(TERMS.lock());
    match map.get_mut(&id) {
        Some(s) => {
            s.writer
                .write_all(data.as_bytes())
                .map_err(|e| e.to_string())?;
            s.writer.flush().map_err(|e| e.to_string())
        }
        None => Err("终端未启动".into()),
    }
}

/// 前端 xterm 尺寸变化 → 调整 PTY 大小
#[tauri::command]
pub fn term_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = unpoison(TERMS.lock());
    match map.get(&id) {
        Some(s) => s
            .master
            .resize(PtySize {
                rows: rows.max(4),
                cols: cols.max(4),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string()),
        None => Ok(()), // 会话未启动，静默忽略
    }
}

/// 终止指定会话（关闭某个终端 tab / 重新 spawn 前调用）
#[tauri::command]
pub fn term_kill(id: String) -> Result<(), String> {
    kill_session(&id);
    Ok(())
}

/// 终止全部会话（关闭工作区时调用）
#[tauri::command]
pub fn term_kill_all() -> Result<(), String> {
    let sessions: Vec<TermSession> = {
        let mut map = unpoison(TERMS.lock());
        map.drain().map(|(_, s)| s).collect()
    };
    for mut s in sessions {
        let _ = s.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// 造一个标准 venv 布局的解释器路径；with_cfg 控制是否放置 pyvenv.cfg。
    fn venv_python(tmp: &Path, with_cfg: bool) -> std::path::PathBuf {
        let venv = tmp.join("proj").join(".venv");
        let bin_dir = if cfg!(windows) { venv.join("Scripts") } else { venv.join("bin") };
        std::fs::create_dir_all(&bin_dir).unwrap();
        if with_cfg {
            std::fs::write(venv.join("pyvenv.cfg"), "home = x").unwrap();
        }
        bin_dir.join(if cfg!(windows) { "python.exe" } else { "python" })
    }

    #[test]
    fn preferred_shell_wins() {
        let cands = shell_candidates(Some("pwsh.exe".into()));
        assert_eq!(cands.len(), 1);
        assert_eq!(cands[0].0, "pwsh.exe");
        assert!(cands[0].1.is_empty());
    }

    #[test]
    fn empty_preferred_falls_through() {
        // 空白 preferred 不应被当作显式 shell，应回退到默认候选
        let cands = shell_candidates(Some("   ".into()));
        assert!(!cands.is_empty());
        assert_ne!(cands[0].0, "   ");
    }

    #[test]
    fn venv_root_detected_with_pyvenv_cfg() {
        let tmp = tmpdir("venv");
        let py = venv_python(&tmp, true);
        let root = venv_root_of(&py.to_string_lossy()).expect("应检测到 venv 根");
        assert!(root.join("pyvenv.cfg").is_file());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn venv_root_none_without_pyvenv_cfg() {
        let tmp = tmpdir("venv2");
        let py = venv_python(&tmp, false);
        assert!(venv_root_of(&py.to_string_lossy()).is_none());
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}