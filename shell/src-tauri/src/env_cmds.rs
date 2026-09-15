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
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
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

// ---------- 运行配置（v3.4：脚本配置（每文件）+ 项目配置（每项目））----------
//
// python_run_dev_plan.md §4：
// - 脚本配置：每文件一份（可选），存 run_configs map，键 = 脚本相对工作区根路径
//   （正斜杠，run_config_key 归一）；entry 恒为文件本身（系统填充，不参与存取语义）；
// - 项目配置：每项目一份，固定键 project_run，entry 为 module | script 二选一；
// - 旧 run_profiles 数组（v2 命名配置列表）直接忽略废弃：不读取、不转换、不回写（§4.3）。

/// 单个环境变量键值对
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

/// 运行入口（P0-C）：`Script path` / `Module name` 二选一（对齐 PyCharm）。
#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub struct RunEntry {
    /// "script" | "module"
    #[serde(default = "default_entry_kind")]
    pub kind: String,
    /// script：脚本路径（相对工作区根、正斜杠；或绝对路径）；module：模块名（如 uvicorn）
    #[serde(default)]
    pub target: String,
}

fn default_entry_kind() -> String {
    "script".to_string()
}

impl Default for RunEntry {
    fn default() -> Self {
        Self { kind: default_entry_kind(), target: String::new() }
    }
}

impl RunEntry {
    /// 是否按模块入口执行：kind == "module" 且模块名非空（空模块名不允许跑 `-m`）。
    pub fn is_module(&self) -> bool {
        self.kind == "module" && !self.target.trim().is_empty()
    }

    /// 归一化后的目标（trim）
    pub fn target_trimmed(&self) -> &str {
        self.target.trim()
    }
}

/// 一份运行配置（v3.4 §4.2 字段表）：脚本配置与项目配置共用同一结构。
/// 脚本配置的 entry 由系统填充（= 文件本身），不参与用户编辑。
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RunProfile {
    /// 运行入口：脚本 / 模块（项目配置二选一；脚本配置恒为 script 且 target 由系统填充）
    #[serde(default)]
    pub entry: RunEntry,
    /// 脚本参数（原始字符串，运行时用 shell-words 拆分）
    #[serde(default)]
    pub args: String,
    /// 工作目录（P0-D）：支持 ${workspaceRoot} / $PROJECT_DIR$ 宏；空 = 默认
    /// （script → 脚本所在目录，module → 工作区根）
    #[serde(default)]
    pub cwd: String,
    /// 自定义环境变量（用户值优先，见调研报告 §9 合并约定）
    #[serde(default)]
    pub env: Vec<EnvVar>,
    /// `.env` 文件列表（P1-G）：有序加载，注入位置 =「默认注入之后、用户显式 env 之前」。
    /// 相对路径以工作区根为基准；文件缺失仅告警不中断运行。
    #[serde(default)]
    pub env_files: Vec<String>,
    /// 配置级解释器覆盖（P1-I）：空 = 沿用工作区级解释器（历史行为）
    #[serde(default)]
    pub interpreter: String,
}

impl RunProfile {
    /// 是否为「等于没配置」（v3.4 字段表裁剪后）：args / env / cwd / env_files / interpreter
    /// 全缺省时，`set_run_config` 会移除该配置保持文件精简。
    /// 注意：脚本配置的 entry 由系统填充（= 文件本身），不参与判定。
    fn is_effectively_empty(&self) -> bool {
        self.args.trim().is_empty()
            && self.env.is_empty()
            && self.env_files.iter().all(|p| p.trim().is_empty())
            && self.cwd.trim().is_empty()
            && self.interpreter.trim().is_empty()
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

/// 项目配置的存储键（v3.4 §4.1：工作区配置固定键）
const PROJECT_RUN_KEY: &str = "project_run";

/// 读取脚本运行配置（v3.4 §4.1：存 run_configs map，键 = run_config_key）。
/// 无匹配返回缺省——读不到配置绝不阻断运行（§4.3）。
pub fn read_run_config(workspace_root: &str, script_path: &str) -> RunProfile {
    let key = run_config_key(workspace_root, script_path);
    load_config(workspace_root)
        .get("run_configs")
        .and_then(Value::as_object)
        .and_then(|m| m.get(&key))
        .and_then(|v| serde_json::from_value::<RunProfile>(v.clone()).ok())
        .map(|mut p| {
            // entry 恒为文件本身（系统填充，§4.2）：存量脏值一律纠正
            p.entry = RunEntry { kind: "script".into(), target: key.clone() };
            p
        })
        .unwrap_or_else(|| RunProfile {
            entry: RunEntry { kind: "script".into(), target: key },
            ..Default::default()
        })
}

/// 读取项目运行配置（v3.4 §4.1：固定键 project_run）；未配置返回 None。
pub(crate) fn read_project_run(workspace_root: &str) -> Option<RunProfile> {
    load_config(workspace_root)
        .get(PROJECT_RUN_KEY)
        .and_then(|v| serde_json::from_value::<RunProfile>(v.clone()).ok())
}

/// 读取项目运行配置（前端配置面板加载用）
#[tauri::command]
pub fn get_project_run(workspace_root: String) -> Option<RunProfile> {
    read_project_run(&workspace_root)
}

/// 保存项目运行配置（entry 为空 = 未配置，移除该键保持文件精简）
#[tauri::command]
pub fn set_project_run(workspace_root: String, config: RunProfile) -> Result<(), String> {
    write_project_run(&workspace_root, &config)
}

/// 项目配置写入（命令与 §9 探测共用）：固定键 `project_run`，entry 为空即移除。
fn write_project_run(workspace_root: &str, config: &RunProfile) -> Result<(), String> {
    let mut v = load_config(workspace_root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    if config.entry.target.trim().is_empty() {
        obj.remove(PROJECT_RUN_KEY);
    } else {
        let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
        obj.insert(PROJECT_RUN_KEY.into(), value);
    }
    save_config(workspace_root, &v)
}

/// 获取「当前文件」运行配置（前端编辑面板加载用，P3 时代命令签名不变）
#[tauri::command]
pub fn get_run_config(workspace_root: String, script_path: String) -> RunProfile {
    read_run_config(&workspace_root, &script_path)
}

/// 保存「当前文件」运行配置（全缺省则移除该配置，保持文件精简；脚本入口的 target 以系统解析为准）
#[tauri::command]
pub fn set_run_config(workspace_root: String, script_path: String, config: RunProfile) -> Result<(), String> {
    let key = run_config_key(&workspace_root, &script_path);
    let mut v = load_config(&workspace_root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    let store = obj
        .entry("run_configs".to_string())
        .or_insert_with(|| json!({}));
    let map = store.as_object_mut().ok_or("工作区配置格式非法")?;
    if config.is_effectively_empty() {
        map.remove(&key);
    } else {
        let mut cfg = config;
        cfg.entry = RunEntry { kind: "script".into(), target: key.clone() };
        map.insert(key, serde_json::to_value(&cfg).map_err(|e| e.to_string())?);
    }
    if map.is_empty() {
        obj.remove("run_configs");
    }
    save_config(&workspace_root, &v)?;
    // tech-debt #9：保存时顺带清扫孤儿运行配置（脚本已删/改名留下的旧键）
    let _ = sweep_run_configs_impl(&workspace_root);
    Ok(())
}

/// 清扫孤儿运行配置：`run_configs` 中键对应文件不存在（脚本已删/改名）即移除（tech-debt #9）。
/// 返回移除的条目数；无 `run_configs` 时直接返回 0，绝不 panic。
fn sweep_run_configs_impl(workspace_root: &str) -> Result<usize, String> {
    let root = Path::new(workspace_root);
    let mut v = load_config(workspace_root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    let Some(store) = obj.get_mut("run_configs") else {
        return Ok(0);
    };
    let Some(map) = store.as_object_mut() else {
        return Ok(0);
    };
    let keys = map.keys().cloned().collect::<Vec<_>>();
    let mut removed = 0usize;
    for key in keys {
        // 键为相对工作区根路径（正斜杠，run_config_key 口径）；存在性以根下拼接为准。
        // 纯文件名键（无 '/'）可能是工作区根目录文件，也可能是 run_config_key 对工作区外文件
        // 的退化键——二者无法靠键本身区分，保守跳过，避免误删工作区外文件的运行配置
        // （review 发现的边界：误删用户配置比残留无害键更不可接受）。
        if !key.contains('/') {
            continue;
        }
        let rel = key.replace('/', std::path::MAIN_SEPARATOR_STR);
        if !root.join(rel).is_file() {
            map.remove(&key);
            removed += 1;
        }
    }
    if map.is_empty() {
        obj.remove("run_configs");
    }
    if removed > 0 {
        save_config(workspace_root, &v)?;
    }
    Ok(removed)
}

/// 手动清扫孤儿运行配置（打开工作区时由前端调用；正常保存已自动清扫）。
#[tauri::command]
pub fn sweep_run_configs(workspace_root: String) -> Result<usize, String> {
    sweep_run_configs_impl(&workspace_root)
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

// ---------- v3.4 §9：项目入口自动探测（首次运行项目时） ----------
//
// 按优先级探测，命中即写入项目配置（用户可改），不命中返回未命中（前端提示「请先配置项目入口」
// 并打开配置面板，§7.4）。探测口径与 FastAPI 探测一致：纯文件读取，无子进程。
//
// 优先级（§9）：
// 1. pyproject.toml 的 [project.scripts] / [tool.uv] 入口声明；
// 2. 依赖声明含 fastapi 且源码有 `app = FastAPI()` → FastAPI 预设（uvicorn <module>:<app> --reload，
//    起服务后自动开浏览器，机制见前端监听 `Uvicorn running on` 行，M3-3.9 落地）；
// 3. 根目录存在 main.py → 入口脚本 main.py；
// 4. 存在含 __main__.py 的包 → python -m <pkg>；
// 5. 都没有 → 未命中。

/// 探测结果（命中来源 + 写入的配置，供前端回显「已自动配置：<来源>」）
#[derive(Serialize)]
pub struct ProjectEntryDetection {
    /// 命中来源标识："scripts" | "fastapi" | "main-py" | "package"
    pub source: String,
    /// 写入项目配置后的入口描述（回显用，如 "uvicorn main:app --reload" / "main.py" / "-m myapp"）
    pub summary: String,
    /// 探测并写入的项目配置（前端可进一步展示 / 用户可在配置面板修改）
    pub config: RunProfile,
}

/// 解析 pyproject.toml 的 `[project.scripts]` 段：收集 `name = "module:func"` 行。
/// 行扫描口径（与 dap.rs 的 pyproject 依赖扫描一致，不引入 toml crate）：
/// 进入 `[project.scripts]` 表头后持续收集 `x = "y"` 键值，直到下一个表头。
fn pyproject_scripts_entries(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut in_scripts = false;
    for raw in text.lines() {
        let l = raw.trim();
        if l.starts_with('[') {
            in_scripts = l == "[project.scripts]";
            continue;
        }
        if !in_scripts {
            continue;
        }
        let Some(eq) = l.find('=') else { continue };
        let key = l[..eq].trim().trim_matches('"');
        let val = l[eq + 1..].trim().trim_matches('"');
        if !key.is_empty() && val.contains(':') {
            out.push((key.to_string(), val.to_string()));
        }
    }
    out
}

/// `[project.scripts]` 条目 `name = "module:func"` → 模块名（取 `:` 前段）
fn script_entry_module(val: &str) -> String {
    val.split(':').next().unwrap_or(val).trim().to_string()
}

/// 深度受限地找「根下第一层含 `__main__.py` 的包」（§9-4：`python -m <pkg>`）。
/// 仅扫根目录第一层子目录（包入口惯例在浅层；复用 FastAPI 扫描的跳过目录表）。
fn find_main_package(root: &Path) -> Option<String> {
    let rd = fs::read_dir(root).ok()?;
    let mut names: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().join("__main__.py").is_file())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort(); // 确定性：多个候选时按字母序取首个
    names.into_iter().next()
}

/// §9 探测主体（纯函数化：目录传入，便于单测直接锁定优先级）
fn detect_project_entry_impl(root: &Path) -> Option<ProjectEntryDetection> {
    // 1. pyproject.toml [project.scripts]（[tool.uv] 无入口声明语义，仅 project.scripts 有效）
    if let Ok(text) = fs::read_to_string(root.join("pyproject.toml")) {
        let entries = pyproject_scripts_entries(&text);
        if let Some((name, val)) = entries.into_iter().next() {
            let module = script_entry_module(&val);
            if !module.is_empty() {
                return Some(ProjectEntryDetection {
                    source: "scripts".into(),
                    summary: format!("-m {module}（scripts.{name}）"),
                    config: RunProfile {
                        entry: RunEntry { kind: "module".into(), target: module },
                        ..Default::default()
                    },
                });
            }
        }
        // 2. FastAPI 预设：依赖声明含 fastapi 且源码有 `app = FastAPI()`
        if deps_mention(&text, "fastapi") {
            if let Some((file, app_var)) = scan_fastapi_app(root) {
                let module = py_module_target(&file);
                let args = format!("{module}:{app_var} --reload");
                return Some(ProjectEntryDetection {
                    source: "fastapi".into(),
                    summary: format!("-m uvicorn {args}"),
                    config: RunProfile {
                        entry: RunEntry { kind: "module".into(), target: "uvicorn".into() },
                        args,
                        cwd: "${workspaceRoot}".into(),
                        ..Default::default()
                    },
                });
            }
        }
    }

    // 3. 根目录 main.py → 入口脚本
    let main_py = root.join("main.py");
    if main_py.is_file() {
        return Some(ProjectEntryDetection {
            source: "main-py".into(),
            summary: "main.py".into(),
            config: RunProfile {
                entry: RunEntry { kind: "script".into(), target: "main.py".into() },
                ..Default::default()
            },
        });
    }

    // 4. 含 __main__.py 的包 → python -m <pkg>
    if let Some(pkg) = find_main_package(root) {
        return Some(ProjectEntryDetection {
            source: "package".into(),
            summary: format!("-m {pkg}"),
            config: RunProfile {
                entry: RunEntry { kind: "module".into(), target: pkg },
                ..Default::default()
            },
        });
    }

    // 5. 都没有 → 未命中
    None
}

/// 首次运行项目时的入口自动探测（§9）：命中即写入项目配置（用户可改），返回探测结果。
#[tauri::command]
pub async fn detect_project_entry(workspace_root: String) -> Result<Option<ProjectEntryDetection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(&workspace_root);
        if !root.is_dir() {
            return Err(format!("工作区不存在：{workspace_root}"));
        }
        // 已配置则不覆盖（§9：探测服务于「首次运行」；已有配置 = 用户已表达意图）
        if read_project_run(&workspace_root).is_some() {
            return Ok(None);
        }
        let Some(hit) = detect_project_entry_impl(root) else { return Ok(None) };
        write_project_run(&workspace_root, &hit.config)?;
        Ok(Some(hit))
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

// ---------- P0-E：FastAPI 项目探测（预设「仅提示」形态的数据源） ----------
//
// 探测口径（纯文件读取，无子进程，一次调用 < 数十 ms）：
// 1. 依赖声明（pyproject.toml / 根目录 requirements*.txt）提及 fastapi——无声明文件则直接跳过；
// 2. 源码扫描（限深限数）找到首个 `<var> = FastAPI(` 声明 → 预设 module 目标（相对路径点分）。
// 命中与否只决定前端是否出「一键生成配置」提示，绝不主动改配置/装包。

/// FastAPI 预设探测结果（file/module 均为相对工作区根、正斜杠）
#[derive(Serialize)]
pub struct FastApiPreset {
    /// 声明 FastAPI 应用的文件（如 "main.py" / "app/main.py"）
    pub file: String,
    /// uvicorn 模块目标（如 "main" / "app.main"）
    pub module: String,
    /// 应用变量名（如 "app"）
    pub app_var: String,
    /// 依赖声明是否已含 uvicorn（缺则提示先安装）
    pub has_uvicorn: bool,
}

const FASTAPI_SCAN_SKIP_DIRS: &[&str] = &[
    "venv", "__pycache__", "node_modules", "dist", "build", ".ruff_cache", ".pytest_cache", ".mypy_cache",
];
const FASTAPI_SCAN_MAX_DEPTH: usize = 4;
const FASTAPI_SCAN_MAX_FILES: usize = 500;
const FASTAPI_SCAN_MAX_BYTES: u64 = 512 * 1024;

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
fn deps_mention(text: &str, pkg: &str) -> bool {
    text.lines().any(|l| {
        let l = l.trim();
        !l.starts_with('#') && l.to_ascii_lowercase().contains(pkg)
    })
}

/// 深度/数量受限的工作区 .py 扫描，找首个 `<var> = FastAPI(` 声明 → (相对路径, 变量名)
fn scan_fastapi_app(root: &Path) -> Option<(String, String)> {
    fn walk(dir: &Path, depth: usize, files: &mut Vec<PathBuf>) {
        if depth > FASTAPI_SCAN_MAX_DEPTH || files.len() >= FASTAPI_SCAN_MAX_FILES {
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
                if !name.starts_with('.') && !FASTAPI_SCAN_SKIP_DIRS.contains(&name.as_str()) {
                    walk(&p, depth + 1, files);
                }
            } else if name.ends_with(".py") && files.len() < FASTAPI_SCAN_MAX_FILES {
                files.push(p);
            }
        }
    }
    let mut files: Vec<PathBuf> = Vec::new();
    walk(root, 0, &mut files);
    for f in &files {
        let Ok(meta) = f.metadata() else { continue };
        if meta.len() > FASTAPI_SCAN_MAX_BYTES {
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
            let Some(rest) = rhs.strip_prefix("FastAPI") else { continue };
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
fn py_module_target(rel_file: &str) -> String {
    rel_file.strip_suffix(".py").unwrap_or(rel_file).replace('/', ".")
}

fn detect_fastapi_impl(workspace_root: String) -> Result<Option<FastApiPreset>, String> {
    let root = Path::new(&workspace_root);
    if !root.is_dir() {
        return Err(format!("工作区不存在：{workspace_root}"));
    }
    let Some(deps) = collect_dep_text(root) else { return Ok(None) };
    if !deps_mention(&deps, "fastapi") {
        return Ok(None);
    }
    let has_uvicorn = deps_mention(&deps, "uvicorn");
    let Some((file, app_var)) = scan_fastapi_app(root) else { return Ok(None) };
    Ok(Some(FastApiPreset { module: py_module_target(&file), file, app_var, has_uvicorn }))
}

/// FastAPI 项目探测（P0-E）：命中返回预设数据，前端据此给「一键生成配置」提示。
#[tauri::command]
pub async fn detect_fastapi(workspace_root: String) -> Result<Option<FastApiPreset>, String> {
    tauri::async_runtime::spawn_blocking(move || detect_fastapi_impl(workspace_root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
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

    /// P1：调试复用运行配置——`dap::debug_start` 走的是 `read_run_config(root, 脚本绝对路径)`，
    /// 与「运行」路径（`get_run_config` / `build_run_env`）是**同一个函数、同一个键**。
    /// 此测试锁定键口径（相对工作区根 + 统一正斜杠）：任一侧改了口径，调试都会**静默**
    /// 读不到配置（不报错，只是参数与环境变量全丢），属最难排查的一类故障。
    #[test]
    fn run_config_key_is_relative_and_stable() {
        if cfg!(windows) {
            assert_eq!(run_config_key("F:\\ws", "F:\\ws\\pkg\\mod.py"), "pkg/mod.py");
            assert_eq!(run_config_key("F:/ws", "F:/ws/pkg/mod.py"), "pkg/mod.py");
            assert_eq!(run_config_key("F:\\ws\\", "F:\\ws\\mod.py"), "mod.py");
            // 工作区外的文件：退化为文件名，仍有一个稳定键（不因绝对路径漂移失效）
            assert_eq!(run_config_key("F:\\ws", "G:\\other\\mod.py"), "mod.py");
        } else {
            assert_eq!(run_config_key("/ws", "/ws/pkg/mod.py"), "pkg/mod.py");
            assert_eq!(run_config_key("/ws/", "/ws/mod.py"), "mod.py");
            assert_eq!(run_config_key("/ws", "/other/mod.py"), "mod.py");
        }
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
    fn test_run_profile_is_effectively_empty() {
        assert!(RunProfile::default().is_effectively_empty());
        assert!(rc("  ", vec![]).is_effectively_empty());
        assert!(!rc("--flag", vec![]).is_effectively_empty());
        assert!(!rc("", vec![EnvVar { key: "K".into(), value: "V".into() }]).is_effectively_empty());
        // v3.4 §4.2：cwd 属于保留字段，算「有配置」；entry 由系统填充，不参与判定
        assert!(!RunProfile { cwd: "${workspaceRoot}".into(), ..Default::default() }.is_effectively_empty());
        // .env 文件、解释器覆盖都算「有配置」；空白 env_files 视为缺省
        assert!(!RunProfile { env_files: vec![".env".into()], ..Default::default() }.is_effectively_empty());
        assert!(RunProfile { env_files: vec!["  ".into()], ..Default::default() }.is_effectively_empty());
        assert!(!RunProfile { interpreter: "D:/py/python.exe".into(), ..Default::default() }.is_effectively_empty());
    }

    #[test]
    fn test_run_entry_is_module() {
        assert!(!RunEntry::default().is_module());
        assert!(RunEntry { kind: "module".into(), target: "uvicorn".into() }.is_module());
        // 空模块名不允许跑 `-m`（归一化为脚本入口语义，由调用方报错兜底）
        assert!(!RunEntry { kind: "module".into(), target: "  ".into() }.is_module());
        assert!(RunEntry { kind: "module".into(), target: " uvicorn ".into() }.is_module());
        assert_eq!(RunEntry { kind: "module".into(), target: " uvicorn ".into() }.target_trimmed(), "uvicorn");
    }

    #[test]
    fn test_module_target_helpers() {
        assert_eq!(py_module_target("app/main.py"), "app.main");
        assert_eq!(py_module_target("main.py"), "main");
        assert!(deps_mention("fastapi==0.1\n", "fastapi"));
        assert!(!deps_mention("# fastapi\n", "fastapi"));
        assert!(!deps_mention("requests\n", "fastapi"));
    }

    /// 构造 RunProfile 的小工具（避免每处都写全字段）
    fn rc(args: &str, env: Vec<EnvVar>) -> RunProfile {
        RunProfile {
            args: args.into(),
            env,
            ..Default::default()
        }
    }

    #[test]
    fn test_run_profile_backward_compat() {
        // 存量配置（P3 时代写入，无 entry / cwd 字段）反序列化为新默认，无需迁移
        let legacy = r#"{"args":"--x","env":[{"key":"K","value":"V"}]}"#;
        let cfg: RunProfile = serde_json::from_str(legacy).unwrap();
        assert_eq!(cfg.args, "--x");
        assert_eq!(cfg.env.len(), 1);
        assert_eq!(cfg.entry.kind, "script");
        assert!(cfg.cwd.is_empty());

        // 完全空的配置对象同样落到缺省，且仍视为空配置
        let empty: RunProfile = serde_json::from_str("{}").unwrap();
        assert!(empty.is_effectively_empty());

        // 序列化往返一致
        let full = rc("--flag", vec![EnvVar { key: "K".into(), value: "V".into() }]);
        let json = serde_json::to_string(&full).unwrap();
        let back: RunProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.args, "--flag");
        assert_eq!(back.env.len(), 1);
    }

    /// v3.4 §4.3：存量工作区配置里的 v2 遗留字段（name / temporary / allow_multiple / stdin 等）
    /// 反序列化时静默丢弃，不报错、不迁移；保留字段照常读取。
    #[test]
    fn test_legacy_v2_fields_are_ignored_on_deserialize() {
        let legacy = r#"{"name":"main.py","temporary":true,"allow_multiple":true,"pre_run_profile":"db","open_browser_url":"http://x","auto_rerun":true,"python_console":true,"stdin":{"mode":"file","path":"in.txt"},"args":"--x"}"#;
        let cfg: RunProfile = serde_json::from_str(legacy).unwrap();
        assert_eq!(cfg.args, "--x");
        assert!(!cfg.is_effectively_empty()); // args 非空即「有配置」
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

    // ---------- v3.4 §9：项目入口探测单测（优先级锁定） ----------

    fn detect_tmpdir(tag: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-detect-{tag}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// §9-1：pyproject.toml [project.scripts] 优先级最高，命中即 module 入口
    #[test]
    fn detect_prefers_project_scripts() {
        let d = detect_tmpdir("scripts");
        std::fs::write(d.join("pyproject.toml"), r#"
[project]
name = "demo"

[project.scripts]
demo = "demo.cli:main"
"#).unwrap();
        // 同时放置 main.py / 包，验证 scripts 优先
        std::fs::write(d.join("main.py"), "print(1)").unwrap();
        let hit = detect_project_entry_impl(&d).expect("scripts 应命中");
        assert_eq!(hit.source, "scripts");
        assert_eq!(hit.config.entry.kind, "module");
        assert_eq!(hit.config.entry.target, "demo.cli"); // `demo = "demo.cli:main"` 的模块段
        assert!(hit.summary.contains("scripts.demo"));
    }

    /// §9-2：无 scripts 时，依赖含 fastapi + 源码有 `app = FastAPI()` → uvicorn 预设
    #[test]
    fn detect_fastapi_preset_when_no_scripts() {
        let d = detect_tmpdir("fastapi");
        std::fs::write(d.join("pyproject.toml"), r#"
[project]
dependencies = ["fastapi", "uvicorn"]
"#).unwrap();
        std::fs::write(d.join("main.py"), "from fastapi import FastAPI\napp = FastAPI()\n").unwrap();
        let hit = detect_project_entry_impl(&d).expect("fastapi 应命中");
        assert_eq!(hit.source, "fastapi");
        assert_eq!(hit.config.entry.kind, "module");
        assert_eq!(hit.config.entry.target, "uvicorn");
        assert_eq!(hit.config.args, "main:app --reload");
        assert_eq!(hit.config.cwd, "${workspaceRoot}");
    }

    /// §9-3：无 scripts / 非 fastapi，根目录 main.py → 入口脚本
    #[test]
    fn detect_falls_back_to_main_py() {
        let d = detect_tmpdir("mainpy");
        std::fs::write(d.join("main.py"), "print(1)").unwrap();
        let hit = detect_project_entry_impl(&d).expect("main.py 应命中");
        assert_eq!(hit.source, "main-py");
        assert_eq!(hit.config.entry.kind, "script");
        assert_eq!(hit.config.entry.target, "main.py");
    }

    /// §9-4：无 main.py，存在含 __main__.py 的包 → python -m <pkg>
    #[test]
    fn detect_falls_back_to_main_package() {
        let d = detect_tmpdir("pkg");
        std::fs::create_dir_all(d.join("myapp")).unwrap();
        std::fs::write(d.join("myapp").join("__main__.py"), "print(1)").unwrap();
        std::fs::write(d.join("myapp").join("__init__.py"), "").unwrap();
        let hit = detect_project_entry_impl(&d).expect("包入口应命中");
        assert_eq!(hit.source, "package");
        assert_eq!(hit.config.entry.kind, "module");
        assert_eq!(hit.config.entry.target, "myapp");
    }

    /// §9-5：全都没有 → 未命中（前端提示「请先配置项目入口」）
    #[test]
    fn detect_misses_on_empty_project() {
        let d = detect_tmpdir("empty");
        std::fs::write(d.join("utils.py"), "print(1)").unwrap(); // 散文件不算入口
        assert!(detect_project_entry_impl(&d).is_none());
    }

    /// [project.scripts] 行扫描：表头切换 / 无冒号条目 / 空键的容错
    #[test]
    fn pyproject_scripts_scan_rules() {
        let text = r#"
[project]
name = "x"

[project.scripts]
demo = "demo.cli:main"
bad-no-colon = "justmodule"

[tool.uv]
dev-dependencies = []
"#;
        let entries = pyproject_scripts_entries(text);
        assert_eq!(entries, vec![("demo".to_string(), "demo.cli:main".to_string())]);
        assert_eq!(script_entry_module("demo.cli:main"), "demo.cli");
        assert_eq!(script_entry_module("nocolon"), "nocolon");
    }
}