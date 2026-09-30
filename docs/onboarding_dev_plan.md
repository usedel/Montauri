# OpenCharm 新手引导 + uv 速查卡开发计划

> 版本：v1.2 · 日期：2026-09-30 · 状态：**已立项未开工**（PR-S1 → S2 主线，S4 可并行，S3/S5 可选；合计 3.5~4 天）
> **v1.2 修订（2026-09-30，落地前置核查）**：① 交互细节定稿——巡礼条目数据结构（`keybindingId` 独立字段：命令面板 id 与键位 id 不总一致，DevTools 案例）、空状态「补缺口+行动性增强」重定位（存量盘点表：7 面板已有教学文案、2 缺口）；② 前置工作清单（§8）：`quickOpen.ts` 私有 `actions` 需导出读取器、e2e mock 现状（`get_data_doc_path` 双侧已映射，OG-1 零补齐）；③ 修正 v1.1 键位示例错误（书签列表实为 Ctrl+Shift+F11，非 Ctrl+F11）。
> **v1.1 修订（2026-09-30）**：功能发现从「指南文档一节」深化为**三层机制**（欢迎页功能巡礼 / 空状态教学 / 键盘提升提示），新增 PR-S4 与 PR-S5（P3 登记）；确立「友好性三定律」设计准绳与单一数据源原则（巡礼条目挂命令面板注册表）。详见 §2 / §3.2 / §3.4。
> 归属：欢迎页 / 帮助文档域（shell 前端为主，零 Rust 改动）
> 上游：五项收尾评估（2026-09-30）——新建 FastAPI 项目（PR-R，见 `pycharm_framework_support_report.md` §8.3.1）· 新手引导 + uv 速查卡（本档）· pip 支持（裁决不做，理由见 §1.4）· 多语言（裁决推迟）· uv 推荐（并入本档）
> 本文档面向实施者，是新手引导的排期与执行依据；与 `python_ide_dev_plan_v2.md` 冲突时以开发计划为准并反馈修订。

---

## 1. 背景与问题定义

### 1.1 功能密度与发现性的剪刀差

DX 三梯队（`dx_features_backlog.md` 全部收官）、devtools 插件系统（16 个 E2E）、live-templates 全家桶、调试最小闭环、端点视图、依赖健康五类修复……功能密度已高，但**新用户无从得知这些存在**：欢迎页快捷键网格（`welcomeShortcuts.ts`，19 行）只覆盖键位，不覆盖「能做什么」。引导缺口是当前体验的短板。

### 1.2 现有引导盘点（四类，全部事件触发型）

| 引导 | 触发条件 | 位置 |
|---|---|---|
| 首启数据落位提示 | `should_prompt`（只弹一次） | `storagePanel.ts`（`storage-onboarding-modal`） |
| 工具链引导 | uv / 静态引擎缺失 | `envPanel.ts::maybePromptToolchain`（`main.ts:2769` 调用） |
| .venv 检测提示 | 首次打开含 .venv 的工作区 | `envPanel.ts::maybePromptVenv` |
| 快捷键网格 | 欢迎页可见时 | `welcomeShortcuts.ts`（键位系统动态渲染） |

**共同缺口**：没有「用户主动来看」的常驻入口；没有把散落功能串成叙事的文档。帮助菜单（`main.ts:1866-1886`）只有 关于 / 作者指南 / 日志目录 / 数据目录，且 MB-13 明确登记过「欢迎页一期不纳入（需 force-show 逻辑，登记为后续可选）」——本计划顺带收掉这条登记。

### 1.3 已就绪的可复用基建（零新依赖）

- **指南打开先例**：`extensions/pluginsTab.ts::openGuide`（`:117-125`）——`docs/*.md` 经 Vite `?raw` 打包（`:17`）→ `writeDataDoc` 写数据根 `docs/`（`get_data_doc_path`，`plugin_cmds.rs:78-84`，自带路径逃逸校验）→ `openFile` 打开。Markdown 预览（`mdPreview`）接线现成，指南文档天然可读可预览。**新手指南复用同一模式**。
- **欢迎页骨架**：`index.html:274-306`（`#editor-overlay > #ew-get-started`：品牌区 / `#ew-actions` 两按钮 / `#ew-recent-section` / 快捷键区）；三态显隐 `updateEditorOverlay`（`main.ts:392-418`）；按钮接线 `main.ts:2421-2423`。
- **菜单 / 命令面板注入点**：`getMenuItems`（`main.ts:1749`）help 分支、`buildQuickOpenActions`（`main.ts:1475`）。
- **终端输出嗅探点**（PR-S3 用）：`depHealth.ts:502-508` 的 sniff 分发；会话去重先例 `uvRunRiskHinted`（`runFlow.ts:98`）。

### 1.4 范围裁决（本计划不做的事）

- **pip 独立后端支持：不做**。所有 UI 安装路径内部已是 uv（`pip_install_impl`，`env_cmds.rs:991-999`：有 pyproject → `uv add`，否则 `uv pip install`）；终端裸 `pip install` 已被完成摘要嗅探识别（`PKG_DONE_RE` 同时覆盖 uv / pip 短语）；requirements.txt 风格已有 depHealth 全链路支持。独立 pip 回退（`python -m pip`）意味着五类修复动作 + 环境快照 + 运行兜底全加双分支，维护成本翻倍，而触发前提（拒绝装 uv）已被工具链引导兜住。**唯一增量 = PR-S3 的建议性 hint**。
- **多语言：推迟**（独立决策项，另行立项评估；本计划所有文案中文硬编码，与现状一致）。
- **强制分步向导：不做**。IDE 用户反感强制 flow；对标 VS Code「欢迎页 + 可随时打开的文档」形态。

---

## 2. 方案总览

### 2.0 设计准绳：功能发现的「友好性三定律」+ 单一数据源

功能发现是本计划真正的难点（功能密度高 ≠ 用户感知到）。原 v1.0 方案只把它做成指南文档的一节静态清单——拉式、一次性、无行动性。v1.1 深化设计前先立准绳，业界范式（VS Code Walkthrough、JetBrains Key Promoter / Learn IDE Features、Tip of the Day、空状态教学）逐一对照过：

1. **在对的时刻出现**：用户有空（欢迎页）、有明确兴趣信号（主动打开了空面板）、刚做了相关动作（鼠标点了带快捷键的菜单项）。绝不在专注编码时插入。
2. **一步可体验**：发现项自带「试一下」——点了功能就开。30 秒真实操作胜过一段文档，体验即理解。
3. **可结束**：能打勾、能关闭、有总量上限。发现机制自己不能变成常驻噪声（否则性质从「引导」恶化为「打扰」，与反馈体系纪律冲突）。

工程红线——**单一数据源**：巡礼条目与空状态行**直接挂 `buildQuickOpenActions`（`main.ts:1475`）的命令注册表**（id + label + run 现成）。发现层绝不重建第二份功能清单：每加一个功能都要同步两处必然漂移，且注册表 id 已对齐键位表（hint 自动跟随改键）。发现层新增的只是「选哪些条目 + 按什么顺序 + 配什么一句话」——即一份**策展数据**，不是功能副本。

**业界范式取舍**（防将来重复评估，均有明确裁决）：

| 范式 | 裁决 | 理由 |
|---|---|---|
| VS Code Walkthrough（分步巡礼 + 完成态） | **吸收** → §3.2 功能巡礼 | 时机律+行动律+退场律全满足，数据驱动可扩展 |
| 空状态教学（空面板内嵌引导） | **吸收** → §3.4 | 兴趣信号最强的时机（用户主动打开了面板） |
| JetBrains Key Promoter（操作后提示快捷键） | **吸收** → §3.5 | 相关性满分的时机（刚做该动作） |
| Tip of the Day（每日弹窗） | 否决 | 时机随机、打断感强，业界口碑最差的引导形态 |
| Productivity Guide（功能使用统计） | 否决 | 需功能级埋点基建，与轻量定位不符 |
| 真实使用追踪（判定巡礼"完成"） | 否决 | 巡礼"点即完成"，零埋点零隐私负担，语义自洽 |

### 2.1 交付全景（五块，按依赖排）

```
┌─ PR-S1：新手指南文档（含 uv 速查卡）────────────────┐
│  docs/onboarding_guide.md（源文件，?raw 打包）        │
│  入口①帮助菜单「新手指南」 ②欢迎页链接 ③命令面板      │
└──────────────────────────────────────────────┘
┌─ PR-S2：欢迎页三步卡 + 功能巡礼 + force-show ────────┐
│  三步卡（新建项目 → 运行 → 调试，点击直达动作）        │
│  功能巡礼 checklist（数据驱动，点「试一下」即体验）    │
│  帮助菜单「欢迎页」force-show（收掉 MB-13 登记）      │
└──────────────────────────────────────────────┘
┌─ PR-S4：空状态补缺口（与 S2 可并行，半天）─────────┐
│  problemsPanel/depHealthPanel 两缺口 + 2 处小修      │
│  （存量 7 面板已有教学文案，见 §3.4 盘点表）         │
└──────────────────────────────────────────────┘
┌─ PR-S3（可选 P2）：裸 pip install → uv 建议 hint ────┐
└─ PR-S5（可选 P3，登记不排期）：键盘提升提示 ─────────┘
```

内容层（指南文档）承载**教学与 uv 推荐**；欢迎页承载**功能发现（巡礼）与三分钟上手**；空状态承载**逐面板的即时教学**；键盘提示承载**习惯迁移**。四层互补，同一内容不重复维护（巡礼/空状态挂命令注册表，指南做全集参考）。

---

## 3. 详细设计

### 3.1 PR-S1：新手指南文档（1 天）

**新文件 `docs/onboarding_guide.md`**（内容大纲，写作时按此展开）：

1. **三分钟上手**：新建项目（含 FastAPI 类型，PR-R 落地后同步补）→ 运行脚本（▶ / Ctrl+Shift+F10）→ 下断点调试（F5 语义：`debug` 键位）。
2. **uv 速查卡**（uv 推荐的主载体）：
   - 为什么 OpenCharm 用 uv：装包快、带缓存、`uv run` 兜底免配环境、`uv venv` / `uv python install` 托管解释器；
   - 命令对照表（核心交付）：

     | 你习惯的 pip 命令 | OpenCharm 推荐 | 说明 |
     |---|---|---|
     | `pip install requests` | `uv add requests` | 写入 pyproject 声明 + 更新 uv.lock |
     | `pip install requests`（不想写声明） | `uv pip install requests` | 语法与 pip 相同，更快 |
     | `pip install -r requirements.txt` | `uv pip install -r requirements.txt` | 兼容旧项目 |
     | `pip uninstall requests` | `uv pip uninstall requests` | |
     | `pip list --outdated` | `uv pip list --outdated` | |
     | `python main.py` | `uv run main.py` | 自动按声明同步环境 |
   - 一句话边界：OpenCharm 内所有「安装」按钮内部就是 uv；终端里敲 pip 也能用，只是慢且不写声明。
3. **功能发现**（每项一句话 + 入口，从现有模块盘点）：devtools 工具箱（Ctrl+Shift+T）、live templates（Ctrl+J / Ctrl+Alt+T）、端点视图（FastAPI/Flask 项目自动出现）、依赖健康面板、本地历史（Ctrl+Shift+H）、TODO 视图、运行历史、书签、剪贴板 diff。
4. **常见问题**：中文 IME 吞 Ctrl+Space（用 Alt+/，见 PR-J 结论）· 首启数据目录在哪 · uv 缺失会怎样（工具链引导）。

**新模块 `shell/src/welcomeGuide.ts`**（TD-014 纪律：不往 main.ts 堆逻辑）：

```ts
// 职责：① 指南落盘 + 打开（复用 openGuide 先例，含数据根写入）
//      ② 供菜单 / 命令面板 / 欢迎页链接注入的单一入口 openOnboardingGuide()
import guideRaw from "../../docs/onboarding_guide.md?raw";
```

- `openOnboardingGuide()`：`get_data_doc_path("onboarding_guide.md")` → `write_file` → openFile（main 注入，`wireNewProject` 同款 handler 注入模式防循环依赖）；
- **落盘即最新**：每次打开都覆写数据根副本，指南随应用版本演进，无版本陈旧问题（openGuide 同款语义）。

**入口接线**（各一处，零 Rust）：

| 入口 | 改动点 |
|---|---|
| 帮助菜单「新手指南」 | `main.ts` getMenuItems help 分支（`:1866`）加一项，置于「关于」之后 |
| 命令面板 | `buildQuickOpenActions`（`:1475`）加 `{ id: "onboarding_guide", label: "新手指南" }` |
| 欢迎页链接 | PR-S2 的三步卡区自带「查看完整指南 →」链接（一并在 S2 渲染，S1 先留菜单/面板双入口） |

### 3.2 PR-S2：欢迎页快速开始 + 功能巡礼 + force-show（1.5 天）

#### 3.2a 三步卡

（`index.html` `#ew-actions`（`:285-288`）与 `#ew-recent-section`（`:290`）之间插入新区块）：

```html
<div id="ew-quickstart" class="ew-section">
  <div class="ew-section-title">快速开始</div>
  <div class="ew-quickstart-steps">
    <!-- 三张卡：①新建项目（点击 = openNewProjectPanel）
         ②运行脚本（说明 ▶ / Ctrl+Shift+F10）
         ③启动调试（说明断点 + debug 键位） -->
  </div>
  <a id="ew-guide-link" class="ew-guide-link">查看完整指南 →</a>
</div>
```

- 步骤动作**全部复用既有入口**（`openNewProjectPanel` / 运行调试只做说明不代触发——运行/调试需要目标文件，空工作区点了没意义，卡 ②③ 是「教学文案 + 键位展示」，读 `kb.bindingLabel()` 同 `welcomeShortcuts` 改键跟随）；
- 显隐跟随 `#ew-actions` 同口径（`updateEditorOverlay`，`main.ts:410-417`）：无工作区全量、有工作区隐藏——三步卡的受众就是还没开工区的新用户；
- 渲染逻辑（键位标签读取）放 `welcomeGuide.ts`（与指南入口同模块，欢迎页域自治）。

#### 3.2b 功能巡礼（v1.1 核心深化）

欢迎页新增「探索功能」区（三步卡下方，同 section 容器）——数据驱动的可交互 checklist：

```
探索功能                                    2/6 已体验
─────────────────────────────────────────────
☑ 工具箱：JSON 路径 / curl 转换…      （已体验）
☐ Live Templates：代码模板补全         [试一下]  Ctrl+J
☐ TODO 视图：收集项目待办              [试一下]
☐ 书签：标记重要位置                    [试一下]  Ctrl+Shift+F11
☐ 运行历史：回看历次输出               [试一下]  Ctrl+Shift+R
☐ 本地历史：文件快照与回滚             [试一下]  Ctrl+Shift+H
```

（键位为出厂默认值示意，实际读 `bindingLabel` 跟随用户改键；首版无「全部完成」后的折叠态示意——见 3.2b 完成态交互。）

**数据与状态**：
- 条目 = **策展数组**（`welcomeGuide.ts` 内）。**字段定稿（v1.2）**：

  ```ts
  interface TourItem {
    /** 命令面板注册表 id（main.ts::buildQuickOpenActions 的条目 id）——「试一下」直接调其 run */
    quickOpenId: string;
    /** 键位表 id（keybindingDefaults.ts 的 KeybindingId）——键位列显示。**与 quickOpenId 分离**：
     *  两者不总一致（如命令面板的 open_devtools 条目对应键位表同 id，但 todo_panel 无键位）。
     *  有键位才传，无键位功能省略（键位列自动不渲染）。 */
    keybindingId?: KeybindingId;
    /** 一句话价值描述（不是功能名复读） */
    blurb: string;
  }
  ```

  **「试一下」的执行路径（v1.2 定稿）**：`welcomeGuide` 导出 `runTourAction(quickOpenId: string): boolean`——内部经 quickOpen 的注册表读取器（见 §8 前置 P0）按 id 查 `run` 并调用；查不到（注册表重构后 id 消失）返回 false → 条目行降级显示「（该功能已变更）」并 toast 提示，不静默失效。
- 完成态 = localStorage `opencharm.tour.<id>` 按条目持久化（key = quickOpenId）；标题行显示「N/M 已体验」。
- **点击「试一下」即记完成**——不做真实使用追踪（裁决见 §2.0），语义是「我看过它了」而非「我以后会天天用」。
- 完成态交互：已完成条目淡化 + 勾选；「全部完成 / 不感兴趣」链接 → 整区折叠成一行「探索功能（6/6）」+ 展开箭头，可重新展开（退场律：用户能关掉它）。
- **布局防御**（memory 54362534 同族陷阱）：巡礼区在 `#ew-get-started` 覆盖层内（居中卡片，非侧栏），但条目多时同样 `max-height + overflow-y: auto`，且与快捷键网格（`.ew-shortcuts`）并存时控制总高度不超视口——首版 6 条 + 折叠态即可。

**首批 6 条定稿（v1.2，id/键位均已核实存在）**：

| quickOpenId | keybindingId | 出厂键位 | blurb（示例） |
|---|---|---|---|
| `open_devtools` | `open_devtools` | Ctrl+Shift+T | 工具箱：JSON 路径 / curl 转换 / 正则速测 |
| `template_palette` | `template_palette` | Ctrl+J | Live Templates：代码模板补全 |
| `todo_panel` | （无键位） | — | TODO 视图：自动收集项目待办标记 |
| `bookmark_list` | `bookmark_list` | Ctrl+Shift+F11 | 书签：标记并快速跳回重要位置 |
| `run_history` | `run_history` | Ctrl+Shift+R | 运行历史：回看历次运行的完整输出 |
| `local_history` | `local_history` | Ctrl+Shift+H | 本地历史：每次保存自动留快照可回滚 |

（注：v1.1 示例图中的「Ctrl+F11」是**切换书签**（`bookmark_toggle`）的键位；列表场景对应 `bookmark_list` = Ctrl+Shift+F11。已修正。）

**策展依据**：不选运行/调试/git（三步卡与日常主线已覆盖）· 不选设置类（是「配置」不是「发现」）· 选「**打开即见内容、体验闭环最短**」的——DevTools 打开就有工具可玩、TODO 切过去就有视图、书签点了就有标记。快速反馈让「试一下」真的在 30 秒内完成（行动律）。

#### 3.2c force-show 欢迎页（收掉 MB-13「欢迎页一期不纳入」登记）

- `welcomeGuide.ts` 导出 `showWelcomeOverlay()` / `dismissWelcomeOverlay()`；
- `updateEditorOverlay` 增加一个尊重位：forceWelcome 态下即使有 activeTab / workspaceRoot 也显示**完整版** overlay（actions + recents + quickstart 全显）——实现为模块内布尔 + 三态函数加一个前置分支（main.ts 改动 ~6 行：调用 `isWelcomeForced()`）；
- 关闭途径：①再点帮助菜单「欢迎页」（toggle）②overlay 右上角关闭按钮（新增 `#ew-force-close`，仅 force 态显示）③用户点击任何动作按钮（打开文件夹 / 新建项目 / 最近工作区）后自动解除 ④激活任何内容 tab（文件树打开文件 / 切标签 / 关标签后自动激活下一个）后自动解除——`activateTab` 首行 `consumeWelcomeForce()`（否则 force 态下新打开的文件被覆盖层整层挡住，e2e 回归 OG-3b）；
- 帮助菜单加「欢迎页」项（help 分支，置于「新手指南」之后）；命令面板同步加 `welcome_page` 条目。

### 3.3 PR-S3（可选 P2）：裸 pip install → uv 建议 hint（半天）

- 嗅探点：`depHealth.ts` 终端 term-data 分发处（`PKG_DONE_RE` 消费点附近）——检测**命令回显行**（PTY 下用户敲的命令会回显进输出流）匹配 `^\s*pip(3)? install\b`（前面非 `uv pip`）；
- 触发后：输出面板持久 hint 一行「检测到直接使用 pip install——可改用 uv add <包>（写入声明）或 uv pip install（语法相同、更快），详见帮助 → 新手指南」（**被动发现走持久 hint，禁 4s toast**——memory 61552154 纪律）；
- 会话去重：`pipUvHinted` Set，`uvRunRiskHinted`（`runFlow.ts:98`）同款模式；
- **误报防线**：只匹配行首命令回显形态（`> pip install x` /裸行），不匹配输出正文中的讨论文本；一次会话只提示一次。若实测误报不可控，此项降级为「只在指南文档里写对照表」并登记结论——**建议性 hint 的价值不应以打扰为代价**。

### 3.4 PR-S4：空状态补缺口（半天，与 S2 可并行）

**动机**：空状态是兴趣信号最强的引导时机——用户**主动打开了** TODO / 书签 / 运行历史面板，此刻他想知道的就是「这面板怎么用起来」。

**存量盘点（v1.2 落地前核查——比 v1.0 预想好得多，重定位为「补缺口 + 行动性增强」）**：`util.ts:114` 的 `emptyState(icon, title, desc, compact)` 是全库统一空态基建，多数面板**已有**教学性 desc：

| 面板 | 空态现状（`file:line`） | 裁决 |
|---|---|---|
| TODO 视图 | `todoView.ts:143`「没有待办标记 / 代码里暂无 TODO / FIXME / HACK / BUG / XXX」 | ✅ 已达标，不动 |
| 书签 | `bookmarks.ts:276`「在目标行按 Ctrl+F11 添加书签…」 | ✅ 已达标（键位文案改读 `bindingLabel("bookmark_toggle")` 防改键失真——**注意此处硬编码了 Ctrl+F11，小修**） |
| 运行历史 | `runHistory.ts:311`「运行一次脚本后，这里会保留它的完整输出」 | ✅ 已达标，不动 |
| 本地历史 | `localHistory.ts:228-233` 双分支（无工作区/无快照） | ✅ 已达标，不动 |
| 端点视图 | `endpointView.ts:175-178`「暂无 @app.get / @router.get / @app.route 声明」 | ⚠️ 可补一句「（FastAPI / Flask 项目）」——当前空态没说这面板属于谁，非 Python Web 用户会困惑 |
| 调试（栈帧/断点/变量） | `debugView.ts:242-255` 三处空态，idle 态**已读** `bindingLabel("debug")` | ✅ 已达标（该文件是空态教学最佳实践范本） |
| 终端 | `termUi.ts:468-473`「点击上方「＋」新建…」 | ✅ 已达标，不动 |
| Git 面板 | `git.ts:245-261` 非 Git 仓库空态**已带「初始化 Git 仓库」按钮** | ✅ 已达标（行动性范本） |
| **问题面板** | `problemsPanel.ts:277-281` 裸 div「没有发现问题」——**未用 emptyState 基建，无下一步指引** | ❌ **缺口 1**：改用 emptyState + desc「运行 ruff / 引擎诊断后，问题会列在这里」 |
| **依赖健康** | 面板空态无 emptyState（体检结果即内容） | ❌ **缺口 2**：无 pyproject/requirements 时空态提示「打开含依赖声明的项目后自动体检」 |

**S4 实际工作量（比 v1.0 缩水）**：① 两个缺口补齐（problemsPanel 改 emptyState、depHealthPanel 加空态）；② bookmarks 硬编码键位改 `bindingLabel`（一行防漂移）；③ endpointView desc 补 FastAPI/Flask 说明（一行文案）。**原设计的 `EMPTY_STATE_TIPS` 集中表取消**——存量已用 `emptyState(title, desc)` 原地达成，再抽表是过度设计；S4 就是 4 处小修，半天量级（原 1 天含集中表基建）。

**教训沉淀**：v1.0 设计空状态机制时没盘存量，差点重复造轮子。debugView（读 bindingLabel）与 git（带行动按钮）就是本项目内的最佳实践——补缺口时照这两个范本抄即可。

### 3.5 PR-S5（可选 P3，登记不排期）：键盘提升提示

**动机**：鼠标用户反复点菜单做某操作时，永远不知道有快捷键（JetBrains Key Promoter 解决的问题）。时机律满分——**刚做该动作**，提示的相关性不可否认。

**设计**：菜单项 action 执行后，若该 id 在键位表有绑定且本会话未提示过 → 1s 后 toast「💡 该操作有快捷键：X」（toast 属操作结果反馈通道，教育性 toast 走轻量非持久，但须去重）。

**红线（降级登记的原因）**：总量上限（每会话最多 3 条，超过后本会话静默）；仅 menu.ts / menuBar.ts 的带 shortcut 渲染项触发；用户无法一键关闭（需加设置项，成本升高）→ 故 P3 登记，待巡礼/空状态落地后观察是否仍有必要。


---

## 4. PR 拆分与量级

| PR | 内容 | 量级 | 依赖 |
|---|---|---|---|
| PR-S1 | 指南文档（含 uv 速查卡）+ `welcomeGuide.ts` + 菜单/命令面板入口 | 1 天 | 无 |
| PR-S2 | 欢迎页三步卡 + **功能巡礼** + guide 链接 + force-show（MB-13 收口） | 1.5 天 | S1 + §8 P0（quickOpen 读取器） |
| PR-S4 | 空状态补缺口（problemsPanel/depHealthPanel 两缺口 + bookmarks 键位防漂移 + endpointView 文案） | 半天 | 无（与 S2 可并行） |
| PR-S3 | 裸 pip → uv 建议 hint | 半天 | 无（可选，视 S1 落地后观察） |
| PR-S5 | 键盘提升提示 | 半天 | 无（P3 登记，不排期） |

顺序：S1 → S2 主线推进；S4 与 S2 可并行（独立 PR，零文件交集）；S3/S5 视观察决定。PR-R（FastAPI 模板）落地后回填指南 §1 的「项目类型」说明一句（内容维护项，非代码）。

---

## 5. 测试与验收基线

| 层 | 用例 |
|---|---|
| vitest | `welcomeGuide` 纯函数：forceWelcome 状态机（置位/解除路径全覆盖，含「动作按钮自动解除」）；三步卡键位标签构造（改键跟随）；**巡礼策展数据卫生**（TourItem 的 quickOpenId 必须存在于命令注册表、keybindingId 必须存在于键位表——防两侧改名后巡礼条目静默失效；条目数上下限 4~12）；**巡礼完成态**（localStorage 读写/容错/计数）；`runTourAction` 的 id 查不到降级路径 |
| e2e（`e2e/ux/04-onboarding.spec.ts`） | OG-1 帮助菜单「新手指南」→ md 打开且预览含「uv 速查卡」标题 · OG-2 欢迎页三步卡可见 + 指南链接可点 · OG-3 有工作区时帮助菜单「欢迎页」→ overlay 完整版显示 → 点关闭恢复编辑器 · OG-4 命令面板「新手指南」可达 · **OG-6 巡礼条目「试一下」（选 open_devtools）→ devtools 面板打开 + 条目变勾选 + 计数 1/6** · **OG-7 巡礼全部完成 → 折叠为一行 · 清 localStorage 后恢复** |
| e2e（S4，并入 `e2e/ux/04` 或独立 spec） | **OG-8 问题面板空态改用 emptyState（断言含「ruff」教学文案）· OG-9 书签空态键位跟随（改键后文案变）** |
| e2e（S3 若做） | OG-5 终端敲 `pip install x`（mock 流）→ hint 出现一次，第二次不重复 |
| 通用 | `tsc` 全绿 · vitest 全绿 · e2e ux 域回归 · cargo 不涉及（零 Rust 改动） |

e2e 注意：帮助菜单子菜单交互用 **click**（hover 有 200ms scheduleSubmenu 延时 + 250ms 关闭竞态，memory 33319285）；菜单项 label 断言用 `.sub-label`（menuBar 渲染，与 menu.ts 的 `.mi-label` 不同类）。

---

## 6. 关键决策（已定，实施勿摇摆）

1. **指南 = 打包内文档而非在线页面**：`?raw` 打包 + 运行时覆写数据根副本（openGuide 先例）——离线可用、随版本更新、零网络依赖；不引 helpview/markdown 渲染新依赖（mdPreview 现成）。
2. **uv 推荐落在内容层（速查卡 + 对照表）**，不做功能拦截或弹窗推销——工具链引导已保证 uv 存在，推荐是教育不是改造。
3. **三步卡是导航不是向导**：卡 ②③ 只做键位教学不代触发（无目标文件时代触发无意义）；全部动作复用既有入口，零新逻辑路径。
4. **force-show 是显示层覆盖**：不动 workspaceRoot / activeTab / session（不产生「假无工作区」态污染恢复快照），只影响 overlay 可见性 + 一个布尔位。
5. **PR-S3 宁缺毋滥**：建议性 hint 的误报代价 > 收益时直接放弃，结论登记本档。
6. **巡礼条目挂命令注册表（单一数据源）**：`quickOpenId` 指向 `buildQuickOpenActions` 条目，发现层只写策展（选哪些 + 一句话），不复制功能定义；vitest 数据卫生测试锁 id 存在性（**两侧**：quickOpenId 在命令注册表、keybindingId 在键位表），改名即红。
7. **巡礼"点即完成"，不做使用追踪**：完成态语义是「我看过它了」；零埋点零隐私负担，也不产生「假装在学习」的进度压力。
8. **空状态教学 = 补缺口，不建集中表**（v1.2 修订）：存量 7 面板已用 `emptyState` 原地达成（§3.4 盘点表），`EMPTY_STATE_TIPS` 集中表取消——再抽表是过度设计；照 debugView（bindingLabel）/ git（行动按钮）两个范本补 2 个缺口即可。
9. **巡礼键位显示与命令 id 分离**：`keybindingId` 独立字段而非复用 quickOpenId——两者不总一致（keybindingDefaults 的 KeybindingId 联合类型 ≠ 命令面板自由 id）；无键位条目省略字段。

## 7. 风险与登记

- `docs/onboarding_guide.md` 打包进前端产物会增 bundle 体积（纯文本 ~10KB 级，devtools_plugin_guide.md 先例同量级，可接受）；
- 指南内容与功能演进漂移：登记维护纪律——新增用户可见功能时在「功能发现」节补一行（与 `welcomeShortcuts` 网格同步的既有习惯同源）；
- e2e boot 早期菜单未就绪：等待树渲染后再点击（PR-K NT2 同款教训）；
- 耗时命令一律子进程 + 明确超时（memory 37926539）。

## 8. 落地前置工作清单（新会话开工序）

> v1.2 新增：把「开工前必须知道的事实/必须先做的小事」集中在此，新会话按序执行即可，无需重复考古。

**P0（S2 的硬前置，先于 S2 合入，~10 行）**：`quickOpen.ts:46` 的模块私有 `let actions: QuickOpenAction[] = []` **没有对外读取器**——巡礼的 `runTourAction` 需要按 id 查 run。补一个：

```ts
/** 按命令面板 id 查注册条目（巡礼「试一下」/数据卫生测试共用；未注册返回 null） */
export function findQuickOpenAction(id: string): QuickOpenAction | null {
  return actions.find((a) => a.id === id) ?? null;
}
```

随做随测：vitest 一例（注册后 find 命中/未注册 null）。注意 `registerQuickOpenActions` 是**整体替换**语义（`actions = list`，`quickOpen.ts:52-54`），main.ts 在插件扫描完成后会重建注册表（`main.ts:2068/2076/2373` 三处调用）——`runTourAction` 每次实时 find（不缓存引用），天然规避重建后引用过期。

**P1（S1 的 e2e 现状，零补齐）**：`get_data_doc_path` 在 mock 双侧**已映射**（`tauri-mock.js:870` plugins 通道 / `helpers.ts:836-839` 含文档名校验与 `..` 逃逸防护），`write_file` 走 FS bridge 真实磁盘——OG-1 无需 mock 基建改动。helpers 的落盘路径在 plugins 根旁 docs（测试域内），断言用返回值即可。

**P2（S2 的键位事实）**：`bindingLabel(id)` 要求 id 属于 `KeybindingId` 联合类型（`keybindings.ts:177` TS 层静态约束）——巡礼的 `keybindingId` 字段类型直接声明为 `KeybindingId`（从 `keybindingDefaults.ts` import），编译期即防错字。六条目 id 与键位已逐一核实存在（§3.2b 表）。

**P3（S2 的 DOM 接线事实）**：欢迎页按钮接线集中在 `main.ts:2421-2423`（ew-open-folder / ew-new-project / ew-recent-clear）——巡礼区新增按钮的 addEventListener 若放 `welcomeGuide.ts` 内部（`wireWelcomeGuide()` 自包含），main.ts 只加一行 init 调用；事件委托可选（巡礼条目少，逐条绑定即可）。

**P4（S4 的空态锚点速查）**：problemsPanel 空态 `problemsPanel.ts:277-281`（裸 div 改 emptyState）· depHealthPanel 空态待实施时定位（当前无 emptyState 调用）· bookmarks 硬编码 `bookmarks.ts:276`（"在目标行按 Ctrl+F11 添加书签"）改 `bindingLabel("bookmark_toggle")` 模板串 · endpointView `endpointView.ts:177`。

**P5（内容写作素材）**：指南「功能发现」节的全集参考 = 巡礼 6 条 + 三步卡 3 条 + 命令面板其余条目（`buildQuickOpenActions` 即全集）；写作时从注册表 label 直抄，不另起炉灶。
