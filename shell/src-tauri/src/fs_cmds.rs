use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

use crate::git_cmds::GIT_MISSING_PREFIX;
use crate::search_cmds::SEARCH_IGNORED_DIRS;
use crate::tool_paths::{tool_command, ENV_GIT, ENV_UV};
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
    // 大文件守卫：整读入 Monaco model 无行数上限，超大文本会整窗卡顿。
    // 超过 10 MB 直接报错（由前端 toast 呈现），而不是读入后假死。
    const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err(format!("路径是目录而非文件：{}", path));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "文件过大（{:.1} MB），超过 10 MB 上限，编辑器不支持打开",
            meta.len() as f64 / 1048576.0
        ));
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// 读取文件字节并 base64 编码（Markdown 导出 HTML 时把本地图片内联为 data URI）。
/// 图片是二进制，read_file 的 read_to_string 对非 UTF-8 会失败，故单独走字节读取。
/// P1-6（2026-09-29 review）：补大小守卫（同 read_file 范式）——此前无上限，任意大
/// 文件整读 + base64（×1.33）会撑爆内存并长时间冻结主线程；设计用途是图片内联，
/// 32 MB 足够（超出常见 RAW/视频不在导出场景）。
#[tauri::command]
pub fn read_file_base64(path: &str) -> Result<String, String> {
    const MAX_READ_BYTES: u64 = 32 * 1024 * 1024;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err(format!("路径是目录而非文件：{}", path));
    }
    if meta.len() > MAX_READ_BYTES {
        return Err(format!(
            "文件过大（{:.1} MB），超过 32 MB 上限，无法内联为 data URI",
            meta.len() as f64 / 1048576.0
        ));
    }
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

// ---------- 启动恢复终态（last-session）----------
//
// 「关闭所有工作区后重启仍自动恢复」的修复：启动恢复不再盲取 recents[0]，而是读
// <data_root>/config/last-session.json 里记录的「上次会话终态」：
//   {"open": true,  "workspace": "D:\\proj"}   上次退出时仍有工作区 → 恢复它
//   {"open": false}                            上次「关闭工作区」后退出 → 保持欢迎页
// recent-workspaces.json（菜单「最近的工作区」）语义不变——它是历史列表，不是恢复依据。

/// 上次会话终态：open=false 表示用户明确关闭过工作区（启动不再自动恢复）
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LastSession {
    /// 上次退出时是否有已打开的工作区
    pub open: bool,
    /// 工作区绝对路径（open=false 时缺省）
    #[serde(default)]
    pub workspace: Option<String>,
}

fn last_session_path() -> PathBuf {
    opencharm_home().join("config").join("last-session.json")
}

/// 读取上次会话终态；文件不存在（首启 / 旧版本升级）返回 None = 沿用 recents 恢复（向后兼容）
#[tauri::command]
pub fn get_last_session() -> Result<Option<LastSession>, String> {
    let p = last_session_path();
    if !p.exists() {
        return Ok(None);
    }
    let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let v: LastSession = serde_json::from_str(&s).map_err(|e| e.to_string())?;
    // 防护：记录的工作区目录已被删除 → 视同未打开（恢复无意义，前端免校验）
    if v.open && v.workspace.as_deref().map_or(true, |ws| !Path::new(ws).is_dir()) {
        return Ok(Some(LastSession { open: false, workspace: None }));
    }
    Ok(Some(v))
}

/// 写入上次会话终态：openWorkspace 成功后记 (true, root)；closeWorkspace 后记 (false, None)。
/// **label 守卫**（与 window_mgr::report_main_workspace 对称）：last-session 语义是
/// 「主窗口的上次终态」——项目窗口的 openWorkspace/closeWorkspace 同样会走到 main.ts
/// 的本调用，不守卫会污染（主窗口开 A、项目窗口开 B → 终态变 B，重启后主窗口恢复错工作区）。
#[tauri::command]
pub fn set_last_session(window: tauri::WebviewWindow, open: bool, workspace: Option<String>) -> Result<(), String> {
    if window.label() != "main" {
        return Ok(()); // 项目窗口的生命周期不反映主窗口的启动恢复意图
    }
    let dir = opencharm_home().join("config");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let v = LastSession { open, workspace };
    let payload = serde_json::to_string(&v).map_err(|e| e.to_string())?;
    fs::write(last_session_path(), payload).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- 启动参数（文件关联 / 命令行文件参数）----------
//
// 「双击 md 却恢复上次工作区」的修复：资源管理器双击关联文件 = `opencharm.exe D:\x\note.md`。
// 启动时提取 argv 里第一个「存在的文件」路径交给前端（openSingleFile 链路：探测项目根 →
// openWorkspace → 定位文件），优先级高于恢复最近工作区。
// 注意 tauri run() 自身会吞掉非 flag 的位置参数（如 `--flag`），这里只挑「存在的文件」，
// 不会误把 --remote-debugging-port 之类的 flag 当路径。

/// 提取启动参数中第一个存在的文件路径（单文件打开入口，文件关联用）。
/// 找不到（正常双击 exe 启动）返回 None。
#[tauri::command]
pub fn get_startup_file() -> Result<Option<String>, String> {
    Ok(extract_startup_file(&std::env::args().skip(1).collect::<Vec<_>>()))
}

/// argv → 启动文件的提取纯函数（get_startup_file 与 window_mgr 单实例路由共用）。
/// 只挑「存在的文件」：`is_file` 判定天然滤过 `--flag` 参数与不存在的路径；
/// **排除 exe 自身**（single-instance 回调转发的是完整 argv 含 argv[0]=exe 路径，
/// 不排除会把 exe 当启动文件——真机 SI-2c/SI-3b 实锤过）。
pub(crate) fn extract_startup_file(argv: &[String]) -> Option<String> {
    let exe = std::env::current_exe().ok();
    argv.iter()
        .find(|a| {
            Path::new(a).is_file()
                && exe.as_ref().map_or(true, |e| !same_file::is_same_file(a, e).unwrap_or(false))
        })
        .cloned()
}

#[cfg(test)]
mod extract_startup_file_tests {
    use super::*;

    #[test]
    fn skips_exe_path_and_flags_and_missing_paths() {
        // exe 路径（argv[0]）与 flag、不存在的路径都不是启动文件
        let exe = std::env::current_exe().unwrap().to_string_lossy().to_string();
        let argv = vec![exe.clone(), "--flag".to_string(), exe];
        assert_eq!(extract_startup_file(&argv), None);
        assert_eq!(extract_startup_file(&["--remote-debugging-port=9223".into()]), None);
        // 不存在的路径不算
        assert_eq!(extract_startup_file(&["D:\\definitely\\not\\here\\x.py".into()]), None);
    }

    #[test]
    fn picks_first_existing_non_exe_file() {
        // 本源文件在编译期必然存在：env!("CARGO_MANIFEST_DIR") 定位
        let src = concat!(env!("CARGO_MANIFEST_DIR"), "\\src\\fs_cmds.rs");
        assert!(Path::new(src).is_file());
        let exe = std::env::current_exe().unwrap().to_string_lossy().to_string();
        assert_eq!(
            extract_startup_file(&[exe, "--flag".into(), src.to_string()]),
            Some(src.to_string())
        );
    }
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

/// 打开文件夹选择对话框（返回所选路径或 null）。
/// TD-027 B2：recv 移入 spawn_blocking——对话框打开期间阻塞的是 blocking 线程池，
/// 不再占用 tokio worker（用户挂着对话框不关，worker 不会被卡住）。
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.clone().dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder.map(|p| p.to_string()));
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// 打开单文件选择对话框（返回所选路径或 null）。
/// stdin 重定向（S1）选输入文件用；与 pick_folder 同构，仅换成 pick_file。
#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    app.clone().dialog().file().pick_file(move |file| {
        let _ = tx.send(file.map(|p| p.to_string()));
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

// ---------- 单文件打开（docs/open_file_dev_plan.md 批 1） ----------

/// 项目根探测的向上层数上限（docs/open_file_dev_plan.md §1.1）。
/// 防「home 目录被 git init 过」把整个用户目录当工作区。
const PROJECT_ROOT_MAX_DEPTH: usize = 4;

/// Python 项目根标记：目录的直接子项命中即视为该目录为项目根。
const PY_ROOT_MARKERS: [&str; 4] = ["pyproject.toml", "setup.py", ".venv", "venv"];

/// find_project_root 的纯逻辑内核（可单测；不碰 fs 的路径拼接与回退规则）。
///
/// 规则（分语言，见计划 §1.1）：
/// - `.py` / `.pyw`：向上找 PY_ROOT_MARKERS（pyproject.toml / setup.py / .venv / venv）；
/// - 其余（含 .md）：向上找 `.git`（笔记仓库以仓库为上下文）；
/// - 探测深度上限 PROJECT_ROOT_MAX_DEPTH；
/// - 未命中任何标记 → 回退文件所在目录。
fn detect_project_root_impl(file_path: &str, is_python: bool, dir_exists: &dyn Fn(&Path) -> bool) -> String {
    let file = Path::new(file_path);
    // 文件名本身不是目录候选；从父目录开始逐级向上
    let Some(start) = file.parent().map(|p| p.to_path_buf()) else {
        return file_path.to_string();
    };
    let mut dir = start.clone();
    let markers: &[&str] = if is_python { &PY_ROOT_MARKERS } else { &[".git"] };
    for _ in 0..PROJECT_ROOT_MAX_DEPTH {
        for m in markers {
            if dir_exists(&dir.join(m)) {
                return dir.to_string_lossy().to_string();
            }
        }
        if !dir.pop() {
            break;
        }
    }
    // 未命中：回退文件所在目录（循环已把 dir 弹到上层，不能用 dir 本身）
    start.to_string_lossy().to_string()
}

/// 单文件打开前的项目根探测（docs/open_file_dev_plan.md §1.1）。
/// 返回（项目根, 是否为回退值）——回退时前端不把探测根当作「项目」登记语义提示。
#[tauri::command]
pub fn find_project_root(file_path: &str) -> Result<(String, bool), String> {
    let p = Path::new(file_path);
    if !p.is_file() {
        return Err(format!("路径不是文件：{}", file_path));
    }
    let lower = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let is_python = lower == "py" || lower == "pyw";
    let root = detect_project_root_impl(file_path, is_python, &|d: &Path| d.exists());
    let fallback = root == p.parent().map(|d| d.to_string_lossy().to_string()).unwrap_or_default();
    Ok((root, fallback))
}

/// 工作区是否含 Python 文件（open_file_dev_plan §1.2：纯 md / 无 py 工作区跳过静态引擎）。
/// 复用 collect_files_glob 的 `*.py` 掩码走查（.gitignore 感知 + 噪声剪枝），首个命中即返回——
/// 大仓库不比 list_workspace_files 多花一分时间（早退，最多走查到第一个 .py 为止）。
/// async + spawn_blocking：与 list_workspace_files 同纪律（大仓库遍历可能耗时）。
#[tauri::command]
pub async fn workspace_has_python(root: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || workspace_has_python_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn workspace_has_python_impl(root: &str) -> Result<bool, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let mut builder = ignore::WalkBuilder::new(root_path);
    builder
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            !SEARCH_IGNORED_DIRS.contains(&name.as_str())
        });
    let mut ov = ignore::overrides::OverrideBuilder::new(root_path);
    ov.add("*.py").map_err(|e| format!("文件掩码无效：{e}"))?;
    builder.overrides(ov.build().map_err(|e| format!("文件掩码无效：{e}"))?);
    for entry in builder.build() {
        if let Ok(entry) = entry {
            if entry.file_type().map_or(false, |ft| ft.is_file()) {
                return Ok(true); // 早退：只需要「有没有」
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod find_project_root_tests {
    use super::*;
    use std::collections::HashSet;

    /// 内存文件系统模拟（测试 dir_exists 回调）：只记录存在哪些目录。
    fn mk_exists<'a>(existing: &'a [&'a str]) -> impl Fn(&Path) -> bool + 'a {
        let set: HashSet<String> = existing.iter().map(|s| s.to_string()).collect();
        move |d: &Path| set.contains(&d.to_string_lossy().to_string())
    }

    #[test]
    fn py_file_finds_pyproject_ancestor() {
        // D:\proj\pyproject.toml；文件在 D:\proj\src\a.py → 根 = D:\proj
        let f = mk_exists(&["D:\\proj\\pyproject.toml"]);
        assert_eq!(
            detect_project_root_impl("D:\\proj\\src\\a.py", true, &f),
            "D:\\proj"
        );
    }

    #[test]
    fn py_file_finds_venv_in_parent() {
        let f = mk_exists(&["D:\\proj\\.venv"]);
        assert_eq!(
            detect_project_root_impl("D:\\proj\\pkg\\mod.py", true, &f),
            "D:\\proj"
        );
    }

    #[test]
    fn md_file_finds_git_repo_root() {
        // md 找 .git（笔记仓库）；pyproject 对 md 无意义，即使存在也不认
        let f = mk_exists(&["D:\\notes\\.git", "D:\\notes\\pyproject.toml"]);
        assert_eq!(
            detect_project_root_impl("D:\\notes\\sub\\readme.md", false, &f),
            "D:\\notes"
        );
    }

    #[test]
    fn md_file_ignores_pyproject() {
        let f = mk_exists(&["D:\\notes\\pyproject.toml"]);
        assert_eq!(
            detect_project_root_impl("D:\\notes\\readme.md", false, &f),
            "D:\\notes" // 回退：文件所在目录
        );
    }

    #[test]
    fn depth_limit_stops_at_4_levels() {
        // .git 在 5 层之上：不应被认作根（回退文件所在目录）
        let f = mk_exists(&["D:\\home\\.git"]);
        assert_eq!(
            detect_project_root_impl("D:\\home\\a\\b\\c\\d\\x.py", true, &f),
            "D:\\home\\a\\b\\c\\d"
        );
    }

    #[test]
    fn no_marker_falls_back_to_file_dir() {
        let f = mk_exists(&[]);
        assert_eq!(
            detect_project_root_impl("D:\\tmp\\note.md", false, &f),
            "D:\\tmp"
        );
    }

    #[test]
    fn nearest_marker_wins() {
        // 内层 src/.venv 与外层 proj/pyproject.toml 都在——逐级向上，先撞内层
        let f = mk_exists(&["D:\\proj\\src\\.venv", "D:\\proj\\pyproject.toml"]);
        assert_eq!(
            detect_project_root_impl("D:\\proj\\src\\main.py", true, &f),
            "D:\\proj\\src"
        );
    }
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
    // 与 git_cmds::exec_git 同款分类码：spawn 失败 = 没装 Git（前端据此提示安装而非「初始化失败」）
    let out = no_window(&mut cmd)
        .output()
        .map_err(|e| format!("{GIT_MISSING_PREFIX}无法启动 git（可能未安装）：{e}"))?;
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

/// 写入最小 pyproject.toml（方案 B，回退路径）：仅 [project] 元数据 + 依赖列表，
/// 任何工具链都认、不含 IDE 私有配置。供 create_project 与 env_cmds::init_pyproject 共用。
/// deps 非空时写入 dependencies（F9 新建 FastAPI 项目：fastapi / uvicorn）。
pub(crate) fn write_min_pyproject(root: &Path, name: &str, requires_python: &str, deps: &[&str]) -> std::io::Result<()> {
    let pkg = sanitize_pkg_name(name);
    let deps_line = if deps.is_empty() {
        "dependencies = []".to_string()
    } else {
        let items: Vec<String> = deps.iter().map(|d| format!("\"{d}\"")).collect();
        format!("dependencies = [{}]", items.join(", "))
    };
    let content = format!(
        "[project]\nname = \"{pkg}\"\nversion = \"0.1.0\"\nrequires-python = \"{requires_python}\"\n{deps_line}\n"
    );
    fs::write(root.join("pyproject.toml"), content)
}

/// `name` 是否为 TOML 独立字段（`name = "..."`），而非 `names` / `name_suffix` 等同前缀键
fn is_name_field(t: &str) -> bool {
    let Some(rest) = t.strip_prefix("name") else {
        return false;
    };
    rest.starts_with('=') || rest.starts_with(' ') || rest.starts_with('\t')
}

/// tech-debt #12：uv init 生成的 `[project].name` 按其自身规则（目录名）归一，与方案 B 的
/// `sanitize_pkg_name` 口径可能不同（特殊字符 / 首尾分隔符）。生成后校验并改写为
/// `sanitize_pkg_name` 结果，使方案 A / B 的 name 口径一致。
/// 用字符串行扫描改写（不引入 TOML 解析依赖）；找不到 `[project].name` 或 IO 失败时静默不写。
fn normalize_project_name(root: &Path, expected: &str) -> std::io::Result<()> {
    let path = root.join("pyproject.toml");
    let content = fs::read_to_string(&path)?;
    let target = sanitize_pkg_name(expected);
    let mut out: Vec<String> = Vec::with_capacity(content.lines().count() + 1);
    let mut in_project = false;
    let mut replaced = false;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            in_project = t == "[project]";
            out.push(line.to_string());
            continue;
        }
        if in_project && !replaced && is_name_field(t) {
            let leading = &line[..line.len() - line.trim_start().len()];
            out.push(format!("{leading}name = \"{target}\""));
            replaced = true;
            continue;
        }
        out.push(line.to_string());
    }
    if replaced {
        fs::write(&path, out.join("\n"))?;
    }
    Ok(())
}

/// F9（方案 A 路径依赖注入）：`uv init --bare` 生成的 pyproject.toml（实测 uv 0.10.11 产物
/// 为 `[project]` 段 + `dependencies = []` 单行）里写入指定依赖。行扫描实现（复刻
/// `normalize_project_name` 先例，不引 TOML 依赖）：
/// - `[project]` 段内已有 `dependencies = [...]` 行 → 原样跳过（幂等，uv 未来产物变化天然兼容）；
/// - 只有空 `dependencies = []` 行 → 替换为 `dependencies = ["fastapi", "uvicorn"]`；
/// - 无 dependencies 键 → 在 `[project]` 段末尾（下一个 `[` 段之前）插行；
/// - 无 `[project]` 段或 IO 失败 → 静默不写（调用方 best-effort，不阻断创建）。
fn inject_project_deps(root: &Path, deps: &[&str]) -> std::io::Result<()> {
    if deps.is_empty() {
        return Ok(());
    }
    let path = root.join("pyproject.toml");
    let content = fs::read_to_string(&path)?;
    let items: Vec<String> = deps.iter().map(|d| format!("\"{d}\"")).collect();
    let deps_line = format!("dependencies = [{}]", items.join(", "));
    let mut out: Vec<String> = Vec::with_capacity(content.lines().count() + 1);
    let mut in_project = false;
    let mut written = false;
    for line in content.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            // 离开 [project] 段且尚未写入 → 在段末插入（本行之前）
            if in_project && !written {
                out.push(deps_line.clone());
                written = true;
            }
            in_project = t == "[project]";
            out.push(line.to_string());
            continue;
        }
        if in_project && t.starts_with("dependencies") && t.contains('=') {
            // 已有 dependencies 键：空数组（uv init --bare 产物主路径）→ 替换为目标依赖；
            // 非空（防御分支，全新目录理论上不出现）→ 原样保留，不覆盖已有内容（uv add 兜底同步）。
            if !written {
                let val = t.split_once('=').map(|(_, v)| v.trim()).unwrap_or("");
                out.push(if val == "[]" { deps_line.clone() } else { line.to_string() });
                written = true;
            }
            continue;
        }
        out.push(line.to_string());
    }
    if in_project && !written {
        out.push(deps_line.clone());
    }
    let mut new_content = out.join("\n");
    if content.ends_with('\n') && !new_content.ends_with('\n') {
        new_content.push('\n');
    }
    fs::write(&path, new_content)
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
/// deps：额外写入 dependencies 的依赖（F9 新建 FastAPI 项目用；两条路径都要注入）。
pub(crate) fn ensure_pyproject(
    root: &Path,
    name: &str,
    python_arg: Option<String>,
    fallback_requires: &str,
    deps: &[&str],
) -> (bool, String) {
    let deps_note = if deps.is_empty() {
        String::new()
    } else {
        format!("，并写入 {} 依赖", deps.join(" / "))
    };
    match uv_init_bare(root, python_arg.as_deref()) {
        Ok(()) => {
            // tech-debt #12：改写 name 使与方案 B 口径一致（失败静默，不阻断生成）
            let _ = normalize_project_name(root, name);
            // F9：方案 A 产物里注入依赖（失败静默——uv add 安装时兜底同步，闭环不破）
            let _ = inject_project_deps(root, deps);
            (true, format!("已用 uv init --bare 生成 pyproject.toml{deps_note}"))
        }
        Err(e) => match write_min_pyproject(root, name, fallback_requires, deps) {
            Ok(()) => (
                false,
                format!("uv 不可用（{e}），已写入最小 pyproject.toml 模板（requires-python = \"{fallback_requires}\"{deps_note}）"),
            ),
            Err(we) => (false, format!("生成 pyproject.toml 失败：{we}")),
        },
    }
}

/// 新建项目：parent_dir/name 下创建 main.py 入口 + 最小 pyproject.toml；git_init 时附 .gitignore 并初始化仓库。
/// .venv 创建复用既有 create_venv 命令（前端在打开工作区后调用，输出流式可见）。
/// python_version：创建向导所选版本（uv spec 或版本号，可空），用于 pyproject 的 requires-python。
/// project_type：项目类型（F9）——"fastapi" 生成 FastAPI 模板 main.py 并把 fastapi/uvicorn
/// 写入 pyproject dependencies；None / 空 / "script" 为默认脚本模板（旧调用零感知）。
/// async + spawn_blocking：git init 子进程可能耗时，同步 command 会卡死主线程 UI。
#[tauri::command]
pub async fn create_project(
    parent_dir: String,
    name: String,
    git_init: bool,
    python_version: Option<String>,
    project_type: Option<String>,
) -> Result<CreateProjectResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_project_impl(parent_dir, name, git_init, python_version, project_type)
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

/// F9：FastAPI 模板 main.py。设计依据（调研报告 §8.3.1）：
/// - `app = FastAPI(` 命中 detect_framework 探针的 scan_app_decl；
/// - 两条路由让端点视图开箱有内容（`{item_id}` 顺带演示路径参数）；
/// - 注解驱动契合静态引擎；`str | None` 需 3.10+（默认 requires-python >= 3.12 已满足）。
const FASTAPI_MAIN_PY: &str = "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/\")\ndef root() -> str:\n    return \"Hello from OpenCharm FastAPI!\"\n\n\n@app.get(\"/items/{item_id}\")\ndef read_item(item_id: int, q: str | None = None) -> dict:\n    return {\"item_id\": item_id, \"q\": q}\n";

/// F9：FastAPI 项目的 pyproject dependencies（uvicorn 为 uv add 的服务依赖）。
const FASTAPI_PROJECT_DEPS: &[&str] = &["fastapi", "uvicorn"];

fn create_project_impl(
    parent_dir: String,
    name: String,
    git_init: bool,
    python_version: Option<String>,
    project_type: Option<String>,
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

    // F9：按项目类型切换 main.py 模板（fastapi / 默认脚本）
    let is_fastapi = project_type.as_deref() == Some("fastapi");
    let main_py = if is_fastapi {
        FASTAPI_MAIN_PY
    } else {
        "def main() -> None:\n    print(\"Hello from OpenCharm!\")\n\n\nif __name__ == \"__main__\":\n    main()\n"
    };
    fs::write(root.join("main.py"), main_py).map_err(|e| e.to_string())?;

    // P2（建议 1）：默认生成 pyproject.toml，让 uv run / 依赖管理语义明确（对应痛点①）。
    // 方案 A（uv init --bare）为主、方案 B（最小模板）兜底：既用官方脚手架，又保证
    // “创建永不因 uv 缺席而失败”（§9）。requires-python 反映创建向导所选版本；未选版本时统一
    // 显式传 3.12 下限，避免 uv 依机器默认解释器产出不确定结果（两条路径产出一致）。
    let python_arg = python_short_from(python_version.as_deref().unwrap_or(""))
        .unwrap_or_else(|| "3.12".to_string());
    let requires_python = format!(">={python_arg}");
    let deps: &[&str] = if is_fastapi { FASTAPI_PROJECT_DEPS } else { &[] };
    let (_used_uv, pyproject_note) = ensure_pyproject(&root, &name, Some(python_arg), &requires_python, deps);

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

// ---------- Scratch 文件（P2：PyCharm Scratch 对标） ----------

/// 草稿目录：`<data_root>/scratches/`——刻意放在**数据根而非工作区**里：
/// 草稿的定义就是「不入库、不污染项目」，放工作区迟早会被误提交或误删。
fn scratch_dir() -> PathBuf {
    opencharm_home().join("scratches")
}

/// 在给定目录下创建下一个空闲编号的草稿文件（纯逻辑，可在单测里锁定）
fn create_scratch_in(dir: &Path, ext: &str) -> Result<PathBuf, String> {
    let ext = if ext.starts_with('.') { ext.to_string() } else { format!(".{ext}") };
    for i in 1..1000 {
        // 编号对**所有扩展名**共享（scratch-1.py 之后是 scratch-2.md 而不是又一个 1），
        // 否则同一个编号会对应多个草稿，列表里没法分辨。
        let prefix = format!("scratch-{i}.");
        let taken = fs::read_dir(dir)
            .ok()
            .map(|rd| rd.flatten().any(|e| e.file_name().to_string_lossy().starts_with(&prefix)))
            .unwrap_or(false);
        if taken {
            continue;
        }
        let p = dir.join(format!("scratch-{i}{ext}"));
        if !p.exists() {
            // Python 草稿给个可直接跑的骨架（含 __main__ 守卫，与「运行当前文件」的守卫行判定对齐）
            let body = if ext == ".py" || ext == ".pyw" {
                "# OpenCharm 草稿（不入库，可直接运行 / 调试）\n\n\ndef main() -> None:\n    pass\n\n\nif __name__ == \"__main__\":\n    main()\n"
            } else {
                ""
            };
            fs::write(&p, body).map_err(|e| format!("创建草稿失败：{e}"))?;
            return Ok(p);
        }
    }
    Err("草稿文件过多（已到 scratch-999），请清理草稿目录后再试".into())
}

/// 新建一个草稿文件，返回其绝对路径。ext 缺省 ".py"。
#[tauri::command]
pub fn create_scratch(ext: Option<String>) -> Result<String, String> {
    let dir = scratch_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建草稿目录失败：{e}"))?;
    let ext = ext.as_deref().unwrap_or(".py");
    let p = create_scratch_in(&dir, ext)?;
    Ok(p.to_string_lossy().into_owned())
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
    fn test_read_file_rejects_oversized_and_dir() {
        let dir = tmpdir("readguard");
        // 超过 10 MB 上限：报「文件过大」而非整读卡死
        let big = dir.join("big.txt");
        fs::write(&big, vec![b'a'; 10 * 1024 * 1024 + 1]).unwrap();
        let err = read_file(big.to_str().unwrap()).unwrap_err();
        assert!(err.contains("文件过大"), "实际错误：{err}");
        // 目录路径：明确报错而非 io 错误裸串
        let err = read_file(dir.to_str().unwrap()).unwrap_err();
        assert!(err.contains("目录"), "实际错误：{err}");
        // 正常小文件照常可读
        let ok = dir.join("ok.txt");
        fs::write(&ok, "hello").unwrap();
        assert_eq!(read_file(ok.to_str().unwrap()).unwrap(), "hello");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_normalize_project_name() {
        let dir = tmpdir("pkgname");
        // 模拟 uv init --bare 生成的 pyproject：name 按 uv 口径（保留空格/大小写）
        fs::write(
            dir.join("pyproject.toml"),
            "[project]\nname = \"My Proj\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        normalize_project_name(&dir, "My Proj").unwrap();
        let content = fs::read_to_string(dir.join("pyproject.toml")).unwrap();
        assert!(content.contains("name = \"my-proj\""), "实际内容：{content}");

        // 非 [project] 段的 name（如 [tool.uv]）不被误改
        fs::write(
            dir.join("pyproject.toml"),
            "[project]\nname = \"ok\"\n[tool.uv]\nname = \"keep\"\n",
        )
        .unwrap();
        normalize_project_name(&dir, "ok").unwrap();
        let content2 = fs::read_to_string(dir.join("pyproject.toml")).unwrap();
        assert!(content2.contains("name = \"ok\""), "实际内容：{content2}");
        assert!(content2.contains("name = \"keep\""), "实际内容：{content2}");

        fs::remove_dir_all(dir).unwrap();
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
        let r = create_project_impl(base.to_string_lossy().to_string(), "demo".into(), false, None, None).unwrap();
        let root = Path::new(&r.path);
        assert!(root.is_dir());
        assert!(root.join("main.py").is_file());
        // P2（建议 1）：默认生成最小 pyproject.toml，requires-python 回退 >=3.12
        let pyproject = fs::read_to_string(root.join("pyproject.toml")).unwrap();
        assert!(pyproject.contains("name = \"demo\""));
        assert!(pyproject.contains("requires-python = \">=3.12\""));
        assert!(!root.join(".gitignore").exists()); // 未要求 git
        assert!(r.git_ok);
        // script 默认：main.py 是脚本模板（不含 FastAPI），pyproject 无 fastapi 依赖
        let main_py = fs::read_to_string(root.join("main.py")).unwrap();
        assert!(main_py.contains("def main()"), "实际内容：{main_py}");
        assert!(!main_py.contains("FastAPI"));
        assert!(!pyproject.contains("fastapi"));
        // 重名 / 非法名 / 父目录不存在
        assert!(create_project_impl(base.to_string_lossy().to_string(), "demo".into(), false, None, None).is_err());
        assert!(create_project_impl(base.to_string_lossy().to_string(), "a/b".into(), false, None, None).is_err());
        assert!(create_project_impl(base.join("nope").to_string_lossy().to_string(), "x".into(), false, None, None).is_err());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_create_project_git_best_effort() {
        let base = tmpdir("proj-git");
        let r = create_project_impl(base.to_string_lossy().to_string(), "demo".into(), true, None, None).unwrap();
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
            None,
        )
        .unwrap();
        let root = Path::new(&r.path);
        let pyproject = fs::read_to_string(root.join("pyproject.toml")).unwrap();
        assert!(pyproject.contains("requires-python = \">=3.13\""));
        assert!(pyproject.contains("name = \"my-demo\"")); // 非法字符折叠为 '-'
        fs::remove_dir_all(&base).unwrap();
    }

    /// F9：fastapi 类型 → FastAPI 模板 main.py + pyproject 写入 fastapi/uvicorn 依赖。
    /// 断言**路径无关**（contains 而非精确全文比对）：CI 有无 uv 走方案 A/B 均过——
    /// 方案 A（uv init --bare 产物 + 行扫描注入）与方案 B（最小模板直接带 deps）的
    /// pyproject 具体行序/备注可能不同，但两个关键契约（模板形状 + 依赖存在）必须都满足。
    #[test]
    fn test_create_project_fastapi_template_and_deps() {
        let base = tmpdir("proj-fa");
        let r = create_project_impl(
            base.to_string_lossy().to_string(),
            "demo-api".into(),
            false,
            None,
            Some("fastapi".into()),
        )
        .unwrap();
        let root = Path::new(&r.path);
        // main.py：FastAPI 模板（app = FastAPI( 命中探针 scan_app_decl；两条路由命中端点扫描）
        let main_py = fs::read_to_string(root.join("main.py")).unwrap();
        assert!(main_py.contains("from fastapi import FastAPI"), "实际内容：{main_py}");
        assert!(main_py.contains("app = FastAPI("), "实际内容：{main_py}");
        assert!(main_py.contains("@app.get(\"/\")"), "实际内容：{main_py}");
        assert!(main_py.contains("@app.get(\"/items/{item_id}\")"), "实际内容：{main_py}");
        // pyproject：依赖写入（两条生成路径都要注入）
        let pyproject = fs::read_to_string(root.join("pyproject.toml")).unwrap();
        assert!(pyproject.contains("\"fastapi\""), "实际内容：{pyproject}");
        assert!(pyproject.contains("\"uvicorn\""), "实际内容：{pyproject}");
        fs::remove_dir_all(&base).unwrap();
    }

    /// F9 边界：未知 project_type 按脚本模板处理（None / 空 / "script" 等价）
    #[test]
    fn test_create_project_unknown_type_falls_back_to_script() {
        let base = tmpdir("proj-unknown");
        for (i, t) in [None, Some(""), Some("script"), Some("django")].into_iter().enumerate() {
            let r = create_project_impl(
                base.to_string_lossy().to_string(),
                format!("p-{i}").into(),
                false,
                None,
                t.map(String::from),
            )
            .unwrap();
            let main_py = fs::read_to_string(Path::new(&r.path).join("main.py")).unwrap();
            assert!(main_py.contains("def main()"), "type={t:?} 应回退脚本模板：{main_py}");
        }
        fs::remove_dir_all(&base).unwrap();
    }

    /// F9：方案 A 路径依赖注入（行扫描）——空 dependencies 行替换 / 已有键跳过 / 无键段末插入
    #[test]
    fn test_inject_project_deps_line_scan() {
        // ① uv init --bare 实测产物：空 dependencies = [] → 替换
        let dir = tmpdir("inj-empty");
        fs::write(
            dir.join("pyproject.toml"),
            "[project]\nname = \"demo\"\nversion = \"0.1.0\"\nrequires-python = \">=3.12\"\ndependencies = []\n",
        )
        .unwrap();
        inject_project_deps(&dir, &["fastapi", "uvicorn"]).unwrap();
        let c = fs::read_to_string(dir.join("pyproject.toml")).unwrap();
        assert!(c.contains("dependencies = [\"fastapi\", \"uvicorn\"]"), "实际内容：{c}");
        assert_eq!(c.matches("dependencies").count(), 1, "旧空行应被替换而非并存：{c}");
        fs::remove_dir_all(dir).unwrap();

        // ② 已有 dependencies 键（含值）→ 跳过（幂等：不合并、不重复）
        let dir2 = tmpdir("inj-skip");
        fs::write(
            dir2.join("pyproject.toml"),
            "[project]\nname = \"demo\"\ndependencies = [\"httpx\"]\n[tool.uv]\n\n[build-system]\nrequires = [\"hatchling\"]\n",
        )
        .unwrap();
        inject_project_deps(&dir2, &["fastapi"]).unwrap();
        let c2 = fs::read_to_string(dir2.join("pyproject.toml")).unwrap();
        assert!(c2.contains("dependencies = [\"httpx\"]"), "实际内容：{c2}");
        assert!(!c2.contains("fastapi"), "已有键应跳过注入：{c2}");
        // 其他段（含同样以 requires 开头的 [build-system] 键）不受影响
        assert!(c2.contains("[tool.uv]"));
        assert!(c2.contains("requires = [\"hatchling\"]"), "build-system 的 requires 不得误伤：{c2}");
        fs::remove_dir_all(dir2).unwrap();

        // ③ 无 dependencies 键 → [project] 段末尾、下一个 [ 段之前插入
        let dir3 = tmpdir("inj-append");
        fs::write(
            dir3.join("pyproject.toml"),
            "[project]\nname = \"demo\"\nversion = \"0.1.0\"\n\n[tool.uv]\npackage = false\n",
        )
        .unwrap();
        inject_project_deps(&dir3, &["fastapi", "uvicorn"]).unwrap();
        let c3 = fs::read_to_string(dir3.join("pyproject.toml")).unwrap();
        let proj_end = c3.find("[tool.uv]").unwrap();
        let deps_at = c3.find("dependencies = [\"fastapi\", \"uvicorn\"]").expect("应已插入");
        assert!(deps_at < proj_end, "应插在 [project] 段内：{c3}");
        assert!(c3.contains("package = false"), "后段内容不丢：{c3}");
        fs::remove_dir_all(dir3).unwrap();

        // ④ [project] 是最后一个段（无后续 [）→ 段末追加
        let dir4 = tmpdir("inj-tail");
        fs::write(dir4.join("pyproject.toml"), "[project]\nname = \"demo\"\n").unwrap();
        inject_project_deps(&dir4, &["fastapi"]).unwrap();
        let c4 = fs::read_to_string(dir4.join("pyproject.toml")).unwrap();
        assert!(c4.contains("dependencies = [\"fastapi\"]"), "实际内容：{c4}");
        fs::remove_dir_all(dir4).unwrap();
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
    fn create_scratch_picks_next_free_number() {
        let d = tmpdir("scratch");
        let a = create_scratch_in(&d, ".py").unwrap();
        assert_eq!(a.file_name().unwrap().to_string_lossy(), "scratch-1.py");
        // .py 草稿带可直接运行的骨架（含 __main__ 守卫）
        let body = fs::read_to_string(&a).unwrap();
        assert!(body.contains("if __name__"));
        let b = create_scratch_in(&d, "py").unwrap(); // 无点前缀也应补上
        assert_eq!(b.file_name().unwrap().to_string_lossy(), "scratch-2.py");
        let c = create_scratch_in(&d, ".md").unwrap();
        assert_eq!(c.file_name().unwrap().to_string_lossy(), "scratch-3.md");
        assert_eq!(fs::read_to_string(&c).unwrap(), ""); // 非 Python 草稿是空文件
        fs::remove_dir_all(&d).unwrap();
    }
}
