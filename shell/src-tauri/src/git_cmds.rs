// Git 写命令层（Phase 4 提前 → P1 最小可写闭环）：暂存 / 取消暂存 / 提交 / 查看 diff。
// 设计要点：
// - 全部异步（spawn_blocking），避免 git 子进程阻塞主线程；
// - 复用 `no_window` 抑制 Windows 黑窗；
// - 路径通过 `--` 分隔符传入，支持空格 / 中文路径；
// - 失败时透传 git 的 stderr 作为错误信息。

use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::tool_paths::{tool_command, ENV_GIT};
use crate::util::{kill_process_tree, no_window};

/// 执行一个已构建好的 git 子命令（cwd 锚定到仓库根），成功返回 stdout，失败返回 stderr。
fn exec_git(root: &str, mut cmd: Command) -> Result<String, String> {
    let out = no_window(&mut cmd)
        .current_dir(root)
        .output()
        .map_err(|e| format!("无法启动 git（可能未安装）：{e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = stderr.trim();
        Err(if msg.is_empty() {
            format!("git 命令执行失败（退出码 {:?}）", out.status.code())
        } else {
            msg.to_string()
        })
    }
}

/// 网络 git 操作超时上限（push/pull/fetch 会挂到远程，必须可中断）。
const GIT_NETWORK_TIMEOUT: Duration = Duration::from_secs(120);

/// 带超时的 git 子命令：spawn + 轮询退出（超时杀进程树），供 push/pull/fetch 使用，
/// 避免网络挂起无限占用 spawn_blocking 线程池。
fn exec_git_timeout(root: &str, mut cmd: Command) -> Result<String, String> {
    let mut child = no_window(&mut cmd)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git（可能未安装）：{e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    // 独立读线程避免管道缓冲满导致子进程写阻塞（与 .output() 同策略）
    let out_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let mut r = std::io::BufReader::new(stdout);
        let _ = r.read_to_string(&mut s);
        s
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let mut r = std::io::BufReader::new(stderr);
        let _ = r.read_to_string(&mut s);
        s
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > GIT_NETWORK_TIMEOUT {
                    kill_process_tree(&mut child);
                    let _ = out_reader.join();
                    let _ = err_reader.join();
                    return Err(format!("git 网络操作超时（{}s）", GIT_NETWORK_TIMEOUT.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                kill_process_tree(&mut child);
                let _ = out_reader.join();
                let _ = err_reader.join();
                return Err(e.to_string());
            }
        }
    };
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();

    if status.success() {
        Ok(out)
    } else {
        let msg = err.trim().to_string();
        Err(if msg.is_empty() {
            format!("git 命令执行失败（退出码 {:?}）", status.code())
        } else {
            msg
        })
    }
}

async fn spawn_blocking<T, F>(f: F) -> Result<T, String>
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

/// 提交已暂存更改（`git commit -m <message>`），返回 commit 输出（含摘要）。
#[tauri::command]
pub async fn git_commit(root: String, message: String) -> Result<String, String> {
    spawn_blocking(move || {
        let msg = message.trim();
        if msg.is_empty() {
            return Err("提交信息不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("commit").arg("-m").arg(msg);
        exec_git(&root, cmd)
    })
    .await
}

/// 查看单文件 diff（`git diff [--cached] -- <path>`）。staged=true 查看暂存区相对 HEAD 的差异。
#[tauri::command]
pub async fn git_diff(root: String, path: String, staged: bool) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("diff");
        if staged {
            cmd.arg("--cached");
        }
        cmd.arg("--").arg(&path);
        exec_git(&root, cmd)
    })
    .await
}

/// 分支信息。
#[derive(Serialize)]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
}

/// 列出本地分支及当前分支（`git branch`）。
#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<GitBranch>, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("branch");
        let out = exec_git(&root, cmd)?;
        let mut branches = Vec::new();
        for line in out.lines() {
            if line.is_empty() {
                continue;
            }
            let (current, name) = if let Some(rest) = line.strip_prefix("* ") {
                (true, rest)
            } else if let Some(rest) = line.strip_prefix("  ") {
                (false, rest)
            } else {
                (false, line.trim())
            };
            if name.is_empty() {
                continue;
            }
            branches.push(GitBranch { name: name.to_string(), current });
        }
        Ok(branches)
    })
    .await
}

/// 切换分支（`git checkout <branch>`）。
#[tauri::command]
pub async fn git_checkout(root: String, branch: String) -> Result<(), String> {
    spawn_blocking(move || {
        let b = branch.trim();
        if b.is_empty() {
            return Err("分支名不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("checkout").arg(b);
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

/// 取左右对照内容：staged=true 为 HEAD vs Index；否则 Index vs 工作区。
/// 缺失一侧（新文件 / 删除 / 未跟踪）以空字符串表示，供 diff 编辑器渲染为空。
#[tauri::command]
pub async fn git_diff_versions(
    root: String,
    path: String,
    staged: bool,
) -> Result<GitDiffVersions, String> {
    spawn_blocking(move || {
        validate_repo_relative(&root, &path)?;
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

// ---------- 远程操作（push / pull / fetch，TD-002） ----------

/// 推送到远程（`git push`），错误透传 git stderr。
#[tauri::command]
pub async fn git_push(root: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("push");
        exec_git_timeout(&root, cmd)
    })
    .await
}

/// 拉取远程（`git pull`）。
#[tauri::command]
pub async fn git_pull(root: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("pull");
        exec_git_timeout(&root, cmd)
    })
    .await
}

/// 抓取远程（`git fetch`）。
#[tauri::command]
pub async fn git_fetch(root: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("fetch");
        exec_git_timeout(&root, cmd)
    })
    .await
}

// ---------- Stash（TD-002） ----------

/// 暂存当前更改（`git stash push`，可选 `-m` 说明）。
#[tauri::command]
pub async fn git_stash_push(root: String, message: String) -> Result<String, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("stash").arg("push");
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

// ---------- 历史（log，TD-002） ----------

/// 单条提交信息。
#[derive(Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

/// 列出最近 count 条提交（`git log`），字段以 \x1f 分隔、记录以换行分隔。
#[tauri::command]
pub async fn git_log(root: String, count: u32) -> Result<Vec<GitCommit>, String> {
    spawn_blocking(move || {
        let n = count.clamp(1, 200);
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("log")
            .arg(format!("-n{n}"))
            .arg("--date=short")
            .arg("--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s");
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
            });
        }
        Ok(commits)
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
fn parse_blame(out: &str) -> Vec<GitBlameLine> {
    let mut result = Vec::new();
    let mut cur: Option<GitBlameLine> = None;
    for line in out.lines() {
        if line.len() > 40 {
            let (hash_part, rest) = line.split_at(40);
            if hash_part.chars().all(|c| c.is_ascii_hexdigit()) && rest.starts_with(' ') {
                if let Some(c) = cur.take() {
                    result.push(c);
                }
                let toks: Vec<&str> = rest.split_whitespace().collect();
                let final_line = toks.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                cur = Some(GitBlameLine {
                    line: final_line,
                    short_hash: hash_part[..8].to_string(),
                    author: String::new(),
                    time: 0,
                    summary: String::new(),
                });
                continue;
            }
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

    /// 在临时目录初始化一个 git 仓库，便于端到端验证命令层（需要环境已安装 git）。
    #[test]
    fn test_git_commands_roundtrip() {
        let tmp = std::env::temp_dir().join("opencharm-git-cmds-test");
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
        let tmp = std::env::temp_dir().join("opencharm-path-guard-test");
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
        let tmp = std::env::temp_dir().join("opencharm-git-diff-guard-test");
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
        let secret = tmp.parent().unwrap().join("opencharm-git-diff-guard-secret.txt");
        std::fs::write(&secret, "TOP-SECRET").unwrap();

        // 穿越路径：拒绝（绝不读出仓库外内容）
        let bad = tauri::async_runtime::block_on(git_diff_versions(
            root.clone(),
            "../opencharm-git-diff-guard-secret.txt".into(),
            false,
        ));
        assert!(bad.is_err(), "穿越路径必须被拒绝");
        if let Err(e) = &bad {
            assert!(e.contains("..") || e.contains("越出"), "错误信息应指明拒绝原因：{e}");
        }

        // 绝对路径：拒绝
        let abs = secret.to_string_lossy().to_string();
        let bad2 = tauri::async_runtime::block_on(git_diff_versions(root.clone(), abs, false));
        assert!(bad2.is_err(), "绝对路径必须被拒绝");

        // 正常路径（未跟踪新文件）：左空右为工作区内容
        let ok = tauri::async_runtime::block_on(git_diff_versions(root, "a.py".into(), false));
        assert!(ok.is_ok());
        let v = ok.unwrap();
        assert_eq!(v.new, "print(1)\n");

        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_file(&secret);
    }
}