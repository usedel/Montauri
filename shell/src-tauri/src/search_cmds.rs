// 工作区检索域命令（2026-10-09 自 fs_cmds.rs 拆分，纯搬运零语义变更）：
// 代码格式化（ruff format）/ Optimize Imports / 全局搜索 / TODO 扫描 / import 别名
// 学习 / ruff 实时 lint / 工作区文件清单。全部是「拉取式」读命令 + ruff 子进程管线
//（架构铁律：ruff 走独立子进程，不走 LSP 桥）。
//
// 共享走查辅助（collect_files / read_text_file / MAX_FILE_SIZE / SEARCH_IGNORED_DIRS）
// 随本域走并 pub(crate) 导出——intel_cmds / pydantic_cmds 经 `use crate::search_cmds::…`
// 引用（原先在 fs_cmds，跨文件引用点已同步改）。
//
// 冻结线纪律（同 env_cmds 先例）：新增检索类命令一律落本文件或新文件，
// fs_cmds.rs 只承载基础 IO / 项目创建 / 模板配置，不再回流检索域。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use crate::tool_paths::{tool_command, ENV_RUFF};
use crate::util::no_window;

// ---------- 代码格式化（ruff，独立子进程，不走 LSP 桥） ----------

/// 前后端约定的分类码前缀（同 `git_cmds::GIT_MISSING_PREFIX` / `Db*` / `Http*` 先例）：
/// ruff 二进制缺失（spawn 失败）。
///
/// 为什么需要它：格式化 / 整理导入失败后前端只往输出面板写一行，ruff 没装时用户完全看不到
/// ——表现为「开关开了却没反应」。有了分类码，前端才能把「没装 ruff」与「源码有语法错误」
/// 分开：前者提示安装，后者照旧只写输出面板（保存动作不该被 toast 刷屏）。
pub const RUFF_MISSING_PREFIX: &str = "RuffMissing:";

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
                message: format!("{RUFF_MISSING_PREFIX}无法启动 ruff（可能未安装）：{e}"),
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

// ---------- Optimize Imports（ruff isort 规则 + F401，PyCharm Ctrl+Alt+O 对标） ----------

/// 规则集：I = isort 兼容的导入排序/合并；F401 = 未使用的导入。
/// 二者合起来即 PyCharm「Optimize Imports」的核心语义（排序 + 去重 + 删无用）。
/// 不启用 --fix 之外的其它规则，避免把「整理导入」变成「顺手改一堆代码」。
const OPTIMIZE_IMPORT_RULES: &str = "I,F401";

/// 在缓冲区上整理导入（不落盘，编辑器层负责应用与撤销）。
/// 与 format_python 同款 stdin 管线（架构铁律：ruff 走独立子进程，不占 LSP 桥）。
/// ruff 缺席不拖垮功能：返回错误信息由前端提示。
#[tauri::command]
pub async fn optimize_imports(path: String, content: String) -> Result<FormatResult, String> {
    tauri::async_runtime::spawn_blocking(move || optimize_imports_impl(path, content))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn optimize_imports_impl(path: String, content: String) -> Result<FormatResult, String> {
    use std::io::Write;
    use std::process::Stdio;

    // `--fix` + 从 stdin 读：ruff 把整理后的全文写回 stdout（改动为空时原样回显）。
    // 退出码 0 = 无诊断，1 = 有诊断（含已修复的），>1 = 用法/内部错误；故只把 >1 判失败。
    let mut cmd = tool_command("ruff", ENV_RUFF);
    cmd.args(["check", "--fix", "--select", OPTIMIZE_IMPORT_RULES, "--stdin-filename", &path, "-"]);
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
                message: format!("{RUFF_MISSING_PREFIX}无法启动 ruff（可能未安装）：{e}"),
            })
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(content.as_bytes());
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("ruff 执行失败：{e}"))?;
    let code = out.status.code().unwrap_or(1);
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if code > 1 || stdout.is_empty() {
        Ok(FormatResult {
            formatted: None,
            message: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        })
    } else {
        Ok(FormatResult {
            formatted: Some(stdout),
            message: String::new(),
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
/// 此处额外兜底未被 .gitignore 收录的常见噪声目录）。
/// pub(crate)：fs_cmds（workspace_has_python 的 venv 探测走查）与本文件共享同一名单。
///
/// 2026-10-18 venv 误收集修复（用户现场 smbter/venv）：补 `venv` / `env` /
/// `virtualenv` / `site-packages` / `dist-packages` 五项。原名单只有 `.venv`——
/// 无点命名的 venv 逃过 hidden 规则，且工作区非 git 仓库时 `.gitignore`（含 `venv/`）
/// 因 ignore crate 的 require_git 默认 true 而不生效，venv 内三方包自带的 test_*.py
/// 被 pytest scan 收进测试树（用户现场 48 个，项目本体 0 个）。排除组件与 dep_health
/// 的 Python 侧 `_is_local_path` 保持一致（`.venv*` / `venv` / `site-packages` /
/// `dist-packages`，不用裸 `env`——故此处 `env` 仅按命名兜底，不参与落点判定）。
/// 注：`.tox` / `.nox` 无需重复登记（点开头目录已被 hidden 覆盖）。
pub(crate) const SEARCH_IGNORED_DIRS: [&str; 15] = [
    ".git", ".venv", "node_modules", "__pycache__", ".idea", ".vscode",
    "dist", "build", ".pytest_cache", ".ruff_cache",
    "venv", "env", "virtualenv", "site-packages", "dist-packages",
];

/// 单文件大小上限（超过跳过，防误扫大文件卡顿）。
/// pub(crate)：pydantic_cmds 的三个扫描命令共享同一口径。
pub(crate) const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;

/// 工作区全局搜索：大小写不敏感子串匹配，返回带行号/列号的匹配列表。
/// 遍历交给 ripgrep 生态的 `ignore` crate（.gitignore 感知 + 隐藏过滤），
/// 匹配阶段按文件多线程并行，单文件 ≤ 2MB。接口与返回结构不变，前端零感知。
/// async + spawn_blocking：大工作区扫描可能耗时，同步 command 会卡死主线程 UI。
///
/// PR-H（dx_features_backlog §6.6）：新增两个可选参数——
///   · `use_regex`：正则模式（编译失败即返回明确错误，不静默退回子串）；
///   · `file_glob`：文件掩码（gitignore 语义，无斜杠的 `*.py` = 任意深度）。
/// 两者都是 Option，旧调用方（含线上已缓存的旧前端）不用改。
#[tauri::command]
pub async fn search_workspace(
    root: String,
    query: String,
    case_sensitive: bool,
    use_regex: Option<bool>,
    file_glob: Option<String>,
) -> Result<SearchResult, String> {
    let opts = SearchOptions { use_regex: use_regex.unwrap_or(false), file_glob };
    tauri::async_runtime::spawn_blocking(move || search_workspace_impl(root, query, case_sensitive, opts))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

/// PR-H：搜索附加选项（结构体而非一串 bool——后续再加开关不必改函数签名）
#[derive(Default, Clone)]
pub struct SearchOptions {
    pub use_regex: bool,
    pub file_glob: Option<String>,
}

fn search_workspace_impl(
    root: String,
    query: String,
    case_sensitive: bool,
    opts: SearchOptions,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult { matches: vec![], files_scanned: 0, files_skipped: 0, files_skipped_binary: 0, truncated: false });
    }
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    // PR-H：正则要在搜索前**编译一次**（失败即返回明确错误——静默退回子串会让用户
    // 以为「正则没生效」，比直接报错更难排查）；编译结果供所有线程共享只读借用。
    let regex = if opts.use_regex {
        let mut b = regex::RegexBuilder::new(&query);
        b.case_insensitive(!case_sensitive);
        Some(b.build().map_err(|e| format!("正则表达式无效：{e}"))?)
    } else {
        None
    };
    // 小写化关键词只计算一次，供所有线程复用
    let needle = if case_sensitive { query.clone() } else { query.to_lowercase() };
    let query_char_len = query.chars().count() as u32;

    // 1. ignore 遍历：.gitignore + 隐藏过滤（PR-H：+ 文件掩码），收集候选文件
    let files = collect_files_glob(root_path, opts.file_glob.as_deref())?;

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
        // 同上：正则也是共享只读借用，预先绑定避免 move 闭包把 `regex` 挪走（多次迭代会 use-after-move）
        let regex_ref = regex.as_ref();
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
                    search_one_file(path, needle_ref, query_char_len, case_sensitive, regex_ref, &mut local, scanned, skipped, skip_bin, counted, trunc);
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
/// `pub(crate)`：`intel_cmds`（A1 运行时热点）复用同一遍历口径，避免第二套 .gitignore 语义。
pub(crate) fn collect_files(root: &Path) -> Vec<PathBuf> {
    collect_files_glob(root, None).unwrap_or_default()
}

/// ignore 遍历 + 可选文件掩码（PR-H）。
/// 掩码走 `ignore` 自带的 overrides（.gitignore 语义：无斜杠的 `*.py` = 任意深度命中，
/// 与 PyCharm File mask 直觉一致）——不引入 globset：同族且**走查期即剪枝**，
/// 比「先收全仓再过滤」省一次全仓遍历，也不必维护第二套 glob 方言。
fn collect_files_glob(root: &Path, file_glob: Option<&str>) -> Result<Vec<PathBuf>, String> {
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
    // PR-H：掩码非空时加 overrides（只要存在白名单规则，未命中者即被排除）
    if let Some(mask) = file_glob {
        let mask = mask.trim();
        if !mask.is_empty() {
            let mut ov = ignore::overrides::OverrideBuilder::new(root);
            ov.add(mask).map_err(|e| format!("文件掩码无效：{e}"))?;
            builder.overrides(ov.build().map_err(|e| format!("文件掩码无效：{e}"))?);
        }
    }
    for entry in builder.build() {
        if let Ok(entry) = entry {
            if entry.file_type().map_or(false, |ft| ft.is_file()) {
                files.push(entry.into_path());
            }
        }
    }
    Ok(files)
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
pub(crate) fn read_text_file(path: &Path) -> Option<String> {
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
    regex: Option<&regex::Regex>,
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
    // PR-H：正则模式——逐行 find_iter（非重叠），列/长按**字符**计（其它分支是字节偏移，
    // ASCII 下等价；正则可能匹配宽字符，字符计数才能和前端高亮切片对齐）
    if let Some(re) = regex {
        for (i, line) in content.lines().enumerate() {
            if truncated.load(Ordering::Relaxed) {
                return;
            }
            let line_no = (i + 1) as u32;
            for m in re.find_iter(line) {
                let col = line[..m.start()].chars().count();
                let len = m.as_str().chars().count() as u32;
                if !try_push_match(local, &path_str, line_no, line, col, len, match_count, truncated) {
                    return;
                }
            }
        }
        return;
    }
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

// ---------- TODO 工具窗（PyCharm TODO tool window 对标） ----------

/// 识别的标记（顺序即「同一行多个命中时的优先级」）。
/// TODO/FIXME 大小写不敏感（PyCharm 默认模式）；XXX/HACK/BUG 要求全大写——
/// 小写形态（xxx / hack / bug）在自然语言与技术文本中过于常见，放宽会淹没结果。
const TODO_TAGS: [&str; 5] = ["TODO", "FIXME", "HACK", "BUG", "XXX"];

/// 需要全大写匹配的标记（见 TODO_TAGS 注释）
const TODO_TAGS_CASE_SENSITIVE: [&str; 3] = ["HACK", "BUG", "XXX"];

/// 结果上限（防超大仓库把序列化与前端渲染拖垮，与搜索同一思路）
const MAX_TODOS: usize = 2000;

#[derive(Serialize, Clone)]
pub struct TodoMatch {
    pub path: String,
    pub line: u32,
    /// 归一化后的标记（大写，如 "TODO"）
    pub tag: String,
    /// 标记之后的说明文字（去掉前导 `: -` 等分隔符）
    pub message: String,
    /// 整行原文（trim 后，供悬停/收起时查看上下文）
    pub text: String,
}

/// 工作区 TODO/FIXME 扫描：复用 search_workspace 的 `ignore` 走查（.gitignore 感知 +
/// 隐藏过滤 + 噪声目录剪枝），命中行按「文件 → 行号」排序。
#[tauri::command]
pub async fn scan_todos(root: String) -> Result<Vec<TodoMatch>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_todos_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn scan_todos_impl(root: &str) -> Result<Vec<TodoMatch>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let mut out: Vec<TodoMatch> = Vec::new();
    for path in collect_files(root_path) {
        if out.len() >= MAX_TODOS {
            break;
        }
        // 与搜索同一口径：超大 / 二进制 / 非 UTF-8 一律跳过（不计数、不报错）
        if let Ok(meta) = fs::metadata(&path) {
            if meta.len() > MAX_FILE_SIZE {
                continue;
            }
        }
        let Some(content) = read_text_file(&path) else { continue };
        let path_str = path.to_string_lossy().into_owned();
        for (i, raw) in content.lines().enumerate() {
            let Some((col, tag)) = find_todo_tag(raw) else { continue };
            let after = raw[col + tag.len()..].trim();
            let message = after
                .trim_start_matches(|c: char| c == ':' || c == '-' || c == '(' || c == '：')
                .trim()
                .to_string();
            out.push(TodoMatch {
                path: path_str.clone(),
                line: (i + 1) as u32,
                tag: tag.to_string(),
                message,
                text: raw.trim().to_string(),
            });
            if out.len() >= MAX_TODOS {
                break;
            }
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    Ok(out)
}

/// 在行内定位最左侧的 TODO 标记，返回 (字节列, 标记)。含 ASCII 词边界判定——
/// `TODOS` / `myTODO` 之类不算命中（否则变量名里的子串会大量误报）。
fn find_todo_tag(line: &str) -> Option<(usize, &'static str)> {
    let bytes = line.as_bytes();
    let mut best: Option<(usize, &'static str)> = None;
    for tag in TODO_TAGS {
        let t = tag.as_bytes();
        let case_sensitive = TODO_TAGS_CASE_SENSITIVE.contains(&tag);
        let mut start = 0usize;
        while start + t.len() <= bytes.len() {
            let hit = if case_sensitive {
                &bytes[start..start + t.len()] == t
            } else {
                bytes[start..start + t.len()].eq_ignore_ascii_case(t)
            };
            if hit && todo_boundary_ok(bytes, start, t.len()) {
                if best.map_or(true, |(b, _)| start < b) {
                    best = Some((start, tag));
                }
                break;
            }
            start += 1;
        }
    }
    best
}

/// 词边界：前后均不得为字母/数字/下划线
fn todo_boundary_ok(bytes: &[u8], start: usize, len: usize) -> bool {
    let end = start + len;
    let before_ok = start == 0 || {
        let c = bytes[start - 1];
        !(c.is_ascii_alphanumeric() || c == b'_')
    };
    let after_ok = end >= bytes.len() || {
        let c = bytes[end];
        !(c.is_ascii_alphanumeric() || c == b'_')
    };
    before_ok && after_ok
}

// ---------- import 别名扫描（importAlias 补全的频率学习数据源） ----------
//
// 逐行扫描 .py 文件中的 `import X as Y` / `from X import A as B`，按 target 聚合
// 出现次数，供前端把工作区高频别名排在内置表之前。纪律同 scan_todos / scan_endpoints：
// 纯文本逐行解析、零子进程、零正则依赖；复用 collect_files 的 ignore 走查。

/// 结果上限（防超大仓库序列化拖垮）
const MAX_IMPORT_ALIASES: usize = 500;

/// 单条聚合结果：target = `X`（module 型）或 `X.A`（from-import 成员型）
#[derive(Serialize, Deserialize, Clone)]
pub struct ImportAliasHit {
    pub kind: String, // "module" | "member"
    pub target: String,
    pub alias: String,
    pub count: u32,
}

#[tauri::command]
pub async fn scan_import_aliases(root: String) -> Result<Vec<ImportAliasHit>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_import_aliases_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn scan_import_aliases_impl(root: &str) -> Result<Vec<ImportAliasHit>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    // 增量扫描（边界③）：上次每文件 (mtime,size) 签名 + 绑定缓存，签名一致则跳过
    // 该文件的读取与解析，只重建聚合。缓存损坏 / 版本不符 → 整体作废走全量
    // （首次扫描无缓存 = 全量，语义与旧实现一致）。
    let prev_cache: HashMap<String, AliasScanCacheFile> = crate::run_config::load_config(root)
        .get(ALIAS_SCAN_CACHE_KEY)
        .and_then(|x| serde_json::from_value::<AliasScanCache>(x.clone()).ok())
        .filter(|c| c.v == ALIAS_SCAN_CACHE_VERSION)
        .map(|c| c.files)
        .unwrap_or_default();
    // (kind, target, alias) → count；出口按 count 降序 + target/alias 升序稳定排序
    let mut counts: HashMap<(u8, String, String), u32> = HashMap::new();
    let mut next_cache: HashMap<String, AliasScanCacheFile> = HashMap::new();
    for path in collect_files(root_path) {
        if path.extension().map_or(true, |e| e != "py") {
            continue;
        }
        // 与搜索同一口径：超大 / 二进制 / 非 UTF-8 一律跳过（不计数、不报错）
        let sig = fs::metadata(&path).ok().and_then(|m| alias_file_signature(&m));
        if let Some((_, _, size)) = sig {
            if size > MAX_FILE_SIZE {
                continue;
            }
        }
        // 缓存键用相对路径（工作区移动 / 换盘符后仍命中）；统一 `/` 分隔
        let rel = path
            .strip_prefix(root_path)
            .unwrap_or(path.as_path())
            .to_string_lossy()
            .replace('\\', "/");
        let cached = sig.as_ref().and_then(|s| {
            prev_cache
                .get(&rel)
                .filter(|c| (c.mtime_secs, c.mtime_nanos, c.size) == *s)
        });
        let bindings = match cached {
            // 未变：跳过读取与解析（登记粒度：同 mtime 刻度内等长改写不感知，标准
            // mtime 缓存取舍，编辑器落盘必更新 mtime，实际不可达）
            Some(c) => c.bindings.clone(),
            None => {
                let Some(content) = read_text_file(&path) else { continue };
                parse_import_alias_content(&content)
            }
        };
        for b in &bindings {
            *counts.entry(b.clone()).or_insert(0) += 1;
        }
        if let Some((secs, nanos, size)) = sig {
            next_cache.insert(
                rel,
                AliasScanCacheFile {
                    mtime_secs: secs,
                    mtime_nanos: nanos,
                    size,
                    bindings,
                },
            );
        }
    }
    let mut out: Vec<ImportAliasHit> = counts
        .into_iter()
        .map(|((kind, target, alias), count)| ImportAliasHit {
            kind: if kind == 0 { "module" } else { "member" }.to_string(),
            target,
            alias,
            count,
        })
        .collect();
    out.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.target.cmp(&b.target))
            .then_with(|| a.alias.cmp(&b.alias))
    });
    out.truncate(MAX_IMPORT_ALIASES);
    // 学习结果 + 增量缓存基线同一次落盘（工作区 config 两个键）；落盘失败不吞
    // 扫描结果——补全数据比缓存更重要（best-effort，同 sweep 口径）
    let cache = AliasScanCache {
        v: ALIAS_SCAN_CACHE_VERSION,
        files: next_cache,
    };
    let _ = save_import_aliases(root, &out, &serde_json::to_value(&cache).unwrap_or(Value::Null));
    Ok(out)
}

/// 增量扫描缓存条目：文件签名（mtime + size）+ 该文件解析出的绑定
#[derive(serde::Serialize, serde::Deserialize)]
struct AliasScanCacheFile {
    mtime_secs: u64,
    mtime_nanos: u32,
    size: u64,
    bindings: Vec<(u8, String, String)>,
}

/// 增量扫描缓存整体（工作区 config `import_aliases_scan_cache` 键）；
/// v = 结构/解析器版本，不符即整体作废
#[derive(serde::Serialize, serde::Deserialize)]
struct AliasScanCache {
    v: u32,
    files: HashMap<String, AliasScanCacheFile>,
}

const ALIAS_SCAN_CACHE_KEY: &str = "import_aliases_scan_cache";
/// 解析器或缓存结构变更时递增，使旧缓存整体失效走全量
const ALIAS_SCAN_CACHE_VERSION: u32 = 1;

/// 文件未变判定三元组 (mtime_secs, mtime_nanos, size)
fn alias_file_signature(meta: &fs::Metadata) -> Option<(u64, u32, u64)> {
    let d = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?;
    Some((d.as_secs(), d.subsec_nanos(), meta.len()))
}

/// 工作区配置存储键（env_cmds 工作区 config，与 framework_hints / dep_ignored 同文件同口径）
const IMPORT_ALIASES_KEY: &str = "import_aliases";

/// 学习别名 + 增量扫描缓存落盘（同一次 load/save 写两个键）；空清单移除别名键
/// 保持配置精简（同 dep_ignored 先例），缓存始终覆盖写（作为下次扫描的增量基线）
fn save_import_aliases(root: &str, hits: &[ImportAliasHit], scan_cache: &Value) -> Result<(), String> {
    let mut v = crate::run_config::load_config(root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    if hits.is_empty() {
        obj.remove(IMPORT_ALIASES_KEY);
    } else {
        obj.insert(
            IMPORT_ALIASES_KEY.into(),
            serde_json::to_value(hits).map_err(|e| e.to_string())?,
        );
    }
    obj.insert(ALIAS_SCAN_CACHE_KEY.into(), scan_cache.clone());
    crate::run_config::save_config(root, &v)
}

/// 从工作区配置读缓存（字段缺失 / 类型错误 / 条目损坏 → None，绝不 panic，同 load_config 口径）
fn import_aliases_from_config(v: &Value) -> Option<Vec<ImportAliasHit>> {
    v.get(IMPORT_ALIASES_KEY)
        .and_then(|x| serde_json::from_value::<Vec<ImportAliasHit>>(x.clone()).ok())
}

/// 读学习别名缓存（前端打开工作区先展示缓存，后台重扫刷新；同步纯 fs，零子进程）
#[tauri::command]
pub fn read_import_aliases(root: String) -> Option<Vec<ImportAliasHit>> {
    import_aliases_from_config(&crate::run_config::load_config(&root))
}

/// 解析 import 语句文本中的别名绑定，kind 0 = module（`import X as Y`）、1 = member
/// （`from X import A as Y`）。仅认稳定语法：多目标逗号分隔、from 后圆括号（含跨行
/// 续行）、行尾 `#` 注释截断（模块名不可能含引号/#，朴素截断安全）、分号多语句
/// （每段独立成语句；续行中首个 `;` 结束续行）。字符串字面量内的分号不识别（朴素口径）。
fn parse_import_alias_content(content: &str) -> Vec<(u8, String, String)> {
    let mut out = Vec::new();
    // Some(module) = from-import 续行进行中（上一段以 ',' 或 '(' 结尾）
    let mut pending_from: Option<String> = None;
    for raw in content.lines() {
        let trimmed = raw.trim();
        // 行尾注释截断（'#' 前有空白才算，防 base 编码类误截；模块名后必有空白才跟注释）
        let trimmed = match trimmed.find(" #") {
            Some(pos) => trimmed[..pos].trim_end(),
            None => trimmed,
        };
        if trimmed.is_empty() {
            continue;
        }
        let mut segments = trimmed.split(';');
        if let Some(module) = pending_from.take() {
            // 续行段：首个分号前的部分仍是成员段，之后的是新语句
            let first = segments.next().unwrap_or("");
            pending_from = parse_from_members(first, &module, &mut out).then(|| module.clone());
        }
        for stmt in segments {
            let stmt = stmt.trim();
            if stmt.is_empty() {
                continue;
            }
            if let Some(rest) = stmt.strip_prefix("import ") {
                parse_import_targets(rest, &mut out);
            } else if let Some(rest) = stmt.strip_prefix("from ") {
                if let Some(module) = parse_from_stmt(rest, &mut out) {
                    pending_from = Some(module); // 同行多条 from 语句取最后一条的续行态
                }
            }
        }
    }
    out
}

/// `import X as Y, Z` → 逗号分段逐段认领（无续行语义）
fn parse_import_targets(rest: &str, out: &mut Vec<(u8, String, String)>) {
    for seg in rest.split(',') {
        let t: Vec<&str> = seg.split_whitespace().collect();
        if t.len() == 3 && t[1] == "as" && is_dotted_ident(t[0]) && is_ident(t[2]) {
            out.push((0u8, t[0].to_string(), t[2].to_string()));
        }
    }
}

/// `from X import <members>` → 成员别名绑定；返回 Some(module) 表示 members 以
/// ',' 或 '(' 结尾（跨行续行开启）。模块名非法返回 None 且不产生绑定。
fn parse_from_stmt(rest: &str, out: &mut Vec<(u8, String, String)>) -> Option<String> {
    let pos = rest.find(" import ")?;
    let module = rest[..pos].trim();
    if !is_dotted_ident(module) {
        return None;
    }
    let members = rest[pos + " import ".len()..].trim_start();
    parse_from_members(members, module, out).then(|| module.to_string())
}

/// 成员段（可能是跨行续行）解析：逐逗号分段，段首 '(' / 段尾 ')' 剥除（括号容错，
/// 含 `(A as B, C as D)` 尾段 ')' 粘连形态——旧实现该形态尾段会被 is_ident 拒绝）；
/// 只认领 `A as B` 形态（成员无别名不学）。返回是否续行（原始 members 以 ','/'(' 结尾）。
fn parse_from_members(members: &str, module: &str, out: &mut Vec<(u8, String, String)>) -> bool {
    let cont = members.ends_with(',') || members.ends_with('(');
    for seg in members.split(',') {
        let seg = seg.trim().trim_start_matches('(').trim_end_matches(')');
        if seg.is_empty() {
            continue;
        }
        let t: Vec<&str> = seg.split_whitespace().collect();
        if t.len() == 3 && t[1] == "as" && is_dotted_ident(t[0]) && is_ident(t[2]) {
            out.push((1u8, format!("{module}.{}", t[0]), t[2].to_string()));
        }
    }
    cont
}

/// 点分标识符：非空且每个 `.` 段均为合法标识符（含 Unicode 字母，走 char 判定）
fn is_dotted_ident(s: &str) -> bool {
    !s.is_empty() && s.split('.').all(is_ident)
}

/// 单段标识符：字母/下划线开头，后续字母/数字/下划线（ASCII 口径足够——
/// 目标是过滤注释/字符串/运算符误入，不是完整 lexgate）
fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// ---------- ruff 实时 lint（P2：诊断第三桶） ----------

/// lint 规则集：E/W = pycodestyle（PEP8 风格与格式），F = pyflakes（未使用导入/变量、未定义名）。
/// 与 Optimize Imports 的区别：那里是**改写**（只取 I/F401 且 --fix），这里是**只读诊断**，
/// 故范围更宽——用户看到的是「PEP8 级卫生问题」，不动代码。
///
/// 刻意显式指定而非交给项目配置：诊断口径必须**稳定可预期**（同一个文件不会因为
/// 工作区里多了一个 pyproject.toml 就突然刷出几百条），否则 lint 很快会被当成噪音关掉。
const LINT_RULES: &str = "E,W,F";

#[derive(Serialize, Clone)]
pub struct RuffDiagnostic {
    /// 1 基行号
    pub line: u32,
    /// 1 基列号
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub message: String,
    /// 规则码（如 "F401"）；缺失时为 null
    pub code: Option<String>,
}

/// ruff check（JSON 输出）在缓冲区上做只读诊断，不改写任何内容。
///
/// 退出码语义（与 optimize_imports 同款）：0 = 无诊断，1 = 有诊断，>1 = 用法/内部错误。
/// 故 **1 是正常路径**，只有 >1 才判失败——把「有诊断」当错误会让 lint 恒为空。
/// ruff 缺席/失败一律返回空列表：lint 是增强，绝不能拖垮编辑（与探针缺席策略一致）。
#[tauri::command]
pub async fn ruff_lint(path: String, content: String) -> Result<Vec<RuffDiagnostic>, String> {
    tauri::async_runtime::spawn_blocking(move || ruff_lint_impl(&path, &content))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn ruff_lint_impl(path: &str, content: &str) -> Result<Vec<RuffDiagnostic>, String> {
    use std::io::Write;
    use std::process::Stdio;

    let mut cmd = tool_command("ruff", ENV_RUFF);
    cmd.args([
        "check",
        "--output-format",
        "json",
        "--select",
        LINT_RULES,
        "--no-cache",
        "--stdin-filename",
        path,
        "-",
    ]);
    let mut child = match no_window(&mut cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return Ok(Vec::new()), // ruff 缺席：静默降级
    };
    if let Some(mut stdin) = child.stdin.take() {
        // 子进程可能提前退出（如语法错误极多），忽略 BrokenPipe
        let _ = stdin.write_all(content.as_bytes());
    }
    let out = match child.wait_with_output() {
        Ok(o) => o,
        Err(_) => return Ok(Vec::new()),
    };
    // 与 optimize_imports 同口径：>1 才是真失败
    if out.status.code().unwrap_or(1) > 1 {
        return Ok(Vec::new());
    }
    Ok(parse_ruff_json(&String::from_utf8_lossy(&out.stdout)))
}

/// 解析 ruff 的 JSON 诊断数组；解析失败返回空（宁可少报也不要报错弹窗）
fn parse_ruff_json(raw: &str) -> Vec<RuffDiagnostic> {
    let value: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for it in items {
        let start = it.get("location").and_then(|l| l.get("row")).and_then(serde_json::Value::as_u64);
        let Some(line) = start else { continue };
        let col = it.get("location").and_then(|l| l.get("column")).and_then(serde_json::Value::as_u64).unwrap_or(1);
        // end_location 缺失（旧版 ruff）时退化为「起点 + 1 列」的单字符范围——
        // Monaco 不接受 0 宽范围以外的非法范围，退化值至少保证标记能落在正确行上
        let end_line = it.get("end_location").and_then(|l| l.get("row")).and_then(serde_json::Value::as_u64).unwrap_or(line);
        let end_col = it.get("end_location").and_then(|l| l.get("column")).and_then(serde_json::Value::as_u64).unwrap_or(col + 1);
        let message = it.get("message").and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        if message.is_empty() {
            continue;
        }
        let code = it.get("code").and_then(serde_json::Value::as_str).map(|s| s.to_string());
        out.push(RuffDiagnostic {
            line: line as u32,
            column: col as u32,
            end_line: end_line as u32,
            end_column: end_col as u32,
            message,
            code,
        });
    }
    out
}

// ---------- 工作区文件清单（P1：Search Everywhere 文件名检索用） ----------

/// 文件清单上限：超大仓库只取前 N 条，避免序列化与前端渲染被拖垮
///（清单只服务于「按文件名快速跳转」，截断不影响定位常用文件）。
const MAX_FILE_LIST: usize = 20_000;

/// 列出工作区内的全部文件路径（复用 search_workspace 的 `ignore` 走查：.gitignore 感知 +
/// 隐藏过滤 + 噪声目录剪枝），按路径排序。
/// async + spawn_blocking：大仓库遍历可能耗时，同步 command 会卡死主线程 UI。
#[tauri::command]
pub async fn list_workspace_files(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list_workspace_files_impl(&root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn list_workspace_files_impl(root: &str) -> Result<Vec<String>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let mut files: Vec<String> = collect_files(root_path)
        .into_iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    files.sort();
    files.truncate(MAX_FILE_LIST);
    Ok(files)
}

const MAX_DIR_LIST: usize = 2_000;

/// 单个目录的条目上限（VS Code 调研 借鉴-3 路径补全）：目录里几千个文件时全量返回
/// 既拖慢补全又糊屏，按「目录优先、名称升序」截断（与 MAX_DIR_LIST 的递归口径分开）。
const MAX_DIR_ENTRIES: usize = 300;

/// 目录条目（路径补全用）
#[derive(Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// 列出工作区目录条目。两种语义（**同一命令面，不加命令**——命令面已 205/205 压线）：
///   · 缺省（`files` 不为 true）：递归列出全部子目录（相对工作区根、统一正斜杠，
///     复用 list_workspace_files 同一套 `ignore` 走查：.gitignore 感知 + 隐藏过滤 +
///     噪声目录剪枝）——运行配置「工作目录」候选用，不含根自身，按路径排序、去重、截断；
///   · `files = true`：**只列 `sub` 指定的单个目录**的条目（名称 + 是否目录），供
///     字符串字面量路径补全用。目录优先、名称升序，`..` 与绝对路径一律夹回工作区根内。
#[tauri::command]
pub async fn list_workspace_dirs(
    root: String,
    sub: Option<String>,
    files: Option<bool>,
) -> Result<Vec<DirEntry>, String> {
    let sub = sub.unwrap_or_default();
    let files = files.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || list_workspace_dirs_impl(&root, &sub, files))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn list_workspace_dirs_impl(root: &str, sub: &str, with_files: bool) -> Result<Vec<DirEntry>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    if !with_files {
        return Ok(walk_dirs_recursive(root_path)?
            .into_iter()
            .map(|name| DirEntry { name, is_dir: true })
            .collect());
    }
    Ok(list_single_dir(root_path, sub)?)
}

/// 把前端给的片段目录（`""` / `"data/"` / `"./data"` / `"/data/sub"`）解析成工作区内的真实目录。
/// **越界一律夹回工作区根**：`..` 与绝对路径前缀都被丢弃，路径补全不得逃出工作区。
fn resolve_sub_dir(root: &Path, sub: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for part in sub.replace('\\', "/").split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." || part == ".." {
            continue;
        }
        out.push(part);
    }
    out
}

fn list_single_dir(root: &Path, sub: &str) -> Result<Vec<DirEntry>, String> {
    let target = resolve_sub_dir(root, sub);
    if !target.is_dir() {
        return Ok(Vec::new()); // 目录不存在（用户刚敲错的片段）→ 静默给空，不弹错误
    }
    let mut dirs: Vec<DirEntry> = Vec::new();
    let mut files: Vec<DirEntry> = Vec::new();
    let rd = fs::read_dir(&target).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || SEARCH_IGNORED_DIRS.contains(&name.as_str()) {
            continue; // 隐藏项与噪声目录剪枝（与递归走查同一口径）
        }
        let is_dir = entry.file_type().map_or(false, |ft| ft.is_dir());
        let item = DirEntry { name, is_dir };
        if is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }
    // 目录优先、各自按名称升序（前端按返回序给 sortText，不再二次排序）
    dirs.sort_by(|a, b| a.name.cmp(&b.name));
    files.sort_by(|a, b| a.name.cmp(&b.name));
    dirs.truncate(MAX_DIR_ENTRIES);
    files.truncate(MAX_DIR_ENTRIES);
    dirs.append(&mut files);
    Ok(dirs)
}

fn walk_dirs_recursive(root_path: &Path) -> Result<Vec<String>, String> {
    let root_norm = root_path.to_string_lossy().replace('\\', "/");
    let root_norm = root_norm.trim_end_matches('/');
    let mut dirs: Vec<String> = Vec::new();
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
    for entry in builder.build() {
        if let Ok(entry) = entry {
            if entry.depth() == 0 {
                continue; // 根自身不计入
            }
            if entry.file_type().map_or(false, |ft| ft.is_dir()) {
                let s = entry.into_path().to_string_lossy().replace('\\', "/");
                if let Some(rel) = s.strip_prefix(root_norm).and_then(|r| r.strip_prefix('/')) {
                    if !rel.is_empty() {
                        dirs.push(rel.to_string());
                    }
                }
            }
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs.truncate(MAX_DIR_LIST);
    Ok(dirs)
}



// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmpdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("montauri-search-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
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

        let r = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), false, SearchOptions::default()).unwrap();
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
        let r2 = search_workspace_impl(base.to_string_lossy().to_string(), "Hello".into(), true, SearchOptions::default()).unwrap();
        assert_eq!(r2.matches.len(), 0);
        let r3 = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), true, SearchOptions::default()).unwrap();
        assert_eq!(r3.matches.len(), 4);

        // 空查询
        let r4 = search_workspace_impl(base.to_string_lossy().to_string(), "".into(), false, SearchOptions::default()).unwrap();
        assert_eq!(r4.matches.len(), 0);
        assert_eq!(r4.files_scanned, 0);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_search_multiline_and_column() {
        let base = tmpdir("search2");
        fs::write(base.join("x.py"), "aaa bbb aaa\nccc\n").unwrap();
        let r = search_workspace_impl(base.to_string_lossy().to_string(), "aaa".into(), false, SearchOptions::default()).unwrap();
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
        let r = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), false, SearchOptions::default()).unwrap();
        assert_eq!(r.matches.len(), 3, "不敏感搜索应命中 Hello/hello/HELLO 三处");
        assert_eq!(r.matches[0].line, 1);
        assert_eq!(r.matches[0].column, 1);
        assert_eq!(r.matches[1].line, 2);
        assert_eq!(r.matches[2].line, 3);
        // 敏感：仅第 2 行 hello 命中
        let r2 = search_workspace_impl(base.to_string_lossy().to_string(), "hello".into(), true, SearchOptions::default()).unwrap();
        assert_eq!(r2.matches.len(), 1);
        assert_eq!(r2.matches[0].line, 2);
        fs::remove_dir_all(&base).unwrap();
    }
    // ---------- PR-H（dx_features_backlog §6.6）：全局搜索正则 + 文件掩码 ----------

    fn opts_regex() -> SearchOptions {
        SearchOptions { use_regex: true, file_glob: None }
    }

    #[test]
    fn search_regex_matches_and_reports_column_and_length() {
        let base = tmpdir("search-regex");
        fs::write(base.join("a.py"), "foo_aa barrier\nfoo_bbb nothing\nplain\n").unwrap();
        // `foo_\w+` 应命中两行：长度分别为 6 / 7（按字符计，宽字符场景才与前端切片对齐）
        let r = search_workspace_impl(
            base.to_string_lossy().to_string(),
            r"foo_\w+".into(),
            true,
            opts_regex(),
        )
        .unwrap();
        assert_eq!(r.matches.len(), 2);
        assert_eq!(r.matches[0].line, 1);
        assert_eq!(r.matches[0].column, 1);
        assert_eq!(r.matches[0].length, 6);
        assert_eq!(r.matches[1].line, 2);
        assert_eq!(r.matches[1].column, 1);
        assert_eq!(r.matches[1].length, 7);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn search_regex_respects_case_toggle_and_line_offsets() {
        let base = tmpdir("search-regex-case");
        fs::write(base.join("a.py"), "ERROR at x\nerror at y\n").unwrap();
        let root = base.to_string_lossy().to_string();
        // 敏感：仅 "error" 命中（第 2 行）
        let r = search_workspace_impl(root.clone(), "error".into(), true, opts_regex()).unwrap();
        assert_eq!(r.matches.len(), 1);
        assert_eq!(r.matches[0].line, 2);
        // 不敏感：两行都命中
        let r2 = search_workspace_impl(root, "error".into(), false, opts_regex()).unwrap();
        assert_eq!(r2.matches.len(), 2);
        // 非行首匹配也要给出正确列号
        let r3 = search_workspace_impl(
            base.to_string_lossy().to_string(),
            r"at\s\w".into(),
            true,
            opts_regex(),
        )
        .unwrap();
        assert_eq!(r3.matches[0].column, 7);
        assert_eq!(r3.matches[0].length, 4); // "at x"
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn search_file_glob_filters_candidates() {
        let base = tmpdir("search-glob");
        fs::create_dir_all(base.join("pkg")).unwrap();
        fs::write(base.join("a.py"), "hit here\n").unwrap();
        fs::write(base.join("b.txt"), "hit here\n").unwrap();
        fs::write(base.join("pkg").join("c.py"), "hit here\n").unwrap();
        let root = base.to_string_lossy().to_string();
        // 无斜杠掩码 = 任意深度（gitignore 语义），故 a.py + pkg/c.py
        let r = search_workspace_impl(root.clone(), "hit".into(), false, SearchOptions {
            use_regex: false,
            file_glob: Some("*.py".into()),
        })
        .unwrap();
        assert_eq!(r.files_scanned, 2, "掩码 *.py 应扫描 a.py 与 pkg/c.py");
        assert!(r.matches.iter().all(|m| m.path.ends_with(".py")));
        // 路径分隔符 Windows 是 `\`：断言前归一，避免「只在 CI(Linux) 才过」的写法
        assert!(
            r.matches.iter().any(|m| m.path.replace('\\', "/").ends_with("pkg/c.py")),
            "无斜杠掩码需命中子目录"
        );
        // 带斜杠的掩码按相对根路径锚定
        let r2 = search_workspace_impl(root, "hit".into(), false, SearchOptions {
            use_regex: false,
            file_glob: Some("pkg/*.py".into()),
        })
        .unwrap();
        assert_eq!(r2.files_scanned, 1);
        assert!(r2.matches[0].path.replace('\\', "/").ends_with("pkg/c.py"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn search_invalid_regex_and_glob_report_errors() {
        let base = tmpdir("search-invalid");
        fs::write(base.join("a.py"), "hello\n").unwrap();
        let root = base.to_string_lossy().to_string();
        // 非法正则：明确报错，不静默退回子串匹配（静默会让用户以为「正则没生效」）
        // `.err()` 而非 `unwrap_err()`：后者要求 Ok 侧实现 Debug，会为了一条断言给产物类型加 derive
        let msg = search_workspace_impl(root.clone(), "foo(".into(), false, opts_regex())
            .err()
            .expect("非法正则必须报错而非静默降级");
        assert!(msg.contains("正则表达式无效"));
        // 掩码与正则可叠加使用（正则 + 掩码都是有效组合）
        let r = search_workspace_impl(root, "h.llo".into(), false, SearchOptions {
            use_regex: true,
            file_glob: Some("*.py".into()),
        })
        .unwrap();
        assert_eq!(r.matches.len(), 1);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn todo_tag_requires_word_boundary() {
        // 词边界：变量名里的子串不算 TODO
        assert_eq!(find_todo_tag("# TODO: 重构这里").map(|(_, t)| t), Some("TODO"));
        assert_eq!(find_todo_tag("# todo 也识别（大小写不敏感）").map(|(_, t)| t), Some("TODO"));
        assert!(find_todo_tag("todos = []").is_none(), "TODOS 不应命中");
        assert!(find_todo_tag("my_todo_helper()").is_none(), "下划线连接的词不算");
        assert!(find_todo_tag("def fixme_handler():").is_none(), "FIXME_ 前缀不是标记");
        // XXX/HACK/BUG 要求全大写（小写形态过于常见）
        assert_eq!(find_todo_tag("# XXX 临时方案").map(|(_, t)| t), Some("XXX"));
        assert!(find_todo_tag("# xxx 小写不识别").is_none());
        assert_eq!(find_todo_tag("# HACK: 绕过").map(|(_, t)| t), Some("HACK"));
        assert!(find_todo_tag("# hack").is_none());
        // 无标记
        assert!(find_todo_tag("x = 1").is_none());
    }

    #[test]
    fn todo_message_strips_leading_separators() {
        assert_eq!(find_todo_tag("# TODO: 补齐异常分支").map(|(c, t)| (c, t)), Some((2, "TODO")));
        // message 由调用方裁剪，这里验证裁剪口径（冒号/横线/括号/中文冒号）
        for (raw, expect) in [
            ("# TODO: 补齐异常分支", "补齐异常分支"),
            ("# TODO - 补齐异常分支", "补齐异常分支"),
            ("# TODO 补齐异常分支", "补齐异常分支"),
            ("# TODO", ""),
        ] {
            let (col, tag) = find_todo_tag(raw).expect("应命中");
            let after = raw[col + tag.len()..].trim();
            let msg = after
                .trim_start_matches(|c: char| c == ':' || c == '-' || c == '(' || c == '：')
                .trim();
            assert_eq!(msg, expect, "raw={raw}");
        }
    }

    #[test]
    fn test_scan_todos() {
        let base = tmpdir("todo");
        fs::write(
            base.join("a.py"),
            "import os\n# TODO: 删掉未使用的导入\nx = os.sep  # FIXME(x): 边界没兜住\nnormal = 1\n",
        )
        .unwrap();
        fs::create_dir_all(base.join("pkg")).unwrap();
        fs::write(base.join("pkg").join("b.py"), "# XXX 临时实现\n").unwrap();
        // 忽略目录内的 TODO 不应出现（复用 collect_files 的 .gitignore/噪声目录剪枝）
        fs::create_dir_all(base.join(".venv")).unwrap();
        fs::write(base.join(".venv").join("c.py"), "# TODO hidden\n").unwrap();

        let r = scan_todos_impl(&base.to_string_lossy()).unwrap();
        assert_eq!(r.len(), 3, "a.py 两处 + pkg/b.py 一处");
        assert!(r.iter().all(|m| !m.path.contains(".venv")));
        // 按文件 → 行号排序
        assert_eq!(r[0].line, 2);
        assert_eq!(r[0].tag, "TODO");
        assert_eq!(r[0].message, "删掉未使用的导入");
        assert_eq!(r[1].line, 3);
        assert_eq!(r[1].tag, "FIXME");
        assert_eq!(r[1].message, "x): 边界没兜住");
        assert_eq!(r[2].tag, "XXX");
        assert!(r[2].path.ends_with("b.py"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_todos_rejects_missing_root() {
        let missing = std::env::temp_dir().join("montauri-scan-todos-missing-dir");
        assert!(scan_todos_impl(&missing.to_string_lossy()).is_err());
    }

    // ---------- import 别名扫描单测 ----------

    #[test]
    fn import_alias_parse_module_and_member() {
        let mut hits = parse_import_alias_content("import pandas as pd");
        assert_eq!(hits, vec![(0, "pandas".to_string(), "pd".to_string())]);
        // from-import 成员型：target 为 module.member
        hits = parse_import_alias_content("from pandas import DataFrame as DF");
        assert_eq!(
            hits,
            vec![(1, "pandas.DataFrame".to_string(), "DF".to_string())]
        );
    }

    #[test]
    fn import_alias_parse_multi_and_paren_and_comment() {
        // 多目标 + 混合有无别名
        let hits = parse_import_alias_content("import os, numpy as np");
        assert_eq!(hits, vec![(0, "numpy".to_string(), "np".to_string())]);
        // from + 圆括号 + 多成员
        let hits = parse_import_alias_content("from torch import (nn as NN, optim)");
        assert_eq!(hits, vec![(1, "torch.nn".to_string(), "NN".to_string())]);
        // 行尾注释截断（'#' 前有空白）
        let hits = parse_import_alias_content("import pandas as pd  # 数据处理");
        assert_eq!(hits, vec![(0, "pandas".to_string(), "pd".to_string())]);
    }

    #[test]
    fn import_alias_parse_rejects_noise() {
        assert!(parse_import_alias_content("# import pandas as pd").is_empty()); // 注释行
        assert!(parse_import_alias_content("import pandas").is_empty()); // 无别名
        assert!(parse_import_alias_content("from pandas import DataFrame").is_empty());
        assert!(parse_import_alias_content("x = import pandas as pd").is_empty()); // 非 import 行首
        assert!(parse_import_alias_content("import pandas as pd.DataFrame").is_empty()); // 别名非法
        assert!(parse_import_alias_content("from 'x' import y as z").is_empty()); // 模块名非法
    }

    #[test]
    fn import_alias_parse_multiline_from_import() {
        // 圆括号跨行续行（含逗号尾行与闭括号行）
        let src = "from pandas import (\n    DataFrame as DF,\n    read_csv as rc,\n)\n";
        assert_eq!(
            parse_import_alias_content(src),
            vec![
                (1u8, "pandas.DataFrame".to_string(), "DF".to_string()),
                (1, "pandas.read_csv".to_string(), "rc".to_string()),
            ]
        );
        // 逗号续行（无括号形态）
        let src = "from torch import nn as NN,\n    optim as opt\nx = 1\n";
        assert_eq!(
            parse_import_alias_content(src),
            vec![
                (1u8, "torch.nn".to_string(), "NN".to_string()),
                (1, "torch.optim".to_string(), "opt".to_string()),
            ]
        );
        // 同行多成员尾段 ')' 粘连（旧实现只学到第一个）
        assert_eq!(
            parse_import_alias_content("from lib import (A as B, C as D)"),
            vec![
                (1u8, "lib.A".to_string(), "B".to_string()),
                (1, "lib.C".to_string(), "D".to_string()),
            ]
        );
        // 续行遇非续行语句收束；空行不打断计数判定由语句边界负责
        let src = "from lib import (\n    A as B,\n)\nx = 1\nimport os as o\n";
        assert_eq!(
            parse_import_alias_content(src),
            vec![
                (1u8, "lib.A".to_string(), "B".to_string()),
                (0, "os".to_string(), "o".to_string()),
            ]
        );
    }

    #[test]
    fn import_alias_parse_semicolon_statements() {
        // 分号多语句：两条 module 别名都学到
        assert_eq!(
            parse_import_alias_content("import pandas as pd; import numpy as np"),
            vec![
                (0u8, "pandas".to_string(), "pd".to_string()),
                (0, "numpy".to_string(), "np".to_string()),
            ]
        );
        // from + import 混排
        assert_eq!(
            parse_import_alias_content("from pandas import DataFrame as DF; import numpy as np"),
            vec![
                (1u8, "pandas.DataFrame".to_string(), "DF".to_string()),
                (0, "numpy".to_string(), "np".to_string()),
            ]
        );
        // 分号后的语句独立成句（不再受前句非 import 前缀影响）
        assert_eq!(
            parse_import_alias_content("x = 1; import pandas as pd"),
            vec![(0u8, "pandas".to_string(), "pd".to_string())]
        );
        // 跨行续行中首个分号结束续行，其后是新语句
        assert_eq!(
            parse_import_alias_content("from lib import (\n    A as B; import os as o\n)\n"),
            vec![
                (1u8, "lib.A".to_string(), "B".to_string()),
                (0, "os".to_string(), "o".to_string()),
            ]
        );
        // 无别名的分号段不产生绑定
        assert!(parse_import_alias_content("import pandas as pd; x = 1")
            == vec![(0u8, "pandas".to_string(), "pd".to_string())]);
    }

    #[test]
    fn scan_import_aliases_aggregates_and_ranks() {
        let base = tmpdir("import-alias");
        fs::write(
            base.join("a.py"),
            "import pandas as pd\nimport pandas as pd\nimport pandas as unusual\n",
        )
        .unwrap();
        fs::write(base.join("b.py"), "from numpy import array as arr\n").unwrap();
        fs::write(base.join("c.txt"), "import pandas as pd\n").unwrap(); // 非 .py 不扫
        let r = scan_import_aliases_impl(&base.to_string_lossy()).unwrap();
        assert_eq!(r[0].target, "pandas");
        assert_eq!(r[0].alias, "pd");
        assert_eq!(r[0].count, 2);
        assert_eq!(r[0].kind, "module");
        assert!(r.iter().any(|h| h.kind == "member" && h.target == "numpy.array"));
        // 同 target 不同 alias 是两条独立聚合（unusual 仅 1 次，pd 2 次）
        assert!(r.iter().any(|h| h.target == "pandas" && h.alias == "unusual" && h.count == 1));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_import_aliases_rejects_missing_root() {
        let missing = std::env::temp_dir().join("montauri-import-alias-missing-dir");
        assert!(scan_import_aliases_impl(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn scan_import_aliases_incremental_reuse_and_invalidation() {
        let base = tmpdir("import-alias-incr");
        let a = base.join("a.py");
        fs::write(&a, "import pandas as pd\n").unwrap();
        fs::write(base.join("b.py"), "from numpy import array as arr\n").unwrap();
        let root_str = base.to_string_lossy().to_string();
        let r1 = scan_import_aliases_impl(&root_str).unwrap();
        assert_eq!(r1.iter().find(|h| h.target == "pandas").unwrap().count, 1);

        // 哨兵验证：不动文件、直接改写缓存绑定 → 重扫命中缓存复用哨兵（证明未重读文件）
        let mut cfg = crate::run_config::load_config(&root_str);
        cfg["import_aliases_scan_cache"]["files"]["a.py"]["bindings"] =
            json!([[0, "pandas", "sentinel"]]);
        crate::run_config::save_config(&root_str, &cfg).unwrap();
        let r2 = scan_import_aliases_impl(&root_str).unwrap();
        assert!(r2.iter().any(|h| h.target == "pandas" && h.alias == "sentinel"));
        assert!(!r2.iter().any(|h| h.target == "pandas" && h.alias == "pd"));
        // 未动过的 b.py 条目同轮复用（arr 仍在）
        assert!(r2.iter().any(|h| h.kind == "member" && h.target == "numpy.array"));

        // 文件内容变化（长度不同确保签名变化）→ 该文件缓存失效重新解析
        fs::write(&a, "import pandas as pd\nimport pandas as pd\nimport os as o\n").unwrap();
        let r3 = scan_import_aliases_impl(&root_str).unwrap();
        assert_eq!(
            r3.iter().find(|h| h.target == "pandas" && h.alias == "pd").unwrap().count,
            2
        );
        assert!(r3.iter().any(|h| h.target == "os" && h.alias == "o"));
        assert!(!r3.iter().any(|h| h.alias == "sentinel"));

        // 文件删除 → 条目从聚合与缓存基线中消失
        fs::remove_file(&a).unwrap();
        let r4 = scan_import_aliases_impl(&root_str).unwrap();
        assert!(!r4.iter().any(|h| h.target == "pandas"));
        assert!(!r4.iter().any(|h| h.target == "os"));
        assert!(r4.iter().any(|h| h.kind == "member" && h.target == "numpy.array"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn scan_import_aliases_tolerates_garbage_cache() {
        let base = tmpdir("import-alias-garbage");
        fs::write(base.join("a.py"), "import pandas as pd\n").unwrap();
        let root_str = base.to_string_lossy().to_string();
        let mut cfg = crate::run_config::load_config(&root_str);
        cfg["import_aliases_scan_cache"] = json!("not-an-object");
        crate::run_config::save_config(&root_str, &cfg).unwrap();
        // 缓存损坏 → 整体作废走全量，结果正确
        let r = scan_import_aliases_impl(&root_str).unwrap();
        assert!(r.iter().any(|h| h.target == "pandas" && h.alias == "pd"));
        // 重扫后缓存被健康结构覆盖写
        let cfg2 = crate::run_config::load_config(&root_str);
        assert_eq!(cfg2["import_aliases_scan_cache"]["v"], json!(1));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn import_aliases_from_config_tolerates_garbage() {
        // 字段缺失 / 类型错误 / 条目损坏 → None（绝不 panic，同 dep_ignored 口径）
        assert!(import_aliases_from_config(&json!({})).is_none());
        assert!(import_aliases_from_config(&json!({"import_aliases": "not-an-array"})).is_none());
        assert!(import_aliases_from_config(&json!({"import_aliases": [{"bogus": 1}]})).is_none());
        let v = json!({"import_aliases": [
            {"kind": "module", "target": "pandas", "alias": "pd", "count": 2},
            {"kind": "member", "target": "numpy.array", "alias": "arr", "count": 1}
        ]});
        let hits = import_aliases_from_config(&v).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].target, "pandas");
        assert_eq!(hits[1].kind, "member");
    }
    #[test]
    fn test_list_workspace_files() {
        let base = tmpdir("filelist");
        fs::write(base.join("a.py"), "x=1").unwrap();
        fs::create_dir_all(base.join("pkg")).unwrap();
        fs::write(base.join("pkg").join("b.py"), "y=2").unwrap();
        // 噪声/忽略目录不出现（与 search_workspace 同一走查口径）
        fs::create_dir_all(base.join(".venv")).unwrap();
        fs::write(base.join(".venv").join("c.py"), "z=3").unwrap();

        let files = list_workspace_files_impl(&base.to_string_lossy()).unwrap();
        assert_eq!(files.len(), 2, "只应有 a.py 与 pkg/b.py");
        assert!(files.iter().all(|p| !p.contains(".venv")));
        // 按路径排序（稳定输出，前端可直接按序渲染）
        let mut sorted = files.clone();
        sorted.sort();
        assert_eq!(files, sorted);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_list_workspace_files_prunes_venv_and_site_packages() {
        // 2026-10-18 venv 误收集修复：无点命名的 venv / env / virtualenv 与三方包目录
        // （site-packages / dist-packages）一律剪枝——venv 内三方包自带 test_*.py
        // 曾把 pytest 测试树灌满。非 git 仓库（tmpdir 无 .git）也走名单兜底，
        // 不依赖 .gitignore。
        let base = tmpdir("noisedirs");
        fs::write(base.join("main.py"), "x=1").unwrap();
        fs::create_dir_all(base.join("src")).unwrap();
        fs::write(base.join("src").join("a.py"), "y=1").unwrap();
        let noise_dirs = [
            base.join("venv").join("Lib").join("site-packages").join("pkg"),
            base.join("env").join("Lib").join("site-packages"),
            base.join("virtualenv").join("Lib").join("site-packages"),
            base.join("site-packages"),
            base.join("dist-packages"),
        ];
        for dir in &noise_dirs {
            fs::create_dir_all(dir).unwrap();
            fs::write(dir.join("test_a.py"), "def test_x(): pass").unwrap();
        }

        let files = list_workspace_files_impl(&base.to_string_lossy()).unwrap();
        // 断言落在**相对路径**上（绝对路径前缀含 tmpdir/用户名，子串断言会误伤）
        let rels: Vec<String> = files
            .iter()
            .map(|p| Path::new(p).strip_prefix(&base).unwrap_or(Path::new(p)).to_string_lossy().replace('\\', "/"))
            .collect();
        assert_eq!(rels, vec!["main.py".to_string(), "src/a.py".to_string()], "虚拟环境/三方包目录全部剪枝");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn test_list_workspace_dirs() {
        let base = tmpdir("dirlist");
        fs::create_dir_all(base.join("src").join("pkg")).unwrap();
        fs::write(base.join("src").join("a.py"), "x=1").unwrap();
        // 噪声目录（.venv 在 SEARCH_IGNORED_DIRS + hidden 双重过滤）不应出现
        fs::create_dir_all(base.join(".venv").join("lib")).unwrap();

        let dirs = list_workspace_dirs_impl(&base.to_string_lossy(), "", false).unwrap();
        let names: Vec<String> = dirs.iter().map(|d| d.name.clone()).collect();
        assert!(names.contains(&"src".to_string()), "应含 src");
        assert!(names.contains(&"src/pkg".to_string()), "应含 src/pkg（正斜杠相对路径）");
        assert!(!names.iter().any(|d| d.contains(".venv")), "噪声目录应被剪枝");
        assert!(!names.iter().any(|d| d.is_empty()), "不含根自身（空串）");
        assert!(dirs.iter().all(|d| d.is_dir), "旧语义只返目录");
        // 排序 + 去重
        let mut sorted = names.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(names, sorted);
        fs::remove_dir_all(&base).unwrap();
    }

    // VS Code 调研 借鉴-3：单目录条目（路径补全数据源）
    #[test]
    fn test_list_workspace_dirs_single_dir() {
        let base = tmpdir("direntries");
        fs::create_dir_all(base.join("data").join("raw")).unwrap();
        fs::write(base.join("data").join("a.csv"), "x").unwrap();
        fs::write(base.join("main.py"), "x=1").unwrap();
        fs::create_dir_all(base.join(".venv")).unwrap(); // 噪声 + hidden
        fs::write(base.join(".hidden"), "x").unwrap();

        // 根：目录优先，其次文件；隐藏项与噪声目录剪枝
        let root_entries = list_workspace_dirs_impl(&base.to_string_lossy(), "", true).unwrap();
        assert_eq!(root_entries[0].name, "data", "目录优先");
        assert!(root_entries[0].is_dir);
        assert!(root_entries.iter().any(|e| e.name == "main.py" && !e.is_dir));
        assert!(!root_entries.iter().any(|e| e.name.starts_with('.')), "隐藏项应被剪枝");

        // 子目录：`data/` 与 `/data` 与 `./data` 三种写法等价
        for sub in ["data/", "/data", "./data", "data"] {
            let es = list_workspace_dirs_impl(&base.to_string_lossy(), sub, true).unwrap();
            assert_eq!(es.len(), 2, "sub={sub} 应含 raw 与 a.csv");
            assert_eq!(es[0].name, "raw");
            assert!(es[0].is_dir);
            assert_eq!(es[1].name, "a.csv");
            assert!(!es[1].is_dir);
        }

        // 越界夹回工作区根：`..` 与绝对前缀都不得逃出根
        let esc = list_workspace_dirs_impl(&base.to_string_lossy(), "../../..", true).unwrap();
        assert_eq!(esc.len(), root_entries.len(), "`..` 应被夹回根");

        // 目录不存在 → 静默空（用户敲错的片段不该弹错误）
        assert!(list_workspace_dirs_impl(&base.to_string_lossy(), "nope/", true)
            .unwrap()
            .is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn parse_ruff_json_maps_diagnostics() {
        let raw = r#"[
            {"code":"F401","message":"`os` imported but unused","location":{"row":1,"column":8},"end_location":{"row":1,"column":10}},
            {"code":null,"message":"no code","location":{"row":7,"column":2}}
        ]"#;
        let got = parse_ruff_json(raw);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].code.as_deref(), Some("F401"));
        assert_eq!(got[0].line, 1);
        assert_eq!(got[0].column, 8);
        assert_eq!(got[0].end_line, 1);
        assert_eq!(got[0].end_column, 10);
        // code 缺失 → None；end_location 缺失 → 退化为「起点 + 1 列」
        assert_eq!(got[1].code, None);
        assert_eq!(got[1].end_column, 3);
    }

    #[test]
    fn parse_ruff_json_tolerates_garbage() {
        // 非 JSON / 非数组 / 缺 message / 空数组：一律返回空，不报错
        assert!(parse_ruff_json("not json").is_empty());
        assert!(parse_ruff_json("{}").is_empty());
        assert!(parse_ruff_json("[]").is_empty());
        assert!(parse_ruff_json(r#"[{"code":"E1"}]"#).is_empty());
    }

    #[test]
    fn list_workspace_files_rejects_missing_root() {
        let missing = std::env::temp_dir().join("montauri-file-list-missing-dir");
        assert!(list_workspace_files_impl(&missing.to_string_lossy()).is_err());
    }
}
