// LSP 桥 Rust 侧（ADR-0003）：spawn 引擎进程（stdio）+ Content-Length 帧解析 + 事件转发。
// 引擎无关：pyrefly / basedpyright / opencharm-intel 只是前端传入的命令不同。
//
// P3-T06'：多引擎支持——`engine` 键区分实例（"static" / "intel"），事件 payload 带 engine
// 供前端按引擎分发；intel 缺席不拖垮静态引擎（两实例独立 stdio/线程）。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

use crate::file_ops::project_hash;
use crate::tool_paths::resolve_lsp_command;
use crate::logging::{log_line, Level};
use crate::util::{kill_process_tree, kill_process_tree_async, no_window, opencharm_home, unpoison, IncrementalUtf8Decoder};

use std::sync::atomic::{AtomicU64, Ordering};

struct LspInstance {
    child: Option<Child>,
    /// CR-03：stdin 独立加锁持有——send_message 取 Arc 克隆后**释放全局锁再写**。
    /// 持全局锁做阻塞写（大文件 didOpen >64KB 管道满 / 引擎假死）时，
    /// lsp_stop 与退出监视线程均拿不到锁 → 无法 kill，子系统死锁。
    stdin: Option<Arc<Mutex<std::process::ChildStdin>>>,
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
        let inst = unpoison(LSP.lock()).remove(&engine);
        if let Some(mut inst) = inst {
            if let Some(child) = inst.child.take() {
                // CR-10：异步终止——同步 taskkill 对庞杂进程树可耗时数秒，会卡住启动调用方（UI）
                kill_process_tree_async(child); // 连同可能的子进程一并终止
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
        map.insert(engine.clone(), LspInstance { child: Some(child), stdin: Some(Arc::new(Mutex::new(stdin))), seq });
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

/// 单帧 payload 上限（CR-09）：正常 LSP 消息（补全/诊断/hover）远小于此；
/// `Content-Length` 完全来自对端，异常/被攻陷引擎发超大值会触发巨额分配，超限即断开。
const MAX_FRAME_LEN: usize = 64 * 1024 * 1024;

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
    if len > MAX_FRAME_LEN {
        return Err(format!("Content-Length 超上限（{len} > {MAX_FRAME_LEN}）"));
    }
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
    // CR-03：全局锁只保护 map 增删查——取出 Arc 克隆后立即释放再写。
    // 写阻塞不再持全局锁，lsp_stop / 退出监视线程始终可以拿到 map 完成清理。
    let stdin = {
        let map = unpoison(LSP.lock());
        map.get(engine)
            .and_then(|i| i.stdin.clone())
            .ok_or("LSP 未启动")?
    };
    let payload = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    let mut stdin = unpoison(stdin.lock());
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
    for dir in crate::util::resource_candidates(app) {
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
//
// S3/S4 公共基建：运行命令解析与环境装配统一走 `run_env`（偿还 tech-debt 第 8 条）。
// `run_script`（本文件，输出面板路径）与 `terminal::run_in_terminal`（PTY 路径）共用同一份装配，
// 两条路径的 sys.path / 编码 / probe 注入不再有第二套实现（handoff §4.2 坑 6）。

static RUN_CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// S4：交互式运行（`stdin.mode == "interactive"`）的子进程 stdin 槽位。
/// 退出监视线程与 `stop_script` **两处都要清空**，否则残留句柄会让下次运行拿不到槽位。
static RUN_STDIN: Mutex<Option<std::process::ChildStdin>> = Mutex::new(None);

/// 运行槽位是否被占用（供 `terminal::run_in_terminal` 做单实例守卫，§4.7 结论 3）
pub(crate) fn run_slot_busy() -> bool {
    unpoison(RUN_CHILD.lock()).is_some()
}

/// 运行脚本：立即返回，输出经 run-stdout / run-stderr / run-exit 事件流式转发。
/// P25-T06：选中解释器 → 直接 <解释器> <file>；未选中 → uv run 兜底（解析见 `run_env::resolve_run_command`）。
/// P25-T09：probe 开关——false 时不注入运行时探针（probe 注入对两种运行方式同样生效，仅在 probe=true 时）。
/// S4：`stdin.mode == "interactive"` 时子进程 stdin 走 piped 并登记 `RUN_STDIN`，
/// 前端输出面板的输入行经 [`run_stdin`] 逐行喂入（默认仍是 null，见坑 2：piped 无人写入会永久阻塞）。
#[tauri::command]
pub fn run_script(app: AppHandle, path: String, workspace_root: Option<String>, probe: bool) -> Result<(), String> {
    {
        let rc = unpoison(RUN_CHILD.lock());
        if rc.is_some() {
            return Err("已有脚本在运行".into());
        }
        // 单实例统一模型（§4.7 结论 3）：PTY 运行占用时同样拒绝——两条路径共用同一个「运行中」状态，
        // 并发会让输出面板与运行终端争抢 traceback 落点，且用户无从判断该按哪个停止。
        if crate::terminal::run_terminal_busy() {
            return Err("已有脚本在终端中运行".into());
        }
        // 三态互斥（debug dev plan §3.2）：调试占用时拒绝普通运行
        if crate::dap::debug_busy() {
            return Err("已有调试会话在运行".into());
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

    // P3（建议 2）：读取该脚本的轻量运行配置（Parameters / 环境变量 / stdin），存于工作区配置而非用户项目。
    let run_config = workspace_root
        .as_deref()
        .map(|r| crate::env_cmds::read_run_config(r, &path))
        .unwrap_or_default();

    // 阶段 0 公共基建：运行命令与环境装配统一走 run_env（与 PTY 路径共用，杜绝 §4.2 坑 6 的漂移）
    let run_cmd = crate::run_env::resolve_run_command(&script_abs, &fname, interpreter.as_deref());
    let run_env =
        crate::run_env::build_run_env(&app, &script_abs, workspace_root.as_deref(), &run_config, probe);

    // S1/S4：标准输入来源。file 模式在 spawn **之前**打开文件——失败即 fail fast 并回传明确原因，
    // 不留“已进入运行态却读不到输入”的僵尸运行（对齐 §4.4 的“用户无从感知原因”）。
    let stdin_mode = run_config.stdin.effective_mode();
    let interactive = stdin_mode == "interactive";
    let stdin_stdio = if stdin_mode == "file" {
        let fp = run_config.stdin.path.trim();
        let f = std::fs::File::open(fp).map_err(|e| format!("标准输入文件无法打开：{fp}（{e}）"))?;
        Stdio::from(f)
    } else if interactive {
        Stdio::piped()
    } else {
        Stdio::null()
    };

    let mut cmd = Command::new(&run_cmd.program);
    cmd.args(&run_cmd.args);
    // P3：脚本参数（shell-words 拆分，支持引号/转义），追加在脚本名之后（两分支通用）
    cmd.args(&run_env.args);
    for (k, v) in &run_cmd.env {
        cmd.env(k, v);
    }
    // P0（建议 3）默认注入（PYTHONUNBUFFERED/PYTHONIOENCODING/PYTHONUTF8）+ PYTHONPATH 四段合并
    // + 用户 env（用户值优先）+ probe 三件套，全部来自 run_env（§2.1 固化的顺序即优先级）
    for (k, v) in &run_env.env {
        cmd.env(k, v);
    }
    cmd
        .current_dir(&dir)
        .stdin(stdin_stdio)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // 非致命告警（如 Parameters 解析失败）：回显但不中断运行
    for w in &run_env.warnings {
        let _ = app.emit("run-stderr", json!({ "data": w }));
    }

    let mut child = no_window(&mut cmd)
        .spawn()
        .map_err(|e| format!("无法启动运行命令: {e}"))?;

    if probe && run_env.probe_src.is_none() {
        let _ = app.emit(
            "run-stderr",
            json!({ "data": "[opencharm-probe] 未找到 probe/src，本次运行不采集（可用环境变量 OPENCHARM_PROBE_SRC 指定）\n" }),
        );
    }

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;
    // S4：交互式运行登记 stdin 槽位；非交互时写入 None，顺带清掉上一次异常退出可能残留的句柄
    let child_stdin = if interactive { child.stdin.take() } else { None };
    {
        let mut slot = unpoison(RUN_STDIN.lock());
        *slot = child_stdin;
    }
    {
        let mut rc = unpoison(RUN_CHILD.lock());
        rc.replace(child);
    }

    // stdout 流式转发：非交互按行（历史行为原样保留，坑 1 的零回归解法）；交互按 chunk——
    // `input("姓名: ")` 的提示符没有换行，按行转发会让它一直卡在 reader 里，用户看不到提示 → 死锁。
    let app_out = app.clone();
    std::thread::spawn(move || {
        if interactive {
            forward_chunks(stdout, app_out, "run-stdout");
        } else {
            forward_lines(stdout, app_out, "run-stdout");
        }
    });

    // stderr 流式转发（两种模式都按行：traceback 每行自带换行，不存在提示符可见性问题）
    let app_err = app.clone();
    std::thread::spawn(move || forward_lines(stderr, app_err, "run-stderr"));

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
        // S4：子进程已退出 → 清空 stdin 槽位，否则残留句柄让下次运行拿不到槽位
        unpoison(RUN_STDIN.lock()).take();
        let _ = app.emit("run-exit", json!({ "code": code }));
        return;
    });

    Ok(())
}

/// 非交互路径的输出转发：按行（`read_until(b'\n')`）+ lossy 解码，历史行为一字未改。
fn forward_lines(stream: impl Read + Send + 'static, app: AppHandle, event: &'static str) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(_) => {
                let _ = app.emit(event, json!({ "data": String::from_utf8_lossy(&buf) }));
            }
            Err(_) => break,
        }
    }
}

/// 交互路径（S4）的输出转发：按 chunk + **增量 UTF-8 解码**（坑 5：中文跨 chunk 不得截断成乱码）。
/// `partial: true` 表示末段尚无换行（典型是 `input()` 的提示符），前端据此做「部分行累积」：
/// 先把提示符落到 DOM 让用户看见，等换行到达才把整行定型并匹配 traceback 链接（§4.7 结论 6）。
fn forward_chunks(stream: impl Read + Send + 'static, app: AppHandle, event: &'static str) {
    let mut reader = BufReader::new(stream);
    let mut buf = [0u8; 4096];
    let mut decoder = IncrementalUtf8Decoder::default();
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = decoder.push(&buf[..n]);
                if data.is_empty() {
                    continue; // 整块都是被截断的多字节尾巴，等下一块拼完整
                }
                let partial = !data.ends_with('\n');
                let _ = app.emit(event, json!({ "data": data, "partial": partial }));
            }
            Err(_) => break,
        }
    }
    // 流结束：冲刷残留字节（脚本以无换行半行收尾时不吞字），仍标 partial 交由前端定型
    let tail = decoder.finish();
    if !tail.is_empty() {
        let _ = app.emit(event, json!({ "data": tail, "partial": true }));
    }
}

/// S4：向交互式运行的子进程写入一行输入（前端输出面板输入行 Enter 触发）。
/// - 槽位为空（非交互运行 / 已结束）→ 返回可读错误而非 panic；
/// - BrokenPipe（脚本已退但监视线程尚未清槽）→ 优雅返回「运行已结束」。
#[tauri::command]
pub fn run_stdin(data: String) -> Result<(), String> {
    let mut slot = unpoison(RUN_STDIN.lock());
    // 写入放在独立作用域内：借用结束后才允许改槽位（清理已断管道的残留句柄）
    let res = {
        let Some(stdin) = slot.as_mut() else {
            return Err("当前运行不接受输入（标准输入需在运行配置中选「交互式」）".into());
        };
        stdin
            .write_all(data.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
    };
    match res {
        Ok(()) => Ok(()),
        Err(e) => {
            *slot = None;
            if e.kind() == std::io::ErrorKind::BrokenPipe {
                Err("运行已结束，输入未送达".into())
            } else {
                Err(format!("写入标准输入失败：{e}"))
            }
        }
    }
}

/// 停止运行中的脚本
#[tauri::command]
pub fn stop_script() -> Result<(), String> {
    // S4：先 drop stdin——关闭管道常能直接唤醒阻塞中的 input()（脚本收到 EOF 自行退出），
    // 再杀进程树兜底；顺序反了会让「正在等输入的脚本」白挨一次 taskkill /T /F。
    unpoison(RUN_STDIN.lock()).take();
    let child = unpoison(RUN_CHILD.lock()).take();
    if let Some(child) = child {
        // CR-10：异步终止——同步 taskkill 对庞杂进程树可耗时数秒，点「停止」会卡 UI 数秒
        kill_process_tree_async(child); // 杀 uv/解释器连带其 python 脚本子树
    }
    Ok(())
}

/// CR-14：应用退出（RunEvent::Exit）清理——同步终止全部 LSP 引擎进程树。
/// 退出路径不能用 `kill_process_tree_async`：后台线程会被进程退出截断，taskkill 半途而废、
/// 子进程照样成孤儿；退出时短暂同步阻塞可接受。
pub(crate) fn lsp_stop_all_for_exit() {
    let insts: Vec<LspInstance> = unpoison(LSP.lock()).drain().map(|(_, i)| i).collect();
    for mut inst in insts {
        if let Some(mut child) = inst.child.take() {
            kill_process_tree(&mut child);
        }
    }
}

/// CR-14：应用退出清理——同步终止运行中脚本（理由同上，不能被进程退出截断）。
pub(crate) fn stop_script_for_exit() {
    unpoison(RUN_STDIN.lock()).take();
    if let Some(mut child) = unpoison(RUN_CHILD.lock()).take() {
        kill_process_tree(&mut child);
    }
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

    #[test]
    fn rejects_oversized_content_length() {
        // CR-09：超大 Content-Length 帧必须被拒（防异常/被攻陷引擎触发巨额分配 OOM）
        let header = format!("Content-Length: {}\r\n\r\n", MAX_FRAME_LEN + 1);
        let mut cursor = Cursor::new(header.into_bytes());
        assert!(read_frame(&mut cursor).is_err());
    }
}