// 运行配置域（v3.4）：工作区配置存储 + 脚本/项目运行配置 + 项目入口自动探测。
//
// 2026-10-07 自 env_cmds.rs 拆分（P0-4「先冻结再择机拆」执行）：工作区配置存储与
// 运行配置本属同一存储域（`<data_root>/workspaces/<project-hash>.json`，粒度与 probe
// 的 trace 库一致），项目入口自动探测（§9）写的就是项目运行配置——三者内聚，独立成模块。
//
// 设计要点（沿自 env_cmds.rs 原注释）：
// - 解释器选择存 <data_root>/workspaces/<project-hash>.json（不侵入用户项目）；
// - 脚本配置每文件一份（可选），键 = 脚本相对工作区根路径（正斜杠，run_config_key 归一）；
//   项目配置每项目一份，固定键 `project_run`，entry 为 module | script 二选一；
// - 旧 run_profiles 数组（v2 命名配置列表）直接忽略废弃：不读取、不转换、不回写（§4.3）；
// - 探测口径与 FastAPI 探测一致：纯文件读取，无子进程（§9）。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::env_cmds::{deps_mention, py_module_target, scan_app_decl};
use crate::file_ops::project_hash;
use crate::util::opencharm_home;

// ---------- 工作区配置存储 ----------

fn workspaces_dir() -> PathBuf {
    opencharm_home().join("workspaces")
}

fn workspace_config_path(root: &str) -> PathBuf {
    workspaces_dir().join(format!("{}.json", project_hash(root)))
}

/// 读取整份工作区配置（缺失/损坏时返回空对象，绝不 panic）
pub(crate) fn load_config(root: &str) -> Value {
    let p = workspace_config_path(root);
    fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

/// 写回整份工作区配置（保留未涉及字段，如 interpreter 与 run_configs 互不覆盖）
pub(crate) fn save_config(root: &str, v: &Value) -> Result<(), String> {
    let p = workspace_config_path(root);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let payload = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    fs::write(&p, payload).map_err(|e| e.to_string())
}

pub(crate) fn read_config(root: &str) -> Option<String> {
    load_config(root)
        .get("interpreter")
        .and_then(|x| x.as_str())
        .map(String::from)
}

pub(crate) fn write_config(root: &str, interpreter: Option<&str>) -> Result<(), String> {
    let mut v = load_config(root);
    let obj = v.as_object_mut().ok_or("工作区配置格式非法")?;
    match interpreter {
        Some(i) => {
            obj.insert("interpreter".into(), json!(i));
        }
        None => {
            // 显式写 null（= uv run 兜底）而非删键——get_interpreter 据「键是否存在」区分
            // 「显式选 uv run」与「从未设置（自动检测 .venv）」；删键会让自动检测覆盖用户选择
            obj.insert("interpreter".into(), json!(null));
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
/// 仅扫根目录第一层子目录（包入口惯例在浅层）。
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
            if let Some((file, app_var)) = scan_app_decl(root, "FastAPI") {
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

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

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
