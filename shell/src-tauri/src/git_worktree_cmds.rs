// Git worktree 与 clone 域（2026-10-09 自 git_cmds.rs 拆分，纯搬运零语义变更）：
// worktree 三命令（list/add/remove · 迭代 5 P2-9）+ clone 两命令（clone/default_branch ·
// 迭代 6 P3-1）+ clone 专属校验辅助（validate_clone_url / validate_clone_target /
// split_clone_target）。
//
// 共享执行设施留在 git_cmds.rs 并 pub(crate) 导出，本文件经 use 引用：
//   · exec_git / spawn_blocking（普通子进程执行）
//   · exec_git_streaming / GIT_NET_OPS（流式可取消网络操作——clone 复用同款进度事件）
//
// 冻结线纪律（同 env_cmds / search_cmds 先例）：新增 worktree/clone 类命令落本文件，
// git_cmds.rs 只承载暂存/提交/分支/diff/远程/stash/log/blame 等核心工作流。

use serde::Serialize;
use std::path::Path;

use tauri::AppHandle;

use crate::git_cmds::{exec_git, exec_git_streaming, spawn_blocking};
use crate::tool_paths::{tool_command, ENV_GIT};

// ---------- Worktree（迭代 5 · P2-9） ----------

/// worktree 条目。
#[derive(Serialize)]
pub struct GitWorktree {
    /// 绝对路径
    pub path: String,
    /// 检出的分支（detached 为 None）
    pub branch: Option<String>,
    /// 是否主工作树（仓库本体）
    pub main: bool,
}

/// 列出 worktree（`git worktree list --porcelain`）。
#[tauri::command]
pub async fn git_worktree_list(root: String) -> Result<Vec<GitWorktree>, String> {
    spawn_blocking(move || {
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("worktree").arg("list").arg("--porcelain");
        let out = exec_git(&root, cmd)?;
        let mut trees = Vec::new();
        let mut path = String::new();
        let mut branch: Option<String> = None;
        let mut main = false;
        let mut started = false;
        let flush = |trees: &mut Vec<GitWorktree>, path: &str, branch: Option<String>, main: bool| {
            if !path.is_empty() {
                trees.push(GitWorktree { path: path.to_string(), branch, main });
            }
        };
        for line in out.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                if started {
                    flush(&mut trees, &path, branch.take(), main);
                }
                path = p.to_string();
                main = false;
                started = true;
            } else if let Some(b) = line.strip_prefix("branch ") {
                // refs/heads/xxx → xxx
                branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line.trim() == "detached" {
                branch = None;
            } else if line.trim() == "bare" {
                main = true; // bare 也标 main（不可操作）
            }
        }
        if started {
            flush(&mut trees, &path, branch, main);
        }
        // 第一项即主工作树
        if let Some(first) = trees.first_mut() {
            first.main = true;
        }
        Ok(trees)
    })
    .await
}

/// 添加 worktree（检出已有分支或新建）。
#[tauri::command]
pub async fn git_worktree_add(
    root: String,
    path: String,
    branch: String,
    new_branch: Option<bool>,
) -> Result<(), String> {
    spawn_blocking(move || {
        let p = path.trim();
        if p.is_empty() {
            return Err("worktree 路径不能为空".to_string());
        }
        if Path::new(p).exists() {
            return Err(format!("目标路径已存在：{p}"));
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("worktree").arg("add");
        if new_branch.unwrap_or(false) {
            cmd.arg("-b").arg(&branch);
        } else {
            cmd.arg(&branch);
        }
        cmd.arg(p);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

/// 移除 worktree（force 时强制删除有未提交改动的树）。
#[tauri::command]
pub async fn git_worktree_remove(root: String, path: String, force: bool) -> Result<(), String> {
    spawn_blocking(move || {
        let p = path.trim();
        if p.is_empty() {
            return Err("worktree 路径不能为空".to_string());
        }
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("worktree").arg("remove");
        if force {
            cmd.arg("--force");
        }
        cmd.arg(p);
        exec_git(&root, cmd)?;
        Ok(())
    })
    .await
}

// ---------- Clone（迭代 6 · P3-1） ----------

/// scheme 白名单校验。
fn validate_clone_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("克隆 URL 不能为空".to_string());
    }
    let scheme = if let Some(pos) = trimmed.find("://") {
        trimmed[..pos].to_lowercase()
    } else if trimmed.starts_with("git@") {
        "ssh".to_string()
    } else {
        return Err("URL 格式无效：缺少协议（如 https:// 或 git@）".to_string());
    };
    let allowed = ["https", "http", "ssh", "git", "file"];
    if !allowed.contains(&scheme.as_str()) {
        return Err(format!("不支持的 URL 协议：{scheme}"));
    }
    Ok(())
}

/// 目标路径安全校验：非空、不含 ..、必须是绝对路径。
fn validate_clone_target(target: &str) -> Result<(), String> {
    let t = target.trim();
    if t.is_empty() {
        return Err("目标路径不能为空".to_string());
    }
    let p = Path::new(t);
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("目标路径不得包含 ..".to_string());
    }
    if !p.is_absolute() {
        return Err("目标路径必须是绝对路径".to_string());
    }
    Ok(())
}

/// 从绝对路径提取父目录（作为 git clone 的 cwd）和目标目录名。
/// Windows 下把正斜杠替换为反斜杠，与 git_apply_hunk 同款经验。
fn split_clone_target(target: &str) -> Result<(String, String), String> {
    let normalized = if cfg!(windows) {
        target.replace('/', "\\")
    } else {
        target.to_string()
    };
    let path = Path::new(&normalized);
    let parent = path
        .parent()
        .and_then(|p| p.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| ".".to_string());
    let dir_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "repo".to_string());
    Ok((parent, dir_name))
}

/// 克隆远端仓库（迭代 6 · P3-1）。
/// 流式 + 可取消（op key = "clone"），复用 exec_git_streaming。
#[tauri::command]
pub async fn git_clone(
    app: AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    target_dir: String,
    depth: Option<u32>,
    branch: Option<String>,
) -> Result<String, String> {
    let wid = window.label().to_string();
    spawn_blocking(move || {
        let u = url.trim();
        validate_clone_url(u)?;
        let t = target_dir.trim();
        validate_clone_target(t)?;
        let (parent, dir_name) = split_clone_target(t)?;

        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("clone").arg("--progress");
        if let Some(d) = depth {
            cmd.arg("--depth").arg(d.to_string());
        }
        if let Some(b) = branch.as_deref().filter(|s| !s.is_empty()) {
            cmd.arg("--branch").arg(b);
        }
        cmd.arg(u).arg(&dir_name);
        exec_git_streaming(&app, &parent, cmd, "clone", &wid)
    })
    .await
}

/// 查询远端仓库的默认分支（`git ls-remote --symref`）。
/// 流式 + 可取消（op key = "clone-inspect"）。
#[tauri::command]
pub async fn git_default_branch(
    app: AppHandle,
    window: tauri::WebviewWindow,
    url: String,
) -> Result<String, String> {
    let wid = window.label().to_string();
    spawn_blocking(move || {
        let u = url.trim();
        validate_clone_url(u)?;
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.arg("ls-remote").arg("--symref").arg(u).arg("HEAD");
        let out = exec_git_streaming(&app, ".", cmd, "clone-inspect", &wid)?;
        for line in out.lines() {
            if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
                if let Some((branch, _)) = rest.split_once('\t') {
                    return Ok(branch.to_string());
                }
            }
        }
        Ok("HEAD".to_string())
    })
    .await
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    /// 与 git_cmds::tests::set_repo_identity 同款（测试 mod 私有无法跨文件复用，复制一份）
    fn set_repo_identity(root: &str) {
        for (k, v) in [("user.name", "montauri-test"), ("user.email", "test@montauri.local")] {
            let mut cfg = tool_command("git", ENV_GIT);
            cfg.arg("config").arg(k).arg(v);
            assert!(exec_git(root, cfg).is_ok(), "设置 {k} 失败");
        }
    }

    #[test]
    fn test_validate_clone_url() {
        assert!(validate_clone_url("https://github.com/user/repo.git").is_ok());
        assert!(validate_clone_url("git@github.com:user/repo.git").is_ok());
        assert!(validate_clone_url("file:///local/path").is_ok());
        assert!(validate_clone_url("  https://example.com/x  ").is_ok());
        assert!(validate_clone_url("").is_err());
        assert!(validate_clone_url("github.com/user/repo").is_err());
        assert!(validate_clone_url("ftp://example.com/repo").is_err());
        assert!(validate_clone_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn test_validate_clone_target() {
        #[cfg(unix)]
        let ok = "/tmp/target-dir";
        #[cfg(windows)]
        let ok = "D:\\tmp\\target-dir";
        assert!(validate_clone_target(ok).is_ok());
        assert!(validate_clone_target("").is_err());
        assert!(validate_clone_target("relative/path").is_err());
        assert!(validate_clone_target("../escape").is_err());
    }

    #[test]
    fn test_split_clone_target() {
        #[cfg(unix)]
        let (p, n) = split_clone_target("/home/user/repos/my-project").unwrap();
        #[cfg(windows)]
        let (p, n) = split_clone_target("D:\\repos\\my-project").unwrap();
        assert_eq!(n, "my-project");
        #[cfg(unix)]
        assert!(p.starts_with('/'));
        #[cfg(windows)]
        assert!(p.contains("repos"));
    }

    /// git_clone 端到端：本地 file:// 源仓库 → clone 到临时目录 → 验证文件存在。
    /// 需环境已安装 git；无 git 时静默跳过。
    #[test]
    fn test_git_clone_roundtrip() {
        let tmp = std::env::temp_dir().join("montauri-git-clone-e2e");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // 初始化源仓库
        let source = tmp.join("source");
        std::fs::create_dir_all(&source).unwrap();
        let init = exec_git(source.to_str().unwrap(), {
            let mut c = tool_command("git", ENV_GIT);
            c.arg("init").arg("--quiet").arg("-b").arg("main");
            c
        });
        if init.is_err() {
            let _ = std::fs::remove_dir_all(&tmp);
            return; // 环境无 git
        }

        std::fs::write(source.join("README.md"), "# Test\n").unwrap();
        let mut add = tool_command("git", ENV_GIT);
        add.arg("add").arg("README.md");
        assert!(exec_git(source.to_str().unwrap(), add).is_ok());
        set_repo_identity(source.to_str().unwrap());
        let mut commit = tool_command("git", ENV_GIT);
        commit.arg("commit").arg("-m").arg("init").arg("--no-gpg-sign");
        assert!(exec_git(source.to_str().unwrap(), commit).is_ok());

        // 验证 split_clone_target
        let (parent, dir_name) = split_clone_target(
            tmp.join("cloned").to_str().unwrap()
        ).unwrap();
        assert_eq!(dir_name, "cloned");

        // clone 时禁用 autocrlf（经 GIT_CONFIG_COUNT 注入，优先级压过 system/global 配置）：
        // 本机/CI 的 core.autocrlf 会把 checkout 出来的 LF 转 CRLF，环境差异污染下面的逐字节断言
        let mut cmd = tool_command("git", ENV_GIT);
        cmd.env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "core.autocrlf")
            .env("GIT_CONFIG_VALUE_0", "false");
        cmd.arg("clone").arg("--progress");
        let file_url = format!("file://{}", source.to_str().unwrap());
        cmd.arg(&file_url).arg(&dir_name);
        let result = exec_git(&parent, cmd);
        assert!(result.is_ok(), "clone 失败：{:?}", result.err());

        // 验证克隆产物
        let cloned_readme = tmp.join("cloned").join("README.md");
        assert!(cloned_readme.is_file(), "克隆后 README.md 应存在");
        let content = std::fs::read_to_string(&cloned_readme).unwrap();
        assert_eq!(content, "# Test\n");

        // 验证默认分支解析（直接调用内部 parse 逻辑）
        let mut ls = tool_command("git", ENV_GIT);
        ls.arg("ls-remote").arg("--symref").arg(&file_url).arg("HEAD");
        let ls_out = exec_git(".", ls).unwrap();
        let mut found = false;
        for line in ls_out.lines() {
            if let Some(rest) = line.strip_prefix("ref: refs/heads/") {
                if let Some((branch, _)) = rest.split_once('\t') {
                    assert_eq!(branch, "main");
                    found = true;
                    break;
                }
            }
        }
        assert!(found, "应解析出默认分支 main");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
