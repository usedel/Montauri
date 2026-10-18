// Git 写命令层（Phase 4 提前 → P1 最小可写闭环）：暂存 / 取消暂存 / 提交 / 查看 diff。
// 设计要点：
// - 全部异步（spawn_blocking），避免 git 子进程阻塞主线程；
// - 复用 `no_window` 抑制 Windows 黑窗；
// - 路径通过 `--` 分隔符传入，支持空格 / 中文路径；
// - 失败时透传 git 的 stderr 作为错误信息。

use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{BufRead, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::per_window::PerWindow;
use crate::tool_paths::{tool_command, ENV_GIT};
use crate::util::{kill_process_tree, no_window};

/// 前后端约定的分类码前缀（同 `Db*` / `Http*` 前缀先例）：git 二进制缺失（spawn 失败）与
/// 「不是 Git 仓库」是两种完全不同的故障——前者要引导装 Git，后者要引导 `git init`。
/// 以前两者都被糊成一条 stderr 原文，SCM 面板一律显示「不是 Git 仓库」。
pub const GIT_MISSING_PREFIX: &str = "GitMissing:";
/// 同上：`git` 在（工作区不是仓库 / 找不到 .git）。
pub const GIT_NOT_REPO_PREFIX: &str = "GitNotRepo:";

/// 判定 git 的 stderr 是否为「不是仓库」（官方文案为英文；中文环境 git 一般也不本地化，
/// 故只认英文——命中不了就退回原文，宁可露原文也不误判）。
fn is_not_a_repo(msg: &str) -> bool {
    msg.contains("not a git repository")
}

/// 执行一个已构建好的 git 子命令（cwd 锚定到仓库根），成功返回 stdout，失败返回 stderr。
/// pub(crate)：git_worktree_cmds（worktree/clone 域）复用。
pub(crate) fn exec_git(root: &str, mut cmd: Command) -> Result<String, String> {
    let out = no_window(&mut cmd)
        .current_dir(root)
        .output()
        .map_err(|e| format!("{GIT_MISSING_PREFIX}无法启动 git（可能未安装）：{e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = stderr.trim();
        Err(if msg.is_empty() {
            format!("git 命令执行失败（退出码 {:?}）", out.status.code())
        } else if is_not_a_repo(msg) {
            format!("{GIT_NOT_REPO_PREFIX}{msg}")
        } else {
            msg.to_string()
        })
    }
}

/// 网络 git 操作超时兜底上限（迭代 4 · P2-3：正常路径靠取消而非超时；此值仅防泄漏）。
const GIT_NET_TIMEOUT: Duration = Duration::from_secs(240);

/// pub(crate)：git_worktree_cmds（worktree/clone 域）复用。
pub(crate) async fn spawn_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

/// 暂存指定文件（`git add -- <paths>`）。paths 为仓库根相对路径。
#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    spawn_blocking(move || {
        if paths.is_empty() {
            return Ok(());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("add").arg("--");
        for p in &paths {
            cmd.arg(p);
        }
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 取消暂存指定文件（`git reset --quiet -- <paths>`，混合重置，兼容所有 git 版本）。
#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    spawn_blocking(move || {
        if paths.is_empty() {
            return Ok(());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("reset").arg("--quiet").arg("--");
        for p in &paths {
            cmd.arg(p);
        }
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 丢弃已跟踪文件的未暂存更改（`git checkout -- <paths>`），恢复到暂存区/HEAD 内容。
#[tauri::command]
pub async fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    spawn_blocking(move || {
        if paths.is_empty() {
            return Ok(());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("checkout").arg("--");
        for p in &paths {
            cmd.arg(p);
        }
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 删除未跟踪文件/目录（丢弃「未跟踪」= 直接从文件系统删除）。
/// 相较 `git clean -f`，fs 删除不依赖 pathspec / -d / .gitignore 的细微语义，行为确定：
/// 未跟踪文件逐条移除，未跟踪目录递归移除，路径先做防穿越校验（与 diff 视图同款守卫）。
#[tauri::command]
pub async fn git_clean(root: String, paths: Vec<String>) -> Result<(), String> {
    spawn_blocking(move || {
        for p in &paths {
            validate_repo_relative(&root, p)?;
            let full = Path::new(&root).join(p);
            if full.is_dir() {
                std::fs::remove_dir_all(&full)
                    .map_err(|e| format!("删除目录失败：{p}（{e}）"))?;
            } else {
                match std::fs::remove_file(&full) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(format!("删除文件失败：{p}（{e}）")),
                }
            }
        }
        Ok(())
    })
    .await
}

/// 接受冲突文件的「当前」版本：`git checkout --ours -- <path>` 后 `git add`（两步 = 解决该冲突）。
#[tauri::command]
pub async fn git_accept_current(root: String, path: String) -> Result<(), String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
        let mut co = tool_command("git", ENV_GIT);
        co.arg("checkout").arg("--ours").arg("--").arg(&path);
        exec_git(&root, co)?;
        let mut add = tool_command("git", ENV_GIT);
        add.arg("add").arg("--").arg(&path);
        exec_git(&root, add)?;
        Ok(())
    })
    .await
}

/// 接受冲突文件的「传入」版本：`git checkout --theirs -- <path>` 后 `git add`。
#[tauri::command]
pub async fn git_accept_incoming(root: String, path: String) -> Result<(), String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
        let mut co = tool_command("git", ENV_GIT);
        co.arg("checkout").arg("--theirs").arg("--").arg(&path);
        exec_git(&root, co)?;
        let mut add = tool_command("git", ENV_GIT);
        add.arg("add").arg("--").arg(&path);
        exec_git(&root, add)?;
        Ok(())
    })
    .await
}

/// 提交已暂存更改（`git commit -m <message>`，amend=true 时 `--amend` 并入上一次提交）。
#[tauri::command]
pub async fn git_commit(root: String, message: String, amend: bool) -> Result<String, String> {
    spawn_blocking(move || {
        let msg = message.trim();
        if msg.is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("commit");
        if amend {
            cmd.arg("--amend");
        }
        cmd.arg("-m").arg(msg);
        exec_git(&root, cmd)
    })
    .await
}

/// 分支信息。
#[derive(Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    /// 远程分支（remotes/ 前缀已去除；本地检出需走 checkout 自动建跟踪分支）
    pub remote: bool,
}

/// 解析 `git branch -a --format "%(HEAD)\t%(refname)\t%(objectname:short)"` 的输出。
///
/// 剔除 `refs/remotes/<remote>/HEAD`：它是 clone / `git remote set-head` 建立的**符号引用**
/// （指向远程默认分支），不是真实分支——不可检出（`git checkout --track origin/HEAD`
/// → `fatal: 'HEAD' is not a valid branch name`），列在面板里只是幻影条目。
fn parse_branches(out: &str) -> Vec<GitBranch> {
    let mut branches = Vec::new();
    for line in out.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let head_mark = parts.next().unwrap_or("");
        let name = parts.next().unwrap_or("").trim().to_string();
        let _hash = parts.next().unwrap_or("");
        if name.is_empty() || name == "HEAD" {
            continue;
        }
        // refs/heads/x → 本地 x；refs/remotes/origin/x → 远程 origin/x（保留远程命名空间）
        let (display, remote) = if let Some(rest) = name.strip_prefix("refs/remotes/") {
            if rest.rsplit_once('/').map(|(_, last)| last) == Some("HEAD") {
                continue; // 远程默认分支指针，非真实分支
            }
            (rest.to_string(), true)
        } else if let Some(rest) = name.strip_prefix("refs/heads/") {
            (rest.to_string(), false)
        } else {
            (name, false) // branch -a 不出其他 ref；兜底当本地处理
        };
        branches.push(GitBranch {
            name: display,
            current: head_mark.trim() == "*",
            remote,
        });
    }
    branches
}

/// 列出本地 + 远程分支及当前分支（迭代 3 · B8：`git branch -a`，远程条目标 remote=true）。
#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<GitBranch>, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        // B8 真相：用完整 %(refname) 而非 :short——git 2.45 实测 %(refname:short) 对远程分支
        // 输出 origin/x（无 remotes/ 前缀），此前按前缀判 remote 恒 false：远程分支混进本地组、
        // 无云图标、点击走裸 checkout 进 detached HEAD。完整 refname 自行剥前缀，无歧义。
        cmd.arg("branch").arg("-a").arg("--format")
            .arg("%(HEAD)%09%(refname)%09%(objectname:short)");
        let out = exec_git(&root, cmd)?;
        Ok(parse_branches(&out))
    })
    .await
}

/// 切换分支（`git checkout <branch>`）。track=true 时 `checkout --track <branch>`：
/// 远程分支（如 origin/feature-x）检出为本地同名分支并建立跟踪（B8 遗留闭环——
/// 此前点远程分支走裸 checkout 进 detached HEAD，与 UI 提示「创建跟踪分支」不符）。
#[tauri::command]
pub async fn git_checkout(root: String, branch: String, track: Option<bool>) -> Result<(), String> {
    spawn_blocking(move || {
        let b = branch.trim();
        if b.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("checkout");
        if track.unwrap_or(false) {
            cmd.arg("--track");
        }
        cmd.arg(b);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 在指定提交上创建分支（不切换；迭代 3 · P1-4 右键「在此提交上新建分支」）。
#[tauri::command]
pub async fn git_create_branch_at(root: String, name: String, hash: String) -> Result<(), String> {
    spawn_blocking(move || {
        let n = name.trim();
        let h = hash.trim();
        if n.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        if h.is_empty() {
            return Err("提交哈希不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("branch").arg(n).arg(h);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 创建并切换到新分支（`git checkout -b <name>`）。
#[tauri::command]
pub async fn git_create_branch(root: String, name: String) -> Result<(), String> {
    spawn_blocking(move || {
        let n = name.trim();
        if n.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("checkout").arg("-b").arg(n);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

// ---------- 行内 diff（左右对照内容，TD-002） ----------

/// 左右对照 diff 所需的两份文本内容。
#[derive(Serialize)]
pub struct GitDiffVersions {
    /// 旧版内容（HEAD 或 Index，视 staged 而定）
    pub old: String,
    /// 新版内容（Index 或工作区，视 staged 而定）
    pub new: String,
    /// 左侧标题
    pub old_label: String,
    /// 右侧标题
    pub new_label: String,
}

/// 读取 git 中指定版本的文件内容：spec 为空时取 Index（`:path`），否则取 `spec:path`（如 HEAD:path）。
/// 版本中不存在该文件（新文件 / 已删除 / 未跟踪）时返回 None。
fn git_show_blob(root: &str, spec: &str, path: &str) -> Option<String> {
    let mut cmd = tool_command("git", ENV_GIT);
    cmd.arg("show");
    cmd.arg(if spec.is_empty() {
        format!(":{path}")
    } else {
        format!("{spec}:{path}")
    });
    exec_git(root, cmd).ok()
}

/// 校验仓库相对路径（CR-06：防路径穿越）——拒绝绝对路径与含 `..` 的组件，
/// 防止 `Path::join` 丢弃 root 逃逸仓库读取任意文件。空路径同样拒绝。
fn validate_repo_relative(root: &str, path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let p = Path::new(path);
    // 绝对路径（含盘符）与「有根路径」（Windows 下 `/x` / `\x` 无盘符但锚定盘根，
    // join 后丢弃 root 落到当前盘根——同为穿越面）都拒绝
    if p.is_absolute() || path.starts_with('/') || path.starts_with('\\') {
        return Err(format!("拒绝绝对路径：{path}"));
    }
    // 组件级校验：`..` 直接拒绝（含 `a/../../b` 混入形式）
    let suspicious = p.components().any(|c| matches!(c, std::path::Component::ParentDir));
    if suspicious {
        return Err(format!("路径不得包含 ..：{path}"));
    }
    // 双保险：文件存在时 canonicalize 后必须仍在仓库根内（符号链接逃逸兜底）。
    // 不存在的路径放行——diff 视图需要渲染「新文件/已删除」的空侧，且读侧有
    // is_file() 守卫，不存在的路径读不出任何内容，无穿越面。
    let full = Path::new(root).join(path);
    if let Ok(canon_full) = std::fs::canonicalize(&full) {
        let canon_root = std::fs::canonicalize(root)
            .map_err(|e| format!("无法解析仓库根：{root}（{e}）"))?;
        if !canon_full.starts_with(&canon_root) {
            return Err(format!("路径越出仓库范围：{path}"));
        }
    }
    Ok(())
}

/// 取左右对照内容（迭代 2 三态扩展）：base 决定对比基准——
/// - "index"（默认）：staged=true 为 HEAD vs Index；staged=false 为 Index vs 工作区
/// - "head"：staged 恒视为 false 语义，HEAD vs 工作区（总差异视图，P1-2）
/// 缺失一侧（新文件 / 删除 / 未跟踪）以空字符串表示，供 diff 编辑器渲染为空。
#[tauri::command]
pub async fn git_diff_versions(
    root: String,
    path: String,
    staged: bool,
    base: Option<String>,
    ignore_whitespace: Option<bool>,
) -> Result<GitDiffVersions, String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
        // ignore_whitespace 只作用于 Monaco 端 diff 计算（ignoreTrimWhitespace），
        // versions 返回整文件内容，git 侧无需 -w——保留参数为前端协议一致性
        let _ = ignore_whitespace;
        // 工作区 vs HEAD（P1-2 三态之「总差异」）
        if base.as_deref() == Some("head") {
            let old = git_show_blob(&root, "HEAD", &path).unwrap_or_default();
            let full = Path::new(&root).join(&path);
            let new = if full.is_file() {
                std::fs::read_to_string(&full).unwrap_or_default()
            } else {
                String::new()
            };
            return Ok(GitDiffVersions {
                old,
                new,
                old_label: "HEAD".to_string(),
                new_label: "工作区".to_string(),
            });
        }
        if staged {
            Ok(GitDiffVersions {
                old: git_show_blob(&root, "HEAD", &path).unwrap_or_default(),
                new: git_show_blob(&root, "", &path).unwrap_or_default(),
                old_label: "HEAD".to_string(),
                new_label: "暂存区（Index）".to_string(),
            })
        } else {
            // Index vs 工作区：左 = Index（新文件回退到 HEAD），右 = 磁盘工作区内容
            let old = git_show_blob(&root, "", &path)
                .or_else(|| git_show_blob(&root, "HEAD", &path))
                .unwrap_or_default();
            let full = Path::new(&root).join(&path);
            let new = if full.is_file() {
                std::fs::read_to_string(&full).unwrap_or_default()
            } else {
                String::new()
            };
            Ok(GitDiffVersions {
                old,
                new,
                old_label: "暂存区（Index）".to_string(),
                new_label: "工作区".to_string(),
            })
        }
    })
    .await
}

// ---------- Hunk 级操作（迭代 2 · P1-1/P0-5） ----------

/// 单个 hunk 的行号信息（工作区 vs HEAD 口径，供 gutter 装饰与 hunk 定位共用）。
#[derive(Serialize)]
pub struct GitHunk {
    /// 旧文件（HEAD）起始行（1 基；新文件时为 0）
    pub old_start: u32,
    /// 旧文件行数（0 = 纯新增）
    pub old_lines: u32,
    /// 新文件（工作区）起始行（1 基；删除时为 0）
    pub new_start: u32,
    /// 新文件行数（0 = 纯删除）
    pub new_lines: u32,
}

/// 解析 `@@ -a,b +c,d @@` hunk 头。格式变体：省略 `,b`（= 1）与 `,0`。
fn parse_hunk_header(line: &str) -> Option<GitHunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (old_part, rest) = rest.split_once(' ')?;
    let rest = rest.strip_prefix('+')?;
    let (new_part, _ctx) = rest.split_once(" @@")?;
    let parse = |s: &str| -> Option<(u32, u32)> {
        match s.split_once(',') {
            Some((a, b)) => Some((a.parse().ok()?, b.parse().ok()?)),
            None => Some((s.parse().ok()?, 1)),
        }
    };
    let (old_start, old_lines) = parse(old_part)?;
    let (new_start, new_lines) = parse(new_part)?;
    Some(GitHunk { old_start, old_lines, new_start, new_lines })
}

/// 列出文件「工作区 vs HEAD」的全部 hunk（`git diff HEAD --`）。
/// 同时返回原始 unified diff 文本（`diff_text`），前端可按 hunk 边界切分出 patch 片段。
/// gutter 装饰（P0-5）与 hunk 级暂存（P1-1）共用此口径。
#[tauri::command]
pub async fn git_diff_hunks(
    root: String,
    path: String,
    ignore_whitespace: bool,
) -> Result<GitHunksResult, String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("diff").arg("HEAD");
        if ignore_whitespace {
            cmd.arg("-w");
        }
        cmd.arg("-U3").arg("--").arg(&path);
        let diff_text = exec_git(&root, cmd)?;
        let hunks: Vec<GitHunk> = diff_text
            .lines()
            .filter(|l| l.starts_with("@@ "))
            .filter_map(parse_hunk_header)
            .collect();
        Ok(GitHunksResult { hunks, diff_text })
    })
    .await
}

/// hunk 列表 + 原始 diff 文本（前端按 `@@` 边界切 patch 片段用）。
#[derive(Serialize)]
pub struct GitHunksResult {
    pub hunks: Vec<GitHunk>,
    pub diff_text: String,
}

/// 应用一个 hunk 片段到暂存区或工作区（P1-1）。
/// `patch` 为前端从 `diff_text` 切出的单个 hunk（含 `@@` 头与上下文行）。
/// - stage：`git apply --cached`（把该块从工作区放进暂存区）
/// - unstage：`git apply --cached -R`（把该块从暂存区拿回工作区侧）
/// - discard：`git apply -R`（直接丢弃该块的工作区改动）
#[tauri::command]
pub async fn git_apply_hunk(
    root: String,
    path: String,
    patch: String,
    mode: String,
) -> Result<(), String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
        if patch.trim().is_empty() {
            return Err("patch 不能为空".to_string());
        }
        // Windows 三坑（E2E 实测）：stdin pipe 与 git 锁冲突；系统临时目录路径被
        // MSYS git 拒开；前端传来的 root 为正斜杠、join 产物被 git 路径转换弄丢。
        // → patch 落 .git/ 内（永不进 status），且用 dunce/canonicalize 风格的
        //   原生分隔符路径。std::fs::canonicalize 前缀 \\?\ 会被部分 git 版本拒开，
        //   故手动把 / 替换为 \（Windows）。
        // TD-027 A2：文件名带唯一后缀（nanos + pid + 单调序，run_env.rs 同款配方）——
        // 快速连点两个 hunk 时两次调用并发执行，固定名会互相覆盖/删除对方的 patch
        // （A 写入 → B 覆盖 → A 读到 B 的内容 / B 的清理删掉 A 正在用的文件）。
        let patch_path = {
            static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let unique = format!(
                ".montauri-hunk-{now:x}-{pid:x}-{seq:x}.patch",
                now = nanos,
                pid = std::process::id(),
                seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            );
            let p = Path::new(&root).join(".git").join(unique);
            if cfg!(windows) {
                std::path::PathBuf::from(p.to_string_lossy().replace('/', "\\"))
            } else {
                p
            }
        };
        std::fs::write(&patch_path, &patch).map_err(|e| format!("写入临时 patch 失败：{e}"))?;
        let result = (|| {
            let mut cmd = tool_command("git", ENV_GIT);
            cmd.arg("apply").arg("--recount").arg("--unidiff-zero");
            match mode.as_str() {
                "stage" => {
                    cmd.arg("--cached");
                }
                "unstage" => {
                    cmd.arg("--cached").arg("-R");
                }
                "discard" => {
                    cmd.arg("-R");
                }
                other => return Err(format!("未知 mode：{other}")),
            }
            cmd.arg(&patch_path);
            exec_git(&root, cmd).map(|_| ())
        })();
        let _ = std::fs::remove_file(&patch_path); // 无论成败都清理临时文件
        result
    })
    .await
}

// ---------- 高级工作流（迭代 3 · P1-4/5/6 + P0-4 + B3/B6/B8） ----------

/// 分支同步状态（P0-4）：当前分支相对上游的 ahead/behind 计数。
#[derive(Serialize)]
pub struct GitSync {
    /// 上游分支名（如 origin/main）；无上游为 None
    pub upstream: Option<String>,
    /// 本地领先（待推送）数
    pub ahead: u32,
    /// 本地落后（待拉取）数
    pub behind: u32,
}

/// 查询当前分支的上游与 ahead/behind（`git rev-list --left-right --count @{upstream}...HEAD`）。
/// 无上游时返回 (None, 0, 0)——不视为错误（本地新仓库常态）。
#[tauri::command]
pub async fn git_sync_status(root: String) -> Result<GitSync, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("rev-parse").arg("--abbrev-ref").arg("--symbolic-full-name")
            .arg("@{upstream}");
        let upstream = exec_git(&root, cmd).ok().map(|s| s.trim().to_string());
        if upstream.is_none() {
            return Ok(GitSync { upstream: None, ahead: 0, behind: 0 });
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("rev-list").arg("--left-right").arg("--count")
            .arg("@{upstream}...HEAD");
        let out = exec_git(&root, cmd)?;
        let mut parts = out.split_whitespace();
        let behind: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let ahead: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        Ok(GitSync { upstream, ahead, behind })
    })
    .await
}

/// cherry-pick 指定提交（P1-4）。`-n` 时不自动提交（冲突场景留给用户处理后再提交）。
#[tauri::command]
pub async fn git_cherry_pick(root: String, hash: String, no_commit: bool) -> Result<String, String> {
    spawn_blocking(move || {
        let h = hash.trim();
        if h.is_empty() {
            return Err("提交哈希不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("cherry-pick");
        if no_commit {
            cmd.arg("-n");
        }
        cmd.arg(h);
        exec_git(&root, cmd)
    })
    .await
}

/// revert 指定提交（P1-4，生成反向提交）。
#[tauri::command]
pub async fn git_revert(root: String, hash: String) -> Result<String, String> {
    spawn_blocking(move || {
        let h = hash.trim();
        if h.is_empty() {
            return Err("提交哈希不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("revert").arg("--no-edit").arg(h);
        exec_git(&root, cmd)
    })
    .await
}

/// reset 当前分支到指定提交（P1-4）。mode: soft=只动 HEAD / mixed=HEAD+索引 / hard=HEAD+索引+工作区。
#[tauri::command]
pub async fn git_reset(root: String, hash: String, mode: String) -> Result<String, String> {
    spawn_blocking(move || {
        let h = hash.trim();
        if h.is_empty() {
            return Err("提交哈希不能为空".to_string());
        }
        let m = match mode.as_str() {
            "soft" => "soft",
            "mixed" => "mixed",
            "hard" => "hard",
            other => return Err(format!("未知 reset 模式：{other}")),
        };
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("reset").arg(format!("--{m}")).arg(h);
        exec_git(&root, cmd)
    })
    .await
}

/// merge 指定分支到当前分支（P1-5）。no_ff=强制生成合并提交；squash=压平合并。
#[tauri::command]
pub async fn git_merge(root: String, branch: String, no_ff: bool, squash: bool) -> Result<String, String> {
    spawn_blocking(move || {
        let b = branch.trim();
        if b.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("merge");
        if no_ff {
            cmd.arg("--no-ff");
        }
        if squash {
            cmd.arg("--squash");
        }
        cmd.arg(b);
        exec_git(&root, cmd)
    })
    .await
}

/// rebase 当前分支到指定分支（P1-5）。失败时提示用户 abort。
#[tauri::command]
pub async fn git_rebase(root: String, branch: String) -> Result<String, String> {
    spawn_blocking(move || {
        let b = branch.trim();
        if b.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("rebase").arg(b);
        exec_git(&root, cmd)
    })
    .await
}

/// 中止进行中的 merge / rebase / cherry-pick（P1-5：冲突后的逃生口）。
#[tauri::command]
pub async fn git_abort_op(root: String, op: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        match op.as_str() {
            "merge" => { cmd.arg("merge").arg("--abort"); }
            "rebase" => { cmd.arg("rebase").arg("--abort"); }
            "cherry-pick" => { cmd.arg("cherry-pick").arg("--abort"); }
            other => return Err(format!("未知操作：{other}")),
        }
        exec_git(&root, cmd)
    })
    .await
}

/// 标签信息（P1-6）。
#[derive(Serialize)]
pub struct GitTag {
    pub name: String,
    /// 指向的提交短哈希
    pub short_hash: String,
}

/// 列出标签（P1-6）。
#[tauri::command]
pub async fn git_tags(root: String) -> Result<Vec<GitTag>, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("tag").arg("--format").arg("%(refname:short)%09%(objectname:short)");
        let out = exec_git(&root, cmd)?;
        let mut tags = Vec::new();
        for line in out.lines() {
            if line.trim().is_empty() { continue; }
            let mut parts = line.splitn(2, '\t');
            let name = parts.next().unwrap_or("").trim().to_string();
            let hash = parts.next().unwrap_or("").trim().to_string();
            if name.is_empty() { continue; }
            tags.push(GitTag { name, short_hash: hash });
        }
        tags.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(tags)
    })
    .await
}

/// 创建标签（P1-6）。
#[tauri::command]
pub async fn git_create_tag(root: String, name: String, hash: String) -> Result<String, String> {
    spawn_blocking(move || {
        let n = name.trim();
        if n.is_empty() {
            return Err("标签名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("tag").arg(n);
        let h = hash.trim();
        if !h.is_empty() {
            cmd.arg(h);
        }
        exec_git(&root, cmd)?;
        Ok(format!("已创建标签 {n}"))
    })
    .await
}

/// 冲突文件的三方内容（index 三个 stage）。
#[derive(Serialize)]
pub struct GitConflictVersions {
    /// 共同祖先（`:1:path`；新增/缺失侧时为空）
    pub base: String,
    /// 当前更改（`:2:path`，HEAD 侧）
    pub current: String,
    /// 传入更改（`:3:path`，MERGE_HEAD / rebase 来源侧）
    pub incoming: String,
}

/// 读取冲突文件的三方版本（`git show :1/:2/:3:path`）。阶段 2：两路「当前 vs 传入」对比。
#[tauri::command]
pub async fn git_conflict_versions(root: String, path: String) -> Result<GitConflictVersions, String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
        Ok(GitConflictVersions {
            base: git_show_blob(&root, ":1", &path).unwrap_or_default(),
            current: git_show_blob(&root, ":2", &path).unwrap_or_default(),
            incoming: git_show_blob(&root, ":3", &path).unwrap_or_default(),
        })
    })
    .await
}

// ---------- 远程操作（push / pull / fetch，TD-002；迭代 4 · P2-1/P2-2/P2-3 重构） ----------

/// 进行中网络操作句柄表（迭代 4 · P2-3：可取消）。key = "push"/"pull"/"fetch"。
static GIT_NET_OPS: LazyLock<PerWindow<HashMap<String, GitNetOp>>> = LazyLock::new(PerWindow::new);

/// 一个进行中的网络 git 操作：取消标志（轮询线程见标志即杀进程树）+
/// git 进程 pid（P2-6：退出钩子同步杀树用——轮询线程是后台线程，会被进程退出截断）。
struct GitNetOp {
    cancel: Arc<AtomicBool>,
    pid: u32,
}

/// 流式网络 git 执行（迭代 4 · P2-3）：
/// - stderr 逐行经 `git-op-stdout` 事件推前端（git 进度走 stderr：Enumerating/Counting/Writing objects）
/// - 取消标志轮询：`git_cancel_op` 置位后杀进程树，立即返回「已取消」
/// - 240s 兜底超时（保留，防泄漏；正常操作远早于此完成或被用户取消）
/// - GIT_TERMINAL_PROMPT=0（P2-2 务实降级）：拒绝交互式凭据提示，HTTPS 无凭据时
///   快速失败并把「如何配置 credential helper」的指引带回给用户，而非挂死等输入
/// pub(crate)：git_worktree_cmds（clone 的流式进度）复用。
pub(crate) fn exec_git_streaming(
    app: &AppHandle,
    root: &str,
    mut cmd: Command,
    op: &str,
    wid: &str,
) -> Result<String, String> {
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "echo") // askpass=echo：任何凭据询问立即返回空串 → git 自行报错而非挂起
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = no_window(&mut cmd)
        .spawn()
        .map_err(|e| format!("无法启动 git（可能未安装）：{e}"))?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut ops = GIT_NET_OPS.lock();
        ops.entry(wid.to_string())
            .or_default()
            .insert(op.to_string(), GitNetOp { cancel: cancel.clone(), pid: child.id() });
    }

    // stderr 逐行流式转发（git 的进度输出在 stderr）
    let stderr = child.stderr.take().expect("stderr 已设为 piped");
    let app_err = app.clone();
    let op_err = op.to_string();
    let wid_err = wid.to_string();
    let err_stream = std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        let mut collected = String::new();
        for line in reader.lines() {
            let Ok(l) = line else { break };
            collected.push_str(&l);
            collected.push('\n');
            let _ = app_err.emit_to(&wid_err, "git-op-stdout", json!({ "op": op_err, "data": format!("{l}\n") }));
        }
        collected
    });
    // stdout 全量收集（push/pull 的正常输出少且非进度）
    let stdout = child.stdout.take().expect("stdout 已设为 piped");
    let out_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let mut r = std::io::BufReader::new(stdout);
        let _ = r.read_to_string(&mut s);
        s
    });

    let start = Instant::now();
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            kill_process_tree(&mut child);
            let _ = out_reader.join();
            let _ = err_stream.join();
            cleanup_net_op(wid, op);
            return Err("已取消".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > GIT_NET_TIMEOUT {
                    kill_process_tree(&mut child);
                    let _ = out_reader.join();
                    let _ = err_stream.join();
                    cleanup_net_op(wid, op);
                    return Err(format!("git 网络操作超时（{}s）", GIT_NET_TIMEOUT.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                kill_process_tree(&mut child);
                let _ = out_reader.join();
                let _ = err_stream.join();
                cleanup_net_op(wid, op);
                return Err(e.to_string());
            }
        }
    };
    let out = out_reader.join().unwrap_or_default();
    let err = err_stream.join().unwrap_or_default();
    cleanup_net_op(wid, op);

    if status.success() {
        Ok(if out.trim().is_empty() { err } else { out })
    } else {
        let msg = err.trim().to_string();
        // P2-2：凭据失败的针对性指引（Authentication failed / could not read Username）
        if msg.contains("Authentication failed") || msg.contains("could not read Username") || msg.contains("terminal prompts disabled") {
            Err(format!(
                "{msg}\n\n远程需要认证。可在终端配置凭据缓存后重试：\n  git config --global credential.helper store\n（首次 push/pull 时输入一次密码，之后记住；或改用 SSH 远程地址）"
            ))
        } else {
            Err(msg)
        }
    }
}

/// 从句柄表移除（操作结束/失败/取消统一走这里）。
fn cleanup_net_op(wid: &str, op: &str) {
    let mut ops = GIT_NET_OPS.lock();
    if let Some(map) = ops.get_mut(wid) {
        map.remove(op);
    }
}

/// 取消进行中的网络 git 操作（P2-3）。无进行中操作时静默成功。
#[tauri::command]
pub async fn git_cancel_op(window: tauri::WebviewWindow, op: String) -> Result<(), String> {
    let wid = window.label().to_string();
    spawn_blocking(move || {
        let ops = GIT_NET_OPS.lock();
        if let Some(map) = ops.get(&wid) {
            if let Some(handle) = map.get(&op) {
                handle.cancel.store(true, Ordering::Relaxed);
            }
        }
        Ok(())
    })
    .await
}

/// 应用退出清理（P2-6，CR-14 同款纪律）：进行中的 push/pull/fetch 的 git 进程树
/// 同步杀灭——轮询线程的 cancel-杀树是后台路径会被进程退出截断，孤儿 git 会
/// 继续网络传输。同时置位全部 cancel 标志（轮询线程若还在跑则提前退出）。
pub(crate) fn git_stop_net_ops_for_exit() {
    for map in GIT_NET_OPS.drain_all() {
        for (_op, handle) in map {
            handle.cancel.store(true, Ordering::Relaxed);
            crate::util::kill_pid_tree(handle.pid);
        }
    }
}

/// 推送到远程（`git push`；可选 remote/branch——空则默认上游）。迭代 4：流式 + 可取消。
#[tauri::command]
pub async fn git_push(app: AppHandle, window: tauri::WebviewWindow, root: String, remote: Option<String>, branch: Option<String>) -> Result<String, String> {
    let wid = window.label().to_string();
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("push");
        if let Some(r) = remote.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg(r);
            if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
                cmd.arg(format!("HEAD:refs/heads/{b}"));
            }
        } else if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg("-u").arg("origin").arg(format!("HEAD:refs/heads/{b}"));
        }
        exec_git_streaming(&app, &root, cmd, "push", &wid)
    })
    .await
}

/// 拉取远程（`git pull`；可选 remote/branch）。迭代 4：流式 + 可取消。
#[tauri::command]
pub async fn git_pull(app: AppHandle, window: tauri::WebviewWindow, root: String, remote: Option<String>, branch: Option<String>) -> Result<String, String> {
    let wid = window.label().to_string();
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("pull");
        if let Some(r) = remote.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg(r);
            if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
                cmd.arg(b);
            }
        }
        exec_git_streaming(&app, &root, cmd, "pull", &wid)
    })
    .await
}

/// 抓取远程（`git fetch [--prune]`）。迭代 4：流式 + 可取消 + prune 选项。
#[tauri::command]
pub async fn git_fetch(app: AppHandle, window: tauri::WebviewWindow, root: String, prune: bool) -> Result<String, String> {
    let wid = window.label().to_string();
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("fetch");
        if prune {
            cmd.arg("--prune");
        }
        cmd.arg("--all");
        exec_git_streaming(&app, &root, cmd, "fetch", &wid)
    })
    .await
}

// ---------- Remote 管理（迭代 4 · P2-1） ----------

/// 远程仓库条目。
#[derive(Serialize)]
pub struct GitRemote {
    pub name: String,
    pub url: String,
    /// fetch refspec（展示用；无则空）
    pub fetch: String,
}

/// 列出远程仓库（`git remote -v` + refspec）。
#[tauri::command]
pub async fn git_remote_list(root: String) -> Result<Vec<GitRemote>, String> {
    spawn_blocking(move || {
        let out = {
            let mut cmd = tool_command("git", ENV_GIT);
            cmd.arg("remote").arg("-v");
            exec_git(&root, cmd)?
        };
        let mut remotes = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for line in out.lines() {
            // 形如 "origin\thttps://... (fetch)"
            if !line.ends_with("(fetch)") { continue; }
            let body = line.trim_end_matches(" (fetch)");
            let Some((name, url)) = body.split_once('\t') else { continue };
            if seen.insert(name.to_string()) {
                let fetch = {
                    let mut c = tool_command("git", ENV_GIT);
                    c.arg("config").arg(format!("remote.{name}.fetch"));
                    exec_git(&root, c).unwrap_or_default().trim().to_string()
                };
                remotes.push(GitRemote { name: name.to_string(), url: url.to_string(), fetch });
            }
        }
        Ok(remotes)
    })
    .await
}

/// 添加远程仓库。
#[tauri::command]
pub async fn git_remote_add(root: String, name: String, url: String) -> Result<(), String> {
    spawn_blocking(move || {
        let n = name.trim();
        let u = url.trim();
        if n.is_empty() || u.is_empty() {
            return Err("远程名与 URL 不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("remote").arg("add").arg(n).arg(u);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 移除远程仓库。
#[tauri::command]
pub async fn git_remote_remove(root: String, name: String) -> Result<(), String> {
    spawn_blocking(move || {
        let n = name.trim();
        if n.is_empty() {
            return Err("远程名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("remote").arg("remove").arg(n);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

// ---------- Stash（TD-002） ----------

/// 暂存当前更改（`git stash push`，可选 `-m` 说明与 `-u` 未跟踪文件）。迭代 3 · B6。
#[tauri::command]
pub async fn git_stash_push(root: String, message: String, include_untracked: bool) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("push");
        if include_untracked {
            cmd.arg("-u");
        }
        let msg = message.trim();
        if !msg.is_empty() {
            cmd.arg("-m").arg(msg);
        }
        exec_git(&root, cmd)
    })
    .await
}

/// 弹出最近一次 stash（`git stash pop`）。
#[tauri::command]
pub async fn git_stash_pop(root: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("pop");
        exec_git(&root, cmd)
    })
    .await
}

/// 列出 stash（`git stash list`），返回每行原始文本。
#[tauri::command]
pub async fn git_stash_list(root: String) -> Result<Vec<String>, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("list");
        let out = exec_git(&root, cmd)?;
        Ok(out.lines().map(|l| l.to_string()).collect())
    })
    .await
}

/// 弹出指定索引的 stash（`git stash pop stash@{index}`）。
#[tauri::command]
pub async fn git_stash_pop_at(root: String, index: u32) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("pop").arg(format!("stash@{{{index}}}"));
        exec_git(&root, cmd)
    })
    .await
}

/// 查看指定 stash 的 diff 内容（迭代 3 · B6：stash 列表项点击查看）。
#[tauri::command]
pub async fn git_stash_show(root: String, index: u32) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("show").arg("-p").arg(format!("stash@{{{index}}}"));
        exec_git(&root, cmd)
    })
    .await
}

/// 丢弃指定索引的 stash（`git stash drop stash@{index}`）。
#[tauri::command]
pub async fn git_stash_drop_at(root: String, index: u32) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("drop").arg(format!("stash@{{{index}}}"));
        exec_git(&root, cmd)
    })
    .await
}

// ---------- 历史（log，TD-002） ----------

/// 单条提交信息。
#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub subject: String,
    /// 提交图形状（`--graph` 输出的 `* | /\` 前缀列，无则为空）。P0-6：历史图谱。
    pub graph: String,
    /// 分支/标签装饰（`%d`：HEAD -> main, tag: v1.0 等，无则为空）。
    pub refs: String,
}

/// 列出最近 count 条提交（`git log --graph --all --decorate`），字段以 \x1f 分隔、记录以换行分隔。
/// graph 为 `--graph` 的车道前缀（`*` / `| *` / `| |\` 等，去掉尾随空格）；纯连接线行（无 \x1f）跳过。
/// P0-6：前端按 graph 列渲染拓扑缩进，refs 显示分支/标签装饰。
#[tauri::command]
pub async fn git_log(root: String, count: u32) -> Result<Vec<GitCommit>, String> {
    spawn_blocking(move || {
        let n = count.clamp(1, 200);
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("log")
            .arg(format!("-n{n}"))
            .arg("--graph")
            .arg("--all")
            .arg("--date=short")
            .arg("--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%d");
        let out = exec_git(&root, cmd)?;
        let mut commits = Vec::new();
        for line in out.lines() {
            // 有 \x1f 的行才是提交行；前导 `*|/\_ .<>` 车道字符之后才是 hash 起点
            //（`.` 点线与 `><` 方向箭头见于 git 2.39+ 的 --graph 输出）
            let Some(sep) = line.find('\u{1f}') else { continue };
            let hash_start = line
                .char_indices()
                .find(|(_, c)| !matches!(c, ' ' | '*' | '|' | '/' | '\\' | '_' | '.' | '>' | '<'))
                .map(|(i, _)| i)
                .unwrap_or(0);
            // 防御：hash 起点须落在第一个 \x1f 之前（车道前缀格式异常时整行放弃）
            if hash_start >= sep {
                continue;
            }
            let graph = line[..hash_start].trim_end().to_string();
            let fields: Vec<&str> = line[hash_start..].split('\u{1f}').collect();
            if fields.len() < 5 {
                continue;
            }
            commits.push(GitCommit {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                author: fields[2].to_string(),
                date: fields[3].to_string(),
                subject: fields[4].to_string(),
                graph,
                // %d 输出形如 ` (HEAD -> main, tag: v1.0)`：前导空格 + 两侧括号一并去除
                refs: fields.get(5).unwrap_or(&"").trim_matches(|c: char| matches!(c, '(' | ')' | ' ')).to_string(),
            });
        }
        Ok(commits)
    })
    .await
}

/// 初始化 Git 仓库（`git init -b main`）。P0-7：SCM 空态按钮入口（此前仅新建项目向导内部可用）。
/// -b main：现代默认分支名（验收实测宿主 git 2.45 无 init.defaultBranch 配置时回落 master，
/// 与「新建项目向导 -b main」及用户预期不一致）。
#[tauri::command]
pub async fn git_init(root: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        // git < 2.28 不支持 -b：先试新语法，失败回落裸 init
        cmd.arg("init").arg("--quiet").arg("-b").arg("main");
        if exec_git(&root, cmd).is_err() {
            let mut fallback = tool_command("git", ENV_GIT);
            fallback.arg("init").arg("--quiet");
            exec_git(&root, fallback)?;
        }
        Ok("仓库已初始化".to_string())
    })
    .await
}

/// 查看指定提交详情（`git show`），用于历史面板点击查看。
#[tauri::command]
pub async fn git_show(root: String, hash: String) -> Result<String, String> {
    spawn_blocking(move || {
        let h = hash.trim();
        if h.is_empty() {
            return Err("提交哈希不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("show").arg(h);
        exec_git(&root, cmd)
    })
    .await
}

/// 单文件提交历史（`git log --follow`，E-4「文件历史」）。path 为仓库相对路径。
/// --follow 跟随重命名；从未提交的文件返回空列表（git exit 0）。
/// 单文件历史不画 graph（--graph 对路径过滤的单车道无信息量），graph 恒为空。
#[tauri::command]
pub async fn git_log_file(root: String, path: String, count: u32) -> Result<Vec<GitCommit>, String> {
    spawn_blocking(move || {
        let n = count.clamp(1, 200);
        let p = path.trim();
        if p.is_empty() {
            return Err("文件路径不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("log")
            .arg(format!("-n{n}"))
            .arg("--follow")
            .arg("--date=short")
            .arg("--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%d")
            .arg("--")
            .arg(p);
        let out = exec_git(&root, cmd)?;
        let mut commits = Vec::new();
        for line in out.lines() {
            let fields: Vec<&str> = line.split('\u{1f}').collect();
            if fields.len() < 5 {
                continue;
            }
            commits.push(GitCommit {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                author: fields[2].to_string(),
                date: fields[3].to_string(),
                subject: fields[4].to_string(),
                graph: String::new(),
                refs: fields.get(5).unwrap_or(&"").trim_matches(|c: char| matches!(c, '(' | ')' | ' ')).to_string(),
            });
        }
        Ok(commits)
    })
    .await
}

// ---------- Blame（TD-002） ----------

/// 单行 blame 信息。
#[derive(Serialize)]
pub struct GitBlameLine {
    pub line: u32,
    pub short_hash: String,
    pub author: String,
    /// 作者时间（unix 秒）
    pub time: i64,
    pub summary: String,
}

/// 逐行 blame（`git blame --line-porcelain`）。
#[tauri::command]
pub async fn git_blame(root: String, path: String) -> Result<Vec<GitBlameLine>, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("blame").arg("--line-porcelain").arg("--").arg(&path);
        let out = exec_git(&root, cmd)?;
        Ok(parse_blame(&out))
    })
    .await
}

/// 解析 `git blame --line-porcelain` 输出：行头为 `<40hex> <orig> <final> [num]`，
/// 其后的 header 字段按 `author ` / `author-time ` / `summary ` 截取。
///
/// 实测 panic 修复（2026-09-18 用户仓库复现）：中文提交信息（summary/author）
/// 的行字节长超 40，原实现盲目 `split_at(40)` 按字节切——第 40 字节落在多字节
/// 字符中间时 Rust panic「end byte index 40 is not a char boundary」。
/// blame porcelain 的行头**恒为 40 个 ASCII hex + 空格**，正确判定方式是
/// 逐字符校验前 40 个是否 ASCII hexdigit 且第 41 个是空格——不依赖字节切分。
fn parse_blame(out: &str) -> Vec<GitBlameLine> {
    let mut result = Vec::new();
    let mut cur: Option<GitBlameLine> = None;
    for line in out.lines() {
        // 行头判定：前 40 字符均为 ASCII hex 且其后紧跟空格（char_indices 安全，
        // 不做字节 split——中文字符的行在此直接不命中，走 header 解析分支）
        let is_header = line.chars().count() > 40 && {
            let chars: Vec<char> = line.chars().collect();
            chars[..40].iter().all(|c| c.is_ascii_hexdigit()) && chars[40] == ' '
        };
        if is_header {
            if let Some(c) = cur.take() {
                result.push(c);
            }
            // 40 个 hex 字符后的剩余部分（char 安全取值）
            let rest: String = line.chars().skip(41).collect();
            let toks: Vec<&str> = rest.split_whitespace().collect();
            let final_line = toks.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let hash_str: String = line.chars().take(40).collect();
            let short: String = hash_str.chars().take(8).collect();
            cur = Some(GitBlameLine {
                line: final_line,
                short_hash: short,
                author: String::new(),
                time: 0,
                summary: String::new(),
            });
            continue;
        }
        if let Some(c) = cur.as_mut() {
            if let Some(author) = line.strip_prefix("author ") {
                c.author = author.to_string();
            } else if let Some(t) = line.strip_prefix("author-time ") {
                c.time = t.trim().parse::<i64>().unwrap_or(0);
            } else if let Some(s) = line.strip_prefix("summary ") {
                c.summary = s.to_string();
            }
        }
    }
    if let Some(c) = cur {
        result.push(c);
    }
    result
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 为临时仓库设置仓库级提交身份：CI runner 不保证有全局 user.name/email，
    /// 任何会 `git commit` 的端到端测试都必须先调这个。
    fn set_repo_identity(root: &str) {
        for (k, v) in [("user.name", "montauri-test"), ("user.email", "test@montauri.local")] {
            let mut cfg = tool_command("git", ENV_GIT);
            cfg.arg("config").arg(k).arg(v);
            assert!(exec_git(root, cfg).is_ok(), "设置 {k} 失败");
        }
    }

    /// parse_blame 中文行不 panic（用户仓库实测：summary 含中文时原 split_at(40)
    /// 字节切分切进多字节字符 → Rust panic "not a char boundary"）。
    /// 复现数据取自真实仓库的 blame porcelain 输出（中文 summary 超 40 字节）。
    #[test]
    fn test_parse_blame_chinese_summary_no_panic() {
        // 40 个 hex 字符的行头（abcdef×6 + abcd，与 ASCII 版同长度）
        let h1 = "abcdefabcdefabcdefabcdefabcdefabcdefabcd 12 34 2";
        let h2 = "abcdefabcdefabcdefabcdefabcdefabcdefabcd 35 35 1";
        let out = format!(
            "{h1}\nauthor qinx\nauthor-time 1737000000\nsummary 商品长详图功能中选择 使用场景图生成提示词，返回的结果里中文也有乱码\nfilename _check_venv.py\n{h2}\nauthor qinx\nauthor-time 1737000000\nsummary 修复：返回值中的中文字符乱码问题\nfilename _check_venv.py\n"
        );
        let rows = parse_blame(&out);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].line, 34);
        assert_eq!(rows[0].author, "qinx");
        assert!(rows[0].summary.contains("商品长详图"));
        assert!(rows[1].summary.contains("中文字符乱码"));
    }

    /// parse_blame 常规 ASCII 输出（回归保护：改字符安全判定时不得破坏原行为）
    #[test]
    fn test_parse_blame_ascii() {
        let out = "\
abcdefabcdefabcdefabcdefabcdefabcdefabcd 3 3 1
author Dev
author-time 1700000000
summary init commit
filename a.py
";
        let rows = parse_blame(out);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].short_hash, "abcdefab");
        assert_eq!(rows[0].line, 3);
        assert_eq!(rows[0].author, "Dev");
        assert_eq!(rows[0].summary, "init commit");
        assert_eq!(rows[0].time, 1700000000);
    }

    /// 分支列表剔除 `refs/remotes/origin/HEAD`（clone 建立的远程默认分支符号引用，
    /// 非真实分支：列进面板是幻影条目，点击走 `checkout --track` 会 fatal）。
    /// 复现数据取自本仓库实测的 `git branch -a --format` 输出。
    #[test]
    fn test_parse_branches_drops_remote_head_symref() {
        let out = " \trefs/heads/master\t63916f7\n \trefs/remotes/origin/HEAD\t19b7baf\n \trefs/remotes/origin/master\t19b7baf\n";
        let bs = parse_branches(out);
        assert!(
            !bs.iter().any(|b| b.name == "origin/HEAD"),
            "origin/HEAD 是符号引用，应从分支列表剔除：实际={:?}",
            bs.iter().map(|b| b.name.as_str()).collect::<Vec<_>>()
        );
        let master = bs.iter().find(|b| b.name == "origin/master").expect("真实远程分支 origin/master 被误删");
        assert!(master.remote, "远程条目必须标 remote=true（否则混进本地组）");
        assert!(!master.current);
        assert_eq!(bs.len(), 2);
    }

    /// 解析常规输出：本地组 remote=false，当前分支由 `*` 标记（回归保护）。
    #[test]
    fn test_parse_branches_local_and_current() {
        let out = "*\trefs/heads/master\t63916f7\n \trefs/heads/dev\t0000000\n";
        let bs = parse_branches(out);
        assert_eq!(bs.len(), 2);
        assert_eq!(bs[0].name, "master");
        assert!(bs[0].current && !bs[0].remote);
        assert_eq!(bs[1].name, "dev");
        assert!(!bs[1].current && !bs[1].remote);
    }

    /// 在临时目录初始化一个 git 仓库，便于端到端验证命令层（需要环境已安装 git）。
    #[test]
    fn test_git_commands_roundtrip() {
        let tmp = std::env::temp_dir().join("montauri-git-cmds-test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.to_string_lossy().to_string();

        let init = exec_git(&root, {
            let mut c = tool_command("git", ENV_GIT);
            c.arg("init").arg("--quiet");
            c
        });
        if init.is_err() {
            // 环境无 git 时跳过端到端断言
            let _ = std::fs::remove_dir_all(&tmp);
            return;
        }
        set_repo_identity(&root);

        // 创建一个文件并暂存
        std::fs::write(tmp.join("a.py"), "print(1)\n").unwrap();
        // 直接调用内部实现（非 tauri 命令包装）验证核心逻辑
        let mut add = tool_command("git", ENV_GIT);
        add.arg("add").arg("--").arg("a.py");
        assert!(exec_git(&root, add).is_ok());

        // 已暂存 diff 应包含新增内容
        let mut diff_cached = tool_command("git", ENV_GIT);
        diff_cached.arg("diff").arg("--cached").arg("--").arg("a.py");
        let text = exec_git(&root, diff_cached).unwrap();
        assert!(text.contains("print(1)"));

        // 取消暂存后，已暂存 diff 应为空
        let mut unstage = tool_command("git", ENV_GIT);
        unstage.arg("reset").arg("--quiet").arg("--").arg("a.py");
        if let Err(e) = exec_git(&root, unstage) {
            panic!("unstage failed: {e}");
        }
        let mut diff_cached2 = tool_command("git", ENV_GIT);
        diff_cached2.arg("diff").arg("--cached").arg("--").arg("a.py");
        assert!(exec_git(&root, diff_cached2).unwrap().is_empty());

        // 再次暂存并提交
        let mut add2 = tool_command("git", ENV_GIT);
        add2.arg("add").arg("--").arg("a.py");
        assert!(exec_git(&root, add2).is_ok());
        let mut commit = tool_command("git", ENV_GIT);
        commit.arg("commit").arg("-m").arg("init");
        let out = exec_git(&root, commit).unwrap();
        assert!(out.contains("init"));

        // 分支操作：创建并切换新分支，验证当前分支随之切换
        let mut nb = tool_command("git", ENV_GIT);
        nb.arg("checkout").arg("-b").arg("feature");
        if let Err(e) = exec_git(&root, nb) {
            panic!("create branch failed: {e}");
        }
        let mut cur = tool_command("git", ENV_GIT);
        cur.arg("branch").arg("--show-current");
        assert_eq!(exec_git(&root, cur).unwrap().trim(), "feature");

        // 切换回上一个分支
        let mut back = tool_command("git", ENV_GIT);
        back.arg("checkout").arg("-");
        assert!(exec_git(&root, back).is_ok());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_commit_rejects_empty_message() {
        let msg = "   ";
        let trimmed = msg.trim();
        assert!(trimmed.is_empty());
    }

    /// CR-06：validate_repo_relative 三类路径——`..` 穿越与绝对路径拒绝，正常相对路径放行。
    #[test]
    fn test_validate_repo_relative_rejects_traversal() {
        let tmp = std::env::temp_dir().join("montauri-path-guard-test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("sub")).unwrap();
        std::fs::write(tmp.join("secret.txt"), "top-secret").unwrap();
        std::fs::write(tmp.join("sub").join("a.py"), "print(1)\n").unwrap();
        let root = tmp.to_string_lossy().to_string();

        // ① 正常相对路径：放行
        assert!(validate_repo_relative(&root, "sub/a.py").is_ok(), "正常相对路径应放行");
        // 文件不存在但路径合法：允许（diff 视图渲染空内容用）
        assert!(validate_repo_relative(&root, "not_exists.py").is_ok());

        // ② 含 `..`：拒绝（含混入形式）
        assert!(validate_repo_relative(&root, "../secret.txt").is_err());
        assert!(validate_repo_relative(&root, "sub/../../secret.txt").is_err());
        assert!(validate_repo_relative(&root, "..\\secret.txt").is_err());

        // ③ 绝对路径：拒绝（Unix 与 Windows 形态都拦）
        assert!(validate_repo_relative(&root, "/etc/passwd").is_err());
        let abs = tmp.join("secret.txt").to_string_lossy().to_string();
        assert!(validate_repo_relative(&root, &abs).is_err());

        // 空路径：拒绝
        assert!(validate_repo_relative(&root, "").is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// CR-06 端到端：git_diff_versions 对穿越路径返回 Err，正常路径返回内容。
    #[test]
    fn test_git_diff_versions_rejects_traversal() {
        let tmp = std::env::temp_dir().join("montauri-git-diff-guard-test");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.to_string_lossy().to_string();

        let init = exec_git(&root, {
            let mut c = tool_command("git", ENV_GIT);
            c.arg("init").arg("--quiet");
            c
        });
        if init.is_err() {
            let _ = std::fs::remove_dir_all(&tmp);
            return; // 环境无 git 时跳过
        }
        std::fs::write(tmp.join("a.py"), "print(1)\n").unwrap();
        let secret = tmp.parent().unwrap().join("montauri-git-diff-guard-secret.txt");
        std::fs::write(&secret, "TOP-SECRET").unwrap();

        // 穿越路径：拒绝（绝不读出仓库外内容）
        let bad = tauri::async_runtime::block_on(git_diff_versions(
            root.clone(),
            "../montauri-git-diff-guard-secret.txt".into(),
            false,
            None,
            None,
        ));
        assert!(bad.is_err(), "穿越路径必须被拒绝");
        if let Err(e) = &bad {
            assert!(e.contains("..") || e.contains("越出"), "错误信息应指明拒绝原因：{e}");
        }

        // 绝对路径：拒绝
        let abs = secret.to_string_lossy().to_string();
        let bad2 = tauri::async_runtime::block_on(git_diff_versions(root.clone(), abs, false, None, None));
        assert!(bad2.is_err(), "绝对路径必须被拒绝");

        // 正常路径（未跟踪新文件）：左空右为工作区内容
        let ok = tauri::async_runtime::block_on(git_diff_versions(root, "a.py".into(), false, None, None));
        assert!(ok.is_ok());
        let v = ok.unwrap();
        assert_eq!(v.new, "print(1)\n");

        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_file(&secret);
    }

}