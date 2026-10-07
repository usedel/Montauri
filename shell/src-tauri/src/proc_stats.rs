// 资源可观测（A-1，PyCharm 调研）：外壳 + 子进程的内存 / CPU 快照。
//
// 动机：PyCharm 最大的差评是「资源占用不可控且不可见」（resource pigs / space heater，
// 见 docs/pycharm_ux_review_and_proposal.md §3.1）。我们的架构结构性更轻，但「轻」必须
// **可感知**——本命令让用户（以及我们自己排查问题时）随时回答「现在是谁在吃内存」。
//
// 范围（M1 只观测，不 kill）：外壳自身 + 子进程（**含中间层孙进程**——运行链常有
// cmd /c、shell 包装，只数直接子进程会漏掉真实内存大户，见 TD-021④）。
//
// CPU 语义：sysinfo 的 cpu_usage 是「自上一次 refresh_processes 以来的百分比」——首次
// 调用恒为 0，前端按固定间隔（面板打开 2s / 芯片 30s）采样后即有意义的滑动值。

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// 复用同一个 System 实例：sysinfo 的 CPU 百分比靠两次 refresh 的差值，换实例就归零；
/// Mutex<Option<_>> 惰性初始化（首条命令到达前不做任何系统枚举）。
static SYS: Mutex<Option<System>> = Mutex::new(None);

/// 单个进程的资源信息
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    /// 常驻内存（MB）
    pub rss_mb: f64,
    /// CPU 百分比（相对上一次采样的滑动值；首次调用为 0）
    pub cpu: f64,
}

/// 一次资源快照
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcStats {
    /// 外壳自身
    pub shell: ProcInfo,
    /// 子进程（含中间层孙进程），按内存降序（pyrefly / intel / debugpy / 被运行脚本…）
    pub children: Vec<ProcInfo>,
    /// 外壳 + 全部子进程的内存合计（MB；状态栏芯片显示这个）
    pub total_mb: f64,
}

fn to_info(pid: Pid, name: String, mem_bytes: u64, cpu: f32) -> ProcInfo {
    ProcInfo {
        pid: pid.as_u32(),
        name,
        rss_mb: (mem_bytes as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0, // 0.1MB 精度
        cpu: (cpu as f64 * 10.0).round() / 10.0,
    }
}

/// 按 parent 邻接表收集 root 的全部后代（含孙进程）。与 sysinfo 解耦成纯函数：
/// 入参是「pid → 子 pid 列表」，环由 visited 截断（进程 parent 关系在极端下可能成环，
/// 裸递归会栈溢出）。
fn collect_descendants(root: Pid, by_parent: &HashMap<Pid, Vec<Pid>>) -> Vec<Pid> {
    let mut seen: HashSet<Pid> = HashSet::new();
    seen.insert(root);
    let mut queue: Vec<Pid> = vec![root];
    let mut out: Vec<Pid> = Vec::new();
    while let Some(pid) = queue.pop() {
        if let Some(kids) = by_parent.get(&pid) {
            for &kid in kids {
                if seen.insert(kid) {
                    out.push(kid);
                    queue.push(kid);
                }
            }
        }
    }
    out
}

fn proc_stats_impl() -> Result<ProcStats, String> {
    // P2-9（2026-09-29 review，铁律 3）：poisoned 锁走 unpoison 恢复——一次持锁 panic
    // 不该让本命令永久失败（sysinfo 刷新失败后还能重建）。
    let mut guard = crate::util::unpoison(SYS.lock());
    let sys = guard.get_or_insert_with(System::new);
    // (ProcessesToUpdate::All, true)：全量刷新并移除已退出进程（防止 children 里残留死 PID）
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let self_pid = Pid::from_u32(std::process::id());
    let me = sys
        .process(self_pid)
        .ok_or_else(|| "proc_stats: 自身进程不可见（异常环境）".to_string())?;
    let shell = to_info(self_pid, "OpenCharm（外壳）".into(), me.memory(), me.cpu_usage());

    // TD-021④：运行链存在中间层（cmd /c、shell 包装）时孙进程内存不计入合计，芯片口径
    // 偏小。改为按进程树递归收集全部后代（BFS + visited 防环），再统一映射成 ProcInfo。
    let mut by_parent: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for p in sys.processes().values() {
        if let Some(par) = p.parent() {
            by_parent.entry(par).or_default().push(p.pid());
        }
    }
    let mut children: Vec<ProcInfo> = collect_descendants(self_pid, &by_parent)
        .iter()
        .filter_map(|pid| {
            let p = sys.process(*pid)?;
            Some(to_info(p.pid(), p.name().to_string_lossy().into_owned(), p.memory(), p.cpu_usage()))
        })
        .collect();
    children.sort_by(|a, b| {
        b.rss_mb
            .partial_cmp(&a.rss_mb)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let total_mb = shell.rss_mb + children.iter().map(|c| c.rss_mb).sum::<f64>();
    Ok(ProcStats { shell, children, total_mb: (total_mb * 10.0).round() / 10.0 })
}

/// 当前外壳与子进程的资源快照
/// P1-5（2026-09-29 review，铁律 5）：refresh_processes(All) 全系统进程枚举可耗时数百
/// 毫秒，前端按固定间隔调用（面板 2s / 芯片 30s）——同步命令会在主线程周期性卡顿。
/// 改 async + spawn_blocking（与同文件 storage_usage 等重 IO 命令同纪律）。
#[tauri::command]
pub async fn proc_stats() -> Result<ProcStats, String> {
    tauri::async_runtime::spawn_blocking(proc_stats_impl)
        .await
        .map_err(|e| format!("任务执行异常：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_info_rounds_to_tenth() {
        let info = to_info(Pid::from_u32(1), "x".into(), 1536 * 1024 * 1024, 3.14159);
        assert_eq!(info.rss_mb, 1536.0);
        assert_eq!(info.cpu, 3.1);
    }

    #[test]
    fn collect_descendants_walks_tree_and_breaks_cycles() {
        //  1 ─ 2 ─ 4 ─ 2（环）
        //      └ 3
        let mut m: HashMap<Pid, Vec<Pid>> = HashMap::new();
        m.insert(Pid::from_u32(1), vec![Pid::from_u32(2)]);
        m.insert(Pid::from_u32(2), vec![Pid::from_u32(3), Pid::from_u32(4)]);
        m.insert(Pid::from_u32(4), vec![Pid::from_u32(2)]); // 环
        let got = collect_descendants(Pid::from_u32(1), &m);
        assert_eq!(got.len(), 3);
        for pid in [2u32, 3, 4] {
            assert!(got.contains(&Pid::from_u32(pid)), "缺少 pid {pid}");
        }
    }

    #[test]
    fn collect_descendants_excludes_root_and_unrelated() {
        let mut m: HashMap<Pid, Vec<Pid>> = HashMap::new();
        m.insert(Pid::from_u32(1), vec![Pid::from_u32(2)]);
        m.insert(Pid::from_u32(2), vec![Pid::from_u32(1)]); // 环
        m.insert(Pid::from_u32(9), vec![Pid::from_u32(10)]); // 无关子树
        let got = collect_descendants(Pid::from_u32(1), &m);
        assert_eq!(got, vec![Pid::from_u32(2)]);
        assert!(!got.contains(&Pid::from_u32(1)));
        assert!(!got.contains(&Pid::from_u32(9)));
    }

    #[test]
    fn proc_stats_runs_and_contains_self() {
        // 真实调用一次：至少能看到外壳自身，且 total ≥ shell
        let st = proc_stats_impl().expect("proc_stats 应成功");
        assert!(st.shell.pid > 0);
        assert!(st.total_mb + 0.01 >= st.shell.rss_mb);
    }
}
