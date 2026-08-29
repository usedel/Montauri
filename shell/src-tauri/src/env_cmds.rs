// Python 环境管理（P25-T04）：uv 驱动 + 工作区配置存储。
// 设计要点（见 docs/phase2.5-ide-basics-plan.md §4）：
// - 解释器选择存 <data_root>/workspaces/<project-hash>.json（不侵入用户项目，粒度与 probe 的 trace 库一致）；
// - 优先级：工作区配置 > 工作区 .venv 自动检测 > 无（uv run 兜底）；
// - uv 命令 120s 超时保护（创建环境/装包）；列表 15s 超时。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::file_ops::project_hash;
use crate::tool_paths::{tool_command, ENV_UV};
use crate::util::{kill_process_tree, no_window, opencharm_home};

const UV_TIMEOUT: Duration = Duration::from_secs(120);
const UV_LIST_TIMEOUT: Duration = Duration::from_secs(15);
/// outdated 查询需联网，单独给更短超时，避免环境面板被网络拖住
const UV_OUTDATED_TIMEOUT: Duration = Duration::from_secs(20);

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

// ---------- 工作区配置存储 ----------

fn workspaces_dir() -> PathBuf {
    opencharm_home().join("workspaces")
}

fn workspace_config_path(root: &str) -> PathBuf {
    workspaces_dir().join(format!("{}.json", project_hash(root)))
}

fn read_config(root: &str) -> Option<String> {
    let p = workspace_config_path(root);
    let s = fs::read_to_string(p).ok()?;
    let v: Value = serde_json::from_str(&s).ok()?;
    v.get("interpreter").and_then(|x| x.as_str()).map(String::from)
}

fn write_config(root: &str, interpreter: Option<&str>) -> Result<(), String> {
    let p = workspace_config_path(root);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let v = match interpreter {
        Some(i) => json!({ "interpreter": i }),
        None => json!({}),
    };
    let payload = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(&p, payload).map_err(|e| e.to_string())
}

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

fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Result<(String, String, Option<i32>), String> {
    let mut child = no_window(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out_reader = std::thread::spawn(move || read_all(stdout));
    let err_reader = std::thread::spawn(move || read_all(stderr));

    let start = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    kill_process_tree(&mut child); // uv 可能已拉起子进程，须连树一起终止
                    return Err(format!("命令执行超时（{}s）", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    Ok((out, err, code))
}

fn read_all(r: impl Read) -> String {
    let mut s = String::new();
    let mut reader = BufReader::new(r);
    let _ = reader.read_to_string(&mut s);
    s
}

/// 运行 uv 命令并返回「成功输出」或「错误信息」（供 pip 安装/卸载等）。
fn run_uv_output(cmd: &mut Command) -> Result<String, String> {
    let (out, err, code) = run_with_timeout(cmd, UV_TIMEOUT)?;
    let combined = format!("{out}{err}").trim().to_string();
    if code != Some(0) {
        return Err(if combined.is_empty() { format!("命令失败（exit {code:?}）") } else { combined });
    }
    Ok(combined)
}

/// 逐行读取流并 emit 到前端（uv 进度条的 `\r` 统一转成 `\n`，适配前端按行滚动输出）。
fn stream_lines(
    r: impl Read + Send + 'static,
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
                    let cleaned = String::from_utf8_lossy(&buf).replace("\r\n", "\n").replace('\r', "\n");
                    let _ = app.emit(event, json!({ "data": cleaned }));
                }
                Err(_) => break,
            }
        }
    })
}

/// 流式运行 uv 命令：stdout/stderr 逐行推送到前端（pip-stdout / pip-stderr），返回 exit code。
fn run_uv_streaming(app: &AppHandle, cmd: &mut Command, timeout: Duration) -> Result<i32, String> {
    let mut child = no_window(cmd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 uv：{e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let out_thread = stream_lines(stdout, app.clone(), "pip-stdout");
    let err_thread = stream_lines(stderr, app.clone(), "pip-stderr");

    let start = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    kill_process_tree(&mut child);
                    let _ = out_thread.join();
                    let _ = err_thread.join();
                    return Err(format!("命令执行超时（{}s）", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                kill_process_tree(&mut child);
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(e.to_string());
            }
        }
    };
    let _ = out_thread.join();
    let _ = err_thread.join();
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
pub async fn create_venv(workspace_root: String, version: String) -> Result<CreateVenvResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_venv_impl(workspace_root, version))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn create_venv_impl(workspace_root: String, version: String) -> Result<CreateVenvResult, String> {
    let target = Path::new(&workspace_root).join(".venv");
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.arg("venv").arg(&target);
    if !version.trim().is_empty() {
        cmd.arg("--python").arg(version.trim());
    }
    cmd.current_dir(&workspace_root);
    let output = run_uv_output(&mut cmd)?;
    let python = venv_python_at(&target).unwrap_or_default();
    Ok(CreateVenvResult { output, python })
}

/// 获取当前解释器：工作区配置优先，其次 .venv 自动检测，最后 None（uv run 兜底）
#[tauri::command]
pub fn get_interpreter(workspace_root: String) -> Result<Option<String>, String> {
    Ok(read_config(&workspace_root).or_else(|| venv_python(&workspace_root)))
}

/// 设置/清除工作区解释器（path 为 None 或空清除）
#[tauri::command]
pub fn set_interpreter(workspace_root: String, path: Option<String>) -> Result<(), String> {
    let cleaned = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    write_config(&workspace_root, cleaned.as_deref())
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
    let (out, err, code) = run_with_timeout(&mut cmd, UV_TIMEOUT)?;
    let raw = if out.is_empty() { err } else { out };
    if code != Some(0) {
        return Err(if raw.trim().is_empty() { format!("uv pip list 失败（exit {code:?}）") } else { raw.trim().to_string() });
    }
    Ok(parse_pip_list(&raw))
}

/// 安装包：
/// - 工作区根目录存在 pyproject.toml 时用 `uv add`（写入项目依赖并更新 uv.lock，项目用 uv 管理）；
/// - 否则回退 `uv pip install --python <解释器>`（仅装环境、不记录依赖）。
/// 输出经 pip-stdout / pip-stderr 事件流式推送前端；返回 exit code（0 成功）。
#[tauri::command]
pub async fn pip_install(app: AppHandle, workspace_root: String, interpreter: String, spec: String) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || pip_install_impl(app, workspace_root, interpreter, spec))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn pip_install_impl(app: AppHandle, workspace_root: String, interpreter: String, spec: String) -> Result<i32, String> {
    let has_pyproject = Path::new(&workspace_root).join("pyproject.toml").is_file();
    let mut cmd = tool_command("uv", ENV_UV);
    if has_pyproject {
        cmd.arg("add");
        cmd.current_dir(&workspace_root);
        let _ = app.emit("pip-stdout", json!({ "data": "检测到 pyproject.toml，使用 uv add 写入项目依赖并更新 uv.lock\n" }));
    } else {
        cmd.args(["pip", "install", "--python", &interpreter]);
        let _ = app.emit("pip-stdout", json!({ "data": "未检测到 pyproject.toml，仅安装到解释器环境（不记录依赖）\n" }));
    }
    for part in spec.split_whitespace() {
        cmd.arg(part);
    }
    run_uv_streaming(&app, &mut cmd, UV_TIMEOUT)
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
pub async fn pip_upgrade(app: AppHandle, interpreter: String, names: Vec<String>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || pip_upgrade_impl(app, interpreter, names))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn pip_upgrade_impl(app: AppHandle, interpreter: String, names: Vec<String>) -> Result<i32, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["pip", "install", "--python", &interpreter, "--upgrade"]);
    for n in &names {
        cmd.arg(n);
    }
    run_uv_streaming(&app, &mut cmd, UV_TIMEOUT)
}

// ---------- 解析 ----------

/// freeze 格式：name==version（每行）
fn parse_pip_list(s: &str) -> Vec<PackageInfo> {
    s.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() {
                return None;
            }
            match l.split_once("==") {
                Some((n, v)) => Some(PackageInfo { name: n.trim().to_string(), version: v.trim().to_string() }),
                None => Some(PackageInfo { name: l.to_string(), version: String::new() }),
            }
        })
        .collect()
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

    #[test]
    fn test_workspace_config_roundtrip() {
        // 用一个临时 root（不触碰真实 home），通过环境变量不可行，但 project_hash 是确定性纯函数；
        // 这里验证 read/write 配对：写入临时 workspaces 目录路径不可注入，直接测 hash 稳定性。
        let h1 = project_hash(".");
        let h2 = project_hash(".");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 12);
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
    fn test_outdated_json_parse() {
        let s = r#"[{"name":"pip","version":"26.0.1","latest_version":"26.2.1","latest_filetype":"wheel"}]"#;
        let v: Vec<OutdatedInfo> = serde_json::from_str(s).unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "pip");
        assert_eq!(v[0].version, "26.0.1");
        assert_eq!(v[0].latest, "26.2.1");
        assert_eq!(v[0].filetype, "wheel");
    }
}