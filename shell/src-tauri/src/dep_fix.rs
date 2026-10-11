// 依赖修复（Dep Health M1，docs/dep_health_dev_plan.md）：dep 域后半段——代码层探针执行
// 与 mtime 增量缓存 / diff 纯计算 / dep_scan 编排 / 忽略清单 / 修复动作（§5.1 动作矩阵）。
// **写环境 / 写声明的唯一入口**（决策 R5）：检测层只读不写，任何收敛动作都源于用户显式
// 操作（面板 / 灯泡 / 横幅确认），本模块经 `dep_fix` 命令流式执行 uv 并返回 exit code；
// 收尾协议（重算 diff → restartEngine → toast）由前端编排（§5.2）。
//
// 2026-10-07 自 env_cmds.rs 拆分（P0-4「先冻结再择机拆」执行）：承载 dep 域后半段，
// dep_health.rs 承载前半段（探针脚本常量 + 声明层 + 环境层 + E5 lock）。跨段互通项经
// pub(crate) 暴露（见各符号注释）。
//
// 命令分层（§4.5 耗时级）：`dep_scan`/`dep_env_snapshot` L1+L2 异步全量（spawn_blocking）；
// `dep_ignore_list`/`dep_ignore_add`/`dep_ignore_remove` 同步纯 fs；`dep_fix` 异步流式。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use crate::dep_health::{
    check_lock_out_of_date, detect_style, normalize_dist, parse_pyproject_deps,
    parse_requirements_declared, parse_uv_lock_names, scan_list_packages,
    DeclaredDeps, DeclaredMissing, DeclaredMissingModule, DepDiff, DepStyle, EnvDriftPkg,
    MissingModule, ProbeImport, ProbeOutput, ProbeResolution, UndeclaredModule,
    DEP_PROBE_SCRIPT, DEP_PROBE_TIMEOUT, DIST_ALIAS_FALLBACK, DRIFT_EXCLUDED,
};
use crate::env_cmds::{
    get_interpreter, init_pyproject_impl, run_uv_streaming, run_with_timeout, PackageInfo, UV_NETWORK_TIMEOUT,
};
use crate::logging::{log_line, Level};
use crate::run_config::{load_config, save_config};
use crate::tool_paths::{tool_command, ENV_UV};
use crate::util::unpoison;

// ---------- dep：代码层探针执行 + mtime 增量缓存 ----------

/// 缓存条目：文件 mtime + 该文件的 AST import 结果。只缓存 AST（环境无关）；
/// 模块解析（find_spec/packages_distributions）经 resolution 缓存按解释器复用（M4-2）。
#[derive(Clone, Debug)]
struct CachedFile {
    mtime: (u64, u32),
    imports: Vec<ProbeImport>,
}

/// mtime 增量缓存（§4.1，M1 骨架）：进程级、仅保留最近一个工作区（换工作区自然失效）。
/// 全量 AST 重扫只发生在文件变化时；未变文件复用上次结果。
static DEP_CACHE: LazyLock<Mutex<Option<(PathBuf, HashMap<String, CachedFile>)>>> =
    LazyLock::new(|| Mutex::new(None));

/// resolution 缓存（M4-2）：模块解析结果（find_spec + packages_distributions）缓存。
/// 复核修复：find_spec 的输入不止解释器——探针把**工作区根**插入 sys.path[0]（local
/// 分类依赖 root），故缓存键 = 解释器 + 工作区根（复合键；单解释器键会在切工作区后
/// 复用旧工作区的 local/missing 分类，产生跨工作区脏数据）。
/// 代次（generation）：full 扫描作废时 ++；在途 code 扫描完成后若代次已变，其回写的
/// 解析结果属作废前旧环境——直接丢弃（防竞态覆盖新鲜结果，复核修复 #2）。
static RESOLUTION_CACHE: LazyLock<Mutex<ResolutionCacheState>> =
    LazyLock::new(|| Mutex::new(ResolutionCacheState::default()));

#[derive(Default)]
struct ResolutionCacheState {
    /// 复合缓存键（"{python}\u{0}{root}"），空 = 无有效缓存
    key: String,
    generation: u64,
    map: HashMap<String, ProbeResolution>,
}

/// resolution 缓存的复合键：解释器 + 工作区根（两者任一变化即失效）
fn resolution_cache_key(python: &str, root: &Path) -> String {
    format!("{python}\u{0}{}", root.to_string_lossy())
}

/// 环境快照缓存（M4-2 code 范围复用）：最近一次成功 `uv pip list` 的结果。
/// 复核修复：键增补工作区根——切工作区后 code 范围不得复用旧工作区的包列表
/// （E2/E3 的声明比对对象已换）。
static ENV_SNAPSHOT_CACHE: LazyLock<Mutex<Option<(String, Vec<(String, String)>)>>> =
    LazyLock::new(|| Mutex::new(None));

fn env_snapshot_cache_key(interp: &str, root: &Path) -> String {
    format!("{interp}\u{0}{}", root.to_string_lossy())
}

fn store_env_snapshot_cache(interp: &str, root: &Path, snap: &[(String, String)]) {
    let mut guard = unpoison(ENV_SNAPSHOT_CACHE.lock());
    *guard = Some((env_snapshot_cache_key(interp, root), snap.to_vec()));
}

fn load_env_snapshot_cache() -> Option<(String, Vec<(String, String)>)> {
    unpoison(ENV_SNAPSHOT_CACHE.lock()).clone()
}

/// resolution 缓存取用：**始终返回当前代次**（键不匹配时命中集为空）——回写方以此
/// 代次校验。若 miss 时返回 0，invalidate 后的首个 store 会因 0≠N 被永久丢弃
/// （full 自己 invalidate → load miss → store 被丢——自毁，复核修复 #2 的补丁缺陷）。
fn load_resolution_cache(python: &str, root: &Path) -> (u64, HashMap<String, ProbeResolution>) {
    let guard = unpoison(RESOLUTION_CACHE.lock());
    if guard.key != resolution_cache_key(python, root) {
        return (guard.generation, HashMap::new());
    }
    (guard.generation, guard.map.clone())
}

/// resolution 缓存写入（探针成功后调用）：写入前校验代次——load 与 store 之间缓存被
/// full 作废（generation 变化）则丢弃本次结果（旧环境的解析不该覆盖新代次）。
fn store_resolution_cache(python: &str, root: &Path, loaded_gen: u64, new_map: &HashMap<String, ProbeResolution>) {
    let mut guard = unpoison(RESOLUTION_CACHE.lock());
    let key = resolution_cache_key(python, root);
    if guard.key != key {
        guard.map.clear();
        guard.key = key;
    }
    if guard.generation != loaded_gen {
        return; // 在途扫描撞上作废：结果属旧环境，丢弃（复核修复 #2）
    }
    for (k, v) in new_map {
        guard.map.insert(k.clone(), v.clone());
    }
    // 缓存无界增长防御：模块数远超工作区合理规模时清空重来（正常项目 < 10k 模块）
    if guard.map.len() > 20_000 {
        guard.map.clear();
    }
}

/// resolution 缓存作废（full 扫描前调用：环境内容可能已变，missing/site 分类不可信）。
/// ++generation 使在途 code 扫描的回写自然失效。
fn invalidate_resolution_cache() {
    let mut guard = unpoison(RESOLUTION_CACHE.lock());
    guard.key = String::new();
    guard.map.clear();
    guard.generation = guard.generation.wrapping_add(1);
}

fn file_mtime(p: &Path) -> Option<(u64, u32)> {
    let m = fs::metadata(p).ok()?.modified().ok()?;
    let d = m.duration_since(UNIX_EPOCH).ok()?;
    Some((d.as_secs(), d.subsec_nanos()))
}

fn store_dep_cache(root: &Path, map: HashMap<String, CachedFile>) {
    let mut guard = unpoison(DEP_CACHE.lock());
    *guard = Some((root.to_path_buf(), map));
}

/// 遍历工作区全部 .py/.pyw（复用 watcher::WATCH_IGNORED 口径剔除 .venv/.git 等，
/// 跳过选区运行临时文件与其他点目录；不跟进符号链接目录防环；路径排序保证确定性）。
fn collect_py_files(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.path());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if !name.starts_with('.') && !crate::watcher::is_ignored_dir_name(&name) {
                    walk(&e.path(), out);
                }
            } else if (name.ends_with(".py") || name.ends_with(".pyw"))
                && !crate::watcher::is_ignored_file_prefix(&name)
            {
                out.push(e.path());
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &mut out);
    out
}

/// 执行探针子进程：payload 写临时文件经 argv 传入（复用 run_with_timeout 的
/// stdout/stderr 并发读取 + 超时杀进程树，避免 stdin 管道死锁）。
/// extra_env 仅测试注入 PYTHONPATH 用，生产传空。
fn run_probe_env(
    python: &str,
    root: &Path,
    payload: &Value,
    timeout: Duration,
    extra_env: &[(&str, &str)],
) -> Result<ProbeOutput, String> {
    let payload_path = std::env::temp_dir().join(format!(
        "opencharm-dep-probe-{}-{}.json",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
    ));
    let body = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    fs::write(&payload_path, body).map_err(|e| format!("写探针 payload 失败：{e}"))?;
    let mut cmd = Command::new(python);
    cmd.arg("-c").arg(DEP_PROBE_SCRIPT).arg(&payload_path).current_dir(root);
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let result = run_with_timeout(&mut cmd, timeout);
    let _ = fs::remove_file(&payload_path);
    let (out, err, code) = result?;
    if code != Some(0) {
        let msg = format!("{out}{err}").trim().to_string();
        return Err(if msg.is_empty() {
            format!("依赖探针失败（exit {code:?}）")
        } else {
            msg
        });
    }
    serde_json::from_str::<ProbeOutput>(out.trim()).map_err(|e| format!("解析依赖探针输出失败：{e}"))
}

/// 无选定解释器（uv run 兜底）时借用系统 python 跑探针：AST 解析与 local/stdlib 分类
/// 不依赖目标环境，E4 在兜底路径仍可算（§3.3 字段语义）。找不到 → 代码层整体降级为空。
fn borrow_python() -> Option<String> {
    for cand in ["python", "python3"] {
        let mut cmd = Command::new(cand);
        cmd.arg("--version");
        if let Ok((_, _, Some(0))) = run_with_timeout(&mut cmd, Duration::from_secs(5)) {
            return Some(cand.to_string());
        }
    }
    None
}

/// 代码层全量扫描：遍历 + mtime 增量缓存 + 探针（10s 超时红线，§4.1）。
/// 探针任何失败 → None（调用方降级为空代码层），缓存回滚原样——dirty 文件下轮仍 dirty。
fn scan_code_layer(root: &Path, python: &str) -> Option<ProbeOutput> {
    let t0 = Instant::now();
    let files = collect_py_files(root);

    // 取出本 root 的缓存（单工作区模型：不同 root 直接丢弃旧缓存）
    let cached: HashMap<String, CachedFile> = {
        let mut guard = unpoison(DEP_CACHE.lock());
        match guard.take() {
            Some((r, map)) if r == root => map,
            other => {
                // root 不匹配时不写回（换工作区即失效）；None 保持 None
                let _ = other;
                HashMap::new()
            }
        }
    };

    let mut reused_imports: Vec<ProbeImport> = Vec::new();
    let mut all_modules: HashSet<String> = HashSet::new();
    // 模块 → 位点所在目录集合（用户实测 bug 修复：脚本式布局的同目录导入，探针
    // 须按「import 位点所属文件目录」解析——module_dirs 随 payload 传给探针，
    // 覆盖缓存复用模块的目录上下文；dirty 文件的目录由探针从 files 路径自行推导）
    let mut module_dirs: HashMap<String, Vec<String>> = HashMap::new();
    let mut dirty: Vec<(String, (u64, u32))> = Vec::new();
    for f in &files {
        let Ok(rel) = f.strip_prefix(root) else { continue };
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        let file_dir = rel
            .parent()
            .map(|p| root.join(p).to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string());
        let Some(mtime) = file_mtime(f) else { continue };
        match cached.get(&rel_s) {
            Some(c) if c.mtime == mtime => {
                for imp in &c.imports {
                    all_modules.insert(imp.module.clone());
                    reused_imports.push(imp.clone());
                    let dirs = module_dirs.entry(imp.module.clone()).or_default();
                    if !dirs.contains(&file_dir) {
                        dirs.push(file_dir.clone());
                    }
                }
            }
            // mtime 先于解析取：扫描期间文件再变 → 缓存 mtime 偏旧 → 下轮仍判 dirty（保守正确）
            _ => dirty.push((rel_s, mtime)),
        }
    }

    // resolution 缓存命中集（M4-2）：未变模块的解析结果直接复用，探针只解析「新增模块」。
    // 复核修复：load 始终返回当前代次（miss 也有），回写时校验防作废后覆盖。
    let (res_gen, res_map) = load_resolution_cache(python, root);
    let res_hit: HashMap<String, ProbeResolution> = all_modules
        .iter()
        .filter_map(|m| res_map.get(m).map(|r| (m.clone(), r.clone())))
        .collect();
    let mut probe_modules: Vec<String> = all_modules.iter().cloned().collect();
    probe_modules.retain(|m| !res_hit.contains_key(m));
    probe_modules.sort();

    if dirty.is_empty() && probe_modules.is_empty() {
        // 无 Python 文件 / 全部文件无 import / 全部模块解析已缓存：不 spawn 探针
        store_dep_cache(root, cached);
        return Some(ProbeOutput { imports: reused_imports, resolution: res_hit });
    }

    let payload = json!({
        "workspace_root": root.to_string_lossy(),
        "files": dirty.iter().map(|(r, _)| r.clone()).collect::<Vec<_>>(),
        "modules": probe_modules,
        // 缓存复用模块的位点目录（脚本语义解析上下文）；dirty 文件的目录由探针
        // 从 files 路径推导，这里只传缓存侧（未变文件不重跑 AST）
        "module_dirs": module_dirs,
    });
    let out = match run_probe_env(python, root, &payload, DEP_PROBE_TIMEOUT, &[]) {
        Ok(o) => o,
        Err(e) => {
            log_line(Level::Warn, &format!("dep_scan：代码层探针失败，降级为空代码层：{e}"));
            store_dep_cache(root, cached); // 回滚原缓存（本次未获得新 AST 结果）
            return None;
        }
    };

    // 合并缓存：未变文件沿用 + 变化文件用探针新结果；已删除文件从缓存剔除
    let mut new_cache = cached;
    let mut by_file: HashMap<&str, Vec<ProbeImport>> = HashMap::new();
    for imp in &out.imports {
        by_file.entry(imp.file.as_str()).or_default().push(imp.clone());
    }
    for (rel, mtime) in &dirty {
        new_cache.insert(
            rel.clone(),
            CachedFile { mtime: *mtime, imports: by_file.remove(rel.as_str()).unwrap_or_default() },
        );
    }
    let alive: HashSet<String> = files
        .iter()
        .filter_map(|f| f.strip_prefix(root).ok())
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .collect();
    new_cache.retain(|k, _| alive.contains(k));
    store_dep_cache(root, new_cache);

    // resolution 缓存合并（M4-2）：新解析结果入缓存（探针返回的 resolution 只含本次
    // 解析的模块），完整集 = 命中集 + 新集。代次校验在 store 内（作废后丢弃回写）。
    store_resolution_cache(python, root, res_gen, &out.resolution);
    let mut resolution = res_hit;
    resolution.extend(out.resolution);

    log_line(
        Level::Info,
        &format!(
            "dep_scan 代码层：files={} dirty={} imports={} resolutionMiss={} took={}ms",
            files.len(),
            dirty.len(),
            reused_imports.len() + out.imports.len(),
            probe_modules.len(),
            t0.elapsed().as_millis()
        ),
    );
    let mut imports = reused_imports;
    imports.extend(out.imports);
    Some(ProbeOutput { imports, resolution })
}

/// 代码层零探针复用（M4-2 declaration 范围）：声明文件变更不涉及代码层——AST 缓存 +
/// resolution 缓存直接组装 ProbeOutput，不 spawn 探针。任一缓存缺失（首次扫描 /
/// 换工作区后）返回 None（调用方降级为空代码层，语义与探针失败一致——保守不误报）。
fn reuse_code_layer(root: &Path, python: &str) -> Option<ProbeOutput> {
    let files = collect_py_files(root);
    let cached: HashMap<String, CachedFile> = {
        let mut guard = unpoison(DEP_CACHE.lock());
        match guard.take() {
            Some((r, map)) if r == root => {
                *guard = Some((r, map.clone()));
                map
            }
            other => {
                let _ = other;
                HashMap::new()
            }
        }
    };
    if cached.is_empty() {
        return None;
    }
    let res_cache = load_resolution_cache(python, root).1;
    let mut imports: Vec<ProbeImport> = Vec::new();
    let mut modules: HashSet<String> = HashSet::new();
    let mut all_hit = true;
    for f in &files {
        let Ok(rel) = f.strip_prefix(root) else { continue };
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        let Some(c) = cached.get(&rel_s) else { continue };
        let Some(mtime) = file_mtime(f) else { continue };
        if c.mtime != mtime {
            // 文件在声明变更与本次扫描之间又被改过：缓存不可信，整体放弃复用（保守）
            return None;
        }
        for imp in &c.imports {
            modules.insert(imp.module.clone());
            imports.push(imp.clone());
        }
    }
    let mut resolution = HashMap::new();
    for m in modules {
        let Some(r) = res_cache.get(&m) else {
            all_hit = false;
            break;
        };
        resolution.insert(m, r.clone());
    }
    if !all_hit {
        return None;
    }
    imports.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    Some(ProbeOutput { imports, resolution })
}

// ---------- dep：diff 纯计算（无子进程，单测友好） ----------

/// 缺失模块的 dist：探针反查（packages_distributions）→ 内置别名表 → None（正常占比，§3.3）。
/// M4-4 后生产路径改走 effective_dist_candidates；保留给单测锁定别名表语义。
#[cfg(test)]
fn effective_dist(module: &str, probe_dist: Option<&str>) -> Option<String> {
    probe_dist
        .map(String::from)
        .or_else(|| DIST_ALIAS_FALLBACK.iter().find(|(m, _)| *m == module).map(|(_, d)| d.to_string()))
}

/// dist 候选全集（M4-4）：探针候选列表 + 别名表兜底（去重保序）。
/// 返回 (首候选, 全部候选)——首候选兼容旧 dist 字段语义，全部候选供安装时弹选择。
fn effective_dist_candidates(module: &str, res: &ProbeResolution) -> (Option<String>, Vec<String>) {
    let mut cands: Vec<String> = res.all_candidates();
    if cands.is_empty() {
        if let Some((_, d)) = DIST_ALIAS_FALLBACK.iter().find(|(m, _)| *m == module) {
            cands.push(d.to_string());
        }
    }
    let first = cands.first().cloned();
    (first, cands)
}

/// 按 (file, line) 排序探针 import 位点（缓存复用 + 增量合并后顺序不保证）
fn sorted_imports(probe: &ProbeOutput) -> Vec<&ProbeImport> {
    let mut v: Vec<&ProbeImport> = probe.imports.iter().collect();
    v.sort_by(|a, b| a.file.cmp(&b.file).then(a.line.cmp(&b.line)));
    v
}

/// v1.7 A 匹配链：模块是否命中声明全集。模块名 → 探针候选 dist → 别名表 → 模块名本身，
/// 全部候选归一化逐一比对 declared.all（dotenv→python-dotenv 这类反查不到且别名表没有的
/// 返回 None——仍进 E1，宁可多报不漏）。命中时返回 (声明 dist 归一化名, 所属组)。
fn declared_hit(
    module: &str,
    probe_res: &ProbeResolution,
    declared: &DeclaredDeps,
) -> Option<(String, Option<String>)> {
    // 候选集：探针 distCandidates（packages_distributions 反查，未装时通常空）+ 别名表 + 模块名
    let mut cands: Vec<String> = probe_res.all_candidates();
    if let Some((_, d)) = DIST_ALIAS_FALLBACK.iter().find(|(m, _)| *m == module) {
        cands.push(d.to_string());
    }
    cands.push(module.to_string());
    for c in &cands {
        let n = normalize_dist(c);
        if declared.all.contains(&n) {
            // 归一化名即声明 dist（比对口径一致）；组映射缺失时由调用方给默认组
            let group = declared.group_of.get(&n).cloned();
            return Some((n, group));
        }
    }
    None
}

/// E1：resolution=missing 的模块 → 按 (module, file) 聚合；命中声明全集的分流到
/// declared_missing_modules（v1.7 A：E1 只留「未声明的缺失」，已声明未装归 E2 小节）。
/// line = 首位点行号；lazy = 全部位点皆惰性（任一顶层 import 在模块加载时执行，即非惰性）。
fn compute_missing_in_env(
    probe: &ProbeOutput,
    declared: &DeclaredDeps,
    declared_group_default: &str,
) -> (Vec<MissingModule>, Vec<DeclaredMissingModule>) {
    let mut order: Vec<(String, String)> = Vec::new();
    let mut acc: HashMap<(String, String), (u32, bool, Option<String>, Vec<String>)> = HashMap::new();
    let mut decl_order: Vec<String> = Vec::new();
    let mut decl_acc: HashMap<String, (String, String, u32, String, u32, bool)> = HashMap::new();
    for imp in sorted_imports(probe) {
        let Some(res) = probe.resolution.get(&imp.module) else { continue };
        if res.status != "missing" {
            continue;
        }
        // v1.7 A：声明全集命中 → 分流（按 module 聚合：files 计数、首位点、lazy 全体与）
        if let Some((dist, group)) = declared_hit(&imp.module, res, declared) {
            match decl_acc.get_mut(&imp.module) {
                Some((_, _, files, _, _, lazy)) => {
                    *files += 1;
                    *lazy = *lazy && imp.lazy;
                }
                None => {
                    let group = group.unwrap_or_else(|| declared_group_default.to_string());
                    decl_acc.insert(
                        imp.module.clone(),
                        (dist, group, 1, imp.file.clone(), imp.line, imp.lazy),
                    );
                    decl_order.push(imp.module.clone());
                }
            }
            continue;
        }
        let key = (imp.module.clone(), imp.file.clone());
        match acc.get_mut(&key) {
            Some((_, lazy, _, _)) => *lazy = *lazy && imp.lazy,
            None => {
                let (dist, cands) = effective_dist_candidates(&imp.module, res);
                acc.insert(key.clone(), (imp.line, imp.lazy, dist, cands));
                order.push(key);
            }
        }
    }
    let missing = order
        .into_iter()
        .filter_map(|key| {
            let (line, lazy, dist, dist_candidates) = acc.remove(&key)?;
            Some(MissingModule { module: key.0, dist, dist_candidates, file: key.1, line, lazy })
        })
        .collect();
    let declared_modules = decl_order
        .into_iter()
        .filter_map(|m| {
            let (dist, group, files, file, line, lazy) = decl_acc.remove(&m)?;
            Some(DeclaredMissingModule { module: m, dist, group, files, file, line, lazy })
        })
        .collect();
    (missing, declared_modules)
}

/// E4（仅 style=pyproject）：resolution=site（三方已装）且不在声明全集 → 未声明。
/// missing 模块不进 E4——已在 E1，装完若仍未声明会自然浮出；避免把「拼错的模块名」
/// 误报成未声明依赖。排除：声明全集（含 extras/groups）、工具链自装、项目自身
/// （uv sync 把项目本体 editable 装进 venv，packages_distributions 会反查到项目名）。
fn compute_undeclared(
    probe: &ProbeOutput,
    declared: &DeclaredDeps,
    project_name: Option<&str>,
) -> Vec<UndeclaredModule> {
    let proj = project_name.map(normalize_dist);
    let mut order: Vec<(String, String)> = Vec::new();
    let mut acc: HashMap<(String, String), (u32, Option<String>, Vec<String>)> = HashMap::new();
    for imp in sorted_imports(probe) {
        let Some(res) = probe.resolution.get(&imp.module) else { continue };
        if res.status != "site" {
            continue;
        }
        let (dist, dist_candidates) = effective_dist_candidates(&imp.module, res);
        let norm = normalize_dist(dist.as_deref().unwrap_or(&imp.module));
        if declared.all.contains(&norm) || DRIFT_EXCLUDED.contains(&norm.as_str()) {
            continue;
        }
        if proj.as_deref() == Some(norm.as_str()) {
            continue;
        }
        let key = (imp.module.clone(), imp.file.clone());
        match acc.get_mut(&key) {
            Some((line, _, _)) => *line = (*line).min(imp.line),
            None => {
                acc.insert(key.clone(), (imp.line, dist, dist_candidates));
                order.push(key);
            }
        }
    }
    order
        .into_iter()
        .filter_map(|key| {
            let (line, dist, dist_candidates) = acc.remove(&key)?;
            Some(UndeclaredModule { module: key.0, dist, dist_candidates, file: key.1, line })
        })
        .collect()
}

/// E2：同步范围声明中环境快照缺失的 dist（PEP 503 归一化比对；去重保序）。
fn compute_declared_missing(declared: &DeclaredDeps, installed: &[(String, String)]) -> Vec<DeclaredMissing> {
    let installed_norm: HashSet<String> = installed.iter().map(|(n, _)| normalize_dist(n)).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    declared
        .core
        .iter()
        .filter(|d| !installed_norm.contains(&d.dist) && seen.insert(d.dist.as_str()))
        .map(|d| DeclaredMissing { dist: d.dist.clone(), spec: d.spec.clone() })
        .collect()
}

/// E3：环境中已装但不在声明全集的 dist（归一化比对），排除工具链自装/基础设施包/项目自身。
fn compute_env_drift(
    installed: &[(String, String)],
    declared: &DeclaredDeps,
    project_name: Option<&str>,
) -> Vec<EnvDriftPkg> {
    let proj = project_name.map(|p| normalize_dist(p));
    installed
        .iter()
        .filter(|(n, _)| {
            let norm = normalize_dist(n);
            !DRIFT_EXCLUDED.contains(&norm.as_str())
                && !declared.all.contains(&norm)
                && proj.as_deref() != Some(norm.as_str())
        })
        .map(|(n, v)| EnvDriftPkg { dist: n.clone(), version: v.clone() })
        .collect()
}

/// E2 特例（§3.3）：style=requirements 且整个 requirements 声明集与环境快照零交集
/// = 「老项目建了 .venv 没装依赖」（用户反馈 1）。声明集为空恒 false（无从谈起未安装）。
fn compute_requirements_uninstalled(declared: &DeclaredDeps, installed: &[(String, String)]) -> bool {
    if declared.core.is_empty() {
        return false;
    }
    let installed_norm: HashSet<String> = installed.iter().map(|(n, _)| normalize_dist(n)).collect();
    !declared.core.iter().any(|d| installed_norm.contains(&d.dist))
}

// ---------- dep：dep_scan 编排 ----------

/// 扫描范围（M4-2 增量路由，§4.4 失效矩阵的信号分流）：
/// - `full`：L0+L1+L2+E5 全量（打开工作区 / 手动刷新 / 环境信号 / 修复收尾）；
/// - `code`：L0+L2（.py 变更信号——不改环境事实与声明内容，跳过 uv pip list / uv lock --check）；
/// - `declaration`：L0+L1（声明文件变更——声明集变了要重比环境快照，但代码层 imports 未变）。
/// E5 仅 full 跑（lock 一致性与 .py/环境无关；declaration 信号实际是 pyproject 变更，
/// 声明重解析后 lock 检查的输入 pyproject 未变语义不变——避免每个声明事件多一个子进程）。
#[derive(Clone, Copy, PartialEq, Debug)]
enum ScanScope {
    Full,
    Code,
    Declaration,
}

impl ScanScope {
    fn from_str(s: &str) -> ScanScope {
        match s {
            "code" => ScanScope::Code,
            "declaration" => ScanScope::Declaration,
            _ => ScanScope::Full, // 缺省/未知值 → 全量（保守：宁可多算不漏报）
        }
    }

    fn runs_code(&self) -> bool {
        matches!(self, ScanScope::Full | ScanScope::Code)
    }

    fn runs_env(&self) -> bool {
        matches!(self, ScanScope::Full | ScanScope::Declaration)
    }

    fn runs_lock_check(&self) -> bool {
        *self == ScanScope::Full
    }
}

/// 全量依赖体检（§4.5 L1+L2）：L0 style 判定 → 声明层解析 → 环境快照 → 代码层探针
/// → E1~E5 diff 纯计算。async + spawn_blocking（阻塞型命令纪律）；任何单层失败只降级
/// 对应字段、不中断整体（检测是顾问不是路障，§4.5 通用红线）。
/// scope（M4-2）：失效信号分流后的扫描范围（full/code/declaration，缺省 full）。
#[tauri::command]
pub async fn dep_scan(workspace_root: String, scope: Option<String>) -> Result<DepDiff, String> {
    let scope = scope.as_deref().map(ScanScope::from_str).unwrap_or(ScanScope::Full);
    tauri::async_runtime::spawn_blocking(move || dep_scan_impl(&workspace_root, scope))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn dep_scan_impl(workspace_root: &str, scope: ScanScope) -> Result<DepDiff, String> {
    let t_start = Instant::now();
    let root = Path::new(workspace_root);
    if !root.is_dir() {
        return Err(format!("工作区不存在：{workspace_root}"));
    }

    // L0：style 判定（与 dep_style 命令同一函数，杜绝两端判定逻辑漂移，§3.3）
    let style = detect_style(root);
    let external = style.style == "external";

    // 解释器：工作区配置 > .venv 自动检测 > None（uv run 兜底）
    let interpreter = get_interpreter(workspace_root.to_string()).ok().flatten();

    // 声明层（external 不解析——锁文件格式我们不认，E2~E5 主动禁用而非给错误结果，§4.2.1；
    // bare 无声明可解析）。
    // fika-admin 实测修复：uv.lock 的锁定闭包并入 E3/E4 排除集（不进 core——E2 同步范围
    // 仍按 pyproject 声明，lock 是「合法存在的传递依赖」而非「应装未声明」）
    let (declared, project_name) = if external {
        (DeclaredDeps::default(), None)
    } else {
        match style.style.as_str() {
            "pyproject" => {
                let (mut deps, name) = fs::read_to_string(root.join("pyproject.toml"))
                    .ok()
                    .map(|t| parse_pyproject_deps(&t))
                    .unwrap_or_default();
                let lock_names = parse_uv_lock_names(root);
                if !lock_names.is_empty() {
                    deps.all.extend(lock_names);
                }
                (deps, name)
            }
            "requirements" => (parse_requirements_declared(root), None),
            _ => (DeclaredDeps::default(), None),
        }
    };

    // L1：环境快照（仅在有解释器时；失败 → E2/E3 降级为空，E1 不受影响——探针 find_spec 是真值）
    // M4-2 scope：declaration 信号也跑 L1（声明集变了要重比环境）；code 信号跳过——
    // 环境事实未变，复用「上次环境快照」而非再 spawn uv pip list。
    let mut installed: Vec<(String, String)> = Vec::new();
    let mut installed_ok = false;
    if let Some(interp) = &interpreter {
        if scope.runs_env() {
            match scan_list_packages(interp) {
                Ok(list) => {
                    installed = list;
                    installed_ok = true;
                    store_env_snapshot_cache(interp, root, &installed);
                }
                Err(e) => log_line(Level::Warn, &format!("dep_scan：环境快照失败（E2/E3 降级为空）：{e}")),
            }
        } else {
            // code 范围：复用进程级缓存的上次快照（无缓存/键不匹配 → E2/E3 降级为空，保守）。
            // 复核修复：键 = 解释器+工作区根——切工作区后不得复用旧工作区的包列表。
            let want_key = env_snapshot_cache_key(interp, root);
            if let Some((k, snap)) = load_env_snapshot_cache() {
                if k == want_key {
                    installed = snap;
                    installed_ok = true;
                }
            }
        }
    }

    // L2：代码层探针（解释器缺失 → 借用系统 python，E4 仍可算；两者皆无 → 代码层为空）
    // M4-2 scope：code 信号跑探针（AST mtime 缓存 + resolution 解释器缓存吸收增量成本）；
    // declaration 信号跳过探针——代码层 imports 未变，直接复用缓存的 ProbeOutput。
    // full 信号先作废 resolution 缓存：环境内容可能已变（装/卸包），缓存的
    // missing/site 分类会过期（正确性优先——full 本就是「重算真值」的时机）。
    let probe_python = interpreter.clone().or_else(borrow_python);
    let probe = if scope.runs_code() {
        if scope == ScanScope::Full {
            invalidate_resolution_cache();
        }
        probe_python.as_deref().and_then(|py| scan_code_layer(root, py))
    } else {
        probe_python.as_deref().and_then(|py| reuse_code_layer(root, py))
    };

    // E5：pyproject 且已有 uv.lock 才检查（无 lock 文件 = 用户未采用 lock 工作流，不报过期）
    let lock_out_of_date = scope.runs_lock_check()
        && style.style == "pyproject"
        && root.join("uv.lock").is_file()
        && check_lock_out_of_date(root);

    // diff 投影（interpreter=null 时环境侧 E1/E2/E3 置空、E4/E5 照常，§3.3 字段语义）
    let env_side = interpreter.is_some();
    // v1.7 A：E1 分流的已声明未装；external 声明层不解析 → 分流恒空（E1 照旧全量）
    let (missing_in_env, declared_missing_modules) = match (&probe, env_side, external) {
        (Some(p), true, false) => {
            let default_group =
                if style.style == "requirements" { "requirements".to_string() } else { "declared".to_string() };
            compute_missing_in_env(p, &declared, &default_group)
        }
        _ => (Vec::new(), Vec::new()),
    };
    let undeclared = match (&probe, style.style.as_str()) {
        (Some(p), "pyproject") => compute_undeclared(p, &declared, project_name.as_deref()),
        _ => Vec::new(),
    };
    let declared_missing = if env_side && installed_ok && !external {
        compute_declared_missing(&declared, &installed)
    } else {
        Vec::new()
    };
    let env_drift = if env_side && installed_ok && !external {
        compute_env_drift(&installed, &declared, project_name.as_deref())
    } else {
        Vec::new()
    };
    let requirements_uninstalled =
        style.style == "requirements" && installed_ok && compute_requirements_uninstalled(&declared, &installed);

    let scanned_at = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    let mut diff = DepDiff {
        style: style.style.clone(),
        external_manager: style.external_manager.clone(),
        missing_in_env,
        declared_missing,
        declared_missing_modules,
        env_drift,
        undeclared,
        lock_out_of_date,
        requirements_uninstalled,
        interpreter: interpreter.clone(),
        requirements_file: style.requirements_file.clone(),
        scanned_at,
    };
    // 忽略清单过滤（M3，§5.3「忽略项在 diff 计算后过滤」的后端统一落点）：
    // 预检/灯泡/面板所有消费者拿到的是同一份已过滤真值；日志计数即用户可见口径
    apply_dep_ignores(&mut diff, &load_dep_ignores(workspace_root));
    log_line(
        Level::Info,
        &format!(
            "dep_scan：style={} interpreter={} E1={} E2={} E2decl={} E3={} E4={} lockStale={} reqUninstalled={} took={}ms",
            diff.style,
            interpreter.is_some(),
            diff.missing_in_env.len(),
            diff.declared_missing.len(),
            diff.declared_missing_modules.len(),
            diff.env_drift.len(),
            diff.undeclared.len(),
            diff.lock_out_of_date,
            diff.requirements_uninstalled,
            t_start.elapsed().as_millis()
        ),
    );
    Ok(diff)
}

/// dep 域轻量环境快照命令（§5.5 L1 真值判定，M2 失效矩阵）：`uv pip list --format=freeze`。
/// 环境信号（终端完成摘要嗅探 / site-packages 监听）到达后先调此命令拿当前环境快照，
/// 与前端缓存的上次快照对比——**有差异才**触发 L2 全量 `dep_scan` + 引擎重启（误报代价封顶
/// 为一次快照对比，§4.4/§5.5）。解释器解析与 `dep_scan` 同源（`get_interpreter`），保证对比的
/// 是同一环境；无解释器（uv run 兜底）返回空——环境侧本就不参与 diff（§3.3 字段语义）。
#[tauri::command]
pub async fn dep_env_snapshot(workspace_root: String) -> Result<Vec<PackageInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || dep_env_snapshot_impl(&workspace_root))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn dep_env_snapshot_impl(workspace_root: &str) -> Result<Vec<PackageInfo>, String> {
    let Some(interp) = get_interpreter(workspace_root.to_string()).ok().flatten() else {
        return Ok(Vec::new());
    };
    let list = scan_list_packages(&interp)?;
    store_env_snapshot_cache(&interp, Path::new(workspace_root), &list);
    Ok(list.into_iter().map(|(name, version)| PackageInfo { name, version }).collect())
}

// ---------- dep：忽略清单（M3，§5.3/R9） ----------
//
// 行级「忽略此包」持久化到工作区配置 `dep_ignored` 字段（复用解释器配置的
// load_config/save_config 先例，不侵入用户项目）。过滤在**后端统一**执行
// （dep_scan 计算 diff 后、返回前）——prepareRun / 灯泡 / 面板所有消费者自动
// 跳过忽略项，单一真值口径干净；「已忽略」视图单独读 dep_ignore_list 展示。

/// 忽略清单条目（camelCase 对齐 TS 消费端）
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepIgnoreEntry {
    /// 断边组："e1" | "e2" | "e3" | "e4"（E5 是项目级布尔，无行级忽略语义）
    pub edge: String,
    /// E1/E4 = 模块名（大小写敏感原样）；E2/E3 = dist 名（PEP 503 归一化后存储）
    pub key: String,
}

/// 条目归一化与合法性校验：edge 限 e1~e4；E2/E3 的 key 经 normalize_dist 归一
/// （比对时大小写/分隔符异形也命中），E1/E4 模块名原样（Python 模块大小写敏感）。
fn normalized_ignore_entry(edge: &str, key: &str) -> Result<DepIgnoreEntry, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("忽略条目不能为空".to_string());
    }
    match edge {
        "e1" | "e4" => Ok(DepIgnoreEntry { edge: edge.to_string(), key: key.to_string() }),
        "e2" | "e3" => Ok(DepIgnoreEntry { edge: edge.to_string(), key: normalize_dist(key) }),
        _ => Err(format!("未知断边组：{edge}（合法值 e1~e4）")),
    }
}

/// 从工作区配置提取忽略清单（字段缺失/损坏 → 空清单，绝不 panic——同 load_config 口径）
fn dep_ignores_from_config(v: &Value) -> Vec<DepIgnoreEntry> {
    v.get("dep_ignored")
        .and_then(|x| serde_json::from_value::<Vec<DepIgnoreEntry>>(x.clone()).ok())
        .unwrap_or_default()
}

fn load_dep_ignores(root: &str) -> Vec<DepIgnoreEntry> {
    dep_ignores_from_config(&load_config(root))
}

/// 写回忽略清单（edge+key 去重保序；空清单移除字段，不留空数组）→ 返回清理后的清单
fn save_dep_ignores(root: &str, list: Vec<DepIgnoreEntry>) -> Result<Vec<DepIgnoreEntry>, String> {
    let mut seen = HashSet::new();
    let cleaned: Vec<DepIgnoreEntry> = list
        .into_iter()
        .filter(|e| seen.insert((e.edge.clone(), e.key.clone())))
        .collect();
    let mut v = load_config(root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    if cleaned.is_empty() {
        obj.remove("dep_ignored");
    } else {
        obj.insert("dep_ignored".into(), serde_json::to_value(&cleaned).map_err(|e| e.to_string())?);
    }
    save_config(root, &v)?;
    Ok(cleaned)
}

/// 读忽略清单（「已忽略」视图数据源；同步纯 fs，零子进程）
#[tauri::command]
pub fn dep_ignore_list(workspace_root: String) -> Vec<DepIgnoreEntry> {
    load_dep_ignores(&workspace_root)
}

/// 添加忽略条目（面板行级「忽略此包」）→ 返回更新后的完整清单（前端就地刷新视图）
#[tauri::command]
pub fn dep_ignore_add(workspace_root: String, edge: String, key: String) -> Result<Vec<DepIgnoreEntry>, String> {
    let entry = normalized_ignore_entry(&edge, &key)?;
    let mut list = load_dep_ignores(&workspace_root);
    list.push(entry);
    save_dep_ignores(&workspace_root, list)
}

/// 移除忽略条目（「已忽略」视图的恢复检测）→ 返回更新后的完整清单
#[tauri::command]
pub fn dep_ignore_remove(workspace_root: String, edge: String, key: String) -> Result<Vec<DepIgnoreEntry>, String> {
    let entry = normalized_ignore_entry(&edge, &key)?;
    let list = load_dep_ignores(&workspace_root)
        .into_iter()
        .filter(|e| {
            // E2/E3 两侧归一比对（M3 自查修复：手改配置存了异形键时，按归一后的 entry.key
            // 精确匹配会删不掉——与 apply_dep_ignores 的防御口径一致）；E1/E4 模块名原样匹配
            let same = e.edge == entry.edge
                && match e.edge.as_str() {
                    "e2" | "e3" => normalize_dist(&e.key) == entry.key,
                    _ => e.key == entry.key,
                };
            !same
        })
        .collect();
    save_dep_ignores(&workspace_root, list)
}

/// 忽略清单过滤（dep_scan 返回前统一执行）：E1/E4 按模块名精确匹配（大小写敏感），
/// E2/E3 按 dist 归一化匹配——两侧都归一（存储侧经 normalized_ignore_entry 已归一，
/// 配置文件被手改成异形写法时同样命中，防御绕过 add 路径的场景）。
fn apply_dep_ignores(diff: &mut DepDiff, ignores: &[DepIgnoreEntry]) {
    if ignores.is_empty() {
        return;
    }
    let ignored = |edge: &str, key: &str| ignores.iter().any(|e| e.edge == edge && e.key == key);
    let ignored_dist = |edge: &str, dist: &str| {
        let n = normalize_dist(dist);
        ignores.iter().any(|e| e.edge == edge && normalize_dist(&e.key) == n)
    };
    diff.missing_in_env.retain(|m| !ignored("e1", &m.module));
    diff.declared_missing.retain(|d| !ignored_dist("e2", &d.dist));
    // v1.7 A：E2 小节条目沿用 e2 忽略（模块名与声明 dist 归一化双口径比对——
    // 存储侧可能按模块名或按 dist 名添加，两侧都归一防御）
    diff.declared_missing_modules
        .retain(|m| !ignored_dist("e2", &m.dist) && !ignored_dist("e2", &m.module));
    diff.env_drift.retain(|d| !ignored_dist("e3", &d.dist));
    diff.undeclared.retain(|u| !ignored("e4", &u.module));
}

// ---------- dep：修复动作（M3，§5.1 动作矩阵 + §5.6 L3 交互） ----------
//
// 检测层只读不写的边界到此为止：dep_fix 是 dep 域**唯一**写环境/写声明的入口，
// 且只源于用户显式动作（面板/灯泡/横幅确认，R5）。收尾协议（重算 diff →
// restartEngine → toast）由前端编排（§5.2），本层只负责执行并返回 exit code。

/// dep_fix 会话互斥（§5.6 防重入）：同一时刻仅一个 dep_fix 在跑。
/// uv 自身对 uv.lock 有文件锁，并发 `uv add` 必然报错——提前挡住而不是让用户看到 uv 的报错。
static DEP_FIX_BUSY: AtomicBool = AtomicBool::new(false);

/// action × style → uv 参数（纯函数，构建单点——测试与执行共用，杜绝两处漂移）。
/// - `install`（E1 装缺失包）：pyproject → `uv add <dists>`；requirements/bare/external →
///   `uv pip install --python <interp> <dists>`（external 的声明层归外部管理器所有，
///   只动环境侧不写声明，§4.2.1/R11：E1 对 external 仍生效）；
/// - `sync`（E2 同步环境）：pyproject → `uv sync`；requirements → `uv pip install -r <file>`；
/// - `declare`（E3 漂移收敛 / E4 补声明）：仅 pyproject → `uv add <dists>`；
/// - `lock`（E5 刷新锁）：仅 pyproject → `uv lock`；
/// - `migrate`（requirements 迁移引导，R4）：→ `uv add -r <file>`（只读原文件、写 pyproject，
///   不改写不删除 requirements.txt，R4.1；pyproject 缺失由调用方先 ensure）。
fn plan_dep_fix(
    action: &str,
    style: &DepStyle,
    dists: &[String],
    interpreter: Option<&str>,
) -> Result<Vec<String>, String> {
    fn pip_install_args(interp: Option<&str>, tail: &[String]) -> Result<Vec<String>, String> {
        let interp = interp.ok_or("未选择解释器，无法安装（请先在环境面板选择解释器）")?;
        let mut args =
            vec!["pip".to_string(), "install".to_string(), "--python".to_string(), interp.to_string()];
        args.extend(tail.iter().cloned());
        Ok(args)
    }
    fn add_args(dists: &[String]) -> Result<Vec<String>, String> {
        if dists.is_empty() {
            return Err("修复动作缺少包名".to_string());
        }
        let mut args = vec!["add".to_string()];
        args.extend(dists.iter().cloned());
        Ok(args)
    }
    match action {
        "install" => {
            if style.style == "pyproject" {
                add_args(dists)
            } else {
                pip_install_args(interpreter, dists)
            }
        }
        "sync" => match style.style.as_str() {
            "pyproject" => Ok(vec!["sync".to_string()]),
            "requirements" => {
                let f = style.requirements_file.as_deref().ok_or("未找到 requirements 文件")?;
                pip_install_args(interpreter, &["-r".to_string(), f.to_string()])
            }
            "external" => Err("外部管理器项目：声明层同步已禁用（仅缺失包安装可用）".to_string()),
            _ => Err("项目无声明文件，无可同步".to_string()),
        },
        "declare" => match style.style.as_str() {
            "pyproject" => add_args(dists),
            "external" => Err("外部管理器项目：声明写入已禁用（建议迁移到 uv）".to_string()),
            _ => Err("项目无 pyproject.toml，无法写入声明——请先迁移到 pyproject".to_string()),
        },
        "lock" => match style.style.as_str() {
            "pyproject" => Ok(vec!["lock".to_string()]),
            _ => Err("仅 pyproject 项目需要刷新 uv.lock".to_string()),
        },
        "migrate" => {
            if style.style == "external" {
                return Err("外部管理器项目：不适用 requirements 迁移引导".to_string());
            }
            let f = style.requirements_file.as_deref().ok_or("未找到 requirements 文件，无需迁移")?;
            Ok(vec!["add".to_string(), "-r".to_string(), f.to_string()])
        }
        other => Err(format!("未知修复动作：{other}")),
    }
}

/// 修复动作统一入口（§5.6 L3）：输出经 pip-stdout / pip-stderr 事件流式推送
/// （复用前端输出面板既有监听——这是唯一的进度指示，不做进度条）；返回 exit code（0 成功）。
/// 失败即停语义由前端批量编排承担（§5.6 第 5 条）：本命令一次只执行一个动作。
#[tauri::command]
pub async fn dep_fix(
    app: AppHandle,
    window: tauri::WebviewWindow,
    workspace_root: String,
    action: String,
    dists: Vec<String>,
) -> Result<i32, String> {
    let wid = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || dep_fix_impl(app, workspace_root, action, dists, wid))
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

fn dep_fix_impl(
    app: AppHandle,
    workspace_root: String,
    action: String,
    dists: Vec<String>,
    wid: String,
) -> Result<i32, String> {
    if DEP_FIX_BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("另一个依赖修复动作正在执行，请等待其完成".to_string());
    }
    // panic 安全（M3 自查修复）：spawn_blocking 线程内 panic 会跳过手动 store(false)，
    // 互斥标志将永久卡死（此后所有修复动作被拒且无从恢复）。Drop 守卫保证任何退出
    // 路径（含 panic unwind）都释放标志。
    struct BusyGuard;
    impl Drop for BusyGuard {
        fn drop(&mut self) {
            DEP_FIX_BUSY.store(false, Ordering::Release);
        }
    }
    let _guard = BusyGuard;
    dep_fix_inner(&app, &workspace_root, &action, &dists, &wid)
}

fn dep_fix_inner(
    app: &AppHandle,
    workspace_root: &str,
    action: &str,
    dists: &[String],
    wid: &str,
) -> Result<i32, String> {
    let root = Path::new(workspace_root);
    if !root.is_dir() {
        return Err(format!("工作区不存在：{workspace_root}"));
    }
    // style 判定必须在 ensure pyproject **之前**：migrate 若先生成 pyproject，
    // style 会翻转为 pyproject 且丢失 requirements_file
    let style = detect_style(root);
    if action == "migrate" && !root.join("pyproject.toml").is_file() {
        // uv add 需要项目：先幂等生成最小 pyproject（复用 init_pyproject；
        // 原 requirements.txt 只读不改，R4.1）
        init_pyproject_impl(workspace_root.to_string())?;
    }
    let interpreter = get_interpreter(workspace_root.to_string()).ok().flatten();
    let args = plan_dep_fix(action, &style, dists, interpreter.as_deref())?;
    // 命令回显由前端 runDepFix 负责（"cmd" 样式，与 pip_install 等既有流一致，M3 自查修复：
    // 此前后端再 emit 一次 "> uv …" 会在输出面板重复两行）——本层只流式转发 uv 自身输出
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(&args).current_dir(root);
    // L-2：修复动作（uv sync / add / remove）会联网装整套 lock 闭包（真实项目曾 63 项），
    // 120s 在国内网络下常被 kill 成「依赖修复失败」——按动作分级后走联网超时。
    // L-3：操作名 "fix" 用于取消通道（前端状态栏「进行中」芯片的取消按钮）。
    run_uv_streaming(app, &mut cmd, UV_NETWORK_TIMEOUT, wid, "fix")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dep_health::DeclaredDep;

    /// 测试临时目录 helper（cfg(test) 跨模块各自复制：dep_health.rs 同款）
    fn dep_tmpdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("opencharm-dep-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    // ----- diff 纯计算（构造 ProbeOutput，无子进程） -----

    fn probe(imports: Vec<(&str, &str, u32, bool)>, resolution: Vec<(&str, &str, Option<&str>)>) -> ProbeOutput {
        probe_with_candidates(imports, resolution, vec![])
    }

    /// M4-4：resolution 构造扩展——extra_cands 为 (module, [候选…])，注入 distCandidates
    fn probe_with_candidates(
        imports: Vec<(&str, &str, u32, bool)>,
        resolution: Vec<(&str, &str, Option<&str>)>,
        extra_cands: Vec<(&str, Vec<&str>)>,
    ) -> ProbeOutput {
        let mut out = ProbeOutput {
            imports: imports
                .into_iter()
                .map(|(file, module, line, lazy)| ProbeImport {
                    file: file.to_string(),
                    module: module.to_string(),
                    line,
                    lazy,
                })
                .collect(),
            resolution: resolution
                .into_iter()
                .map(|(m, status, dist)| {
                    (
                        m.to_string(),
                        ProbeResolution {
                            status: status.to_string(),
                            dist: dist.map(String::from),
                            dist_candidates: vec![],
                        },
                    )
                })
                .collect(),
        };
        for (m, cands) in extra_cands {
            if let Some(r) = out.resolution.get_mut(m) {
                r.dist_candidates = cands.iter().map(|s| s.to_string()).collect();
                if r.dist.is_none() {
                    r.dist = cands.first().map(|s| s.to_string());
                }
            }
        }
        out
    }

    /// v1.7 A：E1 声明全集感知分流（fika-admin pytest ×5 降噪场景复刻）
    #[test]
    fn e1_splits_declared_missing_to_e2_section() {
        // dev 组声明了 pytest；代码 5 个文件 import pytest（fika-admin 实测形态）
        let mut declared = DeclaredDeps::default();
        declared.all.insert("pytest".into());
        declared.all.insert("pyyaml".into());
        declared.group_of.insert("pytest".into(), "dev".into());
        let p = probe(
            vec![
                ("tests/a.py", "pytest", 1, false),
                ("tests/b.py", "pytest", 2, false),
                ("tests/c.py", "pytest", 3, false),
                ("tests/d.py", "pytest", 4, false),
                ("tests/e.py", "pytest", 5, true),    // 混入一个惰性位点 → 聚合后非全惰性
                ("app/x.py", "yaml", 1, false),        // 别名表匹配 pyyaml 声明
                ("app/x.py", "ghost", 2, false),       // 未声明 → 留在 E1
                ("app/x.py", "os", 3, false),          // stdlib 不进
            ],
            vec![
                ("pytest", "missing", None),
                ("yaml", "missing", None),             // 反查不到（未装）→ 别名表兜底
                ("ghost", "missing", None),
                ("os", "stdlib", None),
            ],
        );
        let (e1, decl_mods) = compute_missing_in_env(&p, &declared, "declared");
        // E1 只剩未声明的 ghost
        assert_eq!(e1.len(), 1, "已声明缺失分流后 E1 仅剩未声明项：{e1:?}");
        assert_eq!(e1[0].module, "ghost");
        // 分流产物：pytest（dev 组，5 文件聚合，任一非惰性 → lazy=false）+ yaml（别名命中，无组 → 默认组）
        assert_eq!(decl_mods.len(), 2, "{decl_mods:?}");
        let pytest = decl_mods.iter().find(|m| m.module == "pytest").unwrap();
        assert_eq!(pytest.group, "dev");
        assert_eq!(pytest.files, 5);
        assert_eq!(pytest.file, "tests/a.py"); // 首位点
        assert!(!pytest.lazy);                 // 混入顶层位点 → 非惰性
        let yaml = decl_mods.iter().find(|m| m.module == "yaml").unwrap();
        assert_eq!(yaml.dist, "pyyaml");       // 别名表归一化命中
        assert_eq!(yaml.group, "declared");    // 无组映射 → 默认组
        // 边界：模块名与声明 dist 完全无关联（反查空 + 别名表无 + 名字不同）→ 仍进 E1
        // （dotenv→python-dotenv 由别名表覆盖命中——正确分流；此处的 somelib 验证全 miss 路径）
        let mut declared2 = DeclaredDeps::default();
        declared2.all.insert("totally-other-pkg".into());
        let p2 = probe(
            vec![("m.py", "somelib", 1, false)],
            vec![("somelib", "missing", None)],
        );
        let (e1b, decl_b) = compute_missing_in_env(&p2, &declared2, "declared");
        assert_eq!(e1b.len(), 1, "匹配链全 miss → 留 E1（宁可多报不漏）");
        assert!(decl_b.is_empty());
    }

    #[test]
    fn e1_missing_aggregates_by_module_file_with_lazy_and_alias() {
        let p = probe(
            vec![
                ("a.py", "nope", 5, false),
                ("a.py", "nope", 9, true),   // 同模块同文件第二位点：顶层在先 → lazy=false
                ("b.py", "yaml", 3, true),   // 别名表兜底：yaml → PyYAML
                ("b.py", "os", 1, false),    // stdlib 不进 E1
            ],
            vec![
                ("nope", "missing", None),
                ("yaml", "missing", None),
                ("os", "stdlib", None),
            ],
        );
        // 声明全集为空（空 DeclaredDeps）→ 分流不触发，E1 行为与旧口径一致
        let (e1, decl_mods) = compute_missing_in_env(&p, &DeclaredDeps::default(), "declared");
        assert!(decl_mods.is_empty());
        assert_eq!(e1.len(), 2);
        let nope = e1.iter().find(|m| m.module == "nope").unwrap();
        assert_eq!(nope.file, "a.py");
        assert_eq!(nope.line, 5);   // 首位点行号
        assert!(!nope.lazy);        // 任一顶层位点 → 非惰性
        assert_eq!(nope.dist, None);
        let yaml = e1.iter().find(|m| m.module == "yaml").unwrap();
        assert!(yaml.lazy);
        assert_eq!(yaml.dist.as_deref(), Some("PyYAML"));
        assert_eq!(yaml.dist_candidates, vec!["PyYAML".to_string()]); // M4-4：别名兜底也进候选
    }

    #[test]
    fn e4_undeclared_excludes_declared_devtools_and_self() {
        let p = probe(
            vec![
                ("main.py", "requests", 1, false),  // 已声明 → 排除
                ("main.py", "numpy", 2, false),     // site 且未声明 → E4
                ("main.py", "ruff", 3, false),      // 工具链自装 → 排除
                ("main.py", "demo", 4, false),      // 项目自身（uv sync editable）→ 排除
                ("main.py", "os", 5, false),        // stdlib → 排除
                ("main.py", "gone", 6, false),      // missing → 归 E1 不进 E4
                ("main.py", "yaml", 7, false),      // site 无 dist（缺 top_level.txt）→ 别名归一 PyYAML 已声明 → 排除
            ],
            vec![
                ("requests", "site", Some("requests")),
                ("numpy", "site", Some("numpy")),
                ("ruff", "site", Some("ruff")),
                ("demo", "site", Some("demo")),
                ("os", "stdlib", None),
                ("gone", "missing", None),
                ("yaml", "site", None),
            ],
        );
        let mut declared = DeclaredDeps::default();
        declared.all.insert("requests".into());
        declared.all.insert("pyyaml".into());
        let e4 = compute_undeclared(&p, &declared, Some("demo"));
        assert_eq!(e4.len(), 1);
        assert_eq!(e4[0].module, "numpy");
        assert_eq!(e4[0].dist.as_deref(), Some("numpy"));
        assert_eq!(e4[0].file, "main.py");
        assert_eq!(e4[0].line, 2);
    }

    #[test]
    fn e2_declared_missing_normalized_match() {
        let mut declared = DeclaredDeps::default();
        declared.core = vec![
            DeclaredDep { dist: "requests".into(), spec: ">=2".into() },
            DeclaredDep { dist: "zope-interface".into(), spec: "".into() },
            DeclaredDep { dist: "flask".into(), spec: ">=3".into() },
        ];
        // 环境装了 Zope.Interface（大小写/分隔符异形）→ 归一化后视为已装
        let installed = vec![("requests".to_string(), "2.31".to_string()), ("Zope.Interface".to_string(), "7.2".to_string())];
        let e2 = compute_declared_missing(&declared, &installed);
        assert_eq!(e2, vec![DeclaredMissing { dist: "flask".into(), spec: ">=3".into() }]);
    }

    #[test]
    fn e3_drift_excludes_infra_devtools_and_self() {
        let installed = vec![
            ("numpy".to_string(), "2.0".to_string()),
            ("pip".to_string(), "26.0".to_string()),
            ("setuptools".to_string(), "80.0".to_string()),
            ("wheel".to_string(), "0.45".to_string()),
            ("pyrefly".to_string(), "1.3".to_string()),
            ("ruff".to_string(), "0.16".to_string()),
            ("debugpy".to_string(), "1.8".to_string()),
            ("uv".to_string(), "0.10".to_string()),
            ("demo".to_string(), "0.1".to_string()),   // 项目自身（editable 装）
            ("Flask".to_string(), "3.0".to_string()),  // 已声明（异形大小写）
        ];
        let mut declared = DeclaredDeps::default();
        declared.all.insert("flask".into());
        let e3 = compute_env_drift(&installed, &declared, Some("demo"));
        assert_eq!(e3, vec![EnvDriftPkg { dist: "numpy".into(), version: "2.0".into() }]);
    }

    #[test]
    fn e2_requirements_uninstalled_special_case() {
        let mut declared = DeclaredDeps::default();
        declared.core = vec![DeclaredDep { dist: "requests".into(), spec: "".into() }];
        declared.all.insert("requests".into());
        // 全新 venv（只有基础设施包）→ 整个 requirements 未安装（反馈 1 场景）
        assert!(compute_requirements_uninstalled(&declared, &[("pip".into(), "26".into())]));
        // 部分安装 → false（剩余缺口由 E2 逐条表达）
        assert!(!compute_requirements_uninstalled(&declared, &[("requests".into(), "2.31".into())]));
        // 声明集为空 → 恒 false
        assert!(!compute_requirements_uninstalled(&DeclaredDeps::default(), &[]));
    }

    #[test]
    fn dist_alias_fallback_table() {
        assert_eq!(effective_dist("yaml", None).as_deref(), Some("PyYAML"));
        assert_eq!(effective_dist("cv2", None).as_deref(), Some("opencv-python"));
        // 探针反查优先于别名表
        assert_eq!(effective_dist("yaml", Some("pyyaml-ng")).as_deref(), Some("pyyaml-ng"));
        assert_eq!(effective_dist("totally_unknown", None), None);
    }

    // ----- M3：plan_dep_fix（§5.1 动作矩阵：action × style → uv 参数，纯函数单点构建） -----

    fn dep_style_of(style: &str, mgr: Option<&str>, req: Option<&str>) -> DepStyle {
        DepStyle {
            style: style.to_string(),
            external_manager: mgr.map(String::from),
            requirements_file: req.map(String::from),
        }
    }

    fn dists(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn fix_install_pyproject_uses_uv_add() {
        let args = plan_dep_fix(
            "install",
            &dep_style_of("pyproject", None, None),
            &dists(&["requests", "flask"]),
            None,
        )
        .unwrap();
        assert_eq!(args, vec!["add", "requests", "flask"]);
    }

    #[test]
    fn fix_install_non_pyproject_uses_pip_install() {
        // requirements / bare / external：只装解释器环境不写声明
        //（external 的声明层归外部管理器所有，E1 仍生效，§4.2.1/R11）
        for style in ["requirements", "bare", "external"] {
            let args = plan_dep_fix(
                "install",
                &dep_style_of(style, None, Some("requirements.txt")),
                &dists(&["numpy"]),
                Some("C:/venv/python.exe"),
            )
            .unwrap();
            assert_eq!(
                args,
                vec!["pip", "install", "--python", "C:/venv/python.exe", "numpy"],
                "style={style}"
            );
        }
    }

    #[test]
    fn fix_install_requires_dists_and_interpreter() {
        // pyproject：无包名 → Err（uv add 空参数没有意义）
        assert!(plan_dep_fix("install", &dep_style_of("pyproject", None, None), &[], None).is_err());
        // 非 pyproject：无解释器 → Err（文案引导先选解释器）
        let e = plan_dep_fix("install", &dep_style_of("bare", None, None), &dists(&["x"]), None).unwrap_err();
        assert!(e.contains("解释器"), "{e}");
    }

    #[test]
    fn fix_sync_by_style() {
        assert_eq!(
            plan_dep_fix("sync", &dep_style_of("pyproject", None, None), &[], None).unwrap(),
            vec!["sync"]
        );
        let args = plan_dep_fix(
            "sync",
            &dep_style_of("requirements", None, Some("requirements.txt")),
            &[],
            Some("P"),
        )
        .unwrap();
        assert_eq!(args, vec!["pip", "install", "--python", "P", "-r", "requirements.txt"]);
        // external：E2 禁用（不给错误结果，R11）；bare：无声明可同步
        assert!(plan_dep_fix("sync", &dep_style_of("external", Some("poetry"), None), &[], Some("P")).is_err());
        assert!(plan_dep_fix("sync", &dep_style_of("bare", None, None), &[], Some("P")).is_err());
    }

    #[test]
    fn fix_declare_only_pyproject() {
        assert_eq!(
            plan_dep_fix("declare", &dep_style_of("pyproject", None, None), &dists(&["numpy"]), None).unwrap(),
            vec!["add", "numpy"]
        );
        // requirements/bare：无 pyproject 可写 → Err（文案引导先迁移）；external：声明写入禁用
        let e = plan_dep_fix("declare", &dep_style_of("requirements", None, Some("requirements.txt")), &dists(&["numpy"]), None).unwrap_err();
        assert!(e.contains("迁移"), "{e}");
        assert!(plan_dep_fix("declare", &dep_style_of("bare", None, None), &dists(&["numpy"]), None).is_err());
        assert!(plan_dep_fix("declare", &dep_style_of("external", Some("pdm"), None), &dists(&["numpy"]), None).is_err());
    }

    #[test]
    fn fix_lock_only_pyproject() {
        assert_eq!(
            plan_dep_fix("lock", &dep_style_of("pyproject", None, None), &[], None).unwrap(),
            vec!["lock"]
        );
        assert!(plan_dep_fix("lock", &dep_style_of("requirements", None, Some("requirements.txt")), &[], None).is_err());
    }

    #[test]
    fn fix_migrate_reads_requirements_only() {
        // R4/R4.1：uv add -r 只读原文件、写 pyproject（不改写不删除 requirements.txt）
        let args = plan_dep_fix(
            "migrate",
            &dep_style_of("requirements", None, Some("requirements.txt")),
            &[],
            None,
        )
        .unwrap();
        assert_eq!(args, vec!["add", "-r", "requirements.txt"]);
        // bare（无 requirements 文件）→ 无从迁移；external → 不适用
        assert!(plan_dep_fix("migrate", &dep_style_of("bare", None, None), &[], None).is_err());
        assert!(plan_dep_fix("migrate", &dep_style_of("external", Some("poetry"), None), &[], None).is_err());
    }

    #[test]
    fn fix_unknown_action_rejected() {
        assert!(plan_dep_fix("reboot", &dep_style_of("pyproject", None, None), &[], None).is_err());
    }

    // ----- M3：忽略清单（§5.3/R9：归一化 / 容错解析 / diff 过滤） -----

    #[test]
    fn ignore_entry_normalization() {
        // E2/E3 dist 键经 PEP 503 归一（存储与比对同口径）
        assert_eq!(
            normalized_ignore_entry("e3", " Zope.Interface ").unwrap(),
            DepIgnoreEntry { edge: "e3".into(), key: "zope-interface".into() }
        );
        // E1/E4 模块名原样保留（Python 模块大小写敏感）
        assert_eq!(
            normalized_ignore_entry("e1", "MyMod").unwrap(),
            DepIgnoreEntry { edge: "e1".into(), key: "MyMod".into() }
        );
        // 非法 edge（E5 是项目级布尔无行级忽略语义）/ 空 key → Err
        assert!(normalized_ignore_entry("e5", "x").is_err());
        assert!(normalized_ignore_entry("e9", "x").is_err());
        assert!(normalized_ignore_entry("e1", "   ").is_err());
    }

    #[test]
    fn ignore_list_from_config_tolerates_garbage() {
        // 字段缺失 / 类型错误 / 条目损坏 → 一律空清单（绝不 panic，同 load_config 口径）
        assert_eq!(dep_ignores_from_config(&json!({})), vec![]);
        assert_eq!(dep_ignores_from_config(&json!({"dep_ignored": "not-an-array"})), vec![]);
        assert_eq!(dep_ignores_from_config(&json!({"dep_ignored": [{"bogus": 1}]})), vec![]);
        let v = json!({"dep_ignored": [{"edge": "e1", "key": "foo"}]});
        assert_eq!(
            dep_ignores_from_config(&v),
            vec![DepIgnoreEntry { edge: "e1".into(), key: "foo".into() }]
        );
    }

    fn ignore_test_diff() -> DepDiff {
        DepDiff {
            style: "pyproject".into(),
            external_manager: None,
            missing_in_env: vec![
                MissingModule { module: "foo".into(), dist: None, dist_candidates: vec![], file: "a.py".into(), line: 1, lazy: false },
                MissingModule { module: "bar".into(), dist: None, dist_candidates: vec![], file: "a.py".into(), line: 2, lazy: false },
            ],
            declared_missing: vec![DeclaredMissing { dist: "zope-interface".into(), spec: "".into() }],
            declared_missing_modules: vec![DeclaredMissingModule {
                module: "pytest".into(), dist: "pytest".into(), group: "dev".into(),
                files: 2, file: "t1.py".into(), line: 1, lazy: false,
            }],
            env_drift: vec![EnvDriftPkg { dist: "numpy".into(), version: "2.0".into() }],
            undeclared: vec![UndeclaredModule { module: "pandas".into(), dist: Some("pandas".into()), dist_candidates: vec![], file: "b.py".into(), line: 3 }],
            lock_out_of_date: true,
            requirements_uninstalled: false,
            interpreter: Some("P".into()),
            requirements_file: None,
            scanned_at: 1,
        }
    }

    #[test]
    fn apply_dep_ignores_filters_all_edges() {
        let mut diff = ignore_test_diff();
        let ignores = vec![
            DepIgnoreEntry { edge: "e1".into(), key: "foo".into() },
            // E3 键为异形大写（手改配置绕过 add 归一）——过滤侧归一化防御仍命中
            DepIgnoreEntry { edge: "e3".into(), key: "Numpy".into() },
            DepIgnoreEntry { edge: "e4".into(), key: "pandas".into() },
            // v1.7 A：E2 小节条目（按模块名忽略）——归一化比对命中
            DepIgnoreEntry { edge: "e2".into(), key: "pytest".into() },
        ];
        apply_dep_ignores(&mut diff, &ignores);
        // E1：foo 被忽略、bar 保留
        assert_eq!(diff.missing_in_env.len(), 1);
        assert_eq!(diff.missing_in_env[0].module, "bar");
        // E2 未被忽略 → 保留；E2 小节（declared_missing_modules）被忽略 → 清空
        assert_eq!(diff.declared_missing.len(), 1);
        assert!(diff.declared_missing_modules.is_empty());
        assert!(diff.env_drift.is_empty());
        assert!(diff.undeclared.is_empty());
        // E5 项目级布尔无行级忽略语义 → 不受影响
        assert!(diff.lock_out_of_date);
    }

    #[test]
    fn apply_dep_ignores_e2_normalized_match() {
        let mut diff = ignore_test_diff();
        // 存储键为点分异形：归一化后与 diff 的 zope-interface 命中
        let ignores = vec![DepIgnoreEntry { edge: "e2".into(), key: "Zope.Interface".into() }];
        apply_dep_ignores(&mut diff, &ignores);
        assert!(diff.declared_missing.is_empty());
        // 其余断边不受影响
        assert_eq!(diff.missing_in_env.len(), 2);
    }

    #[test]
    fn apply_dep_ignores_empty_noop() {
        let mut diff = ignore_test_diff();
        apply_dep_ignores(&mut diff, &[]);
        assert_eq!(diff.missing_in_env.len(), 2);
        assert_eq!(diff.declared_missing.len(), 1);
        assert_eq!(diff.env_drift.len(), 1);
        assert_eq!(diff.undeclared.len(), 1);
    }

    #[test]
    fn save_dep_ignores_dedup_preserves_order() {
        // 去重保序是 save_dep_ignores 的纯逻辑前段；fs 写回依赖 opencharm_home 不可注入，
        // 此处用与 save_dep_ignores 相同的去重表达式锁定语义（重复条目以首次出现为准）
        let list = vec![
            DepIgnoreEntry { edge: "e1".into(), key: "a".into() },
            DepIgnoreEntry { edge: "e1".into(), key: "a".into() },
            DepIgnoreEntry { edge: "e3".into(), key: "b".into() },
        ];
        let mut seen = HashSet::new();
        let cleaned: Vec<_> = list
            .into_iter()
            .filter(|e| seen.insert((e.edge.clone(), e.key.clone())))
            .collect();
        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[0].key, "a");
        assert_eq!(cleaned[1].key, "b");
    }

    // ----- M4-4：dist 歧义（同 module 多 dist 候选） -----

    #[test]
    fn e1_e4_carry_multi_dist_candidates() {
        let p = probe_with_candidates(
            vec![
                ("a.py", "ambiguous", 1, false),  // missing 且多候选
                ("b.py", "clean", 2, false),      // site 单候选 → E4 多候选字段 = 单元素
                ("b.py", "noinfo", 3, false),     // site 无候选（无 top_level.txt）→ 候选空、dist null
            ],
            vec![
                ("ambiguous", "missing", None),
                ("clean", "site", Some("clean-dist")),
                ("noinfo", "site", None),
            ],
            vec![
                ("ambiguous", vec!["pkg-a", "pkg-b"]),
                ("clean", vec!["clean-dist"]),
            ],
        );

        let (e1, _) = compute_missing_in_env(&p, &DeclaredDeps::default(), "declared");
        let amb = e1.iter().find(|m| m.module == "ambiguous").unwrap();
        // 首候选兼容旧 dist 语义；候选全集透传
        assert_eq!(amb.dist.as_deref(), Some("pkg-a"));
        assert_eq!(amb.dist_candidates, vec!["pkg-a".to_string(), "pkg-b".to_string()]);

        let declared = DeclaredDeps::default();
        let e4 = compute_undeclared(&p, &declared, None);
        let clean = e4.iter().find(|u| u.module == "clean").unwrap();
        assert_eq!(clean.dist.as_deref(), Some("clean-dist"));
        assert_eq!(clean.dist_candidates, vec!["clean-dist".to_string()]);
        let noinfo = e4.iter().find(|u| u.module == "noinfo").unwrap();
        assert_eq!(noinfo.dist, None);
        assert!(noinfo.dist_candidates.is_empty());
    }

    #[test]
    fn probe_resolution_candidate_fallbacks() {
        // 旧形态构造（仅 dist 单值，无 distCandidates）→ all_candidates 视为唯一候选
        let legacy = ProbeResolution { status: "missing".into(), dist: Some("legacy".into()), dist_candidates: vec![] };
        assert_eq!(legacy.all_candidates(), vec!["legacy".to_string()]);
        assert_eq!(legacy.first_dist(), Some("legacy"));
        // 新形态：候选列表优先，dist 字段为首候选镜像
        let full = ProbeResolution {
            status: "missing".into(),
            dist: Some("first".into()),
            dist_candidates: vec!["first".into(), "second".into()],
        };
        assert_eq!(full.all_candidates(), vec!["first".to_string(), "second".to_string()]);
        // 空候选 → 别名表兜底路径（effective_dist_candidates）
        let empty = ProbeResolution { status: "missing".into(), dist: None, dist_candidates: vec![] };
        let (first, cands) = effective_dist_candidates("yaml", &empty);
        assert_eq!(first.as_deref(), Some("PyYAML"));
        assert_eq!(cands, vec!["PyYAML".to_string()]);
        // 别名表无此模块 → dist null、候选空（正常占比，§3.3）
        let (first2, cands2) = effective_dist_candidates("mystery", &empty);
        assert_eq!(first2, None);
        assert!(cands2.is_empty());
    }

    // ----- M4-2：scope 分流与缓存 -----

    #[test]
    fn scan_scope_routing() {
        use super::ScanScope;
        // from_str：缺省/未知 → full（保守）
        assert_eq!(ScanScope::from_str("full"), ScanScope::Full);
        assert_eq!(ScanScope::from_str("code"), ScanScope::Code);
        assert_eq!(ScanScope::from_str("declaration"), ScanScope::Declaration);
        assert_eq!(ScanScope::from_str("bogus"), ScanScope::Full);
        assert_eq!(ScanScope::from_str(""), ScanScope::Full);
        // 分层开关
        assert!(ScanScope::Full.runs_code() && ScanScope::Full.runs_env() && ScanScope::Full.runs_lock_check());
        assert!(ScanScope::Code.runs_code() && !ScanScope::Code.runs_env() && !ScanScope::Code.runs_lock_check());
        assert!(!ScanScope::Declaration.runs_code() && ScanScope::Declaration.runs_env() && !ScanScope::Declaration.runs_lock_check());
    }

    #[test]
    fn resolution_and_env_snapshot_cache_semantics() {
        let ws_a = Path::new("F:/ws-a");
        let ws_b = Path::new("F:/ws-b");

        // ---- resolution：键 = 解释器+工作区根（复核修复 #1）；代次守卫（复核修复 #2）----
        let mut m = HashMap::new();
        m.insert("os".to_string(), ProbeResolution { status: "stdlib".into(), dist: None, dist_candidates: vec![] });
        let (gen0, miss0) = load_resolution_cache("py-A", ws_a);
        assert!(miss0.is_empty()); // 无缓存 → 命中集空（但代次有效，见 load 注释）
        store_resolution_cache("py-A", ws_a, gen0, &m);
        let (_, hit_a) = load_resolution_cache("py-A", ws_a);
        assert!(hit_a.contains_key("os"));
        // 换解释器 / 换工作区 → 命中集空（键不匹配，复核修复 #1：local 分类依赖 root）
        assert!(load_resolution_cache("py-B", ws_a).1.is_empty());
        assert!(load_resolution_cache("py-A", ws_b).1.is_empty());
        // 换键写入会清空重建
        let mut m2 = HashMap::new();
        m2.insert("x".to_string(), ProbeResolution { status: "missing".into(), dist: None, dist_candidates: vec![] });
        let (gen_b, _) = load_resolution_cache("py-B", ws_b);
        store_resolution_cache("py-B", ws_b, gen_b, &m2);
        assert!(load_resolution_cache("py-B", ws_b).1.contains_key("x"));
        assert!(!load_resolution_cache("py-B", ws_b).1.contains_key("os"));
        // 作废后（generation++）：在途扫描按旧代次回写被丢弃；新代次回写正常
        invalidate_resolution_cache();
        let mut m3 = HashMap::new();
        m3.insert("stale".to_string(), ProbeResolution { status: "missing".into(), dist: None, dist_candidates: vec![] });
        store_resolution_cache("py-B", ws_b, gen_b, &m3); // 旧代次回写 → 丢弃
        assert!(load_resolution_cache("py-B", ws_b).1.is_empty());
        let (gen_new, _) = load_resolution_cache("py-B", ws_b);
        assert_ne!(gen_new, gen_b); // 代次已前进
        store_resolution_cache("py-B", ws_b, gen_new, &m3); // 新代次回写 → 生效
        assert!(load_resolution_cache("py-B", ws_b).1.contains_key("stale"));

        // ---- 环境快照：键 = 解释器+工作区根（复核修复 #1）----
        store_env_snapshot_cache("py-A", ws_a, &[("requests".to_string(), "2.0".to_string())]);
        let hit = load_env_snapshot_cache().unwrap();
        assert_eq!(hit.0, env_snapshot_cache_key("py-A", ws_a));
        assert_eq!(hit.1.len(), 1);
        // 切工作区后键不匹配（dep_scan_impl 的 code 复用分支会因此降级为空）
        assert_ne!(hit.0, env_snapshot_cache_key("py-A", ws_b));
        store_env_snapshot_cache("py-B", ws_b, &[]);
        let hit2 = load_env_snapshot_cache().unwrap();
        assert_eq!(hit2.0, env_snapshot_cache_key("py-B", ws_b));
        assert!(hit2.1.is_empty());
        // 收尾：清空静态缓存，避免与其他并行测试互踩（dep_scan 端到端测试共用此静态）
        let _ = std::mem::take::<Option<(String, Vec<(String, String)>)>>(&mut *unpoison(ENV_SNAPSHOT_CACHE.lock()));
        invalidate_resolution_cache();
    }

    // ----- 探针集成测试（spawn 系统 python；不可用时跳过不失败——CI 环境可移植性） -----

    #[test]
    fn probe_classifies_stdlib_local_site_missing() {
        let Some(py) = borrow_python() else {
            eprintln!("跳过探针集成测试：系统无可用 python");
            return;
        };
        let d = dep_tmpdir("probe-ws");
        fs::create_dir_all(d.join("mypkg")).unwrap();
        fs::write(d.join("mypkg/__init__.py"), "").unwrap();
        // 相对导入（level>0）应被探针跳过：sub.py 不产生任何 import 位点
        fs::write(d.join("mypkg/sub.py"), "from . import other\nfrom ..mypkg import x\n").unwrap();
        fs::write(
            d.join("main.py"),
            "import os\nimport mypkg\nimport totally_missing_xyz\n\ndef f():\n    import json\n",
        )
        .unwrap();

        // 工作区外的模块目录经 PYTHONPATH 注入 → 解析落点应为 site（模拟三方已装）
        let site = dep_tmpdir("probe-site");
        fs::write(site.join("fakelib.py"), "X = 1\n").unwrap();

        let payload = json!({
            "workspace_root": d.to_string_lossy(),
            "files": ["main.py", "mypkg/sub.py"],
            "modules": ["fakelib"],
        });
        let out = run_probe_env(
            &py,
            &d,
            &payload,
            Duration::from_secs(30),
            &[("PYTHONPATH", site.to_str().unwrap())],
        )
        .expect("探针应成功");

        // imports：main.py 四个位点（sub.py 的相对导入全部跳过）
        assert!(out.imports.iter().all(|i| i.file == "main.py"), "相对导入不应产生位点");
        let find = |m: &str| out.imports.iter().find(|i| i.module == m).expect(m);
        assert_eq!(find("os").line, 1);
        assert!(!find("os").lazy);
        assert_eq!(find("mypkg").line, 2);
        assert_eq!(find("totally_missing_xyz").line, 3);
        // §4.1 行为变更：函数体内 import 进入收集且标 lazy
        let json_imp = find("json");
        assert!(json_imp.lazy);
        assert_eq!(json_imp.line, 6);

        // resolution 分类
        let res = |m: &str| out.resolution.get(m).unwrap_or_else(|| panic!("{m} 无解析结果"));
        assert_eq!(res("os").status, "stdlib");
        assert_eq!(res("json").status, "stdlib");
        assert_eq!(res("mypkg").status, "local");
        assert_eq!(res("totally_missing_xyz").status, "missing");
        assert_eq!(res("fakelib").status, "site");

        fs::remove_dir_all(&d).unwrap();
        fs::remove_dir_all(&site).unwrap();
    }

    /// 用户实测 bug 锁定（2026-09-16，D:\PycharmProjects\handsome cbond/cb_daily.py）：
    /// 脚本式布局（子目录裸导入 `from field_map import ...`，同目录无 __init__.py）——
    /// Python 运行语义是「脚本所在目录进 sys.path[0]」，探针旧口径只插工作区根，
    /// 同目录模块被误判 missing（E1 误报「field_map/settings 缺失」）。
    #[test]
    fn probe_resolves_sibling_imports_by_script_dir() {
        let Some(py) = borrow_python() else {
            eprintln!("跳过探针集成测试：系统无可用 python");
            return;
        };
        let d = dep_tmpdir("probe-sibling");
        // 脚本式布局：sub/ 下 cb.py 裸导入同目录 field_map（无 __init__.py）
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("sub/field_map.py"), "X = 1\n").unwrap();
        fs::write(d.join("sub/cb.py"), "from field_map import X\nimport os\n").unwrap();

        let payload = json!({
            "workspace_root": d.to_string_lossy(),
            "files": ["sub/cb.py"],
            "modules": [],
            "module_dirs": {},
        });
        let out = run_probe_env(&py, &d, &payload, Duration::from_secs(30), &[]).expect("探针应成功");
        let res = |m: &str| out.resolution.get(m).unwrap_or_else(|| panic!("{m} 无解析结果"));
        assert_eq!(res("field_map").status, "local", "同目录模块须按脚本目录解析为 local（不得误报 missing）");
        assert_eq!(res("os").status, "stdlib");

        // module_dirs 路径（缓存复用模块）：Rust 侧传入的位点目录同样生效
        let payload2 = json!({
            "workspace_root": d.to_string_lossy(),
            "files": [],
            "modules": ["field_map"],
            "module_dirs": { "field_map": [d.join("sub").to_string_lossy().to_string()] },
        });
        let out2 = run_probe_env(&py, &d, &payload2, Duration::from_secs(30), &[]).expect("探针应成功");
        assert_eq!(out2.resolution.get("field_map").unwrap().status, "local");

        fs::remove_dir_all(&d).unwrap();
    }

    /// fika-admin 实测 bug 锁定（2026-09-16）：uv.lock 锁定闭包（传递依赖）不报 E3 漂移。
    /// uv sync 装的环境里 pydantic-core/starlette/typing-extensions 按 lock 合法存在，
    /// 旧口径只按 pyproject 排除 → 63 项全是噪声「漂移」。
    #[test]
    fn uv_lock_closure_excluded_from_drift_and_undeclared() {
        let d = dep_tmpdir("lock-closure");
        fs::write(
            d.join("pyproject.toml"),
            "[project]\nname = \"demo\"\ndependencies = [\"fastapi>=0.110\"]\n",
        )
        .unwrap();
        // uv.lock：锁定闭包含传递依赖 starlette / pydantic-core
        fs::write(
            d.join("uv.lock"),
            "version = 1\n\n[[package]]\nname = \"demo\"\nversion = \"1.0.0\"\n\n[[package]]\nname = \"fastapi\"\nversion = \"0.136\"\n\n[[package]]\nname = \"starlette\"\nversion = \"1.2\"\n\n[[package]]\nname = \"pydantic-core\"\nversion = \"2.46\"\n\n[manifest]\nname = \"manifest-should-not-count\"\n",
        )
        .unwrap();
        // 环境装了 fastapi + 传递依赖 starlette/pydantic-core + 真漂移 pkga
        let installed = vec![
            ("fastapi".to_string(), "0.136".to_string()),
            ("starlette".to_string(), "1.2".to_string()),
            ("pydantic-core".to_string(), "2.46".to_string()),
            ("pkga".to_string(), "0.1".to_string()),
        ];
        let (mut declared, name) = parse_pyproject_deps(&fs::read_to_string(d.join("pyproject.toml")).unwrap());
        let lock_names = parse_uv_lock_names(&d);
        assert!(lock_names.contains("starlette") && lock_names.contains("pydantic-core"), "lock 名单解析");
        assert!(!lock_names.contains("manifest-should-not-count"), "[manifest] 段不得计入");
        declared.all.extend(lock_names);

        let e3 = compute_env_drift(&installed, &declared, name.as_deref());
        assert_eq!(e3.len(), 1, "lock 闭包内的传递依赖不报漂移：{e3:?}");
        assert_eq!(e3[0].dist, "pkga");

        // E4：lock 闭包内的 import（starlette）不报未声明
        let p = probe(
            vec![("main.py", "starlette", 1, false), ("main.py", "fastapi", 2, false)],
            vec![
                ("starlette", "site", Some("starlette")),
                ("fastapi", "site", Some("fastapi")),
            ],
        );
        let e4 = compute_undeclared(&p, &declared, name.as_deref());
        assert!(e4.is_empty(), "lock 闭包与已声明包都不进 E4：{e4:?}");

        // E2（core 同步范围）不受 lock 并入影响：lock 里有的包没装时，只要不在
        // pyproject core 声明中就不报「声明未安装」（lock 是结果不是要求）
        let e2 = compute_declared_missing(&declared, &installed);
        assert!(e2.is_empty(), "fastapi 已装 → E2 无缺失：{e2:?}");

        fs::remove_dir_all(&d).unwrap();
    }

    // ----- dep_scan 端到端（无解释器路径：确定性——不触发 uv/venv 子进程；python 缺失则跳过） -----

    #[test]
    fn dep_scan_bare_no_interpreter() {
        if borrow_python().is_none() {
            eprintln!("跳过 dep_scan 端到端：系统无可用 python");
            return;
        }
        let d = dep_tmpdir("scan-bare");
        fs::write(d.join("main.py"), "import os\nimport missing_thing\n").unwrap();
        let diff = dep_scan_impl(d.to_str().unwrap(), ScanScope::Full).unwrap();
        assert_eq!(diff.style, "bare");
        assert!(diff.interpreter.is_none());
        // §3.3：interpreter=null → 环境侧 E1/E2/E3 置空
        assert!(diff.missing_in_env.is_empty());
        assert!(diff.declared_missing.is_empty());
        assert!(diff.env_drift.is_empty());
        // E4 仅 pyproject 项目
        assert!(diff.undeclared.is_empty());
        assert!(!diff.lock_out_of_date);
        assert!(!diff.requirements_uninstalled);
        assert!(diff.scanned_at > 0);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn dep_scan_pyproject_no_interpreter_computes_e4_only() {
        if borrow_python().is_none() {
            eprintln!("跳过 dep_scan 端到端：系统无可用 python");
            return;
        }
        let d = dep_tmpdir("scan-pyproj");
        fs::write(
            d.join("pyproject.toml"),
            "[project]\nname = \"demo\"\ndependencies = [\"requests>=2\"]\n",
        )
        .unwrap();
        fs::write(
            d.join("main.py"),
            "import os\nimport requests\nimport demo_helper\nimport mystery_mod\n",
        )
        .unwrap();
        fs::write(d.join("demo_helper.py"), "").unwrap();
        // 无 .venv、无 uv.lock：解释器 null → 环境侧全空；无 lock 文件 → 不报过期
        let diff = dep_scan_impl(d.to_str().unwrap(), ScanScope::Full).unwrap();
        assert_eq!(diff.style, "pyproject");
        assert!(diff.interpreter.is_none());
        assert!(diff.missing_in_env.is_empty());
        assert!(diff.declared_missing.is_empty());
        assert!(diff.env_drift.is_empty());
        assert!(!diff.lock_out_of_date);
        // E4：requests 已声明、os stdlib、demo_helper 一方、mystery_mod missing（归 E1 不进 E4）
        assert!(diff.undeclared.is_empty(), "E4 不应误报：{:?}", diff.undeclared);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn dep_scan_external_disables_declaration_sides() {
        let d = dep_tmpdir("scan-ext");
        fs::write(d.join("pyproject.toml"), "[tool.poetry]\nname=\"x\"\n").unwrap();
        fs::write(d.join("poetry.lock"), "# lock").unwrap();
        fs::write(d.join("main.py"), "import os\n").unwrap();
        let diff = dep_scan_impl(d.to_str().unwrap(), ScanScope::Full).unwrap();
        assert_eq!(diff.style, "external");
        assert_eq!(diff.external_manager.as_deref(), Some("poetry"));
        // §4.2.1/R11：external 时 E2~E5 主动禁用（不给错误结果）
        assert!(diff.declared_missing.is_empty());
        assert!(diff.env_drift.is_empty());
        assert!(diff.undeclared.is_empty());
        assert!(!diff.lock_out_of_date);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn dep_scan_requirements_style_no_interpreter() {
        let d = dep_tmpdir("scan-req");
        fs::write(d.join("requirements.txt"), "requests>=2\nflask\n# comment\n-r other.txt\n").unwrap();
        let diff = dep_scan_impl(d.to_str().unwrap(), ScanScope::Full).unwrap();
        assert_eq!(diff.style, "requirements");
        assert_eq!(diff.requirements_file.as_deref(), Some("requirements.txt"));
        // interpreter=null → E2 特例不可判（环境快照缺失），恒 false
        assert!(!diff.requirements_uninstalled);
        assert!(diff.declared_missing.is_empty());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn dep_scan_rejects_missing_workspace() {
        let e = dep_scan_impl("Z:\\__opencharm_no_such_ws__", ScanScope::Full).unwrap_err();
        assert!(e.contains("工作区不存在"));
    }

    /// bench 摸底（§4.1 性能红线 ≤2s 的计时 harness，M1 落地）：对 bench/sample 下每个
    /// 样例项目跑一遍 dep_scan_impl 打印耗时。样例体量小（个位数文件），本用例验证的是
    /// 「全链路可跑通 + 计时可见」；大仓库红线待 bench 集扩充后在 M4 复验（`--ignored` 手动跑：
    /// `cargo test --release bench_dep_scan -- --ignored --nocapture`）。
    #[test]
    #[ignore = "需要本机 uv/python 环境，手动跑（bench 摸底）"]
    fn bench_dep_scan_timing() {
        let samples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bench/sample");
        let Ok(rd) = fs::read_dir(&samples) else {
            eprintln!("bench/sample 不存在：{}", samples.display());
            return;
        };
        let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for d in dirs {
            let t0 = Instant::now();
            match dep_scan_impl(d.to_str().unwrap(), ScanScope::Full) {
                Ok(diff) => println!(
                    "{:<24} style={:<12} E1={} E2={} E3={} E4={} lock={} took={}ms",
                    d.file_name().unwrap().to_string_lossy(),
                    diff.style,
                    diff.missing_in_env.len(),
                    diff.declared_missing.len(),
                    diff.env_drift.len(),
                    diff.undeclared.len(),
                    diff.lock_out_of_date,
                    t0.elapsed().as_millis()
                ),
                Err(e) => println!("{:<24} ERROR {e}", d.file_name().unwrap().to_string_lossy()),
            }
        }
    }
}
