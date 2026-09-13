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

/// P1-H：多实例额外子进程（`allow_multiple` 配置在主槽被占时的后续实例）。
/// stdin 恒 null、不占用 RUN_STDIN；退出仅从表移除、**不发 run-exit**
/// （前端统一运行态仍以首个实例为准，报告 P2-M 每配置标签页落地后再做逐实例状态）。
static RUN_EXTRA: Mutex<Vec<Child>> = Mutex::new(Vec::new());

/// 运行槽位是否被占用（供 `terminal::run_in_terminal` 做单实例守卫，§4.7 结论 3）
pub(crate) fn run_slot_busy() -> bool {
    unpoison(RUN_CHILD.lock()).is_some()
}

/// 运行脚本：立即返回，输出经 run-stdout / run-stderr / run-exit 事件流式转发。
/// P25-T06：选中解释器 → 直接 <解释器> <file>；未选中 → uv run 兜底（解析见 `run_env::resolve_run_command`）。
/// P25-T09：probe 开关——false 时不注入运行时探针（probe 注入对两种运行方式同样生效，仅在 probe=true 时）。
/// S4：`stdin.mode == "interactive"` 时子进程 stdin 走 piped 并登记 `RUN_STDIN`，
/// 前端输出面板的输入行经 [`run_stdin`] 逐行喂入（P0-A：interactive 已是默认档，
/// 输入行 + 「等待输入…」状态 + stopRun 先 drop stdin 共同兜住「piped 无人写入」阻塞）。
/// `stdin_mode`：调用方显式覆盖（P0-A）——选区运行传 `Some("null")` 锁定「不接输入」，
/// 避免默认档改交互后，片段运行被 piped 且输入行不可见而静默挂起；不传则读运行配置。
#[tauri::command]
pub fn run_script(
    app: AppHandle,
    path: String,
    workspace_root: Option<String>,
    probe: bool,
    stdin_mode: Option<String>,
) -> Result<(), String> {
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

    // P0-C：读取该文件的运行配置（Parameters / 入口 / 工作目录 / 环境变量 / stdin），存于工作区配置而非用户项目。
    let mut run_config = workspace_root
        .as_deref()
        .map(|r| crate::env_cmds::read_run_config(r, &path))
        .unwrap_or_default();
    // P0-A：调用方显式覆盖 stdin 模式（选区运行锁定 null），优先级高于运行配置
    if let Some(m) = stdin_mode {
        run_config.stdin.mode = m;
    }
    // P0-C：module 入口必须有模块名（空模块名在 RunEntry::is_module 已归一化为脚本语义，这里显式报错）
    if run_config.entry.kind == "module" && !run_config.entry.is_module() {
        return Err("运行配置选择了模块入口，但模块名为空".into());
    }
    // P1-H：allow_multiple 时槽被占放行为额外实例
    let extra = check_run_slots(run_config.allow_multiple)?;

    // 解释器解析（P1-I）：配置级覆盖 > 工作区配置 > .venv 自动检测（见 env_cmds::get_interpreter）
    let profile_interpreter = run_config.interpreter.trim().to_string();
    let interpreter = if profile_interpreter.is_empty() {
        workspace_root
            .as_deref()
            .and_then(|r| crate::env_cmds::get_interpreter(r.to_string()).ok().flatten())
    } else {
        Some(profile_interpreter)
    };

    // P0-D：工作目录解析（空 = script→脚本目录 / module→工作区根；支持 ${workspaceRoot} 宏）
    let cwd = crate::run_env::resolve_run_cwd(
        &run_config.cwd,
        workspace_root.as_deref(),
        Some(&dir),
        run_config.entry.is_module(),
    );

    // 阶段 0 公共基建：运行命令与环境装配统一走 run_env（与 PTY 路径共用，杜绝 §4.2 坑 6 的漂移）
    let run_cmd = crate::run_env::resolve_run_command(
        &run_config.entry,
        &script_abs,
        &fname,
        interpreter.as_deref(),
        run_config.python_console,
    );
    let run_env =
        crate::run_env::build_run_env(&app, &script_abs, workspace_root.as_deref(), &run_config, probe);
    // P2-Q：交互控制台强制 stdin=piped（REPL 依赖输入行），优先于运行配置的 stdin 模式
    let (stdin_stdio, interactive) = if run_config.python_console {
        (Stdio::piped(), true)
    } else {
        build_stdin_stdio(&run_config.stdin)?
    };

    spawn_run_process(app, run_cmd, cwd, run_env, stdin_stdio, interactive, probe, extra)
}

/// 单实例槽位检查（run_script / run_profile 共用，§4.7 结论 3 + debug dev plan §3.2）。
/// P1-H：`allow_multiple` 为 true 时，运行槽被占不再硬报错，而是放行为「额外实例」
/// （返回 Ok(true)，stdin 恒 null、输出与首个实例共用输出面板）；三态互斥中的
/// 「调试占用」不可越。返回 Ok(false) = 常规主实例；Ok(true) = 额外实例。
fn check_run_slots(allow_multiple: bool) -> Result<bool, String> {
    // 三态互斥：调试占用时拒绝普通运行（不可被 allow_multiple 越过）
    if crate::dap::debug_busy() {
        return Err("已有调试会话在运行".into());
    }
    let primary_busy = unpoison(RUN_CHILD.lock()).is_some() || crate::terminal::run_terminal_busy();
    if !primary_busy {
        return Ok(false);
    }
    if allow_multiple {
        return Ok(true);
    }
    if unpoison(RUN_CHILD.lock()).is_some() {
        return Err("已有脚本在运行".into());
    }
    Err("已有脚本在终端中运行".into())
}

/// S1/S4：标准输入来源装配（run_script / run_profile 共用）。file 模式在 spawn **之前**打开文件
/// ——失败即 fail fast 并回传明确原因，不留“已进入运行态却读不到输入”的僵尸运行（§4.4）。
fn build_stdin_stdio(stdin: &crate::env_cmds::StdinConfig) -> Result<(Stdio, bool), String> {
    let mode = stdin.effective_mode();
    let interactive = mode == "interactive";
    let stdio = if mode == "file" {
        let fp = stdin.path.trim();
        let f = std::fs::File::open(fp).map_err(|e| format!("标准输入文件无法打开：{fp}（{e}）"))?;
        Stdio::from(f)
    } else if interactive {
        Stdio::piped()
    } else {
        Stdio::null()
    };
    Ok((stdio, interactive))
}

/// 进程装配体（run_script / run_profile 共用）：spawn + 槽位登记 + 流式转发 + 退出监视。
/// `app` 按值接收（退出监视线程要求 'static，内部按需 clone）。
fn spawn_run_process(
    app: AppHandle,
    run_cmd: crate::run_env::RunCommand,
    cwd: std::path::PathBuf,
    run_env: crate::run_env::RunEnv,
    stdin_stdio: Stdio,
    interactive: bool,
    probe: bool,
    extra: bool,
) -> Result<(), String> {
    // P1-H：额外实例不参与交互（stdin 恒 null），也不占用 RUN_STDIN / RUN_CHILD 主槽
    let interactive = interactive && !extra;
    let stdin_stdio = if extra { Stdio::null() } else { stdin_stdio };

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
        .current_dir(&cwd)
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

    // P1-H：额外实例 → RUN_EXTRA 表 + 独立退出监视（仅移除，不发 run-exit）
    if extra {
        let pid = child.id();
        unpoison(RUN_EXTRA.lock()).push(child);
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(200));
            let done = {
                let mut extras = unpoison(RUN_EXTRA.lock());
                let Some(pos) = extras.iter().position(|c| c.id() == pid) else { return };
                match extras[pos].try_wait() {
                    Ok(Some(_)) => {
                        extras.remove(pos);
                        true
                    }
                    Ok(None) => false,
                    Err(_) => {
                        extras.remove(pos);
                        true
                    }
                }
            };
            if done {
                return;
            }
        });
        return Ok(());
    }

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

/// P0-C：按命名运行配置运行（Run 部件 ▾ 菜单入口）。module 入口无需打开任何文件。
#[tauri::command]
pub fn run_profile(app: AppHandle, workspace_root: String, name: String, probe: bool, force_extra: Option<bool>) -> Result<(), String> {
    let profile = crate::env_cmds::load_profile_by_name(&workspace_root, &name)
        .ok_or_else(|| format!("找不到运行配置：{name}"))?;
    if profile.entry.kind == "module" && !profile.entry.is_module() {
        return Err(format!("运行配置「{name}」选择了模块入口，但模块名为空"));
    }
    // P1-H：allow_multiple 时槽被占放行为额外实例；P2 Compound：force_extra 显式要求并行实例
    let extra = check_run_slots(profile.allow_multiple || force_extra.unwrap_or(false))?;

    // entry 解析：script → 工作区根/target（绝对路径原样）；module → 工作区根占位
    // （build_run_env 仅用 script_abs 拼 probe 元信息与 PYTHONPATH，module 场景传根即可）
    let root = std::path::PathBuf::from(&workspace_root);
    let (script_abs, script_dir, fname) = if profile.entry.is_module() {
        (root.clone(), Some(root.clone()), String::new())
    } else {
        let t = std::path::Path::new(profile.entry.target_trimmed());
        let abs = if t.is_absolute() { t.to_path_buf() } else { root.join(t) };
        let dir = abs.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
        let fname = abs.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        (abs, Some(dir), fname)
    };

    // 解释器解析（P1-I）：配置级覆盖 > 工作区配置 > .venv 自动检测
    let profile_interpreter = profile.interpreter.trim().to_string();
    let interpreter = if profile_interpreter.is_empty() {
        crate::env_cmds::get_interpreter(workspace_root.clone()).ok().flatten()
    } else {
        Some(profile_interpreter)
    };
    let cwd = crate::run_env::resolve_run_cwd(
        &profile.cwd,
        Some(&workspace_root),
        script_dir.as_deref(),
        profile.entry.is_module(),
    );
    let run_cmd = crate::run_env::resolve_run_command(
        &profile.entry,
        &script_abs,
        &fname,
        interpreter.as_deref(),
        profile.python_console,
    );
    let run_env = crate::run_env::build_run_env(&app, &script_abs, Some(&workspace_root), &profile, probe);
    // P2-Q：交互控制台强制 stdin=piped（REPL 依赖输入行），优先于运行配置的 stdin 模式
    let (stdin_stdio, interactive) = if profile.python_console {
        (Stdio::piped(), true)
    } else {
        build_stdin_stdio(&profile.stdin)?
    };

    spawn_run_process(app, run_cmd, cwd, run_env, stdin_stdio, interactive, probe, extra)
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
    // 再进入软杀/强杀序列；顺序反了会让「正在等输入的脚本」白挨一次 taskkill /T /F。
    unpoison(RUN_STDIN.lock()).take();
    // P1-H：多实例额外子进程一并终止（直接强杀：它们不持有交互态，无优雅退出预期）
    let extras: Vec<Child> = unpoison(RUN_EXTRA.lock()).drain(..).collect();
    for c in extras {
        kill_process_tree_async(c);
    }
    let child = unpoison(RUN_CHILD.lock()).take();
    if let Some(child) = child {
        // P1-J：软杀优先 + 宽限窗口 + 强杀兜底（长驻服务可优雅退出）
        kill_with_grace(child);
    }
    Ok(())
}

/// P1-J：软杀优先序列：温和终止信号（Unix SIGINT；Windows 为 no-op，见 `util::soft_kill_pid` 注释）
/// → 宽限窗口 3s（长驻服务优雅退出：关连接池 / 落日志）→ 超时强杀整棵进程树。
/// 与历史行为兼容：child 立即离开 RUN_CHILD 槽（宽限期内允许发起新运行）；
/// 停止路径的运行态由前端复位（不 emit run-exit，与旧 taskkill 即杀路径一致）。
fn kill_with_grace(mut child: Child) {
    std::thread::spawn(move || {
        let pid = child.id();
        crate::util::soft_kill_pid(pid);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::time::Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return, // 已优雅退出
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
                Err(_) => return,
            }
        }
        kill_process_tree(&mut child);
    });
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
    // P1-H：多实例额外子进程一并同步终止
    let extras: Vec<Child> = unpoison(RUN_EXTRA.lock()).drain(..).collect();
    for mut c in extras {
        kill_process_tree(&mut c);
    }
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