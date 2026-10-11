// Python 环境管理（P25-T04）：uv 驱动 + 框架探针 / Pydantic 栈检测 + 依赖预检 / pip 命令。
//
// 2026-10-07 已拆分（P0-4「先冻结再择机拆」执行）：工作区配置存储 / 运行配置 →
// run_config.rs；依赖健康 dep 域前半（style / 声明解析 / 环境快照 / E5 lock）→ dep_health.rs；
// 后半（探针执行 / diff 计算 / dep_scan / 忽略清单 / 修复动作）→ dep_fix.rs。三个新文件各设
// 预算上限，本文件仅余解释器 / venv / 包管理 / 框架探针域（原「切三块」意向按业务域调整为
// 切四块，见 .trae/documents/env-cmds-split.md）。
//
// 冻结线纪律继续有效：**新增的 Python 环境类命令一律落新文件**，本文件**只减不增**。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::run_config::{load_config, read_config, save_config, write_config, RunEntry};
use crate::tool_paths::{tool_command, ENV_UV};
use crate::util::{kill_process_tree, no_window};
use crate::uv_cancel::{register_uv_op, unregister_uv_op};

/// 本地 uv 操作超时（不联网）：卸载 / pip list 等——只与本地解释器和文件系统交互，秒级完成。
///
/// 体验审查 L-2：超时此前**按命令**一刀切（除 venv 外一律 120s），把「会不会联网」这个真正的
/// 分界抹平了——`uv add fastapi` 首次联网解析 + 下载在国内网络下很容易超过 120s，用户看到的是
/// 「依赖安装失败」而非「超时」，白等一场还不知道原因。现按**动作**分级（本地 / 联网）。
pub(crate) const UV_LOCAL_TIMEOUT: Duration = Duration::from_secs(120);
/// 联网 uv 操作超时：建 venv（可能下载 CPython，数十 MB）· pip install / upgrade · uv sync / add / remove。
///
/// 与建环境同量级（原 `UV_VENV_TIMEOUT` 的唯一取值）：首次联网解析 + 下载在国内网络下确实可能
/// 数分钟。等太久的问题交给 L-3 的「取消」解决（用户可随时中止），**不靠把超时调小**——
/// 调小只会把「慢」变成「失败」。
pub(crate) const UV_NETWORK_TIMEOUT: Duration = Duration::from_secs(600);
pub(crate) const UV_LIST_TIMEOUT: Duration = Duration::from_secs(15);
/// outdated 查询需联网，单独给更短超时，避免环境面板被网络拖住
pub(crate) const UV_OUTDATED_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Serialize)]
pub struct PythonInfo {
    pub path: String,
    pub version: String,
    /// workspace-venv | system | manual
    pub kind: String,
    pub is_selected: bool,
}

#[derive(Serialize)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
}

/// 可选的 Python 版本（uv python list 完整解析：已装 + 可下载），供 venv 版本下拉使用
#[derive(Serialize)]
pub struct PythonVersionOption {
    /// 展示版本，如 "3.13.7"
    pub version: String,
    /// uv --python 接受的标识，如 "cpython-3.13.7-windows-x86_64-none"
    pub spec: String,
    /// 已安装时的解释器路径
    pub path: Option<String>,
    /// 是否已安装
    pub installed: bool,
}

/// 过时包（uv pip list --outdated --format=json）
#[derive(Serialize, Deserialize)]
pub struct OutdatedInfo {
    pub name: String,
    pub version: String,
    #[serde(rename = "latest_version")]
    pub latest: String,
    #[serde(rename = "latest_filetype")]
    pub filetype: String,
}

/// 创建 venv 的返回：命令输出 + 创建后的解释器路径（前端直接持久化选中）
#[derive(Serialize)]
pub struct CreateVenvResult {
    pub output: String,
    pub python: String,
}

// ---------- venv 解释器定位 ----------

/// 指定虚拟环境目录下的解释器路径（Windows Scripts/python.exe，Unix bin/python）
fn venv_python_at(dir: &Path) -> Option<String> {
    let candidates: Vec<PathBuf> = if cfg!(windows) {
        vec![dir.join("Scripts").join("python.exe")]
    } else {
        vec![dir.join("bin").join("python")]
    };
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

/// 工作区 .venv 解释器路径
fn venv_python(root: &str) -> Option<String> {
    venv_python_at(&Path::new(root).join(".venv"))
}

// ---------- 命令执行（带超时） ----------

/// 字节级通用执行：可选 stdin 数据 + 字节输出 + 超时。
/// 供 py_eval（lib_cmds）这类需要 stdin 传参、且要求按 UTF-8 字节显式解码输出的调用方使用；
/// 普通调用方走 `run_with_timeout`（本函数的 String 包装，保持既有语义：无效 UTF-8 → 空串）。
pub(crate) fn run_with_timeout_bytes(
    cmd: &mut Command,
    timeout: Duration,
    stdin_data: Option<&[u8]>,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>), String> {
    let mut child = no_window(cmd)
        .stdin(if stdin_data.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    // P1-7（2026-09-29 review）：stdin 写入移到独立线程——原实现在超时监督循环启动
    // **之前**同步 write_all，若子进程 hang 且不读 stdin（数据量超管道缓冲 ~64KB 时），
    // 写入永久阻塞，超时保护尚未生效，spawn_blocking 线程与命令 Promise 永久挂起。
    // 独立线程与下方两个读线程对称；写完 drop 关闭 stdin（脚本侧 read() 拿到 EOF）。
    let stdin_writer = stdin_data.map(|data| {
        let mut stdin = child.stdin.take().unwrap();
        let data = data.to_vec();
        std::thread::spawn(move || {
            use std::io::Write;
            let _ = stdin.write_all(&data);
            let _ = stdin.flush();
        })
    });
    let stdout = child.stdout.take().expect("stdout 已设为 piped");
    let stderr = child.stderr.take().expect("stderr 已设为 piped");
    let out_reader = std::thread::spawn(move || read_all_bytes(stdout));
    let err_reader = std::thread::spawn(move || read_all_bytes(stderr));

    let start = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    kill_process_tree(&mut child); // uv 可能已拉起子进程，须连树一起终止
                    // 杀树后管道关闭，写/读线程自然退出；join 收尸（不阻塞——进程已死）
                    if let Some(t) = stdin_writer {
                        let _ = t.join();
                    }
                    let _ = out_reader.join();
                    let _ = err_reader.join();
                    return Err(format!("命令执行超时（{}s）", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    if let Some(t) = stdin_writer {
        // 正常退出：子进程已终止，写线程不会再阻塞（管道对端关闭后写失败即返回）
        let _ = t.join();
    }
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    Ok((out, err, code))
}

/// String 包装：与历史行为一致——stdout/stderr 按字符串读取，无效 UTF-8 时整体降级为空串。
/// pub(crate)：lib_cmds 的 `uv python find` 与测试复用（R-4：改可见性，禁止复制一份）。
pub(crate) fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Result<(String, String, Option<i32>), String> {
    run_with_timeout_bytes(cmd, timeout, None).map(|(o, e, c)| {
        (
            String::from_utf8(o).unwrap_or_default(),
            String::from_utf8(e).unwrap_or_default(),
            c,
        )
    })
}

fn read_all_bytes(r: impl Read) -> Vec<u8> {
    let mut buf = Vec::new();
    let mut reader = BufReader::new(r);
    let _ = reader.read_to_end(&mut buf);
    buf
}

/// 运行 uv 命令并返回「成功输出」或「错误信息」（供 pip 卸载等**本地**操作）。
fn run_uv_output(cmd: &mut Command) -> Result<String, String> {
    let (out, err, code) = run_with_timeout(cmd, UV_LOCAL_TIMEOUT)?;
    let combined = format!("{out}{err}").trim().to_string();
    if code != Some(0) {
        return Err(if combined.is_empty() { format!("命令失败（exit {code:?}）") } else { combined });
    }
    Ok(combined)
}

/// 逐行读取流并 emit 到前端。
///
/// L-9（体验审查）：uv 的下载进度用 `\r` 把光标拉回行首重绘（`Downloading ━━━ 45%`），
/// 此前把 `\r` 统一转成 `\n`（"适配前端按行滚动"），结果是同一帧在输出面板刷出几十行，
/// 淹没有用输出、还要靠 5000 行环形缓冲兜底。现在保留重写语义：**帧内含 `\r` 时以 `\r`
/// 包裹该帧**（`\r<内容>\r`），前端据此在末行原地更新（output.ts::appendOrUpdateProgressLine）。
/// 普通行（无 `\r`）原样下发，前端行为零变化。
fn stream_lines(
    r: impl Read + Send + 'static,
    app: AppHandle,
    event: &'static str,
    wid: String,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(r);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {
                    let raw = String::from_utf8_lossy(&buf).into_owned();
                    // \r\n 行尾先归一；帧内仍含 \r = 终端重写帧（进度条），标记后下发
                    let normalized = raw.replace("\r\n", "\n");
                    let payload = if normalized.contains('\r') {
                        format!("\r{}\r", normalized.replace('\r', "\n"))
                    } else {
                        normalized
                    };
                    let _ = app.emit_to(&wid, event, json!({ "data": payload }));
                }
                Err(_) => break,
            }
        }
    })
}

/// 命令的「可复制」文本（超时兜底引导用，体验审查 L-7）：program + args 原样拼接。
/// 不做 shell 转义——只用于让用户看懂并手动重跑，不承诺可直接粘进 shell。
fn cmd_display(cmd: &Command) -> String {
    let mut s = cmd.get_program().to_string_lossy().into_owned();
    for a in cmd.get_args() {
        s.push(' ');
        s.push_str(&a.to_string_lossy());
    }
    s
}

/// 流式运行 uv 命令：stdout/stderr 逐行推送到前端（pip-stdout / pip-stderr），返回 exit code。
///
/// `op` 是取消通道的操作名（venv / install / upgrade / fix）——登记后前端可经 `uv_cancel_op`
/// 置位取消标志，轮询循环见标志即杀进程树并返回「已取消」（体验审查 L-3）。
pub(crate) fn run_uv_streaming(
    app: &AppHandle,
    cmd: &mut Command,
    timeout: Duration,
    wid: &str,
    op: &str,
) -> Result<i32, String> {
    let mut child = no_window(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 uv：{e}"))?;
    let cancel = register_uv_op(wid, op, child.id());

    let stdout = child.stdout.take().expect("stdout 已设为 piped");
    let stderr = child.stderr.take().unwrap();

    let out_thread = stream_lines(stdout, app.clone(), "pip-stdout", wid.to_string());
    let err_thread = stream_lines(stderr, app.clone(), "pip-stderr", wid.to_string());

    let start = Instant::now();
    let code = loop {
        // L-3：用户点了取消 → 杀进程树，立即收口（不报失败，由前端按 info 级提示）
        if cancel.load(Ordering::Relaxed) {
            kill_process_tree(&mut child);
            let _ = out_thread.join();
            let _ = err_thread.join();
            unregister_uv_op(wid, op);
            return Err("已取消".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    kill_process_tree(&mut child);
                    let _ = out_thread.join();
                    let _ = err_thread.join();
                    unregister_uv_op(wid, op);
                    // L-7：超时不是终点——把可复制的命令交给用户。光说「超时」用户只能干等或猜，
                    // 带上命令行后慢网下可直接在终端重跑（`uv add fastapi` 这类粘出来就能用）。
                    return Err(format!(
                        "命令执行超时（{}s）——网络较慢时可在终端手动执行：{}",
                        timeout.as_secs(),
                        cmd_display(cmd),
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                kill_process_tree(&mut child);
                let _ = out_thread.join();
                let _ = err_thread.join();
                unregister_uv_op(wid, op);
                return Err(e.to_string());
            }
        }
    };
    let _ = out_thread.join();
    let _ = err_thread.join();
    unregister_uv_op(wid, op);
    Ok(code.unwrap_or(-1))
}

// ---------- 环境信息 ----------

/// 读取解释器版本（python --version → 3.13.7）
fn version_of(python: &str) -> String {
    let mut cmd = Command::new(python);
    cmd.arg("--version");
    let (out, err, _) = run_with_timeout(&mut cmd, Duration::from_secs(5)).unwrap_or_default();
    let raw = format!("{out}{err}");
    raw.trim().trim_start_matches("Python ").to_string()
}

/// 从 spec（如 cpython-3.13.7-windows-x86_64-none）提取展示版本号 "3.13.7"
fn display_version(spec: &str) -> String {
    spec.split('-')
        .find(|seg| seg.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| spec.to_string())
}

/// 版本号解析为可比较三元组（"3.13.7" → (3,13,7)）；非数字段按 0 处理
fn version_triple(v: &str) -> (u64, u64, u64) {
    let mut nums = [0u64; 3];
    for (i, part) in v.split(['.', '-', '+']).take(3).enumerate() {
        let digits: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        nums[i] = digits.parse().unwrap_or(0);
    }
    (nums[0], nums[1], nums[2])
}

/// 是否为 freethreaded（无 GIL）变体，默认不提供
fn is_freethreaded(spec: &str) -> bool {
    spec.contains("freethreaded")
}

/// uv python list 解析 → Vec<(spec, 已装路径)>。
/// 行格式：<spec> <path>（已安装）或 <spec> <download available>（可下载）。
/// spec 为第一段；末段是真实文件路径则视为已安装。
fn uv_python_list_full() -> Result<Vec<(String, Option<String>)>, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["python", "list"]);
    let (out, err, _) = run_with_timeout(&mut cmd, UV_LIST_TIMEOUT)?;
    let stdout = if out.is_empty() { err } else { out };
    let mut list = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut tokens = line.split_whitespace();
        let spec = match tokens.next() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let rest: Vec<&str> = tokens.collect();
        let path = rest
            .last()
            .map(|p| p.to_string())
            .filter(|p| Path::new(p).is_file());
        if !list.iter().any(|(s, _)| *s == spec) {
            list.push((spec, path));
        }
    }
    Ok(list)
}

/// uv python list 解析（仅已安装）→ Vec<(version, path)>
fn uv_python_list() -> Result<Vec<(String, String)>, String> {
    Ok(uv_python_list_full()?
        .into_iter()
        .filter_map(|(spec, path)| path.map(|p| (spec, p)))
        .collect())
}

// ---------- Tauri 命令 ----------
//
// 注意：本文件所有命令都会阻塞式等待 uv/python 子进程（最长 60s）。
// Tauri 2 的同步 command 在主线程执行，会直接卡死 UI，因此统一声明为 async
// 并放进 spawn_blocking 阻塞线程池（官方推荐做法，见 v2.tauri.app/develop/calling-rust）。

/// 环境列表：工作区 .venv + uv python list + （已选但不在列表的）手动解释器
#[tauri::command]
pub async fn list_pythons(workspace_root: String) -> Result<Vec<PythonInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_pythons_impl(workspace_root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn list_pythons_impl(workspace_root: String) -> Result<Vec<PythonInfo>, String> {
    let selected = read_config(&workspace_root);
    let mut out: Vec<PythonInfo> = Vec::new();

    if let Some(p) = venv_python(&workspace_root) {
        let is_sel = selected.as_deref() == Some(p.as_str());
        out.push(PythonInfo {
            version: version_of(&p),
            path: p.clone(),
            kind: "workspace-venv".into(),
            is_selected: is_sel,
        });
    }

    if let Ok(list) = uv_python_list() {
        for (version, path) in list {
            if out.iter().any(|x| x.path == path) {
                continue;
            }
            let is_sel = selected.as_deref() == Some(path.as_str());
            out.push(PythonInfo { path: path.clone(), version, kind: "system".into(), is_selected: is_sel });
        }
    }

    // 手动添加的解释器：已选但既不来自 .venv 也不在 uv 列表
    if let Some(sel) = &selected {
        if !out.iter().any(|x| &x.path == sel) {
            out.push(PythonInfo {
                version: version_of(sel),
                path: sel.clone(),
                kind: "manual".into(),
                is_selected: true,
            });
        }
    }
    Ok(out)
}

/// 可选的 Python 版本列表（含可下载）：已装在前，版本号降序。
#[tauri::command]
pub async fn list_python_versions() -> Result<Vec<PythonVersionOption>, String> {
    tauri::async_runtime::spawn_blocking(list_python_versions_impl)
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn list_python_versions_impl() -> Result<Vec<PythonVersionOption>, String> {
    let full = uv_python_list_full()?;
    let mut out: Vec<PythonVersionOption> = full
        .into_iter()
        .filter(|(spec, _)| !is_freethreaded(spec))
        .map(|(spec, path)| PythonVersionOption {
            installed: path.is_some(),
            version: display_version(&spec),
            spec,
            path,
        })
        .collect();
    out.sort_by(|a, b| {
        b.installed
            .cmp(&a.installed)
            .then_with(|| version_triple(&b.version).cmp(&version_triple(&a.version)))
    });
    Ok(out)
}

/// 自动选用一个已安装的系统解释器：稳定版且 ≥3.12 优先，其次稳定版，最后任意解释器
#[tauri::command]
pub async fn pick_default_system_interpreter() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(pick_default_system_interpreter_impl)
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn pick_default_system_interpreter_impl() -> Result<Option<String>, String> {
    let installed = uv_python_list()?;
    if installed.is_empty() {
        return Ok(None);
    }
    let stable = |v: &str| !v.contains('a') && !v.contains('b') && !v.contains("rc");
    let eligible = |spec: &str| !is_freethreaded(spec) && stable(&display_version(spec));
    // 优先：稳定且 ≥3.12
    let mut cands: Vec<&(String, String)> = installed
        .iter()
        .filter(|(spec, _)| eligible(spec))
        .filter(|(spec, _)| {
            let (maj, min, _) = version_triple(&display_version(spec));
            maj > 3 || (maj == 3 && min >= 12)
        })
        .collect();
    if cands.is_empty() {
        cands = installed.iter().filter(|(s, _)| eligible(s)).collect();
    }
    if cands.is_empty() {
        cands = installed.iter().collect();
    }
    cands.sort_by(|a, b| {
        version_triple(&display_version(&b.0)).cmp(&version_triple(&display_version(&a.0)))
    });
    Ok(cands.first().map(|(_, p)| p.clone()))
}

/// 创建 venv：uv venv <workspace_root>/.venv [--python <version>]。
/// 环境一律独立于项目目录内（项目环境隔离原则，不提供跨项目共享的全局环境）。
/// 返回命令输出 + 创建后的解释器路径，供前端直接持久化选中。
#[tauri::command]
pub async fn create_venv(app: AppHandle, window: tauri::WebviewWindow, workspace_root: String, version: String) -> Result<CreateVenvResult, String> {
    let wid = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || create_venv_impl(app, workspace_root, version, wid))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn create_venv_impl(app: AppHandle, workspace_root: String, version: String, wid: String) -> Result<CreateVenvResult, String> {
    let target = Path::new(&workspace_root).join(".venv");
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.arg("venv").arg(&target);
    // 重建语义：.venv 已存在时 uv venv 默认报错「A virtual environment already exists … Use --clear
    // to replace it」，导致态B 重建必然失败（exit 2）。重建本就要清空现有环境（态B danger 确认已
    // 明示「将清空 N 个已装包」），故恒带 --clear（删除目标已存在内容后重建，含非 venv 目录）。
    // 注：不加 --force——uv venv 无此参数（会报 unexpected argument '--force'），--clear 已足够。
    cmd.arg("--clear");
    if !version.trim().is_empty() {
        cmd.arg("--python").arg(version.trim());
    }
    cmd.current_dir(&workspace_root);
    // 流式输出（pip-stdout/pip-stderr）+ 联网超时：--python 指定未安装版本时 uv 会联网下载
    // CPython，下载进度经流式实时可见（问题1），且不再被 120s 超时杀死（问题2 / L-2）。
    // output 字段留空——内容已流式推送，前端不再二次 append。
    let code = run_uv_streaming(&app, &mut cmd, UV_NETWORK_TIMEOUT, &wid, "venv")?;
    if code != 0 {
        // 错误文案不含「详见输出面板」——本 Err 会被前端 appendOutputLine 写进输出面板，
        // 含指引会变成「输出面板里说详见输出面板」的自我指涉；uv 的逐行详情已由流式推送在上方。
        return Err(format!("uv venv 异常退出（exit {code}）"));
    }
    let python = venv_python_at(&target).unwrap_or_default();
    Ok(CreateVenvResult { output: String::new(), python })
}

/// 获取当前解释器：
/// - 配置里**存在** interpreter 键 → 尊重用户显式选择（string=指定解释器；null=显式 uv run，不自动检测）；
/// - **无**该键（从未设置）→ .venv 自动检测兜底。
/// 区分二者是关键：否则用户选「（默认）uv run」后，.venv 自动检测会把选择覆盖回去（选等于没选）。
#[tauri::command]
pub fn get_interpreter(workspace_root: String) -> Result<Option<String>, String> {
    match load_config(&workspace_root).get("interpreter") {
        Some(v) => Ok(v.as_str().map(String::from)), // 显式设置过：null → None（uv run）
        None => Ok(venv_python(&workspace_root)),     // 从未设置：自动检测 .venv
    }
}

/// 设置/清除工作区解释器（path 为 None 或空清除）
#[tauri::command]
pub fn set_interpreter(workspace_root: String, path: Option<String>) -> Result<(), String> {
    let cleaned = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    write_config(&workspace_root, cleaned.as_deref())
}

/// 解释器路径 → 版本号进程内缓存（tech-debt #11）：状态栏刷新 / 开工作区 / 换解释器都会读到版本，
/// 避免每次 `refreshInterpreterStatus` 都 spawn 一次 `<path> --version`。键为完整路径，换解释器自然失效。
static VERSION_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 查询指定解释器版本号（`<path> --version`），供状态栏“解释器来源 + 版本”展示（P1 建议 2）。
/// 失败（路径无效/超时）返回空串，前端降级为仅显示来源，不阻断运行。
#[tauri::command]
pub async fn interpreter_version(path: String) -> Result<String, String> {
    // 命中缓存直接返回；miss 才 spawn 子进程，空串不缓存（查询失败下次仍重试）
    if let Some(v) = VERSION_CACHE
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&path)
        .cloned()
    {
        return Ok(v);
    }
    let p = path.clone();
    let version = tauri::async_runtime::spawn_blocking(move || version_of(&p))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?;
    if !version.is_empty() {
        VERSION_CACHE
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(path, version.clone());
    }
    Ok(version)
}

/// 工作区根是否已有 pyproject.toml（驱动环境面板“建议生成 pyproject.toml”横幅，P2 建议 5）。
/// 纯文件判断、无子进程，复用 pip_install 的同一口径。
#[tauri::command]
pub fn has_pyproject(workspace_root: String) -> bool {
    Path::new(&workspace_root).join("pyproject.toml").is_file()
}

/// 在既有工作区根幂等生成最小 pyproject.toml（方案 B，纯文件写入，不依赖 uv 子进程）。
/// 已存在时不覆盖，直接返回说明；解决“裸目录 uv run 语义不明”（§5 建议 5、§9 幂等要求）。
#[tauri::command]
pub async fn init_pyproject(workspace_root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || init_pyproject_impl(workspace_root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

pub(crate) fn init_pyproject_impl(workspace_root: String) -> Result<String, String> {
    let root = Path::new(&workspace_root);
    // 幂等：已存在则不再触发任何生成动作，避免覆盖用户文件（§5 建议 5）
    if root.join("pyproject.toml").is_file() {
        return Ok("pyproject.toml 已存在，未作改动".to_string());
    }
    if !root.is_dir() {
        return Err(format!("工作区不存在：{workspace_root}"));
    }
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "app".to_string());
    // 存量裸目录：把工作区「当前解释器」交给 uv --python，让 requires-python 贴合真实环境；
    // 未选解释器时交由 uv 自行决定（None），回退模板统一用 >=3.12。
    let python_arg = get_interpreter(workspace_root.clone()).ok().flatten();
    let (_used_uv, note) = crate::fs_cmds::ensure_pyproject(root, &name, python_arg, ">=3.12", &[]);
    Ok(note)
}

// ---------- 运行前依赖预检 ----------
//
// 用「当前解释器」执行内联脚本：ast 收集文件顶层 import → importlib.util.find_spec
// 逐个探测是否可解析（标准库 / 本地模块 / 已装第三方都能正确命中，只有真缺失才返回）。
// 相比解析 LSP 诊断消息，find_spec 跑在真实解释器里，能正确处理 PIL→Pillow 这类映射。

const MISSING_IMPORT_SCRIPT: &str = r#"import ast, importlib.util, sys, os, json

def main(path):
    d = os.path.dirname(os.path.abspath(path))
    sys.path.insert(0, d)
    root = os.environ.get("OPENCHARM_WORKSPACE_ROOT")
    if root:
        sys.path.insert(0, root)
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    seen = {}
    stdlib = sys.stdlib_module_names
    stack = [tree]
    while stack:
        n = stack.pop()
        if isinstance(n, ast.Import):
            for a in n.names:
                top = a.name.split(".")[0]
                seen.setdefault(top, (n.lineno, "import " + a.name))
            continue
        if isinstance(n, ast.ImportFrom):
            if n.level == 0 and n.module:
                top = n.module.split(".")[0]
                seen.setdefault(top, (n.lineno, "from " + n.module + " import ..."))
            continue
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        stack.extend(ast.iter_child_nodes(n))
    missing = []
    for name, (lineno, stmt) in seen.items():
        if name in stdlib:
            continue
        if importlib.util.find_spec(name) is not None:
            continue
        missing.append({"name": name, "line": lineno, "stmt": stmt})
    missing.sort(key=lambda m: m["line"])
    print(json.dumps(missing, ensure_ascii=False))

main(sys.argv[1])
"#;

#[derive(Serialize, Deserialize)]
pub struct MissingImport {
    pub name: String,
    pub line: u32,
    pub stmt: String,
}

/// 运行前依赖预检：解析文件顶层 import 的第三方模块，用当前解释器探测是否可解析。
/// 无解释器（uv run 兜底）时返回空列表——跳过预检，保持现状行为。
#[tauri::command]
pub async fn check_missing_imports(
    path: String,
    workspace_root: Option<String>,
) -> Result<Vec<MissingImport>, String> {
    tauri::async_runtime::spawn_blocking(move || check_missing_imports_impl(path, workspace_root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn check_missing_imports_impl(
    path: String,
    workspace_root: Option<String>,
) -> Result<Vec<MissingImport>, String> {
    let Some(interpreter) = workspace_root
        .as_deref()
        .and_then(|r| get_interpreter(r.to_string()).ok().flatten())
    else {
        return Ok(Vec::new());
    };

    let file = Path::new(&path);
    let dir = file.parent().unwrap_or(Path::new(".")).to_path_buf();

    let mut cmd = Command::new(&interpreter);
    cmd.arg("-c")
        .arg(MISSING_IMPORT_SCRIPT)
        .arg(&path)
        .current_dir(&dir);
    if let Some(root) = &workspace_root {
        cmd.env("OPENCHARM_WORKSPACE_ROOT", root);
    }

    let (out, err, code) = run_with_timeout(&mut cmd, Duration::from_secs(10))?;
    if code != Some(0) {
        let msg = format!("{out}{err}");
        let msg = msg.trim();
        return Err(if msg.is_empty() { format!("依赖检测失败（exit {code:?}）") } else { msg.to_string() });
    }
    serde_json::from_str::<Vec<MissingImport>>(out.trim())
        .map_err(|e| format!("解析依赖检测结果失败：{e}"))
}

/// 列出已装包：uv pip list --python <解释器> --format=freeze
#[tauri::command]
pub async fn list_packages(interpreter: String) -> Result<Vec<PackageInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_packages_impl(interpreter))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn list_packages_impl(interpreter: String) -> Result<Vec<PackageInfo>, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["pip", "list", "--python", &interpreter, "--format=freeze"]);
    let (out, err, code) = run_with_timeout(&mut cmd, UV_LOCAL_TIMEOUT)?; // L-2：本地操作走本地超时
    if code != Some(0) {
        let raw = if out.is_empty() { err } else { out };
        return Err(if raw.trim().is_empty() { format!("uv pip list 失败（exit {code:?}）") } else { raw.trim().to_string() });
    }
    // 成功只解析 stdout：--format=freeze 的包列表恒在 stdout；stderr 是 uv 的「Using Python …
    // environment at: …」提示——空环境（virtualenv 建的 .venv 无包）时 stdout 为空，回退用 stderr
    // 会把该提示误解析成一个「包」（wangzi 实测：误报「1 个包已安装但未声明」）。
    Ok(parse_pip_list(&out))
}

/// 安装包：
/// - 工作区根目录存在 pyproject.toml 时用 `uv add`（写入项目依赖并更新 uv.lock，项目用 uv 管理）
///   —— 此分支不需要解释器（interpreter 可为 None，F9 新建 FastAPI 项目安装依赖即如此）；
/// - 否则回退 `uv pip install --python <解释器>`（仅装环境、不记录依赖）——此分支需要解释器，
///   None 时返回可读错误（而非拼出空 --python 参数）。
/// 输出经 pip-stdout / pip-stderr 事件流式推送前端；返回 exit code（0 成功）。
#[tauri::command]
pub async fn pip_install(app: AppHandle, window: tauri::WebviewWindow, workspace_root: String, interpreter: Option<String>, spec: String) -> Result<i32, String> {
    let wid = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || pip_install_impl(app, workspace_root, interpreter, spec, wid))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn pip_install_impl(app: AppHandle, workspace_root: String, interpreter: Option<String>, spec: String, wid: String) -> Result<i32, String> {
    let has_pyproject = Path::new(&workspace_root).join("pyproject.toml").is_file();
    let mut cmd = tool_command("uv", ENV_UV);
    if has_pyproject {
        cmd.arg("add");
        cmd.current_dir(&workspace_root);
        let _ = app.emit_to(&wid, "pip-stdout", json!({ "data": "检测到 pyproject.toml，使用 uv add 写入项目依赖并更新 uv.lock\n" }));
    } else {
        // uv pip install 分支必须有解释器：None 时给可读错误（调用方应已保证，防御分支）
        let Some(interpreter) = interpreter.as_deref() else {
            return Err("未选择解释器，无法安装（无 pyproject.toml 时走 uv pip install 需要解释器；可先生成 pyproject.toml 改走 uv add）".to_string());
        };
        cmd.args(["pip", "install", "--python", interpreter]);
        // §6.2 uv 建议的持续存在感（M3 文案升级）：明示「不写声明属正常现象 + 收敛建议」，
        // 防用户误判编辑器有 bug（R10：pip/裸装不写声明是 E3 的正常输入）
        let _ = app.emit_to(&wid, "pip-stdout", json!({ "data": "未检测到 pyproject.toml，仅安装到解释器环境（不记录依赖）——建议改用 uv add，或在终端使用 uv pip install，保持声明同步\n" }));
    }
    for part in spec.split_whitespace() {
        cmd.arg(part);
    }
    // L-2：安装会联网（解析 + 下载），走联网超时——原 120s 在国内网络下常把「慢」变成「失败」
    run_uv_streaming(&app, &mut cmd, UV_NETWORK_TIMEOUT, &wid, "install")
}

/// 卸载包：uv pip uninstall --python <解释器> <name…>
#[tauri::command]
pub async fn pip_uninstall(interpreter: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || pip_uninstall_impl(interpreter, name))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn pip_uninstall_impl(interpreter: String, name: String) -> Result<String, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["pip", "uninstall", "--python", &interpreter]);
    for part in name.split_whitespace() {
        cmd.arg(part);
    }
    run_uv_output(&mut cmd)
}

/// 列出过时包：uv pip list --outdated --format=json --python <解释器>。
/// 解析失败（如 uv 版本不支持、查询网络异常）时降级为空列表，不阻断前端渲染。
#[tauri::command]
pub async fn list_outdated(interpreter: String) -> Result<Vec<OutdatedInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_outdated_impl(interpreter))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn list_outdated_impl(interpreter: String) -> Result<Vec<OutdatedInfo>, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["pip", "list", "--outdated", "--format=json", "--python", &interpreter]);
    let (out, err, code) = run_with_timeout(&mut cmd, UV_OUTDATED_TIMEOUT)?;
    if code != Some(0) {
        return Ok(Vec::new());
    }
    let raw = if out.trim().is_empty() { err } else { out };
    Ok(serde_json::from_str::<Vec<OutdatedInfo>>(raw.trim()).unwrap_or_default())
}

/// 升级包：uv pip install --python <解释器> --upgrade <names…>（流式输出，返回 exit code）
#[tauri::command]
pub async fn pip_upgrade(app: AppHandle, window: tauri::WebviewWindow, interpreter: String, names: Vec<String>) -> Result<i32, String> {
    let wid = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || pip_upgrade_impl(app, interpreter, names, wid))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn pip_upgrade_impl(app: AppHandle, interpreter: String, names: Vec<String>, wid: String) -> Result<i32, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["pip", "install", "--python", &interpreter, "--upgrade"]);
    for n in &names {
        cmd.arg(n);
    }
    // L-2：升级会联网（解析 + 下载），走联网超时
    run_uv_streaming(&app, &mut cmd, UV_NETWORK_TIMEOUT, &wid, "upgrade")
}

// ---------- 解析 ----------

/// freeze 格式：name==version（每行）
pub(crate) fn parse_pip_list(s: &str) -> Vec<PackageInfo> {
    s.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() {
                return None;
            }
            match l.split_once("==") {
                Some((n, v)) => Some(PackageInfo { name: n.trim().to_string(), version: v.trim().to_string() }),
                // 无 == 的裸名行：仅当像包名（无空格、不以 - 开头、不含 ://）才保留；否则跳过——
                // 纵深防御：uv 诊断行（如「Using Python … at: …」）或 editable 行（-e …）不得被误当包
                None => {
                    if l.contains(' ') || l.starts_with('-') || l.contains("://") {
                        None
                    } else {
                        Some(PackageInfo { name: l.to_string(), version: String::new() })
                    }
                }
            }
        })
        .collect()
}

// ---------- 框架探针表（P1：Django / Flask / FastAPI 三规则） ----------
//
// 来源：`docs/pycharm_framework_support_report.md` §8.2 P1——把原 P0-E 的 FastAPI 单点探测
// 泛化为「框架 → 运行配置预设」的规则表。设计纪律：
// - **纯文件读取、零子进程**（一次调用 < 数十 ms），命中与否只决定前端是否出「一键生成配置」
//   提示，**绝不静默改配置 / 装包**（沿用 P0-E 的「提示 + 用户点击」形态）；
// - 规则只认**稳定的公开约定**（根目录 manage.py / `X = FastAPI(` / `X = Flask(`），不解析框架
//   源码结构——避免「跟随框架版本演进」的长期维护成本（报告 §8.3）；
// - 优先级 = 强约定优先：django（manage.py）→ fastapi → flask；
// - 每个框架可在**工作区级**关闭提示（config 的 `framework_hints`），对齐 PyCharm
//   `Languages & Frameworks | Flask` 的抑制开关（报告 §8.2 P1-②）。

/// 框架预设探测结果（三框架共用；file 为相对工作区根、正斜杠）
#[derive(Serialize, Clone)]
pub struct FrameworkPreset {
    /// "django" | "flask" | "fastapi"
    pub framework: String,
    /// 展示名："Django" | "Flask" | "FastAPI"
    pub label: String,
    /// 命中的声明文件（如 "manage.py" / "app/main.py"）
    pub file: String,
    /// 生成的运行入口（script = manage.py；module = uvicorn / flask）
    pub entry: RunEntry,
    /// 入口参数（如 "runserver" / "main:app --reload"）
    pub args: String,
    /// 工作目录（统一 ${workspaceRoot}：模块导入以工作区根为基准）
    pub cwd: String,
    /// 回显摘要（如 "-m uvicorn main:app --reload"）
    pub summary: String,
    /// 依赖声明中未见的服务依赖（如 uvicorn / django）：仅提示缺失，不代装
    pub missing: Vec<String>,
}

/// 规则表顺序 = 命中优先级（强约定优先）
const FRAMEWORK_ORDER: [&str; 3] = ["django", "fastapi", "flask"];

/// 工作区级「不再提示」开关的存储键（workspace config：`framework_hints`）
const FRAMEWORK_HINTS_KEY: &str = "framework_hints";

const FRAMEWORK_SCAN_SKIP_DIRS: &[&str] = &[
    "venv", "__pycache__", "node_modules", "dist", "build", ".ruff_cache", ".pytest_cache", ".mypy_cache",
];
const FRAMEWORK_SCAN_MAX_DEPTH: usize = 4;
const FRAMEWORK_SCAN_MAX_FILES: usize = 500;
const FRAMEWORK_SCAN_MAX_BYTES: u64 = 512 * 1024;

/// 收集依赖声明文本（pyproject.toml + 根目录 requirements*.txt）；两者皆无 → None（跳过探测）
fn collect_dep_text(root: &Path) -> Option<String> {
    let mut buf = String::new();
    let mut any = false;
    if let Ok(s) = fs::read_to_string(root.join("pyproject.toml")) {
        buf.push_str(&s);
        buf.push('\n');
        any = true;
    }
    if let Ok(rd) = fs::read_dir(root) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("requirements") && name.ends_with(".txt") {
                if let Ok(s) = fs::read_to_string(e.path()) {
                    buf.push_str(&s);
                    buf.push('\n');
                    any = true;
                }
            }
        }
    }
    if any { Some(buf) } else { None }
}

/// 依赖文本是否逐行提及某包名（忽略 # 注释行；子串匹配——fastapi-utils 命中 fastapi 属可接受过报）
pub(crate) fn deps_mention(text: &str, pkg: &str) -> bool {
    text.lines().any(|l| {
        let l = l.trim();
        !l.starts_with('#') && l.to_ascii_lowercase().contains(pkg)
    })
}

/// 深度/数量受限的工作区 .py 扫描，找首个 `<var> = <ctor>(` 声明 → (相对路径, 变量名)
/// （FastAPI：`app = FastAPI(`；Flask：`app = Flask(`）
pub(crate) fn scan_app_decl(root: &Path, ctor: &str) -> Option<(String, String)> {
    fn walk(dir: &Path, depth: usize, files: &mut Vec<PathBuf>) {
        if depth > FRAMEWORK_SCAN_MAX_DEPTH || files.len() >= FRAMEWORK_SCAN_MAX_FILES {
            return;
        }
        let mut entries: Vec<_> = match fs::read_dir(dir) {
            Ok(rd) => rd.flatten().collect(),
            Err(_) => return,
        };
        entries.sort_by_key(|e| e.path()); // 排序保证确定性（main.py 先于其他同名候选）
        for e in entries {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if !name.starts_with('.') && !FRAMEWORK_SCAN_SKIP_DIRS.contains(&name.as_str()) {
                    walk(&p, depth + 1, files);
                }
            } else if name.ends_with(".py") && files.len() < FRAMEWORK_SCAN_MAX_FILES {
                files.push(p);
            }
        }
    }
    let mut files: Vec<PathBuf> = Vec::new();
    walk(root, 0, &mut files);
    for f in &files {
        let Ok(meta) = f.metadata() else { continue };
        if meta.len() > FRAMEWORK_SCAN_MAX_BYTES {
            continue;
        }
        let Ok(text) = fs::read_to_string(f) else { continue };
        for line in text.lines() {
            let t = line.trim_start();
            if t.starts_with('#') {
                continue;
            }
            let Some(eq) = t.find('=') else { continue };
            let lhs = t[..eq].trim();
            let rhs = t[eq + 1..].trim_start();
            let Some(rest) = rhs.strip_prefix(ctor) else { continue };
            if !rest.trim_start().starts_with('(') {
                continue;
            }
            // lhs 须是合法 Python 标识符（排除 `x.attr = FastAPI(` / `d["app"] = ...` 等左值）
            let valid = !lhs.is_empty()
                && lhs.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                && lhs.chars().next().is_some_and(|c| !c.is_ascii_digit());
            if valid {
                let rel = f.strip_prefix(root).unwrap_or(f).to_string_lossy().replace('\\', "/");
                return Some((rel, lhs.to_string()));
            }
        }
    }
    None
}

/// 相对脚本路径 → uvicorn 模块目标："app/main.py" → "app.main"
pub(crate) fn py_module_target(rel_file: &str) -> String {
    rel_file.strip_suffix(".py").unwrap_or(rel_file).replace('/', ".")
}

/// 依赖声明中未见的服务依赖（deps 缺失 = 无声明文件 → 视为未知，**不报缺失**：
/// 没有声明文件不该凭空刷「尚未安装」提示）
fn missing_server_deps(deps: Option<&str>, pkgs: &[&str]) -> Vec<String> {
    let Some(text) = deps else { return Vec::new() };
    pkgs.iter()
        .filter(|p| !deps_mention(text, p))
        .map(|p| p.to_string())
        .collect()
}

/// Django 规则：根目录 `manage.py`（项目根唯一强约定）→ `python manage.py runserver`
fn detect_django_preset(root: &Path, deps: Option<&str>) -> Option<FrameworkPreset> {
    if !root.join("manage.py").is_file() {
        return None;
    }
    Some(FrameworkPreset {
        framework: "django".into(),
        label: "Django".into(),
        file: "manage.py".into(),
        entry: RunEntry { kind: "script".into(), target: "manage.py".into() },
        args: "runserver".into(),
        cwd: "${workspaceRoot}".into(),
        summary: "manage.py runserver".into(),
        missing: missing_server_deps(deps, &["django"]),
    })
}

/// FastAPI 规则：依赖声明含 fastapi + 源码 `X = FastAPI(` → `-m <server> <module>:<var> --reload`。
/// 服务器选择（F3，对标 PyCharm `Run using`）：依赖含 uvicorn → uvicorn；仅 hypercorn → hypercorn
/// （`--reload` 两者均支持）；皆无 → uvicorn 缺省 + 提示缺失（不代装）。
fn detect_fastapi_preset(root: &Path, deps: Option<&str>) -> Option<FrameworkPreset> {
    let deps = deps?;
    if !deps_mention(deps, "fastapi") {
        return None;
    }
    let (file, app_var) = scan_app_decl(root, "FastAPI")?;
    let module = py_module_target(&file);
    let server = if deps_mention(deps, "uvicorn") {
        "uvicorn"
    } else if deps_mention(deps, "hypercorn") {
        "hypercorn"
    } else {
        "uvicorn"
    };
    let missing = if deps_mention(deps, "uvicorn") || deps_mention(deps, "hypercorn") {
        Vec::new()
    } else {
        vec!["uvicorn".to_string()]
    };
    Some(FrameworkPreset {
        framework: "fastapi".into(),
        label: "FastAPI".into(),
        file,
        entry: RunEntry { kind: "module".into(), target: server.into() },
        args: format!("{module}:{app_var} --reload"),
        cwd: "${workspaceRoot}".into(),
        summary: format!("-m {server} {module}:{app_var} --reload"),
        missing,
    })
}

/// Flask 规则：依赖声明含 flask + 源码 `X = Flask(` → `-m flask --app <module>:<var> run --debug`。
/// `--debug`（F3，对标 PyCharm「支持内置 Flask debugger」）= Werkzeug 交互式调试器 + reloader。
fn detect_flask_preset(root: &Path, deps: Option<&str>) -> Option<FrameworkPreset> {
    let deps = deps?;
    if !deps_mention(deps, "flask") {
        return None;
    }
    let (file, app_var) = scan_app_decl(root, "Flask")?;
    let module = py_module_target(&file);
    Some(FrameworkPreset {
        framework: "flask".into(),
        label: "Flask".into(),
        file,
        entry: RunEntry { kind: "module".into(), target: "flask".into() },
        args: format!("--app {module}:{app_var} run --debug"),
        cwd: "${workspaceRoot}".into(),
        summary: format!("-m flask --app {module}:{app_var} run --debug"),
        // flask 本身是规则命中前提（deps_mention），不会再缺失；无其他服务依赖
        missing: vec![],
    })
}

/// 读取工作区级「不再提示」集合（config 的 `framework_hints`：{ "<framework>": true }）。
/// 非对象 / 非布尔值一律忽略（配置损坏不得影响探测）。
fn framework_hints_disabled(cfg: &Value) -> HashSet<String> {
    cfg.get(FRAMEWORK_HINTS_KEY)
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .filter(|(_, v)| v.as_bool() == Some(true))
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// 探针表主体（纯函数化：目录 + 配置传入，便于单测直接锁定优先级与开关语义）
fn detect_framework_impl(workspace_root: &str, cfg: &Value) -> Result<Option<FrameworkPreset>, String> {
    let root = Path::new(workspace_root);
    if !root.is_dir() {
        return Err(format!("工作区不存在：{workspace_root}"));
    }
    let deps = collect_dep_text(root);
    let disabled = framework_hints_disabled(cfg);
    for kind in FRAMEWORK_ORDER {
        if disabled.contains(kind) {
            continue;
        }
        let hit = match kind {
            "django" => detect_django_preset(root, deps.as_deref()),
            "fastapi" => detect_fastapi_preset(root, deps.as_deref()),
            "flask" => detect_flask_preset(root, deps.as_deref()),
            _ => None,
        };
        if hit.is_some() {
            return Ok(hit);
        }
    }
    Ok(None)
}

/// 框架预设探测（P1 探针表）：返回首个**未被本工作区关闭**的命中；无命中 / 全部关闭 → null。
/// 前端据此给「一键生成运行配置」提示（绝不静默改配置/装包）。
#[tauri::command]
pub async fn detect_framework(workspace_root: String) -> Result<Option<FrameworkPreset>, String> {
    let cfg = load_config(&workspace_root);
    tauri::async_runtime::spawn_blocking(move || detect_framework_impl(&workspace_root, &cfg))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

/// 工作区级开关：某框架的「生成运行配置」提示不再出现（写 workspace config 的
/// `framework_hints`；disabled=false 即恢复提示，空map 直接移除键保持文件精简）。
#[tauri::command]
pub fn set_framework_hint_disabled(
    workspace_root: String,
    framework: String,
    disabled: bool,
) -> Result<(), String> {
    let mut v = load_config(&workspace_root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    let mut drop_key = false;
    {
        let hints = obj.entry(FRAMEWORK_HINTS_KEY).or_insert_with(|| json!({}));
        let map = hints.as_object_mut().ok_or("工作区配置 framework_hints 格式非法")?;
        if disabled {
            map.insert(framework, json!(true));
        } else {
            map.remove(&framework);
            drop_key = map.is_empty();
        }
    }
    if drop_key {
        obj.remove(FRAMEWORK_HINTS_KEY);
    }
    save_config(&workspace_root, &v)
}

/// 读取工作区级提示开关（research §11.1-5 首次命中引导的「只提示一次」标志读取侧；
/// 与 set_framework_hint_disabled 同一存储：config 的 `framework_hints`）。
#[tauri::command]
pub fn is_framework_hint_disabled(workspace_root: String, framework: String) -> Result<bool, String> {
    Ok(framework_hints_disabled(&load_config(&workspace_root)).contains(&framework))
}

// ---------- Pydantic 栈检测（F0 裁决 B：推荐切换静态引擎） ----------
//
// 来源：`bench/reports/pydantic-engine-probe.md`——pyrefly 对 Pydantic/dataclass 缺
// 「构造参数校验 + 字段改名传播」（对照组 dataclass 同样缺失，根因是 __init__ 校验整块缺席），
// basedpyright 覆盖 4/6。依赖声明含 pydantic / fastapi 的工作区由前端**提示推荐**切换
// （提示 + 用户点击，绝不静默改设置）；`framework_hints["pydantic_engine"]` = true 表示
// 本工作区已选择不再提示（与框架探针表共用同一存储与语义：框架相关提示的工作区级开关）。

/// 依赖声明是否命中 Pydantic 栈（pydantic / fastapi 任一）且未被本工作区关闭提示
pub fn detect_pydantic_stack_impl(workspace_root: &str, cfg: &Value) -> bool {
    if framework_hints_disabled(cfg).contains("pydantic_engine") {
        return false;
    }
    let Some(deps) = collect_dep_text(Path::new(workspace_root)) else { return false };
    deps_mention(&deps, "pydantic") || deps_mention(&deps, "fastapi")
}

/// Pydantic 栈检测（F0 裁决 B）：命中且未关闭 → true，前端据此给「推荐切换引擎」提示。
#[tauri::command]
pub async fn detect_pydantic_stack(workspace_root: String) -> Result<bool, String> {
    let cfg = load_config(&workspace_root);
    Ok(
        tauri::async_runtime::spawn_blocking(move || detect_pydantic_stack_impl(&workspace_root, &cfg))
            .await
            .map_err(|e| format!("任务执行异常：{e}"))?,
    )
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pip_list() {
        let s = "requests==2.31.0\nidna==3.7\nsome-local-pkg==1.0\n\nfoo==1.2\n";
        let pkgs = parse_pip_list(s);
        assert_eq!(pkgs.len(), 4);
        assert_eq!(pkgs[0].name, "requests");
        assert_eq!(pkgs[0].version, "2.31.0");
        assert_eq!(pkgs[3].name, "foo");
        assert_eq!(pkgs[3].version, "1.2");
    }

    /// L-9：`stream_lines` 的载荷标记口径——普通行原样、`\r` 重写帧以 `\r` 包裹。
    /// 直接测 emit 前的转换逻辑（与 stream_lines 内同款，无 AppHandle 依赖）。
    fn frame_payload(raw: &str) -> String {
        let normalized = raw.replace("\r\n", "\n");
        if normalized.contains('\r') {
            format!("\r{}\r", normalized.replace('\r', "\n"))
        } else {
            normalized
        }
    }

    #[test]
    fn test_stream_lines_frame_marking() {
        // 普通行：原样下发（前端按 appendOutputLine 处理）
        assert_eq!(frame_payload("Resolved 10 packages\n"), "Resolved 10 packages\n");
        // CRLF 行尾：先归一为 LF，且**不**被误判为重写帧
        assert_eq!(frame_payload("ok\r\n"), "ok\n");
        // 进度重写帧：`\r` 包裹，内部 \r 转 \n（前端据此末行原地更新）
        assert_eq!(frame_payload("Downloading 50%\r"), "\rDownloading 50%\n\r");
        // 同帧多段重写（进度条 + 包名交替）同样只算一帧
        assert_eq!(frame_payload("a\rb\r"), "\ra\nb\n\r");
    }

    #[test]
    fn test_venv_python_missing() {
        // 不存在的 root 无 .venv → None
        assert_eq!(venv_python("Z:\\__no_such_dir__"), None);
    }

    #[test]
    fn test_display_version() {
        assert_eq!(display_version("cpython-3.13.7-windows-x86_64-none"), "3.13.7");
        assert_eq!(display_version("pypy-3.11.13-windows-x86_64-none"), "3.11.13");
        assert_eq!(display_version("graalpy-3.12.0-windows-x86_64-none"), "3.12.0");
        assert_eq!(display_version("weird-spec"), "weird-spec");
    }

    #[test]
    fn test_version_triple() {
        assert_eq!(version_triple("3.13.7"), (3, 13, 7));
        assert_eq!(version_triple("3.9"), (3, 9, 0));
        assert_eq!(version_triple("3.10.20"), (3, 10, 20));
        assert!(version_triple("3.13.7") > version_triple("3.10.20"));
        assert!(version_triple("3.9.25") > version_triple("3.9.0"));
    }

    #[test]
    fn test_is_freethreaded() {
        assert!(is_freethreaded("cpython-3.15.0a7+freethreaded-windows-x86_64-none"));
        assert!(!is_freethreaded("cpython-3.13.7-windows-x86_64-none"));
    }

    #[test]
    fn test_module_target_helpers() {
        assert_eq!(py_module_target("app/main.py"), "app.main");
        assert_eq!(py_module_target("main.py"), "main");
        assert!(deps_mention("fastapi==0.1\n", "fastapi"));
        assert!(!deps_mention("# fastapi\n", "fastapi"));
        assert!(!deps_mention("requests\n", "fastapi"));
    }

    #[test]
    fn test_outdated_json_parse() {
        let s = r#"[{"name":"pip","version":"26.0.1","latest_version":"26.2.1","latest_filetype":"wheel"}]"#;
        let v: Vec<OutdatedInfo> = serde_json::from_str(s).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "pip");
        assert_eq!(v[0].version, "26.0.1");
        assert_eq!(v[0].latest, "26.2.1");
        assert_eq!(v[0].filetype, "wheel");
    }

    /// 测试临时目录 helper（framework / pydantic 探测测试用）
    fn detect_tmpdir(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-detect-{tag}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn framework_django_preset_reports_missing_dep() {
        let d = detect_tmpdir("fw-django-missing");
        fs::write(d.join("manage.py"), "#!/usr/bin/env python\n").unwrap();
        fs::write(d.join("pyproject.toml"), "[project]\nname = \"x\"\n").unwrap();
        let hit = detect_framework_impl(&d.to_string_lossy(), &json!({}))
            .unwrap()
            .expect("manage.py 应命中 Django");
        assert_eq!(hit.framework, "django");
        assert_eq!(hit.label, "Django");
        assert_eq!(hit.entry.kind, "script");
        assert_eq!(hit.entry.target, "manage.py");
        assert_eq!(hit.args, "runserver");
        assert_eq!(hit.cwd, "${workspaceRoot}");
        assert_eq!(hit.missing, vec!["django".to_string()]);
    }

    /// Django 规则：声明已含 django → 不报缺失
    #[test]
    fn framework_django_preset_with_dep() {
        let d = detect_tmpdir("fw-django");
        fs::write(d.join("manage.py"), "#!/usr/bin/env python\n").unwrap();
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"django>=5\"]\n").unwrap();
        let hit = detect_framework_impl(&d.to_string_lossy(), &json!({})).unwrap().unwrap();
        assert_eq!(hit.framework, "django");
        assert!(hit.missing.is_empty());
    }

    /// FastAPI 规则（沿用 P0-E 口径）：依赖含 fastapi + 源码 `app = FastAPI(` → uvicorn 预设
    #[test]
    fn framework_fastapi_preset() {
        let d = detect_tmpdir("fw-fastapi");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"fastapi\"]\n").unwrap();
        fs::write(d.join("main.py"), "from fastapi import FastAPI\napp = FastAPI()\n").unwrap();
        let hit = detect_framework_impl(&d.to_string_lossy(), &json!({})).unwrap().unwrap();
        assert_eq!(hit.framework, "fastapi");
        assert_eq!(hit.entry.kind, "module");
        assert_eq!(hit.entry.target, "uvicorn");
        assert_eq!(hit.args, "main:app --reload");
        assert_eq!(hit.missing, vec!["uvicorn".to_string()]); // 声明无 uvicorn → 提示
    }

    /// F3 服务器选择：依赖仅含 hypercorn → entry 切到 hypercorn（--reload 两者均支持）
    #[test]
    fn framework_fastapi_preset_hypercorn() {
        let d = detect_tmpdir("fw-hypercorn");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"fastapi\", \"hypercorn\"]\n").unwrap();
        fs::write(d.join("main.py"), "from fastapi import FastAPI\napp = FastAPI()\n").unwrap();
        let hit = detect_framework_impl(&d.to_string_lossy(), &json!({})).unwrap().unwrap();
        assert_eq!(hit.entry.target, "hypercorn");
        assert_eq!(hit.summary, "-m hypercorn main:app --reload");
        assert!(hit.missing.is_empty()); // hypercorn 也在服务依赖白名单
    }

    /// Flask 规则：依赖含 flask + 源码 `app = Flask(` → `-m flask --app main:app run --debug`（F3）
    #[test]
    fn framework_flask_preset() {
        let d = detect_tmpdir("fw-flask");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"flask>=3\"]\n").unwrap();
        fs::write(d.join("app.py"), "from flask import Flask\napp = Flask(__name__)\n").unwrap();
        let hit = detect_framework_impl(&d.to_string_lossy(), &json!({})).unwrap().unwrap();
        assert_eq!(hit.framework, "flask");
        assert_eq!(hit.label, "Flask");
        assert_eq!(hit.entry.kind, "module");
        assert_eq!(hit.entry.target, "flask");
        assert_eq!(hit.args, "--app app:app run --debug");
        assert_eq!(hit.summary, "-m flask --app app:app run --debug");
    }

    /// 优先级：django（manage.py 强约定）先于 fastapi
    #[test]
    fn framework_priority_django_before_fastapi() {
        let d = detect_tmpdir("fw-priority");
        fs::write(d.join("manage.py"), "#!/usr/bin/env python\n").unwrap();
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"django\", \"fastapi\", \"uvicorn\"]\n").unwrap();
        fs::write(d.join("main.py"), "from fastapi import FastAPI\napp = FastAPI()\n").unwrap();
        let hit = detect_framework_impl(&d.to_string_lossy(), &json!({})).unwrap().unwrap();
        assert_eq!(hit.framework, "django");
    }

    /// 无命中：普通脚本项目（无 manage.py / 无 FastAPI( / 无 Flask(）→ null
    #[test]
    fn framework_misses_on_plain_project() {
        let d = detect_tmpdir("fw-plain");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"requests\"]\n").unwrap();
        fs::write(d.join("main.py"), "print(1)\n").unwrap();
        assert!(detect_framework_impl(&d.to_string_lossy(), &json!({})).unwrap().is_none());
    }

    /// 工作区级开关：`framework_hints` 中 true 的框架被跳过（跳过 django → 落到 fastapi）
    #[test]
    fn framework_skips_disabled_framework() {
        let d = detect_tmpdir("fw-disabled");
        fs::write(d.join("manage.py"), "#!/usr/bin/env python\n").unwrap();
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"django\", \"fastapi\", \"uvicorn\"]\n").unwrap();
        fs::write(d.join("main.py"), "from fastapi import FastAPI\napp = FastAPI()\n").unwrap();
        let key = d.to_string_lossy().to_string();
        // 关掉 django → 落到 fastapi
        let hit = detect_framework_impl(&key, &json!({ "framework_hints": { "django": true } }))
            .unwrap()
            .unwrap();
        assert_eq!(hit.framework, "fastapi");
        // 两个都关掉 → 全部跳过，返回 null
        let none = detect_framework_impl(
            &key,
            &json!({ "framework_hints": { "django": true, "fastapi": true, "flask": true } }),
        )
        .unwrap();
        assert!(none.is_none());
    }

    /// 开关解析容错：非对象 / 非布尔值 / false 一律不当作关闭
    #[test]
    fn framework_hints_parse_rules() {
        assert!(framework_hints_disabled(&json!({})).is_empty());
        assert!(framework_hints_disabled(&json!({ "framework_hints": "x" })).is_empty());
        let cfg = json!({ "framework_hints": { "flask": true, "django": false, "fastapi": "yes" } });
        let off = framework_hints_disabled(&cfg);
        assert_eq!(off.len(), 1);
        assert!(off.contains("flask"));
    }

    // ---------- Pydantic 栈检测（F0 裁决 B）单测 ----------

    /// 依赖含 fastapi / pydantic 任一 → 命中
    #[test]
    fn pydantic_stack_hit_on_either_dep() {
        let d = detect_tmpdir("pyd-stack");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"fastapi\", \"uvicorn\"]\n").unwrap();
        assert!(detect_pydantic_stack_impl(&d.to_string_lossy(), &json!({})));
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"pydantic>=2\"]\n").unwrap();
        assert!(detect_pydantic_stack_impl(&d.to_string_lossy(), &json!({})));
    }

    /// 无声明文件 / 无关依赖 → 不命中
    #[test]
    fn pydantic_stack_miss_on_unrelated() {
        let d = detect_tmpdir("pyd-miss");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"requests\"]\n").unwrap();
        assert!(!detect_pydantic_stack_impl(&d.to_string_lossy(), &json!({})));
        let d2 = detect_tmpdir("pyd-nodeps");
        fs::write(d2.join("main.py"), "print(1)\n").unwrap();
        assert!(!detect_pydantic_stack_impl(&d2.to_string_lossy(), &json!({})));
    }

    /// 工作区级关闭（framework_hints["pydantic_engine"]）→ 恒不命中
    #[test]
    fn pydantic_stack_respects_hint_switch() {
        let d = detect_tmpdir("pyd-off");
        fs::write(d.join("pyproject.toml"), "[project]\ndependencies = [\"pydantic\"]\n").unwrap();
        let cfg = json!({ "framework_hints": { "pydantic_engine": true } });
        assert!(!detect_pydantic_stack_impl(&d.to_string_lossy(), &cfg));
    }

    // ---------- 依赖健康（dep health M1）单测 ----------

    // ---------- 长耗时超时分级 / 兜底命令（体验审查 L-2 / L-7） ----------

    /// L-2：联网动作必须比本地动作宽松——否则国内网络下「慢」会被判成「失败」
    #[test]
    fn network_timeout_is_wider_than_local() {
        assert!(UV_NETWORK_TIMEOUT > UV_LOCAL_TIMEOUT);
        assert_eq!(UV_NETWORK_TIMEOUT.as_secs(), 600);
        assert_eq!(UV_LOCAL_TIMEOUT.as_secs(), 120);
    }

    /// L-7：超时兜底引导里的命令文本可复制（program + args 原样拼接，含带空格的参数）
    #[test]
    fn cmd_display_renders_program_and_args() {
        let mut c = Command::new("uv");
        c.args(["venv", ".venv", "--python", "3.12"]);
        assert_eq!(cmd_display(&c), "uv venv .venv --python 3.12");
        let bare = Command::new("uv");
        assert_eq!(cmd_display(&bare), "uv");
    }
}