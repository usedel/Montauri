// Scratch / 单元格执行（VS Code 插件调研报告 借鉴-2 · 对标 Jupyter 的 cell 执行）。
//
// 形态：**按需起一个解释器进程**，空闲 `IDLE_TIMEOUT`（5 分钟）后回收；执行粒度是
// `# %%` 分隔的单元格（解析在前端 `scratch.ts`，本文件只收源码与动作）。
//
// ⚠ **ADR-0010 纪律（报告 §4 借鉴-2，本功能立项的前提，改动前先读）**：
//   · **按需起**：没有会话时第一次执行才 spawn，绝不在应用启动时预起；
//   · **可显式关闭**：前端有 `stop` 动作与空闲计时器两条回收路径；
//   · **空闲即回收**：`IDLE_TIMEOUT` 未被执行刷新 → 下次执行前先杀旧的再起新的。
//   违反任意一条本功能即应终止（报告的「不做的条件」）。
//
// 与 lib_cmds::py_eval 的分工：那条是**一次一进程 + 脚本白名单**（不开放任意代码执行，
// D-4 纪律）；本文件是**长驻会话 + 任意用户代码**（这正是 Scratch 的语义前提），
// 故不复用 py_eval，也不把单元格执行塞进它的白名单（白名单会挡掉用户代码）。

use serde::Serialize;
use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::env_cmds;
use crate::util::{kill_process_tree, no_window, unpoison};

/// 结束哨兵：单元格代码跑完由 driver 打印一次，Rust 侧据此判定「这段的输出到此为止」
const SENTINEL: &str = "__MONTAURI_SCRATCH_END__";

/// 单元格执行超时（死循环 / 阻塞 IO 的兜底；超时即杀会话，下次执行重新起）
const EVAL_TIMEOUT: Duration = Duration::from_secs(30);

/// 空闲回收阈值（ADR-0010：5 分钟无执行即回收，不留常驻）
const IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// 会话内 driver：按「长度前缀 + 源码」协议从 stdin 读一段代码，exec 后打印哨兵。
/// 用 `buffer.read(n)` 按**字节**读（文本模式 `read(n)` 按字符，非 ASCII 会错位）。
const DRIVER: &str = r#"
import sys

SENT = "__MONTAURI_SCRATCH_END__"
ns = {"__name__": "__main__"}
stdin = sys.stdin.buffer
while True:
    hdr = sys.stdin.readline()
    if not hdr:
        break
    try:
        n = int(hdr.strip())
    except ValueError:
        continue
    data = stdin.read(n).decode("utf-8", "replace")
    try:
        exec(compile(data, "<cell>", "exec"), ns)
    except SystemExit:
        break
    except BaseException:
        import traceback
        traceback.print_exc()
    sys.stdout.write("\n" + SENT + "\n")
    sys.stdout.flush()
"#;

/// 会话里需要互斥访问的那部分（子进程 + stdin + 空闲计时）。
/// 单独成层是为了**缩短持锁区间**：`run` 的执行等待（最长 EVAL_TIMEOUT）必须在锁外进行，
/// 否则 `stop` / `status` 会被正在跑的单元格一并阻塞（见 RUN_LOCK 注释）。
struct Inner {
    child: Child,
    stdin: ChildStdin,
    last_used: Instant,
}

struct Session {
    inner: Arc<Mutex<Inner>>,
    /// 输出累积缓冲（stdout 与 stderr 两个读线程都往这里追加）
    out: Arc<Mutex<Vec<u8>>>,
    /// 会话所属工作区。**切工作区必须重起**：解释器的 sys.path 与 cwd 都在 spawn 时定死，
    /// 复用旧会话会让新项目里的单元格跑在旧项目的上下文里（静默的错误结果）。
    root: String,
}

static SESSION: OnceLock<Mutex<Option<Session>>> = OnceLock::new();

/// 执行串行锁：同一时刻只允许一个单元格在跑（两次 run 共用同一会话，交错会串输出）。
/// ⚠ **stop / status 绝不拿这把锁**——否则「显式关闭」会被正在跑的单元格阻塞到
/// EVAL_TIMEOUT（30s）才生效，ADR-0010 的「可显式关闭」条款形同虚设。
static RUN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn session_lock() -> &'static Mutex<Option<Session>> {
    SESSION.get_or_init(|| Mutex::new(None))
}

fn run_lock() -> &'static Mutex<()> {
    RUN_LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Serialize, Clone)]
pub struct ScratchOut {
    /// 本次执行的输出（stdout + stderr 合并；失败时为错误信息）
    pub out: String,
    /// 会话是否仍在运行（前端据此显示「已回收」等状态）
    pub running: bool,
    /// 是否因超时被杀（超时即会话作废，下次执行会重新起）
    pub timed_out: bool,
}

/// Scratch 会话的唯一入口：`run` 执行一段代码 / `stop` 显式关闭 / `status` 只查状态。
/// 三个动作合成一个命令——命令面已压在信号线上（见 `ci/budgets.toml` 的命令面条目），
/// 不为本功能再开两条。**stop 必须能与 run 并发**（ADR-0010「可显式关闭」），故不能把
/// stop 做成 run 的取消参数——那会把「停止」排到 run 之后才被处理。
#[tauri::command]
pub async fn scratch_eval(
    action: String,
    code: Option<String>,
    workspace_root: Option<String>,
) -> Result<ScratchOut, String> {
    match action_kind(&action) {
        ActionKind::Status => Ok(ScratchOut { out: String::new(), running: has_live_session(), timed_out: false }),
        ActionKind::Stop => {
            drop_session();
            Ok(ScratchOut { out: String::new(), running: false, timed_out: false })
        }
        ActionKind::Run => {
            let code = code.unwrap_or_default();
            let root = workspace_root.unwrap_or_default();
            tauri::async_runtime::spawn_blocking(move || run_cell_impl(&root, &code))
                .await
                .map_err(|e| format!("任务执行异常：{e}"))?
        }
        ActionKind::Bad => Err(format!("BadAction: {action}")),
    }
}

/// 动作分类。**分派与单测共用同一份判定**（不写两遍，避免分支漂移）。
pub enum ActionKind {
    Run,
    Stop,
    Status,
    Bad,
}

pub fn action_kind(a: &str) -> ActionKind {
    match a {
        "run" => ActionKind::Run,
        "stop" => ActionKind::Stop,
        "status" => ActionKind::Status,
        _ => ActionKind::Bad,
    }
}

/// 会话进程是否还在（**只短暂持 Inner 锁**：轮询循环里一秒内会问上百次）
fn is_alive(inner: &Arc<Mutex<Inner>>) -> bool {
    let mut g = unpoison(inner.lock());
    matches!(g.child.try_wait(), Ok(None))
}

fn has_live_session() -> bool {
    match unpoison(session_lock().lock()).as_ref() {
        Some(s) => is_alive(&s.inner),
        None => false,
    }
}

fn drop_session() {
    let mut guard = unpoison(session_lock().lock());
    if let Some(s) = guard.take() {
        let mut inner = unpoison(s.inner.lock());
        kill_process_tree(&mut inner.child);
    }
}

/// 摘掉指定会话（**只在 Inner 锁外调用**——内部会再锁一次 Inner，重入即死锁）。
/// 用 `Arc::ptr_eq` 认身份：可能是 run 自己发现会话已死，也可能已被 stop 摘过了。
fn reap_session(inner: &Arc<Mutex<Inner>>) {
    let mut guard = unpoison(session_lock().lock());
    let mine = guard.as_ref().is_some_and(|s| Arc::ptr_eq(&s.inner, inner));
    if !mine {
        return;
    }
    if let Some(s) = guard.take() {
        let mut i = unpoison(s.inner.lock());
        kill_process_tree(&mut i.child);
    }
}

/// 会话是否必须重建；**未作废时顺带刷新空闲计时**（函数带副作用，故名 renew）。
/// 三条作废理由：换工作区 / 进程已死 / 空闲超 IDLE_TIMEOUT（ADR-0010）。
fn session_renew(s: &Session, root: &str) -> bool {
    if s.root != root {
        return true;
    }
    let mut inner = unpoison(s.inner.lock());
    if !matches!(inner.child.try_wait(), Ok(None)) {
        return true;
    }
    if inner.last_used.elapsed() > IDLE_TIMEOUT {
        return true;
    }
    inner.last_used = Instant::now();
    false
}

fn run_cell_impl(root: &str, code: &str) -> Result<ScratchOut, String> {
    let interp = env_cmds::get_interpreter(root.to_string())
        .ok()
        .flatten()
        .ok_or_else(|| "NoInterpreter: 未配置 Python 解释器".to_string())?;

    // 串行化执行：**只挡并发 run**（stop / status 走 SESSION 锁，不受这把锁影响）
    let _run = unpoison(run_lock().lock());

    // 取（或按需起）会话——SESSION 锁只在这段里短暂持有，**执行等待绝不在锁内**：
    // 否则 stop 会被正在跑的单元格阻塞到 EVAL_TIMEOUT（30s）才生效。
    let (inner, out) = {
        let mut guard = unpoison(session_lock().lock());
        if guard.as_ref().is_some_and(|s| session_renew(s, root)) {
            // 换工作区 / 进程已死 / 空闲超时 → 先回收再按需重起（ADR-0010：不留常驻）
            let dead = guard.take().expect("刚判定存在");
            let mut i = unpoison(dead.inner.lock());
            kill_process_tree(&mut i.child);
        }
        if guard.is_none() {
            *guard = Some(spawn_session(&interp, root)?);
        }
        let s = guard.as_ref().expect("上面保证存在");
        (s.inner.clone(), s.out.clone())
    };

    // 长度前缀按**字节**计（driver 用 buffer.read(n)）
    let bytes = code.as_bytes();
    unpoison(out.lock()).clear();
    let write_ok = {
        let mut i = unpoison(inner.lock());
        i.stdin
            .write_all(format!("{}\n", bytes.len()).as_bytes())
            .and_then(|_| i.stdin.write_all(bytes))
            .and_then(|_| i.stdin.flush())
            .is_ok()
    };
    if !write_ok {
        // 写失败 = 会话已死：作废，前端重试会重新起一个
        reap_session(&inner);
        return Err("SessionDead: 会话已失效，请重试".to_string());
    }

    // 等哨兵：**全程不持长锁**——stop 随时可以进来杀进程，下一轮轮询即可观测到退出，
    // 于是「停止」立刻生效（而不是排队等到 EVAL_TIMEOUT）。
    let deadline = Instant::now() + EVAL_TIMEOUT;
    let mut timed_out = false;
    loop {
        if find_sentinel(&unpoison(out.lock())[..]).is_some() {
            break;
        }
        if !is_alive(&inner) {
            // 进程自己退出（用户在单元格里 exit()）或被 stop 杀掉：把残留输出交出去。
            // 先给读线程 ~20ms 收尾——stdout/stderr 的 EOF 处理与最后一次 append 是异步的，
            // 不等这一下，stop 打断时最后几行输出会被丢掉（用户会以为输出被吃了）。
            std::thread::sleep(Duration::from_millis(20));
            break;
        }
        if Instant::now() >= deadline {
            timed_out = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    if timed_out {
        reap_session(&inner); // 超时即会话作废，下次执行重新起
        let partial = String::from_utf8_lossy(&unpoison(out.lock()).clone()).to_string();
        return Ok(ScratchOut {
            out: format!("{partial}\n[执行超时 {} 秒，会话已回收]", EVAL_TIMEOUT.as_secs()),
            running: false,
            timed_out: true,
        });
    }

    let (text, running) = {
        let mut buf = unpoison(out.lock());
        let text = match find_sentinel(&buf[..]) {
            Some(idx) => {
                let t = String::from_utf8_lossy(&buf[..idx]).to_string();
                buf.drain(..idx + SENTINEL.len());
                t
            }
            None => String::from_utf8_lossy(&buf).to_string(),
        };
        drop(buf);
        (text, is_alive(&inner))
    };
    if !running {
        // 进程已不在（exit() 或被 stop）：摘掉会话，下次按需重起
        reap_session(&inner);
    }
    Ok(ScratchOut { out: trim_output(&text), running, timed_out: false })
}

/** 输出缓冲里哨兵的位置（按字节找，避免 String 索引 panic） */
fn find_sentinel(buf: &[u8]) -> Option<usize> {
    if buf.len() < SENTINEL.len() {
        return None;
    }
    buf.windows(SENTINEL.len()).position(|w| w == SENTINEL.as_bytes())
}

fn trim_output(s: &str) -> String {
    // driver 在代码执行后先写一个 `\n` 再打哨兵，故尾部多余换行要去掉；
    // 首部同理（exec 本身没输出时留下的空行）
    s.trim_matches('\n').trim_end().to_string()
}

fn spawn_session(interp: &str, root: &str) -> Result<Session, String> {
    let mut cmd = Command::new(interp);
    cmd.args(["-I", "-u", "-X", "utf8", "-c", DRIVER])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // cwd = 工作区根：单元格里的相对路径（`open("data/x.csv")`）才与项目一致
    // （不设则继承外壳进程 cwd，是任意位置）。根为空/不存在时不设，交给解释器默认。
    if !root.is_empty() && Path::new(root).is_dir() {
        cmd.current_dir(root);
    }
    no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("NoInterpreter: 启动解释器失败：{e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "NoInterpreter: 无法取得 stdin".to_string())?;
    let out = Arc::new(Mutex::new(Vec::new()));
    // stdout / stderr 两个读线程合并进同一份缓冲（类型不同 → 用 dyn Read 统一）
    let stdout = child.stdout.take().map(|r| Box::new(r) as Box<dyn Read + Send>);
    let stderr = child.stderr.take().map(|r| Box::new(r) as Box<dyn Read + Send>);
    for src in [stdout, stderr] {
        let Some(src) = src else { continue };
        let sink = out.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(src);
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => unpoison(sink.lock()).extend_from_slice(&chunk[..n]),
                }
            }
        });
    }
    Ok(Session {
        inner: Arc::new(Mutex::new(Inner { child, stdin, last_used: Instant::now() })),
        out,
        root: root.to_string(),
    })
}

// ---------- 单元测试 ----------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentinel_scan_and_trim() {
        assert_eq!(find_sentinel(b"abc"), None);
        let s = format!("hello\n{SENTINEL}\ntail");
        let idx = find_sentinel(s.as_bytes()).expect("应找到哨兵");
        assert_eq!(&s[..idx], "hello\n");
        // trim 只去首尾换行，不动中间内容
        assert_eq!(trim_output("\n\n  a\n b  \n\n"), "  a\n b");
    }

    #[test]
    fn bad_action_rejected() {
        // 不启动任何进程即可断言（无需解释器）。判定函数与运行时分派是同一份。
        assert!(matches!(action_kind("nope"), ActionKind::Bad));
        assert!(matches!(action_kind("run"), ActionKind::Run));
        assert!(matches!(action_kind("stop"), ActionKind::Stop));
        assert!(matches!(action_kind("status"), ActionKind::Status));
    }

    /// `stop` 必须能打断正在执行的单元格（ADR-0010「可显式关闭」）。
    /// 结构性自证：执行串行锁（RUN_LOCK）与会话锁（SESSION）是两把锁——
    /// 持着执行锁时走 stop 路径（drop_session / has_live_session）仍要能立即完成。
    /// 回归征兆：**不是断言失败，而是本用例永久挂住**（锁串行化错误 = 死锁）。
    #[test]
    fn stop_is_not_blocked_by_running_cell() {
        let _running = unpoison(run_lock().lock()); // 模拟「一个单元格正在跑」
        drop_session(); // stop 路径
        assert!(!has_live_session()); // status 路径
    }
}
