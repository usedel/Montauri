// pytest 测试运行器数据层（docs/pytest_dev_plan.md v1.0）。
//
// 形态：**四动作合一的复用式单命令** `pytest_action`（scratch_cmds「一个命令承载
// run/stop/status」先例）——命令面压在信号线上（见 ci/budgets.toml），不为本功能再开多条；
// **运行不占命令面**（走 terminal::run_in_terminal 的 kind="test" 分支）。
//
// 动作表：
// - `scan`    工作区遍历取测试文件名（复用 search_cmds::collect_files + SEARCH_IGNORED_DIRS，
//             无子进程，百毫秒级）→ 文件级骨架的数据源（前端先行渲染，不依赖 collect）；
// - `collect` spawn `pytest --collect-only -q`（cwd=工作区根），60s 超时可取消
//             → 用例子节点增强骨架（parametrize / 动态用例 / 自定义 python_files）；
// - `cancel`  kill 进行中的 collect 进程树（util::kill_pid_tree，taskkill /T /F 同铁律口径）；
// - `result`  读 <data_root>/test-results/<session_id>.xml 并手写解析（Cargo.toml 无 XML
//             crate，不引新依赖）→ 树状态合入的数据源。
//
// 关键口径（计划 §3.2，单测钉死）：
// - node id 行 = 含 `.py` 且 `.py` 后为行尾或 `::`（排除 `…py:12: Warning` 告警行与
//   `N tests collected` 摘要行；防插件改写收集输出时静默空树：退出码 0 但解析出 0 节点
//   且原始输出非空 → ok=false + error_tail 原文）；
// - pytest 缺失：stderr 命中 `No module named pytest` → missing_module="pytest"，
//   视图走安装引导（编排委托 depHealth，本文件不自己算命令）；
// - collect 子进程**进全局注册表**（它不是 PTY 会话，退出钩子不管就会孤儿），应用退出
//   钩子统一杀树（lsp / dap drain 先例）；
// - 单飞：同一 workspace_root 双提交 / 双窗口不可能双 spawn（DEP_FIX_BUSY 同款；
//   检查 + 占位同锁临界区，见 collect_impl——旧实现有 TOCTOU，复核 P1 修掉）；

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::util::{kill_pid_tree, unpoison};

/// collect 子进程超时（60s 即保险值而非典型：典型 FastAPI 项目 0.5~3s；large_repo
/// 88 文件量级应秒级）。超时同路杀树（铁律）。
const COLLECT_TIMEOUT: Duration = Duration::from_secs(60);

/// 退出钩子之外，collect 轮询的步长（超时 / 取消判定粒度）
const POLL_STEP: Duration = Duration::from_millis(50);

/// junitxml 结果文件的保留时长：每次测试运行启动时机会性清理 24h 前残留
/// （piggyback 在运行路径，不起定时器——「默认轻量」纪律）。
const RESULT_TTL: Duration = Duration::from_secs(24 * 3600);

/// 进行中的 collect 进程句柄（按 workspace_root 登记；单飞 + 取消 + 退出杀树共用）。
struct CollectProc {
    pid: u32,
    cancel: Arc<AtomicBool>,
}

/// collect 注册表：workspace_root → 在途进程。空表 = 无收集进行中。
static COLLECT_PROCS: LazyLock<Mutex<std::collections::HashMap<String, CollectProc>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// 测试结果目录：`<data_root>/test-results/`（后端内部契约，前端不碰）。
pub(crate) fn test_results_dir() -> PathBuf {
    crate::util::opencharm_home().join("test-results")
}

/// 机会性清理超过 RESULT_TTL 的 junitxml 残留（目录不存在 / 读取失败均静默跳过——
/// 清理是优化不是功能，失败不得拖垮运行路径）。
pub(crate) fn sweep_stale_results(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let now = std::time::SystemTime::now();
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().map(|x| x != "xml").unwrap_or(true) {
            continue;
        }
        let stale = e
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| now.duration_since(t).map(|d| d > RESULT_TTL).unwrap_or(false))
            .unwrap_or(false);
        if stale {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// 应用退出清理（lib.rs RunEvent::Exit）：同步杀灭在途 collect 进程树 + 置位取消标志
/// （轮询线程见标志即退；后台路径会被进程退出截断，必须在这里补同步杀树）。
pub(crate) fn collect_stop_for_exit() {
    let procs: Vec<CollectProc> = {
        let mut m = unpoison(COLLECT_PROCS.lock());
        m.drain().map(|(_, p)| p).collect()
    };
    for p in procs {
        p.cancel.store(true, Ordering::Relaxed);
        if p.pid != 0 {
            kill_pid_tree(p.pid);
        }
    }
}

/// 测试文件名判定（默认命名模式）：`test_*.py` / `*_test.py`。
/// 自定义 `python_files` 收集到的非常规命名文件由 collect 结果补齐（两段式，计划 §3.2）。
pub(crate) fn is_test_file_name(path: &Path) -> bool {
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else { return false };
    let Some(stem) = name.strip_suffix(".py") else { return false };
    stem.starts_with("test_") || stem.ends_with("_test")
}

/// 判定 collect 输出行是否为 node id 行：含 `.py` 且 `.py` 后为行尾或 `::`。
/// 排除告警行（`tests/test_x.py:12: PytestUnknownMarkWarning`——`.py` 后是 `:12`）
/// 与摘要行（`N tests collected in 0.5s`——不含 `.py`）。格式自 pytest 3.x 起稳定。
pub(crate) fn is_node_id_line(line: &str) -> bool {
    let l = line.trim();
    if l.is_empty() {
        return false;
    }
    let Some(idx) = l.find(".py") else { return false };
    let rest = &l[idx + 3..];
    rest.is_empty() || rest.starts_with("::")
}

/// 从 `--collect-only -q` 输出提取 node id 列表（保序、去空）。
pub(crate) fn parse_collect_nodes(output: &str) -> Vec<String> {
    output
        .lines()
        .filter(|l| is_node_id_line(l))
        .map(|l| l.trim().to_string())
        .collect()
}

/// pytest 缺失识别：stderr 命中 `No module named pytest`（含引号形态）。
/// 只认模块缺失这一种信号——其它错误走 error_tail 原文展示，不猜。
pub(crate) fn detect_missing_module(stderr: &str) -> Option<String> {
    let s = stderr.to_ascii_lowercase();
    let hit = s.contains("no module named pytest") || s.contains("no module named 'pytest'")
        || s.contains("no module named \"pytest\"");
    hit.then(|| "pytest".to_string())
}

/// 从 junitxml 属性串解析一个属性值（` name="value"`；找不到返回 None）。
/// **必须带前导空白边界**：`name` 是 `classname` 的子串，裸 `find("name=\"")` 会命中
/// `classname="…"` 把类名误当作用例名（单测 parse_junit_* 三例钉死）。
fn xml_attr(tag: &str, key: &str) -> Option<String> {
    let pat = format!("{key}=\"");
    let mut from = 0usize;
    while let Some(rel) = tag[from..].find(&pat) {
        let i = from + rel;
        let boundary_ok = i == 0
            || tag[..i]
                .chars()
                .next_back()
                .map(|c| c.is_whitespace())
                .unwrap_or(false);
        if boundary_ok {
            let rest = &tag[i + pat.len()..];
            let end = rest.find('"')?;
            return Some(unescape_xml(&rest[..end]));
        }
        from = i + pat.len();
    }
    None
}

/// XML 实体反转义（junitxml 的 message / 文本里会出现 &quot; &amp; &lt; &gt; &apos;
/// 与数字实体 &#x27; / &#39;——minidom 写引号常用数字形态，只认命名实体会漏转义）。
/// 边界留痕（复核 P2）：单遍顺序替换对双重转义（`&amp;lt;`）会漏一层解码——pytest
/// message 场景概率极低、tooltip 展示无害，不做多遍。
fn unescape_xml(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = s
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    // 数字实体（十进制 / 十六进制两种形态）
    let mut i = 0;
    while let Some(rel) = out[i..].find("&#") {
        let start = i + rel;
        let Some(end) = out[start..].find(';') else { break };
        let body = &out[start + 2..start + end];
        let cp = if let Some(hex) = body.strip_prefix('x').or_else(|| body.strip_prefix('X')) {
            u32::from_str_radix(hex, 16).ok()
        } else {
            body.parse::<u32>().ok()
        };
        if let Some(cp) = cp.and_then(char::from_u32) {
            out.replace_range(start..start + end + 1, &cp.to_string());
            i = start + cp.len_utf8();
        } else {
            i = start + end + 1;
        }
    }
    out
}

/// junitxml → node_id 重建：`<file>::<classname 去模块前缀、点分转 ::>::<name>`。
/// classname 形如 `tests.test_api.TestUser`（模块路径点分 + 类名）；file 形如
/// `tests/test_api.py`。剥掉与 file 对应的模块前缀，只留类路径（嵌套类点分转 ::）。
/// 前缀不匹配（包内 `__init__.py` 等）时整体按 :: 展开兜底——不静默丢类名。
pub(crate) fn rebuild_node_id(file: &str, classname: &str, name: &str) -> String {
    let module = file.trim_end_matches(".py").replace(['/', '\\'], ".");
    let class_part = if classname.is_empty() || classname == module {
        String::new()
    } else if let Some(rest) = classname.strip_prefix(&format!("{module}.")) {
        rest.replace('.', "::")
    } else {
        classname.replace('.', "::")
    };
    if class_part.is_empty() {
        format!("{file}::{name}")
    } else {
        format!("{file}::{class_part}::{name}")
    }
}

/// 单个 junitxml testcase 的解析结果（status 五档：passed / failed / error / skipped /
/// xfail；xfail 呈现归 skip 档，计划 §3.6）。
struct JunitCase {
    node_id: String,
    status: String,
    duration_ms: u64,
    message: String,
    file: String,
    line: Option<u32>,
}

/// 手写 junitxml 解析（Cargo.toml 无 XML crate，不引新依赖）：扫 `<testcase …>`
/// 元素，取属性 + 第一个 failure / error / skipped 子元素的 message 与文本。
/// 自闭合（`<testcase … />`）与成对（`</testcase>`）两形态都覆盖。
/// `file` / `line` 属性需 pytest ≥ 6；老版本缺属性时降级为「按 classname+name 匹配 +
/// 静态扫描行号」（前端 applyResults 的兜底口径，见 testTreeCore.ts）。
fn parse_junit_xml(xml: &str) -> Vec<JunitCase> {
    let mut out: Vec<JunitCase> = Vec::new();
    let mut cursor = 0usize;
    while let Some(rel) = xml[cursor..].find("<testcase") {
        let start = cursor + rel;
        // 元素文本终点：自闭合 `/>` 或 `</testcase>`
        let (elem_end, body_end) = match xml[start..].find("</testcase>") {
            Some(close_rel) => {
                let close = start + close_rel;
                // 自闭合优先：`/>` 出现在 `</testcase>` 之前。
                // 边界留痕（复核 P2）：属性值内含 `/>` 字面（如 message="x/>y"）会在此被
                // 误判为自闭合——引号感知扫描可根除，pytest message 命中概率极低，M1 接受。
                match xml[start..close].find("/>") {
                    Some(self_rel) => (start + self_rel + 2, start + self_rel),
                    None => (close + "</testcase>".len(), close),
                }
            }
            None => match xml[start..].find("/>") {
                Some(self_rel) => (start + self_rel + 2, start + self_rel),
                None => break, // 畸形（截断的 xml）：停在这里，已解析的部分照常返回
            },
        };
        let elem = &xml[start..elem_end];
        let body = &xml[start..body_end];
        let file = xml_attr(elem, "file").unwrap_or_default();
        let classname = xml_attr(elem, "classname").unwrap_or_default();
        let name = xml_attr(elem, "name").unwrap_or_default();
        let time: f64 = xml_attr(elem, "time").and_then(|v| v.parse().ok()).unwrap_or(0.0);
        let line: Option<u32> = xml_attr(elem, "line").and_then(|v| v.parse().ok());

        // 子元素定档：failure / error / skipped（xfail 也是 skipped，type=pytest.xfail）
        let (status, message) = if let Some((tag, text)) = find_child(elem, body, "failure") {
            ("failed".to_string(), child_message(tag, text))
        } else if let Some((tag, text)) = find_child(elem, body, "error") {
            ("error".to_string(), child_message(tag, text))
        } else if let Some((tag, text)) = find_child(elem, body, "skipped") {
            let xfail = xml_attr(tag, "type").map(|t| t.contains("xfail")).unwrap_or(false);
            (
                if xfail { "xfail".to_string() } else { "skipped".to_string() },
                child_message(tag, text),
            )
        } else {
            ("passed".to_string(), String::new())
        };
        let node_id = rebuild_node_id(&file, &classname, &name);
        out.push(JunitCase {
            node_id,
            status,
            duration_ms: (time * 1000.0).round() as u64,
            message,
            file,
            line,
        });
        cursor = elem_end;
    }
    out
}

/// 在 testcase 元素体内找指定子元素（`<failure …>` / `<error …>` / `<skipped …>`），
/// 返回（开标签串, 文本内容）。只找第一个（一个用例不会同时挂两种失败）。
fn find_child<'a>(elem: &'a str, body: &'a str, tag: &str) -> Option<(&'a str, &'a str)> {
    let pat = format!("<{tag}");
    let i = body.find(&pat)?;
    // 开标签终点：`>`（属性里不会含裸 `>`；实体编码过）
    let gt = body[i..].find('>')? + i;
    let open_tag = &body[i..=gt];
    let text_start = gt + 1;
    let close_pat = format!("</{tag}>");
    let text = match body[text_start..].find(&close_pat) {
        Some(c) => &body[text_start..text_start + c],
        None => "", // 截断的 xml：文本缺失不阻断定档
    };
    let _ = elem;
    Some((open_tag, text))
}

/// 子元素消息：message 属性优先，缺则取文本首行；统一截断到 2000 字符
/// （tooltip 展示，traceback 全文可达数万字符）。
fn child_message(open_tag: &str, text: &str) -> String {
    let raw = xml_attr(open_tag, "message")
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| {
            text.lines().map(|l| l.trim()).find(|l| !l.is_empty()).unwrap_or("").to_string()
        });
    let mut s = unescape_xml(&raw);
    if s.chars().count() > 2000 {
        s = s.chars().take(2000).collect();
    }
    s
}

/// pytest_action：四动作合一（scan / collect / cancel / result）。
/// scan / collect / result 都可能耗时（遍历 / 子进程 / 数 MB XML 解析）——统一
/// spawn_blocking，绝不在 async 线程里做阻塞 IO（卡死 UI）。
#[tauri::command]
pub async fn pytest_action(
    action: String,
    workspace_root: String,
    session_id: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "scan" => scan_impl(&workspace_root),
        "collect" => collect_impl(&workspace_root),
        "cancel" => cancel_impl(&workspace_root),
        "result" => {
            let sid = session_id.ok_or("读取测试结果需提供 session_id")?;
            result_impl(&sid)
        }
        other => Err(format!("未知的 pytest_action 动作: {other}")),
    })
    .await
    .map_err(|e| format!("任务执行异常：{e}"))?
}

/// scan：工作区遍历取测试文件名（相对工作区根、正斜杠、按路径排序保确定性）。
/// 复用 search_cmds::collect_files（.gitignore 感知 + SEARCH_IGNORED_DIRS 剪枝）——
/// 不造第二套遍历口径；无子进程。
fn scan_impl(root: &str) -> Result<Value, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err(format!("工作区目录不存在：{root}"));
    }
    let mut files: Vec<String> = crate::search_cmds::collect_files(root_path)
        .iter()
        .filter(|p| is_test_file_name(p))
        .map(|p| {
            let rel = p.strip_prefix(root_path).unwrap_or(p);
            rel.to_string_lossy().replace('\\', "/")
        })
        .collect();
    files.sort();
    Ok(json!({ "files": files }))
}

/// cancel：kill 进行中的 collect 进程树。无在途收集时静默成功（用户可能只是点了两下，
/// 或收集恰好在点击前一瞬完成——同 uv_cancel_op 口径，不该报错）。
fn cancel_impl(root: &str) -> Result<Value, String> {
    let taken = {
        let mut m = unpoison(COLLECT_PROCS.lock());
        m.remove(root)
    };
    match taken {
        Some(p) => {
            p.cancel.store(true, Ordering::Relaxed);
            if p.pid != 0 {
                kill_pid_tree(p.pid);
            }
            Ok(json!({ "cancelled": true }))
        }
        None => Ok(json!({ "cancelled": false })),
    }
}

/// collect：spawn `pytest --collect-only -q`（cwd=工作区根），解析 node id 列表。
/// - 单飞（同 root 双提交第二次直接拒绝）；
/// - 60s 超时 / 取消同路杀树；
/// - 退出码非 0 → error_tail（输出尾部 40 行）供视图展示；
/// - 退出码 0 但 0 节点且输出非空 → ok=false（防插件改写收集输出时静默空树）。
fn collect_impl(root: &str) -> Result<Value, String> {
    // 单飞闸门（DEP_FIX_BUSY 同款；按 workspace_root 判重）。
    // **检查 + 原子占位在同一锁临界区**（复核 P1 修 TOCTOU）：旧实现锁内检查、锁外
    // spawn 完才 insert——并发双 collect 可同时过检查，且第二 insert 覆盖第一 pid
    // （孤儿 + 收尾误删他人条目）。占位条目 pid=0，以 cancel Arc 的 ptr_eq 作身份
    // 指纹；spawn 成功锁内替换为真实 pid，失败锁内回滚。
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut m = unpoison(COLLECT_PROCS.lock());
        if m.contains_key(root) {
            return Err("收集正在进行中".to_string());
        }
        m.insert(root.to_string(), CollectProc { pid: 0, cancel: cancel.clone() });
    }
    let interpreter = crate::run_env::resolve_run_interpreter("", Some(root));
    // 命令构造：解释器直跑 `<解释器> -m pytest --collect-only -q`；uv 兜底
    // `uv run pytest --collect-only -q`（uv 默认同步 dev 组，计划 §3.9 边角①）。
    let mut cmd = match &interpreter {
        Some(interp) => {
            let mut c = std::process::Command::new(interp);
            c.args(["-m", "pytest", "--collect-only", "-q"]);
            c
        }
        None => {
            if !crate::tool_paths::is_available("uv", crate::tool_paths::ENV_UV) {
                return Err("未选择解释器且未找到 uv，无法收集测试（可在状态栏选择解释器，或先安装 uv）"
                    .to_string());
            }
            let uv = crate::tool_paths::tool_command("uv", crate::tool_paths::ENV_UV);
            let mut c = std::process::Command::new(uv.get_program().to_string_lossy().to_string());
            c.args(["run", "pytest", "--collect-only", "-q"]);
            for (k, v) in uv.get_envs() {
                if let Some(v) = v {
                    c.env(k.to_string_lossy().to_string(), v.to_string_lossy().to_string());
                }
            }
            c
        }
    };
    cmd.current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::util::no_window(&mut cmd);

    let start = Instant::now();
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            // 回滚自己的占位（ptr_eq 防误删他人条目——占位期间可能已被 cancel 清走）
            let mut m = unpoison(COLLECT_PROCS.lock());
            if m.get(root).is_some_and(|p| Arc::ptr_eq(&p.cancel, &cancel)) {
                m.remove(root);
            }
            return Err(format!("无法启动 pytest 收集进程: {e}"));
        }
    };
    let pid = child.id();
    {
        let mut m = unpoison(COLLECT_PROCS.lock());
        m.insert(root.to_string(), CollectProc { pid, cancel: cancel.clone() });
    }
    // 输出收集：两个读线程把 stdout / stderr 灌进缓冲（PTY 无关，pipe 即可）
    let stdout_buf = Arc::new(Mutex::new(String::new()));
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let mut handles = Vec::new();
    if let Some(out) = child.stdout.take() {
        let buf = stdout_buf.clone();
        handles.push(std::thread::spawn(move || {
            use std::io::Read;
            let mut s = String::new();
            let _ = std::io::BufReader::new(out).read_to_string(&mut s);
            *unpoison(buf.lock()) = s;
        }));
    }
    if let Some(err) = child.stderr.take() {
        let buf = stderr_buf.clone();
        handles.push(std::thread::spawn(move || {
            use std::io::Read;
            let mut s = String::new();
            let _ = std::io::BufReader::new(err).read_to_string(&mut s);
            *unpoison(buf.lock()) = s;
        }));
    }

    // 等待循环：取消 / 超时 / 自然退出三路。杀树后必须 wait 回收（防僵尸）。
    // 口径留痕（复核 P2）：kill_pid_tree 非 Windows 是 no-op → 超时/取消在该平台退化为
    // 「等自然退出」（wait 可能悬置，注册表条目占坑直到退出）——主平台 Windows 无此问题。
    let mut killed = false;
    let status = loop {
        if cancel.load(Ordering::Relaxed) {
            killed = true;
            break None;
        }
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) => {}
            Err(_) => break None,
        }
        if start.elapsed() >= COLLECT_TIMEOUT {
            killed = true;
            break None;
        }
        std::thread::sleep(POLL_STEP);
    };
    if killed {
        kill_pid_tree(pid);
        let _ = child.wait();
    }
    {
        let mut m = unpoison(COLLECT_PROCS.lock());
        // 仅当注册表里仍是「自己这轮」才移除（复核 P1：cancel 已清走 / 新一轮已占位时
        // 无条件 remove 会误删他人条目，令其 cancel/超时永远够不着）
        if m.get(root).is_some_and(|p| Arc::ptr_eq(&p.cancel, &cancel)) {
            m.remove(root);
        }
    }
    for h in handles {
        let _ = h.join();
    }
    let stdout = std::mem::take(&mut *unpoison(stdout_buf.lock()));
    let stderr = std::mem::take(&mut *unpoison(stderr_buf.lock()));
    let duration_ms = start.elapsed().as_millis();

    // 取消 / 超时：ok=false + 取消标记（视图据此静默复位，不弹错误）
    if killed {
        return Ok(json!({
            "ok": false,
            "cancelled": true,
            "nodes": [],
            "missing_module": null,
            "error_tail": "",
            "duration_ms": duration_ms,
        }));
    }

    let missing_module = detect_missing_module(&stderr);
    let nodes = parse_collect_nodes(&stdout);
    let code = status.and_then(|s| s.code());
    let exit_ok = code == Some(0);
    // 退出码 0 但 0 节点且原始输出非空 → 收集输出被插件改写，展示原文不静默空树
    let silent_empty = exit_ok && nodes.is_empty() && !stdout.trim().is_empty();
    let ok = exit_ok && !nodes.is_empty() && missing_module.is_none();
    let error_tail = if ok {
        String::new()
    } else {
        tail_lines(&stdout, &stderr, 40)
    };
    Ok(json!({
        "ok": ok,
        "cancelled": false,
        "nodes": nodes,
        "missing_module": missing_module,
        "error_tail": error_tail,
        "silent_empty": silent_empty,
        "duration_ms": duration_ms,
    }))
}

/// 输出尾部 N 行（stderr 优先——pytest 的收集错误走 stderr；stdout 补充）。
fn tail_lines(stdout: &str, stderr: &str, n: usize) -> String {
    let combined = if stderr.trim().is_empty() { stdout } else { stderr };
    let lines: Vec<&str> = combined.lines().collect();
    let from = lines.len().saturating_sub(n);
    lines[from..].join("\n")
}

/// result：读 `<data_root>/test-results/<session_id>.xml` 并解析。
/// 文件不存在（进程被 kill / 尚未落盘）→ `{ found: false }`（前端 toast 轻提示、
/// 状态留 unknown，不报错刷屏）；解析失败 → Err（前端按错误处理）。
fn result_impl(session_id: &str) -> Result<Value, String> {
    // 防目录穿越：session_id 只允许字母数字与 `-_.`（终端会话 id 形态）
    if !session_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        || session_id.contains("..")
    {
        return Err(format!("非法的 session_id: {session_id}"));
    }
    let path = test_results_dir().join(format!("{session_id}.xml"));
    let xml = match std::fs::read_to_string(&path) {
        Ok(x) => x,
        // NotFound = 无结果（进程被 kill / 尚未写出）→ found:false 静默；
        // 非 UTF-8 等读取错误是真实故障，报错不掩盖（复核 P2）
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(json!({ "found": false, "cases": [] }));
        }
        Err(e) => return Err(format!("结果文件读取失败: {e}")),
    };
    let cases: Vec<Value> = parse_junit_xml(&xml)
        .into_iter()
        .map(|c| {
            json!({
                "node_id": c.node_id,
                "status": c.status,
                "duration_ms": c.duration_ms,
                "message": c.message,
                "file": c.file,
                "line": c.line,
            })
        })
        .collect();
    Ok(json!({ "found": true, "cases": cases }))
}

#[cfg(test)]
#[path = "pytest_cmds_tests.rs"]
mod tests;
