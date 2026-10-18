// 依赖健康（Dep Health M1，docs/dep_health_dev_plan.md）：dep 域「代码 / 声明 / 环境」三层
// 事实的一致性 diff 检测层（L0 style / 声明解析 / 环境快照 / E5 lock / 探针脚本与分类）。
// **检测层只读不写**——任何收敛动作都源于用户显式操作（决策 R5），写环境入口在 dep_fix.rs。
//
// 2026-10-07 自 env_cmds.rs 拆分（P0-4「先冻结再择机拆」执行）：本文件承载 dep 域前半段
// （探针脚本常量 + 声明层 + 环境层 + E5 lock），dep_fix.rs 承载后半段（探针执行 / diff 计算 /
// dep_scan 编排 / 忽略清单 / 修复动作）。跨段互通项经 pub(crate) 暴露（见各符号注释）。
//
// 命令分层（§4.5 耗时级）：`dep_style` L0 同步（纯文件存在性，零子进程）；`dep_scan` L1+L2
// 异步全量在 dep_fix.rs（单层失败降级不中断）。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::Duration;

use crate::env_cmds::{run_with_timeout, UV_LIST_TIMEOUT, UV_OUTDATED_TIMEOUT};
use crate::tool_paths::{tool_command, ENV_UV};

// ---------- 依赖健康（Dep Health M1，docs/dep_health_dev_plan.md） ----------
//
// 三层事实（代码/声明/环境）的一致性 diff 唯一真值：所有症状（红线不消、ImportError、
// pyproject 不同步…）都是 DepDiff 的投影（决策 R1）。检测层只读不写——任何收敛动作
// 都源于用户显式操作（决策 R5），本模块不含任何写环境的代码路径。
//
// 命令分层（§4.5 耗时级）：
// - `dep_style`：L0 同步（纯文件存在性，零子进程），打开工作区 t0 即出 style；
// - `dep_scan`：L1+L2 异步全量（环境快照 + 代码层探针 + diff 计算），单层失败降级不中断。
//
// style 判定唯一序（v1.3 修订，2026-09-16 实施反馈）：**external → pyproject → requirements → bare**。
// 原计划字面序 pyproject 优先，但 poetry/pdm 项目必有 pyproject.toml，按字面序会被误判为
// pyproject（[project] dependencies 解析为空 → 全部已装包被报 E3 漂移，§9.1 poetry 验收场景
// 不成立）。锁文件是「谁拥有声明层」的强信号，与 §4.2.1「附带 requirements.txt 也按 external」
// 同理推广到 pyproject.toml。代价：uv 迁移后残留旧锁文件的项目被误判 external——边界横幅
// 正好提示清理锁文件完成迁移。

pub(crate) const DEP_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// E3 漂移排除清单：前三项为 Montauri 工具链自装的开发工具（§3.3 字段语义）；
/// 后四项为 Python 环境基础设施包——老 venv（python -m venv）常自带 pip/setuptools/wheel，
/// 它们不是项目依赖，报漂移纯属噪声（对计划的小幅扩展，已记 §11 v1.3 修订）。
pub(crate) const DRIFT_EXCLUDED: [&str; 7] = ["pyrefly", "ruff", "debugpy", "pip", "setuptools", "wheel", "uv"];

/// 缺失模块的 dist 兜底别名表：`packages_distributions()` 只覆盖**已安装**发行版，
/// 对缺失模块（E1 的主要消费者）天然反查不到，须内置常见「import 名 ≠ 发行版名」映射。
/// 与 envPanel.ts 的 PACKAGE_ALIASES 同源——M3 灯泡切 diff 数据源后该表退役，此处为唯一兜底。
/// 反查仍失败 → dist=null（正常占比而非罕见兜底，§3.3），修复动作降级为按模块名安装。
pub(crate) const DIST_ALIAS_FALLBACK: [(&str, &str); 7] = [
    ("PIL", "Pillow"),
    ("cv2", "opencv-python"),
    ("sklearn", "scikit-learn"),
    ("yaml", "PyYAML"),
    ("dotenv", "python-dotenv"),
    ("bs4", "beautifulsoup4"),
    ("Crypto", "pycryptodome"),
];

/// 外部管理器锁文件 → 管理器名（判定序 = 数组序，固定）。conda 仅靠 environment.yml
/// 存在性识别，多数 conda 项目不放此文件会 fallthrough 到 bare——已知边界非识别 bug（§4.2.1）。
pub(crate) const EXTERNAL_LOCKS: [(&str, &str); 4] = [
    ("poetry.lock", "poetry"),
    ("Pipfile", "pipenv"),
    ("pdm.lock", "pdm"),
    ("environment.yml", "conda"),
];

/// L0 style 判定结果（§3.3 契约的轻量子集；camelCase 对齐 TS 消费端）
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DepStyle {
    /// "pyproject" | "requirements" | "bare" | "external"
    pub style: String,
    /// style=external 时的管理器名（poetry/pipenv/pdm/conda），其余为 null
    pub external_manager: Option<String>,
    /// style=requirements 时命中的主 requirements 文件（相对工作区根；多文件时
    /// requirements.txt 优先，否则字母序首个——声明集解析时全部纳入）
    pub requirements_file: Option<String>,
}

/// E1 条目：代码 ⊄ 环境（缺失模块的一个 import 位点，按 module+file 聚合）
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MissingModule {
    pub module: String,
    /// 发行版名（packages_distributions 反查 → 别名表兜底 → null）
    pub dist: Option<String>,
    /// 全部候选发行版名（M4-4 dist 歧义：同 module 多 dist 时安装动作弹候选选择；
    /// len ≤ 1 时与 dist 字段等价或为空。字段只增不删，§3.3 契约演进）
    #[serde(default)]
    pub dist_candidates: Vec<String>,
    /// 相对工作区根、正斜杠
    pub file: String,
    pub line: u32,
    /// 全部位点都位于函数/方法体内（惰性导入）——仅提示不阻塞运行预检（M4 精度项）
    pub lazy: bool,
}

/// E2 条目：声明 ⊄ 环境
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredMissing {
    /// PEP 503 归一化名
    pub dist: String,
    /// 原始版本约束串（如 ">=1.0,<2"；含 extras/marker remainder），修复时原样交给 uv
    pub spec: String,
}

/// v1.7 A：已声明未安装的**代码引用**（E1 分流产物）——模块写入声明全集（extras/groups）
/// 但环境未装且代码 import 了它。按 module 聚合（跨文件一处汇总，fika-admin pytest ×5
/// 的降噪形态）；与 declaredMissing（core 同步范围逐条）分节呈现。
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredMissingModule {
    /// 顶层模块名（Python import 名，原样）
    pub module: String,
    /// 命中的声明 dist（归一化名；模块名→dist 经反查/别名/同名匹配链）
    pub dist: String,
    /// 所属声明组（"dev" / extras 名 / dependency-group 名；requirements 项目 = "requirements"）
    pub group: String,
    /// 受影响文件数（聚合呈现：模块跨 N 个文件）
    pub files: u32,
    /// 首个位点（跳转锚点）
    pub file: String,
    pub line: u32,
    /// 全部位点皆惰性导入（与 E1 的 lazy 语义一致，仅提示）
    pub lazy: bool,
}

/// E3 条目：环境 ⊄ 声明（裸装漂移）
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvDriftPkg {
    pub dist: String,
    pub version: String,
}

/// E4 条目：代码 ⊄ 声明（pyproject 项目专用）
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndeclaredModule {
    pub module: String,
    pub dist: Option<String>,
    /// 同 module 多 dist 候选（M4-4；字段只增不删，§3.3）
    #[serde(default)]
    pub dist_candidates: Vec<String>,
    pub file: String,
    pub line: u32,
}

/// DepDiff v1 契约（§3.3）：字段只增不删，消费方须容忍未知字段。camelCase 序列化。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DepDiff {
    pub style: String,
    pub external_manager: Option<String>,
    /// E1 代码 ⊄ 环境（interpreter=null 时置空，§3.3 字段语义）
    pub missing_in_env: Vec<MissingModule>,
    /// E2 声明 ⊄ 环境（external 禁用；interpreter=null 或快照失败时置空）
    pub declared_missing: Vec<DeclaredMissing>,
    /// v1.7 A：已声明未安装的代码引用（E1 分流；external 禁用。字段只增不删，§3.3）
    #[serde(default)]
    pub declared_missing_modules: Vec<DeclaredMissingModule>,
    /// E3 环境 ⊄ 声明（external 禁用；解释器 null 时置空）
    pub env_drift: Vec<EnvDriftPkg>,
    /// E4 代码 ⊄ 声明（仅 style=pyproject 计算）
    pub undeclared: Vec<UndeclaredModule>,
    /// E5 pyproject ↔ uv.lock 不一致（仅文件比对 + uv lock --check，不依赖解释器——
    /// interpreter=null 的 uv run 兜底路径照常计算，v1.2 修订）
    pub lock_out_of_date: bool,
    /// style=requirements 且整个 requirements 文件未安装（E2 特例，横幅优先级 3 直接消费）
    pub requirements_uninstalled: bool,
    /// null = uv run 兜底（E1/E2/E3 环境侧置空；E4/E5 照常）
    pub interpreter: Option<String>,
    pub requirements_file: Option<String>,
    /// epoch millis
    pub scanned_at: u64,
}

/// 探针输出：import 位点 + 模块解析分类
#[derive(Deserialize, Clone, Debug, Default)]
pub struct ProbeOutput {
    #[serde(default)]
    pub imports: Vec<ProbeImport>,
    #[serde(default)]
    pub resolution: HashMap<String, ProbeResolution>,
}

/// 单个 import 位点（file 为相对工作区根、正斜杠）
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct ProbeImport {
    pub file: String,
    pub module: String,
    pub line: u32,
    #[serde(default)]
    pub lazy: bool,
}

/// 模块解析分类：stdlib / local（工作区内一方代码）/ site（三方已装）/ missing
#[derive(Deserialize, Clone, Debug)]
pub struct ProbeResolution {
    pub status: String,
    /// 候选发行版名（M4-4 dist 歧义：packages_distributions 反查保留全部候选，不再只取 v[0]；
    /// 旧字段名 dist 保留——serde 兼容测试构造，值 = 首候选（无则 null））
    #[serde(default)]
    pub dist: Option<String>,
    /// 全部候选（去重保序）；len ≤ 1 时与 dist 一致或为空
    #[serde(default)]
    pub dist_candidates: Vec<String>,
}

impl ProbeResolution {
    /// 首候选便捷取用（与旧单 dist 字段同义）；dep_fix 测试区同用，故 pub(crate)
    #[cfg(test)]
    pub(crate) fn first_dist(&self) -> Option<&str> {
        self.dist_candidates.first().map(String::as_str).or(self.dist.as_deref())
    }

    /// 全部候选（兼容无 dist_candidates 的旧构造：单 dist 视为唯一候选）
    pub(crate) fn all_candidates(&self) -> Vec<String> {
        if !self.dist_candidates.is_empty() {
            self.dist_candidates.clone()
        } else {
            self.dist.clone().into_iter().collect()
        }
    }
}

/// 代码层探针（§4.1，内联形态沿用 MISSING_IMPORT_SCRIPT 先例）：
/// - 输入：payload 临时文件路径（argv[1]，JSON：workspace_root / files 待解析 / modules 待解析集）；
/// - AST 收集**全部** import——含函数体内（标 lazy），相对导入（level>0）视为一方代码跳过。
///   行为变更（§4.1）：旧 MISSING_IMPORT_SCRIPT 对函数体整棵 continue，此处进入函数体收集；
/// - 解析落点分类：stdlib_module_names → find_spec → origin/搜索路径是否在工作区根下
///   （local）或文件系统他处（site）；find_spec 失败 = missing；
/// - dist 反查：packages_distributions() 一次建全表（<3.10 缺失时 try 降级为空表，风险 #2）；
/// - 输出单行 JSON（ensure_ascii 缺省 True：Windows 管道 locale 编码下中文路径不炸）。
pub(crate) const DEP_PROBE_SCRIPT: &str = r#"import ast, importlib.metadata, importlib.util, json, os, sys

# 版本下限显式降级（v1.3 修订 ⑬）：stdlib_module_names / packages_distributions 均为 3.10+。
# 缺失时 site/stdlib 分类不可信——会把 os/sys 也判成 site（E4 误报标准库为未声明依赖），
# 错误结果比降级更糟。显式退出 → Rust 侧降级为空代码层 + warn 日志（风险 #2），
# 与既有 check_missing_imports 对 <3.10 的隐性下限口径一致。
if sys.version_info < (3, 10):
    raise SystemExit("dep probe requires Python >= 3.10, got " + sys.version.split()[0])

_MAX_BYTES = 2000000
_STDLIB = sys.stdlib_module_names

def _collect(path):
    """单文件 AST → [(顶层模块, 行号, lazy)]；解析失败/超大文件返回空（不中断全量扫描）。"""
    out = []
    try:
        if os.path.getsize(path) > _MAX_BYTES:
            return out
        with open(path, encoding="utf-8", errors="replace") as f:
            tree = ast.parse(f.read(), filename=path)
        def walk(node, lazy):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.Import):
                    for a in child.names:
                        out.append((a.name.split(".")[0], child.lineno, lazy))
                elif isinstance(child, ast.ImportFrom):
                    if child.level == 0 and child.module:
                        out.append((child.module.split(".")[0], child.lineno, lazy))
                elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                    walk(child, True)
                else:
                    walk(child, lazy)
        walk(tree, False)
    except (OSError, SyntaxError, ValueError, RecursionError):
        return []
    return out

def _is_local_path(ap, root_norm):
    """一方代码判定：解析落点在工作区根下 **且不在虚拟环境/site-packages 内**。
    修复 #2：venv 建在工作区内时（.venv 惯例位置），site-packages 的 origin 以根为
    前缀，旧判定会把三方包误吞成 local（E1 漏报）。排除组件 = .venv* / venv /
    site-packages / dist-packages（不用裸 env——会误伤名为 env 的本地目录）。"""
    if ap != root_norm and not ap.startswith(root_norm + os.sep):
        return False
    parts = ap[len(root_norm):].split(os.sep) if ap != root_norm else []
    for p in parts:
        if p.startswith(".venv") or p == "venv" or p == "site-packages" or p == "dist-packages":
            return False
    return True

def _classify(module, root_norm, dist_map, search_dirs=None):
    """解析落点：stdlib / local（工作区内一方）/ site（三方）/ missing。
    - search_dirs（用户实测 bug 修复）：该模块**全部 import 位点所属文件的所在目录**。
      脚本式布局（cbond/cb_daily.py `from field_map import ...`）的运行语义是
      「脚本目录进 sys.path[0]」，只插工作区根会把同目录模块误判 missing（E1 误报）。
      多目录逐一尝试，优先级 local > site > missing（任一目录能解析为一方代码即 local
      ——同名模块跨目录只有一边存在的漏报是已知边界，严格优于只按根解析的旧行为）。
    - M4-4 dist 歧义：dist_map 值为完整候选列表（不再只取 v[0]），一并输出。"""
    if module in _STDLIB:
        return {"status": "stdlib", "dist": None, "distCandidates": []}
    best = None  # None < "missing" < "site" < "local"
    rank = {"missing": 1, "site": 2, "local": 3}
    dirs = list(search_dirs or []) + [None]  # None = 仅现有 sys.path（含根）
    for search_dir in dirs:
        inserted = False
        if search_dir is not None and search_dir not in sys.path:
            sys.path.insert(0, search_dir)
            inserted = True
        try:
            try:
                spec = importlib.util.find_spec(module)
            except (ImportError, ValueError):
                spec = None
        finally:
            if inserted:
                try:
                    sys.path.remove(search_dir)
                except ValueError:
                    pass
        if spec is None:
            status = "missing"
        else:
            paths = []
            origin = spec.origin or ""
            if origin not in ("", "built-in", "frozen", "namespace"):
                paths.append(origin)
            try:
                paths.extend(spec.submodule_search_locations or [])
            except TypeError:
                pass
            status = "site"
            for p in paths:
                ap = os.path.normcase(os.path.abspath(p))
                if _is_local_path(ap, root_norm):
                    status = "local"
                    break
            if not paths:
                status = "stdlib"
        if best is None or rank[status] > rank[best]:
            best = status
        if best == "local":
            break  # 已是最优，无需再试
    cands = dist_map.get(module) or []
    if best == "stdlib":
        return {"status": "stdlib", "dist": None, "distCandidates": []}
    if best == "local":
        return {"status": "local", "dist": None, "distCandidates": []}
    if best == "site":
        return {"status": "site", "dist": cands[0] if cands else None, "distCandidates": cands}
    return {"status": "missing", "dist": cands[0] if cands else None, "distCandidates": cands}

def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        payload = json.load(f)
    root = payload["workspace_root"]
    root_norm = os.path.normcase(os.path.abspath(root))
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        # M4-4：值保留完整候选列表（同 module 多 dist），首候选即旧行为 v[0]
        dist_map = {k: sorted(set(v)) for k, v in importlib.metadata.packages_distributions().items() if v}
    except Exception:
        dist_map = {}
    imports = []
    # 模块 → 全部位点所属文件的所在目录集合（脚本语义的解析目录，去重保序）
    known_dirs = {}
    for rel in payload.get("files", []):
        file_dir = os.path.dirname(os.path.join(root, rel))
        for mod, line, lazy in _collect(os.path.join(root, rel)):
            imports.append({"file": rel, "module": mod, "line": line, "lazy": lazy})
            known_dirs.setdefault(mod, [])
            if file_dir not in known_dirs[mod]:
                known_dirs[mod].append(file_dir)
    # payload.modules（Rust 侧传入的待重解析模块，缓存 miss 的）：优先用 payload.module_dirs
    #（Rust 从 AST 缓存导出的 模块 → 位点目录 集合，脚本语义同上）；无映射的按现有
    # sys.path（含根）解析——files 路径的目录结果不劣于它。
    extra_dirs = payload.get("module_dirs") or {}
    for m in payload.get("modules", []):
        dirs = extra_dirs.get(m) or []
        known_dirs.setdefault(m, [d for d in dirs])
    resolution = {m: _classify(m, root_norm, dist_map, known_dirs[m]) for m in sorted(known_dirs)}
    sys.stdout.write(json.dumps({"imports": imports, "resolution": resolution}))

main()
"#;

// ---------- dep：L0 style 判定 ----------

/// style 判定（纯 fs 存在性，判定序见文件头 v1.3 修订说明）
pub(crate) fn detect_style(root: &Path) -> DepStyle {
    // ① external 锁文件优先（谁拥有声明层的强信号）
    for (file, mgr) in EXTERNAL_LOCKS {
        if root.join(file).is_file() {
            return DepStyle {
                style: "external".into(),
                external_manager: Some(mgr.to_string()),
                requirements_file: None,
            };
        }
    }
    // ② pyproject（读 [project] dependencies / [tool.uv]；uv workspace 成员不解析，M4 评估）
    if root.join("pyproject.toml").is_file() {
        return DepStyle { style: "pyproject".into(), external_manager: None, requirements_file: None };
    }
    // ③ requirements*.txt（多文件全部纳入声明集，见 parse_requirements_declared）
    if let Some(primary) = primary_requirements_file(root) {
        return DepStyle {
            style: "requirements".into(),
            external_manager: None,
            requirements_file: Some(primary),
        };
    }
    // ④ bare（现有 has_pyproject 横幅即此逻辑的 UI 投影）
    DepStyle { style: "bare".into(), external_manager: None, requirements_file: None }
}

/// L0 同步 style 判定命令（零子进程，§4.7 打开工作区 t0 时刻调用，bare/external 横幅
/// 不依赖后续 L1/L2）。工作区不存在时返回 bare（纯存在性检查的自然结果，调用方保证 root 有效）。
#[tauri::command]
pub fn dep_style(workspace_root: String) -> DepStyle {
    detect_style(Path::new(&workspace_root))
}

/// 根目录 requirements*.txt 文件名列表（字母序，确定性）
fn list_requirements_files(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.starts_with("requirements") && n.ends_with(".txt"))
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// 主 requirements 文件：requirements.txt 优先，否则字母序首个
fn primary_requirements_file(root: &Path) -> Option<String> {
    let names = list_requirements_files(root);
    if names.iter().any(|n| n == "requirements.txt") {
        Some("requirements.txt".to_string())
    } else {
        names.into_iter().next()
    }
}

// ---------- dep：声明层解析（行扫描，无 toml crate，与 dap.rs / pyproject_scripts_entries 同口径） ----------

/// 单条声明依赖（dist 为 PEP 503 归一化名；spec 为原始约束串，修复时原样交给 uv）
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DeclaredDep {
    pub(crate) dist: String,
    pub(crate) spec: String,
}

/// 声明层解析结果，三个口径：
/// - `core`：同步范围（uv sync / pip install -r 默认会装的）= [project].dependencies
///   + [tool.uv].dev-dependencies + [dependency-groups].dev；requirements 项目 = 全部行。
///   **E2 只查 core**——extras/非 dev groups 是 opt-in 安装，缺了不该报「声明未安装」；
/// - `all`：全部声明归一化名（含 optional-dependencies 与所有 groups）——E3/E4 的排除集
///   （装了 extras 里的包是合法声明，不算漂移/未声明）；
/// - `group_of`：归一化 dist → 所属组名（v1.7 A：E1 分流到 E2 小节时的「已声明未装」
///   归组信息，如 "dev"；core 依赖映射为 null——它们缺装时走 declaredMissing 常规路径）。
#[derive(Default, Clone, Debug)]
pub(crate) struct DeclaredDeps {
    pub(crate) core: Vec<DeclaredDep>,
    pub(crate) all: HashSet<String>,
    pub(crate) group_of: HashMap<String, String>,
}

/// PEP 503 包名归一化：`re.sub(r"[-_.]+", "-", name).lower()` 等价实现
/// （zope.interface / Zope-Interface / zope_interface → zope-interface）。
pub(crate) fn normalize_dist(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending_sep = false;
    for c in name.chars() {
        if c == '-' || c == '_' || c == '.' {
            if !out.is_empty() {
                pending_sep = true;
            }
        } else {
            if pending_sep {
                out.push('-');
                pending_sep = false;
            }
            out.extend(c.to_lowercase());
        }
    }
    out
}

/// PEP 508 需求串 → (包名, 约束 remainder)。名为前导字母数字/._- run；
/// 裸 URL 行（scheme:// 前缀，requirements 允许的 direct wheel URL）无包名可取 → None；
/// `foo @ https://…`（direct reference）→ ("foo", "@ https://…") 保留声明语义。
fn split_requirement(s: &str) -> Option<(String, String)> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(i) = t.find("://") {
        let scheme = &t[..i];
        // scheme 无空白且为合法 scheme 字符集 → 整行是裸 URL
        if !scheme.is_empty()
            && !scheme.contains(' ')
            && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
        {
            return None;
        }
    }
    let end = t
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_'))
        .unwrap_or(t.len());
    let name = &t[..end];
    if name.is_empty() {
        return None;
    }
    Some((name.to_string(), t[end..].trim().to_string()))
}

/// requirements 单行 → (包名, 约束串)。跳过：空行 / 注释 / 选项行（-r、--index-url、-e…）/
/// 裸 URL。行内注释按 pip 口径须空白 + #。行延续反斜杠（`foo \`）不支持——罕见形态，M1 边界。
fn parse_requirements_line(line: &str) -> Option<(String, String)> {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') || t.starts_with('-') {
        return None;
    }
    let t = match t.find(" #").or_else(|| t.find("\t#")) {
        Some(i) => t[..i].trim(),
        None => t,
    };
    split_requirement(t)
}

/// 解析根目录全部 requirements*.txt（§4.2：多文件时全部纳入声明集）→ 声明层。
/// requirements 项目无 core/all 之分（无 extras 概念），全部行进 core。
pub(crate) fn parse_requirements_declared(root: &Path) -> DeclaredDeps {
    let mut d = DeclaredDeps::default();
    for name in list_requirements_files(root) {
        let Ok(text) = fs::read_to_string(root.join(&name)) else { continue };
        for line in text.lines() {
            let Some((raw, spec)) = parse_requirements_line(line) else { continue };
            let dist = normalize_dist(&raw);
            d.all.insert(dist.clone());
            d.core.push(DeclaredDep { dist, spec });
        }
    }
    d
}

/// TOML 数组文本是否已闭合（引号/转义感知，防字符串里的 [ ] 误计数）
fn array_closed(s: &str) -> bool {
    let mut depth = 0i32;
    let mut in_str: Option<char> = None;
    let mut esc = false;
    for c in s.chars() {
        if let Some(q) = in_str {
            if esc {
                esc = false;
            } else if c == '\\' && q == '"' {
                esc = true;
            } else if c == q {
                in_str = None;
            }
            continue;
        }
        match c {
            '"' | '\'' => in_str = Some(c),
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth <= 0 {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

/// 从数组文本提取顶层引号字符串。跳过 {} 内嵌串（dependency-groups 的
/// `{include-group = "x"}` 的 "x" 不是包名）与更深层 [] 嵌套。
/// TOML literal 串（'…'）无转义语义，反斜杠按字面保留。
fn extract_quoted_strings(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32; // [] 深度
    let mut braces = 0i32; // {} 深度
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            '[' => depth += 1,
            ']' => depth -= 1,
            '{' => braces += 1,
            '}' => braces -= 1,
            '"' | '\'' => {
                let quote = c;
                let mut item = String::new();
                let mut esc = false;
                let mut closed = false;
                for c2 in chars.by_ref() {
                    if esc {
                        item.push(c2);
                        esc = false;
                        continue;
                    }
                    if c2 == '\\' && quote == '"' {
                        esc = true;
                        continue;
                    }
                    if c2 == quote {
                        closed = true;
                        break;
                    }
                    item.push(c2);
                }
                if closed && depth == 1 && braces == 0 {
                    out.push(item);
                }
            }
            _ => {}
        }
    }
    out
}

/// pyproject.toml 行扫描：收集各 section 下 `key = [ … ]` 数组的字符串项
/// → (section, key, items)。数组可跨行（PEP 621 多行 dependencies 是常态），闭合即停。
fn pyproject_dep_strings(text: &str) -> Vec<(String, String, Vec<String>)> {
    let mut out = Vec::new();
    let mut section = String::new();
    let mut lines = text.lines();
    while let Some(raw) = lines.next() {
        let t = raw.trim();
        if t.starts_with('#') {
            continue;
        }
        if t.starts_with('[') && t.ends_with(']') {
            section = t[1..t.len() - 1].trim().to_string();
            continue;
        }
        let Some(eq) = t.find('=') else { continue };
        let key = t[..eq].trim().trim_matches(|c| c == '"' || c == '\'').to_string();
        let val = t[eq + 1..].trim();
        if !val.starts_with('[') {
            continue;
        }
        let mut buf = val.to_string();
        while !array_closed(&buf) {
            match lines.next() {
                Some(n) => {
                    buf.push(' ');
                    buf.push_str(n.trim());
                }
                None => break,
            }
        }
        let items = extract_quoted_strings(&buf);
        if !items.is_empty() {
            out.push((section.clone(), key, items));
        }
    }
    out
}

/// pyproject 声明层解析 → (声明集, [project] name)。
/// name 供 E4/E3 排除项目自身（uv sync 会把项目本体 editable 装进 venv，不排除则
/// 项目自己的包名恒被报漂移/未声明）。
/// 已知边界：`dynamic = ["dependencies"]`（setuptools 动态声明）不解析——声明集偏空
/// 会导致 E3 过报，M1 接受（此类项目占比小，且横幅文案可解释）。
pub(crate) fn parse_pyproject_deps(text: &str) -> (DeclaredDeps, Option<String>) {
    let mut deps = DeclaredDeps::default();
    for (section, key, items) in pyproject_dep_strings(text) {
        // 同步范围（E2）：uv sync 默认安装 = 主依赖 + 两套 dev 声明
        let core = matches!(
            (section.as_str(), key.as_str()),
            ("project", "dependencies")
                | ("tool.uv", "dev-dependencies")
                | ("dependency-groups", "dev")
        );
        // 全集（E3/E4 排除）：core + 全部 extras + 全部 dependency-groups
        let declared = core
            || section == "project.optional-dependencies"
            || section == "dependency-groups";
        if !declared {
            continue;
        }
        // v1.7 A：组归属（E1 分流呈现用）——extras 键名 / dependency-groups 组名；
        // core 依赖不进映射（缺装走 declaredMissing 常规 E2 路径）。段名为 TOML 全限定
        // （"project.optional-dependencies" 不是 "project"——fika-admin 实测踩坑修正）
        let group: Option<String> = match section.as_str() {
            "project.optional-dependencies" => Some(key.clone()),
            "dependency-groups" if key != "dev" => Some(key.clone()),
            _ => None,
        };
        for req in items {
            let Some((name, spec)) = split_requirement(&req) else { continue };
            let dist = normalize_dist(&name);
            deps.all.insert(dist.clone());
            if let Some(g) = &group {
                deps.group_of.entry(dist.clone()).or_insert_with(|| g.clone());
            }
            if core {
                deps.core.push(DeclaredDep { dist, spec });
            }
        }
    }
    (deps, pyproject_project_name(text))
}

/// uv.lock 的 `[[package]]` name 名单（fika-admin 实测 bug 修复）：lock 锁定闭包含全部
/// 传递依赖——`uv sync` 装的环境里 pydantic-core/starlette/typing-extensions 等按 lock
/// 合法存在，E3 若只按 pyproject 排除会报几十项「漂移」噪声（实测 63 项全是 lock 内包）。
/// 行扫描 `name = "xxx"` 且须位于 [[package]] 段内（排除 [manifest] 等）；解析失败 →
/// 空（E3 退回旧行为，过报可解释——比错报漏报方向安全）。
pub(crate) fn parse_uv_lock_names(root: &Path) -> HashSet<String> {
    let Ok(text) = fs::read_to_string(root.join("uv.lock")) else {
        return HashSet::new();
    };
    let mut out = HashSet::new();
    let mut in_package = false;
    for raw in text.lines() {
        let t = raw.trim();
        if t == "[[package]]" {
            in_package = true;
            continue;
        }
        if t.starts_with('[') {
            in_package = false; // 进入其他段（[manifest]/[package.dev-dependencies] 等）
            continue;
        }
        if !in_package {
            continue;
        }
        if let Some(rest) = t.strip_prefix("name = ") {
            let name = rest.trim().trim_matches('"');
            if !name.is_empty() {
                out.insert(normalize_dist(name));
            }
        }
    }
    out
}

/// [project] 段的 name 键（行扫描首个命中）
fn pyproject_project_name(text: &str) -> Option<String> {
    let mut in_project = false;
    for raw in text.lines() {
        let t = raw.trim();
        if t.starts_with('[') && t.ends_with(']') {
            in_project = t == "[project]";
            continue;
        }
        if !in_project {
            continue;
        }
        let Some(eq) = t.find('=') else { continue };
        if t[..eq].trim() == "name" {
            let v = t[eq + 1..].trim().trim_matches(|c| c == '"' || c == '\'').to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

// ---------- dep：环境层快照 ----------

/// freeze 输出的 dep 域宽容解析：`name==version` / `name @ url`（direct/editable，版本置空）
/// / `-e`、`#` 行跳过。与 parse_pip_list（环境面板展示口径）分开维护——那边把整行当名字，
/// 这边要把 direct URL 归一出包名（uv sync 的项目本体 editable 装就是 `name @ file+…` 形态）。
fn parse_freeze_for_diff(s: &str) -> Vec<(String, String)> {
    s.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.is_empty() || l.starts_with('-') || l.starts_with('#') {
                return None;
            }
            if let Some((n, v)) = l.split_once("==") {
                return Some((n.trim().to_string(), v.trim().to_string()));
            }
            if let Some((n, _)) = l.split_once('@') {
                let n = n.trim();
                if !n.is_empty() {
                    return Some((n.to_string(), String::new()));
                }
            }
            // 无版本裸名行：仅当像包名（无空格）才保留——含空格的是诊断/杂质行（如 uv 的
            // 「Using Python … environment at: …」），跳过防误当包（纵深防御，与 parse_pip_list 同口径）
            if l.contains(' ') {
                return None;
            }
            Some((l.to_string(), String::new()))
        })
        .collect()
}

/// dep 域环境快照：uv pip list --format=freeze（UV_LIST_TIMEOUT 而非 UV_TIMEOUT——
/// 体检是后台顾问，不该被 120s 级的宽松超时拖住）。
pub(crate) fn scan_list_packages(interpreter: &str) -> Result<Vec<(String, String)>, String> {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["pip", "list", "--python", interpreter, "--format=freeze"]);
    let (out, err, code) = run_with_timeout(&mut cmd, UV_LIST_TIMEOUT)?;
    if code != Some(0) {
        let raw = if out.is_empty() { err } else { out };
        return Err(if raw.trim().is_empty() {
            format!("uv pip list 失败（exit {code:?}）")
        } else {
            raw.trim().to_string()
        });
    }
    // 成功只解析 stdout（同 list_packages_impl）：stderr 的「Using Python … environment at: …」提示
    // 不得回退当包列表——空环境（virtualenv 建的 .venv）stdout 为空，回退会把提示误解析成「包」（wangzi 实测）
    Ok(parse_freeze_for_diff(&out))
}

// ---------- dep：E5 lock 一致性 ----------

/// E5：`uv lock --check`（uv ≥ 0.4.x 支持；0.10.11 实测——过期 exit=1 且输出含
/// "needs to be updated"，最新 exit=0）。仅认 uv 的明确过期文案为 true；其余非零
/// （网络/索引/uv 版本问题）降级为不检测（§10 风险 1：失败不阻断）。
pub(crate) fn check_lock_out_of_date(root: &Path) -> bool {
    let mut cmd = tool_command("uv", ENV_UV);
    cmd.args(["lock", "--check"]).current_dir(root);
    let Ok((out, err, code)) = run_with_timeout(&mut cmd, UV_OUTDATED_TIMEOUT) else {
        return false;
    };
    if code == Some(0) {
        return false;
    }
    format!("{out}{err}").contains("needs to be updated")
}


// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use crate::env_cmds::parse_pip_list;

    /// wangzi 回归：uv pip list 对空环境（virtualenv 建的 .venv 无包）stdout 为空、stderr 输出
    /// 「Using Python … environment at: …」。修复前成功路径回退用 stderr，该提示被误解析成一个
    /// 「包」→ E3 误报「1 个包已安装但未声明」、已安装列表显示一个非 python 包。两个解析器都须跳过它。
    #[test]
    fn freeze_parsers_skip_uv_diagnostic_line() {
        let diag = "Using Python 3.14.3 environment at: D:\\ws\\.venv";
        assert!(parse_pip_list(diag).is_empty(), "诊断行不得被 parse_pip_list 当包");
        assert!(parse_freeze_for_diff(diag).is_empty(), "诊断行不得被 parse_freeze_for_diff 当包");
        // 正常 freeze 行仍解析；裸名（无空格）保留
        assert_eq!(parse_pip_list("requests==2.31.0").len(), 1);
        assert_eq!(parse_freeze_for_diff("requests==2.31.0"), vec![("requests".to_string(), "2.31.0".to_string())]);
        assert_eq!(parse_freeze_for_diff("somepkg").len(), 1);
        // direct URL（name @ file://…）归一出包名
        assert_eq!(parse_freeze_for_diff("demo @ file:///ws/demo"), vec![("demo".to_string(), String::new())]);
    }

    // ---------- 依赖健康（dep health M1）单测 ----------

    fn dep_tmpdir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let d = std::env::temp_dir().join(format!("montauri-dep-{tag}-{nanos}"));
        fs::create_dir_all(&d).unwrap();
        d
    }

    // ----- L0 style 判定（v1.3 判定序：external → pyproject → requirements → bare） -----

    #[test]
    fn style_bare_when_nothing_declared() {
        let d = dep_tmpdir("style-bare");
        fs::write(d.join("main.py"), "print(1)").unwrap();
        let s = detect_style(&d);
        assert_eq!(s.style, "bare");
        assert_eq!(s.external_manager, None);
        assert_eq!(s.requirements_file, None);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn style_pyproject() {
        let d = dep_tmpdir("style-pyproj");
        fs::write(d.join("pyproject.toml"), "[project]\nname=\"x\"\n").unwrap();
        // pyproject 与 requirements 并存 → pyproject 优先（判定序）
        fs::write(d.join("requirements.txt"), "requests\n").unwrap();
        let s = detect_style(&d);
        assert_eq!(s.style, "pyproject");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn style_requirements_primary_prefers_canonical() {
        let d = dep_tmpdir("style-req");
        fs::write(d.join("requirements-dev.txt"), "pytest\n").unwrap();
        fs::write(d.join("requirements.txt"), "requests\n").unwrap();
        let s = detect_style(&d);
        assert_eq!(s.style, "requirements");
        // 多文件时主文件 = requirements.txt（声明集解析仍全部纳入）
        assert_eq!(s.requirements_file.as_deref(), Some("requirements.txt"));
        fs::remove_dir_all(&d).unwrap();

        let d2 = dep_tmpdir("style-req2");
        fs::write(d2.join("requirements-dev.txt"), "pytest\n").unwrap();
        let s2 = detect_style(&d2);
        assert_eq!(s2.requirements_file.as_deref(), Some("requirements-dev.txt"));
        fs::remove_dir_all(&d2).unwrap();
    }

    /// v1.3 判定序核心用例：poetry/pdm 项目必有 pyproject.toml，锁文件强信号优先——
    /// 否则 [project] dependencies 解析为空 → 全部已装包被误报 E3 漂移（§9.1 验收场景）。
    #[test]
    fn style_external_lock_wins_over_pyproject_and_requirements() {
        let d = dep_tmpdir("style-ext");
        fs::write(d.join("pyproject.toml"), "[tool.poetry]\nname=\"x\"\n").unwrap();
        fs::write(d.join("poetry.lock"), "# lock").unwrap();
        fs::write(d.join("requirements.txt"), "requests\n").unwrap();
        let s = detect_style(&d);
        assert_eq!(s.style, "external");
        assert_eq!(s.external_manager.as_deref(), Some("poetry"));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn style_external_all_managers() {
        for (file, mgr) in EXTERNAL_LOCKS {
            let d = dep_tmpdir("style-ext-each");
            fs::write(d.join(file), "x").unwrap();
            let s = detect_style(&d);
            assert_eq!(s.style, "external", "{file} 应判 external");
            assert_eq!(s.external_manager.as_deref(), Some(mgr));
            fs::remove_dir_all(&d).unwrap();
        }
    }

    // ----- 包名归一化 / 需求串拆分 -----

    #[test]
    fn normalize_dist_is_pep503() {
        assert_eq!(normalize_dist("Zope.Interface"), "zope-interface");
        assert_eq!(normalize_dist("zope_interface"), "zope-interface");
        assert_eq!(normalize_dist("Zope-Interface"), "zope-interface");
        assert_eq!(normalize_dist("PyYAML"), "pyyaml");
        assert_eq!(normalize_dist("ruamel.yaml.clib"), "ruamel-yaml-clib");
        assert_eq!(normalize_dist("a__b..c--d"), "a-b-c-d");
    }

    #[test]
    fn split_requirement_forms() {
        assert_eq!(split_requirement("requests"), Some(("requests".into(), "".into())));
        assert_eq!(split_requirement("requests>=2.0,<3"), Some(("requests".into(), ">=2.0,<3".into())));
        assert_eq!(
            split_requirement("requests[socks]>=2 ; python_version>='3.8'"),
            Some(("requests".into(), "[socks]>=2 ; python_version>='3.8'".into()))
        );
        // direct reference：包名可取，@ url 保留在 spec
        assert_eq!(split_requirement("foo @ https://x/foo.whl"), Some(("foo".into(), "@ https://x/foo.whl".into())));
        // 裸 URL 行：无包名可取
        assert_eq!(split_requirement("https://x/foo.whl"), None);
        assert_eq!(split_requirement(""), None);
    }

    #[test]
    fn parse_requirements_line_skips_noise() {
        assert_eq!(parse_requirements_line("# comment"), None);
        assert_eq!(parse_requirements_line("  "), None);
        assert_eq!(parse_requirements_line("-r other.txt"), None);
        assert_eq!(parse_requirements_line("--index-url https://x"), None);
        assert_eq!(parse_requirements_line("-e ."), None);
        // 行内注释（pip 口径：空白 + #）
        assert_eq!(parse_requirements_line("requests>=2  # http lib"), Some(("requests".into(), ">=2".into())));
        assert_eq!(parse_requirements_line("flask"), Some(("flask".into(), "".into())));
    }

    // ----- pyproject 声明层解析 -----

    #[test]
    fn pyproject_deps_sections_and_buckets() {
        let text = r#"
[project]
name = "demo"
dependencies = [
    "requests>=2.0",
    "flask",
]

[project.optional-dependencies]
web = ["fastapi>=0.100"]

[dependency-groups]
dev = ["pytest>=8"]
docs = [{include-group = "dev"}, "sphinx"]

[tool.uv]
dev-dependencies = ["ruff>=0.5"]
"#;
        let (deps, name) = parse_pyproject_deps(text);
        assert_eq!(name.as_deref(), Some("demo"));
        // core（E2 同步范围）：主依赖 + dev group + tool.uv dev-deps；extras/docs 组不进 core
        let core: Vec<&str> = deps.core.iter().map(|d| d.dist.as_str()).collect();
        assert!(core.contains(&"requests"));
        assert!(core.contains(&"flask"));
        assert!(core.contains(&"pytest"));
        assert!(core.contains(&"ruff"));
        assert!(!core.contains(&"fastapi"), "extras 是 opt-in，缺了不该报 E2");
        assert!(!core.contains(&"sphinx"));
        // all（E3/E4 排除全集）：extras 与非 dev groups 也算已声明
        assert!(deps.all.contains("fastapi"));
        assert!(deps.all.contains("sphinx"));
        // {include-group = "dev"} 的 "dev" 不得被当包名
        assert!(!deps.all.contains("include-group"));
        // spec 保留原始约束（修复时原样交给 uv）
        let req = deps.core.iter().find(|d| d.dist == "requests").unwrap();
        assert_eq!(req.spec, ">=2.0");
    }

    #[test]
    fn pyproject_deps_single_line_array() {
        let text = "[project]\nname=\"x\"\ndependencies = [\"a>=1\", 'b']\n";
        let (deps, _) = parse_pyproject_deps(text);
        assert!(deps.all.contains("a") && deps.all.contains("b"));
        assert_eq!(deps.core.len(), 2);
    }

    #[test]
    fn pyproject_project_name_only_from_project_section() {
        let text = "[tool.poetry]\nname = \"wrong\"\n\n[project]\nname = \"right\"\n";
        assert_eq!(pyproject_project_name(text).as_deref(), Some("right"));
        assert_eq!(pyproject_project_name("[tool.x]\nname=\"y\"\n"), None);
    }

    // ----- 环境快照解析 -----

    #[test]
    fn parse_freeze_for_diff_forms() {
        let s = "requests==2.31.0\ndemo @ file+file:///F:/ws\n# comment\n-e file:///x\nbare-no-version\n";
        let v = parse_freeze_for_diff(s);
        assert_eq!(v[0], ("requests".to_string(), "2.31.0".to_string()));
        // direct/editable 装：归一出包名、版本置空（项目自身排除靠名字匹配）
        assert_eq!(v[1], ("demo".to_string(), String::new()));
        assert_eq!(v.len(), 3); // -e 与注释行跳过；bare-no-version 保留（名有值空）
        assert_eq!(v[2].0, "bare-no-version");
    }

}
