# 开发工具插件切片 · 验收记录（PR-1 ~ PR-4）

> 日期：2026-09-20（E2E 验收当日收口）· 依据：`docs/plugin_system_design.md` v0.2 §9（工具插件垂直切片）
> 环境：Windows · Rust (cargo check 2.11) · Node 22 (vitest 3.2.7 / Playwright 1.63) · tsc 5.6 严格模式
> 状态：**PR-1~4 全部落地；Playwright 用户旅程验收 7/7 全绿（连跑两轮零 flaky）。**

## 〇、概要

| 维度 | 结果 |
|---|---|
| 设计 | `plugin_system_design.md` v0.2：§9 十五个小节 + 14 项决策全部拍板落档 |
| 前端单测 | **490/490 全绿**（51 文件；基线 434 → 净增 56） |
| Rust 单测 | **176/176 全绿**（plugin_cmds 3：扫描过滤 / 空目录 / 路径逃逸）；cargo check 零警告 |
| E2E 验收 | **Playwright 7/7 全绿 ×2 轮**（`e2e/plugins/01-devtools-plugin.spec.ts`，覆盖 §9 全部用户旅程） |
| 类型 | `tsc --noEmit` 零错误 |
| 交付形态 | 内置 9 工具全部插件化（dogfooding）+ 第三方加载链路 + 示例插件 + 作者指南 |

## 一、交付物清单

| 层 | 文件 | 说明 |
|---|---|---|
| 前端·框架 | `devtools/kit.ts`（新增） | ToolKit UI 积木：body/row/toolbar/icon/textarea/input/output(Monaco)/button/copy/paste/clear/errorSlot/flash |
| 前端·框架 | `devtools/panel.ts`（重写） | picker（搜索+fuzzyScore+分组+最近使用）· 实例缓存 LRU≤5 · mount 错误卡片(重试) · 注册表变更联动 |
| 前端·框架 | `devtools/types.ts` / `registry.ts` / `host.ts` | Host 扩展（kit/readClipboard/选区三件套）· unregister/onRegistryChanged · host 工厂 |
| 前端·插件域 | `extensions/manifest.ts`（新增） | 校验器（纯函数）：schemaVersion/id/engines(>=X.Y.Z)/权限白名单/tools；checkEnginesCompatible |
| 前端·插件域 | `extensions/facade.ts`（新增） | 权限门控 PanelHost/InlineHost 工厂 · storage 命名空间 · monaco 显式授予 · PermissionDeniedError |
| 前端·插件域 | `extensions/loader.ts`（新增） | 发现→校验→Blob+cache-bust import→注册 · 扫描令牌防竞态 · 整包失败不半加载 · 热重载去抖 diff · 启停/重载/记录 |
| 前端·插件域 | `extensions/inline.ts` / `pluginsTab.ts`（新增） | inline 管线（撤销 toast）· 设置页插件 tab 渲染 |
| 前端·内置 | `devtools/builtin/`（新增 9 文件） | base64/urlcode/hash/jsonfmt/timestamp/uuid/curl2python/jsonpath + index(manifest) + pure(纯函数库) |
| 前端·接线 | `main.ts` / `settingsPanel.ts` / `index.html` / `style.css` / `keybindingDefaults.ts` | 菜单分类子菜单+插件管理入口 · Ctrl+Shift+T · 命令面板「工具:」条目 · 插件 tab 分类 |
| Rust | `src-tauri/src/plugin_cmds.rs`（新增） | list_plugin_dirs / read_plugin_file(路径收口) / watch_plugins_dir(去抖信号) / reveal |
| 示例 | `examples/devtools-plugin-sample/`（新增） | manifest + rot13(面板+inline) + word-count(面板) + README 安装指引 |
| docs | `devtools_plugin_guide.md`（新增）· 本文件 · `plugin_system_design.md` §9 状态标注 | 作者指南 · 验收归档 · 设计对账 |
| 删除 | `devtools/curl2python/index.ts` · `devtools/jsonpath/index.ts` | UI 壳迁 builtin/（parse/gen/tree 纯函数原位保留，其测试不受影响） |

## 二、关键设计决策的落地核对（设计 → 实现）

| 决策（§10.2） | 落地 |
|---|---|
| #6 v1 同源 import + facade | loader Blob URL import；facade 权限门控；§9.6 铁律偏离声明在档 |
| #7 仅全局目录 | Rust `extensions_dir()` = `<data_root>/extensions`；扫描器唯一根 |
| #8 内置即插件 | `registerBuiltinPlugin`：静态模块+内联 manifest，与第三方同路径注册 |
| #9 Python 桥仅预留 | manifest 无 runtime 字段；schemaVersion 承担兼容 |
| #10 category 半开放 | `PRESET_CATEGORIES` + `categoryOrderKey`（「其他」tier 99 垫底——实现期修出并测试钉死） |
| #11 正则测试放弃 | 未实现；v1.1 备选（含 Python re 语义说明） |
| #12 host 分型 | `PanelHost extends BaseHost` / `InlineHost = BaseHost`（TS 类型级强制） |
| #13 monaco 收窄 | facade 仅显式 `monaco` 权限授予；kit.output 独立注入不受限 |
| #14 单文件 entry + 去抖 diff | manifest 明示禁插件内 import；Rust 只发目录信号，前端 400ms 去抖全量 diff |

## 三、实测发现并修复的缺陷

| # | 缺陷 | 修复 |
|---|---|---|
| 1 | `categoryOrderKey` 初版「其他」与自定义同档字母序 →「其他」排到自定义前，违反 §9.8 | 「其他」tier 99 恒垫底；`types.test.ts` 钉死 |
| 2 | kit/host 循环引用（`kit: createToolKit(host)` 在 host 初始化器内引用未赋值 const） | host 先声明后回填 kit（注释说明构造顺序约束） |
| 3 | PR-1 面板缓存键与 mount root 错配（共享 host.root 导致插件工具覆盖面板 rootEl） | PR-3 `registerPluginTool` 改为 `createPanelHost(manifest, dir, host.root, deps)`——每工具独立 root |
| 4 | `unpoison` 误用（传 Mutex 而非 LockResult）；notify-debouncer-mini 0.6 API（`watcher().watch()`） | 对照 watcher.rs 既有用法修正 |
| 5 | toast 选项签名不匹配（actionLabel/onAction 而非 label/run） | 按项目 ToastOptions 适配 |
| 6 | **键位漂移锁命中**（PR-4 全量回归发现）：PR-1 前端新增 `open_devtools` 未同步 Rust `default_keybindings`，`settings::tests::test_defaults` / `test_partial_json` 红 | Rust 侧补 `open_devtools` 条目 + 两处计数断言 36→38（含此前一处历史漏记），176/176 恢复全绿——漂移锁机制按设计发挥作用 |
| 7 | **热重载失效**（复查发现）：`scanPlugins` 对已注册插件直接重注册，`registerDevTool` 因 id 重复拒绝 → 新代码永远注册不上；且同 id 重新注册后面板旧实例（旧 mount 闭包）不被清理 | `loadPluginTools` 重入时先 `unregisterPlugin`；panel 的 `onRegistryChanged` 改为全清缓存 + 激活工具以新定义重挂；registry 通知去抖合并（一个插件 N 工具只刷一次） |
| 8 | **热重载误伤**（复查发现）：目录任何变化（含无关文件）→ 全部 active 插件无条件 revoke+reimport，用户面板输入被无谓清掉 | 真 diff：manifest JSON 对比 + 各 entry 内容 hash 对比（`entryHashes`），无变化跳过重载；toast 改为「状态快照有变化才提示」 |
| 9 | **gid 解析错位**（复查发现）：`unregisterPlugin` 用 `gid.split(".")[1]` 反推工具 id，对多段插件 id（反向域名）错位 → blob URL 泄漏 + `entryHashes` 残留 | 按 `gid.slice(rec.id.length + 1)` 切（前缀长度切割），并补上此前完全遗漏的 `entryHashes.delete` |
| 10 | **panel.ts 顶层 DOM 解析**（复查发现）：`$("devtools-header")` 等顶层快照违反 CR-26（测试环境 import 即炸），扩大了原 panel.ts 的违规面 | 全部改 `lazyEl`（Proxy 惰性解析，方法自动绑定） |
| 11 | **blob URL 拼 query 导致 import 必败**（E2E 揭露，**PR-2 遗留真 bug**）：`import(\`${url}?v=...\`)` —— Chromium 对带 query 的 blob URL 动态 import 直接 `Failed to fetch` → **所有第三方插件从未加载成功过**（单测不覆盖真实 import 链路故未发现） | 去掉 query——`createObjectURL` 每次生成全新 UUID 天然免缓存；注释记录该 Chromium 行为 |
| 12 | **共享 host 的 root 清空缺陷**（E2E 揭露，PR-1 遗留）：panel 把共享 host（root=`#devtools-body`）直接传给 mount，工具 `host.root.textContent=""` 会清掉**其他工具的缓存 rootEl** | activateTool 构造 per-tool host 视图（`{ ...host, root: rootEl }`）——每工具隔离 |
| 13 | **热重载面板不重挂**（E2E 揭露）：unregister/register 两次注册表通知间 `activeToolId` 已被第一轮清空 → 第二轮无从重挂 → 面板永远跑旧代码 | `lastActiveId` 记忆变量：第一轮记忆、第二轮凭记忆以新定义重挂 |
| 14 | **坏插件记录缺 error 详情**（E2E 揭露）：`upsertRecord` 新建分支漏赋 `init.error` → 设置页只显示「加载失败」无原因 | 新建分支补 `error: init.error`（status 一并按 error 归位） |
| 15 | **热重载误报「无变化」**：快照对比只看 id/status/toolIds，同版本重载（代码变了但状态不变）被误判跳过 toast | 快照加 `reloadSeq` 重载代数 |
| 16 | **picker Enter 未漫游时无操作**（E2E 揭露）：Enter 只认 `.active` 高亮项，纯键盘「输入即 Enter」no-op | 无高亮时 fallback 第一项 |
| 17 | **内置插件停用后启用不恢复**（人工验收发现）：`enablePlugin`/`reloadPlugin` 统一走 `scanPlugins()`，而内置插件（source=builtin）**不在磁盘上扫不到** → 工具永不重注册，菜单二级子菜单消失后无法恢复 | 按来源分流：builtin 走 `registerBuiltinPlugin`（模块表快留存于 loader，避免循环依赖）；global 走目录重扫。E2E 新增 08 号用例钉死 |
| 18 | **内置插件停用状态重启后丢失**（修复 #17 时连带发现）：`registerBuiltinPlugin` 启动重注册不查停用清单 → 「停用内置插件 → 重启」静默恢复 | 注册入口检查 `loadDisabled()`，命中则记录 disabled 态并跳过注册 |
| 19 | **jsonfmt 工具栏按钮截断**（人工验收发现）：6 按钮在 360px 面板溢出，末位「复制」被 `#devtools-body` 的 overflow:hidden 裁掉一半 | `.tool-toolbar` / `.tool-row` 加 `flex-wrap: wrap`（窄面板换行兜底，通用骨架全工具受益） |
| 20 | **timestamp / uuid 布局裸奔**（整体检查发现）：`ts-label`/`uuid-label` 类无样式定义、内联 `style.width` 违反 token 纪律、复制按钮远离结果区 | 重写两工具布局：`.tool-label` 通用类 + `.ts-now`/`.uuid-count`/`.ts-input`（scale token 定宽）；复制按钮贴结果行（就近原则） |
| 21 | **uuid「插入编辑器」无失败反馈**（整体检查发现）：无打开文件时静默无反应 | 补 `flashError(无打开文件)`（与 curl2python 对齐） |
| 22 | **hash「大写」按钮 tooltip 双轨违规**（整体检查发现）：永不 disabled 却用原生 `title`（UI-09 要求 data-tip + aria-label） | 迁移到 data-tip + aria-label |
| 23 | **互斥选择用切换按钮表达**（用户提案，整体复查）：base64/urlcode 的「编码/解码」、hash 的「MD5/SHA-256」、jsonfmt 的「2/4 空格」都是二选一互斥语义，但用两个 `.active` 按钮——用户难以区分「互斥选择」与「独立动作」 | kit 新增 `radioGroup` 积木（WAI-ARIA radiogroup，对齐 themePicker 范式：aria-checked 单一真源 + 漫游 tabindex + 方向键移动即选中 + 圆点视觉指示），四处全部迁移；独立开关（hash「大写」）保持 aria-pressed 按钮。kit.test.ts 补互斥语义测试；作者指南更新（互斥选择禁用 `.active` 按钮拼法） |
| 24 | **导入落盘失败留半成品**（DX P2 复核发现）：`copy_dir` 中途失败 → `extensions/<id>/` 残留不完整目录 → 下次导入误报「已存在」挡住重试 | 失败分支 `remove_dir_all` 回滚后再报错 |
| 25 | **导出失败留损坏 zip**（DX P2 复核发现）：zip 写入中途失败 → 半成品文件留存，用户可能拿到损坏包分享 | 失败分支删除目标文件后再报错；`finish()` 消耗 self 的所有权问题经 `export_inner` 拆分解决（条目写入与收尾分离） |

## 四、测试明细（新增 56 项）

| 文件 | 数量 | 覆盖 |
|---|---|---|
| `devtools/__tests__/types.test.ts` | 5 | 预置序 / 自定义档 / 空归类 / 注册序保持 |
| `devtools/__tests__/kit.test.ts` | 8 | 输入规范兜底 · spacer · btn 体系 · iconButton 双补 · clearButton 混合目标 |
| `extensions/__tests__/manifest.test.ts` | 15 | 合法/非法 JSON · schemaVersion · id 规则 · engines 形式 · 权限白名单/去重 · 空工具拒绝 · 兼容比较 |
| `extensions/__tests__/facade.test.ts` | 8 | 权限拒绝（clipboard/selection/storage/fs:read）· storage 命名空间与清理 · monaco 显式授予 · host 分型 |
| `devtools/builtin/__tests__/pure.test.ts` | 21 | MD5 RFC 1321 六向量 · SHA-256 NIST 三向量 · Base64 UTF-8 往返(含 emoji) · URL 往返(+→空格) · 时间戳格式/非法 · UUID v4 |
| Rust `plugin_cmds::tests` | 3 | manifest 目录过滤 · 空目录正常态 · 路径逃逸阻断 |

## 五、Playwright E2E 验收（`e2e/plugins/01-devtools-plugin.spec.ts`，7/7 ×2 轮）

| # | 用户旅程 | 覆盖设计点 |
|---|---|---|
| 01 | 内置工具菜单分类子菜单（flyout 展开 + 分组正确） | §9.8 / 决策 #8 |
| 02 | picker 分组 + 搜索过滤 + Enter 激活 + **实例缓存（切换工具后输入保留）** | §9.9 / §9.13 |
| 03 | 第三方插件安装流：临时目录 → 首扫 → picker/菜单子菜单/命令面板三入口可达 + 面板 mount 生效 | §9.5 |
| 04 | inline 变换：文件树打开文件 → 选中行 → 命令面板「选区转大写」→ 原地替换 → **撤销按钮恢复** | §9.15 |
| 05 | 坏插件（未知权限）整包失败 + 好插件不受连累 + 设置页红字原因（目录名回落 + 错误详情） | §9.2 错误隔离 |
| 06 | **热重载**：磁盘改 entry → 模拟 watcher 事件 → 去抖 diff → toast → **激活面板以新定义重挂（V2 按钮出现）** | §9.15 |
| 07 | 设置页停用 → picker 入口消失 → 启用 → 恢复 | §9.14 |
| 08 | **内置插件停用 → 启用 → 菜单二级子菜单恢复**（#17 缺陷回归钉） | §9.7 / §9.14 |

E2E 基建扩展：mock 补 `plugin:*` 命令族（`plugin:app|version` / clipboard / ruff_lint / list_shells 兜底）；
helpers 增 `plugins` bridge 通道（list_plugin_dirs / read_plugin_file 真实磁盘映射 + `triggerPluginsChanged()`
模拟 Rust watcher 事件，复刻 `plugins-dir-changed` 链路）。

## 六、遗留与后续

| 项 | 说明 | 优先级 |
|---|---|---|
| 编辑器右键「变换选区 ▸」 | v1 未做（Monaco 菜单注册体系侵入较大）；命令面板已覆盖全部 inline 入口 | P2 |
| v1.1 工具备选 | 正则测试（Python re 语义）、进制转换、HTML 实体、Unicode⇄中文、大小写、字数、排序去重、颜色、Diff、密码生成 | P2 |
| v2 议题 | iframe/Worker 沙箱 + 跨 realm facade · 工作区级插件目录 · Python 工具桥（Pyodide/OEP）· `.ocx` 安装包 | P3 |
