# 系统盘占用治理方案（已实施 · 2026-08-29）

> 目标：在 v2 目录布局（数据根 `%LOCALAPPDATA%\Montauri`、工具归用户自有位置）下，
> 最大化减少 C 盘占用，并把「占用可视化 + 清理 + 迁移」做成产品能力，而不是停留在文档提示。
>
> 修订：全局虚拟环境功能已移除（项目环境隔离原则，见 data-directory-layout-v2.md 修订记录 6），
> `envs/` 不再存在，原 P3「envs 治理」删除；C 盘治理对象收敛为 uv 缓存 + 数据根可再生日录。

---

## 1. C 盘占用来源清单（按典型体量排序）

| # | 来源 | 典型体量 | 可再生？ | 治理手段 | 归属 |
|---|---|---|---|---|---|
| 1 | uv 下载缓存 `%LOCALAPPDATA%\uv\cache` | 1–5 GB（随项目数增长） | ✅ 完全可再生 | `UV_CACHE_DIR` 环境变量重定向；`uv cache prune` / `clean` | uv 官方机制，Montauri 尊重并引导 |
| 2 | 项目内 `.venv` | 0.3–2 GB × 项目数 | ❌ | 项目本身放 D: 盘 | 用户项目，Montauri 不管 |
| 3 | uv 工具 `%APPDATA%\uv\tools`（pyrefly 等） | 0.1–0.3 GB/个 | ✅ 可重装 | `UV_TOOL_DIR` 重定向 | uv 官方机制 |
| 4 | trace 库 `<data_root>\traces\*.db` | 10 MB–1 GB | ✅ 重新采样即可 | 按项目清理 | Montauri 新增 |
| 5 | WebView2 用户数据 `<data_root>\webview\` | 0.1–0.5 GB（缓存为主） | ✅（登录态除外） | 清理缓存子目录（保留登录态） | Montauri 新增 |
| 6 | 运行时 `<data_root>\runtime\` | ~50 MB | 随版本分发 | 不治理 | — |
| 7 | 日志 `<data_root>\logs\` | <10 MB | ✅ | 已有轮转 | — |

> 结论：**大头是 uv 缓存（可数 GB）与各项目 `.venv`（跟随项目目录）**。uv 缓存有官方重定向机制；
> Montauri 数据根内只剩可再生中小项（traces/webview/logs），治理手段是清理 + 整根重定向。

---

## 2. 方案分四层

### P0 零开发：文档化现有机制（立即生效）

写入 v2 文档与 README「磁盘占用」小节，用户自行配置（设置面板「打开数据目录」旁给说明链接）：

| 环境变量（用户级） | 作用 |
|---|---|
| `MONTAURI_DATA_ROOT=D:\montauri-data` | Montauri 全部数据（config/traces/webview/logs）搬离 C 盘（高级用户手动设置；应用自身的落位机制走指针文件，见 P2） |
| `UV_CACHE_DIR=D:\uv-cache` | uv 下载缓存搬离 C 盘（对用户所有项目生效） |
| `UV_TOOL_DIR=D:\uv-tools` | uv 工具本体（pyrefly 等）搬离 C 盘 |

### P1 设置面板「存储」页（核心，建议先做）

新设置分类「存储」，两个能力：

**① 占用可视化**

- 新命令 `storage_usage()`：并发统计各子目录大小（config / traces / webview / logs / runtime），
  另查询 uv 官方位置（`%LOCALAPPDATA%\uv\cache`、`%APPDATA%\uv\tools`，存在才显示）；
- 前端按大小排序展示明细，标注「可再生 / 需重建 / 不可删」。

**② 一键清理（只删可再生内容，逐项确认）**

| 清理项 | 动作 | 安全边界 |
|---|---|---|
| uv 缓存 | 调 `uv cache prune`（清无效条目）/「深度清理」= `uv cache clean` | 不碰任何 venv；prune 默认，clean 需二次确认 |
| trace 库 | 按项目列出 `<hash>.db` + 大小，单项删除；「全部清除」需二次确认 | 重新运行脚本即重新采样 |
| WebView2 数据 | 清 `<data_root>\webview` 下的 Cache/Code Cache/GPUCache（**保留**登录态相关文件） | 只删缓存子目录，不整删 |
| 日志 | 清空 logs 目录（保留当前文件） | — |

### P2 数据落位：首启提示 + 迁移向导（治本）

**落位机制（跨平台指针文件，无注册表 / 环境变量写入）**：

- 数据根解析三级：`MONTAURI_DATA_ROOT` 环境变量（仅开发/测试/高级用户，应用自身不写入）
  → **数据根指针文件** → 平台默认（`%LOCALAPPDATA%\Montauri` 等，见 data-directory-layout-v2.md §3.1）。
- 指针文件位于平台标准配置目录（Windows `%APPDATA%\Montauri\data-root`、
  Linux `~/.config/montauri/data-root`、macOS `~/Library/Application Support/Montauri/data-root`），
  内容 = 数据根绝对路径，仅几十字节，落在系统盘无妨；大体积数据按指针指向落盘。
- 弃用 `setx`（Windows-only，且对当前进程树不生效——曾导致重启后重复弹首启提示）。

#### P2-a 首次运行落位提示（onboarding）

首启即给用户选择数据存放位置的机会，而不是事后才去迁移：

**触发条件**（三个同时满足才弹，避免重复打扰）：

1. 指针文件不存在；
2. 数据根内无 `config/settings.json`（真正的首次运行）；
3. 无迁移中断标记。

**流程**：

1. 首启弹一次性对话框：「选择数据存储位置」，默认选项 = 平台默认根（直接进入应用），
   备选 = 「自定义位置…」（目录选择器）；
2. 选默认 → 写指针文件指向默认根（防重复弹窗），直接进入；
3. 选自定义 → 后端命令 `set_data_root(path)`：
   - 创建目标目录并校验可写（校验失败 → 报错留在默认位置，不半途而废）；
   - 写数据根指针文件 → 提示「重启后生效」并自动重启（首启数据根内尚无数据，无需搬移）；
4. 设置 → 存储页常显当前数据根路径（防遗忘，见风险表）。

**重启语义说明**：指针文件落盘后任何新进程都能读到；首启数据根内还没有用户数据，重启成本≈0，
不做进程内热切换（`OnceLock` 已解析 + webview 已落盘，热切换徒增复杂度）。

**与 P2-b 的关系**：首启提示解决「一开始就放对地方」；后续想换盘走 P2-b 迁移向导（含搬数据）。
两者复用同一组后端命令（校验 / 指针 / 标记）。

#### P2-b 迁移向导（事后换盘）

设置面板「存储」页顶部提供「迁移数据到其他盘」：

1. 用户选目标盘目录（如 `D:\montauri-data`）；
2. 向导执行：整目录**复制**到目标（逐项容错，跳过清单写入 `.migration-skipped.txt`）→
   重写数据根指针文件 → 提示重启 Montauri；
3. 迁移中断保护：先写 `<目标>\.migration-in-progress` 标记，启动时检测到则提示续迁/回退；
4. 旧目录不自动删除（可能有被占用的日志文件），重启确认后由用户手工删除。

**uv 目录不随迁**：`UV_CACHE_DIR` / `UV_TOOL_DIR` 是用户自有环境变量（工具所有权原则），
Montauri 不代写不代搬；需要重定向时由用户自行设置（P0 文档化）。

---

## 3. 实施顺序与代码触点

| 阶段 | 内容 | 触点 |
|---|---|---|
| P0 | README + v2 文档补「磁盘占用」小节 | 纯文档 |
| P1 | 存储页：占用可视化 + 一键清理 | 新 `storage_cmds.rs`（`storage_usage` / `clean_traces` / `clean_webview_cache` / `uv_cache_prune`）；`settingsPanel.ts` + `index.html` 新分类 |
| P2 | 首启落位提示 + 迁移向导 | `util.rs` 增数据根指针文件解析；`storage_cmds.rs` 增 `set_data_root`（校验 + 写指针）、`migrate_data_root`（复制 + 重写指针 + 标记续迁）；前端首启 onboarding 弹窗 + 向导流；设置面板常显当前数据根 |

**验证基准**：bench 项目集装满典型依赖后，迁移到 D: 前后对比
`%LOCALAPPDATA%` 与 `%LOCALAPPDATA%\uv` 体积，目标：C 盘 Montauri 相关占用（含 uv）降到 <200 MB
（仅剩 runtime + config + logs）。

## 4. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 用户设置了 `MONTAURI_DATA_ROOT` 后忘记，重装系统后找不到数据 | 设置面板常显当前数据根路径；首启提示弹窗记下用户的选择；迁移向导完成页提示备份建议 |
| 首启弹窗打扰「只想快速开始」的用户 | 默认选项 = 默认位置一键进入，选自定义才多两步；触发条件保证只弹一次 |
| 迁移中 kill 进程导致目录搬一半 | `.migration-in-progress` 标记 + 启动检测续迁；copy 逐项容错并记录跳过清单 |
| 清理按钮误删用户还想留的东西 | 全部逐项确认 + 二次确认；只提供可再生项 |
| 指针文件丢失/损坏（配置目录被清） | 回落平台默认根；数据仍完整保存在自定义根（可重新写指针找回） |
| 卸载「删除数据」漏删已迁移的自定义根 | 卸载钩子按序清理：默认根 → 指针所指根（读 `%APPDATA%\Montauri\data-root`，含盘根护栏）→ 指针目录。环境变量 `MONTAURI_DATA_ROOT` 属用户自有配置，应用与卸载器均不写不删 |
