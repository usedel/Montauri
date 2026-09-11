use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri_plugin_dialog::DialogExt;

use crate::tool_paths::{tool_command, ENV_GIT, ENV_RUFF, ENV_UV};
use crate::util::{no_window, opencharm_home};

#[derive(Serialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 读取目录（一层），过滤常见噪声目录；show_hidden 控制是否显示 dot 文件/目录
#[tauri::command]
pub fn read_dir(path: &str, show_hidden: bool) -> Result<Vec<Entry>, String> {
    // 始终过滤的噪声目录（无论是否显示隐藏文件）
    const ALWAYS_IGNORED: [&str; 2] = ["node_modules", "__pycache__"];
    // 默认模式额外过滤的目录
    const DEFAULT_IGNORED: [&str; 4] = [".git", ".venv", ".idea", ".vscode"];
    let mut out = Vec::new();
    let rd = fs::read_dir(path).map_err(|e| e.to_string())?;
    for d in rd {
        let d = d.map_err(|e| e.to_string())?;
        let name = d.file_name().to_string_lossy().to_string();
        if ALWAYS_IGNORED.contains(&name.as_str()) {
            continue;
        }
        if !show_hidden {
            // 默认模式：过滤所有 dot 项 + 常见 IDE/环境目录
            if name.starts_with('.') || DEFAULT_IGNORED.contains(&name.as_str()) {
                continue;
            }
        }
        let is_dir = d.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(Entry {
            name,
            path: d.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| (b.is_dir as u8).cmp(&(a.is_dir as u8)).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// 读取文件字节并 base64 编码（Markdown 导出 HTML 时把本地图片内联为 data URI）。
/// 图片是二进制，read_file 的 read_to_string 对非 UTF-8 会失败，故单独走字节读取。
#[tauri::command]
pub fn read_file_base64(path: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

/// 删除文件（CR-05：选区运行临时文件清理用）。文件不存在视为成功（幂等），
/// 目录与其它 IO 错误透传字符串。
#[tauri::command]
pub fn delete_file(path: &str) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// 写入 Live Templates 配置（M2 管理面板 / 导入）
/// scope="user" → <data_root>/config/templates.json；scope="workspace" → <workspace_root>/.opencharm/templates.json
#[tauri::command]
pub fn write_templates_config(
    scope: &str,
    workspace_root: Option<String>,
    content: &str,
) -> Result<(), String> {
    let path = match scope {
        "user" => opencharm_home().join("config").join("templates.json"),
        "workspace" => {
            let root = workspace_root
                .ok_or_else(|| "workspace 层写入需要 workspace_root".to_string())?;
            Path::new(&root).join(".opencharm").join("templates.json")
        }
        _ => return Err(format!("未知配置层：{scope}")),
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

/// 当前操作系统用户名（live templates 表达式引擎 user() 函数）
#[tauri::command]
pub fn get_user_name() -> Result<String, String> {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .map_err(|e| e.to_string())
}

/// 智能模板用户配置路径：<data_root>/config/templates.json（不存在返回 null）
#[tauri::command]
pub fn read_templates_config() -> Result<Option<String>, String> {
    let p = opencharm_home().join("config").join("templates.json");
    if p.exists() {
        fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

/// 最近工作区列表：<data_root>/config/recent-workspaces.json（启动自动恢复 / 「最近的工作区」菜单）
#[tauri::command]
pub fn get_recent_workspaces() -> Result<Vec<String>, String> {
    let p = opencharm_home().join("config").join("recent-workspaces.json");
    if !p.exists() {
        return Ok(Vec::new());
    }
    let s = fs::read_to_string(p).map_err(|e| e.to_string())?;
    let list: Vec<String> = serde_json::from_str(&s).unwrap_or_default();
    // 过滤已删除/不存在的目录
    Ok(list.into_iter().filter(|x| Path::new(x).is_dir()).collect())
}

/// 记录最近工作区（去重 + 置顶 + 上限 10），返回更新后的列表
#[tauri::command]
pub fn add_recent_workspace(path: &str) -> Result<Vec<String>, String> {
    let dir = opencharm_home().join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("recent-workspaces.json");
    let mut list: Vec<String> = if p.exists() {
        fs::read_to_string(&p)
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    list.retain(|x| x != path && Path::new(x).is_dir());
    list.insert(0, path.to_string());
    list.truncate(10);
    let payload = serde_json::to_string(&list).map_err(|e| e.to_string())?;
    fs::write(&p, payload).map_err(|e| e.to_string())?;
    Ok(list)
}

/// 清空最近工作区列表（直接删除存储文件，get_recent_workspaces 对不存在返回空）
#[tauri::command]
pub fn clear_recent_workspaces() -> Result<(), String> {
    let p = opencharm_home().join("config").join("recent-workspaces.json");
    let _ = fs::remove_file(&p);
    Ok(())
}

/// 删除单条最近工作区，返回更新后的列表
#[tauri::command]
pub fn remove_recent_workspace(path: String) -> Result<Vec<String>, String> {
    let mut list = get_recent_workspaces()?;
    list.retain(|x| x != &path);
    let dir = opencharm_home().join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let payload = serde_json::to_string(&list).map_err(|e| e.to_string())?;
    fs::write(dir.join("recent-workspaces.json"), payload).map_err(|e| e.to_string())?;
    Ok(list)
}

/// 打开文件夹选择对话框（返回所选路径或 null）
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.clone().dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    Ok(rx.recv().map_err(|e| e.to_string())?)
}

/// 打开单文件选择对话框（返回所选路径或 null）。
/// stdin 重定向（S1）选输入文件用；与 pick_folder 同构，仅换成 pick_file。
#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.clone().dialog().file().pick_file(move |file| {
        let _ = tx.send(file.map(|p| p.to_string()));
    });
    Ok(rx.recv().map_err(|e| e.to_string())?)
}

// ---------- 新建项目 ----------

#[derive(Serialize)]
pub struct CreateProjectResult {
    /// 新项目根目录（绝对路径）
    pub path: String,
    /// git init 是否成功（未要求时恒为 true）
    pub git_ok: bool,
    /// git init 失败原因（成功时为空）
    pub git_message: String,
    /// pyproject.toml 生成说明（uv 官方脚手架 or 模板回退，P2 建议 1）
    pub pyproject_note: String,
}

/// 项目名校验：非空（trim 后）、非 ./..、不含路径分隔符与 Windows 保留字符、不含控制字符
fn valid_project_name(name: &str) -> bool {
    let name = name.trim();
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.chars().any(|c| {
            matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
        })
}

/// git init（best-effort：失败不阻断项目创建，仅回传原因）
fn git_init_at(root: &Path) -> Result<(), String> {
    let mut cmd = tool_command("git", ENV_GIT);
    cmd.arg("init").arg("--quiet").current_dir(root);
    let out = no_window(&mut cmd)
        .output()
        .map_err(|e| format!("无法启动 git（可能未安装）：{e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 项目名 → 合法 PEP 508 包名：转小写、非法字符折叠为 '-'、去首尾 '-'，空则回退 "app"。
fn sanitize_pkg_name(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '_' {
            out.push(c.to_ascii_lowercase());
        } else {
            out.push('-');
        }
    }
    // PEP 508 名须以字母/数字开头结尾：去掉首尾的分隔符（-_.）
    let trimmed = out.trim_matches(|c| c == '-' || c == '_' || c == '.').to_string();
    if trimmed.is_empty() {
        "app".to_string()
    } else {
        trimmed
    }
}

/// 从版本标识（uv spec 如 "cpython-3.13.7-windows-x86_64-none" 或纯版本号 "3.12"）提取
/// 短版本 "3.MINOR"（uv `--python` 与 requires-python 共用）；无法解析返回 None。
fn python_short_from(version: &str) -> Option<String> {
    let chars: Vec<char> = version.chars().collect();
    for i in 0..chars.len().saturating_sub(1) {
        if chars[i] == '3' && chars[i + 1] == '.' {
            let mut minor = String::new();
            let mut j = i + 2;
            while j < chars.len() && chars[j].is_ascii_digit() {
                minor.push(chars[j]);
                j += 1;
            }
            if !minor.is_empty() {
                return Some(format!("3.{minor}"));
            }
        }
    }
    None
}

/// 写入最小 pyproject.toml（方案 B，回退路径）：仅 [project] 元数据 + 空依赖，
/// 任何工具链都认、不含 IDE 私有配置。供 create_project 与 env_cmds::init_pyproject 共用。
pub(crate) fn write_min_pyproject(root: &Path, name: &str, requires_python: &str) -> std::io::Result<()> {
    let pkg = sanitize_pkg_name(name);
    let content = format!(
        "[project]\nname = \"{pkg}\"\nversion = \"0.1.0\"\nrequires-python = \"{requires_python}\"\ndependencies = []\n"
    );
    fs::write(root.join("pyproject.toml"), content)
}

/// 方案 A：用 uv 官方脚手架生成 pyproject.toml。
/// `uv init --bare` 只写 pyproject.toml——实测 uv 0.10.11 在非空目录下不生成 main.py/README/.gitignore，
/// 也不触碰既有文件，因此与 create_project 的 main.py/.gitignore 写入无双写冲突（调研报告 §5 建议 1 的顾虑）。
/// `--vcs none` 让 git 初始化仍由现有 git_init 分支独占；`--no-workspace` 避免误并入父级 workspace；
/// `--no-python-downloads --offline` 确保创建项目绝不触发联网下载（§9 网络风险）。
/// python_arg 传给 `--python`（版本号如 "3.13"，或解释器路径）；None = 由 uv 自行决定。
/// Err 表示 uv 缺席或失败，调用方须回退方案 B。
fn uv_init_bare(root: &Path, python_arg: Option<&str>) -> Result<(), String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.arg("init")
        .arg("--bare")
        .arg("--vcs")
        .arg("none")
        .arg("--no-workspace")
        .arg("--no-python-downloads")
        .arg("--offline");
    if let Some(v) = python_arg {
        cmd.arg("--python").arg(v);
    }
    cmd.arg(root);
    let out = no_window(&mut cmd)
        .output()
        .map_err(|e| format!("无法启动 uv（可能未安装）：{e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(if msg.is_empty() {
        format!("uv init 失败（exit {:?}）", out.status.code())
    } else {
        msg
    })
}

/// 生成 pyproject.toml：方案 A（`uv init --bare`）为主，uv 缺席/失败时回退方案 B（最小模板），
/// 保证「创建永不因 uv 缺席而失败」（调研报告 §9 回退约定）。
/// fallback_requires 为回退模板写入的 requires-python。返回 (是否由 uv 生成, 面向用户的说明)。
pub(crate) fn ensure_pyproject(
    root: &Path,
    name: &str,
    python_arg: Option<String>,
    fallback_requires: &str,
) -> (bool, String) {
    match uv_init_bare(root, python_arg.as_deref()) {
        Ok(()) => (true, "已用 uv init --bare 生成 pyproject.toml".to_string()),
        Err(e) => match write_min_pyproject(root, name, fallback_requires) {
            Ok(()) => (
                false,
                format!("uv 不可用（{e}），已写入最小 pyproject.toml 模板（requires-python = \"{fallback_requires}\"）"),
            ),
            Err(we) => (false, format!("生成 pyproject.toml 失败：{we}")),
        },
    }
}

/// 新建项目：parent_dir/name 下创建 main.py 入口 + 最小 pyproject.toml；git_init 时附 .gitignore 并初始化仓库。
/// .venv 创建复用既有 create_venv 命令（前端在打开工作区后调用，输出流式可见）。
/// python_version：创建向导所选版本（uv spec 或版本号，可空），用于 pyproject 的 requires-python。
/// async + spawn_blocking：git init 子进程可能耗时，同步 command 会卡死主线程 UI。
#[tauri::command]
pub async fn create_project(
    parent_dir: String,
    name: String,
    git_init: bool,
    python_version: Option<String>,
) -> Result<CreateProjectResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_project_impl(parent_dir, name, git_init, python_version))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn create_project_impl(
    parent_dir: String,
    name: String,
    git_init: bool,
    python_version: Option<String>,
) -> Result<CreateProjectResult, String> {
    if !valid_project_name(&name) {
        return Err(format!("项目名称非法：{name:?}（不能为空，不能包含 \\ / : * ? \" < > | 等字符）"));
    }
    let parent = Path::new(&parent_dir);
    if !parent.is_dir() {
        return Err(format!("位置不存在或不是文件夹：{parent_dir}"));
    }
    let root = parent.join(&name);
    if root.exists() {
        return Err(format!("目标已存在：{}", root.to_string_lossy()));
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let main_py = "def main() -> None:\n    print(\"Hello from OpenCharm!\")\n\n\nif __name__ == \"__main__\":\n    main()\n";
    fs::write(root.join("main.py"), main_py).map_err(|e| e.to_string())?;

    // P2（建议 1）：默认生成 pyproject.toml，让 uv run / 依赖管理语义明确（对应痛点①）。
    // 方案 A（uv init --bare）为主、方案 B（最小模板）兜底：既用官方脚手架，又保证
    // “创建永不因 uv 缺席而失败”（§9）。requires-python 反映创建向导所选版本；未选版本时统一
    // 显式传 3.12 下限，避免 uv 依机器默认解释器产出不确定结果（两条路径产出一致）。
    let python_arg = python_short_from(python_version.as_deref().unwrap_or(""))
        .unwrap_or_else(|| "3.12".to_string());
    let requires_python = format!(">={python_arg}");
    let (_used_uv, pyproject_note) = ensure_pyproject(&root, &name, Some(python_arg), &requires_python);

    let mut git_ok = true;
    let mut git_message = String::new();
    if git_init {
        let gitignore = "# Python\n__pycache__/\n*.py[cod]\n*.egg-info/\ndist/\nbuild/\n\n# 虚拟环境\n.venv/\n\n# 工具缓存\n.pytest_cache/\n.ruff_cache/\n.mypy_cache/\n\n# 环境变量\n.env\n";
        fs::write(root.join(".gitignore"), gitignore).map_err(|e| e.to_string())?;
        if let Err(e) = git_init_at(&root) {
            git_ok = false;
            git_message = e;
        }
    }

    Ok(CreateProjectResult {
        path: root.to_string_lossy().to_string(),
        git_ok,
        git_message,
        pyproject_note,
    })
}

// ---------- 代码格式化（ruff，独立子进程，不走 LSP 桥） ----------

#[derive(Serialize)]
pub struct FormatResult {
    /// 格式化后的全文（失败时为 None）
    pub formatted: Option<String>,
    /// ruff stderr（成功时为空）
    pub message: String,
}

/// ruff format --stdin：格式化缓冲区内容（不落盘，编辑器层负责应用与撤销）。
/// ruff 缺席不拖垮功能：返回错误信息由前端提示（与探针缺席策略一致）。
/// async + spawn_blocking：等待 ruff 子进程期间不能占用主线程。
#[tauri::command]
pub async fn format_python(path: String, content: String) -> Result<FormatResult, String> {
    tauri::async_runtime::spawn_blocking(move || format_python_impl(path, content))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn format_python_impl(path: String, content: String) -> Result<FormatResult, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut cmd = tool_command("ruff", ENV_RUFF);
    cmd.args(["format", "--stdin-filename", &path, "-"]);
    let mut child = match no_window(&mut cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(FormatResult {
                formatted: None,
                message: format!("无法启动 ruff（可能未安装）：{e}"),
            })
        }
    };
    // 写 stdin（子进程可能提前退出，忽略 BrokenPipe）
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(content.as_bytes());
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("ruff 执行失败：{e}"))?;
    if out.status.success() {
        Ok(FormatResult {
            formatted: Some(String::from_utf8_lossy(&out.stdout).to_string()),
            message: String::new(),
        })
    } else {
        Ok(FormatResult {
            formatted: None,
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        })
    }
}

// ---------- 全局搜索（工作区递归文本搜索） ----------

#[derive(Serialize, Clone)]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    /// 匹配行全文（trim 后）
    pub text: String,
    /// 匹配在行内的起始列（1 基，字符数）
    pub column: u32,
    /// 匹配长度（字符数）
    pub length: u32,
}

#[derive(Serialize)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    /// 实际扫描的文件数
    pub files_scanned: u32,
    /// 跳过的二进制/超大文件数
    pub files_skipped: u32,
    /// 其中因二进制/非 UTF-8 跳过的数量（其余为超过大小上限）
    pub files_skipped_binary: u32,
    /// 匹配数达到上限被截断（防海量结果拖垮序列化与前端渲染）
    pub truncated: bool,
}

/// 匹配数上限：超过即停止收集（与 VS Code 搜索的结果上限策略一致）
const MAX_MATCHES: usize = 5000;

/// 搜索忽略目录：`ignore` 遍历的安全网过滤（隐藏目录已由 hidden 规则覆盖，
/// 此处额外兜底未被 .gitignore 收录的常见噪声目录）
const SEARCH_IGNORED_DIRS: [&str; 10] = [
    ".git", ".venv", "node_modules", "__pycache__", ".idea", ".vscode",
    "dist", "build", ".pytest_cache", ".ruff_cache",
];

/// 单文件大小上限（超过跳过，防误扫大文件卡顿）
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;

/// 工作区全局搜索：大小写不敏感子串匹配，返回带行号/列号的匹配列表。
/// 遍历交给 ripgrep 生态的 `ignore` crate（.gitignore 感知 + 隐藏过滤），
/// 匹配阶段按文件多线程并行，单文件 ≤ 2MB。接口与返回结构不变，前端零感知。
/// async + spawn_blocking：大工作区扫描可能耗时，同步 command 会卡死主线程 UI。
#[tauri::command]
pub async fn search_workspace(root: String, query: String, case_sensitive: bool) -> Result<SearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || search_workspace_impl(root, query, case_sensitive))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn search_workspace_impl(root: String, query: String, case_sensitive: bool) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult { matches: vec![], files_scanned: 0, files_skipped: 0, files_skipped_binary: 0, truncated: false });
    }
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    // 小写化关键词只计算一次，供所有线程复用
    let needle = if case_sensitive { query.clone() } else { query.to_lowercase() };
    let query_char_len = query.chars().count() as u32;

    // 1. ignore 遍历：.gitignore + 隐藏过滤，收集候选文件
    let files = collect_files(root_path);

    // 2. 多线程并行搜索
    let files_scanned = AtomicUsize::new(0);
    let files_skipped = AtomicUsize::new(0);
    let skipped_binary = AtomicUsize::new(0);
    let match_count = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);
    let num_threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, files.len().max(1));

    let mut matches: Vec<SearchMatch> = Vec::new();
    std::thread::scope(|s| {
        let chunk_size = (files.len() / num_threads).max(1);
        // 以 Copy 引用预先绑定共享数据，供 move 闭包复制（避免移动原子量与 needle 本体）
        let needle_ref = needle.as_str();
        let scanned = &files_scanned;
        let skipped = &files_skipped;
        let skip_bin = &skipped_binary;
        let counted = &match_count;
        let trunc = &truncated;
        let mut handles = Vec::new();
        for chunk in files.chunks(chunk_size) {
            handles.push(s.spawn(move || {
                let mut local: Vec<SearchMatch> = Vec::new();
                for path in chunk {
                    if trunc.load(Ordering::Relaxed) {
                        break;
                    }
                    search_one_file(path, needle_ref, query_char_len, case_sensitive, &mut local, scanned, skipped, skip_bin, counted, trunc);
                }
                local
            }));
        }
        for h in handles {
            if let Ok(local) = h.join() {
                matches.extend(local);
            }
        }
    });
    // 按路径 + 行号排序，结果稳定；超出上限截断
    matches.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    let was_truncated = truncated.load(Ordering::Relaxed) || matches.len() > MAX_MATCHES;
    matches.truncate(MAX_MATCHES);
    Ok(SearchResult {
        matches,
        files_scanned: files_scanned.load(Ordering::Relaxed) as u32,
        files_skipped: files_skipped.load(Ordering::Relaxed) as u32,
        files_skipped_binary: skipped_binary.load(Ordering::Relaxed) as u32,
        truncated: was_truncated,
    })
}

/// ignore 遍历收集候选文件：尊重 .gitignore/全局 git 排除，跳过隐藏项与常见噪声目录。
fn collect_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(|e| {
            // 根目录本身不参与过滤；其余按噪声目录名单剪枝（不再下探）
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            !SEARCH_IGNORED_DIRS.contains(&name.as_str())
        });
    for entry in builder.build() {
        if let Ok(entry) = entry {
            if entry.file_type().map_or(false, |ft| ft.is_file()) {
                files.push(entry.into_path());
            }
        }
    }
    files
}

/// ASCII 大小写不敏感子串查找：在 haystack[from..] 中定位已小写化的 needle，
/// 返回匹配起始字节偏移。逐字节比较、零堆分配（替代逐行 to_lowercase）。
/// 仅对 ASCII 生效；needle 含非 ASCII 时调用方应退回 to_lowercase 路径。
fn find_ascii_ignore_case(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    let nlen = needle.len();
    if nlen == 0 || haystack.len() < from + nlen {
        return None;
    }
    let end = haystack.len() - nlen;
    let first = needle[0];
    let mut i = from;
    while i <= end {
        if haystack[i].to_ascii_lowercase() == first {
            let mut matched = true;
            for k in 1..nlen {
                if haystack[i + k].to_ascii_lowercase() != needle[k] {
                    matched = false;
                    break;
                }
            }
            if matched {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

/// 收集一条匹配到 local；全局计数达上限时置 truncated 并返回 false（调用方应停止）。
fn try_push_match(
    local: &mut Vec<SearchMatch>,
    path_str: &str,
    line_no: u32,
    line: &str,
    col: usize,
    query_char_len: u32,
    match_count: &AtomicUsize,
    truncated: &AtomicBool,
) -> bool {
    if match_count.fetch_add(1, Ordering::Relaxed) >= MAX_MATCHES {
        truncated.store(true, Ordering::Relaxed);
        return false;
    }
    local.push(SearchMatch {
        path: path_str.to_string(),
        line: line_no,
        text: line.trim().to_string(),
        column: (col + 1) as u32,
        length: query_char_len,
    });
    true
}

/// 读取文件为文本；二进制或非 UTF-8 返回 None。
/// 先读前 8KB 探测：含 \0 即判二进制直接放弃，避免把大二进制文件整个读进内存（性能关键）。
fn read_text_file(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = fs::File::open(path).ok()?;
    let mut head = [0u8; 8192];
    let n = file.read(&mut head).ok()?;
    if head[..n].contains(&0) {
        return None;
    }
    let mut buf = head[..n].to_vec();
    file.read_to_end(&mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// 搜索单个文件，匹配写入 local；scanned/skipped/match_count/truncated 为跨线程共享计数。
fn search_one_file(
    path: &Path,
    needle: &str,
    query_char_len: u32,
    case_sensitive: bool,
    local: &mut Vec<SearchMatch>,
    files_scanned: &AtomicUsize,
    files_skipped: &AtomicUsize,
    skipped_binary: &AtomicUsize,
    match_count: &AtomicUsize,
    truncated: &AtomicBool,
) {
    // 大小/元数据检查
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_FILE_SIZE {
            files_skipped.fetch_add(1, Ordering::Relaxed);
            return;
        }
    }
    // 前 8KB 探测二进制，避免把大二进制文件整个读进内存
    let content = match read_text_file(path) {
        Some(c) => c,
        None => {
            // 二进制/编码问题 → 跳过
            files_skipped.fetch_add(1, Ordering::Relaxed);
            skipped_binary.fetch_add(1, Ordering::Relaxed);
            return;
        }
    };
    files_scanned.fetch_add(1, Ordering::Relaxed);
    // 路径字符串只构造一次，命中时复用
    let path_str = path.to_string_lossy().into_owned();
    // 纯 ASCII 关键词 + 不敏感 → 字节级匹配（无逐行分配）；否则退回 to_lowercase 保证 Unicode 正确
    let ascii_fast = !case_sensitive && needle.is_ascii();
    let needle_bytes = needle.as_bytes();
    for (i, line) in content.lines().enumerate() {
        if truncated.load(Ordering::Relaxed) {
            return;
        }
        let line_no = (i + 1) as u32;
        if ascii_fast {
            let hay = line.as_bytes();
            let mut start = 0usize;
            while let Some(col) = find_ascii_ignore_case(hay, needle_bytes, start) {
                if !try_push_match(local, &path_str, line_no, line, col, query_char_len, match_count, truncated) {
                    return;
                }
                start = col + needle_bytes.len();
            }
        } else if case_sensitive {
            let mut start = 0usize;
            while let Some(pos) = line[start..].find(needle) {
                let col = start + pos;
                if !try_push_match(local, &path_str, line_no, line, col, query_char_len, match_count, truncated) {
                    return;
                }
                start = col + needle.len();
            }
        } else {
            // 非 ASCII 不敏感：整行小写化（保持 Unicode 大小写折叠正确性）
            let lower = line.to_lowercase();
            let mut start = 0usize;
            while let Some(pos) = lower[start..].find(needle) {
                let col = start + pos;
                if !try_push_match(local, &path_str, line_no, line, col, query_char_len, match_count, truncated) {
                    return;
                }
                start = col + needle.len();
            }
        }
    }
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmpdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-test-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn test_valid_project_name() {
        assert!(valid_project_name("my-project"));
        assert!(valid_project_name("我的项目"));
        assert!(valid_project_name("proj_1.2"));
        assert!(!valid_project_name(""));
        assert!(!valid_project_name(" "));
        assert!(!valid_project_name("."));
        assert!(!valid_project_name(".."));
        for bad in ["a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "a\nb"] {
            assert!(!valid_project_name(bad), "应拒绝：{bad:?}");
        }
    }

    #[test]
    fn test_create_project_basic() {
        let base = tmpdir("proj");
        let r = create_project_impl(base.to_string_lossy().to_string(), "demo".into(), false, None).unwrap();
        let root = Path::new(&r.path);
        assert!(root.is_dir());
        assert!(root.join("main.py").is_file());
        // P2（建议 1）：默认生成最小 pyproject.toml，requires-python 回退 >=3.12
        let pyproject = fs::read_to_string(root.join("pyproject.toml")).unwrap();
        assert!(pyproject.contains("name = \"demo\""));
        assert!(pyproject.contains("requires-python = \">=3.12\""));
        assert!(!root.join(".gitignore").exists()); // 未要求 git
        assert!(r.git_ok);
        // 重名 / 非法名 / 父目录不存在
        assert!(create_project_impl(base.to_string_lossy().to_string(), "demo".into(), false, None).is_err());
        assert!(create_project_impl(base.to_string_lossy().to_string(), "a/b".into(), false, None).is_err());
        assert!(create_project_impl(base.join("nope").to_string_lossy().to_string(), "x".into(), false, None).is_err());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_create_project_git_best_effort() {
        let base = tmpdir("proj-git");
        let r = create_project_impl(base.to_string_lossy().to_string(), "demo".into(), true, None).unwrap();
        let root = Path::new(&r.path);
        // .gitignore 必写；git 是否成功取决于环境（未装 git 时 git_ok=false 但项目仍创建）
        assert!(root.join(".gitignore").is_file());
        assert!(root.join("main.py").is_file());
        if r.git_ok {
            assert!(root.join(".git").exists());
        } else {
            assert!(!r.git_message.is_empty());
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_create_project_version_reflects_in_pyproject() {
        let base = tmpdir("proj-ver");
        // 选 3.13（uv spec 形式）→ requires-python 反映所选版本
        let r = create_project_impl(
            base.to_string_lossy().to_string(),
            "My Demo".into(),
            false,
            Some("cpython-3.13.7-windows-x86_64-none".into()),
        )
        .unwrap();
        let root = Path::new(&r.path);
        let pyproject = fs::read_to_string(root.join("pyproject.toml")).unwrap();
        assert!(pyproject.contains("requires-python = \">=3.13\""));
        assert!(pyproject.contains("name = \"my-demo\"")); // 非法字符折叠为 '-'
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_requires_python_and_pkg_name() {
        // 版本标识 → "3.MINOR"（uv --python 与 requires-python 共用）；无法解析 → None（调用方回退 3.12）
        assert_eq!(python_short_from(""), None);
        assert_eq!(python_short_from("3.12").as_deref(), Some("3.12"));
        assert_eq!(python_short_from("cpython-3.11.9-linux-x86_64-gnu").as_deref(), Some("3.11"));
        assert_eq!(python_short_from("garbage"), None);
        assert_eq!(sanitize_pkg_name("Hello World"), "hello-world");
        assert_eq!(sanitize_pkg_name("__init__"), "init");
        assert_eq!(sanitize_pkg_name("///"), "app");
    }

    #[test]
    fn test_search_workspace() {
        let base = tmpdir("search");
        fs::write(base.join("a.py"), "hello world\nfoo bar\nhello again\n").unwrap();
        fs::create_dir_all(base.join("pkg")).unwrap();
        fs::write(base.join("pkg").join("b.py"), "say hello\n").unwrap();
        // 忽略目录内的文件不应被扫描
        fs::create_dir_all(base.join(".venv")).unwrap();
        fs::write(base.join(".venv").join("c.py"), "hello hidden\n").unwrap();
        // 无扩展名文件也应被扫描
        fs::write(base.join("README"), "hello readme\n").unwrap();

        let r = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), false).unwrap();
        assert_eq!(r.files_scanned, 3); // a.py + pkg/b.py + README
        assert_eq!(r.matches.len(), 4); // a.py×2 + b.py×1 + README×1
        assert!(r.matches.iter().all(|m| !m.path.contains(".venv")));
        assert!(!r.truncated);
        // 行号/列号正确性（排序后 README 在 a.py 前：大写 ASCII 靠前）
        let a_py = r.matches.iter().find(|m| m.path.ends_with("a.py")).unwrap();
        assert_eq!(a_py.line, 1);
        assert_eq!(a_py.column, 1);
        assert_eq!(a_py.length, 5);

        // 大小写敏感
        let r2 = search_workspace_impl(base.to_string_lossy().to_string(), "Hello".into(), true).unwrap();
        assert_eq!(r2.matches.len(), 0);
        let r3 = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), true).unwrap();
        assert_eq!(r3.matches.len(), 4);

        // 空查询
        let r4 = search_workspace_impl(base.to_string_lossy().to_string(), "".into(), false).unwrap();
        assert_eq!(r4.matches.len(), 0);
        assert_eq!(r4.files_scanned, 0);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_search_multiline_and_column() {
        let base = tmpdir("search2");
        fs::write(base.join("x.py"), "aaa bbb aaa\nccc\n").unwrap();
        let r = search_workspace_impl(base.to_string_lossy().to_string(), "aaa".into(), false).unwrap();
        assert_eq!(r.matches.len(), 2);
        // 第二个 aaa 在第 1 行第 9 列
        let second = &r.matches[1];
        assert_eq!(second.line, 1);
        assert_eq!(second.column, 9);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_search_case_insensitive_uppercase_content() {
        // 覆盖「大写内容 + 不敏感搜索」（此前测试盲区，真实代码最常见场景）
        let base = tmpdir("search3");
        fs::write(base.join("u.py"), "Hello World\nhello again\nHELLO\nnoMatch\n").unwrap();
        // 不敏感：Hello / hello / HELLO 三处均应命中
        let r = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), false).unwrap();
        assert_eq!(r.matches.len(), 3, "不敏感搜索应命中 Hello/hello/HELLO 三处");
        assert_eq!(r.matches[0].line, 1);
        assert_eq!(r.matches[0].column, 1);
        assert_eq!(r.matches[1].line, 2);
        assert_eq!(r.matches[2].line, 3);
        // 敏感：仅第 2 行 hello 命中
        let r2 = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), true).unwrap();
        assert_eq!(r2.matches.len(), 1);
        assert_eq!(r2.matches[0].line, 2);
        fs::remove_dir_all(&base).unwrap();
    }
}
