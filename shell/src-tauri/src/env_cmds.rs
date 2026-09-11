// Python 环境管理（P25-T04）：uv 驱动 + 工作区配置存储。
// 设计要点：
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

/// 读取整份工作区配置（缺失/损坏时返回空对象，绝不 panic）
fn load_config(root: &str) -> Value {
    let p = workspace_config_path(root);
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

/// 写回整份工作区配置（保留未涉及字段，如 interpreter 与 run_configs 互不覆盖）
fn save_config(root: &str, v: &Value) -> Result<(), String> {
    let p = workspace_config_path(root);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let payload = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(&p, payload).map_err(|e| e.to_string())
}

fn read_config(root: &str) -> Option<String> {
    load_config(root)
        .get("interpreter")
        .and_then(|x| x.as_str())
        .map(String::from)
}

fn write_config(root: &str, interpreter: Option<&str>) -> Result<(), String> {
    let mut v = load_config(root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    match interpreter {
        Some(i) => {
            obj.insert("interpreter".into(), json!(i));
        }
        None => {
            obj.remove("interpreter");
        }
    }
    save_config(root, &v)
}

// ---------- 轻量运行配置（P3 建议 2）----------
//
// 每个脚本可持久化 Parameters / 环境变量，存 <data_root>/workspaces/<hash>.json 的
// run_configs 字段（键为相对工作区根、正斜杠规范化的脚本路径），不写入用户项目（架构铁律）。

/// 单个环境变量键值对
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

/// stdin 缺省模式：不接输入（等价于引入该字段前的 `.stdin(Stdio::null())` 行为）
fn default_stdin_mode() -> String {
    "null".to_string()
}

/// 标准输入配置（stdin 重定向 S1 + 输出面板交互 S4）。
/// 用扁平 struct 而非 tagged enum：前端镜像成本最低，且 `#[serde(default)]` 保证
/// 存量 run_configs（无 stdin 字段）无需迁移即反序列化为 null = 历史行为。
#[derive(Serialize, Deserialize, Clone)]
pub struct StdinConfig {
    /// "null"（不接输入，input() 立即 EOF）
    /// | "file"（重定向自文件，可复现）
    /// | "interactive"（S4：管道交互，用户在输出面板逐行应答）
    #[serde(default = "default_stdin_mode")]
    pub mode: String,
    /// mode == "file" 时的输入文件路径
    #[serde(default)]
    pub path: String,
}

impl Default for StdinConfig {
    fn default() -> Self {
        Self { mode: default_stdin_mode(), path: String::new() }
    }
}

impl StdinConfig {
    /// 归一化后的有效模式：
    /// - 选了 `file` 但路径为空 → 视作 `null`（避免拿空路径去 open）；
    /// - 未知/拼错的模式一律退回 `null`——绝不能让一个错字把运行变成
    ///   「piped 且无人写入」的永久阻塞（handoff §4.2 坑 2：默认值铁律）。
    pub fn effective_mode(&self) -> &str {
        match self.mode.as_str() {
            "file" if self.path.trim().is_empty() => "null",
            "file" | "interactive" => self.mode.as_str(),
            _ => "null",
        }
    }
}

/// 一个脚本的运行配置（临时配置自动生成、可持久化补充）
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RunConfig {
    /// 脚本参数（原始字符串，运行时用 shell-words 拆分）
    #[serde(default)]
    pub args: String,
    /// 自定义环境变量（用户值优先，见调研报告 §9 合并约定）
    #[serde(default)]
    pub env: Vec<EnvVar>,
    /// 标准输入来源（S1 文件重定向；缺省 null 与历史行为一致）
    #[serde(default)]
    pub stdin: StdinConfig,
}

impl RunConfig {
    /// 是否为「等于没配置」：args / env / stdin 全为缺省时，`set_run_config` 会移除该键保持文件精简。
    /// 注意 stdin 判定用 `effective_mode()`——`file`（有路径）与 `interactive`（S4）都算**有配置**，
    /// 不能被当空配置删掉；而 `file` 无路径会归一化成 `null`，仍视为空。
    fn is_empty(&self) -> bool {
        self.args.trim().is_empty() && self.env.is_empty() && self.stdin.effective_mode() == "null"
    }
}

/// 运行配置存储键：相对工作区根、统一正斜杠（跨平台稳定，避免绝对路径漂移）
fn run_config_key(workspace_root: &str, script_path: &str) -> String {
    let norm_root = workspace_root.replace('\\', "/");
    let norm_script = script_path.replace('\\', "/");
    let r = norm_root.trim_end_matches('/');
    if !r.is_empty() && norm_script.starts_with(r) {
        let mut rel = norm_script[r.len()..].to_string();
        if rel.starts_with('/') {
            rel.remove(0);
        }
        if !rel.is_empty() {
            return rel;
        }
    }
    // 不在工作区根下：退化为文件名，保证仍有一个稳定键
    norm_script
        .rsplit('/')
        .next()
        .unwrap_or(&norm_script)
        .to_string()
}

/// 读取某脚本的运行配置（供命令与 run_script 共用；无配置返回默认空值）
pub fn read_run_config(workspace_root: &str, script_path: &str) -> RunConfig {
    let key = run_config_key(workspace_root, script_path);
    load_config(workspace_root)
        .get("run_configs")
        .and_then(|rc| rc.get(&key))
        .and_then(|v| serde_json::from_value::<RunConfig>(v.clone()).ok())
        .unwrap_or_default()
}

/// 获取运行配置（前端编辑面板加载用）
#[tauri::command]
pub fn get_run_config(workspace_root: String, script_path: String) -> RunConfig {
    read_run_config(&workspace_root, &script_path)
}

/// 保存运行配置（空配置则移除该键，保持文件精简）
#[tauri::command]
pub fn set_run_config(workspace_root: String, script_path: String, config: RunConfig) -> Result<(), String> {
    let key = run_config_key(&workspace_root, &script_path);
    let mut v = load_config(&workspace_root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    if config.is_empty() {
        if let Some(rc) = obj.get_mut("run_configs").and_then(Value::as_object_mut) {
            rc.remove(&key);
            if rc.is_empty() {
                obj.remove("run_configs");
            }
        }
    } else {
        let rc = obj
            .entry("run_configs")
            .or_insert_with(|| json!({}));
        let rc_obj = rc.as_object_mut().ok_or("run_configs 字段格式非法")?;
        rc_obj.insert(key, serde_json::to_value(&config).map_err(|e| e.to_string())?);
    }
    save_config(&workspace_root, &v)
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

/// 查询指定解释器版本号（`<path> --version`），供状态栏“解释器来源 + 版本”展示（P1 建议 2）。
/// 失败（路径无效/超时）返回空串，前端降级为仅显示来源，不阻断运行。
#[tauri::command]
pub async fn interpreter_version(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(version_of(&path)))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
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

fn init_pyproject_impl(workspace_root: String) -> Result<String, String> {
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
    let (_used_uv, note) = crate::fs_cmds::ensure_pyproject(root, &name, python_arg, ">=3.12");
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
    fn test_run_config_key() {
        // 相对工作区根、正斜杠规范化
        assert_eq!(run_config_key("F:/proj", "F:/proj/main.py"), "main.py");
        assert_eq!(run_config_key("F:\\proj", "F:\\proj\\sub\\a.py"), "sub/a.py");
        assert_eq!(run_config_key("F:/proj/", "F:/proj/main.py"), "main.py");
        // 不在根下 → 退化为文件名（仍有稳定键）
        assert_eq!(run_config_key("F:/proj", "E:/other/b.py"), "b.py");
    }

    #[test]
    fn test_run_config_is_empty() {
        assert!(RunConfig::default().is_empty());
        assert!(rc("  ", vec![], "null", "").is_empty());
        assert!(!rc("--flag", vec![], "null", "").is_empty());
        assert!(!rc("", vec![EnvVar { key: "K".into(), value: "V".into() }], "null", "").is_empty());
        // stdin 重定向也算“有配置”，不能被当空配置删掉
        assert!(!rc("", vec![], "file", "F:/data/in.txt").is_empty());
        // 选了 file 但没给路径 → 归一化成 null，仍视为空
        assert!(rc("", vec![], "file", "  ").is_empty());
        // S4：interactive 无需路径，同样算“有配置”（否则保存后立刻被当空配置删掉）
        assert!(!rc("", vec![], "interactive", "").is_empty());
    }

    /// 构造 RunConfig 的小工具（避免每处都写全字段）
    fn rc(args: &str, env: Vec<EnvVar>, mode: &str, path: &str) -> RunConfig {
        RunConfig { args: args.into(), env, stdin: StdinConfig { mode: mode.into(), path: path.into() } }
    }

    #[test]
    fn test_stdin_effective_mode() {
        assert_eq!(StdinConfig::default().effective_mode(), "null");
        assert_eq!(StdinConfig { mode: "file".into(), path: "a.txt".into() }.effective_mode(), "file");
        // 空路径不能拿去 open，归一化为 null
        assert_eq!(StdinConfig { mode: "file".into(), path: "".into() }.effective_mode(), "null");
        assert_eq!(StdinConfig { mode: "file".into(), path: "   ".into() }.effective_mode(), "null");
        // S4：交互式无需路径
        assert_eq!(StdinConfig { mode: "interactive".into(), path: "".into() }.effective_mode(), "interactive");
        // 未知/拼错的模式必须退回 null（坑 2：绝不能意外落到 piped 永久阻塞）
        assert_eq!(StdinConfig { mode: "pipe".into(), path: "".into() }.effective_mode(), "null");
        assert_eq!(StdinConfig { mode: "".into(), path: "".into() }.effective_mode(), "null");
    }

    #[test]
    fn test_run_config_backward_compat_without_stdin() {
        // 存量配置（P3 上线时写入、无 stdin 字段）必须能反序列化为 null = 历史行为，无需迁移
        let legacy = r#"{"args":"--x","env":[{"key":"K","value":"V"}]}"#;
        let cfg: RunConfig = serde_json::from_str(legacy).unwrap();
        assert_eq!(cfg.args, "--x");
        assert_eq!(cfg.env.len(), 1);
        assert_eq!(cfg.stdin.effective_mode(), "null");
        assert!(cfg.stdin.path.is_empty());

        // 完全空的配置对象同样落到缺省
        let empty: RunConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(empty.stdin.effective_mode(), "null");
        assert!(empty.is_empty());

        // 带 stdin 的新格式往返一致
        let full = rc("", vec![], "file", "F:/in.txt");
        let json = serde_json::to_string(&full).unwrap();
        let back: RunConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.stdin.mode, "file");
        assert_eq!(back.stdin.path, "F:/in.txt");

        // S4：interactive 同样零迁移往返（存量配置里没有该值，新增后也不影响反序列化）
        let interactive = rc("", vec![], "interactive", "");
        let json = serde_json::to_string(&interactive).unwrap();
        let back: RunConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.stdin.effective_mode(), "interactive");
        assert!(!back.is_empty());
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