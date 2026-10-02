# SQLite 数据库工具 · 开发文档（B3）

> 版本：v1.2 · 日期：2026-10-02 · 状态：**PR-1 ~ PR-4 已实施并复核，§10.3 真机手测已完成**（发现并修复 2 个真机 bug；代码未提交，待复核）
> 上游：候选池见 `docs/improvement_and_roadmap_report.md` §3 B3；PR 级总览见 `docs/toolbox_dev_plan.md` §4。
> 冲突时以 `docs/python_ide_dev_plan_v2.md` 为准并反馈修订本文档。
> **如何使用**：第 3 章是交互设计（照做），第 4~6 章是数据契约与实现（照抄），第 7~8 章是词条与样式（照填），第 9 章是排期 + **逐 PR 实施记录**（照走 / 复核），第 10~11 章是测试与门禁（照验）。第 14 章附录 A 是代码位置速查。
> 事实底座：全部落点于 2026-10-02 回代码核实（含 file:line）。HEAD `44c85ea`，分支 `master`。
> **复核入口**：§9.1 / §9.2 / §9.3 / §9.4 是四个 PR 的实施记录；§9.4 末尾列了 e2e 抓到的两个真 bug 与修法；§10.3 是**尚未执行**的真机手测清单。

---

## 1. 一页结论

| 项 | 结论 |
|---|---|
| 形态 | 侧栏新增「数据库」视图（Activity Bar 第 7 项）：**工具条 + 对象树 + SQL 编辑器 + 结果网格** 四段竖排 |
| 引擎 | Rust `rusqlite`（`bundled` 特性，自带 SQLite，免系统库）——**已定案**（见 §2.1） |
| 权限 | **默认只读打开**（`SQLITE_OPEN_READ_ONLY`）；写语句需连接开启「可写」+ 弹确认框 |
| 新依赖 | `rusqlite`（Rust，仅此一项；前端零新依赖） |
| 量级 | **8~10 人日，4 个 PR** |
| 最大风险 | `bundled` 需在 CI（windows-latest / MSVC）编译 SQLite C 源码 → **PR-1 只做"加依赖 + 空壳 + 跑 CI"，风险前置** |
| 交付状态 | ✅ **PR-1 ~ PR-4 全部实施并复核**（tsc 0 错 / vitest 994 / cargo db_ 33 / e2e 59 / 真机 §10.3 13 项全 PASS）；⏳ CI 待推送后观察；**未提交代码** |

---

## 2. 选型决策

> **2026-10-02 产品负责人拍板：① 引擎 = A · rusqlite(bundled)；② 接受默认只读。**
> 以下两节保留论证过程供回溯；方案 B 与"默认可写"**已否决**，不再作为候选。

### 2.1 引擎：rusqlite vs Python 求值桥

| 方案 | 优点 | 缺点 |
|---|---|---|
| **A · rusqlite(bundled)（推荐）** | 原生速度；**可取消**（`Connection::interrupt_handle()`）；可分页；可只读打开；不依赖解释器 | 新依赖；首次编译 +1~3 分钟；包体积 +1~2 MB；CI 需能编过 |
| B · `py_eval` + Python `sqlite3` | 零新依赖；Python 标准库自带 | 每查询 spawn 进程（126ms 直连 / 475ms `uv run`）；**取消只能杀进程**；结果经 stdin/stdout JSON 有上限；无长事务 |

**已定案：A**。数据库工具是交互式场景（浏览表、翻页、点字段），方案 B 的往返延迟与不可取消会直接毁掉体验。
**应急回退**（仅在 PR-1 的 CI 编译实在过不去时启用）：切方案 B，**前端视图层与数据契约（第 4 章）完全不变**，只替换 `db_cmds.rs` 实现与 `sqliteView.ts` 的 `invoke` 目标。

### 2.2 写权限：默认只读（已定案）

- `db_open` 默认 `SQLITE_OPEN_READ_ONLY`；
- 连接级「可写」开关（工具条锁形图标），开启后以 `READ_WRITE | CREATE`（**不 CREATE**：不存在的路径直接报错，避免误建空库）；
- 写语句执行前弹确认框（`dialog.ts` 的 `openConfirm`，与全库自绘弹窗一致），框内显示将执行的 SQL 前 200 字符 + 影响范围提示；
- 写执行结果提示「影响 N 行」。

### 2.3 SQL 编辑器：第二 Monaco 实例（推荐）

| 方案 | 说明 | 取舍 |
|---|---|---|
| **A · 侧栏内第二 Monaco 实例（推荐）** | 照 `splitEditor.ts:47-55` 范式懒创建、常驻复用 | 与主编辑器解耦：**不进 tab 模型、不触发 LSP/诊断链**（虚拟路径污染 LSP 是 diff tab 迁移时踩过的坑）；第二实例已有先例 |
| B · 编辑区 tab（`kind:"sql"`） | 复用主实例，空间大 | 需扩展 Tab 模型、`activateTab`/`closeTabSilent` 分支、session 快照排除、LSP 跳过，改动面大得多 |

**推荐 A**。已知取舍：侧栏宽度有限（默认 `--sidebar-w`），故 §3.1 规定三段可折叠 + 窄栏降级规则；侧栏宽度已可拖拽（`layout.ts:73 restoreLayout` / `:124 wireSplitters`），用户可自行拉宽。

---

## 3. 交互设计

### 3.1 布局与区域

```
┌ #view-database ──────────────────────────────────────────────┐
│ #db-toolbar                                                   │
│  [连接 ▾ app.db        ] [＋] [🗑] [🔒可写] [⟳] [⋯]            │  ← 40px，固定
├─ #db-tree-wrap（可折叠，默认展开）───────────────────────────── │
│  ▾ 表 (12)                                                    │  ← flex 1，min 120px
│    ▾ users  1,543 行                                          │
│        id INTEGER PK NN                                       │
│        name TEXT NN                                           │
│  ▸ 视图 (2)                                                   │
│  ▸ 索引 (5)                                                   │
├─ #db-sql-wrap（可折叠，默认展开）────────────────────────────── │
│  #db-sql-host  ← Monaco 小实例（sql 语言）                     │  ← 默认 140px
│  [▶ 执行 Ctrl+Enter] [执行全部] [历史 ▾]                       │
├─ #db-result-wrap（不可折叠，占剩余）───────────────────────────│
│  #db-result-status：200/1,543 行 · 12 ms · 只读                │  ← 24px
│  #db-result-grid：列名 sticky + 行号列                         │  ← flex 1，横向滚动
│  [← 第 1/8 页 →] 每页[200 ▾]  [导出 CSV] [取消]                │  ← 32px
└───────────────────────────────────────────────────────────────┘
```

**折叠与窄栏规则**（必须实现，否则窄侧栏不可用）：
- 工具条下方三段，段头带折叠箭头（`aria-expanded` 与 `.collapsed` 同源切换，沿用 UI-16 纪律）；
- 侧栏宽 < 320px 时：网格自动只渲染**前 3 列 + 横向滚动条**，状态条改显示 `3/12 列`；
- 结果为空/未查询时，网格区显示 `emptyState`（`util.ts:116`）。

### 3.2 连接管理（工具条）

| 控件 | 行为 |
|---|---|
| 连接下拉 | 列出全局连接（`~/.opencharm/config/db_connections.json`），格式 `<文件名> · <父目录>`；切换即 `db_close` 旧连接 + `db_open` 新连接 + 刷新树；**切换是切换不是叠加**（同时只活一个，避免多连接状态复杂度） |
| ＋ 添加 | `pick_file`（`fs_cmds.rs:224`，带后缀过滤 `.sqlite/.sqlite3/.db/.db3`）→ `validate_db_path` 校验 → `db_open` → 追加到全局列表并持久化 |
| 🗑 移除 | 仅从列表移除（不删文件）；确认框（自绘 `openConfirm`）；若移除的是当前连接 → 关闭连接 + 清空树与结果 |
| 🔒 可写 | `aria-pressed` 切换；关闭态（默认）显示锁形 + tip「只读模式（点击允许写入）」；开启时 tip 改「可写模式（点击回到只读）」，且**树与工具条加一条淡色警示条**（`#db-write-banner`，文案见 §7） |
| ⟳ 刷新 | 重新 `db_list_objects`（不重连）；行数（`COUNT(*)`）一并刷新 |
| ⋯ 更多 | 菜单：查看建表 DDL / 复制文件路径 / 在数据目录打开（走 `open_external` 或系统文件管理器）/ 关闭连接 |

**状态机**（连接下拉的显示态）：

| 状态 | 下拉显示 | 树区 | 结果区 |
|---|---|---|---|
| 无工作区 | `—`（禁用） | 空态「未打开工作区」 | 空 |
| 有工作区、无连接 | `— 无连接 —` | 空态「没有数据库连接」+ 提示「点 ＋ 选择 .sqlite 文件」 | 空 |
| 打开中 | `打开中…` | 加载态 | 空 |
| 已连接 | 文件名 | 对象树 | 上次结果或空态 |
| 打开失败 | 回退到上一个有效连接 | toast 错误 + 保留原树 | 不变 |

### 3.3 对象树

- 三组：`表 (n)` / `视图 (n)` / `索引 (n)`，按 `METHOD_ORDER` 同款的固定组序（表 → 视图 → 索引）；组内按名**字典序**；
- 表节点展开显示列：`列名 类型 [PK] [NN]`（NN=NOT NULL），类型取 `PRAGMA table_info` 的 `type`；
- 表节点右侧显示行数（`rowCount`，异步填充，加载中显示 `…`）；
- **单击表节点**：展开/折叠列；**双击表节点**：执行 `SELECT * FROM "t" LIMIT <pageSize>` 并把结果填入网格（最常用路径，必须顺手）；
- 右键菜单（表/视图节点）：查看前 100 行 / 查看 DDL / 复制表名 / 复制 `SELECT * FROM …`；
- 索引节点：只显示名字 + `ON 表(列)`，无子项。

### 3.4 SQL 编辑器

- 语言 `sql`（`util.ts:60 languageOf` 已映射 `sql:"sql"`，Monaco 自带高亮）；
- **懒创建**：首次展开（或首次需要执行）时创建，常驻不销毁（照 `splitEditor.ts:8` 注释的"G-1：不随开随弃"纪律）；
- 键位：`Ctrl+Enter` 执行**当前语句**（`;` 分隔，按光标位置定位当前语句）；`Ctrl+Shift+Enter` 执行全部（按 `;` 拆分逐条）；
- 占位提示（空 model 时）：`-- Ctrl+Enter 执行当前语句；
- **内容持久化**：编辑内容随连接 id 存全局 `db_connections.json` 的 `sql` 字段（切连接恢复各自的 SQL；防丢工作成果）；
- 历史下拉：`db_history`（每连接最近 20 条），点击回填编辑器；
- 设置保存后同步 options（照 `splitEditor.ts:130 refreshSplitEditorOptions` 的范式暴露 `refreshDbSqlOptions()`）。

### 3.5 结果网格

| 项 | 规则 |
|---|---|
| 列 | 表头 sticky，显示列名 + 声明类型（灰字）；点击列名**暂不排序**（v1 不做，排序靠改 SQL） |
| 行号列 | 固定第一列（`#`），显示**绝对行号**（`offset + i + 1`），`tabular-nums` 对齐 |
| 单元格 | `NULL` → 斜体灰字 `NULL`；BLOB → `<blob 2.4 KB>`；空串 → 淡占位 `""`；超 200 字符 → 截断 + `title` 全量 + 点击展开（点击单元格 → 下方 `#db-cell-detail` 显示完整值，可复制） |
| 分页 | 每页 `page_size`（设置项，默认 200，可选 100/200/500/1000）；SQL 由 Rust 侧追加 `LIMIT/OFFSET`（**仅当用户 SQL 未自带 LIMIT 时**——判定见 §5.3） |
| 状态条 | `已显示/总数 行 · 耗时 ms · 只读/可写`；截断时追加提示 |
| 取消 | 查询期间按钮变「取消」→ `db_cancel`；取消成功后 toast「已取消」并保留上次结果 |
| 导出 CSV | 导出**当前查询的完整结果**（重新以 `LIMIT 全部上限 10000` 跑一次，或直接用已缓存的当前页？——**定义：导出当前 SQL 的前 10000 行**），走 `save` 对话框（`@tauri-apps/plugin-dialog`）选路径 → `fs_cmds::write_file`；UTF-8 BOM 兼容 Excel；**导出前不弹确认**（可撤销、非破坏性） |

### 3.6 空态 / 加载态 / 错误态（逐条）

| 场景 | 呈现 |
|---|---|
| 无工作区 | `emptyState("database", "未打开工作区", "打开工作区后可连接 SQLite 数据库")` |
| 无连接 | `emptyState("database", "没有数据库连接", "点 ＋ 选择 .sqlite / .db 文件")` |
| 树加载中 | 树区显示 `加载中…`（不用 spinner，沿用 `endpoints.scanning` 的同款文案态） |
| 树为空 | `emptyState("database", "没有表", "该数据库没有表 / 视图 / 索引")` |
| 查询中 | 状态条 `执行中…`，取消按钮可用，网格保留上次结果并降透明度（与库支持求值桥的 `is-stale` 同款处理） |
| 查询失败 | 状态条红色 + 文本 `查询失败：{error}`；网格保留上次结果；toast 一次 `toastFail` |
| 只读模式执行写语句 | **不发 IPC**，状态条提示 + toast「只读模式下不允许写操作（点 🔒 开启可写）」 |
| 写语句确认 | `openConfirm("确认执行写操作", "即将执行：\n<SQL 前 200 字符>\n\n此操作不可撤销。", { danger: true })` |
| 结果为空集 | `emptyState("table", "没有数据", "该查询返回 0 行")` |
| 连接打开失败 | toast `打开数据库失败：{error}`，下拉回退 |

### 3.7 键位与命令面板

| 入口 | id | 默认键 | 说明 |
|---|---|---|---|
| 命令面板 | `database.openConnection` | — | 等同 ＋ |
| 命令面板 | `database.newQuery` | — | 切到数据库视图 + 聚焦 SQL 编辑器 |
| 编辑器内 | — | `Ctrl+Enter` / `Ctrl+Shift+Enter` | **不进键位表**（Monaco 实例内 action，非全局；与 Double Shift、Ctrl+F 同属"固定键位"类别，见 `dx_features_backlog.md` §5） |

> 因此本功能**不新增 `keybindingDefaults.ts` 条目**，无需三处同步与漂移锁。

### 3.8 设置项

| 字段 | 类型 | 默认 | 位置 |
|---|---|---|---|
| `db_page_size` | number | `200` | 设置面板「工具 ▸ 数据库」（新建分组，见 §6.5） |
| `db_warn_on_write` | boolean | `true` | 同上 |

接线三步（严格照做，见 §6.5）：`state.ts` 接口 + `DEFAULT_SETTINGS`；`settingsPanel.ts` 元素声明 / apply 回填 / save 收集；`index.html` 控件。前端读取一律 `settings.db_page_size ?? 200` 形式（兼容旧配置），Rust `Settings::default` 同步。

### 3.9 持久化

| 数据 | 位置 | 由谁写 |
|---|---|---|
| 连接列表（含 SQL 草稿、查询历史、可写标志） | **全局** `~/.opencharm/config/db_connections.json` | Rust `db_cmds`（`db_connections_load` / `db_connections_save`） |
| 当前选中的连接 id | 前端内存 + 工作区会话恢复不做（v1） | — |
| 展开/折叠状态 | 前端 localStorage `opencharm.db.sections` | 前端 |

> 为什么连接列表放**全局**而非工作区 config：数据库文件通常在项目外（用户数据目录、爬虫产物），与工作区生命周期无关。工作区 config（`env_cmds.rs:85 workspace_config_path`）仅用于项目相关配置。

---

## 4. 数据契约（Rust ↔ TS，逐字段）

```rust
// src-tauri/src/db_cmds.rs
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DbConnection {
    pub id: String,          // "db-1" 自增；全局唯一（不按窗口隔离，连接是全局数据）
    pub path: String,        // 绝对路径
    pub name: String,        // 文件名（basename）
    pub writable: bool,      // 是否可写（默认 false）
    pub sql: String,         // SQL 草稿
    pub history: Vec<String>,// 最近 20 条
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbColumn { pub name: String, pub decl_type: String, pub pk: bool, pub not_null: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbObject {
    pub name: String,
    pub kind: String,        // "table" | "view" | "index"
    pub sql: Option<String>, // DDL（sqlite_master.sql）
    pub row_count: Option<i64>, // 表/视图的行数（索引为 None）
    pub columns: Option<Vec<DbColumn>>, // 表/视图的列（索引为 None）
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbQueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>, // NULL = None；一律字符串化，避免 JSON 类型歧义
    pub total: i64,          // 满足条件的总行数（用于分页）；未知时 = rows.len()
    pub offset: i64,
    pub truncated: bool,     // 是否被硬上限截断
    pub elapsed_ms: u64,
    pub affected: Option<i64>, // 写语句影响行数；读语句 None
}
```

```ts
// shell/src/sqliteView.ts（与 Rust 字段同名 camelCase）
export interface DbConnection { id: string; path: string; name: string; writable: boolean; sql: string; history: string[]; }
export interface DbColumn { name: string; declType: string; pk: boolean; notNull: boolean; }
export interface DbObject { name: string; kind: "table" | "view" | "index"; sql?: string; rowCount?: number; columns?: DbColumn[]; }
export interface DbQueryResult {
  columns: string[];
  rows: (string | null)[][];
  total: number;
  offset: number;
  truncated: boolean;
  elapsedMs: number;
  affected: number | null;
}
```

**错误码**（`Result<T, String>` 的 Err 文本前缀，供 `localizeBackendError` 映射）：

| 前缀 | 含义 | 前端文案 |
|---|---|---|
| `DbInvalidPath:` | 路径校验失败 | 文件路径无效：{detail} |
| `DbLocked:` | 打开被锁 / 已由其它进程独占 | 数据库被占用：{detail} |
| `DbReadOnly:` | 只读模式下执行写语句 | 只读模式下不允许写操作 |
| `DbSqlError:` | SQLite 执行错误 | SQL 错误：{detail} |
| `DbNoConnection:` | 连接 id 不存在（可能已被关闭） | 连接已关闭，请重新选择 |
| `DbTooLarge:` | 结果超硬上限 | 结果过大，已截断至 {n} 行 |
| `DbCancelled:` | 查询被用户取消（SQLite interrupt） | 已取消 |
| `DbIo:` | 连接列表读写失败 | 连接列表读写失败：{detail} |

---

## 5. Rust 侧设计（`shell/src-tauri/src/db_cmds.rs`，新增）

### 5.1 命令清单

| 命令 | 签名 | 说明 |
|---|---|---|
| `db_open` | `(window: WebviewWindow, path: String, writable: bool) -> Result<DbConnection, String>` | 校验 → 打开 → 生成/复用连接记录 → 存表 |
| `db_close` | `(id: String) -> Result<(), String>` | 摘除并 drop（中断进行中的查询） |
| `db_list_objects` | `(id: String) -> Result<Vec<DbObject>, String>` | `sqlite_master` + `PRAGMA table_info` + `index_list` + `COUNT(*)` |
| `db_query` | `(id: String, sql: String, limit: u32, offset: u32) -> Result<DbQueryResult, String>` | 见 §5.3 |
| `db_cancel` | `(id: String) -> Result<(), String>` | 置 `AtomicBool` + `InterruptHandle::interrupt()` |
| `db_ddl` | `(id: String, name: String) -> Result<String, String>` | 取 `sqlite_master.sql` |
| `db_connections_load` | `() -> Result<Vec<DbConnection>, String>` | 读全局 json（缺失/损坏 → `[]`，绝不 panic） |
| `db_connections_save` | `(list: Vec<DbConnection>) -> Result<(), String>` | 写全局 json（原子写：临时文件 + rename） |

> `pick_file` 已有（`fs_cmds.rs:224`），不新增；导出 CSV 走已有 `fs_cmds::write_file`，不新增。

### 5.2 状态与并发

```rust
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::sync::LazyLock;
use rusqlite::Connection;

struct DbOp {
    conn: Arc<Mutex<Connection>>,
    interrupt: rusqlite::InterruptHandle,
    cancel: Arc<AtomicBool>,
    writable: bool,
}
static DB_OPS: LazyLock<Mutex<HashMap<String, DbOp>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
```

- **不用 `PerWindow`**：连接是全局数据（用户数据文件不随窗口隔离），且同时最多一个活跃连接；命令仍需接收 `window` 参数以备用（若后续要发事件则 `emit_to(window.label(), …)`）。
- 查询一律放 `tauri::async_runtime::spawn_blocking`（与 `lib_cmds.rs:173` 同款），避免阻塞主线程。
- 取消：`db_cancel` 置 `cancel` 标志 + 调 `InterruptHandle::interrupt()`（API 实为 `Connection::get_interrupt_handle()`，rusqlite 0.32），让 SQLite 在下个安全点中断（**不保证即时**，UI 上"取消"按钮点击后状态条改「取消中…」，中断完成后才恢复）；被中断的查询由 `map_sql_err` 映射为 `DbCancelled:`。
- **退出清理**：`pub fn db_stop_for_exit()` 遍历 `DB_OPS` 全部 drop；在 `lib.rs:305-319` 的 `RunEvent::Exit` 分支追加一行 `db_cmds::db_stop_for_exit();` 并同步注释里的清单元组文本。

### 5.3 `db_query` 执行流程

1. 取 `DbOp`；若 id 不存在 → `DbNoConnection:`
2. `classify_sql(&sql)`：`Read` / `Write` / `Unknown`（**`Unknown` 按 `Write` 保守处理**）
3. 若 `Write` 且 `!op.writable` → `DbReadOnly:`（**前端也会前置拦截，这里是后端硬闸门**）
4. 若 `Write`：`stmt.execute()` → `affected = changes()` → 返回空 rows
5. 若 `Read`：
   - 用户 SQL 未自带 `LIMIT`（尾部正则 `(?is)\blimit\s+\d+` 检测）→ 追加 ` LIMIT {limit} OFFSET {offset}`；自带 LIMIT 则**不追加**（尊重用户意图，`offset` 忽略）
   - 逐行读取：每列 `row.get::<_, Option<String>>()`（**BLOB 不读内容**，用 `column_type` 判定后填 `<blob N>`；N 来自 `Value::Blob` 长度，需改用 `row.get_raw` 分支处理）
   - 硬上限：`HARD_MAX_ROWS = 10_000`，超出置 `truncated = true`
   - `total`：再跑一次 `SELECT COUNT(*) FROM (<sql 去掉 LIMIT>)`；失败或超时则退化为 `rows.len()`（**不得因此让整次查询失败**）
6. 计时 `elapsed_ms`，返回结果

### 5.4 纯函数（单测目标，必写）

```rust
fn validate_db_path(path: &str) -> Result<PathBuf, String>          // 非空、绝对、canonicalize、后缀白名单、是文件
fn classify_sql(sql: &str) -> SqlKind                                // Read / Write / Unknown
fn has_limit(sql: &str) -> bool                                      // 尾部 LIMIT 检测
fn split_statements(sql: &str) -> Vec<String>                        // "执行全部"用；引号内的 ; 不算
fn truncate_cell(s: &str, max: usize) -> String                       // 单元格截断（前端同名，双端一致）
fn blob_label(bytes: usize) -> String                                 // "<blob 2.4 KB>" 格式化
```

`classify_sql` 的对抗样本（**必须覆盖**，参考 Pydantic 复核教训：文本解析的 bug 全在盲区）：

| 输入 | 期望 | 说明 |
|---|---|---|
| `SELECT * FROM t` | Read | 基线 |
| `-- 注释\nSELECT 1` | Read | 跳过行注释 |
| `/* DELETE FROM t */ SELECT 1` | Read | 跳块注释 |
| `SELECT '; DROP TABLE t;'` | Read | **字符串内的 `;` 不拆分、不判写** |
| `select 1` | Read | 大小写不敏感 |
| `WITH x AS (...) DELETE FROM t` | Write | CTE 后跟写语句 |
| `PRAGMA table_info(t)` | Read | PRAGMA 读类 |
| `PRAGMA journal_mode=WAL` | Write | PRAGMA 写类（**按写处理最安全**） |
| `  \n\t  ` | Unknown | 空语句 |

### 5.5 测试（Rust）

文件末尾 `#[cfg(test)] mod tests`（照 `fs_cmds.rs:2639` 范式），tmpdir 用 `SystemTime::now().duration_since(UNIX_EPOCH).nanos` 命名。

计划用例（≥15）：
- `validate_db_path`：正常 / 相对路径 / 不存在 / 目录 / 后缀不在白名单 / 空串（6）
- `classify_sql`：上表 9 条（9）
- `has_limit`：有 / 无 / 字符串内 `"limit 1"`（3）
- `split_statements`：多语句 / 字符串内 `;` / 末尾无 `;`（3）
- `truncate_cell` / `blob_label`（3）
- 集成（需 feature 或 `#[ignore]`）：建内存库 → 建表 → 插入 → 查询 → 只读拒写 → 取消（若 CI 可跑则不加 ignore）

---

## 6. 前端设计

### 6.1 模块划分

| 文件 | 职责 | 行数预估 |
|---|---|---|
| `shell/src/sqliteView.ts`（新） | 视图主体：DOM 构建、连接管理、树、执行编排、分页、导出 | ~600 |
| `shell/src/sqliteGrid.ts`（新） | **纯渲染**：网格 DOM、单元格格式化、分页条；无 `state`/无 invoke 依赖，可单测 | ~200 |
| `shell/src/__tests__/sqliteView.test.ts`（新） | 纯函数单测（格式化/分页/状态文本） | — |

> **纪律**：`sqliteView.ts` 不得反向 import `main.ts`（循环 import 已由 TD-013 清零，禁止再引入）；需要 `openFile` 之类交叉能力一律走 handler 注入（照 `endpointView.ts:40-49`）。

### 6.2 DOM 结构（`index.html` 新增）

```html
<!-- Activity Bar：追加在 tab-debug 之后 -->
<button data-i18n-aria="activity.tabDatabase" data-i18n-tip="activity.tabDatabase"
        id="tab-database" class="activity-item" role="tab" aria-selected="false"
        aria-controls="view-database" aria-label="数据库" data-tip="数据库（SQLite）">
  <i class="codicon codicon-database" aria-hidden="true"></i>
</button>

<!-- 视图容器：追加在 #view-endpoints 之后 -->
<div id="view-database" class="sidebar-view hidden" role="tabpanel" aria-labelledby="tab-database"></div>
```

> `#view-database` 内容由 `initDbView()` 构建（照 `endpointView.ts:59-93` 的 `initEndpointView` 范式：`root.textContent = ""` → 逐段 createElement → append）。

内部 id 约定（**全部以 `db-` 前缀**，避免与既有 `#db-*` 冲突——开工前 grep 确认无冲突）：
`#db-toolbar` `#db-conn-select` `#db-add` `#db-remove` `#db-writable` `#db-refresh` `#db-more`
`#db-write-banner` `#db-tree-wrap` `#db-tree` `#db-sql-wrap` `#db-sql-host` `#db-run` `#db-run-all` `#db-history`
`#db-result-wrap` `#db-result-status` `#db-result-grid` `#db-pager` `#db-prev` `#db-next` `#db-page-size` `#db-export` `#db-cancel` `#db-cell-detail`

### 6.3 接线清单（逐文件，改哪一行）

| 文件 | 改动 | 参照 |
|---|---|---|
| `src/views.ts:5` | `SidebarViewId` 加 `"database"` | — |
| `index.html` | Activity Bar 按钮（在 `tab-debug` 后）+ `#view-database` 容器（在 `#view-endpoints` 后） | `index.html:91`（tab-todo 形态）、`:161`（view-todo 形态） |
| `src/main.ts` | ① `registerSidebarView({ id:"database", rootId:"view-database", tabId:"tab-database", onShow })`（在 debug 注册之后，`:2689` 附近）② `$("tab-database").addEventListener("click", …)`（`:2699` 附近）③ `initDbView()` 在 init 首部调用 ④ `setDbViewHandlers({...})` 注入（`openFile` 等）⑤ 命令面板两条（命令表在 `:1526-1570`）⑥ 设置保存后 `refreshDbSqlOptions()` | `main.ts:2653-2704`；`endpointView.ts:40-49` |
| `src/style.css` | 新增 `.db-*` 段（工具条/树/SQL 宿主/网格/状态条/分页条），**一律走 token** | 参考 `.todo-*` / `.ep-*` 段 |
| `src/state.ts` | `Settings` 加 `db_page_size` / `db_warn_on_write`（接口 `:117` 附近）+ `DEFAULT_SETTINGS`（`:190` 附近） | `state.ts:108-118`、`:128-191` |
| `src/settingsPanel.ts` | 元素声明（`:93` 区）+ apply 回填（`:630` 区）+ save 收集（`:770` 区）+ 新增「数据库」设置分组（index.html 同步） | — |
| `src/i18n/` | 新增 `database` 域（§7） | `locales/zh-CN/endpoints.ts` |
| `e2e/mocks/tauri-mock.js` | 加 `db_*` 桩（§10.2） | `:57 staticHandlers` |

### 6.4 状态管理（前端）

```ts
let connections: DbConnection[] = [];   // 全局连接列表（来自 db_connections_load）
let activeId: string | null = null;     // 当前连接
let objects: DbObject[] = [];           // 当前对象树
let result: DbQueryResult | null = null;// 当前结果
let page = 0;
let token = 0;                          // 刷新令牌：并发刷新旧结果不得覆盖新结果（照 endpointView.ts:55）
let querying = false;
let sqlEditor: MonacoApi.editor.IStandaloneCodeEditor | null = null;
```

- **刷新令牌**：每次 `refreshTree()` / `runQuery()` 前置 `const my = ++token`，回调后 `if (my !== token) return;`（照 `endpointView.ts:123`）。
- **连接切换**：`db_close(old)` → `db_open(new)` → 清空 `objects/result` → `refreshTree()`。
- **写语句拦截**：前端按同一套 `classifySql()`（TS 侧镜像实现，与 Rust 同源规则）判定；命中 `Write` 且连接不可写 → 不发 IPC，直接 toast（省钱也省一次往返）；命中 `Write` 且 `db_warn_on_write` → `openConfirm` 后再发。
- **SQL 草稿持久化**：编辑器 `onDidChangeModelContent` 防抖 500ms → 更新内存 `connections[i].sql` → 防抖 2s 调 `db_connections_save`。

### 6.5 设置面板分组

在设置面板新增一节「工具 ▸ 数据库」（若面板尚无"工具"大类，则挂在「编辑器」之外的**新建 `settings-section-tools`**，与既有 section 同构）：

```html
<div class="settings-row">
  <label data-i18n="settings.database.pageSize" for="settings-db-page-size">结果每页行数</label>
  <select id="settings-db-page-size">
    <option value="100">100</option><option value="200">200</option>
    <option value="500">500</option><option value="1000">1000</option>
  </select>
</div>
<div class="settings-row">
  <label data-i18n="settings.database.warnWrite" for="settings-db-warn-on-write">写操作执行前确认</label>
  <input id="settings-db-warn-on-write" type="checkbox" autocomplete="off" />
</div>
```

### 6.6 SQL 编辑器实例（`sqliteView.ts` 内）

```ts
function ensureSqlEditor(): MonacoApi.editor.IStandaloneCodeEditor {
  if (sqlEditor) return sqlEditor;
  // 注意：host 不能用 lazyEl Proxy（Monaco automaticLayout 会把容器喂给 ResizeObserver.observe()，
  // Proxy 不是真实 Element 会被原生 API 拒绝）——照 splitEditor.ts:23-25 的踩坑注释。
  sqlEditor = app.monaco.editor.create($("db-sql-host"), {
    automaticLayout: true,
    language: "sql",
    minimap: { enabled: false },
    lineNumbers: "off",
    scrollBeyondLastLine: false,
    ...handlers?.buildOptions(),   // 与主编辑器同源（字号/主题/连字）
  });
  sqlEditor.addAction({ id: "opencharm.dbRun", label: "执行当前语句",
    keybindings: [app.monaco.KeyMod.CtrlCmd | app.monaco.KeyCode.Enter], run: () => void runCurrent() });
  return sqlEditor;
}
```

- `refreshDbSqlOptions()`：`sqlEditor?.updateOptions(handlers?.buildOptions() ?? {})`（照 `splitEditor.ts:130`）。
- **不销毁**：切工作区/关视图只 `setModel(null)` + 隐藏；实例常驻（G-1 纪律）。

---

## 7. i18n（`database` 域，zh-CN 为真源）

按 `shell/tools/i18n/` 流程产出（`scan_ts.py` → `apply_ts.py --map data/database_map.json --ns database` → `gen_domain.py`），**勿手改生成文件**。下表是源码中应出现的文案与 key（供写码时对照；含 `{count}` 的会自动展开 `.one/.other`）：

| key | zh-CN | en-US |
|---|---|---|
| `activity.tabDatabase`（aria + tip） | 数据库（SQLite） | Database (SQLite) |
| `database.noWorkspace` | 未打开工作区 | No workspace open |
| `database.noWorkspaceHint` | 打开工作区后可连接 SQLite 数据库 | Open a workspace to connect SQLite databases |
| `database.noConnection` | 没有数据库连接 | No database connection |
| `database.noConnectionHint` | 点 ＋ 选择 .sqlite / .db 文件 | Click + to pick a .sqlite / .db file |
| `database.noObjects` | 没有表 | No tables |
| `database.noObjectsHint` | 该数据库没有表 / 视图 / 索引 | This database has no tables / views / indexes |
| `database.emptyResult` | 没有数据 | No rows |
| `database.emptyResultHint` | 该查询返回 0 行 | This query returned 0 rows |
| `database.opening` | 打开中… | Opening… |
| `database.listing` | 加载中… | Loading… |
| `database.executing` | 执行中… | Executing… |
| `database.cancelling` | 取消中… | Cancelling… |
| `database.cancelled` | 已取消 | Cancelled |
| `database.addAria` / `removeAria` / `refreshAria` / `moreAria` | 添加连接 / 移除连接 / 刷新 / 更多操作 | Add connection / Remove connection / Refresh / More actions |
| `database.writableTipOn` | 可写模式（点击回到只读） | Writable mode (click to lock) |
| `database.writableTipOff` | 只读模式（点击允许写入） | Read-only mode (click to allow writes) |
| `database.writeBanner` | 可写模式：写操作不可撤销 | Writable mode: writes cannot be undone |
| `database.readonlyBlocked` | 只读模式下不允许写操作 | Writes are not allowed in read-only mode |
| `database.writeConfirmTitle` | 确认执行写操作 | Confirm write operation |
| `database.writeConfirmBody` | 即将执行：{sql}（此操作不可撤销） | About to run: {sql} (cannot be undone) |
| `database.affected` | 影响 {count} 行 | {count} rows affected |
| `database.statusRows` | {shown}/{total} 行 | {shown}/{total} rows |
| `database.statusCols` | {shown}/{total} 列 | {shown}/{total} cols |
| `database.elapsed` | {ms} ms | {ms} ms |
| `database.truncated` | 结果已截断至 {count} 行 | Result truncated to {count} rows |
| `database.pageLabel` | 第 {page}/{pages} 页 | Page {page}/{pages} |
| `database.pageSize` | 每页 | Rows per page |
| `database.exportCsv` | 导出 CSV | Export CSV |
| `database.exportOk` | 已导出：{path} | Exported: {path} |
| `database.null` | NULL | NULL |
| `database.blob` | <blob {size}> | <blob {size}> |
| `database.cellDetailAria` | 单元格完整值 | Full cell value |
| `database.showRows` | 查看前 100 行 | Show first 100 rows |
| `database.showDdl` | 查看建表语句 | Show DDL |
| `database.copyName` | 复制表名 | Copy table name |
| `database.copySelect` | 复制 SELECT 语句 | Copy SELECT statement |
| `database.removeConfirm` | 移除连接「{name}」？（不会删除文件） | Remove connection "{name}"? (file is kept) |
| `database.failOpen` / `failList` / `failQuery` / `failCancel` / `failExport` / `failSave` | 打开数据库 / 加载对象 / 执行查询 / 取消查询 / 导出 CSV / 保存连接 | Open database / Load objects / Run query / Cancel query / Export CSV / Save connections |
| `database.cmdOpen` | 数据库：添加连接 | Database: Add connection |
| `database.cmdNewQuery` | 数据库：新建查询 | Database: New query |
| `settings.database.pageSize` / `warnWrite` | 结果每页行数 / 写操作执行前确认 | Rows per page / Confirm before write |

**后端错误码映射**：在 `src/i18n/backendError.ts` 追加 `DbInvalidPath` / `DbLocked` / `DbReadOnly` / `DbSqlError` / `DbNoConnection` / `DbTooLarge` / `DbIo` 七条（照既有条目形态）。

---

## 8. 样式（新增 `.db-*`，一律走 token）

| 类 | 用途 | 要点 |
|---|---|---|
| `.db-toolbar` | 工具条 | `display:flex; gap:6px; align-items:center;` 高度 40px，`border-bottom` 走 `--border-subtle`（视觉改造后）/ 当前 `--border` |
| `.db-conn-select` | 连接下拉 | `flex:1; min-width:0;`（防长路径撑破，必须 `min-width:0`） |
| `.db-write-banner` | 可写警示条 | 背景 `--color-warning` 系（走 token）+ 12px 文案 |
| `.db-section` / `.db-section-header` | 三段容器与折叠头 | 头 `role="button" tabindex="0"`，`.collapsed` 与 `aria-expanded` 同源（UI-16 纪律） |
| `.db-tree` / `.db-tree-group` / `.db-tree-item` / `.db-tree-col` | 对象树 | 复用 `.todo-item` / `.ep-*` 的行高与 hover 态，保持一致 |
| `.db-sql-host` | Monaco 宿主 | `height:140px; min-height:80px;` **不能用 lazyEl Proxy 喂给 Monaco**（见 §6.6） |
| `.db-grid` | 结果网格 | `display:grid; grid-auto-rows:26px; overflow:auto;`，表头 `position:sticky; top:0` |
| `.db-cell-null` / `.db-cell-blob` | 特殊单元格 | NULL 斜体 + `--fg-dim`；BLOB `--fg-dim` |
| `.db-num` | 行号列、耗时、行数 | `font-variant-numeric: tabular-nums`（对齐用） |
| `.db-pager` | 分页条 | 与 `.btn--sm` 同款 |
| `.db-stale` | 查询中的旧结果 | `opacity:.55`（与库支持求值桥 `is-stale` 同款） |

**纪律**：禁止裸色值 / 裸字号 / 裸圆角；深/浅双主题都要过。

---

## 9. 排期（8~10 人日，4 个 PR）

| PR | 标题 | 内容 | 量级 | 完成判据（DoD） |
|---|---|---|---|---|
| **PR-1** | 依赖与骨架 | `Cargo.toml` 加 `rusqlite`(bundled)；新建 `db_cmds.rs`（`validate_db_path` 纯函数 + `db_open`/`db_close` 空壳 + 连接列表读写）；`lib.rs` mod + handler + Exit 清理；`ci/versions.toml` 记录 | **1 人日** | **CI（windows-latest）`cargo build` 通过**；`cargo test` 新增 ≥6 例（路径校验正反、后缀白名单、目录、空串、符号链接）；记录构建耗时与包体积增量 |
| **PR-2** | 查询内核 | `db_list_objects` / `db_query` / `db_cancel` / `db_ddl`；`classify_sql` / `has_limit` / `split_statements` / `truncate_cell` / `blob_label` 纯函数；取消与中断；硬上限 | **2 人日** | `cargo test` 新增 ≥15 例（§5.4 全表对抗样本齐）；本地建内存库手测：建表→插入→查询→只读拒写→取消 |
| **PR-3** | 前端骨架 | `views.ts` + `index.html` + `main.ts` 注册；`initDbView()`：工具条 + 连接下拉 + 添加/移除/可写/刷新 + 对象树 + 空/加载/错误态；i18n `database` 域；`tauri-mock.js` 桩 | **2 人日** | `tsc --noEmit` 0 错；vitest 全绿，`sqliteView.test.ts` ≥6 例；e2e `shell/e2e/db/01-connections.spec.ts` ≥6 条（mock 桩）；Activity Bar 第七项可切、树能出、空态正确 |
| **PR-4** | 编辑器/网格/收尾 | SQL 编辑器实例（懒创建 + Ctrl+Enter + 历史 + 草稿持久化）+ 结果网格（分页/取消/导出 CSV/单元格详情）+ 右键快捷 + 设置项 + 真机冒烟 | **2~3 人日** | e2e `02-query.spec.ts` ≥8 条；真机：打开真实 `.sqlite` 浏览/翻页/只读拒写/导出 CSV 可打开；设置项即时生效；双主题截图 |

**建议节奏**（连贯推进，避免上下文切换成本）：

```
第 1 天   PR-1（加依赖 → 立刻跑一次 CI，不过就当天决策降级方案）
第 2-3 天 PR-2（Rust 内核 + 单测，含对抗样本）
第 4-5 天 PR-3（前端骨架 + i18n + mock + e2e）
第 6-8 天 PR-4（编辑器/网格/导出/真机）
第 9-10 天 缓冲（CI 编译慢、真机手测、回填交付记录）
```

**依赖与并行**：PR-1 → PR-2 → PR-3 → PR-4 严格串行（PR-3 的 mock 桩依赖 PR-2 的命令签名定稿）。i18n 词条可在 PR-2 期间先行准备（不阻塞）。

### 9.1 PR-1 实施记录（2026-10-02）

**决策落地**：引擎 = `rusqlite 0.32.1`（bundled）；写权限 = 默认只读。

**改动**：

| 文件 | 内容 |
|---|---|
| `shell/src-tauri/Cargo.toml` | 加 `rusqlite = { version = "0.32.1", features = ["bundled"] }` |
| `shell/src-tauri/src/db_cmds.rs`（新，约 330 行） | 数据契约 `DbConnection`；连接表 `DB_OPS`；纯函数 `validate_db_path` / `conn_id` / `parse_connections` / `serialize_connections`；薄 IO `load_connections` / `save_connections`（原子写：tmp + `remove_file` + rename，Windows rename 不覆盖）；命令 `db_open` / `db_close` / `db_connections_load` / `db_connections_save`；`db_stop_for_exit()` |
| `shell/src-tauri/src/lib.rs` | `mod db_cmds;` + handler 注册 4 条 + `RunEvent::Exit` 调 `db_stop_for_exit()`（注释清单元组加 `/ db`） |
| `ci/versions.toml` | `[shell]` 加 `rusqlite = "0.32.1"` / `libsqlite3-sys = "0.30.1"` |

**实测数据（本机，MSVC）**：

- `cargo check --offline`：**34.6 s 通过**（含 `libsqlite3-sys` 编译 SQLite C 源码）→ **bundled 的编译成本可接受，方案 A 成立**；
- `cargo test --offline`（全量）：**260 passed / 2 failed / 2 ignored**，其中 `db_cmds` **11 例全绿**；
- 2 项失败与本次改动无关（见下「环境发现」）。

**实施期的关键设计决定**（偏离初稿两处，均已就地注释）：

1. **连接 id 用路径哈希派生**（`db-{hash:016x}`，路径按 `to_lowercase` 归一）：初稿写「自增序号」，但序号在列表删除后会漂移、跨会话不稳定；哈希保证同路径同 id，重开自动保留该连接的 SQL 草稿与历史；
2. **连接表不按窗口隔离**：用普通 `static` 而非 `PerWindow`——数据库连接是全局数据，不属于「窗口私有的进程/监听状态」；`PerWindow` 保持它原本的语义边界。

**环境发现（重要，影响后续所有 Rust 侧施工）**：

- 本机 cargo 源配置为 USTC 镜像（`~/.cargo/config.toml` → `sparse+https://mirrors.ustc.edu.cn/crates.io-index/`），**本次施工期间该镜像不可达**（`curl 56 / CONNECT tunnel failed 502`），`cargo add` 直接失败；
- 但本机 `~/.cargo/registry/cache` 已缓存 `rusqlite-0.32.1` 及其全链路（`libsqlite3-sys-0.30.1`、`cc 1.4.x`、`hashlink`、`fallible-iterator`、`fallible-streaming-iterator`、`smallvec`、`bitflags`）→ **全程 `--offline` 完成，未改动任何 cargo 配置**；
- 连带影响：`--offline` 解析使 `Cargo.lock` 中两个既有包发生版本变动（`toml 0.8.2 → 0.8.23`、`proc-macro-crate 2.0.2 → 2.0.0` 降级）。二者均为构建期/配置解析依赖，全量测试未发现回归，但**推送前应复核 `Cargo.lock` 差异**；
- **CI（GitHub Actions）不受影响**（runner 无镜像替换配置，直连 crates.io）。

**2 项全量测试失败（与 PR-1 无关，登记待查）**：

| 用例 | 症状 | 性质判断 |
|---|---|---|
| `lib_cmds::tests::stdin_utf8_roundtrip_with_real_python` | `所有的管道范例都在使用中（os error 231）` | 真实 Python 子进程的 Windows 命名管道资源问题；`--test-threads=1` 单独复跑仍失败 → 非并发，属本机环境 |
| `git_cmds::tests::test_git_clone_roundtrip` | `# Test\r\n` vs `# Test\n` | 本机 `git config core.autocrlf = true`（已核实）；单独复跑仍失败，与 Git 功能无关 |

**排除「本次改动引入回归」的依据**（三条，可复核）：
1. 本次改动文件仅 4 个：`ci/versions.toml` / `Cargo.toml` / `Cargo.lock` / `lib.rs`（+ 新增 `db_cmds.rs`），**未触碰** `lib_cmds.rs` 与 `git_cmds.rs`；
2. 两个失败用例单独复跑（`--test-threads=1`）仍稳定失败，与并发无关；
3. CRLF 用例的失败直接对应本机 `core.autocrlf = true`，属环境配置。

**PR-1 DoD 达成情况**：✅ 依赖落地 ✅ 本机编译通过（34.6 s）✅ 单测 11 例 ✅ lib.rs 三处接线 ✅ Exit 清理 ✅ `ci/versions.toml` 记录；⏳ **CI 验证待推送后观察**（本机镜像不可达，无法本地模拟 runner 环境）。

### 9.2 PR-2 实施记录（2026-10-02）

**改动**：`db_cmds.rs` 扩展（PR-1 的 ~330 行 → ~1200 行含测试）。

| 内容 | 说明 |
|---|---|
| 纯函数 | `strip_noise`（注释/字符串去噪）、`top_level_words`（跳过括号块的顶层词）、`classify_sql`、`has_limit`、`strip_trailing_limit`、`split_statements`、`truncate_cell`、`blob_label`、`quote_ident` |
| 命令 | `db_list_objects`（表→视图→索引 + 列信息 + 行数）、`db_query`（读写分流 + 分页 + 硬上限 10000）、`db_cancel`（`get_interrupt_handle().interrupt()`）、`db_ddl` |
| 并发模型 | 全部走 `tauri::async_runtime::spawn_blocking`（照 `lib_cmds.rs:171 py_eval` 范式）；`DbOp` 改 `Arc<DbOp>` 存放，`get_op` 返回 Arc 快照供锁外使用 |
| 错误映射 | `map_sql_err` 把 SQLite interrupt 映射为 `DbCancelled:` |

**实施期的关键设计修正（两处，均为正确性/安全性问题）**：

1. **`WITH ... DELETE` 必须判为写**：初稿按「首词」判定，`WITH x AS (SELECT 1) DELETE FROM t` 会得到 `Read`——在**可写连接**上会绕过写确认框，属安全缺陷。修正为：`top_level_words` 先剔除所有括号块（CTE 体、子查询内的关键词不决定性质），再对 `WITH` 跳过 `[RECURSIVE]` 与逐个 `name AS` 词对，对**主语句**判定。新增 4 条对应用例（含 `WITH RECURSIVE`、多 CTE）。
2. **`Connection::get_interrupt_handle()`**（非 `interrupt_handle()`）——rusqlite 0.32 的实际 API 名，编译期发现。

**测试与并发（两个踩坑，均已修）**：

- 全量 `cargo test --offline db_`：**32 passed / 0 failed**（纯函数 22 例 + 集成 10 例），耗时 5.5 s；
- **坑 1 · 临时文件并发冲突**：`save_connections` 的 tmp 文件名固定为 `db_connections.json.tmp`，多个集成用例并行保存时互相踩（A 写 tmp → B 覆盖 tmp → A rename 找不到文件 → `DbIo: os error 2`）。修复：tmp 名加纳秒后缀。
- **坑 2 · 全局连接列表的测试竞态**：集成用例共用同一份 `~/.opencharm/config/db_connections.json`，并行会丢更新。修复：`tests` 内加 `TEST_LOCK: Mutex<()>` 串行锁（`test_guard()`），9 个集成用例统一持有；纯函数用例不受影响。
- **坑 3 · 取消用例不稳定**：初版用 3^8 笛卡尔积（6561 行）做慢查询，SQLite 瞬间跑完导致取消窗口不足而失败。修复：改 `WITH RECURSIVE` 生成 500 万行 + `started` 原子标志消除「线程未启动即取消」的竞态 + 50ms 等待。

**PR-2 DoD 达成情况**：✅ 4 个命令 ✅ 8 个纯函数 ✅ 对抗样本用例齐（注释/块注释/字符串内分号与关键字/PRAGMA 读写分家/CTE 前缀/大小写/空白）✅ 只读硬闸门 ✅ 可取消 ✅ 分页与硬上限 ✅ 集成用例覆盖真实 SQLite 文件。

### 9.3 PR-3 实施记录（2026-10-02）

**改动**：前端骨架落地（视图注册 → 连接管理 → 对象树 → i18n/mock/e2e）。

| 文件 | 内容 |
|---|---|
| `shell/src/sqliteGrid.ts`（新，约 240 行） | **纯渲染层**（零 DOM 依赖，单测友好）：`formatCell`（null/blob/empty/text 四态）、`PageInfo` / `pageOf` / `offsetOfPage`、`ROWNO_W` / `MIN_COL_W` / `MIN_VISIBLE_COLS` / `visibleColumnCount`（窄栏裁列）、`csvCell`（RFC 4180）/ `toCsv`（CRLF）、`statusText`、`buildGridTable` |
| `shell/src/sqliteView.ts`（新，约 1400 行） | 视图主体：DOM 装配、连接管理（增/删/切换/持久化）、对象树（表/视图/索引三组 + 列 + 行数）、SQL 分类镜像（`stripSqlNoise` / `topLevelWords` / `classifySql`，与 Rust 同 9 条对抗样本）、语句切分（`statementSpans` / `splitSqlStatements` / `currentStatement`）、段折叠持久化（`opencharm.db.sections`） |
| `shell/src/views.ts` | `SidebarViewId` 加 `"database"` |
| `shell/index.html` | Activity Bar 第七项 `#tab-database`（`codicon-database`）+ `#view-database` 容器；设置面板导航项 `data-cat="database"` + `#settings-section-database`（`#settings-db-page-size` / `#settings-db-warn-on-write`） |
| `shell/src/main.ts` | `initDbView()` / `restoreDbSections()` / `setDbViewHandlers()`；`registerSidebarView({ id:"database", … })`；工作区复位调 `resetDbView()`；命令表加 `db_add_connection` / `db_new_query` |
| `shell/src/style.css` | `.db-*` 约 140 行（工具条 / 段头 / 树 / 网格 / 分页条 / 单元格详情），全部走 token |
| i18n `database` 域 | zh-CN 真源 `data/database_zh.json`（91 键）+ `data/database_en.json`（92 键，含 `statusAffected` 复数）→ `gen_domain.py` 生成 `locales/{zh-CN,en-US}/database.ts` 各 92 条；`index.ts` 挂载 |
| `shell/tools/i18n/data/backend_err.json` + `backendError.ts` | 补 9 条（3 条 `Db*` 错误码 + 6 条**历史遗漏**的 git clone 文案）；漂移锁从 103 升至 **112 条，112/112 一致** |
| `shell/e2e/mocks/tauri-mock.js` | `db_*` 桩：内存连接表（`db_connections_load` / `save` / `db_open` / `db_close`）+ 默认样本（2 表 1 视图 1 索引 + **250 行**结果，>200 才能测翻页）；`__E2E_DB__` 预置入口、`__E2E_DB_SAVED__` / `__E2E_DB_QUERIES__` 断言钩子 |
| `shell/e2e/db/01-connections.spec.ts` | DB-CONN-1..9 |

**实施期的关键设计要点**：

1. **Monaco 第二实例不能用 `lazyEl` Proxy**：`automaticLayout` 会把容器交给 `ResizeObserver.observe()`，Proxy 不是真实 `Element`，原生 API 直接拒（同 `splitEditor.ts` 的踩坑注释）。改为懒创建 + 常驻。
2. **i18n 词条零遗漏**：施工中发现 `core.ts` 有 27 个键在数据源里缺失——`gen_locales.py` 会**静默删除**它们（生成是「以数据源为准的全量重写」）。已把 27 键回填进 `manual_zh.json` / `en_3.json`，使生成幂等。
3. **段折叠沿用 UI-16 纪律**：`.collapsed` 与 `aria-expanded` 由 TS 同源切换，CSS 只认类名。

**验证**：`npx tsc --noEmit` 0 错误；`vitest` 89 文件 / 991 用例全绿（含 `sqliteView.test.ts` 48 例）；`e2e/db/01-connections.spec.ts` **9/9 通过**。

### 9.4 PR-4 实施记录（2026-10-02）

**改动**：SQL 编辑器与结果网格全量交互。

| 内容 | 说明 |
|---|---|
| SQL 编辑器 | Monaco 第二实例（`sql` 语言、懒创建常驻）；`Ctrl+Enter` 执行**光标所在语句**（`currentStatement` 按 `;` 切分定位）、`Ctrl+Shift+Enter` 逐条执行全部 |
| 查询历史 / 草稿 | 历史最多 20 条（`HISTORY_MAX`），下拉回填编辑器；草稿 2 s 防抖随连接落盘（`db_connections_save`） |
| 结果网格 | 分页（`pageSize` 可 100/200/500/1000）、行号绝对化、列名 + 行号列 sticky、NULL / 空串 / BLOB 三态视觉可分、单元格点击出详情 + 复制 |
| 取消 | `db_cancel` → `get_interrupt_handle().interrupt()`；查询中状态条显示「取消中…」 |
| 导出 CSV | UTF-8 BOM + CRLF（Excel 双击不乱码），上限 10000 行；`write_file` 落盘 |
| 右键菜单 | 复制表名 / 复制 `SELECT` 语句 / 查看建表 DDL |
| 设置项 | `db_page_size`（默认 200）、`db_warn_on_write`（默认 true）——`state.ts` → `settingsPanel.ts` → `index.html` 三步接线 + Rust `Settings` 同步 |

**e2e 抓到的两个真 bug（均已修，是本 PR 最有价值的产出）**：

1. **布局溢出未收容 → 分页条「看得见点不动」**（DB-Q-1 / DB-Q-10 复现）
   症状：`#db-next` / `#db-export` 的点击被 `<div id="output"> … intercepts pointer events` 拦下。
   根因：720px 视口下侧栏可用高约 380px，容不下「树 120 + 编辑器 140 + 结果 160」→ 内容溢出 `#main`；`#sidebar` 是 `position:relative`，其定位子树在「定位后代」阶段绘制，而 `#bottom` 同为定位且 DOM 在后 → 溢出部分被输出面板整块盖住。**与 `#git-panel` 早已登记的「溢出收容」是同一类事故**。
   修复：`#view-database` 加 `overflow-y:auto`（短窗口整窗滚动，保证任一段与分页条始终可达）+ `.db-result-wrap` / `.db-result-grid` 补 `min-height` 下限，使分页条不再被挤出可视区。
2. **页码 / 行偏移两套单位混用 → 「下一页」原地不动**（DB-Q-1 复现）
   根因：模块级 `page` 存的是**行偏移**（`page = Math.max(0, offset)`），而分页按钮按**页码**语义调用 `gotoPage(page + 1)`；从第 1 页点「下一页」→ `gotoPage(1)` → `(1-1)*200 = 0` → 重查同一页。
   修复：删除该歧义变量（口径统一取已显示结果的 `result.offset`），新增 `currentPageNo()` 明确「1 基页码」，并抽出纯函数 `offsetOfPage(pageNo, pageSize)` 作为**唯一的页码→偏移换算入口**，配 3 例互逆单测（`pageOf(t, offsetOfPage(n, s), s).page === n`）作回归护栏。

**验证**：

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `vitest`（全量） | ✅ 89 文件 / **994** 用例（`sqliteView.test.ts` 48 → 51） |
| `cargo test --offline db_` | ✅ **33 passed / 0 failed** |
| `e2e/db/`（01 + 02） | ✅ **22/22 passed**（DB-CONN-1..9 + DB-Q-1..13） |
| `e2e/db/ + session/ + autosave/ + ux/`（§11 回归域，干净 dev server） | ✅ **59/59 passed / 0 failed** |

> 回归域首次跑出现 2 例失败（UX-9 / OG-7），经查为 **D-008 陈旧 dev server** 所致（见下），重启后全过 —— **不是本 PR 的回归**。

**环境发现（本机，供后续 Rust 侧施工参考）**：

- 沙箱下 cargo 无法删除 `target/debug/incremental/*/**.lock`（`os error 5 拒绝访问`），增量缓存因此损坏，`cargo check` 会随机触发 rustc ICE（`rustc_metadata::rmeta::encoder::encode_metadata` panic）。**规避：`CARGO_INCREMENTAL=0`**，此后 `cargo check` / `cargo test` 均干净通过（0 告警）。这是环境问题，与代码无关。
- 依赖镜像（USTC）仍不可达，全程 `--offline`。
- **跑 mock 层 e2e 前必须先重启 vite dev server**（D-008，已登记 `docs/e2e_divergence_ledger.md` 避坑速查）：`playwright.config.ts` 是 `reuseExistingServer: true`，而 Vite 会把 HMR 时间戳烘进已转换模块的 import，使用例里 `import("/src/x.ts")` 拿到第二个模块实例 → 症状是「点了没反应」这类假 bug。本轮 `ux/` 的 UX-9 / OG-7 两例即由此产生，**重启后全过**（非本 PR 回归）。

**PR-4 DoD 达成情况**：✅ Monaco 第二实例 ✅ 两种执行语义 ✅ 历史 / 草稿持久化 ✅ 分页 / 取消 / 导出 ✅ 单元格详情与复制 ✅ 右键菜单与 DDL ✅ 两个设置项三步接线 ✅ 两个真 bug 修复并有回归护栏。
⏳ **§10.3 真机手测清单未执行**（需要打包后的真实 Tauri 应用与真实 `.sqlite` 文件；本机只能跑浏览器 e2e，`rusqlite` 是进程内库、mock 无法覆盖），**待复核时在真机补跑**。

---

## 10. 测试计划

### 10.1 单测

| 层 | 文件 | 用例 |
|---|---|---|
| Rust | `db_cmds.rs` `#[cfg(test)]` | ≥21（§5.5 清单） |
| TS | `src/__tests__/sqliteView.test.ts` | ≥12：`truncateCell` 边界（199/200/201 字符、含中文、含换行）、`blobLabel`（B/KB/MB 三档）、`formatStatus`（行/列/耗时/截断四种组合）、`pagerState`（首/中/末页、总数为 0）、`classifySql` TS 镜像（与 Rust 同 9 条对抗样本）、`splitStatements` TS 镜像 |
| TS | `src/__tests__/sqliteGrid.test.ts`（可选） | ≥4：网格行/列生成、NULL/BLOB 渲染、窄栏列裁剪 |

**实施结果（2026-10-02）**：上表是开工前的**规划**清单，实际落地与它有三处差异，以实际为准：

- 单测**集中在一个文件** `shell/src/__tests__/sqliteView.test.ts`（**51 例**），没有另建 `sqliteGrid.test.ts`——`sqliteGrid.ts` 是零 DOM 依赖的纯函数层，同文件内按 `describe` 分块即可，拆文件只增噪声。
- 规划里的函数名与实现名不一致（实现做了合并/改名）：`truncateCell` → 并入 `formatCell` 的四态返回（`truncated` + `full`）；`blobLabel` → 并入 `formatCell` 的 `blob` 态；`formatStatus` → 定名 `statusText`；`pagerState` → 定名 `pageOf`，另加互逆函数 `offsetOfPage`。
- 实际覆盖：`formatCell` 四态边界、`pageOf` 越界收敛、`offsetOfPage` 互逆（3 例，DB-Q-1 回归护栏）、`visibleColumnCount` 窄栏裁列、`csvCell`/`toCsv`（RFC 4180 + CRLF）、`statusText`、`buildGridTable`、`classifySql` 20 条对抗样本、`statementSpans`/`currentStatement`。

### 10.2 E2E（mock 层，`shell/e2e/db/`，新域）

**实施结果（2026-10-02）**：桩与用例均已落地，**22/22 通过**。

mock 桩实际位置在 `e2e/mocks/tauri-mock.js` 的 `dbHandle()`（**纯 JS**，`cmd.indexOf("db_") === 0` 前置分发，先于静态表；`pick_file` 亦被 `__E2E_DB__.pick` 覆写）。比初稿增强的地方：

- 样本规模从「2 行」提到 **250 行 + 2 表 1 视图 1 索引**（<200 行测不出翻页与页数重算）；
- 内存连接表复刻 Rust 侧 `db_connections.json` 的读写语义（`db_open` 合并写入 / `db_connections_save` 整表覆盖落在同一份上）；
- 断言钩子：`__E2E_DB_SAVED__`（最后一次落盘列表，验草稿/历史）、`__E2E_DB_QUERIES__`（查询流水，验「执行当前语句 / 执行全部」到底发了哪几条 SQL）；
- 预置入口 `window.__E2E_DB__ = { connections, objects, result, ddl, pick, failOpen, failQuery, failList }`。

用例清单（`01-connections.spec.ts` 9 例 / `02-query.spec.ts` 13 例）：

| 用例 | 断言 |
|---|---|
| DB-CONN-1 | Activity Bar 第七项可切；视图互斥 + `aria-selected` 同步 |
| DB-CONN-2 | 无连接 → 空态文案 + 下拉/连接级按钮全禁用 |
| DB-CONN-3 | 有连接自动打开；三组对象树 `表 (2) / 视图 (1) / 索引 (1)` + 组内排序 + 行数 |
| DB-CONN-4 | 单击表节点展开列（名 + 类型 + `PK`/`NN`）；索引节点无列容器 |
| DB-CONN-5 | 双击表 → 网格表头 `#/id/name/note` + 行号从 1 起 + 状态条 `200/250 行 · 只读` |
| DB-CONN-6 | 可写开关二次确认；取消不变、确认后 `aria-pressed=true` + 警示条出现 |
| DB-CONN-7 | 移除连接只摘列表（确认框含「不会删除文件」）+ 落盘列表不含它 |
| DB-CONN-8 | ＋ 走 `pick_file` → 下拉从 1 项变 2 项并自动切换 |
| DB-CONN-9 | 段折叠写入 `localStorage["opencharm.db.sections"]`，重载后仍折叠 |
| DB-Q-1 | **分页**：250 行 / 每页 200 → 2 页；行号为绝对行号（1…200 / 201…250） |
| DB-Q-2 | 只读连接执行写语句 → 前端前置拦截，**不发 IPC** + 提示 |
| DB-Q-3 | 可写连接执行写语句 → 确认框 → 「影响 N 行」，且 SQL 确实发出 |
| DB-Q-4 | 查询失败 → 状态条转错误态 + 错误 toast，保留上次结果 |
| DB-Q-5 | `Ctrl+Enter` 只执行**光标所在**那条语句 |
| DB-Q-6 | `Ctrl+Shift+Enter` 逐条执行全部语句 |
| DB-Q-7 | 查询历史下拉可回填；草稿 2 s 防抖后随连接落盘（核 `sql` 字段） |
| DB-Q-8 | 单元格详情显示完整值 + 复制入剪贴板 |
| DB-Q-9 | NULL 与空串在网格里视觉可分（类名 + 文案） |
| DB-Q-10 | 导出 CSV 写真实临时文件：BOM + 表头 + 250 行全量 |
| DB-Q-11 | 每页行数切换后重查并重算页数（2 页 → 3 页） |
| DB-Q-12 | 设置面板「数据库」每页行数保存后对新查询生效 |
| DB-Q-13 | 右键菜单可复制表名 / 复制 `SELECT` / 查看 DDL（弹框含 `CREATE TABLE`） |

**与初稿的差异（说明）**：

- 初稿 DB-9「第 1/1 页时上下页均禁用」被 DB-Q-1 吸收（首/末页禁用态在真实分页流程里断言，比造 1 页样本更接近用户路径）；
- 初稿 DB-12「查询中取消」与 DB-13「窄栏裁列」**未做 e2e**：前者需 mock 侧可控延迟（`__E2E_DB__.delayMs` 未实现），后者属纯函数 `visibleColumnCount` 的职责，已由单测覆盖（`sqliteView.test.ts`）；两项留在 §10.3 手测。
- 初稿 DB-14「切换连接草稿分别恢复」被 DB-Q-7 的草稿落盘断言覆盖到一半，**跨连接隔离未单独断言**（登记为已知缺口）。

> **纪律**：e2e 全程离线，**禁止真发 SQL 到真实数据库文件**（mock 桩覆盖全部 `db_*` 命令）。真机验证走 §10.3 手测。

### 10.3 真机手测清单（PR-4 收尾，逐条打勾）

> **状态：已执行，13/13 PASS**（2026-10-02，`tauri dev` 真实窗口 + WebView2 CDP 驱动，脚本 `shell/e2e-real/db-real.cjs`，造数 `scripts/_tmp/make_db_fixture.py`，隔离数据根 + 双轮启动验证持久化）。执行中发现并修复 2 个真机 bug（见 §15）。原生文件对话框（＋ 添加 / 导出保存）用 SendKeys 自动化，导出带 3 次重试。

1. [x] 用 `python -c "import sqlite3…"` 造一个含 3 张表、1 个视图、1 万行数据的 `.sqlite` 文件；
2. [x] ＋ 添加 → 树显示 3 表 1 视图，行数正确（万行表 `COUNT(*)` 不卡死）；
3. [x] 双击万行表 → 200 行结果，翻到第 3 页，行号连续（401…600）——**首跑 FAIL，暴露真机 bug 1（§15）**；
4. [x] 写 `SELECT * FROM t WHERE name LIKE '%a%'` 执行 → 结果正确、耗时显示；
5. [x] 执行 `DELETE FROM t` → 只读拦截 toast；开可写 → 确认框 → 执行 → 「影响 N 行」；
6. [x] 执行一个慢查询（`WITH RECURSIVE` 笛卡尔积）→ 取消按钮 → 3 秒内回到可交互（实测 <110ms）；
7. [x] 导出 CSV → Excel 打开中文不乱码（BOM=true、表头 `id,name`、10000 行全量）；
8. [x] 关应用 → 任务管理器确认无残留句柄（Exit 清理生效）；重开 → 连接列表与 SQL 草稿仍在；
9. [x] 切浅色主题截图 + 深色主题截图（网格、树、工具条；`scripts/_tmp/db-real-{light,dark}.png`）；
10. [x] 侧栏拖到最窄 → 网格降级规则生效，无横向破版（280px：状态条 `3/9 列`、表头 `#,id,c1,c2`）。
11. [x] **短窗口（≤720px 高）**：三段全部展开时侧栏可纵向滚动、分页条可点（§9.4 bug 1 的回归点）；折叠「对象树」段后结果区明显变高。
12. [x] 执行一次会失败的 SQL（如 `SELECT * FROM 不存在的表`）→ 状态条错误态 + toast，且**上次结果仍在**。

---

## 11. 通用门禁（每个 PR 必跑）

| 层 | 标准 |
|---|---|
| 类型 | `npx tsc --noEmit` 零错误 |
| 前端单测 | `npm run test`（vitest）全绿 + 新增用例 |
| Rust 单测 | `cargo test` 全绿 |
| 构建 | `cargo build`（PR-1 起每次都要过）+ `npm run build` |
| E2E | 新域 `db/` 全绿 + 回归 `session/`、`autosave/`、`ux/`（侧栏注册表改动影响面） |
| i18n | zh-CN 真源完整、en-US 编译期对齐、`backendError.ts` 七条错误码到位 |
| 样式 | 无裸值；双主题抽查；`tabular-nums` 到位 |
| 文档 | 交付记录回填本文档（照 `git_clone_dev_plan.md` §12 写法）；README 索引或交付总览同步 |

---

## 12. 风险登记与回滚

| 风险 | 概率 | 影响 | 应对 | 触发点 |
|---|---|---|---|---|
| `rusqlite(bundled)` 在 CI / 本机编不过或过慢 | 中 | 高 | PR-1 单独验证；失败 → 切 §2.1 方案 B（前端与数据契约不变，只换 `db_cmds.rs` 实现） | PR-1 |
| 包体积 / 构建时间显著膨胀 | 低 | 中 | PR-1 记录基线增量（构建耗时、NSIS 包体积），写入交付记录 | PR-1 |
| `classify_sql` 误判导致写被执行 / 读被拦 | 中 | 高 | 双端同源规则 + 各 9 条对抗样本；**后端硬闸门**（`DbReadOnly`）兜住前端误判 | PR-2 |
| COUNT(*) 在大表上卡死 | 中 | 中 | 异步 + 可取消；失败退化为 `rows.len()` 不拖垮主查询 | PR-2 |
| 连接列表 JSON 损坏 | 低 | 中 | 读失败返回 `[]`（绝不 panic，照 `env_cmds.rs:90 load_config` 口径）；写用临时文件 + rename 原子替换 | PR-1 |
| Monaco 第二实例泄漏 / 与主题不同步 | 低 | 中 | 懒创建 + 常驻（照 splitEditor G-1）；`refreshDbSqlOptions()` 接线设置保存；host 不用 lazyEl Proxy | PR-4 |
| 侧栏窄栏破版 | 中 | 低 | §3.1 折叠与列裁剪规则 + DB-13 用例 | PR-4 |
| 循环 import 复发 | 低 | 高 | 严禁 `sqliteView.ts` import `main.ts`；交叉能力走 handler 注入 | PR-3 |
| id 前缀与既有 DOM 冲突 | 低 | 中 | 开工前 `grep -rn "db-" index.html src/*.ts` 确认无冲突 | PR-3 |

**回滚**：四个 PR 均独立可回滚（功能新增，不改既有逻辑；唯一对既有文件的"侵入"是 `views.ts` 一行、`lib.rs` 三处、`index.html` 两段、`main.ts` 六处接线）。最坏情况删除 `db_cmds.rs` / `sqliteView.ts` 并 revert 接线即可整体撤除。

---

## 13. 明确不做 / 已知边界

**不做**：其他数据库（Postgres/MySQL）、ER 图、单元格编辑写回、导入向导、查询计划可视化、多连接同时在线、CSV 导入。

**已知边界（要在文档与 UI 上明示）**：
1. WAL 模式下以只读打开可能读到旧快照（提示"如需最新数据请刷新"）；
2. 加密库（SQLCipher）不支持；
3. 大表 `COUNT(*)` 为全表扫描，慢属正常（已异步可取消）；
4. BLOB 只显示大小不预览；
5. 取消是"协作式中断"，不保证毫秒级生效；
6. 排序/筛选请用 SQL（网格不做客户端排序）；
7. 同时只维护一个活跃连接。

---

## 14. 附录

### A · 代码位置速查

| 用途 | 位置 |
|---|---|
| 侧栏视图注册 | `views.ts:5`（id 联合类型）/`:7-17`（接口）/`:37`（register）/`:47`（setSidebarTab）；注册点 `main.ts:2653-2690`；点击绑定 `:2699-2704` |
| 最佳照抄模板（侧栏视图） | `endpointView.ts`（全文）：handlers 注入 `:40-49`、`initEndpointView` `:59-93`、`refreshEndpoints` 令牌 `:115+`、空态与 toast 用法 |
| Activity Bar 按钮形态 | `index.html:91`（`tab-todo`）、`:93`（`tab-endpoints`） |
| 视图容器形态 | `index.html:161`（`#view-todo`）、`:163`（`#view-endpoints`） |
| 第二 Monaco 实例范式 | `splitEditor.ts:47-55`（ensureEditor，含 lazyEl 踩坑注释 `:23-25`）、`:130 refreshSplitEditorOptions` |
| 文件选择对话框 | `fs_cmds.rs:224 pick_file`（另有 `pick_folder:207`） |
| 工作区配置读写（**本项目不用**，全局连接列表另存） | `env_cmds.rs:85/90/100` |
| 全局主目录 | `util.rs:79 opencharm_home()` |
| 命令注册 | `lib.rs:75` `generate_handler!` 列表（按域分组）；mod 列表 `lib.rs:1-25` |
| 退出清理 | `lib.rs:305-319` `RunEvent::Exit` 分支 |
| 异步阻塞调用范式 | `lib_cmds.rs:173`（`spawn_blocking`） |
| 流式/取消基建（参考形态） | `git_cmds.rs:760-909` |
| 进程工具 | `util.rs:96/103 no_window`、`:125/:150 kill_process_tree`、`:202 kill_pid_tree` |
| 安全校验参考 | `git_cmds.rs:325 validate_repo_relative`、`:1451 validate_clone_url` |
| 设置三步接线 | `state.ts:108-118`（接口）/`:128-191`（默认）；`settingsPanel.ts:93`（声明）/`:630`（回填）/`:770`（收集） |
| 工具函数 | `util.ts:39 basename`、`:94 codicon`、`:116 emptyState`、`:304 errMsg`；`toast.ts:46 toast`、`:102 toastFail` |
| i18n 域示例 | `src/i18n/locales/zh-CN/endpoints.ts`；聚合 `zh-CN/index.ts:30,33` |
| 侧栏宽度与拖拽 | `layout.ts:68 toggleSidebar`、`:73 restoreLayout`、`:124 wireSplitters`；CSS `--sidebar-w` |
| E2E | 域目录 `shell/e2e/{git,ux,dx,editor,lsp,libs,p3,p4,session,autosave,perf,debug,plugins}`；`helpers.ts:831 equipPage`；mock `e2e/mocks/tauri-mock.js:57` |

### B · 开工前检查清单（按顺序）

1. [ ] 拍板 §2 两个选型（引擎、默认只读）；
2. [ ] `git status` 确认工作区干净（当前有未提交的视觉改造改动，先收口再开新分支）；
3. [x] id 前缀冲突检查**已完成（2026-10-02）**：`grep -rn 'id="db-\|"db-[a-z]' index.html src/*.ts` 零命中，`db-` 前缀可安全使用；
4. [x] 图标检查**已完成（2026-10-02）**：`codicon-database` 在 `@vscode/codicons` 中存在（备选 `codicon-table` 同样存在）；
5. [ ] PR-1 先跑一次空壳 CI，记录构建耗时基线（用于判断 bundled 是否可接受）；
6. [x] 准备真机测试数据（§10.3 第 1 条的造数脚本，可放 `bench/` 或临时目录）——已落 `scripts/_tmp/make_db_fixture.py`。

---

## 15. 复核与真机验收记录（2026-10-02）

### 15.1 门禁复核（复核通过，最终代码态）

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `vitest` 全量 | ✅ 89 文件 / 994 用例 |
| `cargo test --offline db_`（`CARGO_INCREMENTAL=0`） | ✅ 33/33 |
| `e2e/{db,session,autosave,ux}`（干净 dev server） | ✅ 59/59 |
| 真机 §10.3（CDP 驱动，双轮启动） | ✅ 13/13 |

顺手清理：删除测试模块中未使用的 `open_conn` 辅助函数（dead_code 告警）。

### 15.2 真机 bug 1 · 引号标识符下 COUNT 失效 → 翻页在真机上不可用（严重）

- **症状**（§10.3-3 首跑复现）：双击表节点后状态条显示 `200/200 行`，total 恒等于本页行数，「下一页」禁用。mock 层 e2e 未暴露——**mock 桩自己算 total，掩盖了后端缺陷**，这正是 §10.3 真机层存在的价值。
- **根因链**：前端浏览表恒发 `SELECT * FROM "表名"` → `count_total` 用 `strip_trailing_limit` 去 LIMIT 后包一层 `COUNT(*)` → 旧实现把 `strip_noise` 的**去噪文本**直接当作返回值，`"users"` 被整体抹成空格 → 得到 `SELECT COUNT(*) FROM (SELECT * FROM)` → SQL 报错 → 按设计退化为 `rows.len()` → 分页失效。
- **修复**（`db_cmds.rs`）：
  1. `strip_noise` 改为**逐字符等长**替换（噪声 → `' '`、保留 `'\n'`）——去噪文本的偏移 == 原 SQL 偏移；
  2. `strip_trailing_limit` 用去噪文本**只做定位**（正则去掉前导 `\s+`、尾部 `[\s;]*` 放行分号与注释占位，且对去噪文本**不做 trim**——结尾的去噪空格可能对应原文的字符串/标识符字符），返回**原 SQL 切片**；
  3. 新增单测：引号标识符 / 字符串内 limit / 尾注释 / 尾分号 / 无 LIMIT 原样返回 + 集成断言 `SELECT * FROM "t"` 的 total=3。
- **教训**：文本解析类函数若被两处复用（分类 vs 定位），返回值语义必须显式区分；「定位用去噪文本、返回用原文」。

### 15.3 真机 bug 2 · 视图先于工作区就绪初始化 → 永久停留「未打开工作区」

- **症状**（§10.3-8b 复现路径）：重启应用后立刻切到数据库视图，树区停在「未打开工作区」，即使工作区随后恢复完成也不再刷新。
- **根因**：`renderTree` 依赖 `app.workspaceRoot`；启动自动恢复工作区是异步的，视图在其完成前初始化/显示时画出空态后，工作区就绪**不触发任何重渲染**（onDbViewShow 只在视图切换时调用）。
- **修复**：`sqliteView.ts` 导出 `refreshDbWorkspace()`（补渲染 + 未激活时自动开首条连接）；`main.ts::openWorkspace` 收尾调用——与既有 git 视图补刷新同款处理。**必须带 `viewShownOnce` 门**：视图从未显示过则 no-op，否则会在 autosave/session/ux 域提前创建第二 Monaco 实例（`.monaco-editor` strict-mode 双命中，11 例 e2e 回归，已复跑全绿）。

### 15.4 真机测试基建经验（复用价值）

- 复用 `e2e-real/lib/real-env.cjs` 的隔离环境思路，但重启复验（§10.3-8）需自行管理：`taskkill /T /F` 杀不死 **WebView2 孤儿进程**，会继续占 CDP 端口把第二轮连接引到死会话——重启前按命令行特征（`remote-debugging-port`）清理并等端口释放；
- 预置 `db_connections.json` 跳过原生 `pick_file` 时，**条目 id 必须复现 Rust `conn_id`**（`canonicalize` 的 verbatim `\\?\` 路径 → lowercase → SipHash-1-3(0,0)），否则 `db_open` 按新连接追加，列表出现同名重复项；
- Node 探测文件锁用 `fs.openSync(p, 'r+')`——**没有 `'r+b'` 这个 flag**，传错只会抛 `ERR_INVALID_ARG_VALUE`，会把「文件空闲」误判为「被占用」；
- Monaco 建议弹层（`monaco-highlighted-label`）会拦截后续按钮点击：输入 SQL 后先 `Escape`；
- 原生保存对话框 SendKeys 自动化约 2/3 成功率，带 `{ESC}` 兜底 + 重试循环即可稳定。
