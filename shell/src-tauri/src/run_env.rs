// 运行环境装配（S3/S4 公共基建，偿还 tech-debt 第 8 条）：
// 把「一次 Python 运行需要注入什么」收敛成**单一来源**——`lsp::run_script`（std::process::Command）
// 与 `terminal::run_in_terminal`（portable-pty CommandBuilder）共用同一份装配结果，
// 杜绝两条路径的语义漂移（PYTHONPATH 四段约定：用户配置 → 继承 → 工作区根 → probe src）。
//
// 设计要点：
// - 返回 **envelope**（env 列表 + args + 告警），刻意不绑定 Command / CommandBuilder 类型，
//   两条路径各自套用（`cmd.env(k,v)` / `cb.env(k,v)`）；**顺序即优先级**（后写覆盖先写）。
// - 装配主体 [`assemble`] 是**纯函数**（不需要 AppHandle），顺序/合并规则可被单测直接锁定；
//   只有「probe/src 在哪」需要探测，由薄封装 [`build_run_env`] 负责。

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::env_cmds::RunConfig;
use crate::tool_paths::{tool_command, ENV_UV};
use crate::util::resource_candidates;

/// 一次运行的环境装配结果（envelope）。
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RunEnv {
    /// 按注入顺序排列的环境变量：
    /// ① 默认注入（PYTHONIOENCODING / PYTHONUTF8 / PYTHONUNBUFFERED）
    /// ② PYTHONPATH 四段合并（见 [`assemble`]）
    /// ③ 运行配置的其余用户环境变量（用户值优先，覆盖 ①②）
    /// ④ probe 三件套（仅 probe_src 为 Some 时）
    pub(crate) env: Vec<(String, String)>,
    /// 脚本参数（`shell-words` 拆分结果，调用方追加在脚本名之后）
    pub(crate) args: Vec<String>,
    /// 非致命告警（如参数解析失败），由调用方回显给用户——不中断运行
    pub(crate) warnings: Vec<String>,
    /// probe/src 目录（None = 未开启采集或未找到；调用方据此决定是否提示「本次不采集」）
    pub(crate) probe_src: Option<PathBuf>,
}

/// 定位 probe/src 注入目录（含 sitecustomize.py 顶层模块），优先顺序：
/// 1) 环境变量 OPENCHARM_PROBE_SRC；
/// 2) 托管目录 <data_root>/runtime/probe/src（及 /probe 兼容）；
/// 3) Tauri 资源目录（打包分发）；
/// 4) dev 相对 exe 上溯仓库布局（probe/src）。
/// 找不到返回 None——运行照常，仅无采集（探针缺席绝不拖垮用户脚本）。
pub(crate) fn locate_probe_src(app: &AppHandle) -> Option<PathBuf> {
    let is_probe = |p: &Path| p.join("sitecustomize.py").is_file();

    if let Ok(p) = std::env::var("OPENCHARM_PROBE_SRC") {
        let p = PathBuf::from(p);
        if is_probe(&p) {
            return Some(p);
        }
    }

    let runtime = crate::tool_paths::runtime_dir();
    for cand in [runtime.join("probe").join("src"), runtime.join("probe")] {
        if is_probe(&cand) {
            return Some(cand);
        }
    }

    for dir in resource_candidates(app) {
        for cand in [
            dir.join("probe").join("src"),
            dir.join("resources").join("probe").join("src"),
        ] {
            if is_probe(&cand) {
                return Some(cand);
            }
        }
    }

    let mut dir = std::env::current_exe().ok()?;
    for _ in 0..5 {
        dir.pop();
        let cand = dir.join("probe").join("src");
        if is_probe(&cand) {
            return Some(cand);
        }
    }
    None
}

/// 装配一次运行的环境变量与脚本参数（`probe=false` 时的完整结果，两条运行路径共用）。
///
/// PYTHONPATH 合并顺序固化 §9 约定「用户值优先、probe src 追加在后」：
///
/// ```text
/// ① 用户运行配置 PYTHONPATH → ② 继承的既有 PYTHONPATH → ③ 工作区根 → ④ probe src（若开启）
/// ```
///
/// ③ 工作区根用于对齐 `check_missing_imports`（预检把 root 塞进 sys.path），消除「预检通过但运行
/// ModuleNotFoundError」的双标；④ probe 包名 `opencharm_probe` 独占命名空间，置末不影响其可导入性，
/// 但能保证用户同名模块优先命中（不被探针遮蔽）。
///
/// **改动本函数前请先读上述约定**：这是两条运行路径一致性的唯一保证点。
pub(crate) fn build_run_env(
    app: &AppHandle,
    script_abs: &Path,
    workspace_root: Option<&str>,
    run_config: &RunConfig,
    probe: bool,
) -> RunEnv {
    let probe_src = if probe { locate_probe_src(app) } else { None };
    // ②-2 段（继承自 shell 的既有 PYTHONPATH）在此读取进程环境；作为显式入参下传，
    // 使四段合并顺序可被单测精确锁定，不受宿主机器环境变量干扰。
    let inherited = std::env::var("PYTHONPATH").ok().filter(|v| !v.is_empty());
    assemble(script_abs, workspace_root, run_config, probe_src, inherited.as_deref())
}

/// 装配主体（纯函数：只依赖入参，可被单测直接锁定顺序与合并规则）。
pub(crate) fn assemble(
    script_abs: &Path,
    workspace_root: Option<&str>,
    run_config: &RunConfig,
    probe_src: Option<PathBuf>,
    inherited_pythonpath: Option<&str>,
) -> RunEnv {
    let mut env: Vec<(String, String)> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // ① 默认注入（P0 建议 3）：PYTHONUNBUFFERED=1 保证长任务 stdout 逐行实时刷新，不退化为
    //   「结束时一次性吐出」；两条运行分支（解释器直跑 / uv run）都生效——uv run 会把环境变量
    //   透传给子 Python；probe 采样也依赖脚本及时 flush，同样受益。
    env.push(("PYTHONIOENCODING".to_string(), "utf-8".to_string()));
    env.push(("PYTHONUTF8".to_string(), "1".to_string()));
    env.push(("PYTHONUNBUFFERED".to_string(), "1".to_string()));

    // ② PYTHONPATH 四段合并
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut path_parts: Vec<String> = Vec::new();
    // ②-1 用户自定义 PYTHONPATH（运行配置里单列，避免被下面通用 env 循环重复设置）
    let user_pythonpath = run_config
        .env
        .iter()
        .find(|kv| kv.key.eq_ignore_ascii_case("PYTHONPATH"))
        .map(|kv| kv.value.clone())
        .filter(|v| !v.trim().is_empty());
    if let Some(up) = &user_pythonpath {
        path_parts.push(up.clone());
    }
    // ②-2 继承自 shell 的既有 PYTHONPATH（同属用户值）
    if let Some(inherited) = inherited_pythonpath.filter(|v| !v.trim().is_empty()) {
        path_parts.push(inherited.to_string());
    }
    // ②-3 工作区根（P0 对齐依赖预检）
    if let Some(root) = workspace_root {
        path_parts.push(root.to_string());
    }
    // ②-4 probe src 追加在后
    if let Some(src) = &probe_src {
        path_parts.push(src.to_string_lossy().to_string());
    }
    if !path_parts.is_empty() {
        env.push(("PYTHONPATH".to_string(), path_parts.join(sep)));
    }

    // ③ 其余用户自定义环境变量（用户值优先，覆盖前面的默认注入）
    for kv in &run_config.env {
        if kv.key.eq_ignore_ascii_case("PYTHONPATH") {
            continue; // 已并入 path_parts
        }
        if !kv.key.trim().is_empty() {
            env.push((kv.key.clone(), kv.value.clone()));
        }
    }

    // ④ probe 三件套（probe/src 已经 ②-4 进 PYTHONPATH，这里只补 autostart 开关与元信息）
    if probe_src.is_some() {
        env.push(("OPENCHARM_PROBE_AUTOSTART".to_string(), "1".to_string()));
        env.push((
            "OPENCHARM_PROBE_SCRIPT".to_string(),
            script_abs.to_string_lossy().to_string(),
        ));
        env.push((
            "OPENCHARM_PROBE_HOME".to_string(),
            crate::util::opencharm_home().to_string_lossy().to_string(),
        ));
    }

    // 脚本参数（P3）：shell-words 拆分（支持引号/转义）；解析失败降级为「忽略参数 + 告警」，不中断运行
    let mut args: Vec<String> = Vec::new();
    if !run_config.args.trim().is_empty() {
        match shell_words::split(&run_config.args) {
            Ok(tokens) => args = tokens,
            Err(e) => warnings.push(format!("[opencharm] 运行参数解析失败，已忽略 Parameters：{e}\n")),
        }
    }

    RunEnv { env, args, warnings, probe_src }
}

/// 运行命令解析结果（两条运行路径共用）：解释器直跑 或 `uv run` 兜底。
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct RunCommand {
    /// 可执行程序（解释器绝对路径，或 uv 的解析结果 / 裸名 "uv"）
    pub(crate) program: String,
    /// 脚本之前的固定参数：解释器分支为 `[脚本绝对路径]`，uv 分支为 `["run", 文件名]`
    pub(crate) args: Vec<String>,
    /// 该命令自身需要的环境注入（uv 分支的 PyPI 镜像源；解释器分支为空）
    pub(crate) env: Vec<(String, String)>,
    /// 是否走 `uv run` 兜底（回显来源前缀 / 可诊断错误提示用）
    pub(crate) is_uv: bool,
}

/// 解析运行命令：选中解释器 → 直接 `<解释器> <脚本>`；未选中 → `uv run <文件名>` 兜底。
/// 与 `run_script` 的历史分支完全一致，PTY 路径复用后不再有第二套解释器解析逻辑。
pub(crate) fn resolve_run_command(
    script_abs: &Path,
    file_name: &str,
    interpreter: Option<&str>,
) -> RunCommand {
    match interpreter {
        Some(interp) => RunCommand {
            program: interp.to_string(),
            args: vec![script_abs.to_string_lossy().to_string()],
            env: Vec::new(),
            is_uv: false,
        },
        None => {
            // 走 tool_command 以保持与 run_script 同一套 uv 解析（OPENCHARM_UV_BIN → ~/.local/bin → PATH）
            // 与 PyPI 镜像注入；这里把解析结果拆成 program + env，供 CommandBuilder 套用。
            let cmd = tool_command("uv", ENV_UV);
            let program = cmd.get_program().to_string_lossy().to_string();
            let env = cmd
                .get_envs()
                .filter_map(|(k, v)| {
                    Some((k.to_string_lossy().to_string(), v?.to_string_lossy().to_string()))
                })
                .collect();
            RunCommand {
                program,
                args: vec!["run".to_string(), file_name.to_string()],
                env,
                is_uv: true,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env_cmds::{EnvVar, StdinConfig};

    const SCRIPT: &str = if cfg!(windows) { "F:\\proj\\main.py" } else { "/proj/main.py" };

    fn rc(args: &str, env: Vec<EnvVar>) -> RunConfig {
        RunConfig { args: args.into(), env, stdin: StdinConfig::default() }
    }

    /// 装配（不挂 probe、无继承 PYTHONPATH）——单测统一入口
    fn asm(cfg: &RunConfig, root: Option<&str>) -> RunEnv {
        assemble(Path::new(SCRIPT), root, cfg, None, None)
    }

    /// §2.1 四段合并顺序的完整锁定：① 用户配置 → ② 继承 → ③ 工作区根 → ④ probe src
    #[test]
    fn pythonpath_four_segments_merge_in_fixed_order() {
        let cfg = rc("", vec![EnvVar { key: "PYTHONPATH".into(), value: "/user/lib".into() }]);
        let probe_src = PathBuf::from("/oc/probe/src");
        let e = assemble(
            Path::new(SCRIPT),
            Some("/ws/root"),
            &cfg,
            Some(probe_src.clone()),
            Some("/inherited/lib"),
        );
        let pp = env_value(&e, "PYTHONPATH").expect("应注入 PYTHONPATH");
        let sep = if cfg!(windows) { ';' } else { ':' };
        let parts: Vec<&str> = pp.split(sep).collect();
        assert_eq!(
            parts,
            ["/user/lib", "/inherited/lib", "/ws/root", "/oc/probe/src"],
            "四段顺序即优先级：用户值优先命中，probe src 置末不遮蔽用户同名模块"
        );
    }

    #[test]
    fn inherited_blank_pythonpath_is_ignored() {
        let e = assemble(Path::new(SCRIPT), None, &rc("", vec![]), None, Some("   "));
        assert!(env_value(&e, "PYTHONPATH").is_none());
    }

    fn env_value(env: &RunEnv, key: &str) -> Option<String> {
        env.env.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone())
    }

    #[test]
    fn defaults_are_injected_in_fixed_order() {
        let e = asm(&rc("", vec![]), None);
        let keys: Vec<&str> = e.env.iter().map(|(k, _)| k.as_str()).collect();
        // 无工作区根 / 无用户 env / 无 probe → 只剩默认三件套，且顺序固定
        assert_eq!(keys, ["PYTHONIOENCODING", "PYTHONUTF8", "PYTHONUNBUFFERED"]);
        assert_eq!(env_value(&e, "PYTHONIOENCODING").as_deref(), Some("utf-8"));
        assert_eq!(env_value(&e, "PYTHONUNBUFFERED").as_deref(), Some("1"));
    }

    #[test]
    fn workspace_root_goes_into_pythonpath() {
        // P0：对齐依赖预检——工作区根必须进 PYTHONPATH，否则「预检通过但运行 ModuleNotFoundError」
        let e = asm(&rc("", vec![]), Some(if cfg!(windows) { "F:\\proj" } else { "/proj" }));
        let pp = env_value(&e, "PYTHONPATH").expect("应注入 PYTHONPATH");
        assert!(pp.ends_with(if cfg!(windows) { "F:\\proj" } else { "/proj" }));
    }

    #[test]
    fn user_pythonpath_precedes_workspace_root_and_is_not_duplicated() {
        // §2.1 四段合并：用户值在前、工作区根在后；且 PYTHONPATH 只注入一次（不被通用 env 循环重复）
        let cfg = rc("", vec![EnvVar { key: "PYTHONPATH".into(), value: "/user/lib".into() }]);
        let e = asm(&cfg, Some("/ws/root"));
        let pp = env_value(&e, "PYTHONPATH").expect("应注入 PYTHONPATH");
        let sep = if cfg!(windows) { ';' } else { ':' };
        let parts: Vec<&str> = pp.split(sep).collect();
        assert_eq!(parts.first().unwrap(), &"/user/lib");
        assert_eq!(parts.last().unwrap(), &"/ws/root");
        assert_eq!(e.env.iter().filter(|(k, _)| k == "PYTHONPATH").count(), 1);
    }

    #[test]
    fn blank_user_pythonpath_is_ignored() {
        let cfg = rc("", vec![EnvVar { key: "PYTHONPATH".into(), value: "   ".into() }]);
        let e = asm(&cfg, None);
        assert!(env_value(&e, "PYTHONPATH").is_none());
    }

    #[test]
    fn user_env_overrides_defaults_by_order() {
        // 顺序即优先级：用户把 PYTHONUNBUFFERED 改回 0 时，后写的用户值生效
        let cfg = rc("", vec![EnvVar { key: "PYTHONUNBUFFERED".into(), value: "0".into() }]);
        let e = asm(&cfg, None);
        let hits: Vec<&str> = e.env.iter().filter(|(k, _)| k == "PYTHONUNBUFFERED").map(|(_, v)| v.as_str()).collect();
        assert_eq!(hits, ["1", "0"]); // 套用方按序 env()，后者覆盖前者
        assert!(env_value(&e, "MY_MISSING").is_none());
    }

    #[test]
    fn blank_env_key_is_skipped() {
        let cfg = rc("", vec![EnvVar { key: "  ".into(), value: "x".into() }]);
        let e = asm(&cfg, None);
        assert_eq!(e.env.len(), 3); // 只有默认三件套
    }

    #[test]
    fn probe_trio_and_pythonpath_tail() {
        // probe/src 追加在 PYTHONPATH **末位**（用户同名模块优先命中，不被探针遮蔽）+ autostart 三件套
        let probe_src = PathBuf::from(if cfg!(windows) { "F:\\oc\\probe\\src" } else { "/oc/probe/src" });
        let e = assemble(Path::new(SCRIPT), Some("/ws/root"), &rc("", vec![]), Some(probe_src.clone()), None);
        let pp = env_value(&e, "PYTHONPATH").expect("应注入 PYTHONPATH");
        let sep = if cfg!(windows) { ';' } else { ':' };
        let parts: Vec<&str> = pp.split(sep).collect();
        assert_eq!(parts.first().unwrap(), &"/ws/root");
        assert_eq!(parts.last().unwrap(), &probe_src.to_string_lossy());
        assert_eq!(env_value(&e, "OPENCHARM_PROBE_AUTOSTART").as_deref(), Some("1"));
        assert_eq!(env_value(&e, "OPENCHARM_PROBE_SCRIPT").as_deref(), Some(SCRIPT));
        assert!(!crate::util::opencharm_home().to_string_lossy().is_empty());
        assert!(env_value(&e, "OPENCHARM_PROBE_HOME").is_some());
        assert_eq!(e.probe_src.as_deref(), Some(probe_src.as_path()));
    }

    #[test]
    fn args_split_supports_quotes() {
        let e = asm(&rc(r#"--name "hello world" --n=2"#, vec![]), None);
        assert_eq!(e.args, ["--name", "hello world", "--n=2"]);
        assert!(e.warnings.is_empty());
    }

    #[test]
    fn args_split_failure_degrades_to_warning() {
        // 未闭合引号 → 忽略参数并告警，不中断运行
        let e = asm(&rc(r#"--name "unclosed"#, vec![]), None);
        assert!(e.args.is_empty());
        assert_eq!(e.warnings.len(), 1);
        assert!(e.warnings[0].contains("运行参数解析失败"));
    }

    #[test]
    fn resolve_run_command_prefers_interpreter() {
        let script = Path::new(SCRIPT);
        let c = resolve_run_command(script, "main.py", Some("F:/proj/.venv/Scripts/python.exe"));
        assert!(!c.is_uv);
        assert_eq!(c.program, "F:/proj/.venv/Scripts/python.exe");
        // 解释器分支：脚本绝对路径就是唯一的前置参数（运行配置 args 由调用方追加在其后）
        assert_eq!(c.args, vec![script.to_string_lossy().to_string()]);
        assert!(c.env.is_empty());
    }

    #[test]
    fn resolve_run_command_falls_back_to_uv_run() {
        let c = resolve_run_command(Path::new(SCRIPT), "main.py", None);
        assert!(c.is_uv);
        assert_eq!(c.args, ["run".to_string(), "main.py".to_string()]);
        assert!(!c.program.is_empty()); // 裸名 "uv" 或解析到的绝对路径
    }
}
