// 文件系统监听（File Watcher）：notify crate 监听工作区变更，推送事件到前端增量刷新。
// 设计要点：
// - 使用 notify-debouncer-mini 做 300ms 防抖，避免批量操作（如 git checkout）触发风暴；
// - 过滤 .git/.venv/node_modules 等噪声目录；
// - 前端收到事件后只刷新受影响的目录（增量），不整树重载。

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEvent, Debouncer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

use crate::per_window::PerWindow;
use crate::util::opencharm_home;

/// dep 域失效信号（M2，docs/dep_health_dev_plan.md §4.4）：变更文件的相对路径 + 分层分类。
/// 与 `fs-changed`（只发父目录，服务树/git 增量刷新）分开——depHealth 需要**文件级**信息
/// 才能区分「代码层 .py」与「声明层 pyproject/requirements/uv.lock」，进而决定重算范围。
#[derive(Clone, Serialize)]
pub struct DepFileEvent {
    /// 相对工作区根的路径（正斜杠）
    pub path: String,
    /// "py"（代码层）/ "declaration"（声明层）；"other" 不发（无 dep 意义，减噪）
    pub kind: String,
}

/// 忽略的目录名（与 fs_cmds::read_dir 的 IGNORED 保持一致）
const WATCH_IGNORED: [&str; 6] = [".git", ".venv", "node_modules", "__pycache__", ".idea", ".vscode"];

/// 忽略的文件名前缀（CR-05：选区运行临时文件，写删都不触发树刷新/Git 幽灵变更）
const WATCH_IGNORED_PREFIXES: [&str; 1] = ["__opencharm_selection__"];

/// 全局 watcher 实例（同一时刻只监听一个工作区）。
/// TD-029①：包一层 Arc<Mutex<_>>——回调线程要为「运行期新建的顶层目录」动态补订阅，
/// 必须能从回调里拿到 watcher；用 `try_lock` 取不到就跳过（绝不阻塞、绝不死锁）。
static WATCHER: LazyLock<PerWindow<Arc<Mutex<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>>> =
    LazyLock::new(PerWindow::new);

/// 去抖 watcher 的具体类型（插件目录等复用方要用它存实例，故显式别名）
pub type DirWatcher = Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

/// **唯一**的 debouncer 装配入口（TD-029③）：此前工作区监听与插件目录监听各写一份
/// `new_debouncer(...)` + 错误吞掉 + 实例存放，忽略/健康度口径随时会漂。
/// 统一后所有目录监听共用：去抖时长可调、**运行期错误一律转 `fs-watch-health`**（不再静默失效）。
/// `targets`：`(路径, 是否递归)`。错误**交回调用方**（工作区监听转 fs-watch-health，
/// 插件目录同样转发），由调用方按自己的语义决定——装配层不再替人吞掉。
pub fn spawn_dir_watcher<F>(targets: &[(std::path::PathBuf, bool)], debounce_ms: u64, on_change: F) -> Result<DirWatcher, String>
where
    F: FnMut(Result<Vec<DebouncedEvent>, notify_debouncer_mini::notify::Error>) + Send + 'static,
{
    let mut debouncer = new_debouncer(std::time::Duration::from_millis(debounce_ms), on_change)
        .map_err(|e| format!("创建文件监听器失败：{e}"))?;
    for (p, recursive) in targets {
        let mode = if *recursive { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };
        debouncer
            .watcher()
            .watch(p, mode)
            .map_err(|e| format!("监听目录失败（{}）：{e}", p.display()))?;
    }
    Ok(debouncer)
}

/// 目录名是否在监听忽略清单（dep_health_dev_plan §4.1：依赖探针的 .py 遍历复用同一口径，
/// 剔除 .venv/.git 等，避免把虚拟环境内容扫进代码层）
pub(crate) fn is_ignored_dir_name(name: &str) -> bool {
    WATCH_IGNORED.contains(&name)
}

/// 文件名是否命中忽略前缀（选区运行临时文件，依赖探针同样跳过）
pub(crate) fn is_ignored_file_prefix(name: &str) -> bool {
    WATCH_IGNORED_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// 判断路径是否应被忽略（任一层级命中忽略目录或忽略文件名前缀即跳过）
fn should_ignore(path: &Path) -> bool {
    if path.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        WATCH_IGNORED.contains(&name.as_ref())
    }) {
        return true;
    }
    path.file_name()
        .map(|n| {
            let name = n.to_string_lossy();
            WATCH_IGNORED_PREFIXES.iter().any(|p| name.starts_with(p))
        })
        .unwrap_or(false)
}

/// 变更文件相对工作区根的路径（正斜杠，dep 域 file 键口径）；不在根下或为空返回 None
fn relative_to_root(path: &Path, root: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let s = rel.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// dep 域文件分类（§4.4 失效矩阵）：py = 代码层 / declaration = 声明层 / other = 无关。
/// 声明层判据与 detect_style 同源：pyproject.toml / uv.lock / requirements*.txt。
fn classify_dep_file(rel: &str) -> &'static str {
    let lower = rel.to_lowercase();
    if lower.ends_with(".py") {
        return "py";
    }
    let name = lower.rsplit('/').next().unwrap_or(lower.as_str());
    if name == "pyproject.toml"
        || name == "uv.lock"
        || (name.starts_with("requirements") && name.ends_with(".txt"))
    {
        return "declaration";
    }
    "other"
}

/// `fs-file-changed`（文件级结构化事件）的路径准入（docs/fs_watch_dev_plan.md §4.2）：
/// 该不该把这条路径广播给前端做外部改动检测。目录/文件之分由调用方按 `is_dir` 判
/// （需要真实 stat），这里只做「噪声过滤」——与 `should_ignore` 同一口径，
/// 且 site-packages 环境信号不重复广播（它已由 `dep-env-changed` 单独消费）。
fn emit_file_path(path: &Path) -> Option<std::path::PathBuf> {
    if is_site_packages_signal(path) || should_ignore(path) {
        return None;
    }
    Some(path.to_path_buf())
}

/// 顶层监听目标（TD-029①）：`(路径, 是否递归)`。
/// 根自身只做 NonRecursive（感知顶层条目增删），其下每个**非忽略**的顶层目录逐个 Recursive——
/// 这样 `.venv` / `node_modules` / `__pycache__` 整棵不再进回调（旧的一次性 Recursive 会）。
/// 目录不存在 / 读取失败时退化为「只监听根（非递归）」，绝不因列举失败而整体不监听。
pub(crate) fn top_level_targets(root: &Path) -> Vec<(PathBuf, bool)> {
    let mut out: Vec<(PathBuf, bool)> = vec![(root.to_path_buf(), false)];
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() && !should_ignore(&p) {
                out.push((p, true));
            }
        }
    }
    out
}

/// 监听健康度事件（TD-029②）：把「watcher 不工作了」这件事**显式告诉前端**。
/// 此前 `watch_start` 失败只 console.warn、debouncer 的 Err 直接吞掉——工作区落在网络盘 /
/// OneDrive 同步目录时（ReadDirectoryChangesW 缓冲区溢出丢事件）用户完全无从察觉，
/// 只看到「文件树不刷新、git 状态不更新」这类**症状**，而不是原因。
#[derive(Clone, serde::Serialize)]
pub struct WatchHealth {
    /// start_failed（启动失败）/ error（运行期错误，含溢出）/ limit（监听数超系统上限）
    pub kind: String,
    /// 人类可读原因（Rust 侧原文，前端只展示不解析）
    pub detail: String,
}

/// 把 notify 的错误分类成前端可区分的三种（不解析文案，只按 kind 判）。
fn health_from_notify_error(e: &notify_debouncer_mini::notify::Error) -> WatchHealth {
    // notify 8：`Error.kind` 是**字段**不是方法（rustc 明确提示），且 Io 变体带 payload
    let kind = match e.kind {
        notify_debouncer_mini::notify::ErrorKind::MaxFilesWatch => "limit",
        notify_debouncer_mini::notify::ErrorKind::Io(_) => "io",
        _ => "error",
    };
    WatchHealth { kind: kind.to_string(), detail: e.to_string() }
}

/// site-packages 环境信号判定（§4.4：`.venv` 例外放行，仅 `RECORD` / `*.dist-info` 触发，
/// 滤掉 `.pyc` 等噪声写——.pyc 落在包目录的 `__pycache__` 下，不含 dist-info 组件也非 RECORD）。
/// 判据：路径含 `site-packages` 组件，且其后存在 `*.dist-info` 组件或文件名为 `RECORD`。
fn is_site_packages_signal(path: &Path) -> bool {
    let comps: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let Some(sp_idx) = comps.iter().position(|c| c.as_str() == "site-packages") else {
        return false;
    };
    let has_dist_info = comps[sp_idx + 1..].iter().any(|c| c.ends_with(".dist-info"));
    let is_record = path.file_name().and_then(|n| n.to_str()).map(|n| n == "RECORD").unwrap_or(false);
    has_dist_info || is_record
}

/// 启动文件监听（停止旧监听 → 新建 debouncer → 监听工作区根目录）
#[tauri::command]
pub fn watch_start(app: AppHandle, window: tauri::WebviewWindow, root: String) -> Result<(), String> {
    let wid = window.label().to_string();
    // 先停止本窗口旧监听
    watch_stop_impl(&wid);

    let root_path = Path::new(&root).to_path_buf();
    let app_handle = app.clone();
    let wid_cb = wid.clone();
    let root_for_cb = root_path.clone();

    // —— 监听范围瘦身（TD-029①）——
    // 旧行为：对工作区根一次性 Recursive。`.venv` / `node_modules` / `__pycache__` 的
    // 事件照样进回调再被 should_ignore 丢掉，大仓下是纯开销（notify 8 无原生 exclude）。
    // 新行为：① 顶层目录逐个 Recursive（跳过忽略目录）；② 根自身 NonRecursive，用来
    // 感知**顶层条目的增删**；③ 运行期新建的顶层目录由回调动态补订阅（见下）。
    let mut targets: Vec<(PathBuf, bool)> = top_level_targets(&root_path);
    // 已订阅的顶层目录（首项是非递归的根自身，跳过）
    let watched_dirs: Vec<PathBuf> = targets
        .iter()
        .filter(|(_, rec)| *rec)
        .map(|(p, _)| p.clone())
        .collect();
    // 附加监听用户级 Live Templates 目录（M2 热重载）；目录不存在时静默跳过
    let lt_dir = opencharm_home().join("config");
    if lt_dir.is_dir() {
        targets.push((lt_dir, false));
    }
    // 回调里补订阅要用：已订阅的顶层目录表 + watcher 句柄（Arc 在 spawn 后回填）
    let watched_set = Arc::new(Mutex::new(watched_dirs.clone()));
    let watcher_slot: Arc<Mutex<Option<Arc<Mutex<DirWatcher>>>>> = Arc::new(Mutex::new(None));
    let watched_for_cb = Arc::clone(&watched_set);
    let slot_for_cb = Arc::clone(&watcher_slot);
    let root_for_cb2 = root_path.clone();

    // 统一装配入口（TD-029③）：去抖 + watch 注册 + 错误口径与其它目录监听同源
    let debouncer = spawn_dir_watcher(
        &targets,
        300,
        move |res: Result<Vec<DebouncedEvent>, notify_debouncer_mini::notify::Error>| {
            let events = match res {
                Ok(evts) => evts,
                Err(e) => {
                    // 运行期错误（含网络盘/同步目录的缓冲区溢出丢事件）必须上报：
                    // 吞掉等于「监听静默失效」，用户只能看到树不刷新却不知为何。
                    let _ = app_handle.emit_to(&wid_cb, "fs-watch-health", health_from_notify_error(&e));
                    return;
                }
            };
            // 顶层新目录补订阅（TD-029①）：根只做 NonRecursive 监听，新建的顶层目录
            // 若不补一条 Recursive，其子树就永远收不到事件（旧的一次性 Recursive 没这个问题）。
            for ev in &events {
                let p = &ev.path;
                if !p.is_dir() || p.parent() != Some(root_for_cb2.as_path()) {
                    continue;
                }
                if should_ignore(p) {
                    continue;
                }
                {
                    let mut known = match watched_for_cb.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };
                    if known.contains(p) {
                        continue;
                    }
                    // 先登记再订阅：并发回调不会重复 watch 同一目录
                    known.push(p.clone());
                }
                let handle = match slot_for_cb.lock() {
                    Ok(g) => g.as_ref().map(Arc::clone),
                    Err(_) => None,
                };
                if let Some(h) = handle {
                    // try_lock：取不到（正被 watch_start / 停止流程持有）就放弃这次补订阅——
                    // 宁可漏一次（下次事件还会重试），也不要阻塞或死锁。
                    if let Ok(mut d) = h.try_lock() {
                        let _ = d.watcher().watch(p, RecursiveMode::Recursive);
                    }
                }
            }

            // 收集受影响的目录（去重）
            let mut dirs: Vec<String> = Vec::new();
            // 文件级结构化事件（fs-file-changed，docs/fs_watch_dev_plan.md §4.2）：
            // 外部改动检测的数据源。**只发文件不发目录**——前端只对「已打开的文件 tab」
            // 做内容比对，目录事件对它无意义；去重按路径字符串。
            let mut changed_files: Vec<String> = Vec::new();
            // dep 域失效信号（M2 §4.4）：文件级分类 + site-packages 环境信号
            let mut dep_files: Vec<DepFileEvent> = Vec::new();
            let mut env_changed = false;
            for ev in &events {
                // site-packages 例外（`.venv` 其余维持忽略）：仅 RECORD / *.dist-info 触发环境信号，
                // 必须先于 should_ignore（.venv 整棵被忽略，否则 site-packages 事件永不可见）
                if is_site_packages_signal(&ev.path) {
                    env_changed = true;
                    continue;
                }
                // 噪声过滤的统一准入（.git / .venv / node_modules / 选区临时文件…）：三个事件的
                // 消费方共用这一道闸，fs-file-changed 的准入口径与 fs-changed / dep 完全一致。
                if emit_file_path(&ev.path).is_none() {
                    continue;
                }
                let is_dir = ev.path.is_dir();
                if !is_dir {
                    let p = ev.path.to_string_lossy().to_string();
                    if !changed_files.contains(&p) {
                        changed_files.push(p);
                    }
                }
                // 取变更路径的父目录（文件变更 → 刷新其所在目录）
                let dir = if is_dir {
                    ev.path.clone()
                } else {
                    ev.path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| ev.path.clone())
                };
                let dir_str = dir.to_string_lossy().to_string();
                if !dirs.contains(&dir_str) {
                    dirs.push(dir_str);
                }
                // 目录自身变更时**连父目录一起发**：notify 对「新建目录」只给目录自身，
                // 而要让它在树里出现必须刷新父层（此前台面上表现为「mkdir 后树里看不到」）。
                if is_dir {
                    if let Some(parent) = ev.path.parent() {
                        let p_str = parent.to_string_lossy().to_string();
                        if !dirs.contains(&p_str) {
                            dirs.push(p_str);
                        }
                    }
                }
                // dep-fs-changed：仅对 .py / 声明文件发（other 无 dep 意义，减噪；按 path 去重）
                if let Some(rel) = relative_to_root(&ev.path, &root_for_cb) {
                    let kind = classify_dep_file(&rel);
                    if kind != "other" && !dep_files.iter().any(|f| f.path == rel) {
                        dep_files.push(DepFileEvent { path: rel, kind: kind.to_string() });
                    }
                }
            }
            if !dirs.is_empty() {
                let _ = app_handle.emit_to(&wid_cb, "fs-changed", dirs);
            }
            // 发射顺序契约（plan §4.2）：fs-changed → fs-file-changed → dep-fs-changed → dep-env-changed。
            // 前端各方各自独立防抖消费，顺序不构成契约。
            if !changed_files.is_empty() {
                let _ = app_handle.emit_to(&wid_cb, "fs-file-changed", changed_files);
            }
            if !dep_files.is_empty() {
                let _ = app_handle.emit_to(&wid_cb, "dep-fs-changed", dep_files);
            }
            if env_changed {
                let _ = app_handle.emit_to(&wid_cb, "dep-env-changed", true);
            }
        },
    )
    .map_err(|e| {
        // 启动失败同样上报（前端把它从 console.warn 升级为可见状态）：返回 Err 只让
        // 调用方知道，用户侧此前完全无感。
        let _ = app.emit_to(&wid, "fs-watch-health", WatchHealth { kind: "start_failed".to_string(), detail: e.clone() });
        e
    })?;

    // 回填句柄供回调补订阅（TD-029①），再交给全局表持有
    let shared = Arc::new(Mutex::new(debouncer));
    if let Ok(mut g) = watcher_slot.lock() {
        *g = Some(Arc::clone(&shared));
    }
    WATCHER.insert(&wid, shared);
    Ok(())
}

/// 停止本窗口文件监听
#[tauri::command]
pub fn watch_stop(window: tauri::WebviewWindow) -> Result<(), String> {
    let wid = window.label().to_string();
    watch_stop_impl(&wid);
    Ok(())
}

pub(crate) fn watch_stop_impl(wid: &str) {
    // drop Arc → 引用计数归零后 drop debouncer → 自动停止监听。
    // 注意：回调线程此刻可能正持有 clone（补订阅路径），那只是短暂借用，不影响停止语义。
    WATCHER.remove(wid);
}

/// CR-14：应用退出清理——停止全部窗口的文件监听。
pub(crate) fn watch_stop_all_for_exit() {
    WATCHER.drain_all(); // drop 全部 debouncer → 自动停止监听
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CR-05：选区运行临时文件（随机后缀）与忽略目录都不得触发树刷新。
    #[test]
    fn test_should_ignore_selection_temp_and_noise_dirs() {
        // 选区临时文件：任意随机后缀都被前缀规则忽略
        assert!(should_ignore(Path::new(
            r"C:\ws\proj\__opencharm_selection__lx2k-a1b2c3.py"
        )));
        assert!(should_ignore(Path::new(
            r"C:\ws\proj\pkg\__opencharm_selection__9f8e7d-x0y9.py"
        )));
        // 噪声目录：任一层级命中即忽略
        assert!(should_ignore(Path::new(r"C:\ws\proj\.git\HEAD")));
        assert!(should_ignore(Path::new(r"C:\ws\proj\.venv\Scripts\python.exe")));
        assert!(should_ignore(Path::new(r"C:\ws\proj\sub\node_modules\x.js")));
        // 正常项目文件：不忽略
        assert!(!should_ignore(Path::new(r"C:\ws\proj\main.py")));
        assert!(!should_ignore(Path::new(r"C:\ws\proj\pkg\util.py")));
        // 前缀相似但不同的文件：不忽略（避免误伤用户以 __opencharm 开头的文件）
        assert!(!should_ignore(Path::new(r"C:\ws\proj\__opencharm_config__.py")));
    }

    /// M2 §4.4：dep 域文件分类——py=代码层 / declaration=声明层 / other 不发。
    #[test]
    fn test_classify_dep_file() {
        assert_eq!(classify_dep_file("main.py"), "py");
        assert_eq!(classify_dep_file("src/pkg/util.py"), "py");
        assert_eq!(classify_dep_file("pyproject.toml"), "declaration");
        assert_eq!(classify_dep_file("uv.lock"), "declaration");
        assert_eq!(classify_dep_file("requirements.txt"), "declaration");
        assert_eq!(classify_dep_file("requirements-dev.txt"), "declaration");
        assert_eq!(classify_dep_file("subdir/pyproject.toml"), "declaration");
        // 无关文件：other（不发 dep-fs-changed）
        assert_eq!(classify_dep_file("README.md"), "other");
        assert_eq!(classify_dep_file("src/app.ts"), "other");
        assert_eq!(classify_dep_file(".venv/pyvenv.cfg"), "other");
        // 大小写不敏感（Windows）
        assert_eq!(classify_dep_file("Main.PY"), "py");
        assert_eq!(classify_dep_file("PyProject.Toml"), "declaration");
    }

    /// M2 §4.4：site-packages 例外——仅 RECORD / *.dist-info 触发环境信号，.pyc 等噪声不触发。
    #[test]
    fn test_site_packages_signal_filters_pyc_noise() {
        // 装/卸包写 dist-info 与 RECORD → 触发
        assert!(is_site_packages_signal(Path::new(
            "C:/ws/.venv/Lib/site-packages/foo-1.0.dist-info/RECORD"
        )));
        assert!(is_site_packages_signal(Path::new(
            "C:/ws/.venv/Lib/site-packages/foo-1.0.dist-info/METADATA"
        )));
        assert!(is_site_packages_signal(Path::new(
            "C:/ws/.venv/lib/python3.13/site-packages/bar-2.0.dist-info"
        )));
        // .pyc 生成（__pycache__）→ 不触发（误报控制，§9.2）
        assert!(!is_site_packages_signal(Path::new(
            "C:/ws/.venv/Lib/site-packages/foo/__pycache__/bar.cpython-313.pyc"
        )));
        // 包内普通 .py / 其它文件 → 不触发（dist-info 才是装/卸的强信号）
        assert!(!is_site_packages_signal(Path::new(
            "C:/ws/.venv/Lib/site-packages/foo/__init__.py"
        )));
        // 非 site-packages 路径 → 不触发
        assert!(!is_site_packages_signal(Path::new("C:/ws/src/main.py")));
        assert!(!is_site_packages_signal(Path::new("C:/ws/.venv/Scripts/python.exe")));
    }

    /// M2：变更文件相对工作区根的路径（正斜杠）；不在根下返回 None。
    #[test]
    fn test_relative_to_root() {
        let root = Path::new("C:/ws/proj");
        assert_eq!(
            relative_to_root(Path::new("C:/ws/proj/src/main.py"), root).as_deref(),
            Some("src/main.py")
        );
        assert_eq!(
            relative_to_root(Path::new("C:/ws/proj/pyproject.toml"), root).as_deref(),
            Some("pyproject.toml")
        );
        // 根自身 / 不在根下 → None
        assert_eq!(relative_to_root(Path::new("C:/ws/proj"), root), None);
        assert_eq!(relative_to_root(Path::new("C:/other/x.py"), root), None);
    }

    /// fs-file-changed（docs/fs_watch_dev_plan.md §4.2）：文件级事件的准入口径。
    /// 只判「路径该不该广播」，目录/文件之分由调用方按 `is_dir` 判（需要真实 stat）。
    #[test]
    fn test_fs_file_changed_admission() {
        // 工作区普通文件：准入
        assert!(emit_file_path(Path::new(r"C:\ws\proj\main.py")).is_some());
        assert!(emit_file_path(Path::new(r"C:\ws\proj\pkg\util.py")).is_some());
        assert!(emit_file_path(Path::new(r"C:\ws\proj\README.md")).is_some());
        // 忽略目录整棵不发（.venv 连 site-packages 里的普通 .py 也不发——前端无对应 tab）
        assert!(emit_file_path(Path::new(r"C:\ws\proj\.git\HEAD")).is_none());
        assert!(emit_file_path(Path::new(r"C:\ws\proj\node_modules\x\index.js")).is_none());
        assert!(emit_file_path(Path::new(
            r"C:\ws\proj\.venv\Lib\site-packages\foo\__init__.py"
        ))
        .is_none());
        // 选区运行临时文件：不发（CR-05 同口径，否则面板会被自己的运行打扰）
        assert!(emit_file_path(Path::new(
            r"C:\ws\proj\__opencharm_selection__lx2k-a1b2c3.py"
        ))
        .is_none());
    }

    /// 顶层监听目标（TD-029①）：跳过忽略目录，根自身非递归。
    #[test]
    fn test_top_level_targets_skips_ignored() {
        let base = std::env::temp_dir().join(format!("oc-watch-targets-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("pkg")).unwrap();
        std::fs::create_dir_all(base.join(".venv")).unwrap();
        std::fs::create_dir_all(base.join("node_modules")).unwrap();
        std::fs::create_dir_all(base.join("__pycache__")).unwrap();
        std::fs::write(base.join("main.py"), "x = 1\n").unwrap();

        let t = top_level_targets(&base);
        // 根自身（非递归）+ pkg（递归）；三个忽略目录都不在
        assert!(t.iter().any(|(p, rec)| p == &base && !rec));
        assert!(t.iter().any(|(p, rec)| p == &base.join("pkg") && *rec));
        for bad in ["__pycache__", ".venv", "node_modules"] {
            assert!(!t.iter().any(|(p, _)| p == &base.join(bad)), "{bad} 不应被订阅");
        }
        // 顶层文件不产生订阅项（只由根的非递归监听覆盖）
        assert!(!t.iter().any(|(p, _)| p == &base.join("main.py")));

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 目录不存在时退化为「只监听根」，不因列举失败而整体放弃。
    #[test]
    fn test_top_level_targets_missing_root() {
        let missing = std::env::temp_dir().join(format!("oc-watch-missing-{}", std::process::id()));
        let t = top_level_targets(&missing);
        assert_eq!(t.len(), 1);
        assert!(!t[0].1);
    }

    /// site-packages 环境信号不重复发 fs-file-changed（它已由 dep-env-changed 消费）。
    #[test]
    fn test_fs_file_changed_skips_site_packages_signal() {
        assert!(emit_file_path(Path::new(
            "C:/ws/.venv/Lib/site-packages/foo-1.0.dist-info/RECORD"
        ))
        .is_none());
        assert!(emit_file_path(Path::new(
            "C:/ws/.venv/Lib/site-packages/foo-1.0.dist-info"
        ))
        .is_none());
    }
}
