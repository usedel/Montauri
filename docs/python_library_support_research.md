# Python 常用库「特别支持」调研报告

> 版本：**v1.5** · 日期：2026-09-26（v1.0 调研）· 2026-09-27（v1.1 裁决 / v1.2 探针实测 / v1.3 动工前置修订 / v1.4 交付收尾）· 2026-09-28（v1.5 交互一致性收口）· 性质：**调研报告 + 已裁决立项依据**
> **v1.5 变更**（交互一致性复查后的收口，裁决不变；实现侧补齐 + 三处口径回改）：① **无解释器态**补齐「求值产出区整块置灰 + `[设置解释器]` 跳设置页」（此前只有一行文案，§11.2 / §11.3.3）；② **求值中态**补齐「上次结果灰显 + 顶部细进度条」（此前只有文案，§11.2 / §11.3.3）；③ **sourceDirty ②**补齐：从编辑器带入的新内容不覆盖用户手改内容，且 `libsBridge` 的 pending 请求加 **30s TTL**（面板被 LRU 逐出后重挂不套用陈旧上下文，§11.2）；④ 点击匹配行改用**独立装饰集合**，奇偶交替底色不再被选中边框覆盖（§11.3.2）；⑤ 补 `Ctrl+C` 复制当前匹配（§11.3.2）；⑥ **格式串 hover 补「示例输出」**（固定样本：时刻 2026-09-26 14:03:11 / 数值 1234.5678；未知码与 tz·locale 依赖码一律不给示例，I-3 不臆测），并**补上格式串的编辑器右键入口**（此前只有 lens，hover 文案却指向不存在的菜单项，§11.1 / §11.4）；⑦ `libs_argparse` 关闭后**运行面板参数区不再显示**（此前开关只管 lens，§11.9）；⑧ 输出面板补齐 `- LEVEL -` 前缀形态、**级别计数徽标**、色条 3px（§11.7）；⑨ 参数表单补 **`nargs` → 多行文本**（`'*' / '+' / N`，命令行多 token 展开与回填，§11.5）与**缺参 toast + 保存校验**（§11.5）；⑩ CodeLens 收敛：libs 侧**每行最多 1 条**（第 1 行已有工具 lens 时不再叠参数 lens）、参数 lens 占用同一 20 条预算、右键项加 `editorLangId == python` 门控（§11.1）；⑪ 口径回改：测试文本为**可编辑 Monaco（不写回文件）**（原表述「只读」易歧义，§11.3.2 / §10.1-P6）。详见开发计划 `python_library_support_dev_plan.md` v1.3 §11。
> **v1.4 变更**（交付收尾，全部为状态回填，不改裁决）：① 交付状态——P0 四项 + P1 五项全部落地（开发计划 v1.2，`ac85980` / `cd0af89`）；② **P7 完成**：CACHE_MAX=5 维持（驻留 ~4.3MB）+ 发现并修复 6 个内置工具的 kit.output Monaco 泄漏（§10.1）；③ **P3 完成**：intel 对 DataFrame 只能给私有属性名（`_mgr` 等），列集合不可得 → pandas / NumPy 运行时卡按裁决**登记放弃**（§4.6、§10.1）；④ §11.9 清单收口——`libs_json_inject` / `log_level_colors` 两开关补齐接线；§11.6 JSON hover 摘要与 §11.1-2 双 DSL 聚合 lens 已补齐（v1.3 遗漏项）；⑤ Q5 首次命中 toast 引导已落地（标志写 workspace config `framework_hints["regex_tester_intro"]`）；⑥ §6「库探测门控」评估后不做（识别规则的调用点限定已是精确门控，见 §6 注记）。新增脚本/报告：`bench/lib-support-probe/p3_pandas_probe.py` / `-p3-pandas.json`。
> **v1.1 变更**：§12 的四项裁决已由产品负责人拍板（全部采纳推荐项），§11 交互设计随之冻结；§11.10 的 Q1/Q3 关闭，Q4/Q5 按推荐默认执行。
> **v1.2 变更**：三份探针实测回填——**P1** 求值桥耗时（定 `-I` + 解释器缓存 + 超时档位）· **P2** pyrefly 对字符串内 DSL **零支持**（L1 必须自研）· **P6** 只读 Monaco 边际成本 ~8ms（Q2 关闭）。新增待跑探针 P7（内存）。
> **v1.3 变更**（评审后的动工前置修订，只动协议与探针口径，不动 §11 交互冻结项）：① 求值桥命令定档 **`python -I -X utf8 -c`**——`-I` 会忽略 `PYTHONIOENCODING`/`PYTHONUTF8`，Windows 默认 locale 编码（cp936）会破坏 stdout JSON，须用不受 `-I` 影响的 `-X utf8` 强制 UTF-8（§5.2）；② `args_json` 改走 **stdin**（正则模式含引号/反斜杠/换行，`re.X` 多行是明确支持场景；Windows argv 有 ~32K 限制与引号转义问题）（§5.2）；③ **P1b 补测**回填「无 `.venv` 冷启动」：实测 **965ms**（原 1017ms 无报告留痕，已替换为可溯源数字）（§10.1）；④ P1b 发现 **`.venv` 创建前 `uv python find` 返回系统解释器而非项目解释器** → 解释器路径缓存增加「仅缓存指向工作区 `.venv` 的结果」失效条件（§5.2、§10.1）；⑤ 内省受控脚本须显式 `sys.path.insert(0, os.getcwd())`（`-I` 隐含 `-P`，cwd 不在 `sys.path`）（§4.3）。新增脚本/报告：`bench/lib-support-probe/p1b_coldstart.py` / `bench/reports/lib-support-probe-p1b-coldstart.json`；⑥ 维护修订：requests/httpx → cURL 反向生成补入 P1（#9，§0-10、§7.2）· 诊断 owner 锚点修正（§6）· P1 表 179ms/126ms 口径说明（§10.1）。
> 调研对象：Python 标准库 + 第三方常用库的「IDE 特别支持」形态；PyCharm / VS Code 既有做法；本仓库现状逐条核对
> 结论用途：为「OpenCharm 要不要给某个库做专属支持、做多深」提供输入；**是否立项、何时排期以 `python_ide_dev_plan_v2.md` 及产品负责人裁决为准**（tech plan v3 §1.2 已明确「❌ 复刻 PyCharm 全部功能」为非目标）
> **交互设计**：§11（线框 / 状态机 / 冲突规则 / 文案模板）——动手前定死，实现阶段只做填空题。看排期看 §7，看交互看 §11。
> 与既有文档的关系：
> - `pycharm_framework_support_report.md` 管**框架**（Django/Flask/FastAPI，项目级约定 → 运行配置 / 端点）；本文档管**库**（标准库 + 第三方包，字面量语义 + 交互工具）。两条线不重叠。
> - `dx_features_backlog.md` 是通用编辑器体验（键位/保存/搜索/符号），本文档只在「挂点复用」处引用它。
> - `plugin_system_design.md` §9.7 把**正则测试**列为 v1 放弃（卡在 JS `RegExp` ≠ Python `re` 语义），`devtools_plugin_acceptance_record.md` §六把它列为 v1.1 备选；本文档 §5 给出解锁该卡点的具体路径（Python 求值桥）。

---

## 0. 一页结论

1. **「库的特别支持」本质只有两类**：① **字符串里的内嵌 DSL**（正则、格式串、日期码、SQL、JSON、路径）；② **库对象/调用的可视化与工具化**（正则测试器、参数表单、数据预览）。前者是「语言注入」，后者是「工具面板」。除此之外几乎没有第三种形态——所谓「支持 pandas」落到 IDE 里也只有 DataFrame 查看器和调试变量表这两件具体东西。
2. **最高性价比的落点是一个平台能力，不是一个库**：把「内嵌 DSL 注入」做成可复用框架（识别规则表 → 注入语言 → 高亮/校验/hover/工具入口），第一批只接 4 种语言（**正则 / 格式串 / 日期格式码 / JSON**），后续每加一种只是加一条规则。这比逐个库做专用功能划算一个数量级。
3. **`re` 正则值得做，且必须按「三件套」做**：① 字面量语法诊断（无效分组、`[z-a]`、非 raw 串丢 `\d`）② hover/inlay 人话解释（分组/命名组/量词）③ **正则测试面板**（测试串 + flags → 匹配高亮 + group 表 + sub 预览）。只做其中的面板（v1 设想的形态）价值会砍半——真正省时间的是「写完模式当场看到匹配结果」，而这需要编辑器与面板联动。
4. **正则测试器此前被卡的根源不是 UI，是语义真值**：JS `RegExp` 与 Python `re` 语义不一致（命名组语法、`\d` 的 Unicode 行为、`re.X`、`re.sub` 的反向引用写法、flags 名）。**必须先建一条 Python 求值通道**（§5），否则只能交付一个「看起来对、实际会误导」的工具。这条通道一旦建成，**re / 格式串 / struct / datetime / argparse / pandas 探针全部受益**——它是本批工作的真正基建。✅ **P1 已实测定档**：直连 `python -I -c` 126ms · `uv run` 475ms · `uv python find` 125ms → 采用「查一次解释器路径并按工作区缓存，之后直连」，省约 60%（§10.1）。
5. **`strftime` / `str.format` / f-string 格式规范 / `logging` 的 `%(asctime)s` 是「最高频 + 最低成本」的一档**：格式规范（`>10.2f`、千分位、填充、类型码）和时间格式码（`%Y-%m-%d %H:%M:%S`）是公认的「每次都要查文档」项，而它们的求值全是**无副作用纯函数**，一个 DevTool 面板 + hover 预览即可覆盖，无安全风险。
6. **`argparse` / `click` / `typer` 的参数表单是被忽略的高价值项，且最贴合本项目画像**：项目定位是「单人自用脚本」（dev plan v2 §1.1），自用脚本最常见的形态就是「一个文件 + 五六个命令行参数」，每次手敲 `--input a.csv --lang zh --verbose`。静态扫描 `add_argument` / `@click.option` 生成参数表单 → 回填运行配置，价值直观、成本可控。注意**内省式解析要 import 用户脚本（有副作用），必须以静态 AST 解析为主、内省为显式兜底**（§4.3）。
7. **数据科学（pandas / NumPy）在本项目应「浅做 + 探针先行」**：调研数据（PSF + JetBrains 第八次年度调查，3 万+ 受访）显示 **51% 的 Python 开发者参与数据探索与处理，pandas / NumPy 是最常用工具**，但这是**全体 Python 开发者**的画像，不是本项目「自用脚本 / 小项目」画像；且 dev plan v2 §1.1 已裁决 **Jupyter / Scientific 模式不做**。唯一值得探的是**借 intel 运行时数据做「跑过的 DataFrame 变量」洞察**（我们的差异化资产），且必须先出探针结论（§10-P3），探针不成立即登记放弃。
8. **`pytest` 裁决已变更（2026-10-16，`dev_plan_v2` v2.2 §1.1）**：由「面板维持不做」修订为分层口径——做测试运行器（发现 + 侧栏结果树 + 绿箭头逐用例 + 失败跳转，真源 `docs/pytest_dev_plan.md`）；独立结果面板 / 断言差异对比窗 / 覆盖率 / watch 维持不做（§8 表格同步改写）。当年「不做测试发现/结果树」的边界声明作废；「测试运行器」与「库支持」的边界仍成立：argparse 参数表单等库支持项不受影响。
9. **明确不做（避免立项阶段反复）**：matplotlib 图预览、Streamlit/Jupyter、asyncio 协程调试、sqlite/DB 工具窗、SQLAlchemy 深语义、Jinja2 语言包、`struct`/`fnmatch` 这类窄众格式串、`subprocess` 安全（ruff 已覆盖）、LLM SDK。理由见 §8。
10. **建议的第一批（P0，约 5–7 个工作日）**：① Python 求值桥（基建，1 天）② re 三件套（2 天）③ 格式串工具 + hover 预览（1.5 天）④ argparse/click 参数表单（2 天）。第二批（P1）「输出面板日志级别着色」「JSON→Pydantic 模型生成」「JSON 字面量注入」「注入框架化」「requests/httpx → cURL 反向生成」共约 3.5 天。详见 §7。（✅ **v1.4：两批共 9 项已全部交付**，开发计划 v1.2）
11. **交互必须先定死再动手（§11）**：本批功能几乎全部是「编辑器 ↔ 面板」的双向联动，真正决定成败的不是能不能算出来，而是**用户写正则的当下能不能发现工具、面板会不会抢走编辑器已有位置、求值失败时会不会误导**。§11 已把线框、状态机、CodeLens 与既有引用 lens 的共存规则、六态文案模板、设置开关与键位清单全部定死，实现阶段只做填空题。

---

## 1. 调研方法与来源

- **一手调查数据**：PSF + JetBrains 第八次年度 Python 开发者调查（2025-08 发布，3 万+ 受访）：
  - 51% 参与数据探索与处理（pandas / NumPy 最常用）；46% 用于 Web 开发；
  - 库/框架使用率（文中标注为 2024 usage）：FastAPI 38%（29%→38%）· Django 35% · Flask 34% · **requests 33%** · **asyncio 23%** · DRF 20% · httpx 15% · aiohttp 13% · Streamlit 12% · Starlette 8% · PostgreSQL 49% · uv 11%；
  - 50% 受访者编程经验不足 2 年（画像口径：工具要照顾新手）。
- **竞品做法**：PyCharm 2026.2 Help（`regular-expressions.html` 的 **Check RegExp** 弹窗：上半正则、下半测试串、匹配即绿勾；`using-language-injections.html` 的**语言注入**）+ PyCharm 的 Scientific Mode（DataFrame/图表查看）、pytest 集成、Jinja2 模板支持；VS Code 生态的 regex previewer / SQLite / Jupyter 扩展（常识性对标，未逐页抓取）。
- **本仓库现状逐条核对**（行号以 2026-09-26 代码为准）：`shell/src/devtools/*`（工具插件框架）· `shell/src/extensions/inline.ts` · `shell/src/lsp/client.ts` · `shell/src/codeVision.ts` · `shell/src/views.ts` · `shell/src/output.ts` · `shell/src-tauri/src/env_cmds.rs` · `shell/src-tauri/src/fs_cmds.rs` · `intel/README.md`。

> 标注约定：✅ 官方/一手数据 · ⚠️ 部分或间接 · ❌ 不支持/已裁决不做 · 🔍 推断（无直接一手数据，由生态常识与本项目画像推断）

---

## 2. 什么叫「库的特别支持」：能力分层与判定标准

### 2.1 能力分层（L0–L4）

| 层 | 定义 | 谁负责 | 举例 |
|---|---|---|---|
| **L0 通用语义** | 补全/跳转/hover/诊断 | 静态引擎（pyrefly）+ intel | `re.compile` 的签名提示、`df.` 的成员补全——**引擎已经做了，不属于「特别支持」** |
| **L1 字面量语义** | 理解字符串**内部**的 DSL：高亮、补全、校验、hover 解释 | IDE 自研（injection 框架） | 正则语法着色与错误、`%Y-%m-%d` 的解释、`{:.2f}` 的预览 |
| **L2 交互工具** | 面板/弹窗级的可试玩工具，通常需要求值 | IDE 自研（devtools 面板 + 求值桥） | 正则测试器、格式串预览器、Base64 工具（已有） |
| **L3 数据可视化** | 运行时对象的结构化呈现 | IDE 自研（DAP 求值 / intel 运行时） | DataFrame 表格、dict 树、调试变量面板 |
| **L4 项目级集成** | 探测项目用了什么 → 生成配置/面板 | IDE 自研（扫描 + 探测） | 框架探针（已有）、argparse 参数表单、依赖健康（已有） |

**关键判断**：L0 不该重复立项（引擎职责）；L3/L4 成本高、与本项目画像贴合度需逐个论证；**L1 + L2 是「库特别支持」的主战场**，也正是当前几乎空白的区域（`devtools` 里已有的 9 个内置工具全是通用文本工具，与 Python 库无关）。

### 2.2 立项判定标准（四条，缺一不做）

| 标准 | 含义 |
|---|---|
| **S1 画像高频** | 在「单人自用脚本 / 小项目」画像下高频；**全体 Python 开发者的热度 ≠ 本项目热度**（数据科学 51% 但项目不做 Jupyter，见 §0-7） |
| **S2 低风险可解** | 优先「静态可解」；若需求值，求值必须是**无副作用纯函数**（`re.match` / `strftime` / `struct.pack` 都是），且失败可优雅降级 |
| **S3 挂点契合** | 能落在现有挂点（DevTool 面板 / inline / hover / 诊断 / CodeLens / 侧栏 / 命令面板），**不新增窗口系统、不改外壳骨架** |
| **S4 差异化可能** | 优先能做 PyCharm 做不到的事（借 intel 运行时数据、借 Tauri 本地进程能力） |

---

## 3. 候选库全景

> 热度列：✅ = 有一手调查/官方数据；🔍 = 推断（生态常识 + 本项目画像）

### 3.1 标准库

| 库 | 热度 | 痛点 | 可做形态（层） | 成本 | 裁决 |
|---|---|---|---|---|---|
| `re` | ✅ 极高（🔍 字符串处理是脚本第一高频） | 正则写完只能靠跑一遍脚本验证；模式难读 | L1 高亮/诊断/hover + **L2 测试面板** | 中 | **P0** |
| `datetime`（`strftime`/`strptime`） | ✅ 极高 | 格式码（`%Y %m %d %H %M %S %z %j`）每次查文档 | L1 hover 解释 + L2 预览器 | 低 | **P0** |
| 格式规范 mini-language（`str.format` / f-string） | ✅ 极高 | `>10.2f`、`0=`、`{:,}`、类型码 `b/d/e/f/g/%` 难记 | L1 hover + L2 预览器（与上一项合并一个工具） | 低 | **P0** |
| `json` | ✅ 极高 | 源码里的 JSON 字面量没高亮/折叠/校验 | L1 注入（高亮+折叠+校验）；已有 jsonfmt/jsonpath 工具 | 低 | P1 |
| `logging` | ✅ 高 | `%(asctime)s` 格式串；运行输出里日志混在一起 | L1 格式串速查（并入格式串工具）+ **输出面板按 level 着色/过滤** | 低 | P1 |
| `argparse` | ✅ 高（脚本标配） | 参数多，每次手敲命令行 | **L4 参数表单 → 回填运行配置** | 中 | **P0** |
| `os.path` / `pathlib` | ✅ 高 | 路径写错只能运行才发现 | L1 存在性校验 + 路径补全 | 中 | P2 |
| `os.environ` / `.env` | 🔍 中 | 环境变量键名靠记忆 | L1 键名补全（读 `.env`） | 低 | P2 |
| `sqlite3` | 🔍 中 | SQL 写在字符串里无高亮；结果要另开工具看 | L1 SQL 高亮/美化；**L3 需 DB 连接（不做）** | 高 | P2（只做美化） |
| `subprocess` | 🔍 中 | `shell=True` 风险 | — | — | **不做**（ruff S602 已覆盖） |
| `struct` | 🔍 低 | `<4sI` 格式串难记 | L2 打包/解包预览 | 低 | **不做**（窄众） |
| `fnmatch` / `glob` | 🔍 低 | 模式测试 | L2 预览 | 低 | **不做**（并入正则/搜索已够用） |
| `asyncio` | ✅ 23% | 协程调试难 | L3 协程感知调试 | 很高 | **不做**（登记） |
| `typing` / `dataclasses` | ✅ 高 | — | — | — | **不做**（引擎主业，L0 已覆盖） |
| `unittest`（标准库测试） | 🔍 中 | 跑单个用例 | L4 测试运行器 | 中 | **不做**（pytest 裁决连带，§8） |

### 3.2 第三方 · 数据与科学

| 库 | 热度 | 痛点 | 可做形态 | 成本 | 裁决 |
|---|---|---|---|---|---|
| `pandas` | ✅ 极高（51% 数据探索，最常用） | 调试时只看到 `DataFrame` 不看到内容 | L3 运行时对象洞察（借 intel） | 高 | **P2 探针完成：放弃**（列不可得，§10.1-P3） |
| `numpy` | ✅ 极高（同上） | shape/dtype 看不见 | L3 同上 | 高 | **P2 探针完成：放弃**（同上） |
| `matplotlib` | ✅ 高 | 图要弹窗 | L3 图预览（需执行 + 渲染） | 很高 | **不做** |
| `polars` | 🔍 上升中 | 同上 | 同上 | 高 | **不做**（与 pandas 同档，等探针） |
| `scikit-learn` / `torch` / `transformers` | ✅ 高（整体数据/AI 占比过半） | IDE 层面没有可做的具体形态 | — | — | **不做**（L0 引擎已够） |

### 3.3 第三方 · Web / HTTP / 工程化

| 库 | 热度 | 痛点 | 可做形态 | 成本 | 裁决 |
|---|---|---|---|---|---|
| `requests` | ✅ 33% | 手写请求参数烦 | 已有 **cURL→Python** 工具；可补反向（Python→cURL） | 低 | P1 低 |
| `httpx` | ✅ 15% | 同上 | 同上（与 requests 共用规则） | 低 | P1 低 |
| FastAPI / Flask / Django | ✅ 38/34/35% | — | — | — | **不做**（归 `pycharm_framework_support_report.md`，已交付端点扫描） |
| `pydantic` | ✅ 高（FastAPI 底座） | 手写模型字段 | **L2「JSON → Pydantic/dataclass/TypedDict」生成器**（纯前端转换，无需求值） | 低 | **P1 高性价比** |
| `click` / `typer` | 🔍 中高（CLI 脚本） | 同 argparse | L4 参数表单（与 argparse 共用一套） | 中 | **P0**（与 argparse 同批） |
| `sqlalchemy` | 🔍 中 | SQL 表达式无高亮 | L1（弱） | 高 | **不做** |
| `jinja2` | 🔍 中 | 模板无语法高亮 | L1 需自建 Monarch 语言包 | 中高 | P2 / 不做 |
| `python-dotenv` | 🔍 中 | 见 os.environ | L1 补全 | 低 | P2 |
| `uv` | ✅ 11%（首年入榜即 11%） | — | — | — | **已覆盖**（依赖健康是既有主线） |

### 3.4 候选打分矩阵（Top 8）

| 候选 | S1 画像高频 | S2 低风险可解 | S3 挂点契合 | S4 差异化 | 合计 | 裁决 |
|---|---|---|---|---|---|---|
| re 三件套 | 5 | 4（需求值桥） | 5 | 3 | **17** | P0 |
| 格式串（strftime / format / %-format） | 5 | 5（纯函数） | 5 | 2 | **17** | P0 |
| argparse / click 参数表单 | 4 | 3（内省有副作用） | 4 | 4 | **15** | P0 |
| Python 求值桥（基建） | — | 4 | 5 | 4 | **13（乘数项）** | P0 基建 |
| JSON 字面量注入 | 4 | 5 | 4 | 2 | **15** | P1 |
| 日志级别着色/过滤 | 4 | 5 | 5 | 2 | **16** | P1（量极小） |
| JSON → Pydantic 模型 | 3 | 5 | 5 | 2 | **15** | P1 |
| pandas / numpy 运行时洞察 | 2（画像不符） | 2 | 3 | 5 | **12** | P2 探针先行 |

---

## 4. 重点候选卡

### 4.1 `re` —— 正则三件套（P0，2 天）

**痛点**：写正则的最高成本不是「写」，是「验证」——改一个模式要切到脚本/REPL 跑一遍，或者打开浏览器里的 regex101。IDE 里完全没有语义反馈：写错分组、忘了 raw string、flags 记错，全部要等运行。

**形态**：

| # | 能力 | 层 | 说明 |
|---|---|---|---|
| 1 | **字面量识别** | — | 扫 `re.compile/match/search/fullmatch/findall/finditer/sub/subn/split(<str>, ...)` 的第一个字符串实参；以及 `pattern = r"..."` 这类被上述调用引用的变量（v1 只做同一文件内的简单赋值）。**纯文本/词法扫描，零子进程**，对齐 `fs_cmds::scan_endpoints` 的先例（纯文本逐行解析，MAX 上限保护） |
| 2 | **诊断** | L1 | 无效模式（`re.error`）、未闭合括号、`[z-a]` 区间倒置、**非 raw 串中的 `\d`/`\b` 转义丢失警告**（`warning` 级，不阻断）、重复命名组。真值来自求值桥，离线时只做括号/区间等纯静态检查 |
| 3 | **hover 解释** | L1 | 人话分解：量词、分组（编号/命名）、字符类、锚点、flags 生效状态。可由 Rust 侧一个小型模式解析器产出结构化描述（**不依赖求值**，离线可用） |
| 4 | **正则测试面板** | L2 | DevTool `regex`：模式输入 + flags 复选（I / M / S / X / A）+ 测试文本 → 匹配列表（span 高亮、group 表、`findall`、`sub` 预览，替换串支持 `\1` 与 `\g<name>`）+「插入编辑器」 |
| 5 | **入口** | — | 命令面板「工具: 正则测试器」+ CodeLens/右键「在正则测试器中打开」（`codeVision.ts:255` 的 CodeLens 注册为样板）。面板打开时若光标落在正则字面量上，**自动带入模式与 flags** |

**真值纪律（不可违反）**：Python `re` 语义必须由 Python 给出。**无可用解释器时禁用求值并明示原因**（「需配置工作区解释器」），**绝不静默用 JS `RegExp` 近似**——这正是 `plugin_system_design.md` §9.7 当初放弃正则测试的根因（"JS `RegExp` 会误导 Python 用户"）。静态解释（第 3 项）可以离线工作，因为它是描述性的、不含"匹配结果"这种会被误导的信息。

**风险**：① flags 解析（`re.I|re.M` 与 `re.IGNORECASE` 两种写法，以及 `flags=` 关键字 vs 位置参数）；② `re.VERBOSE` 模式下空白与 `#` 注释需交给 Python 处理（离线高亮会略有偏差，登记为已知边界）；③ 多行/拼接/变量引用的模式识别不到（v1 不做，登记）。

**交互细节**：见 §11.3（面板线框 / 六态呈现 / CodeLens 共存规则 / 键位与降级文案）。

### 4.2 格式串：`strftime` + 格式规范 mini-language + `logging` %-format（P0，1.5 天）

**痛点**：三类格式串都是「每次写都查文档」：`%Y-%m-%d %H:%M:%S`、`{:>10,.2f}`、`%(asctime)s %(levelname)s`。它们共同点是**求值无副作用**——`datetime.now().strftime(...)`、`format(1234.5, spec)` 都是纯函数调用，完美契合 S2。

**形态**：

| # | 能力 | 说明 |
|---|---|---|
| 1 | **DevTool「格式串预览」** | 一个面板三种模式：日期格式码 / 数字格式规范 / logging 格式串；内置速查表（点击插入码位：可对齐 PyCharm 的文档面板形态）+ 示例值即时预览（走求值桥，输入防抖 200ms） |
| 2 | **hover 预览** | 光标落在 `%Y-%m-%d` 或 `{:>10.2f}` 上时，hover 显示「示例输出」（如 `2026-09-26`）与逐段解释 |
| 3 | **诊断** | 未知格式码（如 `%Q`、`{:q}`）标 warning；`strftime` 里出现 `%` 后跟非格式码字符标 warning |

**为什么合并成一个工具**：三者的求值桥脚本形态完全一致（一个 `format_preview(kind, spec, sample)` 即可），UI 也一致（速查表 + 输入框 + 预览），合并后成本约为分别做的 40%，且用户心智统一为「格式串」一类问题。

**降级**：无解释器时，日期/数字格式化可用 JS 近似（`Intl` + 自实现数字格式），因为这两者的语义在 JS 侧可忠实复现——**这与正则不同，不存在"误导"风险**；但更稳妥的做法是离线只给速查表、预览置灰并提示。建议 v1 就用后者（口径统一，省一个分支）。

**交互细节**：见 §11.4（三模式 radioGroup / 速查 chips / 等宽结果区 / hover 预览）。

### 4.3 `argparse` / `click` / `typer` —— 参数表单（P0，2 天）

**痛点**：自用脚本最典型的形态就是「一个文件 + 一堆 `--flag`」。现在每次运行都要手敲（或复用上次命令）。运行配置已有 `args: String`（`env_cmds.rs:187`）与 per-file `run_configs` map（`:247-318`），但**没有从代码反推参数 UI 的通道**。

**形态**：

| # | 能力 | 说明 |
|---|---|---|
| 1 | **静态扫描（主路径）** | 解析源码里的 `parser.add_argument("--input", type=..., default=..., help=..., required=...)`、`@click.option(...)`、`typer.Option(...)` → 产出参数表（`{name, flag, type, default, help, required, choices}`）。**AST 级解析优于正则**：建议用 Python 侧 `ast` 模块（走求值桥的受控脚本）而非 TS/Rust 侧手写正则——`ast` 解析 `add_argument` 的字面量参数是稳的，且不需要 import 用户模块（**无副作用**） |
| 2 | **参数 UI** | 侧栏新视图或运行面板内的表单：文本框/勾选/下拉（choices）→ 拼出命令行 →「运行」「调试」按钮复用现有 run/dap 通道；同时可「回填到运行配置 args」 |
| 3 | **内省兜底（可选，默认关）** | 对 `click`/`typer` 这类装饰器栈，`ast` 读不到运行时的默认值，可用 `import` + `parser._actions` 内省——**但会执行用户模块顶层代码（副作用）**，必须：① 默认关闭，用户显式点击「用内省刷新」才跑；② 独立子进程 + 超时（复用 `run_with_timeout`）；③ 明确提示「将执行脚本顶层代码」；④ **内省受控脚本须显式 `sys.path.insert(0, os.getcwd())`**——求值桥统一带 `-I`（隐含 `-P`），cwd 不在 `sys.path`，不补这一条用户模块不可导入、内省必然失败（v1.3 补） |

**判定**：S1 中等（脚本作者高频，非全体）、S3 好（复用了运行配置与运行/调试通道）、S4 强（PyCharm 只对少数框架有这能力，通用 argparse 表单基本没有）。风险集中在 click/typer 的静态解析覆盖率，v1 只承诺 argparse 完整 + click 基础。

**交互细节**：见 §11.5（类型→控件映射 / 三态 / 内省的副作用确认 / 命令行与表单的双向同步纪律）。

### 4.4 JSON 字面量注入 + JSON→模型（P1，2 天）

- **JSON 注入**：源码里的 JSON 字符串字面量（`'{"a": 1}'`）无高亮/折叠/校验。已有 `devtools/jsonfmt` 的解析与 `jsonpath` 的树视图可复用；L1 注入只做 decorations + 折叠 + 语法诊断。
- **JSON → Pydantic / dataclass / TypedDict 生成**：**纯前端转换、零求值**，把剪贴板或选区 JSON 转成带类型注解的模型代码并插入编辑器。痛点真实（写模型烦），成本低，且**顺带强化 pydantic 生态的存在感**（已有 `detect_pydantic_stack` 提示链路）。

**交互细节**：见 §11.6（右键三项只是给已有 jsonfmt / jsonpath 补编辑器入口，零新功能成本）。

### 4.5 日志级别着色/过滤（P1，0.5 天）

运行输出面板（`output.ts`）目前是纯文本流。加一层按 level 的着色 + 过滤按钮（`DEBUG/INFO/WARNING/ERROR`），对任何用 `logging` 的脚本都立刻可感知。实现只需在输出行上做前缀匹配（`[ERROR]` / `ERROR:` / `%(levelname)s` 渲染后的形态）——**不需要求值桥**，成本极低，属「顺手但高感知」。

**交互细节**：见 §11.7（过滤 chips 多选语义、默认只着色不过滤、错误行复用既有 traceback 跳转）。

### 4.6 pandas / NumPy（P2，探针先行 → **✅ 探针完成：登记放弃**）

- 数据（§1）显示数据科学占 Python 的 51%，但**本项目画像是自用脚本**（dev plan v2 §1.1 且已裁决 Scientific 模式不做），故 S1 只给 2 分。
- 唯一值得探的是**差异化路径**：intel 的 hover 已能给出「运行时类型 + shape（dict 键 / 实例属性名）」（`intel/README.md` P3-T05）。探针问题：**对 `df = pd.read_csv(...)` 这类变量，intel 实际能提供什么？**（DataFrame 的列是数据不是属性，shape 大概率给不到列）。若探针能给到「类型 + 列集合」，则可做一个轻量「运行时对象卡」；否则登记放弃，不做 DataFrame 查看器（那需要 DAP evaluate + 大规模序列化，成本高且会拖慢调试）。
- **✅ P3 探针结论（2026-09-27，§10.1）**：type_label 正常（`pandas.DataFrame`），但 shape 只采到私有属性名（`_mgr` 等），**列集合不可得** → **登记放弃**。numpy 同批放弃（`ndarray` 无 `__dict__`，shape 为 None）。

**交互细节**：见 §11.8（只做变量行 chip + 列 chips，明确不做表格查看器）。

---

## 5. 关键使能器：Python 求值桥（`py_eval`）

> **这是本批工作的真正基建**，也是正则测试器从「v1 放弃」转为「可做」的唯一解锁路径。

### 5.1 为什么需要它

| 需求 | 能否用 TS/JS 实现 | 结论 |
|---|---|---|
| 正则匹配/group/sub | ❌ JS `RegExp` 与 Python `re` 语义不一致（命名组、`\d` 的 Unicode 行为、`re.X`、`sub` 反向引用、flags 名） | 必须 Python |
| `strftime` / 数字格式规范 | ⚠️ 可用 `Intl` 近似，但 `%` 码表与 Python 的 locale 行为有差异 | 建议 Python |
| `struct.pack` | ❌ 字节序/对齐语义需精确 | 必须 Python |
| `ast` 解析 `add_argument` | ❌ 无 Python AST | 必须 Python |
| pandas 对象探针 | ❌ | 必须 Python |

### 5.2 设计（对齐既有先例，不另起炉灶）

**已有可直接抄的先例**：`env_cmds.rs:880-911` 的 `check_missing_imports_impl` —— `Command::new(interpreter).arg("-c").arg(SCRIPT).arg(arg).current_dir(dir)` + `run_with_timeout(10s)` + stdout JSON 反序列化。求值桥就是把这个模式**泛化为受控脚本表**。

```rust
// 建议落点：shell/src-tauri/src/lib_cmds.rs（新增，lib.rs generate_handler! 加一行）
#[tauri::command]
pub async fn py_eval(
    workspace_root: String,
    kind: String,          // "regex_test" | "format_preview" | "ast_argparse" | ...
    args_json: String,     // 结构化入参（JSON）
) -> Result<String, String>   // stdout 单行 JSON
```

| 要素 | 方案 |
|---|---|
| **脚本来源** | **内置受控脚本表**（Rust 侧常量或随包分发的 `.py`），`kind` 为白名单枚举。**不开放任意代码执行**——这是与「插件 Python 桥」（v2 议题，见 `devtools_plugin_acceptance_record.md` §六）的分界：v1 只给内置工具用 |
| **解释器** | ✅ **探针 P1 定案**：`env_cmds::get_interpreter(workspace_root)`（`env_cmds.rs:733`）；返回 `None`（= 显式 `uv run` 兜底）时**不是每次跑 `uv run`**，而是先 `uv python find`（**125ms**）拿到项目解释器路径并**按工作区缓存**，之后直连它（**~179ms**）——比每次 `uv run`（**~475ms**）省约 60%。与调试启动的 `uv_fallback`（`dap.rs:356`）同策略但更快。⚠️ **P1b 补测修正（v1.3）**：`.venv` **不存在**时 `uv python find` 返回的是 **uv 管理的系统解释器**（实测指向 `…\uv\python\cpython-3.12…\python.exe`），不是项目解释器 → **仅当 find 结果确认位于工作区 `.venv` 内才允许缓存**；`.venv` 创建/重建后缓存失效重解析 |
| **启动参数** | ✅ **P1**：一律带 **`-I`**（isolated）——实测 **126ms vs 257ms**（快约 2 倍，且忽略 `PYTHON*` 环境变量与用户 site，语义更可预测、更安全）。✅ **v1.3 补：命令定档 `python -I -X utf8 -c`**——`-I` 同时忽略 `PYTHONIOENCODING`/`PYTHONUTF8`，Windows 子进程 stdout 默认 locale 编码（cp936），`re.error` 原文等含非 ASCII 的错误信息会破坏 stdout JSON；`-X utf8` 不受 `-I` 影响，强制 UTF-8 stdio。Rust 侧同时按 UTF-8 字节显式解码，不依赖系统 locale |
| **入参传递** | ✅ **v1.3 定案**：`kind` 走 argv（白名单枚举，短字符串）；**`args_json` 一律走 stdin**（受控脚本统一 `json.loads(sys.stdin.read())`）。理由：正则模式大量出现引号、反斜杠、**换行**（`re.X` 多行是 §11.3.2 明确支持场景），Windows 命令行有 ~32K 长度限制与引号转义陷阱；`check_missing_imports_impl` 的 argv 传参先例只传短路径参数，不适用于本场景 |
| **cwd** | 工作区根（`lsp_start` 的 cwd 教训：cwd 错会静默改变语义——此处同样关键，用户脚本的相对路径依赖它） |
| **超时** | ✅ **P1 实测定档**：直连 **3s**（实测 126–180ms，15 倍余量）；`uv python find` 首次解析 **8s + 进度提示**（无 `.venv` 冷启动补测 **965ms**——P1b，零依赖项目首跑创建 `.venv`，有 `.venv` 后回落稳态 ~477ms，与 `uv run` 一致）；`ast_argparse` 类 5s |
| **输出协议** | stdout 单行 JSON（`{"ok":true,"data":...}` 或 `{"ok":false,"error":"..."}`）；stderr 全部吞掉并入 error 字段；**非 0 退出一律视为失败**。✅ v1.3 补：Rust 侧按 **UTF-8 字节显式解码**（配合 `-X utf8`，见「启动参数」行），不得依赖系统 locale |
| **缓存/防抖** | ✅ **P1 支持**：输入防抖 **200ms**（单次求值 126–180ms，防抖后一串输入一次求值，交互无顿挫）；前端按 `(kind, args)` LRU（上限 100）；**新增**工作区级解释器路径缓存（`uv python find` 结果，换工作区/换解释器时失效） |
| **安全边界** | ✅ **D-4 裁决：仅内置受控脚本表**——`kind` 白名单枚举、**不开放任意代码执行**；只读：不写文件、不访问网络；入参不参与 `import`；`ast_argparse` 之外没有任何 kind 会加载用户代码。第三方插件开放留到 v2 议题（需沙箱/权限模型） |
| **降级** | 无解释器且 `uv` 不在 → 返回结构化错误码 `NoInterpreter`，前端**明确提示并禁用求值**，不静默近似 |

### 5.3 它解锁什么

一座桥，六个受益方：正则测试器 · 格式串预览 · struct 预览 · `ast` 参数解析 · pandas 探针 · 未来的插件 Python 工具桥（v3 议题的落地形态）。**这是「一次投入、多次复用」的典型基建，建议排在最前面。**

---

## 6. 落地挂点映射（都能接，不需要改外壳骨架）

| 形态 | 落点 | 锚点（2026-09-26） |
|---|---|---|
| 工具面板 | `devtools/builtin/<tool>.ts` + `BUILTIN_TOOL_MODULES` / `BUILTIN_MANIFEST.contributes.tools` 各加一行 | `devtools/builtin/index.ts:21`、`devtools/builtin/index.ts:46` |
| 选区变换 | manifest 的 `inline: {label, handler}` | `extensions/manifest.ts:29`、`extensions/inline.ts` |
| 命令面板入口 | `buildQuickOpenActions` | `main.ts:1339` 起 |
| 编辑器右键 | `editor.addAction` + `contextMenuGroupId` | `findUsages.ts:287` / `renameWidget.ts:313` 为样板 |
| CodeLens 入口 | `registerCodeLensProvider("python")` | `codeVision.ts:255` |
| Hover | 现有合并管线（静态 + intel） | `lsp/client.ts:714` |
| 诊断 | 新增第四桶 owner（建议 `opencharm-libs`），与 `opencharm-lsp`/`opencharm-intel`/`opencharm-ruff` 并列（lsp/intel 桶在 `client.ts:1572-1581` 的 diagnosticsCache 按 owner 分桶；ruff 桶常量在 `ruffLint.ts:30`） | `lsp/client.ts:1572-1581`、`ruffLint.ts:30`（v1.3 修正：原引 1523 行为 inlay hints 注册处） |
| 字面量高亮 | Monaco decorations（自研扫描器产出 range） | —（新增） |
| 侧栏视图（参数表单可能用到） | `views.ts` 注册表，现 6 个视图 | `views.ts`、`main.ts:2391-2434` |
| 求值 | **新增** `py_eval`（§5） | `lib.rs` generate_handler |
| 设置开关 | 4 处接线：`Settings` struct + `DEFAULT_SETTINGS` + index.html 控件 + `settingsPanel`，Rust `Settings::default` 同步 | `settings.rs:101-213`、`state.ts:104`、`settingsPanel.ts:485/569` |
| 库探测门控 | 已有 `dep_scan` 的 import 统计与 `check_missing_imports`；**新增**「命中某库才启用某提示」的门控（如未 import `re` 时不显示正则相关入口） | `env_cmds.rs:2943`、`env_cmds.rs:871`、`stdlib.ts`（v1.4 评估结论：**不做**——识别规则本身限定在 `re.<api>(` / `.strftime(` / `json.loads(` 等调用点的字面量上，未写调用就没有任何入口，「按调用点出现」已是精确门控；工作区级 import 统计反而对单文件脚本失真，且增加 dep_scan 耦合） |

---

## 7. 优先级裁决与路线图

### 7.1 P0（第一批，约 5–7 个工作日，建议按序）— ✅ D-1 裁决：全量 4 项启动

| # | 项 | 量级 | 依赖 | 说明 |
|---|---|---|---|---|
| 1 | **`py_eval` 求值桥** | 1 天 | — | 基建先做；含 Rust 单测（脚本表白名单、超时、JSON 协议、无解释器降级） |
| 2 | **re 三件套**（识别 + 诊断 + hover 解释 + 测试面板 + CodeLens 入口） | 2 天 | #1 | 用户最初提出的需求；§4.1 |
| 3 | **格式串工具**（strftime / 格式规范 / logging %）+ hover 预览 | 1.5 天 | #1 | §4.2；单位成本价值最高 |
| 4 | **argparse/click 参数表单 → 运行预填** | 2 天 | #1（`ast` 脚本） | §4.3；最贴合自用脚本画像 |

### 7.2 P1（第二批，约 3.5 天，独立 PR）

| # | 项 | 量级 |
|---|---|---|
| 5 | 输出面板日志级别着色/过滤 | 0.5 天（**不依赖 #1**，可与 P0 并行/插空） |
| 6 | JSON → Pydantic / dataclass / TypedDict 生成器（DevTool） | 1 天（纯前端） |
| 7 | JSON 字面量注入（高亮 + 折叠 + 诊断） | 1 天 |
| 8 | **内嵌 DSL 注入框架化**（把 正则 / 格式串 / 日期码 / JSON 的识别规则收敛成一张规则表 + 统一 dispatcher） | 0.5 天（重构，建议放在 #2/#3 之后回头做） |
| 9 | **requests / httpx → cURL 反向生成**（Python 代码 → cURL 命令，补齐既有 cURL→Python 工具的反向；静态解析调用实参，无需求值） | 0.5 天（v1.3 补：§3.3 已标 P1 低，原漏排期） |

### 7.3 P2（探针先行，不成立即放弃）

| # | 项 | 前置 |
|---|---|---|
| 9 | pandas / NumPy 运行时对象洞察 | 探针 P3（§10） |
| 10 | SQL 字面量格式化（纯美化，不接 DB） | — |
| 11 | `.env` / `os.environ` 键名补全 | — |
| 12 | Jinja2 语法高亮（需自建 Monarch 语言包） | 评估后决定 |

### 7.4 横切纪律

- 新增设置项一律 4 处接线 + `!== false` 兼容旧配置（对齐 `dx_features_backlog.md` §6 通用纪律）。
- provider / 监听器返回值入 `DisposableStore`，禁止丢弃。
- 诊断新桶不得破坏 `quickFix.ts` 的双桶口径（现有「查全量不带 owner 过滤」的做法已验证更宽更安全）。
- 求值桥的任何新增 `kind` 必须 simultaneously 提供：白名单条目 + 超时档位 + 无解释器降级文案。
- 主干开发 + 短分支 PR，CI 全绿才可合并。

---

## 8. 明确不做（含理由，避免反复复议）

| 项 | 理由 |
|---|---|
| ~~**pytest / unittest 面板、gutter 单测入口、结果树**~~ | **已变更（2026-10-16）**：`dev_plan_v2` v2.2 §1.1 修订为分层裁决——测试运行器（发现 / 结果树 / gutter 入口）已纳入范围，真源 `docs/pytest_dev_plan.md`；维持不做收敛为：独立结果面板与断言差异对比窗、覆盖率、watch、pytest 插件注入。unittest 无专属路径（pytest 可跑 unittest，连带覆盖） |
| **Jupyter / Scientific 模式、matplotlib 图预览** | dev plan v2 §1.1、`python_run_dev_plan.md:591` 明列不做；图预览需执行 + 渲染，成本极高 |
| **asyncio 协程感知调试** | 调试能力刚完成最小闭环（`debug_acceptance_record.md`）；协程调试是独立深水区，与库支持无关 |
| **sqlite / 数据库工具窗** | 需连接管理、schema 缓存、结果表格，属独立产品线；本项目无 DB 基建 |
| **SQLAlchemy / Django ORM 深语义** | 与 `pycharm_framework_support_report.md` 的结论一致：框架深语义投入产出比极低 |
| **Jinja2 完整语言包** | 需自建 Monarch tokenizer + 语义（模板继承/自定义 filter），成本高而本画像覆盖面低 |
| **`struct` / `fnmatch` / `glob` 预览** | 窄众；`glob` 需求已被「全局搜索 + 文件 glob 过滤」（backlog PR-H）覆盖 |
| **`subprocess` 安全检查** | ruff 规则（S602 等）已覆盖，重复 |
| **`typing` / `dataclasses` 增强** | L0 引擎主业，pyrefly 已覆盖 |
| **LLM SDK（openai / anthropic 等）** | 生态变化快，IDE 层面无稳定可做的形态 |
| **`pathlib` 路径补全（v1）** | 需要文件系统语义 + 字符串上下文判定，性价比低于上述各项 |

---

## 9. 验收与测试建议

| 层 | 内容 |
|---|---|
| **vitest 纯函数** | 正则字面量识别器（含 raw/非 raw、关键字/位置 flags、多行边界）；格式串解释与速查表映射；argparse AST 结果 → 表单模型的转换 |
| **Rust 单测** | `py_eval` 的 kind 白名单与超时分支、JSON 协议解析、无解释器降级；**stdin 传参（含含换行/引号/中文的 args_json）与 UTF-8 字节解码**（v1.3 补）；`ast` 脚本对典型 `add_argument` 形态的解析（参照 `fs_cmds.rs` impl 级 `#[test]` 模式） |
| **e2e** | 面板域：打开正则测试器 → 输入模式与测试串 → 断言匹配高亮与 group 表；CodeLens/右键入口带入当前正则；格式串 hover 预览；参数表单拼出命令行并落进运行配置 |
| **e2e（交互契约，§11）** | 六态逐一断言：空态 chips / 无匹配中性文案 / 非法模式显示 `re.error` 原文 / 超时提示 / 无解释器降级置灰 + 引导按钮 / 结果截断徽标；`sourceDirty` 后「替换字面量」置灰；面板切走再切回用户输入不被覆盖；lens 与引用 lens 同屏顺序与数量上限；窄屏 360px 下 flags 行换行不被裁切 |
| **e2e 基建** | tauri-mock 需新增 `py_eval` 命令的假实现（对齐既有 `plugin:*` 命令族的 mock 先例），并覆盖「无解释器」分支 |
| **回归** | 键位/设置类改动跑全量回归（参照 PR-G 的做法）；诊断新桶确认不干扰 ruff/lsp/intel 三桶 |

---

## 10. 探针

### 10.1 已完成（2026-09-27 实测）

> 脚本：`bench/lib-support-probe/p1_eval_timing.py`（P1）· `p1b_coldstart.py`（P1b，v1.3 补测）· `p2_regex_probe.cjs` + `regex-ws/`（P2）· `shell/e2e/_probe/monaco-perf.*`（P6）
> 报告：`bench/reports/lib-support-probe-p1.json` / `-p1b-coldstart.json` / `-p2.json` / `-p6.json`
> P1b 环境注：uv 0.11.16 / Python 3.13.3（原 P1 在他机为 uv 0.11.21 / Python 3.13.14），数字供定档参考、非同机对比

#### P1 · 求值桥耗时基线（**结论：可行，且找到 60% 提速手段**）

| 用例 | cold | warm 均值 | 结论 |
|---|---|---|---|
| `python -c`（直连） | 304ms | **257ms** | 基线 |
| `python -I -c`（isolated） | 99ms | **126ms** | **快 2 倍 + 更安全 → 定为默认** |
| `uv run python -c`（有 `.venv`） | 607ms | **475ms** | 每次调用都有解析开销 |
| `uv run --no-project` | 430ms | **466ms** | 与项目模式无显著差异，**不采用** |
| `uv python find` | 121ms | **125ms** | 一次性，可缓存 |
| **缓存 `uv python find` 结果后直连 `-I`** | 187ms | **179ms** | ✅ **采用**：省 ~300ms/次（约 60%）。口径注（v1.3）：本行解释器是 `.venv` 内解释器，而「直连 `-I` 126ms」行是系统直装解释器——差值约 50ms 是 venv 启动器（`pyvenv.cfg` 重定向）开销，**不是缓存策略的额外成本** |
| 首次（无 `.venv`，需创建环境） | **965ms**（P1b 补测） | 477.5ms | 一次性，需进度提示 + 8s 超时（v1.3 修订：原引 1017ms 无报告留痕，已替换为 P1b 实测） |

- **定档**：防抖 200ms、`-I` 默认、直连超时 3s、`uv python find` 首次 8s + 进度提示。
- **新增设计**：工作区级**解释器路径缓存**（`uv python find` → 缓存 → 直连），换工作区/换解释器失效。这一条把"uv 兜底 = 慢"的风险消掉了。
- ✅ **P1b 补测修正（v1.3）**：上条「附」的前提**只在 `.venv` 已存在时成立**——`.venv` 不存在时 `uv python find` 返回 **uv 管理的系统解释器**（实测 `…\uv\python\cpython-3.12…`，不是项目解释器），`.venv` 创建后才切到 `ws\.venv\Scripts\python.exe`（与 `uv run python` 的 `sys.executable` 一致）。→ **缓存条件收紧**：仅当 find 结果确认位于工作区 `.venv` 内才缓存；否则每次解析（125ms 仍远优于 `uv run` 的 475ms）。

#### P2 · pyrefly 对字符串内 DSL 的支持度（**结论：零支持，L1 必须自研**）

受控样本（`regex-ws/regex_probe.py`）含 6 类痛点：未闭合分组 `r"([a-z"`、区间倒置 `[z-a]`、非 raw 串 `"\d+"`、非法格式规范 `{:q}`、未知字段 `{nope}`、非法 `%-format` `%Q`。pyrefly 1.3.1 实测：

| 检查项 | 结果 |
|---|---|
| 诊断总数 | **0**（6 类痛点一条都没报，含 `str.format` 的非法规范与未知字段） |
| 提及 regex/format/strftime 的诊断 | **0** |
| hover（字符串内部） | 只有 `Literal['([a-z']` 一类字面量类型，**无任何 DSL 解释** |
| hover（`re.compile` 标识符） | ✅ 正常给签名（L0 引擎能力，不是我们能复用的部分） |
| 字符串内触发补全 | **0 项** |

- **定案**：L1（正则诊断 / 格式串校验 / hover 解释）**全部自研，无引擎可依赖**；且**不能指望 pyrefly 提供任何"字符串内"能力**（连 `str.format` 的字段校验都没有）。
- 旁证：这 simultaneously 说明我们的注入能力是**净增量**，不会与引擎重复打架。

#### P6 · 面板内只读 Monaco vs span 覆盖层（**结论：Monaco 完胜，Q2 关闭**）

环境：Headless Chrome 153 · 容器 360×200（真实面板宽度）· 文本 3470 字符 / 40 行 · 500 处高亮。

| 指标 | 实测 |
|---|---|
| 第 1 个只读实例创建 | **143ms**（含模块首次实例化；产品里 Monaco 早已加载，实际更低） |
| **第 2 / 3 个实例创建** | **7.8ms / 9.3ms**（← 这才是"面板里再开一个"的真实边际成本） |
| 500 条 decorations 首次应用 | **8.0ms**（下一帧 9.3ms） |
| 500 条 decorations 增量更新 | **3.9ms**（下一帧 3.6ms） |
| `setValue`（整体替换） | 5.2ms（下一帧 19.3ms） |
| **对照：span 覆盖层 500 span** | **10.7ms**（下一帧 4.6ms） |
| dispose 3 个实例 | 12.4ms |
| 页面错误 | 0 |

- **定案**：测试文本用**只读 Monaco**。理由不仅是性能——**边际创建仅 ~8ms、500 处高亮 4–8ms**，而 span 覆盖层反而更慢（10.7ms）且**没有**点击定位（`revealRange` + `setSelection`）、滚动、大文本虚拟渲染、换行折叠。
- **已知边界**：堆内存增量测量无效（`performance.memory` 被 Chrome 量化，delta 恒为 0），内存开销需在实现期用真实面板复测；>100KB 文本未测。

#### P7 · 面板内第二个 Monaco 实例的内存（**结论：CACHE_MAX=5 维持；顺带发现并修复 6 工具泄漏**）

探针 `shell/e2e/libs/04-monaco-memory-r5.spec.ts`（CDP JSHeapUsedSize + 强制 GC，vite dev + tauri mock 真实面板）：

| 指标 | 实测 |
|---|---|
| 激活态堆增量（Monaco 实例 #2 + 面板 DOM） | **~3.2MB** |
| LRU 缓存隐藏态驻留 | **~4.3MB** |
| 关面板 dispose-all 回收 | ~1.5MB（残余 ~3.7MB 为一次性成本：模块代码 + Monaco 静态结构） |
| 重挂堆趋势（修复前） | **+1.2MB/轮线性累积（真实泄漏）** |
| 重挂堆趋势（修复后） | ~0.14MB/轮且逐轮收敛（平台） |

- **定案**：**CACHE_MAX=5 维持不变**（驻留远低于内存红线顾虑）。
- **复测发现的真实缺陷（已修复）**：`hash / base64 / urlcode / uuid / jsonfmt(×2) / json2model` 六个内置工具 `mount` 未返回 `dispose`，其 `kit.output` Monaco 实例在面板关闭 / LRU 逐出后永不释放；已补齐，详见开发计划 v1.2 §9 R-5 回填。
- **测量注意**：CDP `Runtime.enable` 会保留 console 消息参数引用造成伪泄漏，GC 前须 `Runtime.discardConsoleEntries`。

#### P3 · intel 对 pandas / NumPy 运行时变量的实际输出（**结论：列集合不可得 → 登记放弃**）

探针 `bench/lib-support-probe/p3_pandas_probe.py`（pandas 3.0.6 / numpy 实测；intel hover 的 shape 唯一来源是 probe `compact.shape_fingerprint`，故其输出即 intel 将呈现的内容）：

| 对象 | type_label | shape（intel hover「字段」） | 列信息 |
|---|---|---|---|
| `pd.read_csv(...)` | `pandas.DataFrame` | `["_attrs","_flags","_mgr"]`（私有属性） | ✘ |
| `df["age"]` | `pandas.Series` | `["_attrs","_flags","_mgr","_name"]` | ✘ |
| `np.zeros((2,3))` | `numpy.ndarray` | `None`（无 `__dict__`） | ✘ |
| 对照 dict | `dict[str, str\|int]` | 键集合（既有能力正常） | — |

- **定案**：列在 DataFrame 内部 `_mgr.blocks` 结构中、非对象属性，probe 现有 shape 采样（dict 键 / 实例 `__dict__` 属性名）拿不到列集合 → 按 §4.6 预判分支**登记放弃**「运行时对象卡 / DataFrame 查看器」。若未来要做，需 probe 侧为 pandas 专门扩展 shape 提取（识别 DataFrame 后改采 `df.columns`），成本中等、与本画像贴合度低，暂不立项。

### 10.2 待跑（实现期）——已全部完成或关闭

| # | 探针 | 结论 | 何时 |
|---|---|---|---|
| **P3** | intel 对 `df = pd.read_csv(...)` 的 hover 实际输出（是否含列信息） | **放弃**（列不可得，见 §10.1-P3） | ✅ 2026-09-27 |
| **P4** | tauri-mock 能否注入 `py_eval` 命令 | ✅ 可注入（`__E2E_PY_EVAL__` 四态切换） | ✅ PR-1 实现期 |
| **P5** | 大文件上 decorations 的性能 | ✅ 落地为 500KB 扫描闸门（`dslLens.ts` `MAX_SCAN_CHARS`） | ✅ PR-2 实现期 |
| **P7** | 面板内第二个 Monaco 实例的内存开销 | ✅ CACHE_MAX=5 维持 + 修复 6 工具泄漏（见 §10.1-P7） | ✅ 2026-09-27 |

---

## 11. 交互设计详规

> 本章是「做之前先把交互想透」的产物：所有形态、状态、冲突规则、文案都在动手前定死，实现阶段只做填空题。
> 约定：线框为**结构示意**（非像素稿）；所有控件优先复用 `devtools/kit.ts` 积木；面板窄屏按 360px 兜底。

### 11.0 五条交互总纲（不可违反）

| # | 原则 | 具体含义 |
|---|---|---|
| **I-1** | **被动反馈优先，绝不打断** | L1（高亮 / hover / 诊断）全部被动：**不弹窗、不自动打开面板、不自动改代码、不抢焦点**。L2 工具只在用户显式打开时出现。任何"顺手帮你改代码"的行为一律不做 |
| **I-2** | **在「写的当下」被发现** | 每个工具**必须有编辑器内入口**（CodeLens / 右键）。面板 picker 与工具菜单只是补充入口——用户不会为了验证一个正则去菜单里翻工具。发现性 = 这个功能是否存在 |
| **I-3** | **真值不打折** | 涉及 Python 语义的结果，要么给真值，要么明确说"给不了"并说明原因（无解释器 / 超时）。**绝不用近似值冒充真值**（正则的教训，§0-4） |
| **I-4** | **写回编辑器一律可撤销** | 插入/替换走 `executeEdits` / `pushEditOperations` 保持单一撤销粒度（`dx_features_backlog.md` PR-C 教训：只有"保存动作"才用整文 `setValue`） |
| **I-5** | **同屏不抢位** | 行上方已有引用 CodeLens、行号槽已有断点与运行 gutter。**新增能力一律不占 gutter**；CodeLens 有数量上限与共存规则（§11.1） |

### 11.1 编辑器内入口：三件套与冲突规则

| 入口 | 形态 | 可发现性 | 适用 | 备注 |
|---|---|---|---|---|
| **CodeLens（行上方）** | `🧪 测试正则` | **最高**（写的时候就在眼前） | 正则 / 格式串 / 参数 | 主力入口，成本也最高（需在现有 lens 旁边共存） |
| **右键菜单** | 「在正则测试器中打开」 | 中 | 全部 | `editor.addAction` + `contextMenuGroupId`（`findUsages.ts:287` 为样板） |
| **命令面板** | 「工具: 正则测试器」 | 低（要记得名字） | 全部 | `buildQuickOpenActions` 注入 |
| **工具菜单 / picker** | 按 category 分组 | 低 | 全部 | 走 `BUILTIN_MANIFEST` 一行即可 |
| **键盘** | `open_regex_tester` | 中（需记住） | 正则 | 建议 `Ctrl+Alt+R`，**editor 级 + `when: editorTextFocus`**（PR-A/B 教训：不带焦点态的规则会静默不触发） |

**CodeLens 共存规则**（这是最容易出问题的一处，必须定死）：

1. 一行最多 **2 条** lens，顺序固定：`[工具] [N 处引用]`——引用计数是既有高频项，**不被新入口挤掉**。（✅ D-2 裁决确认）
2. 同一行同时命中两种 DSL（如 `re.sub(r"...", "%Y-%m-%d", s)`）→ **只出一条**聚合 lens：`🧪 测试（正则/格式串）`，点击后面板按**光标所在位置**自动选模式。（✅ v1.4 补齐：`dslLens.ts` 按行聚合正则+格式串；格式串字面量同步获得 `🧪 测试格式串` lens，面板经 `libsBridge` 带入模式与格式串）
3. **单文件 lens 上限 20**：超出时只对可见区域 + 光标附近 ±50 行出，避免长文件满屏 lens（CodeLens 还会改变行的视口位置——glyph 点击 flake 的教训：lens 插入 view zone 会顶偏行位置，数量必须受控）。✅ v1.5 收口：**参数 lens 占用同一 20 条预算**，且 libs 侧每行最多 1 条（第 1 行已有工具 lens 时不再叠参数 lens，避免与引用 lens 合计 3 条）。
4. 开关 `libs_editor_lens`（默认开）：关掉后入口全部降级到右键 + 命令面板，面板本身仍可用。
5. **首次命中引导**：某工作区第一次识别出正则字面量时，toast 一次「提示：右键 → 在正则测试器中打开」（只提示一次，标志写进 workspace config，与 `framework_hints` 同文件同机制）。低成本解决"不知道有这功能"。（✅ v1.4 落地：标志 `framework_hints["regex_tester_intro"]`，读取走新命令 `is_framework_hint_disabled`）

**gutter 纪律**：断点（`debugGutter`）、运行（`runGutter`）、诊断图标已占满行号槽语义，**库支持一律不进 gutter**。

### 11.2 求值类面板的统一交互契约

凡是需要 `py_eval` 的工具，共用同一套状态机与呈现规则（避免每个面板各写一套）：

```
输入变更 ──200ms 防抖──▶ py_eval ──▶ ok      : 渲染（上次结果先置 stale 灰显，收到后刷新）
                              ├──▶ err      : 红字原文 + 保留上次结果（灰显，标注「上次结果」）
                              ├──▶ timeout  : 「求值超时（3s）」
                              └──▶ no_interp: 求值区整块置灰 + [设置解释器] 引导
```

| 规则 | 说明 |
|---|---|
| **防抖 200ms** | 对齐 intel 的 150ms 惯例取 200（跨进程更贵）；`Ctrl+Enter` **立即求值**跳过防抖 |
| **陈旧灰显而非清空** | 求值期间保留上次结果并降透明度 + 顶部细进度条。**不要 spinner、不要清空**——表格高度抖动是最难受的体验 |
| **结果上限** | 统一「仅显示前 N 项」+ 总数徽标：匹配 500 / JSON 键 200 / 参数无上限 |
| **错误展示原文** | Python 异常原文（如 `re.error: missing ) ... at position 12`）**不翻译、不改写**，并在输入框内把出错位置 caret 定位（比"模式无效"四个字有用十倍） |
| **写回三动作** | 统一命名：**复制** / **插入编辑器** / **替换字面量**。第三个仅在「内容来自编辑器且未被手工修改」时可用（见下） |
| **`sourceDirty` 标志** | ① 面板内容被手改过 → 「替换字面量」**置灰**（防止误改用户已编辑的源码）；② 从编辑器带入的新内容**不覆盖**用户手改过的内容（否则每次切回面板都丢输入——面板 LRU 缓存保留输入的既有机制会放大这个坑） |
| **窄屏 360px** | flags / chips 行 `flex-wrap`（缺陷 #19 教训：按钮被 overflow 裁掉一半）；表格横向滚动；按钮就近结果区 |

### 11.3 正则测试器（P0 核心）

#### 11.3.1 面板线框

```
┌ 正则测试器 ────────────────────────────────────────┐
│ 模式   [ r"\b(\w+)@(\w+)\.com"              ]  I·M │  ← 可编辑；尾部 flags 摘要徽标
│ flags  [I✓][M][S][X][A]                            │  ← 多选 → aria-pressed 按钮组
│ ⚠ 源码中不是 raw 字符串："\d" 请写成 r"\d"           │  ← 条件提示条（仅非 raw 时出现）
│ ────────────────────────────────────────────────── │
│ (•) 匹配    ( ) 替换                                │  ← 互斥视图 → radioGroup
│ 测试文本                                            │
│ ┌───────────────────────────────────────────────┐ │
│ │ contact: alice@corp.com, bob@corp.com   [2 处] │ │  ← 只读区；奇偶交替高亮
│ └───────────────────────────────────────────────┘ │
│ ┌ # ┬ 位置 ┬ 匹配 ─────────┬ 分组 ──────────────┐ │
│ │ 1 │ 9-23 │ alice@corp.com│ 1=alice 2=corp     │ │  ← 点击行 → 文本内定位并选中
│ │ 2 │25-37 │ bob@corp.com  │ 1=bob   2=corp     │ │
│ └───┴──────┴───────────────┴────────────────────┘ │
│ 替换串 [ \g<2>.\g<1>                        ]      │  ← 仅「替换」视图；支持 \1 与 \g<name>
│ ────────────────────────────────────────────────── │
│ [复制为 Python 代码] [插入编辑器] [替换字面量]       │
└───────────────────────────────────────────────────┘
```

#### 11.3.2 逐元素交互细则

| 元素 | 细则 |
|---|---|
| **模式输入** | 默认单行 textarea，占位 `r"\b(\w+)@(\w+)\.com"`；打开 `re.X` 时自动切多行并在 tip 说明「`re.X`：忽略空白与 `#` 后注释」。从编辑器带入非 raw 串 → 顶部 warning 提示条（这是 Python 用户最常踩的坑，值得单独提示） |
| **flags** | 5 个开关（I / M / S / X / A），**多选 → `aria-pressed` 按钮组**（缺陷 #23 纪律：互斥才用 `radioGroup`，此处若误用 radioGroup 会让用户以为只能选一个）。改动即时重算（走防抖） |
| **测试文本** | ✅ **探针 P6 定案：面板内 Monaco**（`host.monaco`）——第二个实例的**边际创建仅 ~8ms**、500 处高亮首次 8ms / 增量 3.9ms；对照的 span 覆盖层反而 10.7ms 且没有点击定位与滚动能力。支持 decorations 高亮、点击匹配行 `revealRange` + `setSelection`、大文本虚拟渲染。⚠️ v1.5 口径：实现为**可编辑**（用户要能粘贴待匹配文本），「只读」仅指**不写回任何文件**——原表述易歧义，按实现回改 |
| **匹配高亮** | 奇偶交替两种底色（相邻匹配否则糊成一片）；当前选中匹配加边框。配色取自主题 token，深浅色主题各验一遍对比度 |
| **匹配表** | 列 `# / 位置 / 匹配 / 分组`；命名组显示为 `名=值`，未命名显示 `1=值`；点击行 → 文本内定位并选中；`Ctrl+C` 复制当前匹配。上限 500，超出显示「仅显示前 500 处（共 N）」 |
| **替换视图** | `re.sub` 结果；替换串支持 `\1` / `\g<name>`；非法反向引用 → 红字原文 + caret 定位 |
| **底部动作** | ① 复制为 Python 代码 → `re.compile(r"...", re.I \| re.M)`；② 插入编辑器（光标处）；③ 替换字面量（`sourceDirty` 时置灰） |

#### 11.3.3 六态呈现

| 态 | 呈现 |
|---|---|
| **空** | 「输入正则模式开始测试」+ 常用示例 chips（邮箱 / URL / 日期 / 数字 / HTML 标签）一键填充 |
| **无匹配** | 中性文案「无匹配」（**不是错误**）+ 常见原因提示（是否忘了 `re.I`？`^$` 锚点？`match` 只从头匹配） |
| **模式非法** | 红字 `re.error` 原文 + 模式框内 pos caret 定位 + 波浪线 |
| **超时** | 「求值超时（3s）：模式可能存在灾难性回溯」+ 一句建议（避免嵌套量词 `(a+)+`） |
| **无解释器** | 求值区置灰 + 「未配置工作区解释器，无法验证匹配（模式解释仍可用）」+ [设置解释器] 跳设置页 |
| **求值中** | 保留上次结果灰显 + 顶部细进度条 |

#### 11.3.4 编辑器侧（L1）

- **高亮**：分组（蓝）/ 量词（紫）/ 字符类（青）/ 锚点（橙）/ 转义（灰）——**只改前景色与下划线样式，不改字体与背景**，避免与主题的语法着色打架。
- **hover 卡**：首行「Python 正则 · flags: I, M」→ 逐 token 人话解释表 → 底行「在测试器中打开」。
- **诊断**：只有 `warning` / `error` 两级（**不用 info，会刷屏**）。**明确不做**风格建议类诊断（如"这里用 search 更好"）——只报客观错误：语法错、`[z-a]` 区间倒置、重复命名组、非 raw 串的转义丢失（warning）。
- **打开方式**：lens 点击 / 右键 / `Ctrl+Alt+R`（editor 级，需焦点）。

### 11.4 格式串工具（P0）

```
┌ 格式串 ────────────────────────────────────────────┐
│ (•) 日期 strftime   ( ) 数字 format   ( ) logging  │  ← 互斥 → radioGroup（正确用法）
│ 格式   [ %Y-%m-%d %H:%M:%S                    ]    │
│ 速查   %Y %m %d %H %M %S %z %a %b %j %U …           │  ← chips，点击插入到光标处；hover data-tip 释义
│ 示例值 [ 2026-09-26 14:03:11                  ]    │  ← 可编辑（默认 now / 1234.5678）
│ 结果                                                │
│ 2026-09-26 14:03:11                          [复制] │  ← 大字只读 output；复制按钮就近（缺陷 #20 教训）
│ 分段   %Y→2026   %m→09   %d→26   -→-               │  ← 点击段 → 模式框内选中该段
└───────────────────────────────────────────────────┘
```

- **速查 chips 按使用频率排序**（`%Y %m %d %H %M %S` 在前），hover 显示含义。
- **数字模式**的结果用**等宽字体**展示（前导空格是语义的一部分，必须看得见），并给出「宽度/精度/千分位/填充」的逐段说明。
- **logging 模式**：速查 chips 换成 `%(asctime)s %(levelname)s %(name)s %(message)s`，示例值给一条模拟日志记录。
- **编辑器 hover**：`%Y-%m-%d` → 「示例：2026-09-26」+ 分段说明；`{:>10,.2f}` → 「示例：`   1,234.57`」。✅ v1.5 落地：示例为**离线固定样本**（时刻 2026-09-26 14:03:11 / 数值 1234.5678 / 一条模拟 logging 记录），hover 内标注样本来源；**未知码与 tz·locale 依赖码（`%z %Z %c %x %X %U %W %G %V`）、`#` 交替形式、`g/G/n/c` 一律不给示例**（I-3：宁可不给，不近似冒充真值），真值仍以面板求值桥为准。
- **诊断**：未知格式码标 warning，hover 给「未知格式码 `%Q`」（不臆测"你是不是想写…"）。
- **降级**：无解释器时**速查表照常可用，预览区置灰并提示**（§4.2 已定口径：统一不降级为 JS 近似，避免两套真值）。

### 11.5 脚本参数表单（P0）

```
┌ 脚本参数 · main.py ────────────────────────────────┐
│ ⓘ 由源码解析（3 项）        [重新解析] [内省 ⚠]     │
│ input    [ a.csv              ]  str   * 必填       │
│ lang     [ zh ▾ ]                str                │  ← choices → 下拉
│ verbose  [✓]                     bool               │  ← store_true → 勾选
│ ────────────────────────────────────────────────── │
│ 命令行                                              │
│ main.py --input a.csv --lang zh --verbose     [复制]│  ← 可手工编辑
│ [运行] [调试] [保存到运行配置] [重置]                │
└───────────────────────────────────────────────────┘
```

| 规则 | 说明 |
|---|---|
| **类型 → 控件映射** | `str`→文本框（有 `choices` 则下拉）· `int`/`float`→数字框（带 min/max 提示）· `store_true`/`store_false`→勾选 · `nargs='*'`→多行文本（逗号分隔）· 未知类型→文本框 |
| **`default` 与 `help`** | default 作占位符（**不是值**，避免"默认值被当成显式输入提交"）；help 作该行 tooltip 与二级说明 |
| **`required=True`** | 行尾 `*` + 提交时校验，缺参 toast 指出缺哪个（✅ v1.5：保存运行配置时走 toast 校验，此前只有内联提示） |
| **三态** | ① 无参数 → 空态「此脚本未声明命令行参数」+ 退化成纯命令行输入框（**不阻止运行**）；② 解析成功；③ 解析失败 → warning「未能解析参数声明」+ 同样退化为纯输入框 |
| **内省（默认关）** | 按钮旁 `data-tip`「将执行脚本顶层代码以获取默认值」；首次点击走 `openConfirm` 确认（副作用必须显式知情）。跑在独立子进程 + 超时 5s |
| **双向同步纪律** | 手工编辑命令行后尽力回填表单；**无法回填时明确标注「表单与命令行不一致，以命令行为准」，绝不静默覆盖用户输入**（这是表单类 UI 最容易翻车的地方） |
| **落点** | **运行面板内嵌**（✅ D-3 裁决确认）——不新增侧栏视图，省一次 `views.ts` 改动，也避免侧栏 tab 拥挤。编辑器 lens「⚙ N 个参数」点击 → 打开运行面板并聚焦参数区 |

### 11.6 JSON 字面量注入（P1 → ✅ 已交付）

- 高亮 + 折叠 + 诊断（错误偏移量映射到字面量内绝对位置）。
- hover 摘要：`object · 14 键 · 3 层` / `array · 128 项`（✅ v1.4 补齐：`libJson.jsonHoverSummary`）。
- **右键三项**：「格式化 JSON」「压缩 JSON」「用 JSONPath 提取」——后两者**只是给已有 DevTool 补编辑器入口**（`jsonfmt` / `jsonpath` 已存在），**纯入口补齐，零新功能成本，性价比极高**。

### 11.7 输出面板日志级别（P1）

- 面板顶部过滤 chips：`ERROR` / `WARNING` / `INFO` / `DEBUG`（**多选 → `aria-pressed`**，与 flags 同一套规范）+ 各级别计数徽标（✅ v1.5 补齐，计数为 0 时不显示徽标）；行左侧 3px 色条（✅ v1.5 由 2px 改回 3px）。
- 匹配规则（按优先级）：`[LEVEL]` → `LEVEL:` → `LEVEL:name:msg`（logging 默认格式）→ `- LEVEL -`。
- **默认只着色不过滤**（过滤默认全开）——避免用户以为"输出丢了"。
- 错误行若含 `File "...", line N` → **复用既有 traceback 点击跳转**，不重复实现。
- 开关 `log_level_colors`，默认开。

### 11.8 pandas / NumPy 运行时卡（P2 条件项 → ✅ P3 探针后关闭）

调试变量面板内命中 `pandas.DataFrame` / `Series` / `ndarray` 时：变量行右侧加 chip（`DataFrame · 3×12` / `ndarray · (2,3) float64`），hover 或展开显示列 chips（上限 30，超出「…等 N 列」）。**不实现表格查看器**（成本与风险都不可控，见 §4.6）。

> ✅ **v1.4 关闭**：P3 探针证实列集合不可得（§10.1-P3），本项按裁决登记放弃，未实现。

### 11.9 横切规范

**设置开关清单**（每项走 4 处接线：`Settings` struct + `DEFAULT_SETTINGS` + index.html + `settingsPanel`，Rust `Settings::default` 同步，旧配置 `!== false` 兜底）：

| key | 默认 | 说明 |
|---|---|---|
| `libs_editor_lens` | 开 | 编辑器内工具 lens（关掉后入口降级到右键 + 命令面板） |
| `libs_regex` | 开 | 正则高亮/hover/诊断 + 测试器 |
| `libs_format` | 开 | 格式串 hover/诊断 + 工具 |
| `libs_argparse` | 开 | 参数表单（关掉后运行面板不显示参数区；✅ v1.5：此前只门控 lens，面板侧已补齐） |
| `libs_json_inject` | 开 | JSON 字面量高亮/折叠/诊断（v1.4 补齐接线） |
| `log_level_colors` | 开 | 输出面板级别着色与过滤（v1.4 补齐接线；关闭后 chips 整体隐藏、既有行摘除着色） |

**键位清单**（走 `keybindingDefaults.ts` 单一来源 + Rust `default_keybindings` 漂移锁同步）：

| id | 建议键位 | scope | 备注 |
|---|---|---|---|
| `open_regex_tester` | `Ctrl+Alt+R` | editor | **需先核对与现有 55 项键位表的冲突**（PR-A 先例：冲突则换配）；带 `when: editorTextFocus` |
| 格式串 / 参数表单 | **不给定键位** | — | 走 lens + 右键 + 命令面板。刻意不膨胀键位表（每加一项都要三处同步 + 漂移锁测试） |

**无障碍与实现纪律**：

- 所有图标按钮 `data-tip` + `aria-label`（UI-09）；**多选语义用 `aria-pressed`、互斥语义用 `radioGroup`**（缺陷 #23 纪律，本批有 3 处：flags、日志级别过滤、格式串三模式）。
- 匹配表用真 `<table>` 语义（可键盘漫游、可屏幕阅读）。
- Tab 顺序固定：模式 → flags → 测试文本 → 替换串；`Esc` 关闭面板；`Ctrl+Enter` 强制求值。
- `radioGroup` 方向键移动即选中（与 themePicker 范式一致）。
- 面板窄屏 360px：`flex-wrap` + 表格横向滚动（缺陷 #19）。
- 求值类面板共用 §11.2 的契约实现（抽一层 `usePyEval(kind, args)` 之类的 hook/helper，**不要让每个面板各写一套防抖与降级**）。

**统一文案模板**（六态，避免每个面板自己造词）：

| 态 | 模板 |
|---|---|
| 空 | 「输入{对象}开始{动作}」 |
| 无结果 | 「无匹配」/「无结果」（中性，不带情绪） |
| 错误 | Python 异常**原文** + 位置 caret |
| 超时 | 「求值超时（{N}s）：{可能原因}」 |
| 降级 | 「{能力}需要工作区解释器，{仍可用的部分}仍可使用」+ [设置解释器] |
| 截断 | 「仅显示前 {N} 项（共 {M}）」 |

### 11.10 交互层开放问题（状态：Q1/Q3 已裁决，其余按默认执行）

| # | 问题 | 状态 |
|---|---|---|
| **Q1** | 正则 lens 与引用 lens 同屏是否太吵？ | ✅ **已裁决（D-2）：两条并存 + 上限 20 + 开关**。引用是既有高频不让位，噪声用上限兜住 |
| **Q2** | 测试文本用只读 Monaco 还是 span 覆盖层？ | ✅ **P6 实测关闭：只读 Monaco**。边际创建 ~8ms、500 处高亮 4–8ms，性能与能力双胜（§10.1-P6） |
| **Q3** | 参数表单放运行面板内嵌 vs 新增侧栏视图？ | ✅ **已裁决（D-3）：运行面板内嵌**。省一次 `views.ts` 改动，侧栏已有 6 个 tab 不再加 |
| **Q4** | 是否提供「替换字面量」（面板改完写回源码）？ | ✅ **默认采纳 A**：提供，但 `sourceDirty`（用户手改过）时置灰 |
| **Q5** | 首次命中是否 toast 引导？ | ✅ **默认采纳 A**：只提示一次，标志写 workspace config |
| **Q6** | 匹配高亮配色 | ⏳ 实现期：用主题 token，深浅色主题各验对比度（**不硬编码颜色值**） |

---

## 12. 裁决记录（2026-09-27 已拍板，实现阶段不得变更）

| # | 决策项 | 裁决 | 影响章节 |
|---|---|---|---|
| **D-1** | 第一批（P0）范围 | **全量 4 项**：求值桥（1d）→ re 三件套（2d）→ 格式串（1.5d）→ 参数表单（2d），约 5–7 个工作日 | §7.1 |
| **D-2** | CodeLens 与引用 lens 共存 | **两条并存 + 上限 20 + 开关**：顺序 `[工具][引用]`，引用不让位；单文件上限 20；`libs_editor_lens` 可关 | §11.1 |
| **D-3** | 参数表单落点 | **运行面板内嵌**，不新增侧栏视图；编辑器 lens「⚙ N 个参数」点击后打开运行面板并聚焦 | §11.5 |
| **D-4** | 求值桥开放程度 | **仅内置受控脚本表**：`kind` 白名单枚举、不开放任意代码执行、无副作用；第三方插件留到 v2 议题 | §5.2 |

**默认执行项**（未单独裁决，按文档推荐办，有异议再提）：

| 项 | 默认 |
|---|---|
| pandas 洞察（§4.6 / §11.8） | ✅ **已执行并关闭**：P3 探针完成，列集合不可得 → 登记放弃（§10.1-P3） |
| Q2 测试文本形态（Monaco vs span 覆盖层） | ✅ P6 探针完成：只读 Monaco |
| Q4「替换字面量」写回源码 | ✅ **提供**，`sourceDirty`（用户手改过）时置灰（已交付） |
| Q5 首次命中 toast 引导 | ✅ **做**（v1.4 落地，标志写 workspace config） |
| 键位 `open_regex_tester`（`Ctrl+Alt+R`） | ✅ 已核对无冲突并落地（键位表现 57 项） |

**冻结声明**：§11 的交互设计随本裁决一并冻结——实现阶段只做填空题，改动交互形态需回头修订本文档。

---

## 13. 来源

- PSF + JetBrains 第八次年度 Python 开发者调查（2025-08，3 万+ 受访）：`The State of Python 2025`、`The Most Popular Python Frameworks and Libraries in 2025`（JetBrains PyCharm Blog，2025-09-02）
- PyCharm 2026.2 Help：`Regular expression syntax reference`（Check RegExp）、`Language and reference injections`
- 本仓库：`docs/python_ide_dev_plan_v2.md` §1.1（目标与不做清单）· `docs/pycharm_ux_review_and_proposal.md:393`（F-1 pytest 裁决）· `docs/plugin_system_design.md` §9.7（正则测试 v1 放弃）· `docs/devtools_plugin_acceptance_record.md` §六（v1.1 备选）· `docs/pycharm_framework_support_report.md`（框架线）· `docs/dx_features_backlog.md`（通用 DX 线）· `intel/README.md`（运行时能力边界）
