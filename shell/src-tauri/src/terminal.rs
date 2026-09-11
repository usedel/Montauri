// 集成终端（Phase 4 / P2-7 多终端会话）：PTY 进程管理 + 数据/退出事件转发。
// 设计要点：
// - 依赖 portable-pty（Windows 走 ConPTY API，Unix 走 openpty）；
// - 多会话：TERMS 以前端分配的 id（"term-1"、"term-2"…）为键的 HashMap；
// - 输出/退出事件 payload 带 id，前端按 id 分发到对应终端；
// - P0：自动激活虚拟环境（复用 env_cmds::get_interpreter 优先级）+ UTF-8 环境变量注入；
// - S3：`run_in_terminal` 复用同一套会话管理直接跑脚本（真 TTY），环境注入与 `run_script`
//   共用 `run_env`（偿还 tech-debt 第 8 条，杜绝 handoff §4.2 坑 6 的路径漂移）；
// - 不侵入外壳内部 API（架构第一原则）：本模块与 lsp/env_cmds 平级，仅通过 tauri 命令/事件交互。

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

use crate::logging::{log_line, Level};
use crate::tool_paths::{find_on_path, ENV_UV};
use crate::util::{unpoison, IncrementalUtf8Decoder};

/// 单个终端会话：master 供 resize / clone reader / take writer；writer/child 各自持有。
/// CR-03：writer 独立 `Arc<Mutex>` —— `term_write` 取克隆后释放全局锁再写。
/// 持 TERMS 全局锁写 PTY（大段粘贴 / 引擎卡死）会阻塞 `term_kill` → 无法停止，子系统死锁。
struct TermSession {
    master: Box<dyn MasterPty>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
}

static TERMS: LazyLock<Mutex<HashMap<String, TermSession>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// 「运行终端」会话 id 前缀（S3）：前端按此约定分配 id，后端据此与普通 shell 会话区分——
/// 单实例守卫（`run_terminal_busy`）与前端退出事件路由都依赖它。
pub(crate) const RUN_TERM_PREFIX: &str = "run-term-";

/// 是否有「在终端中运行」的会话在跑（供 `lsp::run_script` 做单实例守卫，§4.7 结论 3）。
/// 会话自然退出 / 被 `term_kill` 后即刻从 TERMS 移除，因此「停止运行后会话可立即复用」。
pub(crate) fn run_terminal_busy() -> bool {
    unpoison(TERMS.lock()).keys().any(|k| k.starts_with(RUN_TERM_PREFIX))
}

/// 杀掉并移除指定会话（不 emit term-exit——只有「自然退出」才 notify 前端）。
/// CR-03：锁内只取出，kill 与 drop（ConPTY master 清理，可能阻塞）都在锁外。
fn kill_session(id: &str) {
    let taken = unpoison(TERMS.lock()).remove(id);
    if let Some(mut s) = taken {
        let _ = s.child.kill();
    } // s 在锁外 drop
}

// 注：曾有 kill_session_internal（dap.rs 调试会话清理用）——v1.2 架构 debuggee 落
// PTY 时需连带清 TERMS 槽；v1.3 改管道模式（进程树由 dap 侧 taskkill，不占 TERMS）
// 后失去调用方，移除。CR-03 锁外 drop 纪律保留在上方 kill_session 的注释里。

/// shell 规格：可执行名 + 启动参数。别名供设置项 `terminal_shell` 与前端 `shell` 参数使用。
#[derive(Clone, Copy)]
struct ShellSpec {
    program: &'static str,
    args: &'static [&'static str],
}

/// Windows 可用交互 shell（顺序即 "auto" 的回退优先级）。
/// cmd 用 `/d` 跳过 AutoRun 注册表项，避免用户机器上的 autorun 干扰交互。
const WINDOWS_SHELLS: &[(&str, ShellSpec)] = &[
    ("pwsh", ShellSpec { program: "pwsh.exe", args: &["-NoLogo"] }),
    ("powershell", ShellSpec { program: "powershell.exe", args: &["-NoLogo"] }),
    ("cmd", ShellSpec { program: "cmd.exe", args: &["/d"] }),
];

/// 解析要启动的 shell：(program, args)。
/// `preferred` 取值（对应前端 `app.settings.terminal_shell`，经 `term_spawn` 的 `shell` 参数传入）：
/// - "auto" / 空：Windows 按 pwsh → powershell → cmd 依次回退；Unix 用 $SHELL / bash。
/// - 别名（`pwsh` / `powershell` / `cmd`）：只返回该 shell（spawn 失败不再回退）。
/// - 其它非空：视为可执行路径直接返回（向后兼容，如旧的 `pwsh.exe` 显式指定）。
fn shell_candidates(preferred: Option<String>) -> Vec<(String, Vec<String>)> {
    if let Some(p) = preferred {
        let p = p.trim().to_string();
        if !p.is_empty() && p != "auto" {
            if cfg!(windows) {
                if let Some((_, spec)) = WINDOWS_SHELLS.iter().find(|(alias, _)| *alias == p) {
                    return vec![(spec.program.to_string(), spec.args.iter().map(|s| s.to_string()).collect())];
                }
            }
            return vec![(p, Vec::new())];
        }
    }
    if cfg!(windows) {
        WINDOWS_SHELLS
            .iter()
            .map(|(_, spec)| (spec.program.to_string(), spec.args.iter().map(|s| s.to_string()).collect()))
            .collect()
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        vec![(shell, Vec::new())]
    }
}

/// 探测当前机器可用的交互 shell 别名（**不含** `"auto"`——auto 是前端追加的回退语义项）。
/// Windows：遍历 `WINDOWS_SHELLS`，`cmd` 优先 `ComSpec`（PATH 被清空也能可靠命中），
/// 其余走 PATH 查找；Unix：返回 `$SHELL` 的文件名（无则 `bash`）。
#[tauri::command]
pub fn list_shells() -> Result<Vec<String>, String> {
    if cfg!(windows) {
        let mut out = Vec::new();
        for (alias, spec) in WINDOWS_SHELLS {
            let available = if *alias == "cmd" {
                std::env::var_os("ComSpec")
                    .map(|p| std::path::Path::new(&p).is_file())
                    .unwrap_or(false)
                    || find_on_path(spec.program).is_some()
            } else {
                find_on_path(spec.program).is_some()
            };
            if available {
                out.push((*alias).to_string());
            }
        }
        Ok(out)
    } else {
        let shell = std::env::var("SHELL")
            .ok()
            .and_then(|s| {
                std::path::Path::new(&s)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "bash".to_string());
        Ok(vec![shell])
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

    start_session(&app, &id, pair.master, child)?;

    Ok(venv_root
        .as_ref()
        .and_then(|r| r.file_name())
        .map(|n| n.to_string_lossy().to_string()))
}

/// 会话落地（`term_spawn` / `run_in_terminal` / `dap::debug_start` **共用**）：登记 TERMS +
/// 起读线程 + 退出监视线程。各路径的会话生命周期因此完全一致，前端只需按 id 分发。
pub(crate) fn start_session(
    app: &AppHandle,
    id: &str,
    master: Box<dyn MasterPty>,
    child: Box<dyn Child + Send + Sync>,
) -> Result<(), String> {
    let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    unpoison(TERMS.lock()).insert(id.to_string(), TermSession { master, writer: Arc::new(Mutex::new(writer)), child });

    // 读线程：PTY 输出 → term-data 事件（ANSI 原样透传，payload 带 id）。
    // 坑 5：按 8192 字节切块后直接 `from_utf8_lossy`，中文若正好跨块会被替换成乱码。
    // 终端平时输出量大不显眼，但交互式一问一答（每块就几个字）必然暴露 → 换增量 UTF-8 解码。
    let app_out = app.clone();
    let id_out = id.to_string();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        let mut decoder = IncrementalUtf8Decoder::default();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = decoder.push(&buf[..n]);
                    if data.is_empty() {
                        continue; // 整块都是被截断的多字节尾巴，等下一块拼完整
                    }
                    let _ = app_out.emit("term-data", json!({ "id": id_out, "data": data }));
                }
                Err(_) => break,
            }
        }
        // 流结束：冲刷残留字节（不静默吞掉最后半个字符）
        let tail = decoder.finish();
        if !tail.is_empty() {
            let _ = app_out.emit("term-data", json!({ "id": id_out, "data": tail }));
        }
    });

    // 退出监视线程：轮询 child 状态，自然退出时移除会话并 notify 前端
    let app_exit = app.clone();
    let id_exit = id.to_string();
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
            let _ = app_exit.emit("term-exit", json!({ "id": id_exit }));
            return;
        }
    });

    Ok(())
}

/// S3：在终端中运行脚本（真 TTY）。**直接 spawn 解释器 + [脚本, ...参数]，跳过 `shell_candidates`**
/// ——套一层 `pwsh -c python x.py` 会让 Ctrl+C 与退出码多一层语义损耗。
///
/// - env / PYTHONPATH / args 与 `run_script` **完全一致**（共用 `run_env::build_run_env`，偿还 TD-8 / 坑 6）；
/// - PTY 下 stdin 天然是 TTY：`getpass` / `tqdm` / `rich` / 彩色输出 / Ctrl+C 均可用（坑 3，管道模式做不到）；
/// - probe 采集首版**默认关闭**（`probe=false`）：TTY 交互场景采样价值为零，且 probe 输出与 ANSI
///   的交互未实测（§4.7 结论 4，待有证据再评估开启，单列验收）；
/// - `stdin.mode == "file"` 不支持：PTY 无法直接 `Stdio::from(File)`，fail fast 给出可执行出路（§4.4 末行）；
///   不静默降级成手工输入——那会破坏「可复现」这一 file 模式的核心诉求。
///
/// 返回非致命告警（如 Parameters 解析失败），由前端写入终端回显。
#[tauri::command]
pub fn run_in_terminal(
    app: AppHandle,
    id: String,
    cols: u16,
    rows: u16,
    path: String,
    workspace_root: Option<String>,
) -> Result<Vec<String>, String> {
    // 单实例统一模型（§4.7 结论 3）：输出面板路径占用时拒绝，反之亦然（见 lsp::run_script）
    if crate::lsp::run_slot_busy() {
        return Err("已有脚本在运行".into());
    }
    // 三态互斥（debug dev plan §3.2）：调试占用时拒绝终端运行
    if crate::dap::debug_busy() {
        return Err("已有调试会话在运行".into());
    }
    if !id.starts_with(RUN_TERM_PREFIX) {
        return Err(format!("运行终端会话 id 必须以 `{RUN_TERM_PREFIX}` 开头（前后端约定，用于与普通 shell 会话区分）"));
    }
    kill_session(&id); // 复用同一会话槽：停止运行后会话可立即复用（验收项）

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

    // 解释器与运行配置的解析口径与 run_script 一致（工作区配置 > .venv 自动检测 > uv run 兜底）
    let interpreter = workspace_root
        .as_deref()
        .and_then(|r| crate::env_cmds::get_interpreter(r.to_string()).ok().flatten());
    let run_config = workspace_root
        .as_deref()
        .map(|r| crate::env_cmds::read_run_config(r, &path))
        .unwrap_or_default();

    if run_config.stdin.effective_mode() == "file" {
        return Err(
            "「在终端中运行」不支持标准输入重定向自文件（PTY 无法直接接管文件）。请在标签右键 →「运行配置…」中把标准输入改为「不接输入」或「交互式」，或改用普通「运行」。"
                .into(),
        );
    }

    let run_cmd = crate::run_env::resolve_run_command(&script_abs, &fname, interpreter.as_deref());
    // uv 兜底分支：uv 缺席时给出可诊断的出路，而不是让 spawn 抛一行 OS 报错
    if run_cmd.is_uv && !crate::tool_paths::is_available("uv", ENV_UV) {
        return Err("未选择解释器且未找到 uv，无法在终端中运行（可在状态栏选择解释器，或先安装 uv）".into());
    }
    // probe=false：见函数文档（§4.7 结论 4）
    let run_env =
        crate::run_env::build_run_env(&app, &script_abs, workspace_root.as_deref(), &run_config, false);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(4),
            cols: cols.max(4),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("创建伪终端失败: {e}"))?;

    let mut cb = CommandBuilder::new(run_cmd.program.clone());
    cb.args(run_cmd.args.iter().cloned());
    // 运行配置 args 追加在脚本之后（与 run_script 同序，两分支通用）
    cb.args(run_env.args.iter().cloned());
    cb.cwd(&dir);
    // PTY 专有：xterm/ANSI 协商（终端能力声明，不影响 Python 语义，非环境漂移）
    cb.env("TERM", "xterm-256color");
    for (k, v) in &run_cmd.env {
        cb.env(k, v);
    }
    for (k, v) in &run_env.env {
        cb.env(k, v);
    }

    let child = pair
        .slave
        .spawn_command(cb)
        .map_err(|e| format!("无法在终端中启动运行命令: {e}"))?;

    start_session(&app, &id, pair.master, child)?;
    Ok(run_env.warnings)
}

/// 前端 xterm onData → 写入 PTY
#[tauri::command]
pub fn term_write(id: String, data: String) -> Result<(), String> {
    // CR-03：全局锁只查表——克隆 Arc 后立即释放，写阻塞不再持全局锁，
    // term_kill / term_spawn / 退出监视线程始终可以拿到 map 完成清理。
    let writer = {
        let map = unpoison(TERMS.lock());
        map.get(&id).map(|s| s.writer.clone()).ok_or("终端未启动")?
    };
    let mut w = unpoison(writer.lock());
    w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
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
    let start = std::time::Instant::now();
    kill_session(&id);
    log_line(Level::Debug, &format!("[term_kill] id={id}, took={:?}", start.elapsed()));
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

/// CR-14：应用退出（RunEvent::Exit）清理——同步终止全部 PTY 会话。
/// 与 `term_kill_all` 同逻辑但免走 IPC，且此时不 emit term-exit（前端已不存在）。
pub(crate) fn term_kill_all_for_exit() {
    let sessions: Vec<TermSession> = {
        let mut map = unpoison(TERMS.lock());
        map.drain().map(|(_, s)| s).collect()
    };
    for mut s in sessions {
        let _ = s.child.kill();
    }
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
    fn cmd_alias_resolves_with_d_flag() {
        if cfg!(windows) {
            let cands = shell_candidates(Some("cmd".into()));
            assert_eq!(cands.len(), 1);
            assert_eq!(cands[0].0, "cmd.exe");
            assert_eq!(cands[0].1, vec!["/d".to_string()]);
        }
    }

    #[test]
    fn auto_prefers_pwsh_and_covers_cmd() {
        if cfg!(windows) {
            let cands = shell_candidates(Some("auto".into()));
            assert_eq!(cands.first().map(|(p, _)| p.as_str()), Some("pwsh.exe"));
            assert!(cands.iter().any(|(p, _)| p == "cmd.exe"));
        }
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